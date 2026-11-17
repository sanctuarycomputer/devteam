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
import { PORTS, bareProject, dashboardOnFreePort, inboxFixture } from './lib/kit.mjs';
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
