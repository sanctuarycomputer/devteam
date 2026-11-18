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
  assert.equal(memoryView([{ ...DESIGN, working_set: Math.ceil(0.8 * DESIGN.max) }], T0).bar.full, true);
  assert.equal(memoryView([{ ...DESIGN, working_set: Math.floor(0.8 * DESIGN.max) }], T0).bar.full, false);
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
