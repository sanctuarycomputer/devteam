// kit-174: the Efficiency page beside Trust. Real headless Chrome over a real bare-project dashboard;
// only the page's fetch is wrapped (test/lib/kit.mjs dataRewriteInit), so /api/data carries a known
// efficiency (kit-173's shape) and metrics, and every write the page makes is recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PORTS, bareProject, dashboardOnFreePort, dataRewriteInit, effThread, efficiencyFixture } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

// A wait on a condition in the page.
const soonIn = (p, ms = 15000) => async (expr, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v, err = null;
    try { v = await p.ev(expr); } catch (e) { err = e; }
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out: ${what}${err ? `; last: ${err.message}` : ''}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

test('the Efficiency page', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 300000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-efficiency-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 4), DEVTEAM_PORT_BASE: String(PORTS + 5), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'DEVTEAM_HOME', 'TMUX', 'TMUX_PANE']) delete env[k];
  const root = bareProject(base, 'efficiency');
  const { dash, port } = await dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const soon = soonIn(p);
  // a fresh document with fx's data: the previous init script removed, the new one added, then a load
  // from about:blank (a hash change alone keeps the old document and its script)
  let script = null;
  const load = async (fx, hash = '#efficiency') => {
    if (script) await p.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script });
    script = (await p.send('Page.addScriptToEvaluateOnNewDocument', { source: dataRewriteInit(fx) })).identifier;
    // nothing still saving: the page asks before leaving while a press is out (beforeunload), and that
    // dialog, which nothing here answers, would hold the tab (kit-914)
    await soon("typeof SAVING !== 'number' || SAVING === 0", 'nothing still saving');
    await p.send('Page.navigate', { url: 'about:blank' });
    await soon("location.href === 'about:blank'", 'a blank page');
    await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/${hash}` });
    await soon("!!window.__fx && !!DATA && !document.querySelector('main.waiting')", 'the dashboard drawn');
  };

  await t.test('the fixture reaches the page', async () => {
    await load(efficiencyFixture(), '#overview');
    assert.equal(await p.ev("fetch('/api/data').then((r) => r.json()).then((d) => d.efficiency.weeks.length)"), 12);
    // values only the fixture has (the server's own efficiency has 12 weeks too)
    assert.equal(await p.ev("fetch('/api/data').then((r) => r.json()).then((d) => d.efficiency.best.usd_per_point)"), 33.2);
    assert.equal(await p.ev("fetch('/api/data').then((r) => r.json()).then((d) => d.metrics.cost.unpriced_models['gpt-x'])"), 3);
    await p.ev("window.__fx.efficiency = null; void 0");
    assert.equal(await p.ev("fetch('/api/data').then((r) => r.json()).then((d) => 'efficiency' in d)"), false);
  });

  const texts = (sel) => p.ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => e.textContent.replace(/\\s+/g, ' ').trim())`);
  const text = (sel) => p.ev(`(document.querySelector(${JSON.stringify(sel)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`);
  // a Where it goes block's text, by its heading
  const block = (h) => p.ev(`([...document.querySelectorAll('#efficiency .eff-obs')].find((b) => b.querySelector('h4')?.textContent.trim() === ${JSON.stringify(h)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`);
  // the card, and every fit chart drawn at its width (fitCharts' own mark, data-w): the charts draw a
  // frame after the card, from the ResizeObserver, and push what is below them down, so a click aimed
  // before then can land where the item was
  const drawn = () => soon("!!document.querySelector('#efficiency .card .sec') && [...document.querySelectorAll('#efficiency .fit[data-fit]')].every((f) => +f.dataset.w > 0)", 'the Efficiency card and its charts');
  const WHERE = ['Tokens by phase', 'Hours by phase', 'USD by phase', 'USD by model', 'Tokens'];

  await t.test('nav: Efficiency right after Trust, counting the score', async () => {
    await load(efficiencyFixture());
    await drawn();
    const hrefs = await p.ev("[...document.querySelectorAll('.side nav.nav[data-group=\"autonomy\"] a')].map((a) => a.getAttribute('href'))");
    assert.equal(hrefs[hrefs.indexOf('#trust') + 1], '#efficiency', hrefs.join(' '));
    assert.equal(await soon("document.querySelector('a[href=\"#efficiency\"] .count')?.textContent.trim()", 'the count'), '31%');
    assert.equal(await text('#page-title'), 'Efficiency');
  });

  await t.test('one card, four sections, no OODA, no trials', async () => {
    assert.equal(await p.ev("document.querySelectorAll('#efficiency .card').length"), 1);
    assert.match(await text('#efficiency .card .card-head'), /Efficiency Score/);
    assert.deepEqual(await texts('#efficiency .card > .sec > .lbl'), ['Score', 'Where it goes', 'Waste', 'Suggestions']);
    assert.equal(await p.ev("[...document.querySelectorAll('#efficiency *')].filter((e) => ['Observe', 'Orient', 'Decide', 'Act'].includes(e.textContent.trim())).length"), 0);
    assert.equal(await p.ev("document.querySelectorAll('#efficiency table').length"), 0);
    assert.doesNotMatch(await p.ev("document.querySelector('#efficiency').outerHTML"), /Autonomy Score/);
  });

  await t.test('where it goes: from observe, with the source line', async () => {
    assert.deepEqual(await texts('#efficiency .eff-obs h4'), WHERE);
    for (const h of ['Hours by phase', 'USD by phase']) {
      const b = await block(h);
      assert.match(b, /build/); assert.match(b, /final-review/);
      assert.doesNotMatch(b, /metrics-only-phase/);
    }
    // largest first, each in its unit
    const rows = (h) => p.ev(`[...([...document.querySelectorAll('#efficiency .eff-obs')].find((b) => b.querySelector('h4')?.textContent.trim() === ${JSON.stringify(h)})?.querySelectorAll('.bars > div') ?? [])].map((r) => [r.firstElementChild.textContent.trim(), r.lastElementChild.textContent.trim()])`);
    assert.deepEqual(await rows('USD by phase'), [['build', '$128'], ['planning', '$94'], ['final-review', '$81'], ['spec', '$61']]);
    assert.deepEqual((await rows('Hours by phase')).map((r) => r[0]), ['build', 'final-review', 'planning', 'spec']);
    assert.deepEqual((await rows('Tokens by phase')).map((r) => r[0]), ['build', 'planning', 'spec', 'final-review']);
    assert.deepEqual(await rows('Tokens'), [['cache reads', '9.0M'], ['output', '3.1M'], ['input', '2.4M'], ['cache writes', '1.2M']]);
    assert.match(await block('Tokens by phase'), /build/);
    assert.match(await block('USD by phase'), /build\s*\$128/);
    assert.match(await block('Hours by phase'), /build\s*21\.4h/);
    assert.match(await block('USD by model'), /claude-opus-5-5\s*\$447/);
    assert.doesNotMatch(await block('USD by model'), /metrics-only-model/);
    assert.match(await block('Tokens'), /output\s*3\.1M/);
    const src = await text('#efficiency .eff-src');
    assert.match(src, /Measured from the agents' own session logs/);
    assert.match(src, /Unpriced: gpt-x/);
    await load(efficiencyFixture({ source: 'reported' }));
    await drawn();
    assert.match(await text('#efficiency .eff-src'), /Nothing measured: spend shows only what agents reported/);
  });

  await t.test('fleet keeps its own and loses the four', async () => {
    // Health folded into Sensors › Fleet (kit-93): its own tables, none of the four
    await load(efficiencyFixture(), '#sensors?st=fleet');
    await soon("!!document.querySelector('#monitoring [data-tbl=\"fleet:findings\"] tr[data-row]')", 'the findings');
    const heads = await p.ev("[...document.querySelectorAll('#monitoring .card > .card-head')].map((h) => [...h.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim())");
    assert.deepEqual(heads, ['Findings', 'Set aside', 'Checks before merge', 'Flaky tests', 'Slowest tests']);
    const all = await text('#monitoring');
    for (const h of ['Hours by phase', 'USD by phase', 'USD by model', 'Tokens']) assert.ok(!all.includes(h), `${h} is not on Fleet`);
    assert.match(await text('#monitoring [data-tbl="fleet:findings"]'), /no phase line for 3 hours/);
  });

  await t.test('efficiency missing: Where it goes from metrics, the rest None', async () => {
    await load(efficiencyFixture({ efficiency: false }));
    await drawn();
    for (const h of ['Hours by phase', 'USD by phase']) assert.match(await block(h), /metrics-only-phase/);
    assert.match(await block('USD by model'), /metrics-only-model/);
    assert.match(await block('Tokens'), /output\s*9\.9M/);
    assert.match(await block('Tokens by phase'), /None/);
    const sec = (l) => p.ev(`([...document.querySelectorAll('#efficiency .card > .sec')].find((s) => s.querySelector('.lbl')?.textContent.trim() === ${JSON.stringify(l)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`);
    assert.match(await sec('Score'), /None/);
    assert.match(await sec('Waste'), /None/);
    assert.match(await sec('Suggestions'), /None this week/);
    assert.equal(await text('a[href="#efficiency"] .count'), '');
    assert.deepEqual(await p.ev('window.__errors'), []);
  });

  // ---- the Score section ----
  const stat = (k) => p.ev(`(() => { const s = [...document.querySelectorAll('#efficiency .stat')].find((x) => x.querySelector('.k')?.textContent.trim() === ${JSON.stringify(k)}); return s ? { v: s.querySelector('b')?.textContent.trim(), sub: (s.querySelector('.dim')?.textContent ?? '').trim(), title: s.getAttribute('title') ?? '', mini: s.classList.contains('mini'), spark: s.querySelector('svg.sparkline path')?.getAttribute('d') ?? null } : null; })()`);
  const charts = () => soon("!!document.querySelector('#efficiency [data-fit=\"eff-score\"] svg') && !!document.querySelector('#efficiency [data-fit=\"eff-phase\"] svg')", 'the score charts');
  const moves = (d) => (String(d).match(/M/g) || []).length;
  const MINI = ['$ per merged point', 'hours per merged point', 'reviews passed the first time', 'cache reads of input tokens', 'escaped defects', 'merged points'];

  await t.test('score: this week, last week, parts', async () => {
    await load(efficiencyFixture());
    await drawn();
    assert.equal(await text('#efficiency .score b'), '31%');
    assert.match(await text('#efficiency .score'), /last week 67%/);
    assert.match(await text('#efficiency .score-w'), /spend, time and rework against the best of the last 12 weeks, with quality held/);
    const [sp, tm, rw] = [await stat('spend'), await stat('time'), await stat('rework')];
    assert.deepEqual([sp.v, tm.v, rw.v], ['16%', '15%', '62%']);
    assert.equal(sp.sub, 'held down: an escaped defect this week');
    assert.equal(tm.sub, 'held down: an escaped defect this week');
    assert.equal(rw.sub, 'reviews passed the first time');
    assert.match(rw.title, /task review/);
    assert.match((await stat('reviews passed the first time')).title, /task review/);
    await load(efficiencyFixture({ defect: false }));
    await drawn();
    assert.equal(await text('#efficiency .score b'), '72%');
    const [sp2, tm2] = [await stat('spend'), await stat('time')];
    assert.deepEqual([sp2.v, tm2.v], ['81%', '74%']);
    assert.equal(sp2.sub, 'best $33 ÷ this week $41 per point');
    assert.equal(tm2.sub, 'best 5.0 ÷ this week 6.8 hours per point');
  });

  await t.test('the 12-week line', async () => {
    await load(efficiencyFixture());
    await charts();
    const l = await p.ev(`(() => { const s = document.querySelector('#efficiency [data-fit="eff-score"] svg'); const vb = s.viewBox.baseVal; const cs = [...s.querySelectorAll('circle')];
      return { n: cs.length, slots: cs.map((c) => +c.dataset.i), d: s.querySelector('path.line').getAttribute('d'), tw: cs.find((c) => c.classList.contains('tw'))?.dataset.i, lw: cs.find((c) => c.classList.contains('lw'))?.dataset.i,
        low: (() => { const c = cs.find((x) => x.classList.contains('tw')); return +c.getAttribute('cy') > 0 && +c.getAttribute('cy') < vb.height; })(), titles: cs.map((c) => c.querySelector('title')?.textContent) }; })()`);
    assert.equal(l.n, 11);
    assert.ok(!l.slots.includes(3), `no point at the empty week: ${l.slots}`);
    assert.ok(moves(l.d) >= 2, `the line breaks at the empty week: ${l.d}`);
    assert.equal(l.tw, '11'); assert.equal(l.lw, '10');
    assert.ok(l.low, 'the 31 point inside the plot');
    assert.equal(l.titles.at(-1), 'this week: 31%');
    assert.equal(l.titles.at(-2), 'last week: 67%');
  });

  await t.test('sparklines', async () => {
    const minis = await p.ev("[...document.querySelectorAll('#efficiency .stat.mini .k')].map((k) => k.textContent.trim())");
    assert.deepEqual(minis, MINI);
    assert.equal((await stat('$ per merged point')).v, '$41 · best $33');
    assert.equal((await stat('hours per merged point')).v, '6.8 · best 5.0');
    assert.equal((await stat('escaped defects')).v, '1 (target 0)');
    assert.equal((await stat('merged points')).v, '8');
    assert.equal((await stat('cache reads of input tokens')).v, '58%');
    for (const k of ['$ per merged point', 'hours per merged point', 'cache reads of input tokens']) assert.ok(moves((await stat(k)).spark) >= 2, `${k}: a gap at the empty week`);
    for (const k of ['escaped defects', 'merged points']) assert.equal(moves((await stat(k)).spark), 1, `${k}: no gap`);
  });

  await t.test('phase bars', async () => {
    const b = await p.ev(`(() => { const s = document.querySelector('#efficiency [data-fit="eff-phase"] svg'); const slots = [...Array(12).keys()].map((i) => s.querySelectorAll('rect[data-i="' + i + '"]').length);
      return { slots, titles: [...s.querySelectorAll('rect')].map((r) => r.querySelector('title')?.textContent ?? ''), legend: [...document.querySelectorAll('#efficiency [data-fit="eff-phase"] .legend span')].map((x) => x.textContent.trim()) }; })()`);
    assert.deepEqual(b.slots, [3, 3, 3, 0, 3, 3, 4, 4, 4, 4, 4, 4]);
    assert.ok(b.titles.some((x) => /^this week: build \$\d+(\.\d+)? of \$\d+(\.\d+)?$/.test(x)), b.titles.slice(-4).join(' | '));
    assert.equal(b.legend.length, 4);
    assert.match(b.legend[0], /^build \$/);
  });

  const noNaN = async () => {
    const r = await p.ev(`(() => { const bad = [], out = [];
      for (const s of document.querySelectorAll('#efficiency svg')) {
        for (const e of s.querySelectorAll('*')) for (const a of ['d', 'points', 'x', 'y', 'cx', 'cy', 'width', 'height', 'x1', 'x2', 'y1', 'y2']) if (/NaN|Infinity|undefined/.test(e.getAttribute(a) ?? '')) bad.push(e.tagName + ' ' + a + '=' + e.getAttribute(a));
        const vb = s.viewBox.baseVal;
        for (const c of s.querySelectorAll('circle')) { const x = +c.getAttribute('cx'), y = +c.getAttribute('cy'); if (!(x >= 0 && x <= vb.width && y >= 0 && y <= vb.height)) out.push(x + ',' + y); }
      } return { bad, out }; })()`);
    assert.deepEqual(r, { bad: [], out: [] });
  };
  await t.test('no NaN, nothing outside the plot', async () => { await noNaN(); });

  await t.test('all weeks unscored', async () => {
    const weeks = efficiencyFixture().efficiency.weeks.map((w) => ({ ...w, score: null, parts: null, usd_per_point: null, hours_per_point: null, cache_read_share: null, usd_by_phase: {}, tokens_by_phase: {}, tickets: 0, points: 0, escaped_defects: 0, first_pass: 1, first_passes: 0 }));
    const fx = efficiencyFixture({ weeks });
    Object.assign(fx.efficiency, { best: null, parts: null, score: { this_week: null, last_week: null } });
    await load(fx);
    await drawn();
    assert.equal(await text('#efficiency .score b'), '–');
    assert.match(await text('#efficiency .score'), /last week –/);
    for (const k of ['spend', 'time', 'rework']) assert.equal((await stat(k)).v, '–');
    for (const k of ['spend', 'time']) assert.equal((await stat(k)).sub, '–');
    assert.equal((await stat('$ per merged point')).v, '–');
    await soon("!!document.querySelector('#efficiency [data-fit=\"eff-score\"] svg')", 'the score line');
    assert.equal(await p.ev("document.querySelectorAll('#efficiency [data-fit=\"eff-score\"] circle').length"), 0);
    assert.match(await text('#efficiency [data-fit="eff-phase"]'), /^None$/);
    await noNaN();
    assert.deepEqual(await p.ev('window.__errors'), []);
  });

  await t.test('charts at the width they get', async () => {
    await load(efficiencyFixture());
    await charts();
    const fits = () => p.ev("[...document.querySelectorAll('#efficiency [data-fit]')].map((f) => { const s = f.querySelector(':scope > svg'); return [f.dataset.fit, Math.abs(+s.getAttribute('width') - f.clientWidth) <= 1, +s.getAttribute('width'), f.clientWidth]; })");
    const fitted = (what) => soon("[...document.querySelectorAll('#efficiency [data-fit]')].every((f) => { const s = f.querySelector(':scope > svg'); return s && f.clientWidth > 0 && Math.abs(+s.getAttribute('width') - f.clientWidth) <= 1; })", what);
    await fitted('fitted at 1440');
    await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await fitted('fitted at 390, no reload');
    const at390 = await fits();
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await fitted('fitted at 1440 again');
    const at1440 = await fits();
    assert.ok(at390[0][2] < at1440[0][2], `narrower at 390: ${JSON.stringify(at390)} ${JSON.stringify(at1440)}`);
  });

  await t.test('charts draw when their page comes into view', async () => {
    await load(efficiencyFixture(), '#overview');
    // drawn while hidden: no width, so no chart yet
    await soon("!!document.querySelector('#efficiency [data-fit=\"eff-score\"]')", 'the card, hidden');
    assert.equal(await p.ev("document.querySelectorAll('#efficiency [data-fit] svg').length"), 0);
    await p.ev("location.hash = '#efficiency'; void 0");
    await charts();
  });

  await t.test('charts follow new data', async () => {
    const now = () => p.ev("[document.querySelectorAll('#efficiency [data-fit=\"eff-score\"] circle').length, document.querySelectorAll('#efficiency [data-fit=\"eff-phase\"] rect[data-i=\"0\"]').length]");
    assert.deepEqual(await now(), [11, 3]);
    // an old week changes (only the charts read it): both charts are drawn again
    await p.ev("window.__fx.efficiency.weeks[0] = { ...window.__fx.efficiency.weeks[0], score: null, usd_by_phase: {} }; void 0");
    await soon("document.querySelectorAll('#efficiency [data-fit=\"eff-score\"] circle').length === 10 && document.querySelectorAll('#efficiency [data-fit=\"eff-phase\"] rect[data-i=\"0\"]').length === 0", 'both charts redrawn');
  });

  // ---- Waste and Suggestions ----
  const SEC = (l) => `[...document.querySelectorAll('#efficiency .card > .sec')].find((s) => s.querySelector('.lbl')?.textContent.trim() === ${JSON.stringify(l)})`;
  const ITEM = (id) => `document.querySelector('#efficiency [data-sugg="' + CSS.escape(${JSON.stringify(id)}) + '"]')`;
  const VIEW = (id) => `#efficiency?suggestion=${encodeURIComponent(id)}`;
  const overlaps = (a, b) => `(() => { const r = ${a}, q = ${b}; return !!r && !!q && r.left < q.right && r.right > q.left && r.top < q.bottom && r.bottom > q.top; })()`;
  const TH = 't-20261116-000000001-owner';
  const openThread = (id = 'eff-costly-ticket-kit-87', extra = {}) => effThread({ id: TH, subject: { kind: 'page', view: VIEW(id), quote: 'x' }, title: "Find where a costly ticket's spend went · Look at where kit-87 spent its dollars", ...extra });
  const focusKey = async (sel, k = 'Enter') => { await p.ev(`(${sel}).focus(); void 0`); await p.key(k); };

  await t.test('waste in plain words', async () => {
    await load(efficiencyFixture());
    await drawn();
    const rows = await p.ev(`[...${SEC('Waste')}.querySelectorAll('.rowline')].map((r) => ({ t: r.textContent.replace(/\\s+/g, ' ').trim(), r: r.querySelector('.r').textContent.trim(), tab: r.getAttribute('tabindex'), open: r.dataset.open ?? null, href: r.getAttribute('href') }))`);
    assert.equal(rows.length, 2);
    assert.match(rows[0].t, /kit-87 cost 3\.1× the median merged ticket per point \(\$254\)/);
    assert.match(rows[1].t, /58% of input tokens were cache reads, under 60%/);
    assert.deepEqual(rows.map((r) => r.r), ['costly ticket', 'low cache hits']);
    for (const r of rows) assert.doesNotMatch(r.t, /costly-ticket|low-cache-hit/);
    assert.equal(rows[0].open, 'observation/o-20261115-000000001-supervisor');
    assert.deepEqual([rows[1].tab, rows[1].open, rows[1].href], [null, null, null]);
  });

  await t.test('waste opens its observation', async () => {
    const first = `${SEC('Waste')}.querySelectorAll('.rowline')[0]`;
    await p.ev(`(${first}).click(); void 0`);
    await soon("location.hash.includes('observation/o-20261115-000000001-supervisor')", 'the peek, by a click');
    await p.ev("location.hash = '#efficiency'; void 0");
    await soon("location.hash === '#efficiency' && !!document.querySelector('#efficiency .rowline')", 'back on Efficiency');
    await focusKey(first);
    await soon("location.hash.includes('observation/o-20261115-000000001-supervisor')", 'the peek, by Enter');
    await p.ev("location.hash = '#efficiency'; void 0");
    await soon("location.hash === '#efficiency'", 'back on Efficiency');
    await p.ev(`(${SEC('Waste')}.querySelectorAll('.rowline')[1]).click(); void 0`);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(await p.ev('location.hash'), '#efficiency');
    assert.deepEqual(await p.ev('window.__errors'), []);
  });

  await t.test('suggestions numbered, in words, no buttons', async () => {
    const items = await p.ev(`[...${SEC('Suggestions')}.querySelectorAll('.sugg-i')].map((i) => ({ n: i.querySelector('.sugg-n').textContent.trim(), go: i.querySelector('.sugg-go').textContent.trim(), t: i.textContent }))`);
    assert.deepEqual(items.map((i) => i.n), ['1', '2', '3', '4']);
    assert.deepEqual(items.map((i) => i.go), ["Find where a costly ticket's spend went", 'Use a smaller model where it fits', 'Keep the prompt cache', 'Suggestion']);
    for (const i of items) assert.doesNotMatch(i.t, /costly-ticket|smaller-model|mystery/);
    assert.match(items[1].t, /claude-opus-5-5 took 97% of spend/);
    assert.match(items[1].t, /Estimated effect: about \$75 a week/);
    assert.equal(await p.ev(`${SEC('Suggestions')}.querySelectorAll('button').length`), 0);
  });

  await t.test('a suggestion starts a thread on its page subject and writes nothing else', async () => {
    await p.ev('window.__writes.length = 0; void 0');
    await p.click('#efficiency [data-sugg="eff-smaller-model-claude-opus-5-5"]');
    const view = VIEW('eff-smaller-model-claude-opus-5-5');
    await soon(`TL.draft?.subject?.view === ${JSON.stringify(view)}`, 'a draft on the suggestion');
    assert.equal(await p.ev('TL.draft.subject.kind'), 'page');
    assert.deepEqual(await p.ev('window.__writes'), []);
    await p.click('#tl-c-text');
    await p.type('try it');
    await p.click('[data-tl-send]');
    await soon('window.__writes.length >= 1', 'the thread posted');
    await new Promise((r) => setTimeout(r, 600));
    const w = await p.ev('window.__writes');
    assert.equal(w.length, 1, JSON.stringify(w));
    assert.equal(w[0].method, 'POST');
    assert.equal(w[0].url, '/api/thread-new');
    const body = JSON.parse(w[0].body);
    assert.equal(body.subject.kind, 'page');
    assert.equal(body.subject.view, view);
    await p.ev('tlClose(); void 0');
    await focusKey(ITEM('eff-cache-prompt-cache'));
    await soon(`TL.draft?.subject?.view === ${JSON.stringify(VIEW('eff-cache-prompt-cache'))}`, 'a draft by Enter');
    assert.equal(await p.ev('window.__writes.length'), 1);
    await p.ev('tlClose(); void 0');
  });

  await t.test('an open thread is opened, not doubled', async () => {
    await load(efficiencyFixture({ threads: [openThread(), effThread({ id: 't-20261116-000000002-owner', status: 'resolved', subject: { kind: 'page', view: VIEW('eff-cache-prompt-cache') } })] }));
    await drawn();
    await soon(`TL.threads.some((t) => t.id === ${JSON.stringify(TH)})`, 'the threads read');
    await p.click('#efficiency [data-sugg="eff-costly-ticket-kit-87"]');
    await soon(`TL.open === ${JSON.stringify(TH)}`, 'the open thread opened');
    assert.equal(await p.ev('TL.draft'), null);
    await p.ev('tlClose(); void 0');
    await p.click('#efficiency [data-sugg="eff-cache-prompt-cache"]');
    await soon(`TL.draft?.subject?.view === ${JSON.stringify(VIEW('eff-cache-prompt-cache'))}`, 'a resolved thread does not count');
    assert.deepEqual(await p.ev('window.__writes'), []);
    await p.ev('tlClose(); void 0');
  });

  await t.test('a Shift+click on a suggestion is its page subject too', async () => {
    // the open thread on item 1 (from the load above): pointing at the item opens it, a second thread never starts
    const at = await p.at('#efficiency [data-sugg="eff-costly-ticket-kit-87"] .sugg-go');
    await p.hold('Shift', true);
    await p.move(at.x, at.y, 8);
    await soon('tlShowing()', 'the thread layer pointing');
    await p.clickAt(at.x, at.y, 8);
    await p.hold('Shift', false);
    await soon(`TL.open === ${JSON.stringify(TH)}`, 'the open thread opened by Shift+click');
    assert.deepEqual(await p.ev('window.__writes'), []);
    await p.ev('tlClose(); void 0');
  });

  await t.test("where a suggestion's thread lives", async () => {
    assert.equal(await p.ev("tWhere({ kind: 'page', view: '#efficiency?suggestion=eff-x' })"), 'Efficiency');
    assert.equal(await p.ev("tWhere({ kind: 'page', view: '#trust' })"), 'Trust');
    assert.equal(await p.ev("tWhere({ kind: 'page', view: '#loop/decide' })"), 'Loop, Decide');
    const s = JSON.stringify(openThread().subject);
    assert.equal(await p.ev(`tlRowOf(${s}).el === ${ITEM('eff-costly-ticket-kit-87')}`), true);
    await soon(overlaps(`document.querySelector('#tl-pins [data-tl-pin="${TH}"]')?.getBoundingClientRect()`, `${ITEM('eff-costly-ticket-kit-87')}.getBoundingClientRect()`), 'the pin on the item');
    // an id a selector or a query would choke on
    const odd = 'eff-cache-a.b:c&x=1';
    const one = [{ id: odd, kind: 'cache', what: 'Resume sessions', evidence: 'restarts', effect: 'about $1 a week', usd: 1, per: 'week' }];
    await load(efficiencyFixture({ suggestions: one }));
    await drawn();
    await p.click('#efficiency .sugg-i');
    await soon("TL.draft?.subject?.view === '#efficiency?suggestion=eff-cache-a.b%3Ac%26x%3D1'", 'the encoded view');
    await p.ev('tlClose(); void 0');
    await load(efficiencyFixture({ suggestions: one, threads: [openThread(odd)] }));
    await drawn();
    await soon(overlaps(`document.querySelector('#tl-pins [data-tl-pin="${TH}"]')?.getBoundingClientRect()`, `${ITEM(odd)}.getBoundingClientRect()`), 'its pin on the item');
  });

  await t.test('the dock brings a suggestion thread home', async () => {
    await load(efficiencyFixture({ threads: [openThread()] }), '#overview');
    await soon(`TL.threads.some((t) => t.id === ${JSON.stringify(TH)})`, 'the threads read');
    assert.equal(await p.ev(`tlTargetRect(${JSON.stringify(openThread().subject)})`), null);
    assert.equal(await p.ev(`!!document.querySelector('#tl-pins [data-tl-pin="${TH}"]')`), false);
    await p.ev(`(document.querySelector('[data-tl-open="${TH}"]') ?? { click: () => tlOpen(${JSON.stringify(TH)}) }).click(); void 0`);
    await soon("location.hash.startsWith('#efficiency') && PAGE_NOW === 'efficiency'", 'on Efficiency');
    await soon(`(() => { const r = ${ITEM('eff-costly-ticket-kit-87')}.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()`, 'the item in view');
    await soon(overlaps(`document.querySelector('#tl-pins [data-tl-pin="${TH}"]')?.getBoundingClientRect()`, `${ITEM('eff-costly-ticket-kit-87')}.getBoundingClientRect()`), 'the pin on the item');
  });

  await t.test('no false "changed since"', async () => {
    await p.ev(`tlOpen(${JSON.stringify(TH)}); void 0`);
    await soon("!document.getElementById('tl-card').hidden && !!document.getElementById('tl-c-ctx').textContent", 'the card');
    assert.doesNotMatch(await text('#tl-c-ctx'), /changed since/);
    await p.ev('tlClose(); void 0');
    const fx = efficiencyFixture({ threads: [openThread()] });
    fx.efficiency.suggestions[0].what = 'Look somewhere else';
    await load(fx);
    await drawn();
    await soon(`TL.threads.some((t) => t.id === ${JSON.stringify(TH)})`, 'the threads read');
    await p.ev(`tlOpen(${JSON.stringify(TH)}); void 0`);
    await soon("/changed since/.test(document.getElementById('tl-c-ctx').textContent)", 'changed since, when the title differs');
    await p.ev('tlClose(); void 0');
  });

  await t.test('Enter places the draft by the item', async () => {
    await load(efficiencyFixture());
    await drawn();
    await focusKey(ITEM('eff-cache-prompt-cache'));
    await soon('!!TL.draft', 'a draft');
    const at = await soon("(() => { const c = document.getElementById('tl-card'); if (c.hidden) return null; const r = c.getBoundingClientRect(); return [r.left, r.top, r.width, innerWidth, innerHeight]; })()", 'the card placed');
    for (const v of at) assert.ok(Number.isFinite(v), JSON.stringify(at));
    assert.ok(at[0] >= 0 && at[0] < at[3] && at[1] >= 0 && at[1] < at[4], JSON.stringify(at));
    await p.ev('tlClose(); void 0');
  });

  await t.test('redraw keeps the suggestion thread', async () => {
    await load(efficiencyFixture({ threads: [openThread()] }));
    await drawn();
    await soon(`TL.threads.some((t) => t.id === ${JSON.stringify(TH)})`, 'the threads read');
    await p.ev(`tlOpen(${JSON.stringify(TH)}); void 0`);
    await soon(overlaps(`document.querySelector('#tl-pins [data-tl-pin="${TH}"]')?.getBoundingClientRect()`, `${ITEM('eff-costly-ticket-kit-87')}.getBoundingClientRect()`), 'the pin on the item');
    await p.ev(`window.__held = ${ITEM('eff-costly-ticket-kit-87')}; window.__held.focus(); void 0`);
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(await p.ev('document.activeElement === window.__held && window.__held.isConnected'), true);
    assert.equal(await p.ev(overlaps(`document.querySelector('#tl-pins [data-tl-pin="${TH}"]')?.getBoundingClientRect()`, `${ITEM('eff-costly-ticket-kit-87')}.getBoundingClientRect()`)), true);
    await p.ev('tlClose(); void 0');
  });

  await t.test('none this week', async () => {
    await load(efficiencyFixture({ suggestions: [], waste: [] }));
    await drawn();
    assert.match(await p.ev(`${SEC('Suggestions')}.textContent`), /None this week/);
    assert.match(await p.ev(`${SEC('Waste')}.textContent`), /None/);
    assert.deepEqual(await p.ev('window.__errors'), []);
  });
});
