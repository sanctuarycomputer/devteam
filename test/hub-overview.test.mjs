// The hub's Overview reads each project's hello: its pulse says whether the project is moving, how
// far along it is, what needs the owner, and what the fleet did each day for twelve weeks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { PORTS, bareProject, fleetFixture, json, line, startDashboard, until } from './lib/kit.mjs';
import { canDrive, openChrome } from './lib/chrome.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };

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
    assert.ok(p.activity.at(-1) >= 3, 'what the supervisor just wrote counts as today\'s activity');
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

// The hub can't post an owner action. Its Overview asks the project's dashboard, in its frame, and
// that page posts to itself: only for its parent, only when that parent is another origin (the hub,
// by frame-ancestors), never in the viewer, never opened on its own.
test('the Overview in Chrome: Park by keyboard, Park all and Resume all through each dashboard; nothing but the hub above a dashboard is heard', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 240000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-hub-ov-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const HUB = PORTS + 60;
  const P = PORTS + 61;
  const env = { ...process.env, DEVTEAM_HUB_PORT: String(HUB), DEVTEAM_PORT_BASE: String(P), DEVTEAM_HUB_RETRY_MS: '500', CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'TMUX', 'TMUX_PANE']) delete env[k];
  const A = bareProject(base, 'alpha');
  const B = bareProject(base, 'beta');
  for (const r of [A, B]) execFileSync('sh', ['-c', 'git add -A && git -c user.email=t@t -c user.name=t commit -qm init'], { cwd: r });
  // the fleet's mode as the project itself says it now (the hub's list is up to 10 s behind)
  const mode = (root) => { const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), 'hello', '--json', '--no-kit'], { cwd: root, env, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return json(r.stdout).fleet.mode; };
  const a = startDashboard(A, env);
  t.after(() => a.stop());
  await until(() => a.out().includes(`127.0.0.1:${P}`), "alpha's dashboard");
  const b = startDashboard(B, env);
  t.after(() => b.stop());
  await until(async () => { try { const l = (await (await fetch(`http://127.0.0.1:${HUB}/instances.json`)).json()).instances; return l.length === 2 && l.every((x) => x.pulse); } catch { return false; } }, 'both projects listed with a pulse');
  const chrome = await openChrome();
  t.after(() => chrome.close());
  const p = await chrome.newPage();
  t.after(() => p.close());
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
  t.after(() => other.close());
  const q = await chrome.newPage();
  t.after(() => q.close());
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
