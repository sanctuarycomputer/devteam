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
    assert.match(await block('USD by model'), /claude-opus-5-5/);
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
});
