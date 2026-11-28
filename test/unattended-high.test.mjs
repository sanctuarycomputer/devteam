// Unattended high findings: a high finding open (not acked) for over two ticks is named on the hub's
// Overview (hello's pulse) and in box-status's attention lines, so one a supervisor reads past is
// seen by the owner and the operator; an ack or the finding going away takes it off. And a ticket
// held with its reason recorded, once stalled, is a medium finding, not a high one.
// Ports: none
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { fleetFixture, json } from './lib/kit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(here, '..', 'docs', 'devteam', 'scripts', 'devteam.mjs'), 'utf8');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const fixtures = [];
after(() => { for (const F of fixtures) F.done(); });

// a function's own text from devteam.mjs, run in a context holding only what it is given
function load(name, ctx = {}) {
  const i = SRC.indexOf(`\nfunction ${name}(`);
  assert.ok(i >= 0, `devteam.mjs defines ${name}`);
  const j = SRC.indexOf('\n}\n', i);
  return vm.runInContext(`${SRC.slice(i, j + 2)}\n;${name}`, vm.createContext(ctx));
}
const plain = (x) => JSON.parse(JSON.stringify(x));

test('unattendedHigh: a high finding is unattended after two ticks open; medium never; gone or acked, it leaves', () => {
  const files = new Map();
  const ctx = {
    path, process: { env: {} },
    runPath: () => '/run/cache',
    isObj: (x) => !!x && typeof x === 'object' && !Array.isArray(x),
    readJson: (p) => { if (!files.has(p)) throw new Error('none'); return JSON.parse(files.get(p)); },
    writeJson: (p, o) => files.set(p, JSON.stringify(o)),
    loadSettings: () => ({ tick_minutes: 15 }),
  };
  ctx.HIGH_SEEN = () => '/run/cache/high-seen.json';
  ctx.UNATTENDED = () => '/run/cache/unattended.json';
  const run = load('unattendedHigh', ctx);
  const t0 = Date.parse('2026-11-28T00:00:00Z');
  const hi = { severity: 'high', kind: 'stale-planner', subject: 'plan-x', detail: 'no sign of life for 40 min' };
  const med = { severity: 'medium', kind: 'idle-capacity', subject: '3 ready', detail: '' };
  assert.deepEqual(plain(run([hi, med], t0)), [], 'first seen: not unattended yet');
  assert.deepEqual(plain(run([hi, med], t0 + 29 * 60000)), [], 'under two ticks (30 min)');
  const u = plain(run([hi, med], t0 + 31 * 60000));
  assert.deepEqual(u.map((x) => [x.kind, x.subject, x.since]), [['stale-planner', 'plan-x', '2026-11-28T00:00:00.000Z']], 'past two ticks, from when it was first seen; the medium one never');
  assert.equal(JSON.parse(files.get('/run/cache/unattended.json')).items.length, 1, 'kept for hello');
  // acted on (the finding went away) or acked (metrics leaves it out of findings): off the list, and forgotten
  assert.deepEqual(plain(run([med], t0 + 32 * 60000)), []);
  assert.deepEqual(JSON.parse(files.get('/run/cache/high-seen.json')), {}, 'its first sighting is forgotten');
  assert.deepEqual(plain(run([hi], t0 + 33 * 60000)), [], 'back again: counted afresh');
  // the operator's reads count the same way and write nothing
  files.clear();
  ctx.process.env.DEVTEAM_ROLE = 'operator';
  assert.deepEqual(plain(run([hi], t0)), []);
  assert.equal(files.size, 0, "the operator's metrics write nothing");
});

test('readUnattended and the pulse line: the oldest named, and nothing from a list over two hours old', () => {
  const now = Date.now();
  let body = null;
  const ctx = { isObj: (x) => !!x && typeof x === 'object' && !Array.isArray(x), readJson: () => { if (!body) throw new Error('none'); return body; }, UNATTENDED: () => 'u.json' };
  const read = load('readUnattended', ctx);
  const items = [{ kind: 'move-owed', subject: 'goal:g-2 re-plan:', since: new Date(now - 50 * 60000).toISOString() }, { kind: 'stale-planner', subject: 'plan-x', since: new Date(now - 400 * 60000).toISOString() }];
  body = { at: new Date(now - 60000).toISOString(), items };
  assert.equal(read(now).length, 2);
  body = { at: new Date(now - 3 * 3600000).toISOString(), items };
  assert.deepEqual(plain(read(now)), [], 'a list no metrics run has refreshed in two hours says nothing');
  const line = load('unattendedLine', {});
  assert.equal(line([]), null);
  assert.equal(line(items), "2 high warnings the supervisor hasn't acted on or set aside: stale-planner plan-x, for 7 h, and 1 more");
});

test('moveFindings: a held ticket, stalled, is medium; any other stalled move stays high', () => {
  const run = load('moveFindings');
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const m = (o) => ({ subject: 'ticket:t-1', move: 'build', words: 'Building', holder: 'worker', ref: null, title: 'T', since, command: null, covered_by: [], quiet: null, via: null, flag: 'stalled', rung: 2, ...o });
  const out = plain(run([m({ move: 'held', words: 'Held: waits on the owner. Release it, or ask', holder: 'supervisor' }), m({ subject: 'ticket:t-2' })], []));
  assert.deepEqual(out.map((x) => [x.subject, x.severity]), [['ticket:t-1 held:', 'medium'], ['ticket:t-2 build:', 'high']]);
});

test('end to end: a high finding left past two ticks reaches hello and box-status, and an ack takes it off', () => {
  // a 0.1-minute tick: two ticks are 12 s. A stalled worker is the high finding (move-stalled).
  const F = fleetFixture('unattended-e2e');
  fixtures.push(F);
  const { old, ok, g } = F;
  const sf = path.join(old, 'docs/devteam/project/settings.md');
  fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"forge": "git"', '"forge": "git", "tick_minutes": 0.1, "next_move_stall_hours": 0.0005'));
  g(['add', '-A'], old); g(['commit', '-qm', 'settings'], old); g(['push', '-q', 'origin', 'main'], old);
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const G = ok(old, ['goal', 'add', '--title', 'Building', '--outcome', 'it holds', '--measure', 'the owner says it holds', '--target', '1', '--unit', 'attested', '--direction', 'up', '--source', 'owner', '--question', 'Does it hold?', '--non-goals', 'none', '--preconditions', 'one', '--priority', '1'], SUP).split('\n')[0].trim();
  ok(old, ['goal', 'set', G, '--milestones', JSON.stringify([{ title: 'all', target: 1, preconditions: [1], tickets: 1 }])], SUP);
  ok(old, ['goal', 'decide', G, 'approve', '--force']);
  ok(old, ['feature', 'add', 'building', '--json', JSON.stringify({ title: 'Building', goals: [G], preconditions: [`${G}#1`], stories: [{ id: 'BUILDING-S1', text: 'it works', release: 'v1.0.0' }] })], SUP);
  ok(old, ['ticket', 'add', 'ch-21-build', '--json', JSON.stringify({ title: 'Ticket ch-21-build', feature: 'building', component: 'ch', kind: 'build', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['ch-21-build/**'], done_when: ['its check passes in CI'] })], SUP);
  ok(old, ['phase', 'build'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'ch-21-build' });
  sleep(3000);
  const metrics = () => json(ok(old, ['metrics', '--json'], SUP));
  const hello = () => json(ok(old, ['hello', '--json']));
  const stalled = (m) => m.findings.find((x) => x.kind === 'move-stalled' && x.severity === 'high');
  const f = stalled(metrics());
  assert.ok(f, 'a high move-stalled finding');
  assert.deepEqual(hello().unattended, [], 'first seen: not unattended');
  sleep(13000);
  const m = metrics();
  assert.ok(m.unattended.some((x) => x.kind === 'move-stalled' && x.subject === f.subject), 'past two ticks: unattended');
  const h = hello();
  assert.ok(h.unattended.some((x) => x.subject === f.subject), 'hello carries it');
  assert.ok(h.pulse.attention.some((l) => /high warnings? the supervisor hasn't acted on or set aside: /.test(l)), `the pulse says it (${JSON.stringify(h.pulse.attention)})`);
  ok(old, ['ack', 'move-stalled', f.subject, '--reason', 'a long build, looked at'], SUP);
  assert.ok(!metrics().unattended.some((x) => x.subject === f.subject), 'an ack takes it off');
  assert.ok(!hello().unattended.some((x) => x.subject === f.subject), 'and off hello');
});
