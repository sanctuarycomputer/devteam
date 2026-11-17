// The Awareness Score's data (kit-242): /api/data's awareness, from one hand-written fixture log with
// known answers (awarenessFixture, below; the plan's table is its oracle), and the helpers it shares
// with the debt lists, the weekly learning record and the Efficiency Score's suggestions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fleetFixture, json, line, kit } from './lib/kit.mjs';

const MIN = 60000;
const HOUR = 3600000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const stamp = (d) => `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
const mondayOf = (ms) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY; };
const isoWeek = (ms) => {
  const m = mondayOf(ms);
  const y = new Date(m + 3 * DAY).getUTCFullYear();
  return `${y}-W${String(1 + Math.round((m - mondayOf(Date.UTC(y, 0, 4))) / WEEK)).padStart(2, '0')}`;
};
// The fixture's clock, as test/autonomy-data.test.mjs keeps it: M is this Monday 00:00 UTC, week k
// of the 12 starts at W(k), h(k, d, hh) is d days and hh hours into it, and E(k) is week k's last
// millisecond (k < 11). Under 10 minutes into this week, the tests that read week 11 skip.
const M = mondayOf(Date.now());
const span = () => Date.now() - M;
const W = (k) => M - (11 - k) * WEEK;
const h = (k, d, hh) => W(k) + d * DAY + hh * HOUR;
const E = (k) => W(k + 1) - 1;
const TOO_SOON = 'within 10 minutes of Monday 00:00 UTC this week has no room for its lines';
const tooSoon = () => span() < 10 * MIN;

// A line as the kit would have written it at ms, in its writer's file; each id a millisecond apart,
// unless exact (an edge-time line, where the counter's milliseconds would move it past an edge).
function handFor(F) {
  const logDir = path.join(F.old, 'docs/devteam/run/log');
  let n = 0;
  return (by, o, ms, { exact = false } = {}) => {
    const d = new Date(exact ? ms : ms + (n++ % 1000));
    // problem: without it a problem's id reads undefined-…, and readLog drops the line
    const id = o.id ?? `${{ observation: 'o', decision: 'd', act: 'a', knowledge: 'k', question: 'q', goal: 'g', thread: 't', turn: 'u', problem: 'p' }[o.type]}-${stamp(d)}-${by}`;
    const file = ['owner', 'supervisor'].includes(by) ? `${by}-${d.toISOString().slice(0, 7)}.jsonl` : `${by}.jsonl`;
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, file), line({ op: 'new', ...(by === 'owner' ? { channel: 'cli' } : {}), ...o, id, at: d.toISOString(), by }));
    return id;
  };
}

// The efficiency weeks' writers, copied from test/efficiency-data.test.mjs's effFixture: their own
// line writer (prefixes for phase and spend lines, which handFor's map lacks), tickets, spend and
// merge commits dated into the week a case needs.
function effWriters(F) {
  const { old, ok, g } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const thisMonday = M;
  const spanNow = Date.now() - thisMonday;
  const weekStart = (k) => thisMonday - (11 - k) * WEEK;
  const mergeAt = (k, i) => (k < 11 ? weekStart(k) + 3 * DAY + i * HOUR : thisMonday + Math.floor((spanNow * (0.5 + 0.01 * i)) / 1000) * 1000);
  const logDir = path.join(old, 'docs/devteam/run/log');
  let n = 0;
  const PREFIX = { phase: 'h', spend: 's', observation: 'o', act: 'a' };
  const effHand = (by, o, atMs) => {
    const id = o.id ?? `${PREFIX[o.type]}-${stamp(new Date(atMs + n++))}-${by}`;
    const file = ['owner', 'supervisor'].includes(by) ? `${by}-${new Date(atMs).toISOString().slice(0, 7)}.jsonl` : `${by}.jsonl`;
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, file), line({ op: 'new', ...o, id, at: new Date(atMs).toISOString(), by }));
    return id;
  };
  const addTicket = (id, size = 'S', risk = 'normal') => ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'eff', component: 'eff', kind: 'build', size, risk, serves: ['EFF-S1'], depends_on: [], touches: ['src/**'], done_when: ['the src test passes in CI'] })], SUP);
  ok(old, ['feature', 'add', 'eff', '--json', JSON.stringify({ title: 'Eff', goals: ['g-20260101-000000000-supervisor'], stories: [{ id: 'EFF-S1', text: 'it works', release: 'v1.0.0' }] })], SUP);
  const phase = (id, to, atMs) => effHand(id, { type: 'phase', from: null, to }, atMs);
  const spend = (id, { role = 'worker', phase: ph = 'build', usd, input = 0, output = 0, cache_read = 0, cache_write = 0, model = 'claude-opus-5-5', atMs }) =>
    effHand('supervisor', { type: 'spend', who: id, role, phase: ph, through: new Date(atMs).toISOString(), usd, input_tokens: input, output_tokens: output, cache_read_tokens: cache_read, cache_write_tokens: cache_write, by_model: { [model]: { usd, output_tokens: output } } }, atMs);
  const merges = [];
  const merge = (id, atMs) => merges.push([id, atMs]);
  const shipped = (id, k, i, { size = 'S', risk = 'normal', hours = 1, spends = [] } = {}) => {
    addTicket(id, size, risk);
    const m = mergeAt(k, i);
    phase(id, 'build', m - hours * HOUR);
    for (const s of spends) spend(id, { ...s, atMs: m - (k < 11 ? 60000 : Math.max(1000, Math.floor(spanNow / 1000))) });
    merge(id, m);
    return m;
  };
  const land = () => {
    for (const [id, at] of merges.sort((a, b) => a[1] - b[1])) {
      const date = new Date(at).toISOString();
      execFileSync('git', ['commit', '-q', '--allow-empty', '-m', `${id}: work`], { cwd: old, env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } });
    }
    merges.length = 0;
    g(['push', '-q', 'origin', 'main'], old);
  };
  return { effHand, addTicket, phase, spend, merge, mergeAt, shipped, land };
}

const S = 'supervisor';
const O = 'owner';
const SIGNALS = ['sig:a', 'sig:b', 'sig:c', 'sig:d', 'sig:e', 'sig:f', 'sig:g', 'sig:h', 'sig:h2', 'sig:i', 'sig:j', 'sig:k', 'sig:m', 'sig:q'];

// The plan's fixture (kit-242 plan › The fixture): signals formed in weeks 7 and 8, incidents fixed
// in weeks 5, 6 and 10, lessons and session starts from week 1, a call on trust and a stored record
// in week 7, and efficiency weeks 0 and 7. X holds every id a test names; sig[key] a signal's items
// (sig[key][0] is item 1) and F[key] the time it forms.
function awarenessFixture(name) {
  const Fx = fleetFixture(name);
  const hand = handFor(Fx);
  const X = {};
  const sig = {};
  const F = {};
  const obs = (key, n) => ({ type: 'observation', kind: 'note', subject: 'app', source_key: key, detail: `${key} sighting ${n}`, valence: -1 });
  const sight = (key, at) => (sig[key] = at.map(([by, ms], i) => hand(by, obs(key, i + 1), ms)));
  const kCand = (evidence, ms) => hand(S, { type: 'knowledge', kind: 'lesson', status: 'candidate', statement: `what ${evidence.join(' ')} teaches`, scope: 'project', evidence }, ms);
  const ruling = (refs, ms) => hand(S, { type: 'decision', class: 'orient-noise', authority: 'constitution', what: 'noise', refs }, ms);
  const problem = (title, refs, ms) => hand(S, { type: 'problem', title, severity: 1, realized: true, status: 'open', refs }, ms);
  const setRefs = (id, refs, ms) => hand(S, { type: 'problem', op: 'set', id, refs }, ms);

  // efficiency: three tickets shipped in week 0 and three in week 7, each S, 1 hour, $1 of build
  const eff = effWriters(Fx);
  for (const k of [0, 7]) for (const i of [0, 1, 2]) eff.shipped(`eff-${20 + k}-${'abc'[i]}`, k, i, { hours: 1, spends: [{ phase: 'build', usd: 1, input: 100, output: 50 }] });
  eff.land();

  // lessons in force: two from week 2, one from week 9
  X.k1 = hand(O, { type: 'knowledge', kind: 'lesson', statement: 'Retry the importer once before paging', scope: 'project', status: 'accepted' }, h(2, 0, 0));
  X.k2 = hand(O, { type: 'knowledge', kind: 'fact', statement: 'The importer runs nightly', scope: 'project', status: 'accepted' }, h(2, 0, 1));
  X.k3 = hand(O, { type: 'knowledge', kind: 'lesson', statement: 'Pin the hub client version', scope: 'project', status: 'accepted' }, h(9, 0, 0));
  // session starts; sC, sA and sB sit at the 28-day window's edges for week 6, so they are exact
  const start = (n, knowledge, ms, opts) => hand(S, { type: 'act', class: 'worker-slots', what: `made worker t${n} in s:t${n}`, refs: [`t${n}`], ...(knowledge ? { knowledge } : {}) }, ms, opts);
  X.s0 = start(0, null, h(1, 1, 0));
  X.sC = start('C', [X.k1], E(6) - 29 * DAY, { exact: true });
  X.sA = start('A', [X.k1], E(6) - 28 * DAY, { exact: true });
  X.sB = start('B', [X.k2], E(6) - 28 * DAY + MIN, { exact: true });
  X.sD = start('D', [X.k1], h(10, 1, 0));
  X.s5 = start(5, null, h(10, 1, 1));

  // incidents: each new, resolved and verified by an outcome that cites it
  const incident = (key, title, at) => hand(S, { type: 'problem', title, severity: 2, realized: true, status: 'open', fingerprints: [`fp-${key}`] }, at);
  const resolve = (p, at, by = S) => hand(by, { type: 'problem', op: 'set', id: p, status: 'resolved' }, at);
  const outcome = (p, at, valence = 1) => hand(S, { type: 'observation', kind: 'outcome', subject: 'app', detail: `the fix for ${p} held`, valence, refs: [p] }, at);
  X.inc5 = incident('inc5', 'the export stall', h(5, 1, 0)); resolve(X.inc5, h(5, 2, 0)); outcome(X.inc5, h(5, 3, 0));
  X.incL = incident('incL', 'the login loop', h(6, 1, 0)); resolve(X.incL, h(6, 2, 0)); outcome(X.incL, h(6, 2, 5));
  X.incLk = hand(S, { type: 'knowledge', kind: 'lesson', status: 'candidate', statement: 'Expire sessions before the loop', scope: 'project', evidence: [X.incL] }, h(6, 3, 0));
  // the owner set incO's status: the owner's call, so it is left out
  X.incO = incident('incO', 'the owner fixed one', h(6, 1, 1)); resolve(X.incO, h(6, 2, 1), O); outcome(X.incO, h(6, 2, 6));
  // incU's outcome proved nothing (valence 0): not verified, left out
  X.incU = incident('incU', 'the unverified one', h(6, 1, 2)); resolve(X.incU, h(6, 2, 2)); outcome(X.incU, h(6, 2, 7), 0);
  X.incF = incident('incF', 'the hub outage', h(10, 1, 0)); resolve(X.incF, h(10, 2, 0)); outcome(X.incF, h(10, 2, 5));

  // week 7: one call on trust, and signal p explained an hour after it formed
  X.trust7 = hand(S, { type: 'decision', class: 'priority-change', what: 'raised the importer', authority: 'rung', rung: 3 }, h(7, 4, 0));
  sight('sig:p', [[S, h(7, 1, 9)], [S, h(7, 1, 10)], [O, h(7, 1, 11)]]);
  X.pk = kCand([sig['sig:p'][0]], h(7, 1, 12));

  // week 8's signals: j forms at F_j (its owner's sighting), j minutes apart so no two tie
  X.oX = hand(S, obs('other:x', 1), h(8, 0, 1));
  for (const [j, key] of SIGNALS.entries()) {
    const f = (F[key] = h(8, 1, 11) + j * MIN);
    sight(key, [[S, f - 2 * HOUR], [S, f - HOUR], [O, f]]);
  }
  const it = (key, n) => sig[key][n - 1];
  const at = (key, hrs) => F[key] + hrs * HOUR;
  X.a = kCand([it('sig:a', 3)], at('sig:a', 3));
  X.b = kCand([it('sig:b', 1)], at('sig:b', 30));
  X.c = ruling(['sig:c', X.oX], at('sig:c', 2));
  X.d = kCand([it('sig:d', 1)], at('sig:d', -1.5));
  X.e1 = kCand([it('sig:e', 1)], at('sig:e', 40));
  X.e2 = problem('the e problem', [], at('sig:e', 0.5)); setRefs(X.e2, [it('sig:e', 2)], at('sig:e', 2));
  X.f = problem('the f problem', [it('sig:f', 1)], at('sig:f', 1)); setRefs(X.f, [it('sig:f', 1), it('sig:f', 2)], at('sig:f', 40));
  // g: a live noise ruling cites item 1 (no key, so only the citation path), until the owner corrects it
  X.g = ruling([it('sig:g', 1)], at('sig:g', 1)); hand(O, { type: 'decision', op: 'set', id: X.g, corrected: { reason: 'not noise' } }, at('sig:g', 5));
  X.h = problem('the h problem', [it('sig:h', 1)], at('sig:h', 1)); setRefs(X.h, [], h(8, 4, 0));
  X.h2 = problem('the h2 problem', [it('sig:h2', 1)], at('sig:h2', 1)); setRefs(X.h2, [], h(9, 1, 0));
  X.i = ruling(['sig:i', X.oX], at('sig:i', -0.5));
  X.j = ruling(['sig:j', X.oX], at('sig:j', 30));
  X.k = ruling(['sig:k'], at('sig:k', 1));
  X.m = ruling(['sig:m', X.oX], at('sig:m', -3));
  X.q = problem('the q problem', [], at('sig:q', 1)); setRefs(X.q, [it('sig:q', 1)], at('sig:q', 30));
  // l forms in week 8's last day, unexplained; n forms there too and is explained
  sight('sig:l', [[S, E(8) - 20 * HOUR], [S, E(8) - 19 * HOUR], [O, E(8) - 18 * HOUR]]);
  sight('sig:n', [[S, E(8) - 10 * HOUR], [S, E(8) - 9 * HOUR], [O, E(8) - 8 * HOUR]]);
  X.n = kCand([sig['sig:n'][0]], E(8) - 5 * HOUR);
  // one writer on one day: never forms
  sight('sig:solo', [[S, h(8, 2, 1)], [S, h(8, 2, 2)], [S, h(8, 2, 3)]]);

  // week 7's stored learning record, written in week 8, with figures awareness must not read
  X.rec7 = hand(S, { type: 'observation', source: 'metrics', detector: 'metrics', subject: 'project', kind: 'learning', week: isoWeek(W(7)), source_key: `learning:${isoWeek(W(7))}`, detail: 'week 7',
    figures: { informed: { knowledge: 9, signals_explained: 9, signals_formed: 9, starts_given: 9, starts: 9 }, autonomous: {}, trusted: {} } }, h(8, 5, 9));
  const data = (env = {}) => json(Fx.ok(Fx.old, ['dashboard-data'], env));
  return { ...Fx, hand, eff, X, sig, F, data };
}

// The marked block, loaded by itself (as coverageFns loads its block), so the rule is checked alone.
function idFns() {
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const i = src.indexOf('/* suggestion ids start */'), j = src.indexOf('/* suggestion ids end */');
  assert.ok(i >= 0 && j > i, 'the suggestion ids block in devteam.mjs');
  return vm.runInContext(`${src.slice(i, j)}\n;({ suggestionId, uniqueIds, effId })`, vm.createContext({}));
}

test('suggestion ids: the shared rule, unchanged for efficiency', () => {
  const { suggestionId, uniqueIds, effId } = idFns();
  assert.equal(effId('tighter-specs', 'spec'), 'eff-tighter-specs-spec');
  assert.equal(suggestionId('aw', 'signal', 'Dup:Z/x'), 'aw-signal-dup-z-x');
  assert.equal(suggestionId('aw', 'signal', 'x'.repeat(200)).length, 110);
  const u = uniqueIds();
  assert.equal(u('aw-signal-dup-z'), 'aw-signal-dup-z');
  assert.equal(u('aw-signal-dup-z'), 'aw-signal-dup-z-2');
  assert.equal(u('aw-signal-dup-z'), 'aw-signal-dup-z-3');
  // a cut id stays within 110 with its suffix
  const long = suggestionId('aw', 'signal', 'y'.repeat(200));
  assert.equal(u(long), long);
  const second = u(long);
  assert.equal(second.length, 110);
  assert.ok(second.endsWith('-2'), second);
  // a suffixed id is checked against every id taken so far
  const v = uniqueIds();
  assert.equal(v('x-2'), 'x-2');
  assert.equal(v('x'), 'x');
  assert.equal(v('x'), 'x-3');
});

test('other callers read the clock as before', () => {
  const A = awarenessFixture('aw-clock');
  try {
    const { X } = A;
    const tBefore = Date.now();
    const d = A.data();
    const tAfter = Date.now();
    const within = (x, from, unit, what) => {
      // handFor's counter puts a line up to 999 ms after its named time
      const lo = Math.floor((tBefore - from - 1000) / unit), hi = Math.floor((tAfter - from) / unit);
      assert.ok(x >= lo && x <= hi, `${what}: ${x} not in [${lo}, ${hi}]`);
    };
    const inc = d.ooda.debt.incidents;
    assert.deepEqual(inc.map((r) => r.id), [X.incF]);
    within(inc[0].days, h(10, 2, 0), DAY, 'incF days');
    const sigs = d.ooda.debt.signals;
    assert.deepEqual(sigs.map((s) => s.key), ['sig:g', 'sig:h', 'sig:h2', 'sig:k', 'sig:m', 'sig:l']);
    for (const s of sigs) within(s.hours, Date.parse(s.first_at), HOUR, `${s.key} hours`);
    assert.match(A.ok(A.old, ['orient'], { DEVTEAM_ROLE: 'supervisor' }), new RegExp(X.incF));
  } finally { A.done(); }
});

