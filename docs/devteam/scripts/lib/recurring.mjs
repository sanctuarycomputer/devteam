/* imports start */
import fs from 'node:fs';
import path from 'node:path';
import { CHORES } from './settings.mjs';
import { CREDENTIALS_REFUSED } from './links.mjs';
import { HOME_CWD } from './base.mjs';
import { RECURRING_ENTRY_SHAPE } from './host.mjs';
import { SCHEMA } from './log.mjs';
import { SCRUB_RULES } from './sensors.mjs';
import { UNSAFE_TEXT } from './links.mjs';
import { appendLog } from './log-sync.mjs';
import { byTime } from './log-sync.mjs';
import { canonical } from './settings.mjs';
import { choreWorktree } from './goals.mjs';
import { citing } from './questions.mjs';
import { dateOnly } from './base.mjs';
import { die } from './base.mjs';
import { flagStr } from './base.mjs';
import { flags } from './base.mjs';
import { git } from './base.mjs';
import { goalMode } from './holds.mjs';
import { hasCredentials } from './links.mjs';
import { here } from './state.mjs';
import { holdWords } from './holds.mjs';
import { integrity } from './log.mjs';
import { isObj } from './artifact-notes.mjs';
import { json } from './base.mjs';
import { jsonDepth } from './settings.mjs';
import { jsonDuplicateKeys } from './settings.mjs';
import { listFlag } from './base.mjs';
import { loadSettings } from './settings.mjs';
import { logCache } from './log-sync.mjs';
import { logGet } from './log-sync.mjs';
import { logObjects } from './log-sync.mjs';
import { mainRef } from './log.mjs';
import { mainRefCache } from './log.mjs';
import { mainRoot } from './state.mjs';
import { mainSha } from './log.mjs';
import { mainShaCache } from './log.mjs';
import { mergedAt } from './repos.mjs';
import { nowIso } from './base.mjs';
import { out } from './base.mjs';
import { ownerAnswer } from './world-model.mjs';
import { positional } from './base.mjs';
import { projectInRepo } from './settings.mjs';
import { projectRel } from './settings.mjs';
import { projectRoot } from './settings.mjs';
import { questionView } from './log-sync.mjs';
import { questions } from './log-sync.mjs';
import { readLog } from './log-sync.mjs';
import { realPath } from './state.mjs';
import { recurringChores } from './chores.mjs';
import { recurringFailures } from './chores.mjs';
import { recurringLock } from './chores.mjs';
import { recurringRunDue } from './chores.mjs';
import { runDir } from './state.mjs';
import { schemaErrors } from './log.mjs';
import { scrubExtra } from './sensors.mjs';
import { slug } from './base.mjs';
import { spawnSync } from 'node:child_process';
import { supervisorOnly } from './log.mjs';
import { timedOut } from './box-pins.mjs';
import { upkeepOrVirtual } from './holds.mjs';
import { warn } from './base.mjs';
/* imports end */
// What is wrong with one job, each problem naming the entry and field ("recurring.json <name>.<field>: …",
// prefix the jobs file's name unless a caller gives its own), empty when it holds. It reads no log
// and no other setting but sensor_scrub (a run its patterns would scrub is refused), so any reader
// can check any entry.
export function recurringEntryProblems(name, entry, prefix = 'recurring.json') {
  const R = RECURRING_ENTRY_SHAPE;
  const UNITS = Object.keys(R.every_max); // h, d, w, mo: shortest first
  // a whole environment reference: $NAME or ${NAME} (never ${X:-default} or ${X}more), after any scheme word
  const REF = /(?:\b(?:bearer|basic|token)\s+)?\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})(?=$|[\s"';&|)])/gi;
  const SCRUB_ALLOWED = ['[ip]', '[phone]', '[email]'];
  const at = `${prefix} ${name}`;
  const [lo, hi] = R.name_length;
  if (typeof name !== 'string' || !R.name.test(name) || name.length < lo || name.length > hi) return [`${at}: a name is ${lo} to ${hi} lowercase letters and digits, in words joined by single hyphens (it becomes a chore slug and a ticket id)`];
  if (!isObj(entry)) return [`${at}: an object { kind, title, what, every, … }`];
  const errs = [];
  const bad = (f, m) => errs.push(`${at}.${f}: ${m}`);
  const kind = entry.kind;
  if (!R.kinds.includes(kind)) return [`${at}.kind: check or chore`];
  for (const [f, spec] of Object.entries(R.fields)) {
    const carried = spec.kinds.includes(kind) && (!spec.by || entry.by === spec.by);
    if (!carried && entry[f] !== undefined) bad(f, spec.kinds.includes(kind) ? `only a chore with by "${spec.by}" has ${f}` : `a ${spec.kinds[0]}'s field, not a ${kind}'s`);
    else if (carried && spec.required && entry[f] === undefined) bad(f, 'required');
  }
  for (const f of Object.keys(entry)) if (!Object.hasOwn(R.fields, f)) bad(f, 'not a field of a job');
  const has = (f) => entry[f] !== undefined && R.fields[f].kinds.includes(kind) && (!R.fields[f].by || entry.by === R.fields[f].by);
  const whole = (f, lo2, hi2) => { if (has(f) && !(Number.isInteger(entry[f]) && entry[f] >= lo2 && entry[f] <= hi2)) bad(f, `a whole number from ${lo2} to ${hi2}`); };
  for (const f of ['title', 'what']) if (has(f) && (typeof entry[f] !== 'string' || !entry[f].length || entry[f].length > R.fields[f].max || UNSAFE_TEXT.test(entry[f]))) bad(f, `one line of 1 to ${R.fields[f].max} characters`);
  let unit = null;
  if (has('every')) {
    const m = typeof entry.every === 'string' ? R.every.exec(entry.every) : null;
    if (!m) bad('every', '<n>h, <n>d, <n>w or <n>mo');
    else if (UNITS.indexOf(m[2]) < UNITS.indexOf(R.every_min[kind])) bad('every', 'a chore runs at most daily: <n>d, <n>w or <n>mo');
    else if (Number(m[1]) > R.every_max[m[2]]) bad('every', `at most ${R.every_max.d}d, ${R.every_max.w}w or ${R.every_max.mo}mo (${R.every_max.h}h)`);
    else unit = m[2];
  }
  if (has('on') && unit) {
    if (unit === 'w') { if (!R.weekdays.includes(entry.on)) bad('on', `with w, a weekday: ${R.weekdays.join(', ')}`); }
    else if (unit === 'mo') { if (!(Number.isInteger(entry.on) && entry.on >= 1 && entry.on <= R.month_day_max)) bad('on', `with mo, a day of the month from 1 to ${R.month_day_max}, a number`); }
    else bad('on', 'goes with w (a weekday) or mo (a day of the month), not h or d');
  }
  if (has('at')) {
    if (typeof entry.at !== 'string' || !R.at.test(entry.at)) bad('at', 'HH:MM, UTC');
    else if (unit === 'h') bad('at', 'goes with d, w or mo, not h');
  }
  if (has('run')) {
    const r = entry.run;
    if (typeof r !== 'string' || !r.length || r.length > R.fields.run.max || UNSAFE_TEXT.test(r)) bad('run', `one line of 1 to ${R.fields.run.max} characters`);
    else {
      // Each whole reference becomes one plain word (VAR), and a quote right after one joins what
      // follows to it, as the shell joins $X"abc" into one value. Every built-in scrub rule then runs
      // as scrubText runs them, and a value a rule would hide must be references alone (or a host, a
      // phone number or an email): a literal glued, quoted or spaced after a reference hides as much
      // as one with no reference. A second reading joins the words inside each quoted string, so a
      // header or a JSON value ("Authorization: Bearer $X abc…") is judged whole. What an owner's
      // sensor_scrub pattern would hide is refused whenever it matches at all, whatever it writes.
      const VAR = 'zzvarzzz';
      const glue = (t) => t.replace(new RegExp(`${VAR}["']`, 'g'), VAR);
      const named = r.replace(REF, VAR);
      const hidden = new Set();
      for (const text of [glue(named), glue(named.replace(/"[^"]*"|'[^']*'/g, (q) => q.replace(/\s+/g, '_')))]) {
        let t = text;
        for (const [re, to] of [...SCRUB_RULES, ...SCRUB_RULES]) {
          t = t.replace(re, (...a) => {
            const m = a[0];
            const out = typeof to === 'function' ? to(...a) : to.replace(/\$(\d)/g, (_, i) => a[Number(i)] ?? '');
            if (out === m) return m;
            let p = 0;
            while (p < m.length && p < out.length && m[p] === out[p]) p++;
            let s = 0;
            while (s < m.length - p && s < out.length - p && m[m.length - 1 - s] === out[out.length - 1 - s]) s++;
            const literal = m.slice(p, m.length - s).split(VAR).join('').replace(/["'\s_]/g, '');
            if (literal) for (const x of out.slice(p, out.length - s).match(/\[[a-z-]+\]/g) ?? ['[scrubbed]']) if (!SCRUB_ALLOWED.includes(x)) hidden.add(x);
            return out;
          });
        }
      }
      if (scrubExtra().some(([re]) => new RegExp(re.source, re.flags.replace('g', '')).test(named))) hidden.add('sensor_scrub');
      if (r.split(/\s+/).some((w) => hasCredentials(w.replace(/^(["'])(.*)\1$/, '$2'))) || hidden.size) bad('run', `it carries a credential${hidden.size ? ` (${[...hidden].join(', ')})` : ''}; ${CREDENTIALS_REFUSED}. A check runs with the supervisor's environment: name a secret by reference ($NAME), never by value`);
    }
  }
  whole('timeout_s', 1, R.fields.timeout_s.max);
  if (has('fail')) {
    const f = entry.fail;
    const one = (o) => isObj(o) && Object.keys(o).length === 1;
    const rule = one(f) && f.last_line !== undefined && one(f.last_line) ? Object.entries(f.last_line)[0] : null;
    const ok = (one(f) && f.exit === 'nonzero') || (rule && ((['above', 'below'].includes(rule[0]) && typeof rule[1] === 'number' && Number.isFinite(rule[1])) || (rule[0] === 'is_not' && typeof rule[1] === 'string' && rule[1].length >= 1 && rule[1].length <= 200 && !UNSAFE_TEXT.test(rule[1]))));
    if (!ok) bad('fail', '{ "exit": "nonzero" }, or { "last_line": { "above": n } }, { "below": n } or { "is_not": "<text, at most 200 characters>" }');
  }
  whole('fail_after', 1, R.fields.fail_after.max);
  whole('severity', 1, R.fields.severity.max);
  if (has('by') && !R.by.includes(entry.by)) bad('by', R.by.join(' or '));
  if (has('prompt') && (typeof entry.prompt !== 'string' || !entry.prompt.length || entry.prompt.length > R.fields.prompt.max || UNSAFE_TEXT.test(entry.prompt.replace(/[\n\t]/g, '')))) bad('prompt', `1 to ${R.fields.prompt.max} characters: text, line breaks and tabs`);
  for (const f of ['component', 'touches', 'done_when']) if (has(f)) for (const e of schemaErrors(SCHEMA.$defs.types.ticket.properties[f], entry[f], f)) bad(f, `as ticket add checks it: ${e}`);
  whole('grace_days', 1, R.fields.grace_days.max);
  return errs;
}

// The jobs file's helpers (kit-162), which ask and validate share now, and check-pr, merge and
// recurring build on: where the file is (path, parents), the jobs it holds at a commit (read) or in
// this checkout (readWorking), the cap on runs a day, and the recurring-edit questions as they bear
// on asking and landing. A question is landed once an act cites it (approved_by), superseded once a
// later recurring-edit question names any of its names, and live (it can approve) when the owner
// answered it as recommended (matched, read here directly, never through ownerAnswer) and it is
// neither landed nor superseded. Later readers take the jobs only through read(ref).
export const recurringRegistry = Object.freeze({
  CAP: 100,
  HEADER: 'This answer approves exactly these job changes, and no other:',
  // the jobs file, relative to the repo root, as settings.md is read: it follows --project and DEVTEAM_PROJECT
  path: () => `${projectRel}/recurring.json`,
  // each directory from the repo root down to the file's (docs, docs/devteam, docs/devteam/project by default)
  parents: () => projectRel.split('/').map((_, i, a) => a.slice(0, i + 1).join('/')),
  // settings.md holding the jobs, as validate and check-pr refuse it
  inSettings: () => `settings.md has "recurring": the jobs live in ${recurringRegistry.path()}; move them there (it lands with a recurring-edit answer, as any job change does)`,
  // git, bounded: every call the registry makes has a timeout and is killed at it; { status, out,
  // err, timedOut, ok }. A timeout or a failure is never read as an answer. encoding null gives
  // out as a Buffer (the bytes git printed). Tests shorten it with DEVTEAM_GIT_TIMEOUT_MS;
  // production uses 120 s, for recurringRegistry.git only (other git calls have no such bound).
  // overflow: git printed more than maxBuffer and node killed it, told apart from a timeout (final-11b F2)
  git(args, { cwd = HOME_CWD, env, encoding = 'utf8' } = {}) {
    const r = spawnSync('git', args, { cwd, env: env ? { ...process.env, ...env } : process.env, encoding: encoding ?? 'buffer', timeout: Number(process.env.DEVTEAM_GIT_TIMEOUT_MS) || 120000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    const overflow = r.error?.code === 'ENOBUFS';
    const timedOut = !overflow && (r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGKILL');
    return { status: r.status, out: r.stdout ?? (encoding === null ? Buffer.alloc(0) : ''), err: String(r.stderr ?? ''), timedOut, overflow, ok: r.status === 0 && !timedOut && !overflow };
  },
  // what went wrong with a git call, in words
  why: (r) => (r.timedOut ? 'timed out' : r.overflow ? 'printed more than the 64 MiB the kit reads' : 'failed'),
  // No jobs file needs more than this: a file over it is a read problem, never read (final-11b F2).
  // DEVTEAM_RECURRING_MAX_BYTES only for tests.
  MAX_BYTES: 1024 * 1024,
  // The file's text as jobs: a JSON object with no key twice in one object, at any depth. where is
  // "at <ref12>" or "in this checkout".
  // No job needs more than DEPTH levels of nesting, and a file past it is a problem, never read on:
  // every reader after this one (canonical, the shape checks) walks the jobs recursively. Any throw
  // here is a problem too, so a main file that breaks the reader reads as {} with the warning and
  // never blocks a merge (final-10b F1).
  DEPTH: 64,
  parse(text, where) {
    try { return recurringRegistry.parseOrThrow(text, where); } catch (e) { return { jobs: null, problem: `recurring.json ${where}: the kit can't read it (${String(e?.message ?? e).slice(0, 200)})` }; }
  },
  parseOrThrow(text, where) {
    let v;
    try { v = JSON.parse(text); } catch (e) { return { jobs: null, problem: `recurring.json ${where}: not a JSON object (${e.message})` }; }
    if (!isObj(v)) return { jobs: null, problem: `recurring.json ${where}: not a JSON object (${v === null ? 'null' : Array.isArray(v) ? 'an array' : `a ${typeof v}`})` };
    if (jsonDepth(text) > recurringRegistry.DEPTH) return { jobs: null, problem: `recurring.json ${where}: nested deeper than ${recurringRegistry.DEPTH} levels; no job needs that` };
    const dup = (jsonDuplicateKeys(text) ?? [])[0];
    if (dup) return { jobs: null, problem: `recurring.json: ${JSON.stringify(String(dup.at(-1)))} appears twice in one object (${dup.join('.')}): JSON keeps only the last, so the file would say one thing and the kit read another` };
    return { jobs: v, problem: null };
  },
  // The jobs at a commit, as { jobs, problem }: {} when the file is absent. Each parent must be a
  // tree there (a symlink, a file or a gitlink in its place is a problem; a missing one means no
  // file), and the file, read from its directory's tree object (cat-file -p), a 100644 blob. A
  // git call that fails or times out is a problem marked failed: it never reads as no jobs, nor as
  // a broken file. A problem with the file carries entry, the path, mode and object git holds
  // there, so landing can tell main's broken file left as it is. A project dir outside the repo
  // has no file in git: {}.
  read(ref) {
    if (!ref || !projectInRepo) return { jobs: {}, problem: null };
    const g = recurringRegistry.git;
    const c = g(['rev-parse', '--verify', '-q', `${ref}^{commit}`]);
    const sha = c.ok ? c.out.trim() : '';
    if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) return { jobs: null, problem: `recurring.json at ${ref}: git can't read that commit${c.timedOut ? ' (timed out)' : ''}, so neither can the kit read its jobs`, failed: true };
    const where = `at ${sha.slice(0, 12)}`;
    // the entry named name in the tree at dir ('' for the root): { mode, type, oid }, null when absent, or { failed }
    // (core.quotePath=false prints a non-ASCII name as it is; a name git still quotes, one with a
    // quote, a backslash or a control character, starts with " and matches no segment of the path)
    const entry = (dir, name) => {
      const r = g(['-c', 'core.quotePath=false', 'cat-file', '-p', `${sha}:${dir}`]);
      if (!r.ok) return { failed: true, timedOut: r.timedOut, overflow: r.overflow };
      for (const rec of r.out.split('\n')) {
        const tab = rec.indexOf('\t');
        if (tab > 0 && rec.slice(tab + 1) === name) { const [mode, type, oid] = rec.slice(0, tab).split(' '); return { mode, type, oid }; }
      }
      return null;
    };
    const cant = (e) => ({ jobs: null, problem: `recurring.json ${where}: git cat-file ${recurringRegistry.why(e)}, so the kit can't read the jobs`, failed: true });
    const at = (rel, e) => `${rel}\0${e.mode}\0${e.type}\0${e.oid}`;
    let up = '';
    for (const dir of recurringRegistry.parents()) {
      const e = entry(up, path.posix.basename(dir));
      if (e?.failed) return cant(e);
      if (!e) return { jobs: {}, problem: null };
      if (e.type !== 'tree') return { jobs: null, problem: `recurring.json ${where}: ${dir} is not a directory`, entry: at(dir, e) };
      up = dir;
    }
    const f = entry(up, 'recurring.json');
    if (f?.failed) return cant(f);
    if (!f) return { jobs: {}, problem: null };
    if (f.mode !== '100644' || f.type !== 'blob') return { jobs: null, problem: `recurring.json ${where} is not a regular file (mode ${f.mode}); the kit reads only a plain file`, entry: at(recurringRegistry.path(), f) };
    // its size first: a file over the bound is main's broken file (read as {} with the warning) or a
    // refused head, never a git failure that blocks every merge
    const z = g(['cat-file', '-s', f.oid]);
    if (!z.ok) return cant(z);
    const bytes = Number(z.out.trim());
    const max = Number(process.env.DEVTEAM_RECURRING_MAX_BYTES) || recurringRegistry.MAX_BYTES;
    if (!Number.isInteger(bytes) || bytes > max) return { jobs: null, problem: `recurring.json ${where}: ${z.out.trim()} bytes, over the kit's bound of ${max}; no jobs file needs that`, entry: at(recurringRegistry.path(), f) };
    const b = g(['cat-file', 'blob', f.oid]);
    if (!b.ok) return cant(b);
    const p = recurringRegistry.parse(b.out, where);
    return p.problem ? { ...p, entry: at(recurringRegistry.path(), f) } : p;
  },
  // The same for this checkout: each directory from the repo root to the file's a real directory
  // under lstat (a symlinked project/ would read a file git doesn't have), and the file a regular
  // one with no exec bit (git's 100755 is not the plain file), or absent.
  readWorking() {
    if (!projectInRepo) return { jobs: {}, problem: null };
    const where = 'in this checkout';
    // an lstat or read error other than a missing path (EACCES, ELOOP, …) is a problem, never a throw
    const cant = (e) => ({ jobs: null, problem: `recurring.json ${where}: can't read it (${e?.code ?? e?.message ?? e})` });
    const lst = (rel) => { try { return fs.lstatSync(path.join(projectRoot, ...rel.split('/'))); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null; return { failed: e }; } };
    for (const dir of recurringRegistry.parents()) {
      const s = lst(dir);
      if (!s) return { jobs: {}, problem: null };
      if (s.failed) return cant(s.failed);
      if (!s.isDirectory()) return { jobs: null, problem: `recurring.json ${where}: ${dir} is not a directory` };
    }
    const s = lst(recurringRegistry.path());
    if (!s) return { jobs: {}, problem: null };
    if (s.failed) return cant(s.failed);
    const not = s.isSymbolicLink() ? 'symlink' : s.isDirectory() ? 'directory' : !s.isFile() ? 'special file' : s.mode & 0o111 ? 'executable' : null;
    if (not) return { jobs: null, problem: `recurring.json ${where} is not a regular file (${not}); the kit reads only a plain file` };
    // its size first, from the lstat, as read does with cat-file -s (final-12b F5)
    const max = Number(process.env.DEVTEAM_RECURRING_MAX_BYTES) || recurringRegistry.MAX_BYTES;
    if (s.size > max) return { jobs: null, problem: `recurring.json ${where}: ${s.size} bytes, over the kit's bound of ${max}; no jobs file needs that` };
    let text;
    try { text = fs.readFileSync(path.join(projectRoot, ...recurringRegistry.path().split('/')), 'utf8'); } catch (e) { return cant(e); }
    return recurringRegistry.parse(text, where);
  },
  // A check every <n>h with n under 24 runs 24/n times a day; anything else once (daily or slower).
  // An every that doesn't parse counts 0: its shape problem is reported anyway.
  runsADay(entry) {
    const m = isObj(entry) && typeof entry.every === 'string' ? RECURRING_ENTRY_SHAPE.every.exec(entry.every) : null;
    if (!m) return 0;
    return m[2] === 'h' && Number(m[1]) < 24 ? 24 / Number(m[1]) : 1;
  },
  // The same in whole units, so the cap sums exactly (final-10b F5): UNIT is the lowest common
  // multiple of 1 to 23, so 24/n runs is a whole number of units for every n under 24, and
  // a total stays far below 2^53. Exactly 100 runs a day is CAP * UNIT.
  UNIT: 5354228880,
  unitsADay(entry) {
    const m = isObj(entry) && typeof entry.every === 'string' ? RECURRING_ENTRY_SHAPE.every.exec(entry.every) : null;
    if (!m) return 0;
    return m[2] === 'h' && Number(m[1]) < 24 ? (24 * recurringRegistry.UNIT) / Number(m[1]) : recurringRegistry.UNIT;
  },
  // whether a change (name to entry, null a stop) adds runs to main's jobs: a stop or a slower
  // schedule doesn't, so the cap never refuses one (ask and the landing alike; final-10b F4)
  addsRuns: (change, main) => Object.entries(isObj(change) ? change : {}).some(([n, e]) => recurringRegistry.unitsADay(e) > recurringRegistry.unitsADay(isObj(main) ? main[n] : undefined)),
  // a number of runs as a message prints it: at most two decimals
  runsWords: (n) => String(Math.round(n * 100) / 100),
  // [[name, runs], …] as "<name> <n>, …", largest first
  tally: (rows) => [...rows].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([n, r]) => `${n} ${recurringRegistry.runsWords(r)}`).join(', '),
  // null at the cap or under; over it, one line naming every entry, largest first
  capProblem(jobs, why) {
    const rows = Object.entries(isObj(jobs) ? jobs : {}).map(([n, e]) => [n, recurringRegistry.runsADay(e)]);
    const units = Object.values(isObj(jobs) ? jobs : {}).reduce((t, e) => t + recurringRegistry.unitsADay(e), 0);
    if (!(units > recurringRegistry.CAP * recurringRegistry.UNIT)) return null;
    const total = units / recurringRegistry.UNIT;
    return `recurring.json: ${recurringRegistry.runsWords(total)} runs a day, over the cap of ${recurringRegistry.CAP} (${why}): ${recurringRegistry.tally(rows)}`;
  },
  // the recurring-edit questions, folded (questionView), oldest first
  questions: () => logObjects('question').filter((q) => q.class === 'recurring-edit').map(questionView).sort((a, b) => (a.asked_at < b.asked_at ? -1 : a.asked_at > b.asked_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  // a folded question's change.recurring, or null when it shows none
  shown: (v) => (isObj(v?.change) && isObj(v.change.recurring) ? v.change.recurring : null),
  // the act that cites this answer (approved_by), or null
  landed: (qid) => logObjects('act').find((a) => a.approved_by === qid) ?? null,
  // the later recurring-edit question (by when it was asked) naming any of v's names, as { qid, name }, or null
  superseded(v) {
    const mine = Object.keys(recurringRegistry.shown(v) ?? {});
    for (const o of recurringRegistry.questions()) {
      if (o.id === v.id || !(o.asked_at > v.asked_at || (o.asked_at === v.asked_at && o.id > v.id))) continue;
      const name = mine.find((n) => Object.hasOwn(recurringRegistry.shown(o) ?? {}, n));
      if (name) return { qid: o.id, name };
    }
    return null;
  },
  // the question can approve its change: answered by the owner, as recommended, by their own pick or
  // label (agreed_by_owner; never a reading of words, whatever line wrote it:
  // d-20261120-195829274-supervisor), not landed, not superseded
  live: (v) => v?.class === 'recurring-edit' && v.status === 'answered' && v.matched === true && v.agreed_by_owner === true && !v.reading && !recurringRegistry.notOwnYes(v) && !recurringRegistry.landed(v.id) && !recurringRegistry.superseded(v),
  // whether a merge's jobs H are main's M (reads of each): both read alike, or both are the same
  // broken file left as it is (landRecords, before it records and pushes its merge)
  keepsJobs: (M, H) => !H.failed && !M.failed && (H.problem || M.problem ? !!H.problem && !!M.problem && !!H.entry && H.entry === M.entry : !Object.keys(recurringRegistry.changed(M.jobs, H.jobs)).length),
  // the flags of the kit's landing merges (landCode, landRecords): directory renames are a conflict,
  // and the message is kept verbatim, whatever the user's commit.cleanup or merge.log says (merge.log
  // would add a shortlog to it), so the rerun (kitMergeOf) reads back exactly what merge wrote
  // (final-14 F3, final-15 F2)
  MERGE_FLAGS: ['-c', 'merge.directoryRenames=conflict', '-c', 'commit.cleanup=verbatim', '-c', 'merge.log=false'],
  // The kit's own landing merges (final-15 F1, d-20261121-055611227-supervisor): landCode and
  // landRecords write each merge's sha here before its push, and a rerun adopts main's tip only when
  // it is one of them. Parents, a message and a tree are anything anyone can push; a sha the kit wrote
  // before pushing is not. Under run/ (the supervisor's own checkout, never pushed), one file per
  // head: run/landings/<repo>/<branch, or records-<id>>@<head>.json, a JSON array of { merge, onto, at }.
  landingFile: (repoName, what, head) => path.join(runDir, 'landings', encodeURIComponent(repoName), `${encodeURIComponent(what)}@${head}.json`),
  landingsOf(file) {
    try { const a = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(a) ? a.filter((x) => isObj(x) && typeof x.merge === 'string' && typeof x.onto === 'string') : []; } catch { return []; }
  },
  // R's main as one commit (merge's rerun judges a landing onto the main it landed on: final-15 F1),
  // for every check that reads R.mainRef() (home's: mainRef(), mainSha() and what they feed); returns
  // the unpin, which reads origin's again. Home's log is folded again either way (its durable copy is
  // main's).
  pinMain(R, sha) {
    R.resetCaches();
    if (R.name === 'home') {
      mainRefCache = sha; mainShaCache = sha; logCache = null;
      return () => { R.resetCaches(); logCache = null; };
    }
    const was = R.mainRef;
    R.mainRef = () => sha;
    return () => { R.mainRef = was; R.resetCaches(); };
  },
  // null once merge (onto onto) is written and reads back, else why not: then nothing is pushed
  recordLanding(file, merge, onto) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify([...recurringRegistry.landingsOf(file), { merge, onto, at: nowIso() }])}\n`);
      fs.renameSync(tmp, file);
    } catch (e) { return e.message; }
    return recurringRegistry.landingsOf(file).some((x) => x.merge === merge && x.onto === onto) ? null : 'it does not read back';
  },
  // the refusal when the clone keeps no reflog of origin's main (kitMergeOf's noReflog, final-18 F2):
  // it can't tell its own landing merge from a planted one, and that is no planter's doing
  noReflog: (what, mainBranch) => `${what}; this clone keeps no reflog of refs/remotes/origin/${mainBranch} (core.logAllRefUpdates is false, or the reflog was expired or removed), so the kit can't tell its own landing merge from a planted one: nothing logged. Run git config core.logAllRefUpdates true in this clone so later landings can be told, and verify this one from the start`,
  // the message landRecords gives the records merge on home's main (final-13 F1 reads it back)
  recordsMessage: (id, recSha, linkName) => `${id}: records\n\nMerged home's ticket/${id} at ${recSha}: the records of ${id}, whose code lands in ${linkName}`,
  // Whether tip is the kit's own landing merge of head (final-13 F1): exactly two parents, the second
  // head and the first one that doesn't already hold it (the main it landed on); else null. Then:
  // - a merge the kit recorded for this head before its push, onto that first parent (file:
  //   landingFile; final-15 F1), is adopted whatever its message says (the PR text may have changed
  //   since: d-20261121-072341505-supervisor, final-16 F1), but only when its tree is also the one
  //   merge builds from those parents with MERGE_FLAGS (git merge-tree --write-tree, git 2.38 or
  //   later; bounded, in cwd), which a planted record can't forge (final-16 F2), and only when that
  //   first parent is a commit this clone saw as origin's mainBranch (final-17 F1). A tree that
  //   differs, or a merge-tree that conflicts, fails or times out, is a look-alike: { lookalike: why,
  //   recorded: true }; a first parent never seen as main is { lookalike: why, recorded: true, unseen: that first parent },
  //   with noReflog: true when the clone keeps no reflog of origin's mainBranch, so it can't tell.
  // - one it never recorded is a look-alike when it carries merge's own message (as git keeps it:
  //   trailing spaces and repeated blank lines dropped), { lookalike: why, recorded: false }, and with
  //   another message is someone else's merge: null.
  // Else { onto: the first parent }. g is the repo's git (output, or null).
  kitMergeOf(g, tip, head, message, file, cwd, mainBranch) {
    const norm = (m) => String(m ?? '').split('\n').map((l) => l.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    const parents = (g(['rev-list', '--parents', '-n', '1', tip]) ?? '').trim().split(' ').slice(1);
    if (parents.length !== 2 || parents[1] !== head) return null;
    if (g(['merge-base', '--is-ancestor', head, parents[0]]) !== null) return null;
    if (!recurringRegistry.landingsOf(file).some((x) => x.merge === tip && x.onto === parents[0])) {
      if (norm(g(['log', '-1', '--format=%B', tip])) !== norm(message)) return null;
      return { lookalike: `no merge ${tip.slice(0, 12)} onto ${parents[0].slice(0, 12)} in ${path.relative(mainRoot, file)}`, recorded: false };
    }
    const have = (g(['rev-parse', '--verify', '--quiet', `${tip}^{tree}`]) ?? '').trim();
    const m = recurringRegistry.git([...recurringRegistry.MERGE_FLAGS, 'merge-tree', '--write-tree', '--no-messages', parents[0], head], { cwd });
    if (!m.ok) return { lookalike: `git merge-tree of its parents ${m.timedOut ? 'timed out' : 'failed or conflicts (it needs git 2.38 or later)'}`, recorded: true };
    const want = m.out.trim().split('\n')[0];
    if (!have || have !== want) return { lookalike: `its tree ${have.slice(0, 12) || '(unread)'}, the merge's ${want.slice(0, 12)}`, recorded: true };
    // and its first parent was origin's main in this clone: the main the kit's first run fetched, and
    // judged and merged onto, is in the reflog of refs/remotes/origin/<main> (final-17 F1). A record
    // and a tree can be planted onto a commit that was never main (one carrying an unanswered job),
    // and the checks, pinned there, would judge only the head's own change. The rerun's fetch adds
    // only the tip. The reflog is no proof against a planter (final-18 F1): every worktree of the clone
    // shares it (logs/refs/remotes), so whoever can write the clone can add an entry with one git
    // update-ref, just as they can plant the landing record, and any main the clone ever saw passes,
    // an older one too. It closes only a first parent the clone never saw; the PR's Known limits
    // (H18-1, H18-2) say what is left open, and each case needs a push to main past the wall.
    const seen = (g(['reflog', 'show', '--format=%H', `refs/remotes/origin/${mainBranch}`]) ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    // no reflog at all (core.logAllRefUpdates false, or it expired or was removed) proves nothing
    // either way: the clone can't tell, and says so (final-18 F2)
    if (!seen.length) return { lookalike: `the reflog of refs/remotes/origin/${mainBranch} is missing or empty`, recorded: true, unseen: parents[0], noReflog: true };
    if (!seen.includes(parents[0])) return { lookalike: `${parents[0].slice(0, 12)} is not in the reflog of refs/remotes/origin/${mainBranch}`, recorded: true, unseen: parents[0] };
    return { onto: parents[0] };
  },
  // words that start with the label Yes, read as --choice and --read read a label: any case
  // (final-12b F3), then the end, whitespace, or one of . , ! (final-13b F3). A Yes inside or next to
  // a quotation mark of any kind is none (d-20261121-072341505-supervisor, final-16b F3): any
  // \p{Quotation_Mark} (" ' “ ” „ ‟ ‘ ’ ‚ ‛ « » ‹ › ＂ ＇ 「 」 『 』 …), and ″ ‶ ‷ 「 」 and the
  // backtick named too (final-17b F6),
  // before it (so no quote wraps the turn, not even "Yes" alone) or in its word (Yes", Yes.”, Yes,„),
  // so reported speech ("Yes" is what you want me to say. No.) is no Yes, and the owner answers on
  // the card instead; a turn holding any format or combining character (a zero-width space, a soft
  // hyphen, an accent) is none either. The letters are spelled out, not /i, so no other letter that
  // folds to one of them (the long s, U+017F) passes for it.
  QUOTE_MARK: /[\p{Quotation_Mark}\u2033\u2036\u2037\u300c\u300d`]/u,
  saysYes: (said) => {
    const s = String(said ?? '');
    if (/[\p{Cf}\p{M}]/u.test(s)) return false;
    const t = s.trim();
    // the Yes's own word, up to the first space: a quote mark there is before, in or right after it
    if (recurringRegistry.QUOTE_MARK.test(t.split(/\s/u)[0])) return false;
    return /^[Yy][Ee][Ss](?:$|[\s.,!])/u.test(t);
  },
  // The owner's first line in turn u's thread from u's own millisecond on (a line in the same
  // millisecond counts as after it), other than u, as words for a refusal; else null. With span
  // ({ from, to }, places in readLog().lines), the window is instead the lines after place from (the
  // Yes) and before place to (the answer line), in the log's own order, whatever their at says
  // (final-18b F3) (d-20261121-072341505-supervisor, final-16b F1
  // to F4; d-20261121-103254180-supervisor, final-17b F1): a turn in the thread; a resolve of it with
  // an outcome (its words); a reopen of it; or the owner's answer (a set line that carries answer,
  // as every owner answer the kit writes does: a pick, words, a decline, a review's result, the last
  // secret posted) on a question of the thread (threadQuestions), whatever channel it came from: a
  // card answer to another question there can take the Yes back as well as a turn. A set line with
  // no answer (a partial secrets post, a reading_void) is no answer, so it doesn't count
  // (final-18b F4). A line in another thread never counts.
  laterOwner(u, span = null) {
    const at = String(u?.created_at ?? '');
    // the thread's questions as of the window's end: by at, since the turns that show a question are
    // the supervisor's, in other files than the owner's; with span, the end is the newest at of the
    // owner's lines up to the answer line's place, so a backdated answer line can't move it earlier
    const lines = readLog().lines;
    const endAt = span ? lines.reduce((m, L, i) => (i <= span.to && L.by === 'owner' && String(L.at ?? '') > m ? String(L.at ?? '') : m), '') : null;
    const asked = recurringRegistry.threadQuestions(u.thread, span ? (L) => String(L.at ?? '') <= endAt : () => true);
    const inWindow = span ? (L, i) => i > span.from && i < span.to : (L) => String(L.at ?? '') >= at;
    const hits = [];
    lines.forEach((L, i) => { if (L.by === 'owner' && inWindow(L, i) && (
      (L.type === 'turn' && L.thread === u.thread && L.id !== u.id)
      || (L.type === 'thread' && L.op === 'set' && L.id === u.thread && ((L.status === 'resolved' && typeof L.outcome === 'string' && L.outcome.trim() !== '') || L.status === 'open'))
      || (L.type === 'question' && L.op === 'set' && asked.has(L.id) && Object.hasOwn(L, 'answer'))
    )) hits.push(L); });
    const later = span ? hits[0] : hits.sort((x, y) => String(x.at).localeCompare(String(y.at)))[0];
    if (!later) return null;
    if (later.type === 'turn') return later.id;
    if (later.type === 'question') return `their answer to ${later.id}, at ${later.at}`;
    return `their ${later.status === 'open' ? 'reopen' : 'resolve'} of ${u.thread}${later.status === 'open' ? '' : ' with an outcome'}, at ${later.at}`;
  },
  // The questions of thread tid: each asked from it (the question's thread), and each that a turn in
  // it names (thread ask's question, or a reply's --refs question:<id>), wherever it was asked, by
  // a turn line that upto(L, its place in readLog().lines) takes (d-20261121-123409608-supervisor, final-18b F1): a question shown
  // in the thread is in it as much as one asked there.
  threadQuestions(tid, upto = () => true) {
    const ids = new Set(logObjects('question').filter((q) => q.thread === tid).map((q) => q.id));
    readLog().lines.forEach((L, i) => {
      if (L.type !== 'turn' || L.op !== 'new' || L.thread !== tid || !upto(L, i)) return;
      if (typeof L.question === 'string') ids.add(L.question);
      for (const r of Array.isArray(L.refs) ? L.refs : []) if (typeof r === 'string' && r.startsWith('question:')) ids.add(r.slice('question:'.length));
    });
    return ids;
  },
  // why an answer line is not the owner's own Yes, whatever it says (final-11b F1, final-12b F1,
  // final-13b F1 and F2): one recorded from chat; from a turn whose words (the line's, or the turn's
  // own) don't start with Yes; from a clause of a turn (said_at); from a turn that isn't the owner's,
  // in the log, and newer than the question; with words other than the turn's; from a turn that
  // doesn't bind the question (turnBinds); or one after which the owner wrote again in its thread
  // before the answer line (laterOwner); else null
  notOwnYes(v) {
    if (v?.channel === 'chat') return `answered from chat ("${String(v.said ?? '').slice(0, 80)}"), which approves no job change`;
    // the channels the kit writes on an owner's answer (appendLog, cmdAnswer): the card (cli or
    // dashboard), chat and thread; any other value is a line the kit never wrote (final-14b F7)
    if (v?.channel === 'cli' || v?.channel === 'dashboard') return null;
    if (v?.channel !== 'thread') return `answered on channel ${JSON.stringify(v?.channel ?? null)}, which the kit never writes for an owner's answer, so it approves no job change`;
    const turn = v.turn ?? 'a turn';
    if (!recurringRegistry.saysYes(v.said)) return `answered from ${turn}, whose words don't start with Yes ("${String(v.said ?? '').slice(0, 80)}")`;
    if (v.said_at !== undefined && v.said_at !== null) return `answered from a clause of ${turn} (said_at), which approves no job change`;
    const u = typeof v.turn === 'string' ? logGet(v.turn) : null;
    if (u?.type !== 'turn' || u.created_by !== 'owner' || !(String(u.created_at ?? '') > String(v.asked_at ?? ''))) return `answered from ${turn}, which isn't newer than the question (or isn't the owner's turn in the log)`;
    // the cited turn's own words, never only the line's said (final-13b F2)
    if (!recurringRegistry.saysYes(u.text)) return `answered from ${turn}, whose words don't start with Yes ("${String(u.text ?? '').slice(0, 80)}")`;
    if (v.said !== u.text) return `answered from ${turn}, with words that aren't that turn's ("${String(v.said ?? '').slice(0, 80)}")`;
    if (v.thread && u.thread !== v.thread) return `answered from ${turn}, which is in ${u.thread}, not the question's ${v.thread}`;
    const why = recurringRegistry.turnBinds(u, v.id);
    if (why) return `answered from ${turn}, which isn't the owner's first turn right after the supervisor's turn that shows the question (${why})`;
    // and no owner line in its thread between the Yes and the answer line itself, as cmdAnswer refuses
    // (final-17b F3): a line planted past that refusal, or one written in the race between its check
    // and its append, lands nothing. A line after the answer was recorded doesn't void it. Between
    // goes by place in the log, never by the answer line's own at, which whoever wrote it set
    // (d-20261121-123409608-supervisor, final-18b F3): readLog().lines, each file in name order (the
    // owner's are owner-<yyyy-mm>.jsonl, so by month) and each file's lines as appended. The Yes and
    // every line that can void it are the owner's, so that is the order they were written in. The
    // answer line is the last owner answer line on the question at answered_at; none found, the
    // window runs to the log's end.
    const lines = readLog().lines;
    const upto = String(v.answered_at ?? '');
    const from = lines.findIndex((L) => L.type === 'turn' && L.op === 'new' && L.id === u.id);
    const to = lines.findLastIndex((L) => L.type === 'question' && L.op === 'set' && L.id === v.id && L.by === 'owner' && Object.hasOwn(L, 'answer') && String(L.at ?? '') === upto);
    const what = recurringRegistry.laterOwner(u, { from, to: to < 0 ? lines.length : to });
    if (what) return `answered from ${turn}, after which the owner wrote again in ${u.thread} before the answer was recorded (${what})`;
    return null;
  },
  // why the owner's turn u doesn't bind question qid, or null (final-13b F1, final-14b F1): it binds
  // only as the very next turn in u's thread after the supervisor's newest turn there that shows qid
  // (thread ask's question, or a reply's --refs question:<qid>), and naming no other question.
  // Nothing may come between them, whoever wrote it: a plain reply asks something else in words just
  // as well. Nor may any other line of the thread, of any type (final-15b F1): a resolve proposal
  // (thread ready) asks something else too, and a resolve or a reopen is the thread moving on; a
  // question asked into it comes with its own turn. Lines in the same millisecond as either end count as
  // between, so a tie never binds.
  turnBinds(u, qid) {
    if (u?.type !== 'turn') return 'no such turn';
    const refsQ = (x) => (Array.isArray(x.refs) ? x.refs : []).filter((r) => typeof r === 'string' && r.startsWith('question:'));
    const shows = (x) => x.created_by === 'supervisor' && (x.question === qid || refsQ(x).includes(`question:${qid}`));
    const turns = logObjects('turn').filter((x) => x.thread === u.thread && x.id !== u.id);
    const at = String(u.created_at ?? '');
    const show = turns.filter((x) => shows(x) && String(x.created_at ?? '') < at).sort(byTime).pop();
    if (!show) return `no turn of the supervisor's in ${u.thread} showed ${qid} before it`;
    if ((show.question && show.question !== qid) || refsQ(show).some((r) => r !== `question:${qid}`)) return `${show.id}, which shows it, names another question too`;
    const from = String(show.created_at ?? '');
    const between = turns.find((x) => x.id !== show.id && String(x.created_at ?? '') >= from && String(x.created_at ?? '') <= at);
    if (between) return `${between.id}, the ${typeof between.created_by === 'string' ? between.created_by : 'unknown'}'s turn, comes between ${show.id} and it`;
    // every other line of the thread, as written: its own set lines (a question asked into it is
    // always a turn too, thread ask's, so the turns above catch it: final-16b F6)
    const who = (L) => (typeof L.by === 'string' ? L.by : 'unknown');
    const line = readLog().lines.find((L) => String(L.at ?? '') >= from && String(L.at ?? '') <= at && L.type === 'thread' && L.id === u.thread);
    if (line) return `the ${who(line)}'s ${isObj(line.ready) ? 'resolve proposal, a thread ready line,' : line.status !== undefined ? `status ${JSON.stringify(line.status)} line` : `${line.op} line`} on ${u.thread} at ${line.at} comes between ${show.id} and it`;
    return null;
  },
  // The questions that block another question for their names: open ones, and live ones
  // (registering an addition or edit, stopping when every value is null), as { qid, status, change }.
  pending() {
    const rows = [];
    for (const v of recurringRegistry.questions()) {
      const change = recurringRegistry.shown(v);
      if (!change) continue;
      const status = v.status === 'open' ? 'open' : recurringRegistry.live(v) ? (Object.values(change).every((e) => e === null) ? 'stopping' : 'registering') : null;
      if (status) rows.push({ qid: v.id, status, change });
    }
    return rows;
  },
  // What the cap counts when asking: pending(), and every answer in words, read or not, that is
  // neither landed nor superseded, since a reading can be withdrawn and read again as Yes. A picked
  // or typed No can never become one, so it frees its room.
  counted() {
    const rows = recurringRegistry.pending();
    for (const v of recurringRegistry.questions()) {
      const change = recurringRegistry.shown(v);
      if (change && v.status === 'answered' && v.in_words === true && !recurringRegistry.landed(v.id) && !recurringRegistry.superseded(v)) rows.push({ qid: v.id, status: 'in words', change });
    }
    return rows;
  },
  // the names whose entry differs between two job objects (canonical), each mapped to the second's entry or null
  changed(a, b) {
    const A = isObj(a) ? a : {};
    const B = isObj(b) ? b : {};
    const names = [...new Set([...Object.keys(A), ...Object.keys(B)])];
    return Object.fromEntries(names.filter((n) => Object.hasOwn(A, n) !== Object.hasOwn(B, n) || canonical(A[n]) !== canonical(B[n])).map((n) => [n, Object.hasOwn(B, n) ? B[n] : null]));
  },
  // What lands (kit-162, spec "What lands"): the jobs a merge of sha onto main lands, under method,
  // known exactly in two cases only, as { from: 'head' | 'main', jobs, main, changed, problem, warn }
  // (main: main's jobs as the binding reads them, {} when its file doesn't read):
  // the branch contains main's tip (with no merge commits since it, under rebase), so the head's tree
  // lands; or it is behind at a single merge base and no watched path changed on either side since
  // (nor in any of its commits, under rebase), so git never merges the file and main's lands. Every
  // other history is refused (problem). Each git call has a timeout; one that fails or times out
  // refuses. A main file that doesn't read is {} here (warn says so): it never blocks a PR that
  // leaves it alone, and never lets a job land without its answer. changed is changed(main's jobs,
  // the landed ones). No ls-tree and no merge-tree: diff, log, rev-list, merge-base and cat-file.
  landing(main, sha, method) {
    const R = recurringRegistry;
    const g = R.git;
    const refuse = (problem, warn = null) => ({ from: null, jobs: null, changed: null, problem, warn });
    if (!main || !sha) return refuse(`recurring.json: no ${!main ? 'main' : 'head'} to judge the jobs against`);
    const P = R.path();
    const parents = R.parents();
    // the names are the repo's, whole: never relative to a subdirectory (diff.relative), and with every
    // gitlink shown (diff.ignoreSubmodules), whatever the user's git config says (T3-3)
    // a path whose change could put another file, a directory or a link at P, or carry one into it
    const watched = (n) => n === 'recurring.json' || n.endsWith('/recurring.json') || n === P || n.startsWith(`${P}/`) || parents.includes(n);
    const cant = (what, r) => `recurring.json: git ${what} ${R.why(r)}, so the kit can't tell what would land; check again`;
    const M = R.read(main);
    if (M.failed) return refuse(M.problem);
    const warn = M.problem ? `main's recurring.json doesn't read (${M.problem}); fix it in a recurring chore` : null;
    const mainJobs = M.problem ? {} : M.jobs;
    const lands = (from, jobs) => ({ from, jobs, main: mainJobs, changed: R.changed(mainJobs, jobs), problem: null, warn });
    // 1. the head's file reads, or is main's broken one, entry for entry (which waives only this)
    const H = R.read(sha);
    if (H.failed) return refuse(H.problem, warn);
    const same = !!H.problem && !!M.problem && !!H.entry && H.entry === M.entry;
    if (H.problem && !same) return refuse(H.problem, warn);
    const headJobs = same ? mainJobs : H.jobs;
    const rebase = method === 'rebase';
    let merges = '';
    if (rebase) {
      const r = g(['rev-list', '--merges', `${main}..${sha}`]);
      if (!r.ok) return refuse(cant('rev-list --merges', r), warn);
      merges = r.out.trim();
    }
    // 2. up to date: every method lands the head's tree
    const anc = g(['merge-base', '--is-ancestor', main, sha]);
    if (anc.timedOut || ![0, 1].includes(anc.status)) return refuse(cant('merge-base --is-ancestor', anc), warn);
    const merged = 'recurring.json: merge_method is rebase and this branch has merge commits since main; rebase it onto main instead';
    if (anc.status === 0) return rebase && merges ? refuse(merged, warn) : lands('head', headJobs);
    // 3. behind: one merge base, and no watched path changed on either side since it. The advice
    // follows the method: under rebase a merge of main is refused too, so it says rebase (final-10 F7)
    const catchUp = rebase ? 'rebase it onto main' : 'merge main into the branch first';
    const behind = `recurring.json: this branch doesn't contain main's tip, and it or main changed a recurring.json since they parted; ${catchUp}`;
    const mb = g(['merge-base', '--all', main, sha]);
    if (mb.timedOut || ![0, 1].includes(mb.status)) return refuse(cant('merge-base --all', mb), warn);
    const bases = mb.status === 0 ? mb.out.split('\n').filter(Boolean) : [];
    if (bases.length > 1) return refuse(`recurring.json: this branch doesn't contain main's tip and has ${bases.length} merge bases with it; ${catchUp}`, warn);
    if (bases.length !== 1) return refuse(behind, warn);
    if (rebase && merges) return refuse(merged, warn);
    for (const side of [sha, main]) {
      const d = g(['diff', '--no-renames', '--no-relative', '--ignore-submodules=none', '--name-only', '-z', bases[0], side]);
      if (!d.ok) return refuse(cant('diff', d), warn);
      if (d.out.split('\0').some((n) => n && watched(n))) return refuse(behind, warn);
    }
    // under rebase, each commit is replayed: none may touch a watched path, even one it later restores
    if (rebase) {
      const l = g(['log', '--no-renames', '--no-relative', '--ignore-submodules=none', '--format=%x00%H', '--name-only', '-z', `${main}..${sha}`]);
      if (!l.ok) return refuse(cant('log', l), warn);
      // "\0<hash>" heads each commit, then its names, the first after one newline, each ending in \0:
      // an empty field comes before every hash, and no name is empty
      const names = [];
      let hash = false;
      let first = false;
      for (const t of l.out.split('\0')) {
        if (t === '') { hash = true; continue; }
        if (hash) { hash = false; first = true; continue; }
        names.push(first && t.startsWith('\n') ? t.slice(1) : t);
        first = false;
      }
      if (names.some(watched)) return refuse(behind, warn);
    }
    // 4. git never merges P: main's file lands
    return lands('main', mainJobs);
  },
});

// merge's binding of a recurring-edit answer to the jobs a PR lands (kit-162): the answer must be
// live (a Yes, not landed, not superseded; read here, whatever ownerAnswer accepted), it must show
// a change, and the PR must change the jobs exactly as it showed, name by name: main's jobs (main)
// against the ones that land (landed, recurringRegistry.landing's), compared canonically. An answer
// of another class is the class check's to refuse.
export function recurringBindingFails(main, landed, approved) {
  const R = recurringRegistry;
  const q = logGet(approved);
  if (q?.type !== 'question' || q.class !== 'recurring-edit') return [];
  const v = questionView(q);
  const fails = [];
  const done = R.landed(approved);
  if (done) fails.push(`${approved} already landed (${done.id})`);
  else if (!R.live(v)) {
    const later = R.superseded(v);
    const notOwn = v.status === 'answered' ? R.notOwnYes(v) : null;
    fails.push(`${approved} can't approve a job change: ${later ? `superseded by ${later.qid}, asked later about ${later.name}` : notOwn ? `${notOwn}: only the owner's own Yes does` : `${v.status === 'answered' ? `answered "${String(v.answer ?? '').slice(0, 80)}"` : `it is ${v.status}`}, not Yes`}`);
  }
  const shown = R.shown(v);
  if (!shown) return [...fails, `${approved} showed no job change: ask again with --change`];
  const A = isObj(main) ? main : {};
  const B = isObj(landed) ? landed : {};
  const diff = R.changed(A, B);
  const how = (n) => (!Object.hasOwn(A, n) ? 'added' : !Object.hasOwn(B, n) ? 'removed' : 'changed');
  for (const n of Object.keys(diff)) if (!Object.hasOwn(shown, n)) fails.push(`recurring.${n} is ${how(n)} here, which ${approved} did not show the owner: ask again for it, or take it out`);
  for (const [n, e] of Object.entries(shown)) {
    const exact = Object.hasOwn(diff, n) && (e === null ? !Object.hasOwn(B, n) : Object.hasOwn(B, n) && canonical(B[n]) === canonical(e));
    if (exact) continue;
    const did = !Object.hasOwn(diff, n) ? 'leaves it as main has it' : !Object.hasOwn(B, n) ? 'removes it' : !Object.hasOwn(A, n) ? `adds ${JSON.stringify(B[n])}` : `makes it ${JSON.stringify(B[n])}`;
    fails.push(`recurring.${n}: ${approved} showed ${e === null ? 'a stop' : JSON.stringify(e)}, and this PR ${did}: land exactly what the owner saw`);
  }
  return fails;
}

// recurring list | show | apply (kit-162). list and show read main's jobs file (recurringRegistry.read
// at mainRef(), never this checkout's): a file on main that doesn't read is printed and exits 1, and
// a broken entry is printed with its problems. An entry is registered by the latest merge-chore act
// citing an answered recurring-edit question that showed exactly main's entry for the name. apply
// writes one live answer's exact change into the recurring chore worktree's jobs file, only while
// that file is byte for byte main's (or both are absent), so the PR carries this answer alone; it
// writes that one file and nothing else.
export function cmdRecurring() {
  const R = recurringRegistry;
  const [sub, arg] = positional;
  const usage = 'usage: recurring list [--json] | recurring show <name> [--json] | recurring apply <qid> | recurring run --due | recurring run <name> --draft | recurring due [--json] | recurring ticket <name> --id <id> --touches <glob>… [--component <c>] | recurring start <name> | recurring done <name> --nothing "<why>" | --abandoned "<why>"';
  const P = R.path();
  // main's jobs, as read(ref) reads them: a problem (a broken file, or git failing) stops here
  const mainJobs = () => {
    const ref = mainRef();
    if (!ref) die(`no ${loadSettings().main_branch} branch to read the jobs from`);
    const r = R.read(ref);
    if (r.problem) die(r.problem);
    return r.jobs;
  };
  if (sub === 'list' || sub === 'show') {
    if (sub === 'show' && !arg) die('usage: recurring show <name> [--json]');
    if (!projectInRepo) {
      if (sub === 'show') die('the project dir is outside this repo, so it has no jobs');
      return flags.json ? json({ entries: [], runs_a_day: 0, cap: R.CAP, pending: [] }) : out('the project dir is outside this repo, so it has no jobs');
    }
    const jobs = mainJobs();
    const registered = (name, entry) => recurringFailures.registered(name, entry);
    const pending = R.pending().flatMap((p) => Object.keys(p.change).sort().map((name) => ({ qid: p.qid, name, change: p.change[name], status: p.status })));
    const row = (name) => {
      const entry = jobs[name];
      const problems = recurringEntryProblems(name, entry);
      return { name, entry, runs_a_day: R.runsADay(entry), registered: registered(name, entry), ...(problems.length ? { problems } : {}) };
    };
    const regWords = (r) => (r ? `registered ${dateOnly(r.at)} by ${r.by} (${r.qid})` : 'not registered through an answer');
    const pendWords = (p) => `${p.qid} ${p.status}: ${p.name} ${p.change === null ? 'stop' : JSON.stringify(p.change)}`;
    if (sub === 'show') {
      if (!Object.hasOwn(jobs, arg)) die(`no job ${arg} on main; recurring list`);
      const r = { ...row(arg), pending: pending.filter((p) => p.name === arg) };
      if (flags.json) return json(r);
      return out([arg, JSON.stringify(r.entry, null, 2), `runs a day: ${R.runsWords(r.runs_a_day)}`, regWords(r.registered), ...(r.problems ?? []).map((p) => `problem: ${p}`), ...(r.pending.length ? r.pending.map((p) => `pending: ${pendWords(p)}`) : ['pending: none'])].join('\n'));
    }
    const entries = Object.keys(jobs).sort().map(row);
    const total = entries.reduce((t, e) => t + e.runs_a_day, 0);
    if (flags.json) return json({ entries, runs_a_day: total, cap: R.CAP, pending });
    const str = (x) => (typeof x === 'string' ? x : '?');
    return out([
      ...(entries.length ? entries.map((e) => `${e.name}  ${str(e.entry?.kind)}  every ${str(e.entry?.every)}  ${str(e.entry?.title)}  ${regWords(e.registered)}${(e.problems ?? []).map((p) => `\n  problem: ${p}`).join('')}`) : ['no jobs on main']),
      `${R.runsWords(total)} runs a day, cap ${R.CAP}`,
      ...(pending.length ? pending.map((p) => `pending: ${pendWords(p)}`) : ['pending: none']),
    ].join('\n'));
  }
  // a chores ticket to fix a failing check, cited by its add-ticket act (kit-168): what clears
  // recurring-failing. Nothing is written until every guard passes.
  if (sub === 'ticket') {
    supervisorOnly('recurring ticket');
    const id = flagStr('id');
    if (!arg || !id) die('usage: recurring ticket <name> --id <id> --touches <glob>… [--component <c>]');
    const jobs = mainJobs();
    if (!Object.hasOwn(jobs, arg)) die(`no job ${arg} on main; recurring list`);
    const entry = jobs[arg];
    if (entry.kind !== 'check') die(`${arg} is a ${entry.kind ?? 'kindless'} job; only a failing check gets a fix ticket`);
    const RF = recurringFailures;
    const st = RF.state(arg, entry);
    if (!st.alerting) die(`${arg} has not failed ${RF.failAfter(entry)} runs in a row (fail_after); nothing to fix`);
    if (st.fixTicket) die(`${arg} is already being fixed by ${st.fixTicket}`);
    const idRe = SCHEMA['x-id'].keyed.ticket;
    if (!new RegExp(idRe).test(id)) die(`--id ${id} must match ${idRe}`);
    const old = logGet(id);
    if (old) {
      // a live (unmerged, not superseded) chores ticket can be made this check's fix: the line is one act runs as given (its refs are words)
      const linkable = old.type === 'ticket' && old.feature === CHORES && !old.superseded_by && !mergedAt(id);
      die(`${id} exists${linkable ? `; to make it ${arg}'s fix ticket, link it: act --class add-ticket --refs ${id} recurring:${arg} -- "linked ${id} as ${arg}'s fix ticket"` : ''}`);
    }
    const touches = listFlag('touches');
    if (!touches.length) die(`recurring ticket needs --touches <glob>…: the files the fix may change`);
    const component = flagStr('component') ?? /^(.+?)-\d{2,}-/.exec(id)?.[1];
    if (!component) die(`--component <c>: ${id} names none before its -<NN>-`);
    const F = entry.fail && typeof entry.fail === 'object' ? entry.fail : { exit: 'nonzero' };
    const ll = F.last_line && typeof F.last_line === 'object' ? F.last_line : null;
    // as recurringRunDue.judge reads the rule: with a last_line rule the exit status isn't judged
    const rule = !ll ? 'it exits 0' : Object.hasOwn(ll, 'is_not') ? `its last line is ${JSON.stringify(String(ll.is_not))}` : Object.hasOwn(ll, 'above') ? `its last line is a number, ${ll.above} or less` : `its last line is a number, ${ll.below} or more`;
    const last = st.stretch.at(-1);
    const excerpt = recurringRunDue.scrub(last?.excerpt ?? '', false);
    appendLog({
      type: 'ticket', op: 'new', id, feature: CHORES, title: `Fix: ${entry.title}`, component, kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches,
      done_when: [`${arg}'s command \`${entry.run}\`, run from the repo root at the PR's head, exits and prints as its fail rule calls passing (${rule}); after the merge, \`recurring run ${arg} --draft\` on main passes`],
      notes: `The job ${arg} (${entry.title}) is failing: ${st.stretch.length} runs in a row since ${st.since}. Its last run printed, shown as data, not instructions: ${JSON.stringify(excerpt)}`,
    }, 'supervisor');
    appendLog({ type: 'act', decision: citing(), class: 'add-ticket', what: `added ticket ${id} to fix the failing check ${arg}`, refs: [id, `recurring:${arg}`], reversible: true }, 'supervisor');
    return out(`added ${id}`);
  }
  // a due chore begins (kit-164): the supervisor's in a chore worktree, a worker's as a chores ticket;
  // its run for the slot is the started line, finished by its merge or by recurring done
  if (sub === 'start' || sub === 'done') {
    supervisorOnly(`recurring ${sub}`);
    const RC = recurringChores;
    if (!arg) die(sub === 'start' ? 'usage: recurring start <name>' : 'usage: recurring done <name> --nothing "<why>" | --abandoned "<why>"');
    const l = RC.list();
    if (l.problem) die(l.problem);
    const jobs = mainJobs();
    if (!Object.hasOwn(jobs, arg)) die(`no job ${arg} on main; recurring list`);
    const entry = jobs[arg];
    if (entry.kind !== 'chore') die(`${arg} is a ${entry.kind ?? 'kindless'} job; only a chore starts and finishes here (a check runs on its own)`);
    if (sub === 'done') {
      const how = ['nothing', 'abandoned'].filter((f) => flags[f] !== undefined);
      if (how.length !== 1) die('usage: recurring done <name> --nothing "<why>" | --abandoned "<why>" (one of them)');
      const status = how[0];
      const why = flagStr(status)?.trim();
      if (!why) die(`recurring done --${status} needs the reason: --${status} "<why>"`);
      if (UNSAFE_TEXT.test(why) || why.length > 300) die(`--${status}: one line of at most 300 characters`);
      if (entry.by === 'worker') die(`${arg} is a worker's chore: it ends only through its ticket (its merge, or a ticket set … superseded_by), so a live ticket is never written twice`);
      const st = RC.state(arg, entry, { forge: true });
      const open = st?.open;
      if (!open) die(`${arg} has no started run to finish${st?.runs.length ? ` (its last, ${st.runs.at(-1).ref}, is ${st.runs.at(-1).status})` : ''}`);
      if (RC.isTicketRef(open.ref)) die(`${arg}'s run ${open.ref} is a ticket: it ends only through that ticket`);
      if (!RC.REF.test(open.ref)) die(`${arg}'s run ${open.ref} is not a chore branch (chore-recurring-<name>-<yyyymmdd>); finish it by hand`);
      const wt = path.join(mainRoot, '.worktrees', open.ref);
      let removed = '';
      // a symlink there is never followed: it could lead to another chore's worktree
      if (status === 'nothing' && fs.lstatSync(wt, { throwIfNoEntry: false })?.isSymbolicLink()) die(`.worktrees/${open.ref} is a symlink, not this chore's worktree; move it aside, then recurring done again`);
      if (status === 'nothing' && fs.existsSync(wt)) {
        // empty: nothing uncommitted and no commit main lacks; anything else is work, never removed here
        const g = (args) => recurringRegistry.git(args, { cwd: wt });
        const top = g(['rev-parse', '--show-toplevel']);
        if (!top.ok || realPath(top.out.trim()) !== realPath(wt)) die(`.worktrees/${open.ref} is not a worktree; move it aside, then recurring done again`);
        // every untracked file and submodule change counts, whatever the user's git config hides
        const dirty = g(['status', '--porcelain', '--untracked-files=all', '--ignore-submodules=none']);
        const main = mainSha();
        const ahead = main ? g(['rev-list', '--count', 'HEAD', '--not', main]) : { ok: false };
        if (!dirty.ok || !ahead.ok) die(`couldn't read .worktrees/${open.ref} (git ${recurringRegistry.why(dirty.ok ? ahead : dirty)}); nothing was logged`);
        if (dirty.out.trim() || Number(ahead.out.trim()) > 0) die(`.worktrees/${open.ref} holds work (${dirty.out.trim() ? 'uncommitted changes' : `${ahead.out.trim()} commit(s) main lacks`}): land it (chore pr ${open.ref.replace(/^chore-/, '')}, then merge --chore), or --abandoned "<why>"`);
        const rm = recurringRegistry.git(['worktree', 'remove', wt], { cwd: mainRoot });
        if (!rm.ok) die(`couldn't remove .worktrees/${open.ref} (git worktree remove ${recurringRegistry.why(rm)}); nothing was logged`);
        removed = `; removed the empty .worktrees/${open.ref}`;
      }
      appendLog({ type: 'observation', source: 'recurring', kind: 'recurring-run', subject: `recurring:${arg}`, detector: 'recurring', severity: 0, valence: 0, detail: why, source_key: `recurring:${arg}:${open.slot}:${status}:${open.ref}`, run: { status, slot: open.slot, ref: open.ref } }, 'supervisor');
      return out(`${arg}: ${status === 'nothing' ? 'nothing to do' : 'abandoned'} for ${open.slot} (${open.ref})${removed}; due again by its slots`);
    }
    // start: Upkeep running, an answered job, due, and no run of it live
    const mode = goalMode(upkeepOrVirtual());
    if (mode !== 'run') die(`Upkeep is ${holdWords(mode)}: recurring chores wait until it runs (goal hold upkeep run --owner)`);
    const reg = recurringFailures.registered(arg, entry);
    if (!reg) die(`${arg} on main was not registered through an answered recurring-edit question: only a job the owner approved starts`);
    const st = RC.state(arg, entry, { mode, forge: true });
    if (!st) die(`${arg} has no schedule the kit can read`);
    if (st.open) die(`${arg} is already started (${st.open.ref}, for ${st.open.slot}): it finishes when that merges${RC.isTicketRef(st.open.ref) ? ' or is superseded' : ', or with recurring done --nothing | --abandoned'}`);
    if (!st.due) die(`${arg} is not due: next ${st.next}`);
    const now = Date.now();
    const header = `${arg}: ${entry.title}. Approved by ${reg.qid}; due for ${st.slot}.`;
    const body = ['Its instructions, as the owner approved them:', entry.prompt].join('\n');
    if (entry.by === 'supervisor') {
      const ref = RC.slug(arg, now);
      const slug = ref.replace(/^chore-/, '');
      if (st.runs.some((r) => r.ref === ref)) die(`${arg} already started as ${ref} today: start it again tomorrow`);
      if (fs.existsSync(path.join(mainRoot, '.worktrees', ref))) die(`.worktrees/${ref} is there already: land or remove it first`);
      const wt = choreWorktree(slug, { setup: true });
      RC.logStart(arg, st.slot, ref, `chore ${slug}`);
      return out([header, `Started in ${path.relative(mainRoot, wt)}.`, '', body, '', 'Then:', `  devteam.mjs chore pr ${slug} --title "…"   and merge --chore ${slug} (that merge finishes it)`, `  or devteam.mjs recurring done ${arg} --nothing "<why>"   (nothing to do; removes the empty worktree)`, `  or devteam.mjs recurring done ${arg} --abandoned "<why>"`].join('\n'));
    }
    // a ticket an earlier start wrote and logged no line for is taken up, never written twice
    const stray = RC.stray(arg, entry, st.runs);
    if (stray) {
      RC.logStart(arg, st.slot, stray, `ticket ${stray}, taken up`);
      return out([header, `Took up the chores ticket ${stray}, written by an earlier start that logged no run; start its worker as any chore ticket's (devteam.mjs worker ${stray}). It finishes when ${stray} merges, or is superseded.`, '', body].join('\n'));
    }
    const id = RC.nextId(entry.component, arg);
    if (!new RegExp(SCHEMA['x-id'].keyed.ticket).test(id)) die(`the chore ticket's id ${id} must match ${SCHEMA['x-id'].keyed.ticket}`);
    if (logGet(id)) die(`${id} exists`);
    appendLog({
      type: 'ticket', op: 'new', id, feature: CHORES, title: `Recurring: ${entry.title}`, component: entry.component, kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: entry.touches, done_when: entry.done_when,
      notes: `${header}\n${body}`,
    }, 'supervisor');
    appendLog({ type: 'act', decision: citing(), class: 'add-ticket', what: `added chore ticket ${id} for the recurring chore ${arg}`, refs: [id, `recurring:${arg}`], reversible: true }, 'supervisor');
    RC.logStart(arg, st.slot, id, `ticket ${id}`);
    return out([header, `Wrote the chores ticket ${id}; start its worker as any chore ticket's (devteam.mjs worker ${id}). It finishes when ${id} merges, or is superseded.`, '', body].join('\n'));
  }
  if (sub === 'run') {
    supervisorOnly('recurring run');
    // then the failure pass, on a fresh read (so the runner's own lines count), even when another
    // runner held the lock (kit-168)
    if (flags.due === true && !arg) return Promise.resolve(recurringRunDue.run({ due: true })).then(() => { logCache = null; recurringFailures.note(); });
    if (arg && flags.draft === true) return recurringRunDue.run({ draft: arg });
    die('usage: recurring run --due | recurring run <name> --draft');
  }
  if (sub === 'due') {
    const c = recurringRunDue.checks();
    if (c.problem) die(c.problem);
    const l = recurringLock.read();
    const runner = recurringLock.live(l) ? { pid: l.pid, start: l.start, budget_s: l.budget_s, current: l.current ?? null } : null;
    const checks = c.checks.map(({ name, due, slot, next, start }) => ({ name, due, slot, next, start }));
    if (flags.json) return json({ checks, runner });
    return out([
      ...(checks.length ? checks.map((x) => `${x.name}  ${x.due ? 'due' : 'next'} ${x.next}  slot ${x.slot}`) : ['no checks on main']),
      runner ? `runner: pid ${runner.pid} since ${runner.start}${runner.current ? ` (${runner.current.name})` : ''}` : 'runner: none',
    ].join('\n'));
  }
  if (sub !== 'apply') die(usage);
  supervisorOnly('recurring apply');
  if (!arg) die('usage: recurring apply <qid>');
  const q = logGet(arg);
  if (q?.type !== 'question') die(`no question ${arg}`);
  if (q.class !== 'recurring-edit') die(`${arg} is a ${q.class ?? 'classless'} question; apply takes an answered recurring-edit question`);
  const v = questionView(q);
  if (v.status !== 'answered') die(`recurring apply: ${arg} is not a question the owner answered (it is ${v.status})`);
  const change = R.shown(v);
  if (!change) die(`${arg} showed no job change: ask again with --change`);
  const done = R.landed(arg);
  if (done) die(`${arg} already landed (${done.id})`);
  // words not read yet: ownerAnswer says how to read them
  if (v.in_words && !v.reading) ownerAnswer(arg, 'recurring apply');
  if (!R.live(v)) {
    const later = R.superseded(v);
    die(`${arg} can't approve a job change: ${later ? `superseded by ${later.qid}, asked later about ${later.name}` : `answered "${String(v.answer ?? '').slice(0, 80)}", not Yes`}`);
  }
  ownerAnswer(arg, 'recurring apply');
  if (!projectInRepo) die('the project dir is outside this repo, so it has no jobs file to apply to');
  const wt = path.join(mainRoot, '.worktrees', 'chore-recurring');
  if (!fs.existsSync(wt)) die('no worktree .worktrees/chore-recurring; devteam.mjs chore start recurring');
  const top = R.git(['rev-parse', '--show-toplevel'], { cwd: wt });
  if (!top.ok || realPath(top.out.trim()) !== realPath(wt)) die('.worktrees/chore-recurring is not a worktree (was it tidied away?): move what you wrote aside, then devteam.mjs chore start recurring');
  const base = mainJobs();
  // main's file as bytes, or null when main has none (read() has checked it is a plain 100644 blob)
  const sha = mainSha();
  const has = R.git(['rev-parse', '--verify', '-q', `${sha}:${P}`]);
  if (!has.ok && (has.timedOut || has.status !== 1)) die(`recurring apply: git rev-parse ${has.timedOut ? 'timed out' : 'failed'} reading main's ${P}; nothing was written`);
  let onMain = null;
  if (has.ok) {
    const b = R.git(['cat-file', 'blob', `${sha}:${P}`], { encoding: null });
    if (!b.ok) die(`recurring apply: git cat-file ${b.timedOut ? 'timed out' : 'failed'} reading main's ${P}; nothing was written`);
    onMain = b.out;
  }
  // the worktree's file: every directory down to it a real one (never a symlink, which would write
  // elsewhere), and the file a plain one or absent
  const segs = P.split('/');
  for (let i = 1; i < segs.length; i++) {
    const dir = segs.slice(0, i).join('/');
    let s = null;
    try { s = fs.lstatSync(path.join(wt, ...segs.slice(0, i))); } catch (e) { if (e.code !== 'ENOENT') die(`recurring apply: can't read .worktrees/chore-recurring/${dir} (${e.code ?? e.message})`); }
    if (!s || !s.isDirectory()) die(`recurring apply: .worktrees/chore-recurring/${dir} is ${s ? 'not a directory' : 'missing'}; devteam.mjs chore start recurring`);
  }
  const file = path.join(wt, ...segs);
  let here = null;
  let st = null;
  try { st = fs.lstatSync(file); } catch (e) { if (e.code !== 'ENOENT') die(`recurring apply: can't read .worktrees/chore-recurring/${P} (${e.code ?? e.message})`); }
  if (st) {
    if (!st.isFile() || st.mode & 0o111) die(`recurring apply: .worktrees/chore-recurring/${P} is not a plain file`);
    try { here = fs.readFileSync(file); } catch (e) { die(`recurring apply: can't read .worktrees/chore-recurring/${P} (${e.code ?? e.message})`); }
  }
  if (!(here === null && onMain === null) && !(here !== null && onMain !== null && here.equals(onMain))) die("the chore worktree's recurring.json already differs from main's: one answer per PR");
  // main's jobs with the change: a stop deleted, an edit in its place, an addition last
  const value = { ...base };
  for (const [n, e] of Object.entries(change)) { if (e === null) delete value[n]; else value[n] = e; }
  const text = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(file, text);
  // read back: the file holds exactly that text, and it reads as exactly that value
  let back = null;
  try { back = fs.readFileSync(file, 'utf8'); } catch {}
  const parsed = back === null ? null : R.parse(back, 'in the chore worktree');
  if (back !== text || parsed.problem || canonical(parsed.jobs) !== canonical(value)) die(`recurring apply: .worktrees/chore-recurring/${P} did not read back as written; check it, then devteam.mjs chore start recurring`);
  const how = (n) => (change[n] === null ? 'stopped' : Object.hasOwn(base, n) ? 'changed' : 'added');
  out([
    `wrote ${arg}'s change into .worktrees/chore-recurring/${P}:`,
    ...Object.keys(change).map((n) => `  ${n}: ${how(n)}`),
    'next:',
    '  devteam.mjs chore pr recurring --title "…"',
    `  devteam.mjs merge --chore recurring --approved ${arg}`,
  ].join('\n'));
}

// kit-install@1 (feature kit-package-dist): an instance pins the kit's npm package in two files, installs
// it verified beside the copy it runs, and from layout 2 runs it. The rules every package, merge, chore,
// dashboard and launcher step keeps:
// - Settings. package_name (default @sanctuarycomputer/devteam) and alpha (default true) are owner
//   settings. Every check reads package_name and upstream_repo from main's committed settings
//   (settingsAt(main)), never from a PR's head or loadSettings().
// - The pin pair. docs/devteam/package.json and docs/devteam/package-lock.json are packagePinPair's output
//   for the registry's manifest of the version, byte for byte. layout is the manifest's devteam.layout (1
//   or 2), read, never guessed: a manifest without one is refused, and so is one that disagrees with the
//   tag's launcher marker (below). For a PR that changes either file the expected version is
//   upstream_base at its head without the v; a pin naming another version is refused, and so is a PR
//   that deletes the pair (the fix: restore main's pair, or package pin <tag>).
// - npm. The calls are exactly npm view <name>@<version> [<field>] [--json], npm ci [--dry-run] and npm
//   audit signatures, each with --registry=<the registry>, --ignore-scripts, --prefix=<the folder it runs
//   in> and --workspaces=false, each once, and no other argument in any form (no second or scoped registry,
//   no --reg or --registry <url>, no ignore-scripts negation, no other prefix or workspace flag, no
//   --userconfig or --globalconfig). With the last two npm never walks up to a package.json, its workspaces,
//   its lock or an .npmrc above that folder (a workspace root above .kit would otherwise install its own
//   lock, bytes the pin never named), so a workspace root or an .npmrc above changes nothing and is not
//   refused (C4 runs real npm to show it). Each runs with npm_config_userconfig and npm_config_globalconfig naming
//   two different empty files (regular files; npm refuses one file for both), with no other variable whose
//   name starts with npm_config_ in any letter case in its environment: those two names are lower-case,
//   and NPM_CONFIG_USERCONFIG or any other spelling is another variable to drop (npm reads the prefix in
//   any letter case: npm_config_*, NPM_CONFIG_* and a mixed spelling such as Npm_Config_* alike, a scoped
//   npm_config_@scope:registry included), and in a folder the step made that holds no .npmrc: ci and
//   audit in .kit/<version>-<hash>/, view in its own folder made outside the checkout (mkdtemp under
//   os.tmpdir()) holding only a package.json the step writes ({}). An npm
//   older than 9.5 can't verify attestations: a finding before layout 2, a refusal from it. A registry
//   that can't be reached is not a refusal: a fetch or npm call that gets no answer in time, a network
//   error, or any status but 200 and 404 (a 5xx, a 429), and an npm call that fails with a network code
//   (ECONN*, ETIMEDOUT, EAI_AGAIN) or E5xx/E429, are unreachable, never a refusal. Unreachable is a finding
//   before layout 2; from it the step stops, changes nothing (current, verified.json and the pair stay as
//   they were, and nothing records the version as refused), and the next run tries again. An npm E404 for
//   the version is unpublished: a finding before layout 2, a refusal from it. EINTEGRITY is a refusal.
// - The registry is https://registry.npmjs.org/. DEVTEAM_NPM_REGISTRY, for tests, replaces it only when it
//   is exactly http://127.0.0.1:<port>/ (port 1 to 65535, no leading zero, the final slash, nothing after
//   it). Unset or empty, it is the public registry; any other value (localhost, [::1], https, a path) stops
//   the command with exit 1 naming the
//   variable, and is never used or passed over for the public one. Set, it is the --registry of every npm
//   call and the base of the kit's own fetches, and package status names it. It adds no reach: whoever
//   sets the kit's environment can already run code in it (NODE_OPTIONS, PATH). The kit's own fetches
//   never follow a redirect (redirect: 'manual'): a 3xx is unreachable, so no answer comes from another
//   host.
// - Provenance. The bundle at <registry>-/npm/v1/attestations/<name>@<version> is fetched once (15 s, at
//   most 1 MiB). Its guards, in order, each a refusal naming the first that fails: the fetch answers 200 or
//   404 (else unreachable, as above); not a 404 (no attestation); JSON with an attestations list;
//   exactly one entry whose predicateType is https://slsa.dev/provenance/v1; its bundle.dsseEnvelope.payload
//   is base64 of a JSON in-toto statement; subject is exactly one entry, whose digest.sha512 (128 hex) is
//   the integrity's sha512; predicate.buildDefinition.externalParameters.workflow has repository
//   https://github.com/<upstream_repo>, path .github/workflows/release.yml and ref refs/tags/v<version>;
//   predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit is the tag's commit in upstream_repo,
//   on its default branch. npm audit signatures must then pass on the installed tree and report the
//   package's attestation verified (its "has a verified attestation" line; passing on registry signatures
//   alone is a refusal from layout 2, a finding before): it checks the signature, the kit the claims. The
//   bundle the kit reads and the one npm verifies are fetched separately: a registry serving different
//   bytes to each is a named limit.
// - The install tree. docs/devteam/.kit/<version>-<first 12 hex of the integrity's sha512>/ holds the pair,
//   node_modules/<name>/ (and whatever else npm writes there) and verified.json. Folders are made under
//   withLock(.kit/.lock); current and the previous folder are kept, and a folder a live process holds open
//   is never removed.
// - current. docs/devteam/.kit/current is a relative symlink whose target is one folder's name, or, where
//   the file system holds no symlink, a file of at most 64 bytes holding that name and one newline; every
//   reader takes both, and switches it by an atomic rename. A name is <X.Y.Z>-<12 hex> and must be a
//   real folder (not a symlink) directly beside current. Anything else (an absolute or ../ target, a / in
//   the name, a missing folder, a folder that is a symlink, an empty file, a second line, a bigger file)
//   is no current: never followed, read as nothing installed.
// - Never committed. docs/devteam/.kit must be a real folder (lstat); a symlink or anything else there is
//   read as nothing installed. Its ignore line is .kit, with no slash, so a symlink of that name is ignored
//   too, and merge refuses a PR that adds or changes docs/devteam/.kit itself or any path under it, where
//   each of a path's first three components is compared as git compares .git on any file system:
//   case-insensitively, after Unicode NFC normalisation, with the code points HFS+ ignores removed (U+200C
//   to U+200F, U+202A to U+202E, U+206A to U+206F, U+FEFF), with a trailing run of dots and spaces dropped,
//   and a component that is the name's NTFS 8.3 short name (DEVTEA~<digit>, KIT~<digit>) matching too; a
//   component is cut at its first ':' (an NTFS stream: .kit::$INDEX_ALLOCATION, .kit:x) and a '\' is read
//   as a separator (.kit\x), as git's is_ntfs_dotgit does; so
//   .KIT/, Docs/DevTeam/.kit/, .kit./ and KIT~1/ are .kit. An install is only ever made on the machine, by
//   the step. The ignore line does not fold case on a case-sensitive file system; merge's refusal is what
//   stops .KIT.
// - verified.json: { v: 1, name, version, layout, integrity, integrity_ok, provenance_ok, provenance:
//   { repo (owner/name), workflow, ref, commit }, at (UTC, toISOString) }, in that order, at most 4 KiB.
//   The install step writes it last, by an atomic rename, only once both checks pass, so it never writes
//   an _ok that is false. A reader takes a folder as verified only when its record parses, holds every
//   field with its type, both _ok are true, and name, version, layout and integrity agree with the folder's
//   name and its pair; anything else (no record, a false _ok, a field missing or of another type, a
//   mismatch, too big) is unverified, and nothing runs or serves it.
// - The hub tree. The install step, run for a verified layout-2 version newer than the hub's current, also
//   installs it into ~/.devteam/hub/<version>-<hash>/ by the same step and checks, under
//   withLock(~/.devteam/hub/.lock), with its own verified.json, then switches ~/.devteam/hub/current the
//   same way. ~/.devteam/hub must be a real folder (lstat), and its current is read as .kit's is. The hub
//   keeps current and the previous folder. A layout-1 install never touches it.
// - The launcher. Its second line is exactly // devteam-launcher: kit-package@1. Merge's launcher-tag rule
//   looks for it in a tag's docs/devteam/scripts/devteam.mjs (that tag is layout 2), and the launcher
//   refuses to run a target that carries it.
// - The command. devteam.mjs package pin <tag> | package install [--version v] [--into <dir>] (no project
//   needed) | package status [--json].
// The fakes: test/fixtures/kit-install/ (the trees, the pair, the registry's packages) and
// test/lib/fake-registry.mjs (a loopback registry and an npm that keeps these rules or says which it saw
// broken). packagePinPair is loaded alone by its test: it names nothing outside its body, and no line of
// it is a bare closing brace but its last.
export function packagePinPair(pin) {
  const no = (why) => { throw new Error(`packagePinPair: ${why}`); };
  const KEYS = ['name', 'version', 'integrity', 'resolved', 'layout'];
  if (!pin || typeof pin !== 'object' || Array.isArray(pin)) no('takes { name, version, integrity, resolved, layout }');
  if (Object.keys(pin).some((k) => !KEYS.includes(k))) no('takes only name, version, integrity, resolved and layout');
  const { name, version, integrity, resolved, layout } = pin;
  if (typeof name !== 'string' || name.length > 214 || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) no('name is not an npm package name');
  if (typeof version !== 'string' || !/^(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})$/.test(version)) no('version is not X.Y.Z');
  if (typeof integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)) no('integrity is not one sha512');
  if (resolved !== `https://registry.npmjs.org/${name}/-/${name.slice(name.indexOf('/') + 1)}-${version}.tgz`) no("resolved is not the public registry's tarball of name@version");
  if (layout !== 1 && layout !== 2) no('layout is not 1 or 2');
  const dependencies = { [name]: version };
  const text = (o) => `${JSON.stringify(o, null, 2)}\n`;
  return {
    'package.json': text({ name: 'devteam-instance', private: true, dependencies, devteam: { layout } }),
    'package-lock.json': text({ name: 'devteam-instance', lockfileVersion: 3, requires: true, packages: { '': { name: 'devteam-instance', dependencies }, [`node_modules/${name}`]: { version, resolved, integrity } } }),
  };
}
// package pin|install|status (kit-install@1). Until each is built, it says so.
export function cmdPackage() {
  const sub = positional[0];
  if (['pin', 'install', 'status'].includes(sub)) die(`package ${sub}: not built yet`);
  die('usage: package pin <tag> | package install [--version v] [--into <dir>] | package status [--json]');
}

