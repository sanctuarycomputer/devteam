// box-health@1's fake source: the hub's answer for each state of the mock (the contract is the comment
// above boxHealthProblem in devteam.mjs). answer(state, { after }) is the whole answer, or only the
// samples and claude.points newer than after; respond(state, url) is what the route says to a request.
// Everything is worked out from NOW, so a test has the same answer every run.
import { checks } from './check.mjs';

export const NOW = '2026-11-24T18:40:00Z';
export const STATES = ['normal', 'cpu-full', 'claude-runs-out', 'few-ready', 'no-cswap', 'just-restarted', 'laptop'];
// More answers, each a normal one but for what it is named for: one for each reason without a token
// forecast (no-cswap's is the state of that name, measuring's is just-restarted) and an unknown reason,
// a top step that lasts, and the park cases beside claude-runs-out's (one enough).
export const MORE = ['no-projection', 'too-many', 'no-claude-use', 'none-measured', 'none-by-workers', 'why-unknown', 'top-step-lasts', 'park-together', 'park-not-enough', 'park-no-rate'];
// The one plain sentence the page shows for what_if.why, and for a word it doesn't know.
export const WHY = {
  'no-cswap': "Token use isn't forecast without cswap's numbers.",
  measuring: 'The token forecast needs more readings.',
  'no-projection': 'There is no token forecast now.',
  'too-many': 'The pool is too large for a forecast.',
  'no-claude-use': 'No Claude use was measured on this machine in the last hour.',
  'none-measured': "No worker's token use is measured.",
  'none-by-workers': "None of the last hour's measured Claude use is by a worker.",
};
export const WHY_OTHER = 'There is no token forecast now.';
// headroom.claude_why's: the same sentences, and its own for lasts and for a word it doesn't know.
export const CLAUDE_WHY = { ...Object.fromEntries(['no-cswap', 'measuring', 'no-projection', 'no-claude-use', 'none-by-workers'].map((k) => [k, WHY[k]])), lasts: "Claude capacity doesn't limit it." };
export const CLAUDE_WHY_OTHER = 'There is no Claude limit to state now.';
const T = Date.parse(NOW), SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR, GB = 1e9;
const at = (ms) => new Date(T + ms).toISOString().replace('.000Z', 'Z');
const round = (n, d = 2) => Number(n.toFixed(d));
const wave = (i, seed, size) => size * Math.sin(i * 0.5 + seed) * 0.5;

// What differs by state. cpu in cores; some: percent waiting for CPU; mem, disk in GB; io in percent.
const BASE = { cpu: 6.4, some: 4, throttled: 0.03, mem: 25.1, disk: 44, shrink: 0, io: 2, room: 7, byMemory: 7, byCpu: 9, claude: 'lasts', ready: 11, window: HOUR };
const SAY = {
  normal: { shrink: -0.6 },
  'cpu-full': { cpu: 11.8, some: 52, throttled: 0.88, mem: 30.3, io: 4, room: 0, byMemory: 4, byCpu: 0 },
  'claude-runs-out': { cpu: 7.1, some: 6, mem: 26, room: 0, claude: 'out' },
  'few-ready': { cpu: 4, some: 1, mem: 21.2, disk: 45, io: 1, ready: 2 },
  'no-cswap': { claude: null },
  'just-restarted': { cpu: 3.2, some: 2, mem: 9.8, io: 6, room: 9, byMemory: 9, byCpu: 12, claude: 'new', window: 12 * MIN, unknown: 'website', yet: 'ui-146-e2e' },
  laptop: { cpu: 2.1, mem: 11.2, disk: 210, claude: null, laptop: true },
};

// name, project, port, title, phase, hours, cores, GB, disk GB, new tokens an hour (thousands; null: not
// measured), so far (millions), and test runs' n, cores and GB
const WORKERS = [
  ['app-28-invoices', 'acme-app', 4322, 'Invoices keep their order', 'build', 2, 1.2, 1.6, 2.1, 520, 1.9, [1, 1.0, 0.9]],
  ['ui-805-browser-wall', 'ui-kit', 4321, 'The wall opens at the right place', 'build', 4, 0.6, 1.1, 0.4, 410, 3.2],
  ['web-41-plain-search', 'website', 4323, 'Plain search', 'final-review', 1, 0.5, 0.8, 1.2, 230, 0.6],
  ['ui-812-ci-flakes', 'ui-kit', 4321, 'Four flakes stop failing', 'plan', 0.67, 0.4, 0.7, 0.1, 190, 0.2],
  ['app-30-old-importer', 'acme-app', 4322, 'The old importer goes', 'build', 3, 0.4, 1.3, 2.0, 380, 1.4],
  ['ui-145-hand-over', 'ui-kit', 4321, 'Hand over in one step', 'build', 6, 0.3, 0.9, 0.2, 300, 4.1],
  ['ui-144-notes', 'ui-kit', 4321, 'Notes stay with their page', 'awaiting-word', 9, 0.1, 0.6, 0.2, 10, 2.2],
  ['ui-146-e2e', 'ui-kit', 4321, 'The whole path, end to end', 'spec', 0.33, 0.2, 0.6, 0.2, 120, 0.1],
  ['app-31-labels', 'acme-app', 4322, 'Labels print', 'plan', 0.5, 0.2, 0.7, 1.9, 90, 0.2],
  ['app-33-tax', 'acme-app', 4322, 'Tax by line', 'build', 1, 0.3, 0.9, 1.9, 260, 0.5],
  ['web-42-invoices', 'website', 4324, 'Invoices page', 'build', 0.83, 0.3, 0.7, 1.2, 200, 0.4],
  ['tool-12-imports', 'tools', undefined, 'Imports in batches', 'build', 2, 0.2, 0.5, 0.7, null, null],
];
// Two projects are named website, on ports 4323 and 4324; tools has no dashboard, so no port.
const PROJECTS = [['ui-kit', 4321, 1, undefined, 2.2, 5.9, 3], ['acme-app', 4322, 1, 6, 2.5, 5.8, 5], ['website', 4323, 0, 4, 0.6, 1.2, 2], ['website', 4324, 0, 4, 0.4, 0.9, 1], ['tools', undefined, 0, undefined, 0.3, 1.1, undefined]];
const RECENT = [
  ['ui-147-note-shots', 'ui-kit', 4321, 'Shots of a note', 25 * MIN, 'merged', 2.8, 0.2, 0.3, 0.8], ['app-29-header', 'acme-app', 4322, 'A header', 3 * HOUR, 'merged', 1.1, 1.9, 0.5, 1.2],
  ['web-40-footer', 'website', 4324, 'A footer', 5 * HOUR, 'parked', 0.9, 1.1, 0.1, 0.6], ['ui-810-hub-files', 'ui-kit', 4321, 'Hub files', 9 * HOUR, 'stopped', 1.7, null],
  ['tool-11-export', 'tools', undefined, 'Export', 20 * HOUR, 'held', null, null],
];

const buckets = (end, n, perHour, seed) => Array.from({ length: n }, (_, i) => ({ at: at(end - (n - i) * 10 * MIN), new: Math.max(0, Math.round(perHour / 6 * (1 + wave(i, seed, 0.6)))) }));
function tokens(hours, perHour, total, seed) {
  if (perHour === undefined) return { state: 'none-yet', reviews_new: 12000 };
  if (perHour === null) return { state: 'not-measured', reason: 'no-reader', reviews_new: 300000 };
  return { state: 'measured', new: Math.round(total * 1e6), cached: Math.round(total * 9e6), per_hour: perHour * 1000, points: buckets(0, Math.min(36, Math.max(1, Math.round(hours * 6))), perHour * 1000, seed), ...(seed === 0 ? { reviews_new: 300000 } : {}) };
}
function pool(s) {
  const seen = (o) => (s.laptop ? {} : o);
  const projects = PROJECTS.map(([name, port, planners, cap, cpu, gb, ready]) => ({
    name, ...(port ? { port } : {}), at: at(name === s.unknown && port === 4324 ? -20 * MIN : -20 * SEC), workers: WORKERS.filter((w) => w[1] === name && w[2] === port).length, planners, ...(cap ? { cap } : {}),
    ...(ready === undefined ? {} : { ready: s.ready === 2 ? (name === 'ui-kit' ? 2 : 0) : ready }), ...seen({ cpu, rss: Math.round(gb * GB) }),
  }));
  const allocated = WORKERS.map(([name, project, port, title, phase, hours, cpu, gb, disk, perHour, total, tests], i) => {
    const n = Math.min(60, Math.round(hours * 60), s.window / MIN);
    return {
      project, ...(port ? { port } : {}), name, title, phase, since: at(-hours * HOUR), ...seen({ agent: name !== 'ui-144-notes', cpu, rss: Math.round(gb * GB) }), disk: Math.round(disk * GB), disk_at: at(-6 * MIN),
      tokens: tokens(hours, s.yet === name ? undefined : perHour, total, i),
      points: Array.from({ length: n }, (_, k) => ({ at: at(-(n - k) * MIN), ...seen({ cpu: round(Math.max(0, cpu + wave(k, i, 0.2))), rss: Math.round((gb + wave(k, i, 0.1)) * GB) }), disk: Math.round(disk * GB) })),
      ...(tests && !s.laptop ? { tests: { n: tests[0], cpu: tests[1], rss: Math.round(tests[2] * GB) } } : {}),
    };
  });
  const recent = RECENT.map(([name, project, port, title, ago, why, total, disk, cpu, gb], i) => ({
    project, ...(port ? { port } : {}), name, title, left_at: at(-ago), why,
    tokens: total === null ? { state: 'not-measured', reason: i === 4 ? 'command-failed' : 'no-record' } : { state: 'measured', new: Math.round(total * 1e6), cached: Math.round(total * 8e6), per_hour: Math.round(total * 1e6 / 6), reviews_new: 20000, points: buckets(-ago, 36, total * 1e6 / 6, i) },
    ...(s.window === HOUR && disk !== null ? { last: { ...seen({ cpu, rss: Math.round(gb * GB) }), disk: Math.round(disk * GB) } } : {}),
  }));
  if (s.laptop) return { projects, allocated, recent };
  const use = (n, cpu, gb) => ({ n, cpu, rss: Math.round(gb * GB) });
  return {
    projects, allocated, recent,
    others: { planners: use(2, 0.4, 1.5), supervisors: use(4, 0.9, 3), outside: { n: 7, cpu: 0.2, rss: Math.round(2.1 * GB) }, unattributed: { cpu: 0.4 } },
    strays: [
      { project: 'website', kind: 'browser', why: 'parent-gone', n: 4, oldest_s: 10800, rss: Math.round(0.8 * GB), cpu: 0.1 },
      { project: 'acme-app', kind: 'test', why: 'folder-gone', n: 1, oldest_s: 3000, rss: Math.round(0.3 * GB), cpu: 0 },
      { kind: 'node', why: 'long-test', n: 2, oldest_s: 5400, rss: Math.round(0.2 * GB), cpu: 0.3 },
    ],
    what_if: whatIf(s),
  };
}
// Steps from 0 to 20 more: each lasts up to the most that does, then runs out sooner the more there are.
function whatIf(s) {
  const now = WORKERS.length, most = s.claude === 'out' ? 8 : 24;
  const steps = Array.from({ length: now + 21 }, (_, workers) => {
    if (s.claude === null || s.claude === 'new') return { workers };
    if (workers <= most) return { workers, lasts: true };
    const burn = (s.claude === 'out' ? 8.9 : 4) * (0.25 + 0.75 * workers / now);
    const h = Math.round(s.claude === 'out' ? 31 * 8.9 / burn : 575 / burn);
    return { workers, lasts: false, runs_out_at: at(h * HOUR), paused_until: at((s.claude === 'out' ? 39 : 92) * HOUR) };
  });
  return { now, ...(s.claude === null || s.claude === 'new' ? {} : { most_that_lasts: most }), measured: WORKERS.filter((w) => w[9] && w[0] !== s.yet).length, steps, memory_full_at: now + s.byMemory + 1, cpu_full_at: now + s.byCpu + 1, ...(s.claude === null ? { why: 'no-cswap' } : s.claude === 'new' ? { why: 'measuring' } : {}) };
}
const account = (n, week, five, reset, more = {}) => ({ n, label: `Account ${n}`, active: false, week_left: week, five_left: five, week_resets_at: at(reset), status: 'ok', ...more });
function claude(s) {
  const out = s.claude === 'out';
  const accounts = out
    ? [account(5, 66, 40, 6.75 * DAY, { active: true, five_resets_at: at(2 * HOUR) }), account(11, 52, 100, 4.2 * DAY), account(10, 47, 100, 39 * HOUR, { label: 'night shift' }), account(4, 10, 100, 5.5 * DAY), account(8, 10, 100, 5.6 * DAY), ...[1, 2, 3, 6, 7].map((n) => account(n, 0, 100, (50 + n) * HOUR)), { n: 9, label: 'Account 9', active: false, status: 'token_expired' }]
    : [account(5, 66, 72, 6.75 * DAY, { active: true, five_resets_at: at(2 * HOUR) }), account(11, 52, 100, 4.2 * DAY), account(10, 47, 100, 13 * HOUR), account(1, 70, 100, 4 * DAY), account(2, 70, 100, 4.1 * DAY), account(3, 70, 100, 4.3 * DAY)];
  if (s.claude === 'new') return { accounts, points: Array.from({ length: 12 }, (_, i) => ({ at: at((i - 11) * MIN), room: 3.75 })) };
  const [from, to] = out ? [3.6, 2.75] : [4.1, 3.75];
  const points = Array.from({ length: 360 }, (_, i) => ({ at: at((i - 359) * MIN), room: round(from + (to - from) * i / 359, 3) }));
  const line = (l) => l.map(([h, room]) => ({ at: at(h * HOUR), room }));
  if (!out) return { accounts, rate: 4, rate_hours: 6, points, projection: { lasts: true, next_reset_at: at(13 * HOUR), safe_rate: 7.1, points: line([[0, 3.75], [19, 2.9], [19, 3.9], [46, 2.6], [46, 3.6], [66, 2.7]]) }, park: [] };
  return {
    accounts, rate: 8.9, rate_hours: 6, points,
    projection: { lasts: false, runs_out_at: at(31 * HOUR), next_reset_at: at(39 * HOUR), safe_rate: 7.1, points: line([[0, 2.75], [31, 0], [39, 0], [39, 1], [50, 0], [55, 0], [55, 1], [66, 0.1]]) },
    park: [
      { fleet: 'acme-app', port: 4322, goals: [{ id: 'g-old-importer', title: 'Old importer' }], share: 0.24, enough: true },
      { fleet: 'website', port: 4323, goals: [{ id: 'g-plain-search', title: 'Plain search' }], share: 0.21, enough: true },
      { fleet: 'website', port: 4324, goals: [{ id: 'g-invoices', title: 'Invoices' }, { id: 'g-footer', title: 'Footer' }], share: 0.05, enough: false },
    ],
  };
}
function whole(state) {
  const s = { ...BASE, ...SAY[state] };
  const limit = s.laptop ? 8 : 12, max = s.laptop ? 16 * GB : 48 * GB, total = s.laptop ? 494 * GB : 246 * GB;
  const count = s.window / (5 * SEC);
  const samples = Array.from({ length: count }, (_, i) => {
    const near = 1 + wave(i / 12, 1, 0.06) * (i === count - 1 ? 0 : 1);
    return {
      at: at((i - count + 1) * 5 * SEC), cpu: round(Math.min(limit, s.cpu * near)), load: round((s.laptop ? 2.4 : 15.4) * near), mem: Math.round(s.mem * GB * near), disk: Math.round((s.disk - s.shrink * (count - 1 - i) / 720) * GB),
      ...(s.laptop ? {} : { cpu_some: round(s.some * near), throttled: round(s.throttled * near), mem_some: 0, swap: 0, inodes: 7000000, io: round(s.io * near), room: s.room }),
    };
  });
  const cores = Array.from({ length: s.laptop ? 8 : 32 }, (_, i) => round(0.35 + 0.3 * Math.sin(i * 2.3)));
  const now = s.laptop
    ? { cpu: { limit, used: s.cpu, host_cores: cores, load: [2.4, 2.2, 2.1] }, memory: { used: s.mem * GB, max, available: 4.8 * GB }, disks: [{ free: s.disk * GB, total, bytes_per_hour: 0 }] }
    : {
      cpu: { limit, used: s.cpu, host_cores: cores, shared: true, load: [15.4, 30.8, 30.3], load_scope: 'host', some60: s.some, throttled: s.throttled },
      memory: { used: Math.round(s.mem * GB), max, available: Math.round(max - s.mem * GB), ceiling: 0.8, swap_used: 0, swap_max: 0, some60: 0 },
      disks: [{ free: s.disk * GB, total, inodes_free: 7000000, inodes: 16400000, ...(s.window === HOUR ? { bytes_per_hour: s.shrink * GB } : {}) }],
      io: { some10: s.io, some60: s.io, full60: 0 },
    };
  const starts = Math.min(s.room, s.ready);
  const headroom = s.laptop ? { ready: 11, claude_why: 'no-cswap' } : {
    room: s.room, ...(s.unknown ? {} : { starts }), binds: s.ready < s.room ? 'ready' : state === 'cpu-full' ? 'cpu' : s.claude === 'out' ? 'claude' : 'memory', memory: s.byMemory, cpu: s.byCpu,
    ...(s.claude === 'out' ? { claude: 0 } : s.claude === 'lasts' ? { claude: 12 } : { claude_why: s.claude === null ? 'no-cswap' : 'measuring' }), ready: s.unknown ? s.ready - 1 : s.ready, ...(s.unknown ? { ready_unknown: [s.unknown] } : {}),
  };
  return {
    v: 1, at: NOW, window_s: 3600, now, samples, headroom, pool: pool(s), ...(s.claude === null ? {} : { claude: claude(s) }),
    box: s.laptop
      ? { started_at: at(-6 * DAY), github: { left: 4812, limit: 5000, resets_at: at(30 * MIN) }, kit: 'v0.89.0', latest: 'v0.89.0' }
      : { started_at: at(state === 'just-restarted' ? -12 * MIN : -9 * HOUR), oom_kills: 0, github: { left: 3120, limit: 5000, resets_at: at(0) }, kit: 'v0.89.0', latest: 'v0.89.0' },
  };
}
function more(name) {
  const a = whole(name.startsWith('park-') ? 'claude-runs-out' : 'normal');
  const w = a.pool.what_if, c = a.claude;
  // no token forecast: nothing that came from one
  const none = (why, claudeWhy, tokensOf) => {
    delete w.most_that_lasts;
    w.why = why;
    w.steps = w.steps.map(({ workers }) => ({ workers }));
    delete a.headroom.claude;
    a.headroom.claude_why = claudeWhy;
    if (tokensOf) for (const r of a.pool.allocated) r.tokens = tokensOf(r.tokens);
  };
  const quiet = () => { c.rate = 0; c.points = c.points.map((p) => ({ ...p, room: 3.75 })); c.projection = { lasts: true, next_reset_at: c.projection.next_reset_at, safe_rate: 7.1, points: [{ at: NOW, room: 3.75 }, { at: at(13 * HOUR), room: 3.75 }, { at: at(13 * HOUR), room: 4.28 }, { at: at(66 * HOUR), room: 4.28 }] }; };
  if (name === 'too-many') {
    none('too-many', 'lasts');
    const row = a.pool.allocated[0];
    w.now = 61; w.measured = 59; delete w.steps; w.memory_full_at = 69; w.cpu_full_at = 71;
    a.pool.projects[0].workers += 49;
    for (let i = a.pool.allocated.length; i < 60; i++) a.pool.allocated.push({ ...row, project: 'ui-kit', port: 4321, name: `ui-${900 + i}-task` });
  } else if (name === 'no-projection') {
    none(name, name);
    delete c.projection; delete c.park;
    c.accounts = c.accounts.map(({ n, label, active }) => ({ n, label, active, status: 'relogin_required' }));
  } else if (name === 'no-claude-use') { none(name, name); quiet(); } else if (name === 'none-by-workers') none(name, name);
  else if (name === 'none-measured') { none(name, 'lasts', () => ({ state: 'not-measured', reason: 'no-reader' })); w.measured = 0; } else if (name === 'why-unknown') none('some-new-reason', 'some-new-reason');
  else if (name === 'top-step-lasts') {
    w.steps = w.steps.map(({ workers }) => ({ workers, lasts: true }));
    w.most_that_lasts = w.steps.at(-1).workers;
    delete a.headroom.claude;
    a.headroom.claude_why = 'lasts';
  } else if (name === 'park-together') for (const p of c.park) { p.enough = false; p.share = { 4322: 0.12, 4323: 0.11, 4324: 0.05 }[p.port]; } else if (name === 'park-not-enough') for (const p of c.park) { p.enough = false; p.share = { 4322: 0.06, 4323: 0.04, 4324: 0.02 }[p.port]; } else {
    for (const x of c.accounts) if (x.week_left !== undefined) x.week_left = 0;
    c.points = c.points.map((p, i) => ({ ...p, room: round(0.85 * (359 - i) / 359, 3) }));
    c.projection = { lasts: false, runs_out_at: NOW, next_reset_at: at(39 * HOUR), points: [{ at: NOW, room: 0 }, { at: at(39 * HOUR), room: 0 }, { at: at(39 * HOUR), room: 1 }, { at: at(50 * HOUR), room: 0 }] };
    delete c.park; delete w.most_that_lasts;
    w.steps = w.steps.map(({ workers }) => ({ workers, lasts: false, runs_out_at: NOW, paused_until: at(39 * HOUR) }));
  }
  return a;
}
export function answer(state, { after = null } = {}) {
  if (!STATES.includes(state) && !MORE.includes(state)) throw new Error(`${state} is not a state: it should be one of ${[...STATES, ...MORE].join(', ')}`);
  const a = STATES.includes(state) ? whole(state) : more(state);
  if (after === null) return a;
  if (!checks().memoryAtOk(after)) throw new Error(`after is ${JSON.stringify(after)}: it should be a UTC time, YYYY-MM-DDTHH:MM:SSZ`);
  const t = Date.parse(after), newer = (l) => l.filter((x) => Date.parse(x.at) > t);
  a.samples = newer(a.samples);
  if (a.claude?.points) a.claude.points = newer(a.claude.points);
  return a;
}
// What the hub's route answers to a request: { status, body }.
export function respond(state, url) {
  const u = new URL(url, 'http://127.0.0.1');
  if (u.pathname !== '/box-health.json') return { status: 404, body: '' };
  const given = [...u.searchParams];
  if (given.some(([k]) => k !== 'after') || given.length > 1) return { status: 400, body: JSON.stringify({ error: 'only after is a parameter of /box-health.json' }) };
  try { return { status: 200, body: JSON.stringify(answer(state, { after: given.length ? given[0][1] : null })) }; } catch (e) { return { status: 400, body: JSON.stringify({ error: e.message }) }; }
}
