// The writers of a wait (kit-571; design every-wait-names-its-cause-and-every-put, "Writers" and
// "Fleet ops keep the cause"): `ticket hold` and `ticket release`, a hold the supervisor or a planner
// writes refused when it names no cause, a cause in no known form or not in the log, a cause the kit
// can't follow with no date, a date out of range, a wait on itself (directly or through a chain of
// holds), or a question cause with no --whole. devteam.mjs exports nothing, so every rule is
// tested through the CLI on throwaway projects, each with a HOME of its own and no DEVTEAM_* from the
// caller, as test/waits.test.mjs builds them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { bareProject } from './lib/kit.mjs';
import { runNode } from './lib/cli.mjs';

const bases = [];
process.on('exit', () => { if (!process.env.DEVTEAM_TEST_KEEP) for (const b of bases) fs.rmSync(b, { recursive: true, force: true }); });

// A project of its own, with a HOME of its own beside it and no DEVTEAM_* from the caller.
function project(name) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-waits-holds-'));
  bases.push(base);
  fs.mkdirSync(path.join(base, 'home'));
  return bareProject(base, name);
}
const envFor = (dir, extra = {}) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEVTEAM_') && k !== 'TMUX'));
  return { ...env, HOME: path.join(path.dirname(dir), 'home'), DEVTEAM_HUB_PORT: '1', ...extra };
};
const cli = (dir, args, extra = {}) => { const r = runNode(path.join(dir, 'docs/devteam/scripts/devteam.mjs'), args, { cwd: dir, env: envFor(dir, extra) }); return { status: r.status, out: r.stdout, err: r.stderr }; };
const ok = (dir, args, extra = {}) => { const r = cli(dir, args, extra); assert.equal(r.status, 0, `${args.join(' ')}: ${r.err}${r.out}`); return r.out; };
// A planner of feature fg: its lines go to project/log/plan-fg.jsonl.
const PLANNER = { DEVTEAM_FEATURE: 'fg' };

// Hand-written lines, as each writer's kit would append them: a clock that moves a millisecond a line.
let clock = Date.parse('2026-11-18T09:00:00.000Z');
const PREFIX = { goal: 'g', observation: 'o', question: 'q', act: 'a' };
function logLine(dir, writer, body) {
  const at = new Date((clock += 1)).toISOString();
  const d = at.replace(/[-:TZ.]/g, '');
  const id = body.id ?? `${PREFIX[body.type]}-${d.slice(0, 8)}-${d.slice(8, 17)}-${writer}`;
  const file = ['supervisor', 'owner'].includes(writer) ? `${writer}-${at.slice(0, 7)}` : writer;
  const line = { v: 1, op: 'new', ...body, id, at, by: writer, ...(writer === 'owner' ? { channel: 'cli' } : {}) };
  const f = path.join(dir, 'docs/devteam/run/log', `${file}.jsonl`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.appendFileSync(f, `${JSON.stringify(line)}\n`);
  return id;
}

// Every log line, from every *.jsonl under run/log and project/log (a planner writes project/log, and
// the CLI's monthly file name may differ from the hand-written lines').
function allLines(dir) {
  const lines = [];
  for (const d of ['docs/devteam/run/log', 'docs/devteam/project/log']) {
    const abs = path.join(dir, d);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).filter((n) => n.endsWith('.jsonl'))) {
      for (const l of fs.readFileSync(path.join(abs, f), 'utf8').split('\n')) if (l.trim()) lines.push({ ...JSON.parse(l), __file: path.join(d, f) });
    }
  }
  return lines;
}
// The log lines whose type and id are the subject's: what "nothing written" and "one line" count.
const linesFor = (dir, type, id) => allLines(dir).filter((l) => l.type === type && l.id === id).length;
const lastFor = (dir, type, id) => allLines(dir).filter((l) => l.type === type && l.id === id).pop();
const acts = (dir) => allLines(dir).filter((l) => l.type === 'act');

// A UTC date n days from now.
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
// Run fn (it computes its dates from day()) and run it once more if the UTC day changed meanwhile,
// so a case at an edge never flakes at midnight.
const atDay = (fn) => { const d = day(0); const r = fn(); return day(0) === d ? r : fn(); };

// The fixture: goal G (ready, the owner's) with feature fg holding kit-01-probe, kit-02-other and
// kit-03-third; goal G2 with feature fo holding kit-09-elsewhere.
const T = 'kit-01-probe';
const ticketLine = (id, feature = 'fg', extra = {}) => ({
  type: 'ticket', id, title: `Ticket ${id}`, feature, component: 'kit', kind: 'build', size: 'S', risk: 'normal',
  serves: [], depends_on: [], touches: [`test/${id}.mjs`], done_when: [`${id} answers in a test`], ...extra,
});
const featureLine = (id, goals) => ({ type: 'feature', id, title: `Feature ${id}`, goals });
const readyGoal = (dir) => logLine(dir, 'owner', { type: 'goal', title: 'A goal to hold', status: 'ready' });
function fixture(name, extra = {}) {
  const dir = project(name);
  const G = readyGoal(dir);
  const G2 = readyGoal(dir);
  logLine(dir, 'supervisor', featureLine('fg', [G]));
  logLine(dir, 'supervisor', featureLine('fo', [G2]));
  for (const id of [T, 'kit-02-other', 'kit-03-third']) logLine(dir, 'supervisor', ticketLine(id, 'fg', extra[id]));
  logLine(dir, 'supervisor', ticketLine('kit-09-elsewhere', 'fo', extra['kit-09-elsewhere']));
  return { dir, G, G2 };
}
const question = (dir) => logLine(dir, 'supervisor', { type: 'question', kind: 'owner-decision', question: 'Which vendor?' });
const show = (dir, id) => JSON.parse(ok(dir, ['ticket', 'show', id]));

// A hold that is refused: nonzero, the words on stderr, and no line for the ticket written.
function refused(dir, args, words, extra = {}, id = T) {
  const before = linesFor(dir, 'ticket', id);
  const actsBefore = acts(dir).length;
  const r = cli(dir, args, extra);
  assert.notEqual(r.status, 0, `${args.join(' ')} is refused: ${r.out}`);
  assert.ok(r.err.includes(words), `${args.join(' ')}: stderr names "${words}": ${r.err}`);
  assert.equal(linesFor(dir, 'ticket', id), before, `${args.join(' ')}: nothing written`);
  assert.equal(acts(dir).length, actsBefore, `${args.join(' ')}: no act written`);
}
// A hold that is accepted: zero, and exactly one new line for the ticket.
function accepted(dir, args, extra = {}, id = T) {
  const before = linesFor(dir, 'ticket', id);
  ok(dir, args, extra);
  assert.equal(linesFor(dir, 'ticket', id), before + 1, `${args.join(' ')}: one line`);
  return lastFor(dir, 'ticket', id);
}

test('waits A3: ticket hold and ticket release write a hold\'s cause and clear it in one line', async (t) => {
  await t.test('a hold for a question, with --until and --whole, is one line; ticket show reads it', () => {
    const { dir } = fixture('a3-hold');
    const q = question(dir);
    const until = day(7);
    const line = accepted(dir, ['ticket', 'hold', T, '--reason', ' r ', '--for', q, '--until', until, '--whole', 'w']);
    assert.equal(line.op, 'set');
    assert.equal(line.by, 'supervisor');
    assert.equal(line.held, 'r (whole: w)');
    assert.deepEqual(line.held_for, [q]);
    assert.equal(line.held_until, until);
    const s = show(dir, T);
    assert.equal(s.held, 'r (whole: w)');
    assert.deepEqual(s.held_for, [q]);
    assert.equal(s.held_until, until);
    const act = acts(dir).pop();
    assert.equal(act.class, 'replan-within-feature');
    assert.equal(act.what, `held ticket ${T} for ${q}`);
    assert.deepEqual(act.refs, [T]);
  });

  await t.test('a hold for an external cause with a date needs no --whole', () => {
    const { dir } = fixture('a3-external');
    const until = day(3);
    const line = accepted(dir, ['ticket', 'hold', T, '--reason', 'r', '--for', 'external:x', '--until', until]);
    assert.equal(line.held, 'r');
    assert.deepEqual(line.held_for, ['external:x']);
    assert.equal(line.held_until, until);
  });

  await t.test('causes given as a JSON array are read, trimmed and de-duplicated; no --until writes null', () => {
    const { dir } = fixture('a3-json');
    const line = accepted(dir, ['ticket', 'hold', T, '--reason', 'r', '--for', '["kit-02-other"," kit-02-other "]']);
    assert.deepEqual(line.held_for, ['kit-02-other']);
    assert.equal(line.held_until, null);
    const twice = accepted(dir, ['ticket', 'hold', T, '--reason', 'r', '--for', 'kit-03-third', 'kit-03-third']);
    assert.deepEqual(twice.held_for, ['kit-03-third']);
  });

  await t.test('the supervisor re-holds a ticket it holds with a new cause', () => {
    const { dir } = fixture('a3-rehold');
    accepted(dir, ['ticket', 'hold', T, '--reason', 'r', '--for', 'kit-02-other']);
    const until = day(5);
    const line = accepted(dir, ['ticket', 'hold', T, '--reason', 'r2', '--for', 'external:the vendor key', '--until', until]);
    assert.deepEqual(line.held_for, ['external:the vendor key']);
    const s = show(dir, T);
    assert.equal(s.held, 'r2');
    assert.deepEqual(s.held_for, ['external:the vendor key']);
    assert.equal(s.held_until, until);
  });

  await t.test('ticket release writes the three nulls in one line, and ticket show reads none held', () => {
    const { dir } = fixture('a3-release');
    accepted(dir, ['ticket', 'hold', T, '--reason', 'r', '--for', 'external:x', '--until', day(3)]);
    const line = accepted(dir, ['ticket', 'release', T, '--reason', 'the key came']);
    assert.equal(line.held, null);
    assert.equal(line.held_for, null);
    assert.equal(line.held_until, null);
    const s = show(dir, T);
    assert.equal(s.held, null);
    assert.equal(s.held_for ?? null, null);
    assert.equal(s.held_until ?? null, null);
    const act = acts(dir).pop();
    assert.equal(act.class, 'replan-within-feature');
    assert.equal(act.what, `released ticket ${T}: the key came`);
  });

  await t.test('an old-style hand-written hold (no held_for) is released', () => {
    const { dir } = fixture('a3-old', { [T]: { held: 'waits on the vendor' } });
    const line = accepted(dir, ['ticket', 'release', T]);
    assert.deepEqual([line.held, line.held_for, line.held_until], [null, null, null]);
    assert.equal(acts(dir).pop().what, `released ticket ${T}`);
    assert.equal(show(dir, T).held, null);
  });

  await t.test('a ticket that is not held is not released', () => {
    const { dir } = fixture('a3-unheld');
    refused(dir, ['ticket', 'release', T], `${T} is not held`);
  });
});

test('waits A4: a hold with no cause, a cause in no known form or not in the log, a bad date, a wait on itself, or a question with no --whole is refused', async (t) => {
  await t.test('rules 1-5 and the command\'s own words: each refused, nothing written', () => {
    const { dir } = fixture('a4-refused', { 'kit-03-third': { superseded_by: 'kit-02-other' } });
    const hold = (...rest) => ['ticket', 'hold', T, '--reason', 'r', ...rest];
    refused(dir, hold(), 'a hold names what it waits on: --for <cause>');
    refused(dir, hold('--for', ' '), 'a hold names what it waits on: --for <cause>');
    for (const c of ['pr:home#4', 'run:home:12', 'external:x']) refused(dir, hold('--for', c), `the kit can't follow ${c}: give it --until <date>`);
    atDay(() => refused(dir, hold('--for', 'external:x', '--until', day(-1)), `--until ${day(-1)} is in the past`));
    atDay(() => refused(dir, hold('--for', 'external:x', '--until', day(31)), `--until ${day(31)} is more than 30 days ahead (at most ${day(30)})`));
    for (const d of ['next-week', '2026-02-30', '2026-1-05']) refused(dir, hold('--for', 'external:x', '--until', d), `--until ${d} is not a date (YYYY-MM-DD)`);
    for (const c of ['until:2026-12-01', 'foo bar', 'g-20261118-100000000-owner']) refused(dir, hold('--for', c), `${c} is in no known form`);
    for (const c of ['q-20261118-100000000-supervisor', 'kit-77-nothing', 'goal:g-20261118-100000000-owner', 'chore:nothing']) refused(dir, hold('--for', c), `${c} is not in the log`);
    // every cause is checked: a good one first does not let a bad one through
    refused(dir, hold('--for', 'kit-02-other', 'kit-77-nothing'), 'kit-77-nothing is not in the log');
    refused(dir, hold('--until', day(3)), '--until goes with --for');
    refused(dir, ['ticket', 'hold', T, '--for', 'kit-02-other'], 'ticket hold needs --reason "<why>"');
    refused(dir, ['ticket', 'hold', T, '--reason', '  ', '--for', 'kit-02-other'], 'ticket hold needs --reason "<why>"');
    refused(dir, ['ticket', 'hold', 'kit-03-third', '--reason', 'r', '--for', 'kit-02-other'], 'kit-03-third is superseded: nothing to hold', {}, 'kit-03-third');
  });

  await t.test('a merged ticket is not held', () => {
    const { dir } = fixture('a4-merged');
    // a squash commit on main named for the ticket is its merge (findMergeSha)
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', `${T}: landed`], { cwd: dir, env: envFor(dir), stdio: 'pipe' });
    refused(dir, ['ticket', 'hold', T, '--reason', 'r', '--for', 'kit-02-other'], `${T} is merged: nothing to hold`);
  });

  await t.test('a chore cause is accepted when an act refs chore-<slug> (its merge), with no branch', () => {
    const { dir } = fixture('a4-chore-act');
    refused(dir, ['ticket', 'hold', T, '--reason', 'r', '--for', 'chore:tidy'], 'chore:tidy is not in the log');
    logLine(dir, 'supervisor', { type: 'act', class: 'merge-chore', what: 'merged chore-tidy at 0000000', refs: ['chore-tidy'], reversible: false });
    const line = accepted(dir, ['ticket', 'hold', T, '--reason', 'r', '--for', 'chore:tidy']);
    assert.deepEqual(line.held_for, ['chore:tidy']);
  });

  await t.test('a hold that waits on itself is refused, naming the path', () => {
    // kit-02-other depends on kit-01-probe, kit-03-third on kit-02-other: T, U, V of goal G
    const U = 'kit-02-other';
    const V = 'kit-03-third';
    const { dir, G } = fixture('a4-self', { [U]: { depends_on: [T] }, [V]: { depends_on: [U] } });
    const hold = (id, ...causes) => ['ticket', 'hold', id, '--reason', 'r', '--for', ...causes];
    refused(dir, hold(T, `goal:${G}`), `goal:${G} waits on ${T} itself`);
    refused(dir, hold(T, T), `${T} waits on ${T} itself`);
    refused(dir, hold(T, U), `${U} waits on ${T} itself`);
    refused(dir, hold(T, V), `${V} waits on ${T} itself`);
    // a good cause first does not let a self-wait through
    refused(dir, hold(T, 'kit-09-elsewhere', V), `${V} waits on ${T} itself`);
    // U may still be held for something else, and V for an unrelated ticket of another goal
    accepted(dir, hold(U, 'external:x', '--until', day(3)), {}, U);
    accepted(dir, hold(V, 'kit-09-elsewhere'), {}, V);
  });

  await t.test('a superseded or merged ticket is not the hold itself: its dependency and its hold are not followed', () => {
    // kit-03-third (superseded) and kit-02-other (merged) each depend on T
    const U = 'kit-02-other';
    const V = 'kit-03-third';
    const { dir } = fixture('a4-dead', { [U]: { depends_on: [T] }, [V]: { depends_on: [T], superseded_by: 'kit-09-elsewhere' } });
    const hold = (...causes) => ['ticket', 'hold', T, '--reason', 'r', '--for', ...causes];
    refused(dir, hold(U), `${U} waits on ${T} itself`);
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', `${U}: landed`], { cwd: dir, env: envFor(dir), stdio: 'pipe' });
    accepted(dir, hold(V));
    accepted(dir, hold(U));
    // a stale hold on a superseded ticket that names T is not a hold in force
    const W = 'kit-04-w';
    logLine(dir, 'supervisor', ticketLine(W, 'fo', { superseded_by: 'kit-09-elsewhere' }));
    logLine(dir, 'supervisor', { type: 'ticket', op: 'set', id: W, held: 'w', held_for: [T], held_until: null });
    accepted(dir, hold(W));
  });

  await t.test('a draining goal\'s hold_for is followed while the drain is in force', () => {
    const { dir, G2 } = fixture('a4-drain-chain');
    // the supervisor's drain of G2 (feature fo, which does not own T) waits on T
    logLine(dir, 'supervisor', { type: 'goal', op: 'set', id: G2, hold: { mode: 'drain', reason: 'waits on the probe' }, hold_for: [T], hold_until: null });
    refused(dir, ['ticket', 'hold', T, '--reason', 'r', '--for', `goal:${G2}`], `goal:${G2} waits on ${T} itself, through goal:${G2} -> ${T}`);
    // the drain released: nothing to follow
    logLine(dir, 'supervisor', { type: 'goal', op: 'set', id: G2, hold: { mode: 'run' } });
    accepted(dir, ['ticket', 'hold', T, '--reason', 'r', '--for', `goal:${G2}`]);
  });

  await t.test('ticket set and ticket add with held are held to the same rule as ticket hold', () => {
    const { dir, G } = fixture('a4-set', { 'kit-03-third': { superseded_by: 'kit-02-other' } });
    const q = question(dir);
    const set = (id, body, ...rest) => ['ticket', 'set', id, '--json', JSON.stringify(body), ...rest];
    // refused, nothing written
    refused(dir, set(T, { held: 'x' }), 'a hold names what it waits on: --for <cause>');
    refused(dir, set(T, { held: 'x' }), `ticket hold ${T} --for`);
    refused(dir, set(T, { held: 'x', held_for: [] }), 'a hold names what it waits on: --for <cause>');
    refused(dir, set(T, { held: '' }), 'release with null: {"held": null}');
    refused(dir, set(T, { held: '  ', held_for: ['kit-02-other'] }), 'release with null: {"held": null}');
    refused(dir, set(T, { held_for: ['kit-02-other'] }), 'held_for and held_until go with held');
    refused(dir, set(T, { held: null, held_until: day(3) }), 'held_for and held_until go with held');
    refused(dir, set(T, { held: 'x', held_for: ['kit-77-nothing'] }), 'kit-77-nothing is not in the log');
    atDay(() => refused(dir, set(T, { held: 'x', held_for: ['external:x'], held_until: day(31) }), `--until ${day(31)} is more than 30 days ahead`));
    refused(dir, set(T, { held: 'x', held_for: [`goal:${G}`] }), `goal:${G} waits on ${T} itself`);
    refused(dir, set(T, { held: 'x', held_for: [q] }), `${T} waits on ${q}: hold only the part the answer gates`);
    refused(dir, set(T, { held: 'x', held_for: [q] }, '--whole'), '--whole needs the reason no part can go ahead');
    refused(dir, set('kit-03-third', { held: 'x', held_for: ['kit-02-other'] }), 'kit-03-third is superseded: nothing to hold', {}, 'kit-03-third');

    // accepted: causes de-duplicated and trimmed, no held_until written as null
    const line = accepted(dir, set(T, { held: 'x', held_for: ['kit-02-other', ' kit-02-other '] }));
    assert.equal(line.held, 'x');
    assert.deepEqual(line.held_for, ['kit-02-other']);
    assert.equal(line.held_until, null);
    const whole = accepted(dir, set(T, { held: 'x', held_for: [q] }, '--whole', 'w'));
    assert.equal(whole.held, 'x (whole: w)');
    assert.deepEqual(whole.held_for, [q]);
    // a release through set carries the nulls
    const rel = accepted(dir, set(T, { held: null }));
    assert.deepEqual([rel.held, rel.held_for, rel.held_until], [null, null, null]);
    assert.equal(show(dir, T).held, null);
    // a set that does not touch the hold is untouched by the rule
    const plain = accepted(dir, set(T, { title: 'Renamed' }));
    assert.equal('held_for' in plain, false);

    // ticket add with held: its own feature's goal is itself; another goal's ticket is not
    const N = 'kit-07-new';
    const add = (id, extra) => ['ticket', 'add', id, '--json', JSON.stringify({ ...ticketLine(id, 'fg'), id: undefined, type: undefined, ...extra })];
    refused(dir, add(N, { held: 'x', held_for: [`goal:${G}`] }), `goal:${G} waits on ${N} itself`, {}, N);
    refused(dir, add(N, { held: 'x' }), 'a hold names what it waits on: --for <cause>', {}, N);
    const added = accepted(dir, add(N, { held: 'x', held_for: ['kit-09-elsewhere'] }), {}, N);
    assert.equal(added.op, 'new');
    assert.deepEqual(added.held_for, ['kit-09-elsewhere']);
  });

  await t.test('a hold whose cause\'s holds reach it is refused (one hop, two hops, to its goal)', () => {
    const W = 'kit-04-w';
    const X = 'kit-05-x';
    const Y = 'kit-06-y';
    const U2 = 'kit-09-elsewhere';
    const { dir, G } = fixture('a4-chain');
    for (const id of [W, X, Y]) logLine(dir, 'supervisor', ticketLine(id, 'fg'));
    // hand-written holds, so each case is independent of what the CLI would let through
    logLine(dir, 'supervisor', { type: 'ticket', op: 'set', id: X, held: 'x', held_for: [W], held_until: null });
    refused(dir, ['ticket', 'hold', W, '--reason', 'r', '--for', X], `${X} waits on ${W} itself, through ${X} -> ${W}`, {}, W);
    logLine(dir, 'supervisor', { type: 'ticket', op: 'set', id: Y, held: 'y', held_for: [X], held_until: null });
    refused(dir, ['ticket', 'hold', W, '--reason', 'r', '--for', Y], `${Y} waits on ${W} itself, through ${Y} -> ${X} -> ${W}`, {}, W);
    // U2 (a ticket of G2) held for goal:G: T (of G) held for U2 reaches its own goal
    logLine(dir, 'supervisor', { type: 'ticket', op: 'set', id: U2, held: 'u2', held_for: [`goal:${G}`], held_until: null });
    refused(dir, ['ticket', 'hold', T, '--reason', 'r', '--for', U2], `${U2} waits on ${T} itself, through ${U2} -> goal:${G}`);
    // a released hold is not followed
    logLine(dir, 'supervisor', { type: 'ticket', op: 'set', id: U2, held: null, held_for: null, held_until: null });
    accepted(dir, ['ticket', 'hold', T, '--reason', 'r', '--for', U2]);
  });

  await t.test('a question holds only what it gates: --whole "<why>", or split first', () => {
    const { dir } = fixture('a4-question');
    const q = question(dir);
    const hold = (...rest) => ['ticket', 'hold', T, '--reason', 'r', '--for', q, ...rest];
    refused(dir, hold(), `${T} waits on ${q}: hold only the part the answer gates`);
    const r = cli(dir, hold());
    assert.ok(r.err.includes('ticket add') && r.err.includes('--whole "<why>"'), `the words say to split or pass --whole: ${r.err}`);
    // a question among other causes still needs it
    refused(dir, ['ticket', 'hold', T, '--reason', 'r', '--for', 'kit-09-elsewhere', q], `${T} waits on ${q}: hold only the part the answer gates`);
    // --whole with no words, or blank words
    refused(dir, hold('--whole'), '--whole needs the reason no part can go ahead');
    refused(dir, hold('--whole', '  '), '--whole needs the reason no part can go ahead');
    const line = accepted(dir, hold('--whole', 'w'));
    assert.equal(line.held, 'r (whole: w)');
    // no question: no --whole needed
    const plain = accepted(dir, ['ticket', 'hold', T, '--reason', 'r', '--for', 'kit-09-elsewhere']);
    assert.equal(plain.held, 'r');
  });

  await t.test('accepted: the date edges, an unrelated ticket, a goal and a chore whose branch exists', () => {
    for (const n of [0, 30]) {
      atDay(() => {
        const { dir } = fixture(`a4-edge-${n}`);
        const line = accepted(dir, ['ticket', 'hold', T, '--reason', 'r', '--for', 'external:x', '--until', day(n)]);
        assert.equal(line.held_until, day(n));
      });
    }
    const { dir, G2 } = fixture('a4-accepted');
    accepted(dir, ['ticket', 'hold', T, '--reason', 'r', '--for', 'kit-09-elsewhere']);
    accepted(dir, ['ticket', 'hold', T, '--reason', 'r', '--for', `goal:${G2}`]);
    const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd: dir, env: envFor(dir), stdio: 'pipe' });
    refused(dir, ['ticket', 'hold', T, '--reason', 'r', '--for', 'chore:x'], 'chore:x is not in the log');
    git('commit', '-q', '--allow-empty', '-m', 'first');
    git('branch', 'chore-x');
    const line = accepted(dir, ['ticket', 'hold', T, '--reason', 'r', '--for', 'chore:x']);
    assert.deepEqual(line.held_for, ['chore:x']);
  });

  await t.test('a planner may not change a hold the supervisor set, nor hold another feature\'s ticket', () => {
    const { dir } = fixture('a4-planner');
    const sup = accepted(dir, ['ticket', 'hold', T, '--reason', 'r', '--for', 'external:x', '--until', day(3)]);
    assert.equal(sup.by, 'supervisor');
    const words = `${T}'s hold was set by the supervisor: a planner may not change it`;
    refused(dir, ['ticket', 'hold', T, '--reason', 'mine', '--for', 'kit-02-other'], words, PLANNER);
    refused(dir, ['ticket', 'release', T], words, PLANNER);
    assert.equal(show(dir, T).held, 'r', 'the supervisor\'s hold stands');

    // an unheld fg ticket: the planner's hold is one line in its own file, with no act
    const actsBefore = acts(dir).length;
    const line = accepted(dir, ['ticket', 'hold', 'kit-02-other', '--reason', 'p', '--for', 'external:y', '--until', day(3)], PLANNER, 'kit-02-other');
    assert.equal(line.by, 'plan-fg');
    assert.equal(line.__file, 'docs/devteam/project/log/plan-fg.jsonl');
    assert.equal(acts(dir).length, actsBefore, 'a planner writes no act');
    assert.equal(show(dir, 'kit-02-other').held, 'p');
    // and releases it
    accepted(dir, ['ticket', 'release', 'kit-02-other'], PLANNER, 'kit-02-other');
    assert.equal(show(dir, 'kit-02-other').held, null);

    // held by the supervisor and released: a planner's held still ranks below that release
    accepted(dir, ['ticket', 'hold', 'kit-03-third', '--reason', 'r', '--for', 'kit-02-other'], {}, 'kit-03-third');
    accepted(dir, ['ticket', 'release', 'kit-03-third'], {}, 'kit-03-third');
    refused(dir, ['ticket', 'hold', 'kit-03-third', '--reason', 'p', '--for', 'kit-02-other'], `kit-03-third's hold was set by the supervisor: a planner may not change it`, PLANNER, 'kit-03-third');

    // another feature's ticket
    refused(dir, ['ticket', 'hold', 'kit-09-elsewhere', '--reason', 'p', '--for', 'kit-02-other'], 'plan-fg may only change the feature "fg" and its tickets', PLANNER, 'kit-09-elsewhere');
  });
});
