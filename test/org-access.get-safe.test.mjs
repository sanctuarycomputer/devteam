// No GET of the dashboard or the hub changes anything (kit-251, org-access A13). The view rule
// (kit-250) lets every GET through for a view session, so no GET route of the kit may change durable
// state or start a command that writes. Every GET route is listed from devteam.mjs's own handlers
// (the dashboard's route groups, its server's and the hub's handler, the terminal's route table) and
// each is asked against a scratch instance with its timers stopped, on a laptop and as a box. Around
// each request the test compares the log, project/, the repo's refs and worktree list and the files
// under run/ (all but the caches named in RUN_SKIP), and it records every command any process of the
// instance starts (a preload in NODE_OPTIONS), failing on one off the read-only list.
// Run: node --test test/org-access.get-safe.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PORTS, fleetFixture, dashboardOnFreePort, until, write } from './lib/kit.mjs';

const KIT_SCRIPT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'docs', 'devteam', 'scripts', 'devteam.mjs');
const SRC = fs.readFileSync(KIT_SCRIPT, 'utf8');

// ----- the GET routes, from the code -----
// Between two lines of the source: the first that matches from, then the first after it that matches to.
const span = (from, to) => {
  const lines = SRC.split('\n');
  const a = lines.findIndex((l) => from.test(l));
  assert.ok(a >= 0, `devteam.mjs has a line matching ${from}`);
  const b = lines.findIndex((l, i) => i > a && to.test(l));
  assert.ok(b > a, `devteam.mjs has a line matching ${to} after ${from}`);
  return lines.slice(a, b + 1);
};
// The paths one line names: a literal compared or prefix-matched, or a regex it executes.
const pathsOf = (l) => [
  ...[...l.matchAll(/(?:pathname|req\.url|rawPath) === '([^']+)'/g)].map((m) => m[1]),
  ...[...l.matchAll(/(?:req\.url|rawPath)\.startsWith\('([^']+)'\)/g)].map((m) => `${m[1]}*`),
  ...[...l.matchAll(/\/(\^\\\/[^\s]*?\$)\/\.exec\(/g)].map((m) => `re:${m[1]}`),
];
function getRoutes() {
  const keys = new Set();
  // the dashboard's route groups: every line that asks for a GET
  for (const l of span(/^\/\* dashboardRoutes start \*\//, /^\/\* dashboardRoutes end \*\//)) if (/'GET'/.test(l)) for (const p of pathsOf(l)) keys.add(`dash ${p}`);
  // the dashboard's server, before its route groups: the presence socket's plain answer
  for (const l of span(/const server = http\.createServer\(async \(req, res\) => \{/, /for \(const route of DASHBOARD_ROUTES\)/)) if (/presence/.test(l)) for (const p of pathsOf(l)) keys.add(`dash ${p}`);
  // the terminal's routes: its table's GETs
  // (a line naming only POST is a POST's; the regex's line names no method, and its GETs are screen and history)
  for (const l of span(/^  function route\(pathname\) \{/, /^  \}/)) if (!/'POST'/.test(l) || /'GET'/.test(l)) for (const p of pathsOf(l)) keys.add(`term ${p}`);
  // the hub: everything after its "only GET" line, and the presence socket before it
  const hub = span(/const hub = trackRequests\(http\.createServer\(async \(req, res\) => \{/, /^    current = hub;/);
  const only = hub.findIndex((l) => /req\.method !== 'GET'/.test(l));
  assert.ok(only > 0, "the hub's handler has its only-GET line");
  for (const [i, l] of hub.entries()) if (i > only || /presence/.test(l)) for (const p of pathsOf(l)) keys.add(`hub ${p}`);
  return keys;
}

// ----- the requests: at least one per route, each meant to reach the route's own work -----
const SAME = { 'sec-fetch-site': 'same-origin' };
const FRAME = { 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'iframe' };
// what each route is asked (F: the fixture's names)
const REQUESTS = (F) => ({
  'dash /upload/*': [`/upload/${F.upload}`, `/upload/2020-01-01-${'0'.repeat(24)}/none.txt`],
  'dash /api/hello': ['/api/hello'],
  'dash /': ['/'],
  'dash /index.html': ['/index.html'],
  'dash /api/data*': ['/api/data'],
  'dash re:^\\/view\\/artifact\\/([^/]+)$': [`/view/artifact/${F.slug}`, `/view/artifact/${F.slug}?at=${F.wt}`],
  'dash re:^\\/view\\/preview\\/([^/]+)$': [`/view/preview/${F.preview}`],
  'dash /api/artifact-fp': [`/api/artifact-fp?slug=${F.slug}&at=${F.wt}`],
  'dash /api/view': [`/api/view?kind=artifact&slug=${F.slug}&at=main`, `/api/view?kind=artifact&slug=${F.slug}&at=${F.wt}`, `/api/view?kind=preview&name=${F.preview}`],
  'dash /api/artifact-versions': [`/api/artifact-versions?slug=${F.slug}`],
  'dash /api/threads': ['/api/threads'],
  'dash /api/fleet': ['/api/fleet', '/api/fleet?fetch=1'],
  'dash /api/record': [`/api/record?id=${F.ticket}`],
  'dash /api/peek': [`/api/peek?kind=ticket&id=${F.ticket}`, `/api/peek?kind=file&id=README.md`],
  'dash /api/sensor': ['/api/sensor?name=disk'],
  'dash /api/schema': ['/api/schema'],
  'dash /api/timeline': [`/api/timeline?id=${F.ticket}`],
  'dash /api/governance': ['/api/governance'],
  'dash /api/file': ['/api/file?path=README.md', `/api/file?path=docs/devteam/project/artifacts/${F.slug}/index.html`],
  'dash /api/review': ['/api/review?id=q-20990101-000000000-supervisor', '/api/review?id=q-20990101-000000000-supervisor&format=tsv'],
  'dash /public-manifest/*': [`/public-manifest/${F.slug}`],
  'dash /artifact/*': [`/artifact/main/${F.slug}`, `/artifact/main/${F.slug}/`, `/artifact/wt/${F.wt}/${F.slug}/`],
  'dash re:^\\/review\\/([^/]+)\\/([^/]*)$': [{ path: `/review/preview/?path=docs/devteam/project/artifacts/${F.slug}/index.html&ref=main`, headers: FRAME }, '/review/preview/devteam-ui.css', { path: '/review/q-20990101-000000000-supervisor/', headers: FRAME }],
  'dash /presence': ['/presence'],
  'dash /presence?*': ['/presence?x=1'],
  'term /api/term/token': ['/api/term/token'],
  'term re:^\\/api\\/term\\/(supervisor|shell)\\/(screen|history|keys)$': ['/api/term/supervisor/screen', '/api/term/shell/screen', '/api/term/supervisor/history?before=0&count=10', '/api/term/shell/history?before=0&count=10'],
  'hub /presence': ['/presence'],
  'hub /presence?*': ['/presence?x=1'],
  'hub /': ['/'],
  'hub /instances.json': ['/instances.json'],
  'hub /memory.json': ['/memory.json'],
  'hub /memory.json?*': ['/memory.json?since=8d', `/memory.json?after=${new Date(Date.now() - 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z')}`],
  'hub /operator/threads': ['/operator/threads'],
});

// ----- the commands a GET may start -----
// devteam.mjs's own subcommands that only read (fleet status only with --no-fetch: without it, it fetches)
const DEVTEAM_READS = [/^hello\b/, /^dashboard-data\b/, /^fleet status\b.*--no-fetch\b/, /^record\b/, /^peek\b/, /^sensor series\b/, /^timeline\b/, /^governance\b/, /^operator-thread status\b/, /^review (show|result)\b/, /^artifact (describe|versions|manifest)\b/];
const GIT_READS = new Set(['rev-parse', 'show', 'cat-file', 'ls-tree', 'log', 'for-each-ref', 'diff', 'merge-base', 'rev-list', 'ls-files', 'show-ref', 'name-rev', 'describe', 'grep', 'check-ignore', 'var', 'version', '--version', 'blame', 'count-objects', 'diff-tree', 'diff-index', 'ls-remote', 'status']);
const TMUX_READS = new Set(['list-sessions', 'ls', 'list-windows', 'list-panes', 'list-clients', 'capture-pane', 'display-message', 'display', 'has-session', 'has', 'show-options', 'show', 'show-environment', 'showenv', 'show-window-options', '-V']);
// why a command is not a read, or null
function notRead(c) {
  const base = path.basename(c.file);
  const args = c.args;
  if (c.file === process.execPath || base === 'node') {
    if (args[0] && path.basename(args[0]) === 'devteam.mjs') return DEVTEAM_READS.some((r) => r.test(args.slice(1).join(' '))) ? null : `devteam ${args.slice(1).join(' ')}`;
    return `node ${args.join(' ').slice(0, 120)}`;
  }
  if (base === 'git') {
    let i = 0;
    while (i < args.length && args[i].startsWith('-') && args[i] !== '--version') i += ['-C', '-c', '--git-dir', '--work-tree'].includes(args[i]) ? 2 : 1;
    const sub = args[i];
    const rest = args.slice(i + 1);
    if (GIT_READS.has(sub)) return null;
    if (sub === 'worktree' && rest[0] === 'list') return null;
    if (sub === 'stash' && rest[0] === 'list') return null;
    if (sub === 'remote' && ['get-url', 'show'].includes(rest[0])) return null;
    if (sub === 'remote' && rest.every((a) => a === '-v')) return null;
    // hashes a file without writing it to the object store (-w would)
    if (sub === 'hash-object' && !rest.includes('-w')) return null;
    if (sub === 'config' && rest.some((a) => /^--(get|get-all|get-regexp|list|l)$/.test(a) || a === '-l')) return null;
    if (sub === 'symbolic-ref' && rest.filter((a) => !a.startsWith('-')).length <= 1) return null;
    if (sub === 'branch' && rest.every((a) => a.startsWith('-')) && rest.some((a) => /^--(list|show-current)$/.test(a) || a === '-a' || a === '-r')) return null;
    return `git ${args.join(' ')}`;
  }
  if (base === 'tmux') {
    let i = 0;
    while (i < args.length && args[i].startsWith('-') && args[i] !== '-V') i += ['-S', '-L', '-f'].includes(args[i]) ? 2 : 1;
    return TMUX_READS.has(args[i]) ? null : `tmux ${args.join(' ')}`;
  }
  return `${base} ${args.join(' ').slice(0, 120)}`;
}

// The preload every process of the instance runs: each command it starts goes to DT_A13_CMDS as a
// line, and the dashboard's own process starts no interval timer (DT_A13_TIMERS=off): its timers
// stopped, what changes is what a request changed. node:child_process is patched before the kit loads,
// and its ESM bindings follow (syncBuiltinESMExports).
const PRELOAD = `import cp from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const LOG = process.env.DT_A13_CMDS;
const note = (file, args) => { try { fs.appendFileSync(LOG, JSON.stringify({ pid: process.pid, by: process.argv.slice(1, 4), file: String(file), args: args.map(String) }) + '\\n'); } catch {} };
const norm = (name, a) => {
  if (name === 'exec' || name === 'execSync') return ['/bin/sh', ['-c', String(a[0])]];
  if (name === 'fork') return [process.execPath, [String(a[0]), ...(Array.isArray(a[1]) ? a[1] : [])]];
  const args = Array.isArray(a[1]) ? a[1] : [];
  const opts = Array.isArray(a[1]) ? a[2] : a[1];
  if (opts && typeof opts === 'object' && opts.shell) return ['/bin/sh', ['-c', [a[0], ...args].join(' ')]];
  return [a[0], args];
};
for (const name of ['spawn', 'execFile', 'exec', 'fork', 'spawnSync', 'execFileSync', 'execSync']) {
  const orig = cp[name];
  cp[name] = function (...a) { const [f, args] = norm(name, a); note(f, args); return orig.apply(this, a); };
}
syncBuiltinESMExports();
if (process.env.DT_A13_TIMERS === 'off' && process.argv[2] === 'dashboard') {
  globalThis.setInterval = () => ({ unref() { return this; }, ref() { return this; }, hasRef() { return false; }, refresh() { return this; } });
}
`;

// ----- durable state -----
// files under run/ a GET may write: caches and what the instance's own process keeps, by name
const RUN_SKIP = [/^cache\//, /^dashboard\.log$/, /^dashboard-[^/]*\.log$/];
const hashTree = (dir, skip = [], base = dir, out = {}) => {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    const rel = path.relative(base, p);
    if (skip.some((r) => r.test(rel) || r.test(`${rel}/`))) continue;
    if (e.isDirectory()) hashTree(p, skip, base, out);
    else if (e.isSymbolicLink()) out[rel] = `link:${fs.readlinkSync(p)}`;
    else if (e.isFile()) out[rel] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  }
  return out;
};
const gitOut = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout;
const snapshot = (F) => ({
  log: hashTree(path.join(F.old, 'docs/devteam/run/log')),
  project: hashTree(path.join(F.old, 'docs/devteam/project')),
  refs: gitOut(F.old, ['for-each-ref', '--format=%(refname) %(objectname)']) + gitOut(F.old, ['symbolic-ref', 'HEAD']) + gitOut(F.org, ['for-each-ref', '--format=%(refname) %(objectname)']),
  worktrees: gitOut(F.old, ['worktree', 'list', '--porcelain']),
  run: hashTree(path.join(F.old, 'docs/devteam/run'), [/^log(\/|$)/, ...RUN_SKIP]),
});
const diff = (a, b) => {
  const out = [];
  for (const k of Object.keys(a)) {
    if (typeof a[k] === 'string') { if (a[k] !== b[k]) out.push(`${k} changed`); continue; }
    for (const f of new Set([...Object.keys(a[k]), ...Object.keys(b[k])])) if (a[k][f] !== b[k][f]) out.push(`${k}/${f} ${a[k][f] === undefined ? 'added' : b[k][f] === undefined ? 'removed' : 'changed'}`);
  }
  return out;
};

// ----- the fixture -----
function getSafeFixture() {
  const F = fleetFixture('get-safe');
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  F.ticket = 'gs-01-probe';
  F.ok(F.old, ['ticket', 'add', F.ticket, '--json', JSON.stringify({ title: 'probe', feature: 'chores', component: 'gs', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['src/**'], done_when: ['the probe passes'], notes: 'n' })], SUP);
  // an artifact on main, and a draft of it in the ticket's worktree
  F.slug = 'probe-page';
  const art = (root) => {
    const dir = path.join(root, 'docs/devteam/project/artifacts', F.slug);
    write(path.join(dir, 'artifact.json'), JSON.stringify({ v: 1, title: 'Probe', summary: 'A page', by: 'supervisor', for: [] }));
    write(path.join(dir, 'index.html'), `<!doctype html><html><body><p>${root === F.old ? 'main' : 'draft'}</p></body></html>`);
  };
  art(F.old);
  write(path.join(F.old, 'README.md'), 'probe\n');
  F.g(['add', '-A'], F.old);
  F.g(['commit', '-qm', 'probe: an artifact'], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
  F.wt = F.ticket;
  F.g(['worktree', 'add', '-q', '-b', `ticket/${F.ticket}`, path.join(F.old, '.worktrees', F.wt), 'origin/main'], F.old);
  art(path.join(F.old, '.worktrees', F.wt));
  // a preview record (nothing listens on its port)
  F.preview = 'calm-otter';
  write(path.join(F.old, 'docs/devteam/run/previews', `${F.preview}.json`), JSON.stringify({ name: F.preview, port: PORTS + 40, project: 'get-safe', session: 'supervisor', label: 'probe', cwd: F.old, at: new Date().toISOString(), expires: new Date(Date.now() + 86400000).toISOString() }));
  // origin one commit ahead of this clone, pushed from another: a fetch here would move refs/remotes/origin/main
  F.g(['clone', '-q', F.org, F.neu], F.base);
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) F.g(['config', k, v], F.neu);
  write(path.join(F.neu, 'ahead.txt'), 'ahead\n');
  F.g(['add', '-A'], F.neu);
  F.g(['commit', '-qm', 'ahead'], F.neu);
  F.g(['push', '-q', 'origin', 'main'], F.neu);
  fs.mkdirSync(F.home, { recursive: true });
  // a file dropped on the page, where a laptop's dashboard keeps it (laptopUploadsDir: under HOME, by the repo's real path)
  const real = fs.realpathSync(F.old);
  F.upload = `2026-11-20-${'a'.repeat(24)}/note.txt`;
  write(path.join(F.home, '.devteam', 'uploads', `${path.basename(real).replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 40)}-${crypto.createHash('sha256').update(real).digest('hex').slice(0, 8)}`, F.upload), 'a dropped note\n');
  F.preload = path.join(F.base, 'a13-preload.mjs');
  fs.writeFileSync(F.preload, PRELOAD);
  F.cmds = path.join(F.base, 'a13-commands.jsonl');
  return F;
}

const get = (port, p, headers = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  r.on('error', reject);
  r.setTimeout(120000, () => r.destroy(new Error(`GET ${p}: no answer in 2 min`)));
  r.end();
});
const readCmds = (F) => (fs.existsSync(F.cmds) ? fs.readFileSync(F.cmds, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
// the instance at rest: nothing of its group running but itself, and no command recorded for 400 ms
const settled = async (F, dash) => {
  let last = -1, same = 0;
  await until(() => {
    const kids = spawnSync('pgrep', ['-g', String(dash.p.pid)], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).filter((p) => Number(p) !== dash.p.pid);
    const n = readCmds(F).length;
    same = n === last && !kids.length ? same + 1 : 0;
    last = n;
    return same >= 4;
  }, 'the instance at rest');
};

async function sweep(t, F, mode, env) {
  const { dash, port } = await dashboardOnFreePort(F.old, env);
  try {
    // the hub (on PORTS, this test process's) up, and the start's own runs ended
    await until(async () => { try { return (await get(PORTS, '/instances.json', SAME)) === 200; } catch { return false; } }, 'the hub');
    await settled(F, dash);
    const table = REQUESTS(F);
    const failures = [];
    for (const [key, reqs] of Object.entries(table)) {
      const at = key.startsWith('hub ') ? PORTS : port;
      for (const rq of reqs) {
        const { path: p, headers } = typeof rq === 'string' ? { path: rq, headers: SAME } : rq;
        const before = snapshot(F);
        fs.writeFileSync(F.cmds, '');
        let status;
        try { status = await get(at, p, headers); } catch (e) { status = e.message; }
        await settled(F, dash);
        const changed = diff(before, snapshot(F));
        const writes = readCmds(F).map((c) => notRead(c)).filter(Boolean);
        t.diagnostic(`${mode}: ${status} GET ${key.split(' ')[0]} ${p}`);
        if (changed.length || writes.length) failures.push(`${mode}: GET ${key.split(' ')[0]} ${p} (${status}): ${[...changed, ...writes.map((w) => `started ${w}`)].join('; ')}`);
      }
    }
    return failures;
  } finally { await dash.stop(); }
}

test('org-access A13: the GET routes listed from the code are exactly the routes this test asks', () => {
  const F = { slug: 's', wt: 'w', preview: 'p', ticket: 't', upload: 'u' };
  const listed = [...getRoutes()].sort();
  const asked = Object.keys(REQUESTS(F)).sort();
  assert.ok(listed.length >= 25, `the routes found: ${listed.join(', ')}`);
  assert.deepEqual(listed.filter((k) => !asked.includes(k)), [], 'a GET route the test does not ask: add its requests to REQUESTS');
  assert.deepEqual(asked.filter((k) => !listed.includes(k)), [], 'a route the test asks that the code no longer has');
});

test('org-access A13: no GET route of the dashboard or the hub changes durable state or starts a command that writes', { timeout: 900000 }, async (t) => {
  const F = getSafeFixture();
  try {
    const env = (extra = {}) => ({ ...F.env({}), HOME: F.home, NODE_OPTIONS: `--import=${F.preload}`, DT_A13_CMDS: F.cmds, DT_A13_TIMERS: 'off', DEVTEAM_DATA_WAIT_MS: '600000', DEVTEAM_KIT_WATCH_MS: '600000000', ...extra });
    const failures = [
      ...(await sweep(t, F, 'laptop', env())),
      // a box: the public name set (and previews served on it), so the box's own branches run
      ...(await sweep(t, F, 'box', env({ DEVTEAM_PUBLIC_URL: 'https://box.example.test', DEVTEAM_PREVIEWS: '1', PORT: String(PORTS + 41) }))),
    ];
    assert.deepEqual(failures, [], 'every GET leaves durable state as it was and starts only reads');
  } finally { F.done(); }
});

const post = (port, p, headers = {}, body = '{}') => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { host: `127.0.0.1:${port}`, 'content-length': Buffer.byteLength(body), ...headers } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
  r.on('error', reject);
  r.setTimeout(120000, () => r.destroy(new Error(`POST ${p}: no answer in 2 min`)));
  r.end(body);
});

test('org-access A13: Check now fetches by POST /api/fleet-check, from the page\'s own origin only', { timeout: 300000 }, async () => {
  const F = getSafeFixture();
  try {
    const env = { ...F.env({}), HOME: F.home, NODE_OPTIONS: `--import=${F.preload}`, DT_A13_CMDS: F.cmds, DT_A13_TIMERS: 'off', DEVTEAM_KIT_WATCH_MS: '600000000' };
    const { dash, port } = await dashboardOnFreePort(F.old, env);
    try {
      await settled(F, dash);
      const own = { origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
      // another site's page: refused before anything runs
      fs.writeFileSync(F.cmds, '');
      const xs = await post(port, '/api/fleet-check', { ...own, origin: 'https://elsewhere.example', 'sec-fetch-site': 'cross-site' });
      await settled(F, dash);
      assert.equal(xs.status, 403, `cross-site: ${xs.body}`);
      assert.deepEqual(readCmds(F).map((c) => `${path.basename(c.file)} ${c.args.join(' ')}`), [], 'a refused check starts nothing');
      // the page's own: fleet status, after a fetch from origin
      fs.writeFileSync(F.cmds, '');
      const ok = await post(port, '/api/fleet-check', own);
      await settled(F, dash);
      assert.equal(ok.status, 200, `the check: ${ok.body}`);
      assert.ok(Array.isArray(JSON.parse(ok.body).blockers), 'the answer is fleet status');
      assert.ok(readCmds(F).some((c) => path.basename(c.file) === 'git' && c.args.includes('fetch')), 'the check fetched from origin');
      assert.match(gitOut(F.old, ['rev-parse', 'origin/main']), new RegExp(gitOut(F.org, ['rev-parse', 'main']).trim()), 'origin/main moved to origin\'s main');
    } finally { await dash.stop(); }
  } finally { F.done(); }
});
