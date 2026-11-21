// The viewer reloads a draft by itself when its files change (kit-106): every 2 s while the page is seen,
// a viewer on a draft asks /api/artifact-fp, and on a new fingerprint loads its frame again in a fresh
// frame (no history entry: kit-141's close rule), at the anchor its address carried or the page the lens
// last named. A 404 says the draft was landed or removed, links main's version (shown in place) and stops
// the asking; main and a published tree are never asked about, and keep kit-206's outline on Reload, which
// a draft never shows. Headless Chrome against a real dashboard; the fingerprint route is faked in the
// page (a fetch wrapper), so the test says when the draft "changed" and how the route answers.
// Skipped where Chrome can't be driven, as the kit's other Chrome tests are.
// Since kit-757 the draft test's later subtests (C9, C10, C6) are in artifact-live-reload.guards.test.mjs
// and main's place-keeping test in artifact-live-reload.main-place.test.mjs, each file with a stage of
// its own (lib/artifact-live.mjs's draftStage), so none nears CI's 300 s per-file watchdog.
// Ports: none of its own (lib/kit.mjs's +0 hub, +1..25)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDrive } from './lib/chrome.mjs';
import { SLUG, WT, sleep, soonIn, draftStage } from './lib/artifact-live.mjs';

test('a viewer on a draft reloads by itself when its fingerprint changes', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 900000 }, async (t) => {
  const { tree, p, soon, VIEW, DRAFT_HEAD, DASH_MAIN, open, openOverLibrary, asks, titles, change, reloadedSince, NEW_FP } = await draftStage(t, 'live-reload');

  await t.test('C1: a viewer tab on a draft: fp unchanged for 20 s, no reload; fp changed, reloaded within 3 s, in a fresh frame', async () => {
    await open(`${VIEW}?at=${WT}`, WT, 'v1');
    assert.match(await p.ev('TS.fp ?? ""'), /^[0-9a-f]{64}$/, 'opened with its fingerprint');
    const h0 = await p.ev('history.length');
    const viewAsks0 = await p.ev(`__reads.filter((x) => x.u.includes('/api/view?')).length`);
    await sleep(20000);
    assert.ok(await asks() >= 8, `asked every 2 s for 20 s (asked ${await asks()}x)`);
    assert.deepEqual(await titles(), ['v1'], 'fp unchanged for 20 s: never reloaded');
    assert.equal(await p.ev(`__reads.filter((x) => x.u.includes('/api/view?')).length`), viewAsks0, "the tab's 10 s /api/view ask is not made for a draft");
    const t0 = await change(NEW_FP);
    const got = await reloadedSince(t0, 'a reload after fp changed');
    assert.ok(got.t - t0 <= 3000, `reloaded ${got.t - t0} ms after fp changed (at most 3000)`);
    assert.equal(await p.ev('TS.fp'), NEW_FP, 'the stage now names the fingerprint it loaded');
    assert.equal(await p.ev('history.length'), h0, 'no history entry: a fresh frame');
    await sleep(4500);
    assert.equal((await titles()).length, 2, 'once: the same fp again reloads nothing');
  });

  await t.test("C1: the dashboard's stage on a draft reloads within 3 s too, and the close still counts no move", async () => {
    await openOverLibrary();
    await sleep(2500);
    assert.equal((await titles()).length, 1, 'no reload while fp is unchanged');
    const h0 = await p.ev('[history.length, AV_NAVS]');
    const t0 = await change(NEW_FP);
    const got = await reloadedSince(t0, 'a reload after fp changed');
    assert.ok(got.t - t0 <= 3000, `reloaded ${got.t - t0} ms after fp changed (at most 3000)`);
    assert.deepEqual(await p.ev('[history.length, AV_NAVS]'), h0, 'no history entry and no frame move counted: a fresh frame');
  });

  await t.test('C2: hidden, no ask; visible again, an ask at once', async () => {
    await open(`${VIEW}?at=${WT}`, WT);
    await soon('__fpAsks.length >= 2', 'two asks');
    await p.ev(`(window.__hidden = true, document.dispatchEvent(new Event('visibilitychange')), true)`);
    // an ask already in flight when it hid may land; none starts after
    await sleep(300);
    const n = await asks();
    await sleep(6000);
    assert.equal(await asks(), n, 'no /api/artifact-fp ask while hidden');
    assert.equal(await p.ev('__fpAsks.some((x) => x.hidden)'), false, 'none made while the page read as hidden');
    // shown again midway between two of the 2 s ticks (their phase is the last ask's): only an ask on
    // visibilitychange comes within 400 ms
    const last = await p.ev('__fpAsks[__fpAsks.length - 1].t');
    const now = await p.ev('Date.now()');
    const at = last + Math.ceil((now - last + 200) / 2000) * 2000 + 1000;
    await sleep(at - now);
    // the time taken before the event: the page's ask is logged while the event is dispatched
    const t0 = await p.ev(`(() => { const t = Date.now(); window.__hidden = false; document.dispatchEvent(new Event('visibilitychange')); return t; })()`);
    await sleep(400);
    const first = await p.ev(`__fpAsks.find((x) => x.t >= ${t0})?.t ?? null`);
    assert.ok(first !== null && first - t0 <= 400, `an ask at once when shown again (${first === null ? 'none' : `${first - t0} ms`} after, the tick ~1000 ms away)`);
  });

  await t.test("C3: a viewer tab: a 404 says the draft was landed or removed, links main's (shown in place), and stops asking", async () => {
    await open(`${VIEW}?at=${WT}`, WT, 'v1');
    await soon('__fpAsks.length >= 1', 'the first ask');
    await p.ev('(window.__fake.status = 404, true)');
    const note = await soonIn(p, 5000)(`(() => { const n = document.getElementById('av-note'); return !n.hidden && n.textContent.includes('This draft was landed or removed') && { text: n.textContent, href: n.querySelector('a')?.getAttribute('href') ?? null }; })()`, 'the note');
    assert.equal(note.href, `/view/artifact/${SLUG}`, "the note's link is main's version");
    const n = await asks();
    await sleep(6000);
    assert.equal(await asks(), n, 'no ask after the 404');
    const href = await p.ev('location.href');
    await p.click('#av-note a');
    await soon(`TS.at === 'main' && document.getElementById('av-frame').getAttribute('src') === '/artifact/main/${SLUG}/' && __titles.some((x) => x.title === 'main')`, "main's version on the stage");
    assert.equal(await p.ev('location.href'), href, 'shown in place: the address unchanged');
  });

  await t.test("C3: the dashboard: a 404 says so, links main's (shown in place), stops asking; × still closes to the page under", async () => {
    await openOverLibrary();
    await soon('__fpAsks.length >= 1', 'the first ask');
    await p.ev('(window.__fake.status = 404, true)');
    const note = await soonIn(p, 5000)(`(() => { const n = document.getElementById('av-note'); return !n.hidden && n.textContent.includes('This draft was landed or removed') && { href: n.querySelector('a')?.getAttribute('href') ?? null }; })()`, 'the note');
    assert.equal(note.href, `#artifact/main/${SLUG}`, "the note's link is main's version");
    const n = await asks();
    await sleep(6000);
    assert.equal(await asks(), n, 'no ask after the 404');
    const h0 = await p.ev('history.length');
    await p.click('#av-note a');
    await soon(`TS.at === 'main' && __titles.some((x) => x.title === 'main')`, "main's version on the stage");
    assert.deepEqual(await p.ev('[location.hash, history.length]'), [DRAFT_HEAD, h0], 'shown in place: no route, no history entry');
    await p.click('#av-close');
    await soon(`document.getElementById('artifact-view').hidden && location.hash === '#library'`, '× closes the viewer to #library');
  });

  await t.test('C4: a viewer on main or a tree makes no /api/artifact-fp ask', async () => {
    for (const [url, at] of [[VIEW, 'main'], [`${VIEW}?at=tree:${tree}`, `tree:${tree}`], [DASH_MAIN, 'main']]) {
      await open(url, at, 'main');
      await sleep(6000);
      assert.equal(await asks(), 0, `${url}: no ask`);
    }
  });

  await t.test("C5: a viewer tab's anchor is the frame's, and the reload keeps it", async () => {
    await open(`${VIEW}?at=${WT}#section`, WT);
    assert.match(await p.ev(`document.getElementById('av-frame').getAttribute('src')`), /#section$/, "the frame's src carries the anchor");
    assert.equal((await titles())[0], 'v1#section', 'the page loaded at the anchor');
    const t0 = await change(NEW_FP);
    const got = await reloadedSince(t0, 'a reload after fp changed');
    assert.equal(got.title, 'v1#section', 'reloaded at the anchor');    // a thread's hash (#talk/) or one over 200 characters is no anchor (the browser's hash never holds whitespace)
    for (const h of ['#talk/t-20261120-000000000-owner', `#${'a'.repeat(201)}`]) {
      await open(`${VIEW}?at=${WT}${h}`, WT);
      assert.equal(await p.ev(`document.getElementById('av-frame').getAttribute('src')`), `/artifact/wt/${WT}/${SLUG}/`, `${h.slice(0, 24)}: no anchor`);
    }
  });

  await t.test('C8: a reload keeps the page the owner followed a link to', async () => {
    await open(`${VIEW}?at=${WT}`, WT, 'v1');
    const r = await p.ev(`(() => { const b = document.getElementById('av-frame').getBoundingClientRect(); return { x: b.left + 20, y: b.top + 15 }; })()`);
    await p.clickAt(r.x, r.y);
    await soon(`__titles.some((x) => x.title === 'page2') && TS.path === 'page2.html'`, "the second page, as the lens names it");
    const t0 = await change(NEW_FP);
    const got = await reloadedSince(t0, 'a reload after fp changed');
    assert.equal(got.title, 'page2', 'reloaded on the second page');
  });
});
