// Threads on the dashboard page in Chrome, parts 3 and 4: a question asked in a thread, and Shift+Enter in a question box.
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

test("threads on the dashboard page: Shift and point, the card, the pins and the dock (part 3 of 8: a question in the thread)", { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 300000 }, async (t) => {
  const { F, p, soon, still, click, goalSel, threads } = await openThreadsPage(t, 'threads-page-3');
  let T;
  // T as the page makes it in subtest 6 (base :3328-3349: the owner's first words on the goal, with
  // the subject and title its Shift+click gives, as :3344 asserts) and subtest 9's reply (:3373)
  T = F.owner(['thread', 'new', 'Narrow this to the EU launch', '--title', 'Launch checkout', '--subject', JSON.stringify({ kind: 'item', ref: `goal:${F.goal}`, quote: 'Launch checkout' })]).split('\n')[0];
  { const th = threads().find((x) => x.id === T); assert.deepEqual([th.subject.kind, th.subject.ref, th.title], ['item', `goal:${F.goal}`, 'Launch checkout']); }
  F.sup(['thread', 'reply', T, 'That drops the measure to EU orders; want me to propose the change?']);
  // the keys log subtest 12 installs (:3408), as the page has it by subtest 20
  await p.ev(`(() => { if (window.__keys) return; window.__keys = []; addEventListener('keydown', (e) => { const { key, shiftKey, ctrlKey, altKey, metaKey, keyCode, isComposing, repeat } = e; window.__keys.push({ key, shiftKey, ctrlKey, altKey, metaKey, keyCode, isComposing, repeat }); }, true); })()`);
  // the page at #goals, the card closed and T's pin drawn, as subtest 19 leaves it (:3643's wait)
  await soon(`!!document.querySelector('${goalSel}') && !!document.querySelector('[data-tl-pin="${T}"]')`, 'the goal and its pin');

  await t.test("a question asked in the thread: the Inbox's card in the card (t-q-), one pick in both, answered there once, answered in the Inbox too", async () => {
    await click(`[data-tl-pin="${T}"]`);
    await soon(`document.getElementById('tl-card').dataset.key === '${T}'`, 'its card');
    const Q = F.sup(['thread', 'ask', T, '--question', 'Narrow the goal to EU orders?', '--choices', '[{"label":"Yes"},{"label":"Not yet"}]', '--recommendation', 'Yes', '--goal', F.goal, '--stake', '2', '--urgency', '1']);
    await soon(`!!document.getElementById('t-q-${Q}') && !!document.getElementById('q-${Q}')`, 'both copies');
    assert.equal(await p.ev(`document.getElementById('t-q-${Q}').querySelector('input[data-pick]').name`), `t-pick-${Q}`, 'its own radio group');
    // the Inbox is another section: its copy is clicked as a script would
    await p.ev(`document.querySelector('#q-${Q} input[data-pick="${Q}"][value="Not yet"]').click()`);
    assert.ok(await p.ev(`document.querySelector('#t-q-${Q} input[value="Not yet"]').checked && document.querySelector('#t-q-${Q} input[value="Not yet"]').closest('.choice').classList.contains('picked')`), "the Inbox's pick shows in the thread's");
    await click(`#t-q-${Q} input[data-pick="${Q}"][value="Yes"]`);
    assert.deepEqual(await p.ev(`[document.querySelector('#q-${Q} input[value="Yes"]').checked, document.querySelector('#q-${Q} input[value="Not yet"]').checked, document.querySelectorAll('#q-${Q} .choice.picked').length]`), [true, false, 1], "the thread's pick shows in the Inbox's");
    // held still from the press until both copies say so: answered at once, before any read lands
    await still(async () => {
      await p.click(`#t-q-${Q} button[data-answer="${Q}"]`);
      await soon(`document.getElementById('t-q-${Q}')?.classList.contains('done') && document.getElementById('t-q-${Q}').textContent.includes('Yes')`, 'the thread copy marked answered at once');
      await soon(`document.getElementById('q-${Q}')?.classList.contains('done') && document.getElementById('q-${Q}').textContent.includes('Yes')`, 'the Inbox copy marked answered at once');
    });
    const q = await until(() => { const x = JSON.parse(F.owner(['questions', '--id', Q, '--json']))[0]; return x.status === 'answered' && x; }, 'the answer');
    assert.deepEqual([q.answer, q.channel], ['Yes', 'dashboard']);
    await soon(`!document.getElementById('q-${Q}') || document.getElementById('q-${Q}').classList.contains('done')`, 'the Inbox copy answered');
    // answered at once in the card (its copy marked done) and, once the threads are read again, as the
    // log has it (the question, its answer, where from): either way no form and no Inbox link left
    await soon(`(() => {
      const turns = document.getElementById('tl-c-turns'), live = document.getElementById('t-q-${Q}');
      if ((live && !live.classList.contains('done')) || turns.querySelector('[data-answer="${Q}"], a[href="#q/${Q}"]')) return false;
      return [...turns.querySelectorAll('.tl-q, .qcard.done')].some((c) => /answered/i.test(c.textContent) && /\\bYes\\b/.test(c.textContent));
    })()`, 'the thread copy answered');
  });
});

test("threads on the dashboard page: Shift and point, the card, the pins and the dock (part 4 of 8: Shift+Enter in a question box)", { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 300000 }, async (t) => {
  const { F, p, soon, click, goalSel, threads, enter, composing, lastKey, posts, ticks } = await openThreadsPage(t, 'threads-page-4');
  let T;
  // T as the page makes it in subtest 6 (base :3328-3349: the owner's first words on the goal, with
  // the subject and title its Shift+click gives, as :3344 asserts) and subtest 9's reply (:3373)
  T = F.owner(['thread', 'new', 'Narrow this to the EU launch', '--title', 'Launch checkout', '--subject', JSON.stringify({ kind: 'item', ref: `goal:${F.goal}`, quote: 'Launch checkout' })]).split('\n')[0];
  { const th = threads().find((x) => x.id === T); assert.deepEqual([th.subject.kind, th.subject.ref, th.title], ['item', `goal:${F.goal}`, 'Launch checkout']); }
  F.sup(['thread', 'reply', T, 'That drops the measure to EU orders; want me to propose the change?']);
  // the keys log subtest 12 installs (:3408), which subtest 21's lastKey() reads
  await p.ev(`(() => { if (window.__keys) return; window.__keys = []; addEventListener('keydown', (e) => { const { key, shiftKey, ctrlKey, altKey, metaKey, keyCode, isComposing, repeat } = e; window.__keys.push({ key, shiftKey, ctrlKey, altKey, metaKey, keyCode, isComposing, repeat }); }, true); })()`);
  // the page at #goals, the card closed and T's pin drawn, as subtest 19 leaves it (:3643's wait)
  await soon(`!!document.querySelector('${goalSel}') && !!document.querySelector('[data-tl-pin="${T}"]')`, 'the goal and its pin');
  // Nothing of subtest 20's (:3561-3588: T's card opened, its question Q asked and answered) is built:
  // subtest 21 (:3590-3655) reads none of it. It names no Q; it reads only its own Qa/Qb cards in the
  // Inbox (:3597, :3599, :3610-3619); asks() (:3593) counts which-choice steps, none of which an answered
  // Q leaves; posts() is relative to its own `sent` (:3598); it sets the hash itself (:3596, :3642); it
  // reads no toast; and T's card it opens itself by the pin (:3644-3645), whose press opens T whether
  // or not a card was open (tlOpen, from the pin's click, sets TL.open = T).

  await t.test("Shift+Enter in a question box presses its Answer: posted once, with no which-choice step, in the Inbox and in the thread", async () => {
    const qOf = (id) => JSON.parse(F.owner(['questions', '--id', id, '--json']))[0];
    const box = (sel) => p.ev(`document.querySelector('${sel} textarea[data-q]').value`);
    const asks = () => p.ev(`document.querySelectorAll('[data-which-for]').length`);
    const Qa = F.sup(['ask', '--question', 'Ship on Friday?', '--choices', '[{"label":"Yes"},{"label":"No"}]', '--recommendation', 'Yes', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
    const Qb = F.sup(['ask', '--question', 'Ship on Monday?', '--choices', '[{"label":"Yes"},{"label":"No"}]', '--recommendation', 'Yes', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
    await p.ev(`location.hash = '#inbox'`);
    await soon(`!!document.querySelector('#q-${Qa} textarea[data-q]') && !!document.querySelector('#q-${Qb} textarea[data-q]')`, 'their cards in the Inbox');
    const sent = await posts();
    await p.ev(`document.querySelector('#q-${Qa} textarea[data-q]').focus()`);
    await p.type('after the demo');
    // words and no pick: posted at once as the words alone, with no step; held down, the key posts once
    await enter({ shift: true });
    await enter({ shift: true, repeat: true });
    const qa = await until(() => { const x = qOf(Qa); return x.status === 'answered' && x; }, 'the words\' answer');
    assert.deepEqual([qa.answer, qa.choice, qa.matched, qa.channel], ['after the demo', null, false, 'dashboard']);
    assert.equal(await asks(), 0, 'no which-choice step');
    await ticks();
    assert.equal(await posts(), sent + 1, 'posted once');
    // a picked card: a Shift+Enter would post, so each key that must not post is tried on this one
    await p.ev(`document.querySelector('#q-${Qb} input[data-pick][value="Yes"]').click()`);
    await p.ev(`document.querySelector('#q-${Qb} textarea[data-q]').focus()`);
    await p.type('after the demo');
    const none = async (what) => { assert.deepEqual([await asks(), await p.ev(`document.getElementById('e-${Qb}').textContent`), await posts()], [0, '', sent + 1], what); };
    await enter();
    assert.equal(await box(`#q-${Qb}`), 'after the demo\n', 'Enter is a new line');
    await none('Enter');
    await enter({ shift: true, repeat: true });
    assert.deepEqual([(await lastKey()).shiftKey, (await lastKey()).repeat], [true, true]);
    assert.equal(await box(`#q-${Qb}`), 'after the demo\n', 'a repeat adds no line');
    await none('a repeat');
    await composing();
    assert.equal((await lastKey()).isComposing, true);
    await none('composing');
    await enter({ shift: true, code: 229 });
    assert.equal((await lastKey()).keyCode, 229);
    await none('229');
    for (const held of ['ctrl', 'alt', 'meta']) {
      await enter({ shift: true, [held]: true });
      assert.equal((await lastKey())[`${held}Key`], true, `${held} held`);
      await none(`${held} held`);
    }
    await ticks();
    assert.equal(qOf(Qb).status, 'open', 'still open');
    await none('after a while');
    await enter({ shift: true });
    await enter({ shift: true, repeat: true });
    const q = await until(() => { const x = qOf(Qb); return x.status === 'answered' && x; }, 'the answer');
    assert.deepEqual([q.answer, q.choice, q.channel], ['Yes — after the demo', 'Yes', 'dashboard']);
    await ticks();
    assert.equal(await posts(), sent + 2, 'posted once');
    // the thread's copy: back to the goal and its thread
    await p.ev(`location.hash = '#goals'`);
    await soon(`!!document.querySelector('${goalSel}') && !!document.querySelector('[data-tl-pin="${T}"]')`, 'the goal and its pin');
    await click(`[data-tl-pin="${T}"]`);
    await soon(`document.getElementById('tl-card').dataset.key === '${T}'`, 'its card');
    const Qt = F.sup(['thread', 'ask', T, '--question', 'Tell the team?', '--choices', '[{"label":"Yes"},{"label":"No"}]', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
    await soon(`!!document.querySelector('#t-q-${Qt} textarea[data-q]')`, 'the thread copy');
    await click(`#t-q-${Qt} input[data-pick="${Qt}"][value="No"]`);
    await p.ev(`document.querySelector('#t-q-${Qt} textarea[data-q]').focus()`);
    await p.type('next week');
    await enter({ shift: true });
    const qt = await until(() => { const x = qOf(Qt); return x.status === 'answered' && x; }, 'the thread copy\'s answer');
    assert.deepEqual([qt.answer, qt.choice], ['No — next week', 'No']);
    await p.ev('document.activeElement.blur()');
  });
});
