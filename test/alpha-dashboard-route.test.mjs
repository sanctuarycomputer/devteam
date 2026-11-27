// alpha@1 (kit-961): a project's dashboard serves the live alpha at /next/ from the project's own
// verified install (kit-install@1), by alpha-build@1's serving table, under the dashboard's own policy
// with alphaCsp's changes; anything short of a verified install with pages is the why-page; GET
// /api/alpha says which. Scratch HOME, every DEVTEAM_* of the shell dropped (test/lib/kit.mjs).
// Ports: +50 the dashboard's hub (the dashboard itself is pinned on a free port outside the block)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PORTS, kit, testDir, bareProject, dashboardOnFreePort, until } from './lib/kit.mjs';

const HUB = PORTS + 50;
const TABLE = JSON.parse(fs.readFileSync(path.join(testDir, 'fixtures', 'alpha-serving.json'), 'utf8'));
const OUT = path.join(testDir, 'fixtures', 'alpha-build', 'dashboard', 'out');
const HASHES = JSON.parse(fs.readFileSync(path.join(OUT, 'csp-hashes.json'), 'utf8')).pages;
const INSTALLS = path.join(testDir, 'fixtures', 'kit-install', 'kit-link');
const GOOD = '0.101.0-63959e27d616';
const NO_RECORD = '0.100.0-2adfe5123521';
const PROVENANCE_FALSE = '0.99.0-d12588c848a5';
const NAME = ['@sanctuarycomputer', 'devteam'];
const ARTIFACT = 'some-mock';
const PREVIEW = 'quiet-otter';

// the dashboard's policies, as they are before this ticket (literal: a change to any of them is red)
const DASH = `frame-src 'self'; frame-ancestors 'self' http://127.0.0.1:${HUB}`;
const alphaPolicy = (route) => `${DASH}; script-src 'self' ${HASHES[route].map((h) => `'${h}'`).join(' ')}; style-src 'self' 'unsafe-inline'; font-src 'self'`;
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
const scratch = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `alpha-dash-${n}-`));

// A project with the fixture's installs in docs/devteam/.kit, current naming the verified one, each
// app's export in the package's docs/devteam/alpha/<app>/, and the table's outside file and symlink.
function alphaProject(t, label) {
  const base = scratch(label);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = bareProject(base, 'alpha');
  // main has a commit, as every project's does (the kit reads main's settings), and .kit is never in it
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'project'], { cwd: root });
  const K =path.join(root, 'docs', 'devteam', '.kit');
  fs.mkdirSync(K);
  for (const f of [GOOD, NO_RECORD, PROVENANCE_FALSE]) fs.cpSync(path.join(INSTALLS, f), path.join(K, f), { recursive: true, verbatimSymlinks: true });
  for (const f of [GOOD, NO_RECORD, PROVENANCE_FALSE]) {
    for (const app of ['dashboard', 'hub']) {
      const served = path.join(K, f, 'node_modules', ...NAME, 'docs', 'devteam', 'alpha', app);
      fs.cpSync(path.join(testDir, 'fixtures', 'alpha-build', app, 'out'), served, { recursive: true });
      fs.writeFileSync(path.resolve(served, TABLE.outside.at), TABLE.outside.text);
      for (const c of TABLE.cases) if (c.symlink) fs.symlinkSync(c.symlink.to, path.join(served, c.symlink.at));
    }
  }
  fs.symlinkSync(GOOD, path.join(K, 'current'));
  const prev = path.join(root, 'docs', 'devteam', 'run', 'previews');
  fs.mkdirSync(prev, { recursive: true });
  fs.writeFileSync(path.join(prev, `${PREVIEW}.json`), JSON.stringify({ v: 1, name: PREVIEW, project: 'alpha', session: 'supervisor', label: 'alpha', port: PORTS + 51, cwd: root, at: new Date().toISOString(), expires: new Date(Date.now() + 86400000).toISOString() }));
  return { root, K };
}
const point = (K, f) => { fs.rmSync(path.join(K, 'current'), { force: true }); fs.symlinkSync(f, path.join(K, 'current')); };
// main's settings with alpha set (true or false), committed
function setAlpha(root, on) {
  const f = path.join(root, 'docs', 'devteam', 'project', 'settings.md');
  const text = fs.readFileSync(f, 'utf8');
  const m = /```json devteam\s*\n([\s\S]*?)\n```/.exec(text);
  const s = { ...JSON.parse(m[1]), alpha: on };
  fs.writeFileSync(f, text.replace(m[0], () => `\`\`\`json devteam\n${JSON.stringify(s, null, 2)}\n\`\`\``));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  execFileSync('git', ['add', '-A', 'docs/devteam/project/settings.md'], { cwd: root, env });
  execFileSync('git', ['commit', '-qm', `alpha ${on}`], { cwd: root, env });
}

async function dashboard(t, root) {
  const env = { ...process.env, HOME: scratch('home'), DEVTEAM_HUB_PORT: String(HUB), DEVTEAM_DATA_WAIT_MS: '0' };
  const { dash, port } = await dashboardOnFreePort(root, env);
  t.after(() => dash.stop());
  return port;
}
// /api/alpha as JSON, once it says what is expected (a state is kept 2 s)
async function alphaSays(port, want, label = '') {
  let last;
  await until(async () => { const r = await ask(port, '/api/alpha'); last = { status: r.status, type: r.headers['content-type'], json: JSON.parse(r.body.toString()) }; return JSON.stringify(last.json) === JSON.stringify(want); }, `/api/alpha to say ${JSON.stringify(want)}`).catch(() => assert.deepEqual(last?.json, want, `${label ? `${label}: ` : ''}/api/alpha`));
  assert.equal(last.status, 200, '/api/alpha: 200');
  assert.equal(last.type, 'application/json', '/api/alpha: JSON');
}

test('D1 the dashboard serves every case of alpha-serving.json under /next/ from the verified install', { timeout: 300000 }, async (t) => {
  const { root, K } = alphaProject(t, 'table');
  const port = await dashboard(t, root);
  await alphaSays(port, { on: true, verified: true, release: '0.101.0', why: null });
  const served = path.join(K, GOOD, 'node_modules', ...NAME, 'docs', 'devteam', 'alpha', 'dashboard');
  const outside = Buffer.from(TABLE.outside.text);
  for (const c of TABLE.cases) {
    const r = await ask(port, c.path);
    const n = `${c.name} (${c.path.slice(0, 60)})`;
    assert.equal(r.status, c.status, `${n}: status`);
    assert.equal(r.headers['content-type'] ?? null, c.type, `${n}: type`);
    if (c.file) assert.ok(r.body.equals(fs.readFileSync(path.join(served, c.file))), `${n}: the file's bytes`);
    if (c.location) assert.equal(r.headers.location, c.location, `${n}: location`);
    assert.ok(!r.body.includes(outside), `${n}: nothing of the outside file`);
  }
  const h = await ask(port, '/next/', { method: 'HEAD' });
  assert.equal(h.status, 200, 'HEAD /next/: 200');
  assert.equal(h.headers['content-type'], 'text/html; charset=utf-8', 'HEAD /next/: its type');
  assert.equal(h.body.length, 0, 'HEAD /next/: no body');
});

test("D2 a /next/ page's policy is the dashboard's own with alphaCsp's changes, exactly; /, /view/artifact and /view/preview keep theirs", { timeout: 300000 }, async (t) => {
  const { root } = alphaProject(t, 'policy');
  const port = await dashboard(t, root);
  await alphaSays(port, { on: true, verified: true, release: '0.101.0', why: null });
  for (const [p, route] of [['/next/', '/'], ['/next/?_rsc=a1b2c', '/'], ['/next/threads/one/', '/threads/one/'], ['/next/threads/one/index.html', '/threads/one/']]) {
    const r = await ask(port, p);
    assert.equal(r.status, 200, `${p}: 200`);
    assert.equal(r.headers['content-security-policy'], alphaPolicy(route), `${p}: the exact policy`);
    const script = r.headers['content-security-policy'].split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src '));
    assert.ok(script && !script.includes('unsafe-inline'), `${p}: script-src without 'unsafe-inline'`);
  }
  // a file that is not a page carries no policy
  assert.equal((await ask(port, '/next/_next/static/chunks/app.js')).headers['content-security-policy'], undefined, 'a script file carries no policy');
  // the stable pages: byte-identical to before
  const page = fs.readFileSync(path.join(root, 'docs', 'devteam', 'dashboard', 'index.html'));
  for (const p of ['/', '/index.html', `/view/artifact/${ARTIFACT}`, `/view/preview/${PREVIEW}`]) {
    const r = await ask(port, p);
    assert.equal(r.status, 200, `${p}: 200`);
    assert.equal(r.headers['content-security-policy'], DASH, `${p}: its policy as before`);
    assert.ok(r.body.equals(page), `${p}: the stable page`);
  }
});

test("D3 /next/view/artifact/<id> and /next/view/preview/<name> are the / route's index.html, with the viewer's policy and checks", { timeout: 300000 }, async (t) => {
  const { root } = alphaProject(t, 'viewer');
  const port = await dashboard(t, root);
  await alphaSays(port, { on: true, verified: true, release: '0.101.0', why: null });
  const index = fs.readFileSync(path.join(OUT, 'index.html'));
  for (const p of [`/next/view/artifact/${ARTIFACT}`, `/next/view/artifact/${ARTIFACT}?at=main`, `/next/view/preview/${PREVIEW}`]) {
    const r = await ask(port, p);
    assert.equal(r.status, 200, `${p}: 200`);
    assert.equal(r.headers['content-type'], 'text/html; charset=utf-8', `${p}: html`);
    assert.ok(r.body.equals(index), `${p}: the / route's index.html`);
    assert.equal(r.headers['content-security-policy'], alphaPolicy('/'), `${p}: the viewer's policy with the / route's hashes`);
    assert.equal(r.headers['referrer-policy'], 'no-referrer', `${p}: no referrer, as the viewer`);
  }
  for (const p of ['/next/view/artifact/Bad_Id', `/next/view/artifact/${ARTIFACT}?at=..%2Fx`, '/next/view/preview/nosuch-name', '/next/view/preview/BAD']) {
    const r = await ask(port, p);
    assert.equal(r.status, 404, `${p}: 404, as the viewer's`);
  }
});

// the why-page, for every kind of path under /next
async function whyEverywhere(port, words, label) {
  for (const p of ['/next/', '/next/threads/one/', '/next/_next/static/chunks/app.js', '/next', '/next/view/artifact/some-mock']) {
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
    assert.doesNotMatch(body, /<script|__next_f|alpha-build/i, `${n}: nothing of the install`);
  }
  const h = await ask(port, '/next/', { method: 'HEAD' });
  assert.equal(h.status, 200, `${label}, HEAD /next/: 200`);
  assert.equal(h.headers['content-security-policy'], WHY_CSP, `${label}, HEAD /next/: the why-page's policy`);
  assert.equal(h.body.length, 0, `${label}, HEAD /next/: no body`);
}

test('D4 short of a verified install with pages, and with alpha on, every /next/ path is the why-page; /api/alpha says why', { timeout: 600000 }, async (t) => {
  const { root, K } = alphaProject(t, 'why');
  const port = await dashboard(t, root);
  const ok = { on: true, verified: true, release: '0.101.0', why: null };
  const unverified = { on: true, verified: false, release: null, why: 'unverified' };
  const pkg = path.join(K, GOOD, 'node_modules', ...NAME);
  const pj = path.join(pkg, 'package.json');
  const was = fs.readFileSync(pj);
  const away = path.join(path.dirname(K), 'away');
  const alpha = path.join(pkg, 'docs', 'devteam', 'alpha');
  const awayPages = path.join(path.dirname(K), 'away-pages');
  const awayPj = path.join(path.dirname(K), 'away-package.json');
  const restorePj = () => { fs.rmSync(pj, { force: true }); fs.writeFileSync(pj, was); };
  // each case starts from the served state, so its answer is a fresh read (a state is kept 2 s)
  const cases = [
    ['the unverified tree (no verified.json)', () => point(K, NO_RECORD), () => point(K, GOOD), unverified, /didn’t pass its checks/],
    ['provenance_ok false', () => point(K, PROVENANCE_FALSE), () => point(K, GOOD), unverified, /didn’t pass its checks/],
    ['a package of another version', () => fs.writeFileSync(pj, JSON.stringify({ ...JSON.parse(was), version: '0.101.1' })), () => fs.writeFileSync(pj, was), unverified, /didn’t pass its checks/],
    ['a package outside the folder', () => { fs.renameSync(pkg, away); fs.symlinkSync(away, pkg); }, () => { fs.rmSync(pkg); fs.renameSync(away, pkg); }, unverified, /didn’t pass its checks/],
    ['a package.json that is a symlink', () => { fs.writeFileSync(awayPj, was); fs.rmSync(pj); fs.symlinkSync(awayPj, pj); }, restorePj, unverified, /didn’t pass its checks/],
    ['a package.json over 1 MiB', () => fs.writeFileSync(pj, `${was.toString().trimEnd()}${' '.repeat(1048577)}\n`), restorePj, unverified, /didn’t pass its checks/],
    ['no alpha folder', () => fs.renameSync(alpha, `${alpha}.off`), () => fs.renameSync(`${alpha}.off`, alpha), { ...ok, why: 'no-pages' }, /Release 0\.101\.0 has no alpha pages yet/],
    ['a pages folder resolving outside the package', () => { fs.renameSync(path.join(alpha, 'dashboard'), awayPages); fs.symlinkSync(awayPages, path.join(alpha, 'dashboard')); }, () => { fs.rmSync(path.join(alpha, 'dashboard')); fs.renameSync(awayPages, path.join(alpha, 'dashboard')); }, { ...ok, why: 'no-pages' }, /Release 0\.101\.0 has no alpha pages yet/],
    ['no install', () => fs.renameSync(K, `${K}-off`), () => fs.renameSync(`${K}-off`, K), { on: true, verified: false, release: null, why: 'no-install' }, /no install of the alpha/],
    ['the setting alpha false', () => setAlpha(root, false), () => setAlpha(root, true), { ...ok, on: false, why: 'off' }, /turned off/],
  ];
  for (const [label, make, undo, want, words] of cases) {
    await alphaSays(port, ok);
    make();
    await alphaSays(port, want, label);
    await whyEverywhere(port, words, label);
    undo();
  }
  await alphaSays(port, ok);
  assert.equal((await ask(port, '/next/')).headers['content-security-policy'], alphaPolicy('/'), 'served again once on');
});

test('D5 the why-page is a string in the code, never a file of the install', () => {
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const i = src.indexOf('\nfunction alphaWhyPage(');
  assert.ok(i >= 0, 'devteam.mjs declares alphaWhyPage');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  assert.doesNotMatch(body, /readFileSync|readFile\(|createReadStream/, 'alphaWhyPage reads no file');
});

test('D6 a csp-hashes.json missing or holding a source that is no sha256 hash makes every page a 500, never a looser policy; a route it does not list gets no hash', { timeout: 300000 }, async (t) => {
  const { root, K } = alphaProject(t, 'hashes');
  const port = await dashboard(t, root);
  await alphaSays(port, { on: true, verified: true, release: '0.101.0', why: null });
  const served = path.join(K, GOOD, 'node_modules', ...NAME, 'docs', 'devteam', 'alpha', 'dashboard');
  const f = path.join(served, 'csp-hashes.json');
  const good = fs.readFileSync(f);
  const bad = JSON.parse(good);
  bad.pages['/'].push("unsafe-inline' 'unsafe-eval");
  const awayHashes = path.join(path.dirname(K), 'away-csp-hashes.json');
  for (const [label, write] of [
    ['no csp-hashes.json', () => fs.rmSync(f)],
    ["a source that isn't a sha256 hash", () => fs.writeFileSync(f, JSON.stringify(bad))],
    ['a csp-hashes.json that is a symlink', () => { fs.writeFileSync(awayHashes, good); fs.rmSync(f); fs.symlinkSync(awayHashes, f); }],
    ['a csp-hashes.json over 1 MiB', () => fs.writeFileSync(f, `${good.toString().trimEnd()}${' '.repeat(1048577)}\n`)],
  ]) {
    write();
    for (const p of ['/next/', '/next/threads/one/']) {
      const r = await ask(port, p);
      assert.equal(r.status, 500, `${label}, ${p}: a 500`);
      assert.equal(r.headers['content-security-policy'], undefined, `${label}, ${p}: no policy`);
    }
    assert.equal((await ask(port, '/next/_next/static/chunks/app.js')).status, 200, `${label}: a file that is not a page is still served`);
    fs.rmSync(f, { force: true });
    fs.writeFileSync(f, good);
  }
  fs.mkdirSync(path.join(served, 'extra'));
  fs.writeFileSync(path.join(served, 'extra', 'index.html'), '<!doctype html><p>extra</p>\n');
  const r = await ask(port, '/next/extra/');
  assert.equal(r.status, 200, 'an unlisted route: 200');
  assert.equal(r.headers['content-security-policy'], `${DASH}; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'`, 'an unlisted route: script-src self alone');
  assert.equal((await ask(port, '/next/')).headers['content-security-policy'], alphaPolicy('/'), 'a listed route keeps its hashes');
});
