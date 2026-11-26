// page-seam@1 (kit-983): every page the CLI's servers send goes through servePage, pageVersion and
// servePageAsset, with what each sends unchanged from the base it was recorded at (BASE, below), and
// serveAppFiles serves a folder by alpha-build@1's serving table (test/fixtures/alpha-serving.json).
// Ports: +50 the dashboard's hub (the dashboard itself is pinned on a free port outside the block)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PORTS, kit, testDir, bareProject, dashboardOnFreePort } from './lib/kit.mjs';

const SCRIPT = path.join(kit, 'scripts', 'devteam.mjs');
const src = fs.readFileSync(SCRIPT, 'utf8');
const SERVING = path.join(testDir, 'fixtures', 'alpha-serving.json');
const AB = path.join(testDir, 'fixtures', 'alpha-build');
const HUB = PORTS + 50;
// DEVTEAM_TEST_PAGE_SEAM_RECORD=1 prints what the servers answer, in BASE's shape, instead of comparing
const RECORD = process.env.DEVTEAM_TEST_PAGE_SEAM_RECORD === '1';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// A top-level declaration's text: from `start` to the first line after it that closes at column 0.
function decl(start) {
  const i = src.indexOf(`\n${start}`);
  assert.ok(i >= 0, `devteam.mjs declares ${start}`);
  const j = src.indexOf('\n}\n', i + 1);
  return src.slice(i + 1, j + 3);
}
const has = (start) => src.includes(`\n${start}`);
const NEXT = Symbol('next route');
// The seam and the browser view, under node:vm with the kit's own fs, path and http.
function seam(kitDir = kit) {
  const parts = ['function servePage(', 'function pageVersion(', 'function servePageAsset(', 'function serveAppFiles(', 'function browserViewServer('].filter((s) => RECORD ? has(s) : true).map(decl);
  const one = (name) => { const m = new RegExp(`^const ${name} = .*$`, 'm').exec(src); assert.ok(m, `devteam.mjs declares ${name}`); return m[0]; };
  const code = [one('browserViewHost'), decl('function browserOneHeader('), ...parts].join('\n').replaceAll('import.meta.url', '__kitUrl');
  const ctx = vm.createContext({ fs, path, http, crypto, Buffer, URL, fileURLToPath, setTimeout, clearTimeout, console, kitDir, __kitUrl: pathToFileURL(SCRIPT).href, DASH_NEXT: NEXT, sha256: (b) => sha(b) });
  return vm.runInContext(`${code}\n;({ servePage: typeof servePage === 'function' ? servePage : null, pageVersion: typeof pageVersion === 'function' ? pageVersion : null, servePageAsset: typeof servePageAsset === 'function' ? servePageAsset : null, serveAppFiles: typeof serveAppFiles === 'function' ? serveAppFiles : null, browserViewServer })`, ctx);
}
function scratch(name) { return fs.mkdtempSync(path.join(os.tmpdir(), `page-seam-${name}-`)); }
// One request, the path sent as written (no normalising of .. or %2e): status, headers, body.
function ask(port, p, { method = 'GET', host = `127.0.0.1:${port}`, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host, ...(body !== undefined ? { 'content-length': Buffer.byteLength(body) } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.setTimeout(60000, () => r.destroy(new Error(`${method} ${p}: no answer in 60 s`)));
    r.end(body);
  });
}
async function listen(t, handler) {
  const s = http.createServer(handler);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { s.closeAllConnections?.(); s.close(() => r()); }));
  return s.address().port;
}

// ---- serveAppFiles: the serving table ----------------------------------------------------------

// A copy of an app's out/ with the table's file outside it and its symlinks, served at base.
function served(t, app, base) {
  const T = JSON.parse(fs.readFileSync(SERVING, 'utf8'));
  const d = scratch(`serve-${app}`);
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const root = path.join(d, 'out');
  fs.cpSync(path.join(AB, app, 'out'), root, { recursive: true });
  fs.writeFileSync(path.resolve(root, T.outside.at), T.outside.text);
  for (const c of T.cases) if (c.symlink) fs.symlinkSync(c.symlink.to, path.join(root, c.symlink.at));
  return { T, root };
}
const POLICY = (route) => `policy for ${route}`;
async function tableServer(t, root, base, policyFor = POLICY) {
  const { serveAppFiles } = seam();
  assert.equal(typeof serveAppFiles, 'function', 'devteam.mjs has serveAppFiles');
  return listen(t, (req, res) => { if (serveAppFiles(root, base, req, res, policyFor) === NEXT) { res.writeHead(599); res.end('not mine'); } });
}
// a case of the table, at base ('/next' as written, or '' with /next cut off)
const at = (c, base) => (base === '/next' ? c.path : c.path.slice('/next'.length));
const loc = (c, base) => (base === '/next' ? c.location : c.location.slice('/next'.length));

for (const base of ['/next', '']) {
  test(`S1 serveAppFiles passes every case of alpha-serving.json on both apps, at ${base || 'the root'}`, async (t) => {
    for (const app of ['dashboard', 'hub']) {
      const { T, root } = served(t, app, base);
      const port = await tableServer(t, root, base);
      for (const c of T.cases) {
        // at the root, bare /next is not the base: that case is dropped (designs/kit-package-apps.md)
        if (base === '' && c.path === '/next') continue;
        const p = at(c, base);
        const r = await ask(port, p);
        const what = `S1 ${app} at ${base || '/'}: ${c.name} (${p.slice(0, 80)})`;
        assert.equal(r.status, c.status, `${what}: status`);
        assert.equal(r.headers['content-type'] ?? null, c.type, `${what}: content type`);
        if (c.status === 301) assert.equal(r.headers.location, loc(c, base), `${what}: location`);
        if (c.status === 200) {
          assert.ok(r.body.equals(fs.readFileSync(path.join(root, c.file))), `${what}: the bytes of ${c.file}`);
          const route = `/${path.posix.dirname(c.file) === '.' ? '' : `${path.posix.dirname(c.file)}/`}`;
          assert.equal(r.headers['content-security-policy'], c.file.endsWith('.html') ? POLICY(route) : undefined, `${what}: the page's policy, only on a page`);
          assert.equal(r.headers['x-content-type-options'], 'nosniff', `${what}: nosniff`);
        }
        if (c.status === 404) assert.ok(!r.body.includes(T.outside.text.trim()), `${what}: nothing of the file outside`);
      }
      // HEAD: the same answer, no body
      const h = await ask(port, `${base}/`, { method: 'HEAD' });
      assert.equal(h.status, 200, `S1 ${app}: HEAD ${base}/`);
      assert.equal(h.headers['content-type'], 'text/html; charset=utf-8', `S1 ${app}: HEAD's type`);
      assert.equal(h.body.length, 0, `S1 ${app}: HEAD has no body`);
    }
  });
}

test('S2 serveAppFiles answers only GET and HEAD under its base; anything else is not its (DASH_NEXT); a page with no policy is a 500', async (t) => {
  const { root } = served(t, 'dashboard', '/next');
  const port = await tableServer(t, root, '/next', (route) => (route === '/' ? 'p' : null));
  for (const [method, p] of [['POST', '/next/'], ['PUT', '/next/index.txt'], ['GET', '/'], ['GET', '/nextx/'], ['GET', '/api/data'], ['GET', '/other/next/']]) {
    const r = await ask(port, p, { method, ...(method === 'GET' ? {} : { body: '' }) });
    assert.equal(r.status, 599, `S2 ${method} ${p}: not serveAppFiles' (DASH_NEXT)`);
  }
  assert.equal((await ask(port, '/next/')).status, 200, 'S2 the root page, with its policy');
  const r = await ask(port, '/next/threads/one/');
  assert.equal(r.status, 500, 'S2 a page policyFor gives no string for is a 500');
  assert.equal(r.headers['content-security-policy'], undefined, 'S2 and is never sent without a policy');
});

test('S6 serveAppFiles beyond the table: each segment decoded once, a .. that stays inside, a file that is there past 2048 bytes', async (t) => {
  const { root } = served(t, 'dashboard', '/next');
  // a file whose name holds %41: asked as %2541, decoded once it is that file; twice, it would be pctA.txt
  fs.writeFileSync(path.join(root, 'pct%41.txt'), 'once\n');
  fs.writeFileSync(path.join(root, 'pctA.txt'), 'twice\n');
  // a file that is there, its request path over 2048 bytes
  const deep = Array.from({ length: 11 }, (_, i) => `${String(i).padStart(2, '0')}${'d'.repeat(198)}`);
  fs.mkdirSync(path.join(root, ...deep), { recursive: true });
  fs.writeFileSync(path.join(root, ...deep, 'far.txt'), 'far\n');
  const port = await tableServer(t, root, '/next');
  const once = await ask(port, '/next/pct%2541.txt');
  assert.equal(once.status, 200, 'S6 a %25 is decoded once');
  assert.equal(once.body.toString(), 'once\n', 'S6 the file named with %41, not pctA.txt');
  for (const p of ['/next/threads/../index.html', '/next/./index.html', '/next/threads/one/./index.html', '/next/threads/%2e%2e/index.html']) assert.equal((await ask(port, p)).status, 404, `S6 ${p}: a . or .. segment is a 404, even inside the folder`);
  const far = `/next/${deep.join('/')}/far.txt`;
  assert.ok(Buffer.byteLength(far) > 2048, 'S6 the far path is over 2048 bytes');
  assert.equal((await ask(port, far)).status, 404, 'S6 a path over 2048 bytes is a 404, though its file is there');
  assert.equal((await ask(port, '/next//index.html')).status, 404, 'S6 an empty segment but the last is a 404');
  // a folder whose index.html is a symlink out of the folder (task-1 F1)
  fs.mkdirSync(path.join(root, 'ix'));
  fs.symlinkSync('../../outside.txt', path.join(root, 'ix', 'index.html'));
  const ix = await ask(port, '/next/ix/');
  assert.equal(ix.status, 404, "S6 a folder's index.html that leads out of the folder is a 404");
  assert.ok(!ix.body.toString().includes('outside the served folder'), 'S6 and nothing of the file it leads to');
  // not a regular file: a FIFO with a known type would block the read (task-1 F2)
  // a writer at its other end for 5 s, so a server that read it would get 'x' and answer, not hang
  if (spawnSync('mkfifo', [path.join(root, 'pipe.txt')]).status === 0) {
    const fifo = path.join(root, 'pipe.txt');
    spawn('timeout', ['5', 'sh', '-c', 'printf x > "$1"', 'sh', fifo], { stdio: 'ignore' });
    // its writer, still opening the FIFO, is let go at once: a reader opened and closed (timeout ends it in 5 s at worst)
    t.after(() => { try { fs.closeSync(fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK)); } catch {} });
    assert.equal((await ask(port, '/next/pipe.txt')).status, 404, 'S6 a FIFO is a 404');
  }
  // a file asked for as a folder (task-1 F3)
  for (const p of ['/next/index.txt/', '/next/threads/one/index.html/']) assert.equal((await ask(port, p)).status, 404, `S6 ${p}: a file with a trailing slash is a 404`);
  // a folder's redirect drops the query (task-1 F6)
  const q = await ask(port, '/next/threads/one?_rsc=1');
  assert.equal(q.status, 301, 'S6 a folder without its slash, with a query');
  assert.equal(q.headers.location, '/next/threads/one/', 'S6 its Location has no query');
});

test('S8 servePage answers 500 for a page it cannot read; serveAppFiles refuses a base or folder a caller got wrong', async (t) => {
  const K = scratch('nokit');
  t.after(() => fs.rmSync(K, { recursive: true, force: true }));
  const { servePage, serveAppFiles, pageVersion } = seam(K);
  const port = await listen(t, (req, res) => servePage(null, req, res, 'dashboard', "frame-src 'self'"));
  const r = await ask(port, '/');
  assert.equal(r.status, 500, 'S8 a page that is not there is a 500');
  assert.equal(r.headers['content-type'], 'text/plain; charset=utf-8', 'S8 as plain text');
  assert.equal(r.headers['content-security-policy'], undefined, 'S8 with no policy of a page');
  assert.equal(pageVersion('dashboard'), '', "S8 pageVersion of a page that is not there is ''");
  assert.throws(() => servePage(null, {}, {}, 'nope', ''), /no page nope/, 'S8 a page name not of the three throws');
  // the policy is written last: a caller's header can't replace it (task-1 F6)
  fs.mkdirSync(path.join(K, 'dashboard'));
  fs.writeFileSync(path.join(K, 'dashboard', 'hub.html'), '<!doctype html><title>hub</title>');
  const last = await listen(t, (req, res) => servePage(null, req, res, 'hub', 'the policy', { 'content-security-policy': 'a header' }));
  assert.equal((await ask(last, '/')).headers['content-security-policy'], 'the policy', "S8 a caller's header doesn't replace the policy");
  // policyFor that throws is a 500, never a throw out of serveAppFiles (task-1 F4)
  const AB0 = scratch('ab0');
  t.after(() => fs.rmSync(AB0, { recursive: true, force: true }));
  fs.writeFileSync(path.join(AB0, 'index.html'), '<!doctype html><title>x</title>');
  const thrower = await listen(t, (req, res) => { try { serveAppFiles(AB0, '/next', req, res, () => { throw new Error('no'); }); } catch { res.writeHead(598); res.end(); } });
  assert.equal((await ask(thrower, '/next/')).status, 500, 'S8 a policyFor that throws is a 500, never a throw out of serveAppFiles');
  for (const base of ['/next/', 'next', '/', '/a//b', undefined, null, 1]) assert.throws(() => serveAppFiles('/x', base, { method: 'GET', url: '/' }, {}, POLICY), /serveAppFiles: base/, `S8 base ${JSON.stringify(base)} throws`);
  for (const folder of ['', undefined, null]) assert.throws(() => serveAppFiles(folder, '/next', { method: 'GET', url: '/next/' }, {}, POLICY), /serveAppFiles: no folder/, `S8 folder ${JSON.stringify(folder)} throws`);
  const none = await listen(t, (req, res) => { if (serveAppFiles(path.join(K, 'gone'), '/next', req, res, POLICY) === NEXT) { res.writeHead(599); res.end(); } });
  assert.equal((await ask(none, '/next/')).status, 404, "S8 a folder that isn't there serves nothing");
});
