#!/usr/bin/env node
// devteam's gateway: the one public listener on a cloud box. It lets in only the owner, by a
// passkey registered when the box was claimed, and passes the owner through to the machine's hub
// (box.example.com), a web terminal on the box's tmux server (term.box.example.com), and each
// instance's dashboard on a subdomain of its own (4321.box.example.com). Signing in and passkeys
// are under /auth on the box's name, so an installed hub signs in without leaving its own scope.
// Every agent runs as the box's user and can change files and take ports, so the box and term names
// serve only bytes the gateway holds: its own copy of the hub page and of ttyd's page, and its own
// pages. Only the hub's JSON (its list, and the owner's threads with the operator) and the
// terminal's socket come from behind it. An agent's page can exist only on an instance's name. The gateway also sends the hub's notifications, by Web Push.
// Behind it the kit runs unchanged: every proxied request looks to the kit like a local browser's,
// and the kit's loopback origins in its response headers are mapped to the public ones.
// A file the owner drops on the terminal is the one thing it stores for the agents' side: under a
// folder only it writes, and handed over as a path pasted into the terminal.
// A session's running dev server gets a name of its own too (cool-tiger.box.example.com), behind the
// owner's session like an instance, from the hub's list; the gateway holds nothing about them, never
// picks between two claimants of one name, and box.example.com/dev/ lists them.
// The kit's viewers (for threads) lean on it twice. A preview's name answers /.devteam/lens, the
// gateway's own page that frames the app, and the app's own framing headers give way for that one
// frame. On public.box.example.com, the signed-in owner's own visit to a published page gets a page
// of the gateway's framing that project's viewer at the published version; everyone else, and any
// doubt, gets the published bytes. The public name reads the cookie for that choice alone.
// Node only, no dependencies. Usage: node gateway.mjs [serve | reclaim]
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

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
const claimLive = (s) => Boolean(s.claimHash) && (s.claimExpires ?? 0) > Date.now();
const claimUrl = (pub, token) => `${pub}/auth/claim#${token}`;
function newClaim(store) {
  const token = b64u(crypto.randomBytes(32));
  store.save({ ...store.load(), claimHash: b64u(sha256(token)), claimExpires: Date.now() + CLAIM_MS });
  return token;
}

// --- Web Push: encrypted to the browser that subscribed (RFC 8291), signed by the box (RFC 8292) ---
const PUSH_POLL_MS = 10000;
const PUSH_DEVICES = 20;
const PUSH_SEEN_MAX = 200;
const PUSH_BURST = 3;
const PUSH_REST_MS = 60000;
const PUSH_SENDS = 6;
const PUSH_URL_MAX = 1024;
const PUSH_TEST = { title: 'devteam: test notification', body: 'Push is working on this device.', tag: 'devteam-test', url: '/' };
const hkdf = (ikm, salt, info, n) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, n));
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
const PUSH_HOSTS = /^(?:[\w-]+\.push\.apple\.com|fcm\.googleapis\.com|[\w.-]+\.push\.services\.mozilla\.com|[\w.-]+\.notify\.windows\.com)$/;
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
const wellFormed = (s) => s.replace(/\p{Cs}/gu, '\ufffd');
// One entry per root, from what the hub's list says; whatever holds the hub's port wrote it, so each
// field is checked before it is used, and the list's length can't reach beyond the port block.
function listedByPort(instances, ports) {
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
function listedByRoot(instances, ports) {
  const perPort = listedByPort(instances, ports);
  const perRoot = new Map();
  for (const x of perPort.values()) if (!perRoot.has(x.root) || Number(x.port) < Number(perRoot.get(x.root).port)) perRoot.set(x.root, x);
  return [...perRoot.values()];
}
// A preview's host name: two letter-only words and an optional number, which no reserved name of
// the box can be. A word list would say nothing more; the map says whether it is live.
export const PREVIEW_NAME = /^[a-z]{3,7}-[a-z]{3,7}(?:-[1-9]\d?)?$/;
const PREVIEW_MAX = 20;
const PREVIEW_CAPS = { project: 63, session: 80, label: 40 };
const previewCap = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
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
// --- the preview lens: the gateway's own page on a preview's name, framing the app -------------
// The kit's viewer frames it at /.devteam/lens. On the app's own origin, it reads the app's page for
// the viewer over postMessage (spec §7). The kit's laptop relay serves the same bytes, so its
// source is in devteam.mjs too, and a test holds the two equal. It is a String.raw, so its regular
// expressions read as written, and so it may hold no backtick and no dollar sign before a brace.
export const PREVIEW_LENS = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>Preview</title><style>html{touch-action:manipulation}html,body{margin:0;height:100%;overflow:hidden;background:#fff}iframe{display:block;border:0;width:100%;height:100%}</style></head>
<body><!-- The sandbox is advisory: the same-origin app can lift it. frame-src 'self' is what keeps the app's frame on its own origin. -->
<iframe id="app" title="The app" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-pointer-lock allow-downloads"></iframe><script>
(() => {
  'use strict';
  // devteam's preview lens. It is on the app's own origin, so it can read the app's page. It frames
  // the app, and answers the viewer that frames it, over postMessage, about what is where. It takes
  // only the viewer's questions (hello, hit, resolve, scroll-by, scroll-to, go), tells it only about
  // the app (ready, route, hit-reply, rects, key, errors), and holds nothing of the owner's.
  const CAPS = { selector: 200, tag: 40, role: 40, text: 80, name: 80, html: 1024, route: 300, error: 200, errors: 3 };
  const WATCH_MAX = 200;
  const KEY_MAX = 120;
  const frame = document.getElementById('app');
  const enc = new TextEncoder();
  const size = (s) => enc.encode(s).length;
  // at most n bytes of UTF-8, never half a character
  const cap = (s, n) => {
    const str = String(s == null ? '' : s);
    if (size(str) <= n) return str;
    let out = '';
    let b = 0;
    for (const c of str) { const k = size(c); if (b + k > n) break; out += c; b += k; }
    return out;
  };
  const capDots = (s, n) => (size(s) <= n ? s : cap(s, n - 3) + '\u2026');
  const oneLine = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const num = (v) => typeof v === 'number' && isFinite(v);
  const idOk = (id) => (typeof id === 'string' && id.length > 0 && id.length <= 64) || (Number.isInteger(id) && id >= 0);

  // --- the viewer: the page that frames this one, and only it ----------------------------------
  // This page's frame-ancestors says who that may be. Here: a message must come from that frame
  // (never the app, which shares this origin), and from the origin first heard.
  let viewer = null;
  const tell = (m) => { if (viewer) parent.postMessage(Object.assign({ lens: 1 }, m), viewer); };

  // --- the app ----------------------------------------------------------------------------------
  const appWindow = () => { try { const w = frame.contentWindow; return w && w.document && w.location.href !== 'about:blank' ? w : null; } catch (e) { return null; } };
  const routeOf = (w) => { try { return w.location.origin === location.origin ? cap(w.location.pathname + w.location.search + w.location.hash, CAPS.route) : null; } catch (e) { return null; } };
  // a path on this origin, and never the lens's own
  const safeRoute = (r) => {
    if (typeof r !== 'string' || r[0] !== '/' || r[1] === '/' || r.indexOf('\\') >= 0 || size(r) > 2048) return null;
    try { const u = new URL(r, location.origin); return u.origin === location.origin && u.pathname.indexOf('/.devteam/') !== 0 ? u.pathname + u.search + u.hash : null; } catch (e) { return null; }
  };

  // --- what is where ------------------------------------------------------------------------------
  // an id or a class a person wrote, not one a build made (digit runs, hashes, React's :r1:)
  const plain = (s) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(s) && !/[0-9]{3,}/.test(s) && !s.split(/[-_]/).some((p) => p.length >= 5 && /[0-9]/.test(p) && /[A-Za-z]/.test(p));
  const only = (doc, sel) => { try { return doc.querySelectorAll(sel).length === 1; } catch (e) { return false; } };
  const quoted = (v) => '"' + String(v).replace(/["\\]/g, '\\$&') + '"';
  const selectorOf = (el, doc) => {
    const tag = el.localName;
    if (el.id && plain(el.id) && only(doc, '#' + CSS.escape(el.id))) return '#' + CSS.escape(el.id);
    for (const [n, ok] of [['data-testid', true], ['name', /^(input|select|textarea|button|form)$/.test(tag)], ['aria-label', true]]) {
      const v = el.getAttribute(n);
      const sel = v ? tag + '[' + n + '=' + quoted(v) + ']' : '';
      if (ok && v && size(sel) <= CAPS.selector && only(doc, sel)) return sel;
    }
    const steps = [];
    for (let e = el; e && e.nodeType === 1 && e !== doc.documentElement && steps.length < 6; e = e.parentElement) {
      if (e !== el && e.id && plain(e.id) && only(doc, '#' + CSS.escape(e.id))) { steps.unshift('#' + CSS.escape(e.id)); break; }
      let n = 1;
      for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (s.localName === e.localName) n += 1;
      steps.unshift(e.localName + Array.prototype.filter.call(e.classList, plain).slice(0, 2).map((c) => '.' + CSS.escape(c)).join('') + ':nth-of-type(' + n + ')');
    }
    while (steps.length > 1 && size(steps.join(' > ')) > CAPS.selector) steps.shift();
    return cap(steps.join(' > '), CAPS.selector);
  };
  const ROLES = { button: 'button', select: 'combobox', textarea: 'textbox', img: 'img', nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo', form: 'form', table: 'table', ul: 'list', ol: 'list', li: 'listitem', dialog: 'dialog', aside: 'complementary', section: 'region', option: 'option', summary: 'button' };
  const INPUTS = { checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', image: 'button', range: 'slider', search: 'searchbox' };
  const roleOf = (el) => {
    const r = el.getAttribute('role');
    if (r) return r;
    const t = el.localName;
    if (t === 'a') return el.hasAttribute('href') ? 'link' : '';
    if (t === 'input') return INPUTS[(el.getAttribute('type') || 'text').toLowerCase()] || 'textbox';
    if (/^h[1-6]$/.test(t)) return 'heading';
    return ROLES[t] || '';
  };
  const nameOf = (el, doc) => {
    const label = el.getAttribute('aria-label');
    if (label) return label;
    const by = el.getAttribute('aria-labelledby');
    const named = by ? by.split(/\s+/).map((id) => { const x = doc.getElementById(id); return x ? x.textContent : ''; }).join(' ') : '';
    if (oneLine(named)) return named;
    if (el.labels && el.labels.length) return el.labels[0].textContent;
    for (const n of ['alt', 'title', 'placeholder']) { const v = el.getAttribute(n); if (v) return v; }
    return el.textContent;
  };
  // the element with its own children, each child's contents collapsed to an ellipsis
  const htmlOf = (el) => {
    const top = el.cloneNode(false);
    let k = 0;
    for (const c of el.childNodes) {
      if (++k > 50) { top.appendChild(el.ownerDocument.createTextNode('\u2026')); break; }
      if (c.nodeType === 3) top.appendChild(c.cloneNode(false));
      else if (c.nodeType === 1) { const d = c.cloneNode(false); if (c.firstChild) d.textContent = '\u2026'; top.appendChild(d); }
    }
    return capDots(top.outerHTML, CAPS.html);
  };
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const textOf = (el) => cap(oneLine(el.textContent), CAPS.text);
  const anchorOf = (el, doc, x, y) => {
    const rect = rectOf(el);
    return { selector: selectorOf(el, doc), tag: cap(el.localName, CAPS.tag), role: cap(roleOf(el), CAPS.role), text: textOf(el), name: cap(oneLine(nameOf(el, doc)), CAPS.name), html: htmlOf(el), rect, point: { x: Math.round(x - rect.x), y: Math.round(y - rect.y) } };
  };
  // Where an anchor is now: by its selector (changed: with other text now), else an element of its
  // tag with its text, the nearest to where it was.
  const find = (doc, a) => {
    let el = null;
    try { el = doc.querySelector(a.selector); } catch (e) { el = null; }
    if (el) { const t = textOf(el); return { el, changed: typeof a.text === 'string' && t !== a.text, text: t }; }
    if (typeof a.text !== 'string' || !a.text || typeof a.tag !== 'string' || !/^[a-z][a-z0-9-]*$/.test(a.tag)) return null;
    const was = a.rect && num(a.rect.x) && num(a.rect.y) ? a.rect : { x: 0, y: 0 };
    const all = doc.getElementsByTagName(a.tag);
    let best = null;
    let far = Infinity;
    for (let i = 0; i < all.length && i < 5000; i++) {
      if (textOf(all[i]) !== a.text) continue;
      const r = all[i].getBoundingClientRect();
      const d = Math.hypot(r.left - was.x, r.top - was.y);
      if (d < far) { far = d; best = all[i]; }
    }
    return best ? { el: best, changed: false, text: a.text } : null;
  };

  // --- what the viewer watches: sent when it moves --------------------------------------------
  let watched = [];
  let sent = '';
  const sendRects = (id) => {
    const w = appWindow();
    const rects = watched.map((x) => { const f = w ? find(w.document, x.anchor) : null; return f ? { key: x.key, rect: rectOf(f.el), changed: f.changed, text: f.text } : { key: x.key, rect: null }; });
    const now = JSON.stringify(rects);
    if (id === undefined && now === sent) return;
    sent = now;
    tell(id === undefined ? { type: 'rects', rects } : { type: 'rects', id, rects });
  };
  let framePending = false;
  const soon = () => { if (framePending || !watched.length) return; framePending = true; requestAnimationFrame(() => { framePending = false; sendRects(); }); };
  let settle = 0;
  const later = () => { if (!watched.length) return; clearTimeout(settle); settle = setTimeout(() => sendRects(), 100); };

  // --- what the app does: its route, its keys, its errors ----------------------------------------
  let route = null;
  const checkRoute = () => { const w = appWindow(); const r = w ? routeOf(w) : null; if (r === route) return; route = r; tell({ type: 'route', route: r }); soon(); };
  let errors = [];
  const describe = (x) => { try { return x && typeof x === 'object' && 'message' in x ? String(x.message) : String(x); } catch (e) { return 'an error'; } };
  const noteError = (text) => { const one = cap(oneLine(text), CAPS.error); if (!one) return; errors = errors.concat(one).slice(-CAPS.errors); tell({ type: 'errors', errors }); };
  let shiftDown = false;
  const onKey = (e) => {
    if (e.key !== 'Shift' && e.key !== 'Escape') return;
    shiftDown = e.type === 'keydown' ? e.key === 'Shift' || e.shiftKey : e.key !== 'Shift' && e.shiftKey;
    tell({ type: 'key', key: e.key, shift: shiftDown });
  };
  const onBlur = () => { if (shiftDown) { shiftDown = false; tell({ type: 'key', key: 'Shift', shift: false }); } };
  const readyOf = (w) => (w ? { type: 'ready', route: routeOf(w), title: cap(oneLine(w.document.title), CAPS.text), viewport: { w: w.innerWidth, h: w.innerHeight } } : { type: 'ready', route: null, title: '', viewport: null });
  // Each page the app loads is a new window: listen on it, in the capture phase so the app can't stop
  // a key reaching here, and note the errors it logs from then on.
  let attached = null;
  const attach = () => {
    const w = appWindow();
    if (!w || w.document === attached) return;
    attached = w.document;
    errors = [];
    try {
      w.addEventListener('keydown', onKey, true);
      w.addEventListener('keyup', onKey, true);
      w.addEventListener('blur', onBlur);
      w.addEventListener('error', (e) => { if (e && e.message) noteError(e.message); }, true);
      w.addEventListener('unhandledrejection', (e) => noteError('Unhandled rejection: ' + describe(e.reason)));
      const own = w.console && w.console.error;
      if (typeof own === 'function') w.console.error = function () { noteError(Array.prototype.map.call(arguments, describe).join(' ')); return own.apply(this, arguments); };
      w.addEventListener('scroll', soon, true);
      w.addEventListener('resize', soon);
      w.addEventListener('popstate', checkRoute);
      w.addEventListener('hashchange', checkRoute);
      new w.MutationObserver(later).observe(w.document, { subtree: true, childList: true, attributes: true, characterData: true });
    } catch (e) { /* a page that can't be watched is still framed */ }
    route = routeOf(w);
    tell(readyOf(w));
    sendRects();
  };

  // --- the viewer's questions ----------------------------------------------------------------------
  let last = { x: 0, y: 0 };
  const ORDERS = {
    hello: () => { tell(readyOf(appWindow())); if (errors.length) tell({ type: 'errors', errors }); },
    hit: (m) => {
      if (!idOk(m.id) || !num(m.x) || !num(m.y)) return;
      const w = appWindow();
      const doc = w && w.document;
      let el = doc ? doc.elementFromPoint(m.x, m.y) : null;
      // the page itself is no thing to point at: the viewer pins the point instead
      if (el && (el === doc.documentElement || el === doc.body)) el = null;
      last = { x: m.x, y: m.y };
      const anchor = el ? anchorOf(el, doc, m.x, m.y) : null;
      tell({ type: 'hit-reply', id: m.id, anchor, rect: anchor ? anchor.rect : null, route: w ? routeOf(w) : null });
    },
    resolve: (m) => {
      if (!idOk(m.id) || !Array.isArray(m.anchors)) return;
      watched = m.anchors.slice(0, WATCH_MAX).filter((x) => x && typeof x.key === 'string' && size(x.key) <= KEY_MAX && x.anchor && typeof x.anchor === 'object' && typeof x.anchor.selector === 'string' && size(x.anchor.selector) <= CAPS.selector).map((x) => ({ key: x.key, anchor: x.anchor }));
      sendRects(m.id);
    },
    'scroll-by': (m) => {
      const w = appWindow();
      if (!w) return;
      const step = (v) => (num(v) ? Math.max(-10000, Math.min(10000, v)) : 0);
      const at = num(m.x) && num(m.y) ? { x: m.x, y: m.y } : last;
      // the box under the pointer that scrolls, else the page
      for (let el = w.document.elementFromPoint(at.x, at.y); el && el !== w.document.body && el !== w.document.documentElement; el = el.parentElement) {
        const s = w.getComputedStyle(el);
        if (/(auto|scroll|overlay)/.test(s.overflowY + ' ' + s.overflowX) && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) { el.scrollBy(step(m.dx), step(m.dy)); return; }
      }
      w.scrollBy(step(m.dx), step(m.dy));
    },
    'scroll-to': (m) => {
      const w = appWindow();
      const a = m.anchor;
      if (!w || !a || typeof a !== 'object' || typeof a.selector !== 'string' || size(a.selector) > CAPS.selector) return;
      const f = find(w.document, a);
      if (f) f.el.scrollIntoView({ block: 'center', inline: 'nearest' });
    },
    go: (m) => { const r = safeRoute(m.route); if (r) frame.src = r; },
  };
  addEventListener('message', (e) => {
    if (!e.isTrusted) return;
    if (e.source !== parent || parent === window) return;
    if (e.origin === location.origin || e.origin === 'null') return;
    const ancestors = location.ancestorOrigins;
    if (ancestors && ancestors.length && ancestors[0] !== e.origin) return;
    if (viewer && e.origin !== viewer) return;
    const m = e.data;
    if (!m || typeof m !== 'object' || m.lens !== 1 || typeof m.type !== 'string' || !Object.prototype.hasOwnProperty.call(ORDERS, m.type)) return;
    viewer = e.origin;
    try { ORDERS[m.type](m); } catch (err) { /* one bad question costs only itself */ }
  });
  addEventListener('keydown', onKey, true);
  addEventListener('keyup', onKey, true);
  // the poll can find a page mid-parse (no title yet): its load says ready again, whatever attach did
  frame.addEventListener('load', () => { attach(); const w = appWindow(); if (w) tell(readyOf(w)); checkRoute(); });
  // an SPA's pushState can't be seen without touching its code: the route is polled
  setInterval(() => { attach(); checkRoute(); }, 250);
  setInterval(() => { if (watched.length) sendRects(); }, 1000);
  frame.src = safeRoute(new URLSearchParams(location.search).get('route')) || '/';
})();
</script></body></html>
`;
// The lens's policy: its one script and its one style by hash, its own origin to frame, and who may hold it.
const lensPart = (tag) => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(PREVIEW_LENS)[1];
const lensHash = (tag) => `'sha256-${crypto.createHash('sha256').update(lensPart(tag)).digest('base64')}'`;
export const previewLensCsp = (ancestors) => `default-src 'none'; script-src ${lensHash('script')}; style-src ${lensHash('style')}; frame-src 'self'; frame-ancestors ${ancestors}; base-uri 'none'; form-action 'none'`;
// What the hub page marks with "!" (a supervisor at a usage limit, the operator's box-alert), pushed
// when it turns up or changes, so it needs no page open. The list is checked as the Inbox counts are,
// and capped; one alert on every repo's tab is one push.
const ALERT_MAX = 200;
export function alertNews(seen, instances, ports, resting = new Set()) {
  const list = listedByRoot(instances, ports);
  const next = {};
  const fresh = new Map();
  for (const x of list) {
    if (typeof x.alert !== 'string' || !x.alert) continue;
    const text = wellFormed(x.alert.trim().slice(0, ALERT_MAX));
    if (!text) continue;
    next[x.root] = text;
    if (seen[x.root] !== text && !resting.has(`alert:${text}`)) (fresh.get(text) ?? fresh.set(text, []).get(text)).push(wellFormed(String(x.name ?? x.root).slice(0, 80)));
  }
  let messages = [...fresh.entries()].map(([text, names]) => ({ title: `Box alert (${names.join(', ').slice(0, 80)})`, body: text, tag: wellFormed(`devteam-alert-${crypto.createHash('sha1').update(text).digest('hex').slice(0, 12)}`), url: '/' }));
  const keys = [...fresh.keys()].map((t) => `alert:${t}`);
  if (messages.length > PUSH_BURST) messages = [{ title: `${messages.length} alerts on this box`, body: [...fresh.keys()].join(' · ').slice(0, ALERT_MAX), tag: 'devteam-alerts', url: '/' }];
  return { seen: next, messages, keys };
}

// What the hub page would notify about, from two reads of the list: an Inbox that went up (an
// instance not seen before counts from nothing). Whatever holds the hub's port wrote this list, so
// it is checked as the page checks it, and kept short.
export function inboxNews(seen, instances, ports, resting = new Set()) {
  const list = listedByRoot(instances, ports);
  const named = new Map();
  for (const x of list) named.set(x.name, (named.get(x.name) ?? 0) + 1);
  const next = { ...seen };
  let messages = [];
  const roots = [];
  const names = [];
  for (const x of list) {
    try {
      // a root that just notified is left as it was, rises and falls alike, until it has rested
      if (!Number.isInteger(x.inbox) || x.inbox < 0 || resting.has(x.root)) continue;
      const before = Object.hasOwn(seen, x.root) ? seen[x.root] : 0;
      next[x.root] = x.inbox;
      if (x.inbox <= before) continue;
      const name = wellFormed(String(x.name ?? x.root).slice(0, 80));
      // the hub page's address for this tab (its keyOf): two of one name are told apart by their root
      const key = named.get(x.name) > 1 ? `${String(x.name)}-${crypto.createHash('sha1').update(x.root).digest('hex').slice(0, 6)}` : String(x.name);
      const url = `/#${encodeURIComponent(wellFormed(key))}`;
      messages.push({ title: `${name}: ${x.inbox - before} new in the Inbox`, body: wellFormed(x.root.slice(0, 200)), tag: wellFormed(`devteam-${x.root}`.slice(0, 256)), url: url.length > PUSH_URL_MAX ? '/' : url });
      roots.push(x.root);
      names.push(name);
    } catch {}
  }
  if (messages.length > PUSH_BURST) messages = [{ title: `${messages.length} instances have new Inbox items`, body: wellFormed(names.join(', ').slice(0, 200)), tag: 'devteam-inbox', url: '/' }];
  // only what's no longer listed is forgotten, oldest first: a live root forgotten would be all news again
  const live = new Set(list.map((x) => x.root));
  let over = Object.keys(next).length - PUSH_SEEN_MAX;
  for (const k of Object.keys(next)) {
    if (over <= 0) break;
    if (!live.has(k)) { delete next[k]; over -= 1; }
  }
  return { seen: next, messages, roots };
}

// --- installing the hub: its manifest, icons and service worker ----------------------------------
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
// A white "d" on black: drawn here so the image needs no file of its own.
export function iconPng(size) {
  const lit = (x, y) => { const d = Math.hypot(x - 0.46, y - 0.6); return (d <= 0.22 && d >= 0.12) || (x >= 0.58 && x <= 0.68 && y >= 0.2 && y <= 0.8); };
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let on = 0;
    for (const i of [1, 3, 5]) for (const j of [1, 3, 5]) if (lit((x + i / 6) / size, (y + j / 6) / size)) on++;
    raw.fill(Math.round((on / 9) * 255), y * (size * 3 + 1) + 1 + x * 3, y * (size * 3 + 1) + 4 + x * 3);
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const ICON_SIZES = [180, 192, 512];
const MANIFEST = JSON.stringify({ name: 'devteam', short_name: 'devteam', start_url: '/', scope: '/', display: 'standalone', background_color: '#000000', theme_color: '#000000', icons: ICON_SIZES.map((n) => ({ src: `/icon-${n}.png`, sizes: `${n}x${n}`, type: 'image/png' })) });
// It shows every push (iOS ends a subscription that pushes without showing) and opens the tab the
// notification names. It has no fetch handler, so it never stands between a page and the box.
const SERVICE_WORKER = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch {}
  e.waitUntil(self.registration.showNotification(d.title || 'devteam: new in the Inbox', { body: d.body, tag: d.tag, data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data.url, self.location.origin);
  e.waitUntil((async () => {
    const hub = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).find((c) => ['/', '/index.html'].includes(new URL(c.url).pathname));
    if (!hub) return self.clients.openWindow(url.href);
    try { await hub.focus(); } catch {}
    hub.postMessage({ hash: url.hash });
  })());
});
`;
const iconCache = new Map();
const INSTALL = Object.assign(Object.create(null), {
  '/manifest.webmanifest': { type: 'application/manifest+json', body: () => MANIFEST },
  '/sw.js': { type: 'text/javascript; charset=utf-8', body: () => SERVICE_WORKER },
  ...Object.fromEntries(ICON_SIZES.map((n) => [`/icon-${n}.png`, { type: 'image/png', body: () => { if (!iconCache.has(n)) iconCache.set(n, iconPng(n)); return iconCache.get(n); } }])),
});

// --- public artifacts: what the owner published, served to anyone from the gateway's own copy ---
// The kit's rules for serving an artifact, kept here because the gateway runs apart from any
// checkout: its type map, its CDN list, its path rule and its policy. A test compares each with the
// kit's, so a change there fails until it is made here too (and the box deploys with it).
export const PUBLIC_TYPES = Object.assign(Object.create(null), { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream', wasm: 'application/wasm', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', csv: 'text/plain; charset=utf-8' });
export const PUBLIC_CDNS = ['https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net', 'https://unpkg.com'];
export const publicPathOk = (p) => /^[A-Za-z0-9._/-]+$/.test(p) && p.split('/').every((s) => s && !s.startsWith('.'));
// The kit's artifact policy, its own folder as self, framed by nothing. The sandbox (no
// allow-same-origin) makes the page an opaque origin, so it can't read or write the box's cookies.
// frame-src 'none' is load-bearing too: an instance's viewer and published trees accept the public
// name as a frame ancestor (viewerGranted, treeGranted), and frame-ancestors matches by URL, not
// origin, so a published page that could frame would satisfy it, sandbox or not. A test pins both.
export const publicCsp = (self) => {
  const cdns = PUBLIC_CDNS.join(' ');
  return [
    "default-src 'none'", `script-src 'unsafe-inline' 'unsafe-eval' ${self} ${cdns}`, `style-src 'unsafe-inline' ${self} ${cdns} https://fonts.googleapis.com`, `font-src ${self} ${cdns} https://fonts.gstatic.com data:`,
    `img-src ${self} data: blob:`, `media-src ${self} data: blob:`, `connect-src ${self} ${cdns}`, `worker-src ${self} blob:`, "frame-src 'none'", "form-action 'none'", "base-uri 'none'",
    "frame-ancestors 'none'", 'sandbox allow-scripts allow-forms allow-modals allow-pointer-lock',
  ].join('; ');
};
// The frame-ancestors directive of each policy in a header (several arrive joined by ", "), with
// what precedes it and the list it names.
const FRAME_ANCESTORS = /(^|[;,])(\s*)frame-ancestors(?=[\s;,]|$)([^;,]*)/gi;
// One more origin that may frame the page, in every policy that names who may. A page that says no
// one, or says nothing, is left as it is: adding a directive where there was none would narrow it.
export const addFrameAncestor = (csp, origin) => csp.replace(FRAME_ANCESTORS, (all, sep, sp, list) => (!list.trim() || /^\s*'none'\s*$/i.test(list) ? all : `${sep}${sp}frame-ancestors ${list.trim()} ${origin}${/\s$/.test(list) ? ' ' : ''}`));
// Who may frame the page, replaced in every policy that says. A policy that doesn't say gets nothing.
export const replaceFrameAncestors = (csp, sources) => csp.replace(FRAME_ANCESTORS, (all, sep, sp, list) => `${sep}${sp}frame-ancestors ${sources}${/\s$/.test(list) ? ' ' : ''}`);
export const LINK_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
// a project's name, as the kit requires it for publishing: part of every public URL
export const PROJECT = /^[a-z0-9][a-z0-9._-]{0,62}$/;
export const TREE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
export const FILE_MAX = 8 * 1024 * 1024;
export const ARTIFACT_MAX = 25 * 1024 * 1024;
const MANIFEST_KEYS = ['public', 'project', 'slug', 'title', 'summary', 'root', 'tree', 'files', 'recorded'];
const hex256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
// at most n of fn at a time, the answers in the items' order
async function mapPool(items, n, fn) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }
// The kit's canonical JSON: the owner confirms a manifest by its sha256, so both sides hash one text.
export const canonicalJson = (v) => (Array.isArray(v) ? `[${v.map(canonicalJson).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}` : JSON.stringify(v));
// Whatever holds an instance's port wrote this, so it is checked as untrusted data, and only then
// shown (escaped) or followed: every path the kit would serve, every size within the kit's limits.
export function manifestProblem(m, slug) {
  if (!m || typeof m !== 'object' || Array.isArray(m) || m.public !== 1) return 'not a manifest';
  const extra = Object.keys(m).find((k) => !MANIFEST_KEYS.includes(k));
  if (extra) return `unknown key "${extra.slice(0, 40)}"`;
  if (typeof m.project !== 'string' || !PROJECT.test(m.project)) return 'the project name is not one a public link can carry';
  if (typeof m.root !== 'string' || !m.root.startsWith('/') || m.root.length > 1024 || /[\u0000-\u001f\u007f]/.test(m.root)) return 'root is not an absolute path';
  if (m.slug !== slug) return `the manifest is for ${String(m.slug).slice(0, 80)}, not ${slug}`;
  if (typeof m.tree !== 'string' || !TREE.test(m.tree)) return 'tree is not a git tree id';
  // what the instance's log says was last published: shown as that, and never relied on
  if (m.recorded !== undefined && (!m.recorded || typeof m.recorded !== 'object' || Array.isArray(m.recorded) || typeof m.recorded.tree !== 'string' || !TREE.test(m.recorded.tree) || typeof m.recorded.at !== 'string' || m.recorded.at.length > 40)) return 'recorded is not a tree and a date';
  if (typeof m.title !== 'string' || m.title.length > 120 || typeof m.summary !== 'string' || m.summary.length > 500) return 'title or summary is not the kit\'s one line of text';
  const files = m.files && typeof m.files === 'object' && !Array.isArray(m.files) ? Object.entries(m.files) : [];
  if (!files.length || files.length > 2000) return 'a manifest lists 1 to 2000 files';
  let total = 0;
  for (const [rel, f] of files) {
    if (!publicPathOk(rel)) return `${rel.slice(0, 120)}: not a path the kit serves`;
    if (!f || typeof f !== 'object' || typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256) || !Number.isInteger(f.size) || f.size < 0 || f.size > FILE_MAX || !['100644', '100755'].includes(f.mode)) return `${rel}: a bad entry (sha256, a size up to 8 MB, mode 100644 or 100755)`;
    total += f.size;
  }
  if (total > ARTIFACT_MAX) return 'over 25 MB in all';
  if (!Object.hasOwn(m.files, 'index.html')) return 'no index.html';
  return null;
}
// git's own object ids, from the bytes: the record then names a tree git can check against main.
export const gitBlobId = (buf, algo = 'sha1') => crypto.createHash(algo).update(`blob ${buf.length}\0`).update(buf).digest('hex');
export function gitTreeId(files, algo = 'sha1') {
  const root = new Map();
  for (const [rel, f] of Object.entries(files)) {
    const parts = rel.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.has(parts[i])) node.set(parts[i], new Map());
      node = node.get(parts[i]);
      if (!(node instanceof Map)) throw new Error(`${parts.slice(0, i + 1).join('/')} is both a file and a folder`);
    }
    if (node.get(parts.at(-1)) instanceof Map) throw new Error(`${rel} is both a file and a folder`);
    node.set(parts.at(-1), f);
  }
  // git sorts a tree's entries by name, a folder's name as if it ended in "/"
  const write = (node) => {
    const entries = [...node].map(([name, v]) => (v instanceof Map ? { name, key: `${name}/`, mode: '40000', oid: write(v) } : { name, key: name, mode: v.mode, oid: v.oid }));
    entries.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
    const body = Buffer.concat(entries.flatMap((e) => [Buffer.from(`${e.mode} ${e.name}\0`), Buffer.from(e.oid, 'hex')]));
    return crypto.createHash(algo).update(`tree ${body.length}\0`).update(body).digest('hex');
  };
  return write(root);
}
// The published bytes, content-addressed under the gateway's own directory (no agent can write
// there), and the one queue every change to them and to state.json's public map runs through.
export function publicStore(dir) {
  const blobs = path.join(dir, 'public', 'blobs');
  const blobPath = (sha) => path.join(blobs, sha);
  let queue = Promise.resolve();
  const referenced = (pub) => {
    const m = new Map();
    for (const p of Object.values(pub ?? {})) for (const a of Object.values(p?.artifacts ?? {})) for (const f of Object.values(a?.files ?? {})) m.set(f.sha256, f.size);
    return m;
  };
  return {
    blobs,
    blobPath,
    serial: (fn) => { const run = queue.then(() => fn()); queue = run.catch(() => {}); return run; },
    referenced,
    write: (sha, buf) => {
      if (fs.existsSync(blobPath(sha))) return false;
      fs.mkdirSync(blobs, { recursive: true, mode: 0o700 });
      const tmpFile = `${blobPath(sha)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
      fs.writeFileSync(tmpFile, buf, { mode: 0o600 });
      fs.renameSync(tmpFile, blobPath(sha));
      return true;
    },
    // only ever inside the queue, so no temp file is still being written
    sweep: (pub) => {
      const keep = referenced(pub);
      let names = [];
      try { names = fs.readdirSync(blobs); } catch { return; }
      for (const n of names) if (!keep.has(n)) fs.rmSync(path.join(blobs, n), { force: true });
    },
  };
}

// --- files dropped on the terminal ---------------------------------------------------------------
const UPLOAD_MAX = 512 * 1024 * 1024; // a file, and so a request: each file is a request of its own
const UPLOAD_TOTAL = 4 * 1024 * 1024 * 1024;
const UPLOAD_FREE = 1024 * 1024 * 1024; // left on the disk for the agents, whatever is dropped
const UPLOAD_KEEP_MS = 7 * 24 * 3600 * 1000;
const UPLOAD_STALL_MS = 60 * 1000;
const UPLOAD_SWEEP_MS = 3600 * 1000;
const UPLOAD_NAME = 200;
const UPLOAD_PART = '.part';
const UPLOAD_FOLDER = /^\d{4}-\d{2}-\d{2}-[0-9a-f]{24}$/;
// Node's limit on a whole request is five minutes, too short for a big file on a slow line, and it
// is one setting for the server. So the server's is the upload's, and every other body keeps those
// five minutes by a timer of its own (BODY_MS). A stalled upload goes sooner (UPLOAD_STALL_MS).
const REQUEST_MS = 3600 * 1000;
const BODY_MS = 5 * 60 * 1000;
// The name a dropped file is stored under: its own, reduced to letters, digits, '.', '-' and '_',
// so its path needs no quoting wherever it's pasted, and a program that recognises an image by its
// path (Claude Code, which attaches it) sees a plain one. It can't leave its folder, or be hidden.
export function safeUploadName(raw) {
  const base = String(raw ?? '').split(/[/\\]/).pop().normalize('NFD').replace(/[\p{M}\p{Cc}\p{Cf}]/gu, '');
  const plain = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^\.+|[.-]+$/g, '');
  const dot = plain.lastIndexOf('.');
  const ext = dot >= 0 && plain.length - dot <= 17 ? plain.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, '') : '';
  // the extension first: a name that's all replaced characters still comes out an image
  const stem = (ext ? plain.slice(0, dot) : plain).replace(/^[._-]+/, '').slice(0, UPLOAD_NAME).replace(/[.-]+$/, '');
  return `${stem || 'file'}${ext.length > 1 ? ext : ''}`;
}
// These run in the terminal's page too (TERM_DROP has their source), and are tested here.
// A stored path never needs the quotes; they're for whatever else this is ever handed.
export function shellQuote(s) {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}
export function dropPaste(paths) {
  return paths.map(shellQuote).join(' ');
}
// What follows the paste: a space, so what the owner types next doesn't run into a path. Not after
// images alone: Claude Code turns those into attachments, and it has no path left to separate.
export function isDropImage(p) {
  return /\.(png|jpe?g|gif|webp)$/i.test(p);
}
export function dropSpace(paths) {
  return paths.some((p) => !isDropImage(p));
}
// What the owner is told after a drop. The paths stay on screen: a paste can still go astray.
export function dropNote(paths) {
  const images = paths.filter(isDropImage).length;
  const how = images === paths.length ? 'images arrive as attachments' : images ? 'images arrive as attachments, PDFs and other files as a path' : 'PDFs and other files arrive as a path';
  return `Sent to the focused pane. In Claude Code, ${how}.\n${paths.join('\n')}`;
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
  // A preview's name, one label directly under the box's, on the wildcard DNS and certificate it has.
  const previewOf = (host) => {
    const m = /^([a-z0-9-]+)\.(.+)$/.exec(String(host ?? ''));
    return m && m[2] === `${NAME}${SUFFIX}` && PREVIEW_NAME.test(m[1]) ? m[1] : null;
  };
  const previewOrigin = (name) => `${pubUrl.protocol}//${name}.${NAME}${SUFFIX}`;
  // Who may hold a preview's lens: frame-ancestors is checked against every ancestor, so the hub
  // (which frames a dashboard) as well as each instance (whose viewer frames the lens). The lens is
  // the same bytes and policy on every preview's name, as the kit's relay serves it, and neither can
  // know which instance a name is for. The app inside it can: its own policy (downstreamHeaders)
  // names only the instance that lists the preview, so a lens held by any other gets an empty frame.
  const LENS_CSP = previewLensCsp([PUB, ...BLOCK.map(instanceOrigin)].join(' '));
  // Passkeys belong to the box's name. A page on an instance's subdomain may ask for one, but its
  // answer names that page's origin, and only an answer from the box's own origin is accepted.
  const RP_ID = NAME;
  const TERM = `${pubUrl.protocol}//term.${pubUrl.host}`;
  const termHost = new URL(TERM).host;
  // What the owner published, to anyone. Under the box's wildcard name like term., and never an
  // instance's: those are all digits.
  const PUBLIC = `${pubUrl.protocol}//public.${pubUrl.host}`;
  const publicHost = new URL(PUBLIC).host;
  // Parsed once, before anything else starts: a cap that isn't a number would compare false
  // against every total and publish without limit, so a bad one stops the gateway instead.
  const maxSet = opts.publicMax ?? env.DEVTEAM_PUBLIC_MAX;
  const PUBLIC_MAX = maxSet === undefined ? 500 * 1024 * 1024 : Number(maxSet);
  if (!Number.isFinite(PUBLIC_MAX) || PUBLIC_MAX <= 0) throw new Error('DEVTEAM_PUBLIC_MAX must be a positive number of bytes');
  const COOKIE = 'devteam_session';
  const dir = opts.dir ?? gatewayDir();
  const ttydPort = Number(opts.ttydPort ?? env.DEVTEAM_TTYD_PORT ?? 7681);
  const store = stateStore(dir);
  const firstFile = (...c) => c.find((f) => f && fs.existsSync(f));
  const hubPage = fs.readFileSync(firstFile(opts.hubPage, env.DEVTEAM_HUB_PAGE, path.join(here, 'hub.html'), path.join(here, '..', 'docs', 'devteam', 'dashboard', 'hub.html')));
  const ttydPage = () => fs.readFileSync(opts.ttydPage ?? env.DEVTEAM_TTYD_PAGE ?? path.join(here, 'ttyd.html'));
  const log = opts.log ?? ((m) => process.stdout.write(`gateway: ${m}\n`));
  const uploadsRoot = opts.uploadsDir ?? env.DEVTEAM_UPLOADS_DIR ?? '/data/uploads';
  const uploadMax = opts.uploadMax ?? UPLOAD_MAX;
  const uploadTotal = opts.uploadTotal ?? UPLOAD_TOTAL;
  const uploadFree = opts.uploadFree ?? UPLOAD_FREE;
  const uploadKeepMs = opts.uploadKeepMs ?? UPLOAD_KEEP_MS;
  const uploadStallMs = opts.uploadStallMs ?? UPLOAD_STALL_MS;
  const bodyMs = opts.bodyMs ?? BODY_MS;

  // Unclaimed: the token named in the environment, else one made now and printed once (whoever
  // reads the platform's logs can already open a shell on the box, the root of trust anyway).
  try {
    const s = store.load();
    // made before sign-in moved under /auth (or for another name): the browser won't offer them here
    if (s.passkeys.some((x) => x.rp !== RP_ID)) log(`passkeys made before sign-in moved to ${PUB}/auth (or for another name) can't sign in here: run devteam-reclaim in a shell on the box for a claim link, and claim it again`);
    if (!s.passkeys.length) {
      const given = env.DEVTEAM_CLAIM_TOKEN;
      // a link `reclaim` printed outlives a restart, for its day; the environment's token is only the first
      if (claimLive(s)) log(`unclaimed: open the claim link printed earlier (${PUB}/auth/claim#…), or run devteam-reclaim for a new one`);
      else if (given && given.length >= 32) { store.save({ ...s, claimHash: b64u(sha256(given)), claimExpires: Date.now() + CLAIM_MS }); log(`unclaimed: open ${PUB}/auth/claim#<DEVTEAM_CLAIM_TOKEN> within a day to claim this box with a passkey`); }
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
      if (u.origin === PUB || u.origin === TERM || (u.protocol === pubUrl.protocol && instanceOf(u.host) && u.origin === instanceOrigin(instanceOf(u.host))) || (u.protocol === pubUrl.protocol && previewOf(u.host) && u.origin === previewOrigin(previewOf(u.host)))) return u.href;
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
    if (c.origin !== PUB || c.crossOrigin === true) throw new Error('wrong origin');
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
    return { id: b64u(rawId), userId: issued.userId, jwk, alg, signCount: ad.signCount, name, rp: RP_ID, createdAt: new Date().toISOString() };
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
  const upstreamHeaders = (req, port, publicOrigin, { loopbackHost = '127.0.0.1' } = {}) => {
    const h = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && !k.startsWith('x-forwarded-') && !k.startsWith('fly-') && !k.startsWith('rndr-') && !k.startsWith('render-')) h[k] = v;
    h.host = `${loopbackHost}:${port}`;
    if (req.headers.origin === publicOrigin) h.origin = `http://${loopbackHost}:${port}`;
    const rest = String(req.headers.cookie ?? '').split(';').map((p) => p.trim()).filter((p) => p && p.split('=')[0] !== COOKIE).join('; ');
    if (rest) h.cookie = rest; else delete h.cookie;
    return h;
  };
  const LOOP = /http:\/\/(?:127\.0\.0\.1|localhost):(\d+)/g;
  const mapLoop = (s) => s.replace(LOOP, (all, p) => (Number(p) === HUB_PORT ? PUB : BLOCK.includes(Number(p)) ? instanceOrigin(Number(p)) : all));
  // A preview's own headers: only this link's port, http and ws forms, to its own origin.
  const PREVIEW_LOOP = /\b(http|ws):\/\/(?:127\.0\.0\.1|localhost):(\d+)/g;
  const mapPreview = (s, port, own) => s.replace(PREVIEW_LOOP, (all, scheme, p) => (Number(p) !== port ? all : scheme === 'ws' ? own.replace(/^http/, 'ws') : own));
  // lensOf: for a preview's page framed from its own origin, which is how its lens holds it (spec §7),
  // the instance that lists the preview. For that load alone the app's own framing headers give way,
  // to the lens, the hub and that one instance's dashboard: no other instance's page may hold the app.
  const downstreamHeaders = (h, cap, own, previewPort = null, lensOf = null) => {
    const out = {};
    for (const [k, v] of Object.entries(h)) {
      // x-devteam-public is the gateway's to say (what the box serves); an upstream's copy never passes
      if (['connection', 'keep-alive', 'transfer-encoding', 'strict-transport-security', 'clear-site-data', 'x-devteam-public', 'x-devteam-previews'].includes(k)) continue;
      // nothing behind the gateway sets a cookie for the box's names (the kit sets none at all)
      if (k === 'set-cookie') { const keep = [].concat(v).filter((c) => !/;\s*domain\s*=/i.test(c) && !new RegExp(`^\\s*${COOKIE}\\s*=`).test(c)); if (keep.length) out[k] = keep; continue; }
      out[k] = k !== 'content-security-policy' && k !== 'location' ? v : previewPort ? mapPreview(String(v), previewPort, own) : mapLoop(String(v));
    }
    // an artifact under its capability: its policy stays under it too
    if (cap && out['content-security-policy']) out['content-security-policy'] = out['content-security-policy'].split(`${own}/artifact/`).join(`${own}${cap}/artifact/`);
    // a port off the block is no instance's: then nothing gives way
    if (previewPort && BLOCK.includes(lensOf)) {
      const ancestors = `'self' ${PUB} ${instanceOrigin(lensOf)}`;
      delete out['x-frame-options'];
      const csp = out['content-security-policy'] ? String(out['content-security-policy']) : '';
      if (csp.search(FRAME_ANCESTORS) >= 0) out['content-security-policy'] = replaceFrameAncestors(csp, ancestors);
      // The app said nothing of frames by policy: by X-Frame-Options alone, or not at all (a dev
      // server's default). Either way a policy of its own keeps every other instance's page out.
      else out['content-security-policy'] = `${csp ? `${csp}, ` : ''}frame-ancestors ${ancestors}`;
    }
    return { ...out, ...hsts };
  };
  const proxy = (req, res, { port, path: p, publicOrigin, cap, extra = null, publicFrame = false }) => {
    const up = http.request({ host: '127.0.0.1', port, method: req.method, path: p, headers: upstreamHeaders(req, port, publicOrigin) }, (ur) => {
      // Never kept: a page an agent served once on this name must not come back from the browser's
      // cache after a real dashboard has taken its port.
      const head = downstreamHeaders(ur.headers, cap, publicOrigin);
      if (publicFrame && head['content-security-policy']) head['content-security-policy'] = addFrameAncestor(String(head['content-security-policy']), PUBLIC);
      res.writeHead(ur.statusCode, { ...head, 'cache-control': 'no-store', ...(extra ?? {}) });
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
  // The owner's answer to what an instance's supervisor's terminal asks: the one dashboard request
  // the gateway signs (paneSignature), after the session check, since on a box every agent can send
  // that dashboard any header. The body is read whole (it is small) so its hash is what is signed;
  // whatever signature headers the browser sent are replaced.
  const panePost = (req, res, port, publicOrigin) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size <= 20000) chunks.push(c); else chunks.length = 0; });
    req.on('error', () => res.destroy());
    req.on('end', () => {
      if (size > 20000) return send(res, 400, 'application/json', JSON.stringify({ error: 'missing or invalid fields' }));
      const data = Buffer.concat(chunks);
      const up = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/pane-answer', headers: { ...upstreamHeaders(req, port, publicOrigin), 'content-length': data.length, ...paneSignature(threadKey(store).privateKey, port, data) } }, (ur) => {
        res.writeHead(ur.statusCode, { ...downstreamHeaders(ur.headers, undefined, publicOrigin), 'cache-control': 'no-store' });
        pipeline(ur, res, () => {});
      });
      up.on('error', () => { if (res.headersSent) return res.destroy(); send(res, 502, 'text/plain; charset=utf-8', `Nothing answers on instance ${port}.`); });
      up.end(data);
    });
  };
  // Where a preview's server is listening: a dev server bound to localhost may sit on either family.
  const previewHost = (port) => new Promise((resolve) => {
    const next = (hosts) => {
      if (!hosts.length) return resolve(null);
      const c = net.connect({ port, host: hosts[0], timeout: 300 });
      c.once('connect', () => { c.destroy(); resolve(hosts[0]); });
      c.once('timeout', () => { c.destroy(); next(hosts.slice(1)); });
      c.once('error', () => next(hosts.slice(1)));
    };
    next(['127.0.0.1', '::1']);
  });
  // Never HTML to a fetch or an asset: a dev client must see a failure, not a page it takes for its own.
  const previewUnavailable = (req, res, html) => (navigating(req)
    ? send(res, 503, 'text/html; charset=utf-8', html(), { 'content-security-policy': PAGE_CSP, 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' })
    : send(res, 503, 'text/plain; charset=utf-8', 'this preview is not available right now', { 'retry-after': '5' }));
  // The server is tried on 127.0.0.1, then ::1 when that's refused. The body starts only once a
  // connection is up, so a refused attempt has taken none of it and the retry sends all of it.
  // Only a link the map holds unambiguously gets here (servePreview), with the one instance listing it.
  const proxyPreview = (req, res, name, link, own) => {
    let current = null;
    res.on('close', () => { if (!res.writableFinished) current?.destroy(); });
    const attempt = (hosts) => {
      let connected = false;
      // agent: false, a fresh connection each time: a kept-alive one to a server since stopped would read as a 502, not as down
      const up = http.request({ host: hosts[0], agent: false, port: link.port, method: req.method, path: req.url, headers: upstreamHeaders(req, link.port, own, { loopbackHost: 'localhost' }) }, (ur) => {
        res.writeHead(ur.statusCode, { ...downstreamHeaders(ur.headers, null, own, link.port, req.headers['sec-fetch-dest'] === 'iframe' && req.headers['sec-fetch-site'] === 'same-origin' ? link.instance : null), 'cache-control': 'no-store' });
        pipeline(ur, res, () => {});
      });
      current = up;
      const relay = () => { connected = true; pipeline(req, up, () => {}); };
      up.on('socket', (s) => { if (s.connecting) s.once('connect', relay); else relay(); });
      up.on('error', (e) => {
        if (!connected && e.code === 'ECONNREFUSED' && hosts.length > 1) return attempt(hosts.slice(1));
        if (res.headersSent) return res.destroy();
        if (res.destroyed) return undefined;
        if (!connected) return previewUnavailable(req, res, () => PAGES.previewDown(name, link));
        return send(res, 502, 'text/plain; charset=utf-8', 'that preview\'s server stopped answering');
      });
    };
    attempt(['127.0.0.1', '::1']);
  };
  // After the session check, and no sooner: a name not in the map asks the hub once more, once.
  const servePreview = async (req, res, name, own) => {
    let link = previews.get(name);
    if (!link) { await refreshPreviews(); link = previews.get(name); }
    if (!link) return previewUnavailable(req, res, () => PAGES.previewUnknown(name, [...previews.keys()].sort(), previewOrigin));
    if (link.ambiguous) return previewUnavailable(req, res, () => PAGES.previewAmbiguous(name, link.ambiguous));
    return proxyPreview(req, res, name, link, own);
  };
  // The hub's list is the one thing the box's name takes from behind it, and only as data: whatever
  // holds the port, the page reads JSON and shows it as text. No hub yet is an empty list.
  const hubList = () => new Promise((settle) => {
    let deadline = null;
    const resolve = (v) => { clearTimeout(deadline); settle(v); };
    const none = () => resolve(null);
    const up = http.get({ host: '127.0.0.1', port: HUB_PORT, path: '/instances.json', timeout: 10000, headers: { host: `127.0.0.1:${HUB_PORT}`, 'sec-fetch-site': 'same-origin' } }, (ur) => {
      if (ur.statusCode !== 200) { ur.resume(); return none(); }
      const chunks = [];
      let size = 0;
      ur.on('data', (c) => { size += c.length; if (size > 1024 * 1024) { none(); up.destroy(); } else chunks.push(c); });
      ur.on('end', () => resolve(Buffer.concat(chunks)));
      ur.on('error', none);
      ur.on('close', none);
    });
    up.on('timeout', () => up.destroy());
    up.on('error', none);
    // the whole answer, not only each pause in it: one sent a byte at a time would hold the poller
    deadline = setTimeout(() => { up.destroy(); none(); }, opts.hubDeadlineMs ?? 15000);
  });
  const instances = async (req, res) => send(res, 200, 'application/json', (await hubList()) ?? JSON.stringify({ hub: 1, instances: [] }));
  // The owner's threads with the box's operator (the Overview's dock): the hub keeps them and types
  // each owner turn into the operator's pane, so the box's name passes these few requests to it, after
  // the session check, as the hub's own page would send them on the machine. What comes back is JSON
  // the page shows as text, whatever holds the port; whatever holds it also reads what the owner
  // wrote there, as anything running as the box's user can read the threads' file.
  // Each press is signed (hubSignature), with a key kept with the passkeys: every agent runs as the
  // hub's own Unix user and can send the hub any header, so on a box the hub takes a press only
  // with this signature, checked against the public half the boot gave root (gateway.mjs thread-key).
  const HUB_POSTS = ['thread-new', 'thread-say', 'thread-close', 'thread-reopen', 'start'];
  const hubAsk = (method, p, body = null) => new Promise((settle) => {
    let deadline = null;
    const resolve = (v) => { clearTimeout(deadline); settle(v); };
    const none = () => resolve(null);
    const data = body === null ? null : Buffer.from(JSON.stringify(body));
    const up = http.request({ host: '127.0.0.1', port: HUB_PORT, path: p, method, timeout: 150000, headers: { host: `127.0.0.1:${HUB_PORT}`, 'sec-fetch-site': 'same-origin', ...(data ? { origin: `http://127.0.0.1:${HUB_PORT}`, 'content-type': 'application/json', 'content-length': data.length, ...hubSignature(threadKey(store).privateKey, p, data) } : {}) } }, (ur) => {
      const chunks = [];
      let size = 0;
      ur.on('data', (c) => { size += c.length; if (size > 4 * 1024 * 1024) { none(); up.destroy(); } else chunks.push(c); });
      ur.on('end', () => { try { resolve({ status: ur.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch { resolve({ status: ur.statusCode, json: null }); } });
      ur.on('error', none);
      ur.on('close', none);
    });
    up.on('timeout', () => up.destroy());
    up.on('error', none);
    // a read waits no longer than the list does; a press waits out the owner's command behind it
    deadline = setTimeout(() => { up.destroy(); none(); }, data ? 160000 : opts.hubDeadlineMs ?? 15000);
    up.end(data ?? undefined);
  });
  // An answer the hub gave as JSON goes back as it is, 200 or a refusal with its reason. Anything
  // else (no hub, a hub on a kit from before these threads, something else on the port) is a 502.
  const operatorThreads = async (req, res, action) => {
    let body = null;
    if (action) { body = await readJson(req, 20000); if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'missing or invalid fields' }); }
    const r = await hubAsk(action ? 'POST' : 'GET', action ? `/operator/${action}` : '/operator/threads', body);
    if (r && r.json && typeof r.json === 'object' && !Array.isArray(r.json) && [200, 400].includes(r.status)) return json(res, r.status, r.json);
    return json(res, 502, { error: r ? 'the hub on this box is served by a kit from before threads with the operator' : 'the hub on this box is not answering' });
  };

  // --- previews: the name-to-port map, from the same list ---------------------------------------
  // Nothing is stored: the map is whatever the list said last, and a hub that doesn't answer lists
  // nothing, so a stale name can't keep pointing at a port. A miss after the session check asks the
  // hub once more, with every waiter sharing one read, so no anonymous request can make it poll.
  const ownPort = opts.port ?? null;
  let previews = new Map();
  // Each instance's root and whether its kit has viewers, as the hub's list last said (every poll,
  // PUSH_POLL_MS): the owner wrapper's choice is a lookup in it, so no visit asks anything (spec §8).
  let listed = new Map();
  const takePreviews = (body) => {
    let list = null;
    try { list = JSON.parse(body).instances; } catch {}
    const ok = Array.isArray(list) ? list : [];
    previews = previewLinks(ok, BLOCK, ownPort, ttydPort);
    listed = new Map([...listedByPort(ok, BLOCK)].map(([port, x]) => [port, { root: x.root, viewer: x.viewer === 1 }]));
  };
  let previewRefresh = null;
  const refreshPreviews = () => (previewRefresh ??= hubList().then(takePreviews).finally(() => { previewRefresh = null; }));

  // --- notifications: the gateway reads the hub's list itself, so they need no page open ----------
  // The signing key sits with the passkeys, where no agent can read it. Made the first time it's asked for.
  const vapid = () => {
    const now = store.load();
    if (now.vapid) return now.vapid;
    const jwk = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
    const made = { jwk, publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)])) };
    store.save({ ...now, vapid: made });
    return made;
  };
  const pushFetch = opts.pushFetch ?? fetch;
  const sendPush = async (sub, message) => {
    const { jwk, publicKey } = vapid();
    const r = await pushFetch(sub.endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { authorization: `vapid t=${vapidToken(jwk, new URL(sub.endpoint).origin, PUB)}, k=${publicKey}`, 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '86400', urgency: 'high' },
      body: encryptPush(sub, Buffer.from(JSON.stringify(message))),
    });
    return r.status;
  };
  // Counts are kept on the disk, so a restart, when every dashboard comes back with its Inbox as it
  // was, is not news. Only a read that worked counts: a hub that's down changes nothing.
  let polling = false;
  const lastSent = new Map();
  const pollPush = async () => {
    if (polling) return;
    polling = true;
    try {
      const body = await hubList();
      takePreviews(body);
      let list = null;
      try { list = JSON.parse(body).instances; } catch {}
      if (!Array.isArray(list)) return;
      const before = store.load();
      const now = Date.now();
      for (const [r, t] of lastSent) if (now - t >= PUSH_REST_MS) lastSent.delete(r);
      const { seen, messages: inboxMessages, roots } = inboxNews(before.pushSeen ?? {}, list, BLOCK, new Set(lastSent.keys()));
      const alerts = alertNews(before.pushAlerts ?? {}, list, BLOCK, new Set(lastSent.keys()));
      const messages = [...inboxMessages, ...alerts.messages];
      if (before.pushSubs?.length) for (const r of [...roots, ...alerts.keys]) lastSent.set(r, now);
      if (JSON.stringify(seen) !== JSON.stringify(before.pushSeen ?? {}) || JSON.stringify(alerts.seen) !== JSON.stringify(before.pushAlerts ?? {})) store.save({ ...before, pushSeen: seen, pushAlerts: alerts.seen });
      const subs = before.pushSubs ?? [];
      const dead = new Set();
      const jobs = subs.flatMap((sub) => messages.map((message) => ({ sub, message })));
      const worker = async () => {
        for (let job = jobs.shift(); job; job = jobs.shift()) {
          try {
            const status = await sendPush(job.sub, job.message);
            // the browser dropped it (uninstalled, or notifications turned off)
            if (status === 404 || status === 410) dead.add(job.sub.endpoint);
            else if (status >= 300) log(`a push to ${new URL(job.sub.endpoint).host} was refused (${status})`);
          } catch (e) { log(`a push to ${new URL(job.sub.endpoint).host} failed: ${e.message}`); }
        }
      };
      await Promise.all(Array.from({ length: PUSH_SENDS }, worker));
      if (dead.size) { const now = store.load(); store.save({ ...now, pushSubs: (now.pushSubs ?? []).filter((x) => !dead.has(x.endpoint)) }); }
    } finally { polling = false; }
  };

  const navigating = (req) => req.method === 'GET' && (req.headers['sec-fetch-mode'] === 'navigate' || (!req.headers['sec-fetch-mode'] && String(req.headers.accept ?? '').includes('text/html')));
  // The cookie is SameSite=None, so a page elsewhere (another site, or another name of the box)
  // could make the browser send it with an <img> or <script>, or navigate a frame to the API. Such
  // a request is refused, but for a link to a page and for what a sandboxed review page loads (its
  // opaque origin makes those cross-site too): the kit's two helpers and a committed image. An
  // artifact's files don't need this: they load under a capability in the path (below).
  const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i;
  const PREVIEW_FRAMED = ['iframe', 'frame', 'object', 'embed', 'fencedframe'];
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
  // The folder is main's, a worktree's, or a published tree's (the owner's wrapper shows exactly the
  // version the public sees: spec §8).
  const ARTIFACT = /^\/artifact\/(?:main|wt\/[^/]+|tree\/[0-9a-f]{40}(?:[0-9a-f]{24})?)\/[^/]+\//;
  // An instance's viewer, and an artifact at a published tree, may also be framed by the owner's
  // wrapper on the public name (spec §8). frame-ancestors is checked against every ancestor, and the
  // wrapper is one. Nothing else of an instance's is opened to it. The raw path, as the kit reads it.
  // The viewer, which holds the owner's actions, only under the grant the wrapper put in its frame's
  // URL: this port, this page, this version, for a few minutes, MACed with this process's secret.
  const WRAP_GRANT_MS = 5 * 60 * 1000;
  const wrapMac = (port, slug, at, exp) => b64u(mac('wrap', port, `/view/artifact/${slug}`, at, exp));
  const wrapGrant = (port, slug, at, exp = Date.now() + WRAP_GRANT_MS) => `${exp}.${wrapMac(port, slug, at, exp)}`;
  const viewerGranted = (port, raw, url) => {
    const m = /^\/view\/artifact\/([^/]+)$/.exec(raw);
    if (!m || !LINK_ID.test(m[1]) || url.searchParams.getAll('at').length !== 1 || url.searchParams.getAll('w').length !== 1) return false;
    const w = /^(\d{1,15})\.([\w-]{22})$/.exec(url.searchParams.get('w'));
    const exp = w ? Number(w[1]) : 0;
    if (!w || exp < Date.now() || exp > Date.now() + WRAP_GRANT_MS) return false;
    return sameBytes(Buffer.from(w[2]), Buffer.from(wrapMac(port, m[1], url.searchParams.get('at'), exp)));
  };
  // An artifact's frame inside that viewer, only at a tree this port's binding published for that
  // very page: what it shows is public already, so it needs no grant, and the kit passes none along.
  const treeGranted = (port, raw) => {
    const m = /^\/artifact\/tree\/([0-9a-f]{40}(?:[0-9a-f]{24})?)\/([^/]+)\//.exec(raw);
    if (!m || /\.\.|%2e|%5c|\\/i.test(raw)) return false;
    try { return Object.values(store.load().public ?? {}).some((b) => b?.port === port && Object.hasOwn(b.artifacts ?? {}, m[2]) && b.artifacts[m[2]]?.tree === m[1]); } catch { return false; }
  };
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
  const HUB_CSP = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; img-src 'self'; frame-src ${[TERM, ...BLOCK.map(instanceOrigin)].join(' ')}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
  // ttyd's page has no OSC 52, how tmux and a program in it (Claude Code's fullscreen) put text on
  // the clipboard. This adds it, to write only (a request to read is ignored), and only just after
  // the owner clicked or typed here, so what an agent prints can't quietly replace the clipboard.
  const TERM_CLIPBOARD = Buffer.from(`<script>(() => {
  let at = 0;
  for (const e of ['mouseup', 'keydown']) addEventListener(e, () => { at = Date.now(); }, true);
  const hook = setInterval(() => {
    const t = window.term;
    if (!t || !t.parser) return;
    clearInterval(hook);
    t.parser.registerOscHandler(52, (d) => {
      const b64 = d.slice(d.indexOf(';') + 1);
      if (b64 && b64 !== '?' && Date.now() - at < 3000) {
        try { navigator.clipboard.writeText(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))).catch(() => {}); } catch {}
      }
      return true;
    });
  }, 100);
})();</script>`);
  // ttyd's page drops what's typed or pasted while its socket is down, and gives no sign. So this
  // goes in ahead of its bundle, to note the socket it opens; a paste then waits for a live one.
  // ttyd reconnects without loading the page again, so a tab left open through a deploy keeps the
  // old page, and whatever a new one adds never reaches it. So when its socket closes or comes back
  // this asks which page is current and, if it has changed, loads it: tmux redraws the screen, as it
  // does on a reconnect. It keeps asking while the box is away: ttyd tries once, then waits for Enter.
  // Not while a dropped file is on its way or waiting to paste, once per page (one that still comes
  // back old can't loop), and past ttyd's "leave site?" prompt, which is for the owner's own leaving.
  const TERM_SOCKET = `<script>(() => {
  const BUILD = '@@BUILD@@';
  let opens = 0;
  let reloading = false;
  addEventListener('beforeunload', (e) => { if (reloading) e.stopImmediatePropagation(); }, true);
  const reload = () => {
    if (window.devteamDropBusy && window.devteamDropBusy()) return void setTimeout(reload, 1000);
    reloading = true;
    location.reload();
  };
  const checkBuild = async () => {
    const r = await fetch('/build', { cache: 'no-store' });
    if (r.status >= 500) throw new Error('the box is away');
    const build = r.ok ? (await r.json()).build : null;
    if (!build || build === BUILD) return;
    try {
      if (sessionStorage.getItem('devteam-term-reloaded') === build) return;
      sessionStorage.setItem('devteam-term-reloaded', build);
    } catch { return; }
    reload();
  };
  let asking = false;
  const watchBuild = async () => {
    if (asking) return;
    asking = true;
    for (let i = 0; i < 200; i++) {
      try { await checkBuild(); break; } catch {}
      await new Promise((r) => setTimeout(r, 3000));
    }
    asking = false;
  };
  window.WebSocket = new Proxy(window.WebSocket, { construct(T, args, nt) {
    const socket = Reflect.construct(T, args, nt);
    const live = { socket, at: 0 };
    window.devteamTermSocket = live;
    socket.addEventListener('open', () => {
      live.at = Date.now();
      if (++opens > 1) watchBuild();
    });
    socket.addEventListener('close', () => { watchBuild(); });
    return socket;
  } });
})();</script>`;
  const withSocketWatch = (html, watch) => {
    const at = html.indexOf('<head>');
    return at < 0 ? html : Buffer.concat([html.subarray(0, at + 6), watch, html.subarray(at + 6)]);
  };
  // A native terminal pastes the path of a file dropped on it, and Claude Code picks it up from
  // there. So does this: each file goes to the box first, and then its path goes in by term.paste,
  // bracketed like any paste when the program in the pane has asked for that, to the focused pane.
  // No Enter, so the owner can add to the message. The drop is the owner's own act, on their page.
  const TERM_DROP = Buffer.from(`<script>(() => {
  const MAX = ${uploadMax};
  const shellQuote = ${shellQuote};
  const dropPaste = ${dropPaste};
  const isDropImage = ${isDropImage};
  const dropSpace = ${dropSpace};
  const dropNote = ${dropNote};
  // ttyd is attached and tmux has redrawn (bracketed paste back on) a moment after a socket opens
  const SETTLE_MS = 1500;
  const box = (css) => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;z-index:10000;font:14px system-ui,sans-serif;display:none;' + css; document.documentElement.appendChild(d); return d; };
  const veil = box('inset:0;align-items:center;justify-content:center;background:rgba(0,0,0,.6);color:#fff;border:2px dashed #fff;box-sizing:border-box;pointer-events:none');
  veil.id = 'devteam-drop-veil';
  veil.textContent = 'Drop to send to the box';
  const note = box('right:12px;bottom:12px;max-width:70%;padding:8px 12px;border-radius:6px;background:#222;color:#eee;white-space:pre-wrap;cursor:pointer');
  note.id = 'devteam-drop-note';
  note.onclick = () => { note.style.display = 'none'; };
  const say = (text, bad) => {
    note.textContent = text;
    note.style.background = bad ? '#b3261e' : '#222';
    note.style.display = 'block';
  };
  const send = (file, label) => new Promise((done, fail) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/upload?name=' + encodeURIComponent(file.name));
    x.setRequestHeader('content-type', 'application/octet-stream');
    x.upload.onprogress = (e) => { if (e.lengthComputable) say(label + ' ' + Math.round(100 * e.loaded / (e.total || 1)) + '%'); };
    x.onload = () => {
      let j = {};
      try { j = JSON.parse(x.responseText); } catch {}
      if (x.status === 200 && j.path) done(j.path); else fail(new Error(j.error || x.responseText || 'the box answered ' + x.status));
    };
    x.onerror = () => fail(new Error('the upload was refused or cut off'));
    x.send(file);
  });
  // Safari reads HEIC, so an iPhone photo can go as a JPEG, which Claude Code attaches. Elsewhere
  // (Chrome can't decode it) the original goes, and arrives as a path.
  const toJpeg = async (file) => {
    if (!/\\.hei[cf]$/i.test(file.name) && !/^image\\/hei[cf]/i.test(file.type)) return file;
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      bitmap.close();
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
      return blob ? new File([blob], file.name.replace(/\\.[^.]*$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
    } catch { return file; }
  };
  // Stored but not yet pasted. Tried again until the terminal is back, and on screen until then.
  let waiting = [];
  let trouble = [];
  let active = 0;
  window.devteamDropBusy = () => active > 0 || waiting.length > 0;
  const ready = () => {
    const live = window.devteamTermSocket;
    return Boolean(window.term && window.term.paste && live && live.socket.readyState === 1 && live.at && Date.now() - live.at >= SETTLE_MS);
  };
  const flush = () => {
    if (!waiting.length || !ready()) return false;
    const paths = waiting;
    waiting = [];
    window.term.paste(dropPaste(paths));
    if (dropSpace(paths)) window.term.input(' ');
    window.term.focus();
    say(trouble.concat(dropNote(paths)).join('\\n'), trouble.length > 0);
    trouble = [];
    return true;
  };
  setInterval(flush, 500);
  const take = async (picks) => {
    const paths = [];
    const failed = [];
    for (const [i, p] of picks.entries()) {
      const name = p.file ? p.file.name : 'that item';
      try {
        if (!p.file || p.dir) throw new Error('is a folder: zip it and drop that');
        if (p.file.size > MAX) throw new Error('is over the ' + Math.floor(MAX / 1048576) + ' MB limit');
        const label = (picks.length > 1 ? (i + 1) + '/' + picks.length + ' ' : '') + name;
        say(label + ' 0%');
        paths.push(await send(await toJpeg(p.file), label));
      } catch (e) { failed.push(name + ': ' + e.message); }
    }
    trouble = failed;
    waiting.push(...paths);
    if (flush()) return;
    if (waiting.length) say(trouble.concat('terminal not connected: stored at ' + dropPaste(waiting) + '\\nIt pastes when the terminal reconnects.').join('\\n'), true);
    else if (trouble.length) { say(trouble.join('\\n'), true); trouble = []; }
  };
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
  let hide = 0;
  let queue = Promise.resolve();
  addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    veil.style.display = 'flex';
    clearTimeout(hide);
    hide = setTimeout(() => { veil.style.display = 'none'; }, 500);
  }, true);
  addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    clearTimeout(hide);
    veil.style.display = 'none';
    // only while the event lasts: the list is empty afterwards
    const picks = Array.from(e.dataTransfer.items).filter((i) => i.kind === 'file').map((i) => { const entry = i.webkitGetAsEntry && i.webkitGetAsEntry(); return { file: i.getAsFile(), dir: Boolean(entry && entry.isDirectory) }; });
    active++;
    queue = queue.then(() => take(picks)).catch((err) => say(String(err && err.message || err), true)).finally(() => { active--; });
  }, true);
})();</script>`);
  const TERM_CSP = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'self' ${TERM.replace(/^http/, 'ws')}; frame-ancestors ${PUB}; base-uri 'none'; form-action 'none'`;
  // The page the terminal is served, and a name for it that changes only when its bytes do.
  const termPage = () => {
    const html = ttydPage();
    const build = b64u(sha256(Buffer.concat([html, Buffer.from(TERM_SOCKET), TERM_CLIPBOARD, TERM_DROP]))).slice(0, 22);
    return { build, body: Buffer.concat([withSocketWatch(html, Buffer.from(TERM_SOCKET.replace('@@BUILD@@', build))), TERM_CLIPBOARD, TERM_DROP]) };
  };
  const loginAt = (next) => `${PUB}/auth/login${next ? `?next=${encodeURIComponent(next)}` : ''}`;

  // A published artifact, from the gateway's own copy alone: reads only, the raw path matched
  // before any decoding, the gateway's own headers. Nothing here reads the cookie, sets one, or
  // talks to an instance, so taking a port, rewriting main or forging log lines changes nothing.
  // (The owner's wrapper, tried before this, reads the cookie to choose itself, and only that.)
  // The bytes are the public's, whoever asks. A page's index also varies on the cookie and
  // sec-fetch-dest, which can make it the wrapper, and has the wrapper's opener policy: without it
  // on both, a site that opens the page in a popup could tell from the window (its frame count, or
  // whether it can still see it) whether the visitor is the signed-in owner. The page's sandbox
  // has no allow-popups, so it opens no window that the policy could cut off.
  const servePublic = (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, 'text/plain; charset=utf-8', 'GET or HEAD only', { allow: 'GET, HEAD' });
    if (req.headers['service-worker'] || req.headers['sec-fetch-dest'] === 'serviceworker') return send(res, 403, 'text/plain; charset=utf-8', 'no service workers on this box');
    const notFound = () => send(res, 404, 'text/plain; charset=utf-8', 'not found');
    const m = /^\/([^/]+)\/([^/]+)(\/.*)?$/.exec(req.url.split('?')[0]);
    if (!m || !PROJECT.test(m[1]) || !LINK_ID.test(m[2])) return notFound();
    const pub = store.load().public ?? {};
    const proj = Object.hasOwn(pub, m[1]) ? pub[m[1]] : null;
    const art = proj && Object.hasOwn(proj.artifacts ?? {}, m[2]) ? proj.artifacts[m[2]] : null;
    if (!art) return notFound();
    if (m[3] === undefined) { res.writeHead(302, { location: `/${m[1]}/${m[2]}/`, 'cache-control': 'no-store', ...hsts }); return res.end(); }
    const rel = m[3] === '/' ? 'index.html' : m[3].slice(1);
    const f = publicPathOk(rel) && Object.hasOwn(art.files ?? {}, rel) ? art.files[rel] : null;
    if (!f || !/^[0-9a-f]{64}$/.test(f.sha256 ?? '')) return notFound();
    const tag = `"${f.sha256}"`;
    const head = { etag: tag, 'cache-control': 'public, max-age=60', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': publicCsp(`${PUBLIC}/${m[1]}/${m[2]}/`), ...(rel === 'index.html' ? { vary: 'cookie, sec-fetch-dest', 'cross-origin-opener-policy': 'same-origin' } : {}), ...hsts };
    const asked = String(req.headers['if-none-match'] ?? '').split(',').map((t) => t.trim());
    if (asked.includes('*') || asked.includes(tag)) { res.writeHead(304, head); return res.end(); }
    // no range requests, as in the kit: the whole file or its headers
    const all = { ...head, 'content-type': PUBLIC_TYPES[rel.split('.').pop().toLowerCase()] ?? 'application/octet-stream', 'content-length': f.size };
    // a stat, never a read, so a HEAD says what a plain GET would (a HEAD is never the wrapper)
    const file = path.join(dir, 'public', 'blobs', f.sha256);
    const st = fs.statSync(file, { throwIfNoEntry: false });
    if (!st || st.size !== f.size) return send(res, 500, 'text/plain; charset=utf-8', 'the box has lost its copy of this page: publish it again');
    res.writeHead(200, all);
    if (req.method === 'HEAD') return res.end();
    pipeline(fs.createReadStream(file), res, () => {});
  };

  // --- publishing: only from the gateway's own page on the box's name, of bytes it checked itself ---
  const pstore = publicStore(dir);
  const LOOP_MS = opts.publicDeadlineMs ?? 15000;
  // One publish item's whole time on its instance (manifest, files, record): an instance that
  // answers slowly but within each request's deadline still runs out.
  const ITEM_MS = opts.publicItemMs ?? 120000;
  // A request to an instance as a loopback client: its own Host, and no Origin, sec-fetch-* or
  // cookie, so it never passes for the owner's browser. One deadline for the whole answer, and a
  // cap on its size: whatever holds the port wrote it.
  const loopback = (port, method, p, { body = null, cap = 2 * 1024 * 1024, ms = LOOP_MS } = {}) => new Promise((resolve, reject) => {
    let deadline = null;
    let settled = false;
    const finish = (err, v) => { if (settled) return; settled = true; clearTimeout(deadline); if (err) reject(err); else resolve(v); };
    const headers = { host: `127.0.0.1:${port}`, ...(body === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }) };
    const up = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (ur) => {
      const chunks = [];
      let size = 0;
      ur.on('data', (c) => { size += c.length; if (size > cap) { up.destroy(); finish(new Error(`instance ${port} sent more than ${cap} bytes for ${p}`)); } else chunks.push(c); });
      ur.on('end', () => finish(null, { status: ur.statusCode, body: Buffer.concat(chunks) }));
      ur.on('error', () => finish(new Error(`instance ${port} broke off its answer to ${p}`)));
      ur.on('close', () => finish(new Error(`instance ${port} broke off its answer to ${p}`)));
    });
    up.on('error', () => finish(new Error(`nothing answers on instance ${port}`)));
    deadline = setTimeout(() => { up.destroy(); finish(Object.assign(new Error(`instance ${port} took over ${ms / 1000} s to answer ${p}`), { deadline: true })); }, ms);
    up.end(body ?? undefined);
  });
  const errorOf = (r) => { try { return String(JSON.parse(r.body.toString('utf8')).error ?? `HTTP ${r.status}`).slice(0, 300); } catch { return `HTTP ${r.status}`; } };
  const fetchManifest = async (port, slug, ms = LOOP_MS) => {
    const r = await loopback(port, 'GET', `/public-manifest/${slug}`, { ms });
    if (r.status !== 200) throw new Error(`instance ${port}: ${errorOf(r)}`);
    let m;
    try { m = JSON.parse(r.body.toString('utf8')); } catch { throw new Error(`instance ${port} sent a manifest that isn't JSON`); }
    const why = manifestProblem(m, slug);
    if (why) throw new Error(`instance ${port}'s manifest for ${slug}: ${why}`);
    return m;
  };
  const manifestHash = (m) => hex256(canonicalJson(m));
  // Whether this item may go on the box as it stands: bound to the root the owner saw, and under
  // the cap with this item's files in place of its old version. Checked before the slow work, and
  // again in the queue against the state it will change.
  const publishProblem = (pubNow, m, item) => {
    const bound = Object.hasOwn(pubNow, m.project) ? pubNow[m.project] : null;
    if (bound && bound.root !== m.root) {
      if (item.move !== true) return `${m.project} is published from ${bound.root}; this instance is ${m.root}: tick "move it" to publish it from here`;
      // "move it" is consent to take down what the page showed, so only from that root
      if (bound.root !== item.movedFrom) return 'this project moved since you looked; reload the page';
    }
    const after = { ...pubNow, [m.project]: { ...(bound ?? {}), artifacts: { ...(bound && bound.root === m.root ? bound.artifacts ?? {} : {}) } } };
    delete after[m.project].artifacts[m.slug];
    const sizes = pstore.referenced(after);
    for (const f of Object.values(m.files)) sizes.set(f.sha256, f.size);
    const total = [...sizes.values()].reduce((n, s) => n + s, 0);
    if (total > PUBLIC_MAX) return `publishing it would hold ${total} bytes, over the box's public cap of ${PUBLIC_MAX} bytes (DEVTEAM_PUBLIC_MAX)`;
    return null;
  };
  // One confirmed item. Bound to the manifest the owner saw (its sha256), every file to the
  // manifest, the tree id to the bytes; anything off refuses this item. Everything that waits on
  // the instance runs before the queue, within one budget, so a slow instance holds up no one
  // else's change (an unpublish least of all); the queue holds only the writes, the record and
  // the save, and the sweep after them drops whatever a refused item wrote.
  const publishItem = async (port, item) => {
    const t0 = Date.now();
    const late = () => new Error(`instance ${port} took over ${ITEM_MS / 1000} s for this item; nothing was published`);
    const left = () => { const n = ITEM_MS - (Date.now() - t0); if (n <= 0) throw late(); return Math.min(LOOP_MS, n); };
    // decided by cause, not by the clock: a timer may fire a millisecond early, and a deadline
    // shorter than LOOP_MS can only be the item's budget running out
    const ask = async (f) => { const ms = left(); try { return await f(ms); } catch (e) { throw e.deadline && ms < LOOP_MS ? late() : e; } };
    const m = await ask((ms) => fetchManifest(port, item.slug, ms));
    if (manifestHash(m) !== item.manifest) throw new Error('this changed since you looked; reload the page');
    let why = publishProblem(store.load().public ?? {}, m, item);
    if (why) throw new Error(why);
    const algo = m.tree.length === 40 ? 'sha1' : 'sha256';
    const bytes = new Map();
    const ids = Object.create(null);   // a file may be named __proto__
    for (const [rel, f] of Object.entries(m.files)) {
      const r = await ask((ms) => loopback(port, 'GET', `/artifact/main/${m.slug}/${rel}`, { cap: f.size, ms }));
      if (r.status !== 200 || r.body.length !== f.size || hex256(r.body) !== f.sha256) throw new Error(`${rel} is not the file the manifest names (its bytes differ); nothing was published`);
      bytes.set(f.sha256, r.body);
      ids[rel] = { oid: gitBlobId(r.body, algo), mode: f.mode };
    }
    if (gitTreeId(ids, algo) !== m.tree) throw new Error(`the files don't make the tree ${m.tree.slice(0, 12)} the manifest names; nothing was published`);
    return pstore.serial(async () => {
      try {
        // the budget may have run out while this item queued: refuse before any blob is written
        left();
        // the state may have changed while this item waited: a move, another publish, the cap
        why = publishProblem(store.load().public ?? {}, m, item);
        if (why) throw new Error(why);
        for (const [sha, buf] of bytes) pstore.write(sha, buf);
        // the record gets the full deadline, whatever is left of the budget: cutting it short would leave a recorded-but-unsaved publish
        const k = await loopback(port, 'POST', '/api/artifact-publish', { body: JSON.stringify({ op: 'publish', slug: m.slug, tree: m.tree }), ms: LOOP_MS });
        if (k.status !== 200) throw new Error(`the kit didn't record it, so it wasn't published: ${errorOf(k)}`);
        // load, change and save with nothing awaited in between
        const now = store.load();
        const pub = { ...(now.public ?? {}) };
        const prev = Object.hasOwn(pub, m.project) ? pub[m.project] : null;
        const kept = prev && prev.root === m.root ? prev.artifacts ?? {} : {};
        // a move is a new binding, so never an update
        const update = Object.hasOwn(kept, m.slug);
        pub[m.project] = { root: m.root, port, artifacts: { ...kept, [m.slug]: { tree: m.tree, title: m.title, at: new Date().toISOString(), files: Object.fromEntries(Object.entries(m.files).map(([rel, f]) => [rel, { sha256: f.sha256, size: f.size }])) } } };
        store.save({ ...now, public: pub });
        return { url: `${PUBLIC}/${m.project}/${m.slug}/`, update };
      } finally { try { pstore.sweep(store.load().public); } catch {} }
    });
  };

  // An unpublish is recorded on the instance only when it is that project, at that checkout: its
  // manifest says so, or its hello for a slug no longer on main. Otherwise the Library's Forget does it.
  const recordUnpublish = async (port, project, root, slug) => {
    const r = await loopback(port, 'GET', `/public-manifest/${slug}`);
    let says = null;
    if (r.status === 200) { try { says = JSON.parse(r.body.toString('utf8')); } catch {} }
    else { const h = await loopback(port, 'GET', '/api/hello'); try { const x = JSON.parse(h.body.toString('utf8')); says = { project: x.name, root: x.root }; } catch {} }
    if (says?.project !== project || says?.root !== root) throw new Error(`instance ${port} is not ${project} at ${root}, so the record wasn't written there`);
    const k = await loopback(port, 'POST', '/api/artifact-publish', { body: JSON.stringify({ op: 'unpublish', slug }) });
    if (k.status !== 200) throw new Error(`instance ${port} didn't record it (${errorOf(k)})`);
  };

  // What the box serves, for the Library: each project's checkout, last port and slug -> tree. At
  // most 32 KB; past that, only the projects last seen on the asking instance.
  const publicMap = (port) => {
    const pub = store.load().public ?? {};
    const all = Object.fromEntries(Object.entries(pub).map(([n, x]) => [n, { port: x.port, root: x.root, artifacts: Object.fromEntries(Object.entries(x.artifacts ?? {}).map(([s, a]) => [s, a.tree])) }]));
    const text = asciiJson(all);
    return text.length <= 32 * 1024 ? text : asciiJson(Object.fromEntries(Object.entries(all).filter(([, x]) => x.port === port)));
  };

  // The owner's page on the public name (spec §8): the project's viewer at the published version,
  // with threads. Only for a top-level visit (sec-fetch-dest: document; navigate also matches frames)
  // to a published page's index, by the signed-in owner, whose bound instance the hub's list (as last
  // polled) shows as that checkout with a kit that has viewers. Anything in doubt is null: a session
  // that isn't one, a store that can't be read, no binding, an instance not listed so, another
  // checkout or an older kit. Then the public's bytes are served, as before. It reads the cookie, and
  // nothing else of the owner's, and it is synchronous: nothing is asked on the request path, not even
  // on a miss, so its timing says nothing of who is visiting. The list can be up to a poll stale.
  // The root check is for consistency, against another real checkout on that port, not for
  // authenticity: that rests on the port binding, as it does for the dashboard on that name.
  // The wrapper's own policy: styles and one frame, the bound instance's; no script, nothing to fetch.
  const WRAP_CSP = (inst) => `default-src 'none'; style-src 'unsafe-inline'; frame-src ${inst}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
  const ownerWrapper = (req, url) => {
    try {
      if (req.method !== 'GET' || req.headers['sec-fetch-dest'] !== 'document' || url.searchParams.has('plain')) return null;
      const m = /^\/([^/]+)\/([^/]+)\/(?:index\.html)?$/.exec(req.url.split('?')[0]);
      if (!m || !PROJECT.test(m[1]) || !LINK_ID.test(m[2])) return null;
      const s = store.load();
      if (!s.passkeys.length || !sessionOf(req)) return null;
      const bound = Object.hasOwn(s.public ?? {}, m[1]) ? s.public[m[1]] : null;
      const art = bound && Object.hasOwn(bound.artifacts ?? {}, m[2]) ? bound.artifacts[m[2]] : null;
      if (!art || !BLOCK.includes(bound.port) || typeof bound.root !== 'string' || typeof art.tree !== 'string' || !TREE.test(art.tree)) return null;
      const x = listed.get(bound.port);
      if (!x?.viewer || x.root !== bound.root) return null;
      const at = `tree:${art.tree}`;
      return { port: bound.port, html: PAGES.ownerWrapper({ project: m[1], slug: m[2], title: typeof art.title === 'string' && art.title ? art.title : m[2], frame: `${instanceOrigin(bound.port)}/view/artifact/${m[2]}?at=${at}&w=${wrapGrant(bound.port, m[2], at)}` }) };
    } catch { return null; }
  };

  // --- a file dropped on the terminal: streamed to a folder of its own, never read back or run ---
  // The root is made at boot, by root, for gw to write and dev to read. It is checked here, not
  // assumed, so the gateway never writes through something an agent could have put in its place.
  const uploadsRootOk = async () => {
    try {
      const st = await fs.promises.lstat(uploadsRoot);
      return st.isDirectory() && st.uid === process.getuid() && !(st.mode & 0o022);
    } catch { return false; }
  };
  // What's there, from the disk once, and kept up to date here: only this process writes the root.
  const kept = new Map(); // folder -> { bytes, at }
  const receiving = new Map(); // folder -> the most it may yet take
  const sum = (ns) => { let t = 0; for (const n of ns) t += n; return t; };
  let scan = null;
  const scanUploads = () => {
    scan ??= (async () => {
      for (const e of await fs.promises.readdir(uploadsRoot, { withFileTypes: true })) {
        if (!e.isDirectory() || !UPLOAD_FOLDER.test(e.name)) continue;
        const folder = path.join(uploadsRoot, e.name);
        // one that can't be read or removed costs only itself; one not made by this user isn't ours
        try {
          const st = await fs.promises.lstat(folder);
          if (st.uid !== process.getuid()) continue;
          const names = await fs.promises.readdir(folder);
          // a restart cut this one off: nothing is receiving yet, the scan comes first
          if (!names.length || names.includes(UPLOAD_PART)) { await fs.promises.rm(folder, { recursive: true, force: true }); continue; }
          let bytes = 0;
          for (const n of names) bytes += (await fs.promises.lstat(path.join(folder, n))).size;
          kept.set(e.name, { bytes, at: st.mtimeMs });
        } catch (err) { log(`dropped files: skipping ${e.name}: ${err.message}`); }
      }
    })().catch((e) => { scan = null; throw e; });
    return scan;
  };
  // Removes only what the scan or an upload recorded: a folder named as ours, made by this process's user.
  const sweepUploads = async (now = Date.now()) => {
    if (!(await uploadsRootOk())) return;
    await scanUploads();
    for (const [name, u] of kept) {
      if (now - u.at <= uploadKeepMs) continue;
      try {
        await fs.promises.rm(path.join(uploadsRoot, name), { recursive: true, force: true });
        kept.delete(name);
      } catch (err) { log(`dropped files: could not remove ${name}: ${err.message}`); }
    }
  };
  const receiveUpload = async (req, res, rawName) => {
    const refuse = (code, error, extra) => json(res, code, { error }, extra);
    // closes, so what's still being sent is dropped with the connection, not read
    const tooBig = () => refuse(413, `over the ${Math.floor(uploadMax / 1048576)} MB limit for a file`, { connection: 'close' });
    if (!(await uploadsRootOk())) return refuse(503, 'this box has no folder for dropped files');
    const declared = req.headers['content-length'] === undefined ? null : Number(req.headers['content-length']);
    if (declared !== null && declared > uploadMax) return tooBig();
    const want = declared ?? uploadMax;
    // housekeeping: whatever goes wrong with it, the owner's file still goes in
    await sweepUploads().catch((e) => log(`dropped files: ${e.message}`));
    const pending = sum(receiving.values());
    if (sum([...kept.values()].map((u) => u.bytes)) + pending + want > uploadTotal) return refuse(507, `the box already holds as many dropped files as it keeps (${Math.floor(uploadTotal / 1048576)} MB); they go after ${Math.round(uploadKeepMs / 86400000)} days`);
    const id = `${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(12).toString('hex')}`;
    const folder = path.join(uploadsRoot, id);
    const part = path.join(folder, UPLOAD_PART);
    const stored = path.join(folder, safeUploadName(rawName));
    receiving.set(id, want);
    let fh = null;
    let size = 0;
    const stall = setTimeout(() => req.destroy(new Error('stalled')), uploadStallMs);
    try {
      const { bavail, bsize } = await fs.promises.statfs(uploadsRoot);
      if (bavail * bsize - pending - want < uploadFree) throw Object.assign(new Error('full'), { code: 'ENOSPC' });
      // a new folder of a random name, then a new file in it: neither can be anything already there
      await fs.promises.mkdir(folder, { mode: 0o750 });
      fh = await fs.promises.open(part, 'wx', 0o600);
      // one chunk at a time, each written before the next is read: a big body waits, in the socket
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > uploadMax) throw Object.assign(new Error('too big'), { tooBig: true });
        await fh.writeFile(chunk);
        stall.refresh();
      }
      await fh.chmod(0o640);
      await fh.close();
      await fs.promises.rename(part, stored);
      kept.set(id, { bytes: size, at: Date.now() });
      return json(res, 200, { path: stored, size });
    } catch (e) {
      await fh?.close().catch(() => {});
      await fs.promises.rm(folder, { recursive: true, force: true }).catch(() => {});
      if (e.tooBig) return tooBig();
      if (req.destroyed || res.destroyed) return;
      if (e.code === 'ENOSPC') return refuse(507, 'the box\'s disk is too full for this file', { connection: 'close' });
      log(`a dropped file could not be stored: ${e.message}`);
      return refuse(500, 'the box could not store this file', { connection: 'close' });
    } finally {
      clearTimeout(stall);
      receiving.delete(id);
    }
  };

  // Room for a jar a page has stuffed; past it, see clientError below.
  const server = http.createServer({ maxHeaderSize: 64 * 1024 }, async (req, res) => {
    // Node's five minutes for a body, for all but an upload that has passed its checks (REQUEST_MS)
    const bodyTimer = setTimeout(() => { if (!req.complete) req.destroy(); }, bodyMs);
    bodyTimer.unref();
    req.once('close', () => clearTimeout(bodyTimer));
    // origin-form only: a request line with a full URL, or *, is refused
    if (!req.url.startsWith('/') || req.url.startsWith('//')) return send(res, 400, 'text/plain', 'bad request');
    let url;
    try { url = new URL(req.url, PUB); } catch { return send(res, 400, 'text/plain', 'bad request'); }
    // an app's own /healthz is reachable through its link; the platform's probe is on the service's name
    if (url.pathname === '/healthz' && !previewOf(req.headers.host)) return send(res, 200, 'text/plain', 'ok');
    // Our own names only; and anything but a read must come from a page on the same name.
    const isBox = req.headers.host === pubUrl.host;
    const isTerm = req.headers.host === termHost;
    const isPublic = req.headers.host === publicHost;
    const pv = previewOf(req.headers.host);
    const port = isBox || isTerm || isPublic || pv ? null : instanceOf(req.headers.host);
    if (!isBox && !isTerm && !isPublic && !port && !pv) return send(res, 421, 'text/plain; charset=utf-8', `this box answers only on its own names: open ${PUB}/`);
    // Anyone's, so before every check that is about the owner (Origin, cookie, session). The one
    // exception reads the cookie to choose a page, never to refuse one: the owner's own visit gets
    // the wrapper, and whatever that can't settle gets the public's bytes, exactly as before.
    if (isPublic) {
      const wrap = ownerWrapper(req, url);
      if (wrap) return send(res, 200, 'text/html; charset=utf-8', wrap.html, { 'content-security-policy': WRAP_CSP(instanceOrigin(wrap.port)), 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store, private', vary: 'cookie, sec-fetch-dest', 'cross-origin-opener-policy': 'same-origin' });
      try { return servePublic(req, res); } catch (e) { return send(res, e?.unreadable ? 503 : 500, 'text/plain; charset=utf-8', 'this page can\'t be served just now'); }
    }
    const own = isBox ? PUB : isTerm ? TERM : pv ? previewOrigin(pv) : instanceOrigin(port);
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== own) return send(res, 403, 'text/plain; charset=utf-8', 'only from this box\'s own pages');
    // The kit has no service workers. One an agent's page registers on an instance's name would
    // outlive its server, and run as that name's real dashboard once one takes the port.
    if ((port || pv) && (req.headers['service-worker'] || req.headers['sec-fetch-dest'] === 'serviceworker')) return send(res, 403, 'text/plain; charset=utf-8', 'no service workers on this box');
    const p = url.pathname;
    const isAuth = isBox && (p === '/auth' || p.startsWith('/auth/'));
    const rawPath = req.url.split('?')[0];
    try {
      const cm = port ? /^\/c\/(\d+)\.([\w-]+)\.([\w-]+)(\/artifact\/.*)$/.exec(rawPath) : null;
      if (cm) {
        if (!['GET', 'HEAD'].includes(req.method) || !capOk(port, cm[4], cm[1], cm[2], cm[3])) return send(res, 403, 'text/plain; charset=utf-8', 'that artifact link has expired: open it again from the dashboard');
        return proxy(req, res, { port, path: cm[4] + url.search, publicOrigin: own, cap: `/c/${cm[1]}.${cm[2]}.${cm[3]}`, publicFrame: treeGranted(port, cm[4]) });
      }
      // A preview may be framed only by a page of this box (the dashboard's viewer, in time), so no
      // other site can lay it under its own page with the owner's session in it.
      if (pv && PREVIEW_FRAMED.includes(req.headers['sec-fetch-dest']) && !['same-origin', 'same-site'].includes(req.headers['sec-fetch-site'])) return send(res, 403, 'text/plain; charset=utf-8', 'not in another site\'s frame');
      if (!crossSiteOk(req, p, url)) return send(res, 403, 'text/plain; charset=utf-8', 'not for another site\'s page');
      const s = store.load();
      const claimed = s.passkeys.length > 0;
      if (isAuth) {
        if (p === '/auth' && req.method === 'GET') return redirect(res, '/auth/login');
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
      // What installing the hub fetches. Public: a browser asks for the manifest without the cookie, and
      // refreshes the worker after a session has ended. Nothing here says anything about the box.
      const installed = isBox && req.method === 'GET' ? INSTALL[p] : null;
      if (installed) return send(res, 200, installed.type, installed.body());
      const session = claimed ? sessionOf(req) : null;
      if (!session) {
        // a lens open in a tab of its own is no use after sign-in: the preview itself is
        const back = pv && p === '/.devteam/lens' ? `${own}/` : `${own}${req.url}`;
        if (navigating(req)) return redirect(res, claimed ? loginAt(back) : loginAt());
        return send(res, claimed ? 401 : 403, 'text/plain; charset=utf-8', claimed ? 'sign in with your passkey' : 'this box is unclaimed');
      }
      // A preview's lens: the gateway's own page, after the session check, never the app's (spec §7).
      // Static, so it asks the hub nothing; any other method or path there is the app's, as before.
      if (pv && req.method === 'GET' && p === '/.devteam/lens') return send(res, 200, 'text/html; charset=utf-8', PREVIEW_LENS, { 'content-security-policy': LENS_CSP, 'referrer-policy': 'no-referrer' });
      if (pv) return servePreview(req, res, pv, own);
      // An instance's dashboard, on its own subdomain: the request exactly as the browser sent it.
      if (port) {
        const prefix = req.method === 'GET' && ['iframe', 'document'].includes(req.headers['sec-fetch-dest']) && ['same-origin', 'none'].includes(req.headers['sec-fetch-site']) ? ARTIFACT.exec(rawPath)?.[0] : null;
        if (prefix) return redirect(res, `${capFor(port, prefix, session)}${req.url}`);
        if (req.method === 'POST' && rawPath === '/api/pane-answer') return panePost(req, res, port, own);
        return proxy(req, res, { port, path: req.url, publicOrigin: own, publicFrame: viewerGranted(port, rawPath, url) || treeGranted(port, rawPath), extra: req.method === 'GET' && p === '/api/data' ? { 'x-devteam-public': publicMap(port), 'x-devteam-previews': '1' } : null });
      }
      // The terminal: the gateway's copy of ttyd's page. Only its socket reaches ttyd (see upgrade).
      if (isTerm) {
        if (req.method === 'GET' && p === '/') {
          let body;
          try { body = termPage().body; } catch { return send(res, 502, 'text/plain; charset=utf-8', 'This image has no terminal page.'); }
          return send(res, 200, 'text/html; charset=utf-8', body, { 'content-security-policy': TERM_CSP, 'referrer-policy': 'no-referrer' });
        }
        if (req.method === 'GET' && p === '/token') return json(res, 200, { token: '' });
        if (req.method === 'GET' && p === '/build') { try { return json(res, 200, { build: termPage().build }); } catch { return send(res, 502, 'text/plain; charset=utf-8', 'This image has no terminal page.'); } }
        // a session, and (like every POST, above) this page's own Origin: an agent's page has neither
        if (req.method === 'POST' && p === '/upload') { clearTimeout(bodyTimer); return await receiveUpload(req, res, url.searchParams.get('name')); }
        return send(res, 404, 'text/plain', 'not found');
      }
      if (isAuth) {
        if (p === '/auth/logout' && req.method === 'POST') {
          const now = store.load();
          store.save({ ...now, sessions: now.sessions.filter((x) => x.hash !== session.hash) });
          return json(res, 200, { ok: true }, { 'set-cookie': cookie('', 0) });
        }
        if (p === '/auth/passkeys' && req.method === 'GET') return fresh(session) ? page(res, PAGES.passkeys(store.load().passkeys, PUB)) : redirect(res, loginAt(`${PUB}/auth/passkeys`));
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
          // whoever held it may hold a session too: every other session ends, and every device's notifications
          // (this one's subscribes again when its hub next opens)
          store.save({ ...now, passkeys: now.passkeys.filter((x) => x.id !== body.id), sessions: now.sessions.filter((x) => x.hash === session.hash), pushSubs: [] });
          log('a passkey was removed; every other session ended');
          return json(res, 200, { ok: true });
        }
        return send(res, 404, 'text/plain', 'not found');
      }
      // The box's own name: the gateway's copy of the hub page, what it needs to know, and the list.
      if (req.method === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, 'text/html; charset=utf-8', hubPage, { 'content-security-policy': HUB_CSP, 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' });
      if (req.method === 'GET' && p === '/box.json') return json(res, 200, { box: 1, terminal: `${TERM}/`, instance: `${pubUrl.protocol}//{port}.${NAME}${SUFFIX}/`, passkeys: `${PUB}/auth/passkeys`, previews: `${PUB}/dev/`, push: vapid().publicKey });
      if (req.method === 'GET' && p === '/instances.json') return instances(req, res);
      if (req.method === 'GET' && p === '/operator/threads') return operatorThreads(req, res, null);
      if (req.method === 'POST' && p.startsWith('/operator/') && HUB_POSTS.includes(p.slice(10))) return operatorThreads(req, res, p.slice(10));
      if (req.method === 'POST' && p === '/push/subscribe') {
        const sub = pushSubscription(await readJson(req));
        if (!sub) return json(res, 400, { error: 'that is not a push subscription this box can send to' });
        const now = store.load();
        store.save({ ...now, pushSubs: [...(now.pushSubs ?? []).filter((x) => x.endpoint !== sub.endpoint), sub].slice(-PUSH_DEVICES) });
        return json(res, 200, { ok: true });
      }
      // The hub's "is this working?": one push, to the device that asked.
      if (req.method === 'POST' && p === '/push/test') {
        const body = await readJson(req);
        const sub = (store.load().pushSubs ?? []).find((x) => x.endpoint === body?.endpoint);
        if (!sub) return json(res, 404, { error: 'this device is not subscribed: reload the hub' });
        let status;
        try { status = await sendPush(sub, PUSH_TEST); } catch (e) { return json(res, 502, { error: e.message }); }
        return status < 300 ? json(res, 200, { ok: true }) : json(res, 502, { error: `the push service answered ${status}` });
      }
      // Publishing: the gateway's own page, from the manifest it fetched itself, then a POST of what
      // that page showed (only from this page: the Origin rule above refuses any other).
      // Its pages open as a page only: another site's frame navigated here carries the cookie, and
      // would have the gateway ask an instance for up to 50 manifests each time.
      // Every preview on the box, the phone's way in: one tap from the hub, this one document only.
      if (req.method === 'GET' && (p === '/dev' || p === '/dev/')) {
        if (req.headers['sec-fetch-dest'] !== undefined && req.headers['sec-fetch-dest'] !== 'document') return send(res, 403, 'text/plain; charset=utf-8', 'open this page on its own, not in a frame');
        await refreshPreviews();
        const rows = (await Promise.all([...previews].map(async ([name, l]) => {
          if (l.ambiguous) return l.ambiguous.map((c) => ({ name, project: c.project, root: c.root, port: c.port, session: '', label: '', state: 'ambiguous (two instances)' }));
          return [{ name, project: l.project, root: l.root, port: l.port, session: l.session, label: l.label, state: (await previewHost(l.port)) ? 'answers' : 'not answering', link: `${previewOrigin(name)}/` }];
        }))).flat().sort((a, b) => a.root.localeCompare(b.root) || a.name.localeCompare(b.name));
        return page(res, PAGES.previewList(rows));
      }
      if (req.method === 'GET' && (p === '/public' || p.startsWith('/public/')) && req.headers['sec-fetch-dest'] !== undefined && req.headers['sec-fetch-dest'] !== 'document') return send(res, 403, 'text/plain; charset=utf-8', 'open this page on its own, not in a frame');
      if (req.method === 'GET' && p === '/public/publish') {
        const port = Number(url.searchParams.get('port'));
        const slugs = [...new Set(url.searchParams.getAll('slug'))];
        if (!BLOCK.includes(port) || !slugs.length || slugs.length > 50 || !slugs.every((x) => LINK_ID.test(x))) return send(res, 400, 'text/plain; charset=utf-8', 'publish?port=<an instance of this box>&slug=<slug>[&slug=…], at most 50');
        const pub = store.load().public ?? {};
        // at most four manifests at a time: each is a node child on the instance, and Restore all asks for up to 50
        const rows = await mapPool(slugs, 4, async (slug) => {
          try {
            const m = await fetchManifest(port, slug);
            const bound = Object.hasOwn(pub, m.project) ? pub[m.project] : null;
            const now = bound && Object.hasOwn(bound.artifacts ?? {}, slug) ? bound.artifacts[slug] : null;
            const moving = bound && bound.root !== m.root;
            // what the owner approved earlier, if this box still holds it: the only copy to compare with
            const held = now && !moving ? now : null;
            // a move takes down every other page of the old checkout: the page names them
            return { slug, m, hash: manifestHash(m), url: `${PUBLIC}/${m.project}/${slug}/`, held: !!held, changes: held && held.tree !== m.tree ? fileChanges(held.files, m.files) : null, state: !held ? 'not on this box' : held.tree === m.tree ? 'already public at this version' : 'an update', movedFrom: moving ? bound.root : null, others: moving ? Object.keys(bound.artifacts ?? {}).filter((x) => x !== slug).sort() : [] };
          } catch (e) { return { slug, error: e.message }; }
        });
        return page(res, PAGES.publish(port, rows));
      }
      if (req.method === 'POST' && p === '/public/publish') {
        const body = await readJson(req);
        const port = Number(body?.port);
        const items = Array.isArray(body?.items) ? body.items : [];
        if (!BLOCK.includes(port) || !items.length || items.length > 50 || !items.every((x) => x && typeof x.slug === 'string' && LINK_ID.test(x.slug) && typeof x.manifest === 'string' && /^[0-9a-f]{64}$/.test(x.manifest))) return json(res, 400, { error: 'publish takes { port, items: [{ slug, manifest, move, movedFrom }] }, 1 to 50 items' });
        const results = [];
        for (const it of items) {
          try { results.push({ slug: it.slug, ok: true, ...(await publishItem(port, it)) }); }
          catch (e) { results.push({ slug: it.slug, ok: false, error: e.message }); }
        }
        log(`public: ${results.map((x) => `${x.slug} ${x.ok ? 'published' : 'refused'}`).join(', ')} from instance ${port}`);
        return json(res, 200, { results });
      }
      // Taking a page down never waits on an instance: the gateway's copy goes first, then the record.
      if (req.method === 'GET' && p === '/public/unpublish') {
        const pub = store.load().public ?? {};
        const slug = url.searchParams.get('slug') ?? '';
        const port = url.searchParams.has('port') ? Number(url.searchParams.get('port')) : null;
        let project = url.searchParams.get('project');
        if (project === null && port !== null) {
          const named = Object.keys(pub).filter((n) => pub[n].port === port && Object.hasOwn(pub[n].artifacts ?? {}, slug));
          project = named.length === 1 ? named[0] : null;
        }
        if (!LINK_ID.test(slug) || (port !== null && !BLOCK.includes(port)) || !PROJECT.test(project ?? '')) return send(res, 400, 'text/plain; charset=utf-8', 'unpublish?project=<project>&slug=<slug>[&port=<instance>]');
        const a = Object.hasOwn(pub, project) && Object.hasOwn(pub[project].artifacts ?? {}, slug) ? pub[project].artifacts[slug] : null;
        if (!a) return send(res, 404, 'text/plain; charset=utf-8', `${project}/${slug} is not public on this box`);
        return page(res, PAGES.unpublish({ project, slug, port, title: a.title, url: `${PUBLIC}/${project}/${slug}/` }));
      }
      if (req.method === 'POST' && p === '/public/unpublish') {
        const body = await readJson(req);
        const project = String(body?.project ?? '');
        const slug = String(body?.slug ?? '');
        const port = body?.port === undefined || body?.port === null ? null : Number(body.port);
        if (!PROJECT.test(project) || !LINK_ID.test(slug) || (port !== null && !BLOCK.includes(port))) return json(res, 400, { error: 'unpublish takes { project, slug, port? }' });
        const root = await pstore.serial(() => {
          const now = store.load();
          const pub = { ...(now.public ?? {}) };
          const x = Object.hasOwn(pub, project) ? pub[project] : null;
          if (!x || !Object.hasOwn(x.artifacts ?? {}, slug)) return null;
          const artifacts = { ...x.artifacts };
          delete artifacts[slug];
          // the binding stays: another checkout of this name still needs "move it"
          pub[project] = { ...x, artifacts };
          store.save({ ...now, public: pub });
          // the page is down once saved; a blob the sweep can't drop is the next sweep's
          try { pstore.sweep(pub); } catch {}
          return x.root;
        });
        if (root === null) return json(res, 404, { error: `${project}/${slug} is not public on this box` });
        log(`public: ${project}/${slug} unpublished`);
        if (port === null) return json(res, 200, { ok: true, recorded: false, note: 'no instance was named, so the record wasn\'t written; the Library\'s Forget clears it' });
        try { await recordUnpublish(port, project, root, slug); return json(res, 200, { ok: true, recorded: true, note: null }); }
        catch (e) { return json(res, 200, { ok: true, recorded: false, note: `${e.message}; the Library's Forget clears it` }); }
      }
      if (req.method === 'GET' && (p === '/public' || p === '/public/')) return page(res, PAGES.publicList(store.load().public ?? {}, PUBLIC));
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

  // The head of an upstream's answer to an upgrade, its headers under the same rules as any response.
  // A lone CR is refused: a browser may read it as a line break where this parse didn't.
  const previewHandshake = (head, own, port) => {
    if (/\r(?!\n)/.test(head)) return null;
    const [status, ...rows] = head.split(/\r?\n/);
    if (!/^HTTP\/1\.[01] \d{3}/.test(status)) return null;
    const parsed = {};
    let last = null;
    for (const row of rows) {
      // a folded continuation belongs to the header it follows, dropped with it if that is
      if (/^[ \t]/.test(row)) { if (last) parsed[last] = [].concat(parsed[last]).map((v, i, all) => (i === all.length - 1 ? `${v} ${row.trim()}` : v)); continue; }
      const i = row.indexOf(':');
      if (i < 1) { last = null; continue; }
      const k = row.slice(0, i).trim().toLowerCase();
      const v = row.slice(i + 1).trim();
      last = k;
      if (k === 'set-cookie') (parsed[k] ??= []).push(v);
      else parsed[k] = parsed[k] === undefined ? v : `${parsed[k]}, ${v}`;
    }
    const out = downstreamHeaders(parsed, null, own, port);
    const is101 = / 101\b/.test(status);
    const lines = [status, `connection: ${is101 ? 'Upgrade' : 'close'}`];
    for (const [k, v] of Object.entries(out)) for (const one of [].concat(v)) lines.push(`${k}: ${one}`);
    return lines.join('\r\n');
  };
  // A preview's sockets (HMR, mostly): the checks an instance's request gets, a cap per name so a
  // client's reconnect loop can't exhaust the gateway, and the terminal's raw relay. No hub refresh on
  // a miss: the page that opened the socket already made one.
  const PREVIEW_SOCKETS = 32;
  const previewSockets = new Map();
  const previewUpgrade = async (req, socket, head, name, refuse) => {
    const own = previewOrigin(name);
    if (req.headers.origin !== own) return refuse(403, 'Forbidden');
    try { if (!store.load().passkeys.length || !sessionOf(req)) return refuse(401, 'Unauthorized'); } catch { return refuse(503, 'Service Unavailable'); }
    if (!req.url.startsWith('/') || req.url.startsWith('//')) return refuse(400, 'Bad Request');
    const link = previews.get(name);
    if (!link || link.ambiguous) return refuse(503, 'Service Unavailable');
    const open = previewSockets.get(name) ?? new Set();
    if (open.size >= PREVIEW_SOCKETS) return refuse(429, 'Too Many Requests');
    const host = await previewHost(link.port);
    if (socket.destroyed) return undefined;
    if (!host) return refuse(503, 'Service Unavailable');
    if (open.size >= PREVIEW_SOCKETS) return refuse(429, 'Too Many Requests');
    previewSockets.set(name, open);
    open.add(socket);
    const drop = () => { open.delete(socket); if (!open.size && previewSockets.get(name) === open) previewSockets.delete(name); };
    socket.once('close', drop);
    const up = net.connect(link.port, host);
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
    socket.on('close', () => up.destroy());
    up.once('close', () => socket.destroy());
    up.on('connect', () => {
      if (socket.destroyed) return up.destroy();
      const h = upstreamHeaders(req, link.port, own, { loopbackHost: 'localhost' });
      h.connection = 'Upgrade';
      h.upgrade = req.headers.upgrade;
      const lines = [`GET ${req.url} HTTP/1.1`, ...Object.entries(h).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)];
      up.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head?.length) up.write(head);
      // The handshake's answer gets the rules any response does (cookies above all): held until its
      // headers are whole, then relayed, so a Set-Cookie on a 101 can't shadow anything either.
      let held = Buffer.alloc(0);
      const onHead = (chunk) => {
        held = Buffer.concat([held, chunk]);
        const text = held.toString('latin1');
        const end = /\r?\n\r?\n/.exec(text);
        if (!end) { if (held.length > 64 * 1024) { up.destroy(); socket.destroy(); } return; }
        up.off('data', onHead);
        const filtered = previewHandshake(text.slice(0, end.index), own, link.port);
        if (!filtered) { up.destroy(); socket.destroy(); return; }
        socket.write(Buffer.from(`${filtered}\r\n\r\n`, 'latin1'));
        const rest = held.subarray(end.index + end[0].length);
        if (rest.length) socket.write(rest);
        pipeline(up, socket, () => {});
        pipeline(socket, up, () => {});
      };
      up.on('data', onHead);
      return undefined;
    });
    return undefined;
  };
  // The terminal's WebSocket, on the terminal's name, its Origin, a session; and any preview's.
  server.on('upgrade', (req, socket, head) => {
    const refuse = (code, msg) => { socket.end(`HTTP/1.1 ${code} ${msg}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`); };
    const pv = previewOf(req.headers.host);
    if (pv) return previewUpgrade(req, socket, head, pv, refuse).catch(() => socket.destroy());
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
  server.requestTimeout = REQUEST_MS;
  return { server, publicUrl: PUB, pollPush, sweepUploads, previewOf, safeNext, wrapGrant, threadPublicKey: () => threadKey(store).publicKey };
}

// --- the gateway's own pages -------------------------------------------------------------------
const STYLE = `<style>
:root{color-scheme:light dark;--bg:#fafafa;--fg:#171717;--fg2:#666;--line:#e5e5e5;--btn:#171717;--btnfg:#fff;--red:#cb2a2f}
@media (prefers-color-scheme:dark){:root{--bg:#000;--fg:#ededed;--fg2:#a1a1a1;--line:#2e2e2e;--btn:#ededed;--btnfg:#000;--red:#ff6166}}
html{touch-action:manipulation}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}
main{max-width:440px;margin:12vh auto;padding:0 16px}h1{font-size:20px;margin:0 0 8px}p{color:var(--fg2)}
button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid var(--btn);background:var(--btn);color:var(--btnfg);cursor:pointer}
button.quiet{background:none;color:var(--fg);border-color:var(--line)}input{font:inherit;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:none;color:var(--fg);width:100%;box-sizing:border-box;margin:8px 0}
#err{color:var(--red)}li{margin:6px 0;display:flex;gap:8px;align-items:center;justify-content:space-between}ul{padding:0;list-style:none}a{color:inherit}
li.pub{display:block;padding:8px 0;border-bottom:1px solid var(--line)}li.pub small,li.pub code,li.pub span{display:block;color:var(--fg2);overflow-wrap:anywhere}
.files{max-height:14em;overflow:auto;margin:4px 0;font:12px/1.5 ui-monospace,monospace;color:var(--fg2);overflow-wrap:anywhere}li.pub .files small{display:inline}
</style>`;
// The browser half of a ceremony: base64url in JSON both ways.
const CLIENT = `<script>
for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
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
const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
// JSON as a header value: a header carries only Latin-1, so everything past ~ is escaped.
const asciiJson = (v) => JSON.stringify(v).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
// What a new version changes against the copy the box serves: each file added or changed, by name, and those removed.
const fileChanges = (old, files) => {
  const before = old ?? {};
  const marks = new Map();
  for (const [rel, f] of Object.entries(files)) {
    if (!Object.hasOwn(before, rel)) marks.set(rel, 'new');
    else if (before[rel].sha256 !== f.sha256) marks.set(rel, 'changed');
  }
  return { marks, removed: Object.keys(before).filter((rel) => !Object.hasOwn(files, rel)).sort() };
};
const treeShort = (t) => String(t).slice(0, 12);
// The files going up, by name: a title can say one thing while the folder holds another.
const publishFiles = (r) => {
  const line = (rel, mark, size) => `<div>${mark ? `<b>${mark}</b> ` : ''}${esc(rel)}${size === null ? '' : ` <small>${esc(fmtSize(size))}</small>`}</div>`;
  return `<div class="files">${Object.entries(r.m.files).map(([rel, f]) => line(rel, r.changes?.marks.get(rel), f.size)).join('')}${(r.changes?.removed ?? []).map((rel) => line(rel, 'removed', null)).join('')}</div>`;
};
// Why an item is ticked or not, in words that claim only what the gateway knows. The log is the
// instance's to report and can be forged, so it is quoted, never relied on.
const publishNote = (r) => {
  if (r.changes) {
    const marks = [...r.changes.marks.values()];
    return `This replaces the copy this box serves: ${marks.filter((x) => x === 'changed').length} changed, ${marks.filter((x) => x === 'new').length} new, ${r.changes.removed.length} removed.`;
  }
  if (r.held) return '';
  const said = r.m.recorded;
  const day = said && esc(said.at.slice(0, 10));
  const why = !said ? 'This instance\'s log records no publish of it.'
    : said.tree === r.m.tree ? `This instance's log says it was published on ${day} at this same version; a log can be forged, so check the files.`
      : `This instance's log says it was published on ${day} at tree ${esc(treeShort(said.tree))}. This is tree ${esc(treeShort(r.m.tree))}, what main holds now, so it is not that version, and the box can't show what changed.`;
  return `Not ticked, because ${r.movedFrom ? 'this box\'s copy of it came from another checkout' : 'this box holds no copy of it'}. ${why} Tick it to make this version public.`;
};
const doc = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>${title}</title>${STYLE}</head><body><main>${body}</main>${CLIENT}`;
const PREVIEW_REFRESH = '<meta http-equiv="refresh" content="5">';
const PAGES = {
  // Every preview on the box, by instance. Each value came through the hub's list and is shown as text.
  previewList: (rows) => doc('Previews', `<h1>Previews on this box</h1><p>Only you can open these, signed in. Each is a running server a session offered.</p>${rows.length ? Object.entries(rows.reduce((g, r) => { (g[r.root] ??= []).push(r); return g; }, Object.create(null))).map(([root, rs]) => `<h2 style="font-size:15px;margin:16px 0 4px">${esc(rs[0].project)} <small>${esc(root)}</small></h2><ul>${rs.map((r) => `<li class="pub"><span><b>${esc(r.name)}</b> <small>${[r.session && esc(r.session), r.label && esc(r.label), `port ${esc(r.port)}`, esc(r.state)].filter(Boolean).join(' · ')}</small></span>${r.link ? `<a href="${esc(r.link)}">Open</a>` : ''}</li>`).join('')}</ul>`).join('') : '<p>Nothing is offered right now.</p>'}`),
  previewDown: (name, l) => `${doc('Preview', `${PREVIEW_REFRESH}<h1>Preview ${esc(l.label || name)} isn't answering</h1><p>Offered by ${esc(l.session)} of ${esc(l.project)}, instance ${esc(l.root)}: nothing answers on port ${esc(l.port)}. Its server may be starting, or stopped. This page retries every 5 s.</p>`)}`,
  previewAmbiguous: (name, cs) => `${doc('Preview', `${PREVIEW_REFRESH}<h1>Two instances offer a preview named ${esc(name)}</h1><p>${cs.map((c) => `${esc(c.project)} at ${esc(c.root)} (port ${esc(c.port)})`).join(' and ')}. The box serves neither until one stops; run <code>devteam.mjs preview stop ${esc(name)}</code> in the one that shouldn't. This page retries every 5 s.</p>`)}`,
  // A preview command can be a second behind the link: the page retries for a few minutes, not forever.
  previewUnknown: (name, names, originOf) => `${doc('Preview', `<script>try{const k='dt-preview-since',t=Date.now();let s=Number(sessionStorage.getItem(k)||0);if(!s||t-s>600000){s=t;sessionStorage.setItem(k,String(s))}if(t-s<180000)setTimeout(()=>location.reload(),5000)}catch{}</script><h1>No preview named ${esc(name)} on this box</h1><p>${names.length ? `Offered now: ${names.map((n) => `<a href="${esc(originOf(n))}/">${esc(n)}</a>`).join(', ')}.` : 'Nothing is offered right now.'} This page retries for a few minutes; a <code>preview</code> command takes a moment to show up.</p>`)}`,
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
  // Each item from the manifest the gateway fetched itself, escaped; its state from the gateway's
  // own copy; ticked only when the box already holds a copy of what the owner approved, never
  // "move it". The POST binds each item to the manifest shown.
  publish: (port, rows) => `${doc('Publish', `<h1>Publish to anyone</h1><p>Anyone with a link below can read that page, with no sign-in. The box keeps its own copy of exactly what is listed here, which is what main holds now; a later change on main reaches the public only when you publish again. From instance ${esc(port)}: the project, checkout and log below are as that instance reports them. An item this box doesn't already serve starts unticked.</p><ul>${rows.map((r) => (r.error ? `<li class="pub"><b>${esc(r.slug)}</b><span>${esc(r.error)}</span></li>` : `<li class="pub"><label><input type="checkbox" data-slug="${esc(r.slug)}" data-manifest="${esc(r.hash)}"${r.held ? ' checked' : ''}> <b>${esc(r.m.title)}</b></label><small>${esc(r.m.project)} · ${esc(r.slug)} · ${esc(Object.keys(r.m.files).length)} files, ${esc(fmtSize(Object.values(r.m.files).reduce((n, f) => n + f.size, 0)))} · ${esc(r.state)}</small><small>from the checkout ${esc(r.m.root)}, as this instance reports it</small><code>${esc(r.url)}</code>${publishNote(r) ? `<span>${publishNote(r)}</span>` : ''}${publishFiles(r)}${r.movedFrom ? `<span>${esc(r.m.project)} is published from ${esc(r.movedFrom)}; this instance is ${esc(r.m.root)}. <label><input type="checkbox" data-move="${esc(r.slug)}" data-moved-from="${esc(r.movedFrom)}"> move it${r.others.length ? ` (its ${r.others.length} other page${r.others.length === 1 ? '' : 's'} from ${esc(r.movedFrom)} come${r.others.length === 1 ? 's' : ''} down: ${r.others.map(esc).join(', ')})` : ''}</label></span>` : ''}</li>`)).join('')}</ul>${rows.some((r) => !r.error) ? '<p><button id="go">Publish</button></p>' : ''}<p id="err"></p><ul id="out"></ul>`)}
<script>
const PORT = ${jsonIn(port)};
const go = document.getElementById('go');
if (go) go.onclick = run(async () => {
  const moves = [...document.querySelectorAll('input[data-move]')];
  const items = [...document.querySelectorAll('input[data-manifest]')].filter((x) => x.checked).map((x) => { const m = moves.find((y) => y.dataset.move === x.dataset.slug && y.checked); return { slug: x.dataset.slug, manifest: x.dataset.manifest, move: !!m, ...(m ? { movedFrom: m.dataset.movedFrom } : {}) }; });
  if (!items.length) return err('Nothing is ticked.');
  go.disabled = true;
  try {
    const r = await post('/public/publish', { port: PORT, items });
    document.getElementById('out').replaceChildren(...r.results.map((x) => {
      const li = document.createElement('li');
      if (!x.ok) { li.textContent = x.slug + ': refused: ' + x.error; return li; }
      const a = document.createElement('a');
      a.href = x.url; a.textContent = x.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      li.append(x.slug + (x.update ? ': updated at ' : ': public at '), a);
      return li;
    }));
  } finally { go.disabled = false; }
});
</script></body></html>`,
  unpublish: (x) => `${doc('Unpublish', `<h1>Take this page down</h1><p><b>${esc(x.title)}</b> (${esc(x.project)} · ${esc(x.slug)}) comes down within a minute, for everyone:</p><p><code>${esc(x.url)}</code></p><p><button id="go">Unpublish</button></p><p id="err"></p><p id="out"></p>`)}
<script>
const ITEM = ${jsonIn({ project: x.project, slug: x.slug, ...(x.port ? { port: x.port } : {}) })};
const go = document.getElementById('go');
go.onclick = run(async () => {
  const r = await post('/public/unpublish', ITEM);
  go.disabled = true;
  document.getElementById('out').textContent = 'Taken down.' + (r.recorded ? ' The Library shows it.' : ' ' + (r.note || ''));
});
</script></body></html>`,
  publicList: (pub, site) => {
    const rows = Object.entries(pub).flatMap(([n, x]) => Object.entries(x.artifacts ?? {}).map(([s, a]) => ({ n, s, a, root: x.root, link: `${site}/${n}/${s}/` })));
    return `${doc('Public', `<h1>Public on this box</h1><p>Anyone can read these, with no sign-in. Each is the box's own copy of what you published.</p>${rows.length ? `<ul>${rows.map((r) => `<li class="pub"><b>${esc(r.a.title)}</b><small>${esc(r.n)} · ${esc(r.s)} · published ${esc(String(r.a.at).slice(0, 10))} from ${esc(r.root)}</small><code><a href="${esc(r.link)}" target="_blank" rel="noopener noreferrer">${esc(r.link)}</a></code><a href="${esc(`/public/unpublish?project=${r.n}&slug=${r.s}`)}">Unpublish</a></li>`).join('')}</ul>` : '<p>Nothing is public.</p>'}`)}</body></html>`;
  },
  // The owner's view of a public page: the instance's viewer, framed full size under one line, and
  // no script of its own. The frame may not navigate this tab, nor open a window outside its
  // sandbox (an artifact viewer needs none); its sandbox keeps its origin.
  ownerWrapper: ({ project, slug, title, frame }) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>${esc(title)}</title><style>
html{touch-action:manipulation}:root{color-scheme:light dark;--bg:#fafafa;--fg:#171717;--fg2:#666;--line:#e5e5e5}@media (prefers-color-scheme:dark){:root{--bg:#000;--fg:#ededed;--fg2:#a1a1a1;--line:#2e2e2e}}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:13px/1.4 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}body{display:flex;flex-direction:column}
header{padding:6px 12px;border-bottom:1px solid var(--line);color:var(--fg2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}a{color:var(--fg)}iframe{flex:1;border:0;width:100%}
</style></head><body><header>Public · ${esc(project)}/${esc(slug)} · <a href="?plain">Open it as the public sees it</a></header><iframe src="${esc(frame)}" title="${esc(title)}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads" autofocus></iframe></body></html>`,
};

// --- command line ------------------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const cmd = process.argv[2] ?? 'serve';
  try {
    if (cmd === 'serve') {
      const { server, publicUrl: pub, pollPush, sweepUploads } = createGateway({ port: Number(env.PORT ?? 8080) });
      setInterval(() => pollPush().catch((e) => process.stdout.write(`gateway: notifications: ${e.message}\n`)), PUSH_POLL_MS);
      const sweep = () => sweepUploads().catch((e) => process.stdout.write(`gateway: dropped files: ${e.message}\n`));
      sweep();
      setInterval(sweep, UPLOAD_SWEEP_MS);
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
      store.save({ ...store.load(), passkeys: [], sessions: [], pushSubs: [] });
      process.stdout.write(`every passkey and session is forgotten. Claim the box again: ${claimUrl(pub, newClaim(store))}\n`);
    } else if (cmd === 'thread-key') {
      // The public half of the key that signs the owner's thread presses, for the boot to put where
      // only root can write and every user can read (cloud/Dockerfile, /etc/devteam/thread-key.pub).
      process.stdout.write(threadKey(stateStore(gatewayDir())).publicKey);
    } else {
      process.stderr.write('usage: node gateway.mjs [serve | reclaim | thread-key]\n');
      process.exit(2);
    }
  } catch (e) {
    process.stderr.write(`gateway: ${e.message}\n`);
    process.exit(1);
  }
}
