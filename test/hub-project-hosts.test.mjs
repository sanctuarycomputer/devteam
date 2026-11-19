// The hub on a box frames each project at its own host (box.json box: 2, project-hosts@1 in
// cloud/gateway.mjs), says plainly when a project can't have one, and keeps box: 1 and a laptop as
// they were. One server is the hub (Host hub.localhost:<G>) and the fake gateway: any other Host is a
// project's stand-in dashboard, which says where it is and answers the fleet ask.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { freePort, kit, testDir, until } from './lib/kit.mjs';
import { canDrive, openChrome } from './lib/chrome.mjs';

const FIX = JSON.parse(fs.readFileSync(path.join(testDir, 'fixtures', 'project-hosts.json'), 'utf8'));
const hubHtml = () => fs.readFileSync(path.join(kit, 'dashboard', 'hub.html'), 'utf8');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

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

function hello(name, port, over = {}) {
  const { pulse, ...rest } = over;
  return {
    devteam: 1, name, root: `/srv/${name}`, port, kit: 'v0.57.0', viewer: 1, inbox: 0, threads: { you: 0, waiting: 0, ready: 0 }, fleet: { mode: 'run', workers: 1 }, ...rest,
    pulse: pulse === null ? null : { state: 'moving', blocking: null, working: 1, last_activity: new Date().toISOString(), activity: Array(84).fill(0), activity_of: 'commits', attention: [], open_tickets: 2, done_tickets: 1, blocked_tickets: 0, goals_open: 1, goal: { title: `${name}'s goal`, done: 1, total: 3 }, ...(pulse || {}) },
  };
}
// a project's dashboard, standing in: it says where it is (and its hash), and answers the hub's ask
const STAND_IN = `<!doctype html><meta charset="utf-8"><title>stand-in</title><script>
const say = () => fetch('/seen?host=' + encodeURIComponent(location.host) + '&hash=' + encodeURIComponent(location.hash));
say(); addEventListener('hashchange', say);
addEventListener('message', async (ev) => {
  const m = ev.data;
  if (!m || m.devteam !== 'hub-fleet' || ev.source !== parent) return;
  const r = await (await fetch('/asked?mode=' + encodeURIComponent(m.mode) + '&nonce=' + encodeURIComponent(m.nonce))).json();
  if (r.answer) parent.postMessage({ devteam: 'hub-fleet-done', nonce: m.nonce, ...r.answer }, ev.origin);
});
</script>`;
async function listenOn(t, srv, port = 0) {
  await new Promise((r) => srv.listen(port, '127.0.0.1', r));
  defer(t, () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }));
  return srv.address().port;
}
// box(F): box.json's body, or null for none (404). csp: send frame-src naming F.allowed (read at each
// load) and the terminal. hold: ms every hub load after the first waits before it is answered, so the
// page that asked for it stays up meanwhile (as a slow reload leaves it). F.loads counts the hub's loads.
async function fixture(t, { box = null, csp = false, standIns = [], hold = 0 } = {}) {
  const F = { list: [], loads: 0, seen: [], asks: [], allowed: [] };
  const nonces = new Set();
  const serve = (q, s) => {
    const u = new URL(q.url, 'http://x');
    if (q.headers.host === `hub.localhost:${F.port}`) {
      if (u.pathname === '/') {
        F.loads++;
        const answer = () => {
          s.writeHead(200, { 'content-type': 'text/html', ...(csp ? { 'content-security-policy': `frame-src ${[...F.allowed, `http://term.localhost:${F.port}`].join(' ')}` } : {}) });
          s.end(hubHtml());
        };
        return void (hold && F.loads > 1 ? setTimeout(answer, hold) : answer());
      }
      if (u.pathname === '/instances.json') { s.writeHead(200, { 'content-type': 'application/json' }); return s.end(JSON.stringify({ hub: 1, kit: 'v0.57.0', instances: F.list })); }
      const b = u.pathname === '/box.json' && box ? box(F) : null;
      if (b) { s.writeHead(200, { 'content-type': 'application/json' }); return s.end(JSON.stringify(b)); }
      s.writeHead(404, { 'content-type': 'application/json' });
      return s.end('{}');
    }
    if (u.pathname === '/seen') { F.seen.push({ host: u.searchParams.get('host'), hash: u.searchParams.get('hash') }); return s.end('{}'); }
    if (u.pathname === '/asked') {
      const nonce = u.searchParams.get('nonce');
      if (nonces.has(nonce)) return s.end('{"answer":null}');
      nonces.add(nonce);
      F.asks.push({ host: q.headers.host, mode: u.searchParams.get('mode') });
      return s.end('{"answer":{"ok":true}}');
    }
    s.writeHead(200, { 'content-type': 'text/html' });
    s.end(STAND_IN);
  };
  F.port = await listenOn(t, http.createServer(serve));
  for (const port of standIns) await listenOn(t, http.createServer(serve), port);
  F.at = (label) => `http://${label}.localhost:${F.port}/`;
  F.hub = (hash = '#overview') => `http://hub.localhost:${F.port}/${hash}`;
  F.seenFrom = (host) => F.seen.filter((x) => x.host === host).length;
  return F;
}
// box.json as the fixture's boxJson has it, on the test's server
const box2 = (F, over = {}) => ({ ...FIX.boxJson, terminal: F.at('term'), project: `http://{project}.localhost:${F.port}/`, passkeys: F.at('auth'), previews: F.at('previews'), ...over });
// ports a hello can name; nothing listens on them, and none is the hub's
async function freePorts(n, not = []) { const out = []; while (out.length < n) { const p = await freePort(); if (!out.includes(p) && !not.includes(p)) out.push(p); } return out; }
// Chrome on the hub at hub.localhost: a page that can't load it fails the test (CI's chrome jobs can)
async function hubPage(t, url) {
  const chrome = await openChrome();
  defer(t, () => chrome.close());
  const p = await chrome.newPage();
  defer(t, () => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.navigate', { url });
  p.until = (what, expr) => until(() => p.ev(expr).catch(() => false), what);
  await p.until('the hub, loaded from hub.localhost', `document.title === 'devteam' && typeof select === 'function'`);
  return p;
}
const CHROME = { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 };
const cardOf = (name) => `[...document.querySelectorAll('.ov-card')].find((c) => c.querySelector('.ov-name')?.textContent === ${JSON.stringify(name)})`;
const hasTerminal = `[...document.querySelectorAll('#tabs [role=tab]')].some((x) => x.textContent === 'Terminal')`;
// the one visible frame's src, once that root's tab is chosen
const shown = `(() => { const f = [...document.querySelectorAll('#frames iframe')].filter((x) => !x.hidden); return f.length === 1 ? f[0].getAttribute('src') : null; })()`;
const open = (root) => `select(${JSON.stringify(root)})`;
// the card's ⋯ menu: its rows and its buttons
const menuOf = (name) => `(() => { ${cardOf(name)}.querySelector('.menu-btn').click(); const m = document.querySelector('.menu-pop'); return { rows: [...m.querySelectorAll('.mi > div')].map((d) => [d.children[0].textContent, d.children[1].textContent]), buttons: [...m.querySelectorAll('button')].map((b) => b.textContent) }; })()`;

test('box: 2: each project framed at its own host, Open in a new tab opens it, and nothing rendered names a port (C1.1, C1.2, C1.3)', CHROME, async (t) => {
  const F = await fixture(t, { box: (F_) => box2(F_), csp: true });
  const [PA, PB] = await freePorts(2, [F.port]);
  F.allowed = [F.at('alpha'), F.at('beta-app')].map((u) => u.replace(/\/$/, ''));
  F.list = [hello('alpha', PA), hello('beta-app', PB)];
  const p = await hubPage(t, F.hub());
  await p.until('two cards', `document.querySelectorAll('.ov-card').length === 2`);
  assert.equal(await p.ev(hasTerminal), true, 'box: 2 is a box: the Terminal tab');
  for (const name of ['alpha', 'beta-app']) {
    await p.ev(open(`/srv/${name}`));
    await p.until(`${name}'s frame`, `${shown} !== null`);
    assert.equal(await p.ev(shown), F.at(name), `${name} at its host`);
    await until(() => F.seenFrom(`${name}.localhost:${F.port}`) > 0, `${name}'s stand-in loaded from its host`);
  }
  // C1.2: the card's ⋯, Open in a new tab
  await p.ev(`window.opened = []; window.open = (...a) => { window.opened.push(a); return null; }`);
  await p.ev(open('\u0000overview'));
  await p.until('the cards again', `!document.getElementById('overview').hidden && ${cardOf('alpha')} !== undefined`);
  const m = await p.ev(menuOf('alpha'));
  assert.deepEqual(m.rows, [['root', '/srv/alpha'], ['host', `alpha.localhost:${F.port}`]], 'the host in place of the port');
  assert.deepEqual(m.buttons, ['Open its dashboard', 'Open in a new tab']);
  await p.ev(`[...document.querySelectorAll('.menu-pop button')].find((b) => b.textContent === 'Open in a new tab').click()`);
  assert.deepEqual(await p.ev('window.opened'), [[F.at('alpha'), '_blank', 'noopener']]);
  // C1.3: both frames made, the menu open, and no port in any text or address the hub renders
  await p.ev(menuOf('alpha'));
  const said = await p.ev(`(() => { const b = document.body.cloneNode(true); b.querySelectorAll('script, style').forEach((e) => e.remove()); const attrs = [...document.querySelectorAll('*')].flatMap((e) => ['href', 'src', 'title', 'aria-label'].map((a) => e.getAttribute(a)).filter((v) => v !== null)); return [document.body.innerText, b.textContent, ...attrs]; })()`);
  assert.equal(await p.ev(`document.querySelectorAll('#frames iframe').length`), 2, 'both frames are there');
  for (const port of [PA, PB]) {
    const hit = said.find((s) => new RegExp(`\\b${port}\\b`).test(s));
    assert.equal(hit, undefined, `port ${port} rendered: ${hit?.slice(0, 200)}`);
  }
});

test('box: 1 frames the port host as today (C2.1)', CHROME, async (t) => {
  const F = await fixture(t, { box: (F_) => ({ box: 1, terminal: F_.at('term'), instance: `http://{port}.localhost:${F_.port}/` }) });
  const [PA] = await freePorts(1, [F.port]);
  F.list = [hello('alpha', PA)];
  const p = await hubPage(t, F.hub());
  await p.until('the card', `document.querySelectorAll('.ov-card').length === 1`);
  assert.equal(await p.ev(hasTerminal), true, 'the Terminal tab');
  await p.ev(open('/srv/alpha'));
  await p.until("alpha's frame", `${shown} !== null`);
  assert.equal(await p.ev(shown), `http://${PA}.localhost:${F.port}/`);
  const m = await p.ev(menuOf('alpha'));
  assert.deepEqual(m.rows, [['root', '/srv/alpha'], ['port', String(PA)]], 'box: 1 still shows the port');
});

test('box: 2 without a {project} template, or with one that is not secure, is not a box (C2.2)', CHROME, async (t) => {
  for (const [why, project] of [['no {project}', (F) => F.at('alpha')], ['not secure', () => 'http://{project}.example.test/']]) {
    await t.test(why, async (tt) => {
      const F = await fixture(tt, { box: (F_) => box2(F_, { project: project(F_) }) });
      const [PA] = await freePorts(1, [F.port]);
      F.list = [hello('alpha', PA)];
      const p = await hubPage(tt, F.hub());
      await p.until('the card', `document.querySelectorAll('.ov-card').length === 1`);
      assert.equal(await p.ev(hasTerminal), false, 'no Terminal tab');
      await p.ev(open('/srv/alpha'));
      await p.until("alpha's frame", `${shown} !== null`);
      assert.equal(await p.ev(shown), `http://127.0.0.1:${PA}/`, 'a laptop address');
    });
  }
});

// a phrase per reason, as the panel says it
const REASON_WORDS = { 'not-a-label': /isn't a host name/, 'all-digits': /all digits/, reserved: /reserved/, shared: /two projects on this box are named/ };
test('box: 2: every label case of the contract; a name with no host shows a panel that says why and how to fix it (C2.3)', CHROME, async (t) => {
  const F = await fixture(t, { box: (F_) => box2(F_) });
  // each listed name, at its highest count across the cases that list it
  const cases = FIX.labelCases.filter((c) => (c.projects ?? [c.name]).includes(c.name));
  const counts = new Map();
  for (const c of cases) counts.set(c.name, Math.max(counts.get(c.name) ?? 0, (c.projects ?? [c.name]).filter((n) => n === c.name).length));
  const names = [...counts].flatMap(([n, k]) => Array(k).fill(n));
  const ports = await freePorts(names.length, [F.port]);
  const roots = names.map((_, i) => `/srv/p${i}`);
  F.list = names.map((n, i) => hello(n, ports[i], { root: roots[i] }));
  const p = await hubPage(t, F.hub());
  await p.until('a card each', `document.querySelectorAll('.ov-card').length === ${names.length}`);
  const covered = new Set();
  for (const c of cases) {
    const reason = c.expect === 'shared' ? 'shared' : c.reason;
    for (const root of roots.filter((_, i) => names[i] === c.name)) {
      await p.ev(open(root));
      const what = `${JSON.stringify(c.name)} (${root})`;
      if (c.expect === 'project') {
        await p.until(`${what}'s frame`, `${shown} !== null`);
        assert.equal(await p.ev(shown), F.at(c.name), `${what} at its host`);
        continue;
      }
      const panel = await p.ev(`(() => { const it = items.get(${JSON.stringify(root)}); const f = it.frame; return { iframe: f instanceof HTMLIFrameElement, page: f?.matches?.('section.page[role=tabpanel]') ?? false, visible: !!f?.checkVisibility?.(), text: f?.textContent ?? '', frames: [...document.querySelectorAll('#frames iframe')].filter((x) => !x.hidden).length }; })()`);
      assert.equal(panel.iframe, false, `${what}: no frame`);
      assert.deepEqual([panel.page, panel.visible, panel.frames], [true, true, 0], `${what}: a visible panel, and no frame shown`);
      assert.match(panel.text, REASON_WORDS[reason], `${what}: says ${reason}`);
      assert.match(panel.text, /settings\.md/, `${what}: says where`);
      assert.match(panel.text, /\bproject\b/, `${what}: says which setting`);
      assert.match(panel.text, /restart its dashboard/, `${what}: says what then`);
      covered.add(reason);
    }
  }
  const reasons = new Set(FIX.labelCases.flatMap((c) => (c.expect === 'shared' ? ['shared'] : c.reason ? [c.reason] : [])));
  assert.deepEqual([...covered].sort(), [...reasons].sort(), 'every reason in the fixture was seen');
  assert.deepEqual(Object.keys(REASON_WORDS).sort(), [...reasons].sort(), 'and has its words here');
  // a project with no host: its card's ⋯ says none and has no new tab; Park answers at once, with no frame
  const www = roots[names.indexOf('www')];
  await p.ev(open('\u0000overview'));
  const m = await p.ev(menuOf('www'));
  assert.deepEqual(m.rows, [['root', www], ['host', 'none']]);
  assert.deepEqual(m.buttons, ['Open its dashboard']);
  await p.ev(`closeMenu()`);
  await p.ev(`items.get(${JSON.stringify(www)}).frame?.remove(); items.get(${JSON.stringify(www)}).frame = null`);
  const started = Date.now();
  const r = await p.ev(`fleetAsk(items.get(${JSON.stringify(www)}), 'park')`);
  assert.ok(Date.now() - started < 2000, 'at once');
  assert.equal(r.ok, false);
  assert.match(r.error, /^www has no address on this box: /);
  assert.equal(await p.ev(`items.get(${JSON.stringify(www)}).frame`), null, 'no frame made to ask');
  assert.equal(F.asks.length, 0, 'no ask reached a stand-in');
});

test('a laptop (no box.json): 127.0.0.1 frames, no Terminal tab, and a moved port moves the frame once (C3.2)', CHROME, async (t) => {
  const [A, A2] = await freePorts(2);
  const F = await fixture(t, { standIns: [A, A2] });
  F.list = [hello('alpha', A)];
  const p = await hubPage(t, F.hub());
  await p.until('the card', `document.querySelectorAll('.ov-card').length === 1`);
  assert.equal(await p.ev(hasTerminal), false, 'no Terminal tab');
  await p.ev(open('/srv/alpha'));
  await p.until("alpha's frame", `${shown} !== null`);
  assert.equal(await p.ev(shown), `http://127.0.0.1:${A}/`);
  await until(() => F.seenFrom(`127.0.0.1:${A}`) > 0, 'the stand-in on its port loaded');
  // alpha's dashboard comes back on another port: the next draw points the frame there, once
  F.list = [hello('alpha', A2)];
  await p.until('the frame on the new port', `${shown} === 'http://127.0.0.1:${A2}/'`);
  await until(() => F.seenFrom(`127.0.0.1:${A2}`) > 0, 'the stand-in on the new port loaded');
  await pause(12000);
  assert.equal(F.seenFrom(`127.0.0.1:${A2}`), 1, 'loaded once, not again on every draw');
  assert.equal(F.loads, 1, 'the hub loaded once');
});

// ----- a frame the hub's own policy refuses (box: 2's HUB_CSP, fixed until the page reloads) -----
const UNKNOWN_PANEL = 'The hub doesn\'t know this project yet: the box hasn\'t caught up with it. Reload this page in a moment.';
const UNKNOWN_ERROR = 'the hub doesn\'t know this project yet; reload this page in a moment';
const REFUSED = `(() => { try { return JSON.parse(sessionStorage.getItem('devteam-hub-refused') ?? 'null'); } catch { return 'unreadable'; } })()`;
// the root's view: an iframe, or a visible panel and its text
const viewOf = (root) => `(() => { const f = items.get(${JSON.stringify(root)})?.frame; return { iframe: f instanceof HTMLIFrameElement, page: f?.matches?.('section.page[role=tabpanel]') ?? false, visible: !!f?.checkVisibility?.(), text: f?.textContent ?? '' }; })()`;
const kBtn = (k) => `[...document.querySelectorAll('#ov-body [data-k]')].find((b) => b.dataset.k === ${JSON.stringify(k)})`;
// a card's Park, confirmed (the press clears the card's last error): the time it was confirmed
async function parkCard(p, root) {
  await p.until('the Park button', `!!${kBtn(`${root}:park`)}`);
  await p.ev(`${kBtn(`${root}:park`)}.click()`);
  await p.until('the confirm, no error', `${kBtn(`${root}:park`)}?.textContent === 'Confirm park' && !${kBtn(`${root}:park`)}.closest('.fleet-switch').querySelector('.err')`);
  await p.ev(`${kBtn(`${root}:park`)}.click()`);
  return Date.now();
}
const cardError = (name) => `(${cardOf(name)}?.querySelector('.fleet-switch .err')?.textContent ?? null)`;

test('box: 2: the selected tab\'s frame refused reloads the hub once, hash kept, then says the hub doesn\'t know it yet; a frame that loads drops its origin; an already refused one\'s Park answers at once (C2.4, C2.5, C2.6b)', CHROME, async (t) => {
  // the hub's loads after the first wait 1 s: the page that reloads stays up past its refused frame's load
  const F = await fixture(t, { box: (F_) => box2(F_), csp: true, hold: 1000 });
  const [PA, PB] = await freePorts(2, [F.port]);
  const beta = F.at('beta-app').replace(/\/$/, '');
  F.allowed = [F.at('alpha').replace(/\/$/, '')];
  F.list = [hello('alpha', PA), hello('beta-app', PB)];
  // C2.4
  const p = await hubPage(t, F.hub('#beta-app'));
  await until(() => F.loads >= 2, 'the hub reloaded');
  await p.until('the "doesn\'t know yet" panel', `(() => { const v = ${viewOf('/srv/beta-app')}; return v.page && v.visible; })()`);
  const v = await p.ev(viewOf('/srv/beta-app'));
  assert.equal(v.iframe, false, 'no frame');
  assert.match(v.text, /doesn't know this project yet/);
  assert.match(v.text, /reload this page in a moment/i);
  assert.ok(v.text.includes(UNKNOWN_PANEL), `the panel's words: ${v.text}`);
  assert.equal(await p.ev('location.hash'), '#beta-app', 'the hash kept');
  assert.equal(F.loads, 2, 'reloaded once');
  assert.deepEqual(await p.ev(REFUSED), [beta], 'the origin kept for the reload');
  await pause(12000);
  assert.equal(F.loads, 2, 'and not again, past a draw');
  assert.deepEqual(await p.ev(REFUSED), [beta], 'the origin still kept while refused');
  assert.equal(await p.ev(viewOf('/srv/beta-app') + '.page'), true, 'still the panel');
  // C2.5: the box catches up; the frame loads and its origin is dropped
  F.allowed = [F.at('alpha'), F.at('beta-app')].map((u) => u.replace(/\/$/, ''));
  const seen = F.seenFrom(`beta-app.localhost:${F.port}`);
  await p.ev('location.reload()').catch(() => {});
  await until(() => F.loads === 3, 'the test\'s reload');
  await until(() => F.seenFrom(`beta-app.localhost:${F.port}`) > seen, 'beta-app\'s frame loaded from its host');
  await p.until('the origin dropped', `(() => { const r = ${REFUSED}; return Array.isArray(r) && !r.includes(${JSON.stringify(beta)}); })()`);
  // refused again: exactly one more automatic reload
  F.allowed = [F.at('alpha').replace(/\/$/, '')];
  await p.ev('location.reload()').catch(() => {});
  await until(() => F.loads >= 5, 'the hub reloaded once more');
  await p.until('the panel again', `(() => { const v = ${viewOf('/srv/beta-app')}; return v.page && v.visible; })()`);
  await pause(3000);
  assert.equal(F.loads, 5, 'the test\'s reload and the hub\'s one');
  // C2.6b: from the panel, the Overview, then beta-app's Park: the error at once, no frame, no reload
  await p.ev(open('\u0000overview'));
  await p.until('the cards', `!document.getElementById('overview').hidden && ${cardOf('beta-app')} !== undefined`);
  const at = await parkCard(p, '/srv/beta-app');
  await p.until('the error', `${cardError('beta-app')} === ${JSON.stringify(UNKNOWN_ERROR)}`);
  assert.ok(Date.now() - at < 3000, `within 3 s (${Date.now() - at} ms)`);
  assert.equal(await p.ev(`document.querySelector('#frames iframe[title="beta-app"]')`), null, 'no frame made to ask');
  assert.equal(F.loads, 5, 'no reload');
  assert.equal(F.asks.length, 0, 'no ask reached a stand-in');
});

test('box: 2: a hidden frame refused (the Overview\'s Park) shows the card\'s error and never reloads (C2.6)', CHROME, async (t) => {
  const F = await fixture(t, { box: (F_) => box2(F_), csp: true });
  const [PA, PB] = await freePorts(2, [F.port]);
  F.allowed = [F.at('alpha').replace(/\/$/, '')];
  F.list = [hello('alpha', PA), hello('beta-app', PB)];
  const p = await hubPage(t, F.hub());
  await p.until('the cards', `document.querySelectorAll('.ov-card').length === 2`);
  const at = await parkCard(p, '/srv/beta-app');
  await p.until('the error', `${cardError('beta-app')} === ${JSON.stringify(UNKNOWN_ERROR)}`);
  assert.ok(Date.now() - at < 5000, `at once, not after 20 s (${Date.now() - at} ms)`);
  await pause(3000);
  assert.equal(F.loads, 1, 'no reload');
  assert.equal(await p.ev('location.hash'), '#overview');
  assert.deepEqual(await p.ev(`${REFUSED} ?? []`), [], 'nothing kept for a reload');
  assert.equal(F.asks.length, 0, 'no ask reached the stand-in');
  assert.equal(await p.ev(`items.get('/srv/beta-app').frame`), null, 'the frame made to ask is gone');
  // refused again on a later Park: the error again
  await parkCard(p, '/srv/beta-app');
  await p.until('the error again', `${cardError('beta-app')} === ${JSON.stringify(UNKNOWN_ERROR)}`);
  assert.equal(F.loads, 1, 'still no reload');
});
