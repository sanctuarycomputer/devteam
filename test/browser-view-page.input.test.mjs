// The live browser view page (docs/devteam/dashboard/browser.html) in real Chrome: the owner's input,
// and the address bar, Back and Sign out of everything (Tasks 2 and 3), against the fake socket server
// of test/lib/browser-view-page-fixture.mjs; split from test/browser-view-page.test.mjs (kit-223) so each
// file stays inside CI's per-file watchdog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDrive } from './lib/chrome.mjs';
import { SMALL, BIG, sleep, until, startServer, shut, canvasState, drawn, text, noHandBack, ready, pt, sent, mouse, keyEvent, clip, ctrlV, go, viewPageFile } from './lib/browser-view-page-fixture.mjs';

const near = (m, want, what) => { assert.ok(Math.abs(m.x - want.fx) <= 1 && Math.abs(m.y - want.fy) <= 1, `${what}: (${m.x}, ${m.y}) is (${want.fx}, ${want.fy})`); };

// CI's Node 22 and 24 jobs have Chrome: there the test must run, never skip.
const mustRun = !!process.env.CI && Number(process.versions.node.split('.')[0]) >= 22;
const skip = canDrive ? false : 'needs Chrome and a Node with WebSocket';
viewPageFile();

if (mustRun && !canDrive) test('Chrome is needed on CI\'s Node 22+', () => assert.fail('Chrome is needed on CI\'s Node 22+: this test must run there, not skip'));

// ----- Task 2: the owner's input ----------------------------------------------------------------

test('a click, a double click and a Shift+click each send one click, at the frame\'s point', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c, s } = await ready(srv, { width: 700, height: 700 });
  try {
    assert.notEqual(Math.round(s.width), 320, 'the canvas is shown at another size than the frame');
    const a = pt(s, 0.25, 0.5);
    let got = await sent(c, () => p.clickAt(a.x, a.y));
    assert.equal(got.length, 1, JSON.stringify(got));
    assert.equal(got[0].t, 'mouse'); assert.equal(got[0].type, 'click'); assert.equal(got[0].button, 'left'); assert.equal(got[0].clicks, 1);
    assert.equal(got[0].mods, undefined);
    near(got[0], a, 'the click');
    await sleep(600); // past the double-click window
    const b = pt(s, 0.75, 0.25);
    got = await sent(c, async () => { await p.clickAt(b.x, b.y); await p.clickAt(b.x, b.y); });
    got = got.filter((m) => !(m.type === 'move' && m.button === 'none')); // the helper's travel before its second press
    assert.deepEqual(got.map((m) => [m.type, m.clicks]), [['click', 1], ['click', 2]], 'the page counts the second click of a double click');
    near(got[1], b, 'the double click');
    await sleep(600);
    got = await sent(c, async () => { await p.hold('Shift', true); await p.clickAt(a.x, a.y, 8); await p.hold('Shift', false); });
    assert.deepEqual(got.map((m) => [m.t, m.type, m.mods]), [['mouse', 'click', 8]], 'Shift itself sends nothing; the click carries it');
  } finally { await shut(p); await srv.close(); }
});

test('a drag sends down, moves with its button, and up; a Shift+drag carries Shift on each', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c, s } = await ready(srv, { width: 700, height: 700 });
  try {
    const a = pt(s, 0.2, 0.2), b = pt(s, 0.6, 0.7);
    const drag = (mods = 0) => async () => {
      await mouse(p, 'mouseMoved', a, { modifiers: mods });
      await mouse(p, 'mousePressed', a, { button: 'left', buttons: 1, clickCount: 1, modifiers: mods });
      await mouse(p, 'mouseMoved', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, { button: 'left', buttons: 1, modifiers: mods });
      await sleep(50);
      await mouse(p, 'mouseMoved', b, { button: 'left', buttons: 1, modifiers: mods });
      await mouse(p, 'mouseReleased', b, { button: 'left', buttons: 0, clickCount: 1, modifiers: mods });
    };
    let got = await sent(c, drag());
    assert.equal(got[0].type, 'down'); near(got[0], a, 'the down, at the press');
    assert.equal(got.at(-1).type, 'up'); near(got.at(-1), b, 'the up, at the release');
    const moves = got.slice(1, -1);
    assert.ok(moves.length >= 1 && moves.every((m) => m.type === 'move' && m.button === 'left'), JSON.stringify(got));
    assert.ok(got.every((m) => m.mods === undefined));
    got = await sent(c, async () => { await p.hold('Shift', true); await drag(8)(); await p.hold('Shift', false); });
    assert.deepEqual([got[0].type, got.at(-1).type], ['down', 'up']);
    assert.ok(got.every((m) => m.t === 'mouse' && m.mods === 8), JSON.stringify(got));
  } finally { await shut(p); await srv.close(); }
});

test('a wheel turn sends one wheel, and the page itself doesn\'t scroll', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c, s } = await ready(srv, { width: 700, height: 700 });
  try {
    const a = pt(s, 0.5, 0.5);
    const got = await sent(c, () => mouse(p, 'mouseWheel', a, { deltaX: 0, deltaY: 120 }));
    assert.deepEqual(got.map((m) => [m.t, m.dx, m.dy]), [['wheel', 0, 120]]);
    near(got[0], a, 'the wheel');
    assert.ok((await p.ev('window.__prevented')).some((e) => e.t === 'wheel' && e.prevented));
  } finally { await shut(p); await srv.close(); }
});

test('typed text, Enter, AltGr, Backspace and Ctrl+A each send what the spec says', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c } = await ready(srv);
  try {
    let got = await sent(c, () => p.type('ab'));
    assert.deepEqual(got, [{ t: 'key', type: 'press', key: 'a', code: 'KeyA', text: 'a' }, { t: 'key', type: 'press', key: 'b', code: 'KeyB', text: 'b' }]);
    got = await sent(c, async () => { await keyEvent(p, 'keyDown', 'Enter', 'Enter', { windowsVirtualKeyCode: 13 }); await keyEvent(p, 'keyUp', 'Enter', 'Enter', { windowsVirtualKeyCode: 13 }); });
    assert.deepEqual(got, [{ t: 'key', type: 'press', key: 'Enter', code: 'Enter', text: '\r' }]);
    // AltGr on Windows is Ctrl and Alt together: how @ is typed on many layouts
    got = await sent(c, async () => { await keyEvent(p, 'keyDown', '@', 'KeyQ', { text: '@', modifiers: 3, windowsVirtualKeyCode: 81 }); await keyEvent(p, 'keyUp', '@', 'KeyQ', { modifiers: 3, windowsVirtualKeyCode: 81 }); });
    assert.deepEqual(got, [{ t: 'key', type: 'press', key: '@', code: 'KeyQ', text: '@' }]);
    // Ctrl+Alt on the letter itself is a chord, on any platform
    got = await sent(c, async () => { await keyEvent(p, 'rawKeyDown', 'q', 'KeyQ', { modifiers: 3, windowsVirtualKeyCode: 81 }); await keyEvent(p, 'keyUp', 'q', 'KeyQ', { modifiers: 3, windowsVirtualKeyCode: 81 }); });
    assert.deepEqual(got, [{ t: 'key', type: 'down', key: 'q', code: 'KeyQ', mods: 3 }, { t: 'key', type: 'up', key: 'q', code: 'KeyQ' }]);
    got = await sent(c, async () => { await keyEvent(p, 'rawKeyDown', 'Backspace', 'Backspace', { windowsVirtualKeyCode: 8 }); await keyEvent(p, 'keyUp', 'Backspace', 'Backspace', { windowsVirtualKeyCode: 8 }); });
    assert.deepEqual(got, [{ t: 'key', type: 'down', key: 'Backspace', code: 'Backspace' }, { t: 'key', type: 'up', key: 'Backspace', code: 'Backspace' }]);
    got = await sent(c, async () => { await p.hold('Control', true); await keyEvent(p, 'rawKeyDown', 'a', 'KeyA', { modifiers: 2, windowsVirtualKeyCode: 65 }); await keyEvent(p, 'keyUp', 'a', 'KeyA', { modifiers: 2, windowsVirtualKeyCode: 65 }); await p.hold('Control', false); });
    assert.deepEqual(got, [{ t: 'key', type: 'down', key: 'a', code: 'KeyA', mods: 2 }, { t: 'key', type: 'up', key: 'a', code: 'KeyA' }]);
  } finally { await shut(p); await srv.close(); }
});

test('a real paste sends one paste and no key; a long one goes in whole pieces; too long or empty sends nothing', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c } = await ready(srv);
  try {
    await clip(p, srv, 'owner@shop.example');
    let got = await sent(c, () => ctrlV(p));
    assert.deepEqual(got, [{ t: 'paste', text: 'owner@shop.example' }]);
    assert.ok((await p.ev('window.__prevented')).some((e) => e.t === 'keydown' && e.key === 'v' && !e.prevented), 'Ctrl+V is left to the browser, so its paste fires');
    const long = `${'x'.repeat(9999)}😀yz`; // the emoji sits over the 10 000-character cut
    await clip(p, srv, long);
    got = await sent(c, () => ctrlV(p));
    assert.equal(got.length, 2, 'two pieces');
    assert.ok(got.every((m) => m.t === 'paste' && m.text.length <= 10000));
    assert.equal(got.map((m) => m.text).join(''), long, 'in order, nothing lost');
    assert.ok(!/[\uD800-\uDBFF]$/.test(got[0].text), 'no piece ends in half an emoji');
    await clip(p, srv, 'z'.repeat(100001));
    got = await sent(c, () => ctrlV(p));
    assert.deepEqual(got, [], 'over 100 000 characters sends nothing');
    assert.equal(await text(p, 'note'), 'That paste is too long to send.');
    await clip(p, srv, 'short');
    got = await sent(c, () => ctrlV(p));
    assert.deepEqual(got, [{ t: 'paste', text: 'short' }]);
    assert.equal(await text(p, 'note'), '', 'a paste that goes clears the line');
    await clip(p, srv, 'z'.repeat(100001));
    await ctrlV(p);
    await until(async () => (await text(p, 'note')) !== '', 'the line again');
    const shown = await canvasState(p);
    assert.ok(shown.bottom <= shown.vh, 'with the note line shown, the whole frame is still on screen');
    await clip(p, srv, '');
    got = await sent(c, () => ctrlV(p));
    assert.deepEqual(got, [], 'an empty paste sends nothing');
  } finally { await shut(p); await srv.close(); }
});

test('coordinates follow the newest frame\'s size', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c } = await ready(srv, { width: 700, height: 700 });
  try {
    c.send({ ...SMALL, seq: 2 });
    let s = await drawn(p, 160, 100);
    let a = pt(s, 0.5, 0.25);
    let got = await sent(c, () => p.clickAt(a.x, a.y));
    near(got[0], a, 'on the 160×100 frame');
    await sleep(600);
    c.send({ ...BIG, seq: 3 });
    s = await drawn(p, 320, 200);
    a = pt(s, 0.5, 0.25);
    got = await sent(c, () => p.clickAt(a.x, a.y));
    near(got[0], a, 'on the 320×200 frame');
  } finally { await shut(p); await srv.close(); }
});

test('keys the page sends move nothing on it, and the canvas has no menu of its own', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c, s } = await ready(srv);
  try {
    await sent(c, async () => {
      await keyEvent(p, 'keyDown', ' ', 'Space', { text: ' ', windowsVirtualKeyCode: 32 }); await keyEvent(p, 'keyUp', ' ', 'Space', { windowsVirtualKeyCode: 32 });
      await keyEvent(p, 'rawKeyDown', 'ArrowDown', 'ArrowDown', { windowsVirtualKeyCode: 40 }); await keyEvent(p, 'keyUp', 'ArrowDown', 'ArrowDown', { windowsVirtualKeyCode: 40 });
      await keyEvent(p, 'rawKeyDown', 'Tab', 'Tab', { windowsVirtualKeyCode: 9 }); await keyEvent(p, 'keyUp', 'Tab', 'Tab', { windowsVirtualKeyCode: 9 });
      const a = pt(s, 0.5, 0.5);
      await mouse(p, 'mousePressed', a, { button: 'right', buttons: 2, clickCount: 1 });
      await mouse(p, 'mouseReleased', a, { button: 'right', buttons: 0, clickCount: 1 });
    });
    const seen = await p.ev('window.__prevented');
    for (const k of [' ', 'ArrowDown', 'Tab']) assert.ok(seen.some((e) => e.t === 'keydown' && e.key === k && e.prevented), `${k} default-prevented`);
    assert.ok(seen.some((e) => e.t === 'contextmenu' && e.prevented), 'the context menu prevented');
    assert.equal(await p.ev(`document.activeElement.id`), 'screen', 'Tab kept the focus on the canvas');
  } finally { await shut(p); await srv.close(); }
});

test('a lost pointer capture ends a drag with its up; a press not yet a drag sends nothing', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c, s } = await ready(srv, { width: 700, height: 700 });
  try {
    const a = pt(s, 0.2, 0.2), b = pt(s, 0.5, 0.5);
    const lose = () => p.ev(`document.getElementById('screen').dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1 }))`);
    let got = await sent(c, async () => {
      await mouse(p, 'mouseMoved', a);
      await mouse(p, 'mousePressed', a, { button: 'left', buttons: 1, clickCount: 1 });
      await mouse(p, 'mouseMoved', b, { button: 'left', buttons: 1 });
      await sleep(100);
      await lose();
      await mouse(p, 'mouseReleased', b, { button: 'left', buttons: 0, clickCount: 1 });
    });
    assert.deepEqual(got.map((m) => m.type).filter((t) => t !== 'move'), ['down', 'up'], JSON.stringify(got));
    near(got.at(-1), b, 'the up, at the last point');
    await sleep(600);
    got = await sent(c, async () => {
      await mouse(p, 'mouseMoved', a);
      await mouse(p, 'mousePressed', a, { button: 'left', buttons: 1, clickCount: 1 });
      await lose();
      await mouse(p, 'mouseReleased', a, { button: 'left', buttons: 0, clickCount: 1 });
    });
    assert.deepEqual(got, [], 'a press still waiting to be a click sends nothing once the capture is lost');
  } finally { await shut(p); await srv.close(); }
});

test('the 4 px rule: a press that moves 3 px is a click at the press; one that moves 6 px, or is released 10 px off, is a drag', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c, s } = await ready(srv, { width: 700, height: 700 });
  try {
    const a = pt(s, 0.3, 0.3);
    const off = (dx) => ({ x: a.x + dx, y: a.y });
    let got = await sent(c, async () => {
      await mouse(p, 'mouseMoved', a);
      await mouse(p, 'mousePressed', a, { button: 'left', buttons: 1, clickCount: 1 });
      await mouse(p, 'mouseMoved', off(3), { button: 'left', buttons: 1 });
      await mouse(p, 'mouseReleased', off(3), { button: 'left', buttons: 0, clickCount: 1 });
    });
    assert.deepEqual(got.map((m) => m.type), ['click'], JSON.stringify(got));
    near(got[0], a, 'the click is where the press was');
    await sleep(600);
    got = await sent(c, async () => {
      await mouse(p, 'mouseMoved', a);
      await mouse(p, 'mousePressed', a, { button: 'left', buttons: 1, clickCount: 1 });
      await mouse(p, 'mouseMoved', off(6), { button: 'left', buttons: 1 });
      await mouse(p, 'mouseReleased', off(6), { button: 'left', buttons: 0, clickCount: 1 });
    });
    assert.deepEqual(got.map((m) => m.type).filter((t) => t !== 'move'), ['down', 'up'], JSON.stringify(got));
    await sleep(600);
    got = await sent(c, async () => {
      await mouse(p, 'mouseMoved', a);
      await mouse(p, 'mousePressed', a, { button: 'left', buttons: 1, clickCount: 1 });
      await mouse(p, 'mouseReleased', off(10), { button: 'left', buttons: 0, clickCount: 1 });
    });
    assert.deepEqual(got.map((m) => m.type).filter((t) => t !== 'move'), ['down', 'up'], `released 10 px off: ${JSON.stringify(got)}`);
    near(got[0], a, 'the down at the press');
    const r = off(10);
    near(got.at(-1), { fx: ((r.x - s.left) * s.w) / s.width, fy: ((r.y - s.top) * s.h) / s.height }, 'the up, at the release');
  } finally { await shut(p); await srv.close(); }
});

test('moves wait for an animation frame, one per frame, and a waiting one goes before the up', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c, s } = await ready(srv, { width: 700, height: 700 });
  try {
    const at = (fx, fy) => pt(s, fx, fy);
    await p.ev('__raf.hold()');
    let got = await sent(c, async () => { for (let i = 1; i <= 5; i++) await mouse(p, 'mouseMoved', at(0.1 * i, 0.5)); }, 200, { all: true });
    assert.deepEqual(got, [], 'no move before its frame');
    let ran;
    got = await sent(c, async () => { ran = await p.ev('__raf.run()'); }, 200, { all: true });
    assert.equal(got.length, 1, `one move for five in one frame: ${JSON.stringify(got)} (${ran} frames held)`);
    near(got[0], at(0.5, 0.5), 'the newest');
    await p.ev('__raf.hold()');
    got = await sent(c, async () => { await p.hold('Shift', true); await mouse(p, 'mouseMoved', at(0.6, 0.6), { modifiers: 8 }); await p.hold('Shift', false); await p.ev('__raf.run()'); }, 200, { all: true });
    assert.deepEqual(got.map((m) => [m.type, m.button, m.mods]), [['move', 'none', 8]], 'a hover move carries Shift');
    await p.ev('__raf.hold()');
    const a = at(0.2, 0.2), b = at(0.7, 0.7);
    got = await sent(c, async () => {
      await mouse(p, 'mouseMoved', a);
      await mouse(p, 'mousePressed', a, { button: 'left', buttons: 1, clickCount: 1 });
      await mouse(p, 'mouseMoved', b, { button: 'left', buttons: 1 });
      await mouse(p, 'mouseReleased', b, { button: 'left', buttons: 0, clickCount: 1 });
    }, 200);
    assert.deepEqual(got.map((m) => m.type), ['down', 'move', 'up'], `the waiting move goes before the up: ${JSON.stringify(got)}`);
    near(got[1], b, 'the move');
    got = await sent(c, () => p.ev('__raf.run()'), 200, { all: true });
    assert.deepEqual(got, [], 'and nothing after it');
  } finally { await shut(p); await srv.close(); }
});

test('the wheel scales line and page turns to pixels and clamps them; a drag released off the canvas ends at its edge', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c, s } = await ready(srv, { width: 1200, height: 500 });
  try {
    const a = pt(s, 0.5, 0.5);
    const wheel = (dy, mode) => p.ev(`document.getElementById('screen').dispatchEvent(new WheelEvent('wheel', { deltaY: ${dy}, deltaMode: ${mode}, clientX: ${a.x}, clientY: ${a.y}, bubbles: true, cancelable: true }))`);
    for (const [dy, mode, want] of [[3, 1, 48], [1, 2, 200], [1e6, 0, 100000], [-1e6, 0, -100000]]) {
      const got = await sent(c, () => wheel(dy, mode), 200);
      assert.deepEqual(got.map((m) => [m.t, m.dy]), [['wheel', want]], `deltaY ${dy} in mode ${mode}`);
    }
    assert.ok(s.left > 60, 'the canvas has room beside it in a wide window');
    const from = pt(s, 0.8, 0.5);
    const out = { x: s.left + s.width + 40, y: s.top - 30 };
    const got = await sent(c, async () => {
      await mouse(p, 'mouseMoved', from);
      await mouse(p, 'mousePressed', from, { button: 'left', buttons: 1, clickCount: 1 });
      await mouse(p, 'mouseMoved', out, { button: 'left', buttons: 1 });
      await mouse(p, 'mouseReleased', out, { button: 'left', buttons: 0, clickCount: 1 });
    });
    const up = got.at(-1);
    assert.equal(up.type, 'up', JSON.stringify(got));
    assert.deepEqual([up.x, up.y], [320, 0], 'the up, clamped to the frame');
  } finally { await shut(p); await srv.close(); }
});

test('Ctrl+V on a non-Latin layout still pastes; a Cmd chord whose keyup never comes gets its up when Cmd goes', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c } = await ready(srv);
  try {
    await clip(p, srv, 'привет');
    let got = await sent(c, async () => {
      await p.hold('Control', true);
      await keyEvent(p, 'rawKeyDown', 'м', 'KeyV', { windowsVirtualKeyCode: 86, modifiers: 2, commands: ['paste'] });
      await keyEvent(p, 'keyUp', 'м', 'KeyV', { windowsVirtualKeyCode: 86, modifiers: 2 });
      await p.hold('Control', false);
    });
    assert.deepEqual(got, [{ t: 'paste', text: 'привет' }], 'the paste, and no key for it');
    // macOS sends no keyup for a key pressed while Cmd is held
    got = await sent(c, async () => {
      await keyEvent(p, 'rawKeyDown', 'Meta', 'MetaLeft', { windowsVirtualKeyCode: 91, modifiers: 4 });
      await keyEvent(p, 'rawKeyDown', 'a', 'KeyA', { windowsVirtualKeyCode: 65, modifiers: 4 });
      await keyEvent(p, 'keyUp', 'Meta', 'MetaLeft', { windowsVirtualKeyCode: 91 });
    });
    assert.deepEqual(got, [{ t: 'key', type: 'down', key: 'a', code: 'KeyA', mods: 4 }, { t: 'key', type: 'up', key: 'a', code: 'KeyA' }]);
    // a key still down when the canvas loses focus (Cmd+Tab away) gets its up then
    got = await sent(c, async () => {
      await keyEvent(p, 'rawKeyDown', 'Backspace', 'Backspace', { windowsVirtualKeyCode: 8 });
      await p.ev(`document.getElementById('screen').blur()`);
      await keyEvent(p, 'keyUp', 'Backspace', 'Backspace', { windowsVirtualKeyCode: 8 });
    });
    assert.deepEqual(got, [{ t: 'key', type: 'down', key: 'Backspace', code: 'Backspace' }, { t: 'key', type: 'up', key: 'Backspace', code: 'Backspace' }], 'one up, on blur');
    got = await sent(c, async () => { await p.ev(`document.getElementById('screen').focus()`); await p.ev(`document.getElementById('screen').blur()`); });
    assert.deepEqual(got, [], 'and none on the next blur');
  } finally { await shut(p); await srv.close(); }
});

// ----- Task 3: the address bar, Back, Sign out of everything --------------------------------------

test('the address bar sends http and https entries as nav, and refuses every other scheme', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c } = await ready(srv);
  try {
    for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'about:blank', 'chrome://settings', 'mailto:owner@shop.example']) {
      const got = await sent(c, () => go(p, bad), 200);
      assert.deepEqual(got, [], `${bad} sends nothing`);
      assert.equal(await text(p, 'note'), 'Only http and https addresses open here.', `${bad} is refused in words`);
    }
    const at2048 = `https://shop.example/${'a'.repeat(2048 - 21)}`;
    assert.equal(at2048.length, 2048);
    let got = await sent(c, () => go(p, `${at2048}a`), 200);
    assert.deepEqual(got, [], 'an address of 2049 characters sends nothing');
    assert.equal(await text(p, 'note'), 'That address is too long.');
    got = await sent(c, () => go(p, at2048.slice(8) + 'a'), 200);
    assert.deepEqual(got, [], 'nor one that https:// in front makes 2049');
    assert.equal(await text(p, 'note'), 'That address is too long.');
    got = await sent(c, () => go(p, at2048), 200);
    assert.deepEqual(got, [{ t: 'nav', url: at2048 }], '2048 characters go');
    for (const [typed, url] of [['shop.example/account', 'https://shop.example/account'], ['  localhost:8080/x ', 'https://localhost:8080/x'], ['http://a.example/', 'http://a.example/'], ['https://shop.example/account', 'https://shop.example/account'], ['HTTPS://Shop.Example/a/../b', 'HTTPS://Shop.Example/a/../b'], ['a.example/?next=https://b.example', 'https://a.example/?next=https://b.example']]) {
      got = await sent(c, () => go(p, typed), 200);
      assert.deepEqual(got, [{ t: 'nav', url }], `${JSON.stringify(typed)} sends ${url}`);
      assert.equal(await text(p, 'note'), '', 'and the refusal line goes');
    }
    got = await sent(c, () => p.click('#back'), 200);
    assert.deepEqual(got, [{ t: 'back' }]);
  } finally { await shut(p); await srv.close(); }
});

test('Sign out of everything sends forget only after its confirm', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c } = await ready(srv);
  const isOpen = () => p.ev(`document.getElementById('confirm').open`);
  try {
    let got = await sent(c, () => p.click('#signout'), 200);
    assert.deepEqual(got, [], 'opening the confirm sends nothing');
    assert.equal(await isOpen(), true);
    assert.equal(await p.ev(`document.getElementById('confirm').textContent.replace(/\\s+/g, ' ').trim()`), 'Sign this project\'s browser out of every site? Every site it is signed into forgets it, and the browser starts again empty. Cancel Sign out of every site');
    await noHandBack(p);
    got = await sent(c, () => p.click('#cancel'), 200);
    assert.deepEqual(got, [], 'Cancel sends nothing');
    assert.equal(await isOpen(), false);
    await p.click('#signout');
    got = await sent(c, async () => { await keyEvent(p, 'rawKeyDown', 'Escape', 'Escape', { windowsVirtualKeyCode: 27 }); await keyEvent(p, 'keyUp', 'Escape', 'Escape', { windowsVirtualKeyCode: 27 }); }, 200);
    assert.deepEqual(got, [], 'Escape sends nothing');
    assert.equal(await isOpen(), false);
    await p.click('#signout');
    got = await sent(c, () => p.click('#forget'), 200);
    assert.deepEqual(got, [{ t: 'forget' }]);
    assert.equal(await isOpen(), false);
  } finally { await shut(p); await srv.close(); }
});

test('a url never overwrites what the owner is typing, and is shown as text', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c } = await ready(srv);
  const value = () => p.ev(`document.getElementById('addr').value`);
  try {
    c.send({ t: 'url', url: 'https://shop.example/account' });
    await until(async () => (await value()) === 'https://shop.example/account', 'the url');
    await p.ev(`document.getElementById('addr').select()`);
    await p.click('#addr');
    await p.ev(`document.getElementById('addr').select()`);
    await p.type('shop');
    c.send({ t: 'url', url: 'https://shop.example/other' });
    await sleep(300);
    assert.equal(await value(), 'shop', 'the owner\'s edit stays while the field has focus');
    await p.ev(`document.getElementById('addr').blur()`);
    assert.equal(await value(), 'https://shop.example/other', 'the newest url shows on blur');
    await p.ev(`document.getElementById('addr').focus()`);
    c.send({ t: 'url', url: 'https://shop.example/third' });
    await sleep(300);
    await keyEvent(p, 'keyDown', 'Enter', 'Enter', { text: '\r', windowsVirtualKeyCode: 13 });
    await keyEvent(p, 'keyUp', 'Enter', 'Enter', { windowsVirtualKeyCode: 13 });
    await until(async () => (await value()) === 'https://shop.example/third', 'the waiting url, shown after a nav');
    c.send({ t: 'url', url: 'https://a.example/<i>hi<i>' });
    await until(async () => (await value()) === 'https://a.example/<i>hi<i>', 'the url with markup in it, as text');
    assert.equal(await p.ev(`document.querySelector('i')`), null, 'no element made of it');
  } finally { await shut(p); await srv.close(); }
});
