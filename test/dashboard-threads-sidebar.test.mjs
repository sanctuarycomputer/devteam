// The Threads panel (kit-89): a full-height side panel with real tabs, opened from the top-right Inbox
// button, which carries the threads' counts. Headless Chrome against a real dashboard on a project of
// its own (threadsFixture), skipped where Chrome can't be driven, as the kit's other Chrome tests are.
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { threadsFixture, dashboardOnFreePort, until } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const SKIP = canDrive ? false : 'needs Chrome and a Node with WebSocket';

// A wait on a condition in the page (this file's own copy of dashboard.test.mjs's soonIn): an
// evaluation that throws is "not yet"; timed out, it says where the tab is and the last error.
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
// The page polls every 10 s; here every 300 ms. A test can hold back every /api/threads answer, read
// now, until it lets each go (__threadsQueue, as dashboard.test.mjs's POLL_FAST has it). Each read of
// the threads that has come back sets __threadsRead to when it did.
const POLL_FAST = `(() => {
  const si = window.setInterval;
  window.setInterval = (f, ms, ...a) => si(f, ms === 10000 ? 300 : ms, ...a);
  const rf = window.fetch;
  window.fetch = async (u, o) => {
    if (String(u).startsWith('/api/threads') && window.__threadsQueue) { const r = await rf(u, { ...o, signal: undefined }); await new Promise((go) => window.__threadsQueue.push(go)); window.__threadsRead = Date.now(); return r; }
    if (String(u).startsWith('/api/threads')) { const r = await rf(u, o); window.__threadsRead = Date.now(); return r; }
    return rf(u, o);
  };
})()`;
// Resolves after two frames: whatever an event handler set has been drawn.
// True once an element's box reads the same twice running (soon's polls are 50 ms apart): after a resize the
// page can still be settling, and a click at a box read a moment before lands beside it.
const STEADY = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(), k = [r.left, r.top, r.width, r.height].join(); const was = (window.__steady ||= {})[${JSON.stringify(sel)}]; window.__steady[${JSON.stringify(sel)}] = k; return was === k; })()`;
const FRAMES = 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))';
const goalArgs = (title, priority) => ['goal', 'add', '--title', title, '--outcome', 'admins pay alone', '--measure', 'self-serve share', '--target', '80', '--unit', '%', '--direction', 'up', '--source', 'prod', '--check', 'echo 5', '--horizon', '2027-03-31', '--non-goals', 'enterprise invoicing', '--preconditions', 'cards work', 'prices defined', '--priority', String(priority)];
const idOf = (out) => out.split('\n')[0].trim();

// A fixture's dashboard and a Chrome tab on it at 1440x900.
async function open(t, F, hash) {
  const later = cleanup(t);
  later(() => F.done());
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  const size = (width, height) => p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await size(1440, 900);
  // knobs for widening races, each doing nothing unless set:
  // DEVTEAM_TEST_CPU_THROTTLE=n runs the page n times slower, as on a loaded runner
  if (process.env.DEVTEAM_TEST_CPU_THROTTLE) await p.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.DEVTEAM_TEST_CPU_THROTTLE) });
  // DEVTEAM_TEST_SLIDE_MS=ms makes every slide (--dur) that long
  if (process.env.DEVTEAM_TEST_SLIDE_MS) await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => document.documentElement.style.setProperty('--dur', '${Number(process.env.DEVTEAM_TEST_SLIDE_MS)}ms'))` });
  // DEVTEAM_TEST_CLICK_GAP_MS=ms waits that long between a click's aim and its press, so anything that moves meanwhile is missed
  if (process.env.DEVTEAM_TEST_CLICK_GAP_MS) {
    const gap = Number(process.env.DEVTEAM_TEST_CLICK_GAP_MS);
    p.click = async (sel) => { const at = await p.at(sel); await new Promise((r) => setTimeout(r, gap)); await p.clickAt(at.x, at.y); };
  }
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: POLL_FAST });
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/${hash}` });
  const soon = soonIn(p, 30000, () => dash.out());
  await soon('typeof DATA === "object" && DATA !== null && TL.have > 0', 'the page and its threads read');
  // a reload: the old document marked, then a new one (without the mark) with its data and threads read
  const reload = async () => {
    await p.ev('window.__old = true; void 0');
    await p.send('Page.reload');
    await soon('!window.__old && typeof DATA === "object" && DATA !== null && TL.have > 0', 'the page reloaded and read');
  };
  return { p, soon, size, reload, chrome, port, dash };
}

test('the panel and its button', { skip: SKIP, timeout: 300000 }, async (t) => {
  const F = threadsFixture('threads-sidebar');
  F.sup(goalArgs('Self-serve billing', 2));
  const Q1 = idOf(F.sup(['ask', '--question', 'Which way?', '--choices', '[{"label":"Left"},{"label":"Right"}]', '--goal', F.goal, '--stake', '1', '--urgency', '1']));
  // A: no subject, the supervisor spoke last and asked a question in it (your move)
  const A = idOf(F.owner(['thread', 'new', 'Where do we start?']));
  F.sup(['thread', 'reply', A, 'Here, I think.']);
  F.sup(['thread', 'ask', A, '--question', 'Which colour?', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
  // B: the owner's only (waiting on the supervisor)
  const B = idOf(F.owner(['thread', 'new', 'Is the build green?']));
  // C: proposed resolved (ready to accept)
  const C = idOf(F.owner(['thread', 'new', 'Tidy the readme']));
  F.sup(['thread', 'reply', C, 'Tidied.']);
  F.sup(['thread', 'ready', C, '--outcome', 'done']);
  // G: on the first goal, pinned on Goals (your move)
  const G = idOf(F.owner(['thread', 'new', 'About this goal', '--subject', JSON.stringify({ kind: 'item', ref: `goal:${F.goal}` })]));
  F.sup(['thread', 'reply', G, 'On it.']);
  // X: on a ticket the project doesn't have (waiting; its subject gone)
  const X = idOf(F.owner(['thread', 'new', 'About a ticket', '--subject', JSON.stringify({ kind: 'item', ref: 'ticket:kit-gone' })]));
  const R = [];
  for (const w of ['First done thing', 'Second done thing']) { const r = idOf(F.owner(['thread', 'new', w])); F.owner(['thread', 'resolve', r, '--outcome', 'ok']); R.push(r); }
  const { p, soon, size } = await open(t, F, '#overview');
  const tt = "document.querySelector('.pagebar .tt')";
  const isOpen = "document.body.classList.contains('threads-open')";
  const row = (id) => `document.querySelector('#tl-list [data-tl-open="${id}"]')`;

  // the button: Inbox, the red count, the thread count in green with its words
  await soon(`${tt}.querySelector('.n.th')?.textContent === '3'`, 'the thread count');
  const b = await p.ev(`(() => { const b = ${tt}; return { text: b.textContent, q: b.querySelector('.n.q').textContent, th: b.querySelector('.n.th').className, title: b.getAttribute('title'), label: b.getAttribute('aria-label') }; })()`);
  assert.match(b.text, /^\s*Inbox/, 'it reads Inbox');
  assert.equal(b.q, '2', 'the red count: two open questions');
  assert.equal(b.th, 'n th ok', 'green: one ready plus two your move');
  assert.equal(b.title, '1 ready to accept, 2 your move');
  assert.match(b.label, /2 open questions/);
  assert.match(b.label, /1 ready to accept, 2 your move/);

  // opening it from the button: the page moves left by --threads-w, the button hides
  assert.equal(await p.ev(isOpen), false, 'closed at first');
  const closedRight = await p.ev("document.querySelector('.main').getBoundingClientRect().right");
  await p.click('.pagebar .tt');
  // the button opens the panel on its Inbox tab (kit-100 spec §2.3)
  await soon(`location.hash === '#overview?th=inbox' && ${isOpen}`, 'the panel open on #overview?th=inbox');
  // at rest: the margin's slide (--dur) has ended
  await soon("getComputedStyle(document.querySelector('.main')).marginRight === '380px'", ".main's right margin is --threads-w");
  const openRight = await p.ev("document.querySelector('.main').getBoundingClientRect().right");
  assert.ok(Math.abs(closedRight - openRight - 380) <= 1, `.main's right edge moved left by 380px: ${closedRight} to ${openRight}`);
  assert.deepEqual(await p.ev(`[getComputedStyle(${tt}).visibility, getComputedStyle(document.getElementById('tt-peek')).visibility]`), ['hidden', 'hidden'], '.tt and #tt-peek hidden');
  await soon("getComputedStyle(document.getElementById('threads')).transform === 'none'", 'slid in');
  assert.equal(await p.ev("document.activeElement?.closest('#th-tabs [role=\"tab\"]')?.dataset.tab"), 'inbox', 'the focus on the selected tab');
  // the Threads tab: th=open
  await p.click('#th-tabs [role="tab"][data-tab="threads"]');
  await soon(`location.hash === '#overview?th=open' && ${isOpen} && !!document.querySelector('#th-pane [data-thf]')`, 'the panel on Threads, #overview?th=open');

  // its head: --bar-h tall, level with the page bar
  const head = await p.ev("(() => { const h = document.querySelector('#threads .threads-head').getBoundingClientRect(), b = document.querySelector('.pagebar').getBoundingClientRect(); return { h: h.height, hb: h.bottom, bb: b.bottom }; })()");
  assert.equal(head.h, 49, '.threads-head is 49px');
  assert.ok(Math.abs(head.hb - head.bb) <= 1, `level with .pagebar: ${JSON.stringify(head)}`);

  // the tabs: Inbox (kit-100), Threads, then two disabled slots, with their titles
  assert.deepEqual(await p.ev('threadsTabs.list().map((t) => [t.id, t.disabled])'), [['inbox', false], ['threads', false], ['supervisor', true], ['shell', true]]);
  const tabs = await p.ev("[...document.querySelectorAll('#th-tabs [role=\"tab\"]')].map((b) => ({ id: b.dataset.tab, sel: b.getAttribute('aria-selected'), dis: b.getAttribute('aria-disabled'), title: b.getAttribute('title'), n: b.querySelector('.n')?.className ?? null, nt: b.querySelector('.n')?.textContent ?? null, text: b.textContent }))");
  assert.deepEqual(tabs.map((x) => [x.id, x.sel, x.dis]), [['inbox', 'false', null], ['threads', 'true', null], ['supervisor', 'false', 'true'], ['shell', 'false', 'true']]);
  assert.equal(tabs[2].title, "The supervisor's terminal: the follow-on goal");
  assert.equal(tabs[3].title, 'A plain shell at the repo root: the follow-on goal');
  assert.deepEqual([tabs[1].n, tabs[1].nt], ['n blue', '2'], 'Threads counts the two your-move threads, in blue');
  assert.match(tabs[1].text, /^Threads/);

  // the split: Open 5 pressed, Resolved 2
  assert.deepEqual(await p.ev("[...document.querySelectorAll('#th-pane [data-thf]')].map((b) => [b.dataset.thf, b.textContent.replace(/\\s+/g, ' ').trim(), b.getAttribute('aria-pressed')])"), [['open', 'Open 5', 'true'], ['resolved', 'Resolved 2', 'false']]);
  assert.equal(await p.ev("document.querySelector('#th-pane .seg').getAttribute('role') + '|' + document.querySelector('#th-pane .seg').getAttribute('aria-label')"), 'group|Which threads');

  // the five rows, each with one mark
  assert.equal(await p.ev("document.querySelectorAll('#tl-list > li > button.th-row[data-tl-open]').length"), 5, 'five rows');
  const rows = JSON.parse(await p.ev(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('#tl-list button.th-row')].map((r) => { const m = r.querySelectorAll('.th-st'); return [r.dataset.tlOpen, { marks: m.length, cls: m[0]?.className ?? '', role: m[0]?.getAttribute('role'), title: m[0]?.getAttribute('title'), label: m[0]?.getAttribute('aria-label'), pin: r.querySelector('.pinchip')?.textContent ?? null, s: r.querySelector('.th-s')?.textContent ?? '', w: getComputedStyle(r.querySelector('.th-w')).fontWeight, parts: [...r.children].map((c) => c.classList[0]) }]; })))`));
  const want = { [A]: ['you', 'Your move'], [B]: ['wait', 'Waiting on the supervisor'], [C]: ['ok', 'Ready to accept'], [G]: ['you', 'Your move'], [X]: ['wait', 'Waiting on the supervisor'] };
  for (const [id, [cls, words]] of Object.entries(want)) {
    const r = rows[id];
    assert.ok(r, `a row for ${id}`);
    assert.equal(r.marks, 1, `${id}: one mark`);
    assert.ok(r.cls.split(' ').includes(cls), `${id}: .th-st.${cls} (${r.cls})`);
    assert.deepEqual([r.role, r.title, r.label], ['img', words, words], `${id}: the mark says ${words}`);
    assert.deepEqual(r.parts, ['th-st', 'th-s', 'th-tm', 'th-w'], `${id}: no third line`);
  }
  assert.ok(Number(rows[A].w) >= 600, `your move: a bold headline (${rows[A].w})`);
  assert.ok(Number(rows[B].w) < 600, `waiting: a regular headline (${rows[B].w})`);
  assert.equal(rows[A].s, '', 'no "no subject" line for a subjectless thread');
  const gPin = await p.ev(`String(tPins(TL.threads).find((g) => g.ids.includes('${G}')).n)`);
  assert.equal(rows[G].pin, gPin, "G's pin number");
  assert.match(rows[G].s, /Goals/);
  assert.match(rows[X].s, / · subject gone$/);
  assert.equal(rows[X].pin, null, 'a subject gone has no pin');

  // Resolved: its two rows, the focus on the button pressed
  await p.click('#th-pane [data-thf="resolved"]');
  await soon(`location.hash === '#overview?th=resolved' && document.querySelectorAll('#tl-list button.th-row').length === 2`, 'the resolved rows');
  assert.deepEqual(await p.ev("[...document.querySelectorAll('#tl-list button.th-row')].map((r) => r.dataset.tlOpen).sort()"), [...R].sort());
  assert.equal(await p.ev("document.querySelectorAll('#tl-list .th-st, #tl-list .pinchip').length"), 0, 'no mark, no pin on a resolved row');
  await soon("document.activeElement?.matches('[data-thf=\"resolved\"]') && document.activeElement.getAttribute('aria-pressed') === 'true'", 'the focus on Resolved');
  await p.click('#th-pane [data-thf="open"]');
  await soon(`location.hash === '#overview?th=open' && !!${row(A)}`, 'Open again');

  // × closes it
  await p.click('#th-close');
  await soon(`location.hash === '#overview' && !${isOpen} && getComputedStyle(${tt}).visibility === 'visible'`, 'closed, the button back');
  await soon(`document.activeElement === ${tt}`, 'the focus back on the button');
  // th=inbox: the panel's Inbox tab, over the page (kit-100 spec §2.3)
  await p.ev("location.hash = '#overview?th=inbox'");
  await soon(`location.hash === '#overview?th=inbox' && ${isOpen} && document.querySelector('#th-tabs [data-tab="inbox"]')?.getAttribute('aria-selected') === 'true' && !document.getElementById('th-inbox').hidden && document.querySelector('main.page > section[data-page="overview"]').classList.contains('on')`, 'the panel on its Inbox tab, over Overview');
  // closed by its × (a fresh #overview would take the remembered th=inbox)
  await soon(`getComputedStyle(document.getElementById('threads')).transform === 'none'`, 'at rest');
  await p.click('#th-close');
  await soon(`location.hash === '#overview' && document.querySelector('main.page > section[data-page="overview"]').classList.contains('on') && !${isOpen}`, 'Overview');

  // the dock is gone
  assert.deepEqual(await p.ev("['tl-pill', 'tl-panel', 'tl-dock', 'ask-dock'].filter((id) => document.getElementById(id))"), []);

  // narrow: the panel covers the page, Shift over it shows no pin
  await size(720, 800);
  await soon("innerWidth === 720 && getComputedStyle(document.querySelector('.pagebar .tt')).visibility === 'visible'", 'at 720');
  await soon(STEADY('.pagebar .tt'), 'the button at rest');
  await p.click('.pagebar .tt');
  await soon(`${isOpen} && getComputedStyle(document.getElementById('threads')).transform === 'none'`, 'open at 720');
  await p.click('#th-tabs [role="tab"][data-tab="threads"]');
  await soon(`location.hash.endsWith('th=open') && !!document.querySelector('#th-pane [data-thf]')`, 'on Threads at 720');
  const mid = await p.ev("(() => { const r = document.getElementById('threads').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()");
  await p.hold('Shift', true);
  await p.move(mid.x, mid.y, 8);
  await p.move(mid.x + 5, mid.y + 5, 8);
  await p.ev(FRAMES);
  assert.equal(await p.ev("document.getElementById('tl-cursor').hidden"), true, 'no pin over the panel');
  assert.equal(await p.ev(`tlHitAt(${mid.x}, ${mid.y})`), null, 'the panel is not a thread target');
  await p.hold('Shift', false);
  // a phone: the panel is the window, its × inside it, nothing sideways
  await size(390, 844);
  await soon("innerWidth === 390 && (() => { const r = document.getElementById('threads').getBoundingClientRect(); return r.left === 0 && r.top === 0 && r.width === innerWidth && r.height === innerHeight; })()", 'the panel is the window');
  assert.equal(await p.ev("(() => { const r = document.getElementById('th-close').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()"), true, '× inside it');
  assert.ok(await p.ev('document.documentElement.scrollWidth <= innerWidth'), 'no horizontal scroll');
  await size(1440, 900);

  // a count that changes doesn't take the focus off a tab
  await soon("innerWidth === 1440 && !!document.querySelector('#th-tabs [data-tab=\"threads\"]')", 'wide again');
  await p.ev("window.__tab = document.querySelector('#th-tabs [data-tab=\"threads\"]'); window.__tab.focus(); void 0");
  F.sup(['thread', 'reply', B, 'Green.']);
  await soon(`TL.threads.find((x) => x.id === '${B}').waiting === 'owner' && ${tt}.querySelector('.n.th')?.textContent === '4'`, 'the reply read, the button counting it');
  await p.ev(FRAMES);
  assert.ok(await p.ev('document.activeElement === window.__tab && window.__tab.isConnected'), 'the focus still on the same tab');
  await p.ev('window.__tab.blur()');
  await soon("document.querySelector('#th-tabs [data-tab=\"threads\"] .n')?.textContent === '3'", 'drawn once the focus left');
  await p.click('#th-close');
  await soon(`!${isOpen}`, 'closed');

  // a lesson sent to the owner: the red count holds it, and the button's name says the same number (final-1 F3)
  F.sup(['knowledge', 'add', '--kind', 'lesson', '--scope', 'project', '--statement', 'ask before changing the processor', '--for-owner', '--plain', 'Ask the owner before the checkout changes processor.', '--evidence', Q1]);
  await soon(`${tt}.querySelector('.n.q')?.textContent === '3'`, 'the red count with the lesson');
  await soon(`/^Inbox: 3 open questions, /.test(${tt}.getAttribute('aria-label') || '')`, "the button's name counts what the red number counts");
});

test('opening threads', { skip: SKIP, timeout: 600000 }, async (t) => {
  const F = threadsFixture('threads-open');
  const G2 = F.sup(goalArgs('Self-serve billing', 2)).split('\n')[0].trim();
  // A: no subject, with a question asked in it (in the panel)
  const A = idOf(F.owner(['thread', 'new', 'Where do we start?']));
  F.sup(['thread', 'reply', A, 'Here, I think.']);
  const QA = F.sup(['thread', 'ask', A, '--question', 'Which colour?', '--goal', F.goal, '--stake', '1', '--urgency', '1']).split('\n')[0].trim();
  // G: on the first goal (floating, beside its pin on Goals)
  const G = idOf(F.owner(['thread', 'new', 'About this goal', '--subject', JSON.stringify({ kind: 'item', ref: `goal:${F.goal}` })]));
  F.sup(['thread', 'reply', G, 'On it.']);
  // X: on a ticket the project doesn't have (its subject gone: in the panel)
  const X = idOf(F.owner(['thread', 'new', 'About a ticket', '--subject', JSON.stringify({ kind: 'item', ref: 'ticket:kit-gone' })]));
  const { p, soon, size } = await open(t, F, '#overview?th=open');
  const isOpen = "document.body.classList.contains('threads-open')";
  const atRest = `${isOpen} && getComputedStyle(document.getElementById('threads')).transform === 'none'`;
  const row = (id) => `document.querySelector('#tl-list [data-tl-open="${id}"]')`;
  const card = "document.getElementById('tl-card')";
  const inPanel = (id) => `(!!document.querySelector('#th-card-slot > #tl-card.in-panel') && !${card}.hidden && ${card}.dataset.key === '${id}')`;
  const floating = (id) => `(${card}.parentElement?.id === 'tl' && !${card}.hidden && !${card}.classList.contains('in-panel') && ${card}.dataset.key === '${id}')`;
  const seen = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const c = getComputedStyle(e); return c.display !== 'none' && c.visibility !== 'hidden' && e.getClientRects().length > 0; })()`;
  const go = async (hash, what) => { await p.ev(`location.hash = ${JSON.stringify(hash)}; void 0`); await soon(`location.hash === ${JSON.stringify(hash)}`, what); };
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  // A's row: the thread in the panel, one #tl-card moved into the slot
  await soon(`${atRest} && !!${row(A)}`, 'the panel on the list');
  await p.click(`#tl-list [data-tl-open="${A}"]`);
  await soon(`location.hash === '#overview?th=open&t=${A}' && ${inPanel(A)}`, 'A in the panel');
  assert.match(await p.ev("document.getElementById('tl-c-turns').textContent"), /Here, I think\./, "A's turns");
  // kit-95: the composer says Reply once a thread has a turn (the mock's word), Message on a new one
  assert.equal(await p.ev("document.getElementById('tl-c-text').placeholder"), 'Reply', 'a thread with turns: Reply');
  assert.deepEqual(await p.ev(`[${seen('#tl-c-text')}, ${seen('#tl-c-title')}, ${seen('#tl-card [data-tl-close]')}, ${seen('#tl-c-acts [data-tl-resolve]')}, ${card}.getAttribute('role'), ${seen('#ask-threads')}, document.querySelectorAll('#tl-card').length]`),
    [true, false, false, true, null, false, 1], 'the composer and Resolve shown; its title, its × and the terminal ask hidden; no role; one card');
  await soon("document.activeElement?.matches('#th-pane [data-tl-back]')", 'the focus on the back arrow');
  assert.equal(await p.ev("document.querySelector('#th-pane [data-tl-back]').getAttribute('aria-label')"), 'Back to the threads');
  assert.match(await p.ev("document.getElementById('th-pane').textContent"), /Where do we start\?/, "the pane's row carries the title");
  await p.click('#th-pane [data-tl-back]');
  await soon(`location.hash === '#overview?th=open' && !!${row(A)} && document.activeElement === ${row(A)} && ${card}.hidden`, "the list, the focus on A's row");

  // Review Focus 1: typing in the in-panel composer across the 10 s render and a threads poll
  await p.click(`#tl-list [data-tl-open="${A}"]`);
  await soon(`${inPanel(A)} && document.activeElement?.matches('[data-tl-back]')`, 'A again');
  await p.ev("document.getElementById('tl-c-text').focus()");
  await p.type('half a thought');
  await p.ev("document.getElementById('tl-c-text').setSelectionRange(4, 4); window.__threadsRead = 0; void 0");
  await pause(11000);
  await soon('window.__threadsRead > 0', 'a read of the threads after the wait');
  await p.ev(FRAMES);
  assert.deepEqual(await p.ev("[document.getElementById('tl-c-text').value, document.getElementById('tl-c-text').selectionStart, document.activeElement?.id]"), ['half a thought', 4, 'tl-c-text'], 'words, caret and focus kept');
  await p.ev("(() => { const ta = document.getElementById('tl-c-text'); ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.blur(); })()");

  // A's question in the panel: its words are its own, the Inbox's copy (in the panel's Inbox tab, kit-100) untouched
  const qBox = `#tl-c-turns textarea[data-q="${QA}"]`;
  await soon(`!!document.querySelector('${qBox}') && !!document.querySelector('#th-inbox textarea[data-q="${QA}"]')`, 'both copies of the question');
  await p.ev(`document.querySelector('${qBox}').focus()`);
  await p.type('panel words');
  await p.ev('window.__threadsRead = 0; void 0');
  await soon('window.__threadsRead > 0', 'a read of the threads');
  await pause(700);
  assert.deepEqual(await p.ev(`[document.querySelector('${qBox}').value, document.querySelector('#th-inbox textarea[data-q="${QA}"]').value]`), ['panel words', ''], "the panel's words kept, the Inbox's copy unchanged");
  await p.ev(`(() => { const b = document.querySelector('${qBox}'); b.value = ''; b.blur(); })()`);
  await p.click('#th-pane [data-tl-back]');
  await soon(`location.hash === '#overview?th=open' && !!${row(X)}`, 'the list');

  // X (its subject gone) opens in the pane
  await p.click(`#tl-list [data-tl-open="${X}"]`);
  await soon(`location.hash === '#overview?th=open&t=${X}' && ${inPanel(X)}`, 'X in the panel');
  await p.click('#th-pane [data-tl-back]');
  await soon(`location.hash === '#overview?th=open' && ${card}.hidden`, 'the list');

  // on Goals, a Shift+click on the second goal: a floating draft beside it; sent, it is listed with its pin, clear of the panel
  await go('#goals?th=open', 'Goals with the panel');
  const g2 = `#goals-list [data-subject="goal:${G2}"] h4`;
  await soon(`${atRest} && getComputedStyle(document.querySelector('.main')).marginRight === '380px' && !!document.querySelector('${g2}')`, 'Goals at rest beside the panel');
  const at = await p.at(g2);
  await p.hold('Shift', true);
  await p.move(at.x, at.y, 8);
  await soon("!document.getElementById('tl-cursor').hidden", 'the pin');
  await p.clickAt(at.x, at.y, 8);
  await p.hold('Shift', false);
  await soon(`TL.draft?.subject?.ref === 'goal:${G2}' && ${card}.parentElement?.id === 'tl' && !${card}.hidden && document.activeElement?.id === 'tl-c-text'`, 'a floating draft beside it');
  await p.type('hello');
  await p.key('Enter', 8);
  const N = await soon(`TL.threads.find((x) => x.subject?.ref === 'goal:${G2}' && !String(x.id).startsWith('pending-') && !x.pending)?.id`, 'the new thread read');
  await soon(`!!${row(N)}?.querySelector('.pinchip') && ${row(N)}.querySelector('.pinchip').textContent === String(tPins(TL.threads).find((g) => g.ids.includes('${N}')).n) && /Goals/.test(${row(N)}.querySelector('.th-where').textContent)`, 'listed with its pin number');
  await soon(`${floating(N)} && ${card}.getBoundingClientRect().right <= innerWidth - 380`, 'its card clear of the panel');
  await p.click('#tl-card [data-tl-close]');
  await soon(`${card}.hidden`, 'closed');

  // from Overview, G's row: one entry to Goals with the panel kept, the goal in view, its card floating
  await go('#overview?th=open', 'Overview with the panel');
  await soon(`${atRest} && !!${row(G)}`, "G's row");
  await soon(STEADY(`#tl-list [data-tl-open="${G}"]`), 'the row at rest');
  const len = await p.ev('history.length');
  await p.click(`#tl-list [data-tl-open="${G}"]`);
  await soon(`location.hash === '#goals?th=open&t=${G}' && ${floating(G)}`, "G's card on Goals");
  assert.equal(await p.ev('history.length'), len + 1, 'one entry');
  await soon(`(() => { const r = document.querySelector('#goals-list [data-subject="goal:${F.goal}"]').getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; })()`, 'the goal in view');
  await soon(`${row(G)}?.getAttribute('aria-current') === 'true' && document.activeElement === ${row(G)}`, "its row marked, the focus on it");
  await p.ev('history.back()');
  await soon(`location.hash === '#overview?th=open' && ${card}.hidden && ${isOpen}`, 'Back: Overview, the panel on the list');

  // at 720x800 the row closes the panel and the card shows
  await size(720, 800);
  await soon(`innerWidth === 720 && ${atRest} && !!${row(G)}`, 'the panel at 720');
  await soon(STEADY(`#tl-list [data-tl-open="${G}"]`), 'the row at rest');
  await p.click(`#tl-list [data-tl-open="${G}"]`);
  await soon(`location.hash === '#goals?t=${G}' && !${isOpen} && ${floating(G)} && getComputedStyle(${card}).display !== 'none'`, 'the panel closed, the card shown');
  await go('#overview', 'Overview');
  await soon(`${card}.hidden`, 'the card closed with its t');
  await size(1440, 900);

  // + : an in-panel draft, the URL unchanged; Send makes it its thread (a new entry), words typed after kept
  await go('#overview?th=open', 'the panel');
  await soon(`innerWidth === 1440 && ${atRest} && !!document.querySelector('#th-pane [data-thf="resolved"]')`, 'the list at 1440');
  await soon(STEADY('#threads [data-tl-new]'), '+ at rest');
  const resolvedN = Number(await p.ev("document.querySelector('#th-pane [data-thf=\"resolved\"] .n').textContent"));
  await p.click('#threads [data-tl-new]');
  await soon(`document.activeElement?.id === 'tl-c-text' && !!document.querySelector('#th-card-slot > #tl-card.in-panel') && !${card}.hidden`, 'an in-panel draft, focused');
  assert.equal(await p.ev('location.hash'), '#overview?th=open', 'the URL unchanged');
  assert.equal(await p.ev("document.getElementById('tl-c-text').placeholder"), 'Message', 'a new thread: Message (kit-95)');
  assert.match(await p.ev("document.getElementById('th-pane').textContent"), /New thread/, 'its row says New thread');
  const len2 = await p.ev('history.length');
  await p.type('new one');
  await p.key('Enter', 8);
  await p.type('second');
  const N2 = await soon("(/[?&]t=([^&]+)/.exec(location.hash) || [])[1]", 't added');
  assert.equal(await p.ev('history.length'), len2 + 1, 'a new entry');
  await p.ev(FRAMES);
  assert.deepEqual(await p.ev("[document.activeElement?.id, document.getElementById('tl-c-text').value]"), ['tl-c-text', 'second'], 'the focus and the words kept');
  assert.ok(await p.ev(inPanel(N2)), 'the thread in the panel');
  await p.ev("(() => { const ta = document.getElementById('tl-c-text'); ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.blur(); })()");
  await soon(`TL.threads.some((x) => x.id === '${N2}' && !x.pending)`, 'the thread read');
  await p.click('#tl-c-acts [data-tl-resolve]');
  await soon("!!document.querySelector('#tl-card [data-tl-resolve-go]')", 'the resolve form');
  await p.click('#tl-card [data-tl-resolve-go]');
  await soon(`${inPanel(N2)} && !!document.querySelector('#tl-c-acts [data-tl-reopen]')`, 'resolved, still shown, with Reopen');
  await p.ev('history.back()');
  await soon(`location.hash === '#overview?th=open' && ${card}.hidden && Number(document.querySelector('#th-pane [data-thf="resolved"] .n')?.textContent) === ${resolvedN + 1}`, 'Back: the list, one more resolved');

  // + over a thread open in the panel: one press of the arrow leaves both, to the list, the focus on its row;
  // and while the draft is up, a route that keeps the thread's t doesn't put the thread back
  await go(`#overview?th=open&t=${A}`, 'A in the panel');
  await soon(`${atRest} && ${inPanel(A)}`, 'A shown');
  await soon(STEADY('#threads [data-tl-new]'), '+ at rest');
  await p.click('#threads [data-tl-new]');
  await soon(`document.activeElement?.id === 'tl-c-text' && ${card}.dataset.key === 'new:none' && /New thread/.test(document.getElementById('th-pane').textContent)`, 'a + draft over A');
  await p.ev('thRoute(); void 0');
  await p.ev(FRAMES);
  assert.equal(await p.ev(`${card}.dataset.key`), 'new:none', 'a route keeping t leaves the draft');
  await p.click('#th-pane [data-tl-back]');
  await soon(`location.hash === '#overview?th=open' && !!${row(A)} && document.activeElement === ${row(A)} && ${card}.hidden`, "one press: the list, the focus on A's row");
  assert.equal(await p.ev("!!document.querySelector('#th-pane [data-tl-back]')"), false, 'no draft left');

  // between 901px and 1019px a floating card is still clear of the open panel: a draft on a spot 200px in,
  // whose card would go to the spot's right
  await size(960, 800);
  await go('#goals?th=open', 'Goals at 960');
  await soon(`innerWidth === 960 && ${atRest}`, 'the panel at 960');
  await p.ev("tlStart({ subject: { kind: 'page', view: '#goals', at: { x: 0, y: 0 } }, title: 'A spot', x: 200, y: 200 }); void 0");
  await soon(`${card}.parentElement?.id === 'tl' && !${card}.hidden && !${card}.classList.contains('in-dock') && !${card}.classList.contains('sheet')`, 'a floating draft at 960');
  await p.ev(FRAMES);
  const right = await p.ev(`${card}.getBoundingClientRect().right`);
  assert.ok(right <= 960 - 380, `clear of the panel at 960: its right edge ${right}`);
  await p.ev('tlClose(); void 0');
  await soon(`${card}.hidden`, 'closed');
  await go('#overview?th=open', 'Overview');
  await size(1440, 900);

  // at 720x800 with the panel open, Pin closes the panel first and starts pin mode
  await size(720, 800);
  await soon(`innerWidth === 720 && ${atRest}`, 'the panel at 720');
  await soon(STEADY('#tl-pinbtn'), 'Pin at rest');
  await p.click('#tl-pinbtn');
  await soon(`!${isOpen} && location.hash === '#overview' && TL.pin && document.getElementById('tl-pinbtn').getAttribute('aria-pressed') === 'true'`, 'the panel closed, pin mode on');
  await p.key('Escape');
  await soon('!TL.pin', 'pin mode off');
  await size(1440, 900);

  // a #talk/ link to A, on Board: the panel open on A over Board
  await go('#board', 'Board');
  await soon(`innerWidth === 1440 && !${isOpen}`, 'Board, the panel closed');
  await p.ev(`location.hash = '#talk/${A}'; void 0`);
  await soon(`${isOpen} && ${inPanel(A)} && history.state?.page === '#board?th=open&t=${A}'`, 'the panel on A over Board');
  // closed by its × first: a nav to a head without keys would carry the remembered panel (T3, spec §2.5)
  await soon(STEADY('#th-close'), '× at rest');
  await p.click('#th-close');
  await soon(`!${isOpen}`, 'the panel closed');
  await go('#overview', 'Overview');
  await soon(`!${isOpen} && ${card}.hidden`, 'closed');

  // a floating card with no box on screen: in the corner, beside the open panel; hidden while the panel covers the page
  await go(`#overview?th=open&t=${G}`, 'G on Overview');
  await soon(`${atRest} && ${floating(G)} && ${card}.classList.contains('in-dock')`, 'in the corner');
  await soon(`(() => { const r = ${card}.getBoundingClientRect(); return r.right <= innerWidth - 380 - 16 + 0.5 && Math.abs(innerHeight - 16 - r.bottom) <= 1; })()`, 'beside the panel, 16px up');
  assert.equal(await p.ev(`getComputedStyle(${card}).bottom`), '16px');
  await size(720, 800);
  await soon(`innerWidth === 720 && getComputedStyle(${card}).display === 'none'`, 'hidden at 720 under the open panel');
  await size(1440, 900);
  await soon(`innerWidth === 1440 && getComputedStyle(${card}).display !== 'none'`, 'shown again at 1440');

  // Escape: on the panel list, the panel closes and the floating card stays
  await soon(`${atRest} && !!${row(A)}`, 'the list');
  await p.ev(`${row(A)}.focus()`);
  await p.key('Escape');
  await soon(`location.hash === '#overview?t=${G}' && !${isOpen} && ${floating(G)}`, 'the panel closed, the card kept');
  // in an in-panel thread, Escape goes back to the list, the focus on its row
  await go(`#overview?th=open&t=${A}`, 'A in the panel');
  await soon(`${atRest} && ${inPanel(A)}`, 'A shown');
  await p.ev("document.getElementById('tl-c-text').focus()");
  await p.key('Escape');
  await soon(`location.hash === '#overview?th=open' && document.activeElement === ${row(A)}`, "the list, the focus on A's row");
  // in pin mode, with the focus in the panel, Escape ends pin mode first
  await p.click('#tl-pinbtn');
  await soon('TL.pin', 'pin mode');
  await p.ev("document.getElementById('tl-pinbtn').focus()");
  await p.key('Escape');
  await soon('!TL.pin', 'pin mode off');
  await p.ev(FRAMES);
  assert.equal(await p.ev(`${isOpen} && location.hash === '#overview?th=open'`), true, 'the panel still open');

  // Escape with the focus on the page, nothing else open (spec §2.9; final-1 F1)
  const blur = async () => { await p.ev('document.activeElement?.blur(); void 0'); await soon('document.activeElement === document.body', 'the focus on the page'); };
  // typed in a field on the page (outside the panel and the card): the field's, the panel stays open
  await p.ev("(() => { const i = document.createElement('input'); i.id = 'esc-probe'; document.querySelector('main').prepend(i); i.focus(); })(); void 0");
  await soon("document.activeElement?.id === 'esc-probe'", 'the focus in a page field');
  await p.key('Escape');
  await p.ev(FRAMES);
  assert.equal(await p.ev(`${isOpen} && location.hash === '#overview?th=open'`), true, 'Escape in a page field leaves the panel open');
  await p.ev("document.getElementById('esc-probe').remove(); void 0");
  // on the page: the panel closes, the focus to the Inbox button
  await blur();
  await p.key('Escape');
  await soon(`!${isOpen} && location.hash === '#overview' && document.activeElement === document.querySelector('.pagebar .tt')`, 'Escape from the page closed the panel, the focus on the Inbox button');
  // a floating card open, the focus on the page: the card closes, t gone, a new entry
  await go(`#goals?t=${G}`, 'G on Goals');
  await soon(`!${isOpen} && ${floating(G)}`, "G's card beside its pin");
  await blur();
  await p.key('Escape');
  await soon(`location.hash === '#goals' && ${card}.hidden`, 'Escape from the page closed the card, t gone');
  // a new entry, as its ×: Back is the card again
  await p.ev('history.back(); void 0');
  await soon(`location.hash === '#goals?t=${G}' && ${floating(G)}`, 'Back: the card again');
  // the card first, then the panel: both open, two presses
  await go(`#goals?th=open&t=${G}`, 'G on Goals, the panel open');
  await soon(`${atRest} && ${floating(G)}`, 'the panel and the card');
  await blur();
  await p.key('Escape');
  // and routed: the hash and the card change at once, TH.t only once the hashchange has routed; an Escape before
  // that would close the panel onto the card's t (#goals?t=G)
  await soon(`location.hash === '#goals?th=open' && ${card}.hidden && ${isOpen} && TH.t === null`, 'the card first, routed');
  await blur();
  await p.key('Escape');
  await soon(`location.hash === '#goals' && !${isOpen}`, 'then the panel');
});

test('the counts as threads move', { skip: SKIP, timeout: 300000 }, async (t) => {
  const F = threadsFixture('threads-counts');
  const C2 = idOf(F.owner(['thread', 'new', 'Ready one']));
  F.sup(['thread', 'reply', C2, 'Done.']);
  F.sup(['thread', 'ready', C2, '--outcome', 'done']);
  const Y1 = idOf(F.owner(['thread', 'new', 'Your move one']));
  F.sup(['thread', 'reply', Y1, 'Over to you.']);
  const Y2 = idOf(F.owner(['thread', 'new', 'Your move two']));
  F.sup(['thread', 'reply', Y2, 'Over to you too.']);
  const W = idOf(F.owner(['thread', 'new', 'Waiting one']));
  const { p, soon } = await open(t, F, '#overview');
  const n = (cls) => `document.querySelector('.pagebar .tt .n.th${cls}')?.textContent`;
  await soon(`${n('.ok')} === '3'`, 'green 3');

  // a reply sent from the composer counts at once, before any read of the threads lands
  await p.ev(`tlOpen('${Y1}')`);
  await soon(`document.getElementById('tl-card').dataset.key === '${Y1}' && !!document.getElementById('tl-c-text')`, "Y1's card");
  await p.ev('window.__threadsQueue = []; void 0');
  await p.ev("document.getElementById('tl-c-text').focus()");
  await p.type('my answer');
  await p.key('Enter', 8);
  await soon(`${n('.ok')} === '2'`, 'green 2 with the reads held');
  await soon('window.__threadsQueue.length > 0 && TL.pend.length > 0', 'a read of the threads held, the send still pending on the page');
  assert.equal(await p.ev(n('.ok')), '2', 'still green 2: the count came before the read');
  await p.ev('const q = window.__threadsQueue; window.__threadsQueue = null; q.forEach((go) => go()); void 0');
  await until(() => JSON.parse(F.owner(['thread', 'show', Y1, '--json'])).turns.some((u) => u.text === 'my answer'), 'the turn on the server');
  // Y1 has no subject: it opened in the panel; the panel closed (its ×) takes it away
  await p.click('#th-close');
  await soon("!document.body.classList.contains('threads-open') && document.getElementById('tl-card').hidden", 'the panel and its thread closed');

  // the ready one accepted: blue, counting the your-move ones
  F.owner(['thread', 'resolve', C2, '--accept']);
  await soon(`${n('.you')} === '1'`, 'blue 1');
  // that one answered: grey, counting the open threads; Threads' tab has no number
  F.owner(['thread', 'say', Y2, 'Noted.']);
  await soon(`${n('.wait')} === '3'`, 'grey 3');
  await p.click('.pagebar .tt');
  await soon("document.body.classList.contains('threads-open') && getComputedStyle(document.getElementById('threads')).transform === 'none' && !!document.querySelector('#th-tabs [data-tab=\"threads\"]')", 'the panel');
  await p.click('#th-tabs [role="tab"][data-tab="threads"]');
  await soon("location.hash.endsWith('th=open') && !!document.querySelector('#th-pane [data-thf]')", 'on Threads');
  assert.equal(await p.ev("document.querySelector('#th-tabs [data-tab=\"threads\"] .n')"), null, 'no number on Threads');
  assert.equal(await p.ev("document.querySelector('.pagebar .tt').getAttribute('title')"), '3 waiting on the supervisor');
  // none open: no thread count
  for (const id of [Y1, Y2, W]) F.owner(['thread', 'resolve', id]);
  await soon("!document.querySelector('.pagebar .tt .n.th') && [...document.querySelectorAll('#th-pane .empty')].some((e) => e.textContent === 'None')", 'no thread count, the empty line: None (kit-95)');
  await p.click('#th-close');
  await soon("!document.body.classList.contains('threads-open')", 'closed');
});

// kit-89 T3: the panel's state in history, under a peek, over a reload and remembered (spec §2.5, §2.9).
const IS_OPEN = "document.body.classList.contains('threads-open')";
const AT_REST = `(${IS_OPEN} && getComputedStyle(document.getElementById('threads')).transform === 'none')`;
// shut and still: the panel slides out and .main's margin slides back over --dur, and each one's transitionend
// re-places a floating card (tlReplace, tlDraw), so a click aimed before then lands where the card was (spec-1 S4)
const PANEL_SHUT = `(!${IS_OPEN} && document.getElementById('threads').getAnimations().length === 0 && document.querySelector('.main').getAnimations().length === 0)`;
const ROW = (id) => `document.querySelector('#tl-list [data-tl-open="${id}"]')`;
const CARD = "document.getElementById('tl-card')";
const IN_PANEL = (id) => `(!!document.querySelector('#th-card-slot > #tl-card.in-panel') && !${CARD}.hidden && ${CARD}.dataset.key === '${id}')`;
const FLOATING = (id) => `(${CARD}.parentElement?.id === 'tl' && !${CARD}.hidden && !${CARD}.classList.contains('in-panel') && ${CARD}.dataset.key === '${id}')`;
const PEEK = "(!document.getElementById('drawer').hidden && document.body.classList.contains('peek-open') && getComputedStyle(document.getElementById('drawer')).transform === 'none')";
const NO_PEEK = "!document.body.classList.contains('peek-open')";
const STORE = "localStorage.getItem('devteam.threads.open')";
const stored = (v) => JSON.stringify(v === null ? null : JSON.stringify(v));

test('a peek and a thread over a reload', { skip: SKIP, timeout: 300000 }, async (t) => {
  const F = threadsFixture('threads-peek');
  const A = idOf(F.owner(['thread', 'new', 'Where do we start?']));
  F.sup(['thread', 'reply', A, 'Here, I think.']);
  const G = idOf(F.owner(['thread', 'new', 'About this goal', '--subject', JSON.stringify({ kind: 'item', ref: `goal:${F.goal}` })]));
  F.sup(['thread', 'reply', G, 'On it.']);
  const TK = 'ch-01-tidy-docs';
  F.sup(['ticket', 'add', TK, '--json', JSON.stringify({ title: 'Tidy the docs', feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['docs/**'], done_when: ['the docs check passes in CI'], notes: 'n' })]);
  const { p, soon, reload } = await open(t, F, '#board');
  await soon(`!!document.querySelector('#board [data-ticket="${TK}"]')`, 'the ticket on Board');

  // a ticket's peek over Board; the panel opened from #tt-peek and A opened in it: no entry, the page under it changed
  await p.ev(`location.hash = '#ticket/${TK}'; void 0`);
  await soon(PEEK, 'the peek');
  const len = await p.ev('history.length');
  await soon("getComputedStyle(document.getElementById('tt-peek')).visibility === 'visible'", '#tt-peek shown');
  await p.click('#tt-peek');
  await soon(`${AT_REST} && history.state?.page === '#board?th=inbox'`, 'the panel over the peek, on Inbox');
  await p.click('#th-tabs [role="tab"][data-tab="threads"]');
  await soon(`${AT_REST} && history.state?.page === '#board?th=open' && !!${ROW(A)}`, 'the panel over the peek');
  await p.click(`#tl-list [data-tl-open="${A}"]`);
  await soon(`${IN_PANEL(A)} && history.state?.page === '#board?th=open&t=${A}'`, 'A in the panel, under the peek');
  assert.deepEqual(await p.ev(`[location.hash, history.length, ${PEEK}]`), [`#ticket/${TK}`, len, true], 'the peek still open, no entry added (Review Focus 2)');
  assert.equal(await p.ev(STORE), JSON.stringify({ th: 'open', t: A }), 'remembered under the peek');

  // Back and Forward through it: the entry below shows its own keys; the peek's entry keeps th and t
  await p.ev('history.back()');
  await soon(`location.hash === '#board' && ${NO_PEEK} && !${IS_OPEN}`, 'Back: Board, its own keys');
  await p.ev('history.forward()');
  await soon(`location.hash === '#ticket/${TK}' && ${PEEK} && ${IN_PANEL(A)} && history.state?.page === '#board?th=open&t=${A}'`, 'Forward: the peek, the panel on A');
  assert.equal(await p.ev('history.length'), len, 'no entry stacked');

  // AC6: a reload keeps the peek over Board and the panel on A; closing the peek leaves #board?th=open&t=<A>
  await reload();
  await soon(`location.hash === '#ticket/${TK}' && ${PEEK} && ${IN_PANEL(A)} && document.querySelector('main.page > section[data-page="board"]').classList.contains('on')`, 'reloaded: the peek over Board, A in the panel');
  await p.click('#drawer-close');
  await soon(`${NO_PEEK} && location.hash === '#board?th=open&t=${A}' && ${IN_PANEL(A)}`, 'the peek closed, the panel still on A');

  // opening a peek keeps the remembered panel
  assert.equal(await p.ev(STORE), JSON.stringify({ th: 'open', t: A }));
  await p.ev(`location.hash = '#ticket/${TK}'; void 0`);
  await soon(`${PEEK} && ${IN_PANEL(A)} && history.state?.page === '#board?th=open&t=${A}'`, 'the peek over the panel on A');
  assert.equal(await p.ev(STORE), JSON.stringify({ th: 'open', t: A }), 'kept with a peek open');

  // Escape with the focus in the in-panel composer: back to the list, the peek stays; again on the list: the
  // panel closes, the peek stays, the focus on #tt-peek
  await p.ev("document.getElementById('tl-c-text').focus()");
  await p.key('Escape');
  await soon(`${PEEK} && history.state?.page === '#board?th=open' && document.activeElement === ${ROW(A)}`, "the list, the focus on A's row, the peek open");
  await p.key('Escape');
  await soon(`${PEEK} && !${IS_OPEN} && history.state?.page === '#board' && document.activeElement === document.getElementById('tt-peek')`, 'the panel closed, the peek open, the focus on #tt-peek');
  assert.equal(await p.ev(STORE), null, 'closed is remembered');

  // G's row under the peek: the peek closes, Goals with G's card
  await p.click('#tt-peek');
  await soon(AT_REST, 'the panel over the peek');
  await p.click('#th-tabs [role="tab"][data-tab="threads"]');
  await soon(`${AT_REST} && !!${ROW(G)}`, 'the panel over the peek, on Threads');
  await soon(STEADY(`#tl-list [data-tl-open="${G}"]`), 'the row at rest');
  await p.click(`#tl-list [data-tl-open="${G}"]`);
  await soon(`location.hash === '#goals?th=open&t=${G}' && ${NO_PEEK} && ${FLOATING(G)}`, "Goals, the peek closed, G's card open");
  assert.equal(await p.ev(STORE), JSON.stringify({ th: 'open' }), 'a floating t is not remembered');
  await p.click('#th-close');
  await soon(`!${IS_OPEN} && ${STORE} === null`, 'closed');
});

test('reload and Back', { skip: SKIP, timeout: 600000 }, async (t) => {
  const F = threadsFixture('threads-history');
  const A = idOf(F.owner(['thread', 'new', 'Where do we start?']));
  F.sup(['thread', 'reply', A, 'Here, I think.']);
  const G = idOf(F.owner(['thread', 'new', 'About this goal', '--subject', JSON.stringify({ kind: 'item', ref: `goal:${F.goal}` })]));
  F.sup(['thread', 'reply', G, 'On it.']);
  const R = idOf(F.owner(['thread', 'new', 'A done thing']));
  F.owner(['thread', 'resolve', R, '--outcome', 'ok']);
  const { p, soon, reload, chrome, port } = await open(t, F, `#overview?th=open&t=${A}`);
  const go = async (hash, what) => { await p.ev(`location.hash = ${JSON.stringify(hash)}; void 0`); await soon(`location.hash === ${JSON.stringify(hash)}`, what); };
  const nav = async (page) => { await soon(STEADY(`.side nav.nav a[href="#${page}"]`), `the ${page} link at rest`); await p.click(`.side nav.nav a[href="#${page}"]`); };
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  // AC7: a reload keeps the panel on A
  await soon(`${AT_REST} && ${IN_PANEL(A)}`, 'A in the panel');
  await reload();
  await soon(`location.hash === '#overview?th=open&t=${A}' && ${IN_PANEL(A)}`, 'reloaded: A in the panel');
  assert.equal(await p.ev(STORE), JSON.stringify({ th: 'open', t: A }), 'remembered');

  // a fresh tab on #goals, /api/threads held by its own init script (at least 3 s, then until the test lets it go,
  // so a loaded box can't end the hold before the checks): the stored keys written into its hash at once, kept
  // while the read is held, the store unchanged; A opens in the panel when the read lands
  await soon(AT_REST, 'the panel at rest before the second tab');
  const q = await chrome.newPage();
  t.after(() => q.close());
  await q.send('Page.enable');
  await q.send('Runtime.enable');
  await q.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await q.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const t0 = Date.now(); const gate = new Promise((r) => { window.__let = r; }); const rf = window.fetch; window.fetch = async (u, o) => { if (String(u).startsWith('/api/threads')) { await gate; await new Promise((r) => setTimeout(r, Math.max(0, t0 + 3000 - Date.now()))); } return rf(u, o); }; })()` });
  await q.send('Page.navigate', { url: `http://127.0.0.1:${port}/#goals` });
  const soonQ = soonIn(q, 30000);
  await soonQ(`typeof DATA === "object" && DATA !== null && location.hash === '#goals?th=open&t=${A}'`, 'the remembered keys in the new tab');
  assert.deepEqual(await q.ev(`[TL.have, location.hash, ${STORE}, document.body.classList.contains('threads-open')]`), [0, `#goals?th=open&t=${A}`, JSON.stringify({ th: 'open', t: A }), true], 'held: t kept, the store unchanged, the panel open');
  await pause(1000);
  assert.deepEqual(await q.ev(`[TL.have, location.hash, ${STORE}]`), [0, `#goals?th=open&t=${A}`, JSON.stringify({ th: 'open', t: A })], 'still held, still kept');
  await q.ev('window.__let(); void 0');
  await soonQ(`TL.have > 0 && ${IN_PANEL(A)} && location.hash === '#goals?th=open&t=${A}'`, 'A in the panel once the read lands');
  // the tab closed, not only its socket: close() only drops the socket, and a tab left open can keep the first
  // behind it (CI: the first tab still hidden, 'the first tab in front'); closed, the first tab is the only one
  await q.send('Page.close');
  q.close();
  // the first tab in front again: a tab behind another runs no transitions after a reload
  await p.send('Page.bringToFront');
  await soon(`document.visibilityState === 'visible' && ${AT_REST}`, 'the first tab in front, the panel at rest');
  await p.ev(FRAMES);
  await soon(STEADY('#th-pane [data-tl-back]'), 'the back arrow at rest');

  // after opening a thread from the list, Back shows the list; Back after the back arrow reopens the thread
  await p.click('#th-pane [data-tl-back]');
  await soon(`location.hash === '#overview?th=open' && !!${ROW(A)}`, 'the list');
  await p.click(`#tl-list [data-tl-open="${A}"]`);
  await soon(`location.hash === '#overview?th=open&t=${A}' && ${IN_PANEL(A)}`, 'A from the list');
  await p.ev('history.back()');
  await soon(`location.hash === '#overview?th=open' && ${AT_REST} && !!${ROW(A)} && ${CARD}.hidden`, 'Back: the list');
  await p.click(`#tl-list [data-tl-open="${A}"]`);
  await soon(`${IN_PANEL(A)}`, 'A again');
  await p.click('#th-pane [data-tl-back]');
  await soon(`location.hash === '#overview?th=open' && !!${ROW(A)}`, 'the arrow: the list');
  await p.ev('history.back()');
  await soon(`location.hash === '#overview?th=open&t=${A}' && ${IN_PANEL(A)}`, 'Back after the arrow: A again');

  // × then a nav click: closed; the focus back on .tt; opening by .tt focuses the selected tab
  await soon(AT_REST, 'the panel at rest');
  await p.click('#th-close');
  await soon(`location.hash === '#overview' && !${IS_OPEN} && ${STORE} === null && ${PANEL_SHUT}`, 'closed, nothing remembered, at rest');
  await soon("document.activeElement === document.querySelector('.pagebar .tt')", 'the focus on .tt');
  await nav('goals');
  await soon(`location.hash === '#goals' && !${IS_OPEN}`, 'Goals, still closed');
  // with the panel open on the list, a nav click carries th=open
  await soon(STEADY('.pagebar .tt'), 'the button at rest');
  await p.click('.pagebar .tt');
  await soon(`location.hash === '#goals?th=inbox' && ${AT_REST}`, 'the panel on Goals');
  assert.equal(await p.ev("document.activeElement?.closest('#th-tabs [role=\"tab\"]')?.getAttribute('aria-selected')"), 'true', 'the focus on the selected tab');
  await p.click('#th-tabs [role="tab"][data-tab="threads"]');
  await soon(`location.hash === '#goals?th=open' && ${AT_REST}`, 'the panel on Goals, on Threads');
  await nav('overview');
  await soon(`location.hash === '#overview?th=open' && ${IS_OPEN}`, 'Overview with the panel');
  // with a floating card open and the panel open, a nav click carries th=open only
  await soon(`${AT_REST} && !!${ROW(G)}`, "G's row");
  await soon(STEADY(`#tl-list [data-tl-open="${G}"]`), 'the row at rest');
  await p.click(`#tl-list [data-tl-open="${G}"]`);
  await soon(`location.hash === '#goals?th=open&t=${G}' && ${FLOATING(G)}`, "G's card on Goals");
  assert.equal(await p.ev(STORE), JSON.stringify({ th: 'open' }));
  await nav('overview');
  await soon(`location.hash === '#overview?th=open' && ${IS_OPEN} && ${CARD}.hidden`, 'th=open only');

  // + then Send, then Back: the list
  await soon(STEADY('#threads [data-tl-new]'), '+ at rest');
  await p.click('#threads [data-tl-new]');
  await soon("document.activeElement?.id === 'tl-c-text'", 'the draft');
  await p.type('a new one');
  await p.key('Enter', 8);
  await soon("/[?&]t=/.test(location.hash)", 't added');
  await p.ev('history.back()');
  await soon(`location.hash === '#overview?th=open' && !!${ROW(A)} && ${CARD}.hidden`, 'Back: the list');

  // bad values dropped; t without th for an in-panel thread gets th=open
  await soon(AT_REST, 'the panel at rest');
  await p.click('#th-close');
  await soon(`!${IS_OPEN} && ${STORE} === null && ${PANEL_SHUT}`, 'closed, at rest');
  await p.ev("location.hash = '#overview?th=bogus&t=BAD!'; void 0");
  await soon(`location.hash === '#overview' && !${IS_OPEN} && history.state?.page === '#overview'`, 'dropped: #overview, closed');
  await p.ev(`location.hash = '#overview?t=${A}'; void 0`);
  await soon(`location.hash === '#overview?th=open&t=${A}' && ${IN_PANEL(A)} && history.state?.page === '#overview?th=open&t=${A}'`, 'th=open added, A in the panel');

  // Review Focus 3: a remembered t the threads don't have: the list, t dropped
  await soon(AT_REST, 'the panel at rest');
  await p.click('#th-close');
  await soon(`!${IS_OPEN} && ${PANEL_SHUT}`, 'closed, at rest');
  await p.ev(`localStorage.setItem('devteam.threads.open', JSON.stringify({ th: 'open', t: 't-nope' })); void 0`);
  await nav('goals');
  await soon(`location.hash === '#goals?th=open' && ${AT_REST} && !!${ROW(A)} && ${STORE} === ${stored({ th: 'open' })}`, 'the list, t dropped');

  // a floating card's ×: a new entry without t; Back reopens it
  await soon(AT_REST, 'the panel at rest');
  await p.click('#th-close');
  await soon(`!${IS_OPEN} && ${PANEL_SHUT}`, 'closed, at rest');
  await go(`#goals?t=${G}`, "G's card");
  await soon(FLOATING(G), "G's card open");
  let n = await p.ev('history.length');
  await p.click('#tl-card [data-tl-close]');
  await soon(`location.hash === '#goals' && ${CARD}.hidden`, 'closed, t gone');
  assert.equal(await p.ev('history.length'), n + 1, 'a new entry');
  await p.ev('history.back()');
  await soon(`location.hash === '#goals?t=${G}' && ${FLOATING(G)}`, 'Back: the card again');
  await go('#goals', 'Goals');
  await soon(`${CARD}.hidden`, 'closed');

  // a resolved thread's t survives a reload; Reopen in the in-panel card reopens it
  await go(`#overview?th=resolved&t=${R}`, 'R');
  await soon(IN_PANEL(R), 'R in the panel');
  await reload();
  await soon(`location.hash === '#overview?th=resolved&t=${R}' && ${IN_PANEL(R)}`, 'reloaded: R in the panel');
  await soon(AT_REST, 'the panel at rest');
  await soon("!!document.querySelector('#tl-c-acts [data-tl-reopen]')", 'Reopen');
  await soon(STEADY('#tl-c-acts [data-tl-reopen]'), 'Reopen at rest');
  await p.click('#tl-c-acts [data-tl-reopen]');
  await soon(`TL.threads.find((x) => x.id === '${R}')?.status === 'open'`, 'reopened');
  await soon(IN_PANEL(R), 'still shown');
  await until(() => JSON.parse(F.owner(['thread', 'show', R, '--json'])).status === 'open', 'reopened on the server');

  // under a #talk/<G> card with the panel open, A from the list replaces the talk/ entry
  await go('#overview?th=open', 'the list');
  await p.ev(`location.hash = '#talk/${G}'; void 0`);
  await soon(`${FLOATING(G)} && ${IS_OPEN} && history.state?.page === '#goals?th=open&t=${G}'`, "the talk/ card over Goals, the panel kept, t added");
  n = await p.ev('history.length');
  await soon(`${AT_REST} && !!${ROW(A)}`, 'the list beside it');
  await p.click(`#tl-list [data-tl-open="${A}"]`);
  await soon(`location.hash === '#goals?th=open&t=${A}' && ${IN_PANEL(A)}`, 'the talk/ entry replaced by A in the panel');
  assert.equal(await p.ev('history.length'), n, 'history.length unchanged');
  // under a #talk/<A> card, the back arrow replaces the talk/ entry with the list
  await p.ev(`location.hash = '#talk/${A}'; void 0`);
  await soon(`location.hash === '#talk/${A}' && ${IN_PANEL(A)} && history.state?.page === '#goals?th=open&t=${A}'`, 'A by its talk/ link');
  n = await p.ev('history.length');
  await p.click('#th-pane [data-tl-back]');
  await soon(`location.hash === '#goals?th=open' && !!${ROW(A)}`, 'the talk/ entry replaced by the list');
  assert.equal(await p.ev('history.length'), n, 'history.length unchanged');

  // a pin opens its card in place (spec §2.4: today's [data-tl-pin]), no entry; its × closes it in place
  await soon(AT_REST, 'the panel at rest');
  await p.click('#th-close');
  await soon(`location.hash === '#goals' && !${IS_OPEN} && ${PANEL_SHUT}`, 'closed, at rest');
  // a fresh #talk/ link from a page head without keys: the remembered th applied before its route (review T3-2)
  await p.ev(`localStorage.setItem('devteam.threads.open', JSON.stringify({ th: 'open' })); location.hash = '#talk/${G}'; void 0`);
  await soon(`location.hash === '#talk/${G}' && ${FLOATING(G)} && ${IS_OPEN} && history.state?.page === '#goals?th=open&t=${G}'`, 'the remembered th under the talk/ card');
  await soon(AT_REST, 'the panel at rest');
  await p.click('#th-close');
  await soon(`!${IS_OPEN} && history.state?.page === '#goals?t=${G}' && ${PANEL_SHUT}`, 'the panel closed, the card kept, at rest');
  await p.ev("document.querySelector('#tl-card [data-tl-close]').click(); void 0");
  await soon(`location.hash === '#goals' && ${CARD}.hidden && !${IS_OPEN}`, 'the card closed: back to Goals');
  await soon(`!!document.querySelector('#tl-pins [data-tl-pin="${G}"]')`, "G's pin");
  n = await p.ev('history.length');
  await p.ev(`document.querySelector('#tl-pins [data-tl-pin="${G}"]').click()`);
  await soon(FLOATING(G), 'the pin: the card');
  assert.deepEqual(await p.ev('[location.hash, history.length]'), ['#goals', n], 'in place: the hash kept, no entry');
  await p.ev("document.querySelector('#tl-card [data-tl-close]').click(); void 0");
  await soon(`${CARD}.hidden`, 'closed');
  assert.deepEqual(await p.ev('[location.hash, history.length]'), ['#goals', n], 'closed in place');
  // resolving a card the route opened (its t) takes t away
  await go(`#goals?t=${G}`, "G's card by its t");
  await soon(FLOATING(G), "G's card open");
  await p.click('#tl-c-acts [data-tl-resolve]');
  await soon("!!document.querySelector('#tl-card [data-tl-resolve-go]')", 'the resolve form');
  await p.click('#tl-card [data-tl-resolve-go]');
  await soon(`location.hash === '#goals' && ${CARD}.hidden`, 'resolved: closed, t gone');
});

// An artifact on main, as the supervisor lands one (dashboard.test.mjs's landArtifact).
const VIEWER_MOCK = {
  'artifact.json': JSON.stringify({ v: 1, title: 'Viewer mock', summary: 'A page to point at', by: 'supervisor', for: [] }),
  'index.html': '<!doctype html><html><body><p id="art">the mock</p></body></html>',
};
function landArtifact(F, slug, files) {
  const dir = path.join(F.old, 'docs/devteam/project/artifacts', slug);
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); }
  F.g(['add', '-A', dir], F.old);
  F.g(['commit', '-qm', `artifact: ${slug}`], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
}
// Shown: rendered, not hidden, not faded out.
const SEEN_FN = "const seen = (el) => { if (!el) return false; const c = getComputedStyle(el); return c.display !== 'none' && c.visibility !== 'hidden' && c.opacity !== '0' && el.getClientRects().length > 0; };";
// Where #tt-peek is, against .tt's own place and the window's top right, and what is at its centre.
const MIRROR = `(() => { ${SEEN_FN} const m = document.getElementById('tt-peek'), r = m.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
  const pad = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-pad')), bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar-h'));
  const av = document.getElementById('artifact-view');
  return { seen: seen(m), hit: !!hit?.closest('#tt-peek'), fromRight: innerWidth - r.right, pad, cy: y, bar, bottom: r.bottom, avTop: av.hidden ? null : av.getBoundingClientRect().top, z: +getComputedStyle(m).zIndex, avZ: +getComputedStyle(av).zIndex }; })()`;
const VIEWER_UP = "(!document.getElementById('artifact-view').hidden && document.body.classList.contains('av-open') && document.body.classList.contains('overlay-open'))";
const MIRROR_SHOWN = `(() => { ${SEEN_FN} const m = document.getElementById('tt-peek'); return seen(m) && getComputedStyle(m).opacity === '1'; })()`;

test('with the viewer', { skip: SKIP, timeout: 600000 }, async (t) => {
  const F = threadsFixture('threads-viewer');
  landArtifact(F, 'viewer-mock', VIEWER_MOCK);
  const A = idOf(F.owner(['thread', 'new', 'Where do we start?']));
  F.sup(['thread', 'reply', A, 'Here, I think.']);
  const TK = 'ch-01-tidy-docs';
  F.sup(['ticket', 'add', TK, '--json', JSON.stringify({ title: 'Tidy the docs', feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['docs/**'], done_when: ['the docs check passes in CI'], notes: 'n' })]);
  const { p, soon, size, reload } = await open(t, F, '#overview');
  const AV = '#artifact/main/viewer-mock';
  const probe = "document.getElementById('av-right-probe').getBoundingClientRect().width";
  await p.ev("(() => { const d = document.createElement('div'); d.id = 'av-right-probe'; d.style.cssText = 'position: fixed; left: 0; top: 0; height: 1px; width: var(--av-right, 0px); pointer-events: none'; document.body.append(d); return true; })()");
  assert.equal(await p.ev(probe), 0, '--av-right unset with the panel closed');

  // the viewer up: #tt-peek at the window's top right, above it; .tt hidden; the viewer has no Inbox button
  await p.ev(`location.hash = '${AV}'; void 0`);
  await soon(VIEWER_UP, 'the viewer up, av-open set');
  await soon(MIRROR_SHOWN, '#tt-peek shown above the viewer');
  let m = await p.ev(MIRROR);
  assert.ok(m.hit, 'the element at its centre is #tt-peek');
  assert.ok(Math.abs(m.fromRight - m.pad) <= 1, `--header-pad from the right: ${JSON.stringify(m)}`);
  assert.ok(Math.abs(m.cy - m.bar / 2) <= 1.5, `centred in the --bar-h band: ${JSON.stringify(m)}`);
  assert.ok(m.bottom <= m.avTop && m.z > m.avZ, `above the viewer: ${JSON.stringify(m)}`);
  assert.equal(await p.ev("getComputedStyle(document.querySelector('.pagebar .tt')).visibility"), 'hidden', '.tt itself hidden');
  assert.equal(await p.ev("!!document.querySelector('#artifact-view .tt, #artifact-view [data-inbox]')"), false, 'the viewer has no Inbox button');
  // the backdrop: #scrim's background is --backdrop
  assert.equal(await p.ev("(() => { const d = document.createElement('div'); d.style.background = 'var(--backdrop)'; document.body.append(d); const v = getComputedStyle(d).backgroundColor; d.remove(); return getComputedStyle(document.getElementById('scrim')).backgroundColor === v && v !== 'rgba(0, 0, 0, 0)'; })()"), true, "#scrim's background is --backdrop");

  // pressed: the panel above the viewer, the viewer still up, #artifact/… still the hash
  await p.click('#tt-peek');
  await soon(`${AT_REST} && history.state?.page === '#overview?th=inbox'`, 'the panel over the viewer, on Inbox');
  await p.click('#th-tabs [role="tab"][data-tab="threads"]');
  await soon(`${AT_REST} && history.state?.page === '#overview?th=open' && !!${ROW(A)}`, 'the panel over the viewer');
  assert.deepEqual(await p.ev(`[location.hash, ${VIEWER_UP}]`), [AV, true], 'the viewer still open');
  const inPanel = await p.ev("(() => { const r = document.getElementById('threads').getBoundingClientRect(); return !!document.elementFromPoint(r.left + 60, r.top + 300)?.closest('#threads'); })()");
  assert.ok(inPanel, 'a point in the panel is the panel');
  assert.equal(await p.ev(probe), 396, '--av-right: --threads-w + 16px while open above 900px');
  // a thread opened in the panel under the viewer, then the viewer closed: its page head keeps th and t (spec §2.5)
  await p.click(`#tl-list [data-tl-open="${A}"]`);
  await soon(`${IN_PANEL(A)} && history.state?.page === '#overview?th=open&t=${A}' && location.hash === '${AV}'`, 'A in the panel, under the viewer');
  await p.clickAt(10, 450);
  await soon(`document.getElementById('artifact-view').hidden && !document.body.classList.contains('av-open') && location.hash === '#overview?th=open&t=${A}' && ${IN_PANEL(A)}`, 'the viewer closed: the page head carries th and t, A still in the panel');
  await soon(AT_REST, 'the panel at rest');
  await p.click('#th-close');
  await soon(`!${IS_OPEN} && location.hash === '#overview'`, 'the panel closed');
  await soon(`${probe} === 0`, '--av-right gone once it closes');

  // a peek and the panel at 1440x900: the drawer meets the panel, the scrim doesn't cover it, the three bars level
  await p.ev(`location.hash = '#ticket/${TK}'; void 0`);
  await soon(PEEK, 'the peek');
  await soon(MIRROR_SHOWN, '#tt-peek beside the peek');
  assert.deepEqual(await p.ev("(() => { const a = document.querySelector('.pagebar .tt'), b = document.getElementById('tt-peek'); return [b.getAttribute('aria-label'), b.getAttribute('title')].join('|') === [a.getAttribute('aria-label'), a.getAttribute('title')].join('|') && !!b.getAttribute('title'); })()"), true, "#tt-peek's aria-label and title are .tt's");
  await p.click('#tt-peek');
  await soon(`${AT_REST} && ${PEEK}`, 'the panel beside the peek');
  await soon("getComputedStyle(document.getElementById('drawer')).right === '380px'", 'the drawer moved over');
  const g = await p.ev("(() => { const d = document.getElementById('drawer').getBoundingClientRect(), th = document.getElementById('threads').getBoundingClientRect(); const b = (s) => document.querySelector(s).getBoundingClientRect().bottom; return { dr: d.right, tl: th.left, hit: !!document.elementFromPoint(th.left + 60, th.top + 300)?.closest('#threads'), heads: [b('.drawer-head'), b('.pagebar'), b('.threads-head')] }; })()");
  assert.ok(Math.abs(g.dr - g.tl) <= 1, `the drawer's right edge is the panel's left edge: ${JSON.stringify(g)}`);
  assert.ok(g.hit, 'the scrim does not cover the panel');
  assert.ok(Math.max(...g.heads) - Math.min(...g.heads) <= 1, `the three bars level: ${JSON.stringify(g)}`);
  await p.click('#th-close');
  await soon(`!${IS_OPEN} && ${PEEK}`, 'the panel closed, the peek open');

  // the viewer opened over the peek: #tt-peek at the window's top right, not beside the peek
  await soon(MIRROR_SHOWN, '#tt-peek beside the peek again');
  await p.ev(`location.hash = '${AV}'; void 0`);
  await soon(`${VIEWER_UP} && document.body.classList.contains('peek-open')`, 'the viewer over the peek');
  await soon(`(() => { const r = document.getElementById('tt-peek').getBoundingClientRect(); return Math.abs(innerWidth - r.right - 16) <= 1; })()`, '#tt-peek moved to the top right');
  m = await p.ev(MIRROR);
  assert.ok(m.seen && m.hit && Math.abs(m.fromRight - m.pad) <= 1, `over a peek, at the top right: ${JSON.stringify(m)}`);

  // 720x800: the panel overlays (left 0); with the viewer up #tt-peek is hidden and #av-close is what is at its place
  await p.ev(`location.hash = '#overview'; void 0`);
  await soon(`location.hash === '#overview' && document.getElementById('artifact-view').hidden && ${NO_PEEK}`, 'back on Overview');
  await size(720, 800);
  await soon("innerWidth === 720", '720 wide');
  await soon(STEADY('.pagebar .tt'), '.tt at rest');
  await p.click('.pagebar .tt');
  await soon(AT_REST, 'the panel open at 720');
  assert.equal(await p.ev("document.getElementById('threads').getBoundingClientRect().left"), 0, 'it overlays: its left edge is 0');
  assert.equal(await p.ev(probe), 0, 'no --av-right at 900px and below');
  await p.click('#th-close');
  await soon(`!${IS_OPEN}`, 'closed');
  await reload();
  await p.ev(`location.hash = '${AV}'; void 0`);
  await soon(VIEWER_UP, 'the viewer up at 720');
  const small = await p.ev(`(() => { ${SEEN_FN} const c = document.getElementById('av-close').getBoundingClientRect(); return { mirror: seen(document.getElementById('tt-peek')), close: !!document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2)?.closest('#av-close') }; })()`);
  assert.deepEqual(small, { mirror: false, close: true }, '#tt-peek hidden, #av-close not covered');
  // and the panel with the viewer up at 720: it overlays (left 0), no --av-right
  // (the reload dropped the probe)
  await p.ev("(() => { const d = document.createElement('div'); d.id = 'av-right-probe'; d.style.cssText = 'position: fixed; left: 0; top: 0; height: 1px; width: var(--av-right, 0px); pointer-events: none'; document.body.append(d); return true; })()");
  await p.ev("thGo({ th: 'open' }); void 0");
  await soon(AT_REST, 'the panel open over the viewer at 720');
  assert.equal(await p.ev("document.getElementById('threads').getBoundingClientRect().left"), 0, 'with the viewer up it overlays: its left edge is 0');
  assert.equal(await p.ev(probe), 0, 'no --av-right at 900px and below, the viewer up');
  await p.click('#th-close');
  await soon(`!${IS_OPEN}`, 'closed over the viewer');
  await size(1440, 900);
});

test('the /view/ tab', { skip: SKIP, timeout: 300000 }, async (t) => {
  const F = threadsFixture('threads-view-tab');
  landArtifact(F, 'viewer-mock', VIEWER_MOCK);
  F.sup(['ask', '--question', 'Which way?', '--choices', '[{"label":"Left"},{"label":"Right"}]', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
  const A = idOf(F.owner(['thread', 'new', 'Where do we start?']));
  F.sup(['thread', 'reply', A, 'Here, I think.']);
  const G = idOf(F.owner(['thread', 'new', 'About this goal', '--subject', JSON.stringify({ kind: 'item', ref: `goal:${F.goal}` })]));
  F.sup(['thread', 'reply', G, 'On it.']);
  const later = cleanup(t);
  later(() => F.done());
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  later(() => dash.stop());
  await until(async () => { try { return (await (await fetch(`http://127.0.0.1:${port}/api/hello`)).json()).inbox === 1; } catch { return false; } }, "hello's inbox");
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  const size = (width, height) => p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await size(1440, 900);
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__asked = []; { const rf = window.fetch; window.fetch = (u, o) => { window.__asked.push(String(u)); return rf(u, o); }; }" });
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/view/artifact/viewer-mock` });
  const soon = soonIn(p, 30000, () => dash.out());
  await soon("document.documentElement.classList.contains('viewer') && typeof TL === 'object' && TL.have > 0", 'the viewer and its threads read');

  // #tt-peek at the window's top right with the thread count and the red count; the stage below a --bar-h band
  for (const [w, h] of [[1440, 900], [720, 800]]) {
    await size(w, h);
    await soon(`innerWidth === ${w} && ${MIRROR_SHOWN} && document.querySelector('#tt-peek .n.th')?.textContent === '2' && document.querySelector('#tt-peek .n.q')?.textContent === '1'`, `#tt-peek with the counts at ${w}`);
    const m = await p.ev(MIRROR);
    assert.ok(m.hit && Math.abs(m.fromRight - m.pad) <= 1 && Math.abs(m.cy - m.bar / 2) <= 1.5, `${w}: at the top right, centred in the band: ${JSON.stringify(m)}`);
    assert.equal(m.avTop, 49, `${w}: #artifact-view's top is --bar-h`);
  }
  await size(1440, 900);
  await soon(`innerWidth === 1440 && ${MIRROR_SHOWN}`, 'back at 1440');
  // the accessible name carries the red count (hello's inbox) as well as the thread counts
  await soon("/1 open question/.test(document.getElementById('tt-peek').getAttribute('aria-label') || '')", "#tt-peek's name has the red count");
  assert.match(await p.ev("document.getElementById('tt-peek').getAttribute('aria-label')"), /^Inbox: 1 open question, .*your move/, "#tt-peek's name: the red count, then the threads");

  // pressed: the panel with the list; A's row in the pane, G's (a dashboard item: no page here) in the pane too; × closes
  await p.click('#tt-peek');
  await soon(`${AT_REST} && !!${ROW(A)} && !!${ROW(G)}`, 'the panel with the list');
  await p.click(`#tl-list [data-tl-open="${A}"]`);
  await soon(IN_PANEL(A), 'A in the pane');
  await p.click('#th-pane [data-tl-back]');
  await soon(`!!${ROW(G)}`, 'the list again');
  await soon(STEADY(`#tl-list [data-tl-open="${G}"]`), 'the row at rest');
  await p.click(`#tl-list [data-tl-open="${G}"]`);
  await soon(IN_PANEL(G), 'G in the pane');
  await p.click('#th-close');
  await soon(`!${IS_OPEN} && ${MIRROR_SHOWN}`, 'closed, #tt-peek again');
  assert.equal(await p.ev("location.pathname + location.hash"), '/view/artifact/viewer-mock', 'no route');
  assert.deepEqual(await p.ev("window.__asked.filter((u) => u.startsWith('/api/data'))"), [], '/api/data never asked');
});

// kit-89 done-when 9: the design's gap-audit rows, asserted in one place, on a fixture of their own.
test('the gap-audit rows', { skip: SKIP, timeout: 300000 }, async (t) => {
  const F = threadsFixture('threads-gap-audit');
  F.sup(goalArgs('Self-serve billing', 2));
  const O = idOf(F.owner(['thread', 'new', 'An open one']));
  F.sup(['thread', 'reply', O, 'Over to you.']);
  const D = idOf(F.owner(['thread', 'new', 'A done one']));
  F.owner(['thread', 'resolve', D, '--outcome', 'ok']);
  const { p, soon } = await open(t, F, '#goals');
  const card = "document.getElementById('tl-card')";
  const turns = (id) => JSON.parse(F.owner(['thread', 'show', id, '--json'])).turns.map((u) => u.text);
  const g = `#goals-list [data-subject="goal:${F.goal}"] h4`;

  // 1. Pin starts a thread by pointing, without Shift: a floating draft beside the goal, pin mode ended
  await p.click('.pagebar .tt');
  await soon(`${IS_OPEN} && getComputedStyle(document.getElementById('threads')).transform === 'none' && getComputedStyle(document.querySelector('.main')).marginRight === '380px'`, 'the panel at rest');
  // on its Threads tab (the button opens the Inbox tab, kit-100)
  await p.click('#th-tabs [role="tab"][data-tab="threads"]');
  await soon("location.hash.endsWith('th=open') && !!document.querySelector('#th-pane [data-thf]')", 'the panel on Threads');
  await soon(STEADY('#tl-pinbtn'), 'Pin at rest');
  await p.click('#tl-pinbtn');
  await soon("TL.pin && document.getElementById('tl-pinbtn').getAttribute('aria-pressed') === 'true'", 'pin mode on');
  await soon(`!!document.querySelector(${JSON.stringify(g)})`, 'the goal card');
  await soon(STEADY(g), 'the goal card at rest');
  const at = await p.at(g);
  await p.move(at.x, at.y, 0);
  await soon("!document.getElementById('tl-cursor').hidden", 'the pin without Shift');
  await p.clickAt(at.x, at.y, 0);
  await soon(`TL.draft?.subject?.ref === 'goal:${F.goal}' && ${card}.parentElement?.id === 'tl' && !${card}.hidden && !${card}.classList.contains('in-panel') && document.activeElement?.id === 'tl-c-text'`, 'a floating draft beside the goal');
  // pin mode lasts "until Esc or the Pin button again" (the code's own words): still on after the click; Esc ends it
  assert.equal(await p.ev('TL.pin'), true, 'pin mode stays on after a thread starts');
  await p.key('Escape');
  await soon('!TL.pin', 'pin mode ended by Esc');
  assert.equal(await p.ev("document.getElementById('tl-pinbtn').getAttribute('aria-pressed')"), 'false', 'Pin no longer pressed');
  assert.equal(await p.ev('!!TL.draft && !' + card + '.hidden'), true, 'the draft survives Esc');
  await p.ev("document.getElementById('tl-c-text').focus()");

  // 2. Shift+Enter sends a new thread: listed in the panel, the composer empty
  await p.type('from the pin');
  await p.key('Enter', 8);
  const N = await soon(`TL.threads.find((x) => x.subject?.ref === 'goal:${F.goal}' && !String(x.id).startsWith('pending-') && !x.pending)?.id`, 'the new thread read');
  await soon(`!!document.querySelector('#tl-list [data-tl-open="${N}"]')`, 'listed in the panel');
  assert.equal(await p.ev("document.getElementById('tl-c-text').value"), '', 'the composer is empty');
  await until(() => turns(N).includes('from the pin'), 'the new thread on the server');
  await p.click('#tl-card [data-tl-close]');
  await soon(`${card}.hidden`, 'the draft card closed');

  // 3. Shift+Enter sends a reply: in an existing open thread's card
  await p.click(`#tl-list [data-tl-open="${O}"]`);
  await soon(`${card}.dataset.key === '${O}' && !${card}.hidden && !!document.getElementById('tl-c-text')`, "O's card");
  await p.ev("document.getElementById('tl-c-text').focus()");
  await p.type('a reply');
  await p.key('Enter', 8);
  await soon("/a reply/.test(document.getElementById('tl-c-turns').textContent)", 'the turn shows in the card');
  await until(() => turns(O).includes('a reply'), 'the reply on the server');
  assert.ok((await (await fetch(`http://127.0.0.1:${(await p.ev('location.port'))}/api/threads`)).text()).includes('a reply'), '/api/threads has it');
  assert.equal(await p.ev("document.getElementById('tl-c-text').value"), '', 'the composer is empty');

  // 4. A resolved thread has Reopen
  await p.click('#th-pane [data-tl-back]');
  await soon(STEADY('#th-pane [data-thf="resolved"]'), 'the Resolved filter at rest');
  await p.click('#th-pane [data-thf="resolved"]');
  await soon(`!!document.querySelector('#tl-list [data-tl-open="${D}"]')`, 'the resolved thread listed');
  await p.click(`#tl-list [data-tl-open="${D}"]`);
  await soon(`${card}.dataset.key === '${D}' && !${card}.hidden && !!document.querySelector('#tl-c-acts [data-tl-reopen]')`, 'Reopen on the resolved thread');
});
