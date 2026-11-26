#!/usr/bin/env node
// The parity run (parity@1). At a commit, build the cutover tree with the split tool, run the kit's
// own test suite in it beside the same suite at the commit itself, and report what isn't at 1:1.
//   node test/split/parity.mjs --at <sha> [--work <dir>]           every stage, in one work folder
//   node test/split/parity.mjs build --at <sha> --work <dir>        the tree, verify, apps, start-up, pages
//   node test/split/parity.mjs test --work <dir> --part '<part>'    one of test.yml's Node 24 parts, both sides
//   node test/split/parity.mjs report --at <sha> --work <dir>       parity.json and parity.md
// Options: --repo <dir> (default: this checkout), --split-dir <dir> (passed to split.mjs),
// --startup-runs n (default 50), --files f,… (only these test files, as one part), --main <ref> (main's
// tip, for merged tickets and page commits; default origin/main when it exists, else the sha), --json.
// Exit 0 a clean report, 1 a report that isn't clean, 2 refused (nothing written).
// Node 18+, built-ins only; needs git and tar. It writes only inside its work folder. Run it whole on
// GitHub's runners, never on a shared machine.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));

// test.yml's Node 24 parts, in its order (the test checks them against the file)
export const PARTS = [
  { part: 'chain', key: 'chain', groups: 'chain', shard: '' },
  ...[1, 2, 3, 4, 5].map((i) => ({ part: `rest ${i}/5`, key: `rest-${i}`, groups: 'rest', shard: `${i}/5`, ...(i === 1 ? { alone: true } : {}) })),
  ...[1, 2, 3, 4].map((i) => ({ part: `chrome ${i}/4`, key: `chrome-${i}`, groups: 'chrome', shard: `${i}/4` })),
];
export const FILES_PART = { part: 'files', key: 'files', groups: '', shard: '' };
export const OLD_PAGES = ['index.html', 'hub.html', 'canvas.html', 'browser.html', 'devteam-ui.js', 'devteam-ui.css'].map((f) => `docs/devteam/dashboard/${f}`);
export const PAGES = [
  { page: 'dashboard', old: 'docs/devteam/dashboard/index.html', app: 'dashboard', route: '/' },
  { page: 'canvas', old: 'docs/devteam/dashboard/canvas.html', app: 'dashboard', route: '/view/canvas/' },
  { page: 'browser view', old: 'docs/devteam/dashboard/browser.html', app: 'dashboard', route: '/browser/' },
  { page: 'hub', old: 'docs/devteam/dashboard/hub.html', app: 'hub', route: '/' },
];
export const STARTUP_BOUND = 1.1;
export const LIST_CAP = 200;
const ENTRY_MAX = 64 * 1024;
const BASELINE_FILE = 'test/split/parity.mjs';

export class Refusal extends Error {}
const gitEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('DEVTEAM_')));
const run = (cmd, a, o = {}) => spawnSync(cmd, a, { maxBuffer: 1 << 30, encoding: 'utf8', env: gitEnv(), ...o });
export const gitOf = (repo) => (a, o) => { const r = run('git', ['-C', repo, ...a], o); return r.status === 0 ? r.stdout : null; };
export const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
export const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const gz = (buf) => zlib.gzipSync(buf, { level: 6 }).length;
export function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// ---- TAP, as run.mjs prints it ----
// Each file's TAP under a `# <file>` header, then `summary: …` and one row per file. A test's name
// joins its parents' (from `# Subtest:` lines) with ' > '. A file whose row isn't ok and that has no
// failing test gives one { name: null } failure with the row's result.
const FILE_HEAD = /^# (test\/\S+\.test\.mjs)$/;
const SUBTEST = /^( *)# Subtest: (.*)$/;
const RESULT = /^( *)(not )?ok \d+(?: - (.*?))?(?:\s+# (SKIP|TODO)\b.*)?$/i;
const ROW = /^(\S+\.test\.mjs)  (\d+(?:\.\d+)?)  (.*?)(?: \(run \d+\))?$/;
const unescape = (s) => s.replace(/\\([\\#])/g, '$1');
export function parseTap(text) {
  const tests = [];
  const files = new Set();
  const rows = new Map();
  let file = null, stack = [], inSummary = false;
  for (const line of text.split('\n')) {
    if (/^summary: \d+ files?, concurrency \d+$/.test(line)) { inSummary = true; file = null; continue; }
    if (inSummary) { const m = ROW.exec(line); if (m) { rows.set(m[1], m[3]); files.add(m[1]); } continue; }
    const h = FILE_HEAD.exec(line);
    if (h) { file = h[1]; files.add(file); stack = []; continue; }
    if (!file) continue;
    const s = SUBTEST.exec(line);
    if (s) { const d = s[1].length / 4; stack.length = d; stack[d] = unescape(s[2]); continue; }
    const r = RESULT.exec(line);
    if (!r || r[3] === undefined) continue;
    const d = r[1].length / 4;
    const name = [...stack.slice(0, d), unescape(r[3])].join(' > ');
    stack.length = d;
    const status = r[2] ? 'fail' : r[4] ? r[4].toLowerCase() : 'pass';
    tests.push({ file, name, status });
  }
  for (const [f, result] of rows) {
    if (result.replace(/, near timeout$/, '') === 'ok') continue;
    if (!tests.some((t) => t.file === f && t.status === 'fail')) tests.push({ file: f, name: null, status: 'fail', why: result });
  }
  return { files: [...files].sort(), tests };
}

// ---- the comparison: failing tests ----
const keyOf = (t) => `${t.file}\u0000${t.name}`;
// partial (a part is missing): a file the tree side never ran isn't counted; the report names the part
export function compare(source, tree, { partial = false } = {}) {
  const failing = [];
  const treeFiles = new Set(tree.files);
  const srcFail = new Set(source.tests.filter((t) => t.status === 'fail').map(keyOf));
  const treeBy = new Map(tree.tests.map((t) => [keyOf(t), t]));
  for (const t of tree.tests) if (t.status === 'fail') failing.push({ file: t.file, name: t.name, why: `fails in the tree${t.why ? ` (${t.why})` : ''}${srcFail.has(keyOf(t)) ? '; fails at the source too' : ''}` });
  if (!partial) for (const f of source.files) if (!treeFiles.has(f)) failing.push({ file: f, name: null, why: 'not in the tree' });
  for (const t of source.tests) {
    if (t.status === 'skip' || t.name === null || !treeFiles.has(t.file)) continue;
    const u = treeBy.get(keyOf(t));
    if (!u) failing.push({ file: t.file, name: t.name, why: 'runs at the source, absent in the tree' });
    else if (u.status === 'skip') failing.push({ file: t.file, name: t.name, why: 'runs at the source, skipped in the tree' });
  }
  return failing;
}

// ---- git facts: merged tickets, their PR diffs, the baseline, page commits ----
const MERGE = /^Merge pull request #\d+ from [^/\s]+\/ticket\/(\S+)$/;
// mainline: the latest commit of main that sha holds (merge-base with the main ref), or sha itself when
// there is no main ref (a scheduled run on main, a local repo). A PR head's own history takes main in
// through second parents, so main's merges are read from main's first-parent line, never the PR's.
export function mainlineOf(git, sha, ref) {
  if (!ref || !(git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) ?? '').trim()) return sha;
  return (git(['merge-base', sha, ref]) ?? '').trim() || sha;
}
export function history(git, mainline) {
  const shallow = (git(['rev-parse', '--is-shallow-repository']) ?? '').trim() === 'true';
  const merges = new Map();
  for (const l of (git(['log', '--first-parent', '--format=%H%x09%s', mainline]) ?? '').split('\n')) {
    const [h, s] = l.split('\t');
    const m = MERGE.exec(s ?? '');
    if (m) merges.set(m[1], [...(merges.get(m[1]) ?? []), h]);
  }
  const diffs = new Map();
  const diffOf = (ticket) => {
    if (!diffs.has(ticket)) diffs.set(ticket, (merges.get(ticket) ?? []).flatMap((h) => (git(['diff', '--name-only', `${h}^1`, h]) ?? '').split('\n').filter(Boolean)));
    return diffs.get(ticket);
  };
  return { shallow, merged: (ticket) => merges.has(ticket), diffOf };
}

// a diff touches test <file> (a path under test/) when it changes it, or the overlay path that makes it
export function touchesTest(diff, file) {
  const f = file.replace(/^test\//, '');
  return diff.some((d) => {
    if (d === file) return true;
    if (new RegExp(`^test/split/overlay/[^/]+/files/test/${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`).test(d)) return true;
    const m = /^test\/split\/overlay\/[^/]+\/patches\/(.+)$/.exec(d);
    return !!m && (m[1] === `${f}.patch` || m[1] === `test/${f}.patch`);
  });
}

export const testEntryPath = (file) => `test/split/ledger/tests/${file.replace(/^test\//, '')}.json`;
export const readEntry = (root, rel) => {
  const p = path.join(root, rel);
  const st = fs.statSync(p, { throwIfNoEntry: false });
  if (!st) return { none: true };
  if (st.size > ENTRY_MAX) return { bad: `over ${ENTRY_MAX} bytes` };
  try { return { entry: JSON.parse(fs.readFileSync(p, 'utf8')) }; } catch (e) { return { bad: `not JSON (${e.message})` }; }
};
// An entry { file, ticket, sha256, source_sha256 }: ticket is the full ticket id (its branch is
// ticket/<id>); sha256 is the tree's text, source_sha256 the text at the source it was written against
// (null where that side has no such file). A change to either side voids it.
export function judgeTest({ file, treeText, sourceText, read, hist }) {
  const rel = testEntryPath(file);
  const { none, bad, entry } = read(rel);
  if (none) return { accepted: false, why: `no ledger entry ${rel}` };
  if (bad) return { accepted: false, why: `bad entry ${rel}: ${bad}` };
  if (!entry || typeof entry !== 'object' || entry.file !== file || typeof entry.ticket !== 'string' || !(typeof entry.sha256 === 'string' || entry.sha256 === null) || !(typeof entry.source_sha256 === 'string' || entry.source_sha256 === null)) return { accepted: false, why: `bad entry ${rel}: wants { "file": "${file}", "ticket", "sha256", "source_sha256" }` };
  const want = treeText === null ? null : sha256(treeText);
  if (entry.sha256 !== want) return { accepted: false, why: `the tree's text has sha256 ${want}, the entry ${entry.sha256}` };
  const was = sourceText === null || sourceText === undefined ? null : sha256(sourceText);
  if (entry.source_sha256 !== was) return { accepted: false, why: `the source's text has sha256 ${was}, the entry was written against ${entry.source_sha256}: ${file} changed on main since` };
  if (!hist.merged(entry.ticket)) return { accepted: false, why: hist.shallow ? `history too shallow to tell whether ${entry.ticket} merged` : `${entry.ticket} is not merged at this commit` };
  if (!touchesTest(hist.diffOf(entry.ticket), file)) return { accepted: false, why: `${entry.ticket}'s PR diff doesn't touch ${file} or the overlay path that makes it` };
  return { accepted: true, ticket: entry.ticket };
}

export function baselineOf(git, mainline) {
  const adds = (git(['log', '--first-parent', '--format=%H', '--diff-filter=A', mainline, '--', BASELINE_FILE]) ?? '').split('\n').filter(Boolean);
  return adds.length ? adds[adds.length - 1] : null;
}
export function pageCommits({ git, mainline, read, hist }) {
  const baseline = baselineOf(git, mainline);
  const out = { baseline, shallow: hist.shallow, unacknowledged: [], unported: [], ported: [], bad: [] };
  if (!baseline) { out.why = `no first-parent commit of main at ${mainline.slice(0, 8)} adds ${BASELINE_FILE}`; return out; }
  const commits = (git(['log', '--first-parent', '--format=%H', `${baseline}..${mainline}`, '--', ...OLD_PAGES]) ?? '').split('\n').filter(Boolean).reverse();
  for (const c of commits) {
    const pages = (git(['diff', '--name-only', `${c}^1`, c, '--', ...OLD_PAGES]) ?? '').split('\n').filter(Boolean);
    const rel = `test/split/ledger/pages/${c}.json`;
    const { none, bad, entry } = read(rel);
    if (none) { out.unacknowledged.push({ commit: c, pages }); continue; }
    const why = bad ?? (!entry || entry.commit !== c || !entry.pages || typeof entry.pages !== 'object' ? `wants { "commit": "${c}", "pages": { … } }` : pages.filter((p) => typeof entry.pages[p] !== 'string').map((p) => `names no ticket for ${p}`).join('; '));
    if (why) { out.bad.push({ commit: c, pages, why: `bad entry ${rel}: ${why}` }); out.unacknowledged.push({ commit: c, pages }); continue; }
    const open = pages.filter((p) => !hist.merged(entry.pages[p])).map((p) => ({ page: p, ticket: entry.pages[p] }));
    if (open.length) out.unported.push({ commit: c, open });
    else out.ported.push(c);
  }
  return out;
}

// ---- the tests' text: differing, unported node:vm ----
function walk(root, rel = 'test', acc = []) {
  const d = path.join(root, rel);
  if (!fs.statSync(d, { throwIfNoEntry: false })?.isDirectory()) return acc;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const r = `${rel}/${e.name}`;
    if (r === 'test/split') continue;
    if (e.isDirectory()) walk(root, r, acc); else if (e.isFile()) acc.push(r);
  }
  return acc;
}
export async function findingChecks(root) {
  const dir = path.join(root, 'test', 'split', 'overlay');
  const areas = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  const checks = [];
  for (const a of areas) {
    const f = path.join(dir, a, 'finding.mjs');
    if (!fs.existsSync(f)) continue;
    const m = await import(pathToFileURL(f).href);
    if (typeof m.sameBeyondFinding === 'function') checks.push(m.sameBeyondFinding);
  }
  return checks;
}
export function differing({ source, tree, checks = [] }) {
  const files = [...new Set([...walk(source), ...walk(tree)])].sort();
  const out = [];
  for (const f of files) {
    const a = fs.existsSync(path.join(source, f)) ? fs.readFileSync(path.join(source, f)) : null;
    const b = fs.existsSync(path.join(tree, f)) ? fs.readFileSync(path.join(tree, f)) : null;
    if (a && b && a.equals(b)) continue;
    if (a && b && checks.some((c) => c(a.toString('utf8'), b.toString('utf8'), f))) continue;
    out.push({ file: f, change: !a ? 'added' : !b ? 'removed' : 'changed', treeText: b === null ? null : b.toString('utf8'), sourceText: a === null ? null : a.toString('utf8') });
  }
  return out;
}
const PAGE_NAME = /\b(index|hub|canvas|browser)\.html\b/;
export function unportedVm({ source, tree }) {
  const dir = path.join(source, 'test');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => `test/${f}`).filter((f) => {
    const a = fs.readFileSync(path.join(source, f), 'utf8');
    if (!/\bnode:vm\b/.test(a) || !PAGE_NAME.test(a)) return false;
    const b = path.join(tree, f);
    if (!fs.existsSync(b)) return false;
    const c = fs.readFileSync(b, 'utf8');
    return /\bnode:vm\b/.test(c) && PAGE_NAME.test(c);
  });
}

// ---- pages: weight (dev-981's split) and time to first data ----
export function namedFiles(html) {
  const files = new Set();
  for (const m of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const tag = m[0];
    if (/^<script/i.test(tag) && /\snomodule\b/i.test(tag)) continue;
    const u = /\s(?:src|href)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (u && u.startsWith('/_next/static/')) files.add(u.split(/[?#]/)[0]);
  }
  return files;
}
const htmlFiles = (out, rel = '', acc = []) => {
  for (const e of fs.readdirSync(path.join(out, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (r !== '_next') htmlFiles(out, r, acc); } else if (e.name.endsWith('.html')) acc.push(r);
  }
  return acc;
};
export function runtimeOf(out) {
  const sets = htmlFiles(out).map((h) => namedFiles(fs.readFileSync(path.join(out, h), 'utf8')));
  if (sets.length < 2) return new Set();
  return new Set([...sets[0]].filter((f) => sets.every((s) => s.has(f))));
}
export const routeHtml = (out, route) => path.join(out, ...route.split('/').filter(Boolean), 'index.html');
export function weigh({ out, route, oldHtml }) {
  const html = fs.readFileSync(routeHtml(out, route));
  const runtime = runtimeOf(out);
  const named = namedFiles(html.toString('utf8'));
  const size = (u) => { const p = path.join(out, ...u.split('/').filter(Boolean)); return fs.existsSync(p) ? gz(fs.readFileSync(p)) : 0; };
  const own = gz(html) + [...named].filter((u) => !runtime.has(u)).reduce((s, u) => s + size(u), 0);
  const runtimeBytes = [...runtime].reduce((s, u) => s + size(u), 0);
  const today = gz(oldHtml);
  return { today, own, runtime: runtimeBytes, own_ratio: own / today, whole_ratio: (own + runtimeBytes) / today };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
// a server of its own: the page at its route, the app's files, '{}' with x-parity-data for anything else
export function pageServer({ route, html, out = null }) {
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = null;
    if (p === route || p === route.replace(/\/$/, '') || p === `${route}index.html`) file = { body: html, type: TYPES['.html'] };
    else if (out) {
      const abs = path.join(out, ...p.split('/').filter(Boolean));
      if (abs.startsWith(out + path.sep) && fs.statSync(abs, { throwIfNoEntry: false })?.isFile()) file = { body: fs.readFileSync(abs), type: TYPES[path.extname(abs)] ?? 'application/octet-stream' };
    }
    if (file) { res.writeHead(200, { 'content-type': file.type, 'cache-control': 'no-store' }); res.end(file.body); return; }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-parity-data': '1', 'access-control-expose-headers': 'x-parity-data' });
    res.end('{}');
  });
  srv.on('upgrade', (req, socket) => socket.destroy());
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ origin: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); }) })));
}
export const FIRST_DATA = `(() => {
  const done = () => { if (window.__firstData !== undefined) return; window.__firstData = null; requestAnimationFrame(() => requestAnimationFrame(() => { window.__firstData = performance.now(); })); };
  const f = window.fetch;
  window.fetch = (...a) => f(...a).then((r) => { if (r.headers.get('x-parity-data')) done(); return r; });
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...a) { this.addEventListener('load', () => { if (this.getResponseHeader('x-parity-data')) done(); }); return send.apply(this, a); };
})();`;
// median ms to first data over `loads` loads, or null when no data request came in `wait` ms
export async function firstData(chrome, url, { loads = 5, wait = 10000 } = {}) {
  const p = await chrome.newPage();
  try {
    await p.send('Page.enable');
    await p.send('Network.enable');
    // the server is plain http on 127.0.0.1: every https request (CDN fonts, scripts) fails at once
    await p.send('Network.setBlockedURLs', { urls: ['https://*'] });
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: FIRST_DATA });
    const times = [];
    for (let i = 0; i < loads; i++) {
      await p.send('Page.navigate', { url: 'about:blank' });
      await p.send('Page.navigate', { url });
      const end = Date.now() + wait;
      let t = null;
      while (Date.now() < end) {
        t = await p.ev('typeof window.__firstData === "number" ? window.__firstData : null').catch(() => null);
        if (typeof t === 'number') break;
        await new Promise((r) => setTimeout(r, 50));
      }
      if (typeof t !== 'number') return null;
      times.push(t);
    }
    return median(times);
  } finally { p.close(); }
}

// ---- the stages ----
// every DEVTEAM_* but the tests' own switches (DEVTEAM_TEST_*, as test.yml sets them) is removed
// ---- the children: start-up and the test parts ----
export const childEnv = (home, extra = {}, from = process.env) => ({ ...gitEnv(), ...Object.fromEntries(Object.entries(from).filter(([k]) => k.startsWith('DEVTEAM_TEST_'))), HOME: home, DEVTEAM_HUB_PORT: '4987', DEVTEAM_CGROUP: '/nonexistent/devteam-cgroup', DEVTEAM_MEMINFO: '/nonexistent/devteam-meminfo', ...extra });
const nodeMajor = () => Number(process.versions.node.split('.')[0]);
const tail = (s, n = 40) => String(s ?? '').trimEnd().split('\n').slice(-n).join('\n');

export function startup({ source, tree, runs, home }) {
  const times = { source: [], tree: [] };
  const failed = {};
  for (let i = 0; i < runs; i++) {
    for (const side of ['source', 'tree']) {
      if (failed[side]) continue;
      const root = side === 'source' ? source : tree;
      const t0 = process.hrtime.bigint();
      const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), 'whoami'], { cwd: root, env: childEnv(home), encoding: 'utf8', timeout: 60000 });
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      if (r.status !== 0) failed[side] = `exit ${r.status ?? r.signal}: ${tail(r.stderr, 5)}`;
      else times[side].push(ms);
    }
  }
  return judgeStartup({ runs, source_ms: median(times.source), tree_ms: median(times.tree), failed });
}
export function judgeStartup({ runs, source_ms, tree_ms, failed = {} }) {
  const ok = !failed.source && !failed.tree && source_ms > 0;
  const ratio = ok ? tree_ms / source_ms : null;
  return { runs, source_ms, tree_ms, ratio, bound: STARTUP_BOUND, ok: ok && ratio <= STARTUP_BOUND, ...(Object.keys(failed).length ? { failed } : {}) };
}

export function buildApps({ tree, home, major = nodeMajor() }) {
  const dir = path.join(tree, 'apps');
  if (!fs.existsSync(dir)) return 'no apps yet';
  const apps = [];
  for (const app of fs.readdirSync(dir).sort()) {
    const at = path.join(dir, app);
    if (!fs.existsSync(path.join(at, 'package.json'))) continue;
    if (major !== 24) { apps.push({ app, ok: false, why: `apps build on Node 24 only (this is Node ${major})` }); continue; }
    const env = childEnv(home, { DEVTEAM_BASE_PATH: '' });
    let why = null;
    for (const a of [['ci', '--ignore-scripts'], ['run', 'build']]) {
      const r = spawnSync('npm', a, { cwd: at, env, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 30 * 60000 });
      if (r.status !== 0) { why = `npm ${a.join(' ')} failed (${r.status ?? r.signal}):\n${tail(`${r.stdout}\n${r.stderr}`)}`; break; }
    }
    if (!why && !fs.existsSync(path.join(at, 'out'))) why = 'the build wrote no out/';
    if (why) { apps.push({ app, ok: false, why }); continue; }
    const to = path.join(tree, 'docs', 'devteam', 'apps', app);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(path.join(at, 'out'), to, { recursive: true });
    apps.push({ app, ok: true, out: path.relative(tree, to), lib_dist: fs.existsSync(path.join(at, 'lib-dist')) });
  }
  return apps;
}

export async function pages({ source, tree, apps, chromeLib = path.join(here, '..', 'lib', 'chrome.mjs') }) {
  if (apps === 'no apps yet') return 'no apps yet';
  const built = new Set(apps.filter((a) => a.ok).map((a) => a.app));
  let chrome = null, chromeWhy = null;
  try {
    const c = await import(pathToFileURL(chromeLib).href);
    if (c.canDrive) chrome = await c.openChrome(); else chromeWhy = 'not measured: no Chrome here';
  } catch (e) { chromeWhy = `not measured: ${e.message}`; }
  const out = [];
  try {
    for (const pg of PAGES) {
      const appOut = path.join(tree, 'docs', 'devteam', 'apps', pg.app);
      const oldHtml = fs.existsSync(path.join(source, pg.old)) ? fs.readFileSync(path.join(source, pg.old)) : null;
      if (!built.has(pg.app) || !fs.existsSync(routeHtml(appOut, pg.route))) { out.push({ page: pg.page, why: 'not built yet' }); continue; }
      if (!oldHtml) { out.push({ page: pg.page, why: `${pg.old} is not at the source` }); continue; }
      const row = { page: pg.page, app: pg.app, route: pg.route, weight: weigh({ out: appOut, route: pg.route, oldHtml }) };
      if (!chrome) row.time = chromeWhy;
      else {
        const time = async (srvOpts) => { const s = await pageServer(srvOpts); try { return await firstData(chrome, `${s.origin}${pg.route}`); } finally { await s.close(); } };
        const today = await time({ route: pg.route, html: oldHtml });
        const app = await time({ route: pg.route, html: fs.readFileSync(routeHtml(appOut, pg.route)), out: appOut });
        row.time = today === null || app === null ? `not measured: no data request in 10 s${today === null ? ' (today)' : ''}${app === null ? ' (the app)' : ''}` : { today_ms: today, app_ms: app, ratio: app / today };
      }
      out.push(row);
    }
  } finally { await chrome?.close(); }
  return out;
}

export function runPart({ root, part, files, home, concurrency }) {
  const env = childEnv(home);
  const runner = path.join(root, 'test', 'run.mjs');
  const calls = [];
  if (files) { const have = files.filter((f) => fs.existsSync(path.join(root, f))); if (have.length) calls.push(have); }
  else {
    if (part.alone) calls.push(['--group', 'alone']);
    calls.push(['--group', part.groups, ...(part.shard ? ['--shard', part.shard] : [])]);
  }
  let text = '';
  for (const a of calls) {
    const r = spawnSync(process.execPath, [runner, '--concurrency', String(concurrency), ...a], { cwd: root, env, encoding: 'utf8', maxBuffer: 1 << 30 });
    text += `${r.stdout}\n`;
    if (r.status === 2) text += `\n# run.mjs refused: ${tail(r.stderr, 5)}\n`;
  }
  return parseTap(text);
}

export function isClean(r) {
  return !!r.split.ok && !!r.verify?.clean && r.stale.length === 0 && r.missing_parts.length === 0 && r.failing.length === 0
    && r.differing.every((d) => d.accepted) && r.unported_vm.length === 0 && !!r.startup?.ok
    && (r.apps === 'no apps yet' || r.apps.every((a) => a.ok))
    && !r.page_commits.why && r.page_commits.unacknowledged.length === 0 && r.page_commits.unported.length === 0;
}

const pct = (x) => (typeof x === 'number' ? `${x.toFixed(2)}×` : String(x));
const kb = (n) => `${(n / 1000).toFixed(1)} KB`;
const capped = (rows, fmt) => [...rows.slice(0, LIST_CAP).map(fmt), ...(rows.length > LIST_CAP ? [`- … and ${rows.length - LIST_CAP} more (parity.json has all)`] : [])];
export function summary(r) {
  const L = [`# parity@1 at ${r.sha.slice(0, 8)}: ${r.clean ? 'clean (1:1)' : 'not clean'}`, ''];
  L.push(`- Source: ${r.sha}${r.main && r.main !== r.sha ? ` (main at ${r.main.slice(0, 8)} for the ledgers)` : ''}`);
  L.push(`- Verify: ${!r.split.ok ? `tree not built: ${r.split.error}` : r.verify.clean ? 'clean' : `${r.verify.problems.length} problems`}`);
  L.push(`- Stale items: ${r.stale.length}`);
  L.push(`- Failing tests: ${r.failing.length}${r.missing_parts.length ? ` (missing parts: ${r.missing_parts.join(', ')})` : ''}`);
  L.push(`- Differing tests not accepted: ${r.differing.filter((d) => !d.accepted).length} of ${r.differing.length}`);
  L.push(`- Unported node:vm tests: ${r.unported_vm.length}`);
  const s = r.startup;
  L.push(`- Start-up (whoami, ${s?.runs} runs each): ${s?.ratio == null ? `not measured${s?.failed ? ` (${Object.entries(s.failed).map(([k, v]) => `${k}: ${v}`).join('; ')})` : ''}` : `${pct(s.ratio)} (tree ${s.tree_ms.toFixed(0)} ms, source ${s.source_ms.toFixed(0)} ms; bound ${pct(s.bound)})${s.ok ? '' : ' OVER'}`}`);
  if (r.pages === 'no apps yet') L.push('- Pages: no apps yet');
  else for (const p of r.pages) L.push(`- Page ${p.page}: ${p.weight ? `own ${kb(p.weight.own)} vs today ${kb(p.weight.today)} (${pct(p.weight.own_ratio)}), runtime ${kb(p.weight.runtime)}, whole ${pct(p.weight.whole_ratio)}; first data ${typeof p.time === 'object' ? `${p.time.app_ms.toFixed(0)} ms vs today ${p.time.today_ms.toFixed(0)} ms (${pct(p.time.ratio)})` : p.time}` : p.why} (reported, never failing)`);
  const pc = r.page_commits;
  L.push(`- Unacknowledged page commits: ${pc.why ? pc.why : pc.unacknowledged.length}${pc.unported.length ? `; acknowledged, not ported: ${pc.unported.length}` : ''}${pc.shallow ? ' (history is shallow)' : ''}`);
  const sec = (title, rows, fmt) => { if (rows.length) L.push('', `## ${title} (${rows.length})`, '', ...capped(rows, fmt)); };
  sec('Verify problems', r.verify?.problems ?? [], (p) => `- ${p}`);
  sec('Stale items', r.stale, (x) => `- ${typeof x === 'string' ? x : JSON.stringify(x)}`);
  sec('Failing tests', r.failing, (f) => `- \`${f.file}\`${f.name === null ? '' : `: ${f.name}`} (${f.why})`);
  sec('Differing tests not accepted', r.differing.filter((d) => !d.accepted), (d) => `- \`${d.file}\` (${d.change}): ${d.why}`);
  sec('Unported node:vm tests', r.unported_vm, (f) => `- \`${f}\``);
  if (r.apps !== 'no apps yet') sec('Apps not built', r.apps.filter((a) => !a.ok), (a) => `- ${a.app}: ${a.why.split('\n')[0]}`);
  sec('Unacknowledged page commits', pc.unacknowledged, (c) => `- ${c.commit} (${c.pages.join(', ')})`);
  sec('Acknowledged, not ported', pc.unported, (c) => `- ${c.commit}: ${c.open.map((o) => `${o.page} → ${o.ticket}`).join(', ')}`);
  return `${L.join('\n')}\n`;
}

// ---- the command ----
export function parseArgs(argv) {
  const o = { stage: null, at: null, work: null, part: null, repo: null, splitDir: null, startupRuns: 50, files: null, json: false, main: 'origin/main' };
  let k = 0;
  if (argv[0] && !argv[0].startsWith('-')) {
    if (!['build', 'test', 'report'].includes(argv[0])) throw new Refusal(`unknown stage ${argv[0]} (build, test or report)`);
    o.stage = argv[0]; k = 1;
  }
  for (; k < argv.length; k++) {
    const a = argv[k];
    const val = () => { const v = argv[k + 1]; if (v === undefined || v.startsWith('--')) throw new Refusal(`${a} needs a value`); k++; return v; };
    if (a === '--at') o.at = val();
    else if (a === '--work') o.work = val();
    else if (a === '--part') o.part = val();
    else if (a === '--repo') o.repo = val();
    else if (a === '--split-dir') o.splitDir = val();
    else if (a === '--startup-runs') { const v = val(); if (!/^\d+$/.test(v) || +v < 1 || +v > 500) throw new Refusal('--startup-runs wants 1 to 500'); o.startupRuns = +v; }
    else if (a === '--files') o.files = val().split(',').map((f) => f.trim()).filter(Boolean);
    else if (a === '--main') o.main = val();
    else if (a === '--json') o.json = true;
    else throw new Refusal(`unknown option ${a}`);
  }
  return o;
}

function checkWork(dir, git) {
  const abs = path.resolve(dir);
  if (fs.lstatSync(abs, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Refusal(`${abs} is a link; give the folder itself`);
  const st = fs.statSync(abs, { throwIfNoEntry: false });
  if (st && (!st.isDirectory() || fs.readdirSync(abs).length)) throw new Refusal(`${abs} exists and is not an empty folder`);
  const parent = path.dirname(abs);
  if (!fs.statSync(parent, { throwIfNoEntry: false })?.isDirectory()) throw new Refusal(`${parent} does not exist`);
  const r = run('git', ['-C', st ? abs : parent, 'rev-parse', '--absolute-git-dir']);
  if (r.status === 0) throw new Refusal(`${abs} is inside the git repository ${r.stdout.trim()}; use a folder outside any checkout`);
  return abs;
}

// one commit of everything, so tests that ask git about the kit (git ls-files) see a repository
// origin: the kit checkout's origin URL, so tests that read the kit's releases from origin run as in
// test.yml's checkout (test/artifact-pages.test.mjs C8 fails under CI without one)
export function snapshot(dir, label, origin = null) {
  for (const a of [['init', '-q', '-b', 'main'], ...(origin ? [['remote', 'add', 'origin', origin]] : []), ['add', '-A'], ['-c', 'user.name=parity', '-c', 'user.email=parity@localhost', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', label]]) {
    const r = run('git', ['-C', dir, ...a]);
    if (r.status !== 0) throw new Error(`git ${a[0]} in ${dir} failed: ${tail(r.stderr, 5)}`);
  }
}
export async function build({ sha, repo, splitDir, work, startupRuns, files }) {
  const tree = path.join(work, 'tree'), source = path.join(work, 'source'), home = path.join(work, 'home');
  const o = run('git', ['-C', repo, 'remote', 'get-url', 'origin']);
  const origin = o.status === 0 ? o.stdout.trim() || null : null;
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const split = path.join(here, 'split.mjs');
  const sa = ['--at', sha, '--repo', repo, ...(splitDir ? ['--split-dir', splitDir] : [])];
  const s = spawnSync(process.execPath, [split, ...sa, '--out', tree, '--json'], { encoding: 'utf8', env: gitEnv(), maxBuffer: 1 << 28 });
  let js = null; try { js = JSON.parse(s.stdout); } catch {}
  const built = fs.existsSync(tree) && fs.readdirSync(tree).length > 0;
  const result = { parity: 1, sha, files, split: { ok: built, stale: Array.isArray(js?.stale) ? js.stale : [], ...(built ? {} : { error: tail(s.stderr, 20) || `split exited ${s.status}` }) } };
  fs.mkdirSync(source);
  const tar = run('git', ['-C', repo, 'archive', '--format=tar', sha], { encoding: 'buffer' });
  const x = spawnSync('tar', ['-x', '-f', '-', '-C', source], { input: tar.stdout });
  if (tar.status !== 0 || x.status !== 0) throw new Error(`git archive ${sha} into ${source} failed`);
  if (built) {
    const v = spawnSync(process.execPath, [split, '--verify', ...sa, '--tree', tree, '--json'], { encoding: 'utf8', env: gitEnv(), maxBuffer: 1 << 28 });
    let vj = null; try { vj = JSON.parse(v.stdout); } catch {}
    // start-up first, while neither folder is a repository: in a repository with no project settings the
    // CLI refuses every command but help and init (devteam.mjs's home check)
    result.startup = startup({ source, tree, runs: startupRuns, home });
    snapshot(tree, `parity: the tree at ${sha}`, origin);
    result.verify = vj ? { clean: !!vj.clean, problems: vj.report.flatMap((r) => r.problems) } : { clean: false, problems: [`verify exited ${v.status}: ${tail(v.stderr, 10)}`] };
    result.apps = buildApps({ tree, home });
    result.pages = await pages({ source, tree, apps: result.apps });
  }
  snapshot(source, `parity: the source at ${sha}`, origin);
  writeJson(path.join(work, 'build.json'), result);
  return result;
}

export function testPart({ work, part }) {
  const b = readJson(path.join(work, 'build.json'));
  const home = path.join(work, 'home');
  const concurrency = Number(process.env.DEVTEAM_TEST_CONCURRENCY) || os.availableParallelism?.() || os.cpus().length;
  const res = { part: part.part };
  // with no tree there is nothing to compare: the report says why (split's error)
  for (const side of ['source', 'tree']) res[side] = b.split.ok ? runPart({ root: path.join(work, side), part, files: b.files, home, concurrency }) : { files: [], tests: [] };
  fs.mkdirSync(path.join(work, 'parts'), { recursive: true });
  writeJson(path.join(work, 'parts', `${part.key}.json`), res);
  return res;
}

export async function report({ sha, repo, work, mainRef = 'origin/main' }) {
  const b = readJson(path.join(work, 'build.json'));
  if (b.sha !== sha) throw new Refusal(`the work folder is for ${b.sha}, not ${sha}`);
  const source = path.join(work, 'source'), tree = path.join(work, 'tree');
  const want = b.files ? [FILES_PART] : PARTS;
  const all = { source: { files: [], tests: [] }, tree: { files: [], tests: [] } };
  const missing = [];
  for (const p of want) {
    const f = path.join(work, 'parts', `${p.key}.json`);
    if (!fs.existsSync(f)) { missing.push(p.part); continue; }
    const j = readJson(f);
    for (const side of ['source', 'tree']) { all[side].files.push(...j[side].files); all[side].tests.push(...j[side].tests); }
  }
  const git = gitOf(repo);
  const mainline = mainlineOf(git, sha, mainRef);
  const hist = history(git, mainline);
  const read = (rel) => readEntryAt(source, rel);
  const r = { parity: 1, sha, at: new Date().toISOString(), split: b.split, verify: b.verify ?? null, stale: b.split.stale, missing_parts: missing };
  r.main = mainline;
  r.failing = b.split.ok ? compare(all.source, all.tree, { partial: missing.length > 0 }) : [];
  r.differing = b.split.ok ? differing({ source, tree, checks: await findingChecks(source) }).map((d) => ({ file: d.file, change: d.change, ...judgeTest({ file: d.file, treeText: d.treeText, sourceText: d.sourceText, read, hist }) })) : [];
  r.unported_vm = b.split.ok ? unportedVm({ source, tree }) : [];
  r.startup = b.startup ?? null;
  r.apps = b.apps ?? 'no apps yet';
  r.pages = b.pages ?? 'no apps yet';
  r.page_commits = pageCommits({ git, mainline, read, hist });
  r.counts = { stale: r.stale.length, failing: r.failing.length, differing_not_accepted: r.differing.filter((d) => !d.accepted).length, unported_vm: r.unported_vm.length, unacknowledged_page_commits: r.page_commits.unacknowledged.length };
  r.clean = isClean(r);
  writeJson(path.join(work, 'parity.json'), r);
  fs.writeFileSync(path.join(work, 'parity.md'), summary(r));
  return r;
}
const readEntryAt = (root, rel) => readEntry(root, rel);

async function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (e) { if (e instanceof Refusal) { process.stderr.write(`parity: ${e.message}\n`); return 2; } throw e; }
  try {
    const repo = path.resolve(o.repo ?? (run('git', ['-C', here, 'rev-parse', '--show-toplevel']).stdout ?? '').trim());
    const git = gitOf(repo);
    let sha = null;
    if (o.stage !== 'test') {
      if (!o.at) throw new Refusal('--at <sha> is required');
      sha = (git(['rev-parse', '--verify', '--quiet', `${o.at}^{commit}`]) ?? '').trim();
      if (!sha) throw new Refusal(`--at ${o.at} is not a commit in ${repo}`);
    }
    let part = null;
    if (o.stage === 'test') {
      part = [...PARTS, FILES_PART].find((p) => p.part === o.part);
      if (!part) throw new Refusal(`--part wants one of ${[...PARTS, FILES_PART].map((p) => `'${p.part}'`).join(', ')}`);
      if (!o.work || !fs.existsSync(path.join(o.work, 'build.json'))) throw new Refusal('test needs --work <dir> holding build.json; run the build stage first');
      const b = readJson(path.join(o.work, 'build.json'));
      if (!!b.files !== (part === FILES_PART)) throw new Refusal(b.files ? 'this work folder was built with --files: its only part is \'files\'' : 'the part \'files\' is only for a work folder built with --files');
    }
    if (o.stage === 'report' && (!o.work || !fs.existsSync(path.join(o.work, 'build.json')))) throw new Refusal('report needs --work <dir> holding build.json');
    let work;
    if (o.stage === 'build' || !o.stage) work = o.work ? checkWork(o.work) : fs.mkdtempSync(path.join(os.tmpdir(), `devteam-parity-${sha.slice(0, 8)}-`));
    else work = path.resolve(o.work);
    if (o.stage === 'build' || !o.stage) await build({ sha, repo, splitDir: o.splitDir && path.resolve(o.splitDir), work, startupRuns: o.startupRuns, files: o.files });
    if (o.stage === 'test') { testPart({ work, part }); return 0; }
    if (o.stage === 'build') return 0;
    if (!o.stage) for (const p of o.files ? [FILES_PART] : PARTS) testPart({ work, part: p });
    const r = await report({ sha, repo, work, mainRef: o.main });
    process.stdout.write(o.json ? `${JSON.stringify(r, null, 2)}\n` : `${summary(r)}\nparity.json: ${path.join(work, 'parity.json')}\nparity.md: ${path.join(work, 'parity.md')}\n`);
    return r.clean ? 0 : 1;
  } catch (e) {
    if (e instanceof Refusal) { process.stderr.write(`parity: ${e.message}\n`); return 2; }
    throw e;
  }
}

const isEntry = () => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (isEntry()) process.exitCode = await main(process.argv.slice(2));
