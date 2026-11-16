// The hub's Overview reads each project's hello: its pulse says whether the project is moving, how
// far along it is, what needs the owner, and what the fleet did each day for twelve weeks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { PORTS, bareProject, fleetFixture, json, kit, line, startDashboard, until } from './lib/kit.mjs';
import { canDrive, openChrome } from './lib/chrome.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };

// t.after runs hooks in the order they were added and skips the rest once one throws, so a folder's
// removal added before the dashboards writing into it ran first, could fail, and left them running:
// their pipes then held this file open until the job was cancelled. A test's cleanup goes through
// defer instead: the last step added runs first, every step runs, each within ms (a ref'd timer: an
// unref'd one lets Node 22 cancel the hook before it fires), and the first error is the one thrown.
async function runSteps(steps, ms = 30000) {
  let first = null;
  for (const step of [...steps].reverse()) {
    let timer;
    const limit = new Promise((_, no) => { timer = setTimeout(() => no(new Error(`cleanup step did not settle in ${ms / 1000} s`)), ms); });
    try { await Promise.race([Promise.resolve().then(step), limit]); } catch (e) { first ??= e; } finally { clearTimeout(timer); }
  }
  return first;
}
// A step added while run() runs starts at once and run() waits for it; one added after starts at once
// too, and its error can only be told on stderr: the test has ended.
function cleanup(ms = 30000) {
  const steps = [];
  const late = [];
  let state = 'open';
  return {
    add(fn) {
      if (state === 'open') return void steps.push(fn);
      const p = runSteps([fn], ms);
      if (state === 'running') late.push(p);
      else p.then((e) => { if (e) process.stderr.write(`cleanup after the test: ${e.message}\n`); });
    },
    async run() {
      state = 'running';
      let first = await runSteps(steps, ms);
      for (let i = 0; i < late.length; i++) { const e = await late[i]; first ??= e; }
      state = 'done';
      if (first) throw first;
    },
  };
}
// One cleanup per test, run by a single t.after. A test's first defer must come before its hooks
// start (a t.after added after that never runs): every test here calls it at its start.
const cleanups = new WeakMap();
function defer(t, fn) {
  let c = cleanups.get(t);
  if (!c) { c = cleanup(); cleanups.set(t, c); t.after(() => c.run()); }
  c.add(fn);
}

test('cleanup: last added runs first, every step runs, the first error is the one thrown', async () => {
  const order = [];
  const steps = [() => { order.push('A'); throw new Error('a'); }, () => { order.push('B'); }, () => { order.push('C'); throw new Error('c'); }];
  const err = await runSteps(steps);
  assert.deepEqual(order, ['C', 'B', 'A']);
  assert.equal(err?.message, 'c');
  const c = cleanup();
  for (const s of steps) c.add(s);
  await assert.rejects(c.run(), /^Error: c$/);
});

test('cleanup: a step that never settles is bounded and the rest still run', async () => {
  const order = [];
  const started = Date.now();
  const err = await runSteps([() => order.push(1), () => new Promise(() => {})], 50);
  assert.ok(Date.now() - started < 1000, 'bounded');
  assert.match(err?.message ?? '', /did not settle/);
  assert.deepEqual(order, [1]);
});

test('cleanup: a step added while cleanup runs is awaited and its error counts', async () => {
  const c = cleanup();
  c.add(() => c.add(() => { throw new Error('late'); }));
  await assert.rejects(c.run(), /late/);
  // and when a step before it failed: run still waits for it, and the earlier error is the one thrown
  const d = cleanup();
  let lateDone = false;
  d.add(() => { d.add(() => new Promise((r) => setTimeout(() => { lateDone = true; r(); }, 100))); throw new Error('first'); });
  await assert.rejects(d.run(), /^Error: first$/);
  assert.equal(lateDone, true, 'the late step finished before run did');
});

test('cleanup: a step added after cleanup ran still runs', async () => {
  const c = cleanup();
  await c.run();
  let ran = false;
  c.add(() => { ran = true; });
  await new Promise((r) => setImmediate(r));
  assert.equal(ran, true);
});

test('hello carries a pulse: idle, moving, fully and partly blocked, building', () => {
  const F = fleetFixture('hub-pulse');
  const { old, ok } = F;
  const pulse = () => json(ok(old, ['hello', '--json', '--no-kit'])).pulse;
  try {
    let p = pulse();
    assert.equal(p.state, 'idle', 'nothing open');
    assert.equal(p.activity.length, 84, 'twelve weeks, a day each');
    assert.ok(p.activity.every((n) => Number.isInteger(n) && n >= 0));
    assert.deepEqual(p.attention, []);

    // a goal, a feature and a ticket: open work
    const G = ok(old, ['goal', 'add', '--title', 'Billing', '--outcome', 'it works', '--priority', '1'], SUP);
    ok(old, ['feature', 'add', 'bill', '--json', JSON.stringify({ title: 'bill', goals: [G], stories: [{ id: 'BILL-S1', text: 'it works', release: 'v1.0.0' }] })], SUP);
    ok(old, ['ticket', 'add', 'app-01-bill', '--json', JSON.stringify({ title: 'Billing page', feature: 'bill', component: 'app', kind: 'build', size: 'S', risk: 'normal', serves: ['BILL-S1'], depends_on: [], touches: ['src/bill/**'], done_when: ['its test passes in CI'] })], SUP);
    p = pulse();
    assert.equal(p.goal, null, 'a draft goal is not what it is working on');
    assert.equal(p.goals_open, 0);
    assert.equal(p.open_tickets, 1);
    assert.equal(p.done_tickets, 0);
    assert.equal(p.state, 'moving', 'open work, and the fleet wrote just now');
    // the grid is commits on main, by author date, from git: days before the fleet existed count too,
    // once they are on origin's main
    assert.equal(p.activity_of, 'commits');
    const before = p.activity;
    const commitAt = (daysAgo) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', `${daysAgo} days ago`], { cwd: old, env: { ...process.env, GIT_AUTHOR_DATE: new Date(Date.now() - daysAgo * 86400000).toISOString() } });
    assert.equal(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: old, encoding: 'utf8' }).trim(), 'main', 'the fixture works on main');
    commitAt(3); commitAt(3); commitAt(40); commitAt(200);
    execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: old });
    const after = pulse().activity;
    assert.deepEqual(after.map((n, i) => n - before[i]).map((d, i) => (d ? [83 - i, d] : null)).filter(Boolean), [[40, 1], [3, 2]], 'two commits 3 days back, one 40 back, none for 200 days back (outside the 12 weeks)');
    assert.ok(p.last_activity && Date.now() - Date.parse(p.last_activity) < 60000);

    // a question with no default holding up the only ticket: fully blocked
    ok(old, ['ask', '--question', 'Charge per seat or per team?', '--blocks', 'app-01-bill', '--recommendation', 'Per team'], SUP);
    p = pulse();
    assert.equal(p.state, 'blocked');
    assert.equal(p.blocking, 'full');
    assert.equal(p.blocked_tickets, 1);
    assert.match(p.attention[0], /^Fully blocked: all 1 open ticket wait on your answer to 1 question/);

    // a ticket that depends on it waits too; one that doesn't can move: partly blocked
    const add = (id, deps) => ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'bill', component: 'app', kind: 'build', size: 'S', risk: 'normal', serves: ['BILL-S1'], depends_on: deps, touches: [`src/${id}/**`], done_when: ['its test passes in CI'] })], SUP);
    add('app-02-invoices', ['app-01-bill']);
    p = pulse();
    assert.equal(p.blocking, 'full', 'what depends on a held ticket is held too');
    assert.equal(p.blocked_tickets, 2);
    add('app-03-receipts', []);
    p = pulse();
    assert.equal(p.blocking, 'partial');
    assert.equal(p.blocked_tickets, 2);
    assert.equal(p.open_tickets, 3);
    assert.notEqual(p.state, 'blocked');
    assert.match(p.attention[0], /^Partly blocked: 2 of 3 open tickets wait on your answer to 1 question; the rest can move/);

    // a worker mid-ticket, writing now: building, and still partly blocked
    const ym = new Date().toISOString().slice(0, 7);
    fs.appendFileSync(path.join(old, 'docs/devteam/run/log', 'app-03-receipts.jsonl'), line({ v: 1, id: `h-${ym.replace('-', '')}01-000000000-app-03-receipts`, type: 'phase', op: 'new', at: new Date().toISOString(), by: 'app-03-receipts', from: null, to: 'build' }));
    p = pulse();
    assert.equal(p.working, 1);
    assert.equal(p.state, 'building');
    assert.equal(p.blocking, 'partial');


    // the owner approves the goal: the card names it, with its own tickets merged of planned
    fs.appendFileSync(path.join(old, 'docs/devteam/run/log', `owner-${ym}.jsonl`), line({ id: G, type: 'goal', op: 'set', status: 'ready', at: new Date().toISOString(), by: 'owner', channel: 'cli' }));
    p = pulse();
    assert.deepEqual([p.goal?.title, p.goal?.done, p.goal?.total, p.goals_open], ['Billing', 0, 3, 1]);
  } finally { F.done(); }
});

test('the pulse: an approved goal with nothing planned is not idle; a goal the owner parked is neither moving nor stalled', () => {
  const F = fleetFixture('hub-pulse-goals');
  const { old, ok } = F;
  const pulse = () => json(ok(old, ['hello', '--json', '--no-kit'])).pulse;
  const dir = path.join(old, 'docs/devteam/run/log');
  // every line written so far, as if written that long ago
  const age = (ms) => { for (const f of fs.readdirSync(dir)) fs.writeFileSync(path.join(dir, f), fs.readFileSync(path.join(dir, f), 'utf8').replace(/"at":"([^"]+)"/g, (all, t) => `"at":"${new Date(Date.parse(t) - ms).toISOString()}"`)); };
  try {
    const G = ok(old, ['goal', 'add', '--title', 'Billing', '--outcome', 'it works', '--priority', '1'], SUP);
    fs.appendFileSync(path.join(dir, `owner-${new Date().toISOString().slice(0, 7)}.jsonl`), line({ id: G, type: 'goal', op: 'set', status: 'ready', at: new Date().toISOString(), by: 'owner', channel: 'cli' }));
    let p = pulse();
    assert.equal(p.state, 'moving', 'approved and not planned yet: planning is owed');
    assert.equal(p.open_tickets, 0);
    age(3 * 3600000);
    p = pulse();
    assert.equal(p.state, 'stalled', 'and nobody planning it for hours is a stall, not "waiting for a new goal"');
    assert.match(p.attention.join('\n'), /An approved goal with no tickets, and nothing has moved in 3 h/);

    ok(old, ['feature', 'add', 'bill', '--json', JSON.stringify({ title: 'bill', goals: [G], stories: [{ id: 'BILL-S1', text: 'it works', release: 'v1.0.0' }] })], SUP);
    ok(old, ['ticket', 'add', 'app-01-bill', '--json', JSON.stringify({ title: 'Billing page', feature: 'bill', component: 'app', kind: 'build', size: 'S', risk: 'normal', serves: ['BILL-S1'], depends_on: [], touches: ['src/bill/**'], done_when: ['its test passes in CI'] })], SUP);
    assert.equal(pulse().state, 'moving');
    // the owner parks that one goal: Upkeep still runs, so the fleet is not parked
    ok(old, ['goal', 'hold', G, 'park', '--reason', 'later', '--owner'], { DEVTEAM_CHANNEL: 'dashboard' });
    age(3 * 86400000);
    p = pulse();
    assert.equal(json(ok(old, ['hello', '--json', '--no-kit'])).fleet.mode, 'run');
    assert.equal(p.state, 'idle', 'its ticket waits by the owner\'s choice: nothing is stalled');
    assert.equal(p.open_tickets, 1, 'still counted as not merged');
    assert.deepEqual(p.attention, ['1 open ticket is on hold with its goal']);
    assert.equal(p.goal.mode, 'park');
    // a question on it blocks nothing that could move
    ok(old, ['ask', '--question', 'Charge per seat or per team?', '--blocks', 'app-01-bill', '--recommendation', 'Per team'], SUP);
    p = pulse();
    assert.equal(p.blocking, null);
    assert.notEqual(p.state, 'blocked');
  } finally { F.done(); }
});

// ----- the box line: what the box's image is, and who serves its hub ------------------------------
// The Overview's one line on a box, built by a pure block of hub.html from /box.json's image and the
// latest /instances.json, run here as dashboard.test.mjs runs index.html's: no Chrome needed.
const hubHtml = () => fs.readFileSync(path.join(kit, 'dashboard', 'hub.html'), 'utf8');
function boxLineFn() {
  const html = hubHtml();
  const src = html.slice(html.indexOf('/* box-line start */'), html.indexOf('/* box-line end */'));
  assert.ok(src.length > 200, 'the box-line block is marked in hub.html');
  const ctx = vm.createContext({});
  vm.runInContext(`${src}\n;globalThis.api = { boxLine };`, ctx);
  return ctx.api.boxLine;
}
const lineText = (p) => p && [...p].map((x) => String(x.text)).join(' · ');
const amberOf = (p) => [...p].filter((x) => x.amber).map((x) => String(x.text));
const toolsOf = (p) => [...p].slice(2).map((x) => String(x.text));
const IMG = { release: 'v0.52.0', tools: { 'claude-code': '2.1.310', 'claude-swap': '0.4.1', gh: '2.83.0', ttyd: '1.7.7', mise: '2025.11.3', uv: '0.9.9' } };

test('the box line: the image\'s release, the hub\'s, and the tools; amber when the hub isn\'t the image\'s', () => {
  const boxLine = boxLineFn();
  const texts = [];
  const run = (image, list) => { const p = boxLine(image, list); if (p) texts.push(...[...p].map((x) => x.text)); return p; };
  let p = run(IMG, { hub: 1, kit: 'v0.52.0', image: true, instances: [] });
  assert.equal(lineText(p), 'Box v0.52.0 · hub v0.52.0 · Claude Code 2.1.310 · claude-swap 0.4.1 · gh 2.83.0 · ttyd 1.7.7 · mise 2025.11.3 · uv 0.9.9');
  assert.deepEqual(amberOf(p), [], 'the image\'s own hub, at its release: nothing amber');
  // a project's kit holds the port: amber, whatever its release (even the image's)
  assert.deepEqual(amberOf(run(IMG, { hub: 1, kit: 'v0.50.4', instances: [] })), ['hub served by a project\'s kit, v0.50.4']);
  assert.deepEqual(amberOf(run(IMG, { hub: 1, instances: [] })), ['hub served by a project\'s kit, ?']);
  assert.deepEqual(amberOf(run(IMG, { hub: 1, kit: null, instances: [] })), ['hub served by a project\'s kit, ?']);
  assert.deepEqual(amberOf(run(IMG, { hub: 1, kit: 'v0.52.0', instances: [] })), ['hub served by a project\'s kit, v0.52.0']);
  assert.deepEqual(amberOf(run(IMG, { hub: 1, kit: 'v0.52.0', image: 'yes', instances: [] })), ['hub served by a project\'s kit, v0.52.0'], 'only image: true is the image\'s');
  // the image's hub, at another release than the box
  p = run({ ...IMG, release: 'v0.53.0' }, { hub: 1, kit: 'v0.52.0', image: true, instances: [] });
  assert.deepEqual(amberOf(p), ['hub v0.52.0, box v0.53.0']);
  assert.ok(lineText(p).startsWith('Box v0.53.0 · hub v0.52.0, box v0.53.0 · Claude Code 2.1.310'), lineText(p));
  // no hub: the gateway's fallback, or nothing readable at all
  assert.deepEqual(amberOf(run(IMG, { hub: 1, instances: [], down: true })), ['hub not answering']);
  assert.deepEqual(amberOf(run(IMG, null)), ['hub not answering']);
  assert.deepEqual(amberOf(run(IMG, 'nope')), ['hub not answering']);
  // something that isn't a hub on its port
  assert.deepEqual(amberOf(run(IMG, { hub: 2, instances: [] })), ['hub port held by something that isn\'t a hub']);
  assert.deepEqual(amberOf(run(IMG, { instances: [] })), ['hub port held by something that isn\'t a hub']);
  // a kit that isn't a plain version is never shown, nor compared
  assert.deepEqual(amberOf(run(IMG, { hub: 1, kit: '\u001b[31mx', image: true, instances: [] })), ['hub ?, box v0.52.0']);
  assert.deepEqual(amberOf(run(IMG, { hub: 1, kit: 'v'.repeat(10240), image: true, instances: [] })), ['hub ?, box v0.52.0']);
  // nothing at all without a readable image: a laptop (no box.json), an older image, a bad answer
  for (const image of [null, undefined, 'v1', 7, [], { release: '<b>', tools: {} }, { tools: {} }, { release: 'v'.repeat(65) }]) assert.equal(boxLine(image, { hub: 1, kit: 'v1', image: true }), null, JSON.stringify(image));
  // tools: in order, plain versions only
  assert.deepEqual(toolsOf(run({ release: 'v1.0.0', tools: { gh: '2', 'x y': '1', uv: '<i>', mise: 3, ttyd: 'a'.repeat(65) } }, { hub: 1, kit: 'v1.0.0', image: true })), ['gh 2']);
  assert.deepEqual([...run({ release: 'v1.0.0', tools: 'gh=2' }, { hub: 1, kit: 'v1.0.0', image: true })].length, 2, 'tools not an object: just the box and the hub');
  assert.deepEqual([...run({ release: 'v1.0.0' }, { hub: 1, kit: 'v1.0.0', image: true })].length, 2);
  // plain words and versions (R2): no markup, no links
  assert.ok(texts.length > 20);
  for (const s of texts) { assert.equal(typeof s, 'string'); assert.match(s, /^[\w .,'+?-]+$/, s); assert.ok(!s.includes('http') && !s.includes('<'), s); }
});

test('the Overview draws the box line from box.json and the latest list', () => {
  const html = hubHtml();
  const body = (start) => { const i = html.indexOf(start); assert.ok(i > 0, start); const rest = html.slice(i + start.length); const j = rest.search(/\n(async )?function /); return rest.slice(0, j < 0 ? undefined : j); };
  assert.match(body('function paintOverview('), /boxLine\(box\?\.image \?\? null, hubSeen\)/, 'paintOverview draws it');
  assert.match(body('async function findBox('), /image: b\.image/, 'findBox keeps the image');
  const draw = body('async function draw(');
  assert.match(draw, /hubSeen = data;/, 'draw keeps the list it read');
  assert.match(draw, /catch \{ hubSeen = null; paintOverview\(\); return; \}/, 'and forgets it, and paints, when it read none');
  assert.match(draw, /if \(!data \|\| typeof data !== 'object'\) throw/, 'JSON that is no list (null, a number) is none');
  // each part goes in as text, amber by its class, on a row of its own
  assert.match(body('function paintOverview('), /d\.append\(el\('span', x\.amber \? 'amber' : '', x\.text\)\)/, 'a span per part, its text as text');
  assert.ok(!/innerHTML/.test(body('function paintOverview(')), 'no markup from the line');
  assert.match(html, /\.ov-head \.ov-box \{ flex-basis: 100%; order: 1;/, 'its own row under the head');
  assert.match(html, /\.ov-box \.amber \{ color: var\(--amber-fg\); \}/);
});

// ----- the Overview's rules: a pure block of hub.html (kit-94), run here in vm -------------------
// The tab counts, the partly-held pill, the machine switch's mode and the addresses a view keeps.
// They read T_UNSAFE and tLine, two one-line definitions of the page, which the loader takes too.
function overviewRules() {
  const html = hubHtml();
  const src = html.slice(html.indexOf('/* hub-overview start */'), html.indexOf('/* hub-overview end */'));
  assert.ok(src.length > 200, 'the hub-overview block is marked in hub.html');
  const lineOf = (start) => { const i = html.indexOf(start); assert.ok(i > 0, start); return html.slice(i, html.indexOf('\n', i)); };
  const ctx = vm.createContext({});
  vm.runInContext(`${lineOf('const T_UNSAFE = ')}\n${lineOf('const tLine = ')}\n${src}\n;globalThis.api = { tabCounts, heldPill, machineMode, hubKey };`, ctx);
  return ctx.api;
}
const plain = (x) => JSON.parse(JSON.stringify(x));

test('the Overview\'s rules: tab counts', () => {
  const { tabCounts } = overviewRules();
  assert.deepEqual(plain(tabCounts(3, { you: 1, waiting: 1, ready: 1 })), { q: 3, th: { n: 2, tone: 'ok', title: '1 ready to accept, 1 your move' } });
  assert.deepEqual(plain(tabCounts(0, { you: 0, waiting: 0, ready: 2 })), { q: 0, th: { n: 2, tone: 'ok', title: '2 ready to accept' } });
  assert.deepEqual(plain(tabCounts(0, { you: 2, waiting: 0, ready: 0 }).th), { n: 2, tone: 'you', title: '2 your move' });
  assert.deepEqual(plain(tabCounts(0, { you: 0, waiting: 2, ready: 0 }).th), { n: 2, tone: 'wait', title: 'all waiting on the supervisor' });
  assert.deepEqual(plain(tabCounts(0, { you: 0, waiting: 0, ready: 0 })), { q: 0, th: null });
  assert.deepEqual(plain(tabCounts(1, null)), { q: 1, th: null }, 'an older kit: questions only');
  assert.deepEqual(plain(tabCounts('x', { you: -1 })), { q: 0, th: null });
  assert.deepEqual(plain(tabCounts(2.5, { you: 1.5, waiting: '3', ready: null })), { q: 0, th: null }, 'only whole numbers count');
});

test('the Overview\'s rules: the partly-held pill', () => {
  const { heldPill } = overviewRules();
  let p = plain(heldPill({ mode: 'run', goals: { run: 2, drain: 0, park: 9 } }));
  assert.deepEqual(p, { word: 'Partly parked', running: 2, total: 11, text: 'Partly parked · 2 of 11 goals running', title: '9 parked, 0 draining' });
  assert.equal(heldPill({ goals: { run: 0, drain: 3, park: 8 } }).text, 'Partly parked · 0 of 11 goals running', 'every goal held, split between parked and draining');
  assert.equal(heldPill({ goals: { run: 5, drain: 1, park: 0 } }).word, 'Partly draining');
  for (const f of [{ goals: { run: 11, drain: 0, park: 0 } }, { goals: { run: 0, drain: 0, park: 4 } }, { goals: { run: 0, drain: 4, park: 0 } }, { goals: { run: 0, drain: 0, park: 0 } }, { goals: { run: -1, drain: 2, park: 2 } }, { goals: { run: '2', drain: 0, park: 9 } }, { goals: { run: 1.5, drain: 0, park: 9 } }, { goals: null }, { mode: 'run' }, null, undefined, 'park']) assert.equal(heldPill(f), null, JSON.stringify(f));
  // the held goals, named: each its title and why (its mode without a why), as plain lines
  p = heldPill({ goals: { run: 2, drain: 1, park: 1, held: [{ title: 'Recurring checks', mode: 'park', why: 'waits on your approval' }, { title: 'Sense', mode: 'drain' }, { mode: 'park' }, 'x'] } });
  assert.equal(p.title, 'Recurring checks: waits on your approval\nSense: drain');
  const many = Array.from({ length: 25 }, (_, i) => ({ title: `g${i}`, mode: 'park', why: 'later' }));
  assert.equal(heldPill({ goals: { run: 1, drain: 0, park: 25, held: many } }).title.split('\n').length, 20, 'at most 20');
  assert.equal(heldPill({ goals: { run: 1, drain: 0, park: 1, held: [{ title: 'a‮b', mode: 'park', why: 'c\nd' }] } }).title, 'a b: c d', 'what a reader\'s eye acts on goes, as tLine does');
  assert.equal(heldPill({ goals: { run: 1, drain: 0, park: 1, held: 'nope' } }).title, '1 parked, 0 draining', 'held not a list: the counts');
});

test('the Overview\'s rules: the machine switch\'s mode', () => {
  const { machineMode } = overviewRules();
  assert.deepEqual(plain(machineMode(['run', 'run'])), { mode: 'run', counts: { running: 2, draining: 0, parked: 0 } });
  assert.deepEqual(plain(machineMode(['park', 'park'])), { mode: 'park', counts: { running: 0, draining: 0, parked: 2 } });
  assert.deepEqual(plain(machineMode(['run', 'park', 'drain'])), { mode: 'mixed', counts: { running: 1, draining: 1, parked: 1 } });
  assert.deepEqual(plain(machineMode([])), { mode: null, counts: { running: 0, draining: 0, parked: 0 } });
});

test('the Overview\'s rules: addresses a view never loses', () => {
  const { hubKey } = overviewRules();
  assert.equal(hubKey('alpha', false, 'abc123'), 'alpha');
  assert.equal(hubKey('alpha', true, 'abc123'), 'alpha-abc123', 'two of one name');
  for (const v of ['settings', 'overview', 'terminal']) assert.equal(hubKey(v, false, 'abc123'), `${v}-abc123`, v);
  assert.match(hubHtml(), /return hubKey\(it\.x\.name, twins, hex6\.get\(it\.x\.root\)\);/, 'keyOf uses it');
});

// The hub can't post an owner action. Its Overview asks the project's dashboard, in its frame, and
// that page posts to itself: only for its parent, only when that parent is another origin (the hub,
// by frame-ancestors), never in the viewer, never opened on its own.
test('the Overview in Chrome: Park by keyboard, Park all and Resume all through each dashboard; nothing but the hub above a dashboard is heard', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 240000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-hub-ov-'));
  defer(t, () => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const HUB = PORTS + 60;
  const P = PORTS + 61;
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(HUB), DEVTEAM_PORT_BASE: String(P), DEVTEAM_HUB_RETRY_MS: '500', CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  const A = bareProject(base, 'alpha');
  const B = bareProject(base, 'beta');
  for (const r of [A, B]) execFileSync('sh', ['-c', 'git add -A && git -c user.email=t@t -c user.name=t commit -qm init'], { cwd: r });
  // the fleet's mode as the project itself says it now (the hub's list is up to 10 s behind)
  const mode = (root) => { const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), 'hello', '--json', '--no-kit'], { cwd: root, env, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return json(r.stdout).fleet.mode; };
  const a = startDashboard(A, env);
  defer(t, () => a.stop());
  await until(() => a.out().includes(`127.0.0.1:${P}`), "alpha's dashboard");
  const b = startDashboard(B, env);
  defer(t, () => b.stop());
  await until(async () => { try { const l = (await (await fetch(`http://127.0.0.1:${HUB}/instances.json`)).json()).instances; return l.length === 2 && l.every((x) => x.pulse); } catch { return false; } }, 'both projects listed with a pulse');
  const chrome = await openChrome();
  defer(t, () => chrome.close());
  const p = await chrome.newPage();
  defer(t, () => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Page.navigate', { url: `http://127.0.0.1:${HUB}/` });
  const page = (what, expr) => until(() => p.ev(expr).catch(() => false), what);
  const card = (name) => `[...document.querySelectorAll('.ov-card')].find((c) => c.querySelector('.ov-name')?.textContent === '${name}')`;
  const seg = (name, label) => `[...${card(name)}.querySelectorAll('.seg button')].find((x) => x.textContent === '${label}')`;
  await page('a card each', `document.querySelectorAll('.ov-card').length === 2 && document.querySelectorAll('.seg').length === 2`);
  assert.equal(await p.ev(`document.querySelector('[role=tab][aria-selected=true]').textContent`), 'Overview', 'the page opens on the Overview');
  assert.equal(await p.ev(`location.hash`), '#overview');
  assert.equal(await p.ev(`document.querySelectorAll('iframe').length`), 0, 'no dashboard is loaded until one is opened or asked');

  // Park, by keyboard: two presses of the space bar on one button, across the redraw between them
  await p.ev(`${seg('alpha', 'Park')}.focus()`);
  await p.key(' ');
  await page('the press asking to be confirmed', `document.activeElement?.textContent === 'Confirm park'`);
  assert.equal(mode(A), 'run', 'one press parks nothing');
  await p.key(' ');
  await until(() => mode(A) === 'park', 'alpha parked');
  assert.equal(mode(B), 'run', 'and only alpha');
  // the card says so as soon as alpha's dashboard answers, not a hello later
  await page('the card showing Park pressed', `${seg('alpha', 'Park')}?.getAttribute('aria-pressed') === 'true' && ${card('alpha')}.querySelector('.pill:last-child').textContent === 'Parked'`);
  await page('the frame made to ask, gone again', `document.querySelectorAll('iframe').length === 0`);
  const held = spawnSync(process.execPath, [path.join(A, 'docs/devteam/scripts/devteam.mjs'), 'fleet', 'status'], { cwd: A, env, encoding: 'utf8' }).stdout;
  assert.match(held, /parked from the hub's Overview/, 'the reason says where it came from');

  // every project at once, and back
  await page('Park all offered', `[...document.querySelectorAll('.ov-head .acts button')].some((x) => x.textContent === 'Park all' && !x.disabled)`);
  await p.ev(`[...document.querySelectorAll('.ov-head .acts button')].find((x) => x.textContent === 'Park all').click()`);
  assert.equal(mode(B), 'run', 'Park all asks first');
  await p.ev(`[...document.querySelectorAll('.ov-head .acts button')].find((x) => /^Confirm: park 1 project$/.test(x.textContent)).click()`);
  await until(() => mode(B) === 'park', 'beta parked');
  await page('Resume all offered for both', `[...document.querySelectorAll('.ov-head .acts button')].some((x) => x.textContent === 'Resume all (2)' && !x.disabled)`);
  await p.ev(`[...document.querySelectorAll('.ov-head .acts button')].find((x) => x.textContent === 'Resume all (2)').click()`);
  await until(() => mode(A) === 'run' && mode(B) === 'run', 'both running again');

  // a project's tab after all that: its dashboard, shown
  await p.ev(`[...document.querySelectorAll('[role=tab]')].find((x) => x.textContent.startsWith('alpha')).click()`);
  await page("alpha's dashboard in its frame", `document.querySelectorAll('iframe:not([hidden])').length === 1 && document.getElementById('overview').hidden`);
  await until(() => p.evIn(`http://127.0.0.1:${P}`, `document.readyState === 'complete' && typeof loadFleet === 'function'`).catch(() => false), "alpha's page running");

  // Who is not heard. Each is given 2 s to park beta, which would take well under one.
  const ask = (nonce) => JSON.stringify({ devteam: 'hub-fleet', mode: 'park', nonce });
  const quiet = async (why) => { await new Promise((r) => setTimeout(r, 2000)); assert.equal(mode(B), 'run', why); };
  // the dashboard's own page, to itself (its parent is itself: any script of its own origin)
  await p.evIn(`http://127.0.0.1:${P}`, `window.postMessage(${ask('aaaaaaaa01')}, '*')`);
  // the viewer under the hub: the same page, but never the hub's to steer
  await p.ev(`(() => { const f = document.createElement('iframe'); f.id = 'viewer'; f.src = 'http://127.0.0.1:${P + 1}/view/artifact/some-page'; document.getElementById('frames').append(f); return new Promise((r) => f.addEventListener('load', r)); })()`);
  await until(() => p.evIn(`http://127.0.0.1:${P + 1}`, `document.readyState === 'complete' && typeof VIEWER === 'object' && VIEWER !== null`).catch(() => false), "beta's viewer running");
  await p.ev(`document.getElementById('viewer').contentWindow.postMessage(${ask('aaaaaaaa02')}, '*')`);
  await quiet('the viewer does not listen');
  // another page on this machine can't hold a dashboard at all, so it has no frame to ask
  const other = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<!doctype html><iframe id="d" src="http://127.0.0.1:${P + 1}/"></iframe><script>const f = document.getElementById('d'); f.addEventListener('load', () => { window.loaded = true; }); setInterval(() => f.contentWindow.postMessage(${ask('aaaaaaaa03')}, '*'), 200);</script>`); });
  await new Promise((r) => other.listen(PORTS + 90, '127.0.0.1', r));
  defer(t, () => other.close());
  const q = await chrome.newPage();
  defer(t, () => q.close());
  await q.send('Page.enable');
  await q.send('Runtime.enable');
  await q.send('Page.navigate', { url: `http://127.0.0.1:${PORTS + 90}/` });
  await until(() => q.ev(`document.getElementById('d') !== null`).catch(() => false), 'the other page');
  await quiet('a page that is not the hub frames no dashboard');
  // and a dashboard in a tab of its own hears nobody: it has no parent
  await q.send('Page.navigate', { url: `http://127.0.0.1:${P + 1}/` });
  await until(() => q.ev(`location.port === '${P + 1}' && document.readyState === 'complete' && typeof loadFleet === 'function'`).catch(() => false), "beta's dashboard on its own");
  await q.ev(`window.postMessage(${ask('aaaaaaaa04')}, '*')`);
  await quiet('a dashboard opened on its own hears nobody');
  // the hub itself still is: the same ask from the page above beta's dashboard parks it
  await p.ev(`[...document.querySelectorAll('[role=tab]')].find((x) => x.textContent.startsWith('beta')).click()`);
  await until(() => p.evIn(`http://127.0.0.1:${P + 1}`, `location.pathname === '/' && document.readyState === 'complete' && typeof loadFleet === 'function'`).catch(() => false), "beta's dashboard under the hub");
  await p.ev(`[...document.querySelectorAll('iframe')].find((f) => f.title === 'beta').contentWindow.postMessage(${ask('aaaaaaaa05')}, 'http://127.0.0.1:${P + 1}')`);
  await until(() => mode(B) === 'park', 'beta parked by its parent, the hub');
});

// ----- the hub on its own (devteam.mjs hub), as the box's boot starts it from the image's kit ----
// The image's kit, laid out as the box has it at /opt/devteam/kit: a copy in a folder that is no git
// repo, so the hub's checkout is its cwd, exactly as there. A box's ENV reaches every process on it,
// these tests included: each hub and dashboard here gets the three variables only where it means to.
const BOX_VARS = ['DEVTEAM_IMAGE_HUB', 'DEVTEAM_KIT_RELEASE', 'DEVTEAM_BOX_TOOLS'];
function imageKit(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-image-kit-'));
  defer(t, () => fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  fs.cpSync(kit, d, { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
  return path.join(d, 'scripts', 'devteam.mjs');
}
// A machine of its own: a home, a folder to run in, and the env (hub port as given).
function hubMachine(t, name, hubPort, extra = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `devteam-${name}-`));
  defer(t, () => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const home = path.join(base, 'home');
  const cwd = path.join(base, 'cwd');
  fs.mkdirSync(home);
  fs.mkdirSync(cwd);
  const env = { ...process.env, HOME: home, DEVTEAM_HUB_PORT: String(hubPort), DEVTEAM_PORT_BASE: String(PORTS + 41), DEVTEAM_HUB_RETRY_MS: '200', CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of [...BOX_VARS, 'DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'TMUX', 'TMUX_PANE']) delete env[k];
  Object.assign(env, extra);
  return { base, home, cwd, env, log: path.join(home, '.devteam', `hub-${hubPort}.log`) };
}
// `devteam.mjs hub`, in a process group of its own, ended (and waited for) after the test.
function startHubCmd(t, script, cwd, env, args = []) {
  const p = spawn(process.execPath, [script, 'hub', ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let o = '';
  p.stdout.on('data', (b) => { o += b; });
  p.stderr.on('data', (b) => { o += b; });
  const alive = () => p.exitCode === null && p.signalCode === null;
  defer(t, () => (alive() ? new Promise((r) => { p.once('exit', r); try { process.kill(-p.pid, 'SIGKILL'); } catch { r(); } }) : undefined));
  return { p, alive, out: () => o };
}
const hubList = async (port) => { try { const r = await fetch(`http://127.0.0.1:${port}/instances.json`); return r.status === 200 ? await r.json() : null; } catch { return null; } };
const readOr = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

test('hub --release, from a folder that is no repo: the list with the image\'s release, and nothing written there', { timeout: 240000 }, async (t) => {
  const HUB = PORTS + 40;
  const M = hubMachine(t, 'hub-alone', HUB);
  const h = startHubCmd(t, imageKit(t), M.cwd, M.env, ['--release', 'v9.9.9']);
  await until(async () => (await hubList(HUB))?.kit === 'v9.9.9', `the image's hub (${h.out()})`);
  const A = bareProject(M.base, 'alpha');
  execFileSync('sh', ['-c', 'git add -A && git -c user.email=t@t -c user.name=t commit -qm init'], { cwd: A });
  const d = startDashboard(A, M.env);
  defer(t, () => d.stop());
  const list = await until(async () => { const l = await hubList(HUB); return l?.instances?.some((x) => x.root === fs.realpathSync(A)) ? l : null; }, 'alpha listed by the image\'s hub');
  assert.deepEqual([list.hub, list.kit, list.image], [1, 'v9.9.9', true]);
  assert.ok(h.alive(), 'still serving');
  assert.equal(fs.existsSync(path.join(M.cwd, 'docs')), false, 'nothing written under its cwd, no docs/devteam/run');
  assert.deepEqual(fs.readdirSync(M.cwd), []);
});

test('hub without --release names no release, whatever DEVTEAM_KIT_RELEASE says; a bad --release serves anyway', { timeout: 120000 }, async (t) => {
  const script = imageKit(t);
  for (const [port, args] of [[PORTS + 36, []], [PORTS + 37, ['--release', '']], [PORTS + 38, ['--release', 'nope']]]) {
    const M = hubMachine(t, 'hub-norel', port, { DEVTEAM_KIT_RELEASE: 'v9.9.9' });
    const h = startHubCmd(t, script, M.cwd, M.env, args);
    const list = await until(() => hubList(port), `the hub on ${port} (${args.join(' ')})`);
    assert.equal(list.hub, 1);
    assert.equal(list.kit, null, `kit null for ${JSON.stringify(args)}`);
    assert.equal('image' in list, false, `no image field for ${JSON.stringify(args)}`);
    await pause(1000);
    assert.ok(h.alive(), `still up a second later (${JSON.stringify(args)}): ${h.out()}`);
  }
});

test('a dashboard\'s hub names its project\'s kit and no image, whatever DEVTEAM_KIT_RELEASE says', { timeout: 240000 }, async (t) => {
  const HUB = PORTS + 39;
  const M = hubMachine(t, 'hub-dash-kit', HUB, { DEVTEAM_KIT_RELEASE: 'v9.9.9' });
  const A = bareProject(M.base, 'alpha');
  execFileSync('sh', ['-c', 'git add -A && git -c user.email=t@t -c user.name=t commit -qm init'], { cwd: A });
  const d = startDashboard(A, M.env);
  defer(t, () => d.stop());
  const list = await until(() => hubList(HUB), "the dashboard's hub");
  const hello = json(spawnSync(process.execPath, [path.join(A, 'docs/devteam/scripts/devteam.mjs'), 'hello', '--json'], { cwd: A, env: M.env, encoding: 'utf8' }).stdout);
  assert.equal(typeof list.kit, 'string');
  assert.equal(list.kit, hello.kit);
  assert.notEqual(list.kit, 'v9.9.9');
  assert.equal('image' in list, false);
});

test('the hub waits out another hub and a non-hub, logging the non-hub once, and takes the port', { timeout: 120000 }, async (t) => {
  const script = imageKit(t);
  const holder = (port, body) => new Promise((r) => { const s = http.createServer((q, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(body); }); defer(t, () => s.listening && new Promise((c) => s.close(c))); s.listen(port, '127.0.0.1', () => r(s)); });
  // another hub holds it: the image's hub stays up, retrying, and takes it when that one goes
  const A = PORTS + 30;
  const M1 = hubMachine(t, 'hub-wait', A);
  let s = await holder(A, JSON.stringify({ hub: 1, instances: [] }));
  const h1 = startHubCmd(t, script, M1.cwd, M1.env, ['--release', 'v9.9.9']);
  await pause(1500);
  assert.ok(h1.alive(), `still up behind another hub: ${h1.out()}`);
  assert.equal((await hubList(A)).kit, undefined, 'the holder answers, not the image\'s hub');
  await new Promise((r) => s.close(r));
  await until(async () => (await hubList(A))?.kit === 'v9.9.9', 'the image\'s hub on the port it waited for');
  // something that isn't a hub: said once, however many retries, and the port taken once it frees
  const B = PORTS + 31;
  const M2 = hubMachine(t, 'hub-wait-other', B);
  s = await holder(B, 'ok');
  const h2 = startHubCmd(t, script, M2.cwd, M2.env, ['--release', 'v9.9.9']);
  await until(() => readOr(M2.log).includes("isn't a devteam hub"), `the non-hub logged (${h2.out()})`);
  await pause(2000);
  assert.ok(h2.alive(), `still up behind a non-hub: ${h2.out()}`);
  assert.equal(readOr(M2.log).split('\n').filter((l) => l.includes("isn't a devteam hub")).length, 1, 'once, not at every retry');
  await new Promise((r) => s.close(r));
  await until(async () => (await hubList(B))?.kit === 'v9.9.9', 'the image\'s hub once the non-hub went');
});

test('the hub\'s log stays under 1 MB and records a SIGTERM', { timeout: 120000 }, async (t) => {
  const HUB = PORTS + 32;
  const M = hubMachine(t, 'hub-log', HUB);
  fs.mkdirSync(path.dirname(M.log), { recursive: true });
  fs.writeFileSync(M.log, 'x'.repeat(1048570));
  const h = startHubCmd(t, imageKit(t), M.cwd, M.env, ['--release', 'v9.9.9']);
  await until(() => readOr(M.log).includes('hub on http://'), `the hub's start line (${h.out()})`);
  assert.equal(fs.statSync(`${M.log}.1`).size, 1048570, 'the full log moved aside');
  assert.ok(fs.statSync(M.log).size <= 1048576);
  process.kill(h.p.pid, 'SIGTERM');
  await until(() => readOr(M.log).includes('stopped by SIGTERM'), 'the signal logged');
  assert.ok(fs.statSync(M.log).size <= 1048576);
});

test('a dashboard leaves the hub to the image only when DEVTEAM_IMAGE_HUB names its own hub port', { timeout: 480000 }, async (t) => {
  const left = (port) => `hub: left to the image (DEVTEAM_IMAGE_HUB=${port})`;
  const listens = (port) => new Promise((r) => { const c = net.connect({ port, host: '127.0.0.1' }); c.once('connect', () => { c.destroy(); r(true); }); c.once('error', () => r(false)); });
  // the box's own case, the image naming this dashboard's hub port: the port left alone, and said once
  const run = async (hubPort, value) => {
    const M = hubMachine(t, 'hub-image', hubPort, value === undefined ? {} : { DEVTEAM_IMAGE_HUB: value });
    const A = bareProject(M.base, 'alpha');
    execFileSync('sh', ['-c', 'git add -A && git -c user.email=t@t -c user.name=t commit -qm init'], { cwd: A });
    const d = startDashboard(A, M.env);
    defer(t, () => d.stop());
    try {
      await until(() => /dashboard on http/.test(d.out()), 'the dashboard');
      return { d, logOf: () => readOr(path.join(A, 'docs/devteam/run/dashboard.log')) };
    } catch (e) { await d.stop(); throw e; }
  };
  const a = await run(PORTS + 26, String(PORTS + 26));
  try {
    await until(() => a.logOf().includes(left(PORTS + 26)), 'the line saying so');
    await pause(1000);
    assert.equal(await listens(PORTS + 26), false, 'nothing listens on the hub port');
    assert.equal(a.logOf().split('\n').filter((l) => l.endsWith(left(PORTS + 26))).length, 1, 'said exactly once');
  } finally { await a.d.stop(); }
  // unset, the real box's 4320 while this hub is a fixture's, or a number that isn't a plain port
  for (const [port, value] of [[PORTS + 27, undefined], [PORTS + 28, '4320'], [PORTS + 29, `0x${(PORTS + 29).toString(16)}`]]) {
    const r = await run(port, value);
    try {
      await until(async () => (await hubList(port))?.hub === 1, `its hub on ${port} (DEVTEAM_IMAGE_HUB=${value})`);
      assert.doesNotMatch(r.logOf(), /left to the image/, `served as before with DEVTEAM_IMAGE_HUB=${value}`);
    } finally { await r.d.stop(); }
  }
});

test('a non-hub that answers slowly now and then is still logged once', { timeout: 120000 }, async (t) => {
  const HUB = PORTS + 33;
  const M = hubMachine(t, 'hub-slow-other', HUB);
  // every other answer comes after the hub's 2 s patience: other, unsure, other, …
  let n = 0;
  const s = http.createServer((q, res) => { const slow = n++ % 2 === 1; setTimeout(() => { if (!res.destroyed) res.end('ok'); }, slow ? 2500 : 0); });
  await new Promise((r) => s.listen(HUB, '127.0.0.1', r));
  defer(t, () => new Promise((r) => { s.closeAllConnections?.(); s.close(r); }));
  const h = startHubCmd(t, imageKit(t), M.cwd, M.env, ['--release', 'v9.9.9']);
  await until(() => n >= 6, `six asks of the holder (${h.out()})`);
  assert.ok(h.alive());
  assert.equal(readOr(M.log).split('\n').filter((l) => l.includes("isn't a devteam hub")).length, 1, 'once, whatever answered slowly in between');
});

// The hub is the machine's, like machine and operator-thread: a session's DEVTEAM_RUN in its env (a
// worker starting it by hand, say) is never refused there, and nothing is written into that run folder.
test('the hub runs with another home\'s DEVTEAM_RUN in its env, and writes nothing there', { timeout: 120000 }, async (t) => {
  const HUB = PORTS + 34;
  const elsewhere = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-other-home-')), 'docs', 'devteam', 'run');
  fs.mkdirSync(elsewhere, { recursive: true });
  defer(t, () => fs.rmSync(path.dirname(path.dirname(path.dirname(elsewhere))), { recursive: true, force: true }));
  const M = hubMachine(t, 'hub-run', HUB, { DEVTEAM_RUN: elsewhere });
  const h = startHubCmd(t, imageKit(t), M.cwd, M.env, ['--release', 'v9.9.9']);
  await until(async () => (await hubList(HUB))?.kit === 'v9.9.9' || !h.alive(), 'the hub, or its exit');
  assert.ok(h.alive(), `the hub was refused: ${h.out()}`);
  assert.deepEqual(fs.readdirSync(elsewhere), [], 'nothing in that run folder');
});

// A dashboard run against a project by a kit that isn't that project's own checkout (the image's, or
// another copy) never names the project's release as the hub's.
test('a dashboard\'s hub run by a kit outside its project names no release', { timeout: 240000 }, async (t) => {
  const HUB = PORTS + 35;
  const M = hubMachine(t, 'hub-dash-foreign', HUB);
  const A = bareProject(M.base, 'alpha');
  execFileSync('sh', ['-c', 'git add -A && git -c user.email=t@t -c user.name=t commit -qm init'], { cwd: A });
  const p = spawn(process.execPath, [imageKit(t), 'dashboard'], { cwd: A, env: M.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let o = '';
  p.stdout.on('data', (b) => { o += b; });
  p.stderr.on('data', (b) => { o += b; });
  defer(t, () => (p.exitCode === null && p.signalCode === null ? new Promise((r) => { p.once('exit', r); try { process.kill(-p.pid, 'SIGKILL'); } catch { r(); } }) : undefined));
  const list = await until(() => hubList(HUB), `the foreign kit's dashboard hub (${o})`);
  assert.equal(list.kit, null);
  assert.equal('image' in list, false);
});

// box-status's box line: machine status, right after the hub line, names what the box's image is
// (its ENV), and nothing on a machine without it.
test('machine status prints the box line after the hub line, only with the image ENV', { timeout: 120000 }, async (t) => {
  const M = hubMachine(t, 'box-line', PORTS + 96);
  const empty = fs.mkdtempSync(path.join(M.base, 'no-repos-'));
  const script = path.join(kit, 'scripts', 'devteam.mjs');
  const repo = path.resolve(kit, '..', '..');
  const before = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' });
  const status = (vars) => {
    const r = spawnSync(process.execPath, [script, 'machine', 'status', '--in', empty], { cwd: M.cwd, env: { ...M.env, ...vars }, encoding: 'utf8', timeout: 60000 });
    const lines = r.stdout.split('\n');
    const hub = lines.findIndex((l) => l.startsWith('machine: hub '));
    assert.ok(hub >= 0, `a hub line: ${r.stdout}${r.stderr}`);
    return { next: lines[hub + 1], box: lines.filter((l) => l.startsWith('machine: box')) };
  };
  let s = status({ DEVTEAM_KIT_RELEASE: 'v9.9.9', DEVTEAM_BOX_TOOLS: 'claude-code=2.1.310 gh=2.83.0' });
  assert.equal(s.next, 'machine: box v9.9.9: claude-code 2.1.310, gh 2.83.0', 'right after the hub line, in the ENV\'s order');
  assert.equal(s.box.length, 1);
  assert.deepEqual(status({}).box, [], 'no image ENV: no box line');
  assert.deepEqual(status({ DEVTEAM_KIT_RELEASE: ' ', DEVTEAM_BOX_TOOLS: '' }).box, [], 'spaces only are unset');
  assert.equal(status({ DEVTEAM_KIT_RELEASE: '\u001b[31mx', DEVTEAM_BOX_TOOLS: 'gh=2.83.0 uv=\u001b[0m \u001b[1m=1 gh=9' }).next, 'machine: box ?: gh 2.83.0', 'only plain values reach the terminal');
  assert.equal(status({ DEVTEAM_KIT_RELEASE: 'v1.0.0' }).next, 'machine: box v1.0.0', 'no tools named');
  assert.equal(status({ DEVTEAM_BOX_TOOLS: 'gh=2.83.0\t uv=0.9.9' }).next, 'machine: box ?: gh 2.83.0, uv 0.9.9', 'tools with no release; any spaces between pairs');
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }), before, 'no file added');
});
