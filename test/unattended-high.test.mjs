// Unattended high findings: a high finding open (not acked) for over two ticks is named on the hub's
// Overview (hello's pulse, in the finding's plain words) and in box-status's attention lines (kind and
// subject), so one a supervisor reads past is seen by the owner and the operator; an ack takes it off
// at once, and the finding going away takes it off. And a ticket held with its reason recorded, once
// stalled, is a medium finding, not a high one, while its --until date is ahead (with no date, or
// past it, high).
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
  // a windowed run (metrics --since, retro) sees fewer findings: it counts, but keeps no record
  run([hi], t0 + 40 * 60000);
  const kept = files.get('/run/cache/high-seen.json');
  assert.deepEqual(plain(run([], t0 + 41 * 60000, { record: false })), []);
  assert.equal(files.get('/run/cache/high-seen.json'), kept, 'a windowed run forgets no first sighting');
  assert.equal(JSON.parse(files.get('/run/cache/unattended.json')).at, new Date(t0 + 40 * 60000).toISOString(), 'nor rewrites the unattended list');
  assert.match(SRC, /\n  m\.unattended = unattendedHigh\(m\.findings, now, \{ record: !since \}\);/, 'collectMetrics keeps a record only for a run with no window');
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
  const items = [{ kind: 'move-owed', subject: 'goal:g-2 re-plan:', detail: 'Re-plan: owed', since: new Date(now - 50 * 60000).toISOString() }, { kind: 'stale-planner', subject: 'plan-x', detail: 'the planner for x has shown no sign of life for 40 min', since: new Date(now - 400 * 60000).toISOString() }];
  body = { at: new Date(now - 60000).toISOString(), items };
  assert.equal(read(now).length, 2);
  body = { at: new Date(now - 3 * 3600000).toISOString(), items };
  assert.deepEqual(plain(read(now)), [], 'a list no metrics run has refreshed in two hours says nothing');
  const line = load('unattendedLine', {});
  assert.equal(line([]), null);
  assert.equal(line(items), "2 warnings the supervisor hasn't acted on or set aside, the oldest for 7 h: the planner for x has shown no sign of life for 40 min");
  assert.equal(line(items.slice(0, 1)), "A warning the supervisor hasn't acted on or set aside, for 50 min: Re-plan: owed");
  assert.doesNotMatch(line(items), /stale-planner|plan-x|move-owed/, 'no kind or subject on the owner\'s line');
});

test('moveFindings: a held ticket, stalled, is medium only while its --until date is ahead; with none or past it, and any other stalled move, high', () => {
  const run = load('moveFindings');
  const now = Date.parse('2026-11-28T12:00:00Z');
  const since = new Date(now - 3 * 86400000).toISOString();
  const m = (o) => ({ subject: 'ticket:t-1', move: 'build', words: 'Building', holder: 'worker', ref: null, title: 'T', since, command: null, covered_by: [], quiet: null, via: null, flag: 'stalled', rung: 2, ...o });
  const held = (subject, until) => m({ subject, move: 'held', words: 'Held: waits on the vendor. Release it, or ask', holder: 'supervisor', ...(until === undefined ? {} : { wait: { causes: [{ ref: 'external:the-vendor', words: 'the-vendor', state: 'open' }], until } }) });
  const out = plain(run([held('ticket:t-1'), m({ subject: 'ticket:t-2' }), held('ticket:t-3', '2026-11-30'), held('ticket:t-4', '2026-11-28'), held('ticket:t-5', '2026-11-27'), held('ticket:t-6', null)], [], now));
  assert.deepEqual(out.map((x) => [x.subject, x.severity]), [
    ['ticket:t-1 held:', 'high'], ['ticket:t-2 build:', 'high'],
    ['ticket:t-3 held:', 'medium'], ['ticket:t-4 held:', 'medium'],
    ['ticket:t-5 held:', 'high'], ['ticket:t-6 held:', 'high'],
  ], 'in its window (to the end of its --until day) medium; the day after, or with no date (its causes may be done), high');
});

test('next moves: a held ticket\'s move carries its wait (causes, until); a copy of it never does', () => {
  // T2b's own wait, as next-move@1 defines it (moveFindings reads wait.until)
  const i = SRC.indexOf("if (isHeld(t)) {\n        const m = at({ move: 'held'");
  assert.ok(i >= 0, 'T2b builds its move and adds the wait');
  assert.match(SRC.slice(i, i + 900), /m\.wait = \{ causes: causes\.map\(\(ref\) => \(\{ ref, words: holdCauseWords\(ref\), state: [^}]+\}\)\), until: [^;]+t\.held_until[^;]+;/);
  const j = SRC.indexOf('\nconst copiedMove = ');
  const copied = vm.runInContext(`${SRC.slice(j, SRC.indexOf('\n', j + 1))}\n;copiedMove`, vm.createContext({}));
  const src = { subject: 'ticket:t-1', move: 'held', wait: { causes: [], until: null }, flag: 'stalled' };
  const c = copied('goal:g-1', 'G', src);
  assert.ok(!('wait' in c), 'a goal copying its lead ticket\'s held move carries no wait');
  assert.equal(c.via, 'ticket:t-1');
});

test('box-status: an unattended high finding is an attention line, by kind and subject, five at most', () => {
  const lines = load('unattendedStatusLines');
  const u = (i) => ({ kind: 'move-stalled', subject: `ticket:t-${i} build:`, detail: 'T: Building', since: '2026-11-28T00:00:00.000Z' });
  assert.deepEqual(plain(lines('proj', {})), []);
  assert.deepEqual(plain(lines('proj', { unattended: [u(1)] })), ['attention: proj unattended high finding: move-stalled ticket:t-1 build: since 2026-11-28T00:00:00.000Z']);
  assert.equal(lines('proj', { unattended: [1, 2, 3, 4, 5, 6, 7].map(u) }).length, 5);
});

test('end to end: a high finding left past two ticks reaches hello (what box-status reads), and an ack takes it off at once', () => {
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
  // the line names the oldest in its detail (the fixture has other high findings: the template strategy)
  const oldest = [...h.unattended].sort((a, b) => Date.parse(a.since) - Date.parse(b.since))[0];
  const said = (x) => x.pulse.attention.find((l) => /the supervisor hasn't acted on or set aside/.test(l));
  assert.match(said(h) ?? '', new RegExp(`^${h.unattended.length === 1 ? 'A warning' : `${h.unattended.length} warnings`} the supervisor hasn't acted on or set aside, (the oldest )?for \\d+ min: `), `the pulse says it (${JSON.stringify(h.pulse.attention)})`);
  assert.ok(said(h).endsWith(oldest.detail), 'in the oldest one\'s plain words');
  assert.doesNotMatch(said(h), new RegExp(`${oldest.kind}|move-stalled`), 'no finding kind on the owner\'s line');
  ok(old, ['ack', 'move-stalled', f.subject, '--reason', 'a long build, looked at'], SUP);
  // no metrics run in between: the ack itself takes it off hello, so off the hub and box-status
  const h2 = hello();
  assert.ok(!h2.unattended.some((x) => x.subject === f.subject), 'off hello right after the ack');
  assert.equal(h2.unattended.length, h.unattended.length - 1, 'only the acked one goes');
  assert.ok(!(said(h2) ?? '').includes(f.detail), 'and off the pulse');
  assert.ok(!metrics().unattended.some((x) => x.subject === f.subject), 'and metrics agrees');
});
