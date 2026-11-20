// browser-hygiene's family (kit-223): the state, hooks and helpers test/browser-hygiene.test.mjs and
// test/browser-hygiene.profile.test.mjs share, moved from the first unchanged. State that hooks set is
// exported live (export let), so the tests read it by its bare name. The CLI runs async, never through a
// blocking call: the fixture site lives in this process and must keep answering.
import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { canDrive } from './chrome.mjs';
import { monoFixture, until } from './kit.mjs';
import { startSites } from './sites.mjs';
import { validate } from '../fixtures/browser/check.mjs';

const skip = canDrive ? false : 'needs Chrome and Node 22+';
export let tmp;
const homes = [];
const newHome = () => { const h = fs.mkdtempSync(path.join(tmp, 'home-')); homes.push(h); return h; };
export let site, own;
const projects = [];
// Every verb's stdout and stderr, and every control secret read, for the never-print sweep (T5-6).
const seen = [];
const secrets = new Set();

// A fixture project whose CLI runs as the supervisor with a throwaway HOME (monoFixture sets none).
function project(name, home) {
  const F = monoFixture(name);
  const env = { ...F.env({ DEVTEAM_ROLE: 'supervisor' }), HOME: home, DEVTEAM_TEST: '1', DEVTEAM_TEST_BROWSER_ALLOW: `${site.port},${own.port}` };
  const P = { ...F, name, home, env, key: `${name}-${crypto.createHash('sha1').update(fs.realpathSync(F.old)).digest('hex').slice(0, 12)}` };
  P.profile = path.join(home, '.devteam', 'browser', P.key);
  P.state = path.join(F.old, 'docs', 'devteam', 'run', 'browser', 'state.json');
  projects.push(P);
  return P;
}
// browser <args> on project P: { status, out, err }.
export function cli(P, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...P.env, ...extraEnv };
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
    const child = spawn(process.execPath, [path.join(P.old, 'docs/devteam/scripts/devteam.mjs'), 'browser', ...args], { cwd: P.old, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 90000);
    child.on('error', reject);
    child.on('close', (status) => { clearTimeout(timer); seen.push(out, err); resolve({ status, out: out.trim(), err: err.trim() }); });
  });
}
// The test's own pages for the screenshot's fail-closed checks (T5-1) and the review's minors: a page
// whose CSP blocks any injected <style> (its own sheet is a file), a field in a closed shadow root, a
// frame from another site (localhost against 127.0.0.1: another process), an image whose title is its
// file name, and a fragment link.
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const BOX = 'position:absolute;left:20px;width:300px;height:40px;font-size:32px;border:0;padding:0;margin:0;background:#fff;outline:none';
function startOwn() {
  const html = (body, head = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8">${head}<title>Own</title></head><body>${body}</body></html>`;
  let port;
  const pages = {
    '/strict': [html('<input id="pw" type="password" value="zqpwzqpw"><input id="code" type="text" autocomplete="one-time-code" value="ZQCODEZQ"><input id="plain" type="text" value="zqzqzq">', '<link rel="stylesheet" href="/strict.css">'), { 'content-security-policy': "default-src 'self'; style-src 'self'" }],
    '/strict.css': [`html,body{margin:0;background:#fff} input{${BOX}} #pw{top:20px;background:linear-gradient(#000,#000);-webkit-background-clip:text;background-clip:text} #code{top:100px;-webkit-text-stroke:2px #000} #plain{top:180px}`, { 'content-type': 'text/css' }],
    '/shadow': [html(`<div><template shadowrootmode="closed"><style>input{${BOX};top:20px}</style><input type="password" value="zqpwzqpw"></template></div><input type="text" value="zqzqzq" style="${BOX};top:100px">`, '<style>html,body{margin:0;background:#fff}</style>')],
    '/framed': [null],
    // T5b-1: once the hide has edited the first field's style, the page adds a second password field
    '/late': [html(`<input id="a" type="password" value="zqpwzqpw" style="${BOX};top:20px"><script>const a = document.getElementById('a'); let done = false; new MutationObserver(() => { if (done || !/transparent/.test(a.getAttribute('style') ?? '')) return; done = true; const b = document.createElement('input'); b.type = 'password'; b.value = 'zqlatezq'; b.style.cssText = ${JSON.stringify(`${BOX};top:100px`)}; document.body.appendChild(b); }).observe(a, { attributes: true });</script>`)],
    '/object': [null],
    '/inner': [html('<input type="password" value="zqpwzqpw">')],
    '/hash': [html('<h1>Hash</h1><p><a href="#part">Part</a></p><p id="part">Part</p>')],
    '/img/zqimagetokenzqimagetoken.png': [PNG1, { 'content-type': 'image/png' }],
  };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const [body, headers] = u.pathname === '/framed' ? [html(`<iframe src="http://localhost:${port}/inner"></iframe>`)] : u.pathname === '/object' ? [html(`<object data="http://localhost:${port}/inner" type="text/html"></object>`)] : pages[u.pathname] ?? ['not found'];
    res.writeHead(pages[u.pathname] ? 200 : 404, { 'content-type': 'text/html; charset=utf-8', ...headers });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve({ port, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) }); }));
}
// The pids of processes whose command line carries a profile under one of this file's HOMEs.
export function testBrowserPids() {
  if (!fs.existsSync('/proc')) return [];
  const pids = [];
  for (const d of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    let cmd; try { cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8'); } catch { continue; }
    if (homes.some((h) => cmd.includes(`--user-data-dir=${path.join(h, '.devteam', 'browser')}${path.sep}`))) pids.push(Number(d));
  }
  return pids;
}
// Alive as the spec means it: kill(pid, 0) works and the process isn't a zombie.
export function alive(pid) {
  try { process.kill(pid, 0); } catch (err) { if (err.code !== 'EPERM') return false; }
  try { const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return st.slice(st.lastIndexOf(')') + 2)[0] !== 'Z'; } catch { return false; }
}
export const readState = (P) => { const s = JSON.parse(fs.readFileSync(P.state, 'utf8')); if (/[1-9a-f]/.test(s.control_secret ?? '')) secrets.add(s.control_secret); return s; };
export const cmdline = (pid) => fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
// Starts run one at a time across the file: the two chains run at once, and two projects' daemons
// starting together can pick the same free view port before either binds it. ms is the start's own.
let starting = Promise.resolve();
export function startCli(P, extra) {
  const run = starting.then(async () => { const t0 = Date.now(); const r = await cli(P, ['start'], extra); return { ...r, ms: Date.now() - t0 }; });
  starting = run.catch(() => {});
  return run;
}
export async function started(P, extra) {
  const r = await startCli(P, extra);
  assert.equal(r.status, 0, `start: ${r.err || r.out}`);
  assert.match(r.out, /browser running \(preview [a-z]+-[a-z]+(-\d+)?, profile /);
  return r;
}
export async function statusJson(P) {
  const r = await cli(P, ['status', '--json']);
  assert.equal(r.status, 0, r.err);
  const s = JSON.parse(r.out);
  assert.deepEqual(validate('status', s), []);
  return s;
}
export async function stopped(P) {
  const before = fs.existsSync(P.state) ? readState(P) : null;
  const r = await cli(P, ['stop']);
  assert.equal(r.status, 0, r.err);
  if (before) await until(() => !alive(before.chrome_pid) && !alive(before.daemon_pid), 'the stopped browser gone');
}

export let h; // the start/stop round trip, two starts, E5, K2, Review Focus 5; then F, G
export let g; // H, I, beside h's chain
// after waits for it: with every test filtered out (--test-name-pattern), node runs after while
// before is still starting the site, which would then keep the process alive.
let setup = Promise.resolve();
// Groups and pids the test made for H and I; each test kills its own, and this catches the rest. Only
// these are ever signalled as a group: never one the test didn't create.
export const ownGroups = new Set();
export async function opened(P, url) {
  const r = await cli(P, ['open', url]);
  assert.equal(r.status, 0, `open: ${r.err || r.out}`);
  return r;
}

// The file's hooks, and its temp folder, start when the file calls this at its top (no work at import).
// With sweep, the one after hook first runs J2's sweep over everything the file's verbs printed (when
// the file isn't skipped and a verb ran), then stops everything whatever the sweep found.
export function hygieneFile({ sweep = false } = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-browser-hy-'));
  before(() => {
    if (skip) return;
    setup = (async () => {
      site = await startSites();
      own = await startOwn();
      h = project('brw-h', newHome());
      g = project('brw-g', newHome());
    })();
    return setup;
  });
  after(async () => {
    if (skip) return;
    try {
      if (sweep && seen.length > 0) noSecretPrinted();
    } finally {
      await setup.catch(() => {});
      for (const G of ownGroups) { try { process.kill(-G, 'SIGKILL'); } catch {} }
      for (const P of projects) await cli(P, ['stop']).catch(() => {});
      for (const pid of testBrowserPids()) { try { process.kill(pid, 'SIGKILL'); } catch {} }
      for (const P of projects) P.done();
      await site?.close();
      await own?.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}

// J2's body (T5-6, the spec's J2 for this file): everything every verb printed here.
export function noSecretPrinted() {
  const all = seen.join('\n');
  assert.ok(secrets.size >= 2, 'control secrets were read');
  [...secrets].forEach((v, i) => assert.ok(!all.includes(v), `control secret ${i} printed`));
  site.sessions().forEach((v, i) => assert.ok(!all.includes(v), `session ${i} printed`));
  for (const [what, v] of [['the typed marker', 'zq-marker'], ['the typed text', '--force now'], ['the password', site.password], ['the code', site.code], ['a fixture field value', 'zqpwzqpw'], ['a fixture code value', 'ZQCODEZQ'], ['the late field value', 'zqlatezq']]) assert.ok(!all.includes(v), `${what} printed`);
}
