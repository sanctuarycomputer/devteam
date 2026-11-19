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
});
