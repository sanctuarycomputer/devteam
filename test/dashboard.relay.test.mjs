// The laptop's relay for previews: the lens, the app's Host and Origin, its ports, WebSockets, and a preview's viewer.
// Ports: +0/+1..25 lib/kit.mjs's; +62..79 the laptop's relays (DEVTEAM_RELAY_PORTS)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { PORTS, kit, freePort, write, startDashboard, until, statusWithHost, threadsFixture } from './lib/kit.mjs';
import { fakeApp, cleanup } from './lib/dashboard-page.mjs';

// An HTTP/1.1 request by hand (fetch can't set Host or keep a socket open): the status line and headers.
function rawRequest(port, lines) {
  return new Promise((resolve, reject) => {
    const c = net.connect(port, '127.0.0.1', () => c.write(`${lines.join('\r\n')}\r\n\r\n`));
    let got = '';
    c.on('data', (d) => { got += d; if (/\r\n\r\n[\s\S]*\n/.test(got) || /^HTTP\/1\.1 [45]/.test(got)) { c.destroy(); resolve(got); } });
    c.on('error', reject);
    setTimeout(() => { c.destroy(); resolve(got); }, 3000);
  });
}
// A socket by hand, kept open: what it has been sent so far, and closed once either end has closed it.
// halfOpen: it never ends its own side, so only the other end's destroy closes it.
function rawSocket(port, lines, { halfOpen = false } = {}) {
  const c = net.connect({ port, host: '127.0.0.1', allowHalfOpen: halfOpen }, () => c.write(`${lines.join('\r\n')}\r\n\r\n`));
  const S = { c, got: '', closed: false };
  c.once('close', () => { S.closed = true; });
  c.on('data', (d) => { S.got += d; });
  c.on('error', () => {});
  return S;
}
// The laptop's relays, in a range of this file's own block of ports (lib/ports.mjs), off every other
// test file's and checkout's: the ports test holds all of it.
const RELAY_LO = PORTS + 62;
const RELAY_HI = PORTS + 79;
const RELAY_ENV = { DEVTEAM_RELAY_PORTS: `${RELAY_LO}-${RELAY_HI}` };

test("the laptop's relay: the lens on GET alone, the app with localhost as its Host and Origin, its framing given way only to its lens", async (t) => {
  const F = threadsFixture('relay-http');
  const later = cleanup(t);
  later(() => F.done());
  const app = await fakeApp();
  later(() => app.close());
  // an app that refuses every frame, and names its own socket's origin in its policy
  app.headers = { 'x-frame-options': 'DENY', 'content-security-policy': `default-src 'self'; frame-ancestors 'none'; connect-src ws://localhost:${app.port}` };
  const name = /preview (\S+) /.exec(F.sup(['preview', String(app.port), '--label', 'relay']))[1];
  const port = await freePort();
  const B = `http://127.0.0.1:${port}`;
  const d = startDashboard(F.old, F.env({ DEVTEAM_PREVIEW_TICK_MS: '500', ...RELAY_ENV }), ['--port', String(port)]);
  later(() => d.stop());
  await until(() => new RegExp(`dashboard on http://127\\.0\\.0\\.1:${port}\\b`).test(d.out()), 'the dashboard');
  // another site's page can't open one, and a GET of anything else here opens none
  assert.equal((await fetch(`${B}/api/view?kind=preview&name=${name}`, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403, 'another site\'s page can\'t open one');
  assert.equal((await fetch(`${B}/api/view?kind=preview&name=quiet-otter`)).status, 404, 'no such preview');
  // asked several times at once: one ask opened it, and only that one says so
  const asks = await Promise.all(Array.from({ length: 6 }, async () => (await fetch(`${B}/api/view?kind=preview&name=${name}`)).json()));
  const v = asks.find((a) => a.opened) ?? asks[0];
  assert.deepEqual(asks.map((a) => a.opened).sort(), [false, false, false, false, false, true], 'exactly one ask opened it');
  assert.ok(asks.every((a) => a.origin === v.origin), 'all of them the one relay');
  assert.deepEqual((({ origin, opened }) => ({ origin, opened }))(await (await fetch(`${B}/api/view?kind=preview&name=${name}`)).json()), { origin: v.origin, opened: false }, 'the next finds it open');
  const R = Number(/^http:\/\/127\.0\.0\.1:(\d+)$/.exec(v.origin)?.[1]);
  assert.ok(R >= RELAY_LO && R <= RELAY_HI, `a relay in the range it was given: ${v.origin}`);
  const rel = `http://127.0.0.1:${R}`;
  // the lens, as the gateway serves it, under a policy for the hub and every instance here
  let r = await fetch(`${rel}/.devteam/lens?route=%2F`);
  assert.equal(r.status, 200);
  const G = await import('../cloud/gateway.mjs');
  assert.equal(await r.text(), G.PREVIEW_LENS);
  // the hub, every instance in the block, and this dashboard itself (pinned here outside the block), each once
  const instances = Array.from({ length: 25 }, (_, i) => `http://127.0.0.1:${PORTS + 1 + i}`);
  assert.equal(r.headers.get('content-security-policy'), G.previewLensCsp([...new Set([`http://127.0.0.1:${PORTS}`, ...instances, `http://127.0.0.1:${port}`, `http://localhost:${port}`])].join(' ')));
  assert.deepEqual(app.seen.filter((x) => x.url !== '/api/hello'), [], 'the lens never asks the app (the relay\'s one look at /api/hello, to know it isn\'t a dashboard, aside)');
  // any other method or path there is the app's
  for (const [method, p] of [['HEAD', '/.devteam/lens'], ['POST', '/.devteam/lens'], ['GET', '/.devteam/lens/x'], ['GET', '/.devteam/lensx']]) {
    r = await fetch(`${rel}${p}`, { method });
    assert.equal(r.status, 200, `${method} ${p}`);
    assert.deepEqual([app.seen.at(-1).method, app.seen.at(-1).url], [method, p]);
  }
  // the app sees localhost, as the gateway gives it: its Host, and an Origin that was the relay's
  await fetch(`${rel}/page?x=1`, { method: 'POST', headers: { origin: rel }, body: 'x' });
  assert.deepEqual(app.seen.at(-1), { method: 'POST', url: '/page?x=1', host: `localhost:${app.port}`, origin: `http://localhost:${app.port}` });
  assert.equal(await statusWithHost(R, '/page', `localhost:${R}`, 'POST', { origin: `http://localhost:${R}` }), 200);
  assert.deepEqual(app.seen.at(-1), { method: 'POST', url: '/page', host: `localhost:${app.port}`, origin: `http://localhost:${app.port}` }, 'the relay\'s other name for itself too');
  await fetch(`${rel}/page`, { method: 'POST', headers: { origin: 'http://evil.example' }, body: 'x' });
  assert.equal(app.seen.at(-1).origin, 'http://evil.example', 'another Origin passes as it is, for the app to refuse');
  await fetch(`${rel}/page`, { method: 'POST', headers: { origin: B }, body: 'x' });
  assert.equal(app.seen.at(-1).origin, B, 'the dashboard\'s own Origin is not the relay\'s');
  // its own origin in a policy or a redirect is the relay's
  r = await fetch(`${rel}/go`, { redirect: 'manual' });
  assert.equal(r.headers.get('location'), `${rel}/there`);
  // a top-level load: the app's own framing headers
  r = await fetch(`${rel}/`, { headers: { 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' } });
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.match(r.headers.get('content-security-policy'), new RegExp(`frame-ancestors 'none'; connect-src ws://127\\.0\\.0\\.1:${R}$`));
  // framed from its own origin, which is how its lens holds it: given way to the lens, the hub and this dashboard
  const ancestors = `'self' http://127.0.0.1:${PORTS} http://127.0.0.1:${port} http://localhost:${port}`;
  r = await fetch(`${rel}/`, { headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' } });
  assert.equal(r.headers.get('x-frame-options'), null);
  assert.equal(r.headers.get('content-security-policy'), `default-src 'self'; frame-ancestors ${ancestors}; connect-src ws://127.0.0.1:${R}`);
  for (const h of [{ 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-site' }, { 'sec-fetch-dest': 'frame', 'sec-fetch-site': 'same-origin' }, { 'sec-fetch-dest': 'document', 'sec-fetch-site': 'same-origin' }, { 'sec-fetch-dest': 'document', 'sec-fetch-site': 'cross-site' }]) assert.equal((await fetch(`${rel}/`, { headers: h })).headers.get('x-frame-options'), 'DENY', JSON.stringify(h));
  // another site's frame (or one that doesn't say whose it is) is refused outright, the lens too, as the gateway refuses it
  const before = app.seen.length;
  for (const dest of ['iframe', 'frame', 'object', 'embed', 'fencedframe']) {
    for (const site of ['cross-site', 'none', null]) {
      for (const p of ['/', '/.devteam/lens']) {
        r = await fetch(`${rel}${p}`, { headers: { 'sec-fetch-dest': dest, ...(site ? { 'sec-fetch-site': site } : {}) } });
        assert.equal(r.status, 403, `${dest} ${site} ${p}`);
        assert.equal(await r.text(), 'not in another site\'s frame');
      }
    }
  }
  assert.equal(app.seen.length, before, 'none of those reached the app');
  // an app that says nothing of frames gets that policy as its own, on that load only
  app.headers = {};
  r = await fetch(`${rel}/`, { headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' } });
  assert.equal(r.headers.get('content-security-policy'), `frame-ancestors ${ancestors}`);
  assert.equal((await fetch(`${rel}/`)).headers.get('content-security-policy'), null);
  // only on its own address (DNS rebinding), and no service worker, which would outlive this preview on its port
  const seen = app.seen.length;
  assert.equal(await statusWithHost(R, '/', `rebound.example:${R}`), 421);
  assert.equal(await statusWithHost(R, '/.devteam/lens', `rebound.example:${R}`), 421);
  assert.equal(await statusWithHost(R, '/sw.js', `127.0.0.1:${R}`, 'GET', { 'service-worker': 'script' }), 403);
  assert.equal(await statusWithHost(R, '/sw.js', `127.0.0.1:${R}`, 'GET', { 'sec-fetch-dest': 'serviceworker' }), 403);
  assert.equal(app.seen.length, seen, 'none of those reached the app');
  // a dev server can't take a relay's port: 4800-4899 unless told otherwise, and then the range it's given
  assert.match(F.fails(['preview', '4801'], F.SUP), /4801 is where the dashboard's preview relays listen \(4800-4899\)/);
  assert.match(F.fails(['preview', String(RELAY_LO + 1)], { ...F.SUP, ...RELAY_ENV }), new RegExp(`${RELAY_LO + 1} is where the dashboard's preview relays listen \\(${RELAY_LO}-${RELAY_HI}\\)`));
  const moved = /preview (\S+) /.exec(F.sup(['preview', '4801', '--label', 'moved'], RELAY_ENV))[1];
  F.sup(['preview', 'stop', moved]);
  // a record from before the range stays a preview: only a new registration is refused
  const old = path.join(F.old, 'docs/devteam/run/previews', 'quiet-otter.json');
  write(old, JSON.stringify({ v: 1, name: 'quiet-otter', project: 'relay-http', session: 'supervisor', label: 'old', port: 4802, cwd: F.old, at: new Date().toISOString(), expires: new Date(Date.now() + 86400000).toISOString() }));
  assert.ok(JSON.parse(F.sup(['preview', 'list', '--json'])).some((x) => x.name === 'quiet-otter' && x.port === 4802), 'still listed');
  fs.rmSync(old);
  // the record gone, the relay closes
  F.sup(['preview', 'stop', name]);
  await until(async () => { try { await fetch(`${rel}/`); return false; } catch { return true; } }, 'the relay closed with its record');
});
test("the laptop's relay: a port anything holds is passed over, none free keeps nothing, and a record moved closes its relay", async (t) => {
  const F = threadsFixture('relay-ports');
  const later = cleanup(t);
  later(() => F.done());
  const app = await fakeApp();
  later(() => app.close());
  const name = /preview (\S+) /.exec(F.sup(['preview', String(app.port), '--label', 'ports']))[1];
  const port = await freePort();
  const B = `http://127.0.0.1:${port}`;
  const d = startDashboard(F.old, F.env({ DEVTEAM_PREVIEW_TICK_MS: '500', ...RELAY_ENV }), ['--port', String(port)]);
  later(() => d.stop());
  await until(() => new RegExp(`dashboard on http://127\\.0\\.0\\.1:${port}\\b`).test(d.out()), 'the dashboard');
  const view = async () => (({ origin, opened }) => ({ origin, opened }))(await (await fetch(`${B}/api/view?kind=preview&name=${name}`)).json());
  // every port of the range held (those free now, by this test)
  const hold = (p, h) => new Promise((resolve) => { const s = net.createServer(); s.once('error', () => resolve(null)); s.listen(p, h, () => resolve(s)); });
  const held = new Map();
  later(() => { for (const s of held.values()) s.close(); });
  for (let p = RELAY_LO; p <= RELAY_HI; p++) { const s = await hold(p, '127.0.0.1'); if (s) held.set(p, s); }
  assert.ok(held.size >= 3, `three ports of ${RELAY_LO}-${RELAY_HI} free to test with: ${held.size}`);
  assert.deepEqual(await view(), { origin: null, opened: false }, 'none free');
  assert.deepEqual(await view(), { origin: null, opened: false }, 'and asked again, it looks again');
  // three let go: the first now a dev server's on ::1 alone (localhost), the second an old record's
  const [a, b, c] = [...held.keys()];
  for (const p of [a, b, c]) { await new Promise((r) => held.get(p).close(r)); held.delete(p); }
  const six = await hold(a, '::1');
  if (six) held.set(-1, six);
  const rec = path.join(F.old, 'docs/devteam/run/previews', 'quiet-otter.json');
  write(rec, JSON.stringify({ v: 1, name: 'quiet-otter', project: 'relay-ports', session: 'supervisor', label: 'old', port: b, cwd: F.old, at: new Date().toISOString(), expires: new Date(Date.now() + 86400000).toISOString() }));
  const v = await view();
  assert.deepEqual(v, { origin: `http://127.0.0.1:${six ? c : a}`, opened: true }, 'the first port nothing holds');
  assert.equal((await fetch(`${v.origin}/x`)).status, 200);
  assert.equal(app.seen.at(-1).url, '/x');
  // its record now names another port: the relay closes on the tick after, and the next ask opens one for it
  const app2 = await fakeApp();
  later(() => app2.close());
  const file = path.join(F.old, 'docs/devteam/run/previews', `${name}.json`);
  write(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), port: app2.port }));
  await until(async () => { try { await fetch(`${v.origin}/`); return false; } catch { return true; } }, 'the relay closed with its record\'s port');
  const v2 = await view();
  assert.equal(v2.opened, true);
  await fetch(`${v2.origin}/moved`);
  assert.equal(app2.seen.at(-1).url, '/moved');
});
test("the laptop's relay never serves a dashboard: not this one's own port, not any port that answers as one, and none registers", async (t) => {
  const F = threadsFixture('relay-dash');
  const later = cleanup(t);
  later(() => F.done());
  // a page that answers a dashboard's hello, as another checkout's would
  // (a process of its own: the CLI calls below block this one's event loop)
  const child = spawn(process.execPath, ['-e', `const s = require('http').createServer((q, r) => { if (q.url !== '/api/hello') process.stderr.write('x'); r.end('{"devteam":1,"viewer":1}'); }).listen(0, '127.0.0.1', () => console.log(s.address().port));`], { stdio: ['ignore', 'pipe', 'pipe'] });
  later(() => child.kill());
  let stray = 0;
  child.stderr.on('data', (c) => { stray += c.length; });
  const other = { port: Number(await new Promise((resolve) => child.stdout.once('data', resolve))) };
  const port = await freePort();
  const B = `http://127.0.0.1:${port}`;
  const d = startDashboard(F.old, F.env({ DEVTEAM_PREVIEW_TICK_MS: '500', ...RELAY_ENV }), ['--port', String(port)]);
  later(() => d.stop());
  await until(() => new RegExp(`dashboard on http://127\\.0\\.0\\.1:${port}\\b`).test(d.out()), 'the dashboard');
  // a new registration is refused for either
  assert.match(F.fails(['preview', String(port)], F.SUP), /devteam dashboard|own dashboard/);
  assert.match(F.fails(['preview', String(other.port)], F.SUP), /is a devteam dashboard/);
  assert.match(F.fails(['preview', '--run', 'true', '--port', String(other.port)], F.SUP), /is a devteam dashboard/);
  // records made another way (by hand, or before the rule) are listed, and never relayed
  for (const [n, pt] of [['quiet-otter', port], ['calm-heron', other.port]]) {
    write(path.join(F.old, 'docs/devteam/run/previews', `${n}.json`), JSON.stringify({ v: 1, name: n, project: 'relay-dash', session: 'supervisor', label: n, port: pt, cwd: F.old, at: new Date().toISOString(), expires: new Date(Date.now() + 86400000).toISOString() }));
    const r = await (await fetch(`${B}/api/view?kind=preview&name=${n}`)).json();
    assert.deepEqual([r.origin, r.opened], [null, false], `${n} is not relayed`);
  }
  assert.equal(stray, 0, 'nothing but the hello reached it');
});
test("what the relay forwards carries a mark every owner route refuses, and a target that turns into a dashboard closes its relay", async (t) => {
  const F = threadsFixture('relay-mark');
  const later = cleanup(t);
  later(() => F.done());
  const pages = { '/': '<title>App</title>' };
  const app = await fakeApp({}, pages);
  later(() => app.close());
  const name = /preview (\S+) /.exec(F.sup(['preview', String(app.port), '--label', 'mark']))[1];
  const port = await freePort();
  const B = `http://127.0.0.1:${port}`;
  const d = startDashboard(F.old, F.env({ DEVTEAM_PREVIEW_TICK_MS: '500', ...RELAY_ENV }), ['--port', String(port)]);
  later(() => d.stop());
  await until(() => new RegExp(`dashboard on http://127\\.0\\.0\\.1:${port}\\b`).test(d.out()), 'the dashboard');
  const v = await (await fetch(`${B}/api/view?kind=preview&name=${name}`)).json();
  const rel = v.origin;
  // a normal app sees all its traffic, each request marked, whatever the page sent
  const n = app.marks.length;
  await fetch(`${rel}/a`, { headers: { 'x-devteam-relay': '0' } });
  await fetch(`${rel}/b`, { method: 'POST', body: 'x', headers: { origin: rel } });
  assert.deepEqual(app.marks.slice(n), ['1', '1'], 'set fresh, a page\'s own copy replaced');
  assert.equal(app.seen.at(-1).url, '/b');
  // the dashboard refuses a marked request on every route, with localhost as Host and Origin as the relay sends them
  const as = (route, method = 'GET') => fetch(`${B}${route}`, { method, headers: { host: `localhost:${port}`, origin: `http://localhost:${port}`, 'x-devteam-relay': '1', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
  for (const [route, method] of [['/api/action', 'POST'], ['/api/answer', 'POST'], ['/api/threads', 'GET'], ['/api/data', 'GET'], ['/api/hello', 'GET'], ['/api/view?kind=preview&name=' + name, 'GET'], ['/', 'GET'], ['/view/preview/' + name, 'GET']]) {
    const r = await statusWithHost(port, route, `localhost:${port}`, method, { origin: `http://localhost:${port}`, 'x-devteam-relay': '1', 'sec-fetch-site': 'same-origin' });
    assert.equal(r, 403, `${method} ${route}`);
  }
  assert.equal(await statusWithHost(port, '/api/hello', `localhost:${port}`), 200, 'unmarked, the same host is served');
  // the target now answers as a dashboard: the tick closes the relay
  pages['/api/hello'] = '{"devteam":1,"viewer":1}';
  await until(async () => { try { await fetch(`${rel}/x`); return false; } catch { return true; } }, 'the relay closed once its target answered as a dashboard');
  assert.ok(!d.out().includes('Error'), d.out());
});
test("a preview can't be registered on a port settings.md pins for this checkout's dashboard", async (t) => {
  const F = threadsFixture('pinned-dash');
  t.after(() => F.done());
  const pin = await freePort();
  const sf = path.join(F.old, 'docs/devteam/project/settings.md');
  fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"gates": {}', `"gates": {}, "dashboard_port": ${pin}`));
  assert.match(F.fails(['preview', String(pin)], F.SUP), /own dashboard/);
});
test("the laptop's relay carries a preview's WebSockets: from its own Origin only, with localhost as the app's Host and Origin", async (t) => {
  const F = threadsFixture('relay-ws');
  const later = cleanup(t);
  later(() => F.done());
  const app = await fakeApp();
  later(() => app.close());
  const name = /preview (\S+) /.exec(F.sup(['preview', String(app.port), '--label', 'ws']))[1];
  const port = await freePort();
  const B = `http://127.0.0.1:${port}`;
  const d = startDashboard(F.old, F.env({ DEVTEAM_PREVIEW_TICK_MS: '500', ...RELAY_ENV }), ['--port', String(port)]);
  later(() => d.stop());
  await until(() => new RegExp(`dashboard on http://127\\.0\\.0\\.1:${port}\\b`).test(d.out()), 'the dashboard');
  const v = await (await fetch(`${B}/api/view?kind=preview&name=${name}`)).json();
  const R = Number(/:(\d+)$/.exec(v.origin)[1]);
  const ask = (origin, host = `127.0.0.1:${R}`, url = '/hmr?token=1') => ['GET ' + url + ' HTTP/1.1', `Host: ${host}`, 'Connection: Upgrade', 'Upgrade: websocket', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', ...(origin ? [`Origin: ${origin}`] : [])];
  const upgrade = (origin, host) => rawRequest(R, ask(origin, host));
  const got = await upgrade(v.origin);
  assert.match(got, /^HTTP\/1\.1 101 /);
  assert.match(got, /hello from the app/, 'the app\'s bytes after the handshake');
  assert.deepEqual(app.seen.at(-1), { method: 'UPGRADE', url: '/hmr?token=1', host: `localhost:${app.port}`, origin: `http://localhost:${app.port}` });
  // the relay's other name for itself, from a page on that name
  assert.match(await upgrade(`http://localhost:${R}`, `localhost:${R}`), /^HTTP\/1\.1 101 /);
  assert.deepEqual(app.seen.at(-1), { method: 'UPGRADE', url: '/hmr?token=1', host: `localhost:${app.port}`, origin: `http://localhost:${app.port}` });
  const n = app.seen.length;
  assert.match(await upgrade('http://evil.example'), /^HTTP\/1\.1 403 /, 'another page\'s socket');
  assert.match(await upgrade(B), /^HTTP\/1\.1 403 /, 'the dashboard\'s page');
  assert.match(await upgrade(null), /^HTTP\/1\.1 403 /, 'no Origin');
  assert.match(await upgrade(`http://localhost:${R}`), /^HTTP\/1\.1 403 /, 'a page on its other name, to this one');
  assert.match(await rawRequest(R, ['GET /hmr HTTP/1.1', `Host: rebound.example:${R}`, 'Connection: Upgrade', 'Upgrade: websocket', `Origin: ${v.origin}`]), /^HTTP\/1\.1 421 /, 'DNS rebinding');
  assert.match(await rawRequest(R, ask(v.origin, `127.0.0.1:${R}`, 'http://elsewhere.example/hmr')), /^HTTP\/1\.1 400 /, 'origin-form only');
  assert.equal(app.seen.length, n, 'none of those reached the app');
  // both ways, after the handshake: the handshakes above let go first, so the app's count is this one's
  await until(() => app.sockets.size === 0, 'the handshakes above let go');
  const one = rawSocket(R, ask(v.origin));
  await until(() => /hello from the app\n/.test(one.got), 'the handshake');
  await until(() => app.sockets.size === 1, 'the app holds it');
  one.c.write('ping from the page\n');
  await until(() => /ping from the page\n/.test(one.got), 'the app\'s echo');
  // the app ends it: so does the relay, and the dashboard carries on
  for (const s of app.sockets) s.destroy();
  await until(() => one.closed, 'the page\'s side closed with the app\'s');
  // the page ends it: so does the relay, to the app
  const two = rawSocket(R, ask(v.origin));
  await until(() => app.sockets.size === 1, 'the app holds the next');
  two.c.destroy();
  await until(() => app.sockets.size === 0, 'the app\'s side closed with the page\'s');
  // 32 at once, and no more; one let go makes room (none of the above still holds a slot)
  assert.equal(app.sockets.size, 0);
  const held = [];
  later(() => { for (const s of held) s.c.destroy(); });
  for (let i = 0; i < 32; i++) held.push(rawSocket(R, ask(v.origin)));
  await until(() => held.every((s) => /hello from the app/.test(s.got)), 'thirty-two sockets');
  const n2 = app.seen.length;
  assert.match(await upgrade(v.origin), /^HTTP\/1\.1 429 /, 'a thirty-third');
  assert.equal(app.seen.length, n2, 'which never reached the app');
  held.shift().c.destroy();
  await until(async () => /^HTTP\/1\.1 101 /.test(await upgrade(v.origin)), 'room once one closed');
  // the app gone: the socket is closed, unanswered, and the dashboard still answers
  const app2 = await fakeApp();
  const gone = app2.port;
  app2.close();
  const file = path.join(F.old, 'docs/devteam/run/previews', `${name}.json`);
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  // the relay closes with its record: every socket it carries goes with it, to the page and to the app
  F.sup(['preview', 'stop', name]);
  await until(() => held.every((s) => s.closed), 'the pages\' sides closed with the relay');
  await until(() => app.sockets.size === 0, 'the app\'s sides closed with the relay');
  write(file, JSON.stringify({ ...rec, port: gone }));
  const v2 = await (await fetch(`${B}/api/view?kind=preview&name=${name}`)).json();
  assert.equal(v2.opened, true);
  const R2 = Number(/:(\d+)$/.exec(v2.origin)[1]);
  const lost = rawSocket(R2, ask(v2.origin, `127.0.0.1:${R2}`));
  await until(() => lost.closed, 'closed, with nothing to carry it to');
  assert.equal(lost.got, '', 'nothing to answer it');
  assert.equal((await fetch(`${B}/api/view?kind=preview&name=${name}`)).status, 200, 'the dashboard carries on');
});
test("the laptop's relay ends a socket the app won't upgrade once it has answered, and one it refuses even if the page holds on", async (t) => {
  const F = threadsFixture('relay-ws-end');
  const later = cleanup(t);
  later(() => F.done());
  const app = await fakeApp();
  later(() => app.close());
  const name = /preview (\S+) /.exec(F.sup(['preview', String(app.port), '--label', 'ws']))[1];
  const port = await freePort();
  const B = `http://127.0.0.1:${port}`;
  const d = startDashboard(F.old, F.env({ DEVTEAM_PREVIEW_TICK_MS: '500', ...RELAY_ENV }), ['--port', String(port)]);
  later(() => d.stop());
  await until(() => new RegExp(`dashboard on http://127\\.0\\.0\\.1:${port}\\b`).test(d.out()), 'the dashboard');
  const v = await (await fetch(`${B}/api/view?kind=preview&name=${name}`)).json();
  const R = Number(/:(\d+)$/.exec(v.origin)[1]);
  const ask = (url, origin = v.origin) => ['GET ' + url + ' HTTP/1.1', `Host: 127.0.0.1:${R}`, 'Connection: Upgrade', 'Upgrade: websocket', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', `Origin: ${origin}`];
  // A page that never ends its own side sees the relay's close only when it next writes: so it
  // writes, every 100 ms, until that close comes back. Without it the relay would read on for good.
  const pester = (S) => () => { if (!S.closed) S.c.write('more from the page\n'); return S.closed; };
  // a 400 to the handshake: the page gets that answer, its body and no more, and both sides end,
  // though the page holds its own open and the app would keep going
  const no = rawSocket(R, ask('/no-ws'), { halfOpen: true });
  await until(() => no.got.includes('no, ws\n'), 'the answer');
  await until(pester(no), 'the page\'s side closed after the answer');
  assert.match(no.got, /^HTTP\/1\.1 400 Bad Request\r\n/);
  assert.match(no.got, /\r\nconnection: close\r\n/i);
  assert.doesNotMatch(no.got, /keep-alive/i);
  assert.ok(no.got.endsWith('\r\n\r\nno, ws\n'), JSON.stringify(no.got));
  await until(() => app.noWsEnded, 'the relay\'s side to the app ended too');
  assert.equal(app.after, undefined, 'nothing of the page\'s reached the app after the answer');
  // a refused socket is closed, not just ended, so a page that never ends its side holds nothing here
  const n = app.seen.length;
  const refused = rawSocket(R, ask('/hmr', 'http://evil.example'), { halfOpen: true });
  await until(() => /^HTTP\/1\.1 403 /.test(refused.got), 'the refusal');
  await until(pester(refused), 'the refused socket closed though the page held on');
  assert.match(refused.got, /^HTTP\/1\.1 403 /);
  assert.equal(app.seen.length, n, 'which never reached the app');
});
test("the laptop's relay gives up on an app that takes a WebSocket and sends no answer, destroying both sides", async (t) => {
  const F = threadsFixture('relay-ws-head');
  const later = cleanup(t);
  later(() => F.done());
  const app = await fakeApp();
  later(() => app.close());
  const name = /preview (\S+) /.exec(F.sup(['preview', String(app.port), '--label', 'ws']))[1];
  const port = await freePort();
  const B = `http://127.0.0.1:${port}`;
  const d = startDashboard(F.old, F.env({ DEVTEAM_PREVIEW_TICK_MS: '500', DEVTEAM_RELAY_HEAD_MS: '600', ...RELAY_ENV }), ['--port', String(port)]);
  later(() => d.stop());
  await until(() => new RegExp(`dashboard on http://127\\.0\\.0\\.1:${port}\\b`).test(d.out()), 'the dashboard');
  const v = await (await fetch(`${B}/api/view?kind=preview&name=${name}`)).json();
  const R = Number(/:(\d+)$/.exec(v.origin)[1]);
  const S = rawSocket(R, ['GET /silent HTTP/1.1', `Host: 127.0.0.1:${R}`, 'Connection: Upgrade', 'Upgrade: websocket', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', `Origin: ${v.origin}`], { halfOpen: true });
  await until(() => app.sockets.size === 1, 'the app to hold the relay\'s side');
  const t0 = Date.now();
  // the page never ends its own side, so the relay's close shows only when it next writes
  await until(() => { if (!S.closed) S.c.write('more from the page\n'); return S.closed; }, 'the page\'s side closed with no head');
  assert.ok(Date.now() - t0 < 5000, 'within moments of the limit, not the page\'s own patience');
  await until(() => app.sockets.size === 0, 'the app\'s side closed too');
});
// A preview's viewer: on this laptop the relay's origin, once the page's own ask has opened it (a GET
// of the viewer never does); on a box its own name through the gateway, or nothing when the gateway
// doesn't serve previews. The dashboard's page names exactly those, never a wildcard.
test("a preview's viewer: its route, frame-src naming exactly where its lens is, and the dashboard's own frames", async (t) => {
  const F = threadsFixture('preview-view');
  const later = cleanup(t);
  later(() => F.done());
  const app = await fakeApp();
  later(() => app.close());
  const name = /preview (\S+) /.exec(F.sup(['preview', String(app.port), '--label', 'Checkout']))[1];
  const port = await freePort();
  const B = `http://127.0.0.1:${port}`;
  let d = null;
  later(() => d?.stop());
  const start = async (env) => {
    d = startDashboard(F.old, F.env(env), ['--port', String(port)]);
    await until(() => new RegExp(`dashboard on http://127\\.0\\.0\\.1:${port}\\b`).test(d.out()), 'the dashboard');
  };
  await start(RELAY_ENV);
  const csp = async (p) => (await fetch(`${B}${p}`)).headers.get('content-security-policy');
  const tail = `frame-ancestors 'self' http://127.0.0.1:${PORTS}`;
  const viewer = `/view/preview/${name}`;
  // before any relay: a GET of the viewer opens none, and every page frames only itself, as before
  let r = await fetch(`${B}${viewer}`);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), fs.readFileSync(path.join(kit, 'dashboard/index.html'), 'utf8'));
  assert.equal(r.headers.get('content-security-policy'), `frame-src 'self'; ${tail}`, 'a navigation opens no relay');
  assert.deepEqual([r.headers.get('x-frame-options'), r.headers.get('referrer-policy'), r.headers.get('cache-control')], [null, 'no-referrer', 'no-store']);
  assert.equal(await csp('/'), `frame-src 'self'; ${tail}`);
  assert.equal((await fetch(`${B}${viewer}`)).headers.get('content-security-policy'), `frame-src 'self'; ${tail}`, 'nor does a second');
  // the page's own ask opens it, and says so: a page loaded before it reloads (the viewer) or says to (the stage).
  // up is the tick's word, as hello has it: the app answers, so once the first tick is done, true
  await until(async () => (await (await fetch(`${B}/api/hello`)).json()).previews?.find((x) => x.name === name)?.up === true, 'the tick to find the app up');
  const v = await (await fetch(`${B}/api/view?kind=preview&name=${name}`)).json();
  const relay = /^http:\/\/127\.0\.0\.1:(\d+)$/.exec(v.origin ?? '');
  assert.ok(relay && Number(relay[1]) >= RELAY_LO && Number(relay[1]) <= RELAY_HI, v.origin);
  assert.deepEqual(v, { name, label: 'Checkout', session: v.session, project: v.project, up: true, origin: relay[0], opened: true, lens: `${relay[0]}/.devteam/lens`, served: false });
  assert.equal(typeof v.session, 'string');
  assert.equal(typeof v.project, 'string');
  assert.equal((await (await fetch(`${B}/api/view?kind=preview&name=${name}`)).json()).opened, false, 'the next ask finds it open');
  // from then on the viewer and the dashboard name that relay, and nothing else; an artifact's viewer frames only its own
  assert.equal(await csp(viewer), `frame-src 'self' ${relay[0]}; ${tail}`);
  assert.equal(await csp('/'), `frame-src 'self' ${relay[0]}; ${tail}`);
  assert.equal(await csp('/index.html'), `frame-src 'self' ${relay[0]}; ${tail}`);
  assert.equal(await csp('/view/artifact/some-mock'), `frame-src 'self'; ${tail}`);
  // only a preview here, by its own name; what was asked is never said back
  for (const bad of ['/view/preview/no-such', '/view/preview/Not_A_Name', `${viewer}/x`, '/view/preview/', `/view/preview/${name}%3Cb%3E`, `/view/preview/%3Cscript%3E`]) {
    const b = await fetch(`${B}${bad}`);
    assert.deepEqual([b.status, await b.text()], [404, 'not found'], bad);
  }
  assert.equal((await fetch(`${B}${viewer}`, { method: 'POST' })).status, 404, 'a GET only: a POST is no route here');
  // a relay whose record moved to another port (or went) is framed no more, at once: not on the tick
  // that closes it (every 10 s here), on the next page asked for
  const file = path.join(F.old, 'docs/devteam/run/previews', `${name}.json`);
  const was = fs.readFileSync(file, 'utf8');
  write(file, JSON.stringify({ ...JSON.parse(was), port: app.port === 65535 ? app.port - 1 : app.port + 1 }));
  assert.equal(await csp('/'), `frame-src 'self'; ${tail}`, 'its record names another port');
  fs.rmSync(file);
  assert.equal(await csp('/'), `frame-src 'self'; ${tail}`, 'its record gone');
  write(file, was);
  assert.equal((await fetch(`${B}/api/view?kind=preview&name=no-such`)).status, 404);
  await d.stop();
  // on a box whose gateway serves previews: the preview's own name, which the gateway leaves as it is
  await start({ DEVTEAM_PUBLIC_URL: 'https://box.example.com', DEVTEAM_PREVIEWS: '1', ...RELAY_ENV });
  const own = `https://${name}.box.example.com`;
  assert.equal(await csp(viewer), `frame-src 'self' ${own}; ${tail}`);
  assert.equal(await csp('/'), `frame-src 'self' ${own}; ${tail}`, 'each preview\'s own name, never a wildcard');
  const other = /preview (\S+) /.exec(F.sup(['preview', String(app.port + 1 > 65535 ? app.port - 1 : app.port + 1), '--label', 'Other']))[1];
  assert.equal(await csp('/'), `frame-src 'self' ${[name, other].sort().map((n) => `https://${n}.box.example.com`).join(' ')}; ${tail}`, 'every preview on the box, read per request');
  assert.equal(await csp(viewer), `frame-src 'self' ${own}; ${tail}`, 'a viewer frames its own preview only');
  assert.deepEqual((({ origin, lens, served, opened }) => [origin, lens, served, opened])(await (await fetch(`${B}/api/view?kind=preview&name=${name}`)).json()), [own, `${own}/.devteam/lens`, true, false]);
  F.sup(['preview', 'stop', other]);
  assert.equal(await csp('/'), `frame-src 'self' ${own}; ${tail}`, 'a preview stopped is framed no more');
  await d.stop();
  // a box whose gateway doesn't: nothing to frame, and the viewer says so; the page's ask opens no relay
  await start({ DEVTEAM_PUBLIC_URL: 'https://box.example.com', ...RELAY_ENV });
  assert.equal(await csp(viewer), `frame-src 'self'; ${tail}`);
  assert.deepEqual((({ origin, lens, served, opened }) => [origin, lens, served, opened])(await (await fetch(`${B}/api/view?kind=preview&name=${name}`)).json()), [null, null, false, false]);
  assert.equal(await csp('/'), `frame-src 'self'; ${tail}`);
});
