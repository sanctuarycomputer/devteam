// kit-83 verification: today's pages are unchanged. One bare project, served once with main's
// index.html and hub.html and once with this branch's; in headless Chrome at 1280x900, every element of
// each of today's sections, a question's peek, and the hub's page: its box and every standard computed
// property (custom properties, --*, left out: the block adds tokens nothing reads yet), compared.
//
// Run from the worktree root, with Node 22, DEVTEAM_* unset (it sets its own HOME and ports):
//   git show origin/main:docs/devteam/dashboard/index.html > /tmp/x/index.html   (and hub.html)
//   node docs/devteam-dev/tickets/kit-83-dashboard-shell-contract/compare/compare.mjs <dir with main's two pages>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PORTS, bareProject, dashboardOnFreePort, serverUp } from '../../../../../test/lib/kit.mjs';
import { openChrome } from '../../../../../test/lib/chrome.mjs';

const mainDir = process.argv[2];
const here = process.cwd();
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kit83-compare-'));
const HUB = PORTS + 2;
const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(HUB), DEVTEAM_PORT_BASE: String(PORTS + 3), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
for (const k of Object.keys(env)) if (/^DEVTEAM_(ROLE|TICKET|FEATURE|RUN|SUPERVISOR|HOME)$|^TMUX/.test(k)) delete env[k];
const root = bareProject(base, 'compare');
const dt = (args) => { const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: root, env: { ...env, DEVTEAM_ROLE: 'supervisor' }, encoding: 'utf8' }); if (r.status) throw new Error(r.stderr); return r.stdout.trim(); };
const Q = dt(['ask', '--question', 'Ship it?', '--choices', '[{"label":"Yes"},{"label":"No"}]']);
const SECTIONS = ['overview', 'goals', 'inbox', 'progress', 'board', 'library', 'loop', 'trust', 'retros', 'health', 'monitoring'];

// every element under the root: its path, its box, and a hash of its standard computed properties
const DUMP = `(() => {
  const out = {};
  const key = (e) => { const p = []; for (let x = e; x && x !== document.documentElement; x = x.parentElement) p.unshift(x.tagName.toLowerCase() + (x.id ? '#' + x.id : '') + ':' + [...x.parentElement.children].indexOf(x)); return p.join('>'); };
  for (const e of document.querySelectorAll('body, body *')) {
    for (const pe of [null, '::before', '::after']) {
      const cs = getComputedStyle(e, pe);
      if (pe && cs.content === 'none') continue;
      let s = '';
      for (let i = 0; i < cs.length; i++) { const n = cs[i]; if (!n.startsWith('--')) s += n + ':' + cs.getPropertyValue(n) + ';'; }
      const r = e.getBoundingClientRect();
      out[key(e) + (pe || '')] = { s, box: [r.left, r.top, r.width, r.height].map((v) => Math.round(v)).join(',') };
    }
  }
  return out;
})()`;

async function shoot(label) {
  const { dash, port } = await dashboardOnFreePort(root, env);
  await serverUp(`http://127.0.0.1:${HUB}/`);
  const chrome = await openChrome();
  const p = await chrome.newPage();
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  // the clock and the polls held still, so both runs draw the same moment
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.setInterval = () => 0;' });
  const shots = {};
  const settle = async (ready) => { for (let i = 0; i < 400; i++) { if (await p.ev(ready).catch(() => false)) break; await new Promise((r) => setTimeout(r, 50)); } await new Promise((r) => setTimeout(r, 800)); };
  for (const s of [...SECTIONS, `q/${Q}`]) {
    await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#${s}` });
    await settle("!document.querySelector('main.waiting')");
    shots[`#${s}`] = await p.ev(DUMP);
  }
  await p.send('Page.navigate', { url: `http://127.0.0.1:${HUB}/` });
  await settle("document.querySelector('#tabs').children.length > 0");
  shots.hub = await p.ev(DUMP);
  p.close();
  await chrome.close();
  await dash.stop();
  return shots;
}

const dash = path.join(root, 'docs/devteam/dashboard');
const put = (from) => { for (const f of ['index.html', 'hub.html']) fs.copyFileSync(path.join(from, f), path.join(dash, f)); };
put(mainDir);
const A = await shoot('main');
put(path.join(here, 'docs/devteam/dashboard'));
const B = await shoot('branch');
const report = [];
let elements = 0, diffs = 0;
for (const page of Object.keys(A)) {
  const a = A[page], b = B[page];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let n = 0;
  for (const k of keys) {
    elements++;
    if (!a[k] || !b[k]) { n++; if (n <= 5) report.push(`${page}: ${k} only in ${a[k] ? 'main' : 'branch'}`); continue; }
    if (a[k].s !== b[k].s || a[k].box !== b[k].box) {
      n++;
      if (n <= 5) {
        const pa = Object.fromEntries(a[k].s.split(';').filter(Boolean).map((x) => [x.slice(0, x.indexOf(':')), x.slice(x.indexOf(':') + 1)]));
        const pb = Object.fromEntries(b[k].s.split(';').filter(Boolean).map((x) => [x.slice(0, x.indexOf(':')), x.slice(x.indexOf(':') + 1)]));
        const props = Object.keys({ ...pa, ...pb }).filter((x) => pa[x] !== pb[x]).map((x) => `${x}: ${pa[x]} → ${pb[x]}`);
        report.push(`${page}: ${k}${a[k].box !== b[k].box ? ` box ${a[k].box} → ${b[k].box}` : ''}${props.length ? ` ${props.join('; ')}` : ''}`);
      }
    }
  }
  diffs += n;
  report.unshift(`${page}: ${Object.keys(a).length} elements (main), ${Object.keys(b).length} (branch), ${n} differ`);
}
console.log(report.join('\n'));
console.log(`total: ${elements} element boxes compared, ${diffs} differ; digest main ${crypto.createHash('sha256').update(JSON.stringify(A)).digest('hex').slice(0, 12)}, branch ${crypto.createHash('sha256').update(JSON.stringify(B)).digest('hex').slice(0, 12)}`);
fs.rmSync(base, { recursive: true, force: true });
process.exit(diffs ? 1 : 0);
