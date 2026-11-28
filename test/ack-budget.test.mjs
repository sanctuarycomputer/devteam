// The ack budget: a finding set aside ack_budget times (default 3) in its current run is spent. The
// supervisor's next ack is refused, only the owner's passes, and metrics raises it high with
// ack_spent. A move finding's run starts at its move's since; any other's at the first sign of it
// after a gap (ackCount, run on its own under node:vm, as test/next-moves-findings.test.mjs runs
// moveFindings). Fixture projects drive the real CLI.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { fleetFixture, json } from './lib/kit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(here, '..', 'docs', 'devteam', 'scripts', 'devteam.mjs'), 'utf8');
const SUP = { DEVTEAM_ROLE: 'supervisor' };
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const H = 3600000;
const DAY = 24 * H;
const fixtures = [];
after(() => { for (const F of fixtures) F.done(); });

// ackCount(x, moves, ackWindow, now), alone, over the observations given
function loadAckCount(observations) {
  const i = SRC.indexOf('\nfunction ackCount(');
  assert.ok(i >= 0, 'devteam.mjs defines ackCount');
  const j = SRC.indexOf('\n}\n', i);
  const ctx = vm.createContext({ DAY: 864e5, memo: (k, fn) => fn(), logObjects: (type) => (type === 'observation' ? observations : []) });
  return vm.runInContext(`${SRC.slice(i, j + 2)}\n;ackCount`, ctx);
}
const now = Date.parse('2026-11-20T12:00:00Z');
const at = (ago) => new Date(now - ago).toISOString();
const ack = (subject, ago) => ({ kind: 'finding-ack', subject, source_ref: `metrics:${subject.replace(' ', ':')}`, created_at: at(ago), created_by: 'supervisor' });
const seen = (kind, subject, ago) => ({ kind, subject, detector: 'metrics', source_key: `metrics:${kind}:${subject}`, created_at: at(ago), created_by: 'supervisor' });

test('ack budget: ackCount counts a finding\'s acks in its current run only', async (t) => {
  const x = { kind: 'stale-worker', subject: 'ch-1' };
  await t.test('three daily acks in a row count three', () => {
    const count = loadAckCount([ack('stale-worker ch-1', 50 * H), ack('stale-worker ch-1', 25 * H), ack('stale-worker ch-1', 1 * H)]);
    assert.equal(count(x, [], DAY, now), 3);
  });
  await t.test('a different subject has its own budget', () => {
    const count = loadAckCount([ack('stale-worker ch-1', 50 * H), ack('stale-worker ch-1', 25 * H), ack('stale-worker ch-1', 1 * H), ack('stale-worker ch-2', 2 * H)]);
    assert.equal(count({ kind: 'stale-worker', subject: 'ch-2' }, [], DAY, now), 1);
    assert.equal(count({ kind: 'stale-worker', subject: 'ch-1' }, [], DAY, now), 3);
  });
  await t.test('after the finding went away and came back, the count starts fresh', () => {
    // three acks a week ago, then nothing for days: it came back now
    const old = [ack('stale-worker ch-1', 8 * DAY), ack('stale-worker ch-1', 7 * DAY), ack('stale-worker ch-1', 6 * DAY)];
    assert.equal(loadAckCount(old)(x, [], DAY, now), 0);
    assert.equal(loadAckCount([...old, ack('stale-worker ch-1', 1 * H)])(x, [], DAY, now), 1);
  });
  await t.test('its metrics observations bridge a late re-ack: it never went away', () => {
    // acked, lapsed, seen every day for three days, then acked again: one run
    const obs = [ack('stale-worker ch-1', 6 * DAY), ack('stale-worker ch-1', 5 * DAY), ...[4, 3, 2, 1].map((d) => seen('stale-worker', 'ch-1', d * DAY)), ack('stale-worker ch-1', 1 * H)];
    assert.equal(loadAckCount(obs)(x, [], DAY, now), 3);
  });
  await t.test('a move finding counts from its move\'s since', () => {
    const s = 'ticket:ch-1 build:';
    const moves = [{ subject: 'ticket:ch-1', move: 'build', ref: null, since: at(2 * H) }];
    const count = loadAckCount([ack(`move-stalled ${s}`, 3 * H), ack(`move-stalled ${s}`, 1 * H)]);
    assert.equal(count({ kind: 'move-stalled', subject: s }, moves, DAY, now), 1);
  });
});

test('ack budget: the supervisor\'s fourth ack is refused, the owner\'s passes, a new run starts fresh', async (t) => {
  // stalled after nine seconds; an ack lapses after under four
  const F = fleetFixture('ack-budget');
  fixtures.push(F);
  const { old, ok, g, run } = F;
  const fails = (args, role) => { const r = run(old, args, role); assert.notEqual(r.status, 0, `${args.join(' ')} should fail: ${r.out}`); return `${r.err}\n${r.out}`; };
  const sf = path.join(old, 'docs/devteam/project/settings.md');
  fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"forge": "git"', '"forge": "git", "next_move_stall_hours": 0.0025, "finding_ack_hours": 0.001'));
  g(['add', '-A'], old); g(['commit', '-qm', 'settings'], old); g(['push', '-q', 'origin', 'main'], old);
  const sup = (args) => ok(old, args, SUP);
  const G = sup(['goal', 'add', '--title', 'Building', '--outcome', 'Building holds', '--measure', 'the owner says it holds', '--target', '1', '--unit', 'attested', '--direction', 'up', '--source', 'owner', '--question', 'Does it hold?', '--non-goals', 'none', '--preconditions', 'first part', 'second part', '--priority', '1']).split('\n')[0].trim();
  sup(['goal', 'set', G, '--milestones', JSON.stringify([{ title: 'all of it', target: 1, preconditions: [1, 2], tickets: 2 }])]);
  ok(old, ['goal', 'decide', G, 'approve', '--force']);
  sup(['feature', 'add', 'building', '--json', JSON.stringify({ title: 'Feature building', goals: [G], preconditions: [`${G}#1`, `${G}#2`], stories: [{ id: 'B-S1', text: 'it works', release: 'v1.0.0' }] })]);
  const phase = (id, to) => ok(old, ['phase', to], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: id });
  for (const id of ['ch-01-one', 'ch-02-two']) {
    sup(['ticket', 'add', id, '--json', JSON.stringify({ title: `Ticket ${id}`, feature: 'building', component: 'ch', kind: 'build', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: [`${id}/**`], done_when: ['its check passes in CI'] })]);
    phase(id, 'build');
  }
  sleep(9500);
  const one = 'ticket:ch-01-one build:';
  const two = 'ticket:ch-02-two build:';
  const open = (s) => json(ok(old, ['metrics', '--json'])).findings.find((x) => x.kind === 'move-stalled' && x.subject === s);
  await t.test('three supervisor acks pass; the fourth is refused, and metrics marks it spent', () => {
    for (let i = 0; i < 3; i++) {
      assert.ok(open(one), `ack ${i + 1}: the finding is open`);
      assert.ok(!open(one).ack_spent, `ack ${i + 1}: not spent yet`);
      sup(['ack', 'move-stalled', one, '--reason', `looked at, ${i + 1}`]);
      assert.ok(!open(one), `ack ${i + 1} sets it aside`);
      sleep(4000);
    }
    const f = open(one);
    assert.ok(f, 'back once the third ack lapsed');
    assert.equal(f.ack_spent, true);
    assert.equal(f.severity, 'high');
    const err = fails(['ack', 'move-stalled', one, '--reason', 'still looking'], SUP);
    assert.match(err, /set aside 3 times already \(ack_budget\)/);
    assert.match(err, /ack --owner/);
    assert.match(err, /ticket hold/);
    assert.ok(open(one), 'still open');
  });
  await t.test('a different subject has its own budget', () => {
    assert.ok(open(two) && !open(two).ack_spent, 'the other ticket\'s finding is not spent');
    sup(['ack', 'move-stalled', two, '--reason', 'its own']);
    assert.ok(!open(two), 'set aside');
  });
  await t.test('the owner\'s ack passes', () => {
    ok(old, ['ack', 'move-stalled', one, '--reason', 'the owner says it can wait', '--owner']);
    const m = json(ok(old, ['metrics', '--json']));
    const a = m.acknowledged.find((x) => x.kind === 'move-stalled' && x.subject === one);
    assert.ok(a, 'set aside');
    assert.equal(a.ack.by, 'owner');
  });
  await t.test('after the move goes away and comes back, the count starts fresh', () => {
    phase('ch-01-one', 'verify');
    phase('ch-01-one', 'build');
    sleep(9500);
    const f = open(one);
    assert.ok(f, 'stalled again, in a new build run');
    assert.ok(!f.ack_spent, 'not spent');
    sup(['ack', 'move-stalled', one, '--reason', 'a new run']);
    assert.ok(!open(one), 'set aside');
  });
});
