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
  const full = (title, priority, check = 'echo 5') => ['goal', 'add', '--title', title, '--outcome', `${title} holds`, '--measure', 'self-serve share', '--target', '80', '--unit', '%', '--direction', 'up', '--source', 'prod', '--check', check, '--horizon', '2027-03-31', '--non-goals', 'enterprise invoicing', '--preconditions', 'cards work', 'prices defined', '--priority', String(priority)];
  const ms = JSON.stringify([{ title: 'Most admins pay alone', target: 80, preconditions: [1, 2], tickets: 2 }]);
  const ids = {};
  ids.g0 = mk(['goal', 'add', '--title', 'Faster onboarding', '--outcome', 'new admins set up alone']);
  ids.g1 = mk(full('Admins pay alone', 1));
  ids.g2 = mk(full('Receipts for every payment', 2));
  ids.g3 = mk(full('Invoices in one click', 3, `cat ${reading}`));
  ids.g6 = mk(full('Refunds without support', 4));
  ids.g4 = mk(full('Cards on file', 5));
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
  const { p, soon, port, go, reload } = await openOn(later, root, env, { init: { data: DATA_PATCH(), hello: { pulse: pulseFixture() } } });
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
  for (const k of ['g0', 'g3', 'g6', 'upkeep']) assert.ok(!(await cls(k)).some((c) => c.startsWith('blk-')), `${k} not blocked`);
  // today's head: priority first, then the impact's words
  assert.equal(await p.ev(`${card('g1')}.querySelector('.card-head .grow').textContent.trim()`), 'priority 1 · moves a number the project watches');
  assert.equal(await p.ev(`${card('g2')}.querySelector('.card-head .grow').textContent.trim()`), 'priority 2');
  // each goal card: step bar, next line, its design; Mark met only on g3
  for (const k of ['g0', 'g1', 'g2', 'g3', 'g6']) assert.ok(await p.ev(`!!${card(k)}.querySelector('ol.steps')`), `${k} has a step bar`);
  for (const k of ['g0', 'g3', 'g6']) assert.ok(await p.ev(`!!${card(k)}.querySelector('.goal-next')`), `${k} has a next line`);
  for (const k of ['g1', 'g2', 'g3', 'g6']) assert.ok(await p.ev(`[...${card(k)}.querySelectorAll('a')].some((a) => a.textContent.trim() === 'Read the design')`), `${k} links its design`);
  assert.deepEqual(await p.ev(`[...document.querySelectorAll('#goals [data-met-id]')].map((b) => b.dataset.metId)`), [ids.g3], 'Mark met only on the goal at its target');
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
});

test('the shell blocks are untouched', () => {
  const HUB = fs.readFileSync(path.join(here, '..', 'docs', 'devteam', 'dashboard', 'hub.html'), 'utf8');
  for (const name of ['devteam-layout', 'devteam-shell-js']) assert.equal(block(INDEX, name), block(HUB, name), `${name} is byte-identical in index.html and hub.html`);
});
