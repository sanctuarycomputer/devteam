// The hub's pages under the measure check (dashboard-shell@1, docs/devteam/dashboard/shell.md §9):
// each page in PAGES must measure clean at 1440x900, 720x800 and 390x844. The list is added to only
// by the hub's tickets. The hub is the one a dashboard starts on its DEVTEAM_HUB_PORT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PORTS, bareProject, serverUp, startDashboard, until } from './lib/kit.mjs';
import { canDrive, openChrome } from './lib/chrome.mjs';
import { SIZES, measureAt } from './lib/measure.mjs';

// { path, ready?, opts? }: the hub's path (with its hash), what must be true before it is measured, and measure options
// The Overview and Settings scroll inside their views (overflow: auto), where the measure's overflow
// check doesn't look: each is let out first (the fixture's pages are short), so it is checked (kit-94).
const PAGES = [
  { path: '/#overview', ready: "(document.getElementById('overview').style.overflow = 'visible', document.querySelectorAll('.ov-card').length > 0)", opts: { view: '#ov-body', bar: 'header', ignore: '#tl, iframe' } },
  { path: '/#settings', ready: "(document.getElementById('settings-view').style.overflow = 'visible', !document.getElementById('settings-view').hidden)", opts: { view: '#hub-settings', bar: 'header', ignore: '#tl, iframe' } },
];

test('the hub measure: every listed page at three sizes', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 300000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-hub-measure-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const HUB = PORTS + 2;
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(HUB), DEVTEAM_PORT_BASE: String(PORTS + 3), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'DEVTEAM_HOME', 'TMUX', 'TMUX_PANE']) delete env[k];
  const root = bareProject(base, 'measure');
  // on a port of the block the hub scans (DEVTEAM_PORT_BASE), so the Overview has its card
  const dash = startDashboard(root, env);
  t.after(() => dash.stop());
  await until(() => /dashboard on http/.test(dash.out()) || dash.p.exitCode !== null, 'the dashboard');
  await serverUp(`http://127.0.0.1:${HUB}/`);
  // the project's first hello, with its pulse, before a page waits on its card
  await until(async () => { try { const l = await (await fetch(`http://127.0.0.1:${HUB}/instances.json`)).json(); return l.instances?.some((x) => x.pulse); } catch { return false; } }, 'the project in the hub\'s list');
  const chrome = await openChrome();
  t.after(() => chrome.close());
  const p = await chrome.newPage();
  t.after(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  const url = (at) => `http://127.0.0.1:${HUB}${at}`;
  for (const [i, pg] of PAGES.entries()) {
    const res = await measureAt(p, url(pg.path), { ready: pg.ready ?? 'true', ...(pg.opts || {}) });
    // a result for each of the three sizes
    if (!i) { assert.deepEqual(Object.keys(res), SIZES.map(([w, h]) => `${w}x${h}`)); for (const r of Object.values(res)) assert.ok(Array.isArray(r)); }
    for (const [size, fails] of Object.entries(res)) assert.deepEqual(fails, [], `${pg.path} at ${size}`);
  }
});
