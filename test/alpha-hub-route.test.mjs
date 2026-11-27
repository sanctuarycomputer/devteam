// alpha@1 (kit-961): the laptop hub a project's dashboard starts (startHub) serves its alpha at /next/
// from that project's verified install, by alpha-build@1's serving table, under the hub page's own
// policy changed only in script-src and style-src, with font-src 'self' and img-src 'self' data:
// added (ruling m-20261127-130542042); GET /alpha.json says which. A hub started with no project (devteam.mjs hub) has no install. Scratch HOME, every
// DEVTEAM_* of the shell dropped (test/lib/kit.mjs).
// Ports: +50 the dashboard's hub (the dashboard itself is pinned on a free port outside the block),
// +60 the hub started alone
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PORTS, testDir, bareProject, dashboardOnFreePort, until } from './lib/kit.mjs';

const HUB = PORTS + 50;
const ALONE = PORTS + 60;
const TABLE = JSON.parse(fs.readFileSync(path.join(testDir, 'fixtures', 'alpha-serving.json'), 'utf8'));
const OUT = path.join(testDir, 'fixtures', 'alpha-build', 'hub', 'out');
const HASHES = JSON.parse(fs.readFileSync(path.join(OUT, 'csp-hashes.json'), 'utf8')).pages;
const INSTALLS = path.join(testDir, 'fixtures', 'kit-install', 'kit-link');
const GOOD = '0.101.0-63959e27d616';
const PROVENANCE_FALSE = '0.99.0-d12588c848a5';
const NAME = ['@sanctuarycomputer', 'devteam'];

// the hub page's policy, as it is before this ticket (literal), and the alpha's from it
const FRAMES = Array.from({ length: 25 }, (_, i) => `http://127.0.0.1:${PORTS + 1 + i}`).join(' ');
const HUB_CSP = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-src ${FRAMES}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
const alphaPolicy = (route) => `default-src 'none'; script-src 'self' ${HASHES[route].map((h) => `'${h}'`).join(' ')}; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src ${FRAMES}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; font-src 'self'; img-src 'self' data:`;
const WHY_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

function ask(port, p, { method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: `127.0.0.1:${port}` } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.setTimeout(60000, () => r.destroy(new Error(`${method} ${p}: no answer in 60 s`)));
    r.end();
  });
}
const scratch = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `alpha-hub-${n}-`));

function alphaProject(t) {
  const base = scratch('project');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = bareProject(base, 'alpha');
  // main has a commit, as every project's does (the kit reads main's settings), and .kit is never in it
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'project'], { cwd: root });
  const K =path.join(root, 'docs', 'devteam', '.kit');
  fs.mkdirSync(K);
  fs.cpSync(path.join(INSTALLS, GOOD), path.join(K, GOOD), { recursive: true });
  for (const app of ['dashboard', 'hub']) {
    const served = path.join(K, GOOD, 'node_modules', ...NAME, 'docs', 'devteam', 'alpha', app);
    fs.cpSync(path.join(testDir, 'fixtures', 'alpha-build', app, 'out'), served, { recursive: true });
    fs.writeFileSync(path.resolve(served, TABLE.outside.at), TABLE.outside.text);
    for (const c of TABLE.cases) if (c.symlink) fs.symlinkSync(c.symlink.to, path.join(served, c.symlink.at));
  }
  fs.symlinkSync(GOOD, path.join(K, 'current'));
  return { root, K };
}
function setAlpha(root, on) {
  const f = path.join(root, 'docs', 'devteam', 'project', 'settings.md');
  const text = fs.readFileSync(f, 'utf8');
  const m = /```json devteam\s*\n([\s\S]*?)\n```/.exec(text);
  fs.writeFileSync(f, text.replace(m[0], () => `\`\`\`json devteam\n${JSON.stringify({ ...JSON.parse(m[1]), alpha: on }, null, 2)}\n\`\`\``));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  execFileSync('git', ['add', '-A', 'docs/devteam/project/settings.md'], { cwd: root, env });
  execFileSync('git', ['commit', '-qm', `alpha ${on}`], { cwd: root, env });
}
async function hubUp(port) {
  await until(async () => { try { return (await ask(port, '/instances.json')).status === 200; } catch { return false; } }, `the hub on ${port}`);
}
async function alphaSays(port, want) {
  let last;
  await until(async () => { const r = await ask(port, '/alpha.json'); last = { status: r.status, type: r.headers['content-type'], json: JSON.parse(r.body.toString()) }; return JSON.stringify(last.json) === JSON.stringify(want); }, `/alpha.json to say ${JSON.stringify(want)}`).catch(() => assert.deepEqual(last?.json, want, '/alpha.json'));
  assert.equal(last.status, 200, '/alpha.json: 200');
  assert.equal(last.type, 'application/json', '/alpha.json: JSON');
}
async function whyEverywhere(port, words, label) {
  for (const p of ['/next/', '/next/threads/one/', '/next/_next/static/chunks/app.js', '/next']) {
    const r = await ask(port, p);
    const n = `${label}, ${p}`;
    assert.equal(r.status, 200, `${n}: status`);
    assert.equal(r.headers['content-type'], 'text/html; charset=utf-8', `${n}: html`);
    assert.equal(r.headers['content-security-policy'], WHY_CSP, `${n}: the why-page's policy`);
    assert.equal(r.headers['cache-control'], 'no-store', `${n}: no-store`);
    assert.equal(r.headers['x-content-type-options'], 'nosniff', `${n}: nosniff`);
    const body = r.body.toString();
    assert.match(body, words, `${n}: the reason in plain words`);
    assert.match(body, /<a href="\/">/, `${n}: a link back to /`);
    assert.doesNotMatch(body, /<script|__next_f/i, `${n}: nothing of the install`);
  }
}

test("H1 the dashboard's hub serves every case of alpha-serving.json under /next/ from that project's install, under the hub page's policy with alphaCsp's changes (script-src and style-src, font-src and img-src added)", { timeout: 300000 }, async (t) => {
  const { root, K } = alphaProject(t);
  const env = { ...process.env, HOME: scratch('home'), DEVTEAM_HUB_PORT: String(HUB), DEVTEAM_DATA_WAIT_MS: '0' };
  const { dash } = await dashboardOnFreePort(root, env);
  t.after(() => dash.stop());
  await hubUp(HUB);
  await alphaSays(HUB, { on: true, verified: true, release: '0.101.0', why: null });
  const served = path.join(K, GOOD, 'node_modules', ...NAME, 'docs', 'devteam', 'alpha', 'hub');
  const outside = Buffer.from(TABLE.outside.text);
  for (const c of TABLE.cases) {
    const r = await ask(HUB, c.path);
    const n = `${c.name} (${c.path.slice(0, 60)})`;
    assert.equal(r.status, c.status, `${n}: status`);
    assert.equal(r.headers['content-type'] ?? null, c.type, `${n}: type`);
    if (c.file) assert.ok(r.body.equals(fs.readFileSync(path.join(served, c.file))), `${n}: the file's bytes (the hub app's)`);
    if (c.location) assert.equal(r.headers.location, c.location, `${n}: location`);
    assert.ok(!r.body.includes(outside), `${n}: nothing of the outside file`);
  }
  for (const [p, route] of [['/next/', '/'], ['/next/?_rsc=a1b2c', '/'], ['/next/threads/one/', '/threads/one/']]) {
    assert.equal((await ask(HUB, p)).headers['content-security-policy'], alphaPolicy(route), `${p}: the exact policy`);
  }
  const page = await ask(HUB, '/');
  assert.equal(page.status, 200, 'the hub page: 200');
  assert.equal(page.headers['content-security-policy'], HUB_CSP, "the hub page's policy, as before");
  // the setting alpha false, on main: the why-page, and /alpha.json says off
  setAlpha(root, false);
  await alphaSays(HUB, { on: false, verified: true, release: '0.101.0', why: 'off' });
  await whyEverywhere(HUB, /turned off/, 'alpha false');
  setAlpha(root, true);
  const ok = { on: true, verified: true, release: '0.101.0', why: null };
  await alphaSays(HUB, ok);
  // an install whose record says provenance_ok false made current: its record and package match, so only
  // packageStatus' verified flag refuses it (the hub's unverified, as D4's on the dashboard)
  fs.cpSync(path.join(INSTALLS, PROVENANCE_FALSE), path.join(K, PROVENANCE_FALSE), { recursive: true });
  fs.rmSync(path.join(K, 'current'));
  fs.symlinkSync(PROVENANCE_FALSE, path.join(K, 'current'));
  await alphaSays(HUB, { on: true, verified: false, release: null, why: 'unverified' });
  await whyEverywhere(HUB, /didn’t pass its checks/, 'unverified');
  fs.rmSync(path.join(K, 'current'));
  fs.symlinkSync(GOOD, path.join(K, 'current'));
  await alphaSays(HUB, ok);
  // a verified install with no hub pages: no-pages
  fs.renameSync(served, `${served}.off`);
  await alphaSays(HUB, { ...ok, why: 'no-pages' });
  await whyEverywhere(HUB, /Release 0\.101\.0 has no alpha pages yet/, 'no hub pages');
  fs.renameSync(`${served}.off`, served);
  await alphaSays(HUB, ok);
  // no install
  fs.renameSync(K, `${K}-off`);
  await alphaSays(HUB, { on: true, verified: false, release: null, why: 'no-install' });
  await whyEverywhere(HUB, /no install of the alpha/, 'no install');
});

test('H2 a hub started with no project (devteam.mjs hub) has no install: /alpha.json says no-install, /next/ is the why-page', { timeout: 300000 }, async (t) => {
  const { root } = alphaProject(t);
  const env = { ...process.env, HOME: scratch('home'), DEVTEAM_HUB_PORT: String(ALONE) };
  const p = spawn(process.execPath, [path.join(root, 'docs', 'devteam', 'scripts', 'devteam.mjs'), 'hub'], { cwd: root, env, stdio: 'ignore', detached: true });
  t.after(() => { try { process.kill(-p.pid, 'SIGKILL'); } catch {} });
  await hubUp(ALONE);
  await alphaSays(ALONE, { on: true, verified: false, release: null, why: 'no-install' });
  await whyEverywhere(ALONE, /no install of the alpha/, 'a hub alone');
});
