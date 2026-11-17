// The dashboard's Overview and Goals (kit-90): goalBlock and heartbeatDays, run alone in vm; then the
// pages in real headless Chrome over a real dashboard on a fixture project seeded with the kit's own
// commands (skipped where Chrome can't run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { PORTS, bareProject, dashboardOnFreePort, line } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX = fs.readFileSync(path.join(here, '..', 'docs', 'devteam', 'dashboard', 'index.html'), 'utf8');
const block = (src, name) => {
  const a = src.indexOf(`/* ${name} start */`), b = src.indexOf(`/* ${name} end */`);
  assert.ok(a >= 0 && b > a, `the ${name} block is in the page`);
  assert.equal(src.indexOf(`/* ${name} start */`, a + 1), -1, `one ${name} block`);
  return src.slice(a, b + `/* ${name} end */`.length);
};

test('goalBlock: full, partial and null', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`${block(INDEX, 'goal-block')}\nthis.goalBlock = goalBlock;`, ctx);
  const goalBlock = (g, d) => ctx.goalBlock(JSON.parse(JSON.stringify(g)), JSON.parse(JSON.stringify(d)));
  const G = { id: 'g1', status: 'ready' };
  const mk = (over = {}) => {
    const d = {
      ooda: { roadmap: { goals: [{ id: 'g1', features: ['f1'] }, { id: 'g2', features: ['f2'] }], features: { f1: {}, f2: {} } } },
      tickets: [{ id: 'a', feature: 'f1', stage: 'building' }, { id: 'b', feature: 'f1', stage: 'building' }],
      questions: [], planners: [],
    };
    return { ...d, ...over };
  };
  const tk = (d, id, o) => { Object.assign(d.tickets.find((t) => t.id === id), o); return d; };
  const q1 = { id: 'q-1', status: 'open' };
  let d = mk({ questions: [q1] }); tk(d, 'a', { held_by: 'q-1' }); tk(d, 'b', { phase: 'blocked' });
  assert.equal(goalBlock(G, d), 'full');
  d = mk({ questions: [{ id: 'q-2', status: 'open', default: 'x' }] }); tk(d, 'a', { held_by: 'q-2' });
  assert.equal(goalBlock(G, d), null);
  d = mk({ questions: [q1] }); tk(d, 'a', { held_by: 'q-1' }); tk(d, 'b', { depends_on: ['a'] });
  assert.equal(goalBlock(G, d), 'full');
  d = mk(); tk(d, 'a', { held: { reason: 'x' } });
  assert.equal(goalBlock(G, d), 'partial');
  d = mk({ questions: [{ id: 'q-3', status: 'open', blocks: ['b'] }] }); tk(d, 'a', { stage: 'merged' });
  assert.equal(goalBlock(G, d), 'full');
  const P = { goals: ['g1'], waiting: { kind: 'prompt' } };
  d = mk({ tickets: [], planners: [P] });
  assert.equal(goalBlock(G, d), 'full');
  d = mk({ tickets: [{ id: 'm', feature: 'f1', stage: 'building' }], planners: [P] });
  assert.equal(goalBlock(G, d), 'partial');
  assert.equal(goalBlock(G, mk()), null);
  assert.equal(goalBlock(G, mk({ tickets: [] })), null);
  d = mk({ questions: [q1] }); tk(d, 'a', { held_by: 'q-1' }); tk(d, 'b', { held_by: 'q-1' });
  assert.equal(goalBlock({ ...G, status: 'met' }, d), null);
  assert.equal(goalBlock({ ...G, status: 'abandoned' }, d), null);
  assert.equal(goalBlock({ ...G, hold_view: { mode: 'park' } }, d), null);
  d = mk({ tickets: [{ id: 'z', feature: 'f2', stage: 'building' }, { id: 'a', feature: 'f1', stage: 'building' }], questions: [{ id: 'q-4', status: 'open', blocks: ['z'] }] });
  assert.equal(goalBlock(G, d), null);
  d = mk({ tickets: [{ id: 'a', feature: 'f1', stage: 'building', held_by: 'q-1' }, { id: 'b', feature: 'f1', stage: 'building', depends_on: ['c'] }, { id: 'c', feature: 'f1', stage: 'building', depends_on: ['a'] }], questions: [q1] });
  assert.equal(goalBlock(G, d), 'full');
  d = mk({ questions: [{ id: 'q-5', status: 'open', default: 'y', blocks: ['a'] }] });
  assert.equal(goalBlock(G, d), null);
  d = mk({ tickets: [], planners: [{ goals: ['g1'], waiting: { kind: 'limit' } }] });
  assert.equal(goalBlock(G, d), null);
  // an open question with no default names a ticket by its ticket field
  d = mk({ questions: [{ id: 'q-6', status: 'open', ticket: 'a' }] }); tk(d, 'b', { depends_on: ['a'] });
  assert.equal(goalBlock(G, d), 'full');
  // a question that is not open holds nothing, by held_by or by blocks or ticket
  const ans = { id: 'q-7', status: 'answered', blocks: ['a', 'b'], ticket: 'a' };
  d = mk({ questions: [ans] }); tk(d, 'a', { held_by: 'q-7' });
  assert.equal(goalBlock(G, d), null);
  // merged, released and superseded tickets are done work, not stuck work
  for (const stage of ['released', 'superseded']) {
    d = mk({ questions: [q1] }); tk(d, 'a', { held_by: 'q-1' }); tk(d, 'b', { held_by: 'q-1', stage });
    assert.equal(goalBlock(G, d), 'full', stage);
    d = mk({ questions: [q1] }); tk(d, 'a', { stage }); tk(d, 'b', { held_by: 'q-1' });
    assert.equal(goalBlock(G, d), 'full', stage);
    d = mk({ questions: [q1] }); tk(d, 'a', { stage }); tk(d, 'b', { stage });
    assert.equal(goalBlock(G, d), null, stage);
  }
  // a stuck ticket that is done does not count, so a lone live one moving is not blocked
  d = mk({ questions: [q1] }); tk(d, 'a', { held_by: 'q-1', stage: 'released' });
  assert.equal(goalBlock(G, d), null);
});

// kit-84's upkeep_days as the shell's heartbeat takes them: { day, items: [words], failed }
test('heartbeatDays: kit-84\'s days in the heartbeat\'s shape', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`${block(INDEX, 'goal-block')}\nthis.heartbeatDays = heartbeatDays;`, ctx);
  const hd = (x) => JSON.parse(JSON.stringify(ctx.heartbeatDays(x)));
  assert.deepEqual(hd(upkeepDaysFixture(new Date('2026-11-17T12:00:00Z')).slice(-3)), [
    { day: '2026-11-15', items: [], failed: false },
    { day: '2026-11-16', items: ['ran the retro'], failed: true },
    { day: '2026-11-17', items: ['fixed CI on main', 'synced the kit'], failed: false },
  ]);
  assert.deepEqual(hd(upkeepDaysFixture(new Date('2026-11-17T12:00:00Z')))[5], { day: '2026-11-09', items: ['a chore', 'a retro', 'a kit sync', 'a CI fix', 'a trial'], failed: false });
  assert.deepEqual(hd([]), []);
  assert.deepEqual(hd(undefined), []);
});

// The hello-pulse block alone: helloLoad redraws Overview only when the answer changed; ovMosaic formats its days with one formatter and is kept while the activity
// and the day are the same.
const helloCtx = (globals = {}) => {
  const asks = [], draws = [];
  const ctx = vm.createContext({
    ...globals,
    DATA: {}, AbortSignal: { timeout: () => undefined }, esc: (x) => String(x),
    renderOverview: () => draws.push(1),
    // each ask waits until the test answers it: answer(i, body) or answer(i, null) for a failed ask
    fetch: () => new Promise((resolve, reject) => asks.push({ resolve, reject })),
  });
  vm.runInContext(`${block(INDEX, 'hello-pulse')}\nthis.helloLoad = helloLoad; this.hello = () => HELLO; this.ovMosaic = ovMosaic;`, ctx);
  const answer = async (i, body) => {
    if (body === null) asks[i].reject(new Error('down')); else asks[i].resolve({ ok: true, json: async () => body });
    for (let k = 0; k < 5; k++) await new Promise((r) => setImmediate(r));
  };
  return { ctx, asks, draws, answer, hello: () => JSON.parse(JSON.stringify(ctx.hello())) };
};

test('helloLoad: Overview redraws only when the answer changed', async () => {
  const { ctx, asks, draws, answer, hello } = helloCtx();
  const a = ctx.helloLoad();
  await answer(0, { name: 'new', pulse: { state: 'working' } });
  await a;
  assert.deepEqual(hello(), { name: 'new', pulse: { state: 'working' } });
  assert.equal(draws.length, 1, 'the answer drew Overview');
  // the same answer again: no redraw
  const c = ctx.helloLoad();
  await answer(1, { name: 'new', pulse: { state: 'working' } });
  await c;
  assert.equal(draws.length, 1, 'an unchanged answer does not redraw Overview');
  // a changed answer redraws; a failed ask leaves none, and redraws once
  const d = ctx.helloLoad();
  await answer(2, { name: 'new', pulse: { state: 'waiting' } });
  await d;
  assert.equal(draws.length, 2, 'a changed answer redraws Overview');
  const e = ctx.helloLoad();
  await answer(3, null);
  await e;
  assert.equal(ctx.hello(), null, 'a failed ask leaves none');
  assert.equal(draws.length, 3, 'which is a change');
  const f = ctx.helloLoad();
  await answer(4, null);
  await f;
  assert.equal(draws.length, 3, 'and failing again is not');
  assert.equal(asks.length, 5);
});

test('ovMosaic: one day formatter, and the same mosaic while the activity and the day are unchanged', () => {
  // count the formatters the page makes and the days they format, and set the clock
  let made = 0, formatted = 0, now = Date.parse('2026-11-17T12:00:00Z');
  const RealDTF = Intl.DateTimeFormat;
  const { ctx } = helloCtx({
    Intl: { DateTimeFormat: function (...a) { made++; const f = new RealDTF(...a); return { format: (d) => { formatted++; return f.format(d); } }; } },
    Date: class extends Date { constructor(...a) { if (a.length) super(...a); else super(now); } static now() { return now; } },
  });
  const act = Array.from({ length: 84 }, (_, i) => (i * 7) % 5);
  const m1 = ctx.ovMosaic(act);
  assert.equal((m1.match(/<i/g) || []).length, 84, '84 cells');
  assert.match(m1, /title="Nov 17: \d+ commits?"/, 'today last, by the shared formatter');
  assert.ok(made <= 1, `one formatter at most: ${made}`);
  assert.equal(formatted, 84, 'a day formatted per cell');
  assert.equal(ctx.ovMosaic([...act]), m1, 'the same activity, the same mosaic');
  assert.equal(formatted, 84, 'not formatted again');
  const act2 = [...act]; act2[83] += 1;
  assert.notEqual(ctx.ovMosaic(act2), m1, 'a changed activity draws anew');
  assert.equal(formatted, 168);
  now += 864e5;
  const m3 = ctx.ovMosaic(act2);
  assert.equal(formatted, 252, 'a new day draws anew');
  assert.match(m3, /title="Nov 18: /);
  assert.ok(made <= 1, `still one formatter: ${made}`);
});

// The score-of block alone: SCORE_TILES (label → path → the place of its %), scoreAt and scoreOf
const scoreCtx = () => {
  const ctx = vm.createContext({});
  vm.runInContext(`${block(INDEX, 'score-of')}\nthis.SCORE_TILES = SCORE_TILES; this.scoreOf = scoreOf; this.scoreAt = scoreAt;`, ctx);
  return { tiles: JSON.parse(JSON.stringify(ctx.SCORE_TILES)), of: (...a) => JSON.parse(JSON.stringify(ctx.scoreOf(...a))), at: (...a) => ctx.scoreAt(...a) };
};
const weeksOf = (xs) => xs.map((score) => ({ starts_at: '2026-01-05T00:00:00Z', score }));
const W12 = [50, 52, 55, 54, 58, 60, 61, 63, 65, 66, 70, 71.6];

test('scoreOf and SCORE_TILES: the four tiles, their places, the % and the weeks', () => {
  const S = scoreCtx();
  assert.deepEqual(S.tiles, [['autonomy score', 'autonomy_score', 'this_week'], ['trust score', 'autonomy.decisions', 'score.this_week'], ['efficiency score', 'efficiency', 'score.this_week'], ['awareness score', 'awareness', 'score.this_week']]);
  // the data tickets' shape: { score: { this_week, last_week }, weeks: [12 × { score, … }] }
  assert.deepEqual(S.of({ score: { this_week: 71.6, last_week: 70 }, weeks: weeksOf(W12) }), { pct: 72, weeks: W12 });
  // autonomy_score's: { this_week, last_week, weeks }, its % at this_week
  assert.equal(S.of({ this_week: 71.6, last_week: 70, weeks: weeksOf(W12) }, 'this_week').pct, 72);
  // autonomy.decisions has a top-level this_week that is a week record: read there, no %, never NaN
  const dec = { score: { this_week: 64, last_week: 60 }, this_week: { score: 64, decisions: 3 }, weeks: weeksOf(W12) };
  assert.equal(S.of(dec, 'this_week').pct, null);
  assert.equal(S.of(dec).pct, 64);
  // a null week, and a week record with no score, stay null
  const gappy = weeksOf(W12); gappy[3] = { starts_at: 'x', score: null }; gappy[4] = { starts_at: 'x' }; gappy[5] = null;
  assert.deepEqual(S.of({ score: { this_week: 50 }, weeks: gappy }).weeks, W12.map((x, i) => ([3, 4, 5].includes(i) ? null : x)));
  // nothing there: no %
  for (const r of [undefined, null, {}, { score: { this_week: null } }, { score: null }, { score: { this_week: '50' } }, { score: { this_week: NaN } }]) assert.equal(S.of(r).pct, null, JSON.stringify(r));
  assert.deepEqual(S.of(undefined), { pct: null, weeks: [] });
  // a % with no weeks, or weeks that are not an array: the % and no weeks
  assert.deepEqual(S.of({ score: { this_week: 50 } }), { pct: 50, weeks: [] });
  assert.deepEqual(S.of({ score: { this_week: 50 }, weeks: 'x' }), { pct: 50, weeks: [] });
  // more than 12 weeks: the last 12
  assert.deepEqual(S.of({ score: { this_week: 1 }, weeks: weeksOf([1, 2, ...W12]) }).weeks, W12);
  // the paths on an /api/data-shaped object: autonomy.decisions (not autonomy), autonomy_score's this_week
  const d = { autonomy: { score: { this_week: 11 }, decisions: { score: { this_week: 22 }, weeks: [] } }, autonomy_score: { this_week: 33, weeks: [] }, efficiency: { score: { this_week: 44 } }, awareness: { score: { this_week: 55 } } };
  assert.deepEqual(S.tiles.map(([, p, at]) => S.of(S.at(d, p), at).pct), [33, 22, 44, 55]);
  assert.equal(S.at(d, 'autonomy.nothing.here'), undefined);
  assert.equal(S.at(null, 'autonomy'), undefined);
  // only own properties: nothing up the prototype chain
  assert.equal(S.at({}, 'constructor'), undefined);
  assert.equal(S.of({ score: { this_week: 5 }, weeks: [] }, 'score.toString').pct, null);
});

// The G1 golden of /api/data: at each of the four paths, scored or not, the shape the tiles read. A
// renamed, moved or reshaped field fails here even while it serves no score.
const G1_DATA = () => {
  const t = fs.readFileSync(path.join(here, 'fixtures', 'g1', 'dashboard-data.txt'), 'utf8');
  const a = t.indexOf('--- stdout\n') + '--- stdout\n'.length, b = t.indexOf('\n--- stderr', a);
  return JSON.parse(t.slice(a, b < 0 ? undefined : b));
};
function checkScoreShapes(d, S = scoreCtx()) {
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  for (const [label, p, at] of S.tiles) {
    const rec = p.split('.').reduce((o, k) => (o && typeof o === 'object' && own(o, k) ? o[k] : undefined), d);
    assert.ok(rec && typeof rec === 'object' && !Array.isArray(rec), `${label}: ${p} is an object`);
    const parts = at.split('.');
    const holder = parts.slice(0, -1).reduce((o, k) => (o && typeof o === 'object' && own(o, k) ? o[k] : undefined), rec);
    assert.ok(holder && typeof holder === 'object' && own(holder, parts[parts.length - 1]), `${label}: ${p}.${at} is there`);
    const v = holder[parts[parts.length - 1]];
    assert.ok(v === null || (typeof v === 'number' && Number.isFinite(v)), `${label}: ${p}.${at} is a number or null: ${JSON.stringify(v)}`);
    assert.ok(Array.isArray(rec.weeks) && rec.weeks.length === 12, `${label}: ${p}.weeks is 12 weeks`);
    for (const w of rec.weeks) assert.ok(w && typeof w === 'object' && own(w, 'score'), `${label}: each week has its score`);
    const got = S.of(rec, at);
    assert.deepEqual(got.weeks, rec.weeks.map((w) => w.score), `${label}: the weeks`);
    assert.equal(got.pct, v === null ? null : Math.round(v), `${label}: the %`);
  }
}
test('SCORE_TILES on the G1 golden of /api/data: each path in the shape the tiles read', () => {
  const S = scoreCtx();
  checkScoreShapes(G1_DATA(), S);
  // and it fails on a renamed, moved or reshaped field (a scratch copy each)
  const broken = [
    ['autonomy_score renamed', (d) => { d.autonomy_score_v2 = d.autonomy_score; delete d.autonomy_score; }],
    ['decisions moved up', (d) => { d.decisions = d.autonomy.decisions; delete d.autonomy.decisions; }],
    ['efficiency\'s score an object no more', (d) => { d.efficiency.score = d.efficiency.score.this_week; }],
    ['awareness\'s % renamed', (d) => { d.awareness.score = { now: d.awareness.score.this_week }; }],
    ['autonomy_score\'s % moved under score', (d) => { d.autonomy_score.score = { this_week: d.autonomy_score.this_week }; delete d.autonomy_score.this_week; }],
    ['a week without its score', (d) => { delete d.efficiency.weeks[4].score; }],
    ['eleven weeks', (d) => { d.awareness.weeks.pop(); }],
    ['weeks renamed', (d) => { d.autonomy.decisions.history = d.autonomy.decisions.weeks; delete d.autonomy.decisions.weeks; }],
    ['a % that is a string', (d) => { d.autonomy.decisions.score.this_week = '100'; }],
  ];
  for (const [what, mutate] of broken) {
    const d = G1_DATA();
    mutate(d);
    assert.throws(() => checkScoreShapes(d, S), assert.AssertionError, what);
  }
});

// ---- the shared Chrome setup (Tasks 2–4) ----

// 14 days in kit-84's shape, oldest first, today (UTC) last: a busy day (index 5, five items), a failed
// one (index 12), quiet days, and today with two items
function upkeepDaysFixture(now = new Date()) {
  const day0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const items = (ws) => ws.map((words, i) => ({ kind: 'chore', ref: `c-${i}`, words, at: new Date(day0).toISOString() }));
  return Array.from({ length: 14 }, (_, i) => {
    const starts_at = new Date(day0 - (13 - i) * 864e5).toISOString();
    if (i === 5) return { starts_at, items: items(['a chore', 'a retro', 'a kit sync', 'a CI fix', 'a trial']), failed: false };
    if (i === 12) return { starts_at, items: items(['ran the retro']), failed: true };
    if (i === 13) return { starts_at, items: items(['fixed CI on main', 'synced the kit']), failed: false };
    return { starts_at, items: [], failed: false };
  });
}
// hello's pulse: 84 days of commits (P16), the state the header's pill shows
const pulseFixture = () => ({ state: 'waiting', activity: Array.from({ length: 84 }, (_, i) => (i * 7) % 5), last_activity: new Date(Date.now() - 120000).toISOString() });

// Run in each load before the page's own: the 10 s refresh at 300 ms and a poll counter; every POST to
// /api/ recorded; window.__patchData deep-merged into /api/data, __patchHello into /api/hello and
// __patchThreads into /api/threads (an object merges key by key, anything else replaces); and
// window.__failHello = true makes /api/hello fail (P11). The patches start as given here and a test
// changes them in the page.
function initScript({ data = {}, hello = {}, threads = {}, failHello = false } = {}) {
  return `(() => {
  const si = window.setInterval;
  window.setInterval = (f, ms, ...a) => si(f, ms === 10000 ? 300 : ms, ...a);
  window.__polls = 0;
  window.__posts = [];
  window.__patchData = ${JSON.stringify(data)};
  window.__patchHello = ${JSON.stringify(hello)};
  window.__patchThreads = ${JSON.stringify(threads)};
  window.__failHello = ${JSON.stringify(failHello)};
  const plain = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const merge = (a, b) => { if (!plain(b)) return a; for (const [k, v] of Object.entries(b)) a[k] = plain(v) && plain(a[k]) ? merge({ ...a[k] }, v) : v; return a; };
  const json = (r, body) => new Response(JSON.stringify(body), { status: r.status, statusText: r.statusText, headers: r.headers });
  const real = window.fetch;
  window.fetch = async (u, o) => {
    const url = String(u && u.url ? u.url : u);
    const method = String(o?.method || 'GET').toUpperCase();
    if (method === 'POST' && url.startsWith('/api/')) window.__posts.push({ url, body: (() => { try { return JSON.parse(o.body || 'null'); } catch { return o.body; } })() });
    if (method === 'GET' && url.startsWith('/api/hello') && window.__failHello) return new Response('{"error":"down"}', { status: 503, headers: { 'content-type': 'application/json' } });
    const r = await real(u, o);
    if (method !== 'GET' || !r.ok) return r;
    if (url.startsWith('/api/data')) { window.__polls++; return json(r, merge(await r.json(), window.__patchData)); }
    if (url.startsWith('/api/hello')) return json(r, merge(await r.json(), window.__patchHello));
    if (url.startsWith('/api/threads')) return json(r, merge(await r.json(), window.__patchThreads));
    return r;
  };
})();`;
}

// a wait on a condition in the page
const soonIn = (p, ms = 20000, server = null) => async (expr, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v, err = null;
    try { v = await p.ev(expr); } catch (e) { err = e; }
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out: ${what}${err ? `; last: ${err.message}` : ''}${server ? `; the server said, last: ${JSON.stringify(String(server()).slice(-600))}` : ''}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

// The fixture project, seeded with the kit's own commands (as supervisor, or as the owner where the owner
// acts), and log lines by hand where no command writes them (a worker's phase). Goals:
// g0 a draft being defined; g1 ready, one feature, two tickets, one in phase blocked and one held (full);
// g2 ready, one ticket blocked and one moving (partial); g3 ready, at its target, one ticket moving
// (nothing waiting); g4 met; g5 let go; g6 a draft whose design waits on the owner's approval (an open
// goal-approval question). Three open questions in all: g6's approval and two others (P14).
const XSS_MEASURE = '<img src=x id=probe-xss>';
function goalsFixture(base, name = 'overview-goals') {
  const root = bareProject(base, name);
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 48), DEVTEAM_PORT_BASE: String(PORTS + 49), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of Object.keys(env)) if (k.startsWith('DEVTEAM_') && !['DEVTEAM_HUB_PORT', 'DEVTEAM_PORT_BASE'].includes(k)) delete env[k];
  for (const k of ['TMUX', 'TMUX_PANE']) delete env[k];
  const dt = (args, role = 'supervisor') => {
    const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: root, env: role ? { ...env, DEVTEAM_ROLE: role } : env, encoding: 'utf8' });
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const mk = (args, role) => dt(args, role).split('\n')[0].trim();
  const OWNER = null;
  const reading = path.join(base, `${name}-g3-reading`);
  fs.writeFileSync(reading, '5\n');
  const full = (title, priority, check = 'echo 5', measure = 'self-serve share') => ['goal', 'add', '--title', title, '--outcome', `${title} holds`, '--measure', measure, '--target', '80', '--unit', '%', '--direction', 'up', '--source', 'prod', '--check', check, '--horizon', '2027-03-31', '--non-goals', 'enterprise invoicing', '--preconditions', 'cards work', 'prices defined', '--priority', String(priority)];
  const ms = JSON.stringify([{ title: 'Most admins pay alone', target: 80, preconditions: [1, 2], tickets: 2 }]);
  const ids = {};
  ids.g0 = mk(['goal', 'add', '--title', 'Faster onboarding', '--outcome', 'new admins set up alone']);
  ids.g1 = mk(full('Admins pay alone', 1));
  ids.g2 = mk(full('Receipts for every payment', 2));
  ids.g3 = mk(full('Invoices in one click', 3, `cat ${reading}`));
  // g6: its first precondition is "the registry is complete", so its card carries the registry attestation line
  ids.g6 = mk([...full('Refunds without support', 4), '--registry-precondition', '1']);
  // g4's measure is markup, as log text can be: the page shows it as text (never an element)
  ids.g4 = mk(full('Cards on file', 5, 'echo 5', XSS_MEASURE));
  ids.g5 = mk(full('A hosted billing page', 6));
  for (const g of ['g1', 'g2', 'g3', 'g4', 'g6']) {
    dt(['goal', 'reading', ids[g], '--run']);
    dt(['goal', 'set', ids[g], '--milestones', ms]);
  }
  for (const g of ['g1', 'g2', 'g3', 'g4']) dt(['goal', 'decide', ids[g], 'approve', '--force', '--notes', 'go'], OWNER);
  dt(['goal', 'status', ids.g4, 'met', '--force'], OWNER);
  dt(['goal', 'decide', ids.g5, 'let-go', '--notes', 'the processor\'s page covers it'], OWNER);
  dt(['goal', 'impact', ids.g1, '3', '--rationale', 'moves the number the strategy watches']);
  // g6: its design up for the owner's approval
  ids.qApprove = mk(['ask', '--kind', 'goal-approval', '--goal', ids.g6, '--question', 'Approve the refunds design?', '--links', JSON.stringify([{ title: 'The refunds design', path: 'docs/devteam/project/designs/refunds.md' }]), '--stake', '2', '--urgency', '2']);
  // the work: a feature each for g1, g2 and g3
  const feature = (slug, g) => dt(['feature', 'add', slug, '--json', JSON.stringify({ title: slug, goals: [ids[g]], design: `project/designs/${slug}.md`, notes: 'one page', preconditions: [`${ids[g]}#1`, `${ids[g]}#2`], stories: [{ id: `${slug.toUpperCase()}-S1`, text: `${slug} works`, release: 'v0.2.0' }] })]);
  const ticket = (id, feat, title) => dt(['ticket', 'add', id, '--json', JSON.stringify({ title, feature: feat, component: feat, kind: 'build', size: 'S', risk: 'normal', serves: [`${feat.toUpperCase()}-S1`], depends_on: [], touches: [`${feat}/${id}/**`], done_when: [`${title} works`] })]);
  feature('pay', 'g1'); feature('receipts', 'g2'); feature('invoices', 'g3');
  ids.t1a = 'pay-01-form'; ids.t1b = 'pay-02-capture'; ids.t2a = 'receipts-01-mail'; ids.t2b = 'receipts-02-pdf'; ids.t3a = 'invoices-01-button';
  ticket(ids.t1a, 'pay', 'the card form'); ticket(ids.t1b, 'pay', 'card capture');
  ticket(ids.t2a, 'receipts', 'mail the receipt'); ticket(ids.t2b, 'receipts', 'a receipt as a PDF');
  ticket(ids.t3a, 'invoices', 'the invoice button');
  dt(['ticket', 'set', ids.t1b, '--json', JSON.stringify({ held: 'until the processor is chosen' })]);
  // a worker's phase line, as the worker writes it (no command does): t1a and t2a are blocked
  const logDir = path.join(root, 'docs/devteam/run/log');
  fs.mkdirSync(logDir, { recursive: true });
  const T0 = Date.now();
  for (const [i, t] of [ids.t1a, ids.t2a].entries()) {
    const at = new Date(T0 - 60000 * (i + 1));
    fs.appendFileSync(path.join(logDir, `${t}.jsonl`), line({ op: 'new', type: 'phase', to: 'blocked', from: 'build', id: `h-${at.toISOString().slice(0, 10).replace(/-/g, '')}-${at.toISOString().slice(11, 23).replace(/[:.]/g, '')}-${t}`, at: at.toISOString(), by: t }));
  }
  // two more open questions
  ids.q1 = mk(['ask', '--question', 'Which processor?', '--choices', '[{"label":"Stripe"},{"label":"Adyen"}]', '--stake', '3', '--urgency', '3']);
  ids.q2 = mk(['ask', '--question', 'Keep receipts a year?', '--choices', '[{"label":"Yes"},{"label":"No"}]', '--stake', '1', '--urgency', '1']);
  // g3 reaches its target
  fs.writeFileSync(reading, '90\n');
  dt(['goal', 'reading', ids.g3, '--run']);
  return { root, env, ids, dt };
}

// /api/data shows what the fixture seeded, before any browser opens
async function checkSeeded(port, ids) {
  const d = await (await fetch(`http://127.0.0.1:${port}/api/data`)).json();
  const g = (k) => d.ooda.goals.find((x) => x.id === ids[k]);
  assert.deepEqual(['g0', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map((k) => g(k)?.status), ['draft', 'ready', 'ready', 'ready', 'met', 'abandoned', 'draft']);
  assert.ok(g('g0').check.definition.length, 'g0 is being defined');
  assert.ok(g('g3').at_target, 'g3 at its target');
  assert.ok(g('g1').impact, 'g1 has an impact');
  const t = (k) => d.tickets.find((x) => x.id === ids[k]);
  assert.equal(t('t1a').phase, 'blocked');
  assert.ok(t('t1b').held, 't1b held');
  assert.equal(t('t2a').phase, 'blocked');
  assert.equal(t('t2b').phase, null);
  assert.equal(d.questions.length, 3, 'three open questions');
  assert.ok(d.questions.some((q) => q.id === ids.qApprove && q.kind === 'goal-approval' && q.goal === ids.g6), 'g6\'s approval is open');
  assert.ok(d.upkeep, 'Upkeep');
  return d;
}

// The dashboard on the fixture, Chrome on it with the init script, at a size: { p, soon, dash, port, go,
// reload }. later is the test's cleanup(t), so all of it is stopped before the fixture is removed.
async function openOn(later, root, env, { width = 1440, height = 900, init = {} } = {}) {
  const { dash, port } = await dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: initScript(init) });
  const soon = soonIn(p, 20000, () => dash.out());
  const loaded = "!window.__old && !document.querySelector('main.waiting') && typeof DATA !== 'undefined' && !!DATA";
  // a fresh document at a head (from about:blank, so a head that differs only in its hash loads anew)
  const go = async (hash) => {
    await p.send('Page.navigate', { url: 'about:blank' });
    await soon("location.href === 'about:blank'", 'about:blank');
    await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/${hash}` });
    await soon(loaded, 'the page with its data');
  };
  // the same head, reloaded
  const reload = async () => { await p.ev('window.__old = 1'); await p.send('Page.reload'); await soon(loaded, 'the page reloaded, with its data'); };
  return { p, soon, dash, port, go, reload };
}

const CHROME = { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' };
const DATA_PATCH = () => ({ upkeep_days: upkeepDaysFixture() });

test('goals: tabs, two across, cards and Upkeep', { ...CHROME, timeout: 300000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-overview-goals-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const { root, env, ids } = goalsFixture(base);
  // a planner on g1's feature, stopped at a prompt (its waiting is read from a tmux pane, so it is given here)
  const planner = { feature: 'pay', title: 'Pay by card', goals: [ids.g1], tickets: 0, branch: 'plan/pay', window: true, problem: null, waiting: { kind: 'prompt', line: 'Do you want to proceed?' }, parked: false, last_seen: new Date().toISOString(), minutes_silent: 0, waiting_on_supervisor: [], waiting_on_owner: [], held_by: null };
  const { p, soon, port, go, reload } = await openOn(later, root, env, { init: { data: { ...DATA_PATCH(), planners: [planner] }, hello: { pulse: pulseFixture() } } });
  await checkSeeded(port, ids);
  await go('#goals');
  const card = (k) => `document.querySelector('#goals .card.goal[data-subject="goal:${k === 'upkeep' ? 'upkeep' : ids[k]}"]')`;
  await soon(`!!document.querySelector('#goals .tabbar') && !!${card('g1')} && !!${card('upkeep')}`, 'the Goals tabs and cards');

  // tabs with counts: Active is g0, g1, g2, g3, g6 and Upkeep
  assert.deepEqual(await p.ev(`[...document.querySelectorAll('#goals .tabbar [role="tab"]')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim())`), ['Active 6', 'Met 1', 'Let go 1']);
  assert.equal(await p.ev(`document.querySelector('#goals .tabbar [aria-selected="true"]').dataset.tab`), 'active');
  // Upkeep first, then the goals in priority order (g0 has none: last)
  assert.deepEqual(await p.ev(`[...document.querySelectorAll('#goals .card.goal')].map((c) => c.dataset.subject)`), ['upkeep', 'g1', 'g2', 'g3', 'g6', 'g0'].map((k) => `goal:${k === 'upkeep' ? 'upkeep' : ids[k]}`));
  // two across: each card half the grid (less the gap), equal heights in a row
  const geo = await p.ev(`(() => { const cs = [...document.querySelectorAll('#goals .card.goal')]; const grid = cs[0].parentElement; const gap = parseFloat(getComputedStyle(grid).columnGap); return { grid: grid.clientWidth, gap, isGrid: grid.classList.contains('g12'), cards: cs.map((c) => ({ w: c.getBoundingClientRect().width, h: c.offsetHeight, top: c.offsetTop, c6: c.classList.contains('c6') })) }; })()`);
  assert.ok(geo.isGrid, 'the cards sit in a .g12');
  for (const c of geo.cards) {
    assert.ok(c.c6, 'each card is .c6');
    assert.ok(Math.abs(c.w - (geo.grid - geo.gap) / 2) < 2, `a card is half the grid: ${c.w} of ${geo.grid}`);
  }
  const rows = new Map();
  for (const c of geo.cards) rows.set(c.top, [...(rows.get(c.top) || []), c]);
  assert.equal(rows.size, 3, 'six cards in three rows');
  for (const r of rows.values()) { assert.equal(r.length, 2); assert.equal(r[0].h, r[1].h, 'cards side by side are the same height'); }
  // blocked outlines
  const cls = (k) => p.ev(`[...${card(k)}.classList]`);
  assert.ok((await cls('g1')).includes('blk-full'), 'g1 fully blocked');
  assert.ok((await cls('g2')).includes('blk-partial'), 'g2 partly blocked');
  // a state badge ends in an ellipsis when it is too long for its head; its title is the whole label
  const badges = await p.ev(`[...document.querySelectorAll('#goals .card.goal:not(.upkeep) > .card-head > .badge')].map((b) => [b.title, b.textContent])`);
  assert.equal(badges.length, 5, 'a badge on each goal card');
  for (const [title, text] of badges) assert.ok(text && title === text, `the badge's title is its full label: ${JSON.stringify([title, text])}`);
  for (const k of ['g0', 'g3', 'g6', 'upkeep']) assert.ok(!(await cls(k)).some((c) => c.startsWith('blk-')), `${k} not blocked`);
  // today's head: priority first, then the impact's words
  assert.equal(await p.ev(`${card('g1')}.querySelector('.card-head .grow').textContent.trim()`), 'priority 1 · moves a number the project watches');
  assert.equal(await p.ev(`${card('g2')}.querySelector('.card-head .grow').textContent.trim()`), 'priority 2');
  // each goal card: step bar, next line, its design; Mark met only on g3
  for (const k of ['g0', 'g1', 'g2', 'g3', 'g6']) assert.ok(await p.ev(`!!${card(k)}.querySelector('ol.steps')`), `${k} has a step bar`);
  for (const k of ['g0', 'g3', 'g6']) assert.ok(await p.ev(`!!${card(k)}.querySelector('.goal-next')`), `${k} has a next line`);
  for (const k of ['g1', 'g2', 'g3', 'g6']) assert.ok(await p.ev(`[...${card(k)}.querySelectorAll('a')].some((a) => a.textContent.trim() === 'Read the design')`), `${k} links its design`);
  assert.deepEqual(await p.ev(`[...document.querySelectorAll('#goals [data-met-id]')].map((b) => b.dataset.metId)`), [ids.g3], 'Mark met only on the goal at its target');
  // its links: the planner on its feature, stuck on a prompt; and the registry attestation line
  assert.deepEqual(await p.ev(`[...${card('g1')}.querySelectorAll('.meta a[href^="#planner/"]')].map((a) => [a.getAttribute('href'), a.textContent.trim()])`), [['#planner/pay', 'planner on Pay by card']], 'g1 links its planner');
  assert.deepEqual(await p.ev(`[...${card('g1')}.querySelectorAll('.meta .badge')].map((b) => b.textContent.trim())`), ['stuck on a prompt'], 'the planner is stuck on a prompt');
  for (const k of ['g0', 'g2', 'g3', 'g6']) assert.equal(await p.ev(`${card(k)}.querySelectorAll('a[href^="#planner/"]').length`), 0, `no planner link on ${k}`);
  assert.deepEqual(await p.ev(`[...${card('g6')}.querySelectorAll('.meta')].map((m) => m.textContent.trim()).filter((t) => t.startsWith('Registry attestation'))`), ['Registry attestation: precondition 1, not asked'], 'g6 says where its registry attestation stands');
  for (const k of ['g0', 'g1', 'g2', 'g3']) assert.ok(!(await p.ev(`${card(k)}.textContent`)).includes('Registry attestation'), `no registry attestation line on ${k}`);
  // gone: hold controls (Upkeep's too), Open and Strategy links, the retro badge, the heading's sub-line
  assert.equal(await p.ev(`document.querySelectorAll('#goals [data-hold-id]').length`), 0, 'no hold control on Goals');
  assert.equal(await p.ev(`[...document.querySelectorAll('#goals a')].filter((a) => ['Open', 'Strategy'].includes(a.textContent.trim())).length`), 0, 'no Open or Strategy link');
  assert.equal(await p.ev(`!!document.querySelector('#goals #retro, #goals #strategy-link, #goals h2 .sub')`), false, 'no retro badge and no heading sub-line');
  assert.equal(await p.ev(`/\\bretro\\b/i.test(document.querySelector('#goals').textContent)`), false, 'no retro text');
  // #unassigned under the cards
  assert.ok(await p.ev(`(() => { const u = document.querySelector('#goals #unassigned'), cs = [...document.querySelectorAll('#goals .card.goal')]; return !!u && u.getBoundingClientRect().top >= Math.max(...cs.map((c) => c.getBoundingClientRect().bottom)); })()`), '#unassigned under the cards');
  // Upkeep: always on, a 14-day heartbeat, no step bar
  assert.equal(await p.ev(`${card('upkeep')}.querySelector('.card-head .grow').textContent.trim()`), 'always on');
  assert.equal(await p.ev(`${card('upkeep')}.querySelectorAll('ol.steps').length`), 0, 'Upkeep has no step bar');
  const hb = await p.ev(`[...${card('upkeep')}.querySelectorAll('.heartbeat > i')].map((i) => ({ cls: i.className, title: i.title }))`);
  assert.equal(hb.length, 14, '14 days');
  assert.match(hb[13].title, /\(today\): fixed CI on main, synced the kit$/, 'today last, its items in the hover');
  assert.equal(hb[12].cls, 'bad', 'a failed day is red');
  assert.equal(hb[5].cls, 'l4', 'a busy day is shaded');
  assert.ok(!/\bl[1-4]\b/.test(hb[0].cls) && hb[0].cls === '', 'a quiet day is empty');
  assert.match(hb[0].title, /: quiet$/);
  // the step bar is the shell's goalSteps on goalStepData, for four states
  for (const k of ['g0', 'g2', 'g3', 'g6', 'g1']) {
    assert.equal(await p.ev(`${card(k)}.querySelector('ol.steps').outerHTML`), await p.ev(`(() => { const g = DATA.ooda.goals.find((x) => x.id === ${JSON.stringify(ids[k])}); const R = DATA.ooda.roadmap; return goalSteps(goalStepData(g, goalState(g, R, DATA.questions || []), R)); })()`), `${k}'s step bar`);
  }
  const words = (k) => p.ev(`(() => { const ol = ${card(k)}.querySelector('ol.steps'); const w = (li) => li.firstChild.textContent; return { done: [...ol.querySelectorAll('li.done')].map(w), now: [...ol.querySelectorAll('li.now')].map(w) }; })()`);
  assert.deepEqual(await words('g0'), { done: [], now: ['Defining'] });
  assert.deepEqual(await words('g2'), { done: ['Defined', 'Planned', 'Approved'], now: ['Building'] });
  assert.deepEqual(await words('g6'), { done: ['Defined', 'Planned'], now: ['Waiting on you'] });
  assert.deepEqual(await words('g3'), { done: ['Defined', 'Planned', 'Approved', 'Built'], now: ['Met?'] });
  const subs = await p.ev(`[...${card('g3')}.querySelectorAll('ol.steps li')].map((li) => li.querySelector('.step-sub')?.textContent ?? null)`);
  assert.ok(subs[3] && subs[4], `Built and Met carry their lines on g3: ${JSON.stringify(subs)}`);
  assert.match(subs[4], /90 now → 80 %/);
  // colours: done is --series-1, now is amber
  const col = await p.ev(`(() => { const root = getComputedStyle(document.documentElement); const ol = ${card('g2')}.querySelector('ol.steps'); const seg = (li) => getComputedStyle(li).getPropertyValue('--seg').trim(); return { done: seg(ol.querySelector('li.done')), now: seg(ol.querySelector('li.now')), series: root.getPropertyValue('--series-1').trim(), amber: root.getPropertyValue('--amber').trim() }; })()`);
  assert.equal(col.done, col.series, 'a done step is --series-1');
  assert.equal(col.now, col.amber, 'the current step is amber');

  // Met: the hash, the cards, through polls; Back; a reload keeps Let go
  await p.click('#goals .tabbar [data-tab="met"]');
  await soon(`location.hash === '#goals?gt=met' && document.querySelector('#goals .tabbar [aria-selected="true"]')?.dataset.tab === 'met'`, 'Met selected, in the hash');
  await soon(`!!${card('g4')}`, 'the met goal\'s card');
  assert.equal(await p.ev(`document.querySelectorAll('#goals .card.goal').length`), 1, 'only the met goal');
  assert.match(await p.ev(`${card('g4')}.textContent`), /Met/);
  // its measure line shows the markup in its description as text, never as an element
  assert.ok((await p.ev(`${card('g4')}.querySelector('.goal-next').textContent`)).includes(`${XSS_MEASURE}: `), 'the measure description as text');
  assert.equal(await p.ev(`document.querySelectorAll('#probe-xss').length`), 0, 'no element made from a measure description');
  // the when is the update that set it met, not the day it was opened
  assert.equal(await p.ev(`${card('g4')}.querySelector('.card-head .grow').textContent.trim()`), await p.ev(`(() => { const g = DATA.ooda.goals.find((x) => x.id === ${JSON.stringify(ids.g4)}); return 'met ' + when([...g.updates].reverse().find((u) => u.status === 'met').at); })()`));
  const dated = await p.ev(`(() => { const R = DATA.ooda.roadmap; const mk = (status, updates) => ({ id: 'g-x', title: 'X', status, created_at: '2026-01-02T10:00:00Z', updates, readings: [], measure: {}, check: { definition: [] } }); const d = document.createElement('div'); const head = (g) => { d.innerHTML = closedGoalCardHtml(g, R, []); return d.querySelector('.card-head .grow').textContent.trim(); }; return { met: head(mk('met', [{ at: '2026-02-01T10:00:00Z', priority: 2 }, { at: '2026-03-04T10:00:00Z', status: 'met' }])), gone: head(mk('abandoned', [{ at: '2026-03-05T10:00:00Z', status: 'abandoned' }])), none: head(mk('met', [])), want: ['2026-03-04T10:00:00Z', '2026-03-05T10:00:00Z'].map(when), opened: when('2026-01-02T10:00:00Z') }; })()`);
  assert.equal(dated.met, `met ${dated.want[0]}`, 'a met card dates the update that set it met');
  assert.equal(dated.gone, `let go ${dated.want[1]}`, 'a let-go card dates the update that let it go');
  assert.equal(dated.none, '', 'no status update: no date, never the opened date');
  assert.ok(![dated.met, dated.gone].some((x) => x.includes(dated.opened)), 'never the opened date');
  assert.equal(await p.ev(`document.querySelectorAll('#goals [data-hold-id]').length`), 0);
  const at = await p.ev('window.__polls');
  await new Promise((r) => setTimeout(r, 1000));
  await soon(`window.__polls >= ${at + 3}`, 'three polls');
  assert.equal(await p.ev(`document.querySelector('#goals .tabbar [aria-selected="true"]').dataset.tab`), 'met', 'still Met after polls');
  assert.ok(await p.ev(`!!${card('g4')} && !${card('g1')}`), 'still the Met cards');
  await p.ev('history.back(); void 0');
  await soon(`location.hash === '#goals' && document.querySelector('#goals .tabbar [aria-selected="true"]')?.dataset.tab === 'active' && !!${card('g1')}`, 'Back shows Active');
  await p.ev(`location.hash = '#goals?gt=letgo'; void 0`);
  await soon(`!!${card('g5')}`, 'the let-go goal\'s card');
  await reload();
  assert.equal(await p.ev('location.hash'), '#goals?gt=letgo');
  await soon(`document.querySelector('#goals .tabbar [aria-selected="true"]')?.dataset.tab === 'letgo' && !!${card('g5')}`, 'a reload keeps Let go');
  assert.match(await p.ev(`${card('g5')}.textContent`), /Let go/);
  assert.equal(await p.ev(`${card('g5')}.querySelector('.card-head .grow').textContent.trim()`), await p.ev(`(() => { const g = DATA.ooda.goals.find((x) => x.id === ${JSON.stringify(ids.g5)}); return 'let go ' + when([...g.updates].reverse().find((u) => u.status === 'abandoned').at); })()`));
  assert.match(await p.ev(`${card('g5')}.textContent`), /processor’s page covers it|processor's page covers it/);
  // done-when 3 as written: a reload at #goals?gt=met shows Met
  await p.ev(`location.hash = '#goals?gt=met'; void 0`);
  await soon(`!!${card('g4')}`, 'the met goal\'s card again');
  await reload();
  assert.equal(await p.ev('location.hash'), '#goals?gt=met');
  await soon(`document.querySelector('#goals .tabbar [aria-selected="true"]')?.dataset.tab === 'met' && !!${card('g4')} && !${card('g1')}`, 'a reload keeps Met');
});

// Overview's ten tiles, in the mock's STATS order; bugs merged only with a production sensor
const NUMBERS = ['done', 'forecast finish', 'workers active', 'blocked', 'median cycle', 'cost per ticket', 'spend', 'open questions', 'answer rate (14d)', 'bugs merged'];
const BUGS_TIP = 'A production error traced to a merged change, or one you reported. Shown once the project has a production sensor.';
const AUTONOMY_TIP = 'The mean of the Trust, Efficiency and Awareness Scores, weighted equally; – until all three exist';
// the four score fields as a test reads them, on its own (not the page's table): [label, path, place of its %]
const SCORES = [['autonomy score', ['autonomy_score'], ['this_week']], ['trust score', ['autonomy', 'decisions'], ['score', 'this_week']], ['efficiency score', ['efficiency'], ['score', 'this_week']], ['awareness score', ['awareness'], ['score', 'this_week']]];
const dig = (o, ks) => ks.reduce((a, k) => (a && typeof a === 'object' ? a[k] : undefined), o);
// a patch of /api/data that sets the four fields, as merged by the init script: { autonomy_score, autonomy: { decisions }, efficiency, awareness }
const scorePatch = (recs) => ({ autonomy_score: recs[0], autonomy: { decisions: recs[1] }, efficiency: recs[2], awareness: recs[3] });

test('overview: header, sections, numbers, autonomy, goals, needs you, commit history', { ...CHROME, timeout: 300000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-overview-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const { root, env, ids } = goalsFixture(base, 'overview-page');
  // hello fails until the test lets it answer (P11); a worker cap so Workers reads "n of cap"
  const { p, soon, port, go } = await openOn(later, root, env, { init: { data: { ...DATA_PATCH(), caps: { max_active_tickets: 3 } }, hello: { pulse: pulseFixture() }, failHello: true } });
  const served = await checkSeeded(port, ids);
  await go('#overview');
  const OV = "document.querySelector('#overview')";
  await soon(`!!${OV}.querySelector('.ov-head h2') && !!${OV}.querySelector('.sec')`, 'the Overview header and sections');
  assert.equal(await p.ev(`${OV}.classList.contains('no-shell')`), false, 'Overview is on the shell');

  // the header: name, summary, the status pill at the far right; unknown until hello answers
  const head = `${OV}.querySelector('.ov-head')`;
  assert.equal(await p.ev(`${head}.querySelector('h2').textContent`), 'overview-page');
  assert.equal(await p.ev(`${head}.lastElementChild.innerHTML`), await p.ev(`statusPill('unknown')`), 'unknown while hello fails');
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(await p.ev(`${head}.lastElementChild.innerHTML`), await p.ev(`statusPill('unknown')`), 'still unknown through polls while hello fails');
  await p.ev('window.__failHello = false');
  await soon(`${head}.lastElementChild.innerHTML === statusPill('waiting')`, 'the pill once hello answers');
  assert.ok(await p.ev(`${head}.lastElementChild.classList.contains('ov-pill')`));
  // a failed hello after an answer: unknown again (spec §1), then waiting once it answers again
  await p.ev('window.__failHello = true');
  await soon(`${head}.lastElementChild.innerHTML === statusPill('unknown')`, 'the pill once hello fails again');
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(await p.ev(`${head}.lastElementChild.innerHTML`), await p.ev(`statusPill('unknown')`), 'still unknown through polls while hello fails');
  await p.ev('window.__failHello = false');
  await soon(`${head}.lastElementChild.innerHTML === statusPill('waiting')`, 'waiting once hello answers again');
  const sum = await p.ev(`${head}.querySelector('.sum').textContent`);
  assert.match(sum, /^\d+ questions? · \d+ tickets? in flight$/);
  assert.match(sum, /^3 questions · 2 tickets in flight$/, 'three open questions; t1a and t2a are in flight');
  const edge = await p.ev(`(() => { const h = ${head}, pill = h.lastElementChild.firstElementChild; return { h: h.getBoundingClientRect().right, p: pill.getBoundingClientRect().right }; })()`);
  assert.ok(Math.abs(edge.h - edge.p) < 1, `the pill's right edge meets the header's: ${JSON.stringify(edge)}`);

  // the sections, in order, each label monospace
  const labels = await p.ev(`[...${OV}.querySelectorAll('.sec > .lbl')].map((l) => ({ t: l.textContent, f: getComputedStyle(l).fontFamily }))`);
  assert.deepEqual(labels.map((l) => l.t), ['Status', 'Numbers', 'Autonomy', 'Goals', 'Needs you', 'Commit history']);
  for (const l of labels) assert.match(l.f, /monospace/, `${l.t} is monospace`);
  // the down banner stays, above the sections
  assert.ok(await p.ev(`(() => { const b = document.getElementById('down-banner'); return ${OV}.contains(b) && !!(b.compareDocumentPosition(${OV}.querySelector('.sec')) & Node.DOCUMENT_POSITION_FOLLOWING); })()`), 'the down banner above the sections');
  const secOf = (name) => `[...${OV}.querySelectorAll('.sec')].find((s) => s.querySelector('.lbl').textContent === ${JSON.stringify(name)})`;

  // Status: Supervisor from /api/threads' question as askSet keeps it (P12), else hello's last activity
  const row = (name) => p.ev(`(() => { const r = [...${secOf('Status')}.querySelectorAll('.rowline')].find((x) => x.querySelector('.t').textContent === ${JSON.stringify(name)}); return r ? { r: r.querySelector('.r').textContent, dot: r.querySelector('.dot').className } : null; })()`);
  assert.deepEqual(await p.ev(`[...${secOf('Status')}.querySelectorAll('.rowline .t')].map((x) => x.textContent)`), ['Supervisor', 'Workers', 'Planners', 'Sensors']);
  // hello's last activity two minutes before now (the fixture's was set before the project was seeded)
  await p.ev(`window.__patchHello.pulse.last_activity = new Date(Date.now() - 120000).toISOString(); void 0`);
  await soon(`/^last moved 2 min ago$/.test(${secOf('Status')}.querySelector('.rowline .r').textContent)`, 'the green last-moved line');
  assert.equal((await row('Supervisor')).dot, 'dot green');
  await p.ev(`window.__patchThreads = { supervisor: { question: { kind: 'dialog', digest: 'dg-1', text: 'Allow this command?' } } }`);
  await soon(`ASK.q?.digest === 'dg-1' && ${secOf('Status')}.querySelector('.rowline .r').textContent === 'stopped at a prompt'`, 'a dialog: stopped at a prompt');
  assert.equal((await row('Supervisor')).dot, 'dot red');
  await p.ev(`window.__patchThreads = { supervisor: { question: { kind: 'limit', digest: 'dg-2', text: 'Usage limit reached' } } }`);
  await soon(`${secOf('Status')}.querySelector('.rowline .r').textContent === 'at a usage limit'`, 'a usage limit');
  assert.equal((await row('Supervisor')).dot, 'dot amber');
  await p.ev(`window.__patchThreads = { supervisor: { question: null } }`);
  await soon(`/^last moved /.test(${secOf('Status')}.querySelector('.rowline .r').textContent)`, 'none: the green line again');
  assert.equal((await row('Supervisor')).r, 'last moved 2 min ago');
  assert.equal((await row('Workers')).r, '2 of 3');
  const planners = await p.ev('DATA.planners.length');
  assert.equal((await row('Planners')).r, planners ? `${planners} planning` : 'none');
  assert.equal((await row('Sensors')).r, 'none');

  // Numbers: the mock's order, nine without a production sensor; no score among them
  const tiles = () => p.ev(`[...${secOf('Numbers')}.querySelectorAll('.stats > .stat')].map((s) => ({ k: s.querySelector('.k').textContent.trim(), v: s.querySelector('b').textContent, title: s.getAttribute('title'), c2: s.classList.contains('c2'), info: !!s.querySelector('.k .icon-info') }))`);
  let ts = await tiles();
  assert.deepEqual(ts.map((x) => x.k), NUMBERS.slice(0, 9));
  for (const x of ts) assert.ok(x.c2, `${x.k} is .c2`);
  assert.equal(ts.find((x) => x.k === 'open questions').v, '3');
  assert.equal(ts.find((x) => x.k === 'workers active').v, '2/3');
  await p.ev(`window.__patchData.sensors = [{ name: 'web', kind: 'http', url: 'https://example.test', state: 'up', today: { events: 0, qualified: 0 }, fingerprints: 0 }]`);
  await soon(`${secOf('Numbers')}.querySelectorAll('.stats > .stat').length === 10`, 'ten tiles with a production sensor');
  ts = await tiles();
  assert.deepEqual(ts.map((x) => x.k), NUMBERS);
  assert.equal(ts[9].title, BUGS_TIP, 'bugs merged carries the hover');
  assert.ok(ts[9].info, 'and an info icon');
  assert.equal(ts[9].v, String(served.metrics.escaped_defects));
  assert.ok(!ts.some((x) => /score/i.test(x.k)), 'no score in Numbers');
  assert.equal((await row('Sensors')).r, '1 of 1 up');

  // Autonomy, unpatched: each tile reads exactly what /api/data serves at its path
  const auto = () => p.ev(`[...${secOf('Autonomy')}.querySelectorAll('.stats > .stat')].map((s) => ({ k: s.querySelector('.k').textContent.trim(), v: s.querySelector('b').textContent, title: s.getAttribute('title'), c3: s.classList.contains('c3'), info: !!s.querySelector('.k .icon-info'), svg: s.querySelector('svg.sparkline') ? { d: s.querySelector('svg.sparkline path').getAttribute('d'), aria: s.querySelector('svg.sparkline').getAttribute('aria-label'), n: s.querySelectorAll('svg.sparkline').length } : null }))`);
  let as = await auto();
  assert.deepEqual(as.map((x) => x.k), SCORES.map(([l]) => l));
  for (const x of as) assert.ok(x.c3, `${x.k} is .c3`);
  for (const [i, [label, at, place]] of SCORES.entries()) {
    const v = dig(dig(served, at), place);
    assert.equal(as[i].v, typeof v === 'number' ? `${Math.round(v)}%` : '–', `${label} reads ${at.join('.')}.${place.join('.')}: ${JSON.stringify(v)}`);
  }
  assert.equal(as[0].title, AUTONOMY_TIP, 'Autonomy Score carries the mean hover');
  assert.ok(as[0].info, 'and an info icon');
  // all four null: – and no line
  await p.ev(`Object.assign(window.__patchData, ${JSON.stringify(scorePatch([null, null, null, null]))})`);
  await soon(`[...${secOf('Autonomy')}.querySelectorAll('.stats > .stat b')].every((b) => b.textContent === '–') && !${secOf('Autonomy')}.querySelector('svg.sparkline')`, 'four dashes, no lines');
  // the four records in the data tickets' shapes, the served week records with their scores set: distinct weeks per field
  const scores = [70, 81, 62, 55].map((tw, f) => Array.from({ length: 12 }, (_, i) => (i === 11 ? tw : 20 + f * 10 + ((i * (f + 3)) % 17))));
  const rec = (f, xs) => {
    const s = dig(served, SCORES[f][1]) || {};
    const weeks = (s.weeks || Array.from({ length: 12 }, () => ({}))).map((w, i) => ({ ...w, score: xs[i] }));
    return f === 0 ? { this_week: xs[11], last_week: xs[10], weeks } : { ...s, score: { this_week: xs[11], last_week: xs[10] }, weeks };
  };
  await p.ev(`Object.assign(window.__patchData, ${JSON.stringify(scorePatch(scores.map((xs, f) => rec(f, xs))))})`);
  await soon(`[...${secOf('Autonomy')}.querySelectorAll('.stats > .stat b')].map((b) => b.textContent).join() === '70%,81%,62%,55%'`, 'each its own %');
  as = await auto();
  for (const [i, x] of as.entries()) {
    assert.ok(x.svg, `${x.k} has a line`);
    assert.equal(x.svg.n, 1);
    const want = await p.ev(`(() => { const d = document.createElement('div'); d.innerHTML = spark(${JSON.stringify(scores[i])}, ${JSON.stringify(x.k)}); return d.querySelector('path').getAttribute('d'); })()`);
    assert.equal(x.svg.d, want, `${x.k}'s line is spark of its own weeks`);
    assert.equal((x.svg.d.match(/M/g) || []).length, 1, 'one run of 12');
    assert.equal(x.svg.aria, `${x.k}, the last 12 weeks`);
  }
  // weeks 3–8 null: the % and two runs at their own weeks' x, not spread, not bridged
  const gap = scores[2].map((x, i) => (i >= 3 && i <= 8 ? null : x));
  await p.ev(`window.__patchData.efficiency = ${JSON.stringify(rec(2, gap))}`);
  await soon(`(() => { const s = ${secOf('Autonomy')}.querySelectorAll('.stats > .stat')[2]; return s.querySelector('b').textContent === '62%' && (s.querySelector('svg.sparkline path')?.getAttribute('d').match(/M/g) || []).length === 2; })()`, 'the gap breaks the line');
  const runs = (await auto())[2].svg.d.split('M').filter(Boolean).map((r) => r.split('L').map((pt) => +pt.split(',')[0]));
  const X = (i) => +(1 + (i * 78) / 11).toFixed(1);
  assert.deepEqual([...new Set(runs[0])], [0, 1, 2].map(X), 'the first run at weeks 0–2');
  assert.deepEqual([...new Set(runs[1])], [9, 10, 11].map(X), 'the second at weeks 9–11');
  // one scored week: the %, no line
  const one = Array.from({ length: 12 }, (_, i) => (i === 11 ? 55 : null));
  await p.ev(`window.__patchData.awareness = ${JSON.stringify(rec(3, one))}`);
  await soon(`(() => { const s = ${secOf('Autonomy')}.querySelectorAll('.stats > .stat')[3]; return s.querySelector('b').textContent === '55%' && !s.querySelector('svg.sparkline'); })()`, 'one scored week: no line');
  // only autonomy.decisions: Trust shows its %, the others –
  await p.ev(`Object.assign(window.__patchData, ${JSON.stringify(scorePatch([null, rec(1, scores[1]), null, null]))})`);
  await soon(`[...${secOf('Autonomy')}.querySelectorAll('.stats > .stat b')].map((b) => b.textContent).join() === '–,81%,–,–'`, 'only Trust');

  // Goals: every active goal in priority order, the step bar Goals' cards draw, outlined when blocked
  const grows = await p.ev(`[...${secOf('Goals')}.querySelectorAll('a.ov-goal')].map((a) => ({ id: a.dataset.goal, href: a.getAttribute('href'), c6: a.classList.contains('c6'), steps: a.querySelector('ol.steps')?.outerHTML ?? null, bw: getComputedStyle(a).borderTopWidth, bc: getComputedStyle(a).borderTopColor, h: a.offsetHeight, top: a.offsetTop, cls: [...a.classList] }))`);
  assert.deepEqual(grows.map((g) => g.id), ['g1', 'g2', 'g3', 'g6', 'g0'].map((k) => ids[k]));
  // each row's state badge carries its full label as its title (the ellipsis can cut it at 720px and below)
  const rowBadges = await p.ev(`[...${secOf('Goals')}.querySelectorAll('a.ov-goal > .rowline > .badge')].map((b) => [b.title, b.textContent])`);
  assert.equal(rowBadges.length, 5, 'a badge on each row');
  for (const [title, text] of rowBadges) assert.ok(text && title === text, `the row badge's title is its full label: ${JSON.stringify([title, text])}`);
  for (const g of grows) {
    assert.ok(g.c6, 'a row is .c6');
    assert.equal(g.href, `#goal/${encodeURIComponent(g.id)}`);
    assert.equal(g.bw, '1px', 'a 1px border');
    assert.equal(g.steps, await p.ev(`document.querySelector('#goals .card.goal[data-subject="goal:${g.id}"] ol.steps').outerHTML`), 'the same step bar as Goals\' card');
  }
  const probe = (css) => p.ev(`(() => { const e = document.createElement('div'); e.style.cssText = 'border:1px solid ' + ${JSON.stringify(css)}; document.body.append(e); const c = getComputedStyle(e).borderTopColor; e.remove(); return c; })()`);
  const by = (k) => grows.find((g) => g.id === ids[k]);
  assert.equal(by('g3').bc, await probe('var(--line)'), 'an unblocked row is --line');
  assert.equal(by('g1').bc, await probe('color-mix(in srgb, var(--red) 45%, var(--line))'), 'fully blocked: the muted red');
  assert.equal(by('g2').bc, await probe('color-mix(in srgb, var(--amber) 55%, var(--line))'), 'partly blocked: the muted amber');
  assert.notEqual(by('g1').bc, by('g3').bc);
  assert.ok(by('g1').cls.includes('blk-full') && by('g2').cls.includes('blk-partial'));
  const gr = new Map();
  for (const g of grows) gr.set(g.top, [...(gr.get(g.top) || []), g]);
  for (const r of gr.values()) if (r.length === 2) assert.equal(r[0].h, r[1].h, 'rows side by side are the same height');
  assert.equal([...gr.values()].filter((r) => r.length === 2).length, 2, 'two across');

  // Needs you: the open questions in /api/data's order (P14: three), the Next chip on the first only
  const qs = await p.ev(`[...${secOf('Needs you')}.querySelectorAll('.rowline')].map((r) => ({ href: r.getAttribute('href'), chip: r.querySelectorAll('.chip-next').length, t: r.querySelector('.t').textContent }))`);
  const order = await p.ev('DATA.questions.map((q) => q.id)');
  assert.equal(order.length, 3);
  assert.deepEqual(qs.map((q) => q.href), order.map((id) => `#q/${encodeURIComponent(id)}`));
  assert.deepEqual(qs.map((q) => q.chip), [1, 0, 0]);
  assert.equal(await p.ev(`${OV}.querySelectorAll('.chip-next').length`), 1, 'one Next chip on Overview');
  assert.equal(await p.ev('NEXT_ID()'), order[0]);
  // in the whole document, two: this row's and the Inbox tab's card for NEXT_ID() (drawn while the tab is shut)
  assert.deepEqual(await p.ev(`[...document.querySelectorAll('.chip-next')].map((c) => c.closest('#overview .rowline') ? 'row' : c.closest('#th-inbox .qcard')?.dataset.qcard ?? 'elsewhere')`), ['row', order[0]], 'two Next chips in the document');
  assert.equal(await p.ev(`${OV}.querySelector('.chip-next').textContent`), 'Next');

  // Commit history: no caption, the section's body wide, a column a week (12 for hello's 84 days)
  const mo = await p.ev(`(() => { const s = ${secOf('Commit history')}, b = s.querySelector('.lbl').nextElementSibling, m = b.querySelector('.mosaic'); return m ? { cols: getComputedStyle(m).gridTemplateColumns.split(' ').length, rows: getComputedStyle(m).gridTemplateRows.split(' ').length, cells: m.children.length, w: m.getBoundingClientRect().width, bw: b.getBoundingClientRect().width, kids: b.children.length, text: b.textContent.trim() } : null; })()`);
  assert.ok(mo, 'a mosaic');
  assert.deepEqual([mo.cols, mo.rows, mo.cells], [12, 7, 84]);
  assert.ok(Math.abs(mo.w - mo.bw) < 1, `the body's width: ${mo.w} of ${mo.bw}`);
  assert.equal(mo.kids, 1, 'nothing but the mosaic');
  assert.equal(mo.text, '', 'no caption');

  // at 390px the tiles, the Autonomy row and the goal rows reflow; nothing sticks out
  await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await soon(`window.innerWidth === 390`, '390px');
  await new Promise((r) => setTimeout(r, 400));
  const over = await p.ev(`(() => { const out = []; const root = ${OV}.getBoundingClientRect(); for (const e of ${OV}.querySelectorAll('.stat, .ov-goal, .rowline, .mosaic, .sec, .ov-head')) { const r = e.getBoundingClientRect(); if (r.right > root.right + 0.5 || r.left < root.left - 0.5) out.push(e.className + ' ' + r.left + '..' + r.right); if (e.scrollWidth > e.clientWidth + 1 && !e.matches('.rowline')) out.push('scrolls: ' + e.className); } return { out, page: document.documentElement.scrollWidth }; })()`);
  assert.deepEqual(over.out, [], 'nothing wider than the page');
  assert.ok(over.page <= 390, `no sideways scroll: ${over.page}`);
});

test('overview: no goals and no questions say None, and no Next chip', { ...CHROME, timeout: 300000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-overview-none-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const root = bareProject(base, 'overview-empty');
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 48), DEVTEAM_PORT_BASE: String(PORTS + 49), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of Object.keys(env)) if (k.startsWith('DEVTEAM_') && !['DEVTEAM_HUB_PORT', 'DEVTEAM_PORT_BASE'].includes(k)) delete env[k];
  for (const k of ['TMUX', 'TMUX_PANE']) delete env[k];
  // whatever init asks is patched away: no open questions
  const { p, soon, port, go } = await openOn(later, root, env, { init: { data: { questions: [] } } });
  const d = await (await fetch(`http://127.0.0.1:${port}/api/data`)).json();
  assert.equal(d.ooda.goals.length, 0, 'no goals');
  await go('#overview');
  const OV = "document.querySelector('#overview')";
  await soon(`!!${OV}.querySelector('.sec')`, 'the sections');
  const body = (name) => p.ev(`[...${OV}.querySelectorAll('.sec')].find((s) => s.querySelector('.lbl').textContent === ${JSON.stringify(name)}).querySelector('.lbl').nextElementSibling.textContent.trim()`);
  assert.equal(await body('Goals'), 'None');
  assert.equal(await body('Needs you'), 'None');
  assert.equal(await p.ev(`document.querySelectorAll('.chip-next').length`), 0, 'no Next chip in the page');
  assert.equal(await p.ev('NEXT_ID()'), null);
  assert.match(await p.ev(`${OV}.querySelector('.ov-head .sum').textContent`), /^0 questions · 0 tickets in flight$/);
});

// the peek's first properties list (its own rows; Computed is the second) and its section cards
const PEEK_KEYS = "[...(document.querySelector('#drawer-body section.attrs > dl.props')?.children ?? [])].filter((x) => x.tagName === 'DT').map((x) => x.textContent.trim())";
const PEEK_SECTS = "[...document.querySelectorAll('#drawer-body > .psect')].map((s) => ({ gp: s.dataset.gp ?? null, head: s.querySelector('.card-head').textContent.trim() }))";
const ddOf = (key) => `[...document.querySelectorAll('#drawer-body section.attrs dt')].find((x) => x.textContent.trim() === ${JSON.stringify(key)})?.nextElementSibling`;
const AT_REST = "(() => { const d = document.getElementById('drawer'); return !d.hidden && getComputedStyle(d).transform === 'none' && !d.getAnimations().some((a) => a.transitionProperty === 'transform'); })()";
const GOAL_KEYS = ['ID', 'Status', 'Hold', 'Priority', 'Why it matters', 'Milestones', 'Measured by', 'Opened', 'How it changes'];

test('goal peek and Upkeep peek', { ...CHROME, timeout: 300000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-goal-peek-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const { root, env, ids } = goalsFixture(base, 'goal-peek');
  const { p, soon, port, go } = await openOn(later, root, env, { init: { data: DATA_PATCH(), hello: { pulse: pulseFixture() } } });
  const served = await checkSeeded(port, ids);
  const J = JSON.stringify;
  const GP = await (async () => { await go('#goals'); return p.ev('JSON.parse(JSON.stringify(GOAL_PEEK))'); })();
  assert.deepEqual(Object.keys(GP), ['goal', 'upkeep']);
  assert.equal(GP.goal[0], 'steps', 'the step bar first');
  assert.deepEqual(GP.upkeep, ['heartbeat', 'chores']);
  assert.deepEqual(await p.ev('[...GOAL_PEEK.goal, ...GOAL_PEEK.upkeep].filter((id) => typeof GOAL_PEEK_SECTIONS[id] !== \'function\')'), [], 'a builder per id');

  // Upkeep's card on Goals opens Upkeep's peek (not a "not found" one)
  await soon(`!!document.querySelector('#goals .card.goal.upkeep .heartbeat')`, 'Upkeep\'s card');
  await p.click('#goals .card.goal.upkeep .heartbeat');
  await soon(`location.hash === '#goal/upkeep' && DRAWER.kind === 'goal' && ${PEEK_KEYS}.includes('What it covers')`, 'Upkeep\'s peek from its card');
  assert.deepEqual(await p.ev(PEEK_KEYS), ['ID', 'Status', 'Hold', 'What it covers', 'How it changes'], 'running, no chores: no Held because, no Chores in flight');
  assert.match(await p.ev(`${ddOf('What it covers')}.textContent`), /^Chores, CI fixes, research, retros, kit syncs and the improvement loop’s trials and proposals\.?$|^Chores, CI fixes, research, retros, kit syncs and the improvement loop's trials and proposals\.?$/);
  // held with a reason, a chore in flight
  await p.ev(`window.__patchData.upkeep = { mode: 'park', state: 'parked', reason: 'the box is moving', by: 'owner', fleet: false, running: [], chores: [{ id: 'chore-01-tidy', title: 'tidy the worktrees', stage: 'building', phase: 'build' }] }; void 0`);
  await soon(`${PEEK_KEYS}.includes('Held because')`, 'Upkeep held');
  assert.deepEqual(await p.ev(PEEK_KEYS), ['ID', 'Status', 'Hold', 'Held because', 'What it covers', 'Chores in flight', 'How it changes']);
  assert.match(await p.ev(`${ddOf('Held because')}.textContent`), /the box is moving/);
  assert.match(await p.ev(`${ddOf('Status')}.textContent`), /Parked/);
  assert.deepEqual(await p.ev(`[...${ddOf('Hold')}.querySelectorAll('button')].map((b) => [b.textContent, b.getAttribute('aria-pressed')])`), [['Run', 'false'], ['Drain', 'false'], ['Park', 'true']], 'Run, Drain, Park; no Let go');
  assert.ok(await p.ev(`!!${ddOf('Chores in flight')}.querySelector('a[href="#ticket/chore-01-tidy"]')`));
  assert.ok(await p.ev(`!!${ddOf('How it changes')}.querySelector('[data-thread-on]')`), 'Upkeep\'s How it changes: Start a thread');
  const us = await p.ev(PEEK_SECTS);
  assert.deepEqual(us.map((s) => s.gp), GP.upkeep, 'the upkeep sections, in GOAL_PEEK.upkeep\'s order');
  const hb = await p.ev(`(() => { const s = document.querySelector('#drawer-body [data-gp="heartbeat"]'); return { cells: s.querySelectorAll('.heartbeat > i').length, text: s.textContent }; })()`);
  assert.equal(hb.cells, 14, 'the heartbeat');
  for (const w of ['fixed CI on main', 'synced the kit', 'ran the retro', 'a CI fix']) assert.ok(hb.text.includes(w), `the day items listed: ${w}`);
  assert.ok(await p.ev(`!!document.querySelector('#drawer-body [data-gp="chores"] a[href="#ticket/chore-01-tidy"]')`), 'the chores in flight');
  assert.equal(await p.ev(`document.querySelectorAll('#drawer-body select[data-impact]').length`), 0, 'no impact form on Upkeep\'s peek');
  // held with no reason, not by the fleet: Held because still shows, saying so
  await p.ev(`window.__patchData.upkeep = { mode: 'drain', state: 'draining', reason: null, by: 'owner', fleet: false, running: [], chores: [] }; void 0`);
  await soon(`${ddOf('Status')}?.textContent.includes('Draining')`, 'Upkeep draining, no reason');
  assert.deepEqual(await p.ev(PEEK_KEYS), ['ID', 'Status', 'Hold', 'Held because', 'What it covers', 'How it changes'], 'Held because whenever it is held');
  assert.equal(await p.ev(`${ddOf('Held because')}.textContent.trim()`), 'No reason given');
  await p.ev(`window.__patchData.upkeep = { mode: 'run', state: 'running', reason: null, chores: [] }; void 0`);

  // g1's peek: its record in, at rest
  const g1 = served.ooda.goals.find((g) => g.id === ids.g1);
  const dec = g1.impact.decision;
  const key = `imp:${dec}`;
  await go(`#goal/${encodeURIComponent(ids.g1)}`);
  await soon(`${PEEK_KEYS}.includes('Opened') && !document.querySelector('#drawer-body .loading') && !!document.querySelector('[data-correct="${key}"]')`, 'g1\'s peek with its record');
  await soon(AT_REST, 'the peek at rest');
  const keys = await p.ev(PEEK_KEYS);
  assert.deepEqual(keys.slice(0, GOAL_KEYS.length), GOAL_KEYS, `the property keys in order: ${keys.join(', ')}`);
  assert.ok(keys.includes('Title') && keys.indexOf('Title') > keys.indexOf('How it changes'), 'the other stored rows after');
  assert.ok(await p.ev(`!!${ddOf('How it changes')}.querySelector('[data-thread-on="goal:${ids.g1}"]')`), 'How it changes keeps Start a thread');
  assert.ok(await p.ev(`!!${ddOf('Why it matters')}.querySelector('[data-correct="${key}"]')`), 'Why it matters is the impact block');
  const sects = await p.ev(PEEK_SECTS);
  assert.equal(sects[sects.length - 1].head, 'History', 'History last');
  assert.equal(sects[sects.length - 1].gp, null);
  const gps = sects.slice(0, -1).map((s) => s.gp);
  assert.ok(gps.every(Boolean), `every other section from the goal-peek block: ${J(sects)}`);
  assert.deepEqual(gps, GP.goal.filter((id) => gps.includes(id)), 'in GOAL_PEEK.goal\'s order');
  for (const id of ['steps', 'readings', 'progress']) assert.ok(gps.includes(id), `g1 has ${id}`);
  assert.equal(gps[0], 'steps', 'the step bar first');
  assert.equal(await p.ev(`document.querySelector('#drawer-body [data-gp="steps"] ol.steps').outerHTML`), await p.ev(`(() => { const g = DATA.ooda.goals.find((x) => x.id === ${J(ids.g1)}); const R = DATA.ooda.roadmap; return goalSteps(goalStepData(g, goalState(g, R, DATA.questions || []), R)); })()`), 'the same step bar as the goal\'s card');
  assert.equal(await p.ev(`!!document.querySelector('#drawer-body [data-gp="steps"] .goal-next')`), await p.ev(`(() => { const g = DATA.ooda.goals.find((x) => x.id === ${J(ids.g1)}); return !!goalState(g, DATA.ooda.roadmap, DATA.questions || []).next; })()`), 'and its next step, when it has one');
  // Hold: Run, Drain, Park, Let go
  assert.deepEqual(await p.ev(`[...${ddOf('Hold')}.querySelectorAll('button')].map((b) => b.textContent)`), ['Run', 'Drain', 'Park', 'Let go']);

  // Why it matters: Wrong?, pick 2, a reason, Send: correct on the IMPACT DECISION's id (P15)
  await p.click(`[data-correct="${key}"]`);
  await soon(`!document.querySelector('[data-correct-form="${key}"]').hidden`, 'the correction form open');
  await p.ev(`(() => { const s = document.querySelector('select[data-impact="${key}"]'); s.value = '2'; s.dispatchEvent(new Event('change', { bubbles: true })); const r = document.querySelector('input[data-reason="${key}"]'); r.focus(); r.value = 'only one admin pays'; r.dispatchEvent(new Event('input', { bubbles: true })); })(); void 0`);
  await p.click(`[data-correct-send="${key}"]`);
  await soon(`window.__posts.some((x) => x.url === '/api/correct')`, 'the correction posted');
  assert.deepEqual(await p.ev(`window.__posts.filter((x) => x.url === '/api/correct').map((x) => x.body)`), [{ id: dec, reason: 'only one admin pays', impact: 2 }], 'correct on g1\'s impact decision, with impact 2 and the reason');
  assert.notEqual(dec, ids.g1);
  await soon('SAVING === 0', 'the correction saved');
  await p.ev('document.activeElement?.blur(); void 0');

  // Let go: Confirm let go, which survives polls and a redraw from scratch (page memory, not the DOM)
  const LG = `document.querySelector('#drawer-body [data-hold-id="${ids.g1}"][data-mode="let-go"]')`;
  await soon(AT_REST, 'the peek at rest');
  await p.click(`#drawer-body [data-hold-id="${ids.g1}"][data-mode="let-go"]`);
  await soon(`${LG}?.textContent === 'Confirm let go'`, 'Confirm let go');
  assert.equal(await p.ev(`window.__posts.filter((x) => x.url === '/api/goal-decide').length`), 0, 'nothing posted yet');
  const at = await p.ev('window.__polls');
  await new Promise((r) => setTimeout(r, 1000));
  await soon(`window.__polls >= ${at + 2}`, 'polls');
  assert.equal(await p.ev(`${LG}.textContent`), 'Confirm let go', 'still Confirm let go after polls');
  await p.ev(`(() => { LAST_HTML = ''; document.getElementById('drawer-body').innerHTML = ''; openGoal(DRAWER.id); })(); void 0`);
  assert.deepEqual(await p.ev(`[${LG}.textContent, ${LG}.classList.contains('confirm')]`), ['Confirm let go', true], 'still Confirm let go after a redraw from scratch');
  await p.click(`#drawer-body [data-hold-id="${ids.g1}"][data-mode="let-go"]`);
  await soon(`window.__posts.some((x) => x.url === '/api/goal-decide')`, 'the let-go posted');
  assert.deepEqual(await p.ev(`window.__posts.filter((x) => x.url === '/api/goal-decide').map((x) => x.body)`), [{ id: ids.g1, verdict: 'let-go' }], 'today\'s hold body');
  // the press done (a navigation while it is out asks to leave), and the server agreed
  await soon('SAVING === 0', 'the let-go saved');
  await soon(`DATA.ooda.goals.find((g) => g.id === ${J(ids.g1)}).status === 'abandoned'`, 'g1 let go');

  // a let-go goal: only Restore (parked)
  await go(`#goal/${encodeURIComponent(ids.g5)}`);
  await soon(`${PEEK_KEYS}.includes('Opened') && !!${ddOf('Hold')}`, 'g5\'s peek');
  assert.deepEqual(await p.ev(`[...${ddOf('Hold')}.querySelectorAll('button')].map((b) => b.textContent)`), ['Restore (parked)']);
  // no impact form on any other peek
  await go(`#ticket/${encodeURIComponent(ids.t1a)}`);
  await soon(`DRAWER.kind === 'ticket' && !!document.querySelector('#drawer-body section.attrs')`, 'a ticket\'s peek');
  assert.equal(await p.ev(`document.querySelectorAll('#drawer-body select[data-impact]').length`), 0, 'no impact form on a ticket\'s peek');
  await go('#goal/upkeep');
  await soon(`${PEEK_KEYS}.includes('What it covers')`, 'Upkeep\'s peek');
  assert.equal(await p.ev(`document.querySelectorAll('#drawer-body select[data-impact]').length`), 0, 'no impact form on Upkeep\'s peek');
});

test('the Next chip', { ...CHROME, timeout: 300000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-next-chip-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const { root, env, ids } = goalsFixture(base, 'next-chip');
  const { p, soon, port, go } = await openOn(later, root, env, { init: { data: DATA_PATCH(), hello: { pulse: pulseFixture() } } });
  await checkSeeded(port, ids);
  await go('#overview?th=inbox');
  await soon(`!document.getElementById('th-inbox').hidden && document.querySelectorAll('#th-inbox #questions > .qcard').length === 3 && !!document.querySelector('#overview .sec')`, 'the Inbox tab over Overview');
  const next = await p.ev('NEXT_ID()');
  const order = await p.ev('DATA.questions.map((q) => q.id)');
  assert.equal(next, order[0]);
  // the tab draws the cards in d.questions' order (S11)
  assert.deepEqual(await p.ev(`[...document.querySelectorAll('#th-inbox #questions > .qcard')].map((c) => c.dataset.qcard)`), order);
  // exactly two chips in the whole document: the first card's and Overview's first Needs you row's
  const chips = await p.ev(`[...document.querySelectorAll('.chip-next')].map((c) => ({ t: c.textContent, card: c.closest('#th-inbox .qcard')?.dataset.qcard ?? null, row: c.closest('#overview .rowline')?.getAttribute('href') ?? null }))`);
  assert.equal(chips.length, 2, `two Next chips in the document: ${JSON.stringify(chips)}`);
  assert.deepEqual(chips.map((c) => c.t), ['Next', 'Next']);
  assert.deepEqual(chips.filter((c) => c.card).map((c) => c.card), [next], 'on the card for NEXT_ID()');
  assert.deepEqual(chips.filter((c) => c.row).map((c) => c.row), [`#q/${encodeURIComponent(next)}`], 'on Overview\'s first Needs you row');
  assert.equal(await p.ev(`document.querySelector('#th-inbox [data-qcard="${next}"] .card-head .chip-next') === document.querySelector('#th-inbox [data-qcard="${next}"] .chip-next')`), true, 'in the card\'s head');
  // the card's parts as before
  const parts = await p.ev(`(() => { const c = document.querySelector('#th-inbox [data-qcard="${next}"]'); return { choices: [...c.querySelectorAll('.choices .choice b')].map((b) => b.textContent), textarea: !!c.querySelector('textarea[data-q="${next}"]'), answer: c.querySelector('[data-answer="${next}"]')?.textContent ?? null, head: !!c.querySelector('.card-head details.menu'), h4: c.querySelector('h4')?.textContent ?? '' }; })()`);
  const want = await p.ev(`(() => { const q = DATA.questions[0]; return [...choicesOf(q).map((c) => c.label), ...(['owner-action', 'goal-approval'].includes(q.kind) ? [] : ['Something else'])]; })()`);
  assert.ok(want.length >= 2);
  assert.deepEqual(parts.choices, want, 'its choices');
  assert.ok(parts.textarea, 'its textarea');
  assert.ok(['Answer', 'Send'].includes(parts.answer), `its Answer: ${parts.answer}`);
  assert.ok(parts.head && parts.h4, 'its head and question');
  // one column, the panel body's width
  const w = await p.ev(`(() => { const b = document.getElementById('th-body'), cs = getComputedStyle(b); const inner = b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); const cards = [...document.querySelectorAll('#th-inbox #questions > .qcard')].map((c) => ({ w: c.getBoundingClientRect().width, left: c.getBoundingClientRect().left })); return { inner, cards }; })()`);
  for (const c of w.cards) assert.ok(Math.abs(c.w - w.inner) < 1, `a card is the panel body's width: ${c.w} of ${w.inner}`);
  assert.equal(new Set(w.cards.map((c) => Math.round(c.left))).size, 1, 'one column');

  // a secrets card as the next question: it carries the chip and keeps Post, Reply and Can't right now
  const SQ = 'q-20261117-000000001-supervisor';
  await p.ev(`(() => { const q0 = DATA.questions[0]; const sq = { ...q0, id: ${JSON.stringify(SQ)}, kind: 'owner-action', question: 'Post the API key', context: null, choices: [], recommendation: null, default: null, links: [], goal: null, rank: null, secrets: [{ name: 'KEY', sink: 'file:secrets/key.txt', to: 'secrets/key.txt', sink_type: 'file', warning: null }], secrets_posted: [] }; window.__patchData.questions = [sq, ...RAW.questions.filter((x) => x.id !== sq.id)]; })(); void 0`);
  await soon(`NEXT_ID() === ${JSON.stringify(SQ)} && !!document.querySelector('#th-inbox [data-qcard="${SQ}"] .card-head .chip-next')`, 'the secrets card, next, with its chip');
  const sp = await p.ev(`(() => { const c = document.querySelector('#th-inbox [data-qcard="${SQ}"]'); return { first: c === document.querySelector('#th-inbox #questions > .qcard'), secret: !!c.querySelector('.secrets .secret'), post: c.querySelector('[data-post-secrets]')?.textContent ?? null, reply: c.querySelector('[data-reply]')?.textContent ?? null, cant: c.querySelector('[data-cant]')?.textContent ?? null, textarea: !!c.querySelector('textarea[data-q]') }; })()`);
  assert.deepEqual(sp, { first: true, secret: true, post: 'Post', reply: 'Reply', cant: 'Can’t right now', textarea: true }, 'the secrets card\'s parts');
  const chips2 = await p.ev(`[...document.querySelectorAll('.chip-next')].map((c) => c.closest('#th-inbox .qcard')?.dataset.qcard ?? c.closest('#overview .rowline')?.getAttribute('href') ?? 'elsewhere')`);
  assert.deepEqual(chips2.sort(), [`#q/${encodeURIComponent(SQ)}`, SQ].sort(), 'still two chips: the secrets card and the first Needs you row');
});

test('the shell blocks are untouched', () => {
  const HUB = fs.readFileSync(path.join(here, '..', 'docs', 'devteam', 'dashboard', 'hub.html'), 'utf8');
  for (const name of ['devteam-layout', 'devteam-shell-js']) assert.equal(block(INDEX, name), block(HUB, name), `${name} is byte-identical in index.html and hub.html`);
});
