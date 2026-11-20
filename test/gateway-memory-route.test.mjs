// The box's gateway passes /memory.json through to the hub (kit-599): behind the owner's sign-in,
// as /instances.json is, with since and after checked before the hub is asked, the hub's body
// capped at 2 MB, and its own 502 when the hub isn't answering. The first tests run the real
// standalone hub (a copy of the kit in no repo, as the box image has it) over a fixture readings
// file; the rest put a stand-in on the hub's port to see exactly what the gateway asks of it.
// Run: node --test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PORTS, freePort, kit, until } from './lib/kit.mjs';

// The hub on this file's block (+2), its scan block (+50..+74) with nothing on it: set before the
// gateway is imported, since it reads DEVTEAM_HUB_PORT once, as it loads.
const HUB = PORTS + 2;
const BASE = PORTS + 50;
process.env.DEVTEAM_HUB_PORT = String(HUB);
process.env.DEVTEAM_PORT_BASE = String(BASE);
const G = await import('../cloud/gateway.mjs');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-gwmem-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const CAP = 2 * 1024 * 1024;
const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
const DOWN = '{"error":"the hub isn\'t answering"}';

// --- a software authenticator (as test/gateway.test.mjs has it: a claim needs one) --------------
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
const sha = (b) => crypto.createHash('sha256').update(b).digest();
const u = (b) => Buffer.from(b).toString('base64url');
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

// --- a gateway on a localhost URL (test/gateway.test.mjs's gateway(), the parts used here) -------
const BOX_VARS = ['DEVTEAM_IMAGE_HUB', 'DEVTEAM_KIT_RELEASE', 'DEVTEAM_BOX_TOOLS'];
for (const k of BOX_VARS) delete process.env[k];
async function gateway(t, name, extra = {}) {
  const port = await freePort();
  const publicUrl = `http://box.localhost:${port}`;
  const ttydPage = path.join(scratch, `${name}-ttyd.html`);
  fs.writeFileSync(ttydPage, 'the gateway\'s copy of ttyd');
  const logs = [];
  const uploadsDir = path.join(scratch, `${name}-uploads`);
  fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o750 });
  const g = G.createGateway({ publicUrl, dir: path.join(scratch, name), ttydPort: await freePort(), ttydPage, uploadsDir, log: (m) => logs.push(m), ...extra });
  await new Promise((r) => g.server.listen(port, '127.0.0.1', r));
  t.after(() => new Promise((r) => { g.server.closeAllConnections?.(); g.server.close(r); }));
  const token = /claim#([A-Za-z0-9_-]+)/.exec(logs.join('\n'))?.[1];
  let jar = '';
  let flowJar = ''; // a passkey ceremony's flow cookie, sent beside the session
  const req = (method, route, { body, headers = {}, cookie = jar } = {}) => new Promise((resolve, reject) => {
    const sent = [cookie, route.startsWith('/auth/') ? flowJar : ''].filter(Boolean).join('; ');
    const h = { host: new URL(publicUrl).host, ...(method !== 'GET' ? { origin: publicUrl, 'content-type': 'application/json' } : {}), ...(sent ? { cookie: sent } : {}), ...headers };
    const r = http.request({ host: '127.0.0.1', port, method, path: route, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const b = Buffer.concat(chunks).toString('utf8');
        const sc = res.headers['set-cookie']?.find((c) => c.startsWith('devteam_session='));
        if (sc) jar = sc.split(';')[0];
        for (const c of res.headers['set-cookie'] ?? []) { const m = /^(?:__Host-)?devteam_flow=([^;]*)/.exec(c); if (m) flowJar = /;\s*Max-Age=0\b/i.test(c) ? '' : c.split(';')[0]; }
        let j = null;
        try { j = JSON.parse(b); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: b, json: j });
      });
    });
    r.on('error', reject);
    r.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const claim = async (a) => {
    const o = await req('POST', '/auth/claim/options', { body: { token } });
    assert.equal(o.status, 200, o.body);
    const v = await req('POST', '/auth/claim/verify', { body: { token, ...a.create(o.json, publicUrl) } });
    assert.equal(v.status, 200, v.body);
  };
  return { port, publicUrl, logs, req, claim, jar: () => jar };
}
const signedIn = async (t, name, extra) => { const gw = await gateway(t, name, extra); await gw.claim(authenticator()); assert.ok(gw.jar(), 'a session cookie'); return gw; };

// --- the real standalone hub, over a fixture readings file ---------------------------------------
// The kit as the box image has it: a copy in no repo (test/box-memory-recorder.test.mjs's startHub).
const imageKit = path.join(scratch, 'kit');
fs.cpSync(kit, imageKit, { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
const SCRIPT = path.join(imageKit, 'scripts', 'devteam.mjs');
const NOWHERE = path.join(scratch, 'no-such-machine');
const HUB_WATCH = `const g = Number(process.argv[1]); const end = () => { try { process.kill(-g, 'SIGKILL'); } catch {} process.exit(0); };
process.stdin.on('end', end); process.stdin.on('close', end); process.stdin.on('error', end); process.stdin.resume();`;
// A GET straight to a port on loopback, as nothing but the hub's own machine could send it.
function get(port, route) {
  return new Promise((resolve, reject) => {
    const r = http.get({ host: '127.0.0.1', port, path: route, headers: { host: `127.0.0.1:${port}` }, timeout: 30000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('timeout', () => r.destroy(new Error(`${route} timed out`)));
    r.on('error', reject);
  });
}
async function startHub(t, text) {
  const home = path.join(scratch, `home-${crypto.randomBytes(4).toString('hex')}`);
  const f = path.join(home, '.devteam', `machine-${HUB}`, 'memory.jsonl');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  const e = { ...process.env, HOME: home, DEVTEAM_HUB_PORT: String(HUB), DEVTEAM_PORT_BASE: String(BASE), DEVTEAM_PROC: NOWHERE, DEVTEAM_CGROUP: NOWHERE, DEVTEAM_MEMINFO: NOWHERE, DEVTEAM_MEMORY_RECORD: 'off' };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_HOME', 'TMUX', 'TMUX_PANE']) delete e[k];
  const p = spawn(process.execPath, [SCRIPT, 'hub'], { cwd: home, env: e, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const w = spawn(process.execPath, ['-e', HUB_WATCH, String(p.pid)], { detached: true, stdio: ['pipe', 'ignore', 'ignore'] });
  w.on('error', () => {});
  w.stdin.on('error', () => {});
  w.unref();
  w.stdin.unref();
  let out = '';
  p.stdout.on('data', (b) => { out += b; });
  p.stderr.on('data', (b) => { out += b; });
  const stop = () => { try { w.kill('SIGKILL'); } catch {} return p.exitCode !== null || p.signalCode !== null ? Promise.resolve() : new Promise((r) => { p.once('exit', r); try { process.kill(-p.pid, 'SIGKILL'); } catch { r(); } }); };
  t.after(stop);
  await until(async () => { try { return (await get(HUB, '/instances.json')).status === 200; } catch { return p.exitCode !== null; } }, `the hub on ${HUB}`);
  assert.equal(p.exitCode, null, `the hub runs (${out})`);
  return { stop, out: () => out };
}
// A stand-in on the hub's port: answer(req, res) answers; seen lists the /memory.json paths it was asked.
async function standIn(t, answer) {
  const seen = [];
  const srv = http.createServer((req, res) => { if (req.url.startsWith('/memory')) seen.push(req.url); return answer(req, res); });
  await until(() => new Promise((r) => { srv.once('error', () => r(false)); srv.listen(HUB, '127.0.0.1', () => r(true)); }), 'the hub port, for a stand-in');
  t.after(() => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); }));
  return { seen, close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); }) };
}

// Readings one a minute from 8 days and 2 hours back to a minute ago, each with 19 projects (about
// 2.2 KB a line, as a busy box writes): a day thinned (about 1.3 MB) is under 2 MB, 8 days (about 3 MB) over it.
const NOW = Date.now();
const PROJECTS = Object.fromEntries(Array.from({ length: 19 }, (_, i) => [`project-${String(i).padStart(2, '0')}`, { rss: 123456789 + i, sessions: i % 4, devteam: { dashboard: 110000000, hello: 140000000, wait: 60000000 } }]));
const FIXTURE = (() => {
  const out = [];
  let i = 0;
  for (let at = Math.ceil((NOW - 8 * DAY - 2 * HOUR) / MIN) * MIN; at <= NOW - MIN; at += MIN, i++) out.push(`${JSON.stringify({ v: 1, at: iso(at), working_set: 1e9 + ((i * 7919) % 1000) * 1e6, projects: PROJECTS })}\n`);
  return out.join('');
})();

// The hub's own answer to a route, and the gateway's to the same, taken between two of the hub's so
// a reading crossing the window's edge between the calls can't make them differ.
async function throughAndDirect(gw, route) {
  for (let i = 0; i < 5; i++) {
    const before = await get(HUB, route);
    const through = await gw.req('GET', route);
    const later = await get(HUB, route);
    if (before.status === later.status && before.body === later.body) return { direct: before, through };
  }
  throw new Error(`the hub's answer to ${route} kept changing`);
}

test('C1: the real hub behind the real gateway: since and after pass through a signed-in session with the hub\'s body', async (t) => {
  await startHub(t, FIXTURE);
  const gw = await signedIn(t, 'real');
  // C1a: since=6h is the hub's 6 hours, byte for byte, and not its default 24 hours
  const six = await throughAndDirect(gw, '/memory.json?since=6h');
  assert.equal(six.direct.status, 200, six.direct.body.slice(0, 300));
  assert.equal(six.through.status, 200, six.through.body.slice(0, 300));
  assert.equal(six.through.headers['content-type'], 'application/json');
  assert.equal(six.through.headers['x-content-type-options'], 'nosniff');
  assert.equal(six.through.headers['cache-control'], 'no-store');
  assert.equal(six.through.body, six.direct.body, 'the hub\'s body as it sent it');
  const n6 = six.through.json.readings.length;
  assert.ok(n6 >= 359 && n6 <= 361, `${n6} readings in 6 hours`);
  const day = await throughAndDirect(gw, '/memory.json');
  assert.equal(day.through.status, 200);
  assert.ok(Buffer.byteLength(day.direct.body) < CAP, 'a day is under the cap');
  assert.equal(day.through.body, day.direct.body, 'no parameters: the hub\'s default day');
  assert.ok(day.through.json.readings.length > n6 + 100, 'since reached the hub: 6 hours is not the default day');
  // C1b: after=<at> is the readings newer than that at, unthinned
  const at = six.through.json.readings.at(-31).at;
  const route = `/memory.json?after=${encodeURIComponent(at)}`;
  const newer = await throughAndDirect(gw, route);
  assert.equal(newer.through.status, 200, newer.through.body.slice(0, 300));
  assert.equal(newer.through.body, newer.direct.body);
  assert.equal(newer.through.json.readings.length, 30, 'after reached the hub');
  assert.ok(newer.through.json.readings.every((r) => r.at > at));
  // C1c: both together pass as the hub takes them (after wins there)
  const both = await throughAndDirect(gw, `/memory.json?since=6h&after=${encodeURIComponent(at)}`);
  assert.equal(both.through.status, 200);
  assert.equal(both.through.body, both.direct.body);
  // C1d: the hub's own refusal goes back as it is: an after over 6 hours old is its 400, which the
  // Overview reads as "ask for the day again"
  const old = await throughAndDirect(gw, `/memory.json?after=${encodeURIComponent(iso(Date.now() - 7 * HOUR))}`);
  assert.equal(old.direct.status, 400);
  assert.equal(old.through.status, 400);
  assert.deepEqual(old.through.json, JSON.parse(old.direct.body));
  assert.match(old.through.json.error, /more than 6 hours back/);
});

test('C2: without a session, /memory.json is refused exactly as /instances.json is', async (t) => {
  await startHub(t, FIXTURE);
  const gw = await signedIn(t, 'anon');
  const same = (a, b, what) => {
    assert.equal(a.status, b.status, what);
    assert.equal(a.body, b.body, what);
    assert.equal(a.headers['content-type'], b.headers['content-type'], what);
    assert.equal(a.json?.readings, undefined, `${what}: no readings`);
  };
  for (const cookie of ['', 'devteam_session=not-a-session', `${gw.jar()}x`]) {
    const list = await gw.req('GET', '/instances.json', { cookie });
    assert.equal(list.status, 401, `a claimed box without a session (${cookie || 'no cookie'})`);
    for (const q of ['/memory.json', '/memory.json?since=6h', '/memory.json?since=nonsense', `/memory.json?after=${encodeURIComponent(iso(Date.now() - HOUR))}`]) same(await gw.req('GET', q, { cookie }), list, `${q} with ${cookie || 'no cookie'}`);
  }
  // a page navigated to without a session is sent to sign in, and back to what it asked for
  const nav = { 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'none' };
  const listNav = await gw.req('GET', '/instances.json', { cookie: '', headers: nav });
  const memNav = await gw.req('GET', '/memory.json?since=6h', { cookie: '', headers: nav });
  assert.equal(listNav.status, 302);
  assert.equal(memNav.status, listNav.status);
  assert.equal(memNav.headers.location, listNav.headers.location.replace(encodeURIComponent('/instances.json'), encodeURIComponent('/memory.json?since=6h')));
  // an unclaimed box answers no one
  const bare = await gateway(t, 'unclaimed');
  const ulist = await bare.req('GET', '/instances.json');
  assert.equal(ulist.status, 403);
  same(await bare.req('GET', '/memory.json?since=6h'), ulist, 'an unclaimed box');
});

test('C3: a hub body over 2 MB is refused with 502 and a log line, never truncated', async (t) => {
  await startHub(t, FIXTURE);
  const gw = await signedIn(t, 'big');
  const direct = await get(HUB, '/memory.json?since=8d');
  assert.equal(direct.status, 200);
  assert.ok(Buffer.byteLength(direct.body) > CAP, `the hub's 8 days is ${Buffer.byteLength(direct.body)} bytes, over 2 MB`);
  const before = gw.logs.length;
  const r = await gw.req('GET', '/memory.json?since=8d');
  assert.equal(r.status, 502);
  assert.equal(r.headers['content-type'], 'application/json');
  assert.ok(r.json && typeof r.json.error === 'string' && /2 MB/.test(r.json.error), r.body.slice(0, 300));
  assert.equal(r.json.readings, undefined, 'none of the readings');
  assert.ok(r.body.length < 1000, 'its own short answer, not the start of the hub\'s');
  assert.ok(gw.logs.slice(before).some((l) => /memory\.json/.test(l) && /2 MB/.test(l)), `a log line (${gw.logs.slice(before).join(' | ')})`);
  // and a day, under the cap, still passes
  assert.equal((await gw.req('GET', '/memory.json?since=24h')).status, 200);
});

test('C4: with the hub down, the route answers its own 502, never another route\'s body', async (t) => {
  const hub = await startHub(t, FIXTURE);
  const gw = await signedIn(t, 'down');
  assert.equal((await gw.req('GET', '/memory.json?since=6h')).status, 200, 'up first');
  await hub.stop();
  await until(async () => { try { await get(HUB, '/instances.json'); return false; } catch { return true; } }, 'the hub gone');
  for (const q of ['/memory.json', '/memory.json?since=6h', `/memory.json?after=${encodeURIComponent(iso(Date.now() - HOUR))}`]) {
    const r = await gw.req('GET', q);
    assert.equal(r.status, 502, q);
    assert.equal(r.headers['content-type'], 'application/json', q);
    assert.equal(r.body, DOWN, q);
  }
  assert.notEqual((await gw.req('GET', '/instances.json')).body, DOWN, '/instances.json keeps its own down answer');
});

test('C5: since and after are checked before the hub is asked; only they pass, as given', async (t) => {
  const s = await standIn(t, (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(req.url.startsWith('/memory.json') ? '{"v":1,"readings":[]}' : '{"hub":1,"instances":[]}'); });
  const gw = await signedIn(t, 'guards');
  const recent = iso(Date.now() - 30 * MIN);
  const bad = ['since=9d', 'since=193h', 'since=24', 'since=h', 'since=1w', 'since=1000h', 'since=0h', 'since=0d', 'since=', 'since', 'since=24H', 'since=+24h', 'since=%2024h', 'since=24h%20', 'since=24h&since=1h', 'since=1e2h',
    'after=yesterday', 'after=', 'after', 'after=2026-02-30T00:00:00Z', 'after=2026-11-20T25:00:00Z', `after=${encodeURIComponent(recent.replace('Z', '.5Z'))}`, `after=${encodeURIComponent(recent.replace('Z', '.0000Z'))}`, 'after=2026-11-20T23:59:60Z', `after=${encodeURIComponent(recent.replace('Z', ''))}`, `after=${encodeURIComponent(recent.replace('Z', '+00:00'))}`, `after=${Date.now()}`, `after=${encodeURIComponent(recent)}&after=${encodeURIComponent(recent)}`,
    'thin=0', 'thin=1', 'since=24h&thin=0', `after=${encodeURIComponent(recent)}&thin=0`, 'foo=1', 'since=24h&foo=1', '__proto__=1', 'since=6h&since=6h'];
  for (const q of bad) {
    const r = await gw.req('GET', `/memory.json?${q}`);
    assert.equal(r.status, 400, q);
    assert.equal(r.headers['content-type'], 'application/json', q);
    assert.equal(typeof r.json?.error, 'string', q);
  }
  assert.deepEqual(s.seen, [], 'none of them reached the hub');
  const good = [['', '/memory.json'], ['?', '/memory.json'], ['?since=1h', '/memory.json?since=1h'], ['?since=6h', '/memory.json?since=6h'], ['?since=24h', '/memory.json?since=24h'], ['?since=8d', '/memory.json?since=8d'], ['?since=192h', '/memory.json?since=192h'], ['?since=008d', '/memory.json?since=008d'],
    [`?after=${encodeURIComponent(recent)}`, `/memory.json?after=${encodeURIComponent(recent)}`], [`?after=${recent}`, `/memory.json?after=${encodeURIComponent(recent)}`], [`?after=${encodeURIComponent(recent.replace('Z', '.250Z'))}`, `/memory.json?after=${encodeURIComponent(recent.replace('Z', '.250Z'))}`],
    [`?after=${encodeURIComponent(recent)}&since=6h`, `/memory.json?since=6h&after=${encodeURIComponent(recent)}`]];
  for (const [q, want] of good) {
    const was = s.seen.length;
    const r = await gw.req('GET', `/memory.json${q}`);
    assert.equal(r.status, 200, q);
    assert.equal(r.body, '{"v":1,"readings":[]}', q);
    assert.deepEqual(s.seen.slice(was), [want], `${q}: the hub is asked ${want}`);
  }
});

test('C6: the cap is 2 MB exactly, and only JSON from the hub goes back', async (t) => {
  let answer = null;
  const s = await standIn(t, (req, res) => answer(req, res));
  const gw = await signedIn(t, 'cap', { hubDeadlineMs: 1500 });
  const sized = (n) => { const head = '{"v":1,"readings":[],"pad":"'; return `${head}${'x'.repeat(n - head.length - 2)}"}`; };
  // exactly 2 MB passes, whole; one byte more is refused, sent at once or in pieces
  answer = (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(sized(CAP)); };
  const at = await gw.req('GET', '/memory.json');
  assert.equal(at.status, 200);
  assert.equal(at.body, sized(CAP));
  answer = (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(sized(CAP + 1)); };
  assert.equal((await gw.req('GET', '/memory.json')).status, 502);
  answer = (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); const b = sized(CAP + 1); res.write(b.slice(0, 1000)); setTimeout(() => res.end(b.slice(1000)), 50); };
  const pieces = await gw.req('GET', '/memory.json');
  assert.equal(pieces.status, 502);
  assert.match(pieces.json.error, /2 MB/);
  // whatever else holds the port: a page, a 404, a reset, a 200 that isn't JSON, a hang
  const notReadings = [
    (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<script>evil()</script>'); },
    (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('[1,2,3]'); },
    (req, res) => { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); },
    (req, res) => { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"who are you"}'); },
    (req, res) => { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"nope":1}'); },
    (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"v":1,"readings":['); res.socket.destroy(); },
    (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"v":1,'); },
    () => {},
  ];
  for (const [i, f] of notReadings.entries()) {
    answer = f;
    const r = await gw.req('GET', '/memory.json?since=6h');
    assert.equal(r.status, 502, `answer ${i}`);
    assert.equal(r.body, DOWN, `answer ${i}`);
  }
  // the hub's JSON refusals go back as refusals: 400 and 500 with their one line of error
  answer = (req, res) => { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"memory readings unavailable","extra":"x"}'); };
  const five = await gw.req('GET', '/memory.json');
  assert.equal(five.status, 500);
  assert.deepEqual(five.json, { error: 'memory readings unavailable' });
  answer = (req, res) => { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'y'.repeat(2000) })); };
  const four = await gw.req('GET', '/memory.json');
  assert.equal(four.status, 400);
  assert.equal(four.json.error.length, 600, 'one line, at most 600 characters');
  // the gateway asks as the hub's own page does: on its port, the same origin
  let headers = null;
  answer = (req, res) => { headers = req.headers; res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"v":1,"readings":[]}'); };
  await gw.req('GET', '/memory.json', { headers: { 'sec-fetch-site': 'same-origin', 'x-forwarded-for': '203.0.113.9' } });
  assert.equal(headers.host, `127.0.0.1:${HUB}`);
  assert.equal(headers['sec-fetch-site'], 'same-origin');
  assert.equal(headers.cookie, undefined, 'never the owner\'s cookie');
  assert.equal(headers['x-forwarded-for'], undefined, 'nothing else of the owner\'s request');
  assert.ok(s.seen.length > 0);
});

test('C7: no other path is newly passed through', async (t) => {
  const s = await standIn(t, (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"v":1,"readings":[]}'); });
  const gw = await signedIn(t, 'paths');
  for (const p of ['/memory.jsonx', '/memory.json/x', '/memory.json/', '/memory.jsonl', '/Memory.json', '/memory.JSON', '/memory', '/memory.json.gz', '/x/memory.json', '/memory.json%2F', '/memory%2Ejson', '/operator/memory.json']) {
    assert.equal((await gw.req('GET', p)).status, 404, p);
    assert.equal((await gw.req('GET', `${p}?since=6h`)).status, 404, `${p}?since=6h`);
  }
  for (const m of ['HEAD', 'POST', 'PUT', 'DELETE']) assert.equal((await gw.req(m, '/memory.json', m === 'POST' || m === 'PUT' ? { body: {} } : {})).status, 404, m);
  assert.deepEqual(s.seen, [], 'none reached the hub');
});
