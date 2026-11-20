// What attachments.*.test.mjs share. The kit's upload routes (devteam.mjs) and the naming rules
// they share with the cloud gateway, and the dropped files an answer or a turn carries.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
// the suite's shared env scrub, tmux shim and stand-ins (before anything that reads the environment)
import { bareProject, dashboardOnFreePort } from './kit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// test/lib/, so the kit is two levels up (the line moved here from test/attachments.test.mjs)
const kit = path.resolve(here, '..', '..', 'docs', 'devteam');
// ports of its own, apart from the blocks lib/kit.mjs hands out (20000 and up); set after its import, so these win
const PORTS = 10000 + (process.pid % 90) * 100;
const HUB = PORTS;
const P = PORTS + 1;
process.env.DEVTEAM_HUB_PORT = String(HUB);
process.env.DEVTEAM_PORT_BASE = String(P);
process.env.DEVTEAM_HUB_RETRY_MS = '500';
delete process.env.DEVTEAM_CLAIM_TOKEN;

// --- the shared upload rules ---------------------------------------------------------------------
// The kit's copy of the rules, loaded from the script by itself (as modelFns loads its block).
function rulesFromKit() {
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const i = src.indexOf('/* upload rules start */'), j = src.indexOf('/* upload rules end */');
  assert.ok(i >= 0 && j > i, 'the markers are missing: the upload rules block in devteam.mjs');
  return vm.runInContext(`${src.slice(i, j)}\n;({ UPLOAD_RULES, safeUploadName, shellQuote, dropPaste, isDropImage, dropSpace })`, vm.createContext({}));
}

// --- the laptop's upload route (the dashboard server) ------------------------------------------
const R = rulesFromKit().UPLOAD_RULES;
// The folder a laptop keeps a project's dropped files in, worked out here as the spec says.
function expectedFolder(root) {
  const real = fs.realpathSync(root);
  return `${path.basename(real).replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 40)}-${crypto.createHash('sha256').update(real).digest('hex').slice(0, 8)}`;
}
const newFolderName = (day = new Date().toISOString().slice(0, 10)) => `${day}-${crypto.randomBytes(12).toString('hex')}`;

// One request, any shape: a body sent whole, in chunks (no Content-Length: chunked), or held back
// (`hold`: what's declared never comes). Resolves with the answer, or how the connection ended, or
// { timedOut } after `within` ms. Headers set to null are left out.
function request(port, route, { method = 'POST', headers = {}, body = null, chunks = null, gapMs = 50, hold = false, within = 20000 } = {}) {
  return new Promise((resolve) => {
    const h = {};
    for (const [k, v] of Object.entries(headers)) if (v !== null && v !== undefined) h[k] = v;
    if (body !== null) h['content-length'] = String(Buffer.byteLength(body));
    const t0 = Date.now();
    const r = http.request({ host: '127.0.0.1', port, path: route, method, headers: h, agent: false });
    let done = false;
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); r.destroy(); resolve({ ms: Date.now() - t0, ...v }); };
    const timer = setTimeout(() => finish({ timedOut: true }), within);
    r.on('response', (res) => {
      const bufs = [];
      res.on('data', (b) => bufs.push(b));
      res.on('end', () => { const bytes = Buffer.concat(bufs); const text = bytes.toString('utf8'); let json = null; try { json = JSON.parse(text); } catch {} finish({ status: res.statusCode, headers: res.headers, text, body: text, bytes, json }); });
      res.on('error', (e) => finish({ error: e.code ?? e.message }));
    });
    r.on('error', (e) => finish({ error: e.code ?? e.message }));
    if (chunks) {
      (async () => {
        for (const c of chunks) { if (done) return; r.write(c); await new Promise((w) => setTimeout(w, gapMs)); }
        if (!hold && !done) r.end();
      })();
    } else if (hold) r.flushHeaders();
    else r.end(body ?? undefined);
  });
}

// A real dashboard on a throwaway HOME and a project of its own. extraEnv: a value of undefined unsets it.
async function laptop(t, extraEnv = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-attach-'));
  const home = path.join(base, 'home');
  fs.mkdirSync(home);
  const env = { ...process.env, HOME: home, DEVTEAM_BOX: 'off', DEVTEAM_HUB_PORT: String(PORTS + 60), DEVTEAM_PORT_BASE: String(PORTS + 61), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'DEVTEAM_HOME', 'DEVTEAM_GATEWAY', 'DEVTEAM_UPLOADS_DIR', 'DEVTEAM_UPLOAD_MAX', 'DEVTEAM_UPLOAD_TOTAL', 'DEVTEAM_UPLOAD_FREE', 'DEVTEAM_UPLOAD_STALL_MS', 'DEVTEAM_UPLOAD_BODY_MS', 'TMUX', 'TMUX_PANE']) delete env[k];
  for (const [k, v] of Object.entries(extraEnv)) { if (v === undefined) delete env[k]; else env[k] = v; }
  let dash = null;
  t.after(async () => { await dash?.stop(); fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const root = bareProject(base, 'attach');
  const started = await dashboardOnFreePort(root, env);
  dash = started.dash;
  const port = started.port;
  const folder = () => path.join(home, '.devteam', 'uploads', expectedFolder(root));
  const own = { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' };
  const post = (name, body, headers = {}, how = {}) => request(port, `/upload?name=${encodeURIComponent(name)}`, { headers: { ...own, ...headers }, body, ...how });
  // a GET as the dashboard's own page sends one: same-origin, and no Origin
  const get = (route, headers = {}, method = 'GET') => request(port, route, { method, headers: { host: own.host, 'sec-fetch-site': 'same-origin', ...headers } });
  // a command in the project, as the owner (no DEVTEAM_ROLE) unless the env says otherwise
  const dt = (args, more = {}) => spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: root, env: { ...env, ...more }, encoding: 'utf8', timeout: 120000 });
  // an owner action, as the dashboard's own page posts it
  const api = (name, body) => request(port, `/api/${name}`, { headers: { host: own.host, origin: own.origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { base, root, port, home, env, folder, post, get, dt, api, stop: () => dash.stop(), out: () => dash.out() };
}
const LAPTOP = { timeout: 240000 };

// --- files on answers and turns (spec §6) --------------------------------------------------------
const SUP = { DEVTEAM_ROLE: 'supervisor' };
// Every log line the project holds, live and durable: a refusal leaves the count where it was.
function logLineCount(L) {
  let n = 0;
  for (const d of ['run/log', 'project/log']) {
    const dir = path.join(L.root, 'docs/devteam', d);
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) n += fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).length;
  }
  return n;
}
const ownerLogFile = (L) => path.join(L.root, 'docs/devteam/run/log', `owner-${new Date().toISOString().slice(0, 7)}.jsonl`);
// A question the supervisor asks, and a thread the owner starts: what the answers and turns go on.
function askQuestion(L, q = 'Which one?') {
  const r = L.dt(['ask', '--kind', 'owner-decision', '--question', q], SUP);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split('\n')[0];
}
function newThread(L) {
  const r = L.dt(['thread', 'new', '--title', 'About the shots', '--', 'first words']);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split('\n')[0];
}
const questionOf = (L, id) => JSON.parse(L.dt(['log', '--type', 'question', '--json']).stdout).find((q) => q.id === id);
async function upload(L, name, bytes) {
  const r = await L.post(name, bytes);
  assert.equal(r.status, 200, r.text);
  return r.json.path;
}

export { askQuestion, expectedFolder, laptop, LAPTOP, logLineCount, newFolderName, newThread, ownerLogFile, P, questionOf, R, request, rulesFromKit, SUP, upload };
