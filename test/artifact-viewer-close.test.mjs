// The artifact viewer closes (kit-141): X, Escape (with the dashboard's focus or the frame's) and a click
// on the scrim close it, back on the head it was opened over, whatever the page inside it has done, and
// the history is left as the spec says (spec §Acceptance checks DW1 to DW3). Headless Chrome against a
// real dashboard on a project of its own (threadsFixture), skipped where Chrome can't be driven, as the
// kit's other Chrome tests are. The setup and the helpers are the shared harness's
// (fixtures/artifact-viewer/harness.mjs), which says why every case has a tab of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDrive } from './lib/chrome.mjs';
import { harness, J, IN_PANEL } from './fixtures/artifact-viewer/harness.mjs';
import { oneHarness } from './lib/browser-fixture.mjs';

const SKIP = canDrive ? false : 'needs Chrome and a Node with WebSocket';
const H = oneHarness(harness, 'artifact-viewer-close', SKIP);

test('the viewer closes, whatever the page inside it did', { skip: SKIP, timeout: 1500000 }, async (t) => {
  const { T, AV_A, AV_B, PV, LIB_T, visit, sub } = await H(t);

  // DW1: the bug, reproduced on main: the frame's link adds the history's newest entry, and a close by
  // history.back() steps the frame back, leaving the viewer open.
  await sub('DW1: X after an in-frame link closes the viewer on #library', async () => {
    const V = await visit('#library');
    await V.open(AV_A);
    await V.frameClick('to-b', 'viewer-a/b.html');
    await V.close('x');
    await V.closedOn('#library', 'X after the link');
  });

  // DW2: every closer, every move: closed, on the head it was opened over.
  const MOVES = {
    // opened from the panel open on a thread; the close carries its th and t
    link: async (V, kind) => {
      assert.equal(await V.p.ev('location.hash'), LIB_T, 'setup: the visit on the panel\'s head');
      await V.soon(IN_PANEL(T), 'setup: T open in the panel');
      await V.open(AV_A);
      await V.frameClick('to-b', 'viewer-a/b.html');
      await V.close(kind);
      await V.closedOn(LIB_T, `${kind} after the link`);
    },
    // open A, close it, open B (a second src on the frame), close it
    'open A, close, open B': async (V, kind) => {
      await V.open(AV_A);
      await V.close(kind);
      await V.closedOn('#library', `${kind}, the first close (A)`);
      await V.open(AV_B);
      await V.close(kind);
      await V.closedOn('#library', `${kind}, the second close (B)`);
    },
    // a preview whose app moves to /second inside the lens
    'preview route': async (V, kind) => {
      await V.open(PV);
      await V.appLink();
      await V.close(kind);
      await V.closedOn('#library', `${kind} after the app's route change`);
    },
  };
  for (const [move, run] of Object.entries(MOVES)) {
    for (const kind of ['x', 'escape-dash', 'escape-frame', 'scrim']) {
      await sub(`DW2: ${kind} after ${move}`, async () => run(await visit(move === 'link' ? LIB_T : '#library'), kind));
    }
  }
});

test('the viewer closes, whatever the page inside it did: DW3 a and b, history after no move or a link', { skip: SKIP, timeout: 1500000 }, async (t) => {
  const { T, AV_A, LIB_T, visit, sub } = await H(t);

  // DW3: history. a: no move, so a close by history.back(), as main does.
  await sub('DW3 a: no frame move: X goes back one entry', async () => {
    const V = await visit('#library');
    await V.open(AV_A);
    const n = await V.before();
    await V.close('x');
    const s = await V.closedOn('#library', 'X with no move');
    assert.equal(s.backs, 1, 'history.back called once');
    assert.equal(s.leaveReplaces, 0, 'no replaceState by leaveArtifact');
    assert.equal(s.length, n, 'history.length unchanged');
  });
  await sub('DW3 b: after an in-frame link: X replaces, never back', async () => {
    const V = await visit('#library');
    await V.open(AV_A);
    await V.frameClick('to-b', 'viewer-a/b.html');
    const n = await V.before();
    await V.close('x');
    const s = await V.closedOn('#library', 'X after the link');
    assert.equal(s.backs, 0, 'history.back not called');
    assert.equal(s.length, n, 'history.length unchanged');
    assert.deepEqual(s.state, { page: '#library', depth: 0, openedHere: false }, 'the stamp');
  });

  // b, the panel changed while the viewer is up (T2 review T2-1): a close after a move takes the panel's th and t
  // from history.state.page (the panel as it is now), never from the head the viewer was opened over
  for (const [from, change, to, what] of [
    ['#library', { th: 'open', t: T }, LIB_T, 'the panel opened on T'],
    [LIB_T, { th: null, t: null }, '#library', 'the panel closed'],
  ]) {
    await sub(`DW3 b: opened from ${from === '#library' ? '#library' : 'the panel open on T'}, ${what} while the viewer is up, then a link: X closes on ${to === '#library' ? '#library' : 'the panel open on T'}`, async () => {
      const V = await visit(from);
      if (from === LIB_T) await V.soon(IN_PANEL(T), 'setup: T open in the panel');
      await V.open(AV_A);
      await V.p.ev(`thGo(${J(change)}), true`);
      await V.soon(`history.state?.page === ${J(to)} && location.hash === ${J(AV_A)}`, `setup: ${what}: the viewer's entry names ${to} as its page`);
      await V.frameClick('to-b', 'viewer-a/b.html');
      const n = await V.before();
      await V.close('x');
      const s = await V.closedOn(to, `X after ${what} and the link`);
      assert.equal(s.backs, 0, 'history.back not called');
      assert.ok(s.leaveReplaces >= 1, 'closed by replaceState');
      assert.equal(s.length, n, 'history.length unchanged');
      assert.deepEqual(s.state, { page: to, depth: 0, openedHere: false }, 'the stamp');
    });
  }
});
