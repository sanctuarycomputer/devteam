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

test('C7: a worker chore ticket written but not started is live: no second start, no second ticket', () => {
  const T = worker();
  T.ok(['recurring', 'start', 'bump']);
  const r = T.dt(['recurring', 'start', 'bump']);
  assert.equal(r.status, 1, 'a second start is refused');
  assert.match(r.err, /already started \(ops-\d+-recurring-bump/);
  assert.equal(T.ticketsOf('bump').length, 1, 'one ticket');
  assert.equal(T.entryOf('bump').state, 'started');
});

test('C8: a worker chore ticket whose PR was closed is still live, and gh is never asked about it', () => {
  const T = worker();
  T.ok(['recurring', 'start', 'lint']);
  const id = T.ticketsOf('lint')[0].id;
  T.prs({ [id]: [{ number: 4, closedAt: iso(NOW - HOUR), mergedAt: null }], [`ticket/${id}`]: [{ number: 4, closedAt: iso(NOW - HOUR), mergedAt: null }] });
  assert.equal(T.dt(['recurring', 'start', 'lint']).status, 1, 'still started');
  T.metrics();
  assert.equal(T.peek('lint').runs[0].status, 'started');
  assert.equal(T.ticketsOf('lint').length, 1);
  assert.ok(!T.ghCalls().some((c) => c.includes(id)), 'no gh call names the ticket');
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

test('C9: a supervisor chore whose chore-recurring-<name>-<date> PR is closed unmerged is read as abandoned by recurring start, and is due again by its slots: it starts again', () => {
  const T = sup();
  const old = `chore-recurring-tidy-${ymd(NOW - 2 * DAY)}`;
  T.prs({ [old]: [{ number: 9, closedAt: iso(NOW - DAY), mergedAt: null }], [`chore-recurring-drop-${ymd(NOW - 2 * DAY)}`]: [{ number: 10, closedAt: iso(NOW - DAY), mergedAt: '2026-01-01T00:00:00Z' }] });
  T.ok(['recurring', 'start', 'tidy']);
  assert.ok(T.ghCalls().some((c) => c.includes(`--head ${old}`) && c.includes('--state closed')), 'gh asked about its branch');
  const runs = T.peek('tidy').runs;
  assert.deepEqual(runs.map((r) => [r.status, r.ref]), [['started', `chore-recurring-tidy-${ymd(Date.now())}`], ['abandoned', old]], 'the old run abandoned, a new one started');
  const r = T.dt(['recurring', 'start', 'drop']);
  assert.match(r.err, /already started/, 'a PR closed by its merge is not abandoned');
});

test('C10: recurring done <name> --abandoned "<why>" logs status abandoned with that reason (not nothing), and the chore is due again', () => {
  const T = sup();
  T.ok(['recurring', 'done', 'drop', '--abandoned', 'the branch was already tidy']);
  const l = T.runLines('drop').at(-1);
  assert.equal(l.run.status, 'abandoned');
  assert.equal(l.detail, 'the branch was already tidy');
  assert.equal(l.by, 'supervisor');
  assert.equal(l.detector, 'recurring');
  assert.equal(l.run.ref, `chore-recurring-drop-${ymd(NOW - 2 * DAY)}`);
  assert.ok(['due', 'overdue'].includes(T.entryOf('drop').state), 'due again');
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

test('C12: recurring start on a by: supervisor chore opens .worktrees/chore-recurring-<name>-<yyyymmdd>, prints the prompt headed with the approving qid, and logs started with that ref', () => {
  const T = start();
  const o = T.ok(['recurring', 'start', 'sweep']);
  const ref = `chore-recurring-sweep-${ymd(Date.now())}`;
  assert.ok(fs.existsSync(path.join(T.old, '.worktrees', ref, '.git')), 'the chore worktree');
  assert.match(o.split('\n')[0], new RegExp(T.q.sweep), 'headed with the approving qid');
  assert.ok(o.indexOf('Tidy the branches.\nSay what you removed.') > o.indexOf(T.q.sweep), 'then the prompt');
  const l = T.runLines('sweep').at(-1);
  assert.deepEqual([l.by, l.detector, l.source, l.run.status, l.run.ref], ['supervisor', 'recurring', 'recurring', 'started', ref]);
  assert.match(l.run.slot, /^\d{4}-\d{2}-\d{2}T/);
});

test('C14: the run reads as done once merge --chore of that slug lands', () => {
  const T = start();
  T.ok(['recurring', 'start', 'land']);
  const ref = `chore-recurring-land-${ymd(Date.now())}`;
  const wt = path.join(T.old, '.worktrees', ref);
  write(path.join(wt, PROJ, 'notes', 'tidy.md'), 'tidied\n');
  T.ok(['chore', 'pr', ref.replace(/^chore-/, ''), '--title', 'tidied']);
  T.ok(['merge', '--chore', ref.replace(/^chore-/, '')]);
  assert.equal(T.peek('land').runs[0].status, 'done');
  assert.notEqual(T.entryOf('land').state, 'started');
});

test('C16: recurring done <name> --nothing "<why>" logs status nothing and removes an empty worktree', () => {
  const T = start();
  T.ok(['recurring', 'start', 'noop']);
  const ref = `chore-recurring-noop-${ymd(Date.now())}`;
  assert.ok(fs.existsSync(path.join(T.old, '.worktrees', ref)));
  T.ok(['recurring', 'done', 'noop', '--nothing', 'no branch to tidy']);
  const l = T.runLines('noop').at(-1);
  assert.deepEqual([l.run.status, l.detail, l.run.ref], ['nothing', 'no branch to tidy', ref]);
  assert.ok(!fs.existsSync(path.join(T.old, '.worktrees', ref)), 'the empty worktree is removed');
  assert.equal(T.peek('noop').runs[0].status, 'nothing');
});

test('C23: a chore whose name has a digit word (deps-02-bump) still finishes by its merge: its branch is never read as a ticket', () => {
  const T = start();
  T.ok(['recurring', 'start', 'deps-02-bump']);
  const ref = `chore-recurring-deps-02-bump-${ymd(Date.now())}`;
  assert.equal(T.runLines('deps-02-bump').at(-1)?.run.ref, ref);
  T.mergeChore(ref, Date.now() + 1000);
  assert.equal(T.peek('deps-02-bump').runs[0].status, 'done');
});

// ===== DW7, DW8 (the ticket's merge), DW12: a worker chore =====
const wstart = group(() => {
  const jobs = { deps: wchore({ every: '1d', touches: ['ops/**', 'web/package.json'], done_when: ['the pins are current', 'the suite passes'] }), wnone: wchore({ every: '1d' }), wdone: wchore({ every: '1d' }), wstray: wchore({ every: '1d' }) };
  const T = setup('wstart', jobs);
  T.hand('supervisor', { type: 'ticket', feature: 'chores', id: 'ops-04-older', title: 'older', component: 'ops', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['ops/x'], done_when: ['x'] }, NOW - 20 * DAY);
  return T;
});

test('C13: recurring start on a by: worker chore writes a chores ticket <component>-<NN>-recurring-<name> (the next free number) with the entry\'s touches and done_when and the prompt in notes, its add-ticket act, and started with the ticket id', () => {
  const T = wstart();
  const o = T.ok(['recurring', 'start', 'deps']);
  const t = T.ticketsOf('deps');
  assert.equal(t.length, 1);
  assert.equal(t[0].id, 'ops-05-recurring-deps', 'the next free number after ops-04');
  assert.deepEqual([t[0].feature, t[0].component, t[0].touches, t[0].done_when], ['chores', 'ops', ['ops/**', 'web/package.json'], ['the pins are current', 'the suite passes']]);
  assert.match(t[0].notes, /Bump the pins in ops\//);
  assert.match(t[0].notes, new RegExp(T.q.deps));
  assert.match(o, new RegExp(T.q.deps));
  const act = T.allLines().find((l) => l.type === 'act' && l.class === 'add-ticket' && l.refs?.includes('ops-05-recurring-deps'));
  assert.deepEqual(act?.refs, ['ops-05-recurring-deps', 'recurring:deps']);
  const l = T.runLines('deps').at(-1);
  assert.deepEqual([l.by, l.detector, l.run.status, l.run.ref], ['supervisor', 'recurring', 'started', 'ops-05-recurring-deps']);
});

test('C20: recurring done --nothing and --abandoned are refused for a by: worker chore; nothing is logged and no second ticket is written', () => {
  const T = wstart();
  T.ok(['recurring', 'start', 'wnone']);
  const before = T.runLines('wnone').length;
  for (const f of ['--nothing', '--abandoned']) {
    const r = T.dt(['recurring', 'done', 'wnone', f, 'no change']);
    assert.equal(r.status, 1, `${f} refused`);
    assert.match(r.err, /worker's chore: it ends only through its ticket/);
  }
  assert.equal(T.runLines('wnone').length, before, 'no line');
  assert.equal(T.dt(['recurring', 'start', 'wnone']).status, 1, 'still started');
  assert.equal(T.ticketsOf('wnone').length, 1, 'one ticket');
});

test("C15: the run reads as done once the ticket's merge lands", () => {
  const T = wstart();
  T.ok(['recurring', 'start', 'wdone']);
  const id = T.ticketsOf('wdone')[0]?.id;
  assert.ok(id, 'its ticket');
  assert.equal(T.peek('wdone').runs[0].status, 'started', 'live before the merge');
  T.g(['checkout', '-q', '-b', `ticket/${id}`]);
  write(path.join(T.old, 'ops', 'pins.txt'), 'bumped\n');
  T.g(['add', '-A', 'ops']);
  T.g(['commit', '-qm', `${id}: bump`]);
  T.g(['checkout', '-q', 'main']);
  T.g(['merge', '--no-ff', '-q', '-m', `Merge pull request #5 from x/ticket/${id}`, `ticket/${id}`]);
  T.g(['push', '-q', 'origin', 'main']);
  T.g(['fetch', '-q', 'origin']);
  assert.equal(T.peek('wdone').runs[0].status, 'done');
});

test('C24: a start cut short after writing its ticket (no started line) is taken up by the next start, never a second ticket', () => {
  const T = wstart();
  const id = 'ops-09-recurring-wstray';
  T.hand('supervisor', { type: 'ticket', feature: 'chores', id, title: 'Recurring: A worker chore', component: 'ops', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['ops/**'], done_when: ['the chore is done'] }, NOW - HOUR);
  T.hand('supervisor', { type: 'act', class: 'add-ticket', what: `added chore ticket ${id}`, refs: [id, 'recurring:wstray'], reversible: true }, NOW - HOUR);
  T.ok(['recurring', 'start', 'wstray']);
  assert.deepEqual(T.ticketsOf('wstray').map((t) => t.id), [id], 'no second ticket');
  assert.equal(T.runLines('wstray').at(-1)?.run.ref, id, 'started with it');
});

// ===== refusals the done-whens imply =====
const refuse = group(() => {
  const jobs = { kept: chore({ every: '1d' }), hide: chore({ every: '1d' }), lnk: chore({ every: '1d' }), other: chore({ every: '1d' }), chk: { kind: 'check', title: 'A check', what: 'runs', every: '1d', run: 'true' } };
  const T = setup('refuse', jobs);
  // a job put on main by a plain commit, with no answer
  const file = path.join(T.old, JOBS);
  write(file, `${JSON.stringify({ ...jobs, loose: chore({ every: '1d' }) }, null, 2)}\n`);
  T.g(['commit', '-qam', 'main: a job with no answer']);
  T.g(['push', '-q', 'origin', 'main']);
  T.g(['fetch', '-q', 'origin']);
  return T;
});

test('C25a: recurring start refuses a job the owner never approved through an answer', () => {
  const T = refuse();
  const r = T.dt(['recurring', 'start', 'loose']);
  assert.equal(r.status, 1);
  assert.match(r.err, /was not registered through an answered recurring-edit question/);
  assert.equal(T.runLines('loose').length, 0);
});

test('C25b: recurring start and done refuse a check', () => {
  const T = refuse();
  for (const args of [['start', 'chk'], ['done', 'chk', '--nothing', 'x']]) {
    const r = T.dt(['recurring', ...args]);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.err, /chk is a check job; only a chore starts and finishes here/);
  }
});

test('C25c: recurring done --nothing refuses a chore worktree that holds work, logs nothing and keeps it', () => {
  const T = refuse();
  T.ok(['recurring', 'start', 'kept']);
  const ref = `chore-recurring-kept-${ymd(Date.now())}`;
  write(path.join(T.old, '.worktrees', ref, PROJ, 'notes', 'work.md'), 'work\n');
  const n = T.runLines('kept').length;
  const r = T.dt(['recurring', 'done', 'kept', '--nothing', 'nothing']);
  assert.equal(r.status, 1);
  assert.match(r.err, /holds work \(uncommitted changes\)/);
  assert.equal(T.runLines('kept').length, n, 'no line');
  assert.ok(fs.existsSync(path.join(T.old, '.worktrees', ref, PROJ, 'notes', 'work.md')), 'the work is kept');
});

test('C25d: recurring done --nothing sees an untracked file even when git config hides untracked files, and keeps it', () => {
  const T = refuse();
  T.ok(['recurring', 'start', 'hide']);
  const ref = `chore-recurring-hide-${ymd(Date.now())}`;
  const file = path.join(T.old, '.worktrees', ref, PROJ, 'notes', 'hidden.md');
  write(file, 'work\n');
  const n = T.runLines('hide').length;
  const r = T.dt(['recurring', 'done', 'hide', '--nothing', 'nothing'], { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'status.showUntrackedFiles', GIT_CONFIG_VALUE_0: 'no' });
  assert.equal(r.status, 1, r.text);
  assert.match(r.err, /holds work \(uncommitted changes\)/);
  assert.equal(T.runLines('hide').length, n, 'no line');
  assert.ok(fs.existsSync(file), 'the untracked file is kept');
});

test('C25e: recurring done --nothing refuses a chore worktree path that is a symlink, and removes nothing', () => {
  const T = refuse();
  T.ok(['recurring', 'start', 'lnk']);
  T.ok(['recurring', 'start', 'other']);
  const day = ymd(Date.now());
  const mine = path.join(T.old, '.worktrees', `chore-recurring-lnk-${day}`);
  const theirs = path.join(T.old, '.worktrees', `chore-recurring-other-${day}`);
  T.g(['worktree', 'remove', mine]);
  fs.symlinkSync(theirs, mine);
  const n = T.runLines('lnk').length;
  const r = T.dt(['recurring', 'done', 'lnk', '--nothing', 'nothing']);
  assert.equal(r.status, 1, r.text);
  assert.match(r.err, /is a symlink/);
  assert.equal(T.runLines('lnk').length, n, 'no line');
  assert.ok(fs.existsSync(path.join(theirs, '.git')), "the other chore's worktree is kept");
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

test('C17: recurring start is refused while Upkeep is drained or parked, and the chore shows held in dashboard-data (and no due finding)', () => {
  const T = held();
  for (const mode of ['drain', 'park']) {
    T.hold(mode);
    const r = T.dt(['recurring', 'start', 'cd']);
    assert.equal(r.status, 1, `refused while ${mode}`);
    assert.match(r.err, /Upkeep is (draining|parked): recurring chores wait/);
    const e = T.entryOf('cd');
    assert.equal(e.state, 'held', `held while ${mode}`);
    assert.deepEqual(schemaErrors(ENTRY_SHAPE, e, 'cd'), []);
    assert.equal(T.finding('recurring-due', 'cd').length, 0, `no recurring-due while ${mode}`);
  }
  assert.equal(T.runLines('cd').filter((l) => l.run?.status === 'started').length, 1, 'no start was logged');
  T.hold('run');
  assert.equal(T.entryOf('cd').state, 'due', 'due again once Upkeep runs');
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

test('C21: peek recurring <name> --json for a supervisor chore and a worker chore matches peek.json\'s shape: prompt, by, runs with started, nothing and ref', () => {
  const T = pk();
  const s = T.peek('sv');
  assert.deepEqual(schemaErrors(PEEK_SHAPE, s, 'sv'), []);
  assert.deepEqual([s.entry.by, s.entry.prompt], ['supervisor', 'Tidy the branches.\nSay what you removed.']);
  assert.deepEqual(s.runs.map((r) => [r.status, r.ref]), [['started', `chore-recurring-sv-${ymd(NOW - 2 * DAY)}`], ['nothing', `chore-recurring-sv-${ymd(NOW - 3 * DAY)}`]], 'one row per run, newest first, each as it finished');
  const w = T.peek('wk');
  assert.deepEqual(schemaErrors(PEEK_SHAPE, w, 'wk'), []);
  assert.deepEqual([w.entry.by, w.entry.prompt, w.runs[0].status, w.runs[0].ref], ['worker', 'Bump the pins in ops/.', 'started', 'ops-01-recurring-wk']);
});

// ===== kit-785: a start dated in the future, and a ref that names another job =====
const skew = group(() => {
  const jobs = { fmerge: chore({ every: '1d' }), fpast: chore({ every: '1d' }), fstuck: chore({ every: '1d' }), fsoon: chore({ every: '1d' }), fdrop: chore({ every: '1d' }), xa: chore({ every: '1d' }), xb: chore({ every: '1d' }), xc: chore({ every: '1d' }) };
  const T = setup('skew', jobs);
  // started lines dated two days ahead (a clock that ran fast), and fsoon's a minute ahead
  for (const n of ['fmerge', 'fstuck', 'fdrop']) T.addLine(n, { slot: iso(NOW - DAY), ref: `chore-recurring-${n}-${ymd(NOW + 2 * DAY)}`, at: NOW + 2 * DAY });
  T.addLine('fsoon', { slot: iso(NOW - DAY), ref: `chore-recurring-fsoon-${ymd(NOW + 60000)}`, at: NOW + 60000 });
  // fmerge's chore branch merged an hour ago, by the right clock: the newest line in its file, so a
  // later write isn't stamped after the future lines
  // fpast: the clock was an hour fast when it started and has since passed that date; its merge, by the
  // right clock, is dated before its start
  T.addLine('fpast', { slot: iso(NOW - DAY), ref: `chore-recurring-fpast-${ymd(NOW - HOUR)}`, at: NOW - HOUR });
  T.mergeChore(`chore-recurring-fpast-${ymd(NOW - HOUR)}`, NOW - 2 * HOUR);
  T.mergeChore(`chore-recurring-fmerge-${ymd(NOW + 2 * DAY)}`, NOW - HOUR);
  return T;
});

test('C26a: a started line dated in the future still finishes on its chore\'s merge', () => {
  const T = skew();
  assert.equal(T.peek('fmerge').runs[0].status, 'done');
  assert.notEqual(T.entryOf('fmerge').state, 'started');
});

test('C26d: a run whose start the clock has since passed still reads done by a merge dated before that start', () => {
  const T = skew();
  assert.equal(T.peek('fpast').runs[0].status, 'done');
  assert.equal(T.finding('recurring-stuck', 'fpast').length, 0);
});

test('C26b: a started line dated more than ten minutes ahead is recurring-stuck now; one a minute ahead is not', () => {
  const T = skew();
  const f = T.finding('recurring-stuck', 'fstuck');
  assert.equal(f.length, 1, 'recurring-stuck for fstuck');
  assert.match(f[0].detail, new RegExp(`chore-recurring-fstuck-${ymd(NOW + 2 * DAY)}`));
  assert.equal(T.finding('recurring-stuck', 'fsoon').length, 0, 'a minute of skew is not stuck');
});

test('C26c: recurring done --abandoned ends a run whose started line is dated in the future', () => {
  const T = skew();
  T.ok(['recurring', 'done', 'fdrop', '--abandoned', 'the clock ran fast']);
  assert.equal(T.peek('fdrop').runs[0].status, 'abandoned');
  // peek prints a run's start as its at; dashboard-data's last.at is when it finished
  const e = T.entryOf('fdrop');
  assert.ok(Date.parse(e.last.at) <= Date.now(), `finished when the line was written, not at the future start (${e.last.at})`);
  assert.notEqual(e.state, 'started');
  assert.equal(T.finding('recurring-stuck', 'fdrop').length, 0, 'not stuck once ended');
});

test('C27a: a supervisor line for xa whose ref is xb\'s chore branch is ignored: recurring done xa --nothing is refused and xb\'s worktree stays', () => {
  const T = skew();
  T.ok(['recurring', 'start', 'xb']);
  const ref = `chore-recurring-xb-${ymd(Date.now())}`;
  T.addLine('xa', { slot: iso(NOW - DAY), ref, at: Date.now() });
  const r = T.dt(['recurring', 'done', 'xa', '--nothing', 'nothing']);
  assert.match(r.err, /xa has no started run to finish/, r.text);
  assert.equal(r.status, 1);
  assert.ok(fs.existsSync(path.join(T.old, '.worktrees', ref, '.git')), "xb's worktree is kept");
  assert.deepEqual(T.peek('xa').runs, [], 'xa has no run');
  assert.equal(T.peek('xb').runs[0].status, 'started', "xb's run is untouched");
});

test('C27b: a supervisor line for xc whose ref is another job\'s chores ticket is ignored', () => {
  const T = skew();
  T.addLine('xc', { slot: iso(NOW - DAY), ref: 'ops-01-recurring-xd', at: NOW - HOUR });
  assert.deepEqual(T.peek('xc').runs, [], 'xc has no run');
});

// ===== DW14: supervisor.md =====

test('C22: supervisor.md documents chores: when they come due, recurring start, done with --nothing and --abandoned, and holds', () => {
  const sec = /\n## Recurring jobs\n[\s\S]*?\n## /.exec(SUPERVISOR_MD)?.[0] ?? '';
  const chores = /\n### Chores\n[\s\S]*?(?=\n### |\n## )/.exec(sec)?.[0] ?? '';
  assert.ok(chores, 'a Chores part under Recurring jobs');
  for (const w of ['recurring-due', 'recurring-overdue', 'recurring-stuck', 'grace_days', 'recurring start', 'chore-recurring-<name>-<yyyymmdd>', '<component>-<NN>-recurring-<name>', 'recurring done <name> --nothing', '--abandoned', 'superseded', 'drained or parked']) assert.ok(chores.includes(w), `names ${w}`);
});
