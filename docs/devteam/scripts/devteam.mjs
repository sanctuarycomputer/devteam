#!/usr/bin/env node
// devteam: graph, state and gate tooling. Node 20+, built-ins only.
// Usage: node docs/devteam/scripts/devteam.mjs <command> [args]. Run `help` for the list.
//
// Paths:
//   project  docs/devteam/project in the current checkout (override: --project <dir> or DEVTEAM_PROJECT)
//   run      docs/devteam/run in the MAIN checkout, shared by every worktree (override: DEVTEAM_RUN)
//
// Node folders (spec, plan, reviews, verification) live on each node's branch until it merges.
// Commands that judge a node read those files from git (the branch tip, or an exact SHA), so the
// supervisor sees the same thing from the main checkout that the worker sees in its worktree.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ---------- small helpers ----------

// Exit quietly when piped into something that closes early (e.g. `| head`).
process.stdout.on('error', (e) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});

const argv = process.argv.slice(2);
const command = argv.shift();

// Flags take every following non-flag token as their value(s), so put positionals before flags.
function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const values = [];
      while (i + 1 < args.length && !args[i + 1].startsWith('--')) values.push(args[++i]);
      flags[key] = values.length === 0 ? true : values.length === 1 ? values[0] : values;
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

const { flags, positional } = parseArgs(argv);
const asList = (v) => (v === undefined || v === true ? [] : Array.isArray(v) ? v : [v]);
const flagStr = (k) => (flags[k] === undefined || flags[k] === true ? undefined : Array.isArray(flags[k]) ? flags[k].join(' ') : String(flags[k]));

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).replace(/\n$/, '');
  } catch {
    return null;
  }
}

function die(msg, code = 1) {
  process.stderr.write(`devteam: ${msg}\n`);
  process.exit(code);
}

const warn = (msg) => process.stderr.write(`devteam: warning: ${msg}\n`);
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, obj) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  fs.renameSync(tmp, p); // atomic replace so readers never see a half-written file
};

// ---------- enums (mirror schema/*.schema.json) ----------

const NODE_KINDS = ['contract', 'build', 'integration', 'chore', 'spike'];
const PHASES = ['spawned', 'spec', 'plan', 'contract', 'build', 'verify', 'final-review', 'awaiting-word', 'merging', 'done', 'blocked', 'parked'];
const QUESTION_KINDS = ['design-change', 'merge-request', 'review-request', 'slot-request', 'blocked', 'owner-decision', 'one-way-door', 'clarification'];
const EVENT_TYPES = [
  'node.spawned', 'node.phase', 'node.blocked', 'node.parked', 'node.merged', 'node.released',
  'question.asked', 'question.answered', 'question.defaulted',
  'review.verdict', 'word.stage', 'word.merge', 'approve.spec', 'approve.plan', 'approve.design-change',
  'ruling', 'gate.result', 'slot.granted', 'slot.released',
  'replan', 'recovery', 'defect.escaped', 'cost',
];
const CHORES_COLUMN = 'chores'; // reserved column for chore and spike nodes that belong to no column plan

// ---------- locations ----------

const repoRoot = git(['rev-parse', '--show-toplevel']) ?? process.cwd();
const commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
const mainRoot = commonDir ? path.dirname(commonDir) : repoRoot;
const devteamDir = path.join(repoRoot, 'docs', 'devteam');
const projectDir = path.resolve(flagStr('project') ?? process.env.DEVTEAM_PROJECT ?? path.join(devteamDir, 'project'));
const runDir = path.resolve(process.env.DEVTEAM_RUN ?? path.join(mainRoot, 'docs', 'devteam', 'run'));
const projectRel = path.relative(repoRoot, projectDir).split(path.sep).join('/');
const projectInRepo = !!commonDir && projectRel !== '' && !projectRel.startsWith('..') && !path.isAbsolute(projectRel);

// ---------- binding ----------

const BINDING_DEFAULTS = {
  tmux_session: 'devteam',
  agent_command: 'claude --dangerously-skip-permissions',
  resume_command: 'claude --continue --dangerously-skip-permissions',
  max_active_nodes: 5,
  max_active_per_component: 2,
  stale_after_minutes: 30,
  question_default_after_hours: 24,
  main_branch: 'main',
  merge_method: 'merge',
  components: {},
  shared_resources: [],
  dashboard_command: null,
  notify: null,
  worker_denied_commands: ['gh pr merge', 'git push origin main', 'git push origin HEAD:main'],
  upstream_repo: 'sanctuarycomputer/devteam',
  upstream_check_hours: 24,
};

let bindingCache;
function loadBinding() {
  if (bindingCache) return bindingCache;
  const p = path.join(projectDir, 'binding.md');
  if (!fs.existsSync(p)) return (bindingCache = { ...BINDING_DEFAULTS });
  const m = fs.readFileSync(p, 'utf8').match(/```json devteam\s*\n([\s\S]*?)\n```/);
  if (!m) return (bindingCache = { ...BINDING_DEFAULTS });
  try {
    return (bindingCache = { ...BINDING_DEFAULTS, ...JSON.parse(m[1]) });
  } catch (e) {
    die(`binding.md settings block is not valid JSON: ${e.message}`);
  }
}

// ---------- reading project files from a source (working tree or a git ref) ----------

// A source is { ref } to read committed files at that ref, or { ref: null } for the working tree.
function srcRead(src, rel) {
  if (src.ref && projectInRepo) return git(['show', `${src.ref}:${projectRel}/${rel}`]);
  const p = path.join(projectDir, rel);
  return fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, 'utf8') : null;
}

function srcList(src, relDir) {
  if (src.ref && projectInRepo) {
    const out = git(['ls-tree', '--name-only', `${src.ref}:${projectRel}/${relDir}`]);
    return out ? out.split('\n').filter(Boolean) : [];
  }
  const p = path.join(projectDir, relDir);
  return fs.existsSync(p) ? fs.readdirSync(p) : [];
}

const WORKTREE = { ref: null };
const resolveCommit = (ref) => git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);

// ---------- graph ----------

const ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*-[0-9]{2,}-[a-z0-9]+(-[a-z0-9]+)*$/;
const STORY_RE = /^[A-Z][A-Z0-9]*-S[0-9]+$/;
const NODE_FIELDS = ['id', 'title', 'column', 'component', 'kind', 'size', 'risk', 'serves', 'depends_on', 'contracts', 'touches', 'done_when', 'one_way_doors', 'superseded_by', 'notes'];

function loadGraph() {
  const dir = path.join(projectDir, 'graph');
  const nodes = new Map();
  const loadErrors = [];
  if (!fs.existsSync(dir)) return { nodes, loadErrors };
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    try {
      const n = readJson(path.join(dir, f));
      n.__file = f;
      nodes.set(n.id ?? f.replace(/\.json$/, ''), n);
    } catch (e) {
      loadErrors.push(`${f}: not valid JSON (${e.message})`);
    }
  }
  return { nodes, loadErrors };
}

const isActive = (n) => !n.superseded_by;

function columnPlan(column) {
  const p = path.join(projectDir, 'columns', `${column}.md`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

function storiesForColumn(column) {
  const text = columnPlan(column);
  if (text === null) return null;
  // Stories are defined in section 1 only; ids elsewhere are references.
  const sec = text.match(/^##\s*1\.[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  return new Set((sec ? sec[1] : '').match(/\b[A-Z][A-Z0-9]*-S[0-9]+\b/g) ?? []);
}

const columnStatus = (column) => columnPlan(column)?.match(/^-?\s*Status:\s*(\S+)/m)?.[1] ?? null;

// Transitive dependency closure for every node.
function closures(nodes) {
  const memo = new Map();
  const visit = (id, stack = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    if (stack.has(id)) return new Set(); // cycle; reported elsewhere
    stack.add(id);
    const out = new Set();
    for (const d of nodes.get(id)?.depends_on ?? []) {
      if (!nodes.has(d)) continue;
      out.add(d);
      for (const x of visit(d, stack)) out.add(x);
    }
    stack.delete(id);
    memo.set(id, out);
    return out;
  };
  for (const id of nodes.keys()) visit(id);
  return memo;
}

function findCycle(nodes) {
  const state = new Map(); // 1 visiting, 2 done
  const stack = [];
  const dfs = (id) => {
    state.set(id, 1);
    stack.push(id);
    for (const d of nodes.get(id)?.depends_on ?? []) {
      if (!nodes.has(d)) continue;
      if (state.get(d) === 1) return [...stack.slice(stack.indexOf(d)), d];
      if (!state.has(d)) {
        const c = dfs(d);
        if (c) return c;
      }
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const id of nodes.keys()) {
    if (!state.has(id)) {
      const c = dfs(id);
      if (c) return c;
    }
  }
  return null;
}

// Longest path through the active subgraph, weighted S = 1, M = 2.
function criticalPath(sub) {
  const best = new Map();
  const weight = (id) => (sub.get(id).size === 'M' ? 2 : 1);
  const longest = (id) => {
    if (best.has(id)) return best.get(id);
    let top = { len: 0, path: [] };
    for (const d of sub.get(id).depends_on ?? []) {
      if (!sub.has(d)) continue;
      const r = longest(d);
      if (r.len > top.len) top = r;
    }
    const res = { len: top.len + weight(id), path: [...top.path, id] };
    best.set(id, res);
    return res;
  };
  let crit = { len: 0, path: [] };
  for (const id of sub.keys()) {
    const r = longest(id);
    if (r.len > crit.len) crit = r;
  }
  return crit;
}

const unbalancedBraces = (g) => (g.match(/\{/g) ?? []).length !== (g.match(/\}/g) ?? []).length;
const escRe = (s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&');

function globToRegex(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      re += '.*';
      i++;
      if (g[i + 1] === '/') i++;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = g.indexOf('}', i);
      if (end === -1) {
        re += '\\{'; // unbalanced: treat literally (validate reports it)
        continue;
      }
      re += `(${g.slice(i + 1, end).split(',').map(escRe).join('|')})`;
      i = end;
    } else re += escRe(c);
  }
  return new RegExp(`^${re}$`);
}

const hasWild = (g) => /[*?{[]/.test(g);
const staticPrefix = (g) => {
  const i = g.search(/[*?{[]/);
  return i === -1 ? g : g.slice(0, i);
};
const trimSlash = (p) => p.replace(/\/+$/, '');

// Does a file path fall under a touches entry? A wildcard-free entry matches itself and,
// if it names a directory, everything beneath it.
function pathMatches(entry, file) {
  if (!hasWild(entry)) {
    const e = trimSlash(entry);
    return file === e || file.startsWith(`${e}/`);
  }
  return globToRegex(entry).test(file);
}

// Conservative overlap test between two touches entries: may report an overlap that isn't
// real, never misses one.
function globsOverlap(a, b) {
  if (!hasWild(a) && !hasWild(b)) {
    const x = trimSlash(a);
    const y = trimSlash(b);
    return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
  }
  if (!hasWild(a)) return pathMatches(b, trimSlash(a)) || staticPrefix(b).startsWith(`${trimSlash(a)}/`);
  if (!hasWild(b)) return globsOverlap(b, a);
  const pa = staticPrefix(a);
  const pb = staticPrefix(b);
  return pa.startsWith(pb) || pb.startsWith(pa);
}

// ---------- git-derived facts ----------

let mainRefCache;
function mainRef() {
  if (mainRefCache !== undefined) return mainRefCache;
  const b = loadBinding().main_branch;
  for (const r of [`origin/${b}`, b]) {
    if (resolveCommit(r)) return (mainRefCache = r);
  }
  return (mainRefCache = null);
}

let mainLogCache;
function mainLog() {
  if (mainLogCache) return mainLogCache;
  const ref = mainRef();
  const out = ref ? git(['log', ref, '--format=%H%x09%s']) : null;
  mainLogCache = (out ? out.split('\n') : []).filter(Boolean).map((l) => {
    const [sha, ...rest] = l.split('\t');
    return { sha, subject: rest.join('\t') };
  });
  return mainLogCache;
}

let mergeParentsCache;
function mergeParents() {
  if (mergeParentsCache) return mergeParentsCache;
  const ref = mainRef();
  const out = ref ? git(['log', ref, '--merges', '--first-parent', '-n', '500', '--format=%H %P']) : null;
  mergeParentsCache = (out ? out.split('\n') : []).filter(Boolean).map((l) => l.split(' '));
  return mergeParentsCache;
}

// The tip of a node's branch: the local branch (shared by every worktree) first, then origin's.
function nodeBranchRef(id) {
  for (const r of [`refs/heads/node/${id}`, `refs/remotes/origin/node/${id}`]) if (resolveCommit(r)) return r;
  return null;
}

// The commit on main that landed a node: a merge commit from branch node/<id>, a squash
// commit titled "<id>: ...", or a merge whose second parent contains the branch tip and whose
// first parent does not. (A branch merely created from main is an ancestor of main too, so
// plain ancestry is not enough.)
const mergeShaCache = new Map();
function mergeShaFor(id) {
  if (mergeShaCache.has(id)) return mergeShaCache.get(id);
  const done = (v) => (mergeShaCache.set(id, v), v);
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fromBranch = new RegExp(`from \\S*node/${esc}$`);
  for (const { sha, subject } of mainLog()) {
    if (fromBranch.test(subject) || subject.startsWith(`${id}:`)) return done(sha);
  }
  const ref = mainRef();
  if (!ref) return done(null);
  for (const r of [`refs/heads/node/${id}`, `refs/remotes/origin/node/${id}`]) {
    const tip = resolveCommit(r);
    if (!tip || git(['merge-base', '--is-ancestor', tip, ref]) === null) continue;
    for (const [sha, p1, p2] of mergeParents()) {
      if (!p2) continue;
      if (git(['merge-base', '--is-ancestor', tip, p2]) !== null && git(['merge-base', '--is-ancestor', tip, p1]) === null) return done(sha);
    }
  }
  return done(null);
}

function isReleased(sha) {
  const tags = git(['tag', '--contains', sha, '--list', 'v*']);
  return !!tags && tags.split('\n').some((t) => t && !/-rc/.test(t));
}

// ---------- review records ----------

const statusOf = (text) => text?.match(/^Status:[ \t]*(\S+)/m)?.[1] ?? null;

function tableCells(row) {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function parseReview(file, text) {
  const m = file.match(/^([a-z]+)-(\d+)([a-z]?)\.md$/);
  const verdict = [...text.matchAll(/^Verdict:[ \t]*(APPROVE|CHANGES)[ \t]+(\S+)[ \t]*$/gm)].pop();
  const reviewerRaw = text.match(/^-[ \t]*Reviewer:[ \t]*(.*)$/m)?.[1]?.trim() ?? '';
  const reviewer = reviewerRaw && !reviewerRaw.startsWith('<') ? reviewerRaw : null;
  // Findings: any table row whose first cell is F<n>. The disposition is the cell under the
  // "Disposition" header; a row too short to have one is undispositioned.
  const findings = [];
  let dispIdx = -1;
  let sevIdx = 1;
  for (const row of text.split('\n')) {
    if (!row.trim().startsWith('|')) continue;
    const cells = tableCells(row);
    const lower = cells.map((c) => c.toLowerCase());
    if (lower.includes('disposition')) {
      dispIdx = lower.indexOf('disposition');
      sevIdx = Math.max(lower.indexOf('severity'), 1);
      continue;
    }
    if (/^F\d+$/.test(cells[0] ?? '')) findings.push({ id: cells[0], severity: cells[sevIdx] ?? '', disposition: dispIdx >= 0 ? (cells[dispIdx] ?? '') : '' });
  }
  return {
    file,
    stage: m ? m[1] : file.replace(/\.md$/, ''),
    pass: m ? Number(m[2]) : 0,
    variant: m ? m[3] : '',
    verdict: verdict ? verdict[1] : null,
    sha: verdict ? verdict[2] : null,
    shaValid: verdict ? /^[0-9a-f]{40}$/.test(verdict[2]) : false,
    reviewer,
    findings,
  };
}

function reviewRecordsIn(src, relDir) {
  return srcList(src, relDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => parseReview(f, srcRead(src, `${relDir}/${f}`) ?? ''));
}

const nodeReviews = (id, src) => reviewRecordsIn(src, `nodes/${id}/reviews`);
const columnReviews = (column) => reviewRecordsIn(WORKTREE, `reviews/${column}`);

// The latest record (highest pass) in each lineage (variant letter) for one stage.
function latestPerLineage(records, stage) {
  const latest = new Map();
  for (const r of records.filter((x) => x.stage === stage)) {
    const prev = latest.get(r.variant);
    if (!prev || r.pass > prev.pass) latest.set(r.variant, r);
  }
  return [...latest.values()];
}

const blocking = (sev) => /^(critical|important)$/i.test(sev);
const disposed = (d) => /^(fixed|wrong|wont-fix\b|won't-fix\b)/i.test(d ?? '');

// ---------- run state ----------

const runNodePath = (id) => path.join(runDir, 'nodes', `${id}.json`);
function readRunNode(id) {
  try {
    return fs.existsSync(runNodePath(id)) ? readJson(runNodePath(id)) : null;
  } catch {
    warn(`run/nodes/${id}.json is not valid JSON; ignoring`);
    return null;
  }
}

function appendEvent(ev) {
  if (!EVENT_TYPES.includes(ev.type)) die(`unknown event type "${ev.type}" (schema/event.schema.json)`);
  fs.mkdirSync(runDir, { recursive: true });
  const line = JSON.stringify({ ts: nowIso(), node: null, sha: null, summary: '', ref: null, ...ev });
  fs.appendFileSync(path.join(runDir, 'events.jsonl'), `${line}\n`); // one write of one line
}

function readEvents() {
  const p = path.join(runDir, 'events.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
}

// Malformed question files (hand-edited, half-written) are skipped with a warning, never fatal.
function readQuestions() {
  const dir = path.join(runDir, 'questions');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      try {
        const q = readJson(path.join(dir, f));
        const missing = ['id', 'kind', 'to', 'from', 'asked_at', 'question', 'status'].filter((k) => typeof q[k] !== 'string');
        if (missing.length) {
          warn(`run/questions/${f} is missing ${missing.join(', ')}; skipped`);
          return [];
        }
        return [q];
      } catch {
        warn(`run/questions/${f} is not valid JSON; skipped`);
        return [];
      }
    });
}

function tmux(args) {
  try {
    execFileSync('tmux', args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function tmuxHere() {
  if (!process.env.TMUX) return null;
  try {
    return execFileSync('tmux', ['display-message', '-p', '#S:#W'], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

function nudge(target, message) {
  if (!target) return false;
  return tmux(['send-keys', '-t', target, '-l', message]) && tmux(['send-keys', '-t', target, 'Enter']);
}

function currentNodeId() {
  if (process.env.DEVTEAM_NODE) return process.env.DEVTEAM_NODE;
  const b = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  return b?.startsWith('node/') ? b.slice(5) : null;
}

// Who is running this command: a node id, 'planner' or 'supervisor'.
function currentActor() {
  const node = currentNodeId();
  if (node) return node;
  if (process.env.DEVTEAM_ROLE === 'planner') return 'planner';
  const b = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (b?.startsWith('plan/')) return 'planner';
  return 'supervisor';
}

const supervisorTarget = () => process.env.DEVTEAM_SUPERVISOR ?? `${loadBinding().tmux_session}:0`;

// ---------- derived status ----------

function deriveStatus(nodes) {
  const merged = new Map([...nodes.keys()].map((id) => [id, mergeShaFor(id)]));
  return [...nodes.values()].map((n) => {
    const id = n.id;
    const mergeSha = merged.get(id);
    const run = readRunNode(id);
    const branch = nodeBranchRef(id);
    // Before merge, a node's files exist only on its branch; read them there.
    const src = branch && !mergeSha ? { ref: branch } : WORKTREE;
    const spec = statusOf(srcRead(src, `nodes/${id}/spec.md`));
    const plan = statusOf(srcRead(src, `nodes/${id}/plan.md`));
    const reviews = nodeReviews(id, src);
    const depsMerged = (n.depends_on ?? []).every((d) => merged.get(d));
    let stage = 'planned';
    if (n.superseded_by) stage = 'superseded';
    else if (mergeSha) stage = isReleased(mergeSha) ? 'released' : 'merged';
    else if (reviews.some((r) => r.stage === 'final')) stage = 'in-review';
    else if (branch && plan === 'approved' && depsMerged) stage = 'building';
    else if (plan === 'approved') stage = 'planned-in-detail';
    else if (spec === 'approved') stage = "spec'd";
    else if (depsMerged) stage = 'ready';
    const heartbeatAge = run?.heartbeat_at ? Math.round((Date.now() - Date.parse(run.heartbeat_at)) / 60000) : null;
    return {
      id,
      column: n.column,
      component: n.component,
      kind: n.kind,
      risk: n.risk,
      stage,
      merge_sha: mergeSha,
      branch,
      depends_on: n.depends_on ?? [],
      deps_merged: depsMerged,
      phase: run?.phase ?? null,
      task: run?.task ?? null,
      heartbeat_minutes: heartbeatAge,
      cost: run?.cost ?? null,
      note: run?.note ?? null,
    };
  });
}

function reviewStats(nodes) {
  const byStage = {};
  let findings = 0;
  let wrong = 0;
  const all = [];
  for (const id of nodes.keys()) {
    const branch = nodeBranchRef(id);
    all.push(...nodeReviews(id, branch && !mergeShaFor(id) ? { ref: branch } : WORKTREE));
  }
  for (const col of new Set([...nodes.values()].map((n) => n.column))) all.push(...columnReviews(col));
  for (const r of all) {
    for (const f of r.findings) {
      findings++;
      if (/^wrong/i.test(f.disposition)) wrong++;
    }
    if (r.pass !== 1 || r.variant || !r.verdict) continue;
    byStage[r.stage] ??= { first_passes: 0, rejected: 0 };
    byStage[r.stage].first_passes++;
    if (r.verdict === 'CHANGES') byStage[r.stage].rejected++;
  }
  for (const s of Object.values(byStage)) s.rejection_rate = s.first_passes ? +(s.rejected / s.first_passes).toFixed(2) : null;
  return { by_stage: byStage, findings, false_positive_rate: findings ? +(wrong / findings).toFixed(2) : null };
}

// ---------- commands ----------

function cmdValidate() {
  const { nodes, loadErrors } = loadGraph();
  const errors = [...loadErrors];
  const warnings = [];
  const err = (id, msg) => errors.push(`${id}: ${msg}`);

  for (const [id, n] of nodes) {
    for (const k of Object.keys(n)) if (k !== '__file' && !NODE_FIELDS.includes(k)) err(id, `unknown field "${k}"`);
    for (const k of ['id', 'title', 'column', 'component', 'kind', 'size', 'risk', 'serves', 'depends_on', 'touches', 'done_when']) {
      if (n[k] === undefined) err(id, `missing required field "${k}"`);
    }
    if (`${n.id}.json` !== n.__file) err(id, `id does not match file name ${n.__file}`);
    if (n.id && !ID_RE.test(n.id)) err(id, 'id must be <component>-<NN>-<slug>');
    if (n.id && n.component && !n.id.startsWith(`${n.component}-`)) err(id, `id must start with its component "${n.component}-"`);
    if (n.kind && !NODE_KINDS.includes(n.kind)) err(id, `kind must be one of ${NODE_KINDS.join(', ')}`);
    if (n.size && !['S', 'M'].includes(n.size)) err(id, 'size must be S or M (D1: split anything larger)');
    if (n.risk && !['normal', 'high'].includes(n.risk)) err(id, 'risk must be normal or high');
    for (const s of n.serves ?? []) if (!STORY_RE.test(s)) err(id, `serves "${s}" is not a story id like COL-S1`);
    if (!Array.isArray(n.touches) || n.touches.length === 0) err(id, 'touches must list at least one path or glob');
    for (const g of n.touches ?? []) if (typeof g !== 'string' || !g.trim() || unbalancedBraces(g)) err(id, `touches entry "${g}" is empty or has unbalanced braces`);
    if (!Array.isArray(n.done_when) || n.done_when.length === 0) err(id, 'done_when must list at least one check (D5)');
    for (const d of n.done_when ?? []) if (typeof d !== 'string' || d.trim().length < 10) err(id, `done_when entry too vague: "${d}" (D5)`);
    for (const d of n.depends_on ?? []) {
      if (d === id) err(id, 'depends on itself');
      else if (!nodes.has(d)) err(id, `depends_on "${d}" does not exist (D3)`);
      else if (!isActive(nodes.get(d)) && isActive(n)) err(id, `depends_on "${d}" is superseded; depend on its replacement`);
    }
    if (n.superseded_by && !nodes.has(n.superseded_by)) err(id, `superseded_by "${n.superseded_by}" does not exist`);
    if ((n.one_way_doors ?? []).length > 0 && n.risk !== 'high') err(id, 'lists a one-way door, so risk must be high (D8)');
    if (n.column === CHORES_COLUMN && !['chore', 'spike'].includes(n.kind)) err(id, `only chore and spike nodes may use the reserved column "${CHORES_COLUMN}"`);
    if (isActive(n) && ['chore', 'spike'].includes(n.kind) && (n.serves ?? []).length === 0 && !n.notes) {
      err(id, `${n.kind} node serving no story must say why in notes (D6)`);
    }
    if (isActive(n) && !['chore', 'spike'].includes(n.kind) && (n.serves ?? []).length === 0) err(id, 'must serve at least one story (D6)');
    if (n.kind === 'contract' && !(n.contracts?.provides ?? []).length) err(id, 'contract node must list contracts.provides (D2)');
  }

  const cycle = findCycle(nodes);
  if (cycle) errors.push(`dependency cycle: ${cycle.join(' -> ')} (D3)`);

  // Columns: stories defined and served (D6); approved plans carry approved design and graph reviews.
  const columns = new Set([...nodes.values()].filter(isActive).map((n) => n.column).filter((c) => c && c !== CHORES_COLUMN));
  for (const col of columns) {
    const stories = storiesForColumn(col);
    if (!stories) {
      errors.push(`column "${col}": project/columns/${col}.md not found (chore/spike nodes outside any column use "${CHORES_COLUMN}")`);
      continue;
    }
    const served = new Set();
    for (const n of nodes.values()) {
      if (!isActive(n) || n.column !== col) continue;
      for (const s of n.serves ?? []) {
        if (!stories.has(s)) err(n.id, `serves "${s}", which ${col}.md section 1 does not define`);
        served.add(s);
      }
    }
    for (const s of stories) if (!served.has(s)) errors.push(`column "${col}": story ${s} is served by no node (D6)`);

    // D7 (warning): a story served by more than one component should have an integration node.
    for (const s of stories) {
      const servers = [...nodes.values()].filter((n) => isActive(n) && (n.serves ?? []).includes(s));
      const comps = new Set(servers.filter((n) => n.kind !== 'contract').map((n) => n.component));
      if (comps.size > 1 && !servers.some((n) => n.kind === 'integration')) {
        warnings.push(`column "${col}": story ${s} spans ${[...comps].join(', ')} but has no integration node (D7)`);
      }
    }

    if (columnStatus(col) === 'approved') {
      const reviews = columnReviews(col);
      for (const stage of ['design', 'graph']) {
        const latest = latestPerLineage(reviews, stage);
        if (!latest.length) errors.push(`column "${col}" is approved but has no ${stage} review in project/reviews/${col}/ (planning.md P2, P5)`);
        else if (latest.some((r) => r.verdict !== 'APPROVE')) errors.push(`column "${col}" is approved but its latest ${stage} review is not APPROVE`);
      }
    }
  }

  // D4: nodes that can run concurrently must have disjoint footprints. Merged nodes are history.
  if (!cycle) {
    const clos = closures(nodes);
    const live = [...nodes.values()].filter((n) => isActive(n) && !mergeShaFor(n.id));
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i];
        const b = live[j];
        if (clos.get(a.id)?.has(b.id) || clos.get(b.id)?.has(a.id)) continue;
        outer: for (const ga of a.touches ?? []) {
          for (const gb of b.touches ?? []) {
            if (globsOverlap(ga, gb)) {
              errors.push(`${a.id} and ${b.id} can run concurrently but both touch "${ga}" / "${gb}" (D4)`);
              break outer;
            }
          }
        }
      }
    }
  }

  // Node folders must belong to a graph node.
  const nd = path.join(projectDir, 'nodes');
  if (fs.existsSync(nd)) {
    for (const f of fs.readdirSync(nd)) {
      if (f.startsWith('.')) continue;
      if (!nodes.has(f)) errors.push(`project/nodes/${f}/ has no graph node`);
    }
  }

  for (const w of warnings) process.stdout.write(`warning: ${w}\n`);
  for (const e of errors) process.stdout.write(`error: ${e}\n`);
  process.stdout.write(`${nodes.size} node(s), ${errors.length} error(s), ${warnings.length} warning(s)\n`);
  process.exit(errors.length ? 1 : 0);
}

function activeWorker(id) {
  const r = readRunNode(id);
  return !!r && !['done', 'parked'].includes(r.phase);
}

function cmdReady() {
  const { nodes } = loadGraph();
  const merged = new Map([...nodes.keys()].map((id) => [id, mergeShaFor(id)]));
  const rows = [];
  for (const n of nodes.values()) {
    if (!isActive(n) || merged.get(n.id) || activeWorker(n.id)) continue;
    const depsMerged = (n.depends_on ?? []).every((d) => merged.get(d));
    if (depsMerged || flags['spec-ahead']) rows.push({ id: n.id, component: n.component, kind: n.kind, size: n.size, risk: n.risk, mode: depsMerged ? 'build' : 'spec-ahead' });
  }
  const b = loadBinding();
  const active = [...nodes.keys()].filter(activeWorker);
  const perComponent = {};
  for (const id of active) perComponent[nodes.get(id).component] = (perComponent[nodes.get(id).component] ?? 0) + 1;
  if (flags.json) {
    return void process.stdout.write(`${JSON.stringify({ ready: rows, active, active_per_component: perComponent, caps: { max_active_nodes: b.max_active_nodes, max_active_per_component: b.max_active_per_component } }, null, 2)}\n`);
  }
  process.stdout.write(`active workers: ${active.length}/${b.max_active_nodes}\n`);
  if (!rows.length) return void process.stdout.write('nothing ready\n');
  for (const r of rows) {
    const full = (perComponent[r.component] ?? 0) >= b.max_active_per_component ? '  (component at cap)' : '';
    process.stdout.write(`${r.mode.padEnd(10)} ${r.id}  (${r.kind}, ${r.size}, ${r.risk})${full}\n`);
  }
}

function cmdWaves() {
  const { nodes } = loadGraph();
  const col = flagStr('column');
  const sub = new Map([...nodes].filter(([, n]) => isActive(n) && (!col || n.column === col)));
  if (findCycle(sub)) die('graph has a cycle; run validate');
  const level = new Map();
  const lvl = (id) => {
    if (level.has(id)) return level.get(id);
    const deps = (sub.get(id).depends_on ?? []).filter((d) => sub.has(d));
    const v = deps.length ? 1 + Math.max(...deps.map(lvl)) : 0;
    level.set(id, v);
    return v;
  };
  for (const id of sub.keys()) lvl(id);
  const crit = criticalPath(sub);
  const waves = [];
  for (const [id, l] of level) (waves[l] ??= []).push(id);
  if (flags.json) return void process.stdout.write(`${JSON.stringify({ waves, critical_path: crit.path, critical_weight: crit.len }, null, 2)}\n`);
  waves.forEach((w, i) => process.stdout.write(`wave ${i + 1} (${w.length}): ${w.sort().join(', ')}\n`));
  process.stdout.write(`critical path (weight ${crit.len}, S=1 M=2): ${crit.path.join(' -> ')}\n`);
  process.stdout.write(`${sub.size} node(s) in ${waves.length} wave(s); max parallel width ${Math.max(0, ...waves.map((w) => w.length))}\n`);
}

function cmdStatus() {
  const { nodes } = loadGraph();
  const rows = deriveStatus(nodes);
  if (flags.json) {
    return void process.stdout.write(`${JSON.stringify({ generated_at: nowIso(), nodes: rows, reviews: reviewStats(nodes) }, null, 2)}\n`);
  }
  const stale = loadBinding().stale_after_minutes;
  for (const r of rows) {
    const isStale = r.heartbeat_minutes > stale && !['done', 'parked'].includes(r.phase);
    const live = r.phase ? `  [${r.phase}${r.task ? ` ${r.task}` : ''}, ${r.heartbeat_minutes}m${isStale ? ' STALE' : ''}]` : '';
    process.stdout.write(`${r.stage.padEnd(18)} ${r.id}${live}\n`);
  }
  const s = reviewStats(nodes);
  for (const [stage, v] of Object.entries(s.by_stage)) process.stdout.write(`review ${stage}: first-pass rejection ${v.rejected}/${v.first_passes}\n`);
}

// The PR body's "## One-way doors" section must be "None." or reference an owner answer.
function oneWayDoorsSection(body) {
  const m = body.match(/^##\s+One-way doors\s*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  if (!m) return { ok: false, why: 'PR body has no "## One-way doors" section' };
  const text = m[1].replace(/<!--[\s\S]*?-->/g, '').trim();
  if (text === 'None.') return { ok: true, none: true };
  if (/q-\d{8}-\d{6}-[a-z0-9-]+|https?:\/\/\S+/.test(text)) return { ok: true, none: false };
  return { ok: false, why: 'the "## One-way doors" section must be "None." or link the owner\'s answer (a q-… id or a URL)' };
}

// Definition of done for a node at an exact head, reading committed files at that head.
function checkNode(id, { sha: shaArg, title, body }) {
  const { nodes } = loadGraph();
  const n = nodes.get(id);
  const fails = [];
  if (!n) return [`no graph node ${id}`];
  if (n.superseded_by) fails.push(`node is superseded by ${n.superseded_by}`);
  let sha = null;
  let src = WORKTREE;
  if (commonDir) {
    sha = resolveCommit(shaArg ?? 'HEAD');
    if (!sha) return [`commit ${shaArg} not found locally (fetch it first)`];
    if (projectInRepo) src = { ref: sha };
  }
  const read = (rel) => srcRead(src, `nodes/${id}/${rel}`);

  if (statusOf(read('spec.md')) !== 'approved') fails.push('spec.md missing or not "Status: approved" (committed at this head)');
  if (statusOf(read('plan.md')) !== 'approved') fails.push('plan.md missing or not "Status: approved" (committed at this head)');
  const ver = read('verification.md');
  if (ver === null) fails.push('verification.md missing');
  else {
    const rows = ver.split('\n').filter((l) => /^\|/.test(l.trim()) && !/^\|\s*-/.test(l.trim())).length - 1;
    if (rows < (n.done_when ?? []).length) fails.push(`verification.md has ${Math.max(rows, 0)} result row(s) for ${n.done_when.length} done-when(s)`);
  }

  // Reviews: every final lineage that reviewed this head must end in APPROVE; enough distinct
  // reviewers must have approved it; verdicts carry full SHAs and a named reviewer.
  const reviews = nodeReviews(id, src);
  for (const r of reviews) {
    if (r.verdict && !r.shaValid) fails.push(`${r.file}: verdict SHA must be the full 40-character commit SHA`);
    if (r.verdict && !r.reviewer) fails.push(`${r.file}: missing "- Reviewer:" line; an unnamed review does not count`);
  }
  // A verdict made at commit V still holds at head H if V is an ancestor of H and the commits
  // since V change nothing but this node's review records (committing the record moves the head).
  const reviewsDir = projectInRepo ? `${projectRel}/nodes/${id}/reviews/` : null;
  const holdsAt = (v) => {
    if (!sha || !v || !/^[0-9a-f]{40}$/.test(v)) return false;
    if (v === sha) return true;
    if (!reviewsDir || git(['merge-base', '--is-ancestor', v, sha]) === null) return false;
    const since = (git(['diff', '--name-only', v, sha]) ?? '').split('\n').filter(Boolean);
    return since.every((f) => f.startsWith(reviewsDir));
  };
  const finalsAtHead = reviews.filter((r) => r.stage === 'final' && holdsAt(r.sha));
  const latest = latestPerLineage(finalsAtHead, 'final');
  if (!reviews.some((r) => r.stage === 'final')) fails.push('no final review record (reviews/final-<n>.md)');
  else if (!latest.length) fails.push(`no final review holds at this head (${sha}): each must name a commit with nothing but review records after it`);
  for (const r of latest) if (r.verdict === 'CHANGES') fails.push(`${r.file}: latest final review at this head says CHANGES`);
  const approvers = new Set(latest.filter((r) => r.verdict === 'APPROVE' && r.reviewer && r.shaValid).map((r) => r.reviewer));
  const need = n.risk === 'high' ? 2 : 1;
  if (approvers.size < need) fails.push(`needs ${need} final APPROVE review(s) at this head from different named reviewers; found ${approvers.size}`);
  for (const r of reviews) {
    for (const f of r.findings) if (blocking(f.severity) && !disposed(f.disposition)) fails.push(`${r.file} ${f.id} (${f.severity}) has no disposition`);
  }

  // Footprint: every changed file is inside touches or the node's own folder (worker.md §3).
  const base = mainRef() && sha ? git(['merge-base', mainRef(), sha]) : null;
  if (base) {
    const changed = (git(['diff', '--name-only', base, sha]) ?? '').split('\n').filter(Boolean);
    const own = projectInRepo ? `${projectRel}/nodes/${id}/` : null;
    const outside = changed.filter((f) => !(own && f.startsWith(own)) && !(n.touches ?? []).some((t) => pathMatches(t, f)));
    if (outside.length) fails.push(`changes files outside touches: ${outside.slice(0, 10).join(', ')}${outside.length > 10 ? ` (+${outside.length - 10} more)` : ''}`);
  }

  if (title !== undefined && !new RegExp(`^${id.replace(/-/g, '\\-')}: \\S`).test(title)) fails.push(`PR title must start with "${id}: "`);
  if (body !== undefined) {
    const owd = oneWayDoorsSection(body);
    if (!owd.ok) fails.push(owd.why);
    else if (owd.none && (n.one_way_doors ?? []).length) fails.push('node lists one-way doors but the PR body says "None."; link the owner\'s answer');
  }
  return fails;
}

const readBody = () => {
  const f = flagStr('body-file');
  if (f === undefined) return undefined;
  if (!fs.existsSync(f)) die(`--body-file ${f} not found`);
  return fs.readFileSync(f, 'utf8');
};

function report(fails, okMsg) {
  if (fails.length) {
    for (const f of fails) process.stdout.write(`fail: ${f}\n`);
    process.exit(1);
  }
  process.stdout.write(`ok: ${okMsg}\n`);
}

function cmdCheckNode() {
  const id = positional[0] ?? die('usage: check-node <node-id> [--sha <head>] [--title "<pr title>"] [--body-file <path>]');
  const sha = flagStr('sha');
  report(checkNode(id, { sha, title: flagStr('title'), body: readBody() }), `${id} meets the definition of done at ${(resolveCommit(sha ?? 'HEAD') ?? '').slice(0, 12)}`);
}

// The mechanical half of the merge word, run in CI as the required `merge-word` check (ci.md §3).
function cmdCheckPr() {
  const headRef = flagStr('head-ref') ?? die('check-pr needs --head-ref');
  const title = flagStr('title') ?? die('check-pr needs --title');
  const body = readBody() ?? die('check-pr needs --body-file');
  if (headRef.startsWith('node/')) {
    return report(checkNode(headRef.slice(5), { sha: flagStr('sha'), title, body }), `${headRef} passes the mechanical merge-word checks`);
  }
  const fails = [];
  if (!/^chore-[a-z0-9]+(-[a-z0-9]+)*: \S/.test(title)) fails.push('a PR that is not from a node/<id> branch must be titled "chore-<slug>: <summary>"');
  const owd = oneWayDoorsSection(body);
  if (!owd.ok) fails.push(owd.why);
  report(fails, `${headRef} passes the mechanical merge-word checks`);
}

function questionId(from) {
  const d = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '');
  const slug = String(from).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'anon';
  return `q-${d.slice(0, 8)}-${d.slice(9, 15)}-${slug}`;
}

function cmdAsk() {
  const from = flagStr('from') ?? currentActor();
  const q = flagStr('question') ?? die('ask needs --question');
  const kind = flagStr('kind') ?? 'clarification';
  if (!QUESTION_KINDS.includes(kind)) die(`--kind must be one of ${QUESTION_KINDS.join(', ')}`);
  const to = flagStr('to') ?? (from === 'supervisor' ? 'owner' : 'supervisor');
  if (!['supervisor', 'owner'].includes(to)) die('--to must be supervisor or owner');
  if (to === 'owner' && from !== 'supervisor') die('workers and planners ask the supervisor; the supervisor escalates to the owner (questions.md §2)');
  if (flags.default === true) die('--default needs a value');
  const def = flagStr('default') ?? null;
  if (kind === 'one-way-door' && def) die('one-way doors never have a default (questions.md §4)');
  let id = questionId(from);
  for (let i = 2; fs.existsSync(path.join(runDir, 'questions', `${id}.json`)); i++) id = `${questionId(from)}-${i}`;
  const question = {
    id,
    kind,
    to,
    from,
    node: flagStr('node') ?? currentNodeId(),
    session: tmuxHere(),
    asked_at: nowIso(),
    question: q,
    context: flagStr('context') ?? '',
    options: asList(flags.options),
    recommendation: flagStr('recommendation') ?? '',
    default: def,
    blocks: asList(flags.blocks),
    head_sha: kind === 'merge-request' ? (flagStr('head') ?? git(['rev-parse', 'HEAD'])) : null,
    status: 'open',
    answer: null,
    answered_by: null,
    answered_at: null,
    recorded_in: null,
  };
  writeJson(path.join(runDir, 'questions', `${id}.json`), question);
  appendEvent({ type: 'question.asked', actor: from, node: question.node, summary: q.slice(0, 280), ref: `run/questions/${id}.json` });
  if (to === 'supervisor') nudge(supervisorTarget(), `devteam: new question ${id}`);
  process.stdout.write(`${id}\n`);
}

// Where to nudge the asker: the tmux pane recorded at ask time, else the node's window.
function askerTarget(q) {
  if (q.session) return q.session;
  if (q.from === 'supervisor') return supervisorTarget();
  if (q.from === 'planner') return null;
  return `${loadBinding().tmux_session}:${q.from}`;
}

function cmdAnswer() {
  const [id, ...rest] = positional;
  if (!id || !rest.length) die('usage: answer <question-id> "<answer>" [--by owner|supervisor] [--defaulted]');
  const p = path.join(runDir, 'questions', `${id}.json`);
  if (!fs.existsSync(p)) die(`no question ${id}`);
  const q = readJson(p);
  if (q.status !== 'open') die(`${id} is already ${q.status}`);
  const by = flagStr('by') ?? (currentActor() === 'supervisor' ? 'supervisor' : die('only the supervisor or the owner answers questions'));
  if (!['supervisor', 'owner'].includes(by)) die('--by must be supervisor or owner');
  if (q.to === 'owner' && by !== 'owner' && !flags.defaulted) die(`${id} is addressed to the owner; only the owner answers it (or apply its default with --defaulted)`);
  if (flags.defaulted && !q.default) die(`${id} has no default to apply`);
  q.answer = rest.join(' ');
  q.answered_by = by;
  q.answered_at = nowIso();
  q.status = flags.defaulted ? 'defaulted' : 'answered';
  writeJson(p, q);
  appendEvent({ type: flags.defaulted ? 'question.defaulted' : 'question.answered', actor: by, node: q.node, summary: q.answer.slice(0, 280), ref: `run/questions/${id}.json` });
  nudge(askerTarget(q), `devteam: ${id} answered`);
  process.stdout.write(`answered ${id}\n`);
}

// For answers written by hand or by a dashboard: log the missing event and nudge the asker.
function cmdSyncQuestions() {
  const logged = new Set(readEvents().filter((e) => /^question\.(answered|defaulted)$/.test(e.type)).map((e) => e.ref));
  let n = 0;
  for (const q of readQuestions()) {
    const ref = `run/questions/${q.id}.json`;
    if (!['answered', 'defaulted'].includes(q.status) || logged.has(ref)) continue;
    appendEvent({ type: q.status === 'defaulted' ? 'question.defaulted' : 'question.answered', actor: q.answered_by ?? 'owner', node: q.node, summary: (q.answer ?? '').slice(0, 280), ref });
    nudge(askerTarget(q), `devteam: ${q.id} answered`);
    n++;
  }
  process.stdout.write(`synced ${n} answer(s)\n`);
}

function cmdRecorded() {
  const [id, where] = positional;
  if (!id || !where) die('usage: recorded <question-id> <tracked-file-path>');
  const p = path.join(runDir, 'questions', `${id}.json`);
  if (!fs.existsSync(p)) die(`no question ${id}`);
  const q = readJson(p);
  if (q.status === 'open') die(`${id} is still open`);
  q.recorded_in = where;
  writeJson(p, q);
  process.stdout.write(`recorded ${id} in ${where}\n`);
}

function rankQuestions(qs, nodes) {
  const sub = new Map([...nodes].filter(([, n]) => isActive(n)));
  const crit = findCycle(sub) ? new Set() : new Set(criticalPath(sub).path);
  const score = (q) => {
    const ownerTier = q.to === 'owner' && ['one-way-door', 'owner-decision'].includes(q.kind) ? 1000 : 0;
    const blocks = (q.blocks ?? []).reduce((s, id) => s + (crit.has(id) ? 3 : 1), 0);
    return ownerTier + blocks * 10;
  };
  return [...qs].sort((a, b) => score(b) - score(a) || a.asked_at.localeCompare(b.asked_at));
}

function cmdQuestions() {
  const { nodes } = loadGraph();
  let qs = readQuestions();
  if (!flags.all) qs = qs.filter((q) => q.status === 'open');
  if (flagStr('to')) qs = qs.filter((q) => q.to === flagStr('to'));
  if (flags.mine) {
    const me = currentActor();
    qs = qs.filter((q) => q.from === me);
  }
  qs = rankQuestions(qs, nodes);
  if (flags.json) return void process.stdout.write(`${JSON.stringify(qs, null, 2)}\n`);
  if (!qs.length) return void process.stdout.write('no questions\n');
  for (const q of qs) {
    process.stdout.write(`${q.id}  [${q.kind} → ${q.to}, ${q.status}]${q.blocks?.length ? ` blocks ${q.blocks.join(',')}` : ''}\n  ${q.question}\n`);
    if (q.recommendation) process.stdout.write(`  recommend: ${q.recommendation}\n`);
    if (q.answer) process.stdout.write(`  answer (${q.answered_by}): ${q.answer}\n`);
  }
}

function cmdHeartbeat() {
  const supervisor = !!flags.supervisor;
  const id = supervisor ? 'supervisor' : (currentNodeId() ?? die('heartbeat needs DEVTEAM_NODE or a node/<id> branch'));
  const phase = flagStr('phase');
  if (phase !== undefined && !PHASES.includes(phase)) die(`--phase must be one of ${PHASES.join(', ')}`);
  const p = supervisor ? path.join(runDir, 'supervisor.json') : runNodePath(id);
  const prev = (supervisor ? (fs.existsSync(p) ? readJson(p) : null) : readRunNode(id)) ?? {};
  const next = { ...prev, id, heartbeat_at: nowIso() };
  const session = tmuxHere() ?? prev.session;
  if (!supervisor) {
    next.phase = phase ?? prev.phase ?? 'spawned';
    next.worktree = repoRoot;
    next.branch = git(['rev-parse', '--abbrev-ref', 'HEAD']) ?? prev.branch;
    next.head_sha = git(['rev-parse', 'HEAD']) ?? prev.head_sha ?? null;
    next.started_at = prev.started_at ?? nowIso();
    if (flags.task !== undefined) next.task = flagStr('task') ?? null;
  }
  if (session) next.session = session;
  if (flags.note !== undefined) next.note = (flagStr('note') ?? '').slice(0, 280);
  if (flags.usd !== undefined || flags.in !== undefined || flags.out !== undefined) {
    const src = flagStr('cost-source') ?? prev.cost?.source ?? 'agent-report';
    if (!['gateway', 'agent-report', 'estimate'].includes(src)) die('--cost-source must be gateway, agent-report or estimate');
    next.cost = {
      usd: flagStr('usd') !== undefined ? Number(flagStr('usd')) : (prev.cost?.usd ?? 0),
      input_tokens: flagStr('in') !== undefined ? Number(flagStr('in')) : (prev.cost?.input_tokens ?? 0),
      output_tokens: flagStr('out') !== undefined ? Number(flagStr('out')) : (prev.cost?.output_tokens ?? 0),
      source: src,
    };
  }
  writeJson(p, next);
  if (!supervisor && next.phase !== prev.phase) {
    appendEvent({ type: 'node.phase', actor: id, node: id, sha: next.head_sha, summary: `${prev.phase ?? 'none'} -> ${next.phase}${next.note ? `: ${next.note}` : ''}` });
  }
  process.stdout.write(`heartbeat ${id}${supervisor ? '' : ` ${next.phase}`}\n`);
}

function cmdEvent() {
  const type = flagStr('type') ?? die('event needs --type (see schema/event.schema.json)');
  appendEvent({
    type,
    actor: flagStr('actor') ?? currentActor(),
    node: flagStr('node') ?? currentNodeId(),
    sha: flagStr('sha') ?? null,
    summary: (flagStr('summary') ?? '').slice(0, 280),
    ref: flagStr('ref') ?? null,
  });
  process.stdout.write('ok\n');
}

function cmdHistory() {
  const id = positional[0];
  const tail = Number(flagStr('tail') ?? 100);
  let evs = readEvents();
  let scope = null;
  if (id) {
    const { nodes } = loadGraph();
    scope = new Set([id, ...(nodes.get(id)?.depends_on ?? [])]);
    evs = evs.filter((e) => scope.has(e.node) || scope.has(e.actor));
  }
  for (const e of evs.slice(-tail)) process.stdout.write(`${e.ts} ${String(e.type).padEnd(18)} ${String(e.node ?? e.actor ?? '').padEnd(28)} ${e.summary ?? ''}\n`);
  const qs = readQuestions().filter((q) => q.status !== 'open' && (!scope || scope.has(q.node) || scope.has(q.from)));
  if (qs.length) process.stdout.write('\nanswered questions:\n');
  for (const q of qs.sort((a, b) => a.asked_at.localeCompare(b.asked_at)).slice(-tail)) {
    process.stdout.write(`- ${q.id} (${q.node ?? q.from}): ${q.question}\n  → ${q.answer} [${q.answered_by}${q.recorded_in ? `, recorded in ${q.recorded_in}` : ', NOT YET RECORDED'}]\n`);
  }
}

function cmdWhoami() {
  const id = currentNodeId();
  const b = loadBinding();
  process.stdout.write(
    [
      `DEVTEAM_NODE=${id ?? ''}`,
      `DEVTEAM_ROLE=${currentActor() === 'planner' ? 'planner' : id ? 'worker' : 'supervisor'}`,
      `DEVTEAM_RUN=${runDir}`,
      `DEVTEAM_SUPERVISOR=${supervisorTarget()}`,
      `# repo=${repoRoot} main_checkout=${mainRoot} project=${projectDir} tmux_session=${b.tmux_session}`,
    ].join('\n') + '\n',
  );
}

function cmdBinding() {
  const b = loadBinding();
  const key = flagStr('get');
  if (key) {
    const v = b[key];
    process.stdout.write(`${v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : v}\n`);
  } else process.stdout.write(`${JSON.stringify(b, null, 2)}\n`);
}

function cmdNotes() {
  const [from, to = 'HEAD'] = positional;
  if (!from) die('usage: notes <from-tag> [<to-ref>]');
  const out = git(['log', `${from}..${to}`, '--format=%s']);
  if (out === null) die(`cannot read git log ${from}..${to}`);
  const { nodes } = loadGraph();
  const landed = new Set();
  for (const s of out.split('\n')) {
    const m = s.match(/from \S*node\/([a-z0-9-]+)$/) ?? s.match(/^([a-z][a-z0-9-]*-\d{2,}-[a-z0-9-]+):/);
    if (m && nodes.has(m[1])) landed.add(m[1]);
  }
  // A node counts as merged for these notes if it landed in this range or before it.
  const landedBy = (id) => {
    if (landed.has(id)) return true;
    const sha = mergeShaFor(id);
    return !!sha && git(['merge-base', '--is-ancestor', sha, to]) !== null;
  };
  const merged = new Map([...nodes.keys()].map((id) => [id, landedBy(id)]));
  const stories = new Map();
  for (const id of landed) for (const s of nodes.get(id).serves ?? []) (stories.get(s) ?? stories.set(s, []).get(s)).push(id);
  const completed = [];
  const advanced = [];
  for (const [s, ids] of stories) {
    const all = [...nodes.values()].filter((n) => isActive(n) && (n.serves ?? []).includes(s));
    (all.every((n) => merged.get(n.id)) ? completed : advanced).push({ s, ids, total: all.length, done: all.filter((n) => merged.get(n.id)).length });
  }
  const line = (x) => `- **${x.s}** (${x.done}/${x.total} nodes): ${x.ids.join(', ')}`;
  process.stdout.write(`## Stories completed\n\n${completed.map(line).join('\n') || '- none'}\n\n## Stories advanced\n\n${advanced.map(line).join('\n') || '- none'}\n`);
  const chores = [...landed].filter((id) => !(nodes.get(id).serves ?? []).length);
  if (chores.length) process.stdout.write(`\n## Other\n\n${chores.map((id) => `- ${id}: ${nodes.get(id).title}`).join('\n')}\n`);
}

const HELP = `devteam <command>   (put positional arguments before flags)

Graph and status
  validate                        check the graph against planning.md rules (CI gate)
  ready [--spec-ahead] [--json]   nodes that can start now
  waves [--column c] [--json]     parallel waves and the critical path
  status [--json]                 derived stage of every node, live phase, review stats

Gates
  check-node <id> [--sha s] [--title t] [--body-file f]   definition of done at an exact head
  check-pr --head-ref r --title t --body-file f [--sha s]  mechanical merge-word check (CI)

Questions
  ask --question q [--kind k] [--node id] [--options a b] [--recommendation r]
      [--default d] [--blocks ids] [--context c] [--to owner] [--head sha]
  answer <qid> "<text>" [--by owner|supervisor] [--defaulted]
  questions [--to x] [--mine] [--all] [--json]   ranked inbox
  sync-questions                  log events for answers written by hand or a dashboard
  recorded <qid> <path>           mark where an answered question's ruling was recorded

Run state and history
  heartbeat [--phase p] [--task t] [--note n] [--usd x --in n --out n --cost-source s] [--supervisor]
  event --type t [--node id] [--sha s] [--summary s] [--ref r]
  history [<id>] [--tail n]       events and answered questions, for orientation

Other
  notes <from-tag> [<to>]         story-grouped release notes
  whoami                          derived DEVTEAM_* environment
  binding [--get key]             the project's machine-readable settings

Global: --project <dir> overrides docs/devteam/project.
`;

const COMMANDS = {
  validate: cmdValidate,
  ready: cmdReady,
  waves: cmdWaves,
  status: cmdStatus,
  'check-node': cmdCheckNode,
  'check-pr': cmdCheckPr,
  ask: cmdAsk,
  answer: cmdAnswer,
  questions: cmdQuestions,
  'sync-questions': cmdSyncQuestions,
  recorded: cmdRecorded,
  heartbeat: cmdHeartbeat,
  event: cmdEvent,
  history: cmdHistory,
  notes: cmdNotes,
  whoami: cmdWhoami,
  binding: cmdBinding,
};

if (!command || command === 'help' || command === '--help') process.stdout.write(HELP);
else if (!COMMANDS[command]) die(`unknown command "${command}"\n${HELP}`);
else COMMANDS[command]();
