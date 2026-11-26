/* imports start */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HUB_PORT } from '../orient.mjs';
import { KIT_UPSTREAM } from '../state.mjs';
import { MEMORY_CEILING_MAX } from './memory.mjs';
import { MEMORY_CEILING_MIN } from './memory.mjs';
import { binds } from '../orient.mjs';
import { boxHealthClaude } from './health-pool.mjs';
import { boxHealthPark } from './health-pool.mjs';
import { boxHealthPool } from './health-pool.mjs';
import { boxHealthRoom } from './health-pool.mjs';
import { here } from '../state.mjs';
import { json } from '../base.mjs';
import { machineMemory } from './operator.mjs';
import { machineRepos } from '../recover.mjs';
import { memoryAtOk } from './memory.mjs';
import { memoryBase } from './memory.mjs';
import { memoryClassify } from './memory.mjs';
import { memoryIsMap } from './memory.mjs';
import { memoryNameRoots } from './memory.mjs';
import { memoryPageSize } from './memory.mjs';
import { memorySettings } from './memory.mjs';
import { memoryWords } from './memory.mjs';
import { newer } from '../box-pins.mjs';
import { out } from '../base.mjs';
import { planners } from '../panes.mjs';
import { spawn } from 'node:child_process';
/* imports end */
/* box-health-contract start */
// Two contracts' shapes as data, and a check for each. A shape is a function (value, path, whole)
// giving null or one sentence that starts with the first bad field's path and a space. It reads
// nothing outside this region and box-memory (a test runs the two alone).
export const BOX_HEALTH_MAX_BYTES = 1024 * 1024, POOL_MAX_BYTES = 256 * 1024;
// A refusal says what a field should be and never quotes text it was given: a label or a status that
// is refused may be an address, and the sentence is logged. A key is named only when it looks like a
// field's own name.
export const healthIs = (p, v, should) => `${p} is ${v === undefined ? 'missing' : v === null || typeof v === 'number' || typeof v === 'boolean' ? String(v) : typeof v === 'string' ? (v === '' ? 'empty text' : 'text it should not be') : Array.isArray(v) ? 'a list' : `a ${typeof v}`}: it should be ${should}`;
export const healthPath = (p, k) => (/^[a-z_][a-z0-9_]{0,30}$/.test(k) ? (p ? `${p}.${k}` : k) : `${p}[a key not shown]`);
export const healthLeaf = (ok, should) => (v, p) => (ok(v) ? null : healthIs(p, v, should));
export const healthNumber = (min, max, should) => healthLeaf((v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max, should);
export const healthWhole = (min, max, should) => healthLeaf((v) => Number.isSafeInteger(v) && v >= min && v <= max, should);
export const healthOneOf = (...names) => healthLeaf((v) => names.includes(v), `one of ${names.map((x) => JSON.stringify(x)).join(', ')}`);
export const healthText = (max = Infinity) => healthLeaf((v) => typeof v === 'string' && v !== '' && v.length <= max, max === Infinity ? 'text, not empty' : `text of 1 to ${max} characters`);
export const HEALTH_TIME = healthLeaf((v) => memoryAtOk(v), 'a UTC time, YYYY-MM-DDTHH:MM:SSZ, with or without milliseconds');
export const HEALTH_BOOL = healthLeaf((v) => typeof v === 'boolean', 'true or false');
export const HEALTH_TRUE = healthLeaf((v) => v === true, 'true, or left out');
export const HEALTH_AMOUNT = healthNumber(0, Infinity, 'a number, 0 or more');
export const HEALTH_SIGNED = healthNumber(-Infinity, Infinity, 'a number');
export const HEALTH_PERCENT = healthNumber(0, 100, 'a number from 0 to 100');
export const HEALTH_SHARE = healthNumber(0, 1, 'a number from 0 to 1');
export const HEALTH_COUNT = healthWhole(0, Infinity, 'a whole number, 0 or more');
export const HEALTH_PORT = healthWhole(1, 65535, 'a whole number from 1 to 65535, or left out');
export const HEALTH_PRICE = healthLeaf((v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0), 'a number, 0 or more, or null when a record has no list price');
export const healthList = (item, max = Infinity) => (v, p, whole) => {
  if (!Array.isArray(v)) return healthIs(p, v, 'a list');
  if (v.length > max) return `${p} holds ${v.length} entries: it should hold at most ${max}`;
  for (let i = 0; i < v.length; i++) { const bad = item(v[i], `${p}[${i}]`, whole); if (bad) return bad; }
  return null;
};
// An object of named fields, required then optional; any other key is refused. `rule` is checked last.
export const healthObject = (required, optional = {}, rule = null) => {
  const all = { ...required, ...optional };
  const names = Object.keys(all), shapes = Object.entries(all);
  return (v, p, whole) => {
    if (!memoryIsMap(v)) return healthIs(p, v, 'one JSON object');
    const other = Object.keys(v).find((k) => !Object.hasOwn(all, k));
    if (other !== undefined) return `${healthPath(p, other)} is not a field of ${p || 'the whole'}: it holds only ${names.join(', ')}`;
    for (const [k, shape] of shapes) {
      const x = Object.hasOwn(v, k) ? v[k] : undefined;
      if (x === undefined && Object.hasOwn(optional, k)) continue;
      const bad = shape(x, p ? `${p}.${k}` : k, whole);
      if (bad) return bad;
    }
    return rule ? rule(v, p, whole) : null;
  };
};
// The fields only a state or an outcome may carry: named when they are there without it.
export const healthOnly = (v, p, keys, when) => {
  const k = keys.find((x) => v[x] !== undefined);
  return k === undefined ? null : `${healthPath(p, k)} is there without ${when}: it should be left out`;
};
export const healthNeeds = (v, p, keys, when) => {
  const k = keys.find((x) => v[x] === undefined);
  return k === undefined ? null : `${healthPath(p, k)} is missing: ${when} has it`;
};
export const HEALTH_STATES = ['measured', 'none-yet', 'not-measured'];
export const HEALTH_REASONS = ['no-reader', 'command-failed', 'no-record'];
export const HEALTH_WHY = ['merged', 'done', 'parked', 'held', 'stopped'];
// The tokens of both contracts: `measured` are the fields a measured row has, `may` those it may have.
export const healthTokens = (points, { measured = {}, may = {}, any = {} }) => {
  const own = { new: HEALTH_COUNT, cached: HEALTH_COUNT, points: healthList(healthObject({ at: HEALTH_TIME, new: HEALTH_COUNT }), points), ...measured };
  return healthObject({ state: healthOneOf(...HEALTH_STATES) }, { reason: healthOneOf(...HEALTH_REASONS), ...own, ...may, reviews_new: HEALTH_COUNT, ...any }, (v, p) => {
    if (v.state !== 'not-measured') { const bad = healthOnly(v, p, ['reason'], 'state "not-measured"'); if (bad) return bad; }
    return v.state === 'measured' ? healthNeeds(v, p, Object.keys(own), 'a measured row') : healthOnly(v, p, [...Object.keys(own), ...Object.keys(may)], 'state "measured"');
  });
};
// A forecast that runs out says when; one that lasts doesn't.
export const healthLasts = (more) => (v, p) => (v.lasts === false ? healthNeeds(v, p, ['runs_out_at'], 'one that does not last') : healthOnly(v, p, ['runs_out_at', ...more], '"lasts": false'));
export const healthWord = (should) => healthLeaf((v) => typeof v === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(v), should);
export const HEALTH_REASON_WORD = healthWord('one lowercase word, a reason');
export const HEALTH_USE = { n: HEALTH_COUNT, cpu: HEALTH_AMOUNT, rss: HEALTH_COUNT };
export const HEALTH_ROOM_POINT = healthObject({ at: HEALTH_TIME, room: HEALTH_AMOUNT });
export const HEALTH_TOKENS = healthTokens(60, { may: { per_hour: HEALTH_AMOUNT } });
export const BOX_HEALTH_SHAPE = healthObject({
  v: healthLeaf((v) => v === 1, "1, this contract's version"),
  at: HEALTH_TIME,
  window_s: healthLeaf((v) => v === 3600, '3600, the seconds of an hour'),
  now: healthObject({}, {
    cpu: healthObject({}, {
      limit: healthLeaf((v) => typeof v === 'number' && Number.isFinite(v) && v > 0, 'a number of cores, more than 0'),
      used: HEALTH_AMOUNT, host_cores: healthList(HEALTH_SHARE), shared: HEALTH_TRUE,
      load: (v, p) => (Array.isArray(v) && v.length === 3 ? healthList(HEALTH_AMOUNT)(v, p) : healthIs(p, v, 'three numbers, over 1, 5 and 15 minutes')),
      load_scope: healthOneOf('host'), some60: HEALTH_PERCENT, throttled: HEALTH_SHARE,
    }),
    memory: healthObject({}, {
      used: HEALTH_COUNT, max: HEALTH_COUNT, available: HEALTH_COUNT,
      ceiling: healthNumber(MEMORY_CEILING_MIN, MEMORY_CEILING_MAX, `a number from ${MEMORY_CEILING_MIN} to ${MEMORY_CEILING_MAX}`),
      swap_used: HEALTH_COUNT, swap_max: HEALTH_COUNT, some60: HEALTH_PERCENT,
    }),
    disks: healthList(healthObject({ free: HEALTH_COUNT, total: HEALTH_COUNT }, { inodes_free: HEALTH_COUNT, inodes: HEALTH_COUNT, bytes_per_hour: HEALTH_SIGNED })),
    io: healthObject({}, { some10: HEALTH_PERCENT, some60: HEALTH_PERCENT, full60: HEALTH_PERCENT }),
  }),
  samples: healthList(healthObject({ at: HEALTH_TIME }, {
    cpu: HEALTH_AMOUNT, cpu_some: HEALTH_PERCENT, throttled: HEALTH_SHARE, load: HEALTH_AMOUNT, mem: HEALTH_COUNT, mem_some: HEALTH_PERCENT,
    swap: HEALTH_COUNT, disk: HEALTH_COUNT, inodes: HEALTH_COUNT, io: HEALTH_PERCENT, room: HEALTH_COUNT,
  }), 720),
}, {
  headroom: healthObject({}, {
    room: HEALTH_COUNT, starts: HEALTH_COUNT, binds: healthOneOf('memory', 'cpu', 'claude', 'ready'),
    memory: HEALTH_COUNT, cpu: HEALTH_COUNT, claude: HEALTH_COUNT, ready: HEALTH_COUNT, ready_unknown: healthList(healthText()), claude_why: HEALTH_REASON_WORD,
  }, (v, p) => (v.ready_unknown?.length ? healthOnly(v, p, ['starts'], 'every fleet known') : null) ?? (v.claude === undefined ? null : healthOnly(v, p, ['claude_why'], 'an absent claude'))),
  pool: healthObject({
    projects: healthList(healthObject({ name: healthText() }, {
      port: HEALTH_PORT, at: HEALTH_TIME, workers: HEALTH_COUNT, planners: HEALTH_COUNT, cap: HEALTH_COUNT, ready: HEALTH_COUNT, cpu: HEALTH_AMOUNT, rss: HEALTH_COUNT,
    })),
    allocated: healthList(healthObject({ project: healthText(), name: healthText(), tokens: HEALTH_TOKENS }, {
      port: HEALTH_PORT, title: healthText(80), phase: healthText(), since: HEALTH_TIME, agent: HEALTH_BOOL,
      cpu: HEALTH_AMOUNT, rss: HEALTH_COUNT, disk: HEALTH_COUNT, disk_at: HEALTH_TIME,
      points: healthList(healthObject({ at: HEALTH_TIME }, { cpu: HEALTH_AMOUNT, rss: HEALTH_COUNT, disk: HEALTH_COUNT }), 60),
      tests: healthObject({ n: HEALTH_COUNT }, { cpu: HEALTH_AMOUNT, rss: HEALTH_COUNT }),
    }), 60),
    recent: healthList(healthObject({ project: healthText(), name: healthText(), left_at: HEALTH_TIME, why: healthOneOf(...HEALTH_WHY), tokens: HEALTH_TOKENS }, {
      port: HEALTH_PORT, title: healthText(80), last: healthObject({}, { cpu: HEALTH_AMOUNT, rss: HEALTH_COUNT, disk: HEALTH_COUNT }),
    }), 20),
  }, {
    others: healthObject({}, {
      planners: healthObject({}, HEALTH_USE), supervisors: healthObject({}, HEALTH_USE), outside: healthObject({}, HEALTH_USE), unattributed: healthObject({}, { cpu: HEALTH_AMOUNT }),
    }),
    strays: healthList(healthObject({
      kind: healthOneOf('agent', 'browser', 'node', 'test'), why: healthOneOf('parent-gone', 'folder-gone', 'long-test'), n: healthWhole(1, Infinity, 'a whole number, 1 or more'),
    }, { project: healthText(), oldest_s: HEALTH_COUNT, rss: HEALTH_COUNT, cpu: HEALTH_AMOUNT }), 40),
    what_if: healthObject({ now: HEALTH_COUNT }, {
      most_that_lasts: HEALTH_COUNT, measured: HEALTH_COUNT,
      steps: healthList(healthObject({ workers: HEALTH_COUNT }, { lasts: HEALTH_BOOL, runs_out_at: HEALTH_TIME, paused_until: HEALTH_TIME }, healthLasts(['paused_until'])), 81),
      memory_full_at: HEALTH_COUNT, cpu_full_at: HEALTH_COUNT, why: HEALTH_REASON_WORD,
    }, (v, p) => (v.now > 60 ? healthOnly(v, p, ['steps'], 'a pool of at most 60 workers') : null) ?? ((v.steps ?? []).some((s) => s.lasts !== undefined) ? healthOnly(v, p, ['why'], 'every lasts left out') : null)),
  }),
  claude: healthObject({
    accounts: healthList(healthObject({
      n: healthWhole(1, Infinity, 'a slot number, 1 or more'),
      label: healthLeaf((v) => typeof v === 'string' && v !== '' && !v.includes('@'), 'text with no @ (an alias or "Account n", never an address)'),
    }, {
      active: HEALTH_BOOL, week_left: HEALTH_PERCENT, five_left: HEALTH_PERCENT, week_resets_at: HEALTH_TIME, five_resets_at: HEALTH_TIME,
      status: healthWord('one lowercase word, as cswap names it'),
    }), 40),
  }, {
    rate: HEALTH_AMOUNT, rate_hours: healthNumber(0, 6, 'a number from 0 to 6'), points: healthList(HEALTH_ROOM_POINT),
    projection: healthObject({ lasts: HEALTH_BOOL }, { runs_out_at: HEALTH_TIME, next_reset_at: HEALTH_TIME, safe_rate: HEALTH_AMOUNT, points: healthList(HEALTH_ROOM_POINT, 400) }, healthLasts([])),
    park: healthList(healthObject({ fleet: healthText(), goals: healthList(healthObject({ id: healthText(), title: healthText(80) })), share: HEALTH_SHARE, enough: HEALTH_BOOL }, { port: HEALTH_PORT })),
  }),
  box: healthObject({}, {
    started_at: HEALTH_TIME, oom_kills: HEALTH_COUNT, kit: healthText(), latest: healthText(),
    github: healthObject({ left: HEALTH_COUNT, limit: HEALTH_COUNT }, { resets_at: HEALTH_TIME }),
  }),
});
export const POOL_HOURS = { usd_hour: HEALTH_PRICE, new_hour: HEALTH_COUNT };
export const POOL_SHAPE = healthObject({
  v: healthLeaf((v) => v === 1, "1, this contract's version"),
  at: HEALTH_TIME, hour_end: HEALTH_TIME, ready: HEALTH_COUNT, planners: HEALTH_COUNT,
  goals: healthList(healthObject({ id: healthText(), title: healthText(80), ...POOL_HOURS }, { priority: healthWhole(-Infinity, Infinity, 'a whole number, or left out') }), 20),
  workers: healthList(healthObject({ name: healthText(), tokens: healthTokens(36, { measured: POOL_HOURS, any: { reviews_usd_hour: HEALTH_PRICE, reviews_new_hour: HEALTH_COUNT } }) }, {
    title: healthText(80), phase: healthText(), since: HEALTH_TIME,
    goal: (v, p, whole) => (Number.isSafeInteger(v) && v >= 0 && v < whole.goals.length ? null : healthIs(p, v, `an index into goals (${whole.goals.length} of them), or left out`)),
  }), 60),
  recent: healthList(healthObject({ name: healthText(), left_at: HEALTH_TIME, why: healthOneOf(...HEALTH_WHY), tokens: healthTokens(36, {}) }, { title: healthText(80) }), 20),
  other: healthObject(POOL_HOURS),
}, { cap: HEALTH_COUNT });
// A contract's check over a file's or a body's text, or a parsed value (measured as its JSON).
export function healthProblem(input, root, shape, max) {
  let v = input, text = input;
  if (typeof input === 'string') {
    if (healthOver(text, max)) return `${root} is over ${max} bytes: it should be at most that`;
    try { v = JSON.parse(input); } catch { return `${root} is not JSON: it should be one JSON object`; }
  }
  if (!memoryIsMap(v)) return healthIs(root, v, 'one JSON object');
  if (v.v !== 1) return healthIs('v', v.v, "1, this contract's version");
  const bad = shape(v, '', v);
  if (bad) return bad;
  if (typeof input !== 'string') {
    try { text = JSON.stringify(v); } catch { text = undefined; }
    if (typeof text !== 'string') return `${root} can't be written as JSON: it should be one JSON object`;
    if (healthOver(text, max)) return `${root} is over ${max} bytes: it should be at most that`;
  }
  return null;
}
// Over max bytes of UTF-8? A text has at least as many bytes as characters, so a long one is not counted.
export const healthOver = (s, max) => s.length > max || healthBytes(s) > max;
// UTF-8 bytes of a text, without Buffer (the region runs alone).
export function healthBytes(s) {
  let n = s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) continue;
    if (c < 0x800) n += 1;
    else if (c >= 0xd800 && c < 0xdc00 && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) < 0xe000) { n += 2; i++; } else n += 2;
  }
  return n;
}
// box-health@1, the machine's live health: what its hub answers at GET /box-health.json, through the
// gateway too, and what the Overview's strip and `machine health` read. Held in the hub's memory
// only. A field that can't be read is absent, never zero. Required: `v`, `at`, `window_s`, `now`,
// `samples`; in an object, the fields marked *. Times are UTC, YYYY-MM-DDTHH:MM:SS(.sss)Z. Bytes and
// counts are whole, 0 or more; shares are 0 to 1; percents 0 to 100; CPU is in cores. Every other
// number is 0 or more, but bytes_per_hour, which may be below zero. Text is never
// empty, and a title is at most 80 characters (UTF-16 units). A word (`status`, what_if's `why`,
// `claude_why`) is at most 40 of a-z, 0-9, _ and -, the first a letter.
//   `v`*  1     `at`*  when it was answered     `window_s`*  seconds `samples` covers: 3600, always
//   `now`*      the latest reading. `cpu`: `limit` (the box's own cap, over 0), `used`, `host_cores` (a share
//               a core), `shared` (true: `host_cores` are the host's, whose other boxes share them;
//               else absent), `load` (1, 5, 15 minutes), `load_scope` ("host": `load` is the host's;
//               with `shared`, but not checked, since a first reading has `load` and no `host_cores`),
//               `some60` (percent of the last minute some task waited), `throttled` (share of periods
//               held at the limit). `memory`: `used` (as machineMemory counts it), `max`, `available`
//               in bytes, `ceiling` (the share of max, 0.5 to 0.95, as machine-memory@1), `swap_used`,
//               `swap_max` in bytes, `some60`. `disks`, one a distinct volume holding a known root,
//               `free`* and `total`* bytes, `inodes_free`, `inodes`, `bytes_per_hour` (the change in
//               free; below zero is shrinking). `io`: `some10`, `some60`, `full60` percents.
//   `samples`*  every 5 s for an hour, oldest first, at most 720: `at`*, `cpu` cores, `cpu_some`
//               percent, `throttled`, `load` (1 minute), `mem` bytes, `mem_some` percent, `swap` bytes, `disk`
//               and `inodes` free on the first of `disks`, `io` (some60), `room`
//   `headroom`  `room` (how many more workers the box could hold: the least of `memory`, `cpu` and
//               `claude`), `starts` (the least of room and ready; absent with a name in ready_unknown),
//               `binds` ("memory", "cpu", "claude" or "ready": what limits it), `memory`, `cpu`,
//               `claude` (whole; absent when there is no Claude limit to state), `ready` (over known
//               fleets), `ready_unknown` (the names of fleets whose ready count isn't known), `claude_why`
//               (only with claude absent: the first that holds of "no-cswap", "measuring", "no-projection",
//               "no-claude-use" and "none-by-workers", each as in what_if's `why` and with its sentence,
//               then "lasts" (the top step lasts, or with no forecast the projection does: Claude
//               capacity doesn't limit it.); any other word: There is no Claude limit to state now.)
//   `pool`      the workers holding a slot, in every project:
//     `projects`*   `name`*, `port`, `at` (its pool.json's), `workers`, `planners`, `cap` (its slots;
//                   absent: no limit), `ready`, `cpu`, `rss` (all of the project's)
//     `allocated`*  at most 60: `project`*, `port`, `name`*, `title` (at most 80 characters), `phase`,
//                   `since`, `agent` (the walk sees an agent in its worktree), `cpu`, `rss`, `disk`
//                   bytes, `disk_at`, `tokens`*, `points` (one a minute for an hour, at most 60:
//                   `at`*, `cpu`, `rss`, `disk`), `tests` (its test runs, within cpu and rss: `n`*,
//                   `cpu`, `rss`)
//     `recent`*     slots that ended in the last 24 hours, newest first, at most 20: `project`*,
//                   `port`, `name`*, `title`, `left_at`*, `why`* ("merged", "done", "parked", "held" or
//                   "stopped"), `tokens`*, `last` (`cpu`, `rss`, `disk` last seen; absent after a restart)
//     `others`      the same use by role, not added to projects: `planners`, `supervisors`, `outside`
//                   (in no project), each `n`, `cpu`, `rss`; `unattributed`: `cpu`
//     `strays`      at most 40 groups: `project` (absent: in none), `kind`* ("agent", "browser",
//                   "node", "test"), `why`* ("parent-gone", "folder-gone", "long-test"), `n`*
//                   (1 or more),
//                   `oldest_s` (whole), `rss`, `cpu`
//     `what_if`     `now`* (workers holding a slot), `most_that_lasts` (absent when no step lasts; when
//                   it equals the last step's workers the page adds "or over"), `measured` (of now),
//                   `steps` (0 to now + 20, at most 81; absent with now over 60: `workers`*, `lasts`
//                   (absent with no token forecast), `runs_out_at` (always, and only, when it doesn't
//                   last), `paused_until` (only then)), `memory_full_at`, `cpu_full_at` (the first count past each),
//                   `why` (only when no step has lasts: the first of these that holds)
//                   "no-cswap" (claude is absent): Token use isn't forecast without cswap's numbers.
//                   "measuring" (under 30 minutes of burn readings): The token forecast needs more readings.
//                   "no-projection" (a burn rate, and no account or reset to project from): There is
//                   no token forecast now.
//                   "too-many" (over 60 workers hold a slot): The pool is too large for a forecast.
//                   "no-claude-use" (the hour's whole measured Claude use, every session's, is zero): No
//                   Claude use was measured on this machine in the last hour.
//                   "none-measured" (the hour has measured Claude use, and no worker is measured): No worker's
//                   token use is measured.
//                   "none-by-workers" (the hour has measured Claude use, and the measured workers and their
//                   reviewers used none): None of the last hour's measured Claude use is by a worker.
//                   Any other word: There is no token forecast now.
//                   It doesn't by itself explain an absent headroom.claude, which what_if may outlive
//                   or precede: that has `claude_why`
//   `tokens`    `state`* "measured", "none-yet" or "not-measured"; the last may carry `reason`:
//               "no-reader" (the harness has none and the project set no usage_command),
//               "command-failed" or "no-record". Only measured has `new`* (input, output and cache
//               writes), `cached`* (cached reads), `per_hour`, and `points`* (ten-minute buckets, at
//               most 60: `at`* its start, `new`*; a bucket left out is zero). Any state may have
//               `reviews_new` (its ticket's reviews so far). `recent` has the same.
//   `claude`    absent with no cswap. `accounts`*, at most 40: `n`* (1 or more), `label`* (the alias when set and
//               not an address, else "Account n"; one with an @ is refused), `active`, `week_left`,
//               `five_left` percents, `week_resets_at`, `five_resets_at`, `status` (a word).
//               `rate` (points of one account-week an hour; absent while measuring), `rate_hours` (what
//               it covers, at most 6), `points` (measured: `at`*, `room`* in accounts' worth),
//               `projection`: `lasts`*, `runs_out_at` (always, and only, when it doesn't last),
//               `next_reset_at`, `safe_rate` (absent when no rate lasts), `points` (at most 400).
//               `park`: `fleet`*, `port`, `goals`* (`id`*, `title`*), `share`* (0 to 1), `enough`*
//   `box`       `started_at`, `oom_kills` since then, `github` (`left`*, `limit`*, `resets_at`), `kit`,
//               `latest`
// `port`, on projects, allocated, recent and park rows, is the project's dashboard port from the
// hub's scan, 1 to 65535, absent with no dashboard: it keeps two projects of one name apart and
// opens a goal's page. It was added at graph review G1-11.
// GET /box-health.json?after=<time>  only newer `samples` and `claude.points`; the pool's points and
// the projection's are always whole. Any other parameter, or a bad time, is a 400. Same-origin, as
// /memory.json. Every answer is at most 1 MB (1048576 bytes of UTF-8).
// boxHealthProblem(input) takes a body's text or a parsed value: null, or one sentence starting with
// the first bad field's path (answer, for the whole). It never quotes text it was given, and names an
// unknown key only when it looks like a field's name. Order: size (a text's), JSON, object, v, then
// each object's unknown keys, its fields in order and what goes with what; a value's size is last.
// What goes with what: no `starts` with a name in `ready_unknown`; no `claude_why` beside `claude`; no
// `steps` with what_if's `now` over 60; no `why` beside a step's `lasts`; `runs_out_at` and
// `paused_until` by `lasts`; a tokens row's fields by its `state`. Limits on a number, a text or a
// list are checked too. What a field means (an order, a least, how many steps,
// when a reading is absent) is the producer's to keep: the check is of shape only, adds nothing up,
// compares no times and can't see the machine. A new field is box-health@2; a new
// word for `why` or `claude_why` is not, and a page shows its fallback sentence for one.
export function boxHealthProblem(input) {
  return healthProblem(input, 'answer', BOX_HEALTH_SHAPE, BOX_HEALTH_MAX_BYTES);
}
// pool@1, a project's worker pool: run/cache/pool.json, written by its supervisor's `metrics` and read
// by the machine's hub, across projects and kit releases. Required: every field but those marked ?.
// Times are as box-health@1's. Counts are whole, 0 or more; dollars 0 or more; text is never empty; a
// title is at most 80 characters.
//   `v`  1     `at`  when it was written     `hour_end`  the end of the hour the hours below cover
//   `cap`?      max_active_tickets; absent: no limit
//   `ready`     the count behind idle-capacity     `planners`  running now
//   `goals`     at most 20: `id`, `title` (at most 80 characters), `priority`? (whole, of
//               either sign), `usd_hour`, `new_hour`
//   `workers`   those holding a slot, at most 60; past 60 they are in `other`: `name`, `title`?, `goal`?
//               (an index into goals; absent for none), `phase`?, `since`?, `tokens`
//   `recent`    slots that ended in 24 hours, newest first, at most 20: `name`, `title`?, `left_at`,
//               `why` ("merged", "done", "parked", "held" or "stopped"), `tokens`
//   `other`     `usd_hour`, `new_hour` of every other session: supervisors, planners, the responder,
//               ended sessions, and reviewers of no listed worker
//   `tokens`    `state` "measured", "none-yet" or "not-measured", and `reason`? with the last, as in
//               box-health@1. Only measured has `new`, `cached`, `points` (ten-minute buckets over six
//               hours, at most 36: `at` its start, `new`) and, in workers, `usd_hour` and `new_hour`.
//               Any state may have `reviews_new` (the ticket's reviews so far, any provider) and, in
//               workers, `reviews_usd_hour` and `reviews_new_hour` (its reviewers' hour). `recent` has
//               no hour fields: an ended session's hour is in `other`.
// `usd_hour` and `new_hour` hold Claude models' records only, since they share Claude's limits;
// `usd_hour` (and `reviews_usd_hour`, priced the same) is null when any record of the hour has no list
// price. `new` and `points` hold every provider's. A worker's hours leave its reviewers' out. A goal's
// usd_hour and new_hour are its workers', their reviewers', its planners' and its ended sessions'
// hours. The whole hour is the workers, their reviewers and `other`: `goals` is a second view of the
// same use, never added to it (design review F7-1).
// A file is at most 256 KB (262144 bytes of UTF-8). The hub drops one poolProblem refuses, and treats
// that project as unknown. poolProblem(input) takes the file's text or a parsed value and answers as
// boxHealthProblem does, with pool for the whole. A new field is pool@2.
export function poolProblem(input) {
  return healthProblem(input, 'pool', POOL_SHAPE, POOL_MAX_BYTES);
}
/* box-health-contract end */
/* box-health-sampler start */
// The hub's sampler: every 5 s one sample of the machine, an hour of them (at most 720) in this
// process's memory only, served at GET /box-health.json (box-health@1, above). Nothing is written.
//
// The switch is the port, as findCswap's is. The machine's own hub is the one on 4320, and a fixture's
// is on any other, so with DEVTEAM_BOX_HEALTH unset or empty it samples on 4320 only, and no test
// helper has to turn it off. A hub run by hand on another port needs DEVTEAM_BOX_HEALTH=on. Any other
// value (off) is off, on 4320 too. Off: no timer, no child, no part is called, and the route is the
// hub's 404. DEVTEAM_MEMORY_RECORD plays no part in it.
//
// A part is one object in a region of its own, { start(ctx), part(ctx, parts), stop() }, in the order
// of boxHealthParts: processes, disk, state, pool, claude, park, room.
//   start(ctx)        once, when the hub first listens, before the first tick. It starts its own
//                     intervals (ctx.every) and reads nothing slow itself
//   part(ctx, parts)  once a tick (5 s), never for a request, after the parts before it, synchronous:
//                     slow work is done in an interval and its last result given here. `parts` is a
//                     fresh object: now (this tick's reading, as in the answer), sample (this tick's,
//                     with what the parts before added), samples (the hour, oldest first, this tick's
//                     last), and each part before it by its name, what that part returned. Read only.
//                     It returns undefined (absent: nothing of it in the answer), or an object with
//                     anything the parts after it need, and, for the answer itself, any of:
//       answer        { headroom, pool, claude, box }, each an object of that section's fields. A
//                     section's fields are joined in the order of the parts, a later part's winning.
//                     pool and claude are there only when a part has given what they require (pool:
//                     projects, allocated and recent; claude: accounts); fields a part adds to a
//                     section no part before it gave are left out with it
//       sample        fields joined into this tick's sample ({ room }); one the sampler or an earlier part set is kept
//                     Each is checked against box-health@1 alone, once for each new object, and a copy
//                     of it is what is sent: one that is refused is left out and said. So return a new
//                     object when anything in it changed (a change to one already returned is never
//                     seen), and the same one when nothing did
//   stop()            once, when the hub closes; not called for a part that was never started. Its
//                     timers are cleared for it. start can follow (a dashboard whose hand-over failed
//                     serves the hub again) with a new ctx: keep nothing of the stopped run.
//                     A child's own limit (ctx.timeout) goes too, so stop kills the child
// A part that fails (a throw, or a promise start, part, stop or a timer returns that rejects) is said
// once for each of those in the hub's log and costs only itself: its start's failure leaves it out for
// good, its part's for that tick. The log gets the error's kind and its line here, never its message: a
// parse error quotes what it read, and a child's error its arguments and output.
//
// A part is any object with the three, named as boxHealthParts names it, whose region reads no clock
// and sets no timer (test/box-health-sampler.test.mjs checks the text, a child's own timeout option
// included: ctx.timeout, then kill it).
//
// ctx, a part's only clock and only timers (no part reads Date.now or sets a timer itself):
//   now()           ms. Rings, intervals, rates and forecasts: what the answer's times are in
//   real()          ms, the machine's clock, never scaled: the age of a file, of a record stamped by
//                   another process, and of a child or a walk
//   every(ms, fn)   calls fn every ms of now(); one still running (a promise) is skipped, never
//                   overlapped. Returns a function that ends it
//   after(ms, fn)   calls fn once, ms of now() from now. Returns a function that ends it
//   timeout(ms, fn) calls fn once, ms of real() from now (a walk's 2 s, a child's limit), and returns
//                   a function that ends it
//   turn()          a promise of the event loop's next turn, between batches of a walk
//   roots()         the known roots, [{ root, name }], the machine's registry and the hub's scan
//                   together, read again every minute of real(); empty until first read, after start
//   ceiling()       the lowest machine_memory_ceiling among them, undefined until first read
//   scan()          the hub's own scan, a promise of the dashboards' hellos (root, name, port …)
//   proc, cgroup    the folders to read (DEVTEAM_PROC, DEVTEAM_CGROUP)
//   stopped()       true once the hub has closed: slow work that finds it so ends
//   say(words)      in the hub's log, under the part's name: each line once, 20 lines a part at most.
//                   The words are the part's own, never text it read
//   kit             the release serving the hub (startHub's kit, as /instances.json gives it), or null
// With DEVTEAM_BOX_HEALTH_FAST=<n> (1 to 3600, tests; read only when DEVTEAM_BOX_HEALTH is on) now()
// and its intervals run n times as fast. real() and timeout() never do.
export const BOX_HEALTH_EVERY_MS = 5000, BOX_HEALTH_WINDOW_MS = 3600000, BOX_HEALTH_SAMPLES = 720;
export const BOX_HEALTH_ROOTS_MS = 60000, BOX_HEALTH_TREND_MS = 600000, BOX_HEALTH_STATFS_MS = 2000, BOX_HEALTH_STALE_MS = 15000;
export const boxHealthOn = () => { const v = process.env.DEVTEAM_BOX_HEALTH; return v === 'on' || (!v && HUB_PORT === 4320); };
export const boxHealthParts = () => [
  ['processes', boxHealthProcesses], ['disk', boxHealthDisk], ['state', boxHealthState], ['pool', boxHealthPool],
  ['claude', boxHealthClaude], ['park', boxHealthPark], ['room', boxHealthRoom],
];
// What a section needs before it is in the answer at all, and stands in for while a part's own fields
// are checked alone.
export const BOX_HEALTH_BASE = { headroom: {}, pool: { projects: [], allocated: [], recent: [] }, claude: { accounts: [] }, box: {} };
// The hub's one budget of file reads (kit-919), the sampler's and every part's. Node runs each async
// file call on one of its file threads (libuv's pool, UV_THREADPOOL_SIZE read once as C's atoi reads
// it: 4 when unset, 1 for 0 or no number, 1024 at most and for a negative one), and a read that hangs
// (a dead volume, a process whose memory is locked) holds its thread until it returns. Box health has
// one fewer than the threads at once, so one is always left for the rest of the hub, and never two
// reads of one file. boxHealthIo(file, fn) gives null, calling nothing, when that file is out or the
// budget is (boxHealthIoFull() tells which); otherwise fn's promise, the one its caller awaits, with
// the file out until it settles, however long, whatever run asked or whether that run has stopped:
// the budget is this process's, not a sampler's, so a start after a stop still counts what the old
// run left out. fn makes its file calls one after another, so it holds one thread at a time. A refusal
// is null itself, never a promise of null, so it is never taken for a missing file: each reader keeps
// its last value on it (a volume, a gap), and one that finds the budget full says BOX_HEALTH_FULL.
export const BOX_HEALTH_THREADS = (() => {
  const v = process.env.UV_THREADPOOL_SIZE;
  if (v === undefined) return 4;
  const n = Number(/^\s*([+-]?\d+)/.exec(v)?.[1] ?? 0);
  return n === 0 ? 1 : n < 0 || n > 1024 ? 1024 : n;
})();
export const BOX_HEALTH_IO = BOX_HEALTH_THREADS - 1;
export const boxHealthIoOut = new Set();
export const boxHealthIoFull = () => boxHealthIoOut.size >= BOX_HEALTH_IO;
export function boxHealthIo(file, fn) {
  if (boxHealthIoOut.has(file) || boxHealthIoFull()) return null;
  boxHealthIoOut.add(file);
  return (async () => fn())().finally(() => boxHealthIoOut.delete(file));
}
export const BOX_HEALTH_FULL = "the hub's box-health file reads are all in use: a read that can't start keeps its last value";
// the engine's own then, and the call that applies it, taken once as the region loads: it attaches to a
// native promise whatever that promise's own then is, and nothing patched later changes it
export const boxHealthThen = Promise.prototype.then, boxHealthApply = Reflect.apply;
export const boxHealthIso = (ms) => new Date(ms).toISOString();
// A kernel file's text, or null: missing, unreadable, or pressure that is compiled in and off (its
// read fails).
export const boxHealthRead = (...p) => { try { return fs.readFileSync(path.join(...p), 'utf8'); } catch { return null; } };
export const boxHealthField = (text, key) => { const m = new RegExp(`^${key}[ \\t]+(\\d+)$`, 'm').exec(text ?? ''); return m ? Number(m[1]) : undefined; };
// some and full averages of a pressure file, as { some10, some60, full10, full60 } percents.
export const boxHealthPressure = (text) => {
  const out = {};
  for (const kind of ['some', 'full']) for (const n of [10, 60]) {
    const m = new RegExp(`^${kind} .*\\bavg${n}=([\\d.]+)`, 'm').exec(text ?? '');
    if (m && Number(m[1]) <= 100) out[`${kind}${n}`] = Number(m[1]);
  }
  return out;
};
// The object without its undefined fields: a field that can't be read is absent, never zero.
export const boxHealthPresent = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
export const boxHealthShare = (n) => Math.min(1, Math.max(0, n));
// Every counter a rate is worked out from, at one time. A box's own numbers come from its cgroup and
// from nowhere else: where there is one (cpu.max or memory.current), a missing file is an absent field,
// and the host's is never given for it. Where there is none (macOS, or a Linux machine's root cgroup),
// CPU is os.cpus()'s and pressure is /proc/pressure's.
export function boxHealthCounters(ctx) {
  const boxed = boxHealthRead(ctx.cgroup, 'cpu.max') !== null || boxHealthRead(ctx.cgroup, 'memory.current') !== null;
  const stat = boxed ? boxHealthRead(ctx.cgroup, 'cpu.stat') : null;
  const cores = os.cpus().map((c) => { const all = Object.values(c.times).reduce((a, b) => a + b, 0); return { all, busy: all - c.times.idle }; });
  return { t: ctx.now(), boxed, cores, usage: boxHealthField(stat, 'usage_usec'), periods: boxHealthField(stat, 'nr_periods'), throttled: boxHealthField(stat, 'nr_throttled') };
}
// CPU between two readings of the counters (was: null at the first), in cores.
export function boxHealthCpu(ctx, was, is) {
  const [quota, period] = (is.boxed ? boxHealthRead(ctx.cgroup, 'cpu.max') ?? '' : '').trim().split(/\s+/).map(Number);
  const count = is.cores.length;
  const cap = quota > 0 && period > 0 ? quota / period : undefined;
  const out = { limit: cap !== undefined && (!count || cap < count) ? cap : count || undefined };
  // a clock set back gives no rate at all
  if (was && is.t <= was.t) was = null;
  const ms = was ? is.t - was.t : 0;
  const shares = was && was.cores.length === count && is.cores.every((c, i) => c.all > was.cores[i].all && c.busy >= was.cores[i].busy)
    ? is.cores.map((c, i) => boxHealthShare((c.busy - was.cores[i].busy) / (c.all - was.cores[i].all))) : undefined;
  if (is.boxed) {
    if (ms > 0 && was.boxed && is.usage >= was.usage) out.used = (is.usage - was.usage) / 1000 / ms;
    // no period since the last tick is none held; a counter that fell started over
    if (was?.boxed && is.periods >= was.periods && is.throttled >= was.throttled) out.throttled = is.periods === was.periods ? 0 : boxHealthShare((is.throttled - was.throttled) / (is.periods - was.periods));
  } else if (shares?.length) out.used = shares.reduce((a, b) => a + b, 0);
  if (shares?.length) out.host_cores = shares;
  const load = os.loadavg();
  if (load.length === 3 && load.every((n) => Number.isFinite(n) && n >= 0)) out.load = load;
  if (cap !== undefined && cap < count) {
    if (out.host_cores) out.shared = true;
    if (out.load) out.load_scope = 'host';
  }
  out.some60 = boxHealthPressure(is.boxed ? boxHealthRead(ctx.cgroup, 'cpu.pressure') : boxHealthRead(ctx.proc, 'pressure', 'cpu')).some60;
  return boxHealthPresent(out);
}
// Memory, in use as machineMemory() counts it, so this, the gate and /memory.json agree.
export function boxHealthMemory(ctx, boxed) {
  const m = machineMemory() ?? { inUse: os.totalmem() - os.freemem(), max: os.totalmem() };
  const out = { used: m.inUse, max: m.max, available: Math.max(0, m.max - m.inUse), ceiling: ctx.ceiling() };
  const whole = (t) => (/^\d+$/.test(t?.trim() ?? '') ? Number(t.trim()) : undefined);
  if (boxed) {
    out.swap_used = whole(boxHealthRead(ctx.cgroup, 'memory.swap.current'));
    out.swap_max = whole(boxHealthRead(ctx.cgroup, 'memory.swap.max'));
  } else {
    const info = boxHealthRead(process.env.DEVTEAM_MEMINFO ?? path.join(ctx.proc, 'meminfo'));
    const kb = (k) => { const n = /^\w+:\s+(\d+) kB$/m.exec((info ?? '').split('\n').find((l) => l.startsWith(`${k}:`)) ?? ''); return n ? Number(n[1]) * 1024 : undefined; };
    const total = kb('SwapTotal'), free = kb('SwapFree');
    out.swap_max = total;
    if (total !== undefined && free !== undefined) out.swap_used = Math.max(0, total - free);
  }
  out.some60 = boxHealthPressure(boxed ? boxHealthRead(ctx.cgroup, 'memory.pressure') : boxHealthRead(ctx.proc, 'pressure', 'memory')).some60;
  return boxHealthPresent(out);
}
// The sampler: { on, start, stop, serve, fail, tick }. kit is startHub's; parts and real are the tests' own.
export function boxHealth(log, scan, { kit = null, parts = boxHealthParts(), real = () => Date.now() } = {}) {
  // what was said, by its key: one line each, so a value that changes in it adds none
  const said = new Set();
  const say = (key, words) => { if (!said.has(key)) { said.add(key); log(`hub: box health: ${words}`); } };
  const fail = (who, doing, e) => {
    const word = (v) => (typeof v === 'string' && /^\w{1,40}$/.test(v) ? v : null);
    // what was thrown may throw as it is read (a getter, a Proxy): each is read once, the value checked
    // is the value said, and on any throw it is said as an error, with no code or line
    let name = null, code = null, line;
    try {
      name = word(e?.name);
      code = word(e?.code);
      const stack = e?.stack;
      line = typeof stack === 'string' ? /^ +at .*\bdevteam\.mjs:(\d+)/m.exec(stack)?.[1] : undefined;
    } catch { name = code = line = null; }
    say(`${who} ${doing}`, `${who}: ${doing} failed: ${name ?? 'an error'}${code ? ` ${code}` : ''}${line ? ` at line ${line}` : ''}`);
  };
  const spoken = new Map();
  const speak = (who, words) => {
    const lines = spoken.get(who) ?? spoken.set(who, new Set()).get(who);
    if (lines.size >= 20 || lines.has(words)) return;
    lines.add(words);
    log(`hub: box health: ${who}: ${words}`);
  };
  const on = boxHealthOn();
  const asked = process.env.DEVTEAM_BOX_HEALTH === 'on' ? Number(process.env.DEVTEAM_BOX_HEALTH_FAST || 1) : 1;
  const fast = asked >= 1 && asked <= 3600 ? asked : 1;
  const began = real();
  const now = () => began + (real() - began) * fast;
  let started = false, stopped = false, ticking = false;
  let roots = [], ceiling;
  let was = null;
  // the hour: { t, sample, free: a volume's device to its free bytes }, oldest first
  let ring = [];
  let latest = { at: -Infinity, now: {} }, sections = {};
  // the volumes in the order they were first seen, so a sample's `disk` stays one volume's; each root's
  // device when it last answered; the roots still being asked
  let volumes = [];
  const deviceOf = new Map();
  const asking = new Set();
  const live = new Set();
  const checked = new WeakMap();
  const timer = (set, clear, ms, fn) => {
    if (stopped) return () => {};
    const h = set(fn, ms);
    h.unref?.();
    const end = () => { clear(h); live.delete(end); };
    live.add(end);
    return end;
  };
  const guarded = (who, doing, fn) => async () => { try { await fn(); } catch (e) { fail(who, doing, e); } };
  const ctxFor = (who) => {
    const once = (ms, fn) => { const end = timer(setTimeout, clearTimeout, ms, () => { end(); guarded(who, 'a timer', fn)(); }); return end; };
    return Object.freeze({
      now, real, kit,
      every: (ms, fn) => {
        let busy = false;
        const run = guarded(who, 'a timer', fn);
        return timer(setInterval, clearInterval, ms / fast, async () => { if (busy) return; busy = true; try { await run(); } finally { busy = false; } });
      },
      after: (ms, fn) => once(ms / fast, fn),
      timeout: (ms, fn) => once(ms, fn),
      turn: () => new Promise((r) => setImmediate(r)),
      roots: () => roots, ceiling: () => ceiling, scan,
      proc: process.env.DEVTEAM_PROC ?? '/proc', cgroup: process.env.DEVTEAM_CGROUP ?? '/sys/fs/cgroup',
      stopped: () => stopped,
      say: (words) => speak(who, String(words)),
    });
  };
  const ctx = ctxFor('sampler');
  const running = parts.map(([name, part]) => ({ name, part, ctx: ctxFor(name), up: false }));
  // The roots as memoryRoots names them, but each root's settings read one at a time through the
  // budget (kit-919): one that can't start, or hasn't answered in 2 s of real(), keeps that root's last.
  const settingsOf = new Map();
  const readRoots = async () => {
    let list = [];
    try { list = await scan(); } catch { list = []; }
    let registry = [];
    try { registry = machineRepos(); } catch { registry = []; }
    const scanned = (Array.isArray(list) ? list : []).filter((s) => memoryIsMap(s) && typeof s.root === 'string').map((s) => ({ root: s.root, name: typeof s.name === 'string' ? s.name : '' }));
    const all = [...new Set([...registry, ...scanned.map((s) => s.root)].filter((r) => typeof r === 'string').map((r) => r.replace(/\/+$/, '')))].filter((r) => r.startsWith('/'));
    const late = Symbol('late');
    for (const r of all) {
      if (stopped) return;
      const p = boxHealthIo(path.join(r, 'docs', 'devteam', 'project', 'settings.md'), () => memorySettings(r));
      if (p === null) { if (boxHealthIoFull()) ctx.say(BOX_HEALTH_FULL); continue; }
      let end = () => {};
      const got = await Promise.race([p, new Promise((res) => { end = ctx.timeout(BOX_HEALTH_STATFS_MS, () => res(late)); })]);
      end();
      if (got !== late) settingsOf.set(r, got);
    }
    for (const r of [...settingsOf.keys()]) if (!all.includes(r)) settingsOf.delete(r);
    ({ roots, ceiling } = memoryNameRoots(registry, scanned, (r) => settingsOf.get(r) ?? null));
  };
  // [device, its entry], one a distinct volume. At most two reads are ever out, so a volume that hangs
  // can't hold the threads every file read shares, and no root of it is asked while one is. Each is a
  // read of the budget: one that can't start counts as not answered (a gap, its volume not forgotten);
  // with the budget full the tick asks no more, and a root whose own read is out is passed over.
  const readDisks = async () => {
    const found = new Map();
    const queue = roots.map((r) => r.root), waiting = [];
    let over = false, skipped = false;
    const one = async (root) => {
      asking.add(root);
      try {
        const p = boxHealthIo(root, async () => {
          const { dev } = await fs.promises.stat(root);
          deviceOf.set(root, dev);
          if ([...asking].some((r) => r !== root && deviceOf.get(r) === dev)) { waiting.push(root); return; }
          const s = await fs.promises.statfs(root);
          if (!found.has(dev)) found.set(dev, s);
        });
        if (p === null) {
          skipped = true;
          if (boxHealthIoFull()) { over = true; ctx.say(BOX_HEALTH_FULL); }
          return;
        }
        await p;
      } catch {} finally { asking.delete(root); }
    };
    const worker = async () => {
      while (queue.length && !over) {
        const root = queue.shift();
        const dev = deviceOf.get(root);
        if (found.has(dev) || asking.has(root)) continue;
        // its volume is being asked through another root: wait for that answer, which may be that it is gone
        if (dev !== undefined && [...asking].some((r) => deviceOf.get(r) === dev)) { waiting.push(root); continue; }
        await one(root);
        queue.push(...waiting.splice(0));
      }
    };
    let end = () => {};
    const late = new Promise((r) => { end = ctx.timeout(BOX_HEALTH_STATFS_MS, () => { over = true; r(); }); });
    await Promise.race([Promise.all(Array.from({ length: Math.max(0, 2 - asking.size) }, worker)), late]);
    end();
    if (asking.size) ctx.say('a volume did not answer within 2 s');
    // every root answered or is gone: a volume with none left is forgotten
    if (!asking.size && !queue.length && !skipped) volumes = volumes.filter((dev) => found.has(dev));
    const got = new Map(found);
    for (const dev of got.keys()) if (!volumes.includes(dev)) volumes.push(dev);
    return volumes.flatMap((dev) => {
      const s = got.get(dev);
      const free = s && s.bavail * s.bsize, total = s && s.blocks * s.bsize;
      if (!Number.isSafeInteger(free) || !Number.isSafeInteger(total) || total <= 0) return [];
      const inodes = s.files > 0 && Number.isSafeInteger(s.files) && Number.isSafeInteger(s.ffree) ? { inodes_free: s.ffree, inodes: s.files } : {};
      return [[dev, { free, total, ...inodes }]];
    });
  };
  // A part's fields for the answer, as a copy of its own (so a later change to what it returned isn't
  // sent unchecked), or null: refused. Worked out once for each object in each place.
  const accepted = (p, obj, what, whole) => {
    if (!memoryIsMap(obj)) { say(`${p.name} ${what}`, `${p.name}: ${what} is not an object, left out`); return null; }
    const places = checked.get(obj) ?? checked.set(obj, new Map()).get(obj);
    if (!places.has(what)) {
      let copy = null, bad = `${what} can't be written as JSON`;
      try { copy = JSON.parse(JSON.stringify(obj)); bad = boxHealthProblem(whole(copy)); } catch {}
      places.set(what, bad ? null : copy);
      if (bad) say(`${p.name} ${what}`, `${p.name}: ${what} left out: ${bad}`);
    }
    return places.get(what);
  };
  // a promise a part returned: its rejection is said, and never the process's end. True when got is
  // one. A native promise is held by the engine's own then, never its own (which a part may have
  // replaced: kit-888), and any other thenable through Promise.resolve. Not defended: a native one
  // whose constructor was replaced too, so that no then can be attached to it at all, and a Proxy
  // around one, whose then is called on the Proxy and so never reaches the promise.
  const swallow = (p, doing, got, then = () => {}) => {
    const caught = (e) => { fail(p.name, doing, e); then(); };
    // throws at once, reading nothing, for anything that isn't a native promise
    try { boxHealthApply(boxHealthThen, got, [undefined, caught]); return true; } catch {}
    if (typeof got?.then !== 'function') return false;
    Promise.resolve(got).catch(caught);
    return true;
  };
  const tick = async () => {
    if (ticking || stopped) return;
    ticking = true;
    try {
      const disks = await readDisks();
      if (stopped) return;
      const is = boxHealthCounters(ctx);
      const t = is.t, at = boxHealthIso(t);
      const reading = { cpu: boxHealthCpu(ctx, was, is), memory: boxHealthMemory(ctx, is.boxed) };
      was = is;
      // a clock set back starts again from there, so the hour stays oldest first
      ring = ring.filter((r) => r.t > t - BOX_HEALTH_WINDOW_MS && r.t < t).slice(1 - BOX_HEALTH_SAMPLES);
      if (disks.length) reading.disks = disks.map(([dev, d]) => {
        const first = ring.find((r) => r.free.has(dev));
        return first && t - first.t >= BOX_HEALTH_TREND_MS ? { ...d, bytes_per_hour: Math.round((d.free - first.free.get(dev)) * 3600000 / (t - first.t)) } : d;
      });
      const p = boxHealthPressure(is.boxed ? boxHealthRead(ctx.cgroup, 'io.pressure') : boxHealthRead(ctx.proc, 'pressure', 'io'));
      const io = boxHealthPresent({ some10: p.some10, some60: p.some60, full60: p.full60 });
      if (Object.keys(io).length) reading.io = io;
      // one that didn't answer is a gap in its line, never another volume's
      const main = disks.find(([dev]) => dev === volumes[0])?.[1];
      const sample = boxHealthPresent({
        at, cpu: reading.cpu.used, cpu_some: reading.cpu.some60, throttled: reading.cpu.throttled, load: reading.cpu.load?.[0],
        mem: reading.memory.used, mem_some: reading.memory.some60, swap: reading.memory.swap_used,
        disk: main?.free, inodes: main?.inodes_free, io: io.some60,
      });
      const entry = { t, sample, free: new Map(disks.map(([dev, d]) => [dev, d.free])) };
      const joined = {}, results = {};
      const alone = (more) => ({ v: 1, at, window_s: 3600, now: {}, samples: [], ...more });
      for (const p of running) {
        if (!p.up) continue;
        // what it gave is read inside its own try (a getter or a Proxy may throw there), and kept only
        // when all of it was read: a throw costs its part, never the tick
        let mine;
        try {
          const got = p.part.part(p.ctx, { now: structuredClone(reading), sample: { ...entry.sample }, samples: [...ring.map((r) => r.sample), { ...entry.sample }], ...results });
          if (got === undefined || got === null) continue;
          if (swallow(p, 'part', got) || !memoryIsMap(got)) { say(`${p.name} shape`, `${p.name}: part gave something other than an object, left out`); continue; }
          const sections = {};
          for (const [k, fields] of Object.entries(got.answer ?? {})) {
            if (!Object.hasOwn(BOX_HEALTH_BASE, k)) { say(`${p.name} section`, `${p.name}: a section box-health@1 does not have, left out`); continue; }
            const base = BOX_HEALTH_BASE[k];
            const kept = accepted(p, fields, `answer.${k}`, (c) => alone({ [k]: { ...base, ...c } }));
            if (kept) sections[k] = kept;
          }
          const more = got.sample === undefined ? null : accepted(p, got.sample, 'sample', (c) => alone({ samples: [{ at, ...c }] }));
          mine = { got, sections, more };
        } catch (e) { fail(p.name, 'part', e); continue; }
        results[p.name] = mine.got;
        for (const [k, kept] of Object.entries(mine.sections)) {
          const next = { ...joined[k], ...kept };
          if (Object.keys(BOX_HEALTH_BASE[k]).every((f) => Object.hasOwn(next, f))) joined[k] = next;
        }
        // a part adds fields: the sampler's own, and an earlier part's, are never overwritten
        if (mine.more) entry.sample = { ...mine.more, ...entry.sample };
      }
      // a part is given the hour's own samples: none can change them
      Object.freeze(entry.sample);
      ring.push(entry);
      latest = { at: real(), now: reading };
      sections = joined;
    } catch (e) {
      // a gap: no sample, and no reading passed off as now; what the parts last gave stays
      latest = { at: -Infinity, now: {} };
      fail('sampler', 'a tick', e);
    } finally { ticking = false; }
  };
  return {
    on, tick, fail,
    // a hub that loses its port and listens again doesn't start twice
    async start() {
      if (!on || started || stopped) return;
      started = true;
      for (const p of running) { try { p.up = true; swallow(p, 'start', p.part.start(p.ctx), () => { p.up = false; }); } catch (e) { p.up = false; fail(p.name, 'start', e); } }
      // the first sample waits for the roots' first read, which under FAST can outlast a tick; a read
      // that hangs holds it fast ticks of the interval, 5 s, as the first tick at FAST=1 is (kit-888)
      let rooted = false, waited = 0;
      ctx.every(BOX_HEALTH_EVERY_MS, () => (rooted || ++waited >= fast ? tick() : undefined));
      ctx.every(BOX_HEALTH_ROOTS_MS * fast, readRoots);
      await guarded('sampler', 'the roots', readRoots)();
      rooted = true;
      await tick();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const end of [...live]) end();
      for (const p of running) if (p.up) { try { swallow(p, 'stop', p.part.stop()); } catch (e) { fail(p.name, 'stop', e); } }
    },
    // GET /box-health.json: the last tick's answer, with only the samples and claude.points newer than
    // after. No part runs here.
    serve(req, send) {
      const wrong = (error) => send(400, 'application/json', JSON.stringify({ error }));
      const given = [...new URL(req.url, 'http://127.0.0.1').searchParams];
      if (given.some(([k]) => k !== 'after')) return wrong('/box-health.json takes only after');
      if (given.length > 1) return wrong('after is given more than once: give it once');
      if (given.length && !memoryAtOk(given[0][1])) return wrong("after should be a sample's at, YYYY-MM-DDTHH:MM:SSZ in UTC");
      const from = given.length ? Date.parse(given[0][1]) : -Infinity;
      const newer = (list) => list.filter((x) => Date.parse(x.at) > from);
      // ticks that stopped (a laptop asleep) leave a reading that is no longer now
      const reading = real() - latest.at <= BOX_HEALTH_STALE_MS ? latest.now : {};
      const t = now();
      const kept = ring.filter((r) => r.t > t - BOX_HEALTH_WINDOW_MS).map((r) => r.sample);
      const claude = sections.claude?.points ? { claude: { ...sections.claude, points: newer(sections.claude.points) } } : {};
      const body = JSON.stringify({ v: 1, at: boxHealthIso(t), window_s: BOX_HEALTH_WINDOW_MS / 1000, now: reading, samples: newer(kept), ...sections, ...claude });
      if (Buffer.byteLength(body) > BOX_HEALTH_MAX_BYTES) { say('size', 'the answer is over 1 MB, so none was given'); return send(500, 'application/json', JSON.stringify({ error: 'box health unavailable' })); }
      return send(200, 'application/json', body);
    },
  };
}
/* box-health-sampler end */
/* box-health-processes start */
// CPU and memory by worktree, test runs apart, and what was left behind (kit-837): a walk of
// ctx.proc every 15 s of now(), the first 15 s after start (by then the sampler has read the roots
// once), its last whole result given to the parts after it. Linux only:
// where ctx.proc can't be listed it gives nothing, and the parts after it leave CPU, memory, test
// runs, strays, others and agent absent.
//
// The walk, never two at once, stopped at 2 s of real():
//   0. pids   when ctx.roots() gives a new list (the sampler reads them every minute), the pids each
//             root's run/ records (below), read async before the 2 s begin, for at most 2 s; one
//             still out when that ends goes on alone, the last pids are kept meanwhile, and no
//             second read starts while it is out (final-1 F2)
//   1. stat   one read of <proc>/<pid>/stat a process, synchronous, in batches of 100 with a turn of
//             the event loop between (ctx.turn): its own and its reaped children's CPU ticks, resident
//             pages, parent, start time and comm. Then <proc>/uptime and <cgroup>/cpu.stat.
//   2. info   for a (pid, start time) not seen before, or last read 5 minutes of real() ago or more:
//             its cmdline (at most 64 KB) and cwd, read async, classified at once and the words
//             dropped. At most two processes' reads are ever out, across walks, and never two for
//             one process, so a read that hangs (a process whose memory is locked) holds at most
//             one of the threads every file read shares, and only while it hangs (final-1 F1).
//             Each process's two reads are one read of the hub's budget (boxHealthIo, kit-919): one
//             that can't start leaves its last info as it was, and with the budget full the walk
//             starts no more. The run/ files and the sensors listing are too: one that can't
//             start ends that pids read, keeping the last pids, and the next walk asks again.
//             What is left of the 2 s ends the reading, not the walk: a process not read yet
//             counts as unknown (outside, never a stray) until its read settles. Only the kind, whether it starts a test run, whether it is devteam's or tmux,
//             and its cwd are kept, and only in this region. One whose cmdline can't be read is
//             known as nothing (outside, never a stray) until it is read again. environ is never read.
// A walk whose stat reads are cut off at 2 s gives nothing: the part gives undefined until two whole walks have run
// again, since a change is worked out only between two whole walks one after the other.
//
// Where a process counts: the longest known root (ctx.roots()) holding its cwd, then the worktree
// under it (<root>/.worktrees/<name>); a cwd in no root, or one that can't be read, is outside. A
// deleted cwd ("… (deleted)") counts where it was.
// CPU between two whole walks, in cores over real() between them: its own ticks' change, plus the
// rise in its reaped children's ticks less the whole time (own plus reaped) that its children which
// have since gone, and their gone descendants, had at the first walk; each part never below zero, so
// a child that came and went between walks counts for its parent and nothing counts twice. The
// rise in pid 1's reaped time, and a systemd's, init's or tini's (by comm), is left out: a child
// re-parented there is lost to unattributed, and a child reaped by no one (its parent ignores
// SIGCHLD) adds nothing to its parent's reaped time, so its time since the first walk is lost too.
// A new process counts all its time.
// A test run is a process whose cmdline is devteam.mjs gate, node with --test before its script,
// one of PROC_TESTS by its executable's or its script's name (a .js, .mjs, .cjs, .py or .rb
// extension aside, or a script under node_modules/<name>/ or node_modules/@playwright/test/),
// python -m pytest, or go test or cargo test; its tree is the processes under it, itself included,
// and its top the highest of them.
//
// part(ctx, parts) gives undefined, or the last whole walk's result (a new object each walk):
//   at            now() when the walk ended
//   over_s        seconds of real() between the two walks CPU is from; absent with no CPU yet
//   places        one a (root, worktree or none) holding a process, in the order first seen:
//                 { root, project (the root's name), worktree (its folder's name; absent for the
//                 root itself), n (processes), agents (claude, codex, opencode), cpu (cores; absent
//                 with no CPU yet), rss (bytes), tests: { n (test runs whose top is here), cpu, rss },
//                 own: { n, cpu, rss } (devteam's own commands and tmux, below) }
//   outside       { n, agents, cpu, rss }: in no root, or cwd unreadable
//   unattributed  { cpu }: the cgroup's CPU over the same time (cpu.stat usage_usec) less every
//                 process's above, never below zero; absent with no cpu.stat or no CPU yet
//   strays        box-health@1's strays: at most 40 groups by project, kind and why, most memory first
// Strays, processes over 10 minutes old (from their start time and uptime) of kind agent, browser
// (memoryClassify's, and chrome-headless-shell and chromium-browser), node (memoryClassify's) or
// test (in a test run's tree), the first that holds of:
//   folder-gone   its cwd is deleted
//   parent-gone   kind browser, node or test, and its parent is pid 1 or a process whose comm is
//                 systemd, init or tini; left out: devteam's own commands (node running devteam.mjs
//                 or gateway.mjs), tmux, the pids a known root's run/ records (browser/state.json's
//                 daemon_pid and chrome_pid, supervisor-up.json's pid, sensors/<name>/stream.pid,
//                 each at most 64 KB), and any process under one of those
//   long-test     kind test, and its run's top is over 60 minutes old
// A stray whose cwd is in no root has no project. Nothing is killed, signalled or started here.
export const PROC_EVERY_MS = 15000, PROC_BUDGET_MS = 2000, PROC_BATCH = 100, PROC_INFO_MS = 300000;
export const PROC_READS = 2, PROC_HZ = 100, PROC_STRAY_S = 600, PROC_LONG_TEST_S = 3600, PROC_STRAYS = 40, PROC_FILE_MAX = 65536;
export const PROC_REAPERS = ['systemd', 'init', 'tini'];
export const PROC_TESTS = ['vitest', 'jest', 'mocha', 'rspec', 'pytest', 'playwright'];
export const PROC_BROWSERS = ['chrome-headless-shell', 'chromium-browser'];
// /proc/<pid>/stat's text: { ppid, comm, cpu, reaped, start, pages }, or null. comm may hold spaces
// and parentheses, so the fields are counted from its last ")".
export function procStat(text) {
  const open = text.indexOf('('), close = text.lastIndexOf(')');
  if (open < 0 || close < open) return null;
  const f = text.slice(close + 2).split(' ');
  const n = (i) => (/^-?\d+$/.test(f[i] ?? '') ? Number(f[i]) : NaN);
  const [ppid, ut, st, cut, cst, start, pages] = [1, 11, 12, 13, 14, 19, 21].map(n);
  if (![ppid, ut, st, cut, cst, start, pages].every(Number.isSafeInteger) || ppid < 0 || start < 0) return null;
  return { ppid, comm: text.slice(open + 1, close), cpu: Math.max(0, ut + st), reaped: Math.max(0, cut + cst), start, pages: Math.max(0, pages) };
}
// A cmdline's words: what of it is kept, { kind, test, own }. kind is agent, browser, node or null.
export function procClassify(words) {
  if (!words.length) return { kind: null, test: false, own: false };
  const exe = memoryBase(words[0]);
  const bare = (w) => memoryBase(w).replace(/\.(?:m?js|cjs|py|rb)$/, '');
  const tool = (w) => PROC_TESTS.includes(bare(w)) || PROC_TESTS.some((t) => w.includes(`/node_modules/${t}/`)) || w.includes('/node_modules/@playwright/test/');
  const { kind } = memoryClassify(words, new Set());
  const script = words.findIndex((w, j) => j > 0 && !w.startsWith('-'));
  let test = PROC_TESTS.includes(bare(words[0])) || ((exe === 'go' || exe === 'cargo') && words[1] === 'test');
  if (exe === 'node') {
    test = words.slice(1, script < 0 ? undefined : script).includes('--test')
      || (script > 0 && (memoryBase(words[script]) === 'devteam.mjs' ? words[script + 1] === 'gate' : tool(words[script])));
  } else if (/^python[\d.]*$/.test(exe)) test = test || (words[1] === '-m' && words[2] === 'pytest') || (script > 0 && tool(words[script]));
  else if (exe === 'ruby' && script > 0) test = test || tool(words[script]);
  const own = kind === 'devteam' || exe === 'tmux' || (exe === 'node' && script > 0 && memoryBase(words[script]) === 'gateway.mjs');
  const named = kind === 'agent' || kind === 'browser' || kind === 'node' ? kind : PROC_BROWSERS.includes(exe) ? 'browser' : null;
  return { kind: named, test, own };
}
// Where a cwd counts: { root, project, worktree? } by the longest root holding it, or null.
export function procPlace(cwd, roots) {
  if (typeof cwd !== 'string') return null;
  const dir = cwd.endsWith(' (deleted)') ? cwd.slice(0, -' (deleted)'.length) : cwd;
  let best = null;
  for (const r of roots) if ((dir === r.root || dir.startsWith(`${r.root}/`)) && (!best || r.root.length > best.root.length)) best = r;
  if (!best) return null;
  const m = /^\.worktrees\/([^/]+)/.exec(dir.slice(best.root.length + 1));
  return m ? { root: best.root, project: best.name, worktree: m[1] } : { root: best.root, project: best.name };
}
export const boxHealthProcesses = (() => {
  let run = null;
  const read = (...p) => { try { return fs.readFileSync(path.join(...p), 'utf8'); } catch { return null; } };
  // a small file's text, async, or null
  const readSmall = async (file) => {
    let fh = null;
    try {
      fh = await fs.promises.open(file, fs.constants.O_RDONLY);
      const buf = Buffer.alloc(PROC_FILE_MAX);
      const { bytesRead } = await fh.read(buf, 0, PROC_FILE_MAX, 0);
      return buf.toString('utf8', 0, bytesRead);
    } catch { return null; } finally { await fh?.close().catch(() => {}); }
  };
  // the pids the known roots' run/ folders record
  // Each read is one of the hub's budget (kit-919): one that can't start ends this read, so the last
  // pids are kept and the next walk asks again.
  const readPids = async (ctx, r, roots) => {
    const pids = new Set();
    const add = (v) => { if (Number.isSafeInteger(v) && v > 1) pids.add(v); };
    const refused = Symbol('refused');
    const io = (key, fn) => { const p = boxHealthIo(key, fn); if (p !== null) return p; if (boxHealthIoFull()) ctx.say(BOX_HEALTH_FULL); throw refused; };
    const small = (f) => io(f, () => readSmall(f));
    const json = async (f) => { const t = await small(f); try { const o = JSON.parse(t ?? 'null'); return memoryIsMap(o) ? o : null; } catch { return null; } };
    try {
      for (const { root } of roots) {
        const dir = path.join(root, 'docs', 'devteam', 'run');
        const b = await json(path.join(dir, 'browser', 'state.json'));
        add(b?.daemon_pid); add(b?.chrome_pid);
        add((await json(path.join(dir, 'supervisor-up.json')))?.pid);
        let sensors = [];
        const listed = path.join(dir, 'sensors');
        try { sensors = await io(listed, () => fs.promises.readdir(listed)); } catch (e) { if (e === refused) throw e; sensors = []; }
        for (const s of sensors) { const t = (await small(path.join(dir, 'sensors', s, 'stream.pid')))?.trim(); if (/^\d+$/.test(t ?? '')) add(Number(t)); }
      }
    } catch (e) { if (e === refused) return; throw e; }
    if (run === r) { r.pids = pids; r.pidsOf = roots; }
  };
  // readPids, one at a time, waited for at most 2 s; a late one sets the pids when it ends
  const pidsFor = async (ctx, r, roots) => {
    if (!r.pidsOut) r.pidsOut = readPids(ctx, r, roots).finally(() => { r.pidsOut = null; });
    let end = () => {};
    const late = new Promise((res) => { end = ctx.timeout(PROC_BUDGET_MS, () => res(true)); });
    const was = await Promise.race([r.pidsOut.then(() => false), late]);
    end();
    if (was) ctx.say("a root's run/ files did not answer within 2 s: the last pids are kept");
  };
  // a process's info: { cwd, kind, test, own }; one whose cmdline can't be read is known as nothing
  // undefined: a read of the hub's budget (kit-919) that can't start, so the last info stands
  const readInfo = async (ctx, pid) => {
    const dir = path.join(ctx.proc, String(pid)), cmdline = path.join(dir, 'cmdline');
    const p = boxHealthIo(cmdline, async () => {
      const text = await readSmall(cmdline);
      return text === null ? { text } : { text, cwd: await fs.promises.readlink(path.join(dir, 'cwd')).catch(() => null) };
    });
    if (p === null) { if (boxHealthIoFull()) ctx.say(BOX_HEALTH_FULL); return undefined; }
    const { text, cwd } = await p;
    if (text === null) return { cwd: null, kind: null, test: false, own: false, none: true };
    return { cwd, ...procClassify(memoryWords(text)) };
  };
  const walk = async (ctx, r) => {
    const roots = ctx.roots();
    if (r.pidsOf !== roots && !r.pidsOut) { await pidsFor(ctx, r, roots); if (ctx.stopped() || run !== r) return; }
    const began = ctx.real();
    let names = null;
    try { names = fs.readdirSync(ctx.proc); } catch { names = null; }
    if (names === null) { ctx.say("the processes can't be listed: no CPU or memory by worktree"); r.base = null; r.result = undefined; return; }
    const pids = names.filter((n) => /^\d+$/.test(n));
    const procs = new Map();
    let cut = false;
    for (let i = 0; i < pids.length && !cut; i += PROC_BATCH) {
      if (i > 0) { await ctx.turn(); if (ctx.stopped() || run !== r) return; if (ctx.real() - began >= PROC_BUDGET_MS) { cut = true; break; } }
      for (const pid of pids.slice(i, i + PROC_BATCH)) {
        const text = read(ctx.proc, pid, 'stat');
        const s = text === null ? null : procStat(text);
        if (s) procs.set(Number(pid), s);
      }
    }
    const t = ctx.real();
    const uptime = Number((read(ctx.proc, 'uptime') ?? '').split(' ')[0]);
    const usage = boxHealthField(read(ctx.cgroup, 'cpu.stat'), 'usage_usec');
    // the processes whose info is new or old and has no read out, read at most PROC_READS at once,
    // within what is left of the 2 s; a read still out then goes on alone and keeps its slot
    const keyOf = (pid, s) => `${pid}:${s.start}`;
    if (!cut) {
      const need = [...procs].filter(([pid, s]) => { const k = keyOf(pid, s), i = r.info.get(k); return !r.out.has(k) && (!i || ctx.real() - i.at >= PROC_INFO_MS); });
      let over = false;
      const worker = async () => {
        while (need.length && !over && run === r && !ctx.stopped()) {
          const [pid, s] = need.shift(), k = keyOf(pid, s);
          r.out.add(k);
          try {
            const info = await readInfo(ctx, pid);
            // the budget full: this walk reads no more; one whose file is out is passed over
            if (info === undefined) { if (boxHealthIoFull()) over = true; continue; }
            if (run === r) r.info.set(k, { at: ctx.real(), ...info });
          } finally { r.out.delete(k); }
        }
      };
      const left = PROC_BUDGET_MS - (ctx.real() - began);
      if (left > 0 && need.length) {
        let end = () => {};
        const late = new Promise((res) => { end = ctx.timeout(left, () => { over = true; res(); }); });
        await Promise.race([Promise.all(Array.from({ length: Math.max(0, PROC_READS - r.out.size) }, worker)), late]);
        end();
        over = true;
        if (ctx.stopped() || run !== r) return;
      }
      if (r.out.size && !r.slow) ctx.say('a process did not answer within 2 s: it counts outside until it does');
      r.slow = r.out.size > 0;
    }
    if (cut) { ctx.say('a walk was cut off at 2 s: no CPU until two whole walks have run'); r.base = null; r.result = undefined; return; }
    // forget what is gone
    const live = new Set([...procs].map(([pid, s]) => keyOf(pid, s)));
    for (const k of r.info.keys()) if (!live.has(k)) r.info.delete(k);
    const me = procs.get(process.pid);
    const page = memoryPageSize(me?.pages, process.memoryUsage.rss());
    const infoOf = (pid) => { const s = procs.get(pid); return s ? r.info.get(keyOf(pid, s)) : undefined; };
    // each process's chain, memoised: its test run's top, and whether it is under one of devteam's own
    const top = new Map(), kept = new Map();
    const topOf = (pid, seen = new Set()) => {
      if (top.has(pid)) return top.get(pid);
      const s = procs.get(pid);
      if (!s || seen.has(pid)) return null;
      seen.add(pid);
      const up = s.ppid > 0 && s.ppid !== pid ? topOf(s.ppid, seen) : null;
      const got = up ?? (infoOf(pid)?.test ? pid : null);
      top.set(pid, got);
      return got;
    };
    const ownOf = (pid, seen = new Set()) => {
      if (kept.has(pid)) return kept.get(pid);
      const s = procs.get(pid);
      if (!s || seen.has(pid)) return false;
      seen.add(pid);
      const got = !!infoOf(pid)?.own || r.pids.has(pid) || (s.ppid > 0 && s.ppid !== pid && ownOf(s.ppid, seen));
      kept.set(pid, got);
      return got;
    };
    // CPU: only between two whole walks one after the other
    const base = r.base;
    const over = base ? (t - base.t) / 1000 : 0;
    const cpuOf = new Map();
    if (base && over > 0) {
      // the whole time of each gone process at the first walk, given to the nearest of its ancestors
      // still here (through gone ones only)
      const gone = new Map();
      for (const [pid, s] of base.procs) {
        const now = procs.get(pid);
        if (now && now.start === s.start) continue;
        let up = base.procs.get(s.ppid), hops = 0;
        while (up && hops++ < 4096) {
          const here = procs.get(up.pid);
          if (here && here.start === up.start) { gone.set(up.pid, (gone.get(up.pid) ?? 0) + s.cpu + s.reaped); break; }
          up = base.procs.get(up.ppid);
        }
      }
      for (const [pid, s] of procs) {
        const was = base.procs.get(pid);
        const same = was && was.start === s.start;
        const own = Math.max(0, s.cpu - (same ? was.cpu : 0));
        const reaper = pid === 1 || PROC_REAPERS.includes(s.comm);
        const reaped = reaper ? 0 : Math.max(0, s.reaped - (same ? was.reaped : 0) - (same ? gone.get(pid) ?? 0 : 0));
        cpuOf.set(pid, (own + reaped) / PROC_HZ / over);
      }
    }
    const hasCpu = !!base && over > 0;
    const places = new Map(), outside = { n: 0, agents: 0, rss: 0 };
    if (hasCpu) outside.cpu = 0;
    const tops = new Map();
    let attributed = 0;
    for (const [pid, s] of procs) {
      const info = infoOf(pid);
      const place = info && !info.none ? procPlace(info.cwd, roots) : null;
      let into = outside;
      if (place) {
        const k = `${place.root}\0${place.worktree ?? ''}`;
        if (!places.has(k)) places.set(k, { ...place, n: 0, agents: 0, ...(hasCpu ? { cpu: 0 } : {}), rss: 0, tests: { n: 0, ...(hasCpu ? { cpu: 0 } : {}), rss: 0 }, own: { n: 0, ...(hasCpu ? { cpu: 0 } : {}), rss: 0 } });
        into = places.get(k);
      }
      const rss = s.pages * page, cpu = cpuOf.get(pid) ?? 0;
      into.n++; into.rss += rss;
      if (info?.kind === 'agent') into.agents++;
      if (hasCpu) { into.cpu += cpu; attributed += cpu; }
      if (info?.own && into.own) { into.own.n++; into.own.rss += rss; if (hasCpu) into.own.cpu += cpu; }
      const t0 = topOf(pid);
      if (t0 !== null && into.tests) {
        into.tests.rss += rss;
        if (hasCpu) into.tests.cpu += cpu;
        if (t0 === pid) into.tests.n++;
      }
      if (t0 !== null) tops.set(pid, t0);
    }
    // strays
    const groups = new Map();
    if (Number.isFinite(uptime) && uptime > 0) {
      const age = (s) => Math.max(0, uptime - s.start / PROC_HZ);
      for (const [pid, s] of procs) {
        const info = infoOf(pid);
        if (!info || info.none || age(s) <= PROC_STRAY_S) continue;
        const t0 = tops.get(pid);
        const kind = t0 !== undefined ? 'test' : info.kind;
        if (!kind) continue;
        const parent = procs.get(s.ppid);
        const orphan = s.ppid === 1 || (parent && PROC_REAPERS.includes(parent.comm));
        const why = info.cwd?.endsWith(' (deleted)') ? 'folder-gone'
          : kind !== 'agent' && orphan && !ownOf(pid) ? 'parent-gone'
          : kind === 'test' && age(procs.get(t0)) > PROC_LONG_TEST_S ? 'long-test' : null;
        if (!why) continue;
        const project = procPlace(info.cwd, roots)?.project;
        const k = `${project ?? ''}\0${kind}\0${why}`;
        const g = groups.get(k) ?? groups.set(k, { ...(project === undefined ? {} : { project }), kind, why, n: 0, oldest_s: 0, rss: 0, ...(hasCpu ? { cpu: 0 } : {}) }).get(k);
        g.n++;
        g.oldest_s = Math.max(g.oldest_s, Math.floor(age(s)));
        g.rss += s.pages * page;
        if (hasCpu) g.cpu += cpuOf.get(pid) ?? 0;
      }
    }
    const result = { at: ctx.now() };
    if (hasCpu) result.over_s = over;
    result.places = [...places.values()];
    result.outside = outside;
    if (hasCpu && Number.isFinite(usage) && Number.isFinite(base.usage) && usage >= base.usage) result.unattributed = { cpu: Math.max(0, (usage - base.usage) / 1e6 / over - attributed) };
    result.strays = [...groups.values()].sort((a, b) => b.rss - a.rss || b.n - a.n).slice(0, PROC_STRAYS);
    r.base = { t, procs: new Map([...procs].map(([pid, s]) => [pid, { pid, ...s }])), usage };
    r.result = result;
  };
  return {
    start(ctx) {
      const r = { base: null, result: undefined, info: new Map(), out: new Set(), slow: false, pids: new Set(), pidsOf: null, pidsOut: null, walking: false };
      run = r;
      const once = async () => {
        if (r.walking || run !== r) return;
        r.walking = true;
        try { await walk(ctx, r); } finally { r.walking = false; }
      };
      r.walk = once;
      ctx.every(PROC_EVERY_MS, once);
    },
    part(ctx, parts) { return run?.result; },
    stop() { run = null; },
  };
})();
/* box-health-processes end */
/* box-health-disk start */
// Each worktree's disk (kit-838): every minute of now() it lists <root>/.worktrees/ under each known
// root (ctx.roots()), folders only, and reads, one after the other, every worktree whose last read
// began 15 minutes of now() ago or more (or never), with `nice -n 19 du -skx <worktree>`: the lowest
// CPU priority, and with no I/O class set Linux takes the I/O priority from it (the lowest of the
// best-effort class); -x stays on the worktree's own volume. One du at a time, never two looks at
// once; a du still running at 60 s of real() is killed. Nothing of its output but the number is kept.
// A killed du stuck in the kernel stays alive until it closes: while one is, its worktree gets no
// second du (its row stays), and while two are, no du starts at all (every row stays). The
// .worktrees/ folders are listed one at a time inside the one look, so a volume that hangs holds at
// most one of the threads every file read shares, and no look starts until it answers. Each listing
// is a read of the hub's budget (boxHealthIo, kit-919): one that can't start keeps that root's rows.
//
// part(ctx, parts) gives undefined until a read has ended, then (a new object after each read):
//   worktrees   [{ root, worktree, disk, disk_at }], in the order the roots and their folders were
//               listed: root as ctx.roots() gives it, worktree the folder's name under .worktrees/
//               (as box-health-processes names it), disk in bytes (du's KiB × 1024), disk_at the ISO
//               time of now() when that read ended. disk is absent when that read failed (du exited
//               other than 0, gave no number, or couldn't be run) or was stopped at 60 s, until a
//               later one ends with a number; a worktree not read yet has no row. A worktree gone
//               from its .worktrees/ is forgotten at the next look; a .worktrees/ that is missing has
//               none, and one that can't be listed otherwise keeps its root's rows as they are. With no
//               row left, part gives undefined, not an empty list.
// stop() kills a du still running, as the sampler asks (its limit goes with the run's timers).
export const DISK_LOOK_MS = 60000, DISK_EVERY_MS = 900000, DISK_LIMIT_MS = 60000, DISK_OUT_MAX = 4096, DISK_ALIVE = 2;
export const boxHealthDisk = (() => {
  let run = null;
  // one du: bytes, or undefined. Its output is read for the first number only, at most 4 KB
  const du = (ctx, dir, kids, key) => new Promise((resolve) => {
    let out = '', done = false, end = () => {}, child;
    const finish = (v) => { if (done) return; done = true; end(); resolve(v); };
    try {
      child = spawn('nice', ['-n', '19', 'du', '-skx', dir], { stdio: ['ignore', 'pipe', 'ignore'], env: process.env });
    } catch { ctx.say("du can't be run: no disk by worktree"); finish(undefined); return; }
    // alive until it closes, which a du stuck in the kernel may not do for a long time after its kill
    kids.set(child, key);
    const gone = () => kids.delete(child);
    const kill = () => { try { child.kill('SIGKILL'); } catch {} };
    end = ctx.timeout(DISK_LIMIT_MS, () => { kill(); ctx.say("a worktree's du ran 60 s and was stopped: its disk is absent until a read ends"); finish(undefined); });
    child.on('error', () => { gone(); ctx.say("du can't be run: no disk by worktree"); finish(undefined); });
    child.stdout.on('data', (c) => { out += c; if (out.length > DISK_OUT_MAX) { kill(); finish(undefined); } });
    child.on('close', (code) => {
      gone();
      const m = /^(\d+)\s/.exec(out);
      const bytes = m ? Number(m[1]) * 1024 : NaN;
      finish(code === 0 && Number.isSafeInteger(bytes) ? bytes : undefined);
    });
  });
  const keyOf = (w) => `${w.root}\0${w.worktree}`;
  const look = async (ctx, r) => {
    const found = [], order = [];
    for (const { root } of ctx.roots()) {
      let list = [];
      const dir = path.join(root, '.worktrees');
      // a read of the hub's budget (kit-919): one that can't start keeps the root's rows, as an unreadable one does.
      // The names, then each one's lstat one after another, so the read holds one file thread at a time:
      // withFileTypes, on a volume that leaves entry types unknown, starts every entry's lstat at once
      // (final-1 F1). An entry gone before its lstat is left out.
      const p = boxHealthIo(dir, async () => {
        const dirs = [];
        for (const name of await fs.promises.readdir(dir)) {
          try { if ((await fs.promises.lstat(path.join(dir, name))).isDirectory()) dirs.push(name); } catch (e) { if (e?.code !== 'ENOENT') throw e; }
        }
        return dirs;
      });
      if (p === null) {
        if (boxHealthIoFull()) ctx.say(BOX_HEALTH_FULL);
        for (const k of r.order) if (k.startsWith(`${root}\0`)) order.push(k);
        continue;
      }
      try { list = await p; } catch (e) {
        // missing: no worktrees; unreadable (EACCES, EIO): its rows stay as they are, none read again
        if (e?.code !== 'ENOENT') for (const k of r.order) if (k.startsWith(`${root}\0`)) order.push(k);
        continue;
      }
      for (const name of list) { found.push({ root, worktree: name }); order.push(keyOf({ root, worktree: name })); }
    }
    if (ctx.stopped() || run !== r) return;
    r.order = order;
    const live = new Set(r.order);
    let changed = false;
    for (const k of [...r.seen.keys()]) if (!live.has(k)) { r.seen.delete(k); changed = true; }
    const publish = () => { const rows = r.order.flatMap((k) => (r.seen.get(k)?.row ? [r.seen.get(k).row] : [])); r.result = rows.length ? { worktrees: rows } : undefined; };
    if (changed) publish();
    for (const w of found) {
      const k = keyOf(w), was = r.seen.get(k);
      if (was && ctx.now() - was.began < DISK_EVERY_MS) continue;
      // its last du still alive (killed, not yet ended): not a second for it, and its row stays
      if ([...r.kids.values()].includes(k)) continue;
      // two alive at once: none more until one ends, and every row stays
      if (r.kids.size >= DISK_ALIVE) { ctx.say('two du are still alive after their kill: no more until one ends'); break; }
      const began = ctx.now();
      r.seen.set(k, { began, row: was?.row });
      const disk = await du(ctx, path.join(w.root, '.worktrees', w.worktree), r.kids, k);
      if (ctx.stopped() || run !== r) return;
      r.seen.set(k, { began, row: { root: w.root, worktree: w.worktree, ...(disk === undefined ? {} : { disk }), disk_at: boxHealthIso(ctx.now()) } });
      publish();
    }
  };
  return {
    start(ctx) {
      const r = { seen: new Map(), order: [], result: undefined, looking: false, kids: new Map() };
      run = r;
      ctx.every(DISK_LOOK_MS, async () => {
        if (r.looking || run !== r) return;
        r.looking = true;
        try { await look(ctx, r); } finally { r.looking = false; }
      });
    },
    part(ctx, parts) { return run?.result; },
    // a child still running is killed: its limit goes with the run's timers
    stop() { for (const c of run?.kids?.keys() ?? []) { try { c.kill('SIGKILL'); } catch {} } run = null; },
  };
})();
/* box-health-disk end */
/* box-health-state start */
// answer.box (kit-838): the box's last start, its OOM kills since, GitHub's allowance, and the kit's
// release against the newest one.
//   started_at  pid 1's start: <proc>/stat's btime plus <proc>/1/stat's start time (ticks, 100 a
//               second). In a container that is the container's start; on a machine, where pid 1
//               starts with it, the boot. Read once a run, at the first tick that can.
//   oom_kills   each tick, oom_kill in <cgroup>/memory.events (the box's, since its cgroup began with
//               it); where there is no cgroup of the box (no cpu.max, no memory.current), /proc's
//               vmstat oom_kill (the machine's, since boot). A box whose memory.events can't be read
//               has none: the host's is never given for it.
//   github      `gh api rate_limit` every 5 minutes of now(), the first at start: resources.core's
//               remaining (left), limit and reset (resets_at)
//   latest      `gh api repos/<KIT_UPSTREAM>/releases/latest --jq .tag_name` every hour of now(), the
//               first at start, when it is vX.Y.Z
//   kit         ctx.kit, the release serving the hub (startHub's kit), when there is one
// Each gh is one async child, never two of a kind alive at once (a killed one that hasn't closed
// keeps the next of its kind from starting, and its field as it is), killed at 30 s of real(). Its stderr is
// never read, its stdout only parsed, and nothing of either is said or kept: a missing or failing
// gh, or one whose output doesn't parse, leaves its field out until a later one answers. The
// sampler starts this part only when it is on, so no gh child starts unless it is; stop() kills one
// still running.
export const STATE_GITHUB_MS = 300000, STATE_LATEST_MS = 3600000, STATE_GH_MS = 30000, STATE_OUT_MAX = 65536;
export const boxHealthState = (() => {
  let run = null;
  const read = (...p) => { try { return fs.readFileSync(path.join(...p), 'utf8'); } catch { return null; } };
  // one gh: its stdout, or null when it failed, ran out of time or said too much
  const gh = (ctx, args, kids, kind) => new Promise((resolve) => {
    let out = '', done = false, end = () => {}, child;
    const finish = (v) => { if (done) return; done = true; end(); resolve(v); };
    try {
      child = spawn('gh', args, { stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } });
    } catch { ctx.say("gh can't be run: GitHub's allowance and the newest release are left out"); finish(null); return; }
    // alive until it closes: no second of its kind starts before that
    kids.set(child, kind);
    const gone = () => kids.delete(child);
    const kill = () => { try { child.kill('SIGKILL'); } catch {} };
    end = ctx.timeout(STATE_GH_MS, () => { kill(); ctx.say('a gh ran 30 s and was stopped'); finish(null); });
    child.on('error', () => { gone(); ctx.say("gh can't be run: GitHub's allowance and the newest release are left out"); finish(null); });
    child.stdout.on('data', (c) => { out += c; if (out.length > STATE_OUT_MAX) { kill(); finish(null); } });
    child.on('close', (code) => { gone(); finish(code === 0 ? out : null); });
  });
  const rate = (text) => {
    let core = null;
    try { core = JSON.parse(text ?? 'null')?.resources?.core; } catch { core = null; }
    const whole = (n) => Number.isSafeInteger(n) && n >= 0;
    if (!core || !whole(core.remaining) || !whole(core.limit)) return undefined;
    const resets = whole(core.reset) && core.reset > 0 ? time(core.reset * 1000) : undefined;
    const at = resets ? { resets_at: resets } : {};
    return { left: core.remaining, limit: core.limit, ...at };
  };
  // a time Date can hold (spec-1 F2): past it toISOString throws, so the field is left out
  const time = (ms) => (Number.isSafeInteger(ms) && ms >= 0 && ms <= 8.64e15 ? boxHealthIso(ms) : undefined);
  const tag = (text) => { const t = (text ?? '').trim(); return /^v\d+\.\d+\.\d+$/.test(t) ? t : undefined; };
  const startedAt = (ctx) => {
    const btime = /^btime (\d+)$/m.exec(read(ctx.proc, 'stat') ?? '');
    const one = procStat(read(ctx.proc, '1', 'stat') ?? '');
    if (!btime || !one) return undefined;
    const ms = Number(btime[1]) * 1000 + one.start * 1000 / PROC_HZ;
    return time(Math.round(ms));
  };
  const ooms = (ctx) => {
    const events = read(ctx.cgroup, 'memory.events');
    if (events !== null) return boxHealthField(events, 'oom_kill');
    const boxed = read(ctx.cgroup, 'cpu.max') !== null || read(ctx.cgroup, 'memory.current') !== null;
    return boxed ? undefined : boxHealthField(read(ctx.proc, 'vmstat'), 'oom_kill');
  };
  // every ms of now(), the first now; one of a kind alive at a time
  const each = (ctx, r, ms, args, take, field) => {
    const ask = async () => {
      // one of its kind still alive (running, or killed and not yet ended): none started, and the
      // field stays as it is
      if (run !== r || [...r.kids.values()].includes(field)) return;
      const got = take(await gh(ctx, args, r.kids, field));
      if (run === r) r[field] = got;
    };
    ctx.after(0, ask);
    ctx.every(ms, ask);
  };
  return {
    start(ctx) {
      const r = { started: undefined, github: undefined, latest: undefined, last: null, key: '', kids: new Map() };
      run = r;
      each(ctx, r, STATE_GITHUB_MS, ['api', 'rate_limit'], rate, 'github');
      each(ctx, r, STATE_LATEST_MS, ['api', `repos/${KIT_UPSTREAM}/releases/latest`, '--jq', '.tag_name'], tag, 'latest');
    },
    part(ctx, parts) {
      const r = run;
      if (!r) return undefined;
      r.started ??= startedAt(ctx);
      const kit = typeof ctx.kit === 'string' && ctx.kit ? ctx.kit : undefined;
      const box = boxHealthPresent({ started_at: r.started, oom_kills: ooms(ctx), github: r.github, kit, latest: r.latest });
      const key = JSON.stringify(box);
      // the same object while nothing changed, so the sampler checks it once
      if (key !== r.key) { r.key = key; r.last = { answer: { box } }; }
      return r.last;
    },
    // a child still running is killed: its limit goes with the run's timers
    stop() { for (const c of run?.kids?.keys() ?? []) { try { c.kill('SIGKILL'); } catch {} } run = null; },
  };
})();
/* box-health-state end */
