// The harness's frameClick aims only at the page now on the stage (kit-928): where an element is comes
// from the stage's own frame, from words of the page and hash the stage is on now, waiting for that page's
// own word when the stage has moved. CI run 45684113340 aimed at viewer-a's #to-b as the Library's live
// thumbnail of viewer-a said it, and pressed the draft's #to-a instead. Headless Chrome on the shared
// harness (fixtures/artifact-viewer/harness.mjs), skipped where Chrome can't be driven.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDrive } from './lib/chrome.mjs';
import { harness, J, AIM, FRAMES } from './fixtures/artifact-viewer/harness.mjs';

test('frameClick aims only at the page now on the stage', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 240000 }, async (t) => {
  const { AV_A, PV, visit, sub } = await harness(t, 'artifact-viewer-aim');

  // A1: a window that is not the stage's frame (as a Library thumbnail is not) says viewer-a's index has #to-b where
  // the stage's #to-anchor is, after the stage's page said where it is: the click still goes to b.html.
  await sub('A1: a word from a frame that is not the stage is never aimed at', async () => {
    const V = await visit('#board');
    await V.open(AV_A);
    const fake = { own: 'at', page: 'viewer-a/index.html', hash: '', rects: { 'to-b': { x: 40, y: 100, w: 160, h: 32 } } };
    // (the stage's own later words held, so the other word is the newest naming #to-b)
    await V.p.ev("window.__ownHold = (m) => m.page === 'viewer-a/index.html' && m.rects?.['to-b']?.y !== 100, true");
    await V.p.ev(`window.postMessage(${J(fake)}, '*'), true`);
    await V.soon("window.__own.some((m) => m.rects && m.rects['to-b'] && m.rects['to-b'].y === 100)", "setup: the other frame's word heard");
    await V.frameClick('to-b', 'viewer-a/b.html');
  });

  // A2: on b.html, an element only index.html had: never pressed from index's old word; the wait names the
  // page on the stage.
  await sub("A2: an old page's word is never aimed at once the stage has moved", async () => {
    const V = await visit('#board');
    await V.open(AV_A);
    await V.frameClick('to-b', 'viewer-a/b.html');
    await assert.rejects(V.frameClick('to-anchor', 'viewer-a/index.html', { hash: '#anchor', load: false }), /the page on the stage \(viewer-a\/b\.html\) never said where #to-anchor is/);
  });

  // A3: pressed by hand on index's #to-b (b.html's words held), then aimed at #to-c: the aim waits, and
  // aims once b.html's own word comes (let go a second later).
  await sub("A3: when the stage has moved, the aim waits for the new page's own word", async () => {
    const V = await visit('#board');
    await V.open(AV_A);
    await V.p.ev("window.__ownHold = (m) => m.page === 'viewer-a/b.html', true");
    const at = await V.p.ev(AIM('to-b'));
    // (Chrome can drop the first press in a fresh document: pressed until the stage is on b.html)
    for (let i = 0; i < 3; i++) {
      await V.p.ev(FRAMES);
      await V.p.move(at.x, at.y);
      await V.p.clickAt(at.x, at.y);
      if (await V.settle("TS.path === 'b.html' && window.__ownHeld.length > 0", 3000)) break;
    }
    await V.soon("TS.path === 'b.html' && window.__ownHeld.length > 0", "setup: the stage on b.html, its words held");
    const aimed = V.frameClick('to-c', 'viewer-a/c.html');
    aimed.catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));
    assert.ok(await V.p.ev('window.__ownLetGo()') > 0, "setup: b.html's words let go");
    await aimed;
  });

  // A4: a preview's app says its words from inside the lens's own frame: they are the stage's.
  await sub("A4: a preview's app, inside its lens, is aimed at", async () => {
    const V = await visit('#board');
    await V.open(PV);
    await V.appLink();
  });

  // A5: back on index.html after b.html, before index says its word again: its first visit's words are
  // never aimed at, and the aim comes once the new visit says (its words held, then let go: the harness's knob).
  await sub("A5: an earlier visit's words of the same page are never aimed at", async () => {
    const V = await visit('#board');
    await V.open(AV_A);
    await V.frameClick('to-b', 'viewer-a/b.html');
    await V.p.ev("window.__ownHold = (m) => m.page === 'viewer-a/index.html', true");
    await V.p.ev('history.back(), true');
    await V.soon("TS.path === 'index.html' && TS.ready && window.__ownHeld.length > 0", "setup: back on index.html, its new word held");
    assert.equal(await V.p.ev(AIM('to-b')), null, "the aim waits: index.html's first visit's #to-b is not this visit's");
    assert.ok(await V.p.ev('window.__ownLetGo()') > 0, "setup: index.html's new words let go");
    await V.frameClick('to-b', 'viewer-a/b.html');
  });

  // A6: a page's first word, said on its load, can find its frame not yet drawn and say its elements are 0x0;
  // its drawn word comes two frames later (CI runs 45734741421, A1, and 45743125606, A3: V.open returned
  // between the two, so A3's aim read at once was null and A1's hold kept back the drawn word). The viewer is
  // up only once the stage's own frame has said where the page's elements are drawn (kit-948): here the frame
  // is kept undrawn, and a drawn word from a window that is not the stage's frame never counts.
  await sub("A6: the viewer is up only once the stage's own page said where its elements are drawn", async () => {
    const V = await visit('#board');
    await V.p.ev("(() => { const s = document.createElement('style'); s.id = 'undrawn'; s.textContent = '#av-frame { display: none !important; }'; document.head.append(s); return true; })()");
    let up = false;
    const opened = V.open(AV_A).then(() => { up = true; });
    opened.catch(() => {});
    await V.soon("window.__own.some((m) => m.page === 'viewer-a/index.html' && m.rects?.['to-b']?.w === 0)", "setup: the stage page's undrawn word heard");
    const other = { own: 'at', page: 'viewer-a/index.html', hash: '', rects: { 'to-b': { x: 40, y: 40, w: 160, h: 32 } } };
    await V.p.ev(`window.postMessage(${J(other)}, '*'), true`);
    await V.soon("window.__own.filter((m) => m.rects?.['to-b']?.w === 160).length > 0", "setup: the other window's drawn word heard");
    await new Promise((r) => setTimeout(r, 1000));
    assert.equal(up, false, "V.open returned before the stage's own frame said where #to-b is drawn");
    await V.p.ev("document.getElementById('undrawn').remove(), true");
    await opened;
    assert.ok(await V.p.ev(AIM('to-b')), 'the aim, read at once after V.open, finds #to-b');
  });
});
