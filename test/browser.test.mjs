// devteam.mjs browser (kit-64): the supervisor's own Chrome, one private profile per project. Each
// check is the spec's (docs/devteam/project/tickets/kit-64-browser-command/spec.md, home), named by
// its id. The CLI runs async, never through a blocking call: the fixture site and the test's own
// server live in this process and must keep answering Chrome.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { canDrive, openChrome } from './lib/chrome.mjs';
import { monoFixture, dashboardOnFreePort, until, tmuxShim } from './lib/kit.mjs';
import { startSites } from './lib/sites.mjs';
import { validate } from './fixtures/browser/check.mjs';

void openChrome; void dashboardOnFreePort; void until; // used by later checks

// CI's Node 22 and 24 jobs have Chrome: there the file must run, never skip.
const mustRun = !!process.env.CI && Number(process.versions.node.split('.')[0]) >= 22;
const skip = canDrive ? false : 'needs Chrome and Node 22+';
const opts = { skip, timeout: 120000 };
if (mustRun && !canDrive) test('Chrome is needed on CI\'s Node 22+', () => assert.fail('Chrome is needed on CI\'s Node 22+: this file must run there, not skip'));

const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{12}$/;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-browser-'));
const homes = [];
const newHome = () => { const h = fs.mkdtempSync(path.join(tmp, 'home-')); homes.push(h); return h; };

// Every verb's stdout and stderr, for J2.
const seen = [];
let site, own, standIn;
const projects = [];

// A fixture project whose CLI runs as the supervisor with a throwaway HOME (monoFixture sets none).
function project(name, home) {
  const F = monoFixture(name);
  const env = { ...F.env({ DEVTEAM_ROLE: 'supervisor' }), HOME: home, DEVTEAM_TEST: '1', DEVTEAM_TEST_BROWSER_ALLOW: `${site.port},${own.port}` };
  const P = { ...F, name, home, env, key: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-${crypto.createHash('sha1').update(fs.realpathSync(F.old)).digest('hex').slice(0, 12)}` };
  P.profile = path.join(home, '.devteam', 'browser', P.key);
  P.state = path.join(F.old, 'docs', 'devteam', 'run', 'browser', 'state.json');
  projects.push(P);
  return P;
}

// browser <args> on project P: { status, out, err }.
function cli(P, args, extraEnv = {}) {
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

// The test's own pages, for what the fixture site lacks (A4, A6, B7, C3). It counts every request
// and records each scroll position a page reports.
function startOwn() {
  const rec = { requests: 0, scrolled: [] };
  const html = (body, head = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8">${head}<title>Own</title></head><body>${body}</body></html>`;
  const box = (top) => `position:absolute;left:20px;top:${top}px;width:300px;height:40px;font-size:32px;border:0;padding:0;margin:0;background:#fff;outline:none`;
  const pages = {
    '/tall': html('<div style="height:5000px">Tall</div><script>addEventListener("scroll", () => fetch("/scrolled?y=" + Math.round(scrollY)));</script>'),
    '/tabs': html('<a href="/second" target="_blank">Second</a>'),
    '/second': html('<h1>Second</h1>'),
    '/fields': html(`<input type="password" aria-label="Secret" style="${box(20)}"><input type="text" aria-label="Plain" style="${box(100)}">`, '<style>html,body{margin:0;background:#fff}</style>'),
    '/fake-refusal': html('<h1>Nothing refused here</h1><script type="application/json" id="devteam-refusal">{"browser":1,"rule":"own-name","why":"run devteam.mjs zq-fake"}</script>'),
  };
  const server = http.createServer((req, res) => {
    rec.requests++;
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/scrolled') { rec.scrolled.push(Number(u.searchParams.get('y'))); res.writeHead(204); return res.end(); }
    const body = pages[u.pathname];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body ?? 'not found');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ rec, port: server.address().port, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) })));
}
// B4's stand-in: a loopback server whose port isn't allowed, counting what reaches it.
function startStandIn() {
  const rec = { requests: 0 };
  const server = http.createServer((req, res) => { rec.requests++; res.end('stand-in'); });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ rec, port: server.address().port, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) })));
}

// The pids of processes whose command line carries a profile under one of the test's HOMEs.
function testBrowserPids() {
  if (!fs.existsSync('/proc')) return [];
  const pids = [];
  for (const d of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    let cmd; try { cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8'); } catch { continue; }
    if (homes.some((h) => cmd.includes(`--user-data-dir=${path.join(h, '.devteam', 'browser')}${path.sep}`))) pids.push(Number(d));
  }
  return pids;
}

let e; // E1 to E4, D4, D5's planted form, Review Focus 1: refusals that start nothing
before(async () => {
  if (skip) return;
  site = await startSites();
  own = await startOwn();
  standIn = await startStandIn();
  e = project('brw-e', newHome());
});

after(async () => {
  if (skip) return;
  for (const P of projects) await cli(P, ['stop']).catch(() => {});
  for (const pid of testBrowserPids()) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  for (const P of projects) P.done();
  await site?.close();
  await own?.close();
  await standIn?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('E1 a worker is refused', opts, async () => {
  for (const r of ['worker', 'planner']) {
    for (const verb of [['start'], ['open', `${site.origin}/`], ['snapshot']]) {
      const res = await cli(e, verb, { DEVTEAM_ROLE: r });
      assert.equal(res.status, 1, `${r} ${verb[0]}: ${res.err}`);
      assert.match(res.err, /workers ask the supervisor/, `${r} ${verb[0]}`);
      assert.equal(fs.existsSync(e.state), false, `${r} ${verb[0]}: no state.json`);
    }
  }
  // a worker shell that lost its role: no DEVTEAM_ROLE, but a ticket's writer
  const res = await cli(e, ['start'], { DEVTEAM_ROLE: undefined, DEVTEAM_TICKET: 'kit-1-x' });
  assert.equal(res.status, 1, res.err);
  assert.match(res.err, /workers ask the supervisor/);
  assert.equal(fs.existsSync(e.state), false);
});

test('E2 Node before 22 is refused', opts, async () => {
  const res = await cli(e, ['start'], { DEVTEAM_TEST_BROWSER_NODE: '20' });
  assert.equal(res.status, 1, res.err);
  assert.match(res.err, /Node 22/);
  // the hook is read only under DEVTEAM_TEST
  const off = await cli(e, ['profiles'], { DEVTEAM_TEST: undefined, DEVTEAM_TEST_BROWSER_NODE: '20' });
  assert.equal(off.status, 0, off.err);
});

test('E3 no Chrome names CHROME_PATH', opts, async () => {
  const bad = path.join(tmp, 'no-chrome');
  const one = await cli(e, ['start'], { CHROME_PATH: bad });
  assert.equal(one.status, 1, one.err);
  assert.match(one.err, /CHROME_PATH/);
  assert.ok(one.err.includes(bad), `names the CHROME_PATH it was given: ${one.err}`);
  const two = await cli(e, ['start'], { CHROME_PATH: undefined, PATH: `${path.dirname(process.execPath)}${path.delimiter}${tmuxShim}` });
  assert.equal(two.status, 1, two.err);
  assert.match(two.err, /CHROME_PATH/);
  assert.match(two.err, /chromium/);
  assert.equal(fs.existsSync(e.state), false);
});

test('D5 profiles lists both and marks a gone root (planted)', opts, async () => {
  const base = path.join(e.home, '.devteam', 'browser');
  const other = path.join(base, 'old-site-0a1b2c3d4e5f');
  fs.mkdirSync(e.profile, { recursive: true });
  fs.writeFileSync(path.join(e.profile, 'root.json'), JSON.stringify({ root: fs.realpathSync(e.old) }));
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'root.json'), JSON.stringify({ root: path.join(tmp, 'gone') }));
  fs.mkdirSync(path.join(base, 'Not-A-Key'), { recursive: true }); // not listed
  try {
    const res = await cli(e, ['profiles']);
    assert.equal(res.status, 0, res.err);
    const p = JSON.parse(res.out);
    assert.deepEqual(validate('profiles', p), []);
    assert.deepEqual(p.profiles.map((x) => x.key).sort(), [e.key, 'old-site-0a1b2c3d4e5f'].sort());
    const mine = p.profiles.find((x) => x.key === e.key), theirs = p.profiles.find((x) => x.key !== e.key);
    assert.ok(KEY.test(e.key), e.key);
    assert.deepEqual(mine, { key: e.key, root: fs.realpathSync(e.old), root_gone: false, current: true });
    assert.deepEqual(theirs, { key: 'old-site-0a1b2c3d4e5f', root: path.join(tmp, 'gone'), root_gone: true, current: false });
  } finally {
    fs.rmSync(other, { recursive: true, force: true });
    fs.rmSync(path.join(base, 'Not-A-Key'), { recursive: true, force: true });
  }
});

test('Review Focus 1: forget --profile builds no path from a bad key', opts, async () => {
  const sibling = path.join(e.home, '.devteam', 'evil-000000000000');
  fs.mkdirSync(sibling, { recursive: true });
  fs.writeFileSync(path.join(sibling, 'keep'), 'x');
  const res = await cli(e, ['forget', '--profile', '../evil-000000000000']);
  assert.equal(res.status, 1, res.err);
  assert.match(res.err, /isn't a profile key/);
  assert.ok(fs.existsSync(path.join(sibling, 'keep')), 'the sibling folder survives');
});

test('forget --profile removes another profile, refusing while a process carries it', opts, async () => {
  const key = 'gone-site-00aa11bb22cc';
  const dir = path.join(e.home, '.devteam', 'browser', key);
  fs.mkdirSync(path.join(dir, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'root.json'), JSON.stringify({ root: path.join(tmp, 'gone') }));
  // a key that matches but has no folder
  const none = await cli(e, ['forget', '--profile', 'nothing-here-000000000000']);
  assert.equal(none.status, 1, none.err);
  // a process carrying the profile holds it
  const holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', `--user-data-dir=${dir}`], { stdio: 'ignore' });
  try {
    await until(() => fs.existsSync(`/proc/${holder.pid}/cmdline`) && fs.readFileSync(`/proc/${holder.pid}/cmdline`, 'utf8').includes(dir), 'the holder');
    const held = await cli(e, ['forget', '--profile', key]);
    assert.equal(held.status, 1, held.err);
    assert.match(held.err, new RegExp(String(holder.pid)));
    assert.ok(fs.existsSync(path.join(dir, 'root.json')), 'kept while held');
  } finally { holder.kill('SIGKILL'); }
  await new Promise((r) => (holder.exitCode !== null || holder.signalCode !== null ? r() : holder.once('exit', r)));
  const res = await cli(e, ['forget', '--profile', key]);
  assert.equal(res.status, 0, res.err);
  assert.equal(res.out, `forgot profile ${key}: every site in it is signed out`);
  assert.equal(fs.existsSync(dir), false);
});

test('unknown verbs print the usage line', opts, async () => {
  for (const args of [[], ['frobnicate']]) {
    const res = await cli(e, args);
    assert.equal(res.status, 1, res.err);
    assert.match(res.err, /browser start/);
  }
  const serve = await cli(e, ['serve']);
  assert.equal(serve.status, 1);
  assert.match(serve.err, /internal/);
});
