// Threads on the dashboard page in Chrome, parts 5 and 6: a question answered in the Inbox, across a late read, and elsewhere.
// Ports: none of its own (lib/kit.mjs's +0 hub, +1..25)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashboardOnFreePort, until, threadsFixture } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { soonIn, POLL_FAST } from './lib/dashboard-page.mjs';

// The threads page's setup, the one test's own before it was cut in parts (base :3177-3238: a fixture,
// a dashboard, a Chrome page under POLL_FAST at #goals, and the steps its subtests share), for each
// part; a part then builds the rest of the state its subtests read, through the kit's commands.
async function openThreadsPage(t, name) {
  // stopped last-in first-out, each whatever the one before did: the fixture's files go only once the
  // dashboard writing into them has stopped, and one cleanup that throws leaves no Chrome running
  const later = cleanup(t);
  const F = threadsFixture(name);
  later(() => F.done());
  const Q0 = F.sup(['ask', '--question', 'Which way?', '--choices', '[{"label":"Left"},{"label":"Right"}]', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: POLL_FAST });
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#goals` });
  // 30 s, however long each look takes: a loaded runner's page answers slowly
  const soon = soonIn(p);
  // A step no poll may move: the page held still from finding what to press until it is pressed, so a
  // redraw (the Inbox growing above the goal, the card placed again as it grows) can't move it between.
  const still = async (f) => { await p.ev('window.__still()'); try { return await f(); } finally { await p.ev('window.__stir()'); } };
  // A release's own work runs a task later (pointerup's setTimeout: the press let go, what it held back
  // drawn, the card placed again as it has grown), and a CDP call can come first: the next step's
  // look at where a button is could see the card before it moves. So a click ends once that has run.
  const released = () => soon('!TL.pressed && PRESSED === 0', 'the release handled');
  const click = (sel) => still(async () => { await p.click(sel); await released(); });
  // the panel open on its Threads tab: the Inbox button opens it on its Inbox tab (kit-100), so Threads is a
  // click on its tab, once the panel is at rest
  const onThreads = async () => {
    if (!await p.ev(`document.body.classList.contains('threads-open')`)) await click('.pagebar .tt');
    await soon(`document.body.classList.contains('threads-open') && getComputedStyle(document.getElementById('threads')).transform === 'none'`, 'the panel open, at rest');
    const tab = '#th-tabs [role="tab"][data-tab="threads"]';
    if (await p.ev(`document.querySelector('${tab}')?.getAttribute('aria-selected') !== 'true'`)) await click(tab);
    await soon(`document.querySelector('${tab}')?.getAttribute('aria-selected') === 'true' && !!document.getElementById('th-inbox').hidden`, 'the panel on Threads');
  };
  const goalSel = `#goals-list [data-subject="goal:${F.goal}"]`;
  const shown = (id) => `!document.getElementById('${id}').hidden`;
  // the peek slid in (kit-88): shown, and at rest, so a point read on it stays where it is
  const slid = () => `${shown('drawer')} && getComputedStyle(document.getElementById('drawer')).transform === 'none'`;
  await soon(`!!document.querySelector('${goalSel}')`, 'the goal card');
  const threads = () => JSON.parse(F.owner(['thread', 'list', '--all', '--json']));
  // An Enter keyDown as a keyboard sends it, with its '\r' (p.key sends none), so a newline lands
  // unless the page cancels the key. It can be sent with Shift, Ctrl, Alt or Meta, as a key repeat, or as 229
  // (the Enter that ends an IME's composition). Each arrives in window.__keys, so a check knows the
  // key it meant reached the page.
  const enter = async ({ shift = false, ctrl = false, alt = false, meta = false, repeat = false, code = 13 } = {}) => {
    const k = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: code, modifiers: (shift ? 8 : 0) | (meta ? 4 : 0) | (ctrl ? 2 : 0) | (alt ? 1 : 0) };
    await p.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k, text: '\r', autoRepeat: repeat });
    await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
  };
  // a composition's Enter as the page sees it: CDP can't start one, so the event is made on the box
  const composing = () => p.ev(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, isComposing: true, bubbles: true, cancelable: true }))`);
  const lastKey = () => p.ev('window.__keys.at(-1)');
  // what the owner sent, from the fixture's record of every POST: an answer or a thread's words
  const posts = () => p.ev(`(window.__posts ?? []).filter((x) => /^\\/api\\/(answer|thread-say|thread-new|thread-reopen)$/.test(x.url)).length`);
  // the page's own time going by: 8 of its polls (about 2.4 s under POLL_FAST), in which a send a key
  // set off, at once or later, would have gone through
  // (each poll waits for the read before it, so a loaded runner stretches them: 2 minutes to see 8)
  const soonTicks = soonIn(p, 120000);
  const ticks = async (n = 8) => { const at = await p.ev('window.__polls'); await soonTicks(`window.__polls >= ${at + n}`, `${n} polls`); };
  return { F, Q0, dash, port, p, soon, still, released, click, onThreads, goalSel, shown, slid, threads, enter, composing, lastKey, posts, soonTicks, ticks, later };
}

test("threads on the dashboard page: Shift and point, the card, the pins and the dock (part 5 of 8: answered in the Inbox, a read landing late)", { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 300000 }, async (t) => {
  const { F, p, soon, click, goalSel, threads } = await openThreadsPage(t, 'threads-page-5');
  let T;
  // T as the page makes it in subtest 6 (base :3328-3349: the owner's first words on the goal, with
  // the subject and title its Shift+click gives, as :3344 asserts) and subtest 9's reply (:3373)
  T = F.owner(['thread', 'new', 'Narrow this to the EU launch', '--title', 'Launch checkout', '--subject', JSON.stringify({ kind: 'item', ref: `goal:${F.goal}`, quote: 'Launch checkout' })]).split('\n')[0];
  { const th = threads().find((x) => x.id === T); assert.deepEqual([th.subject.kind, th.subject.ref, th.title], ['item', `goal:${F.goal}`, 'Launch checkout']); }
  F.sup(['thread', 'reply', T, 'That drops the measure to EU orders; want me to propose the change?', '--no-ask', 'a test of the page, not of asks']);
  // the keys log subtest 12 installs (:3408), there from subtest 12 on in the base
  await p.ev(`(() => { if (window.__keys) return; window.__keys = []; addEventListener('keydown', (e) => { const { key, shiftKey, ctrlKey, altKey, metaKey, keyCode, isComposing, repeat } = e; window.__keys.push({ key, shiftKey, ctrlKey, altKey, metaKey, keyCode, isComposing, repeat }); }, true); })()`);
  // the page at #goals, the card closed and T's pin drawn, as subtest 19 leaves it (:3643's wait)
  await soon(`!!document.querySelector('${goalSel}') && !!document.querySelector('[data-tl-pin="${T}"]')`, 'the goal and its pin');
  // the card open from its pin, as subtest 21 leaves it (:3644-3645)
  await click(`[data-tl-pin="${T}"]`);
  await soon(`document.getElementById('tl-card').dataset.key === '${T}'`, 'its card');

  await t.test("answered in the Inbox, it shows answered in the thread; a hostile question and thread title are only text", async () => {
    const H = '<img src=x onerror="window.__xss=1">';
    const Q = F.sup(['thread', 'ask', T, '--question', `${H} Ship it?`, '--goal', F.goal, '--stake', '1', '--urgency', '1']);
    await soon(`!!document.getElementById('t-q-${Q}') && !!document.getElementById('q-${Q}')`, 'both copies');
    assert.ok(await p.ev(`document.getElementById('t-q-${Q}').textContent.includes(${JSON.stringify(H)})`), 'the words as written');
    assert.equal(await p.ev(`!!document.querySelector('#tl img') || !!document.querySelector('#q-${Q} img') || !!window.__xss`), false, 'no element made from them');
    await p.ev(`(() => { const c = document.getElementById('q-${Q}'); c.querySelector('textarea[data-q]').value = 'ship it'; c.querySelector('button[data-answer="${Q}"]').click(); })()`);
    await until(() => JSON.parse(F.owner(['questions', '--id', Q, '--json']))[0].status === 'answered', 'the answer');
    await soon(`!document.getElementById('t-q-${Q}')?.querySelector('textarea, button[data-answer]') && /ship it/.test(document.getElementById('tl-c-turns').textContent)`, 'answered in the thread too');
    const X = F.owner(['thread', 'new', 'hello', '--title', `${H} hello`]).split('\n')[0];
    // no subject: it opens in the panel, through the route
    await p.ev(`location.hash = '#goals?th=open&t=${X}'`);
    await soon(`document.getElementById('tl-c-title').textContent === ${JSON.stringify(`${H} hello`)} && !!document.querySelector('#th-card-slot #tl-card.in-panel')`, 'the title as written');
    assert.equal(await p.ev(`!!document.querySelector('#tl img, #threads img') || !!window.__xss`), false, 'no element made from the title');
    await soon(`getComputedStyle(document.getElementById('threads')).transform === 'none'`, 'the panel at rest');
    await click('[data-tl-back]');
    // closed by its × (kit-89 T3: a nav to a head without keys would carry the remembered panel)
    await soon(`location.hash === '#goals?th=open' && !!document.querySelector('#tl-list')`, 'the list');
    await click('#th-close');
    await soon(`!document.body.classList.contains('threads-open') && location.hash === '#goals'`, 'the panel closed');
    F.owner(['thread', 'resolve', X]);
    await p.ev('tlRefresh()');
    await click(`[data-tl-pin="${T}"]`);
    await soon(`document.getElementById('tl-card').dataset.key === '${T}'`, 'its card again');
  });

  await t.test("a read of the threads begun before an answer, landing after the page has dropped the question, doesn't show it unanswered", async () => {
    const Q = F.sup(['thread', 'ask', T, '--question', 'Ship to the EU first?', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
    await soon(`!!document.getElementById('t-q-${Q}') && !!document.getElementById('q-${Q}') && document.getElementById('tl-card').dataset.key === '${T}'`, 'both copies');
    // every read of the threads from here held back once read; any Inbox link for the question drawn in the card noted
    await p.ev(`window.__threadsQueue = []; window.__inboxLink = false; window.__obs = new MutationObserver((records) => { const link = 'a[href="#q/${Q}"]'; if (records.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches(link) || !!n.querySelector(link)))) || document.querySelector('#tl-c-turns ' + link)) window.__inboxLink = true; }); window.__obs.observe(document.getElementById('tl-card'), { childList: true, subtree: true }); tlRefresh(); void 0`);
    await soon('window.__threadsQueue.length > 0', 'a read saying the question is open, held');
    // the reads held so far were all read before the answer: they say it is open
    await p.ev(`(() => { window.__stale = window.__threadsQueue.length; const c = document.getElementById('q-${Q}'); c.querySelector('textarea[data-q]').value = 'EU first'; c.querySelector('button[data-answer="${Q}"]').click(); })()`);
    try {
      await until(() => JSON.parse(F.owner(['questions', '--id', Q, '--json']))[0].status === 'answered', 'the answer');
      await soon(`!DATA.questions.some((x) => x.id === '${Q}') && !document.getElementById('q-${Q}')`, 'the page redrawn without the question');
      // the stale reads land, the newest of them drawn, and nothing newer yet
      const have = await p.ev('TL.have');
      await p.ev('window.__threadsQueue.splice(0, window.__stale).forEach((go) => go())');
      await p.ev('window.__still()');
      await p.ev('window.__stir()');
      assert.ok(await p.ev('TL.have') > have, 'the stale read landed');
      assert.equal(await p.ev(`TL.threads.find((x) => x.id === '${T}').questions.find((x) => x.id === '${Q}').status`), 'open', 'the card drew a read from before the answer');
      assert.equal(await p.ev('window.__inboxLink'), false, 'never "Answer it in the Inbox" for an answered question');
      assert.ok(await p.ev(`/Answered: EU first/.test(document.getElementById('tl-c-turns').textContent)`), 'still answered in the card');
    } finally { await p.ev('(() => { const q = window.__threadsQueue || []; window.__threadsQueue = null; q.forEach((go) => go()); })()'); }
    await soon(`TL.threads.find((x) => x.id === '${T}').questions.find((x) => x.id === '${Q}').status === 'answered' && /EU first/.test(document.getElementById('tl-c-turns').textContent)`, 'the answer as the log has it');
    assert.equal(await p.ev('window.__inboxLink'), false, 'nor once the threads are read again');
    await p.ev('window.__obs.disconnect(); void 0');
  });
});

test("threads on the dashboard page: Shift and point, the card, the pins and the dock (part 6 of 8: answered elsewhere)", { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 300000 }, async (t) => {
  const { F, p, soon, click, goalSel, threads } = await openThreadsPage(t, 'threads-page-6');
  let T;
  // T as the page makes it in subtest 6 (base :3328-3349: the owner's first words on the goal, with
  // the subject and title its Shift+click gives, as :3344 asserts) and subtest 9's reply (:3373)
  T = F.owner(['thread', 'new', 'Narrow this to the EU launch', '--title', 'Launch checkout', '--subject', JSON.stringify({ kind: 'item', ref: `goal:${F.goal}`, quote: 'Launch checkout' })]).split('\n')[0];
  { const th = threads().find((x) => x.id === T); assert.deepEqual([th.subject.kind, th.subject.ref, th.title], ['item', `goal:${F.goal}`, 'Launch checkout']); }
  F.sup(['thread', 'reply', T, 'That drops the measure to EU orders; want me to propose the change?', '--no-ask', 'a test of the page, not of asks']);
  // the keys log subtest 12 installs (:3408), there from subtest 12 on in the base
  await p.ev(`(() => { if (window.__keys) return; window.__keys = []; addEventListener('keydown', (e) => { const { key, shiftKey, ctrlKey, altKey, metaKey, keyCode, isComposing, repeat } = e; window.__keys.push({ key, shiftKey, ctrlKey, altKey, metaKey, keyCode, isComposing, repeat }); }, true); })()`);
  // the page at #goals, the card closed and T's pin drawn, as subtest 19 leaves it (:3643's wait)
  await soon(`!!document.querySelector('${goalSel}') && !!document.querySelector('[data-tl-pin="${T}"]')`, 'the goal and its pin');
  // the card open from its pin, as subtest 21 leaves it (:3644-3645)
  await click(`[data-tl-pin="${T}"]`);
  await soon(`document.getElementById('tl-card').dataset.key === '${T}'`, 'its card');

  await t.test("answered elsewhere (the terminal), with the page's data newer than the card's read: its answer, never \"Answer it in the Inbox\"", async () => {
    const Q = F.sup(['thread', 'ask', T, '--question', 'Ship to Canada too?', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
    await soon(`!!document.getElementById('t-q-${Q}') && !!document.getElementById('q-${Q}') && document.getElementById('tl-card').dataset.key === '${T}'`, 'both copies');
    // a read of the threads let through and held, so it says open; any Inbox link drawn noted
    await p.ev(`window.__threadsQueue = []; window.__inboxLink = false; window.__obs = new MutationObserver((records) => { const link = 'a[href="#q/${Q}"]'; if (records.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches(link) || !!n.querySelector(link)))) || document.querySelector('#tl-c-turns ' + link)) window.__inboxLink = true; }); window.__obs.observe(document.getElementById('tl-card'), { childList: true, subtree: true }); tlRefresh(); void 0`);
    await soon('window.__threadsQueue.length > 0', 'a read saying the question is open, held');
    await p.ev('window.__stale = window.__threadsQueue.length; void 0');
    try {
      F.owner(['answer', Q, 'Not this quarter']);
      // the page's data lands with the answer, while every read of the threads is still held
      await p.ev('load({ force: true }); void 0');
      await soon(`(DATA?.ooda?.answered || []).some((x) => x.id === '${Q}') && !document.getElementById('q-${Q}')`, 'the page\'s data, with the answer');
      await soon(`/Not this quarter/.test(document.getElementById('tl-c-turns').textContent)`, 'the open card redrawn with it, before any read of the threads');
      // the stale reads land: the card draws a copy from before the answer
      await p.ev('window.__threadsQueue.splice(0, window.__stale).forEach((go) => go())');
      await p.ev('window.__still()');
      await p.ev('window.__stir()');
      assert.equal(await p.ev(`TL.threads.find((x) => x.id === '${T}').questions.find((x) => x.id === '${Q}').status`), 'open', 'the card drew a read from before the answer');
      assert.equal(await p.ev('window.__inboxLink'), false, 'never "Answer it in the Inbox" for an answered question');
      assert.ok(await p.ev(`(() => { const s = document.getElementById('tl-c-turns').textContent; return /Not this quarter/.test(s) && /answered in your terminal/.test(s); })()`), 'its answer, and where from');
    } finally { await p.ev('(() => { const q = window.__threadsQueue || []; window.__threadsQueue = null; q.forEach((go) => go()); })()'); }
    await soon(`TL.threads.find((x) => x.id === '${T}').questions.find((x) => x.id === '${Q}').status === 'answered'`, 'the answer as the log has it');
    assert.equal(await p.ev('window.__inboxLink'), false, 'nor once the threads are read again');
    await p.ev('window.__obs.disconnect(); void 0');
  });
});
