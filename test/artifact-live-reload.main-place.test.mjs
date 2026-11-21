// main's viewer reloads by itself on a new fingerprint and keeps the owner's place (kit-750, kit-753).
// Split from artifact-live-reload.test.mjs by kit-757 for CI's per-file watchdog. Headless Chrome
// against a real dashboard; skipped where Chrome can't be driven.
// Ports: none of its own (lib/kit.mjs's +0 hub, +1..25)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashboardOnFreePort, threadsFixture } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { J, SLUG, PAGE, soonIn, placed, follower, land } from './lib/artifact-live.mjs';

// main's viewer reloads by itself on a new fingerprint (kit-750, ruling A1); it keeps the owner's
// place exactly as a draft's does (kit-142, kit-753): the page of the artifact they moved to, and the
// #hash they moved to unless the address carried an anchor of its own, which stays. Each version's
// pages carry its title, so a reload is told from the page it lands on: a link at the top left goes
// to page2.html, one beside it to #tab2.
test('main reload keeps place: a viewer on main reloads by itself on the page and #hash the owner moved to, its own anchor kept', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 900000 }, async (t) => {
  const later = cleanup(t);
  const F = threadsFixture('main-place');
  later(() => F.done());
  land(F, placed('m0'));
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  const B = `http://127.0.0.1:${port}`;
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE });
  const soon = soonIn(p);
  const VIEW = `${B}/view/artifact/${SLUG}`;
  let n = 0;
  // the page on the stage, from about:blank (a document of its own, its logs fresh), once its frame says ready
  const open = async (url, title) => {
    await p.send('Page.navigate', { url: 'about:blank' });
    await soon(`location.href === 'about:blank'`, 'about:blank');
    await p.send('Page.navigate', { url });
    await soon(`typeof TS === 'object' && TS.kind === 'artifact' && TS.at === 'main' && TS.fp && (window.__titles ?? []).some((x) => x.title === ${J(title)})`, `${url}: main up at ${title}`);
  };
  const follow = follower(p, t);
  // main changes (a merged commit): the frame, marked, is replaced by a fresh one that says ready at `want`
  const landAndSee = async (want) => {
    const v = `m${++n}`;
    await p.ev(`(document.getElementById('av-frame').__before = 1, true)`);
    const t0 = await p.ev('Date.now()');
    land(F, placed(v));
    const got = await soonIn(p, 90000)(`__titles.find((x) => x.t > ${t0} && x.title.startsWith(${J(v)}))`, `main reloaded by itself to ${v}`);
    assert.equal(got.title, want(v), 'reloaded at the owner\'s place');
    assert.equal(await p.ev(`document.getElementById('av-frame').__before`), undefined, 'in a fresh frame');
    return v;
  };

  await t.test("M1: a viewer tab on main: the owner went to page2.html; main's reload stays on it", async () => {
    await open(VIEW, `m${n}`);
    await follow(20, `TS.path === 'page2.html'`);
    await landAndSee((v) => `${v}-page2`);
  });

  await t.test("M2: a viewer tab on main: the owner went to #tab2; main's reload stays at it", async () => {
    await open(VIEW, `m${n}`);
    await follow(140, `TS.path === 'index.html' && TS.hash === '#tab2'`);
    await landAndSee((v) => `${v}#tab2`);
  });

  await t.test("M3: a viewer tab opened at #section (showArtifact's anchor): the reload keeps it; moved to page2.html, it stays there", async () => {
    await open(`${VIEW}#section`, `m${n}#section`);
    assert.match(await p.ev(`document.getElementById('av-frame').getAttribute('src')`), /#section$/, "the frame's src carries the anchor");
    await landAndSee((v) => `${v}#section`);
    await follow(20, `TS.path === 'page2.html'`);
    await landAndSee((v) => `${v}-page2`);
  });

  await t.test("M4: the dashboard's stage on main: the owner went to page2.html; main's reload (seen in /api/data) stays on it", async () => {
    await open(`${B}/#artifact/main/${SLUG}`, `m${n}`);
    await follow(20, `TS.path === 'page2.html'`);
    await landAndSee((v) => `${v}-page2`);
  });
});
