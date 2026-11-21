// A viewer on main in Chrome: a newer version loads by itself (kit-750, ruling A1, which supersedes
// kit-206's outline for main), the press still loads the page again, and a published tree never changes.
// Ports: none of its own (lib/kit.mjs's +0 hub, +1..25)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashboardOnFreePort, threadsFixture } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { soonIn, landArtifact, COUNT_FETCH } from './lib/dashboard-page.mjs';

// The page's polls at a twentieth of their period: each setInterval of exactly 5000 or 10000 ms runs
// through a 50 ms check that calls it once window.__scale of its period has passed since its last call
// (250 ms and 500 ms), so the 2:1 ratio of the 5 s threads read to the 10 s check, which "a 10 s tick
// gone by" counts on, is kept. Every other timer (the 500 ms hint, the 30 s hello, every setTimeout) is
// the page's own. __scale is read on each look, so a page can be held at full period and let go.
const SCALE_BY = 0.05;
const SCALE = `(() => { window.__scale = ${SCALE_BY}; const si = window.setInterval; window.setInterval = (f, ms, ...a) => { if (ms !== 5000 && ms !== 10000) return si(f, ms, ...a); let last = performance.now(); return si(() => { if (performance.now() - last >= ms * window.__scale) { last = performance.now(); f(...a); } }, 50); }; })();`;

// The stage's artifact on main, changed since its frame loaded, loads again by itself on the page's
// polls at a twentieth of their period (same 2:1 ratio, the one absolute window held), and the
// outline kit-206 had never shows. A draft reloads by itself too (kit-106, test/artifact-live-reload.test.mjs).
test("a viewer on main loads a newer version by itself, never outlining Reload, and the press loads it again", { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 240000 }, async (t) => {
  const later = cleanup(t);
  const F = threadsFixture('reload-hint');
  later(() => F.done());
  // the page's <title> is what its lens says when it is ready: how the test sees what the frame shows
  const mock = (title) => ({ 'artifact.json': JSON.stringify({ v: 1, title: 'Hint mock', summary: 'A page that changes', by: 'supervisor', for: [] }), 'index.html': `<!doctype html><html><head><title>${title}</title></head><body><p>${title}</p></body></html>` });
  // main changes as a merged PR changes it: a commit on main, pushed
  const edit = (title) => landArtifact(F, 'hint-mock', mock(title));
  // landed before the dashboard starts: its first read already lists it; the published tree is this one
  const T = edit('v1');
  // a build served again for 3 s after it ends (the kit's 20 s, kit-595, set back for tests): the
  // outline's 45 s wait is timed to it
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({ DEVTEAM_DATA_REUSE_MS: '3000' }));
  const B = `http://127.0.0.1:${port}`;
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: SCALE });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: COUNT_FETCH });
  // every read the page makes, in the order it started, and whether its body has been read: what
  // "the page's next check has landed" waits on
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { window.__reads2 = []; const f = window.fetch; window.fetch = async (u, o) => { const x = { u: String(u), n: window.__reads2.length, landed: false }; window.__reads2.push(x); const r = await f(u, o); for (const m of ['json', 'text']) { const g = r[m].bind(r); r[m] = () => g().finally(() => { x.landed = true; }); } return r; }; })();` });
  // the titles the stage's frame says when ready; the script runs in the artifact's own frame too, which has no stage
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { window.__titles = []; addEventListener('message', (e) => { const f = document.getElementById('av-frame'); if (f && e.source === f.contentWindow && e.data?.lens === 1 && e.data.type === 'ready') window.__titles.push(e.data.title); }); })();` });
  const soon = soonIn(p);
  // two polls, and a read that may have started before the change: the dashboard's can wait DATA_WAIT_MS (20 s), the viewer's describe 12 s
  const soonData = soonIn(p, 45000);
  const soonView = soonIn(p, 37000);
  // two of the page's own checks (reads of `prefix`) started after now and landed: a reload the first
  // one set off has had a whole tick to load its frame and say ready
  // two of them, each a 10 s tick and a read that can take DATA_WAIT_MS (20 s) on a slow server: 90 s
  const soonChecks = soonIn(p, 90000);
  const checksFrom = async (prefix) => { const n0 = await p.ev('window.__reads2.length'); await soonChecks(`window.__reads2.filter((x) => x.n >= ${n0} && x.landed && x.u.startsWith(${JSON.stringify(prefix)})).length >= 2`, `two ${prefix} checks landed`); };
  const said = (title) => p.ev(`window.__titles.filter((x) => x === ${JSON.stringify(title)}).length`);
  // kit-92: Reload is a pill; its outline sits at the pill's border width (border: what that width is)
  const button = () => p.ev(`(() => { const b = document.getElementById('av-reload'), s = getComputedStyle(b); return { stale: b.classList.contains('stale'), title: b.title, color: s.outlineColor, width: s.outlineWidth, style: s.outlineStyle, border: s.borderTopWidth }; })()`);
  const FRESH = 'Load the page again';
  // whether the button was ever outlined since now: kit-206's hint, which main no longer shows
  const watchStale = () => p.ev(`(() => { window.__wasStale = false; const b = document.getElementById('av-reload'); const look = () => { if (b.classList.contains('stale')) window.__wasStale = true; }; look(); new MutationObserver(look).observe(b, { attributes: true }); return true; })()`);

  await t.test("on the dashboard: main changed loads again by itself within a poll, with no outline; the press loads it again", async () => {
    await p.send('Page.navigate', { url: `${B}/#artifact/main/hint-mock` });
    await soon(`typeof __titles === 'object' && __titles.includes('v1')`, "main's version in the frame");
    assert.deepEqual(await p.ev(`[TS.kind, TS.at, /^[0-9a-f]{64}$/.test(TS.fp ?? '')]`), ['artifact', 'main', true], 'opened with its fingerprint');
    let b = await button();
    assert.deepEqual([b.stale, b.title], [false, FRESH], 'nothing newer at open');
    // a press on the version shown loads it again
    await p.click('#av-reload');
    await soon(`__titles.filter((x) => x === 'v1').length === 2`, "main's again");
    assert.equal((await button()).stale, false);
    await watchStale();
    edit('v2');
    await soonData(`__titles.includes('v2')`, 'the new version in the frame by itself, within a poll');
    assert.equal(await said('v2'), 1, 'loaded once');
    b = await button();
    assert.deepEqual([b.stale, b.title], [false, FRESH], 'no outline');
    assert.equal(await p.ev('window.__wasStale'), false, "kit-206's outline never showed");
    assert.equal(await p.ev('TS.fp === TS.fpNow'), true);
    // two of the page's checks on, the same version: nothing loads again
    await checksFrom('/api/data');
    assert.equal(await said('v2'), 1, 'no reload with nothing new');
  });

  await t.test("in a viewer tab: its own check of main, every 10 s, loads a newer version by itself; a press before any check changes nothing; a tree is never checked", async () => {
    // "no check yet when pressed" reads an absolute window (the tab's first check not run between its
    // boot and the press, two frame loads later): this tab's polls run at full period until the 'no check yet when pressed' assertion has run
    const { identifier: hold } = await p.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__scale = 1;' });
    await p.send('Page.navigate', { url: `${B}/view/artifact/hint-mock` });
    await soon(`document.documentElement.classList.contains('viewer') && typeof __titles === 'object' && __titles.includes('v2')`, "main's version in the viewer");
    // pressed before the tab's first check: only boot's ask so far
    await p.click('#av-reload');
    await soon(`__titles.filter((x) => x === 'v2').length === 2`, "main's again");
    assert.equal(await p.ev(`__asked.filter((u) => u.startsWith('/api/view?')).length`), 1, 'no check yet when pressed');
    // the window has been read: back to a twentieth, here and on the tree's navigate below; the first
    // check runs on a 50 ms look once 500 ms have passed since the check was set up
    await p.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: hold });
    await p.ev(`window.__scale = ${SCALE_BY}`);
    let b = await button();
    assert.deepEqual([b.stale, b.title], [false, FRESH]);
    await watchStale();
    edit('v3');
    await soonView(`__titles.includes('v3')`, 'the new version in the frame by itself, within a check');
    b = await button();
    assert.deepEqual([b.stale, b.title], [false, FRESH], 'no outline');
    assert.equal(await p.ev('window.__wasStale'), false, "kit-206's outline never showed");
    await checksFrom('/api/view?');
    assert.equal(await said('v3'), 1, 'no reload with nothing new');
    // a published tree: after one 10 s tick has passed (four reads of the threads: boot's and three
    // 5 s ticks, started beside it), still only boot's ask
    await p.send('Page.navigate', { url: `${B}/view/artifact/hint-mock?at=tree:${T}` });
    await soon(`document.documentElement.classList.contains('viewer') && typeof TS === 'object' && TS.at === 'tree:${T}'`, 'the tree in the viewer');
    await soonView(`__asked.filter((u) => u === '/api/threads').length >= 4`, 'a 10 s tick gone by');
    assert.equal(await p.ev(`__asked.filter((u) => u.startsWith('/api/view?')).length`), 1, 'a tree is never checked');
    assert.equal((await button()).stale, false);
  });
});
