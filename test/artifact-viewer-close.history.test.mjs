// The artifact viewer closes (kit-141), its history after a ticket peek, a reload, cold links, a preview
// and a thread's card, and a close that must close again (spec §Acceptance checks DW3; split from
// test/artifact-viewer-close.test.mjs, kit-223, so each file stays inside CI's per-file watchdog). The
// setup and the helpers are the shared harness's (fixtures/artifact-viewer/harness.mjs), built once per
// file by oneHarness (lib/browser-fixture.mjs) for the parts that share it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDrive } from './lib/chrome.mjs';
import { harness, J, CLOSED, PEEK, VIEWER_UP, IN_PANEL } from './fixtures/artifact-viewer/harness.mjs';
import { oneHarness } from './lib/browser-fixture.mjs';

const SKIP = canDrive ? false : 'needs Chrome and a Node with WebSocket';
const H = oneHarness(harness, 'artifact-viewer-close', SKIP);

test('the viewer closes, whatever the page inside it did: DW3 c and d, over a ticket peek and after its reload', { skip: SKIP, timeout: 1500000 }, async (t) => {
  const { T, TK, AV_A, PROG_T, visit, sub } = await H(t);

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
});

test('the viewer closes, whatever the page inside it did: DW3 e to g, and a close that must close again', { skip: SKIP, timeout: 1500000 }, async (t) => {
  const { TA, AV_A, AV_B, PV, visit, sub } = await H(t);

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
