// The artifact viewer closes (kit-141): X, Escape (with the dashboard's focus or the frame's) and a click
// on the scrim close it, back on the head it was opened over, whatever the page inside it has done, and
// the history is left as the spec says (spec §Acceptance checks DW1 to DW3). Headless Chrome against a
// real dashboard on a project of its own (threadsFixture), skipped where Chrome can't be driven, as the
// kit's other Chrome tests are. The setup and the helpers are the shared harness's
// (fixtures/artifact-viewer/harness.mjs), which says why every case has a tab of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDrive } from './lib/chrome.mjs';
import { harness, J, CLOSED, PEEK, VIEWER_UP, IN_PANEL } from './fixtures/artifact-viewer/harness.mjs';

const SKIP = canDrive ? false : 'needs Chrome and a Node with WebSocket';

test('the viewer closes, whatever the page inside it did', { skip: SKIP, timeout: 1500000 }, async (t) => {
  const { T, TA, TK, AV_A, AV_B, PV, LIB_T, PROG_T, visit, sub } = await harness(t, 'artifact-viewer-close');

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
    await sub(`DW3 b: opened from ${from === '#library' ? '#library' : 'the panel open on T'}, ${what} while the viewer is up, then a link: X closes on ${to}`, async () => {
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

  // c: over a ticket peek opened on #progress with the panel open on T
  const overPeek = async () => {
    const V = await visit(PROG_T);
    assert.equal(await V.p.ev('location.hash'), PROG_T, "setup: the visit on the panel's head");
    await V.soon(IN_PANEL(T), 'setup: T open in the panel');
    await V.p.ev(`location.hash = '#ticket/${TK}'; void 0`);
    await V.soon(`${PEEK} && location.hash === '#ticket/${TK}'`, 'setup: the ticket peek');
    const peekState = await V.p.ev('history.state');
    await V.open(AV_A);
    return { V, peekState };
  };
  const PEEK_BACK = `${CLOSED} && location.hash === '#ticket/${TK}' && ${PEEK}`;
  await sub('DW3 c: from a ticket peek, no move: X back to the peek, its X back to the page', async () => {
    const { V, peekState } = await overPeek();
    const n = await V.before();
    await V.close('x');
    await V.settle(PEEK_BACK, 3000);
    const s = await V.state();
    assert.equal(s.open, false, `the viewer is still visible (hash ${s.hash})`);
    assert.equal(s.hash, `#ticket/${TK}`, 'back on the peek');
    assert.equal(await V.p.ev(PEEK), true, 'the peek open');
    assert.deepEqual(s.state, peekState, "the peek's stamp as it was when it opened");
    assert.deepEqual(s.state, { page: PROG_T, depth: 1, openedHere: true }, "the peek's stamp");
    assert.equal(s.length, n, 'history.length unchanged');
    await V.before();
    await V.peekClose();
    await V.settle(`location.hash === ${J(PROG_T)} && document.getElementById('drawer').hidden`, 3000);
    const s2 = await V.state();
    assert.equal(s2.hash, PROG_T, `the peek's X walks back one entry (history.go called with ${J(s2.gos)}, the drawer ${await V.p.ev("document.getElementById('drawer').hidden ? 'hidden' : 'shown'")})`);
  });
  for (const moves of [1, 2]) {
    await sub(`DW3 c: from a ticket peek, after ${moves} move${moves > 1 ? 's' : ''}: X restores the peek in place, its X closes it in place`, async () => {
      const { V } = await overPeek();
      await V.frameClick('to-b', 'viewer-a/b.html');
      if (moves > 1) await V.frameClick('to-c', 'viewer-a/c.html');
      const n = await V.before();
      await V.close('x');
      await V.settle(PEEK_BACK, 3000);
      const s = await V.state();
      assert.equal(s.open, false, `the viewer is still visible (hash ${s.hash}, back called ${s.backs}x)`);
      assert.equal(s.hash, `#ticket/${TK}`, 'on the peek');
      assert.equal(await V.p.ev(`${PEEK} && PAGE_NOW === 'progress'`), true, 'the peek open over #progress');
      assert.deepEqual(s.state, { page: PROG_T, depth: 1, openedHere: false }, "the peek's stamp, by hand");
      assert.equal(s.length, n, 'history.length unchanged');
      await V.peekClose();
      await V.settle(`location.hash === ${J(PROG_T)} && document.getElementById('drawer').hidden`, 3000);
      assert.equal(await V.p.ev('location.hash'), PROG_T, "the peek's X closes it");
      const s2 = await V.state();
      assert.equal(s2.open, false, 'the viewer hidden');
      assert.equal(s2.state?.depth, 0, 'the page entry, depth 0');
      assert.equal(s2.length, n, 'history.length unchanged after the peek closes in place');
      await V.p.ev('history.forward(); void 0');
      await new Promise((r) => setTimeout(r, 700));
      assert.equal(await V.p.ev('location.hash'), PROG_T, 'history.forward() moves nothing: no entry left ahead');
    });
  }

  // d: a reload of the viewer's entry: its first route, so a replace to the page its stamp names
  for (const moved of [false, true]) {
    await sub(`DW3 d: reloaded over a ticket peek, ${moved ? 'moved once after' : 'unmoved'}: X replaces to the page`, async () => {
      const { V } = await overPeek();
      await V.reload();
      // (a new document: what its frames say is counted from 0 again)
      await V.up(AV_A, 0);
      if (moved) await V.frameClick('to-b', 'viewer-a/b.html');
      const n = await V.before();
      await V.close('x');
      const s = await V.closedOn(PROG_T, `X after the reload${moved ? ' and a link' : ''}`);
      assert.equal(s.backs, 0, 'history.back not called');
      assert.ok(s.leaveReplaces >= 1, 'closed by replaceState');
      assert.equal(s.length, n, 'history.length unchanged');
      assert.deepEqual(s.state, { page: PROG_T, depth: 0, openedHere: false }, 'the stamp');
      if (moved) {
        await V.p.ev(`location.hash = '#ticket/${TK}'; void 0`);
        await V.soon(`${PEEK} && location.hash === '#ticket/${TK}'`, 'a ticket peek opened next');
        await V.peekClose();
        await V.soon(`location.hash === ${J(PROG_T)} && document.getElementById('drawer').hidden`, "its X lands on the page");
      }
    });
  }

  // e: cold links (the visit's first route): closed by replace to #library
  for (const head of [AV_A, PV]) {
    await sub(`DW3 e: a cold link to ${head.startsWith('#preview/') ? 'a preview' : 'an artifact'}: X replaces to #library`, async () => {
      const V = await visit(head);
      // the relay is open already, so the page names it; a page that still says to reload is reloaded once
      if (head === PV && await V.p.ev("!document.getElementById('av-note').hidden && document.getElementById('av-note').textContent === 'Reload to view this preview'")) await V.reload();
      await V.up(head, 0);
      const n = await V.before();
      await V.close('x');
      const s = await V.closedOn('#library', 'X on a cold link');
      assert.equal(s.backs, 0, 'history.back not called');
      assert.ok(s.leaveReplaces >= 1, 'closed by replaceState');
      assert.equal(s.length, n, 'history.length unchanged');
      assert.deepEqual(s.state, { page: '#library', depth: 0, openedHere: false }, 'the stamp');
    });
  }

  // f: a preview reloaded (its first route again), then the app's route change
  await sub('DW3 f: a reloaded preview after a route change: X replaces to #library', async () => {
    const V = await visit('#library');
    await V.open(PV);
    await V.reload();
    await V.up(PV, 0);
    await V.appLink();
    const n = await V.before();
    await V.close('x');
    const s = await V.closedOn('#library', 'X after the reload and the route change');
    assert.equal(s.backs, 0, 'history.back not called');
    assert.ok(s.leaveReplaces >= 1, 'closed by replaceState');
    assert.deepEqual(s.state, { page: '#library', depth: 0, openedHere: false }, 'the stamp');
    assert.equal(s.length, n, 'history.length unchanged');
  });

  // g: opened by a thread's card (#talk/<id>): routing that head again reopens the viewer, so the close
  // goes to the page under the card and stays closed
  for (const moved of [false, true]) {
    await sub(`DW3 g: from a #talk/ card, ${moved ? 'after an in-frame link' : 'no move'}: X closes and it stays closed`, async () => {
      const V = await visit('#library');
      const n0 = await V.mark();
      await V.p.ev(`location.hash = '#talk/${TA}'; void 0`);
      await V.up(AV_A, n0);
      assert.equal(await V.p.ev('location.hash'), AV_A, "setup: the card's thread opened the viewer on its artifact");
      const under = await V.p.ev('history.state?.page');
      assert.ok(under, "setup: the viewer entry's stamp names a page");
      if (moved) await V.frameClick('to-b', 'viewer-a/b.html');
      const n = await V.before();
      await V.close('x');
      await V.closedOn(under, 'X');
      await new Promise((r) => setTimeout(r, 1000));
      const s = await V.closedOn(under, 'still closed 1 s later');
      assert.equal(s.backs, 0, 'history.back not called');
      assert.equal(s.length, n, 'history.length unchanged');
      assert.equal(s.state?.depth, 0, 'the stamp, depth 0');
    });
  }

  // Two close cases of T2's (plan-2 P2-1, plan-3 P3-1): a close must never leave the viewer unable to close again.
  await sub('viewer A, then B over it, then X twice: back to A, then closed', async () => {
    const V = await visit('#library');
    await V.open(AV_A);
    const n = await V.mark();
    await V.p.ev(`location.hash = ${J(AV_B)}; void 0`);
    await V.up(AV_B, n);
    await V.close('x');
    await V.settle(`location.hash === ${J(AV_A)} && ${VIEWER_UP} && TS.slug === 'viewer-a'`, 3000);
    const s = await V.state();
    assert.equal(s.hash, AV_A, "the first X: back on A's entry");
    assert.equal(s.open, true, 'the first X: the viewer still up');
    assert.equal(s.slug, 'viewer-a', 'the first X: on A');
    await V.soon('TS.ready', "A's lens ready again");
    await V.close('x');
    await V.closedOn('#library', 'the second X');
  });
  await sub('an in-frame #anchor link, then X, then X: closed at the end', async () => {
    const V = await visit('#library');
    await V.open(AV_A);
    await V.frameClick('to-anchor', 'viewer-a/index.html', { hash: '#anchor', load: false });
    await V.close('x');
    // the first X may only step the frame back off its #anchor (an in-frame fragment move is kit-142's), but
    // it must never lock the viewer: a second X, if it is still open, closes it
    await V.settle(CLOSED, 1500);
    if (await V.p.ev(VIEWER_UP)) await V.close('x');
    await V.closedOn('#library', 'X, then X');
  });
});
