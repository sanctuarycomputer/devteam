import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { request, shapeErrors as canvasShape } from './lib/canvas-fake.mjs';
import { hashPart, shapeErrors as presenceShape } from './lib/presence-fake.mjs';
import { canDrive } from './lib/chrome.mjs';
import { CANVAS, SLUG, after, at, body, boxesOf, cursorAt, cursorCount, cursorOf, noExceptions, nodeBox, ofKind, pointOn, screenOf, twoPages, view, waitSpot, within } from './lib/canvas-cursors-fixture.mjs';

const LONG_SLUG = `long-${'a'.repeat(115)}`; // 120 characters: `<slug>@canvas` passes presence's 120

const allBoxes = (p, cls) => p.ev(`[...document.querySelectorAll('#others .${cls}')].filter((e) => e.getClientRects().length > 0).map((e) => ({ person: e.dataset.person, node: e.dataset.node }))`);
// A selection box sits 2 px outside its node's drawn box (within 1 px).
async function boxAround(p, b, grow = 2) {
  const n = await nodeBox(p, b.node);
  return !!n && Math.abs(b.l - (n.l - grow)) <= 1 && Math.abs(b.t - (n.t - grow)) <= 1 && Math.abs(b.w - (n.w + 2 * grow)) <= 1 && Math.abs(b.h - (n.h + 2 * grow)) <= 1;
}
// A node's name changed in the Properties panel: its row selected, the Name field's text replaced, Enter.
async function rename(p, id, value) {
  await p.click(`#layers .layer[data-node="${id}"]`);
  const ok = await p.ev(`(() => { const e = document.querySelector('#props [data-prop="name"]'); if (!e) return false; e.focus(); e.select(); return document.activeElement === e; })()`);
  assert.equal(ok, true, 'the Name field focused');
  await p.send('Input.insertText', { text: value });
  const k = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k, text: '\r', unmodifiedText: '\r' });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
}
// The first ops frame a page got after order n0 whose by is `id`.
async function opsBy(ctx, p, n0, id, what) {
  const find = () => ofKind(after(p.rec.got, n0), 'ops').find((f) => f.m.by && f.m.by.id === id);
  await within(ctx, async () => !!find(), what, async () => JSON.stringify(after(p.rec.got, n0).map((f) => f.m.t)));
  return find();
}
// Polls until `f()` is false; the time (Date.now()) it was first seen false.
async function goneAt(ctx, f, what, ms = 8000) {
  const end = Date.now() + ms;
  while (await f()) {
    if (Date.now() > end) assert.fail(`timed out waiting for ${what} to go`);
    await sleep(25);
  }
  return Date.now();
}

// ---- cursors: helpers ----

// The page's content bounds on screen, measured here (not by the page): the union of the top-level
// drawn nodes' boxes grown by 200 page px, or the -200..200 square around the surface's origin when
// the page is empty.
const boundsOf = (p) => p.ev(`(() => {
  const s = document.getElementById('surface');
  const z = new DOMMatrix(getComputedStyle(s).transform).a;
  let b = null;
  for (const e of s.children) {
    if (!e.dataset.id || e.getClientRects().length === 0) continue;
    const r = e.getBoundingClientRect();
    b = b === null ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : { l: Math.min(b.l, r.left), t: Math.min(b.t, r.top), r: Math.max(b.r, r.right), b: Math.max(b.b, r.bottom) };
  }
  const o = s.getBoundingClientRect();
  if (b === null) b = { l: o.left, t: o.top, r: o.left, b: o.top };
  return { l: b.l - 200 * z, t: b.t - 200 * z, w: b.r - b.l + 400 * z, h: b.b - b.t + 400 * z };
})()`);
const showPageOf = async (ctx, p, id) => {
  await p.ev(`location.hash = '#page=${id}'`);
  await within(ctx, async () => (await p.ev("document.getElementById('pageSel').value")) === id && (await body(p, 'state')) === 'ready', `page ${id} shown`);
};

// ---- done-when 1: cursors anchored so every screen agrees (spec §2, §3) ----

test("canvas A3: two pages of different sizes and zooms show each other's cursor on the same node and at the same fraction of empty canvas, within 2 px", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 240000 }, async (t) => {
  const ctx = await twoPages(t);
  const { A, B } = ctx;
  const z0 = (await view(B)).z;
  await B.click('#zoomIn');
  await B.click('#zoomIn');
  await within(ctx, async () => Math.abs((await view(B)).z - z0 * 1.5625) < 0.001, "B zoomed in twice");
  assert.notEqual((await view(A)).z.toFixed(3), (await view(B)).z.toFixed(3), 'the two pages at different zooms');
  await waitSpot(ctx, B, 'ana', 'B');
  await waitSpot(ctx, A, 'ben', 'A');

  // C1.1: A's pointer on n-card at (0.3, 0.7)
  const c1 = await pointOn(A, 'n-card', 0.3, 0.7);
  await A.move(c1.pt.x, c1.pt.y);
  const cur = await cursorAt(ctx, B, 'ana', 'n-card', async () => at(await nodeBox(B, 'n-card'), c1.fx, c1.fy), "C1.1: Ana's cursor on B at n-card (0.3, 0.7)");
  assert.equal(cur.name, 'Ana', "the cursor's name");
  // C1.2: B's pointer on n-side at (0.6, 0.25), shown on A
  const c2 = await pointOn(B, 'n-side', 0.6, 0.25);
  await B.move(c2.pt.x, c2.pt.y);
  const curB = await cursorAt(ctx, A, 'ben', 'n-side', async () => at(await nodeBox(A, 'n-side'), c2.fx, c2.fy), "C1.2: Ben's cursor on A at n-side (0.6, 0.25)");
  assert.equal(curB.name, 'Ben');
  // an edit moves n-side (the supervisor's): A redraws and Ben's cursor follows the node (task-2 T2-3)
  const moved = await request(`${ctx.fake.url}/api/canvas/local?slug=${SLUG}`, {
    method: 'POST', headers: { 'x-devteam-canvas-token': ctx.fake.token, 'Content-Type': 'application/json' },
    body: { by: 'supervisor', via: 'apply', ops: [{ op: 'set', id: 'n-side', prop: 'y', value: 30 }] },
  });
  assert.equal(moved.status, 200, "the supervisor's move of n-side");
  await within(ctx, async () => (await A.ev("document.querySelector('#surface [data-id=\"n-side\"]').style.top")) === '30px', 'n-side moved on A');
  // within 1 s: well before the supervisor's 3 s mark ends (its end places cursors again too)
  await cursorAt(ctx, A, 'ben', 'n-side', async () => at(await nodeBox(A, 'n-side'), c2.fx, c2.fy), "Ben's cursor follows n-side after A's redraw", 1000);

  // C1.3: A's pointer on empty canvas at page (360, 100), shown on B at the same fraction of its bounds
  const e = await screenOf(A, 360, 100);
  const pe = { x: Math.round(e.x), y: Math.round(e.y) };
  const ba = await boundsOf(A);
  const fe = { x: (pe.x - ba.l) / ba.w, y: (pe.y - ba.t) / ba.h };
  await A.move(pe.x, pe.y);
  const emptyWant = async () => { const bb = await boundsOf(B); return at(bb, fe.x, fe.y); };
  await cursorAt(ctx, B, 'ana', '@p-main', emptyWant, "C1.3: Ana's cursor on B over empty canvas");
  // C1.4: B pans (Space drag on empty stage): the cursor moves with the canvas
  const v0 = await view(B);
  const grab = await screenOf(B, 360, 420);
  await B.drag({ x: Math.round(grab.x), y: Math.round(grab.y) }, 50, 30, { space: true });
  await within(ctx, async () => { const v = await view(B); return Math.abs(v.tx - v0.tx - 50) < 1 && Math.abs(v.ty - v0.ty - 30) < 1; }, 'B panned by (50, 30)', async () => JSON.stringify(await view(B)));
  await cursorAt(ctx, B, 'ana', '@p-main', emptyWant, "C1.4: Ana's cursor after B's pan");

  // C1.8: 60 moves in about 1 s across n-card: moves at least 60 ms apart, the last position arrives
  const m0 = A.rec.order();
  const box = await nodeBox(A, 'n-card');
  let last = null;
  for (let i = 0; i < 60; i++) {
    last = { x: Math.round(box.l + box.w * (0.1 + 0.8 * (i / 59))), y: Math.round(box.t + box.h * 0.5) };
    await A.move(last.x, last.y);
    await sleep(16);
  }
  // the last move made inside an open 67 ms window (just after a move went), so only the window-end
  // send can deliver it (task-2 T2-1)
  const sentMoves = () => ofKind(A.rec.psent, 'move').length;
  const k0 = sentMoves();
  await A.move(last.x, Math.round(box.t + box.h * 0.3));
  const wEnd = Date.now() + 2000;
  while (sentMoves() === k0 && Date.now() < wEnd) await sleep(2);
  assert.ok(sentMoves() > k0, 'a move went');
  last = { x: Math.round(box.l + box.w * 0.75), y: Math.round(box.t + box.h * 0.8) };
  await A.move(last.x, last.y);
  const lf = { x: (last.x - box.l) / box.w, y: (last.y - box.t) / box.h };
  await cursorAt(ctx, B, 'ana', 'n-card', async () => at(await nodeBox(B, 'n-card'), lf.x, lf.y), "C1.8: Ana's cursor at her last position");
  const moves = ofKind(after(A.rec.psent, m0), 'move');
  assert.ok(moves.length >= 5, `A sent moves (${moves.length})`);
  for (let i = 1; i < moves.length; i++) {
    const gap = (moves[i].ts - moves[i - 1].ts) * 1000;
    assert.ok(gap >= 60, `moves ${i - 1} and ${i} ${gap.toFixed(1)} ms apart`);
  }

  // C1.5: A's pointer leaves the stage: Ana's cursor is gone from B
  const layers = await A.ev("(() => { const r = document.getElementById('layers').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 40 }; })()");
  await A.move(layers.x, layers.y);
  await within(ctx, async () => (await cursorCount(B, 'ana')) === 0, "C1.5: Ana's cursor gone from B", async () => JSON.stringify(await cursorOf(B, 'ana')), 2000);
  assert.ok(ofKind(after(A.rec.psent, m0), 'move').some((f) => f.m.a === null), 'A sent a move with a: null');

  // C1.6: both on the empty page; B zoomed and panned so the two views differ; A's pointer at stage (100, 100)
  await showPageOf(ctx, A, 'p-empty');
  await showPageOf(ctx, B, 'p-empty');
  await B.click('#zoomIn');
  const st = await B.ev("(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
  const vb0 = await view(B);
  await B.drag({ x: Math.round(st.x), y: Math.round(st.y) }, 80, 60, { space: true });
  await within(ctx, async () => { const v = await view(B); return Math.abs(v.tx - vb0.tx - 80) < 1; }, 'B panned on p-empty');
  const va = await view(A);
  const vb = await view(B);
  assert.ok(Math.abs(va.z - vb.z) > 0.01 && Math.abs(va.tx - vb.tx) > 10 && Math.abs(va.ty - vb.ty) > 10, `the views differ: A ${JSON.stringify(va)}, B ${JSON.stringify(vb)}`);
  await waitSpot(ctx, B, 'ana', 'B on p-empty');
  const sa = await A.ev("(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { x: r.left + 100, y: r.top + 100 }; })()");
  await A.move(sa.x, sa.y);
  // A's fraction of the -200..200 square, through A's view; B's point at that fraction, through B's
  const f6 = { x: ((sa.x - va.left) / va.z + 200) / 400, y: ((sa.y - va.top) / va.z + 200) / 400 };
  assert.ok(f6.x > 0 && f6.x < 1 && f6.y > 0 && f6.y < 1, `stage (100, 100) inside A's fallback square (${JSON.stringify(f6)})`);
  await cursorAt(ctx, B, 'ana', '@p-empty', async () => { const v = await view(B); return { x: v.left + (-200 + f6.x * 400) * v.z, y: v.top + (-200 + f6.y * 400) * v.z }; }, "C1.6: Ana's cursor on B's empty page");
  noExceptions(A, 'A');
  noExceptions(B, 'B');
});

// ---- done-when 2: the spot (spec §1) ----

const wantAt = (tab, slug = SLUG) => ({ page: 'canvas', tab, peek: null, art: `${slug}@canvas`, thread: null });

test("canvas cursors: the page reports its spot, draws others' selections and marks another person's last edit for 3 s", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 240000 }, async (t) => {
  const ctx = await twoPages(t);
  const { A, B } = ctx;
  await waitSpot(ctx, B, 'ana', 'B');
  // C2.1: every here's at, every move's shape
  const a1 = await pointOn(A, 'n-card', 0.4, 0.4);
  await A.move(a1.pt.x, a1.pt.y);
  await cursorAt(ctx, B, 'ana', 'n-card', async () => at(await nodeBox(B, 'n-card'), a1.fx, a1.fy), "Ana's cursor on B");
  await showPageOf(ctx, A, 'p-two');
  const h2 = await within(ctx, async () => ofKind(A.rec.psent, 'here').some((f) => f.m.at.tab === 'p-two'), "A's here on p-two");
  void h2;
  const s0 = B.rec.order();
  const two = await pointOn(A, 'n-two', 0.5, 0.5);
  // A's moves on p-two: wait until the last one sent is its latest position (task-2-2 F2-1), after which
  // B would have had any relay
  const mv0 = A.rec.order();
  await A.move(two.pt.x, two.pt.y);
  const lastTwo = await pointOn(A, 'n-two', 0.7, 0.6);
  await A.move(lastTwo.pt.x, lastTwo.pt.y);
  await within(ctx, async () => {
    const a = ofKind(after(A.rec.psent, mv0), 'move').at(-1)?.m.a;
    return !!a && a.k === 'n-two' && Math.abs(a.x - lastTwo.fx) < 0.02 && Math.abs(a.y - lastTwo.fy) < 0.02;
  }, "A's latest move on p-two sent", async () => JSON.stringify(ofKind(after(A.rec.psent, mv0), 'move').map((f) => f.m.a)));
  await sleep(300);
  assert.equal(await cursorCount(B, 'ana'), 0, "no Ana cursor on B's p-main while A is on p-two");
  assert.equal(ofKind(after(B.rec.pgot, s0), 'move').length, 0, 'B got no move from another spot');
  for (const f of ofKind(A.rec.psent, 'here')) {
    assert.deepEqual(f.m.at, wantAt(f.m.at.tab), "a here's at");
    assert.ok(['p-main', 'p-two'].includes(f.m.at.tab), `tab ${f.m.at.tab}`);
    assert.deepEqual(presenceShape('here', f.m), [], 'presence here shape');
    assert.deepEqual(canvasShape('presence-here', f.m), [], 'canvas presence-here shape');
  }
  const moves = ofKind(A.rec.psent, 'move');
  assert.ok(moves.length > 0, 'A sent moves');
  for (const f of moves) {
    assert.deepEqual(presenceShape('move', f.m), [], 'presence move shape');
    if (f.m.a !== null) assert.deepEqual(canvasShape('presence-move', f.m), [], 'canvas presence-move shape');
  }
  await showPageOf(ctx, A, 'p-main');

  // C2.2: A selects n-side; B selects n-card: A draws Ben's box, never its own; B draws Ana's
  await A.click('#layers .layer[data-node="n-side"]');
  await B.click('#layers .layer[data-node="n-card"]');
  await within(ctx, async () => { const b = await boxesOf(A, 'others-sel', 'ben'); return b.length === 1 && b[0].node === 'n-card' && b[0].tag === 'Ben' && await boxAround(A, b[0]); }, "C2.2: Ben's box on A around n-card, tagged Ben", async () => JSON.stringify(await boxesOf(A, 'others-sel', 'ben')));
  await within(ctx, async () => { const b = await boxesOf(B, 'others-sel', 'ana'); return b.length === 1 && b[0].node === 'n-side' && await boxAround(B, b[0]); }, "C2.2: Ana's box on B around n-side", async () => JSON.stringify(await boxesOf(B, 'others-sel', 'ana')));
  assert.deepEqual(await boxesOf(A, 'others-sel', 'ana'), [], 'A never draws its own selection');
  // task-3 T3-3: B's canvas socket dropped: Ana's box goes at once (B retries after 1 s or more) and
  // comes back with the new socket's selections
  assert.ok(ctx.fb.dropCanvas() >= 1, "B's canvas connection dropped at the front");
  await within(ctx, async () => (await boxesOf(B, 'others-sel', 'ana')).length === 0, "no Ana box on B while its canvas socket is down", async () => JSON.stringify(await boxesOf(B, 'others-sel', 'ana')), 900);
  await within(ctx, async () => (await boxesOf(B, 'others-sel', 'ana')).map((b) => b.node).join(' ') === 'n-side', "Ana's box on B again once it reconnects", async () => JSON.stringify(await boxesOf(B, 'others-sel', 'ana')), 15000);
  await B.shiftClick('#layers .layer[data-node="n-side"]');
  await within(ctx, async () => { const b = await boxesOf(A, 'others-sel', 'ben'); return b.map((x) => x.node).sort().join(' ') === 'n-card n-side' && b.filter((x) => x.tag !== null).length === 1; }, "C2.2: two Ben boxes on A, one tag", async () => JSON.stringify(await boxesOf(A, 'others-sel', 'ben')));
  await B.key('Escape');
  await within(ctx, async () => (await boxesOf(A, 'others-sel', 'ben')).length === 0, 'C2.2: no Ben box on A once B clears', async () => JSON.stringify(await boxesOf(A, 'others-sel', 'ben')));
  assert.deepEqual(await boxesOf(A, 'others-sel', 'ana'), [], 'A never draws its own selection');

  // C2.3: B renames n-card: A marks it with Ben's name at once, B marks nothing; gone 2.5 to 4.5 s later
  const a0 = A.rec.order();
  await rename(B, 'n-card', 'Card two');
  const benOps = await opsBy(ctx, A, a0, 'ben', "Ben's ops on A");
  const flashBen = async () => (await boxesOf(A, 'flash', 'ben')).some((b) => b.node === 'n-card' && b.tag === 'Ben');
  await within(ctx, flashBen, "C2.3: A marks n-card with Ben's name", async () => JSON.stringify(await allBoxes(A, 'flash')), 2000);
  assert.deepEqual(await allBoxes(B, 'flash'), [], "C2.3: B marks nothing for its own edit");
  const gone = await goneAt(ctx, flashBen, "Ben's mark on A");
  const lasted = gone - benOps.at;
  assert.ok(lasted >= 2500 && lasted <= 4500, `C2.3: the mark lasted ${lasted} ms`);

  // task-3 T3-1, T3-2: an edit by Ben from elsewhere (the local route, no ack of B's): B still marks
  // nothing (by.id is its own); A marks the nodes its add, move and set name
  const a2 = A.rec.order();
  const b2 = B.rec.order();
  const byBen = await request(`${ctx.fake.url}/api/canvas/local?slug=${SLUG}`, {
    method: 'POST', headers: { 'x-devteam-canvas-token': ctx.fake.token, 'Content-Type': 'application/json' },
    body: { by: 'ben', via: 'apply', ops: [
      { op: 'add', node: { id: 'n-new', type: 'frame', parent: 'p-main', name: 'New', x: 640, y: 0, size: { w: 80, h: 80 } }, after: 'n-foot' },
      { op: 'move', id: 'n-foot', parent: 'p-main', after: null },
    ] },
  });
  assert.equal(byBen.status, 200, "Ben's local apply");
  await opsBy(ctx, B, b2, 'ben', "Ben's local ops on B");
  await opsBy(ctx, A, a2, 'ben', "Ben's local ops on A");
  await within(ctx, async () => (await allBoxes(A, 'flash')).map((b) => b.node).sort().join(' ') === 'n-foot n-new', 'T3-2: A marks the added and the moved node', async () => JSON.stringify(await allBoxes(A, 'flash')), 2000);
  assert.deepEqual(await allBoxes(B, 'flash'), [], "T3-1: B marks nothing for its own person's edit from elsewhere");
  await goneAt(ctx, async () => (await allBoxes(A, 'flash')).length > 0, "the mark of Ben's local edit on A");

  // C2.4: Ben edits again; 1.5 to 2 s after its mark shows, the supervisor applies an op to n-side:
  // only n-side is marked, with "supervisor", for its own 3 s
  const o1 = A.rec.order();
  await rename(B, 'n-card', 'Card three');
  await within(ctx, flashBen, "Ben's second mark on A", async () => JSON.stringify(await allBoxes(A, 'flash')), 2000);
  await sleep(1700);
  const res = await request(`${ctx.fake.url}/api/canvas/local?slug=${SLUG}`, {
    method: 'POST', headers: { 'x-devteam-canvas-token': ctx.fake.token, 'Content-Type': 'application/json' },
    body: { by: 'supervisor', via: 'apply', ops: [{ op: 'set', id: 'n-side', prop: 'name', value: 'Side by the supervisor' }] },
  });
  assert.equal(res.status, 200, "the supervisor's local apply");
  const supOps = await opsBy(ctx, A, o1, 'supervisor', "the supervisor's ops on A");
  const flashSup = async (p) => (await boxesOf(p, 'flash', 'supervisor')).some((b) => b.node === 'n-side' && b.tag === 'supervisor');
  await within(ctx, () => flashSup(A), "C2.4: A marks n-side with supervisor", async () => JSON.stringify(await allBoxes(A, 'flash')), 2000);
  assert.deepEqual(await allBoxes(A, 'flash'), [{ person: 'supervisor', node: 'n-side' }], "C2.4: the supervisor's mark replaced Ben's");
  await within(ctx, () => flashSup(B), "C2.4: B marks n-side with supervisor", async () => JSON.stringify(await allBoxes(B, 'flash')), 2000);
  const wait = supOps.at + 2500 - Date.now();
  if (wait > 0) await sleep(wait);
  assert.equal(await flashSup(A), true, "C2.4: the supervisor's mark still shown 2.5 s after its ops");
  const gone2 = await goneAt(ctx, () => flashSup(A), "the supervisor's mark on A");
  assert.ok(gone2 - supOps.at <= 4500, `C2.4: the supervisor's mark gone by 4.5 s (${gone2 - supOps.at} ms)`);
  noExceptions(A, 'A');
  noExceptions(B, 'B');
});

test('canvas cursors: a canvas with a 120-character slug reports its art hashed and still shows cursors', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 240000 }, async (t) => {
  const ctx = await twoPages(t, { canvases: { [LONG_SLUG]: CANVAS }, slug: LONG_SLUG });
  const { A, B } = ctx;
  assert.equal(LONG_SLUG.length, 120);
  await waitSpot(ctx, B, 'ana', 'B');
  const heres = ofKind(A.rec.psent, 'here');
  assert.ok(heres.length > 0);
  for (const f of heres) {
    assert.deepEqual(f.m.at, { ...wantAt('p-main', LONG_SLUG), art: hashPart(`${LONG_SLUG}@canvas`) }, 'C2.5: art hashed');
    assert.deepEqual(presenceShape('here', f.m), [], 'presence here shape');
  }
  const a1 = await pointOn(A, 'n-card', 0.4, 0.6);
  await A.move(a1.pt.x, a1.pt.y);
  await cursorAt(ctx, B, 'ana', 'n-card', async () => at(await nodeBox(B, 'n-card'), a1.fx, a1.fy), "C2.5: Ana's cursor on B");
  noExceptions(A, 'A');
  noExceptions(B, 'B');
});
