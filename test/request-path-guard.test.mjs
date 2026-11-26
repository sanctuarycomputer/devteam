// kit-1027: a request the dashboard can't take apart is answered, and the dashboard serves on.
// R1 a request target that is no URL against the dashboard's base is a 400, on every method, and the
// next ordinary request answers as before. R2 a review helper missing from the kit's dashboard folder
// is a 500 from servePageAsset, the dashboard and its hub serve on; the hub and the browser view
// never read it. R3 every place the dashboard's handler and routes build a URL from req.url sits
// inside a try (the one parse at the top answers 400).
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

// One request written byte for byte (no client tidies the target): its status line's code and body,
// or status null when the connection closed with no answer.
function raw(port, target, method = 'GET') {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    const chunks = [];
    const done = () => {
      const text = Buffer.concat(chunks).toString('latin1');
      const m = /^HTTP\/1\.1 (\d{3})/.exec(text);
      resolve({ status: m ? Number(m[1]) : null, body: text.split('\r\n\r\n').slice(1).join('\r\n\r\n') });
    };
    s.on('data', (c) => { chunks.push(c); if (/\r\n\r\n/.test(Buffer.concat(chunks).toString('latin1'))) setTimeout(() => s.destroy(), 200); });
    s.on('close', done);
    s.on('error', () => {});
    s.setTimeout(30000, () => s.destroy());
    s.write(`${method} ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n${method === 'POST' ? 'Content-Length: 0\r\n' : ''}\r\n`);
  });
}
const alive = async (port, what) => {
  const r = await raw(port, '/api/hello');
  assert.equal(r.status, 200, `${what}: the next GET /api/hello answers 200`);
};

async function dashboard(t, { drop = [] } = {}) {
  const base = scratch('dash');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = bareProject(base, 'guard');
  for (const f of drop) fs.rmSync(path.join(root, 'docs', 'devteam', 'dashboard', f));
  const env = { ...process.env, HOME: scratch('home'), DEVTEAM_HUB_PORT: String(HUB), DEVTEAM_DATA_WAIT_MS: '0' };
  for (const k of Object.keys(env)) if (k.startsWith('DEVTEAM_') && !['DEVTEAM_HUB_PORT', 'DEVTEAM_DATA_WAIT_MS', 'DEVTEAM_PORT_BASE', 'DEVTEAM_TEST_SHARED_TMP'].includes(k)) delete env[k];
  const { dash, port } = await dashboardOnFreePort(root, env);
  t.after(() => dash.stop());
  return { dash, port, root };
}
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
    const res = () => { const o = { code: null, body: null, writeHead(c) { o.code = c; }, end(b) { o.body = b; } }; return o; };
    for (const f of ['devteam-ui.js', 'devteam-ui.css']) {
      const r = res();
      let threw = null;
      try { servePageAsset({ method: 'GET', url: `/review/preview/${f}` }, r, 'dashboard'); } catch (e) { threw = e; }
      assert.equal(threw, null, `R2 servePageAsset dashboard ${f} gone: no throw (${threw?.code ?? ''})`);
      assert.equal(r.code, 500, `R2 servePageAsset dashboard ${f} gone: a 500`);
      for (const server of ['hub', 'browser']) {
        const h = res();
        assert.equal(servePageAsset({ method: 'GET', url: `/review/preview/${f}` }, h, server), NEXT, `R2 servePageAsset ${server} ${f}: not its (DASH_NEXT)`);
        assert.equal(h.code, null, `R2 servePageAsset ${server} ${f}: writes nothing`);
      }
    }
  } finally { fs.rmSync(K, { recursive: true, force: true }); }
});
