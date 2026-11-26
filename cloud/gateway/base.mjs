/* imports start */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/* imports end */
// devteam's gateway: the one public listener on a cloud box. It lets in only the owner, by a
// passkey registered when the box was claimed, and passes the owner through to the machine's hub
// (box.example.com), a web terminal on the box's tmux server (term.box.example.com), and each
// project's dashboard at a host of its own, its name (alpha.box.example.com: project-hosts@1, below).
// Signed out, a navigation on a project's host gets the gateway's signed-out page, the same for a
// listed name and a made-up one, which sends the whole address, hash included, to sign-in. Signing
// in and passkeys are under /auth on the box's name, so an installed hub signs in without leaving
// its own scope. Every agent runs as the box's user and can change files and take ports, so the box
// and term names serve only bytes the gateway holds: its own copy of the hub page and of ttyd's
// page, and its own pages. Only the hub's JSON (its list, and the owner's threads with the operator)
// and the terminal's socket come from behind it. An agent's page can exist only on a project's or a
// preview's host. The gateway also sends the hub's notifications, by Web Push.
// Behind it the kit runs unchanged: every proxied request looks to the kit like a local browser's,
// and the kit's loopback origins in its response headers are mapped to the public ones.
// A file the owner drops on the terminal is the one thing it stores for the agents' side: under a
// folder only it writes, and handed over as a path pasted into the terminal.
// A session's running dev server gets a name of its own too (cool-tiger.box.example.com), behind the
// owner's session like a project, from the hub's list; the gateway holds nothing about them, never
// picks between two claimants of one name, and box.example.com/dev/ lists them.
// A project's public pages are at <project>.<box>/<slug>/, for anyone, from the gateway's own copy of
// what the owner published.
// The kit's viewers (for threads) lean on it twice. A preview's name answers /.devteam/lens, the
// gateway's own page that frames the app, and the app's own framing headers give way for that one
// frame. The signed-in owner's own visit to a published page is sent to the owner's wrapper on the
// box's own name, <box>/w/<project>/<slug>/, a page of the gateway's framing that project's viewer at
// the published version, under a grant bound to project, slug and tree; everyone else, and any
// doubt, gets the published bytes. A project's host reads the cookie on a published page for that
// choice alone.
// Node only, no dependencies. Usage: node gateway.mjs [serve | reclaim]
// project-hosts@1: where a project is on a box
// This section is the definition the gateway moves to: the address of a project on a box. Until the
// gateway follows it, the lines above describe today's names. A new reserved segment, or any change
// to these rules, bumps the version.
// A project is https://<project>.<box>/, its dashboard, behind the owner's sign-in. <project> is the
// project's name (the name /api/hello gives: settings.md's `project`, else the folder's name) when
// it passes the label rule.
// A public page is https://<project>.<box>/<artifact>/..., for anyone, from the gateway's store (no
// sign-in).
// The label rule: a DNS label of a-z, 0-9 and -, no leading or trailing -, 1 to 63 characters, not
// all digits, and not `term`, `public` or `www`:
//   label: /^(?!\d+$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
// A name two projects share gets no dashboard on its host; its stored pages still answer (the store
// ties each page to the one project folder that published it). A preview whose generated name is a
// project's is not served under it: the name is the project's. A host is known from the hub's list
// (projects first, then previews) or the gateway's store (published pages).
// Reserved first segments, the paths the dashboard and the gateway answer on a project's host: `api`,
// `artifact`, `c`, `healthz`, `index.html`, `presence`, `public-manifest`, `review`, `upload`, `view`. They are
// checked before the store, so a page stored under one never answers on a project's host, and
// Publish refuses those names. The path decides first, in this order. A reserved segment is never a
// published page: it is checked as on today's names (`healthz` is the gateway's own answer, a `c`
// link keeps its own check, every other one needs the session) and, but for `healthz`, goes to the
// project's port. Then a first segment that is not reserved and is a page that name published is
// served to anyone. Anything else needs the session and goes to the project's port, for a name only
// one listed project has.
// Gone, and not redirected: <port>.<box> (all-digit labels) and public.<box>, both 421.
// The box's own name keeps the hub, sign-in (/auth), passkeys, pushes and /dev/. Publish's pages name
// the project: /public/publish?project=<project>&...; ?port= is still accepted from older dashboards.
// /box.json becomes box: 2: `project`, https://{project}.<box>/, in place of `instance`
// (https://{port}.<box>/); its other keys stay.
// The cases are in test/fixtures/project-hosts.json, which the gateway's, the hub's and the
// dashboard's tests read.
// end project-hosts@1
// people@1: who is on a box, in the gateway's state.json beside today's fields
// Today's fields keep their meaning, the owner's: `passkeys` (the owner's passkeys), `sessions` (the
// owner's sessions; each new one also names the passkey it was opened with as `method`), `pushSubs`
// (the owner's devices), `claimHash`/`claimExpires`. "Claimed" stays `passkeys` not empty. So a gateway
// older than this one, which reads only these, lets in the owner alone; it keeps the fields below
// (it writes { ...load(), … }), unread, until a newer gateway returns.
// people: [{ id, name, role, level, methods, pushSubs, added_at, last_seen, notices, rev }]
//   id `p-` + 12 of [a-z2-7]; role 'owner' | 'admin' | 'member', exactly one owner; level 'full' |
//   'view', an admin always full. The owner's row is named "Owner" when made (on the claim, or on
//   the first start over a claimed box); its `methods` hold only the owner's non-passkey methods and
//   its `pushSubs` stay [], since theirs are the top-level fields. `rev` starts at 1 and goes up on
//   every change to the row's name, role, level or methods (not last_seen, nor a method's last_used).
//   notices: [{ kind, at, … }]; kind 'people-reset' carries sessions_ended, invites_deleted and
//   methods_deleted (below).
// A method: { id, type, key, label, added_at, last_used, data }. id `m-` + 12 of [a-z2-7]. A passkey
//   is type 'passkey', key its credential id (base64url), data { userId, jwk, alg, signCount, rp }.
//   (type, key) is unique on the box, the owner's top-level passkeys counted as ('passkey', id).
// peopleSessions: [{ hash, person, method, at, expires }], everyone's but the owner's, each live only
//   while its person's row exists; dropped when expired, as `sessions` are.
// invites: [{ hash, person, expires }].
// peopleStamp: b64u(sha256("devteam-people-stamp-v1\n" + the owner's passkey ids, sorted, joined by
//   "\n")), written with every change this gateway makes to `passkeys`. On start, a stamp that isn't
//   that of `passkeys` means an older gateway reset the owner (a reclaim, a passkey removed or added):
//   every peopleSessions entry and invite goes, and every method in the owner's row with the owner's
//   sessions opened with one, in one write that adds a 'people-reset' notice to the owner's row.
// A new method type adds values of `type` and its `data`; any other change bumps the version.
// end people@1

export const env = process.env;
export const HUB_PORT = Number(env.DEVTEAM_HUB_PORT ?? 4320);
export const PORT_BASE = Number(env.DEVTEAM_PORT_BASE ?? 4321);
export const BLOCK = Array.from({ length: 25 }, (_, i) => PORT_BASE + i);
export const SESSION_MS = 14 * 24 * 3600 * 1000;
export const CHALLENGE_MS = 5 * 60 * 1000;
export const CLAIM_MS = 24 * 3600 * 1000;
export const CAPABILITY_MS = 12 * 3600 * 1000;
export const here = path.dirname(fileURLToPath(new URL('../gateway.mjs', import.meta.url)));
export const b64u = (b) => Buffer.from(b).toString('base64url');
export const unb64u = (s) => (typeof s === 'string' && /^[A-Za-z0-9_-]*$/.test(s) ? Buffer.from(s, 'base64url') : null);
export const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
export const sameBytes = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

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
export function stateStore(dir) {
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
    if (s.peopleSessions) s.peopleSessions = s.peopleSessions.filter((x) => x.expires > Date.now());
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
    cache = s;
    at = stamp();
  };
  return { load, save };
}

// --- people@1 (the header block): the owner's row and the stamp of the owner's passkeys --------
export const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
// 256 is a multiple of 32, so x & 31 is unbiased
export const newId = (prefix) => prefix + Array.from(crypto.randomBytes(12), (x) => B32[x & 31]).join('');
export const peopleStamp = (passkeys) => b64u(sha256(`devteam-people-stamp-v1\n${passkeys.map((p) => p.id).sort().join('\n')}`));
export const ownerRow = (s) => (s.people ?? []).find((p) => p.role === 'owner') ?? null;
// Kept when there is one (a claim after a reclaim keeps the owner's row); added after every old key.
export const withOwner = (s, now = Date.now()) => (ownerRow(s) ? s : { ...s, people: [...(s.people ?? []), { id: newId('p-'), name: 'Owner', role: 'owner', level: 'full', methods: [], pushSubs: [], added_at: new Date(now).toISOString(), last_seen: null, notices: [], rev: 1 }] });
// Every write that changes `passkeys` goes through this, so an older gateway's change shows on start.
export const stamped = (s) => ({ ...s, peopleStamp: peopleStamp(s.passkeys) });
// An older gateway reset the owner (its reclaim, a passkey removed or added under it): whoever it
// let in may not be the owner we knew, so nobody else's session or invite stands, nor any other way
// in as the owner. Other people keep their methods: they sign in again. The counts go in a notice.
export const resetPeople = (s, now = Date.now()) => {
  const owner = ownerRow(s);
  const gone = new Set((owner?.methods ?? []).map((m) => m.id));
  const live = (x) => x.expires > now;
  const counts = {
    sessions_ended: (s.peopleSessions ?? []).filter(live).length + s.sessions.filter((x) => live(x) && gone.has(x.method)).length,
    invites_deleted: (s.invites ?? []).length,
    methods_deleted: gone.size,
  };
  const notice = { kind: 'people-reset', at: new Date(now).toISOString(), ...counts };
  const people = s.people.map((p) => (p === owner ? { ...p, methods: [], rev: p.rev + 1, notices: [...(p.notices ?? []), notice] } : p));
  return { next: stamped({ ...s, people, peopleSessions: [], invites: [], sessions: s.sessions.filter((x) => !gone.has(x.method)) }), counts };
};

// --- sign-in methods: one table of types, passkey built in (createGateway's PASSKEY row) ---------
// What a flow is for. A claim, an add and an invite keep a pending record; a sign-in keeps nothing.
export const PURPOSES = ['claim', 'sign-in', 'add', 'invite'];
// The rows a caller adds (only tests do, by createGateway's `methodTypes`): checked before anything
// starts, so a bad one, or one named `passkey`, stops the gateway rather than replacing the passkey.
export function methodRows(given = {}) {
  return Object.entries(given ?? {}).map(([name, row]) => {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(name) || name === 'passkey') throw new Error(`methodTypes: "${name}" can't name a sign-in method type`);
    if (!['start', 'finish', 'describe'].every((k) => typeof row?.[k] === 'function')) throw new Error(`methodTypes: "${name}" needs start, finish and describe`);
    return [name, row];
  });
}

// The box's own address. Each instance is a subdomain of it, so its DNS needs the name and a
// wildcard under it (box.example.com and *.box.example.com). http only for a *.localhost test.
export function publicUrl(raw = env.DEVTEAM_PUBLIC_URL) {
  if (!raw) throw new Error('set DEVTEAM_PUBLIC_URL to the box\'s address, e.g. https://box.example.com (and point *.box.example.com at it too)');
  const u = new URL(raw);
  const local = u.hostname === 'localhost' || u.hostname.endsWith('.localhost');
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error('DEVTEAM_PUBLIC_URL must be https (passkeys need a secure origin)');
  if (/^\d+\.\d+\.\d+\.\d+$|^\[/.test(u.hostname)) throw new Error('DEVTEAM_PUBLIC_URL must be a name, not an IP address: each instance is a subdomain of it');
  return u.origin;
}
// What the box's image is, from its ENV (cloud/Dockerfile, last lines): the kit release it was cut at
// and its tools' pins, name=version separated by spaces, in their order. Only values of the token form
// are kept, since they go to a page and a log; null when neither is set (a laptop, an older image).
// The one place the gateway reads them: /box.json and the start line both come through here.
export const BOX_TOKEN = /^[\w.+-]{1,64}$/;
export function boxImage(e) {
  const rel = String(e.DEVTEAM_KIT_RELEASE ?? '').trim();
  const pins = String(e.DEVTEAM_BOX_TOOLS ?? '').trim();
  if (!rel && !pins) return null;
  const tools = new Map();
  for (const pair of pins ? pins.split(/\s+/) : []) {
    const i = pair.indexOf('=');
    const [name, version] = [pair.slice(0, i), pair.slice(i + 1)];
    if (i > 0 && BOX_TOKEN.test(name) && BOX_TOKEN.test(version) && !tools.has(name)) tools.set(name, version);
  }
  // own keys whatever the name (fromEntries defines them, so even __proto__ is a key, not a prototype)
  return { release: BOX_TOKEN.test(rel) ? rel : null, tools: Object.fromEntries(tools) };
}
export const gatewayDir = () => env.DEVTEAM_GATEWAY_DIR ?? path.join(env.HOME ?? '.', '.devteam-gateway');

// The key the gateway signs the owner's thread presses with, for the hub (devteam.mjs,
// gatewayProofProblem): Ed25519, made the first time it's asked for, kept with the passkeys.
export function threadKey(store) {
  const now = store.load();
  if (now.threadKey?.privateKey && now.threadKey?.publicKey) return now.threadKey;
  const pair = crypto.generateKeyPairSync('ed25519');
  const made = { privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }) };
  store.save({ ...now, threadKey: made });
  return made;
}
// The headers a signed press carries: the route, when, a nonce, and the body's hash, signed. The
// hub checks each within two minutes and takes each nonce once.
// A box's claim and invite links carry their token after the fragment: one pasted into an operator
// thread turn would reach the hub, be signed and kept, and sit in threads.jsonl for anyone on the box
// to reuse. The token goes before the gateway signs the press; the link's shape stays
// (/auth/claim#…). devteam.mjs's redactClaimLinks holds the same CLAIM_LINK line, byte for byte
// (test/org-access.invites.test.mjs compares them), so a press redacted here is kept word for word
// there and still reads as signed. Strings anywhere in an object or array, keys kept.
// The preview the hub labels so is the supervisor's browser view: the owner's alone (kit-248).
export const BROWSER_VIEW = "Supervisor's browser";
export function redactClaimLinks(v, depth = 0) {
  const CLAIM_LINK = /((?:\/|%2F)auth(?:\/|%2F)claim(?:\?[^\s#"'<>`]*)?(?:#|%23))(?!…)[^\s"'<>`)\]}…]+/gi;
  if (typeof v === 'string') return v.replace(CLAIM_LINK, '$1…');
  if (!v || typeof v !== 'object' || depth >= 6) return v;
  if (Array.isArray(v)) return v.map((x) => redactClaimLinks(x, depth + 1));
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactClaimLinks(x, depth + 1)]));
}
export function hubSignature(privateKeyPem, route, body, ts = Date.now(), nonce = b64u(crypto.randomBytes(24))) {
  const msg = Buffer.from(`devteam-operator-post-v1\n${route}\n${ts}\n${nonce}\n${crypto.createHash('sha256').update(body).digest('hex')}`);
  return { 'x-devteam-gateway-ts': String(ts), 'x-devteam-gateway-nonce': nonce, 'x-devteam-gateway-sig': b64u(crypto.sign(null, msg, crypto.createPrivateKey(privateKeyPem))) };
}
// The same for the owner's answer to what a supervisor's terminal asks, on that instance's
// dashboard (/api/pane-answer): its port in place of the route, under a name of its own, so a
// signature made for one is never good for the other.
export function paneSignature(privateKeyPem, port, body, ts = Date.now(), nonce = b64u(crypto.randomBytes(24))) {
  const msg = Buffer.from(`devteam-pane-answer-v1\n${port}\n${ts}\n${nonce}\n${crypto.createHash('sha256').update(body).digest('hex')}`);
  return { 'x-devteam-gateway-ts': String(ts), 'x-devteam-gateway-nonce': nonce, 'x-devteam-gateway-sig': b64u(crypto.sign(null, msg, crypto.createPrivateKey(privateKeyPem))) };
}
// The same for the owner's Save on an instance's Settings page (/api/owner-setting): its own name,
// so a pane-answer signature is never good for a setting, nor the reverse.
export function ownerSettingSignature(privateKeyPem, port, body, ts = Date.now(), nonce = b64u(crypto.randomBytes(24))) {
  const msg = Buffer.from(`devteam-owner-setting-v1\n${port}\n${ts}\n${nonce}\n${crypto.createHash('sha256').update(body).digest('hex')}`);
  return { 'x-devteam-gateway-ts': String(ts), 'x-devteam-gateway-nonce': nonce, 'x-devteam-gateway-sig': b64u(crypto.sign(null, msg, crypto.createPrivateKey(privateKeyPem))) };
}
// The same for the owner's terminal posts on an instance's dashboard (terminal@1 §3): keys under
// devteam-term-keys-v1 and the shell's open under devteam-term-open-v1, each naming its which, so a
// signature for one route, or one which, is never good for another, nor for a pane answer or a setting.
export function termSignature(privateKeyPem, domain, port, which, body, ts = Date.now(), nonce = b64u(crypto.randomBytes(24))) {
  const msg = Buffer.from(`${domain}\n${port}\n${which}\n${ts}\n${nonce}\n${crypto.createHash('sha256').update(body).digest('hex')}`);
  return { 'x-devteam-gateway-ts': String(ts), 'x-devteam-gateway-nonce': nonce, 'x-devteam-gateway-sig': b64u(crypto.sign(null, msg, crypto.createPrivateKey(privateKeyPem))) };
}
export const claimLive = (s) => Boolean(s.claimHash) && (s.claimExpires ?? 0) > Date.now();
export const claimUrl = (pub, token) => `${pub}/auth/claim#${token}`;
export function newClaim(store) {
  const token = b64u(crypto.randomBytes(32));
  store.save({ ...store.load(), claimHash: b64u(sha256(token)), claimExpires: Date.now() + CLAIM_MS });
  return token;
}

// --- Web Push: encrypted to the browser that subscribed (RFC 8291), signed by the box (RFC 8292) ---
export const PUSH_POLL_MS = 10000;
export const PUSH_DEVICES = 20;
export const PUSH_SEEN_MAX = 200;
export const PUSH_BURST = 3;
export const PUSH_REST_MS = 60000;
export const PUSH_SENDS = 6;
export const PUSH_URL_MAX = 1024;
export const PUSH_TEST = { title: 'devteam: test notification', body: 'Push is working on this device.', tag: 'devteam-test', url: '/' };
export const hkdf = (ikm, salt, info, n) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, n));
export function encryptPush({ p256dh, auth }, plain, sender = null, salt = crypto.randomBytes(16)) {
  const ua = unb64u(p256dh);
  const ecdh = sender ?? crypto.createECDH('prime256v1');
  if (!sender) ecdh.generateKeys();
  const as = ecdh.getPublicKey();
  const ikm = hkdf(ecdh.computeSecret(ua), unb64u(auth), Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32);
  const cipher = crypto.createCipheriv('aes-128-gcm', hkdf(ikm, salt, 'Content-Encoding: aes128gcm\0', 16), hkdf(ikm, salt, 'Content-Encoding: nonce\0', 12));
  const text = Buffer.concat([cipher.update(plain), cipher.update(Buffer.from([2])), cipher.final(), cipher.getAuthTag()]);
  const head = Buffer.alloc(21);
  salt.copy(head);
  head.writeUInt32BE(4096, 16);
  head[20] = as.length;
  return Buffer.concat([head, as, text]);
}
// Apple refuses a token good for more than an hour.
export function vapidToken(jwk, audience, subject, now = Date.now()) {
  const part = (o) => b64u(JSON.stringify(o));
  const head = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: audience, exp: Math.floor(now / 1000) + 1800, sub: subject })}`;
  return `${head}.${b64u(crypto.sign('sha256', Buffer.from(head), { key: crypto.createPrivateKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }))}`;
}
// Only the browsers' own push services: the gateway posts to whatever a subscription names.
export const PUSH_HOSTS = /^(?:[\w-]+\.push\.apple\.com|fcm\.googleapis\.com|[\w.-]+\.push\.services\.mozilla\.com|[\w.-]+\.notify\.windows\.com)$/;
export function pushSubscription(b) {
  try {
    const u = new URL(b.endpoint);
    if (u.protocol !== 'https:' || u.port || u.username || u.password || !PUSH_HOSTS.test(u.hostname) || b.endpoint.length > 1024) return null;
    const p256dh = unb64u(b.keys.p256dh);
    const auth = unb64u(b.keys.auth);
    if (auth?.length !== 16 || p256dh?.length !== 65) return null;
    crypto.ECDH.convertKey(p256dh, 'prime256v1'); // throws if it isn't a point on the curve
    return { endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth, at: new Date().toISOString() };
  } catch { return null; }
}
// The list can hold any string JSON can, and encodeURIComponent throws on half a surrogate pair (a
// cut can make one out of an emoji, so this goes after the cut). With u, \p{Cs} only matches an
// unpaired half; Node 18, which the tests still run on, has no toWellFormed.
export const wellFormed = (s) => s.replace(/\p{Cs}/gu, '\ufffd');
// One entry per root, from what the hub's list says; whatever holds the hub's port wrote it, so each
// field is checked before it is used, and the list's length can't reach beyond the port block.
export function listedByPort(instances, ports) {
  const perPort = new Map();
  for (const x of instances) {
    try {
      if (!x || typeof x.root !== 'string' || x.root.length > 1024 || x.root === '__proto__') continue;
      const port = Number(x.port);
      if (ports.includes(port) && !perPort.has(port)) perPort.set(port, x);
    } catch {}
  }
  return perPort;
}
export function listedByRoot(instances, ports) {
  const perPort = listedByPort(instances, ports);
  const perRoot = new Map();
  for (const x of perPort.values()) if (!perRoot.has(x.root) || Number(x.port) < Number(perRoot.get(x.root).port)) perRoot.set(x.root, x);
  return [...perRoot.values()];
}
export const HOST_LABEL = /^(?!\d+$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const RESERVED_LABELS = ['term', 'public', 'www'];
export const RESERVED_SEGMENTS = ['api', 'artifact', 'c', 'healthz', 'index.html', 'presence', 'public-manifest', 'review', 'upload', 'view'];
// The kit's rule for a branch name (docs/devteam/scripts/devteam.mjs), copied because the gateway
// imports nothing of the kit; a test holds the two to the same characters.
export const BRANCH_AT = /^(?!.*\.\.)(?!.*\/\/)(?!.*\/\.)(?!.*\.lock(?:\/|$))(?!.*[/.]$)[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
// A preview's host name: two letter-only words and an optional number, which no reserved name of
// the box can be. A word list would say nothing more; the map says whether it is live.
export const PREVIEW_NAME = /^[a-z]{3,7}-[a-z]{3,7}(?:-[1-9]\d?)?$/;
export const PREVIEW_MAX = 20;
export const PREVIEW_CAPS = { project: 63, session: 80, label: 40 };
export const previewCap = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
// The previews the hub's list names, as the Inbox counts are read: it is agent-written, so each
// entry is checked and capped, and a port outside the allowed set is dropped (a link must never
// put a dashboard, the hub, the terminal or the gateway behind a second name). A name two ports
// list is ambiguous: the gateway never picks, or one hostile hello could repoint the owner's link.
// Every port counts, whatever root each claims: a root is agent-written too. So does a dev server's
// port: the instance that lists it is the one whose page may hold the app (spec §7), and one listing
// another's port under a name of its own would be that, so a port two instances list is no one's.
// That denies nothing new (a copied name already breaks a link). A port only one lists is its.
export function previewLinks(list, ports, ownPort, ttydPort = 7681) {
  const links = new Map();
  if (!Array.isArray(list)) return links;
  const byDevPort = new Map(); // dev port -> instance port -> its first claimant
  for (const x of listedByPort(list, ports).values()) {
    if (!Array.isArray(x.previews)) continue;
    const seen = new Set();
    for (const p of x.previews.slice(0, PREVIEW_MAX)) {
      try {
        if (!p || typeof p.name !== 'string' || !PREVIEW_NAME.test(p.name) || seen.has(p.name)) continue;
        const port = p.port;
        if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === HUB_PORT || ports.includes(port) || port === ttydPort || port === ownPort) continue;
        if (typeof p.label === 'string' && p.label.length > PREVIEW_CAPS.label) continue;
        seen.add(p.name);
        const row = { port, instance: Number(x.port), root: x.root, project: previewCap(p.project, PREVIEW_CAPS.project), session: previewCap(p.session, PREVIEW_CAPS.session), label: previewCap(p.label, PREVIEW_CAPS.label), run: p.run === true };
        const listers = byDevPort.get(port) ?? byDevPort.set(port, new Map()).get(port);
        if (!listers.has(row.instance)) listers.set(row.instance, { root: row.root, project: row.project, port });
        const had = links.get(p.name);
        if (!had) links.set(p.name, row);
        else {
          const claimants = (had.ambiguous ?? [{ root: had.root, project: had.project, port: had.port }]).concat({ root: row.root, project: row.project, port: row.port }).sort((a, b) => a.root.localeCompare(b.root) || a.port - b.port);
          links.set(p.name, { ambiguous: claimants });
        }
      } catch {}
    }
  }
  for (const [n, link] of links) {
    const listers = link.ambiguous ? null : byDevPort.get(link.port);
    if (listers && listers.size > 1) links.set(n, { ambiguous: [...listers.values()].sort((a, b) => a.root.localeCompare(b.root) || a.port - b.port) });
  }
  return links;
}
