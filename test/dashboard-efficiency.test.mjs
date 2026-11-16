// kit-174: the Efficiency page beside Trust. Real headless Chrome over a real bare-project dashboard;
// only the page's fetch is wrapped (test/lib/kit.mjs dataRewriteInit), so /api/data carries a known
// efficiency (kit-173's shape) and metrics, and every write the page makes is recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PORTS, bareProject, dashboardOnFreePort, dataRewriteInit, efficiencyFixture } from './lib/kit.mjs';
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
  const drawn = () => soon("!!document.querySelector('#efficiency .card .sec')", 'the Efficiency card');
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
    await load(efficiencyFixture(), '#health');
    await soon("!!document.querySelector('#findings .card')", 'the findings');
    const heads = await texts('#health h3');
    for (const h of ['Hours by phase', 'USD by phase', 'USD by model', 'Tokens']) assert.ok(!heads.includes(h), `${h} left Health: ${heads.join(' | ')}`);
    assert.ok(heads.includes('Set aside'), heads.join(' | '));
    assert.ok(heads.some((h) => h.startsWith('Checks before merge')), heads.join(' | '));
    assert.match(await text('#findings'), /no phase line for 3 hours/);
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
});
