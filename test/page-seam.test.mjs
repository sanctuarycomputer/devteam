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
  // a writer at its other end, so a server that read it would get 'x' and answer, not hang. It opens
  // without O_CREAT (never a regular file in its place), and is let go and awaited here, before any
  // teardown: a reader opened and closed ends its open (timeout ends it in 10 s at worst)
  if (spawnSync('mkfifo', [path.join(root, 'pipe.txt')]).status === 0) {
    const fifo = path.join(root, 'pipe.txt');
    const writer = spawn('timeout', ['10', process.execPath, '-e', "const fs = require('fs'); try { const fd = fs.openSync(process.argv[1], fs.constants.O_WRONLY); fs.writeSync(fd, 'x'); fs.closeSync(fd); } catch {}", fifo], { stdio: 'ignore' });
    const ended = new Promise((done) => writer.on('exit', done));
    try {
      assert.equal((await ask(port, '/next/pipe.txt')).status, 404, 'S6 a FIFO is a 404');
    } finally {
      try { fs.closeSync(fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK)); } catch {}
      await ended;
    }
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
  // servePageAsset: only the dashboard's own two helpers; every other path or server is not its (task-2 F1)
  const { servePageAsset } = seam(K);
  for (const f of ['devteam-ui.js', 'devteam-ui.css']) fs.writeFileSync(path.join(K, 'dashboard', f), '/* helper */');
  const sink = { writeHead() {}, end() {} };
  assert.notEqual(servePageAsset({ method: 'GET', url: '/review/preview/devteam-ui.js' }, sink, 'dashboard'), NEXT, "S8 servePageAsset answers the dashboard's own helper");
  for (const [server, p] of [['hub', '/review/preview/devteam-ui.js'], ['browser', '/review/preview/devteam-ui.css'], ['dashboard', '/review/preview/devteam-ui.js/x'], ['dashboard', '/review/preview/devteam-ui.jsx']]) {
    assert.equal(servePageAsset({ method: 'GET', url: p }, sink, server), NEXT, `S8 servePageAsset ${server} ${p} is not its (DASH_NEXT)`);
  }
  for (const base of ['/next/', 'next', '/', '/a//b', undefined, null, 1]) assert.throws(() => serveAppFiles('/x', base, { method: 'GET', url: '/' }, {}, POLICY), /serveAppFiles: base/, `S8 base ${JSON.stringify(base)} throws`);
  for (const folder of ['', undefined, null]) assert.throws(() => serveAppFiles(folder, '/next', { method: 'GET', url: '/next/' }, {}, POLICY), /serveAppFiles: no folder/, `S8 folder ${JSON.stringify(folder)} throws`);
  const none = await listen(t, (req, res) => { if (serveAppFiles(path.join(K, 'gone'), '/next', req, res, POLICY) === NEXT) { res.writeHead(599); res.end(); } });
  assert.equal((await ask(none, '/next/')).status, 404, "S8 a folder that isn't there serves nothing");
});

// ---- the pages, as the base sent them ----------------------------------------------------------

// Recorded at the base (6dce28e1, main before kit-983) with DEVTEAM_TEST_PAGE_SEAM_RECORD=1: each
// response's status, its headers but date and the connection's own (connection, keep-alive,
// content-length, transfer-encoding), and its body: { file } for the kit's file of that name, else
// its text. {PORT} is the dashboard's port, {PORTS+n} a port of this file's block (the hub's is +50).
const BASE = {
  "dash GET /": {"status":200,"headers":{"cache-control":"no-store","content-security-policy":"frame-src 'self'; frame-ancestors 'self' http://127.0.0.1:{PORTS+50}","content-type":"text/html; charset=utf-8"},"body":{"file":"index.html"}},
  "dash GET /index.html": {"status":200,"headers":{"cache-control":"no-store","content-security-policy":"frame-src 'self'; frame-ancestors 'self' http://127.0.0.1:{PORTS+50}","content-type":"text/html; charset=utf-8"},"body":{"file":"index.html"}},
  "dash GET /view/artifact/<id>": {"status":200,"headers":{"cache-control":"no-store","content-security-policy":"frame-src 'self'; frame-ancestors 'self' http://127.0.0.1:{PORTS+50}","content-type":"text/html; charset=utf-8","referrer-policy":"no-referrer"},"body":{"file":"index.html"}},
  "dash GET /view/preview/<name>": {"status":200,"headers":{"cache-control":"no-store","content-security-policy":"frame-src 'self'; frame-ancestors 'self' http://127.0.0.1:{PORTS+50}","content-type":"text/html; charset=utf-8","referrer-policy":"no-referrer"},"body":{"file":"index.html"}},
  "dash GET /review/preview/devteam-ui.js": {"status":200,"headers":{"cache-control":"no-store","content-type":"text/javascript; charset=utf-8","x-content-type-options":"nosniff"},"body":{"file":"devteam-ui.js"}},
  "dash GET /review/preview/devteam-ui.css": {"status":200,"headers":{"cache-control":"no-store","content-type":"text/css; charset=utf-8","x-content-type-options":"nosniff"},"body":{"file":"devteam-ui.css"}},
  "dash GET /review/<qid>/devteam-ui.js": {"status":200,"headers":{"cache-control":"no-store","content-type":"text/javascript; charset=utf-8","x-content-type-options":"nosniff"},"body":{"file":"devteam-ui.js"}},
  "dash GET /review/<qid>/devteam-ui.css?x=1": {"status":200,"headers":{"cache-control":"no-store","content-type":"text/css; charset=utf-8","x-content-type-options":"nosniff"},"body":{"file":"devteam-ui.css"}},
  "dash GET /review/preview/other.js": {"status":404,"headers":{"cache-control":"no-store","content-type":"text/plain"},"body":"not found"},
  "dash GET /review/Bad_Seg/devteam-ui.js": {"status":404,"headers":{"cache-control":"no-store","content-type":"text/plain"},"body":"not found"},
  "dash HEAD /review/preview/devteam-ui.js": {"status":404,"headers":{"cache-control":"no-store","content-type":"text/plain"},"body":""},
  "dash HEAD /": {"status":404,"headers":{"cache-control":"no-store","content-type":"text/plain"},"body":""},
  "dash GET /nope": {"status":404,"headers":{"cache-control":"no-store","content-type":"text/plain"},"body":"not found"},
  "dash HEAD /nope": {"status":404,"headers":{"cache-control":"no-store","content-type":"text/plain"},"body":""},
  "dash GET /devteam-ui.js": {"status":404,"headers":{"cache-control":"no-store","content-type":"text/plain"},"body":"not found"},
  "dash GET /_next/static/chunks/app.js": {"status":404,"headers":{"cache-control":"no-store","content-type":"text/plain"},"body":"not found"},
  "dash GET /api/nope": {"status":404,"headers":{"cache-control":"no-store","content-type":"text/plain"},"body":"not found"},
  "dash POST /api/nope": {"status":404,"headers":{"cache-control":"no-store","content-type":"text/plain"},"body":"not found"},
  "dash PUT /": {"status":404,"headers":{"cache-control":"no-store","content-type":"text/plain"},"body":"not found"},
  "dash POST /api/answer": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "dash POST /api/correct": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "dash POST /api/goal-hold": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "dash POST /api/fleet": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "dash POST /api/goal-met": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "dash POST /api/goal-order": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "dash POST /api/goal-decide": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "dash POST /api/knowledge": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "dash POST /api/ack": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "dash POST /api/artifact-publish": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "dash POST /api/preview-stop": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "dash POST /api/preview-start": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "dash POST /api/thread-new": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "dash POST /api/thread-say": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "dash POST /api/thread-resolve": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "dash POST /api/thread-reopen": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "dash POST /api/thread-accept": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "dash POST /api/thread-accept-addressed": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "dash POST /api/artifact-handoff": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "dash POST /api/secret": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "dash POST /api/review-draft": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "dash POST /api/review-answer": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "dash POST /api/pane-answer": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "dash POST /api/owner-setting": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "dash POST /api/fleet-check": {"status":403,"headers":{"cache-control":"no-store","content-type":"application/json"},"body":"{\"error\":\"owner actions only from this dashboard's own page, in a browser (Sec-Fetch-Site same-origin or this page's Origin)\"}"},
  "hub GET /": {"status":200,"headers":{"cache-control":"no-store","content-security-policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; manifest-src 'self'; frame-src http://127.0.0.1:{PORTS+1} http://127.0.0.1:{PORTS+2} http://127.0.0.1:{PORTS+3} http://127.0.0.1:{PORTS+4} http://127.0.0.1:{PORTS+5} http://127.0.0.1:{PORTS+6} http://127.0.0.1:{PORTS+7} http://127.0.0.1:{PORTS+8} http://127.0.0.1:{PORTS+9} http://127.0.0.1:{PORTS+10} http://127.0.0.1:{PORTS+11} http://127.0.0.1:{PORTS+12} http://127.0.0.1:{PORTS+13} http://127.0.0.1:{PORTS+14} http://127.0.0.1:{PORTS+15} http://127.0.0.1:{PORTS+16} http://127.0.0.1:{PORTS+17} http://127.0.0.1:{PORTS+18} http://127.0.0.1:{PORTS+19} http://127.0.0.1:{PORTS+20} http://127.0.0.1:{PORTS+21} http://127.0.0.1:{PORTS+22} http://127.0.0.1:{PORTS+23} http://127.0.0.1:{PORTS+24} http://127.0.0.1:{PORTS+25}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'","content-type":"text/html; charset=utf-8","x-content-type-options":"nosniff"},"body":{"file":"hub.html"}},
  "hub GET /nope": {"status":404,"headers":{"cache-control":"no-store","content-type":"text/plain; charset=utf-8","x-content-type-options":"nosniff"},"body":"not found"},
  "hub GET /_next/static/chunks/app.js": {"status":404,"headers":{"cache-control":"no-store","content-type":"text/plain; charset=utf-8","x-content-type-options":"nosniff"},"body":"not found"},
  "hub HEAD /": {"status":405,"headers":{"allow":"GET","cache-control":"no-store","content-type":"text/plain; charset=utf-8","x-content-type-options":"nosniff"},"body":""},
  "hub POST /": {"status":405,"headers":{"allow":"GET","cache-control":"no-store","content-type":"text/plain; charset=utf-8","x-content-type-options":"nosniff"},"body":"the hub only lists, and takes the owner's threads with the operator"},
  "browser GET /": {"status":200,"headers":{"cache-control":"no-store","content-security-policy":"frame-ancestors 'self'","content-type":"text/html; charset=utf-8","referrer-policy":"no-referrer","x-content-type-options":"nosniff"},"body":{"file":"browser.html"}},
  "browser GET /?x=1": {"status":200,"headers":{"cache-control":"no-store","content-security-policy":"frame-ancestors 'self'","content-type":"text/html; charset=utf-8","referrer-policy":"no-referrer","x-content-type-options":"nosniff"},"body":{"file":"browser.html"}},
  "browser HEAD /": {"status":200,"headers":{"cache-control":"no-store","content-security-policy":"frame-ancestors 'self'","content-type":"text/html; charset=utf-8","referrer-policy":"no-referrer","x-content-type-options":"nosniff"},"body":""},
  "browser GET /nope": {"status":404,"headers":{"cache-control":"no-store","content-type":"text/plain; charset=utf-8","x-content-type-options":"nosniff"},"body":"not found\n"},
  "browser GET /_next/static/chunks/app.js": {"status":404,"headers":{"cache-control":"no-store","content-type":"text/plain; charset=utf-8","x-content-type-options":"nosniff"},"body":"not found\n"},
  "browser POST /": {"status":405,"headers":{"allow":"GET, HEAD","cache-control":"no-store","content-type":"text/plain; charset=utf-8","x-content-type-options":"nosniff"},"body":"method not allowed\n"},
  "browser GET / on another Host": {"status":403,"headers":{"cache-control":"no-store","content-type":"text/plain; charset=utf-8","x-content-type-options":"nosniff"},"body":"forbidden\n"},
};

// What a server answered, in BASE's shape: the ports put back as {PORT} and {PORTS+n}.
function shape(r, ports, files) {
  const t = (s) => String(s).replaceAll(`:${ports.PORT}`, ':{PORT}').replace(/:(\d{4,5})\b/g, (m, n) => (Number(n) >= PORTS && Number(n) < PORTS + 100 ? `:{PORTS+${Number(n) - PORTS}}` : m));
  const headers = {};
  for (const k of Object.keys(r.headers).sort()) if (!['date', 'connection', 'keep-alive', 'content-length', 'transfer-encoding'].includes(k)) headers[k] = t(r.headers[k]);
  const file = Object.entries(files).find(([, b]) => b.equals(r.body))?.[0];
  return { status: r.status, headers, body: file ? { file } : t(r.body.toString('utf8')) };
}
function compare(got, name) {
  if (RECORD) { process.stdout.write(`RECORD ${JSON.stringify(name)}: ${JSON.stringify(got)},\n`); return; }
  assert.ok(BASE[name], `BASE has ${name}`);
  assert.deepEqual(got, BASE[name], `${name}: as the base sent it`);
}

// The dashboard's own requests, each a name in BASE: the pages, the review helpers, and what must
// still be refused or 404 with dashRoutesApp in the chain.
const ARTIFACT = 'some-mock';
const PREVIEW = 'quiet-otter';
const QID = 'q-20261126-000000000-supervisor';
function dashRequests(actions) {
  return [
    ['dash GET /', '/', {}],
    ['dash GET /index.html', '/index.html', {}],
    ['dash GET /view/artifact/<id>', `/view/artifact/${ARTIFACT}`, {}],
    ['dash GET /view/preview/<name>', `/view/preview/${PREVIEW}`, {}],
    ['dash GET /review/preview/devteam-ui.js', '/review/preview/devteam-ui.js', {}],
    ['dash GET /review/preview/devteam-ui.css', '/review/preview/devteam-ui.css', {}],
    ['dash GET /review/<qid>/devteam-ui.js', `/review/${QID}/devteam-ui.js`, {}],
    ['dash GET /review/<qid>/devteam-ui.css?x=1', `/review/${QID}/devteam-ui.css?x=1`, {}],
    ['dash GET /review/preview/other.js', '/review/preview/other.js', {}],
    ['dash GET /review/Bad_Seg/devteam-ui.js', '/review/Bad_Seg/devteam-ui.js', {}],
    ['dash HEAD /review/preview/devteam-ui.js', '/review/preview/devteam-ui.js', { method: 'HEAD' }],
    ['dash HEAD /', '/', { method: 'HEAD' }],
    ['dash GET /nope', '/nope', {}],
    ['dash HEAD /nope', '/nope', { method: 'HEAD' }],
    ['dash GET /devteam-ui.js', '/devteam-ui.js', {}],
    ['dash GET /_next/static/chunks/app.js', '/_next/static/chunks/app.js', {}],
    ['dash GET /api/nope', '/api/nope', {}],
    ['dash POST /api/nope', '/api/nope', { method: 'POST', body: '{}' }],
    ['dash PUT /', '/', { method: 'PUT', body: '' }],
    // every owner POST, refused before anything runs (no Origin, no Sec-Fetch-Site): it reached dashRoutesOwner
    ...actions.map((a) => [`dash POST /api/${a}`, `/api/${a}`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }]),
  ];
}
// Every name dashRoutesOwner takes a POST for: dashboardActions()'s ACTIONS and the six of its own.
function ownerPosts() {
  const { ACTIONS } = vm.runInNewContext(`${decl('function dashboardActions(')}\n;dashboardActions()`, {});
  return [...Object.keys(ACTIONS), 'secret', 'review-draft', 'review-answer', 'pane-answer', 'owner-setting', 'fleet-check'];
}

test('S3 the dashboard and its hub send every page, review helper, 404 and refusal as the base did; /api/data says pageVersion', { timeout: 300000 }, async (t) => {
  const base = scratch('dash');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = bareProject(base, 'seam');
  const dk = path.join(root, 'docs', 'devteam', 'dashboard');
  const files = Object.fromEntries(['index.html', 'hub.html', 'devteam-ui.js', 'devteam-ui.css'].map((f) => [f, fs.readFileSync(path.join(dk, f))]));
  // a preview whose app is a port nothing listens on: its viewer page needs only the record
  const prev = path.join(root, 'docs', 'devteam', 'run', 'previews');
  fs.mkdirSync(prev, { recursive: true });
  fs.writeFileSync(path.join(prev, `${PREVIEW}.json`), JSON.stringify({ v: 1, name: PREVIEW, project: 'seam', session: 'supervisor', label: 'seam', port: PORTS + 51, cwd: root, at: new Date().toISOString(), expires: new Date(Date.now() + 86400000).toISOString() }));
  const env = { ...process.env, HOME: scratch('home'), DEVTEAM_HUB_PORT: String(HUB), DEVTEAM_DATA_WAIT_MS: '0' };
  const { dash, port } = await dashboardOnFreePort(root, env);
  t.after(() => dash.stop());
  const ports = { PORT: port };
  for (const [name, p, o] of dashRequests(ownerPosts())) compare(shape(await ask(port, p, o), ports, files), name);
  // the hub this dashboard started
  for (let i = 0; i < 300; i++) { try { if ((await ask(HUB, '/instances.json')).status === 200) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  for (const [name, p, o] of [['hub GET /', '/', {}], ['hub GET /nope', '/nope', {}], ['hub GET /_next/static/chunks/app.js', '/_next/static/chunks/app.js', {}], ['hub HEAD /', '/', { method: 'HEAD' }], ['hub POST /', '/', { method: 'POST', body: '' }]]) compare(shape(await ask(HUB, p, o), ports, files), name);
  // /api/data's x-devteam-page: the first 16 hex of index.html's sha256, as at the base
  const d = await ask(port, '/api/data');
  assert.equal(d.status, 200, `S3 /api/data: ${d.body.toString().slice(0, 300)}`);
  assert.equal(d.headers['x-devteam-page'], sha(files['index.html']).slice(0, 16), 'S3 x-devteam-page is the sha256 of index.html');
  if (!RECORD) assert.equal(seam().pageVersion('dashboard'), sha(fs.readFileSync(path.join(kit, 'dashboard', 'index.html'))).slice(0, 16), "S3 pageVersion('dashboard') gives it");
});

test("S4 the browser view's server sends its page, its 404, 405 and 403 as the base did, reads its page at creation and keeps it", async (t) => {
  // a kit folder of its own, so its browser.html can change under the running server
  const K = scratch('kit');
  t.after(() => fs.rmSync(K, { recursive: true, force: true }));
  fs.mkdirSync(path.join(K, 'dashboard'));
  const original = fs.readFileSync(path.join(kit, 'dashboard', 'browser.html'));
  fs.writeFileSync(path.join(K, 'dashboard', 'browser.html'), original);
  const { browserViewServer } = seam(K);
  if (!RECORD) assert.throws(() => seam(path.join(K, 'nothing')).browserViewServer({}), /ENOENT/, 'S4 with no browser.html the server fails at its creation, as before');
  const server = browserViewServer({});
  // a kit sync after the daemon started: it keeps the page its code came with
  fs.writeFileSync(path.join(K, 'dashboard', 'browser.html'), '<!doctype html><title>a newer page</title>');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }));
  const port = server.address().port;
  const files = { 'browser.html': original };
  for (const [name, p, o] of [
    ['browser GET /', '/', {}],
    ['browser GET /?x=1', '/?x=1', {}],
    ['browser HEAD /', '/', { method: 'HEAD' }],
    ['browser GET /nope', '/nope', {}],
    ['browser GET /_next/static/chunks/app.js', '/_next/static/chunks/app.js', {}],
    ['browser POST /', '/', { method: 'POST', body: '' }],
    ['browser GET / on another Host', '/', { host: 'example.com' }],
  ]) compare(shape(await ask(port, p, o), { PORT: port }, files), name);
});

// ---- the seam's wiring, read from the source ----------------------------------------------------

test('S5 each server sends its page through servePage and its assets through servePageAsset; dashRoutesApp sits just before dashRoutesOwner', { skip: RECORD }, () => {
  for (const [fn, page] of [['async function dashRoutesPage(', 'dashboard'], ['async function dashRoutesViewer(', 'dashboard'], ['function startHub(', 'hub'], ['function browserViewServer(', 'browser']]) {
    const body = decl(fn);
    assert.match(body, new RegExp(`servePage\\((?:D|null), req, res, '${page}', `), `S5 ${fn} calls servePage for ${page}`);
    assert.doesNotMatch(body, /readFileSync\(page\)|'(?:index|hub|browser)\.html'/, `S5 ${fn} reads no page of its own`);
  }
  assert.match(decl('async function dashRoutesPage('), /'x-devteam-page': version/, 'S5 /api/data sends version');
  assert.match(decl('async function dashRoutesPage('), /const version = pageVersion\('dashboard'\);/, "S5 version is pageVersion('dashboard')");
  const review = decl('async function dashRoutesReviewPage(');
  assert.match(review, /if \(file === 'devteam-ui\.css' \|\| file === 'devteam-ui\.js'\) return servePageAsset\(req, res, 'dashboard'\);/, 'S5 the review helpers go through servePageAsset');
  assert.doesNotMatch(review, /path\.join\(kitDir, 'dashboard', file\)/, 'S5 and no read of its own');
  assert.match(decl('function startHub('), /if \(servePageAsset\(req, res, 'hub'\) !== DASH_NEXT\) return;\n\s*return send\(404, /, "S5 the hub asks servePageAsset just before its 404");
  assert.match(decl('function browserViewServer('), /!== '\/'\) return servePageAsset\(req, res, 'browser'\) !== DASH_NEXT \? undefined : no\(404\);/, "S5 the browser view asks servePageAsset before its 404");
  // each caller's own policy, as at the base (a policy recorded at the base can't tell pageCsp() from pageCsp(frames) with no frames)
  assert.match(decl('async function dashRoutesPage('), /servePage\(D, req, res, 'dashboard', pageCsp\(stageFrames\(\)\), \{ 'cache-control': 'no-store' \}\)/, "S5 / sends pageCsp(stageFrames())");
  const viewer = decl('async function dashRoutesViewer(');
  assert.match(viewer, /servePage\(D, req, res, 'dashboard', pageCsp\(\), \{ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' \}\)/, "S5 /view/artifact/ sends pageCsp()");
  assert.match(viewer, /servePage\(D, req, res, 'dashboard', pageCsp\(origin \? \[origin\] : \[\]\), \{ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' \}\)/, "S5 /view/preview/ sends pageCsp(origin ? [origin] : [])");
  const app = decl('function dashRoutesApp(');
  assert.match(app, /if \(req\.method !== 'GET' && req\.method !== 'HEAD'\) return DASH_NEXT;\n\s*return servePageAsset\(req, res, 'dashboard'\);/, 'S5 dashRoutesApp takes GET and HEAD alone, then calls servePageAsset');
  assert.ok(src.indexOf('\nfunction dashRoutesApp(') < src.indexOf('/* cmdDashboard start */'), 'S5 dashRoutesApp is outside the cmdDashboard region (ruling m-20261126-181134196)');
  const routes = /^const DASHBOARD_ROUTES = \[([^\]]*)\];$/m.exec(src)[1].split(',').map((s) => s.trim());
  assert.deepEqual(routes.slice(-2), ['dashRoutesApp', 'dashRoutesOwner'], 'S5 dashRoutesApp is second to last, just before dashRoutesOwner (ruling m-20261126-174823122)');
  assert.equal(routes.filter((r) => r === 'dashRoutesApp').length, 1, 'S5 once');
  // serveAppFiles' one caller at main is alphaServe (kit-961), the dashboard's and the hub's /next/;
  // they reach it only through alphaServe, and nothing serves /next/ by a function of its own
  const callers = src.split(/\n(?=(?:async )?function \w+\(|const \w+ = )/).filter((d) => /serveAppFiles\(/.test(d) && !d.startsWith('function serveAppFiles(')).map((d) => /^(?:async )?(?:function|const) (\w+)/.exec(d)?.[1]);
  assert.deepEqual(callers, ['alphaServe'], 'S5 serveAppFiles is called by alphaServe alone');
  assert.equal(decl('function alphaServe(').match(/serveAppFiles\(/g).length, 1, 'S5 alphaServe calls it once');
  const alphaRoutes = decl('function dashRoutesAlpha(');
  assert.match(alphaRoutes, /return alphaServe\('dashboard', req, res, \(\) => pageCsp\(stageFrames\(\)\), true\);/, "S5 the dashboard's /next/ is alphaServe under / route's policy");
  assert.match(alphaRoutes, /const root = \{ method: req\.method, url: '\/next\/' \};[\s\S]*return alphaServe\('dashboard', root, res, policy, true\);/, "S5 the viewer's paths are alphaServe asked for /next/");
  assert.doesNotMatch(alphaRoutes, /\bfs\.|readFile|createReadStream|writeHead/, 'S5 dashRoutesAlpha reads and sends no file of its own');
  // each viewer path keeps its own policy, as /view/artifact and /view/preview send it today
  assert.match(alphaRoutes, /return viewer\(\(\) => pageCsp\(\)\);/, "S5 /next/view/artifact/ is pageCsp()'s");
  assert.match(alphaRoutes, /previewStage\(rec\)\.then\(\(\{ origin \}\) => viewer\(\(\) => pageCsp\(origin \? \[origin\] : \[\]\)\)\)/, "S5 /next/view/preview/ is pageCsp(origin ? [origin] : [])'s");
  assert.match(decl('function startHub('), /if \(alphaServe\('hub', req, res, \(\) => hubPolicy, !standalone\) !== DASH_NEXT\) return;/, "S5 the hub's /next/ is alphaServe under the hub page's policy");
  assert.deepEqual(routes.slice(-3), ['dashRoutesAlpha', 'dashRoutesApp', 'dashRoutesOwner'], 'S5 dashRoutesAlpha sits just before dashRoutesApp');
});

// ---- the hub's seam is what the box image runs ---------------------------------------------------

test("S7 box-pins changed names an edit to servePage or servePageAsset as an image change (the hub sends through them); serveAppFiles is not one", { timeout: 300000 }, (t) => {
  // a kit repo from this checkout's tracked files, as they are in the working tree, tagged v9.1.0
  const R = scratch('image');
  t.after(() => fs.rmSync(R, { recursive: true, force: true }));
  const REPO = path.resolve(testDir, '..');
  const env = { ...process.env, HOME: scratch('image-home'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const git = (args) => execFileSync('git', args, { cwd: R, encoding: 'utf8', env });
  git(['init', '-q', '-b', 'main']);
  git(['remote', 'add', 'origin', 'git@github.com:sanctuarycomputer/devteam.git']);
  for (const f of execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean)) {
    const st = fs.lstatSync(path.join(REPO, f), { throwIfNoEntry: false });
    if (!st) continue;
    fs.mkdirSync(path.dirname(path.join(R, f)), { recursive: true });
    if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(path.join(REPO, f)), path.join(R, f));
    else { fs.copyFileSync(path.join(REPO, f), path.join(R, f)); fs.chmodSync(path.join(R, f), st.mode & 0o777); }
  }
  git(['add', '-A']);
  git(['commit', '-qm', 'v9.1.0']);
  git(['tag', 'v9.1.0']);
  const SCRIPT_REL = 'docs/devteam/scripts/devteam.mjs';
  for (const [name, image] of [['servePage', true], ['servePageAsset', true], ['serveAppFiles', false]]) {
    git(['checkout', '-q', '-B', `edit-${name}`, 'v9.1.0']);
    const file = path.join(R, SCRIPT_REL);
    const text = fs.readFileSync(file, 'utf8');
    const head = new RegExp(`^function ${name}\\(.*\\{$`, 'm').exec(text);
    assert.ok(head, `S7 devteam.mjs declares ${name}`);
    fs.writeFileSync(file, text.replace(head[0], () => `${head[0]}\n  // kit-983 probe`));
    git(['commit', '-qam', `edit ${name}`]);
    const r = spawnSync(process.execPath, [file, 'box-pins', 'changed', '--since', 'v9.1.0'], { cwd: R, encoding: 'utf8', env, timeout: 240000 });
    if (image) {
      assert.equal(r.stdout, `image: ${SCRIPT_REL}#${name}\nkind: minor (1 changes the image runs)\n`, `S7 an edit to ${name} is an image change: ${r.stderr}`);
      assert.equal(r.status, 3, `S7 ${name}: exit 3`);
    } else {
      assert.equal(r.stdout, 'kind: patch\n', `S7 an edit to ${name} is not: ${r.stderr}`);
      assert.equal(r.status, 0, `S7 ${name}: exit 0`);
    }
  }
});
