// kit-1027: a request the dashboard can't take apart is answered, and the dashboard serves on.
// R1 a request target that is no URL against the dashboard's base is a 400, on every method, and the
// next ordinary request answers as before. R2 a review helper missing from the kit's dashboard folder
// is a 500 from servePageAsset, the dashboard and its hub serve on; the hub and the browser view
// never read it. R3 every place the dashboard's handler and routes build a URL from req.url sits
// inside a try (the one parse at the top answers 400).
// R4 a route that throws on what a request carries (today: /api/file with a NUL in its path, which
// execFile refuses) is answered 400 or 500, never a stop; it serves on. Its log line is the method, the
// path without its query, and the error's class and code; nothing from the query or the error's
// message (kit-1030: the query's value, a marker here, appears nowhere in the dashboard's log, though
// Node's message quotes it).
// R5 dashRequestFailed, the handler's catch, on its own: a 500 before any header, a destroy once
// headers are out and the response is open, nothing once it has ended; the logged path cut at 200, and
// of the error only its class. R6 (kit-1030) the error is its class and code, never its message or
// stack, which can quote the request; a thrown value that is no object is named by its type.
// Ports: +50 the dashboard's hub (the dashboard itself is pinned on a free port outside the block)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { PORTS, kit, bareProject, dashboardOnFreePort } from './lib/kit.mjs';

const SCRIPT = path.join(kit, 'scripts', 'devteam.mjs');
const src = fs.readFileSync(SCRIPT, 'utf8');
const HUB = PORTS + 50;
const scratch = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `request-path-${name}-`));

// One request written byte for byte (no client tidies the target), on the dashboard's own Host unless
// told another, with any extra header lines: its status line's code, its header block and body, or
// status null when the connection closed with no answer.
function raw(port, target, method = 'GET', { host = `127.0.0.1:${port}`, extra = '' } = {}) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    const chunks = [];
    const done = () => {
      const text = Buffer.concat(chunks).toString('latin1');
      const m = /^HTTP\/1\.1 (\d{3})/.exec(text);
      const [head, ...rest] = text.split('\r\n\r\n');
      resolve({ status: m ? Number(m[1]) : null, head: head.toLowerCase(), body: rest.join('\r\n\r\n') });
    };
    s.on('data', (c) => { chunks.push(c); if (/\r\n\r\n/.test(Buffer.concat(chunks).toString('latin1'))) setTimeout(() => s.destroy(), 200); });
    s.on('close', done);
    s.on('error', () => {});
    s.setTimeout(30000, () => s.destroy());
    s.write(`${method} ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n${extra}${method === 'POST' ? 'Content-Length: 0\r\n' : ''}\r\n`);
  });
}
const alive = async (port, what) => {
  const r = await raw(port, '/api/hello');
  assert.equal(r.status, 200, `${what}: the next GET /api/hello answers 200`);
};

// Targets that reach the handler (Node's own parser answers one that is neither origin- nor
// absolute-form, such as two backslashes, itself); BAD is those this Node's URL refuses against the
// dashboard's base, which differ by version (Node 24 takes '//xn--', 18 and 22 refuse it).
const CANDIDATES = ['//', '///', '//:', '//a:99999', '//a:x', '//[', '//[::1', '//a%zz', '//%', '/\\', '//@', '//a@', 'http://', 'https://a:99999/', '//xn--', '//256.256.256.256', '//1.2.3.4.5', '//[1::2::3]'];
const BAD = CANDIDATES.filter((t) => { try { new URL(t, 'http://x'); return false; } catch { return true; } });

async function dashboard(t, { drop = [] } = {}) {
  // one hook, in this order: the dashboard stopped (its group gone), then its fixture removed, so
  // nothing it started is still writing into a folder being removed
  // (both folders go even when the stop fails)
  const base = scratch('dash');
  const home = scratch('home');
  let dash = null;
  t.after(async () => {
    try { await dash?.stop(); } finally { for (const d of [base, home]) fs.rmSync(d, { recursive: true, force: true }); }
  });
  const root = bareProject(base, 'guard');
  for (const f of drop) fs.rmSync(path.join(root, 'docs', 'devteam', 'dashboard', f));
  const env = { ...process.env, HOME: home, DEVTEAM_HUB_PORT: String(HUB), DEVTEAM_DATA_WAIT_MS: '0' };
  for (const k of Object.keys(env)) if (k.startsWith('DEVTEAM_') && !['DEVTEAM_HUB_PORT', 'DEVTEAM_DATA_WAIT_MS', 'DEVTEAM_PORT_BASE', 'DEVTEAM_TEST_SHARED_TMP'].includes(k)) delete env[k];
  let port;
  ({ dash, port } = await dashboardOnFreePort(root, env));
  return { dash, port, root };
}

test('R1 a request target that is no URL is a 400 on every method, and the dashboard serves on', { timeout: 300000 }, async (t) => {
  assert.ok(BAD.includes('//') && BAD.length >= 10, `R1 this Node refuses '//' and at least ten of the targets (${BAD.length})`);
  const { dash, port } = await dashboard(t);
  for (const target of BAD) {
    for (const method of ['GET', 'HEAD', 'POST']) {
      const r = await raw(port, target, method);
      assert.equal(r.status, 400, `R1 ${method} ${target} answers 400 (${dash.out().split('\n').filter((l) => /crash/.test(l)).slice(-1)[0] ?? ''})`);
      assert.match(r.head, /\r\ncontent-type: text\/plain; charset=utf-8\r\n/, `R1 ${method} ${target}: the 400 is plain text`);
      assert.match(r.head, /\r\ncache-control: no-store(\r\n|$)/, `R1 ${method} ${target}: the 400 is not kept`);
      if (method === 'GET') assert.match(r.body, /bad request/, `R1 ${method} ${target} says why`);
      await alive(port, `R1 after ${method} ${target}`);
    }
  }
  // still refused before the parse: another Host gets the Host refusal, a relayed request the relay's
  assert.equal((await raw(port, '//', 'GET', { host: 'example.com' })).status, 403, 'R1 another Host is refused first (403), as before');
  const relayed = await raw(port, '//', 'GET', { extra: 'x-devteam-relay: 1\r\n' });
  assert.equal(relayed.status, 403, 'R1 a relayed request is refused first (403), as before');
  assert.match(relayed.body, /not through a preview relay/, 'R1 the relay refusal says why');
  assert.equal(dash.p.exitCode, null, 'R1 the dashboard process is still running');
});

test('R2 a missing review helper is a 500 and the dashboard and its hub serve on', { timeout: 300000 }, async (t) => {
  const { dash, port } = await dashboard(t, { drop: ['devteam-ui.js', 'devteam-ui.css'] });
  for (const f of ['devteam-ui.js', 'devteam-ui.css']) {
    const r = await raw(port, `/review/preview/${f}`);
    assert.equal(r.status, 500, `R2 GET /review/preview/${f} with the file gone answers 500`);
    await alive(port, `R2 after /review/preview/${f}`);
  }
  // the hub this dashboard started: it never reads the helpers (its 404), and serves on
  let up = false;
  for (let i = 0; i < 300 && !up; i++) { up = (await raw(HUB, '/instances.json')).status === 200; if (!up) await new Promise((r) => setTimeout(r, 100)); }
  assert.ok(up, 'R2 the hub is up');
  assert.equal((await raw(HUB, '/review/preview/devteam-ui.js')).status, 404, "R2 the hub's GET /review/preview/devteam-ui.js is its 404, as before");
  assert.equal((await raw(HUB, '/instances.json')).status, 200, 'R2 the hub serves on');
  assert.equal(dash.p.exitCode, null, 'R2 the dashboard process is still running');
});

// servePageAsset on its own, under node:vm with a kit folder that has no helpers
test('R2 servePageAsset: with the helper gone the dashboard gets a 500 and nothing throws; the hub and browser view are not its', () => {
  const K = scratch('kit');
  fs.mkdirSync(path.join(K, 'dashboard'));
  try {
    const i = src.indexOf('\nfunction servePageAsset(');
    assert.ok(i >= 0, 'devteam.mjs declares servePageAsset');
    const code = src.slice(i + 1, src.indexOf('\n}\n', i + 1) + 3);
    const NEXT = Symbol('next');
    const servePageAsset = vm.runInContext(`${code}\n;servePageAsset`, vm.createContext({ fs, path, URL, kitDir: K, DASH_NEXT: NEXT }));
    const res = () => { const o = { code: null, headers: null, body: null, writeHead(c, h) { o.code = c; o.headers = h; }, end(b) { o.body = b; } }; return o; };
    for (const f of ['devteam-ui.js', 'devteam-ui.css']) {
      const r = res();
      let threw = null;
      try { servePageAsset({ method: 'GET', url: `/review/preview/${f}` }, r, 'dashboard'); } catch (e) { threw = e; }
      assert.equal(threw, null, `R2 servePageAsset dashboard ${f} gone: no throw (${threw?.code ?? ''})`);
      assert.equal(r.code, 500, `R2 servePageAsset dashboard ${f} gone: a 500`);
      assert.deepEqual({ ...r.headers }, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }, `R2 servePageAsset dashboard ${f} gone: the 500's headers, as servePage's`);
      assert.equal(r.body, 'this file could not be read\n', `R2 servePageAsset dashboard ${f} gone: the 500 says why, and nothing of the path`);
      for (const server of ['hub', 'browser']) {
        const h = res();
        assert.equal(servePageAsset({ method: 'GET', url: `/review/preview/${f}` }, h, server), NEXT, `R2 servePageAsset ${server} ${f}: not its (DASH_NEXT)`);
        assert.equal(h.code, null, `R2 servePageAsset ${server} ${f}: writes nothing`);
      }
    }
  } finally { fs.rmSync(K, { recursive: true, force: true }); }
});

test('R3 every new URL(req.url …) in the dashboard handler, its routes and servePageAsset sits inside a try', () => {
  const a = src.indexOf('/* cmdDashboard start */');
  const b = src.indexOf('/* cmdDashboard end */');
  assert.ok(a > 0 && b > a, 'devteam.mjs marks the cmdDashboard region');
  const i = src.indexOf('\nfunction servePageAsset(');
  const text = `${src.slice(i, src.indexOf('\n}\n', i + 1))}\n${src.slice(a, b)}`;
  const lines = text.split('\n').filter((l) => /new URL\(req\.url\b/.test(l));
  assert.ok(lines.length >= 3, `R3 found the parses (${lines.length})`);
  for (const l of lines) assert.match(l, /try \{[^}]*new URL\(req\.url\b/, `R3 inside a try: ${l.trim().slice(0, 160)}`);
});

test('R4 a route that throws on a request is answered (400 or 500), logged without its input, and the dashboard serves on', { timeout: 300000 }, async (t) => {
  const { dash, port, root } = await dashboard(t);
  // MARK is the request's own text: execFile's error message quotes the bad value, so a log of the
  // message or stack would carry it
  const MARK = 'kit1030marker';
  for (const target of [`/api/file?path=${MARK}%00`, `/api/file?path=a%00${MARK}&ref=HEAD`]) {
    const r = await raw(port, target);
    assert.ok([400, 500].includes(r.status), `R4 GET ${target} is answered 400 or 500 (got ${r.status}; ${dash.out().split('\n').filter((l) => /crash/.test(l)).slice(-1)[0] ?? ''})`);
    if (r.status === 500) {
      assert.match(r.head, /\r\ncontent-type: text\/plain; charset=utf-8\r\n/, `R4 GET ${target}: the 500 is plain text`);
      assert.match(r.body, /this request failed/, `R4 GET ${target}: the 500 says so`);
    }
    await alive(port, `R4 after GET ${target}`);
  }
  assert.equal(dash.p.exitCode, null, 'R4 the dashboard process is still running');
  // the dashboard's log names each failure by method, path (the query cut) and the error's class and code
  let logText = '';
  try { logText = fs.readFileSync(path.join(root, 'docs', 'devteam', 'run', 'dashboard.log'), 'utf8'); } catch {}
  const lines = logText.split('\n').filter((l) => / request failed: /.test(l));
  assert.equal(lines.length, 2, `R4 the log has a request failed line for each (${lines.length})`);
  assert.ok(!logText.includes(MARK), `R4 the query's value is nowhere in the dashboard's log: ${logText.split('\n').filter((l) => l.includes(MARK)).map((l) => l.slice(0, 200)).join(' | ')}`);
  for (const l of lines) assert.match(l, / request failed: GET \/api\/file: TypeError ERR_INVALID_ARG_VALUE$/, `R4 the line is the method, the path without its query, the error's class and code: ${l.slice(0, 160)}`);
});

// the handler's catch on its own, under node:vm, with a response stub that records what it was asked
test('R5 dashRequestFailed: a 500 before headers, a destroy after them while open, nothing once ended; the path cut', () => {
  const i = src.indexOf('\nfunction dashRequestFailed(');
  assert.ok(i >= 0, 'devteam.mjs declares dashRequestFailed');
  const code = src.slice(i + 1, src.indexOf('\n}\n', i + 1) + 3);
  const dashRequestFailed = vm.runInContext(`${code}\n;dashRequestFailed`, vm.createContext({}));
  const stub = (headersSent, writableEnded) => {
    const o = { headersSent, writableEnded, code: null, headers: null, body: null, destroyed: false, writeHead(c, h) { o.code = c; o.headers = h; }, end(b) { o.body = b; }, destroy() { o.destroyed = true; } };
    return o;
  };
  const err = new Error('boom');
  const run = (url, res, e = err) => { const lines = []; dashRequestFailed((m) => lines.push(m), { method: 'GET', url }, res, e); return lines; };
  // before any header: the 500, as the handler's other plain answers
  const a = stub(false, false);
  const la = run('/api/file?path=x', a);
  assert.equal(a.code, 500, 'R5 before any header: a 500');
  assert.deepEqual({ ...a.headers }, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, "R5 the 500's headers");
  assert.equal(a.body, 'this request failed', "R5 the 500's body");
  assert.equal(a.destroyed, false, 'R5 before any header: no destroy');
  assert.deepEqual(la, ['request failed: GET /api/file: Error'], "R5 one log line: method, path without its query, the error's class");
  // headers out, response open: destroyed, nothing written
  const b = stub(true, false);
  run('/x', b);
  assert.equal(b.destroyed, true, 'R5 headers out and the response open: destroyed, so a cut body looks cut');
  assert.equal(b.code, null, 'R5 headers out: no second writeHead');
  assert.equal(b.body, null, 'R5 headers out: no body written');
  // the response already ended: left as it is
  const c = stub(true, true);
  run('/x', c);
  assert.equal(c.destroyed, false, 'R5 a response already ended is not destroyed');
  assert.equal(c.code, null, 'R5 a response already ended gets no writeHead');
  // a long path is cut at 200 characters, the query never logged
  const long = `/${'a'.repeat(300)}`;
  const ld = run(`${long}?q=secret`, stub(false, false));
  assert.deepEqual(ld, [`request failed: GET ${long.slice(0, 200)}: Error`], 'R5 the logged path is cut at 200 characters, without its query');
});

// kit-1030: of the error, dashRequestFailed logs its class and code only, never its message or stack,
// which can quote the request (MARK stands for the request's text); a code that is no plain name is
// left out, and a thrown value that is no object is named by its type
test('R6 dashRequestFailed: the error is logged by class and code, never by its text', () => {
  const i = src.indexOf('\nfunction dashRequestFailed(');
  const code = src.slice(i + 1, src.indexOf('\n}\n', i + 1) + 3);
  const dashRequestFailed = vm.runInContext(`${code}\n;dashRequestFailed`, vm.createContext({}));
  const stub = () => { const o = { headersSent: false, writableEnded: false, code: null, writeHead(c) { o.code = c; }, end() {}, destroy() {} }; return o; };
  const run = (url, res, e) => { const lines = []; dashRequestFailed((m) => lines.push(m), { method: 'GET', url }, res, e); return lines; };
  const MARK = 'kit1030marker';
  const quoting = Object.assign(new TypeError(`Received '${MARK}'`), { code: 'ERR_INVALID_ARG_VALUE' });
  assert.deepEqual(run('/api/file', stub(), quoting), ['request failed: GET /api/file: TypeError ERR_INVALID_ARG_VALUE'], 'R6 a message quoting the request: the line is the class and code, not the message');
  class Odd extends Error {}
  const odd = Object.assign(new Odd(MARK), { code: `${MARK} x` });
  assert.deepEqual(run('/x', stub(), odd), ['request failed: GET /x: Odd'], 'R6 a code that is no plain name is left out');
  const long = Object.assign(new Error(MARK), { code: `E${'X'.repeat(64)}` });
  assert.deepEqual(run('/x', stub(), long), ['request failed: GET /x: Error'], 'R6 a code over 64 characters is left out');
  assert.deepEqual(run('/x', stub(), `thrown ${MARK}`), ['request failed: GET /x: string'], 'R6 a thrown string: its type, never its text');
  assert.deepEqual(run('/x', stub(), null), ['request failed: GET /x: null'], 'R6 a thrown null: null');
  assert.deepEqual(run('/x', stub(), Object.create(null)), ['request failed: GET /x: object'], 'R6 a thrown object with no class: its type');
  const trap = new Proxy({}, { get() { throw new Error(MARK); }, getPrototypeOf() { throw new Error(MARK); } });
  const tr = stub();
  let threw = null;
  let tl = null;
  try { tl = run('/x', tr, trap); } catch (e) { threw = e; }
  assert.equal(threw, null, 'R6 a thrown object whose reads throw: no throw out of the catch');
  assert.deepEqual(tl, ['request failed: GET /x: object'], 'R6 a thrown object whose reads throw: its type');
  assert.equal(tr.code, 500, 'R6 a thrown object whose reads throw: still the 500');
});
