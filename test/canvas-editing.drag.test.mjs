import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { canDrive } from './lib/chrome.mjs';
import { CANT_GO, EVERY, EVERY_IMAGES, IMG_PATH, MINIMAL, ackOf, added, ana, arrow, body, box, centre, count, drag, dragPath, edits, focusField, hitAt, leavePanel, live, madeAndSelected, near, nextEdit, noExceptions, open, pressedTool, refusedFrames, selectedIds, sendsNothing, shownMsg, shownText, waitSaved, within } from './lib/canvas-fixture.mjs';

const IMAGE_SAY = {
  tooBig: 'That image is too big (at most 4 MB).',
  types: 'Only PNG, JPEG, WebP or GIF images can be added.',
  failed: "The image couldn't be added.",
};
test('an upload the server refuses adds nothing', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  // the image route answered by the recorder: 415, 413, then a 200 whose src isn't an images/ file
  const answers = [
    [{ status: 415, body: '' }, IMAGE_SAY.types],
    [{ status: 413, body: '' }, IMAGE_SAY.tooBig],
    [{ status: 200, body: { src: 'https://evil.example/x.png' } }, IMAGE_SAY.failed],
    [{ status: 500, body: '' }, IMAGE_SAY.failed],
  ];
  let i = 0;
  const answer = (url) => (url.includes('/api/canvas/image?') ? answers[i++][0] : null);
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every'), answer });
  await live(p);
  await rec.send('Page.setInterceptFileChooserDialog', { enabled: true });
  const loose = await box(p, '#surface [data-id="loose"]');
  const pt = { x: Math.round(loose.r + 40), y: Math.round(loose.t + 10) };
  assert.equal(await hitAt(p, pt), 'stage');
  const n0 = edits(rec).length;
  for (const [, words] of answers) {
    const c0 = rec.choosers.length;
    const seen = i;
    await p.ev("document.getElementById('toast').hidden = true");
    await p.key('I');
    await p.clickAt(pt.x, pt.y);
    await within(async () => rec.choosers.length > c0, 'the file chooser opened');
    await rec.send('DOM.setFileInputFiles', { files: [IMG_PATH], backendNodeId: rec.choosers[c0].backendNodeId });
    await within(async () => i > seen, 'the image posted');
    await within(async () => (await shownText(p, '#toast')) === words, `said: ${words}`, async () => shownText(p, '#toast'));
    assert.equal(await pressedTool(p), 'move', 'the tool back to Move');
  }
  await sleep(500);
  assert.equal(edits(rec).length, n0, 'no add sent');
  assert.equal(await body(p, 'pending'), '0');
  assert.equal(await count(p, '#surface img'), 1, 'only photo drawn as an image');
  noExceptions(rec);
});

test('the empty-page note follows the page', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { draw: MINIMAL } });
  await live(p);
  assert.equal(await shownMsg(p), 'This page is empty.', 'the note on the empty page');
  // the note takes no pointer events: the stage under it can be drawn on
  const msg = await box(p, '#msg');
  const pt = { x: Math.round(msg.l + msg.w / 2), y: Math.round(msg.t + msg.h / 2) };
  assert.equal(await hitAt(p, pt), 'stage', 'the stage under the note');
  const n0 = edits(rec).length;
  await p.key('F');
  await drag(p, pt, 120, 80);
  const op = await added(rec, n0, 'the first frame');
  assert.equal(op.node.parent, 'p1');
  assert.equal(op.after, null, 'first on the page');
  // C1.1a: once the page has a node, the note is gone
  await within(async () => (await shownMsg(p)) === null, 'the note hidden', async () => shownMsg(p), 5000);
  await madeAndSelected(p, op.node.id, 'the first frame');
  await waitSaved(p);
  assert.deepEqual(fake.doc('draw').pages[0].children, [op.node.id]);
  // deleting it shows the note again
  await p.key('Delete');
  const e = await nextEdit(rec, n0 + 1);
  assert.deepEqual(e.ops, [{ op: 'del', id: op.node.id }]);
  await ackOf(rec, e);
  await within(async () => (await shownMsg(p)) === 'This page is empty.', 'the note shown again', async () => shownMsg(p), 5000);
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

test('arrow keys nudge, coalesced', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const badgeAt = async () => centre(await box(p, '#surface [data-id="badge"]'));
  // badge selected by a click on its drawn node: focus stays on the page
  const pt = await badgeAt();
  await p.clickAt(pt.x, pt.y);
  await within(async () => JSON.stringify(await selectedIds(p)) === '["badge"]', 'badge selected');
  assert.equal(await p.ev('document.activeElement === document.body'), true, 'focus on the page');
  // Arrow Right: set x +1; Shift+Arrow Down: set y +10
  let n0 = edits(rec).length;
  await arrow(p, 'ArrowRight');
  let e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'set', id: 'badge', prop: 'x', value: 13 }], 'Arrow Right: x + 1');
  await ackOf(rec, e);
  n0 = edits(rec).length;
  await arrow(p, 'ArrowDown', true);
  e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'set', id: 'badge', prop: 'y', value: 2 }], 'Shift+Arrow Down: y + 10');
  await ackOf(rec, e);
  await waitSaved(p);

  // in a field the arrows are the field's, and on a Layers row they never nudge
  assert.equal(await focusField(p, 'x'), true, 'the X field focused');
  n0 = edits(rec).length;
  await arrow(p, 'ArrowRight');
  await arrow(p, 'ArrowUp');
  assert.equal(await p.ev("document.activeElement.matches('#props [data-prop=\"x\"]')"), true, 'focus still in the field');
  await leavePanel(p);
  assert.equal(await p.ev("(() => { const r = document.querySelector('#layers .layer[data-node=\"badge\"]'); r.focus(); return document.activeElement === r; })()"), true, "badge's row focused");
  for (const k of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']) await arrow(p, k);
  await sendsNothing(rec, n0, 'arrows in the X field and on a Layers row');
  assert.equal(fake.doc('every').nodes.badge.x, 13, 'x unchanged by those arrows');

  // 30 Arrow Right presses back to back: fewer than 30 frames, at most 21 in any second, each a single
  // set x, rising, at least one jump over 1, the last the start + 30, which the fake holds
  const pt2 = await badgeAt();
  await p.clickAt(pt2.x, pt2.y);
  await within(async () => (await p.ev('document.activeElement === document.body')) && JSON.stringify(await selectedIds(p)) === '["badge"]', 'badge selected, focus on the page');
  await sleep(1100); // the sender's last second clear
  n0 = edits(rec).length;
  const k = { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 };
  // the key held: 30 keydowns (the later ones auto-repeats, as a held key sends them), then its keyup,
  // dispatched without waiting on each other. When each press was made is its event's timeStamp (a
  // listener of the test's, on window, before the page's): the presses queue in the page and are
  // handled one after another, so the wall time to the last answer is the page's work, not the presses'
  await p.ev("window.pressedAt = []; addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') window.pressedAt.push(e.timeStamp); }, true)");
  const presses = [];
  for (let i = 0; i < 30; i++) presses.push(p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k, autoRepeat: i > 0 }));
  await Promise.all(presses);
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
  const stamps = await p.ev('window.pressedAt');
  assert.equal(stamps.length, 30, '30 presses reached the page');
  const span = stamps[stamps.length - 1] - stamps[0];
  t.diagnostic(`30 presses made within ${span.toFixed(1)} ms`);
  assert.ok(span <= 300, `30 presses within 300 ms (${span} ms)`);
  await within(async () => { const s = edits(rec).slice(n0); return s.length > 0 && s[s.length - 1].ops[0].value === 43; }, 'the last nudge sent', async () => JSON.stringify(edits(rec).slice(n0).map((x) => x.ops)), 10000);
  await waitSaved(p);
  await sleep(300);
  const burst = edits(rec).slice(n0);
  const at = rec.sentAt.filter((_, i) => rec.sent[i] && rec.sent[i].t === 'edit').slice(n0);
  assert.ok(burst.length < 30, `fewer than 30 edit frames (${burst.length})`);
  for (const f of burst) assert.deepEqual(f.ops.map((o) => [o.op, o.id, o.prop]), [['set', 'badge', 'x']], 'each a single set x');
  const vals = burst.map((f) => f.ops[0].value);
  for (let i = 1; i < vals.length; i++) assert.ok(vals[i] > vals[i - 1], `rising: ${vals.join(' ')}`);
  assert.ok(vals.some((v, i) => (i === 0 ? v - 13 : v - vals[i - 1]) > 1), `at least one jump over 1 (coalesced): ${vals.join(' ')}`);
  assert.equal(vals[vals.length - 1], 43, 'the last is the start + 30');
  for (let i = 0; i < at.length; i++) assert.ok(at.filter((x) => x >= at[i] && x < at[i] + 1000).length <= 21, 'at most 21 in any second');
  assert.equal(fake.doc('every').nodes.badge.x, 43, "the fake's badge.x");
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

test('a drag into its own subtree sends nothing', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  // a frame pressed and dragged over itself and back, released on itself: it isn't dropped into itself
  // (nor into its child), so nothing is sent; nor is the row actions, dragged out and back in card
  let n0 = edits(rec).length;
  const loose = await box(p, '#surface [data-id="loose"]');
  const lp = { x: Math.round(loose.l + loose.w * 0.6), y: Math.round(loose.t + loose.h * 0.6) };
  const badge = centre(await box(p, '#surface [data-id="badge"]'));
  const loose0 = { x: fake.doc('every').nodes.loose.x, y: fake.doc('every').nodes.loose.y };
  await dragPath(p, [lp, { x: lp.x + 40, y: lp.y + 30 }, { x: lp.x + (badge.x - lp.x) / 2, y: lp.y + (badge.y - lp.y) / 2 }, lp]);
  await sleep(600);
  for (const f of edits(rec).slice(n0)) assert.ok(f.ops.every((o) => o.op === 'set' && o.id === 'loose' && ['x', 'y'].includes(o.prop)), `loose out and back: live frames only: ${JSON.stringify(f.ops)}`);
  await waitSaved(p);
  assert.deepEqual({ x: fake.doc('every').nodes.loose.x, y: fake.doc('every').nodes.loose.y, parent: fake.doc('every').nodes.loose.parent }, { ...loose0, parent: 'p-main' }, "loose dropped where it was: the fake's loose unchanged");
  const actions = await box(p, '#surface [data-id="actions"]');
  const ap = { x: Math.round(actions.r - 6), y: Math.round(actions.t + actions.h / 2) };
  assert.equal(await hitAt(p, ap), 'actions');
  n0 = edits(rec).length;
  await dragPath(p, [ap, { x: ap.x, y: ap.y - 30 }, ap]);
  await sendsNothing(rec, n0, 'actions dropped where it was');
  // dragged by (40, 30) and released on itself: moved within its parent, never into itself
  n0 = edits(rec).length;
  await dragPath(p, [lp, { x: lp.x + 40, y: lp.y + 30 }]);
  await nextEdit(rec, n0);
  await waitSaved(p); // every frame of the drag sent and acked
  const e = edits(rec)[edits(rec).length - 1];
  assert.deepEqual(e.ops.map((o) => [o.op, o.id, o.prop]), [['set', 'loose', 'x'], ['set', 'loose', 'y']], 'loose moved within the page: the last frame');
  await ackOf(rec, e);

  // a component dropped into another component, or a frame holding one: refused here with the page's
  // words, nothing sent, and drawn back where it was
  const a = await ana(fake, later);
  await a.edit([
    { op: 'add', node: { id: 'chip', type: 'component', parent: 'p-parts', name: 'Chip', x: 400, y: 0, size: { w: 120, h: 60 }, layout: { mode: 'none' }, fill: '#cccccc' }, after: 'button' },
    { op: 'add', node: { id: 'holder', type: 'frame', parent: 'p-parts', name: 'Holder', x: 400, y: 200, size: { w: 200, h: 150 }, layout: { mode: 'none' }, fill: '#eeeeee' }, after: 'chip' },
    { op: 'add', node: { id: 'chip2', type: 'component', parent: 'holder', name: 'Chip 2', x: 150, y: 100, size: { w: 40, h: 40 }, layout: { mode: 'none' }, fill: '#999999' }, after: null },
  ]);
  await within(async () => (await body(p, 'rev')) === String(fake.rev('every')), 'the page has Ana\'s edit');
  await p.click('#pages a[data-page="p-parts"]');
  await within(async () => (await count(p, '#surface [data-id="chip"]')) === 1 && (await count(p, '#surface [data-id="button"]')) === 1, 'Parts shown with chip');
  const button = centre(await box(p, '#surface [data-id="button"]'));
  for (const [id, grab] of [['chip', (b) => centre(b)], ['holder', (b) => ({ x: Math.round(b.l + 10), y: Math.round(b.t + 10) })]]) {
    const b0 = await box(p, `#surface [data-id="${id}"]`);
    const from = grab(b0);
    assert.equal(await hitAt(p, from), id, `the press is on ${id}`);
    await p.ev("document.getElementById('toast').hidden = true");
    const start = { x: fake.doc('every').nodes[id].x, y: fake.doc('every').nodes[id].y };
    n0 = edits(rec).length;
    await dragPath(p, [from, button]);
    await within(async () => (await shownText(p, '#toast')) === CANT_GO, `${id}: the page says it can't go there`, async () => shownText(p, '#toast'), 5000);
    // kit-668: a restore if live frames went, the fake's node at its start
    await sleep(600);
    const fr = edits(rec).slice(n0);
    for (const f of fr) assert.ok(f.ops.every((o) => o.op === 'set' && o.id === id && ['x', 'y'].includes(o.prop)), `${id}: live frames and a restore only: ${JSON.stringify(f.ops)}`);
    if (fr.length) assert.deepEqual(fr[fr.length - 1].ops.map((o) => o.value), fr[fr.length - 1].ops.map((o) => start[o.prop]), `${id}: the last frame restores the start`);
    await waitSaved(p);
    assert.deepEqual({ x: fake.doc('every').nodes[id].x, y: fake.doc('every').nodes[id].y }, start, `${id}: the fake's node at its start`);
    const b1 = await box(p, `#surface [data-id="${id}"]`);
    near(b1.l, b0.l, 0.5, `${id} drawn back: x`);
    near(b1.t, b0.t, 0.5, `${id} drawn back: y`);
    assert.equal(fake.doc('every').nodes[id].parent, 'p-parts', `${id} still on the page`);
  }
  // a component dragged on the page itself moves
  const chip = await box(p, '#surface [data-id="chip"]');
  n0 = edits(rec).length;
  await dragPath(p, [centre(chip), { x: centre(chip).x + 30, y: centre(chip).y + 40 }]);
  const m = await nextEdit(rec, n0);
  assert.deepEqual(m.ops.map((o) => [o.op, o.id, o.prop]), [['set', 'chip', 'x'], ['set', 'chip', 'y']], 'chip moved on its page');
  await ackOf(rec, m);
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});
