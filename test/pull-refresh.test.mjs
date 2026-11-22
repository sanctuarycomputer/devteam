// Pull to refresh on a phone (kit-759): at the top of the page, a finger dragged down shows a spinner
// that follows it with resistance; let go past the threshold, the dashboard reads its data again at
// once (load({ force: true })), the spinner spins until the read lands, then slides away. Real touch
// events in headless Chrome (Input.dispatchTouchEvent, touch emulation on) at 390x844.
// Ports: none of its own (dashboardOnFreePort, and port 0 for the stand-in hub).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { dashboardOnFreePort, kit, threadsFixture } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { FRAMES, soonIn } from './lib/dashboard-page.mjs';

const CHROME = { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 240000 };

// Before the page's own script: its 10 s polls never fire (so every /api/data read is one this test
// caused), each /api/data read is counted and timed, and a read waits while window.__hold is set, so a
// refresh can be held in flight. The last finger lifted is timed. __watchAway() records the spinner
// every frame until it is hidden: how it leaves. The page is made tall enough to scroll.
const INIT = `(() => {
  const si = window.setInterval;
  window.setInterval = (f, ms, ...a) => (ms === 10000 ? 0 : si(f, ms, ...a));
  window.__dataReads = 0;
  window.__hold = null;
  const f0 = window.fetch;
  window.fetch = async (u, o) => {
    if (String(u).startsWith('/api/data')) { window.__dataReads++; window.__readAt = performance.now(); if (window.__hold) await window.__hold.p; }
    return f0(u, o);
  };
  window.__holdOn = () => { let r; const p = new Promise((x) => { r = x; }); window.__hold = { p, r }; };
  window.__holdOff = () => { const h = window.__hold; window.__hold = null; h?.r(); };
  document.addEventListener('touchend', () => { window.__liftAt = performance.now(); }, true);
  window.__watchAway = () => {
    window.__away = [];
    const e = document.getElementById('pull-refresh');
    const f = () => { const r = e.getBoundingClientRect(); window.__away.push({ hidden: e.hidden, bottom: Math.round(r.bottom), opacity: Number(getComputedStyle(e).opacity) }); if (!e.hidden && window.__away.length < 600) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  };
  document.addEventListener('DOMContentLoaded', () => { document.body.style.minHeight = '3000px'; });
})();`;

// the spinner, as the page shows it: null when there is none or it is hidden
// (spin: its ring's turn period, as computed: '0.7s', or '2.5s' with reduced motion)
const SPIN = `(() => { const e = document.getElementById('pull-refresh'); if (!e || e.hidden || getComputedStyle(e).display === 'none' || getComputedStyle(e).visibility === 'hidden') return null; const r = e.getBoundingClientRect(); return { bottom: Math.round(r.bottom), opacity: Number(getComputedStyle(e).opacity), spinning: e.classList.contains('spinning'), spin: e.firstElementChild ? getComputedStyle(e.firstElementChild).animationDuration : null }; })()`;
// the spinner's frames from __watchAway, the visible ones, until it was hidden
const awayFrames = async (p, soon) => { await soon(`window.__away.length > 0 && window.__away[window.__away.length - 1].hidden`, 'the spinner hidden'); return (await p.ev('window.__away')).filter((x) => !x.hidden); };

// where the page's own boxes are: a pull moves none of them
const PLACES = `['.pagebar', '.side', 'main'].map((q) => { const r = document.querySelector(q).getBoundingClientRect(); return [q, Math.round(r.top), Math.round(r.left), Math.round(r.height)]; })`;

async function setup(t, { reduce = false } = {}) {
  const later = cleanup(t);
  const F = threadsFixture('pull-refresh');
  later(() => F.done());
  const { dash, port } = await dashboardOnFreePort(F.old, F.env());
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  if (reduce) await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: INIT });
  const B = `http://127.0.0.1:${port}`;
  const soon = soonIn(p, 30000, () => dash.out());
  return { p, B, soon, port, chrome, later, F };
}

// A finger down at (x, y), moved dy down in steps, then lifted unless held. touch(p, ...) drives the
// page (or, in the hub, the frame under the point: Chrome hit-tests a touch like a click).
const touch = (p, type, x, y) => p.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
async function pull(p, { x = 195, y = 200, dy = 220, steps = 12, lift = true } = {}) {
  await touch(p, 'touchStart', x, y);
  for (let i = 1; i <= steps; i++) await touch(p, 'touchMove', x, y + Math.round((dy * i) / steps));
  if (lift) await touch(p, 'touchEnd', x, y + dy);
}
const reads = (p) => p.ev('window.__dataReads');
// when no spinner shows: the scroll, a read in flight, and what is under the finger, up to the page
const WHY = `(() => { const out = []; for (let e = document.elementFromPoint(195, 200); e && e !== document.body; e = e.parentElement) { const s = getComputedStyle(e); out.push(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + ' ' + s.position + ' ' + s.overflowY); } return JSON.stringify({ scrollY, loading: !!loading, under: out }); })()`;
// the page drawn and its first read landed; nothing in flight
const ready = (p, soon) => soon(`typeof DATA === 'object' && DATA !== null && !loading && window.__dataReads >= 1`, 'the dashboard drawn');
// a short wait for a read that should not come
// PULL_REFRESH_SHOTS=<dir>: a 390 px screenshot of mid-pull and of the spinning state go there (the PR's pictures)
const SHOTS = process.env.PULL_REFRESH_SHOTS || null;
const shot = async (p, name) => { if (!SHOTS) return; const { data } = await p.send('Page.captureScreenshot', { format: 'png' }); fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(data, 'base64')); };
const settle = (ms = 800) => new Promise((r) => setTimeout(r, ms));
// each check from rest: no read held, nothing the last check added, the page at the top, no spinner,
// no read in flight (a check that failed part way leaves none of its state to the next)
const fresh = async (p, soon) => {
  await touch(p, 'touchEnd', 0, 0).catch(() => {});
  await p.ev(`(() => { window.__holdOff(); document.querySelectorAll('[data-probe]').forEach((e) => e.remove()); scrollTo(0, 0); return true; })()`);
  await soon(`${SPIN} === null && !loading && scrollY === 0`, 'at rest, nothing in flight');
};

test('pull to refresh: past the threshold reads at once, spins until the read lands, then goes; short of it reads nothing', CHROME, async (t) => {
  const { p, B, soon } = await setup(t);
  await p.send('Page.navigate', { url: `${B}/#overview` });
  await ready(p, soon);
  t.beforeEach(() => fresh(p, soon));

  await t.test('mid-pull: the spinner follows the finger, with resistance that grows', async () => {
    assert.equal(await p.ev(SPIN), null, 'no spinner before a pull');
    const before = await p.ev(PLACES);
    // the finger at 60, 120, 180 and 240 px down, one touch: where the spinner's bottom is at each
    const at = [];
    await touch(p, 'touchStart', 195, 200);
    for (let dy = 10; dy <= 240; dy += 10) {
      await touch(p, 'touchMove', 195, 200 + dy);
      // at 200 px of finger: the page under the spinner where it was, and the mid-pull picture
      if (dy === 200) { await p.ev(FRAMES); assert.deepEqual(await p.ev(PLACES), before, 'the page under the spinner has not moved'); await shot(p, 'mid-pull-390.png'); }
      if (dy % 60) continue;
      await p.ev(FRAMES);
      const s = await p.ev(SPIN);
      assert.ok(s, `a spinner shows mid-pull (finger at ${dy} px)`);
      at.push(s.bottom);
    }
    const step = at.slice(1).map((b, i) => b - at[i]);
    assert.ok(step.every((d) => d > 0), `it follows the finger down (bottoms ${at.join(', ')})`);
    assert.ok(step.every((d, i) => d < 60 && (i === 0 || d < step[i - 1])), `each 60 px of finger moves it less than the last (${step.join(', ')} px)`);
    await touch(p, 'touchEnd', 195, 440);
    await soon(`${SPIN} === null && !loading`, 'that pull over');
  });

  // 90 px of finger: past the threshold (about 70 px), not far past it
  await t.test('released past the threshold: one read at once, the spinner spins until it lands, then slides away', async () => {
    const n0 = await reads(p);
    await p.ev('window.__holdOn()');
    await pull(p, { dy: 90 });
    await soon(`window.__dataReads === ${n0 + 1}`, 'a read');
    const late = await p.ev('window.__readAt - window.__liftAt');
    assert.ok(late < 500, `the read starts at once on release (${Math.round(late)} ms after)`);
    // held well past every transition the spinner has: still there, still spinning
    await settle(1500);
    const s = await p.ev(SPIN);
    assert.ok(s && s.spinning && s.opacity === 1, `the spinner spins while the read is in flight (${JSON.stringify(s)})`);
    assert.equal(s.spin, '0.7s', 'at its full pace');
    await shot(p, 'spinning-390.png');
    assert.equal(await p.ev(`location.href`), `${B}/#overview`, 'no page reload');
    await p.ev('window.__watchAway(); window.__holdOff()');
    const f = await awayFrames(p, soon);
    // from its rest to where it ends, never going down, through two or more frames between the two: a
    // slide, not a jump
    const rest = f[0].bottom, end = f[f.length - 1].bottom;
    const down = f.slice(1).every((x, i) => x.bottom <= f[i].bottom);
    const between = f.filter((x) => x.bottom < rest && x.bottom > end).length;
    assert.ok(down && rest - end >= 20 && between >= 2, `it slides up over several frames, then hides (${JSON.stringify(f.map((x) => x.bottom))})`);
    assert.equal(await reads(p), n0 + 1, 'exactly one read');
    assert.equal(await p.ev('typeof window.__holdOn'), 'function', 'the same document: no full page reload');
  });

  await t.test('released short of the threshold: snaps back, reads nothing', async () => {
    const n0 = await reads(p);
    await pull(p, { dy: 50 });
    await soon(`${SPIN} === null`, 'the spinner gone');
    await settle();
    assert.equal(await reads(p), n0, 'no read');
  });

  await t.test('a second pull while a refresh is in flight starts no second read', async () => {
    const n0 = await reads(p);
    await p.ev('window.__holdOn()');
    await pull(p, { dy: 220 });
    await soon(`window.__dataReads === ${n0 + 1}`, 'the first read');
    await pull(p, { dy: 220 });
    await settle();
    assert.equal(await reads(p), n0 + 1, 'still one read');
    await p.ev('window.__holdOff()');
    await soon(`${SPIN} === null && !loading`, 'the refresh over');
    await settle();
    assert.equal(await reads(p), n0 + 1, 'no read queued behind it');
  });

  await t.test('a second finger mid-pull cancels it: no read, the spinner goes, the next pull works', async () => {
    const n0 = await reads(p);
    await pull(p, { dy: 220, lift: false });
    await p.ev(FRAMES);
    assert.ok(await p.ev(SPIN), 'a spinner mid-pull');
    await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 420, id: 1 }, { x: 100, y: 500, id: 2 }] });
    await touch(p, 'touchEnd', 195, 420);
    await soon(`${SPIN} === null && pullRefresh.state() === 'idle'`, 'the spinner gone, the pull over');
    await settle();
    assert.equal(await reads(p), n0, 'no read');
    await pull(p, { dy: 220 });
    await soon(`window.__dataReads === ${n0 + 1}`, 'the next pull reads');
  });

  // a redraw can replace the element the finger started on; its touch events then stop reaching document
  const UNDER = `(() => { const d = document.createElement('div'); d.dataset.probe = '1'; d.id = 'pull-gone'; d.style.cssText = 'position:absolute;top:150px;left:0;width:390px;height:150px;z-index:50'; document.body.append(d); return true; })()`;
  await t.test('the touched element removed mid-pull: the pull still follows and refreshes', async () => {
    const n0 = await reads(p);
    await p.ev(UNDER);
    await pull(p, { dy: 120, lift: false });
    await p.ev(FRAMES);
    const a = await p.ev(SPIN);
    assert.ok(a, 'a spinner mid-pull');
    await p.ev(`document.getElementById('pull-gone').remove(), true`);
    await touch(p, 'touchMove', 195, 420);
    await p.ev(FRAMES);
    const b = await p.ev(SPIN);
    assert.ok(b && b.bottom > a.bottom, 'it still follows the finger');
    await touch(p, 'touchEnd', 195, 420);
    await soon(`window.__dataReads === ${n0 + 1}`, 'the release refreshes');
    await soon(`${SPIN} === null && pullRefresh.state() === 'idle'`, 'the spinner gone');
    await pull(p, { dy: 220 });
    await soon(`window.__dataReads === ${n0 + 2}`, 'the next pull reads');
  });

  await t.test('the touched element removed mid-pull and the touch cancelled: no read, the spinner goes', async () => {
    const n0 = await reads(p);
    await p.ev(UNDER);
    await pull(p, { dy: 220, lift: false });
    await p.ev(FRAMES);
    assert.ok(await p.ev(SPIN), 'a spinner mid-pull');
    await p.ev(`document.getElementById('pull-gone').remove(), true`);
    await p.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await soon(`${SPIN} === null && pullRefresh.state() === 'idle'`, 'the spinner gone');
    await settle();
    assert.equal(await reads(p), n0, 'no read');
    await pull(p, { dy: 220 });
    await soon(`window.__dataReads === ${n0 + 1}`, 'the next pull reads');
  });

  await t.test('scrolled down: a pull scrolls, reads nothing', async () => {
    await p.ev('scrollTo(0, 400)');
    const n0 = await reads(p);
    await pull(p, { dy: 220 });
    await settle();
    assert.equal(await p.ev(SPIN), null, 'no spinner');
    assert.equal(await reads(p), n0, 'no read');
  });

  await t.test('inside a box that scrolls: reads nothing', async () => {
    await p.ev(`(() => { const d = document.createElement('div'); d.id = 'scroller'; d.dataset.probe = ''; d.style.cssText = 'position: absolute; top: 120px; left: 20px; width: 300px; height: 300px; overflow: auto; z-index: 50; background: #fff'; d.innerHTML = '<div style="height: 2000px">tall</div>'; document.body.append(d); return true; })()`);
    const n0 = await reads(p);
    await pull(p, { x: 150, y: 200, dy: 220 });
    await settle();
    assert.equal(await p.ev(SPIN), null, 'no spinner');
    assert.equal(await reads(p), n0, 'no read');
  });

  await t.test('on a text field: reads nothing', async () => {
    await p.ev(`(() => { const i = document.createElement('input'); i.id = 'field'; i.dataset.probe = ''; i.style.cssText = 'position: absolute; top: 160px; left: 20px; width: 300px; height: 60px; z-index: 50'; document.body.append(i); return true; })()`);
    const n0 = await reads(p);
    await pull(p, { x: 150, y: 190, dy: 220 });
    await settle();
    assert.equal(await reads(p), n0, 'no read');
  });

  await t.test('on a canvas: reads nothing', async () => {
    await p.ev(`(() => { const c = document.createElement('canvas'); c.id = 'cv'; c.dataset.probe = ''; c.style.cssText = 'position: absolute; top: 120px; left: 20px; width: 300px; height: 200px; z-index: 50'; document.body.append(c); return true; })()`);
    const n0 = await reads(p);
    await pull(p, { x: 150, y: 200, dy: 220 });
    await settle();
    assert.equal(await reads(p), n0, 'no read');
  });

  // a frame is a document of its own: its touches never reach this page's listeners at all
  await t.test('on a frame: reads nothing', async () => {
    await p.ev(`(() => { const f = document.createElement('iframe'); f.id = 'fr'; f.dataset.probe = ''; f.srcdoc = '<p style="height: 2000px">a frame</p>'; f.style.cssText = 'position: absolute; top: 120px; left: 20px; width: 300px; height: 300px; z-index: 50; border: 0'; document.body.append(f); return new Promise((r) => f.addEventListener('load', () => r(true))); })()`);
    const n0 = await reads(p);
    await pull(p, { x: 150, y: 200, dy: 220 });
    await settle();
    assert.equal(await reads(p), n0, 'no read');
  });

  await t.test('a swipe across, not down: reads nothing', async () => {
    const n0 = await reads(p);
    // leftward: a swipe right from the edge is the browser's own Back
    await touch(p, 'touchStart', 330, 200);
    for (let i = 1; i <= 12; i++) await touch(p, 'touchMove', 330 - i * 22, 200 + i * 15);
    await touch(p, 'touchEnd', 66, 380);
    await settle();
    assert.equal(await p.ev(SPIN), null, 'no spinner');
    assert.equal(await reads(p), n0, 'no read');
  });

  await t.test('with a mouse: reads nothing', async () => {
    const n0 = await reads(p);
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 195, y: 200, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 12; i++) await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 195, y: 200 + i * 20, button: 'left', buttons: 1 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 195, y: 440, button: 'left', buttons: 0, clickCount: 1 });
    await settle();
    assert.equal(await reads(p), n0, 'no read');
  });

  await t.test('in the open Threads panel: reads nothing', async () => {
    await p.send('Page.navigate', { url: `${B}/#questions` });
    await soon(`document.body.classList.contains('threads-open') && getComputedStyle(document.getElementById('threads')).transform === 'none' && typeof DATA === 'object' && DATA !== null && !loading`, 'the panel open, at rest');
    const n0 = await reads(p);
    await pull(p, { dy: 220 });
    await settle();
    assert.equal(await reads(p), n0, 'no read');
  });
});

// Reduced motion drops the motion (the follow, the slide), keeps the refresh, and spins at the kit's
// slow 2.5 s, as its busy buttons do (index.html: button.busy under prefers-reduced-motion).
test('pull to refresh with reduced motion: the spinner keeps still and leaves without sliding, the refresh still happens', CHROME, async (t) => {
  const { p, B, soon } = await setup(t, { reduce: true });
  await p.send('Page.navigate', { url: `${B}/#overview` });
  await ready(p, soon);
  await fresh(p, soon);
  const n0 = await reads(p);
  await p.ev('window.__holdOn()');
  await pull(p, { dy: 100, lift: false });
  await p.ev(FRAMES);
  const a = await p.ev(SPIN);
  await touch(p, 'touchMove', 195, 400);
  await p.ev(FRAMES);
  const b = await p.ev(SPIN);
  assert.ok(a && b, `a spinner shows (${await p.ev(WHY)})`);
  assert.equal(b.bottom, a.bottom, 'it does not follow the finger');
  await touch(p, 'touchEnd', 195, 400);
  await soon(`window.__dataReads === ${n0 + 1}`, 'the read');
  await p.ev(FRAMES);
  const s = await p.ev(SPIN);
  assert.ok(s && s.spinning, 'it spins while the read is in flight');
  assert.equal(s.bottom, a.bottom, 'where it was: no move to its rest');
  assert.equal(s.spin, '2.5s', "at the kit's slow pace");
  await p.ev('window.__watchAway(); window.__holdOff()');
  const f = await awayFrames(p, soon);
  assert.ok(f.every((x) => x.bottom === a.bottom), `it leaves without moving (${JSON.stringify(f.map((x) => x.bottom))})`);
  // the frames before the read settled show it at rest (opacity 1); once it leaves, at most one frame
  // can show it on its way (opacity under 1) before it is hidden: no fade
  const fading = f.filter((x) => x.opacity < 1);
  assert.ok(fading.length <= 1, `and at once, with no transition (${JSON.stringify(fading)} shown fading)`);
});

// The hub frames the dashboard (hub.html: html, body { overscroll-behavior: none }, the frame filling
// the page); the pull is the dashboard document's own, so it works there too. The real hub.html,
// served by a stand-in hub on the port the dashboard lets frame it (frame-ancestors).
test('pull to refresh in the hub\'s frame', CHROME, async (t) => {
  const later = cleanup(t);
  const F = threadsFixture('pull-refresh-hub');
  later(() => F.done());
  let hello = null;
  const hub = http.createServer((q, s) => {
    const u = new URL(q.url, 'http://x');
    if (u.pathname === '/') { s.writeHead(200, { 'content-type': 'text/html' }); return s.end(fs.readFileSync(path.join(kit, 'dashboard', 'hub.html'), 'utf8')); }
    if (u.pathname === '/instances.json') { s.writeHead(200, { 'content-type': 'application/json' }); return s.end(JSON.stringify({ hub: 1, kit: 'v0.57.0', instances: [hello] })); }
    s.writeHead(404, { 'content-type': 'application/json' });
    s.end('{}');
  });
  await new Promise((r) => hub.listen(0, '127.0.0.1', r));
  later(() => new Promise((r) => { hub.closeAllConnections?.(); hub.close(() => r()); }));
  const HUB = hub.address().port;
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({ DEVTEAM_HUB_PORT: String(HUB) }));
  later(() => dash.stop());
  hello = { devteam: 1, name: 'alpha', root: F.old, port, kit: 'v0.57.0', viewer: 1, inbox: 0, threads: { you: 0, waiting: 0, ready: 0 }, fleet: { mode: 'run', workers: 0 }, pulse: null };
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: INIT });
  await p.send('Page.navigate', { url: `http://127.0.0.1:${HUB}/` });
  const soon = soonIn(p, 60000);
  await soon(`[...document.querySelectorAll('#tabs [role=tab]')].some((x) => x.textContent.startsWith('alpha'))`, "alpha's tab");
  await p.ev(`[...document.querySelectorAll('#tabs [role=tab]')].find((x) => x.textContent.startsWith('alpha')).click()`);
  const D = `http://127.0.0.1:${port}`;
  const inFrame = (expr) => p.evIn(D, expr).catch(() => false);
  await soon(`document.querySelectorAll('iframe:not([hidden])').length === 1`, "alpha's frame");
  const end = Date.now() + 60000;
  while (!(await inFrame(`typeof DATA === 'object' && DATA !== null && !loading && window.__dataReads >= 1`))) { if (Date.now() > end) assert.fail('the framed dashboard never drew'); await settle(100); }
  await inFrame('scrollTo(0, 0), true');
  while (!(await inFrame('scrollY === 0 && !loading'))) { if (Date.now() > end) assert.fail('the framed dashboard never came to rest at its top'); await settle(100); }
  // the frame's top, in the hub page's coordinates
  const top = await p.ev(`Math.round(document.querySelector('iframe:not([hidden])').getBoundingClientRect().top)`);
  const n0 = await inFrame('window.__dataReads');
  await pull(p, { y: top + 150, dy: 220 });
  const end2 = Date.now() + 15000;
  while ((await inFrame('window.__dataReads')) !== n0 + 1) { if (Date.now() > end2) assert.fail(`no read in the frame after a pull (reads ${await inFrame('window.__dataReads')}, was ${n0})`); await settle(100); }
});
