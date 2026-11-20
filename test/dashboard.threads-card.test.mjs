// Threads on the dashboard page in Chrome: Shift and point, the card, the pins and the dock.
// Ports: none of its own (lib/kit.mjs's +0 hub, +1..25)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { dashboardOnFreePort, until, threadsFixture } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { FRAMES, soonIn, POLL_FAST } from './lib/dashboard-page.mjs';

// The thread layer in Chrome, on a project of its own: aiming (this task), the card (Task 11), the
// pins and the dock (Task 12), questions and resolving (Task 13). One page; the subtests run in order.
const NOT_DELIVERED_37 = 'Not delivered: no supervisor terminal took it. The supervisor sees it only when it next checks; it last checked 37 min ago.';
test('threads on the dashboard page: Shift and point, the card, the pins and the dock', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 300000 }, async (t) => {
  // stopped last-in first-out, each whatever the one before did: the fixture's files go only once the
  // dashboard writing into them has stopped, and one cleanup that throws leaves no Chrome running
  const later = cleanup(t);
  const F = threadsFixture('threads-page');
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
  let T;
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

  await t.test('Shift and point: the pin cursor, the goal outlined, a chip naming it; Shift up, the cursor back', async () => {
    await still(async () => {
      const at = await p.at(`${goalSel} h4`);
      await p.hold('Shift', true);
      await p.move(at.x, at.y, 8);
      await soon(`${shown('tl-cursor')} && ${shown('tl-hl')}`, 'the pin and the highlight');
      assert.equal(await p.ev(`document.getElementById('tl-chip').textContent`), 'Launch checkout');
      assert.equal(await p.ev(`document.documentElement.classList.contains('tl-aiming')`), true);
    });
    await p.hold('Shift', false);
    await soon(`document.getElementById('tl-cursor').hidden && !document.documentElement.classList.contains('tl-aiming')`, 'the normal cursor back');
  });

  await t.test('Shift held while typing in a field shows nothing until the pointer leaves the field', async () => {
    const box = `textarea[data-q="${Q0}"]`;
    // the field is in the Inbox (the panel's Inbox tab, kit-100)
    await p.ev(`location.hash = '#inbox'`);
    await soon(`document.body.classList.contains('threads-open') && getComputedStyle(document.getElementById('threads')).transform === 'none' && !document.getElementById('th-inbox').hidden`, 'the Inbox in the panel, at rest');
    await click(box);
    await p.hold('Shift', true);
    await p.key('A', 8);
    assert.equal(await p.ev(`document.getElementById('tl-cursor').hidden`), true, 'a capital is just a capital');
    const over = await p.at(box);
    await p.move(over.x, over.y, 8);
    assert.equal(await p.ev(`document.getElementById('tl-cursor').hidden`), true, 'not over the field');
    await still(async () => { const g = await p.at(`#q-${Q0} .card-head`); await p.move(g.x, g.y, 8); });
    await soon(shown('tl-cursor'), 'the pin once outside it');
    await p.hold('Shift', false);
    assert.match(await p.ev(`document.querySelector('${box}').value`), /A$/);
    await p.ev(`document.querySelector('${box}').value = ''; document.activeElement.blur()`);
    // the panel closed by its ×, so Goals isn't opened with it remembered (kit-89 §2.5; the Inbox is its tab, kit-100)
    await soon(`getComputedStyle(document.getElementById('threads')).transform === 'none'`, 'the panel at rest');
    await p.click('#th-close');
    await soon(`!document.body.classList.contains('threads-open')`, 'the panel closed');
    await p.ev(`location.hash = '#goals'`);
    // and at rest: the page's margin slides back as the panel closes, and Goals' cards sit two across (kit-90),
    // so a point read mid-slide is on the card beside the goal's by the time it is clicked
    await soon(`getComputedStyle(document.querySelector('#goals')).display !== 'none' && !document.getAnimations().some((a) => a.transitionProperty === 'margin-right')`, 'the Goals page again, at rest');
  });

  await t.test("a Shift+click is the layer's alone: it starts a thread on the goal, and the title link under it isn't followed", async () => {
    const pages = async () => (await p.send('Target.getTargets')).targetInfos.filter((x) => x.type === 'page').length;
    const before = await pages();
    await still(async () => {
      const at = await p.at(`${goalSel} a.title-link`);
      await p.hold('Shift', true);
      await p.clickAt(at.x, at.y, 8);
      await p.hold('Shift', false);
    });
    await soon(`TL.draft?.subject?.ref === 'goal:${F.goal}'`, 'a thread about to start, on the goal');
    assert.equal(await p.ev('PRESSED'), 0, 'the press that holds a redraw never saw it');
    assert.equal(await pages(), before, "no new window: the browser's own Shift+click never ran");
    assert.equal(await p.ev('TL.draft.title'), 'Launch checkout');
    assert.equal(await p.ev('location.hash'), '#goals', 'the link was not followed');
    assert.equal(await p.ev(`document.getElementById('drawer').hidden`), true, 'no sidepeek opened');
    assert.equal(threads().length, 0, 'nothing is written until the owner writes');
  });

  await t.test('the card opens beside the goal, with the goal as its context, and nothing written yet', async () => {
    await soon(shown('tl-card'), 'the card');
    assert.match(await p.ev(`document.querySelector('#tl-card .tl-ctx summary').textContent`), /Launch checkout[\s\S]*Goals/);
    assert.equal(await p.ev(`document.activeElement.id`), 'tl-c-text', 'ready to write');
    assert.equal(threads().length, 0);
  });

  await t.test("a draft left on one subject stays with it: another subject's card starts empty; Escape closes the card", async () => {
    const shiftClick = (sel) => still(async () => { const at = await p.at(sel); await p.hold('Shift', true); await p.move(at.x, at.y, 8); await soon(shown('tl-cursor'), 'the pin'); await p.clickAt(at.x, at.y, 8); await p.hold('Shift', false); });
    await p.type('draft for the goal');
    // an unsent draft is let go after 7 days; one of a day ago stays
    const old = (days, at = Date.now() - days * 86400000) => JSON.stringify(JSON.stringify({ text: 'x', at }));
    await p.ev(`localStorage.setItem('devteam.thread.draft.new:item:goal:gone', ${old(8)}); localStorage.setItem('devteam.thread.draft.new:item:goal:kept', ${old(1)}); void 0`);
    await p.key('Escape');
    await soon(`document.getElementById('tl-card').hidden`, 'Escape closed the card');
    await shiftClick('#goals .tabbar [role="tab"][data-tab="active"]');
    await soon(`${shown('tl-card')} && TL.draft?.subject?.kind === 'page'`, 'a card on a spot in Goals');
    assert.equal(await p.ev(`document.getElementById('tl-c-text').value`), '', "the goal's draft isn't here");
    assert.deepEqual(await p.ev(`['gone', 'kept'].map((k) => localStorage.getItem('devteam.thread.draft.new:item:goal:' + k) !== null)`), [false, true], 'the week-old draft pruned');
    await p.ev(`localStorage.removeItem('devteam.thread.draft.new:item:goal:kept'); void 0`);
    await p.key('Escape');
    await soon(`document.getElementById('tl-card').hidden`, 'closed');
    await shiftClick(`${goalSel} h4`);
    await soon(`${shown('tl-card')} && TL.draft?.subject?.ref === 'goal:${F.goal}'`, 'the goal again');
    assert.equal(await p.ev(`document.getElementById('tl-c-text').value`), 'draft for the goal', 'its draft kept');
    assert.equal(await p.ev(`document.activeElement.id`), 'tl-c-text');
    await p.ev(`(() => { const ta = document.getElementById('tl-c-text'); ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    assert.equal(threads().length, 0);
  });

  await t.test('Shift+Enter sends the first words: a thread on the goal, its turn in the card, the draft cleared', async () => {
    // the supervisor last checked 37 minutes ago (and 20 s, for a slow runner: the card rounds)
    fs.writeFileSync(path.join(F.old, 'docs/devteam/run/host-claim.json'), JSON.stringify({ checked: Date.now() - 37 * 60000 - 20000 }));
    await p.type('Narrow this to the EU launch');
    // a read of the threads begun before the send, answering after it: the card must stay the thread's
    await p.ev(`window.__threadsRead = false; window.__threadsLanded = false; window.__threadsHold = new Promise((r) => { window.__threadsLet = r; }); tlRefresh(); void 0`);
    await soon('window.__threadsRead', 'a read begun before the send');
    await p.key('Enter', 8);
    const th = await until(() => threads().find((x) => x.turns[0]?.text === 'Narrow this to the EU launch'), 'the thread in the log');
    T = th.id;
    await soon(`document.getElementById('tl-card').dataset.key === '${T}'`, 'the card the thread');
    await p.ev('window.__threadsLet()');
    await soon('window.__threadsLanded', 'the old read landing');
    const polls = await p.ev('window.__polls');
    await soon(`window.__polls >= ${polls + 2}`, 'two page refreshes since');
    assert.equal(await p.ev(`${shown('tl-card')} && document.getElementById('tl-card').dataset.key === '${T}'`), true, "the old read didn't close the new thread's card");
    assert.deepEqual([th.subject.kind, th.subject.ref, th.title], ['item', `goal:${F.goal}`, 'Launch checkout']);
    await soon(`document.querySelector('#tl-c-turns .tl-turn.owner')?.textContent.includes('Narrow this to the EU launch')`, 'the turn in the card');
    assert.equal(await p.ev(`document.getElementById('tl-c-text').value`), '');
    assert.equal(await p.ev(`document.activeElement.id`), 'tl-c-text', 'still in the composer after the card became the thread');
    assert.equal(await p.ev(`document.getElementById('tl-c-state').textContent`), NOT_DELIVERED_37, 'no pane here: not delivered, and when the supervisor last checked');
  });

  await t.test("after a reload only the server's record knows the turn missed, and the card still says so", async () => {
    fs.writeFileSync(path.join(F.old, 'docs/devteam/run/host-claim.json'), JSON.stringify({ checked: Date.now() - 37 * 60000 - 20000 }));
    await p.ev(`location.hash = '#talk/${T}'; window.__beforeReload = true`);
    await p.send('Page.reload');
    await soon(`!window.__beforeReload && typeof TL !== 'undefined' && TL.have > 0 && ${shown('tl-card')} && document.getElementById('tl-card').dataset.key === '${T}'`, 'the card again, after a reload');
    assert.equal(await p.ev(`TL.typed['${T}'] === undefined`), true, 'a new document: the send is forgotten');
    await soon(`document.getElementById('tl-c-state').textContent === ${JSON.stringify(NOT_DELIVERED_37)}`, "the server's record and last check");
  });

  await t.test('the page refreshes while the owner writes in the card: the layer holds no redraw', async () => {
    await p.ev("document.getElementById('tl-c-text').focus()");
    await p.type('half a thought');
    const polls = await p.ev('window.__polls');
    // Goals draws only what changed (kit-90): its last drawing forgotten, as a change would, so the next poll redraws the card
    await p.ev(`window.__g = document.querySelector('${goalSel}'); GOALS_HTML = ''; void 0`);
    await soon(`window.__polls >= ${polls + 2} && !window.__g.isConnected`, 'polls landing and the goal card redrawn');
    assert.equal(await p.ev(`document.activeElement.id`), 'tl-c-text');
    assert.equal(await p.ev(`document.getElementById('tl-c-text').value`), 'half a thought', 'the draft untouched');
    await p.ev(`(() => { const ta = document.getElementById('tl-c-text'); ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  });

  await t.test("the supervisor's reply shows in the open card within two polls", async (st) => {
    F.sup(['thread', 'reply', T, 'That drops the measure to EU orders; want me to propose the change?']);
    const t0 = Date.now();
    await soon(`document.querySelector('#tl-c-turns .tl-turn.supervisor')?.textContent.includes('drops the measure')`, 'the reply');
    // the card polls every 2 s: two polls, and one more and a margin for a loaded machine
    const took = Date.now() - t0;
    st.diagnostic(`the reply showed after ${took} ms`);
    assert.ok(took <= 3 * 2000 + 1500, `took ${took} ms`);
    assert.equal(await p.ev(`document.getElementById('tl-c-state').textContent`), '', 'the reply is the state');
  });

  await t.test('a turn over 2,000 bytes is refused in the card, counted in bytes', async () => {
    await p.ev(`(() => { const ta = document.getElementById('tl-c-text'); ta.focus(); ta.value = '日'.repeat(700); ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    assert.match(await p.ev(`document.getElementById('tl-c-bytes').textContent`), /2100 \/ 2000 bytes/);
    await p.key('Enter', 8);
    await soon(`/At most 2000 bytes/.test(document.getElementById('e-tl').textContent)`, 'the refusal');
    await p.ev(`(() => { const ta = document.getElementById('tl-c-text'); ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.blur(); })()`);
  });

  await t.test('reads of the threads slower than the 2 s poll: a reply still shows, and the owner can still send twice', async () => {
    await p.ev('window.__threadsDelay = 2500');
    try {
      F.sup(['thread', 'reply', T, 'Slow box: still here.']);
      await soon(`[...document.querySelectorAll('#tl-c-turns .tl-turn.supervisor')].some((e) => e.textContent.includes('Slow box'))`, 'the reply through slow reads');
      for (const w of ['First on a slow box', 'Second on a slow box']) {
        await p.ev("document.getElementById('tl-c-text').focus()");
        await p.type(w);
        await p.key('Enter', 8);
        await until(() => threads().find((x) => x.id === T)?.turns.some((u) => u.text === w), `"${w}" in the log`);
        await soon(`[...document.querySelectorAll('#tl-c-turns .tl-turn.owner')].some((e) => e.textContent.includes(${JSON.stringify(w)})) && document.getElementById('tl-c-text').value === '' && !TL.pend.length`, `"${w}" in the card, the composer free`);
      }
    } finally { await p.ev('window.__threadsDelay = 0'); }
    await p.ev('document.activeElement.blur()');
  });

  await t.test('Shift+Enter in the thread box sends once; Enter, a repeat, composition and Ctrl+Shift+Enter add nothing', async () => {
    await p.ev(`(() => { if (window.__keys) return; window.__keys = []; addEventListener('keydown', (e) => { const { key, shiftKey, ctrlKey, altKey, metaKey, keyCode, isComposing, repeat } = e; window.__keys.push({ key, shiftKey, ctrlKey, altKey, metaKey, keyCode, isComposing, repeat }); }, true); })()`);
    const box = () => p.ev(`document.getElementById('tl-c-text').value`);
    const turns = () => threads().find((x) => x.id === T).turns.length;
    const n = turns(), sent = await posts();
    await p.ev("document.getElementById('tl-c-text').focus()");
    await p.type('kept line one');
    await enter();
    assert.equal(await box(), 'kept line one\n', 'Enter is a new line');
    await enter({ shift: true, repeat: true });
    assert.deepEqual([(await lastKey()).shiftKey, (await lastKey()).repeat], [true, true]);
    assert.equal(await box(), 'kept line one\n', 'a repeat adds no line');
    await composing();
    assert.equal((await lastKey()).isComposing, true);
    await enter({ shift: true, code: 229 });
    assert.equal((await lastKey()).keyCode, 229);
    // left alone, that key may have put its own line in: back to the words as they were
    await p.ev(`(() => { const ta = document.getElementById('tl-c-text'); ta.value = 'kept line one\\n'; ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    for (const held of ['ctrl', 'alt', 'meta']) {
      await enter({ shift: true, [held]: true });
      assert.equal((await lastKey())[`${held}Key`], true, `${held} held`);
    }
    await ticks();
    assert.deepEqual([turns(), await posts()], [n, sent], 'nothing sent');
    await enter({ shift: true });
    await enter({ shift: true, repeat: true });
    await until(() => turns() === n + 1, 'the turn in the log');
    await ticks();
    const t1 = threads().find((x) => x.id === T);
    assert.deepEqual([t1.turns.length, t1.turns.at(-1).text, await posts(), await box()], [n + 1, 'kept line one', sent + 1, ''], 'sent once, the box cleared');
    await p.ev('document.activeElement.blur()');
  });

  await t.test('#talk/<id> opens the thread beside its subject', async () => {
    await click('[data-tl-close]');
    await soon(`document.getElementById('tl-card').hidden`, 'closed');
    await p.ev(`location.hash = '#talk/${T}'`);
    await soon(`${shown('tl-card')} && document.getElementById('tl-card').dataset.key === '${T}'`, 'the card from the link');
    // closed either way, the same link opens it again
    await click('[data-tl-close]');
    await soon(`document.getElementById('tl-card').hidden && location.hash === '#goals'`, 'closed, the link let go for its subject\'s section');
    await p.ev(`location.hash = '#talk/${T}'`);
    await soon(`${shown('tl-card')} && document.getElementById('tl-card').dataset.key === '${T}'`, 'the same link again');
    await p.ev("document.getElementById('tl-c-text').focus()");
    await p.key('Escape');
    await soon(`document.getElementById('tl-card').hidden && location.hash === '#goals'`, 'Escape closed it');
    await soon('TL.polling === null', 'no poll with no thread open');
    await p.ev(`location.hash = '#talk/${T}'`);
    await soon(`${shown('tl-card')} && document.getElementById('tl-card').dataset.key === '${T}'`, 'and again after Escape');
    // The link followed again before the Back's hashchange is handled (a loaded runner's pace, or an
    // owner's quick click): history.go fires popstate at once and queues hashchange, so the new entry
    // must be stamped from #goals, not from the card's entry Back left; else its × goes back two.
    await p.ev(`addEventListener('popstate', () => { location.hash = '#talk/${T}'; }, { once: true }); void 0`);
    await p.ev("document.getElementById('tl-c-text').focus()");
    await p.key('Escape');
    // (the subject's page head carries the card's t since kit-89, spec §2.5)
    await soon(`${shown('tl-card')} && location.hash === '#talk/${T}' && history.state?.page === '#goals?t=${T}'`, 'the link followed again at once');
    assert.equal(await p.ev('history.state.depth'), 1, 'one entry above #goals');
  });

  await t.test('a numbered pin on the goal, placed again after the 10 s rebuild, opening the thread without Shift', async () => {
    await p.ev('document.activeElement?.blur()');
    await soon(`!!document.querySelector('.tl-pin')`, 'a pin');
    const pin = () => p.ev(`(() => { const r = document.querySelector('.tl-pin').getBoundingClientRect(), g = document.querySelector('${goalSel}').getBoundingClientRect(); return { dx: Math.round(r.left + r.width / 2 - g.right), dy: Math.round(r.top + r.height / 2 - g.top), n: document.querySelector('.tl-pin').textContent }; })()`);
    const before = await pin();
    assert.equal(before.n, '1');
    assert.ok(Math.abs(before.dx) <= 2 && Math.abs(before.dy) <= 2, `at the goal's top right corner: ${JSON.stringify(before)}`);
    // Goals draws only what changed (kit-90): its last drawing forgotten, so the next poll rebuilds the card
    await p.ev(`window.__g = document.querySelector('${goalSel}'); GOALS_HTML = ''; void 0`);
    await soon('!window.__g.isConnected', 'the goal card redrawn');
    assert.deepEqual(await pin(), before, 'placed again after the rebuild');
    await click('[data-tl-close]');
    await soon(`document.getElementById('tl-card').hidden`, 'closed');
    await click('.tl-pin');
    await soon(`${shown('tl-card')} && document.getElementById('tl-card').dataset.key === '${T}'`, 'the card from its pin');
  });

  await t.test('the panel: the Inbox button counting a reply, where each subject is, New thread with no subject', async () => {
    await click('[data-tl-close]');
    F.sup(['thread', 'reply', T, 'Noted.']);
    await soon(`document.querySelector('.pagebar .tt .n.th.you')?.textContent === '1'`, 'the count: one your move');
    await onThreads();
    await soon(`document.querySelector('#tl-list [data-tl-open="${T}"]')?.textContent.includes('Goals') && !!document.querySelector('#tl-list [data-tl-open="${T}"] .th-st.you')`, 'where its subject is, and its mark');
    await click('[data-tl-new]');
    await soon(`${shown('tl-card')} && !!document.querySelector('#th-card-slot #tl-card.in-panel')`, 'a card in the panel');
    await p.ev("document.getElementById('tl-c-text').focus()");
    await p.type('What about onboarding?');
    await p.key('Enter', 8);
    const n = await until(() => threads().find((x) => x.title === 'What about onboarding?'), 'the thread with no subject');
    assert.equal(n.subject, null);
    await p.ev('document.activeElement?.blur()');
    await click('[data-tl-back]');
    await soon(`/Open 2/.test(document.querySelector('#th-pane [data-thf="open"]')?.textContent)`, 'two open');
  });

  await t.test('the pin button: pointing without Shift, until Esc', async () => {
    await onThreads();
    await click('#tl-pinbtn');
    assert.equal(await p.ev(`document.getElementById('tl-pinbtn').getAttribute('aria-pressed')`), 'true');
    await still(async () => { const at = await p.at(`${goalSel} h4`); await p.move(at.x, at.y, 0); });
    await soon(shown('tl-cursor'), 'the pin without Shift');
    await p.key('Escape');
    await soon(`document.getElementById('tl-cursor').hidden && document.getElementById('tl-pinbtn').getAttribute('aria-pressed') === 'false'`, 'out of pin mode');
  });

  await t.test("a panel row keeps the keyboard's focus through reads that change the list", async () => {
    await onThreads();
    // the owner's word first, so the supervisor's reply below changes the row's mark
    F.owner(['thread', 'say', T, 'Over to you.']);
    await p.ev('tlRefresh()');
    await soon(`!!document.querySelector('#tl-list [data-tl-open="${T}"] .th-st.wait')`, 'its row, waiting on the supervisor');
    await p.ev(`window.__row = document.querySelector('#tl-list [data-tl-open="${T}"]'); window.__row.focus(); void 0`);
    F.sup(['thread', 'reply', T, 'One more thing.']);
    // a read begun now, and the polls beside it: waited on until one has brought the reply in
    await p.ev('tlRefresh()');
    await soon(`TL.threads.find((x) => x.id === '${T}').turns.some((u) => u.text === 'One more thing.')`, 'the reads brought the reply in');
    assert.ok(await p.ev('document.activeElement === window.__row && window.__row.isConnected'), 'focus still on the same row');
    await p.ev('window.__row.blur()');
    await p.ev('tlRefresh()');
    await soon(`!!document.querySelector('#tl-list [data-tl-open="${T}"] .th-st.you[role="img"][aria-label]')`, 'drawn once focus left, its mark named');
  });

  await t.test('a press on a pin across a read that adds a pin still opens its card', async () => {
    await click('#th-close');
    // closed, and the page back at rest (its margin slides over --dur), so the pin stays where it is found
    await soon(`!document.body.classList.contains('threads-open') && getComputedStyle(document.querySelector('.main')).marginRight === '0px'`, 'the panel closed, the page at rest');
    // still from finding the pin to pressing it; the reads then land under the press
    const at = await still(async () => {
      const xy = await p.at('.tl-pin');
      await p.ev(`window.__pin = document.querySelector('.tl-pin'); void 0`);
      await p.move(xy.x, xy.y);
      await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...xy, button: 'left', buttons: 1, clickCount: 1 });
      return xy;
    });
    F.owner(['thread', 'new', 'About this spot', '--subject', JSON.stringify({ kind: 'page', view: '#goals', at: { x: 0.5, y: 0.9 } })]);
    await p.ev('tlRefresh()');
    await soon(`document.querySelectorAll('.tl-pin').length === 2`, 'the new pin drawn');
    assert.ok(await p.ev('window.__pin.isConnected'), 'the pressed pin kept, not drawn again');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', buttons: 0, clickCount: 1 });
    await soon(`${shown('tl-card')} && document.getElementById('tl-card').dataset.key === '${T}'`, 'the card from the pressed pin');
    await click('[data-tl-close]');
  });

  await t.test('pins stay under the drawer and its scrim', async () => {
    await p.ev('document.activeElement?.blur()');
    const at = await p.at('.tl-pin');
    await p.ev(`location.hash = '#goal/${F.goal}'`);
    await soon(shown('drawer'), 'the drawer');
    assert.equal(await p.ev(`!!document.elementFromPoint(${at.x}, ${at.y})?.closest('#tl-pins')`), false, 'no pin hit over the drawer');
    assert.equal(await p.ev(`[...document.querySelectorAll('.tl-pin')].some((b) => { const r = b.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.tl-pin') === b; })`), false, 'none on top anywhere');
    await p.key('Escape');
    await soon(`document.getElementById('drawer').hidden`, 'the drawer closed');
  });

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
      F.sup(['thread', 'reply', T, 'While you were away.']);
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
