import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { canDrive } from './lib/chrome.mjs';
import { EVERY, EVERY_IMAGES, IMG_FILE, IMG_PATH, ackOf, added, box, centre, count, drag, dragPath, edits, enter, focusField, hitAt, leavePanel, live, madeAndSelected, near, nextEdit, noExceptions, open, pressedTool, refusedFrames, selectRow, selectedIds, sendsNothing, waitSaved, within, zoomNow } from './lib/canvas-fixture.mjs';

// ---- C4.1, C4.6 and C1.1a: the tools ----

const TOOL_KEYS = [['F', 'frame'], ['T', 'text'], ['R', 'rect'], ['O', 'ellipse'], ['P', 'vector'], ['I', 'image'], ['V', 'move']];
test('tool keys', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec, size } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  // the bar: a toolbar at the stage's foot, centred, its right edge at least 160 px from the stage's
  assert.equal(await p.ev("document.getElementById('tools')?.getAttribute('role') ?? null"), 'toolbar');
  const tools = await p.ev("[...document.querySelectorAll('#tools button[data-tool]')].map((b) => [b.dataset.tool, b.querySelector('kbd')?.textContent ?? null])");
  assert.deepEqual(tools.map(([tool]) => tool).sort(), ['ellipse', 'frame', 'image', 'move', 'rect', 'text', 'vector']);
  for (const [k, tool] of TOOL_KEYS) assert.deepEqual(tools.find(([x]) => x === tool), [tool, k], `${tool}'s key hint is a kbd ${k}`);
  const stage = await box(p, '#stage');
  const bar = await box(p, '#tools');
  assert.ok(stage.r - bar.r >= 160, `the bar's right edge ${stage.r - bar.r} px from the stage's`);
  assert.ok(Math.abs((bar.l + bar.r) / 2 - (stage.l + stage.r) / 2) < 1, 'the bar centred');
  assert.ok(stage.b - bar.b >= 0 && stage.b - bar.b < 40, `the bar at the stage's foot (${stage.b - bar.b})`);
  assert.equal(await pressedTool(p), 'move', 'Move at first');
  // C4.1: each key presses its button, Escape returns to Move
  for (const [k, tool] of TOOL_KEYS) {
    await p.key(k);
    assert.equal(await pressedTool(p), tool, `${k} presses ${tool}`);
    await p.key('Escape');
    assert.equal(await pressedTool(p), 'move', `Escape after ${k}: Move`);
  }
  // a click on a button presses it too, and Escape with Move on still clears the selection
  await p.click('#tools button[data-tool="rect"]');
  assert.equal(await pressedTool(p), 'rect', 'the Rectangle button pressed by a click');
  await p.key('Escape');
  assert.equal(await pressedTool(p), 'move');
  await selectRow(p, 'title');
  // the same keys typed in the Name field change no tool
  assert.equal(await focusField(p, 'name'), true, 'the Name field focused');
  const n0 = edits(rec).length;
  for (const [k] of TOOL_KEYS) {
    await p.key(k);
    assert.equal(await pressedTool(p), 'move', `${k} in the Name field changes no tool`);
  }
  assert.equal(await p.ev("document.querySelector('#props [data-prop=\"name\"]').value"), TOOL_KEYS.map(([k]) => k).join(''), 'the keys went to the field');
  assert.equal(edits(rec).length, n0, 'nothing sent while typing');
  await leavePanel(p);
  // a narrower desktop stage (review T3-1, T3-2-1): the bar stays one row at the foot, every button
  // inside it, its right edge at least 160 px left of the stage's, centred while key buttons of a
  // usable size fit so (a stage of 520 px and over), and the stage's own corner points bare
  for (const w of [1280, 1070, 1024, 870, 800]) {
    await size(w, 900);
    await within(async () => (await p.ev('innerWidth')) === w, `the window at ${w}`);
    const st = await box(p, '#stage');
    const g = await p.ev(`(() => {
      const t = document.getElementById('tools');
      const b = t.getBoundingClientRect();
      const btns = [...t.querySelectorAll('button[data-tool]')].map((x) => { const r = x.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width }; });
      return { shown: getComputedStyle(t).display !== 'none' && b.width > 0, bar: { l: b.left, r: b.right, t: b.top, b: b.bottom }, btns };
    })()`);
    assert.equal(g.shown, true, `${w}: the bar shown`);
    assert.equal(g.btns.length, 7, `${w}: seven tools`);
    for (const [i, r] of g.btns.entries()) {
      assert.ok(r.w > 0 && r.l >= g.bar.l - 0.5 && r.r <= g.bar.r + 0.5 && r.t >= g.bar.t - 0.5 && r.b <= g.bar.b + 0.5, `${w}: button ${i} ${JSON.stringify(r)} inside the bar ${JSON.stringify(g.bar)}`);
    }
    assert.equal(new Set(g.btns.map((r) => Math.round(r.t))).size, 1, `${w}: the bar is one row`);
    assert.ok(st.r - g.bar.r >= 160, `${w}: the bar's right edge ${st.r - g.bar.r} px left of the stage's`);
    assert.ok(g.bar.l >= st.l && st.b - g.bar.b >= 0 && st.b - g.bar.b < 40, `${w}: the bar inside the stage, at its foot`);
    if (st.w >= 520) {
      assert.ok(Math.abs((g.bar.l + g.bar.r) / 2 - (st.l + st.r) / 2) < 1, `${w}: the bar centred on a ${st.w} px stage`);
      assert.ok(g.btns.every((r) => r.w >= 20), `${w}: key buttons of a usable size (${g.btns.map((r) => r.w).join(', ')})`);
    }
    for (const d of [60, 120]) assert.equal(await p.ev(`document.elementFromPoint(${st.r - d}, ${st.b - d})?.id`), 'stage', `${w}: the stage's corner point ${d} px in is bare stage`);
    await p.key('F');
    assert.equal(await pressedTool(p), 'frame', `${w}: F still presses Frame`);
    await p.key('Escape');
  }
  // at 790 (a 250 px stage) no bar keeps 160 px clear: it is hidden, and the keys still pick tools
  await size(790, 900);
  await within(async () => (await p.ev('innerWidth')) === 790, 'the window at 790');
  assert.equal(await p.ev("(() => { const t = document.getElementById('tools'); return getComputedStyle(t).display === 'none' || t.getBoundingClientRect().width === 0; })()"), true, '790: the bar hidden');
  await p.key('F');
  assert.equal(await pressedTool(p), 'frame', '790: F still picks Frame');
  await p.key('Escape');
  assert.equal(await pressedTool(p), 'move', '790: Escape back to Move');
  noExceptions(rec);
});

test('new nodes go where the pointer is', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await rec.send('Page.setInterceptFileChooserDialog', { enabled: true });
  const z = await zoomNow(p);
  const made = {};
  const node = (id) => fake.doc('every').nodes[id];

  // C4.6: a frame clicked into the row `actions`, right of buy: after buy, no x, y, 200 × 120
  let actions = await box(p, '#surface [data-id="actions"]');
  const buy = await box(p, '#surface [data-id="buy"]');
  let pt = { x: Math.round((buy.r + actions.r) / 2), y: Math.round((actions.t + actions.b) / 2) };
  assert.equal(await hitAt(p, pt), 'actions', 'the point is on actions, right of buy');
  let n0 = edits(rec).length;
  await p.key('F');
  await p.clickAt(pt.x, pt.y);
  let op = await added(rec, n0, 'frame in actions');
  assert.equal(op.after, 'buy', 'after buy');
  assert.deepEqual(op.node, { id: op.node.id, type: 'frame', parent: 'actions', name: op.node.name, size: { w: 200, h: 120 }, layout: { mode: 'none' }, fill: '#ffffff' }, 'a frame in actions, no x, y');
  await madeAndSelected(p, op.node.id, 'frame in actions');
  assert.deepEqual(fake.doc('every').nodes.actions.children, ['buy', op.node.id], "the fake's actions: buy, then the frame");
  assert.equal(Object.hasOwn(node(op.node.id), 'x') || Object.hasOwn(node(op.node.id), 'y'), false, 'no x, y stored');
  made.frameInRow = op.node.id;

  // C4.6: a frame clicked into the none frame `loose`: its x, y at the pointer in loose's px
  let loose = await box(p, '#surface [data-id="loose"]');
  pt = { x: Math.round(loose.l + 100 * z), y: Math.round(loose.t + 100 * z) };
  assert.equal(await hitAt(p, pt), 'loose');
  n0 = edits(rec).length;
  await p.key('F');
  await p.clickAt(pt.x, pt.y);
  op = await added(rec, n0, 'frame in loose');
  assert.equal(op.node.parent, 'loose');
  assert.equal(op.after, 'badge', 'on top: after the last child');
  assert.equal(op.node.x, Math.round((pt.x - loose.l) / z), 'x at the pointer');
  assert.equal(op.node.y, Math.round((pt.y - loose.t) / z), 'y at the pointer');
  assert.deepEqual(op.node.size, { w: 200, h: 120 });
  await madeAndSelected(p, op.node.id, 'frame in loose');
  assert.equal(node(op.node.id).x, op.node.x, 'x stored');
  assert.equal(node(op.node.id).y, op.node.y, 'y stored');

  // a frame dragged out on the page, right of loose: that size, at the press point, a dashed draft meanwhile
  loose = await box(p, '#surface [data-id="loose"]');
  const surf = await box(p, '#surface');
  pt = { x: Math.round(loose.r + 40), y: Math.round(loose.t + 10) };
  assert.equal(await hitAt(p, pt), 'stage', 'empty stage right of loose');
  n0 = edits(rec).length;
  await p.key('F');
  let draft = null;
  await drag(p, pt, 90, 60, async () => { draft = await p.ev("(() => { const d = document.querySelector('#stage .draft'); return d ? { dashed: getComputedStyle(d).borderStyle, id: d.dataset.id ?? null, pe: getComputedStyle(d).pointerEvents } : null; })()"); });
  assert.deepEqual(draft, { dashed: 'dashed', id: null, pe: 'none' }, 'a dashed draft while dragging, no data-id');
  op = await added(rec, n0, 'frame dragged on the page');
  assert.equal(await count(p, '#stage .draft'), 0, 'the draft gone');
  assert.equal(op.node.parent, 'p-main');
  assert.equal(op.after, 'tiles', "after the page's last node");
  assert.equal(op.node.x, Math.round((pt.x - surf.l) / z));
  assert.equal(op.node.y, Math.round((pt.y - surf.t) / z));
  assert.deepEqual(op.node.size, { w: Math.round(90 / z), h: Math.round(60 / z) }, 'the dragged size, fixed');
  await madeAndSelected(p, op.node.id, 'frame on the page');
  made.frameOnPage = op.node.id;

  // a text clicked into loose: "Text", hug × hug, its Text field focused
  loose = await box(p, '#surface [data-id="loose"]');
  pt = { x: Math.round(loose.l + 30 * z), y: Math.round(loose.t + 150 * z) };
  assert.equal(await hitAt(p, pt), 'loose');
  n0 = edits(rec).length;
  await p.key('T');
  await p.clickAt(pt.x, pt.y);
  op = await added(rec, n0, 'text');
  assert.deepEqual(op.node, { id: op.node.id, type: 'text', parent: 'loose', name: op.node.name, x: Math.round((pt.x - loose.l) / z), y: Math.round((pt.y - loose.t) / z), size: { w: 'hug', h: 'hug' }, text: 'Text' });
  await madeAndSelected(p, op.node.id, 'text');
  await within(async () => (await p.ev('document.activeElement?.dataset.prop ?? null')) === 'text', 'the Text field focused', async () => p.ev('document.activeElement?.outerHTML.slice(0, 80) ?? null'), 5000);
  await leavePanel(p);
  made.text = op.node.id;

  // a rectangle dragged out in loose: that size, fill #d9d9d9
  pt = { x: Math.round(loose.l + 120 * z), y: Math.round(loose.t + 30 * z) };
  assert.equal(await hitAt(p, pt), 'loose');
  n0 = edits(rec).length;
  await p.key('R');
  await drag(p, pt, 40, 30);
  op = await added(rec, n0, 'rect');
  assert.deepEqual(op.node, { id: op.node.id, type: 'rect', parent: 'loose', name: op.node.name, x: Math.round((pt.x - loose.l) / z), y: Math.round((pt.y - loose.t) / z), size: { w: Math.round(40 / z), h: Math.round(30 / z) }, fill: '#d9d9d9' });
  await madeAndSelected(p, op.node.id, 'rect');
  made.rect = op.node.id;

  // an ellipse clicked on the page, below the frames made right of loose: 100 × 100
  pt = { x: Math.round(loose.r + 40), y: Math.round(loose.t + 260 * z) };
  assert.equal(await hitAt(p, pt), 'stage', 'empty stage below the frames right of loose');
  n0 = edits(rec).length;
  await p.key('O');
  await p.clickAt(pt.x, pt.y);
  op = await added(rec, n0, 'ellipse');
  assert.deepEqual(op.node, { id: op.node.id, type: 'ellipse', parent: 'p-main', name: op.node.name, x: Math.round((pt.x - surf.l) / z), y: Math.round((pt.y - surf.t) / z), size: { w: 100, h: 100 }, fill: '#d9d9d9' });
  assert.equal(op.after, made.frameOnPage, "after the page's last node");
  await madeAndSelected(p, op.node.id, 'ellipse');
  made.ellipse = op.node.id;

  // a vector: Escape drops a path; then three clicks in loose ended with Enter
  const pts = [[150, 20], [185, 60], [160, 90]].map(([x, y]) => ({ x: Math.round(loose.l + x * z), y: Math.round(loose.t + y * z) }));
  n0 = edits(rec).length;
  await p.key('P');
  await p.clickAt(pts[0].x, pts[0].y);
  await p.clickAt(pts[1].x, pts[1].y);
  assert.equal(await count(p, '#stage .pen'), 1, 'the path previewed');
  await p.key('Escape');
  assert.equal(await pressedTool(p), 'move', 'Escape: Move');
  assert.equal(await count(p, '#stage .pen'), 0, 'the preview gone');
  await sleep(300);
  assert.equal(edits(rec).length, n0, 'Escape sends nothing');
  await p.key('P');
  for (const q of pts) await p.clickAt(q.x, q.y);
  await enter(p);
  op = await added(rec, n0, 'vector');
  const lp = pts.map((q) => [(q.x - loose.l) / z, (q.y - loose.t) / z]);
  const x0 = Math.round(Math.min(...lp.map(([x]) => x)));
  const y0 = Math.round(Math.min(...lp.map(([, y]) => y)));
  assert.equal(op.node.type, 'vector');
  assert.equal(op.node.parent, 'loose');
  assert.equal(op.node.x, x0, 'x: the points’ left');
  assert.equal(op.node.y, y0, 'y: the points’ top');
  assert.deepEqual(op.node.size, { w: 'hug', h: 'hug' });
  assert.match(op.node.path, /^M -?[\d.]+ -?[\d.]+ L -?[\d.]+ -?[\d.]+ L -?[\d.]+ -?[\d.]+$/, `the path (${op.node.path})`);
  const nums = op.node.path.match(/-?[\d.]+/g).map(Number);
  lp.forEach(([x, y], i) => {
    assert.ok(Math.abs(nums[2 * i] - (x - x0)) <= 0.051 && Math.abs(nums[2 * i + 1] - (y - y0)) <= 0.051, `point ${i} at (${x - x0}, ${y - y0}) in the path (${op.node.path})`);
  });
  assert.ok(nums.every((v) => Math.round(v * 10) === v * 10 || Math.abs(Math.round(v * 10) - v * 10) < 1e-9), 'numbers to 0.1');
  assert.equal(await count(p, '#stage .pen'), 0, 'the preview gone');
  await madeAndSelected(p, op.node.id, 'vector');
  made.vector = op.node.id;

  // an image clicked into the column `card`, in photo's lower half: after photo, the picker, the upload
  const photo = await box(p, '#surface [data-id="photo"]');
  pt = { x: Math.round((photo.l + photo.r) / 2), y: Math.round(photo.t + photo.h * 0.75) };
  assert.equal(await hitAt(p, pt), 'photo');
  n0 = edits(rec).length;
  const c0 = rec.choosers.length;
  await p.key('I');
  await p.clickAt(pt.x, pt.y);
  await within(async () => rec.choosers.length > c0, 'the file chooser opened', async () => JSON.stringify(rec.choosers));
  const ch = rec.choosers[c0];
  assert.equal(ch.mode, 'selectSingle');
  await rec.send('DOM.setFileInputFiles', { files: [IMG_PATH], backendNodeId: ch.backendNodeId });
  op = await added(rec, n0, 'image');
  assert.deepEqual(op.node, { id: op.node.id, type: 'image', parent: 'card', name: op.node.name, size: { w: 'hug', h: 'hug' }, src: `images/${IMG_FILE}` });
  assert.equal(op.after, 'photo', 'after photo');
  assert.ok(rec.requests.some((u) => u.endsWith('/api/canvas/image?slug=every')), 'the image posted');
  await madeAndSelected(p, op.node.id, 'image');
  made.image = op.node.id;

  await waitSaved(p);
  const doc = fake.doc('every');
  const types = Object.values(made).map((id) => doc.nodes[id]?.type);
  assert.deepEqual(types.sort(), ['ellipse', 'frame', 'frame', 'image', 'rect', 'text', 'vector'], "the fake's document holds each made node");
  assert.equal(doc.nodes.card.children.indexOf(made.image), doc.nodes.card.children.indexOf('photo') + 1, 'the image after photo in card');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

// ---- C4.2 to C4.4: moving by drag and by arrows ----

test('drag a loose node', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  // a zoom other than 1
  const z0 = await zoomNow(p);
  await p.click('#zoomOut');
  await within(async () => Math.abs((await zoomNow(p)) - z0 / 1.25) < 1e-4, 'zoomed out a step');
  const z = await zoomNow(p);
  assert.ok(Math.abs(z - 1) > 0.05, `the zoom is not 1 (${z})`);
  assert.deepEqual(await selectedIds(p), [], 'nothing selected at first');

  // C4.2a and C4.2: a press on the unselected badge selects it, and a drag of (30, 20) moves it, previewed
  // under the pointer meanwhile; one edit of set x and set y by (30/z, 20/z), rounded
  const b0 = await box(p, '#surface [data-id="badge"]');
  const a = centre(b0);
  assert.equal(await hitAt(p, a), 'badge');
  let n0 = edits(rec).length;
  await drag(p, a, 30, 20, async () => {
    assert.deepEqual(await selectedIds(p), ['badge'], 'the press selected badge');
    const b = await box(p, '#surface [data-id="badge"]');
    near(b.l, b0.l + 30, 1, 'previewed x');
    near(b.t, b0.t + 20, 1, 'previewed y');
    assert.equal(await count(p, '#surface [data-id="badge"]'), 1, 'one badge drawn while dragging');
  });
  // kit-668: any live frames (however many, none included), then the drop's set x and set y
  await nextEdit(rec, n0);
  await waitSaved(p); // every frame of the drag sent and acked
  const dragged = edits(rec).slice(n0);
  const e = dragged[dragged.length - 1];
  const want = [{ op: 'set', id: 'badge', prop: 'x', value: Math.round(12 + 30 / z) }, { op: 'set', id: 'badge', prop: 'y', value: Math.round(-8 + 20 / z) }];
  for (const f of dragged.slice(0, -1)) assert.ok(f.ops.length > 0 && f.ops.every((o) => o.op === 'set' && o.id === 'badge' && ['x', 'y'].includes(o.prop)), `a live frame only sets badge's x and/or y: ${JSON.stringify(f.ops)}`);
  assert.deepEqual(e.ops, want, 'the last frame: set x and set y');
  await ackOf(rec, e);
  await sendsNothing(rec, n0 + dragged.length, 'after the drop');
  const b1 = await box(p, '#surface [data-id="badge"]');
  near(b1.l, b0.l + 30, z, 'drawn there: x');
  near(b1.t, b0.t + 20, z, 'drawn there: y');
  assert.deepEqual(await selectedIds(p), ['badge'], 'still selected after the release');
  await waitSaved(p);
  assert.equal(fake.doc('every').nodes.badge.x, want[0].value, "the fake's badge.x");
  assert.equal(fake.doc('every').nodes.badge.y, want[1].value, "the fake's badge.y");

  // a press without a drag (3 px or less) is a click: it selects and sends nothing
  const d = centre(await box(p, '#surface [data-id="dot"]'));
  n0 = edits(rec).length;
  await drag(p, d, 2, 2);
  await within(async () => JSON.stringify(await selectedIds(p)) === '["dot"]', 'the press on dot selected it', async () => JSON.stringify(await selectedIds(p)), 5000);
  await sendsNothing(rec, n0, 'a press of 2 px');

  // Escape during a drag drops it: badge back where it was (kit-668: any live frames followed by a
  // restore, the fake's badge where it was), the selection kept
  n0 = edits(rec).length;
  await drag(p, centre(b1), 40, 0, async () => {
    near((await box(p, '#surface [data-id="badge"]')).l, b1.l + 40, 1, 'previewed before Escape');
    await p.key('Escape');
  });
  await sleep(600);
  const esc = edits(rec).slice(n0);
  for (const f of esc) assert.ok(f.ops.every((o) => o.op === 'set' && o.id === 'badge' && ['x', 'y'].includes(o.prop)), `Escape: live frames and a restore only: ${JSON.stringify(f.ops)}`);
  if (esc.length) assert.deepEqual(esc[esc.length - 1].ops, [{ op: 'set', id: 'badge', prop: 'x', value: want[0].value }], 'Escape after live frames: the last frame restores x');
  await waitSaved(p);
  assert.deepEqual([fake.doc('every').nodes.badge.x, fake.doc('every').nodes.badge.y], [want[0].value, want[1].value], "Escape: the fake's badge where it was");
  const b2 = await box(p, '#surface [data-id="badge"]');
  near(b2.l, b1.l, 0.5, 'badge back: x');
  near(b2.t, b1.t, 0.5, 'badge back: y');
  assert.deepEqual(await selectedIds(p), ['badge'], 'Escape during a drag keeps the selection');

  // a drag released outside the stage still ends (pointer capture): released over the Layers panel,
  // the drop is on the page, by the same rule as any drop there
  const lay = await box(p, '#layers');
  n0 = edits(rec).length;
  await dragPath(p, [centre(b2), { x: Math.round(lay.l + lay.w / 2), y: centre(b2).y }]);
  await within(async () => edits(rec).slice(n0).some((f) => f.ops[0].op === 'move'), 'the move sent', async () => JSON.stringify(edits(rec).slice(n0).map((f) => f.ops)), 10000);
  await sendsNothing(rec, edits(rec).length, 'after the move');
  const out = edits(rec)[edits(rec).length - 1];
  assert.deepEqual(out.ops[0], { op: 'move', id: 'badge', parent: 'p-main', after: 'tiles' }, 'released outside the stage: the last frame a move onto the page');
  assert.deepEqual(out.ops.slice(1).map((o) => o.prop), ['x', 'y'], 'with set x and set y');
  await ackOf(rec, out);
  assert.equal(await p.ev("document.querySelector('#surface [data-id=\"badge\"]').style.translate"), '', 'no preview left');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

test('drag into and within auto-layout', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const z = await zoomNow(p);
  const kids = (id) => fake.doc('every').nodes[id].children;

  // dot (in the column card) to the lower half of photo's drawn box: one move into card after photo
  let dot = await box(p, '#surface [data-id="dot"]');
  let photo = await box(p, '#surface [data-id="photo"]');
  let n0 = edits(rec).length;
  await dragPath(p, [centre(dot), { x: Math.round(photo.l + photo.w / 2), y: Math.round(photo.t + photo.h * 0.75) }]);
  let e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'move', id: 'dot', parent: 'card', after: 'photo' }], 'one move of dot after photo');
  await ackOf(rec, e);
  await waitSaved(p);
  assert.deepEqual(kids('card'), ['title', 'rule', 'icon', 'photo', 'dot', 'actions'], "the fake's card");
  photo = await box(p, '#surface [data-id="photo"]');
  dot = await box(p, '#surface [data-id="dot"]');
  assert.ok(dot.t >= photo.b, 'dot drawn below photo');

  // dot to the centre of loose's drawn box: one edit of a move into loose with set x and set y, where
  // the drop put it (its top-left, as previewed) in loose's px, whole
  const loose = await box(p, '#surface [data-id="loose"]');
  const from = centre(dot);
  const to = centre(loose);
  n0 = edits(rec).length;
  await dragPath(p, [from, to]);
  e = await nextEdit(rec, n0);
  const x = Math.round((dot.l + (to.x - from.x) - loose.l) / z);
  const y = Math.round((dot.t + (to.y - from.y) - loose.t) / z);
  assert.deepEqual(e.ops, [{ op: 'move', id: 'dot', parent: 'loose', after: 'badge' }, { op: 'set', id: 'dot', prop: 'x', value: x }, { op: 'set', id: 'dot', prop: 'y', value: y }], 'a move into loose with its x, y');
  await ackOf(rec, e);
  await waitSaved(p);
  assert.deepEqual(kids('loose'), ['badge', 'dot']);
  assert.equal(fake.doc('every').nodes.dot.x, x);
  assert.equal(fake.doc('every').nodes.dot.y, y);
  dot = await box(p, '#surface [data-id="dot"]');
  near(dot.l, loose.l + x * z, 1, 'dot drawn at its x in loose');
  near(dot.t, loose.t + y * z, 1, 'dot drawn at its y in loose');
  assert.equal(await p.ev("document.querySelector('#surface [data-id=\"dot\"]').parentElement.dataset.id"), 'loose', 'drawn inside loose');

  // badge to the lower half of title's drawn box: a move into card after title, and no x, y
  const badge = await box(p, '#surface [data-id="badge"]');
  const title = await box(p, '#surface [data-id="title"]');
  n0 = edits(rec).length;
  await dragPath(p, [centre(badge), { x: Math.round(title.l + title.w / 2), y: Math.round(title.t + title.h * 0.75) }]);
  await within(async () => edits(rec).slice(n0).some((f) => f.ops[0].op === 'move'), 'the move sent', async () => JSON.stringify(edits(rec).slice(n0).map((f) => f.ops)), 10000);
  await sendsNothing(rec, edits(rec).length, 'after the move');
  e = edits(rec)[edits(rec).length - 1];
  assert.deepEqual(e.ops, [{ op: 'move', id: 'badge', parent: 'card', after: 'title' }], 'the last frame: one move of badge after title, no x, y');
  await ackOf(rec, e);
  await waitSaved(p);
  assert.deepEqual(kids('card'), ['title', 'badge', 'rule', 'icon', 'photo', 'actions'], "the fake's card");
  assert.equal(await p.ev("document.querySelector('#surface [data-id=\"badge\"]').parentElement.dataset.id"), 'card', 'badge drawn inside card');

  // within the column: rule dragged to the upper half of title goes first
  const rule = await box(p, '#surface [data-id="rule"]');
  const title2 = await box(p, '#surface [data-id="title"]');
  n0 = edits(rec).length;
  await dragPath(p, [centre(rule), { x: Math.round(title2.l + title2.w / 2), y: Math.round(title2.t + title2.h * 0.25) }]);
  e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'move', id: 'rule', parent: 'card', after: null }], 'rule moved first in card');
  await ackOf(rec, e);
  await waitSaved(p);
  assert.deepEqual(kids('card'), ['rule', 'title', 'badge', 'icon', 'photo', 'actions'], "the fake's card");
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});
