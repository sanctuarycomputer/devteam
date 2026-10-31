#!/usr/bin/env node
// devteam: graph, state and gate tooling. Node 20+, built-ins only.
// Usage: node docs/devteam/scripts/devteam.mjs <command> [args]. Run `help` for the list.
//
// Paths:
//   project  docs/devteam/project in the current checkout (override: --project <dir> or DEVTEAM_PROJECT)
//   run      docs/devteam/run in the MAIN checkout, shared by every worktree (override: DEVTEAM_RUN)
//
// Ticket folders (spec, plan, reviews, verification) live on each ticket's branch until it merges.
// Commands that judge a ticket read those files from git (the branch tip, or an exact SHA), so the
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

const TICKET_KINDS = ['contract', 'build', 'integration', 'chore', 'spike'];
const PHASES = ['starting', 'spec', 'plan', 'contract', 'build', 'verify', 'final-review', 'awaiting-word', 'merging', 'done', 'blocked', 'parked'];
const QUESTION_KINDS = ['owner-decision', 'one-way-door', 'clarification'];
const MESSAGE_KINDS = ['design-change', 'merge-request', 'review-request', 'slot-request', 'blocked', 'ruling', 'answer', 'info'];
const EVENT_TYPES = [
  'worker.made', 'ticket.phase', 'ticket.blocked', 'ticket.parked', 'ticket.merged', 'ticket.released',
  'question.asked', 'question.answered', 'question.defaulted',
  'review.verdict', 'word.stage', 'word.merge', 'approve.spec', 'approve.plan', 'approve.design-change',
  'ruling', 'gate.result', 'slot.granted', 'slot.released',
  'replan', 'recovery', 'defect.escaped', 'cost', 'message', 'improvement',
];
const CHORES_FEATURE = 'chores'; // reserved feature for chore and spike tickets that belong to no feature plan

// ---------- locations ----------

const repoRoot = git(['rev-parse', '--show-toplevel']) ?? process.cwd();
const commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
const mainRoot = commonDir ? path.dirname(commonDir) : repoRoot;
const devteamDir = path.join(repoRoot, 'docs', 'devteam');
const projectDir = path.resolve(flagStr('project') ?? process.env.DEVTEAM_PROJECT ?? path.join(devteamDir, 'project'));
const runDir = path.resolve(process.env.DEVTEAM_RUN ?? path.join(mainRoot, 'docs', 'devteam', 'run'));
const projectRel = path.relative(repoRoot, projectDir).split(path.sep).join('/');
const projectInRepo = !!commonDir && projectRel !== '' && !projectRel.startsWith('..') && !path.isAbsolute(projectRel);

// ---------- settings ----------

const SETTINGS_DEFAULTS = {
  tmux_session: 'devteam',
  agent_command: 'claude --dangerously-skip-permissions',
  resume_command: 'claude --continue --dangerously-skip-permissions',
  max_active_tickets: 5,
  max_active_per_component: 2,
  stale_after_minutes: 30,
  question_default_after_hours: 24,
  main_branch: 'main',
  merge_method: 'merge',
  components: {},
  shared_resources: [],
  dashboard_command: 'node docs/devteam/scripts/dashboard.mjs',
  notify: null,
  worker_denied_commands: ['gh pr merge', 'git push origin main', 'git push origin HEAD:main'],
  upstream_repo: 'sanctuarycomputer/devteam',
  upstream_check_hours: 24,
  upstream_contributions: 'ask',
  retro_every_days: 7,
  research_every_days: 7,
  improvement_budget_usd_per_week: null,
  slow_gate_minutes: 10,
};

let settingsCache;
function loadSettings() {
  if (settingsCache) return settingsCache;
  const p = path.join(projectDir, 'settings.md');
  if (!fs.existsSync(p)) return (settingsCache = { ...SETTINGS_DEFAULTS });
  const m = fs.readFileSync(p, 'utf8').match(/```json devteam\s*\n([\s\S]*?)\n```/);
  if (!m) return (settingsCache = { ...SETTINGS_DEFAULTS });
  try {
    return (settingsCache = { ...SETTINGS_DEFAULTS, ...JSON.parse(m[1]) });
  } catch (e) {
    die(`settings.md settings block is not valid JSON: ${e.message}`);
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
const TICKET_FIELDS = ['id', 'title', 'feature', 'component', 'kind', 'size', 'risk', 'serves', 'depends_on', 'contracts', 'touches', 'done_when', 'one_way_doors', 'superseded_by', 'notes'];

function loadGraph() {
  const dir = path.join(projectDir, 'graph');
  const tickets = new Map();
  const loadErrors = [];
  if (!fs.existsSync(dir)) return { tickets, loadErrors };
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    try {
      const n = readJson(path.join(dir, f));
      n.__file = f;
      tickets.set(n.id ?? f.replace(/\.json$/, ''), n);
    } catch (e) {
      loadErrors.push(`${f}: not valid JSON (${e.message})`);
    }
  }
  return { tickets, loadErrors };
}

const isActive = (n) => !n.superseded_by;

function featurePlan(feature) {
  const p = path.join(projectDir, 'features', `${feature}.md`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

function storiesForFeature(feature) {
  const text = featurePlan(feature);
  if (text === null) return null;
  // Stories are defined in section 1 only; ids elsewhere are references.
  const sec = text.match(/^##\s*1\.[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  return new Set((sec ? sec[1] : '').match(/\b[A-Z][A-Z0-9]*-S[0-9]+\b/g) ?? []);
}

const featureStatus = (feature) => featurePlan(feature)?.match(/^-?\s*Status:\s*(\S+)/m)?.[1] ?? null;

// Transitive dependency closure for every ticket.
function closures(tickets) {
  const memo = new Map();
  const visit = (id, stack = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    if (stack.has(id)) return new Set(); // cycle; reported elsewhere
    stack.add(id);
    const out = new Set();
    for (const d of tickets.get(id)?.depends_on ?? []) {
      if (!tickets.has(d)) continue;
      out.add(d);
      for (const x of visit(d, stack)) out.add(x);
    }
    stack.delete(id);
    memo.set(id, out);
    return out;
  };
  for (const id of tickets.keys()) visit(id);
  return memo;
}

function findCycle(tickets) {
  const state = new Map(); // 1 visiting, 2 done
  const stack = [];
  const dfs = (id) => {
    state.set(id, 1);
    stack.push(id);
    for (const d of tickets.get(id)?.depends_on ?? []) {
      if (!tickets.has(d)) continue;
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
  for (const id of tickets.keys()) {
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
  const b = loadSettings().main_branch;
  for (const r of [`origin/${b}`, b]) {
    if (resolveCommit(r)) return (mainRefCache = r);
  }
  return (mainRefCache = null);
}

let mainLogCache;
function mainLog() {
  if (mainLogCache) return mainLogCache;
  const ref = mainRef();
  // First-parent only: merge commits and squash commits are on it; a branch's own commits are not.
  const out = ref ? git(['log', ref, '--first-parent', '--format=%H%x09%s']) : null;
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

// The tip of a ticket's branch: the local branch (shared by every worktree) first, then origin's.
function ticketBranchRef(id) {
  for (const r of [`refs/heads/ticket/${id}`, `refs/remotes/origin/ticket/${id}`]) if (resolveCommit(r)) return r;
  return null;
}

// The commit on main that landed a ticket: a merge commit from branch ticket/<id>, a squash
// commit titled "<id>: ...", or a merge whose second parent contains the branch tip and whose
// first parent does not. (A branch merely created from main is an ancestor of main too, so
// plain ancestry is not enough.)
const mergeShaCache = new Map();
function mergeShaFor(id) {
  if (mergeShaCache.has(id)) return mergeShaCache.get(id);
  const done = (v) => (mergeShaCache.set(id, v), v);
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fromBranch = new RegExp(`from \\S*ticket/${esc}$`);
  for (const { sha, subject } of mainLog()) {
    if (fromBranch.test(subject) || subject.startsWith(`${id}:`)) return done(sha);
  }
  const ref = mainRef();
  if (!ref) return done(null);
  for (const r of [`refs/heads/ticket/${id}`, `refs/remotes/origin/ticket/${id}`]) {
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

const ticketReviews = (id, src) => reviewRecordsIn(src, `tickets/${id}/reviews`);
const featureReviews = (feature) => reviewRecordsIn(WORKTREE, `reviews/${feature}`);

// The latest record (highest pass) in each track (variant letter) for one stage.
function latestPerTrack(records, stage) {
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

const runTicketPath = (id) => path.join(runDir, 'tickets', `${id}.json`);
function readRunTicket(id) {
  try {
    return fs.existsSync(runTicketPath(id)) ? readJson(runTicketPath(id)) : null;
  } catch {
    warn(`run/tickets/${id}.json is not valid JSON; ignoring`);
    return null;
  }
}

function appendEvent(ev) {
  if (!EVENT_TYPES.includes(ev.type)) die(`unknown event type "${ev.type}" (schema/event.schema.json)`);
  fs.mkdirSync(runDir, { recursive: true });
  const line = JSON.stringify({ ts: nowIso(), ticket: null, sha: null, summary: '', ref: null, ...ev });
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
        const missing = ['id', 'kind', 'asked_at', 'question', 'status'].filter((k) => typeof q[k] !== 'string');
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

// The session:window of the pane running this command. TMUX_PANE pins it to our own pane;
// without -t, tmux reports whichever window the client happens to have active.
function tmuxHere() {
  if (!process.env.TMUX || !process.env.TMUX_PANE) return null;
  try {
    return execFileSync('tmux', ['display-message', '-p', '-t', process.env.TMUX_PANE, '#S:#W'], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

function nudge(target, message) {
  if (!target) return false;
  return tmux(['send-keys', '-t', target, '-l', message]) && tmux(['send-keys', '-t', target, 'Enter']);
}

function currentTicketId() {
  if (process.env.DEVTEAM_TICKET) return process.env.DEVTEAM_TICKET;
  const b = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  return b?.startsWith('ticket/') ? b.slice('ticket/'.length) : null;
}

// Who is running this command: a ticket id, 'planner' or 'supervisor'.
function currentActor() {
  const ticket = currentTicketId();
  if (ticket) return ticket;
  if (process.env.DEVTEAM_ROLE === 'planner') return 'planner';
  const b = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (b?.startsWith('plan/')) return 'planner';
  return 'supervisor';
}

// The supervisor's window is named 'supervisor' (bootstrap.md §4); index 0 is the fallback.
const supervisorTarget = () => process.env.DEVTEAM_SUPERVISOR ?? `${loadSettings().tmux_session}:supervisor`;

// ---------- derived status ----------

function deriveStatus(tickets) {
  const merged = new Map([...tickets.keys()].map((id) => [id, mergeShaFor(id)]));
  return [...tickets.values()].map((n) => {
    const id = n.id;
    const mergeSha = merged.get(id);
    const run = readRunTicket(id);
    const branch = ticketBranchRef(id);
    // Before merge, a ticket's files exist only on its branch; read them there.
    const src = branch && !mergeSha ? { ref: branch } : WORKTREE;
    const spec = statusOf(srcRead(src, `tickets/${id}/spec.md`));
    const plan = statusOf(srcRead(src, `tickets/${id}/plan.md`));
    const reviews = ticketReviews(id, src);
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
      feature: n.feature,
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

function reviewStats(tickets) {
  const byStage = {};
  let findings = 0;
  let wrong = 0;
  const all = [];
  for (const id of tickets.keys()) {
    const branch = ticketBranchRef(id);
    all.push(...ticketReviews(id, branch && !mergeShaFor(id) ? { ref: branch } : WORKTREE));
  }
  for (const col of new Set([...tickets.values()].map((n) => n.feature))) all.push(...featureReviews(col));
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
  const { tickets, loadErrors } = loadGraph();
  const errors = [...loadErrors];
  const warnings = [];
  const err = (id, msg) => errors.push(`${id}: ${msg}`);

  for (const [id, n] of tickets) {
    for (const k of Object.keys(n)) if (k !== '__file' && !TICKET_FIELDS.includes(k)) err(id, `unknown field "${k}"`);
    for (const k of ['id', 'title', 'feature', 'component', 'kind', 'size', 'risk', 'serves', 'depends_on', 'touches', 'done_when']) {
      if (n[k] === undefined) err(id, `missing required field "${k}"`);
    }
    if (`${n.id}.json` !== n.__file) err(id, `id does not match file name ${n.__file}`);
    if (n.id && !ID_RE.test(n.id)) err(id, 'id must be <component>-<NN>-<slug>');
    if (n.id && n.component && !n.id.startsWith(`${n.component}-`)) err(id, `id must start with its component "${n.component}-"`);
    if (n.kind && !TICKET_KINDS.includes(n.kind)) err(id, `kind must be one of ${TICKET_KINDS.join(', ')}`);
    if (n.size && !['S', 'M'].includes(n.size)) err(id, 'size must be S or M (D1: split anything larger)');
    if (n.risk && !['normal', 'high'].includes(n.risk)) err(id, 'risk must be normal or high');
    for (const s of n.serves ?? []) if (!STORY_RE.test(s)) err(id, `serves "${s}" is not a story id like SIGNIN-S1`);
    if (!Array.isArray(n.touches) || n.touches.length === 0) err(id, 'touches must list at least one path or glob');
    for (const g of n.touches ?? []) if (typeof g !== 'string' || !g.trim() || unbalancedBraces(g)) err(id, `touches entry "${g}" is empty or has unbalanced braces`);
    if (!Array.isArray(n.done_when) || n.done_when.length === 0) err(id, 'done_when must list at least one check (D5)');
    for (const d of n.done_when ?? []) if (typeof d !== 'string' || d.trim().length < 10) err(id, `done_when entry too vague: "${d}" (D5)`);
    for (const d of n.depends_on ?? []) {
      if (d === id) err(id, 'depends on itself');
      else if (!tickets.has(d)) err(id, `depends_on "${d}" does not exist (D3)`);
      else if (!isActive(tickets.get(d)) && isActive(n)) err(id, `depends_on "${d}" is superseded; depend on its replacement`);
    }
    if (n.superseded_by && !tickets.has(n.superseded_by)) err(id, `superseded_by "${n.superseded_by}" does not exist`);
    if ((n.one_way_doors ?? []).length > 0 && n.risk !== 'high') err(id, 'lists a one-way door, so risk must be high (D8)');
    if (n.feature === CHORES_FEATURE && !['chore', 'spike'].includes(n.kind)) err(id, `only chore and spike tickets may use the reserved feature "${CHORES_FEATURE}"`);
    if (isActive(n) && ['chore', 'spike'].includes(n.kind) && (n.serves ?? []).length === 0 && !n.notes) {
      err(id, `${n.kind} ticket serving no story must say why in notes (D6)`);
    }
    if (isActive(n) && !['chore', 'spike'].includes(n.kind) && (n.serves ?? []).length === 0) err(id, 'must serve at least one story (D6)');
    if (n.kind === 'contract' && !(n.contracts?.provides ?? []).length) err(id, 'contract ticket must list contracts.provides (D2)');
  }

  const cycle = findCycle(tickets);
  if (cycle) errors.push(`dependency cycle: ${cycle.join(' -> ')} (D3)`);

  // Features: stories defined and served (D6); approved plans carry approved design and graph reviews.
  const features = new Set([...tickets.values()].filter(isActive).map((n) => n.feature).filter((c) => c && c !== CHORES_FEATURE));
  for (const col of features) {
    const stories = storiesForFeature(col);
    if (!stories) {
      errors.push(`feature "${col}": project/features/${col}.md not found (chore/spike tickets outside any feature use "${CHORES_FEATURE}")`);
      continue;
    }
    const served = new Set();
    for (const n of tickets.values()) {
      if (!isActive(n) || n.feature !== col) continue;
      for (const s of n.serves ?? []) {
        if (!stories.has(s)) err(n.id, `serves "${s}", which ${col}.md section 1 does not define`);
        served.add(s);
      }
    }
    for (const s of stories) if (!served.has(s)) errors.push(`feature "${col}": story ${s} is served by no ticket (D6)`);

    // D7 (warning): a story served by more than one component should have an integration ticket.
    for (const s of stories) {
      const servers = [...tickets.values()].filter((n) => isActive(n) && (n.serves ?? []).includes(s));
      const comps = new Set(servers.filter((n) => n.kind !== 'contract').map((n) => n.component));
      if (comps.size > 1 && !servers.some((n) => n.kind === 'integration')) {
        warnings.push(`feature "${col}": story ${s} spans ${[...comps].join(', ')} but has no integration ticket (D7)`);
      }
    }

    if (featureStatus(col) === 'approved') {
      const reviews = featureReviews(col);
      for (const r of reviews) {
        if (r.verdict && !r.reviewer) errors.push(`project/reviews/${col}/${r.file}: missing "- Reviewer:" line`);
        if (r.verdict && !r.shaValid) errors.push(`project/reviews/${col}/${r.file}: verdict SHA must be the full 40-character commit SHA`);
      }
      for (const stage of ['design', 'graph']) {
        const latest = latestPerTrack(reviews, stage);
        if (!latest.length) errors.push(`feature "${col}" is approved but has no ${stage} review in project/reviews/${col}/ (planning.md P2, P5)`);
        else if (latest.some((r) => r.verdict !== 'APPROVE')) errors.push(`feature "${col}" is approved but its latest ${stage} review is not APPROVE`);
      }
    }
  }

  // D4: tickets that can run concurrently must have disjoint footprints. Merged tickets are history.
  if (!cycle) {
    const clos = closures(tickets);
    const live = [...tickets.values()].filter((n) => isActive(n) && !mergeShaFor(n.id));
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

  // Ticket folders must belong to a ticket.
  const nd = path.join(projectDir, 'tickets');
  if (fs.existsSync(nd)) {
    for (const f of fs.readdirSync(nd)) {
      if (f.startsWith('.')) continue;
      if (!tickets.has(f)) errors.push(`project/tickets/${f}/ has no ticket`);
    }
  }

  for (const w of warnings) process.stdout.write(`warning: ${w}\n`);
  for (const e of errors) process.stdout.write(`error: ${e}\n`);
  process.stdout.write(`${tickets.size} ticket(s), ${errors.length} error(s), ${warnings.length} warning(s)\n`);
  process.exit(errors.length ? 1 : 0);
}

function activeWorker(id) {
  const r = readRunTicket(id);
  return !!r && !['done', 'parked'].includes(r.phase);
}

function cmdReady() {
  const { tickets } = loadGraph();
  const merged = new Map([...tickets.keys()].map((id) => [id, mergeShaFor(id)]));
  const rows = [];
  for (const n of tickets.values()) {
    if (!isActive(n) || merged.get(n.id) || activeWorker(n.id)) continue;
    const depsMerged = (n.depends_on ?? []).every((d) => merged.get(d));
    if (depsMerged || flags['plan-ahead']) rows.push({ id: n.id, component: n.component, kind: n.kind, size: n.size, risk: n.risk, mode: depsMerged ? 'build' : 'plan-ahead' });
  }
  const b = loadSettings();
  const active = [...tickets.keys()].filter(activeWorker);
  const perComponent = {};
  for (const id of active) perComponent[tickets.get(id).component] = (perComponent[tickets.get(id).component] ?? 0) + 1;
  if (flags.json) {
    return void process.stdout.write(`${JSON.stringify({ ready: rows, active, active_per_component: perComponent, caps: { max_active_tickets: b.max_active_tickets, max_active_per_component: b.max_active_per_component } }, null, 2)}\n`);
  }
  process.stdout.write(`active workers: ${active.length}/${b.max_active_tickets}\n`);
  if (!rows.length) return void process.stdout.write('nothing ready\n');
  for (const r of rows) {
    const full = (perComponent[r.component] ?? 0) >= b.max_active_per_component ? '  (component at cap)' : '';
    process.stdout.write(`${r.mode.padEnd(10)} ${r.id}  (${r.kind}, ${r.size}, ${r.risk})${full}\n`);
  }
}

function cmdWaves() {
  const { tickets } = loadGraph();
  const col = flagStr('feature');
  const sub = new Map([...tickets].filter(([, n]) => isActive(n) && (!col || n.feature === col)));
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
  process.stdout.write(`${sub.size} ticket(s) in ${waves.length} wave(s); max parallel width ${Math.max(0, ...waves.map((w) => w.length))}\n`);
}

function cmdStatus() {
  const { tickets } = loadGraph();
  const rows = deriveStatus(tickets);
  if (flags.json) {
    return void process.stdout.write(`${JSON.stringify({ generated_at: nowIso(), tickets: rows, reviews: reviewStats(tickets) }, null, 2)}\n`);
  }
  const stale = loadSettings().stale_after_minutes;
  for (const r of rows) {
    const isStale = r.heartbeat_minutes > stale && !['done', 'parked'].includes(r.phase);
    const live = r.phase ? `  [${r.phase}${r.task ? ` ${r.task}` : ''}, ${r.heartbeat_minutes}m${isStale ? ' STALE' : ''}]` : '';
    process.stdout.write(`${r.stage.padEnd(18)} ${r.id}${live}\n`);
  }
  const s = reviewStats(tickets);
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

// Definition of done for a ticket at an exact head, reading committed files at that head.
function checkTicket(id, { sha: shaArg, title, body }) {
  const { tickets } = loadGraph();
  const n = tickets.get(id);
  const fails = [];
  if (!n) return [`no ticket ${id}`];
  if (n.superseded_by) fails.push(`ticket is superseded by ${n.superseded_by}`);
  let sha = null;
  let src = WORKTREE;
  if (commonDir) {
    sha = resolveCommit(shaArg ?? 'HEAD');
    if (!sha) return [`commit ${shaArg} not found locally (fetch it first)`];
    if (projectInRepo) src = { ref: sha };
  }
  const read = (rel) => srcRead(src, `tickets/${id}/${rel}`);

  if (statusOf(read('spec.md')) !== 'approved') fails.push('spec.md missing or not "Status: approved" (committed at this head)');
  if (statusOf(read('plan.md')) !== 'approved') fails.push('plan.md missing or not "Status: approved" (committed at this head)');
  const ver = read('verification.md');
  if (ver === null) fails.push('verification.md missing');
  else {
    const rows = ver.split('\n').filter((l) => /^\|/.test(l.trim()) && !/^\|\s*-/.test(l.trim())).length - 1;
    if (rows < (n.done_when ?? []).length) fails.push(`verification.md has ${Math.max(rows, 0)} result row(s) for ${n.done_when.length} done-when(s)`);
  }

  // Reviews: every final track that reviewed this head must end in APPROVE; enough distinct
  // reviewers must have approved it; verdicts carry full SHAs and a named reviewer.
  const reviews = ticketReviews(id, src);
  for (const r of reviews) {
    if (r.verdict && !r.shaValid) fails.push(`${r.file}: verdict SHA must be the full 40-character commit SHA`);
    if (r.verdict && !r.reviewer) fails.push(`${r.file}: missing "- Reviewer:" line; an unnamed review does not count`);
  }
  // A verdict made at commit V still holds at head H if V is an ancestor of H and the commits
  // since V only ADD new review-record files (committing the record moves the head). Editing or
  // deleting any record, or adding anything else, voids it: a dissent can't be quietly erased.
  const reviewsDir = projectInRepo ? `${projectRel}/tickets/${id}/reviews/` : null;
  const recordName = /^[a-z]+-\d+[a-z]?\.md$/;
  const holdsAt = (v) => {
    if (!sha || !v || !/^[0-9a-f]{40}$/.test(v)) return false;
    if (v === sha) return true;
    if (!reviewsDir || git(['merge-base', '--is-ancestor', v, sha]) === null) return false;
    // Check every commit, not the net diff: an add-then-delete would cancel out in a net diff.
    if ((git(['rev-list', '--merges', `${v}..${sha}`]) ?? 'x').trim()) return false;
    const since = (git(['log', '--no-renames', '--format=', '--name-status', `${v}..${sha}`]) ?? '').split('\n').filter(Boolean);
    return since.every((l) => {
      const [status, file] = l.split('\t');
      return status === 'A' && file.startsWith(reviewsDir) && recordName.test(file.slice(reviewsDir.length));
    });
  };
  const finalsAtHead = reviews.filter((r) => r.stage === 'final' && holdsAt(r.sha));
  const latest = latestPerTrack(finalsAtHead, 'final');
  if (!reviews.some((r) => r.stage === 'final')) fails.push('no final review record (reviews/final-<n>.md)');
  else if (!latest.length) fails.push(`no final review holds at this head (${sha}): a verdict holds only at its own commit, or at a later head whose only changes are newly added review records (review.md §1)`);
  for (const r of latest) if (r.verdict === 'CHANGES') fails.push(`${r.file}: latest final review at this head says CHANGES`);
  const approvers = new Set(latest.filter((r) => r.verdict === 'APPROVE' && r.reviewer && r.shaValid).map((r) => r.reviewer));
  const need = n.risk === 'high' ? 2 : 1;
  if (approvers.size < need) fails.push(`needs ${need} final APPROVE review(s) at this head from different named reviewers; found ${approvers.size}`);
  for (const r of reviews) {
    for (const f of r.findings) if (blocking(f.severity) && !disposed(f.disposition)) fails.push(`${r.file} ${f.id} (${f.severity}) has no disposition`);
  }

  // Footprint: every changed file is inside touches or the ticket's own folder (worker.md §3).
  const base = mainRef() && sha ? git(['merge-base', mainRef(), sha]) : null;
  if (commonDir && !base) fails.push(`cannot resolve main branch "${loadSettings().main_branch}" (or its merge base); footprint not checked`);
  if (base) {
    const changed = (git(['diff', '--name-only', base, sha]) ?? '').split('\n').filter(Boolean);
    const own = projectInRepo ? `${projectRel}/tickets/${id}/` : null;
    const outside = changed.filter((f) => !(own && f.startsWith(own)) && !(n.touches ?? []).some((t) => pathMatches(t, f)));
    if (outside.length) fails.push(`changes files outside touches: ${outside.slice(0, 10).join(', ')}${outside.length > 10 ? ` (+${outside.length - 10} more)` : ''}`);
  }

  if (title !== undefined && !new RegExp(`^${id.replace(/-/g, '\\-')}: \\S`).test(title)) fails.push(`PR title must start with "${id}: "`);
  if (body !== undefined) {
    const owd = oneWayDoorsSection(body);
    if (!owd.ok) fails.push(owd.why);
    else if (owd.none && (n.one_way_doors ?? []).length) fails.push('ticket lists one-way doors but the PR body says "None."; link the owner\'s answer');
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

function cmdCheckTicket() {
  const id = positional[0] ?? die('usage: check-ticket <ticket-id> [--sha <head>] [--title "<pr title>"] [--body-file <path>]');
  const sha = flagStr('sha');
  report(checkTicket(id, { sha, title: flagStr('title'), body: readBody() }), `${id} meets the definition of done at ${(resolveCommit(sha ?? 'HEAD') ?? '').slice(0, 12)}`);
}

// The automatic half of the merge word, run in CI as the required `merge-word` check (ci.md §3).
function cmdCheckPr() {
  const headRef = flagStr('head-ref') ?? die('check-pr needs --head-ref');
  const title = flagStr('title') ?? die('check-pr needs --title');
  const body = readBody() ?? die('check-pr needs --body-file');
  if (headRef.startsWith('ticket/')) {
    return report(checkTicket(headRef.slice('ticket/'.length), { sha: flagStr('sha'), title, body }), `${headRef} passes the automatic merge-word checks`);
  }
  const fails = [];
  if (!/^chore-[a-z0-9]+(-[a-z0-9]+)*: \S/.test(title)) fails.push('a PR that is not from a ticket/<id> branch must be titled "chore-<slug>: <summary>"');
  const owd = oneWayDoorsSection(body);
  if (!owd.ok) fails.push(owd.why);
  report(fails, `${headRef} passes the automatic merge-word checks`);
}

function stampId(prefix, from) {
  const d = new Date().toISOString().replace(/[-:.]/g, '').replace(/Z$/, ''); // YYYYMMDDTHHMMSSmmm
  const slug = String(from).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'anon';
  return `${prefix}-${d.slice(0, 8)}-${d.slice(9, 15)}${prefix === 'm' ? d.slice(15, 18) : ''}-${slug}`;
}

// ---------- questions to the owner (supervisor only) ----------

function cmdAsk() {
  if (currentActor() !== 'supervisor') {
    die('only the supervisor asks the owner. Workers and planners message the supervisor: devteam.mjs send supervisor "<text>" --kind <kind> (process/messages.md)');
  }
  const q = flagStr('question') ?? die('ask needs --question');
  const kind = flagStr('kind') ?? 'owner-decision';
  if (!QUESTION_KINDS.includes(kind)) die(`--kind must be one of ${QUESTION_KINDS.join(', ')}`);
  if (flags.default === true) die('--default needs a value');
  const def = flagStr('default') ?? null;
  if (kind === 'one-way-door' && def) die('one-way doors never have a default (questions.md §3)');
  let id = stampId('q', 'supervisor');
  for (let i = 2; fs.existsSync(path.join(runDir, 'questions', `${id}.json`)); i++) id = `${stampId('q', 'supervisor')}-${i}`;
  const question = {
    id,
    kind,
    ticket: flagStr('ticket') ?? null,
    asked_at: nowIso(),
    question: q,
    context: flagStr('context') ?? '',
    options: asList(flags.options),
    recommendation: flagStr('recommendation') ?? '',
    default: def,
    blocks: asList(flags.blocks),
    status: 'open',
    answer: null,
    answered_by: null,
    answered_at: null,
    recorded_in: null,
  };
  writeJson(path.join(runDir, 'questions', `${id}.json`), question);
  appendEvent({ type: 'question.asked', actor: 'supervisor', ticket: question.ticket, summary: q.slice(0, 280), ref: `run/questions/${id}.json` });
  process.stdout.write(`${id}\n`);
}

// The owner answers from the main checkout (or a dashboard writes the file; see sync-questions).
// The supervisor may only apply a question's default.
function cmdAnswer() {
  const [id, ...rest] = positional;
  if (!id || (!rest.length && !flags.defaulted)) die('usage: answer <question-id> "<answer>"   (owner)  |  answer <question-id> --defaulted   (supervisor)');
  if (currentActor() !== 'supervisor') die('questions are answered from the main checkout, not from a worker or planner session');
  const p = path.join(runDir, 'questions', `${id}.json`);
  if (!fs.existsSync(p)) die(`no question ${id}`);
  const q = readJson(p);
  if (q.status !== 'open') die(`${id} is already ${q.status}`);
  if (flags.defaulted && !q.default) die(`${id} has no default to apply`);
  q.answer = flags.defaulted ? q.default : rest.join(' ');
  q.answered_by = flags.defaulted ? 'supervisor (default)' : 'owner';
  q.answered_at = nowIso();
  q.status = flags.defaulted ? 'defaulted' : 'answered';
  writeJson(p, q);
  appendEvent({ type: flags.defaulted ? 'question.defaulted' : 'question.answered', actor: flags.defaulted ? 'supervisor' : 'owner', ticket: q.ticket, summary: q.answer.slice(0, 280), ref: `run/questions/${id}.json` });
  if (!flags.defaulted) safeNudge(supervisorTarget(), `[devteam answer ${id} from owner] ${q.answer.replace(/\s+/g, ' ').slice(0, 400)}`);
  process.stdout.write(`answered ${id}\n`);
}

// For answers written by hand or by a dashboard: log the missing event and tell the supervisor.
function cmdSyncQuestions() {
  const logged = new Set(readEvents().filter((e) => /^question\.(answered|defaulted)$/.test(e.type)).map((e) => e.ref));
  let n = 0;
  for (const q of readQuestions()) {
    const ref = `run/questions/${q.id}.json`;
    if (!['answered', 'defaulted'].includes(q.status) || logged.has(ref)) continue;
    appendEvent({ type: q.status === 'defaulted' ? 'question.defaulted' : 'question.answered', actor: 'owner', ticket: q.ticket, summary: (q.answer ?? '').slice(0, 280), ref });
    safeNudge(supervisorTarget(), `[devteam answer ${q.id} from owner] ${(q.answer ?? '').replace(/\s+/g, ' ').slice(0, 400)}`);
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

function rankQuestions(qs, tickets) {
  const sub = new Map([...tickets].filter(([, n]) => isActive(n)));
  const crit = findCycle(sub) ? new Set() : new Set(criticalPath(sub).path);
  const score = (q) => {
    const tier = ['one-way-door', 'owner-decision'].includes(q.kind) ? 1000 : 0;
    const blocks = (q.blocks ?? []).reduce((s, id) => s + (crit.has(id) ? 3 : 1), 0);
    return tier + blocks * 10;
  };
  return [...qs].sort((a, b) => score(b) - score(a) || a.asked_at.localeCompare(b.asked_at));
}

function cmdQuestions() {
  const { tickets } = loadGraph();
  let qs = readQuestions();
  if (!flags.all) qs = qs.filter((q) => q.status === 'open');
  qs = rankQuestions(qs, tickets);
  if (flags.json) return void process.stdout.write(`${JSON.stringify(qs, null, 2)}\n`);
  if (!qs.length) return void process.stdout.write('no questions\n');
  for (const q of qs) {
    process.stdout.write(`${q.id}  [${q.kind}, ${q.status}]${q.blocks?.length ? ` blocks ${q.blocks.join(',')}` : ''}\n  ${q.question}\n`);
    if (q.recommendation) process.stdout.write(`  recommend: ${q.recommendation}\n`);
    if (q.answer) process.stdout.write(`  answer (${q.answered_by}): ${q.answer}\n`);
  }
}

// ---------- session-to-session messages ----------

// The name other sessions use to reach me: 'supervisor', a ticket id, or a planner's window name.
function myAddress() {
  const actor = currentActor();
  if (actor !== 'planner') return actor;
  const win = tmuxHere()?.split(':').pop();
  if (win) return win;
  const b = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  return b?.startsWith('plan/') ? `plan-${b.slice('plan/'.length)}` : 'planner';
}

function addressTarget(to) {
  return to === 'supervisor' ? supervisorTarget() : `${loadSettings().tmux_session}:${to}`;
}

// Resolve a session:window target exactly (tmux's own lookup is too forgiving) and check that an
// agent, not a bare shell, is running there. Typing a message into a shell would execute it.
const SHELLS = new Set(['bash', 'zsh', 'sh', 'fish', 'dash', 'ksh', 'tcsh', 'csh', 'login']);
function resolvePane(target) {
  const i = target.lastIndexOf(':');
  const [session, win] = i === -1 ? [target, '0'] : [target.slice(0, i), target.slice(i + 1)];
  let out;
  try {
    // tmux rewrites tabs in format output, so separate with a space (window names here have none).
    out = execFileSync('tmux', ['list-windows', '-t', session, '-F', '#{window_index} #{window_name}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return { problem: `no tmux session "${session}"` };
  }
  const rows = out.split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf(' ')), l.slice(l.indexOf(' ') + 1)]);
  let row = rows.find(([idx, name]) => name === win || idx === win);
  if (!row && win === 'supervisor') row = rows.find(([idx]) => idx === '0');
  if (!row) return { problem: `no tmux window "${win}" in session "${session}"; is that session running?` };
  const exact = `${session}:${row[0]}`;
  let info = '';
  try {
    info = execFileSync('tmux', ['display-message', '-p', '-t', exact, '#{pane_dead} #{pane_current_command}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return { problem: `cannot inspect ${exact}` };
  }
  const [dead, cmd = ''] = info.split(' ');
  if (dead === '1') return { problem: `the pane in ${exact} has exited` };
  if (SHELLS.has(cmd.replace(/^-/, ''))) return { problem: `no agent is running in ${exact} (it is at a ${cmd} prompt); resume it first` };
  return { target: exact };
}

// Type a notice into a pane only if an agent is running there; otherwise warn.
function safeNudge(target, line) {
  const { target: exact, problem } = resolvePane(target);
  if (problem) {
    warn(`not delivered to ${target}: ${problem}`);
    return false;
  }
  return nudge(exact, line);
}

const MESSAGE_MAX = 600;

function cmdSend() {
  const [to, ...rest] = positional;
  const text = rest.join(' ').replace(/\s+/g, ' ').trim();
  if (!to || !text) die('usage: send <supervisor|ticket-id|plan-<feature>> "<text>" [--kind k] [--re m-…] [--sha s] [--ticket id]');
  if (text.length > MESSAGE_MAX) die(`messages are one line of at most ${MESSAGE_MAX} characters; put detail in a file and reference its path`);
  const kind = flagStr('kind') ?? 'info';
  if (!MESSAGE_KINDS.includes(kind)) die(`--kind must be one of ${MESSAGE_KINDS.join(', ')}`);
  const from = myAddress();
  // P8: decisions come only from the supervisor.
  if (['ruling', 'answer'].includes(kind) && from !== 'supervisor') die(`only the supervisor sends ${kind} messages (messages.md §2)`);
  const { target, problem } = resolvePane(addressTarget(to));
  if (problem) die(`cannot message "${to}": ${problem}`);
  const sha = flagStr('sha') ?? (kind === 'merge-request' ? git(['rev-parse', 'HEAD']) : null);
  const re = flagStr('re') ?? null;
  if (re && !readEvents().some((e) => e.type === 'message' && e.id === re)) warn(`--re ${re} matches no logged message`);
  const id = stampId('m', from);
  const line = `[devteam ${kind} ${id} from ${from}${re ? ` re ${re}` : ''}${sha ? ` @ ${sha}` : ''}] ${text}`;
  if (!nudge(target, line)) die(`could not type into ${target}`);
  appendEvent({ type: 'message', actor: from, to, kind, id, re, ticket: flagStr('ticket') ?? currentTicketId() ?? (/^[a-z][a-z0-9-]*-\d{2,}-/.test(to) ? to : null), sha, summary: text.slice(0, 280) });
  process.stdout.write(`${id}\n`);
}

function cmdMessages() {
  const me = flagStr('to') ?? myAddress();
  const tail = Number(flagStr('tail') ?? 50);
  const all = readEvents().filter((e) => e.type === 'message');
  const replied = new Set(all.map((e) => e.re).filter(Boolean));
  let mine = all.filter((e) => e.to === me);
  if (flags.open) mine = mine.filter((e) => !replied.has(e.id) && !['info', 'ruling', 'answer'].includes(e.kind));
  mine = mine.slice(-tail);
  if (flags.json) return void process.stdout.write(`${JSON.stringify(mine, null, 2)}\n`);
  if (!mine.length) return void process.stdout.write(flags.open ? 'no open messages\n' : 'no messages\n');
  for (const e of mine) process.stdout.write(`${e.ts} ${e.id} [${e.kind}] from ${e.actor}${e.re ? ` re ${e.re}` : ''}${e.sha ? ` @ ${e.sha.slice(0, 12)}` : ''}: ${e.summary}\n`);
}

function cmdHeartbeat() {
  const supervisor = !!flags.supervisor;
  const id = supervisor ? 'supervisor' : (currentTicketId() ?? die('heartbeat needs DEVTEAM_TICKET or a ticket/<id> branch'));
  const phase = flagStr('phase');
  if (phase !== undefined && !PHASES.includes(phase)) die(`--phase must be one of ${PHASES.join(', ')}`);
  const p = supervisor ? path.join(runDir, 'supervisor.json') : runTicketPath(id);
  const prev = (supervisor ? (fs.existsSync(p) ? readJson(p) : null) : readRunTicket(id)) ?? {};
  const next = { ...prev, id, heartbeat_at: nowIso() };
  const session = tmuxHere() ?? prev.session;
  if (!supervisor) {
    next.phase = phase ?? prev.phase ?? 'starting';
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
  // A cost sample charges the spend since the last sample to the phase that was running then.
  if (next.cost && (next.cost.usd !== prev.cost?.usd || next.cost.input_tokens !== prev.cost?.input_tokens)) {
    appendEvent({
      type: 'cost', actor: id, ticket: supervisor ? null : id, phase: supervisor ? 'supervisor' : (prev.phase ?? next.phase),
      usd: next.cost.usd, input_tokens: next.cost.input_tokens, output_tokens: next.cost.output_tokens,
      summary: `cumulative $${next.cost.usd} (${next.cost.source})`,
    });
  }
  if (!supervisor && next.phase !== prev.phase) {
    appendEvent({ type: 'ticket.phase', actor: id, ticket: id, sha: next.head_sha, summary: `${prev.phase ?? 'none'} -> ${next.phase}${next.note ? `: ${next.note}` : ''}` });
  }
  process.stdout.write(`heartbeat ${id}${supervisor ? '' : ` ${next.phase}`}\n`);
}

function cmdEvent() {
  const type = flagStr('type') ?? die('event needs --type (see schema/event.schema.json)');
  appendEvent({
    type,
    actor: flagStr('actor') ?? currentActor(),
    ticket: flagStr('ticket') ?? currentTicketId(),
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
    const { tickets } = loadGraph();
    scope = new Set([id, ...(tickets.get(id)?.depends_on ?? [])]);
    evs = evs.filter((e) => scope.has(e.ticket) || scope.has(e.actor) || scope.has(e.to));
  }
  for (const e of evs.slice(-tail)) {
    const who = e.type === 'message' ? `${e.actor} -> ${e.to} [${e.kind}]` : String(e.ticket ?? e.actor ?? '');
    process.stdout.write(`${e.ts} ${String(e.type).padEnd(18)} ${who.padEnd(28)} ${e.summary ?? ''}\n`);
  }
  const qs = readQuestions().filter((q) => q.status !== 'open' && (!scope || scope.has(q.ticket)));
  if (qs.length) process.stdout.write('\nanswered questions:\n');
  for (const q of qs.sort((a, b) => a.asked_at.localeCompare(b.asked_at)).slice(-tail)) {
    process.stdout.write(`- ${q.id}${q.ticket ? ` (${q.ticket})` : ''}: ${q.question}\n  → ${q.answer} [${q.answered_by}${q.recorded_in ? `, recorded in ${q.recorded_in}` : ', NOT YET RECORDED'}]\n`);
  }
}

function cmdWhoami() {
  const id = currentTicketId();
  const b = loadSettings();
  process.stdout.write(
    [
      `DEVTEAM_TICKET=${id ?? ''}`,
      `DEVTEAM_ROLE=${currentActor() === 'planner' ? 'planner' : id ? 'worker' : 'supervisor'}`,
      `DEVTEAM_RUN=${runDir}`,
      `DEVTEAM_SUPERVISOR=${supervisorTarget()}`,
      `# repo=${repoRoot} main_checkout=${mainRoot} project=${projectDir} tmux_session=${b.tmux_session}`,
    ].join('\n') + '\n',
  );
}

function cmdSettings() {
  const b = loadSettings();
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
  const { tickets } = loadGraph();
  const landed = new Set();
  for (const s of out.split('\n')) {
    const m = s.match(/from \S*ticket\/([a-z0-9-]+)$/) ?? s.match(/^([a-z][a-z0-9-]*-\d{2,}-[a-z0-9-]+):/);
    if (m && tickets.has(m[1])) landed.add(m[1]);
  }
  // A ticket counts as merged for these notes if it landed in this range or before it.
  const landedBy = (id) => {
    if (landed.has(id)) return true;
    const sha = mergeShaFor(id);
    return !!sha && git(['merge-base', '--is-ancestor', sha, to]) !== null;
  };
  const merged = new Map([...tickets.keys()].map((id) => [id, landedBy(id)]));
  const stories = new Map();
  for (const id of landed) for (const s of tickets.get(id).serves ?? []) (stories.get(s) ?? stories.set(s, []).get(s)).push(id);
  const completed = [];
  const advanced = [];
  for (const [s, ids] of stories) {
    const all = [...tickets.values()].filter((n) => isActive(n) && (n.serves ?? []).includes(s));
    (all.every((n) => merged.get(n.id)) ? completed : advanced).push({ s, ids, total: all.length, done: all.filter((n) => merged.get(n.id)).length });
  }
  const line = (x) => `- **${x.s}** (${x.done}/${x.total} tickets): ${x.ids.join(', ')}`;
  process.stdout.write(`## Stories completed\n\n${completed.map(line).join('\n') || '- none'}\n\n## Stories advanced\n\n${advanced.map(line).join('\n') || '- none'}\n`);
  const chores = [...landed].filter((id) => !(tickets.get(id).serves ?? []).length);
  if (chores.length) process.stdout.write(`\n## Other\n\n${chores.map((id) => `- ${id}: ${tickets.get(id).title}`).join('\n')}\n`);
}

// ---------- metrics (process/improvement.md §2) ----------

const median = (xs) => {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const hours = (ms) => (ms === null ? null : +(ms / 3600000).toFixed(1));

// ---------- gate runs (timing, pass/fail, tests) ----------

const gatesLog = () => path.join(runDir, 'gates.jsonl');

// Minimal JUnit XML reader: each <testcase> with its time and whether it failed.
function readJunit(file) {
  if (!file || !fs.existsSync(file)) return [];
  const xml = fs.readFileSync(file, 'utf8');
  const out = [];
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const m of xml.matchAll(re)) {
    const attr = (k) => m[1].match(new RegExp(`\\b${k}="([^"]*)"`))?.[1] ?? '';
    const name = [attr('classname'), attr('name')].filter(Boolean).join(' › ');
    out.push({ name, ms: Math.round(Number(attr('time') || 0) * 1000), failed: /<(failure|error)\b/.test(m[3] ?? '') });
  }
  return out;
}

function cmdGate() {
  const dash = argv.indexOf('--');
  const name = positional[0];
  if (!name || dash === -1 || dash === argv.length - 1) die('usage: gate <name> [--junit <report.xml>] -- <command> [args…]');
  const cmd = argv.slice(dash + 1);
  const started = Date.now();
  let ok = true;
  try {
    execFileSync(cmd[0], cmd.slice(1), { stdio: 'inherit' });
  } catch {
    ok = false;
  }
  const ms = Date.now() - started;
  const tests = readJunit(flagStr('junit'));
  const keep = [...tests.filter((t) => t.failed), ...tests.filter((t) => !t.failed).sort((a, b) => b.ms - a.ms).slice(0, 20)];
  const sha = git(['rev-parse', 'HEAD']);
  const rec = { ts: nowIso(), gate: name, ticket: currentTicketId(), sha, ok, ms, tests_total: tests.length, tests: keep };
  fs.mkdirSync(runDir, { recursive: true });
  fs.appendFileSync(gatesLog(), `${JSON.stringify(rec)}\n`);
  appendEvent({ type: 'gate.result', actor: currentActor(), ticket: rec.ticket, sha, gate: name, ok, ms, summary: `${name} ${ok ? 'passed' : 'failed'} in ${(ms / 1000).toFixed(1)}s` });
  process.stderr.write(`devteam: gate ${name} ${ok ? 'passed' : 'FAILED'} in ${(ms / 1000).toFixed(1)}s\n`);
  process.exit(ok ? 0 : 1);
}

function readGateRuns(since) {
  if (!fs.existsSync(gatesLog())) return [];
  return fs.readFileSync(gatesLog(), 'utf8').split('\n').filter(Boolean).flatMap((l) => {
    try {
      const r = JSON.parse(l);
      return Date.parse(r.ts) >= since ? [r] : [];
    } catch {
      return [];
    }
  });
}

function gateStats(runs) {
  const byGate = new Map();
  for (const r of runs) (byGate.get(r.gate) ?? byGate.set(r.gate, []).get(r.gate)).push(r);
  const gates = [];
  const flakyGates = [];
  for (const [g, rs] of byGate) {
    const bySha = new Map();
    for (const r of rs) (bySha.get(r.sha) ?? bySha.set(r.sha, []).get(r.sha)).push(r);
    const flakyShas = [...bySha.entries()].filter(([, x]) => x.some((r) => r.ok) && x.some((r) => !r.ok)).map(([sha]) => sha);
    if (flakyShas.length) flakyGates.push({ gate: g, commits: flakyShas.length });
    gates.push({ gate: g, runs: rs.length, fail_rate: +(rs.filter((r) => !r.ok).length / rs.length).toFixed(2), median_seconds: +(median(rs.map((r) => r.ms)) / 1000).toFixed(1), max_seconds: +(Math.max(...rs.map((r) => r.ms)) / 1000).toFixed(1) });
  }
  // A test that failed in a run, at a commit where the same gate later passed, is flaky.
  const flakyTests = new Map();
  const testMs = new Map();
  for (const r of runs) {
    for (const t of r.tests ?? []) {
      if (!t.failed) (testMs.get(t.name) ?? testMs.set(t.name, []).get(t.name)).push(t.ms);
      if (t.failed && runs.some((o) => o !== r && o.gate === r.gate && o.sha === r.sha && o.ok && Date.parse(o.ts) >= Date.parse(r.ts))) {
        flakyTests.set(t.name, (flakyTests.get(t.name) ?? 0) + 1);
      }
    }
  }
  return {
    gates: gates.sort((a, b) => b.median_seconds - a.median_seconds),
    flaky_gates: flakyGates,
    flaky_tests: [...flakyTests.entries()].sort((a, b) => b[1] - a[1]).map(([name, times]) => ({ name, times })),
    slowest_tests: [...testMs.entries()].map(([name, xs]) => ({ name, median_seconds: +(median(xs) / 1000).toFixed(1) })).sort((a, b) => b.median_seconds - a.median_seconds).slice(0, 10),
  };
}

function collectMetrics(since) {
  const { tickets } = loadGraph();
  const settings = loadSettings();
  const now = Date.now();
  const events = readEvents().filter((e) => Date.parse(e.ts) >= since);

  // Cycle time: first worker.made for a ticket -> its merge commit's time.
  const started = new Map();
  for (const e of events) if (e.type === 'worker.made' && e.ticket && !started.has(e.ticket)) started.set(e.ticket, Date.parse(e.ts));
  const cycles = [];
  for (const id of tickets.keys()) {
    const sha = mergeShaFor(id);
    if (!sha) continue;
    const mergedAt = Date.parse(git(['show', '-s', '--format=%cI', sha]) ?? '');
    if (Number.isNaN(mergedAt) || mergedAt < since) continue;
    if (started.has(id)) cycles.push({ id, ms: mergedAt - started.get(id) });
  }
  cycles.sort((a, b) => b.ms - a.ms);

  // Time in each phase, from consecutive ticket.phase events ("<prev> -> <next>"); the current
  // phase of a live ticket counts up to now.
  const phaseMs = {};
  const phaseNow = new Map(); // ticket -> { phase, sinceMs }
  const byTicket = new Map();
  for (const e of events) if (e.type === 'ticket.phase' && e.ticket) (byTicket.get(e.ticket) ?? byTicket.set(e.ticket, []).get(e.ticket)).push(e);
  for (const [id, evs] of byTicket) {
    for (let i = 0; i < evs.length; i++) {
      const phase = evs[i].summary?.match(/-> ([a-z-]+)/)?.[1];
      if (!phase) continue;
      const endMs = i + 1 < evs.length ? Date.parse(evs[i + 1].ts) : (['done', 'parked'].includes(phase) ? Date.parse(evs[i].ts) : now);
      phaseMs[phase] = (phaseMs[phase] ?? 0) + (endMs - Date.parse(evs[i].ts));
      if (i === evs.length - 1) phaseNow.set(id, { phase, sinceMs: Date.parse(evs[i].ts) });
    }
  }

  // Cost in each phase: each cost sample's increase over the previous sample for the same session.
  const phaseUsd = {};
  const ticketUsd = {};
  const lastUsd = new Map();
  for (const e of events.filter((x) => x.type === 'cost')) {
    const key = e.ticket ?? e.actor;
    const delta = Math.max(0, (e.usd ?? 0) - (lastUsd.get(key) ?? 0));
    lastUsd.set(key, e.usd ?? 0);
    phaseUsd[e.phase ?? 'unknown'] = (phaseUsd[e.phase ?? 'unknown'] ?? 0) + delta;
    ticketUsd[key] = (ticketUsd[key] ?? 0) + delta;
  }
  const mergedIds = new Set(cycles.map((c) => c.id));
  const mergedCosts = [...mergedIds].filter((id) => ticketUsd[id] !== undefined).map((id) => ticketUsd[id]);

  // Coordination: reply time for messages that expect one; owner question answer time.
  const msgs = events.filter((e) => e.type === 'message');
  const replies = new Map();
  for (const m of msgs) if (m.re && !replies.has(m.re)) replies.set(m.re, Date.parse(m.ts));
  const expecting = msgs.filter((m) => !['info', 'ruling', 'answer'].includes(m.kind));
  const openMsgs = expecting.filter((m) => !replies.has(m.id));
  const msgWaits = expecting.filter((m) => replies.has(m.id)).map((m) => replies.get(m.id) - Date.parse(m.ts));
  const qs = readQuestions().filter((q) => Date.parse(q.asked_at) >= since);
  const qWaits = qs.filter((q) => q.answered_at).map((q) => Date.parse(q.answered_at) - Date.parse(q.asked_at));
  const openQs = qs.filter((q) => q.status === 'open');

  const reviews = reviewStats(tickets);
  const gates = gateStats(readGateRuns(since));
  const round = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +v.toFixed(2)]));

  const m = {
    since: since ? new Date(since).toISOString() : null,
    tickets_merged: cycles.length,
    cycle_hours: { median: hours(median(cycles.map((c) => c.ms))), slowest: cycles.slice(0, 5).map((c) => ({ id: c.id, hours: hours(c.ms) })) },
    phase_hours: Object.fromEntries(Object.entries(round(phaseMs)).map(([k, v]) => [k, hours(v)])),
    phase_usd: round(phaseUsd),
    cost: { usd_total: +Object.values(ticketUsd).reduce((a, b) => a + b, 0).toFixed(2), usd_per_merged_ticket: mergedCosts.length ? +(mergedCosts.reduce((a, b) => a + b, 0) / mergedCosts.length).toFixed(2) : null, by_ticket: round(ticketUsd) },
    reviews,
    gates,
    messages: { expecting_reply: expecting.length, still_open: openMsgs.length, median_reply_minutes: msgWaits.length ? +(median(msgWaits) / 60000).toFixed(1) : null },
    owner_questions: { asked: qs.length, open: openQs.length, median_answer_hours: hours(median(qWaits)), oldest_open_hours: openQs.length ? hours(now - Math.min(...openQs.map((q) => Date.parse(q.asked_at)))) : null },
    escaped_defects: events.filter((e) => e.type === 'defect.escaped').length,
  };

  // Findings: inefficiencies and blockers, each with a suggested next step.
  const f = [];
  const add = (severity, kind, subject, detail, suggestion) => f.push({ severity, kind, subject, detail, suggestion });
  for (const g of gates.flaky_gates) add('high', 'flaky-gate', g.gate, `failed then passed at the same commit ${g.commits} time(s)`, 'find the flaky tests (run with --junit) and fix or quarantine them; a flake costs a full re-run every time');
  for (const t of gates.flaky_tests.slice(0, 10)) add('high', 'flaky-test', t.name, `failed then passed at the same commit ${t.times} time(s)`, 'make it deterministic (time, order, shared state, network) or quarantine it with a ticket to fix');
  const slowGate = settings.slow_gate_minutes ?? 10;
  for (const g of gates.gates.filter((x) => x.median_seconds >= slowGate * 60)) add('medium', 'slow-gate', g.gate, `median ${(g.median_seconds / 60).toFixed(1)} min over ${g.runs} run(s)`, 'run it in parallel shards, cache dependencies, or split fast checks from slow ones');
  for (const t of gates.slowest_tests.slice(0, 5).filter((x) => x.median_seconds >= 10)) add('low', 'slow-test', t.name, `median ${t.median_seconds}s`, 'mock the slow dependency or move it to an integration suite');
  const totalPhase = Object.values(phaseMs).reduce((a, b) => a + b, 0);
  const [topPhase, topMs] = Object.entries(phaseMs).filter(([k]) => !['done', 'parked'].includes(k)).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (topPhase && totalPhase && topMs / totalPhase > 0.4) add('medium', 'phase-hotspot', topPhase, `${Math.round((100 * topMs) / totalPhase)}% of all ticket time`, 'look at why tickets sit here: waiting on reviews, slots, gates or answers');
  const totalUsd = Object.values(phaseUsd).reduce((a, b) => a + b, 0);
  const [costPhase, costUsd] = Object.entries(phaseUsd).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (costPhase && totalUsd && costUsd / totalUsd > 0.5) add('medium', 'cost-hotspot', costPhase, `${Math.round((100 * costUsd) / totalUsd)}% of spend ($${costUsd.toFixed(2)})`, 'check context size and model choice for this phase; route routine steps to a cheaper model');
  for (const [id, p] of phaseNow) {
    const h = (now - p.sinceMs) / 3600000;
    if (p.phase === 'blocked' && h >= 1) add('high', 'blocked', id, `blocked for ${h.toFixed(1)}h`, 'answer its message, re-plan, or park it');
    if (p.phase === 'awaiting-word' && h >= 1) add('medium', 'waiting-on-supervisor', id, `waiting for the merge word for ${h.toFixed(1)}h`, 'verify and merge, or say what is missing');
  }
  for (const id of tickets.keys()) {
    const run = readRunTicket(id);
    const age = run?.heartbeat_at ? (now - Date.parse(run.heartbeat_at)) / 60000 : null;
    if (run && !['done', 'parked'].includes(run.phase) && age > (settings.stale_after_minutes ?? 30)) add('high', 'stale-worker', id, `no heartbeat for ${Math.round(age)} min (phase ${run.phase})`, 'check its pane; recover it (supervisor.md §11)');
  }
  for (const msg of openMsgs.filter((x) => now - Date.parse(x.ts) > 30 * 60000)) add('medium', 'unanswered-message', msg.id, `${msg.kind} from ${msg.actor}, ${Math.round((now - Date.parse(msg.ts)) / 60000)} min old`, `reply with --re ${msg.id}`);
  for (const q of openQs.filter((x) => now - Date.parse(x.asked_at) > (settings.question_default_after_hours ?? 24) * 3600000)) add('high', 'owner-question-waiting', q.id, q.question.slice(0, 120), q.default ? 'apply its default' : 'remind the owner; it blocks work');
  for (const [id, n] of Object.entries(reviewPasses(tickets)).filter(([, n]) => n >= 3)) add('medium', 'review-churn', id, `${n} final review passes`, 'the ticket may be too big or under-specified; consider re-planning it');
  const ready = [...tickets.values()].filter((t) => isActive(t) && !mergeShaFor(t.id) && !activeWorker(t.id) && (t.depends_on ?? []).every((d) => mergeShaFor(d)));
  const active = [...tickets.keys()].filter(activeWorker).length;
  if (ready.length && active < settings.max_active_tickets) add('medium', 'idle-capacity', `${ready.length} ready`, `${active}/${settings.max_active_tickets} workers active`, `make workers for: ${ready.slice(0, 5).map((t) => t.id).join(', ')}`);
  if (m.escaped_defects) add('high', 'escaped-defects', `${m.escaped_defects}`, 'defects found after merge', 'retro: which review or gate should have caught each one');
  const order = { high: 0, medium: 1, low: 2 };
  m.findings = f.sort((a, b) => order[a.severity] - order[b.severity]);
  return m;
}

// Highest final-review pass number per ticket (from the branch before merge, main after).
function reviewPasses(tickets) {
  const out = {};
  for (const id of tickets.keys()) {
    const branch = ticketBranchRef(id);
    const finals = ticketReviews(id, branch && !mergeShaFor(id) ? { ref: branch } : WORKTREE).filter((r) => r.stage === 'final');
    if (finals.length) out[id] = Math.max(...finals.map((r) => r.pass));
  }
  return out;
}

function sinceFlag() {
  const since = flagStr('since') ? Date.parse(flagStr('since')) : 0;
  if (Number.isNaN(since)) die('--since must be a date, e.g. 2026-10-01');
  return since;
}

function cmdMetrics() {
  const m = collectMetrics(sinceFlag());
  if (flags.json) return void process.stdout.write(`${JSON.stringify(m, null, 2)}\n`);
  const kv = (o, unit = '') => Object.entries(o).map(([k, v]) => `${k} ${unit}${v}`).join(', ') || '-';
  const lines = [
    `since: ${m.since ?? 'the beginning'}`,
    `tickets merged: ${m.tickets_merged}; median cycle ${m.cycle_hours.median ?? '-'}h; slowest ${m.cycle_hours.slowest.map((c) => `${c.id} ${c.hours}h`).join(', ') || '-'}`,
    `time by phase (h): ${kv(m.phase_hours)}`,
    `cost by phase: ${kv(m.phase_usd, '$')}; total $${m.cost.usd_total}; per merged ticket ${m.cost.usd_per_merged_ticket === null ? '-' : `$${m.cost.usd_per_merged_ticket}`}`,
    `gates (median): ${m.gates.gates.map((g) => `${g.gate} ${g.median_seconds}s (fail ${Math.round(g.fail_rate * 100)}%)`).join(', ') || '- (run gates through `devteam.mjs gate`)'}`,
    `first-pass rejection: ${Object.entries(m.reviews.by_stage).map(([k, v]) => `${k} ${v.rejected}/${v.first_passes}`).join(', ') || '-'}; false positives ${m.reviews.false_positive_rate ?? '-'}`,
    `messages: ${m.messages.still_open} of ${m.messages.expecting_reply} awaiting reply; median reply ${m.messages.median_reply_minutes ?? '-'} min`,
    `owner questions: ${m.owner_questions.open} open of ${m.owner_questions.asked}; median answer ${m.owner_questions.median_answer_hours ?? '-'}h`,
    `escaped defects: ${m.escaped_defects}`,
    '',
    m.findings.length ? 'findings:' : 'findings: none',
    ...m.findings.map((x) => `  [${x.severity}] ${x.kind}: ${x.subject} (${x.detail}) -> ${x.suggestion}`),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

// ---------- progress (burn-up, board, widgets) ----------

// Expected release per story, from each feature plan's section 6 table: | <STORY> | <release> |
function releaseMap(feature) {
  const text = featurePlan(feature);
  const sec = text?.match(/^##\s*6\.[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m)?.[1] ?? '';
  const out = {};
  for (const row of sec.split('\n')) {
    const cells = tableCells(row);
    if (cells.length >= 2 && STORY_RE.test(cells[0]) && /^v\d/.test(cells[1])) out[cells[0]] = cells[1];
  }
  return out;
}

const firstAdded = (rel) => {
  const out = git(['log', '--diff-filter=A', '--format=%cI', '--', rel]);
  return out ? out.split('\n').filter(Boolean).pop() : null;
};

function collectProgress(tickets, status) {
  const sub = new Map([...tickets].filter(([, t]) => isActive(t)));
  const level = new Map();
  if (!findCycle(sub)) {
    const lvl = (id) => {
      if (level.has(id)) return level.get(id);
      const deps = (sub.get(id).depends_on ?? []).filter((d) => sub.has(d));
      const v = deps.length ? 1 + Math.max(...deps.map(lvl)) : 0;
      level.set(id, v);
      return v;
    };
    for (const id of sub.keys()) lvl(id);
  }
  const byId = new Map(status.map((r) => [r.id, r]));
  const features = [...new Set([...sub.values()].map((t) => t.feature))];
  const storyRelease = Object.assign({}, ...features.map(releaseMap));
  const stories = {};
  for (const f of features.filter((x) => x !== CHORES_FEATURE)) {
    const text = featurePlan(f) ?? '';
    const sec = text.match(/^##\s*1\.[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m)?.[1] ?? '';
    for (const row of sec.split('\n')) {
      const cells = tableCells(row);
      if (STORY_RE.test(cells[0] ?? '')) stories[cells[0]] = { feature: f, text: cells[1] ?? '', release: storyRelease[cells[0]] ?? null };
    }
  }
  const items = [...sub.values()].map((t) => {
    const st = byId.get(t.id);
    const sha = st?.merge_sha;
    const mergedAt = sha ? git(['show', '-s', '--format=%cI', sha]) : null;
    const releasedIn = sha ? (git(['tag', '--contains', sha, '--list', 'v*', '--sort=creatordate']) ?? '').split('\n').find((x) => x && !/-rc/.test(x)) ?? null : null;
    const targets = [...new Set((t.serves ?? []).map((x) => storyRelease[x]).filter(Boolean))].sort();
    return {
      id: t.id, title: t.title, feature: t.feature, component: t.component, kind: t.kind, size: t.size, risk: t.risk,
      weight: t.size === 'M' ? 2 : 1, serves: t.serves ?? [], depends_on: t.depends_on ?? [],
      wave: level.has(t.id) ? level.get(t.id) + 1 : null,
      added_at: (projectInRepo ? firstAdded(`${projectRel}/graph/${t.id}.json`) : null) ?? nowIso(),
      merged_at: mergedAt, released_in: releasedIn, target_release: targets[0] ?? null,
      stage: st?.stage ?? 'planned', phase: st?.phase ?? null, task: st?.task ?? null, heartbeat_minutes: st?.heartbeat_minutes ?? null,
    };
  });
  return { now: nowIso(), features, stories, tickets: items };
}

// Everything the dashboard shows, in one file: run/dashboard.json (and stdout with --json).
function cmdDashboardData() {
  const { tickets } = loadGraph();
  const settings = loadSettings();
  const status = deriveStatus(tickets);
  const sub = new Map([...tickets].filter(([, t]) => isActive(t)));
  const data = {
    generated_at: nowIso(),
    project: settings.project ?? null,
    caps: { max_active_tickets: settings.max_active_tickets, max_active_per_component: settings.max_active_per_component },
    tickets: status,
    critical_path: findCycle(sub) ? [] : criticalPath(sub).path,
    questions: rankQuestions(readQuestions().filter((q) => q.status === 'open'), tickets),
    open_messages: (() => {
      const msgs = readEvents().filter((e) => e.type === 'message');
      const replied = new Set(msgs.map((e) => e.re).filter(Boolean));
      return msgs.filter((e) => !['info', 'ruling', 'answer'].includes(e.kind) && !replied.has(e.id));
    })(),
    metrics: collectMetrics(sinceFlag()),
    progress: collectProgress(tickets, status),
  };
  writeJson(path.join(runDir, 'dashboard.json'), data);
  if (flags.json) process.stdout.write(`${JSON.stringify(data)}\n`);
  else process.stdout.write(`wrote ${path.join(runDir, 'dashboard.json')}\n`);
}

const HELP = `devteam <command>   (put positional arguments before flags)

Graph and status
  validate                        check the graph against planning.md rules (CI gate)
  ready [--plan-ahead] [--json]   tickets that can start now
  waves [--feature c] [--json]     parallel waves and the critical path
  status [--json]                 computed stage of every ticket, live phase, review stats

Gates
  check-ticket <id> [--sha s] [--title t] [--body-file f]   definition of done at an exact head
  check-pr --head-ref r --title t --body-file f [--sha s]  automatic merge-word check (CI)

Messages between sessions (process/messages.md)
  send <to> "<text>" [--kind k] [--re m-…] [--sha s] [--ticket id]   to = supervisor, a ticket id, or plan-<feature>
  messages [--open] [--to x] [--tail n] [--json]   messages to me (--open: not yet replied to)

Questions to the owner (supervisor only; process/questions.md)
  ask --question q [--kind owner-decision|one-way-door|clarification] [--ticket id] [--options a b]
      [--recommendation r] [--default d] [--blocks ids] [--context c]
  answer <qid> "<text>"           the owner answers   |   answer <qid> --defaulted   the supervisor applies a default
  questions [--all] [--json]      ranked owner inbox
  sync-questions                  log answers written by hand or a dashboard, and tell the supervisor
  recorded <qid> <path>           mark where an answer was recorded

Run state and history
  heartbeat [--phase p] [--task t] [--note n] [--usd x --in n --out n --cost-source s] [--supervisor]
  event --type t [--ticket id] [--sha s] [--summary s] [--ref r]
  history [<id>] [--tail n]       events and answered questions, to catch up on history

Improvement and analytics (process/improvement.md)
  gate <name> [--junit report.xml] -- <command…>   run a gate, recording time, pass/fail and test results
  metrics [--since date] [--json] time and cost by phase, gates, reviews, coordination, findings
  dashboard-data [--since date] [--json]   write run/dashboard.json for the dashboard

Other
  notes <from-tag> [<to>]         story-grouped release notes
  whoami                          derived DEVTEAM_* environment
  settings [--get key]             the project's machine-readable settings

Global: --project <dir> overrides docs/devteam/project.
`;

const COMMANDS = {
  validate: cmdValidate,
  ready: cmdReady,
  waves: cmdWaves,
  status: cmdStatus,
  'check-ticket': cmdCheckTicket,
  'check-pr': cmdCheckPr,
  ask: cmdAsk,
  answer: cmdAnswer,
  questions: cmdQuestions,
  'sync-questions': cmdSyncQuestions,
  send: cmdSend,
  messages: cmdMessages,
  recorded: cmdRecorded,
  heartbeat: cmdHeartbeat,
  event: cmdEvent,
  history: cmdHistory,
  notes: cmdNotes,
  metrics: cmdMetrics,
  gate: cmdGate,
  'dashboard-data': cmdDashboardData,
  whoami: cmdWhoami,
  settings: cmdSettings,
};

if (!command || command === 'help' || command === '--help') process.stdout.write(HELP);
else if (!COMMANDS[command]) die(`unknown command "${command}"\n${HELP}`);
else COMMANDS[command]();
