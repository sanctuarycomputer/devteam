// The draft test's later subtests (kit-106): the poll's guards (C9), a framed viewer tab (C10) and
// kit-206's outline, which a draft never shows (C6). Split from artifact-live-reload.test.mjs by kit-757
// so neither file nears CI's 300 s per-file watchdog; the top-level test keeps its name, and this file
// sets up a stage of its own (lib/artifact-live.mjs's draftStage). Headless Chrome against a real
// dashboard, the fingerprint route faked in the page; skipped where Chrome can't be driven.
// Ports: none of its own (lib/kit.mjs's +0 hub, +1..25)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDrive } from './lib/chrome.mjs';
import { J, SLUG, WT, sleep, soonIn, mock, land, draftStage } from './lib/artifact-live.mjs';

test('a viewer on a draft reloads by itself when its fingerprint changes', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 900000 }, async (t) => {
  const { F, edit, p, soon, VIEW, DASH_DRAFT, DASH_MAIN, open, asks, titles, NEW_FP } = await draftStage(t, 'live-reload-guards');

  await t.test("C9: the poll's guards: one ask at a time, given up at 5 s; a bad answer reloads nothing; an answer for a stage gone is dropped", async () => {
    await open(`${VIEW}?at=${WT}`, WT, 'v1');
    await soon('__fpAsks.length >= 1 && __fpAsks.every((x) => x.done)', 'the first ask answered');
    // (a) a new fp held 12 s: no second ask while it is out; the 5 s give-up lets the next tick ask
    // again well before the 12 s (within 5 s + one 2 s tick + slack); the held answer, given up, reloads nothing
    await p.ev(`(window.__fake.delay = 12000, window.__fake.fp = ${J(NEW_FP)}, true)`);
    const held = await soonIn(p, 5000)('__fpAsks.find((x) => !x.done)?.t', 'a held ask');
    await p.ev(`(window.__fake.delay = 0, window.__fake.fp = null, true)`);
    await sleep(Math.max(0, held + 4500 - await p.ev('Date.now()')));
    assert.equal(await p.ev(`__fpAsks.filter((x) => x.t > ${held}).length`), 0, 'no second ask while one is out');
    const again = await soonIn(p, 6000)(`__fpAsks.find((x) => x.t > ${held})?.t`, 'asked again after the 5 s give-up');
    assert.ok(again - held >= 5000 && again - held <= 8000, `asked again ${again - held} ms after the held ask (the give-up at 5 s, the hold 12 s)`);
    await sleep(Math.max(0, held + 12500 - await p.ev('Date.now()')));
    assert.equal((await titles()).length, 1, 'the given-up answer reloaded nothing');
    // (b) answers that aren't { fp: a string of 1 to 128 characters }
    const fp0 = await p.ev('TS.fp');
    for (const body of ['{}', '{"fp":null}', J({ fp: 'x'.repeat(129) }), J({ fp: '' }), 'not json']) {
      await p.ev(`(window.__fake.body = ${J(body)}, true)`);
      const n = await asks();
      await soon(`__fpAsks.length >= ${n} + 2`, `two asks answered ${body.slice(0, 20)}`);
      assert.equal((await titles()).length, 1, `${body.slice(0, 20)}: no reload`);
      assert.equal(await p.ev('TS.fp'), fp0, `${body.slice(0, 20)}: TS.fp unchanged`);
    }
    await p.ev('(window.__fake.body = null, true)');
    // (c) a new fp held 1.5 s; the stage goes to main in place while it is out: the answer is dropped
    await p.ev(`(window.__fake.delay = 1500, window.__fake.fp = ${J(NEW_FP)}, true)`);
    const n = await asks();
    await soon(`__fpAsks.length > ${n} && !__fpAsks[__fpAsks.length - 1].done`, 'a held ask with the new fp');
    // main's own fp, as /api/view gives it: since kit-750 (A1) a viewer on main reloads by itself on
    // any other, so a made-up one would reload it at the next check
    const mainFp = await p.ev(`fetch('/api/view?' + new URLSearchParams({ kind: 'artifact', slug: ${J(SLUG)}, at: 'main' })).then((r) => r.json()).then((j) => j.fp)`);
    await p.ev(`(showArtifact(${J(SLUG)}, 'main', { fp: ${J(mainFp)} }), true)`);
    await soon(`__titles.some((x) => x.title === 'main')`, "main's frame ready");
    await sleep(3000);
    assert.deepEqual(await titles(), ['v1', 'main'], "the answer for the draft didn't reload main's frame");
    assert.equal(await p.ev('TS.fp'), mainFp, "main's fp unchanged");
  });

  await t.test('C10: a framed viewer tab (the owner wrapper) on a draft makes no /api/artifact-fp ask', async () => {
    // the wrapper's parent is another origin, which no test here can serve within the viewer's
    // frame-ancestors; the tab stands in for it with window.parent another window (PAGE, kit106-framed)
    await open(`${VIEW}?at=${WT}&kit106-framed=1`, WT, 'v1');
    assert.equal(await p.ev('window.parent !== window && window.frameElement === null'), true, 'setup: the tab reads as framed by another origin');
    await sleep(8000);
    assert.equal(await asks(), 0, 'the framed viewer tab: no ask');
  });

  await t.test("C6: a draft never shows kit-206's outline, and main now reloads by itself without it (kit-750, A1)", async () => {
    const watchStale = `(() => { window.__wasStale = false; const b = document.getElementById('av-reload'); const look = () => { if (b.classList.contains('stale')) window.__wasStale = true; }; look(); new MutationObserver(look).observe(b, { attributes: true }); return true; })()`;
    const row = `(DATA?.library?.artifacts ?? []).find((a) => a.slug === ${J(SLUG)} && a.at === ${J(WT)})?.fp ?? null`;
    await open(DASH_DRAFT, WT, 'v1');
    await soon(`!!(${row})`, "the Library's row for the draft");
    const listed = await p.ev(row);
    await p.ev(watchStale);
    // the files change on disk: /api/data lists the new fp; the fake says nothing changed, so no reload
    edit('v2');
    await soonIn(p, 90000)(`(${row}) !== ${J(listed)}`, "the dashboard's read lists the draft's new fingerprint");
    await sleep(1000);
    assert.equal(await p.ev('window.__wasStale'), false, 'the draft never had the outline');
    // main: a second commit changes main's fingerprint; the frame loads it again by itself, and the
    // outline kit-206 had never shows (ruling A1, d-20261121-041756284)
    await open(DASH_MAIN, 'main', 'main');
    await p.ev(watchStale);
    land(F, mock('main2'));
    await soonIn(p, 90000)(`__titles.some((x) => x.title === 'main2')`, 'main reloaded to main2 by itself');
    await sleep(1000);
    assert.equal(await p.ev('window.__wasStale'), false, "main never had kit-206's outline");
    assert.equal(await p.ev(`document.getElementById('av-reload').classList.contains('stale')`), false, 'no outline after the reload');
    assert.equal(await asks(), 0, 'main: no /api/artifact-fp ask');
  });
});
