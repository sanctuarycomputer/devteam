// The box's gateway and the terminal routes (terminal@1 §3, §4; kit-613): it signs the two terminal
// POSTs, each under its own domain, for that instance's own dashboard port; caps their bodies at
// 100 KB with a 413 before anything is forwarded; and keeps a View session, a signed-out request and
// another site's page off every /api/term/* route. The first test runs a real dashboard on a box
// (its gateway key the gateway's own) with a stand-in supervisor in tmux, so "the instance accepts"
// is the kit's own check; the rest put a recording stand-in on another instance's port, to see
// exactly what the gateway sends, and never send.
// Run: node --test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PORTS, freePort, startDashboard, until } from './lib/kit.mjs';
import { keysBody, openBody, post as direct, shellWindows, termFixture } from './lib/terminal-server-fixture.mjs';

// The gateway reads both once, as it loads: its hub (a stand-in, +2) and its instance block (+50..+74),
// where the real dashboard takes the block's first port and the recorder its second. Put back after
// the import, so the fixture's own commands keep the values lib/kit.mjs set.
const HUB = PORTS + 2;
const DASH = PORTS + 50;
const REC = PORTS + 51;
const saved = { hub: process.env.DEVTEAM_HUB_PORT, base: process.env.DEVTEAM_PORT_BASE };
process.env.DEVTEAM_HUB_PORT = String(HUB);
process.env.DEVTEAM_PORT_BASE = String(DASH);
const G = await import('../cloud/gateway.mjs');
process.env.DEVTEAM_HUB_PORT = saved.hub;
process.env.DEVTEAM_PORT_BASE = saved.base;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-gwterm-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const CAP = 102400;
const KEYS = 'devteam-term-keys-v1', OPEN = 'devteam-term-open-v1';
const VIEW = '{"why":"view"}';
const sha = (b) => crypto.createHash('sha256').update(b).digest();
const u = (b) => Buffer.from(b).toString('base64url');

// --- a software authenticator (as test/gateway-memory-route.test.mjs has it) ----------------------
function cbor(v) {
  const head = (mt, n) => (n < 24 ? Buffer.from([(mt << 5) | n]) : n < 256 ? Buffer.from([(mt << 5) | 24, n]) : n < 65536 ? Buffer.from([(mt << 5) | 25, n >> 8, n & 255]) : (() => { const b = Buffer.alloc(5); b[0] = (mt << 5) | 26; b.writeUInt32BE(n, 1); return b; })());
  if (v === false || v === true || v === null) return Buffer.from([v === false ? 0xf4 : v === true ? 0xf5 : 0xf6]);
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error(`cbor: ${typeof v}`);
}
function authenticator() {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
  const id = crypto.randomBytes(16);
  return {
    create(opts, origin) {
      const cd = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: opts.challenge, origin }));
      const len = Buffer.alloc(2); len.writeUInt16BE(id.length);
      const ad = Buffer.concat([sha(opts.rp.id), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, id, cbor(cose)]);
      return { rawId: u(id), clientDataJSON: u(cd), attestationObject: u(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]]))) };
    },
  };
}

// --- servers that record what reaches them ---------------------------------------------------------
const listen = (srv, port) => new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(port, '127.0.0.1', () => resolve(srv.address().port)); });
const closeAll = (srv) => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); });
// A request carrying x-test-hold is never answered: it is kept in held, with closed set once the
// gateway's side of it goes away before an answer.
function recorder(only = null) {
  const seen = [];
  const held = [];
  const arrived = [];
  const stray = [];
  const srv = http.createServer((q, s) => {
    if (only && q.headers.host !== only) { stray.push(`${q.method} ${q.url} ${q.headers.host}`); q.resume(); s.writeHead(404); s.end(); return; }
    arrived.push(`${q.method} ${q.url}`);
    if (q.headers['x-test-hold']) { const x = { url: q.url, closed: false }; held.push(x); s.on('close', () => { x.closed = true; }); q.resume(); return; }
    const parts = [];
    q.on('data', (c) => parts.push(c));
    q.on('end', () => { seen.push({ method: q.method, url: q.url, h: q.headers, body: Buffer.concat(parts) }); s.writeHead(200, { 'content-type': 'application/json' }); s.end('{"ok":true}'); });
  });
  return { srv, seen, held, arrived, stray };
}

// --- the box: a stand-in hub listing alpha (the real dashboard), rec (the recorder) and a preview --
async function box(t, name, { real = null } = {}) {
  const rec = recorder(`127.0.0.1:${REC}`);
  await listen(rec.srv, REC);
  const app = recorder();
  const appPort = await listen(app.srv, 0);
  const list = [
    ...(real ? [{ devteam: 1, name: 'alpha', root: real.root, port: DASH }] : []),
    { devteam: 1, name: 'sib', root: '/srv/sib', port: PORTS + 52 },
    { devteam: 1, name: 'rec', root: '/srv/rec', port: REC, previews: [{ name: 'cool-tiger', port: appPort, project: 'rec', session: 'api-01-x', label: 'app', at: '2026-11-10', up: true, run: false }] },
  ];
  const hub = http.createServer((q, s) => { q.resume(); s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ hub: 1, instances: list })); });
  await listen(hub, HUB);
  const port = await freePort();
  const publicUrl = `http://box.localhost:${port}`;
  const ttydPage = path.join(scratch, `${name}-ttyd.html`);
  fs.writeFileSync(ttydPage, 'the gateway\'s copy of ttyd');
  const uploadsDir = path.join(scratch, `${name}-uploads`);
  fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o750 });
  const logs = [];
  const dir = path.join(scratch, name);
  const g = G.createGateway({ publicUrl, dir, ttydPort: await freePort(), ttydPage, uploadsDir, log: (m) => logs.push(m) });
  await listen(g.server, port);
  const host = `box.localhost:${port}`;
  const on = (label) => `${label}.${host}`;
  // A browser's request: Host, and for a write its page's own Origin, unless the test says otherwise.
  // a post that sends `sent` bytes of a `whole`-byte body and then stalls: what the gateway answers, if it answers
  const stall = (h, route, sent, whole, cookie, ms = 3000) => new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: route, setHost: false, headers: { host: h, origin: `http://${h}`, 'content-type': 'application/json', 'content-length': whole, cookie, ...SAME } }, (res) => { res.resume(); res.on('end', () => { clearTimeout(timer); r.destroy(); resolve({ status: res.statusCode, connection: res.headers.connection }); }); });
    const timer = setTimeout(() => { r.destroy(); resolve({ status: 'no answer' }); }, ms);
    r.on('error', () => {});
    r.write('x'.repeat(sent));
  });
  const scan = () => new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: REC, method: 'HEAD', path: '/', setHost: false, agent: false, headers: { host: 'devteam-scan.onrender.com', 'user-agent': 'Go-http-client/1.1' } }, (res) => { res.resume(); res.on('end', resolve); });
    r.on('error', resolve);
    r.end();
  });
  // Settle, scan, then check what the recorder set aside for a Host not the gateway's: every forward
  // the gateway sends carries 127.0.0.1:<REC>, so only a scanner's HEAD / (scan()'s own among them)
  // may be there. A request the gateway sent on with the browser's Host would be here, never in rec.
  const quiet = async (label) => {
    await new Promise((ok) => setTimeout(ok, 100));
    await scan();
    assert.deepEqual(rec.stray.filter((x) => !x.startsWith('HEAD / ')), [], `${label}: nothing set aside but a scanner's HEAD /`);
  };
  // and once more after the test's last request, before the servers close: so every request the
  // recorder set aside, in every test on a box, is checked (a failed after hook fails its test)
  t.after(async () => { try { await quiet('after the last request'); } finally { for (const x of [g.server, hub, rec.srv, app.srv]) await closeAll(x); } });
  const at = (h, method, route, { body, headers = {}, cookie = '' } = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.isBuffer(body) || typeof body === 'string' ? Buffer.from(body) : Buffer.from(JSON.stringify(body));
    const hd = { host: h, ...(method !== 'GET' && method !== 'HEAD' ? { origin: `http://${h}`, 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers };
    for (const k of Object.keys(hd)) if (hd[k] === null) delete hd[k];
    const r = http.request({ host: '127.0.0.1', port, method, path: route, headers: hd, setHost: false }, (res) => {
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => { const text = Buffer.concat(parts).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    r.on('error', reject);
    r.end(data ?? undefined);
  });
  // the owner claims the box through today's claim routes
  const token = /claim#([A-Za-z0-9_-]+)/.exec(logs.join('\n'))?.[1];
  const a = authenticator();
  const o = await at(host, 'POST', '/auth/claim/options', { body: { token } });
  assert.equal(o.status, 200, o.text);
  const v = await new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify({ token, ...a.create(o.json, publicUrl) }));
    const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/auth/claim/verify', headers: { host, origin: publicUrl, 'content-type': 'application/json', cookie: (o.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ') } }, (res) => { res.resume(); res.on('end', () => resolve(res)); });
    r.on('error', reject);
    r.end(data);
  });
  assert.equal(v.statusCode, 200, 'the claim');
  const owner = v.headers['set-cookie'].find((c) => c.startsWith('devteam_session=')).split(';')[0];
  // a View person and a session of theirs, written as the gateway writes them (people@1)
  const file = path.join(dir, 'state.json');
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pid = `p-${'a'.repeat(12)}`;
  const tok = crypto.randomBytes(32);
  const next = { ...s, people: [...(s.people ?? []), { id: pid, name: 'Ana', role: 'member', level: 'view', methods: [], pushSubs: [], added_at: new Date().toISOString(), last_seen: null, notices: [], rev: 1 }], peopleSessions: [...(s.peopleSessions ?? []), { hash: u(sha(tok)), person: pid, method: null, at: Date.now(), expires: Date.now() + 3600e3 }] };
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
  const view = `devteam_session=${u(tok)}`;
  // until the gateway has the list: the recorder answers on rec's name
  await until(async () => (await at(on('rec'), 'GET', '/ready', { cookie: owner })).status === 200, 'rec through the gateway');
  rec.seen.length = 0;
  rec.arrived.length = 0;
  return { g, dir, port, publicUrl, host, on, at, stall, scan, quiet, owner, view, rec: rec.seen, held: rec.held, app: app.seen, arrived: rec.arrived };
}
// What the gateway signed: the bytes of terminal@1 §3, from the headers an instance received.
const signedBytes = (domain, port, which, h, body) => Buffer.from(`${domain}\n${port}\n${which}\n${h['x-devteam-gateway-ts']}\n${h['x-devteam-gateway-nonce']}\n${sha(body).toString('hex')}`);
const verifies = (pub, bytes, h) => { try { return crypto.verify(null, bytes, pub, Buffer.from(String(h['x-devteam-gateway-sig']), 'base64url')); } catch { return false; } };
const SAME = { 'sec-fetch-site': 'same-origin' };
const FORGED = { 'x-devteam-gateway-ts': '1', 'x-devteam-gateway-nonce': 'forged-forged-forged-forged', 'x-devteam-gateway-sig': 'forged' };

test("terminal A9: a signed-in owner's supervisor keys, shell open and shell keys reach a real box dashboard through the gateway, which takes each", async (t) => {
  const T = termFixture('gw-term-a9');
  const pubFile = path.join(T.F.base, 'thread-key.pub');
  // the gateway first (its key), then the dashboard on the block's first port, as on a box
  let B = null;
  const dash = { root: T.root };
  B = await box(t, 'a9-real', { real: dash });
  fs.writeFileSync(pubFile, B.g.threadPublicKey());
  const d = startDashboard(T.root, T.dashEnv({ DEVTEAM_PUBLIC_URL: 'https://box.example.com', DEVTEAM_GATEWAY_THREAD_KEY: pubFile }), ['--port', String(DASH)]);
  t.after(async () => { await d.stop(); await T.done(); });
  await until(() => /dashboard on http/.test(d.out()) || d.p.exitCode !== null, 'the dashboard');
  assert.match(d.out(), /dashboard on http/, d.out().slice(-600));
  const s = T.standIn({ lines: ['A9 stand-in'] });
  const alpha = B.on('alpha');
  const get = (route) => B.at(alpha, 'GET', route, { cookie: B.owner, headers: SAME });
  await until(async () => { const r = await get('/api/term/supervisor/screen'); return r.status === 200 && r.json?.state === 'live' && r.json.pane === s.pane; }, 'the supervisor live through the gateway');
  const tok = (await get('/api/term/token')).json?.token;
  assert.match(String(tok), /^[0-9a-f]{64}$/, 'the token through the gateway');
  const postAt = (route, body) => B.at(alpha, 'POST', route, { cookie: B.owner, body, headers: { ...SAME, ...FORGED } });
  // the supervisor's keys: typed (a browser's forged proof is replaced by the gateway's own)
  const k = await postAt('/api/term/supervisor/keys', keysBody(tok, s.pane, 1, { data: '6869' }));
  assert.equal(k.status, 200, `supervisor keys: ${k.text}`);
  assert.equal(k.json?.taken, true, k.text);
  assert.equal(String(await s.received(2)), 'hi', 'typed into the supervisor');
  // the instance takes the gateway's key only for the route it signed: a keys body signed by that key
  // under the open domain, or for the other which, is refused, and types nothing
  const priv = JSON.parse(fs.readFileSync(path.join(B.dir, 'state.json'), 'utf8')).threadKey.privateKey;
  for (const [what, domain, which] of [['under the open domain', OPEN, 'supervisor'], ['for the shell', KEYS, 'shell']]) {
    const body = JSON.stringify(keysBody(tok, s.pane, 2, { data: '78' }));
    const r = await direct(DASH, '/api/term/supervisor/keys', body, { ...SAME, ...G.termSignature(priv, domain, DASH, which, body) });
    assert.equal(r.status, 403, `a keys post signed ${what}: ${r.status} ${r.text}`);
  }
  assert.equal(String(await s.received(2)), 'hi', 'nothing more typed');
  // shell open: the window is made
  const op = await postAt('/api/term/shell/open', openBody(tok));
  assert.equal(op.status, 200, `shell open: ${op.text}`);
  assert.equal(op.json?.state, 'live', op.text);
  assert.equal(shellWindows(T), 1, 'one shell window');
  // the shell's keys: taken
  const sk = await postAt('/api/term/shell/keys', keysBody(tok, op.json.pane, 1, { data: '6563686f0d' }, 'shell'));
  assert.equal(sk.status, 200, `shell keys: ${sk.text}`);
  assert.equal(sk.json?.taken, true, sk.text);
  s.kill();
});

test("terminal A9: each terminal post is signed under its own domain, which and this instance's port, over the body as sent, and nothing else is signed", async (t) => {
  const B = await box(t, 'a9-domains');
  const pub = crypto.createPublicKey(B.g.threadPublicKey());
  const rec = B.on('rec');
  const send = (route, body) => B.at(rec, 'POST', route, { cookie: B.owner, body, headers: { ...SAME, ...FORGED } });
  const cases = [
    ['/api/term/supervisor/keys', KEYS, 'supervisor', JSON.stringify({ which: 'supervisor', pane: '%1', page: 'page-0123456789abcdef', seq: 1, data: '61', token: 't' })],
    ['/api/term/shell/keys', KEYS, 'shell', JSON.stringify({ which: 'shell', pane: '%2', page: 'page-0123456789abcdef', seq: 1, paste: 'x'.repeat(5000), token: 't' })],
    ['/api/term/shell/open', OPEN, 'shell', JSON.stringify({ which: 'shell', page: 'page-0123456789abcdef', cols: 80, rows: 24, token: 't' })],
  ];
  for (const [route, domain, which, body] of cases) {
    const r = await send(route, body);
    assert.equal(r.status, 200, `${route}: ${r.text}`);
    const got = B.rec.at(-1);
    assert.equal(got.url, route, `${route}: forwarded to the same path`);
    assert.equal(got.body.toString('utf8'), body, `${route}: the body as sent`);
    assert.match(String(got.h['x-devteam-gateway-ts']), /^\d{13}$/, `${route}: the gateway's own stamp`);
    assert.match(String(got.h['x-devteam-gateway-nonce']), /^[A-Za-z0-9_-]{22,64}$/, `${route}: the gateway's own nonce`);
    assert.equal(verifies(pub, signedBytes(domain, REC, which, got.h, got.body), got.h), true, `${route}: signed under ${domain} for ${which} on ${REC}`);
    const other = domain === KEYS ? OPEN : KEYS;
    assert.equal(verifies(pub, signedBytes(other, REC, which, got.h, got.body), got.h), false, `${route}: no good for ${other}`);
    assert.equal(verifies(pub, signedBytes(domain, REC, which === 'shell' ? 'supervisor' : 'shell', got.h, got.body), got.h), false, `${route}: no good for the other which`);
    assert.equal(verifies(pub, signedBytes(domain, DASH, which, got.h, got.body), got.h), false, `${route}: no good for another instance`);
    assert.equal(verifies(pub, Buffer.from(`devteam-pane-answer-v1\n${REC}\n${got.h['x-devteam-gateway-ts']}\n${got.h['x-devteam-gateway-nonce']}\n${sha(got.body).toString('hex')}`), got.h), false, `${route}: no good as a pane answer`);
  }
  // two posts of the same body: two nonces
  await send(cases[0][0], cases[0][3]);
  assert.notEqual(B.rec.at(-1).h['x-devteam-gateway-nonce'], B.rec.at(-2).h['x-devteam-gateway-nonce'], 'a fresh nonce for every post');
  // nothing else under /api/term/ is signed: the reads, another which, another verb, a path the
  // dashboard doesn't route; and never on a preview's name or the terminal's
  B.rec.length = 0;
  for (const [method, route] of [['GET', '/api/term/token'], ['GET', '/api/term/supervisor/screen'], ['POST', '/api/term/other/keys'], ['POST', '/api/term/supervisor/open'], ['POST', '/api/term/supervisor/screen'], ['POST', '/api/term/%73hell/keys'], ['POST', '/api/term/supervisor/keys/']]) {
    const r = await B.at(rec, method, route, { cookie: B.owner, headers: SAME, ...(method === 'POST' ? { body: '{}' } : {}) });
    assert.equal(r.status, 200, `${method} ${route}: ${r.text}`);
    assert.equal(B.rec.length, 1, `${method} ${route}: forwarded once`);
    assert.equal(`${B.rec[0].method} ${B.rec[0].url}`, `${method} ${route}`, `${method} ${route}: the request just sent`);
    assert.equal(B.rec[0].h['x-devteam-gateway-sig'], undefined, `${method} ${route}: not signed`);
    B.rec.length = 0;
  }
  const pv = await B.at(B.on('cool-tiger'), 'POST', '/api/term/supervisor/keys', { cookie: B.owner, body: '{}', headers: SAME });
  assert.equal(pv.status, 200, pv.text);
  assert.equal(B.app.at(-1).h['x-devteam-gateway-sig'], undefined, 'a preview is never signed for');
  const tm = await B.at(`term.${B.host}`, 'POST', '/api/term/supervisor/keys', { cookie: B.owner, body: '{}', headers: SAME });
  assert.equal(tm.status, 404, `the terminal's name has no such route: ${tm.text}`);
});

// f true within ms (a short wait: a red run fails in seconds, not minutes)
const within = async (ms, f) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) if (f()) return true; return f(); };

test('terminal A9: a browser that leaves while its terminal post waits at the instance cancels it there, as every proxied request does', async (t) => {
  const B = await box(t, 'a9-leave');
  for (const route of ['/api/term/supervisor/keys', '/api/term/shell/keys', '/api/term/shell/open']) {
    const r = http.request({ host: '127.0.0.1', port: B.port, method: 'POST', path: route, headers: { host: B.on('rec'), origin: `http://${B.on('rec')}`, 'content-type': 'application/json', cookie: B.owner, ...SAME, 'x-test-hold': '1' } });
    r.on('error', () => {});
    r.end('{}');
    assert.ok(await within(5000, () => B.held.some((x) => x.url === route)), `${route}: reached the instance`);
    r.destroy();
    assert.ok(await within(3000, () => B.held.find((x) => x.url === route).closed), `${route}: the instance saw the browser leave`);
  }
});

test("terminal A9: a terminal post reaches the instance with the gateway's own x-devteam-level, never the browser's, and the same person header a proxied request gets", async (t) => {
  const B = await box(t, 'a9-level');
  // what the gateway tells an instance about this session on any proxied request (kit-252's person, if set)
  const g = await B.at(B.on('rec'), 'GET', '/api/hello', { cookie: B.owner, headers: SAME });
  assert.equal(g.status, 200, g.text);
  const person = B.rec.at(-1).h['x-devteam-person'];
  for (const route of ['/api/term/supervisor/keys', '/api/term/shell/open']) {
    const r = await B.at(B.on('rec'), 'POST', route, { cookie: B.owner, body: '{}', headers: { ...SAME, 'x-devteam-level': 'view', 'x-devteam-person': 'p-forgedforgedf' } });
    assert.equal(r.status, 200, `${route}: ${r.text}`);
    assert.equal(B.rec.at(-1).h['x-devteam-level'], 'full', `${route}: the owner's level, not the browser's`);
    assert.equal(B.rec.at(-1).h['x-devteam-person'], person, `${route}: the person header a proxied request of this session gets`);
  }
});

test('terminal A9: a terminal post over 100 KB is refused 413 before it is forwarded; one at 100 KB goes', async (t) => {
  const B = await box(t, 'a9-cap');
  const rec = B.on('rec');
  const pad = (n) => { const head = '{"which":"shell","pane":"%2","page":"page-0123456789abcdef","seq":1,"token":"t","paste":"'; const tail = '"}'; return head + 'x'.repeat(n - head.length - tail.length) + tail; };
  for (const route of ['/api/term/supervisor/keys', '/api/term/shell/keys', '/api/term/shell/open']) {
    for (const size of [CAP + 1, 4 * CAP]) {
      B.rec.length = 0;
      B.arrived.length = 0;
      const r = await B.at(rec, 'POST', route, { cookie: B.owner, body: pad(size), headers: SAME });
      assert.equal(r.status, 413, `${route} at ${size}: ${r.status} ${r.text.slice(0, 200)}`);
      assert.equal(r.headers['content-type'], 'application/json', `${route}: exactly application/json`);
      assert.equal(typeof r.json?.error, 'string', `${route}: { error }`);
      assert.deepEqual(Object.keys(r.json), ['error'], `${route}: only error`);
      await B.quiet(`${route} at ${size}`);
      assert.equal(B.rec.length, 0, `${route} at ${size}: nothing forwarded`);
      assert.deepEqual(B.arrived, [], `${route} at ${size}: nothing reached the instance, not even its headers`);
    }
    // more than four times over: a 413 or the connection cut, and still nothing forwarded
    B.rec.length = 0;
    B.arrived.length = 0;
    const cut = await B.at(rec, 'POST', route, { cookie: B.owner, body: pad(5 * CAP), headers: SAME }).catch((e) => ({ status: e.code }));
    assert.ok([413, 'ECONNRESET', 'EPIPE'].includes(cut.status), `${route} at 5 x 100 KB: ${cut.status}`);
    await B.quiet(`${route} at 5 x 100 KB`);
    assert.equal(B.rec.length, 0, `${route} at 5 x 100 KB: nothing forwarded`);
    assert.deepEqual(B.arrived, [], `${route} at 5 x 100 KB: nothing reached the instance`);
    // past four times over the gateway answers at once and closes, without waiting for the rest
    const early = await B.stall(rec, route, 4 * CAP + 4096, 8 * CAP, B.owner);
    assert.deepEqual(early, { status: 413, connection: 'close' }, `${route}: cut off past 4 x 100 KB, before the body ends`);
    await B.quiet(`${route} cut off`);
    assert.deepEqual(B.arrived, [], `${route} cut off: nothing reached the instance`);
    B.rec.length = 0;
    const ok = await B.at(rec, 'POST', route, { cookie: B.owner, body: pad(CAP), headers: SAME });
    assert.equal(ok.status, 200, `${route} at exactly 100 KB: ${ok.text}`);
    assert.equal(B.rec.length, 1, `${route} at 100 KB: forwarded`);
    assert.equal(B.rec[0].body.length, CAP, `${route}: the whole body`);
  }
});

test("gateway: the pane answer and the owner's Save are signed as before, under their own names, capped at 20000 bytes with a 400", async (t) => {
  const B = await box(t, 'kept');
  const pub = crypto.createPublicKey(B.g.threadPublicKey());
  const rec = B.on('rec');
  for (const [route, domain] of [['/api/pane-answer', 'devteam-pane-answer-v1'], ['/api/owner-setting', 'devteam-owner-setting-v1']]) {
    const body = JSON.stringify({ route });
    const r = await B.at(rec, 'POST', route, { cookie: B.owner, body, headers: { ...SAME, ...FORGED } });
    assert.equal(r.status, 200, `${route}: ${r.text}`);
    const h = B.rec.at(-1).h;
    assert.equal(verifies(pub, Buffer.from(`${domain}\n${REC}\n${h['x-devteam-gateway-ts']}\n${h['x-devteam-gateway-nonce']}\n${sha(Buffer.from(body)).toString('hex')}`), h), true, `${route}: signed under ${domain}`);
    B.rec.length = 0;
    const big = await B.at(rec, 'POST', route, { cookie: B.owner, body: 'x'.repeat(20001), headers: SAME });
    assert.equal(big.status, 400, `${route} at 20001 bytes: ${big.status} ${big.text}`);
    assert.equal(big.text, '{"error":"missing or invalid fields"}', `${route}: today's refusal`);
    await B.quiet(`${route} at 20001 bytes`);
    assert.equal(B.rec.length, 0, `${route} at 20001 bytes: nothing forwarded`);
  }
});

test("terminal A10: a View session's GET and POST to /api/term/* on an instance's name are refused and never reach it", async (t) => {
  const B = await box(t, 'a10-view');
  const rec = B.on('rec');
  for (const [method, route] of [['GET', '/api/term/token'], ['GET', '/api/term/supervisor/screen'], ['GET', '/api/term/shell/history?before=0&count=1'], ['POST', '/api/term/supervisor/keys'], ['POST', '/api/term/shell/keys'], ['POST', '/api/term/shell/open']]) {
    const r = await B.at(rec, method, route, { cookie: B.view, headers: SAME, ...(method === 'POST' ? { body: '{}' } : {}) });
    assert.equal(r.status, 403, `${method} ${route}: ${r.status} ${r.text}`);
  }
  // as the Terminal page is: a View session's GET / on the terminal's name is refused too (kit-250 rule 1)
  const tp = await B.at(`term.${B.host}`, 'GET', '/', { cookie: B.view, headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } });
  assert.equal(tp.status, 403, `the Terminal page: ${tp.status} ${tp.text.slice(0, 80)}`);
  // View before the cap: an oversized View post reads view, not 413
  const big = await B.at(rec, 'POST', '/api/term/supervisor/keys', { cookie: B.view, headers: SAME, body: 'x'.repeat(CAP + 1) });
  assert.equal(big.status, 403, `an oversized View post: ${big.status} ${big.text.slice(0, 120)}`);
  assert.equal(big.text, VIEW, 'an oversized View post: exactly the view refusal');
  await B.quiet('View');
  assert.deepEqual(B.rec.map((x) => `${x.method} ${x.url}`), [], 'nothing reached the instance');
});

test('terminal A10: a signed-out request to /api/term/* is sent to sign in, and never reaches the instance', async (t) => {
  const B = await box(t, 'a10-out');
  const rec = B.on('rec');
  for (const [method, route] of [['GET', '/api/term/token'], ['GET', '/api/term/supervisor/screen'], ['POST', '/api/term/supervisor/keys'], ['POST', '/api/term/shell/open']]) {
    const r = await B.at(rec, method, route, { headers: SAME, ...(method === 'POST' ? { body: '{}' } : {}) });
    assert.equal(r.status, 401, `${method} ${route}: ${r.status} ${r.text}`);
    assert.equal(r.text, 'sign in with your passkey', `${method} ${route}`);
  }
  const nav = await B.at(rec, 'GET', '/api/term/token', { headers: { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' } });
  assert.equal(nav.status, 401, nav.text);
  assert.match(nav.text, new RegExp(`${B.publicUrl.replace(/[.]/g, '\\.')}/auth/login\\?next=`), 'a page that goes to sign in');
  // a session that has ended is signed out too
  const ended = await B.at(rec, 'GET', '/api/term/token', { cookie: `devteam_session=${u(crypto.randomBytes(32))}`, headers: SAME });
  assert.equal(ended.status, 401, ended.text);
  await B.quiet('signed out');
  assert.deepEqual(B.rec.map((x) => `${x.method} ${x.url}`), [], 'nothing reached the instance');
});

test("terminal A10: another site's request to /api/term/* is refused, signed in or not, and never reaches the instance", async (t) => {
  const B = await box(t, 'a10-site');
  const rec = B.on('rec');
  const posts = ['/api/term/supervisor/keys', '/api/term/shell/keys', '/api/term/shell/open'];
  const other = `rec.box.localhost:${B.port + 1}`;
  for (const origin of [null, 'https://evil.example', `http://${B.on('alpha')}`, `http://${B.on('sib')}`, B.publicUrl, `http://term.${B.host}`, 'null', `https://${rec}`, `http://${other}`, `http://${rec}.evil.example`, `http://${rec}0`, `http://${rec}/`, `http://${B.on('cool-tiger')}`]) {
    for (const route of posts) {
      const r = await B.at(rec, 'POST', route, { cookie: B.owner, body: '{}', headers: { ...SAME, origin } });
      assert.equal(r.status, 403, `${route} from ${origin}: ${r.status} ${r.text}`);
    }
  }
  for (const site of ['cross-site', 'same-site']) {
    for (const route of ['/api/term/token', '/api/term/supervisor/screen']) {
      const r = await B.at(rec, 'GET', route, { cookie: B.owner, headers: { 'sec-fetch-site': site, 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' } });
      assert.equal(r.status, 403, `${route} ${site}: ${r.status} ${r.text}`);
    }
  }
  await B.quiet('another site');
  assert.deepEqual(B.rec.map((x) => `${x.method} ${x.url}`), [], 'nothing reached the instance');
});

test("terminal A10b: the gateway's View refusal of /api/term/* is 403 application/json, exactly {\"why\":\"view\"}, for every path the dashboard routes there", async (t) => {
  const B = await box(t, 'a10b');
  const rec = B.on('rec');
  const routes = [
    ['GET', '/api/term/token'], ['GET', '/api/term/supervisor/screen'], ['GET', '/api/term/supervisor/history?before=0&count=1'],
    ['HEAD', '/api/term/token'], ['POST', '/api/term/supervisor/keys'], ['POST', '/api/term/shell/open'], ['GET', '/api/term/nothing-here'],
    // as the dashboard routes it: percent-decoded, dot segments resolved, repeated slashes folded
    ['GET', '/api/%74erm/token'], ['GET', '/api/x/../term/token'], ['GET', '/api/./term/token'], ['GET', '/api//term/token'], ['GET', '/api/term//supervisor/screen'],
  ];
  for (const [method, route] of routes) {
    const r = await B.at(rec, method, route, { cookie: B.view, headers: SAME, ...(method === 'POST' ? { body: '{}' } : {}) });
    assert.equal(r.status, 403, `${method} ${route}: ${r.status} ${r.text}`);
    assert.equal(r.headers['content-type'], 'application/json', `${method} ${route}: exactly application/json`);
    assert.equal(r.text, method === 'HEAD' ? '' : VIEW, `${method} ${route}: exactly the view refusal${method === 'HEAD' ? ', with no body' : ''}`);
  }
  await B.quiet('View, every spelling');
  assert.deepEqual(B.rec.map((x) => `${x.method} ${x.url}`), [], 'nothing reached the instance');
});
