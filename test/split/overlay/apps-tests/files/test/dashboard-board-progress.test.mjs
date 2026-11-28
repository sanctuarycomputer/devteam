// The dashboard's Board and Progress (kit-91): the board-filter block (needsAttention, boardKeep and
// progressShown), run alone in vm; then the pages in real headless Chrome over a real dashboard on a
// bare project whose /api/data is patched in the page with boardFixture() (skipped where Chrome can't
// run).
//
// Ported to the apps (kit-993): "the page" is now apps/dashboard. The board-filter block runs as the
// apps/dashboard/lib-dist/lib/board-filter.js module (src/lib/board-filter.ts), imported in place of slicing
// index.html; burnup()'s text is read from the port's source, apps/dashboard/src/views/board/burnup.ts, in place of
// the page's burnup.toString(). Every other case drives the page in Chrome as before.
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PORTS, bareProject, boardFixture, dashboardOnFreePort, dataPatchInit } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(here, '..', 'apps', 'dashboard');
const FILTER = path.join(APP, 'lib-dist', 'lib', 'board-filter.js');
// with no lib-dist/ build, the module's case skips locally; under CI the file fails
const UNBUILT = fs.existsSync(FILTER) ? false : 'build apps/dashboard first (npm run build)';
if (UNBUILT && process.env.CI) throw new Error(UNBUILT);
const test = (name, o, fn) => { if (typeof o === 'function') { fn = o; o = {}; } return nodeTest(name, UNBUILT && !o.skip ? { ...o, skip: UNBUILT } : o, fn); };

test('board-filter: needsAttention, boardKeep and progressShown', async () => {
  // the block alone, with no page globals: its module, which imports nothing
  const { needsAttention, boardKeep, progressShown } = await import(pathToFileURL(FILTER).href);

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
  // and loaded (kit-784): until the load event, Chrome makes a script's hash change with no user gesture (every
  // p.ev here) replace the entry rather than add one, so a Back or a close after it would land off the page
  const loaded = "document.readyState === 'complete' && !document.querySelector('main.waiting') && typeof DATA !== 'undefined' && !!DATA";
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
  await go('#board?th=inbox');
  await soon(`!!document.getElementById(${JSON.stringify(`q-${ids.qTicket}`)})`, "the Inbox card of the ticket's question");
  const cards = patch.questions.map((q) => q.id);
  await soon(`${JSON.stringify(cards)}.every((id) => document.querySelector('[data-qcard="' + id + '"]'))`, 'a card for each question');
  assert.deepEqual(await p.ev('window.__errors'), [], 'the Inbox: no error');
});

// ---- kit-91 T3: the header filters and the remembered filters ----

// the page bar's filters: a control by its data-f, a pick (its change event, as the owner's choice makes),
// and what the Board and the page bar hold
const ctl = (f) => `document.querySelector('.pagebar .extra [data-f="${f}"]')`;
const pick = (p, f, v) => p.ev(`(() => { const s = ${ctl(f)}; s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
const CARDS = "document.querySelectorAll('#board [data-ticket]').length";
const PLANNERS = "document.querySelectorAll('#board [data-planner]').length";
const EXTRA = `[...document.querySelectorAll('.pagebar .extra select, .pagebar .extra button, .pagebar .extra input')].map((c) => ({ tag: c.tagName.toLowerCase(), f: c.dataset.f, label: c.getAttribute('aria-label'), pressed: c.getAttribute('aria-pressed') }))`;
const OPTIONS = (f) => `[...${ctl(f)}.options].map((o) => o.value)`;
// the hash, its query read back (so the test doesn't lean on how a value is escaped)
const HEAD = "(() => { const h = location.hash, i = h.indexOf('?'); return { page: h.slice(1, i < 0 ? h.length : i), q: Object.fromEntries(new URLSearchParams(i < 0 ? '' : h.slice(i + 1))) }; })()";
const BURNUP = "document.querySelector('#burnup svg')?.getAttribute('aria-label') || ''";
// an init (after dataPatchInit) that counts the page's /api/data reads and stretches its 10 s poll to an hour
const READS_INIT = `(() => {
  window.__dataReads = 0;
  const f = window.fetch;
  window.fetch = (u, o) => { if (String(u && u.url ? u.url : u).startsWith('/api/data')) window.__dataReads++; return f(u, o); };
  const si = window.setInterval;
  window.setInterval = (fn, ms, ...a) => si(fn, ms === 10000 ? 3600000 : ms, ...a);
})();`;

// the fixture's counts: goal2 (receipts) holds five tickets, one of them in no repo but devteam-kit's and
// needing attention (the prompt); goal1 (pay) six; a planner each for goal2 one, goal1 two
function boardStart(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-board-filters-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return { later, ...boardProject(base) };
}

test('header filters on the Board: Goal, Feature, Repo and Needs attention, each a history entry, remembered for a fresh visit', { ...CHROME, timeout: 300000 }, async (t) => {
  const { later, root, env } = boardStart(t);
  const { patch, ids } = boardFixture();
  const { p, soon, go } = await openOn(later, root, env, { init: dataPatchInit(patch) });
  await go('#board');
  await p.ev('localStorage.clear()');
  await go('#board');
  await soon(`${CARDS} === 12`, 'every card');
  assert.equal(await p.ev('location.hash'), '#board', 'nothing remembered: the head as loaded');
  assert.deepEqual(await p.ev(EXTRA), [
    { tag: 'select', f: 'goal', label: 'Goal', pressed: null },
    { tag: 'select', f: 'feat', label: 'Feature', pressed: null },
    { tag: 'select', f: 'repo', label: 'Repo', pressed: null },
    { tag: 'button', f: 'att', label: 'Needs attention', pressed: 'false' },
  ], 'the four controls, in order');
  assert.deepEqual(await p.ev(OPTIONS('goal')), ['', ids.goal1, ids.goal2], 'All goals, then each goal by title');
  assert.equal(await p.ev(`${ctl('goal')}.options[0].textContent`), 'All goals');
  assert.deepEqual(await p.ev(OPTIONS('repo')), ['', 'home', 'devteam-kit'], 'All repos, home first');
  assert.deepEqual(await p.ev(OPTIONS('feat')), ['', 'pay', 'receipts', 'no-goal-feat', 'receipts-export', 'onboarding', 'pay-wallet'], 'every ticket\'s and planner\'s feature with no goal');
  assert.equal(await p.ev(PLANNERS), 4);

  await pick(p, 'goal', ids.goal2);
  await soon(`location.hash === ${JSON.stringify(`#board?goal=${ids.goal2}`)}`, 'the goal in the hash');
  await soon(`${CARDS} === 5 && ${PLANNERS} === 1`, "goal2's five cards and its planner");
  assert.deepEqual(await p.ev(OPTIONS('feat')), ['', 'receipts', 'receipts-export'], "the goal's tickets' and planners' features");
  await pick(p, 'feat', 'receipts');
  await soon(`location.hash === ${JSON.stringify(`#board?goal=${ids.goal2}&feat=receipts`)}`, 'the feature in the hash');
  await soon(`${CARDS} === 5 && ${PLANNERS} === 0`, 'the feature: its tickets, no planner');
  await pick(p, 'repo', 'devteam-kit');
  await soon(`location.hash === ${JSON.stringify(`#board?goal=${ids.goal2}&feat=receipts&repo=devteam-kit`)}`, 'the repo in the hash');
  await soon(`${CARDS} === 2`, "the kit's two");
  await p.click('.pagebar .extra [data-f="att"]');
  await soon(`location.hash === ${JSON.stringify(`#board?goal=${ids.goal2}&feat=receipts&repo=devteam-kit&att=1`)}`, 'att=1 in the hash');
  await soon(`${CARDS} === 1 && document.querySelector('#board [data-ticket="${ids.tPrompt}"]')`, 'the one needing attention');
  assert.equal(await p.ev(`${ctl('att')}.getAttribute('aria-pressed')`), 'true');
  assert.deepEqual(await p.ev(`[${ctl('goal')}.value, ${ctl('feat')}.value, ${ctl('repo')}.value]`), [ids.goal2, 'receipts', 'devteam-kit'], 'the selects show the filters');

  // Back walks the filters
  await p.ev('history.back()');
  await soon(`location.hash === ${JSON.stringify(`#board?goal=${ids.goal2}&feat=receipts&repo=devteam-kit`)}`, 'back: no att');
  await soon(`${CARDS} === 2`, 'back: the previous cards');
  assert.equal(await p.ev(`${ctl('att')}.getAttribute('aria-pressed')`), 'false');
  await p.ev('history.back()');
  await soon(`location.hash === ${JSON.stringify(`#board?goal=${ids.goal2}&feat=receipts`)}`, 'back: no repo');
  await soon(`${CARDS} === 5`, 'back again: the cards before');

  // a fresh visit (a new document) on #board: the last filters saved, written into its hash
  await go('#board');
  await soon(`location.hash === ${JSON.stringify(`#board?goal=${ids.goal2}&feat=receipts&repo=devteam-kit&att=1`)}`, 'the remembered filters in the hash');
  await soon(`${CARDS} === 1`, 'and the cards they leave');
  assert.deepEqual(await p.ev('JSON.parse(localStorage.getItem("devteam.board.filters"))'), { goal: ids.goal2, feat: 'receipts', repo: 'devteam-kit', att: '1' });

  // a read that changes nothing leaves the controls as they are (a select replaced under a press loses the press)
  await p.ev(`window.__sel = ${ctl('goal')}`);
  await new Promise((r) => setTimeout(r, 1200)); // four reads at the init's 300 ms
  assert.equal(await p.ev(`window.__sel === ${ctl('goal')} && window.__sel.isConnected`), true, 'the Goal select is the same element after reads');

  // a goal change clears the feature (the old goal's); the repo and the toggle stay
  await pick(p, 'goal', ids.goal1);
  await soon(`location.hash === ${JSON.stringify(`#board?goal=${ids.goal1}&repo=devteam-kit&att=1`)}`, 'goal1: no feat');
  assert.equal(await p.ev(`${ctl('feat')}.value`), '', 'All features');

  // att=1 only: a hand-made att=0 is no filter
  await p.ev('localStorage.clear()');
  await go('#board?att=0');
  await soon(`${CARDS} === ${patch.tickets.length}`, 'att=0: every card');
  assert.equal(await p.ev(`${ctl('att')}.getAttribute('aria-pressed')`), 'false', 'the toggle off');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('header filters on Progress: Goal, Narrow and Show, Narrow within the goal, no control in the page', { ...CHROME, timeout: 300000 }, async (t) => {
  const { later, root, env } = boardStart(t);
  const { patch, ids } = boardFixture();
  const { p, soon, go } = await openOn(later, root, env, { init: dataPatchInit(patch) });
  await go('#progress');
  await p.ev('localStorage.clear()');
  await go('#progress');
  await soon(`!!${ctl('narrow')}`, 'the Narrow select');
  assert.deepEqual(await p.ev(EXTRA), [
    { tag: 'select', f: 'goal', label: 'Goal', pressed: null },
    { tag: 'select', f: 'narrow', label: 'Narrow', pressed: null },
    { tag: 'select', f: 'show', label: 'Show', pressed: null },
  ], 'Goal, Narrow and Show, and no other control');
  assert.equal(await p.ev("document.querySelectorAll('#progress select, #progress input, #progress .filters').length"), 0, 'no control inside #progress');
  assert.equal(await p.ev(`${ctl('narrow')}.options[0].textContent`), 'Every view');
  assert.deepEqual(await p.ev(`[...${ctl('narrow')}.querySelectorAll('optgroup')].map((g) => g.label)`), ['Milestones', 'Features', 'Releases', 'Waves', 'Stories']);
  // every view the fixture holds, as today's view keys (written out, not the page's own views())
  assert.deepEqual(await p.ev(OPTIONS('narrow')), [
    '', `milestone:${ids.goal1}:1`, `milestone:${ids.goal2}:1`,
    'feature:pay', 'feature:receipts', 'feature:no-goal-feat',
    'release:v0.1.0', 'release:v0.2.0', 'release:v0.3.0',
    'wave:1', 'wave:2',
    'story:PAY-S1', 'story:PAY-S2', 'story:RECEIPTS-S1', 'story:RECEIPTS-S2',
  ], 'Narrow with no goal');
  assert.deepEqual(await p.ev(`[...${ctl('show')}.options].map((o) => [o.value, o.textContent])`), [['', 'Active'], ['complete', 'Complete'], ['all', 'Everything']]);
  assert.equal(await p.ev(`${ctl('show')}.value`), '', 'Active selected');
  assert.equal((await p.ev(HEAD)).q.show, undefined, 'Active: no show key');
  assert.match(await p.ev(BURNUP), /of 16 points/, 'every ticket in the burn-up');

  await pick(p, 'goal', ids.goal1);
  await soon(`location.hash === ${JSON.stringify(`#progress?goal=${ids.goal1}`)}`, 'the goal in the hash');
  await soon(`${OPTIONS('narrow')}.length === 9`, "Narrow within goal1");
  assert.deepEqual(await p.ev(OPTIONS('narrow')), [
    '', `milestone:${ids.goal1}:1`, 'feature:pay', 'release:v0.1.0', 'release:v0.3.0', 'wave:1', 'wave:2', 'story:PAY-S1', 'story:PAY-S2',
  ], "goal1's views alone");
  await soon(`/3 of 8 points/.test(${BURNUP})`, "goal1's points in the burn-up");
  await pick(p, 'narrow', 'story:PAY-S1');
  await soon(`location.hash.includes('narrow=')`, 'narrow in the hash');
  assert.deepEqual(await p.ev(HEAD), { page: 'progress', q: { goal: ids.goal1, narrow: 'story:PAY-S1' } });
  await soon(`/3 of 3 points/.test(${BURNUP})`, 'the narrowed burn-up');
  await pick(p, 'show', 'complete');
  await soon(`location.hash.includes('show=complete')`, 'show=complete in the hash');
  assert.deepEqual(await p.ev(HEAD), { page: 'progress', q: { goal: ids.goal1, narrow: 'story:PAY-S1', show: 'complete' } });
  await pick(p, 'show', 'all');
  await soon(`location.hash.includes('show=all')`, 'show=all in the hash');
  // a goal change drops the narrow (a view of the old goal)
  await pick(p, 'goal', ids.goal2);
  await soon(`location.hash.includes(${JSON.stringify(`goal=${ids.goal2}`)})`, 'the new goal');
  assert.deepEqual(await p.ev(HEAD), { page: 'progress', q: { goal: ids.goal2, show: 'all' } }, 'narrow cleared, show kept');
  await pick(p, 'show', '');
  await soon(`!location.hash.includes('show=')`, 'Active: the key gone');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('the page bar holds no filter on Overview', { ...CHROME, timeout: 300000 }, async (t) => {
  const { later, root, env } = boardStart(t);
  const { patch } = boardFixture();
  const { p, soon, go } = await openOn(later, root, env, { init: dataPatchInit(patch) });
  await go('#board');
  await soon(`!!${ctl('goal')}`, 'the Board filters');
  await p.ev("location.hash = '#overview'");
  await soon("document.querySelector('.pagebar .extra').innerHTML === ''", 'emptied on Overview');
  await go('#overview');
  assert.equal(await p.ev("document.querySelector('.pagebar .extra').innerHTML"), '', 'empty on a load of Overview');
});

test('filter edge cases: an unknown goal shows All goals and every card; a Narrow outside the goal shows Every view', { ...CHROME, timeout: 300000 }, async (t) => {
  const { later, root, env } = boardStart(t);
  const { patch, ids } = boardFixture();
  const { p, soon, go } = await openOn(later, root, env, { init: dataPatchInit(patch) });
  await go('#board');
  await p.ev('localStorage.clear()');
  await go('#board?goal=g-20200101-000000009-supervisor');
  await soon(`!!${ctl('goal')}`, 'the Goal select');
  await soon(`${CARDS} === 12 && ${PLANNERS} === 4`, 'every card');
  assert.equal(await p.ev(`${ctl('goal')}.value`), '', 'All goals');
  await go(`#progress?goal=${ids.goal1}&narrow=${encodeURIComponent('feature:receipts')}`);
  await soon(`!!${ctl('narrow')}`, 'the Narrow select');
  assert.equal(await p.ev(`${ctl('narrow')}.value`), '', 'Every view');
  assert.equal(await p.ev(`${ctl('goal')}.value`), ids.goal1);
  await soon(`/3 of 8 points/.test(${BURNUP})`, "the goal's scope, not the view's");
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('remembered filters: Back restores, a nav click carries them in one entry, the goal is shared, Progress never carries Board keys', { ...CHROME, timeout: 300000 }, async (t) => {
  const { later, root, env } = boardStart(t);
  const { patch, ids } = boardFixture();
  const { p, soon, go } = await openOn(later, root, env, { init: dataPatchInit(patch) });
  await go('#overview');
  await p.ev('localStorage.clear()');
  await go('#board');
  await soon(`${CARDS} === 12`, 'every card');
  await pick(p, 'goal', ids.goal2);
  await soon(`${CARDS} === 5`, 'goal2');
  await pick(p, 'feat', 'receipts');
  await soon(`location.hash.includes('feat=receipts')`, 'the feature');
  await p.ev('history.back()');
  await soon(`location.hash === ${JSON.stringify(`#board?goal=${ids.goal2}`)}`, 'back: the goal alone');
  await soon(`${CARDS} === 5 && ${PLANNERS} === 1 && ${ctl('feat')}.value === ''`, 'back: its cards and controls');
  await pick(p, 'feat', 'receipts');
  await soon(`location.hash.includes('feat=receipts')`, 'the feature again');
  await p.click('.pagebar .extra [data-f="att"]');
  await soon(`location.hash.includes('att=1')`, 'att');

  // a nav click to the Board, from Overview: the remembered filters in the new entry's hash, no further entry
  await p.ev("location.hash = '#overview'");
  await soon("document.querySelector('.pagebar .extra').innerHTML === ''", 'Overview');
  const before = await p.ev('history.length');
  await p.click('.side a[href="#board"]');
  await soon(`location.hash === ${JSON.stringify(`#board?goal=${ids.goal2}&feat=receipts&att=1`)}`, 'the nav click lands on the remembered filters');
  await soon(`${CARDS} === 2`, 'and their cards');
  assert.equal(await p.ev('history.length'), before + 1, 'one entry: the click\'s, its hash replaced');
  assert.equal(await p.ev('history.state.page'), `#board?goal=${ids.goal2}&feat=receipts&att=1`, 'its stamp names the filtered head');

  // the goal picked on Board shows on Progress after a nav click; Progress remembers only the goal
  await p.click('.side a[href="#progress"]');
  await soon(`location.hash === ${JSON.stringify(`#progress?goal=${ids.goal2}`)}`, "Board's goal on Progress");
  // a goal picked on Progress shows on Board, the old goal's feature gone
  await pick(p, 'goal', ids.goal1);
  await soon(`location.hash === ${JSON.stringify(`#progress?goal=${ids.goal1}`)}`, 'goal1 on Progress');
  await p.click('.side a[href="#board"]');
  await soon(`location.hash.startsWith('#board?')`, 'the Board');
  const h = await p.ev(HEAD);
  assert.equal(h.q.goal, ids.goal1, "Progress's goal on the Board");
  assert.equal(h.q.feat, undefined, "the old goal's feature gone");
  assert.equal(h.q.att, '1', 'the Board\'s own remembered toggle kept');
  await soon(`${CARDS} === 2`, "the Board's cards aren't empty: goal1's two needing attention");

  // Progress's hash never has feat, repo or att: with nothing remembered, routed to #progress
  await p.ev('localStorage.clear()');
  await go('#progress?feat=x&repo=y&att=1');
  await soon("location.hash === '#progress'", 'the Board keys dropped from the hash');
  // nor a key of no page, on the Board either
  await go('#board?bogus=1');
  await soon("location.hash === '#board'", 'an unknown key dropped');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a filter change and Back redraw the cards at once, not at the next poll', { ...CHROME, timeout: 300000 }, async (t) => {
  const { later, root, env } = boardStart(t);
  const { patch, ids } = boardFixture();
  const { p, soon, go } = await openOn(later, root, env, { init: `${dataPatchInit(patch)}\n${READS_INIT}` });
  await go('#board');
  await p.ev('localStorage.clear()');
  await go('#board');
  await soon(`${CARDS} === 12`, 'every card');
  const reads = await p.ev('window.__dataReads');
  const quick = soonIn(p, 1500);
  await pick(p, 'goal', ids.goal1);
  await quick(`${CARDS} === 6 && ${PLANNERS} === 2`, "goal1's cards, at once");
  await p.ev('history.back()');
  await quick(`location.hash === '#board' && ${CARDS} === 12 && ${PLANNERS} === 4`, 'back: every card, at once');
  await p.ev('history.forward()');
  await quick(`${CARDS} === 6`, 'forward: goal1 again, at once');
  assert.equal(await p.ev('window.__dataReads'), reads, 'no read of /api/data in between');
});

test('a storage that throws: the URL alone carries the filters, nothing remembered, no error', { ...CHROME, timeout: 300000 }, async (t) => {
  const { later, root, env } = boardStart(t);
  const { patch, ids } = boardFixture();
  const { p, soon, go } = await openOn(later, root, env, { init: dataPatchInit(patch, { throwStorage: true }) });
  await go(`#board?goal=${ids.goal1}`);
  await soon(`!!${ctl('goal')}`, 'the Goal select');
  await soon(`${CARDS} === 6`, "goal1's cards");
  assert.equal(await p.ev(`${ctl('goal')}.value`), ids.goal1);
  await pick(p, 'goal', ids.goal2);
  await soon(`location.hash === ${JSON.stringify(`#board?goal=${ids.goal2}`)} && ${CARDS} === 5`, 'a change, from the URL alone');
  await go('#board');
  await soon(`!!${ctl('goal')}`, 'the Goal select');
  await soon(`${CARDS} === 12`, 'no filter');
  assert.equal(await p.ev('location.hash'), '#board');
  assert.equal(await p.ev(`${ctl('goal')}.value`), '');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

// ---- kit-91 T4: the Board on the shell ----

// a token's computed colour (a probe styled with it), to compare with a computed border colour
const TOKEN = (v) => `(() => { const e = document.createElement('i'); e.style.color = 'var(${v})'; document.body.append(e); const c = getComputedStyle(e).color; e.remove(); return c; })()`;
// each card's pills, by its id (ticket cards in a root; planner cards by feature)
const PILLS = (root) => `Object.fromEntries([...document.querySelectorAll(${JSON.stringify(`${root} .tcard[data-ticket]`)})].map((c) => [c.dataset.ticket, [...c.querySelectorAll('.pills .pill')].map((x) => x.textContent.trim())]))`;
const PL_PILLS = "Object.fromEntries([...document.querySelectorAll('#planners .plcard')].map((c) => [c.dataset.planner, [...c.querySelectorAll('.pills .pill')].map((x) => x.textContent.trim())]))";
// the fixture's cards, written out: critical path first, the phase with its task, then usage limit, stuck on
// a prompt, held, high risk, then the component; no Blocked pill
function expectedPills(ids) {
  return {
    [ids.tReleased]: ['pay'], [ids.tMerged]: ['pay'], [ids.tMergedReceipts]: ['receipts'], [ids.tMergedKit]: ['kit'],
    [ids.tBuilding]: ['building, task 3', 'pay'],
    [ids.tLimit]: ['building', 'usage limit', 'pay'],
    [ids.tHighRisk]: ['final review', 'high risk', 'receipts'],
    [ids.tPrompt]: ['building', 'stuck on a prompt', 'kit'],
    [ids.tBlockedQ]: ['pay'],
    [ids.tBlockedNoQ]: ['critical path', 'receipts'],
    [ids.tPlain]: ['kit'],
    [ids.tHeld]: ['critical path', 'held', 'pay'],
  };
}

test('the Board on the shell: planners strip, columns, card heads and pills, held items with their question', { ...CHROME, timeout: 600000 }, async (t) => {
  const { later, root, env } = boardStart(t);
  const { patch, ids } = boardFixture();
  const { p, soon, go } = await openOn(later, root, env, { init: `${dataPatchInit(patch)}\n${READS_INIT}` });
  const J = JSON.stringify;
  const board = async () => {
    await go('#overview');
    await p.ev('localStorage.clear()');
    await go('#board');
    await soon(`${CARDS} === 12 && ${PLANNERS} === 4`, 'every card and planner');
  };
  // plan Task 2: history.length once it has held still for 300ms
  const heldLength = async () => {
    let v = await p.ev('history.length'), since = Date.now();
    while (Date.now() - since < 300) {
      await new Promise((r) => setTimeout(r, 50));
      const n = await p.ev('history.length');
      if (n !== v) { v = n; since = Date.now(); }
    }
    return v;
  };
  const size = (width, height) => p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const qText = (id) => patch.questions.find((q) => q.id === id).question;

  await t.test('the page is on the shell: no .no-shell, h2, sub-line or scope line', async () => {
    await board();
    assert.deepEqual(await p.ev(`(() => { const s = document.getElementById('board'); return { fenced: !!s.closest('.no-shell'), h2: s.querySelectorAll('h2, .sub, #board-scope').length }; })()`), { fenced: false, h2: 0 });
  });

  await t.test('the planners strip: four across at 1440 in a dashed outline, above the columns; two and one when narrower', async () => {
    await board();
    const m = await p.ev(`(() => { const s = document.querySelector('#board .planners'); if (!s) return null; const cs = [...s.querySelectorAll('.plcard')];
      return { id: s.id, n: cs.length, tops: [...new Set(cs.map((c) => Math.round(c.getBoundingClientRect().top)))].length, dashed: cs.map((c) => getComputedStyle(c).borderTopStyle),
        above: s.getBoundingClientRect().bottom <= document.getElementById('board-cols').getBoundingClientRect().top }; })()`);
    assert.deepEqual(m, { id: 'planners', n: 4, tops: 1, dashed: ['dashed', 'dashed', 'dashed', 'dashed'], above: true }, 'the strip at 1440');
    const across = "(() => { const cs = [...document.querySelectorAll('#board .planners .plcard')]; const top = Math.round(cs[0].getBoundingClientRect().top); return cs.filter((c) => Math.round(c.getBoundingClientRect().top) === top).length; })()";
    try {
      await size(1000, 800);
      await soon(`${across} === 2`, 'two across below 1100px');
      await size(500, 800);
      await soon(`${across} === 1`, 'one across below 560px');
    } finally { await size(1440, 900); }
    await soon(`${across} === 4`, 'four again at 1440');
  });

  await t.test('seven columns, Backlog … Released, each at least 180px; each head rule --line, edge to edge', async () => {
    await board();
    const cols = await p.ev(`[...document.querySelectorAll('#board-cols > .col')].map((c) => { const h = c.querySelector('h3'), r = c.getBoundingClientRect(), hr = h.getBoundingClientRect(), s = getComputedStyle(h);
      return { name: h.querySelector('span').textContent, w: r.width, left: Math.abs(hr.left - r.left) <= 1, right: Math.abs(hr.right - r.right) <= 1, rule: s.borderBottomStyle + ' ' + s.borderBottomWidth, color: s.borderBottomColor }; })`);
    assert.deepEqual(cols.map((c) => c.name), ['Backlog', 'Ready', 'Planning', 'Building', 'Review', 'Merged', 'Released']);
    const line = await p.ev(TOKEN('--line'));
    for (const c of cols) {
      assert.ok(c.w >= 180, `${c.name}: ${c.w}px wide`);
      assert.deepEqual([c.left, c.right, c.rule, c.color], [true, true, 'solid 1px', line], `${c.name}: its head's rule`);
    }
  });

  await t.test('a ticket card: a head with the id in mono and its ⋯ menu, no size; the pills in order and words', async () => {
    await board();
    const heads = await p.ev(`[...document.querySelectorAll('#board-cols .tcard[data-ticket]')].map((c) => { const h = c.querySelector(':scope > .tc-head'), b = h?.querySelector('b');
      return { id: c.dataset.ticket, text: b?.textContent, mono: !!b && /Mono|monospace/.test(getComputedStyle(b).fontFamily),
        menu: !!h?.querySelector('details.menu'), rule: h ? getComputedStyle(h).borderBottomColor : null, first: c.firstElementChild === h,
        size: [...c.querySelectorAll('*')].some((e) => !e.children.length && /^(S|M)$|· (S|M)$/.test(e.textContent.trim())), flag: !!c.querySelector('.icon-flag') }; })`);
    const line = await p.ev(TOKEN('--line'));
    assert.equal(heads.length, 12);
    for (const h of heads) assert.deepEqual(h, { id: h.id, text: h.id, mono: true, menu: true, rule: line, first: true, size: false, flag: false }, `${h.id}: its head`);
    assert.deepEqual(await p.ev(PILLS('#board-cols')), expectedPills(ids), 'every card\'s pills, whole');
    const cp = await p.ev(`(() => { const x = document.querySelector('#board-cols [data-ticket="${ids.tHeld}"] .pill.cp'); return x && { cls: [...x.classList].sort(), icon: !!x.querySelector('i.icon-route'), title: x.title, dot: getComputedStyle(x, '::before').content }; })()`);
    assert.deepEqual(cp, { cls: ['badge', 'cp', 'high', 'pill'], icon: true, title: 'On the critical path: it delays the goal', dot: 'none' }, 'the critical-path pill');
    assert.equal(await p.ev("[...document.querySelectorAll('#board-cols .tcard .pill')].filter((x) => /^blocked$/i.test(x.textContent.trim())).length"), 0, 'no Blocked pill');
  });

  await t.test('needs attention: the red outline, the question link or "no question yet", never "blocked"', async () => {
    await board();
    const red = await p.ev(TOKEN('--red'));
    const cards = await p.ev(`[...document.querySelectorAll('#board-cols .tcard[data-ticket]')].map((c) => ({ id: c.dataset.ticket, blocked: c.classList.contains('blocked'), color: getComputedStyle(c).borderTopColor,
      att: c.querySelector(':scope > .att')?.textContent.trim() ?? null, href: c.querySelector(':scope > .att a.att-q')?.getAttribute('href') ?? null, inbox: !!c.querySelector('.att-q i.icon-inbox') }))`);
    const need = [ids.tBlockedQ, ids.tBlockedNoQ, ids.tLimit, ids.tPrompt];
    assert.deepEqual(cards.filter((c) => c.blocked).map((c) => c.id).sort(), [...need].sort(), 'every card needing attention has .blocked, and none other');
    for (const c of cards) assert.equal(c.color === red, c.blocked, `${c.id}: its border ${c.color} is --red only when it needs attention`);
    const by = Object.fromEntries(cards.map((c) => [c.id, c]));
    assert.deepEqual([by[ids.tBlockedQ].att, by[ids.tBlockedQ].href, by[ids.tBlockedQ].inbox], [qText(ids.qTicket), `#q/${ids.qTicket}`, true], 'the held card links its question');
    for (const id of [ids.tBlockedNoQ, ids.tLimit, ids.tPrompt]) assert.deepEqual([by[id].att, by[id].href], ['no question yet', null], `${id}: no question yet`);
    for (const c of cards) if (!need.includes(c.id)) assert.equal(c.att, null, `${c.id}: no attention row`);
    const pl = await p.ev(`[...document.querySelectorAll('#planners .plcard')].map((c) => ({ f: c.dataset.planner, blocked: c.classList.contains('blocked'), stuck: c.classList.contains('stuck'), att: c.querySelector(':scope > .att')?.textContent.trim() ?? null, href: c.querySelector('.att a.att-q')?.getAttribute('href') ?? null }))`);
    assert.deepEqual(pl, [
      { f: ids.planLimit, blocked: false, stuck: true, att: 'no question yet', href: null },
      { f: ids.planPromptQ, blocked: true, stuck: true, att: qText(ids.qPlanner), href: `#q/${ids.qPlanner}` },
      { f: ids.planNoWindow, blocked: false, stuck: true, att: 'no question yet', href: null },
      { f: ids.planAnswers, blocked: true, stuck: false, att: qText(ids.qAnswers[0]), href: `#q/${ids.qAnswers[0]}` },
    ], 'the planners: outline, attention row');
    assert.deepEqual(await p.ev(PL_PILLS), {
      [ids.planLimit]: ['usage limit'], [ids.planPromptQ]: ['waiting on a prompt', 'waiting for 1 answer from you'],
      [ids.planNoWindow]: ['window gone', 'waiting for the supervisor'], [ids.planAnswers]: ['waiting for 2 answers from you'],
    }, "the planners' pills");
    assert.equal(await p.ev("[...document.querySelectorAll('#board .att')].filter((x) => /blocked/i.test(x.textContent)).length"), 0, 'no .att says blocked');
    // a question no longer in DATA.questions (answered between reads): "a question", still its link
    const gone = await p.ev(`(() => { DATA.questions = DATA.questions.filter((q) => q.id !== ${J(ids.qTicket)}); renderBoard(); const a = document.querySelector('#board-cols [data-ticket="${ids.tBlockedQ}"] .att-q'); return a && [a.textContent.trim(), a.getAttribute('href')]; })()`);
    assert.deepEqual(gone, ['a question', `#q/${ids.qTicket}`], 'a missing question reads "a question"');
  });

  await t.test('a planner card is a flex column; its question row sits at the bottom beside a taller neighbour', async () => {
    await board();
    const m = await p.ev(`(() => { const cs = [...document.querySelectorAll('#planners .plcard')];
      cs.find((c) => c.dataset.planner === ${J(ids.planNoWindow)}).querySelector('.muted').textContent += ' and a long line '.repeat(12);
      return cs.map((c) => { const s = getComputedStyle(c), r = c.getBoundingClientRect(), a = c.querySelector(':scope > .att')?.getBoundingClientRect();
        const content = r.bottom - parseFloat(s.borderBottomWidth) - parseFloat(s.paddingBottom);
        return { f: c.dataset.planner, flex: s.display + ' ' + s.flexDirection, h: r.height, gap: a ? Math.abs(content - a.bottom) : null }; }); })()`);
    for (const c of m) assert.equal(c.flex, 'flex column', `${c.f}: a flex column`);
    const tall = m.find((c) => c.f === ids.planNoWindow).h;
    for (const c of m.filter((x) => x.f !== ids.planNoWindow)) {
      assert.ok(c.h >= tall - 1, `${c.f}: stretched to its taller neighbour (${c.h} vs ${tall})`);
      assert.ok(c.gap !== null && c.gap <= 1, `${c.f}: its attention row at the bottom (${c.gap}px off)`);
    }
  });

  await t.test("a held ticket's question link opens the question's peek, one history entry, no ticket peek", async () => {
    await board();
    const before = await heldLength();
    await p.click(`#board-cols [data-ticket="${ids.tBlockedQ}"] .att-q`);
    await soon(`DRAWER.kind === 'q' && DRAWER.id === ${J(ids.qTicket)} && !document.getElementById('drawer').hidden && !!document.querySelector(${J(`#drawer-body [id="p-q-${ids.qTicket}"]`)})`, "the question's peek with its card");
    await soon(`history.length === ${before + 1}`, 'one entry');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await p.ev('history.length'), before + 1, 'still one entry');
  });

  await t.test("a planner's question link opens the question's peek, one history entry, no planner peek", async () => {
    await board();
    const before = await heldLength();
    await p.click(`#planners [data-planner="${ids.planPromptQ}"] .att-q`);
    await soon(`DRAWER.kind === 'q' && DRAWER.id === ${J(ids.qPlanner)} && !document.getElementById('drawer').hidden && !!document.querySelector(${J(`#drawer-body [id="p-q-${ids.qPlanner}"]`)})`, "the question's peek with its card");
    await soon(`history.length === ${before + 1}`, 'one entry');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await p.ev('history.length'), before + 1, 'still one entry');
    assert.equal(await p.ev("location.hash.includes('planner/')"), false, 'no planner peek');
  });

  await t.test('the status pills keep their order when a card has several: usage limit, held, high risk, then the component', async () => {
    await board();
    // a card the fixture doesn't hold, drawn by the page's own pills: every status at once
    const words = await p.ev(`(() => { const d = document.createElement('div'); d.innerHTML = pillsOf(ticketPills({ id: 'x-1', stage: 'building', phase: 'build', task: 'T2', waiting: { kind: 'limit', line: 'limit' }, held: 'later', risk: 'high', component: 'pay' }, new Set(['x-1']))); return [...d.querySelectorAll('.pill')].map((x) => x.textContent); })()`);
    assert.deepEqual(words, ['critical path', 'building, task 2', 'usage limit', 'held', 'high risk', 'pay']);
    const prompt = await p.ev(`(() => { const d = document.createElement('div'); d.innerHTML = pillsOf(ticketPills({ id: 'x-2', stage: 'building', phase: 'build', waiting: { kind: 'prompt', line: 'p' }, held: 'later', risk: 'high', component: 'pay' }, new Set())); return [...d.querySelectorAll('.pill')].map((x) => x.textContent); })()`);
    assert.deepEqual(prompt, ['building', 'stuck on a prompt', 'held', 'high risk', 'pay']);
  });

  await t.test('a click, Enter and Space on a planner card open its peek', async () => {
    await board();
    const card = `document.querySelector('#planners [data-planner="${ids.planNoWindow}"]')`;
    assert.deepEqual(await p.ev(`[${card}.tagName, ${card}.getAttribute('role'), ${card}.getAttribute('tabindex')]`), ['DIV', 'button', '0']);
    assert.equal(await p.ev(`(() => { const c = ${card}; c.focus(); if (document.activeElement !== c) return 'not focused'; c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })); return true; })()`), true);
    await soon(`decodeURIComponent(location.hash) === ${J(`#planner/${ids.planNoWindow}`)} && !document.getElementById('drawer').hidden`, 'Enter: the planner peek');
    // Space, as on a <button>; a ticket card too
    for (const sel of [`#planners [data-planner="${ids.planNoWindow}"]`, `#board-cols [data-ticket="${ids.tPlain}"]`]) {
      await board();
      assert.equal(await p.ev(`(() => { const c = document.querySelector(${J(sel)}); c.focus(); if (document.activeElement !== c) return 'not focused'; return c.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true })); })()`), false, 'Space is taken (no page scroll)');
      await soon(`!document.getElementById('drawer').hidden && /^#(planner|ticket)[/]/.test(location.hash)`, `Space on ${sel}: its peek`);
    }
    await board();
    await p.click(`#planners [data-planner="${ids.planNoWindow}"] .pl-head`);
    await soon(`decodeURIComponent(location.hash) === ${J(`#planner/${ids.planNoWindow}`)} && !document.getElementById('drawer').hidden`, 'a click: the planner peek');
  });

  await t.test("a feature peek's board: the same cards, the critical-path pill, the held card's outline and question link", async () => {
    await board();
    await p.ev(`location.hash = ${J(`#feature/${ids.featPay}`)}`);
    const B = '#drawer-body .board-peek';
    await soon(`document.querySelectorAll(${J(`${B} .tcard[data-ticket]`)}).length === ${patch.progress.tickets.filter((x) => x.feature === ids.featPay).length}`, "the feature's cards in its peek");
    const want = Object.fromEntries(Object.entries(expectedPills(ids)).filter(([id]) => patch.progress.tickets.find((x) => x.id === id).feature === ids.featPay));
    assert.deepEqual(await p.ev(PILLS(B)), want, "the peek's cards' pills, whole: critical path on the critical card alone");
    const red = await p.ev(TOKEN('--red'));
    const held = await p.ev(`(() => { const c = document.querySelector(${J(`${B} [data-ticket="${ids.tBlockedQ}"]`)}); return { blocked: c.classList.contains('blocked'), color: getComputedStyle(c).borderTopColor, href: c.querySelector('.att a.att-q')?.getAttribute('href') ?? null, head: !!c.querySelector('.tc-head') }; })()`);
    assert.deepEqual(held, { blocked: true, color: red, href: `#q/${ids.qTicket}`, head: true }, "the held card in the peek");
    assert.equal(await p.ev(`[...document.querySelectorAll(${J(`${B} .tcard.blocked`)})].map((c) => c.dataset.ticket).sort().join()`), [ids.tBlockedQ, ids.tLimit].sort().join(), 'the outline on those needing attention alone');
    assert.deepEqual(await p.ev('window.__errors'), []);
  });
});

// ---- kit-91 T5: Progress on the shell ----

// burnup() as kit main 5291c8d0 has it (read with `git show 5291c8d0:docs/devteam/dashboard/index.html` when
// this test was written, from `function burnup(` to its closing brace), with kit-95's two empty states, which read
// None: the page's must be the same, byte for byte
const BURNUP_MAIN = "function burnup(items, now, ui = PROGRESS_CHART()) {\n  const el = ui.el;\n  const setForecast = (s) => { if (ui.forecast) ui.forecast.textContent = s; };\n  ui.legend.hidden = !items.some(isDone);\n  if (!items.length) { el.innerHTML = empty('None'); setForecast(''); return; }\n  const scopePts = items.reduce((a, t) => a + t.weight, 0);\n  if (!items.some(isDone)) {\n    el.innerHTML = empty('None');\n    setForecast(`0/${scopePts} pts`);\n    return;\n  }\n  const evs = [];\n  for (const t of items) {\n    evs.push([Date.parse(t.added_at), t.weight, 0]);\n    if (t.merged_at) evs.push([Date.parse(t.merged_at), 0, t.weight]);\n  }\n  evs.sort((a, b) => a[0] - b[0]);\n  const pts = [];\n  let s = 0, d = 0;\n  for (const [ts, ds, dd] of evs) { s += ds; d += dd; pts.push([ts, s, d]); }\n  pts.push([now, s, d]);\n  const fc = forecast(items, now);\n  const t0 = pts[0][0];\n  const end = Math.min(Math.max(now + DAY, fc.finished ? now : (fc.worst || fc.eta || now)), now + 365 * DAY);\n  const t1 = end + (end - t0) * 0.04;\n  const W = Math.round(Math.max(300, el.clientWidth || 640)), H = W < 500 ? 220 : 280, L = 34, R = 12, T = 12, B = 26;\n  const yMax = Math.max(1, s) * 1.1;\n  const x = (ts) => L + ((ts - t0) / Math.max(1, t1 - t0)) * (W - L - R);\n  const y = (v) => H - B - (v / yMax) * (H - T - B);\n  const step = (idx) => pts.map((p, i) => `${i ? `H${x(p[0]).toFixed(1)}V` : `M${x(p[0]).toFixed(1)},`}${y(p[idx]).toFixed(1)}`).join('');\n  // whole-number y steps (1, 2, 5, 10, …) and x labels that never repeat a date\n  const yStep = [1, 2, 5, 10, 20, 50, 100, 200, 500].find((st) => yMax / st <= 5) ?? Math.ceil(yMax / 5);\n  const yTicks = []; for (let v = 0; v <= yMax; v += yStep) yTicks.push(v);\n  const short = t1 - t0 < 2 * DAY;\n  const xFmt = (ts) => (short ? new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : fmtDate(ts));\n  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => t0 + f * (t1 - t0)).filter((ts, i, a) => i === 0 || xFmt(ts) !== xFmt(a[i - 1]));\n  let svg = `<svg viewBox=\"0 0 ${W} ${H}\" role=\"img\" aria-label=\"Burn-up chart: ${fc.done} of ${fc.scope} points done\">`;\n  for (const v of [...new Set(yTicks)]) svg += `<line x1=\"${L}\" x2=\"${W - R}\" y1=\"${y(v)}\" y2=\"${y(v)}\" stroke=\"var(--grid)\"/><text x=\"${L - 6}\" y=\"${y(v) + 4}\" text-anchor=\"end\" font-size=\"10\" fill=\"var(--muted)\">${v}</text>`;\n  for (const [i, ts] of xTicks.entries()) svg += `<text x=\"${x(ts)}\" y=\"${H - 8}\" text-anchor=\"${i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}\" font-size=\"10\" fill=\"var(--muted)\">${xFmt(ts)}</text>`;\n  // done area + line, scope line\n  svg += `<path d=\"${step(2)}V${y(0)}H${x(pts[0][0])}Z\" fill=\"var(--series-1)\" opacity=\".12\"/>`;\n  svg += `<path d=\"${step(1)}\" fill=\"none\" stroke=\"var(--muted)\" stroke-width=\"2\" stroke-dasharray=\"5 4\"/>`;\n  svg += `<path d=\"${step(2)}\" fill=\"none\" stroke=\"var(--series-1)\" stroke-width=\"2\"/>`;\n  // forecast: line to the expected date, band between best and worst\n  if (fc.eta && !fc.finished) {\n    svg += `<polygon points=\"${x(now)},${y(fc.done)} ${x(fc.best)},${y(fc.scope)} ${x(fc.worst)},${y(fc.scope)}\" fill=\"var(--series-1)\" opacity=\".08\"/>`;\n    svg += `<line x1=\"${x(now)}\" y1=\"${y(fc.done)}\" x2=\"${x(fc.eta)}\" y2=\"${y(fc.scope)}\" stroke=\"var(--series-1)\" stroke-width=\"2\" stroke-dasharray=\"2 4\"/>`;\n    svg += `<circle cx=\"${x(fc.eta)}\" cy=\"${y(fc.scope)}\" r=\"4\" fill=\"var(--series-1)\" stroke=\"var(--surface)\" stroke-width=\"2\"/>`;\n    svg += `<text x=\"${Math.min(x(fc.eta), W - R - 4)}\" y=\"${y(fc.scope) - 8}\" text-anchor=\"end\" font-size=\"11\" fill=\"var(--fg)\">${fmtDate(fc.eta)}</text>`;\n  }\n  svg += `<line x1=\"${x(now)}\" x2=\"${x(now)}\" y1=\"${T}\" y2=\"${H - B}\" stroke=\"var(--muted)\" stroke-width=\"1\"/>${fc.eta && !fc.finished && x(fc.eta) - x(now) < 70 ? '' : `<text x=\"${x(now) + 4}\" y=\"${T + 10}\" font-size=\"10\" fill=\"var(--muted)\">today</text>`}`;\n  svg += `<line class=\"xh\" x1=\"0\" x2=\"0\" y1=\"${T}\" y2=\"${H - B}\" stroke=\"var(--fg)\" stroke-width=\"1\" opacity=\"0\"/>`;\n  svg += `<rect class=\"hit\" x=\"${L}\" y=\"${T}\" width=\"${W - L - R}\" height=\"${H - T - B}\" fill=\"transparent\"/></svg>`;\n  el.innerHTML = svg;\n  const svgEl = el.querySelector('svg'), hit = el.querySelector('.hit'), xh = el.querySelector('.xh'), tip = ui.tip;\n  hit.addEventListener('mousemove', (e) => {\n    const r = svgEl.getBoundingClientRect();\n    const vx = ((e.clientX - r.left) / r.width) * W;\n    const ts = t0 + ((vx - L) / (W - L - R)) * (t1 - t0);\n    let p = pts[0];\n    for (const q of pts) if (q[0] <= ts) p = q;\n    xh.setAttribute('x1', vx); xh.setAttribute('x2', vx); xh.setAttribute('opacity', '.3');\n    tip.style.display = 'block';\n    tip.innerHTML = ts > now ? `${fmtDate(ts)}<br><span class=\"muted\">forecast</span>` : `<b>${fmtDate(ts)}</b><br>done ${p[2]} · scope ${p[1]}`;\n    const box = ui.card.getBoundingClientRect();\n    tip.style.left = `${Math.min(e.clientX - box.left + 12, box.width - 140)}px`;\n    tip.style.top = `${e.clientY - box.top - 10}px`;\n  });\n  hit.addEventListener('mouseleave', () => { tip.style.display = 'none'; xh.setAttribute('opacity', '0'); });\n  const range = fc.best && fc.worst && fc.worst - fc.best > DAY ? ` (range ${fmtDate(fc.best)} – ${fmtDate(fc.worst)})` : '';\n  setForecast(fc.finished ? `done: ${fc.done} of ${fc.scope} points` : fc.eta\n    ? `${fc.done}/${fc.scope} pts · ETA ${fmtDate(fc.eta)}${range} · ${fc.perDay.toFixed(1)} pts/day`\n    : `${fc.done}/${fc.scope} pts · ETA –`);\n}";
// each Progress list's rows, as the records they open (decoded), and what a list says when it has none
const ROWS = `Object.fromEntries(['features', 'stories', 'releases', 'waves'].map((k) => { const el = document.getElementById('w-' + k); const rows = [...el.querySelectorAll('.row')].map((r) => decodeURIComponent(r.dataset.open || '')); return [k, rows.length ? rows : el.textContent.trim()]; }))`;
// the points a week the Points per week bars stand for, summed from their titles
const WEEK_POINTS = "[...document.querySelectorAll('#w-throughput span')].reduce((a, s) => a + Number(s.title.split(' ')[0]), 0)";
// each wave row's goal names (the dim text after it), by wave
const WAVE_GOALS = "Object.fromEntries([...document.querySelectorAll('#w-waves .row')].map((r) => [decodeURIComponent(r.dataset.open), r.querySelector('.wave-goals')?.textContent.trim() ?? null]))";

test('Progress on the shell: goal and Narrow scope every card, Show filters the rows, the forecast in the burn-up head', { ...CHROME, timeout: 600000 }, async (t) => {
  const { later, root, env } = boardStart(t);
  const { patch, ids } = boardFixture();
  const { p, soon, go } = await openOn(later, root, env, { init: dataPatchInit(patch) });
  const J = JSON.stringify;
  const G1 = 'Admins pay alone', G2 = 'Receipts for every payment';
  // a fresh Progress at a head, nothing remembered
  const progress = async (head = '#progress') => {
    await go('#overview');
    await p.ev('localStorage.clear()');
    await go(head);
    await soon(`!!${ctl('show')} && !!document.querySelector('#burnup svg')`, `${head}: the filters and the burn-up`);
  };
  // the rows once they read want (the page draws them at once on a change, so this waits on nothing slow)
  const rowsAre = async (want, what) => {
    try { await soon(`${J(J(want))} === JSON.stringify(${ROWS})`, what); } catch { /* the assertion says what differs */ }
    assert.deepEqual(await p.ev(ROWS), want, what);
  };

  await t.test("burnup() is kit main's, byte for byte", async () => {
    await progress();
    const src = fs.readFileSync(path.join(APP, 'src', 'views', 'board', 'burnup.ts'), 'utf8');
    const a = src.indexOf('function burnup('), b = src.indexOf('\n}\n', a);
    assert.ok(a >= 0 && b > a, 'burnup.ts declares function burnup');
    assert.equal(src.slice(a, b + 2), BURNUP_MAIN);
  });

  await t.test('the page is on the shell: no .no-shell, h2 or filter row; a .g12 of the mock cards, each with a card head', async () => {
    await progress();
    const m = await p.ev(`(() => {
      const s = document.getElementById('progress');
      const g = s.querySelector(':scope > .g12');
      const col = (c) => g && g.querySelector(':scope > .' + c) ? [...g.querySelector(':scope > .' + c).querySelectorAll(':scope > .card')].map((x) => x.id || x.querySelector('[id^="w-"]')?.id || '') : null;
      return { fenced: !!s.closest('.no-shell') || s.classList.contains('no-shell'), h2: s.querySelectorAll('h2, .filters').length, c8: col('c8'), c4: col('c4'),
        heads: [...s.querySelectorAll('.card')].map((c) => c.firstElementChild?.classList.contains('card-head') ? c.firstElementChild.textContent.replace(/\\s+/g, ' ').trim().split(' ')[0] : null) };
    })()`);
    assert.deepEqual({ ...m, heads: m.heads.map((x) => x !== null) }, {
      fenced: false, h2: 0,
      c8: ['burnup-card', 'w-stories'], c4: ['w-features', 'w-releases', 'w-waves', 'w-throughput'],
      heads: [true, true, true, true, true, true],
    });
  });

  await t.test('every Progress card title shows whole at 390 wide; a long forecast shortens instead', async () => {
    try {
      await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
      await progress();
      await soon("!!document.getElementById('forecast').textContent", 'the forecast');
      const heads = await p.ev(`[...document.querySelectorAll('#progress .card-head > .grow')].map((g) => [g.textContent.trim(), g.scrollWidth <= g.clientWidth + 0.5 && g.getBoundingClientRect().width > 0])`);
      assert.deepEqual(heads, ['Burn-up', 'Stories', 'Features', 'Releases', 'Waves', 'Points per week'].map((x) => [x, true]), 'each title unclipped');
      const f = await p.ev("(() => { const f = document.getElementById('forecast'), h = f.closest('.card-head').getBoundingClientRect(), r = f.getBoundingClientRect(); return { inside: r.right <= h.right + 0.5, ellipsis: getComputedStyle(f).textOverflow }; })()");
      assert.deepEqual(f, { inside: true, ellipsis: 'ellipsis' }, 'the forecast stays in its head, cut short');
    } finally {
      await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    }
  });

  await t.test("the forecast sits in the burn-up card's head, at its right", async () => {
    await progress();
    const m = await p.ev(`(() => {
      const f = document.getElementById('forecast'), h = f && f.closest('.card-head');
      if (!h) return { inHead: false };
      const fr = f.getBoundingClientRect(), hr = h.getBoundingClientRect(), pr = parseFloat(getComputedStyle(h).paddingRight);
      return { inHead: h.parentElement.id === 'burnup-card', text: f.textContent.length > 0, right: Math.abs(hr.right - pr - fr.right) <= 1, pastMiddle: fr.left > hr.left + hr.width / 2 };
    })()`);
    assert.deepEqual(m, { inHead: true, text: true, right: true, pastMiddle: true });
    assert.equal(await p.ev("document.querySelectorAll('#progress .small.muted #forecast, #progress > div > #forecast').length"), 0, 'no forecast line above the cards');
  });

  await t.test('Show filters the rows: Active the not done, Complete the done (None when empty), Everything both', async () => {
    await progress();
    await rowsAre({
      features: ['feature/pay', 'feature/receipts', 'feature/no-goal-feat'],
      stories: ['story/PAY-S2', 'story/RECEIPTS-S2'],
      releases: ['release/v0.3.0'],
      waves: ['wave/1', 'wave/2'],
    }, 'Active (the default)');
    const burn = await p.ev(BURNUP);
    await pick(p, 'show', 'complete');
    await soon("location.hash.includes('show=complete')", 'show=complete');
    await rowsAre({
      features: 'None',
      stories: ['story/PAY-S1', 'story/RECEIPTS-S1'],
      releases: ['release/v0.1.0', 'release/v0.2.0'],
      waves: 'None',
    }, 'Complete');
    assert.equal(await p.ev(BURNUP), burn, "Show doesn't change the burn-up");
    assert.equal(await p.ev(WEEK_POINTS), 6, "nor Points per week");
    await pick(p, 'show', 'all');
    await soon("location.hash.includes('show=all')", 'show=all');
    await rowsAre({
      features: ['feature/pay', 'feature/receipts', 'feature/no-goal-feat'],
      stories: ['story/PAY-S1', 'story/PAY-S2', 'story/RECEIPTS-S1', 'story/RECEIPTS-S2'],
      releases: ['release/v0.1.0', 'release/v0.2.0', 'release/v0.3.0'],
      waves: ['wave/1', 'wave/2'],
    }, 'Everything');
    assert.deepEqual(await p.ev('window.__errors'), []);
  });

  await t.test('the goal and Narrow scope the burn-up, Points per week and every list', async () => {
    await progress();
    assert.match(await p.ev(BURNUP), /: 6 of 16 points done/, 'every ticket');
    assert.equal(await p.ev(WEEK_POINTS), 6, 'every merge in the last 8 weeks');
    await pick(p, 'goal', ids.goal1);
    await soon(`/: 3 of 8 points done/.test(${BURNUP})`, "goal1's points in the burn-up");
    assert.equal(await p.ev(WEEK_POINTS), 3, "goal1's merges");
    await rowsAre({ features: ['feature/pay'], stories: ['story/PAY-S2'], releases: ['release/v0.3.0'], waves: ['wave/2'] }, 'goal1, Active');
    await pick(p, 'show', 'all');
    await soon("location.hash.includes('show=all')", 'show=all');
    await rowsAre({
      features: ['feature/pay'], stories: ['story/PAY-S1', 'story/PAY-S2'], releases: ['release/v0.1.0', 'release/v0.3.0'], waves: ['wave/1', 'wave/2'],
    }, 'goal1, Everything');
    await pick(p, 'narrow', 'story:PAY-S1');
    await soon(`/: 3 of 3 points done/.test(${BURNUP})`, 'the narrowed burn-up');
    await rowsAre({ features: ['feature/pay'], stories: ['story/PAY-S1'], releases: ['release/v0.1.0'], waves: ['wave/1'] }, 'goal1, story PAY-S1, Everything');
    await pick(p, 'show', '');
    await soon("!location.hash.includes('show=')", 'Active');
    await rowsAre({ features: 'None', stories: 'None', releases: 'None', waves: 'None' }, 'goal1, story PAY-S1, Active: all done, so None');
    // Narrow with no goal
    await progress(`#progress?narrow=${encodeURIComponent('feature:receipts')}`);
    await soon(`/: 3 of 7 points done/.test(${BURNUP})`, "receipts' points in the burn-up");
    await rowsAre({ features: ['feature/receipts'], stories: ['story/RECEIPTS-S2'], releases: ['release/v0.3.0'], waves: ['wave/1', 'wave/2'] }, 'feature receipts, Active');
    assert.deepEqual(await p.ev(WAVE_GOALS), { 'wave/1': G2, 'wave/2': G2 }, "each wave names the goals of the receipts' tickets in it");
    assert.deepEqual(await p.ev('window.__errors'), []);
  });

  await t.test('with no goal picked each wave row names its goals, dim; with a goal, none', async () => {
    await progress();
    assert.deepEqual(await p.ev(WAVE_GOALS), { 'wave/1': `${G1}, ${G2}`, 'wave/2': `${G1}, ${G2}` });
    assert.equal(await p.ev("[...document.querySelectorAll('#w-waves .wave-goals')].every((x) => x.classList.contains('dim'))"), true, 'dim');
    await pick(p, 'goal', ids.goal2);
    await soon(`location.hash.includes(${J(`goal=${ids.goal2}`)})`, 'goal2');
    await soon(`${J(J({ 'wave/1': null, 'wave/2': null }))} === JSON.stringify(${WAVE_GOALS})`, "goal2's open waves, no goal named");
  });

  await t.test("the inventory: legend, tooltip, Stories, Features, Releases tagged and ready to tag, Waves, Points per week", async () => {
    await progress('#progress?show=all');
    assert.deepEqual(await p.ev("[...document.querySelectorAll('#legend > span')].map((s) => s.textContent.trim())"), ['done', 'scope', 'forecast', 'points: S = 1, M = 2']);
    assert.equal(await p.ev("document.getElementById('legend').hidden"), false, 'the legend shows');
    const at = await p.at('#burnup .hit');
    await p.move(at.x, at.y);
    await soon("getComputedStyle(document.getElementById('tip')).display === 'block' && /done \\d+ · scope \\d+|forecast/.test(document.getElementById('tip').textContent)", 'a hover on the chart shows its tip');
    await p.move(2, 2);
    for (const k of ['features', 'stories', 'releases', 'waves']) assert.ok(await p.ev(`document.querySelectorAll('#w-${k} .row').length > 0`), `#w-${k} has rows`);
    assert.deepEqual(await p.ev("[...document.querySelectorAll('#w-releases .row')].map((r) => [decodeURIComponent(r.dataset.open), r.querySelector('.badge')?.textContent ?? null])"), [
      ['release/v0.1.0', 'tagged'], ['release/v0.2.0', 'ready to tag'], ['release/v0.3.0', null],
    ]);
    assert.equal(await p.ev("document.querySelectorAll('#w-throughput > span').length"), 8, 'eight weeks of bars');
    assert.match(await p.ev("document.getElementById('w-throughput-note').textContent"), /^8 weeks · this week \d+$/);
    assert.deepEqual(await p.ev('window.__errors'), []);
  });

  await t.test('under Features, the No goal line: each feature with no goal, its done of scope points, and the rate', async () => {
    await progress();
    const m = await p.ev(`(() => { const n = document.querySelector('#progress .card:has(#w-features) .nogoal'); return n && { text: n.textContent.replace(/\\s+/g, ' ').trim(), links: [...n.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.textContent]), after: !!(document.getElementById('w-features').compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) }; })()`);
    assert.deepEqual(m, { text: "No goal: The kit's docs 0 of 1 points · 1.4 points a day", links: [[`#feature/${ids.featNoGoal}`, "The kit's docs"]], after: true });
    // no feature without a goal: the rate alone
    await p.ev('DATA.ooda.roadmap.unassigned = []; renderProgress(); void 0');
    assert.equal(await p.ev("document.querySelector('#progress .nogoal').textContent.replace(/\\s+/g, ' ').trim()"), '1.4 points a day');
  });

  await t.test("a release's tagged or ready to tag, and a story's done, are about the whole release or story, never the scope", async () => {
    // every RECEIPTS-S2 ticket merged, and one PAY-S2 ticket merged and moved to wave 1: under goal2, v0.3.0's receipts
    // half is done but its pay half isn't; under wave 1, PAY-S2's one ticket there is done but PAY-S2 isn't; and Card
    // capture (PAY-S1, v0.1.0) moved to wave 2: under wave 2, v0.1.0 holds none of its released tickets but is tagged
    // (each load is a fresh document with the fixture again, so the change goes in after it, read at the next poll)
    const FX = `(() => { const at = new Date(Date.parse(window.__fx.progress.now) - 86400000).toISOString(); for (const t of window.__fx.progress.tickets) { if (${J([ids.tHighRisk, ids.tPrompt, ids.tBlockedNoQ])}.includes(t.id)) t.merged_at = at; if (t.id === ${J(ids.tHeld)}) { t.merged_at = at; t.wave = 1; } if (t.id === ${J(ids.tMerged)}) t.wave = 2; } })()`;
    const BADGES = (k) => `Object.fromEntries([...document.querySelectorAll('#w-${k} .row')].map((r) => [decodeURIComponent(r.dataset.open), r.querySelector('.badge')?.textContent ?? null]))`;
    await progress(`#progress?goal=${ids.goal2}&show=all`);
    await p.ev(FX);
    await soon(`${BADGES('stories')}['story/RECEIPTS-S2'] === 'done'`, 'the patched data is in: RECEIPTS-S2 done');
    assert.deepEqual(await p.ev(BADGES('releases')), { 'release/v0.2.0': 'ready to tag', 'release/v0.3.0': null }, "goal2's half of v0.3.0 is done, PAY-S2 isn't: not ready to tag");
    await progress(`#progress?narrow=${encodeURIComponent('wave:1')}&show=all`);
    await p.ev(FX);
    await soon(`'story/PAY-S2' in ${BADGES('stories')}`, 'PAY-S2 has a ticket in wave 1');
    assert.equal((await p.ev(BADGES('stories')))['story/PAY-S2'], null, "PAY-S2's wave-1 ticket is merged, its others aren't: not done");
    // (wave 2 has nothing merged until the change is in, so no chart to wait on first)
    await go('#overview');
    await p.ev('localStorage.clear()');
    await go(`#progress?narrow=${encodeURIComponent('wave:2')}&show=all`);
    await p.ev(FX);
    await soon(`'release/v0.1.0' in ${BADGES('releases')}`, 'v0.1.0 has a ticket in wave 2');
    assert.equal((await p.ev(BADGES('releases')))['release/v0.1.0'], 'tagged', "v0.1.0's released ticket is out of the scope, the release is tagged all the same");
    assert.deepEqual(await p.ev('window.__errors'), []);
  });
});
