// Threads on the dashboard page in Chrome, part 1: Shift and point, the card, the first send, the reply.
// Ports: none of its own (lib/kit.mjs's +0 hub, +1..25)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

// The thread layer in Chrome, on a project of its own: aiming (this task), the card (Task 11), the
// pins and the dock (Task 12), questions and resolving (Task 13). One page; the subtests run in order.
const NOT_DELIVERED_37 = 'Not delivered: no supervisor terminal took it. The supervisor sees it only when it next checks; it last checked 37 min ago.';
test("threads on the dashboard page: Shift and point, the card, the pins and the dock (part 1 of 8: pointing, the card, the first send, the reply)", { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 300000 }, async (t) => {
  const { F, Q0, p, soon, still, click, goalSel, shown, threads } = await openThreadsPage(t, 'threads-page-1');
  let T;

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
});
