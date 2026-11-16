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

const NAV = [['Project', ['Overview', 'Inbox', 'Goals', 'Progress', 'Board', 'Library']], ['Autonomy', ['Trust', 'Sensors', 'Health', 'Retros', 'Self Improvement']]];
const SKIP = canDrive ? false : 'needs Chrome and a Node with WebSocket';

// One project, its dashboard and a Chrome tab on it. With records, the project has what the
// supervisor would make (kit CLI): a goal being defined with an open goal-definition question (its
// link is on Goals), a ticket (a card on Progress), an open question and an answered one on that
// ticket (links in its peek), and an open review question whose page is committed on main.
// Gives the tab (p), the port, the ids, and helpers: dt (the kit CLI; role null is the owner), load
// (a fresh visit), shown, onPage, size.
async function pagesFixture(t, name, { records = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `devteam-dash-${name}-`));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 2), DEVTEAM_PORT_BASE: String(PORTS + 3), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of Object.keys(env)) if (k.startsWith('DEVTEAM_') && !['DEVTEAM_HUB_PORT', 'DEVTEAM_PORT_BASE'].includes(k)) delete env[k];
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
  const drawn = () => until(() => p.ev("location.protocol === 'http:' && !!document.querySelector('main') && !document.querySelector('main.waiting')"), 'the dashboard drawn');
  // a fresh visit: a new document, so its first route is a cold one
  const load = async (hash) => {
    await p.send('Page.navigate', { url: 'about:blank' });
    await until(() => p.ev("location.href === 'about:blank'"), 'about:blank');
    await p.send('Page.navigate', { url: url(hash) });
    await drawn();
  };
  const shown = () => p.ev("[...document.querySelectorAll('main > section[data-page]')].filter((s) => getComputedStyle(s).display !== 'none').map((s) => s.dataset.page)");
  const onPage = (id) => until(async () => JSON.stringify(await shown()) === JSON.stringify([id]) && await p.ev(`location.hash === ${JSON.stringify(`#${id}`)}`), `page ${id} alone`);
  return { p, port, root, ids, dt, size, url, drawn, load, shown, onPage };
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
    await p.click('#inbox-btn');
    await onPage('inbox');
  }
});

// The router's history (spec §4, done-whens 1d and 2a-2e, the Edge cases): every entry stamped
// { page, depth, openedHere }, a peek over the page it was clicked on, closing by closeTarget.
test('history', { skip: SKIP, timeout: 600000 }, async (t) => {
  const { p, ids, load, drawn, shown, onPage } = await pagesFixture(t, 'history');
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
  const peekOver = (hash, page, what) => until(async () => await peekOpen() && await p.ev(`location.hash === ${JSON.stringify(hash)} && typeof history.state?.page === 'string'`) && JSON.stringify(await shown()) === JSON.stringify([page]), what);
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
  await p.ev('window.__unloaded = false');
  await p.send('Page.reload');
  await until(() => p.ev("window.__unloaded === undefined"), 'the reload');
  await drawn();
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
// added), closing follows closeTarget; the dock's list goes to the page; a pin keeps it; pins are
// drawn for the page shown.
test('threads on pages', { skip: SKIP, timeout: 600000 }, async (t) => {
  const { p, ids, dt, size, load, drawn, shown, onPage } = await pagesFixture(t, 'threads');
  const T = ids.ticket;
  // started through the owner channel (no role), as test/dashboard.test.mjs starts them
  const thread = (text, subject) => dt(['thread', 'new', text, '--subject', JSON.stringify(subject)], null).split('\n')[0];
  const TT = thread('About the small ticket', { kind: 'item', ref: `ticket:${T}` });
  const TO = thread('On Orient', { kind: 'page', view: '#loop/orient', at: { x: 0.5, y: 0.1 } });
  const TM = thread('On the sensors', { kind: 'page', view: '#monitoring', at: { x: 0.5, y: 0.1 } });
  const TG = thread('On a ticket gone', { kind: 'item', ref: 'ticket:no-such-ticket' });
  const state = async () => JSON.parse(await p.ev('JSON.stringify(history.state)'));
  const len = () => p.ev('history.length');
  const go = (hash) => p.ev(`location.hash = ${JSON.stringify(hash)}`);
  const back = () => p.ev('history.back()');
  const hash = () => p.ev('location.hash');
  const cardOn = (id) => p.ev(`!document.getElementById('tl-card').hidden && document.getElementById('tl-card').dataset.key === ${JSON.stringify(id)}`);
  const cardShut = () => p.ev(`document.getElementById('tl-card').hidden`);
  const loaded = () => until(() => p.ev(`[${JSON.stringify([TT, TO, TM, TG])}].flat().every((id) => TL.threads.some((x) => x.id === id))`), 'the threads read in');
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
  assert.deepEqual(await state(), { page: '#board', depth: 1, openedHere: true }, "its stamp's page is the subject's");
  await until(async () => await gap() <= 400, 'the card beside the ticket');
  // a reload reopens it over Board
  await p.ev('window.__unloaded = false');
  await p.send('Page.reload');
  await until(() => p.ev('window.__unloaded === undefined'), 'the reload');
  await drawn();
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
  assert.deepEqual(await state(), { page: '#board', depth: 1, openedHere: false });
  n = await len();
  await p.click('[data-tl-close]');
  await shut('board', 'cold ×: #board');
  assert.equal(await len(), n, 'closed in place');

  // page subjects, through the router's redirects: #loop/orient is the Loop on Orient, #monitoring is Sensors
  await go('#overview');
  await onPage('overview');
  await linkOn('overview', `#talk/${TO}`);
  await cardOver(TO, 'loop', 'the Orient thread over the Loop');
  assert.equal((await state()).page, '#loop?lt=orient');
  assert.equal(await p.ev("document.querySelector('#loop-tabs [aria-selected=\"true\"]')?.dataset.tab"), 'orient', 'on Orient');
  await p.click('[data-tl-close]');
  await shut('overview', '× back to Overview');
  await linkOn('overview', `#talk/${TM}`);
  await cardOver(TM, 'sensors', 'the Sensors thread over Sensors');
  assert.equal((await state()).page, '#sensors');
  await p.click('[data-tl-close]');
  await shut('overview', '× back to Overview');
  // a subject not drawn: over its kind's home page
  await linkOn('overview', `#talk/${TG}`);
  await cardOver(TG, 'board', 'a thread on a ticket not drawn, over Board');
  await p.click('[data-tl-close]');
  await shut('overview', '× back to Overview');

  // the dock's list on Overview: one entry, Board shown; × closes the card in place
  // (Overview made the newest entry, none ahead of it, so the one entry shows in history.length)
  await go('#goals');
  await onPage('goals');
  await go('#overview');
  await onPage('overview');
  n = await len();
  await p.click('#tl-pill');
  await until(() => p.ev(`!!document.querySelector('#tl-list [data-tl-open="${TT}"]')`), 'the dock lists it');
  await p.click(`#tl-list [data-tl-open="${TT}"]`);
  await until(async () => await cardOn(TT) && await hash() === '#board' && JSON.stringify(await shown()) === '["board"]', 'the dock opens it over Board');
  assert.equal(await len(), n + 1, 'the dock adds one entry');
  await until(async () => await gap() <= 400, 'the card beside the ticket');
  n = await len();
  await p.click('[data-tl-close]');
  await until(() => cardShut(), 'closed');
  assert.equal(await hash(), '#board', 'closed in place');
  assert.equal(await len(), n, 'no history move');

  // pins: the ticket thread's on Board; a pin keeps the page and opens the card; none on Overview
  await until(() => pinned(TT), "the ticket thread's pin on Board");
  n = await len();
  await p.click(`#tl-pins [data-tl-pin="${TT}"]`);
  await until(() => cardOn(TT), 'the pin opens the card');
  assert.equal(await hash(), '#board', 'the pin keeps the page');
  assert.equal(await len(), n, 'and adds no entry');
  await p.click('[data-tl-close]');
  await until(() => cardShut(), 'closed');
  await go('#overview');
  await onPage('overview');
  assert.equal(await pinned(TT), false, 'no pin for it on Overview, redrawn on the page change');
});
