// The Threads panel (kit-89): a full-height side panel with real tabs, opened from the top-right Inbox
// button, which carries the threads' counts. Headless Chrome against a real dashboard on a project of
// its own (threadsFixture), skipped where Chrome can't be driven, as the kit's other Chrome tests are.
import { test } from 'node:test';
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
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: POLL_FAST });
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/${hash}` });
  const soon = soonIn(p, 30000, () => dash.out());
  await soon('typeof DATA === "object" && DATA !== null && TL.have > 0', 'the page and its threads read');
  return { p, soon, size };
}

test('the panel and its button', { skip: SKIP, timeout: 300000 }, async (t) => {
  const F = threadsFixture('threads-sidebar');
  F.sup(goalArgs('Self-serve billing', 2));
  F.sup(['ask', '--question', 'Which way?', '--choices', '[{"label":"Left"},{"label":"Right"}]', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
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
  await soon(`location.hash === '#overview?th=open' && ${isOpen}`, 'the panel open on #overview?th=open');
  // at rest: the margin's slide (--dur) has ended
  await soon("getComputedStyle(document.querySelector('.main')).marginRight === '380px'", ".main's right margin is --threads-w");
  const openRight = await p.ev("document.querySelector('.main').getBoundingClientRect().right");
  assert.ok(Math.abs(closedRight - openRight - 380) <= 1, `.main's right edge moved left by 380px: ${closedRight} to ${openRight}`);
  assert.deepEqual(await p.ev(`[getComputedStyle(${tt}).visibility, getComputedStyle(document.getElementById('tt-peek')).visibility]`), ['hidden', 'hidden'], '.tt and #tt-peek hidden');
  await soon("getComputedStyle(document.getElementById('threads')).transform === 'none'", 'slid in');
  assert.equal(await p.ev("document.activeElement?.closest('#th-tabs [role=\"tab\"]')?.dataset.tab"), 'threads', 'the focus on the selected tab');

  // its head: --bar-h tall, level with the page bar
  const head = await p.ev("(() => { const h = document.querySelector('#threads .threads-head').getBoundingClientRect(), b = document.querySelector('.pagebar').getBoundingClientRect(); return { h: h.height, hb: h.bottom, bb: b.bottom }; })()");
  assert.equal(head.h, 49, '.threads-head is 49px');
  assert.ok(Math.abs(head.hb - head.bb) <= 1, `level with .pagebar: ${JSON.stringify(head)}`);

  // the tabs: Threads, then two disabled slots, with their titles
  assert.deepEqual(await p.ev('threadsTabs.list().map((t) => [t.id, t.disabled])'), [['threads', false], ['supervisor', true], ['shell', true]]);
  const tabs = await p.ev("[...document.querySelectorAll('#th-tabs [role=\"tab\"]')].map((b) => ({ id: b.dataset.tab, sel: b.getAttribute('aria-selected'), dis: b.getAttribute('aria-disabled'), title: b.getAttribute('title'), n: b.querySelector('.n')?.className ?? null, nt: b.querySelector('.n')?.textContent ?? null, text: b.textContent }))");
  assert.deepEqual(tabs.map((x) => [x.id, x.sel, x.dis]), [['threads', 'true', null], ['supervisor', 'false', 'true'], ['shell', 'false', 'true']]);
  assert.equal(tabs[1].title, "The supervisor's terminal: the follow-on goal");
  assert.equal(tabs[2].title, 'A plain shell at the repo root: the follow-on goal');
  assert.deepEqual([tabs[0].n, tabs[0].nt], ['n blue', '2'], 'Threads counts the two your-move threads, in blue');
  assert.match(tabs[0].text, /^Threads/);

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
  // the Inbox page by its redirect
  await p.ev("location.hash = '#overview?th=inbox'");
  await soon("location.hash === '#inbox' && document.querySelector('main.page > section[data-page=\"inbox\"]').classList.contains('on')", 'the Inbox page');
  await p.ev("location.hash = '#overview'");
  await soon("document.querySelector('main.page > section[data-page=\"overview\"]').classList.contains('on')", 'Overview');

  // the dock is gone
  assert.deepEqual(await p.ev("['tl-pill', 'tl-panel', 'tl-dock', 'ask-dock'].filter((id) => document.getElementById(id))"), []);

  // narrow: the panel covers the page, Shift over it shows no pin
  await size(720, 800);
  await soon("innerWidth === 720 && getComputedStyle(document.querySelector('.pagebar .tt')).visibility === 'visible'", 'at 720');
  await soon(STEADY('.pagebar .tt'), 'the button at rest');
  await p.click('.pagebar .tt');
  await soon(`${isOpen} && getComputedStyle(document.getElementById('threads')).transform === 'none'`, 'open at 720');
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

  // A's question in the panel: its words are its own, the Inbox page's copy untouched
  const qBox = `#tl-c-turns textarea[data-q="${QA}"]`;
  await soon(`!!document.querySelector('${qBox}') && !!document.querySelector('main textarea[data-q="${QA}"]')`, 'both copies of the question');
  await p.ev(`document.querySelector('${qBox}').focus()`);
  await p.type('panel words');
  await p.ev('window.__threadsRead = 0; void 0');
  await soon('window.__threadsRead > 0', 'a read of the threads');
  await pause(700);
  assert.deepEqual(await p.ev(`[document.querySelector('${qBox}').value, document.querySelector('main textarea[data-q="${QA}"]').value]`), ['panel words', ''], "the panel's words kept, the Inbox's copy unchanged");
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
  await p.click('#th-close');
  await soon(`!${isOpen}`, 'closed');
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
  // Y1 has no subject: it opened in the panel; the panel closed takes it away
  await p.ev("location.hash = '#overview'");
  await soon("!document.body.classList.contains('threads-open') && document.getElementById('tl-card').hidden", 'the panel and its thread closed');

  // the ready one accepted: blue, counting the your-move ones
  F.owner(['thread', 'resolve', C2, '--accept']);
  await soon(`${n('.you')} === '1'`, 'blue 1');
  // that one answered: grey, counting the open threads; Threads' tab has no number
  F.owner(['thread', 'say', Y2, 'Noted.']);
  await soon(`${n('.wait')} === '3'`, 'grey 3');
  await p.click('.pagebar .tt');
  await soon("document.body.classList.contains('threads-open') && !!document.querySelector('#th-tabs [data-tab=\"threads\"]')", 'the panel');
  assert.equal(await p.ev("document.querySelector('#th-tabs [data-tab=\"threads\"] .n')"), null, 'no number on Threads');
  assert.equal(await p.ev("document.querySelector('.pagebar .tt').getAttribute('title')"), '3 waiting on the supervisor');
  // none open: no thread count
  for (const id of [Y1, Y2, W]) F.owner(['thread', 'resolve', id]);
  await soon("!document.querySelector('.pagebar .tt .n.th') && /No open threads\\. Hold Shift and click anything on the page, or start one with \\+\\./.test(document.getElementById('th-pane').textContent)", 'no thread count, the empty line');
  await p.click('#th-close');
  await soon("!document.body.classList.contains('threads-open')", 'closed');
});
