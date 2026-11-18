// The dashboard's Board and Progress (kit-91): the board-filter block (needsAttention, boardKeep and
// progressShown), run alone in vm; then the pages in real headless Chrome over a real dashboard on a
// bare project whose /api/data is patched in the page with boardFixture() (skipped where Chrome can't
// run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { PORTS, bareProject, boardFixture, dashboardOnFreePort, dataPatchInit } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX = fs.readFileSync(path.join(here, '..', 'docs', 'devteam', 'dashboard', 'index.html'), 'utf8');
const block = (src, name) => {
  const a = src.indexOf(`/* ${name} start */`), b = src.indexOf(`/* ${name} end */`);
  assert.ok(a >= 0 && b > a, `the ${name} block is in the page`);
  assert.equal(src.indexOf(`/* ${name} start */`, a + 1), -1, `one ${name} block`);
  return src.slice(a, b + `/* ${name} end */`.length);
};

test('board-filter: needsAttention, boardKeep and progressShown', () => {
  // the block alone, with no page globals
  const ctx = vm.createContext({});
  vm.runInContext(`${block(INDEX, 'board-filter')}\nthis.needsAttention = needsAttention; this.boardKeep = boardKeep; this.progressShown = progressShown;`, ctx);
  const { needsAttention, boardKeep, progressShown } = ctx;

  // tickets: g1 holds features fa and fb, g2 holds fc; one ticket of each kind of trouble
  const T = (o) => ({ kind: 'build', id: 'x', feature: 'fa', repo: 'home', stage: 'building', phase: 'build', waiting: null, held: null, held_by: null, ...o });
  const plain = T({ id: 'plain' });
  const blocked = T({ id: 'blocked', phase: 'blocked' });
  const waiting = T({ id: 'waiting', feature: 'fb', waiting: { kind: 'limit' } });
  const heldBy = T({ id: 'held-by', feature: 'fc', repo: 'devteam-kit', held_by: 'q-1' });
  const kitPlain = T({ id: 'kit-plain', feature: 'fb', repo: 'devteam-kit' });
  const noGoal = T({ id: 'no-goal', feature: 'fz' });
  const bare = { id: 'bare', kind: 'chore', feature: 'fa', repo: 'home', stage: 'ready', phase: 'build' }; // a chore: a ticket all the same

  // needsAttention: a ticket blocked, waiting at a pane or held by a question; none for a plain building one
  assert.equal(needsAttention(blocked), true, 'phase blocked');
  assert.equal(needsAttention(waiting), true, 'waiting');
  assert.equal(needsAttention(T({ waiting: { kind: 'prompt' } })), true, 'waiting at a prompt');
  assert.equal(needsAttention(heldBy), true, 'held_by');
  assert.equal(needsAttention(T({ phase: 'blocked', held_by: 'q-2' })), true, 'blocked and held_by');
  assert.equal(needsAttention(plain), false, 'a plain building ticket');
  assert.equal(needsAttention(bare), false, 'a chore, plain');
  assert.equal(needsAttention({ ...bare, phase: 'blocked' }), true, 'a chore, blocked');
  assert.equal(needsAttention(T({ held: { reason: 'later' } })), false, 'held with no question is not attention');
  assert.equal(needsAttention(T({ window: false })), false, 'a ticket has no window to lose');

  // planners: waiting at a pane, no window, held by a question; none for a fine one
  const P = (o) => ({ feature: 'fa', goals: ['g1'], window: true, waiting: null, held_by: null, ...o });
  const finePlanner = P({});
  assert.equal(needsAttention(P({ waiting: { kind: 'limit' } })), true, 'planner waiting');
  assert.equal(needsAttention(P({ window: false })), true, 'planner with no window');
  assert.equal(needsAttention(P({ held_by: 'q-3' })), true, 'planner held_by');
  assert.equal(needsAttention(finePlanner), false, 'a fine planner');
  assert.equal(needsAttention(P({ phase: 'blocked' })), false, 'a planner has no phase');
  assert.equal(needsAttention(P({ window: undefined })), false, 'a window not known is not gone');

  const g1 = new Set(['fa', 'fb']), g2 = new Set(['fc']);
  const all = [plain, blocked, waiting, heldBy, kitPlain, noGoal, bare];
  const kept = (f, ctx = { goalFeatures: null }) => all.filter((x) => boardKeep(x, f, ctx)).map((x) => x.id);

  // no filter: every ticket
  assert.deepEqual(kept({}), all.map((x) => x.id));
  // each filter alone
  assert.deepEqual(kept({ goal: 'g1' }, { goalFeatures: g1 }), ['plain', 'blocked', 'waiting', 'kit-plain', 'bare'], 'a goal\'s features');
  assert.deepEqual(kept({ goal: 'g2' }, { goalFeatures: g2 }), ['held-by'], 'the other goal\'s features');
  assert.deepEqual(kept({ goal: 'g-gone' }, { goalFeatures: null }), all.map((x) => x.id), 'an unknown goal (null) filters nothing');
  assert.deepEqual(kept({ feat: 'fb' }), ['waiting', 'kit-plain'], 'a feature');
  assert.deepEqual(kept({ repo: 'devteam-kit' }), ['held-by', 'kit-plain'], 'a repo');
  assert.deepEqual(kept({ repo: 'home' }), ['plain', 'blocked', 'waiting', 'no-goal', 'bare'], 'home');
  assert.deepEqual(kept({ att: '1' }), ['blocked', 'waiting', 'held-by'], 'needs attention');
  // combined
  assert.deepEqual(kept({ goal: 'g1', feat: 'fb' }, { goalFeatures: g1 }), ['waiting', 'kit-plain'], 'goal and feature');
  assert.deepEqual(kept({ goal: 'g1', repo: 'devteam-kit' }, { goalFeatures: g1 }), ['kit-plain'], 'goal and repo');
  assert.deepEqual(kept({ goal: 'g1', att: '1' }, { goalFeatures: g1 }), ['blocked', 'waiting'], 'goal and attention');
  assert.deepEqual(kept({ goal: 'g1', feat: 'fb', repo: 'home', att: '1' }, { goalFeatures: g1 }), ['waiting'], 'all four');
  assert.deepEqual(kept({ goal: 'g1', feat: 'fb', repo: 'devteam-kit', att: '1' }, { goalFeatures: g1 }), [], 'all four, nothing left');
  assert.deepEqual(kept({ goal: 'g1', feat: 'fc' }, { goalFeatures: g1 }), [], 'a feature outside the goal filters to nothing');
  assert.deepEqual(kept({ feat: '', repo: '', att: undefined }), all.map((x) => x.id), 'empty values are no filter');

  // planners: kept by their goals, their feature, home's repo and attention
  const withGoal = P({ feature: 'fa', goals: ['g1'] });
  const otherGoal = P({ feature: 'fc', goals: ['g2'] });
  const twoGoals = P({ feature: 'fb', goals: ['g1', 'g2'], waiting: { kind: 'prompt' } });
  const noGoals = P({ feature: 'fz', goals: [] });
  const ps = { withGoal, otherGoal, twoGoals, noGoals };
  const keptP = (f, ctx = { goalFeatures: null }) => Object.entries(ps).filter(([, x]) => boardKeep(x, f, ctx)).map(([k]) => k);
  assert.deepEqual(keptP({}), ['withGoal', 'otherGoal', 'twoGoals', 'noGoals'], 'no filter: every planner');
  assert.deepEqual(keptP({ goal: 'g1' }, { goalFeatures: g1 }), ['withGoal', 'twoGoals'], 'a planner with the goal, not one without');
  assert.deepEqual(keptP({ goal: 'g2' }, { goalFeatures: g2 }), ['otherGoal', 'twoGoals'], 'the other goal');
  assert.deepEqual(keptP({ goal: 'g-gone' }, { goalFeatures: null }), ['withGoal', 'otherGoal', 'twoGoals', 'noGoals'], 'an unknown goal filters no planner');
  assert.deepEqual(keptP({ feat: 'fb' }), ['twoGoals'], 'a planner by its feature');
  assert.deepEqual(keptP({ repo: 'devteam-kit' }), [], 'a non-home repo hides every planner');
  assert.deepEqual(keptP({ repo: 'home' }), ['withGoal', 'otherGoal', 'twoGoals', 'noGoals'], 'home shows them');
  assert.deepEqual(keptP({ att: '1' }), ['twoGoals'], 'a planner needing attention');
  assert.deepEqual(keptP({ goal: 'g1', repo: 'home', att: '1' }, { goalFeatures: g1 }), ['twoGoals'], 'combined');
  assert.deepEqual(keptP({}, { goalFeatures: g1 }), ['withGoal', 'otherGoal', 'twoGoals', 'noGoals'], 'goal features with no goal picked filter no planner');
  assert.deepEqual(kept({}, { goalFeatures: g1 }), all.map((x) => x.id), 'nor any ticket');

  // the rows as /api/data serves them (boardFixture: tickets with their own kind, planners with none)
  const { patch, ids } = boardFixture();
  const rows = new Map(patch.tickets.map((t) => [t.id, t]));
  for (const id of [ids.tBlockedQ, ids.tBlockedNoQ, ids.tLimit, ids.tPrompt]) assert.equal(needsAttention(rows.get(id)), true, `served ticket ${id} needs attention`);
  for (const id of [ids.tPlain, ids.tBuilding, ids.tHighRisk, ids.tHeld]) assert.equal(needsAttention(rows.get(id)), false, `served ticket ${id} doesn't`);
  const plans = new Map(patch.planners.map((p) => [p.feature, p]));
  for (const id of [ids.planLimit, ids.planPromptQ, ids.planNoWindow, ids.planAnswers]) assert.equal(needsAttention(plans.get(id)), true, `served planner ${id} needs attention`);
  assert.equal(needsAttention({ ...plans.get(ids.planLimit), waiting: null }), false, 'a served planner, fine');
  assert.ok(patch.planners.every((p) => boardKeep(p, { repo: 'home' }, { goalFeatures: null })), 'served planners are home\'s');
  assert.deepEqual(patch.tickets.filter((t) => boardKeep(t, { att: '1' }, { goalFeatures: null })).map((t) => t.id).sort(), [ids.tBlockedQ, ids.tBlockedNoQ, ids.tLimit, ids.tPrompt].sort(), 'Needs attention on served rows');
  assert.deepEqual(keptP({ goal: 'g2', feat: 'fa' }, { goalFeatures: g2 }), [], 'goal and a feature of another goal');
  // a planner row is told by its goals list and no stage (the server always sends both shapes so): a row with a
  // stage is a ticket whatever else it has
  assert.equal(needsAttention({ ...P({ window: false }), stage: 'ready' }), false, 'a row with a stage is a ticket: no window means nothing');

  // progressShown: Active (the default) the rows not done, Complete the done, Everything both
  for (const show of [undefined, '', 'active', 'nonsense']) {
    assert.equal(progressShown(false, show), true, `${show}: not done shown`);
    assert.equal(progressShown(true, show), false, `${show}: done hidden`);
  }
  assert.equal(progressShown(true, 'complete'), true, 'complete: done shown');
  assert.equal(progressShown(false, 'complete'), false, 'complete: not done hidden');
  assert.equal(progressShown(true, 'all'), true, 'all: done shown');
  assert.equal(progressShown(false, 'all'), true, 'all: not done shown');
});

// ---- in Chrome ----

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

// A bare project (no goals, no tickets: every Board and Progress record comes from the patch), its
// env with its own HOME and every DEVTEAM_* but the ports unset.
function boardProject(base, name = 'board-progress') {
  const root = bareProject(base, name);
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 48), DEVTEAM_PORT_BASE: String(PORTS + 49), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of Object.keys(env)) if (k.startsWith('DEVTEAM_') && !['DEVTEAM_HUB_PORT', 'DEVTEAM_PORT_BASE'].includes(k)) delete env[k];
  for (const k of ['TMUX', 'TMUX_PANE']) delete env[k];
  return { root, env };
}

// The dashboard on the project, Chrome on it with init (a script run before the page's own), at a
// size: { p, soon, port, go }. later is the test's cleanup(t), so all of it is stopped before the
// project is removed.
async function openOn(later, root, env, { width = 1440, height = 900, init } = {}) {
  const { dash, port } = await dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  if (init) await p.send('Page.addScriptToEvaluateOnNewDocument', { source: init });
  const soon = soonIn(p, 20000, () => dash.out());
  const loaded = "!document.querySelector('main.waiting') && typeof DATA !== 'undefined' && !!DATA";
  // a fresh document at a head (from about:blank, so a head that differs only in its hash loads anew)
  const go = async (hash) => {
    await p.send('Page.navigate', { url: 'about:blank' });
    await soon("location.href === 'about:blank'", 'about:blank');
    await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/${hash}` });
    await soon(loaded, 'the page with its data');
  };
  return { p, soon, port, go };
}

const CHROME = { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' };

test('boardFixture: patched into /api/data by dataPatchInit, every page draws it', { ...CHROME, timeout: 300000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-board-progress-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const { root, env } = boardProject(base);
  const { patch, ids } = boardFixture();
  // the fixture holds what the later tests lean on
  const cols = new Set(patch.progress.tickets.map((x) => x.stage));
  for (const st of ['planned', 'ready', "spec'd", 'building', 'in-review', 'merged', 'released']) assert.ok(cols.has(st), `a ticket at ${st}`);
  assert.deepEqual([...new Set(patch.tickets.map((x) => x.repo))].sort(), ['devteam-kit', 'home']);
  assert.deepEqual(patch.tickets.map((x) => x.id), patch.progress.tickets.map((x) => x.id), 'the two ticket lists name the same tickets');
  assert.equal(patch.planners.length, 4);
  assert.deepEqual(patch.ooda.roadmap.unassigned, [ids.featNoGoal]);
  const { p, soon, port, go } = await openOn(later, root, env, { init: dataPatchInit(patch) });
  // the server's own data has none of it
  const served = await (await fetch(`http://127.0.0.1:${port}/api/data`)).json();
  assert.equal(served.planners.length, 0);
  assert.equal(served.progress.tickets.length, 0);
  for (const page of ['#overview', '#goals', '#board', '#progress']) {
    await go(page);
    await soon(`DATA.planners.length === 4 && DATA.progress.tickets.length === ${patch.progress.tickets.length}`, `${page}: the patched data reached the page`);
    const got = await p.ev(`({ goals: DATA.ooda.goals.map((g) => g.id), unassigned: DATA.ooda.roadmap.unassigned, rate: DATA.ooda.roadmap.rate_points_per_day, keptNote: typeof DATA.ooda.roadmap.note, keptRetro: 'retro' in DATA.ooda, tickets: DATA.tickets.length, questions: DATA.questions.map((q) => q.id), crit: DATA.critical_path })`);
    assert.deepEqual(got, {
      goals: [ids.goal1, ids.goal2], unassigned: [ids.featNoGoal], rate: 1.4, keptNote: 'string', keptRetro: true,
      tickets: patch.tickets.length, questions: patch.questions.map((q) => q.id), crit: patch.critical_path,
    }, `${page}: ooda and its roadmap merged one level, the rest replaced`);
    // a poll or two more, then no error on the page
    await p.ev('new Promise((r) => setTimeout(r, 800))');
    assert.deepEqual(await p.ev('window.__errors'), [], `${page}: no error`);
  }
  // the Board drew a card for every ticket the fixture holds (Merged and Released show up to five)
  await go('#board');
  await soon(`document.querySelectorAll('#board-cols .tcard').length === ${patch.progress.tickets.length}`, 'a card for each ticket');
  assert.equal(await p.ev("document.querySelectorAll('#planners .plcard').length"), 4, 'four planners');
  assert.deepEqual(await p.ev('window.__errors'), []);
  // the Inbox draws a card for each open question the fixture holds
  await go(`#q/${encodeURIComponent(ids.qTicket)}`);
  await soon(`!!document.getElementById(${JSON.stringify(`q-${ids.qTicket}`)})`, "the Inbox card of the ticket's question");
  const cards = patch.questions.map((q) => q.id);
  await soon(`${JSON.stringify(cards)}.every((id) => document.querySelector('[data-qcard="' + id + '"]'))`, 'a card for each question');
  assert.deepEqual(await p.ev('window.__errors'), [], 'the Inbox: no error');
});
