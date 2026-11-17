// The dashboard's frame (kit-87, spec §1-4 and §6): a grouped side nav, a page bar with the Inbox
// button, one page shown at a time, and the router's history. Headless Chrome against a real
// dashboard on a project of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { PORTS, bareProject, dashboardOnFreePort, until } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const NAV = [['Project', ['Overview', 'Inbox', 'Goals', 'Progress', 'Board', 'Library']], ['Autonomy', ['Trust', 'Efficiency', 'Sensors', 'Health', 'Retros', 'Self Improvement']]];
const SKIP = canDrive ? false : 'needs Chrome and a Node with WebSocket';

// One project, its dashboard and a Chrome tab on it. With records, the project has what the
// supervisor would make (kit CLI): a goal being defined with an open goal-definition question (its
// link is on Goals), a ticket (a card on Progress), an open question and an answered one on that
// ticket (links in its peek), and an open review question whose page is committed on main.
// Gives the tab (p), the port, the ids, and helpers: dt (the kit CLI; role null is the owner), load
// (a fresh visit), shown, onPage, size.
// True once an element's box reads the same twice running (until polls 100 ms apart): the page slides back over --dur
// after the panel closes, and a click at a box read a moment before lands beside the button.
const STEADY = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(), k = [r.left, r.top, r.width, r.height].join(); const was = (window.__steady ||= {})[${JSON.stringify(sel)}]; window.__steady[${JSON.stringify(sel)}] = k; return was === k; })()`;
async function pagesFixture(t, name, { records = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `devteam-dash-${name}-`));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 2), DEVTEAM_PORT_BASE: String(PORTS + 3), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  // DEVTEAM_BOX stays (lib/kit.mjs sets it off): the kit under test sees no box, as on a CI runner, even
  // on a machine that is one (its owner saves would otherwise need the box's gateway)
  for (const k of Object.keys(env)) if (k.startsWith('DEVTEAM_') && !['DEVTEAM_HUB_PORT', 'DEVTEAM_PORT_BASE', 'DEVTEAM_BOX'].includes(k)) delete env[k];
  for (const k of ['TMUX', 'TMUX_PANE']) delete env[k];
  const root = bareProject(base, name);
  const ids = {};
  // the supervisor's commands, and the owner's (no role)
  const dt = (args, role = 'supervisor') => {
    const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: root, env: role ? { ...env, DEVTEAM_ROLE: role } : env, encoding: 'utf8' });
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  if (records) {
    const rate = ['--stake', '1', '--urgency', '1'];
    fs.mkdirSync(path.join(root, 'review'));
    fs.writeFileSync(path.join(root, 'review/page.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Check it</title></head>\n<body>\n<p>Look.</p>\n</body></html>\n');
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'add', '-A'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'the project'], { cwd: root });
    ids.ticket = 'ch-01-small';
    dt(['ticket', 'add', ids.ticket, '--json', JSON.stringify({ title: 'small', feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['small/**'], done_when: ['the small check passes'], notes: 'turns on small' })]);
    ids.goal = dt(['goal', 'add', '--title', 'Launch checkout', '--outcome', 'admins pay alone']);
    ids.goalQ = dt(['ask', '--kind', 'goal-definition', '--goal', ids.goal, '--question', 'What is the measure?', ...rate]);
    ids.open = dt(['ask', '--question', 'Which way?', '--ticket', ids.ticket, '--choices', '[{"label":"Left"},{"label":"Right"}]', ...rate]);
    ids.answered = dt(['ask', '--question', 'Ship it?', '--ticket', ids.ticket, '--choices', '[{"label":"Yes"},{"label":"No"}]', ...rate]);
    dt(['answer', ids.answered, 'Yes'], null);
    ids.review = dt(['ask', '--kind', 'review', '--question', 'Does it look right?', '--ref', 'main', '--page', 'review/page.html', ...rate]);
  }
  const { dash, port } = await dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  // no classic scrollbar: innerWidth is the window's right edge
  await p.send('Emulation.setScrollbarsHidden', { hidden: true });
  const size = (width, height) => p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const url = (hash) => `http://127.0.0.1:${port}/${hash}`;
  // p.ev while a navigation may be under way: an evaluate that lands as the old document goes (or before
  // the new one has a context) is "not yet", not a failure
  const evNav = (expr) => p.ev(expr).catch((e) => { if (/navigated or closed|Cannot find context|context was destroyed|Execution context/i.test(e.message)) return false; throw e; });
  const drawn = () => until(() => evNav("location.protocol === 'http:' && !!document.querySelector('main') && !document.querySelector('main.waiting')"), 'the dashboard drawn');
  // a fresh visit: a new document, so its first route is a cold one
  const load = async (hash) => {
    await p.send('Page.navigate', { url: 'about:blank' });
    await until(() => evNav("location.href === 'about:blank'"), 'about:blank');
    await p.send('Page.navigate', { url: url(hash) });
    await drawn();
  };
  // a reload: the old document marked, then a new one (without the mark) drawn
  const reload = async () => {
    await p.ev('window.__unloaded = false');
    await p.send('Page.reload');
    await until(() => evNav('window.__unloaded === undefined'), 'the reload');
    await drawn();
  };
  const shown = () => p.ev("[...document.querySelectorAll('main > section[data-page]')].filter((s) => getComputedStyle(s).display !== 'none').map((s) => s.dataset.page)");
  const onPage = (id) => until(async () => JSON.stringify(await shown()) === JSON.stringify([id]) && await p.ev(`location.hash === ${JSON.stringify(`#${id}`)}`), `page ${id} alone`);
  return { p, port, root, ids, dt, size, url, drawn, load, reload, shown, onPage };
}

test('pages and nav', { skip: SKIP, timeout: 600000 }, async (t) => {
  const { p, size, load, shown, onPage } = await pagesFixture(t, 'pages', { records: false });

  await size(1440, 900);
  await load('#overview');

  // the nav, by group
  const nav = await p.ev("[...document.querySelectorAll('.side nav.nav[data-group]')].map((n) => [n.previousElementSibling?.textContent.trim(), [...n.querySelectorAll('a')].map((a) => a.querySelector('.nl').textContent.trim())])");
  assert.deepEqual(nav, NAV);
  const links = await p.ev("[...document.querySelectorAll('.side nav.nav[data-group] a')].map((a) => ({ href: a.getAttribute('href'), label: a.querySelector('.nl').textContent.trim() }))");

  // each link: only its page, the title, aria-current
  for (const { href, label } of links) {
    await p.click(`.side nav.nav a[href="${href}"]`);
    const id = href.slice(1);
    await onPage(id);
    assert.equal(await p.ev("document.querySelector('#page-title').textContent.trim()"), label, `${href}: the page bar's title`);
    assert.deepEqual(await p.ev("[...document.querySelectorAll('.side nav.nav a[aria-current=\"page\"]')].map((a) => a.getAttribute('href'))"), [href], `${href}: aria-current`);
  }
  // Back: the previous page
  const prev = links.at(-2).href.slice(1);
  await p.ev('history.back()');
  await onPage(prev);

  // changing page scrolls to the top
  await p.click('.side nav.nav a[href="#board"]');
  await onPage('board');
  // both pages taller than the window, so only showPage can bring Library to the top
  await p.ev("document.querySelector('#board').style.minHeight = '4000px'; document.querySelector('#library').style.minHeight = '4000px'");
  await p.ev('window.scrollTo(0, 1500)');
  await until(() => p.ev('scrollY > 0'), 'Board scrolled down');
  await p.click('.side nav.nav a[href="#library"]');
  await onPage('library');
  assert.equal(await p.ev('scrollY'), 0, 'Library opens at the top');
  await p.ev("document.querySelector('#board').style.minHeight = ''; document.querySelector('#library').style.minHeight = ''");

  // the Inbox button's count is the nav's
  assert.equal(await p.ev("document.querySelector('#inbox-btn-n').textContent"), await p.ev("document.querySelector('#n-questions').textContent"));

  // a cold load of an unknown head: Overview, in the address bar too
  await load('#nonsense');
  await until(() => p.ev("location.hash === '#overview'"), '#overview in the address bar');
  assert.deepEqual(await shown(), ['overview']);

  // the page bar and its Inbox button at two sizes, on every page
  const pages = [...links.map((l) => l.href.slice(1)), 'settings'];
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    await size(w, h);
    for (const id of pages) {
      await p.ev(`location.hash = ${JSON.stringify(`#${id}`)}`);
      await onPage(id);
      await p.ev('window.scrollTo(0, 0)');
      const m = await p.ev(`(() => {
        const cs = getComputedStyle(document.documentElement);
        const bar = document.querySelector('.pagebar').getBoundingClientRect(), b = document.querySelector('#inbox-btn').getBoundingClientRect();
        return { pageMax: parseFloat(cs.getPropertyValue('--page-max')), headerPad: parseFloat(cs.getPropertyValue('--header-pad')), barW: bar.width, barTop: bar.top, barBottom: bar.bottom, right: innerWidth - b.right, bTop: b.top };
      })()`);
      const at = `#${id} at ${w}x${h}`;
      if (w === 1440) assert.ok(m.barW > m.pageMax, `${at}: the page bar (${m.barW}px) is wider than --page-max (${m.pageMax}px)`);
      assert.ok(Math.abs(m.right - m.headerPad) <= 0.5, `${at}: the Inbox button ends ${m.right}px from the window's right, not --header-pad ${m.headerPad}px`);
      assert.equal(m.barTop, 0, `${at}: the page bar starts at the window's top`);
      assert.ok(m.bTop >= m.barTop && m.bTop < m.barBottom, `${at}: the Inbox button's top (${m.bTop}) is inside the page bar (${m.barTop}-${m.barBottom})`);
    }
    await p.ev("location.hash = '#overview'");
    await onPage('overview');
    // the Inbox button opens the Threads panel over the page (kit-89); the Inbox page is the nav's
    await p.click('#inbox-btn');
    await until(() => p.ev("location.hash === '#overview?th=open' && document.body.classList.contains('threads-open') && getComputedStyle(document.getElementById('threads')).transform === 'none'"), 'the Threads panel over Overview, at rest');
    assert.deepEqual(await shown(), ['overview'], 'Overview still shown under the panel');
    await p.click('#th-close');
    await until(() => p.ev("!document.body.classList.contains('threads-open') && getComputedStyle(document.querySelector('.main')).marginRight === '0px'"), 'the panel closed, the page at rest');
  }
});

// The router's history (spec §4, done-whens 1d and 2a-2e, the Edge cases): every entry stamped
// { page, depth, openedHere }, a peek over the page it was clicked on, closing by closeTarget.
test('history', { skip: SKIP, timeout: 600000 }, async (t) => {
  const { p, ids, load, reload, shown, onPage } = await pagesFixture(t, 'history');
  const T = ids.ticket;
  const state = async () => JSON.parse(await p.ev('JSON.stringify(history.state)'));
  const len = () => p.ev('history.length');
  const go = (hash) => p.ev(`location.hash = ${JSON.stringify(hash)}`);
  const back = () => p.ev('history.back()');
  const forward = () => p.ev('history.forward()');
  const peekOpen = () => p.ev("document.querySelector('#drawer')?.hidden === false");
  const title = () => p.ev("document.querySelector('#page-title').textContent.trim()");
  // a peek open at this hash, over this page alone, with its title in the page bar
  // (and routed: the entry stamped, as the hash changes before its hashchange is handled)
  // the peek slid in (kit-88): its slide over, so a click on its × lands on it
  const slidIn = () => p.ev("(() => { const d = document.querySelector('#drawer'); return getComputedStyle(d).transform === 'none' && !d.getAnimations().some((a) => a.transitionProperty === 'transform'); })()");
  const peekOver = (hash, page, what) => until(async () => await peekOpen() && await slidIn() && await p.ev(`location.hash === ${JSON.stringify(hash)} && typeof history.state?.page === 'string'`) && JSON.stringify(await shown()) === JSON.stringify([page]), what);
  const closed = (page) => until(async () => !(await peekOpen()) && JSON.stringify(await shown()) === JSON.stringify([page]) && await p.ev(`location.hash === ${JSON.stringify(`#${page}`)}`), `no peek, ${page} alone`);
  // a click on what a selector finds, once it is drawn (a peek's body loads after it opens)
  const clickWhen = async (sel) => { await until(() => p.ev(`!!document.querySelector(${JSON.stringify(sel)})`), sel); await p.click(sel); };
  // a link on the page shown, clicked (a link the page draws, or one put on it for the head under test)
  const linkOn = async (page, href) => {
    await p.ev(`(() => { const a = document.createElement('a'); a.id = 't-link'; a.href = ${JSON.stringify(href)}; a.textContent = 'a link'; document.querySelector('#t-link')?.remove(); document.querySelector(${JSON.stringify(`#${page}`)}).prepend(a); })()`);
    await p.click('#t-link');
  };

  // 1d: redirects by replaceState, read from the page's own table
  await load('#overview');
  const redirects = JSON.parse(await p.ev('JSON.stringify(SHELL_ROUTES.redirects)'));
  const mon = Object.keys(redirects).find((k) => k === 'monitoring');
  assert.equal(redirects[mon], 'sensors', 'the table sends monitoring to sensors');
  assert.equal(redirects['overview?th=inbox'], 'inbox', 'the table sends overview?th=inbox to inbox');
  assert.equal(redirects['board?th=inbox'], 'inbox', 'the table has the board?th=inbox entry');
  for (const [head, page] of [[`#${mon}`, redirects[mon]], ['#overview?th=inbox', redirects['overview?th=inbox']], ['#board?goal=g&th=inbox', redirects['board?th=inbox']]]) {
    // Overview the newest entry (none ahead of it), so the click's one entry shows in history.length
    await go('#goals');
    await onPage('goals');
    await go('#overview');
    await onPage('overview');
    const n = await len();
    await linkOn('overview', head);
    await onPage(page);
    assert.equal(await len(), n + 1, `${head} from Overview adds exactly one entry`);
    assert.equal((await state()).page, `#${page}`, `${head}: its entry is stamped as ${page}`);
    await back();
    await onPage('overview');
  }

  // 2a: a ticket link clicked on Progress (which draws no ticket link of its own here) opens over
  // Progress; × returns to Progress
  await go('#progress');
  await onPage('progress');
  await linkOn('progress', `#ticket/${T}`);
  await peekOver(`#ticket/${T}`, 'progress', 'the ticket over Progress');
  assert.equal(await title(), 'Progress', 'the page bar still says Progress');
  assert.deepEqual(await state(), { page: '#progress', depth: 1, openedHere: true });
  await p.click('#drawer-close');
  await closed('progress');

  // Forward into the peek entry: it reopens over Progress; Back: Progress again
  await forward();
  await peekOver(`#ticket/${T}`, 'progress', 'Forward reopens the ticket over Progress');
  // another page, then Back into the peek entry: over its recorded page
  await go('#board');
  await closed('board');
  await back();
  await peekOver(`#ticket/${T}`, 'progress', 'Back into the peek entry reopens it over Progress');
  await forward();
  await closed('board');
  await back();
  await peekOver(`#ticket/${T}`, 'progress', 'Back again: over Progress');

  // the ticket's peek from Board's own card (its opener, not a link put there): over Board, × back to Board
  await go('#board');
  await onPage('board');
  await clickWhen(`#board [data-ticket="${T}"]`);
  await peekOver(`#ticket/${T}`, 'board', "Board's card opens the ticket over Board");
  assert.deepEqual(await state(), { page: '#board', depth: 1, openedHere: true });
  await p.click('#drawer-close');
  await closed('board');
  await back();
  await peekOver(`#ticket/${T}`, 'progress', 'and Back to the peek over Progress');

  // 2c: a reload keeps the stamp: the peek reopens over Progress, and × still goes back to it
  await reload();
  await peekOver(`#ticket/${T}`, 'progress', 'reloaded: the ticket over Progress');
  const n2c = await len();
  await p.click('#drawer-close');
  await closed('progress');
  assert.equal(await len(), n2c, 'closing by Back adds no entry');

  // 2g: a peek link inside the peek: depth 2; Back is the first peek, Forward the second, × the page under both
  await linkOn('progress', `#ticket/${T}`);
  await peekOver(`#ticket/${T}`, 'progress', 'the ticket over Progress');
  await clickWhen('#drawer a[href="#wave/1"]');
  await peekOver('#wave/1', 'progress', 'the wave over Progress');
  assert.deepEqual(await state(), { page: '#progress', depth: 2, openedHere: true });
  await back();
  await peekOver(`#ticket/${T}`, 'progress', 'Back from the second peek: the first');
  assert.equal((await state()).depth, 1);
  await forward();
  await peekOver('#wave/1', 'progress', 'Forward: the second peek');
  assert.equal((await state()).depth, 2);
  await p.click('#drawer-close');
  await closed('progress');

  // 2b: a cold load of a ticket opens over Board; × lands on #board in place
  await load(`#ticket/${T}`);
  await peekOver(`#ticket/${T}`, 'board', 'cold: the ticket over Board');
  assert.equal(await title(), 'Board');
  assert.deepEqual(await state(), { page: '#board', depth: 1, openedHere: false });
  let n = await len();
  await p.click('#drawer-close');
  await closed('board');
  assert.equal(await len(), n, 'closed in place: no entry added');

  // a peek opened inside a cold-loaded peek closes in place, never through history outside the visit
  await load(`#ticket/${T}`);
  await peekOver(`#ticket/${T}`, 'board', 'cold: the ticket over Board');
  await clickWhen('#drawer a[href="#wave/1"]');
  await peekOver('#wave/1', 'board', 'the wave over Board');
  assert.deepEqual(await state(), { page: '#board', depth: 2, openedHere: false });
  n = await len();
  await p.click('#drawer-close');
  await closed('board');
  assert.equal(await len(), n, 'closed in place: history.length unchanged');

  // 2d: the Loop's tabs are entries (lt); a fresh #loop opens on Observe
  const tab = () => p.ev("document.querySelector('#loop-tabs [aria-selected=\"true\"]')?.dataset.tab");
  await go('#loop');
  await onPage('loop');
  assert.equal(await tab(), 'observe');
  await p.click('#loop-tabs [data-tab="orient"]');
  await until(async () => await p.ev("location.hash === '#loop?lt=orient'") && await tab() === 'orient', 'Orient, in the URL');
  await back();
  await until(async () => await p.ev("location.hash === '#loop'") && await tab() === 'observe', 'Back: Observe');
  await forward();
  await until(async () => await tab() === 'orient', 'Forward: Orient');
  await go('#overview');
  await onPage('overview');
  await go('#loop');
  await onPage('loop');
  assert.equal(await tab(), 'observe', 'a fresh #loop opens on Observe: the tab is not remembered');

  // 2e: an open question's link on Goals: the Inbox with its card in view; Back returns to Goals
  await go('#goals');
  await onPage('goals');
  n = await len();
  await p.click(`#goals a[href="#q/${ids.goalQ}"]`);
  await onPage('inbox');
  await until(() => p.ev(`(() => { const r = document.getElementById(${JSON.stringify(`q-${ids.goalQ}`)})?.getBoundingClientRect(); return !!r && r.height > 0 && r.top < innerHeight && r.bottom > 0; })()`), 'its card in view');
  assert.equal(await len(), n + 1, 'the q/ entry is replaced by #inbox');
  assert.equal(await peekOpen(), false);
  await back();
  await onPage('goals');

  // a review: over the Inbox it was opened on, × goes Back; cold, it closes to #inbox
  const reviewing = (page) => until(async () => await p.ev("!document.querySelector('#review-view').hidden && document.querySelector('main').classList.contains('reviewing')") && JSON.stringify(await shown()) === JSON.stringify([page]), `the review over ${page}`);
  await go('#inbox');
  await onPage('inbox');
  await p.click(`[data-open-review="${ids.review}"]`);
  await reviewing('inbox');
  assert.equal(await p.ev('location.hash'), `#review/${ids.review}`);
  await until(() => p.ev("!!document.querySelector('#review-view [data-rv-close]')"), 'the review\'s close button');
  const nRv = await len();
  await p.click('#review-view [data-rv-close]');
  await onPage('inbox');
  assert.equal(await p.ev("document.querySelector('#review-view').hidden"), true);
  assert.equal(await len(), nRv, '× closes the review by Back: no entry added');
  await load(`#review/${ids.review}`);
  await until(() => p.ev("!document.querySelector('#review-view').hidden"), 'cold: the review');
  await until(() => p.ev("!!document.querySelector('#review-view [data-rv-close]')"), 'the review\'s close button');
  await p.click('#review-view [data-rv-close]');
  await onPage('inbox');

  // the viewer, each case in a visit of its own (see the note below): opened on Overview, closed
  // back to it; cold, over Library and closed to #library
  // Note: the viewer's frame is navigated again on a second open in one visit, which adds a frame
  // entry to the joint history, so a close by Back (today's leaveArtifact) steps the frame back
  // instead; that is today's viewer code, not the router's, and is left to its own ticket.
  await load('#overview');
  await linkOn('overview', '#artifact/main/no-such');
  await until(async () => await p.ev("!document.querySelector('#artifact-view').hidden") && JSON.stringify(await shown()) === '["overview"]', 'the viewer over Overview');
  assert.deepEqual(await state(), { page: '#overview', depth: 1, openedHere: true });
  await p.click('#av-close');
  await onPage('overview');
  assert.equal(await p.ev("document.querySelector('#artifact-view').hidden"), true);
  await load('#artifact/main/no-such');
  await until(async () => await p.ev("!document.querySelector('#artifact-view').hidden") && JSON.stringify(await shown()) === '["library"]', 'cold: the viewer over Library');
  await p.click('#av-close');
  await onPage('library');
});

// The thread layer on pages (spec §5, done-when 2f, the Edge cases): a thread's subject has a page
// head; a #talk/ link opens its card over that page (its entry's stamp changed in place, no entry
// added), closing follows closeTarget; the Threads panel's row goes to the page; a pin keeps it; pins are
// drawn for the page shown.
test('threads on pages', { skip: SKIP, timeout: 600000 }, async (t) => {
  const { p, ids, dt, size, load, reload, shown, onPage } = await pagesFixture(t, 'threads');
  const T = ids.ticket;
  // started through the owner channel (no role), as test/dashboard.test.mjs starts them
  const thread = (text, subject) => dt(['thread', 'new', text, '--subject', JSON.stringify(subject)], null).split('\n')[0];
  const TT = thread('About the small ticket', { kind: 'item', ref: `ticket:${T}` });
  const TO = thread('On Orient', { kind: 'page', view: '#loop/orient', at: { x: 0.5, y: 0.1 } });
  const TM = thread('On the sensors', { kind: 'page', view: '#monitoring', at: { x: 0.5, y: 0.1 } });
  const TG = thread('On a ticket gone', { kind: 'item', ref: 'ticket:no-such-ticket' });
  const TB = thread('On the Board', { kind: 'page', view: '#board', at: { x: 0.5, y: 0.9 } });
  const state = async () => JSON.parse(await p.ev('JSON.stringify(history.state)'));
  const len = () => p.ev('history.length');
  const go = (hash) => p.ev(`location.hash = ${JSON.stringify(hash)}`);
  const back = () => p.ev('history.back()');
  const hash = () => p.ev('location.hash');
  const cardOn = (id) => p.ev(`!document.getElementById('tl-card').hidden && document.getElementById('tl-card').dataset.key === ${JSON.stringify(id)}`);
  const cardShut = () => p.ev(`document.getElementById('tl-card').hidden`);
  const loaded = () => until(() => p.ev(`[${JSON.stringify([TT, TO, TM, TG, TB])}].flat().every((id) => TL.threads.some((x) => x.id === id))`), 'the threads read in');
  // the card open at #talk/<id>, over this page alone (and routed: the entry stamped with that page)
  const cardOver = (id, page, what) => until(async () => await cardOn(id) && await p.ev(`location.hash === ${JSON.stringify(`#talk/${id}`)} && history.state?.page?.split('?')[0] === ${JSON.stringify(`#${page}`)}`) && JSON.stringify(await shown()) === JSON.stringify([page]), what);
  const shut = (page, what) => until(async () => await cardShut() && await hash() === `#${page}` && JSON.stringify(await shown()) === JSON.stringify([page]), what);
  const linkOn = async (page, href) => {
    await p.ev(`(() => { const a = document.createElement('a'); a.id = 't-link'; a.href = ${JSON.stringify(href)}; a.textContent = 'a link'; document.querySelector('#t-link')?.remove(); document.querySelector(${JSON.stringify(`#${page}`)}).prepend(a); })()`);
    await p.click('#t-link');
  };
  const tcard = `#board [data-subject="ticket:${T}"]`;
  // the card's box within 400px of the ticket card's
  const gap = () => p.ev(`(() => { const a = document.getElementById('tl-card').getBoundingClientRect(), b = document.querySelector(${JSON.stringify(tcard)}).getBoundingClientRect(); return Math.hypot(Math.max(0, a.left - b.right, b.left - a.right), Math.max(0, a.top - b.bottom, b.top - a.bottom)); })()`);
  const pinned = (id) => p.ev(`[...document.querySelectorAll('#tl-pins .tl-pin')].some((b) => b.dataset.tlPin === ${JSON.stringify(id)})`);

  await size(1440, 900);

  // 2f: a talk/ link on Goals: one entry, over Board, the card beside the ticket
  await load('#goals');
  await loaded();
  let n = await len();
  await linkOn('goals', `#talk/${TT}`);
  await cardOver(TT, 'board', 'the card over Board');
  assert.equal(await len(), n + 1, 'the talk/ link adds one entry');
  // since kit-89 (spec §2.5) the subject's page head carries the card's thread (t)
  assert.deepEqual(await state(), { page: `#board?t=${TT}`, depth: 1, openedHere: true }, "its stamp's page is the subject's");
  await until(async () => await gap() <= 400, 'the card beside the ticket');
  // a reload reopens it over Board
  await reload();
  await cardOver(TT, 'board', 'reloaded: the card over Board');
  // × goes Back to Goals (closeTarget)
  n = await len();
  await p.click('[data-tl-close]');
  await shut('goals', '× back to Goals');
  assert.equal(await len(), n, 'closed by Back: no entry added');
  // Back from a fresh open: Goals, and the card closed (spec-3 F3-2)
  await linkOn('goals', `#talk/${TT}`);
  await cardOver(TT, 'board', 'the card over Board again');
  await back();
  await shut('goals', 'Back: Goals, the card closed');

  // cold: over Board, × in place to #board
  await load(`#talk/${TT}`);
  await cardOver(TT, 'board', 'cold: the card over Board');
  assert.deepEqual(await state(), { page: `#board?t=${TT}`, depth: 1, openedHere: false });
  n = await len();
  await p.click('[data-tl-close]');
  await shut('board', 'cold ×: #board');
  assert.equal(await len(), n, 'closed in place');

  // page subjects, through the router's redirects: #loop/orient is the Loop on Orient, #monitoring is Sensors
  await go('#overview');
  await onPage('overview');
  await linkOn('overview', `#talk/${TO}`);
  await cardOver(TO, 'loop', 'the Orient thread over the Loop');
  assert.equal((await state()).page, `#loop?lt=orient&t=${TO}`);
  assert.equal(await p.ev("document.querySelector('#loop-tabs [aria-selected=\"true\"]')?.dataset.tab"), 'orient', 'on Orient');
  await p.click('[data-tl-close]');
  await shut('overview', '× back to Overview');
  await linkOn('overview', `#talk/${TM}`);
  await cardOver(TM, 'sensors', 'the Sensors thread over Sensors');
  assert.equal((await state()).page, `#sensors?t=${TM}`);
  await p.click('[data-tl-close]');
  await shut('overview', '× back to Overview');
  // a subject not drawn: since kit-89 (spec §2.4, §2.5) an in-panel thread, so the link opens the Threads panel
  // on it over the page it was clicked on, the recorded page head given th and t
  await linkOn('overview', `#talk/${TG}`);
  await until(async () => await cardOn(TG) && await p.ev(`location.hash === ${JSON.stringify(`#talk/${TG}`)} && history.state?.page === ${JSON.stringify(`#overview?th=open&t=${TG}`)} && !!document.querySelector('#th-card-slot > #tl-card.in-panel')`) && JSON.stringify(await shown()) === '["overview"]', 'a thread on a ticket not drawn, in the panel over Overview');
  // closed by the panel's × (kit-89 T3: a nav to a head without keys would carry the remembered panel)
  await until(() => p.ev("getComputedStyle(document.getElementById('threads')).transform === 'none'"), 'the panel at rest');
  await p.click('#th-close');
  await until(async () => await cardShut() && await hash() === '#overview' && !(await p.ev("document.body.classList.contains('threads-open')")), 'the panel and the card closed, on Overview');

  // the Threads panel's list on Overview: the row is one entry to Board's head with the thread (t) and the panel kept (th)
  // (Overview made the newest entry, none ahead of it, so the one entry shows in history.length)
  await go('#goals');
  await onPage('goals');
  await go('#overview');
  await onPage('overview');
  await until(() => p.ev(`!document.body.classList.contains('threads-open') && ${STEADY('#inbox-btn')}`), 'the Inbox button at rest, the panel closed');
  await p.click('#inbox-btn');
  await until(() => p.ev(`document.body.classList.contains('threads-open') && getComputedStyle(document.getElementById('threads')).transform === 'none' && !!document.querySelector('#tl-list [data-tl-open="${TT}"]')`), 'the Threads panel, at rest, lists it');
  n = await len();
  await p.click(`#tl-list [data-tl-open="${TT}"]`);
  // since kit-89 (spec §2.4, §2.5) the row's entry is Board's head with the thread (t) and, above 900px, the
  // panel kept open (th); its × takes t away, a new entry, the panel staying on the list
  await until(async () => await cardOn(TT) && await hash() === `#board?th=open&t=${TT}` && JSON.stringify(await shown()) === '["board"]', 'the panel row opens it over Board');
  assert.equal(await len(), n + 1, 'the row adds one entry');
  await until(async () => await gap() <= 400, 'the card beside the ticket');
  n = await len();
  await p.click('[data-tl-close]');
  await until(() => cardShut(), 'closed');
  assert.equal(await hash(), '#board?th=open', 'closed on Board, t gone');
  assert.equal(await len(), n + 1, 'one entry: t taken away');
  // closed by its × (kit-89 T3: a nav to a head without keys would carry the remembered panel)
  await p.click('#th-close');
  await until(async () => await hash() === '#board' && !(await p.ev("document.body.classList.contains('threads-open')")) && await p.ev("getComputedStyle(document.querySelector('.main')).marginRight === '0px'"), 'the panel closed, Board at rest');

  // pins: the ticket thread's on Board; a pin keeps the page and opens the card; none on Overview
  await until(() => pinned(TT), "the ticket thread's pin on Board");
  n = await len();
  await p.click(`#tl-pins [data-tl-pin="${TT}"]`);
  await until(() => cardOn(TT), 'the pin opens the card');
  assert.equal(await hash(), '#board', 'the pin keeps the page');
  assert.equal(await len(), n, 'and adds no entry');
  await p.click('[data-tl-close]');
  await until(() => cardShut(), 'closed');

  // a card opened from outside a route closes in place, even over a #talk/ entry (review T4-1): with
  // #talk/<TT> open over Board, B's pin opens B's card; its × moves no history and leaves the hash
  await go(`#talk/${TT}`);
  await cardOver(TT, 'board', 'the ticket thread over Board');
  await until(() => pinned(TB), "the Board thread's pin");
  n = await len();
  // clicked on the pin itself (the open card may lie over it)
  await p.ev(`document.querySelector('#tl-pins [data-tl-pin="${TB}"]').click()`);
  await until(() => cardOn(TB), "B's card, from its pin");
  await p.click('[data-tl-close]');
  await until(() => cardShut(), "B's card closed");
  assert.equal(await hash(), `#talk/${TT}`, 'the hash unchanged');
  assert.equal(await len(), n, 'history.length unchanged');
  assert.deepEqual(await shown(), ['board'], 'still on Board');

  await go('#overview');
  await onPage('overview');
  assert.equal(await pinned(TT), false, 'no pin for it on Overview, redrawn on the page change');
});

// The settings area (spec §7, §9): the shared fleet switch, its state line, the Settings link and the
// updated time; each press posts once through the switch's binder; Park asks in place; the switch keeps
// its confirm, busy line and error across redraws; the Overview fleet strip and Check are gone.
test('settings area', { skip: SKIP, timeout: 600000 }, async (t) => {
  const { p, size, load } = await pagesFixture(t, 'settings', { records: false });
  await size(1440, 900);
  await load('#overview');
  // every POST /api/fleet body, in window.__posts; __stub 'fail' answers 500, 'hang' holds the request
  // until __release() (which then answers 500)
  await p.ev(`(() => {
    window.__posts = []; window.__stub = null;
    const real = window.fetch;
    const nope = () => new Response(JSON.stringify({ error: 'nope' }), { status: 500, headers: { 'content-type': 'application/json' } });
    window.fetch = (u, o) => {
      if (String(u) === '/api/fleet' && o && o.method === 'POST') {
        window.__posts.push(JSON.parse(o.body));
        if (window.__stub === 'fail') return Promise.resolve(nope());
        if (window.__stub === 'hang') return new Promise((res) => { window.__release = () => res(nope()); });
      }
      return real(u, o);
    };
  })()`);
  const SW = '.settings .fleet-switch[data-scope="project"]';
  const posts = () => p.ev('JSON.stringify(window.__posts)');
  const mode = () => p.ev(`document.querySelector(${JSON.stringify(SW)})?.dataset.mode ?? null`);
  const btn = (m) => `${SW} [data-fleet="${m}"]`;
  // where Run sits: the switch must not move under the owner's pointer while its busy line, its error or
  // the state line come and go (the settings area sits at the sidebar's foot, so a line growing below
  // the buttons would push them up)
  const place = () => p.ev(`(() => { const r = document.querySelector(${JSON.stringify(btn('run'))}).getBoundingClientRect(); return JSON.stringify([r.left, r.top]); })()`);
  const idle = () => until(() => p.ev(`![...document.querySelectorAll(${JSON.stringify(`${SW} button`)})].some((b) => b.disabled) && SAVING === 0`), 'the switch idle');

  // what the area holds; what goes
  await until(() => p.ev(`!!document.querySelector(${JSON.stringify(SW)})`), 'the fleet switch in the settings area');
  assert.ok(await p.ev(`!!document.querySelector('.settings a[href="#settings"]')`), 'the Settings link');
  assert.match(await p.ev(`document.querySelector('.settings #when').textContent`), /^updated /, 'the updated time');
  assert.equal(await p.ev(`!!document.querySelector('#fleet-strip')`), false, 'no fleet strip');
  assert.equal(await p.ev(`!!document.querySelector('[data-fleet="check"]')`), false, 'no Check');
  assert.equal(await mode(), 'run');
  assert.equal(await p.ev(`document.querySelector('#side-state').textContent`), 'running');

  // Run on a running fleet: no post; Drain: one post, then the mode shows drain
  const at0 = await place();
  await p.click(btn('run'));
  await p.click(btn('drain'));
  await until(async () => (await posts()) !== '[]', 'the drain posted');
  assert.equal(await posts(), JSON.stringify([{ op: 'drain' }]), 'Run on a running fleet posts nothing; Drain posts once');
  await until(async () => (await mode()) === 'drain', 'the mode drain');
  await idle();
  // the server's reason (its default for an owner's drain) arrives with the next read
  await until(async () => /^(draining…|drained) · \S/.test(await p.ev(`document.querySelector('#side-state').textContent`)), 'the state line and the reason');
  assert.equal(await place(), at0, 'the switch stays put as the state line takes the reason');
  // the press over, focus is back on the pressed button (review T5-2)
  const focused = (m) => p.ev(`document.activeElement === document.querySelector(${JSON.stringify(btn(m))})`);
  assert.ok(await focused('drain'), 'focus back on Drain');

  // Drain while draining: no post (review T5-1); Run on a held fleet: one resume
  await p.click(btn('drain'));
  await p.click(btn('run'));
  await until(async () => (await mode()) === 'run', 'the mode run');
  await idle();
  assert.equal(await posts(), JSON.stringify([{ op: 'drain' }, { op: 'resume' }]), 'Drain while draining posts nothing; Run on a held fleet posts one resume');

  // Park asks in place, with focus; two redraws keep it; Escape cancels with no post
  const confirming = () => p.ev(`(() => { const b = document.querySelector(${JSON.stringify(btn('park'))}); return !!b && b.textContent === 'Confirm park' && b.dataset.confirm === '1' && document.activeElement === b; })()`);
  await p.click(btn('park'));
  await until(() => confirming(), 'Confirm park, focused');
  await p.ev('render(DATA); render(DATA)');
  assert.ok(await confirming(), 'two redraws keep the confirm and its focus');
  await p.key('Escape');
  await until(() => p.ev(`document.querySelector(${JSON.stringify(btn('park'))}).textContent === 'Park'`), 'Escape restores Park');
  assert.equal(await p.ev(`!!document.querySelector(${JSON.stringify(`${SW} [data-confirm]`)})`), false);
  assert.equal(JSON.parse(await posts()).length, 2, 'Escape posts nothing');

  // Park, confirm: one park
  await p.click(btn('park'));
  await until(() => confirming(), 'Confirm park again');
  await p.click(btn('park'));
  await until(async () => (await mode()) === 'park', 'the mode park');
  await idle();
  assert.equal(await posts(), JSON.stringify([{ op: 'drain' }, { op: 'resume' }, { op: 'park' }]), 'the confirm posts one park');

  // Drain on a parked fleet: no post, and the switch says why; the mode stays park (review T5-1)
  await p.click(btn('drain'));
  await until(() => p.ev(`(document.querySelector(${JSON.stringify(`${SW} .err`)})?.textContent ?? '') === 'Parked: Run first, then Drain'`), 'the switch says Run first');
  assert.equal(await place(), at0, 'the switch stays put as its error shows');
  assert.equal(await mode(), 'park', 'the mode stays park');
  assert.equal(JSON.parse(await posts()).length, 3, 'Drain on a parked fleet posts nothing');

  // a refusal: its error in the switch, the mode the data's again, focus back on the button
  await p.ev("window.__stub = 'fail'");
  await p.click(btn('run'));
  await until(() => p.ev(`(document.querySelector(${JSON.stringify(`${SW} .err`)})?.textContent ?? '').includes('nope')`), 'the error in the switch');
  await until(async () => (await mode()) === 'park', 'the mode back to park');
  await idle();
  assert.equal(await posts(), JSON.stringify([{ op: 'drain' }, { op: 'resume' }, { op: 'park' }, { op: 'resume' }]), 'the refused Run posted once');
  assert.ok(await focused('run'), 'focus back on Run after a refusal');
  await p.ev('render(DATA)');
  assert.ok(await p.ev(`(document.querySelector(${JSON.stringify(`${SW} .err`)})?.textContent ?? '').includes('nope')`), 'a redraw keeps the error');
  // a redraw with nothing changed leaves the switch's node in place (final-1 F3: a rewrite could drop a click)
  assert.ok(await p.ev(`(() => { window.__sw = document.querySelector(${JSON.stringify(SW)}); render(DATA); render(DATA); return window.__sw === document.querySelector(${JSON.stringify(SW)}); })()`), 'two redraws keep the switch node while it shows an error');

  // in flight: the buttons disabled and the busy line shown, across a redraw
  await p.ev("window.__stub = 'hang'");
  await p.click(btn('run'));
  const busy = () => p.ev(`[...document.querySelectorAll(${JSON.stringify(`${SW} button`)})].every((b) => b.disabled) && (document.querySelector(${JSON.stringify(`${SW} .msg`)})?.textContent ?? '') !== ''`);
  await until(() => busy(), 'the switch busy');
  assert.equal(await place(), at0, 'the switch stays put as its busy line shows');
  assert.equal(await p.ev(`!!document.querySelector(${JSON.stringify(`${SW} .err`)})`), false, 'a new press clears the old error');
  await p.ev('render(DATA)');
  assert.ok(await busy(), 'a redraw keeps the busy line');
  assert.ok(await p.ev(`(() => { window.__sw = document.querySelector(${JSON.stringify(SW)}); render(DATA); render(DATA); return window.__sw === document.querySelector(${JSON.stringify(SW)}); })()`), 'two redraws keep the switch node while it is busy');
  await p.ev('window.__stub = null; window.__release()');
  await idle();

  // the state line's words, from the data and fleet status
  const line = (fleet, st) => p.ev(`(() => { FLEET.busy = true; FLEET.data = ${JSON.stringify(st)}; render({ ...DATA, fleet: ${JSON.stringify(fleet)} }); return document.querySelector('#side-state').textContent; })()`);
  assert.equal(await line({ mode: null, op: null, reason: null }, null), 'running');
  assert.equal(await line({ mode: 'drain', op: 'f-1', reason: 'quiet week' }, null), 'draining… · quiet week');
  assert.equal(await line({ mode: 'drain', op: 'f-1', reason: 'quiet week' }, { ready: true, blockers: [] }), 'drained · quiet week');
  assert.equal(await line({ mode: 'park', op: 'f-1', reason: 'new laptop' }, { ready: false, blockers: ['x'] }), 'parking… · new laptop');
  assert.equal(await line({ mode: 'park', op: 'f-1', reason: 'new laptop' }, { ready: true, blockers: [] }), 'parked · new laptop');
  assert.equal(await line({ mode: null, op: 'f-1', reason: 'set apart' }, null), 'partly held (a goal was set apart after the fleet op) · set apart');
  await p.ev('FLEET.busy = false; redrawNow()');

  // on a phone the switch sits in the nav row
  await size(390, 844);
  await until(() => p.ev(`(() => {
    const sw = document.querySelector(${JSON.stringify(SW)}), side = document.querySelector('.side');
    sw.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = sw.getBoundingClientRect(), s = side.getBoundingClientRect();
    return getComputedStyle(sw).display !== 'none' && r.width > 0 && r.height > 0 && r.top >= s.top && r.bottom <= s.bottom && r.left >= -1 && r.right <= innerWidth + 1 && s.top < 200;
  })()`), 'the switch in the nav row at 390');
});

// The Settings page (spec §8, done-whens 3, 6 and 7): every setting under its group, the two worker
// limits set on their own rows, and Ready to move? at all times, with Check now.
test('settings page', { skip: SKIP, timeout: 600000 }, async (t) => {
  const { p, port, size, load, onPage } = await pagesFixture(t, 'setpage', { records: false });
  const api = async (route) => { const r = await fetch(`http://127.0.0.1:${port}${route}`); assert.equal(r.status, 200, route); return r.json(); };
  await size(1440, 900);
  await load('#overview');
  // every GET's URL in window.__gets; every POST /api/owner-setting body in window.__sets; __holdFleet
  // holds a plain GET /api/fleet until __releaseFleet(); __holdCheck holds GET /api/fleet?fetch=1 until
  // __releaseCheck(body) answers it with that body; __failCheck answers it 500 with an error
  await p.ev(`(() => {
    window.__gets = []; window.__sets = []; window.__holdFleet = false; window.__holdCheck = false; window.__failCheck = false;
    const real = window.fetch;
    const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    window.fetch = (u, o) => {
      const url = String(u);
      if (!o || !o.method || o.method === 'GET') window.__gets.push(url);
      if (url === '/api/owner-setting' && o && o.method === 'POST') window.__sets.push(JSON.parse(o.body));
      if (url === '/api/fleet' && window.__holdFleet) return new Promise((res) => { window.__releaseFleet = () => res(real(u, o)); });
      if (url === '/api/fleet?fetch=1' && window.__failCheck) return Promise.resolve(json({ error: 'origin unreachable' }, 500));
      if (url === '/api/fleet?fetch=1' && window.__holdCheck) return new Promise((res) => { window.__releaseCheck = (body) => res(json(body, 200)); });
      return real(u, o);
    };
  })()`);
  const S = '#settings';
  await p.ev("location.hash = '#settings'");
  await onPage('settings');
  await until(() => p.ev(`!!document.querySelector('${S} [data-setting="max_active_tickets"]')`), 'the Settings rows');
  // arriving fetches and checks again, as Check did
  await until(() => p.ev("window.__gets.includes('/api/fleet?fetch=1')"), 'a fetch=1 request on arriving');
  // no Fleet section; the switch stays in the sidebar
  assert.equal(await p.ev(`!!document.querySelector('${S} .fleet-switch')`), false, 'no fleet switch on Settings');
  assert.equal(await p.ev(`[...document.querySelectorAll('${S} .sec .lbl')].some((l) => /^fleet$/i.test(l.textContent.trim()))`), false, 'no Fleet section');
  // Ready to move? at all times (ruling m-20261116-095757248, done-when 3 as amended): on a running
  // fleet too, ready or not, each blocker and the parity, from /api/fleet
  const blockers = () => p.ev(`JSON.stringify([...document.querySelectorAll('${S} .ready-card .ready-blocker')].map((r) => r.textContent.trim()))`);
  const badge = () => p.ev(`document.querySelector('${S} .ready-card .card-head .badge')?.textContent ?? null`);
  const checkBtn = `${S} .ready-card [data-checknow]`;
  await until(() => p.ev(`!!document.querySelector('${S} .ready-card') && !FLEET.busy && !!FLEET.data`), 'Ready to move? on a running fleet, checked');
  const st0 = await api('/api/fleet');
  assert.ok(Array.isArray(st0.blockers), 'fleet status');
  await until(async () => JSON.stringify(JSON.parse(await blockers())) === JSON.stringify(st0.blockers), 'each blocker as a row on a running fleet');
  assert.equal(await badge(), st0.ready ? 'ready to move' : 'not ready to move', 'ready or not on a running fleet');
  if (st0.parity) assert.equal(await p.ev(`[...document.querySelectorAll('${S} .ready-card code')].map((c) => c.textContent).join()`), st0.parity.hash, 'the parity hash');
  assert.equal(await p.ev(`document.querySelector('${checkBtn}')?.textContent ?? null`), 'Check now', 'Check now in the card');

  // Check now: one fetch=1 request, the button disabled while it is out, then the fresh answer
  await p.ev("window.__gets = []; window.__holdCheck = true; window.__releaseCheck = null; true");
  await p.click(checkBtn);
  await until(() => p.ev("typeof window.__releaseCheck === 'function'"), 'the Check now request out');
  await until(() => p.ev(`document.querySelector('${checkBtn}')?.disabled === true`), 'Check now disabled while out');
  const fresh = { ready: false, blockers: ['a fresh blocker from Check now'], parity: { hash: 'f00dcafe' } };
  await p.ev(`window.__holdCheck = false; window.__releaseCheck(${JSON.stringify(fresh)}); true`);
  await until(async () => (await blockers()) === JSON.stringify(fresh.blockers), 'the card shows the fresh answer');
  assert.equal(await badge(), 'not ready to move');
  assert.match(await p.ev(`document.querySelector('${S} .ready-card').textContent`), /f00dcafe/, 'the fresh parity');
  await until(() => p.ev(`document.querySelector('${checkBtn}')?.disabled === false`), 'Check now enabled again');
  assert.deepEqual(JSON.parse(await p.ev("JSON.stringify(window.__gets.filter((u) => u.startsWith('/api/fleet')))")), ['/api/fleet?fetch=1'], 'exactly one fetch=1 request');
  assert.ok(await p.ev(`document.activeElement === document.querySelector('${checkBtn}')`), 'focus back on Check now once its check ends');

  // the owner moves on while a check is out: focus stays where they put it (final-2 F2-2)
  const elsewhere = `${S} [data-limit-none="max_active_tickets"]`;
  await p.ev("window.__holdCheck = true; window.__releaseCheck = null; true");
  await p.click(checkBtn);
  await until(() => p.ev("typeof window.__releaseCheck === 'function'"), 'a second Check now out');
  await p.ev(`document.querySelector('${elsewhere}').focus()`);
  const ready = { ready: true, blockers: [], parity: { hash: 'beefcafe' } };
  await p.ev(`window.__holdCheck = false; window.__releaseCheck(${JSON.stringify(ready)}); true`);
  await until(() => p.ev(`document.querySelector('${checkBtn}')?.disabled === false`), 'the second check done');
  assert.ok(await p.ev(`document.activeElement === document.querySelector('${elsewhere}')`), 'focus stays where the owner moved it');
  assert.equal(await badge(), 'ready to move', 'a good check: ready');
  assert.ok(await p.ev(`!!document.querySelector('${S} .ready-card .badge.good')`));

  // a failed check after a good one: the old answer marked old, no green ready badge (final-2 F2-1)
  await p.ev('window.__failCheck = true');
  await p.click(checkBtn);
  await until(() => p.ev(`!!document.querySelector('${S} .ready-card .err')`), 'the failed check on the card');
  assert.equal(await p.ev(`!!document.querySelector('${S} .ready-card .badge.good')`), false, 'no green ready badge after a failed check');
  assert.match(await badge(), /^last check failed; this is from \S/, 'the badge says the answer is old, and from when');
  await p.ev('window.__failCheck = false');
  await p.click(checkBtn);
  await until(() => p.ev(`!document.querySelector('${S} .ready-card .err') && !FLEET.busy`), 'a good check after the failure');
  // (this check is the server's own answer, ready or not)
  assert.match(await badge(), /^(not )?ready to move$/, 'a good check clears the old mark');

  // until the first answer, the card holds a line for what is left and one for the parity, so the rows
  // below stay put when an answer of one blocker or none comes back
  const rowTop = () => p.ev(`document.querySelector('${S} [data-setting="max_active_tickets"]').getBoundingClientRect().top`);
  for (const answer of [{ ready: false, blockers: ['one thing left'], parity: { hash: 'abc12345' } }, { ready: true, blockers: [], parity: { hash: 'abc12345' } }]) {
    await p.ev("FLEET.data = null; FLEET.error = null; window.__holdCheck = true; window.__releaseCheck = null; true");
    await p.click(checkBtn);
    await until(() => p.ev("typeof window.__releaseCheck === 'function'"), 'a check out with nothing known');
    await until(() => p.ev(`!!document.querySelector('${S} .ready-card .ready-pending')`), 'the pending lines');
    const top0 = await rowTop();
    await p.ev(`window.__holdCheck = false; window.__releaseCheck(${JSON.stringify(answer)}); true`);
    await until(() => p.ev(`!FLEET.busy && !document.querySelector('${S} .ready-card .ready-pending')`), 'the answer drawn');
    assert.ok(Math.abs((await rowTop()) - top0) <= 1, `the rows stay put as the answer comes (${answer.blockers.length} blockers)`);
  }

  // Check now fails: the error on the card, kept across a redraw; the button back
  await p.ev('window.__failCheck = true');
  await p.click(checkBtn);
  await until(() => p.ev(`/origin unreachable/.test(document.querySelector('${S} .ready-card .err')?.textContent ?? '')`), 'the error on the card');
  await until(() => p.ev(`document.querySelector('${checkBtn}')?.disabled === false`), 'Check now enabled after a failure');
  await p.ev('render(DATA)');
  assert.match(await p.ev(`document.querySelector('${S} .ready-card .err')?.textContent ?? ''`), /origin unreachable/, 'a redraw keeps the error');
  await p.ev('window.__failCheck = false');
  // a good check clears it
  await p.click(checkBtn);
  await until(() => p.ev(`!document.querySelector('${S} .ready-card .err') && !FLEET.busy`), 'a good check clears the error');

  // every setting, once, under its group, in settings_all's order
  const data = await api('/api/data');
  const all = data.settings_all;
  assert.ok(Array.isArray(all) && all.length > 20, 'settings_all served');
  const list = (a) => (a.length ? `${a.length}: ${a.join(', ')}` : 'none');
  const text = (e) => {
    if (e.withheld) return 'withheld';
    if (e.shown === 'hidden') return 'not shown here';
    if (e.shown === 'names') return list(e.value || []);
    if (e.shown === 'count') return e.value ? String(e.value) : 'none';
    const v = e.value;
    if (v === null || v === undefined) return 'not set';
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (Array.isArray(v)) return list(v.map(String));
    if (typeof v === 'object') return list(Object.keys(v));
    return String(v);
  };
  const order = [...new Set(all.map((e) => e.group))].flatMap((g) => all.filter((e) => e.group === g));
  const rows = JSON.parse(await p.ev(`JSON.stringify([...document.querySelectorAll('${S} .set-row')].map((r) => ({
    key: r.dataset.setting, group: r.closest('.sec')?.querySelector('.lbl')?.textContent,
    name: r.querySelector('.set-name')?.textContent, code: r.querySelector('code.set-key')?.textContent,
    value: r.querySelector('.set-val')?.textContent ?? null, limit: !!r.querySelector('.r .limit'),
    badge: [...r.querySelectorAll('.badge')].map((b) => [b.textContent, b.title]),
    desc: r.nextElementSibling?.matches('.set-desc') ? r.nextElementSibling.textContent : null,
    controls: r.querySelectorAll('input, button, select, textarea').length,
  })))`));
  assert.deepEqual(rows.map((r) => r.key), order.map((e) => e.key), 'every setting once, grouped, in order');
  const LIMITS = ['max_active_tickets', 'max_active_per_component'];
  for (const [i, e] of order.entries()) {
    const r = rows[i];
    assert.equal(r.group, e.group, `${e.key}: under its group`);
    assert.equal(r.name, e.name, `${e.key}: its name`);
    assert.equal(r.code, e.key, `${e.key}: its key in mono`);
    assert.deepEqual(r.badge, e.owner_only ? [['yours to change', e.owner_only]] : [], `${e.key}: "yours to change" exactly on owner_only`);
    assert.ok(r.desc !== null && r.desc.startsWith(e.description), `${e.key}: its description under it`);
    if (LIMITS.includes(e.key)) { assert.ok(r.limit, `${e.key}: the control`); assert.equal(e.group, 'Fleet and capacity'); }
    else { assert.equal(r.value, text(e), `${e.key}: its value`); assert.equal(r.controls, 0, `${e.key}: nothing editable`); }
  }
  assert.ok(LIMITS.every((k) => rows.some((r) => r.key === k)), 'both limits drawn');

  // a limit: No limit, − and + around the number, Save hidden until changed
  const L = `${S} [data-setting="max_active_tickets"]`;
  const num = () => p.ev(`document.querySelector('${L} .stepper b').textContent`);
  const saveShown = () => p.ev(`(() => { const b = document.querySelector('${L} [data-limit-save]'); return !!b && !b.hidden && getComputedStyle(b).display !== 'none'; })()`);
  assert.ok(await p.ev(`!!document.querySelector('${L} .seg [data-limit-none]') && document.querySelector('${L} [data-limit-none]').textContent === 'No limit'`), 'a No limit button');
  assert.ok(await p.ev(`!!document.querySelector('${L} [data-limit-step="-1"]') && !!document.querySelector('${L} [data-limit-step="1"]')`), '− and +');
  assert.equal(await p.ev(`document.querySelector('${L} [data-limit-none]').getAttribute('aria-pressed')`), 'true', 'no limit by default');
  assert.equal(await saveShown(), false, 'Save hidden until changed');
  await p.click(`${L} [data-limit-step="1"]`);
  await until(async () => (await num()) === '1', '+ from No limit gives 1');
  assert.ok(await saveShown(), 'Save shown once changed');
  await p.click(`${L} [data-limit-step="-1"]`);
  assert.equal(await num(), '1', '− at 1 stays 1');
  for (let i = 0; i < 21; i++) await p.click(`${L} [data-limit-step="1"]`);
  await until(async () => (await num()) === '20', 'up to 20');
  assert.equal(await num(), '20', '+ at 20 stays 20');
  // back to 2, and a redraw keeps it and Save (review focus 2)
  await p.click(`${L} [data-limit-none]`);
  await p.click(`${L} [data-limit-step="1"]`);
  await p.click(`${L} [data-limit-step="1"]`);
  await until(async () => (await num()) === '2', 'the value 2');
  await p.ev('render(DATA); render(DATA)');
  assert.equal(await num(), '2', 'a redraw keeps the pressed value');
  assert.ok(await saveShown(), 'a redraw keeps Save');

  // Save posts { key, value }; the label is then the server's: saved, until the supervisor lands it
  await p.click(`${L} [data-limit-save]`);
  await until(() => p.ev('window.__sets.length === 1'), 'the save posted');
  assert.deepEqual(JSON.parse(await p.ev('JSON.stringify(window.__sets)')), [{ key: 'max_active_tickets', value: 2 }]);
  const label = () => p.ev(`document.querySelector('${S} [data-setting-desc="max_active_tickets"] .set-label')?.textContent ?? null`);
  let asked = null;
  await until(async () => { asked = (await api('/api/data')).asked_settings?.max_active_tickets; return asked && asked.asked === 2 && (await label()) === asked.label; }, "the row's label is the server's");
  assert.match(asked.label, /^saved; applies once the supervisor lands it$/i, 'saved, not yet in force (main still has none)');
  await until(async () => !(await saveShown()), 'Save hidden once saved');
  assert.equal(await num(), '2', 'the control shows the value asked for');

  // No limit, then Save: value null
  await p.click(`${L} [data-limit-none]`);
  await until(() => saveShown(), 'Save shown for No limit');
  await p.click(`${L} [data-limit-save]`);
  await until(() => p.ev('window.__sets.length === 2'), 'the No limit save posted');
  assert.deepEqual(JSON.parse(await p.ev('JSON.stringify(window.__sets[1])')), { key: 'max_active_tickets', value: null });
  await until(async () => !(await saveShown()) && await p.ev('SAVING === 0'), 'the No limit save done');

  // a refusal: the server's reason by the control
  await p.ev("saveLimit('max_active_tickets', 0)");
  await until(() => p.ev(`/whole number from 1 to 20/.test(document.querySelector('${L} .err')?.textContent ?? '')`), "the server's reason by the control");
  await until(() => p.ev('SAVING === 0'), 'the refusal done');
  assert.match(await p.ev(`document.querySelector('${L} .err').textContent`), /whole number from 1 to 20/, 'a redraw keeps the reason');

  // below 700px a row's value sits under its name
  await size(690, 800);
  await until(() => p.ev(`(() => { const r = document.querySelector('${S} [data-setting="tick_minutes"]'); const t = r.querySelector('.t').getBoundingClientRect(), v = r.querySelector('.r').getBoundingClientRect(); return v.top >= t.bottom - 1; })()`), 'the value box below the name box at 690');
  await size(1440, 900);

  // the fleet parked: Ready to move? with each blocker and Check now, after a fetch=1 request
  assert.equal(await p.ev("fetch('/api/fleet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'park' }) }).then((r) => r.status)"), 200, 'parked');
  await until(() => p.ev("DATA.fleet && DATA.fleet.mode === 'park'"), 'the data says parked');
  await p.ev("location.hash = '#overview'");
  await onPage('overview');
  // a loadFleet() already in flight on arrival: the fetch=1 request still follows
  await p.ev("window.__gets = []; window.__holdFleet = true; window.__releaseFleet = null; FLEET.busy = false; void loadFleet(); true");
  await until(() => p.ev("typeof window.__releaseFleet === 'function' && FLEET.busy"), 'a plain loadFleet in flight');
  await p.ev("location.hash = '#settings'");
  await onPage('settings');
  await p.ev('window.__holdFleet = false; window.__releaseFleet()');
  await until(() => p.ev("window.__gets.includes('/api/fleet?fetch=1')"), 'a fetch=1 request after the one in flight');
  await until(() => p.ev(`!!document.querySelector('${S} .ready-card')`), 'Ready to move? while parked');
  const st = await api('/api/fleet?fetch=1');
  assert.ok(Array.isArray(st.blockers), 'fleet status');
  await until(async () => {
    const got = JSON.parse(await p.ev(`JSON.stringify([...document.querySelectorAll('${S} .ready-card .ready-blocker')].map((r) => r.textContent.trim()))`));
    return JSON.stringify(got) === JSON.stringify(st.blockers);
  }, 'each /api/fleet blocker as a row');
  const card = await p.ev(`(() => { const c = document.querySelector('${S} .ready-card'); return { first: c === document.querySelector('${S}').firstElementChild, head: c.querySelector('.card-head').textContent, buttons: c.querySelectorAll('button').length }; })()`);
  assert.ok(card.first, 'Ready to move? first');
  assert.match(card.head, /Ready to move\?/);
  assert.equal(card.buttons, 1, 'one button in Ready to move?: Check now');
  assert.equal(await p.ev(`document.querySelector('${S} .ready-card button').textContent`), 'Check now');

  // the fleet drained: the card still shows, with its blockers
  for (const op of ['resume', 'drain']) assert.equal(await p.ev(`fetch('/api/fleet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: '${op}' }) }).then((r) => r.status)`), 200, op);
  await until(() => p.ev("DATA.fleet && DATA.fleet.mode === 'drain'"), 'the data says draining');
  await p.click(`${S} .ready-card [data-checknow]`);
  await until(() => p.ev(`/^Held/.test(document.querySelector('${S} .ready-card .rowline')?.textContent ?? '') && /drain/.test(document.querySelector('${S} .ready-card .rowline').textContent) && !FLEET.busy`), 'Ready to move? while draining');
  const st2 = await api('/api/fleet?fetch=1');
  await until(async () => (await p.ev(`JSON.stringify([...document.querySelectorAll('${S} .ready-card .ready-blocker')].map((r) => r.textContent.trim()))`)) === JSON.stringify(st2.blockers), 'each blocker as a row while draining');

  // settings_all missing: the limits and the card still draw, and a line says the list can't be read
  await p.ev('FLEET.busy = true; DATA = { ...DATA, settings_all: undefined }; render(DATA)');
  assert.ok(await p.ev(`!!document.querySelector('${S} [data-setting="max_active_tickets"] .limit') && !!document.querySelector('${S} [data-setting="max_active_per_component"] .limit')`), 'the limits still draw');
  assert.ok(await p.ev(`!!document.querySelector('${S} .ready-card')`), 'the card still draws');
  assert.match(await p.ev(`document.querySelector('${S}').textContent`), /settings list can't be read/, "a line says the list can't be read");
  assert.equal(await p.ev(`document.querySelectorAll('${S} .set-row').length`), 2, 'only the limits');
  await p.ev('FLEET.busy = false');
});

// Every Settings row is a thread target (spec §8, done-when 8): a page subject on #settings?key=<key>
// with the row's plain name as its quote; a second Shift+click opens that thread; its pin on the row;
// opened from elsewhere, #settings with the row in view and marked while the card is open.
test('settings rows as thread targets', { skip: SKIP, timeout: 600000 }, async (t) => {
  const { p, port, dt, size, load, onPage } = await pagesFixture(t, 'setthreads', { records: false });
  const api = async (route) => { const r = await fetch(`http://127.0.0.1:${port}${route}`); assert.equal(r.status, 200, route); return r.json(); };
  const threads = async () => (await api('/api/threads')).threads;
  const K = 'max_active_tickets', K2 = 'max_active_per_component';
  const view = (k) => `#settings?key=${k}`;
  const row = (k) => `#settings [data-setting="${k}"]`;
  const box = (sel) => p.ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r && { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; })()`);
  const pinOf = (id) => `#tl-pins [data-tl-pin="${id}"]`;
  const cardKey = () => p.ev(`document.getElementById('tl-card').hidden ? null : document.getElementById('tl-card').dataset.key`);
  const marked = () => p.ev(`[...document.querySelectorAll('.tl-marked')].map((e) => e.dataset.setting ?? e.tagName)`);
  // a Shift+click on the row's name (not its control); while the pin shows, the whole row is outlined
  const shiftClick = async (k) => {
    const at = await p.at(`${row(k)} .set-name`);
    await p.hold('Shift', true);
    await p.move(at.x, at.y, 8);
    await until(() => p.ev("!document.getElementById('tl-cursor').hidden"), 'the pin cursor');
    const hl = await box('#tl-hl'), r = await box(row(k));
    assert.ok(Math.abs(hl.left - (r.left - 3)) <= 1 && Math.abs(hl.right - (r.right + 3)) <= 1 && Math.abs(hl.top - (r.top - 3)) <= 1 && Math.abs(hl.bottom - (r.bottom + 3)) <= 1, `the whole row outlined: ${JSON.stringify([hl, r])}`);
    await p.clickAt(at.x, at.y, 8);
    await p.hold('Shift', false);
  };

  await size(1440, 900);
  await load('#settings');
  await onPage('settings');
  await until(() => p.ev(`!!document.querySelector(${JSON.stringify(row(K))}) && !!document.querySelector(${JSON.stringify(row(K2))})`), 'the Settings rows');
  // arriving checks the fleet (fetch=1): aim at a row only once that read has answered and been drawn
  await until(() => p.ev('!FLEET.busy && !!FLEET.data && !FLEET.wantFetch'), 'the fleet read settled');
  const all = (await api('/api/data')).settings_all;
  const name = all.find((e) => e.key === K).name, name2 = all.find((e) => e.key === K2).name;
  assert.ok(name && name2, 'settings_all names both limits');

  // a Shift+click on the row: a new-thread card titled for the setting, nothing written yet
  const before = (await threads()).length;
  await shiftClick(K);
  await until(async () => await cardKey() === `new:page:${view(K)}:undefined:undefined`, 'a new-thread card on the row');
  assert.equal(await p.ev("document.getElementById('tl-c-title').textContent"), `Setting · ${name} (${K})`);
  assert.deepEqual(await p.ev('TL.draft.subject'), { kind: 'page', view: view(K), quote: name });
  assert.equal(await p.ev("document.activeElement.id"), 'tl-c-text', 'ready to write');
  assert.equal((await threads()).length, before, 'nothing written yet');
  // the first words: a thread on the row
  await p.type('Lower this to two');
  await p.key('Enter', 8);
  const th = await until(async () => (await threads()).find((x) => x.subject?.view === view(K)), 'the thread in /api/threads');
  assert.deepEqual(th.subject, { kind: 'page', view: view(K), quote: name });
  assert.equal(th.title, `Setting · ${name} (${K})`);
  const TA = th.id;
  await until(async () => await cardKey() === TA, 'the card the thread');
  // its pin on the row, at its top right
  await until(() => p.ev(`!!document.querySelector(${JSON.stringify(pinOf(TA))})`), "the thread's pin");
  const onCorner = async (id, k) => { const b = await box(pinOf(id)), r = await box(row(k)); return b && r && b.left <= r.right && r.right <= b.right && b.top <= r.top && r.top <= b.bottom; };
  await until(() => onCorner(TA, K), "the pin on the row's top right");
  // the row is marked while its card is open, and the mark survives a redraw of the page
  await until(async () => JSON.stringify(await marked()) === JSON.stringify([K]), 'the row marked');
  await p.ev('SET_DRAWN = null; drawSettings()');
  assert.deepEqual(await marked(), [K], 'still marked after a redraw');
  await p.click('[data-tl-close]');
  await until(async () => await cardKey() === null && (await marked()).length === 0, 'closed, the mark gone');

  // a second Shift+click on the row opens that thread: no new card, no new thread
  const count = (await threads()).length;
  await shiftClick(K);
  await until(async () => await cardKey() === TA, 'the same thread opened');
  assert.equal(await p.ev('TL.draft'), null, 'no draft');
  assert.equal((await threads()).length, count, 'the thread count unchanged');
  await p.click('[data-tl-close]');
  await until(async () => await cardKey() === null, 'closed');

  // the Threads panel's row names the setting
  await until(() => p.ev(`!document.body.classList.contains('threads-open') && ${STEADY('#inbox-btn')}`), 'the Inbox button at rest, the panel closed');
  await p.click('#inbox-btn');
  await until(() => p.ev(`document.body.classList.contains('threads-open') && getComputedStyle(document.getElementById('threads')).transform === 'none' && !!document.querySelector('#tl-list [data-tl-open="${TA}"]')`), 'the Threads panel, at rest, lists it');
  assert.equal(await p.ev(`document.querySelector('#tl-list [data-tl-open="${TA}"] .th-where').textContent`), `Settings, ${name}`);
  await p.click('#th-close');
  await until(() => p.ev("!document.body.classList.contains('threads-open')"), 'the panel closed');

  // a thread on the other limit's row has its own pin, on its own row
  const TB = dt(['thread', 'new', 'Per component too', '--subject', JSON.stringify({ kind: 'page', view: view(K2), quote: name2 })], null).split('\n')[0];
  await until(() => p.ev(`!!document.querySelector(${JSON.stringify(pinOf(TB))})`), "the other row's pin");
  await until(() => onCorner(TB, K2), "on the other row's top right");
  assert.ok(await onCorner(TA, K), 'the first pin still on its row');

  // from Overview, a talk/ link: #settings, the row in view and marked; the mark goes with the card
  await p.ev("location.hash = '#overview'");
  await onPage('overview');
  await p.ev(`location.hash = '#talk/${TA}'`);
  await until(async () => await cardKey() === TA && JSON.stringify(await p.ev("[...document.querySelectorAll('main > section[data-page]')].filter((s) => getComputedStyle(s).display !== 'none').map((s) => s.dataset.page)")) === '["settings"]', 'the card over Settings');
  await until(async () => { const r = await box(row(K)); return r.top >= 0 && r.bottom <= await p.ev('innerHeight'); }, 'the row in view');
  await until(async () => JSON.stringify(await marked()) === JSON.stringify([K]), 'the row marked');
  await p.click('[data-tl-close]');
  await until(async () => await cardKey() === null && (await marked()).length === 0, 'closed, the mark gone');
});
