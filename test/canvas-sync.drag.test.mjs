import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { canDrive } from './lib/chrome.mjs';
import { CANT_GO, EVERY, EVERY_IMAGES, ackOf, allSaved, ana, body, box, centre, count, edits, editsTimed, hitAt, kidsOf, live, liveAt, moved, near, nextEdit, noDialogs, noExceptions, onlyXY, open, refusedFrames, sendsNothing, sentXY, shownText, slowDrag, within, zoomNow } from './lib/canvas-fixture.mjs';

// ---- S2: dragging ----

test('S2.1 a drag sends at most one edit per 100 ms with the latest values', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const z = await zoomNow(p);
  const start = { x: 12, y: -8 };
  const b0 = await box(p, '#surface [data-id="badge"]');
  const loose = await box(p, '#surface [data-id="loose"]');
  const a = centre(b0);
  assert.equal(await hitAt(p, a), 'badge', 'the press is on badge');
  assert.ok(a.x + 120 < loose.r - 2, `the drag stays inside loose (${a.x + 120} < ${loose.r})`);
  const s0 = rec.sent.length;
  let beforeRelease = null;
  await slowDrag(p, a, { x: a.x + 120, y: a.y }, 1200, async () => { beforeRelease = rec.sent.length; }, {
    // S2.2: paused halfway until a live frame carrying the position now is acked and redrawn; then
    // badge is drawn at the press + the pointer's movement
    half: async () => {
      const want = moved(start, 60, 0, z);
      await within(async () => liveAt(rec, s0, 'badge', start, want), `a live frame carrying x ${want.x}`, async () => JSON.stringify(edits(rec).slice(-3).map((e) => e.ops)), 5000);
      const last = editsTimed(rec, s0).map((x) => x.m).filter((m) => onlyXY(m, 'badge')).pop();
      const ack = await ackOf(rec, last);
      await within(async () => Number(await body(p, 'rev')) >= ack.rev, 'the ack drawn');
      const b = await box(p, '#surface [data-id="badge"]');
      near(b.l, b0.l + 60, 1, 'S2.2 drawn under the pointer: x');
      near(b.t, b0.t, 1, 'S2.2 drawn under the pointer: y');
    },
  });
  const releasedAt = Date.now();
  const want = moved(start, 120, 0, z);
  await within(async () => sentXY(edits(rec).slice(0).filter((m) => onlyXY(m, 'badge')), 'badge', start).x === want.x, `a frame carrying x ${want.x}`, async () => JSON.stringify(edits(rec).slice(-3).map((e) => e.ops)), 5000);
  const wait = releasedAt + 500 - Date.now();
  if (wait > 0) await sleep(wait); // the window: to 500 ms after the release
  const frames = editsTimed(rec, s0);
  for (const f of frames) assert.ok(onlyXY(f.m, 'badge'), `only set x / set y of badge: ${JSON.stringify(f.m.ops)}`);
  const before = frames.filter((f) => f.i < beforeRelease).length;
  t.diagnostic(`${frames.length} frames, ${before} before the release`);
  assert.ok(before >= 5, `at least 5 frames before the release (${before})`);
  const span = frames[frames.length - 1].ts - frames[0].ts;
  assert.ok(frames.length <= span / 100 + 1, `at most one per 100 ms: ${frames.length} frames in ${span.toFixed(1)} ms`);
  for (let i = 1; i < frames.length; i++) {
    const gap = frames[i].ts - frames[i - 1].ts;
    assert.ok(gap >= 70, `no two frames under 70 ms apart (${gap.toFixed(1)} ms, frames ${i - 1} and ${i})`);
  }
  const xs = frames.map((f) => f.m.ops.find((o) => o.prop === 'x')).filter(Boolean).map((o) => o.value);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1], `x rises frame by frame: ${xs.join(' ')}`);
  assert.equal(xs[xs.length - 1], want.x, "the last frame's x is the drop's");
  await allSaved(p);
  assert.equal(fake.doc('every').nodes.badge.x, want.x, "the fake's badge.x");
  assert.equal(fake.doc('every').nodes.badge.y, start.y, "the fake's badge.y");
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

test('S2.3 a drag into another frame ends with its move', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const badge = await box(p, '#surface [data-id="badge"]');
  const loose = await box(p, '#surface [data-id="loose"]');
  const title = await box(p, '#surface [data-id="title"]');
  const a = centre(badge);
  const inLoose = { x: Math.round(loose.l + loose.w * 0.5), y: Math.round(loose.t + loose.h * 0.6) };
  const onTitle = { x: Math.round(title.l + title.w / 2), y: Math.round(title.t + title.h * 0.75) };
  const s0 = rec.sent.length;
  let beforeLeave = null;
  // through loose first (live frames while over it), then onto title
  await slowDrag(p, a, [inLoose, onTitle], 600, null, { half: async () => { beforeLeave = rec.sent.length; } });
  await within(async () => edits(rec).some((m) => m.ops.some((o) => o.op === 'move')), 'the move sent', async () => JSON.stringify(edits(rec).slice(-3).map((e) => e.ops)), 5000);
  await sendsNothing(rec, edits(rec).length, 'after the move');
  const frames = editsTimed(rec, s0).map((x) => x.m);
  const last = frames[frames.length - 1];
  assert.deepEqual(last.ops, [{ op: 'move', id: 'badge', parent: 'card', after: 'title' }], 'the last frame: a move of badge after title');
  const livesFr = frames.slice(0, -1);
  assert.ok(livesFr.length >= 1, 'live frames before it');
  for (const f of livesFr) assert.ok(onlyXY(f, 'badge'), `a live frame is set x / set y of badge: ${JSON.stringify(f.ops)}`);
  assert.ok(editsTimed(rec, s0).filter((x) => x.i < beforeLeave).length >= 1, 'live frames while over loose');
  await allSaved(p);
  assert.deepEqual(kidsOf(fake, 'card').slice(0, 2), ['title', 'badge'], "the fake's badge is in card after title");
  assert.equal(fake.doc('every').nodes.badge.parent, 'card');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

test('S2.4 Escape after live frames restores the start', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const z = await zoomNow(p);
  const start = { x: 12, y: -8 };
  const b0 = await box(p, '#surface [data-id="badge"]');
  const a = centre(b0);
  const s0 = rec.sent.length;
  let restoreFrame = null;
  await slowDrag(p, a, { x: a.x + 40, y: a.y + 30 }, 400, async () => {
    const want = moved(start, 40, 30, z);
    await within(async () => liveAt(rec, s0, 'badge', start, want), 'a live frame carrying the position now', async () => JSON.stringify(edits(rec).slice(-3).map((e) => e.ops)), 5000);
    const n = edits(rec).length;
    await p.key('Escape');
    restoreFrame = await nextEdit(rec, n);
  });
  assert.deepEqual(restoreFrame.ops, [{ op: 'set', id: 'badge', prop: 'x', value: start.x }, { op: 'set', id: 'badge', prop: 'y', value: start.y }], 'the next frame sets x and y back to the start');
  await sendsNothing(rec, edits(rec).length, 'after the restore');
  await allSaved(p);
  assert.equal(fake.doc('every').nodes.badge.x, start.x, "the fake's badge.x back");
  assert.equal(fake.doc('every').nodes.badge.y, start.y, "the fake's badge.y back");
  const b1 = await box(p, '#surface [data-id="badge"]');
  near(b1.l, b0.l, 0.5, 'drawn back: x');
  near(b1.t, b0.t, 0.5, 'drawn back: y');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

test('S2.5 a refused drop after live frames restores the start', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const a = await ana(fake, later);
  await a.edit([{ op: 'add', node: { id: 'chip', type: 'component', parent: 'p-parts', name: 'Chip', x: 400, y: 0, size: { w: 120, h: 60 }, layout: { mode: 'none' }, fill: '#cccccc' }, after: 'button' }]);
  await within(async () => (await body(p, 'rev')) === String(fake.rev('every')), "the page has Ana's edit");
  await p.click('#pages a[data-page="p-parts"]');
  await within(async () => (await count(p, '#surface [data-id="chip"]')) === 1 && (await count(p, '#surface [data-id="button"]')) === 1, 'Parts shown with chip');
  const z = await zoomNow(p);
  const start = { x: 400, y: 0 };
  const c0 = await box(p, '#surface [data-id="chip"]');
  const from = { x: Math.round(c0.l + c0.w / 2), y: Math.round(c0.t + c0.h * 0.85) };
  assert.equal(await hitAt(p, from), 'chip', 'the press is on chip');
  const to = centre(await box(p, '#surface [data-id="button"]'));
  const want = moved(start, to.x - from.x, to.y - from.y, z);
  assert.ok(want.x !== start.x && want.y !== start.y, `the drag moves both x and y (${JSON.stringify(want)})`);
  await p.ev("document.getElementById('toast').hidden = true");
  const s0 = rec.sent.length;
  let n = null;
  await slowDrag(p, from, to, 400, async () => {
    await within(async () => liveAt(rec, s0, 'chip', start, want), 'a live frame carrying the position now', async () => JSON.stringify(edits(rec).slice(-3).map((e) => e.ops)), 5000);
    n = edits(rec).length;
  });
  await within(async () => (await shownText(p, '#toast')) === CANT_GO, "the page says it can't go there", async () => shownText(p, '#toast'), 5000);
  const r = await nextEdit(rec, n);
  assert.deepEqual(r.ops, [{ op: 'set', id: 'chip', prop: 'x', value: start.x }, { op: 'set', id: 'chip', prop: 'y', value: start.y }], "the next frame sets chip's x and y back to the start");
  await sendsNothing(rec, edits(rec).length, 'after the restore');
  await allSaved(p);
  const d = fake.doc('every');
  assert.equal(d.nodes.chip.parent, 'p-parts', 'chip still on p-parts');
  assert.deepEqual([d.nodes.chip.x, d.nodes.chip.y], [start.x, start.y], "the fake's chip at its start");
  const c1 = await box(p, '#surface [data-id="chip"]');
  near(c1.l, c0.l, 0.5, 'drawn back: x');
  near(c1.t, c0.t, 0.5, 'drawn back: y');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

test('S2.6 a child of an auto-layout frame sends nothing while dragged', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const dot = await box(p, '#surface [data-id="dot"]');
  const photo = await box(p, '#surface [data-id="photo"]');
  const n0 = edits(rec).length;
  let atRelease = null;
  await slowDrag(p, centre(dot), { x: Math.round(photo.l + photo.w / 2), y: Math.round(photo.t + photo.h * 0.75) }, 600, async () => { atRelease = edits(rec).length; });
  assert.equal(atRelease, n0, 'no frame before the release');
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'move', id: 'dot', parent: 'card', after: 'photo' }], 'one move after it');
  await sendsNothing(rec, n0 + 1, 'after the move');
  await allSaved(p);
  assert.deepEqual(kidsOf(fake, 'card'), ['title', 'rule', 'icon', 'photo', 'dot', 'actions'], "the fake's card");
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});
