// Screenshots for kit-82 (m-20261115-070641604-supervisor): a refused answer staying on its card and
// a moved-link card, in light and dark, at desktop and phone widths. The same stub as
// test/dashboard-answers.test.mjs: /api/answer refuses, /api/data marks the second question's link moved.
// Run from the repo root with Node 22: node docs/devteam-dev/tickets/kit-82-answers-stay-visible/screenshots/shoot.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTS, bareProject, dashboardOnFreePort } from '../../../../../test/lib/kit.mjs';
import { openChrome } from '../../../../../test/lib/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const init = (moved) => `(() => {
  const si = window.setInterval;
  window.setInterval = (f, ms, ...a) => si(f, ms === 10000 ? 300 : ms, ...a);
  const real = window.fetch;
  window.fetch = async (u, o) => {
    if (String(u).startsWith('/api/answer') && o?.method === 'POST') return new Response(JSON.stringify({ error: 'Ship it? changed since you read it; read it again before you answer' }), { status: 409, headers: { 'content-type': 'application/json' } });
    const r = await real(u, o);
    if (!String(u).startsWith('/api/data') || !r.ok) return r;
    const d = await r.json();
    d.questions = (d.questions || []).map((q) => q.id !== ${JSON.stringify(moved)} ? q : { ...q, links_moved: 'moved', links: [{ name: 'mock', artifact: 'mock', title: 'The dashboard mock', sha256: 'a'.repeat(64), at: 'main', href: '#artifact/main/mock', changed: true }] });
    return new Response(JSON.stringify(d), { status: r.status, statusText: r.statusText, headers: r.headers });
  };
})();`;

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-shots-'));
const env = { ...process.env, DEVTEAM_HUB_PORT: String(PORTS + 58), DEVTEAM_PORT_BASE: String(PORTS + 59), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'TMUX', 'TMUX_PANE']) delete env[k];
const root = bareProject(base, 'shots');
const dt = (args) => { const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: root, env: { ...env, DEVTEAM_ROLE: 'supervisor' }, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
const Q1 = dt(['ask', '--question', 'Ship it?', '--choices', '[{"label":"Yes"},{"label":"No"}]']);
const Q2 = dt(['ask', '--question', 'Which layout for the Inbox?', '--choices', '[{"label":"One column"},{"label":"Two columns"}]']);
const { dash, port } = await dashboardOnFreePort(root, env);
const chrome = await openChrome();
const until = async (p, expr) => { for (let i = 0; i < 300; i++) { try { if (await p.ev(expr)) return; } catch {} await new Promise((r) => setTimeout(r, 50)); } throw new Error(`timed out: ${expr}`); };
try {
  for (const [scheme, w, h, mobile] of [['light', 1100, 900, false], ['dark', 1100, 900, false], ['light', 390, 1400, true], ['dark', 390, 1400, true]]) {
    const p = await chrome.newPage();
    await p.send('Page.enable');
    await p.send('Runtime.enable');
    await p.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile });
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: init(Q2) });
    await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#questions` });
    const card = `document.querySelector('#questions [data-qcard="${Q1}"]')`;
    await until(p, `!!${card} && !!document.querySelector('#questions [data-qcard="${Q2}"] [data-links-moved]')`);
    await p.ev(`(() => { const c = ${card}; c.querySelector('input[data-pick][value="No"]').click(); c.querySelector('textarea[data-q]').value = 'not this week'; c.querySelector('[data-answer]').click(); })()`);
    await until(p, `!!${card}?.querySelector('[data-refused]')`);
    // three refreshes later, the line is still there: that is what is shown
    await new Promise((r) => setTimeout(r, 1200));
    await until(p, `!!${card}?.querySelector('[data-refused]')`);
    await p.ev(`document.getElementById('questions').scrollIntoView(); void 0`);
    const { data } = await p.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const out = path.join(here, `refused-${mobile ? 'phone' : 'desktop'}-${scheme}.png`);
    fs.writeFileSync(out, Buffer.from(data, 'base64'));
    console.log(out);
    await p.close();
  }
} finally {
  await chrome.close();
  dash.stop();
  fs.rmSync(base, { recursive: true, force: true });
}
