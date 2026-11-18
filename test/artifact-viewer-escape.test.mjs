// Escape and the artifact viewer (kit-141 spec §Approach 7, DW4; plan T3): with a thread's card open
// beside its pin (a floating card), the first Escape closes the card and the viewer stays; the next closes
// the viewer. The same with the dashboard's focus and with the frame's (where only the lens hears the key).
// And each lens tells a full press as two key messages, the keydown's without `up` and the keyup's with
// `up: true` (design-change 1), so the viewer acts once per press. Headless Chrome against a real
// dashboard, on the shared harness (fixtures/artifact-viewer/harness.mjs), skipped where Chrome can't be
// driven, as the kit's other Chrome tests are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDrive } from './lib/chrome.mjs';
import { harness, J, CARD, FLOATING, VIEWER_UP } from './fixtures/artifact-viewer/harness.mjs';

const SKIP = canDrive ? false : 'needs Chrome and a Node with WebSocket';
const ESC_DOWN = { key: 'Escape', shift: false }, ESC_UP = { key: 'Escape', shift: false, up: true };

test('Escape closes a floating card first, then the viewer', { skip: SKIP, timeout: 900000 }, async (t) => {
  const { TA, AV_A, PV, visit, sub } = await harness(t, 'artifact-viewer-escape');

  // The viewer open on viewer-a from #library (the panel closed), TA's pin pressed: its card open beside it.
  const withCard = async () => {
    const V = await visit('#library');
    assert.equal(await V.p.ev("!TH.th"), true, 'setup: the panel closed');
    await V.open(AV_A);
    const pin = `#av-pins [data-tl-pin="${TA}"]`;
    await V.soon(`(() => { const e = document.querySelector(${J(pin)}); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0; })()`, "setup: TA's pin drawn on the stage");
    const at = await V.p.ev(`(() => { const r = document.querySelector(${J(pin)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await V.press(at.x, at.y, 'tl-pin');
    await V.soon(FLOATING(TA), "setup: TA's card open beside its pin (not in the panel)");
    return V;
  };
  // After the first Escape: the card hidden and the viewer still up on viewer-a, and still so a moment
  // later (a second effect of the same press, as the keyup's, would show by then).
  const cardOnlyClosed = async (V, what) => {
    await V.settle(`${CARD}.hidden`, 3000);
    await new Promise((r) => setTimeout(r, 700));
    const s = await V.p.ev(`({ card: ${CARD}.hidden, up: ${VIEWER_UP}, hash: location.hash, slug: TS.slug })`);
    assert.equal(s.up, true, `${what}: the viewer is still open (hash ${s.hash}, the card ${s.card ? 'hidden' : 'shown'})`);
    assert.equal(s.card, true, `${what}: the card is hidden`);
    assert.equal(s.hash, AV_A, `${what}: still on the viewer's head`);
  };

  await sub("DW4: a floating card, Escape with the dashboard's focus: the card first, then the viewer", async () => {
    const V = await withCard();
    await V.focusBody();
    await V.p.key('Escape');
    await cardOnlyClosed(V, 'the first Escape');
    await V.close('escape-dash');
    await V.closedOn('#library', 'the second Escape');
  });

  await sub("DW4: a floating card, Escape with the frame's focus: the card first, then the viewer; the artifact lens marks its keyup up", async () => {
    const V = await withCard();
    const k = await V.frameEscape();
    await cardOnlyClosed(V, 'the first Escape');
    await V.soon(`window.__lensKeys.length >= ${k} + 2`, "the artifact lens told both halves of the press");
    assert.deepEqual(await V.p.ev(`window.__lensKeys.slice(${k})`), [ESC_DOWN, ESC_UP], "the artifact lens's key messages for one press: the keydown's without up, the keyup's with up: true");
    await V.close('escape-frame');
    await V.closedOn('#library', 'the second Escape');
  });

  // A preview's lens: the same two messages for a press. Pin mode on, so the press has something to end
  // that keeps the viewer up (its keydown ends pin mode; its keyup must do nothing).
  await sub("the preview's lens marks its keyup's key message up; a press in pin mode ends pin mode only", async () => {
    const V = await visit('#library');
    await V.open(PV);
    await V.p.ev('tlPinMode(true), true');
    await V.soon('TL.pin', 'setup: pin mode on');
    const k = await V.frameEscape();
    await V.soon(`window.__lensKeys.length >= ${k} + 2`, "the preview's lens told both halves of the press");
    await new Promise((r) => setTimeout(r, 700));
    assert.deepEqual(await V.p.ev(`window.__lensKeys.slice(${k})`), [ESC_DOWN, ESC_UP], "the preview lens's key messages for one press: the keydown's without up, the keyup's with up: true");
    const s = await V.p.ev(`({ pin: TL.pin, up: ${VIEWER_UP}, hash: location.hash, kind: TS.kind })`);
    assert.equal(s.pin, false, 'pin mode ended');
    assert.equal(s.up, true, `the viewer still open (hash ${s.hash})`);
    assert.equal(s.hash, PV, "still on the preview's head");
  });
});
