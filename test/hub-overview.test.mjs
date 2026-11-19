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
import { PORTS, bareProject, fleetFixture, freePort, json, kit, line, startDashboard, until } from './lib/kit.mjs';
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

test('Settings draws the box line from box.json and the latest list; the Overview draws none', () => {
  const html = hubHtml();
  const body = (start) => { const i = html.indexOf(start); assert.ok(i > 0, start); const rest = html.slice(i + start.length); const j = rest.search(/\n(async )?function /); return rest.slice(0, j < 0 ? undefined : j); };
  assert.match(body('function paintSettings('), /boxLine\(box\?\.image \?\? null, hubSeen\)/, 'Settings draws it');
  assert.doesNotMatch(body('function paintSettings('), /innerHTML/, 'no markup from the line');
  assert.doesNotMatch(body('function paintOverview('), /boxLine/, 'the Overview shows no box line (owner, thread t-20261115-204523188-owner)');
  assert.match(body('async function findBox('), /image: b\.image/, 'findBox keeps the image');
  const draw = body('async function draw(');
  assert.match(draw, /hubSeen = data;/, 'draw keeps the list it read');
  assert.match(draw, /if \(!data \|\| typeof data !== 'object'\) throw/, 'JSON that is no list (null, a number) is none');
  assert.doesNotMatch(html, /\.ov-box/, 'nor its styles');
  assert.ok(html.includes("This browser can't notify from this page"), 'the row says why when the browser cannot notify');
});

test("the box's alert: once, from any project's box_alert; a project's alert less the box's folded at its end", () => {
  const html = hubHtml();
  const fn = (name) => { const i = html.indexOf(`function ${name}(`); assert.ok(i > 0, name); const rest = html.slice(i); return rest.slice(0, rest.indexOf('\n}\n') + 2); };
  const ctx = vm.createContext({ items: new Map() });
  vm.runInContext(`${fn('boxAlertNow')}\n${fn('ownAlert')}\n;globalThis.api = { boxAlertNow, ownAlert };`, ctx);
  const { boxAlertNow, ownAlert } = ctx.api;
  assert.equal(boxAlertNow(), null);
  assert.equal(ownAlert({ alert: 'at a usage limit' }), 'at a usage limit');
  assert.equal(ownAlert({}), null);
  ctx.items.set('/a', { x: { box_alert: ' disk · full ' } });
  ctx.items.set('/b', { x: {} });
  assert.equal(boxAlertNow(), 'disk · full', "any project's box_alert");
  assert.equal(ownAlert({ alert: 'disk · full', box_alert: 'disk · full' }), null, 'only the box\'s: no "!" on the project\'s tab');
  assert.equal(ownAlert({ alert: 'at a usage limit · disk · full', box_alert: 'disk · full' }), 'at a usage limit', 'a box alert holding " · " comes off whole');
  assert.equal(ownAlert({ alert: 'at a usage limit · disk · full' }), 'at a usage limit', 'an older kit without box_alert: the box text another project carries');
  assert.equal(ownAlert({ alert: 'disk · full is not mine' }), 'disk · full is not mine', 'only a trailing copy');
  // where they are used: the Overview tab and the line under its header, and each tab and card's own
  const body = (start) => { const i = html.indexOf(start); assert.ok(i > 0, start); const rest = html.slice(i + start.length); const j = rest.search(/\n(async )?function /); return rest.slice(0, j < 0 ? undefined : j); };
  assert.match(body('function paintOverview('), /const box = boxAlertNow\(\)/);
  assert.match(body('function paintOvTab('), /boxAlertNow\(\)/);
  assert.match(body('function paintTab('), /ownAlert\(x\)/);
  assert.match(body('function overviewCard('), /ownAlert\(x\)/);
  assert.doesNotMatch(body('function paintTab('), /x\.alert/, 'a tab never shows the raw alert');
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
  assert.deepEqual(plain(tabCounts(0, { you: 1, waiting: 2, ready: 0 }).th), { n: 1, tone: 'you', title: '1 your move' }, 'your move before waiting');
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
  assert.equal(heldPill({ goals: { run: 1, drain: 0, park: 1, held: [{ title: 'Quiet', mode: 7 }] } }).title, 'Quiet: held', 'no why and no mode: held');
});

test('the Overview\'s rules: the machine switch\'s mode', () => {
  const { machineMode } = overviewRules();
  assert.deepEqual(plain(machineMode(['run', 'run'])), { mode: 'run', counts: { running: 2, draining: 0, parked: 0 } });
  assert.deepEqual(plain(machineMode(['park', 'park'])), { mode: 'park', counts: { running: 0, draining: 0, parked: 2 } });
  assert.deepEqual(plain(machineMode(['run', 'park', 'drain'])), { mode: 'mixed', counts: { running: 1, draining: 1, parked: 1 } });
  assert.deepEqual(plain(machineMode([])), { mode: null, counts: { running: 0, draining: 0, parked: 0 } });
  assert.deepEqual(plain(machineMode(['run', 'nope', null])), { mode: 'run', counts: { running: 1, draining: 0, parked: 0 } }, 'what is no mode is not counted');
});

test('the Overview\'s rules: addresses a view never loses', () => {
  const { hubKey } = overviewRules();
  assert.equal(hubKey('alpha', false, 'abc123'), 'alpha');
  assert.equal(hubKey('alpha', true, 'abc123'), 'alpha-abc123', 'two of one name');
  for (const v of ['settings', 'overview', 'terminal']) assert.equal(hubKey(v, false, 'abc123'), `${v}-abc123`, v);
  assert.match(hubHtml(), /return hubKey\(it\.x\.name, twins, hex6\.get\(it\.x\.root\)\);/, 'keyOf uses it');
});

// ----- the Overview in Chrome, on hellos the test writes (kit-94) ---------------------------------
// A hub of the test's own: one server serves hub.html, an instances.json the test changes as it goes
// and, for a box, a box.json; and on each instance's port a stand-in dashboard that answers the
// hub's Run, Drain and Park asks (once per nonce, after a delay or with an error when told) and says
// what its address's hash is, each time it changes.
function hello(name, port, over = {}) {
  const { pulse, ...rest } = over;
  return {
    devteam: 1, name, root: `/srv/${name}`, port, kit: 'v0.57.0', viewer: 1, inbox: 0, threads: { you: 0, waiting: 0, ready: 0 }, fleet: { mode: 'run', workers: 1 }, ...rest,
    pulse: pulse === null ? null : { state: 'moving', blocking: null, working: 1, last_activity: new Date().toISOString(), activity: Array(84).fill(0), activity_of: 'commits', attention: [], open_tickets: 2, done_tickets: 1, blocked_tickets: 0, goals_open: 1, goal: { title: `${name}'s goal`, done: 1, total: 3 }, ...(pulse || {}) },
  };
}
const STAND_IN = `<!doctype html><meta charset="utf-8"><title>stand-in</title><script>
const say = () => fetch('/hash?h=' + encodeURIComponent(location.hash));
say(); addEventListener('hashchange', say);
addEventListener('message', async (ev) => {
  const m = ev.data;
  if (!m || m.devteam !== 'hub-fleet' || ev.source !== parent) return;
  const r = await (await fetch('/asked?mode=' + encodeURIComponent(m.mode) + '&all=' + (m.all === true) + '&nonce=' + encodeURIComponent(m.nonce))).json();
  if (r.answer) parent.postMessage({ devteam: 'hub-fleet-done', nonce: m.nonce, ...r.answer }, ev.origin);
});
</script>`;
async function listenOn(t, srv, port = 0, host = '127.0.0.1') {
  await new Promise((r) => srv.listen(port, host, r));
  defer(t, () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }));
  return srv.address().port;
}
async function fixtureHub(t, { ports = [], box = null, kit: hubKit = 'v0.57.0', image } = {}) {
  const F = { list: [], asks: new Map(), hashes: new Map(), fail: new Map(), delay: new Map() };
  F.setList = (list) => { F.list = list; };
  for (const port of ports) {
    F.asks.set(port, []);
    F.hashes.set(port, []);
    const seen = new Set();
    await listenOn(t, http.createServer(async (q, s) => {
      const u = new URL(q.url, 'http://x');
      if (u.pathname === '/hash') { F.hashes.get(port).push(u.searchParams.get('h')); return s.end('{}'); }
      if (u.pathname === '/asked') {
        const nonce = u.searchParams.get('nonce');
        if (seen.has(nonce)) return s.end('{"answer":null}');
        seen.add(nonce);
        await new Promise((r) => setTimeout(r, F.delay.get(port) ?? 0));
        F.asks.get(port).push({ mode: u.searchParams.get('mode'), all: u.searchParams.get('all') === 'true' });
        const err = F.fail.get(port);
        return s.end(JSON.stringify({ answer: err ? { ok: false, error: err } : { ok: true } }));
      }
      s.writeHead(200, { 'content-type': 'text/html' });
      s.end(STAND_IN);
    }), port);
  }
  const hubPort = await listenOn(t, http.createServer((q, s) => {
    const u = new URL(q.url, 'http://x');
    if (u.pathname === '/') { s.writeHead(200, { 'content-type': 'text/html' }); return s.end(hubHtml()); }
    if (u.pathname === '/instances.json') { s.writeHead(200, { 'content-type': 'application/json' }); return s.end(JSON.stringify({ hub: 1, kit: hubKit, ...(image ? { image: true } : {}), instances: F.list })); }
    if (u.pathname === '/box.json' && box) { s.writeHead(200, { 'content-type': 'application/json' }); return s.end(JSON.stringify(box(F))); }
    s.writeHead(404, { 'content-type': 'application/json' });
    s.end('{}');
  }));
  F.port = hubPort;
  F.url = (at = '/') => `http://127.0.0.1:${hubPort}${at}`;
  return F;
}
async function freePorts(n) { const out = []; while (out.length < n) { const p = await freePort(); if (!out.includes(p)) out.push(p); } return out; }
// Chrome on the fixture's hub, at a size
async function hubPage(t, url, { width = 1440, height = 900 } = {}) {
  const chrome = await openChrome();
  defer(t, () => chrome.close());
  const p = await chrome.newPage();
  defer(t, () => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.navigate', { url });
  p.until = (what, expr) => until(() => p.ev(expr).catch(() => false), what);
  return p;
}
const CHROME = { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 };
// in the page: a project's card, its tab
const cardOf = (name) => `[...document.querySelectorAll('.ov-card')].find((c) => c.querySelector('.ov-name')?.textContent === ${JSON.stringify(name)})`;
const tabOf = (name) => `[...document.querySelectorAll('#tabs [role=tab]')].find((x) => x.textContent.startsWith(${JSON.stringify(name)}))`;
const selectedTab = `(document.querySelector('#tabs [role=tab][aria-selected=true]')?.textContent ?? null)`;

test('the Overview: a header, then two cards a row with the standard head', CHROME, async (t) => {
  const [A, B, C] = await freePorts(3);
  const F = await fixtureHub(t, { ports: [A, B, C] });
  F.setList([hello('alpha', A, { pulse: { state: 'building' } }), hello('beta', B, { inbox: 1, pulse: { state: 'waiting' } }), hello('gamma', C, { pulse: { state: 'blocked', blocking: 'full', attention: ['Fully blocked: all 2 open tickets wait on your answer to 1 question'] } })]);
  const p = await hubPage(t, F.url('/'));
  await p.until('three cards', `document.querySelectorAll('.ov-card').length === 3`);
  assert.equal(await p.ev(`document.querySelector('#ov-body > .ov-head h2').textContent`), 'This machine');
  assert.equal(await p.ev(`document.querySelector('#ov-body > .ov-head [data-pin=headline]').textContent`), 'This machine', 'the headline pin is the heading');
  assert.equal(await p.ev(`document.querySelector('#ov-body > .ov-head .sum').textContent`), '3 projects · 1 moving · 1 waiting on you · 1 blocked');
  const cards = await p.ev(`[...document.querySelectorAll('.ov-card')].map((c) => ({ name: c.querySelector('.ov-name').textContent, c6: c.classList.contains('c6') && c.classList.contains('card'), top: Math.round(c.getBoundingClientRect().top), last: c.querySelector('.card-head').lastElementChild.className, pills: [...c.querySelectorAll('.card-head .pill')].map((x) => x.textContent) }))`);
  assert.deepEqual(cards.map((c) => c.name), ['gamma', 'beta', 'alpha'], 'what needs the owner first');
  assert.ok(cards.every((c) => c.c6), 'each card .c6 of the 12');
  assert.equal(cards[0].top, cards[1].top, 'two to a row');
  assert.notEqual(cards[2].top, cards[0].top);
  assert.ok(cards.every((c) => /\bmenu-btn\b/.test(c.last) && /\bend\b/.test(c.last)), '⋯ last, pinned right');
  assert.deepEqual(cards.map((c) => c.pills), [['Fully blocked'], ['Waiting on you'], ['Building']]);
  assert.equal(await p.ev(`document.querySelectorAll('.ov-goals, .ov-goal').length`), 0, 'no goal list');
  assert.equal(await p.ev(`document.querySelectorAll('.hub-goal').length`), 3, 'one top goal line a card');
  assert.deepEqual(await p.ev(`[...${cardOf('alpha')}.querySelectorAll('.ov-stat .k')].map((k) => k.textContent)`), ['Kit', 'Inbox', 'Working', 'Last moved']);
  assert.equal(await p.ev(`!!${cardOf('alpha')}.querySelector('.ov-mosaic')`), true, 'the activity mosaic');
  // the menu: the root and port, and opening nothing by itself
  await p.ev(`${cardOf('beta')}.querySelector('.menu-btn').click()`);
  await p.until('the menu', `!!document.querySelector('.menu-pop')`);
  assert.match(await p.ev(`document.querySelector('.menu-pop').textContent`), new RegExp(`/srv/beta.*${B}`));
  assert.equal(await p.ev(selectedTab), 'Overview');
  await p.key('Escape');
  await p.until('the menu closed', `!document.querySelector('.menu-pop')`);
  assert.equal(await p.ev(`document.activeElement?.dataset.k ?? null`), '/srv/beta:menu', 'Escape gives the keyboard back to ⋯');
  // a redraw closes it (the spec); the keyboard, inside it, goes back to its ⋯
  await p.ev(`${cardOf('beta')}.querySelector('.menu-btn').click()`);
  await p.until('the menu again', `document.querySelector('.menu-pop')?.contains(document.activeElement) ?? false`);
  await p.ev('paintOverview()');
  assert.deepEqual(await p.ev(`[!!document.querySelector('.menu-pop'), document.activeElement?.dataset.k ?? null]`), [false, '/srv/beta:menu'], 'closed by the redraw, focus on its ⋯');
  // the keyboard elsewhere stays where it is
  await p.ev(`${cardOf('beta')}.querySelector('.menu-btn').click()`);
  await p.until('the menu once more', `!!document.querySelector('.menu-pop')`);
  await p.ev(`${cardOf('gamma')}.querySelector('.ov-name').focus()`);
  await p.ev('paintOverview()');
  assert.deepEqual(await p.ev(`[!!document.querySelector('.menu-pop'), document.activeElement?.dataset.k ?? null]`), [false, '/srv/gamma:name']);
  // another view closes it
  await p.ev(`${cardOf('beta')}.querySelector('.menu-btn').click()`);
  await p.until('the menu, last time', `!!document.querySelector('.menu-pop')`);
  await p.ev(`${tabOf('alpha')}.click()`);
  await p.until("alpha's dashboard, no menu", `${selectedTab}?.startsWith('alpha') && !document.querySelector('.menu-pop')`);
  await p.ev(`[...document.querySelectorAll('#tabs [role=tab]')].find((x) => x.textContent === 'Overview').click()`);
  await p.until('the Overview', `!document.getElementById('overview').hidden`);
  // the Settings link keeps the keyboard across a redraw
  await p.ev(`document.querySelector('#ov-body > .ov-head a.set').focus()`);
  await p.ev('paintOverview()');
  assert.equal(await p.ev(`document.activeElement?.matches('#ov-body > .ov-head a.set') ?? false`), true, 'Settings link keeps focus');
  // a click on a card, off its controls, opens that project's dashboard as its tab does
  await p.ev(`${cardOf('alpha')}.querySelector('.ov-mosaic').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await p.until("alpha's dashboard", `${selectedTab}?.startsWith('alpha') && document.querySelectorAll('iframe:not([hidden])').length === 1 && document.getElementById('overview').hidden`);
});

test('the summary counts stalled and gone as blocked; a starting project shows no Inbox count', CHROME, async (t) => {
  const [A, B, C, D] = await freePorts(4);
  const F = await fixtureHub(t, { ports: [A, B, C, D] });
  const list = [hello('alpha', A, { pulse: { state: 'stalled' } }), hello('beta', B), hello('gamma', C, { inbox: null, pulse: null }), hello('delta', D, { inbox: null })];
  F.setList(list);
  const p = await hubPage(t, F.url('/'));
  await p.until('four cards', `document.querySelectorAll('.ov-card').length === 4`);
  assert.equal(await p.ev(`${cardOf('delta')}.querySelector('[data-pin=inbox] .v').textContent`), '–', 'not 0: it has not said');
  F.setList(list.filter((x) => x.name !== 'beta'));
  await p.until('beta gone', `${cardOf('beta')}?.querySelector('.card-head .pill:not(.shrink)')?.textContent === 'Not answering'`);
  assert.match(await p.ev(`document.querySelector('#ov-body > .ov-head .sum').textContent`), /· 2 blocked/);
});

test('the tabs: a dot by state, the state word, the Inbox counts', CHROME, async (t) => {
  const ports = await freePorts(6);
  const [A, B, C, D, E, Z] = ports;
  const F = await fixtureHub(t, { ports });
  const list = [
    hello('alpha', A, { inbox: 3, threads: { you: 1, waiting: 1, ready: 1 }, pulse: { state: 'building' } }),
    hello('beta', B, { threads: { you: 2, waiting: 0, ready: 0 }, pulse: { state: 'moving' } }),
    hello('gamma', C, { threads: { you: 0, waiting: 2, ready: 0 }, pulse: { state: 'waiting' } }),
    hello('delta', D, { pulse: { state: 'blocked', blocking: 'full' } }),
    hello('epsilon', E, { fleet: { mode: 'park', workers: 0 }, pulse: { state: 'parked' } }),
    hello('zeta', Z, { pulse: { state: 'building' } }),
  ];
  F.setList(list);
  const p = await hubPage(t, F.url('/'));
  await p.until('six tabs', `document.querySelectorAll('.ov-card').length === 6`);
  // zeta's dashboard stops answering: off the list, its tab stays 30 s, Not answering
  F.setList(list.slice(0, 5));
  await p.until('zeta not answering', `${tabOf('zeta')}?.title === 'Not answering'`);
  const tabs = await p.ev(`['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'].map((n) => { const x = [...document.querySelectorAll('#tabs [role=tab]')].find((b) => b.textContent.startsWith(n)); const c = x.querySelector('.tab-counts'); return { dot: [...x.querySelector('.dot').classList].join(' '), title: x.title, q: c?.querySelector('.n.q')?.textContent ?? null, th: c?.querySelector('.n.th') ? [...c.querySelector('.n.th').classList].join(' ') + ' ' + c.querySelector('.n.th').textContent : null, counts: !!c }; })`);
  assert.deepEqual(tabs.map((x) => x.dot), ['dot green', 'dot blue', 'dot amber', 'dot red pulse', 'dot', 'dot red pulse']);
  assert.deepEqual(tabs.map((x) => x.title), ['Building', 'Moving', 'Waiting on you', 'Fully blocked', 'Parked', 'Not answering']);
  assert.deepEqual(tabs.slice(0, 3).map((x) => [x.q, x.th]), [['3', 'n th ok 2'], [null, 'n th you 2'], [null, 'n th wait 2']]);
  assert.deepEqual(tabs.slice(3).map((x) => x.counts), [false, false, false], 'nothing when both are 0');
  assert.equal(await p.ev(`${tabOf('alpha')}.querySelector('.n.th').title`), '1 ready to accept, 1 your move');
  assert.equal(await p.ev(`${tabOf('alpha')}.querySelector('.tab-counts').getAttribute('aria-label')`), '3 open questions, 1 ready to accept, 1 your move', 'words for a screen reader');
  assert.ok(await p.ev(`[...document.querySelectorAll('#tabs [role=tab]')].some((x) => x.textContent === 'Overview')`), 'the Overview tab reads Overview, nothing else');
  // the red dot pulses, except under reduced motion
  const anim = `getComputedStyle(${tabOf('delta')}.querySelector('.dot')).animationName`;
  assert.equal(await p.ev(anim), 'shell-ring');
  await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await p.ev(anim), 'none');
});

test('a fully blocked card: red border, head divider in --line; the Inbox stat as the tab', CHROME, async (t) => {
  const [A, B] = await freePorts(2);
  const F = await fixtureHub(t, { ports: [A, B] });
  F.setList([hello('alpha', A, { inbox: 2, threads: { you: 1, waiting: 0, ready: 0 }, pulse: { state: 'blocked', blocking: 'full' } }), hello('beta', B, { pulse: { state: 'building' } })]);
  const p = await hubPage(t, F.url('/'));
  await p.until('two cards', `document.querySelectorAll('.ov-card').length === 2`);
  const colour = (v) => `(() => { const e = document.createElement('div'); e.style.color = 'var(${v})'; document.body.append(e); const c = getComputedStyle(e).color; e.remove(); return c; })()`;
  const red = await p.ev(colour('--red'));
  const line = await p.ev(colour('--line'));
  const a = await p.ev(`(() => { const c = ${cardOf('alpha')}, s = getComputedStyle(c), h = getComputedStyle(c.querySelector('.card-head')); return { cls: c.classList.contains('blocked'), top: s.borderTopColor, style: s.borderTopStyle, width: s.borderTopWidth, head: h.borderBottomColor }; })()`);
  assert.deepEqual(a, { cls: true, top: red, style: 'solid', width: '1px', head: line });
  assert.equal(await p.ev(`${cardOf('beta')}.classList.contains('blocked')`), false);
  // the Inbox stat: the tab's counts, and a click opens the project's dashboard on its Inbox
  assert.equal(await p.ev(`${cardOf('alpha')}.querySelector('[data-pin=inbox] .tab-counts').innerHTML`), await p.ev(`${tabOf('alpha')}.querySelector('.tab-counts').innerHTML`));
  assert.equal(await p.ev(`${cardOf('beta')}.querySelector('[data-pin=inbox] .v').textContent`), '0');
  await p.ev(`${cardOf('alpha')}.querySelector('[data-pin=inbox] button').click()`);
  await p.until("alpha's dashboard", `${selectedTab}?.startsWith('alpha')`);
  await until(() => F.hashes.get(A).includes('#overview?th=inbox'), 'the dashboard at #overview?th=inbox');
});

test('the gap audit rows: top goal +N more and its bar, kit behind in amber, not answering, an old kit', CHROME, async (t) => {
  const [A, B, C, D] = await freePorts(4);
  const F = await fixtureHub(t, { ports: [A, B, C, D] });
  const list = [
    hello('alpha', A, { kit: 'v0.50.0', pulse: { goals_open: 3, goal: { title: 'Billing', done: 1, total: 4 }, open_tickets: 5, done_tickets: 3, blocked_tickets: 2 } }),
    hello('beta', B, { pulse: { goals_open: 0, goal: null } }),
    hello('gamma', C),
    hello('delta', D, { pulse: null }),
  ];
  F.setList(list);
  const p = await hubPage(t, F.url('/'));
  await p.until('four cards', `document.querySelectorAll('.ov-card').length === 4`);
  const g = await p.ev(`(() => { const c = ${cardOf('alpha')}; const b = c.querySelector('.hub-goal .ov-bar'); return { text: c.querySelector('.hub-goal').textContent, now: b.getAttribute('aria-valuenow'), max: b.getAttribute('aria-valuemax') }; })()`);
  assert.match(g.text, /^Billing\+2 more/);
  assert.match(g.text, /3 of 8 merged · 2 waiting on you$/);
  assert.deepEqual([g.now, g.max], ['3', '8']);
  assert.match(await p.ev(`${cardOf('beta')}.querySelector('.hub-goal').textContent`), /^No goal approved yet/);
  const kit = await p.ev(`(() => { const v = ${cardOf('alpha')}.querySelector('[data-pin=kit] .v'); return { amber: v.classList.contains('amber'), title: v.closest('[data-pin=kit]').title }; })()`);
  assert.equal(kit.amber, true);
  assert.match(kit.title, /v0\.57\.0/, 'the newest kit among the projects');
  assert.equal(await p.ev(`${cardOf('beta')}.querySelector('[data-pin=kit] .v').classList.contains('amber')`), false);
  // an old kit: no pulse, still answering
  const old = await p.ev(`(() => { const c = ${cardOf('delta')}; return { why: c.querySelector('.hub-why')?.textContent, stats: !!c.querySelector('.ov-stats'), goal: !!c.querySelector('.hub-goal'), sw: !!c.querySelector('.fleet-switch, .seg') }; })()`);
  assert.deepEqual(old, { why: 'Update its kit to see what it is doing', stats: false, goal: false, sw: false });
  // gamma stops answering
  F.setList(list.filter((x) => x.name !== 'gamma'));
  await p.until('gamma not answering', `${cardOf('gamma')}?.querySelector('.card-head .pill:not(.shrink)')?.textContent === 'Not answering'`);
  const gone = await p.ev(`(() => { const c = ${cardOf('gamma')}; return { cls: c.classList.contains('blocked'), att: c.querySelector('.ov-att li')?.textContent ?? '', goal: !!c.querySelector('.hub-goal') }; })()`);
  assert.equal(gone.cls, true);
  assert.match(gone.att, /^Its dashboard stopped answering at /);
  assert.equal(gone.goal, false);
  assert.equal(await p.ev(`${tabOf('gamma')}.title`), 'Not answering');
});

test('the partly-held pill: words, hover, a click to Goals', CHROME, async (t) => {
  const [A, B, C] = await freePorts(3);
  const F = await fixtureHub(t, { ports: [A, B, C] });
  F.setList([
    hello('alpha', A, { fleet: { mode: 'run', workers: 1, goals: { run: 2, drain: 0, park: 9 } } }),
    hello('beta', B, { fleet: { mode: 'run', workers: 1, goals: { run: 1, drain: 1, park: 1, held: [{ title: 'Recurring checks', mode: 'park', why: 'waits on your approval' }, { title: 'Sense the outside world', mode: 'drain' }] } } }),
    hello('gamma', C),
  ]);
  const p = await hubPage(t, F.url('/'));
  await p.until('three cards', `document.querySelectorAll('.ov-card').length === 3`);
  assert.deepEqual(await p.ev(`(() => { const x = ${cardOf('alpha')}.querySelector('.held-pill'); return [x.textContent, x.title, x.classList.contains('amber')]; })()`), ['Partly parked · 2 of 11 goals running', '9 parked, 0 draining', true]);
  assert.equal(await p.ev(`${cardOf('beta')}.querySelector('.held-pill').title`), 'Recurring checks: waits on your approval\nSense the outside world: drain');
  assert.equal(await p.ev(`!!${cardOf('gamma')}.querySelector('.held-pill')`), false, 'no fleet.goals: no pill');
  await p.ev(`${cardOf('alpha')}.querySelector('.held-pill').focus()`);
  await p.ev('paintOverview()');
  assert.equal(await p.ev(`document.activeElement?.classList.contains('held-pill') && document.activeElement.closest('.ov-card') === ${cardOf('alpha')}`), true, 'the pill keeps focus across a redraw');
  await p.ev(`${cardOf('alpha')}.querySelector('.held-pill').click()`);
  await p.until("alpha's dashboard", `${selectedTab}?.startsWith('alpha')`);
  await until(() => F.hashes.get(A).includes('#goals'), 'the dashboard at #goals');
});

test('720px: two cards a row, the body wraps inside each', CHROME, async (t) => {
  const [A, B] = await freePorts(2);
  const F = await fixtureHub(t, { ports: [A, B] });
  F.setList([hello('alpha', A), hello('beta', B)]);
  const p = await hubPage(t, F.url('/'), { width: 720, height: 800 });
  await p.until('two cards', `document.querySelectorAll('.ov-card').length === 2`);
  const r = await p.ev(`(() => { const cs = [...document.querySelectorAll('.ov-card')]; return { tops: cs.map((c) => Math.round(c.getBoundingClientRect().top)), out: cs.flatMap((c) => [...c.querySelectorAll('.hub-body *')].filter((e) => e.getBoundingClientRect().right > c.getBoundingClientRect().right + 0.5).map((e) => e.className)) }; })()`);
  assert.equal(r.tops[0], r.tops[1], 'two to a row at 720');
  assert.deepEqual(r.out, []);
});

test('390px: a long name and three pills stay in the head', CHROME, async (t) => {
  const [A] = await freePorts(1);
  const F = await fixtureHub(t, { ports: [A] });
  const long = 'a-project-with-a-very-long-name-indeed-xx';
  F.setList([hello(long, A, { fleet: { mode: 'run', workers: 1, goals: { run: 2, drain: 0, park: 9 } }, pulse: { state: 'building', blocking: 'partial', blocked_tickets: 1, open_tickets: 3 } })]);
  const p = await hubPage(t, F.url('/'), { width: 390, height: 844 });
  await p.until('the card', `document.querySelectorAll('.ov-card').length === 1`);
  const r = await p.ev(`(() => { const h = document.querySelector('.ov-card .card-head'), hr = h.getBoundingClientRect(); const o = document.getElementById('overview'); return { pills: h.querySelectorAll('.pill').length, out: [...h.children].filter((e) => e.getBoundingClientRect().right > hr.right + 0.5 || e.getBoundingClientRect().left < hr.left - 0.5).map((e) => e.className), menuIn: h.lastElementChild.getBoundingClientRect().right <= hr.right, scroll: o.scrollWidth <= o.clientWidth }; })()`);
  assert.deepEqual(r, { pills: 3, out: [], menuIn: true, scroll: true });
});

// in the page: the button with that data-k, and the switch around it
const kBtn = (k) => `[...document.querySelectorAll('#ov-body [data-k]')].find((b) => b.dataset.k === ${JSON.stringify(k)})`;
const focusK = (p, k) => p.ev(`${kBtn(k)}.focus()`);
const focusedK = `(document.activeElement?.dataset.k ?? null)`;
const textK = (k) => `(${kBtn(k)}?.textContent ?? null)`;

test('the machine switch: shared mode, Mixed, Park confirms with the count, Run resumes all, Escape cancels', CHROME, async (t) => {
  const [A, B] = await freePorts(2);
  const F = await fixtureHub(t, { ports: [A, B] });
  F.setList([hello('alpha', A), hello('beta', B)]);
  const p = await hubPage(t, F.url('/'));
  await p.until('the machine switch', `!!document.querySelector('#ov-body > .ov-head .fleet-switch[data-scope=machine]')`);
  const m = `document.querySelector('#ov-body > .ov-head .fleet-switch[data-scope=machine]')`;
  assert.equal(await p.ev(`${m}.querySelector('[data-fleet=run]').getAttribute('aria-pressed')`), 'true');
  assert.equal(await p.ev(`${m}.querySelector('.k').textContent`), 'Every fleet');
  assert.deepEqual(await p.ev(`(() => { const a = document.querySelector('#ov-body > .ov-head .acts a.set'); return a && [a.getAttribute('href'), a.textContent, a.closest('.acts').contains(${m})]; })()`), ['#settings', 'Settings', true]);
  assert.equal(await p.ev(`[...document.querySelectorAll('#ov-body button')].some((b) => /^(Park all|Resume all)/.test(b.textContent))`), false, 'no Park all, no Resume all');
  await focusK(p, 'machine:park');
  await p.key(' ');
  await p.until('the confirm', `${textK('machine:park')} === 'Park 2 projects?'`);
  assert.equal(await p.ev(focusedK), 'machine:park');
  await p.ev('paintOverview()');
  assert.equal(await p.ev(focusedK), 'machine:park', 'a redraw keeps the keyboard');
  await p.key('Escape');
  await p.until('cancelled', `${textK('machine:park')} === 'Park'`);
  assert.deepEqual([F.asks.get(A), F.asks.get(B)], [[], []], 'nothing asked');
  await p.key(' ');
  await p.until('the confirm', `${textK('machine:park')} === 'Park 2 projects?'`);
  await p.key(' ');
  await until(() => F.asks.get(A).length && F.asks.get(B).length, 'both asked');
  assert.deepEqual([F.asks.get(A), F.asks.get(B)], [[{ mode: 'park', all: true }], [{ mode: 'park', all: true }]]);
  // a new mix: reload, so nothing the hub just set colours it
  F.setList([hello('alpha', A, { fleet: { mode: 'park', workers: 0 }, pulse: { state: 'parked' } }), hello('beta', B)]);
  await p.send('Page.reload');
  await p.until('Mixed', `${m}?.querySelector('.k').textContent === 'Mixed: 1 running, 0 draining, 1 parked'`);
  assert.equal(await p.ev(`${m}.querySelectorAll('[aria-pressed=true]').length`), 0, 'none pressed');
  await p.ev(`${kBtn('machine:run')}.click()`);
  await until(() => F.asks.get(A).length === 2, 'alpha asked to run');
  assert.deepEqual(F.asks.get(A)[1], { mode: 'run', all: false }, 'Run asks the parked one only');
  assert.equal(F.asks.get(B).length, 1, 'not the one running');
  F.setList([hello('alpha', A), hello('beta', B)]);
  // a dashboard that fails: its name, then its error
  await p.send('Page.reload');
  await p.until('running', `${m}?.querySelector('[data-fleet=run]').getAttribute('aria-pressed') === 'true'`);
  F.fail.set(B, 'no way');
  await p.ev(`${kBtn('machine:drain')}.click()`);
  await p.until('the error', `${m}?.querySelector('.err')?.textContent.startsWith('beta: no way') ?? false`);
});

test("a card's switch: Park confirms, busy, error; pressing the current mode does nothing", CHROME, async (t) => {
  const [A, B] = await freePorts(2);
  const F = await fixtureHub(t, { ports: [A, B] });
  F.setList([hello('alpha', A), hello('beta', B)]);
  const p = await hubPage(t, F.url('/'));
  await p.until('the switches', `!!${kBtn('/srv/alpha:park')}`);
  assert.equal(await p.ev(`${cardOf('alpha')}.querySelector('.foot [data-pin=fleet] .fleet-switch[data-scope=row]') !== null`), true, 'the row switch in the foot, pinned');
  await p.ev(`${kBtn('/srv/alpha:run')}.click()`);
  await new Promise((r) => setTimeout(r, 700));
  assert.deepEqual(F.asks.get(A), [], 'the pressed mode does nothing');
  await focusK(p, '/srv/alpha:park');
  await p.key(' ');
  await p.until('the confirm', `${textK('/srv/alpha:park')} === 'Confirm park'`);
  await p.ev('paintOverview()');
  assert.equal(await p.ev(focusedK), '/srv/alpha:park');
  F.delay.set(A, 1000);
  await p.key(' ');
  await p.until('busy', `${cardOf('alpha')}.querySelector('.fleet-switch .msg')?.textContent === 'Parking…'`);
  await until(() => F.asks.get(A).length === 1, 'alpha asked');
  assert.deepEqual(F.asks.get(A), [{ mode: 'park', all: false }]);
  await p.until('done', `!${cardOf('alpha')}.querySelector('.fleet-switch .msg')`);
  F.fail.set(B, 'it broke');
  await p.ev(`${kBtn('/srv/beta:drain')}.click()`);
  await p.until('the error', `${cardOf('beta')}.querySelector('.fleet-switch .err')?.textContent === 'it broke'`);
});

test('a machine op: its busy words, the cards disabled while it runs; a confirm with nothing to do clears; a new press clears the error', CHROME, async (t) => {
  const [A, B] = await freePorts(2);
  const F = await fixtureHub(t, { ports: [A, B] });
  F.setList([hello('alpha', A), hello('beta', B)]);
  const p = await hubPage(t, F.url('/'));
  await p.until('the machine switch', `!!${kBtn('machine:drain')}`);
  F.delay.set(A, 1500);
  F.delay.set(B, 1500);
  await p.ev(`${kBtn('machine:drain')}.click()`);
  await p.until('busy', `document.querySelector('#ov-body > .ov-head .fleet-switch .msg')?.textContent === 'Draining 2 projects…'`);
  assert.equal(await p.ev(`[...document.querySelectorAll('.ov-card .fleet-switch [data-fleet]')].every((b) => b.disabled)`), true, "the cards' buttons wait for it");
  assert.equal(await p.ev(`[...document.querySelectorAll('.ov-card .fleet-switch .msg')].map((m) => m.textContent).join()`), 'Draining…,Draining…');
  await until(() => F.asks.get(A).length && F.asks.get(B).length, 'both asked');
  await p.until('done', `!document.querySelector('#ov-body .fleet-switch .msg')`);
  F.delay.clear();
  // every project parked: the machine's Park is the mode it is in, and pressing it does nothing (spec: the current mode)
  F.setList([hello('alpha', A, { fleet: { mode: 'park', workers: 0 }, pulse: { state: 'parked' } }), hello('beta', B, { fleet: { mode: 'park', workers: 0 }, pulse: { state: 'parked' } })]);
  await p.send('Page.reload');
  await p.until('parked', `${kBtn('machine:park')}?.getAttribute('aria-pressed') === 'true'`);
  await p.ev(`${kBtn('machine:park')}.click()`);
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(await p.ev(textK('machine:park')), 'Park', 'no confirm for the mode it is in');
  await p.ev(`${kBtn('/srv/alpha:park')}.click()`);
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(await p.ev(textK('/srv/alpha:park')), 'Park', 'nor on a parked card');
  assert.deepEqual([F.asks.get(A).length, F.asks.get(B).length], [1, 1], 'nothing asked');
  // an error, then a new press: the error goes
  F.setList([hello('alpha', A), hello('beta', B)]);
  await p.send('Page.reload');
  await p.until('running', `!!${kBtn('/srv/alpha:drain')} && ${kBtn('/srv/alpha:run')}.getAttribute('aria-pressed') === 'true'`);
  F.fail.set(A, 'it broke');
  await p.ev(`${kBtn('/srv/alpha:drain')}.click()`);
  await p.until('the error', `${cardOf('alpha')}.querySelector('.fleet-switch .err')?.textContent === 'it broke'`);
  await p.ev(`${kBtn('/srv/alpha:park')}.click()`);
  await p.until('the confirm, the error gone', `${textK('/srv/alpha:park')} === 'Confirm park' && !${cardOf('alpha')}.querySelector('.fleet-switch .err')`);
});

test('a partly held card: Run asks "Run every goal?" in place, posts on the second press, Escape cancels', CHROME, async (t) => {
  const [A, B] = await freePorts(2);
  const F = await fixtureHub(t, { ports: [A, B] });
  F.setList([hello('alpha', A, { fleet: { mode: 'run', workers: 1, goals: { run: 2, drain: 0, park: 9 } } }), hello('beta', B, { fleet: { mode: 'park', workers: 0, goals: { run: 0, drain: 1, park: 3 } }, pulse: { state: 'parked' } })]);
  const p = await hubPage(t, F.url('/'));
  await p.until('the switches', `!!${kBtn('/srv/alpha:run')} && !!${kBtn('/srv/beta:run')}`);
  for (const [name, port] of [['alpha', A], ['beta', B]]) {
    const k = `/srv/${name}:run`;
    await focusK(p, k);
    await p.key(' ');
    await p.until('the confirm', `${textK(k)} === 'Run every goal?' && ${cardOf(name)}.querySelector('.fleet-switch[data-confirming="1"]') !== null`);
    assert.equal(await p.ev(focusedK), k);
    assert.deepEqual(F.asks.get(port), [], 'nothing asked yet');
    await p.key('Escape');
    await p.until('cancelled', `${textK(k)} === 'Run'`);
    await p.key(' ');
    await p.until('the confirm', `${textK(k)} === 'Run every goal?'`);
    await p.key(' ');
    await until(() => F.asks.get(port).length === 1, `${name} asked`);
    assert.deepEqual(F.asks.get(port), [{ mode: 'run', all: false }]);
  }
});

// in the page: Settings' groups, and a row by its name
const setGroups = `[...document.querySelectorAll('#hub-settings .sec > .lbl')].map((x) => x.textContent)`;
const setRow = (name) => `(() => { const r = [...document.querySelectorAll('#hub-settings .set-row')].find((x) => x.querySelector('.t')?.firstChild?.textContent.trim() === ${JSON.stringify(name)}); if (!r) return null; const v = r.querySelector('.r'); return { key: r.querySelector('.set-key')?.textContent ?? null, value: [...v.childNodes].filter((n) => !(n.classList && n.classList.contains('badge'))).map((n) => n.textContent).join('').trim(), yours: !!v.querySelector('.badge.amber'), desc: r.nextElementSibling?.classList.contains('set-desc') ? r.nextElementSibling.textContent : null, link: v.querySelector('a') ? [v.querySelector('a').textContent, v.querySelector('a').getAttribute('href')] : null, amber: !!v.querySelector('.amber:not(.badge)') }; })()`;

test('Settings on a laptop: from the link only, This machine and Notifications', CHROME, async (t) => {
  const [A] = await freePorts(1);
  const F = await fixtureHub(t, { ports: [A], kit: 'v0.57.0' });
  F.setList([hello('settings', A)]);
  const p = await hubPage(t, F.url('/'));
  await p.until('the card', `document.querySelectorAll('.ov-card').length === 1`);
  assert.equal(await p.ev(`[...document.querySelectorAll('#tabs [role=tab]')].some((x) => x.textContent === 'Settings')`), false, 'no Settings tab');
  await p.ev(`document.querySelector('#ov-body > .ov-head a.set').click()`);
  await p.until('Settings', `location.hash === '#settings' && !document.getElementById('settings-view').hidden`);
  assert.deepEqual(await p.ev(`[document.getElementById('overview').hidden, document.querySelectorAll('#tabs [aria-selected=true]').length, document.getElementById('tl').hidden, document.querySelector('#hub-settings h2')?.textContent]`), [true, 0, true, 'Settings']);
  assert.deepEqual(await p.ev(setGroups), ['This machine', 'Notifications']);
  const hub = await p.ev(setRow('Hub served by kit'));
  assert.deepEqual([hub.key, hub.value, hub.yours, hub.desc], ['hub', 'v0.57.0', false, 'the kit whose hub you are reading; each project keeps its own kit']);
  const ni = await p.ev(setRow('New Inbox items'));
  assert.deepEqual([ni.key, ni.yours, ni.desc], ['on this device', true, 'a notification on this device when any project asks you something']);
  assert.equal(await p.ev(`[...document.querySelectorAll('#hub-settings .set-row')].every((r) => r.nextElementSibling?.classList.contains('set-desc'))`), true, 'a description under each row');
  assert.equal(await p.ev(`!document.querySelector('header #notify, header #box-links')`), true, 'nothing of it left in the header');
  assert.equal(await p.ev(`!!document.querySelector('.ov-box') || /Box v/.test(document.getElementById('ov-body').textContent)`), false, 'no box line on the Overview');
  // a cold load at #settings, with a project named settings: Settings shows, the project's key is its own
  await p.send('Page.navigate', { url: 'about:blank' });
  await p.send('Page.navigate', { url: F.url('/#settings') });
  await p.until('Settings again', `!document.getElementById('settings-view')?.hidden && document.querySelectorAll('#tabs [role=tab]').length >= 2`);
  await p.ev(`${tabOf('settings')}.click()`);
  await p.until('the project', `/^#settings-[0-9a-f]{6}$/.test(location.hash)`);
  await p.ev(`location.hash = 'settings'`);
  await p.until('Settings once more', `!document.getElementById('settings-view').hidden`);
  await new Promise((r) => setTimeout(r, 11000));
  assert.equal(await p.ev(`!document.getElementById('settings-view').hidden && location.hash === '#settings'`), true, 'a draw keeps it');
  // the keyboard gets back: the Overview tab is in the tab order (none selected), and its arrows move on from it
  const ov = `[...document.querySelectorAll('#tabs [role=tab]')].find((x) => x.textContent === 'Overview')`;
  assert.deepEqual(await p.ev(`[${ov}.tabIndex, ${ov}.getAttribute('aria-selected')]`), [0, 'false']);
  await p.ev(`${ov}.focus()`);
  await p.key('ArrowRight');
  await p.until('the project after the Overview', `/^#settings-[0-9a-f]{6}$/.test(location.hash)`);
  await p.ev(`location.hash = 'settings'`);
  await p.until('Settings again', `!document.getElementById('settings-view').hidden`);
  await p.ev(`${ov}.focus()`);
  await p.key(' ');
  await p.until('the Overview', `!document.getElementById('overview').hidden && document.getElementById('settings-view').hidden`);
});

test('Settings: the Notify button is the live control, the Test row once notifications are on, focus kept across the repaint', CHROME, async (t) => {
  const [A] = await freePorts(1);
  const F = await fixtureHub(t, { ports: [A] });
  F.setList([hello('alpha', A)]);
  const p = await hubPage(t, F.url('/#settings'));
  await p.until('Settings', `!document.getElementById('settings-view').hidden && document.querySelectorAll('#hub-settings .set-row').length >= 2`);
  const notify = `[...document.querySelectorAll('#hub-settings .set-row')].find((r) => r.querySelector('.t').firstChild.textContent.trim() === 'New Inbox items').querySelector('.r button')`;
  assert.equal(await p.ev(`${notify}?.textContent ?? null`), 'Notify me of new Inbox items');
  assert.equal(await p.ev(setRow('Test')), null, 'no Test row while notifications are off');
  // the button's focus outlives a repaint
  await p.ev(`${notify}.focus()`);
  await p.ev('paintSettings()');
  assert.equal(await p.ev(`document.activeElement === ${notify}`), true, 'focus kept');
  // the row's button is the page's own control: pressed, with notifications allowed, it turns them on
  await p.send('Browser.grantPermissions', { origin: F.url('/').replace(/\/$/, ''), permissions: ['notifications'] });
  await p.ev(`${notify}.click()`);
  await p.until('on', `${setRow('New Inbox items')}?.value === 'Notifying you of new Inbox items'`);
  const test = await p.ev(setRow('Test'));
  assert.deepEqual([test?.key, test?.desc], ['on this device', 'send one now, to see that this device gets them']);
  const send = `[...document.querySelectorAll('#hub-settings .set-row')].find((r) => r.querySelector('.t').firstChild.textContent.trim() === 'Test').querySelector('button')`;
  await p.ev(`${send}.focus()`);
  await p.ev('paintSettings()');
  assert.equal(await p.ev(`document.activeElement === ${send}`), true, 'its focus outlives a repaint');
  await p.ev(`${send}.click()`);
  await p.until('sent', `${send}.textContent === 'Test sent'`);
  await p.ev('paintSettings()');
  assert.equal(await p.ev(`${send}.textContent`), 'Test sent', 'its answer outlives a repaint');
});

test("Settings on a box: Signing in and Serving, boxLine's parts", CHROME, async (t) => {
  let F;
  F = await fixtureHub(t, { kit: 'v0.57.0', image: true, box: () => {
    const at = (h) => `http://${h}.localhost:${F.port}/`;
    return { box: 2, terminal: at('terminal'), project: `http://{project}.localhost:${F.port}/`, passkeys: at('auth'), previews: at('previews'), image: { release: 'v0.57.0', tools: { 'claude-code': '2.4.1' } } };
  } });
  F.setList([]);
  const p = await hubPage(t, `http://hub.localhost:${F.port}/#settings`);
  let loaded = false;
  for (let i = 0; i < 100 && !loaded; i++) { loaded = (await p.ev(`document.title`).catch(() => '')) === 'devteam'; if (!loaded) await new Promise((r) => setTimeout(r, 100)); }
  if (!loaded) return t.skip("headless Chrome can't load hub.localhost here");
  await p.until('the box rows', `document.querySelectorAll('#hub-settings .sec').length === 4`);
  assert.deepEqual(await p.ev(setGroups), ['This machine', 'Signing in', 'Notifications', 'Serving']);
  const rel = await p.ev(setRow('Box release'));
  assert.deepEqual([rel.key, rel.value, rel.desc], ['DEVTEAM_KIT_RELEASE', 'v0.57.0', 'the box image this machine runs']);
  const hub = await p.ev(setRow('Hub'));
  assert.deepEqual([hub.key, hub.value, hub.amber], ['hub', 'hub v0.57.0', false]);
  const cc = await p.ev(setRow('Claude Code'));
  assert.deepEqual([cc.key, cc.value, cc.desc], ['DEVTEAM_BOX_TOOLS', '2.4.1', 'the version on this box']);
  const pk = await p.ev(setRow('Passkeys'));
  assert.deepEqual([pk.key, pk.link, pk.yours], ['passkeys', ['Manage', `http://auth.localhost:${F.port}/`], true]);
  const pv = await p.ev(setRow('Previews'));
  assert.deepEqual([pv.key, pv.link], ['previews', ['Previews', `http://previews.localhost:${F.port}/`]]);
  assert.equal(await p.ev(`[...document.querySelectorAll('#tabs [role=tab]')].some((x) => x.textContent === 'Terminal')`), true, 'the Terminal tab stays');
  // a link keeps the keyboard across the repaint
  await p.ev(`document.querySelector('#hub-settings a[href^="http://auth."]').focus()`);
  await p.ev('paintSettings()');
  assert.equal(await p.ev(`document.activeElement?.textContent === 'Manage' && document.activeElement.closest('#hub-settings') !== null`), true, 'Manage keeps focus');
});

// The hub can't post an owner action. Its Overview asks the project's dashboard, in its frame, and
// that page posts to itself: only for its parent, only when that parent is another origin (the hub,
// by frame-ancestors), never in the viewer, never opened on its own.
test('the Overview in Chrome: Park by keyboard on a card, the machine switch\'s Park and Run through each dashboard; nothing but the hub above a dashboard is heard', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 240000 }, async (t) => {
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
  const park = (name) => `${card(name)}.querySelector('.fleet-switch [data-fleet=park]')`;
  const mbtn = (m) => `document.querySelector('#ov-body > .ov-head .fleet-switch[data-scope=machine] [data-fleet=${m}]')`;
  await page('a card each', `document.querySelectorAll('.ov-card').length === 2 && document.querySelectorAll('.ov-card .fleet-switch').length === 2`);
  assert.equal(await p.ev(`document.querySelector('[role=tab][aria-selected=true]').textContent`), 'Overview', 'the page opens on the Overview');
  assert.equal(await p.ev(`location.hash`), '#overview');
  assert.equal(await p.ev(`document.querySelectorAll('iframe').length`), 0, 'no dashboard is loaded until one is opened or asked');

  // Park, by keyboard: two presses of the space bar on one button, across the redraw between them
  await p.ev(`${park('alpha')}.focus()`);
  await p.key(' ');
  await page('the press asking to be confirmed', `document.activeElement?.textContent === 'Confirm park'`);
  assert.equal(mode(A), 'run', 'one press parks nothing');
  await p.key(' ');
  await until(() => mode(A) === 'park', 'alpha parked');
  assert.equal(mode(B), 'run', 'and only alpha');
  // the card says so as soon as alpha's dashboard answers, not a hello later
  await page('the card showing Park pressed', `${card('alpha')}.querySelector('.fleet-switch [data-fleet=park][aria-pressed=true]') !== null && ${card('alpha')}.querySelector('.card-head .pill:not(.shrink)').textContent === 'Parked'`);
  await page('the frame made to ask, gone again', `document.querySelectorAll('iframe').length === 0`);
  const held = spawnSync(process.execPath, [path.join(A, 'docs/devteam/scripts/devteam.mjs'), 'fleet', 'status'], { cwd: A, env, encoding: 'utf8' }).stdout;
  assert.match(held, /parked from the hub's Overview/, 'the reason says where it came from');

  // every project at once, by the machine switch, and back
  await page('the machine switch offering Park', `${mbtn('park')}?.disabled === false`);
  await p.ev(`${mbtn('park')}.click()`);
  await page('the machine asking first', `${mbtn('park')}.textContent === 'Park 1 project?'`);
  assert.equal(mode(B), 'run', 'the machine switch asks first');
  await p.ev(`${mbtn('park')}.click()`);
  await until(() => mode(B) === 'park', 'beta parked');
  await page('the machine switch offering Run', `${mbtn('run')}?.disabled === false && ${mbtn('park')}.getAttribute('aria-pressed') === 'true'`);
  await p.ev(`${mbtn('run')}.click()`);
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
