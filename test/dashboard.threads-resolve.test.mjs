// Threads on the dashboard page in Chrome, parts 7 and 8: secrets, resolving and reopening, the drawer, the hidden tab, the Loop spot.
// Ports: none of its own (lib/kit.mjs's +0 hub, +1..25)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashboardOnFreePort, until, threadsFixture } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { FRAMES, soonIn, POLL_FAST } from './lib/dashboard-page.mjs';

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

test("threads on the dashboard page: Shift and point, the card, the pins and the dock (part 7 of 8: secrets, ready to resolve)", { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 300000 }, async (t) => {
  const { F, p, soon, click, onThreads, goalSel, threads } = await openThreadsPage(t, 'threads-page-7');
  let T;
  // T as the page makes it in subtest 6 (base :3328-3349: the owner's first words on the goal, with
  // the subject and title its Shift+click gives, as :3344 asserts) and subtest 9's reply (:3373)
  T = F.owner(['thread', 'new', 'Narrow this to the EU launch', '--title', 'Launch checkout', '--subject', JSON.stringify({ kind: 'item', ref: `goal:${F.goal}`, quote: 'Launch checkout' })]).split('\n')[0];
  { const th = threads().find((x) => x.id === T); assert.deepEqual([th.subject.kind, th.subject.ref, th.title], ['item', `goal:${F.goal}`, 'Launch checkout']); }
  F.sup(['thread', 'reply', T, 'That drops the measure to EU orders; want me to propose the change?']);
  // the keys log subtest 12 installs (:3408), as the page has it by subtest 24
  await p.ev(`(() => { if (window.__keys) return; window.__keys = []; addEventListener('keydown', (e) => { const { key, shiftKey, ctrlKey, altKey, metaKey, keyCode, isComposing, repeat } = e; window.__keys.push({ key, shiftKey, ctrlKey, altKey, metaKey, keyCode, isComposing, repeat }); }, true); })()`);
  // the page at #goals, the card closed and T's pin drawn, as subtest 19 leaves it (:3643's wait)
  await soon(`!!document.querySelector('${goalSel}') && !!document.querySelector('[data-tl-pin="${T}"]')`, 'the goal and its pin');
  // the card open from its pin, as subtest 21 leaves it (:3644-3645)
  await click(`[data-tl-pin="${T}"]`);
  await soon(`document.getElementById('tl-card').dataset.key === '${T}'`, 'its card');
  // Of what subtest 24 leaves (:3709-3733), subtests 25-26 (:3735-3768) read only T's card, open on T
  // (:3737's and :3746's reads of tl-c-turns and tl-c-ready), built above. Its question (:3710), answered
  // in the terminal (:3717), isn't built: they never name it, and :3747's "1 question asked here is still
  // open" counts T's open questions, which an answered one doesn't add to (25's own is answered at :3740,
  // 26's Q2 is the one left open, :3744); the Not yet count is relative (:3749, :3756).

  await t.test('a secrets question in the thread is a link to the Inbox, never a second form', async () => {
    const Q = F.sup(['thread', 'ask', T, '--kind', 'owner-action', '--question', 'Post the API key', '--secrets', JSON.stringify([{ name: 'KEY', sink: 'file:secrets/key.txt' }]), '--goal', F.goal, '--stake', '1', '--urgency', '1']);
    await soon(`!!document.querySelector('#q-${Q} [data-secret]') && /Post the API key/.test(document.getElementById('tl-c-turns').textContent)`, 'the Inbox form, the thread turn');
    assert.equal(await p.ev(`document.querySelectorAll('#tl [data-secret], #tl [data-post-secrets], #t-q-${Q}').length`), 0, 'no form in the thread');
    assert.equal(await p.ev(`document.querySelector('#tl-c-turns a[href="#q/${Q}"]')?.textContent`), 'Answer it in the Inbox');
    F.owner(['answer', Q, 'Can’t right now']);
    await soon(`!document.querySelector('#tl-c-turns a[href="#q/${Q}"]')`, 'answered, the link gone');
  });

  await t.test('Ready to resolve: it warns of an open question, Not yet clears it, Resolve takes the proposal, unpins it and moves it to Resolved', async () => {
    const Q2 = F.sup(['thread', 'ask', T, '--question', 'Tell the US team?', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
    F.sup(['thread', 'ready', T, '--outcome', 'Goal narrowed to EU orders']);
    await soon(`document.querySelector('#tl-c-ready .tl-ready')?.textContent.includes('Goal narrowed to EU orders')`, 'the banner');
    assert.match(await p.ev(`document.querySelector('#tl-c-ready .tl-ready').textContent`), /1 question asked here is still open; it stays in the Inbox/);
    const notYets = () => threads().find((x) => x.id === T).turns.filter((u) => u.by === 'owner' && u.text === 'Not yet').length;
    const n0 = notYets();
    // a double click says it once
    await p.ev(`(() => { const b = document.querySelector('[data-tl-notyet]'); b.click(); b.click(); })()`);
    await until(() => threads().find((x) => x.id === T).ready === null, "cleared by the owner's Not yet");
    await soon('!TL.pend.length && !SAVING', 'the request back');
    const th = threads().find((x) => x.id === T);
    assert.deepEqual([th.turns[th.turns.length - 1].by, th.turns[th.turns.length - 1].text], ['owner', 'Not yet']);
    assert.equal(notYets(), n0 + 1, 'one Not yet for two clicks');
    await soon(`!document.querySelector('#tl-c-ready .tl-ready')`, 'the banner gone');
    F.sup(['thread', 'ready', T, '--outcome', 'EU only']);
    await soon(`document.querySelector('#tl-c-ready .tl-ready')?.textContent.includes('EU only')`, 'proposed again');
    await click('[data-tl-accept]');
    await until(() => threads().find((x) => x.id === T).status === 'resolved', 'resolved');
    await soon(`!document.querySelector('[data-tl-pin="${T}"]') && document.getElementById('tl-card').hidden`, 'unpinned, the card closed');
    await onThreads();
    await click('#th-pane [data-thf="resolved"]');
    await soon(`!!document.querySelector('#tl-list [data-tl-open="${T}"]')`, 'listed under Resolved');
    assert.ok(JSON.parse(F.owner(['log', '--type', 'observation', '--json'])).some((o) => o.kind === 'thread-resolved' && o.subject === `thread:${T}` && o.detail === 'EU only'));
    assert.equal(JSON.parse(F.owner(['questions', '--id', Q2, '--json']))[0].status, 'open', 'its question stays in the Inbox');
  });
});

test("threads on the dashboard page: Shift and point, the card, the pins and the dock (part 8 of 8: reopen, Resolve across a read, the drawer, the hidden tab, Resolve in the header, the Loop spot, a half-typed resolution)", { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 300000 }, async (t) => {
  const { F, p, soon, still, released, click, onThreads, shown, slid, threads } = await openThreadsPage(t, 'threads-page-8');
  let T;
  // T as the page makes it in subtest 6 (base :3328-3349: the owner's first words on the goal, with
  // the subject and title its Shift+click gives, as :3344 asserts) and subtest 9's reply (:3373)
  T = F.owner(['thread', 'new', 'Narrow this to the EU launch', '--title', 'Launch checkout', '--subject', JSON.stringify({ kind: 'item', ref: `goal:${F.goal}`, quote: 'Launch checkout' })]).split('\n')[0];
  { const th = threads().find((x) => x.id === T); assert.deepEqual([th.subject.kind, th.subject.ref, th.title], ['item', `goal:${F.goal}`, 'Launch checkout']); }
  F.sup(['thread', 'reply', T, 'That drops the measure to EU orders; want me to propose the change?']);
  // subtest 26's question, left open, and its resolve: the proposal accepted (:3745, :3759, and the
  // owner's accept, :3761's click, by the kit's command), resolved as :3762 waits for
  F.sup(['thread', 'ask', T, '--question', 'Tell the US team?', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
  F.sup(['thread', 'ready', T, '--outcome', 'EU only']);
  F.owner(['thread', 'resolve', T, '--accept']);
  assert.equal(threads().find((x) => x.id === T).status, 'resolved');
  // the page has read T resolved before its panel is drawn, as it had in the base by its own press: a
  // pane drawn before that read keeps its empty list (a later read doesn't draw it again)
  await soon(`TL.threads.some((x) => x.id === '${T}' && x.status === 'resolved')`, 'the page has T resolved');
  // the card closed, the panel on Threads under Resolved with T listed, as subtest 26 leaves it (:3764-3766)
  await onThreads();
  await click('#th-pane [data-thf="resolved"]');
  await soon(`!!document.querySelector('#tl-list [data-tl-open="${T}"]')`, 'listed under Resolved');

  await t.test('a resolved thread reopens from its card', async () => {
    await click(`#tl-list [data-tl-open="${T}"]`);
    await soon(`!!document.querySelector('[data-tl-reopen]')`, 'Reopen in its header');
    await click('[data-tl-reopen]');
    await until(() => threads().find((x) => x.id === T).status === 'open', 'reopened');
    await soon(`!!document.querySelector('[data-tl-pin="${T}"]')`, 'its pin back');
    // the panel closed (by its ×, pressed in place: the card may sit over it)
    await p.ev(`document.getElementById('th-close').click(); void 0`);
    // and the page at rest after its slide back (the card on it placed again), so the next press lands where it was found
    await soon(`!document.body.classList.contains('threads-open') && getComputedStyle(document.querySelector('.main')).marginRight === '0px'`, 'the panel closed');
    await p.ev(FRAMES);
  });

  await t.test('a press on Resolve across a read still opens the form', async () => {
    await soon(`!!document.querySelector('[data-tl-resolve]')`, 'Resolve in its header');
    // held still from finding the button to pressing it, so the press lands on it; a read then lands
    // under the press (the button itself isn't redrawn by it, so this shows the press survives a read,
    // not that a redraw of the header is held)
    const at = await still(async () => {
      const xy = await p.at('[data-tl-resolve]');
      await p.ev(`window.__rb = document.querySelector('[data-tl-resolve]'); void 0`);
      await p.move(xy.x, xy.y);
      await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...xy, button: 'left', buttons: 1, clickCount: 1 });
      return xy;
    });
    await p.ev('tlRefresh()');
    assert.ok(await p.ev('window.__rb.isConnected'), 'the pressed button kept, not drawn again');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', buttons: 0, clickCount: 1 });
    // the card, grown by the form under the press, placed again only once the release is handled
    await released();
    await soon(`!!document.getElementById('tl-outcome')`, 'the form from the pressed button');
    await click('[data-tl-resolve-cancel]');
    await soon(`!document.getElementById('tl-outcome')`, 'the form gone');
  });

  await t.test('a #talk/ link followed with the drawer open closes the drawer and its scrim', async () => {
    await click('[data-tl-close]');
    await soon(`document.getElementById('tl-card').hidden`, 'closed');
    await p.ev(`location.hash = '#goal/${F.goal}'`);
    await soon(`${shown('drawer')} && ${shown('scrim')}`, 'the drawer');
    await p.ev(`location.hash = '#talk/${T}'`);
    await soon(`${shown('tl-card')} && document.getElementById('tl-card').dataset.key === '${T}'`, 'the card');
    assert.deepEqual(await p.ev(`[document.getElementById('drawer').hidden, document.getElementById('scrim').hidden, document.body.style.overflow]`), [true, true, ''], 'nothing left over the card');
  });

  await t.test("a reply that lands while the tab is hidden isn't marked seen, so the dock can show its dot", async () => {
    const last = () => p.ev(`TL.threads.find((x) => x.id === '${T}').turns.at(-1)`);
    await p.ev(`Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); void 0`);
    try {
      F.sup(['thread', 'reply', T, 'While you were away.', '--off-subject', 'a note that lands while the tab is hidden']);
      await p.ev('tlRefresh()');
      await soon(`TL.threads.find((x) => x.id === '${T}').turns.at(-1).text === 'While you were away.'`, 'read in');
      assert.notEqual(await p.ev(`tlSeenAt('${T}')`), (await last()).at, 'not seen while hidden');
    } finally { await p.ev('delete document.visibilityState; void 0'); }
    await p.ev('tlRefresh()');
    const at = (await last()).at;
    await soon(`tlSeenAt('${T}') === ${JSON.stringify(at)}`, 'seen once the tab shows it');
  });

  await t.test("Resolve in the card's header: a line for how it ended, the open question's warning, Cancel keeps it open", async () => {
    await soon(`!!document.querySelector('[data-tl-resolve]')`, 'Resolve in its header');
    await click('[data-tl-resolve]');
    await soon(`!!document.getElementById('tl-outcome')`, 'the form');
    assert.match(await p.ev(`document.querySelector('#tl-c-ready .tl-ready').textContent`), /1 question asked here is still open; it stays in the Inbox/);
    await click('[data-tl-resolve-cancel]');
    await soon(`!document.getElementById('tl-outcome')`, 'the form gone');
    assert.equal(threads().find((x) => x.id === T).status, 'open');
    await click('[data-tl-resolve]');
    await soon(`!!document.getElementById('tl-outcome')`, 'the form again');
    await p.ev(`document.getElementById('tl-outcome').value = 'Kept to the EU'`);
    await click('[data-tl-resolve-go]');
    const r = await until(() => { const x = threads().find((y) => y.id === T); return x.status === 'resolved' && x; }, 'resolved');
    assert.equal(r.outcome, 'Kept to the EU');
  });

  await t.test('Shift held over the drawer shows no pin, and its click is the drawer\'s', async () => {
    await p.ev(`location.hash = '#goal/${F.goal}'`);
    await soon(slid(), 'the drawer');
    const at = await p.at('#drawer-close');
    await p.hold('Shift', true);
    await p.move(at.x, at.y, 8);
    await p.ev(FRAMES);
    assert.equal(await p.ev(`document.getElementById('tl-cursor').hidden`), true, 'nothing there to point at');
    await p.clickAt(at.x, at.y, 8);
    await p.hold('Shift', false);
    await soon(`document.getElementById('drawer').hidden`, 'the drawer closed by its own button');
  });

  await t.test('a thread on a spot in a Loop tab opens on that tab', async () => {
    const [P] = F.owner(['thread', 'new', 'This decision', '--title', 'the dashboard · Loop', '--subject', JSON.stringify({ kind: 'page', view: '#loop/decide', at: { x: 0.5, y: 0.1 }, quote: 'Loop' })]).split('\n');
    await p.ev(`showTab('observe')`);
    await p.ev(`location.hash = '#talk/${P}'`);
    await soon(`TAB === 'decide' && !document.getElementById('tl-card').hidden`, 'the Decide tab, and the card');
    const pinned = () => p.ev(`[...document.querySelectorAll('#tl-pins .tl-pin')].some((b) => b.dataset.tlPin === '${P}')`);
    await p.ev(`tlPins()`);
    assert.equal(await pinned(), true, 'its pin is on the Decide tab');
    await p.ev(`showTab('observe'); tlPins()`);
    assert.equal(await pinned(), false, 'no pin on a tab that isn\'t shown');
    await p.key('Escape');
  });

  await t.test('a half-typed resolution stays when a question in the thread is answered meanwhile', async () => {
    const [R] = F.owner(['thread', 'new', 'Keep my note']).split('\n');
    const Q = F.sup(['thread', 'ask', R, '--question', 'Ship it?', '--choices', '[{"label":"Yes"},{"label":"No"}]', '--stake', '1', '--urgency', '1']);
    await p.ev(`location.hash = '#talk/${R}'`);
    // its own card: the card already open has a Resolve too, until the read of the new thread lands
    await soon(`document.getElementById('tl-card').dataset.key === '${R}' && !!document.querySelector('[data-tl-resolve]')`, 'its card');
    // no subject: its card is in the Threads panel, which the link opened; pressed once it has slid in
    await soon(`!!document.querySelector('#th-card-slot #tl-card.in-panel') && getComputedStyle(document.getElementById('threads')).transform === 'none'`, 'the panel at rest');
    await click('[data-tl-resolve]');
    await soon(`!!document.getElementById('tl-outcome')`, 'the form');
    await p.ev(`document.getElementById('tl-outcome').focus()`);
    await p.type('Half typed');
    // the ask lands with the next read; typing before it does is the point of the test, so wait for it
    await soon(`/1 question asked here is still open/.test(document.querySelector('#tl-c-ready .tl-ready')?.textContent ?? '')`, 'the warning');
    assert.deepEqual(await p.ev(`[document.getElementById('tl-outcome').value, document.activeElement?.id]`), ['Half typed', 'tl-outcome'], 'the words stay when the warning appears');
    F.owner(['answer', Q, 'Yes']);
    await soon(`!/still open/.test(document.querySelector('#tl-c-ready .tl-ready')?.textContent ?? 'still open')`, 'the warning gone');
    assert.deepEqual(await p.ev(`[document.getElementById('tl-outcome').value, document.activeElement?.id]`), ['Half typed', 'tl-outcome'], 'the words and the caret stay');
  });
});
