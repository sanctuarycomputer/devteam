#!/usr/bin/env node
// devteam's gateway: the one public listener on a cloud box. It lets in only the owner, by a
// passkey registered when the box was claimed, and passes the owner through to the machine's hub
// (box.example.com), a web terminal on the box's tmux server (term.box.example.com), and each
// instance's dashboard on a subdomain of its own (4321.box.example.com). Signing in and passkeys
// are on auth.box.example.com. Every agent runs as the box's user and can change files and take
// ports, so the box, term and auth names serve only bytes the gateway holds: its own copy of the
// hub page and of ttyd's page, and its own pages. Only the hub's JSON list and the terminal's
// socket come from behind it. An agent's page can exist only on an instance's name.
// Behind it the kit runs unchanged: every proxied request looks to the kit like a local browser's,
// and the kit's loopback origins in its response headers are mapped to the public ones.
// Node only, no dependencies. Usage: node gateway.mjs [serve | reclaim]
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';

const env = process.env;
const HUB_PORT = Number(env.DEVTEAM_HUB_PORT ?? 4320);
const PORT_BASE = Number(env.DEVTEAM_PORT_BASE ?? 4321);
const BLOCK = Array.from({ length: 25 }, (_, i) => PORT_BASE + i);
const SESSION_MS = 14 * 24 * 3600 * 1000;
const CHALLENGE_MS = 5 * 60 * 1000;
const CLAIM_MS = 24 * 3600 * 1000;
const CAPABILITY_MS = 12 * 3600 * 1000;
const here = path.dirname(fileURLToPath(import.meta.url));
const b64u = (b) => Buffer.from(b).toString('base64url');
const unb64u = (s) => (typeof s === 'string' && /^[A-Za-z0-9_-]*$/.test(s) ? Buffer.from(s, 'base64url') : null);
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
const sameBytes = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

// --- CBOR, only as much as WebAuthn needs: definite lengths, no tags or floats, bounded --------
export function cborDecode(buf, start = 0) {
  let i = start;
  let depth = 0;
  const need = (n) => { if (i + n > buf.length) throw new Error('cbor: truncated'); };
  const len = (ai) => {
    if (ai < 24) return ai;
    if (ai === 24) { need(1); return buf[i++]; }
    if (ai === 25) { need(2); i += 2; return buf.readUInt16BE(i - 2); }
    if (ai === 26) { need(4); i += 4; return buf.readUInt32BE(i - 4); }
    if (ai === 27) { need(8); i += 8; const v = buf.readBigUInt64BE(i - 8); if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('cbor: length too large'); return Number(v); }
    throw new Error('cbor: indefinite length');
  };
  const item = () => {
    if (++depth > 16) throw new Error('cbor: too deep');
    need(1);
    const b = buf[i++];
    const mt = b >> 5;
    const ai = b & 31;
    let v;
    if (mt === 0) v = len(ai);
    else if (mt === 1) v = -1 - len(ai);
    else if (mt === 2 || mt === 3) { const n = len(ai); need(n); v = mt === 2 ? Buffer.from(buf.subarray(i, i + n)) : buf.toString('utf8', i, i + n); i += n; }
    else if (mt === 4) { const n = len(ai); if (n > 256) throw new Error('cbor: array too long'); v = []; for (let k = 0; k < n; k++) v.push(item()); }
    else if (mt === 5) { const n = len(ai); if (n > 256) throw new Error('cbor: map too long'); v = new Map(); for (let k = 0; k < n; k++) { const key = item(); if (v.has(key)) throw new Error('cbor: duplicate key'); v.set(key, item()); } }
    else if (mt === 7 && [20, 21, 22].includes(ai)) v = ai === 20 ? false : ai === 21 ? true : null;
    else throw new Error('cbor: unsupported item');
    depth--;
    return v;
  };
  const value = item();
  return { value, end: i };
}

// A COSE public key as a JWK node can load, for the three algorithms the gateway offers.
export function coseToJwk(m) {
  if (!(m instanceof Map)) throw new Error('cose: not a map');
  const kty = m.get(1);
  const alg = m.get(3);
  const bytes = (k, n) => { const v = m.get(k); if (!Buffer.isBuffer(v) || (n && v.length !== n)) throw new Error('cose: bad key field'); return b64u(v); };
  let jwk;
  if (kty === 2 && alg === -7 && m.get(-1) === 1) jwk = { kty: 'EC', crv: 'P-256', x: bytes(-2, 32), y: bytes(-3, 32) };
  else if (kty === 1 && alg === -8 && m.get(-1) === 6) jwk = { kty: 'OKP', crv: 'Ed25519', x: bytes(-2, 32) };
  else if (kty === 3 && alg === -257) jwk = { kty: 'RSA', n: bytes(-1), e: bytes(-2) };
  else throw new Error('cose: unsupported key type or algorithm');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  if (kty === 3 && (key.asymmetricKeyDetails.modulusLength < 2048 || jwk.e !== 'AQAB')) throw new Error('cose: RSA key under 2048 bits or with an unusual exponent');
  return { jwk, alg };
}

// authenticatorData: rpIdHash, flags, signCount, and the attested credential when AT is set.
export function parseAuthData(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 37) throw new Error('authData: too short');
  const flags = buf[32];
  const out = { rpIdHash: buf.subarray(0, 32), up: !!(flags & 1), uv: !!(flags & 4), at: !!(flags & 64), ed: !!(flags & 128), signCount: buf.readUInt32BE(33) };
  if (out.at) {
    if (buf.length < 55) throw new Error('authData: too short for a credential');
    const n = buf.readUInt16BE(53);
    if (n < 1 || n > 1023 || buf.length < 55 + n) throw new Error('authData: bad credential id');
    out.credentialId = buf.subarray(55, 55 + n);
    const { value, end } = cborDecode(buf, 55 + n);
    out.cose = value;
    if (!out.ed && end !== buf.length) throw new Error('authData: trailing bytes');
  }
  return out;
}

export function verifySignature({ jwk, alg }, data, sig) {
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  try { return crypto.verify(alg === -8 ? null : 'sha256', data, key, sig); } catch { return false; }
}

// --- the box's state: passkeys, sessions, the claim token's hash; one small file ---------------
function stateStore(dir) {
  const file = path.join(dir, 'state.json');
  let cache = null;
  let at = '';
  const empty = () => ({ passkeys: [], sessions: [], claimHash: null });
  // read again whenever the file is replaced, so `reclaim` from another process takes effect at once
  const stamp = () => { try { const st = fs.statSync(file); return `${st.ino}:${st.mtimeMs}:${st.size}`; } catch { return 'none'; } };
  const load = () => {
    const now = stamp();
    if (now !== at || !cache) {
      // only a missing file is a new box: one that can't be read must not read as unclaimed
      let text = null;
      try {
        try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        cache = text === null ? empty() : { ...empty(), ...JSON.parse(text) };
      } catch (e) { cache = null; throw Object.assign(new Error(`the gateway's state can't be read: ${e.message}`), { unreadable: true }); }
      at = now;
    }
    return cache;
  };
  const save = (s) => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    s.sessions = s.sessions.filter((x) => x.expires > Date.now());
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
    cache = s;
    at = stamp();
  };
  return { load, save };
}

// The box's own address. Each instance is a subdomain of it, so its DNS needs the name and a
// wildcard under it (box.example.com and *.box.example.com). http only for a *.localhost test.
function publicUrl(raw = env.DEVTEAM_PUBLIC_URL) {
  if (!raw) throw new Error('set DEVTEAM_PUBLIC_URL to the box\'s address, e.g. https://box.example.com (and point *.box.example.com at it too)');
  const u = new URL(raw);
  const local = u.hostname === 'localhost' || u.hostname.endsWith('.localhost');
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error('DEVTEAM_PUBLIC_URL must be https (passkeys need a secure origin)');
  if (/^\d+\.\d+\.\d+\.\d+$|^\[/.test(u.hostname)) throw new Error('DEVTEAM_PUBLIC_URL must be a name, not an IP address: each instance is a subdomain of it');
  return u.origin;
}
const gatewayDir = () => env.DEVTEAM_GATEWAY_DIR ?? path.join(env.HOME ?? '.', '.devteam-gateway');

const authOrigin = (pub) => { const u = new URL(pub); return `${u.protocol}//auth.${u.host}`; };
const claimLive = (s) => Boolean(s.claimHash) && (s.claimExpires ?? 0) > Date.now();
const claimUrl = (pub, token) => `${authOrigin(pub)}/auth/claim#${token}`;
function newClaim(store) {
  const token = b64u(crypto.randomBytes(32));
  store.save({ ...store.load(), claimHash: b64u(sha256(token)), claimExpires: Date.now() + CLAIM_MS });
  return token;
}

// --- the server ---------------------------------------------------------------------------------
export function createGateway(opts = {}) {
  const PUB = publicUrl(opts.publicUrl);
  const pubUrl = new URL(PUB);
  const NAME = pubUrl.hostname;
  const SECURE = pubUrl.protocol === 'https:';
  const SUFFIX = pubUrl.port ? `:${pubUrl.port}` : '';
  const instanceOrigin = (port) => `${pubUrl.protocol}//${port}.${NAME}${SUFFIX}`;
  const instanceOf = (host) => {
    const m = /^(\d{1,5})\.(.+)$/.exec(String(host ?? ''));
    const port = m && m[2] === `${NAME}${SUFFIX}` && String(Number(m[1])) === m[1] ? Number(m[1]) : null;
    return BLOCK.includes(port) ? port : null;
  };
  const AUTH = authOrigin(PUB);
  const authHost = new URL(AUTH).host;
  // passkeys belong to the auth name alone: no agent's page, on any other name, can even ask for one
  const RP_ID = new URL(AUTH).hostname;
  const TERM = `${pubUrl.protocol}//term.${pubUrl.host}`;
  const termHost = new URL(TERM).host;
  const COOKIE = 'devteam_session';
  const dir = opts.dir ?? gatewayDir();
  const ttydPort = Number(opts.ttydPort ?? env.DEVTEAM_TTYD_PORT ?? 7681);
  const store = stateStore(dir);
  const firstFile = (...c) => c.find((f) => f && fs.existsSync(f));
  const hubPage = fs.readFileSync(firstFile(opts.hubPage, env.DEVTEAM_HUB_PAGE, path.join(here, 'hub.html'), path.join(here, '..', 'docs', 'devteam', 'dashboard', 'hub.html')));
  const ttydPage = () => fs.readFileSync(opts.ttydPage ?? env.DEVTEAM_TTYD_PAGE ?? path.join(here, 'ttyd.html'));
  const log = opts.log ?? ((m) => process.stdout.write(`gateway: ${m}\n`));

  // Unclaimed: the token named in the environment, else one made now and printed once (whoever
  // reads the platform's logs can already open a shell on the box, the root of trust anyway).
  try {
    const s = store.load();
    if (!s.passkeys.length) {
      const given = env.DEVTEAM_CLAIM_TOKEN;
      // a link `reclaim` printed outlives a restart, for its day; the environment's token is only the first
      if (claimLive(s)) log(`unclaimed: open the claim link printed earlier (${AUTH}/auth/claim#…), or run devteam-reclaim for a new one`);
      else if (given && given.length >= 32) { store.save({ ...s, claimHash: b64u(sha256(given)), claimExpires: Date.now() + CLAIM_MS }); log(`unclaimed: open ${AUTH}/auth/claim#<DEVTEAM_CLAIM_TOKEN> within a day to claim this box with a passkey`); }
      else { if (given) log('DEVTEAM_CLAIM_TOKEN is shorter than 32 characters; ignored'); log(`unclaimed: open ${claimUrl(PUB, newClaim(store))} within a day to claim this box with a passkey`); }
    }
  } catch (e) {
    // never taken for a new box, never overwritten: every request answers 503 until it is mended
    if (!e.unreadable) throw e;
    log(e.message);
  }

  const secret = crypto.randomBytes(32);
  const mac = (...parts) => crypto.createHmac('sha256', secret).update(parts.join('|')).digest().subarray(0, 16);
  // A claim's or an added passkey's challenge: one use, five minutes, bound to what it was issued for.
  const challenges = new Map();
  const issue = (purpose, extra = {}) => {
    const c = b64u(crypto.randomBytes(32));
    challenges.set(c, { purpose, expires: Date.now() + CHALLENGE_MS, ...extra });
    while (challenges.size > 100) challenges.delete(challenges.keys().next().value);
    return c;
  };
  const redeem = (c, purpose) => {
    const x = typeof c === 'string' ? challenges.get(c) : null;
    if (!x) return null;
    challenges.delete(c);
    return x.purpose === purpose && x.expires > Date.now() ? x : null;
  };
  // Anyone may ask for a login challenge, so asking stores nothing: each carries its own expiry and
  // MAC, and only a verified signature spends one, so no flood of requests can evict the owner's.
  const spent = new Map();
  const loginChallenge = () => {
    const head = Buffer.alloc(24);
    crypto.randomFillSync(head, 0, 16);
    head.writeBigUInt64BE(BigInt(Date.now() + CHALLENGE_MS), 16);
    return b64u(Buffer.concat([head, mac('login', head.toString('hex'))]));
  };
  const loginChallengeOk = (c) => {
    const b = typeof c === 'string' ? unb64u(c) : null;
    if (!b || b.length !== 40 || spent.has(c)) return false;
    const head = b.subarray(0, 24);
    return sameBytes(b.subarray(24), mac('login', head.toString('hex'))) && Number(head.readBigUInt64BE(16)) > Date.now();
  };
  const spend = (c) => {
    for (const [k, t] of spent) if (t < Date.now()) spent.delete(k);
    spent.set(c, Date.now() + CHALLENGE_MS);
  };

  // Every devteam_session the browser sends: one set by something else can't shadow the real one.
  const sessionOf = (req) => {
    const live = store.load().sessions.filter((x) => x.expires > Date.now());
    for (const part of String(req.headers.cookie ?? '').split(';')) {
      const k = part.indexOf('=');
      if (k < 0 || part.slice(0, k).trim() !== COOKIE) continue;
      const tok = unb64u(part.slice(k + 1).trim());
      if (!tok || tok.length !== 32) continue;
      const h = b64u(sha256(tok));
      const found = live.find((x) => x.hash === h);
      if (found) return found;
    }
    return null;
  };
  // Adding a passkey takes a sign-in in the last five minutes, not only a session.
  const fresh = (session) => Date.now() - (session.at ?? 0) < CHALLENGE_MS;
  // One cookie for the box and every instance's subdomain. SameSite=None: a review page or an
  // artifact runs in a sandboxed frame with an opaque origin, and a browser treats its requests
  // (the kit's helpers, committed images) as cross-site, so a Lax cookie would not go with them.
  // Cross-site requests are refused below by their Origin, and by the kit's own checks.
  const cookie = (value, maxAge) => `${COOKIE}=${value}; Domain=${NAME}; Path=/; HttpOnly; Max-Age=${maxAge}${SECURE ? '; Secure; SameSite=None' : '; SameSite=Lax'}`;
  const newSession = () => {
    const tok = crypto.randomBytes(32);
    const s = store.load();
    store.save({ ...s, sessions: [...s.sessions, { hash: b64u(sha256(tok)), at: Date.now(), expires: Date.now() + SESSION_MS }] });
    return cookie(b64u(tok), SESSION_MS / 1000);
  };

  const hsts = SECURE ? { 'strict-transport-security': 'max-age=31536000' } : {};
  const send = (res, code, type, body, extra = {}) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...hsts, ...extra }); res.end(body); };
  const json = (res, code, obj, extra) => send(res, code, 'application/json', JSON.stringify(obj), extra);
  const redirect = (res, to) => { res.writeHead(302, { location: to, 'cache-control': 'no-store', ...hsts }); res.end(); };
  const PAGE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
  const page = (res, html) => send(res, 200, 'text/html; charset=utf-8', html, { 'content-security-policy': PAGE_CSP, 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' });
  const readJson = (req, cap = 64 * 1024) => new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > cap) { req.destroy(); resolve(null); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
  // Where to go after signing in: the box or one of its instances, never anywhere else.
  const safeNext = (n) => {
    try {
      const u = new URL(String(n ?? '/'), PUB);
      if (u.origin === PUB || u.origin === AUTH || u.origin === TERM || (u.protocol === pubUrl.protocol && instanceOf(u.host) && u.origin === instanceOrigin(instanceOf(u.host)))) return u.href;
    } catch {}
    return `${PUB}/`;
  };

  const creationOptions = (purpose) => {
    const userId = b64u(crypto.randomBytes(16));
    return {
      challenge: issue(purpose, { userId }), rp: { id: RP_ID, name: 'devteam' },
      user: { id: userId, name: `owner@${RP_ID}`, displayName: `devteam owner (${RP_ID})` },
      pubKeyCredParams: [-7, -8, -257].map((alg) => ({ type: 'public-key', alg })),
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
      attestation: 'none', timeout: CHALLENGE_MS, excludeCredentials: store.load().passkeys.map((p) => ({ type: 'public-key', id: p.id })),
    };
  };
  const clientData = (b64, type, purpose) => {
    const raw = unb64u(b64);
    if (!raw) throw new Error('no clientDataJSON');
    const c = JSON.parse(raw.toString('utf8'));
    if (c.type !== type) throw new Error('wrong ceremony');
    if (c.origin !== AUTH || c.crossOrigin === true) throw new Error('wrong origin');
    const issued = purpose === 'login' ? loginChallengeOk(c.challenge) : redeem(c.challenge, purpose);
    if (!issued) throw new Error('unknown or expired challenge');
    return { raw, issued, challenge: c.challenge };
  };
  const checkAuthData = (ad) => {
    if (!sameBytes(Buffer.from(ad.rpIdHash), sha256(RP_ID))) throw new Error('wrong relying party');
    if (!ad.up || !ad.uv) throw new Error('the passkey did not verify you (user presence and verification are required)');
  };
  // A new passkey from navigator.credentials.create(): the attestation itself is not checked
  // (attestation 'none'); what makes it trusted is who may register (the claim token, or a session).
  const register = (body, purpose) => {
    const { issued } = clientData(body?.clientDataJSON, 'webauthn.create', purpose);
    const attBytes = unb64u(body?.attestationObject) ?? Buffer.alloc(0);
    const { value: att, end } = cborDecode(attBytes);
    if (end !== attBytes.length) throw new Error('bad attestationObject');
    if (!(att instanceof Map) || !Buffer.isBuffer(att.get('authData'))) throw new Error('bad attestationObject');
    const ad = parseAuthData(att.get('authData'));
    checkAuthData(ad);
    if (!ad.at) throw new Error('no credential in the response');
    const rawId = unb64u(body?.rawId);
    if (!rawId || !sameBytes(rawId, Buffer.from(ad.credentialId))) throw new Error('credential id mismatch');
    const { jwk, alg } = coseToJwk(ad.cose);
    const s = store.load();
    if (s.passkeys.some((p) => p.id === b64u(rawId))) throw new Error('that passkey is already registered');
    const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 60) : `passkey ${s.passkeys.length + 1}`;
    return { id: b64u(rawId), userId: issued.userId, jwk, alg, signCount: ad.signCount, name, createdAt: new Date().toISOString() };
  };
  const verifyAssertion = (body) => {
    const s = store.load();
    const pk = s.passkeys.find((p) => p.id === body?.rawId);
    if (!pk) throw new Error('unknown passkey');
    const { raw, challenge } = clientData(body?.clientDataJSON, 'webauthn.get', 'login');
    const adBytes = unb64u(body?.authenticatorData);
    const sig = unb64u(body?.signature);
    if (!adBytes || !sig) throw new Error('bad assertion');
    if (body?.userHandle && pk.userId && body.userHandle !== pk.userId) throw new Error('the passkey is for another account');
    const ad = parseAuthData(adBytes);
    checkAuthData(ad);
    if (!verifySignature(pk, Buffer.concat([adBytes, sha256(raw)]), sig)) throw new Error('bad signature');
    // A counter that stopped going up means a cloned authenticator; synced passkeys keep it at 0.
    if ((ad.signCount || pk.signCount) && ad.signCount <= pk.signCount) throw new Error('the passkey\'s counter went backwards');
    spend(challenge);
    store.save({ ...s, passkeys: s.passkeys.map((p) => (p.id === pk.id ? { ...p, signCount: ad.signCount, usedAt: new Date().toISOString() } : p)) });
  };

  // --- requests that look local to the kit, and its headers mapped back to the public names ---
  const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'referer', 'forwarded', 'x-real-ip', 'true-client-ip', 'cf-connecting-ip']);
  const upstreamHeaders = (req, port, publicOrigin) => {
    const h = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && !k.startsWith('x-forwarded-') && !k.startsWith('fly-') && !k.startsWith('rndr-') && !k.startsWith('render-')) h[k] = v;
    h.host = `127.0.0.1:${port}`;
    if (req.headers.origin === publicOrigin) h.origin = `http://127.0.0.1:${port}`;
    const rest = String(req.headers.cookie ?? '').split(';').map((p) => p.trim()).filter((p) => p && p.split('=')[0] !== COOKIE).join('; ');
    if (rest) h.cookie = rest; else delete h.cookie;
    return h;
  };
  const LOOP = /http:\/\/(?:127\.0\.0\.1|localhost):(\d+)/g;
  const mapLoop = (s) => s.replace(LOOP, (all, p) => (Number(p) === HUB_PORT ? PUB : BLOCK.includes(Number(p)) ? instanceOrigin(Number(p)) : all));
  const downstreamHeaders = (h, cap, own) => {
    const out = {};
    for (const [k, v] of Object.entries(h)) {
      if (['connection', 'keep-alive', 'transfer-encoding', 'strict-transport-security', 'clear-site-data'].includes(k)) continue;
      // nothing behind the gateway sets a cookie for the box's names (the kit sets none at all)
      if (k === 'set-cookie') { const keep = [].concat(v).filter((c) => !/;\s*domain\s*=/i.test(c) && !new RegExp(`^\\s*${COOKIE}\\s*=`).test(c)); if (keep.length) out[k] = keep; continue; }
      out[k] = k === 'content-security-policy' || k === 'location' ? mapLoop(String(v)) : v;
    }
    // an artifact under its capability: its policy stays under it too
    if (cap && out['content-security-policy']) out['content-security-policy'] = out['content-security-policy'].split(`${own}/artifact/`).join(`${own}${cap}/artifact/`);
    return { ...out, ...hsts };
  };
  const proxy = (req, res, { port, path: p, publicOrigin, cap }) => {
    const up = http.request({ host: '127.0.0.1', port, method: req.method, path: p, headers: upstreamHeaders(req, port, publicOrigin) }, (ur) => {
      // Never kept: a page an agent served once on this name must not come back from the browser's
      // cache after a real dashboard has taken its port.
      res.writeHead(ur.statusCode, { ...downstreamHeaders(ur.headers, cap, publicOrigin), 'cache-control': 'no-store' });
      // an upstream cut off mid-body cuts the browser's response too, rather than leaving it open
      pipeline(ur, res, () => {});
    });
    // and a browser that goes away stops the kit's work for it
    res.on('close', () => { if (!res.writableFinished) up.destroy(); });
    up.on('error', () => {
      if (res.headersSent) return res.destroy();
      send(res, 502, 'text/plain; charset=utf-8', `Nothing answers on instance ${port}.`);
    });
    pipeline(req, up, () => {});
  };
  // The hub's list is the one thing the box's name takes from behind it, and only as data: whatever
  // holds the port, the page reads JSON and shows it as text. No hub yet is an empty list.
  const instances = (req, res) => {
    let settled = false;
    const reply = (body) => { if (settled) return; settled = true; send(res, 200, 'application/json', body); };
    const none = () => reply(JSON.stringify({ hub: 1, instances: [] }));
    const up = http.get({ host: '127.0.0.1', port: HUB_PORT, path: '/instances.json', timeout: 10000, headers: { host: `127.0.0.1:${HUB_PORT}`, 'sec-fetch-site': 'same-origin' } }, (ur) => {
      if (ur.statusCode !== 200) { ur.resume(); return none(); }
      const chunks = [];
      let size = 0;
      ur.on('data', (c) => { size += c.length; if (size > 1024 * 1024) { none(); up.destroy(); } else chunks.push(c); });
      ur.on('end', () => reply(Buffer.concat(chunks)));
      ur.on('error', none);
    });
    up.on('timeout', () => up.destroy());
    up.on('error', none);
  };

  const navigating = (req) => req.method === 'GET' && (req.headers['sec-fetch-mode'] === 'navigate' || (!req.headers['sec-fetch-mode'] && String(req.headers.accept ?? '').includes('text/html')));
  // The cookie is SameSite=None, so a page elsewhere (another site, or another name of the box)
  // could make the browser send it with an <img> or <script>, or navigate a frame to the API. Such
  // a request is refused, but for a link to a page and for what a sandboxed review page loads (its
  // opaque origin makes those cross-site too): the kit's two helpers and a committed image. An
  // artifact's files don't need this: they load under a capability in the path (below).
  const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i;
  const crossSiteOk = (req, p, url) => {
    const site = req.headers['sec-fetch-site'];
    if (!site || site === 'same-origin' || site === 'none') return true;
    if (req.headers['sec-fetch-mode'] === 'navigate') return !p.startsWith('/api/');
    const dest = req.headers['sec-fetch-dest'];
    if (/^\/review\/[^/]+\/devteam-ui\.(js|css)$/.test(p)) return ['script', 'style'].includes(dest);
    return p === '/api/file' && dest === 'image' && IMAGE.test(url.searchParams.get('path') ?? '');
  };
  // A sandboxed artifact can't be told from another site's page by its headers, and its bytes use
  // relative URLs. So the frame's first load (same-origin, with the session) is redirected under
  // /c/<expiry>.<session>.<mac>/, good for that one artifact folder, and its files need no cookie.
  const ARTIFACT = /^\/artifact\/(?:main|wt\/[^/]+)\/[^/]+\//;
  const capMac = (port, prefix, exp, sid) => b64u(mac('artifact', port, prefix, exp, sid));
  const capFor = (port, prefix, session) => {
    const exp = Date.now() + CAPABILITY_MS;
    const sid = session.hash.slice(0, 16);
    return `/c/${exp}.${sid}.${capMac(port, prefix, exp, sid)}`;
  };
  const capOk = (port, inner, exp, sid, given) => {
    const prefix = ARTIFACT.exec(inner)?.[0];
    if (!prefix || /\.\.|%2e|%5c|\\/i.test(inner) || Number(exp) < Date.now()) return false;
    const want = Buffer.from(capMac(port, prefix, exp, sid));
    const got = Buffer.from(given);
    return sameBytes(got, want) && store.load().sessions.some((x) => x.hash.startsWith(sid) && x.expires > Date.now());
  };
  const HUB_CSP = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-src ${[TERM, ...BLOCK.map(instanceOrigin)].join(' ')}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
  const TERM_CSP = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'self' ${TERM.replace(/^http/, 'ws')}; frame-ancestors ${PUB}; base-uri 'none'; form-action 'none'`;
  const loginAt = (next) => `${AUTH}/auth/login${next ? `?next=${encodeURIComponent(next)}` : ''}`;

  // Room for a jar a page has stuffed; past it, see clientError below.
  const server = http.createServer({ maxHeaderSize: 64 * 1024 }, async (req, res) => {
    // origin-form only: a request line with a full URL, or *, is refused
    if (!req.url.startsWith('/') || req.url.startsWith('//')) return send(res, 400, 'text/plain', 'bad request');
    let url;
    try { url = new URL(req.url, PUB); } catch { return send(res, 400, 'text/plain', 'bad request'); }
    if (url.pathname === '/healthz') return send(res, 200, 'text/plain', 'ok');
    // Our own names only; and anything but a read must come from a page on the same name.
    const isBox = req.headers.host === pubUrl.host;
    const isAuth = req.headers.host === authHost;
    const isTerm = req.headers.host === termHost;
    const port = isBox || isAuth || isTerm ? null : instanceOf(req.headers.host);
    if (!isBox && !isAuth && !isTerm && !port) return send(res, 421, 'text/plain; charset=utf-8', `this box answers only on its own names: open ${PUB}/`);
    const own = isBox ? PUB : isAuth ? AUTH : isTerm ? TERM : instanceOrigin(port);
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== own) return send(res, 403, 'text/plain; charset=utf-8', 'only from this box\'s own pages');
    // The kit has no service workers. One an agent's page registers on an instance's name would
    // outlive its server, and run as that name's real dashboard once one takes the port.
    if (port && (req.headers['service-worker'] || req.headers['sec-fetch-dest'] === 'serviceworker')) return send(res, 403, 'text/plain; charset=utf-8', 'no service workers on this box');
    const p = url.pathname;
    const rawPath = req.url.split('?')[0];
    try {
      const cm = port ? /^\/c\/(\d+)\.([\w-]+)\.([\w-]+)(\/artifact\/.*)$/.exec(rawPath) : null;
      if (cm) {
        if (!['GET', 'HEAD'].includes(req.method) || !capOk(port, cm[4], cm[1], cm[2], cm[3])) return send(res, 403, 'text/plain; charset=utf-8', 'that artifact link has expired: open it again from the dashboard');
        return proxy(req, res, { port, path: cm[4] + url.search, publicOrigin: own, cap: `/c/${cm[1]}.${cm[2]}.${cm[3]}` });
      }
      if (!crossSiteOk(req, p, url)) return send(res, 403, 'text/plain; charset=utf-8', 'not for another site\'s page');
      const s = store.load();
      const claimed = s.passkeys.length > 0;
      // the auth name serves the gateway's own pages and nothing else; the others never serve them
      if (isBox && p.startsWith('/auth/')) return redirect(res, `${AUTH}${p}${url.search}`);
      if (isAuth && !p.startsWith('/auth/')) return redirect(res, `${PUB}/`);
      if (isAuth) {
        if (p === '/auth/claim' && req.method === 'GET') return claimed ? redirect(res, '/auth/login') : page(res, PAGES.claim(PUB));
        if (p === '/auth/claim/options' || p === '/auth/claim/verify') {
          if (req.method !== 'POST') return send(res, 405, 'text/plain', 'POST only');
          if (claimed) return json(res, 409, { error: 'this box is already claimed' });
          const body = await readJson(req);
          const live = store.load();
          if (live.claimHash && !claimLive(live)) return json(res, 403, { error: 'this claim link has expired: restart the box, or run devteam-reclaim in a shell on it, for a new one' });
          const want = unb64u(live.claimHash ?? '');
          if (!want || !sameBytes(sha256(typeof body?.token === 'string' ? body.token : ''), want)) return json(res, 403, { error: 'that is not this box\'s claim token' });
          if (p === '/auth/claim/options') return json(res, 200, creationOptions('claim'));
          const pk = register(body, 'claim');
          if (store.load().passkeys.length) return json(res, 409, { error: 'this box is already claimed' });
          store.save({ ...store.load(), passkeys: [pk], claimHash: null, claimExpires: null, sessions: [] });
          log(`claimed with passkey "${pk.name}"`);
          return json(res, 200, { ok: true }, { 'set-cookie': newSession() });
        }
        if (p === '/auth/login' && req.method === 'GET') return page(res, claimed ? PAGES.login(safeNext(url.searchParams.get('next'))) : PAGES.unclaimed());
        if (p === '/auth/login/options' && req.method === 'POST') {
          if (!claimed) return json(res, 409, { error: 'this box is not claimed yet' });
          return json(res, 200, { challenge: loginChallenge(), rpId: RP_ID, userVerification: 'required', timeout: CHALLENGE_MS, allowCredentials: [] });
        }
        if (p === '/auth/login/verify' && req.method === 'POST') {
          verifyAssertion(await readJson(req));
          return json(res, 200, { ok: true }, { 'set-cookie': newSession() });
        }
      }
      const session = claimed ? sessionOf(req) : null;
      if (!session) {
        if (navigating(req)) return redirect(res, claimed ? loginAt(`${own}${req.url}`) : loginAt());
        return send(res, claimed ? 401 : 403, 'text/plain; charset=utf-8', claimed ? 'sign in with your passkey' : 'this box is unclaimed');
      }
      // An instance's dashboard, on its own subdomain: the request exactly as the browser sent it.
      if (port) {
        const prefix = req.method === 'GET' && ['iframe', 'document'].includes(req.headers['sec-fetch-dest']) && ['same-origin', 'none'].includes(req.headers['sec-fetch-site']) ? ARTIFACT.exec(rawPath)?.[0] : null;
        if (prefix) return redirect(res, `${capFor(port, prefix, session)}${req.url}`);
        return proxy(req, res, { port, path: req.url, publicOrigin: own });
      }
      // The terminal: the gateway's copy of ttyd's page. Only its socket reaches ttyd (see upgrade).
      if (isTerm) {
        if (req.method === 'GET' && p === '/') {
          let body;
          try { body = ttydPage(); } catch { return send(res, 502, 'text/plain; charset=utf-8', 'This image has no terminal page.'); }
          return send(res, 200, 'text/html; charset=utf-8', body, { 'content-security-policy': TERM_CSP, 'referrer-policy': 'no-referrer' });
        }
        if (req.method === 'GET' && p === '/token') return json(res, 200, { token: '' });
        return send(res, 404, 'text/plain', 'not found');
      }
      if (isAuth) {
        if (p === '/auth/logout' && req.method === 'POST') {
          const now = store.load();
          store.save({ ...now, sessions: now.sessions.filter((x) => x.hash !== session.hash) });
          return json(res, 200, { ok: true }, { 'set-cookie': cookie('', 0) });
        }
        if (p === '/auth/passkeys' && req.method === 'GET') return fresh(session) ? page(res, PAGES.passkeys(store.load().passkeys, PUB)) : redirect(res, loginAt(`${AUTH}/auth/passkeys`));
        if (p.startsWith('/auth/passkeys/') && !fresh(session)) return json(res, 403, { error: 'sign in again to change passkeys (reload this page)' });
        if (p === '/auth/passkeys/options' && req.method === 'POST') return json(res, 200, creationOptions(`add:${session.hash}`));
        if (p === '/auth/passkeys/verify' && req.method === 'POST') {
          const pk = register(await readJson(req), `add:${session.hash}`);
          const now = store.load();
          store.save({ ...now, passkeys: [...now.passkeys, pk] });
          log(`passkey "${pk.name}" added`);
          return json(res, 200, { ok: true });
        }
        if (p === '/auth/passkeys/remove' && req.method === 'POST') {
          const body = await readJson(req);
          const now = store.load();
          if (now.passkeys.length < 2) return json(res, 400, { error: 'the last passkey can\'t be removed; add another first' });
          if (!now.passkeys.some((x) => x.id === body?.id)) return json(res, 404, { error: 'no such passkey' });
          // whoever held it may hold a session too: every other session ends
          store.save({ ...now, passkeys: now.passkeys.filter((x) => x.id !== body.id), sessions: now.sessions.filter((x) => x.hash === session.hash) });
          log('a passkey was removed; every other session ended');
          return json(res, 200, { ok: true });
        }
        return send(res, 404, 'text/plain', 'not found');
      }
      // The box's own name: the gateway's copy of the hub page, what it needs to know, and the list.
      if (req.method === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, 'text/html; charset=utf-8', hubPage, { 'content-security-policy': HUB_CSP, 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' });
      if (req.method === 'GET' && p === '/box.json') return json(res, 200, { box: 1, terminal: `${TERM}/`, instance: `${pubUrl.protocol}//{port}.${NAME}${SUFFIX}/`, passkeys: `${AUTH}/auth/passkeys` });
      if (req.method === 'GET' && p === '/instances.json') return instances(req, res);
      return send(res, 404, 'text/plain', 'not found');
    } catch (e) {
      if (res.headersSent) return res.destroy();
      return json(res, e?.unreadable ? 503 : 400, { error: String(e?.message ?? e) });
    }
  });

  // A stuffed cookie jar (any page on an instance's name can write cookies for the whole box) would
  // otherwise answer 431 on every name, sign-in included, for good. Clearing the jar costs a sign-in.
  server.on('clientError', (e, socket) => {
    if (e.code !== 'HPE_HEADER_OVERFLOW') return socket.destroy();
    const body = 'Too many cookies; cleared. Reload to sign in.';
    socket.end(`HTTP/1.1 431 Request Header Fields Too Large\r\nclear-site-data: "cookies"\r\ncontent-type: text/plain\r\nconnection: close\r\ncontent-length: ${body.length}\r\n\r\n${body}`);
  });

  // The terminal's WebSocket, the one upgrade there is: the terminal's name, its Origin, a session.
  server.on('upgrade', (req, socket, head) => {
    const refuse = (code, msg) => { socket.end(`HTTP/1.1 ${code} ${msg}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`); };
    if (req.headers.host !== termHost) return refuse(421, 'Misdirected Request');
    if (req.headers.origin !== TERM) return refuse(403, 'Forbidden');
    try { if (!store.load().passkeys.length || !sessionOf(req)) return refuse(401, 'Unauthorized'); } catch { return refuse(503, 'Service Unavailable'); }
    let p;
    try { p = new URL(req.url, PUB); } catch { return refuse(400, 'Bad Request'); }
    if (!req.url.startsWith('/') || p.pathname !== '/ws') return refuse(404, 'Not Found');
    const up = net.connect(ttydPort, '127.0.0.1');
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
    socket.on('close', () => up.destroy());
    up.on('connect', () => {
      if (socket.destroyed) return up.destroy();
      const h = upstreamHeaders(req, ttydPort, null);
      delete h.origin;
      h.connection = 'Upgrade';
      h.upgrade = req.headers.upgrade;
      const lines = [`GET ${p.pathname}${p.search} HTTP/1.1`, ...Object.entries(h).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)];
      up.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head?.length) up.write(head);
      pipeline(up, socket, () => {});
      pipeline(socket, up, () => {});
    });
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  return { server, publicUrl: PUB };
}

// --- the gateway's own pages -------------------------------------------------------------------
const STYLE = `<style>
:root{color-scheme:light dark;--bg:#fafafa;--fg:#171717;--fg2:#666;--line:#e5e5e5;--btn:#171717;--btnfg:#fff;--red:#cb2a2f}
@media (prefers-color-scheme:dark){:root{--bg:#000;--fg:#ededed;--fg2:#a1a1a1;--line:#2e2e2e;--btn:#ededed;--btnfg:#000;--red:#ff6166}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}
main{max-width:440px;margin:12vh auto;padding:0 16px}h1{font-size:20px;margin:0 0 8px}p{color:var(--fg2)}
button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid var(--btn);background:var(--btn);color:var(--btnfg);cursor:pointer}
button.quiet{background:none;color:var(--fg);border-color:var(--line)}input{font:inherit;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:none;color:var(--fg);width:100%;box-sizing:border-box;margin:8px 0}
#err{color:var(--red)}li{margin:6px 0;display:flex;gap:8px;align-items:center;justify-content:space-between}ul{padding:0;list-style:none}a{color:inherit}
</style>`;
// The browser half of a ceremony: base64url in JSON both ways.
const CLIENT = `<script>
const b = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const s = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
const err = (m) => { document.getElementById('err').textContent = m || ''; };
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
async function create(optionsUrl, verifyUrl, extra) {
  const o = await post(optionsUrl, extra);
  o.challenge = b(o.challenge); o.user.id = b(o.user.id);
  o.excludeCredentials = o.excludeCredentials.map((c) => ({ ...c, id: b(c.id) }));
  const c = await navigator.credentials.create({ publicKey: o });
  return post(verifyUrl, { ...extra, rawId: s(c.rawId), clientDataJSON: s(c.response.clientDataJSON), attestationObject: s(c.response.attestationObject) });
}
async function signIn() {
  const o = await post('/auth/login/options');
  o.challenge = b(o.challenge);
  const c = await navigator.credentials.get({ publicKey: o });
  return post('/auth/login/verify', { rawId: s(c.rawId), clientDataJSON: s(c.response.clientDataJSON), authenticatorData: s(c.response.authenticatorData), signature: s(c.response.signature), userHandle: c.response.userHandle ? s(c.response.userHandle) : null });
}
const run = (f) => async () => { err(); try { await f(); } catch (e) { err(e.name === 'NotAllowedError' ? 'Cancelled, or the passkey was not allowed.' : e.message); } };
</script>`;
const esc = (x) => String(x).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const jsonIn = (x) => JSON.stringify(x).replace(/</g, '\\u003c');
const doc = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${STYLE}</head><body><main>${body}</main>${CLIENT}`;
const PAGES = {
  claim: (box) => `${doc('Claim this box', `<h1>Claim this devteam box</h1><p>Make a passkey for this box. Your password manager (1Password, iCloud Keychain…) saves it; from then on only a passkey made here opens the box.</p><input id="name" placeholder="Name this passkey (optional)" maxlength="60"><p><button id="go">Create passkey and claim</button></p><p id="err"></p>`)}
<script>
const token = decodeURIComponent(location.hash.slice(1));
history.replaceState(null, '', location.pathname);
if (!token) err('This link has no claim token. Use the full link from the box\\'s logs (it ends in #…).');
document.getElementById('go').onclick = run(async () => { await create('/auth/claim/options', '/auth/claim/verify', { token, name: document.getElementById('name').value }); location.replace(${jsonIn(`${box}/`)}); });
</script></body></html>`,
  login: (next) => `${doc('Sign in', '<h1>devteam</h1><p>Sign in with this box\'s passkey.</p><p><button id="go" autofocus>Sign in with a passkey</button></p><p id="err"></p>')}
<script>const next = ${jsonIn(next)}; document.getElementById('go').onclick = run(async () => { await signIn(); location.replace(next); });</script></body></html>`,
  unclaimed: () => `${doc('Unclaimed', '<h1>This box is unclaimed</h1><p>Open the claim link from the box\'s logs (it ends in <code>/auth/claim#…</code>). Lost it? In a shell on the box, run <code>devteam-reclaim</code>.</p>')}</body></html>`,
  passkeys: (list, box) => `${doc('Passkeys', `<h1>Passkeys</h1><p>Any of these opens the box. Add one for another device or password manager; keep at least one. Removing one signs out every other session.</p><ul>${list.map((p) => `<li><span>${esc(p.name)} <small style="color:var(--fg2)">${esc(p.createdAt.slice(0, 10))}</small></span>${list.length > 1 ? `<button class="quiet" data-id="${esc(p.id)}">Remove</button>` : ''}</li>`).join('')}</ul><input id="name" placeholder="Name the new passkey" maxlength="60"><p><button id="add">Add a passkey</button> <button class="quiet" id="out">Sign out</button> <a href="${esc(`${box}/`)}">Back to the hub</a></p><p id="err"></p>`)}
<script>
document.getElementById('add').onclick = run(async () => { await create('/auth/passkeys/options', '/auth/passkeys/verify', { name: document.getElementById('name').value }); location.reload(); });
document.getElementById('out').onclick = run(async () => { await post('/auth/logout'); location.replace('/auth/login'); });
for (const x of document.querySelectorAll('button[data-id]')) x.onclick = run(async () => { if (confirm('Remove this passkey?')) { await post('/auth/passkeys/remove', { id: x.dataset.id }); location.reload(); } });
</script></body></html>`,
};

// --- command line ------------------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const cmd = process.argv[2] ?? 'serve';
  try {
    if (cmd === 'serve') {
      const { server, publicUrl: pub } = createGateway();
      const port = Number(env.PORT ?? 8080);
      // every address, IPv6 too: a port left open on either family is one an agent could take
      const up = () => process.stdout.write(`gateway: ${pub} on :${port}\n`);
      const fallback = (e) => { if (e.code !== 'EAFNOSUPPORT' && e.code !== 'EADDRNOTAVAIL') throw e; server.listen(port, '0.0.0.0', up); };
      server.once('error', fallback);
      server.listen(port, '::', () => { server.off('error', fallback); up(); });
      for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
    } else if (cmd === 'reclaim') {
      // Lost every passkey: forget them and every session, and print a new claim link. Run it in a
      // shell on the box (Render's Shell tab, fly ssh console): that access is the root of trust.
      const pub = publicUrl();
      const store = stateStore(gatewayDir());
      store.save({ ...store.load(), passkeys: [], sessions: [] });
      process.stdout.write(`every passkey and session is forgotten. Claim the box again: ${claimUrl(pub, newClaim(store))}\n`);
    } else {
      process.stderr.write('usage: node gateway.mjs [serve | reclaim]\n');
      process.exit(2);
    }
  } catch (e) {
    process.stderr.write(`gateway: ${e.message}\n`);
    process.exit(1);
  }
}
