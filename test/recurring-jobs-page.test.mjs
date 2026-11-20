// The Jobs page under Autonomy (kit-169): a shell page (id jobs, title Jobs, group Autonomy, after Sensors, icon
// calendar-clock) whose nav count is the jobs failing now (danger colour), else the number of jobs; four section
// cards, each a record table whose rows open their peek (Jobs, What the loop noticed, Built in, Proposed jobs);
// and an All jobs link on the head of Upkeep's peek's Jobs section. It reads only /api/data's upkeep.recurring
// (C5). Driven in real headless Chrome over a real dashboard on a bare project; upkeep.recurring is
// test/fixtures/recurring/dashboard.json and /api/peek?kind=recurring answers from test/fixtures/recurring/peek.json
// (kit-161's fixtures), as test/recurring-dashboard.test.mjs (kit-166) does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTS, bareProject, dashboardOnFreePort } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX = fs.readFileSync(path.join(here, '..', 'docs', 'devteam', 'dashboard', 'index.html'), 'utf8');
const DASH = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'recurring', 'dashboard.json'), 'utf8'));
const PEEK_FX = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'recurring', 'peek.json'), 'utf8'));
const CHROME = { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' };
const J = JSON.stringify;
const clone = (x) => JSON.parse(J(x));

// The page's data with upkeep.recurring and the questions in place (window.__rec, window.__qs: a test changes
// them in the page and the next poll draws it; window.__rec undefined leaves upkeep.recurring out),
// /api/peek?kind=recurring from window.__peeks, the 10 s poll every 300 ms, and every page error in window.__errors.
const initScript = (rec, peeks) => `(() => {
  const si = window.setInterval;
  window.setInterval = (f, ms, ...a) => si(f, ms === 10000 ? 300 : ms, ...a);
  window.__rec = ${rec === undefined ? 'undefined' : J(rec)};
  window.__peeks = ${J(peeks)};
  window.__errors = [];
  window.addEventListener('error', (e) => window.__errors.push(String(e.message || e.error || e)));
  window.addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason && e.reason.message || e.reason)));
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const real = window.fetch;
  window.fetch = async (u, o) => {
    const url = String(u && u.url ? u.url : u);
    const method = String(o?.method || 'GET').toUpperCase();
    if (method === 'GET' && url.startsWith('/api/peek?')) {
      const q = new URLSearchParams(url.slice(10));
      if (q.get('kind') === 'recurring') { const p = window.__peeks[q.get('id')]; return p ? json(p) : json({ error: 'no such job' }, 404); }
    }
    const r = await real(u, o);
    if (method !== 'GET' || !r.ok || !url.startsWith('/api/data')) return r;
    const d = await r.json();
    if (window.__rec === undefined) { if (d.upkeep) delete d.upkeep.recurring; }
    else d.upkeep = { ...(d.upkeep || {}), recurring: window.__rec };
    return json(d);
  };
})();`;

const soonIn = (p, ms = 20000) => async (expr, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v, err = null;
    try { v = await p.ev(expr); } catch (e) { err = e; }
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out: ${what}${err ? `; last: ${err.message}` : ''}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

// A bare project with three real questions (one open, two answered Yes by the owner), so a Proposed jobs row
// opens a real Inbox card or a real answered question's peek; the fixture's proposals take their ids.
function fixture(base) {
  const root = bareProject(base, 'jobs-page');
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 72), DEVTEAM_PORT_BASE: String(PORTS + 73), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of Object.keys(env)) if (k.startsWith('DEVTEAM_') && !['DEVTEAM_HUB_PORT', 'DEVTEAM_PORT_BASE'].includes(k)) delete env[k];
  for (const k of ['TMUX', 'TMUX_PANE']) delete env[k];
  const dt = (args, role) => {
    const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: root, env: role ? { ...env, DEVTEAM_ROLE: role } : env, encoding: 'utf8' });
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim().split('\n')[0].trim();
  };
  const ask = (q) => dt(['ask', '--question', q, '--choices', '[{"label":"Yes"},{"label":"No"}]', '--recommendation', 'Yes', '--stake', '1', '--urgency', '1'], 'supervisor');
  const ids = { open: ask('Should I add a job that checks the bundle stays under 300 kB?'), registering: ask('Should I add a job that closes stale issues?'), stopping: ask('Should I stop the job that sends the weekly report?') };
  dt(['answer', ids.registering, 'Yes']);
  dt(['answer', ids.stopping, 'Yes']);
  const rec = clone(DASH);
  for (const p of rec.proposals) p.qid = ids[p.status];
  return { root, env, ids, rec };
}

// The dashboard on the fixture and Chrome on it: { p, soon, go, fx, click }. go(hash) loads a fresh document at that head.
async function openOn(t, { rec, peeks = clone(PEEK_FX), width = 1440, height = 900 }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-jobs-page-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const fx = fixture(base);
  const { dash, port } = await dashboardOnFreePort(fx.root, fx.env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const r = rec === undefined ? undefined : rec === 'fixture' ? fx.rec : rec(fx.rec);
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: initScript(r, peeks) });
  const soon = soonIn(p);
  const go = async (hash) => {
    await p.send('Page.navigate', { url: 'about:blank' });
    await soon("location.href === 'about:blank'", 'about:blank');
    await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/${hash}` });
    await soon("!document.querySelector('main.waiting') && typeof DATA !== 'undefined' && !!DATA", 'the page with its data');
  };
  // a real click, once the target has stopped moving: a fresh load can slide the Threads panel in (remembered open),
  // which moves the page under it while the click's point is read
  const click = async (sel) => {
    await p.ev(`(() => { document.querySelector(${J(sel)}).scrollIntoView({ block: 'center', behavior: 'instant' }); })(); new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    await soon(`(async () => { const at = () => JSON.stringify(document.querySelector(${J(sel)}).getBoundingClientRect()); const a = at(); await new Promise((r) => setTimeout(r, 150)); return a === at(); })()`, `${sel} at rest`);
    await p.click(sel);
  };
  return { p, soon, go, fx, click, port };
}

// The Jobs page as the page has it: its section, its cards (data-jp) and each card's head label (the head's own
// text, without its end note), its tables' headers and rows
const PAGE = {
  on: "!!document.querySelector('main.page > section#jobs[data-page=\"jobs\"].on')",
  cards: "[...document.querySelectorAll('#jobs .card')].filter((c) => c.querySelector(':scope > .card-head')).map((c) => ({ jp: c.dataset.jp || null, head: [...c.querySelector(':scope > .card-head').childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim() }))",
  card: (jp) => `document.querySelector('#jobs .card[data-jp="${jp}"]')`,
};
const heads = (sect) => `[...(${sect})?.querySelectorAll('table.db-t thead th') ?? []].map((th) => th.textContent.replace(/ [↑↓]$/, '').trim())`;
const rows = (sect) => `[...(${sect})?.querySelectorAll('table.db-t tbody tr[data-row]') ?? []].map((tr) => [...tr.cells].map((td) => td.textContent.trim()))`;
const jobsReady = (more = 'true') => `${PAGE.on} && !!${PAGE.card('jobs')} && (${more})`;
const withRows = (jp) => `!!${PAGE.card(jp)}?.querySelector('table.db-t tbody tr[data-row]')`;
// a table with no rows: the shell's None row, its only body row (dashboard-copy: every empty state reads None)
const NONE_ROW = (jp) => `(() => { const tb = ${PAGE.card(jp)}?.querySelector(':scope > [data-tbl] table.db-t tbody'); return tb && tb.rows.length === 1 && tb.rows[0].classList.contains('none') ? tb.rows[0].textContent.trim() : null; })()`;
const AT_REST = "getComputedStyle(document.getElementById('drawer')).transform === 'none'";
const peekOpen = (kind, id) => `DRAWER.kind === ${J(kind)} && DRAWER.id === ${J(id)} && !document.getElementById('drawer').hidden && ${AT_REST}`;
const peekClosed = "document.getElementById('drawer').hidden && !document.body.classList.contains('peek-open')";
const NAV = "document.getElementById('n-jobs')";
// the danger colour, resolved: a probe coloured with the token the nav's hot count uses
const RED = "(() => { const s = document.createElement('span'); s.style.color = 'var(--red-fg)'; document.querySelector('.side').appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; })()";
const SIGNALS = DASH.entries.flatMap((e) => (e.signals || []).map((s) => ({ e, s })));
const SIG_WORDS = { flapping: 'flapping', erroring: 'erroring', slow: 'slow', 'failing-long': 'failing a long time', idle: 'nothing to do', overdue: 'often late', quiet: 'never fails' };

test('the shell registers the Jobs page under Autonomy, right after Sensors, with calendar-clock; #jobs opens it and Back returns (done-when 2)', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go } = await openOn(t, { rec: 'fixture' });
  await go('#sensors');
  await soon("!!document.querySelector('main.page > section#monitoring.on')", 'Sensors');
  const reg = await p.ev("shellPages().map((pg) => ({ id: pg.id, title: pg.title, group: pg.group, icon: pg.icon }))");
  const i = reg.findIndex((x) => x.id === 'jobs');
  assert.ok(i >= 0, `a page with id jobs: ${J(reg.map((x) => x.id))}`);
  assert.deepEqual(reg[i], { id: 'jobs', title: 'Jobs', group: 'autonomy', icon: 'calendar-clock' });
  assert.equal(reg[i - 1].id, 'sensors', 'registered right after Sensors');
  assert.equal(reg.find((x) => x.id === 'loop').icon, 'repeat', 'Self Improvement keeps repeat');
  // the side nav: Autonomy's items in order, Jobs after Sensors, its icon calendar-clock
  const nav = await p.ev("[...document.querySelectorAll('.side nav.nav[data-group=\"autonomy\"] a')].map((a) => ({ href: a.getAttribute('href'), title: a.querySelector('.nl')?.textContent.trim(), icon: a.querySelector('.nl i')?.className }))");
  const n = nav.findIndex((x) => x.href === '#jobs');
  assert.ok(n > 0, `Jobs in Autonomy's nav: ${J(nav)}`);
  assert.equal(nav[n - 1].href, '#sensors', 'after Sensors in the side nav');
  assert.deepEqual(nav[n], { href: '#jobs', title: 'Jobs', icon: 'icon-calendar-clock' });
  // #jobs opens it: its section alone, its title in the page bar, its nav item current
  await p.ev("location.hash = '#jobs'; void 0");
  await soon(jobsReady(), 'the Jobs page');
  assert.equal(await p.ev("document.getElementById('page-title').textContent"), 'Jobs');
  assert.equal(await p.ev("document.querySelector('.side a[href=\"#jobs\"]').getAttribute('aria-current')"), 'page');
  assert.deepEqual(await p.ev("[...document.querySelectorAll('main.page > section[data-page].on')].map((s) => s.dataset.page)"), ['jobs']);
  // Back returns to Sensors
  await p.ev('history.back(); void 0');
  await soon("location.hash === '#sensors' && !!document.querySelector('main.page > section#monitoring.on') && !document.querySelector('main.page > section#jobs.on')", 'Back to Sensors');
  // a cold load of #jobs opens it too
  await go('#jobs');
  await soon(jobsReady(), 'the Jobs page, cold');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('its nav count: the jobs failing, in the danger colour; with none failing, the number of jobs, not in it (done-when 3)', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go } = await openOn(t, { rec: 'fixture' });
  await go('#sensors');
  const failing = DASH.entries.filter((e) => e.state === 'failing').length;
  assert.equal(failing, 2, 'the fixture has two failing jobs');
  await soon(`${NAV}?.textContent.trim() === ${J(String(failing))}`, 'the count of failing jobs');
  assert.equal(await p.ev(`${NAV}.classList.contains('hot')`), true, 'hot');
  const red = await p.ev(RED);
  assert.equal(await p.ev(`getComputedStyle(${NAV}).color`), red, 'in the danger colour');
  // the count follows the data: one failing
  await p.ev("window.__rec.entries.find((e) => e.name === 'nightly-e2e').state = 'passing'; void 0");
  await soon(`${NAV}.textContent.trim() === '1'`, 'one failing');
  // none failing: the number of jobs, not in the danger colour
  await p.ev("for (const e of window.__rec.entries) if (e.state === 'failing') e.state = 'passing'; void 0");
  await soon(`${NAV}.textContent.trim() === ${J(String(DASH.entries.length))}`, 'the number of jobs');
  assert.equal(await p.ev(`${NAV}.classList.contains('hot')`), false, 'not hot');
  assert.notEqual(await p.ev(`getComputedStyle(${NAV}).color`), red, 'not in the danger colour');
  // no jobs: no count
  await p.ev('window.__rec.entries = []; void 0');
  await soon(`${NAV}.textContent.trim() === '' && !${NAV}.classList.contains('hot')`, 'no jobs, no count');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('four section cards in order, each the shell\'s sortable record table whose rows open their peek (done-when 4)', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go, fx, click } = await openOn(t, { rec: 'fixture' });
  await go('#jobs');
  await soon(jobsReady(`${withRows('jobs')} && ${withRows('noticed')} && ${withRows('builtin')} && ${withRows('proposals')}`), 'the Jobs page with its four tables');
  assert.deepEqual(await p.ev(PAGE.cards), [{ jp: 'jobs', head: 'Jobs' }, { jp: 'noticed', head: 'What the loop noticed' }, { jp: 'builtin', head: 'Built in' }, { jp: 'proposals', head: 'Proposed jobs' }], 'four section cards, in order');
  for (const jp of ['jobs', 'noticed', 'builtin', 'proposals']) assert.equal(await p.ev(`!!${PAGE.card(jp)}.querySelector(':scope > [data-tbl] > table.db-t')`), true, `${jp}: the shell's record table in its card`);
  // Jobs: every entry, in the data's order
  const JOBS = PAGE.card('jobs');
  assert.deepEqual(await p.ev(heads(JOBS)), ['Job', 'Kind', 'Every', 'Last run', 'Next', 'Fails in a row', 'Noticed']);
  const jr = await p.ev(rows(JOBS));
  assert.deepEqual(jr.map((r) => r[0]), DASH.entries.map((e) => e.title), 'a row per job');
  assert.deepEqual(jr.map((r) => r[1]), ['check', 'check', 'check', 'check', 'check', 'chore, by a worker', 'chore, by the supervisor', 'chore, by the supervisor', 'chore, by the supervisor']);
  assert.deepEqual(jr.slice(0, 3).map((r) => r[2]), ['6 hours', 'day at 02:00 UTC', 'day at 06:00 UTC']);
  assert.match(jr[0][3], /^error /, 'ci-main\'s last run: error and its time');
  assert.equal(jr[4][3], 'not run yet');
  assert.equal(jr[8][4], 'waits for Upkeep', 'a held chore waits for Upkeep');
  assert.deepEqual(jr.map((r) => r[5]), DASH.entries.map((e) => String(e.fails_in_a_row)), 'fails in a row from fails_in_a_row');
  assert.deepEqual(jr.map((r) => r[6]), DASH.entries.map((e) => (e.signals.length ? e.signals.map((s) => SIG_WORDS[s.kind]).join(' ') : '—')), 'noticed: each signal in words');
  // fails in a row is the row's fails_in_a_row, not counted from anything else
  await p.ev("window.__rec.entries[0].fails_in_a_row = 25; void 0");
  await soon(`${rows(JOBS)}[0]?.[5] === '25'`, 'fails in a row follows fails_in_a_row');
  // What the loop noticed: one row per signal across all jobs
  const NOT = PAGE.card('noticed');
  assert.deepEqual(await p.ev(heads(NOT)), ['Job', 'Signal', 'What it saw', 'What it may propose']);
  assert.deepEqual(await p.ev(rows(NOT)), SIGNALS.map(({ e, s }) => [e.title, SIG_WORDS[s.kind], s.text, s.may]));
  // Built in and Proposed jobs, as kit-166's sections
  const BI = PAGE.card('builtin');
  assert.deepEqual(await p.ev(heads(BI)), ['Job', 'Every', 'Last', 'Next']);
  assert.deepEqual((await p.ev(rows(BI))).map((r) => r[0]), ['Retro', 'Research', 'Kit sync', 'Sensors']);
  const PJ = PAGE.card('proposals');
  assert.deepEqual(await p.ev(heads(PJ)), ['Proposed job', 'Status', 'Asked']);
  assert.deepEqual((await p.ev(rows(PJ))).map((r) => r.slice(0, 2)), [['The bundle stays under 300 kB', 'waiting on you'], ['Stale issues are closed', 'you said Yes · being registered'], ['The weekly report is sent', 'you said Yes · being stopped']]);
  // sortable: each table's first header sorts ascending, then descending; Fails in a row sorts as a number
  for (const jp of ['jobs', 'noticed', 'builtin', 'proposals']) {
    const sel = `#jobs .card[data-jp="${jp}"] th:nth-child(1) button.sort`;
    const before = (await p.ev(rows(PAGE.card(jp)))).map((r) => r[0]);
    await click(sel);
    await soon(`${PAGE.card(jp)}.querySelector('th:nth-child(1)').getAttribute('aria-sort') === 'ascending'`, `${jp} sorted`);
    const asc = (await p.ev(rows(PAGE.card(jp)))).map((r) => r[0]);
    assert.deepEqual(asc, [...before].sort((a, b) => a.localeCompare(b)), `${jp}: sorted by its first column`);
    await click(sel);
    await soon(`${PAGE.card(jp)}.querySelector('th:nth-child(1)').getAttribute('aria-sort') === 'descending'`, `${jp} sorted the other way`);
    assert.deepEqual((await p.ev(rows(PAGE.card(jp)))).map((r) => r[0]), [...asc].reverse());
  }
  await click('#jobs .card[data-jp="jobs"] th:nth-child(6) button.sort');
  await soon(`${JOBS}.querySelector('th:nth-child(6)').getAttribute('aria-sort') === 'ascending'`, 'Jobs sorted by fails in a row');
  const fails = (await p.ev(rows(JOBS))).map((r) => Number(r[5]));
  assert.deepEqual(fails, [...fails].sort((a, b) => a - b), `as numbers: ${J(fails)}`);
  assert.equal(fails[fails.length - 1], 25);
  // every row opens its peek: a job, a job a signal is about, a built-in, a proposed job's question
  const rowOf = (jp, text) => p.ev(`[...${PAGE.card(jp)}.querySelectorAll('tbody tr[data-row]')].findIndex((tr) => tr.cells[0].textContent.trim() === ${J(text)})`);
  const openRow = async (jp, text) => {
    const k = await rowOf(jp, text);
    assert.ok(k >= 0, `${jp}: a row ${text}`);
    await click(`#jobs .card[data-jp="${jp}"] tbody tr:nth-child(${k + 1}) td:nth-child(2)`);
  };
  await openRow('jobs', 'Main builds and its tests pass');
  await soon(peekOpen('recurring', 'ci-main'), 'ci-main\'s peek from its Jobs row');
  assert.equal(await p.ev('location.hash'), '#recurring/ci-main');
  assert.equal(await p.ev(PAGE.on), true, 'over the Jobs page');
  await p.ev('history.back(); void 0');
  await soon(`location.hash.startsWith('#jobs') && ${peekClosed} && ${PAGE.on}`, 'Back to the Jobs page');
  await soon(withRows('noticed'), 'the noticed rows');
  await p.ev(`(() => { const tr = [...${NOT}.querySelectorAll('tbody tr[data-row]')].find((x) => x.cells[0].textContent.trim() === 'The end-to-end suite passes'); window.__k = [...tr.parentNode.children].indexOf(tr); })(); void 0`);
  await click(`#jobs .card[data-jp="noticed"] tbody tr:nth-child(${(await p.ev('window.__k')) + 1}) td:nth-child(3)`);
  await soon(peekOpen('recurring', 'nightly-e2e'), 'nightly-e2e\'s peek from its signal\'s row');
  await p.ev('history.back(); void 0');
  await soon(`${peekClosed} && ${PAGE.on} && ${withRows('builtin')}`, 'Back to the Jobs page');
  await openRow('builtin', 'Retro');
  await soon(peekOpen('builtin', 'retro'), 'the retro\'s peek from its Built in row');
  assert.equal(await p.ev('location.hash'), '#builtin/retro');
  await p.ev('history.back(); void 0');
  await soon(`${peekClosed} && ${PAGE.on} && ${withRows('proposals')}`, 'Back to the Jobs page');
  // an open question's row: its card in the Inbox, as every open question's link does
  await openRow('proposals', 'The bundle stays under 300 kB');
  await soon(`/[?&]th=inbox/.test(location.hash) && document.getElementById('drawer').hidden && !!document.getElementById(${J(`q-${fx.ids.open}`)})`, 'the open question\'s Inbox card');
  // a Yes still landing: the question's read-only peek
  await go('#jobs');
  await soon(jobsReady(withRows('proposals')), 'the Jobs page');
  await openRow('proposals', 'Stale issues are closed');
  await soon(`DRAWER.kind === 'q' && DRAWER.id === ${J(fx.ids.registering)} && !document.getElementById('drawer').hidden`, 'the answered question\'s peek');
  assert.equal(await p.ev('location.hash'), `#q/${encodeURIComponent(fx.ids.registering)}`);
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('Upkeep\'s peek: its Jobs section\'s head has an All jobs link that opens #jobs (done-when 5)', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go, click } = await openOn(t, { rec: 'fixture' });
  await go('#goal/upkeep');
  const LINK = '#drawer-body [data-gp="jobs"] > .card-head a[href="#jobs"]';
  await soon(`DRAWER.kind === 'goal' && !document.getElementById('drawer').hidden && ${AT_REST} && !!document.querySelector(${J(LINK)})`, 'Upkeep\'s peek with All jobs');
  assert.equal(await p.ev(`document.querySelector(${J(LINK)}).textContent.trim()`), 'All jobs');
  // the section is still kit-166's: its head says Jobs and its table is there
  assert.equal(await p.ev("[...document.querySelector('#drawer-body [data-gp=\"jobs\"] > .card-head').childNodes].filter((n) => n.nodeType === 3 || n.classList?.contains('grow')).map((n) => n.textContent).join('').replace('All jobs', '').trim()"), 'Jobs');
  assert.equal(await p.ev("!!document.querySelector('#drawer-body [data-gp=\"jobs\"] [data-tbl] table.db-t')"), true);
  await click(LINK);
  await soon(`location.hash === '#jobs' && ${PAGE.on} && ${peekClosed}`, 'All jobs opens the Jobs page');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('with no jobs the page shows Built in, its Jobs table says None, and What the loop noticed has no rows (done-when 6)', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go } = await openOn(t, { rec: (r) => ({ entries: [], builtin: r.builtin, proposals: [] }) });
  await go('#jobs');
  await soon(jobsReady(withRows('builtin')), 'the Jobs page with Built in');
  assert.deepEqual((await p.ev(PAGE.cards)).map((c) => c.jp), ['jobs', 'noticed', 'builtin', 'proposals'], 'the four cards still');
  assert.equal(await p.ev(NONE_ROW('jobs')), 'None', 'the Jobs table says no jobs are registered: its None row');
  assert.equal(await p.ev(`${PAGE.card('jobs')}.querySelectorAll('tr[data-row]').length`), 0, 'no job rows');
  assert.deepEqual(await p.ev(rows(PAGE.card('noticed'))), [], 'no What the loop noticed rows');
  assert.deepEqual((await p.ev(rows(PAGE.card('builtin')))).map((r) => r[0]), ['Retro', 'Research', 'Kit sync', 'Sensors'], 'Built in shows');
  assert.deepEqual(await p.ev(rows(PAGE.card('proposals'))), []);
  // and with no upkeep.recurring at all (a server before kit-168): the same cards, Built in empty, nothing breaks
  await p.ev('window.__rec = undefined; void 0');
  await soon(`!DATA.upkeep?.recurring && !${withRows('builtin')}`, 'no jobs data');
  assert.deepEqual((await p.ev(PAGE.cards)).map((c) => c.jp), ['jobs', 'noticed', 'builtin', 'proposals']);
  assert.equal(await p.ev(NONE_ROW('jobs')), 'None', 'the Jobs table says no jobs are registered: its None row');
  assert.deepEqual(await p.ev(rows(PAGE.card('noticed'))), []);
  assert.equal(await p.ev(`${NAV}.textContent.trim()`), '');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('the page reads only upkeep.recurring and adds no field; text from the data that holds HTML is shown as text (done-when 7)', { ...CHROME, timeout: 300000 }, async (t) => {
  // reads: renderJobs and every helper it adds reach /api/data only through kit-166's recData (upkeep.recurring)
  const i = INDEX.indexOf('\nfunction renderJobs(');
  assert.ok(i >= 0, 'a top-level function renderJobs');
  const fn = INDEX.slice(i, INDEX.indexOf('\n}\n', i));
  assert.match(fn, /\brecList\(|\brecProposals\(/, 'renderJobs reads through kit-166\'s recList');
  assert.doesNotMatch(fn, /\bDATA\b|\bd(\?\.|\.|\[)/, 'and nothing else of the data');
  // render() hands it nothing to read but what recData reads
  const r = INDEX.indexOf('\nfunction render(d)');
  assert.match(INDEX.slice(r, INDEX.indexOf('\n}\n', r)), /\n {2}renderJobs\(\);/, 'render() calls renderJobs()');
  // adds no field: held by touches (docs/devteam/scripts/devteam.mjs, which builds /api/data, is not in them), not here
  const BAD = '<img src=x onerror="window.__xss=1"><b id="xss">bold</b>';
  const { p, soon, go } = await openOn(t, { rec: (x) => { x.entries[0].title = BAD; x.entries[0].signals[0].text = BAD; x.entries[0].signals[0].may = BAD; x.entries[0].signals[1].kind = BAD; x.entries[1].last.status = BAD; x.builtin[0].name = BAD; x.proposals[0].title = BAD; return x; } });
  await go('#jobs');
  await soon(jobsReady(`${withRows('jobs')} && ${withRows('noticed')} && ${withRows('proposals')}`), 'the Jobs page');
  assert.equal(await p.ev("document.querySelectorAll('#jobs #xss, #jobs img[src=\"x\"]').length"), 0, 'nothing drawn from the data');
  assert.equal(await p.ev('window.__xss'), undefined, 'nothing ran');
  const jr = await p.ev(rows(PAGE.card('jobs')));
  assert.equal(jr[0][0], BAD, 'a job\'s title as text');
  assert.match(jr[1][3], new RegExp(`^${BAD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `), 'a run\'s unknown status as text');
  assert.ok(jr[0][6].includes(BAD), 'an unknown signal\'s kind as text');
  const nr = await p.ev(rows(PAGE.card('noticed')));
  assert.deepEqual(nr[0].slice(1), ['erroring', BAD, BAD], 'a signal\'s text and what it may propose as text');
  assert.equal(nr[1][1], BAD);
  assert.equal((await p.ev(rows(PAGE.card('builtin'))))[0][0], BAD, 'an unknown built-in\'s name as text');
  assert.equal((await p.ev(rows(PAGE.card('proposals'))))[0][0], BAD, 'a proposal\'s title as text');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('the measure test lists the Jobs page; no label it draws says recurring (done-when 8)', { ...CHROME, timeout: 300000 }, async (t) => {
  // the measure test's JOBS_PAGES has #jobs on the jobs fixture (it runs every entry at 1440x900, 720x800, 390x844)
  const src = fs.readFileSync(path.join(here, 'dashboard-measure.test.mjs'), 'utf8');
  const a = src.indexOf('\nconst JOBS_PAGES = ');
  assert.ok(a >= 0, 'a top-level JOBS_PAGES');
  const body = src.slice(a, src.indexOf('\n].map(', a));
  assert.match(body, /\['#jobs', /, 'JOBS_PAGES has #jobs');
  // every label the page draws: its title, its nav item, card heads, table headers; and every text on it
  const { p, soon, go } = await openOn(t, { rec: 'fixture' });
  await go('#jobs');
  await soon(jobsReady(`${withRows('jobs')} && ${withRows('noticed')}`), 'the Jobs page');
  const labels = await p.ev("[...document.querySelectorAll('#page-title, .side a[href=\"#jobs\"], #jobs .card-head, #jobs th')].map((x) => x.textContent.trim())");
  for (const l of ['Jobs', 'What the loop noticed', 'Built in', 'Proposed jobs', 'Fails in a row', 'Noticed']) assert.ok(labels.some((x) => x.startsWith(l)), `a label ${l}: ${J(labels)}`);
  assert.deepEqual(labels.filter((l) => /recurring/i.test(l)), [], 'no label says recurring');
  assert.doesNotMatch(await p.ev("document.getElementById('jobs').textContent"), /recurring/i, 'no text on the page says recurring');
  assert.deepEqual(await p.ev('window.__errors'), []);
});
