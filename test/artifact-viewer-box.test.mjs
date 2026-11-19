// The artifact viewer's box (kit-141 spec §Approach 1, 2; DW5 to DW7): a near-full-window modal under the
// page bar, 16px from the sides and bottom (8px under 600px), its right edge clear of the Inbox panel
// when it is open; the viewer tab's frame fills its stage; and the file drawer's frame keeps its 70vh.
// Headless Chrome against a real dashboard, on the shared harness (fixtures/artifact-viewer/harness.mjs),
// skipped where Chrome can't be driven, as the kit's other Chrome tests are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDrive } from './lib/chrome.mjs';
import { harness, J, VIEWER_UP } from './fixtures/artifact-viewer/harness.mjs';

const SKIP = canDrive ? false : 'needs Chrome and a Node with WebSocket';

// #artifact-view's computed box: top, right, bottom, left (a box of a fixed element: used values in px).
const BOX = "(() => { const s = getComputedStyle(document.getElementById('artifact-view')); return [s.top, s.right, s.bottom, s.left].join('/'); })()";
const BAR_H = "getComputedStyle(document.documentElement).getPropertyValue('--bar-h').trim()";
// The element the stage's frame shows at id, in the window's coordinates: the frame's box (and its border) plus
// the rect the page inside last said (the page's own word, the frame's origin being opaque to the test).
const CENTRE = (id) => `(() => { const m = window.__own.filter((m) => m.own === 'at' && m.rects && m.rects[${J(id)}] && m.rects[${J(id)}].w > 0).pop(); if (!m) return null; const f = tsFrame(), r = f.getBoundingClientRect(), e = m.rects[${J(id)}]; return { x: r.left + f.clientLeft + e.x + e.w / 2, y: r.top + f.clientTop + e.y + e.h / 2 }; })()`;
const near = (a, b, d) => Math.hypot(a.x - b.x, a.y - b.y) <= d;

test("the viewer's box, its narrowing for the panel, and the frames that fill a stage", { skip: SKIP, timeout: 900000 }, async (t) => {
  const { TA, TR, AV_A, PV, visit, sub } = await harness(t, 'artifact-viewer-box');

  await sub('DW5: the modal sits under the page bar, 16px from the sides and bottom; 8px under 600px', async () => {
    const V = await visit('#library');
    await V.open(AV_A);
    assert.equal(await V.p.ev(BAR_H), '49px', '--bar-h on :root');
    for (const [w, h, box] of [[1280, 800, '49px/16px/16px/16px'], [700, 800, '49px/16px/16px/16px'], [500, 800, '8px/8px/8px/8px']]) {
      await V.size(w, h);
      await V.soon(`${BOX} === ${J(box)}`, `the box at ${w}x${h} is ${box}`).catch(async (e) => { assert.equal(await V.p.ev(BOX), box, `the box at ${w}x${h} (top/right/bottom/left): ${e.message}`); });
    }
    await V.size(1280, 800);
    assert.equal(await V.p.ev(`${BOX}.split('/')[0] === ${BAR_H}`), true, 'top is --bar-h');
  });

  await sub('DW5: in the viewer tab the box is the bar, then the whole tab', async () => {
    const V = await visit('', { path: 'view/artifact/viewer-a' });
    await V.soon("TS.kind === 'artifact' && TS.slug === 'viewer-a' && TS.ready", "setup: the viewer tab's lens ready");
    assert.equal(await V.p.ev(BAR_H), '49px', '--bar-h on :root');
    assert.equal(await V.p.ev(BOX), '49px/0px/0px/0px', "the viewer tab's box (top/right/bottom/left)");
  });

  await sub('DW6: the Inbox panel narrows the viewer, and a pin and a new thread are placed from the narrowed frame', async () => {
    const V = await visit('#library');
    const p = V.p;
    await V.open(AV_A);
    // the panel, opened by #tt-peek (a real press)
    await V.soon("getComputedStyle(document.getElementById('tt-peek')).visibility === 'visible'", 'setup: #tt-peek shown');
    const peek = await p.ev("(() => { const r = document.getElementById('tt-peek').getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; return { x, y, top: !!document.elementFromPoint(x, y)?.closest('#tt-peek') }; })()");
    assert.ok(peek.top, 'setup: #tt-peek is what is at its centre');
    await p.move(peek.x, peek.y);
    await p.clickAt(peek.x, peek.y);
    await V.soon(`${BOX} === '49px/396px/16px/16px'`, 'the panel open: the box narrowed to right 396px, left 16px').catch(async (e) => { assert.equal(await p.ev(BOX), '49px/396px/16px/16px', `the box with the panel open (top/right/bottom/left): ${e.message}`); });
    assert.equal(await p.ev(VIEWER_UP), true, 'the viewer is still up');
    // the frame's box at rest, and what the page inside says of itself once it knows its new size
    await V.soon("(() => { const r = tsFrame().getBoundingClientRect(), k = [r.left, r.top, r.width, r.height].join(); const was = window.__steady; window.__steady = k; return was === k; })()", "setup: the stage's frame at rest");
    const fr = await p.ev('(() => { const r = tsFrame().getBoundingClientRect(); return { left: r.left, right: r.right }; })()');
    assert.equal(fr.right, 1280 - 396 - 1, "the frame's right edge follows the viewer's (inside its 1px border)");
    assert.equal(fr.left, 16 + 1, "the frame's left edge: the viewer's border inside 16px");

    // threads placed beforehand: each pin within 40px of its element's centre, all measured in the narrowed frame.
    // #pin-right is placed from the frame's right edge, so it moved 380px left when the panel opened: a pin drawn
    // from a rect the page said before the narrowing misses it. (#pin-me, from the left edge, didn't move.)
    const where = (id) => V.soon(`!!${CENTRE(id)}`, `setup: the page on the stage says where #${id} is`).then(() => p.ev(CENTRE(id)));
    // The page's own word on #pin-right is for the narrowed frame: its centre at the frame's content right edge
    // less 380px (right: 320px, 120px wide). A wait: when the frame's box first reads steady, the page can still
    // be telling its place in the wide frame (kit-305 spec-1 S1).
    const NARROWED = `(() => { const c = ${CENTRE('pin-right')}, f = tsFrame(), r = f.getBoundingClientRect(); return c && { said: c.x, want: r.left + f.clientLeft + f.clientWidth - 380 }; })()`;
    await V.soon(`(() => { const n = ${NARROWED}; return !!n && Math.abs(n.said - n.want) <= 2; })()`, 'the page in the frame says where #pin-right is in the narrowed frame').catch(async (e) => {
      const n = await p.ev(NARROWED);
      assert.fail(`#pin-right's centre as the page says it, ${n?.said}, is the narrowed frame's right edge less 380px, ${n?.want}: ${e.message}`);
    });
    // Each pin follows the lens's word on its anchor, redrawn on the next animation frame (or the panel's slide
    // ending), so it can lag the page's own word by a frame: a wait until it is within 40px, then the check
    // with what was read then (kit-305: a single read here failed on CI with TR's pin still where the wide
    // frame put it).
    const PIN = (sel) => `(() => { const e = document.querySelector(${J(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`;
    for (const [th, name, id] of [[TA, 'TA', 'pin-me'], [TR, 'TR', 'pin-right']]) {
      const pinSel = `#av-pins [data-tl-pin="${th}"]`;
      await V.soon(`(() => { const e = document.querySelector(${J(pinSel)}); return !!e && e.getBoundingClientRect().width > 0; })()`, `setup: ${name}'s pin drawn on the stage`);
      await where(id);
      await V.soon(`(() => { const a = ${CENTRE(id)}, q = ${PIN(pinSel)}; return !!a && !!q && Math.hypot(a.x - q.x, a.y - q.y) <= 40; })()`, `${name}'s pin within 40px of #${id}'s centre`).catch(async (e) => {
        const at = await p.ev(CENTRE(id)), pin = await p.ev(PIN(pinSel));
        assert.ok(pin && at && near(pin, at, 40), `${name}'s pin ${J(pin)} is within 40px of #${id}'s centre ${J(at)}: ${e.message}`);
      });
    }

    // a real Shift+click on #other-right (placed from the frame's right edge; the frame has the keyboard first,
    // as dashboard.test.mjs does it)
    const blank = await p.ev(`(() => { const r = tsFrame().getBoundingClientRect(); return { x: r.left + 600, y: r.top + 150 }; })()`);
    await p.move(blank.x, blank.y);
    await p.clickAt(blank.x, blank.y);
    await V.soon("document.activeElement === document.getElementById('av-frame')", 'the frame has the keyboard');
    const other = await where('other-right');
    await p.hold('Shift', true);
    try {
      await V.soon("!document.getElementById('av-over').hidden", 'the overlay raised by Shift');
      await p.move(other.x, other.y, 8);
      await V.soon("TS.hit?.anchor?.selector === '#other-right'", "the lens's answer for the hover is #other-right");
      await p.clickAt(other.x, other.y, 8);
    } finally { await p.hold('Shift', false); }
    await V.soon("TL.draft?.subject?.anchor?.selector === '#other-right'", "a draft on #other-right: TL.draft.subject.anchor.selector");
    // the draft's pin: where the dashboard puts it (tsRect, the frame's box and the point in it)
    const draft = await p.ev('(() => { const r = tsRect(TL.draft.subject); return r && { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; })()');
    assert.ok(draft, "the draft's subject has a pin on the stage");
    assert.ok(near(draft, other, 40), `the draft's pin ${J(draft)} is within 40px of #other-right's centre ${J(other)}`);
  });

  await sub("DW7: the viewer tab's frame fills its stage; the drawer's frame stays at 70vh", async () => {
    // the artifact's tab
    let V = await visit('', { path: 'view/artifact/viewer-a', width: 1440, height: 900 });
    await V.soon("TS.kind === 'artifact' && TS.slug === 'viewer-a' && TS.ready", "setup: the viewer tab's lens ready");
    const fits = (frame) => `(() => { const f = document.getElementById(${J(frame)}).getBoundingClientRect(), s = document.getElementById('av-stage').getBoundingClientRect(); return { bottom: f.bottom, inner: innerHeight, h: f.height, stage: s.height }; })()`;
    let r = await V.p.ev(fits('av-frame'));
    assert.ok(Math.abs(r.bottom - r.inner) <= 1, `#av-frame's bottom ${r.bottom} is the window's ${r.inner}`);
    assert.ok(Math.abs(r.h - r.stage) <= 1, `#av-frame's height ${r.h} is #av-stage's ${r.stage}`);
    // a preview's tab (the relay is open already; a page that still says to reload is reloaded once, as the kit's preview test does)
    V = await visit('', { path: `view/preview/${PV.slice('#preview/'.length)}`, width: 1440, height: 900 });
    if (await V.p.ev("!document.getElementById('av-note').hidden && document.getElementById('av-note').textContent === 'Reload to view this preview'")) await V.reload();
    await V.soon("TS.kind === 'preview' && TS.ready", "setup: the preview tab's lens ready");
    r = await V.p.ev(fits('pv-frame'));
    assert.ok(Math.abs(r.bottom - r.inner) <= 1, `#pv-frame's bottom ${r.bottom} is the window's ${r.inner}`);
    assert.ok(Math.abs(r.h - r.stage) <= 1, `#pv-frame's height ${r.h} is #av-stage's ${r.stage}`);
    // the file drawer's frame, in the dashboard
    V = await visit('#file?path=docs%2Fdrawer-page.html', { width: 1440, height: 900 });
    await V.soon("(() => { const f = document.querySelector('#drawer .viewer iframe'); return !!f && !document.getElementById('drawer').hidden && getComputedStyle(document.getElementById('drawer')).transform === 'none'; })()", 'setup: the drawer open on the file, its frame shown');
    r = await V.p.ev("({ h: document.querySelector('#drawer .viewer iframe').getBoundingClientRect().height, inner: innerHeight })");
    assert.ok(Math.abs(r.h - 0.7 * r.inner) <= 1, `the drawer's frame is ${r.h} tall; 0.7 * ${r.inner} is ${0.7 * r.inner}`);
  });
});
