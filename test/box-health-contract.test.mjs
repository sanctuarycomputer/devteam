// box-health@1 and pool@1 (kit-835): the checks, boxHealthProblem and poolProblem, over the fixture
// answers and pool files and one change at a time; the contract comments; the fake answer. The two
// regions run alone (fixtures/box-health/contract/check.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checks, regionOf } from './fixtures/box-health/contract/check.mjs';
import { CLAUDE_WHY, CLAUDE_WHY_OTHER, MORE, NOW, STATES, WHY, WHY_OTHER, answer, respond } from './fixtures/box-health/contract/answer.mjs';

const { boxHealthProblem, poolProblem } = checks();
const DIR = new URL('./fixtures/box-health/contract/', import.meta.url);
const POOLS = ['pool-reviewer', 'pool-no-claude', 'pool-unmeasured', 'pool-over-60'];
const read = (name) => fs.readFileSync(new URL(`${name}.json`, DIR), 'utf8');
const pool = (name = 'pool-reviewer') => JSON.parse(read(name));
const HOURS = JSON.parse(read('hours'));
const iso = (ms) => new Date(Date.parse(NOW) + ms).toISOString();
// The problem after one change to a copy: edit(value) changes it in place.
const health = (edit, state = 'claude-runs-out') => { const a = short(state); edit(a); return boxHealthProblem(a); };
const pooled = (edit, name) => { const p = pool(name); edit(p); return poolProblem(p); };
// It names the field: the sentence starts with exactly that path, then a space.
const names = (got, field, label = field) => {
  assert.equal(typeof got, 'string', `${label}: refused`);
  assert.ok(got.startsWith(`${field} `), `${label}: names ${field}: ${got}`);
};
// An answer with its samples and every points list cut to three: the tests that change every field in
// turn check it some thousands of times.
const short = (state) => { const a = answer(state); a.samples.length = 3; for (const [, o] of [...objects(a)]) if (o.points?.length > 3) o.points.length = 3; return a; };
// Every object in a value, as [path, object], and every leaf as [path, holder, key, value].
function* objects(v, p = '') {
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) yield* objects(v[i], `${p}[${i}]`); return; }
  if (v === null || typeof v !== 'object') return;
  yield [p, v];
  for (const [k, x] of Object.entries(v)) yield* objects(x, p ? `${p}.${k}` : k);
}
// One place for each shape: the first of a list's entries is enough only when later ones don't hold
// other fields, so a path's shape is its path with the indexes taken out, and its keys.
function* shapes(v) {
  const seen = new Set();
  for (const [p, o] of objects(v)) for (const k of Object.keys(o)) {
    const id = `${p.replace(/\[\d+\]/g, '[]')}.${k}`;
    if (seen.has(id)) continue;
    seen.add(id);
    yield [p, o, k];
  }
}
const at = (p, k) => (p ? `${p}.${k}` : k);
const commentOf = (from, to) => {
  const src = regionOf('box-health-contract');
  const a = src.indexOf(from), b = src.indexOf(to);
  assert.ok(a >= 0 && b > a, `the comment ${from} … stands above ${to}`);
  const text = src.slice(a, b);
  assert.ok(text.trimEnd().split('\n').every((l) => l.startsWith('//')), `nothing but the comment stands between its start and ${to}`);
  return text;
};
const boxComment = () => commentOf('// box-health@1', 'function boxHealthProblem');
const poolComment = () => commentOf('// pool@1', 'function poolProblem');
const flat = (s) => s.replace(/\n\/\/ */g, ' ');

test('C1 every fixture answer passes, as a value and as text', () => {
  assert.deepEqual(STATES, ['normal', 'cpu-full', 'claude-runs-out', 'few-ready', 'no-cswap', 'just-restarted', 'laptop']);
  for (const s of [...STATES, ...MORE]) {
    assert.equal(boxHealthProblem(answer(s)), null, s);
    assert.equal(boxHealthProblem(JSON.stringify(answer(s))), null, `${s}, as text`);
  }
});

test('C2 each state is the mock’s', () => {
  const a = Object.fromEntries(STATES.map((s) => [s, answer(s)]));
  assert.equal(a.normal.headroom.room, 7);
  assert.equal(a.normal.headroom.binds, 'memory');
  assert.ok(a.normal.claude.projection.lasts, 'normal lasts');
  assert.equal(a.normal.pool.what_if.measured, 11);
  assert.equal(a.normal.pool.what_if.now, 12);
  assert.equal(a.normal.pool.what_if.most_that_lasts, 24);
  assert.equal(a['claude-runs-out'].pool.what_if.most_that_lasts, 8);
  for (const s of STATES) for (const step of a[s].pool.what_if?.steps ?? []) if (step.lasts === false) assert.ok(Date.parse(step.runs_out_at) < Date.parse(step.paused_until) && step.workers > a[s].pool.what_if.most_that_lasts, `${s}: ${step.workers} workers run out before the pause ends`);
  for (const s of STATES) {
    const known = a[s].pool.projects.filter((p) => p.port && p.ready !== undefined && Date.parse(a[s].at) - Date.parse(p.at) <= 15 * 60000);
    assert.equal(a[s].headroom.ready, known.reduce((n, p) => n + p.ready, 0), `${s}: ready is the known fleets'`);
  }
  assert.equal(a['cpu-full'].headroom.binds, 'cpu');
  assert.equal(a['cpu-full'].now.cpu.some60, 52);
  assert.equal(a['claude-runs-out'].headroom.binds, 'claude');
  assert.equal(a['claude-runs-out'].claude.projection.lasts, false);
  assert.ok(a['claude-runs-out'].claude.park.some((p) => p.enough), 'something to park');
  assert.equal(a['few-ready'].headroom.binds, 'ready');
  assert.equal(a['few-ready'].headroom.starts, 2);
  assert.equal(a['no-cswap'].claude, undefined);
  assert.ok(!('lasts' in a['no-cswap'].pool.what_if.steps[0]), 'no token fields with no cswap');
  assert.equal(a['just-restarted'].claude.rate, undefined, 'still measuring');
  assert.ok(a['just-restarted'].samples.length < 720, 'a short window');
  assert.deepEqual(a['just-restarted'].headroom.ready_unknown, ['website']);
  assert.ok(!('starts' in a['just-restarted'].headroom), 'with an unknown fleet, starts is left out');
  const lap = a.laptop;
  assert.ok(!('io' in lap.now) && !('some60' in lap.now.cpu) && !('others' in lap.pool) && !('strays' in lap.pool) && !('what_if' in lap.pool), 'the laptop reads no pressure, totals or strays');
  for (const w of lap.pool.allocated) assert.ok(!('cpu' in w) && !('rss' in w) && !('agent' in w), 'nor a worker’s CPU and memory');
});

test('C3 an unknown key at any depth is named, in every object of both contracts', () => {
  for (const s of STATES) {
    const a = short(s);
    const seen = new Set();
    for (const [p, o] of objects(a)) {
      const id = p.replace(/\[\d+\]/g, '[]');
      if (seen.has(id)) continue;
      seen.add(id);
      o.zz = 1;
      names(boxHealthProblem(a), at(p, 'zz'), `${s} ${at(p, 'zz')}`);
      delete o.zz;
    }
  }
  for (const n of POOLS) {
    const a = pool(n);
    const seen = new Set();
    for (const [p, o] of objects(a)) {
      const id = p.replace(/\[\d+\]/g, '[]');
      if (seen.has(id)) continue;
      seen.add(id);
      o.zz = 1; names(poolProblem(a), at(p, 'zz'), `${n} ${at(p, 'zz')}`); delete o.zz;
    }
  }
  names(health((a) => { a.now['a.b'] = 1; }), 'now[a');
  assert.ok(!/a\.b@/.test(health((a) => { a.now['a.b@c.d'] = 1; })), 'nor is the key quoted');
  names(boxHealthProblem(JSON.stringify(answer('laptop')).replace('{', '{"__proto__":1,')), '__proto__', 'a __proto__ key in the text');
  names(health((a) => { a.constructor = 1; }), 'constructor');
});

test('C4 a wrong type names its field, for every field of every object', () => {
  // no field of either contract is an object without keys of its own, or a symbol-like word
  for (const s of STATES) {
    const a = short(s);
    for (const [p, o, k] of shapes(a)) {
      const was = o[k];
      for (const bad of [null, { zz: 1 }, typeof was === 'string' || Array.isArray(was) ? 5 : 'x']) {
        if (k === 'v' && bad === 5) continue;
        o[k] = bad;
        const got = boxHealthProblem(a);
        const field = at(p, k);
        assert.ok(typeof got === 'string' && (got.startsWith(`${field} `) || got.startsWith(`${field}.zz `)), `${s} ${field} = ${JSON.stringify(bad)}: ${got}`);
      }
      o[k] = was;
    }
  }
  for (const n of POOLS) {
    const a = pool(n);
    for (const [p, o, k] of shapes(a)) {
      const was = o[k];
      for (const bad of [k.endsWith('usd_hour') ? -1 : null, { zz: 1 }, typeof was === 'string' || Array.isArray(was) ? 5 : 'x']) {
        o[k] = bad;
        const got = poolProblem(a);
        const field = at(p, k);
        assert.ok(typeof got === 'string' && (got.startsWith(`${field} `) || got.startsWith(`${field}.zz `)), `${n} ${field} = ${JSON.stringify(bad)}: ${got}`);
      }
      o[k] = was;
    }
  }
});

test('C5 numbers stay in their range, times are real and names are the contract’s', () => {
  const bad = [
    ['v', (a) => { a.v = 2; }], ['at', (a) => { a.at = '2026-02-30T00:00:00Z'; }], ['at', (a) => { a.at = '2026-11-24 18:40'; }], ['window_s', (a) => { a.window_s = 0; }],
    ['now.cpu.limit', (a) => { a.now.cpu.limit = 0; }], ['now.cpu.used', (a) => { a.now.cpu.used = -1; }], ['now.cpu.used', (a) => { a.now.cpu.used = NaN; }], ['now.cpu.host_cores[0]', (a) => { a.now.cpu.host_cores[0] = 1.1; }],
    ['now.cpu.shared', (a) => { a.now.cpu.shared = false; }], ['now.cpu.load', (a) => { a.now.cpu.load = [1, 2]; }], ['now.cpu.load_scope', (a) => { a.now.cpu.load_scope = 'box'; }],
    ['now.cpu.some60', (a) => { a.now.cpu.some60 = 101; }], ['now.cpu.throttled', (a) => { a.now.cpu.throttled = 1.5; }], ['now.memory.used', (a) => { a.now.memory.used = 1.5; }], ['now.memory.ceiling', (a) => { a.now.memory.ceiling = 0.99; }],
    ['now.disks[0].free', (a) => { a.now.disks[0].free = -1; }], ['now.disks[0].bytes_per_hour', (a) => { a.now.disks[0].bytes_per_hour = Infinity; }], ['samples[0].room', (a) => { a.samples[0].room = 1.5; }],
    ['headroom.binds', (a) => { a.headroom.binds = 'disk'; }], ['pool.recent[0].why', (a) => { a.pool.recent[0].why = 'gone'; }], ['pool.strays[0].kind', (a) => { a.pool.strays[0].kind = 'other'; }], ['pool.strays[0].why', (a) => { a.pool.strays[0].why = 'old'; }],
    ['pool.allocated[0].title', (a) => { a.pool.allocated[0].title = 'x'.repeat(81); }], ['claude.rate_hours', (a) => { a.claude.rate_hours = 7; }], ['claude.accounts[0].n', (a) => { a.claude.accounts[0].n = 0; }], ['claude.accounts[0].week_left', (a) => { a.claude.accounts[0].week_left = -1; }],
    ['claude.accounts[0].status', (a) => { a.claude.accounts[0].status = 'x@y.z'; }], ['claude.park[0].share', (a) => { a.claude.park[0].share = 1.2; }], ['pool.recent[0].title', (a) => { a.pool.recent[0].title = 'x'.repeat(81); }], ['claude.park[0].goals[0].title', (a) => { a.claude.park[0].goals[0].title = 'x'.repeat(81); }],
  ];
  for (const [field, edit] of bad) names(health(edit), field);
  assert.equal(health((a) => { a.now.disks[0].bytes_per_hour = -6e8; a.pool.allocated[0].title = 'x'.repeat(80); a.at = '2026-11-24T18:40:00.123Z'; }), null);
  for (const [field, drop] of [['v', (a) => delete a.v], ['at', (a) => delete a.at], ['window_s', (a) => delete a.window_s], ['now', (a) => delete a.now], ['samples', (a) => delete a.samples], ['pool.projects', (a) => delete a.pool.projects], ['pool.allocated[0].name', (a) => delete a.pool.allocated[0].name], ['pool.allocated[0].tokens', (a) => delete a.pool.allocated[0].tokens], ['claude.accounts', (a) => delete a.claude.accounts], ['claude.accounts[0].label', (a) => delete a.claude.accounts[0].label]]) names(health(drop), field, `${field} missing`);
  // the parts may each be absent: a hub with only its sampler answers now and samples
  assert.equal(health((a) => { for (const k of ['headroom', 'pool', 'claude', 'box']) delete a[k]; a.now = {}; a.samples = []; }), null);
});

test('C6 a label holding @ is refused; a title may hold one', () => {
  names(health((a) => { a.claude.accounts[2].label = 'a@b.c'; }), 'claude.accounts[2].label');
  assert.equal(health((a) => { a.pool.allocated[0].title = 'box-health@1 lands'; }), null);
  // no refusal quotes what it was given
  const secret = 'someone@example.invalid';
  const put = [(a) => { a.claude.accounts[0].label = secret; }, (a) => { a.claude.accounts[0].status = secret; }, (a) => { a.claude.accounts[0][secret] = 1; }, (a) => { a[secret] = 1; }, (a) => { a.at = secret; }, (a) => { a.v = secret; }, (a) => { a.now = secret; }, (a) => { a.claude.accounts[0] = [secret]; }];
  for (const edit of put) { const got = health(edit); assert.equal(typeof got, 'string'); assert.ok(!got.includes(secret) && !got.includes('someone'), `quotes it: ${got.slice(0, 30)}`); }
  for (const edit of [(p) => { p.workers[0].phase = [secret]; }, (p) => { p.recent[0].why = secret; }, (p) => { p.other[secret] = 1; }]) assert.ok(!pooled(edit).includes('someone'), 'nor does poolProblem');
  for (const check of [boxHealthProblem, poolProblem]) for (const v of [secret, JSON.stringify(secret), [secret]]) assert.ok(!check(v).includes('someone'), 'nor of the whole');
});

test('C7 each list over the design’s bound is refused, and passes at it', () => {
  const fill = (o, k, n, one) => { o[k] = Array.from({ length: n }, (_, i) => (typeof one === 'function' ? one(i) : structuredClone(one))); };
  const point = { at: NOW, new: 1 }, room = { at: NOW, room: 1 };
  const bounds = [
    ['samples', 720, (a, n) => fill(a, 'samples', n, { at: NOW })],
    ['pool.allocated', 60, (a, n) => fill(a.pool, 'allocated', n, a.pool.allocated[0])],
    ['pool.allocated[0].points', 60, (a, n) => fill(a.pool.allocated[0], 'points', n, { at: NOW })],
    ['pool.allocated[0].tokens.points', 60, (a, n) => fill(a.pool.allocated[0].tokens, 'points', n, point)],
    ['pool.recent', 20, (a, n) => fill(a.pool, 'recent', n, a.pool.recent[0])],
    ['pool.recent[0].tokens.points', 60, (a, n) => fill(a.pool.recent[0].tokens, 'points', n, point)],
    ['pool.strays', 40, (a, n) => fill(a.pool, 'strays', n, a.pool.strays[0])],
    ['pool.what_if.steps', 81, (a, n) => fill(a.pool.what_if, 'steps', n, (i) => ({ workers: i, lasts: true }))],
    ['claude.accounts', 40, (a, n) => fill(a.claude, 'accounts', n, a.claude.accounts[0])],
    ['claude.projection.points', 400, (a, n) => fill(a.claude.projection, 'points', n, room)],
  ];
  for (const [field, n, set] of bounds) {
    assert.equal(health((a) => set(a, n)), null, `${field} at ${n}`);
    names(health((a) => set(a, n + 1)), field, `${field} at ${n + 1}`);
  }
  // every list at its bound at once, its rows full, is still under the size
  const row = { at: '2026-11-24T18:40:00.000Z' }, full = health((a) => {
    const big = 123456789012, pts = Array.from({ length: 60 }, () => ({ ...row, cpu: 11.25, rss: big, disk: big }));
    const tokens = { state: 'measured', new: big, cached: big, per_hour: 1234567, reviews_new: big, points: Array.from({ length: 60 }, () => ({ ...row, new: 1234567 })) };
    fill(a, 'samples', 720, { ...row, cpu: 11.25, cpu_some: 51.25, throttled: 0.88, load: 30.85, mem: big, mem_some: 10.25, swap: big, disk: big, inodes: 12345678, io: 10.25, room: 20 });
    fill(a.pool, 'allocated', 60, { ...a.pool.allocated[0], name: 'n'.repeat(60), title: 't'.repeat(80), tokens, points: pts });
    fill(a.pool, 'recent', 20, { ...a.pool.recent[0], name: 'n'.repeat(60), title: 't'.repeat(80), tokens });
    fill(a.pool, 'strays', 40, a.pool.strays[0]); fill(a.pool.what_if, 'steps', 81, (i) => ({ workers: i, lasts: false, runs_out_at: row.at, paused_until: row.at }));
    fill(a.claude, 'accounts', 40, a.claude.accounts[0]); fill(a.claude, 'points', 360, { ...row, room: 3.125 }); fill(a.claude.projection, 'points', 400, { ...row, room: 3.125 });
  });
  assert.equal(full, null, 'a full answer');
  const big = (n) => health((a) => fill(a.headroom, 'ready_unknown', n, 'x'.repeat(1000)));
  names(big(1100), 'answer', 'over 1 MB');
  const text = JSON.stringify(answer('laptop'));
  assert.equal(boxHealthProblem(text + ' '.repeat(1048576 - text.length)), null, 'a body of exactly 1 MB');
  names(boxHealthProblem(text + ' '.repeat(1048577 - text.length)), 'answer', 'one byte more');
});

test('C8 tokens: state, reason and which fields go with each, in allocated and recent', () => {
  for (const where of ['allocated', 'recent']) {
    const set = (tokens) => health((a) => { a.pool[where][0].tokens = tokens; });
    const f = `pool.${where}[0].tokens`;
    const measured = { state: 'measured', new: 5, cached: 6, per_hour: 2, points: [] };
    for (const ok of [measured, { ...measured, reviews_new: 1 }, { state: 'measured', new: 5, cached: 6, points: [] }, { state: 'none-yet' }, { state: 'none-yet', reviews_new: 3 }, { state: 'not-measured' }, { state: 'not-measured', reviews_new: 3 },
      ...['no-reader', 'command-failed', 'no-record'].map((reason) => ({ state: 'not-measured', reason }))]) assert.equal(set(ok), null, `${f} ${JSON.stringify(ok)}`);
    names(set({ state: 'guessed' }), `${f}.state`);
    names(set({ state: 'not-measured', reason: 'why' }), `${f}.reason`);
    names(set({ ...measured, reason: 'no-reader' }), `${f}.reason`, 'measured with a reason');
    names(set({ state: 'none-yet', reason: 'no-record' }), `${f}.reason`, 'none-yet with a reason');
    for (const state of ['none-yet', 'not-measured']) for (const [k, v] of [['new', 1], ['cached', 1], ['per_hour', 1], ['points', []]]) names(set({ state, [k]: v }), `${f}.${k}`, `${state} with ${k}`);
    for (const k of ['new', 'cached', 'points']) { const t = { ...measured }; delete t[k]; names(set(t), `${f}.${k}`, `measured without ${k}`); }
    names(set({ ...measured, reviews_new: 1.5 }), `${f}.reviews_new`);
    names(set({ ...measured, usd_hour: 1 }), `${f}.usd_hour`, 'the pool file’s own field');
  }
});

test('C9 headroom.claude and most_that_lasts may be absent and are whole numbers when there', () => {
  assert.equal(health((a) => { delete a.headroom.claude; delete a.pool.what_if.most_that_lasts; }), null);
  assert.equal(health((a) => { a.headroom.claude = 3; a.pool.what_if.most_that_lasts = 0; }), null);
  for (const bad of [1.5, -1, '3', null]) {
    names(health((a) => { a.headroom.claude = bad; }), 'headroom.claude');
    names(health((a) => { a.pool.what_if.most_that_lasts = bad; }), 'pool.what_if.most_that_lasts');
  }
});

test('C10 a step or a projection that runs out says when, and one that lasts doesn’t', () => {
  const step = (s) => health((a) => { a.pool.what_if.steps[0] = s; });
  const t = iso(3600000), f = 'pool.what_if.steps[0]';
  for (const ok of [{ workers: 0 }, { workers: 0, lasts: true }, { workers: 0, lasts: false, runs_out_at: t }, { workers: 0, lasts: false, runs_out_at: t, paused_until: t }]) assert.equal(step(ok), null, JSON.stringify(ok));
  names(step({ workers: 0, lasts: false }), `${f}.runs_out_at`, 'no time');
  names(step({ workers: 0, lasts: true, runs_out_at: t }), `${f}.runs_out_at`, 'a time on one that lasts');
  names(step({ workers: 0, paused_until: t }), `${f}.paused_until`);
  names(health((a) => { delete a.claude.projection.runs_out_at; }), 'claude.projection.runs_out_at');
  names(health((a) => { a.claude.projection.lasts = true; }), 'claude.projection.runs_out_at', 'on one that lasts');
  assert.equal(health((a) => { delete a.pool.what_if.steps; }), null, 'no steps over 60 workers');
});

test('C11 port: an integer from 1 to 65535 or absent on projects, allocated, recent and park rows; two of one name', () => {
  const rows = { 'pool.projects': (a) => a.pool.projects, 'pool.allocated': (a) => a.pool.allocated, 'pool.recent': (a) => a.pool.recent, 'claude.park': (a) => a.claude.park };
  for (const [f, list] of Object.entries(rows)) {
    for (const bad of [0, 65536, 1.5, '4321', -1, null]) names(health((a) => { list(a)[0].port = bad; }), `${f}[0].port`, `${f}[0].port = ${JSON.stringify(bad)}`);
    for (const ok of [1, 65535]) assert.equal(health((a) => { list(a)[0].port = ok; }), null, `${f} ${ok}`);
    assert.equal(health((a) => { delete list(a)[0].port; }), null, `${f} without`);
  }
  for (const other of ['pool.strays[0]', 'claude.accounts[0]']) names(health((a) => { (other.startsWith('pool') ? a.pool.strays : a.claude.accounts)[0].port = 4321; }), `${other}.port`);
  const a = answer('claude-runs-out');
  const ports = (l, key) => [...new Set(l.filter((r) => r[key] === 'website').map((r) => r.port))].sort();
  assert.deepEqual(ports(a.pool.projects, 'name'), [4323, 4324]);
  assert.deepEqual(ports(a.pool.allocated, 'project'), [4323, 4324]);
  assert.deepEqual(ports(a.claude.park, 'fleet'), [4323, 4324]);
  assert.ok(a.pool.projects.some((p) => !('port' in p)), 'and one project has no dashboard');
});

test('C12 not JSON, not an object, and what a value can hold but JSON cannot', () => {
  for (const [check, root] of [[boxHealthProblem, 'answer'], [poolProblem, 'pool']]) {
    for (const bad of ['', '{"v":1', 'null', '[]', '5', null, undefined, 7, [], true]) names(check(bad), root, `${root} ${JSON.stringify(bad)}`);
    for (const v of [2, '1', null, undefined]) names(check({ v, zz: 1 }), 'v', 'the version comes before the keys');
  }
  names(health((a) => { a.now.memory.used = 5n; }), 'now.memory.used');
  names(health((a) => { a.now.self = a; }), 'now.self');
  names(health((a) => { Object.defineProperty(a, 'toJSON', { value: () => undefined }); }), 'answer', 'a value JSON leaves out');
});

test('C13 every fixture pool file passes, as a value and as text', () => {
  for (const n of POOLS) { assert.equal(poolProblem(pool(n)), null, n); assert.equal(poolProblem(read(n)), null, `${n}, as text`); }
  assert.ok(pool('pool-reviewer').workers.some((w) => w.tokens.reviews_new_hour > 0), 'a reviewer is running');
  const none = pool('pool-no-claude');
  assert.equal(none.workers[0].tokens.new_hour + none.other.new_hour, 0, 'no Claude use');
  assert.ok(none.workers[0].tokens.new > 0, 'though its worker used tokens');
  assert.ok(pool('pool-unmeasured').workers.some((w) => w.tokens.state === 'not-measured'));
  assert.equal(pool('pool-over-60').workers.length, 60);
  assert.ok(HOURS['pool-over-60'].filter((h) => h.kind === 'worker').length > 60, 'the hour had more workers than that');
});

test('C14 pool@1: ranges, the goal index, what goes with each state, and the bounds', () => {
  names(pooled((p) => { p.workers[0].goal = 2; }), 'workers[0].goal', 'past the last goal');
  for (const bad of [-1, 0.5]) names(pooled((p) => { p.workers[0].goal = bad; }), 'workers[0].goal');
  assert.equal(pooled((p) => { delete p.workers[0].goal; delete p.cap; delete p.goals[0].priority; }), null, 'no goal, no limit, no priority');
  names(pooled((p) => { p.goals = []; }), 'workers[0].goal', 'an index with no goals');
  for (const k of ['at', 'hour_end', 'ready', 'planners', 'goals', 'workers', 'recent', 'other']) names(pooled((p) => { delete p[k]; }), k, `${k} missing`);
  for (const [f, edit] of [['other.usd_hour', (p) => { p.other.usd_hour = -1; }], ['other.new_hour', (p) => { p.other.new_hour = null; }], ['cap', (p) => { p.cap = null; }], ['recent[0].why', (p) => { p.recent[0].why = 'gone'; }], ['goals[0].title', (p) => { p.goals[0].title = 'x'.repeat(81); }], ['workers[0].title', (p) => { p.workers[0].title = 'x'.repeat(81); }], ['recent[0].title', (p) => { p.recent[0].title = 'x'.repeat(81); }]]) names(pooled(edit), f);
  assert.equal(pooled((p) => { p.other.usd_hour = null; p.goals[0].usd_hour = null; p.workers[0].tokens.usd_hour = null; p.workers[0].tokens.reviews_usd_hour = null; }), null, 'no list price');
  const set = (tokens) => pooled((p) => { p.workers[0].tokens = tokens; });
  const t = pool().workers[0].tokens, f = 'workers[0].tokens';
  for (const k of ['new', 'cached', 'points', 'usd_hour', 'new_hour']) { const x = { ...t }; delete x[k]; names(set(x), `${f}.${k}`, `measured without ${k}`); names(set({ state: 'none-yet', [k]: t[k] }), `${f}.${k}`, `none-yet with ${k}`); }
  for (const state of ['none-yet', 'not-measured']) assert.equal(set({ state, reviews_new: 1, reviews_usd_hour: 0.5, reviews_new_hour: 1 }), null, `${state} with its reviewers' hour`);
  names(set({ state: 'none-yet', reason: 'no-record' }), `${f}.reason`);
  names(set({ ...t, per_hour: 1 }), `${f}.per_hour`, 'the answer’s own field');
  for (const k of ['usd_hour', 'new_hour', 'reviews_usd_hour', 'reviews_new_hour']) names(pooled((p) => { p.recent[0].tokens[k] = 1; }), `recent[0].tokens.${k}`, `recent with ${k}`);
  const fill = (l, n) => Array.from({ length: n }, () => structuredClone(l));
  const bounds = [
    ['goals', 20, (p, n) => { p.goals = fill(p.goals[0], n); }], ['workers', 60, (p, n) => { p.workers = fill({ name: 'w', tokens: { state: 'none-yet' } }, n); }], ['recent', 20, (p, n) => { p.recent = fill(p.recent[1], n); }],
    ['workers[0].tokens.points', 36, (p, n) => { p.workers[0].tokens.points = fill({ at: NOW, new: 1 }, n); }], ['recent[0].tokens.points', 36, (p, n) => { p.recent[0].tokens.points = fill({ at: NOW, new: 1 }, n); }],
  ];
  for (const [field, n, edit] of bounds) { assert.equal(pooled((p) => edit(p, n)), null, `${field} at ${n}`); names(pooled((p) => edit(p, n + 1)), field, `${field} at ${n + 1}`); }
  // sizes: text by its bytes, a value by its JSON's
  const text = read('pool-reviewer');
  assert.equal(poolProblem(text + ' '.repeat(262144 - text.length)), null, 'exactly 256 KB');
  names(poolProblem(text + ' '.repeat(262145 - text.length)), 'pool', 'one byte more');
  const wide = (c) => JSON.stringify({ ...pool(), workers: [{ ...pool().workers[0], name: c.repeat(100000) }] });
  assert.equal(poolProblem(wide('é')), null, '200 KB of two-byte letters');
  names(poolProblem(wide('漢')), 'pool', '300 KB in 100,000 characters');
  const faces = (n) => JSON.stringify({ ...pool(), workers: [{ ...pool().workers[0], name: '😀'.repeat(n) }] });
  assert.equal(poolProblem(faces(60000)), null, '240 KB of four-byte letters');
  names(poolProblem(faces(66000)), 'pool', '264 KB of four-byte letters');
  names(poolProblem(JSON.parse(wide('漢'))), 'pool', 'a value, by its JSON');
});

test('C15 (F7-1) a goal is its workers, their reviewers, its planners and its ended sessions; the hour is workers, reviewers and other', () => {
  const sum = (l, k) => l.reduce((n, x) => n + x[k], 0);
  for (const n of POOLS) {
    const p = pool(n), hour = HOURS[n];
    const listed = new Set(p.workers.map((w) => w.name));
    const part = { workers: p.workers, reviewers: p.workers.filter((w) => w.tokens.reviews_new_hour !== undefined) };
    assert.equal(sum(p.workers.filter((w) => w.tokens.new_hour !== undefined).map((w) => w.tokens), 'new_hour') + sum(part.reviewers.map((w) => w.tokens), 'reviews_new_hour') + p.other.new_hour, sum(hour, 'new_hour'), `${n}: workers + reviewers + other is the hour`);
    for (const [i, g] of p.goals.entries()) assert.equal(g.new_hour, sum(hour.filter((h) => h.goal === g.id), 'new_hour'), `${n}: goal ${i}`);
    for (const w of p.workers) {
      const own = hour.filter((h) => h.kind === 'worker' && h.name === w.name), rev = hour.filter((h) => h.kind === 'reviewer' && h.name === w.name);
      assert.equal(w.tokens.new_hour ?? 0, sum(own, 'new_hour'), `${n}: ${w.name}`);
      assert.equal(w.tokens.reviews_new_hour ?? 0, sum(rev, 'new_hour'), `${n}: ${w.name}'s reviewers`);
    }
    assert.equal(p.other.new_hour, sum(hour.filter((h) => !(['worker', 'reviewer'].includes(h.kind) && listed.has(h.name))), 'new_hour'), `${n}: other`);
  }
  assert.ok(HOURS['pool-over-60'].some((h) => h.kind === 'reviewer' && !pool('pool-over-60').workers.some((w) => w.name === h.name)), 'a reviewer of no listed worker is in other');
  // in dollars, where every record has a price: the goal with a reviewer running, worked out from its
  // parts, and the whole hour, which the goals are never added to
  const p = pool('pool-reviewer'), hour = HOURS['pool-reviewer'], g = p.goals[0];
  const of = (kind) => sum(hour.filter((h) => h.goal === g.id && h.kind === kind), 'usd_hour');
  const mine = p.workers.filter((w) => w.goal === 0).map((w) => w.tokens);
  const reviews = mine.filter((t) => t.reviews_usd_hour !== undefined);
  assert.ok(of('reviewer') > 0 && of('planner') > 0 && of('ended') > 0, 'it has a reviewer, a planner and an ended session');
  assert.equal(g.usd_hour, sum(mine, 'usd_hour') + sum(reviews, 'reviews_usd_hour') + of('planner') + of('ended'));
  assert.equal(g.new_hour, sum(mine, 'new_hour') + sum(reviews, 'reviews_new_hour') + 75000 + 125000);
  const all = p.workers.map((w) => w.tokens).filter((t) => t.usd_hour !== undefined);
  assert.equal(sum(all, 'usd_hour') + sum(reviews, 'reviews_usd_hour') + p.other.usd_hour, sum(hour, 'usd_hour'));
  const said = flat(poolComment());
  for (const s of ["A goal's usd_hour and new_hour are its workers', their reviewers', its planners' and its ended sessions' hours", 'The whole hour is the workers, their reviewers and `other`', 'never added to it']) assert.ok(said.includes(s), `the comment says ${s}`);
});

test('C16 the comment above each check states every field, in its own object’s words', () => {
  const box = boxComment(), pl = poolComment();
  const bare = (p) => p.replace(/\[\d+\]/g, '[]');
  const cutOf = (text, from, to) => { const i = text.indexOf(from), j = text.indexOf(to, i + from.length); assert.ok(i >= 0 && j > i, `the comment has ${from} … ${to}`); return text.slice(i, j); };
  // each object's words: its path, and where in the comment they start and end
  const BOX = [
    ['', '// box-health@1,', '// box-health@1 ends'], ['now', '`now`*', '`samples`*  every'], ['now.cpu', '`cpu`: `limit`', '`memory`:'], ['now.memory', '`memory`:', '`disks`, one'], ['now.disks[]', '`disks`, one', '`io`:'], ['now.io', '`io`:', '`samples`*  every'],
    ['samples[]', '`samples`*  every', '`headroom`  '], ['headroom', '`headroom`  ', '`pool`  '], ['pool', '`pool`  ', '`tokens`    `state`'], ['pool.projects[]', '`projects`*', '`allocated`*'],
    ['pool.allocated[]', '`allocated`*', '`recent`*'], ['pool.allocated[].points[]', '`points` (one a minute', '`tests` ('], ['pool.allocated[].tests', '`tests` (', '`recent`*'], ['pool.recent[]', '`recent`*', '`others`'], ['pool.recent[].last', '`last` (', '`others`'],
    ['pool.others', '`others`', '`strays`'], ['pool.others.planners', '`others`', '`strays`'], ['pool.others.supervisors', '`others`', '`strays`'], ['pool.others.outside', '`others`', '`strays`'], ['pool.others.unattributed', '`unattributed`:', '`strays`'],
    ['pool.strays[]', '`strays`', '`what_if`'], ['pool.what_if', '`what_if`', '`tokens`    `state`'], ['pool.what_if.steps[]', '`steps` (', '`memory_full_at`'],
    ...['pool.allocated[].tokens', 'pool.recent[].tokens'].flatMap((p) => [[p, '`tokens`    `state`', '`claude`    '], [`${p}.points[]`, '`points`* (ten-minute', '`claude`    ']]),
    ['claude', '`claude`    ', '`box`  '], ['claude.accounts[]', '`accounts`*, at', '`rate` ('], ['claude.points[]', '`points` (measured', '`projection`:'], ['claude.projection', '`projection`:', '`park`:'], ['claude.projection.points[]', '`points` (measured', '`projection`:'],
    ['claude.park[]', '`park`:', '`box`  '], ['claude.park[].goals[]', '`goals`* (', '`box`  '], ['box', '`box`  ', '// `port`'], ['box.github', '`github` (', '// `port`'],
  ];
  const POOL = [['', '// pool@1,', '// pool@1 ends'], ['goals[]', '`goals`   ', '`workers`  '], ['workers[]', '`workers`  ', '`recent`  '], ['recent[]', '`recent`  ', '`other`  '], ['other', '`other`  ', '`tokens`    `state`'],
    ...['workers[].tokens', 'recent[].tokens'].flatMap((p) => [[p, '`tokens`    `state`', '// `usd_hour` and'], [`${p}.points[]`, '`points` (ten-minute', '// `usd_hour` and']])];
  for (const [text, places, values, check, label, end] of [[box, BOX, [...STATES, ...MORE].map(short), boxHealthProblem, 'box-health@1', '// box-health@1 ends'], [pl, POOL, POOLS.map(pool), poolProblem, 'pool@1', '// pool@1 ends']]) {
    const held = new Map();
    for (const v of values) for (const [p, o] of objects(v)) { const k = bare(p); if (!held.has(k)) held.set(k, new Set()); for (const x of Object.keys(o)) held.get(k).add(x); }
    const known = new Map();
    for (const v of values) for (const [p, o] of objects(v)) {
      if (known.has(bare(p))) continue;
      o.zz = 1; const said = /it holds only (.*)$/.exec(check(v)); delete o.zz;
      assert.ok(said, `${label} ${p}`);
      known.set(bare(p), said[1].split(', '));
    }
    assert.deepEqual([...known.keys()].sort(), places.map(([p]) => p).sort(), `${label}: every object has its words`);
    for (const [p, from, to] of places) {
      const words = cutOf(`${text}\n${end}`, from, to);
      for (const k of known.get(p)) {
        assert.ok(held.get(p).has(k), `${label}: a fixture holds ${at(p, k)}`);
        assert.ok(words.includes(`\`${k}\``), `${label}'s comment names ${k} of ${p || 'the whole'}`);
      }
    }
  }
  const b = flat(box), q = flat(pl);
  for (const s of ['It was added at graph review G1-11', '1 to 65535', 'only newer `samples` and `claude.points`', "the pool's points and the projection's are always whole", 'at most 720', 'at most 81', 'at most 400', '1048576', 'absent, never zero', '"no-reader"', '"command-failed"', '"no-record"', '"merged", "done", "parked", "held" or "stopped"', '"parent-gone", "folder-gone", "long-test"', '"or over"', 'absent when there is no Claude limit to state', 'absent with no cswap']) assert.ok(b.includes(s), `box-health@1's comment says ${s}`);
  for (const s of ['at most 60', 'at most 20', 'at most 36', 'at most 80', '262144', 'Claude models', 'no list price', 'an index into goals']) assert.ok(q.includes(s), `pool@1's comment says ${s}`);
});

test('C19 why there is no token forecast, and why no Claude limit: one word each, only then, and the page’s sentence', () => {
  const step = { workers: 0 };
  const whatIf = (w) => health((a) => { a.pool.what_if = { now: 12, ...w }; });
  for (const why of [...Object.keys(WHY), 'a-later-word']) for (const steps of [[step], undefined]) assert.equal(whatIf({ why, ...(steps ? { steps } : {}) }), null, why);
  names(whatIf({ why: 'measuring', steps: [step, { workers: 1, lasts: true }] }), 'pool.what_if.why', 'with a step that has lasts');
  names(whatIf({ why: 'Two words', steps: [step] }), 'pool.what_if.why');
  assert.equal(whatIf({ steps: [step] }), null, 'it may be left out');
  const room = (h) => health((a) => { a.headroom = h; });
  for (const w of [...Object.keys(CLAUDE_WHY), 'a-later-word']) assert.equal(room({ claude_why: w }), null, w);
  names(room({ claude: 0, claude_why: 'lasts' }), 'headroom.claude_why', 'with a limit');
  names(room({ claude_why: 'x@y' }), 'headroom.claude_why');
  // each word has an answer
  const said = new Map([...STATES, ...MORE].map((s) => [s, answer(s)]));
  const by = (get) => new Set([...said.values()].map(get).filter(Boolean));
  for (const w of Object.keys(WHY)) assert.ok(by((a) => a.pool.what_if?.why).has(w), `an answer has why ${w}`);
  for (const w of Object.keys(CLAUDE_WHY)) assert.ok(by((a) => a.headroom.claude_why).has(w), `an answer has claude_why ${w}`);
  assert.ok(!(said.get('why-unknown').pool.what_if.why in WHY), 'and one a word the page does not know');
  for (const [s, a] of said) assert.ok(a.headroom.claude !== undefined || a.headroom.claude_why, `${s}: no Claude limit, and says why`);
  // the pair most easily mixed up: in one nothing used Claude, in the other the workers did not
  assert.equal(said.get('no-claude-use').claude.rate, 0);
  assert.ok(said.get('none-by-workers').claude.rate > 0);
  assert.equal(said.get('none-measured').pool.what_if.measured, 0);
  assert.equal(said.get('too-many').pool.what_if.steps, undefined);
  assert.equal(said.get('top-step-lasts').pool.what_if.most_that_lasts, 32);
  const c = flat(boxComment()).replace(/ +/g, ' ');
  for (const w of Object.keys(WHY)) { const i = c.indexOf(`"${w}" (`); assert.ok(i > 0 && c.slice(i, i + 220).includes(WHY[w]), `the comment gives ${w} its sentence`); }
  assert.ok(c.includes(`Any other word: ${WHY_OTHER}`), 'and any other word');
  assert.deepEqual(Object.keys(WHY), ['no-cswap', 'measuring', 'no-projection', 'too-many', 'no-claude-use', 'none-measured', 'none-by-workers']);
  let from = c.indexOf('the first of these that holds');
  for (const w of Object.keys(WHY)) { const i = c.indexOf(`"${w}" (`, from); assert.ok(i > from, `${w} in its order`); from = i; }
  assert.ok(c.includes('the first that holds of "no-cswap", "measuring", "no-projection", "no-claude-use" and "none-by-workers"'), 'claude_why’s order');
  assert.ok(c.includes(`then "lasts" (the top step lasts, or with no forecast the projection does: ${CLAUDE_WHY.lasts})`), 'and lasts last');
  assert.ok(c.includes(`any other word: ${CLAUDE_WHY_OTHER}`));
  const many = said.get('too-many').pool;
  assert.ok(many.what_if.measured <= many.what_if.now && many.what_if.measured === many.allocated.filter((w) => w.tokens.state === 'measured').length, 'too-many’s measured');
  // the park cases
  const park = (s) => { const { park: p, rate, projection } = said.get(s).claude; return p && { one: p.some((x) => x.enough), all: rate * (1 - p.reduce((n, x) => n + x.share, 0)) <= projection.safe_rate }; };
  assert.deepEqual(park('claude-runs-out'), { one: true, all: true });
  assert.deepEqual(park('park-together'), { one: false, all: true });
  assert.deepEqual(park('park-not-enough'), { one: false, all: false });
  assert.equal(park('park-no-rate'), undefined);
  assert.equal(said.get('park-no-rate').claude.projection.safe_rate, undefined);
  for (const s of ['claude-runs-out', 'park-together', 'park-not-enough']) for (const p of said.get(s).claude.park) assert.equal(p.enough, said.get(s).claude.rate * (1 - p.share) <= said.get(s).claude.projection.safe_rate, `${s}: ${p.fleet} ${p.port}`);
});

test('C20 every field refuses what is just outside its kind, and takes what is just inside', () => {
  // each kind: what it refuses, and what it takes; NaN, null and other types are C4's and C5's
  const KIND = {
    count: [[1.5, -1, 2 ** 53], [0, 7]], least1: [[0, 1.5, -1], [1, 7]], whole: [[1.5], [-3, 0]], amount: [[-0.1, Infinity, NaN], [0, 0.5]], more: [[0, -1, Infinity], [0.5]], signed: [[Infinity, NaN], [-5.5, 0]],
    percent: [[-0.1, 100.1], [0, 100, 0.5]], share: [[-0.1, 1.1], [0, 1, 0.5]], ceiling: [[0.4, 0.96], [0.5, 0.95]], hours: [[-0.1, 6.1], [0, 6]], time: [['', '2026-02-30T00:00:00Z', '2026-11-24', '2026-11-24T18:40:00+01:00'], ['2026-11-24T18:40:00Z', '2026-11-24T18:40:00.123Z']],
    text: [[''], ['x'.repeat(200)]], title: [['', 'x'.repeat(81)], ['x'.repeat(80), 'an @']], label: [['', 'a@b'], ['x']], word: [['', 'Two', 'a b', 'x'.repeat(41)], ['ok', 'a-b_c']], port: [[0, 65536, 1.5], [1, 65535]],
    price: [[-0.1, Infinity], [0, 0.5, null]], bool: [[0, 'true'], []], yes: [[false, 1], [true]], one: [[0, 2, '1'], [1]], goal: [[-1, 0.5, 20], [0]],
    reason: [['', 'zz'], []], state: [['', 'zz'], []], ended: [['', 'zz', 'lost'], ['merged', 'done', 'parked', 'held', 'stopped']], binds: [['', 'disk'], ['memory', 'cpu', 'claude', 'ready']], host: [['', 'box'], ['host']],
    strayKind: [['', 'other'], ['agent', 'browser', 'node', 'test']], strayWhy: [['', 'old'], ['parent-gone', 'folder-gone', 'long-test']],
  };
  // a field's kind by its path first, then by its name
  const PATHS = [
    [/^headroom\.(memory|cpu)$/, 'count'], [/^headroom\.ready_unknown\[\]$/, 'text'], [/^now\.cpu\.limit$/, 'more'], [/^now\.cpu\.used$/, 'amount'], [/^(claude|claude\.projection)\.points\[\]\.room$/, 'amount'], [/^(samples\[\]|now\.cpu\.load\[\]).*load|^now\.cpu\.load\[\]$/, 'amount'],
    [/^(claude\.accounts|pool\.strays)\[\]\.n$/, 'least1'], [/^pool\.strays\[\]\.why$/, 'strayWhy'], [/^pool\.what_if\.why$|^headroom\.claude_why$/, 'word'], [/^(samples\[\]|now\.memory|now\.io)\..*some|^samples\[\]\.io$/, 'percent'],
    [/^claude\.park\[\]\.goals\[\]\.title$/, 'title'], [/^box\.(kit|latest)$/, 'text'], [/^now\.cpu\.host_cores\[\]$/, 'share'], [/recent\[\]\.why$/, 'ended'], [/^now$|^pool$/, null],
  ];
  const NAMES = Object.fromEntries(Object.entries({
    count: 'used max available swap_used swap_max free total inodes_free inodes mem swap disk room starts claude ready workers planners cap rss n new cached reviews_new oldest_s most_that_lasts measured now memory_full_at cpu_full_at oom_kills left limit new_hour reviews_new_hour',
    least1: 'window_s', whole: 'priority', amount: 'cpu load per_hour rate safe_rate', signed: 'bytes_per_hour', percent: 'some10 some60 full60 week_left five_left', share: 'throttled share', ceiling: 'ceiling', hours: 'rate_hours',
    time: 'at since disk_at left_at runs_out_at paused_until week_resets_at five_resets_at next_reset_at started_at resets_at hour_end', text: 'name project phase fleet id', title: 'title', label: 'label', word: 'status', port: 'port',
    price: 'usd_hour reviews_usd_hour', bool: 'agent active lasts enough', yes: 'shared', one: 'v', goal: 'goal', reason: 'reason', state: 'state', binds: 'binds', host: 'load_scope', strayKind: 'kind',
  }).flatMap(([k, l]) => l.split(' ').map((n) => [n, k])));
  // a field is swept once, in the first answer or file that holds it
  const sweep = (value, check, label, done) => {
    for (const [p, o] of objects(value)) for (const [k, was] of Object.entries(o)) {
      const list = Array.isArray(was);
      if (list ? was.length === 0 || (was[0] !== null && typeof was[0] === 'object') : was !== null && typeof was === 'object') continue;
      const field = at(p, k), id = `${field.replace(/\[\d+\]/g, '[]')}${list ? '[]' : ''}`;
      if (done.has(id)) continue;
      done.add(id);
      const kind = (PATHS.find(([re]) => re.test(id)) ?? [])[1] ?? NAMES[k];
      assert.ok(KIND[kind], `${label}: ${id} has a kind`);
      const put = (x) => { if (list) was[0] = x; else o[k] = x; };
      const first = list ? was[0] : was;
      for (const bad of KIND[kind][0]) { put(bad); names(check(value), list ? `${field}[0]` : field, `${label} ${id} = ${String(bad).slice(0, 30)}`); }
      for (const good of KIND[kind][1]) { put(good); assert.equal(check(value), null, `${label} ${id} takes ${String(good).slice(0, 30)}`); }
      put(first);
    }
  };
  const box = new Set(), pl = new Set();
  for (const s of [...STATES, ...MORE]) sweep(short(s), boxHealthProblem, s, box);
  for (const n of POOLS) sweep(pool(n), poolProblem, n, pl);
  assert.ok(box.size > 100 && pl.size > 25, `${box.size} and ${pl.size} fields swept`);
});

test('C17 the fake answer: after gives only newer samples and claude.points, and nothing else changes', () => {
  for (const s of STATES) {
    const whole = answer(s), after = iso(-5 * 60000);
    const part = answer(s, { after });
    assert.equal(boxHealthProblem(part), null, s);
    assert.ok(part.samples.length > 0 && part.samples.length < whole.samples.length, `${s}: fewer samples`);
    assert.deepEqual(part.samples, whole.samples.filter((x) => Date.parse(x.at) > Date.parse(after)), `${s}: exactly the newer ones`);
    if (whole.claude) {
      assert.ok(part.claude.points.length > 0 && part.claude.points.length < whole.claude.points.length, `${s}: fewer points`);
      assert.deepEqual(part.claude.points, whole.claude.points.filter((x) => Date.parse(x.at) > Date.parse(after)));
      assert.deepEqual(part.claude.projection, whole.claude.projection, `${s}: the projection's points are whole`);
      whole.claude.points = part.claude.points;
    }
    assert.deepEqual(part.pool, whole.pool, `${s}: the pool's points are whole`);
    whole.samples = part.samples;
    assert.deepEqual(part, whole, `${s}: nothing else differs`);
    const at0 = answer(s, { after: NOW });
    assert.equal(at0.samples.length, 0, 'a sample at that time is not newer');
    assert.equal(boxHealthProblem(at0), null);
  }
  assert.throws(() => answer('normal', { after: 'yesterday' }));
  assert.throws(() => answer('busy'));
});

test('C18 the fake route: the answer, a bad time or unknown parameter is 400, another path is 404', () => {
  const ok = respond('normal', '/box-health.json');
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.body), answer('normal'));
  assert.deepEqual(JSON.parse(respond('normal', `/box-health.json?after=${encodeURIComponent(iso(-60000))}`).body), answer('normal', { after: iso(-60000) }));
  for (const q of ['after=', 'after=yesterday', 'after=2026-02-30T00:00:00Z', 'since=1h', `since=${NOW}`, `after=${NOW}&zz=1`, `after=${NOW}&after=${NOW}`]) assert.equal(respond('normal', `/box-health.json?${q}`).status, 400, q);
  assert.equal(respond('normal', '/box-health.jsonx').status, 404);
});
