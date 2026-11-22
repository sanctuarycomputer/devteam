// Recurring chores (kit-164; design recurring-checks-and-chores-under-upkeep, Chores, C1, C2, C5, P5). A
// chore is due by its slots as a check is; `recurring start` begins it (the supervisor's in a chore
// worktree, a worker's as a chores ticket) and logs a started run; it finishes when its ref merges, with
// `recurring done --nothing | --abandoned` (a supervisor chore's only), when a supervisor chore's PR is
// closed unmerged, or when a worker chore's ticket is superseded. metrics raises recurring-due,
// recurring-overdue and recurring-stuck; dashboard-data's upkeep.recurring and `peek recurring` carry
// chores. Only the supervisor's detector recurring lines count. Each fixture is a monoFixture whose main
// holds project/recurring.json. Run with TMUX unset: no fixture here starts a tmux server. Every child
// has a timeout.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { monoFixture, write, kit, line } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const PROJ = 'docs/devteam/project';
const JOBS = `${PROJ}/recurring.json`;
const RUN = 'docs/devteam/run';
const T_OUT = 120000;
const DAY = 86400000;
const HOUR = 3600000;
const FX = path.join(kit, '..', '..', 'test', 'fixtures', 'recurring');
const SLOTS = JSON.parse(fs.readFileSync(path.join(FX, 'slots.json'), 'utf8'));
const SRC = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
const SUPERVISOR_MD = fs.readFileSync(path.join(kit, 'process', 'supervisor.md'), 'utf8');
const J = JSON.stringify;
const iso = (ms) => new Date(ms).toISOString();
const isoSec = (ms) => `${iso(ms).slice(0, 19)}Z`;
const ymd = (ms) => iso(ms).slice(0, 10).replace(/-/g, '');
const stamp = (at) => `${at.slice(0, 10).replace(/-/g, '')}-${at.slice(11, 23).replace(/[:.]/g, '')}`;
const midnight = (ms) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };

const chore = (extra = {}) => ({ kind: 'chore', title: 'A chore', what: 'done on a schedule', every: '1d', by: 'supervisor', prompt: 'Tidy the branches.\nSay what you removed.', ...extra });
const wchore = (extra = {}) => chore({ by: 'worker', title: 'A worker chore', component: 'ops', touches: ['ops/**'], done_when: ['the chore is done'], prompt: 'Bump the pins in ops/.', ...extra });

// The consumed contract's shapes (C5), as test/recurring-failures.test.mjs copies them from
// test/recurring-contract.test.mjs; schemaErrors is cut from the kit's own source.
const schemaErrors = new Function(`${/\nconst asList = .*\n/.exec(SRC)[0]}${/\nfunction schemaErrors\(schema, value, where\) \{[\s\S]*?\n\}\n/.exec(SRC)[0]}; return schemaErrors;`)();
const ISO = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$';
const str = { type: 'string' };
const time = { type: 'string', pattern: ISO };
const closed = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const REGISTERED = { type: ['object', 'null'], properties: { qid: { type: 'string', pattern: '^q-' }, at: time }, required: ['qid', 'at'], additionalProperties: false };
const PEEK_SHAPE = closed({
  name: str,
  entry: { type: 'object', properties: { kind: { enum: ['check', 'chore'] }, title: str, what: str, every: str, registered: REGISTERED }, required: ['kind', 'title', 'what', 'every', 'registered'] },
  runs: { type: 'array', maxItems: 20, items: closed({ status: { enum: ['pass', 'fail', 'error', 'started', 'done', 'nothing', 'abandoned'] }, at: time, slot: time, seconds: { type: ['number', 'null'], minimum: 0 }, excerpt: { type: ['string', 'null'], maxLength: 200 }, ref: { type: ['string', 'null'], minLength: 1 } }) },
});
const ENTRY_SHAPE = closed({
  name: str, title: str, what: str, kind: { enum: ['check', 'chore'] }, by: { enum: ['supervisor', 'worker', null] },
  every: str, on: { type: ['string', 'integer', 'null'] }, at: { type: ['string', 'null'] },
  state: { enum: ['passing', 'failing', 'due', 'started', 'overdue', 'held', 'never'] }, fails_in_a_row: { type: 'integer', minimum: 0 },
  last: { type: ['object', 'null'], properties: { status: { enum: ['pass', 'fail', 'error', 'started', 'done', 'nothing', 'abandoned'] }, at: time, seconds: { type: ['number', 'null'], minimum: 0 }, excerpt: { type: ['string', 'null'], maxLength: 200 } }, required: ['status', 'at', 'seconds', 'excerpt'], additionalProperties: false },
  next_at: { type: ['string', 'null'], pattern: ISO }, ticket: { type: ['string', 'null'] }, registered: REGISTERED,
  signals: { type: 'array', items: closed({ kind: { enum: ['flapping', 'erroring', 'slow', 'failing-long', 'idle', 'overdue', 'quiet'] }, since: time, text: str, may: str, evidence: { type: 'array', minItems: 1, items: { type: 'string', pattern: '^o-' } } }) },
});

// The kit's recurringNextSlot and recurringChores, cut from its source: schedule names nothing else.
function choresFn() {
  const next = /\nfunction recurringNextSlot\([\s\S]*?\n\}\n/.exec(SRC);
  const rc = /\nconst recurringChores = Object\.freeze\(\{[\s\S]*?\n\}\);\n/.exec(SRC);
  assert.ok(next && rc, 'devteam.mjs defines recurringNextSlot and recurringChores');
  return new Function(`${next[0]}${rc[0]}; return recurringChores;`)();
}

// A fixture: each job asked and answered Yes, its landing act at reg, then main holds the jobs, committed
// at reg (T.q: each job's qid). forge github with a gh first on PATH that answers `pr list` from
// gh-prs.json in the fixture (and logs every call) when gh is true.
function setup(name, jobs, { gh = false, reg = NOW - 10 * DAY } = {}) {
  const F = monoFixture(`rc-${name}`);
  const { old } = F;
  const g = (args, cwd = old) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim();
  const bin = path.join(F.base, 'bin');
  const ghPrs = path.join(F.base, 'gh-prs.json');
  const ghLog = path.join(F.base, 'gh-calls.log');
  if (gh) {
    F.edit((j) => { j.forge = 'github'; });
    g(['commit', '-qam', 'forge github']);
    g(['push', '-q', 'origin', 'main']);
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(ghPrs, '{}\n');
    // pr list --head <branch>: that branch's PRs from gh-prs.json ({ "<branch>": [ … ] }), [] for any other
    fs.writeFileSync(path.join(bin, 'gh'), `#!${process.execPath}\nconst fs = require('fs');\nconst a = process.argv.slice(2);\nfs.appendFileSync(${J(ghLog)}, a.join(' ') + '\\n');\nif (a[0] !== 'pr' || a[1] !== 'list') process.exit(1);\nconst map = JSON.parse(fs.readFileSync(${J(ghPrs)}, 'utf8'));\nconst h = a[a.indexOf('--head') + 1];\nprocess.stdout.write(JSON.stringify(map[h] ?? []));\n`, { mode: 0o755 });
  }
  const DT = path.join(old, 'docs/devteam/scripts/devteam.mjs');
  const env = (extra = {}) => { const e = { ...F.env(SUP), ...(gh ? { PATH: `${bin}${path.delimiter}${process.env.PATH}` } : {}), ...extra }; delete e.DEVTEAM_TICKET; return e; };
  const dt = (args, extra = {}) => { const r = spawnSync(process.execPath, [DT, ...args], { cwd: old, env: env(extra), encoding: 'utf8', timeout: T_OUT }); return { status: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim(), text: `${r.stdout ?? ''}\n${r.stderr ?? ''}` }; };
  const ok = (args, extra) => { const r = dt(args, extra); assert.equal(r.status, 0, `${args.join(' ')}: ${r.text}`); return r.out; };
  const logDir = path.join(old, RUN, 'log');
  const allLines = () => (fs.existsSync(logDir) ? fs.readdirSync(logDir) : []).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  const runLines = (name) => allLines().filter((l) => l.type === 'observation' && l.kind === 'recurring-run' && l.subject === `recurring:${name}`).sort((a, b) => a.at.localeCompare(b.at));
  const ticketsOf = (name) => allLines().filter((l) => l.type === 'ticket' && l.op === 'new' && new RegExp(`-recurring-${name}$`).test(l.id));
  let n = 0;
  // a line as `by` would have written it at ms, in its writer's file
  const hand = (by, o, ms) => {
    const t = iso(ms + (n++ % 1000));
    const id = o.id ?? `${{ observation: 'o', act: 'a', ticket: 't' }[o.type]}-${stamp(t)}-${by}`;
    const file = ['owner', 'supervisor'].includes(by) ? `${by}-${t.slice(0, 7)}.jsonl` : `${by}.jsonl`;
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, file), line({ op: 'new', ...(by === 'owner' ? { channel: 'cli' } : {}), ...o, id, at: t, by }));
    return id;
  };
  // a chore's run line (started, nothing, abandoned), as by wrote it at ms
  const addLine = (name, { status = 'started', slot, ref, at, by = 'supervisor', detector = 'recurring', detail = `${name}: ${status}` }) => hand(by, {
    type: 'observation', source: 'recurring', kind: 'recurring-run', subject: `recurring:${name}`, ...(detector ? { detector } : {}), detail, severity: 0, valence: 0,
    source_key: `recurring:${name}:${slot}:${status}:${ref}:${n}`, run: { status, slot, ref },
  }, at);
  // a merge-chore act landing the chore branch ref at ms, as merge --chore writes it
  const mergeChore = (ref, ms) => hand('supervisor', { type: 'act', class: 'merge-chore', what: `merged ${ref} at ${'0'.repeat(40)}`, refs: [ref], reversible: false }, ms);
  // a job registered through an answered recurring-edit question and its landing act, dated at ms
  const registerYes = (name, entry, ms) => {
    const q = /q-[0-9]+-[0-9]+-supervisor/.exec(ok(['ask', '--class', 'recurring-edit', '--question', `Should I add the job ${name}?`, '--recommendation', 'Yes', '--change', JSON.stringify({ recurring: { [name]: entry } })]))?.[0];
    assert.ok(q, 'the question was asked');
    const ownerEnv = { ...F.env() };
    delete ownerEnv.DEVTEAM_ROLE;
    delete ownerEnv.DEVTEAM_TICKET;
    const r = spawnSync(process.execPath, [DT, 'answer', q, 'Yes'], { cwd: old, env: ownerEnv, encoding: 'utf8', timeout: T_OUT });
    assert.equal(r.status, 0, r.stderr);
    hand('supervisor', { type: 'act', class: 'merge-chore', what: 'merged chore-recurring', refs: ['chore-recurring'], approved_by: q, reversible: true }, ms);
    return q;
  };
  const metrics = () => JSON.parse(ok(['metrics', '--json']));
  const finding = (kind, name) => metrics().findings.filter((f) => f.kind === kind && f.subject === `recurring:${name}`);
  const data = () => JSON.parse(ok(['dashboard-data']));
  const entryOf = (name) => data().upkeep.recurring.entries.find((e) => e.name === name) ?? null;
  const peek = (name) => JSON.parse(ok(['peek', 'recurring', name, '--json']));
  const prs = (map) => fs.writeFileSync(ghPrs, `${JSON.stringify(map)}\n`);
  const ghCalls = () => (fs.existsSync(ghLog) ? fs.readFileSync(ghLog, 'utf8').split('\n').filter(Boolean) : []);
  // Upkeep's hold, set as the owner (no DEVTEAM_ROLE)
  const hold = (mode) => {
    const ownerEnv = { ...F.env() };
    delete ownerEnv.DEVTEAM_ROLE;
    delete ownerEnv.DEVTEAM_TICKET;
    const r = spawnSync(process.execPath, [DT, 'goal', 'hold', 'upkeep', mode, '--owner', ...(mode === 'park' ? ['--reason', 'a test'] : [])], { cwd: old, env: ownerEnv, encoding: 'utf8', timeout: T_OUT });
    assert.equal(r.status, 0, `goal hold upkeep ${mode}: ${r.stderr}`);
  };
  const q = {};
  for (const [n, e] of Object.entries(jobs)) q[n] = registerYes(n, e, reg);
  write(path.join(old, JOBS), `${JSON.stringify(jobs, null, 2)}\n`);
  g(['add', '-A']);
  execFileSync('git', ['commit', '-qm', 'main: jobs'], { cwd: old, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, env: { ...process.env, GIT_COMMITTER_DATE: iso(reg), GIT_AUTHOR_DATE: iso(reg) } });
  g(['push', '-q', 'origin', 'main']);
  g(['fetch', '-q', 'origin']);
  return { ...F, q, g, DT, env, dt, ok, allLines, runLines, ticketsOf, hand, addLine, mergeChore, registerYes, metrics, finding, data, entryOf, peek, prs, ghCalls, hold };
}

// One fixture per group, made on its first use and removed after the file; a group's tests run in order.
const made = [];
after(() => { for (const F of made) try { F.done(); } catch {} });
const group = (make) => { let v = null; return () => { if (!v) { v = make(); made.push(v); } return v; }; };
const NOW = Date.now();

// ===== DW2: due, overdue, and the slots =====
const due = group(() => {
  const jobs = { weekly: chore({ every: '7d' }), late: chore({ every: '7d' }) };
  const T = setup('due', jobs, { reg: NOW - 30 * DAY });
  // weekly: its last run started 7 days ago and merged; late: 9 days ago and merged (2 days past its slot)
  T.addLine('weekly', { slot: iso(NOW - 30 * DAY), ref: `chore-recurring-weekly-${ymd(NOW - 7 * DAY)}`, at: NOW - 7 * DAY - 60000 });
  T.mergeChore(`chore-recurring-weekly-${ymd(NOW - 7 * DAY)}`, NOW - 7 * DAY + HOUR);
  T.addLine('late', { slot: iso(NOW - 30 * DAY), ref: `chore-recurring-late-${ymd(NOW - 9 * DAY)}`, at: NOW - 9 * DAY });
  T.mergeChore(`chore-recurring-late-${ymd(NOW - 9 * DAY)}`, NOW - 9 * DAY + HOUR);
  return T;
});

test('C1: a chore every 7d whose last run started 7 days ago raises recurring-due (medium), not recurring-overdue', () => {
  const T = due();
  const f = T.finding('recurring-due', 'weekly');
  assert.equal(f.length, 1, 'recurring-due for weekly');
  assert.equal(f[0].severity, 'medium');
  assert.match(f[0].suggestion, /recurring start weekly/);
  assert.equal(T.finding('recurring-overdue', 'weekly').length, 0, 'not overdue inside its grace day');
});

test('C2: past grace_days after its slot it raises recurring-overdue instead of recurring-due', () => {
  const T = due();
  assert.equal(T.finding('recurring-overdue', 'late').length, 1, 'recurring-overdue for late');
  assert.equal(T.finding('recurring-due', 'late').length, 0, 'not recurring-due as well');
});

test("C3: a chore's schedule follows each chore case of test/fixtures/recurring/slots.json, its runs read from their starts", () => {
  const RC = choresFn();
  const cases = SLOTS.cases.filter((c) => c.entry.kind === 'chore');
  assert.ok(cases.length >= 4);
  for (const c of cases) {
    const landings = [{ at: c.land, entry: c.entry }, ...(c.edits ?? [])];
    const r = RC.schedule(landings, c.runs.map((x) => ({ slot: x.slot, start: x.at, status: x.status })), Date.parse(c.now));
    assert.equal(r.due, c.due, `${c.case}: due`);
    assert.equal(Date.parse(r.next), Date.parse(c.next), `${c.case}: next ${r.next}, expected ${c.next}`);
  }
});

test('C3b: a started run not finished keeps a chore from coming due when its slots pass; once it finishes, it is due for the latest slot', () => {
  const RC = choresFn();
  const land = [{ at: '2026-11-02T10:00:00Z', entry: chore({ every: '1w', on: 'mon' }) }];
  const open = [{ slot: '2026-11-09T00:00:00Z', start: '2026-11-09T08:00:00Z', status: 'started' }];
  const a = RC.schedule(land, open, Date.parse('2026-11-25T12:00:00Z'));
  assert.equal(a.due, false, 'not due while its run is open, two Mondays later');
  const b = RC.schedule(land, [{ ...open[0], status: 'done' }], Date.parse('2026-11-25T12:00:00Z'));
  assert.equal(b.due, true, 'due once it finished');
  assert.equal(b.slot, '2026-11-23T00:00:00Z', 'for the latest Monday that passed');
});

// ===== DW3: started and not merged, then merged =====
const merging = group(() => {
  const jobs = { daily: chore({ every: '1d', at: '00:00' }) };
  const T = setup('merging', jobs);
  T.ref = `chore-recurring-daily-${ymd(NOW - 3 * DAY)}`;
  T.addLine('daily', { slot: iso(midnight(NOW - 3 * DAY)), ref: T.ref, at: midnight(NOW - 3 * DAY) + HOUR });
  return T;
});

test('C4: a chore started and not merged is not due again when its next slots pass', () => {
  const T = merging();
  assert.equal(T.entryOf('daily')?.state, 'started', 'its state is started');
  assert.equal(T.finding('recurring-due', 'daily').length + T.finding('recurring-overdue', 'daily').length, 0, 'no recurring-due or -overdue while it is started');
});

test('C5: once it merges, it is due once, for the latest slot that passed', () => {
  const T = merging();
  T.mergeChore(T.ref, NOW - 60000);
  const e = T.entryOf('daily');
  assert.ok(['due', 'overdue'].includes(e?.state), `due again (${e?.state})`);
  assert.equal(e.next_at, isoSec(midnight(NOW)), "for today's slot, the latest");
  assert.equal(T.finding('recurring-due', 'daily').length + T.finding('recurring-overdue', 'daily').length, 1, 'one finding, for one slot');
});

// ===== DW4: worker chores end only through their ticket =====
const worker = group(() => {
  const jobs = { pins: wchore({ every: '1d' }), bump: wchore({ every: '1d' }), lint: wchore({ every: '1d' }) };
  const T = setup('worker', jobs, { gh: true });
  return T;
});

test('C6: a worker chore whose ticket is superseded reads as abandoned, and is due again by its slots', () => {
  const T = worker();
  // as recurring start writes them, two days back, so the run's next slot has passed
  const id = 'ops-01-recurring-pins';
  const tk = (tid, title) => ({ type: 'ticket', feature: 'chores', id: tid, title, component: 'ops', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['ops/**'], done_when: ['the chore is done'] });
  T.hand('supervisor', tk(id, 'Recurring: A worker chore'), NOW - 2 * DAY);
  T.hand('supervisor', { type: 'act', class: 'add-ticket', what: `added chore ticket ${id}`, refs: [id, 'recurring:pins'], reversible: true }, NOW - 2 * DAY);
  T.addLine('pins', { slot: iso(NOW - 10 * DAY), ref: id, at: NOW - 2 * DAY });
  T.hand('supervisor', tk('ops-02-other', 'Another way'), NOW - DAY);
  assert.equal(T.peek('pins').runs[0].status, 'started', 'live before');
  T.ok(['ticket', 'set', id, '--json', J({ superseded_by: 'ops-02-other' })]);
  assert.equal(T.peek('pins').runs[0].status, 'abandoned', 'its run reads as abandoned');
  assert.ok(['due', 'overdue'].includes(T.entryOf('pins').state), 'due again');
});

// ===== DW5: supervisor chores that end without a merge, and recurring-stuck =====
const sup = group(() => {
  const jobs = { tidy: chore({ every: '1d' }), drop: chore({ every: '1d' }), slow: chore({ every: '1d' }) };
  const T = setup('sup', jobs, { gh: true });
  T.addLine('tidy', { slot: iso(NOW - 10 * DAY), ref: `chore-recurring-tidy-${ymd(NOW - 2 * DAY)}`, at: NOW - 2 * DAY });
  T.addLine('drop', { slot: iso(NOW - 10 * DAY), ref: `chore-recurring-drop-${ymd(NOW - 2 * DAY)}`, at: NOW - 2 * DAY });
  T.addLine('slow', { slot: iso(NOW - 10 * DAY), ref: `chore-recurring-slow-${ymd(NOW - 2 * DAY)}`, at: NOW - 2 * DAY });
  return T;
});

test('C9b: dashboard-data, metrics and peek never ask gh, even with a supervisor chore open', () => {
  const T = sup();
  T.data();
  assert.deepEqual(T.ghCalls(), [], 'no gh call from dashboard-data');
  T.metrics();
  assert.deepEqual(T.ghCalls(), [], 'no gh call from metrics');
  T.peek('tidy');
  assert.deepEqual(T.ghCalls(), [], 'no gh call from peek');
});

test('C11: recurring-stuck (medium) for a started run not finished grace_days after its start', () => {
  const T = sup();
  const f = T.finding('recurring-stuck', 'slow');
  assert.equal(f.length, 1, 'recurring-stuck for slow');
  assert.equal(f[0].severity, 'medium');
  assert.match(f[0].detail, new RegExp(`chore-recurring-slow-${ymd(NOW - 2 * DAY)}`));
});

// ===== DW6, DW8 (merge --chore, --nothing): a supervisor chore start to finish =====
const start = group(() => {
  const jobs = { sweep: chore({ every: '1d' }), noop: chore({ every: '1d' }), land: chore({ every: '1d' }), 'deps-02-bump': chore({ every: '1d' }) };
  const T = setup('start', jobs);
  return T;
});

// ===== DW7, DW8 (the ticket's merge), DW12: a worker chore =====
const wstart = group(() => {
  const jobs = { deps: wchore({ every: '1d', touches: ['ops/**', 'web/package.json'], done_when: ['the pins are current', 'the suite passes'] }), wnone: wchore({ every: '1d' }), wdone: wchore({ every: '1d' }), wstray: wchore({ every: '1d' }) };
  const T = setup('wstart', jobs);
  T.hand('supervisor', { type: 'ticket', feature: 'chores', id: 'ops-04-older', title: 'older', component: 'ops', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['ops/x'], done_when: ['x'] }, NOW - 20 * DAY);
  return T;
});

// ===== refusals the done-whens imply =====
const refuse = group(() => {
  const jobs = { kept: chore({ every: '1d' }), chk: { kind: 'check', title: 'A check', what: 'runs', every: '1d', run: 'true' } };
  const T = setup('refuse', jobs);
  // a job put on main by a plain commit, with no answer
  const file = path.join(T.old, JOBS);
  write(file, `${JSON.stringify({ ...jobs, loose: chore({ every: '1d' }) }, null, 2)}\n`);
  T.g(['commit', '-qam', 'main: a job with no answer']);
  T.g(['push', '-q', 'origin', 'main']);
  T.g(['fetch', '-q', 'origin']);
  return T;
});

// ===== DW9, DW11: holds, and the dashboard's states =====
const held = group(() => {
  const jobs = { ca: chore({ every: '1d' }), cb: chore({ every: '1d' }), cc: chore({ every: '7d' }), cd: chore({ every: '7d' }) };
  const T = setup('held', jobs, { reg: NOW - 30 * DAY });
  // ca: due (its last run a day back); cb: started; cc: overdue; cd: due, then held
  T.addLine('ca', { slot: iso(NOW - 30 * DAY), ref: `chore-recurring-ca-${ymd(NOW - DAY - HOUR)}`, at: NOW - DAY - HOUR });
  T.mergeChore(`chore-recurring-ca-${ymd(NOW - DAY - HOUR)}`, NOW - DAY);
  T.addLine('cb', { slot: iso(NOW - 30 * DAY), ref: `chore-recurring-cb-${ymd(NOW - HOUR)}`, at: NOW - HOUR });
  T.addLine('cc', { slot: iso(NOW - 30 * DAY), ref: `chore-recurring-cc-${ymd(NOW - 9 * DAY)}`, at: NOW - 9 * DAY });
  T.mergeChore(`chore-recurring-cc-${ymd(NOW - 9 * DAY)}`, NOW - 9 * DAY + HOUR);
  T.addLine('cd', { slot: iso(NOW - 30 * DAY), ref: `chore-recurring-cd-${ymd(NOW - 7 * DAY - HOUR)}`, at: NOW - 7 * DAY - HOUR });
  T.mergeChore(`chore-recurring-cd-${ymd(NOW - 7 * DAY - HOUR)}`, NOW - 7 * DAY);
  return T;
});

test('C19: dashboard-data upkeep.recurring lists chore entries with states due, started and overdue, in the fixture shape', () => {
  const T = held();
  const es = T.data().upkeep.recurring.entries;
  const by = Object.fromEntries(es.map((e) => [e.name, e]));
  assert.deepEqual(['ca', 'cb', 'cc'].map((n) => by[n]?.state), ['due', 'started', 'overdue']);
  for (const n of ['ca', 'cb', 'cc', 'cd']) assert.deepEqual(schemaErrors(ENTRY_SHAPE, by[n], n), [], `${n} meets the entry shape`);
  assert.deepEqual([by.cb.kind, by.cb.by, by.cb.last.status, by.cb.ticket], ['chore', 'supervisor', 'started', null]);
});

// ===== DW10: lines that don't count =====
const forged = group(() => {
  const jobs = { solo: chore({ every: '1d' }), live: chore({ every: '1d' }) };
  const T = setup('forged', jobs, { reg: NOW - 6 * HOUR });
  T.liveRef = `chore-recurring-live-${ymd(NOW - HOUR)}`;
  T.addLine('live', { slot: iso(NOW - 6 * HOUR), ref: T.liveRef, at: NOW - HOUR });
  return T;
});

test('C18: a started line written by a ticket session, or by the supervisor without detector recurring, starts nothing', () => {
  const T = forged();
  T.addLine('solo', { slot: iso(NOW - 6 * HOUR), ref: `chore-recurring-solo-${ymd(NOW)}`, at: NOW - 60000, by: 'ops-01-x' });
  T.addLine('solo', { slot: iso(NOW - 6 * HOUR), ref: `chore-recurring-solo-${ymd(NOW)}`, at: NOW - 50000, detector: null });
  T.ok(['observe', '--subject', 'recurring:solo', '--kind', 'recurring-run', '--detector', 'recurring', '--detail', 'started by hand']);
  assert.equal(T.entryOf('solo').state, 'due', 'still due');
  assert.equal(T.finding('recurring-due', 'solo').length, 1);
});

test('C18b: a nothing or abandoned line written by a ticket session, or without detector recurring, closes nothing', () => {
  const T = forged();
  T.addLine('live', { status: 'nothing', slot: iso(NOW - 6 * HOUR), ref: T.liveRef, at: NOW - 30000, by: 'ops-01-x' });
  T.addLine('live', { status: 'abandoned', slot: iso(NOW - 6 * HOUR), ref: T.liveRef, at: NOW - 20000, detector: null });
  T.ok(['observe', '--subject', 'recurring:live', '--kind', 'recurring-run', '--detector', 'recurring', '--detail', 'nothing to do']);
  assert.equal(T.entryOf('live').state, 'started', 'still started');
  assert.equal(T.peek('live').runs[0].status, 'started');
});

// ===== DW13: peek recurring for chores =====
const pk = group(() => {
  const jobs = { sv: chore({ every: '1d' }), wk: wchore({ every: '1d' }) };
  const T = setup('peek', jobs);
  const r1 = `chore-recurring-sv-${ymd(NOW - 3 * DAY)}`;
  T.addLine('sv', { slot: iso(NOW - 10 * DAY), ref: r1, at: NOW - 3 * DAY });
  T.addLine('sv', { status: 'nothing', slot: iso(NOW - 10 * DAY), ref: r1, at: NOW - 3 * DAY + HOUR, detail: 'nothing to tidy' });
  T.addLine('sv', { slot: iso(NOW - 2 * DAY), ref: `chore-recurring-sv-${ymd(NOW - 2 * DAY)}`, at: NOW - 2 * DAY + HOUR });
  T.ok(['recurring', 'start', 'wk']);
  return T;
});

// ===== DW14: supervisor.md =====