#!/usr/bin/env node
// devteam: graph, state and gate tooling. Node 20+, built-ins only.
// Usage: node docs/devteam/scripts/devteam.mjs <command> [args]. Run with `help` for the list.
//
// Paths:
//   project  docs/devteam/project in the current checkout (override: --project <dir> or DEVTEAM_PROJECT)
//   run      docs/devteam/run in the MAIN checkout, shared by every worktree (override: DEVTEAM_RUN)

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

function git(args, opts = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts }).trim();
  } catch {
    return null;
  }
}

function die(msg, code = 1) {
  process.stderr.write(`devteam: ${msg}\n`);
  process.exit(code);
}

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, obj) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  fs.renameSync(tmp, p); // atomic replace so readers never see a half-written file
};

// ---------- locations ----------

const repoRoot = git(['rev-parse', '--show-toplevel']) ?? process.cwd();
const commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
const mainRoot = commonDir ? path.dirname(commonDir) : repoRoot;
const devteamDir = path.join(repoRoot, 'docs', 'devteam');
const projectDir = path.resolve(flags.project ?? process.env.DEVTEAM_PROJECT ?? path.join(devteamDir, 'project'));
const runDir = path.resolve(process.env.DEVTEAM_RUN ?? path.join(mainRoot, 'docs', 'devteam', 'run'));

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
};

function loadBinding() {
  const p = path.join(projectDir, 'binding.md');
  if (!fs.existsSync(p)) return { ...BINDING_DEFAULTS };
  const m = fs.readFileSync(p, 'utf8').match(/```json devteam\s*\n([\s\S]*?)\n```/);
  if (!m) return { ...BINDING_DEFAULTS };
  try {
    return { ...BINDING_DEFAULTS, ...JSON.parse(m[1]) };
  } catch (e) {
    die(`binding.md settings block is not valid JSON: ${e.message}`);
  }
}

// ---------- graph ----------

const KINDS = ['contract', 'build', 'integration', 'chore', 'spike'];
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

function storiesForColumn(column) {
  const p = path.join(projectDir, 'columns', `${column}.md`);
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, 'utf8');
  // Stories are defined in section 1 only; ids elsewhere are references.
  const sec = text.match(/^##\s*1\.[^\n]*\n([\s\S]*?)(?=^##\s)/m);
  const body = sec ? sec[1] : '';
  return new Set(body.match(/\b[A-Z][A-Z0-9]*-S[0-9]+\b/g) ?? []);
}

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
      re += `(${g.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`;
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const hasWild = (g) => /[*?{[]/.test(g);
const staticPrefix = (g) => {
  const i = g.search(/[*?{[]/);
  return i === -1 ? g : g.slice(0, i);
};

// Conservative: may report an overlap that isn't real, never misses one between plain paths and globs.
function globsOverlap(a, b) {
  if (!hasWild(a) && !hasWild(b)) return a === b;
  if (!hasWild(a)) return globToRegex(b).test(a);
  if (!hasWild(b)) return globToRegex(a).test(b);
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
    if (git(['rev-parse', '--verify', '--quiet', r])) return (mainRefCache = r);
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

// The commit on main that landed a node: a merge commit from branch node/<id>, a squash
// commit titled "<id>: ...", or the branch tip itself if still present and reachable.
function mergeShaFor(id) {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fromBranch = new RegExp(`from \\S*node/${esc}$`);
  for (const { sha, subject } of mainLog()) {
    if (fromBranch.test(subject) || subject.startsWith(`${id}:`)) return sha;
  }
  // Fallback for merge commits with a custom subject: a merge on main whose second parent
  // contains the branch tip and whose first parent does not. (A branch merely created from
  // main is an ancestor of main too, so plain ancestry is not enough.)
  const ref = mainRef();
  if (!ref) return null;
  for (const r of [`origin/node/${id}`, `node/${id}`]) {
    const tip = git(['rev-parse', '--verify', '--quiet', r]);
    if (!tip || git(['merge-base', '--is-ancestor', tip, ref]) === null) continue;
    for (const line of mergeParents()) {
      const [sha, p1, p2] = line;
      if (!p2) continue;
      if (git(['merge-base', '--is-ancestor', tip, p2]) !== null && git(['merge-base', '--is-ancestor', tip, p1]) === null) return sha;
    }
  }
  return null;
}

let mergeParentsCache;
function mergeParents() {
  if (mergeParentsCache) return mergeParentsCache;
  const ref = mainRef();
  const out = ref ? git(['log', ref, '--merges', '--first-parent', '-n', '500', '--format=%H %P']) : null;
  mergeParentsCache = (out ? out.split('\n') : []).filter(Boolean).map((l) => l.split(' '));
  return mergeParentsCache;
}

function isReleased(sha) {
  const tags = git(['tag', '--contains', sha, '--list', 'v*']);
  return !!tags && tags.split('\n').some((t) => t && !/-rc/.test(t));
}

const branchExists = (id) =>
  !!(git(['rev-parse', '--verify', '--quiet', `refs/heads/node/${id}`]) || git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/node/${id}`]));

// ---------- node folder facts ----------

const nodeDir = (id) => path.join(projectDir, 'nodes', id);
const statusLine = (p) => (fs.existsSync(p) ? (fs.readFileSync(p, 'utf8').match(/^Status:\s*(\S+)/m)?.[1] ?? null) : null);

function reviewRecords(id) {
  const dir = path.join(nodeDir(id), 'reviews');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const m = f.match(/^([a-z]+(?:-\d+)?)-(\d+)([a-z]?)\.md$/) ?? f.match(/^([a-z]+)-(\d+)([a-z]?)\.md$/);
      const verdict = [...text.matchAll(/^Verdict:\s*(APPROVE|CHANGES)\s+([0-9a-f]{7,40})\s*$/gm)].pop();
      const reviewer = text.match(/^-\s*Reviewer:\s*(.+)$/m)?.[1]?.trim() ?? null;
      const findings = [];
      for (const row of text.split('\n')) {
        const cells = row.split('|').map((c) => c.trim());
        if (cells.length >= 8 && /^F\d+$/.test(cells[1])) {
          findings.push({ id: cells[1], severity: cells[2], disposition: cells[cells.length - 2] });
        }
      }
      return {
        file: f,
        stage: m ? m[1].replace(/-\d+$/, '') : f.replace(/\.md$/, ''),
        pass: m ? Number(m[2]) : 0,
        variant: m ? m[3] : '',
        verdict: verdict ? verdict[1] : null,
        sha: verdict ? verdict[2] : null,
        reviewer,
        findings,
      };
    });
}

const blocking = (sev) => /^(critical|important)$/i.test(sev);
const disposed = (d) => /^(fixed|wrong|wont-fix\b)/i.test(d ?? '');

// ---------- run state ----------

const runNodePath = (id) => path.join(runDir, 'nodes', `${id}.json`);
const readRunNode = (id) => (fs.existsSync(runNodePath(id)) ? readJson(runNodePath(id)) : null);

function appendEvent(ev) {
  fs.mkdirSync(runDir, { recursive: true });
  const line = JSON.stringify({ ts: nowIso(), ...ev });
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

function readQuestions() {
  const dir = path.join(runDir, 'questions');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      try {
        return [readJson(path.join(dir, f))];
      } catch {
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

function nudge(target, message) {
  if (!target) return false;
  return tmux(['send-keys', '-t', target, '-l', message]) && tmux(['send-keys', '-t', target, 'Enter']);
}

function currentNodeId() {
  if (process.env.DEVTEAM_NODE) return process.env.DEVTEAM_NODE;
  const b = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  return b?.startsWith('node/') ? b.slice(5) : null;
}

const supervisorTarget = () => process.env.DEVTEAM_SUPERVISOR ?? `${loadBinding().tmux_session}:0`;

// ---------- derived status ----------

function deriveStatus(nodes) {
  const out = [];
  const merged = new Map();
  for (const id of nodes.keys()) merged.set(id, mergeShaFor(id));
  for (const n of nodes.values()) {
    const id = n.id;
    const mergeSha = merged.get(id);
    const run = readRunNode(id);
    const reviews = reviewRecords(id);
    let stage = 'planned';
    if (n.superseded_by) stage = 'superseded';
    else if (mergeSha) stage = isReleased(mergeSha) ? 'released' : 'merged';
    else if (reviews.some((r) => r.stage === 'final')) stage = 'in-review';
    else if (branchExists(id) && statusLine(path.join(nodeDir(id), 'plan.md')) === 'approved') stage = 'building';
    else if (statusLine(path.join(nodeDir(id), 'plan.md')) === 'approved') stage = 'planned-in-detail';
    else if (statusLine(path.join(nodeDir(id), 'spec.md')) === 'approved') stage = "spec'd";
    else if ((n.depends_on ?? []).every((d) => merged.get(d))) stage = 'ready';
    const heartbeatAge = run?.heartbeat_at ? Math.round((Date.now() - Date.parse(run.heartbeat_at)) / 60000) : null;
    out.push({
      id,
      column: n.column,
      component: n.component,
      kind: n.kind,
      risk: n.risk,
      stage,
      merge_sha: mergeSha,
      depends_on: n.depends_on ?? [],
      deps_merged: (n.depends_on ?? []).every((d) => merged.get(d)),
      phase: run?.phase ?? null,
      task: run?.task ?? null,
      heartbeat_minutes: heartbeatAge,
      cost: run?.cost ?? null,
      note: run?.note ?? null,
    });
  }
  return out;
}

function reviewStats(nodes) {
  const byStage = {};
  let findings = 0;
  let wrong = 0;
  for (const id of nodes.keys()) {
    for (const r of reviewRecords(id)) {
      for (const f of r.findings) {
        findings++;
        if (/^wrong/i.test(f.disposition)) wrong++;
      }
      if (r.pass !== 1 || r.variant || !r.verdict) continue;
      byStage[r.stage] ??= { first_passes: 0, rejected: 0 };
      byStage[r.stage].first_passes++;
      if (r.verdict === 'CHANGES') byStage[r.stage].rejected++;
    }
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
    if (n.kind && !KINDS.includes(n.kind)) err(id, `kind must be one of ${KINDS.join(', ')}`);
    if (n.size && !['S', 'M'].includes(n.size)) err(id, 'size must be S or M (D1: split anything larger)');
    if (n.risk && !['normal', 'high'].includes(n.risk)) err(id, 'risk must be normal or high');
    for (const s of n.serves ?? []) if (!STORY_RE.test(s)) err(id, `serves "${s}" is not a story id like COL-S1`);
    if (!Array.isArray(n.touches) || n.touches.length === 0) err(id, 'touches must list at least one path or glob');
    if (!Array.isArray(n.done_when) || n.done_when.length === 0) err(id, 'done_when must list at least one check (D5)');
    for (const d of n.done_when ?? []) if (typeof d !== 'string' || d.trim().length < 10) err(id, `done_when entry too vague: "${d}" (D5)`);
    for (const d of n.depends_on ?? []) {
      if (d === id) err(id, 'depends on itself');
      else if (!nodes.has(d)) err(id, `depends_on "${d}" does not exist (D3)`);
      else if (!isActive(nodes.get(d)) && isActive(n)) err(id, `depends_on "${d}" is superseded; depend on its replacement`);
    }
    if (n.superseded_by && !nodes.has(n.superseded_by)) err(id, `superseded_by "${n.superseded_by}" does not exist`);
    if ((n.one_way_doors ?? []).length > 0 && n.risk !== 'high') err(id, 'lists a one-way door, so risk must be high (D8)');
    if (isActive(n) && ['chore', 'spike'].includes(n.kind) && (n.serves ?? []).length === 0 && !n.notes) {
      err(id, `${n.kind} node serving no story must say why in notes (D6)`);
    }
    if (isActive(n) && !['chore', 'spike'].includes(n.kind) && (n.serves ?? []).length === 0) err(id, 'must serve at least one story (D6)');
    if (n.kind === 'contract' && !(n.contracts?.provides ?? []).length) err(id, 'contract node must list contracts.provides (D2)');
  }

  const cycle = findCycle(nodes);
  if (cycle) errors.push(`dependency cycle: ${cycle.join(' -> ')} (D3)`);

  // Stories: every served id is defined; every defined story is served (D6).
  const columns = new Set([...nodes.values()].filter(isActive).map((n) => n.column));
  for (const col of columns) {
    const stories = storiesForColumn(col);
    if (!stories) {
      errors.push(`column "${col}": project/columns/${col}.md not found`);
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
        for (const ga of a.touches ?? []) {
          const hit = (b.touches ?? []).find((gb) => globsOverlap(ga, gb));
          if (hit) {
            errors.push(`${a.id} and ${b.id} can run concurrently but both touch "${ga}" / "${hit}" (D4)`);
            break;
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
  return r && !['done', 'parked'].includes(r.phase);
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
  if (flags.json) return void process.stdout.write(`${JSON.stringify({ ready: rows, active, caps: { max_active_nodes: b.max_active_nodes, max_active_per_component: b.max_active_per_component } }, null, 2)}\n`);
  process.stdout.write(`active workers: ${active.length}/${b.max_active_nodes}\n`);
  if (!rows.length) return void process.stdout.write('nothing ready\n');
  for (const r of rows) process.stdout.write(`${r.mode.padEnd(10)} ${r.id}  (${r.kind}, ${r.size}, ${r.risk})\n`);
}

function cmdWaves() {
  const { nodes } = loadGraph();
  const col = flags.column;
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
  // Critical path by weight: S = 1, M = 2.
  const weight = (id) => (sub.get(id).size === 'M' ? 2 : 1);
  const best = new Map();
  const longest = (id) => {
    if (best.has(id)) return best.get(id);
    const deps = (sub.get(id).depends_on ?? []).filter((d) => sub.has(d));
    let top = { len: 0, path: [] };
    for (const d of deps) {
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
    const live = r.phase ? `  [${r.phase}${r.task ? ` ${r.task}` : ''}, ${r.heartbeat_minutes}m${r.heartbeat_minutes > stale && !['done', 'parked'].includes(r.phase) ? ' STALE' : ''}]` : '';
    process.stdout.write(`${r.stage.padEnd(18)} ${r.id}${live}\n`);
  }
  const s = reviewStats(nodes);
  for (const [stage, v] of Object.entries(s.by_stage)) process.stdout.write(`review ${stage}: first-pass rejection ${v.rejected}/${v.first_passes}\n`);
}

function cmdCheckNode() {
  const id = positional[0] ?? die('usage: check-node <node-id> [--sha <head>] [--title "<pr title>"]');
  const { nodes } = loadGraph();
  const n = nodes.get(id);
  const fails = [];
  if (!n) die(`no graph node ${id}`);
  if (n.superseded_by) fails.push(`node is superseded by ${n.superseded_by}`);
  const sha = (flags.sha === true ? null : flags.sha) ?? git(['rev-parse', 'HEAD']);
  const spec = path.join(nodeDir(id), 'spec.md');
  const plan = path.join(nodeDir(id), 'plan.md');
  const ver = path.join(nodeDir(id), 'verification.md');
  if (statusLine(spec) !== 'approved') fails.push('spec.md missing or not "Status: approved"');
  if (statusLine(plan) !== 'approved') fails.push('plan.md missing or not "Status: approved"');
  if (!fs.existsSync(ver)) fails.push('verification.md missing');
  else {
    const rows = fs.readFileSync(ver, 'utf8').split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l)).length - 1;
    if (rows < (n.done_when ?? []).length) fails.push(`verification.md has ${Math.max(rows, 0)} result row(s) for ${n.done_when.length} done-when(s)`);
  }
  const reviews = reviewRecords(id);
  const finals = reviews.filter((r) => r.stage === 'final');
  const approvedAtHead = finals.filter((r) => r.verdict === 'APPROVE' && sha && (sha.startsWith(r.sha) || r.sha.startsWith(sha)));
  if (!finals.length) fails.push('no final review record (reviews/final-<n>.md)');
  else if (!approvedAtHead.length) fails.push(`no final review says "Verdict: APPROVE ${sha}"`);
  if (n.risk === 'high') {
    const distinct = new Set(approvedAtHead.map((r) => r.reviewer ?? r.file));
    if (distinct.size < 2) fails.push('risk: high needs two final APPROVE reviews at this head from different reviewers');
  }
  for (const r of reviews) {
    for (const f of r.findings) if (blocking(f.severity) && !disposed(f.disposition)) fails.push(`${r.file} ${f.id} (${f.severity}) has no disposition`);
  }
  if (flags.title && flags.title !== true && !new RegExp(`^${id.replace(/[-]/g, '\\-')}: \\S`).test(flags.title)) fails.push(`PR title must start with "${id}: "`);
  if (fails.length) {
    for (const f of fails) process.stdout.write(`fail: ${f}\n`);
    process.exit(1);
  }
  process.stdout.write(`ok: ${id} meets the definition of done at ${sha?.slice(0, 12)}\n`);
}

function questionId(from) {
  const d = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '');
  const slug = String(from).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'anon';
  return `q-${d.slice(0, 8)}-${d.slice(9, 15)}-${slug}`;
}

function cmdAsk() {
  const from = flags.from ?? currentNodeId() ?? 'supervisor';
  const q = flags.question ?? die('ask needs --question');
  const kind = flags.kind ?? 'clarification';
  const to = flags.to ?? (from === 'supervisor' || from === 'planner' ? 'owner' : 'supervisor');
  if (to === 'owner' && !['supervisor', 'planner'].includes(from)) die('workers ask the supervisor; the supervisor escalates to the owner (questions.md §2)');
  if (kind === 'one-way-door' && flags.default) die('one-way doors never have a default (questions.md §4)');
  let id = questionId(from);
  for (let i = 2; fs.existsSync(path.join(runDir, 'questions', `${id}.json`)); i++) id = `${questionId(from)}-${i}`;
  const question = {
    id,
    kind,
    to,
    from,
    node: flags.node ?? currentNodeId(),
    asked_at: nowIso(),
    question: q,
    context: flags.context ?? '',
    options: asList(flags.options),
    recommendation: flags.recommendation ?? '',
    default: flags.default ?? null,
    blocks: asList(flags.blocks),
    head_sha: kind === 'merge-request' ? (flags.head ?? git(['rev-parse', 'HEAD'])) : null,
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

function cmdAnswer() {
  const [id, ...rest] = positional;
  if (!id || !rest.length) die('usage: answer <question-id> "<answer>" [--by owner|supervisor] [--defaulted]');
  const p = path.join(runDir, 'questions', `${id}.json`);
  if (!fs.existsSync(p)) die(`no question ${id}`);
  const q = readJson(p);
  if (q.status !== 'open') die(`${id} is already ${q.status}`);
  q.answer = rest.join(' ');
  q.answered_by = flags.by ?? (currentNodeId() ? die('workers do not answer questions') : 'supervisor');
  q.answered_at = nowIso();
  q.status = flags.defaulted ? 'defaulted' : 'answered';
  writeJson(p, q);
  appendEvent({ type: flags.defaulted ? 'question.defaulted' : 'question.answered', actor: q.answered_by, node: q.node, summary: q.answer.slice(0, 280), ref: `run/questions/${id}.json` });
  const b = loadBinding();
  if (q.from === 'supervisor') nudge(supervisorTarget(), `devteam: ${id} answered`);
  else nudge(`${b.tmux_session}:${q.from}`, `devteam: ${id} answered`);
  process.stdout.write(`answered ${id}\n`);
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
  let crit = new Set();
  try {
    const sub = new Map([...nodes].filter(([, n]) => isActive(n)));
    if (!findCycle(sub)) {
      const best = new Map();
      const longest = (id) => {
        if (best.has(id)) return best.get(id);
        let top = [];
        for (const d of sub.get(id).depends_on ?? []) if (sub.has(d)) { const r = longest(d); if (r.length > top.length) top = r; }
        const r = [...top, id];
        best.set(id, r);
        return r;
      };
      let c = [];
      for (const id of sub.keys()) { const r = longest(id); if (r.length > c.length) c = r; }
      crit = new Set(c);
    }
  } catch {}
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
  if (flags.to) qs = qs.filter((q) => q.to === flags.to);
  if (flags.mine) {
    const me = currentNodeId() ?? 'supervisor';
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
  const p = supervisor ? path.join(runDir, 'supervisor.json') : runNodePath(id);
  const prev = fs.existsSync(p) ? readJson(p) : {};
  const session = process.env.TMUX ? (() => { try { return execFileSync('tmux', ['display-message', '-p', '#S:#W'], { encoding: 'utf8' }).trim(); } catch { return prev.session; } })() : prev.session;
  const next = { ...prev, id, heartbeat_at: nowIso() };
  if (!supervisor) {
    next.phase = flags.phase ?? prev.phase ?? 'spawned';
    next.worktree = repoRoot;
    next.branch = git(['rev-parse', '--abbrev-ref', 'HEAD']) ?? prev.branch;
    next.head_sha = git(['rev-parse', 'HEAD']) ?? prev.head_sha ?? null;
    next.started_at = prev.started_at ?? nowIso();
    if (flags.task !== undefined) next.task = flags.task === true ? null : flags.task;
  }
  if (session) next.session = session;
  if (flags.note !== undefined) next.note = flags.note === true ? '' : String(flags.note).slice(0, 280);
  if (flags.usd || flags.in || flags.out) {
    next.cost = {
      usd: flags.usd ? Number(flags.usd) : (prev.cost?.usd ?? 0),
      input_tokens: flags.in ? Number(flags.in) : (prev.cost?.input_tokens ?? 0),
      output_tokens: flags.out ? Number(flags.out) : (prev.cost?.output_tokens ?? 0),
      source: flags['cost-source'] ?? prev.cost?.source ?? 'agent-report',
    };
  }
  writeJson(p, next);
  if (!supervisor && next.phase !== prev.phase) {
    appendEvent({ type: 'node.phase', actor: id, node: id, sha: next.head_sha, summary: `${prev.phase ?? 'none'} -> ${next.phase}${next.note ? `: ${next.note}` : ''}` });
  }
  process.stdout.write(`heartbeat ${id}${supervisor ? '' : ` ${next.phase}`}\n`);
}

function cmdEvent() {
  const type = flags.type ?? die('event needs --type (see schema/event.schema.json)');
  appendEvent({
    type,
    actor: flags.actor ?? currentNodeId() ?? 'supervisor',
    node: flags.node ?? currentNodeId(),
    sha: flags.sha ?? null,
    summary: flags.summary ? String(flags.summary).slice(0, 280) : '',
    ref: flags.ref ?? null,
  });
  process.stdout.write('ok\n');
}

function cmdHistory() {
  const id = positional[0];
  const tail = Number(flags.tail ?? 100);
  let evs = readEvents();
  let scope = null;
  if (id) {
    const { nodes } = loadGraph();
    scope = new Set([id, ...(nodes.get(id)?.depends_on ?? [])]);
    evs = evs.filter((e) => scope.has(e.node) || scope.has(e.actor));
  }
  for (const e of evs.slice(-tail)) process.stdout.write(`${e.ts} ${e.type.padEnd(18)} ${(e.node ?? e.actor ?? '').padEnd(28)} ${e.summary ?? ''}\n`);
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
      `DEVTEAM_RUN=${runDir}`,
      `DEVTEAM_SUPERVISOR=${supervisorTarget()}`,
      `# repo=${repoRoot} main_checkout=${mainRoot} project=${projectDir} tmux_session=${b.tmux_session}`,
    ].join('\n') + '\n',
  );
}

function cmdBinding() {
  const b = loadBinding();
  const key = flags.get;
  if (key && key !== true) {
    const v = b[key];
    process.stdout.write(`${v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : v}\n`);
  } else process.stdout.write(`${JSON.stringify(b, null, 2)}\n`);
}

function cmdNotes() {
  const [from, to = 'HEAD'] = positional;
  if (!from) die('usage: notes <from-tag> [<to-ref>]');
  const out = git(['log', `${from}..${to}`, '--format=%s']);
  const { nodes } = loadGraph();
  const landed = new Set();
  for (const s of (out ?? '').split('\n')) {
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

const HELP = `devteam <command>
  validate                      check the graph against planning.md rules (CI gate)
  ready [--spec-ahead] [--json] nodes that can start now
  waves [--column c] [--json]   parallel waves and the critical path
  status [--json]               derived stage of every node, live phase, review stats
  check-node <id> [--sha s] [--title t]   definition of done for a node PR
  ask --question q [--kind k] [--node id] [--options a b] [--recommendation r]
      [--default d] [--blocks ids] [--context c] [--to owner] [--head sha]
  answer <qid> "<text>" [--by owner|supervisor] [--defaulted]
  recorded <qid> <path>         mark where an answered question's ruling was recorded
  questions [--to x] [--mine] [--all] [--json]   ranked inbox
  heartbeat [--phase p] [--task t] [--note n] [--usd x --in n --out n --cost-source s] [--supervisor]
  event --type t [--node id] [--sha s] [--summary s] [--ref r]
  history [<id>] [--tail n]     events and answered questions for orientation
  notes <from-tag> [<to>]       story-grouped release notes
  whoami                        derived DEVTEAM_* environment
  binding [--get key]           the project's machine-readable settings
Global: --project <dir> overrides docs/devteam/project.
`;

const COMMANDS = {
  validate: cmdValidate,
  ready: cmdReady,
  waves: cmdWaves,
  status: cmdStatus,
  'check-node': cmdCheckNode,
  ask: cmdAsk,
  answer: cmdAnswer,
  recorded: cmdRecorded,
  questions: cmdQuestions,
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
