// A page of the artifact that the change removed (kit-755). Headless Chrome against a real dashboard,
// as artifact-live-reload.test.mjs, whose helpers it shares (lib/artifact-live.mjs); a draft's
// fingerprint route is faked in the page. Skipped where Chrome can't be driven.
// Ports: none of its own (lib/kit.mjs's +0 hub, +1..25)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { write, dashboardOnFreePort, threadsFixture } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { J, SLUG, WT, sleep, PAGE, soonIn, placed, follower } from './lib/artifact-live.mjs';

// A page of the artifact that the change removed (kit-755): a reload by itself (main's, kit-753, and a
// draft's, kit-142) on a page the server no longer has would show its plain 404, which has no lens, so
// every later reload stayed on it. It goes to the page the artifact was opened at instead, with its
// anchor; a page that is still there keeps the owner's place. The pages are `placed`'s: each version
// titles its pages with its name, so a reload is told from the page it lands on.
test('reload removed page: a viewer whose page the change removed reloads to the page the artifact was opened at, with its anchor', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 900000 }, async (t) => {
  const later = cleanup(t);
  const F = threadsFixture('removed-page');
  later(() => F.done());
  const dir = path.join(F.old, 'docs/devteam/project/artifacts', SLUG);
  const draft = path.join(F.old, `.worktrees/${WT}/docs/devteam/project/artifacts/${SLUG}`);
  // a version's pages, written into a folder, with `without` taken away
  const put = (into, v, without = []) => {
    const files = placed(v);
    for (const rel of without) { delete files[rel]; fs.rmSync(path.join(into, rel), { force: true }); }
    for (const [rel, text] of Object.entries(files)) write(path.join(into, rel), text);
  };
  // main changes, as a merged PR changes it
  const landed = (v, without) => {
    put(dir, v, without);
    F.g(['add', '-A', dir], F.old);
    F.g(['commit', '-qm', `artifact: ${SLUG} ${v}`], F.old);
    F.g(['push', '-q', 'origin', 'main'], F.old);
  };
  landed('r0');
  // before the dashboard starts: its first read lists the draft
  put(draft, 'd0');
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
  const follow = follower(p, t);
  const VIEW = `${B}/view/artifact/${SLUG}`;
  const src = () => p.ev(`document.getElementById('av-frame').getAttribute('src')`);
  // the page on the stage, from about:blank (a document of its own, its logs fresh), once its frame says
  // ready at `title` and the stage knows its fingerprint
  const open = async (url, at, title) => {
    await p.send('Page.navigate', { url: 'about:blank' });
    await soon(`location.href === 'about:blank'`, 'about:blank');
    await p.send('Page.navigate', { url });
    await soon(`typeof TS === 'object' && TS.kind === 'artifact' && TS.at === ${J(at)} && TS.fp && (window.__titles ?? []).some((x) => x.title === ${J(title)})`, `${url}: up at ${title}`);
  };
  // the frame marked, `change` run (it says when, in the page's clock): the first ready after it is a
  // fresh frame's, at `want`, the frame's src `wantSrc`
  const changeAndSee = async (change, v, want, wantSrc) => {
    await p.ev(`(document.getElementById('av-frame').__before = 1, true)`);
    const t0 = await change();
    const got = await soonIn(p, 90000)(`__titles.find((x) => x.t > ${t0} && x.title.startsWith(${J(v)}))`, `reloaded by itself to ${v}`);
    assert.equal(got.title, want, 'reloaded at the right page');
    assert.equal(await p.ev(`document.getElementById('av-frame').__before`), undefined, 'in a fresh frame');
    assert.equal(await src(), wantSrc, "the frame's src");
  };
  const onMain = (v, without) => async () => { const t0 = await p.ev('Date.now()'); landed(v, without); return t0; };
  const MAIN = `/artifact/main/${SLUG}/`;

  await t.test('R1: a viewer tab on main, on page2.html when main removes it: reloaded to the page it opened, not a 404', async () => {
    await open(VIEW, 'main', 'r0');
    await follow(20, `TS.path === 'page2.html'`);
    await changeAndSee(onMain('r1', ['page2.html']), 'r1', 'r1', MAIN);
  });

  await t.test('R2: a viewer tab on main opened at #section, on page2.html when main removes it: reloaded to #section', async () => {
    landed('r2');
    await open(`${VIEW}#section`, 'main', 'r2#section');
    await follow(20, `TS.path === 'page2.html'`);
    await changeAndSee(onMain('r3', ['page2.html']), 'r3', 'r3#section', `${MAIN}#section`);
  });

  await t.test('R3: a viewer tab on a draft, on page2.html when the draft removes it: reloaded to the page it opened, not a 404', async () => {
    await open(`${VIEW}?at=${WT}`, WT, 'd0');
    await follow(20, `TS.path === 'page2.html'`);
    const edit = async () => { put(draft, 'd1', ['page2.html']); return p.ev(`(window.__fake.fp = ${J('f'.repeat(64))}, Date.now())`); };
    await changeAndSee(edit, 'd1', 'd1', `/artifact/wt/${WT}/${SLUG}/`);
  });

  await t.test("R4: a viewer tab on main, on page2.html when main changes and keeps it: the owner's place kept", async () => {
    landed('r4');
    await open(VIEW, 'main', 'r4');
    await follow(20, `TS.path === 'page2.html'`);
    await changeAndSee(onMain('r5'), 'r5', 'r5-page2', `${MAIN}page2.html`);
  });

  await t.test("R5: a viewer tab on main, on page2.html, whose ask answers 503 (not a 404): the owner's place kept", async () => {
    await open(VIEW, 'main', 'r5');
    await follow(20, `TS.path === 'page2.html'`);
    await p.ev(`(window.__artStatus[${J(`${MAIN}page2.html`)}] = 503, true)`);
    await changeAndSee(onMain('r6'), 'r6', 'r6-page2', `${MAIN}page2.html`);
    assert.deepEqual(await p.ev('__artAsks'), [`${MAIN}page2.html`], 'the reload asked for page2.html and got the 503');
  });

  await t.test('R6: main, a frame loaded before any fingerprint was known (TS.fp null): the first one seen only taken, no reload', async () => {
    await open(VIEW, 'main', 'r6');
    const t0 = await p.ev(`(document.getElementById('av-frame').__before = 1, TS.fp = null, Date.now())`);
    // the viewer tab's next /api/view check (every 10 s) gives the fingerprint again
    await soonIn(p, 30000)('!!TS.fp', 'the fingerprint taken again');
    await sleep(3000);
    assert.deepEqual(await p.ev(`__titles.filter((x) => x.t > ${t0}).map((x) => x.title)`), [], 'no reload');
    assert.equal(await p.ev(`document.getElementById('av-frame').__before`), 1, 'the same frame');
  });
  // the draft's frame on page2.html, reloaded once its fingerprint changes to `fp`
  const draftFp = (fp) => p.ev(`(window.__fake.fp = ${J(fp)}, Date.now())`);
  const DRAFT = `/artifact/wt/${WT}/${SLUG}/`;

  await t.test('R7: a draft, two reloads asking at once: the later one wins, even when the earlier one\'s answer comes first (final-1 F1)', async () => {
    put(draft, 'd2');
    await open(`${VIEW}?at=${WT}`, WT, 'd2');
    await follow(20, `TS.path === 'page2.html'`);
    // the first reload's ask is held, then answers 200 (page2.html there); the second's is held, then
    // answers 404 (removed since): the second chose from the newer state, so its fallback is what loads
    await p.ev(`(window.__artStatus[${J(`${DRAFT}page2.html`)}] = [{ status: 200, hold: 'a' }, { status: 404, hold: 'b' }], true)`);
    const t0 = await draftFp('1'.repeat(64));
    await soon(`__artAsks.length === 1`, 'the first reload asking');
    await draftFp('2'.repeat(64));
    await soon(`__artAsks.length === 2`, 'the second reload asking');
    await p.ev(`(__artRelease.a(), true)`);
    // long enough for the first to load page2.html, were it let through
    await sleep(1500);
    await p.ev(`(__artRelease.b(), true)`);
    const got = await soonIn(p, 10000)(`__titles.find((x) => x.t > ${t0})`, 'a reload');
    assert.equal(got.title, 'd2', 'the later reload\'s page: the opened one');
    assert.equal(await src(), DRAFT, "the frame's src");
    await sleep(1500);
    assert.deepEqual(await p.ev(`__titles.filter((x) => x.t > ${t0}).map((x) => x.title)`), ['d2'], 'one reload, no later one');
  });

  await t.test("R8: a draft, its ask failing (a network error): the owner's place kept (final-1 F2)", async () => {
    put(draft, 'd3');
    await open(`${VIEW}?at=${WT}`, WT, 'd3');
    await follow(20, `TS.path === 'page2.html'`);
    await p.ev(`(window.__artStatus[${J(`${DRAFT}page2.html`)}] = 0, true)`);
    await changeAndSee(() => draftFp('3'.repeat(64)), 'd3', 'd3-page2', `${DRAFT}page2.html`);
    assert.deepEqual(await p.ev('__artAsks'), [`${DRAFT}page2.html`], 'the reload asked for page2.html and its ask failed');
  });
});
