// The wait contract (kit-570; design every-wait-names-its-cause-and-every-put, A1 and A2): the log's
// new top-level fields (held_for, held_until, from on a ticket; hold_for, hold_until on a goal), the
// fold keeping a hold's cause beside the hold, waitCause()'s parser, and next-move@1's additions in
// the comment above nextMoves() with their fixtures in test/fixtures/waits/. devteam.mjs exports
// nothing, so its rules are tested through log-check, goal show and dashboard-data on throwaway
// projects, and waitCause() is lifted out of the source under node:vm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { kit, bareProject } from './lib/kit.mjs';
import { runNode } from './lib/cli.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const DT = path.join(kit, 'scripts/devteam.mjs');
const SRC = fs.readFileSync(DT, 'utf8');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(kit, 'schema/log.schema.json'), 'utf8'));
const FIX = path.join(here, 'fixtures', 'waits');
const bases = [];
process.on('exit', () => { if (!process.env.DEVTEAM_TEST_KEEP) for (const b of bases) fs.rmSync(b, { recursive: true, force: true }); });

// A project of its own, with a HOME of its own beside it and no DEVTEAM_* from the caller.
function project(name) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-waits-'));
  bases.push(base);
  fs.mkdirSync(path.join(base, 'home'));
  return bareProject(base, name);
}
const envFor = (dir) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEVTEAM_') && k !== 'TMUX'));
  return { ...env, HOME: path.join(path.dirname(dir), 'home'), DEVTEAM_HUB_PORT: '1' };
};
const cli = (dir, args) => { const r = runNode(path.join(dir, 'docs/devteam/scripts/devteam.mjs'), args, { cwd: dir, env: envFor(dir) }); return { status: r.status, out: r.stdout, err: r.stderr }; };
const ok = (dir, args) => { const r = cli(dir, args); assert.equal(r.status, 0, `${args.join(' ')}: ${r.err}${r.out}`); return r.out; };

// Hand-written lines, as each writer's kit would append them: a clock that moves a millisecond a line.
let clock = Date.parse('2026-11-18T09:00:00.000Z');
const PREFIX = { goal: 'g', observation: 'o', question: 'q' };
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
const TICKET = 'kit-01-probe';
const ticketNew = (extra = {}) => ({
  type: 'ticket', id: TICKET, title: 'A probe', feature: 'waits', component: 'kit', kind: 'build', size: 'S', risk: 'normal',
  serves: [], depends_on: [], touches: ['test/x.mjs'], done_when: ['the probe answers in a test'], ...extra,
});
const Q = 'q-20261118-100000000-supervisor';
const O = 'o-20261118-100000000-kit-01-probe';
// A ready goal, the owner's.
const readyGoal = (dir) => logLine(dir, 'owner', { type: 'goal', title: 'A goal to hold', status: 'ready' });
const goalSet = (dir, writer, g, body) => logLine(dir, writer, { type: 'goal', op: 'set', id: g, ...body });
const DRAIN = { hold: { mode: 'drain', reason: 'waits on the probe' }, hold_for: [TICKET], hold_until: '2026-11-30' };
const show = (dir, g) => JSON.parse(ok(dir, ['goal', 'show', g]));
const logCheck = (dir) => cli(dir, ['log-check']);
const unknownLines = (out) => out.split('\n').filter((l) => l.startsWith("a newer kit's line"));

test('waits A1: holds and follow-ups carry their fields in the log, and the fold keeps a hold\'s cause', async (t) => {
  await t.test('the new fields pass the schema check', () => {
    const dir = project('a1-schema');
    logLine(dir, 'supervisor', ticketNew({ held: 'waits on an answer', held_for: [Q, 'external:the vendor key'], held_until: '2026-11-30', from: [O] }));
    logLine(dir, 'supervisor', { type: 'ticket', op: 'set', id: TICKET, held: null, held_for: null, held_until: null, from: null });
    logLine(dir, 'supervisor', { type: 'ticket', op: 'set', id: TICKET, from: [O] });
    const g = readyGoal(dir);
    goalSet(dir, 'supervisor', g, DRAIN);
    goalSet(dir, 'owner', g, { hold: { mode: 'run' }, hold_for: null, hold_until: null });
    const r = logCheck(dir);
    assert.equal(r.status, 0, r.out + r.err);
    assert.deepEqual(unknownLines(r.out), [], 'no field is set aside as unknown');
  });

  await t.test('lines without them still pass', () => {
    const dir = project('a1-without');
    logLine(dir, 'supervisor', ticketNew({ held: 'waits on an answer' }));
    logLine(dir, 'supervisor', { type: 'ticket', op: 'set', id: TICKET, held: null });
    const g = readyGoal(dir);
    goalSet(dir, 'supervisor', g, { hold: DRAIN.hold });
    const r = logCheck(dir);
    assert.equal(r.status, 0, r.out + r.err);
    assert.deepEqual(unknownLines(r.out), []);
  });

  await t.test('a non-array cause list is refused, and so is a cause nested in hold', () => {
    const cases = [
      ['held_for', (dir) => { logLine(dir, 'supervisor', ticketNew()); logLine(dir, 'supervisor', { type: 'ticket', op: 'set', id: TICKET, held: 'x', held_for: Q }); }],
      ['hold_for', (dir) => { const g = readyGoal(dir); goalSet(dir, 'supervisor', g, { hold: DRAIN.hold, hold_for: TICKET }); }],
      ['hold', (dir) => { const g = readyGoal(dir); goalSet(dir, 'supervisor', g, { hold: { ...DRAIN.hold, hold_for: [TICKET] } }); }],
      ['held_until', (dir) => { logLine(dir, 'supervisor', ticketNew()); logLine(dir, 'supervisor', { type: 'ticket', op: 'set', id: TICKET, held: 'x', held_until: 'next week' }); }],
    ];
    for (const [field, write] of cases) {
      const dir = project(`a1-refused-${field.replace('_', '-')}`);
      write(dir);
      const r = logCheck(dir);
      assert.notEqual(r.status, 0, `${field}: log-check refuses it`);
      assert.match(r.out + r.err, new RegExp(field), `${field}: the refusal names it`);
    }
  });

  await t.test('hold itself is unchanged: still closed, no cause inside', () => {
    const hold = SCHEMA.$defs.types.goal.properties.hold;
    assert.equal(hold.additionalProperties, false);
    assert.deepEqual(Object.keys(hold.properties), ['mode', 'reason', 'fleet', 'undoes', 'prior', 'host', 'move']);
    for (const t of ['ticket', 'goal']) for (const k of t === 'ticket' ? ['held_for', 'held_until', 'from'] : ['hold_for', 'hold_until']) assert.ok(SCHEMA.$defs.types[t].properties[k], `${t}.${k} is a top-level field`);
  });

  // the fold: one project, the goal's hold changed line by line and read after each
  const dir = project('a1-fold');
  const g = readyGoal(dir);
  const noCause = (v) => { assert.ok(!('hold_for' in v), `no hold_for: ${JSON.stringify(v.hold_for)}`); assert.ok(!('hold_until' in v), `no hold_until: ${JSON.stringify(v.hold_until)}`); };

  await t.test("a supervisor's drain with its cause is applied, and the goal keeps the cause beside hold", () => {
    goalSet(dir, 'supervisor', g, DRAIN);
    const v = show(dir, g);
    assert.equal(v.hold?.mode, 'drain', 'the goal reads draining');
    assert.deepEqual(v.hold_for, DRAIN.hold_for);
    assert.equal(v.hold_until, DRAIN.hold_until);
    const d = JSON.parse(ok(dir, ['dashboard-data']));
    const dg = d.ooda.goals.find((x) => x.id === g);
    assert.ok(dg, 'the goal is in /api/data ooda.goals');
    assert.equal(dg.hold?.mode, 'drain');
    assert.deepEqual(dg.hold_for, DRAIN.hold_for);
    assert.equal(dg.hold_until, DRAIN.hold_until);
  });

  await t.test("a supervisor's release clears the cause", () => {
    goalSet(dir, 'supervisor', g, { hold: { mode: 'run' }, hold_for: null, hold_until: null });
    const v = show(dir, g);
    assert.equal(v.hold?.mode, 'run');
    noCause(v);
  });

  await t.test('a line with a cause and no hold changes nothing, and is listed as ignored', () => {
    const id = goalSet(dir, 'supervisor', g, { hold_for: [TICKET], hold_until: '2026-11-30' });
    const v = show(dir, g);
    assert.equal(v.hold?.mode, 'run');
    noCause(v);
    const r = logCheck(dir);
    assert.equal(r.status, 0, r.out + r.err);
    assert.ok(r.out.split('\n').some((l) => l.startsWith('ignored:') && l.includes(id) && l.includes('hold_for and hold_until go with a hold')), r.out);
  });

  await t.test("the owner's hold line with a cause and other fields keeps the cause, and its update records it", () => {
    goalSet(dir, 'owner', g, { hold: { mode: 'drain', reason: 'mine' }, hold_for: ['external:the vendor key'], hold_until: '2026-12-01', priority: 2 });
    const v = show(dir, g);
    assert.equal(v.hold?.mode, 'drain');
    assert.deepEqual(v.hold_for, ['external:the vendor key']);
    assert.equal(v.hold_until, '2026-12-01');
    assert.equal(v.priority, 2);
    const u = v.updates[v.updates.length - 1];
    assert.deepEqual([u.hold, u.hold_for, u.hold_until], [{ mode: 'drain', reason: 'mine' }, ['external:the vendor key'], '2026-12-01']);
  });

  await t.test('a plain hold line replaces the cause: the hold then has none', () => {
    goalSet(dir, 'owner', g, { hold: { mode: 'park' } });
    const v = show(dir, g);
    assert.equal(v.hold?.mode, 'park');
    noCause(v);
  });

  await t.test('a refused hold line takes its cause with it', () => {
    goalSet(dir, 'supervisor', g, DRAIN); // the supervisor drains only a running goal; this one is parked
    const v = show(dir, g);
    assert.equal(v.hold?.mode, 'park');
    noCause(v);
  });

  await t.test("the same drain without its cause (an older kit's view) applies too", () => {
    const old = project('a1-older');
    const og = readyGoal(old);
    goalSet(old, 'supervisor', og, { hold: DRAIN.hold });
    const v = show(old, og);
    assert.equal(v.hold?.mode, 'drain');
    noCause(v);
  });
});

// waitCause(), cut out of devteam.mjs and run with nothing in scope: a body that reaches outside
// itself throws. Its results are compared through structuredClone, since a vm context's objects have
// that context's Object.prototype.
const waitCauseSrc = () => {
  const a = SRC.indexOf('\nfunction waitCause(');
  assert.ok(a >= 0, 'waitCause is a top-level function in devteam.mjs');
  const b = SRC.indexOf('\n}\n', a);
  return SRC.slice(a + 1, b + 2);
};
const liftWaitCause = () => { const f = vm.runInContext(`${waitCauseSrc()}\n;waitCause`, vm.createContext({})); return (ref) => structuredClone(f(ref)); };

test('waits A2: waitCause() reads each cause form, the contract carries the new subjects, and the fixtures fit it', async (t) => {
  const waitCause = liftWaitCause();
  const open = (form, id, holder_subject) => ({ form, id, state: 'open', since: null, holder_subject });

  await t.test('each form in the cause table', () => {
    const G = 'g-20261117-212746754-supervisor';
    const cases = [
      ['q-20261117-101010101-supervisor', open('q', 'q-20261117-101010101-supervisor', null)],
      ['kit-288-goal-moves', open('ticket', 'kit-288-goal-moves', 'ticket:kit-288-goal-moves')],
      ['dev-62-browser-headless-spike', open('ticket', 'dev-62-browser-headless-spike', 'ticket:dev-62-browser-headless-spike')],
      ['chore:design-system', open('chore', 'design-system', 'chore:design-system')],
      ['chore:devteam-sync-v1.2.0', open('chore', 'devteam-sync-v1.2.0', 'chore:devteam-sync-v1.2.0')],
      [`goal:${G}`, open('goal', G, `goal:${G}`)],
      ['pr:home#412', open('pr', 'home#412', null)],
      ['pr:devteam-kit#7', open('pr', 'devteam-kit#7', null)],
      ['run:devteam-kit:44103283384', open('run', 'devteam-kit:44103283384', null)],
      ['external:stacksbot inbox jobs', open('external', 'stacksbot inbox jobs', null)],
      [`external:${'a'.repeat(200)}`, open('external', 'a'.repeat(200), null)],
    ];
    for (const [ref, want] of cases) assert.deepEqual(waitCause(ref), want, ref);
  });

  await t.test('anything else is refused, the review date among them', () => {
    const refused = [
      'until:2026-11-24', 'g-20261117-212746754-supervisor', 'o-20261117-101010101-kit-01-x', 'foo:bar',
      'pr:home#0', 'pr:home#012', 'pr:home#x', 'pr:Home#1', 'pr:#1', 'pr:home', 'run:home:abc', 'run:home:', 'run:Bad_Link:1', 'run:home',
      'external:', 'external:   ', 'external: x', 'external:x ', 'external:a\nb', `external:${'a'.repeat(201)}`,
      'chore:', 'chore:Bad_Slug', 'chore:x.lock', 'goal:', 'goal:kit-1-x', 'goal:q-20261117-101010101-supervisor',
      '', ' kit-288-goal-moves', 'kit-288-goal-moves ', 'Kit-288-goal-moves', null, undefined, 42, ['kit-288-goal-moves'],
    ];
    for (const ref of refused) assert.equal(waitCause(ref), null, JSON.stringify(ref));
  });

  await t.test('the patterns it copies are the ones it copies them from', () => {
    const body = waitCauseSrc();
    const lit = (name) => { const m = body.match(new RegExp(`const ${name} = /(.+)/;`)); assert.ok(m, `waitCause declares ${name}`); return m[1]; };
    assert.equal(lit('ID'), SCHEMA['x-id'].pattern);
    assert.equal(lit('TICKET'), SCHEMA['x-id'].keyed.ticket);
    assert.equal(lit('LINK'), SRC.match(/\nconst LINK_ID = \/(.+)\/;/)[1]);
    assert.equal(lit('SLUG'), SRC.match(/\nfunction choreSlug\(slugName\) \{\n {2}if \(!\/(.+?)\/\.test/)[1]);
  });

  await t.test('moves --json still carries next_move 1, and no row for the new subjects yet', () => {
    const dir = project('a2-moves');
    logLine(dir, 'supervisor', ticketNew({ held: 'waits on an answer', held_for: [Q], held_until: '2026-11-30' }));
    logLine(dir, 'kit-01-probe', { type: 'observation', kind: 'follow-up', subject: TICKET, source: 'worker', detail: 'the empty state was left for later' });
    const r = logCheck(dir);
    assert.equal(r.status, 0, r.out + r.err);
    assert.equal(ok(dir, ['moves', '--json']).trim(), '{"next_move":1,"moves":[]}');
  });

  await t.test("the fixtures hold one move of each new subject, each fitting the comment's shape", () => {
    const L = valueLines(contractComment());
    const one = (name) => { const v = L.get(name); assert.equal(v?.length, 1, `one "// values ${name}:" line`); return v[0]; };
    const fields = one('fields'), subjects = one('subject'), holders = one('holder'), refKinds = one('ref.kind');
    const quiet = one('quiet'), via = one('via'), flags = one('flag'), rungs = one('rung'), states = one('wait.state');
    const kindOf = (s) => subjects.find((k) => typeof s === 'string' && s.startsWith(k) && s.length > k.length) ?? null;
    const { next_move, moves } = JSON.parse(fs.readFileSync(path.join(FIX, 'moves.json'), 'utf8'));
    assert.equal(next_move, 1);
    for (const m of moves) {
      const at = `${m.subject} ${m.move}`;
      for (const f of fields.filter((x) => !['chore', 'wait'].includes(x))) assert.ok(f in m, `${at}: has ${f}`);
      for (const f of Object.keys(m)) assert.ok(fields.includes(f), `${at}: ${f} is a field of the contract`);
      assert.ok(kindOf(m.subject), `${at}: a known subject`);
      assert.ok(holders.includes(m.holder), `${at}: holder`);
      if (m.ref !== null) { assert.ok(refKinds.includes(m.ref.kind), `${at}: ref kind ${m.ref.kind}`); assert.equal(typeof m.ref.id, 'string'); }
      assert.ok(quiet.includes(String(m.quiet)), `${at}: quiet`);
      assert.ok(m.via === null || via.includes(kindOf(m.via)), `${at}: via`);
      assert.ok(flags.includes(String(m.flag)), `${at}: flag`);
      assert.ok(rungs.includes(String(m.rung)), `${at}: rung`);
      assert.ok(!Number.isNaN(Date.parse(m.since)), `${at}: since`);
      if ('wait' in m) {
        assert.equal(kindOf(m.subject), 'ticket:', `${at}: only a ticket move waits`);
        assert.deepEqual(Object.keys(m.wait).sort(), ['causes', 'until']);
        assert.ok(m.wait.until === null || /^\d{4}-\d{2}-\d{2}$/.test(m.wait.until), `${at}: until`);
        assert.ok(m.wait.causes.length > 0);
        for (const c of m.wait.causes) {
          assert.deepEqual(Object.keys(c).sort(), ['ref', 'state', 'words']);
          assert.ok(states.includes(c.state), `${at}: cause state ${c.state}`);
          assert.ok(c.words.trim() && c.ref.trim());
        }
      }
    }
    const kinds = new Set(moves.map((m) => kindOf(m.subject)));
    for (const k of ['follow-up:', 'thread:', 'answer:', 'duty:', 'record:']) assert.ok(kinds.has(k), `a ${k} move`);
    const refs = new Set(moves.filter((m) => m.ref).map((m) => m.ref.kind));
    for (const k of ['o', 't', 'a']) assert.ok(refs.has(k), `a ref of kind ${k}`);
    assert.ok(moves.some((m) => kindOf(m.subject) === 'ticket:' && m.wait?.causes.some((c) => c.state === 'open') && m.wait.until), 'a ticket move with its wait');
  });
});

// The `//` lines directly above `function nextMoves(` in the next-moves region, and its value lines.
function contractComment() {
  const a = SRC.indexOf('/* next-moves start */'), b = SRC.indexOf('/* next-moves end */');
  const lines = SRC.slice(a, b).split('\n');
  const i = lines.findIndex((l) => l.startsWith('function nextMoves('));
  let j = i;
  while (j > 0 && lines[j - 1].startsWith('//')) j--;
  return lines.slice(j, i).join('\n');
}
function valueLines(comment) {
  const m = new Map();
  for (const l of comment.split('\n')) {
    const x = l.match(/^\/\/ values ([\w.]+): (.*)$/);
    if (x) m.set(x[1], [...(m.get(x[1]) ?? []), x[2].split(' | ').map((v) => v.trim())]);
  }
  return m;
}

test("waits: the comment documents this goal's subjects, ref kinds and a ticket move's wait", () => {
  const c = contractComment();
  for (const s of ['follow-up:<o-id>', 'thread:<t-id>', 'answer:<q-id>', 'duty:<name>', 'record:<id>']) assert.ok(c.includes(s), `the comment names the subject ${s}`);
  for (const [k, what] of [['o', 'follow-up'], ['t', 'thread'], ['a', 'act']]) assert.ok(c.split('\n').some((l) => new RegExp(`\\b${k}\\b`).test(l) && l.includes(what)), `the comment says ref kind ${k} is a ${what}`);
  assert.match(c, /^\/\/ {3}wait +\S.*/m, 'wait has its own definition line');
  assert.ok(c.includes('causes') && c.includes('until') && c.includes('{ "ref", "words", "state" }'), "wait's shape is given");
  assert.match(c, /always present/);
  assert.match(c, /but chore and wait/);
  assert.ok(c.includes('test/fixtures/waits/'), "the comment names this goal's fixtures");
});

test('waits: each check name is one real test', () => {
  const self = fs.readFileSync(new URL(import.meta.url), 'utf8');
  const tag = ['waits', ' A'].join('');
  const found = [...self.matchAll(new RegExp(`${tag}(\\d+):`, 'g'))];
  assert.deepEqual(found.map((m) => Number(m[1])).sort(), [1, 2], 'the checks this ticket adds, once each');
  for (const m of found) {
    const before = self.slice(Math.max(0, m.index - 6), m.index);
    assert.equal(before, "test('", `${m[0]} is a test's own name`);
    const line = self.slice(m.index, self.indexOf('\n', m.index));
    assert.ok(!/\b(skip|todo)\b/.test(line), `${m[0]} is neither skipped nor todo`);
  }
  const fixtures = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? fixtures(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of [...fixtures(FIX), DT]) assert.ok(!new RegExp(`${tag}\\d+:`).test(fs.readFileSync(f, 'utf8')), `no check name in ${path.relative(here, f)}`);
});
