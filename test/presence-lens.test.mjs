// The artifact lens's presence messages (presence@1 §10): pointer, and place/placed, in real Chrome.
// A fixture artifact framed in a real dashboard, a real mouse for every move, and the artifact's own
// script answering { ask } probes, since an opaque-origin frame is out of the test's reach.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { write, dashboardOnFreePort, threadsFixture } from './lib/kit.mjs';
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
//   tags           -> { n }, getElementsByTagName calls so far
//   move { n }     -> { frames: n }, once #mover has moved 1 px a frame for n frames
//   text           -> {}, once #a reads "A2"
const OWN_SCRIPT = [
  '(function () {',
  '  window.__tags = 0;',
  '  var byTag = Document.prototype.getElementsByTagName;',
  '  Document.prototype.getElementsByTagName = function () { window.__tags++; return byTag.apply(this, arguments); };',
  '  var lastTarget = null;',
  '  addEventListener("mousemove", function (e) { lastTarget = e.target; }, true);',
  '  var say = function (ask, o) { var m = { own: 1, ask: ask }; for (var k in o) m[k] = o[k]; parent.postMessage(m, "*"); };',
  '  var round = function (r) { return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };',
  '  addEventListener("message", function (e) {',
  '    var d = e.data;',
  '    if (!d || typeof d.ask !== "string") return;',
  '    if (d.ask === "rect") { var el = document.querySelector(d.sel); say("rect", { rect: el ? round(el.getBoundingClientRect()) : null }); }',
  '    else if (d.ask === "is") { var same = false; try { same = document.querySelector(d.k) === document.querySelector(d.sel); } catch (err) { same = false; } say("is", { is: same }); }',
  '    else if (d.ask === "leave") { (lastTarget || document.documentElement).dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: null })); say("leave", {}); }',
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
const within = (got, what) => {
  const n = got.length;
  const secs = n > 1 ? (got[n - 1].at - got[0].at) / 1000 : 0;
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

  // A15c: 40 moves across #box, 25 ms apart: throttled, and the last position arrives
  let from = (await ptr()).length;
  for (let i = 0; i < 40; i++) {
    await mouse(101 + (198 * i) / 39, 110 + (80 * i) / 39);
    await sleep(25);
  }
  await sleep(300);
  let got = (await ptr()).slice(from);
  within(got, 'A15c');
  assert.ok(got.length >= 5, `A15c: ${got.length} pointers for 40 moves: it follows the mouse`);
  assert.deepEqual(bare(got[got.length - 1]), { lens: 1, type: 'pointer', k: '#box', x: 0.995, y: 0.9 }, 'A15c: the last move is the last word');

  // A15e: 20 alternations between #box and a leave: nulls pass the same gate, and the leave is last
  from = (await ptr()).length;
  for (let i = 0; i < 20; i++) {
    if (i % 2 === 0) await mouse(150, 125); else await own({ ask: 'leave' });
    await sleep(25);
  }
  await sleep(300);
  got = (await ptr()).slice(from);
  within(got, 'A15e');
  assert.ok(got.length, 'A15e: something said');
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
