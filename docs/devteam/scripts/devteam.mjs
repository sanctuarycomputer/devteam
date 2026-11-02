#!/usr/bin/env node
// devteam: the one script. Node 18+, built-ins only.
//   node docs/devteam/scripts/devteam.mjs <command> [args]      (`help` lists the commands)
//
// Everything structured about a project is a line in the log (schema/log.schema.json), folded by
// time. Everything prose is markdown. This file validates and folds the log, computes the graph,
// status, metrics, roadmap and dashboard from it, runs the checks the supervisor merges on, makes
// worker sessions, serves the dashboard, and gives every role its commands.
//
// Sections: 1 helpers · 2 settings · 3 schema and log · 4 git facts · 5 graph · 6 reviews and the
// definition of done · 7 trust · 8 decide and act · 9 goals, roadmap, retros · 10 metrics and the
// dashboard · 11 sessions (workers, messages, phases, gates) · 12 init, help, dispatch.

import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ===== 1. helpers =====

// Projects pin their own Node (asdf, nvm), and the dashboard reruns this file with that Node, so
// say plainly when it is too old instead of failing mid-command. Use nothing newer than Node 18.
if (Number(process.versions.node.split('.')[0]) < 18) {
  process.stderr.write(`devteam: needs Node 18 or newer; this is ${process.version} (check the project's .tool-versions, .nvmrc or .node-version)\n`);
  process.exit(1);
}

// Object.groupBy is Node 21+.
const groupBy = (xs, key) => { const o = {}; for (const x of xs) (o[key(x)] ??= []).push(x); return o; };

process.stdout.on('error', (e) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});

const argv = process.argv.slice(2);
const command = argv.shift();

// Flags take every following non-flag token as their value(s); put positionals before flags.
// Everything after a bare `--` is left for commands that run another command (gate, act).
function parseArgs(args) {
  const flags = {};
  const positional = [];
  const dash = args.indexOf('--');
  const own = dash === -1 ? args : args.slice(0, dash);
  for (let i = 0; i < own.length; i++) {
    const a = own[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const values = [];
      while (i + 1 < own.length && !own[i + 1].startsWith('--')) values.push(own[++i]);
      flags[key] = values.length === 0 ? true : values.length === 1 ? values[0] : values;
    } else positional.push(a);
  }
  return { flags, positional, rest: dash === -1 ? null : args.slice(dash + 1) };
}

const { flags, positional, rest } = parseArgs(argv);
const asList = (v) => (v === undefined || v === true ? [] : Array.isArray(v) ? v : [v]);
const flagStr = (k) => (flags[k] === undefined || flags[k] === true ? undefined : Array.isArray(flags[k]) ? flags[k].join(' ') : String(flags[k]));
const flagNum = (k) => (flagStr(k) === undefined ? undefined : Number(flagStr(k)));

function die(msg, code = 1) {
  process.stderr.write(`devteam: ${msg}\n`);
  process.exit(code);
}
const warn = (msg) => process.stderr.write(`devteam: warning: ${msg}\n`);
const out = (s) => process.stdout.write(`${s}\n`);
const json = (x) => out(JSON.stringify(x, null, 2));
const nowIso = () => new Date().toISOString();
const dateOnly = (iso) => iso.slice(0, 10);
const DAY = 864e5;

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).replace(/\n$/, '');
  } catch {
    return null;
  }
}
function gitOrDie(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    die(`git ${args.join(' ')} failed: ${(e.stderr || e.message).toString().trim()}`);
  }
}
function sh(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts }).trim();
  } catch {
    return null;
  }
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const readText = (p) => (fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, 'utf8') : null);
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  fs.renameSync(tmp, p);
}
const median = (xs) => {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const hours = (ms) => (ms === null ? null : +(ms / 3600000).toFixed(1));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';

// ===== 2. locations and settings =====

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = git(['rev-parse', '--show-toplevel']) ?? process.cwd();
// The kit of the checkout you are in (a worktree has its own copy), whichever copy of this script ran.
const devteamDir = fs.existsSync(path.join(repoRoot, 'docs', 'devteam', 'scripts', 'devteam.mjs')) ? path.join(repoRoot, 'docs', 'devteam') : path.resolve(here, '..');
const commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
const mainRoot = commonDir ? path.dirname(commonDir) : repoRoot;
const projectDir = path.resolve(flagStr('project') ?? process.env.DEVTEAM_PROJECT ?? path.join(devteamDir, 'project'));
const runDir = path.resolve(process.env.DEVTEAM_RUN ?? path.join(mainRoot, 'docs', 'devteam', 'run'));
const projectRel = path.relative(repoRoot, projectDir).split(path.sep).join('/');
const projectInRepo = !!commonDir && projectRel !== '' && !projectRel.startsWith('..') && !path.isAbsolute(projectRel);
const CHORES = 'chores';

// Every setting has a default here; project/settings.md holds only what the project changes.
const SETTINGS_DEFAULTS = {
  project: null,
  tmux_session: 'devteam',
  agent_command: 'claude --dangerously-skip-permissions',
  resume_command: 'claude --continue --dangerously-skip-permissions',
  main_branch: 'main',
  merge_method: 'merge',
  // Where PRs live: 'github' (gh pr view / gh pr merge --match-head-commit) or 'git' (no forge CLI:
  // merge takes --title and --body-file, merges the exact head on main and pushes; a moved main
  // makes the push fail, which is the same check).
  forge: 'github',
  max_active_tickets: 5,
  max_active_per_component: 2,
  stale_after_minutes: 30,
  // How long `ack` sets a finding aside; it comes back sooner if its subject changes.
  finding_ack_hours: 24,
  question_default_after_hours: 24,
  autonomy_ceilings: {},
  components: {},
  // How a tagged release reaches production: 'tag' (deploys from the tag) or { branch: 'production' }.
  release: 'tag',
  // Files a fresh worktree needs that git doesn't carry (gitignored secrets, local env), copied from
  // the main checkout into every worker, planner, gate and chore worktree. Paths relative to the repo root.
  worktree_files: [],
  // A shell command run in every new worker, planner and gate worktree, and a chore worktree from
  // `chore start`, after worktree_files are copied (install dependencies, link env files). Empty for none.
  worktree_setup: '',
  worker_denied_commands: ['gh pr merge*', 'gh api*', 'git push*main*', 'git push*--force*', 'git push*-f *', 'git push*+*'],
  dashboard_port: 4321,
  upstream_repo: 'sanctuarycomputer/devteam',
  upstream_base: null,
  upstream_check_hours: 24,
  retro_every_days: 7,
  research_every_days: 7,
  slow_gate_minutes: 10,
};
// Settings that are the owner's to change (constitution.md, owner_only): a PR of any kind that
// changes one merges only with --approved naming an answered question of that class. Gate
// commands and what every gate checkout is seeded with decide what "passes"; the agent command
// and deny rules decide what workers may do; upstream_repo is what a standing sync approval trusts.
const OWNER_SETTINGS = {
  gates: 'gate-change', worktree_setup: 'gate-change', worktree_files: 'gate-change',
  autonomy_ceilings: 'governance-edit', agent_command: 'governance-edit', resume_command: 'governance-edit', worker_denied_commands: 'governance-edit',
  forge: 'governance-edit', main_branch: 'governance-edit', merge_method: 'governance-edit', upstream_repo: 'governance-edit',
  release: 'release-production',
};
const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v));
function settingsAt(ref) {
  const text = git(['show', `${ref}:${projectRel}/settings.md`]);
  const m = text?.match(/```json devteam\s*\n([\s\S]*?)\n```/);
  if (!m) return { ...SETTINGS_DEFAULTS };
  try { return { ...SETTINGS_DEFAULTS, ...JSON.parse(m[1]) }; } catch { return null; }
}
// The owner's settings a commit changes against a base: [{ key, cls }], or null if unreadable.
function ownerSettingsChanged(base, head) {
  const a = settingsAt(base), b = settingsAt(head);
  if (!a || !b) return null;
  return Object.entries(OWNER_SETTINGS).filter(([k]) => canonical(a[k]) !== canonical(b[k])).map(([key, cls]) => ({ key, cls }));
}
let settingsCache;
function loadSettings() {
  if (settingsCache) return settingsCache;
  const m = readText(path.join(projectDir, 'settings.md'))?.match(/```json devteam\s*\n([\s\S]*?)\n```/);
  if (!m) settingsCache = { ...SETTINGS_DEFAULTS };
  else {
    try {
      settingsCache = { ...SETTINGS_DEFAULTS, ...JSON.parse(m[1]) };
    } catch (e) {
      die(`settings.md: the json devteam block is not valid JSON: ${e.message}`);
    }
  }
  // The owner's settings count only as they are on main: an edit in a checkout's working tree (or
  // on a branch) takes effect once it lands through a PR that carried the owner's answer. Main is
  // the remote's default branch, so a local main_branch edit can't move it. Before settings.md
  // first lands on main (adoption), the working tree is all there is.
  if (projectInRepo) {
    const head = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    const ref = [head, `origin/${settingsCache.main_branch}`, settingsCache.main_branch].find((r) => r && git(['cat-file', '-e', `${r}:${projectRel}/settings.md`]) !== null);
    const onMain = ref ? settingsAt(ref) : null;
    if (onMain) {
      const local = Object.keys(OWNER_SETTINGS).filter((k) => canonical(settingsCache[k]) !== canonical(onMain[k]));
      for (const k of local) settingsCache[k] = onMain[k];
      if (local.length && !process.env.DEVTEAM_QUIET_SETTINGS) { process.env.DEVTEAM_QUIET_SETTINGS = '1'; warn(`settings.md here changes ${local.join(', ')}; owner settings apply as they are on ${ref} until a PR with the owner's answer lands them`); }
    }
  }
  return settingsCache;
}

// The trust ladder and its tables live in governance/constitution.md, in a ```json devteam block.
let ladderCache;
function ladder() {
  if (ladderCache) return ladderCache;
  const m = readText(path.join(devteamDir, 'governance', 'constitution.md'))?.match(/```json devteam\s*\n([\s\S]*?)\n```/);
  let a = { classes: {}, constitutional: [], owner_only: [], reasons: [], promotion: {} };
  if (m) {
    try {
      a = { ...a, ...JSON.parse(m[1]) };
    } catch (e) {
      die(`constitution.md: the json devteam block is not valid JSON: ${e.message}`);
    }
  }
  a.raw_ceilings = Object.fromEntries(Object.entries(a.classes).map(([k, v]) => [k, v.ceiling]));
  for (const [c, v] of Object.entries(loadSettings().autonomy_ceilings ?? {})) {
    if (a.classes[c] && typeof v === 'number' && v < a.classes[c].ceiling) a.classes[c] = { ...a.classes[c], ceiling: v };
  }
  a.promotion = { agreement: 0.9, agreement_window: 10, ...a.promotion };
  return (ladderCache = a);
}
const RUNG = { 1: 'ask', 2: 'ask with a default', 3: 'act and report' };

// ===== 3. the schema and the log =====

const SCHEMA = readJson(path.join(devteamDir, 'schema', 'log.schema.json'));
const ENVELOPE = ['v', 'id', 'type', 'op', 'at', 'by', 'channel'];
const LINE_MAX = 4096;
const TYPES = Object.keys(SCHEMA.$defs.types);
const RANK = SCHEMA['x-authority'].rank;

// A JSON Schema checker for the subset the log schema uses. Returns a list of problems.
function schemaErrors(schema, value, where) {
  const errs = [];
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
  if (schema.const !== undefined && value !== schema.const) errs.push(`${where} must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${where} must be one of ${schema.enum.join(', ')}`);
  if (schema.type) {
    const want = asList(schema.type);
    const got = typeOf(value);
    if (!want.includes(got) && !(got === 'integer' && want.includes('number'))) errs.push(`${where} must be ${want.join(' or ')}`);
  }
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`${where} "${value.slice(0, 40)}" does not match ${schema.pattern}`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errs.push(`${where} must be at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errs.push(`${where} must be at most ${schema.maxLength} characters`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${where} must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${where} must be at most ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${where} needs at least ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errs.push(`${where} has more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => errs.push(...schemaErrors(schema.items, v, `${where}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const k of schema.required ?? []) if (!(k in value)) errs.push(`${where}.${k} is required`);
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties?.[k];
      if (sub) errs.push(...schemaErrors(sub, v, `${where}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${where}.${k} is not a field here`);
    }
  }
  return errs;
}

// The writer a log file belongs to, from its name alone: owner-<yyyy-mm>, supervisor-<yyyy-mm>,
// plan-<feature> (a planner's graph, landed by its plan PR), plan-<feature>-<yyyy-mm> (the same
// planner's messages and observations, live), or a ticket id. Anything else counts for nothing.
const MONTHLY = /^(owner|supervisor|plan-[a-z0-9]+(?:-[a-z0-9]+)*?)-\d{4}-\d{2}$/;
function writerOfFile(name) {
  const base = name.replace(/\.jsonl$/, '');
  const m = MONTHLY.exec(base);
  if (m) return m[1];
  if (/^(owner|supervisor)(-|$)/.test(base)) return null;
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(base) ? base : null;
}
const writerClass = (by) => (by === 'owner' || by === 'supervisor' ? by : /^plan-[a-z0-9-]+$/.test(by) ? 'planner' : 'ticket');
const planFeature = (by) => (writerClass(by) === 'planner' ? by.slice('plan-'.length) : null);

// The cheap checks every reader runs, so a line never grants more than its file's writer has: the
// line says who wrote it and the file agrees; a new id names its writer; the authority table lets
// this class create the type or set these fields; a planner stays inside its own feature.
function integrity(o, file) {
  if (file && writerOfFile(file) !== o.by) return `by "${o.by}" does not match the file's writer "${writerOfFile(file) ?? '(not a log file)'}"`;
  const cls = writerClass(o.by);
  const auth = SCHEMA['x-authority'];
  const ids = SCHEMA['x-id'];
  const body = Object.keys(o).filter((k) => !ENVELOPE.includes(k) && !k.startsWith('__'));
  if (o.op === 'new') {
    if (ids.keyed[o.type]) {
      if (!new RegExp(ids.keyed[o.type]).test(o.id)) return `a ${o.type} id must match ${ids.keyed[o.type]}`;
    } else {
      if (!new RegExp(ids.pattern).test(o.id) || !o.id.startsWith(`${ids.prefix[o.type]}-`)) return `a ${o.type} id looks like ${ids.prefix[o.type]}-<yyyymmdd>-<hhmmssmmm>-<writer>`;
      if (!o.id.endsWith(`-${o.by}`)) return `a new id ends with its writer, "-${o.by}"`;
    }
    if (!auth.new[cls].includes(o.type)) return `${cls} may not create ${o.type} lines`;
    if (cls === 'planner' && file && ['feature', 'ticket'].includes(o.type) && !isPlanFile(file)) return `a planner's ${o.type} lines belong in its plan file, ${o.by}.jsonl`;
    if (o.type === 'goal' && o.status && o.status !== 'draft' && cls !== 'owner') return 'only the owner creates a goal past draft';
    const f = planFeature(o.by);
    if (f && o.type === 'feature' && o.id !== f) return `${o.by} may only create the feature "${f}"`;
    if (f && o.type === 'ticket' && o.feature !== f) return `${o.by} may only create tickets of the feature "${f}"`;
    return null;
  }
  const allowed = auth.set[o.type]?.[cls];
  if (!allowed) return `${cls} may not change ${o.type} lines`;
  if (!body.length) return 'a set line changes at least one field';
  const bad = body.filter((k) => !allowed.includes(k));
  if (bad.length) return `${cls} may not set ${o.type}.${bad.join(', ')}`;
  return null;
}

// Validate one parsed line in full: envelope, body against its type, required and set-only fields,
// then the integrity checks above.
function checkLine(o, file) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return ['not a JSON object'];
  const envelope = Object.fromEntries(ENVELOPE.filter((k) => k in o).map((k) => [k, o[k]]));
  const errs = schemaErrors({ ...SCHEMA, $defs: undefined }, envelope, 'line').map((e) => e.replace(/^line\./, ''));
  if (errs.length) return errs;
  if ((o.channel !== undefined) !== (o.by === 'owner')) errs.push('channel is on every owner line and no other');
  if (o.channel === 'chat' && !(o.type === 'question' && o.op === 'set' && typeof o.answer === 'string' && typeof o.said === 'string')) errs.push('a chat line is an answer to a question, with the owner\'s words in said');
  const t = SCHEMA.$defs.types[o.type];
  const body = Object.fromEntries(Object.entries(o).filter(([k]) => !ENVELOPE.includes(k)));
  errs.push(...schemaErrors(t, body, o.type));
  if (o.op === 'new') {
    for (const k of t['x-required-new'] ?? []) if (!(k in body)) errs.push(`${o.type}.${k} is required`);
    for (const k of t['x-set-only'] ?? []) if (k in body) errs.push(`${o.type}.${k} is set later, not at creation`);
    if (o.type === 'question' && o.kind === 'one-way-door' && o.default) errs.push('a one-way door never has a default');
  }
  const i = integrity(o, file);
  if (i) errs.push(i);
  return errs;
}

// Parse a file's lines. Full validation is on by default (log-check, merge); readers skip the
// schema walk for speed but never the integrity checks.
function parseLines(text, file, { firstLine = 1, validate = true } = {}) {
  const lines = [];
  const errors = [];
  (text ?? '').split('\n').forEach((raw, i) => {
    if (!raw.trim()) return;
    const n = i + firstLine;
    if (raw.length > LINE_MAX) return void errors.push(`${file}:${n}: longer than ${LINE_MAX} bytes`);
    let o;
    try {
      o = JSON.parse(raw);
    } catch {
      return void errors.push(`${file}:${n}: not valid JSON`);
    }
    const shape = !o || typeof o !== 'object' || Array.isArray(o) || !TYPES.includes(o.type) || !['new', 'set'].includes(o.op) || typeof o.id !== 'string' || typeof o.at !== 'string' || typeof o.by !== 'string';
    const errs = shape ? ['not a log line'] : validate ? checkLine(o, file) : [integrity(o, file)].filter(Boolean);
    if (errs.length) errors.push(`${file}:${n}: ${errs.join('; ')}`);
    else lines.push({ ...o, __file: file, __line: n });
  });
  return { lines, errors };
}

// Build current state from every line. A `new` creates an object (a repeated id is ignored); a
// `set` changes fields, but a field keeps the rank of whoever last set it (the creator's rank at
// creation), and a lower-ranked writer can't change it: the owner's answer beats a later default.
// The three state rules a schema can't express are here too (see the schema's description).
function fold(all) {
  const lines = [...all].sort((a, b) => a.at.localeCompare(b.at) || a.__file.localeCompare(b.__file) || a.__line - b.__line);
  const objects = new Map();
  const ignored = [];
  for (const l of lines) {
    if (l.op !== 'new') continue;
    if (objects.has(l.id)) {
      ignored.push({ line: l, why: 'duplicate id' });
      continue;
    }
    const { v, op, __file, __line, at, by, ...body } = l;
    const rank = RANK[writerClass(by)];
    objects.set(l.id, { ...body, created_at: at, created_by: by, updates: [], __rank: Object.fromEntries(Object.keys(body).map((k) => [k, rank])) });
  }
  for (const l of lines) {
    if (l.op !== 'set') continue;
    const obj = objects.get(l.id);
    if (!obj) {
      ignored.push({ line: l, why: 'set on an unknown id' });
      continue;
    }
    if (obj.type !== l.type) {
      ignored.push({ line: l, why: `set says ${l.type} but ${l.id} is a ${obj.type}` });
      continue;
    }
    const cls = writerClass(l.by);
    const f = planFeature(l.by);
    if (f && (obj.type === 'feature' ? obj.id : obj.feature) !== f) {
      ignored.push({ line: l, why: `${l.by} may only change the feature "${f}" and its tickets` });
      continue;
    }
    if (obj.type === 'goal' && cls === 'supervisor' && (obj.status ?? 'draft') !== 'draft') {
      ignored.push({ line: l, why: 'the supervisor edits a goal only while it is a draft' });
      continue;
    }
    if (obj.type === 'question' && l.status === 'defaulted' && !obj.default) {
      ignored.push({ line: l, why: 'the question has no default' });
      continue;
    }
    const rank = RANK[cls];
    const changed = {};
    for (const [k, val] of Object.entries(l)) {
      if (ENVELOPE.includes(k) || k.startsWith('__')) continue;
      if ((obj.__rank[k] ?? -1) > rank) continue;
      obj[k] = val;
      obj.__rank[k] = rank;
      changed[k] = val;
    }
    if (Object.keys(changed).length) obj.updates.push({ at: l.at, by: l.by, ...(l.channel ? { channel: l.channel } : {}), ...changed });
    else ignored.push({ line: l, why: 'overridden by a higher-ranked writer' });
  }
  for (const o of objects.values()) delete o.__rank;
  return { objects, ignored };
}

// --- where the log lives ---
//
// A planner writes project/log/plan-<feature>.jsonl in its own worktree; the lines land with the
// plan PR, so a plan is reviewed before anyone can schedule from it. Everyone else writes
// run/log/<writer>.jsonl the moment something happens (gitignored, shared by every worktree) and
// the supervisor mirrors those files into project/log with the chore-log PR.

const liveLogDir = () => path.join(runDir, 'log');
const durableLogDir = () => path.join(projectDir, 'log');
// A planner's graph (feature and ticket lines) goes in plan-<feature>.jsonl in its worktree and
// lands with the plan PR; everything else it writes is live, like everyone else's.
const GRAPH_TYPES = ['feature', 'ticket'];
const logFileFor = (by, type) => (by === 'owner' || by === 'supervisor' || (writerClass(by) === 'planner' && !GRAPH_TYPES.includes(type)) ? `${by}-${nowIso().slice(0, 7)}.jsonl` : `${by}.jsonl`);
const isPlanFile = (name) => name.startsWith('plan-') && !MONTHLY.test(name.replace(/\.jsonl$/, ''));

function currentTicketId() {
  if (process.env.DEVTEAM_TICKET) return process.env.DEVTEAM_TICKET;
  const b = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  return b?.startsWith('ticket/') ? b.slice('ticket/'.length) : null;
}
// Who this process writes the log as: a ticket id, plan-<feature>, or supervisor. Never the owner.
function logWriter() {
  const t = currentTicketId();
  if (t) return t;
  if (process.env.DEVTEAM_FEATURE) return `plan-${process.env.DEVTEAM_FEATURE}`;
  const b = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (b?.startsWith('plan/')) return `plan-${b.slice('plan/'.length)}`;
  return 'supervisor';
}
// Owner commands run from the owner's terminal or the dashboard, never an agent session. A
// visibility measure, not a wall: appendLog stamps every owner line with its channel.
function ownerWriter() {
  if (process.env.DEVTEAM_ROLE) die(`owner commands don't run in an agent session (DEVTEAM_ROLE=${process.env.DEVTEAM_ROLE})`);
  return { by: 'owner' };
}
const ownerChannel = () => (process.env.DEVTEAM_CHANNEL === 'dashboard' ? 'dashboard' : 'cli');
const supervisorOnly = (what) => {
  if (logWriter() !== 'supervisor' || ['worker', 'planner'].includes(process.env.DEVTEAM_ROLE)) die(`${what}: the supervisor does this`);
  rememberSupervisorPane();
};
// The supervisor is the owner's foreground agent session. When it runs inside tmux, its pane is
// recorded so workers' messages and the owner's answers can be typed into it; otherwise they wait
// in the log for its next tick.
const supervisorPaneFile = () => path.join(runDir, 'supervisor-pane');
function rememberSupervisorPane() {
  const pane = process.env.TMUX_PANE;
  if (!pane || !process.env.TMUX) return;
  if (readText(supervisorPaneFile()) === pane) return;
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(supervisorPaneFile(), pane);
}

function withLock(file, fn) {
  const lock = `${file}.lock`;
  const start = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lock, { recursive: false });
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const age = Date.now() - (fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
      if (age > 10000) {
        fs.rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - start > 15000) die(`timed out waiting for ${lock}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

let mainRefCache;
function mainRef() {
  if (mainRefCache !== undefined) return mainRefCache;
  const b = loadSettings().main_branch;
  for (const r of [`origin/${b}`, b]) if (resolveCommit(r)) return (mainRefCache = r);
  return (mainRefCache = null);
}
const resolveCommit = (ref) => git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);

// The durable copy of a file: main's committed version or this checkout's, whichever extends the
// other (this checkout may not have pulled yet, or may be a plan branch that is ahead).
function durableText(file) {
  const local = readText(path.join(durableLogDir(), file));
  const shown = projectInRepo && mainRef() ? git(['show', `${mainRef()}:${projectRel}/log/${file}`]) : null;
  const main = shown === null ? null : `${shown}\n`;
  if (main === null) return local;
  if (local === null || main.startsWith(local)) return main;
  return local;
}

// Append one object. Under the file's lock: catch a live file up with the durable copy if that is
// ahead, drop a half-written last line, stamp a time after the file's last line (ids unique, lines
// ordered even if the clock steps back), validate exactly what will be read back, write one line.
function appendLog(fields, by = logWriter()) {
  const type = fields.type;
  if (!TYPES.includes(type)) die(`unknown log type ${type}`);
  const f = planFeature(by);
  if (f && fields.op === 'set' && ['feature', 'ticket'].includes(type)) {
    const cur = logGet(fields.id);
    if (cur && (type === 'feature' ? cur.id : cur.feature) !== f) die(`${by} may only change the feature "${f}" and its tickets`);
  }
  const file = logFileFor(by, type);
  const prefix = SCHEMA['x-id'].prefix[type];
  const build = (at) => {
    const id = fields.id ?? `${prefix}-${at.slice(0, 10).replace(/-/g, '')}-${at.slice(11, 23).replace(/[:.]/g, '')}-${by}`;
    const line = { v: 1, id, type, op: fields.op ?? 'new', at, by, ...(by === 'owner' ? { channel: fields.channel ?? ownerChannel() } : {}) };
    for (const [k, val] of Object.entries(fields)) if (!ENVELOPE.includes(k) && val !== undefined) line[k] = val;
    const text = `${JSON.stringify(line)}\n`;
    const parsed = JSON.parse(text);
    const errs = checkLine(parsed, file);
    if (errs.length) die(`log line refused: ${errs.join('; ')}`);
    if (Buffer.byteLength(text) > LINE_MAX) die(`log line is over ${LINE_MAX} bytes; put detail in a file and reference its path`);
    return { parsed, text };
  };
  build(nowIso());
  const planner = isPlanFile(file);
  const dir = planner ? durableLogDir() : liveLogDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, file);
  let result;
  withLock(target, () => {
    let cur = readText(target) ?? '';
    if (!planner) {
      const durable = durableText(file);
      if (durable && durable.length > cur.length && durable.startsWith(cur)) {
        fs.writeFileSync(target, durable);
        cur = durable;
      }
    }
    if (cur && !cur.endsWith('\n')) {
      cur = cur.slice(0, cur.lastIndexOf('\n') + 1);
      fs.writeFileSync(target, cur);
    }
    let lastAt = '';
    try {
      const tail = cur.trimEnd().split('\n').pop();
      lastAt = tail ? JSON.parse(tail).at ?? '' : '';
    } catch {
      lastAt = '';
    }
    let t = Date.now();
    if (lastAt && Date.parse(lastAt) >= t) t = Date.parse(lastAt) + 1;
    result = build(new Date(t).toISOString());
    fs.appendFileSync(target, result.text);
  });
  logCache = null;
  return result.parsed;
}

function logFileText(file) {
  const live = isPlanFile(file) ? null : readText(path.join(liveLogDir(), file));
  const durable = durableText(file);
  if (live === null) return durable ?? '';
  if (durable === null || live.startsWith(durable)) return live;
  if (durable.startsWith(live)) return durable;
  const have = new Set(durable.split('\n'));
  return durable + live.split('\n').filter((l) => l && !have.has(l)).map((l) => `${l}\n`).join('');
}

let logCache = null;
function readLog() {
  if (logCache) return logCache;
  const names = new Set();
  for (const d of [liveLogDir(), durableLogDir()]) if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (f.endsWith('.jsonl')) names.add(f);
  const lines = [];
  const errors = [];
  for (const f of [...names].sort()) {
    const r = parseLines(logFileText(f), f, { validate: false });
    lines.push(...r.lines);
    errors.push(...r.errors);
  }
  const { objects, ignored } = fold(lines);
  return (logCache = { lines, objects, errors, ignored });
}
const logObjects = (type) => [...readLog().objects.values()].filter((o) => o.type === type);
const logGet = (id) => readLog().objects.get(id) ?? null;
const byTime = (a, b) => a.created_at.localeCompare(b.created_at);

// Folded questions in the shape the inbox uses.
function questionView(q) {
  const ans = q.updates.filter((u) => u.answer !== undefined && writerClass(u.by) === 'owner').pop();
  const st = q.updates.filter((u) => u.status !== undefined).pop();
  let status = 'open';
  let answer = null;
  let answeredBy = null;
  let answeredAt = null;
  if (ans) [status, answer, answeredBy, answeredAt] = ['answered', ans.answer, 'owner', ans.at];
  else if (st?.status === 'defaulted') [status, answer, answeredBy, answeredAt] = ['defaulted', q.default, 'supervisor (default)', st.at];
  else if (st?.status === 'withdrawn') [status, answeredAt] = ['withdrawn', st.at];
  // An answer agrees with the recommendation when it is that choice, with or without a note after
  // " — " (the dashboard sends "<label> — <note>").
  const norm = (x) => x.trim().toLowerCase();
  const matched = ans ? !!q.recommendation && [norm(ans.answer), norm(ans.answer.split(' — ')[0])].includes(norm(q.recommendation)) : null;
  return {
    id: q.id, kind: q.kind, class: q.class ?? null, scope: q.scope ?? null, ticket: q.ticket ?? null, re: q.re ?? null, asked_at: q.created_at,
    question: q.question, context: q.context ?? '', options: q.options ?? [], choices: q.choices ?? [], links: q.links ?? [], rule_scope: q.rule_scope ?? null, recommendation: q.recommendation ?? '', confidence: q.confidence ?? null,
    default: q.default ?? null, deadline: q.deadline ?? null, blocks: q.blocks ?? [], evidence: q.evidence ?? [], note: q.note ?? null, why_asked: q.why_asked ?? null,
    status, answer, answered_by: answeredBy, answered_at: answeredAt, matched,
    autonomy: ans ? (q.autonomy ?? null) : null, standing_rule: ans ? (q.standing_rule ?? null) : null, channel: ans?.channel ?? null, said: ans?.said ?? null,
  };
}
const questions = () => logObjects('question').map(questionView);

// The correction on an act, with who made it and when.
const correctionOf = (a) => {
  const u = a.updates.filter((x) => x.corrected !== undefined).pop();
  return u ? { ...u.corrected, by: u.by, at: u.at, repaired: a.repaired ?? null } : null;
};

// --- the log rule for a PR: which log files it may touch, and only by appending valid lines ---
// base..sha may change project/log/<X>.jsonl only if X is the branch's own planner file (plan/<f>)
// or the branch is chore-log (any file but plan-*). Existing lines never change; new lines are
// valid, in time order, in their month, and not in the future.
function logRule(headRef, sha) {
  if (!commonDir || !projectInRepo) return [];
  const base = mainRef() ? git(['merge-base', mainRef(), sha]) : null;
  if (!base) return ['cannot resolve the merge base with main; log changes not checked'];
  const prefix = `${projectRel}/log/`;
  const changed = (git(['diff', '--name-only', '--no-renames', base, sha]) ?? '').split('\n').filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length));
  const fails = [];
  const branch = headRef.replace(/^refs\/heads\//, '');
  const allowed = (name) => (branch === LOG_BRANCH ? !isPlanFile(name) : branch.startsWith('plan/') ? name === `plan-${branch.slice('plan/'.length)}.jsonl` : false);
  for (const name of changed) {
    if (name.includes('/') || !name.endsWith('.jsonl')) { fails.push(`project/log/${name}: the log holds only <writer>.jsonl files`); continue; }
    if (!allowed(name)) { fails.push(`project/log/${name}: this PR may not change it (only chore-log, or a plan/<feature> PR for its own plan-<feature>.jsonl)`); continue; }
    const before = git(['show', `${base}:${prefix}${name}`]);
    const after = git(['show', `${sha}:${prefix}${name}`]);
    if (after === null) { fails.push(`project/log/${name}: log files are never deleted`); continue; }
    const prev = before === null ? '' : `${before}\n`;
    const next = `${after}\n`;
    if (!next.startsWith(prev)) { fails.push(`project/log/${name}: existing lines were changed or removed`); continue; }
    const added = parseLines(next.slice(prev.length), name, { firstLine: prev.split('\n').filter(Boolean).length + 1 });
    fails.push(...added.errors.map((e) => `added ${e}`));
    const lastAt = (t) => t.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l).at ?? ''; } catch { return ''; } }).pop() ?? '';
    let prevAt = lastAt(prev);
    const month = name.match(/-(\d{4}-\d{2})\.jsonl$/)?.[1] && MONTHLY.test(name.replace(/\.jsonl$/, '')) ? name.match(/-(\d{4}-\d{2})\.jsonl$/)[1] : undefined;
    if (before === null) {
      const siblings = (git(['ls-tree', '--name-only', `${base}:${prefix.slice(0, -1)}`]) ?? '').split('\n').filter((x) => x && x !== name && writerOfFile(x) === writerOfFile(name));
      for (const sib of siblings) prevAt = [prevAt, lastAt(`${git(['show', `${base}:${prefix}${sib}`]) ?? ''}\n`)].sort().pop();
    }
    const committedAt = Date.parse(git(['show', '-s', '--format=%cI', sha]) ?? '');
    for (const l of added.lines) {
      if (month && !l.at.startsWith(month)) fails.push(`project/log/${name}:${l.__line}: ${l.at} is not in ${month}`);
      if (l.at < prevAt) fails.push(`project/log/${name}:${l.__line}: ${l.at} is earlier than the line before it`);
      if (!Number.isNaN(committedAt) && Date.parse(l.at) > committedAt + 5 * 60000) fails.push(`project/log/${name}:${l.__line}: ${l.at} is after the commit time`);
      prevAt = l.at;
    }
  }
  return fails;
}

const LOG_BRANCH = 'chore-log';

// Mirror run/log into project/log on branch chore-log, in its own worktree, and open or update the
// log-only PR. Run it every tick (it pushes); merge it daily with `merge --chore log`.
function logPrOpen(wt, main) {
  if (loadSettings().forge !== 'git') {
    const open = sh('gh', ['pr', 'list', '--head', LOG_BRANCH, '--state', 'open', '--json', 'number', '--jq', 'length'], { cwd: wt });
    if (open !== null) return Number(open) > 0;
  }
  // forge git (merge lands a --no-ff merge) or no gh: open means not yet on main
  return git(['merge-base', '--is-ancestor', `origin/${LOG_BRANCH}`, resolveCommit(`origin/${main}`) ? `origin/${main}` : main], wt) === null;
}
function cmdLogSync() {
  supervisorOnly('log-sync');
  if (!commonDir || !projectInRepo) die('log-sync needs a git checkout with the project folder inside it');
  if (repoRoot !== mainRoot) die(`run log-sync from the main checkout (${mainRoot})`);
  const live = liveLogDir();
  const files = fs.existsSync(live) ? fs.readdirSync(live).filter((f) => f.endsWith('.jsonl') && !isPlanFile(f)).sort() : [];
  if (!files.length) return out('nothing in run/log to sync');
  const wt = choreWorktree('log', { reset: true });
  // A sync whose PR is still open is extended, not rebuilt, so every push fast-forwards: forges
  // that refuse non-fast-forward pushes (branch rulesets, protected branches) accept it. The
  // extended branch takes main in by a merge (still a fast-forward for the branch), so its PR is
  // never behind. Whether the PR is open comes from the forge: after a squash or rebase merge the
  // branch is never an ancestor of main, and a stale origin/chore-log outlives a deleted branch.
  const main = loadSettings().main_branch;
  if (!flags['dry-run'] && git(['fetch', '--quiet', 'origin', `+refs/heads/${LOG_BRANCH}:refs/remotes/origin/${LOG_BRANCH}`], wt) === null) git(['update-ref', '-d', `refs/remotes/origin/${LOG_BRANCH}`], wt);
  if (resolveCommit(`origin/${LOG_BRANCH}`) && logPrOpen(wt, main)) {
    gitOrDie(['checkout', '--quiet', '-B', LOG_BRANCH, `origin/${LOG_BRANCH}`], wt);
    const base = resolveCommit(`origin/${main}`) ? `origin/${main}` : main;
    if (git(['merge', '--quiet', '--no-edit', '-m', `chore-log: merge ${main}`, base], wt) === null) {
      git(['merge', '--abort'], wt);
      gitOrDie(['checkout', '--quiet', '-B', LOG_BRANCH, base], wt);
      warn(`${LOG_BRANCH} could not take in ${main}; rebuilt from ${main}, so this push needs the forge to allow replacing ${LOG_BRANCH}`);
    }
  }
  const dest = path.join(wt, projectRel, 'log');
  fs.mkdirSync(dest, { recursive: true });
  let changed = 0;
  const notable = [];
  for (const f of files) {
    let liveText = withLock(path.join(live, f), () => fs.readFileSync(path.join(live, f), 'utf8'));
    liveText = liveText.slice(0, liveText.lastIndexOf('\n') + 1);
    const target = path.join(dest, f);
    const cur = readText(target) ?? '';
    if (cur === liveText || cur.startsWith(liveText)) continue;
    let next = liveText;
    if (!liveText.startsWith(cur)) {
      const have = new Set(cur.split('\n'));
      const extra = liveText.split('\n').filter((l) => l && !have.has(l));
      if (!extra.length) continue;
      warn(`run/log/${f} and main diverged; appending ${extra.length} live line(s) after main's`);
      next = cur + extra.map((l) => `${l}\n`).join('');
    }
    // A file with an invalid line stays behind (the fold already ignores the line; check-pr would
    // refuse the whole sync); the rest still land.
    const added = parseLines(next.slice(cur.length), f, { firstLine: cur.split('\n').filter(Boolean).length + 1 });
    if (added.errors.length) { warn(`run/log/${f} not synced: ${added.errors[0]}${added.errors.length > 1 ? ` (+${added.errors.length - 1} more; devteam.mjs log-check)` : ''}`); continue; }
    for (const l of added.lines) {
      if (l.op === 'set' && ['ticket', 'feature', 'goal', 'question'].includes(l.type) && l.by !== 'owner') notable.push(`${l.by} set ${l.type} ${l.id}: ${Object.keys(l).filter((k) => !ENVELOPE.includes(k) && !k.startsWith('__')).join(', ')}`);
      if (l.op === 'new' && ['ticket', 'feature'].includes(l.type)) notable.push(`${l.by} added ${l.type} ${l.id}`);
    }
    fs.writeFileSync(target, next);
    changed++;
  }
  if (!changed) return out('project/log is up to date');
  if (flags['dry-run']) return out(`${changed} file(s) would be synced`);
  const stamp = nowIso();
  gitOrDie(['add', path.join(projectRel, 'log')], wt);
  gitOrDie(['commit', '--quiet', '-m', `chore-log: log through ${stamp}`], wt);
  gitOrDie(['push', '--quiet', 'origin', `${LOG_BRANCH}:${LOG_BRANCH}`], wt);
  const body = `Mirrors run/log into project/log. Append-only; \`devteam.mjs check-pr\` verifies every added line.${notable.length ? `\n\nChanges to plans, goals and questions by non-owners in this sync:\n${notable.slice(0, 40).map((n) => `- ${n}`).join('\n')}` : ''}`;
  const pr = openPr(wt, LOG_BRANCH, `chore-log: log through ${dateOnly(stamp)}`, body);
  out(`synced ${changed} file(s) to ${LOG_BRANCH}${pr ? `: ${pr}` : ''}`);
}

// Validate every line (live and durable) and list what the fold ignored.
function cmdLogCheck() {
  const names = new Set();
  for (const d of [liveLogDir(), durableLogDir()]) if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (f.endsWith('.jsonl')) names.add(f);
  const fails = [];
  let n = 0;
  for (const f of [...names].sort()) {
    const r = parseLines(logFileText(f), f);
    fails.push(...r.errors);
    n += r.lines.length;
  }
  for (const i of readLog().ignored) out(`ignored: ${i.line.__file}:${i.line.__line} ${i.line.id}: ${i.why}`);
  report(fails, `${n} log line(s)`);
}

function cmdLog() {
  let objs = [...readLog().objects.values()];
  if (flagStr('type')) objs = objs.filter((o) => o.type === flagStr('type'));
  if (flagStr('by')) objs = objs.filter((o) => o.created_by === flagStr('by'));
  if (flagStr('id')) objs = objs.filter((o) => o.id === flagStr('id'));
  objs.sort(byTime);
  objs = objs.slice(-Number(flagStr('tail') ?? 50));
  if (flags.json) return json(objs);
  for (const o of objs) {
    const what = o.question ?? o.statement ?? o.title ?? o.what ?? o.detail ?? o.text ?? (o.type === 'phase' ? `${o.from ?? '-'} -> ${o.to}` : o.type === 'gate' ? `${o.gate} ${o.ok ? 'ok' : 'FAIL'} ${o.ms}ms` : '');
    out(`${o.created_at} ${o.id} [${o.type}${o.kind ? ` ${o.kind}` : ''}${o.status ? ` ${o.status}` : ''}] ${String(what).slice(0, 160)}`);
  }
}

function report(fails, okMsg) {
  for (const f of fails) out(`fail: ${f}`);
  if (fails.length) process.exit(1);
  out(`ok: ${okMsg}`);
}
// ===== 4. facts from git =====

let mainLogCache;
function mainLog() {
  if (mainLogCache) return mainLogCache;
  const ref = mainRef();
  // First-parent only: merge and squash commits are on it; a branch's own commits are not.
  const o = ref ? git(['log', ref, '--first-parent', '--format=%H%x09%s']) : null;
  return (mainLogCache = (o ? o.split('\n') : []).filter(Boolean).map((l) => {
    const [sha, ...r] = l.split('\t');
    return { sha, subject: r.join('\t') };
  }));
}
let mergeParentsCache;
function mergeParents() {
  if (mergeParentsCache) return mergeParentsCache;
  const ref = mainRef();
  const o = ref ? git(['log', ref, '--merges', '--first-parent', '-n', '500', '--format=%H %P']) : null;
  return (mergeParentsCache = (o ? o.split('\n') : []).filter(Boolean).map((l) => l.split(' ')));
}
function ticketBranchRef(id) {
  for (const r of [`refs/heads/ticket/${id}`, `refs/remotes/origin/ticket/${id}`]) if (resolveCommit(r)) return r;
  return null;
}
// The commit on main that landed a ticket: a merge from ticket/<id>, a squash titled "<id>: …", or
// a merge whose second parent contains the branch tip and whose first parent does not.
const mergeShaCache = new Map();
function mergeShaFor(id) {
  if (mergeShaCache.has(id)) return mergeShaCache.get(id);
  const done = (v) => (mergeShaCache.set(id, v), v);
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fromBranch = new RegExp(`from \\S*ticket/${esc}$`);
  for (const { sha, subject } of mainLog()) if (fromBranch.test(subject) || subject.startsWith(`${id}:`)) return done(sha);
  const ref = mainRef();
  if (!ref) return done(null);
  for (const r of [`refs/heads/ticket/${id}`, `refs/remotes/origin/ticket/${id}`]) {
    const tip = resolveCommit(r);
    if (!tip || git(['merge-base', '--is-ancestor', tip, ref]) === null) continue;
    for (const [sha, p1, p2] of mergeParents()) {
      if (p2 && git(['merge-base', '--is-ancestor', tip, p2]) !== null && git(['merge-base', '--is-ancestor', tip, p1]) === null) return done(sha);
    }
  }
  return done(null);
}
const mergedAtCache = new Map();
function mergedAt(id) {
  if (!mergedAtCache.has(id)) {
    const sha = mergeShaFor(id);
    const t = sha ? Date.parse(git(['show', '-s', '--format=%cI', sha]) ?? '') : NaN;
    mergedAtCache.set(id, Number.isNaN(t) ? null : t);
  }
  return mergedAtCache.get(id);
}
function releasedIn(sha) {
  const tags = git(['tag', '--contains', sha, '--list', 'v*', '--sort=creatordate']);
  return (tags ?? '').split('\n').find((t) => t && !/-rc/.test(t)) ?? null;
}
// Read a project file from a git ref (a ticket's branch, an exact head) or the working tree.
function srcRead(src, rel) {
  if (src.ref && projectInRepo) return git(['show', `${src.ref}:${projectRel}/${rel}`]);
  return readText(path.join(projectDir, rel));
}
function srcList(src, relDir) {
  if (src.ref && projectInRepo) return (git(['ls-tree', '--name-only', `${src.ref}:${projectRel}/${relDir}`]) ?? '').split('\n').filter(Boolean);
  const p = path.join(projectDir, relDir);
  return fs.existsSync(p) ? fs.readdirSync(p) : [];
}
const WORKTREE = { ref: null };
// A project file from this checkout, or main's copy when this checkout lacks it.
const projectFileText = (rel) => readText(path.join(projectDir, rel)) ?? (projectInRepo && mainRef() ? git(['show', `${mainRef()}:${projectRel}/${rel}`]) : null);

// ===== 5. the graph (tickets and features, folded from the log) =====

const tickets = () => new Map(logObjects('ticket').map((t) => [t.id, t]));
const features = () => new Map(logObjects('feature').map((f) => [f.id, f]));
const isActive = (t) => !t.superseded_by;
// A held ticket is one the supervisor chose not to schedule yet (`ticket set <id> --json '{"held": "why"}'`; null releases it).
const isHeld = (t) => typeof t.held === 'string' && t.held.trim() !== '';
const activeTickets = () => new Map([...tickets()].filter(([, t]) => isActive(t)));
const weight = (t) => (t.size === 'M' ? 2 : 1);

function closures(ts) {
  const memo = new Map();
  const visit = (id, stack = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    if (stack.has(id)) return new Set();
    stack.add(id);
    const o = new Set();
    for (const d of ts.get(id)?.depends_on ?? []) if (ts.has(d)) { o.add(d); for (const x of visit(d, stack)) o.add(x); }
    stack.delete(id);
    memo.set(id, o);
    return o;
  };
  for (const id of ts.keys()) visit(id);
  return memo;
}
function findCycle(ts) {
  const state = new Map();
  const stack = [];
  const dfs = (id) => {
    state.set(id, 1);
    stack.push(id);
    for (const d of ts.get(id)?.depends_on ?? []) {
      if (!ts.has(d)) continue;
      if (state.get(d) === 1) return [...stack.slice(stack.indexOf(d)), d];
      if (!state.has(d)) { const c = dfs(d); if (c) return c; }
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const id of ts.keys()) if (!state.has(id)) { const c = dfs(id); if (c) return c; }
  return null;
}
// Longest dependency chain, weighted S = 1, M = 2.
function criticalPath(ts) {
  const best = new Map();
  const longest = (id) => {
    if (best.has(id)) return best.get(id);
    let top = { len: 0, path: [] };
    for (const d of ts.get(id).depends_on ?? []) if (ts.has(d)) { const r = longest(d); if (r.len > top.len) top = r; }
    const res = { len: top.len + weight(ts.get(id)), path: [...top.path, id] };
    best.set(id, res);
    return res;
  };
  let crit = { len: 0, path: [] };
  for (const id of ts.keys()) { const r = longest(id); if (r.len > crit.len) crit = r; }
  return crit;
}
// Dependency depth (0-based) of every ticket in a subgraph without cycles.
function levels(ts) {
  const level = new Map();
  const lvl = (id) => {
    if (level.has(id)) return level.get(id);
    const deps = (ts.get(id).depends_on ?? []).filter((d) => ts.has(d));
    const v = deps.length ? 1 + Math.max(...deps.map(lvl)) : 0;
    level.set(id, v);
    return v;
  };
  for (const id of ts.keys()) lvl(id);
  return level;
}

// touches entries: a plain path matches itself and everything beneath it; globs use * ** ? {a,b}.
const escRe = (s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&');
const hasWild = (g) => /[*?{[]/.test(g);
const unbalanced = (g) => (g.match(/\{/g) ?? []).length !== (g.match(/\}/g) ?? []).length;
function globToRegex(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = g.indexOf('}', i);
      if (end === -1) { re += '\\{'; continue; }
      re += `(${g.slice(i + 1, end).split(',').map(escRe).join('|')})`;
      i = end;
    } else re += escRe(c);
  }
  return new RegExp(`^${re}$`);
}
const trimSlash = (p) => p.replace(/\/+$/, '');
const staticPrefix = (g) => { const i = g.search(/[*?{[]/); return i === -1 ? g : g.slice(0, i); };
function pathMatches(entry, file) {
  if (!hasWild(entry)) { const e = trimSlash(entry); return file === e || file.startsWith(`${e}/`); }
  return globToRegex(entry).test(file);
}
// Conservative: may report an overlap that isn't real, never misses one.
function globsOverlap(a, b) {
  if (!hasWild(a) && !hasWild(b)) { const x = trimSlash(a), y = trimSlash(b); return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`); }
  if (!hasWild(a)) return pathMatches(b, trimSlash(a)) || staticPrefix(b).startsWith(`${trimSlash(a)}/`);
  if (!hasWild(b)) return globsOverlap(b, a);
  const pa = staticPrefix(a), pb = staticPrefix(b);
  return pa.startsWith(pb) || pb.startsWith(pa);
}

// Live state of a ticket's worker: its last phase line, and its last line of any kind.
function workerState(id) {
  const mine = readLog().lines.filter((l) => l.by === id);
  if (!mine.length) return null;
  const phases = mine.filter((l) => l.type === 'phase').sort((a, b) => a.at.localeCompare(b.at));
  const last = phases[phases.length - 1];
  const lastSeen = mine.map((l) => l.at).sort().pop();
  const cost = [...phases].reverse().find((p) => typeof p.usd === 'number');
  return {
    phase: last?.to ?? null, task: last?.task ?? null, note: last?.note ?? null, head_sha: last?.sha ?? null,
    started_at: phases[0]?.at ?? mine[0].at, last_seen: lastSeen,
    minutes_silent: Math.round((Date.now() - Date.parse(lastSeen)) / 60000),
    usd: cost?.usd ?? 0, input_tokens: cost?.input_tokens ?? 0, output_tokens: cost?.output_tokens ?? 0,
  };
}
const activeWorker = (id) => { const w = workerState(id); return !!w && w.phase && !['done', 'parked'].includes(w.phase) && !mergeShaFor(id); };

// What a worker's pane is stuck on, if anything: a question the agent CLI put up (a permission or
// trust prompt, a y/n) or a usage-limit banner. The log can't show these (the worker is frozen
// mid-phase, so it isn't stale yet); the pane can. Only the bottom of the visible pane is read and
// nothing is typed: clearing it is the supervisor's call (supervisor.md §11). Once per process.
const PANE_WAITS = [
  ['limit', /usage limit|rate limit|limit reached|limit will reset|resets? at \d/i],
  ['prompt', /Do you want to (proceed|make this edit|create|allow|run)|Do you trust the files|\[y\/n\]|\(y\/n\)|Press Enter to continue|❯\s*1\.\s*Yes/i],
];
const paneWaits = new Map();
function paneWaiting(id) {
  if (paneWaits.has(id)) return paneWaits.get(id);
  let found = null;
  if (activeWorker(id)) {
    const { target } = resolvePane(`${loadSettings().tmux_session}:${id}`);
    const lines = target ? (sh('tmux', ['capture-pane', '-p', '-t', target]) ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(-15) : [];
    for (const [kind, re] of PANE_WAITS) {
      const hit = lines.find((l) => re.test(l));
      if (hit) { found = { kind, line: hit.slice(0, 200) }; break; }
    }
  }
  paneWaits.set(id, found);
  return found;
}

// The supervisor's approval of a ticket's spec or plan is an act that refers to the ticket.
const approvalOf = (id, cls) => logObjects('act').filter((a) => a.class === cls && (a.refs ?? []).includes(id)).sort(byTime).pop() ?? null;

// Computed stage of every ticket: git says merged and released; approval acts say spec'd and
// planned; the branch's committed review records say in review; phase lines say what the worker
// is doing right now.
function deriveStatus() {
  const ts = tickets();
  return [...ts.values()].map((t) => {
    const mergeSha = mergeShaFor(t.id);
    const branch = ticketBranchRef(t.id);
    const src = branch && !mergeSha ? { ref: branch } : WORKTREE;
    const spec = approvalOf(t.id, 'approve-spec') ? 'approved' : null;
    const plan = approvalOf(t.id, 'approve-plan') ? 'approved' : null;
    const reviews = ticketReviews(t.id, src);
    const depsMerged = (t.depends_on ?? []).every((d) => mergeShaFor(d));
    let stage = 'planned';
    if (t.superseded_by) stage = 'superseded';
    else if (mergeSha) stage = releasedIn(mergeSha) ? 'released' : 'merged';
    else if (reviews.some((r) => r.stage === 'final')) stage = 'in-review';
    else if (branch && plan === 'approved' && depsMerged) stage = 'building';
    else if (plan === 'approved') stage = 'planned-in-detail';
    else if (spec === 'approved') stage = "spec'd";
    else if (depsMerged) stage = 'ready';
    const w = workerState(t.id);
    return {
      id: t.id, title: t.title, feature: t.feature, component: t.component, kind: t.kind, size: t.size, risk: t.risk, serves: t.serves ?? [], depends_on: t.depends_on ?? [],
      stage, merge_sha: mergeSha, branch, deps_merged: depsMerged, held: isHeld(t) ? t.held : null,
      phase: w?.phase ?? null, task: w?.task ?? null, note: w?.note ?? null, minutes_silent: w?.minutes_silent ?? null, usd: w?.usd ?? null,
      waiting: paneWaiting(t.id),
    };
  });
}

const onPlanBranch = () => (git(['rev-parse', '--abbrev-ref', 'HEAD']) ?? '').startsWith('plan/');

function cmdValidate() {
  const ts = tickets();
  const fs_ = features();
  const errors = [];
  const warnings = [];
  const err = (id, m) => errors.push(`${id}: ${m}`);
  const STORY_RE = /^[A-Z][A-Z0-9]*-S[0-9]+$/;
  for (const [id, t] of ts) {
    if (!id.startsWith(`${t.component}-`)) err(id, `id must start with its component "${t.component}-"`);
    for (const g of t.touches ?? []) if (unbalanced(g)) err(id, `touches entry "${g}" has unbalanced braces`);
    for (const d of t.depends_on ?? []) {
      if (d === id) err(id, 'depends on itself');
      else if (!ts.has(d)) err(id, `depends_on "${d}" does not exist (D3)`);
      else if (!isActive(ts.get(d)) && isActive(t)) err(id, `depends_on "${d}" is superseded; depend on its replacement`);
    }
    if (t.superseded_by && !ts.has(t.superseded_by)) err(id, `superseded_by "${t.superseded_by}" does not exist`);
    if ((t.one_way_doors ?? []).length && t.risk !== 'high') err(id, 'lists a one-way door, so risk must be high (D8)');
    if (t.feature === CHORES && !['chore', 'spike'].includes(t.kind)) err(id, `only chore and spike tickets may use the reserved feature "${CHORES}"`);
    if (isActive(t) && ['chore', 'spike'].includes(t.kind) && !(t.serves ?? []).length && !t.notes) err(id, `${t.kind} ticket serving no story must say why in notes (D6)`);
    if (isActive(t) && !['chore', 'spike'].includes(t.kind) && !(t.serves ?? []).length) err(id, 'must serve at least one story (D6)');
    if (t.kind === 'contract' && !(t.contracts?.provides ?? []).length) err(id, 'contract ticket must list contracts.provides (D2)');
    if (t.feature !== CHORES && !fs_.has(t.feature)) err(id, `feature "${t.feature}" is not in the log (devteam.mjs feature add)`);
  }
  const cycle = findCycle(ts);
  if (cycle) errors.push(`dependency cycle: ${cycle.join(' -> ')} (D3)`);

  // Features: every story defined is served and every story served is defined (D6); a story across
  // components has an integration ticket (D7); an approved feature has reviews and ready goals.
  for (const [fid, f] of fs_) {
    const stories = new Set((f.stories ?? []).map((s) => s.id));
    const mine = [...ts.values()].filter((t) => isActive(t) && t.feature === fid);
    const served = new Set();
    for (const t of mine) for (const s of t.serves ?? []) { if (!stories.has(s)) err(t.id, `serves "${s}", which feature ${fid} does not define`); served.add(s); }
    for (const s of stories) if (!served.has(s)) errors.push(`feature ${fid}: story ${s} is served by no ticket (D6)`);
    for (const s of stories) {
      const servers = mine.filter((t) => (t.serves ?? []).includes(s));
      const comps = new Set(servers.filter((t) => t.kind !== 'contract').map((t) => t.component));
      if (comps.size > 1 && !servers.some((t) => t.kind === 'integration')) warnings.push(`feature ${fid}: story ${s} spans ${[...comps].join(', ')} but has no integration ticket (D7)`);
    }
    // A feature that has reached this checkout is landed (or being planned here): its design and
    // graph reviews must say APPROVE. On a plan/<feature> branch that is a warning until review.
    {
      const sink = onPlanBranch() && !flags.strict ? warnings : errors;
      const reviews = featureReviews(fid);
      const designSlug = f.design ? path.basename(f.design, '.md') : null;
      const designReviews = designSlug ? reviewRecordsIn(WORKTREE, `reviews/${designSlug}`) : [];
      for (const r of [...reviews, ...designReviews]) {
        if (r.verdict && !r.reviewer) errors.push(`feature ${fid}: review ${r.file} has no "- Reviewer:" line`);
        if (r.verdict && !r.shaValid) errors.push(`feature ${fid}: review ${r.file} needs the full 40-character SHA`);
      }
      // In strict mode (a plan PR) each verdict must also hold at this head: nothing but review
      // records added since the commit it names (quality.md §3).
      const landed = mainRef() && git(['rev-parse', '--verify', '--quiet', `${mainRef()}:${projectRel}/log/plan-${fid}.jsonl`]) !== null;
      const head = flags.strict && commonDir && !landed ? resolveCommit('HEAD') : null;
      const holds = (r) => !head || verdictHolds(r.sha, head, `${projectRel}/reviews/`);
      const lg = latestPerTrack(reviews, 'graph');
      if (!lg.length) sink.push(`feature ${fid}: no graph review in project/reviews/${fid}/graph-<n>.md`);
      else if (lg.some((r) => r.verdict !== 'APPROVE')) sink.push(`feature ${fid}: the latest graph review is not APPROVE`);
      else for (const r of lg.filter((x) => !holds(x))) errors.push(`feature ${fid}: graph review ${r.file} is at ${(r.sha ?? '').slice(0, 12)}, which does not hold at HEAD (something other than review records changed since); review again`);
      if (!f.design) errors.push(`feature ${fid} names no design (project/designs/<slug>.md)`);
      else if (!projectFileText(f.design.replace(/^project\//, ''))) errors.push(`feature ${fid}: design ${f.design} does not exist`);
      else {
        const ld = latestPerTrack(designReviews, 'design');
        if (!ld.length) sink.push(`feature ${fid}: design ${f.design} has no review in project/reviews/${designSlug}/design-<n>.md`);
        else if (ld.some((r) => r.verdict !== 'APPROVE')) sink.push(`feature ${fid}: the latest design review is not APPROVE`);
        else for (const r of ld.filter((x) => !holds(x))) errors.push(`feature ${fid}: design review ${r.file} is at ${(r.sha ?? '').slice(0, 12)}, which does not hold at HEAD; review again`);
      }
      if (!(f.goals ?? []).length) errors.push(`feature ${fid} names no goal`);
      for (const g of f.goals ?? []) {
        const o = logGet(g);
        if (o?.type !== 'goal') errors.push(`feature ${fid} names goal ${g}, which is not in the log`);
        else if (!['ready', 'met'].includes(o.status)) errors.push(`feature ${fid} names goal ${g}, which is ${o.status ?? 'draft'}; the owner approves a goal before features are planned from it`);
      }
    }
  }

  // D4: tickets that can run at the same time must have disjoint footprints. Merged ones are history.
  if (!cycle) {
    const clos = closures(ts);
    const live = [...ts.values()].filter((t) => isActive(t) && !mergeShaFor(t.id));
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (clos.get(a.id)?.has(b.id) || clos.get(b.id)?.has(a.id)) continue;
      outer: for (const ga of a.touches ?? []) for (const gb of b.touches ?? []) if (globsOverlap(ga, gb)) { errors.push(`${a.id} and ${b.id} can run concurrently but both touch "${ga}" / "${gb}" (D4)`); break outer; }
    }
  }

  for (const e of readLog().errors) warnings.push(`log ${e}`);
  for (const i of readLog().ignored) if (['ticket', 'feature'].includes(i.line.type) && i.why === 'duplicate id') errors.push(`${i.line.id}: a second ${i.line.type} line with this id (${i.line.__file}:${i.line.__line}) was ignored; use ${i.line.type} set`);
  const raw = ladder().raw_ceilings;
  for (const [c, v] of Object.entries(loadSettings().autonomy_ceilings ?? {})) {
    if (raw[c] === undefined) errors.push(`settings autonomy_ceilings: "${c}" is not a ladder class in constitution.md`);
    else if (v > raw[c]) errors.push(`settings autonomy_ceilings: ${c} ${v} is above the constitution's ceiling ${raw[c]}; a project may only lower it`);
  }
  const td = path.join(projectDir, 'tickets');
  if (fs.existsSync(td)) for (const f of fs.readdirSync(td)) if (!f.startsWith('.') && !ts.has(f)) errors.push(`project/tickets/${f}/ has no ticket`);

  for (const w of warnings) out(`warning: ${w}`);
  for (const e of errors) out(`error: ${e}`);
  out(`${ts.size} ticket(s), ${fs_.size} feature(s), ${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(errors.length ? 1 : 0);
}

// Why a ticket with no worker isn't waiting for one, or null if it is: the supervisor parked its
// last worker (a ruling stopped it), or its branch already carries a final review (it waits for
// the merge, not for a new worker).
function notSchedulable(t) {
  if (workerState(t.id)?.phase === 'parked') return 'parked';
  const b = ticketBranchRef(t.id);
  if (b && ticketReviews(t.id, { ref: b }).some((r) => r.stage === 'final')) return 'in review';
  return null;
}
function cmdReady() {
  const ts = tickets();
  const rows = [];
  const held = [];
  const waiting = [];
  for (const t of ts.values()) {
    if (!isActive(t) || mergeShaFor(t.id) || activeWorker(t.id)) continue;
    const why = notSchedulable(t);
    if (why) { waiting.push({ id: t.id, why }); continue; }
    const depsMerged = (t.depends_on ?? []).every((d) => mergeShaFor(d));
    if (isHeld(t)) { if (depsMerged || flags['plan-ahead']) held.push({ id: t.id, held: t.held }); continue; }
    if (depsMerged || flags['plan-ahead']) rows.push({ id: t.id, component: t.component, kind: t.kind, size: t.size, risk: t.risk, mode: depsMerged ? 'build' : 'plan-ahead' });
  }
  const s = loadSettings();
  const active = [...ts.keys()].filter(activeWorker);
  const perComponent = {};
  for (const id of active) perComponent[ts.get(id).component] = (perComponent[ts.get(id).component] ?? 0) + 1;
  if (flags.json) return json({ ready: rows, held, waiting, active, active_per_component: perComponent, caps: { max_active_tickets: s.max_active_tickets, max_active_per_component: s.max_active_per_component } });
  out(`active workers: ${active.length}/${s.max_active_tickets}`);
  for (const h of held) out(`held       ${h.id}  (${h.held})`);
  for (const w of waiting) out(`${w.why.padEnd(10)} ${w.id}  (no new worker: ${w.why === 'parked' ? 'resume it with `worker <id> --resume` when its ruling allows' : 'merge or answer its review'})`);
  if (!rows.length) return out('nothing ready');
  for (const r of rows) out(`${r.mode.padEnd(10)} ${r.id}  (${r.kind}, ${r.size}, ${r.risk})${(perComponent[r.component] ?? 0) >= s.max_active_per_component ? '  (component at cap)' : ''}`);
}

function cmdWaves() {
  const f = flagStr('feature');
  const sub = new Map([...activeTickets()].filter(([, t]) => !f || t.feature === f));
  if (findCycle(sub)) die('the graph has a cycle; run validate');
  const level = levels(sub);
  const crit = criticalPath(sub);
  const waves = [];
  for (const [id, l] of level) (waves[l] ??= []).push(id);
  if (flags.json) return json({ waves, critical_path: crit.path, critical_weight: crit.len });
  waves.forEach((w, i) => out(`wave ${i + 1} (${w.length}): ${w.sort().join(', ')}`));
  out(`critical path (weight ${crit.len}, S=1 M=2): ${crit.path.join(' -> ')}`);
}

function cmdStatus() {
  const rows = deriveStatus();
  if (flags.json) return json({ generated_at: nowIso(), tickets: rows, reviews: reviewStats() });
  const stale = loadSettings().stale_after_minutes;
  for (const r of rows) {
    const waiting = ['awaiting-word', 'blocked'].includes(r.phase) && !r.merge_sha;
    const isStale = r.minutes_silent > stale && !waiting && !['done', 'parked'].includes(r.phase) && !r.merge_sha;
    out(`${r.stage.padEnd(18)} ${r.id}${r.phase ? `  [${r.phase}${r.task ? ` ${r.task}` : ''}, ${r.minutes_silent}m${r.waiting ? ` WAITING ON A ${r.waiting.kind === 'limit' ? 'USAGE LIMIT' : 'PROMPT'}: ${r.waiting.line}` : isStale ? ' STALE' : waiting && r.minutes_silent > stale ? ' WAITING ON SUPERVISOR' : ''}]` : ''}`);
  }
  for (const [stage, v] of Object.entries(reviewStats().by_stage)) out(`review ${stage}: first-pass rejection ${v.rejected}/${v.first_passes}`);
}

// ticket add <id> --json '{…}' | --file f ; ticket set <id> --json '{…}' ; feature add/set likewise.
function cmdTicket() { graphEdit('ticket', SCHEMA['x-id'].keyed.ticket); }
function cmdFeature() { graphEdit('feature', SCHEMA['x-id'].keyed.feature); }
function graphEdit(type, idRe) {
  const [sub, id] = positional;
  const by = logWriter();
  if (!['add', 'set', 'show'].includes(sub) || !id) die(`usage: ${type} add <id> --json '{…}' | --file <path>   |   ${type} set <id> --json '{…}'   |   ${type} show <id>`);
  if (sub === 'show') return json(logGet(id) ?? die(`no ${type} ${id}`));
  if (!new RegExp(idRe).test(id)) die(`${type} id "${id}" must match ${idRe}`);
  if (!['supervisor', 'planner'].includes(writerClass(by))) die(`${type}s are written by the supervisor or a planner (plan-<feature>)`);
  let body;
  try {
    body = JSON.parse(flagStr('json') ?? (flagStr('file') ? fs.readFileSync(flagStr('file'), 'utf8') : die(`${type} ${sub} needs --json or --file`)));
  } catch (e) {
    die(`not valid JSON: ${e.message}`);
  }
  if (sub === 'add' && logGet(id)) die(`${id} exists; use ${type} set`);
  if (sub === 'set' && logGet(id)?.type !== type) die(`no ${type} ${id}`);
  const line = appendLog({ ...body, type, id, op: sub === 'add' ? 'new' : 'set' }, by);
  if (by === 'supervisor') appendLog({ type: 'act', class: sub === 'add' ? 'add-ticket' : 'replan-within-feature', what: `${sub === 'add' ? 'added' : 'changed'} ${type} ${id}${sub === 'set' ? ` (${Object.keys(body).join(', ')})` : ''}`, refs: [id], reversible: true }, 'supervisor');
  out(`${sub === 'add' ? 'added' : 'updated'} ${line.id}`);
}

// ===== 6. review records and the definition of done =====

// A cell may hold an escaped pipe (\|), as GitHub tables allow; only an unescaped | separates cells.
const tableCells = (row) => row.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

// A record is <stage>-<pass>[<track>].md with "- Reviewer: <name>" and a last line
// "Verdict: APPROVE|CHANGES <full sha>"; findings are table rows F<n> with a Disposition column.
function parseReview(file, text) {
  const m = file.match(/^([a-z]+)-(\d+)([a-z]?)\.md$/);
  const verdict = [...text.matchAll(/^Verdict:[ \t]*(APPROVE|CHANGES)[ \t]+(\S+)[ \t]*$/gm)].pop();
  const reviewerRaw = text.match(/^-[ \t]*Reviewer:[ \t]*(.*)$/m)?.[1]?.trim() ?? '';
  const findings = [];
  let dispIdx = -1;
  let sevIdx = 1;
  for (const row of text.split('\n')) {
    if (!row.trim().startsWith('|')) continue;
    const cells = tableCells(row);
    const lower = cells.map((c) => c.toLowerCase());
    if (lower.includes('disposition')) { dispIdx = lower.indexOf('disposition'); sevIdx = Math.max(lower.indexOf('severity'), 1); continue; }
    if (/^F\d+$/.test(cells[0] ?? '')) findings.push({ id: cells[0], severity: cells[sevIdx] ?? '', disposition: dispIdx >= 0 ? (cells[dispIdx] ?? '') : '' });
  }
  return {
    file, stage: m ? m[1] : file.replace(/\.md$/, ''), pass: m ? Number(m[2]) : 0, variant: m ? m[3] : '',
    verdict: verdict ? verdict[1] : null, sha: verdict ? verdict[2] : null, shaValid: verdict ? /^[0-9a-f]{40}$/.test(verdict[2]) : false,
    reviewer: reviewerRaw && !reviewerRaw.startsWith('<') ? reviewerRaw : null, findings,
  };
}
const reviewRecordsIn = (src, relDir) => srcList(src, relDir).filter((f) => f.endsWith('.md')).map((f) => parseReview(f, srcRead(src, `${relDir}/${f}`) ?? ''));
const ticketReviews = (id, src) => reviewRecordsIn(src, `tickets/${id}/reviews`);
const featureReviews = (feature) => reviewRecordsIn(WORKTREE, `reviews/${feature}`);
function latestPerTrack(records, stage) {
  const latest = new Map();
  for (const r of records.filter((x) => x.stage === stage)) { const p = latest.get(r.variant); if (!p || r.pass > p.pass) latest.set(r.variant, r); }
  return [...latest.values()];
}
const blocking = (sev) => /^(critical|important)$/i.test(sev);
const disposed = (d) => /^(fixed|wrong|wont-fix\b|won't-fix\b)/i.test(d ?? '');

function reviewStats() {
  const byStage = {};
  let findings = 0;
  let wrong = 0;
  const all = [];
  for (const id of tickets().keys()) { const b = ticketBranchRef(id); all.push(...ticketReviews(id, b && !mergeShaFor(id) ? { ref: b } : WORKTREE)); }
  for (const fid of features().keys()) all.push(...featureReviews(fid));
  for (const r of all) {
    for (const f of r.findings) { findings++; if (/^wrong/i.test(f.disposition)) wrong++; }
    if (r.pass !== 1 || r.variant || !r.verdict) continue;
    byStage[r.stage] ??= { first_passes: 0, rejected: 0 };
    byStage[r.stage].first_passes++;
    if (r.verdict === 'CHANGES') byStage[r.stage].rejected++;
  }
  for (const s of Object.values(byStage)) s.rejection_rate = s.first_passes ? +(s.rejected / s.first_passes).toFixed(2) : null;
  return { by_stage: byStage, findings, false_positive_rate: findings ? +(wrong / findings).toFixed(2) : null };
}
function reviewPasses() {
  const o = {};
  for (const id of tickets().keys()) {
    const b = ticketBranchRef(id);
    const finals = ticketReviews(id, b && !mergeShaFor(id) ? { ref: b } : WORKTREE).filter((r) => r.stage === 'final');
    if (finals.length) o[id] = Math.max(...finals.map((r) => r.pass));
  }
  return o;
}

// The PR body's "## One-way doors" section is "None." or links the owner's answer.
function oneWayDoorsSection(body) {
  const m = body.match(/^##\s+One-way doors\s*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  if (!m) return { ok: false, why: 'PR body has no "## One-way doors" section' };
  const text = m[1].replace(/<!--[\s\S]*?-->/g, '').trim();
  if (text === 'None.') return { ok: true, none: true };
  if (/\bq-\d{8}-\d{6,9}-[a-z0-9-]+\b|https?:\/\/\S+/.test(text)) return { ok: true, none: false };
  return { ok: false, why: 'the "## One-way doors" section must be "None." or link the owner\'s answer (a q-… id or a URL)' };
}

// A verdict at commit V holds at head H only if V is an ancestor of H, nothing between is a merge,
// and every commit V..H just ADDS review-record files under `dir`.
function verdictHolds(v, head, dir) {
  if (!head || !v || !/^[0-9a-f]{40}$/.test(v)) return false;
  if (v === head) return true;
  if (!dir || git(['merge-base', '--is-ancestor', v, head]) === null) return false;
  if ((git(['rev-list', '--merges', `${v}..${head}`]) ?? 'x').trim()) return false;
  return (git(['log', '--no-renames', '--format=', '--name-status', `${v}..${head}`]) ?? '').split('\n').filter(Boolean).every((l) => {
    const [st, file] = l.split('\t');
    return st === 'A' && file.startsWith(dir) && /^(?:[a-z0-9-]+\/)?[a-z]+-\d+[a-z]?\.md$/.test(file.slice(dir.length));
  });
}
const changedFiles = (base, sha) => (git(['diff', '--name-only', '--no-renames', base, sha]) ?? '').split('\n').filter(Boolean);

// Definition of done at an exact head, reading the files committed at that head. The forge's
// check-pr passes approvals: false, because the supervisor's approval acts live in its log.
function checkTicket(id, { sha: shaArg, title, body, approvals = true }) {
  const t = tickets().get(id);
  if (!t) return [`no ticket ${id}`];
  const fails = [];
  if (t.superseded_by) fails.push(`ticket is superseded by ${t.superseded_by}`);
  let sha = null;
  let src = WORKTREE;
  if (commonDir) {
    sha = resolveCommit(shaArg ?? 'HEAD');
    if (!sha) return [`commit ${shaArg} not found locally (fetch it first)`];
    if (projectInRepo) src = { ref: sha };
  }
  const read = (rel) => srcRead(src, `tickets/${id}/${rel}`);
  if (read('spec.md') === null) fails.push('spec.md missing at this head');
  else if (approvals && !approvalOf(id, 'approve-spec')) fails.push('spec not approved (the supervisor logs act --class approve-spec --refs <id>)');
  if (read('plan.md') === null) fails.push('plan.md missing at this head');
  else if (approvals && !approvalOf(id, 'approve-plan')) fails.push('plan not approved (the supervisor logs act --class approve-plan --refs <id>)');
  const verText = read('verification.md');
  if (verText === null) fails.push('verification.md missing: a table with a row per done-when, the command run and its result');
  else {
    const rows = verText.split('\n').filter((l) => /^\|/.test(l.trim()) && !/^\|\s*-/.test(l.trim())).length - 1;
    if (rows < (t.done_when ?? []).length) fails.push(`verification has ${Math.max(rows, 0)} row(s) for ${t.done_when.length} done-when(s)`);
  }
  const reviews = ticketReviews(id, src);
  for (const r of reviews) {
    if (r.verdict && !r.shaValid) fails.push(`${r.file}: the verdict needs the full 40-character SHA`);
    if (r.verdict && !r.reviewer) fails.push(`${r.file}: no "- Reviewer:" line; an unnamed review does not count`);
  }
  // The latest record in every final track must say APPROVE at a commit that holds at this head.
  const reviewsDir = projectInRepo ? `${projectRel}/tickets/${id}/reviews/` : null;
  const holdsAt = (v) => (sha ? verdictHolds(v, sha, reviewsDir) : false);
  const latest = latestPerTrack(reviews, 'final');
  if (!latest.length) fails.push('no final review record (reviews/final-<n>.md)');
  for (const r of latest) {
    if (r.verdict === 'CHANGES') fails.push(`${r.file}: the latest final review in its track says CHANGES`);
    else if (r.verdict !== 'APPROVE') fails.push(`${r.file}: no verdict line (Verdict: APPROVE|CHANGES <sha>)`);
    else if (!holdsAt(r.sha)) fails.push(`${r.file}: its verdict is at ${(r.sha ?? '').slice(0, 12)}, which does not hold at ${sha?.slice(0, 12)}: a verdict holds at its own commit, or at a later head whose only changes are newly added review records`);
  }
  const approvers = new Set(latest.filter((r) => r.verdict === 'APPROVE' && holdsAt(r.sha) && r.reviewer).map((r) => r.reviewer));
  const need = t.risk === 'high' ? 2 : 1;
  if (approvers.size < need) fails.push(`needs ${need} final APPROVE review(s) at this head from different named reviewers; found ${approvers.size}`);
  for (const r of reviews) for (const f of r.findings) if (blocking(f.severity) && !disposed(f.disposition)) fails.push(`${r.file} ${f.id} (${f.severity}) has no disposition`);
  const base = mainRef() && sha ? git(['merge-base', mainRef(), sha]) : null;
  if (commonDir && !base) fails.push(`cannot resolve main branch "${loadSettings().main_branch}"; footprint not checked`);
  if (base) {
    const changed = changedFiles(base, sha);
    const own = projectInRepo ? `${projectRel}/tickets/${id}/` : null;
    const outside = changed.filter((f) => !(own && f.startsWith(own)) && !(t.touches ?? []).some((g) => pathMatches(g, f)));
    if (outside.length) fails.push(`changes files outside touches: ${outside.slice(0, 10).join(', ')}${outside.length > 10 ? ` (+${outside.length - 10} more)` : ''}`);
  }
  if (title !== undefined && !new RegExp(`^${id.replace(/-/g, '\\-')}: \\S`).test(title)) fails.push(`PR title must start with "${id}: "`);
  if (body !== undefined) {
    const owd = oneWayDoorsSection(body);
    if (!owd.ok) fails.push(owd.why);
    else if (owd.none && (t.one_way_doors ?? []).length) fails.push('the ticket lists one-way doors but the PR body says "None."; link the owner\'s answer');
  }
  return fails;
}
function cmdCheckTicket() {
  const id = positional[0] ?? die('usage: check-ticket <ticket-id> [--sha <head>] [--title "<pr title>"] [--body-file <path>] [--pr <n>]');
  let title = flagStr('title');
  let body = flagStr('body-file') ? fs.readFileSync(flagStr('body-file'), 'utf8') : undefined;
  let sha = flagStr('sha');
  if (flagStr('pr')) {
    const pr = sh('gh', ['pr', 'view', flagStr('pr'), '--json', 'title,body,headRefOid']);
    if (!pr) die('gh pr view failed');
    const p = JSON.parse(pr);
    title ??= p.title; body ??= p.body; sha ??= p.headRefOid;
  }
  report(checkTicket(id, { sha, title, body }), `${id} meets the definition of done at ${(resolveCommit(sha ?? 'HEAD') ?? '').slice(0, 12)}`);
}


// What the forge's check (optional) and `merge` both check for a PR, by branch kind. Gates are not
// run here. A chore PR may not touch the log (chore-log touches nothing else) or a ticket's folder.
function checkPr({ headRef, sha, title, body, forge = false }) {
  const branch = headRef.replace(/^refs\/heads\//, '');
  const fails = logRule(branch, sha);
  if (branch.startsWith('ticket/')) return [...fails, ...checkTicket(branch.slice('ticket/'.length), { sha, title, body, approvals: !forge })];
  if (branch.startsWith('plan/')) {
    const feature = branch.slice('plan/'.length);
    if (title !== undefined && !title.startsWith(`plan-${feature}: `)) fails.push(`PR title must start with "plan-${feature}: "`);
    // validate --strict at the exact head, in a detached worktree of that head.
    const wt = detachedWorktree(sha, `check-${feature}`);
    try {
      execFileSync(process.execPath, [path.join(wt, 'docs', 'devteam', 'scripts', 'devteam.mjs'), 'validate', '--strict'], { cwd: wt, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      fails.push(`validate --strict fails at ${sha.slice(0, 12)}:\n${(e.stdout ?? '').toString().trim()}`);
    } finally {
      git(['worktree', 'remove', '--force', wt], mainRoot);
    }
  } else {
    if (!/^chore-[a-z0-9]+([.-][a-z0-9]+)*: \S/.test(title ?? 'chore-x: y')) fails.push('a PR that is not from a ticket/ or plan/ branch is titled "chore-<slug>: <summary>"');
    const base = mainRef() ? git(['merge-base', mainRef(), sha]) : null;
    const changed = base ? changedFiles(base, sha) : [];
    const logDir = `${projectRel}/log/`;
    const stray = branch === LOG_BRANCH ? changed.filter((f) => !f.startsWith(logDir)) : changed.filter((f) => f.startsWith(logDir) || f.startsWith(`${projectRel}/tickets/`));
    if (stray.length) fails.push(`${branch === LOG_BRANCH ? 'chore-log changes only project/log' : 'a chore PR never touches project/log or project/tickets'}: ${stray.slice(0, 8).join(', ')}${stray.length > 8 ? ` (+${stray.length - 8})` : ''}`);
  }
  if (body !== undefined && !branch.startsWith('ticket/')) {
    const owd = oneWayDoorsSection(body);
    if (!owd.ok) fails.push(owd.why);
  }
  return fails;
}
// Copy settings.worktree_files from the main checkout into a new worktree.
// Then run settings.worktree_setup there (with DEVTEAM_MAIN set to the main checkout).
// What every gate and worktree_setup command sees: the main checkout, and a gitignored cache dir
// for build outputs and package caches shared across worktrees (quality.md §2).
const gateEnv = () => { const cache = path.join(runDir, 'cache'); fs.mkdirSync(cache, { recursive: true }); return { ...process.env, DEVTEAM_MAIN: mainRoot, DEVTEAM_CACHE: cache }; };
function seedWorktree(wt, { setup = true } = {}) {
  const s = loadSettings();
  for (const rel of s.worktree_files ?? []) {
    const from = path.join(mainRoot, rel);
    if (!fs.existsSync(from)) { warn(`worktree_files: ${rel} is not in the main checkout`); continue; }
    fs.mkdirSync(path.dirname(path.join(wt, rel)), { recursive: true });
    fs.copyFileSync(from, path.join(wt, rel));
  }
  if (setup && s.worktree_setup) {
    try {
      execFileSync('sh', ['-c', s.worktree_setup], { cwd: wt, stdio: ['ignore', 'inherit', 'inherit'], env: gateEnv() });
    } catch {
      die(`worktree_setup failed in ${wt}`);
    }
  }
}
// A throwaway checkout of one commit, removed when the process ends however it ends.
function detachedWorktree(sha, name) {
  const wt = path.join(mainRoot, '.worktrees', `tmp-${name}-${process.pid}`);
  gitOrDie(['worktree', 'add', '--quiet', '--detach', wt, sha], mainRoot);
  process.once('exit', () => { if (fs.existsSync(wt)) git(['worktree', 'remove', '--force', wt], mainRoot); });
  seedWorktree(wt);
  return wt;
}
function cmdCheckPr() {
  const headRef = flagStr('head-ref') ?? die('check-pr needs --head-ref (and --sha, --title, --body-file)');
  const sha = resolveCommit(flagStr('sha') ?? 'HEAD') ?? die('cannot resolve the head');
  const body = flagStr('body-file') ? fs.readFileSync(flagStr('body-file'), 'utf8') : undefined;
  report(checkPr({ headRef, sha, title: flagStr('title'), body, forge: true }), `${headRef} passes the checks at ${sha.slice(0, 12)} (gates and the supervisor's approval acts are merge's to check)`);
}
// An owner-answered question, for commands that need the owner's yes.
// A standing approval for upstream syncs: an accepted owner rule scoped chore:devteam-sync
// (`answer <qid> "…" --rule "<rule>" --rule-scope chore:devteam-sync`) approves a
// chore-devteam-sync-<tag> merge in place of a fresh answer, but only when every file the chore
// changes outside project/ is inside the kit and byte-identical to that tag upstream. Anything the
// supervisor wrote itself still needs the owner's answer.
function upstreamSyncApproval(chore, sha, changed) {
  const rule = logObjects('knowledge').filter((k) => k.created_by === 'owner' && k.scope === 'chore:devteam-sync' && k.status === 'accepted').sort(byTime).pop();
  if (!rule) return {};
  const s = loadSettings();
  const src = /^[\w.-]+\/[\w.-]+$/.test(s.upstream_repo ?? '') ? `https://github.com/${s.upstream_repo}.git` : s.upstream_repo;
  const raw = chore.slice('devteam-sync-'.length);
  let tag = null;
  for (const t of new Set([raw, raw.replace(/^(v\d+)-(\d+)-(\d+)/, '$1.$2.$3')])) {
    if (git(['fetch', '--quiet', '--no-tags', src, `+refs/tags/${t}:refs/devteam-upstream/${t}`], mainRoot) !== null) { tag = t; break; }
  }
  if (!tag) return { problem: `standing approval for upstream syncs: no tag "${raw}" at ${s.upstream_repo}` };
  const kitRel = path.relative(repoRoot, devteamDir).split(path.sep).join('/');
  const blob = (ref, f) => git(['rev-parse', '--verify', '--quiet', `${ref}:${f}`], mainRoot);
  const differ = [];
  for (const f of changed) {
    if (!f.startsWith(`${kitRel}/`)) { differ.push(`${f} (outside the kit)`); continue; }
    if (blob(sha, f) !== blob(`refs/devteam-upstream/${tag}`, `docs/devteam/${f.slice(kitRel.length + 1)}`)) differ.push(f);
  }
  if (differ.length) return { problem: `standing approval covers only files copied verbatim from upstream ${tag}; these differ: ${differ.slice(0, 6).join(', ')}${differ.length > 6 ? ', …' : ''}. The owner's answer is needed: --approved <qid>` };
  return { rule, tag };
}
function ownerAnswer(qid, what) {
  const q = logGet(qid);
  const v = q?.type === 'question' ? questionView(q) : null;
  if (!v || v.status !== 'answered') die(`${what}: ${qid} is not a question the owner answered`);
  return v;
}

// The merge word, as a command: verify everything at the PR's exact head, run the project's gates
// there, then merge refusing a moved head, then log the act. Only the supervisor runs it.
// --dry-run runs every check and gate and stops; without a PR it checks the branch's local head.
function cmdMerge() {
  supervisorOnly('merge');
  const [id] = positional;
  const plan = flagStr('plan');
  const chore = flagStr('chore') !== undefined ? choreSlug(flagStr('chore')) : undefined;
  const dry = !!flags['dry-run'];
  const branch = plan ? `plan/${plan}` : chore ? `chore-${chore}` : id ? `ticket/${id}` : die('usage: merge <ticket-id> | merge --plan <feature> | merge --chore <slug>   [--approved <qid>] [--no-gates] [--dry-run [--title t] [--body-file f]]');
  const viaGit = loadSettings().forge === 'git';
  if (viaGit && !flagStr('title') && !flagStr('body-file')) {
    // The PR, with no forge: run/pr/<branch>.md, a '# <title>' line then the body (worker.md §8).
    const f = path.join(runDir, 'pr', `${branch}.md`);
    if (fs.existsSync(f)) {
      const first = fs.readFileSync(f, 'utf8').split('\n')[0];
      if (first.startsWith('# ')) { flags.title = first.slice(2).trim(); flags['body-file'] = f; }
    }
  }
  if (viaGit && !dry && !(flagStr('title') && flagStr('body-file'))) die(`forge is git: merge needs the PR text, in ${path.relative(mainRoot, path.join(runDir, 'pr', `${branch}.md`))} ('# <title>' then the body) or as --title and --body-file`);
  const prJson = viaGit ? null : sh('gh', ['pr', 'view', branch, '--json', 'number,headRefOid,title,body,isDraft,mergeStateStatus,url']);
  if (prJson === null && !dry && !viaGit) die(`no open PR from ${branch} (gh pr view failed; with no forge CLI set forge: "git")`);
  git(['fetch', '--quiet', 'origin', branch]);
  const pr = prJson !== null ? JSON.parse(prJson) : { headRefOid: resolveCommit(`origin/${branch}`) ?? resolveCommit(branch) ?? die(`no branch ${branch}`), title: flagStr('title'), body: flagStr('body-file') ? fs.readFileSync(flagStr('body-file'), 'utf8') : undefined };
  if (pr.isDraft) die(`${pr.url} is a draft`);
  const sha = pr.headRefOid;
  if (!resolveCommit(sha)) die(`cannot find ${sha} locally after fetching ${branch}`);
  const fails = checkPr({ headRef: branch, sha, title: pr.title, body: pr.body });
  if (['BEHIND', 'DIRTY'].includes(pr.mergeStateStatus)) fails.push(`PR is ${pr.mergeStateStatus.toLowerCase()} relative to main; the author merges main and asks again`);
  // A chore PR that touches the kit, the agent config or the forge config carries an owner answer
  // (classes governance-edit, process-edit, gate-change); project/ files are the supervisor's.
  let approved = flagStr('approved') ?? null;
  let standing = null;
  // Owner-only settings, on every kind of PR (a ticket, a plan or a chore).
  {
    const base = mainRef() ? git(['merge-base', mainRef(), sha]) : null;
    const changed = base ? ownerSettingsChanged(base, sha) : [];
    if (changed === null) fails.push(`${projectRel}/settings.md: the json devteam block is not valid JSON at the head`);
    else if (changed.length) {
      const classes = [...new Set(changed.map((c) => c.cls))];
      const what = changed.map((c) => `${c.key} (${c.cls})`).join(', ');
      if (!approved) fails.push(`changes owner settings: ${what}; the owner's answer is needed: --approved <qid> of class ${classes.join(' or ')}`);
      else {
        const q = ownerAnswer(approved, 'merge --approved');
        if (!classes.includes(q.class)) fails.push(`${approved} is a ${q.class ?? 'classless'} question; changing ${what} needs an answered ${classes.join(' or ')} question`);
      }
    }
  }
  if (chore) {
    const base = mainRef() ? git(['merge-base', mainRef(), sha]) : null;
    const kit = base ? changedFiles(base, sha).filter((f) => !f.startsWith(`${projectRel}/`)) : [];
    if (kit.length && !approved && chore.startsWith('devteam-sync-')) {
      const r = upstreamSyncApproval(chore, sha, kit);
      if (r.rule) { standing = r; out(`kit files match upstream ${r.tag} exactly; approved by the owner's standing rule ${r.rule.id}`); } else if (r.problem) fails.push(r.problem);
    }
    if (kit.length && !approved && !standing) fails.push(`touches files outside project/ (${kit.slice(0, 6).join(', ')}${kit.length > 6 ? ', …' : ''}); the owner's answer is needed: merge --chore ${chore} --approved <qid>`);
  }
  if (approved) {
    ownerAnswer(approved, 'merge --approved');
    if (logObjects('act').some((a) => a.approved_by === approved)) fails.push(`${approved} already approved an act; ask again for this one`);
  }
  // Gates: the project's own commands, at the exact head, in a detached worktree.
  const gates = Object.entries(loadSettings().gates ?? {});
  if (!gates.length && !flags['no-gates'] && !chore) fails.push('no gates in settings (gates: {name: command}); pass --no-gates to merge without running any');
  if (!fails.length && gates.length && !chore && !flags['no-gates']) {
    // A gate with `paths` runs only when the PR changes a file matching one of them (a monorepo's
    // per-app gates); a gate without runs on every PR.
    const base = mainRef() ? git(['merge-base', mainRef(), sha]) : null;
    const changed = base ? changedFiles(base, sha) : null;
    const applies = ([, spec]) => typeof spec === 'string' || !spec.paths || !changed || changed.some((f) => spec.paths.some((g) => pathMatches(g, f)));
    const skipped = gates.filter((g) => !applies(g)).map(([n]) => n);
    if (skipped.length) out(`gates not applicable to this PR: ${skipped.join(', ')}`);
    const wt = detachedWorktree(sha, `merge-${slug(branch)}`);
    try {
      for (const [name, spec] of gates.filter(applies)) {
        const cmd = typeof spec === 'string' ? spec : spec.cmd;
        const started = Date.now();
        let ok = true;
        try {
          execFileSync('sh', ['-c', cmd], { cwd: wt, stdio: 'inherit', env: gateEnv() });
        } catch {
          ok = false;
        }
        const tests = typeof spec === 'object' && spec.junit ? readJunit(path.join(wt, spec.junit)) : [];
        appendLog({ type: 'gate', gate: name, ok, ms: Date.now() - started, sha, tests_total: tests.length, tests: keepTests(tests) }, 'supervisor');
        // A ratchet gate that fails here and also fails at the merge base is pre-existing debt, not
        // this PR's: it passes with a warning (quality.md §2, modes).
        if (!ok && spec.mode === 'ratchet' && base) {
          const bwt = detachedWorktree(base, `base-${slug(branch)}`);
          let baseOk = true;
          try { execFileSync('sh', ['-c', cmd], { cwd: bwt, stdio: 'ignore', env: gateEnv() }); } catch { baseOk = false; } finally { git(['worktree', 'remove', '--force', bwt], mainRoot); }
          if (!baseOk) { warn(`gate ${name} fails at the merge base ${base.slice(0, 12)} too: pre-existing, allowed by ratchet mode`); continue; }
        }
        if (!ok) fails.push(`gate ${name} failed at ${sha.slice(0, 12)}`);
      }
    } finally {
      git(['worktree', 'remove', '--force', wt], mainRoot);
    }
  }
  if (fails.length) report(fails, '');
  if (dry) return out(`ok: ${branch} at ${sha.slice(0, 12)} would merge`);
  const mainBranch = loadSettings().main_branch;
  if (viaGit) {
    // Merge the exact verified sha (never the branch name, which may have moved) onto origin's main.
    git(['fetch', '--quiet', 'origin', mainBranch]);
    const wt = detachedWorktree(`origin/${mainBranch}`, `land-${slug(branch)}`);
    try {
      gitOrDie(['merge', '--no-ff', '--quiet', '-m', `${pr.title}\n\n${(pr.body ?? '').trim()}\n\nMerged ${branch} at ${sha}`, sha], wt);
      if (git(['push', '--quiet', 'origin', `HEAD:refs/heads/${mainBranch}`], wt) === null) die(`push to ${mainBranch} refused (did main move?); verify from the start`);
    } finally {
      git(['worktree', 'remove', '--force', wt], mainRoot);
    }
  } else {
    const merged = sh('gh', ['pr', 'merge', String(pr.number), `--${loadSettings().merge_method}`, '--match-head-commit', sha]);
    if (merged === null) die(`gh pr merge refused (did the head move?); verify from the start`);
  }
  git(['fetch', '--quiet', 'origin', mainBranch]);
  mainLogCache = undefined;
  mergeShaCache.clear();
  const cls = id ? 'merge-word' : plan ? 'approve-feature-plan' : 'merge-chore';
  const act = appendLog({ type: 'act', class: cls, what: `merged ${branch} at ${sha}${standing ? ` (upstream ${standing.tag}, verbatim)` : ''}`, refs: id ? [id] : plan ? [plan] : [], reversible: false, approved_by: approved ?? standing?.rule.id ?? undefined }, 'supervisor');
  out(`merged ${branch} at ${sha.slice(0, 12)} (${act.id})`);
}
// ===== 7. trust =====

// The rung a ladder class is on: its start, then every owner direction and every correction of an
// act in the class (a drop to 1), in time order, capped at the ceiling.
function rungFor(cls, scope = null) {
  const def = ladder().classes[cls];
  if (!def) return null;
  const events = [];
  for (const q of questions()) if (q.status === 'answered' && q.autonomy?.class === cls && (!q.autonomy.scope || q.autonomy.scope === scope)) events.push({ at: q.answered_at, rung: q.autonomy.rung });
  for (const a of logObjects('act')) { const c = correctionOf(a); if (c && a.class === cls) events.push({ at: c.at, rung: 1 }); }
  let r = def.start;
  for (const e of events.sort((a, b) => a.at.localeCompare(b.at))) r = e.rung;
  return Math.min(r, def.ceiling);
}
// Evidence for a trust question: how often the owner went with the supervisor's recommendation on
// the last N answered questions of the class (defaulted answers don't count), and acts in the
// class since it last dropped, none corrected.
function trustEvidence(cls) {
  const promo = ladder().promotion;
  const acts = logObjects('act').filter((a) => a.class === cls).sort(byTime);
  const drops = acts.map(correctionOf).filter(Boolean).map((c) => c.at).sort();
  const since = drops[drops.length - 1] ?? '';
  const after = acts.filter((a) => a.created_at > since);
  const answered = questions().filter((q) => q.class === cls && q.status === 'answered' && q.recommendation && q.channel !== 'chat').sort((a, b) => a.answered_at.localeCompare(b.answered_at)).slice(-promo.agreement_window);
  const agree = answered.filter((q) => q.matched).length;
  return {
    acts_since_drop: after.length, uncorrected_acts: after.filter((a) => !correctionOf(a)).map((a) => a.id), corrections: drops.length,
    agreement: answered.length ? +(agree / answered.length).toFixed(2) : null, agreement_questions: answered.map((q) => q.id),
    meets_agreement: answered.length >= promo.agreement_window && agree / answered.length >= promo.agreement,
  };
}
function trustTable() {
  return Object.entries(ladder().classes).map(([cls, def]) => {
    const ev = trustEvidence(cls);
    const rung = rungFor(cls);
    return { class: cls, about: def.about, rung, rung_name: RUNG[rung], ceiling: def.ceiling, start: def.start, ...ev, can_ask: rung < def.ceiling && ev.meets_agreement };
  });
}
function cmdTrust() {
  const rows = trustTable();
  if (flags.json) return json(rows);
  for (const r of rows) out(`${r.class.padEnd(20)} rung ${r.rung} (${r.rung_name}) of ${r.ceiling}; agreement ${r.agreement ?? '-'} on ${r.agreement_questions.length}; acts since last drop ${r.acts_since_drop}; corrections ${r.corrections}${r.can_ask ? '  -> evidence supports a trust question' : ''}`);
}

// ===== 8. decide and act =====

function openQuestion(id, okStatuses = ['open']) {
  const q = logGet(id);
  if (!q || q.type !== 'question') die(`no question ${id}`);
  const v = questionView(q);
  if (!okStatuses.includes(v.status)) die(`${id} is already ${v.status}`);
  return v;
}

// A flag whose value is JSON (`--choices '[…]'`); undefined when absent.
function jsonFlag(name) {
  const v = flagStr(name);
  if (v === undefined) return undefined;
  try { return JSON.parse(v); } catch (e) { return die(`--${name} is not valid JSON: ${e.message}`); }
}
function cmdAsk() {
  supervisorOnly('ask');
  const q = flagStr('question') ?? die('ask needs --question');
  const kind = flagStr('kind') ?? 'owner-decision';
  const cls = flagStr('class') ?? null;
  const L = ladder();
  if (kind === 'goal-definition' && cls) die('a goal-definition question has no --class: defining a goal is never delegated (reason goal-ambiguity)');
  const onLadder = cls && L.classes[cls];
  if (kind === 'trust' && !onLadder) die(`a trust question needs --class, one of: ${Object.keys(L.classes).join(', ')}`);
  const def = flagStr('default') ?? null;
  const reasons = asList(flags.reasons);
  const known = L.reasons.map((r) => r.id);
  for (const r of reasons) if (known.length && !known.includes(r)) warn(`reason "${r}" is not in constitution.md's table`);
  const blocks = asList(flags.blocks);
  for (const b of blocks) if (!tickets().has(b)) die(`--blocks ${b}: no such ticket`);
  const open = questions().filter((x) => x.status === 'open');
  let evidence = asList(flags.evidence);
  let recommendation = flagStr('recommendation') ?? '';
  if (kind === 'trust') {
    if (open.some((x) => x.kind === 'trust' && x.class === cls)) die(`a trust question for ${cls} is already open`);
    if (open.filter((x) => x.kind === 'trust').length >= 2) die('two trust questions are already open');
    const ev = trustEvidence(cls);
    const r = rungFor(cls);
    if (r >= L.classes[cls].ceiling) die(`${cls} is already at its ceiling (rung ${r})`);
    if (!ev.meets_agreement) die(`${cls}: the owner agreed with the recommendation on ${ev.agreement_questions.length ? `${Math.round((ev.agreement ?? 0) * 100)}% of the last ${ev.agreement_questions.length}` : 'no'} answered questions; a trust question needs ${L.promotion.agreement * 100}% of the last ${L.promotion.agreement_window} (constitution.md §2)`);
    evidence = [...new Set([...evidence, ...ev.agreement_questions, ...ev.uncorrected_acts.slice(-10)])];
    if (!recommendation) recommendation = `move ${cls} to rung ${r + 1} (${RUNG[r + 1]})`;
  }
  const scope = flagStr('scope') ?? null;
  const line = appendLog({
    type: 'question', kind, class: cls ?? undefined, scope: scope ?? undefined, ticket: flagStr('ticket'), re: flagStr('re'), question: q, context: flagStr('context'),
    rule_scope: flagStr('rule-scope'), options: asList(flags.options), choices: jsonFlag('choices'), links: jsonFlag('links'), recommendation: recommendation || undefined, confidence: flagNum('confidence'), default: def ?? undefined,
    deadline: def ? new Date(Date.now() + loadSettings().question_default_after_hours * 3600000).toISOString() : undefined,
    blocks, evidence, note: flagStr('note'),
    why_asked: { rung: onLadder ? rungFor(cls, scope) : undefined, ceiling: onLadder ? L.classes[cls].ceiling : undefined, reasons },
  }, 'supervisor');
  out(line.id);
}

// The owner answers (terminal or dashboard). The supervisor may only apply a default or withdraw.
function cmdAnswer() {
  const [id, ...restWords] = positional;
  if (!id || (!restWords.length && !flags.defaulted)) die('usage: answer <qid> "<answer>" [--autonomy 1|2|3 [--scope s]] [--rule "<standing rule>" [--rule-scope s]]   |   answer <qid> "<answer>" --from-chat --said "<owner\'s words>" [--autonomy n]   |   answer <qid> --defaulted   (supervisor)');
  if (flags.defaulted) {
    supervisorOnly('answer --defaulted');
    const v = openQuestion(id);
    if (!v.default) die(`${id} has no default to apply`);
    appendLog({ type: 'question', op: 'set', id, status: 'defaulted' }, 'supervisor');
    appendLog({ type: 'act', class: 'apply-default', what: `applied the default to ${id}: ${v.default}`, refs: [id], reversible: true }, 'supervisor');
    return out(`defaulted ${id}: ${v.default}`);
  }
  // --from-chat: the owner said it in the supervisor's own session. The supervisor records it as the
  // owner's answer with their words verbatim; the dashboard lists it for the owner to check, and it
  // never counts as agreement evidence for the trust ladder. The supervisor is the party the ladder
  // governs, so its say-so never decides what is reserved to the owner (one-way doors, trust, the
  // owner_only classes) and never raises its own rung; it may only record a lower one.
  const fromChat = !!flags['from-chat'];
  if (fromChat) {
    if (process.env.DEVTEAM_ROLE !== 'supervisor' || logWriter() !== 'supervisor') die('answer --from-chat: the supervisor records what the owner said in its session; in your own terminal, answer directly');
    if (!flagStr('said')?.trim()) die('answer --from-chat needs --said "<the owner\'s words, verbatim>"');
    if (flagStr('rule')) die('answer --from-chat takes no --rule: a standing rule binds the whole project, so the owner gives it from the dashboard or their terminal');
  }
  const { by } = fromChat ? { by: 'owner' } : ownerWriter();
  const v = openQuestion(id, ['open', 'defaulted']);
  if (fromChat) {
    const reserved = ['one-way-door', 'trust'].includes(v.kind) || (ladder().owner_only ?? []).includes(v.class) || (v.why_asked?.reasons ?? []).includes('one-way-door');
    if (reserved) die(`answer --from-chat: ${id} is reserved to the owner (${v.kind}${v.class ? `, ${v.class}` : ''}); ask them to answer it from the dashboard or their terminal`);
  }
  const answer = restWords.join(' ').trim();
  let autonomy;
  if (flags.autonomy !== undefined) {
    const def = ladder().classes[v.class];
    if (!def) die(`${id} has no ladder class, so it carries no autonomy direction`);
    const rung = flagNum('autonomy');
    if (![1, 2, 3].includes(rung)) die('--autonomy is 1 (ask), 2 (ask with a default) or 3 (act and report)');
    if (rung > def.ceiling) die(`${v.class} has a ceiling of rung ${def.ceiling} (constitution.md)`);
    if (fromChat && rung > rungFor(v.class, flagStr('scope') ?? null)) die(`answer --from-chat can lower ${v.class}'s rung but not raise it (now ${rungFor(v.class, flagStr('scope') ?? null)}): the owner raises a rung from the dashboard or their terminal`);
    autonomy = { class: v.class, rung, scope: flagStr('scope') ?? null };
  }
  appendLog({ type: 'question', op: 'set', id, answer, autonomy, standing_rule: flagStr('rule'), ...(fromChat ? { channel: 'chat', said: flagStr('said').trim() } : {}) }, by);
  // A standing rule applies where the owner says (--rule-scope), else where the question says its
  // rule would apply (ask --rule-scope; the dashboard shows it next to the rule field), else the
  // whole project.
  if (flagStr('rule')) appendLog({ type: 'knowledge', kind: 'preference', statement: flagStr('rule'), scope: flagStr('rule-scope') ?? v.rule_scope ?? 'project', status: 'accepted', confidence: 1, evidence: [id] }, by);
  if (!fromChat) nudgeSupervisor(`[devteam answer ${id} from owner] read it with: devteam.mjs questions --id ${id}`);
  out(`answered ${id}${fromChat ? ' (from chat; listed on the dashboard for the owner to check)' : ''}`);
}
function cmdWithdraw() {
  const [id] = positional;
  if (!id) die('usage: withdraw <qid> [--reason r]');
  supervisorOnly('withdraw');
  openQuestion(id);
  appendLog({ type: 'question', op: 'set', id, status: 'withdrawn', reason: flagStr('reason') }, 'supervisor');
  appendLog({ type: 'act', class: 'withdraw-question', what: `withdrew ${id}${flagStr('reason') ? `: ${flagStr('reason')}` : ''}`, refs: [id], reversible: true }, 'supervisor');
  out(`withdrew ${id}`);
}
function rankQuestions(qs) {
  const sub = activeTickets();
  const crit = findCycle(sub) ? new Set() : new Set(criticalPath(sub).path);
  const score = (q) => (['one-way-door', 'owner-decision'].includes(q.kind) ? 1000 : 0) + q.blocks.reduce((s, id) => s + (crit.has(id) ? 3 : 1), 0) * 10;
  return [...qs].sort((a, b) => score(b) - score(a) || a.asked_at.localeCompare(b.asked_at));
}
function cmdQuestions() {
  let qs = questions();
  if (flagStr('id')) qs = qs.filter((q) => q.id === flagStr('id'));
  else if (!flags.all) qs = qs.filter((q) => q.status === 'open');
  qs = rankQuestions(qs);
  if (flags.json) return json(qs);
  if (!qs.length) return out('no questions');
  for (const q of qs) {
    out(`${q.id}  [${q.kind}, ${q.status}]${q.blocks.length ? ` blocks ${q.blocks.join(',')}` : ''}\n  ${q.question}`);
    for (const c of q.choices) out(`  - ${c.label}${c.label === q.recommendation ? ' (recommended)' : ''}${c.detail ? `: ${c.detail}` : ''}${c.effect ? ` For users: ${c.effect}` : ''}`);
    for (const l of q.links) out(`  see: ${l.title} (${l.url ?? `${l.ref ? `${l.ref}:` : ''}${l.path}`})`);
    if (q.recommendation) out(`  recommend: ${q.recommendation}${q.confidence != null ? ` (${Math.round(q.confidence * 100)}%)` : ''}`);
    if (q.why_asked?.reasons?.length) out(`  why asked: ${q.why_asked.reasons.join(', ')}${q.class ? ` (${q.class}, rung ${q.why_asked.rung ?? '-'} of ${q.why_asked.ceiling ?? '-'})` : ''}`);
    if (q.answer) out(`  answer (${q.answered_by}): ${q.answer}`);
    if (q.autonomy) out(`  next time: ${q.autonomy.class} at rung ${q.autonomy.rung} (${RUNG[q.autonomy.rung]})${q.autonomy.scope ? ` for ${q.autonomy.scope}` : ''}`);
    if (q.standing_rule) out(`  standing rule: ${q.standing_rule}`);
  }
}

// An act: a decision the supervisor made. For a ladder class it checks the rung first and refuses
// (writing nothing) when the supervisor may not act alone; an owner-only class needs an owner answer.
function cmdAct() {
  const what = rest ? rest.join(' ') : flagStr('what');
  const cls = flagStr('class');
  if (!cls || !what) die('usage: act --class <decision-class> [--scope s] [--approved <qid>] [--refs ids] [--irreversible] -- "<what you did>"');
  supervisorOnly('act');
  const L = ladder();
  const scope = flagStr('scope') ?? null;
  const approved = flagStr('approved') ?? null;
  let approval = null;
  if (approved) {
    const q = logGet(approved);
    approval = q?.type === 'question' ? questionView(q) : null;
    if (!approval || !['answered', 'defaulted'].includes(approval.status)) die(`${approved} is not an answered question`);
    if (approval.class !== cls) die(`${approved} was asked in class ${approval.class ?? '(none)'}, not ${cls}`);
    if (logObjects('act').some((a) => a.approved_by === approved)) die(`${approved} already approved an act; ask again for another`);
  }
  let rung;
  if ((L.owner_only ?? []).includes(cls)) {
    if (!approval || approval.status !== 'answered') die(`${cls} is the owner's (constitution.md); it needs an owner answer in that class (--approved <qid>)`);
  } else if (L.classes[cls]) {
    rung = rungFor(cls, scope);
    if (approval) {
      if (approval.status === 'defaulted' && rung < 2) die(`${cls} is on rung ${rung} (${RUNG[rung]}); a defaulted answer is not approval there`);
    } else if (rung < 3) {
      process.stderr.write(`devteam: ${cls}${scope ? ` (${scope})` : ''} is on rung ${rung} (${RUNG[rung]}); ask first:\n  devteam.mjs ask --class ${cls} --question "…" --recommendation "…"${rung === 2 ? ' --default "…"' : ''} --reasons below-rung\nthen act with --approved <qid>.\n`);
      process.exit(3);
    }
  } else if (!(L.constitutional ?? []).includes(cls)) warn(`class "${cls}" is not in constitution.md (ladder, constitutional or owner-only)`);
  // Classes that are about one ticket name it first in refs; checkTicket finds approvals by it.
  if (['approve-spec', 'approve-plan'].includes(cls) && !tickets().has(asList(flags.refs)[0])) die(`${cls} names the ticket first: --refs <ticket-id> [other ids]`);
  if (cls === 'approve-plan') {
    const t = tickets().get(asList(flags.refs)[0]);
    if (!t) die('approve-plan names the ticket: --refs <ticket-id>');
    if ((t.one_way_doors ?? []).length && !questions().some((q) => q.kind === 'one-way-door' && q.ticket === t.id && q.status === 'answered')) die(`${t.id} lists one-way doors; the owner answers a one-way-door question (--ticket ${t.id}) before its plan is approved (constitution.md §4)`);
  }
  const line = appendLog({ type: 'act', class: cls, scope: scope ?? undefined, what, rung, refs: asList(flags.refs), reversible: !flags.irreversible, approved_by: approved ?? undefined }, 'supervisor');
  out(line.id);
}
function cmdCorrect() {
  const [actId] = positional;
  if (!actId) die('usage: correct <act-id> --reason r [--severity 0-4]   (owner; the supervisor at a retro adds --retro)');
  const by = flags.retro ? (supervisorOnly('correct --retro'), 'supervisor') : ownerWriter().by;
  const act = logGet(actId);
  if (act?.type !== 'act') die(`no act ${actId}`);
  if (correctionOf(act)) die(`${actId} is already corrected`);
  appendLog({ type: 'act', op: 'set', id: actId, corrected: { reason: flagStr('reason') ?? die('correct needs --reason'), severity: flagNum('severity') } }, by);
  if (ladder().classes[act.class]) out(`${act.class} drops to rung 1 (ask)`);
  if (by === 'owner') nudgeSupervisor(`[devteam correction from owner] on ${actId}; read it with: devteam.mjs log --id ${actId}`);
  out(`corrected ${actId}`);
}
// The supervisor records how it repaired a corrected act.
function cmdRepair() {
  const [actId] = positional;
  const how = flagStr('how');
  if (!actId || !['undo', 'fix-ticket', 'none'].includes(how)) die('usage: repair <act-id> --how undo|fix-ticket|none');
  supervisorOnly('repair');
  const act = logGet(actId);
  if (act?.type !== 'act' || !correctionOf(act)) die(`${actId} is not a corrected act`);
  appendLog({ type: 'act', op: 'set', id: actId, repaired: how }, 'supervisor');
  out(`repaired ${actId}: ${how}`);
}

// --- observe and orient ---

function cmdObserve() {
  const by = flags.owner ? ownerWriter().by : logWriter();
  const subject = flagStr('subject') ?? die('observe needs --subject (a ticket, component, feature, gate, goal, class or act id)');
  const line = appendLog({
    type: 'observation', source: flagStr('source') ?? writerClass(by), subject, kind: flagStr('kind') ?? die('observe needs --kind (a slug)'),
    detail: flagStr('detail') ?? die('observe needs --detail'), detector: flagStr('detector'), severity: flagNum('severity'), valence: flagNum('valence'),
    source_key: flagStr('key'), refs: asList(flags.refs), fix_hint: flagStr('fix'),
    measure: flagStr('value') !== undefined ? { value: Number(flagStr('value')), unit: flagStr('unit') } : undefined,
  }, by);
  out(line.id);
}
const SEV = { low: 1, medium: 2, high: 3 };
// Each metrics finding becomes an observation, once a day per finding (deduped on source_key).
function observeFindings(m) {
  const recent = new Map();
  for (const o of logObjects('observation')) if (o.source_key && o.created_by === 'supervisor' && o.detector === 'metrics') recent.set(o.source_key, Math.max(recent.get(o.source_key) ?? 0, Date.parse(o.created_at)));
  let n = 0;
  for (const f of m.findings) {
    const key = `metrics:${f.kind}:${f.subject}`;
    if (Date.now() - (recent.get(key) ?? 0) < DAY) continue;
    appendLog({ type: 'observation', source: 'metrics', subject: String(f.subject), kind: f.kind, detector: 'metrics', detail: f.detail, severity: SEV[f.severity] ?? 1, valence: -1, source_key: key, fix_hint: f.suggestion }, 'supervisor');
    n++;
  }
  return n;
}
function cmdObserveMetrics() {
  supervisorOnly('observe-metrics');
  out(`recorded ${observeFindings(collectMetrics(0))} new observation(s)`);
}
// Accepted knowledge whose scope applies to a ticket (component, feature), a feature, or a class.
function knowledgeFor(target) {
  const t = tickets().get(target);
  const scopes = new Set(['project']);
  if (t) { scopes.add(`component:${t.component}`); scopes.add(`feature:${t.feature}`); }
  else if (features().has(target)) scopes.add(`feature:${target}`);
  else if (target) scopes.add(`class:${target}`);
  return logObjects('knowledge').filter((k) => k.status === 'accepted' && scopes.has(k.scope));
}
// The block a prompt ends with: what applies to this ticket or feature.
const knowledgeBlock = (target) => {
  const ks = knowledgeFor(target);
  return ks.length ? `What this project has learned that applies here (accepted knowledge):\n${ks.map((k) => `- [${k.kind}${k.valence < 0 ? ', avoid' : ''}] ${k.statement} (${k.id})`).join('\n')}` : '';
};
function cmdKnowledge() {
  const [sub, id] = positional;
  const by = () => (flags.owner ? ownerWriter().by : (supervisorOnly('knowledge'), 'supervisor'));
  if (sub === 'add') {
    const w = by();
    const line = appendLog({ type: 'knowledge', kind: flagStr('kind') ?? die('knowledge add needs --kind (fact, lesson, preference, constraint, pointer)'), statement: flagStr('statement') ?? die('knowledge add needs --statement'), scope: flagStr('scope') ?? 'project', status: w === 'owner' ? 'accepted' : 'candidate', confidence: flagNum('confidence'), valence: flagNum('valence'), evidence: asList(flags.evidence) }, w);
    return out(line.id);
  }
  if (sub === 'set') {
    if (!id || logGet(id)?.type !== 'knowledge') die('usage: knowledge set <k-id> [--status s] [--confidence c] [--statement s] [--scope s] [--owner]');
    appendLog({ type: 'knowledge', op: 'set', id, status: flagStr('status'), confidence: flagNum('confidence'), statement: flagStr('statement'), scope: flagStr('scope') }, by());
    return out(`updated ${id}`);
  }
  if (flagStr('for')) {
    if (flags.json) return json(knowledgeFor(flagStr('for')));
    const block = knowledgeBlock(flagStr('for'));
    return block ? out(block) : undefined;
  }
  let ks = logObjects('knowledge');
  if (flagStr('status')) ks = ks.filter((k) => k.status === flagStr('status'));
  if (flagStr('kind')) ks = ks.filter((k) => k.kind === flagStr('kind'));
  if (flags.json) return json(ks);
  for (const k of ks) out(`${k.id} [${k.kind}, ${k.status}, ${k.scope}${k.confidence !== undefined ? `, conf ${k.confidence}` : ''}] ${k.statement}`);
}
function cmdProblem() {
  const [sub, id] = positional;
  const by = () => (flags.owner ? ownerWriter().by : (supervisorOnly('problem'), 'supervisor'));
  if (sub === 'add') {
    const line = appendLog({ type: 'problem', title: flagStr('title') ?? die('problem add needs --title'), severity: flagNum('severity') ?? die('problem add needs --severity 0-4'), realized: !flags.risk, status: 'open', detail: flagStr('detail'), threatens: asList(flags.threatens), assigned_to: flagStr('assign'), refs: asList(flags.refs) }, by());
    return out(line.id);
  }
  if (sub === 'set') {
    if (!id || logGet(id)?.type !== 'problem') die('usage: problem set <p-id> [--status s] [--severity n] [--assign a] [--realized true|false] [--detail d]');
    appendLog({ type: 'problem', op: 'set', id, status: flagStr('status'), severity: flagNum('severity'), assigned_to: flagStr('assign'), realized: flagStr('realized') === undefined ? undefined : flagStr('realized') === 'true', detail: flagStr('detail') }, by());
    return out(`updated ${id}`);
  }
  let ps = logObjects('problem');
  if (!flags.all) ps = ps.filter((p) => p.status !== 'resolved');
  ps.sort((a, b) => b.severity - a.severity);
  if (flags.json) return json(ps);
  for (const p of ps) out(`${p.id} [sev ${p.severity}, ${p.realized ? 'issue' : 'risk'}, ${p.status}${p.assigned_to ? `, ${p.assigned_to}` : ''}] ${p.title}${(p.threatens ?? []).length ? ` (threatens ${p.threatens.join(', ')})` : ''}`);
}
// Recurring signals no knowledge or problem explains yet: three or more observations (or
// corrections) on one key, from at least two writers or on at least two days.
function orientClusters() {
  const linked = new Set();
  for (const o of [...logObjects('knowledge'), ...logObjects('problem')]) for (const r of [...(o.evidence ?? []), ...(o.refs ?? [])]) linked.add(r);
  const groups = new Map();
  const add = (key, item) => (groups.get(key) ?? groups.set(key, []).get(key)).push(item);
  for (const o of logObjects('observation')) {
    if (linked.has(o.id) || ['reading', 'retro', 'outcome'].includes(o.kind)) continue;
    add(o.source_key ?? `${o.kind}:${o.subject}`, { id: o.id, at: o.created_at, who: o.created_by, valence: o.valence ?? 0, detail: o.detail });
  }
  for (const a of logObjects('act')) {
    const c = correctionOf(a);
    if (c && !linked.has(a.id)) add(`correction:${a.class}:${a.scope ?? 'any'}`, { id: a.id, at: c.at, who: c.by, valence: -2, detail: c.reason });
  }
  const res = [];
  for (const [key, items] of groups) {
    const spread = new Set(items.map((i) => i.who)).size >= 2 || new Set(items.map((i) => dateOnly(i.at))).size >= 2;
    if (items.length < 3 || !spread) continue;
    const v = items.reduce((s, i) => s + i.valence, 0) / items.length;
    res.push({ key, count: items.length, valence: +v.toFixed(1), ids: items.map((i) => i.id), latest: items.map((i) => i.detail).pop() });
  }
  return res.sort((a, b) => b.count - a.count);
}
function cmdOrient() {
  const cl = orientClusters();
  if (flags.json) return json(cl);
  if (!cl.length) return out('nothing recurring that is unexplained');
  for (const c of cl) out(`${c.key}  x${c.count}  valence ${c.valence}\n  latest: ${c.latest}\n  evidence: ${c.ids.join(' ')}`);
}

// ===== 9. goals, roadmap, retros, chore worktrees =====

const goalReadings = (gid) => logObjects('observation').filter((o) => o.kind === 'reading' && o.subject === gid && o.measure && ['supervisor', 'owner'].includes(o.created_by)).sort(byTime);
const goalFeatures = (gid) => [...features().values()].filter((f) => (f.goals ?? []).includes(gid)).map((f) => f.id);

// Mechanical readiness. Definition gaps block approval; coverage gaps are what planning closes.
function goalCheck(g) {
  const definition = [];
  const coverage = [];
  if (!g.outcome) definition.push('no outcome: what is true for users or the business when this is met');
  if (!g.measure?.description) definition.push('no measure: how we will know');
  if (typeof g.measure?.target !== 'number') definition.push('no numeric target');
  if (!g.measure?.unit) definition.push('no unit');
  if (!g.measure?.direction) definition.push('no direction (up or down)');
  if (!g.horizon || Number.isNaN(Date.parse(g.horizon))) definition.push('no horizon date');
  if (!(g.non_goals ?? []).length) definition.push('no non-goals');
  if (!(g.preconditions ?? []).length) definition.push('no preconditions: what must be true for the outcome');
  if (typeof g.priority !== 'number') definition.push('no priority');
  const clash = logObjects('goal').filter((o) => o.id !== g.id && ['ready', 'draft'].includes(o.status ?? 'draft') && typeof g.priority === 'number' && o.priority === g.priority);
  if (clash.length) definition.push(`priority ${g.priority} is shared with ${clash.map((c) => c.id).join(', ')}`);
  if (!goalReadings(g.id).length) definition.push('no baseline reading (devteam.mjs goal reading <id> --value v)');
  const feats = goalFeatures(g.id);
  const covered = new Set(feats.flatMap((f) => features().get(f).preconditions ?? []));
  const unplanned = (g.preconditions ?? []).map((text, i) => ({ n: i + 1, text })).filter((p) => !covered.has(`${g.id}#${p.n}`));
  const designSlug = slug(g.title ?? g.id);
  if ((g.status ?? 'draft') === 'ready') {
    if (!projectFileText(`designs/${designSlug}.md`)) coverage.push(`no design at project/designs/${designSlug}.md`);
    if (!feats.length) coverage.push('no feature names this goal');
    for (const p of unplanned) coverage.push(`precondition ${p.n} ("${p.text}") has no feature (${g.id}#${p.n})`);
  }
  return { definition, coverage, features: feats, unplanned, design: `project/designs/${designSlug}.md` };
}
function goalView(g) {
  const readings = goalReadings(g.id);
  const first = readings[0];
  const last = readings[readings.length - 1];
  let track = null;
  if (readings.length >= 2 && typeof g.measure?.target === 'number' && g.horizon) {
    const start = Date.parse(first.created_at);
    const end = Date.parse(g.horizon);
    const frac = end > start ? Math.min(1, Math.max(0, (Date.now() - start) / (end - start))) : 1;
    const expected = first.measure.value + (g.measure.target - first.measure.value) * frac;
    track = (g.measure.direction === 'down' ? last.measure.value <= expected : last.measure.value >= expected) ? 'on track' : 'behind';
  }
  return { ...g, status: g.status ?? 'draft', readings: readings.map((r) => ({ at: r.created_at, value: r.measure.value, source: r.source })), track, check: goalCheck(g) };
}
function cmdGoal() {
  const [sub, id] = positional;
  const writer = () => (flags.owner ? ownerWriter() : (supervisorOnly('goal'), { by: 'supervisor' }));
  const fields = () => ({
    title: flagStr('title'), outcome: flagStr('outcome'),
    measure: ['measure', 'target', 'unit', 'direction'].some((k) => flagStr(k) !== undefined)
      ? { ...(id ? logGet(id)?.measure : {}), ...(flagStr('measure') ? { description: flagStr('measure') } : {}), ...(flagStr('target') ? { target: Number(flagStr('target')) } : {}), ...(flagStr('unit') ? { unit: flagStr('unit') } : {}), ...(flagStr('direction') ? { direction: flagStr('direction') } : {}) }
      : undefined,
    horizon: flagStr('horizon'),
    non_goals: flags['non-goals'] !== undefined ? asList(flags['non-goals']) : undefined,
    preconditions: flags.preconditions !== undefined ? asList(flags.preconditions) : undefined,
    priority: flagNum('priority'),
  });
  if (sub === 'add') {
    const { by } = writer();
    const f = fields();
    if (!f.title) die('goal add needs --title');
    return out(appendLog({ type: 'goal', status: 'draft', ...f }, by).id);
  }
  if (sub === 'set') {
    if (!id || logGet(id)?.type !== 'goal') die('usage: goal set <g-id> [--title …] [--outcome …] [--measure …] [--target n] [--unit u] [--direction up|down] [--horizon date] [--non-goals …] [--preconditions …] [--priority n] [--owner]');
    const { by } = writer();
    if (by === 'supervisor' && (logGet(id).status ?? 'draft') !== 'draft') die(`${id} is ${logGet(id).status}; only the owner changes it now (class goal-change)`);
    appendLog({ type: 'goal', op: 'set', id, ...fields() }, by);
    return out(`updated ${id}`);
  }
  if (sub === 'approve' || sub === 'status') {
    const { by } = ownerWriter();
    const g = logGet(id);
    if (g?.type !== 'goal') die(`no goal ${id}`);
    const to = sub === 'approve' ? 'ready' : positional[2];
    if (!['draft', 'ready', 'met', 'abandoned'].includes(to)) die('status is draft, ready, met or abandoned');
    if (to === 'ready') {
      const c = goalCheck(g);
      if (c.definition.length && !flags.force) die(`${id} is not fully defined:\n  - ${c.definition.join('\n  - ')}\n(--force to approve anyway)`);
    }
    appendLog({ type: 'goal', op: 'set', id, status: to }, by);
    return out(`${id} is ${to}`);
  }
  if (sub === 'show') return json(goalView(logGet(id)?.type === 'goal' ? logGet(id) : die(`no goal ${id}`)));
  if (sub === 'reading') {
    if (!id || logGet(id)?.type !== 'goal') die('usage: goal reading <g-id> --value n [--source s] [--detail d]');
    const by = flags.owner ? ownerWriter().by : (supervisorOnly('goal reading'), 'supervisor');
    const v = flagNum('value');
    if (v === undefined || Number.isNaN(v)) die('goal reading needs --value <number>');
    const unit = logGet(id).measure?.unit;
    appendLog({ type: 'observation', source: flagStr('source') ?? by, subject: id, kind: 'reading', detail: flagStr('detail') ?? `reading ${v}${unit ? ` ${unit}` : ''}`, measure: { value: v, unit }, refs: [id] }, by);
    return out(`recorded ${v} for ${id}`);
  }
  if (sub === 'check') {
    const gs = (id ? [logGet(id)] : logObjects('goal')).filter((g) => g?.type === 'goal' && !['met', 'abandoned'].includes(g.status));
    let gaps = 0;
    for (const g of gs) {
      const c = goalCheck(g);
      gaps += c.definition.length + c.coverage.length;
      out(`${g.id} [${g.status ?? 'draft'}] ${g.title}`);
      for (const d of c.definition) out(`  definition: ${d}`);
      for (const d of c.coverage) out(`  coverage: ${d}`);
      if (!c.definition.length && !c.coverage.length) out('  ok');
    }
    if (gaps && flags.strict) process.exit(1);
    return;
  }
  const gs = logObjects('goal').map(goalView).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  if (flags.json) return json(gs);
  if (!gs.length) return out('no goals (the owner states them; planning.md §1)');
  for (const g of gs) {
    const last = g.readings[g.readings.length - 1];
    out(`${g.id} [${g.status}${g.priority ? `, p${g.priority}` : ''}] ${g.title}\n  ${g.measure?.description ?? '-'}: ${last ? last.value : '?'} -> ${g.measure?.target ?? '?'} ${g.measure?.unit ?? ''} by ${g.horizon ?? '?'}${g.track ? ` (${g.track})` : ''}; features: ${g.check.features.join(', ') || 'none'}`);
  }
}

// --- the roadmap: computed, never written ---

function collectRoadmap() {
  const prog = collectProgress();
  const items = prog.tickets;
  const now = Date.now();
  const firstAdd = Math.min(now, ...items.map((t) => Date.parse(t.added_at)));
  const windowDays = Math.max(1, Math.min(14, (now - firstAdd) / DAY));
  const recentPts = items.filter((t) => t.merged_at && now - Date.parse(t.merged_at) <= windowDays * DAY).reduce((a, t) => a + t.weight, 0);
  const rate = recentPts / windowDays;
  const m = collectMetrics(0);
  const cycleDays = m.cycle_hours.median ? m.cycle_hours.median / 24 : null;
  const openQs = questions().filter((q) => q.status === 'open');
  const goals = logObjects('goal').filter((g) => !['met', 'abandoned'].includes(g.status)).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  const rankOf = new Map(goals.map((g, i) => [g.id, i]));
  const fs_ = features();
  const views = [...new Set([...items.map((t) => t.feature), ...fs_.keys()])].map((fid) => {
    const f = fs_.get(fid);
    const ts = items.filter((t) => t.feature === fid);
    const left = ts.filter((t) => !t.merged_at);
    const sub = new Map(left.map((t) => [t.id, { ...t, depends_on: t.depends_on.filter((d) => left.some((x) => x.id === d)) }]));
    const waves = sub.size && !findCycle(sub) ? Math.max(...levels(sub).values()) + 1 : 0;
    const stories = f?.stories ?? [];
    const storyDone = stories.filter((s) => { const st = ts.filter((t) => t.serves.includes(s.id)); return st.length && st.every((t) => t.merged_at); }).length;
    return {
      feature: fid, title: f?.title ?? fid, status: f ? (ts.length && ts.every((t) => t.merged_at) ? 'done' : ts.some((t) => t.merged_at || t.phase) ? 'in progress' : 'planned') : fid === CHORES ? 'chores' : 'no feature line', goals: f?.goals ?? [],
      points_total: ts.reduce((a, t) => a + t.weight, 0), points_left: left.reduce((a, t) => a + t.weight, 0),
      stories: { done: storyDone, total: stories.length }, waves_left: waves,
      releases: [...new Set(stories.map((s) => s.release).filter(Boolean))].sort(),
      blocked_by_questions: openQs.filter((q) => q.blocks.some((b) => ts.some((t) => t.id === b))).map((q) => q.id),
    };
  });
  const bestRank = (v) => Math.min(99, ...v.goals.map((g) => rankOf.get(g) ?? 99));
  const ordered = views.filter((v) => v.goals.some((g) => rankOf.has(g))).sort((a, b) => bestRank(a) - bestRank(b) || b.waves_left - a.waves_left || b.points_left - a.points_left);
  let cum = 0;
  for (const v of ordered) {
    cum += v.points_left;
    v.done = v.points_total > 0 && v.points_left === 0;
    v.eta = !v.points_left || !rate ? null : dateOnly(new Date(now + Math.max(cum / rate, cycleDays ? v.waves_left * cycleDays : 0) * DAY).toISOString());
  }
  const goalRows = goals.map((g) => {
    const c = goalCheck(g);
    const feats = ordered.filter((v) => v.goals.includes(g.id));
    const etas = feats.map((v) => v.eta).filter(Boolean).sort();
    return { id: g.id, title: g.title, priority: g.priority ?? null, status: g.status ?? 'draft', unplanned: c.unplanned, features: feats.map((v) => v.feature), eta: c.unplanned.length || !feats.length ? null : feats.every((v) => v.done) ? 'done' : etas.pop() ?? null, has_design: !c.coverage.some((x) => x.startsWith('no design')) };
  });
  return {
    generated_at: nowIso(), rate_points_per_day: +rate.toFixed(2), median_cycle_days: cycleDays === null ? null : +cycleDays.toFixed(1),
    goals: goalRows, features: Object.fromEntries(views.map((v) => [v.feature, v])), unassigned: views.filter((v) => v.feature !== CHORES && !v.goals.some((g) => logGet(g)?.type === 'goal')).map((v) => v.feature),
    note: 'Estimates assume goal-priority order at the current rate; a feature finishes no sooner than its remaining waves times the median cycle time. Goals with unplanned preconditions have no date.',
  };
}
const weekOf = (d) => { if (!d) return 'no date'; const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return `week of ${dateOnly(x.toISOString())}`; };
function roadmapText(r) {
  const L = [`rate ${r.rate_points_per_day} points/day; median cycle ${r.median_cycle_days ?? '-'} days`];
  for (const g of r.goals) {
    L.push('', `${g.priority ? `p${g.priority} ` : ''}${g.title} [${g.status}] -> ${g.eta === 'done' ? 'done' : weekOf(g.eta)}${g.has_design ? '' : ' (no design)'}`);
    for (const u of g.unplanned) L.push(`  unplanned: precondition ${u.n}: ${u.text}`);
    for (const f of g.features) {
      const v = r.features[f];
      L.push(`  ${v.feature} [${v.status}] ${v.points_total - v.points_left}/${v.points_total} pts, stories ${v.stories.done}/${v.stories.total}, ${v.waves_left} waves left${v.releases.length ? `, ${v.releases.join(' ')}` : ''} -> ${v.done ? 'done' : weekOf(v.eta)}${v.blocked_by_questions.length ? `; waiting on ${v.blocked_by_questions.join(' ')}` : ''}`);
    }
  }
  if (r.unassigned.length) L.push('', `serving no goal: ${r.unassigned.join(', ')}`);
  return L.join('\n');
}
function cmdRoadmap() {
  const r = collectRoadmap();
  if (flags.json) return json(r);
  out(`${roadmapText(r)}\n\n${r.note}`);
}

// --- chore worktrees: supervisor-written files reach main through their own branch and PR ---

// A chore slug names a branch (chore-<slug>), a worktree and a PR file, so every command that takes
// one checks it the same way: lowercase words joined by hyphens or dots (devteam-sync-v1.2.0), never
// a path, and never ending in .lock (git refuses such branch names).
function choreSlug(slugName) {
  if (!/^[a-z0-9]+([.-][a-z0-9]+)*$/.test(slugName ?? '') || /\.lock$/.test(slugName)) die(`chore slug "${slugName}" must be lowercase words joined by hyphens (dots allowed, as in devteam-sync-v1.2.0; not ending in .lock)`);
  return slugName;
}
// A new chore worktree gets settings.worktree_files (a gitignored key, an .env) so gates can run in
// it; `chore start` also runs worktree_setup there. log-sync and retro only commit files, so they
// skip the setup.
function choreWorktree(slugName, { reset = false, setup = false } = {}) {
  choreSlug(slugName);
  if (!commonDir || !projectInRepo) die('chores need a git checkout with the project folder inside it');
  if (repoRoot !== mainRoot) die(`run this from the main checkout (${mainRoot})`);
  const wt = path.join(mainRoot, '.worktrees', `chore-${slugName}`);
  const main = loadSettings().main_branch;
  if (!flags['dry-run']) git(['fetch', '--quiet', 'origin', main]);
  const base = resolveCommit(`origin/${main}`) ? `origin/${main}` : main;
  if (!fs.existsSync(wt)) { gitOrDie(['worktree', 'add', '--quiet', '-B', `chore-${slugName}`, wt, base], mainRoot); seedWorktree(wt, { setup }); }
  else if (reset) gitOrDie(['checkout', '--quiet', '-B', `chore-${slugName}`, base], wt);
  return wt;
}
function openPr(wt, branch, title, bodyText) {
  const main = loadSettings().main_branch;
  if (loadSettings().forge === 'git') {
    // No forge: the PR text waits in run/pr/ for merge to check.
    const f = path.join(runDir, 'pr', `${branch}.md`);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `# ${title}\n\n${bodyText}\n\n## One-way doors\n\nNone.\n`);
    return `forge is git; PR text in ${path.relative(mainRoot, f)}; land it with: merge --chore ${branch.replace(/^chore-/, '')}`;
  }
  let pr = sh('gh', ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'url', '--jq', '.[0].url'], { cwd: wt });
  if (pr === null) { warn('gh is not available; open the PR by hand'); return ''; }
  if (!pr) pr = sh('gh', ['pr', 'create', '--head', branch, '--base', main, '--title', title, '--body', `${bodyText}\n\n## One-way doors\n\nNone.\n`], { cwd: wt }) ?? '';
  return pr;
}
function cmdChore() {
  const [sub, slugName] = positional;
  if (sub === 'start') { if (!slugName) die('usage: chore start <slug>'); supervisorOnly('chore'); return out(choreWorktree(slugName, { setup: true })); }
  if (sub !== 'pr' || !slugName || !flagStr('title')) die('usage: chore start <slug>   |   chore pr <slug> --title "<summary>"');
  supervisorOnly('chore');
  choreSlug(slugName);
  const wt = path.join(mainRoot, '.worktrees', `chore-${slugName}`);
  if (!fs.existsSync(wt)) die(`no worktree .worktrees/chore-${slugName}; devteam.mjs chore start ${slugName}`);
  gitOrDie(['add', '-A'], wt);
  if (gitOrDie(['status', '--porcelain'], wt)) gitOrDie(['commit', '--quiet', '-m', `chore-${slugName}: ${flagStr('title')}`], wt);
  gitOrDie(['push', '--quiet', '--force', 'origin', `chore-${slugName}:chore-${slugName}`], wt);
  const pr = openPr(wt, `chore-${slugName}`, `chore-${slugName}: ${flagStr('title')}`, flagStr('body') ?? flagStr('title'));
  out(`pushed chore-${slugName}${pr ? `: ${pr}` : ''}\nmerge it once CI passes, then: git worktree remove .worktrees/chore-${slugName}`);
}

// --- retros ---

const lastRetro = () => logObjects('observation').filter((o) => o.kind === 'retro' && o.created_by === 'supervisor').sort(byTime).pop() ?? null;
function finishedFeatures() {
  const res = [];
  for (const [fid, ts] of Object.entries(groupBy([...activeTickets().values()].filter((t) => t.feature !== CHORES), (t) => t.feature))) {
    const ats = ts.map((t) => mergedAt(t.id));
    if (ats.some((x) => !x)) continue;
    res.push({ feature: fid, finished_at: new Date(Math.max(...ats)).toISOString() });
  }
  return res;
}
function retroDue() {
  const last = lastRetro();
  const every = loadSettings().retro_every_days;
  const lastAt = last ? Date.parse(last.created_at) : null;
  const reasons = [];
  let since = null;
  if (!last) {
    const first = logObjects('phase').map((p) => p.created_at).sort()[0];
    if (first && Date.now() - Date.parse(first) >= every * DAY) { reasons.push(`no retro yet, and work started ${dateOnly(first)}`); since = new Date(Date.parse(first) + every * DAY).toISOString(); }
  } else if (Date.now() - lastAt >= every * DAY) { reasons.push(`${every} days since the last retro (${dateOnly(last.created_at)})`); since = new Date(lastAt + every * DAY).toISOString(); }
  for (const f of finishedFeatures()) if (!lastAt || Date.parse(f.finished_at) > lastAt) { reasons.push(`feature ${f.feature} finished ${dateOnly(f.finished_at)}`); if (!since || f.finished_at < since) since = f.finished_at; }
  return { due: reasons.length > 0, reasons, due_since: since, last: last ? { at: last.created_at, summary: last.detail, file: last.source_ref ?? null } : null };
}
function retroNumbers(m) {
  return {
    tickets_merged: m.tickets_merged, median_cycle_hours: m.cycle_hours.median, usd_total: m.cost.usd_total, usd_per_merged_ticket: m.cost.usd_per_merged_ticket,
    phase_hours: m.phase_hours, phase_usd: m.phase_usd, first_pass_rejection: Object.fromEntries(Object.entries(m.reviews.by_stage).map(([k, v]) => [k, v.rejection_rate])),
    escaped_defects: m.escaped_defects, owner_answer_rate_14d: m.owner_questions.answer_rate_14d ?? null, median_answer_hours: m.owner_questions.median_answer_hours,
    flaky_tests: m.gates.flaky_tests.length, slowest_gate: m.gates.gates[0] ? `${m.gates.gates[0].gate} ${m.gates.gates[0].median_seconds}s` : null,
  };
}
function retroDraft() {
  const last = lastRetro();
  const sinceMs = last ? Date.parse(last.created_at) : 0;
  const after = (iso) => Date.parse(iso) > sinceMs;
  const m = collectMetrics(sinceMs);
  const nums = retroNumbers(m);
  const prevText = last?.source_ref ? projectFileText(last.source_ref.replace(/^project\//, '')) : null;
  let prev = null;
  try { prev = JSON.parse(prevText?.match(/```json devteam-retro\s*\n([\s\S]*?)\n```/)?.[1] ?? 'null'); } catch { prev = null; }
  const fmt = (v) => (v === null || v === undefined ? '-' : typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k} ${x}`).join(', ') || '-' : String(v));
  const ts = tickets();
  const merged = [...ts.keys()].filter((id) => mergedAt(id) && mergedAt(id) > sinceMs);
  const rejected = [];
  for (const id of ts.keys()) { const b = ticketBranchRef(id); for (const r of ticketReviews(id, b && !mergeShaFor(id) ? { ref: b } : WORKTREE)) if (r.pass === 1 && !r.variant && r.verdict === 'CHANGES') rejected.push(`${id} ${r.stage}`); }
  const acts = logObjects('act');
  const corrections = acts.map((a) => ({ a, c: correctionOf(a) })).filter((x) => x.c && after(x.c.at));
  const outcomes = logObjects('observation').filter((o) => o.kind === 'outcome');
  const trials = acts.filter((a) => a.class === 'improvement-trial' && after(a.created_at));
  const openTrials = acts.filter((a) => a.class === 'improvement-trial' && !outcomes.some((o) => (o.refs ?? []).includes(a.id)));
  const problems = logObjects('problem');
  const goals = logObjects('goal').filter((g) => !['met', 'abandoned'].includes(g.status));
  const readingDue = goals.filter((g) => !goalReadings(g.id).some((r) => after(r.created_at)));
  const today = dateOnly(nowIso());
  const rows = ['tickets_merged', 'median_cycle_hours', 'usd_total', 'usd_per_merged_ticket', 'escaped_defects', 'owner_answer_rate_14d', 'median_answer_hours', 'flaky_tests', 'slowest_gate', 'first_pass_rejection', 'phase_hours', 'phase_usd'];
  return [
    `# Retro ${today}`, '', `Since: ${last ? last.created_at.slice(0, 16).replace('T', ' ') : 'the start'}`, '',
    '## Summary for the owner', '', '<Two lines: what went well, what changes. This becomes the retro line on the dashboard.>', '',
    '## Numbers', '', '| | Now | Previous retro |', '|---|---|---|',
    ...rows.map((k) => `| ${k.replace(/_/g, ' ')} | ${fmt(nums[k])} | ${prev ? fmt(prev[k]) : '-'} |`),
    '', '```json devteam-retro', JSON.stringify(nums), '```', '',
    '## Since the last retro', '',
    `- **Merged:** ${merged.join(', ') || 'none'}`,
    `- **Slowest:** ${m.cycle_hours.slowest.map((c) => `${c.id} ${c.hours}h`).join(', ') || '-'}`,
    `- **Rejected at first review:** ${rejected.join('; ') || 'none'}`,
    `- **Corrections:** ${corrections.map(({ a, c }) => `${a.id} (${a.class}): ${c.reason}`).join('; ') || 'none'}`,
    `- **Trials started:** ${trials.map((a) => `${a.id} ${a.what}`).join('; ') || 'none'}`,
    `- **Trials without an outcome:** ${openTrials.map((a) => `${a.id} ${a.what}`).join('; ') || 'none'}`,
    `- **Problems:** ${problems.filter((p) => after(p.created_at)).length} opened, ${problems.filter((p) => p.status === 'resolved' && p.updates.some((u) => u.status === 'resolved' && after(u.at))).length} resolved, ${problems.filter((p) => p.status !== 'resolved').length} open`,
    `- **Goal readings due:** ${readingDue.map((g) => `${g.id} (${g.title})`).join(', ') || 'none'}`,
    `- **Recurring, unexplained:** ${orientClusters().map((c) => `${c.key} x${c.count}`).join(', ') || 'none'}`,
    `- **Trust evidence supports asking about:** ${trustTable().filter((t) => t.can_ask).map((t) => t.class).join(', ') || 'nothing yet'}`,
    `- **Findings now:** ${m.findings.slice(0, 8).map((f) => `[${f.severity}] ${f.kind} ${f.subject}`).join('; ') || 'none'}`,
    '', '## Why', '', '<For each slow ticket, rejected review and correction above: why. Cite files and ids.>', '',
    '## What we will change', '', '<Each one: a trial (act), a chore ticket, a lesson or problem, or one proposal question for the owner covering everything that needs them. Or "nothing, because …".>', '',
    '## Roadmap', '', '```', roadmapText(collectRoadmap()), '```', '',
  ].join('\n');
}
function cmdRetro() {
  const [sub, arg] = positional;
  if (flags.due) {
    const d = retroDue();
    out(d.due ? `due: ${d.reasons.join('; ')}` : `not due${d.last ? ` (last ${dateOnly(d.last.at)})` : ''}`);
    process.exit(d.due ? 0 : 1);
  }
  supervisorOnly('retro');
  if (sub === 'close') {
    const date = arg ?? die('usage: retro close <YYYY-MM-DD> --summary "<two lines>" [--refs ids]');
    const rel = `retros/${date}.md`;
    if (!projectFileText(rel) && !fs.existsSync(path.join(mainRoot, '.worktrees', `chore-retro-${date}`, projectRel, rel))) die(`no retro file for ${date}; draft it with devteam.mjs retro`);
    return out(appendLog({ type: 'observation', source: 'supervisor', subject: 'project', kind: 'retro', detail: flagStr('summary') ?? die('retro close needs --summary'), source_ref: `project/${rel}`, refs: asList(flags.refs) }, 'supervisor').id);
  }
  if (flags.print) return out(retroDraft());
  const date = dateOnly(nowIso());
  const wt = choreWorktree(`retro-${date}`);
  const file = path.join(wt, projectRel, 'retros', `${date}.md`);
  if (fs.existsSync(file) && !flags.force) die(`${path.relative(mainRoot, file)} exists; edit it, or --force to redraft`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${retroDraft()}\n`);
  out(`drafted ${path.relative(mainRoot, file)}\nwrite Summary, Why and What we will change, then:\n  devteam.mjs chore pr retro-${date} --title "retro ${date}"\n  devteam.mjs retro close ${date} --summary "<two lines>" --refs <ids it produced>`);
}

// ===== 10. metrics, progress, the dashboard =====

function readJunit(file) {
  if (!file || !fs.existsSync(file)) return [];
  const xml = fs.readFileSync(file, 'utf8');
  const res = [];
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attr = (k) => m[1].match(new RegExp(`\\b${k}="([^"]*)"`))?.[1] ?? '';
    res.push({ name: [attr('classname'), attr('name')].filter(Boolean).join(' › ').slice(0, 120), ms: Math.round(Number(attr('time') || 0) * 1000), failed: /<(failure|error)\b/.test(m[3] ?? '') });
  }
  return res;
}
// Failed tests plus the ten slowest: enough for flakiness and hotspots, small enough for one line.
const keepTests = (tests) => [...tests.filter((t) => t.failed).slice(0, 30), ...tests.filter((t) => !t.failed).sort((a, b) => b.ms - a.ms).slice(0, 10)];

function gateStats(runs) {
  const byGate = new Map();
  for (const r of runs) (byGate.get(r.gate) ?? byGate.set(r.gate, []).get(r.gate)).push(r);
  const gates = [];
  const flakyGates = [];
  for (const [g, rs] of byGate) {
    const bySha = new Map();
    for (const r of rs.filter((x) => !x.dirty)) (bySha.get(r.sha) ?? bySha.set(r.sha, []).get(r.sha)).push(r);
    const flaky = [...bySha.values()].filter((x) => x.some((r) => r.ok) && x.some((r) => !r.ok)).length;
    if (flaky) flakyGates.push({ gate: g, commits: flaky });
    gates.push({ gate: g, runs: rs.length, fail_rate: +(rs.filter((r) => !r.ok).length / rs.length).toFixed(2), median_seconds: +(median(rs.map((r) => r.ms)) / 1000).toFixed(1), max_seconds: +(Math.max(...rs.map((r) => r.ms)) / 1000).toFixed(1) });
  }
  const flakyTests = new Map();
  const testMs = new Map();
  for (const r of runs) for (const t of r.tests ?? []) {
    if (!t.failed) (testMs.get(t.name) ?? testMs.set(t.name, []).get(t.name)).push(t.ms);
    if (t.failed && !r.dirty && runs.some((o) => o !== r && !o.dirty && o.gate === r.gate && o.sha === r.sha && o.ok && o.created_at >= r.created_at)) flakyTests.set(t.name, (flakyTests.get(t.name) ?? 0) + 1);
  }
  return {
    gates: gates.sort((a, b) => b.median_seconds - a.median_seconds), flaky_gates: flakyGates,
    flaky_tests: [...flakyTests.entries()].sort((a, b) => b[1] - a[1]).map(([name, times]) => ({ name, times })),
    slowest_tests: [...testMs.entries()].map(([name, xs]) => ({ name, median_seconds: +(median(xs) / 1000).toFixed(1) })).sort((a, b) => b.median_seconds - a.median_seconds).slice(0, 10),
  };
}

function collectMetrics(since) {
  const settings = loadSettings();
  const now = Date.now();
  const ts = tickets();
  const phaseLines = new Map();
  for (const l of logObjects('phase')) (phaseLines.get(l.created_by) ?? phaseLines.set(l.created_by, []).get(l.created_by)).push(l);
  for (const ls of phaseLines.values()) ls.sort(byTime);

  // Cycle time: a ticket's first phase line to its merge.
  const cycles = [];
  for (const id of ts.keys()) {
    const m = mergedAt(id);
    const first = phaseLines.get(id)?.[0];
    if (m && m >= since && first && m > Date.parse(first.created_at)) cycles.push({ id, ms: m - Date.parse(first.created_at) });
  }
  cycles.sort((a, b) => b.ms - a.ms);

  // Time and cost per phase. Each phase lasts until the next line, the merge, or now; spend between
  // two lines is charged to the earlier line's phase.
  const phaseMs = {};
  const phaseNow = new Map();
  const phaseUsd = {};
  const ticketUsd = {};
  for (const [who, ls] of phaseLines) {
    let lastUsd = 0;
    ls.forEach((l, i) => {
      const at = Date.parse(l.created_at);
      if (typeof l.usd === 'number') {
        const delta = Math.max(0, l.usd - lastUsd);
        const charged = who === 'supervisor' ? 'supervisor' : (ls[i - 1]?.to ?? l.from ?? 'starting');
        if (at >= since) { phaseUsd[charged] = (phaseUsd[charged] ?? 0) + delta; ticketUsd[who] = (ticketUsd[who] ?? 0) + delta; }
        lastUsd = l.usd;
      }
      if (who === 'supervisor' || at < since) return;
      const merged = mergedAt(who);
      const endMs = i + 1 < ls.length ? Date.parse(ls[i + 1].created_at) : merged ? Math.max(at, merged) : ['done', 'parked'].includes(l.to) ? at : now;
      phaseMs[l.to] = (phaseMs[l.to] ?? 0) + (endMs - at);
      if (i === ls.length - 1 && !merged) phaseNow.set(who, { phase: l.to, sinceMs: at });
    });
  }
  const mergedCosts = cycles.map((c) => ticketUsd[c.id]).filter((x) => x !== undefined);

  const msgs = logObjects('message').filter((m) => Date.parse(m.created_at) >= since).sort(byTime);
  const replies = new Map();
  for (const m of msgs) if (m.re && !replies.has(m.re)) replies.set(m.re, Date.parse(m.created_at));
  const expecting = msgs.filter((m) => !['info', 'ruling', 'answer'].includes(m.kind));
  const openMsgs = expecting.filter((m) => !replies.has(m.id));
  const msgWaits = expecting.filter((m) => replies.has(m.id)).map((m) => replies.get(m.id) - Date.parse(m.created_at));
  const qs = questions().filter((q) => Date.parse(q.asked_at) >= since);
  const qWaits = qs.filter((q) => q.answered_at && q.status === 'answered').map((q) => Date.parse(q.answered_at) - Date.parse(q.asked_at));
  const openQs = qs.filter((q) => q.status === 'open');
  const grace = settings.question_default_after_hours * 3600000;
  const recentQs = questions().filter((q) => now - Date.parse(q.asked_at) <= 14 * DAY && q.status !== 'withdrawn' && (q.status !== 'open' || now - Date.parse(q.asked_at) > grace));
  const answeredRecent = recentQs.filter((q) => q.status === 'answered').length;

  const reviews = reviewStats();
  const gates = gateStats(logObjects('gate').filter((g) => Date.parse(g.created_at) >= since));
  const round = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +v.toFixed(2)]));
  const m = {
    since: since ? new Date(since).toISOString() : null,
    tickets_merged: cycles.length,
    cycle_hours: { median: hours(median(cycles.map((c) => c.ms))), slowest: cycles.slice(0, 5).map((c) => ({ id: c.id, hours: hours(c.ms) })) },
    phase_hours: Object.fromEntries(Object.entries(round(phaseMs)).map(([k, v]) => [k, hours(v)])),
    phase_usd: round(phaseUsd),
    cost: { usd_total: +Object.values(ticketUsd).reduce((a, b) => a + b, 0).toFixed(2), usd_per_merged_ticket: mergedCosts.length ? +(mergedCosts.reduce((a, b) => a + b, 0) / mergedCosts.length).toFixed(2) : null, by_ticket: round(ticketUsd) },
    reviews, gates,
    messages: { expecting_reply: expecting.length, still_open: openMsgs.length, median_reply_minutes: msgWaits.length ? +(median(msgWaits) / 60000).toFixed(1) : null },
    owner_questions: { asked: qs.length, open: openQs.length, median_answer_hours: hours(median(qWaits)), oldest_open_hours: openQs.length ? hours(now - Math.min(...openQs.map((q) => Date.parse(q.asked_at)))) : null, answer_rate_14d: recentQs.length ? +(answeredRecent / recentQs.length).toFixed(2) : null },
    escaped_defects: logObjects('observation').filter((o) => o.kind === 'escaped-defect' && Date.parse(o.created_at) >= since).length,
  };

  // Findings: blockers and inefficiencies, each with a next step.
  const f = [];
  const add = (severity, kind, subject, detail, suggestion) => f.push({ severity, kind, subject, detail, suggestion });
  for (const g of gates.flaky_gates) add('high', 'flaky-gate', g.gate, `failed then passed at the same commit ${g.commits} time(s)`, 'find the flaky tests (run with --junit) and fix or quarantine them');
  for (const t of gates.flaky_tests.slice(0, 10)) add('high', 'flaky-test', t.name, `failed then passed at the same commit ${t.times} time(s)`, 'make it deterministic (time, order, shared state, network) or quarantine it with a ticket');
  for (const g of gates.gates.filter((x) => x.median_seconds >= settings.slow_gate_minutes * 60)) add('medium', 'slow-gate', g.gate, `median ${(g.median_seconds / 60).toFixed(1)} min over ${g.runs} run(s)`, 'shard it, cache dependencies, or split fast checks from slow ones');
  for (const t of gates.slowest_tests.slice(0, 5).filter((x) => x.median_seconds >= 10)) add('low', 'slow-test', t.name, `median ${t.median_seconds}s`, 'mock the slow dependency or move it to an integration suite');
  // A share of almost nothing is noise: hotspots wait for a few hours of ticket time or a few dollars.
  const HOTSPOT_MIN_MS = 4 * 3600000, HOTSPOT_MIN_USD = 5;
  const totalPhase = Object.values(phaseMs).reduce((a, b) => a + b, 0);
  const [topPhase, topMs] = Object.entries(phaseMs).filter(([k]) => !['done', 'parked'].includes(k)).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (phaseNow.size >= 2 && topPhase && totalPhase >= HOTSPOT_MIN_MS && topMs / totalPhase > 0.4) add('medium', 'phase-hotspot', topPhase, `${Math.round((100 * topMs) / totalPhase)}% of all ticket time`, 'look at why tickets sit here: reviews, gates, answers');
  const totalUsd = Object.values(phaseUsd).reduce((a, b) => a + b, 0);
  const [costPhase, costUsd] = Object.entries(phaseUsd).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (phaseNow.size >= 2 && costPhase && totalUsd >= HOTSPOT_MIN_USD && costUsd / totalUsd > 0.5) add('medium', 'cost-hotspot', costPhase, `${Math.round((100 * costUsd) / totalUsd)}% of spend ($${costUsd.toFixed(2)})`, 'check context size and model choice for this phase');
  for (const [id, p] of phaseNow) {
    const h = (now - p.sinceMs) / 3600000;
    if (p.phase === 'blocked' && h >= 1) add('high', 'blocked', id, `blocked for ${h.toFixed(1)}h`, 'answer its message, re-plan, or park it');
    if (p.phase === 'awaiting-word' && h >= 1) add('medium', 'waiting-on-supervisor', id, `waiting for the stage or merge word for ${h.toFixed(1)}h`, 'answer its review-request: give the word, run merge, or say what is missing');
  }
  for (const id of ts.keys()) {
    const w = workerState(id);
    const wait = paneWaiting(id);
    if (wait) add('high', 'blocked-prompt', id, wait.kind === 'limit' ? `a usage-limit banner in its pane: "${wait.line}"` : `waiting on a prompt in its pane: "${wait.line}"`, `look (tmux select-window -t ${settings.tmux_session}:${id}) and clear it (supervisor.md §11); a permission prompt a worker should never see means agent_command or its deny rules need a fix`);
    if (w && w.phase && !['done', 'parked', 'awaiting-word', 'blocked'].includes(w.phase) && !mergeShaFor(id) && w.minutes_silent > settings.stale_after_minutes) add('high', 'stale-worker', id, `silent for ${w.minutes_silent} min (phase ${w.phase})`, 'check its pane; resume it (supervisor.md, recovery)');
  }
  for (const msg of openMsgs.filter((x) => now - Date.parse(x.created_at) > 30 * 60000)) add('medium', 'unanswered-message', msg.id, `${msg.kind} from ${msg.created_by}, ${Math.round((now - Date.parse(msg.created_at)) / 60000)} min old`, `reply with --re ${msg.id}`);
  for (const q of openQs.filter((x) => now - Date.parse(x.asked_at) > grace)) add('high', 'owner-question-waiting', q.id, q.question.slice(0, 120), q.default ? 'apply its default' : 'remind the owner; it blocks work');
  if (recentQs.length >= 4 && answeredRecent / recentQs.length < 0.5) add('high', 'inbox-stalled', 'owner questions', `${answeredRecent} of ${recentQs.length} answered in 14 days`, 'remind the owner what is blocked; give defaults where the class allows; withdraw what no longer matters');
  for (const [id, n] of Object.entries(reviewPasses()).filter(([, n]) => n >= 3)) add('medium', 'review-churn', id, `${n} final review passes`, 'the ticket may be too big or under-specified; re-plan it');
  const ready = [...ts.values()].filter((t) => isActive(t) && !isHeld(t) && !mergeShaFor(t.id) && !activeWorker(t.id) && (t.depends_on ?? []).every((d) => mergeShaFor(d)) && !notSchedulable(t));
  const active = [...ts.keys()].filter(activeWorker).length;
  if (ready.length && active < settings.max_active_tickets) add('medium', 'idle-capacity', `${ready.length} ready`, `${active}/${settings.max_active_tickets} workers active`, `make workers for: ${ready.slice(0, 5).map((t) => t.id).join(', ')}`);
  if (m.escaped_defects) add('high', 'escaped-defects', `${m.escaped_defects}`, 'defects found after merge', 'retro: which review or gate should have caught each one');
  const order = { high: 0, medium: 1, low: 2 };
  // A finding someone has looked at and set aside (`ack`) moves to acknowledged until the ack
  // expires or its subject changes; it is never hidden.
  const ackWindow = settings.finding_ack_hours * 3600000;
  const acks = logObjects('observation').filter((o) => o.kind === 'finding-ack' && now - Date.parse(o.created_at) < ackWindow);
  const ackOf = (x) => acks.filter((a) => a.subject === `${x.kind} ${x.subject}`).sort(byTime).pop();
  const sorted = f.sort((a, b) => order[a.severity] - order[b.severity]);
  m.findings = sorted.filter((x) => !ackOf(x));
  m.acknowledged = sorted.filter(ackOf).map((x) => { const a = ackOf(x); return { ...x, ack: { by: a.created_by, at: a.created_at, reason: a.detail, until: new Date(Date.parse(a.created_at) + ackWindow).toISOString() } }; });
  return m;
}
// ack <finding-kind> <subject> --reason r [--owner]: set a metrics finding aside for
// finding_ack_hours. The subject is the finding's, as metrics prints it.
function cmdAck() {
  const [kind, ...subj] = positional;
  const subject = subj.join(' ').trim();
  const reason = flagStr('reason');
  if (!kind || !subject || !reason) die('usage: ack <finding-kind> <subject> --reason "<why it can wait>" [--owner]');
  const live = collectMetrics(0).findings.find((x) => x.kind === kind && x.subject === subject);
  if (!live) die(`no current finding ${kind} "${subject}" (devteam.mjs metrics lists them)`);
  const by = flags.owner ? ownerWriter().by : (supervisorOnly('ack'), 'supervisor');
  const line = appendLog({ type: 'observation', source: 'ack', kind: 'finding-ack', subject: `${kind} ${subject}`, detail: reason, refs: [] }, by);
  out(`${line.id}: ${kind} ${subject} set aside for ${loadSettings().finding_ack_hours}h`);
}

function cmdMetrics() {
  const since = flagStr('since') ? Date.parse(flagStr('since')) : 0;
  if (Number.isNaN(since)) die('--since must be a date');
  const m = collectMetrics(since);
  if (flags.json) return json(m);
  const kv = (o, unit = '') => Object.entries(o).map(([k, v]) => `${k} ${unit}${v}`).join(', ') || '-';
  out([
    `since: ${m.since ?? 'the beginning'}`,
    `tickets merged: ${m.tickets_merged}; median cycle ${m.cycle_hours.median ?? '-'}h; slowest ${m.cycle_hours.slowest.map((c) => `${c.id} ${c.hours}h`).join(', ') || '-'}`,
    `time by phase (h): ${kv(m.phase_hours)}`,
    `cost by phase: ${kv(m.phase_usd, '$')}; total $${m.cost.usd_total}; per merged ticket ${m.cost.usd_per_merged_ticket === null ? '-' : `$${m.cost.usd_per_merged_ticket}`}`,
    `gates (median): ${m.gates.gates.map((g) => `${g.gate} ${g.median_seconds}s (fail ${Math.round(g.fail_rate * 100)}%)`).join(', ') || '-'}`,
    `first-pass rejection: ${Object.entries(m.reviews.by_stage).map(([k, v]) => `${k} ${v.rejected}/${v.first_passes}`).join(', ') || '-'}; false positives ${m.reviews.false_positive_rate ?? '-'}`,
    `messages: ${m.messages.still_open} of ${m.messages.expecting_reply} awaiting reply; median reply ${m.messages.median_reply_minutes ?? '-'} min`,
    `owner questions: ${m.owner_questions.open} open of ${m.owner_questions.asked}; median answer ${m.owner_questions.median_answer_hours ?? '-'}h; answer rate (14d) ${m.owner_questions.answer_rate_14d ?? '-'}`,
    `escaped defects: ${m.escaped_defects}`,
    '',
    m.findings.length ? 'findings:' : 'findings: none',
    ...m.findings.map((x) => `  [${x.severity}] ${x.kind}: ${x.subject} (${x.detail}) -> ${x.suggestion}`),
  ].join('\n'));
}

// Per-ticket progress data for the burn-up, board and roadmap.
function collectProgress() {
  const sub = activeTickets();
  const level = findCycle(sub) ? new Map() : levels(sub);
  const status = new Map(deriveStatus().map((r) => [r.id, r]));
  const fs_ = features();
  const stories = {};
  for (const [fid, f] of fs_) for (const s of f.stories ?? []) stories[s.id] = { feature: fid, text: s.text, release: s.release ?? null };
  const items = [...sub.values()].map((t) => {
    const st = status.get(t.id);
    const sha = st?.merge_sha;
    const targets = [...new Set((t.serves ?? []).map((x) => stories[x]?.release).filter(Boolean))].sort();
    return {
      id: t.id, title: t.title, feature: t.feature, component: t.component, kind: t.kind, size: t.size, risk: t.risk, weight: weight(t), serves: t.serves ?? [], depends_on: t.depends_on ?? [],
      wave: level.has(t.id) ? level.get(t.id) + 1 : null, added_at: t.created_at,
      merged_at: sha ? new Date(mergedAt(t.id)).toISOString() : null, released_in: sha ? releasedIn(sha) : null, target_release: targets[0] ?? null,
      stage: st?.stage ?? 'planned', phase: st?.phase ?? null, task: st?.task ?? null, held: isHeld(t) ? t.held : null, waiting: st?.waiting ?? null,
    };
  });
  return { now: nowIso(), features: [...new Set(items.map((t) => t.feature))], stories, tickets: items };
}

function collectOoda() {
  const log = readLog();
  const L = ladder();
  const recent = (xs, n) => xs.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, n);
  // A ticket edit's act names the fields; attach the values it set, so the feed can say "put on
  // hold" or "took off hold" as it happened, not as the ticket stands now.
  const ticketSets = log.lines.filter((l) => l.type === 'ticket' && l.op === 'set');
  const changeOf = (a) => {
    if (a.class !== 'replan-within-feature') return undefined;
    const l = ticketSets.filter((x) => (a.refs ?? []).includes(x.id) && x.at <= a.created_at).pop();
    return l ? Object.fromEntries(Object.entries(l).filter(([k]) => !ENVELOPE.includes(k) && !k.startsWith('__'))) : undefined;
  };
  const acts = logObjects('act').map((a) => ({ ...a, correction: correctionOf(a), ladder: !!L.classes[a.class], change: changeOf(a) }));
  return {
    goals: logObjects('goal').map(goalView).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99)),
    roadmap: collectRoadmap(),
    retro: retroDue(),
    observations: recent(logObjects('observation').filter((o) => !['reading', 'retro', 'finding-ack'].includes(o.kind)), 40),
    clusters: orientClusters(),
    knowledge: recent(logObjects('knowledge').filter((k) => k.status !== 'retired'), 60),
    problems: logObjects('problem').filter((p) => p.status !== 'resolved').sort((a, b) => b.severity - a.severity),
    acts: recent(acts, 60),
    trust: trustTable(),
    classes: Object.fromEntries(Object.entries(L.classes).map(([k, v]) => [k, { ...v, rung: rungFor(k) }])),
    reasons: L.reasons,
    // every settled question, newest first, wherever it was answered (dashboard, terminal, chat) or
    // whether it was defaulted or withdrawn; defaulted ones can still be overruled
    answered: questions().filter((q) => q.status !== 'open').sort((a, b) => b.answered_at.localeCompare(a.answered_at)).slice(0, 80),
    log: { lines: log.lines.length, errors: log.errors.length, ignored: log.ignored.length },
  };
}
function dashboardData() {
  const settings = loadSettings();
  const sub = activeTickets();
  const msgs = logObjects('message');
  const replied = new Set(msgs.map((m) => m.re).filter(Boolean));
  return {
    generated_at: nowIso(), project: settings.project,
    caps: { max_active_tickets: settings.max_active_tickets },
    tickets: deriveStatus(),
    critical_path: findCycle(sub) ? [] : criticalPath(sub).path,
    questions: rankQuestions(questions().filter((q) => q.status === 'open')),
    open_messages: msgs.filter((m) => !['info', 'ruling', 'answer'].includes(m.kind) && !replied.has(m.id)).map((m) => ({ id: m.id, kind: m.kind, actor: m.created_by, to: m.to, summary: m.text })),
    metrics: collectMetrics(0),
    progress: collectProgress(),
    ooda: collectOoda(),
  };
}
const cmdDashboardData = () => out(JSON.stringify(dashboardData()));

// timeline <ticket-id> [--json]: the ticket, and every log line that bears on it (its own edits,
// its worker's phases, gates and messages, questions it raised or that block it, acts and
// observations that name it), oldest first; plus its review records and its files.
function cmdTimeline() {
  const [id] = positional;
  const t = tickets().get(id) ?? die(`no ticket ${id}`);
  const touches = (l) => l.id === id || l.by === id || l.ticket === id || l.to === id || l.subject === id
    || (l.refs ?? []).includes(id) || (l.blocks ?? []).includes(id) || (l.serves ?? []).includes(id);
  const lines = readLog().lines.filter(touches);
  // a question answered later belongs here too: its answer lines name only the question
  const qids = new Set(lines.filter((l) => l.type === 'question').map((l) => l.id));
  const all = readLog().lines.filter((l) => touches(l) || (l.type === 'question' && qids.has(l.id))).sort((a, b) => a.at.localeCompare(b.at));
  const st = deriveStatus().find((r) => r.id === id);
  const branch = ticketBranchRef(id);
  const ref = branch && !mergeShaFor(id) ? branch : mainRef();
  const files = ['spec.md', 'plan.md', 'verification.md'].map((f) => `${projectRel}/tickets/${id}/${f}`).filter((f) => ref && git(['cat-file', '-e', `${ref}:${f}`]) !== null).map((f) => ({ title: path.basename(f, '.md'), path: f, ref }));
  const reviews = ticketReviews(id, branch && !mergeShaFor(id) ? { ref: branch } : WORKTREE).map((r) => ({ file: r.file, stage: r.stage, pass: r.pass, verdict: r.verdict, reviewer: r.reviewer }));
  const view = { ticket: { ...t, ...st }, files, reviews, lines: all.map((l) => Object.fromEntries(Object.entries(l).filter(([k]) => !k.startsWith('__')))) };
  if (flags.json) return json(view);
  out(`${id} [${st?.stage}${st?.phase ? `, ${st.phase}` : ''}] ${t.title}`);
  for (const l of all) out(`${l.at} ${l.type.padEnd(11)} ${l.by.padEnd(14)} ${l.what ?? l.text ?? l.question ?? l.detail ?? l.answer ?? (l.type === 'phase' ? `${l.from ?? ''} -> ${l.to}` : l.op)}`);
}

// The dashboard: one page, data computed on each request, owner actions only from that page.
function cmdDashboard() {
  const port = Number(flagStr('port') ?? loadSettings().dashboard_port);
  const host = flagStr('host') ?? '127.0.0.1';
  const page = path.join(devteamDir, 'dashboard', 'index.html');
  const self = fileURLToPath(import.meta.url);
  const ownerEnv = { ...process.env, DEVTEAM_CHANNEL: 'dashboard' };
  delete ownerEnv.DEVTEAM_ROLE;
  delete ownerEnv.DEVTEAM_TICKET;
  delete ownerEnv.DEVTEAM_FEATURE;
  const run = (args) => new Promise((resolve) => execFile(process.execPath, [self, ...args], { cwd: mainRoot, maxBuffer: 64 * 1024 * 1024, env: ownerEnv }, (err, stdout, stderr) => resolve({ ok: !err, stdout, stderr })));
  const ID = /^[a-z]-\d{8}-\d{9}-[a-z0-9]+(-[a-z0-9]+)*$/;
  const text = (x, max = 4000) => typeof x === 'string' && x.trim() && x.length <= max;
  const ACTIONS = {
    answer: (b) => {
      if (!ID.test(b.id ?? '') || !text(b.answer)) return null;
      const args = ['answer', b.id, b.answer.trim()];
      if ([1, 2, 3].includes(b.autonomy)) args.push('--autonomy', String(b.autonomy), ...(text(b.scope, 100) ? ['--scope', b.scope.trim()] : []));
      if (text(b.rule, 600)) args.push('--rule', b.rule.trim());
      return args;
    },
    correct: (b) => (ID.test(b.id ?? '') && text(b.reason, 600) ? ['correct', b.id, '--reason', b.reason.trim()] : null),
    'goal-approve': (b) => (ID.test(b.id ?? '') ? ['goal', 'approve', b.id] : null),
    knowledge: (b) => (ID.test(b.id ?? '') && ['accepted', 'retired', 'stale'].includes(b.status) ? ['knowledge', 'set', b.id, '--status', b.status, '--owner'] : null),
    ack: (b) => (/^[a-z][a-z-]*$/.test(b.kind ?? '') && text(b.subject, 200) && text(b.reason, 600) ? ['ack', b.kind, b.subject, '--reason', b.reason.trim(), '--owner'] : null),
  };
  const send = (res, code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(page));
    if (req.method === 'GET' && req.url.startsWith('/api/data')) {
      const r = await run(['dashboard-data']);
      return r.ok ? send(res, 200, 'application/json', r.stdout) : send(res, 500, 'application/json', JSON.stringify({ error: r.stderr.trim() }));
    }
    const u = new URL(req.url, 'http://x');
    if (req.method === 'GET' && u.pathname === '/api/timeline') {
      const id = u.searchParams.get('id') ?? '';
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return send(res, 400, 'application/json', JSON.stringify({ error: 'bad ticket id' }));
      const r = await run(['timeline', id, '--json']);
      return r.ok ? send(res, 200, 'application/json', r.stdout) : send(res, 404, 'application/json', JSON.stringify({ error: r.stderr.trim() }));
    }
    // An artifact a question or ticket links to, read from git (committed content only, never a
    // path outside the repo). HTML mocks are served sandboxed so they can't call the owner API.
    if (req.method === 'GET' && u.pathname === '/api/file') {
      const p = u.searchParams.get('path') ?? '';
      const ref = u.searchParams.get('ref') || mainRef() || 'HEAD';
      if (!/^(?!\/)(?!.*\.\.)[^\s]+$/.test(p) || !/^[A-Za-z0-9._\/-]+$/.test(ref)) return send(res, 400, 'text/plain', 'bad path or ref');
      const body = await new Promise((resolve) => execFile('git', ['show', `${ref}:${p}`], { cwd: mainRoot, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout)));
      if (!body) return send(res, 404, 'text/plain', `not found: ${p} at ${ref}`);
      const ext = path.extname(p).toLowerCase();
      const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.html': 'text/html; charset=utf-8' }[ext] ?? 'text/plain; charset=utf-8';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'content-security-policy': 'sandbox', 'x-content-type-options': 'nosniff' });
      return res.end(body);
    }
    const action = req.method === 'POST' && req.url.startsWith('/api/') ? ACTIONS[req.url.slice(5)] : null;
    if (!action) return send(res, 404, 'text/plain', 'not found');
    const okHost = [`127.0.0.1:${port}`, `localhost:${port}`, `${host}:${port}`].includes(req.headers.host ?? '');
    const site = req.headers['sec-fetch-site'];
    const origin = req.headers.origin;
    const sameOrigin = (!site || site === 'same-origin') && (!origin || origin === `http://${req.headers.host}`);
    if (!okHost || !sameOrigin || !(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 403, 'application/json', JSON.stringify({ error: 'owner actions only from this page' }));
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 20000) req.destroy(); });
    req.on('end', async () => {
      let parsed;
      try { parsed = JSON.parse(body || '{}'); } catch { return send(res, 400, 'application/json', JSON.stringify({ error: 'bad json' })); }
      const args = action(parsed);
      if (!args) return send(res, 400, 'application/json', JSON.stringify({ error: 'missing or invalid fields' }));
      const r = await run(args);
      send(res, r.ok ? 200 : 400, 'application/json', JSON.stringify(r.ok ? { ok: true, out: r.stdout.trim() } : { error: r.stderr.split('\n').filter((l) => l && !l.startsWith('devteam: warning:')).join(' ').replace(/^devteam: /, '') }));
    });
  });
  server.listen(port, host, () => out(`devteam dashboard on http://${host}:${port}`));
}

// ===== 11. sessions: workers, planners, messages, phases, gates =====

const PROMPTS = {
  supervisor: 'You are the supervisor for this repository, running in the owner\'s terminal. Read the devteam section of AGENTS.md, then docs/devteam/process/supervisor.md, and follow it from the start. You write no production code. The log (devteam.mjs log, questions, status) and the tracked files are the record; chat is not. If there are no ready goals, begin at docs/devteam/process/planning.md §1 by asking the owner what the project is for.',
  worker: 'You are the worker for ticket {{ID}}. Read the devteam section of AGENTS.md, then docs/devteam/process/worker.md, and follow it from §1. Your ticket: node docs/devteam/scripts/devteam.mjs ticket show {{ID}}. Use superpowers for every step; devteam says where files go and what must be true before you ask for the merge.',
  planner: 'You are planning feature {{ID}} on branch plan/{{ID}}, in this worktree. Read the devteam section of AGENTS.md, then docs/devteam/process/planning.md, and run the pipeline from §2 for this feature. Your tickets and the feature line go to the log with devteam.mjs feature add / ticket add; commit everything as you go; message the supervisor (devteam.mjs send supervisor) when the graph review passes.',
};
function cmdPrompt() {
  const role = positional[0];
  if (!PROMPTS[role]) die('usage: prompt supervisor|worker <ticket-id>|planner <feature>');
  const p = PROMPTS[role].replace(/\{\{ID\}\}/g, positional[1] ?? '');
  const block = role === 'supervisor' ? '' : knowledgeBlock(positional[1]);
  out(block ? `${p}\n\n${block}` : p);
}

const tmux = (args) => sh('tmux', args) !== null;
// The session:window running this command. TMUX_PANE pins it to our own pane.
const tmuxHere = () => (process.env.TMUX && process.env.TMUX_PANE ? sh('tmux', ['display-message', '-p', '-t', process.env.TMUX_PANE, '#S:#W']) : null);
const supervisorTarget = () => process.env.DEVTEAM_SUPERVISOR ?? readText(supervisorPaneFile())?.trim() ?? null;
const SHELLS = new Set(['bash', 'zsh', 'sh', 'fish', 'dash', 'ksh', 'tcsh', 'csh', 'login']);
// Resolve a session:window exactly and check an agent, not a bare shell, is running there (typing
// into a shell would execute the text).
function resolvePane(target) {
  if (!target) return { problem: 'the supervisor has not run inside tmux yet (no pane recorded); it reads messages on its tick' };
  let exact = target;
  if (!target.startsWith('%')) {
    const i = target.lastIndexOf(':');
    const [session, win] = i === -1 ? [target, '0'] : [target.slice(0, i), target.slice(i + 1)];
    const listed = sh('tmux', ['list-windows', '-t', session, '-F', '#{window_index} #{window_name}']);
    if (listed === null) return { problem: `no tmux session "${session}"` };
    const rows = listed.split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf(' ')), l.slice(l.indexOf(' ') + 1)]);
    const row = rows.find(([idx, name]) => name === win || idx === win);
    if (!row) return { problem: `no tmux window "${win}" in session "${session}"` };
    exact = `${session}:${row[0]}`;
  }
  const info = sh('tmux', ['display-message', '-p', '-t', exact, '#{pane_dead} #{pane_current_command}']);
  if (info === null) return { problem: `cannot inspect ${exact}` };
  const [dead, cmd = ''] = info.split(' ');
  if (dead === '1') return { problem: `the pane in ${exact} has exited` };
  if (SHELLS.has(cmd.replace(/^-/, ''))) return { problem: `no agent is running in ${exact} (it is at a ${cmd} prompt); resume it first` };
  return { target: exact };
}
const typeInto = (target, line) => tmux(['send-keys', '-t', target, '-l', line]) && tmux(['send-keys', '-t', target, 'Enter']);
function nudgeSupervisor(line) {
  const { target, problem } = resolvePane(supervisorTarget());
  if (problem) return void warn(`not delivered to the supervisor: ${problem}`);
  typeInto(target, line);
}
const myAddress = () => { const w = logWriter(); return w === 'supervisor' ? 'supervisor' : w; };

function cmdSend() {
  const [to, ...words] = positional;
  const text = words.join(' ').replace(/\s+/g, ' ').trim();
  if (!to || !text) die('usage: send <supervisor|ticket-id|plan-<feature>> "<text>" [--kind k] [--re m-…] [--sha s]');
  const kind = flagStr('kind') ?? 'info';
  // --owner: the owner, in their own terminal, telling a session something. Logged as the owner's.
  const from = flags.owner ? ownerWriter().by : myAddress();
  if (from === 'owner' && kind !== 'info') die('the owner sends info messages; answers go through answer <qid>, rulings come from the supervisor');
  if (['ruling', 'answer'].includes(kind) && from !== 'supervisor') die(`only the supervisor sends ${kind} messages`);
  const target = to === 'supervisor' ? supervisorTarget() : `${loadSettings().tmux_session}:${to}`;
  const { target: exact, problem } = resolvePane(target);
  const sha = flagStr('sha') ?? (kind === 'merge-request' ? git(['rev-parse', 'HEAD']) : null);
  const re = flagStr('re') ?? null;
  if (re && logGet(re)?.type !== 'message') warn(`--re ${re} matches no logged message`);
  // The log is the record; the pane is delivery. A recipient whose pane is gone catches up with `messages`.
  const line = appendLog({ type: 'message', to, kind, text, re, sha, ticket: flagStr('ticket') ?? (from === 'owner' ? null : currentTicketId()) ?? (tickets().has(to) ? to : null) }, from);
  if (problem || !typeInto(exact, `[devteam ${kind} ${line.id} from ${from}${re ? ` re ${re}` : ''}${sha ? ` @ ${sha}` : ''}] ${text}`)) warn(`${line.id} recorded but not delivered to "${to}": ${problem ?? `could not type into ${exact}`}; it shows in their \`messages\``);
  out(line.id);
}
function cmdMessages() {
  const me = flagStr('to') ?? myAddress();
  const all = logObjects('message').sort(byTime);
  const replied = new Set(all.map((m) => m.re).filter(Boolean));
  let mine = all.filter((m) => m.to === me);
  if (flags.open) mine = mine.filter((m) => !replied.has(m.id) && !['info', 'ruling', 'answer'].includes(m.kind));
  mine = mine.slice(-Number(flagStr('tail') ?? 50));
  if (flags.json) return json(mine);
  if (!mine.length) return out(flags.open ? 'no open messages' : 'no messages');
  for (const m of mine) out(`${m.created_at} ${m.id} [${m.kind}] from ${m.created_by}${m.re ? ` re ${m.re}` : ''}${m.sha ? ` @ ${m.sha.slice(0, 12)}` : ''}: ${m.text}`);
}

// phase <to> [--task t] [--note n] [--usd x --in n --out n]: a worker's phase change, or a liveness
// ping (same phase). Writes a line only when something changed or the last one is older than 15 min.
function cmdPhase() {
  const to = positional[0];
  const supervisor = to === 'supervisor';
  const id = supervisor ? 'supervisor' : currentTicketId() ?? die('phase needs DEVTEAM_TICKET or a ticket/<id> branch');
  if (!to) die('usage: phase <starting|spec|plan|contract|build|verify|final-review|awaiting-word|merging|done|blocked|parked> [--task t] [--note n] [--usd x --in n --out n]');
  for (const k of ['usd', 'in', 'out']) if (flags[k] !== undefined && !(Number(flagStr(k)) >= 0)) die(`--${k} must be a number ≥ 0`);
  const prev = logObjects('phase').filter((p) => p.created_by === id).sort(byTime).pop() ?? null;
  const cost = flags.usd !== undefined || flags.in !== undefined || flags.out !== undefined
    ? { usd: flagNum('usd') ?? prev?.usd ?? 0, input_tokens: flagNum('in') ?? prev?.input_tokens ?? 0, output_tokens: flagNum('out') ?? prev?.output_tokens ?? 0 }
    : {};
  if (supervisor) {
    if (cost.usd === undefined) die('phase supervisor needs --usd (its cumulative spend)');
    appendLog({ type: 'phase', from: 'supervisor', to: 'supervisor', ...cost }, 'supervisor');
    return out('recorded supervisor cost');
  }
  const task = flagStr('task') ?? prev?.task;
  const changed = !prev || prev.to !== to || prev.task !== task || (cost.usd !== undefined && cost.usd !== prev.usd) || flags.note !== undefined;
  const stale = !prev || Date.now() - Date.parse(prev.created_at) > Math.min(15, loadSettings().stale_after_minutes / 3) * 60000;
  if (!changed && !stale) return out(`phase ${to} (unchanged)`);
  appendLog({ type: 'phase', from: prev?.to ?? null, to, task, note: flagStr('note')?.slice(0, 280), sha: git(['rev-parse', 'HEAD']) ?? undefined, ...cost }, id);
  out(`phase ${to}${task ? ` ${task}` : ''}`);
  // Waiting with nothing asked looks the same as waiting with a request answered: say so.
  if (['awaiting-word', 'blocked'].includes(to)) {
    const msgs = logObjects('message');
    const replied = new Set(msgs.map((m) => m.re).filter(Boolean));
    if (!msgs.some((m) => m.created_by === id && m.to === 'supervisor' && !replied.has(m.id) && !['info', 'ruling', 'answer'].includes(m.kind)))
      warn(`${to} with no open request to the supervisor: send one (--kind review-request for approve-spec, approve-plan or the stage word; merge-request at the end; blocked), since info expects no reply`);
  }
}

// gate <name> [--junit report.xml] -- <command…>: run a gate and record its time, result and tests.
function cmdGate() {
  if (flags.all) return gateAll();
  const name = positional[0];
  if (!name || !rest?.length) die('usage: gate <name> [--junit <report.xml>] -- <command> [args…]   |   gate --all');
  const started = Date.now();
  let ok = true;
  try {
    execFileSync(rest[0], rest.slice(1), { stdio: 'inherit' });
  } catch {
    ok = false;
  }
  const tests = readJunit(flagStr('junit'));
  appendLog({ type: 'gate', gate: name, ok, ms: Date.now() - started, sha: git(['rev-parse', 'HEAD']) ?? undefined, dirty: git(['status', '--porcelain']) ? true : undefined, tests_total: tests.length, tests: keepTests(tests) });
  process.stderr.write(`devteam: gate ${name} ${ok ? 'passed' : 'FAILED'} in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
  process.exit(ok ? 0 : 1);
}

// Run every gate in the settings here, as merge would, and print which pass. Run once at adoption
// on main: a gate that fails there goes on in ratchet mode or gets a chore ticket (quality.md §2).
function gateAll() {
  const gates = Object.entries(loadSettings().gates ?? {});
  if (!gates.length) die('no gates in settings');
  const rows = [];
  for (const [name, spec] of gates) {
    const cmd = typeof spec === 'string' ? spec : spec.cmd;
    const started = Date.now();
    let ok = true;
    try { execFileSync('sh', ['-c', cmd], { stdio: ['ignore', 'ignore', 'inherit'], env: gateEnv() }); } catch { ok = false; }
    const ms = Date.now() - started;
    appendLog({ type: 'gate', gate: name, ok, ms, sha: git(['rev-parse', 'HEAD']) ?? undefined, tests_total: 0, tests: [] });
    rows.push({ name, ok, ms, mode: spec.mode ?? 'enforced' });
    out(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(20)} ${(ms / 1000).toFixed(1)}s  ${spec.mode ?? 'enforced'}`);
  }
  const bad = rows.filter((r) => !r.ok && r.mode !== 'ratchet');
  if (bad.length) { out(`\n${bad.length} enforced gate(s) fail here: fix the toolchain, set "mode": "ratchet", or open a chore ticket for each`); process.exit(1); }
}

// For an agent's stop hook: exit 2 while the worker's last commit is newer than its last phase line.
function cmdStopOk() {
  const id = currentTicketId();
  if (!id) process.exit(0);
  const last = logObjects('phase').filter((p) => p.created_by === id).sort(byTime).pop();
  const commitAt = Date.parse(git(['log', '-1', '--format=%cI']) ?? '');
  if (last && !['done', 'parked'].includes(last.to) && commitAt > Date.parse(last.created_at) + 60000) {
    process.stderr.write(`devteam: your last commit is newer than your last phase line; run: devteam.mjs phase ${last.to} [--task …]\n`);
    process.exit(2);
  }
  process.exit(0);
}

// worker <ticket-id> [--resume] | planner <feature> [--resume]: a git worktree, a tmux window, the
// agent command from the settings, and the role's prompt (plus the knowledge that applies).
function makeSession(role) {
  supervisorOnly(role);
  const id = positional[0] ?? die(`usage: ${role} <${role === 'worker' ? 'ticket-id' : 'feature'}> [--resume]`);
  if (repoRoot !== mainRoot) die(`run this from the main checkout (${mainRoot})`);
  if (!sh('tmux', ['-V'])) die('tmux not found');
  const s = loadSettings();
  const resume = !!flags.resume;
  if (role === 'worker' && !tickets().has(id)) die(`no ticket ${id} (devteam.mjs ticket show ${id})`);
  const name = role === 'worker' ? id : `plan-${id}`;
  const branch = role === 'worker' ? `ticket/${id}` : `plan/${id}`;
  const wt = path.join(mainRoot, '.worktrees', name);
  fs.mkdirSync(path.join(runDir, 'prompts'), { recursive: true });
  if (!fs.existsSync(wt)) {
    git(['fetch', '--quiet', 'origin', s.main_branch]);
    const base = resolveCommit(`origin/${s.main_branch}`) ? `origin/${s.main_branch}` : s.main_branch;
    if (resolveCommit(`refs/heads/${branch}`)) gitOrDie(['worktree', 'add', '--quiet', wt, branch], mainRoot);
    else gitOrDie(['worktree', 'add', '--quiet', '-b', branch, wt, base], mainRoot);
  }
  seedWorktree(wt);
  const promptFile = path.join(runDir, 'prompts', `${name}.txt`);
  const block = knowledgeBlock(id);
  fs.writeFileSync(promptFile, `${PROMPTS[role].replace(/\{\{ID\}\}/g, id)}${block ? `\n\n${block}` : ''}\n`);
  // Workers live in detached tmux windows the owner can attach to; the supervisor is not one of them.
  let fresh = false;
  if (!tmux(['has-session', '-t', s.tmux_session])) { fresh = tmux(['new-session', '-d', '-s', s.tmux_session, '-n', name, '-c', wt]); if (!fresh) die('could not start tmux'); }
  const windows = (sh('tmux', ['list-windows', '-t', s.tmux_session, '-F', '#W']) ?? '').split('\n');
  if (!fresh && windows.includes(name)) { if (!resume) die(`window ${s.tmux_session}:${name} exists (use --resume to relaunch in it)`); }
  else if (!fresh) tmux(['new-window', '-d', '-t', s.tmux_session, '-n', name, '-c', wt]);
  const target = `${s.tmux_session}:${name}`;
  const env = `export DEVTEAM_RUN='${runDir}' DEVTEAM_ROLE='${role}' ${role === 'worker' ? `DEVTEAM_TICKET='${id}'` : `DEVTEAM_FEATURE='${id}'`}`;
  typeInto(target, env);
  // Worker and planner policy travels with the launch, not the repo's agent config (which may be
  // gitignored, and would bind the supervisor too): for Claude Code, a --settings file in run/.
  let cmd = resume ? s.resume_command : s.agent_command;
  if (/^claude(\s|$)/.test(cmd)) {
    const policy = path.join(runDir, 'agent', `${role}-claude.json`);
    fs.mkdirSync(path.dirname(policy), { recursive: true });
    fs.writeFileSync(policy, `${JSON.stringify({ permissions: { deny: s.worker_denied_commands.map((c) => `Bash(${c})`) }, hooks: { Stop: [{ hooks: [{ type: 'command', command: `node '${path.join(mainRoot, 'docs', 'devteam', 'scripts', 'devteam.mjs')}' stop-ok` }] }] } }, null, 2)}\n`);
    cmd = cmd.replace(/^claude/, `claude --settings '${policy}'`);
  }
  typeInto(target, `${cmd} "$(cat '${promptFile}')"`);
  if (role === 'worker' && !resume) appendLog({ type: 'phase', from: null, to: 'starting', note: `started in ${target}` }, id);
  appendLog({ type: 'act', class: 'worker-slots', what: `${resume ? 'resumed' : 'made'} ${role} ${name} in ${target}`, refs: role === 'worker' ? [id] : [], reversible: true }, 'supervisor');
  out(`${resume ? 'resumed' : 'made'} ${role} ${name} in ${target} at ${wt}`);
}

function cmdWhoami() {
  const id = currentTicketId();
  const s = loadSettings();
  out([`DEVTEAM_TICKET=${id ?? ''}`, `DEVTEAM_FEATURE=${process.env.DEVTEAM_FEATURE ?? ''}`, `DEVTEAM_ROLE=${process.env.DEVTEAM_ROLE ?? (id ? 'worker' : logWriter().startsWith('plan-') ? 'planner' : 'supervisor')}`, `DEVTEAM_RUN=${runDir}`, `DEVTEAM_SUPERVISOR=${supervisorTarget() ?? ''}`, `# writer=${logWriter()} repo=${repoRoot} main_checkout=${mainRoot} project=${projectDir} tmux_session=${s.tmux_session}`].join('\n'));
}
function cmdSettings() {
  const s = loadSettings();
  const key = flagStr('get');
  if (!key) return json(s);
  const v = s[key];
  out(v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
}

// history [<ticket-id>]: what happened around a ticket (or everything), to catch up after a restart.
function cmdHistory() {
  const id = positional[0];
  const scope = id ? new Set([id, ...(tickets().get(id)?.depends_on ?? [])]) : null;
  const tail = Number(flagStr('tail') ?? 100);
  const rows = [];
  for (const o of readLog().objects.values()) {
    const about = o.type === 'message' ? [o.created_by, o.to, o.ticket] : o.type === 'act' ? o.refs ?? [] : o.type === 'question' ? [o.ticket] : [o.created_by, o.subject];
    if (scope && !about.some((x) => scope.has(x))) continue;
    if (['phase', 'gate'].includes(o.type) && !scope) continue;
    const what = o.question ? `${o.question} → ${questionView(o).answer ?? '(open)'}` : o.what ?? o.text ?? o.detail ?? o.statement ?? o.title ?? (o.type === 'phase' ? `${o.from ?? '-'} -> ${o.to}` : o.type === 'gate' ? `${o.gate} ${o.ok ? 'ok' : 'FAIL'}` : '');
    rows.push({ at: o.created_at, line: `${o.created_at} ${o.type.padEnd(11)} ${o.created_by.padEnd(22)} ${String(what).slice(0, 140)}${o.type === 'act' && correctionOf(o) ? `  CORRECTED: ${correctionOf(o).reason}` : ''}` });
  }
  for (const r of rows.sort((a, b) => a.at.localeCompare(b.at)).slice(-tail)) out(r.line);
}

// Story-grouped release notes between two refs, from the fold.
function cmdNotes() {
  const [from, to = 'HEAD'] = positional;
  if (!from) die('usage: notes <from-tag> [<to-ref>]');
  const log = git(['log', `${from}..${to}`, '--format=%s']) ?? die(`cannot read git log ${from}..${to}`);
  const ts = tickets();
  const landed = new Set();
  for (const s of log.split('\n')) { const m = s.match(/from \S*ticket\/([a-z0-9-]+)$/) ?? s.match(/^([a-z][a-z0-9-]*-\d{2,}-[a-z0-9-]+):/); if (m && ts.has(m[1])) landed.add(m[1]); }
  const landedBy = (id) => landed.has(id) || (!!mergeShaFor(id) && git(['merge-base', '--is-ancestor', mergeShaFor(id), to]) !== null);
  const stories = new Map();
  for (const id of landed) for (const s of ts.get(id).serves ?? []) (stories.get(s) ?? stories.set(s, []).get(s)).push(id);
  const completed = [];
  const advanced = [];
  for (const [s, ids] of stories) {
    const all = [...ts.values()].filter((t) => isActive(t) && (t.serves ?? []).includes(s));
    (all.every((t) => landedBy(t.id)) ? completed : advanced).push({ s, ids, total: all.length, done: all.filter((t) => landedBy(t.id)).length });
  }
  const line = (x) => `- **${x.s}** (${x.done}/${x.total} tickets): ${x.ids.join(', ')}`;
  out(`## Stories completed\n\n${completed.map(line).join('\n') || '- none'}\n\n## Stories advanced\n\n${advanced.map(line).join('\n') || '- none'}`);
  const chores = [...landed].filter((id) => !(ts.get(id).serves ?? []).length);
  if (chores.length) out(`\n## Other\n\n${chores.map((id) => `- ${id}: ${ts.get(id).title}`).join('\n')}`);
}

// ===== 12. init, help, dispatch =====

const ARCHITECTURE_MD = `# Architecture

The whole system as planned now: the sum of every design so far. Written at bootstrap (from the code when adopting an existing codebase), then updated by every plan PR that changes something described here. Every design's research starts here. A feature's changes appear here when its plan lands; whether they have landed in code is computed from its tickets.

## 1. Components

| Component | Path | Stack | Owns | Talks to |
|---|---|---|---|---|

## 2. Contracts

| Contract | Provider | Consumers | Defined in | Versioned? |
|---|---|---|---|---|

## 3. Persistence

| Domain | Store | Tier (code-style.md §4) | Notes |
|---|---|---|---|

## 4. Dependencies and deployment

| Dependency or vendor | Used for | One-way door? |
|---|---|---|

## 5. Distance from the code rules

| Component | Laws met | Laws violated (how widely) | Gate mode |
|---|---|---|---|

## 6. Hotspots

| Path | Why it is hot |
|---|---|

## 7. Tests and CI

## 8. In flight at adoption

| PR / branch | Files | Decision |
|---|---|---|

## 9. Changed by

| Feature | Design | Date | What changed |
|---|---|---|---|
`;
const WORKFLOW_YML = `# devteam: an optional required check. The supervisor's \`merge\` runs the same checks; this makes GitHub refuse a merge that skipped it.
name: devteam
on:
  pull_request:
    types: [opened, synchronize, reopened, edited, ready_for_review]
permissions:
  contents: read
jobs:
  check-pr:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0, ref: \${{ github.event.pull_request.head.sha }} }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: git fetch --no-tags origin "+refs/heads/\${{ github.base_ref }}:refs/remotes/origin/\${{ github.base_ref }}"
      - env:
          HEAD_REF: \${{ github.head_ref }}
          HEAD_SHA: \${{ github.event.pull_request.head.sha }}
          PR_TITLE: \${{ github.event.pull_request.title }}
          PR_BODY: \${{ github.event.pull_request.body }}
        run: |
          printf '%s' "$PR_BODY" > "$RUNNER_TEMP/pr-body.md"
          node docs/devteam/scripts/devteam.mjs check-pr --head-ref "$HEAD_REF" --sha "$HEAD_SHA" --title "$PR_TITLE" --body-file "$RUNNER_TEMP/pr-body.md"
`;

// init [--name project] [--upstream-base vX.Y.Z] [--github]: the project folders,
// settings, .gitignore entries, the AGENTS.md pointer; optionally the GitHub check and agent config.
// The section init adds to the project's AGENTS.md: every agent reads this first, then its doc.
const AGENTS_SECTION = `## devteam

This repository runs on [devteam](https://github.com/sanctuarycomputer/devteam), materialized at \`docs/devteam/\` and owned here. Read the one doc for your role; do not read every doc up front.

| You are | Read |
|---|---|
| the **supervisor** (the owner's foreground agent session; plans, schedules, rules, merges; writes no production code) | \`docs/devteam/process/supervisor.md\` |
| a **worker** on one ticket, in its own worktree and tmux window, running superpowers | \`docs/devteam/process/worker.md\` |
| a **planner** turning a goal into a design, a roadmap and a graph of tickets | \`docs/devteam/process/planning.md\` |
| a **reviewer** (never the author; default verdict: not approved) | \`docs/devteam/governance/quality.md\` §3 |
| the **owner**, deciding what to delegate | \`docs/devteam/governance/constitution.md\` §2 |

The work, largest to smallest: **goal** (owner-approved outcome with a measure and a date) → **design** (\`project/designs/<goal>.md\`) → **feature** (stories, each with a target release) → **ticket** (one PR, one worker; a **wave** is the tickets that can run in parallel) → **task** (one step of a ticket's plan).

The record is the log (\`node docs/devteam/scripts/devteam.mjs log | history | questions | status\`; one append-only JSON Lines log, typed by \`docs/devteam/schema/log.schema.json\`) and the tracked files under \`docs/devteam/project/\`. Chat and scrollback are not the record. \`node docs/devteam/scripts/devteam.mjs help\` lists the commands.

Where rules conflict: the owner's explicit instruction, then enforcing configuration (lint, gates, branch protection), then \`project/settings.md\`, then \`governance/\`, then \`process/\`, then the framework's conventions and your judgment (\`constitution.md\` §6).
`;

function cmdInit() {
  const root = mainRoot;
  const made = [];
  const put = (p, text) => { if (!fs.existsSync(p)) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); made.push(path.relative(root, p)); } };
  const remoteHead = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])?.replace(/^origin\//, '') ?? git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const block = { project: flagStr('name') ?? path.basename(root), upstream_base: flagStr('upstream-base') ?? null, ...(remoteHead && remoteHead !== 'main' && remoteHead !== 'HEAD' ? { main_branch: remoteHead } : {}), components: {}, gates: {} };
  put(path.join(projectDir, 'settings.md'), `# Project settings\n\nOnly what this project changes; every setting has a default in scripts/devteam.mjs (\`devteam.mjs settings\` shows the result). Below the block, record project-specific answers to the decisions the governance docs leave open (components and stacks, persistence tiers, one-way doors, release tags, how to notify the owner), each with its date.\n\n\`\`\`json devteam\n${JSON.stringify(block, null, 2)}\n\`\`\`\n`);
  put(path.join(projectDir, 'designs', 'architecture.md'), ARCHITECTURE_MD);
  for (const d of ['log', 'retros', 'tickets', 'reviews']) put(path.join(projectDir, d, '.gitkeep'), '');
  const gi = path.join(root, '.gitignore');
  const giText = readText(gi) ?? '';
  const want = [`${path.relative(root, runDir).split(path.sep).join('/')}/`, '.worktrees/'];
  const add = want.filter((w) => !giText.split('\n').includes(w));
  if (add.length) { fs.writeFileSync(gi, `${giText}${giText && !giText.endsWith('\n') ? '\n' : ''}${add.join('\n')}\n`); made.push('.gitignore'); }
  const agents = path.join(root, 'AGENTS.md');
  if (!fs.existsSync(agents)) { fs.writeFileSync(agents, `# Agents\n\n${AGENTS_SECTION}`); made.push('AGENTS.md'); }
  else if (!readText(agents).includes('docs/devteam/process/supervisor.md')) { fs.appendFileSync(agents, `\n${AGENTS_SECTION}`); made.push('AGENTS.md'); }
  // Claude Code reads CLAUDE.md, not AGENTS.md: where a CLAUDE.md exists, it imports AGENTS.md.
  const claude = path.join(root, 'CLAUDE.md');
  if (fs.existsSync(claude) && !/@AGENTS\.md\b/.test(readText(claude))) { fs.appendFileSync(claude, `\n## devteam\n\n@AGENTS.md\n`); made.push('CLAUDE.md'); }
  if (flags.github) put(path.join(root, '.github', 'workflows', 'devteam.yml'), WORKFLOW_YML);
  out(made.length ? `created:\n${made.map((m) => `  ${m}`).join('\n')}` : 'nothing to create');
  out('next: fill settings (components, agent_command, gates, worktree_files), write designs/architecture.md from the code, then start the supervisor (the upstream README, Setup)');
}

const HELP = `devteam <command>   (positionals before flags; flags take the words after them)

Setup and roles
  init [--name n] [--upstream-base vX] [--github]   project folders, settings, .gitignore, the devteam section of AGENTS.md
  prompt supervisor | worker <id> | planner <feature>    the prompt a session starts with
  worker <ticket-id> [--resume] | planner <feature> [--resume]   supervisor: a worktree, a tmux window and an agent for a ticket or a feature plan
  whoami | settings [--get key]

The graph (planning.md)
  feature add|set|show <slug> --json '{…}' | --file f    a feature: goals, preconditions, stories with releases, design
  ticket add|set|show <id> --json '{…}' | --file f       a ticket: one PR of work
  validate [--strict]            graph rules D1-D11, reviews, goals, log health
  waves [--feature f] | ready [--plan-ahead] | status [--json] | roadmap [--json]

Checks and merging (quality.md)
  check-ticket <id> [--sha s] [--title t] [--body-file f] [--pr n]   definition of done at an exact head
  check-pr --head-ref r --sha s [--title t] [--body-file f]           what the forge's required check runs (optional; no gates, no approval acts)
  merge <ticket-id> | merge --plan <feature> | merge --chore <slug> [--approved qid] [--no-gates] [--dry-run]   supervisor: verify, run gates at the head, merge, log the act

Sessions (worker.md)
  phase <to> [--task t] [--note n] [--usd x --in n --out n]   phase change or liveness ping; phase supervisor --usd x
  gate <name> [--junit f] -- <cmd…>   run a gate and record it   |   gate --all: every settings gate here
  send <to> "<text>" [--kind k] [--re m-…] [--sha s] [--owner] | messages [--open] [--to x] [--json]
  stop-ok                         for a stop hook: refuses while the last commit is newer than the last phase line

Decide and act (supervisor.md, constitution.md)
  ask --question q [--kind k] [--class c] [--reasons r…] [--recommendation r] [--confidence 0-1] [--default d] [--choices '[{"label","detail","effect"}…]'] [--rule-scope s] [--links '[{"title","path","ref"}|{"title","url"}…]'] [--blocks ids] [--evidence ids] [--ticket id] [--re m-…] [--note path]
  answer <qid> "<text>" [--autonomy 1|2|3 [--scope s]] [--rule "<standing rule>"]   (owner)   |   answer <qid> "<text>" --from-chat --said "<owner's words>" | answer <qid> --defaulted   (supervisor)
  withdraw <qid> [--reason r] | questions [--all] [--id q] [--json]
  act --class c [--scope s] [--approved qid] [--refs ids] [--irreversible] -- "<what>"
  correct <act-id> --reason r [--severity n]   (owner; --retro for the supervisor) | repair <act-id> --how undo|fix-ticket|none
  trust [--json]                  the ladder: rung, ceiling, agreement, corrections per class

Observe and orient
  observe --subject s --kind k --detail d [--severity 0-4] [--valence -2..2] [--key k] [--refs ids] [--fix f] [--value n --unit u]
  observe-metrics | orient [--json] | metrics [--since date] [--json]
  ack <finding-kind> <subject> --reason r [--owner]   set a finding aside for finding_ack_hours
  timeline <ticket-id> [--json]   the ticket and every log line, review and file that bears on it
  knowledge [--status s] [--kind k] | knowledge --for <ticket|feature|class> | knowledge add|set …
  problem [--all] | problem add --title t --severity n [--risk] [--threatens g…] | problem set <id> …

Goals and retros
  goal [list|check|show|add|set|approve|status|reading] …
  retro [--due | --print | close <date> --summary s --refs ids]
  chore start <slug> | chore pr <slug> --title t    a supervisor-written file (design, retro, architecture) and its PR

The log
  log [--type t] [--by w] [--id x] [--tail n] [--json] | log-check | log-sync [--dry-run] | history [<ticket-id>]

Dashboard and releases
  dashboard [--port p] [--host h] | dashboard-data | notes <from-tag> [<to>]
`;

const COMMANDS = {
  init: cmdInit, prompt: cmdPrompt, worker: () => makeSession('worker'), planner: () => makeSession('planner'), whoami: cmdWhoami, settings: cmdSettings,
  feature: cmdFeature, ticket: cmdTicket, validate: cmdValidate, waves: cmdWaves, ready: cmdReady, status: cmdStatus, roadmap: cmdRoadmap,
  'check-ticket': cmdCheckTicket, 'check-pr': cmdCheckPr, merge: cmdMerge,
  phase: cmdPhase, gate: cmdGate, send: cmdSend, messages: cmdMessages, 'stop-ok': cmdStopOk,
  ask: cmdAsk, answer: cmdAnswer, withdraw: cmdWithdraw, questions: cmdQuestions, act: cmdAct, correct: cmdCorrect, repair: cmdRepair, trust: cmdTrust,
  observe: cmdObserve, 'observe-metrics': cmdObserveMetrics, orient: cmdOrient, metrics: cmdMetrics, ack: cmdAck, timeline: cmdTimeline, knowledge: cmdKnowledge, problem: cmdProblem,
  goal: cmdGoal, retro: cmdRetro, chore: cmdChore,
  log: cmdLog, 'log-check': cmdLogCheck, 'log-sync': cmdLogSync, history: cmdHistory,
  dashboard: cmdDashboard, 'dashboard-data': cmdDashboardData, notes: cmdNotes,
};
if (!command || command === 'help' || command === '--help') out(HELP);
else if (!COMMANDS[command]) die(`unknown command "${command}"\n${HELP}`);
else COMMANDS[command]();
