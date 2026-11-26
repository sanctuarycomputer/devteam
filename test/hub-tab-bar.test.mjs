// The hub's tabs are the shell's tab bar, and every tab the owner chooses is a Back step
// (dashboard-shell@3 §5 and §10, test/contracts/shell.md): nav#tabs holds tabBar's tabs, each choice
// pushes an entry marked { hub: 1, key }, Back and Forward only select (no openAt, no frame moves),
// hub-route still replaces and keeps the marker, and a project's frame hears hub-visible.
// Each project is test/fixtures/dashboard-frame-fake.html on an origin of its own; the test's server
// puts a recorder in front of it that reports each load and hashchange, each hub-base and each
// hub-visible the frame receives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { kit, testDir } from './lib/kit.mjs';
import { canDrive, openChrome } from './lib/chrome.mjs';

// a wait that fails says which one within 15 s, inside the test's limit
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
// a pulse the Overview reads (as test/hub-overview.test.mjs's hello sends): the card then draws its stats
const PULSE = { state: 'moving', blocking: null, working: 1, last_activity: new Date().toISOString(), activity: Array(84).fill(0), activity_of: 'commits', attention: [], open_tickets: 2, done_tickets: 1, blocked_tickets: 0, goals_open: 1, goal: { title: 'a goal', done: 1, total: 3 } };
const hello = (name, port, root = `/srv/${name}`) => ({ devteam: 1, name, root, port, kit: 'v0.70.0', viewer: 1, inbox: 0, threads: { you: 0, waiting: 0, ready: 0 }, fleet: { mode: 'run', workers: 1 }, pulse: null });
// before the fake's own script: each load and hashchange, each hub-base and hub-visible the frame receives
const RECORDER = `<script>(() => {
  const tell = (what, o) => fetch('/' + what + '?' + new URLSearchParams({ host: location.host, path: location.pathname, ...o }), { cache: 'no-store' }).catch(() => {});
  tell('seen', { hash: location.hash });
  addEventListener('hashchange', () => tell('seen', { hash: location.hash }));
  addEventListener('message', (e) => {
    const m = e.data;
    if (m && m.devteam === 'hub-base') tell('got', { base: String(m.base), origin: e.origin });
    if (m && m.devteam === 'hub-visible') tell('vis', { visible: JSON.stringify(m.visible), origin: e.origin });
  });
})()</script>`;

async function listenOn(t, srv) {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  defer(t, () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }));
  return srv.address().port;
}
// One server is the hub (Host <hubHost>:<port>) and every frame's origin: any other Host, and the extra
// loopback ports. On a laptop the hub is on 127.0.0.1, so its frames are in its process (evIn reaches
// them). F.box(F) is box.json's body, or null for none (404).
async function fixture(t, { ports = 0, hubHost = '127.0.0.1' } = {}) {
  const F = { list: [], box: () => null, got: [], seen: [], vis: [] };
  const serve = (q, s) => {
    const u = new URL(q.url, 'http://x');
    if (q.headers.host === F.hubHost) {
      if (u.pathname === '/') { s.writeHead(200, { 'content-type': 'text/html' }); return s.end(hubHtml()); }
      if (u.pathname === '/instances.json') { s.writeHead(200, { 'content-type': 'application/json' }); return s.end(JSON.stringify({ hub: 1, kit: 'v0.70.0', instances: F.list })); }
      if (u.pathname === '/operator/threads') { s.writeHead(200, { 'content-type': 'application/json' }); return s.end(JSON.stringify({ threads: [], operator: { state: 'running', can_start: false, box: false } })); }
      const b = u.pathname === '/box.json' ? F.box(F) : null;
      if (b) { s.writeHead(200, { 'content-type': 'application/json' }); return s.end(JSON.stringify(b)); }
      s.writeHead(404, { 'content-type': 'application/json' });
      return s.end('{}');
    }
    const said = Object.fromEntries(u.searchParams);
    if (u.pathname === '/got') { F.got.push(said); return s.end('{}'); }
    if (u.pathname === '/seen') { F.seen.push(said); return s.end('{}'); }
    if (u.pathname === '/vis') { F.vis.push(said); return s.end('{}'); }
    s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    s.end(FAKE.includes('<head>') ? FAKE.replace('<head>', () => `<head>\n${RECORDER}`) : `${RECORDER}\n${FAKE}`);
  };
  F.port = await listenOn(t, http.createServer(serve));
  F.hubHost = `${hubHost}:${F.port}`;
  F.hubOrigin = `http://${F.hubHost}`;
  F.ports = [];
  for (let i = 0; i < ports; i++) F.ports.push(await listenOn(t, http.createServer(serve)));
  F.hubAt = (hash) => `${F.hubOrigin}/${hash}`;
  F.lo = (port) => `http://127.0.0.1:${port}`;
  F.loadsAt = (host) => F.seen.filter((x) => x.host === host).length;
  F.visAt = (host) => F.vis.filter((x) => x.host === host).map((x) => x.visible);
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
  await p.send('Page.navigate', { url: F.hubAt(hash) });
  await p.until('the hub, loaded', `document.readyState === 'complete' && document.title === 'devteam' && typeof select === 'function'`);
  return p;
}
const tabSel = (name) => `[...document.querySelectorAll('#tabs [role=tab]')].find((x) => x.textContent.startsWith(${JSON.stringify(name)}))`;
const isOn = (name) => `${tabSel(name)}?.getAttribute('aria-selected') === 'true'`;
const onNow = `(document.querySelector('#tabs [role=tab][aria-selected=true]')?.textContent ?? null)`;
const stateNow = `JSON.stringify(history.state)`;
// a real click on a tab, found by its name
const clickTab = async (p, name) => p.click(`#${await p.ev(`${tabSel(name)}.id`)}`);
// counts calls of openAt from here on (a top-level function declaration: its global binding is replaced)
const SPY = `(() => { if (!window.__spied) { window.__spied = true; window.__openAt = 0; const o = openAt; openAt = (...a) => { window.__openAt++; return o(...a); }; } return true; })()`;

test('terminal A18: nav#tabs is tabBar output; a project, Overview or Settings chosen pushes a marked entry; Back and Forward only select; hub-route still replaces', CHROME, async (t) => {
  const F = await fixture(t, { ports: 2 });
  const [PA, PB] = F.ports;
  const hostA = `127.0.0.1:${PA}`;
  const hostB = `127.0.0.1:${PB}`;
  // alpha's pulse gives its card its stats, the Inbox button among them
  F.list = [{ ...hello('alpha', PA), pulse: PULSE }, hello('beta', PB)];
  const p = await hubPage(t, F, '#overview');
  await p.until('three tabs', `document.querySelectorAll('#tabs [role=tab]').length === 3`);

  // tabBar's output, taken into the nav: one tablist, each tab tied to the one panel
  const bar = await p.ev(`(() => { const n = document.getElementById('tabs'); return { role: n.getAttribute('role'), label: n.getAttribute('aria-label'), tabbar: n.classList.contains('tabbar'), nested: n.querySelectorAll('[role=tablist]').length, panel: document.getElementById('frames').getAttribute('role'), tabs: [...n.querySelectorAll('[role=tab]')].map((b) => ({ tag: b.tagName, type: b.getAttribute('type'), tab: b.dataset.tab, id: b.id, controls: b.getAttribute('aria-controls'), sel: b.getAttribute('aria-selected'), ti: b.tabIndex })) }; })()`);
  assert.deepEqual([bar.role, bar.label, bar.tabbar, bar.nested, bar.panel], ['tablist', 'devteam instances', true, 0, 'tabpanel'], 'nav#tabs keeps its role and label, is the tab bar, holds no tablist, and #frames is its panel');
  assert.equal(bar.tabs[0].tab, 'overview', 'the Overview tab first');
  for (const b of bar.tabs) {
    assert.deepEqual([b.tag, b.type, b.id, b.controls], ['BUTTON', 'button', `tab-frames-${b.tab}`, 'frames'], `tab ${b.tab}: tabBar's id and aria-controls`);
    assert.match(b.tab, /^(overview|p-[0-9a-f]{6})$/, 'a project tab id is p-<6 hex>');
  }
  assert.deepEqual(bar.tabs.map((b) => [b.sel, b.ti]), [['true', 0], ['false', -1], ['false', -1]], 'roving tabindex: the selected tab alone is in the tab order');
  assert.equal(await p.ev(`document.getElementById('frames').getAttribute('aria-labelledby')`), 'tab-frames-overview', 'the panel is labelled by the selected tab');

  const len0 = await p.ev('history.length');
  // a click on a project's tab pushes, marked with its key: read in the click's own task, before its frame can say a head
  const chose = await p.ev(`(() => { ${tabSel('alpha')}.click(); return [history.length, JSON.stringify(history.state)]; })()`);
  assert.equal(chose[0], len0 + 1, 'a project chosen: one new entry');
  assert.deepEqual(JSON.parse(chose[1]), { hub: 1, key: 'alpha' }, "alpha's entry is marked");
  await p.until("alpha's tab selected", isOn('alpha'));
  assert.equal(await p.ev(`document.getElementById('frames').getAttribute('aria-labelledby')`), await p.ev(`${tabSel('alpha')}.id`), 'the panel follows the selected tab');
  assert.deepEqual(await p.ev(`[${tabSel('alpha')}.tabIndex, ${tabSel('Overview')}.tabIndex]`), [0, -1], 'roving tabindex follows');
  // its frame says its head: the hub-route replaces, the marker kept
  await until(() => F.loadsAt(hostA) > 0, "alpha's frame loaded");
  await p.until("alpha's head in the address", `location.hash === '#alpha/overview'`);
  assert.equal(await p.ev('history.length'), len0 + 1, 'hub-route: no new entry');
  assert.deepEqual(JSON.parse(await p.ev(stateNow)), { hub: 1, key: 'alpha' }, 'hub-route keeps the marker');

  // the arrow keys move the selection with focus, each a choice
  await p.key('ArrowRight');
  await p.until("beta's tab selected", isOn('beta'));
  assert.equal(await p.ev(`document.activeElement === ${tabSel('beta')}`), true, 'focus moves with the arrow');
  assert.equal(await p.ev('history.length'), len0 + 2, 'ArrowRight: one new entry');
  assert.deepEqual(JSON.parse(await p.ev(stateNow)), { hub: 1, key: 'beta' }, "beta's entry is marked");
  await p.key('ArrowLeft');
  await p.until("alpha's tab again", isOn('alpha'));
  assert.equal(await p.ev('history.length'), len0 + 3, 'ArrowLeft: one new entry');
  // the Overview, then Settings by its link
  const ov = await p.ev(`(() => { ${tabSel('Overview')}.click(); return [history.length, JSON.stringify(history.state)]; })()`);
  await p.until('the Overview', isOn('Overview'));
  assert.equal(ov[0], len0 + 4, 'the Overview chosen: one new entry');
  assert.deepEqual(JSON.parse(ov[1]), { hub: 1, key: 'overview' }, "the Overview's entry is marked");
  await p.click('#ov-body > .ov-head a.set');
  await p.until('Settings', `location.hash === '#settings' && !document.getElementById('settings-view').hidden`);
  assert.equal(await p.ev('history.length'), len0 + 5, 'Settings chosen: one new entry');
  assert.deepEqual(JSON.parse(await p.ev(stateNow)), { hub: 1, key: 'settings' }, "Settings' entry is marked");
  // a click on the tab already selected adds nothing
  await clickTab(p, 'Overview');
  await p.until('the Overview', isOn('Overview'));
  assert.equal(await p.ev('history.length'), len0 + 6, 'the Overview from Settings: one new entry');
  await clickTab(p, 'Overview');
  await pause(300);
  assert.equal(await p.ev('history.length'), len0 + 6, 'the selected tab clicked again: no entry');

  // Back and Forward: each only selects the tab before; no openAt, no frame loads or moves, no entry
  await p.ev(SPY);
  await pause(500);
  const loads = [F.loadsAt(hostA), F.loadsAt(hostB)];
  // the entry each step lands on, by the Navigation API's index: a push inside a step lands one further
  // on (and drops the Forward entries, which history.length can't show)
  let at = await p.ev('navigation.currentEntry.index');
  const steps = [['back', 'Settings'], ['back', 'Overview'], ['back', 'alpha'], ['back', 'beta'], ['back', 'alpha'], ['back', 'Overview'], ['forward', 'alpha'], ['forward', 'beta']];
  for (const [dir, want] of steps) {
    await p.ev(`history.${dir}()`);
    if (want === 'Settings') await p.until('Settings, by Back', `!document.getElementById('settings-view').hidden && location.hash === '#settings'`);
    else await p.until(`${want}, by ${dir}`, isOn(want));
    await pause(300);
    // after each step, before the next can go wrong
    assert.equal(await p.ev('window.__openAt'), 0, `no openAt on a Back or Forward step (${dir} to ${want})`);
    assert.deepEqual([F.loadsAt(hostA), F.loadsAt(hostB)], loads, `no frame loads or moves on a Back or Forward step (${dir} to ${want})`);
    at += dir === 'back' ? -1 : 1;
    assert.equal(await p.ev('navigation.currentEntry.index'), at, `Back and Forward push nothing: the step lands on the next entry (${dir} to ${want})`);
    assert.equal(await p.ev('history.length'), len0 + 6, `Back and Forward push nothing (${dir} to ${want})`);
  }
  assert.equal(await p.ev(`location.hash`), '#beta/overview', "beta's entry, at its kept head");
  // Forward survives: one more Forward reaches alpha, then the Overview
  await p.ev('history.forward()');
  await p.until('alpha, by forward', isOn('alpha'));
  await p.ev('history.forward()');
  await p.until('the Overview, by forward', isOn('Overview'));
  // a project opened from the Overview (its frame already made), by its Inbox: one Back returns to the Overview
  await p.ev(`document.querySelector('[data-k="/srv/alpha:inbox"]').click(), true`);
  await p.until("alpha, from the Overview's Inbox", isOn('alpha'));
  await until(() => F.seen.filter((x) => x.host === hostA).at(-1)?.hash === '#overview?th=inbox', "alpha's frame at its Inbox");
  await pause(500);
  await p.ev('history.back()');
  await p.until('the Overview, one Back after its Inbox link', isOn('Overview'));
});

test('terminal A18: on a box the Terminal tab is tabBar\'s and a Back step; Back to it opens no second terminal', CHROME, async (t) => {
  const F = await fixture(t, { hubHost: 'hub.localhost' });
  F.box = (G) => ({ box: 1, terminal: `http://term.localhost:${G.port}/`, instance: `http://i{port}.localhost:${G.port}/` });
  F.list = [hello('alpha', 41001)];
  const p = await hubPage(t, F, '#overview');
  await p.until('three tabs', `document.querySelectorAll('#tabs [role=tab]').length === 3`);
  assert.deepEqual(await p.ev(`(() => { const b = ${tabSel('Terminal')}; return [b.dataset.tab, b.id, b.getAttribute('aria-controls'), b.title]; })()`), ['terminal', 'tab-frames-terminal', 'frames', 'The box\'s tmux sessions: supervisors, workers, logins']);
  const len0 = await p.ev('history.length');
  await clickTab(p, 'Terminal');
  await p.until('the terminal', isOn('Terminal'));
  assert.equal(await p.ev('history.length'), len0 + 1, 'the Terminal chosen: one new entry');
  assert.deepEqual(JSON.parse(await p.ev(stateNow)), { hub: 1, key: 'terminal' });
  await clickTab(p, 'Overview');
  await p.until('the Overview', isOn('Overview'));
  await p.ev('history.back()');
  await p.until('the terminal, by Back', isOn('Terminal') + ` && location.hash === '#terminal'`);
  assert.equal(await p.ev(`document.querySelectorAll('#frames iframe[title=Terminal]').length`), 1, 'one terminal frame, kept');
  await p.ev('history.forward()');
  await p.until('the Overview, by Forward', isOn('Overview'));
  assert.equal(await p.ev('history.length'), len0 + 2, 'Back and Forward push nothing');
});

test("terminal A18b: a project's frame hears hub-visible true when its tab is selected and false when it is left", CHROME, async (t) => {
  const F = await fixture(t, { ports: 2 });
  const [PA, PB] = F.ports;
  const hostA = `127.0.0.1:${PA}`;
  const hostB = `127.0.0.1:${PB}`;
  F.list = [hello('alpha', PA), hello('beta', PB)];
  const p = await hubPage(t, F, '#overview');
  await p.until('three tabs', `document.querySelectorAll('#tabs [role=tab]').length === 3`);
  await clickTab(p, 'alpha');
  await until(() => F.visAt(hostA).includes('true'), 'alpha hears visible: true');
  assert.ok(F.vis.filter((x) => x.host === hostA).every((x) => x.origin === F.hubOrigin), 'from the hub');
  await clickTab(p, 'beta');
  await until(() => F.visAt(hostA).at(-1) === 'false', 'alpha hears visible: false when beta is chosen');
  await until(() => F.visAt(hostB).at(-1) === 'true', 'beta hears visible: true');
  await clickTab(p, 'Overview');
  await until(() => F.visAt(hostB).at(-1) === 'false', 'beta hears visible: false when the Overview is chosen');
  assert.equal(F.visAt(hostA).at(-1), 'false', 'alpha still hidden');
  // Back to beta: it shows again
  await p.ev('history.back()');
  await until(() => F.visAt(hostB).at(-1) === 'true', 'beta hears visible: true on Back');
});

test('terminal A18c: the first entry is stamped on load; hub-route keeps the marker; a hash typed by hand opens as @2 §10 says; after a reload Back opens a frameless project at its head', CHROME, async (t) => {
  const F = await fixture(t, { ports: 2 });
  const [PA, PB] = F.ports;
  const hostA = `127.0.0.1:${PA}`;
  F.list = [hello('alpha', PA), hello('beta', PB)];
  // a cold load with no frame to say a head: the first entry alone
  const p = await hubPage(t, F, '#overview');
  await p.until('the first entry stamped', `JSON.stringify(history.state) === '{"hub":1,"key":"overview"}'`);
  const len0 = await p.ev('history.length');
  await p.until('three tabs', `document.querySelectorAll('#tabs [role=tab]').length === 3`);
  await p.ev(`${tabSel('alpha')}.click(), true`);
  await p.until("alpha's tab", isOn('alpha'));
  // the frame moves: hub-route replaces, marked
  await until(() => F.loadsAt(hostA) > 0, "alpha's frame loaded");
  await p.until("alpha's first head", `location.hash === '#alpha/overview'`);
  await p.evIn(F.lo(PA), `location.hash = '#goals', true`);
  await p.until("alpha's new head", `location.hash === '#alpha/goals'`);
  // the frame's own hash change is an entry of the browser's (joint history); the hub's hub-route adds none
  assert.equal(await p.ev('history.length'), len0 + 2, "hub-route: the frame's own entry only (after alpha's push)");
  assert.deepEqual(JSON.parse(await p.ev(stateNow)), { hub: 1, key: 'alpha' }, 'hub-route keeps the marker');
  // a hash typed by hand: the browser's own entry, opened as @2 §10 says (beta selected), then marked; the hub adds none
  await p.ev(`location.hash = '#beta', true`);
  await p.until("beta's tab", isOn('beta'));
  await p.until('the typed entry marked', `history.state?.hub === 1 && history.state?.key === 'beta'`);
  await pause(500);
  assert.equal(await p.ev('history.length'), len0 + 3, "the typed hash's entry only");
  // a reload: frames and kept heads are gone, the marks aren't. Back onto alpha opens it at its entry's head
  await p.send('Page.reload');
  await p.until('the hub, reloaded', `document.readyState === 'complete' && typeof select === 'function' && ${isOn('beta')}`);
  const loadsA = F.loadsAt(hostA);
  await p.ev('history.back()');
  await p.until('alpha, by Back after the reload', isOn('alpha'));
  await until(() => F.seen.filter((x) => x.host === hostA).length > loadsA && F.seen.filter((x) => x.host === hostA).at(-1).hash === '#goals', "alpha's new frame at its entry's head");
  assert.equal(await p.ev('history.length'), len0 + 3, 'the step pushes nothing');
});

test("terminal A18d: a frame's hub-route between a typed hash's popstate and its hashchange keeps its head but leaves the typed hash to open", CHROME, async (t) => {
  const F = await fixture(t, { ports: 2 });
  const [PA, PB] = F.ports;
  F.list = [hello('alpha', PA), hello('beta', PB)];
  const p = await hubPage(t, F, '#alpha');
  await p.until("alpha's tab", isOn('alpha'));
  await until(() => F.loadsAt(`127.0.0.1:${PA}`) > 0, "alpha's frame loaded");
  await p.until("alpha's first head", `location.hash === '#alpha/overview'`);
  // the race, made certain: alpha's frame's hub-route arrives after the typed hash's popstate and before its
  // hashchange (a capture listener runs before the hub's own; the message carries the frame's own source and origin)
  await p.ev(`(() => {
    const it = items.get('/srv/alpha');
    window.addEventListener('popstate', () => window.dispatchEvent(new MessageEvent('message', { data: { devteam: 'hub-route', head: '#board' }, origin: new URL(urlOf(it.x)).origin, source: it.frame.contentWindow })), { capture: true, once: true });
    return true;
  })()`);
  await p.ev(`location.hash = '#beta', true`);
  await p.until("beta's tab, from the typed hash", isOn('beta'));
  assert.match(await p.ev('location.hash'), /^#beta/, 'the typed hash opened, not overwritten by the route');
  assert.equal(await p.ev(`items.get('/srv/alpha').head`), '#board', "alpha's head kept from its route");
});
