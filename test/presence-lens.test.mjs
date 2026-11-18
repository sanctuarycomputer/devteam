// The artifact lens's presence messages (presence@1 §10): pointer, and place/placed, in real Chrome.
// A fixture artifact framed in a real dashboard, a real mouse for every move, and the artifact's own
// script answering { ask } probes, since an opaque-origin frame is out of the test's reach.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { kit, write, dashboardOnFreePort, threadsFixture } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A wait on a condition in a page: an evaluation that throws is "not yet".
const soonIn = (p, ms = 30000) => async (expr, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v, err = null;
    try { v = await p.ev(expr); } catch (e) { err = e; }
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out: ${what}${err ? `; last: ${err.message}` : ''}`);
    await sleep(50);
  }
};

// An artifact landed on main in a threads fixture, as a merged PR puts it there: its tree id.
function landArtifact(F, slug, files) {
  const dir = path.join(F.old, 'docs/devteam/project/artifacts', slug);
  for (const [rel, text] of Object.entries(files)) write(path.join(dir, rel), text);
  F.g(['add', '-A', dir], F.old);
  F.g(['commit', '-qm', `artifact: ${slug}`], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
  return F.g(['rev-parse', `HEAD:docs/devteam/project/artifacts/${slug}`], F.old);
}

// The artifact's own script: it counts getElementsByTagName calls and answers the test's { ask }
// probes with parent.postMessage({ own: 1, ask, ... }):
//   rect { sel }   -> { rect: { x, y, w, h } }, getBoundingClientRect rounded (null for no match)
//   is { k, sel }  -> { is }, whether both select the same element (false on a throw)
//   leave          -> {}, after a mouseout with no relatedTarget on what the last mousemove hit
//                     (a real mouse leaving an out-of-process frame tells it nothing)
//   leaveAfter { n } -> {} at once; then each of the next n mousemoves is followed, from a
//                     setTimeout(0) (the lens hears the move first), by a mouseout with no
//                     relatedTarget on that move's target
//   tags           -> { n }, getElementsByTagName calls so far
//   move { n }     -> { frames: n }, once #mover has moved 1 px a frame for n frames
//   text           -> {}, once #a reads "A2"
const OWN_SCRIPT = [
  '(function () {',
  '  window.__tags = 0;',
  '  var byTag = Document.prototype.getElementsByTagName;',
  '  Document.prototype.getElementsByTagName = function () { window.__tags++; return byTag.apply(this, arguments); };',
  '  var lastTarget = null, leaves = 0;',
  '  var leaveOn = function (el) { el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: null })); };',
  '  addEventListener("mousemove", function (e) { var el = e.target; lastTarget = el; if (leaves > 0) { leaves--; setTimeout(function () { leaveOn(el); }, 0); } }, true);',
  '  var say = function (ask, o) { var m = { own: 1, ask: ask }; for (var k in o) m[k] = o[k]; parent.postMessage(m, "*"); };',
  '  var round = function (r) { return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };',
  '  addEventListener("message", function (e) {',
  '    var d = e.data;',
  '    if (!d || typeof d.ask !== "string") return;',
  '    if (d.ask === "rect") { var el = document.querySelector(d.sel); say("rect", { rect: el ? round(el.getBoundingClientRect()) : null }); }',
  '    else if (d.ask === "is") { var same = false; try { same = document.querySelector(d.k) === document.querySelector(d.sel); } catch (err) { same = false; } say("is", { is: same }); }',
  '    else if (d.ask === "leave") { leaveOn(lastTarget || document.documentElement); say("leave", {}); }',
  '    else if (d.ask === "leaveAfter") { leaves = d.n; say("leaveAfter", {}); }',
  '    else if (d.ask === "tags") say("tags", { n: window.__tags });',
  '    else if (d.ask === "move") {',
  '      var mover = document.getElementById("mover"), left = parseFloat(mover.style.left) || 0, done = 0, n = d.n;',
  '      var step = function () { if (done >= n) { say("move", { frames: n }); return; } left += 1; mover.style.left = left + "px"; done++; requestAnimationFrame(step); };',
  '      requestAnimationFrame(step);',
  '    }',
  '    else if (d.ask === "text") { document.getElementById("a").textContent = "A2"; say("text", {}); }',
  '  });',
  '})();',
].join('\n');
const at = (x, y, w, h) => `position:absolute;margin:0;left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
export const LENS_MOCK = {
  'artifact.json': JSON.stringify({ v: 1, title: 'Lens mock', summary: 'A page to point at, and to place others on', by: 'supervisor', for: [] }),
  'index.html': '<!doctype html><html><head><title>Lens mock</title><style>body { margin: 0 }</style><script>' + OWN_SCRIPT + '</script></head><body>'
    + `<div id="box" style="${at(100, 100, 200, 100)}"></div>`
    + `<section><p style="${at(400, 100, 100, 50)}">plain</p></section>`
    + `<div id="a" style="${at(100, 300, 100, 40)}">A</div>`
    + `<div id="mover" style="${at(100, 400, 50, 20)}"></div>`
    + `<div id="hid" style="display:none;${at(400, 200, 50, 20)}"></div>`
    + `<div id="inv" style="visibility:hidden;${at(400, 300, 50, 20)}"></div>`
    + '<p style="position:absolute;left:400px;top:400px;margin:0">decoy</p>'
    + '</body></html>',
};

// The fixture artifact framed at 0,0 (800x600) in a real dashboard at 1200x800. said(): the lens's
// messages so far, each { ...data, at } (the parent's receive time); ask(m): m posted to the frame;
// own(q): q posted, resolving to the frame's own { own: 1, ask, ... } answer; mouse(x, y): a real move.
export async function openLens(t) {
  const later = cleanup(t);
  const F = threadsFixture(`presence-lens-${process.pid}`);
  later(() => F.done());
  landArtifact(F, 'lens-mock', LENS_MOCK);
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  const soon = soonIn(p);
  await soon(`document.readyState === 'complete'`, 'the dashboard page');
  await p.ev(`new Promise((resolve) => { window.__heard = []; const f = document.createElement('iframe'); f.id = 'art-frame'; f.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px;border:0;z-index:99999'; addEventListener('message', (e) => { if (e.source === f.contentWindow) window.__heard.push({ data: e.data, at: performance.now() }); }); f.onload = () => resolve(true); f.src = '/artifact/main/lens-mock/'; document.body.appendChild(f); })`);
  const ask = (m) => p.ev(`(document.getElementById('art-frame').contentWindow.postMessage(${JSON.stringify(m)}, '*'), true)`);
  const said = async () => (await p.ev('window.__heard')).filter((h) => h.data && h.data.lens === 1).map((h) => ({ ...h.data, at: h.at }));
  const own = async (q) => {
    const from = await p.ev('window.__heard.length');
    await ask({ ask: q.ask, ...q });
    const i = await soon(`(() => { const h = window.__heard; for (let i = ${from}; i < h.length; i++) if (h[i].data && h[i].data.own === 1 && h[i].data.ask === ${JSON.stringify(q.ask)}) return i + 1; return 0; })()`, `the frame's answer to ${q.ask}`);
    return (await p.ev(`window.__heard[${i - 1}].data`));
  };
  const mouse = (x, y) => p.move(x, y);
  return { p, said, ask, own, mouse, soon };
}

const bare = (m) => { const { at: _at, ...rest } = m; return rest; };
// The span from the test's own clock: the lens can send nothing before the first input, and nothing
// later than one gap (67 ms) after the last; the parent's receive times stall under load.
const within = (got, t0, t1, what) => {
  const n = got.length;
  const secs = (t1 - t0 + 67) / 1000;
  assert.ok(n <= 15 * secs + 2, `${what}: ${n} pointers in ${secs.toFixed(3)} s is more than 15 a second (+2)`);
};

test('presence A15: the lens says pointer: a selector alone, x and y across it, at most 15 a second, null on leaving', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 }, async (t) => {
  const { said, ask, own, mouse, soon } = await openLens(t);
  const ptr = async () => (await said()).filter((m) => m.type === 'pointer');

  // A15a: before hello, nothing (these first moves also absorb a fresh frame's missed first move)
  await mouse(150, 125);
  await mouse(200, 150);
  await sleep(300);
  assert.deepEqual(await ptr(), [], 'A15a: no pointer told before hello');

  // A15b: a selector alone, and the fractions across it
  await ask({ lens: 1, type: 'hello' });
  await soon(`window.__heard.some((h) => h.data && h.data.lens === 1 && h.data.type === 'ready')`, 'ready');
  await mouse(150, 125);
  await sleep(300);
  let all = await ptr();
  assert.ok(all.length, 'A15b: a pointer after a move');
  let lastP = all[all.length - 1];
  assert.deepEqual(bare(lastP), { lens: 1, type: 'pointer', k: '#box', x: 0.25, y: 0.25 }, 'A15b: #box a quarter across and down');
  assert.deepEqual(Object.keys(lastP).filter((k) => k !== 'at'), ['lens', 'type', 'k', 'x', 'y'], 'A15b: no other field');
  await mouse(450, 125);
  await sleep(300);
  all = await ptr();
  lastP = all[all.length - 1];
  assert.match(String(lastP.k), /:nth-of-type\(/, 'A15b: an element with no id gets a path');
  assert.equal((await own({ ask: 'is', k: lastP.k, sel: 'section > p' })).is, true, 'A15b: the path finds that element in the frame');

  // A15c: 40 moves across #box, back to back (far above 15 a second, under any load): throttled, and
  // the last position arrives
  let from = (await ptr()).length;
  let t0 = Date.now();
  for (let i = 0; i < 40; i++) await mouse(101 + (198 * i) / 39, 110 + (80 * i) / 39);
  let t1 = Date.now();
  await sleep(300);
  let got = (await ptr()).slice(from);
  within(got, t0, t1, 'A15c');
  assert.ok(got.length >= 1, 'A15c: it follows the mouse');
  assert.deepEqual(bare(got[got.length - 1]), { lens: 1, type: 'pointer', k: '#box', x: 0.995, y: 0.9 }, 'A15c: the last move is the last word');

  // A15e: 20 real moves over #box back to back, each followed in the frame by a leave, then a last
  // leave: nulls pass the same gate (ungated, about 40 would be sent), and the leave is last
  from = (await ptr()).length;
  await own({ ask: 'leaveAfter', n: 20 });
  t0 = Date.now();
  for (let i = 0; i < 20; i++) await (i % 2 === 0 ? mouse(150, 125) : mouse(151, 126));
  await own({ ask: 'leave' });
  t1 = Date.now();
  await sleep(300);
  // moves Chrome coalesced leave leaves armed: none may follow A15d's moves
  await own({ ask: 'leaveAfter', n: 0 });
  got = (await ptr()).slice(from);
  within(got, t0, t1, 'A15e');
  assert.ok(got.length >= 1, 'A15e: something said');
  assert.deepEqual(bare(got[got.length - 1]), { lens: 1, type: 'pointer', k: null }, 'A15e: the leave is the last word');

  // A15d: over the page itself, null; a null after a null, nothing; then #box and a leave, two
  await mouse(150, 125);
  await sleep(200);
  all = await ptr();
  assert.equal(all[all.length - 1].k, '#box', 'A15d: from #box');
  await mouse(700, 550);
  await sleep(200);
  all = await ptr();
  assert.deepEqual(bare(all[all.length - 1]), { lens: 1, type: 'pointer', k: null }, 'A15d: over html, null');
  from = all.length;
  await own({ ask: 'leave' });
  await sleep(300);
  assert.equal((await ptr()).length, from, 'A15d: a null after a null says nothing');
  await mouse(150, 125);
  await sleep(200);
  await own({ ask: 'leave' });
  await sleep(300);
  got = (await ptr()).slice(from);
  assert.deepEqual(got.map(bare), [{ lens: 1, type: 'pointer', k: '#box', x: 0.25, y: 0.25 }, { lens: 1, type: 'pointer', k: null }], 'A15d: #box, then exactly one null');
});

test('presence A16: place answers each selector\'s rect, once a frame and only on change, apart from the pins', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 }, async (t) => {
  const { p, said, ask, own, soon } = await openLens(t);
  const placed = async () => (await said()).filter((m) => m.type === 'placed');
  // the n-th placed (1-based) once it has arrived
  const nth = async (n, what) => { await soon(`window.__heard.filter((h) => h.data && h.data.lens === 1 && h.data.type === 'placed').length >= ${n}`, what); return (await placed())[n - 1]; };

  // A16-0: a place is a question, answered before hello as resolve is
  await ask({ lens: 1, type: 'place', anchors: [{ id: 'c0', k: '#box' }] });
  let m = await nth(1, 'A16-0: placed before hello');
  assert.deepEqual(bare(m), { lens: 1, type: 'placed', rects: [{ id: 'c0', rect: { x: 100, y: 100, w: 200, h: 100 } }] }, 'A16-0: #box\'s rect');

  await ask({ lens: 1, type: 'hello' });
  await soon(`window.__heard.some((h) => h.data && h.data.lens === 1 && h.data.type === 'ready')`, 'ready');
  // a pin watched, as the viewer's resolve leaves it
  await ask({ lens: 1, type: 'resolve', id: 'r1', anchors: [{ key: 't-1', anchor: { selector: '#a', tag: 'p', text: 'A' } }] });
  await soon(`window.__heard.some((h) => h.data && h.data.lens === 1 && h.data.type === 'rects' && h.data.id === 'r1')`, 'the pins\' rects');

  // A16a: the list cut to its first 8, then each entry checked (id 1..64 characters, k 1..200
  // bytes): the valid ones among the first 8 answered in order, a valid 9th never (cut, then
  // filtered); null for nothing found (no text search), not shown, or a bad selector
  let n = (await placed()).length;
  await ask({ lens: 1, type: 'place', anchors: [
    { id: 'c1', k: '#a' },
    { id: 'x'.repeat(65), k: '#box' },
    { id: 'c2', k: '#gone', selector: '#gone', tag: 'p', text: 'decoy' },
    { id: 'c-empty', k: '' },
    { id: 'c3', k: '#hid' },
    { id: 'c-long', k: '#' + 'a'.repeat(200) },
    { id: 7, k: '#box' },
    null,
    { id: 'c9', k: '#box' },
  ] });
  m = await nth(n + 1, 'A16a: placed');
  assert.deepEqual(m.rects.map((r) => r.id), ['c1', 'c2', 'c3'], 'A16a: the valid ones among the first 8, in order; not the 9th');
  assert.deepEqual(m.rects[0].rect, (await own({ ask: 'rect', sel: '#a' })).rect, 'A16a: #a as the frame measures it');
  assert.deepEqual(m.rects.slice(1).map((r) => r.rect), [null, null], 'A16a: null for #gone (no text search) and #hid');
  // a second place replaces the first, and stands for A16b
  n = (await placed()).length;
  await ask({ lens: 1, type: 'place', anchors: [{ id: 'c4', k: '#inv' }, { id: 'c5', k: '<<bad' }, { id: 'c6', k: '#mover' }, { id: 'c7', k: '#box' }] });
  m = await nth(n + 1, 'A16a: placed for the second place');
  assert.deepEqual(m.rects, [{ id: 'c4', rect: null }, { id: 'c5', rect: null }, { id: 'c6', rect: { x: 100, y: 400, w: 50, h: 20 } }, { id: 'c7', rect: { x: 100, y: 100, w: 200, h: 100 } }], 'A16a: null for #inv and <<bad; #mover and #box where they are')

  // A16a-ii: a place with no list is ignored: the last place stands
  n = (await placed()).length;
  await ask({ lens: 1, type: 'place', anchors: null });
  await ask({ lens: 1, type: 'place', anchors: {} });
  await sleep(300);
  assert.equal((await placed()).length, n, 'A16a-ii: no placed for a place with no list');

  // A16b: it follows #mover, at most once a frame, and goes quiet when nothing moves
  n = (await placed()).length;
  assert.deepEqual(await own({ ask: 'move', n: 60 }), { own: 1, ask: 'move', frames: 60 });
  await sleep(100);
  let got = (await placed()).slice(n);
  assert.ok(got.length >= 20 && got.length <= 61, `A16b: ${got.length} placed for 60 frames`);
  const xs = got.map((p) => p.rects.find((r) => r.id === 'c6').rect.x);
  assert.ok(xs.every((x, i) => i === 0 || x > xs[i - 1]), `A16b: #mover further on in each: ${xs.join(',')}`);
  n = (await placed()).length;
  await sleep(500);
  assert.equal((await placed()).length, n, 'A16b: nothing sent while nothing changes');

  // A16c: never the text search
  assert.equal((await own({ ask: 'tags' })).n, 0, 'A16c: no getElementsByTagName call');

  // A16d: the pins' watch list is the pins' own
  const rectsMsgs = async () => (await said()).filter((x) => x.type === 'rects');
  let rs = await rectsMsgs();
  assert.equal(rs[rs.length - 1].id, 'r1', 'A16d: no rects since the pins\' own');
  const before = rs.length;
  await own({ ask: 'text' });
  await soonIn(p, 2000)(`window.__heard.filter((h) => h.data && h.data.lens === 1 && h.data.type === 'rects').length > ${before}`, 'A16d: rects after a text change, in 2 s');
  rs = (await rectsMsgs()).slice(before);
  const un = rs.find((x) => x.id === undefined);
  assert.ok(un, 'A16d: rects unasked');
  assert.deepEqual(un.rects.map((r) => r.key), ['t-1'], 'A16d: the watch list as resolve left it');
  assert.deepEqual([un.rects[0].text, un.rects[0].changed], ['A2', true]);
  n = (await placed()).length;
  await ask({ lens: 1, type: 'place', anchors: [] });
  m = await nth(n + 1, 'A16d: placed for an empty list');
  assert.deepEqual(m.rects, [], 'A16d: an empty list, answered');
  n = (await placed()).length;
  await own({ ask: 'move', n: 30 });
  await sleep(300);
  assert.equal((await placed()).length, n, 'A16d: stopped: nothing while #mover moves');
});

// The lens's script, run in vm against a stand-in page (as test/dashboard.test.mjs's artLensRun): its
// window listeners, what it posts to its parent, and timers that never fire.
function lensInVm({ doc: docOver = {}, win: winOver = {} } = {}) {
  const src = fs.readFileSync(path.join(kit, 'scripts/devteam.mjs'), 'utf8');
  const script = /const ARTIFACT_LENS = String\.raw`([^`]*)`;/.exec(src)[1];
  const ancestor = 'http://127.0.0.1:4321';
  const listeners = {};
  const posted = [];
  const parent = { postMessage: (m) => posted.push(JSON.parse(JSON.stringify(m))) };
  const doc = { title: 'A mock', documentElement: {}, body: {}, elementFromPoint: () => null, querySelectorAll: () => [], querySelector: () => null, getElementsByTagName: () => [], getElementById: () => null, ...docOver };
  const win = {
    document: doc, parent, innerWidth: 800, innerHeight: 600,
    location: { pathname: '/artifact/main/lens-mock/index.html', ancestorOrigins: [ancestor] },
    addEventListener: (type, f) => { (listeners[type] ??= []).push(f); },
    setInterval: () => 0, setTimeout: () => 0, clearTimeout: () => {}, requestAnimationFrame: () => 0,
    MutationObserver: class { observe() {} }, TextEncoder, CSS: { escape: (s) => s },
    ...winOver,
  };
  win.window = win;
  vm.runInNewContext(script, win);
  const fire = (type, e) => { for (const f of listeners[type] ?? []) f(e); };
  const hear = (data) => fire('message', { data, source: parent, isTrusted: true, origin: ancestor });
  hear({ lens: 1, type: 'hello' });
  return { posted, fire, hear };
}
// an element with no id, class or siblings: its selector is a path of one step
const fakeDiv = (width, height) => ({ nodeType: 1, localName: 'div', id: '', getAttribute: () => null, classList: [], previousElementSibling: null, parentElement: null, getBoundingClientRect: () => ({ left: 0, top: 0, width, height }) });

test('presence A15f: pointer fractions are clamped to 0..1 and rounded to 4 decimals', () => {
  const cases = [
    [fakeDiv(3, 3), 1, 1, { x: 0.3333, y: 0.3333 }, 'a third across, to 4 decimals'],
    [fakeDiv(3, 3), -5, 10, { x: 0, y: 1 }, 'outside the element: clamped to 0..1'],
    [fakeDiv(0, 3), 1, 1, { x: 0, y: 0.3333 }, 'a zero width: 0'],
  ];
  for (const [target, clientX, clientY, want, what] of cases) {
    const { posted, fire } = lensInVm();
    fire('mousemove', { target, clientX, clientY });
    const ptr = posted.filter((m) => m.type === 'pointer');
    assert.deepEqual(ptr, [{ lens: 1, type: 'pointer', k: 'div:nth-of-type(1)', ...want }], what);
  }
});

test('presence A16e: place measures on animation frames', () => {
  // frames run only when the test runs them; timers are recorded and never fire
  const frames = [];
  const timers = [];
  let rect = { left: 10, top: 20, width: 30, height: 40 };
  const el = { nodeType: 1, checkVisibility: () => true, getBoundingClientRect: () => rect };
  const { posted, hear } = lensInVm({
    doc: { querySelector: (k) => (k === '#x' ? el : null) },
    win: { requestAnimationFrame: (f) => { frames.push(f); return frames.length; }, setTimeout: (f, ms) => { timers.push(ms); return timers.length; } },
  });
  const placed = () => posted.filter((m) => m.type === 'placed');
  const frame = () => frames.shift()();
  const timersBefore = timers.length;
  hear({ lens: 1, type: 'place', anchors: [{ id: 'a', k: '#x' }] });
  assert.deepEqual(placed(), [{ lens: 1, type: 'placed', rects: [{ id: 'a', rect: { x: 10, y: 20, w: 30, h: 40 } }] }], 'answered at once');
  assert.equal(frames.length, 1, 'one frame asked for');
  assert.equal(timers.length, timersBefore, 'no timer: frames only');
  frame();
  assert.equal(placed().length, 1, 'nothing changed: nothing sent');
  assert.equal(frames.length, 1, 'the next frame asked for');
  rect = { left: 11, top: 20, width: 30, height: 40 };
  frame();
  assert.deepEqual(placed().slice(1), [{ lens: 1, type: 'placed', rects: [{ id: 'a', rect: { x: 11, y: 20, w: 30, h: 40 } }] }], 'a change: sent on its frame');
  assert.equal(frames.length, 1);
  hear({ lens: 1, type: 'place', anchors: [] });
  assert.deepEqual(placed().slice(2), [{ lens: 1, type: 'placed', rects: [] }], 'an empty list, answered');
  assert.equal(frames.length, 1, 'no second loop');
  frame();
  assert.equal(frames.length, 0, 'the loop has stopped');
  assert.equal(placed().length, 3);
  assert.equal(timers.length, timersBefore, 'never a timer');
});
