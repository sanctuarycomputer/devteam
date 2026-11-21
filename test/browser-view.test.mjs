// The browser's live view server (kit-66): the daemon's view port serves browser.html and its one
// socket, which carries Chrome's screencast out and the owner's input in; the view is a preview the
// owner opens through the box's gateway (behind the passkey) or a laptop dashboard's relay. Each check
// is the spec's (docs/devteam/project/tickets/kit-66-browser-view-server/spec.md, home), named by its
// id. The CLI runs async: the fixture site, the stand-in hub and the gateway live in this process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { canDrive } from './lib/chrome.mjs';
import { until } from './lib/kit.mjs';
import { PAGE, sleep, site, a, dash, browser, ok, alive, tmuxOf, devWindows, readRec, get, frameOf, ws, isFrame, BUTTON, within, view, s1, standIn, running, dashboard, viewer, onRecord, viewFile } from './lib/browser-view-fixture.mjs';

// CI's Node 22 and 24 jobs have Chrome: there the file must run, never skip.
const mustRun = !!process.env.CI && Number(process.versions.node.split('.')[0]) >= 22;
const skip = canDrive ? false : 'needs Chrome and Node 22+';
const opts = { skip, timeout: 120000 };
if (mustRun && !canDrive) test('Chrome is needed on CI\'s Node 22+', () => assert.fail('Chrome is needed on CI\'s Node 22+: this file must run there, not skip'));
viewFile();

const MARK = () => `mk${crypto.randomBytes(6).toString('hex').replace(/\d/g, (d) => 'qrstuvwxyz'[d])}`;
const ppid = (pid) => { try { const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1]); } catch { return 0; } };
const statusJson = async (P) => JSON.parse(await ok(P, ['status', '--json']));

test('V1 the view is a preview labelled browser, in its own window, listed in hello', opts, async () => {
  const s = await running();
  const rec = readRec(a, view.name);
  assert.equal(rec.label, 'browser');
  assert.equal(rec.port, view.port);
  const w = devWindows(a).find((x) => x.name === `dev~${view.name}`);
  assert.ok(w, `a dev~${view.name} window: ${JSON.stringify(devWindows(a))}`);
  assert.equal(rec.run.window, w.id);
  let p = s.daemon_pid;
  for (let i = 0; i < 20 && p > 1 && p !== w.pid; i++) p = ppid(p);
  assert.equal(p, w.pid, 'the daemon descends from the pane');
  const port = await dashboard();
  await until(async () => (await (await fetch(`http://127.0.0.1:${port}/api/hello`)).json()).previews?.some((x) => x.name === view.name), 'hello to list the view');
});

// Hosts of the loopback forms the view must refuse: another port (p + 1, or p - 1 at the top), and the
// view's port with more after it: one more digit while that is still a port, and a name that starts
// with the port's digits. An exact match refuses each; a prefix or any-port match takes some.
const extendsPort = (p) => [...(p * 10 + 1 <= 65535 ? [`${p}1`] : []), `${p}.evil.example`];
const foreignHosts = (p) => {
  const other = p === 65535 ? p - 1 : p + 1;
  return [`127.0.0.1:${other}`, `localhost:${other}`, ...extendsPort(p).flatMap((x) => [`127.0.0.1:${x}`, `localhost:${x}`])];
};

test('V5 the view serves browser.html', opts, async () => {
  await running();
  for (const host of [`127.0.0.1:${view.port}`, `localhost:${view.port}`]) {
    const r = await get(view.port, '/', host);
    assert.equal(r.status, 200, `${host}: ${r.body.toString().slice(0, 200)}`);
    assert.ok(r.body.equals(PAGE), 'exactly browser.html');
    assert.match(r.headers['content-type'], /^text\/html/);
    assert.match(r.headers['content-security-policy'] ?? '', /frame-ancestors 'self'/);
    assert.equal(r.headers['cache-control'], 'no-store');
  }
  assert.equal((await get(view.port, '/', 'evil.example')).status, 403, 'another Host');
  // another port of either loopback form, and a Host whose port extends the view's (a prefix match
  // would take it): each refused
  for (const host of foreignHosts(view.port)) assert.equal((await get(view.port, '/', host)).status, 403, `Host ${host}`);
  assert.equal((await get(view.port, '/other', `127.0.0.1:${view.port}`)).status, 404);
});

test('V6 a socket on either loopback form gets held, url and frames of the page within 2 s', opts, async () => {
  await onRecord();
  s1?.close();
  await sleep(300);
  for (const host of [`localhost:${view.port}`, `127.0.0.1:${view.port}`]) {
    const t0 = Date.now();
    const c = await ws(view.port, { host });
    assert.equal(c.status, 101, `${host}: ${c.head.split('\r\n')[0]}`);
    await c.wait(isFrame, Math.max(1, 2000 - (Date.now() - t0)));
    assert.deepEqual(c.msgs.find((m) => m.t === 'held'), { t: 'held', qid: null });
    assert.equal(c.msgs.find((m) => m.t === 'url')?.url, `${site.origin}/record`);
    assert.deepEqual(c.bad, [], 'every message is browser@1');
    // in CSS pixels of the page, not the frame image's (400 px at most here): the page is wider
    const f = c.msgs.find(isFrame);
    assert.ok(f.w > 400 && f.w <= 8192 && f.h > 0, `frame size ${f.w}x${f.h} is the page's, not the image's`);
    c.close();
    await sleep(300);
  }
});

test('R2 a second viewer gets bye; the first keeps its frames', opts, async () => {
  const first = await viewer();
  const c2 = await ws(view.port);
  assert.equal(c2.status, 101, c2.head.split('\r\n')[0]);
  const bye = await c2.wait((m) => m.t === 'bye', 2000);
  assert.match(bye.why, /another window/);
  assert.ok((await c2.closedIn(3000)) !== null, 'the server closes it');
  assert.equal(c2.msgs.filter(isFrame).length, 0, 'no frame to the second');
  const n = first.msgs.length;
  await ok(a, ['open', `${site.origin}/`]);
  await first.wait(isFrame, 3000, n);
});

test('I1 a click reaches the page at the same point, within 2 s', opts, async () => {
  await onRecord();
  const c = await viewer();
  const before = site.events().length;
  c.send({ t: 'mouse', type: 'click', x: BUTTON.x, y: BUTTON.y, button: 'left', clicks: 1 });
  const e = await within(2000, () => site.events().slice(before).find((x) => x.kind === 'click'), 'the click');
  assert.ok(Math.abs(e.x - BUTTON.x) <= 2 && Math.abs(e.y - BUTTON.y) <= 2, JSON.stringify(e));
});

const typed = { key: MARK(), paste: MARK(), nav: MARK() };
Object.defineProperty(typed, 'sent', { value: { keys: false, nav: false } }); // not a marker: kept out of Object.entries
test('I2 keys, a paste and a 60 KB paste in two frames reach the page, within 2 s', opts, async () => {
  await onRecord();
  const c = await viewer();
  // focus the input: a click on the button, then Tab
  c.send({ t: 'mouse', type: 'click', x: BUTTON.x, y: BUTTON.y, button: 'left', clicks: 1 });
  await sleep(200);
  const before = site.events().length;
  c.send({ t: 'key', type: 'down', key: 'Tab', code: 'Tab' });
  c.send({ t: 'key', type: 'up', key: 'Tab', code: 'Tab' });
  for (const ch of typed.key) c.send({ t: 'key', type: 'press', key: ch, code: `Key${ch.toUpperCase()}`, text: ch });
  c.send({ t: 'paste', text: typed.paste });
  // 10 000 characters, each a \u escape: over 60 KB of JSON, sent as a text frame and a continuation
  const big = Buffer.from(`{"t":"paste","text":"${'\\u0062'.repeat(10000)}"}`);
  assert.ok(big.length > 60000);
  const cut = Math.floor(big.length / 2);
  c.raw(frameOf(1, big.subarray(0, cut), { fin: false }));
  c.raw(frameOf(0, big.subarray(cut)));
  const want = typed.key + typed.paste + 'b'.repeat(10000);
  await within(2000, () => site.events().slice(before).some((x) => x.kind === 'input' && x.value === want), 'the input to hold the keys and both pastes');
  assert.equal(c.closed, null, 'the socket stays open');
  typed.sent.keys = true;
});

test('I5 Back returns to the page before', opts, async () => {
  await onRecord();
  const c = await viewer();
  c.send({ t: 'nav', url: `${site.origin}/account?m=${typed.nav}` });
  await within(5000, async () => (await statusJson(a)).url === `${site.origin}/account?m=•••`, 'the nav');
  typed.sent.nav = true;
  c.send({ t: 'back' });
  await within(5000, async () => (await statusJson(a)).url === `${site.origin}/record`, 'back at /record');
});

test('I3 a nav to the dashboard, or any loopback port, shows the guard\'s refusal', opts, async () => {
  const port = await dashboard();
  const c = await viewer();
  const seen0 = standIn.requests;
  for (const p of [port, standIn.port]) {
    c.send({ t: 'nav', url: `http://127.0.0.1:${p}/` });
    const snap = await within(5000, async () => { const r = await browser(a, ['snapshot']); return /This page is blocked/.test(r.out) && r.out.includes(`can't open 127.0.0.1:${p}`) ? r.out : null; }, `the refusal page for port ${p}`);
    assert.ok(snap);
    await ok(a, ['open', `${site.origin}/`]);
  }
  assert.equal(standIn.requests, seen0, 'nothing reached the stand-in');
});

test('I4 a nav to file: is refused', opts, async () => {
  await onRecord();
  const c = await viewer();
  c.send({ t: 'nav', url: 'file:///etc/passwd' });
  await sleep(2000);
  assert.equal((await statusJson(a)).url, `${site.origin}/record`);
  assert.doesNotMatch(await ok(a, ['snapshot']), /root:/);
});

test('R3 nothing the owner typed is in run/, project/, the dashboard\'s output or the window', opts, async () => {
  // the markers as I2 and I5 send them, when they haven't run: typed keys and a paste into the
  // record page's input, and a nav to a URL carrying the third in its query
  if (!typed.sent.keys || !typed.sent.nav) {
    await onRecord();
    const c = await viewer();
    if (!typed.sent.keys) {
      c.send({ t: 'mouse', type: 'click', x: BUTTON.x, y: BUTTON.y, button: 'left', clicks: 1 });
      await sleep(200);
      const before = site.events().length;
      c.send({ t: 'key', type: 'down', key: 'Tab', code: 'Tab' });
      c.send({ t: 'key', type: 'up', key: 'Tab', code: 'Tab' });
      for (const ch of typed.key) c.send({ t: 'key', type: 'press', key: ch, code: `Key${ch.toUpperCase()}`, text: ch });
      c.send({ t: 'paste', text: typed.paste });
      await within(5000, () => site.events().slice(before).some((x) => x.kind === 'input' && x.value === typed.key + typed.paste), 'the keys and the paste on the page');
      typed.sent.keys = true;
    }
    if (!typed.sent.nav) {
      c.send({ t: 'nav', url: `${site.origin}/account?m=${typed.nav}` });
      await within(5000, async () => (await statusJson(a)).url === `${site.origin}/account?m=•••`, 'the nav');
      typed.sent.nav = true;
    }
  }
  await running();
  const files = [];
  const walk = (d) => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, n.name); if (n.isDirectory()) walk(f); else if (n.isFile()) files.push(f); } };
  walk(a.run);
  walk(path.join(a.old, 'docs', 'devteam', 'project'));
  const w = devWindows(a).find((x) => x.name === `dev~${view.name}`);
  const pane = tmuxOf(a, ['capture-pane', '-p', '-J', '-S', '-', '-t', w.id]).stdout;
  for (const [what, m] of Object.entries(typed)) {
    for (const f of files) assert.ok(!fs.readFileSync(f).includes(m), `the ${what} marker in ${path.relative(a.old, f)}`);
    assert.ok(!pane.includes(m), `the ${what} marker in the window`);
    assert.ok(!(dash?.dash.out() ?? '').includes(m), `the ${what} marker in the dashboard's output`);
  }
});

test('R1 a socket with a missing or foreign Origin, or another Host, is refused with 403', opts, async () => {
  const c0 = await viewer();
  const p = view.port, other = p === 65535 ? p - 1 : p + 1;
  const cases = [
    { origin: null },
    { origin: 'http://evil.example' },
    { origin: `http://127.0.0.1:${other}` },
    { origin: `https://127.0.0.1:${p}` },
    { host: `example.com:${p}`, origin: `http://127.0.0.1:${p}` },
    { host: '127.0.0.1', origin: `http://127.0.0.1:${p}` },
    { host: `[::1]:${p}`, origin: `http://127.0.0.1:${p}` },
    { host: `127.0.0.1:${other}`, origin: `http://127.0.0.1:${p}` },
    // an Origin or a Host whose port extends the view's: a prefix match would admit it
    ...extendsPort(p).flatMap((x) => [{ origin: `http://127.0.0.1:${x}` }, { origin: `http://localhost:${x}` }]),
    ...foreignHosts(p).map((host) => ({ host, origin: `http://127.0.0.1:${p}` })),
  ];
  for (const k of cases) {
    const c = await ws(p, { host: k.host ?? `127.0.0.1:${p}`, origin: k.origin });
    assert.equal(c.status, 403, `${JSON.stringify(k)}: ${c.head.split('\r\n')[0]}`);
    assert.equal(c.msgs.length, 0);
  }
  assert.equal((await ws(p, { route: '/other' })).status, 404);
  const n = c0.msgs.length;
  await ok(a, ['open', `${site.origin}/`]);
  await c0.wait(isFrame, 3000, n);
});

test('R4 a binary, an unmasked or an oversized frame closes the socket; the daemon serves the next', opts, async () => {
  let c = await viewer();
  c.raw(frameOf(2, Buffer.from('bin')));
  assert.equal(await c.closedIn(3000), 1003);
  c = await viewer();
  c.raw(frameOf(1, Buffer.from('{"t":"back"}'), { masked: false }));
  assert.equal(await c.closedIn(3000), 1002);
  c = await viewer();
  // a header declaring 300 KiB, and no payload: refused on the header
  const h = Buffer.alloc(14);
  h[0] = 0x81; h[1] = 0x80 | 127; h.writeBigUInt64BE(300n * 1024n, 2); crypto.randomBytes(4).copy(h, 10);
  c.raw(h);
  assert.equal(await c.closedIn(2000), 1009);
  await viewer();
});

test('R5 a viewer that answers no ping is closed, and the next one gets in', opts, async () => {
  s1?.close();
  await browser(a, ['stop']);
  await running({ DEVTEAM_TEST_BROWSER_PING_MS: '500' });
  try {
    const live = await ws(view.port);
    assert.equal(live.status, 101);
    await sleep(2500);
    assert.equal(live.closed, null, 'one that answers pings stays');
    assert.ok(live.pings >= 2, `pinged (${live.pings})`);
    live.close();
    await sleep(300);
    const silent = await ws(view.port, { pong: false });
    assert.equal(silent.status, 101);
    const t0 = Date.now(); // from its 101: no frame is waited for, the server may close it first
    assert.notEqual(await silent.closedIn(2000), null, 'the silent one is closed within 2 s');
    assert.ok(Date.now() - t0 <= 2000);
    // silence counts from the last byte heard: one that answers one ping and then nothing is closed
    // within the spec's 2 s of its pong
    await sleep(300);
    const once = await ws(view.port, { pong: 1 });
    assert.equal(once.status, 101);
    await within(2000, () => once.lastPong, 'its one pong');
    const closedAt = await once.closedIn(3000).then(() => Date.now());
    assert.notEqual(once.closed, null, 'the one that fell silent after a pong is closed');
    assert.ok(closedAt - once.lastPong <= 2000, `closed ${closedAt - once.lastPong} ms after its pong (at most 2000)`);
    const next = await ws(view.port);
    assert.equal(next.status, 101);
    await next.wait(isFrame, 2000);
    assert.ok(!next.msgs.some((m) => m.t === 'bye'), 'no bye for the next one');
    next.close();
  } finally {
    await browser(a, ['stop']);
    await running();
  }
});

test('V10 the idle timer spares an open viewer; once it closes, the daemon stops', opts, async () => {
  s1?.close();
  await browser(a, ['stop']);
  try {
    const s = await running({ DEVTEAM_TEST_BROWSER_IDLE_MS: '3000' });
    const c = await ws(view.port);
    assert.equal(c.status, 101, `the viewer is let in before the first idle stop: ${c.head.split('\r\n')[0]}`);
    // three idle periods with the socket open
    await sleep(9000);
    assert.ok(alive(s.daemon_pid), 'the daemon is up with a viewer open');
    assert.equal(c.closed, null, 'the viewer\'s socket is still open');
    const n = c.msgs.length;
    await ok(a, ['open', `${site.origin}/`]);
    await c.wait(isFrame, 3000, n);
    c.close();
    const t0 = Date.now();
    await within(3000 + 3000, () => !alive(s.daemon_pid), 'the idle stop after the viewer closed');
    assert.ok(Date.now() - t0 <= 6000, `stopped ${Date.now() - t0} ms after the viewer closed (at most 6000)`);
  } finally {
    await browser(a, ['stop']);
    await running();
  }
});
