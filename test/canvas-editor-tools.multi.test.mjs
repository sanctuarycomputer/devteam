import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { canDrive } from './lib/chrome.mjs';
import { EVERY, EVERY_IMAGES, PLACED, accepted, ackOf, afterWelcome, allSaved, ana, blurAll, body, byProp, closePageSocket, count, edits, hideToast, holdDocs, kept, live, marquee, nextEdit, noDialogs, noExceptions, open, pagePt, rectsCanvas, refusedFrames, rowButton, selectRow, selectedRows, selectsTimed, sendsNothing, shiftClick, showPageLink, shownPage, shownText, slowDrag, toastSays, undoKey, waitRows, waitSaved, waitSelect, welcomeCount, within } from './lib/canvas-fixture.mjs';

// BIG: page `pa` with 3000 rects r1…r3000 (a 60 × 50 grid of 4 × 4 px, 6 px apart); page `pb` one rect.
const BIG = rectsCanvas([{ id: 'pa', name: 'Page A' }, { id: 'pb', name: 'Page B' }], { count: 3000, cols: 60, side: 4, step: 6 }, (d) => {
  d.nodes.q1 = { type: 'rect', parent: 'pb', name: 'Rect B', x: 0, y: 0, size: { w: 40, h: 40 }, fill: '#d9d9d9' };
  d.pages[1].children.push('q1');
});
// BIGC: one page holding a component `bc` of 1500 rects c1…c1500, its variant `loud` naming the last.
const BIGC = rectsCanvas([{ id: 'p1', name: 'Page 1' }], { count: 1500, cols: 40, side: 4, step: 10, prefix: 'c', parent: 'bc' }, (d) => {
  d.nodes.bc = { type: 'component', parent: 'p1', name: 'Big', x: 0, y: 0, size: { w: 400, h: 400 }, layout: { mode: 'none' }, children: Array.from({ length: 1500 }, (_, i) => `c${i + 1}`), variants: { loud: { c1500: { visible: false } } } };
  d.pages[0].children.push('bc');
});
const SAY_TOO_BIG = 'That change is too big to send.';
const OPS_MAX = 65536;
const bytesOf = (ops) => Buffer.byteLength(JSON.stringify(ops));
const docOf = (d) => ({ pages: d.pages, nodes: d.nodes, tokens: d.tokens });

test('M1.7 the select resent on reconnect', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await p.click('#surface [data-id="title"]');
  await shiftClick(p, '#surface [data-id="badge"]');
  await waitSelect(rec, ['title', 'badge'], 'a select of title and badge');
  assert.ok(await closePageSocket(rec) >= 1, 'the socket closed');
  await within(async () => welcomeCount(rec) >= 2, 'the second welcome', async () => `welcomes ${welcomeCount(rec)}`);
  const from = afterWelcome(rec, 2);
  await within(async () => selectsTimed(rec, from).length > 0, 'a select after the second welcome', async () => JSON.stringify(rec.sent.slice(from)));
  assert.deepEqual(selectsTimed(rec, from)[0].m, { t: 'select', ids: ['title', 'badge'] }, 'the same ids again');
  noDialogs(rec);
  noExceptions(rec);
});

test('M1.8 a delete over 64 KB is split, and its undo too', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  assert.equal(bytesOf(Array.from({ length: 3000 }, (_, i) => ({ op: 'del', id: `r${i + 1}` }))), 76894, "the 3000 dels' bytes");
  const { p, fake, rec } = await open(t, { canvases: { big: BIG } });
  await live(p);
  await marquee(p, { x: -20, y: -20 }, { x: 380, y: 320 });
  await within(async () => (await selectedRows(p)).length === 3000, 'all 3000 selected', async () => String((await selectedRows(p)).length), 10000);
  await blurAll(p);
  let n0 = edits(rec).length;
  await p.key('Delete');
  await within(async () => (await body(p, 'pending')) === '0' && edits(rec).length > n0, 'the delete sent and acked', async () => `pending ${await body(p, 'pending')}`, 30000);
  await accepted(rec, n0, 30000);
  const dels = edits(rec).slice(n0);
  assert.ok(dels.length >= 2, `at least two edit frames (${dels.length})`);
  for (const f of dels) assert.ok(bytesOf(f.ops) <= OPS_MAX, `a part of ${bytesOf(f.ops)} bytes`);
  assert.deepEqual(dels.flatMap((f) => f.ops), Array.from({ length: 3000 }, (_, i) => ({ op: 'del', id: `r${i + 1}` })), 'the 3000 dels, in order');
  assert.deepEqual(fake.doc('big').pages[0].children, [], "pa empty in the fake");
  n0 = edits(rec).length;
  await undoKey(p);
  await within(async () => (await body(p, 'pending')) === '0' && edits(rec).length > n0, 'the undo sent and acked', async () => `pending ${await body(p, 'pending')}; ${await shownText(p, '#toast')}`, 30000);
  await accepted(rec, n0, 30000);
  const back = edits(rec).slice(n0);
  assert.ok(back.length >= 2, `at least two undo frames (${back.length})`);
  for (const f of back) assert.ok(bytesOf(f.ops) <= OPS_MAX, `an undo part of ${bytesOf(f.ops)} bytes`);
  const d = fake.doc('big');
  assert.deepEqual(d.pages, BIG.pages, "the fake's pages, children in order, are big's");
  assert.deepEqual(docOf(d), docOf(BIG), "the fake's document is big's");
  noDialogs(rec);
  noExceptions(rec);
});

test("M1.9 a page delete's undo over 64 KB", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { big: BIG } });
  await live(p);
  await within(async () => (await shownPage(p)) === 'pa', 'pa shown', async () => shownPage(p));
  let n0 = edits(rec).length;
  await p.click(rowButton('page-delete'));
  const del = await nextEdit(rec, n0);
  assert.deepEqual(del.ops, [{ op: 'del', id: 'pa' }], 'one del of pa');
  await accepted(rec, n0);
  n0 = edits(rec).length;
  await undoKey(p);
  await within(async () => (await body(p, 'pending')) === '0' && edits(rec).length > n0, 'the undo sent and acked', async () => `pending ${await body(p, 'pending')}; ${await shownText(p, '#toast')}`, 30000);
  await accepted(rec, n0, 30000);
  const back = edits(rec).slice(n0);
  assert.ok(back.length >= 2, `at least two undo frames (${back.length})`);
  for (const f of back) assert.ok(bytesOf(f.ops) <= OPS_MAX, `an undo part of ${bytesOf(f.ops)} bytes`);
  assert.deepEqual(back[0].ops[0], { op: 'add', node: { id: 'pa', type: 'page', parent: null, name: 'Page A' }, after: null }, "the first op re-adds the page");
  const d = fake.doc('big');
  assert.deepEqual(d.pages, BIG.pages, "the fake's pages, children in order, are big's");
  assert.deepEqual(docOf(d), docOf(BIG), "the fake's document is big's");
  noDialogs(rec);
  noExceptions(rec);
});

test('M1.10 an undo with no valid cut is refused', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { bigc: BIGC } });
  await live(p);
  await selectRow(p, 'bc');
  await blurAll(p);
  let n0 = edits(rec).length;
  await p.key('Delete');
  const del = await nextEdit(rec, n0);
  assert.deepEqual(del.ops, [{ op: 'del', id: 'bc' }], 'one del of bc');
  await accepted(rec, n0);
  await allSaved(p);
  const before = structuredClone(fake.doc('bigc'));
  n0 = edits(rec).length;
  await undoKey(p);
  await toastSays(p, SAY_TOO_BIG);
  await sendsNothing(rec, n0, 'the undo with no valid cut', 1000);
  assert.deepEqual(fake.doc('bigc'), before, "the fake's document as it was (bc still gone)");
  // the entry stays: the same words again, nothing sent
  await hideToast(p);
  await undoKey(p);
  await toastSays(p, SAY_TOO_BIG);
  await sendsNothing(rec, n0, 'the second Ctrl+Z', 1000);
  assert.deepEqual(fake.doc('bigc'), before, "the fake's document unchanged");
  noDialogs(rec);
  noExceptions(rec);
});

test('M1.11 a multi-drag whose nodes all leave the shown page sends them back', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { placed: PLACED }, images: EVERY_IMAGES('placed') });
  await live(p);
  const a = await ana(fake, later, 'placed');
  await p.click('#layers .layer[data-node="loose"]');
  await shiftClick(p, '#layers .layer[data-node="tiles"]');
  await waitRows(p, ['loose', 'tiles'], 'loose and tiles selected');
  const n0 = edits(rec).length;
  const from = await pagePt(p, 500, 100);
  await slowDrag(p, from, { x: from.x + 60, y: from.y + 40 }, 1000, null, {
    half: async () => {
      await within(async () => edits(rec).length > n0, 'a live edit before Ana moves them');
      // Ana moves both to Parts: off the shown page, still on the canvas
      await a.edit([{ op: 'move', id: 'loose', parent: 'p-parts', after: 'button' }, { op: 'move', id: 'tiles', parent: 'p-parts', after: 'loose' }]);
      await within(async () => (await count(p, '#layers .layer[data-node="loose"]')) === 0, "Ana's move drawn: loose off Checkout");
    },
  });
  await within(async () => (await body(p, 'pending')) === '0' && (await kept(p)) !== null, 'every edit acked', async () => `pending ${await body(p, 'pending')}`);
  await accepted(rec, n0);
  const d = fake.doc('placed');
  assert.deepEqual([d.nodes.loose.parent, d.nodes.loose.x, d.nodes.loose.y], ['p-parts', 400, 0], 'loose sent back to its start');
  assert.deepEqual([d.nodes.tiles.parent, d.nodes.tiles.x, d.nodes.tiles.y], ['p-parts', 700, 0], 'tiles sent back to its start');
  noDialogs(rec);
  noExceptions(rec);
});

test('M1.12 a held arrow with several selected merges, one undo', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await p.click('#layers .layer[data-node="card"]');
  await shiftClick(p, '#layers .layer[data-node="badge"]');
  await waitRows(p, ['card', 'badge'], 'card and badge selected');
  await blurAll(p);
  await sleep(1100); // the sender's last second clear
  const n0 = edits(rec).length;
  const k = { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 };
  // held: 30 keydowns (the later ones auto-repeats), then the keyup, as kit-662's held-key test
  const presses = [];
  for (let i = 0; i < 30; i++) presses.push(p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k, autoRepeat: i > 0 }));
  await Promise.all(presses);
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
  await within(async () => { const s = edits(rec).slice(n0); return s.length > 0 && s[s.length - 1].ops[0].value === 30; }, 'the last nudge sent', async () => JSON.stringify(edits(rec).slice(n0).map((x) => x.ops)), 10000);
  await waitSaved(p);
  await sleep(300);
  const burst = edits(rec).slice(n0);
  const at = rec.sentAt.filter((_, i) => rec.sent[i] && rec.sent[i].t === 'edit').slice(n0);
  assert.ok(burst.length < 30, `fewer than 30 edit frames (${burst.length})`);
  for (const f of burst) assert.deepEqual(f.ops.map((o) => [o.op, o.id, o.prop]), [['set', 'card', 'x'], ['set', 'badge', 'x']], 'each sets card x and badge x');
  const vals = burst.map((f) => f.ops[0].value);
  for (let i = 1; i < vals.length; i++) assert.ok(vals[i] > vals[i - 1], `rising: ${vals.join(' ')}`);
  assert.ok(vals.some((v, i) => (i === 0 ? v : v - vals[i - 1]) > 1), `at least one jump over 1 (coalesced): ${vals.join(' ')}`);
  for (const f of burst) assert.equal(f.ops[1].value, f.ops[0].value + 12, 'badge moves with card');
  for (let i = 0; i < at.length; i++) assert.ok(at.filter((x) => x >= at[i] && x < at[i] + 1000).length <= 21, 'at most 21 in any second');
  let d = fake.doc('every');
  assert.deepEqual([d.nodes.card.x, d.nodes.badge.x], [30, 42], 'the final positions');
  // one Ctrl+Z takes back the whole hold
  const n1 = edits(rec).length;
  await undoKey(p);
  const back = await nextEdit(rec, n1);
  assert.deepEqual(byProp(back.ops).map((o) => [o.id, o.prop, o.value]).sort(), [['badge', 'x', 12], ['card', 'x', 0]], 'both set back to their starts');
  await accepted(rec, n1);
  await sleep(300);
  assert.equal(edits(rec).length, n1 + 1, 'one undo frame');
  d = fake.doc('every');
  assert.deepEqual([d.nodes.card.x, d.nodes.badge.x], [0, 12], 'restored in the fake');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

test("M1.13 a select naming a new node waits for its add's ack", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  // the acks held: a refused del starts a fetch, held by the recorder; frames that come meanwhile
  // (the add's ack) wait in the page, and its edits wait unsent
  holdDocs(rec);
  await showPageLink(p, 'p-parts', { row: false });
  await selectRow(p, 'button-label');
  await blurAll(p);
  await p.key('Delete');
  await within(async () => refusedFrames(rec).some((m) => m.why === 'ref'), 'the del refused ref', async () => JSON.stringify(rec.got.slice(-3)));
  await within(async () => rec.held.length === 1, "the refusal's doc request held", async () => rec.requests.join(' '), 5000);
  await showPageLink(p, 'p-main', { row: false });
  // a rectangle drawn on empty stage: added and selected
  await blurAll(p);
  await p.key('r');
  const at = await pagePt(p, -150, -150);
  await p.clickAt(at.x, at.y);
  await within(async () => (await selectedRows(p)).length === 1 && !['card', 'loose', 'tiles'].includes((await selectedRows(p))[0]), 'the new rect selected', async () => JSON.stringify(await selectedRows(p)));
  const [id] = await selectedRows(p);
  const naming = () => rec.sent.map((m, i) => ({ m, i })).filter((x) => x.m && x.m.t === 'select' && x.m.ids.includes(id));
  await sleep(1000);
  assert.deepEqual(naming(), [], 'no select naming it while its add is unacked');
  rec.release();
  rec.hold = null;
  await within(async () => naming().length > 0, 'a select naming it', async () => JSON.stringify(rec.sent.slice(-4)), 10000);
  const add = edits(rec).find((e) => e.ops.some((o) => o.op === 'add' && o.node && o.node.id === id));
  assert.ok(add, 'its add sent');
  const ack = await ackOf(rec, add);
  const ackAt = rec.gotAt[rec.got.indexOf(ack)];
  const sel = naming()[0];
  assert.ok(rec.sentAt[sel.i] >= ackAt, `the select (${rec.sentAt[sel.i]}) after the ack (${ackAt})`);
  assert.ok(sel.i > rec.sent.indexOf(add), 'the select after the add');
  noDialogs(rec);
  noExceptions(rec);
});
