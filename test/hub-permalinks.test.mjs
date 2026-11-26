// The hub's address follows the dashboard inside it (dashboard-shell@2 §10, test/contracts/shell.md):
// hub heads #<key>/<dashboard head>, a frame's hub-route taken only from that frame on its origin,
// hub-base sent to it, a pasted view opened, and the Overview's operator threads at #overview?ot=<id>.
// Each project is test/fixtures/dashboard-frame-fake.html on a loopback origin of its own. The test's
// server puts a recorder in front of the fake on every response: it reports the frame's hash on each
// load and hashchange, and each hub-base the frame receives, so a first load's is seen too, and a
// frame Chrome runs in a process of its own (a box's project hosts) is seen as well as one it doesn't.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { kit, testDir } from './lib/kit.mjs';
import { canDrive, openChrome } from './lib/chrome.mjs';

// kit.mjs's until waits two minutes; here a wait that fails says which one within 15 s, inside the test's limit
async function until(f, what = 'the condition', ms = 15000) {
  const end = Date.now() + ms;
  for (;;) { const v = await f(); if (v) return v; if (Date.now() > end) assert.fail(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 100)); }
}
const hubHtml = () => fs.readFileSync(path.join(kit, 'dashboard', 'hub.html'), 'utf8');
const FAKE = fs.readFileSync(path.join(testDir, 'fixtures', 'dashboard-frame-fake.html'), 'utf8');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 120000 };

// A test's cleanup: the last step added runs first, every step runs, each bounded; the first error is thrown.
const cleanups = new WeakMap();
function defer(t, fn) {
  let steps = cleanups.get(t);
  if (!steps) {
    steps = [];
    cleanups.set(t, steps);
    t.after(async () => {
      let first = null;
      for (const step of [...steps].reverse()) {
        let timer;
        const limit = new Promise((_, no) => { timer = setTimeout(() => no(new Error('cleanup step did not settle in 30 s')), 30000); });
        try { await Promise.race([Promise.resolve().then(step), limit]); } catch (e) { first ??= e; } finally { clearTimeout(timer); }
      }
      if (first) throw first;
    });
  }
  steps.push(fn);
}
const hello = (name, port, root = `/srv/${name}`) => ({ devteam: 1, name, root, port, kit: 'v0.70.0', viewer: 1, inbox: 0, threads: { you: 0, waiting: 0, ready: 0 }, fleet: { mode: 'run', workers: 1 }, pulse: null });
// before the fake's own script: where the frame is, on each load and hashchange, and each hub-base it receives
const RECORDER = `<script>(() => {
  const tell = (what, o) => fetch('/' + what + '?' + new URLSearchParams({ host: location.host, path: location.pathname, ...o }), { cache: 'no-store' }).catch(() => {});
  tell('seen', { hash: location.hash });
  addEventListener('hashchange', () => tell('seen', { hash: location.hash }));
  addEventListener('message', (e) => { const m = e.data; if (m && m.devteam === 'hub-base') tell('got', { base: String(m.base), origin: e.origin }); });
})()</script>`;
// a page on a project's origin that isn't its dashboard: it posts a hub-route to its parent at once, to anyone
const ROGUE = `<!doctype html><meta charset="utf-8"><title>rogue</title><script>
parent.postMessage({ devteam: 'hub-route', head: '#rogue' }, '*');
fetch('/posted?host=' + encodeURIComponent(location.host));
</script>`;
const OT = 'ot-20261123-120000000-abc123';
const THREAD = { id: OT, title: 'Why is alpha slow?', created_at: '2026-11-23T12:00:00.000Z', status: 'open', subject: null, turns: [{ id: 'u-1', by: 'owner', at: '2026-11-23T12:00:00.000Z', text: 'Why is alpha slow?' }] };

async function listenOn(t, srv) {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  defer(t, () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }));
  return srv.address().port;
}
// One server is the hub (Host <hubHost>:<port>) and every project's origin: any other Host, and the
// extra loopback ports listened on. On a laptop the hub is on 127.0.0.1, as the machine hub is, which
// keeps its frames (127.0.0.1, other ports) in its own process, where the test can reach into them
// (evIn). F.box(F) is box.json's body, or null for none (404).
async function fixture(t, { ports = 0, hubHost = '127.0.0.1' } = {}) {
  const F = { list: [], box: () => null, got: [], seen: [], posted: [], threads: [] };
  const serve = (q, s) => {
    const u = new URL(q.url, 'http://x');
    if (q.headers.host === F.hubHost) {
      // the hub at / and at /index.html, as the gateway serves it (cloud/gateway.mjs)
      if (u.pathname === '/' || u.pathname === '/index.html') { s.writeHead(200, { 'content-type': 'text/html' }); return s.end(hubHtml()); }
      if (u.pathname === '/instances.json') { s.writeHead(200, { 'content-type': 'application/json' }); return s.end(JSON.stringify({ hub: 1, kit: 'v0.70.0', instances: F.list })); }
      if (u.pathname === '/operator/threads') { s.writeHead(200, { 'content-type': 'application/json' }); return s.end(JSON.stringify({ threads: F.threads, operator: { state: 'running', can_start: false, box: false } })); }
      const b = u.pathname === '/box.json' ? F.box(F) : null;
      if (b) { s.writeHead(200, { 'content-type': 'application/json' }); return s.end(JSON.stringify(b)); }
      s.writeHead(404, { 'content-type': 'application/json' });
      return s.end('{}');
    }
    const said = Object.fromEntries(u.searchParams);
    if (u.pathname === '/got') { F.got.push(said); return s.end('{}'); }
    if (u.pathname === '/seen') { F.seen.push(said); return s.end('{}'); }
    if (u.pathname === '/posted') { F.posted.push(said.host); return s.end('{}'); }
    s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    // the recorder first: at the top of the page's <head> when it has one, else before the page
    const page = u.pathname === '/rogue' ? ROGUE : FAKE;
    s.end(page.includes('<head>') ? page.replace('<head>', () => `<head>\n${RECORDER}`) : `${RECORDER}\n${page}`);
  };
  F.port = await listenOn(t, http.createServer(serve));
  F.hubHost = `${hubHost}:${F.port}`;
  F.hubOrigin = `http://${F.hubHost}`;
  F.ports = [];
  for (let i = 0; i < ports; i++) F.ports.push(await listenOn(t, http.createServer(serve)));
  F.hubAt = (hash) => `${F.hubOrigin}/${hash}`;
  F.at = (label) => `http://${label}.localhost:${F.port}/`;
  F.lo = (port) => `http://127.0.0.1:${port}`;
  // what the frames at a host received, and the last hash one at that host reported
  F.gotAt = (host) => F.got.filter((g) => g.host === host && g.path === '/');
  F.hashAt = (host) => F.seen.filter((x) => x.host === host && x.path === '/').at(-1)?.hash ?? null;
  return F;
}
async function hubPage(t, F, hash) {
  const chrome = await openChrome();
  defer(t, () => chrome.close());
  const p = await chrome.newPage();
  defer(t, () => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  p.until = (what, expr) => until(() => p.ev(expr).catch(() => false), what);
  // a cold load each time: from about:blank, never a same-document hash change
  p.go = async (h) => {
    await p.send('Page.navigate', { url: 'about:blank' });
    await p.until('about:blank', `location.href === 'about:blank'`);
    await p.send('Page.navigate', { url: F.hubAt(h) });
    await p.until('the hub, loaded', `document.readyState === 'complete' && document.title === 'devteam' && typeof select === 'function'`);
  };
  await p.go(hash);
  return p;
}
const hubHash = 'location.hash';
const shown = `(() => { const f = [...document.querySelectorAll('#frames iframe')].filter((x) => !x.hidden); return f.length === 1 ? f[0].getAttribute('src') : null; })()`;
// a hub-route posted from inside the frame at that origin, as its dashboard would
const routeFrom = (head) => `parent.postMessage({ devteam: 'hub-route', head: ${JSON.stringify(head)} }, '*'), true`;
// a script in the frame at that origin, once the test can reach it (its first document has a world of its own)
const into = async (p, origin, expr) => {
  await until(async () => (await p.evIn(origin, 'true').catch(() => false)), `the frame at ${origin}, reachable`);
  return p.evIn(origin, expr);
};
const tabOn = (name) => `[...document.querySelectorAll('#tabs [role=tab]')].find((x) => x.textContent.startsWith(${JSON.stringify(name)}))?.getAttribute('aria-selected') === 'true'`;

test('a pasted #<key>/<head> opens that project at that view; hub-route follows from its frame only; hub-base on every load, select and route; the view survives a tab switch (laptop)', CHROME, async (t) => {
  const F = await fixture(t, { ports: 2 });
  const [PA, PB] = F.ports;
  const A = F.lo(PA);
  const B = F.lo(PB);
  const hostA = `127.0.0.1:${PA}`;
  const hostB = `127.0.0.1:${PB}`;
  F.list = [hello('alpha', PA), hello('beta', PB)];
  const deep = '#board?goal=g-1&p=ticket%2Fkit-1';
  const p = await hubPage(t, F, `#alpha/${deep.slice(1)}`);

  // DW1: the tab, and the frame at that head
  await p.until("alpha's tab selected", tabOn('alpha'));
  await until(() => F.hashAt(hostA) === deep, "alpha's frame at the pasted head");
  assert.equal(await p.ev(hubHash), `#alpha/${deep.slice(1)}`, 'the hub keeps the pasted address');

  // DW3: hub-base on the first load, to the frame's origin, in the laptop form
  const baseA = `${F.hubOrigin}/#alpha/`;
  await until(() => F.gotAt(hostA).length > 0, "a hub-base on alpha's first load");
  assert.deepEqual(F.gotAt(hostA).map((g) => [g.base, g.origin]), F.gotAt(hostA).map(() => [baseA, F.hubOrigin]), 'each names the laptop base, from the hub');

  // DW2: a hub-route from the selected frame: replaceState, no history entry
  const len0 = await p.ev('history.length');
  let n = F.gotAt(hostA).length;
  await into(p, A, routeFrom('#progress?goal=g-2'));
  await p.until("the hub's address at alpha's new head", `${hubHash} === '#alpha/progress?goal=g-2'`);
  assert.equal(await p.ev('history.length'), len0, 'replaceState: no history entry');
  // DW3: a hub-base after each accepted hub-route
  await until(() => F.gotAt(hostA).length > n, 'a hub-base after the accepted hub-route');
  // a null head: the bare key
  await into(p, A, routeFrom(null));
  await p.until('the bare key for a null head', `${hubHash} === '#alpha'`);
  // the frame's own navigation reaches the hub's address through the fake's hub-route
  await into(p, A, `location.hash = '#goals?th=open', true`);
  await p.until("the hub follows the frame's own hash", `${hubHash} === '#alpha/goals?th=open'`);
  // and the frame really at the deep head from here on, so a reload and the kept head agree
  await into(p, A, `location.hash = '#progress?goal=g-2', true`);
  await p.until('back at the deep head', `${hubHash} === '#alpha/progress?goal=g-2'`);

  // heads that are neither null nor a string starting with '#', from the right frame: nothing
  for (const bad of ['progress', '', 42, { head: '#x' }, ['#x']]) await into(p, A, routeFrom(bad));
  await into(p, A, `parent.postMessage({ devteam: 'hub-route' }, '*'), true`);
  // from the hub's own window, which is no project's frame
  await p.ev(`window.postMessage({ devteam: 'hub-route', head: '#own' }, '*'), true`);
  await pause(800);
  assert.equal(await p.ev(hubHash), '#alpha/progress?goal=g-2', "bad heads and the hub's own window change nothing");
  // a head over 2,048 characters is refused (the dashboard sends null for one); one of 2,048 is taken
  await into(p, A, routeFrom(`#${'x'.repeat(2048)}`));
  await pause(800);
  assert.equal(await p.ev(hubHash), '#alpha/progress?goal=g-2', 'a head over 2,048 characters changes nothing');
  await into(p, A, routeFrom(`#${'y'.repeat(2047)}`));
  await p.until('a head of 2,048 characters is taken', `${hubHash} === ${JSON.stringify(`#alpha/${'y'.repeat(2047)}`)}`);
  await into(p, A, routeFrom('#progress?goal=g-2'));
  await p.until('back at the deep head', `${hubHash} === '#alpha/progress?goal=g-2'`);

  // DW2, DW4: beta's frame (made by selecting it) posts while alpha is selected: kept, not shown
  await p.ev(`select('/srv/beta')`);
  await p.until("beta's tab", tabOn('beta'));
  await until(() => F.gotAt(hostB).length > 0, "beta's frame received a hub-base");
  assert.equal(F.gotAt(hostB).at(-1).base, `${F.hubOrigin}/#beta/`);
  n = F.gotAt(hostA).length;
  await p.ev(`select('/srv/alpha')`);
  await p.until('alpha again, at its kept head', `${hubHash} === '#alpha/progress?goal=g-2'`);
  // DW3: a hub-base on each select
  await until(() => F.gotAt(hostA).length > n, 'a hub-base on selecting alpha');
  await into(p, B, `location.hash = '#goals', true`);
  await pause(800);
  assert.equal(await p.ev(hubHash), '#alpha/progress?goal=g-2', "beta's hub-route doesn't move alpha's address");
  await p.ev(`select('/srv/beta')`);
  await p.until("beta's kept head shows when its tab is selected", `${hubHash} === '#beta/goals'`);
  await p.ev(`select('/srv/alpha')`);
  await p.until('alpha keeps its deep head across the switch', `${hubHash} === '#alpha/progress?goal=g-2'`);

  // a frame on alpha's origin that isn't alpha's project frame: nothing
  F.posted = [];
  await p.ev(`(() => { const f = document.createElement('iframe'); f.id = 'impostor'; f.src = ${JSON.stringify(`${A}/rogue`)}; document.body.append(f); return true; })()`);
  await until(() => F.posted.includes(hostA), 'the impostor frame posted');
  await pause(500);
  assert.equal(await p.ev(hubHash), '#alpha/progress?goal=g-2', 'a frame that is not a project frame changes nothing');
  await p.ev(`document.getElementById('impostor').remove(), true`);

  // DW3: the frame reloads itself: a hub-base on that load too
  n = F.gotAt(hostA).length;
  await into(p, A, 'location.reload(), true');
  await until(() => F.gotAt(hostA).length > n, "a hub-base after alpha's frame reloaded itself");

  // DW2, DW3: alpha's frame, on another origin (beta's): its hub-route changes nothing, and it is sent no hub-base
  F.posted = [];
  const gotBefore = F.got.length;
  await into(p, A, `location.href = ${JSON.stringify(`${B}/rogue`)}, true`);
  await until(() => F.posted.includes(hostB), "the rogue page in alpha's frame posted");
  await pause(800);
  assert.equal(await p.ev(hubHash), '#alpha/progress?goal=g-2', 'the right window on the wrong origin changes nothing');
  assert.deepEqual(F.got.slice(gotBefore).filter((g) => g.path === '/rogue'), [], 'no hub-base reaches a document on another origin');
});

test("after a tab switch away and back, a reload opens the view the hub's address follows; the base names the hub's path", CHROME, async (t) => {
  const F = await fixture(t, { ports: 2 });
  const [PA, PB] = F.ports;
  const hostA = `127.0.0.1:${PA}`;
  F.list = [hello('alpha', PA), hello('beta', PB)];
  // the hub at /index.html: the base is its origin plus that path
  const p = await hubPage(t, F, 'index.html#alpha');
  await p.until("alpha's tab", tabOn('alpha'));
  await until(() => F.gotAt(hostA).length > 0, 'its hub-base');
  assert.equal(F.gotAt(hostA).at(-1).base, `${F.hubOrigin}/index.html#alpha/`, 'the base names the path the hub is served at');
  await into(p, F.lo(PA), `location.hash = '#progress?goal=g-2', true`);
  await p.until("the hub's address at the deep head", `${hubHash} === '#alpha/progress?goal=g-2'`);
  // DW4: switched to beta and back, then the hub reloaded: that view
  await p.ev(`select('/srv/beta')`);
  await p.until("beta's tab", tabOn('beta'));
  await p.ev(`select('/srv/alpha')`);
  await p.until('alpha again, at its deep head', `${hubHash} === '#alpha/progress?goal=g-2'`);
  F.seen = [];
  await p.send('Page.reload', {});
  await p.until('the hub, reloaded', `document.readyState === 'complete' && typeof select === 'function' && ${tabOn('alpha')}`);
  await until(() => F.hashAt(hostA) === '#progress?goal=g-2', 'the reload opens the deep head in the frame');
  assert.equal(await p.ev(hubHash), '#alpha/progress?goal=g-2', 'the reloaded address keeps it');
});

test("a project's port moves: its frame follows at the kept head, and the hub's address keeps it", CHROME, async (t) => {
  const F = await fixture(t, { ports: 2 });
  const [PA, PC] = F.ports;
  F.list = [hello('alpha', PA)];
  const p = await hubPage(t, F, '#alpha');
  await p.until("alpha's tab", tabOn('alpha'));
  await until(() => F.gotAt(`127.0.0.1:${PA}`).length > 0, 'its hub-base');
  await into(p, F.lo(PA), `location.hash = '#board?goal=g-3', true`);
  await p.until("the hub's address at the deep head", `${hubHash} === '#alpha/board?goal=g-3'`);
  F.list = [hello('alpha', PC)];
  await p.ev('draw().then(() => true)');
  await p.until('the frame pointed at the new port', `${shown}?.startsWith(${JSON.stringify(`${F.lo(PC)}/`)})`);
  assert.equal(await p.ev(shown), `${F.lo(PC)}/#board?goal=g-3`, 'the new address plus the kept head');
  await until(() => F.hashAt(`127.0.0.1:${PC}`) === '#board?goal=g-3', 'the frame at the new port shows the deep head');
  await pause(500);
  assert.equal(await p.ev(hubHash), '#alpha/board?goal=g-3', "the hub's address keeps the deep head");
});

test('bare #<key>, #overview and #settings open as today; a key with a / round-trips encoded; #<name>/… opens the one project of that name', CHROME, async (t) => {
  const F = await fixture(t, { ports: 4 });
  const [PA, PS, PG1, PG2] = F.ports;
  F.list = [hello('alpha', PA), hello('team/app', PS, '/srv/team-app')];
  const p = await hubPage(t, F, '#alpha');
  // a bare key, as a push sends: that tab, its frame at the dashboard's own address
  await p.until("alpha's tab", tabOn('alpha'));
  assert.equal(await p.ev(shown), `${F.lo(PA)}/`, 'the bare address, as today');
  // and the address follows whatever head the frame then reports (a dashboard canonicalises a bare load), or stays bare;
  // read once the frame has its first hub-base, so its own load-time head is written
  await until(() => F.gotAt(`127.0.0.1:${PA}`).length > 0, "alpha's first hub-base");
  const own =await into(p, F.lo(PA), 'location.hash');
  await p.until('the address at the head the frame reports', `${hubHash} === ${JSON.stringify(own.length > 1 ? `#alpha/${own.slice(1)}` : '#alpha')}`);
  await p.go('#overview');
  await p.until('the Overview', `selected === '\\u0000overview' && !document.getElementById('overview').hidden`);
  assert.equal(await p.ev(hubHash), '#overview', 'the Overview at #overview, as today');
  await p.go('#settings');
  await p.until('Settings', `selected === '\\u0000settings' && !document.getElementById('settings-view').hidden`);
  assert.equal(await p.ev(hubHash), '#settings', 'Settings at #settings, as today');
  // a key with a '/' in it, encoded in the hub's address; the first literal '/' starts the head
  await p.go('#team%2Fapp/board?goal=g-1');
  await p.until("team/app's tab", tabOn('team/app'));
  await until(() => F.hashAt(`127.0.0.1:${PS}`) === '#board?goal=g-1', "team/app's frame at the head");
  await until(() => F.gotAt(`127.0.0.1:${PS}`).length > 0, "team/app's hub-base");
  assert.equal(F.gotAt(`127.0.0.1:${PS}`).at(-1).base, `${F.hubOrigin}/#team%2Fapp/`, 'the key encoded in the base too');
  await into(p, F.lo(PS), routeFrom('#goals'));
  await p.until('the key stays encoded', `${hubHash} === '#team%2Fapp/goals'`);
  // a hashchange to a deep head (a link clicked in the hub's own page): that project at that view
  await p.ev(`location.hash = '#alpha/progress?goal=g-9', true`);
  await p.until("alpha's tab, from the hashchange", tabOn('alpha'));
  await until(() => F.hashAt(`127.0.0.1:${PA}`) === '#progress?goal=g-9', "alpha's frame at the hashchange's head");
  // two projects named gamma: keys gamma-<hex>; one goes, and the other (still keyed by hex while the
  // gone one's tab lingers) is opened by its name
  F.list = [hello('alpha', PA), hello('gamma', PG1, '/srv/g1'), hello('gamma', PG2, '/srv/g2')];
  await p.ev('draw().then(() => true)');
  await p.until('two gamma tabs', `[...document.querySelectorAll('#tabs [role=tab]')].filter((x) => x.textContent.startsWith('gamma')).length === 2`);
  F.list = [hello('alpha', PA), hello('gamma', PG1, '/srv/g1')];
  await p.ev('draw().then(() => true)');
  assert.notEqual(await p.ev(`keyOf(items.get('/srv/g1'))`), 'gamma', 'still keyed by its hex while its twin lingers');
  await p.ev(`location.hash = '#gamma/board', true`);
  await p.until('the one gamma listed, by its name', `selected === '/srv/g1'`);
  await until(() => F.hashAt(`127.0.0.1:${PG1}`) === '#board', "gamma's frame at the head");
});

test("on a box: 2 box the base is the project's own host; on box: 1 it is the hub's laptop form; #terminal opens the terminal", CHROME, async (t) => {
  const F = await fixture(t, { ports: 1, hubHost: 'hub.localhost' });
  const [PA] = F.ports;
  F.list = [hello('alpha', PA)];
  F.box = (F_) => ({ box: 2, terminal: F_.at('term'), project: `http://{project}.localhost:${F_.port}/`, passkeys: F_.at('auth'), previews: F_.at('previews') });
  const p = await hubPage(t, F, '#alpha/board');
  await p.until("alpha's tab", tabOn('alpha'));
  const hostA = `alpha.localhost:${F.port}`;
  await until(() => F.hashAt(hostA) === '#board', "alpha's frame at its host, at the head");
  await until(() => F.gotAt(hostA).length > 0, 'a hub-base at its host');
  assert.equal(F.gotAt(hostA).at(-1).base, `http://${hostA}/#`, "box: 2: the project's own host");
  await p.go('#terminal');
  await p.until('the terminal', `selected === '\\u0000terminal'`);
  assert.equal(await p.ev(hubHash), '#terminal', 'the terminal at #terminal, as today');
  // box: 1: the port's host frames it; the base is the hub's own laptop form
  F.box = (F_) => ({ box: 1, terminal: F_.at('term'), instance: `http://{port}.localhost:${F_.port}/` });
  await p.go('#alpha');
  await p.until("alpha's tab", tabOn('alpha'));
  const host1 = `${PA}.localhost:${F.port}`;
  await until(() => F.gotAt(host1).length > 0, 'a hub-base at the port host');
  assert.equal(F.gotAt(host1).at(-1).base, `${F.hubOrigin}/#alpha/`, "box: 1: the hub's own address");
});

test('an operator thread on the Overview is #overview?ot=<id>, by replaceState; closing it is #overview; a cold #overview?ot=<id> opens its card', CHROME, async (t) => {
  const F = await fixture(t);
  F.threads = [THREAD];
  const card = `!document.getElementById('tl-card').hidden && document.getElementById('tl-c-title')?.textContent === ${JSON.stringify(THREAD.title)}`;
  const p = await hubPage(t, F, '#overview');
  await p.until('the Overview', `selected === '\\u0000overview'`);
  const len0 = await p.ev('history.length');
  // opened from the dock's row, as the owner opens it
  await p.ev(`tlOpen(${JSON.stringify(OT)}).then(() => true)`);
  await p.until("the thread's card", card);
  assert.equal(await p.ev(hubHash), `#overview?ot=${OT}`, 'opening it writes ot');
  await p.ev(`document.querySelector('#tl-card [data-tl-close]').click(), true`);
  await p.until('the card put away', `document.getElementById('tl-card').hidden`);
  assert.equal(await p.ev(hubHash), '#overview', 'closing it drops ot');
  assert.equal(await p.ev('history.length'), len0, 'both by replaceState');
  // a cold load at the thread's address opens its card
  await p.go(`#overview?ot=${OT}`);
  await p.until("the thread's card, opened cold", card);
  assert.equal(await p.ev(hubHash), `#overview?ot=${OT}`, 'the address keeps it');
});
