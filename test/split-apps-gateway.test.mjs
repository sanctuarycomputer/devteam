// The overlay's apps-gateway area (kit-1021, apps@1 Serving in the gateway, page-seam@1): in a tree
// generated at this checkout's HEAD, the gateway's hub route serves the built hub app's index.html
// under hubCsp with script-src 'self' and the / route's hashes, and the asset hook serves the rest of
// the export by the gateway's copy of the static rules (alphaServe) at the root; with no build, the
// notice. The tree is split once with the areas gateway (its modules), tests (the rewrite the test
// patches sit on), pages-docs (hub.html gone), apps-gateway and apps-tests, and
// test/fixtures/alpha-build/hub/out is copied in as the tree's docs/devteam/apps/hub/. The source's
// gateway (given a fixture hub.html) and the tree's run side by side in this process; the source's
// answers are the expected values for every route this ticket keeps.
// Skips, each naming its cause, never fail a regular PR: manifest drift that stops HEAD's split, and
// an apps-gateway override or a gateway-area item that went stale because its original changed on
// main (the parity run reports it, and the next apps ticket re-pins it). Another ticket's stale
// apps-tests item is printed, not failed. Anything else stale of this area or this ticket's patches,
// any conflict, or a crash fails.
// A scratch HOME and DEVTEAM_GATEWAY_DIR, ports away from 4320/4321, every other DEVTEAM_* unset.
// Ports: +2 the stand-in hub, +50 the stand-in project dashboard (its scan block +50..+74); each
// gateway listens on a port freePort finds.
// Run: node --test test/split-apps-gateway.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PORTS, freePort } from './lib/kit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const splitSrc = path.join(root, 'test', 'split');
const tool = path.join(splitSrc, 'split.mjs');
const AREAS = ['gateway', 'tests', 'pages-docs', 'apps-gateway', 'apps-tests'];
const OVERRIDES = ['gatewayHubPage', 'serveGatewayAsset', 'serveGatewayHub'];
// this ticket's fourteen test patches in apps-tests (the others there are kit-984's and kit-1013's)
const PATCHES = ['canvas-gateway', 'presence-gateway', 'org-access.admins', 'org-access.admins.chrome', 'org-access.invites', 'org-access.methods', 'org-access.people-page', 'org-access.people-state', 'org-access.view', 'hub-tab-bar', 'hub-permalinks', 'hub-project-hosts', 'pull-refresh', 'gateway'].map((f) => `${f}.test.mjs.patch`);
const HUB = PORTS + 2;
const BASE_PORT = PORTS + 50;
const FIXTURE = path.join(root, 'test', 'fixtures', 'alpha-build', 'hub', 'out');
const TABLE = JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures', 'alpha-serving.json'), 'utf8'));
const H_ROOT = 'sha256-POcc20wgMPi2QrFCxB4F258AeTGTqxx20tII9Qv4K9k=';
const H_THREAD = 'sha256-AoeTQUzYkpdy48r+RVwOu8h8iPO3VcAAw53A39rjPfI=';
// apps@1's notice (kit-984's bytes)
const NOTICE = Buffer.from('<!doctype html><meta charset="utf-8"><title>devteam</title><p>This kit\'s pages aren\'t installed. They return at its next sync.</p>');
const UNREADABLE = Buffer.from('this page could not be read\n');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'split-apps-gateway-'));
const servers = [];
after(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => { s.closeAllConnections?.(); s.close(() => r()); })));
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
// lib/kit.mjs has dropped every DEVTEAM_* of the shell; this file sets only the hub's port, the
// instance block and the gateways' state folder, before either gateway is imported.
process.env.HOME = path.join(scratch, 'home');
fs.mkdirSync(process.env.HOME);
process.env.DEVTEAM_HUB_PORT = String(HUB);
process.env.DEVTEAM_PORT_BASE = String(BASE_PORT);
process.env.DEVTEAM_GATEWAY_DIR = path.join(scratch, 'gateway');
for (const k of ['DEVTEAM_HUB_PAGE', 'DEVTEAM_HUB_APP', 'DEVTEAM_ALPHA', 'DEVTEAM_ALPHA_DIR', 'DEVTEAM_KIT_RELEASE', 'DEVTEAM_BOX_TOOLS', 'DEVTEAM_PUBLIC_URL']) delete process.env[k];
// PATH and a scratch HOME only: no GIT_*, DEVTEAM_*, TMUX* or real HOME reaches git or the split
const clean = { PATH: process.env.PATH, HOME: process.env.HOME };
const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', env: clean, maxBuffer: 1 << 28, timeout: 240000, ...o });

// ---- the split dir: the manifests, the split's lib and tool, and the areas under test ----
const splitDir = path.join(scratch, 'split');
fs.cpSync(splitSrc, splitDir, { recursive: true });
for (const a of fs.readdirSync(path.join(splitDir, 'overlay'))) if (!AREAS.includes(a)) fs.rmSync(path.join(splitDir, 'overlay', a), { recursive: true, force: true });

// ---- the tree at HEAD, with the fixture hub build as its docs/devteam/apps/hub/ ----
const sha = run('git', ['-C', root, 'rev-parse', 'HEAD']).stdout.trim();
const TREE = path.join(scratch, 'tree');
const splitRun = run(process.execPath, [path.join(splitDir, 'split.mjs'), '--repo', root, '--split-dir', splitDir, '--at', sha, '--out', TREE, '--json'], { cwd: scratch });
let report = {};
try { report = JSON.parse(splitRun.stdout); } catch { /* A1 names it */ }
const treeMade = splitRun.status === 0 && fs.existsSync(path.join(TREE, 'cloud', 'gateway.mjs'));
const TREE_HUB = path.join(TREE, 'docs', 'devteam', 'apps', 'hub');
if (treeMade) fs.cpSync(FIXTURE, TREE_HUB, { recursive: true });
const tree = { dir: TREE, made: treeMade, hub: TREE_HUB };
const itemsOf = (a) => (report.overlay?.applied ?? []).filter((x) => x.area === a).map((x) => `${x.kind} ${x.name}`).sort();
const STALE = report.overlay?.stale ?? report.stale ?? [];
const CONFLICTS = report.overlay?.conflicts ?? report.conflicts ?? [];

// ---- skips ----
// HEAD drifted from a manifest, as split-tool's H tests judge it: the split writes nothing
const DRIFT = [/^split: manifest[\w-]*\.json: manifest: module .+ (?:is not in the source|starts at line \d+, not after .+|must start at line 1)$/,
  /^split: manifest[\w-]*\.json: module .+ is \d+ lines, over the cap of \d+$/, /^split: manifest[\w-]*\.json: the declaration at line \d+ .* binds names the split can't read whole/,
  /^split: nothing written$/];
const splitLines = splitRun.stderr.trim().split('\n').filter(Boolean);
const MANIFEST_SKIP = splitRun.status === 1 && splitLines.length > 0 && splitLines.every((l) => DRIFT.some((re) => re.test(l))) ? `HEAD's split stopped on manifest drift: ${splitLines.slice(0, 3).join('; ')}` : false;
// A stale item is drift when its original moved on main since the item was written: an apps-gateway
// override whose why is "the original changed" and cloud/gateway.mjs changed since the override's last
// commit; a gateway-area item whose source (cloud/gateway.mjs, or the file its patch names) changed
// since the area's last commit. Anything else stale of either area is a failure (a wrong pin, a broken
// rule), never a skip.
const lastCommitOf = (rel) => run('git', ['-C', root, 'log', '-1', '--format=%H', '--', rel]).stdout.trim();
const changedSince = (at, rel) => Boolean(at) && run('git', ['-C', root, 'diff', '--quiet', at, sha, '--', rel]).status === 1;
const SHALLOW = run('git', ['-C', root, 'rev-parse', '--is-shallow-repository']).stdout.trim() === 'true';
function driftOf(s) {
  if (s.area === 'apps-gateway' && s.kind === 'override' && /^the original changed/.test(s.why)) {
    // no history to read (test.yml checks out at depth 1): skip, naming it; a run with history (the
    // box, the parity run) judges a wrong pin
    if (SHALLOW) return `apps-gateway's override ${s.name} is stale and this checkout is shallow, so drift on main can't be told from a wrong pin (${s.why.slice(0, 160)})`;
    return changedSince(lastCommitOf(`test/split/overlay/apps-gateway/overrides/${s.name}.mjs`), 'cloud/gateway.mjs') ? `apps-gateway's override ${s.name} is stale: its original changed on main since it was pinned (${s.why.slice(0, 160)})` : false;
  }
  if (s.area === 'gateway') {
    if (SHALLOW) return `the gateway area's ${s.kind} ${s.name} is stale and this checkout is shallow, so drift on main can't be told from a broken item (${s.why.slice(0, 160)})`;
    const p = s.kind === 'patch' ? path.join(splitSrc, 'overlay', 'gateway', 'patches', s.name) : null;
    const file = (p && fs.existsSync(p) ? fs.readFileSync(p, 'utf8').match(/^diff --git a\/(\S+) /m)?.[1] : null) ?? 'cloud/gateway.mjs';
    return changedSince(lastCommitOf('test/split/overlay/gateway'), file) ? `the gateway area's ${s.kind} ${s.name} is stale: ${file} changed on main since the area was written (${s.why.slice(0, 160)})` : false;
  }
  return false;
}
const DRIFT_SKIP = STALE.map(driftOf).find(Boolean) ?? false;
const skip = () => MANIFEST_SKIP || DRIFT_SKIP;

// ---- the gateways ----
const G = { source: await import('../cloud/gateway.mjs'), tree: null };
let treeImport = null;
if (treeMade) try { G.tree = await import(pathToFileURL(path.join(TREE, 'cloud', 'gateway.mjs')).href); } catch (e) { treeImport = e; }
// the source's hub page: bytes no other file has
const HUB_HTML = path.join(scratch, 'hub.html');
fs.writeFileSync(HUB_HTML, '<!doctype html><title>the source\'s hub fixture</title><p>café ✓</p>\r\n<script>/* hub */</script>');

// --- a software authenticator (as test/gateway-page-seam.test.mjs has it: a claim needs one) ----
function cbor(v) {
  const head = (mt, n) => (n < 24 ? Buffer.from([(mt << 5) | n]) : n < 256 ? Buffer.from([(mt << 5) | 24, n]) : n < 65536 ? Buffer.from([(mt << 5) | 25, n >> 8, n & 255]) : (() => { const b = Buffer.alloc(5); b[0] = (mt << 5) | 26; b.writeUInt32BE(n, 1); return b; })());
  if (v === false || v === true || v === null) return Buffer.from([v === false ? 0xf4 : v === true ? 0xf5 : 0xf6]);
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error(`cbor: ${typeof v}`);
}
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
const u = (b) => Buffer.from(b).toString('base64url');
function authenticator() {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
  const id = crypto.randomBytes(16);
  return {
    create(opts, origin) {
      const cd = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: opts.challenge, origin }));
      const len = Buffer.alloc(2); len.writeUInt16BE(id.length);
      const ad = Buffer.concat([sha256(opts.rp.id), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, id, cbor(cose)]);
      return { rawId: u(id), clientDataJSON: u(cd), attestationObject: u(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]]))) };
    },
  };
}

// --- the stand-in hub (one listed project, proj, on BASE_PORT) and that project's dashboard ---------
const hubServer = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ hub: 1, instances: [{ devteam: 1, root: '/srv/proj', port: BASE_PORT, name: 'proj' }] })); });
await new Promise((r) => hubServer.listen(HUB, '127.0.0.1', r));
const dashServer = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`the project's dashboard: ${req.url}`); });
await new Promise((r) => dashServer.listen(BASE_PORT, '127.0.0.1', r));
servers.push(hubServer, dashServer);

// --- a claimed gateway, the source's or the tree's, on http (or https, as the box's name is) -------
// opts: side 'tree' | 'source'; scheme; hubApp, hubPage (passed to createGateway as given); envHubApp,
// envHubPage (DEVTEAM_HUB_APP / DEVTEAM_HUB_PAGE while createGateway runs). The source is given
// hubPage: the fixture hub.html unless the caller names one.
const VAPID = (() => {
  const jwk = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
  return { jwk, publicKey: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url') };
})();
let n = 0;
async function gw({ side = 'tree', scheme = 'http', hubApp, hubPage, envHubApp, envHubPage } = {}) {
  const M = G[side];
  if (!M) throw new Error(side === 'tree' ? `the tree's gateway can't be imported: ${treeImport?.message ?? `no tree (split ${splitRun.status}: ${splitRun.stderr.slice(0, 400)})`}` : 'no source gateway');
  const port = await freePort();
  const publicUrl = `${scheme}://box.localhost:${port}`;
  const name = `gw-${++n}`;
  const ttydPage = path.join(scratch, `${name}-ttyd.html`);
  fs.writeFileSync(ttydPage, 'the gateway\'s copy of ttyd');
  const uploadsDir = path.join(scratch, `${name}-uploads`);
  fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o750 });
  const logs = [];
  // every gateway's state starts with one push key, the box's own, so /box.json reads the same
  fs.mkdirSync(path.join(process.env.DEVTEAM_GATEWAY_DIR, name), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(process.env.DEVTEAM_GATEWAY_DIR, name, 'state.json'), JSON.stringify({ passkeys: [], sessions: [], claimHash: null, vapid: VAPID }), { mode: 0o600 });
  const opts = { publicUrl, dir: path.join(process.env.DEVTEAM_GATEWAY_DIR, name), ttydPort: await freePort(), ttydPage, uploadsDir, log: (m) => logs.push(m) };
  if (hubApp !== undefined) opts.hubApp = hubApp;
  if (hubPage !== undefined) opts.hubPage = hubPage;
  else if (side === 'source') opts.hubPage = HUB_HTML;
  const set = { DEVTEAM_HUB_APP: envHubApp, DEVTEAM_HUB_PAGE: envHubPage };
  let g;
  try {
    for (const [k, v] of Object.entries(set)) if (v !== undefined) process.env[k] = v;
    g = M.createGateway(opts);
  } catch (e) {
    throw new Error(`${side}'s createGateway threw: ${e.message}`);
  } finally {
    for (const k of Object.keys(set)) delete process.env[k];
  }
  await new Promise((r) => g.server.listen(port, '127.0.0.1', r));
  servers.push(g.server);
  const token = /claim#([A-Za-z0-9_-]+)/.exec(logs.join('\n'))?.[1];
  const box = new URL(publicUrl).host;
  let jar = '';
  let flowJar = '';
  // The request line exactly as given: http.request sends the path unparsed.
  const req = (method, route, { body, headers = {}, signedIn = true } = {}) => new Promise((resolve, reject) => {
    const h = { host: box, ...(method !== 'GET' && method !== 'HEAD' ? { origin: publicUrl, 'content-type': 'application/json' } : {}), ...headers };
    const sent = [signedIn ? jar : '', route.startsWith('/auth/') ? flowJar : ''].filter(Boolean).join('; ');
    if (sent) h.cookie = sent;
    const r = http.request({ host: '127.0.0.1', port, method, path: route, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const sc = res.headers['set-cookie']?.find((c) => /^(?:__Host-)?devteam_session=/.test(c));
        if (sc) jar = sc.split(';')[0];
        for (const c of res.headers['set-cookie'] ?? []) { const m = /^(?:__Host-)?devteam_flow=([^;]*)/.exec(c); if (m) flowJar = /;\s*Max-Age=0\b/i.test(c) ? '' : c.split(';')[0]; }
        let json = null;
        try { json = JSON.parse(raw.toString('utf8')); } catch {}
        resolve({ status: res.statusCode, rawHeaders: res.rawHeaders, headers: res.headers, raw, body: raw.toString('utf8'), json });
      });
    });
    r.on('error', reject);
    r.setTimeout(10000, () => r.destroy(new Error(`${method} ${route.slice(0, 60)}: no answer in 10 s`)));
    r.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const o = await req('POST', '/auth/claim/options', { body: { token } });
  assert.equal(o.status, 200, `${side}'s claim options: ${o.body}`);
  const v = await req('POST', '/auth/claim/verify', { body: { token, ...authenticator().create(o.json, publicUrl) } });
  assert.equal(v.status, 200, `${side}'s claim: ${v.body}`);
  assert.ok(jar, `${side}: a session cookie`);
  const close = () => new Promise((r) => { g.server.closeAllConnections?.(); g.server.close(() => r()); });
  return { side, port, publicUrl, box, req, close };
}
// The shared pairs, made once on first use: a throw is each check's failure, never the file's.
const once = (f) => { let p = null; return () => (p ??= f()); };
const pair = {
  http: once(async () => ({ tree: await gw({ side: 'tree' }), source: await gw({ side: 'source' }) })),
  https: once(async () => ({ tree: await gw({ side: 'tree', scheme: 'https' }), source: await gw({ side: 'source', scheme: 'https' }) })),
};

// ---- comparing answers ----
// An answer as the wire carried it, the gateway's own origin made <origin> (and its port in a host
// under the box's name, term.box.localhost:<port> in frame-src or /box.json, made <port>), each
// set-cookie value its name and attributes, Date dropped: status, the raw headers in order, the
// body's bytes (as latin1, one char per byte).
function norm(r, g) {
  const o = (s) => s.split(g.publicUrl).join('<origin>').split(`.${g.box}`).join('.box.localhost:<port>');
  const headers = [];
  for (let i = 0; i < r.rawHeaders.length; i += 2) {
    const k = r.rawHeaders[i];
    let v = r.rawHeaders[i + 1];
    const lk = k.toLowerCase();
    if (lk === 'date') continue;
    if (lk === 'set-cookie') v = v.split(';').map((x, j) => (j === 0 ? x.split('=')[0] : x)).join(';');
    else v = o(v);
    headers.push([k, v]);
  }
  return { status: r.status, headers, body: o(r.raw.toString('latin1')) };
}
// The tree's answer is the source's: status, every header but Date, the body.
function same(a, b, label) {
  assert.deepEqual(norm(a.r, a.g), norm(b.r, b.g), `${label}: the tree answers as the source does`);
}
// The policy the area sends, from the source's hub CSP, in the spec's words: script-src 'self' and
// the hashes, 'self' first in style-src, font-src 'self' after img-src; every other directive kept.
function want(sourceCsp, hashes) {
  const out = [];
  for (const d of sourceCsp.split('; ')) {
    if (d.startsWith('script-src ')) out.push(["script-src 'self'", ...hashes.map((h) => `'${h}'`)].join(' '));
    else if (d.startsWith('style-src ')) out.push(`style-src 'self' ${d.slice('style-src '.length)}`);
    else if (d.startsWith('img-src ')) out.push(d, "font-src 'self'");
    else out.push(d);
  }
  return out.join('; ');
}
const NODE_OWN = /^(?:Connection|Keep-Alive)$/; // what Node adds after a handler's headers (Date dropped)
// A hub-route (or notice) answer of the tree against the source's for the same request: the tree's
// header names are the source's (its transfer-encoding: chunked dropped) in order with content-length
// added after the gateway's own, whose value is the body's length; every value but the CSP is the
// source's; the CSP is want(<source's>, hashes); the body is the given bytes.
function hubAnswer(a, b, { status = 200, type = 'text/html; charset=utf-8', body, hashes, label }) {
  const t = norm(a.r, a.g);
  const s = norm(b.r, b.g);
  s.headers = s.headers.filter(([k, v]) => !(k.toLowerCase() === 'transfer-encoding' && v === 'chunked'));
  assert.equal(b.r.status, 200, `${label}: the source's hub route answers 200`);
  assert.equal(a.r.status, status, `${label}: status`);
  assert.equal(a.r.headers['content-type'], type, `${label}: content-type`);
  const csp = a.r.headers['content-security-policy'] ?? '';
  const scripts = csp.split('; ').filter((d) => /^script-src\b/.test(d));
  assert.equal(scripts.length, 1, `${label}: one script-src (${csp})`);
  assert.doesNotMatch(scripts[0], /'unsafe-inline'/, `${label}: script-src 'unsafe-inline' is never sent`);
  assert.ok(csp.split('; ').includes("default-src 'none'"), `${label}: default-src 'none' is kept`);
  assert.ok(csp.split('; ').includes("img-src 'self'"), `${label}: img-src 'self' (${csp})`);
  assert.doesNotMatch(csp, /data:/, `${label}: img-src has no data:`);
  assert.ok(csp.split('; ').includes("font-src 'self'"), `${label}: font-src 'self' (${csp})`);
  assert.equal(a.r.headers['strict-transport-security'], b.r.headers['strict-transport-security'], `${label}: HSTS as the source's`);
  const names = s.headers.map(([k]) => k);
  const at = names.findIndex((k) => NODE_OWN.test(k));
  const wantNames = [...names];
  wantNames.splice(at < 0 ? names.length : at, 0, 'content-length');
  assert.deepEqual(t.headers.map(([k]) => k), wantNames, `${label}: the header order is the source's with content-length after the gateway's own`);
  for (const [k, v] of t.headers) {
    const lk = k.toLowerCase();
    if (lk === 'content-length') assert.equal(v, String(a.r.raw.length), `${label}: content-length is the body's`);
    else if (lk === 'content-security-policy') assert.equal(v, norm({ ...b.r, rawHeaders: ['content-security-policy', want(b.r.headers['content-security-policy'], hashes)] }, b.g).headers[0][1], `${label}: the policy is the source's hub policy with the area's changes`);
    else assert.equal(v, s.headers.find(([x]) => x === k)?.[1], `${label}: ${k} is the source's`);
  }
  assert.ok(a.r.raw.equals(body), `${label}: the body is the build's (${a.r.raw.length} bytes: ${a.r.raw.toString('utf8').slice(0, 120)})`);
}

// ---- builds made from the fixture, in the scratch folder ----
let b = 0;
function build(edit = () => {}) {
  const d = path.join(scratch, 'builds', `b${++b}`, 'hub');
  fs.cpSync(FIXTURE, d, { recursive: true });
  edit(d);
  return d;
}
const fixtureFile = (f) => fs.readFileSync(path.join(FIXTURE, f));
const NAV = { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none', accept: 'text/html' };
const FETCH = { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', 'sec-fetch-site': 'same-origin', accept: '*/*' };
const HUB_PATHS = ['/', '/index.html', '/?x=1', '/index.html?x=1', '/./index.html'];
// one request to both gateways of a pair: { tree: { r, g }, source: { r, g } }
async function both(p, method, route, o = {}) {
  return { tree: { r: await p.tree.req(method, route, o), g: p.tree }, source: { r: await p.source.req(method, route, o), g: p.source } };
}
const sourceCsp = async (p) => (await p.source.req('GET', '/', { headers: NAV })).headers['content-security-policy'];

test("A1: HEAD's split applies exactly apps-gateway's three overrides; nothing of apps-gateway or this ticket's patches is stale, and no conflict", { skip: skip() }, (t) => {
  assert.equal(splitRun.status, 0, `split: ${splitRun.stderr.slice(0, 1200)}`);
  assert.ok(treeMade, 'the tree is written');
  assert.deepEqual(itemsOf('apps-gateway'), OVERRIDES.map((o) => `override ${o}`), 'applied apps-gateway');
  const mine = STALE.filter((s) => s.area === 'apps-gateway' || s.area === 'gateway' || (s.area === 'apps-tests' && PATCHES.includes(s.name)));
  assert.deepEqual(mine, [], "nothing of apps-gateway, the gateway area or this ticket's patches is stale");
  for (const s of STALE.filter((x) => !mine.includes(x))) t.diagnostic(`stale, another area's or ticket's (its own test judges it): ${s.area} ${s.kind} ${s.name}: ${String(s.why).slice(0, 200)}`);
  assert.deepEqual(CONFLICTS, [], 'no conflict');
});

test("H1: the hub route serves the build's index.html under hubCsp with script-src 'self' and the / hashes, style-src 'self', font-src 'self'; headers the source's with content-length", { skip: skip() }, async () => {
  const index = fs.readFileSync(path.join(TREE_HUB, 'index.html'));
  for (const scheme of ['http', 'https']) {
    const p = await pair[scheme]();
    for (const route of HUB_PATHS) for (const [hn, headers] of [['page', NAV], ['fetch', FETCH]]) {
      const x = await both(p, 'GET', route, { headers });
      hubAnswer(x.tree, x.source, { body: index, hashes: [H_ROOT], label: `${scheme} GET ${route} (${hn})` });
      assert.match(x.tree.r.headers['content-security-policy'], new RegExp(`script-src 'self' '${H_ROOT.replace(/[+/]/g, '\\$&')}';`), `${scheme} GET ${route}: the / hash`);
      if (scheme === 'https') assert.ok(x.tree.r.headers['strict-transport-security'], `${scheme} GET ${route}: HSTS is sent`);
    }
  }
});

test('H2: the hub folder is DEVTEAM_HUB_APP, else opts.hubApp, else the tree\'s docs/devteam/apps/hub/; an empty DEVTEAM_HUB_APP falls through; hubPage is not read', { skip: skip() }, async () => {
  const marked = (m) => build((d) => fs.appendFileSync(path.join(d, 'index.html'), `<!-- build ${m} -->`));
  const X = marked('X');
  const Y = marked('Y');
  const bodyOf = (d) => fs.readFileSync(path.join(d, 'index.html'));
  const cases = [
    ['DEVTEAM_HUB_APP X and opts.hubApp Y', { envHubApp: X, hubApp: Y }, X],
    ['opts.hubApp Y only', { hubApp: Y }, Y],
    ['neither', {}, TREE_HUB],
    ["DEVTEAM_HUB_APP '' and opts.hubApp Y", { envHubApp: '', hubApp: Y }, Y],
    ['opts.hubPage only', { hubPage: HUB_HTML }, TREE_HUB],
    ['opts.hubPage and DEVTEAM_HUB_PAGE', { hubPage: HUB_HTML, envHubPage: HUB_HTML }, TREE_HUB],
  ];
  for (const [what, o, dir] of cases) {
    const g = await gw({ side: 'tree', ...o });
    const r = await g.req('GET', '/', { headers: NAV });
    await g.close();
    assert.equal(r.status, 200, `${what}: 200`);
    assert.ok(r.raw.equals(bodyOf(dir)), `${what}: / is ${dir === X ? 'X' : dir === Y ? 'Y' : 'the tree\'s build'} (got ${r.body.slice(-40)})`);
  }
});

test('H3: with no build the hub route is the notice (503) under the policy with no hashes, a build placed later is served at once, and a DEVTEAM_HUB_APP naming a file is a 500', { skip: skip() }, async () => {
  const p = await pair.http();
  const src = await p.source.req('GET', '/', { headers: NAV });
  const empty = path.join(scratch, 'builds', 'empty', 'hub');
  fs.mkdirSync(empty, { recursive: true });
  const g = await gw({ side: 'tree', hubApp: empty });
  hubAnswer({ r: await g.req('GET', '/', { headers: NAV }), g }, { r: src, g: p.source }, { status: 503, body: NOTICE, hashes: [], label: 'GET / with an empty folder' });
  for (const f of ['index.html', 'csp-hashes.json']) fs.copyFileSync(path.join(FIXTURE, f), path.join(empty, f));
  hubAnswer({ r: await g.req('GET', '/', { headers: NAV }), g }, { r: await p.source.req('GET', '/', { headers: NAV }), g: p.source }, { body: fixtureFile('index.html'), hashes: [H_ROOT], label: 'GET / after the build is copied in' });
  await g.close();
  const gone = await gw({ side: 'tree', hubApp: path.join(scratch, 'builds', 'no-such-folder') });
  hubAnswer({ r: await gone.req('GET', '/', { headers: NAV }), g: gone }, { r: src, g: p.source }, { status: 503, body: NOTICE, hashes: [], label: 'GET / with no folder' });
  await gone.close();
  const file = path.join(scratch, 'builds', 'a-file');
  fs.writeFileSync(file, 'not a folder');
  const f = await gw({ side: 'tree', envHubApp: file });
  const r = await f.req('GET', '/', { headers: NAV });
  await f.close();
  assert.equal(r.status, 500, 'a DEVTEAM_HUB_APP naming a file: 500');
  assert.ok(r.raw.equals(UNREADABLE), `a file: ${r.body}`);
  assert.equal(r.headers['content-security-policy'], undefined, 'a file: no CSP');
});

test('H4: a csp-hashes.json that is not v 1, holds a source that is no sha256 hash, or is missing: / and /threads/one/ are 500, / with no CSP', { skip: skip() }, async () => {
  const bads = [
    ['not v 1', (d) => fs.writeFileSync(path.join(d, 'csp-hashes.json'), JSON.stringify({ v: 2, pages: { '/': [H_ROOT], '/threads/one/': [H_THREAD] } }))],
    ['a written-in policy', (d) => fs.writeFileSync(path.join(d, 'csp-hashes.json'), JSON.stringify({ v: 1, pages: { '/': ["sha256-x'; script-src *"], '/threads/one/': [H_THREAD] } }))],
    ['missing', (d) => fs.rmSync(path.join(d, 'csp-hashes.json'))],
  ];
  for (const [what, edit] of bads) {
    const g = await gw({ side: 'tree', hubApp: build(edit) });
    const r = await g.req('GET', '/', { headers: NAV });
    const th = await g.req('GET', '/threads/one/', { headers: NAV });
    await g.close();
    assert.equal(r.status, 500, `${what}: GET / is 500`);
    assert.ok(r.raw.equals(UNREADABLE), `${what}: GET / says ${r.body}`);
    assert.equal(r.headers['content-security-policy'], undefined, `${what}: GET / has no CSP`);
    assert.doesNotMatch(r.body, /script-src/, `${what}: nothing of the manifest`);
    assert.equal(th.status, 500, `${what}: GET /threads/one/ is 500`);
    assert.equal(th.headers['content-security-policy'], undefined, `${what}: GET /threads/one/ has no CSP`);
  }
});

test("H5: an index.html linked out of the folder is a 500 at / and the gateway's 404 through the hook; one linked inside is served; a dangling one is the notice", { skip: skip() }, async () => {
  const p = await pair.http();
  const outside = path.join(scratch, 'builds', 'outside-index.html');
  fs.writeFileSync(outside, '<!doctype html><title>outside the folder</title>');
  const out = await gw({ side: 'tree', hubApp: build((d) => { fs.rmSync(path.join(d, 'index.html')); fs.symlinkSync(outside, path.join(d, 'index.html')); }) });
  const r = await out.req('GET', '/', { headers: NAV });
  assert.equal(r.status, 500, 'outside: GET / is 500');
  assert.ok(r.raw.equals(UNREADABLE), `outside: GET / says ${r.body}`);
  assert.equal(r.headers['content-security-policy'], undefined, 'outside: no CSP');
  same({ r: await out.req('GET', '/%69ndex.html', { headers: FETCH }), g: out }, { r: await p.source.req('GET', '/%69ndex.html', { headers: FETCH }), g: p.source }, 'outside: GET /%69ndex.html');
  await out.close();
  const inside = await gw({ side: 'tree', hubApp: build((d) => { fs.renameSync(path.join(d, 'index.html'), path.join(d, 'home.html')); fs.symlinkSync('home.html', path.join(d, 'index.html')); }) });
  hubAnswer({ r: await inside.req('GET', '/', { headers: NAV }), g: inside }, { r: await p.source.req('GET', '/', { headers: NAV }), g: p.source }, { body: fixtureFile('index.html'), hashes: [H_ROOT], label: 'inside: GET /' });
  await inside.close();
  const dangling = await gw({ side: 'tree', hubApp: build((d) => { fs.rmSync(path.join(d, 'index.html')); fs.symlinkSync(path.join(scratch, 'builds', 'no-such-file.html'), path.join(d, 'index.html')); }) });
  hubAnswer({ r: await dangling.req('GET', '/', { headers: NAV }), g: dangling }, { r: await p.source.req('GET', '/', { headers: NAV }), g: p.source }, { status: 503, body: NOTICE, hashes: [], label: 'dangling: GET /' });
  await dangling.close();
});

test('S1: every alpha-serving.json case but "bare /next", at the root, against the tree\'s gateway', { skip: skip() }, async () => {
  const p = await pair.http();
  const dir = build((d) => {
    fs.writeFileSync(path.resolve(d, TABLE.outside.at), TABLE.outside.text);
    for (const c of TABLE.cases) if (c.symlink) fs.symlinkSync(c.symlink.to, path.join(d, c.symlink.at));
  });
  const g = await gw({ side: 'tree', hubApp: dir });
  const strip = (s) => s.replace(/^\/next(?=\/|$)/, '');
  try {
    for (const c of TABLE.cases.filter((x) => x.name !== 'bare /next')) {
      const route = strip(c.path);
      const what = `${c.name} (GET ${route.slice(0, 60)})`;
      const r = await g.req('GET', route, { headers: FETCH });
      const bare = route.split('?')[0];
      if (bare === '/' || bare === '/index.html') {
        hubAnswer({ r, g }, { r: await p.source.req('GET', route, { headers: FETCH }), g: p.source }, { body: fs.readFileSync(path.join(dir, 'index.html')), hashes: [H_ROOT], label: what });
        continue;
      }
      if (c.status === 404) {
        same({ r, g }, { r: await p.source.req('GET', route, { headers: FETCH }), g: p.source }, `${what}: the gateway's 404`);
        assert.doesNotMatch(r.body, new RegExp(TABLE.outside.text.trim()), `${what}: nothing of the outside file`);
        continue;
      }
      assert.equal(r.status, c.status, `${what}: status`);
      assert.equal(r.headers['content-type'], c.type ?? undefined, `${what}: type`);
      if (c.location) assert.equal(r.headers.location, strip(c.location), `${what}: location`);
      if (c.file) assert.ok(r.raw.equals(fs.readFileSync(path.join(dir, c.file))), `${what}: the file's bytes`);
    }
  } finally { await g.close(); }
});

test("S2: /threads/one/ through the hook is 200 under the hub's policy with /threads/one/'s hash", { skip: skip() }, async () => {
  for (const scheme of ['http', 'https']) {
    const p = await pair[scheme]();
    const r = await p.tree.req('GET', '/threads/one/', { headers: NAV });
    const src = await sourceCsp(p);
    assert.equal(r.status, 200, `${scheme}: 200`);
    assert.equal(r.headers['content-type'], 'text/html; charset=utf-8', `${scheme}: type`);
    assert.ok(r.raw.equals(fixtureFile('threads/one/index.html')), `${scheme}: the route's index.html`);
    assert.equal(norm(r, p.tree).headers.find(([k]) => k === 'content-security-policy')?.[1], norm({ rawHeaders: ['content-security-policy', want(src, [H_THREAD])], raw: Buffer.alloc(0) }, p.source).headers[0][1], `${scheme}: the hub policy with /threads/one/'s hash`);
    assert.equal(r.headers['x-frame-options'], 'DENY', `${scheme}: x-frame-options`);
    assert.equal(r.headers['referrer-policy'], 'no-referrer', `${scheme}: referrer-policy`);
    const hsts = (await p.source.req('GET', '/', { headers: NAV })).headers['strict-transport-security'];
    assert.equal(r.headers['strict-transport-security'], hsts, `${scheme}: HSTS as the hub route's`);
  }
});

test('S3: a path with no file, any method but GET, and anything signed out answer as the source does', { skip: skip() }, async () => {
  const p = await pair.http();
  const asks = [
    ...['/nope', '/hub.html', '/index.htm', '/index.html/', '/a/b/', '/threads/one/x', '/_next/', '/%2e%2e/x', '/%2fetc', '//'].map((r) => ['GET', r, true]),
    ...['HEAD', 'POST', 'PUT', 'DELETE'].flatMap((m) => ['/', '/logo.svg'].map((r) => [m, r, true])),
    ['GET', '/_next/static/chunks/app.js', false],
  ];
  for (const [method, route, signedIn] of asks) {
    const x = await both(p, method, route, { headers: FETCH, signedIn });
    same(x.tree, x.source, `${signedIn ? '' : 'signed out '}${method} ${route}`);
  }
});

// every reserved name and each family with a subpath, with files planted in the build
const PLANTED = ['box.json', 'instances.json', 'alpha.json', 'memory.json', 'manifest.webmanifest', 'sw.js', 'token', 'build', 'public/x.txt', 'public/index.html', 'Public/x.txt', 'PUBLIC/x.txt', 'operator/x.txt', 'push/x.txt', 'auth/x.txt', 'api/x', 'upload/x.txt', 'w/x.txt', 'dev/index.html', 'next/x.txt', 'next/index.html', 'c/x', '.devteam/lens'];
const shadowBuild = once(() => build((d) => {
  for (const f of PLANTED) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), `SHADOW ${f}\n`); }
}));
const shadowGw = once(() => gw({ side: 'tree', hubApp: shadowBuild() }));

test('S4: a file planted at a gateway route never answers for it, in any case or encoding', { skip: skip() }, async () => {
  const p = await pair.http();
  const g = await shadowGw();
  const routes = [...PLANTED.filter((f) => !f.endsWith('index.html')).map((f) => `/${f}`), '/dev/', '/next/', '/public/', '/%70ublic/x.txt', '/public%2fx.txt'];
  for (const route of routes) {
    const t = { r: await g.req('GET', route, { headers: FETCH }), g };
    same(t, { r: await p.source.req('GET', route, { headers: FETCH }), g: p.source }, `GET ${route}`);
    assert.ok(!(t.r.status === 200 && /SHADOW/.test(t.r.body)), `GET ${route}: the planted file is not served`);
  }
});

test("S5: the box's other pages, and the project's /sw.js, keep their policy and bytes", { skip: skip() }, async () => {
  const p = await pair.http();
  const g = await shadowGw();
  for (const route of ['/public', '/next/', '/box.json', '/instances.json', '/alpha.json', '/manifest.webmanifest', '/sw.js', '/dev/']) {
    same({ r: await g.req('GET', route, { headers: NAV }), g }, { r: await p.source.req('GET', route, { headers: NAV }), g: p.source }, `GET ${route}`);
  }
  for (const [what, extra] of [['', {}], [' (serviceworker)', { 'sec-fetch-dest': 'serviceworker' }]]) {
    const on = (x) => ({ ...FETCH, ...extra, host: `proj.${x.box}` });
    same({ r: await g.req('GET', '/sw.js', { headers: on(g) }), g }, { r: await p.source.req('GET', '/sw.js', { headers: on(p.source) }), g: p.source }, `the project's GET /sw.js${what}`);
  }
});
