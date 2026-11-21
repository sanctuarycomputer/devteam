import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { canDrive } from './lib/chrome.mjs';
import { EVERY, EVERY_IMAGES, accepted, allSaved, blurAll, box, byProp, centre, count, docVariant, drag, edits, editsTimed, live, mouse, near, nextEdit, noDialogs, noExceptions, open, refusedFrames, selectedRows, sendsNothing, shiftClick, slowDrag, undoKey, waitRows, within, zoomNow } from './lib/canvas-fixture.mjs';

// ---- R: resize handles (spec §3) ----

// The handles shown, by data-handle, sorted.
const handles = (p) => p.ev("[...document.querySelectorAll('.handle')].map((h) => h.dataset.handle).sort()");
const handleSel = (h) => `.handle[data-handle="${h}"]`;
const handleAt = async (p, h) => centre(await box(p, handleSel(h)));
const waitHandles = (p, want, what) => within(async () => JSON.stringify(await handles(p)) === JSON.stringify([...want].sort()), what, async () => JSON.stringify(await handles(p)), 5000);
// Frames whose ops are all sets of `id`'s props among `props`.
const setsOnly = (m, id, props) => m.ops.length > 0 && m.ops.every((o) => o.op === 'set' && o.id === id && props.includes(o.prop));
// The last value each prop was sent with, over frames.
function lastSent(frames, id) {
  const v = {};
  for (const f of frames) for (const o of f.ops) if (o.op === 'set' && o.id === id) v[o.prop] = o.value;
  return v;
}
const SIZES = ['size.w', 'size.h'];
const XYWH = ['x', 'y', 'size.w', 'size.h'];
const HANDLES8 = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

test("R1.1 a loose node's corner resizes live, at most every 100 ms", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await p.click('#layers .layer[data-node="badge"]');
  await waitRows(p, ['badge'], 'badge selected');
  await waitHandles(p, ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'], 'eight handles');
  const z = await zoomNow(p);
  const b0 = await box(p, '#surface [data-id="badge"]');
  const a = await handleAt(p, 'se');
  near(a.x, b0.r, 1, 'se on the right edge');
  near(a.y, b0.b, 1, 'se on the bottom edge');
  const s0 = rec.sent.length;
  // 60 moves, one every 20 ms, the i-th to the press + (i, round(i × 2 / 3))
  await p.move(a.x, a.y);
  await mouse(p, 'mousePressed', a.x, a.y);
  let next = Date.now();
  let hiddenMid = null;
  for (let i = 1; i <= 60; i++) {
    next += 20;
    const wait = next - Date.now();
    if (wait > 0) await sleep(wait);
    await mouse(p, 'mouseMoved', a.x + i, a.y + Math.round((i * 2) / 3));
    if (i === 30) hiddenMid = await count(p, '.handle');
  }
  const beforeRelease = rec.sent.length;
  await mouse(p, 'mouseReleased', a.x + 60, a.y + 40);
  const releasedAt = Date.now();
  assert.equal(hiddenMid, 0, 'no handles while the resize is under way');
  const want = { 'size.w': Math.round(24 + 60 / z), 'size.h': Math.round(24 + 40 / z) };
  await within(async () => { const v = lastSent(edits(rec), 'badge'); return v['size.w'] === want['size.w'] && v['size.h'] === want['size.h']; }, 'the final sizes sent', async () => JSON.stringify(edits(rec).slice(-3).map((e) => e.ops)), 5000);
  const wait = releasedAt + 500 - Date.now();
  if (wait > 0) await sleep(wait);
  const frames = editsTimed(rec, s0);
  for (const f of frames) assert.ok(setsOnly(f.m, 'badge', SIZES), `only badge's size.w / size.h: ${JSON.stringify(f.m.ops)}`);
  const before = frames.filter((f) => f.i < beforeRelease).length;
  t.diagnostic(`${frames.length} frames, ${before} before the release`);
  assert.ok(before >= 5, `at least 5 frames before the release (${before})`);
  const span = frames[frames.length - 1].ts - frames[0].ts;
  assert.ok(frames.length <= span / 100 + 1, `at most one per 100 ms: ${frames.length} frames in ${span.toFixed(1)} ms`);
  for (let i = 1; i < frames.length; i++) {
    const gap = frames[i].ts - frames[i - 1].ts;
    assert.ok(gap >= 70, `no two frames under 70 ms apart (${gap.toFixed(1)} ms, frames ${i - 1} and ${i})`);
  }
  assert.deepEqual(lastSent(frames.map((f) => f.m), 'badge'), want, 'the last values sent');
  await allSaved(p);
  assert.deepEqual(fake.doc('every').nodes.badge.size, { w: want['size.w'], h: want['size.h'] }, "the fake's badge size");
  assert.deepEqual([fake.doc('every').nodes.badge.x, fake.doc('every').nodes.badge.y], [12, -8], 'x, y unchanged');
  assert.deepEqual(await selectedRows(p), ['badge'], 'still badge alone selected');
  assert.equal(await count(p, '.draft'), 0, 'no rectangle');
  await waitHandles(p, ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'], 'the handles back');
  const b1 = await box(p, '#surface [data-id="badge"]');
  const se = await handleAt(p, 'se');
  near(se.x, b1.r, 1, 'se follows the new right edge');
  near(se.y, b1.b, 1, 'se follows the new bottom edge');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

test('R1.2 left and top handles send x and y', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await p.click('#layers .layer[data-node="badge"]');
  await waitHandles(p, ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'], 'eight handles');
  const z = await zoomNow(p);
  const n0 = edits(rec).length;
  await drag(p, await handleAt(p, 'nw'), -20, -10);
  await within(async () => edits(rec).length > n0, 'the resize sent');
  await allSaved(p);
  await accepted(rec, n0);
  for (const f of edits(rec).slice(n0)) assert.ok(setsOnly(f, 'badge', XYWH), `x, y, size.w, size.h of badge only: ${JSON.stringify(f.ops)}`);
  const w = Math.round(24 + 20 / z);
  const h = Math.round(24 + 10 / z);
  let d = fake.doc('every').nodes.badge;
  assert.deepEqual({ x: d.x, y: d.y, size: d.size }, { x: Math.round(12 - 20 / z), y: Math.round(-8 - 10 / z), size: { w, h } }, "the fake's badge");
  assert.deepEqual(await selectedRows(p), ['badge'], 'the press on the handle selected nothing else');
  // an e drag, moved down too: size.w alone
  await waitHandles(p, ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'], 'the handles back');
  const n1 = edits(rec).length;
  await drag(p, await handleAt(p, 'e'), 16, 12);
  await within(async () => edits(rec).length > n1, 'the e resize sent');
  await allSaved(p);
  await accepted(rec, n1);
  for (const f of edits(rec).slice(n1)) assert.ok(setsOnly(f, 'badge', ['size.w']), `size.w alone: ${JSON.stringify(f.ops)}`);
  d = fake.doc('every').nodes.badge;
  assert.deepEqual({ x: d.x, y: d.y, size: d.size }, { x: Math.round(12 - 20 / z), y: Math.round(-8 - 10 / z), size: { w: Math.round(w + 16 / z), h } }, "the fake's badge after the e drag");
  noDialogs(rec);
  noExceptions(rec);
});

test('R1.3 an auto-layout child sends fixed sizes only', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await p.click('#layers .layer[data-node="photo"]');
  await waitRows(p, ['photo'], 'photo selected');
  await waitHandles(p, ['e', 's', 'se'], 'exactly e, s and se');
  const z = await zoomNow(p);
  const dw = (await box(p, '#surface [data-id="photo"]')).w;
  const n0 = edits(rec).length;
  const a = await handleAt(p, 'se');
  await slowDrag(p, a, { x: a.x + 30, y: a.y + 20 }, 400);
  await within(async () => edits(rec).length > n0, 'the resize sent');
  await allSaved(p);
  await accepted(rec, n0);
  for (const f of edits(rec).slice(n0)) {
    assert.ok(setsOnly(f, 'photo', SIZES), `sets of photo's size.w / size.h only: ${JSON.stringify(f.ops)}`);
    assert.ok(f.ops.every((o) => typeof o.value === 'number'), `numbers only: ${JSON.stringify(f.ops)}`);
  }
  const s = fake.doc('every').nodes.photo.size;
  assert.equal(typeof s.w, 'number', 'fill became a fixed width');
  near(s.w, Math.round(dw / z + 30 / z), 1, "the fake's photo width");
  assert.equal(s.h, Math.round(120 + 20 / z), "the fake's photo height");
  assert.deepEqual(await selectedRows(p), ['photo'], 'still photo selected');
  noDialogs(rec);
  noExceptions(rec);
});

test('R1.4 Escape restores, and a resize is one undo', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await p.click('#layers .layer[data-node="badge"]');
  await waitHandles(p, ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'], 'eight handles');
  const n0 = edits(rec).length;
  let nEsc = null;
  const a = await handleAt(p, 'se');
  await slowDrag(p, a, { x: a.x + 40, y: a.y + 30 }, 400, async () => {
    await within(async () => edits(rec).length > n0, 'a live frame seen', async () => '', 5000);
    nEsc = edits(rec).length;
    await p.key('Escape');
  });
  // a live frame already on its way when Escape went may land after nEsc; the restore is the frame
  // after the live ones, and the last
  const is24 = (f) => JSON.stringify(byProp(f.ops)) === JSON.stringify([{ op: 'set', id: 'badge', prop: 'size.h', value: 24 }, { op: 'set', id: 'badge', prop: 'size.w', value: 24 }]);
  await within(async () => edits(rec).slice(nEsc).some(is24), 'the restore sent', async () => JSON.stringify(edits(rec).slice(nEsc).map((f) => f.ops)), 5000);
  await allSaved(p);
  await accepted(rec, n0);
  assert.deepEqual(fake.doc('every').nodes.badge.size, { w: 24, h: 24 }, "the fake's badge is 24 × 24");
  await sleep(300);
  const after = edits(rec).slice(nEsc);
  assert.ok(is24(after[after.length - 1]), 'the restore sets both sizes back, the last frame');
  assert.ok(after.length <= 2, `at most one live frame in flight before it (${after.length} frames)`);
  for (const f of after) assert.ok(setsOnly(f, 'badge', SIZES), `sizes of badge only: ${JSON.stringify(f.ops)}`);
  // a full resize (live edits and the release), then Ctrl+Z: one frame setting both back
  await waitHandles(p, ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'], 'the handles back');
  const n1 = edits(rec).length;
  const b = await handleAt(p, 'se');
  await slowDrag(p, b, { x: b.x + 40, y: b.y + 30 }, 500);
  await within(async () => edits(rec).length > n1 + 1, 'live frames and the release sent');
  await allSaved(p);
  await accepted(rec, n1);
  assert.notDeepEqual(fake.doc('every').nodes.badge.size, { w: 24, h: 24 }, 'resized');
  await blurAll(p);
  const n2 = edits(rec).length;
  await undoKey(p);
  const u = await nextEdit(rec, n2);
  assert.deepEqual(byProp(u.ops), [{ op: 'set', id: 'badge', prop: 'size.h', value: 24 }, { op: 'set', id: 'badge', prop: 'size.w', value: 24 }], 'one undo sets both back');
  await accepted(rec, n2);
  await sleep(300);
  assert.equal(edits(rec).length, n2 + 1, 'one undo frame');
  assert.deepEqual(fake.doc('every').nodes.badge.size, { w: 24, h: 24 }, 'undone in the fake');
  // the restore pushed no entry: the next Ctrl+Z has nothing of the resize to undo
  const n3 = edits(rec).length;
  await undoKey(p);
  await sendsNothing(rec, n3, 'a second Ctrl+Z');
  noDialogs(rec);
  noExceptions(rec);
});

test('R1.5 no handles for several, none watching', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec, size } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await p.click('#layers .layer[data-node="badge"]');
  await waitHandles(p, ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'], 'eight handles for badge alone');
  // they follow the view: zoomed in, still on badge's corners
  await p.click('#zoomIn');
  await within(async () => { const b = await box(p, '#surface [data-id="badge"]'); const h = await box(p, handleSel('nw')); return b && h && Math.abs(centre(h).x - b.l) <= 1 && Math.abs(centre(h).y - b.t) <= 1; }, 'nw on the zoomed top-left');
  const hb = await box(p, handleSel('nw'));
  assert.deepEqual([Math.round(hb.w), Math.round(hb.h)], [8, 8], '8 × 8 px');
  await shiftClick(p, '#layers .layer[data-node="title"]');
  await waitRows(p, ['title', 'badge'], 'title and badge selected');
  await waitHandles(p, [], 'no handle with two selected');
  await p.click('#layers .layer[data-node="badge"]');
  await waitHandles(p, ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'], 'eight again');
  await size(700, 900);
  await waitHandles(p, [], 'no handle at 700 px wide');
  noDialogs(rec);
  noExceptions(rec);
});

// `every` with the 8 × 8 `dot` moved out of the column `card` into the `none` frame `loose` at (100, 100),
// so it is placed by x, y and gets all eight handles.
const SMALL = docVariant(EVERY, (d) => {
  d.nodes.card.children = d.nodes.card.children.filter((k) => k !== 'dot');
  d.nodes.loose.children.push('dot');
  Object.assign(d.nodes.dot, { parent: 'loose', x: 100, y: 100 });
});

test('R1.6 a small node moves from inside and resizes from outside its box', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { small: SMALL }, images: EVERY_IMAGES('small') });
  await live(p);
  const z = await zoomNow(p);
  await p.click('#layers .layer[data-node="dot"]');
  await waitRows(p, ['dot'], 'dot selected');
  await waitHandles(p, HANDLES8, 'eight handles on dot');
  // a press at its centre (under the handles) and a drag: a move, x and y only
  const c = centre(await box(p, '#surface [data-id="dot"]'));
  assert.equal(await p.ev(`document.elementFromPoint(${c.x}, ${c.y})?.classList.contains('handle') ?? false`), true, "dot's centre is under a handle");
  const n0 = edits(rec).length;
  await drag(p, c, 30, 20);
  await within(async () => edits(rec).length > n0, 'the move sent');
  await allSaved(p);
  await accepted(rec, n0);
  for (const f of edits(rec).slice(n0)) assert.ok(setsOnly(f, 'dot', ['x', 'y']), `x, y of dot only: ${JSON.stringify(f.ops)}`);
  let d = fake.doc('small').nodes.dot;
  assert.deepEqual([d.parent, d.x, d.y, d.size], ['loose', Math.round(100 + 30 / z), Math.round(100 + 20 / z), { w: 8, h: 8 }], "the fake's dot moved, not resized");
  assert.deepEqual(await selectedRows(p), ['dot'], 'still dot selected');
  // a press on the outer half of se (outside dot's box) and a drag: a resize, sizes only
  await waitHandles(p, HANDLES8, 'the handles back');
  const b = await box(p, '#surface [data-id="dot"]');
  const hb = await box(p, handleSel('se'));
  const out = { x: Math.round(hb.r - 2), y: Math.round(hb.b - 2) };
  assert.ok(out.x > b.r && out.y > b.b, `the press (${out.x}, ${out.y}) outside dot's box (${b.r}, ${b.b})`);
  assert.equal(await p.ev(`document.elementFromPoint(${out.x}, ${out.y})?.dataset.handle ?? null`), 'se', 'the press is on se');
  const n1 = edits(rec).length;
  await drag(p, out, 20, 10);
  await within(async () => edits(rec).length > n1, 'the resize sent');
  await allSaved(p);
  await accepted(rec, n1);
  for (const f of edits(rec).slice(n1)) assert.ok(setsOnly(f, 'dot', SIZES), `size.w, size.h of dot only: ${JSON.stringify(f.ops)}`);
  d = fake.doc('small').nodes.dot;
  assert.deepEqual([d.x, d.y, d.size], [Math.round(100 + 30 / z), Math.round(100 + 20 / z), { w: Math.round(8 + 20 / z), h: Math.round(8 + 10 / z) }], "the fake's dot resized, not moved");
  // back to 8 × 8 by Ctrl+Z, then Shift+click on its centre (under the handles) takes it out
  await blurAll(p);
  const n2 = edits(rec).length;
  await undoKey(p);
  await nextEdit(rec, n2);
  await allSaved(p);
  assert.deepEqual(fake.doc('small').nodes.dot.size, { w: 8, h: 8 }, 'dot 8 × 8 again');
  await waitHandles(p, HANDLES8, 'the handles on the small dot');
  const c2 = centre(await box(p, '#surface [data-id="dot"]'));
  assert.equal(await p.ev(`document.elementFromPoint(${c2.x}, ${c2.y})?.classList.contains('handle') ?? false`), true, "dot's centre is under a handle");
  const n3 = edits(rec).length;
  await shiftClick(p, '#surface [data-id="dot"]');
  await waitRows(p, [], 'Shift+click took dot out of the selection');
  await waitHandles(p, [], 'no handles');
  await sendsNothing(rec, n3, 'the Shift+click');
  noDialogs(rec);
  noExceptions(rec);
});
