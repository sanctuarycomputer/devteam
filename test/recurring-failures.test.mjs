// A failing recurring check becomes work (kit-168; design recurring-checks-and-chores-under-upkeep, C2,
// Findings, C5, Upkeep's heartbeat, P5). After each runner pass, `recurring run --due` runs the failure
// pass: one recurring-failed when a check's stretch of fails reaches fail_after, one recurring-recovered
// on the first pass after it. metrics raises recurring-failing (until a fix ticket from `recurring
// ticket` exists), recurring-stale and recurring-invalid. Orient never groups run or recovered lines.
// dashboard-data's upkeep.recurring, `peek recurring <name>` and upkeep_days carry the checks. Only the
// supervisor's detector recurring lines count anywhere. The last two tests drive the job peek in Chrome
// (kit-166 final-1 F1, F2). Each fixture is a monoFixture whose main holds project/recurring.json.
// Run with TMUX unset: no fixture here starts a tmux server. Every child has a timeout.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { monoFixture, write, kit, line, PORTS, bareProject, dashboardOnFreePort } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const PROJ = 'docs/devteam/project';
const JOBS = `${PROJ}/recurring.json`;
const RUN = 'docs/devteam/run';
const T_OUT = 120000;
const DAY = 86400000;
const HOUR = 3600000;
const FX = path.join(kit, '..', '..', 'test', 'fixtures', 'recurring');
const DASH = JSON.parse(fs.readFileSync(path.join(FX, 'dashboard.json'), 'utf8'));
const PEEK_FX = JSON.parse(fs.readFileSync(path.join(FX, 'peek.json'), 'utf8'));
const CHROME = { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' };
const J = JSON.stringify;
const clone = (x) => JSON.parse(J(x));

const check = (extra = {}) => ({ kind: 'check', title: 'A check', what: 'runs on a schedule', every: '1d', run: 'true', ...extra });
const iso = (ms) => new Date(ms).toISOString();
const stamp = (at) => `${at.slice(0, 10).replace(/-/g, '')}-${at.slice(11, 23).replace(/[:.]/g, '')}`;
const mondayOf = (ms) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY; };
const isoWeek = (ms) => { const m = mondayOf(ms); const y = new Date(m + 3 * DAY).getUTCFullYear(); return `${y}-W${String(1 + Math.round((m - mondayOf(Date.UTC(y, 0, 4))) / (7 * DAY))).padStart(2, '0')}`; };

// A fixture: main holds these jobs, committed three days back (the schedule starts then).
function setup(name, jobs) {
  const F = monoFixture(`rf-${name}`);
  const { old } = F;
  const g = (args) => execFileSync('git', args, { cwd: old, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim();
  write(path.join(old, JOBS), `${JSON.stringify(jobs, null, 2)}\n`);
  g(['add', '-A']);
  const back = iso(Date.now() - 3 * DAY);
  execFileSync('git', ['commit', '-qm', 'main: jobs'], { cwd: old, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, env: { ...process.env, GIT_COMMITTER_DATE: back, GIT_AUTHOR_DATE: back } });
  g(['push', '-q', 'origin', 'main']);
  g(['fetch', '-q', 'origin']);
  const DT = path.join(old, 'docs/devteam/scripts/devteam.mjs');
  const env = (extra = {}) => { const e = { ...F.env(SUP), ...extra }; delete e.DEVTEAM_TICKET; return e; };
  const dt = (args, extra = {}) => { const r = spawnSync(process.execPath, [DT, ...args], { cwd: old, env: env(extra), encoding: 'utf8', timeout: T_OUT }); return { status: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim(), text: `${r.stdout ?? ''}\n${r.stderr ?? ''}` }; };
  const ok = (args, extra) => { const r = dt(args, extra); assert.equal(r.status, 0, `${args.join(' ')}: ${r.text}`); return r.out; };
  const logDir = path.join(old, RUN, 'log');
  const allLines = () => (fs.existsSync(logDir) ? fs.readdirSync(logDir) : []).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  const obs = (kind, name) => allLines().filter((l) => l.type === 'observation' && l.kind === kind && (!name || l.subject === `recurring:${name}`)).sort((a, b) => a.at.localeCompare(b.at));
  // a line as `by` would have written it at ms, in its writer's file
  let n = 0;
  const hand = (by, o, ms) => {
    const t = iso(ms + (n++ % 1000));
    const id = o.id ?? `${{ observation: 'o', act: 'a', knowledge: 'k', ticket: 't' }[o.type]}-${stamp(t)}-${by}`;
    const file = ['owner', 'supervisor'].includes(by) ? `${by}-${t.slice(0, 7)}.jsonl` : `${by}.jsonl`;
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, file), line({ op: 'new', ...(by === 'owner' ? { channel: 'cli' } : {}), ...o, id, at: t, by }));
    return id;
  };
  // a run line: `at` is when it was written; its start is at less seconds
  const addRun = (name, { slot, at, status = 'pass', by = 'supervisor', detector = 'recurring', seconds = 0, excerpt = `${status} output`, key = true }) => hand(by, {
    type: 'observation', source: 'recurring', kind: 'recurring-run', subject: `recurring:${name}`, ...(detector ? { detector } : {}), detail: `${name}: ${status}`, severity: 0, valence: 0,
    ...(key ? { source_key: `recurring:${name}:${slot}:hand${n}` } : {}), run: { status, slot, seconds, excerpt },
  }, typeof at === 'number' ? at : Date.parse(at));
  const due = () => JSON.parse(ok(['recurring', 'due', '--json']));
  const dueOf = (name) => due().checks.find((c) => c.name === name);
  const metrics = () => JSON.parse(ok(['metrics', '--json']));
  const finding = (kind, subject) => metrics().findings.filter((f) => f.kind === kind && (!subject || f.subject === subject));
  const data = () => JSON.parse(ok(['dashboard-data']));
  // main's jobs changed by a plain commit, pushed (now, or dated at ms)
  const onMain = (fn, ms = Date.now()) => {
    const file = path.join(old, JOBS);
    const jobsNow = JSON.parse(fs.readFileSync(file, 'utf8'));
    fn(jobsNow);
    write(file, `${JSON.stringify(jobsNow, null, 2)}\n`);
    g(['add', '-A']);
    execFileSync('git', ['commit', '-qm', 'main: jobs change'], { cwd: old, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, env: { ...process.env, GIT_COMMITTER_DATE: iso(ms), GIT_AUTHOR_DATE: iso(ms) } });
    g(['push', '-q', 'origin', 'main']);
    g(['fetch', '-q', 'origin']);
  };
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
  return { ...F, g, DT, env, dt, ok, allLines, obs, hand, addRun, due, dueOf, metrics, finding, data, onMain, registerYes };
}

// The consumed contract's shapes, copied from test/recurring-contract.test.mjs (REGISTERED { qid, at } or
// null since kit-168's contract commit), so a later contract change shows here as a failure; schemaErrors is
// cut from the kit's own source.
const SRC = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
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
const DASHBOARD_SHAPE = closed({
  entries: {
    type: 'array',
    items: closed({
      name: str, title: str, what: str, kind: { enum: ['check', 'chore'] }, by: { enum: ['supervisor', 'worker', null] },
      every: str, on: { type: ['string', 'integer', 'null'] }, at: { type: ['string', 'null'] },
      state: { enum: ['passing', 'failing', 'due', 'started', 'overdue', 'held', 'never'] }, fails_in_a_row: { type: 'integer', minimum: 0 },
      last: { type: ['object', 'null'], properties: { status: { enum: ['pass', 'fail', 'error', 'started', 'done', 'nothing', 'abandoned'] }, at: time, seconds: { type: ['number', 'null'], minimum: 0 }, excerpt: { type: ['string', 'null'], maxLength: 200 } }, required: ['status', 'at', 'seconds', 'excerpt'], additionalProperties: false },
      next_at: { type: ['string', 'null'], pattern: ISO }, ticket: { type: ['string', 'null'] }, registered: REGISTERED,
      signals: { type: 'array', items: closed({ kind: { enum: ['flapping', 'erroring', 'slow', 'failing-long', 'idle', 'overdue', 'quiet'] }, since: time, text: str, may: str, evidence: { type: 'array', minItems: 1, items: { type: 'string', pattern: '^o-' } } }) },
    }),
  },
  builtin: { type: 'array', items: closed({ name: { enum: ['retro', 'research', 'kit-sync', 'sensors'] }, every: str, last_at: { type: ['string', 'null'], pattern: ISO }, next_at: { type: ['string', 'null'], pattern: ISO }, note: { type: 'string', minLength: 1 }, setting: { enum: ['retro_every_days', 'research_every_days', 'upstream_check_hours', null] } }) },
  proposals: { type: 'array', items: closed({ qid: { type: 'string', pattern: '^q-' }, name: str, title: str, asked_at: time, status: { enum: ['open', 'registering', 'stopping'] } }) },
});

// One fixture per group, made on its first test's first use and removed after the file; a group's
// tests run in order, each asserting one check, so a red line is always that check's own.
const made = [];
after(() => { for (const F of made) try { F.done(); } catch {} });
const group = (make) => { let v = null; return () => { if (!v) { v = make(); made.push(v); } return v; }; };

// ===== A2: recurring-failed once per stretch, recurring-recovered on the first pass after =====

const A2 = group(() => {
  const F = setup('a2', { cx: check({ every: '1h', run: 'exit 1', fail_after: 3, severity: 3 }), cy: check({ every: '1h', run: 'exit 1' }) });
  // two failing results by hand, as the supervisor's runner would have logged them, then a real run of `exit 1`
  for (let i = 0; i < 2; i++) { const d = F.dueOf('cx'); F.addRun('cx', { slot: d.slot, at: Date.parse(d.slot) + 1000, status: 'fail' }); }
  F.ok(['recurring', 'run', '--due']);
  return F;
});

test('A2a: with fail_after 3, the third consecutive failure logs one recurring-failed (source_key, severity from the entry, refs the runs)', () => {
  const F = A2();
  assert.equal(F.obs('recurring-run', 'cx').length, 3, 'three runs');
  const failed = F.obs('recurring-failed', 'cx');
  assert.equal(failed.length, 1, 'the third consecutive failure logs one recurring-failed');
  const [f] = failed;
  assert.deepEqual([f.by, f.detector, f.source, f.source_key, f.severity, f.valence], ['supervisor', 'recurring', 'recurring', 'recurring:cx', 3, -1]);
  assert.deepEqual(f.refs, F.obs('recurring-run', 'cx').map((l) => l.id), 'refs the three runs');
});

test('A2b: fail_after defaults to 1: one failing run logs recurring-failed', () => {
  assert.equal(A2().obs('recurring-failed', 'cy').length, 1, 'fail_after defaults to 1');
});

test('A2c: the fourth consecutive failure logs no second recurring-failed', () => {
  const F = A2();
  F.addRun('cx', { slot: F.dueOf('cx').slot, at: Date.now(), status: 'fail' });
  F.ok(['recurring', 'run', '--due']);
  assert.equal(F.obs('recurring-failed', 'cx').length, 1, 'the fourth logs none');
});

test('A2d: the next pass logs one recurring-recovered', () => {
  const F = A2();
  F.addRun('cx', { slot: F.dueOf('cx').slot, at: Date.now() + 10, status: 'pass' });
  F.ok(['recurring', 'run', '--due']);
  const rec = F.obs('recurring-recovered', 'cx');
  assert.equal(rec.length, 1, 'the next pass logs one recurring-recovered');
  assert.deepEqual([rec[0].by, rec[0].detector, rec[0].valence], ['supervisor', 'recurring', 1]);
});

// final-1b F1: once the pass ends the stretch, the check is passing with none in a row, and the finding is gone
// its own copy of A2's fixture: A2d adds a pass to the shared one
const A2R = group(() => {
  const F = setup('a2r', { cx: check({ every: '1h', run: 'exit 1', fail_after: 3, severity: 3 }) });
  for (let i = 0; i < 2; i++) { const d = F.dueOf('cx'); F.addRun('cx', { slot: d.slot, at: Date.parse(d.slot) + 1000, status: 'fail' }); }
  F.ok(['recurring', 'run', '--due']);
  return F;
});

test('A2r: after the pass that ends an alerting stretch, recurring-failing is gone and the entry is passing with 0 in a row', () => {
  const F = A2R();
  assert.equal(F.finding('recurring-failing', 'recurring:cx').length, 1, 'raised while failing');
  F.addRun('cx', { slot: F.dueOf('cx').slot, at: Date.now() + 10, status: 'pass' });
  F.ok(['recurring', 'run', '--due']);
  assert.equal(F.finding('recurring-failing', 'recurring:cx').length, 0, 'gone after the pass');
  const e = F.data().upkeep.recurring.entries.find((x) => x.name === 'cx');
  assert.deepEqual([e.state, e.fails_in_a_row], ['passing', 0]);
});

// final-1b F1: only the trailing run of fails and errors is in a row
const A2S = group(() => {
  const F = setup('a2s', { cw: check({ every: '1h' }) });
  for (const status of ['fail', 'pass', 'fail']) { const d = F.dueOf('cw'); F.addRun('cw', { slot: d.slot, at: Date.parse(d.slot) + 1000, status }); }
  return F;
});

test('A2s: fail, pass, fail is 1 in a row: the fail before the pass is not counted', () => {
  const e = A2S().data().upkeep.recurring.entries.find((x) => x.name === 'cw');
  assert.deepEqual([e.state, e.fails_in_a_row, e.last.status], ['failing', 1, 'fail']);
});

test('A2e: another failure pass after the recovery logs no second recurring-recovered', () => {
  const F = A2();
  F.ok(['recurring', 'run', '--due']);
  assert.equal(F.obs('recurring-recovered', 'cx').length, 1, 'still one recovered');
});

test('A2f: a failing check whose fail_after is raised past its stretch is no longer failing, and gets no recovered line', () => {
  const F = A2();
  F.onMain((j) => { j.cy.fail_after = 5; });
  F.ok(['recurring', 'run', '--due']);
  assert.deepEqual([F.finding('recurring-failing', 'recurring:cy').length, F.obs('recurring-recovered', 'cy').length], [0, 0], 'not failing, nothing logged');
});

// spec-1 F7: a pass whose failure pass was missed, then a new failure: one pass catches up both, in order
const A2G = group(() => {
  const F = setup('a2g', { cg: check({ every: '1d' }) });
  const f1 = F.addRun('cg', { slot: F.dueOf('cg').slot, at: Date.now() - 3 * HOUR, status: 'fail' });
  F.ok(['recurring', 'run', '--due']);
  const p2 = F.addRun('cg', { slot: F.dueOf('cg').slot, at: Date.now() - 2 * HOUR, status: 'pass' });
  const f3 = F.addRun('cg', { slot: F.dueOf('cg').slot, at: Date.now() - HOUR, status: 'fail' });
  F.ok(['recurring', 'run', '--due']);
  return Object.assign(F, { f1, p2, f3 });
});

test('A2g: a missed recovery is caught up, and the new stretch still gets its recurring-failed (marks matched by refs)', () => {
  const F = A2G();
  const failed = F.obs('recurring-failed', 'cg');
  const rec = F.obs('recurring-recovered', 'cg');
  assert.deepEqual(failed.map((l) => l.refs[0]), [F.f1, F.f3], 'one failed per stretch, each naming its first run');
  assert.deepEqual(rec.map((l) => l.refs), [[failed[0].id, F.p2]], 'one recovered, naming the pass');
  assert.ok(rec[0].at <= failed[1].at, 'the recovered line before the new failed one');
});

// spec-1 F8, spec-2 F1: a job stopped while failing and re-added, each through an answered landing, starts with no stretch
const A2H = group(() => {
  const CH = check({ every: '1d' });
  const F = setup('a2h', { other: check({ every: '1d' }) });
  F.registerYes('ch', CH, Date.now() - 3 * DAY + 60000);
  F.onMain((j) => { j.ch = CH; }, Date.now() - 3 * DAY + 60000);
  F.addRun('ch', { slot: F.dueOf('ch').slot, at: Date.now() - 3 * HOUR, status: 'fail' });
  F.ok(['recurring', 'run', '--due']);
  F.registerYes('ch', null, Date.now() - 2 * HOUR);
  F.onMain((j) => { delete j.ch; }, Date.now() - 2 * HOUR);
  F.registerYes('ch', CH, Date.now() - HOUR);
  F.onMain((j) => { j.ch = CH; }, Date.now() - HOUR);
  return F;
});

// spec-2 F1: a job on main with no answered landing keeps its failing stretch when another job's entry changes
const A2I = group(() => {
  const F = setup('a2i', { ci: check({ every: '1d', run: 'exit 1' }), cj: check({ every: '1d' }) });
  F.addRun('ci', { slot: F.dueOf('ci').slot, at: Date.now() - 2 * HOUR, status: 'fail' });
  F.ok(['recurring', 'run', '--due']);
  F.onMain((j) => { j.cj.title = 'CJ renamed'; }, Date.now() - HOUR);
  F.ok(['recurring', 'run', '--due']);
  return F;
});

test("A2i: a hand-registered failing check keeps its stretch when another job's entry changes, and is not marked again", () => {
  const F = A2I();
  const e = F.data().upkeep?.recurring?.entries?.find((x) => x.name === 'ci');
  assert.deepEqual([e?.state, e?.fails_in_a_row, F.finding('recurring-failing', 'recurring:ci').length, F.obs('recurring-failed', 'ci').length], ['failing', 2, 1, 1]);
});

test('A2h: a job stopped while failing and added again has no failing stretch until it runs', () => {
  const F = A2H();
  const e = F.data().upkeep?.recurring?.entries?.find((x) => x.name === 'ch');
  assert.deepEqual([e?.state, e?.fails_in_a_row, F.finding('recurring-failing', 'recurring:ch').length], ['never', 0, 0]);
});

// ===== A3: what Orient groups =====

const A3 = group(() => {
  const F = setup('a3', { cz: check() });
  const last = mondayOf(Date.now()) - 7 * DAY;
  // run lines with no source_key, so all share one key (recurring-run:recurring:cz), three days apart
  const run = (day) => F.addRun('cz', { slot: iso(last + day * DAY), at: last + day * DAY + 12 * HOUR, status: 'fail', key: false });
  const runs = [run(0), run(1), run(2)];
  for (let d = 0; d < 3; d++) F.hand('supervisor', { type: 'observation', source: 'recurring', kind: 'recurring-recovered', subject: 'recurring:cz', detector: 'recurring', detail: 'cz: passing again', severity: 0, valence: 1 }, last + d * DAY + 13 * HOUR);
  for (let d = 0; d < 3; d++) F.hand('supervisor', { type: 'observation', source: 'recurring', kind: 'recurring-failed', subject: 'recurring:cw', detector: 'recurring', source_key: 'recurring:cw', detail: 'cw: failing', severity: 2, valence: -1 }, last + d * DAY + 14 * HOUR);
  // a lesson given on Thursday whose evidence is a run line, and two more run lines after it
  const k = F.hand('owner', { type: 'knowledge', kind: 'lesson', statement: 'Watch cz', scope: 'project', status: 'accepted', evidence: [runs[0]] }, last + 3 * DAY);
  F.hand('supervisor', { type: 'act', class: 'worker-slots', what: 'made worker ops-01-a in .worktrees/ops-01-a', refs: ['ops-01-a'], knowledge: [k] }, last + 3 * DAY + HOUR);
  run(3.5);
  run(4);
  const week = isoWeek(last);
  const lr = F.hand('supervisor', { type: 'observation', source: 'metrics', detector: 'metrics', subject: 'project', kind: 'learning', week, source_key: `learning:${week}`, detail: 'week' }, Date.now() - 1000);
  const keys = JSON.parse(F.ok(['orient', '--json'])).map((c) => c);
  const learning = JSON.parse(F.ok(['peek', 'observation', lr, '--json'])).learning;
  const lesson = JSON.parse(F.ok(['peek', 'lesson', k, '--json']));
  return Object.assign(F, { clusters: keys, learning, lesson, k });
});

test('A3a: recurring-run lines are never grouped by orient as a signal', () => {
  const keys = A3().clusters.map((c) => c.key);
  assert.ok(!keys.includes('recurring-run:recurring:cz'), `run lines are never a signal: ${keys}`);
});

test('A3r: recurring-recovered lines are never grouped by orient as a signal', () => {
  const keys = A3().clusters.map((c) => c.key);
  assert.ok(!keys.includes('recurring-recovered:recurring:cz'), `recovered lines are never a signal: ${keys}`);
});

test('A3b: three recurring-failed on one name over three days are one signal', () => {
  const w = A3().clusters.filter((c) => c.key === 'recurring:cw');
  assert.deepEqual(w.map((c) => c.count), [3], 'one signal of three');
});

test("A3c: the week's learning record (recurringGroups) forms no run or recovered signal", () => {
  const sig = A3().learning.lists.signals.map((s) => s.key);
  assert.ok(!sig.some((s) => s.startsWith('recurring-run:') || s.startsWith('recurring-recovered:')), `the learning record forms no run or recovered signal: ${sig}`);
});

test("A3d: a lesson's efficacy (lessonEfficacy) counts no run line", () => {
  const F = A3();
  const e = F.learning.efficacy.find((x) => x.id === F.k);
  assert.equal(e.before.count, 0, 'lessonEfficacy counts no run line');
});

test("A3e: a lesson's peek (given_to) counts no run line since", () => {
  const g = A3().lesson.given_to;
  assert.deepEqual(g.map((x) => x.since), [0], "a lesson peek's given_to counts no run line");
});

// ===== A4: whose lines count =====

const A4 = group(() => {
  const F = setup('a4', { cx: check({ every: '1d' }) });
  F.addRun('cx', { slot: F.dueOf('cx').slot, at: Date.now() - 60000, status: 'fail' });
  // the failure pass marks the stretch (on main nothing does), so a recovery could follow it
  F.dt(['recurring', 'run', '--due']);
  const n = F.dueOf('cx');
  F.addRun('cx', { slot: n.slot, at: Date.now() - 30000, status: 'pass', by: 'ops-09-x' });
  F.addRun('cx', { slot: n.slot, at: Date.now() - 20000, status: 'pass', detector: null });
  F.hand('ops-09-x', { type: 'observation', source: 'recurring', kind: 'recurring-recovered', subject: 'recurring:cx', detector: 'recurring', detail: 'cx: passing', severity: 0, valence: 1 }, Date.now() - 10000);
  return F;
});

test("A4m: a pass line by a ticket session, or by the supervisor without detector, doesn't clear recurring-failing", () => {
  assert.equal(A4().finding('recurring-failing', 'recurring:cx').length, 1, 'still failing in metrics');
});

test('A4n: nor does the failure pass log a recurring-recovered for them', () => {
  const F = A4();
  F.ok(['recurring', 'run', '--due']);
  assert.equal(F.obs('recurring-recovered', 'cx').filter((l) => l.by === 'supervisor').length, 0, 'no recovered line from the failure pass');
});

test('A4d: nor does the dashboard read them: still failing, one in a row', () => {
  const e = A4().data().upkeep?.recurring?.entries?.find((x) => x.name === 'cx');
  assert.deepEqual([e?.state, e?.fails_in_a_row], ['failing', 1]);
});

// ===== A5: recurring-failing and recurring ticket =====

const TOKEN = `ghp_${'a1B2c3D4e5'.repeat(3)}abcdef`;
const A5 = group(() => {
  const F = setup('a5', { cx: check({ title: 'The docs build', every: '1d' }), cz: check({ every: '1d', severity: 3 }), cp: check({ every: '1d' }) });
  // an act before the stretch began, and one by a worker: neither clears it
  F.hand('supervisor', { type: 'ticket', id: 'ops-05-old', feature: 'chores', title: 'Fix: old', component: 'ops', kind: 'chore', size: 'S', risk: 'normal', depends_on: [], touches: ['ops/**'], done_when: ['x'] }, Date.now() - 10 * 60000 - 5);
  F.hand('supervisor', { type: 'act', class: 'add-ticket', what: 'added ticket ops-05-old', refs: ['ops-05-old', 'recurring:cx'] }, Date.now() - 10 * 60000);
  F.addRun('cx', { slot: F.dueOf('cx').slot, at: Date.now() - 5 * 60000, status: 'fail', excerpt: `error: auth failed with ${TOKEN}` });
  F.addRun('cz', { slot: F.dueOf('cz').slot, at: Date.now() - 5 * 60000, status: 'error' });
  F.addRun('cp', { slot: F.dueOf('cp').slot, at: Date.now() - 5 * 60000, status: 'pass' });
  F.hand('ops-09-x', { type: 'ticket', id: 'ops-06-hand', feature: 'chores', title: 'Fix: hand', component: 'ops', kind: 'chore', size: 'S', risk: 'normal', depends_on: [], touches: ['ops/**'], done_when: ['x'] }, Date.now() - 60000 - 5);
  F.hand('ops-09-x', { type: 'act', class: 'add-ticket', what: 'added ticket ops-06-hand', refs: ['ops-06-hand', 'recurring:cx'] }, Date.now() - 60000);
  return F;
});

test('A5a: metrics raises recurring-failing (medium) for a failing check, with the recurring ticket fix', () => {
  const fx = A5().finding('recurring-failing', 'recurring:cx');
  assert.deepEqual(fx.map((f) => f.severity), ['medium'], 'failing, medium');
  assert.match(fx[0].suggestion, /recurring ticket cx --id/);
});

test('A5h: at severity 3 it is high', () => {
  assert.deepEqual(A5().finding('recurring-failing', 'recurring:cz').map((f) => f.severity), ['high'], 'high at severity 3');
});

test('A5p: a passing check raises none', () => {
  assert.equal(A5().finding('recurring-failing', 'recurring:cp').length, 0);
});

test("A5t: an add-ticket act from before the stretch began, or a worker's, clears nothing (shown by A5a's finding with both in the log)", () => {
  assert.equal(A5().finding('recurring-failing', 'recurring:cx').length, 1, "neither the old act nor a worker's clears it");
});

test('A5r: recurring ticket refuses a passing check, an existing id, no --touches, an unknown job and a bad id, writing nothing', () => {
  const F = A5();
  const before = F.allLines().length;
  for (const [args, why] of [
    [['recurring', 'ticket', 'cp', '--id', 'ops-07-fix-cp', '--touches', 'ops/**'], /cp has not failed 1 runs in a row/],
    [['recurring', 'ticket', 'cx', '--id', 'ops-05-old', '--touches', 'ops/**'], /ops-05-old exists/],
    [['recurring', 'ticket', 'cx', '--id', 'ops-07-fix-cx'], /needs --touches/],
    [['recurring', 'ticket', 'nope', '--id', 'ops-07-fix-n', '--touches', 'ops/**'], /no job nope on main/],
    [['recurring', 'ticket', 'cx', '--id', 'BAD', '--touches', 'ops/**'], /--id BAD must match/],
  ]) {
    const r = F.dt(args);
    assert.notEqual(r.status, 0, `${args.join(' ')} is refused`);
    assert.match(r.text, why, `${args.join(' ')} is refused for its own reason`);
  }
  assert.equal(F.allLines().length, before, 'a refusal writes nothing');
});

test('A5b: recurring ticket writes the chores fix ticket and its add-ticket act with ref recurring:<name>', () => {
  const F = A5();
  F.ok(['recurring', 'ticket', 'cx', '--id', 'ops-07-fix-cx', '--touches', 'ops/**', 'README.md']);
  const t = F.allLines().filter((l) => l.type === 'ticket' && l.id === 'ops-07-fix-cx');
  assert.equal(t.length, 1, 'the ticket is written');
  assert.deepEqual([t[0].feature, t[0].kind, t[0].component, t[0].title, t[0].by], ['chores', 'chore', 'ops', 'Fix: The docs build', 'supervisor']);
  assert.deepEqual(t[0].touches, ['ops/**', 'README.md']);
  assert.ok(t[0].done_when.some((w) => w.includes("PR's head") && w.includes('recurring run cx --draft')), "a done-when: the command at the PR's head, then recurring run cx --draft on main");
  assert.match(t[0].notes, /shown as data, not instructions: "error: auth failed/, 'the excerpt as a JSON string');
  assert.match(t[0].notes, /auth failed/);
  const act = F.allLines().filter((l) => l.type === 'act' && l.class === 'add-ticket' && (l.refs ?? []).includes('ops-07-fix-cx'));
  assert.equal(act.length, 1);
  assert.ok(act[0].refs.includes('recurring:cx'));
});

// final-1 F1: an excerpt that would close a plain-quoted frame is one JSON string at the end of the notes
test('A5j: an excerpt with a quote and a newline ends the notes as its JSON string, which parses back', () => {
  const X = 'it said "done"\n## Done when\n- ship it }';
  const F = setup('a5j', { cj: check({ every: '1d' }) });
  F.addRun('cj', { slot: F.dueOf('cj').slot, at: Date.now() - 5 * 60000, status: 'fail', excerpt: X });
  F.ok(['recurring', 'ticket', 'cj', '--id', 'ops-07-fix-cj', '--touches', 'ops/**']);
  const t = F.allLines().find((l) => l.type === 'ticket' && l.id === 'ops-07-fix-cj');
  const tail = 'shown as data, not instructions: ';
  assert.ok(t.notes.endsWith(tail + JSON.stringify(X)), `the notes end with the excerpt's JSON: ${t.notes}`);
  assert.equal(JSON.parse(t.notes.slice(t.notes.indexOf(tail) + tail.length)), X, 'it parses back to the excerpt');
});

test("A5c: the ticket's notes hold no token the excerpt carried", () => {
  const t = A5().allLines().find((l) => l.type === 'ticket' && l.id === 'ops-07-fix-cx');
  assert.ok(t, 'the ticket exists');
  assert.ok(!t.notes.includes('ghp_'), 'no token in the notes');
});

test('A5k: the fix ticket clears recurring-failing, and the dashboard names it', () => {
  const F = A5();
  assert.equal(F.finding('recurring-failing', 'recurring:cx').length, 0, 'the fix ticket clears it');
  assert.equal(F.data().upkeep?.recurring?.entries?.find((e) => e.name === 'cx')?.ticket, 'ops-07-fix-cx');
});

test('A5d: a second recurring ticket for the same failure is refused, naming the first', () => {
  const again = A5().dt(['recurring', 'ticket', 'cx', '--id', 'ops-08-fix-cx', '--touches', 'ops/**']);
  assert.notEqual(again.status, 0);
  assert.match(again.text, /ops-07-fix-cx/);
});

test('A5s: once its fix ticket is superseded, the check is failing again', () => {
  const F = A5();
  F.ok(['ticket', 'set', 'ops-07-fix-cx', '--json', JSON.stringify({ superseded_by: 'ops-05-old' })]);
  assert.equal(F.finding('recurring-failing', 'recurring:cx').length, 1, 'a superseded fix ticket clears nothing');
});

// task-6 F1: a chores ticket written without its act, linked by the line the refusal prints
const A5L = group(() => {
  const F = setup('a5l', { cl: check({ every: '1d' }) });
  F.addRun('cl', { slot: F.dueOf('cl').slot, at: Date.now() - 5 * 60000, status: 'fail' });
  F.hand('supervisor', { type: 'ticket', id: 'ops-05-fix-cl', feature: 'chores', title: 'Fix: cl', component: 'ops', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['ops/**'], done_when: ['x'], notes: 'by hand' }, Date.now() - 60000);
  return F;
});

test('A5l: a fix ticket that exists without its act is linked by running the line the refusal prints, which clears the finding', () => {
  const F = A5L();
  assert.equal(F.finding('recurring-failing', 'recurring:cl').length, 1, 'raised before the link');
  const r = F.dt(['recurring', 'ticket', 'cl', '--id', 'ops-05-fix-cl', '--touches', 'ops/**']);
  assert.notEqual(r.status, 0);
  const m = /link it: act (.+) -- "([^"]+)"/.exec(r.text);
  assert.ok(m, `the refusal prints the line: ${r.text}`);
  F.ok(['act', ...m[1].split(' '), '--', m[2]]);
  assert.equal(F.finding('recurring-failing', 'recurring:cl').length, 0, 'the printed line clears it');
});

test('A5x: an ack of the finding as metrics names it clears it, on the next metrics too', () => {
  const F = A5();
  const [f] = F.metrics().findings.filter((x) => x.kind === 'recurring-failing' && String(x.subject).includes('cz'));
  F.ok(['ack', 'recurring-failing', f.subject, '--reason', 'known']);
  assert.equal(F.metrics().findings.filter((x) => x.kind === 'recurring-failing' && String(x.subject).includes('cz')).length, 0, 'ack clears it');
});

// ===== A6: recurring-stale and recurring-invalid =====

const A6 = group(() => {
  const F = setup('a6', { ca: check({ every: '1h' }), cb: check({ every: '1h' }) });
  write(path.join(F.old, RUN, 'sensors', '.wait-alive'), `${iso(Date.now())}\n`);
  F.addRun('ca', { slot: F.dueOf('ca').slot, at: Date.now() - 4 * HOUR, status: 'pass' });
  F.addRun('cb', { slot: F.dueOf('cb').slot, at: Date.now() - 2 * HOUR, status: 'pass' });
  return F;
});

test('A6a: recurring-stale (medium) for a check not run in three intervals while wait runs', () => {
  assert.deepEqual(A6().finding('recurring-stale', 'recurring:ca').map((f) => f.severity), ['medium'], 'stale after three intervals');
});

test('A6s: none for a check run two intervals ago', () => {
  assert.equal(A6().finding('recurring-stale', 'recurring:cb').length, 0, 'not yet at two');
});

test('A6w: none while wait is not running (its heartbeat 30 min old)', () => {
  const F = A6();
  const alive = path.join(F.old, RUN, 'sensors', '.wait-alive');
  const old = (Date.now() - 30 * 60000) / 1000;
  fs.utimesSync(alive, old, old);
  assert.equal(F.finding('recurring-stale').length, 0, 'not while wait is not running');
});

const A6B = group(() => {
  const F = setup('a6b', { bad: check({ every: '1h', run: 'exit 1' }), oops: { kind: 'check', title: 'Oops', every: '1h' } });
  F.addRun('bad', { slot: iso(Date.now() - HOUR), at: Date.now() - HOUR, status: 'fail' });
  return F;
});

test('A6i: a registry on main that breaks the shape raises recurring-invalid (high)', () => {
  assert.deepEqual(A6B().finding('recurring-invalid').map((f) => f.severity), ['high'], 'a broken registry raises recurring-invalid');
});

test('A6n: and nothing runs, and no failure is logged', () => {
  const F = A6B();
  F.dt(['recurring', 'run', '--due']);
  assert.deepEqual([F.obs('recurring-run').length, F.obs('recurring-failed').length], [1, 0], 'nothing runs, and nothing is marked');
});

// ===== A7: dashboard-data and peek =====

const sameShape = (want, got, where) => {
  for (const [k, v] of Object.entries(want)) {
    assert.ok(Object.hasOwn(got ?? {}, k), `${where} has ${k}`);
    if (got[k] !== null && v !== null) assert.equal(Array.isArray(got[k]) ? 'array' : typeof got[k], Array.isArray(v) ? 'array' : typeof v, `${where}.${k}'s type`);
  }
};

const A7 = group(() => {
  const CF = check({ every: '6h', title: 'CF fails' });
  const F = setup('a7', { ok: check({ every: '1d' }), nv: check({ every: '1w', on: 'mon' }) });
  const landed = Date.now() - 3 * DAY + 60000;
  const qid = F.registerYes('cf', CF, landed);
  F.onMain((j) => { j.cf = CF; }, landed);
  const t0 = Date.now() - 2 * DAY;
  for (const [i, s] of ['pass', 'fail', 'error', 'fail'].entries()) F.addRun('cf', { slot: F.dueOf('cf').slot, at: t0 + i * 7 * HOUR, status: s, seconds: 2, excerpt: `run ${i}` });
  F.addRun('ok', { slot: F.dueOf('ok').slot, at: Date.now() - HOUR, status: 'pass', seconds: 3.5, excerpt: 'all good' });
  F.addRun('ok', { slot: F.dueOf('ok').slot, at: Date.now() - 60000, status: 'fail', by: 'ops-09-x' });
  F.hand('supervisor', { type: 'observation', source: 'supervisor', kind: 'retro', subject: 'project', detail: 'retro' }, Date.now() - DAY);
  const rec = F.data().upkeep?.recurring;
  // 19 more runs of cf, all older than its four, for the peek's cap
  for (let i = 0; i < 19; i++) F.addRun('cf', { slot: iso(t0 - DAY / 2 + i * 60000), at: t0 - DAY / 2 + i * 60000 + 1000, status: i % 2 ? 'pass' : 'fail', seconds: 1, excerpt: `old ${i}` });
  return Object.assign(F, { rec, qid });
});

test("A7a: upkeep.recurring.entries lists main's checks, and the whole of upkeep.recurring meets the contract's shape", () => {
  const F = A7();
  assert.deepEqual(F.rec?.entries?.map((e) => e.name), ['cf', 'nv', 'ok']);
  assert.deepEqual(schemaErrors(DASHBOARD_SHAPE, F.rec, 'upkeep.recurring'), []);
  assert.deepEqual(F.rec.entries.map((e) => e.registered?.qid ?? null), [F.qid, null, null], 'registered from the answered landing, else null');
});

// task-7 review F1: a counted line with a longer excerpt (written by hand) still meets the shape
// final-1b F3: a counted line whose slot doesn't parse is no run, so the peek and the dashboard still answer
test('A7m: a counted line with a slot that does not parse is skipped by the peek and the dashboard', () => {
  const F = setup('a7m', { cm: check({ every: '1d' }) });
  F.addRun('cm', { slot: F.dueOf('cm').slot, at: Date.now() - 10 * 60000, status: 'fail' });
  F.addRun('cm', { slot: 'not a time', at: Date.now() - 5 * 60000, status: 'pass' });
  const p = F.dt(['peek', 'recurring', 'cm', '--json']);
  assert.equal(p.status, 0, `the peek answers: ${p.text}`);
  assert.deepEqual(JSON.parse(p.out).runs.map((r) => r.status), ['fail']);
  const e = F.data().upkeep.recurring.entries.find((x) => x.name === 'cm');
  assert.deepEqual([e.state, e.fails_in_a_row], ['failing', 1]);
});

test("A7e: an entry's last.excerpt is at most its last 200 characters, as the peek's are", () => {
  const F = setup('a7e', { ce: check({ every: '1d' }) });
  const long = 'x'.repeat(100) + 'y'.repeat(200);
  F.addRun('ce', { slot: F.dueOf('ce').slot, at: Date.now() - 5 * 60000, status: 'fail', excerpt: long });
  const e = F.data().upkeep.recurring.entries.find((x) => x.name === 'ce');
  assert.equal(e.last.excerpt, 'y'.repeat(200));
});

test('A7s: each entry has its state, last result and fails_in_a_row, counting only the supervisor\'s lines', () => {
  const by = Object.fromEntries((A7().rec?.entries ?? []).map((e) => [e.name, e]));
  assert.deepEqual([by.cf?.state, by.cf?.fails_in_a_row, by.cf?.last?.status, by.cf?.last?.excerpt], ['failing', 3, 'fail', 'run 3']);
  assert.deepEqual([by.ok.state, by.ok.fails_in_a_row, by.ok.last.status, by.ok.last.seconds], ['passing', 0, 'pass', 3.5]);
  assert.deepEqual([by.nv.state, by.nv.last], ['never', null]);
  assert.deepEqual([by.cf.kind, by.cf.by, by.cf.every, by.nv.on, by.cf.title], ['check', null, '6h', 'mon', 'CF fails']);
});

test("A7n: each entry's next_at is recurring due's next", () => {
  const F = A7();
  const due = F.due().checks;
  const got = (F.rec?.entries ?? []).map((e) => [e.name, e.next_at]);
  const sec = (t) => (t ? new Date(t).toISOString().slice(0, 19) + 'Z' : t);
  assert.deepEqual(got, due.map((c) => [c.name, sec(c.next)]).sort());
});

test('A7i: builtin rows for retro, research, kit-sync and sensors, each with its note and setting, in the fixture\'s shape', () => {
  const r = A7().rec;
  assert.deepEqual(r?.builtin?.map((b) => [b.name, b.setting, b.every]), [['retro', 'retro_every_days', '7d'], ['research', 'research_every_days', '7d'], ['kit-sync', 'upstream_check_hours', '24h'], ['sensors', null, 'each cycle']]);
  for (const b of r.builtin) { sameShape(DASH.builtin[0], b, `builtin ${b.name}`); assert.ok(typeof b.note === 'string' && b.note.length > 10, `${b.name} has a note`); }
  const retro = r.builtin[0];
  assert.equal(Date.parse(retro.next_at) - Date.parse(retro.last_at), 7 * DAY, J(retro));
  assert.ok(Array.isArray(r.proposals));
});

test("A7b: peek recurring <name> --json gives the name, the entry with registered, and runs in peek.json's shape", () => {
  const F = A7();
  const p = JSON.parse(F.ok(['peek', 'recurring', 'cf', '--json']));
  assert.deepEqual(schemaErrors(PEEK_SHAPE, p, 'peek'), []);
  assert.deepEqual([p.name, p.entry.run, p.entry.registered?.qid, Object.hasOwn(p.entry, 'on')], ['cf', 'true', F.qid, false]);
});

test('A7c: the peek has the last 20 of 23 runs, newest first', () => {
  const p = JSON.parse(A7().ok(['peek', 'recurring', 'cf', '--json']));
  assert.equal(p.runs?.length, 20, 'the last 20 of 23');
  const ats = p.runs.map((x) => x.at);
  assert.deepEqual(ats, [...ats].sort().reverse(), 'newest first');
  assert.equal(p.runs[0].excerpt, 'run 3');
});

test('A7x: peek recurring of a job not on main fails (the dashboard gets a 404)', () => {
  assert.notEqual(A7().dt(['peek', 'recurring', 'nope', '--json']).status, 0, 'no such job');
});

// ===== A8: the heartbeat =====

const A8 = group(() => {
  const F = setup('a8', { cx: check({ every: '1h' }) });
  const d = new Date();
  const day0 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  F.addRun('cx', { slot: iso(day0 - 3 * DAY + 9 * HOUR), at: day0 - 3 * DAY + 10 * HOUR, status: 'fail', by: 'ops-09-x' });
  F.addRun('cx', { slot: iso(day0 - 3 * DAY + 9 * HOUR), at: day0 - 3 * DAY + 11 * HOUR, status: 'error', detector: null });
  F.addRun('cx', { slot: iso(day0 - 2 * DAY + 9 * HOUR), at: day0 - 2 * DAY + 10 * HOUR, status: 'pass' });
  F.addRun('cx', { slot: iso(day0 - DAY + 9 * HOUR), at: day0 - DAY + 10 * HOUR, status: 'fail' });
  return Object.assign(F, { days: F.data().upkeep_days });
});
const checksOn = (days, i) => days[i].items.filter((x) => x.kind === 'check');

test("A8i: upkeep_days counts a day's check run among its items", () => {
  const { days } = A8();
  assert.equal(checksOn(days, 11).length, 1, 'a pass two days ago is an item');
  assert.equal(days[11].failed, false);
});

test('A8f: a day with a failed check run is marked failed', () => {
  assert.equal(A8().days[12].failed, true, "yesterday's fail turns its day red");
});

test('A8h: a line not written by the supervisor with detector recurring adds nothing', () => {
  const { days } = A8();
  assert.deepEqual([checksOn(days, 10).length, days[10].failed], [0, false], 'hand lines add nothing');
});

test("A8r: a job removed from main keeps its runs in the heartbeat", () => {
  const F = A8();
  F.onMain((j) => { delete j.cx; });
  const days = F.data().upkeep_days;
  assert.deepEqual([checksOn(days, 12).length, days[12].failed], [1, true], "yesterday's run and its red stay");
});

// ===== A9: the docs =====

test('A9: supervisor.md documents the findings, their fixes and recurring ticket', () => {
  const md = fs.readFileSync(path.join(kit, 'process', 'supervisor.md'), 'utf8');
  const s = md.slice(md.indexOf('\n## Recurring jobs'), md.indexOf('\n## 4.'));
  for (const w of ['recurring-failing', 'recurring-stale', 'recurring-invalid', 'recurring ticket', 'recurring-failed', 'recurring-recovered']) assert.ok(s.includes(w), `Recurring jobs names ${w}`);
});

test('A9h: help names recurring ticket', () => {
  const h = spawnSync(process.execPath, [path.join(kit, 'scripts', 'devteam.mjs'), 'help'], { encoding: 'utf8', timeout: T_OUT, env: { PATH: process.env.PATH, HOME: os.tmpdir() } });
  assert.match(h.stdout, /recurring ticket <name>/);
});

// ===== A10: the job peek (kit-166 final-1 F1, F2), in Chrome =====

const initScript = (rec, peeks) => `(() => {
  const si = window.setInterval;
  window.setInterval = (f, ms, ...a) => si(f, ms === 10000 ? 300 : ms, ...a);
  window.__rec = ${J(rec)};
  window.__peeks = ${J(peeks)};
  window.__errors = [];
  window.addEventListener('error', (e) => window.__errors.push(String(e.message || e.error || e)));
  window.addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason && e.reason.message || e.reason)));
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const real = window.fetch;
  window.fetch = async (u, o) => {
    const url = String(u && u.url ? u.url : u);
    const method = String(o?.method || 'GET').toUpperCase();
    if (method === 'GET' && url.startsWith('/api/peek?')) {
      const q = new URLSearchParams(url.slice(10));
      if (q.get('kind') === 'recurring') { window.__calls = (window.__calls || 0) + 1; const p = window.__peeks[q.get('id')]; return p ? json(p) : json({ error: 'no job ' + q.get('id') + ' on main' }, 404); }
    }
    const r = await real(u, o);
    if (method !== 'GET' || !r.ok || !url.startsWith('/api/data')) return r;
    const d = await r.json();
    d.upkeep = { ...(d.upkeep || {}), recurring: window.__rec };
    return json(d);
  };
})();`;

async function openOn(t, peeks, edit = (d) => d) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-rf-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const root = bareProject(base, 'rf');
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 71), DEVTEAM_PORT_BASE: String(PORTS + 72), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of Object.keys(env)) if (k.startsWith('DEVTEAM_') && !['DEVTEAM_HUB_PORT', 'DEVTEAM_PORT_BASE'].includes(k)) delete env[k];
  for (const k of ['TMUX', 'TMUX_PANE']) delete env[k];
  const { dash, port } = await dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: initScript(edit(clone(DASH)), peeks) });
  const soon = async (expr, what, ms = 20000) => {
    const end = Date.now() + ms;
    for (;;) {
      let v, err = null;
      try { v = await p.ev(expr); } catch (e) { err = e; }
      if (v) return v;
      if (Date.now() > end) assert.fail(`timed out: ${what}${err ? `; last: ${err.message}` : ''}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const go = async (hash) => {
    await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/${hash}` });
    await soon("!document.querySelector('main.waiting') && typeof DATA !== 'undefined' && !!DATA", 'the page with its data');
  };
  return { p, soon, go };
}
const sectHeads = "[...document.querySelectorAll('#drawer-body > .card.psect')].map((c) => (c.querySelector(':scope > .card-head')?.textContent ?? '').trim())";

test('A10: a job that is not found shows No such job. and no History card (kit-166 final-1 F1)', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go } = await openOn(t, {});
  await go('#recurring/nope');
  await soon("DRAWER.kind === 'recurring' && DRAWER.id === 'nope' && document.getElementById('drawer-body').textContent.includes('No such job.')", 'the not-found job');
  const heads = await p.ev(sectHeads);
  assert.ok(!heads.some((h) => h.startsWith('History')), `no History card: ${heads}`);
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('A10b: a job peek whose details answered 404 while its row is in the data fills in once they arrive, without a reload (kit-166 final-1 F2)', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go } = await openOn(t, {});
  await go('#recurring/ci-main');
  await soon("DRAWER.kind === 'recurring' && DRAWER.id === 'ci-main' && [...PEEKS.values()].some((v) => v && v.missing)", 'the 404 stored');
  await p.ev(`window.__peeks['ci-main'] = ${J(PEEK_FX['ci-main'])}; void 0`);
  await soon(`(document.getElementById('drawer-body').textContent || '').includes(${J(PEEK_FX['ci-main'].runs[0].excerpt)}) && (document.getElementById('drawer-body').textContent || '').includes(${J(PEEK_FX['ci-main'].entry.run)})`, 'Recent runs and Runs filled in', 15000);
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('A10c: a job peek that keeps answering 404 is asked again at most once every 10 s', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go } = await openOn(t, {});
  await go('#recurring/ci-main');
  await soon("DRAWER.kind === 'recurring' && DRAWER.id === 'ci-main' && (window.__calls || 0) >= 1", 'the first request');
  await new Promise((r) => setTimeout(r, 12000));
  const n = await p.ev('window.__calls');
  assert.ok(n <= 3, `${n} requests in 12 s`);
});

test('A10d: a job whose registered is null opens its peek with no error, and no Registered by link', { ...CHROME, timeout: 300000 }, async (t) => {
  const peek = { ...clone(PEEK_FX['ci-main']), name: 'smoke-prod' };
  peek.entry = { ...peek.entry, registered: null };
  const { p, soon, go } = await openOn(t, { 'smoke-prod': peek }, (d) => { d.entries.find((e) => e.name === 'smoke-prod').registered = null; return d; });
  await go('#recurring/smoke-prod');
  await soon("DRAWER.kind === 'recurring' && DRAWER.id === 'smoke-prod' && (document.getElementById('drawer-body').textContent || '').includes('Every')", 'the job peek drawn');
  assert.deepEqual(await p.ev('window.__errors'), []);
  assert.equal(await p.ev("document.querySelectorAll('#drawer-body a[href*=\"q-\"]').length"), 0, 'no question link');
});
