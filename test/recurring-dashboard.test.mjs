// Upkeep's jobs on the dashboard (kit-166): Upkeep's peek gains Jobs and Proposed jobs computed rows and
// three sections (Jobs, Built in, Proposed jobs) through kit-90's goal-peek block; a Jobs row opens the
// job's peek (#recurring/<name>), a Built in row its peek (#builtin/<name>), a Proposed jobs row its
// question. Driven in real headless Chrome over a real dashboard on a bare project; /api/data's
// upkeep.recurring is test/fixtures/recurring/dashboard.json and /api/peek?kind=recurring answers from
// test/fixtures/recurring/peek.json (kit-161's fixtures; kit-168 builds the real ones and matches them).
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
// them in the page and the next poll draws it), /api/peek?kind=recurring from window.__peeks (404 for a name
// it hasn't), the 10 s poll every 300 ms, and every page error in window.__errors.
const initScript = (rec, peeks, qs = { open: [], answered: [] }) => `(() => {
  const si = window.setInterval;
  window.setInterval = (f, ms, ...a) => si(f, ms === 10000 ? 300 : ms, ...a);
  window.__rec = ${J(rec)};
  window.__peeks = ${J(peeks)};
  window.__qs = ${J(qs)};
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
    const ids = new Set([...window.__qs.open, ...window.__qs.answered].map((q) => q.id));
    d.questions = [...(d.questions || []).filter((q) => !ids.has(q.id)), ...window.__qs.open];
    d.ooda = { ...(d.ooda || {}), answered: [...((d.ooda && d.ooda.answered) || []).filter((q) => !ids.has(q.id)), ...window.__qs.answered] };
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
  const root = bareProject(base, 'jobs');
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 61), DEVTEAM_PORT_BASE: String(PORTS + 62), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
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

// The dashboard on the fixture and Chrome on it: { p, soon, go }. go(hash) loads a fresh document at that head.
async function openOn(t, { rec, peeks = clone(PEEK_FX), width = 1440, height = 900 }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-jobs-'));
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
  // the page's CDN stylesheets block its own script until they answer: a slow CDN is not what is tested (kit-855)
  await p.send('Network.enable');
  await p.send('Network.setBlockedURLs', { urls: ['https://fonts.googleapis.com/*', 'https://cdn.jsdelivr.net/npm/lucide-static*'] });
  await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const r = rec === undefined ? undefined : rec === 'fixture' ? fx.rec : rec(fx.rec);
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: initScript(r, peeks, { open: [], answered: [] }) });
  const soon = soonIn(p);
  const go = async (hash) => {
    await p.send('Page.navigate', { url: 'about:blank' });
    await soon("location.href === 'about:blank'", 'about:blank');
    await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/${hash}` });
    await soon("!document.querySelector('main.waiting') && typeof DATA !== 'undefined' && !!DATA", 'the page with its data');
  };
  const click = async (sel) => {
    await p.ev(`(() => { document.querySelector(${J(sel)}).scrollIntoView({ block: 'center', behavior: 'instant' }); })(); new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    await p.click(sel);
  };
  const change = async (js, has, hash, ready) => {
    await p.ev(`${js}; void 0`);
    await soon(has, 'the page\'s data has the change');
    await p.ev("location.hash = '#board'; void 0");
    await soon("!document.body.classList.contains('peek-open')", 'the peek closed');
    await p.ev(`location.hash = ${J(hash)}; void 0`);
    await soon(ready, `${hash} again`);
  };
  return { p, soon, go, fx, click, change };
}
// a job's row as the page has it
const DROW = (name) => `DATA.upkeep.recurring.entries.find((e) => e.name === ${J(name)})`;

// What the open peek shows, read in the page
const PEEK = {
  keys: "[...(document.querySelector('#drawer-body section.attrs > dl.props')?.children ?? [])].filter((x) => x.tagName === 'DT').map((x) => x.textContent.trim())",
  computed: "(() => { const h = document.querySelector('#drawer-body section.attrs > h4.attrs-h'); const dl = h && h.nextElementSibling; return dl ? [...dl.children].filter((x) => x.tagName === 'DT').map((x) => x.textContent.trim()) : []; })()",
  // a property's value (the first dl's, else the Computed one's), by its key
  dd: (k) => `(() => { for (const dl of document.querySelectorAll('#drawer-body section.attrs > dl.props')) for (const dt of dl.children) if (dt.tagName === 'DT' && dt.textContent.trim() === ${J(k)}) return dt.nextElementSibling; return null; })()`,
  sects: "[...document.querySelectorAll('#drawer-body > .card.psect')].map((c) => ({ gp: c.dataset.gp || null, head: (() => { const h = c.querySelector(':scope > .card-head')?.cloneNode(true); for (const a of h?.querySelectorAll('a') ?? []) a.remove(); return h?.textContent.trim(); })() }))",
  sect: (head) => `[...document.querySelectorAll('#drawer-body > .card.psect')].find((c) => { const h = c.querySelector(':scope > .card-head')?.cloneNode(true); for (const a of h?.querySelectorAll('a') ?? []) a.remove(); return h?.textContent.trim() === ${J(head)}; })`,
  type: "document.querySelector('#drawer-bar-title .dtype .badge')?.textContent.trim()",
  title: "document.querySelector('#drawer-bar-title .dtitle')?.textContent.trim()",
};
// counts the drawer body's rewrites from now (showDrawer sets its innerHTML once a draw)
const WATCH = "window.__writes = 0; window.__wo?.disconnect(); window.__wo = new MutationObserver((ms) => { for (const m of ms) if (m.target.id === 'drawer-body' && m.addedNodes.length) window.__writes++; }); window.__wo.observe(document.getElementById('drawer-body'), { childList: true }); void 0";
const heads = (sect) => `[...(${sect})?.querySelectorAll('table.db-t thead th') ?? []].map((th) => th.textContent.replace(/ [↑↓]$/, '').trim())`;
const rows = (sect) => `[...(${sect})?.querySelectorAll('table.db-t tbody tr[data-row]') ?? []].map((tr) => [...tr.cells].map((td) => td.textContent.trim()))`;
const AT_REST = "getComputedStyle(document.getElementById('drawer')).transform === 'none'";
const upkeepReady = (more = 'true') => `location.hash.startsWith('#goal/upkeep') && DRAWER.kind === 'goal' && !document.getElementById('drawer').hidden && ${AT_REST} && ${PEEK.keys}.includes('What it covers') && (${more})`;
const jobReady = (name, more = 'true') => `DRAWER.kind === 'recurring' && DRAWER.id === ${J(name)} && !document.getElementById('drawer').hidden && ${AT_REST} && !!${PEEK.sect('Recent runs')} && !${PEEK.sect('Recent runs')}.querySelector('.loading') && (${more})`;

test('the goal-peek block names the jobs sections, and openUpkeep draws none of them itself (done-when 7)', () => {
  const a = INDEX.indexOf('/* goal-peek start */'), b = INDEX.indexOf('/* goal-peek end */');
  assert.ok(a >= 0 && b > a, 'the goal-peek block');
  const block = INDEX.slice(a, b);
  assert.match(block, /upkeep: \['heartbeat', 'chores', 'jobs', 'builtin', 'proposals'\]/, 'GOAL_PEEK.upkeep lists the three after kit-90\'s two');
  for (const id of ['jobs', 'builtin', 'proposals']) assert.match(block, new RegExp(`\\n  ${id}: \\(g, c\\) =>`), `GOAL_PEEK_SECTIONS.${id} is in the block`);
  for (const w of ["'Jobs'", "'Built in'", "'Proposed jobs'"]) assert.ok(block.includes(w), `${w} is drawn in the block`);
  // openUpkeep and openGoal: none of the three sections' titles, and no table of their rows
  const fn = (name) => { const i = INDEX.indexOf(`function ${name}(`); return INDEX.slice(i, INDEX.indexOf('\n}\n', i)); };
  for (const name of ['openUpkeep', 'openGoal']) for (const w of ['Built in', 'Proposed jobs', 'pageTable', 'recurring']) assert.ok(!fn(name).includes(w), `${name} has no ${w}`);
});

test('Upkeep\'s peek: Jobs and Proposed jobs computed rows, then Jobs, Built in and Proposed jobs sections; its card unchanged (done-whens 2, 10)', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go, click, change } = await openOn(t, { rec: 'fixture' });
  // the card first, with and without the jobs data: the same
  await go('#goals');
  const CARD = "document.querySelector('#goals .card.goal.upkeep')";
  await soon(`!!${CARD} && !!DATA.upkeep.recurring`, 'Upkeep\'s card with the jobs data');
  const withJobs = await p.ev(`${CARD}.outerHTML`);
  await p.ev('window.__rec = undefined; void 0');
  await soon('!DATA.upkeep.recurring', 'the data without jobs');
  await soon(`${CARD}.outerHTML !== '' && !!${CARD}`, 'the card');
  assert.equal(await p.ev(`${CARD}.outerHTML`), withJobs, 'Upkeep\'s card is unchanged by its jobs');
  assert.doesNotMatch(withJobs, /\bjobs?\b|Built in|Proposed/i, 'and draws none of them');

  await go('#goal/upkeep');
  await soon(upkeepReady(`!!${PEEK.sect('Jobs')}`), 'Upkeep\'s peek with its jobs');
  assert.deepEqual(await p.ev(PEEK.computed), ['Jobs', 'Proposed jobs'], 'the computed rows');
  assert.equal(await p.ev(`${PEEK.dd('Jobs')}.textContent.trim()`), '9 registered · 2 failing · 2 due');
  assert.equal(await p.ev(`${PEEK.dd('Proposed jobs')}.textContent.trim()`), '1 waiting on you · 1 being registered · 1 being stopped');
  const sects = await p.ev(PEEK.sects);
  assert.deepEqual(sects.map((s) => s.gp), ['heartbeat', 'jobs', 'builtin', 'proposals'].filter((id) => id !== 'heartbeat' || sects.some((s) => s.gp === 'heartbeat')), `the sections after the properties, in order: ${J(sects)}`);
  assert.deepEqual(sects.filter((s) => ['jobs', 'builtin', 'proposals'].includes(s.gp)).map((s) => s.head), ['Jobs', 'Built in', 'Proposed jobs']);
  // Jobs: a record table, job, kind, every, last run (a result badge and a time), next, a row per entry
  const JOBS = PEEK.sect('Jobs');
  assert.deepEqual(await p.ev(heads(JOBS)), ['Job', 'Kind', 'Every', 'Last run', 'Next']);
  const jr = await p.ev(rows(JOBS));
  assert.deepEqual(jr.map((r) => r[0]), DASH.entries.map((e) => e.title), 'a row per job, in the data\'s order');
  assert.deepEqual(jr.map((r) => r[1]), ['check', 'check', 'check', 'check', 'check', 'chore, by a worker', 'chore, by the supervisor', 'chore, by the supervisor', 'chore, by the supervisor']);
  assert.deepEqual(jr.slice(0, 3).map((r) => r[2]), ['6 hours', 'day at 02:00 UTC', 'day at 06:00 UTC']);
  assert.equal(await p.ev(`${JOBS}.querySelectorAll('tbody tr[data-row] td:nth-child(4) .badge').length`), 8, 'a result badge on every job that has run (smoke-prod has not)');
  assert.match(jr[0][3], /^error /, 'ci-main\'s last run: error and its time');
  assert.equal(jr[4][3], 'not run yet');
  assert.equal(jr[8][4], 'waits for Upkeep', 'a held chore waits for Upkeep');
  // Built in, the kit's four
  const BI = PEEK.sect('Built in');
  assert.deepEqual(await p.ev(heads(BI)), ['Job', 'Every', 'Last', 'Next']);
  assert.deepEqual((await p.ev(rows(BI))).map((r) => r[0]), ['Retro', 'Research', 'Kit sync', 'Sensors']);
  // Proposed jobs
  const PJ = PEEK.sect('Proposed jobs');
  assert.deepEqual(await p.ev(heads(PJ)), ['Proposed job', 'Status', 'Asked']);
  assert.deepEqual((await p.ev(rows(PJ))).map((r) => r.slice(0, 2)), [['The bundle stays under 300 kB', 'waiting on you'], ['Stale issues are closed', 'you said Yes · being registered'], ['The weekly report is sent', 'you said Yes · being stopped']]);
  // the shell's parts (done-when 10): section cards with a head, record tables in a data-tbl wrapper, the properties table
  for (const s of ['Jobs', 'Built in', 'Proposed jobs']) assert.equal(await p.ev(`(() => { const c = ${PEEK.sect(s)}; return !!c.querySelector(':scope > .card-head') && !!c.querySelector(':scope > .psect-body [data-tbl] > table.db-t'); })()`), true, `${s}: a section card with a record table`);
  assert.equal(await p.ev("document.querySelectorAll('#drawer-body section.attrs > dl.props').length"), 2, 'the properties and the Computed block are the shell\'s props');
  // sortable: Job's header sorts the rows, again reverses them
  await p.ev(WATCH);
  await click(`#drawer-body [data-gp="jobs"] th:nth-child(1) button.sort`);
  await soon(`${heads(JOBS)}.length && ${JOBS}.querySelector('th:nth-child(1)').getAttribute('aria-sort') === 'ascending'`, 'Jobs sorted by job');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await p.ev('window.__writes'), 1, 'one click sorts once: one redraw');
  const sorted = (await p.ev(rows(JOBS))).map((r) => r[0]);
  assert.deepEqual(sorted, [...DASH.entries.map((e) => e.title)].sort((a, b) => a.localeCompare(b)), 'sorted by job');
  await click(`#drawer-body [data-gp="jobs"] th:nth-child(1) button.sort`);
  await soon(`${JOBS}.querySelector('th:nth-child(1)').getAttribute('aria-sort') === 'descending'`, 'Jobs sorted the other way');
  assert.deepEqual((await p.ev(rows(JOBS))).map((r) => r[0]), [...sorted].reverse());
  // a row opens its record: the job's peek
  await click(`#drawer-body [data-gp="jobs"] tbody tr[data-row="0"] td:nth-child(2)`);
  await soon(jobReady('ci-main'), 'ci-main\'s peek from its row');
  assert.equal(await p.ev('location.hash'), '#recurring/ci-main');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a Built in row opens its peek; a job\'s peek has ID recurring.<name>; a proposal opens its question (done-when 3)', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go, fx, click } = await openOn(t, { rec: (r) => { r.proposals.push({ qid: 'q-20261116-000000000', name: 'old-no', title: 'An answered No', asked_at: '2026-11-16T10:00:00Z', status: 'declined' }); return r; } });
  await go('#goal/upkeep');
  await soon(upkeepReady(`!!${PEEK.sect('Built in')}`), 'Upkeep\'s peek');
  await click(`#drawer-body [data-gp="builtin"] tbody tr[data-row="0"] td:nth-child(1)`);
  await soon(`DRAWER.kind === 'builtin' && DRAWER.id === 'retro' && ${PEEK.keys}.includes('What it does')`, 'the retro\'s peek');
  assert.equal(await p.ev('location.hash'), '#builtin/retro');
  assert.equal(await p.ev(PEEK.type), 'Built in');
  assert.deepEqual(await p.ev(PEEK.keys), ['ID', 'Title', 'What it does', 'Every', 'Set by', 'Goal', 'How it changes']);
  assert.equal(await p.ev(`${PEEK.dd('ID')}.textContent.trim()`), 'builtin.retro');
  assert.equal(await p.ev(`${PEEK.dd('What it does')}.textContent.trim()`), 'A look back over the last two weeks.');
  assert.equal(await p.ev(`${PEEK.dd('Every')}.textContent.trim()`), 'every 14 days');
  assert.equal(await p.ev(`${PEEK.dd('Set by')}.textContent.trim()`), 'retro_every_days: 14');
  assert.deepEqual(await p.ev(PEEK.computed), ['Last', 'Next']);
  assert.deepEqual(await p.ev(`[${PEEK.dd('Last')}.textContent.trim(), ${PEEK.dd('Next')}.textContent.trim()]`), await p.ev(`[when(${J(DASH.builtin[0].last_at)}), when(${J(DASH.builtin[0].next_at)})]`));
  // Sensors' peek points to the Sensors page
  await go('#builtin/sensors');
  await soon(`DRAWER.kind === 'builtin' && ${PEEK.keys}.includes('Set by')`, 'the sensors\' peek');
  assert.equal(await p.ev(`${PEEK.dd('Set by')}.querySelector('a')?.getAttribute('href')`), '#sensors');
  // a job's peek: its ID
  await go('#recurring/ci-main');
  await soon(jobReady('ci-main'), 'ci-main\'s peek');
  assert.equal(await p.ev(`${PEEK.dd('ID')}.textContent.trim()`), 'recurring.ci-main');
  assert.equal(await p.ev(PEEK.type), 'Job');
  // Proposed jobs: an answered No (or any status but open, registering, stopping) is not listed
  await go('#goal/upkeep');
  await soon(upkeepReady(`!!${PEEK.sect('Proposed jobs')}`), 'Upkeep\'s peek');
  assert.deepEqual((await p.ev(rows(PEEK.sect('Proposed jobs')))).map((r) => r[0]), ['The bundle stays under 300 kB', 'Stale issues are closed', 'The weekly report is sent'], 'the declined one is not listed');
  // an open question's row: the question's side peek, with its card, as every open question's link does
  await click(`#drawer-body [data-gp="proposals"] tbody tr[data-row="0"] td:nth-child(1)`);
  await soon(`DRAWER.kind === 'q' && DRAWER.id === ${J(fx.ids.open)} && !document.getElementById('drawer').hidden && !!document.querySelector(${J(`#drawer-body [id="p-q-${fx.ids.open}"]`)})`, 'the open question\'s peek');
  // a Yes still landing: the question's read-only peek
  await go('#goal/upkeep');
  await soon(upkeepReady(`!!${PEEK.sect('Proposed jobs')}`), 'Upkeep\'s peek');
  await click(`#drawer-body [data-gp="proposals"] tbody tr[data-row="1"] td:nth-child(1)`);
  await soon(`DRAWER.kind === 'q' && DRAWER.id === ${J(fx.ids.registering)} && !document.getElementById('drawer').hidden`, 'the answered question\'s peek');
  assert.equal(await p.ev(`location.hash`), `#q/${encodeURIComponent(fx.ids.registering)}`);
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('with no jobs, Upkeep\'s peek has no Jobs or Proposed jobs rows or sections, and Built in still shows (done-when 4)', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go, click, change } = await openOn(t, { rec: (r) => ({ entries: [], builtin: r.builtin, proposals: [] }) });
  await go('#goal/upkeep');
  await soon(upkeepReady(`!!${PEEK.sect('Built in')}`), 'Upkeep\'s peek with Built in');
  assert.deepEqual(await p.ev(PEEK.computed), [], 'no computed rows');
  const gps = (await p.ev(PEEK.sects)).map((s) => s.gp);
  assert.ok(!gps.includes('jobs') && !gps.includes('proposals'), `no Jobs or Proposed jobs: ${J(gps)}`);
  assert.ok(gps.includes('builtin'));
  // and with no upkeep.recurring at all (a server before kit-168): none of the three, and nothing breaks
  await p.ev('window.__rec = undefined; void 0');
  await soon(`!DATA.upkeep.recurring && !${PEEK.sect('Built in')}`, 'no jobs data');
  assert.deepEqual(await p.ev(PEEK.computed), []);
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a job\'s peek: properties, computed rows, Being fixed, Recent runs; no control; running text within --measure (done-when 5)', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go, click, change } = await openOn(t, { rec: 'fixture' });
  await go('#recurring/ci-main');
  await soon(jobReady('ci-main'), 'ci-main\'s peek');
  assert.equal(await p.ev(PEEK.title), 'Main builds and its tests pass');
  for (const [k, v] of [['Kind', 'check'], ['Every', 'every 6 hours'], ['Runs as', 'a command that only looks, in a clean checkout of main'], ['Failing means', 'it exits with an error; a timeout, or a command that can’t be run, is an error']]) assert.equal(await p.ev(`${PEEK.dd(k)}.textContent.trim()`), v, k);
  assert.deepEqual(await p.ev(PEEK.keys), ['ID', 'Title', 'Kind', 'Every', 'Runs', 'Runs as', 'Failing means', 'Registered by', 'Goal', 'How it changes']);
  assert.equal(await p.ev(`${PEEK.dd('Runs')}.textContent.trim()`), 'npm ci && npm test');
  assert.equal(await p.ev(`${PEEK.dd('Goal')}.querySelector('a').getAttribute('href')`), '#goal/upkeep');
  assert.equal(await p.ev(`${PEEK.dd('Registered by')}.querySelector('a').getAttribute('href')`), '#q/q-20261101-090000000');
  assert.deepEqual(await p.ev(PEEK.computed), ['Last run', 'Next', 'Fails in a row']);
  assert.match(await p.ev(`${PEEK.dd('Last run')}.textContent.trim()`), /^error /);
  assert.equal(await p.ev(`${PEEK.dd('Fails in a row')}.textContent.trim()`), '3');
  // the sections: Being fixed (a chore fixes this failing check), What the loop noticed, Recent runs
  assert.deepEqual((await p.ev(PEEK.sects)).map((s) => s.head), ['Being fixed', 'What the loop noticed', 'Recent runs']);
  assert.match(await p.ev(`${PEEK.sect('Being fixed')}.textContent`), /ci-04-fix-ci-main/);
  const RR = PEEK.sect('Recent runs');
  assert.deepEqual(await p.ev(heads(RR)), ['Result', 'When', 'Took', 'What it printed (shown as data)']);
  const rr = await p.ev(rows(RR));
  assert.equal(rr.length, PEEK_FX['ci-main'].runs.length, 'a row per run');
  assert.deepEqual(rr.map((r) => r[3]), PEEK_FX['ci-main'].runs.map((x) => x.excerpt));
  assert.deepEqual(rr.slice(0, 2).map((r) => r[0]), ['error', 'failed']);
  await p.ev(WATCH);
  await click(`#drawer-body .card.psect:last-of-type th:nth-child(3) button.sort`);
  await soon(`${RR}.querySelector('th:nth-child(3)').getAttribute('aria-sort') === 'ascending'`, 'Recent runs sorted by took, ascending');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await p.ev('window.__writes'), 1, 'one click sorts once: one redraw');
  const took = (await p.ev(rows(RR))).map((r) => r[2]);
  assert.deepEqual(took, [...rr.map((r) => r[2])].sort((a, b) => parseFloat(a) * (/min/.test(a) ? 60 : 1) - parseFloat(b) * (/min/.test(b) ? 60 : 1)), 'sorted by how long it took');
  await click(`#drawer-body .card.psect:last-of-type th:nth-child(3) button.sort`);
  await soon(`${RR}.querySelector('th:nth-child(3)').getAttribute('aria-sort') === 'descending'`, 'and back, descending');
  // no control but the tables' sort headers: no form, input, select, textarea, or other button
  assert.deepEqual(await p.ev(`[...document.querySelectorAll('#drawer-body button:not(.sort), #drawer-body form, #drawer-body input, #drawer-body select, #drawer-body textarea')].map((e) => e.outerHTML.slice(0, 80))`), []);
  // Fails in a row is the Jobs page's: the entry's row, not a count of the 20 runs the peek has
  await p.ev("window.__rec.entries.find((e) => e.name === 'ci-main').fails_in_a_row = 25; void 0");
  await soon(`${PEEK.dd('Fails in a row')}?.textContent.trim() === '25'`, 'fails in a row from the entry\'s row');
  // a failing check with no fix chore, and a passing one with a ticket: no Being fixed
  await go('#recurring/nightly-e2e');
  await soon(jobReady('nightly-e2e'), 'nightly-e2e\'s peek');
  assert.deepEqual(await p.ev(`(({ kind, state, ticket }) => ({ kind, state, ticket }))(${DROW('nightly-e2e')})`), { kind: 'check', state: 'failing', ticket: null }, 'nightly-e2e fails and has no fix chore');
  assert.equal(await p.ev(`!!${PEEK.sect('Being fixed')}`), false, 'nightly-e2e: no Being fixed');
  await go('#recurring/lint-docs');
  await soon(jobReady('lint-docs'), 'lint-docs\'s peek');
  await change(`${DROW('lint-docs').replace('DATA.upkeep.recurring', 'window.__rec')}.ticket = 'ci-09-old'`, `${DROW('lint-docs')}?.ticket === 'ci-09-old'`, '#recurring/lint-docs', jobReady('lint-docs'));
  assert.deepEqual(await p.ev(`(({ kind, state, ticket }) => ({ kind, state, ticket }))(${DROW('lint-docs')})`), { kind: 'check', state: 'passing', ticket: 'ci-09-old' }, 'lint-docs passes and has a ticket');
  assert.equal(await p.ev(`!!${PEEK.sect('Being fixed')}`), false, 'lint-docs: no Being fixed');
  // a worker chore: its runs as, failing means, the instructions as running text within --measure
  await go('#recurring/deps-bump');
  await soon(jobReady('deps-bump'), 'deps-bump\'s peek');
  assert.equal(await p.ev(`${PEEK.dd('Kind')}.textContent.trim()`), 'chore, by a worker');
  assert.equal(await p.ev(`${PEEK.dd('Failing means')}.textContent.trim()`), 'not done within 3 days of coming due');
  const w = await p.ev(`(() => { const el = ${PEEK.dd('Runs')}.querySelector('.measure'); let m = null; if (el) { const probe = document.createElement('div'); probe.style.cssText = 'position:absolute;visibility:hidden;width:var(--measure)'; el.append(probe); m = probe.getBoundingClientRect().width; probe.remove(); } return { m, w: el ? el.getBoundingClientRect().width : null, maxw: el ? getComputedStyle(el).maxWidth : null }; })()`);
  assert.ok(w.w !== null && w.w <= w.m + 0.5, `the instructions within --measure: ${J(w)}`);
  assert.ok(Math.abs(parseFloat(w.maxw) - w.m) < 0.5, `running text is capped at the shell's --measure, no cap of its own: ${J(w)}`);
  assert.deepEqual(await p.ev(`[...document.querySelectorAll('#drawer-body th, #drawer-body td, #drawer-body td .cell, #drawer-body dt, #drawer-body dd, #drawer-body .card-head, #drawer-bar-title .dtitle, #drawer-body button')].map((e) => getComputedStyle(e).maxWidth).filter((v) => v !== 'none' && !/%$/.test(v))`), [], 'no cap on cells, labels, titles or controls');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('the job peek renders peek.json; How it changes ends its properties; a held chore waits for Upkeep (done-when 6)', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go, click, change } = await openOn(t, { rec: 'fixture' });
  await go('#recurring/deps-bump');
  await soon(jobReady('deps-bump'), 'deps-bump\'s peek');
  const keys = await p.ev(PEEK.keys);
  assert.equal(keys.at(-1), 'How it changes');
  assert.match(await p.ev(`${PEEK.dd('How it changes')}.textContent.trim()`), /^Shift\+click it .*say so in a thread/);
  assert.match(await p.ev(`${PEEK.dd('Runs')}.textContent`), /Bump every dependency to its newest patch or minor version\./);
  assert.deepEqual((await p.ev(rows(PEEK.sect('Recent runs')))).map((r) => r[0]), ['started', 'nothing to do', 'abandoned', 'done']);
  // started, not held: Next is its time
  assert.equal(await p.ev(`${PEEK.dd('Next')}.textContent.trim() === when(${DROW('deps-bump')}.next_at)`), true, 'deps-bump: Next is its next_at');
  // its row held (Upkeep drained or parked), by name: Next waits
  await p.ev("window.__rec.entries.find((e) => e.name === 'deps-bump').state = 'held'; void 0");
  await soon(`${PEEK.dd('Next')}?.textContent.trim() === 'waits for Upkeep'`, 'waits for Upkeep');
  // a check is never held: a check row's state alone doesn't make it wait
  await go('#recurring/ci-main');
  await soon(jobReady('ci-main'), 'ci-main\'s peek');
  await change("window.__rec.entries.find((e) => e.name === 'ci-main').state = 'held'", `${DROW('ci-main')}?.state === 'held'`, '#recurring/ci-main', jobReady('ci-main'));
  assert.equal(await p.ev(`${PEEK.dd('Next')}.textContent.trim() === when(${DROW('ci-main')}.next_at)`), true, 'a held check: Next is its next_at');
});

test('every label kit-166 draws says job, none says recurring (done-when 8)', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go, click, change } = await openOn(t, { rec: 'fixture' });
  // every label: the type chip, property keys, section heads, table headers, Computed, the computed rows' keys
  const LABELS = `[...document.querySelectorAll('#drawer-bar-title .dtype .badge, #drawer-body dt, #drawer-body .card-head, #drawer-body th, #drawer-body h4')].map((x) => x.textContent.trim())`;
  // every text in the drawer but the ID row's value
  const TEXT = `(() => { const c = document.getElementById('drawer-body').cloneNode(true); for (const dt of c.querySelectorAll('dt')) if (dt.textContent.trim() === 'ID') dt.nextElementSibling.remove(); for (const k of c.querySelectorAll('code')) if (/^[a-z][a-z0-9]*-\\d+-[a-z0-9-]+$/.test(k.textContent.trim())) k.remove(); return document.querySelector('#drawer-bar-title').textContent + ' ' + c.textContent; })()`;
  const seen = [];
  for (const [hash, ready] of [['#goal/upkeep', upkeepReady(`!!${PEEK.sect('Proposed jobs')}`)], ['#recurring/ci-main', jobReady('ci-main')], ['#recurring/deps-bump', jobReady('deps-bump')], ['#builtin/retro', `DRAWER.kind === 'builtin' && ${PEEK.keys}.includes('Set by')`]]) {
    await go(hash);
    await soon(ready, hash);
    const labels = await p.ev(LABELS);
    seen.push(...labels);
    assert.deepEqual(labels.filter((l) => /recurring/i.test(l)), [], `${hash}: no label says recurring`);
    assert.doesNotMatch(await p.ev(TEXT), /recurring/i, `${hash}: no text says recurring but the ID`);
  }
  for (const l of ['Jobs', 'Built in', 'Proposed jobs', 'Job']) assert.ok(seen.includes(l), `a label ${l}`);
});

test('a job\'s peek shows What the loop noticed when its row has signals, before Recent runs (done-when 11)', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go, click, change } = await openOn(t, { rec: 'fixture' });
  await go('#recurring/ci-main');
  await soon(jobReady('ci-main'), 'ci-main\'s peek');
  const sects = (await p.ev(PEEK.sects)).map((s) => s.head);
  assert.ok(sects.indexOf('What the loop noticed') >= 0 && sects.indexOf('What the loop noticed') < sects.indexOf('Recent runs'), `before Recent runs: ${J(sects)}`);
  const N = PEEK.sect('What the loop noticed');
  assert.deepEqual(await p.ev(heads(N)), ['Signal', 'Since', 'What it saw', 'What it may propose']);
  const nr = await p.ev(rows(N));
  assert.deepEqual(nr.map((r) => r[0]), ['erroring', 'flapping']);
  assert.deepEqual(nr.map((r) => r[2]), DASH.entries[0].signals.map((s) => s.text));
  assert.deepEqual(nr.map((r) => r[3]), DASH.entries[0].signals.map((s) => s.may));
  // deps-bump: overdue, in words
  await go('#recurring/deps-bump');
  await soon(jobReady('deps-bump'), 'deps-bump\'s peek');
  assert.deepEqual((await p.ev(rows(PEEK.sect('What the loop noticed')))).map((r) => r[0]), ['often late']);
  // none: no section
  await p.ev("window.__rec.entries.find((e) => e.name === 'deps-bump').signals = []; void 0");
  await soon(`!${PEEK.sect('What the loop noticed')}`, 'no signals, no section');
});

test('text from the data that holds HTML is shown as text, never drawn (done-when 12)', { ...CHROME, timeout: 300000 }, async (t) => {
  const BAD = '<img src=x onerror="window.__xss=1"><b id="xss">bold</b>';
  const peeks = clone(PEEK_FX);
  peeks['ci-main'].runs[0].excerpt = BAD;
  peeks['ci-main'].entry.run = BAD;
  peeks['ci-main'].entry.title = BAD;
  peeks['deps-bump'].entry.prompt = BAD;
  const { p, soon, go, click, change } = await openOn(t, { peeks, rec: (r) => { r.entries[0].title = BAD; r.entries[0].signals[0].text = BAD; r.entries[0].signals[0].may = BAD; r.builtin[0].note = BAD; r.proposals[0].title = BAD; return r; } });
  const clean = async (where) => {
    assert.equal(await p.ev("document.querySelectorAll('#drawer #xss, #drawer img[src=\"x\"]').length"), 0, `${where}: nothing drawn from the data`);
    assert.equal(await p.ev('window.__xss'), undefined, `${where}: nothing ran`);
  };
  await go('#goal/upkeep');
  await soon(upkeepReady(`!!${PEEK.sect('Proposed jobs')}`), 'Upkeep\'s peek');
  await clean('Upkeep\'s peek');
  assert.ok((await p.ev(rows(PEEK.sect('Jobs'))))[0][0] === BAD && (await p.ev(rows(PEEK.sect('Proposed jobs'))))[0][0] === BAD, 'the titles as text');
  await go('#recurring/ci-main');
  await soon(jobReady('ci-main'), 'ci-main\'s peek');
  await clean('ci-main\'s peek');
  assert.equal((await p.ev(rows(PEEK.sect('Recent runs'))))[0][3], BAD, 'the run\'s output as text');
  assert.equal(await p.ev(`${PEEK.dd('Runs')}.textContent.trim()`), BAD);
  assert.equal(await p.ev(PEEK.title), BAD);
  await go('#recurring/deps-bump');
  await soon(jobReady('deps-bump'), 'deps-bump\'s peek');
  await clean('deps-bump\'s peek');
  await go('#builtin/retro');
  await soon(`DRAWER.kind === 'builtin' && ${PEEK.keys}.includes('What it does')`, 'the retro\'s peek');
  await clean('the retro\'s peek');
  assert.equal(await p.ev(`${PEEK.dd('What it does')}.textContent.trim()`), BAD);
});

test('the measure test lists Upkeep\'s peek with its jobs and a job\'s peek, in JOBS_PAGES spread into PAGES (done-when 9)', () => {
  const src = fs.readFileSync(path.join(here, 'dashboard-measure.test.mjs'), 'utf8');
  const a = src.indexOf('\nconst JOBS_PAGES = ');
  assert.ok(a >= 0, 'a top-level JOBS_PAGES');
  const body = src.slice(a, src.indexOf('\n];', a));
  for (const h of ["'#goal/upkeep'", "'#recurring/ci-main'", "'#recurring/deps-bump'", "'#builtin/retro'"]) assert.ok(body.includes(h), `JOBS_PAGES has ${h}`);
  assert.match(body, /fixtures\/recurring\/dashboard\.json|DASH_FX/, 'measured with the jobs fixture');
  const pages = src.slice(src.indexOf('\nconst PAGES = ['), src.indexOf('\n];', src.indexOf('\nconst PAGES = [')));
  assert.match(pages, /\.\.\.JOBS_PAGES\b/, 'spread into PAGES');
});
