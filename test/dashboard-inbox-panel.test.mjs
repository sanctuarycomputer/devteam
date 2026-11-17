// The Inbox in the side panel (kit-100): the panel's first tab, opened by the top-right Inbox button and
// by th=inbox, holding the one Inbox element (#th-inbox) moved out of <main>. Headless Chrome against a
// real dashboard on a project of its own (inboxFixture, spec §3), skipped where Chrome can't be driven,
// as the kit's other Chrome tests are.
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { PORTS, bareProject, dashboardOnFreePort, inboxFixture, threadsFixture, until } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const SKIP = canDrive ? false : 'needs Chrome and a Node with WebSocket';

// A wait on a condition in the page: an evaluation that throws is "not yet"; timed out, it says where
// the tab is, the last error and what the server said last.
const soonIn = (p, ms = 30000, server = null) => async (expr, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v, err = null;
    try { v = await p.ev(expr); } catch (e) { err = e; }
    if (v) return v;
    if (Date.now() > end) {
      const at = await p.ev('[location.href, document.title, document.readyState]').catch((e) => e.message);
      assert.fail(`timed out: ${what}; the tab is at ${JSON.stringify(at)}${err ? `; last: ${err.message}` : ''}${server ? `; the server said, last: ${JSON.stringify(String(server()).slice(-600))}` : ''}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
};

// The terminal's waiting prompt, faked in the browser (no tmux): a numbered menu as /api/threads gives
// one (supervisor.question), its words, options and hint the test's. A later case passes another hint.
const paneMenu = ({ hint = 'Enter to confirm · Esc to cancel', digest = 'a1'.repeat(20), token = 'b2'.repeat(32) } = {}) => ({
  kind: 'menu', digest, question: 'Claude wants to edit checkout.js. Do you want to proceed?', options: [{ n: 1, label: 'Yes' }, { n: 2, label: 'No' }], selected: 1, hint, first: 'Claude wants to edit checkout.js', token,
});
// The page's script before anything of its own: the 10 s poll every 300 ms; every /api/threads answer
// carries window.__pane as the supervisor's question (none when null), its pane up; a POST to
// /api/pane-answer, while window.__paneReply is set, is kept in window.__paneAnswers and answered with
// it (status, body) rather than sent. A test changes either in the page.
const paneInit = (q) => `(() => {
  const si = window.setInterval;
  window.setInterval = (f, ms, ...a) => si(f, ms === 10000 ? 300 : ms, ...a);
  window.__pane = ${JSON.stringify(q)};
  window.__paneReply = null;
  window.__paneAnswers = [];
  const real = window.fetch;
  window.fetch = async (u, o) => {
    const url = String(u && u.url ? u.url : u);
    const method = String(o?.method || 'GET').toUpperCase();
    if (method === 'POST' && url.startsWith('/api/pane-answer') && window.__paneReply) {
      window.__paneAnswers.push(JSON.parse(o.body));
      const { status = 200, body = {} } = window.__paneReply;
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }
    const r = await real(u, o);
    if (method !== 'GET' || !r.ok || !url.startsWith('/api/threads') || !window.__pane) return r;
    const j = await r.json();
    return new Response(JSON.stringify({ ...j, supervisor: { ...(j.supervisor || {}), pane: true, question: window.__pane } }), { status: r.status, statusText: r.statusText, headers: r.headers });
  };
})()`;

// The fixture's project, its dashboard and a Chrome tab on it at 1440x900; HOME and ports its own,
// DEVTEAM_* removed (DEVTEAM_BOX stays as lib/kit.mjs sets it: the kit under test sees no box).
async function open(t, hash) {
  const later = cleanup(t);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-dash-inbox-'));
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 2), DEVTEAM_PORT_BASE: String(PORTS + 3), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of Object.keys(env)) if (k.startsWith('DEVTEAM_') && !['DEVTEAM_HUB_PORT', 'DEVTEAM_PORT_BASE', 'DEVTEAM_BOX'].includes(k)) delete env[k];
  for (const k of ['TMUX', 'TMUX_PANE']) delete env[k];
  const root = bareProject(base, 'inbox');
  const fx = inboxFixture(root, env);
  const { dash, port } = await dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  const size = (width, height) => p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await size(1440, 900);
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: paneInit(paneMenu()) });
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/${hash}` });
  const soon = soonIn(p, 30000, () => dash.out());
  await soon('typeof DATA === "object" && DATA !== null && TL.have > 0', 'the page and its threads read');
  // a reload: the old document marked, then a new one (without the mark) with its data and threads read
  const reload = async () => {
    await p.ev('window.__old = true; void 0');
    await p.send('Page.reload');
    await soon('!window.__old && typeof DATA === "object" && DATA !== null && TL.have > 0', 'the page reloaded and read');
  };
  return { p, soon, size, reload, fx, root, env, port, dash, chrome, later };
}

const IS_OPEN = "document.body.classList.contains('threads-open')";
const AT_REST = `(${IS_OPEN} && getComputedStyle(document.getElementById('threads')).transform === 'none')`;
// shown: a box, not display:none or visibility:hidden, and not hidden
const SEEN = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.hidden) return false; const c = getComputedStyle(e); return c.display !== 'none' && c.visibility !== 'hidden' && e.getClientRects().length > 0; })()`;
const TAB = (id) => `document.querySelector('#th-tabs [role="tab"][data-tab="${id}"]')`;
// an element inside #th-body's visible box (the panel's scroller), and so within the window
const IN_BODY = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}), b = document.getElementById('th-body'); if (!e || !b.contains(e)) return false;
  const r = e.getBoundingClientRect(), v = b.getBoundingClientRect(); return r.height > 0 && r.top >= v.top - 1 && r.bottom <= v.bottom + 1 && r.top >= 0 && r.bottom <= innerHeight; })()`;
const FRAMES = 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))';
// a box steady between two reads (no slide or scroll moving it)
const STEADY = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(), k = [r.left, r.top, r.width, r.height].join(); const was = (window.__steady ||= {})[${JSON.stringify(sel)}]; window.__steady[${JSON.stringify(sel)}] = k; return was === k; })()`;
const ON_PAGE = (id) => `!!document.querySelector('main.page > section[data-page="${id}"]')?.classList.contains('on')`;

test('the Inbox in the panel', { skip: SKIP, timeout: 600000 }, async (t) => {
  const { p, soon, size, reload, fx, chrome, later, port } = await open(t, '#overview');
  const { Q } = fx;
  const len = () => p.ev('history.length');
  const back = () => p.ev('history.back(); void 0');
  const ON_INBOX = `${AT_REST} && ${TAB('inbox')}?.getAttribute('aria-selected') === 'true' && ${SEEN('#th-inbox')}`;

  // AC1 (done-when 1)
  await t.test('the tab and the button', async () => {
    assert.deepEqual(await p.ev('threadsTabs.list().map((t) => t.id)'), ['inbox', 'threads', 'supervisor', 'shell']);
    // the first tab: Inbox, its count 9 (six open questions, the review and two lessons), in red
    await soon("document.querySelector('#th-tabs [role=\"tab\"] .n')?.textContent === '9'", 'the Inbox count, 9');
    const tab = await p.ev(`(() => { const b = document.querySelector('#th-tabs [role="tab"]'), n = b.querySelector('.n');
      const probe = document.createElement('span'); probe.style.color = 'var(--red)'; b.append(probe); const red = getComputedStyle(probe).color; probe.remove();
      return { id: b.dataset.tab, text: b.textContent, n: n.textContent, color: getComputedStyle(n).color, red }; })()`);
    assert.equal(tab.id, 'inbox');
    assert.match(tab.text, /^Inbox/);
    assert.equal(tab.n, '9');
    assert.equal(tab.color, tab.red, `the count is --red: ${JSON.stringify(tab)}`);

    // the button opens the panel on the Inbox tab, over the page in force
    assert.equal(await p.ev(IS_OPEN), false, 'closed at first');
    await p.click('.pagebar .tt');
    await soon(`location.hash === '#overview?th=inbox' && ${AT_REST}`, 'the panel open on #overview?th=inbox');
    assert.equal(await p.ev(`${TAB('inbox')}.getAttribute('aria-selected')`), 'true', 'the Inbox tab selected');
    await soon(`${SEEN('#th-inbox')} && document.getElementById('threads').contains(document.getElementById('th-inbox'))`, '#th-inbox shown inside #threads');
    // what the terminal asks, every open question's card with the review's, the lessons, the secrets form, Answered
    await soon("!!document.querySelector('#th-inbox #ask-inbox .ask')", "the terminal's card in #ask-inbox");
    const inbox = await p.ev(`(() => { const box = document.getElementById('th-inbox'), w = document.getElementById('answered-wrap');
      return { cards: box.querySelectorAll('#questions [data-qcard]').length, review: !!box.querySelector('#questions [data-qcard="${fx.r}"]'), lesson: !!box.querySelector('#questions [data-know="${fx.L1}"]') && !!box.querySelector('#questions [data-know="${fx.L2}"]'),
        secret: !!box.querySelector('[data-secret]'), wrap: box.contains(w), open: w.open, sum: document.getElementById('answered-sum').textContent, answered: DATA.ooda.answered.length }; })()`);
    assert.equal(inbox.cards, 7, 'six open questions and the review');
    assert.ok(inbox.review, 'the review card');
    assert.ok(inbox.lesson, 'the lesson cards');
    assert.ok(inbox.secret, 'the secrets form');
    assert.ok(inbox.wrap, '#answered-wrap in #th-inbox');
    assert.equal(inbox.open, false, 'Answered collapsed');
    assert.equal(inbox.sum, `Answered (${inbox.answered})`);
    // .tt's red count is the tab's
    assert.equal(await p.ev("document.querySelector('.pagebar .tt .n.q').textContent"), '9');

    // Threads, then Inbox again
    await p.click('#th-tabs [role="tab"][data-tab="threads"]');
    await soon(`location.hash.endsWith('th=open') && document.getElementById('th-inbox').hidden && ${TAB('threads')}.getAttribute('aria-selected') === 'true'`, 'Threads: th=open, #th-inbox hidden');
    await p.click('#th-tabs [role="tab"][data-tab="inbox"]');
    await soon(`location.hash.endsWith('th=inbox') && ${SEEN('#th-inbox')} && ${TAB('inbox')}.getAttribute('aria-selected') === 'true'`, 'Inbox: th=inbox, #th-inbox shown');

    // a reload of #goals?th=inbox: Goals, the panel on Inbox
    await p.ev("location.hash = '#goals?th=inbox'");
    await soon(ON_PAGE('goals'), 'Goals');
    await reload();
    await soon(`location.hash === '#goals?th=inbox' && ${ON_PAGE('goals')} && ${AT_REST} && ${TAB('inbox')}?.getAttribute('aria-selected') === 'true' && ${SEEN('#th-inbox')}`, 'Goals with the panel on Inbox, after a reload');

    // on the shell: no no-shell around it
    assert.equal(await p.ev("!document.getElementById('th-inbox').closest('.no-shell')"), true, '#th-inbox is not inside .no-shell');

    // × hides it; with the panel closed, no pin for Q and nothing sideways on any page
    await p.click('#th-close');
    await soon(`!${IS_OPEN} && document.getElementById('th-inbox').hidden`, 'closed: #th-inbox hidden');
    for (const pg of ['overview', 'goals']) {
      await p.ev(`location.hash = '#${pg}'`);
      await soon(`${ON_PAGE(pg)} && !${IS_OPEN}`, `${pg}, the panel closed`);
      await p.ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
      assert.equal(await p.ev(`!!document.querySelector('[data-tl-pin="${Q}"]')`), false, `${pg}: no pin for Q`);
      // the window's width less a classic scrollbar's (a page taller than the window has one): clientWidth
      const w = await p.ev('[document.documentElement.scrollWidth, document.documentElement.clientWidth, innerWidth]');
      assert.equal(w[0], w[1], `${pg}: nothing sideways (scrollWidth, clientWidth, innerWidth): ${JSON.stringify(w)}`);
    }
  });

  // AC2 (done-when 2)
  await t.test('the nav and the roads', async () => {
    assert.equal(await p.ev("!!document.querySelector('.side nav a[href=\"#inbox\"]')"), false, 'no Inbox in the nav');
    assert.deepEqual(await p.ev("[...document.querySelectorAll('.side nav.nav[data-group=\"project\"] a .nl')].map((a) => a.textContent.trim())"), ['Overview', 'Goals', 'Progress', 'Board', 'Library']);
    assert.equal(await p.ev("SHELL_ROUTES.pages.includes('inbox')"), false, 'SHELL_ROUTES.pages has no inbox');

    // an open question's #q/ link on Board (the test draws the anchor: the routing is the page's)
    await p.ev("location.hash = '#board'");
    await soon(`location.hash === '#board' && ${ON_PAGE('board')} && !${IS_OPEN}`, 'Board, the panel closed');
    const q2 = fx.q.q2;
    await p.ev(`(() => { const a = document.createElement('a'); a.id = 'probe-q'; a.href = '#q/${q2}'; a.textContent = 'the probe'; document.querySelector('main.page > section[data-page="board"]').prepend(a); })()`);
    let n = await len();
    await p.click('#probe-q');
    await soon(`location.hash === '#board?th=inbox' && ${ON_PAGE('board')} && ${ON_INBOX} && ${IN_BODY(`#q-${q2}`)}`, 'Board, the panel on Inbox, the card in view in #th-body');
    assert.equal(await len(), n + 1, 'the q/ entry replaced: one entry');
    assert.equal(await p.ev("document.body.classList.contains('peek-open')"), false, 'no peek');
    await back();
    await soon(`location.hash === '#board' && ${ON_PAGE('board')} && !${IS_OPEN}`, 'Back: #board, the panel closed');

    // a settled question's #q/: its read-only peek
    for (const id of [fx.answered, fx.defaulted, fx.withdrawn]) {
      await p.ev(`location.hash = '#q/${id}'`);
      await soon(`DRAWER.id === ${JSON.stringify(id)} && !document.getElementById('drawer').hidden && !!document.querySelector('#drawer-body section.attrs')`, `${id}: its peek`);
      assert.equal(await p.ev("[...document.querySelectorAll('#drawer button')].some((b) => /^Answer/.test(b.textContent.trim()))"), false, `${id}: no Answer in the peek`);
      await p.ev("location.hash = '#board'");
      await soon("location.hash === '#board' && !document.body.classList.contains('peek-open')", 'back on Board');
    }

    // an Inbox link inside a peek: the lesson's, over Loop; the peek stays, the panel opens on Inbox beside it
    await p.ev("location.hash = '#loop'");
    await soon(ON_PAGE('loop'), 'Loop');
    await p.ev(`location.hash = '#lesson/${fx.L1}'`);
    await soon(`DRAWER.id === ${JSON.stringify(fx.L1)} && !!document.querySelector('#drawer-body a[href="#inbox"]') && getComputedStyle(document.getElementById('drawer')).transform === 'none'`, "the lesson's peek at rest, its Inbox link");
    // the peek's own read in, and the link still: the peek draws first without it, then again taller with it, the
    // link moving down (a click on where it was lands on nothing)
    await soon(`PEEKS.has(peekKey('lesson', ${JSON.stringify(fx.L1)})) && ${STEADY('#drawer-body a[href="#inbox"]')}`, "the lesson's peek drawn with its read, the link still");
    const lessonHash = await p.ev('location.hash');
    await p.click('#drawer-body a[href="#inbox"]');
    await soon(`history.state?.page === '#loop?th=inbox' && ${ON_INBOX} && !document.getElementById('drawer').hidden`, 'the peek open, the panel on Inbox under it');
    assert.equal(await p.ev('location.hash'), lessonHash, 'the peek\'s head kept: no #inbox hop');
    assert.equal(await p.ev(ON_PAGE('loop')), true, 'still Loop');
    await p.click('#th-close');
    await soon(`!${IS_OPEN}`, 'the panel closed');

    // the Loop's "waiting for you in the Inbox": a modified click is the browser's (no preventDefault, no panel);
    // a plain one opens the tab over Loop
    await p.ev("location.hash = '#loop?lt=orient'");
    await soon(`location.hash === '#loop?lt=orient' && ${ON_PAGE('loop')} && !document.body.classList.contains('peek-open') && !${IS_OPEN} && !!document.querySelector('#knowledge a[href="#inbox"]')?.getClientRects().length`, "Orient, the Loop's Inbox link");
    const modified = await p.ev(`(() => { const a = document.querySelector('#knowledge a[href="#inbox"]'), seen = [];
      // after the page's handlers (window, bubbling): what they did, then the default stopped so nothing navigates
      const look = (e) => { seen.push(e.defaultPrevented); e.preventDefault(); };
      addEventListener('click', look);
      for (const k of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, [k]: true }));
      removeEventListener('click', look);
      // (a Shift+click is also the thread layer's: any draft it began is dropped)
      if (TL.draft) tlClose();
      return { seen, th: TH.th, at: INBOX_AT, hash: location.hash }; })()`);
    assert.deepEqual(modified, { seen: [false, false, false, false], th: null, at: null, hash: '#loop?lt=orient' }, 'a modified click: not prevented, no panel');
    await p.ev('new Promise((r) => setTimeout(() => r(true), 300))');
    assert.equal(await p.ev(IS_OPEN), false, 'still closed');
    await soon(STEADY('#knowledge a[href="#inbox"]'), "the Loop's Inbox link still");
    await p.click('#knowledge a[href="#inbox"]');
    await soon(`location.hash === '#loop?lt=orient&th=inbox' && ${ON_PAGE('loop')} && ${ON_INBOX}`, "the Loop's link: the panel on Inbox over Loop");
    await p.click('#th-close');
    await soon(`!${IS_OPEN}`, 'the panel closed');
    await p.ev("location.hash = '#overview'");
    await soon(`location.hash === '#overview' && ${ON_PAGE('overview')} && !document.body.classList.contains('peek-open') && !${IS_OPEN}`, 'Overview');

    // old #inbox and #questions, by a hash change from Overview: replaced by #overview?th=inbox; Back, Overview
    for (const old of ['#inbox', '#questions']) {
      // (a fresh #overview entry each time: a push after Back drops the entry ahead, so history.length wouldn't grow)
      if (old !== '#inbox') {
        await p.ev("location.hash = '#goals'");
        await soon(`location.hash === '#goals' && ${ON_PAGE('goals')} && !${IS_OPEN}`, 'Goals');
        await p.ev("location.hash = '#overview'");
        await soon(`location.hash === '#overview' && ${ON_PAGE('overview')} && !${IS_OPEN}`, 'Overview');
      }
      n = await len();
      await p.ev(`location.hash = '${old}'`);
      await soon(`location.hash === '#overview?th=inbox' && ${ON_INBOX}`, `${old}: #overview?th=inbox`);
      assert.equal(await len(), n + 1, `${old}: one entry, replaced`);
      await back();
      await soon(`location.hash === '#overview' && ${ON_PAGE('overview')} && !${IS_OPEN}`, `${old}: Back lands on Overview, the panel closed`);
    }
    // both are redirects, read from the table inside the shell-routes block, after devteam-shell-js
    assert.deepEqual(await p.ev("[SHELL_ROUTES.redirects.inbox, SHELL_ROUTES.redirects.questions]"), ['overview?th=inbox', 'overview?th=inbox']);
    const file = fs.readFileSync(new URL('../docs/devteam/dashboard/index.html', import.meta.url), 'utf8');
    const shellEnd = file.indexOf('/* devteam-shell-js end */'), start = file.indexOf('/* shell-routes start */'), end = file.indexOf('/* shell-routes end */');
    assert.ok(shellEnd > 0 && start > shellEnd && end > start, 'the shell-routes block, after devteam-shell-js');
    const block = file.slice(start, end);
    assert.match(block, /redirects: \{[^}]*\binbox: 'overview\?th=inbox'/, 'inbox in the block\'s redirects');
    assert.match(block, /redirects: \{[^}]*\bquestions: 'overview\?th=inbox'/, 'questions in the block\'s redirects');

    // a cold load of an open question's #q/ in a new tab, /api/data held back: nothing thrown, then Overview
    // with the panel on Inbox and the card in #th-body's box
    const q1 = await chrome.newPage();
    later(() => q1.close());
    await q1.send('Page.enable');
    await q1.send('Runtime.enable');
    await q1.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await q1.send('Page.addScriptToEvaluateOnNewDocument', { source: `${paneInit(paneMenu())};(() => {
      window.__thrown = [];
      addEventListener('error', (e) => window.__thrown.push(String(e.error?.stack || e.message)));
      addEventListener('unhandledrejection', (e) => window.__thrown.push(String(e.reason?.stack || e.reason)));
      const f = window.fetch; let held = false;
      window.fetch = async (u, o) => { if (!held && String(u && u.url ? u.url : u).startsWith('/api/data')) { held = true; await new Promise((r) => setTimeout(r, 1500)); } return f(u, o); };
    })()` });
    await q1.send('Page.navigate', { url: `http://127.0.0.1:${port}/#q/${fx.q.q3}` });
    const soon1 = soonIn(q1, 30000);
    await soon1(`location.hash === '#overview?th=inbox' && ${ON_INBOX} && ${IN_BODY(`#q-${fx.q.q3}`)}`, 'cold: #overview?th=inbox, the card in view in #th-body');
    assert.deepEqual(await q1.ev('window.__thrown'), [], 'nothing thrown');
  });

  // AC3, first part (done-when 3)
  await t.test('th=inbox', async () => {
    await p.ev(`location.hash = '#board?goal=${fx.goal}&th=inbox'`);
    await soon(`${ON_PAGE('board')} && ${ON_INBOX}`, 'Board with the panel on Inbox');
    const h = await p.ev('location.hash');
    assert.ok(h.startsWith('#board?') && new URLSearchParams(h.split('?')[1]).get('goal') === fx.goal && new URLSearchParams(h.split('?')[1]).get('th') === 'inbox', `goal and th kept: ${h}`);
    assert.deepEqual(await p.ev("Object.keys(SHELL_ROUTES.redirects).filter((k) => k.endsWith('?th=inbox'))"), [], 'no redirect key ends ?th=inbox');
    await p.click('#th-close');
    await soon(`!${IS_OPEN}`, 'the panel closed');

    // th=inbox with an in-panel t (S has no subject) is rewritten to th=open, so S's card shows on Threads (spec §2.3,
    // §4): by a hash change from another page, and cold in a new tab
    const { S } = fx;
    const S_SHOWN = `${AT_REST} && ${TAB('threads')}?.getAttribute('aria-selected') === 'true' && document.getElementById('th-inbox').hidden && TL.open === '${S}' && ${SEEN('#th-card-slot .tl-card')}`;
    await p.ev("location.hash = '#goals'");
    await soon(`location.hash === '#goals' && ${ON_PAGE('goals')} && !${IS_OPEN}`, 'Goals, the panel closed');
    await p.ev(`location.hash = '#overview?th=inbox&t=${S}'`);
    await soon(`location.hash === '#overview?th=open&t=${S}' && ${ON_PAGE('overview')} && ${S_SHOWN}`, "a hash change to th=inbox&t=S: th=open, S's card on Threads");
    await p.click('#th-close');
    await soon(`!${IS_OPEN}`, 'the panel closed');
    const c = await chrome.newPage();
    later(() => c.close());
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: paneInit(paneMenu()) });
    await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/#overview?th=inbox&t=${S}` });
    await soonIn(c, 30000)(`location.hash === '#overview?th=open&t=${S}' && ${ON_PAGE('overview')} && ${S_SHOWN}`, "cold th=inbox&t=S: th=open, S's card on Threads");
    await p.send('Page.bringToFront');
  });

  // AC3, second part, and AC4 (done-when 3, 4)
  await t.test('a thread on a question', async () => {
    const { Q, P, G } = fx, q1 = fx.q.q1, q2 = fx.q.q2;
    const CARD = "document.getElementById('tl-card')";
    const PIN = (id) => `document.querySelector('#tl-pins [data-tl-pin="${id}"]')`;
    const SHOWN = (e) => `(() => { const e = ${e}; if (!e || e.hidden) return false; const c = getComputedStyle(e); return c.display !== 'none' && c.visibility !== 'hidden' && e.getClientRects().length > 0; })()`;
    // the pin's centre inside an element's box (±1px)
    const PIN_ON = (id, sel) => `(() => { const b = ${PIN(id)}, c = document.querySelector(${JSON.stringify(sel)}); if (!b || !c || !${SHOWN(PIN(id))}) return false;
      const r = b.getBoundingClientRect(), k = c.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      return x >= k.left - 1 && x <= k.right + 1 && y >= k.top - 1 && y <= k.bottom + 1; })()`;
    // the floating card open on a thread, shown, beside the panel: its right edge at most the panel's left, its top in the window
    const FLOAT = (id) => `(TL.open === '${id}' && ${CARD}.parentElement?.id === 'tl' && ${SHOWN(CARD)})`;
    const BESIDE = `(() => { const c = ${CARD}.getBoundingClientRect(), l = document.getElementById('threads').getBoundingClientRect().left; return c.right <= l + 0.5 && c.top >= 0 && c.top <= innerHeight; })()`;
    const ROW = (id) => `document.querySelector('#tl-list [data-tl-open="${id}"]')`;
    const thread = (id) => `TL.threads.find((x) => x.id === '${id}')`;
    // the tab in front (an earlier subtest's cold tab took it): a tab behind runs no animation frames
    await p.send('Page.bringToFront');

    // on Overview with the panel on Inbox: Q's home is q1's card in #th-inbox, so Q floats; P's is the Inbox too; G's isn't
    await p.ev("location.hash = '#overview?th=inbox'");
    await soon(`location.hash === '#overview?th=inbox' && ${ON_PAGE('overview')} && ${ON_INBOX} && !!document.getElementById('q-${q1}')`, 'Overview, the panel on Inbox');
    assert.equal(await p.ev(`!!tlHome({ kind: 'item', ref: 'question:${q1}' })?.closest('#th-inbox')`), true, 'tlHome: inside #th-inbox');
    assert.equal(await p.ev(`tlHome({ kind: 'item', ref: 'question:${q1}' }) === document.getElementById('q-${q1}')`), true, "tlHome: q1's open card");
    assert.deepEqual(await p.ev(`[${thread(Q)}, ${thread(P)}, ${thread(G)}].map((t) => [tlInboxHome(t), tlInPanel(t)])`), [[true, false], [true, false], [false, false]], 'tlInboxHome and tlInPanel for Q, P and G');

    // Q's pin on q1's card, over the panel
    await p.ev(`document.getElementById('q-${q1}').scrollIntoView({ block: 'center' }); void 0`);
    await soon(PIN_ON(Q, `#q-${q1}`), "Q's pin on q1's card");
    const top = await p.ev(`(() => { const r = ${PIN(Q)}.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('[data-tl-pin]') === ${PIN(Q)}; })()`);
    assert.equal(top, true, 'the pin is the element at its centre: above the panel');
    // a tall page scrolled: the pin stays on the card
    await p.ev("(() => { const d = document.createElement('div'); d.id = 'probe-tall'; d.style.height = '3000px'; document.querySelector('main.page > section[data-page=\"overview\"]').append(d); window.scrollTo(0, 400); })()");
    await p.ev(FRAMES);
    assert.equal(await p.ev('scrollY'), 400, 'the page scrolled to 400');
    assert.equal(await p.ev(PIN_ON(Q, `#q-${q1}`)), true, `the pin on the card after a page scroll: ${JSON.stringify(await p.ev(`(() => { const b = ${PIN(Q)}; return b && { cls: b.className, pos: getComputedStyle(b).position, pin: b.getBoundingClientRect().toJSON(), card: document.getElementById('q-${q1}').getBoundingClientRect().toJSON(), body: document.getElementById('th-body').getBoundingClientRect().toJSON(), sy: scrollY }; })()`))}`);
    // #th-body scrolled by 100: the pin follows the card
    const was = await p.ev("document.getElementById('th-body').scrollTop");
    await p.ev("document.getElementById('th-body').scrollTop += 100; void 0");
    assert.equal(await p.ev("document.getElementById('th-body').scrollTop"), was + 100, '#th-body scrolled by 100');
    await p.ev(FRAMES);
    assert.equal(await p.ev(PIN_ON(Q, `#q-${q1}`)), true, 'the pin on the card after #th-body scrolled');
    // q1's card scrolled out of #th-body's box: no pin shown
    const out = await p.ev(`(() => { const b = document.getElementById('th-body'), c = document.getElementById('q-${q1}');
      const off = () => { const k = c.getBoundingClientRect(), v = b.getBoundingClientRect(); return k.bottom <= v.top || k.top >= v.bottom; };
      b.scrollTop += c.getBoundingClientRect().bottom - b.getBoundingClientRect().top + 20;
      if (!off()) b.scrollTop = 0;
      if (!off()) b.scrollTop = b.scrollHeight;
      return off(); })()`);
    assert.equal(out, true, "q1's card scrolled out of #th-body's box");
    await p.ev(FRAMES);
    assert.equal(await p.ev(SHOWN(PIN(Q))), false, 'no pin once the card is out of the box');
    await p.ev("document.getElementById('probe-tall').remove(); window.scrollTo(0, 0); void 0");
    await p.ev(`document.getElementById('q-${q1}').scrollIntoView({ block: 'center' }); void 0`);
    await soon(PIN_ON(Q, `#q-${q1}`), 'the pin back on the card');

    // the pin opens Q's card beside the panel
    await p.click(`#tl-pins [data-tl-pin="${Q}"]`);
    await soon(`${FLOAT(Q)} && ${BESIDE}`, "Q's card open, beside the panel");
    // at 1440: its right edge 10px left of the panel's (spec §2.6), within 1px
    const gap = await p.ev(`document.getElementById('threads').getBoundingClientRect().left - 10 - ${CARD}.getBoundingClientRect().right`);
    assert.ok(Math.abs(gap) <= 1, `the card's right edge is the panel's left less 10px (off by ${gap})`);
    await p.click('#tl-card [data-tl-close]');
    await soon(`${CARD}.hidden`, 'the card closed');

    // from #goals?th=open, Q's row: the panel on Inbox, the card in view, the floating card beside it
    await p.ev("location.hash = '#goals?th=open'");
    await soon(`location.hash === '#goals?th=open' && ${ON_PAGE('goals')} && ${AT_REST} && !!${ROW(Q)}`, "Goals, the panel on Threads, Q's row");
    await soon(STEADY(`#tl-list [data-tl-open="${Q}"]`), 'the row at rest');
    await p.click(`#tl-list [data-tl-open="${Q}"]`);
    await soon(`location.hash === '#goals?th=inbox&t=${Q}' && ${ON_PAGE('goals')} && ${ON_INBOX} && ${IN_BODY(`#q-${q1}`)} && ${FLOAT(Q)} && ${BESIDE}`, "Q's row: #goals?th=inbox&t=Q, the card in view, Q's card beside it");
    await p.click('#tl-card [data-tl-close]');
    await soon(`${CARD}.hidden && location.hash === '#goals?th=inbox'`, 'closed: t taken away');

    // P, an old Inbox spot: listed under Threads as "Inbox"; its row opens the Inbox tab and its card, no pin, no rewrite to open
    await p.click('#th-tabs [role="tab"][data-tab="threads"]');
    await soon(`location.hash === '#goals?th=open' && !!${ROW(P)}`, "Threads, P's row");
    assert.equal(await p.ev(`${ROW(P)}.querySelector('.th-where').textContent`), 'Inbox', "P's subject line");
    await soon(STEADY(`#tl-list [data-tl-open="${P}"]`), "P's row at rest");
    await p.click(`#tl-list [data-tl-open="${P}"]`);
    await soon(`location.hash === '#goals?th=inbox&t=${P}' && ${ON_INBOX} && ${FLOAT(P)} && ${BESIDE}`, "P's row: #goals?th=inbox&t=P, its card beside the panel");
    // a read of the threads and a redraw later: still th=inbox, still no pin
    const seq = await p.ev('TL.have');
    await soon(`TL.have > ${seq}`, 'another read of the threads');
    await p.ev(FRAMES);
    assert.equal(await p.ev('location.hash'), `#goals?th=inbox&t=${P}`, 'P stays on th=inbox');
    assert.equal(await p.ev(`!!document.querySelector('[data-tl-pin="${P}"]')`), false, 'P draws no pin');
    await p.click('#tl-card [data-tl-close]');
    await soon(`${CARD}.hidden && location.hash === '#goals?th=inbox'`, "P's card closed");

    // Shift held over the tab bar: no pin; a Shift+click on q2's card in the Inbox tab starts a draft beside it, sent a thread on q2
    const tab = await p.at('#th-tabs [role="tab"][data-tab="inbox"]');
    await p.hold('Shift', true);
    await p.move(tab.x, tab.y, 8);
    await p.move(tab.x + 3, tab.y + 1, 8);
    await p.ev(FRAMES);
    assert.equal(await p.ev("document.getElementById('tl-cursor').hidden"), true, 'no pin over the tab bar');
    await p.ev(`document.getElementById('q-${q2}').scrollIntoView({ block: 'center' }); void 0`);
    await p.ev(FRAMES);
    const c2 = await p.ev(`(() => { const r = document.getElementById('q-${q2}').getBoundingClientRect(); return { x: Math.round(r.left + 40), y: Math.round(r.top + 20) }; })()`);
    await p.move(c2.x, c2.y, 8);
    await p.move(c2.x + 2, c2.y + 2, 8);
    await soon("!document.getElementById('tl-cursor').hidden", 'the pin over q2\'s card');
    await p.clickAt(c2.x + 2, c2.y + 2, 8);
    await p.hold('Shift', false);
    await soon(`TL.draft?.subject?.ref === 'question:${q2}' && ${CARD}.parentElement?.id === 'tl' && ${SHOWN(CARD)} && ${BESIDE} && document.activeElement?.id === 'tl-c-text'`, 'a draft beside q2\'s card');
    await p.type('hello');
    await p.key('Enter', 8);
    const N = await soon(`TL.threads.find((x) => x.subject?.ref === 'question:${q2}' && !String(x.id).startsWith('pending-') && !x.pending)?.id`, 'the new thread read');
    await p.click('#th-tabs [role="tab"][data-tab="threads"]');
    await soon(`!!${ROW(N)} && ${thread(N)}.subject.kind === 'item'`, 'listed, its subject question:<q2>');
    await soon(`${CARD}.hidden || TL.open === '${N}'`, 'the card');
    if (await p.ev(`!${CARD}.hidden`)) { await p.click('#tl-card [data-tl-close]'); await soon(`${CARD}.hidden`, 'closed'); }

    // a cold #talk/<Q> in a new tab, /api/data held back: nothing thrown; #overview?th=inbox&t=Q, the card in view, Q's card beside it
    const c = await chrome.newPage();
    later(() => c.close());
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `${paneInit(paneMenu())};(() => {
      window.__thrown = [];
      addEventListener('error', (e) => window.__thrown.push(String(e.error?.stack || e.message)));
      addEventListener('unhandledrejection', (e) => window.__thrown.push(String(e.reason?.stack || e.reason)));
      const f = window.fetch; let held = false;
      window.fetch = async (u, o) => { if (!held && String(u && u.url ? u.url : u).startsWith('/api/data')) { held = true; await new Promise((r) => setTimeout(r, 1500)); } return f(u, o); };
    })()` });
    await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/#talk/${Q}` });
    const soonC = soonIn(c, 30000);
    await soonC(`history.state?.page === '#overview?th=inbox&t=${Q}' && ${ON_INBOX} && ${IN_BODY(`#q-${q1}`)} && ${FLOAT(Q)} && ${BESIDE}`, 'cold #talk/Q: #overview?th=inbox&t=Q, the card in view, Q\'s card beside it');
    assert.deepEqual(await c.ev('window.__thrown'), [], 'nothing thrown');
    await p.send('Page.bringToFront');

    // at 720x800: Q's row keeps the panel open on Inbox, and Q's card shows over it
    await size(720, 800);
    await soon('innerWidth === 720', 'at 720');
    await p.ev("location.hash = '#goals?th=open'");
    await soon(`location.hash === '#goals?th=open' && ${AT_REST} && !!${ROW(Q)}`, "at 720, Threads, Q's row");
    await soon(STEADY(`#tl-list [data-tl-open="${Q}"]`), 'the row at rest');
    await p.click(`#tl-list [data-tl-open="${Q}"]`);
    await soon(`location.hash === '#goals?th=inbox&t=${Q}' && ${ON_INBOX} && ${FLOAT(Q)} && (() => { const r = ${CARD}.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('#tl-card') === ${CARD}; })()`, "at 720: the panel on Inbox, Q's card shown over it");
    await p.click('#tl-card [data-tl-close]');
    await soon(`${CARD}.hidden`, 'closed');

    // at 720x800 on Goals with the panel on Inbox: G's pin stays under the panel
    await p.click('#th-close');
    await soon(`!${IS_OPEN} && location.hash === '#goals'`, 'Goals, the panel closed');
    await p.ev(`document.querySelector('#goals-list [data-subject="goal:${fx.goal}"]').scrollIntoView({ block: 'center' }); void 0`);
    await soon(SHOWN(PIN(G)), "G's pin");
    await p.ev(FRAMES);
    const g = await p.ev(`(() => { const r = ${PIN(G)}.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    assert.ok(g.x > 0 && g.x < 720 && g.y > 0 && g.y < 800, `G's pin in the window: ${JSON.stringify(g)}`);
    await p.ev("location.hash = '#goals?th=inbox'");
    await soon(`${ON_PAGE('goals')} && ${ON_INBOX}`, 'at 720, Goals with the panel on Inbox');
    assert.equal(await p.ev(`!!document.elementFromPoint(${g.x}, ${g.y})?.closest('#threads')`), true, "the element at G's pin's centre is in #threads");
    await p.click('#th-close');
    await soon(`!${IS_OPEN}`, 'the panel closed');
    await size(1440, 900);
    await soon('innerWidth === 1440', 'at 1440');
  });

  // AC7 (done-when 7), each item of the mock's Inbox inventory that this fixture draws, asserted inside #th-inbox: q1 is the
  // decision (recommendation, sureness, effect, default, Next time, Why you), q2 a plain one, q3 the owner-action, q4 to q6 the
  // secrets, r the review. Not drawn by this fixture: "changed since asked" (test/dashboard-answers.test.mjs), a refused
  // answer's reason (test/dashboard.test.mjs, test/dashboard-answers.test.mjs), Shift+Enter (test/dashboard.test.mjs,
  // test/dashboard-answers.test.mjs), the owner-action card's per-record buttons (test/dashboard-owner-action.test.mjs), "Don't use
  // this sensor" (a sensor's question), the review's changed-since-asked error (a page changed after the ask).
  // Runs before "every control from the panel", which answers the questions it reads.
  await t.test('the inventory, in the panel', async () => {
    const { q1, q2, q3, q4, q5, q6 } = fx.q;
    const IN = (sel) => `#th-inbox ${sel}`;
    const card = (id) => IN(`[data-qcard="${id}"]`);
    const text = (sel) => p.ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
    const texts = (sel) => p.ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => e.textContent.trim())`);
    const has = (sel) => p.ev(`!!document.querySelector(${JSON.stringify(sel)})`);
    await p.send('Page.bringToFront');
    await p.ev("location.hash = '#overview?th=inbox'");
    await soon(`location.hash === '#overview?th=inbox' && ${ON_INBOX} && !!document.getElementById('q-${q1}') && !!document.getElementById('answered-sum')`, 'Overview, the panel open on Inbox, at rest');
    await soon(`/Answered \\(3\\)/.test(document.getElementById('answered-sum').textContent)`, 'the Answered summary');

    // the decision card: head and its ⋯ menu (ID, asked, kind), why chips, choices with Recommended / sure / effect
    assert.equal(await has(card(q1) + ' .card-head details.menu summary'), true, "q1's ⋯ menu");
    await p.ev(`document.querySelector(${JSON.stringify(card(q1) + ' details.menu summary')}).scrollIntoView({ block: 'center' }); void 0`);
    await soon(STEADY(card(q1) + ' details.menu summary'), 'the menu button at rest');
    await p.click(card(q1) + ' details.menu summary');
    await soon(`document.querySelector(${JSON.stringify(card(q1) + ' details.menu')}).open`, "q1's menu open");
    const kv = await p.ev(`[...document.querySelectorAll(${JSON.stringify(card(q1) + ' details.menu .kv > *')})].map((e) => e.textContent)`);
    assert.deepEqual(kv.filter((x, i) => i % 2 === 0), ['ID', 'Asked', 'Kind', 'Order', 'Rated'], `the menu's rows: ${JSON.stringify(kv)}`);
    assert.equal(kv[1], q1, 'the ID');
    assert.equal(await has(card(q1) + ' details.menu [data-copy]'), true, 'Copy ID');
    await p.click(card(q1) + ' details.menu summary');
    await soon(`!document.querySelector(${JSON.stringify(card(q1) + ' details.menu')}).open`, "q1's menu closed again");
    assert.ok((await texts(card(q1) + ' .why span')).some((c) => /Launch checkout/.test(c)), 'the why-ranked chips');
    assert.match(await text(card(q1) + ' .card-head .badge'), /Decision/);
    assert.match(await text(card(q1) + ' .tag'), /^Recommended · 80% sure$/, 'Recommended with the sure percentage');
    assert.equal(await has(card(q1) + ' .choice.rec input[value="Stripe"]'), true, 'the recommended choice marked');
    assert.equal(await text(card(q1) + ' .choice .e'), 'Buyers pay with the cards they already use.', "a choice's effect for users");
    assert.deepEqual(await p.ev(`[...document.querySelectorAll(${JSON.stringify(card(q1) + ' input[data-pick]')})].map((e) => e.value)`), ['Stripe', 'Adyen', '__other'], 'the choices and Something else');
    // the note box, the standing-rule box, Next time, the default and deadline line, Why you, Answer
    assert.match(await p.ev(`document.querySelector(${JSON.stringify(card(q1) + ' textarea[data-q]')}).placeholder`), /Add a note/);
    assert.match(await text(card(q1) + ' label.rulebox'), /Keep this answer as a standing rule for the whole project/);
    assert.equal(await has(card(q1) + ` input[data-rulebox="${q1}"][type="checkbox"]`), true);
    assert.match(await text(card(q1) + ' fieldset.next legend'), /^Next time, for decisions like this \(.+\), the supervisor…$/);
    assert.deepEqual(await texts(card(q1) + ' fieldset.next label'), ['asks you first', 'asks, with a default (now)', 'decides, then tells you'], 'the rungs, the current one marked');
    assert.match(await text(card(q1) + ' p.meta'), /^If you don’t answer by .+, the supervisor goes with: Stripe$/, 'the default and its deadline');
    assert.equal(await text(card(q1) + ` [data-answer="${q1}"]`), 'Answer');
    assert.match(await text(card(q1) + ' .meta:last-child'), /^Why you: .+\.$/, 'Why you');
    // a plain decision: Answer, its note box and rule box
    assert.equal(await text(card(q2) + ` [data-answer="${q2}"]`), 'Answer');
    assert.equal(await has(card(q2) + ` textarea[data-q="${q2}"]`), true);
    assert.equal(await has(card(q2) + ` input[data-rulebox="${q2}"]`), true);
    assert.equal(await has(card(q2) + ' .tag'), false, 'no Recommended mark where none was recommended');

    // the owner-action: Done and Can't right now as the answers, a note, Send, and no standing-rule box
    assert.deepEqual(await texts(card(q3) + ' .choice b'), ['Done', 'Can’t right now']);
    assert.equal(await text(card(q3) + ` [data-answer="${q3}"]`), 'Send');
    assert.equal(await has(card(q3) + ` textarea[data-q="${q3}"]`), true);
    assert.equal(await has(card(q3) + ' input[data-rulebox]'), false, 'an owner-action has no standing-rule box');

    // the secrets forms: Post, Reply, Can't right now (no sensor here, so no "Don't use this sensor")
    for (const [id, n] of [[q4, 4], [q5, 5], [q6, 6]]) {
      assert.equal(await has(card(id) + ` .secrets [data-secret="${id}:KEY_${n}"]`), true, `KEY_${n}'s paste box`);
      assert.deepEqual(await texts(card(id) + ' .row-inline button'), ['Post', 'Reply', 'Can’t right now'], `${id}'s buttons`);
      assert.equal(await has(card(id) + ` [data-reply="${id}"]`) && await has(card(id) + ` [data-cant="${id}"]`) && await has(card(id) + ` [data-post-secrets="${id}"]`), true);
      assert.equal(await has(card(id) + ' [data-dontuse]'), false);
      assert.equal(await has(card(id) + ` textarea[data-q="${id}"]`), true, 'the reply box');
    }

    // the review card: Open the review, Send it back (with its reason box)
    assert.equal(await text(card(fx.r) + ` [data-open-review="${fx.r}"]`), 'Open the review');
    assert.equal(await text(card(fx.r) + ` [data-decline-open="${fx.r}"]`), 'Send it back');
    assert.match(await p.ev(`document.querySelector(${JSON.stringify(card(fx.r) + ` [data-decline-form="${fx.r}"] textarea`)}).placeholder`), /What should change\?/, 'the reason box');
    assert.equal(await text(card(fx.r) + ` [data-decline="${fx.r}"]`), 'Send it back');

    // the lesson cards: Keep it, Retire it, the note box, the technical wording
    for (const L of [fx.L1, fx.L2]) {
      assert.equal(await text(IN(`[data-know="${L}"][data-status="accepted"]`)), 'Keep it');
      assert.equal(await text(IN(`[data-know="${L}"][data-status="retired"]`)), 'Retire it');
      assert.equal(await has(IN(`textarea[data-know-note="${L}"]`)), true, `${L}'s note box`);
    }
    assert.equal(await has(IN('details[data-technical] summary')), true);
    assert.equal(await text(IN('details[data-technical] summary')), 'The technical wording');

    // the terminal's card: one button per numbered option, then the usage limit's line
    const menu = paneMenu();
    await soon(`!!document.querySelector('#ask-inbox [data-ask="${menu.digest}"]')`, "the terminal's card");
    assert.deepEqual(await texts(IN(`#ask-inbox [data-ask="${menu.digest}"] [data-ask-option]`)), menu.options.map((o) => `${o.n}. ${o.label}`), 'a button per numbered option');
    assert.match(await text(IN('#ask-inbox .ask-q')), /Do you want to proceed\?/);
    const limit = { kind: 'limit', digest: 'e5'.repeat(20), text: "You've hit your usage limit. Try again in 2h 5m." };
    await p.ev(`window.__pane = ${JSON.stringify(limit)}; void 0`);
    await soon(`!!document.querySelector('#ask-inbox [data-ask-kind="limit"]')`, "the usage limit's card");
    const lim = await text(IN('#ask-inbox [data-ask-kind="limit"]'));
    assert.match(lim, /The supervisor is stopped at a usage limit/);
    assert.match(lim, /You've hit your usage limit\. Try again in 2h 5m\./);
    assert.match(lim, /Nothing to click here\. With account rotation set up/);
    assert.equal(await has(IN('#ask-inbox button')), false, 'a usage limit has no buttons');
    await p.ev(`window.__pane = ${JSON.stringify(menu)}; void 0`);
    await soon(`!!document.querySelector('#ask-inbox [data-ask="${menu.digest}"] [data-ask-option="1"]:not([disabled])')`, 'the menu back, armed');

    // the Answered list: collapsed with its summary, an answered card in it, Overrule on the defaulted one only
    assert.equal(await p.ev("document.getElementById('answered-wrap').open"), false, 'collapsed');
    assert.equal(await p.ev("document.getElementById('th-inbox').contains(document.getElementById('answered-wrap'))"), true);
    assert.equal(await text(IN('#answered-sum')), 'Answered (3)');
    await p.ev(`document.getElementById('answered-sum').scrollIntoView({ block: 'center' }); void 0`);
    await soon(STEADY(IN('#answered-sum')), 'the summary at rest');
    await p.click(IN('#answered-sum'));
    await soon("document.getElementById('answered-wrap').open", 'the Answered list open');
    assert.match(await text(IN(`#answered #a-${fx.answered}`)), /Keep the receipts\?[\s\S]*Yes[\s\S]*answered/, 'an answered card');
    assert.match(await text(IN(`#answered #a-${fx.defaulted}`)), /Which port\?[\s\S]*went with the default/, 'the defaulted card');
    assert.equal(await text(IN(`#answered [data-overrule-send="${fx.defaulted}"]`)), 'Overrule');
    assert.equal(await has(IN(`#answered input[data-overrule="${fx.defaulted}"]`)), true);
    assert.equal(await has(IN(`#answered #a-${fx.answered} [data-overrule-send]`)), false, 'Overrule only on the defaulted one');
    assert.equal(await has(IN(`#answered #a-${fx.withdrawn} [data-overrule-send]`)), false);
    assert.match(await text(IN(`#answered #a-${fx.withdrawn}`)), /withdrawn by the supervisor/);
    await p.click(IN('#answered-sum'));
    await soon("!document.getElementById('answered-wrap').open", 'the Answered list collapsed again');
  });

  // At 900px and below the panel and a peek each take the full width, so the one opened last is on top (the design's
  // Threads sidebar; final-1 F1): a link in the Inbox tab opens its peek, or the viewer, over the panel, and closing it
  // (×, Escape, Back) gives the panel on Inbox as it was. The other way round, a panel opened from a peek is over it.
  await t.test('a peek or the viewer from the Inbox tab, at 900px and below', async () => {
    await p.send('Page.bringToFront');
    const LINK = '#th-inbox a[href^="#observation/"]';
    // the element at a box's centre is inside sel
    const TOP = (sel, box = sel) => `(() => { const b = document.querySelector(${JSON.stringify(box)})?.getBoundingClientRect(); if (!b || !b.width) return false; return !!document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest(${JSON.stringify(sel)}); })()`;
    const PEEK_AT_REST = "(!document.getElementById('drawer').hidden && document.body.classList.contains('peek-open') && getComputedStyle(document.getElementById('drawer')).transform === 'none')";
    const AS_IT_WAS = `location.hash === '#goals?th=inbox' && ${ON_PAGE('goals')} && document.getElementById('drawer').hidden && ${ON_INBOX} && ${TOP('#threads')}`;
    // the lesson card's evidence link, in the Inbox tab: its peek, on top
    const openPeek = async (what) => {
      await soon(`${ON_INBOX} && !!document.querySelector(${JSON.stringify(LINK)})`, `${what}: the lesson's evidence link`);
      await p.ev(`document.querySelector(${JSON.stringify(LINK)}).scrollIntoView({ block: 'center' }); void 0`);
      await soon(STEADY(LINK), `${what}: the link at rest`);
      await p.click(LINK);
      await soon(`location.hash.startsWith('#observation/') && ${PEEK_AT_REST}`, `${what}: the peek open, at rest`);
      assert.equal(await p.ev(TOP('#drawer')), true, `${what}: the peek is on top at its centre, over the panel`);
    };
    for (const [w, h] of [[720, 800], [390, 844]]) {
      await size(w, h);
      await soon(`innerWidth === ${w}`, `at ${w}`);
      await p.ev("location.hash = '#goals?th=inbox'");
      await soon(`location.hash === '#goals?th=inbox' && ${ON_PAGE('goals')} && ${ON_INBOX}`, `at ${w}: Goals, the panel on Inbox`);
      await openPeek(`at ${w}, ×`);
      await soon(STEADY('#drawer-close'), 'the peek\'s × at rest');
      await p.click('#drawer-close');
      await soon(AS_IT_WAS, `at ${w}: × closed the peek, the panel on Inbox`);
      await openPeek(`at ${w}, Escape`);
      await p.key('Escape');
      await soon(AS_IT_WAS, `at ${w}: Escape closed the peek, the panel on Inbox`);
      await openPeek(`at ${w}, Back`);
      await back();
      await soon(AS_IT_WAS, `at ${w}: Back closed the peek, the panel on Inbox`);
    }
    // the viewer, from an #artifact/ link in the Inbox tab (the test draws the anchor: the routing is the page's), at 720
    // (once: a second viewer in one visit is the frame-history quirk dashboard-peek.test.mjs works around)
    await size(720, 800);
    await soon('innerWidth === 720', 'at 720');
    await soon(AS_IT_WAS, 'at 720, the panel on Inbox');
    await p.ev("(() => { const a = document.createElement('a'); a.id = 'probe-art'; a.href = '#artifact/main/inbox-probe'; a.textContent = 'an artifact'; document.getElementById('th-inbox').prepend(a); a.scrollIntoView({ block: 'center' }); })()");
    await soon(STEADY('#probe-art'), 'the artifact link at rest');
    await p.click('#probe-art');
    await soon("location.hash === '#artifact/main/inbox-probe' && !document.getElementById('artifact-view').hidden", 'the viewer open');
    await soon(STEADY('#av-close'), "the viewer's × at rest");
    assert.equal(await p.ev(TOP('#artifact-view')), true, 'the viewer is on top at its centre, over the panel');
    assert.equal(await p.ev(TOP('#av-close')), true, "the viewer's × is on top");
    await p.key('Escape');
    await soon(`document.getElementById('artifact-view').hidden && ${AS_IT_WAS}`, 'Escape closed the viewer, the panel on Inbox');
    await p.ev("document.getElementById('probe-art').remove(); void 0");
    // a panel opened from a peek: over the peek; closed, the peek is on top again
    await p.click('#th-close');
    await soon(`!${IS_OPEN}`, 'the panel closed');
    await p.ev(`location.hash = '#lesson/${fx.L1}'`);
    await soon(`DRAWER.id === ${JSON.stringify(fx.L1)} && ${PEEK_AT_REST} && PEEKS.has(peekKey('lesson', ${JSON.stringify(fx.L1)})) && !!document.querySelector('#drawer-body a[href="#inbox"]')`, "the lesson's peek with its read, its Inbox link");
    await soon(STEADY('#drawer-body a[href="#inbox"]'), 'the link still');
    await p.click('#drawer-body a[href="#inbox"]');
    await soon(`${ON_INBOX} && ${PEEK_AT_REST} && ${TOP('#threads')}`, 'the panel opened from the peek, on top');
    await p.click('#th-close');
    await soon(`!${IS_OPEN} && ${PEEK_AT_REST} && ${TOP('#drawer')}`, 'the panel closed: the peek on top');
    // (left by a page's hash, as the nav and the roads leave theirs: × here walks back through the panel's entries)
    await p.ev("location.hash = '#overview'");
    await soon("location.hash === '#overview' && document.getElementById('drawer').hidden", 'Overview, the peek closed');
    await size(1440, 900);
    await soon('innerWidth === 1440', 'at 1440');
  });

  // AC9 (done-when 9): the artifact viewer, /view/artifact/<slug>, has no Inbox data and no render(): its panel registers
  // the same tabs, the Inbox tab shows hello's count and one line to the dashboard's Inbox; its button opens Threads
  // (ruling m-20261115-230458641-supervisor). A fixture and a tab of its own.
  await t.test('/view/', async () => {
    const F = threadsFixture('inbox-view-tab');
    const dir = path.join(F.old, 'docs/devteam/project/artifacts/viewer-mock');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'artifact.json'), JSON.stringify({ v: 1, title: 'Viewer mock', summary: 'A page to point at', by: 'supervisor', for: [] }));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><body><p id="art">the mock</p></body></html>');
    F.g(['add', '-A', dir], F.old);
    F.g(['commit', '-qm', 'artifact: viewer-mock'], F.old);
    F.g(['push', '-q', 'origin', 'main'], F.old);
    F.sup(['ask', '--question', 'Which way?', '--choices', '[{"label":"Left"},{"label":"Right"}]', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
    const later = cleanup(t);
    later(() => F.done());
    const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
    later(() => dash.stop());
    await until(async () => { try { return (await (await fetch(`http://127.0.0.1:${port}/api/hello`)).json()).inbox === 1; } catch { return false; } }, "hello's inbox");
    const v = await chrome.newPage();
    later(() => v.close());
    await v.send('Page.enable');
    await v.send('Runtime.enable');
    await v.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await v.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__asked = []; { const rf = window.fetch; window.fetch = (u, o) => { window.__asked.push(String(u)); return rf(u, o); }; }" });
    await v.send('Page.navigate', { url: `http://127.0.0.1:${port}/view/artifact/viewer-mock` });
    const vs = soonIn(v, 30000, () => dash.out());
    await vs("document.documentElement.classList.contains('viewer') && typeof TL === 'object' && TL.have > 0 && document.querySelector('#tt-peek .n.q')?.textContent === '1'", 'the viewer, its threads and hello read');

    // the button opens the panel on Threads (kit-89), not Inbox
    await v.click('#tt-peek');
    await vs(`${AT_REST} && document.querySelector('#th-tabs [role="tab"][aria-selected="true"]')?.dataset.tab === 'threads'`, 'the panel open on Threads');
    assert.deepEqual(await v.ev('threadsTabs.list().map((t) => t.id)'), ['inbox', 'threads', 'supervisor', 'shell']);
    await vs("document.querySelector('#th-tabs [data-tab=\"inbox\"] .n')?.textContent === '1'", "the Inbox tab's count is hello's inbox");
    // the tab: one line to the dashboard's Inbox; #th-inbox stays hidden (no data here)
    await v.click('#th-tabs [data-tab="inbox"]');
    await vs(`document.querySelector('#th-tabs [data-tab="inbox"]')?.getAttribute('aria-selected') === 'true' && !!document.querySelector('#th-pane a')`, 'the Inbox tab chosen');
    const pane = await v.ev(`(() => { const as = [...document.querySelectorAll('#th-pane a')]; return { n: as.length, text: as[0]?.textContent, href: as[0]?.getAttribute('href'), cls: as[0]?.className, inbox: !!document.getElementById('th-inbox') && !document.getElementById('th-inbox').hidden && document.getElementById('th-inbox').getClientRects().length > 0 }; })()`);
    assert.deepEqual(pane, { n: 1, text: 'Answer questions on the dashboard.', href: '/#overview?th=inbox', cls: 'linkish', inbox: false });
    assert.equal(await v.ev("document.querySelector('#th-tabs [data-tab=\"inbox\"] .n')?.textContent"), '1', 'the count stays');
    assert.equal(await v.ev("location.pathname + location.hash"), '/view/artifact/viewer-mock', 'no route');
    assert.deepEqual(await v.ev("window.__asked.filter((u) => u.startsWith('/api/data'))"), [], '/api/data never asked');
  });

  // AC5 (done-when 5), last: it answers questions and changes the counts. Each control on its own fixture question,
  // pressed in the panel's Inbox tab; each post's body read by a wrap of the page's fetch (chrome.mjs drops CDP events).
  await t.test('every control from the panel', async () => {
    const { q1, q2, q3, q4, q5, q6 } = fx.q;
    const IN = (sel) => `#th-inbox ${sel}`;
    const PIN = (id) => `document.querySelector('#tl-pins [data-tl-pin="${id}"]')`;
    // a press on what a selector finds once it is shown, enabled, in view and still (a click takes its centre once)
    const press = async (sel, what) => {
      await soon(`${SEEN(sel)} && !document.querySelector(${JSON.stringify(sel)}).disabled`, what);
      await p.ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' }); void 0`);
      await soon(STEADY(sel), `${what}, at rest`);
      await p.click(sel);
    };
    const focusIn = async (sel, what) => {
      await press(sel, what);
      await soon(`document.activeElement === document.querySelector(${JSON.stringify(sel)})`, `${what}, focused`);
    };
    // the body posted to url for a question (or lesson) id
    const posted = (url, id) => soon(`window.__posts.find((x) => x.url === ${JSON.stringify(url)} && x.body?.id === ${JSON.stringify(id)})?.body`, `${url} posted for ${id}`);
    // timed out, it says what the card's error line says
    const gone = (id) => soon(`!document.querySelector(${JSON.stringify(IN(`[data-qcard="${id}"]`))})`, `${id}'s card left the Inbox`)
      .catch(async (e) => assert.fail(`${e.message}; its error line: ${JSON.stringify(await p.ev(`document.getElementById('e-${id}')?.textContent ?? null`))}; its posts: ${JSON.stringify(await p.ev(`window.__posts.filter((x) => x.body?.id === '${id}').map((x) => [x.url, x.status, x.out])`))}`));
    await p.send('Page.bringToFront');
    // at 1440 (a peek opens beside the panel), whatever size an earlier subtest left
    await size(1440, 900);
    await soon('innerWidth === 1440', 'at 1440');
    await p.ev("location.hash = '#overview?th=inbox'");
    await soon(`location.hash === '#overview?th=inbox' && ${ON_INBOX} && !!document.getElementById('q-${q1}')`, 'Overview, the panel on Inbox');
    // (while window.__stale is set, a GET of /api/data is answered with the last one read before it was set: a read begun
    // before an answer, landing after it; window.__staleN counts them, window.__reading the real reads under way)
    await p.ev(`(() => { window.__posts = []; window.__stale = false; window.__staleN = 0; window.__reading = 0; let last = null;
      const f = window.fetch; window.fetch = (u, o) => { const url = String(u && u.url ? u.url : u).split('?')[0];
      if (url === '/api/data' && String(o?.method || 'GET').toUpperCase() === 'GET') {
        if (window.__stale && last) { window.__staleN++; return Promise.resolve(new Response(last.text, { status: 200, headers: last.headers })); }
        window.__reading++;
        return f(u, o).then(async (r) => { const text = r.ok ? await r.clone().text() : null; if (text !== null && !window.__stale) last = { text, headers: [...r.headers] }; window.__read = true; return r; })
          .finally(() => setTimeout(() => { window.__reading--; }, 300));
      }
      if (String(o?.method || 'GET').toUpperCase() !== 'POST' || !url.startsWith('/api/')) return f(u, o);
      const x = { url, body: JSON.parse(o.body || 'null') }; window.__posts.push(x);
      return f(u, o).then(async (r) => { x.status = r.status; x.out = await r.clone().text(); return r; }); }; })()`);

    // q1: a choice, the standing-rule box, Answer: the rule rides on the answer, the card leaves
    await press(IN(`[data-qcard="${q1}"] input[data-pick][value="Stripe"]`), "q1's Stripe");
    await press(IN(`input[data-rulebox="${q1}"]`), "q1's rule box");
    await soon(`document.querySelector(${JSON.stringify(IN(`input[data-rulebox="${q1}"]`))}).checked`, 'the rule box checked');
    // the counts leave out a question answered on this page (inboxCount's ANSWERED, spec §2.2), even where the data read
    // after the answer still has it open: the answer's read is the one from before it
    await soon('window.__read === true', 'a read of the data through the wrap');
    await p.ev('window.__stale = true; void 0');
    // (no real read under way, none landed in the last 300 ms: none can land after the answer and drop it from ANSWERED)
    await soon('window.__reading === 0', 'no read of the data under way');
    await press(IN(`[data-answer="${q1}"]`), "q1's Answer");
    const b1 = await posted('/api/answer', q1);
    assert.equal(b1.answer, 'Stripe');
    assert.equal(b1.rule, 'Stripe: the standing answer to questions like “Which processor?”', 'the rule box rides on the answer');
    const COUNTS = `[${TAB('inbox')}.querySelector('.n')?.textContent, document.querySelector('.pagebar .tt .n.q')?.textContent, document.title.match(/^\\((\\d+)\\)/)?.[1]]`;
    await soon(`window.__staleN > 0 && RAW.questions.some((q) => q.id === '${q1}') && !document.querySelector(${JSON.stringify(IN(`[data-qcard="${q1}"]`))})`, "a read with q1 still open, drawn")
      .catch(async (e) => assert.fail(`${e.message}: ${JSON.stringify(await p.ev(`[window.__staleN, ${COUNTS}]`))}`));
    await p.ev(FRAMES);
    assert.deepEqual(await p.ev(COUNTS), ['8', '8', '8'], 'the tab, .tt and the title say 8');
    await p.ev('window.__stale = false; void 0');
    await gone(q1);
    // one redraw after the data says q1 is answered: Q's subject is no longer in the Inbox, so no pin of Q's in the panel
    await soon(`!RAW.questions.some((q) => q.id === '${q1}')`, 'the data without q1');
    await p.ev("document.getElementById('questions').firstElementChild.__old = 1; void 0");
    await soon("!document.getElementById('questions').firstElementChild?.__old", 'a redraw');
    await p.ev(FRAMES);
    assert.equal(await p.ev(`tlInboxHome(TL.threads.find((x) => x.id === '${Q}'))`), false, 'Q is no longer Inbox-home');
    assert.equal(await p.ev(`(() => { const b = ${PIN(Q)}; if (!b || b.hidden || !b.getClientRects().length) return false; const r = b.getBoundingClientRect(), k = document.getElementById('th-inbox').getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; return x >= k.left && x <= k.right && y >= k.top && y <= k.bottom; })()`), false, "no pin of Q's inside #th-inbox");

    // q2: words typed into the note box survive a held redraw and a threads poll, focus and caret kept
    const TA = IN(`textarea[data-q="${q2}"]`);
    await focusIn(TA, "q2's note");
    await p.type('half a thought');
    await soon(`document.querySelector(${JSON.stringify(TA)}).value === 'half a thought'`, 'the words typed');
    await p.ev(`(() => { const t = document.querySelector(${JSON.stringify(TA)}); t.__mine = 1; t.setSelectionRange(4, 4); })()`);
    await soonIn(p, 15000)('HELD !== null', 'a redraw arrived and held');
    // a threads poll, run here: while a draw is held the page reads the threads only with a card open (its 2 s poll),
    // so the read a landed draw would start is started by hand
    const seq = await p.ev('TL.have');
    await p.ev('tlRefresh(); void 0');
    await soon(`TL.have > ${seq}`, 'a threads poll landed');
    await p.ev(FRAMES);
    assert.deepEqual(await p.ev('(() => { const a = document.activeElement; return [a?.__mine === 1, a?.value, a?.selectionStart]; })()'), [true, 'half a thought', 4], 'the same field focused, its words and caret kept');
    // Escape there is the field's: the panel stays open, on Inbox
    await p.key('Escape');
    await p.ev(FRAMES);
    assert.equal(await p.ev(`${ON_INBOX} && location.hash === '#overview?th=inbox'`), true, 'Escape in the note box leaves the panel open');
    assert.equal(await p.ev('document.activeElement?.__mine === 1'), true, 'the focus still in the note box');
    // pin mode on, the focus still in the note box: Escape leaves pin mode, and nothing else
    await p.ev('tlPinMode(true); void 0');
    assert.equal(await p.ev('TL.pin'), true, 'pin mode on');
    await p.key('Escape');
    await p.ev(FRAMES);
    assert.deepEqual(await p.ev(`[TL.pin, ${ON_INBOX}, location.hash, document.activeElement?.__mine === 1, document.activeElement?.value]`), [false, true, '#overview?th=inbox', true, 'half a thought'], 'Escape leaves pin mode; the panel open, the focus and words kept');
    // blurred: the held draw lands, and the redrawn box keeps the words
    await p.ev('document.activeElement.blur(); void 0');
    await soon('HELD === null', 'the held draw landed');
    await soon(`(() => { const t = document.querySelector(${JSON.stringify(TA)}); return !!t && !t.__mine && t.value === 'half a thought'; })()`, 'the redrawn note box holds the words');
    // the note, sent (q2's Answer with no choice: the words as the answer)
    await press(IN(`[data-answer="${q2}"]`), "q2's Answer");
    assert.equal((await posted('/api/answer', q2)).answer, 'half a thought', 'the note sent');
    await gone(q2);

    // q3, the owner-action: Done
    await press(IN(`[data-qcard="${q3}"] input[data-pick][value="Done"]`), "q3's Done");
    await press(IN(`[data-answer="${q3}"]`), "q3's Send");
    assert.equal((await posted('/api/answer', q3)).answer, 'Done');
    await gone(q3);

    // the secrets: Post on q4, Reply on q5, Can't right now on q6
    const SECRET = IN(`#q-${q4} [data-secret]`);
    await focusIn(SECRET, "q4's secret");
    await p.type('sk-test-4');
    await press(IN(`[data-post-secrets="${q4}"]`), "q4's Post");
    assert.deepEqual(await posted('/api/secret', q4), { id: q4, values: { KEY_4: 'sk-test-4' } }, 'the secret posted');
    await gone(q4);
    await focusIn(IN(`textarea[data-q="${q5}"]`), "q5's note");
    await p.type('use the old key');
    await press(IN(`[data-reply="${q5}"]`), "q5's Reply");
    assert.equal((await posted('/api/answer', q5)).answer, 'use the old key', 'the reply');
    await gone(q5);
    await press(IN(`[data-cant="${q6}"]`), "q6's Can't right now");
    assert.equal((await posted('/api/answer', q6)).answer, 'Can’t right now');
    await gone(q6);

    // Overrule on the defaulted question's Answered card
    await press(IN('#answered-sum'), 'the Answered list');
    await soon("document.getElementById('answered-wrap').open", 'the Answered list open');
    await focusIn(IN(`input[data-overrule="${fx.defaulted}"]`), 'the overrule box');
    await p.type('9090');
    await press(IN(`[data-overrule-send="${fx.defaulted}"]`), 'Overrule');
    assert.equal((await posted('/api/answer', fx.defaulted)).answer, '9090', 'overruled');
    await soon(`/Overruled: 9090/.test(document.getElementById('answered').textContent)`, 'the overrule said on its card');

    // the lessons: Keep it on L1 with its note, Retire it on L2
    await focusIn(IN(`textarea[data-know-note="${fx.L1}"]`), "L1's note");
    await p.type('only for card payments');
    await press(IN(`[data-know="${fx.L1}"][data-status="accepted"]`), "L1's Keep it");
    assert.deepEqual(await posted('/api/knowledge', fx.L1), { id: fx.L1, status: 'accepted', note: 'only for card payments' }, 'kept, with the note');
    await press(IN(`[data-know="${fx.L2}"][data-status="retired"]`), "L2's Retire it");
    assert.deepEqual(await posted('/api/knowledge', fx.L2), { id: fx.L2, status: 'retired' }, 'retired');

    // the terminal's card: option 1 sends its number
    const menu = paneMenu();
    await p.ev("window.__paneReply = { status: 200, body: { ok: true, out: 'answered: 1. Yes' } }; void 0");
    await press(IN(`#ask-inbox [data-ask="${menu.digest}"] [data-ask-option="1"]`), "the terminal card's option 1");
    await soon('window.__paneAnswers.length === 1', 'the option posted');
    assert.deepEqual(await p.ev('window.__paneAnswers[0]'), { digest: menu.digest, option: 1, token: menu.token });
    await soon(`/Sent to the supervisor's terminal: 1\\. Yes/.test(document.getElementById('ask-inbox').textContent)`, 'the option said sent');

    // Esc (spec §2.9): shown only where the hint says Esc cancels; its click posts exactly { digest, escape: true, token }
    const esc = paneMenu({ hint: 'Esc to cancel', digest: 'c3'.repeat(20) });
    await p.ev(`window.__pane = ${JSON.stringify(esc)}; window.__paneReply = { status: 200, body: { ok: true, out: 'answered: Escape' } }; void 0`);
    await soon(`!!document.querySelector('#ask-inbox [data-ask="${esc.digest}"] [data-ask-esc]')`, 'the Esc button');
    assert.equal(await p.ev(`document.querySelector('#ask-inbox [data-ask="${esc.digest}"] [data-ask-esc]').textContent`), 'Esc');
    assert.match(await p.ev(`document.querySelector('#ask-inbox [data-ask="${esc.digest}"]').textContent`), /Your click sends that option's number, or Esc, to the terminal and nothing else\./);
    await press(IN(`#ask-inbox [data-ask="${esc.digest}"] [data-ask-esc]`), 'Esc');
    await soon('window.__paneAnswers.length === 2', 'Esc posted');
    assert.deepEqual(await p.ev('window.__paneAnswers[1]'), { digest: esc.digest, escape: true, token: esc.token }, 'exactly { digest, escape: true, token }');
    await soon(`/Sent to the supervisor's terminal: Esc/.test(document.getElementById('ask-inbox').textContent)`, 'Esc said sent');
    for (const [i, hint] of ['Enter to confirm · Esc to exit', 'Esc to cancel · Esc to quit', 'Enter to confirm'].entries()) {
      const m = paneMenu({ hint, digest: `d${i}`.repeat(20) });
      await p.ev(`window.__pane = ${JSON.stringify(m)}; void 0`);
      await soon(`!!document.querySelector('#ask-inbox [data-ask="${m.digest}"] [data-ask-option="1"]:not([disabled])')`, `the card for "${hint}", armed`);
      assert.equal(await p.ev(`!!document.querySelector('#ask-inbox [data-ask-esc]')`), false, `no Esc button for "${hint}"`);
      assert.doesNotMatch(await p.ev(`document.querySelector('#ask-inbox [data-ask="${m.digest}"]').textContent`), /or Esc/, `the copy as today for "${hint}"`);
    }
    await p.ev('window.__pane = null; void 0');

    // the review: opened full size over the panel; closed, back to the page with the panel on Inbox
    await press(IN(`[data-open-review="${fx.r}"]`), 'Open the review');
    await soon(`location.hash === '#review/${fx.r}' && !document.getElementById('review-view').hidden && ${IS_OPEN} && ${ON_INBOX}`, 'the review open, the panel still open on Inbox under it');
    const w = await p.ev("[document.getElementById('review-view').getBoundingClientRect().width, document.getElementById('threads').getBoundingClientRect().width]");
    assert.ok(w[0] > w[1], `#review-view wider than the panel: ${JSON.stringify(w)}`);
    await soon("!!document.querySelector('#review-view [data-rv-close]')", "the review's close");
    await soon(STEADY('#review-view [data-rv-close]'), "the review's close at rest");
    assert.equal(await p.ev("(() => { const r = document.querySelector('#review-view [data-rv-close]').getBoundingClientRect(); return !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('#review-view'); })()"), true, 'the review is above the panel');
    await p.click('#review-view [data-rv-close]');
    await soon(`location.hash === '#overview?th=inbox' && ${ON_PAGE('overview')} && ${ON_INBOX} && document.getElementById('review-view').hidden`, 'closed: the page, the panel on Inbox');
  });
});

// askEscCancels, in vm (AC5, ruling m-20261116-041710126): kit-241's paneEscCancels answers for kit-241's four hints.
test('askEscCancels gives paneEscCancels\'s answers', () => {
  const html = fs.readFileSync(new URL('../docs/devteam/dashboard/index.html', import.meta.url), 'utf8');
  const at = html.indexOf('const askEscCancels =');
  assert.ok(at > 0, 'askEscCancels in index.html');
  const ctx = vm.createContext({});
  vm.runInContext(`${html.slice(at, html.indexOf('\n', at))}\n;globalThis.f = askEscCancels;`, ctx);
  assert.deepEqual(['Esc to cancel', 'Enter to confirm · Esc to exit', 'Esc to cancel · Esc to quit', 'Enter to confirm'].map((h) => ctx.f(h)), [true, false, false, false]);
  assert.equal(ctx.f(undefined), false);
  assert.equal(ctx.f('enter to confirm · esc TO CANCEL'), true, 'any case');
});

// T_HOME and tlHome, in vm (AC4): a question's home is its open card in the Inbox tab (#th-inbox #questions), never
// the Answered list; other kinds keep their page's section; both fall back to anything main draws.
test("a question's home is the Inbox tab", () => {
  const html = fs.readFileSync(new URL('../docs/devteam/dashboard/index.html', import.meta.url), 'utf8');
  const core = html.slice(html.indexOf('/* threads-core start */'), html.indexOf('/* threads-core end */'));
  const at = html.indexOf('function tlHome(');
  assert.ok(core.length > 500 && at > 0, 'threads-core and tlHome in index.html');
  const fn = html.slice(at, html.indexOf('\n}\n', at) + 2);
  const asked = [];
  const ctx = vm.createContext({ TextEncoder, URL, CSS: { escape: (s) => s }, document: { querySelector: (sel) => { asked.push(sel); return null; } } });
  vm.runInContext(`${core}\n${fn}\n;globalThis.api = { T_HOME, tlHome };`, ctx);
  assert.equal(ctx.api.T_HOME.question, 'inbox');
  assert.equal(ctx.api.tlHome({ kind: 'item', ref: 'question:q-1' }), null);
  assert.deepEqual(asked, ['#th-inbox #questions [data-subject="question:q-1"]', 'main [data-subject="question:q-1"]']);
  asked.length = 0;
  ctx.api.tlHome({ kind: 'item', ref: 'goal:g-1' });
  assert.deepEqual(asked, ['main #goals [data-subject="goal:g-1"]', 'main [data-subject="goal:g-1"]']);
  assert.ok(!asked.some((s) => s.includes('answered')), 'never the Answered list');
});
