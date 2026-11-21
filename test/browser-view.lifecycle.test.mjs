// The browser's live view server (kit-66), its lifecycle: forget, the record's renewals and the Library,
// a laptop's relay, the real gateway with a passkey, preview stop and start, the label. Each check is the
// spec's (docs/devteam/project/tickets/kit-66-browser-view-server/spec.md, home), named by its id; split
// from test/browser-view.test.mjs (kit-223) so each file stays inside CI's per-file watchdog. The CLI
// runs async: the fixture site, the stand-in hub and the gateway live in this process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { canDrive } from './lib/chrome.mjs';
import { until, PORTS } from './lib/kit.mjs';
import { PAGE, tmp, sleep, site, a, kitCli, browser, ok, alive, devWindows, readState, recFile, readRec, get, ws, isFrame, BUTTON, within, view, s1, liveState, running, dashboard, viewer, onRecord, viewFile } from './lib/browser-view-fixture.mjs';

// CI's Node 22 and 24 jobs have Chrome: there the file must run, never skip.
const mustRun = !!process.env.CI && Number(process.versions.node.split('.')[0]) >= 22;
const skip = canDrive ? false : 'needs Chrome and Node 22+';
const opts = { skip, timeout: 120000 };
if (mustRun && !canDrive) test('Chrome is needed on CI\'s Node 22+', () => assert.fail('Chrome is needed on CI\'s Node 22+: this file must run there, not skip'));
viewFile();

// The gateway reads its hub port and instance block once, at import: a stand-in hub and a block of
// this file's own (+60, +61..85 of lib/kit.mjs's block), apart from the hub (+0) the dashboard binds.
const GW_HUB = PORTS + 60, GW_BASE = PORTS + 61;
const kept = [process.env.DEVTEAM_HUB_PORT, process.env.DEVTEAM_PORT_BASE];
process.env.DEVTEAM_HUB_PORT = String(GW_HUB);
process.env.DEVTEAM_PORT_BASE = String(GW_BASE);
delete process.env.DEVTEAM_CLAIM_TOKEN;
const G = await import('../cloud/gateway.mjs');
[process.env.DEVTEAM_HUB_PORT, process.env.DEVTEAM_PORT_BASE] = kept;

// --- a software authenticator (cbor and an ES256 key), copied from test/gateway.test.mjs, not shared ---
function cbor(v) {
  const head = (mt, n) => (n < 24 ? Buffer.from([(mt << 5) | n]) : n < 256 ? Buffer.from([(mt << 5) | 24, n]) : (() => { const b = Buffer.alloc(3); b[0] = (mt << 5) | 25; b.writeUInt16BE(n, 1); return b; })());
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error(`cbor: ${typeof v}`);
}
const sha = (b) => crypto.createHash('sha256').update(b).digest();
const b64u = (b) => Buffer.from(b).toString('base64url');
function authenticator() {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
  const id = crypto.randomBytes(16);
  return {
    create(o, origin) {
      const cd = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: o.challenge, origin }));
      const len = Buffer.alloc(2); len.writeUInt16BE(id.length);
      const ad = Buffer.concat([sha(o.rp.id), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, id, cbor(cose)]);
      return { rawId: b64u(id), clientDataJSON: b64u(cd), attestationObject: b64u(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]]))) };
    },
  };
}
// The real gateway in process on http://box.localhost:<port>, claimed by the authenticator: its
// session cookie, and a JSON request on its own name.
async function claimedGateway() {
  const port = await new Promise((r) => { const v = net.createServer(); v.listen(0, '127.0.0.1', () => { const p = v.address().port; v.close(() => r(p)); }); });
  const publicUrl = `http://box.localhost:${port}`;
  const ttydPage = path.join(tmp, 'ttyd.html');
  fs.writeFileSync(ttydPage, 'ttyd');
  const uploadsDir = path.join(tmp, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o750 });
  const logs = [];
  const g = G.createGateway({ publicUrl, dir: fs.mkdtempSync(path.join(tmp, 'gw-')), ttydPort: 1, ttydPage, uploadsDir, log: (m) => logs.push(m) });
  await new Promise((r) => g.server.listen(port, '127.0.0.1', r));
  const close = () => new Promise((r) => { g.server.closeAllConnections?.(); g.server.close(r); });
  try {
  const token = /claim#([A-Za-z0-9_-]+)/.exec(logs.join('\n'))?.[1];
  assert.ok(token, 'the gateway printed a claim link');
  let flowJar = '';
  const post = (route, body) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: route, headers: { host: `box.localhost:${port}`, origin: publicUrl, 'content-type': 'application/json', ...(flowJar ? { cookie: flowJar } : {}) } }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => {
        for (const c of res.headers['set-cookie'] ?? []) if (/^(?:__Host-)?devteam_flow=/.test(c)) flowJar = /;\s*Max-Age=0\b/i.test(c) ? '' : c.split(';')[0];
        resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(b); } catch { return null; } })(), cookie: res.headers['set-cookie']?.find((x) => x.startsWith('devteam_session='))?.split(';')[0] });
      });
    });
    r.on('error', reject);
    r.end(JSON.stringify(body));
  });
  const o = await post('/auth/claim/options', { token });
  assert.equal(o.status, 200);
  const v = await post('/auth/claim/verify', { token, ...authenticator().create(o.json, publicUrl) });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  assert.ok(v.cookie, 'a session cookie');
  return { g, port, cookie: v.cookie, close };
  } catch (e) { await close(); throw e; }
}

// The fixture's login through the agent's verbs: refs read from a snapshot.
const refOf = (snap, role, name) => new RegExp(`^(e\\d+) ${role} "${name}"`, 'm').exec(snap)?.[1] ?? assert.fail(`no ${role} "${name}" in ${snap}`);
async function signIn(P) {
  await ok(P, ['open', `${site.origin}/login`]);
  let s = await ok(P, ['snapshot']);
  await ok(P, ['type', refOf(s, 'textbox', 'Username'), site.username]);
  await ok(P, ['type', refOf(s, 'textbox', 'Password'), site.password]);
  await ok(P, ['click', refOf(s, 'checkbox', 'Remember me')]);
  await ok(P, ['click', refOf(s, 'button', 'Sign in')]);
  s = await ok(P, ['snapshot']);
  await ok(P, ['type', refOf(s, 'textbox', 'Code'), site.code]);
  await ok(P, ['click', refOf(s, 'button', 'Continue')]);
  await ok(P, ['open', `${site.origin}/account`]);
  assert.match(await ok(P, ['snapshot']), /Signed in as owner/);
}

test('I6 forget signs the browser out and restarts it on an empty profile', opts, async () => {
  await running();
  await signIn(a);
  const c = await viewer();
  const old = readState(a);
  const marker = path.join(a.profile, 'kit-66-marker');
  fs.writeFileSync(marker, 'x');
  await sleep(500);
  c.send({ t: 'forget' });
  // state.json is replaced by a rename, never missing while the daemon lives: gone means it stopped
  await within(20000, () => { if (!fs.existsSync(a.state)) assert.fail('the daemon stopped (state.json gone)'); try { const s = readState(a); return s.chrome_pid !== old.chrome_pid; } catch { return false; } }, 'a new Chrome in state.json');
  assert.equal(readState(a).daemon_pid, old.daemon_pid, 'the same daemon');
  await within(20000, () => !alive(old.chrome_pid), 'the old Chrome gone');
  assert.ok(alive(old.daemon_pid), 'the daemon stays');
  assert.equal(fs.existsSync(marker), false, 'the profile was emptied');
  assert.equal(JSON.parse(fs.readFileSync(path.join(a.profile, 'root.json'), 'utf8')).root, fs.realpathSync(a.old));
  // frames after the new Chrome is up and the old one gone: drawn by the new screencast. A page is
  // opened on the new Chrome so it paints: about:blank's one frame may come before n is taken
  const n = c.msgs.length;
  await ok(a, ['open', `${site.origin}/account`]);
  await c.wait(isFrame, 10000, n);
  const seqs = c.msgs.filter(isFrame).map((m) => m.seq);
  for (let i = 1; i < seqs.length; i++) assert.ok(seqs[i] > seqs[i - 1], `the frame count keeps rising over the socket's life: ${seqs.slice(Math.max(0, i - 3), i + 2).join(', ')}`);
  assert.equal(c.closed, null, 'the socket stayed open');
  assert.match(await ok(a, ['snapshot']), /Not signed in/);
  assert.equal(readState(a).preview, view.name);
});

test('B1 a CLI verb during a long forget finds the daemon alive and starts no second one', opts, async () => {
  s1?.close();
  await browser(a, ['stop']);
  // the forget held 12 s (a test hook): longer than browserEnsure's two 5 s liveness pings
  await running({ DEVTEAM_TEST_BROWSER_FORGET_DELAY_MS: '12000' });
  try {
    const c = await viewer();
    const old = readState(a);
    c.send({ t: 'forget' });
    await sleep(500);
    const t0 = Date.now();
    const r = await browser(a, ['start']);
    const took = Date.now() - t0;
    assert.equal(r.status, 0, r.err || r.out);
    assert.match(r.out, /browser running/);
    assert.ok(took < 4000, `answered in ${took} ms, while the forget runs (under 4000)`);
    assert.equal(readState(a).chrome_pid, old.chrome_pid, 'the forget is still running');
    assert.equal(readState(a).daemon_pid, old.daemon_pid, 'the same daemon');
    assert.ok(alive(old.daemon_pid), 'the daemon stays');
    // the forget then ends on the same daemon
    await within(30000, () => { try { return readState(a).chrome_pid !== old.chrome_pid; } catch { return false; } }, 'the forget done');
    assert.equal(readState(a).daemon_pid, old.daemon_pid, 'the same daemon after the forget');
    assert.equal(devWindows(a).filter((x) => x.name === `dev~${view.name}`).length, 1, 'one window');
  } finally {
    s1?.close();
    await browser(a, ['stop']);
    await running();
  }
});

test('V3 the record is renewed within 5 s, with the same window id', opts, async () => {
  await running();
  const r0 = readRec(a, view.name);
  const r1 = await within(5000, () => { const r = readRec(a, view.name); return r.at !== r0.at ? r : null; }, 'a renewal');
  assert.ok(Date.parse(r1.expires) > Date.parse(r0.expires));
  assert.equal(r1.run.window, r0.run.window, 'the same window id');
});

test('V2 it survives the dashboard\'s sweep and the renewals', opts, async () => {
  await dashboard();
  const s = await running();
  // the dashboard ticks every 200 ms and the record renews every second: 3 s is at least 10 ticks
  await sleep(3000);
  const w = devWindows(a).find((x) => x.name === `dev~${view.name}`);
  assert.ok(w, 'the window is still there');
  assert.equal(readRec(a, view.name).run.window, w.id);
  assert.ok(alive(s.daemon_pid), 'the daemon is still there');
});

test('V4 the Library labels it Supervisor\'s browser', opts, async () => {
  const port = await dashboard();
  await running();
  const row = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/api/hello`)).json()).previews?.find((x) => x.name === view.name), 'hello to list the view');
  assert.equal(row.label, "Supervisor's browser");
  assert.match((await kitCli(a, ['preview', 'list'])).out, new RegExp(`${view.name} .*Supervisor's browser`));
});

test('L1 on a laptop, through the dashboard\'s relay', opts, async () => {
  const port = await dashboard();
  await onRecord();
  const r = await (await fetch(`http://127.0.0.1:${port}/api/view?kind=preview&name=${view.name}`)).json();
  assert.match(r.origin ?? '', /^http:\/\/127\.0\.0\.1:\d+$/, JSON.stringify(r));
  const relay = Number(new URL(r.origin).port);
  const page = await get(relay, '/', `127.0.0.1:${relay}`);
  assert.equal(page.status, 200, page.body.toString().slice(0, 200));
  assert.ok(page.body.equals(PAGE), 'browser.html through the relay');
  s1?.close();
  await sleep(300);
  const t0 = Date.now();
  const c = await ws(relay);
  assert.equal(c.status, 101, c.head.split('\r\n')[0]);
  await c.wait(isFrame, Math.max(1, 2000 - (Date.now() - t0)));
  const before = site.events().length;
  c.send({ t: 'mouse', type: 'click', x: BUTTON.x, y: BUTTON.y, button: 'left', clicks: 1 });
  await within(2000, () => site.events().slice(before).some((x) => x.kind === 'click'), 'the click through the relay');
  c.close();
  await sleep(300);
});

// The real gateway, a stand-in hub listing a's hello row for the view under a's root.
async function gatewayOnView() {
  const port = await dashboard();
  await running();
  const row = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/api/hello`)).json()).previews?.find((x) => x.name === view.name), 'hello to list the view');
  const hub = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ hub: 1, instances: [{ devteam: 1, root: fs.realpathSync(a.old), port: GW_BASE, name: 'bview-a', previews: [row] }] })); });
  await new Promise((r) => hub.listen(GW_HUB, '127.0.0.1', r));
  const hubClose = () => new Promise((r) => { hub.closeAllConnections?.(); hub.close(r); });
  let gw;
  try { gw = await claimedGateway(); await gw.g.pollPush(); } catch (e) { await gw?.close(); await hubClose(); throw e; }
  return { gw, host: `${view.name}.box.localhost:${gw.port}`, close: async () => { await gw.close(); await hubClose(); } };
}

test('G1 through the real gateway with a passkey session', opts, async () => {
  await onRecord();
  s1?.close();
  await sleep(300);
  const { gw, host, close } = await gatewayOnView();
  try {
    const page = await get(gw.port, '/', host, { cookie: gw.cookie, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' });
    assert.equal(page.status, 200, page.body.toString().slice(0, 300));
    assert.ok(page.body.equals(PAGE), 'browser.html through the gateway');
    const t0 = Date.now();
    const c = await ws(gw.port, { host, origin: `http://${host}`, cookie: gw.cookie });
    assert.equal(c.status, 101, c.head.split('\r\n')[0]);
    await c.wait(isFrame, Math.max(1, 2000 - (Date.now() - t0)));
    c.close();
    await sleep(300);
  } finally { await close(); }
});

test('G2 without a session the gateway refuses the view', opts, async () => {
  const { gw, host, close } = await gatewayOnView();
  try {
    assert.equal((await ws(gw.port, { host, origin: `http://${host}` })).status, 401, 'a socket without a session');
    assert.equal((await get(gw.port, '/', host, { 'sec-fetch-mode': 'cors' })).status, 401, 'a GET without a session');
  } finally { await close(); }
});

test('V7 preview stop on it stops the browser, whoever runs it', opts, async () => {
  s1?.close();
  const s = await running();
  const r = await kitCli(a, ['preview', 'stop', view.name], { DEVTEAM_ROLE: undefined, DEVTEAM_TICKET: 'kit-1-x' });
  assert.equal(r.status, 0, r.err || r.out);
  assert.match(r.out, /supervisor's browser/);
  await until(() => !alive(s.daemon_pid) && !alive(s.chrome_pid), 'the daemon and Chrome gone');
  assert.equal(fs.existsSync(recFile(a, view.name)), false, 'the record');
  assert.equal(fs.existsSync(a.state), false, 'state.json');
  assert.ok(!devWindows(a).some((x) => x.name === `dev~${view.name}`), 'the window');
});

test('V8 the name is kept across stops and starts', opts, async () => {
  s1?.close();
  await running();
  const name = view.name;
  // a preview stop (works on main by the daemon's SIGHUP), then a browser stop
  await kitCli(a, ['preview', 'stop', name]);
  await until(() => !fs.existsSync(recFile(a, name)), 'the record gone');
  await running();
  assert.equal(view.name, name, 'the same name after preview stop and browser start');
  await ok(a, ['stop']);
  await running();
  assert.equal(view.name, name, 'the same name after browser stop and start');
});

test('V9 preview start on it is browser start: a worker is refused', opts, async () => {
  const s = await running();
  // stopped with its record kept: the daemon signalled, as a crash or a sweep would leave it
  process.kill(s.daemon_pid, 'SIGTERM');
  await until(() => !alive(s.daemon_pid) && !alive(s.chrome_pid), 'the daemon gone');
  assert.ok(fs.existsSync(recFile(a, view.name)), 'the record is kept');
  const w = await kitCli(a, ['preview', 'start', view.name], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'kit-1-x' });
  assert.equal(w.status, 1, w.out);
  assert.match(w.err, /workers ask the supervisor/);
  await sleep(1500);
  assert.equal(liveState(), null, 'no daemon started');
  const sup = await kitCli(a, ['preview', 'start', view.name]);
  assert.equal(sup.status, 0, sup.err || sup.out);
  assert.match(sup.out, /browser running \(preview /);
  const now = await within(10000, liveState, 'the browser up');
  assert.equal(now.preview, view.name);
});

test('the label browser is the browser\'s own', opts, async () => {
  const s = await running();
  for (const args of [['preview', '45999', '--label', 'browser'], ['preview', '--run', 'true', '--label', 'browser']]) {
    const r = await kitCli(a, args);
    assert.equal(r.status, 1, r.out);
    assert.match(r.err, /the label browser is the supervisor's browser's/);
  }
  assert.ok(alive(s.daemon_pid), 'the browser untouched');
  assert.equal(readRec(a, view.name).run.window, devWindows(a).find((x) => x.name === `dev~${view.name}`)?.id);
});
