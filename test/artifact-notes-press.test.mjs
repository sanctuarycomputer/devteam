// kit-145: what a framed page can't do in the viewer: make a press of the owner's count that they didn't aim (spec, amendment 2).
// The page's own messages, real mouse, touch and keys, in headless Chrome, on the setup of fixtures/artifact-notes-viewer.
// Skipped where Chrome can't be driven, as the kit's other Chrome tests are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDrive } from './lib/chrome.mjs';
import { J, FRAMES, CLOSED } from './fixtures/artifact-viewer/harness.mjs';
import { notes, AT, SHOT, ADDR, ROW, withFrame, V_C11, NEWER } from './fixtures/artifact-notes-viewer/kit.mjs';

test('the viewer: what a framed page cannot do to a press, the bar, the card', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 240000 }, async (t) => {
  const X = await notes(t, 'artifact-notes-press');
  const { sub } = X;
  const { N, AV_WT, AV_MAIN, plant, openAt, shown, text, has, tabOf, cardOf, holdPoll, LIVE, ARMED, at, press, settled, enter, forge, spot, SETTLE, acts, heldShown, byArrow, tapOn } = X;
  // a press that must count, on a control that is live: made again only if its second began again meanwhile, as frames that
  // stall on a busy box make it; a live control's press that doesn't count is red
  const counts = async (V, sel, done, what, how = press) => {
    const el = `document.querySelector(${J(sel)})`, since = `([...avStep.press.seen.values()].find((r) => r.el === ${el})?.since ?? null)`;
    for (let k = 0; k < 6; k++) {
      // (read in one go: a second begun again between two reads would look like none)
      let was = null;
      const end = Date.now() + 8000;
      while (was === null && Date.now() < end) { was = await V.p.ev(`${LIVE(el)} ? ${since} : null`); if (was === null) await new Promise((r) => setTimeout(r, 40)); }
      assert.notEqual(was, null, `${what}: it is live`);
      await how(V, sel);
      if (await V.settle(done, 1500)) return;
      assert.notEqual(await V.p.ev(since), was, `${what}: a live control's press counts`);
    }
    assert.fail(what);
  };
  await sub('A24: a page that moves Resolve under the pointer gets no press', async () => {
    const V = await byArrow();
    const was = await V.p.ev(SETTLE('#tl-card [data-tl-accept]'));
    await spot(V, N.trial, { x: 700, y: 420, w: 60, h: 20 });
    await V.soon(`${SETTLE('#tl-card [data-tl-accept]')} !== ${J(was)}`, 'setup: the card moved');
    await press(V, '#tl-card [data-tl-accept]');
    await V.p.ev(FRAMES);
    assert.deepEqual(await acts(V, 'thread-accept-addressed'), [], 'a press on what just moved posts nothing');
    assert.ok(await V.settle(heldShown, 1000), 'the words say why');
    await V.rows({ [N.trial]: withFrame(ROW.C12(), '') });
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(await V.p.ev(heldShown), true, 'the words still there after a redraw');
    await settled(V);
    await counts(V, '#tl-card [data-tl-accept]', `window.__posts.some((x) => x.action === 'thread-accept-addressed')`, 'settled: Resolve posts');
    assert.deepEqual(await acts(V, 'thread-accept-addressed'), [{ id: N.trial, at: AT }], 'the note as drawn');
  });

  await sub('A24: a move or a swap in the press itself, a press begun too soon, and a double click', async () => {
    const V = await byArrow();
    const posts = () => acts(V, 'thread-accept-addressed');
    // moved between the press and the release, by a listener that runs first
    await V.p.ev(`(document.getElementById('tl-card').style.marginLeft = '0px', window.__mv = (e) => { document.getElementById('tl-card').style.marginLeft = '3px'; }, window.addEventListener('mousedown', window.__mv, { capture: true, once: true }), true)`);
    await press(V, '#tl-card [data-tl-accept]');
    await V.p.ev(FRAMES);
    assert.deepEqual(await posts(), [], 'moved in the press: nothing');
    // begun before it settled, released after
    await V.p.ev(`(document.getElementById('tl-card').style.marginLeft = '0px', true)`);
    await V.p.ev(FRAMES);
    const { x, y } = await at(V, '#tl-card [data-tl-accept]');
    await V.p.move(x, y);
    await V.p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await new Promise((r) => setTimeout(r, ARMED + 300));
    await V.p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await V.p.ev(FRAMES);
    assert.deepEqual(await posts(), [], 'begun before it settled: nothing');
  });

  await sub('A24: a double click on the page that moves Resolve under its second press, and a thing drawn above it', async () => {
    const V = await byArrow();
    const R = '#tl-card .tl-addr [data-tl-accept]';
    const move = async (rect) => { const was = await V.p.ev(SETTLE(R)); await spot(V, N.trial, rect); await V.soon(`${SETTLE(R)} !== ${J(was)}`, 'setup: the card moved'); };
    await V.p.move(5, 5);
    await move({ x: 760, y: 420, w: 60, h: 20 });
    const p = await at(V, R);
    await move({ x: 40, y: 120, w: 220, h: 40 });
    await V.p.move(p.x, p.y);
    assert.ok(await V.p.ev(`document.elementFromPoint(${p.x}, ${p.y}) === tsFrame()`), 'setup: the page is there');
    await settled(V);
    const click = async (n) => { const b = { x: p.x, y: p.y, button: 'left', clickCount: n }; await V.p.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...b, buttons: 1 }); await V.p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...b, buttons: 0 }); };
    await click(1);
    await move({ x: 760, y: 420, w: 60, h: 20 });
    assert.ok(await V.p.ev(`document.querySelector(${J(R)}).contains(document.elementFromPoint(${p.x}, ${p.y}))`), 'setup: Resolve is under the pointer');
    await click(2);
    await V.p.ev(FRAMES);
    assert.deepEqual(await acts(V, 'thread-accept-addressed'), [], 'the second press of two: nothing');
    // something over it for its whole second, gone as the press comes
    await settled(V);
    await V.p.ev(`(() => { const r = document.querySelector(${J(R)}).getBoundingClientRect(), d = document.createElement('div'); d.id = 'zz-over'; d.style.cssText = 'position:fixed;z-index:999;background:red;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px'; document.body.append(d); return true; })()`);
    await V.soon(`document.querySelector(${J(R)}).classList.contains('waiting')`, 'setup: under it, it waits');
    await new Promise((r) => setTimeout(r, ARMED));
    await V.p.ev(`(document.getElementById('zz-over').remove(), true)`);
    await press(V, R);
    await V.p.ev(FRAMES);
    assert.deepEqual(await acts(V, 'thread-accept-addressed'), [], 'drawn above it until just now: nothing');
    // and a thing drawn above it in its card, pushing it down
    // (away from the edges: against the bottom the card is placed higher as it grows, and Resolve never moves at all)
    await V.p.move(5, 5);
    await V.p.ev('(document.activeElement?.blur(), true)');
    await move({ x: 40, y: 120, w: 220, h: 40 });
    await settled(V);
    // (pushed as the press's own move arrives, so a slow box can't let the second go by in between)
    await V.p.ev(`(window.__under = null, window.addEventListener('mousemove', (e) => {
      document.querySelector('#tl-card .tl-addr .by').insertAdjacentHTML('afterend', '<div style="height:4px"></div>');
      window.__under = document.querySelector(${J(R)}).contains(document.elementFromPoint(e.clientX, e.clientY)); }, { capture: true, once: true }), true)`);
    await press(V, R);
    await V.p.ev(FRAMES);
    assert.equal(await V.p.ev('window.__under'), true, 'setup: pushed, and Resolve is still under the pointer');
    assert.deepEqual(await acts(V, 'thread-accept-addressed'), [], 'pushed down just now: nothing');
    // crept, less than half a pixel a frame
    await settled(V);
    await V.p.ev(`(window.__cr = 0, window.__ct = true, (function creep() { if (!window.__ct) return; document.getElementById('tl-card').style.marginLeft = (window.__cr += 0.3) + 'px'; requestAnimationFrame(creep); })(), true)`);
    await V.soon('window.__cr > 5', 'setup: it crept, a little each frame');
    await new Promise((r) => setTimeout(r, ARMED + 300));
    await press(V, R);
    await V.p.ev(FRAMES);
    await V.p.ev('(window.__ct = false, true)');
    assert.deepEqual(await acts(V, 'thread-accept-addressed'), [], 'crept there: nothing');
  });

  await sub('A24: the picture closed by the page, stopped frames and a hidden tab leave Resolve unsettled', async () => {
    plant(N.trial, V_C11.shot.stamp);
    const V = await tabOf({ [N.trial]: withFrame(ROW.C12({ shot: SHOT() }), '') });
    await openAt(V, AV_WT, 'plan-pricing');
    await cardOf(V, N.trial);
    await holdPoll(V);
    await V.p.ev(`(window.__replies['thread-accept-addressed'] = { body: { ok: true, out: '' } }, true)`);
    await settled(V);
    const posts = () => acts(V, 'thread-accept-addressed');
    const soonAfter = async (what) => { await press(V, '#tl-card [data-tl-accept]'); await V.p.ev(FRAMES); assert.deepEqual(await posts(), [], what); };
    await V.p.click('#tl-card .tl-shot');
    await V.soon(`!!document.getElementById('av-shot')`, 'setup: the picture up');
    await new Promise((r) => setTimeout(r, ARMED));
    await V.focusFrame();
    await forge(V, { type: 'key', key: 'Escape' });
    await V.soon(`!document.getElementById('av-shot')`, 'setup: the page closed the picture');
    await soonAfter('uncovered just now: nothing');
    await settled(V);
    // frames that stopped for 400 ms, as the sampler sees it
    await V.p.ev(`(avStep.press.last -= 400, true)`);
    await V.p.ev(`(avStep.sample(), true)`);
    await soonAfter('a gap in the frames: nothing');
    await settled(V);
    await V.p.ev(`(document.dispatchEvent(new Event('visibilitychange')), true)`);
    await soonAfter('the tab hidden or shown: nothing');
    await settled(V);
    await counts(V, '#tl-card [data-tl-accept]', `window.__posts.some((x) => x.action === 'thread-accept-addressed')`, 'settled: Resolve posts');
  });

  await sub('A24: Hand over bared by the card closing, and another artifact\'s in the same place', async () => {
    const V = await byArrow();
    const bar = '#av-handover';
    await V.rows({ [N.trial]: withFrame(ROW.C12(), ''), [N.plans]: ROW.C20() });
    await has(V, bar, 'Hand over');
    // the card over Hand over, as a short window or a page's spot can put it
    await V.p.ev(`(() => { const r = document.getElementById('av-handover').getBoundingClientRect(), st = document.createElement('style'); st.id = 'zz-st'; st.textContent = '#tl-card { position: fixed !important; left: ' + (r.left - 100) + 'px !important; top: ' + (r.top - 40) + 'px !important; z-index: 99 !important; }'; document.head.append(st); return true; })()`);
    const p = await at(V, bar);
    assert.ok(await V.p.ev(`document.getElementById('tl-card').contains(document.elementFromPoint(${p.x}, ${p.y}))`), 'setup: the card is over Hand over');
    await new Promise((r) => setTimeout(r, ARMED));
    await V.focusFrame();
    await forge(V, { type: 'key', key: 'Escape' });
    await V.soon(`TL.open === null && document.getElementById('av-handover').contains(document.elementFromPoint(${p.x}, ${p.y}))`, 'setup: the page closed the card');
    await V.p.clickAt(p.x, p.y);
    await V.p.ev(FRAMES);
    assert.deepEqual(await acts(V, 'artifact-handoff'), [], 'bared just now: nothing');
    assert.ok(await V.settle(heldShown, 1000), 'and the words say why');
    await V.rows({ [N.trial]: ROW.C20(), [N.onMain]: ROW.C20() });
    await has(V, bar, 'Hand over');
    await new Promise((r) => setTimeout(r, ARMED));
    const was = await V.p.ev(SETTLE(bar));
    await V.p.ev(`(TS.at = 'main', true)`);
    assert.equal(await V.p.ev(SETTLE(bar)), was, 'setup: in the same place');
    await press(V, bar);
    await V.p.ev(FRAMES);
    assert.deepEqual(await acts(V, 'artifact-handoff'), [], 'another artifact\'s Hand over in its place: nothing');
    await V.p.ev(`(TS.at = 'plan-pricing', true)`);
    await new Promise((r) => setTimeout(r, ARMED));
    await counts(V, bar, `window.__posts.some((x) => x.action === 'artifact-handoff')`, 'settled: Hand over posts');
  });

  await sub('A24: after the viewer closes, what it bared waits a second, by pointer and key; plain Send does not', async () => {
    const V = await tabOf({ [N.trial]: withFrame(ROW.C12(), '') });
    await V.p.ev(`(() => { const d = document.createElement('div'); d.id = 'zz'; d.innerHTML = '<button id="zz-a" data-answer="q-x">Answer</button><button id="zz-k" data-know="k-x">Know</button><button id="zz-g" data-goal-grip>Grip</button>'; d.style.cssText = 'position:fixed;left:300px;top:300px;z-index:50'; document.body.append(d); window.__hits = []; d.addEventListener('click', (e) => { window.__hits.push(e.target.id); e.stopPropagation(); }); d.addEventListener('keydown', (e) => { if (e.key.startsWith('Arrow')) window.__hits.push('arrow'); e.stopPropagation(); }); d.addEventListener('pointerdown', (e) => { if (e.target.id === 'zz-g') window.__hits.push('drag'); }); return true; })()`);
    await openAt(V, AV_WT, 'plan-pricing');
    await V.focusFrame();
    const shut = async () => { await V.p.ev(`(window.__hits = [], leaveArtifact(), true)`); await V.soon(CLOSED, 'setup: closed'); };
    await V.p.ev(`(window.__t0 = 0, new MutationObserver(() => { window.__t0 = performance.now(); }).observe(document.getElementById('artifact-view'), { attributes: true, attributeFilter: ['hidden'] }), true)`);
    // a run slower than the second shows nothing: it is made again
    let late = Infinity;
    for (let i = 0; i < 5 && late >= 950; i++) {
      if (i) { await openAt(V, AV_WT, 'plan-pricing'); await V.focusFrame(); await V.p.ev('(window.__hits = [], true)'); }
      await forge(V, { type: 'key', key: 'Escape' });
      await V.soon(CLOSED, 'setup: the page closed the viewer');
      await press(V, '#zz-a'); await press(V, '#zz-k');
      await V.p.ev(`(document.getElementById('zz-a').focus(), true)`); await enter(V);
      await V.p.ev(`(document.getElementById('zz-k').focus(), true)`); await enter(V);
      await V.p.ev(`(document.getElementById('zz-g').focus(), true)`); await V.p.key('ArrowDown'); await press(V, '#zz-g');
      late = await V.p.ev('performance.now() - window.__t0');
    }
    assert.ok(late < 950, `setup: all within the second (${late})`);
    assert.deepEqual(await V.p.ev('window.__hits'), [], 'nothing within the second, by pointer or key');
    assert.ok(await V.settle(heldShown, 1000), 'the words say why');
    await new Promise((r) => setTimeout(r, ARMED));
    await press(V, '#zz-a'); await press(V, '#zz-k');
    await V.p.ev(`(document.getElementById('zz-a').focus(), true)`); await enter(V);
    assert.deepEqual(await V.p.ev('window.__hits'), ['zz-a', 'zz-k', 'zz-a'], 'the second over: as ever');
    await V.p.ev(`(window.__hits = [], document.getElementById('zz-g').focus(), true)`); await V.p.key('ArrowDown'); await press(V, '#zz-g');
    assert.deepEqual(await V.p.ev('window.__hits'), ['arrow', 'drag', 'zz-g'], 'the grip too');
    // plain Send isn't held
    await openAt(V, AV_WT, 'plan-pricing');
    await cardOf(V, N.trial);
    await V.p.ev(`(window.__sent = 0, document.getElementById('tl-card').addEventListener('click', (e) => { if (e.target.closest('[data-tl-send]')) { window.__sent++; e.stopPropagation(); } }), true)`);
    await shut();
    await V.p.ev(`(document.querySelector('[data-tl-send]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })), true)`);
    assert.equal(await V.p.ev('window.__sent'), 1, 'plain Send at once');
    // Shift+Enter in a resolved thread's composer reopens it: held, then not
    await V.p.ev(`(window.__replies['thread-say'] = window.__replies['thread-reopen'] = { body: { ok: true, out: '' } }, true)`);
    await V.rows({ [N.trial]: { ...ROW.C20(), status: 'resolved' } });
    await openAt(V, AV_WT, 'plan-pricing');
    await cardOf(V, N.trial);
    const turns = () => V.p.ev(`window.__posts.filter((x) => /^thread-(say|reopen)$/.test(x.action)).length`);
    const shiftEnter = async () => { await V.p.ev(`(() => { const t = document.getElementById('tl-c-text'); t.focus(); t.value = 'Again'; return true; })()`); const k = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 8 }; await V.p.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k }); await V.p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k }); };
    const n = await turns();
    await shut();
    await cardOf(V, N.trial);
    await shiftEnter();
    assert.equal(await turns(), n, 'Shift+Enter that reopens: nothing within the second');
    await new Promise((r) => setTimeout(r, ARMED));
    await shiftEnter();
    await V.soon(`window.__posts.filter((x) => /^thread-(say|reopen)$/.test(x.action)).length > ${n}`, 'the second over: it posts');
  });

  await sub('A24: with no viewer up Resolve settles and posts, and holds a mark swapped in; other presses as today', async () => {
    const V = await tabOf({ [N.trial]: withFrame(ROW.C12(), '') });
    await openAt(V, AV_WT, 'plan-pricing');
    await V.p.ev(`(window.__replies['thread-accept-addressed'] = { body: { ok: true, out: '' } }, window.__replies['thread-reopen'] = { body: { ok: true, out: '' } }, true)`);
    await V.p.ev('(leaveArtifact(), true)');
    await V.soon(CLOSED, 'setup: no viewer');
    await cardOf(V, N.trial);
    await holdPoll(V);
    await has(V, '#tl-card .tl-addr', 'the block');
    await settled(V);
    await V.rows({ [N.trial]: withFrame(ROW.C12({ addressed: ADDR({ at: NEWER, note: 'Swapped in', sha: null }) }), '') });
    await V.soon(`${text('#tl-card .tl-addr .tx')} === 'Swapped in'`, 'the new note drawn');
    await press(V, '#tl-card [data-tl-accept]');
    await V.p.ev(FRAMES);
    assert.deepEqual(await acts(V, 'thread-accept-addressed'), [], 'a mark swapped in: nothing');
    await settled(V);
    await counts(V, '#tl-card [data-tl-accept]', `window.__posts.some((x) => x.action === 'thread-accept-addressed')`, 'settled with no viewer: Resolve posts');
    assert.deepEqual(await acts(V, 'thread-accept-addressed'), [{ id: N.trial, at: NEWER }], 'the new mark');
    // another press in the same card isn't held
    const W = await tabOf({ [N.trial]: { ...ROW.C20(), status: 'resolved' } });
    await W.p.ev(`(window.__replies['thread-reopen'] = { body: { ok: true, out: '' } }, true)`);
    await cardOf(W, N.trial);
    await W.p.ev(`(document.querySelector('#tl-card [data-tl-reopen]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })), true)`);
    await W.soon(`window.__posts.some((x) => x.action === 'thread-reopen')`, 'no viewer: Reopen at once');
  });

  await sub('A24: a tap on what has settled posts (Resolve, Hand over, an answer)', async () => {
    const V = await byArrow();
    await V.rows({ [N.trial]: withFrame(ROW.C12(), ''), [N.plans]: ROW.C20() });
    await has(V, '#av-handover', 'Hand over');
    await V.p.ev(`(document.querySelector('#tl-card .tl-addr').insertAdjacentHTML('beforebegin', '<button id="zz-q" data-answer="x">Answer</button>'), window.__q = 0, window.addEventListener('click', (e) => { if (e.target.id === 'zz-q') { window.__q++; e.stopImmediatePropagation(); } }, true), true)`);
    await V.p.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await new Promise((r) => setTimeout(r, ARMED));
    await settled(V);
    await counts(V, '#zz-q', 'window.__q === 1', 'a tap on a settled answer', tapOn);
    await counts(V, '#av-handover', `window.__posts.some((x) => x.action === 'artifact-handoff')`, 'a tap on a settled Hand over posts', tapOn);
    await settled(V);
    await counts(V, '#tl-card [data-tl-accept]', `window.__posts.some((x) => x.action === 'thread-accept-addressed')`, 'a tap on the settled Resolve posts', tapOn);
  });

  await sub('A24: the rule holds in a /view/ tab; a person who may only look gets their own words', async () => {
    const V = await tabOf({ [N.trial]: withFrame(ROW.C12(), ''), [N.plans]: ROW.C20() }, '', { path: 'view/artifact/pricing?at=plan-pricing' });
    await V.p.ev(`(window.__replies['thread-accept-addressed'] = { body: { ok: true, out: '' } }, window.__replies['artifact-handoff'] = { body: { to: 'plan-pricing', typed: true, count: 1 } }, true)`);
    await V.soon('TS.ready', 'setup: the page is up');
    await cardOf(V, N.trial);
    await holdPoll(V);
    await settled(V);
    await V.p.ev(`(document.getElementById('tl-card').style.marginLeft = '3px', document.getElementById('av-notes').style.marginRight = '9px', true)`);
    await press(V, '#tl-card [data-tl-accept]');
    await press(V, '#av-handover');
    await V.p.ev(FRAMES);
    assert.deepEqual([await acts(V, 'thread-accept-addressed'), await acts(V, 'artifact-handoff')], [[], []], 'moved just now: nothing');
    await new Promise((r) => setTimeout(r, ARMED));
    await settled(V);
    await counts(V, '#av-handover', `window.__posts.some((x) => x.action === 'artifact-handoff')`, 'settled: Hand over posts');
    await settled(V);
    await counts(V, '#tl-card [data-tl-accept]', `window.__posts.some((x) => x.action === 'thread-accept-addressed')`, 'settled: Resolve posts');
    const W = await byArrow();
    await W.p.ev(`(window.__vo = viewOnly, viewOnly = () => window.__vo('view'), viewOnly(), avStep.forget(), true)`);
    await press(W, '#tl-card [data-tl-accept]');
    await W.p.ev(FRAMES);
    assert.deepEqual(await acts(W, 'thread-accept-addressed'), [], 'a person who may only look: nothing');
    assert.equal(await W.p.ev(`document.getElementById('view-only-toast')?.textContent`), 'View only: you can look, but not change anything', 'their own words');
    assert.equal(await W.p.ev(heldShown), false, 'not the rule\'s');
  });

  // what VIEW_WRITES names, by whether the card or the viewer's bar draws it
  const DRAWN = ['[data-answer]', '[data-cant]', '[data-reply]', '[data-dontuse]', '[data-decline]', '[data-oa-know]', '[data-oa-goal]', '[data-tl-accept]', '[data-tl-notyet]', '[data-tl-resolve-go]', '[data-tl-reopen]', '[data-ask-option]', '[data-ask-esc]'];
  const BAR = ['#av-handover', '[data-preview-start]', '[data-preview-stop]'];
  const NOT_DRAWN = ['[data-post-secrets]', '[data-overrule-send]', '[data-correct-send]', '[data-rv-answer]', '[data-rv-decline]', '[data-know]', '[data-hold-id]', '[data-met-id]', '[data-goal-move]', '[data-forget]', '[data-limit-save]', '[data-limit-none]', '[data-limit-step]', '.fleet-switch [data-fleet]', '[data-checknow]', '[data-goal-grip]'];
  const FREE = ['[data-tl-send]', 'a[href*="/public/"]', '.dropbox[data-drop] textarea', '.dropbox[data-drop] input', '#tl-c-text'];
  await sub('A24b: every decision press in the card and the bar is held until it has settled', async () => {
    const V = await byArrow();
    const all = (await V.p.ev('VIEW_WRITES')).split(', ');
    assert.deepEqual([...all].sort(), [...DRAWN, ...BAR, ...NOT_DRAWN, ...FREE].sort(), 'every entry of VIEW_WRITES is in one list here');
    // one of each, in the card and the bar, with the owner's handlers seen and not run
    await V.p.ev(`(() => {
      const tag = (s) => s[0] === '#' ? '' : s.replace(/^\\[|\\]$/g, '');
      const c = document.getElementById('tl-card'), w = document.createElement('div'); w.id = 'zz-w'; w.style.cssText = 'position:fixed;left:20px;top:90px;width:700px;z-index:99;background:#fff';
      for (const s of ${J(DRAWN)}) w.insertAdjacentHTML('beforeend', '<button style="width:80px;height:24px" class="zz" data-zz="' + tag(s) + '" ' + tag(s) + '="x">B</button>');
      w.insertAdjacentHTML('beforeend', '<button style="width:80px;height:24px" class="zz" data-zz="two" data-oa-know="l-1">Same</button><button style="width:80px;height:24px" class="zz" data-zz="two" data-oa-know="l-1">Same</button>');
      c.append(w);
      const b = document.createElement('div'); b.id = 'zz-b'; b.style.cssText = 'position:fixed;left:900px;top:600px;z-index:99;background:#fff';
      for (const s of ${J(BAR.slice(1))}) b.insertAdjacentHTML('beforeend', '<button style="width:80px;height:24px" class="zz" data-zz="' + tag(s) + '" ' + tag(s) + '="x">B</button>');
      document.querySelector('.av-bar').append(b);
      window.__zz = []; window.addEventListener('click', (e) => { const z = e.target.closest?.('.zz'); if (z) { window.__zz.push(z.dataset.zz); e.stopImmediatePropagation(); } }, true);
      return true;
    })()`);
    const spots = () => V.p.ev(`[...document.querySelectorAll('.zz')].map((e) => { const r = e.getBoundingClientRect(); return { n: e.dataset.zz, x: r.left + r.width / 2, y: r.top + r.height / 2 }; })`);
    const names = (await spots()).map((s) => s.n);
    // settled, then all moved, then each pressed at once
    await new Promise((r) => setTimeout(r, ARMED + 100));
    let left = 40;
    for (let i = 0; i < names.length; i++) {
      await V.p.ev(`(document.getElementById('zz-w').style.left = '${left}px', document.getElementById('zz-b').style.left = '${880 + left++}px', true)`);
      const s = (await spots())[i];
      await V.p.clickAt(s.x, s.y);
    }
    assert.deepEqual(await V.p.ev('window.__zz'), [], 'moved just now: none gets through');
    // (frames that stall on a busy box start a second again: each is pressed once it is live)
    for (const [i, x] of (await spots()).entries()) await counts(V, `.zz[data-zz="${x.n}"]`, `window.__zz.length > ${i}`, 'settled: each gets through', () => V.p.clickAt(x.x, x.y));
    assert.deepEqual(await V.p.ev('window.__zz'), names, 'settled: each gets through');
    // another lesson's button in the same place
    await V.p.ev(`(window.__zz = [], document.querySelectorAll('.zz[data-zz="two"]').forEach((e) => { e.dataset.oaKnow = 'l-2'; }), true)`);
    const two = (await spots()).find((s) => s.n === 'two');
    await V.p.clickAt(two.x, two.y);
    assert.deepEqual(await V.p.ev('window.__zz'), [], 'another lesson in its place: nothing');
    // a key isn't held
    await V.p.ev(`(document.getElementById('zz-w').style.left = '60px', document.querySelector('.zz[data-tl-reopen]').focus(), true)`);
    await enter(V);
    assert.deepEqual(await V.p.ev('window.__zz'), ['data-tl-reopen'], 'the keyboard at once');
  });

  await sub('A24b: Send of plain words is not held; Send that reopens a resolved thread is', async () => {
    for (const [row, want] of [[{ ...ROW.C20() }, 1], [{ ...ROW.C20(), status: 'resolved' }, 0]]) {
      const V = await tabOf({ [N.trial]: row });
      await openAt(V, AV_WT, 'plan-pricing');
      await cardOf(V, N.trial);
      await holdPoll(V);
      await V.p.ev(`(window.__s = 0, document.addEventListener('click', (e) => { if (e.target.closest('[data-tl-send]')) window.__s++; }, true), document.getElementById('tl-card').style.marginLeft = '2px', true)`);
      await press(V, '[data-tl-send]');
      assert.equal(await V.p.ev('window.__s'), want, want ? 'plain words: at once' : 'it would reopen: held');
      if (!want) { await counts(V, '[data-tl-send]', 'window.__s > 0', 'settled: it goes'); assert.equal(await V.p.ev('window.__s'), 1, 'settled: once'); }
    }
  });

  await sub('A24c: a page that never rests holds no one for ever; a redraw in place restarts nothing', async () => {
    const V = await byArrow();
    const loop = (on) => V.p.ev(on ? `(window.__k = 0, window.__lp = setInterval(() => { const key = TS.keyOf.get(tKey(TL.threads.find((t) => t.id === ${J(N.trial)}).subject)); tsFrame().contentWindow.postMessage({ forge: { type: 'rects', rects: [{ key, rect: { x: 100 + Math.abs((window.__k++ % 24) - 12), y: 120, w: 60, h: 20 } }] } }, '*'); }, 16), true)` : '(clearInterval(window.__lp), true)');
    await loop(true);
    await new Promise((r) => setTimeout(r, 400));
    // a tap where it is now, and Enter, while it moves
    await V.p.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await tapOn(V, '#tl-card [data-tl-accept]');
    assert.ok(await V.settle(heldShown, 1500), 'a tap is refused with the words');
    assert.deepEqual(await acts(V, 'thread-accept-addressed'), [], 'a tap while it moves: nothing');
    await V.p.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await V.p.move(5, 790);
    await V.p.ev(`(document.activeElement?.blur?.(), true)`);
    await new Promise((r) => setTimeout(r, 300));
    const where = new Set();
    for (let i = 0; i < 6; i++) { where.add(await V.p.ev(SETTLE('#tl-card'))); await new Promise((r) => setTimeout(r, 35)); }
    assert.ok(where.size > 1, `setup: the card moves (${[...where].join(' ')})`);
    const c = await V.p.ev(`(() => { const r = document.getElementById('tl-card').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await V.p.move(c.x, c.y);
    await settled(V);
    await counts(V, '#tl-card [data-tl-accept]', `window.__posts.some((x) => x.action === 'thread-accept-addressed')`, 'the pointer on the card: it settles and posts');
    await loop(false);
    // the keyboard, on a page that moves it with nothing on the card
    const W = await byArrow();
    await W.p.move(5, 5);
    await W.p.ev(`(window.__mg = 0, window.__mt = setInterval(() => { document.getElementById('tl-card').style.marginLeft = (window.__mg++ % 20) + 'px'; }, 16), document.querySelector('#tl-card [data-tl-accept]').focus(), true)`);
    await enter(W);
    await W.soon(`window.__posts.some((x) => x.action === 'thread-accept-addressed')`, 'Enter at once');
    await W.p.ev('(clearInterval(window.__mt), true)');
    // redrawn in the same place every 100 ms: the same deed, so its second runs out
    const X = await byArrow();
    await X.p.ev(`(avStep.forget(), window.__rd = setInterval(() => { const p = document.querySelector('#tl-card .tl-addr')?.parentElement; if (p) p.innerHTML = p.innerHTML; }, 100), true)`);
    await X.soon(`document.querySelector('#tl-card .tl-addr [data-tl-accept]').classList.contains('waiting')`, 'setup: its second begun again');
    await settled(X);
    await X.p.ev('(clearInterval(window.__rd), true)');
  });

  await sub('A25: at phone, tablet and desktop widths every control of the bar is its own, inside the viewer', async () => {
    const V = await tabOf({ [N.trial]: ROW.C20(), [N.plans]: withFrame(ROW.C12(), ''), [N.onMain]: ROW.C20() });
    // the bar as full as it gets, set and measured in one go: a 34-character session, With, a note in the head, an
    // 80-character refusal, the Public tile with its globe
    const bad = (tile) => V.p.ev(`(() => {
      const $$ = (id) => document.getElementById(id), view = $$('artifact-view').getBoundingClientRect(), out = [];
      $$('av-where').textContent = AV.at === 'main' ? 'main' : 'plan-pricing-with-a-longer-name-34';
      $$('av-with').hidden = false; $$('av-with').textContent = 'With plan-pricing-with-a-longer-name-34';
      $$('e-avn').textContent = ${tile ? J('Not saved: there is no session that could take these notes for pricing just now.') : J('')};
      $$('av-note').hidden = ${!tile}; $$('av-note').textContent = 'Its page changed since';
      const w = document.querySelector('.av-pub-wrap'), was = w.innerHTML;
      w.innerHTML = ${tile ? J('<button class="ghost av-pill amber" id="zz-pub"><i class="icon-globe"></i>Public · update available</button>') : J('')};
      for (const id of ['av-prev', 'av-next', 'av-filter', 'av-handover', 'av-ver', 'av-reload', 'av-tab', 'av-close', ...(${!!tile} ? ['zz-pub'] : [])]) {
        const e = $$(id), r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
        if (!(r.width >= 10 && r.height >= 10)) out.push(id + ' has no size');
        else if (!e.contains(hit)) out.push(id + ' is under ' + (hit ? hit.id || hit.className || hit.tagName : 'nothing'));
        else if (r.left < view.left || r.right > view.right + 0.5 || r.bottom > view.bottom) out.push(id + ' is outside the viewer');
      }
      const bar = document.querySelector('.av-bar').getBoundingClientRect().height, row = $$('av-step').getBoundingClientRect().top >= $$('av-reload').getBoundingClientRect().bottom;
      if (view.width > 1100 ? bar !== 41 || row : bar <= 41 || !row) out.push('the bar is ' + bar + ' tall at ' + view.width + (row ? ', a row of notes' : ', one row'));
      w.innerHTML = was; $$('e-avn').textContent = ''; $$('av-note').hidden = true;
      return out; })()`);
    const found = [];
    for (const [head, at] of [[AV_WT, 'plan-pricing'], [AV_MAIN, 'main']]) {
      await V.size(1280, 800);
      await openAt(V, head, at);
      await has(V, '#av-handover', 'Hand over');
      for (const w of [320, 375, 390, 430, 601, 700, 768, 820, 1024, 1140, 1180, 1280]) {
        await V.size(w, 800);
        await V.p.ev(FRAMES);
        for (const tile of [false, true]) for (const x of await bad(tile)) found.push(`${w}${tile ? ' with the tile' : ''} on ${at}: ${x}`);
      }
      await V.p.ev(`(thGo({ th: 'open' }), true)`);
      for (const w of [1024, 1280, 1560]) {
        await V.size(w, 800);
        await V.soon(`(() => { const r = document.getElementById('artifact-view').getBoundingClientRect(), k = r.width; const was = window.__vw; window.__vw = k; return was === k && k < ${w} - 300; })()`, `setup: the panel narrows the viewer at ${w}`);
        for (const x of await bad(true)) found.push(`${w} with the panel on ${at}: ${x}`);
      }
      await V.p.ev(`(thGo({}), true)`);
    }
    assert.deepEqual(found, [], 'each control is its own');
    // with no notes the bar is one row at every width, as a preview's
    await V.size(700, 800);
    assert.deepEqual(await V.p.ev(`(() => { const n = document.getElementById('av-notes'), was = n.hidden; n.hidden = true; const b = document.querySelector('.av-bar'), r = [b.getBoundingClientRect().height, getComputedStyle(b).flexWrap, getComputedStyle(document.querySelector('.av-ver-wrap')).minWidth]; n.hidden = was; return r; })()`), [41, 'nowrap', '0px'], 'no notes: one row');
    // cut in the one-row bar
    await V.size(1280, 800);
    await openAt(V, AV_WT, 'plan-pricing');
    assert.ok(await V.p.ev(`(() => { const e = document.getElementById('av-with'); e.hidden = false; e.textContent = 'With ' + 'x'.repeat(80); return e.getBoundingClientRect().width <= 200; })()`), 'With is at most 200px in the one-row bar');
  });

  await sub('A26: with all it can hold, the card keeps Show me, Resolve, the reply box and Send inside the window', async () => {
    const long = 'The trial button says what it does now, and the price under it reads as the plan page has it. '.repeat(4).slice(0, 300);
    plant(N.onMain, V_C11.shot.stamp);
    const V = await tabOf({ [N.onMain]: ROW.C12({ addressed: ADDR({ note: long }), shot: SHOT({ anchor: 'hidden' }) }) });
    await openAt(V, AV_MAIN, 'main');
    await cardOf(V, N.onMain);
    await holdPoll(V);
    await V.soon(`!!document.querySelector('#tl-card .tl-shot img') && !!document.querySelector('#tl-card [data-tl-show]')`, 'setup: the picture and Show me');
    for (const [w, h] of [[1280, 800], [1280, 640], [390, 844], [320, 568]]) {
      await V.size(w, h);
      // both lines above, a phone's picture, the context open, the terminal asking
      await V.p.ev(`(() => {
        avStep.unseen = () => true; avStep.off = { id: TL.open, av: AV, gone: true };
        tlDraw();
        const d = document.querySelector('#tl-c-ctx details'); if (d) d.open = true;
        document.querySelector('#tl-card .tl-shot img').src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="390" height="700"><rect width="390" height="700" fill="red"/></svg>');
        return true; })()`);
      await V.soon(`document.querySelector('#tl-card .tl-shot img')?.naturalHeight === 700`, 'setup: a tall picture');
      await V.p.ev(FRAMES);
      const got = await V.p.ev(`(() => {
        ASK.q = { kind: 'menu', digest: 'd-26', token: 'tok', question: 'Which of the three should it be, with the words the terminal shows over several lines of it?', options: [1, 2, 3].map((n) => ({ n, label: 'Option ' + n + ', said at some length' })), hint: 'Enter to confirm' };
        askDraw();
        const card = document.getElementById('tl-card'), c = card.getBoundingClientRect(), out = [];
        const lines = [...card.querySelectorAll('.tl-nview')].map((e) => e.textContent);
        if (lines.length !== 2) out.push('setup: lines ' + JSON.stringify(lines));
        if (!card.querySelector('#tl-c-ctx details')?.open) out.push('setup: no open context');
        if (card.querySelectorAll('[data-ask-option]').length !== 3) out.push('setup: no ask');
        for (const s of ['.tl-addr [data-tl-show]', '.tl-addr [data-tl-accept]', '#tl-c-text', '[data-tl-send]']) {
          const e = card.querySelector(s), r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (!(r.width > 10 && r.height > 10) || r.top < 0 || r.left < 0 || r.right > innerWidth || r.bottom > innerHeight || r.bottom > c.bottom) out.push(s + ' is at ' + [r.left, r.top, r.right, r.bottom].map(Math.round) + ', the card ' + Math.round(c.top) + ' to ' + Math.round(c.bottom));
          else if (!e.contains(hit)) out.push(s + ' is under ' + (hit ? hit.id || hit.className || hit.tagName : 'nothing'));
        }
        for (const [s, floor] of [['.tl-words', 54], ['#tl-c-ask', 44], ['#tl-c-ctx', 44]]) {
          const e = card.querySelector(s), r = e?.getBoundingClientRect();
          if (!r || r.height < floor) { out.push(s + ' is ' + r?.height + ' tall'); continue; }
          e.scrollTop = 99999;
          const last = [...e.querySelectorAll('*')].filter((x) => x.getBoundingClientRect().height).reduce((m, x) => Math.max(m, x.getBoundingClientRect().bottom), 0);
          if (last > r.bottom + 12.5) out.push(s + ' does not scroll to its end: ' + last + ' past ' + r.bottom);
          e.scrollTop = 0;
        }
        const i = card.querySelector('.tl-shot img').getBoundingClientRect();
        if (i.width !== 160 || i.height > 120) out.push('the picture is ' + i.width + ' by ' + i.height);
        return out; })()`);
      assert.deepEqual(got, [], `${w}x${h}`);
    }
  });
});
