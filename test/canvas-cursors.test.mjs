// Others on a canvas (kit-663, docs/devteam/dashboard/canvas.html): their named cursors, anchored to
// layers or to a fraction of the page's content bounds (presence@1, canvas@1 §9), their selections
// (canvas@1 §5 `selections`) and a 3 s mark on what their last edit changed; and a `select` that waits
// for a document fetch (kit-669 final-1 F2). In headless Chrome against both fakes
// (test/lib/canvas-fake.mjs, test/lib/presence-fake.mjs).
//
// Two people at once: one Chrome, two windows (Target.createTarget with newWindow, so both pages are
// visible; two tabs of one window aren't), each page on its own front origin, which stands in for the
// gateway: it forwards plain requests and `/canvas` upgrades to the canvas fake and `/presence`
// upgrades to the presence fake, with Host and Origin rewritten to the target's and the person's
// `x-devteam-person` header set, so Ana and Ben are two people to both fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { canDrive } from './lib/chrome.mjs';
import { HIDDEN_SPY, PAGE_FILE, SLUG, after, at, body, boxesOf, cursorAt, cursorCount, cursorOf, noExceptions, nodeBox, ofKind, pointOn, screenOf, serve, twoPages, waitSpot, within } from './lib/canvas-cursors-fixture.mjs';

// The first edit the page sent after order n0 holding an `add` of a new node, and its ack.
async function addAfter(ctx, p, n0, what, id = null) {
  const find = () => ofKind(after(p.rec.sent, n0), 'edit').find((f) => f.m.ops.some((o) => o.op === 'add' && (id === null || o.node.id === id)));
  await within(ctx, async () => !!find(), `${what}: the add`, async () => JSON.stringify(p.rec.sent.slice(-4).map((f) => f.m)));
  const e = find();
  const ackFind = () => ofKind(p.rec.got, 'ops').find((f) => f.n > e.n && f.m.ack && f.m.ack.client === e.m.client && f.m.ack.seq === e.m.seq);
  await within(ctx, async () => !!ackFind(), `${what}: the add's ack`, async () => JSON.stringify(p.rec.got.slice(-4).map((f) => f.m)));
  return { edit: e, ack: ackFind(), id: e.m.ops.find((o) => o.op === 'add').node.id };
}
// A rect drawn with the Rectangle tool from page px (x, y), 40 screen px square; its add and ack.
async function drawRect(ctx, p, x, y, what) {
  const n0 = p.rec.order();
  await p.click('#tools button[data-tool="rect"]');
  const at = await screenOf(p, x, y);
  await p.drag(at, 40, 40);
  return addAfter(ctx, p, n0, what);
}
// The `selections` frames a page got after order n0, as Ana's ids in each (null where she isn't listed).
const anaSelections = (p, n0, id = 'ana') => ofKind(after(p.rec.got, n0), 'selections').map((f) => {
  const e = f.m.people.find((x) => x.id === id);
  return e ? e.ids : null;
});

// ---- kit-669 F2: a select waits for a document fetch (spec §6, S6.1, S6.2) ----

test('canvas cursors: a select made while the document is fetched after a restart or a reload waits for the fetch and the re-sent edits (part 1 of 3: S6.1)', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 240000 }, async (t) => {
  const ctx = await twoPages(t);
  const { A, B, fake } = ctx;
  // S6.1: an unsaved X selected, then the server restarts without it
  fake.pause(SLUG);
  const x = await drawRect(ctx, A, 340, 20, 'X');
  await within(ctx, async () => ofKind(A.rec.sent, 'select').some((f) => f.m.ids.length === 1 && f.m.ids[0] === x.id), "X's select");
  A.rec.hold = (url) => url.includes('/api/canvas/doc?');
  const r0 = A.rec.order();
  const b0 = B.rec.order();
  fake.restart(SLUG);
  await within(ctx, async () => A.rec.held.length > 0, "A's document fetch after the restart, held", async () => `requests ${A.rec.requests.slice(-3).join(' ')}`);
  await A.shiftClick('#layers .layer[data-node="n-card"]');
  await within(ctx, async () => (await A.ev('[...document.querySelectorAll(\'#layers .layer[aria-selected="true"]\')].map((r) => r.dataset.node).join(" ")')).split(' ').length === 2, 'A has two layers selected');
  // the new socket's welcome came (a select it would send goes at once), and a select window passed
  await within(ctx, async () => ofKind(after(A.rec.got, r0), 'welcome').length > 0, "A's welcome after the restart");
  await sleep(400);
  assert.deepEqual(ofKind(after(A.rec.sent, r0), 'select').map((f) => f.m), [], 'no select while the document is fetched');
  A.rec.hold = null;
  A.rec.release();
  const again = await addAfter(ctx, A, r0, "X's add re-sent", x.id);
  await within(ctx, async () => ofKind(after(A.rec.sent, r0), 'select').length > 0, 'a select after the fetch');
  const sel = ofKind(after(A.rec.sent, r0), 'select')[0];
  assert.ok(sel.n > again.ack.n, `the first select after the restart (${sel.n}) comes after X's ack (${again.ack.n})`);
  assert.deepEqual([...sel.m.ids].sort(), [x.id, 'n-card'].sort(), 'it names X and n-card');
  await within(ctx, async () => anaSelections(B, b0).some((ids) => ids && ids.includes(x.id) && ids.includes('n-card')), "B's selections list Ana with X and n-card", async () => JSON.stringify(anaSelections(B, b0)));
  await within(ctx, async () => { const n = (await boxesOf(B, 'others-sel', 'ana')).map((b) => b.node).sort(); return n.join(' ') === [x.id, 'n-card'].sort().join(' '); }, "B draws Ana's boxes on X and n-card", async () => JSON.stringify(await boxesOf(B, 'others-sel', 'ana')));
  noExceptions(A, 'A');
  noExceptions(B, 'B');
});

test('canvas cursors: a select made while the document is fetched after a restart or a reload waits for the fetch and the re-sent edits (part 2 of 3: S6.2)', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 240000 }, async (t) => {
  const ctx = await twoPages(t);
  const { A, B, fake } = ctx;
  // S6.2: X saved; a new unsaved X2 selected alone; the canvas replaced without X2 (a reload)
  fake.resume(SLUG);
  await within(ctx, async () => (await body(A, 'kept')) === '0', "A's kept edits saved");
  fake.pause(SLUG);
  const x2 = await drawRect(ctx, A, 340, 220, 'X2');
  await within(ctx, async () => ofKind(A.rec.sent, 'select').some((f) => f.m.ids.length === 1 && f.m.ids[0] === x2.id), "X2's select");
  await within(ctx, async () => (await body(A, 'pending')) === '0', "A's pending empty");
  const doc = fake.doc(SLUG);
  delete doc.nodes[x2.id];
  for (const pg of doc.pages) pg.children = pg.children.filter((c) => c !== x2.id);
  const r1 = A.rec.order();
  const b1 = B.rec.order();
  fake.replace(SLUG, doc);
  const again2 = await addAfter(ctx, A, r1, "X2's add re-sent", x2.id);
  await within(ctx, async () => ofKind(after(A.rec.sent, again2.ack.n), 'select').length > 0, 'a select after the reload and the ack', async () => JSON.stringify(after(A.rec.sent, r1).map((f) => f.m.t)));
  assert.deepEqual(ofKind(after(A.rec.sent, again2.ack.n), 'select')[0].m.ids, [x2.id], 'the select names X2 again');
  await within(ctx, async () => anaSelections(B, b1).some((ids) => ids && ids.includes(x2.id)), "B's selections after the reload list Ana with X2", async () => JSON.stringify(anaSelections(B, b1)));
  await within(ctx, async () => (await boxesOf(B, 'others-sel', 'ana')).map((b) => b.node).join(' ') === x2.id, "B draws Ana's box on X2", async () => JSON.stringify(await boxesOf(B, 'others-sel', 'ana')));
  noExceptions(A, 'A');
  noExceptions(B, 'B');
});

test('canvas cursors: a select made while the document is fetched after a restart or a reload waits for the fetch and the re-sent edits (part 3 of 3: S6.3)', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 240000 }, async (t) => {
  const ctx = await twoPages(t);
  const { A, B, fake } = ctx;
  // S6.3 (task-1 T1-1, T1-2, task-1-2 F2-1): A's selection cleared while a reload's fetch is held goes
  // out as an empty select once the fetch lands and the re-sent edit X3 is acked, although an empty
  // selection is what the old dedupe took a fresh socket's last select to be; B's selections then list
  // Ana with none
  fake.resume(SLUG);
  await within(ctx, async () => (await body(A, 'kept')) === '0' && (await body(A, 'pending')) === '0', "A's edits all saved");
  fake.pause(SLUG);
  const x3 = await drawRect(ctx, A, 340, 120, 'X3');
  // B's mark is taken before the click that causes its frame, as b0, b1 and b3 are (kit-326): X3's
  // select opened the fake's 250 ms selections window, so the frame naming n-side can reach B before
  // the test, polling for A's select, would look
  const b2 = B.rec.order();
  await A.click('#layers .layer[data-node="n-side"]');
  await within(ctx, async () => ofKind(A.rec.sent, 'select').at(-1)?.m.ids.join(' ') === 'n-side', "A's select of n-side");
  await within(ctx, async () => anaSelections(B, b2).some((ids) => ids && ids.join(' ') === 'n-side'), "B's selections list Ana with n-side", async () => JSON.stringify(anaSelections(B, b2)));
  A.rec.hold = (url) => url.includes('/api/canvas/doc?');
  const r2 = A.rec.order();
  const doc3 = fake.doc(SLUG);
  delete doc3.nodes[x3.id];
  for (const pg of doc3.pages) pg.children = pg.children.filter((c) => c !== x3.id);
  fake.replace(SLUG, doc3);
  await within(ctx, async () => A.rec.held.length > 0, "A's document fetch after the reload, held");
  await A.key('Escape');
  await within(ctx, async () => (await A.ev('document.querySelectorAll(\'#layers .layer[aria-selected="true"]\').length')) === 0, 'A has nothing selected');
  await sleep(400);
  assert.deepEqual(ofKind(after(A.rec.sent, r2), 'select').map((f) => f.m), [], 'no select while the document is fetched');
  const b3 = B.rec.order();
  A.rec.hold = null;
  A.rec.release();
  const again3 = await addAfter(ctx, A, r2, "X3's add re-sent", x3.id);
  await within(ctx, async () => ofKind(after(A.rec.sent, r2), 'select').length > 0, 'a select once the fetch lands and X3 is acked');
  assert.deepEqual(ofKind(after(A.rec.sent, r2), 'select').map((f) => f.m.ids), [[]], 'one empty select');
  assert.ok(ofKind(after(A.rec.sent, r2), 'select')[0].n > again3.ack.n, "the select after X3's ack");
  await within(ctx, async () => anaSelections(B, b3).some((ids) => ids && ids.length === 0), "B's selections list Ana with nothing", async () => JSON.stringify(anaSelections(B, b3)));
  await within(ctx, async () => (await boxesOf(B, 'others-sel', 'ana')).length === 0, "B draws no Ana box", async () => JSON.stringify(await boxesOf(B, 'others-sel', 'ana')));
  noExceptions(A, 'A');
  noExceptions(B, 'B');
});

// ---- the presence duties (spec §1, §3; presence@1 §6–§9) ----

test('canvas cursors: the presence socket answers pings, reconnects when dropped and reports a hidden page', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 360000 }, async (t) => {
  const ctx = await twoPages(t, { presenceClock: 'manual' });
  const { A, B, pfake, fa } = ctx;
  await waitSpot(ctx, A, 'ben', 'A');
  await waitSpot(ctx, B, 'ana', 'B');
  // C1.7: three pings, each answered before the next falls due
  const pongs = () => ofKind(A.rec.psent, 'pong').length;
  const pings = () => ofKind(A.rec.pgot, 'ping').length;
  for (let i = 0; i < 3; i++) {
    const p0 = pongs();
    await ctx.ptick(20000);
    await within(ctx, async () => pongs() === p0 + 1, `C1.7: A's pong ${i + 1}`, async () => `pings ${pings()}, pongs ${pongs()}`);
  }
  assert.ok(pings() >= 3, `A got at least three pings (${pings()})`);
  assert.equal(pongs(), pings(), 'a pong for every ping');
  const mine = pfake.stats().find((s) => s.id === 'ana');
  assert.ok(mine, "A's presence connection still open");
  assert.equal(mine.unanswered, 0, 'no ping unanswered');

  // C1.9: Ben's cursor on A; A's presence connection dropped: the cursor goes at once, A reconnects
  const b1 = await pointOn(B, 'n-card', 0.5, 0.5);
  await B.move(b1.pt.x, b1.pt.y);
  await cursorAt(ctx, A, 'ben', 'n-card', async () => at(await nodeBox(A, 'n-card'), b1.fx, b1.fy), "Ben's cursor on A");
  const h0 = A.rec.order();
  assert.ok(fa.drop() >= 1, "A's presence connection dropped at the front");
  await within(ctx, async () => (await cursorCount(A, 'ben')) === 0, "C1.9: Ben's cursor gone from A while down", async () => JSON.stringify(await cursorOf(A, 'ben')), 500);
  await within(ctx, async () => ofKind(after(A.rec.psent, h0), 'here').length > 0, 'C1.9: A says here on a new presence socket', async () => '', 3000);
  await waitSpot(ctx, A, 'ben', 'A after reconnecting');
  const b2 = await pointOn(B, 'n-side', 0.5, 0.5);
  await B.move(b2.pt.x, b2.pt.y);
  await cursorAt(ctx, A, 'ben', 'n-side', async () => at(await nodeBox(A, 'n-side'), b2.fx, b2.fy), "C1.9: Ben's cursor on A again");

  // C1.10: A hidden (a tab opened in its window): here visible false, Ana's cursor gone from B
  const a1 = await pointOn(A, 'n-card', 0.5, 0.5);
  await A.move(a1.pt.x, a1.pt.y);
  await cursorAt(ctx, B, 'ana', 'n-card', async () => at(await nodeBox(B, 'n-card'), a1.fx, a1.fy), "Ana's cursor on B");
  assert.equal(await cursorCount(A, 'ben'), 1, "Ben's cursor on A before A is hidden");
  const v0 = A.rec.order();
  await ctx.hideA();
  await within(ctx, async () => (await A.ev('document.visibilityState')) === 'hidden', 'C1.10: A hidden');
  // final-1 F1: a hidden page drops others' cursors (it is sent no moves meanwhile)
  await within(ctx, async () => (await cursorCount(A, 'ben')) === 0, "C1.10: Ben's cursor dropped on hidden A", async () => JSON.stringify(await cursorOf(A, 'ben')));
  // final-2 F2-1: a move of Ben's that was on its way before the relay heard A hide draws nothing
  const benConn = A.rec.pgot.filter((f) => f.m.t === 'move' && f.m.id === 'ben').at(-1).m.conn;
  const g0 = A.rec.order();
  assert.ok(fa.inject(JSON.stringify({ t: 'move', id: 'ben', conn: benConn, a: { k: 'n-card', x: 0.5, y: 0.5 } })) >= 1, "a late move written to A's presence socket");
  await within(ctx, async () => after(A.rec.pgot, g0).some((f) => f.m.t === 'move'), 'A got the late move');
  assert.equal(await cursorCount(A, 'ben'), 0, "C1.10: the late move draws no cursor on hidden A");
  await within(ctx, async () => ofKind(after(A.rec.psent, v0), 'here').some((f) => f.m.visible === false), 'C1.10: A says here visible false');
  await within(ctx, async () => (await cursorCount(B, 'ana')) === 0, "C1.10: Ana's cursor gone from B", async () => JSON.stringify(await cursorOf(B, 'ana')));
  await ctx.showA();
  await within(ctx, async () => (await A.ev('document.visibilityState')) === 'visible', 'A shown again');
  await within(ctx, async () => ofKind(after(A.rec.psent, v0), 'here').at(-1)?.m.visible === true, 'C1.10: A says here visible true');
  assert.equal(await cursorCount(A, 'ben'), 0, 'C1.10: no stale Ben cursor on A once shown');
  const b3 = await pointOn(B, 'n-card', 0.25, 0.75);
  await B.move(b3.pt.x, b3.pt.y);
  await cursorAt(ctx, A, 'ben', 'n-card', async () => at(await nodeBox(A, 'n-card'), b3.fx, b3.fy), "C1.10: Ben's cursor on A with his next move");

  // C1.11 (task-2 T2-2; presence@1 §9): A loaded while hidden says here visible false, closes its
  // presence socket within 60 s (plus slack) and opens a new one when shown
  await ctx.hideA();
  await within(ctx, async () => (await A.ev('document.visibilityState')) === 'hidden', 'A hidden again');
  await A.send('Page.addScriptToEvaluateOnNewDocument', { source: HIDDEN_SPY });
  const l0 = A.rec.order();
  await A.load(`/view/canvas/${SLUG}`);
  await within(ctx, async () => ofKind(after(A.rec.psent, l0), 'here').some((f) => f.m.visible === false), 'C1.11: the hidden load says here visible false');
  assert.ok(!ofKind(after(A.rec.psent, l0), 'here').some((f) => f.m.visible === true), 'C1.11: the hidden load never says visible true');
  const opened = Date.now();
  await within(ctx, async () => !pfake.stats().some((x) => x.id === 'ana'), "C1.11: A's presence socket closed while hidden", async () => JSON.stringify(pfake.stats()), 20000);
  assert.deepEqual(await A.ev('window.hiddenAsked'), [60000], 'the page asked for one 60 s timer');
  assert.ok(Date.now() - opened >= 4000, `closed after ${Date.now() - opened} ms, not before its timer`);
  await ctx.showA();
  await within(ctx, async () => ofKind(after(A.rec.psent, l0), 'here').some((f) => f.m.visible === true), 'C1.11: shown, A says here on a new socket', async () => '', 10000);
  assert.ok(pfake.stats().some((x) => x.id === 'ana'), "A's presence socket open again");
  noExceptions(A, 'A');
  noExceptions(B, 'B');
});

// The spy's other side (ruling m-20261121-111233871): on a page whose hidden timer isn't 60 s, the spy
// records nothing, so the presence test's [60000] would fail there; on the real page it records [60000].
test("canvas cursors: the hidden-close spy records no 60 s timer on a page whose HIDDEN_MS isn't 60000", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  const real = fs.readFileSync(PAGE_FILE, 'utf8');
  assert.equal(real.split('const HIDDEN_MS = 60000;').length - 1, 1, 'canvas.html holds const HIDDEN_MS = 60000; once');
  const short = Buffer.from(real.replace('const HIDDEN_MS = 60000;', 'const HIDDEN_MS = 1000;'));
  const page = (req, res) => {
    if (req.method === 'GET' && req.url.split('?')[0].startsWith('/view/canvas/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': short.length });
      res.end(short);
      return;
    }
    serve(req, res);
  };
  const ctx = await twoPages(t, { presenceClock: 'manual', serve: page });
  const { A, B, pfake } = ctx;
  await A.send('Page.addScriptToEvaluateOnNewDocument', { source: HIDDEN_SPY });
  await ctx.hideA();
  await within(ctx, async () => (await A.ev('document.visibilityState')) === 'hidden', 'A hidden');
  await A.load(`/view/canvas/${SLUG}`);
  await within(ctx, async () => !pfake.stats().some((x) => x.id === 'ana'), "A's presence socket closed by the page's own 1 s timer", async () => JSON.stringify(pfake.stats()), 10000);
  assert.deepEqual(await A.ev('window.hiddenAsked'), [], 'no 60 s timer asked for');
  await ctx.showA();
  noExceptions(A, 'A');
  noExceptions(B, 'B');
});
