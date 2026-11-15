// The dashboard's pages under the measure check (dashboard-shell@1, docs/devteam/dashboard/shell.md §9):
// each page in PAGES must measure clean at 1440x900, 720x800 and 390x844. The list is added to only
// by the index.html tickets, each with its own pages, peeks and threads; until the first adds one, a
// smoke run proves the plumbing on today's Overview without judging it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PORTS, bareProject, dashboardOnFreePort } from './lib/kit.mjs';
import { canDrive, openChrome } from './lib/chrome.mjs';
import { SIZES, measureAt } from './lib/measure.mjs';

// { hash, ready?, opts? }: the page's head, what must be true before it is measured, and measure options
const PAGES = [];

test('the dashboard measure: every listed page at three sizes', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 300000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-dash-measure-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 2), DEVTEAM_PORT_BASE: String(PORTS + 3), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'DEVTEAM_HOME', 'TMUX', 'TMUX_PANE']) delete env[k];
  const root = bareProject(base, 'measure');
  const { dash, port } = await dashboardOnFreePort(root, env);
  t.after(() => dash.stop());
  const chrome = await openChrome();
  t.after(() => chrome.close());
  const p = await chrome.newPage();
  t.after(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  const url = (hash) => `http://127.0.0.1:${port}/${hash}`;
  if (!PAGES.length) {
    // the plumbing, on today's Overview, which isn't on the shell yet: a result for each size, not a judgement
    const res = await measureAt(p, url('#overview'), { ready: "!document.querySelector('main.waiting')" });
    assert.deepEqual(Object.keys(res), SIZES.map(([w, h]) => `${w}x${h}`));
    for (const r of Object.values(res)) assert.ok(Array.isArray(r));
    return;
  }
  for (const pg of PAGES) {
    const res = await measureAt(p, url(pg.hash), { ready: pg.ready ?? 'true', ...(pg.opts || {}) });
    for (const [size, fails] of Object.entries(res)) assert.deepEqual(fails, [], `${pg.hash} at ${size}`);
  }
});
