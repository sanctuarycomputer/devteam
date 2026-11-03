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

import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
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
// A list flag: separate values, or one JSON array of strings. A single value that starts with "["
// but is not one is refused rather than stored as one item.
const listFlag = (k) => {
  const v = flags[k];
  if (typeof v !== 'string' || !v.trim().startsWith('[')) return asList(v);
  let parsed;
  try { parsed = JSON.parse(v); } catch { parsed = null; }
  if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === 'string')) die(`--${k}: "${v}" looks like JSON but is not an array of strings; pass a JSON array of strings ('["a","b"]') or separate values ("a" "b")`);
  return parsed;
};
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

// A read-only command (dashboard-data, timeline) caches identical git reads for the rest of the
// process: one refresh asked git the same questions hundreds of times. Commands that write never
// turn this on, so they always read live.
let gitReadCache = null;
const GIT_READS = new Set(['rev-parse', 'show', 'ls-tree', 'tag', 'merge-base', 'cat-file', 'log', 'for-each-ref', 'symbolic-ref', 'diff', 'rev-list', 'status']);
function git(args, cwd) {
  const key = gitReadCache && GIT_READS.has(args[0]) ? `${cwd ?? ''}\0${args.join('\0')}` : null;
  if (key && gitReadCache.has(key)) return gitReadCache.get(key);
  let r;
  try {
    r = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).replace(/\n$/, '');
  } catch {
    r = null;
  }
  if (key) gitReadCache.set(key, r);
  return r;
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
  // Planners at once (plan/<feature> branches in flight); null is no cap. Every goal that needs
  // planning gets one unless its design waits on another goal's (goal set --plan-after). They don't
  // count against max_active_tickets.
  max_active_planners: null,
  stale_after_minutes: 30,
  // How long `ack` sets a finding aside; it comes back sooner if its subject changes.
  finding_ack_hours: 24,
  question_default_after_hours: 24,
  autonomy_ceilings: {},
  components: {},
  // How a tagged release reaches production: 'tag' (deploys from the tag) or { branch: 'production' }.
  release: 'tag',
  // Commands a stdin: secret sink may run (prefixes, e.g. "gh secret set"); they run as the owner.
  secret_commands: [],
  // The forge's checks merge doesn't wait for (names, e.g. a broken optional one); owner-only.
  ignored_checks: [],
  // Spend is measured from the agent harnesses' own session logs (built in: claude-code, codex);
  // usage_command adds any other harness (it prints usage records, see spend in the script); and
  // model_prices ($ per million tokens: input, output, cache_read, cache_write) prices models the
  // kit has no price for, or overrides one (a discount, a gateway). All three are the owner's.
  usage_sources: ['claude-code', 'codex'],
  usage_command: null,
  model_prices: {},
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
// and deny rules decide what workers may do; upstream_repo is what a standing sync approval trusts;
// release is how a tag reaches production.
const OWNER_SETTINGS = {
  gates: 'gate-change', worktree_setup: 'gate-change', worktree_files: 'gate-change',
  autonomy_ceilings: 'governance-edit', agent_command: 'governance-edit', resume_command: 'governance-edit', worker_denied_commands: 'governance-edit',
  forge: 'governance-edit', main_branch: 'governance-edit', merge_method: 'governance-edit', upstream_repo: 'governance-edit',
  release: 'governance-edit', secret_commands: 'governance-edit', ignored_checks: 'gate-change', usage_sources: 'governance-edit', usage_command: 'governance-edit', model_prices: 'governance-edit',
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
  const goalApprovals = new Set();
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
      const problem = !l.approved ? null : goalApprovals.has(l.approved) ? `${l.approved} already authorised a goal set` : goalChangeProblem(objects.get(l.approved), obj.id, l.approved, l);
      if (!l.approved || problem) {
        ignored.push({ line: l, why: l.approved ? `the supervisor edits a ${obj.status} goal only with an answered goal-change question: ${problem}` : 'the supervisor edits a goal only while it is a draft' });
        continue;
      }
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
    if (obj.type === 'goal' && changed.approved) goalApprovals.add(changed.approved);
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
// In a read-only command, full ref names resolve from one for-each-ref listing (a dashboard
// refresh asked git about each ticket branch separately: ~90 processes). Anything else, and every
// command that writes, asks git directly.
let refCommits = null;
function resolveCommit(ref) {
  if (gitReadCache && ref.startsWith('refs/')) {
    if (!refCommits || refCommits.cache !== gitReadCache) {
      const map = new Map();
      for (const line of (git(['for-each-ref', '--format=%(refname)%00%(objecttype)%00%(objectname)%00%(*objecttype)%00%(*objectname)']) ?? '').split('\n')) {
        const [name, type, sha, ptype, psha] = line.split('\0');
        if (name) map.set(name, type === 'commit' ? sha : ptype === 'commit' ? psha : undefined);
      }
      refCommits = { cache: gitReadCache, map };
    }
    if (!refCommits.map.has(ref)) return null;
    const sha = refCommits.map.get(ref);
    if (sha !== undefined) return sha;
  }
  return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
}

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
  let matched = ans ? !!q.recommendation && [norm(ans.answer), norm(ans.answer.split(' — ')[0])].includes(norm(q.recommendation)) : null;
  // A review's recommendation is its proposals: it agrees only when the owner kept every one of
  // them, decided every row, and the result still verifies. Only the owner's lines count here.
  let review = null;
  if (q.kind === 'review' && q.review) {
    const own = q.updates.filter((u) => writerClass(u.by) === 'owner');
    const result = own.filter((u) => u.result !== undefined).pop()?.result ?? null;
    const declined = own.some((u) => u.declined === true);
    const resultStatus = reviewStatus(q, ans ? result : null, ans ? declined : false);
    review = { review: q.review, result: ans ? result : null, declined: ans ? declined : false, allow_partial: !!q.review.allow_partial, result_status: resultStatus };
    if (ans) matched = !review.declined && resultStatus === 'verified' && (result?.proposed ?? 0) > 0 && result.kept === result.proposed && result.undecided === 0;
  }
  return {
    id: q.id, kind: q.kind, class: q.class ?? null, scope: q.scope ?? null, ticket: q.ticket ?? null, re: q.re ?? null, asked_at: q.created_at,
    question: q.question, context: q.context ?? '', options: q.options ?? [], choices: q.choices ?? [], links: q.links ?? [], goal: q.goal ?? null, change: q.change ?? null, rule_scope: q.rule_scope ?? null, recommendation: q.recommendation ?? '', confidence: q.confidence ?? null,
    default: q.default ?? null, deadline: q.deadline ?? null, blocks: q.blocks ?? [], evidence: q.evidence ?? [], note: q.note ?? null, why_asked: q.why_asked ?? null,
    secrets: (q.secrets ?? []).map((x) => ({ ...x, to: sinkWords(x.sink), sink_type: SINK_RE.exec(x.sink ?? '')?.[1] ?? null, warning: sinkWarning(x.sink) })), secrets_posted: q.updates.filter((u) => u.secrets_posted !== undefined && writerClass(u.by) === 'owner').pop()?.secrets_posted ?? [],
    status, answer, answered_by: answeredBy, answered_at: answeredAt, matched,
    autonomy: ans ? (q.autonomy ?? null) : null, standing_rule: ans ? (q.standing_rule ?? null) : null, channel: ans?.channel ?? null, said: ans?.said ?? null,
    review: review?.review ?? null, result: review?.result ?? null, declined: review ? review.declined : null, allow_partial: review ? review.allow_partial : null, result_status: review?.result_status ?? null,
  };
}
const questions = () => logObjects('question').map(questionView);

// Why question q does not authorise the supervisor to change goal goalId (null when it does): it
// is a goal-change question about that goal, answered by the owner with its recommendation (an
// answer other than the recommendation declines or alters the change, so the supervisor asks again).
// The goal fields a goal-change question may propose, and that its answer then authorises exactly.
const GOAL_CHANGE_FIELDS = ['title', 'outcome', 'measure', 'horizon', 'non_goals', 'preconditions', 'priority', 'milestones', 'plan_after'];
const goalFieldsOf = (l) => Object.fromEntries(Object.entries(l).filter(([k]) => GOAL_CHANGE_FIELDS.includes(k)));
function goalChangeProblem(q, goalId, qid, l = null) {
  const v = q?.type === 'question' ? questionView(q) : null;
  if (!v) return `${qid} is not a question`;
  if (v.class !== 'goal-change') return `${v.id} was asked in class ${v.class ?? '(none)'}, not goal-change`;
  if (v.goal !== goalId) return `${v.id} is about ${v.goal ?? 'no goal'}, not ${goalId} (ask with --goal ${goalId})`;
  // A question asked before the exact-change rule (ask has required --change on these since) is
  // an earlier answer: the supervisor carries it forward with the change it says the owner chose,
  // logged as a carry-answer act the owner can correct, rather than asking the same thing again.
  const legacy = !v.change || !Object.keys(v.change).length;
  if (legacy && !(l && l.carried)) return `${v.id} carries no change; carry the owner's earlier answer forward with goal set --approved ${v.id} --change '{…}'`;
  if (v.status !== 'answered') return `${v.id} is not answered by the owner (${v.status})`;
  if (!v.matched) return `${v.id} was answered "${v.answer}", not its recommendation${v.recommendation ? ` ("${v.recommendation}")` : ''}; ask again for the change the owner wants`;
  // the owner approved this change and no other: the set must be exactly it
  if (l && !legacy && canonical(goalFieldsOf(l)) !== canonical(v.change)) return `the set (${Object.keys(goalFieldsOf(l)).join(', ') || 'nothing'}) is not the change ${v.id} proposed`;
  return null;
}

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
    ...(spendByWho().get(id) ?? { usd: cost?.usd ?? 0, input_tokens: cost?.input_tokens ?? 0, output_tokens: cost?.output_tokens ?? 0 }),
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
const paneTails = new Map();
// Why a window has no agent to talk to: its pane exited, or it is back at a shell prompt (the
// agent quit). Null when it has one, or when tmux, the session or the window isn't there.
const paneGone = new Map();
const agentExited = (window) => paneGone.get(window) ?? null;
// An agent idle at its prompt while its own background shell still runs: after a compaction it can
// lose the shell's result and wait for nothing. Only read, never acted on: the supervisor nudges.
const PANE_SHELL = /\b\d+ (background )?shells? (still )?running\b|·\s*\d+ (background )?shells?\s*(·|$)/i;
// An agent whose last turn ended on an API or network error (a DNS or connection drop, an
// overloaded API): it stops and waits; a nudge resumes it. Harness-agnostic wording.
const PANE_API_ERROR = /\bAPI Error\b|Can't reach the API|\bENOTFOUND\b|\bECONNRESET\b|\bETIMEDOUT\b|overloaded_error|\bstream (error|disconnected)\b|\b(429|5\d\d) (Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable)\b/i;
const idleOnApiError = (window) => { const l = paneTails.get(window) ?? []; const last = l.slice(-8); return last.some((x) => PANE_API_ERROR.test(x)) && !l.some((x) => PANE_BUSY.test(x)); };
const idleWithShell = (window) => { const l = paneTails.get(window) ?? []; return l.some((x) => PANE_SHELL.test(x)) && !l.some((x) => PANE_BUSY.test(x)); };
function paneWaitingIn(window) {
  if (paneWaits.has(window)) return paneWaits.get(window);
  let found = null;
  const { target, problem } = resolvePane(`${loadSettings().tmux_session}:${window}`);
  paneGone.set(window, problem && /no agent is running|has exited/.test(problem) ? problem : null);
  const lines = target ? (sh('tmux', ['capture-pane', '-p', '-t', target]) ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(-15) : [];
  for (const [kind, re] of PANE_WAITS) {
    const hit = lines.find((l) => re.test(l));
    if (hit) { found = { kind, line: hit.slice(0, 200) }; break; }
  }
  // Only the supervisor acts on a pane (its own tick); the dashboard, status and the owner only look.
  if (target && !found && process.env.DEVTEAM_ROLE === 'supervisor') resendLostEnter(`${loadSettings().tmux_session}:${window}`, target, lines);
  paneWaits.set(window, found);
  paneTails.set(window, lines);
  return found;
}

// A lost Enter: text the kit typed still sits unsubmitted in an idle agent's input (an agent that
// compacts or redraws as the keys arrive can drop the Enter). typeInto records each delivery per
// window; when the pane's bottom lines still end with that text's tail, nothing on them says the
// agent is busy, no prompt is up (the caller checked) and the text is LOST_ENTER_SECONDS old, press
// Enter once and log it. The text is never retyped; the record is claimed (deleted) before the key,
// so a delivery gets at most one Enter however many passes or processes look.
const LOST_ENTER_SECONDS = 30;
const PANE_BUSY = /esc to (interrupt|cancel)|ctrl\+c to (interrupt|cancel)|press esc to stop/i;
const sentFile = (key) => path.join(runDir, 'sent', `${encodeURIComponent(key)}.json`);
// Agent-agnostic: no prompt glyphs. Whitespace (wrapping, padding) and box-drawing borders drop out.
const squash = (t) => t.replace(/[\s\u2500-\u257f]+/g, '');
function recordSent(target, text) {
  const key = sh('tmux', ['display-message', '-p', '-t', target, '#S:#W']);
  if (!key) return;
  try { writeJson(sentFile(key), { text, at: nowIso() }); } catch {}
}
function resendLostEnter(key, target, lines) {
  const file = sentFile(key);
  let rec;
  try { rec = readJson(file); } catch { return; }
  const age = (Date.now() - Date.parse(rec.at)) / 1000;
  const tail = squash(rec.text ?? '').slice(-40);
  if (!tail || !(age >= LOST_ENTER_SECONDS)) return;
  const bottom = lines.slice(-8);
  const claim = () => { try { fs.unlinkSync(file); return true; } catch { return false; } };
  if (!squash(bottom.join('')).includes(tail)) return void claim(); // submitted: nothing left to press
  if (bottom.some((l) => PANE_BUSY.test(l))) return;
  if (!claim() || !tmux(['send-keys', '-t', target, 'Enter'])) return;
  const hash = crypto.createHash('sha1').update(rec.text).digest('hex').slice(0, 12);
  appendLog({ type: 'observation', source: 'pane', kind: 'resent-enter', subject: key.slice(key.indexOf(':') + 1), detail: `pressed Enter once: text typed ${Math.round(age)}s ago was still unsubmitted in an idle pane ("${rec.text.slice(0, 60)}${rec.text.length > 60 ? '…' : ''}", sha1 ${hash})`, detector: 'pane', source_key: `resent-enter ${key} ${hash} ${rec.at}`, measure: { value: Math.round(age), unit: 's' } });
}
const paneWaiting = (id) => (activeWorker(id) ? paneWaitingIn(id) : null);

// Planners in flight: a plan/<feature> branch whose plan file hasn't landed on main. They write no phase lines, so their
// last sign of life is the newest of: a live log line (messages, observations), a commit on the
// branch, their plan file, an uncommitted edit in their worktree. Their pane says if they're stuck.
function planners() {
  const s = loadSettings();
  const main = mainRef();
  const lines = readLog().lines;
  const branches = (git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/plan/']) ?? '').split('\n').filter(Boolean);
  return branches.map((b) => {
    const feature = b.slice('plan/'.length);
    const by = `plan-${feature}`;
    // landed once its plan file is on main (a fresh planner's branch sits at main's tip, uncommitted)
    if (main && git(['cat-file', '-e', `${main}:${projectRel}/log/${by}.jsonl`]) !== null) return null;
    const wt = path.join(mainRoot, '.worktrees', by);
    const planFile = path.join(wt, projectRel, 'log', `${by}.jsonl`);
    const graph = readText(planFile) ?? git(['show', `${b}:${projectRel}/log/${by}.jsonl`]) ?? '';
    const fl = graph.split('\n').filter(Boolean).map((t) => { try { return JSON.parse(t); } catch { return null; } }).filter((o) => o?.type === 'feature');
    const feat = fl.reduce((a, o) => ({ ...a, ...o }), {});
    const stamps = [...lines.filter((l) => l.by === by).map((l) => l.at), git(['log', '-1', '--format=%cI', b])];
    for (const p of [planFile, ...(fs.existsSync(wt) ? (git(['status', '--porcelain'], wt) ?? '').split('\n').filter(Boolean).map((l) => path.join(wt, l.slice(3).replace(/^"|"$/g, ''))) : [])]) {
      try { stamps.push(fs.statSync(p).mtime.toISOString()); } catch {}
    }
    const last = stamps.filter(Boolean).map((x) => new Date(x).toISOString()).sort().pop() ?? null;
    const { target, problem } = resolvePane(`${s.tmux_session}:${by}`);
    const msgs = lines.filter((l) => l.type === 'message');
    const replied = new Set(msgs.map((m) => m.re).filter(Boolean));
    const asking = msgs.filter((m) => m.by === by && !['info', 'ruling', 'answer'].includes(m.kind) && !replied.has(m.id));
    // Before its feature line exists (while designing), a planner's goal is the one its questions
    // name: a question whose links point at this plan branch.
    const refQs = questions().filter((q) => (q.links ?? []).some((l) => l.ref === b || l.ref === `refs/heads/${b}`));
    const goals = [...new Set([...(feat.goals ?? []), ...refQs.map((q) => q.goal).filter(Boolean)])];
    return {
      feature, title: feat.title ?? feature, goals, tickets: graph.split('\n').filter((t) => t.includes('"type":"ticket"') && t.includes('"op":"new"')).length,
      branch: b, window: !!target, problem: target ? null : problem, waiting: target ? paneWaitingIn(by) : null,
      last_seen: last, minutes_silent: last ? Math.round((Date.now() - Date.parse(last)) / 60000) : null,
      waiting_on_supervisor: asking.map((m) => ({ id: m.id, kind: m.kind, text: m.text })),
      // a planner whose design waits on the owner's answers is waiting, not stale
      waiting_on_owner: [...new Set([...questions().filter((q) => q.status === 'open' && goals.includes(q.goal)), ...refQs.filter((q) => q.status === 'open')].map((q) => q.id))],
    };
  }).filter(Boolean);
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
  // On a plan branch, the feature's tickets number from its reserved block (a planner made before
  // blocks has none and is not checked).
  {
    const pf = onPlanBranch() ? (git(['rev-parse', '--abbrev-ref', 'HEAD']) ?? '').slice('plan/'.length) : null;
    const b = pf ? idBlockFor(pf) : null;
    if (b) for (const t of ts.values()) {
      if (t.created_by !== `plan-${pf}`) continue;
      const n = ticketNumber(t.id, t.component);
      if (n === null || n < b.from || n > b.to) warnings.push(`${t.id}: its number is outside the block reserved for ${pf} (${padNN(b.from)}-${padNN(b.to)}); another planner may take it`);
    }
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
        // A design being planned here opens with its TL;DR; landed designs are history.
        const dt = landed ? null : tldrGap(projectFileText(f.design.replace(/^project\//, '')));
        if (dt) sink.push(`feature ${fid}: design ${f.design} ${dt} (quality.md §6)`);
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
        else {
          // A feature's own design builds on its goal's design, the spine, and says so (planning.md §2).
          const spine = `designs/${slug(o.title ?? o.id)}.md`;
          const own = f.design?.replace(/^project\//, '');
          if (own && own !== spine && projectFileText(own) && !projectFileText(own).includes(spine)) errors.push(`feature ${fid}: its design ${f.design} does not cite its goal's design (${spine}); a feature design builds on the spine and links it`);
          // Planning rolls a milestone at a time: a feature only for later milestones is planning ahead.
          const cur = (o.milestones ?? []).length ? currentMilestone(o) : null;
          const mine = (f.preconditions ?? []).filter((p) => p.startsWith(`${g}#`)).map((p) => Number(p.split('#')[1]));
          const at = (n) => o.milestones.findIndex((m) => m.preconditions.includes(n)) + 1;
          if (cur && mine.length && mine.every((n) => at(n) > cur.n)) warnings.push(`feature ${fid} serves only milestone ${Math.min(...mine.map(at))} of ${g}, but milestone ${cur.n} is current; plan it once milestone ${cur.n} is met unless it is on the current milestone's critical path`);
        }
      }
    }
  }

  // D4: tickets that can run at the same time must have disjoint footprints. Merged ones are history.
  // Checking one ticket (its merge gate, or in its worktree), an overlap between two other tickets
  // is a warning: it comes from the live graph, not this branch, and the supervisor resolves it.
  const scope = process.env.DEVTEAM_GATE_TICKET || currentTicketId();
  if (!cycle) {
    const clos = closures(ts);
    const live = [...ts.values()].filter((t) => isActive(t) && !mergeShaFor(t.id));
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (clos.get(a.id)?.has(b.id) || clos.get(b.id)?.has(a.id)) continue;
      outer: for (const ga of a.touches ?? []) for (const gb of b.touches ?? []) if (globsOverlap(ga, gb)) { const m = `${a.id} and ${b.id} can run concurrently but both touch "${ga}" / "${gb}" (D4)`; if (scope && a.id !== scope && b.id !== scope) warnings.push(`${m}; not ${scope}'s to fix`); else errors.push(m); break outer; }
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
  // Checking one ticket, another ticket's own errors (D3 and the rest, written "<id>: …") come
  // from the live graph, not this branch: e.g. a dependency on a plan that reached main after the
  // branch did. They warn; the supervisor's own validate still fails on them.
  if (scope) for (let i = errors.length - 1; i >= 0; i--) {
    const owner = /^([a-z0-9-]+): /.exec(errors[i])?.[1];
    if (owner && owner !== scope && ts.has(owner)) warnings.push(`${errors.splice(i, 1)[0]}; not ${scope}'s to fix`);
  }

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
  // A plan review that relies on a goal-level one-way-door answer says so: "- Goal-level door: <qid> covers this plan".
  const doors = [...text.matchAll(/^-[ \t]*Goal-level door:[ \t]*(q-\S+)[ \t]+covers this plan\.?[ \t]*$/gm)].map((d) => d[1]);
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
    reviewer: reviewerRaw && !reviewerRaw.startsWith('<') ? reviewerRaw : null, findings, doors,
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

// A verdict at commit V holds at head H only if V is an ancestor of H, every non-merge commit V..H
// just ADDS review-record files under `dir`, and any merge between only brought main in: each merge's
// other parents are on main, and the branch's own change against main (three-dot, review records
// aside) is byte-identical at H to what was reviewed at V. A conflict fix that touched the work
// changes that diff, so it voids the verdict; a clean merge of main does not.
function verdictHolds(v, head, dir) {
  if (!head || !v || !/^[0-9a-f]{40}$/.test(v)) return false;
  if (v === head) return true;
  if (!dir || git(['merge-base', '--is-ancestor', v, head]) === null) return false;
  const main = mainRef();
  // the branch's own commits since V: what a merge brought in from main is main's, not the branch's
  const onlyRecords = (git(['log', '--no-merges', '--no-renames', '--format=', '--name-status', `${v}..${head}`, ...(main ? [`^${main}`] : [])]) ?? 'x').split('\n').filter(Boolean).every((l) => {
    const [st, file] = l.split('\t');
    return st === 'A' && file?.startsWith(dir) && /^(?:[a-z0-9-]+\/)?[a-z]+-\d+[a-z]?\.md$/.test(file.slice(dir.length));
  });
  if (!onlyRecords) return false;
  const merges = (git(['rev-list', '--merges', `${v}..${head}`]) ?? 'x').split('\n').filter(Boolean);
  if (!merges.length) return true;
  if (!main) return false;
  for (const m of merges) {
    const others = (git(['rev-list', '--parents', '-n', '1', m]) ?? '').split(' ').slice(2);
    if (!others.length || others.some((p) => git(['merge-base', '--is-ancestor', p, main]) === null)) return false;
  }
  const own = (x) => git(['diff', '--binary', `${main}...${x}`, '--', '.', `:(exclude)${dir.replace(/\/$/, '')}`]);
  const a = own(v), b = own(head);
  return a !== null && a === b;
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
// A gate run for a ticket's merge knows which ticket it checks (DEVTEAM_GATE_TICKET), so validate
// can fail it only for what is its own (D4 below).
const gateEnv = (ticket) => { const cache = path.join(runDir, 'cache'); fs.mkdirSync(cache, { recursive: true }); return { ...process.env, DEVTEAM_MAIN: mainRoot, DEVTEAM_CACHE: cache, ...(ticket ? { DEVTEAM_GATE_TICKET: ticket } : {}) }; };
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
// review-worktree <ticket> <sha> [--name <suffix>] | review-worktree --remove <path>: a final
// reviewer's checkout of exactly the commit it reviews, under .worktrees/ and seeded like a worker's
// (worktree_files, worktree_setup), so gates and the app run there. Local only, like chore start: it
// changes no branch and nothing anyone else reads, so it logs nothing.
const REVIEW_SUFFIX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
function cmdReviewWorktree() {
  if (!commonDir) die('review-worktree needs a git checkout');
  const root = path.join(mainRoot, '.worktrees');
  if (flags.remove !== undefined) {
    const target = flagStr('remove') ?? die('usage: review-worktree --remove <path>');
    const abs = path.resolve(target);
    const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
    const at = real(abs);
    const listed = (git(['worktree', 'list', '--porcelain'], mainRoot) ?? '').split('\n').filter((l) => l.startsWith('worktree ')).map((l) => real(l.slice(9)));
    if (!at || path.dirname(at) !== real(root) || !path.basename(at).startsWith('review-') || !listed.includes(at)) die(`${target} is not a review worktree under ${root} (review-worktree removes only what it made)`);
    gitOrDie(['worktree', 'remove', '--force', at], mainRoot);
    return out(`removed ${at}`);
  }
  const [id, ref] = positional;
  if (!id || !ref) die('usage: review-worktree <ticket-id> <sha> [--name <suffix>]   |   review-worktree --remove <path>');
  if (!tickets().has(id)) die(`no ticket ${id} (devteam.mjs ticket show ${id})`);
  const sha = resolveCommit(ref) ?? die(`${ref} is not a commit here (git fetch first?)`);
  const suffix = flagStr('name');
  if (flags.name !== undefined && !REVIEW_SUFFIX.test(suffix ?? '')) die(`--name "${suffix ?? ''}" must be lowercase words joined by hyphens`);
  // Short enough to name things after (a database identifier is 63 bytes in Postgres): the ticket's
  // component and number, not its slug, and 8 hex of the sha.
  const short = /^(.+?-\d+)(-|$)/.exec(id)?.[1] ?? id;
  const wt = path.join(root, `review-${short}-${sha.slice(0, 8)}${suffix ? `-${suffix}` : ''}`);
  if (fs.existsSync(wt)) die(`${wt} exists; give this reviewer its own --name, or remove it: devteam.mjs review-worktree --remove ${wt}`);
  gitOrDie(['worktree', 'add', '--quiet', '--detach', wt, sha], mainRoot);
  seedWorktree(wt);
  out(wt);
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
  // The release the PR adopts: the upstream_base it sets in settings.md (so a sync PR that folded in
  // a later release is checked against that one), else the tag in its slug. Either way the files
  // are compared with that tag fetched from upstream_repo as it is on main.
  const mb = mainRef() ? git(['merge-base', mainRef(), sha]) : null;
  const setBase = settingsAt(sha)?.upstream_base;
  const raw = setBase && setBase !== (mb ? settingsAt(mb)?.upstream_base : null) ? setBase : chore.slice('devteam-sync-'.length);
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
// A standing approval for CI fixes: an accepted owner rule scoped chore:ci-fix (or
// chore:devteam-workflow, as Stacks' owner first gave it) lets the supervisor merge a ci-fix-* chore
// without asking, when it changes only workflow files, deletes none, and keeps every job each had
// on main, so a "fix" can't drop a check. Its CI must still pass (merge waits for the forge's checks).
const CI_RULE_SCOPES = ['chore:ci-fix', 'chore:devteam-workflow'];
const workflowJobs = (text) => {
  const lines = String(text ?? '').split('\n');
  const i = lines.findIndex((l) => /^jobs:\s*(#.*)?$/.test(l));
  if (i < 0) return [];
  const jobs = [];
  let indent = null;
  for (const l of lines.slice(i + 1)) {
    if (/^\S/.test(l)) break;
    const m = /^(\s+)([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(l);
    if (!m) continue;
    indent ??= m[1].length;
    if (m[1].length === indent) jobs.push(m[2]);
  }
  return jobs;
};
function ciFixApproval(chore, sha, base, changed) {
  if (!/^(ci-fix|devteam-workflow)/.test(chore)) return {};
  const rule = logObjects('knowledge').filter((k) => k.created_by === 'owner' && CI_RULE_SCOPES.includes(k.scope) && k.status === 'accepted').sort(byTime).pop();
  if (!rule) return {};
  const off = changed.filter((f) => !/^\.github\/workflows\/[^/]+\.ya?ml$/.test(f));
  if (off.length) return { problem: `the owner's CI-fix rule covers only .github/workflows/*.yml; this also changes ${off.slice(0, 6).join(', ')}. The owner's answer is needed: merge --chore ${chore} --approved <qid>` };
  for (const f of changed) {
    const after = git(['show', `${sha}:${f}`]);
    if (after === null) return { problem: `the owner's CI-fix rule doesn't cover deleting ${f}` };
    const before = git(['show', `${base}:${f}`]);
    const lost = workflowJobs(before).filter((j) => !workflowJobs(after).includes(j));
    if (lost.length) return { problem: `the owner's CI-fix rule doesn't cover removing jobs (${f}: ${lost.join(', ')})` };
    if (/devteam\.mjs check-pr/.test(before ?? '') && !/devteam\.mjs check-pr/.test(after)) return { problem: `the owner's CI-fix rule doesn't cover removing devteam's own check (check-pr) from ${f}` };
  }
  return { rule, what: 'CI fix' };
}
function ownerAnswer(qid, what) {
  const q = logGet(qid);
  const v = q?.type === 'question' ? questionView(q) : null;
  if (!v || v.status !== 'answered') die(`${what}: ${qid} is not a question the owner answered`);
  reviewApproves(v, what);
  return v;
}
// A review approves something only through a result the owner gave that still verifies.
function reviewApproves(v, what) {
  if (v?.kind !== 'review') return;
  if (v.declined) die(`${what}: ${v.id} is a review the owner sent back; it approves nothing`);
  if (v.result_status !== 'verified') die(`${what}: ${v.id} is a review whose result is ${v.result_status}; it approves nothing until it verifies (review show ${v.id})`);
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
  const prJson = viaGit ? null : sh('gh', ['pr', 'view', branch, '--json', 'number,headRefOid,title,body,isDraft,mergeStateStatus,url,statusCheckRollup']);
  if (prJson === null && !dry && !viaGit) die(`no open PR from ${branch} (gh pr view failed; with no forge CLI set forge: "git")`);
  git(['fetch', '--quiet', 'origin', branch]);
  const pr = prJson !== null ? JSON.parse(prJson) : { headRefOid: resolveCommit(`origin/${branch}`) ?? resolveCommit(branch) ?? die(`no branch ${branch}`), title: flagStr('title'), body: flagStr('body-file') ? fs.readFileSync(flagStr('body-file'), 'utf8') : undefined };
  if (pr.isDraft) die(`${pr.url} is a draft`);
  const sha = pr.headRefOid;
  if (!resolveCommit(sha)) die(`cannot find ${sha} locally after fetching ${branch}`);
  const fails = checkPr({ headRef: branch, sha, title: pr.title, body: pr.body });
  // A plan's ticket ids are new: one already on main (another plan took the number) is refused
  // outright; renumber on the branch.
  if (plan) {
    const by = `plan-${plan}`;
    const onMain = tickets();
    const text = git(['show', `${sha}:${projectRel}/log/${by}.jsonl`]) ?? '';
    const dup = [...new Set(text.split('\n').filter(Boolean).map((t) => { try { return JSON.parse(t); } catch { return null; } }).filter((o) => o?.type === 'ticket' && o.op === 'new' && onMain.has(o.id) && onMain.get(o.id).created_by !== by).map((o) => o.id))];
    if (dup.length) fails.push(`ticket id${dup.length > 1 ? 's' : ''} already on main: ${dup.join(', ')}; renumber them on ${branch} (from its reserved block) and ask again`);
  }
  if (['BEHIND', 'DIRTY'].includes(pr.mergeStateStatus)) fails.push(`PR is ${pr.mergeStateStatus.toLowerCase()} relative to main; the author merges main and asks again`);
  // The forge's own checks at this head (CI, a deploy pipeline): pending is not passed and failing
  // fails, whether or not branch protection marks them required. The owner can name checks to
  // skip (settings ignored_checks, gate-change).
  {
    const ignored = new Set(loadSettings().ignored_checks ?? []);
    const pending = [], failing = [];
    for (const c of pr.statusCheckRollup ?? []) {
      const name = c.name ?? c.context ?? '?';
      if (ignored.has(name)) continue;
      const state = c.__typename === 'StatusContext' || c.state ? String(c.state ?? '').toUpperCase() : (c.status === 'COMPLETED' ? String(c.conclusion ?? '').toUpperCase() : 'PENDING');
      if (['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED', ''].includes(state)) pending.push(name);
      else if (!['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(state)) failing.push(`${name} (${state.toLowerCase()})`);
    }
    if (pending.length) fails.push(`the forge's checks are still running at ${sha.slice(0, 12)}: ${pending.join(', ')}; wait for them, then merge`);
    if (failing.length) fails.push(`the forge's checks failed at ${sha.slice(0, 12)}: ${failing.join(', ')}`);
  }
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
    if (kit.length && !approved && !standing && base) {
      const r = ciFixApproval(chore, sha, base, kit);
      if (r.rule) { standing = r; out(`changes only workflow files and keeps every job; approved by the owner's standing rule ${r.rule.id} ("${r.rule.statement}")`); } else if (r.problem) fails.push(r.problem);
    }
    if (kit.length && !approved && !standing) fails.push(`touches files outside project/ (${kit.slice(0, 6).join(', ')}${kit.length > 6 ? ', …' : ''}); the owner's answer is needed: merge --chore ${chore} --approved <qid>`);
  }
  if (approved) {
    const av = ownerAnswer(approved, 'merge --approved');
    // A secrets question approves landing only the stores it posted, and only once posted.
    if (av.secrets.length && (!chore?.startsWith('secret-') || !av.answer?.startsWith('Posted'))) fails.push(`${approved} asked for secrets; it approves only its own chore-secret PR, once the owner posted them (its answer: ${av.answer})`);
    // One answer approves one thing. The exception: one act of the answer's class that recorded the
    // decision for this very ticket or chore, which this merge now lands.
    const prior = logObjects('act').filter((a) => a.approved_by === approved);
    const landing = prior.length === 1 && prior[0].class === av.class && (prior[0].refs ?? []).includes(id ?? (chore ? `chore-${chore}` : plan));
    if (prior.length && !landing) fails.push(`${approved} already approved an act; ask again for this one`);
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
          execFileSync('sh', ['-c', cmd], { cwd: wt, stdio: 'inherit', env: gateEnv(!plan && !chore ? id : null) });
        } catch {
          ok = false;
        }
        const tests = typeof spec === 'object' && spec.junit ? readJunit(path.join(wt, spec.junit)) : [];
        const ms = Date.now() - started;
        // A ratchet gate that fails here and also fails at the merge base is pre-existing debt, not
        // this PR's: it passes with a warning (quality.md §2, modes), and its line says so, so the
        // gate's fail rate counts only failures that were the PR's.
        let preexisting = false;
        if (!ok && spec.mode === 'ratchet' && base) {
          const bwt = detachedWorktree(base, `base-${slug(branch)}`);
          let baseOk = true;
          try { execFileSync('sh', ['-c', cmd], { cwd: bwt, stdio: 'ignore', env: gateEnv(!plan && !chore ? id : null) }); } catch { baseOk = false; } finally { git(['worktree', 'remove', '--force', bwt], mainRoot); }
          preexisting = !baseOk;
        }
        appendLog({ type: 'gate', gate: name, ok, ms, sha, tests_total: tests.length, tests: keepTests(tests), preexisting: preexisting || undefined }, 'supervisor');
        if (preexisting) { warn(`gate ${name} fails at the merge base ${base.slice(0, 12)} too: pre-existing, allowed by ratchet mode`); continue; }
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
  const act = appendLog({ type: 'act', class: cls, what: `merged ${branch} at ${sha}${standing?.tag ? ` (upstream ${standing.tag}, verbatim)` : standing ? ` (${standing.what}, under the owner's standing rule)` : ''}`, refs: id ? [id] : plan ? [plan] : [], reversible: false, approved_by: approved ?? standing?.rule.id ?? undefined }, 'supervisor');
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
  const answered = questions().filter((q) => q.class === cls && q.status === 'answered' && (q.recommendation || (q.kind === 'review' && (q.review?.data?.proposals ?? 0) > 0)) && q.channel !== 'chat').sort((a, b) => a.answered_at.localeCompare(b.answered_at)).slice(-promo.agreement_window);
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
// --change '{…}': the exact goal fields a goal-change question proposes; required for one about a goal.
function goalChangeFlag(cls) {
  const c = jsonFlag('change');
  if (c === undefined) {
    if (cls === 'goal-change' && flagStr('goal')) die('a goal-change question about a goal says the exact change: --change \'{"milestones": […]}\' (its answer authorises that and nothing else)');
    return undefined;
  }
  if (cls !== 'goal-change' || !flagStr('goal')) die('--change belongs on a goal-change question with --goal');
  const bad = Object.keys(c).filter((k) => !GOAL_CHANGE_FIELDS.includes(k));
  if (!Object.keys(c).length || bad.length) die(`--change sets goal fields (${GOAL_CHANGE_FIELDS.join(', ')})${bad.length ? `; not ${bad.join(', ')}` : ''}`);
  return c;
}
function cmdAsk() {
  supervisorOnly('ask');
  const q = flagStr('question') ?? die('ask needs --question');
  const kind = flagStr('kind') ?? 'owner-decision';
  const cls = flagStr('class') ?? null;
  const L = ladder();
  if (kind === 'goal-approval') {
    const g = logGet(flagStr('goal') ?? '');
    if (g?.type !== 'goal') die('a goal-approval question needs --goal <g-id>');
    if ((g.status ?? 'draft') !== 'draft') die(`${g.id} is ${g.status}; only a draft goal is up for approval`);
    const c = goalCheck(g);
    if (c.definition.length) die(`${g.id} is not fully defined yet (ask a goal-definition question first):\n  - ${c.definition.join('\n  - ')}`);
    if (!(jsonFlag('links') ?? []).length) die('a goal-approval question links the design the owner is approving (--links)');
    if (questions().some((q) => q.kind === 'goal-approval' && q.goal === g.id && q.status === 'open')) die(`a goal-approval question for ${g.id} is already open; withdraw it first`);
    // The design's open decisions are the owner's to settle one by one, before the approval: an
    // approval is a yes to an approach whose decisions are already made, never a bundle of them.
    const unsettled = questions().filter((q) => q.kind !== 'goal-approval' && q.goal === g.id && q.status === 'open');
    if (unsettled.length) die(`${g.id} still has open questions about its design (${unsettled.map((q) => q.id).join(', ')}); ask the approval once they're answered (planning.md §1)`);
    if (c.approval.length) die(`${g.id}'s design has not given it milestones yet (planning.md §1):\n  - ${c.approval.join('\n  - ')}`);
    if (cls) die('a goal-approval question has no --class: approving a goal is never delegated');
  }
  if (kind === 'goal-definition' && cls) die('a goal-definition question has no --class: defining a goal is never delegated (reason goal-ambiguity)');
  // A review is answered with its result or sent back: never defaulted, never a secret, and its
  // choices and recommendation are the page and the data's proposals.
  let review;
  if (kind === 'review') {
    const why = { default: 'a review is never defaulted; the owner answers it or sends it back', secrets: 'a review never carries a secret; ask for secrets with --secrets on an owner-action question', choices: "a review's choices are its page", options: "a review's choices are its page", recommendation: "a review's recommendation is the proposals in its data" };
    for (const [k, w] of Object.entries(why)) if (flags[k] !== undefined) die(`ask --kind review takes no --${k}: ${w}`);
    review = pinReview();
  } else for (const k of ['page', 'ref', 'data', 'result-schema', 'allow-partial']) if (flags[k] !== undefined) die(`--${k} belongs on a review question (--kind review)`);
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
  const secrets = jsonFlag('secrets');
  if (secrets !== undefined) {
    if (kind !== 'owner-action') die('--secrets belongs on an owner-action question: the owner posts values, the supervisor never holds them');
    if (!Array.isArray(secrets) || !secrets.length || secrets.some((x) => !x || typeof x !== 'object' || Array.isArray(x))) die('--secrets is a JSON array of objects: [{"name":"STRIPE_TEST_KEY","sink":"rails-credentials:test:stripe.secret_key"}, …]');
    if (secrets.length > MAX_SECRETS) die(`at most ${MAX_SECRETS} secrets per question`);
    if (flags.default !== undefined) die('a question asking for secrets has no --default: only the owner can post them');
    const names = new Set();
    for (const x of secrets) {
      x.kind ??= 'string';
      if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(x.name ?? '')) die(`secret name "${x.name}" must be UPPER_SNAKE_CASE`);
      if (names.has(x.name)) die(`secret ${x.name} is listed twice`);
      names.add(x.name);
      if (!['string', 'file'].includes(x.kind)) die(`secret ${x.name}: kind is string or file`);
      const k = parseSink(x.sink);
      if (k.type === 'stdin' && !allowedCommand(k.argv)) die(`secret ${x.name}: \`${k.argv.join(' ')}\` is not in settings.secret_commands, the commands the owner lets a secret be piped to`);
    }
  }
  const line = appendLog({
    type: 'question', kind, class: cls ?? undefined, scope: scope ?? undefined, ticket: flagStr('ticket'), re: flagStr('re'), question: q, context: kind === 'goal-approval' ? [flagStr('context'), forecastText(logGet(flagStr('goal')), goalForecast(logGet(flagStr('goal'))))].filter(Boolean).join('\n\n') : flagStr('context'),
    rule_scope: flagStr('rule-scope'), goal: flagStr('goal'), change: goalChangeFlag(cls), options: asList(flags.options), choices: jsonFlag('choices'), links: jsonFlag('links'), recommendation: recommendation || undefined, confidence: flagNum('confidence'), default: def ?? undefined,
    deadline: def ? new Date(Date.now() + loadSettings().question_default_after_hours * 3600000).toISOString() : undefined,
    blocks, evidence, note: flagStr('note'), secrets, review,
    why_asked: { rung: onLadder ? rungFor(cls, scope) : undefined, ceiling: onLadder ? L.classes[cls].ceiling : undefined, reasons },
  }, 'supervisor');
  out(line.id);
}

// The owner answers (terminal or dashboard). The supervisor may only apply a default or withdraw.
function cmdAnswer() {
  const [id, ...restWords] = positional;
  const reviewResult = flagStr('review-result');
  const decline = !!flags.decline;
  if (flags['review-result'] === true) die('answer <qid> --review-result <file|->: the result file, or - for stdin');
  if (!id || (!restWords.length && !flags.defaulted && !reviewResult && !decline)) die('usage: answer <qid> "<answer>" [--autonomy 1|2|3 [--scope s]] [--rule "<standing rule>" [--rule-scope s]]   |   answer <qid> --review-result <file|->   |   answer <qid> "<why>" --decline   |   answer <qid> "<answer>" --from-chat --said "<owner\'s words>" [--autonomy n]   |   answer <qid> --defaulted   (supervisor)');
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
  if (v.kind === 'goal-approval') die(`${id} approves a goal on its design: the owner answers it with goal decide ${v.goal} approve|refine|let-go [--notes "…"] (or on the dashboard)`);
  // A review is answered by the owner's own process with its result, or sent back with a reason;
  // never in free text, never from chat (a chat can't carry rows, and the supervisor must not
  // compose the owner's answer to its own proposals).
  if (v.kind === 'review' || reviewResult || decline) {
    if (v.kind !== 'review') die(`--review-result and --decline answer a review question; ${id} is ${v.kind}`);
    if (fromChat) die(`answer --from-chat: ${id} is a review; the owner answers it from their own process (answer ${id} --review-result <file> in their terminal)`);
    if (v.status !== 'open') die(`${id} is already ${v.status}`);
    if (reviewResult && decline) die('a review is answered with --review-result or sent back with --decline, not both');
    if (!reviewResult && !decline) die(`${id} is a review: answer it with its result (answer ${id} --review-result <file|->) or send it back (answer ${id} "<why>" --decline)`);
    if (reviewResult && restWords.length) die('answer --review-result takes no text: the result is the answer');
    if (decline && !restWords.join(' ').trim()) die(`answer ${id} "<why>" --decline: say why it goes back`);
  }
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
  const reviewFields = reviewResult ? acceptReviewResult(v, reviewResult) : decline ? { answer: `Sent back: ${answer}`, declined: true } : {};
  appendLog({ type: 'question', op: 'set', id, answer, autonomy, standing_rule: flagStr('rule'), ...reviewFields, ...(fromChat ? { channel: 'chat', said: flagStr('said').trim() } : {}) }, by);
  if (v.kind === 'review') fs.rmSync(reviewDraftFile(id), { force: true });
  // A standing rule applies where the owner says (--rule-scope), else where the question says its
  // rule would apply (ask --rule-scope; the dashboard shows it next to the rule field), else the
  // whole project.
  if (flagStr('rule')) appendLog({ type: 'knowledge', kind: 'preference', statement: flagStr('rule'), scope: flagStr('rule-scope') ?? v.rule_scope ?? 'project', status: 'accepted', confidence: 1, evidence: [id] }, by);
  if (!fromChat) nudgeSupervisor(`[devteam answer ${id} from owner] read it with: devteam.mjs questions --id ${id}`);
  out(`${decline ? 'sent back' : 'answered'} ${id}${fromChat ? ' (from chat; listed on the dashboard for the owner to check)' : reviewFields.result ? `: ${reviewFields.answer} (result sha256 ${reviewFields.result.sha256.slice(0, 12)})` : ''}`);
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

// ===== review questions: an agent-drawn page the owner answers with a result =====
//
// When the owner must decide many rows (matches, mappings, links between two lists), the agent
// draws the page: a self-contained HTML document, with optional data (rows, options, proposals)
// and an optional JSON schema for the result, committed in the PR it is working on. `ask --kind
// review` pins all three to one commit and their sha256s. The owner's own process accepts a result
// only while those bytes still hash to the question line, validates it, recomputes what was kept,
// writes run/questions/<qid>/result.json and logs the answer with that file's sha256. `result` and
// `declined` are owner-only fields, so no agent line can supply them. The static checks here
// catch mistakes early; they are not what keeps a page off the network (a page is only ever shown
// in a sandboxed frame whose policy allows no network).

const REVIEW_MAX = 4 * 1024 * 1024;
const REVIEW_ROWS_MAX = 5000;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const REPO_PATH = new RegExp(SCHEMA.$defs.types.question.properties.links.items.properties.path.pattern);
const reviewDir = (qid) => {
  if (!/^[a-z0-9-]+$/.test(qid)) die(`${qid} is not a question id`);
  return path.join(runDir, 'questions', qid);
};
// The policy a review page is served under, as a header (a document can't remove a header; markup
// before a <meta> could). No network at all: the only loads are the kit's two helper files and
// committed images through /api/file, all from the dashboard itself, so even those never leave the
// machine. No CDN either: source matching ignores query strings, so any allowed outside origin
// would carry bytes out in a URL. `sandbox allow-scripts` makes the origin opaque even if the page
// is opened top-level, and frame-ancestors lets only the dashboard frame it.
const reviewPageCsp = (origin) => [
  "default-src 'none'", `script-src 'unsafe-inline' ${origin}/review/`, `style-src 'unsafe-inline' ${origin}/review/`, `img-src data: blob: ${origin}/api/file`,
  "connect-src 'none'", "font-src 'none'", "media-src 'none'", "object-src 'none'", "frame-src 'none'", "worker-src 'none'", "manifest-src 'none'",
  "form-action 'none'", "base-uri 'none'", `frame-ancestors ${origin}`, 'sandbox allow-scripts',
].join('; ');
const reviewResultFile = (qid) => path.join(reviewDir(qid), 'result.json');
const reviewDraftFile = (qid) => path.join(reviewDir(qid), 'draft.json');

// A blob's exact bytes at a commit (git() decodes and trims; a hash needs the bytes).
function gitBlob(commit, p) {
  try {
    return execFileSync('git', ['cat-file', 'blob', `${commit}:${p}`], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}
// A commit no branch or tag contains is lost at the next prune, with the page the owner answered on.
const reachMemo = new Map();
function commitReachable(commit) {
  if (!reachMemo.has(commit)) reachMemo.set(commit, !!git(['for-each-ref', '--count=1', '--format=%(refname)', '--contains', commit]));
  return reachMemo.get(commit);
}

// The JSON schema keywords schemaErrors checks; anything else in a result schema would be ignored
// silently, so review check refuses it.
const SCHEMA_CHECKED = ['type', 'enum', 'const', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'items', 'properties', 'required', 'additionalProperties'];
const SCHEMA_NOTES = ['description', 'title', '$schema', '$id', '$comment', 'examples', 'default'];
function schemaSubsetErrors(s, where) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return [`${where} is not a schema object`];
  const errs = [];
  for (const k of Object.keys(s)) if (!SCHEMA_CHECKED.includes(k) && !SCHEMA_NOTES.includes(k)) errs.push(`${where}.${k}: not a keyword the kit checks (${SCHEMA_CHECKED.join(', ')})`);
  for (const t of asList(s.type)) if (!['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(t)) errs.push(`${where}.type: "${t}" is not a JSON type`);
  if (s.pattern !== undefined) {
    if (typeof s.pattern !== 'string') errs.push(`${where}.pattern is a string`);
    else try { new RegExp(s.pattern); } catch (e) { errs.push(`${where}.pattern: ${e.message}`); }
  }
  for (const k of ['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems']) if (s[k] !== undefined && typeof s[k] !== 'number') errs.push(`${where}.${k} is a number`);
  if (s.enum !== undefined && !Array.isArray(s.enum)) errs.push(`${where}.enum is an array`);
  if (s.required !== undefined && !(Array.isArray(s.required) && s.required.every((x) => typeof x === 'string'))) errs.push(`${where}.required is an array of names`);
  if (s.additionalProperties !== undefined && typeof s.additionalProperties !== 'boolean') errs.push(`${where}.additionalProperties is true or false (a schema there is not checked)`);
  if (s.items !== undefined) errs.push(...schemaSubsetErrors(s.items, `${where}.items`));
  if (s.properties !== undefined) {
    if (!s.properties || typeof s.properties !== 'object' || Array.isArray(s.properties)) errs.push(`${where}.properties is an object of schemas`);
    else for (const [k, v] of Object.entries(s.properties)) errs.push(...schemaSubsetErrors(v, `${where}.properties.${k}`));
  }
  return errs;
}

// A review's data: an object; rows (if any) with unique string ids and object proposals; options
// (if any) as lists with unique ids. How rows relate to options is the page's business: a value
// may name any number of options and an option may sit on any number of rows.
function reviewDataCheck(data) {
  const errs = [];
  let rows = 0, proposals = 0;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { errs: ['is not a JSON object'], rows, proposals };
  if (data.rows !== undefined) {
    if (!Array.isArray(data.rows)) errs.push('rows is not an array');
    else {
      rows = data.rows.length;
      if (rows > REVIEW_ROWS_MAX) errs.push(`has ${rows} rows; at most ${REVIEW_ROWS_MAX}`);
      const seen = new Set();
      data.rows.forEach((r, i) => {
        if (!r || typeof r !== 'object' || Array.isArray(r)) return void errs.push(`rows[${i}] is not an object`);
        if (typeof r.id !== 'string' || !r.id) errs.push(`rows[${i}] has no string id`);
        else if (seen.has(r.id)) errs.push(`rows[${i}]: id "${r.id}" is repeated`);
        else seen.add(r.id);
        if (r.proposal === undefined) return;
        if (!r.proposal || typeof r.proposal !== 'object' || Array.isArray(r.proposal)) errs.push(`rows[${i}].proposal is an object of values, like a result row's values`);
        else proposals++;
      });
    }
  }
  if (data.options !== undefined) {
    if (!data.options || typeof data.options !== 'object' || Array.isArray(data.options)) errs.push('options is an object of option lists');
    else for (const [k, list] of Object.entries(data.options)) {
      if (!Array.isArray(list)) { errs.push(`options.${k} is not an array`); continue; }
      if (list.length > REVIEW_ROWS_MAX) errs.push(`options.${k} has ${list.length} options; at most ${REVIEW_ROWS_MAX}`);
      const seen = new Set();
      list.forEach((o, i) => {
        const oid = o && typeof o === 'object' ? o.id : o;
        if (typeof oid !== 'string' && typeof oid !== 'number') errs.push(`options.${k}[${i}] has no id`);
        else if (seen.has(oid)) errs.push(`options.${k}[${i}]: id "${oid}" is repeated`);
        else seen.add(oid);
      });
    }
  }
  return { errs, rows, proposals };
}

// Where a page may load from or point at: relative paths inside its own folder, data: and blob:
// URLs, and committed files through /api/file. Anything else would be refused by the dashboard's
// CSP anyway; this says so before the owner sees a broken page.
function reviewTargetOk(raw) {
  const v = raw.replace(/[\u0000- \u007f]/g, '');
  if (v === '' || v.startsWith('#') || /^(data|blob):/i.test(v)) return true;
  if (/^\/api\/file\?/.test(v)) return !v.includes('..');
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('/') || v.startsWith('\\')) return false;
  return !v.split(/[?#]/)[0].split(/[\\/]/).includes('..');
}
// The static checks on a review page and its files: { errors, warnings } as "file:line: text",
// plus the data's counts. `files` is { page: { name, buf }, data?, schema? }.
function reviewChecks(files) {
  const errors = [], warnings = [];
  let rows = 0, proposals = 0, schema = null, data = null;
  const big = (f) => f.buf.length > REVIEW_MAX && errors.push(`${f.name}: ${f.buf.length} bytes; at most ${REVIEW_MAX} (4 MB)`);
  const { page } = files;
  if (!big(page)) {
    const text = page.buf.toString('utf8');
    const nl = [];
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) nl.push(i);
    const lineOf = (at) => { let lo = 0, hi = nl.length; while (lo < hi) { const m = (lo + hi) >> 1; if (nl[m] < at) lo = m + 1; else hi = m; } return lo + 1; };
    const at = (i) => `${page.name}:${lineOf(i)}`;
    const each = (re, fn) => { for (const m of text.matchAll(re)) fn(m); };
    if (!/^﻿?\s*<!doctype\s+html\s*>/i.test(text)) errors.push(`${page.name}:1: not a complete HTML document (start it with <!doctype html>)`);
    const htmls = [...text.matchAll(/<html[\s>]/gi)];
    if (htmls.length !== 1) errors.push(`${htmls.length > 1 ? at(htmls[1].index) : `${page.name}:1`}: a page is one <html> document (found ${htmls.length})`);
    const target = (m, what, value) => { if (!reviewTargetOk(value)) errors.push(`${at(m.index)}: ${what} "${value.slice(0, 80)}" leaves the page; use a path beside the page, a data: or blob: URL, or /api/file?… for a committed file`); };
    each(/\s(src|href|action|formaction|poster|background|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi, (m) => target(m, m[1], m[2] ?? m[3] ?? m[4]));
    each(/\ssrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, (m) => { for (const part of (m[1] ?? m[2]).split(',')) target(m, 'srcset', part.trim().split(/\s+/)[0] ?? ''); });
    each(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi, (m) => target(m, 'url(', m[1] ?? m[2] ?? m[3]));
    each(/@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^\s;)]+))/gi, (m) => target(m, '@import', m[1] ?? m[2] ?? m[3]));
    each(/<\s*(form|iframe|frame|frameset|object|embed|base)\b/gi, (m) => errors.push(`${at(m.index)}: <${m[1].toLowerCase()}> is not allowed in a review page${m[1].toLowerCase() === 'form' ? ' (the answer goes through devteam.propose, and the owner submits it outside the page)' : ''}`));
    each(/<meta\b[^>]*http-equiv\s*=\s*["']?\s*(refresh|content-security-policy)/gi, (m) => errors.push(`${at(m.index)}: <meta http-equiv="${m[1]}"> is not allowed (the dashboard's header is the page's policy)`));
    const WARN = [
      [/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bsendBeacon\b/g, 'the page has no network; pass what it needs in data.json'],
      [/\b(localStorage|sessionStorage|indexedDB)\b/g, 'the page has no storage; devteam.draft saves progress'],
      [/\bdocument\.cookie\b/g, 'the page has no cookies'],
      [/\bwindow\.top\b|\bwindow\.parent\b|\bparent\.postMessage\b/g, 'talk to the dashboard only through devteam.*'],
    ];
    for (const [re, why] of WARN) each(re, (m) => warnings.push(`${at(m.index)}: ${m[0].trim()}: ${why}`));
    const secretish = (s) => /(?<![a-z])(key|secret|token|password|passwd|passphrase)s?(?![a-z])/i.test(s) || /[a-z](Key|Secret|Token|Password)(?![a-z])/.test(s);
    // one warning per line is enough to point at the field
    const secretWhy = 'looks like a field for a secret; ask for secrets with --secrets on an owner-action question, never in a page';
    const secretLines = new Set();
    const secretWarn = (i, what) => { const w = at(i); if (!secretLines.has(w)) { secretLines.add(w); warnings.push(`${w}: ${what} ${secretWhy}`); } };
    each(/\stype\s*=\s*["']?password\b/gi, (m) => secretWarn(m.index, 'a password field'));
    each(/\b(name|id|placeholder|aria-label|label|key|title)\s*[:=]\s*(["'`])([^"'`\n]{1,120})\2/gi, (m) => { if (secretish(m[3])) secretWarn(m.index, `${m[1]} "${m[3]}"`); });
    each(/<label\b[^>]*>([^<]{1,120})</gi, (m) => { if (secretish(m[1])) secretWarn(m.index, `label "${m[1].trim()}"`); });
  }
  const parse = (f) => { try { return JSON.parse(f.buf.toString('utf8')); } catch (e) { errors.push(`${f.name}: not valid JSON: ${e.message}`); return undefined; } };
  if (files.data && !big(files.data)) {
    data = parse(files.data);
    if (data !== undefined) {
      const c = reviewDataCheck(data);
      errors.push(...c.errs.map((e) => `${files.data.name}: ${e}`));
      ({ rows, proposals } = c);
    }
  }
  if (files.schema && !big(files.schema)) {
    schema = parse(files.schema);
    if (schema !== undefined) errors.push(...schemaSubsetErrors(schema, 'schema').map((e) => `${files.schema.name}: ${e}`));
  }
  return { errors, warnings, rows, proposals, data, schema };
}

// ask --kind review: read each file at the commit --ref names, check it, pin its bytes.
function pinReview() {
  const ref = flagStr('ref') ?? die('a review question pins its files to a commit: --ref <branch|sha>');
  if (!/^[A-Za-z0-9._/-]+$/.test(ref)) die(`--ref ${ref} is not a branch or commit name`);
  const commit = resolveCommit(ref) ?? die(`--ref ${ref} does not resolve to a commit`);
  if (!commitReachable(commit)) die(`${commit.slice(0, 12)} is on no branch or tag; commit the page on the branch whose PR carries it`);
  const read = (flag) => {
    const p = flagStr(flag);
    if (p === undefined) return null;
    if (!REPO_PATH.test(p)) die(`--${flag} ${p}: a path inside the repo, relative, without ".."`);
    if (git(['cat-file', '-t', `${commit}:${p}`]) !== 'blob') die(`--${flag} ${p} is not a file at ${ref} (${commit.slice(0, 12)}); commit it first`);
    const size = Number(git(['cat-file', '-s', `${commit}:${p}`]));
    if (size > REVIEW_MAX) die(`--${flag} ${p} is ${size} bytes; at most ${REVIEW_MAX} (4 MB)`);
    return { name: p, buf: gitBlob(commit, p) ?? die(`cannot read ${p} at ${commit.slice(0, 12)}`) };
  };
  if (flagStr('page') === undefined) die('a review question needs --page <repo path to its page.html>');
  const files = { page: read('page'), data: read('data'), schema: read('result-schema') };
  const c = reviewChecks(files);
  for (const w of c.warnings) warn(w);
  if (c.errors.length) die(`the review page does not pass its checks (devteam.mjs review check):\n  - ${c.errors.join('\n  - ')}`);
  const pin = (f) => (f ? { path: f.name, sha256: sha256(f.buf), bytes: f.buf.length } : undefined);
  const titleOf = typeof c.data?.title === 'string' ? c.data.title : files.page.buf.toString('utf8').match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  return {
    title: titleOf?.trim() ? titleOf.trim().slice(0, 200) : undefined, commit, ref,
    page: pin(files.page), data: files.data ? { ...pin(files.data), rows: c.rows, proposals: c.proposals } : undefined,
    result_schema: pin(files.schema), allow_partial: !!flags['allow-partial'],
  };
}

// Whether a review's pinned files still are what the owner was shown: each one's status
// (verified, tampered: the bytes at the commit don't hash to the line, missing: unreadable or on
// no branch or tag), and the worst of them.
const pinMemo = new Map();
function reviewPins(rv) {
  // readers skip the schema walk, so a hand-made line without a page or commit pins nothing
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(rv?.commit ?? '') || !rv.page?.path || !rv.page?.sha256) return { status: 'missing', reachable: false, files: [] };
  const reachable = commitReachable(rv.commit);
  const files = [['page', rv.page], ['data', rv.data], ['result_schema', rv.result_schema]].filter(([, f]) => f).map(([role, f]) => {
    const key = `${rv.commit}:${f.path}:${f.sha256}`;
    if (!pinMemo.has(key)) { const buf = gitBlob(rv.commit, f.path); pinMemo.set(key, buf === null ? 'missing' : sha256(buf) === f.sha256 ? 'verified' : 'tampered'); }
    return { role, path: f.path, sha256: f.sha256, bytes: f.bytes, status: reachable ? pinMemo.get(key) : 'missing' };
  });
  const status = files.some((f) => f.status === 'missing') ? 'missing' : files.some((f) => f.status === 'tampered') ? 'tampered' : 'verified';
  return { status, reachable, files };
}
// A review's status as the inbox shows it: declined, or the pinned files' status, and once
// answered the result file's too (missing, or tampered when it no longer hashes to the owner's line).
function reviewStatus(q, result, declined) {
  if (declined) return 'declined';
  const pins = reviewPins(q.review);
  if (pins.status !== 'verified' || !result) return pins.status;
  let buf;
  try { buf = fs.readFileSync(reviewResultFile(q.id)); } catch { return 'missing'; }
  return sha256(buf) === result.sha256 ? 'verified' : 'tampered';
}

function readJsonInput(src, what) {
  let buf;
  if (src === '-') {
    try { buf = fs.readFileSync(0); } catch (e) { die(`${what}: cannot read stdin: ${e.message}`); }
  } else {
    const st = fs.statSync(src, { throwIfNoEntry: false });
    if (!st?.isFile()) die(`${what}: no file ${src}`);
    if (st.size > REVIEW_MAX) die(`${what}: ${src} is ${st.size} bytes; at most ${REVIEW_MAX} (4 MB)`);
    buf = fs.readFileSync(src);
  }
  if (buf.length > REVIEW_MAX) die(`${what} is ${buf.length} bytes; at most ${REVIEW_MAX} (4 MB)`);
  try { return { value: JSON.parse(buf.toString('utf8')), buf }; } catch (e) { return die(`${what} is not valid JSON: ${e.message}`); }
}
const emptyValue = (x) => x === null || x === undefined || x === '' || (Array.isArray(x) ? !x.length : typeof x === 'object' && !Object.keys(x).length);
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

// The owner's process accepts a review result: the pinned files still hash to the question line,
// the result names them, satisfies the question's schema and, in the standard shape (data rows and
// result rows), answers only known rows, each once, leaving rows undecided only when the question
// allows it. kept and the counts are recomputed here, never taken from the page. Returns the
// fields of the owner's answer line, after writing run/questions/<qid>/result.json.
function acceptReviewResult(v, src) {
  const rv = v.review;
  const pins = reviewPins(rv);
  if (pins.status === 'missing') die(`${v.id}: the page's commit ${rv.commit.slice(0, 12)} (${rv.ref}) is gone or on no branch, so nothing can be answered on it; tell the supervisor to ask again`);
  if (pins.status === 'tampered') die(`${v.id}: ${pins.files.filter((f) => f.status === 'tampered').map((f) => f.path).join(', ')} no longer hash to the question; the page the owner saw is not the page on record. Ask again`);
  const { value: result } = readJsonInput(src, 'the review result');
  if (!isObj(result)) die('the review result is a JSON object');
  if (result.v !== 1) die('the review result says "v": 1');
  if (result.question !== v.id) die(`the review result is for ${result.question ?? 'no question'}, not ${v.id}`);
  if (result.review_sha256 !== rv.page.sha256) die(`the review result names page ${String(result.review_sha256 ?? 'none').slice(0, 12)}, not the page asked (${rv.page.sha256.slice(0, 12)})`);
  if (rv.data ? result.data_sha256 !== rv.data.sha256 : result.data_sha256 !== undefined) die(`the review result names data ${String(result.data_sha256 ?? 'none').slice(0, 12)}, not the data asked (${rv.data ? rv.data.sha256.slice(0, 12) : 'none'})`);
  if (rv.result_schema) {
    const schema = JSON.parse(gitBlob(rv.commit, rv.result_schema.path).toString('utf8'));
    const errs = schemaErrors(schema, result, 'result');
    if (errs.length) die(`the review result does not satisfy ${rv.result_schema.path}:\n  - ${errs.slice(0, 20).join('\n  - ')}${errs.length > 20 ? `\n  (+${errs.length - 20} more)` : ''}`);
  }
  const data = rv.data ? JSON.parse(gitBlob(rv.commit, rv.data.path).toString('utf8')) : null;
  const stored = { ...result };
  for (const k of ['answered_at', 'channel', 'summary']) delete stored[k];
  let summary = null;
  if (Array.isArray(data?.rows) && result.rows !== undefined) {
    if (!Array.isArray(result.rows)) die('result.rows is an array of { "id", "decided", "values" }');
    const byId = new Map(data.rows.map((r) => [r.id, r]));
    const seen = new Set();
    const c = { rows: data.rows.length, decided: 0, proposed: data.rows.filter((r) => isObj(r.proposal)).length, kept: 0, changed: 0, cleared: 0, undecided: 0 };
    const notPartial = `asked without --allow-partial, so every row is decided`;
    stored.rows = result.rows.map((r, i) => {
      if (!isObj(r)) die(`result.rows[${i}] is not an object`);
      if (!byId.has(r.id)) die(`result.rows[${i}]: "${r.id}" is not a row of ${rv.data.path}`);
      if (seen.has(r.id)) die(`result.rows[${i}]: "${r.id}" is answered twice`);
      seen.add(r.id);
      if (typeof r.decided !== 'boolean') die(`result.rows[${i}] (${r.id}): decided is true or false`);
      const { kept: _claimed, ...row } = r;
      if (!r.decided) {
        if (!rv.allow_partial) die(`result.rows[${i}] (${r.id}) is undecided; ${v.id} was ${notPartial}`);
        c.undecided++;
        return row;
      }
      if (r.values !== undefined && !isObj(r.values)) die(`result.rows[${i}] (${r.id}): values is an object`);
      const values = r.values ?? {};
      const proposal = byId.get(r.id).proposal;
      const kept = isObj(proposal) && canonical(values) === canonical(proposal);
      c.decided++;
      if (kept) c.kept++;
      else if (Object.values(values).every(emptyValue)) c.cleared++;
      else c.changed++;
      return { ...row, kept };
    });
    const left = data.rows.filter((r) => !seen.has(r.id));
    if (left.length && !rv.allow_partial) die(`${left.length} row(s) of ${rv.data.path} are not in the result (${left.slice(0, 5).map((r) => r.id).join(', ')}${left.length > 5 ? ', …' : ''}); ${v.id} was ${notPartial}`);
    c.undecided += left.length;
    summary = c;
    stored.summary = c;
  }
  stored.answered_at = nowIso();
  stored.channel = ownerChannel();
  const text = `${JSON.stringify(stored, null, 2)}\n`;
  const file = reviewResultFile(v.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
  const hash = sha256(Buffer.from(text));
  const bytes = Buffer.byteLength(text);
  const answer = summary
    ? `Reviewed ${summary.rows} row${summary.rows === 1 ? '' : 's'}: ${summary.kept} kept, ${summary.changed} changed, ${summary.cleared} set to none, ${summary.undecided} undecided`
    : `Answered: ${bytes} bytes, sha256 ${hash.slice(0, 12)}`;
  return { answer, result: { sha256: hash, bytes, ...(summary ?? {}) } };
}

function reviewQuestion(id) {
  const q = logGet(id ?? '');
  if (q?.type !== 'question' || q.kind !== 'review' || !q.review) die(`${id ?? '(no id)'} is not a review question`);
  return { q, v: questionView(q) };
}
// The owner's stored result, after its hashes verify; dies (exit 1) otherwise.
function verifiedResult(v) {
  if (v.declined) die(`${v.id} was sent back: ${v.answer}`);
  if (v.status !== 'answered' || !v.result) die(`${v.id} has no result (${v.status})`);
  if (v.result_status !== 'verified') die(`${v.id}: the result is ${v.result_status}${v.result_status === 'tampered' ? ` (${reviewResultFile(v.id)} no longer hashes to the owner's answer, sha256 ${v.result.sha256.slice(0, 12)})` : v.result_status === 'missing' ? ' (the result file or the pinned page is gone)' : ''}`);
  const text = fs.readFileSync(reviewResultFile(v.id), 'utf8');
  return { text, result: JSON.parse(text) };
}
const tsvCell = (x) => (x === undefined || x === null ? '' : Array.isArray(x) && x.every((y) => typeof y !== 'object') ? x.join(',') : typeof x === 'object' ? JSON.stringify(x) : String(x)).replace(/[\t\n\r]/g, ' ');

function cmdReview() {
  const [sub, id, file] = positional;
  if (sub === 'check') {
    if (!id) die('usage: review check <page.html> [--data d.json] [--result-schema s.json] [--json]');
    const local = (p) => {
      if (p === undefined) return null;
      const st = fs.statSync(p, { throwIfNoEntry: false });
      if (!st?.isFile()) die(`no file ${p}`);
      return { name: p, buf: fs.readFileSync(p) };
    };
    const c = reviewChecks({ page: local(id), data: local(flagStr('data')), schema: local(flagStr('result-schema')) });
    if (flags.json) { json({ ok: !c.errors.length, errors: c.errors, warnings: c.warnings, rows: c.rows, proposals: c.proposals }); if (c.errors.length) process.exit(1); return; }
    for (const w of c.warnings) out(`warning: ${w}`);
    for (const e of c.errors) out(`error: ${e}`);
    if (c.errors.length) process.exit(1);
    return out(`ok: ${id}${flagStr('data') ? `, ${flagStr('data')} (${c.rows} rows, ${c.proposals} with a proposal)` : ''}${flagStr('result-schema') ? `, ${flagStr('result-schema')}` : ''}${c.warnings.length ? ` (${c.warnings.length} warning${c.warnings.length > 1 ? 's' : ''})` : ''}`);
  }
  if (sub === 'show') {
    const { q, v } = reviewQuestion(id);
    const pins = reviewPins(q.review);
    const df = reviewDraftFile(v.id);
    const st = fs.statSync(df, { throwIfNoEntry: false });
    const draft = st ? { path: df, bytes: st.size, saved_at: st.mtime.toISOString() } : null;
    const shown = { id: v.id, status: v.status, result_status: v.result_status, review: v.review, files: pins.files, reachable: pins.reachable, result: v.result, declined: v.declined, answer: v.answer, result_file: v.result ? reviewResultFile(v.id) : null, draft };
    // --contents (what the dashboard's review view loads): the question's words, and the files
    // themselves, each only when it verifies: the data at the pinned commit, the owner's draft, and
    // the owner's stored result.
    if (flags.json && flags.contents) {
      const parsed = (buf) => { try { return buf === null ? null : JSON.parse(buf.toString('utf8')); } catch { return null; } };
      const dataPin = pins.files.find((f) => f.role === 'data');
      const draftDoc = draft ? parsed(Buffer.from(readText(df) ?? 'null')) : null;
      return json({
        ...shown, question: v.question, context: v.context, links: v.links, ticket: v.ticket, blocks: v.blocks, class: v.class, why_asked: v.why_asked,
        asked_at: v.asked_at, asked_by: q.created_by, answered_at: v.answered_at, channel: v.channel,
        data: dataPin?.status === 'verified' ? parsed(gitBlob(q.review.commit, dataPin.path)) : null,
        draft: draft && draftDoc ? { saved_at: typeof draftDoc.saved_at === 'string' ? draftDoc.saved_at : draft.saved_at, bytes: draft.bytes, state: draftDoc.state ?? null } : null,
        result_doc: v.result && v.result_status === 'verified' ? parsed(fs.readFileSync(reviewResultFile(v.id))) : null,
      });
    }
    if (flags.json) return json(shown);
    out(`${v.id}  [review, ${v.status}]  ${v.result_status}\n  ${v.question}`);
    out(`  pinned at ${String(q.review.commit).slice(0, 12)} (${q.review.ref})${pins.reachable ? '' : ', which no branch or tag contains any more'}`);
    for (const f of pins.files) out(`  ${f.role.padEnd(13)} ${f.path}  ${f.sha256.slice(0, 12)}  ${f.bytes} bytes  ${f.status}${f.role === 'data' ? `  (${q.review.data.rows} rows, ${q.review.data.proposals} with a proposal)` : ''}`);
    out(`  partial answers ${q.review.allow_partial ? 'allowed' : 'not allowed'}`);
    if (v.answer) out(`  answer: ${v.answer}`);
    if (v.result) out(`  result: ${reviewResultFile(v.id)}  sha256 ${v.result.sha256.slice(0, 12)}  ${v.result_status}`);
    if (draft) out(`  draft saved ${draft.saved_at} (${draft.bytes} bytes; a draft is not an answer)`);
    return;
  }
  if (sub === 'result') {
    const { v } = reviewQuestion(id);
    const { text, result } = verifiedResult(v);
    if (flags.json) return process.stdout.write(text);
    if (flags.tsv) {
      if (!Array.isArray(result.rows)) die(`${v.id}'s result is not in the rows shape; read it with --json`);
      const keys = [...new Set(result.rows.flatMap((r) => Object.keys(r.values ?? {})))];
      out(['id', 'decided', 'kept', ...keys, 'note'].join('\t'));
      for (const r of result.rows) out([r.id, r.decided, r.kept ?? '', ...keys.map((k) => r.values?.[k]), r.note].map(tsvCell).join('\t'));
      return;
    }
    out(`${v.id}: ${v.answer}`);
    out(`  ${reviewResultFile(v.id)}  sha256 ${v.result.sha256.slice(0, 12)}  verified`);
    for (const r of result.rows ?? []) out(`  ${r.id}  ${!r.decided ? 'undecided' : r.kept ? 'kept' : Object.values(r.values ?? {}).every(emptyValue) ? 'none' : 'changed'}  ${r.decided ? JSON.stringify(r.values ?? {}) : ''}${r.note ? `  note: ${r.note}` : ''}`);
    return;
  }
  if (sub === 'draft') {
    const { v } = reviewQuestion(id);
    const df = reviewDraftFile(v.id);
    if (file === undefined) {
      const t = readText(df);
      if (t === null) die(`no draft for ${v.id}`);
      warn('a draft is partial progress, never an answer');
      return process.stdout.write(t.endsWith('\n') ? t : `${t}\n`);
    }
    ownerWriter();
    if (v.status !== 'open') die(`${v.id} is ${v.status}; a draft is for an open review`);
    const { buf } = readJsonInput(file, 'the draft');
    fs.mkdirSync(path.dirname(df), { recursive: true });
    const tmp = `${df}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, df);
    return out(`saved a draft for ${v.id} (partial progress, not an answer)`);
  }
  if (sub === 'verify') {
    const { v } = reviewQuestion(id);
    const appliedFile = flagStr('applied') ?? die('usage: review verify <qid> --applied <file>   (rows as [{ "id", "values", "evidence" }, …])');
    const { result } = verifiedResult(v);
    if (!Array.isArray(result.rows)) die(`${v.id}'s result is not in the rows shape; there are no rows to verify`);
    const { value } = readJsonInput(appliedFile, 'the applied file');
    const applied = Array.isArray(value) ? value : value?.rows;
    if (!Array.isArray(applied) || !applied.every(isObj)) die('the applied file is an array of { "id", "values", "evidence" } (or { "rows": […] })');
    const fails = [];
    const byId = new Map();
    for (const a of applied) { if (byId.has(a.id)) fails.push(`${a.id}: applied twice`); byId.set(a.id, a); }
    const decided = result.rows.filter((r) => r.decided);
    for (const r of decided) {
      const a = byId.get(r.id);
      if (!a) fails.push(`${r.id}: decided ${JSON.stringify(r.values ?? {})}, not applied`);
      else if (canonical(a.values ?? {}) !== canonical(r.values ?? {})) fails.push(`${r.id}: decided ${JSON.stringify(r.values ?? {})}, applied ${JSON.stringify(a.values ?? {})}`);
    }
    const ok = new Set(decided.map((r) => r.id));
    for (const a of applied) if (!ok.has(a.id)) fails.push(`${a.id}: applied, but the owner did not decide it`);
    return report(fails, `${decided.length} row(s) applied as the owner decided them (${v.id}, result sha256 ${v.result.sha256.slice(0, 12)})`);
  }
  die('usage: review check <page.html> [--data d] [--result-schema s] | review show <qid> [--json] | review result <qid> [--json|--tsv] | review verify <qid> --applied <file> | review draft <qid> [<file|->]');
}

// ===== secrets: the owner posts a value straight to where it goes =====
//
// An owner-action question may declare secrets, each with a sink. The owner's own process (their
// terminal, or the dashboard's child, fed on stdin) pipes the value into the sink; it is never
// written to the log, to run/, or to argv, and the log records only that a name was posted and when.
// Sinks:
//   rails-credentials:<env|default>:<dotted.key>   bin/rails credentials:edit, in a chore worktree
//   sops:<repo file>:<dotted.key>                  sops set --value-stdin, in a chore worktree
//   file:<repo path>                               a gitignored file in the main checkout (a key file)
//   stdin:<command> <args…>                        a command the owner allowed (settings
//                                                  secret_commands) that reads the value on stdin
// Encrypted-store changes are committed to chore-secret-<n>; the supervisor lands them with
// merge --chore secret-<n> --approved <qid>. This guards against accidents (a value in the log, git,
// chat, a PR or an agent's context). It is not a sandbox: the Rails and SOPS sinks run the repo's
// own code and tools with the value, and a key on disk lets any local process decrypt the store.
const SINK_RE = /^(rails-credentials|sops|file|stdin):(.+)$/;
const insideDir = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`);
// The real path of p, resolving symlinks through the deepest part of it that exists.
function realish(p) {
  let cur = path.resolve(p);
  const tail = [];
  while (!fs.existsSync(cur)) { tail.unshift(path.basename(cur)); const up = path.dirname(cur); if (up === cur) break; cur = up; }
  return path.join(fs.realpathSync(cur), ...tail);
}
function parseSink(sink, { soft = false } = {}) {
  const fail = (msg) => { if (soft) throw new Error(msg); die(msg); };
  const m = SINK_RE.exec(sink ?? '');
  if (!m) fail(`sink "${sink}" is one of rails-credentials:<env>:<key.path>, sops:<file>:<key.path>, file:<gitignored path>, stdin:<command> <args…>`);
  const [, type, rest] = m;
  const keyPath = (k) => { if (!/^[A-Za-z0-9_][A-Za-z0-9_-]*(\.[A-Za-z0-9_][A-Za-z0-9_-]*)*$/.test(k ?? '')) fail(`sink "${sink}": the key path is dotted words (stripe.secret_key)`); return k.split('.'); };
  const repoPath = (p) => {
    if (!p || path.isAbsolute(p) || /\s/.test(p) || p.split(/[\\/]/).some((seg) => seg === '..' || seg.startsWith('-'))) fail(`sink "${sink}": a path inside the repo, relative, no .. and no segment starting with -`);
    const real = realish(path.join(mainRoot, p));
    if (!insideDir(real, realish(mainRoot))) fail(`sink "${sink}": resolves outside the repo`);
    if (insideDir(real, realish(runDir))) fail(`sink "${sink}": not under devteam's run/, which agents read`);
    return p;
  };
  if (type === 'rails-credentials') {
    const i = rest.indexOf(':');
    const env = i < 0 ? '' : rest.slice(0, i);
    if (!/^[a-z][a-z0-9_]*$/.test(env)) fail(`sink "${sink}": rails-credentials:<env|default>:<key.path>`);
    return { type, env, keys: keyPath(rest.slice(i + 1)), commits: true };
  }
  if (type === 'sops') {
    const i = rest.lastIndexOf(':');
    if (i < 0) fail(`sink "${sink}": sops:<file>:<key.path>`);
    return { type, file: repoPath(rest.slice(0, i)), keys: keyPath(rest.slice(i + 1)), commits: true };
  }
  if (type === 'file') return { type, file: repoPath(rest) };
  const argv = rest.trim().split(/\s+/);
  if (!argv[0]) fail(`sink "${sink}": stdin:<command> <args…> (arguments can't contain spaces)`);
  return { type, argv };
}
// A stdin sink runs as the owner, so it must start with a command the owner allowed in settings.
function allowedCommand(argv) {
  const line = argv.join(' ');
  return (loadSettings().secret_commands ?? []).some((p) => typeof p === 'string' && p.trim() && (line === p.trim() || line.startsWith(`${p.trim()} `)));
}
// Rails credentials that production decrypts (its own file, or the default one when there is no
// production file) should have their key only on the platform and in the owner's shell
// (code-style.md §10). A key in the checkout is readable by every agent on this machine, so the
// card says so before the owner posts a production secret behind it.
function sinkWarning(sink) {
  let k;
  try { k = parseSink(sink, { soft: true }); } catch { return null; }
  if (k.type !== 'rails-credentials') return null;
  const prodFile = fs.existsSync(path.join(mainRoot, 'config/credentials/production.yml.enc'));
  if (!(k.env === 'production' || (k.env === 'default' && !prodFile))) return null;
  const keyFile = k.env === 'default' ? 'config/master.key' : 'config/credentials/production.key';
  if (!fs.existsSync(path.join(mainRoot, keyFile))) return null;
  return `${keyFile} is on disk in this checkout, and production decrypts these credentials: any agent on this machine can read the key, so it can read this secret. Keep a production key only on the platform and in your shell (code-style.md §10)${k.env === 'default' ? ', e.g. move production secrets to config/credentials/production.yml.enc with its own key' : ''}.`;
}
function sinkWords(sink) {
  let k;
  try { k = parseSink(sink, { soft: true }); } catch { return `an unreadable sink (${sink})`; }
  return k.type === 'rails-credentials' ? `Rails credentials (${k.env}) → ${k.keys.join('.')}` : k.type === 'sops' ? `${k.file} (SOPS) → ${k.keys.join('.')}` : k.type === 'file' ? `the file ${k.file} (gitignored, this machine only)` : `this command, on its stdin: ${k.argv.join(' ')}`;
}
// Every form a value might take in a tool's output, longest first, so none survives in what we print.
function redactor(values) {
  const forms = [];
  for (const [name, buf] of values) {
    const raw = buf.toString('utf8');
    for (const f of [raw, raw.trim(), JSON.stringify(raw).slice(1, -1), buf.toString('base64'), encodeURIComponent(raw)]) if (f && f.length >= 4) forms.push([f, name]);
  }
  forms.sort((a, b) => b[0].length - a[0].length);
  return (text) => forms.reduce((t, [f, name]) => t.split(f).join(`[secret:${name}]`), String(text ?? ''));
}
// A private scratch folder (0700) for one post, removed whatever happens.
function withScratch(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-secret-'));
  fs.chmodSync(dir, 0o700);
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
// The editor credentials:edit runs: sets one key, keeps the rest (comments are not kept: YAML is
// re-dumped), and leaves a marker so a failure Rails ignores is not taken for success.
const RAILS_EDITOR = `require "yaml"
require "date"
path = ARGV.last
text = File.read(path)
data = if text.strip.empty? then {} elsif YAML.respond_to?(:unsafe_load) then YAML.unsafe_load(text) else YAML.load(text) end
data = {} unless data.is_a?(Hash)
keys = ENV.fetch("DEVTEAM_SECRET_KEYPATH").split(".")
value = File.binread(ENV.fetch("DEVTEAM_SECRET_FILE")).force_encoding("UTF-8")
value = value.chomp if ENV["DEVTEAM_SECRET_KIND"] == "string"
h = data
keys[0..-2].each { |k| h[k] = {} unless h[k].is_a?(Hash); h = h[k] }
h[keys.last] = value
File.write(path, YAML.dump(data))
File.write(ENV.fetch("DEVTEAM_SECRET_DONE"), "ok")
`;
const isUtf8 = (buf) => { try { new TextDecoder('utf-8', { fatal: true }).decode(buf); return true; } catch { return false; } };
const ownerProcessEnv = () => { const e = { ...process.env }; for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE']) delete e[k]; return e; };
// Returns { ok, out, files }: files are the tracked paths a commit sink changed.
function runSink(k, value, kind, cwd, redact) {
  const run = (cmd, args, opts) => {
    const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...opts });
    if (r.error) return { ok: false, out: redact(r.error.message) };
    return { ok: r.status === 0, out: redact(`${r.stdout ?? ''}${r.stderr ?? ''}`.trim()) };
  };
  const changed = (rel) => (git(['status', '--porcelain', '--', rel], cwd) ?? '').trim() !== '';
  if (k.type === 'stdin') {
    if (!allowedCommand(k.argv)) return { ok: false, out: `\`${k.argv.join(' ')}\` is not in settings.secret_commands` };
    return run(k.argv[0], k.argv.slice(1), { input: value, env: ownerProcessEnv() });
  }
  if (k.type === 'file') {
    if (git(['check-ignore', '-q', '--', k.file], cwd) === null) return { ok: false, out: `${k.file} is not gitignored; a file sink only writes ignored files` };
    const target = path.join(cwd, k.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!insideDir(fs.realpathSync(path.dirname(target)), fs.realpathSync(cwd))) return { ok: false, out: `${k.file} resolves outside the repo` };
    const tmp = path.join(path.dirname(target), `.${path.basename(target)}.devteam-${process.pid}`);
    try {
      fs.writeFileSync(tmp, value, { flag: 'wx', mode: 0o600 });
      fs.renameSync(tmp, target);
    } catch (e) { fs.rmSync(tmp, { force: true }); return { ok: false, out: e.message }; }
    return { ok: true, out: `wrote ${k.file}` };
  }
  if (kind === 'file' && !isUtf8(value)) return { ok: false, out: `${k.type} stores text; this file is binary (base64 it first, or use a file: sink)` };
  if (k.type === 'sops') {
    if (!fs.existsSync(path.join(cwd, k.file))) return { ok: false, out: `${k.file} does not exist on main; create it with sops first` };
    const text = value.toString('utf8');
    const r = run('sops', ['set', '--value-stdin', k.file, k.keys.map((x) => `[${JSON.stringify(x)}]`).join('')], { input: JSON.stringify(kind === 'string' ? text.replace(/\r?\n$/, '') : text), env: ownerProcessEnv() });
    if (r.ok && !changed(k.file)) return { ok: false, out: `sops exited 0 but ${k.file} did not change${r.out ? `: ${r.out}` : ''}` };
    if (!r.ok && /value-stdin/.test(r.out)) r.out += ' (this sops is too old for set --value-stdin; update it)';
    return { ...r, files: [k.file] };
  }
  // rails-credentials: credentials:edit with an editor that sets one key. Without the environment's
  // key Rails would generate a new key and new credentials, so refuse instead.
  const enc = k.env === 'default' ? 'config/credentials.yml.enc' : `config/credentials/${k.env}.yml.enc`;
  const keyFile = k.env === 'default' ? 'config/master.key' : `config/credentials/${k.env}.key`;
  if (!fs.existsSync(path.join(cwd, enc))) return { ok: false, out: `${enc} does not exist; create the ${k.env} credentials first` };
  if (!fs.existsSync(path.join(cwd, keyFile)) && !process.env.RAILS_MASTER_KEY) {
    if (!fs.existsSync(path.join(mainRoot, keyFile))) return { ok: false, out: `no ${keyFile} and no RAILS_MASTER_KEY in your environment: for production, set RAILS_MASTER_KEY in the shell that runs this rather than keeping the key on disk` };
    if (git(['check-ignore', '-q', '--', keyFile], cwd) === null) return { ok: false, out: `${keyFile} is not gitignored here; refusing to copy a key into a worktree that commits` };
    fs.copyFileSync(path.join(mainRoot, keyFile), path.join(cwd, keyFile));
  }
  return withScratch((dir) => {
    const vf = path.join(dir, 'value');
    const ed = path.join(dir, 'edit.rb');
    const done = path.join(dir, 'done');
    fs.writeFileSync(vf, value, { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(ed, RAILS_EDITOR, { flag: 'wx', mode: 0o600 });
    const args = ['credentials:edit', ...(k.env === 'default' ? [] : ['--environment', k.env])];
    const r = run(fs.existsSync(path.join(cwd, 'bin/rails')) ? 'bin/rails' : 'rails', args, { env: { ...ownerProcessEnv(), EDITOR: `ruby ${ed}`, VISUAL: `ruby ${ed}`, DEVTEAM_SECRET_FILE: vf, DEVTEAM_SECRET_KEYPATH: k.keys.join('.'), DEVTEAM_SECRET_KIND: kind, DEVTEAM_SECRET_DONE: done } });
    if (r.ok && !fs.existsSync(done)) return { ok: false, out: `the credentials editor did not finish, so nothing was set${r.out ? `: ${r.out}` : ''}` };
    if (r.ok && !changed(enc)) return { ok: false, out: `${enc} did not change` };
    return { ...r, files: [enc] };
  });
}
// Read one line from the terminal without echoing it: from /dev/tty, with the terminal's own state
// saved and restored whatever happens (Ctrl-C included, which arrives here as a byte).
function readHidden(prompt) {
  let fd;
  try { fd = fs.openSync('/dev/tty', 'r+'); } catch { die('secret post: no terminal to read from; pipe JSON with --json, or use the dashboard'); }
  const stty = (...a) => spawnSync('stty', a, { stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8' });
  const saved = stty('-g').stdout?.trim();
  const restore = () => { if (saved) stty(saved); else stty('echo', 'icanon', 'isig'); };
  process.once('exit', restore);
  fs.writeSync(fd, prompt);
  stty('-echo', '-icanon', '-isig', 'min', '1', 'time', '0');
  const bytes = [];
  try {
    const buf = Buffer.alloc(1);
    for (;;) {
      if (!fs.readSync(fd, buf, 0, 1, null)) break;
      const c = buf[0];
      if (c === 3) { restore(); fs.writeSync(fd, '\n'); die('cancelled'); }
      if (c === 4 || c === 10 || c === 13) break;
      if (c === 127 || c === 8) { bytes.pop(); continue; }
      bytes.push(c);
    }
    return Buffer.from(bytes);
  } finally {
    restore();
    fs.writeSync(fd, '\n');
    fs.closeSync(fd);
    bytes.fill(0);
  }
}
const MAX_SECRETS = 20;
function cmdSecret() {
  const [sub, id] = positional;
  if (sub === 'sinks') return out('rails-credentials:<env|default>:<key.path>   sops:<file>:<key.path>   file:<gitignored path>   stdin:<command> <args…> (allowed in settings.secret_commands)');
  if (sub !== 'post' || !id) die('usage: secret post <qid> [--file NAME=path …] [--json]   (owner: post a question\'s secrets; --json reads {"NAME": "value" | {"b64": "…"}} on stdin)');
  const { by } = ownerWriter();
  // Drain stdin first, so a writer feeding it never blocks on a process that refused early.
  let body = null;
  if (flags.json) {
    const raw = fs.readFileSync(0);
    try { body = JSON.parse(raw.toString('utf8')); } catch { body = undefined; }
    raw.fill(0);
    if (body === undefined || typeof body !== 'object' || !body) die('secret post --json: stdin is a JSON object');
  }
  const v = openQuestion(id);
  const declared = v.secrets ?? [];
  if (!declared.length) die(`${id} asks for no secrets`);
  const posted = [...(v.secrets_posted ?? [])];
  const todo = declared.filter((x) => !posted.some((p) => p.name === x.name));
  if (!todo.length) die(`${id}: every secret is already posted`);
  const values = new Map();
  if (body) {
    for (const x of todo) {
      const val = body[x.name];
      if (val === undefined || val === '') continue;
      values.set(x.name, typeof val === 'string' ? Buffer.from(val, 'utf8') : typeof val?.b64 === 'string' ? Buffer.from(val.b64, 'base64') : die(`${x.name}: a string or {"b64": "…"}`));
    }
    body = null;
  } else {
    for (const spec of asList(flags.file)) {
      const i = spec.indexOf('=');
      const name = spec.slice(0, i);
      if (i < 1 || !todo.some((x) => x.name === name)) die(`--file ${spec}: NAME=path, for a secret ${id} still needs`);
      values.set(name, fs.readFileSync(spec.slice(i + 1)));
    }
    for (const x of todo) if (!values.has(x.name)) {
      if (x.kind === 'file') { warn(`${x.name} is a file: pass --file ${x.name}=<path>`); continue; }
      const val = readHidden(`${x.name} goes to ${sinkWords(x.sink)}.\nPaste it (hidden; Enter to skip): `);
      if (val.length) values.set(x.name, val);
    }
  }
  if (!values.size) die('nothing to post');
  const redact = redactor(values);
  const sinks = todo.filter((x) => values.has(x.name)).map((x) => ({ ...x, k: parseSink(x.sink) }));
  // Encrypted stores change in one chore worktree per question, committed together; it starts clean.
  const slug = `secret-${id.split('-').slice(1, 3).join('-')}`;
  let wt = null;
  if (sinks.some((x) => x.k.commits)) {
    wt = choreWorktree(slug, { setup: true });
    git(['checkout', '--quiet', '--', '.'], wt);
    git(['clean', '-fdq'], wt);
  }
  const failures = [];
  const done = [];
  const files = new Set();
  try {
    for (const x of sinks) {
      const r = runSink(x.k, values.get(x.name), x.kind, x.k.commits ? wt : mainRoot, redact);
      if (r.ok) { done.push({ name: x.name, at: nowIso() }); for (const f of r.files ?? []) files.add(f); }
      else failures.push(`${x.name} → ${sinkWords(x.sink)}: ${r.out || 'failed'}`);
    }
  } finally {
    for (const buf of values.values()) buf.fill(0);
  }
  let landing = '';
  if (wt && files.size) {
    // Exactly the stores the sinks changed; anything else the run left behind is discarded.
    gitOrDie(['add', '--', ...files], wt);
    gitOrDie(['commit', '--quiet', '-m', `chore-${slug}: post secrets for ${id}\n\nEncrypted values posted by the owner; never in the log.`], wt);
    git(['checkout', '--quiet', '--', '.'], wt);
    git(['clean', '-fdq'], wt);
    landing = ` Land it: chore pr ${slug} --title "post secrets for ${id}", then merge --chore ${slug} --approved ${id}.`;
  }
  if (done.length) {
    const all = [...posted, ...done];
    const complete = declared.every((x) => all.some((p) => p.name === x.name));
    appendLog({ type: 'question', op: 'set', id, secrets_posted: all, ...(complete ? { answer: `Posted ${all.length} secret${all.length > 1 ? 's' : ''}` } : {}) }, by);
    nudgeSupervisor(`[devteam secrets ${complete ? 'posted' : 'partly posted'} for ${id} from owner] ${done.map((d) => d.name).join(', ')}.${landing}`);
    out(`posted ${done.map((d) => d.name).join(', ')}${complete ? `; ${id} is answered` : ''}${landing}`);
  }
  if (failures.length) die(`not posted:\n  - ${failures.join('\n  - ')}`);
}
function rankQuestions(qs) {
  const sub = activeTickets();
  const crit = findCycle(sub) ? new Set() : new Set(criticalPath(sub).path);
  const score = (q) => (['one-way-door', 'owner-decision', 'goal-approval', 'owner-action'].includes(q.kind) ? 1000 : 0) + q.blocks.reduce((s, id) => s + (crit.has(id) ? 3 : 1), 0) * 10;
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
    if (q.review) out(`  review: ${q.review.page?.path} at ${String(q.review.commit).slice(0, 12)} (${q.review.ref})${q.review.data ? `, ${q.review.data.rows} rows` : ''}; ${q.result_status} (devteam.mjs review show ${q.id})`);
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
    reviewApproves(approval, 'act --approved');
  }
  // approve-plan may cite the owner's answer to a one-way door asked at goal level (constitution.md §4);
  // it is checked below, against the ticket's goals and its plan review, not as an approve-plan answer.
  const doorCited = cls === 'approve-plan' && approval?.kind === 'one-way-door';
  if (approval && !doorCited) {
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
    const doors = t.one_way_doors ?? [];
    let goalDoor = null;
    if (doorCited) {
      if (!doors.length) die(`${t.id} lists no one-way doors; ${approved} has nothing to cover`);
      if (approval.status !== 'answered') die(`${approved} was not answered by the owner; a one-way door needs the owner's answer, never a default`);
      if (approval.ticket !== t.id) {
        const goals = features().get(t.feature)?.goals ?? [];
        if (!approval.goal) die(`${approved} is a one-way-door question for neither ${t.id} nor a goal`);
        if (!goals.includes(approval.goal)) die(`${approved} answered a one-way door for goal ${approval.goal}, but ${t.id}'s feature ${t.feature} serves ${goals.join(', ') || 'no goal'}; an answer for another goal never covers this plan`);
        goalDoor = approved;
      }
    } else if (doors.length && !questions().some((q) => q.kind === 'one-way-door' && q.ticket === t.id && q.status === 'answered')) die(`${t.id} lists one-way doors; the owner answers a one-way-door question (--ticket ${t.id}) before its plan is approved, or you cite the owner's answer to the goal's one-way-door question (--approved <qid>) and the plan review says it covers the plan (constitution.md §4)`);
    // The plan opens with its TL;DR, so a low-risk plan can be approved from it (quality.md §6).
    const ref = [`ticket/${t.id}`, `origin/ticket/${t.id}`].find((r) => resolveCommit(r));
    const plan = ref ? git(['show', `${ref}:${projectRel}/tickets/${t.id}/plan.md`]) : null;
    if (plan === null) die(`no plan.md for ${t.id} on ticket/${t.id}; approve a plan once it is committed`);
    const tldr = tldrGap(plan);
    if (tldr) die(`${t.id}'s plan ${tldr}; send it back to the worker (quality.md §6)`);
    // A goal-level answer covers the plan only when its reviewer says the plan stays inside it.
    if (goalDoor) {
      const latest = latestPerTrack(ticketReviews(t.id, { ref }), 'plan').filter((r) => r.verdict === 'APPROVE');
      if (!latest.some((r) => r.doors.includes(goalDoor))) die(`${goalDoor} is a goal-level answer; the latest approving plan review (reviews/plan-<n>.md on ticket/${t.id}) must say "- Goal-level door: ${goalDoor} covers this plan" (quality.md §3)`);
    }
  }
  const line = appendLog({ type: 'act', class: cls, scope: scope ?? undefined, what, rung, refs: asList(flags.refs), reversible: !flags.irreversible, approved_by: approved ?? undefined }, 'supervisor');
  out(line.id);
}
// A plan or design opens with '## TL;DR' and a few bullets: the approach, skimmable (quality.md §6).
// Returns what is wrong, or null.
function tldrGap(text) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^##\s+TL;?DR\b/i.test(l.trim()));
  if (at < 0) return 'has no "## TL;DR" section';
  if (lines.slice(0, at).some((l) => /^##\s/.test(l.trim()))) return 'has its TL;DR after another section; it comes first, under the title';
  const body = [];
  for (const l of lines.slice(at + 1)) { if (/^#{1,2}\s/.test(l.trim())) break; body.push(l); }
  const bullets = body.filter((l) => /^\s{0,3}[-*+]\s+\S/.test(l)).length;
  if (!bullets) return 'has a TL;DR with no bullets';
  if (bullets > 7) return `has a TL;DR of ${bullets} bullets; seven at most, the rest belongs in the plan`;
  return null;
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
  const s = observeSpend();
  out(`recorded ${s} spend line(s) and ${observeFindings(collectMetrics(0))} new observation(s)`);
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
  // A horizon is the owner's real deadline, when there is one; never required, never guessed. The
  // forecast says when, from the measured rate (planning.md §1).
  if (g.horizon && Number.isNaN(Date.parse(g.horizon))) definition.push(`horizon "${g.horizon}" is not a date`);
  if (!(g.non_goals ?? []).length) definition.push('no non-goals');
  if (!(g.preconditions ?? []).length) definition.push('no preconditions: what must be true for the outcome');
  if (typeof g.priority !== 'number') definition.push('no priority');
  const clash = logObjects('goal').filter((o) => o.id !== g.id && ['ready', 'draft'].includes(o.status ?? 'draft') && typeof g.priority === 'number' && o.priority === g.priority);
  if (clash.length) definition.push(`priority ${g.priority} is shared with ${clash.map((c) => c.id).join(', ')}`);
  if (!goalReadings(g.id).length) definition.push('no baseline reading (devteam.mjs goal reading <id> --value v)');
  const approval = milestoneGaps(g);
  const feats = goalFeatures(g.id);
  const covered = new Set(feats.flatMap((f) => features().get(f).preconditions ?? []));
  const unplanned = (g.preconditions ?? []).map((text, i) => ({ n: i + 1, text })).filter((p) => !covered.has(`${g.id}#${p.n}`));
  // Planning rolls a milestone at a time: only the current milestone's preconditions need features;
  // a later milestone's wait for it (planning.md §1).
  const cur = approval.length ? null : currentMilestone(g);
  const later = cur ? new Set(g.milestones.slice(cur.n).flatMap((m) => m.preconditions)) : new Set();
  const designSlug = slug(g.title ?? g.id);
  if ((g.status ?? 'draft') === 'ready') {
    if (!projectFileText(`designs/${designSlug}.md`)) coverage.push(`no design at project/designs/${designSlug}.md`);
    if (!feats.length) coverage.push('no feature names this goal');
    for (const p of unplanned.filter((x) => !later.has(x.n))) coverage.push(`precondition ${p.n} ("${p.text}") has no feature (${g.id}#${p.n})${cur ? `; it is in milestone ${cur.n}, the current one` : ''}`);
  }
  return { definition, approval, coverage, features: feats, unplanned, later: [...later].sort((a, b) => a - b), current_milestone: cur?.n ?? null, design: `project/designs/${designSlug}.md` };
}

// What the design must give the goal before the owner approves it: its milestones (planning.md §1).
function milestoneGaps(g) {
  const ms = g.milestones ?? [];
  const pre = g.preconditions ?? [];
  if (!ms.length) return ['no milestones: the outcome in order, each a usable slice with a target on the measure, its preconditions and a size in tickets (goal set --milestones; one is fine for a goal one loop can meet)'];
  const gaps = [];
  const seen = new Map();
  const base = goalReadings(g.id)[0]?.measure.value;
  const up = g.measure?.direction !== 'down';
  let prevT = base;
  let prevBy = null;
  ms.forEach((m, i) => {
    const n = i + 1;
    if (!m.title) gaps.push(`milestone ${n} has no title`);
    if (typeof m.target !== 'number') gaps.push(`milestone ${n} has no numeric target`);
    else if (typeof prevT === 'number' && (up ? m.target <= prevT : m.target >= prevT)) gaps.push(`milestone ${n}'s target ${m.target} does not move the measure ${up ? 'up' : 'down'} from ${prevT}`);
    if (typeof m.target === 'number') prevT = m.target;
    if (!(m.preconditions ?? []).length) gaps.push(`milestone ${n} makes no precondition true`);
    for (const p of m.preconditions ?? []) {
      if (!Number.isInteger(p) || p < 1 || p > pre.length) gaps.push(`milestone ${n} names precondition ${p}, which the goal does not have`);
      else if (seen.has(p)) gaps.push(`precondition ${p} is in milestones ${seen.get(p)} and ${n}; each belongs to one`);
      else seen.set(p, n);
    }
    if (!(Number.isInteger(m.tickets) && m.tickets > 0)) gaps.push(`milestone ${n} has no size (tickets: a rough count of PRs)`);
    if (m.by != null) {
      const t = Date.parse(m.by);
      if (Number.isNaN(t)) gaps.push(`milestone ${n}'s date "${m.by}" is not a date`);
      else {
        if (prevBy !== null && t < prevBy) gaps.push(`milestone ${n} is due before milestone ${n - 1}`);
        if (g.horizon && t > Date.parse(g.horizon)) gaps.push(`milestone ${n} is due after the horizon`);
        prevBy = t;
      }
    }
  });
  pre.forEach((_, i) => { if (!seen.has(i + 1)) gaps.push(`precondition ${i + 1} is in no milestone`); });
  if (typeof g.measure?.target === 'number' && ms[ms.length - 1].target !== g.measure.target) gaps.push(`the last milestone's target (${ms[ms.length - 1].target}) is not the goal's (${g.measure.target})`);
  return gaps;
}
const reached = (g, target, value) => (g.measure?.direction === 'down' ? value <= target : value >= target);
// The first milestone the latest reading has not reached; null once all are.
function currentMilestone(g) {
  const last = goalReadings(g.id).pop()?.measure.value;
  const i = (g.milestones ?? []).findIndex((m) => typeof last !== 'number' || !reached(g, m.target, last));
  return i < 0 ? null : { n: i + 1, ...g.milestones[i] };
}

// The forecast the owner approves a goal against: per milestone, the work left (planned tickets'
// points, or the design's estimate where nothing is planned yet), the waves that takes at the
// current worker slots, and a date where the fleet has a measured rate (planning.md §1).
let roadmapMemo = null;
function goalForecast(g, r = null) {
  const ms = g.milestones ?? [];
  if (!ms.length) return null;
  const all = [...tickets().values()].filter(isActive);
  const avgW = all.length ? all.reduce((a, t) => a + weight(t), 0) / all.length : 1;
  // one roadmap per process: every goal's view asks for its forecast, and the roadmap reads git
  r ??= (roadmapMemo ??= collectRoadmap());
  const slots = Math.max(1, loadSettings().max_active_tickets ?? 1);
  const cur = currentMilestone(g);
  const fs_ = features();
  let cumPts = 0;
  let cumWaves = 0;
  const rows = ms.map((m, i) => {
    const n = i + 1;
    const keys = new Set(m.preconditions.map((p) => `${g.id}#${p}`));
    const feats = [...fs_.values()].filter((f) => (f.goals ?? []).includes(g.id) && (f.preconditions ?? []).some((p) => keys.has(p))).map((f) => f.id);
    const planned = feats.reduce((a, f) => a + (r.features[f]?.points_left ?? 0), 0);
    const plannedTotal = feats.reduce((a, f) => a + (r.features[f]?.points_total ?? 0), 0);
    const status = !cur || n < cur.n ? 'met' : n === cur.n ? 'current' : 'later';
    const left = status === 'met' ? 0 : feats.length ? planned : Math.round(m.tickets * avgW);
    cumPts += left;
    cumWaves += status === 'met' ? 0 : feats.length ? Math.max(0, ...feats.map((f) => r.features[f]?.waves_left ?? 0)) : Math.ceil(m.tickets / slots);
    const eta = r.rate_points_per_day > 0 ? dateOnly(new Date(Date.now() + Math.max(cumPts / r.rate_points_per_day, r.median_cycle_days ? cumWaves * r.median_cycle_days : 0) * DAY).toISOString()) : null;
    const late = Boolean(m.by && eta && eta > dateOnly(new Date(Date.parse(m.by)).toISOString()));
    return { n, title: m.title, target: m.target, by: m.by ?? null, status, features: feats, estimate_tickets: m.tickets, planned_points: plannedTotal, points_left: left, waves_to_here: cumWaves, eta: status === 'met' ? 'met' : eta, late };
  });
  const lastEta = rows[rows.length - 1].eta;
  const pastHorizon = Boolean(g.horizon && lastEta && lastEta !== 'met' && lastEta > dateOnly(new Date(Date.parse(g.horizon)).toISOString()));
  return { milestones: rows, slots, rate_points_per_day: r.rate_points_per_day, median_cycle_days: r.median_cycle_days, eta: lastEta, past_horizon: pastHorizon };
}
function forecastText(g, f) {
  if (!f) return '';
  const L = f.milestones.map((m) => `${m.n}. ${m.title}: ${m.target}${g.measure?.unit ? ` ${g.measure.unit}` : ''}${m.by ? ` by ${m.by}` : ''}; ${m.status === 'met' ? 'met' : `${m.features.length ? `${m.points_left} points left in ${m.features.join(', ')}` : `about ${m.estimate_tickets} tickets, unplanned`}; ${m.waves_to_here} waves to here at ${f.slots} slots${m.eta ? `; ETA ${m.eta}${m.late ? ' (after its date)' : ''}` : ''}`}`);
  const tail = f.rate_points_per_day > 0 ? `ETA ${f.eta}${f.past_horizon ? `, after the horizon ${g.horizon}` : ''}` : 'no measured rate yet, so no dates: sizes and waves only';
  return `Forecast (computed):\n${L.join('\n')}\n${tail}.`;
}
function goalView(g) {
  const readings = goalReadings(g.id);
  const first = readings[0];
  const last = readings[readings.length - 1];
  let track = null;
  if (readings.length >= 2 && typeof g.measure?.target === 'number' && g.horizon) {
    // Expected value now, on the line from the baseline through each dated milestone to the horizon.
    const pts = [[Date.parse(first.created_at), first.measure.value], ...(g.milestones ?? []).filter((m) => m.by && !Number.isNaN(Date.parse(m.by)) && typeof m.target === 'number').map((m) => [Date.parse(m.by), m.target]), [Date.parse(g.horizon), g.measure.target]].sort((a, b) => a[0] - b[0]);
    const now = Date.now();
    let expected = pts[pts.length - 1][1];
    for (let i = 1; i < pts.length; i++) {
      if (now <= pts[i][0]) {
        const [t0, v0] = pts[i - 1];
        const [t1, v1] = pts[i];
        expected = t1 > t0 ? v0 + (v1 - v0) * Math.max(0, (now - t0) / (t1 - t0)) : v1;
        break;
      }
    }
    track = reached(g, expected, last.measure.value) ? 'on track' : 'behind';
  }
  return { ...g, status: g.status ?? 'draft', readings: readings.map((r) => ({ at: r.created_at, value: r.measure.value, source: r.source })), track, check: goalCheck(g), forecast: goalForecast(g) };
}
function cmdGoal() {
  const [sub, id] = positional;
  const writer = () => (flags.owner ? ownerWriter() : (supervisorOnly('goal'), { by: 'supervisor' }));
  const fields = () => ({
    title: flagStr('title'), outcome: flagStr('outcome'),
    measure: ['measure', 'target', 'unit', 'direction'].some((k) => flagStr(k) !== undefined)
      ? { ...(id ? logGet(id)?.measure : {}), ...(flagStr('measure') ? { description: flagStr('measure') } : {}), ...(flagStr('target') ? { target: Number(flagStr('target')) } : {}), ...(flagStr('unit') ? { unit: flagStr('unit') } : {}), ...(flagStr('direction') ? { direction: flagStr('direction') } : {}) }
      : undefined,
    // `none` clears it: a horizon is the owner's real deadline or nothing (planning.md §1)
    horizon: flagStr('horizon') === 'none' ? null : flagStr('horizon'),
    non_goals: flags['non-goals'] !== undefined ? listFlag('non-goals') : undefined,
    preconditions: flags.preconditions !== undefined ? listFlag('preconditions') : undefined,
    priority: flagNum('priority'),
    milestones: jsonFlag('milestones'),
    plan_after: flags['plan-after'] !== undefined ? listFlag('plan-after').map((goal) => ({ goal, reason: flagStr('reason') ?? die('--plan-after needs --reason: why this goal\'s design waits on that one') })) : undefined,
  });
  if (sub === 'add') {
    const { by } = writer();
    const f = fields();
    if (!f.title) die('goal add needs --title');
    return out(appendLog({ type: 'goal', status: 'draft', ...f }, by).id);
  }
  if (sub === 'set') {
    if (!id || logGet(id)?.type !== 'goal') die('usage: goal set <g-id> [--title …] [--outcome …] [--measure …] [--target n] [--unit u] [--direction up|down] [--horizon date] [--non-goals a b | \'["a","b"]\'] [--preconditions a b | \'["a","b"]\'] [--priority n] [--milestones \'[{"title","target","by","preconditions":[n],"tickets"}…]\'] [--plan-after <g-id>… --reason "…"] [--approved <qid>] [--owner]');
    const { by } = writer();
    const approved = flagStr('approved') ?? null;
    if (approved && by !== 'supervisor') die('the owner changes a goal directly; --approved is the supervisor applying an owner answer');
    if (by === 'supervisor' && (logGet(id).status ?? 'draft') !== 'draft' && !approved) die(`${id} is ${logGet(id).status}; only the owner changes it now (class goal-change): ask a goal-change question with --goal ${id}, then goal set ${id} --approved <qid>`);
    if (approved) {
      // an earlier answer carried forward with --change is checked as such (its question recorded no change)
      const problem = goalChangeProblem(logGet(approved), id, approved, logGet(approved)?.type === 'question' && !questionView(logGet(approved)).change && flagStr('change') !== undefined ? { carried: true } : null);
      if (problem) die(`goal set --approved: ${problem}`);
      if (logObjects('goal').some((g) => g.updates.some((u) => u.approved === approved)) || logObjects('act').some((a) => a.approved_by === approved)) die(`${approved} already authorised a change; ask again for another`);
      // the answer authorises the change the question proposed, applied as is
      if (Object.values(fields()).some((x) => x !== undefined)) die('goal set --approved applies the change its question proposed; pass no other fields');
      const qv = questionView(logGet(approved));
      if (qv.change) {
        if (flagStr('change') !== undefined) die(`${approved} proposed its change; --change is only for carrying forward an earlier answer that didn't record one`);
        return out(`updated ${id} (${appendLog({ type: 'goal', op: 'set', id, ...qv.change, approved }, by).id})`);
      }
      // carrying forward an answer given before changes were recorded on the question
      const carried = jsonFlag('change') ?? die(`${approved} was asked before changes were recorded on goal-change questions: carry the owner's answer forward with --change '{…}', the change they chose ("${qv.answer}")`);
      const bad = Object.keys(carried).filter((k) => !GOAL_CHANGE_FIELDS.includes(k));
      if (!Object.keys(carried).length || bad.length) die(`--change sets goal fields (${GOAL_CHANGE_FIELDS.join(', ')})${bad.length ? `; not ${bad.join(', ')}` : ''}`);
      const line = appendLog({ type: 'goal', op: 'set', id, ...carried, approved, carried: true }, by);
      appendLog({ type: 'act', class: 'carry-answer', what: `applied your earlier answer to ${approved} ("${qv.answer}") to ${id}: set ${Object.keys(carried).join(', ')}`, refs: [id, approved], reversible: true }, 'supervisor');
      return out(`updated ${id} (${line.id}), carrying ${approved} forward`);
    }
    appendLog({ type: 'goal', op: 'set', id, ...fields() }, by);
    return out(`updated ${id}`);
  }
  // The owner's decision on a goal, made on its design: approve (ready; planning starts), refine
  // (notes the planner must take into account; the supervisor reworks the design and asks again),
  // or let go (abandoned). It answers the open goal-approval question for the goal.
  if (sub === 'approve' || sub === 'decide') {
    const { by } = ownerWriter();
    const g = logGet(id);
    if (g?.type !== 'goal') die(`no goal ${id}`);
    const verdict = sub === 'approve' ? 'approve' : positional[2];
    if (!['approve', 'refine', 'let-go'].includes(verdict)) die('usage: goal decide <g-id> approve|refine|let-go [--notes "…"] [--question q-…]');
    const notes = flagStr('notes')?.trim() || undefined;
    if (verdict === 'refine' && !notes) die('refine needs --notes: what the planner should change');
    const ask = flagStr('question') ? questions().find((q) => q.id === flagStr('question')) : questions().find((q) => q.kind === 'goal-approval' && q.goal === id && q.status === 'open');
    if (flagStr('question') && (!ask || ask.kind !== 'goal-approval' || ask.goal !== id)) die(`${flagStr('question')} is not a goal-approval question for ${id}`);
    if (verdict === 'approve') {
      const c = goalCheck(g);
      if (c.definition.length && !flags.force) die(`${id} is not fully defined:\n  - ${c.definition.join('\n  - ')}\n(--force to approve anyway)`);
      if (!ask && !flags.force) die(`${id} has no design up for approval: the supervisor writes and reviews the design first, then asks (ask --kind goal-approval --goal ${id}); --force to approve without one`);
    }
    const status = { approve: 'ready', refine: undefined, 'let-go': 'abandoned' }[verdict];
    appendLog({ type: 'goal', op: 'set', id, status, decision: { verdict, notes, question: ask?.id } }, by);
    if (ask?.status === 'open') appendLog({ type: 'question', op: 'set', id: ask.id, answer: `${{ approve: 'Approve', refine: 'Refine', 'let-go': 'Let go' }[verdict]}${notes ? ` — ${notes}` : ''}` }, by);
    nudgeSupervisor(`[devteam goal ${verdict} ${id} from owner] read it with: devteam.mjs goal show ${id}`);
    return out(`${id}: ${verdict}${status ? ` (${status})` : ''}`);
  }
  if (sub === 'status') {
    const { by } = ownerWriter();
    const g = logGet(id);
    if (g?.type !== 'goal') die(`no goal ${id}`);
    const to = positional[2];
    if (!['draft', 'ready', 'met', 'abandoned'].includes(to)) die('status is draft, ready, met or abandoned');
    if (to === 'ready') die(`a goal becomes ready through its design: goal decide ${id} approve`);
    appendLog({ type: 'goal', op: 'set', id, status: to }, by);
    return out(`${id} is ${to}`);
  }
  if (sub === 'forecast') {
    const g = logGet(id)?.type === 'goal' ? logGet(id) : die('usage: goal forecast <g-id>');
    const f = goalForecast(g);
    if (flags.json) return json(f);
    return out(f ? forecastText(g, f) : `${id} has no milestones yet`);
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
      const approvalGaps = (g.status ?? 'draft') === 'draft' || c.approval.length ? c.approval : [];
      gaps += c.definition.length + approvalGaps.length + c.coverage.length;
      out(`${g.id} [${g.status ?? 'draft'}] ${g.title}`);
      for (const d of c.definition) out(`  definition: ${d}`);
      for (const d of approvalGaps) out(`  milestones: ${d}`);
      for (const d of c.coverage) out(`  coverage: ${d}`);
      if (c.later.length) out(`  later milestones: precondition ${c.later.join(', ')} are planned once milestone ${c.current_milestone} is met`);
      if (!c.definition.length && !approvalGaps.length && !c.coverage.length) out('  ok');
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
  const base = { features: Object.fromEntries(views.map((v) => [v.feature, v])), rate_points_per_day: rate, median_cycle_days: cycleDays };
  const goalRows = goals.map((g) => {
    const c = goalCheck(g);
    const feats = ordered.filter((v) => v.goals.includes(g.id));
    const etas = feats.map((v) => v.eta).filter(Boolean).sort();
    // With milestones, the goal's date is the forecast's: later milestones count by their estimate.
    const fc = goalForecast(g, base);
    const eta = fc ? (fc.milestones.every((m) => m.status === 'met') ? 'done' : fc.eta) : c.unplanned.length || !feats.length ? null : feats.every((v) => v.done) ? 'done' : etas.pop() ?? null;
    return { id: g.id, title: g.title, priority: g.priority ?? null, status: g.status ?? 'draft', unplanned: c.unplanned.filter((u) => !c.later.includes(u.n)), later: c.later, current_milestone: c.current_milestone, milestones: fc?.milestones ?? [], past_horizon: fc?.past_horizon ?? false, features: feats.map((v) => v.feature), eta, has_design: !c.coverage.some((x) => x.startsWith('no design')) };
  });
  return {
    generated_at: nowIso(), rate_points_per_day: +rate.toFixed(2), median_cycle_days: cycleDays === null ? null : +cycleDays.toFixed(1),
    goals: goalRows, features: Object.fromEntries(views.map((v) => [v.feature, v])), unassigned: views.filter((v) => v.feature !== CHORES && !v.goals.some((g) => logGet(g)?.type === 'goal')).map((v) => v.feature),
    note: 'Estimates assume goal-priority order at the current rate; a feature finishes no sooner than its remaining waves times the median cycle time. A goal with milestones is dated by its forecast (unplanned milestones by their size); one without, and with unplanned preconditions, has no date.',
  };
}
const weekOf = (d) => { if (!d) return 'no date'; const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return `week of ${dateOnly(x.toISOString())}`; };
function roadmapText(r) {
  const L = [`rate ${r.rate_points_per_day} points/day; median cycle ${r.median_cycle_days ?? '-'} days`];
  for (const g of r.goals) {
    L.push('', `${g.priority ? `p${g.priority} ` : ''}${g.title} [${g.status}] -> ${g.eta === 'done' ? 'done' : weekOf(g.eta)}${g.past_horizon ? ' (after its horizon)' : ''}${g.has_design ? '' : ' (no design)'}`);
    for (const m of g.milestones) L.push(`  milestone ${m.n} [${m.status}] ${m.title} -> ${m.eta === 'met' ? 'met' : weekOf(m.eta)}${m.features.length ? '' : ` (about ${m.estimate_tickets} tickets, unplanned)`}${m.late ? ' (after its date)' : ''}`);
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

const GATE_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
function gateStats(runs) {
  runs = runs.filter((r) => GATE_NAME.test(r.gate ?? ''));
  const byGate = new Map();
  for (const r of runs) (byGate.get(r.gate) ?? byGate.set(r.gate, []).get(r.gate)).push(r);
  const gates = [];
  const flakyGates = [];
  for (const [g, rs] of byGate) {
    const bySha = new Map();
    for (const r of rs.filter((x) => !x.dirty)) (bySha.get(r.sha) ?? bySha.set(r.sha, []).get(r.sha)).push(r);
    const flaky = [...bySha.values()].filter((x) => x.some((r) => r.ok) && x.some((r) => !r.ok)).length;
    if (flaky) flakyGates.push({ gate: g, commits: flaky });
    gates.push({ gate: g, runs: rs.length, fail_rate: +(rs.filter((r) => !r.ok && !r.preexisting).length / rs.length).toFixed(2), preexisting_fails: rs.filter((r) => r.preexisting).length, median_seconds: +(median(rs.map((r) => r.ms)) / 1000).toFixed(1), max_seconds: +(Math.max(...rs.map((r) => r.ms)) / 1000).toFixed(1) });
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

// ===== spend: measured from the agent harnesses' own session logs =====
// A session can't see its own cost, so asking agents to report it recorded nothing. Every harness
// already logs token usage per response, with the directory it ran in: the kit reads those logs
// (usage numbers and model names only, never content), attributes each response to the ticket,
// planner, reviewer or supervisor whose checkout it ran in, and prices it.
// $ per million tokens: [input, output, cache-read multiple of input]. Cache writes cost 1.25x input
// (5-minute) or 2x (1-hour). Claude list prices; settings.model_prices overrides or adds models.
const MODEL_PRICES = {
  'claude-fable-5-1': [10, 50, 0.025], 'claude-mythos-5-1': [10, 50, 0.025], 'claude-fable-5': [10, 50, 0.1], 'claude-mythos-5': [10, 50, 0.1],
  'claude-opus-5-5': [4, 20, 0.05], 'claude-opus-5': [5, 25, 0.1], 'claude-opus-4-8': [5, 25, 0.1], 'claude-opus-4-7': [5, 25, 0.1], 'claude-opus-4-6': [5, 25, 0.1],
  'claude-sonnet-5-5': [2, 10, 0.1], 'claude-sonnet-5': [2, 10, 0.1], 'claude-sonnet-4-6': [3, 15, 0.1],
  'claude-haiku-5-5': [0.1, 0.5, 0.1, { over: 100000, input: 0.5, output: 2.5 }], 'claude-haiku-4-5': [1, 5, 0.1],
};
const modelKey = (m) => String(m ?? '').toLowerCase().replace(/\[.*$/, '').replace(/^(anthropic\.|us\.anthropic\.)/, '').replace(/[-@]\d{8}$/, '');
function priceFor(model) {
  const k = modelKey(model);
  const own = loadSettings().model_prices?.[k] ?? loadSettings().model_prices?.[model];
  if (own && typeof own.input === 'number' && typeof own.output === 'number') return { input: own.input, output: own.output, read: own.cache_read ?? own.input * 0.1, write: own.cache_write ?? own.input * 1.25, write1h: own.cache_write_1h ?? own.input * 2 };
  const known = MODEL_PRICES[k] ?? MODEL_PRICES[Object.keys(MODEL_PRICES).filter((x) => k.startsWith(x)).sort((a, b) => b.length - a.length)[0]];
  if (!known) return null;
  const [input, output, rf, tier] = known;
  return { input, output, read: input * rf, write: input * 1.25, write1h: input * 2, tier: tier && { over: tier.over, input: tier.input, output: tier.output, read: tier.input * rf, write: tier.input * 1.25, write1h: tier.input * 2 } };
}
// One record: [atMs, model, input, output, cacheRead, cacheWrite5m, cacheWrite1h, usd|null].
function recordUsd(r) {
  if (typeof r[7] === 'number') return r[7];
  let p = priceFor(r[1]);
  if (!p) return null;
  if (p.tier && r[2] + r[4] + r[5] + r[6] > p.tier.over) p = p.tier;
  return (r[2] * p.input + r[3] * p.output + r[4] * p.read + r[5] * p.write + r[6] * p.write1h) / 1e6;
}
const realOrSelf = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
// Whose work ran in a directory: a ticket's worktree, a planner's, a reviewer's (charged to its
// ticket), and the main checkout or a chore's (the supervisor's).
function spenderFor(cwd, ts) {
  // a subagent the supervisor ran for one ticket (a reviewer): "ticket:<id>:<phase>"
  const sub = /^ticket:(.+):([a-z-]+)$/.exec(cwd ?? '');
  if (sub) return ts.has(sub[1]) ? { who: sub[1], role: 'reviewer', phase: sub[2] } : { who: 'supervisor', role: 'supervisor' };
  const main = realOrSelf(mainRoot);
  const at = realOrSelf(cwd ?? '');
  if (at === main) return { who: 'supervisor', role: 'supervisor' };
  const wtRoot = path.join(main, '.worktrees') + path.sep;
  if (!at.startsWith(wtRoot)) return at.startsWith(main + path.sep) ? { who: 'supervisor', role: 'supervisor' } : null;
  const name = at.slice(wtRoot.length).split(path.sep)[0];
  if (ts.has(name)) return { who: name, role: 'worker' };
  if (name.startsWith('plan-')) return { who: name, role: 'planner' };
  const rv = /^review-(.+?-\d+)-[0-9a-f]{8}/.exec(name);
  if (rv) { const t = [...ts.keys()].find((id) => id === rv[1] || id.startsWith(`${rv[1]}-`)); return t ? { who: t, role: 'reviewer' } : null; }
  const old = /^review-(.+)-[0-9a-f]{12}/.exec(name);
  if (old && ts.has(old[1])) return { who: old[1], role: 'reviewer' };
  return { who: 'supervisor', role: 'supervisor' };
}
// Each source returns Map<cwd, records>. Parsed files are cached in run/cache by size and mtime.
function usageCache() {
  const file = path.join(runDir, 'cache', 'usage.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  return { data, save: () => { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)); } catch {} } };
}
const USAGE_PARSE_V = 2;
function cachedParse(cache, f, parse) {
  let st;
  try { st = fs.statSync(f); } catch { return null; }
  const hit = cache.data[f];
  if (hit && hit.size === st.size && hit.mtime === st.mtimeMs && hit.v === USAGE_PARSE_V) return hit;
  let v;
  try { v = parse(fs.readFileSync(f, 'utf8')); } catch { v = { byCwd: {} }; }
  return (cache.data[f] = { size: st.size, mtime: st.mtimeMs, v: USAGE_PARSE_V, ...v });
}
const walkJsonl = (dir, out = []) => { let es = []; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; } for (const e of es) { const p = path.join(dir, e.name); if (e.isDirectory()) walkJsonl(p, out); else if (e.name.endsWith('.jsonl')) out.push(p); } return out; };
const USAGE_SOURCES = {
  // Claude Code: ~/.claude/projects/<the directory, slugged>/<session>.jsonl and its subagents;
  // a response's usage repeats on each line of that message, so it counts once per message id.
  'claude-code': (cache) => {
    const root = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'projects');
    const slug = realOrSelf(mainRoot).replace(/[^a-zA-Z0-9]/g, '-');
    let dirs = [];
    try { dirs = fs.readdirSync(root).filter((d) => d === slug || d.startsWith(`${slug}--worktrees-`)); } catch { return []; }
    // The folder is the checkout the session started in (a later cd doesn't move it). A subagent
    // of the main checkout's session that was given one ticket's work (a reviewer: its task names
    // the ticket) is charged to that ticket, in the phase its task names.
    const ids = [...tickets().keys()];
    return dirs.flatMap((d) => walkJsonl(path.join(root, d)).map((f) => cachedParse(cache, f, (text) => {
      const byCwd = {};
      let cwdOf = d === slug ? mainRoot : path.join(mainRoot, '.worktrees', d.slice(`${slug}--worktrees-`.length));
      if (d === slug && f.includes(`${path.sep}subagents${path.sep}`)) {
        const task = subagentTask(text);
        const named = ids.filter((id) => new RegExp(`(^|[^a-z0-9-])${id.replace(/[-]/g, '\\-')}(?![a-z0-9-])`).test(task));
        const viaTree = /\.worktrees\/review-([a-z0-9]+-\d+)-/.exec(task)?.[1];
        const tid = named.length === 1 ? named[0] : viaTree ? ids.find((id) => id.startsWith(`${viaTree}-`)) : null;
        if (tid) cwdOf = `ticket:${tid}:${/final/i.test(task) ? 'final-review' : /\bplan\b/i.test(task) ? 'plan' : /\bspec\b/i.test(task) ? 'spec' : 'review'}`;
      }
      const seen = new Set();
      for (const line of text.split('\n')) {
        if (!line.includes('"usage"')) continue;
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        const m = o.message, u = m?.usage;
        if (!u || o.type !== 'assistant' || m.model === '<synthetic>') continue;
        const key = m.id ?? o.requestId ?? o.uuid;
        if (seen.has(key)) continue;
        seen.add(key);
        const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
        const w = u.cache_creation_input_tokens ?? 0;
        (byCwd[cwdOf] ??= []).push([Date.parse(o.timestamp), m.model, u.input_tokens ?? 0, u.output_tokens ?? 0, u.cache_read_input_tokens ?? 0, Math.max(0, w - w1h), w1h, null]);
      }
      return { byCwd };
    })).filter(Boolean));
  },
  // Codex: ~/.codex/sessions/**/rollout-*.jsonl: the session's cwd up front, turn_context lines
  // name the model, token_count events carry running totals (cached input is part of input).
  codex: (cache) => {
    const root = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'sessions');
    const main = realOrSelf(mainRoot);
    return walkJsonl(root).map((f) => cachedParse(cache, f, (text) => {
      const lines = text.split('\n');
      let cwd = null;
      try { cwd = JSON.parse(lines[0]).payload?.cwd ?? null; } catch {}
      if (!cwd || !(realOrSelf(cwd) === main || realOrSelf(cwd).startsWith(main + path.sep))) return { byCwd: {} };
      const recs = [];
      let model = null, prev = null;
      for (const line of lines) {
        if (!line.includes('turn_context') && !line.includes('token_count')) continue;
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        if (o.type === 'turn_context') { model = o.payload?.model ?? model; continue; }
        const t = o.payload?.type === 'token_count' ? o.payload.info?.total_token_usage : null;
        if (!t) continue;
        const d = (k) => Math.max(0, (t[k] ?? 0) - (prev?.[k] ?? 0));
        const cached = d('cached_input_tokens');
        if (d('input_tokens') || d('output_tokens')) recs.push([Date.parse(o.timestamp), model, Math.max(0, d('input_tokens') - cached), d('output_tokens'), cached, d('cache_write_input_tokens'), 0, null]);
        prev = t;
      }
      return { byCwd: { [cwd]: recs } };
    })).filter(Boolean);
  },
};
// A subagent transcript's task: the text of its first user message.
function subagentTask(text) {
  for (const line of text.split('\n')) {
    if (!line.includes('"user"')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== 'user') continue;
    const c = o.message?.content;
    return typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x?.text ?? '').join(' ') : '';
  }
  return '';
}
// usage_command (any other harness: OpenCode, a gateway's export…): runs from the main checkout and
// prints one JSON object per line: {"at", "cwd", "model", "input_tokens", "output_tokens",
// "cache_read_tokens", "cache_write_tokens", "usd" (optional, used as given)}.
function commandUsage(cmd) {
  const out = sh('sh', ['-c', cmd], { cwd: mainRoot }) ?? '';
  const byCwd = {};
  for (const line of out.split('\n')) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o !== 'object' || !o.cwd) continue;
    (byCwd[o.cwd] ??= []).push([Date.parse(o.at), o.model ?? null, o.input_tokens ?? 0, o.output_tokens ?? 0, o.cache_read_tokens ?? 0, o.cache_write_tokens ?? 0, 0, typeof o.usd === 'number' ? o.usd : null]);
  }
  return [{ byCwd }];
}
let spendMemo = null;
// Every response's usage, attributed: [{ who, role, at, model, tokens…, usd }], plus what couldn't
// be priced. Memoised per process; parsed files are cached on disk between processes.
function measuredSpend() {
  if (spendMemo) return spendMemo;
  const s = loadSettings();
  const ts = tickets();
  const cache = usageCache();
  const parsed = [];
  for (const src of s.usage_sources ?? []) if (USAGE_SOURCES[src]) parsed.push(...USAGE_SOURCES[src](cache));
  cache.save();
  if (s.usage_command) parsed.push(...commandUsage(s.usage_command));
  const recs = [];
  const unpriced = new Map();
  for (const p of parsed) for (const [cwd, rs] of Object.entries(p.byCwd ?? {})) {
    const sp = spenderFor(cwd, ts);
    if (!sp) continue;
    for (const r of rs) {
      const usd = recordUsd(r);
      if (usd === null) unpriced.set(r[1] ?? 'unknown', (unpriced.get(r[1] ?? 'unknown') ?? 0) + r[2] + r[3] + r[4] + r[5] + r[6]);
      recs.push({ ...sp, at: r[0], model: r[1], input: r[2], output: r[3], cache_read: r[4], cache_write: r[5] + r[6], usd: usd ?? 0, priced: usd !== null });
    }
  }
  return (spendMemo = { recs, unpriced: Object.fromEntries(unpriced) });
}
// The phase a response is charged to: a worker's phase at that moment; a planner's planning, a
// reviewer's review, the supervisor's its own.
function phaseAtFor(role, who, at, phaseLines) {
  if (role !== 'worker') return { supervisor: 'supervisor', planner: 'planning', reviewer: 'review' }[role] ?? role;
  let phase = 'starting';
  for (const l of phaseLines.get(who) ?? []) { if (Date.parse(l.created_at) <= at) phase = l.to; else break; }
  return phase;
}
const phaseLinesMap = () => { const m = new Map(); for (const l of logObjects('phase')) (m.get(l.created_by) ?? m.set(l.created_by, []).get(l.created_by)).push(l); for (const ls of m.values()) ls.sort(byTime); return m; };
// Spend, as items { who, role, phase, at, usd, tokens…, by_model }: the log's spend lines (durable),
// then whatever the harness logs show since each agent's last line (not yet observed).
let spendItemsMemo = null;
function spendItems() {
  if (spendItemsMemo) return spendItemsMemo;
  const phaseLines = phaseLinesMap();
  const items = [];
  const through = new Map();
  for (const l of logObjects('spend')) {
    const at = Date.parse(l.through);
    through.set(l.who, Math.max(through.get(l.who) ?? 0, at));
    items.push({ who: l.who, role: l.role, phase: l.phase, at, usd: l.usd ?? 0, input: l.input_tokens ?? 0, output: l.output_tokens ?? 0, cache_read: l.cache_read_tokens ?? 0, cache_write: l.cache_write_tokens ?? 0, by_model: l.by_model ?? {}, logged: true });
  }
  for (const r of measuredSpend().recs) {
    if (r.at <= (through.get(r.who) ?? -Infinity)) continue;
    items.push({ who: r.who, role: r.role, phase: r.phase ?? phaseAtFor(r.role, r.who, r.at, phaseLines), at: r.at, usd: r.usd, input: r.input, output: r.output, cache_read: r.cache_read, cache_write: r.cache_write, by_model: { [r.model ?? 'unknown']: { usd: r.usd, output_tokens: r.output, ...(r.priced === false ? { unpriced_tokens: r.input + r.output + r.cache_read + r.cache_write } : {}) } }, logged: false });
  }
  return (spendItemsMemo = items);
}
// observe-spend (each tick, with observe-metrics): turn the not-yet-observed tail into spend lines,
// one per agent and phase, so the log holds spend after the harness logs are cleaned up.
function observeSpend() {
  const groups = new Map();
  for (const it of spendItems().filter((x) => !x.logged)) {
    const k = `${it.who}\0${it.phase}`;
    const g = groups.get(k) ?? { who: it.who, role: it.role, phase: it.phase, at: 0, usd: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, by_model: {} };
    g.at = Math.max(g.at, it.at);
    for (const f of ['usd', 'input', 'output', 'cache_read', 'cache_write']) g[f] += it[f];
    for (const [mdl, v] of Object.entries(it.by_model)) { const b = (g.by_model[mdl] ??= { usd: 0, output_tokens: 0 }); b.usd += v.usd; b.output_tokens += v.output_tokens; if (v.unpriced_tokens) b.unpriced_tokens = (b.unpriced_tokens ?? 0) + v.unpriced_tokens; }
    groups.set(k, g);
  }
  // one agent's lines share one `through` (its latest response), so the next tick resumes after all of them
  const latest = new Map();
  for (const g of groups.values()) latest.set(g.who, Math.max(latest.get(g.who) ?? 0, g.at));
  for (const g of groups.values()) appendLog({ type: 'spend', who: g.who, role: g.role, phase: g.phase, through: new Date(latest.get(g.who)).toISOString(), usd: +g.usd.toFixed(4), input_tokens: g.input, output_tokens: g.output, cache_read_tokens: g.cache_read, cache_write_tokens: g.cache_write, by_model: Object.fromEntries(Object.entries(g.by_model).map(([k, v]) => [k, { ...v, usd: +v.usd.toFixed(4) }])) }, 'supervisor');
  spendItemsMemo = null; spendWhoMemo = null; logCache = null;
  return groups.size;
}
function cmdObserveSpend() {
  supervisorOnly('observe-spend');
  out(`recorded ${observeSpend()} spend line(s)`);
}
let spendWhoMemo = null;
const spendByWho = () => { if (spendWhoMemo) return spendWhoMemo; const m = new Map(); for (const r of spendItems()) { const x = m.get(r.who) ?? { usd: 0, input_tokens: 0, output_tokens: 0 }; x.usd += r.usd; x.input_tokens += r.input + r.cache_read + r.cache_write; x.output_tokens += r.output; m.set(r.who, x); } return (spendWhoMemo = m); };

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
  // Measured usage, where a harness logged it, replaces what agents reported: each response is
  // charged to the phase its ticket was in at that moment (a planner's to planning, a reviewer's
  // to review, the main checkout's to the supervisor).
  const items = spendItems();
  const costSource = items.length ? 'measured' : 'reported';
  const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  const byModel = {};
  const unpricedModels = {};
  if (items.length) {
    for (const k of Object.keys(phaseUsd)) delete phaseUsd[k];
    for (const k of Object.keys(ticketUsd)) delete ticketUsd[k];
    for (const r of items) {
      if (r.at < since) continue;
      phaseUsd[r.phase] = (phaseUsd[r.phase] ?? 0) + r.usd;
      if (r.role === 'worker' || r.role === 'reviewer') ticketUsd[r.who] = (ticketUsd[r.who] ?? 0) + r.usd;
      for (const k of Object.keys(tokens)) tokens[k] += r[k];
      for (const [mdl, v] of Object.entries(r.by_model)) {
        const bm = (byModel[mdl] ??= { usd: 0, output_tokens: 0 });
        bm.usd += v.usd; bm.output_tokens += v.output_tokens;
        if (v.unpriced_tokens) unpricedModels[mdl] = (unpricedModels[mdl] ?? 0) + v.unpriced_tokens;
      }
    }
  }
  // Cost per merged point (S = 1, M = 2), all time and for the last two weeks: what a spend trial moves.
  const POINTS = { S: 1, M: 2 };
  const perPoint = (from, to) => {
    const done = cycles.filter((c) => { const m = mergedAt(c.id); return m >= from && m < to && ticketUsd[c.id] !== undefined; });
    const pts = done.reduce((a, c) => a + (POINTS[ts.get(c.id)?.size] ?? 1), 0);
    return pts ? { usd_per_point: +(done.reduce((a, c) => a + ticketUsd[c.id], 0) / pts).toFixed(2), points: pts, tickets: done.length } : null;
  };
  const mergedCosts = cycles.map((c) => ticketUsd[c.id]).filter((x) => x !== undefined);

  const msgs = logObjects('message').filter((m) => Date.parse(m.created_at) >= since).sort(byTime);
  const replies = new Map();
  for (const m of msgs) if (m.re && !replies.has(m.re)) replies.set(m.re, Date.parse(m.created_at));
  const expecting = msgs.filter((m) => !['info', 'ruling', 'answer'].includes(m.kind));
  const openMsgs = expecting.filter((m) => !replies.has(m.id) && !settledByLanding(m));
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
    cost: { source: costSource, usd_all: +Object.values(phaseUsd).reduce((a, b) => a + b, 0).toFixed(2), tokens, by_model: Object.fromEntries(Object.entries(byModel).map(([k, v]) => [k, { usd: +v.usd.toFixed(2), output_tokens: v.output_tokens }])), unpriced_models: unpricedModels, per_point: perPoint(0, now + 1), per_point_this_week: perPoint(now - 7 * DAY, now + 1), per_point_last_week: perPoint(now - 14 * DAY, now - 7 * DAY), usd_total: +Object.values(ticketUsd).reduce((a, b) => a + b, 0).toFixed(2), usd_per_merged_ticket: mergedCosts.length ? +(mergedCosts.reduce((a, b) => a + b, 0) / mergedCosts.length).toFixed(2) : null, by_ticket: round(ticketUsd) },
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
    // Blocked on an open owner question (asked for it, or naming it in blocks): the next move is the
    // owner's, already in their inbox, so say which question rather than tell the supervisor to act.
    const ownerQs = p.phase === 'blocked' ? openQs.filter((q) => q.ticket === id || (q.blocks ?? []).includes(id)) : [];
    if (p.phase === 'blocked' && h >= 1 && ownerQs.length) add('medium', 'blocked-on-owner', id, `blocked for ${h.toFixed(1)}h on the owner's answer to ${ownerQs.map((q) => q.id).join(', ')}`, 'nothing for the supervisor until it is answered; remind the owner what it blocks if it sits');
    else if (p.phase === 'blocked' && h >= 1) add('high', 'blocked', id, `blocked for ${h.toFixed(1)}h`, 'answer its message, re-plan, or park it');
    if (p.phase === 'awaiting-word' && h >= 1) add('medium', 'waiting-on-supervisor', id, `waiting for the stage or merge word for ${h.toFixed(1)}h`, 'answer its review-request: give the word, run merge, or say what is missing');
  }
  // The tmux session's window names, once (null when tmux or the session isn't there: unknown).
  let windowNames;
  const windowGone = (name) => {
    if (windowNames === undefined) { const l = sh('tmux', ['list-windows', '-t', settings.tmux_session, '-F', '#W']); windowNames = l === null ? null : new Set(l.split('\n').filter(Boolean)); }
    return windowNames !== null && !windowNames.has(name);
  };
  for (const id of ts.keys()) {
    const w = workerState(id);
    const wait = paneWaiting(id);
    if (wait) add('high', 'blocked-prompt', id, wait.kind === 'limit' ? `a usage-limit banner in its pane: "${wait.line}"` : `waiting on a prompt in its pane: "${wait.line}"`, `look (tmux select-window -t ${settings.tmux_session}:${id}) and clear it (supervisor.md §11); a permission prompt a worker should never see means agent_command or its deny rules need a fix`);
    // waiting is not stale: an open owner question that blocks the ticket, or the worker's own
    // request to the supervisor still unanswered (the unanswered-message finding covers that)
    const waitingOnOwner = openQs.some((q) => (q.blocks ?? []).includes(id) || q.ticket === id);
    const waitingOnSupervisor = openMsgs.some((m) => m.created_by === id);
    const exited = w && w.phase && !['done', 'parked'].includes(w.phase) && !mergeShaFor(id) ? agentExited(id) : null;
    if (exited) add('high', 'agent-exited', id, exited.replace(/; resume it first$/, ''), `resume it: worker ${id} --resume (supervisor.md, recovery)`);
    else if (w && w.phase && !['done', 'parked', 'awaiting-word', 'blocked'].includes(w.phase) && !mergeShaFor(id) && !waitingOnOwner && !waitingOnSupervisor && w.minutes_silent > settings.stale_after_minutes) add('high', 'stale-worker', id, ...(windowGone(id) ? [`silent for ${w.minutes_silent} min (phase ${w.phase}) and its tmux window is gone`, `resume it: worker ${id} --resume (supervisor.md, recovery)`] : [...(idleOnApiError(id) ? [`silent for ${w.minutes_silent} min (phase ${w.phase}), stopped on an API or network error`, `nudge it: send ${id} "the network dropped; carry on from where you were"`] : idleWithShell(id) ? [`silent for ${w.minutes_silent} min (phase ${w.phase}), idle at its prompt with a background shell still running`, `nudge it: send ${id} "check your background shell's result and carry on" (an agent can lose the result across a compaction)`] : [`silent for ${w.minutes_silent} min (phase ${w.phase})`, 'check its pane; resume it (supervisor.md, recovery)'])]));
  }
  for (const p of planners()) {
    const who = `plan-${p.feature}`;
    if (p.waiting) add('high', 'blocked-prompt', who, p.waiting.kind === 'limit' ? `a usage-limit banner in its pane: "${p.waiting.line}"` : `waiting on a prompt in its pane: "${p.waiting.line}"`, `look (tmux select-window -t ${settings.tmux_session}:${who}) and clear it (supervisor.md §11)`);
    else if (/no agent is running|has exited/.test(p.problem ?? '')) add('high', 'agent-exited', who, p.problem.replace(/; resume it first$/, ''), `resume it: planner ${p.feature} --resume (supervisor.md §11)`);
    else if (!p.window) add('medium', 'planner-gone', who, `plan/${p.feature} isn't on main and its window is gone (${p.problem})`, `resume it (planner ${p.feature} --resume) or, if the plan was dropped, delete the branch`);
    else if (!p.waiting_on_supervisor.length && !p.waiting_on_owner.length && p.minutes_silent > settings.stale_after_minutes) add('high', 'stale-planner', who, `no sign of life for ${p.minutes_silent} min`, 'check its pane; message it or resume it (supervisor.md §11)');
  }
  for (const msg of openMsgs.filter((x) => now - Date.parse(x.created_at) > 30 * 60000)) add('medium', 'unanswered-message', msg.id, `${msg.kind} from ${msg.created_by}, ${Math.round((now - Date.parse(msg.created_at)) / 60000)} min old`, `reply with --re ${msg.id}`);
  // A review's page lives on the branch that asked it; once no branch or tag holds that commit, the
  // page the owner answers (or answered) on is lost at the next prune.
  for (const q of questions().filter((x) => x.kind === 'review' && x.review && ['open', 'answered'].includes(x.status) && reviewPins(x.review).status === 'missing')) add('high', 'review-file-missing', q.id, `its page is pinned to ${String(q.review.commit).slice(0, 12)} (asked on ${q.review.ref}), which no branch or tag holds any more, or which can't be read`, q.status === 'open' ? 'withdraw it and ask again on a page committed to a live branch' : `restore the branch before the commit is pruned (git branch ${q.review.ref} ${q.review.commit}), so the page the owner answered on stays on record`);
  for (const q of openQs.filter((x) => now - Date.parse(x.asked_at) > grace)) add('high', 'owner-question-waiting', q.id, q.question.slice(0, 120), q.default ? 'apply its default' : 'remind the owner; it blocks work');
  if (recentQs.length >= 4 && answeredRecent / recentQs.length < 0.5) add('high', 'inbox-stalled', 'owner questions', `${answeredRecent} of ${recentQs.length} answered in 14 days`, 'remind the owner what is blocked; give defaults where the class allows; withdraw what no longer matters');
  // churn is a signal to re-plan a ticket still in flight; a merged ticket's passes are retro material
  for (const [id, n] of Object.entries(reviewPasses()).filter(([id2, n]) => n >= 3 && !mergeShaFor(id2))) add('medium', 'review-churn', id, `${n} final review passes`, 'the ticket may be too big or under-specified; re-plan it');
  const ready = [...ts.values()].filter((t) => isActive(t) && !isHeld(t) && !mergeShaFor(t.id) && !activeWorker(t.id) && (t.depends_on ?? []).every((d) => mergeShaFor(d)) && !notSchedulable(t));
  const active = [...ts.keys()].filter(activeWorker).length;
  // Goals that need planning with nobody planning them: a fully defined draft goal with no design up
  // for approval, or a ready goal whose current milestone has unplanned preconditions, and no
  // planner in flight for it while planner slots are free.
  {
    const ps = planners();
    const busy = new Set(ps.flatMap((p) => p.goals));
    // a goal whose design waits on another goal's (plan_after) waits until that one is approved
    // (a goal let go, or one that doesn't exist, holds nothing back)
    const blockedBy = (g) => (g.plan_after ?? []).filter((d) => logGet(d.goal)?.type === 'goal' && (logGet(d.goal).status ?? 'draft') === 'draft');
    const waiting = logObjects('goal').filter((g) => {
      if (busy.has(g.id) || ['met', 'abandoned'].includes(g.status) || blockedBy(g).length) return false;
      const c = goalCheck(g);
      if ((g.status ?? 'draft') === 'draft') return !c.definition.length && !questions().some((q) => q.goal === g.id && q.status === 'open');
      return g.status === 'ready' && c.coverage.some((x) => x.includes('has no feature') || x.startsWith('no feature names'));
    }).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
    const cap = settings.max_active_planners;
    if (waiting.length && (cap == null || ps.length < cap)) add('medium', 'idle-planning', `${waiting.length} goal${waiting.length > 1 ? 's' : ''}`, `${ps.length}${cap == null ? '' : `/${cap}`} planner${ps.length === 1 ? '' : 's'} active; nobody is planning ${waiting.map((g) => `"${g.title}"`).join(', ')}`, `start a planner for each (goals plan in parallel), or record why one waits on another's design (goal set <id> --plan-after <g-id> --reason "…"): ${waiting.slice(0, cap == null ? waiting.length : Math.max(1, cap - ps.length)).map((g) => g.id).join(', ')}`);
  }
  if (ready.length && active < settings.max_active_tickets) add('medium', 'idle-capacity', `${ready.length} ready`, `${active}/${settings.max_active_tickets} workers active`, `make workers for: ${ready.slice(0, 5).map((t) => t.id).join(', ')}`);
  // A key that decrypts production, copied into every worktree, is readable by every agent
  // (code-style.md §10): production decrypts its own file, or the default one when it has none.
  const prodKey = fs.existsSync(path.join(mainRoot, 'config/credentials/production.yml.enc')) ? 'config/credentials/production.key' : fs.existsSync(path.join(mainRoot, 'config/credentials.yml.enc')) ? 'config/master.key' : null;
  if (prodKey && (settings.worktree_files ?? []).includes(prodKey)) add('high', 'production-key-in-worktrees', prodKey, `settings.worktree_files copies ${prodKey}, which decrypts production's credentials, into every worker's worktree`, `the owner's change (settings, gate-change): give agents only development and test keys. ${prodKey === 'config/master.key' ? 'Move production secrets to config/credentials/production.yml.enc with its own production.key, kept only on the platform and in the owner\'s shell, then' : 'Then'} drop ${prodKey} from worktree_files (code-style.md §10)`);
  // Spend, for the improvement loop (supervisor.md §9): what costs more than it should.
  if (m.cost.source === 'measured') {
    const pp = (id) => (m.cost.by_ticket[id] ?? 0) / ({ S: 1, M: 2 }[ts.get(id)?.size] ?? 1);
    const merged = [...ts.keys()].filter((id) => mergedAt(id) && m.cost.by_ticket[id] !== undefined).map(pp).sort((a, b) => a - b);
    if (merged.length >= 5) {
      const med = merged[Math.floor(merged.length / 2)];
      for (const id of ts.keys()) {
        const recent = !mergedAt(id) || now - mergedAt(id) < 7 * DAY;
        if (recent && m.cost.by_ticket[id] >= 5 && pp(id) > 2 * med) add('medium', 'costly-ticket', id, `$${m.cost.by_ticket[id].toFixed(2)}, ${(pp(id) / med).toFixed(1)}× the median merged ticket per point ($${med.toFixed(2)})`, 'find where it went (phase_usd, review churn, restarts losing the cache) and try a lever on the next tickets like it (supervisor.md §9)');
      }
    }
    const recentItems = spendItems().filter((x) => x.at >= now - 7 * DAY);
    const inSide = recentItems.reduce((a, x) => a + x.input + x.cache_read + x.cache_write, 0);
    const reads = recentItems.reduce((a, x) => a + x.cache_read, 0);
    if (inSide > 5e6 && reads / inSide < 0.6) add('medium', 'low-cache-hit', 'prompt cache', `${Math.round((100 * reads) / inSide)}% of input tokens were cache reads this week`, 'agents are re-reading context they could keep: fewer restarts, resume instead of re-launch, stable prompt prefixes (supervisor.md §9)');
    const tw = m.cost.per_point_this_week, lw = m.cost.per_point_last_week;
    if (tw && lw && tw.tickets >= 3 && lw.tickets >= 3 && tw.usd_per_point > 1.5 * lw.usd_per_point) add('medium', 'cost-per-point-rising', 'spend', `$${tw.usd_per_point} per merged point this week, $${lw.usd_per_point} last week`, 'find what changed (model, ticket mix, review rounds) and trial a fix (supervisor.md §9)');
  }
  const unpriced = Object.entries(m.cost.unpriced_models ?? {});
  if (unpriced.length) add('low', 'unpriced-model', unpriced.map(([k]) => k).join(', '), `${unpriced.map(([k, n]) => `${k}: ${(n / 1e6).toFixed(1)}M tokens`).join('; ')} with no price, so spend undercounts`, 'the owner adds them to settings.model_prices ($ per million tokens: input, output, cache_read, cache_write)');
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
    gates_configured: Object.keys(settings.gates ?? {}),
    tickets: deriveStatus(),
    critical_path: findCycle(sub) ? [] : criticalPath(sub).path,
    questions: rankQuestions(questions().filter((q) => q.status === 'open')),
    open_messages: msgs.filter((m) => !['info', 'ruling', 'answer'].includes(m.kind) && !replied.has(m.id) && !settledByLanding(m)).map((m) => ({ id: m.id, kind: m.kind, actor: m.created_by, to: m.to, summary: m.text })),
    metrics: collectMetrics(0),
    progress: collectProgress(),
    planners: planners(),
    ooda: collectOoda(),
  };
}
const cmdDashboardData = () => { gitReadCache = new Map(); out(JSON.stringify(dashboardData())); };

// timeline <ticket-id> [--json]: the ticket, and every log line that bears on it (its own edits,
// its worker's phases, gates and messages, questions it raised or that block it, acts and
// observations that name it), oldest first; plus its review records and its files.
function cmdTimeline() {
  gitReadCache = new Map();
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
// The dashboard's own record of why it stopped (run/dashboard.log): a window closes with its
// process, taking the output with it. Starts, signals, server errors and crashes with their stack;
// never a request body (secrets pass through it). Kept under ~1 MB by starting afresh.
function dashboardLogger() {
  const file = path.join(runDir, 'dashboard.log');
  try { if (fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, `${file}.1`); } catch {}
  return (msg) => { try { fs.mkdirSync(runDir, { recursive: true }); fs.appendFileSync(file, `${nowIso()} [${process.pid}] ${msg}\n`); } catch {} };
}
function cmdDashboard() {
  const port = Number(flagStr('port') ?? loadSettings().dashboard_port);
  const host = flagStr('host') ?? '127.0.0.1';
  const log = dashboardLogger();
  process.on('uncaughtException', (e) => { log(`crashed: ${e?.stack ?? e}`); process.stderr.write(`devteam dashboard crashed: ${e?.stack ?? e}\n`); process.exit(1); });
  process.on('unhandledRejection', (e) => { log(`crashed (unhandled rejection): ${e?.stack ?? e}`); process.stderr.write(`devteam dashboard crashed: ${e?.stack ?? e}\n`); process.exit(1); });
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => { log(`stopped by ${sig}`); process.exit(0); });
  const page = path.join(devteamDir, 'dashboard', 'index.html');
  const self = fileURLToPath(import.meta.url);
  const ownerEnv = { ...process.env, DEVTEAM_CHANNEL: 'dashboard' };
  delete ownerEnv.DEVTEAM_ROLE;
  delete ownerEnv.DEVTEAM_TICKET;
  delete ownerEnv.DEVTEAM_FEATURE;
  const run = (args) => new Promise((resolve) => execFile(process.execPath, [self, ...args], { cwd: mainRoot, maxBuffer: 64 * 1024 * 1024, env: ownerEnv }, (err, stdout, stderr) => resolve({ ok: !err, stdout, stderr })));
  const ID = /^[a-z]-\d{8}-\d{9}-[a-z0-9]+(-[a-z0-9]+)*$/;
  const text = (x, max = 4000) => typeof x === 'string' && x.trim() && x.length <= max;
  const autonomyArgs = (b) => ([1, 2, 3].includes(b.autonomy) ? ['--autonomy', String(b.autonomy), ...(text(b.scope, 100) ? ['--scope', b.scope.trim()] : [])] : []);
  const ACTIONS = {
    answer: (b) => {
      if (!ID.test(b.id ?? '') || !text(b.answer)) return null;
      if (b.decline !== undefined && b.decline !== true) return null;
      const args = ['answer', b.id, b.answer.trim(), ...autonomyArgs(b)];
      // "Send it back" on a review: the owner's reason, no result
      if (b.decline === true) return [...args, '--decline'];
      if (text(b.rule, 600)) args.push('--rule', b.rule.trim());
      return args;
    },
    correct: (b) => (ID.test(b.id ?? '') && text(b.reason, 600) ? ['correct', b.id, '--reason', b.reason.trim()] : null),
    'goal-decide': (b) => (ID.test(b.id ?? '') && ['approve', 'refine', 'let-go'].includes(b.verdict) && (b.notes === undefined || text(b.notes, 4000)) ? ['goal', 'decide', b.id, b.verdict, ...(b.notes ? ['--notes', b.notes.trim()] : [])] : null),
    knowledge: (b) => (ID.test(b.id ?? '') && ['accepted', 'retired', 'stale'].includes(b.status) ? ['knowledge', 'set', b.id, '--status', b.status, '--owner'] : null),
    ack: (b) => (/^[a-z][a-z-]*$/.test(b.kind ?? '') && text(b.subject, 200) && text(b.reason, 600) ? ['ack', b.kind, b.subject, '--reason', b.reason.trim(), '--owner'] : null),
  };
  const send = (res, code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
  const server = http.createServer(async (req, res) => {
    // frame-src 'self': a frame of this page (a review page, an HTML mock) may navigate itself, and
    // this keeps it on the dashboard; a sandbox alone would let it load any URL, query string and all.
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "frame-src 'self'" });
      return res.end(fs.readFileSync(page));
    }
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
    const okHost = [`127.0.0.1:${port}`, `localhost:${port}`, `${host}:${port}`].includes(req.headers.host ?? '');
    // A review: what the dashboard's review view loads (the question, its verified files, the
    // owner's draft and stored result), or the result as TSV for the owner's own use.
    if (req.method === 'GET' && u.pathname === '/api/review') {
      const id = u.searchParams.get('id') ?? '';
      if (!ID.test(id)) return send(res, 400, 'application/json', JSON.stringify({ error: 'bad question id' }));
      if (u.searchParams.get('format') === 'tsv') {
        const r = await run(['review', 'result', id, '--tsv']);
        return r.ok ? send(res, 200, 'text/tab-separated-values; charset=utf-8', r.stdout) : send(res, 404, 'application/json', JSON.stringify({ error: r.stderr.trim() }));
      }
      const r = await run(['review', 'show', id, '--json', '--contents']);
      return r.ok ? send(res, 200, 'application/json', r.stdout) : send(res, 404, 'application/json', JSON.stringify({ error: r.stderr.trim().replace(/^devteam: /, '') }));
    }
    // A review page: the agent's bytes, verbatim, only into the dashboard's own sandboxed frame,
    // under a policy that allows no network (reviewPageCsp). Under a question's path the server
    // serves exactly two other files, the kit's helpers; nothing else.
    const rvm = req.method === 'GET' ? /^\/review\/([^/]+)\/([^/]*)$/.exec(u.pathname) : null;
    if (rvm) {
      const [, seg, file] = rvm;
      if (seg !== 'preview' && !ID.test(seg)) return send(res, 404, 'text/plain', 'not found');
      if (file === 'devteam-ui.css' || file === 'devteam-ui.js') {
        res.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        return res.end(fs.readFileSync(path.join(devteamDir, 'dashboard', file)));
      }
      if (file !== '') return send(res, 404, 'text/plain', 'not found');
      // Opened top-level it would be same-origin with the owner API; it is served only into a frame
      // of this page (and its policy makes its origin opaque even then).
      if (!okHost || !['iframe', 'frame'].includes(req.headers['sec-fetch-dest']) || req.headers['sec-fetch-site'] !== 'same-origin') return send(res, 403, 'text/plain; charset=utf-8', 'A review page opens only inside the dashboard: open the Inbox and choose "Open the review".');
      const blob = (spec) => new Promise((resolve) => execFile('git', ['cat-file', 'blob', spec], { cwd: mainRoot, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout)));
      let bytes;
      if (seg === 'preview') {
        // the supervisor's (or an agent's) look at a committed page before anyone asks
        const p = u.searchParams.get('path') ?? '';
        const ref = u.searchParams.get('ref') || mainRef() || 'HEAD';
        if (!REPO_PATH.test(p) || !/\.html?$/i.test(p) || !/^(?!-)[A-Za-z0-9._\/-]+$/.test(ref)) return send(res, 400, 'text/plain', 'bad path or ref');
        bytes = await blob(`${ref}:${p}`);
        if (!bytes) return send(res, 404, 'text/plain', `not found: ${p} at ${ref}`);
      } else {
        const r = await run(['review', 'show', seg, '--json']);
        if (!r.ok) return send(res, 404, 'text/plain', `not a review question: ${seg}`);
        const shown = JSON.parse(r.stdout);
        const rv = shown.review;
        if (!shown.reachable || shown.files.some((f) => f.status === 'missing')) return send(res, 404, 'text/plain', `the page's commit ${String(rv.commit).slice(0, 12)} is gone; nothing can be answered on it`);
        if (shown.files.some((f) => f.status === 'tampered')) return send(res, 403, 'text/plain', 'the page or its data no longer hash to the question; it is not the page the supervisor asked on');
        bytes = await blob(`${rv.commit}:${rv.page.path}`);
        if (!bytes) return send(res, 404, 'text/plain', 'the page is gone');
        if (sha256(bytes) !== rv.page.sha256) return send(res, 403, 'text/plain', 'the page no longer hashes to the question');
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': reviewPageCsp(`http://${req.headers.host}`), 'referrer-policy': 'no-referrer', 'x-dns-prefetch-control': 'off' });
      return res.end(bytes);
    }
    const name = req.method === 'POST' && u.pathname.startsWith('/api/') ? u.pathname.slice(5) : null;
    const isSecret = name === 'secret';
    const isReview = name === 'review-draft' || name === 'review-answer';
    const action = name && Object.hasOwn(ACTIONS, name) ? ACTIONS[name] : null;
    if (!action && !isSecret && !isReview) return send(res, 404, 'text/plain', 'not found');
    const site = req.headers['sec-fetch-site'];
    const origin = req.headers.origin;
    // A browser always sends both on a fetch POST; a secret or a review is accepted only with both
    // present. A sandboxed frame's request says Origin: null and is refused here too.
    const strict = isSecret || isReview;
    const sameOrigin = strict ? site === 'same-origin' && origin === `http://${req.headers.host}` : (!site || site === 'same-origin') && (!origin || origin === `http://${req.headers.host}`);
    if (!okHost || !sameOrigin || !(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 403, 'application/json', JSON.stringify({ error: 'owner actions only from this page' }));
    // A review's result or draft is up to 4 MB, plus its envelope.
    const cap = isSecret ? 4 * 1024 * 1024 : isReview ? REVIEW_MAX + 64 * 1024 : 20000;
    // Bytes first, decoded once: a multibyte character split across chunks stays whole.
    const chunks = [];
    let size = 0;
    let body = '';
    let over = false;
    req.on('data', (c) => {
      size += c.length;
      if (size <= cap) return void chunks.push(c);
      over = true;
      chunks.length = 0;
      // a review body over the cap is drained and refused with a reason; one far over it is cut off
      if (!isReview || size > 4 * cap) req.destroy();
    });
    req.on('end', () => { const buf = Buffer.concat(chunks); body = buf.toString('utf8'); buf.fill(0); chunks.length = 0; });
    // The owner's own process, with the body on its stdin (never in argv or the server's output).
    const ownerChild = (args, input) => {
      const child = spawn(process.execPath, [self, ...args], { cwd: mainRoot, env: ownerEnv, stdio: ['pipe', 'pipe', 'pipe'] });
      let so = '';
      let se = '';
      let replied = false;
      const reply = (code, payload) => { if (!replied) { replied = true; send(res, code, 'application/json', JSON.stringify(payload)); } };
      child.stdin.on('error', () => {});
      child.on('error', (e) => reply(500, { error: e.message }));
      child.stdout.on('data', (c) => { so += c; });
      child.stderr.on('data', (c) => { se += c; });
      child.on('close', (code) => reply(code === 0 ? 200 : 400, code === 0 ? { ok: true, out: so.trim() } : { error: se.split('\n').filter((l) => l && !l.startsWith('devteam: warning:')).join(' ').replace(/^devteam: /, '') || 'failed', out: so.trim() }));
      child.stdin.end(input);
    };
    if (isSecret) {
      // The values go to a child on stdin; the child pipes each to its sink (secret post --json)
      // and logs only names.
      return req.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(body || '{}'); } catch { return send(res, 400, 'application/json', JSON.stringify({ error: 'bad json' })); }
        body = '';
        if (!ID.test(parsed.id ?? '') || typeof parsed.values !== 'object' || !parsed.values) return send(res, 400, 'application/json', JSON.stringify({ error: 'missing or invalid fields' }));
        ownerChild(['secret', 'post', parsed.id, '--json'], JSON.stringify(parsed.values));
        parsed = null;
      });
    }
    if (isReview) {
      return req.on('end', () => {
        if (over) return send(res, 400, 'application/json', JSON.stringify({ error: `the body is over ${cap} bytes; a review result or draft is at most ${REVIEW_MAX} (4 MB)` }));
        let parsed;
        try { parsed = JSON.parse(body || '{}'); } catch { return send(res, 400, 'application/json', JSON.stringify({ error: 'bad json' })); }
        body = '';
        if (!ID.test(parsed.id ?? '')) return send(res, 400, 'application/json', JSON.stringify({ error: 'missing or invalid fields' }));
        if (name === 'review-draft') {
          if (parsed.state === undefined) return send(res, 400, 'application/json', JSON.stringify({ error: 'a draft has a state' }));
          const savedAt = typeof parsed.saved_at === 'string' && !Number.isNaN(Date.parse(parsed.saved_at)) ? parsed.saved_at : nowIso();
          return ownerChild(['review', 'draft', parsed.id, '-'], JSON.stringify({ state: parsed.state, saved_at: savedAt }));
        }
        // The answer is the object the owner's preview rendered: its JSON text is hashed in the page
        // and here, and the owner's process reads exactly those bytes.
        if (!isObj(parsed.result) || !/^[0-9a-f]{64}$/.test(parsed.sha256 ?? '')) return send(res, 400, 'application/json', JSON.stringify({ error: 'missing or invalid fields: { id, result, sha256 }' }));
        const textOut = JSON.stringify(parsed.result);
        if (sha256(Buffer.from(textOut)) !== parsed.sha256) return send(res, 400, 'application/json', JSON.stringify({ error: 'the result is not the one the preview showed (its sha256 differs); nothing was answered' }));
        ownerChild(['answer', parsed.id, '--review-result', '-', ...autonomyArgs(parsed)], textOut);
      });
    }
    req.on('end', async () => {
      let parsed;
      try { parsed = JSON.parse(body || '{}'); } catch { return send(res, 400, 'application/json', JSON.stringify({ error: 'bad json' })); }
      const args = action(parsed);
      if (!args) return send(res, 400, 'application/json', JSON.stringify({ error: 'missing or invalid fields' }));
      const r = await run(args);
      send(res, r.ok ? 200 : 400, 'application/json', JSON.stringify(r.ok ? { ok: true, out: r.stdout.trim() } : { error: r.stderr.split('\n').filter((l) => l && !l.startsWith('devteam: warning:')).join(' ').replace(/^devteam: /, '') }));
    });
  });
  server.on('error', (e) => { log(`server error: ${e?.stack ?? e}`); process.stderr.write(`devteam dashboard: ${e.message}\n`); process.exit(1); });
  server.listen(port, host, () => { log(`started on http://${host}:${port} (node ${process.version})`); out(`devteam dashboard on http://${host}:${port}`); });
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
  const p = role === 'planner' && positional[1] ? plannerPrompt(positional[1]) : PROMPTS[role].replace(/\{\{ID\}\}/g, positional[1] ?? '');
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
// Each delivery is recorded per window, so a lost Enter can be pressed later (resendLostEnter).
const typeInto = (target, line) => { const ok = tmux(['send-keys', '-t', target, '-l', line]) && tmux(['send-keys', '-t', target, 'Enter']); if (ok) recordSent(target, line); return ok; };
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
// A request is settled when the work it is about has landed: a ticket's once it merged, a
// planner's once its plan file is on main, a ticket's review request once it was approved. The
// merge or the approval is the answer even if nobody replied.
function settledByLanding(m) {
  const by = m.created_by ?? m.by;
  if (!by) return false;
  const cls = writerClass(by);
  if (cls === 'ticket' && mergeShaFor(by)) return true;
  // A review request is answered by the approval it asked for: an approve-spec or approve-plan act
  // on the ticket logged after it, whether or not a reply cites the request.
  if (cls === 'ticket' && m.kind === 'review-request') return logObjects('act').some((a) => ['approve-spec', 'approve-plan'].includes(a.class) && (a.refs ?? [])[0] === by && a.created_at > m.created_at);
  if (cls === 'ticket') return false;
  if (cls === 'planner') return !!mainRef() && git(['cat-file', '-e', `${mainRef()}:${projectRel}/log/${by}.jsonl`]) !== null;
  return false;
}
function cmdMessages() {
  const me = flagStr('to') ?? myAddress();
  const all = logObjects('message').sort(byTime);
  const replied = new Set(all.map((m) => m.re).filter(Boolean));
  let mine = all.filter((m) => m.to === me);
  if (flags.open) mine = mine.filter((m) => !replied.has(m.id) && !['info', 'ruling', 'answer'].includes(m.kind) && !settledByLanding(m));
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
  // A gate's name is a short word (test, lint, model-size): a stray shell expansion once recorded
  // node's help text as hundreds of "gates".
  if (!GATE_NAME.test(name)) die(`gate name "${name.slice(0, 60)}" must be a short lowercase word or words joined by hyphens (test, lint, model-size)`);
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

// --- ticket number blocks ---
//
// Planners run in parallel, each on its own branch, so none can see the numbers the others take.
// `planner <feature>` reserves a block of ticket numbers for the feature (an id_block on the act
// that made it) above every number on main, in another planner's graph, and in every earlier block;
// the planner numbers its tickets from it. Numbers are counted across components, so a block is
// free whatever components the feature touches.
const ID_BLOCK_DEFAULT = 20;
// The NN of <component>-NN-<slug>, or null.
function ticketNumber(id, component) {
  const m = component && id.startsWith(`${component}-`) ? id.slice(component.length + 1).match(/^(\d{2,})-/) : id.match(/-(\d{2,})-/);
  return m ? Number(m[1]) : null;
}
const padNN = (n) => String(n).padStart(2, '0');
const idBlocks = () => logObjects('act').filter((a) => a.id_block).sort(byTime).map((a) => a.id_block);
const idBlockFor = (feature) => idBlocks().filter((b) => b.feature === feature).pop() ?? null;
// The ticket lines (op new) of every plan branch in flight, or of one: its worktree's plan file,
// else the branch's.
function inFlightPlanTickets(only = null) {
  const branches = only ? [only] : (git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/plan/']) ?? '').split('\n').filter(Boolean);
  return branches.flatMap((b) => {
    const by = `plan-${b.slice('plan/'.length)}`;
    const text = readText(path.join(mainRoot, '.worktrees', by, projectRel, 'log', `${by}.jsonl`)) ?? git(['show', `${b}:${projectRel}/log/${by}.jsonl`]) ?? '';
    return text.split('\n').filter(Boolean).map((t) => { try { return JSON.parse(t); } catch { return null; } }).filter((o) => o?.type === 'ticket' && o.op === 'new' && typeof o.id === 'string');
  });
}
function reserveIdBlock(feature, size) {
  const used = [
    ...[...tickets().values()].map((t) => ticketNumber(t.id, t.component)),
    ...inFlightPlanTickets().map((t) => ticketNumber(t.id, t.component)),
    ...idBlocks().map((b) => b.to),
  ].filter((n) => Number.isInteger(n));
  const from = Math.max(0, ...used) + 1;
  return { feature, from, to: from + size - 1 };
}
const idBlockText = (b) => `Your ticket numbers: ${padNN(b.from)} to ${padNN(b.to)}, reserved for this feature (other planners number in parallel). Number every ticket <component>-NN-<slug> with NN in that block, in order; if you need more, ask the supervisor for another block rather than going past it.`;
const plannerPrompt = (feature) => {
  const b = idBlockFor(feature);
  return `${PROMPTS.planner.replace(/\{\{ID\}\}/g, feature)}${b ? ` ${idBlockText(b)}` : ''}`;
};

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
  const blockSize = flagNum('id-block') ?? ID_BLOCK_DEFAULT;
  if (role === 'planner' && !(Number.isInteger(blockSize) && blockSize >= 1)) die('--id-block takes a whole number of ticket numbers to reserve (at least 1)');
  const name = role === 'worker' ? id : `plan-${id}`;
  const branch = role === 'worker' ? `ticket/${id}` : `plan/${id}`;
  const wt = path.join(mainRoot, '.worktrees', name);
  fs.mkdirSync(path.join(runDir, 'prompts'), { recursive: true });
  // A planner gets a block of ticket numbers before it numbers anything; one that has a block keeps
  // it, and one that numbered tickets before blocks existed gets none (nothing to check it against).
  const block = role === 'planner' && !idBlockFor(id) && !inFlightPlanTickets(branch).length ? reserveIdBlock(id, blockSize) : null;
  if (!fs.existsSync(wt)) {
    git(['fetch', '--quiet', 'origin', s.main_branch]);
    const base = resolveCommit(`origin/${s.main_branch}`) ? `origin/${s.main_branch}` : s.main_branch;
    if (resolveCommit(`refs/heads/${branch}`)) gitOrDie(['worktree', 'add', '--quiet', wt, branch], mainRoot);
    else gitOrDie(['worktree', 'add', '--quiet', '-b', branch, wt, base], mainRoot);
  }
  seedWorktree(wt);
  const promptFile = path.join(runDir, 'prompts', `${name}.txt`);
  const knowledge = knowledgeBlock(id);
  const held = block ?? (role === 'planner' ? idBlockFor(id) : null);
  const text = `${PROMPTS[role].replace(/\{\{ID\}\}/g, id)}${held ? ` ${idBlockText(held)}` : ''}`;
  fs.writeFileSync(promptFile, `${text}${knowledge ? `\n\n${knowledge}` : ''}\n`);
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
  appendLog({ type: 'act', class: 'worker-slots', what: `${resume ? 'resumed' : 'made'} ${role} ${name} in ${target}${block ? `, ticket numbers ${padNN(block.from)}-${padNN(block.to)}` : ''}`, refs: role === 'worker' ? [id] : [], reversible: true, id_block: block ?? undefined }, 'supervisor');
  out(`${resume ? 'resumed' : 'made'} ${role} ${name} in ${target} at ${wt}${block ? `; ticket numbers ${padNN(block.from)}-${padNN(block.to)} reserved` : ''}`);
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
        with:
          fetch-depth: 0
          ref: \${{ github.event.pull_request.head.sha }}
      - uses: actions/setup-node@v4
        with:
          node-version: 22
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
  worker <ticket-id> [--resume] | planner <feature> [--resume] [--id-block <n>]   supervisor: a worktree, a tmux window and an agent for a ticket or a feature plan (a new planner reserves n ticket numbers, default 20)
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
  review-worktree <ticket-id> <sha> [--name suffix] | review-worktree --remove <path>   a final reviewer's detached worktree at exactly that sha, seeded like a worker's

Sessions (worker.md)
  phase <to> [--task t] [--note n] [--usd x --in n --out n]   phase change or liveness ping; phase supervisor --usd x
  gate <name> [--junit f] -- <cmd…>   run a gate and record it   |   gate --all: every settings gate here
  send <to> "<text>" [--kind k] [--re m-…] [--sha s] [--owner] | messages [--open] [--to x] [--json]
  stop-ok                         for a stop hook: refuses while the last commit is newer than the last phase line

Decide and act (supervisor.md, constitution.md)
  ask --question q [--kind k] [--class c] [--reasons r…] [--recommendation r] [--confidence 0-1] [--default d] [--choices '[{"label","detail","effect"}…]'] [--rule-scope s] [--goal g-… (goal-approval)] [--links '[{"title","path","ref"}|{"title","url"}…]'] [--blocks ids] [--evidence ids] [--ticket id] [--re m-…] [--note path] [--secrets '[{"name","kind":"string|file","sink"}…]' (owner-action)]
  secret post <qid> [--file NAME=path] [--json]                          owner: post a question's secrets straight to their sinks; never logged (secret sinks lists them)
  ask --kind review --page <repo path> --ref <branch|sha> [--data <repo path>] [--result-schema <repo path>] [--allow-partial] --question q [--context c] [--class c] [--reasons r…] [--ticket id] [--blocks ids] [--re m-…]
                                  supervisor: an agent-drawn page for rows the owner decides; pins page, data and result schema to a commit and their sha256s
  review check <page.html> [--data d.json] [--result-schema s.json] [--json]   anyone: the static checks ask runs, with line numbers
  review show <qid> [--json [--contents]]   the pinned files and the result's status: verified, missing, tampered or declined (--contents adds the verified data, draft and result)
  review result <qid> [--json|--tsv]   the owner's result, once every hash verifies (exit 1 otherwise)
  review verify <qid> --applied <file>   rows applied ([{ "id", "values", "evidence" }]) vs rows the owner decided; exit 1 on any difference
  review draft <qid> [<file|->]   owner: save partial progress; without a file, print it (a draft is never an answer)
  answer <qid> --review-result <file|-> | answer <qid> "<why>" --decline   (owner) a review: validate and hash its result, or send it back
  answer <qid> "<text>" [--autonomy 1|2|3 [--scope s]] [--rule "<standing rule>"]   (owner)   |   answer <qid> "<text>" --from-chat --said "<owner's words>" | answer <qid> --defaulted   (supervisor)
  withdraw <qid> [--reason r] | questions [--all] [--id q] [--json]
  act --class c [--scope s] [--approved qid] [--refs ids] [--irreversible] -- "<what>"
  correct <act-id> --reason r [--severity n]   (owner; --retro for the supervisor) | repair <act-id> --how undo|fix-ticket|none
  trust [--json]                  the ladder: rung, ceiling, agreement, corrections per class

Observe and orient
  observe --subject s --kind k --detail d [--severity 0-4] [--valence -2..2] [--key k] [--refs ids] [--fix f] [--value n --unit u]
  observe-metrics | observe-spend | orient [--json] | metrics [--since date] [--json]   (observe-metrics records spend lines too)
  ack <finding-kind> <subject> --reason r [--owner]   set a finding aside for finding_ack_hours
  timeline <ticket-id> [--json]   the ticket and every log line, review and file that bears on it
  knowledge [--status s] [--kind k] | knowledge --for <ticket|feature|class> | knowledge add|set …
  problem [--all] | problem add --title t --severity n [--risk] [--threatens g…] | problem set <id> …

Goals and retros
  goal [list|check|show|forecast|add|set|decide|approve|status|reading] …
  goal set <g-id> --approved <qid> …   supervisor: apply an answered goal-change question to a goal past draft (one set per answer)
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
  'check-ticket': cmdCheckTicket, 'check-pr': cmdCheckPr, merge: cmdMerge, 'review-worktree': cmdReviewWorktree,
  phase: cmdPhase, gate: cmdGate, send: cmdSend, messages: cmdMessages, 'stop-ok': cmdStopOk,
  ask: cmdAsk, answer: cmdAnswer, review: cmdReview, secret: cmdSecret, withdraw: cmdWithdraw, questions: cmdQuestions, act: cmdAct, correct: cmdCorrect, repair: cmdRepair, trust: cmdTrust,
  observe: cmdObserve, 'observe-metrics': cmdObserveMetrics, 'observe-spend': cmdObserveSpend, orient: cmdOrient, metrics: cmdMetrics, ack: cmdAck, timeline: cmdTimeline, knowledge: cmdKnowledge, problem: cmdProblem,
  goal: cmdGoal, retro: cmdRetro, chore: cmdChore,
  log: cmdLog, 'log-check': cmdLogCheck, 'log-sync': cmdLogSync, history: cmdHistory,
  dashboard: cmdDashboard, 'dashboard-data': cmdDashboardData, notes: cmdNotes,
};
if (!command || command === 'help' || command === '--help') out(HELP);
else if (!COMMANDS[command]) die(`unknown command "${command}"\n${HELP}`);
else COMMANDS[command]();
