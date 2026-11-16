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
    assert.equal(await p.ev("fetch('/api/data').then((r) => r.json()).then((d) => d.metrics.cost.unpriced_models['gpt-x'])"), 3);
  });
});
