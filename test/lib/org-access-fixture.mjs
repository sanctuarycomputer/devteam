// What org-access.get-safe.*.test.mjs share. No GET of the dashboard or the hub changes anything
// (kit-251, org-access A13). Every route is listed from devteam.mjs's own handlers and asked against
// a scratch instance with its timers stopped, on a laptop and as a box; around each request every
// file under the fixture is compared, and every command the instance starts is recorded. A13's
// sweep is in parts (PARTS), each asking a slice of REQUESTS' keys in a file of its own.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { dashboardOnFreePort, fleetFixture, PORTS, until, write } from './kit.mjs';

// ----- the requests: every route asked, each with the status it should get -----
const SAME = { 'sec-fetch-site': 'same-origin' };
const FRAME = { 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'iframe' };
// A request: [status, path, headers?], status a number, or { laptop, box } where the two differ. The
// box run asks only the first request of each key (the time a CI runner gives one file).
const REQUESTS = (F) => ({
  // a dropped file, served back on a laptop (on a box the gateway serves them, and this says so)
  'dash /upload/*': [[{ laptop: 200, box: 404 }, `/upload/${F.upload}`], [404, `/upload/2020-01-01-${'0'.repeat(24)}/none.txt`]],
  'dash /api/hello': [[200, '/api/hello']],
  'dash /': [[200, '/']],
  'dash /index.html': [[200, '/index.html']],
  'dash /api/data*': [[200, '/api/data']],
  'dash re:^\\/view\\/artifact\\/([^/]+)$': [[200, `/view/artifact/${F.slug}`], [200, `/view/artifact/${F.slug}?at=${F.wt}`]],
  'dash re:^\\/view\\/preview\\/([^/]+)$': [[200, `/view/preview/${F.preview}`]],
  'dash /api/artifact-fp': [[200, `/api/artifact-fp?slug=${F.slug}&at=${F.wt}`]],
  'dash /api/view': [[200, `/api/view?kind=artifact&slug=${F.slug}&at=main`], [200, `/api/view?kind=artifact&slug=${F.slug}&at=${F.wt}`], [200, `/api/view?kind=preview&name=${F.preview}`]],
  'dash /api/artifact-versions': [[200, `/api/artifact-versions?slug=${F.slug}`]],
  // the fetch of origin's status: a GET only reads; the page's POST is what fetches (kit-750)
  'dash /api/artifact-remote': [[200, '/api/artifact-remote']],
  'dash /api/threads': [[200, '/api/threads']],
  'dash /api/fleet': [[200, '/api/fleet?fetch=1'], [200, '/api/fleet']],
  'dash /api/record': [[200, `/api/record?id=${F.ticket}`]],
  'dash /api/peek': [[200, `/api/peek?kind=ticket&id=${F.ticket}`], [200, '/api/peek?kind=file&id=README.md']],
  'dash /api/sensor': [[200, `/api/sensor?name=${F.sensor}`], [200, `/api/sensor?name=${F.sensor}&range=7d`]],
  'dash /api/schema': [[200, '/api/schema']],
  'dash /api/timeline': [[200, `/api/timeline?id=${F.ticket}`]],
  'dash /api/governance': [[200, '/api/governance']],
  // a ref that would reach git show as an option is refused before git runs (kit-339)
  'dash /api/file': [[200, '/api/file?path=README.md'], [200, `/api/file?path=docs/devteam/project/artifacts/${F.slug}/index.html`], [400, '/api/file?path=README.md&ref=-p']],
  // the result as TSV only once the owner answered: this question has none yet, so `review result` says so
  'dash /api/review': [[200, `/api/review?id=${F.review}`], [404, `/api/review?id=${F.review}&format=tsv`]],
  'dash /public-manifest/*': [[200, `/public-manifest/${F.slug}`]],
  // a note's picture (kit-147): there is none here, so a 404, and another site's page is refused
  'dash re:^\\/api\\/shot\\/(t-\\d{8}-\\d{9}-[a-z0-9]+(?:-[a-z0-9]+)*)\\/(\\d{8}-\\d{9}-(?:light|dark)\\.png)$': [[404, '/api/shot/t-20260101-000000000-owner/20260101-000000000-light.png'], [403, '/api/shot/t-20260101-000000000-owner/20260101-000000000-light.png', { 'sec-fetch-site': 'cross-site' }]],
  'dash /artifact/*': [[200, `/artifact/main/${F.slug}/`], [301, `/artifact/main/${F.slug}`], [200, `/artifact/wt/${F.wt}/${F.slug}/`], [404, `/artifact/origin/ticket%2Fnone/${F.slug}/`]],
  'dash re:^\\/review\\/([^/]+)\\/([^/]*)$': [[200, `/review/${F.review}/`, FRAME], [200, `/review/preview/?path=docs/devteam/project/artifacts/${F.slug}/index.html&ref=main`, FRAME], [200, '/review/preview/devteam-ui.css']],
  // a socket: a plain request gets its guard's status
  'dash /presence': [[400, '/presence']],
  'dash /presence?*': [[400, '/presence?x=1']],
  'term /api/term/token': [[200, '/api/term/token']],
  'term re:^\\/api\\/term\\/(supervisor|shell)\\/(screen|history|keys)$': [[200, '/api/term/supervisor/screen'], [200, '/api/term/shell/screen'], [200, '/api/term/supervisor/history?before=0&count=10'], [200, '/api/term/shell/history?before=0&count=10']],
  'hub /presence': [[400, '/presence']],
  'hub /presence?*': [[400, '/presence?x=1']],
  'hub /': [[200, '/']],
  'hub /instances.json': [[200, '/instances.json']],
  // an operator thread's file: the laptop hub's own folder (on a box the gateway serves them)
  'hub /upload/*': [[{ laptop: 200, box: 404 }, `/upload/${F.upload}`], [404, `/upload/2020-01-01-${'0'.repeat(24)}/none.txt`]],
  'hub /memory.json': [[200, '/memory.json']],
  'hub /memory.json?*': [[200, '/memory.json?since=8d'], [200, `/memory.json?after=${new Date(Date.now() - 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z')}`]],
  // the thread written into this run's store, folded and answered (on a box, the boxed fold)
  'hub /operator/threads': [[200, '/operator/threads', SAME, new RegExp(OPERATOR_THREAD)]],
});
// A13 in parts, each a test in a file of its own (a CI runner gives one file about a minute): REQUESTS'
// keys in consecutive slices, in order. On the laptop each key asks its GETs and a HEAD, about 26
// requests a slice; the box asks each key's first GET, all in one slice. The route-listing test checks
// the slices cover every key once.
const LAPTOP_PARTS = [
  ['dash /upload/*', 'dash /api/hello', 'dash /', 'dash /index.html', 'dash /api/data*', 'dash re:^\\/view\\/artifact\\/([^/]+)$', 'dash re:^\\/view\\/preview\\/([^/]+)$', 'dash /api/artifact-fp', 'dash /api/view', 'dash /api/artifact-versions', 'dash /api/artifact-remote', 'dash /api/threads'],
  ['dash /api/fleet', 'dash /api/record', 'dash /api/peek', 'dash /api/sensor', 'dash /api/schema', 'dash /api/timeline', 'dash /api/governance', 'dash /api/file', 'dash /api/review', 'dash /public-manifest/*'],
  ['dash re:^\\/api\\/shot\\/(t-\\d{8}-\\d{9}-[a-z0-9]+(?:-[a-z0-9]+)*)\\/(\\d{8}-\\d{9}-(?:light|dark)\\.png)$', 'dash /artifact/*', 'dash re:^\\/review\\/([^/]+)\\/([^/]*)$', 'dash /presence', 'dash /presence?*', 'term /api/term/token', 'term re:^\\/api\\/term\\/(supervisor|shell)\\/(screen|history|keys)$', 'hub /presence', 'hub /presence?*', 'hub /', 'hub /instances.json', 'hub /upload/*', 'hub /memory.json', 'hub /memory.json?*', 'hub /operator/threads'],
];
const PARTS = { laptop: LAPTOP_PARTS, box: [LAPTOP_PARTS.flat()] };

// ----- the commands a GET may start -----
// devteam.mjs's own subcommands that only read (fleet status only with --no-fetch: without it, it
// fetches; review result never with --commit, which writes the result into the repo)
const DEVTEAM_READS = [/^hello\b/, /^dashboard-data\b/, /^fleet status\b.*--no-fetch\b/, /^record\b/, /^peek\b/, /^sensor series\b/, /^timeline\b/, /^governance\b/, /^operator-thread status\b/, /^review show\b/, /^review result\b(?!.*--commit\b)/, /^artifact (describe|versions|manifest)\b/];
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
    const names = rest.filter((a) => !a.startsWith('-'));
    // a read's flags that write: a file (--output), or a ref deleted
    if (rest.some((a) => /^--output(=|$)/.test(a))) return `git ${args.join(' ')}`;
    if (GIT_READS.has(sub)) return null;
    if (sub === 'worktree' && rest[0] === 'list') return null;
    if (sub === 'stash' && rest[0] === 'list') return null;
    if (sub === 'remote' && ['get-url', 'show'].includes(rest[0])) return null;
    if (sub === 'remote' && rest.every((a) => a === '-v')) return null;
    // hashes a file without writing it to the object store (-w would)
    if (sub === 'hash-object' && !rest.includes('-w')) return null;
    // a get or list flag, or one key and no value (git config user.name)
    if (sub === 'config' && (rest.some((a) => /^--(get|get-all|get-regexp|list)$/.test(a) || a === '-l') || (names.length === 1 && rest.every((a) => !a.startsWith('-') || /^--(global|local|system|null|show-origin)$/.test(a))))) return null;
    if (sub === 'symbolic-ref' && names.length <= 1 && !rest.some((a) => a === '-d' || a === '--delete')) return null;
    if (sub === 'branch' && rest.every((a) => a.startsWith('-')) && rest.some((a) => /^--(list|show-current)$/.test(a) || a === '-a' || a === '-r')) return null;
    return `git ${args.join(' ')}`;
  }
  if (base === 'tmux') {
    let i = 0;
    while (i < args.length && args[i].startsWith('-') && args[i] !== '-V') i += ['-S', '-L', '-f'].includes(args[i]) ? 2 : 1;
    const sub = args[i];
    const rest = args.slice(i + 1);
    // capture-pane -b keeps what it read in a paste buffer; display-message -I types into a pane
    if (sub === 'capture-pane' && rest.includes('-b')) return `tmux ${args.join(' ')}`;
    if (['display-message', 'display'].includes(sub) && rest.includes('-I')) return `tmux ${args.join(' ')}`;
    return TMUX_READS.has(sub) ? null : `tmux ${args.join(' ')}`;
  }
  return `${base} ${args.join(' ').slice(0, 120)}`;
}

// The preload every process of the instance runs: each command it starts goes to DT_A13_CMDS as a
// line, and the dashboard's and the hub's own processes start no interval timer (DT_A13_TIMERS=off):
// their timers stopped, what changes is what a request changed. node:child_process is patched before
// the kit loads, and its ESM bindings follow (syncBuiltinESMExports).
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
if (process.env.DT_A13_TIMERS === 'off' && ['dashboard', 'hub'].includes(process.argv[2])) {
  globalThis.setInterval = () => ({ unref() { return this; }, ref() { return this; }, hasRef() { return false; }, refresh() { return this; } });
}
`;

// ----- durable state -----
// What a read may touch, by path under the fixture's base: git's index (a status refreshes its stat
// cache), the kit's caches, the dashboard's own diagnostic log (it notes each refusal, a refused HEAD
// of the terminal's routes included), and what the test itself writes. Everything else is compared.
const SKIP = [
  /(^|\/)\.git\/index$/, /(^|\/)\.git\/worktrees\/[^/]+\/index$/,
  /^old\/docs\/devteam\/run\/cache\//, /^old\/docs\/devteam\/run\/dashboard\.log$/,
  /^a13-(preload\.mjs|commands\.jsonl)$/,
];
// Every directory (as rel/, with its mode) and file (its mode and sha256) under dir, a file's hash kept
// while its stat is unchanged: an empty directory made, or a mode changed, is a change too (kit-339).
// A directory is skipped as rel/, so a skipped tree's own directory is skipped with what it holds.
const HASHES = new Map();
const hashTree = (dir, base = dir, out = {}) => {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    const rel = path.relative(base, p);
    if (SKIP.some((r) => r.test(e.isDirectory() ? `${rel}/` : rel))) continue;
    if (e.isDirectory()) { out[`${rel}/`] = `dir:${(fs.statSync(p).mode & 0o7777).toString(8)}`; hashTree(p, base, out); }
    else if (e.isSymbolicLink()) out[rel] = `link:${fs.readlinkSync(p)}`;
    else if (e.isFile()) {
      const st = fs.statSync(p, { bigint: true });
      const k = `${p}|${st.size}|${st.mtimeNs}|${st.ctimeNs}|${st.ino}`;
      if (!HASHES.has(k)) HASHES.set(k, crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'));
      out[rel] = `${(Number(st.mode) & 0o7777).toString(8)}:${HASHES.get(k)}`;
    }
  }
  return out;
};
const gitOut = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout;
const snapshot = (F) => ({
  files: hashTree(F.base),
  refs: gitOut(F.old, ['for-each-ref', '--format=%(refname) %(objectname)']) + gitOut(F.old, ['symbolic-ref', 'HEAD']) + gitOut(F.org, ['for-each-ref', '--format=%(refname) %(objectname)']),
  worktrees: gitOut(F.old, ['worktree', 'list', '--porcelain']),
});
const diff = (a, b) => {
  const out = [];
  for (const k of Object.keys(a)) {
    if (typeof a[k] === 'string') { if (a[k] !== b[k]) out.push(`${k} changed`); continue; }
    for (const f of new Set([...Object.keys(a[k]), ...Object.keys(b[k])])) if (a[k][f] !== b[k][f]) out.push(`${f} ${a[k][f] === undefined ? 'added' : b[k][f] === undefined ? 'removed' : 'changed'}`);
  }
  return out;
};

// ----- the fixture -----
const SUP = { DEVTEAM_ROLE: 'supervisor' };
function getSafeFixture() {
  const F = fleetFixture('get-safe');
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
  // a review page for a review question, and a sensor (its samples below): each route then reaches its work
  write(path.join(F.old, 'review/page.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Check it</title></head>\n<body>\n<p>Look.</p>\n</body></html>\n');
  F.sensor = 'web';
  const sf = path.join(F.old, 'docs/devteam/project/settings.md');
  fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"gates": {', `"sensors": { "${F.sensor}": { "kind": "http", "url": "http://127.0.0.1:9/" } }, "gates": {`));
  F.g(['add', '-A'], F.old);
  F.g(['commit', '-qm', 'probe: an artifact, a review page, a sensor'], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
  F.review = F.ok(F.old, ['ask', '--kind', 'review', '--question', 'Does it look right?', '--ref', 'main', '--page', 'review/page.html', '--stake', '1', '--urgency', '1'], SUP).trim().split('\n').pop().trim();
  write(path.join(F.old, 'docs/devteam/run/sensors', F.sensor, 'samples.jsonl'), `${[1, 2, 3].map((i) => JSON.stringify({ at: new Date(Date.now() - i * 600000).toISOString(), ok: true, ms: 10 * i })).join('\n')}\n`);
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
  // States a read once wrote into (kit-339): origin's supervisor claim, as a fetch left it, held by
  // another machine, with no ~/.devteam/machine-id here (hostVerdict's default made one); and a legacy
  // `devteam` tmux session with a window of this checkout's, with no run/tmux-session (tmuxSession
  // saved the name it found). Each GET must leave both as they are.
  const claim = JSON.stringify({ devteam_host: 1, machine: 'm-a13otherbox01', hostname: 'other-box', at: new Date().toISOString(), since: new Date().toISOString(), fleet: null });
  const tree = spawnSync('git', ['mktree'], { cwd: F.old, input: '', encoding: 'utf8' }).stdout.trim();
  F.g(['update-ref', 'refs/devteam/host-origin', F.g(['commit-tree', tree, '-m', claim], F.old)], F.old);
  const legacy = spawnSync('tmux', ['new-session', '-d', '-s', 'devteam', '-n', F.ticket, '-c', path.join(F.old, '.worktrees', F.wt), 'sleep 3600'], { env: F.env({}), encoding: 'utf8' });
  assert.equal(legacy.status, 0, `a legacy tmux session: ${legacy.stderr}`);
  // a file dropped on the page, where a laptop's dashboard keeps it (laptopUploadsDir: under HOME, by the repo's real path)
  const real = fs.realpathSync(F.old);
  F.upload = `2026-11-20-${'a'.repeat(24)}/note.txt`;
  write(path.join(F.home, '.devteam', 'uploads', `${path.basename(real).replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 40)}-${crypto.createHash('sha256').update(real).digest('hex').slice(0, 8)}`, F.upload), 'a dropped note\n');
  write(path.join(F.home, '.devteam', 'uploads', `hub-${PORTS}`, F.upload), 'a note for the operator\n');
  F.preload = path.join(F.base, 'a13-preload.mjs');
  fs.writeFileSync(F.preload, PRELOAD);
  F.cmds = path.join(F.base, 'a13-commands.jsonl');
  return F;
}
const envOf = (F, extra = {}) => ({ ...F.env({}), HOME: F.home, NODE_OPTIONS: `--import=${F.preload}`, DT_A13_CMDS: F.cmds, DT_A13_TIMERS: 'off', DEVTEAM_DATA_WAIT_MS: '600000', DEVTEAM_KIT_WATCH_MS: '600000000', ...extra });
// One operator thread with an owner's turn, written straight into the store each run's hub reads
// (operatorDir: HOME/.devteam/operator-<hub port> on a laptop, HOME/operator on a box), in the shape
// operator-thread new appends (operatorAppend; operatorLines keeps only that shape): no command run,
// nothing left running.
const OPERATOR_THREAD = 'ot-20261120-000000000-a13a13';
const operatorThreads = (F) => {
  const at = new Date(Date.now() - 60000).toISOString();
  const lines = [{ v: 1, at, id: OPERATOR_THREAD, type: 'thread', op: 'new', by: 'owner', title: 'the importer looks slow tonight', subject: null }, { v: 1, at, id: 'ou-20261120-000000000-a13a13', type: 'turn', op: 'new', by: 'owner', thread: OPERATOR_THREAD, text: 'the importer looks slow tonight' }];
  for (const dir of [path.join(F.home, '.devteam', `operator-${PORTS}`), path.join(F.home, 'operator')]) write(path.join(dir, 'threads.jsonl'), lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
};

const request = (method, port, p, headers = {}, out = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => { const b = []; res.on('data', (c) => b.push(c)); res.on('end', () => { out.body = Buffer.concat(b).toString('utf8'); resolve(res.statusCode); }); });
  r.on('error', reject);
  r.setTimeout(120000, () => r.destroy(new Error(`${method} ${p}: no answer in 2 min`)));
  r.end();
});
// The recorded commands. A command appends its line while this reads, so only whole lines count: what
// follows the last newline is still being written (settled waits for its end). A
// whole line that isn't JSON still throws.
const cmdsText = (F) => (fs.existsSync(F.cmds) ? fs.readFileSync(F.cmds, 'utf8') : '');
const readCmds = (F, text = cmdsText(F)) => text.slice(0, text.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map((l) => JSON.parse(l));
// the instance at rest: nothing of its process groups running but their leaders, and no command
// recorded, for 300 ms
const settled = async (F, leaders) => {
  let last = -1, same = 0;
  await until(() => {
    const kids = leaders.flatMap((pid) => spawnSync('pgrep', ['-g', String(pid)], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).filter((p) => !leaders.includes(Number(p))));
    const text = cmdsText(F);
    const n = readCmds(F, text).length;
    same = n === last && !kids.length && (!text || text.endsWith('\n')) ? same + 1 : 0;
    last = n;
    return same >= 3;
  }, 'the instance at rest');
};
// the box's own hub: `devteam.mjs hub` alone, as the image starts it (cmdHub), in a group of its own
const startHub = (F, env) => {
  const p = spawn(process.execPath, [path.join(F.old, 'docs/devteam/scripts/devteam.mjs'), 'hub', '--release', 'v0.0.1'], { cwd: F.base, env, stdio: 'ignore', detached: true });
  p.on('error', () => {});
  return { p, stop: async () => { for (let i = 0; i < 100; i++) { try { process.kill(-p.pid, 'SIGKILL'); } catch { return; } await new Promise((r) => setTimeout(r, 50)); } } };
};

// keys: the slice of REQUESTS' keys this part asks (PARTS), each as before
async function sweep(t, F, mode, env, keys) {
  const hub = mode === 'box' ? startHub(F, env) : null;
  const { dash, port } = await dashboardOnFreePort(F.old, env);
  try {
    const leaders = [dash.p.pid, ...(hub ? [hub.p.pid] : [])];
    // the hub (on PORTS, this test process's) up, and the start's own runs ended
    await until(async () => { try { return (await request('GET', PORTS, '/instances.json', SAME)) === 200; } catch { return false; } }, 'the hub');
    await settled(F, leaders);
    const failures = [];
    // the seeded states as seeded, once the instance is up: a start that wrote either would leave the sweep nothing to see
    for (const f of [path.join(F.home, '.devteam', 'machine-id'), path.join(F.old, 'docs/devteam/run/tmux-session')]) if (fs.existsSync(f)) failures.push(`${mode}: ${path.relative(F.base, f)} exists before the sweep's first request (the start, or an earlier sweep, wrote it)`);
    const ask = async (key, method, [want, p, headers = SAME, has = null], checkStatus) => {
      const at = key.startsWith('hub ') ? PORTS : port;
      const before = snapshot(F);
      fs.writeFileSync(F.cmds, '');
      let status;
      const out = {};
      try { status = await request(method, at, p, headers, out); } catch (e) { status = e.message; }
      await settled(F, leaders);
      const changed = diff(before, snapshot(F));
      const writes = readCmds(F).map((c) => notRead(c)).filter(Boolean);
      const expect = typeof want === 'number' ? want : want[mode];
      t.diagnostic(`${mode}: ${status} ${method} ${key.split(' ')[0]} ${p}`);
      const wrong = checkStatus && status !== expect ? [`answered ${status}, not ${expect}`] : checkStatus && has && !has.test(out.body ?? '') ? [`its answer lacks ${has}`] : [];
      if (changed.length || writes.length || wrong.length) failures.push(`${mode}: ${method} ${key.split(' ')[0]} ${p} (${status}): ${[...wrong, ...changed, ...writes.map((w) => `started ${w}`)].join('; ')}`);
    };
    for (const [key, reqs] of Object.entries(REQUESTS(F)).filter(([k]) => keys.includes(k))) {
      for (const rq of mode === 'box' ? reqs.slice(0, 1) : reqs) await ask(key, 'GET', rq, true);
      // HEAD, which the view rule lets through too: the first request of each key, its status not
      // asserted (the hub answers every method but GET 405 before any route, so its keys aren't asked)
      if (mode === 'laptop' && !key.startsWith('hub ')) await ask(key, 'HEAD', reqs[0], false);
    }
    return failures;
  } finally { await dash.stop(); await hub?.stop(); }
}

export { envOf, getSafeFixture, gitOut, operatorThreads, PARTS, readCmds, REQUESTS, settled, sweep };
