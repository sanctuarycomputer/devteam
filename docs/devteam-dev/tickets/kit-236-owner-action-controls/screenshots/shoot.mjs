// Screenshots for kit-236 (m-20261115-081233736-supervisor): an owner-action card naming five records
// (a rule to retire, a rule already retired, an owner lesson to keep or retire, a goal to let go, a goal
// already let go), its recommendation as a line of text, Done pressed while three are unchanged, and a
// goal's Let go waiting for its confirm; in light and dark, at desktop and phone widths.
// Run from the repo root with Node 22: node docs/devteam-dev/tickets/kit-236-owner-action-controls/screenshots/shoot.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTS, bareProject, dashboardOnFreePort } from '../../../../../test/lib/kit.mjs';
import { openChrome } from '../../../../../test/lib/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-shots-'));
const env = { ...process.env, HOME: path.join(base, 'home'), DEVTEAM_HUB_PORT: String(PORTS + 46), DEVTEAM_PORT_BASE: String(PORTS + 47), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
fs.mkdirSync(env.HOME);
for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'DEVTEAM_HOME', 'TMUX', 'TMUX_PANE']) delete env[k];
const root = bareProject(base, 'shots');
const dt = (args, role = { DEVTEAM_ROLE: 'supervisor' }) => { const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: root, env: { ...env, ...role }, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim().split('\n')[0]; };
const lesson = (s, status) => { const id = dt(['knowledge', 'add', '--kind', 'fact', '--statement', s]); dt(['knowledge', 'set', id, '--status', status]); return id; };
const goal = (title) => dt(['goal', 'add', '--title', title, '--outcome', `${title} holds`, '--measure', 'gaps', '--target', '0', '--unit', 'gaps', '--direction', 'down', '--source', 'repo', '--check', 'echo 3', '--non-goals', 'none', '--preconditions', 'a']);
const KA = lesson('Running text is never wider than 39 characters', 'accepted');
const KR = lesson('Ship banners without asking', 'retired');
const KO = dt(['knowledge', 'add', '--kind', 'fact', '--statement', 'Running text max half the 12-column grid', '--for-owner', '--plain', 'Running text is never wider than half the grid.']);
const G = goal('Instance metrics on the hub');
const GL = goal('A goal');
dt(['goal', 'decide', GL, 'let-go', '--owner'], {});
const Q = dt(['ask', '--kind', 'owner-action', '--question', 'Please tidy your rules and goals: retire two rules, keep one, and let go two goals.',
  '--context', `- Retire ${KA} and ${KR}.\n- Keep ${KO}.\n- Let go ${G} and ${GL}.`, '--recommendation', 'Do all five', '--stake', '1', '--urgency', '1']);
const { dash, port } = await dashboardOnFreePort(root, env);
const chrome = await openChrome();
const until = async (p, expr) => { for (let i = 0; i < 400; i++) { try { if (await p.ev(expr)) return; } catch {} await new Promise((r) => setTimeout(r, 50)); } throw new Error(`timed out: ${expr}`); };
try {
  for (const [scheme, w, h, mobile] of [['light', 1280, 1000, false], ['dark', 1280, 1000, false], ['light', 390, 1500, true], ['dark', 390, 1500, true]]) {
    const p = await chrome.newPage();
    await p.send('Page.enable');
    await p.send('Runtime.enable');
    await p.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile });
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#questions` });
    const card = `document.querySelector('#questions [data-qcard="${Q}"]')`;
    await until(p, `!!${card}?.querySelector('[data-oa-rec="${KR}"] [data-oa-done]')`);
    // Done pressed while three are unchanged; the goal's Let go pressed once (waiting for its confirm)
    await p.ev(`(() => { const c = ${card}; c.querySelector('input[data-pick][value="Done"]').click(); c.querySelector('[data-answer]').click(); c.querySelector('[data-oa-goal]').click(); c.scrollIntoView(); })(); void 0`);
    await until(p, `!!${card}?.querySelector('[data-oa-notdone]') && /Confirm/.test(${card}.querySelector('[data-oa-goal]').textContent)`);
    const { data } = await p.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const out = path.join(here, `owner-action-${mobile ? 'phone' : 'desktop'}-${scheme}.png`);
    fs.writeFileSync(out, Buffer.from(data, 'base64'));
    console.log(out);
    await p.close();
  }
} finally {
  await chrome.close();
  await dash.stop();
  fs.rmSync(base, { recursive: true, force: true });
}
