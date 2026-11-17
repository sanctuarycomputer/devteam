// The Inbox in the side panel (kit-100): the panel's first tab, opened by the top-right Inbox button and
// by th=inbox, holding the one Inbox element (#th-inbox) moved out of <main>. Headless Chrome against a
// real dashboard on a project of its own (inboxFixture, spec §3), skipped where Chrome can't be driven,
// as the kit's other Chrome tests are.
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
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
  return { p, soon, size, reload, fx, root, env, port, dash };
}

const IS_OPEN = "document.body.classList.contains('threads-open')";
const AT_REST = `(${IS_OPEN} && getComputedStyle(document.getElementById('threads')).transform === 'none')`;
// shown: a box, not display:none or visibility:hidden, and not hidden
const SEEN = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.hidden) return false; const c = getComputedStyle(e); return c.display !== 'none' && c.visibility !== 'hidden' && e.getClientRects().length > 0; })()`;
const TAB = (id) => `document.querySelector('#th-tabs [role="tab"][data-tab="${id}"]')`;
const ON_PAGE = (id) => `!!document.querySelector('main.page > section[data-page="${id}"]')?.classList.contains('on')`;

test('the Inbox in the panel', { skip: SKIP, timeout: 600000 }, async (t) => {
  const { p, soon, reload, fx } = await open(t, '#overview');
  const { Q } = fx;

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
});
