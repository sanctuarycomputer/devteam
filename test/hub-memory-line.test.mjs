// The hub's Overview shows the machine's memory (kit-593): a line under "This machine" with the
// working set of its cap, the ceiling, what a session costs and the last 24 hours, and, opened, what
// holds it by kind and by project. Its rules are a pure block of hub.html (box-memory), run here under
// node:vm on the machine-memory@1 fixture day; the page itself runs in headless Chrome against a
// fixture hub that serves that day as /memory.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { freePort, kit, testDir, until } from './lib/kit.mjs';
import { canDrive, openChrome } from './lib/chrome.mjs';

const hubHtml = () => fs.readFileSync(path.join(kit, 'dashboard', 'hub.html'), 'utf8');
// the box-memory block, run alone: it reads nothing outside its region
function memoryFns() {
  const html = hubHtml();
  const from = html.indexOf('/* box-memory start */');
  const src = html.slice(from, html.indexOf('/* box-memory end */'));
  assert.ok(from >= 0 && src.length > 500, 'the box-memory block is marked in hub.html');
  const ctx = vm.createContext({});
  vm.runInContext(`${src}\n;globalThis.api = { memoryView, memoryNow, memoryPlan, memoryMerge, memoryAnswer };`, ctx);
  return ctx.api;
}
const READINGS = fs.readFileSync(path.join(testDir, 'fixtures', 'box-memory', 'readings.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const LAST = READINGS.at(-1);
const END = Date.parse(LAST.at) + 60000;
const GB = 2 ** 30;
const plain = (v) => JSON.parse(JSON.stringify(v)); // out of the vm's realm, for deepEqual
const upTo = (at) => READINGS.filter((r) => Date.parse(r.at) <= Date.parse(at));
const lineOf = (r) => `Memory ${(r.working_set / GB).toFixed(1)} of ${Number.isInteger(r.max / GB) ? r.max / GB : (r.max / GB).toFixed(1)} GB · ${(r.working_set / GB / r.sessions).toFixed(2)} GB a session · ${r.sessions} session${r.sessions === 1 ? '' : 's'}`;
const DESIGN = { v: 1, at: '2026-11-18T01:40:00Z', working_set: 24125440000, max: 51539607552, ceiling: 0.8, source: 'cgroup', sessions: 33 };
const T0 = Date.parse(DESIGN.at) + 30000;
const KIND_NAMES = ['Agents', 'Browsers', 'Installs', 'devteam\'s own processes', 'Other node', 'Other'];
const SUB_NAMES = { dashboard: 'Project dashboards', hello: 'Dashboard status checks', 'dashboard-data': 'Dashboard page data', 'accounts-tick': 'Session restarts', wait: 'Supervisors waiting', gate: 'Test and check runs' };

test('the line, the bar and the per-session cost', () => {
  const { memoryView } = memoryFns();
  let v = memoryView([DESIGN], T0);
  assert.equal(v.line, 'Memory 22.5 of 48 GB · 0.68 GB a session · 33 sessions');
  assert.equal(v.label, '22.5 of 48 GB in use; new work waits at 38.4 GB');
  v = memoryView(READINGS, END);
  assert.equal(v.line, lineOf(LAST));
  assert.ok(Math.abs(v.bar.share - LAST.working_set / LAST.max) < 1e-9);
  assert.equal(v.bar.ceiling, 0.8);
  assert.equal(v.bar.full, false);
  assert.notEqual(v.tail?.tone, 'amber');
  assert.equal(v.spark.full, false);
  // one session, none, and a machine that doesn't count them
  assert.equal(memoryView([{ ...DESIGN, sessions: 1 }], T0).line, 'Memory 22.5 of 48 GB · 22.47 GB a session · 1 session');
  assert.equal(memoryView([{ ...DESIGN, sessions: 0 }], T0).line, 'Memory 22.5 of 48 GB · 0 sessions');
  const { sessions, ...none } = DESIGN;
  assert.equal(memoryView([none], T0).line, 'Memory 22.5 of 48 GB');
  // a cap that isn't whole GB has one decimal
  assert.equal(memoryView([{ ...none, max: 1.5 * 51539607552 }], T0).line, 'Memory 22.5 of 72 GB');
  assert.equal(memoryView([{ ...none, max: 50 * GB + GB / 4 }], T0).line, 'Memory 22.5 of 50.3 GB');
  // the browser's clock behind the box's: the newest reading still shows
  assert.equal(memoryView(READINGS, Date.parse(LAST.at) - 120000).line, lineOf(LAST));
  // one reading stamped a day ahead of the clock is ignored for now, and not shown
  const ahead = { ...LAST, at: new Date(Date.parse(LAST.at) + 864e5).toISOString(), working_set: 40 * GB };
  assert.equal(memoryView([...READINGS, ahead], END).line, lineOf(LAST));
  // a partial reading is a reading
  const partial = READINGS.find((r) => r.partial === true);
  assert.equal(memoryView(upTo(partial.at), Date.parse(partial.at) + 1000).line, lineOf(partial));
});

test('view without max or ceiling', () => {
  const { memoryView } = memoryFns();
  const { max, ...noMax } = DESIGN;
  const v = memoryView([noMax], T0);
  assert.equal(v.line, 'Memory 22.5 GB in use · 0.68 GB a session · 33 sessions');
  assert.equal(v.bar, null);
  assert.equal(v.tail, null);
  assert.match(v.spark.d, /^M/);
  const { ceiling, ...noCeiling } = DESIGN;
  const w = memoryView([{ ...noCeiling, working_set: Math.round(0.99 * DESIGN.max) }], T0);
  assert.equal(w.bar.ceiling, null);
  assert.equal(w.bar.full, false);
  assert.equal(w.spark.ceilY, null);
  assert.equal(w.tail, null);
  assert.doesNotMatch(w.label, /waits/);
});

test('amber at or over the reading\'s ceiling', () => {
  const { memoryView } = memoryFns();
  const i = READINGS.findIndex((r) => r.working_set >= r.ceiling * r.max);
  assert.ok(i > 0, 'the fixture crosses the ceiling');
  const at = READINGS[i].at;
  let v = memoryView(upTo(at), Date.parse(at) + 1000);
  assert.equal(v.bar.full, true);
  assert.equal(v.spark.full, true);
  assert.equal(v.tail.tone, 'amber');
  assert.equal(v.tail.text, 'at the ceiling (38.4 GB): new work waits for room');
  const before = READINGS[i - 1].at;
  v = memoryView(upTo(before), Date.parse(before) + 1000);
  assert.equal(v.bar.full, false);
  assert.notEqual(v.tail?.tone, 'amber');
  // the reading's own ceiling, not a fixed 0.8
  v = memoryView([{ ...DESIGN, ceiling: 0.6, working_set: Math.round(0.65 * DESIGN.max) }], T0);
  assert.equal(v.bar.full, true);
  assert.equal(v.bar.ceiling, 0.6);
  assert.ok(Math.abs(v.spark.ceilY - (32 - 0.6 * 30)) < 0.01, `ceilY ${v.spark.ceilY}`);
  assert.match(v.tail.text, /\(28\.8 GB\)/);
  assert.match(v.label, /waits at 28\.8 GB/);
  // exactly at the ceiling is at it
  const at75 = 0.75 * DESIGN.max;
  assert.ok(Number.isSafeInteger(at75));
  assert.equal(memoryView([{ ...DESIGN, ceiling: 0.75, working_set: at75 }], T0).bar.full, true, 'exactly at the ceiling');
  assert.equal(memoryView([{ ...DESIGN, ceiling: 0.75, working_set: at75 - 1 }], T0).bar.full, false, 'a byte under');
  // more than the cap (a cgroup over its limit for a moment): the bar is full width, not wider
  assert.equal(memoryView([{ ...DESIGN, working_set: DESIGN.max + GB }], T0).bar.share, 1);
});

test('kinds in plain names, the subcommand only in a title', () => {
  const { memoryView } = memoryFns();
  const check = (r) => {
    const rows = plain(memoryView(upTo(r.at), Date.parse(r.at) + 1000).kinds);
    const top = rows.filter((x) => !x.sub);
    assert.ok(top.every((x) => KIND_NAMES.includes(x.name)), top.map((x) => x.name).join(', '));
    assert.equal(top.length, Object.keys(r.kinds).length);
    const bytes = (x) => r.kinds[{ Agents: 'agent', Browsers: 'browser', Installs: 'install', 'devteam\'s own processes': 'devteam', 'Other node': 'node', Other: 'other' }[x.name]].rss;
    for (let k = 1; k < top.length; k++) assert.ok(bytes(top[k - 1]) >= bytes(top[k]), 'largest first');
    const sum = top.reduce((a, x) => a + Number(x.gb), 0);
    const want = Object.values(r.kinds).reduce((a, k) => a + k.rss, 0) / GB;
    assert.ok(Math.abs(sum - want) <= 0.05 * top.length + 1e-9, `${sum} vs ${want}`);
    assert.ok(top.every((x) => Number.isInteger(x.share) && x.share >= 0 && x.share <= 100));
    for (const x of rows) assert.doesNotMatch(x.name, /\b(dashboard-data|accounts-tick|hello|wait|gate|metrics|dashboard)\b/, x.name);
    // the sub rows sit right under devteam's own processes
    const d = rows.findIndex((x) => x.name === 'devteam\'s own processes');
    const subs = [];
    for (let k = d + 1; k < rows.length && rows[k].sub; k++) subs.push(rows[k]);
    assert.equal(rows.filter((x) => x.sub).length, subs.length, 'every sub row is under devteam\'s own processes');
    for (const s of subs) {
      if (s.name === 'Other devteam commands') assert.match(s.title, /^(devteam\.mjs [a-z-]+(, devteam\.mjs [a-z-]+)*)?$/);
      else assert.equal(s.title, `devteam.mjs ${Object.keys(SUB_NAMES).find((k) => SUB_NAMES[k] === s.name)}`);
    }
    const named = subs.filter((s) => s.name !== 'Other devteam commands');
    for (let k = 1; k < named.length; k++) assert.ok(Number(named[k - 1].gb) >= Number(named[k].gb), 'sub rows largest first');
    if (subs.some((s) => s.name === 'Other devteam commands')) assert.equal(subs.at(-1).name, 'Other devteam commands', 'Other devteam commands last');
    return subs;
  };
  check(LAST);
  const ten = READINGS.find((r) => r.at === '2026-11-17T10:00:00Z');
  const subs = check(ten);
  for (const n of Object.values(SUB_NAMES)) assert.ok(subs.some((s) => s.name === n), `${n} at 10:00`);
  const other = subs.find((s) => s.name === 'Other devteam commands');
  assert.equal(other.title, 'devteam.mjs metrics', 'metrics, not in the plain list, only in a title');
  // Other devteam commands holds the other subcommands and what the split doesn't cover
  const split = Object.values(ten.devteam).reduce((a, e) => a + e.rss, 0);
  assert.ok(ten.kinds.devteam.rss > split, 'the fixture leaves part of the devteam kind unsplit');
  assert.equal(other.gb, ((ten.devteam.metrics.rss + ten.kinds.devteam.rss - split) / GB).toFixed(1));
  // only an uncovered part: the row, with no title; a split that covers it all: no row
  const r = { ...DESIGN, kinds: { devteam: { n: 3, rss: 3 * GB } }, devteam: { wait: { n: 1, rss: GB } } };
  assert.deepEqual(plain(memoryView([r], T0).kinds.filter((x) => x.sub)), [{ name: 'Supervisors waiting', gb: '1.0', share: 33, title: 'devteam.mjs wait', sub: true }, { name: 'Other devteam commands', gb: '2.0', share: 67, title: '', sub: true }]);
  assert.deepEqual(plain(memoryView([{ ...r, kinds: { devteam: { n: 1, rss: GB } } }], T0).kinds.map((x) => x.name)), ['devteam\'s own processes', 'Supervisors waiting']);
  // a split that adds up to more than the kind (two reads a moment apart): the other subcommands, no less
  const over = { ...r, kinds: { devteam: { n: 2, rss: GB } }, devteam: { wait: { n: 1, rss: GB }, metrics: { n: 1, rss: GB / 2 } } };
  assert.equal(memoryView([over], T0).kinds.find((x) => x.name === 'Other devteam commands').gb, '0.5');
});

test('projects largest first', () => {
  const { memoryView } = memoryFns();
  let rows = plain(memoryView(READINGS, END).projects);
  assert.deepEqual(rows.map((x) => x.name), ['mothership · 2 sessions', 'devteam-dev · 1 session']);
  assert.ok(rows.every((x) => !x.sub && x.title === ''));
  const zero = READINGS.find((r) => r.projects['devteam-dev'].sessions === 0);
  rows = plain(memoryView(upTo(zero.at), Date.parse(zero.at) + 1000).projects);
  assert.ok(rows.some((x) => x.name === 'devteam-dev'), 'no sessions part at 0');
  const long = 'p'.repeat(100);
  rows = plain(memoryView([{ ...LAST, at: DESIGN.at, projects: { [long]: { rss: 5, sessions: 0 } } }], T0).projects);
  assert.equal(rows[0].name, 'p'.repeat(64));
  // a project with no rss counts as nothing, never NaN
  rows = plain(memoryView([{ ...LAST, at: DESIGN.at, projects: { a: { sessions: 2 }, b: { rss: GB } } }], T0).projects);
  assert.deepEqual(rows.map((x) => [x.name, x.gb, x.share]), [['b', '1.0', 100], ['a · 2 sessions', '0.0', 0]]);
});

test('a gap where readings are missing', () => {
  const { memoryView } = memoryFns();
  let v = memoryView(READINGS, END);
  assert.deepEqual(plain(v.spark.gaps).map((g) => [g.from, g.to]), [['2026-11-17T03:09:00Z', '2026-11-17T03:50:00Z']]);
  const g = v.spark.gaps[0];
  assert.ok(g.x > 0 && g.w > 0 && g.x + g.w < 360, JSON.stringify(g));
  assert.equal(v.spark.d.match(/M/g).length, 2, 'the pen lifts across the gap');
  assert.deepEqual(plain(v.tail), { tone: 'dim', text: 'restarted 20 hours ago' });
  const later = READINGS.filter((r) => r.at >= '2026-11-17T04:00:00Z');
  v = memoryView(later, END);
  assert.equal(v.spark.gaps.length, 0);
  assert.equal(v.spark.d.match(/M/g).length, 1);
  assert.equal(v.tail, null);
  // the words for a gap that ended minutes, or an hour, ago
  assert.equal(memoryView(upTo('2026-11-17T04:05:00Z'), Date.parse('2026-11-17T04:05:30Z')).tail.text, 'restarted 15 minutes ago');
  assert.equal(memoryView(upTo('2026-11-17T04:55:00Z'), Date.parse('2026-11-17T04:55:30Z')).tail.text, 'restarted 1 hour ago');
  assert.equal(memoryView(upTo('2026-11-17T05:49:00Z'), Date.parse('2026-11-17T05:49:30Z')).tail.text, 'restarted 1 hour ago', 'hours round down');
  assert.equal(memoryView(upTo('2026-11-17T05:50:00Z'), Date.parse('2026-11-17T05:50:30Z')).tail.text, 'restarted 2 hours ago');
  assert.equal(memoryView(upTo('2026-11-17T03:50:00Z'), Date.parse('2026-11-17T03:50:20Z')).tail.text, 'restarted 1 minute ago', 'under a minute reads as one');
});

test('no reading, nothing', () => {
  const { memoryView } = memoryFns();
  assert.equal(memoryView([], END), null);
  assert.equal(memoryView(READINGS, END + 3 * 864e5), null, 'all older than 24 hours');
  assert.equal(memoryView([{}, { at: 'x', working_set: 1 }, { at: DESIGN.at, working_set: '1' }, null, 7], T0), null);
  assert.equal(memoryView(null, T0), null);
});

test('a laptop: the line and the sparkline, no kinds', () => {
  const { memoryView } = memoryFns();
  const v = memoryView([{ v: 1, at: DESIGN.at, working_set: 12025908428, max: 17179869184, source: 'os' }], T0);
  assert.equal(v.line, 'Memory 11.2 of 16 GB');
  assert.match(v.spark.d, /^M/);
  assert.equal(v.kinds, null);
  assert.equal(v.projects, null);
});

test('the fetch plan: the day once, then after= once a minute', () => {
  const { memoryPlan, memoryMerge } = memoryFns();
  const t0 = END;
  let s = { day: [], askedAt: 0, inFlight: false };
  assert.equal(memoryPlan(s, t0), 'memory.json?since=24h');
  assert.equal(memoryPlan({ ...s, inFlight: true }, t0), null, 'nothing while a request is out');
  s = { day: memoryMerge([], READINGS, t0), askedAt: t0, inFlight: false };
  for (const sec of [10, 20, 30, 40, 50]) assert.equal(memoryPlan(s, t0 + sec * 1000), null, `+${sec} s, the redraw's beat`);
  const after = `memory.json?after=${encodeURIComponent(LAST.at)}`;
  assert.equal(memoryPlan(s, t0 + 59500), after, 'a timer a few ms early still asks');
  assert.equal(memoryPlan(s, t0 + 60000), after);
  assert.equal(memoryPlan({ ...s, inFlight: true }, t0 + 60000), null);
  s = { ...s, askedAt: t0 + 60000 };
  assert.equal(memoryPlan(s, t0 + 110000), null);
  assert.equal(memoryPlan(s, t0 + 120000), after);
  // no day yet, but asked a moment ago: wait the minute
  assert.equal(memoryPlan({ day: [], askedAt: t0 + 120000, inFlight: false }, t0 + 130000), null);
  assert.equal(memoryPlan({ day: [], askedAt: t0 + 120000, inFlight: false }, t0 + 180000), 'memory.json?since=24h');
  assert.equal(memoryPlan({ day: [], askedAt: 0, inFlight: false }, t0 + 130000), 'memory.json?since=24h', 'askedAt 0 asks at once');
});

test('the merge', () => {
  const { memoryMerge } = memoryFns();
  const day = memoryMerge([], READINGS, END);
  assert.equal(day.length, READINGS.length);
  assert.equal(memoryMerge(day, READINGS.slice(-10), END).length, day.length, 'an overlap isn\'t doubled');
  assert.equal(memoryMerge(day, [{ ...LAST, at: LAST.at.replace('Z', '.000Z') }], END).length, day.length, 'one instant, two spellings');
  const n1 = { ...LAST, at: '2026-11-18T00:00:00Z' }, n2 = { ...LAST, at: '2026-11-18T00:01:00Z' };
  const more = memoryMerge(day, [n2, n1], END + 120000);
  assert.deepEqual(plain(more.slice(-2).map((r) => r.at)), [n1.at, n2.at]);
  assert.ok(more.every((r) => Date.parse(r.at) >= END + 120000 - 864e5), 'what fell out of 24 hours is gone');
  assert.ok(more.length < day.length + 2);
  for (let k = 1; k < more.length; k++) assert.ok(Date.parse(more[k - 1].at) < Date.parse(more[k].at));
});

test('the answers: merge, reload on a refused after, keep the day on anything else', () => {
  const { memoryAnswer, memoryPlan } = memoryFns();
  const since = 'memory.json?since=24h';
  let s = memoryAnswer({ day: [], askedAt: END, inFlight: true }, since, 200, { v: 1, readings: READINGS }, END);
  assert.equal(s.day.length, READINGS.length);
  assert.equal(s.inFlight, false);
  assert.equal(s.askedAt, END);
  const after = `memory.json?after=${encodeURIComponent(LAST.at)}`;
  const n1 = { ...LAST, at: '2026-11-18T00:00:00Z' }, n2 = { ...LAST, at: '2026-11-18T00:01:00Z' };
  s = memoryAnswer({ ...s, askedAt: END + 60000, inFlight: true }, after, 200, { v: 1, readings: [n1, n2] }, END + 60000);
  assert.equal(s.day.at(-1).at, n2.at);
  assert.equal(memoryPlan(s, END + 120000), `memory.json?after=${encodeURIComponent(n2.at)}`);
  const kept = s.day.length;
  for (const [status, body] of [[401, null], [404, null], [502, { error: 'the hub isn\'t answering' }], [0, null], [200, {}], [200, 'x'], [200, { readings: 'no' }], [400, null]]) {
    const url = status === 400 ? since : after; // a 400 to since= is not the refusal of an old after
    const t = memoryAnswer({ ...s, inFlight: true }, url, status, body, END + 120000);
    assert.equal(t.day.length, kept, `${status} keeps the day`);
    assert.equal(t.day.at(-1).at, n2.at);
    assert.equal(t.inFlight, false);
    assert.equal(t.askedAt, s.askedAt);
  }
  const r = memoryAnswer({ ...s, inFlight: true }, after, 400, { error: 'too old' }, END + 120000);
  assert.equal(r.day.length, 0);
  assert.equal(r.askedAt, 0);
  assert.equal(r.inFlight, false);
  assert.equal(memoryPlan(r, END + 120001), since, 'the day again, at once');
});

// ----- the page, in headless Chrome ---------------------------------------------------------------
// A test's cleanup, as in hub-overview.test.mjs: the last step added runs first, every step runs,
// each bounded, and the first error is the one thrown.
async function runSteps(steps, ms = 30000) {
  let first = null;
  for (const step of [...steps].reverse()) {
    let timer;
    const limit = new Promise((_, no) => { timer = setTimeout(() => no(new Error(`cleanup step did not settle in ${ms / 1000} s`)), ms); });
    try { await Promise.race([Promise.resolve().then(step), limit]); } catch (e) { first ??= e; } finally { clearTimeout(timer); }
  }
  return first;
}
const cleanups = new WeakMap();
function defer(t, fn) {
  let steps = cleanups.get(t);
  if (!steps) { steps = []; cleanups.set(t, steps); t.after(async () => { const e = await runSteps(steps); if (e) throw e; }); }
  steps.push(fn);
}
async function listenOn(t, srv, port = 0, host = '127.0.0.1') {
  await new Promise((r) => srv.listen(port, host, r));
  defer(t, () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }));
  return srv.address().port;
}
// the fixture day moved so its last reading is a minute old
const shifted = (readings, lastAgo = 60000) => { const by = Date.now() - lastAgo - Date.parse(readings.at(-1).at); return readings.map((r) => ({ ...r, at: new Date(Date.parse(r.at) + by).toISOString().replace('.000Z', 'Z') })); };
function hello(name, port) {
  return { devteam: 1, name, root: `/srv/${name}`, port, kit: 'v0.64.0', viewer: 1, inbox: 0, threads: { you: 0, waiting: 0, ready: 0 }, fleet: { mode: 'run', workers: 1 }, pulse: { state: 'moving', blocking: null, working: 1, last_activity: new Date().toISOString(), activity: Array(84).fill(0), activity_of: 'commits', attention: [], open_tickets: 2, done_tickets: 1, blocked_tickets: 0, goals_open: 1, goal: { title: `${name}'s goal`, done: 1, total: 3 } } };
}
// A hub serving hub.html, instances.json and /memory.json from F.readings (mode: ok, 404, junk,
// refuse-after, 502-after); F.asks holds each /memory.json query
async function memoryHub(t, { readings = [], projects = [] } = {}) {
  const F = { readings, mode: 'ok', asks: [], list: [] };
  for (const name of projects) {
    const port = await listenOn(t, http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end('<!doctype html><title>stand-in</title>'); }));
    F.list.push(hello(name, port));
  }
  const hubPort = await listenOn(t, http.createServer((q, s) => {
    const u = new URL(q.url, 'http://x');
    const send = (code, body, type = 'application/json') => { s.writeHead(code, { 'content-type': type }); s.end(typeof body === 'string' ? body : JSON.stringify(body)); };
    if (u.pathname === '/') return send(200, hubHtml(), 'text/html');
    if (u.pathname === '/instances.json') return send(200, { hub: 1, kit: 'v0.64.0', instances: F.list });
    if (u.pathname === '/memory.json') {
      F.asks.push(u.search.slice(1));
      const after = u.searchParams.get('after');
      if (F.mode === '404') return send(404, {});
      if (F.mode === 'junk') return send(200, 'not json', 'text/plain');
      if (after && F.mode === 'refuse-after') return send(400, { error: 'after is more than 6 hours back' });
      if (after && F.mode === '502-after') return send(502, { error: 'the hub isn\'t answering' });
      return send(200, { v: 1, readings: after ? F.readings.filter((r) => Date.parse(r.at) > Date.parse(after)) : F.readings });
    }
    send(404, {});
  }));
  F.url = `http://127.0.0.1:${hubPort}/#overview`;
  return F;
}
// Chrome on the hub, at a size and in a theme, with the page's errors kept in window.__errs
async function hubPage(t, url, { width = 1440, height = 900, scheme = 'light' } = {}) {
  const chrome = await openChrome();
  defer(t, () => chrome.close());
  const p = await chrome.newPage();
  defer(t, () => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__errs = []; addEventListener("error", (e) => __errs.push(String(e.message))); addEventListener("unhandledrejection", (e) => __errs.push(String(e.reason)));' });
  // every setInterval the page sets, by its function's name and delay
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__timers = []; const si = window.setInterval; window.setInterval = function (f, ms, ...a) { __timers.push([f && f.name, ms]); return si.call(this, f, ms, ...a); };' });
  await p.send('Page.navigate', { url });
  p.until = (what, expr) => until(() => p.ev(expr).catch(() => false), what);
  return p;
}
const CHROME = { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 };
// a token's colour as the page computes it
const tokenColor = (prop, token) => `(() => { const d = document.createElement('div'); d.style.${prop} = 'var(${token})'; document.body.append(d); const c = getComputedStyle(d).${prop}; d.remove(); return c; })()`;
const tick = (p) => p.ev('(async () => { MEM.askedAt = 1; await memoryTick(); return true; })()');

test('no /memory.json: the Overview is as before', CHROME, async (t) => {
  for (const mode of ['404', 'junk']) {
    const F = await memoryHub(t, { projects: ['alpha'] });
    F.mode = mode;
    const p = await hubPage(t, F.url);
    await p.until('the card', `document.querySelectorAll('.ov-card').length === 1`);
    await until(() => F.asks.length >= 1, 'the page asked for the day');
    await p.ev('new Promise((r) => setTimeout(r, 300))');
    await p.ev('paintOverview()');
    assert.equal(await p.ev(`document.querySelectorAll('#ov-body .mem').length`), 0, `${mode}: no memory line`);
    assert.deepEqual(await p.ev('[...document.querySelector("#ov-body").children].map((c) => c.className)'), ['ov-head', 'g12'], 'the head, then the cards');
    assert.deepEqual(await p.ev('window.__errs'), [], `${mode}: no page error`);
  }
});

test('the memory line on the Overview', CHROME, async (t) => {
  const { memoryView } = memoryFns();
  const day = shifted(READINGS);
  const F = await memoryHub(t, { readings: day, projects: ['alpha'] });
  const p = await hubPage(t, F.url);
  await p.until('the memory line', `!!document.querySelector('#ov-body > .mem')`);
  await p.until('the card', `document.querySelectorAll('.ov-card').length === 1`);
  assert.deepEqual(await p.ev('[...document.querySelector("#ov-body").children].map((c) => c.className.split(" ")[0])'), ['ov-head', 'mem', 'g12'], 'under the head, before the cards');
  const v = memoryView(day, Date.now());
  assert.equal(await p.ev(`document.querySelector('.mem-words').textContent`), `${v.line} · ${v.tail.text}`);
  assert.match(v.tail.text, /^restarted \d+ hours ago$/);
  const bar = await p.ev(`(() => { const b = document.querySelector('.mem-bar').getBoundingClientRect(), f = document.querySelector('.mem-bar > i').getBoundingClientRect(), c = document.querySelector('.mem-bar > .ceil').getBoundingClientRect(); return { share: f.width / b.width, ceil: (c.left + c.width / 2 - b.left) / b.width, label: document.querySelector('.mem-bar').getAttribute('aria-label') }; })()`);
  assert.ok(Math.abs(bar.share - v.bar.share) < 0.02, `fill ${bar.share} vs ${v.bar.share}`);
  assert.ok(Math.abs(bar.ceil - 0.8) < 0.02, `ceiling mark at ${bar.ceil}`);
  assert.equal(bar.label, v.label);
  const spark = await p.ev(`(() => { const s = document.querySelector('.mem-spark svg'); return { m: (s.querySelector('path').getAttribute('d').match(/M/g) || []).length, gaps: [...s.querySelectorAll('rect.gap')].map((r) => r.querySelector('title').textContent), ceil: !!s.querySelector('line.ceil') }; })()`);
  const gap = v.spark.gaps[0];
  assert.deepEqual(spark, { m: 2, gaps: [`No readings from ${gap.from.slice(11, 16)} to ${gap.to.slice(11, 16)}`], ceil: true });
  assert.equal(await p.ev(`document.querySelector('.mem-open').textContent`), 'What holds it');
  assert.equal(await p.ev(`document.querySelector('.mem').classList.contains('full')`), false);
  // at the ceiling: amber, and the words say new work waits
  const i = READINGS.findIndex((r) => r.working_set >= r.ceiling * r.max);
  F.readings = shifted(READINGS.slice(0, i + 1));
  await p.ev('MEM.day = []; MEM.askedAt = 0; memoryTick()');
  await p.until('amber', `document.querySelector('.mem')?.classList.contains('full')`);
  assert.equal(await p.ev(`getComputedStyle(document.querySelector('.mem-bar > i')).backgroundColor`), await p.ev(tokenColor('backgroundColor', '--amber')));
  assert.equal(await p.ev(`getComputedStyle(document.querySelector('.mem-spark path')).stroke`), await p.ev(tokenColor('color', '--amber')));
  assert.match(await p.ev(`document.querySelector('.mem-words .amber').textContent`), /new work waits for room$/);
  assert.equal(await p.ev(`getComputedStyle(document.querySelector('.mem-words .amber')).color`), await p.ev(tokenColor('color', '--amber-fg')));
  // the mark sits at the reading's own ceiling, and a tick repaints at once (no wait for the redraw)
  F.readings = shifted(READINGS).map((r) => ({ ...r, ceiling: 0.6 }));
  await p.ev('(async () => { MEM.day = []; MEM.askedAt = 0; await memoryTick(); })()');
  const at = await p.ev(`(() => { const b = document.querySelector('.mem-bar').getBoundingClientRect(), c = document.querySelector('.mem-bar > .ceil').getBoundingClientRect(); return (c.left + c.width / 2 - b.left) / b.width; })()`);
  assert.ok(Math.abs(at - 0.6) < 0.02, `ceiling mark at ${at}`);
  assert.match(await p.ev(`document.querySelector('.mem-bar').getAttribute('aria-label')`), /waits at 28\.8 GB$/);
  assert.deepEqual(await p.ev('window.__errs'), []);
});

test('What holds it: open across the redraw, closed by its button and Escape', CHROME, async (t) => {
  const { memoryView } = memoryFns();
  const day = shifted(READINGS);
  const F = await memoryHub(t, { readings: day, projects: ['alpha'] });
  const p = await hubPage(t, F.url);
  await p.until('the button and the card', `!!document.querySelector('.mem-open') && document.querySelectorAll('.ov-card').length === 1`);
  assert.equal(await p.ev(`document.getElementById('mem-holds').hidden`), true);
  await p.click('.mem-open');
  await p.until('open', `document.getElementById('mem-holds')?.hidden === false`);
  const v = memoryView(day, Date.now());
  assert.deepEqual(await p.ev(`[...document.querySelectorAll('#mem-holds caption')].map((c) => c.textContent)`), ['By kind', 'By project']);
  assert.deepEqual(await p.ev(`[...document.querySelectorAll('#mem-holds table')[0].querySelectorAll('tr')].map((r) => [r.cells[0].textContent, r.cells[1].textContent, r.classList.contains('sub'), r.title])`), plain(v.kinds.map((r) => [r.name, `${r.gb} GB`, r.sub, r.title])));
  assert.deepEqual(await p.ev(`[...document.querySelectorAll('#mem-holds table')[1].querySelectorAll('tr')].map((r) => r.cells[0].textContent)`), plain(v.projects.map((r) => r.name)));
  assert.deepEqual(await p.ev(`[document.querySelector('.mem-open').textContent, document.querySelector('.mem-open').getAttribute('aria-expanded'), document.activeElement?.dataset.k]`), ['Hide', 'true', 'overview:memory']);
  // the 10 s redraw, five times: still open, the keyboard where it was, and no new request
  for (let k = 0; k < 5; k++) await p.ev('draw()');
  await p.ev('paintOverview()');
  assert.deepEqual(await p.ev(`[document.getElementById('mem-holds').hidden, document.activeElement?.dataset.k]`), [false, 'overview:memory']);
  assert.deepEqual(F.asks, ['since=24h'], 'one request: the redraw asks nothing');
  assert.deepEqual(await p.ev(`__timers.filter(([n]) => n === 'memoryTick')`), [['memoryTick', 60000]], 'one minute timer, however many redraws');
  assert.equal(await p.ev(`document.querySelector('.mem-open').getAttribute('aria-controls')`), 'mem-holds');
  // a hidden page asks nothing
  await p.ev(`(async () => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); MEM.askedAt = 1; await memoryTick(); delete document.hidden; })()`);
  assert.deepEqual(F.asks, ['since=24h'], 'nothing while hidden');
  // its button closes it
  await p.click('.mem-open');
  await p.until('closed', `document.getElementById('mem-holds').hidden === true`);
  assert.equal(await p.ev(`document.querySelector('.mem-open').textContent`), 'What holds it');
  // Enter opens it, Escape closes it and the keyboard stays on the button
  // (the helper's key() sends no text for Enter, and a button acts on Enter's character)
  for (const type of ['keyDown', 'keyUp']) await p.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) });
  await p.until('open by Enter', `document.getElementById('mem-holds').hidden === false`);
  await p.key('Escape');
  await p.until('closed by Escape', `document.getElementById('mem-holds').hidden === true`);
  assert.equal(await p.ev('document.activeElement?.dataset.k'), 'overview:memory');
  // with the keyboard nowhere (on the page's body): Escape closes it and puts the keyboard on its button
  await p.click('.mem-open');
  await p.until('open from a click', `document.getElementById('mem-holds').hidden === false`);
  await p.ev('document.activeElement.blur()');
  assert.equal(await p.ev('document.activeElement === document.body'), true);
  await p.key('Escape');
  await p.until('closed from the body', `document.getElementById('mem-holds').hidden === true`);
  assert.equal(await p.ev('document.activeElement?.dataset.k'), 'overview:memory');
  // with the ⋯ menu open too, one Escape closes only the menu
  await p.click('.mem-open');
  await p.until('open again', `document.getElementById('mem-holds').hidden === false`);
  await p.click('.ov-card .menu-btn');
  await p.until('the menu', `!!document.querySelector('.menu-pop')`);
  await p.key('Escape');
  await p.until('the menu closed', `!document.querySelector('.menu-pop')`);
  assert.deepEqual(await p.ev(`[document.getElementById('mem-holds').hidden, document.activeElement?.dataset.k]`), [false, '/srv/alpha:menu']);
  await p.ev(`document.querySelector('.mem-open').focus()`);
  await p.key('Escape');
  await p.until('then the table', `document.getElementById('mem-holds').hidden === true`);
  assert.deepEqual(await p.ev('window.__errs'), []);
});

test('a project named with markup is text', CHROME, async (t) => {
  const name = '<img src=x onerror="window.__xss = 1">';
  const day = shifted(READINGS);
  day[day.length - 1] = { ...day.at(-1), projects: { [name]: { rss: 5 * GB, sessions: 2 } } };
  const F = await memoryHub(t, { readings: day });
  const p = await hubPage(t, F.url);
  await p.until('the button', `!!document.querySelector('.mem-open')`);
  await p.click('.mem-open');
  await p.until('open', `document.getElementById('mem-holds')?.hidden === false`);
  assert.equal(await p.ev(`document.querySelectorAll('#mem-holds table')[1].rows[0].cells[0].textContent`), `${name} · 2 sessions`);
  assert.equal(await p.ev(`document.querySelectorAll('.mem img').length`), 0);
  assert.equal(await p.ev('window.__xss ?? null'), null);
});

test('the after request, and a refused after reloads the day', CHROME, async (t) => {
  const day = shifted(READINGS);
  const F = await memoryHub(t, { readings: day });
  const p = await hubPage(t, F.url);
  await p.until('the memory line', `!!document.querySelector('.mem')`);
  assert.deepEqual(F.asks, ['since=24h']);
  // a minute on: what's newer than the newest
  F.readings = [...day, { ...day.at(-1), at: new Date(Date.parse(day.at(-1).at) + 60000).toISOString().replace('.000Z', 'Z') }];
  await tick(p);
  assert.equal(F.asks[1], `after=${encodeURIComponent(day.at(-1).at)}`);
  assert.equal(await p.ev('MEM.day.at(-1).at'), F.readings.at(-1).at, 'merged into the day');
  // the hub restarting (502): the line stays, and the next tick asks after= again
  F.mode = '502-after';
  await tick(p);
  assert.match(F.asks.at(-1), /^after=/);
  assert.equal(await p.ev(`!!document.querySelector('.mem')`), true, 'the last good day stays');
  await tick(p);
  assert.match(F.asks.at(-1), /^after=/);
  // refused (400): the day again
  F.mode = 'refuse-after';
  const n = F.asks.length;
  await tick(p);
  assert.match(F.asks[n], /^after=/);
  assert.equal(F.asks[n + 1], 'since=24h', 'the day asked again at once, by the same tick');
  assert.equal(await p.ev(`!!document.querySelector('.mem')`), true, 'and drawn again');
  assert.deepEqual(await p.ev('window.__errs'), []);
});

test('a laptop reading: the line and sparkline, no button', CHROME, async (t) => {
  const F = await memoryHub(t, { readings: shifted(READINGS) });
  const p = await hubPage(t, F.url);
  await p.until('the button', `!!document.querySelector('.mem-open')`);
  await p.click('.mem-open');
  await p.until('open', `document.getElementById('mem-holds')?.hidden === false`);
  F.readings = shifted([{ v: 1, at: '2026-11-17T23:59:00Z', working_set: 12025908428, max: 17179869184, source: 'os' }]);
  await p.ev('(async () => { MEM.day = []; MEM.askedAt = 0; await memoryTick(); })()');
  await p.until('the laptop line', `document.querySelector('.mem-words')?.textContent === 'Memory 11.2 of 16 GB'`);
  assert.deepEqual(await p.ev(`[!!document.querySelector('.mem-spark svg path'), !!document.querySelector('.mem-open'), !!document.getElementById('mem-holds'), MEM.open]`), [true, false, false, false]);
});

test('the half-grid rule and the small screen', CHROME, async (t) => {
  const day = shifted(READINGS);
  const F = await memoryHub(t, { readings: day, projects: ['alpha', 'beta'] });
  const p = await hubPage(t, F.url);
  await p.until('the memory line', `!!document.querySelector('.mem-open')`);
  const w = await p.ev(`(() => { const d = document.createElement('div'); d.style.width = 'var(--measure)'; document.body.append(d); const m = d.getBoundingClientRect().width; d.remove(); const e = document.querySelector('.mem-words'); return { tag: e.tagName, max: getComputedStyle(e).maxWidth, measure: m, width: e.getBoundingClientRect().width }; })()`);
  assert.equal(w.tag, 'DIV');
  assert.equal(w.max, `${w.measure}px`, 'the words are capped at the half grid');
  assert.ok(w.width <= w.measure + 0.5);
  const q = await hubPage(t, F.url, { width: 390, height: 800 });
  await q.until('the memory line', `!!document.querySelector('.mem-open')`);
  await q.click('.mem-open');
  await q.until('open', `document.getElementById('mem-holds')?.hidden === false`);
  assert.deepEqual(await q.ev(`(() => { const o = document.getElementById('overview'); const m = document.querySelector('.mem').getBoundingClientRect(); return [o.scrollWidth <= o.clientWidth, m.right <= innerWidth + 0.5]; })()`), [true, true], 'nothing wider than the phone');
});

test('both themes', CHROME, async (t) => {
  const F = await memoryHub(t, { readings: shifted(READINGS) });
  const seen = {};
  for (const scheme of ['light', 'dark']) {
    const p = await hubPage(t, F.url, { scheme });
    await p.until('the memory line', `!!document.querySelector('.mem')`);
    seen[scheme] = await p.ev(`[getComputedStyle(document.querySelector('.mem')).backgroundColor, getComputedStyle(document.querySelector('.mem-words')).color]`);
    assert.deepEqual(seen[scheme], [await p.ev(tokenColor('backgroundColor', '--surface')), await p.ev(tokenColor('color', '--fg'))], scheme);
  }
  assert.notDeepEqual(seen.light, seen.dark, 'the two themes differ');
});
