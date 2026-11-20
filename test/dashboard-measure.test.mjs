// The dashboard's pages under the measure check (dashboard-shell@1, test/contracts/shell.md §9):
// each page in PAGES must measure clean at 1440x900, 720x800 and 390x844. The list is added to only
// by the index.html tickets, each with its own pages, peeks and threads; until the first adds one, a
// smoke run proves the plumbing on today's Overview without judging it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as lib from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { SIZES, measureAt } from './lib/measure.mjs';

// { hash, ready?, opts?, init? }: the page's head, what must be true before it is measured, measure
// options, and a script run in each load before the page's own (Page.addScriptToEvaluateOnNewDocument),
// so a page is measured with the data it draws, not its empty state
const READY = "!document.querySelector('main.waiting')";
// kit-90: Overview, the three Goals tabs, a goal's peek over Goals and Upkeep's. A peek's top-right
// button moves left of the peek on purpose (dashboard-peek.test.mjs owns its place), so inbox matches
// nothing there; the page under the peek is on the shell and judged whole. page-top runs at 1440x900
// only (narrow: its view a selector no element has), as for the Inbox entry below: on a load at scrollY 0
// at 720x800 and 390x844 every shell page starts 104px below the bar (kit-87's nav row,
// o-20261116-110914358); every other check runs at all three sizes.
// Overview waits for /api/hello too (the status pill and Commit history's mosaic draw when it lands), so its
// entry is judged whole wherever it sits in the list
const OV_READY = "!!document.querySelector('#overview .ov-head h2') && !!document.querySelector('#overview .sec') && !!document.querySelector('#overview .mosaic > i')";
const GOALS_READY = (tab) => `document.querySelector('#goals .tabbar [aria-selected="true"]')?.dataset.tab === '${tab}' && !!document.querySelector('#goals .card${tab === 'active' ? '.goal' : ''}, #goals .empty')`;
// a peek waits for its record: no loading marker and its key row (a goal's Opened, from the record; Upkeep's
// What it covers), the wait dashboard-overview-goals.test.mjs uses, so its stored rows and History are judged
const PEEK_DTS = "[...(document.querySelector('#drawer-body section.attrs > dl.props')?.children ?? [])].filter((x) => x.tagName === 'DT').map((x) => x.textContent.trim())";
const GOAL_PEEK_READY = (title, key) => `!document.getElementById('drawer').hidden && !!document.querySelector('#drawer-body section.attrs') && document.body.classList.contains('peek-open') && getComputedStyle(document.getElementById('drawer')).transform === 'none' && document.querySelector('#drawer-bar-title .dtitle')?.textContent === ${JSON.stringify(title)} && !document.querySelector('#drawer-body .loading') && ${PEEK_DTS}.includes(${JSON.stringify(key)})`;
const OVERVIEW_GOALS = [
  { hash: '#overview', ready: OV_READY },
  { hash: '#goals', ready: GOALS_READY('active') },
  { hash: '#goals?gt=met', ready: GOALS_READY('met') },
  { hash: '#goals?gt=letgo', ready: GOALS_READY('letgo') },
  { hash: '#goal/<seeded>', ready: GOAL_PEEK_READY('Self-serve billing', 'Opened'), opts: { inbox: '#no-such-inbox' } },
  { hash: '#goal/upkeep', ready: GOAL_PEEK_READY('Upkeep', 'What it covers'), opts: { inbox: '#no-such-inbox' } },
].map((pg) => ({ ...pg, narrow: { view: '#no-such-view' } }));
// A page that is only kit-87's frame until its own ticket converts it: its hash, with the view a
// selector no element has (see PAGES). A page ticket replaces its entries here with its own.
const frameOnly = (ids) => ids.map((id) => ({ hash: `#${id}`, ready: READY, opts: { view: '#no-such-view' } }));
// kit-92: the Library
const LIBRARY_PAGES = [
  // on the shell, whole, with test/lib/kit.mjs's libraryFixture (every kind, state and publish record exists only
  // with it); page-top at 1440x900 only, as kit-90's and kit-91's entries
  { hash: '#library', narrow: { view: '#no-such-view' }, init: lib.dataPatchInit(lib.libraryFixture().patch), ready: "!!document.querySelector('#lib-grid .lib-card')" },
  // one item's peek over it (the public mock: the most rows), with the peeks' options (PEEK_OPTS, below); its wait
  // is PEEK_READY's (defined after this list) and the item's own ID in the first row, so not-found never passes
  { hash: `#lib/${encodeURIComponent(`artifact:${lib.libraryFixture().ids.public}`)}`, init: lib.dataPatchInit(lib.libraryFixture().patch), ready: `!document.getElementById('drawer').hidden && !!document.querySelector('#drawer-body section.attrs') && document.body.classList.contains('peek-open') && getComputedStyle(document.getElementById('drawer')).transform === 'none' && document.querySelector('#drawer-body section.attrs dd')?.textContent.trim() === ${JSON.stringify(`artifact:${lib.libraryFixture().ids.public}`)}`, opts: { view: '#no-such-view', inbox: '#no-such-inbox' } },
  // a fresh, unpatched document (an init entry loads one; !window.__fx checks it), and it must stay before the goal
  // pages: those load by a hash change alone (measureAt) and the fixture's data has no seeded goal. The empty Library
  { hash: '#library', narrow: { view: '#no-such-view' }, init: '/* no patch: a new document */', ready: "!window.__fx && document.querySelector('#lib-grid > .empty')?.textContent.trim() === 'None'" },
];
// kit-93: the autonomy pages
// On the shell, whole, with test/lib/kit.mjs's autonomyFixture (its scores, rules, sensors, incidents and retros exist
// only with it; some of its names are long on purpose). As kit-90's, kit-91's and kit-92's entries (spec M1): page-top
// at 1440x900 only (narrow: its view a selector no element has); prose, head-h, head-end, header-pad and tab-motion
// everywhere. The three peeks use the peeks' options (PEEK_OPTS, below: the page under them and the moved Inbox button
// are judged elsewhere), and overflow and uneven leave the drawer out by design (it scrolls); their waits are
// PEEK_READY's (defined after this list) and each peek's own content drawn. #health redirects to Fleet (#sensors?st=fleet).
// The file peek reads main (/api/file is git show), and this test's project has no commit: its init also answers
// /api/file for quality.md with the kit's own copy, so the peek is measured on the real governance text.
const AUTONOMY_PAGES = ((init = lib.autonomyFixture().init, peek = (extra) => `!document.getElementById('drawer').hidden && !!document.querySelector('#drawer-body section.attrs') && document.body.classList.contains('peek-open') && getComputedStyle(document.getElementById('drawer')).transform === 'none' && ${extra}`, quality = fs.readFileSync(new URL('../docs/devteam/governance/quality.md', import.meta.url), 'utf8'), fileInit = `${init}
(() => {
  const f = window.fetch, md = ${JSON.stringify(quality)};
  window.fetch = (u, o) => {
    const at = new URL(String(u && u.url ? u.url : u), location.href);
    return at.origin === location.origin && at.pathname === '/api/file' && at.searchParams.get('path') === 'docs/devteam/governance/quality.md' ? Promise.resolve(new Response(md, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } })) : f(u, o);
  };
})();`) => [
  ...[
    ['#trust', "!!document.querySelector('#trust .fit svg')"],
    ['#awareness', "!!document.querySelector('#awareness .fit svg')"],
    ['#governance', "!!document.querySelector('#governance .db-t tr[data-row]')"],
    ['#sensors', "!!document.querySelector('#monitoring .sensor-card')"],
    ['#sensors?st=fleet', "document.querySelector('#monitoring .tabbar [aria-selected=\"true\"]')?.dataset.tab === 'fleet' && !!document.querySelector('#monitoring [data-tbl] .db-t')"],
    ['#retros', "!!document.querySelector('#retros .cards .card')"],
  ].map(([hash, ready]) => ({ hash, init, narrow: { view: '#no-such-view' }, ready })),
  ...[
    ['#file?path=docs%2Fdevteam%2Fgovernance%2Fquality.md', peek("!!document.querySelector('#drawer-body .md p')"), fileInit],
    ['#class/new-feature', peek("!!document.querySelector('#drawer-body .lvls .lvl.now') && !document.querySelector('#drawer-body .loading')")],
    ['#sensor/errors', peek("[...document.querySelectorAll('#drawer-body .psect > .card-head')].some((h) => h.textContent.trim() === 'Fingerprints')")],
  ].map(([hash, ready, own]) => ({ hash, init: own ?? init, ready, opts: { view: '#no-such-view', inbox: '#no-such-inbox' } })),
  // a fresh, unpatched document (!window.__fx checks it), last: the entries after it (the Loop's, Overview's and the
  // goal pages) load by a hash change alone (measureAt) in the last document, so they are measured on the server's own
  // data, as LIBRARY_PAGES ends. Retros with no retros
  { hash: '#retros', narrow: { view: '#no-such-view' }, init: '/* no patch: a new document */', ready: "!window.__fx && !document.querySelector('main.waiting')" },
])();
// kit-96: the Loop
// On the shell, whole: its four tabs with a record of every kind in each table (some names long on purpose), patched
// into /api/data, and a lesson's peek with its Evidence and Given to, /api/peek answered by the same fixture. page-top
// at 1440x900 only, as every shell page's entry (narrow: its view a selector no element has); the peek takes the
// peeks' options (PEEK_OPTS' values: the page under it is judged by the tab entries; the drawer scrolls).
const LOOP_PAGES = ((now = Date.now(), ago = (h) => new Date(now - h * 3600000).toISOString(), LONG = 'the checkout end-to-end test takes forty seconds on the runner and times out under load when two suites share it') => {
  const K = 'k-20261120-010000000-supervisor', O = ['o-20261120-010000000-supervisor', 'o-20261120-020000000-supervisor'], A = 'a-20261120-030000000-supervisor', D = 'd-20261120-040000000-supervisor', P = 'p-20261120-050000000-supervisor';
  const ooda = {
    observations: [
      { id: O[0], type: 'observation', created_at: ago(2), created_by: 'supervisor', source: 'metrics', kind: 'slow-test', subject: 'app', detail: LONG, severity: 3, valence: -2 },
      { id: O[1], type: 'observation', created_at: ago(3), created_by: 'owner', source: 'owner', kind: 'went-well', subject: 'docs', detail: 'the review caught the bug', severity: 0, valence: 1 },
    ],
    clusters: [{ key: 'metrics:flaky-gate:web/e2e', count: 3, valence: -1, ids: O, latest: 'web/e2e failed, then passed' }],
    debt: { signals: [{ key: 'metrics:flaky-gate:web/e2e', count: 3, latest: 'web/e2e failed, then passed', first_at: ago(30), hours: 30 }], incidents: [{ id: 'p-20261118-010000000-supervisor', title: 'Hub refused connections for 6 minutes', resolved_at: ago(48), outcome: O[1], decision: null, days: 2 }] },
    knowledge: [
      { id: K, type: 'knowledge', kind: 'lesson', statement: `payments time out under load, so ${LONG}`, scope: 'project', status: 'accepted', created_by: 'supervisor', created_at: ago(5), evidence: O, valence: -1 },
      { id: 'k-20261120-011000000-supervisor', type: 'knowledge', kind: 'fact', statement: 'the box runs no SSH server', scope: 'project', status: 'accepted', created_by: 'supervisor', created_at: ago(6), evidence: [] },
    ],
    problems: [{ id: P, type: 'problem', title: 'A typed answer sat unsubmitted in the pane', realized: true, severity: 2, status: 'open', created_at: ago(5), created_by: 'supervisor', threatens: [] }],
    decisions: [
      { id: D, at: ago(1), who: 'supervisor', kind: 'decision', class: 'rename-column', class_name: 'Renaming a column', what: `renamed the Owner column to Who: ${LONG}`, rationale: null, options: [], confidence: 0.6, refs: [], reversible: true, under: { authority: 'rung', rung: 2 }, acts: [], correction: null },
      { id: 'k-20261120-012000000-owner', at: ago(2), who: 'owner', kind: 'rule', class: null, class_name: null, what: 'running text stays within half the grid', refs: [], under: { status: 'accepted' }, acts: [], correction: null },
    ],
    acts: [{ id: A, type: 'act', created_at: ago(1), created_by: 'supervisor', class: 'release-scope', class_name: 'Scoping a release', what: `tagged release v1.0.0 with ${LONG}`, refs: [], reversible: true }],
  };
  const peek = { kind: 'lesson', id: K, record: { id: K, type: 'knowledge', created_at: ago(5), created_by: 'supervisor', fields: { kind: 'lesson', statement: ooda.knowledge[0].statement, scope: 'project', status: 'accepted', evidence: O } }, stage: 'orient', history: [],
    cited: { [O[0]]: { type: 'observation', created_at: ago(2), created_by: 'supervisor', kind: 'slow-test', status: null, text: LONG }, [O[1]]: { type: 'observation', created_at: ago(3), created_by: 'owner', kind: 'went-well', status: null, text: 'the review caught the bug' } },
    related: [], given_to: [{ act: A, session: 'kit-01-a-worker-on-a-ticket-with-a-long-name-for-the-measure', role: 'worker', at: ago(1), since: 2 }] };
  const init = `${lib.dataPatchInit({ ooda })}
(() => {
  const f = window.fetch, pk = ${JSON.stringify(peek)};
  window.fetch = (u, o) => {
    const at = new URL(String(u && u.url ? u.url : u), location.href);
    return at.origin === location.origin && at.pathname === '/api/peek' && at.searchParams.get('id') === pk.id ? Promise.resolve(new Response(JSON.stringify(pk), { status: 200, headers: { 'content-type': 'application/json' } })) : f(u, o);
  };
})();`;
  const rows = (box) => `!!document.querySelector('${box} table.db-t tbody tr[data-row]')`;
  return [
    ...[['#loop', '#observations'], ['#loop?lt=orient', '#knowledge'], ['#loop?lt=decide', '#decisions-feed'], ['#loop?lt=act', '#acts-feed']].map(([hash, box]) => ({ hash, init, narrow: { view: '#no-such-view' }, ready: rows(box) })),
    { hash: `#lesson/${K}`, init, ready: `!document.getElementById('drawer').hidden && !!document.querySelector('#drawer-body section.attrs') && document.body.classList.contains('peek-open') && getComputedStyle(document.getElementById('drawer')).transform === 'none' && [...document.querySelectorAll('#drawer-body .psect > .card-head')].some((h) => h.textContent.trim() === 'Given to')`, opts: { view: '#no-such-view', inbox: '#no-such-inbox' } },
    // a fresh, unpatched document, last, as AUTONOMY_PAGES ends: the entries after it (Overview's and the goal pages)
    // load by a hash change alone in the last document, on the server's own data. The Loop on that data: its tables
    // with what the test's project holds (None where nothing)
    { hash: '#loop', init: '/* no patch: a new document */', narrow: { view: '#no-such-view' }, ready: "!window.__fx && !!document.querySelector('#observations table.db-t')" },
  ];
})();
// kit-97: one thread per subject (not THREADS_PAGES, the Threads panel's list below)
// a thread's card reopened by a Shift+click on Upkeep's card (its open thread, not a new one), floating on
// Goals; page-top at 1440x900 only, as the Goals entries above (o-20261116-110914358)
const THREAD_PAGES = [lib.reopenFixture()].map(({ hash, init, ready }) => ({ hash, init, ready, narrow: { view: '#no-such-view' } }));
// kit-99: the Trust Score's suggestions
const TRUST_SUGG_PAGES = [];
// kit-171: attachments
const ATTACH_PAGES = (() => {
  const at = new Date(Date.now() - 3600000).toISOString();
  // an open question in /api/data's shape (test/lib/kit.mjs's boardFixture `question`)
  const qid = 'q-20261120-000000001-supervisor';
  const q = {
    id: qid, kind: 'owner-decision', class: null, scope: null, ticket: null, re: null, sensor: null, thread: null,
    asked_at: at, question: 'Which of these should the next build look like?', context: '', options: [], choices: [{ label: 'Yes' }, { label: 'No' }], links: [],
    goal: null, change: null, met: null, rule_scope: null, recommendation: '', confidence: null, default: null, deadline: null, blocks: [],
    stake: 2, urgency: 2, settles: [], settles_if: null, settles_label: null,
    rating_history: [{ at, by: 'supervisor', stake: 2, urgency: 2, asked: true }], approves: [], evidence: [], note: null, new_because: null,
    why_asked: { reasons: [] }, secrets: [], secrets_posted: [], status: 'open', answer: null, answered_by: null, answered_at: null, matched: null,
    hash: '0123456789abcde1', rewritten: false, autonomy: null, standing_rule: null, channel: null, said: null, turn: null, review: null, result: null,
    declined: null, allow_partial: null, result_status: null, links_moved: null, goal_hold: null, files: [],
    rank: {
      score: 9, own: 9, position: 1, of: 1, top: true, floor: null, chips: [], reason: null, sum: 'score 9',
      parts: { goal: null, goal_title: null, goal_impact: 2, judged: false, impact_by: null, stake: 2, urgency: 2, urgency_given: 2, rated: true, held_up: 0, on_path: 0, behind: 0, unblock: 0, default: false, default_soon: false, parked: false, floor: null, age_days: 1, settles: [], settled_by: [] },
    },
    class_name: null,
  };
  const OK_NAME = `${'a-sixty-character-file-name-'.repeat(3).slice(0, 56)}.png`;
  const WHY = `The upload was refused: ${'this file is far too large for the machine to take '.repeat(4)}`.slice(0, 160);
  const key = `q:${qid}`, box = `.dropbox[data-drop="${key}"]`;
  // the two pills set into the box once its card is drawn; then, as INBOX_READY (below) does, #th-body is made to
  // overflow visible at its own width so the box is judged at its real width, and the panel must be at rest
  const noteReady = `(() => {
  if (!(document.body.classList.contains('threads-open') && getComputedStyle(document.getElementById('threads')).transform === 'none') || !document.querySelector('#questions [data-qcard="${qid}"] ${box}')) return false;
  getComputedStyle(document.querySelector('.main')).marginRight;
  if (document.getAnimations().some((a) => a.transitionProperty === 'margin-right')) return false;
  if (!window.__attached) {
    window.__attached = true;
    ATTACH.set(${JSON.stringify(key)}, [
      { id: 'att-m1', name: ${JSON.stringify(OK_NAME)}, sendName: ${JSON.stringify(OK_NAME)}, size: 48213, type: 'image/png', state: 'ok', why: '', path: 'docs/devteam/uploads/a.png', bytes: 48213 },
      { id: 'att-m2', name: 'huge.bin', sendName: 'huge.bin', size: 9437184, type: 'application/octet-stream', state: 'refused', why: ${JSON.stringify(WHY)}, path: '', bytes: 0 },
    ]);
    drawPills(${JSON.stringify(key)});
  }
  if (document.querySelectorAll('${box} .att-pill').length !== 2 || !document.querySelector('${box} .att-pill.refused .pill-why')) return false;
  const b = document.getElementById('th-body');
  b.style.width = ''; b.style.overflowY = '';
  b.style.width = getComputedStyle(b).width; b.style.overflowY = 'visible';
  return true;
})()`;
  // a thread on Upkeep's card, floating on Goals, whose owner turn has three files
  const tid = 't-20261120-000000002-owner';
  const files = [{ name: 'Shot 1.png', path: 'docs/devteam/uploads/1.png', bytes: 48213 }, { name: 'Spec.pdf', path: 'docs/devteam/uploads/2.pdf', bytes: 2411000 }, { name: `${'a-long-file-name-without-spaces-'.repeat(3).slice(0, 76)}.txt`, path: 'docs/devteam/uploads/3.txt', bytes: 912 }];
  const thread = { ...lib.effThread({ id: tid, subject: { kind: 'item', ref: 'goal:upkeep' }, title: 'About upkeep', turns: [{ id: 'u-20261120-000000002-owner', by: 'owner', writer: 'owner', at, text: 'Look at these three before we go on', refs: [], question: null, files }] }), waiting: 'supervisor' };
  const threadInit = `(() => {
  const si = window.setInterval;
  window.setInterval = (f, ms, ...a) => si(f, ms === 10000 ? 300 : ms, ...a);
  const json = (r, body) => new Response(JSON.stringify(body), { status: r.status, statusText: r.statusText, headers: r.headers });
  const real = window.fetch;
  window.fetch = async (u, o) => {
    const url = String(u && u.url ? u.url : u);
    const r = await real(u, o);
    if (String(o?.method || 'GET').toUpperCase() === 'GET' && r.ok && url.startsWith('/api/threads')) {
      const j = await r.json();
      return json(r, { ...j, threads: [...(j.threads || []), ${JSON.stringify(thread)}] });
    }
    return r;
  };
})();`;
  const turnReady = `(() => {
  const c = document.getElementById('tl-card');
  if (!(TL.open === ${JSON.stringify(tid)} && !c.hidden && c.parentElement.id === 'tl' && document.querySelectorAll('#tl-c-turns .file-chip').length === 3)) return false;
  // #tl-c-turns scrolls (overflow-y: auto) and measure.mjs skips what a scrolling container holds: as INBOX_READY does
  // for #th-body, its width is fixed at its own and it overflows visible, so the turn and its chips are judged
  // and #tl (the floating cards' layer) is .no-shell, which measure.mjs's ignore skips whole: the class is taken
  // off it for the measure, so the card's turns are in the judged set
  document.getElementById('tl').classList.remove('no-shell');
  const t = document.getElementById('tl-c-turns');
  t.style.width = ''; t.style.overflowY = '';
  t.style.width = getComputedStyle(t).width; t.style.overflowY = 'visible';
  return true;
})()`;
  return [
    { hash: '#questions', init: lib.dataPatchInit({ questions: [q] }), ready: noteReady, narrow: { view: '#no-such-view' } },
    { hash: `#goals?t=${tid}`, init: threadInit, ready: turnReady, narrow: { view: '#no-such-view' } },
  ];
})();
// kit-166: Upkeep's peek with its Jobs, Built in and Proposed jobs sections, two jobs' peeks (a check with what the
// loop noticed and its runs, a worker chore with its instructions) and a built-in's, on the jobs fixtures
// (test/fixtures/recurring/dashboard.json in /api/data's upkeep.recurring, peek.json for /api/peek?kind=recurring).
// Each its own document at the three sizes; view and inbox match nothing, as for the other peeks (the page under
// the peek is judged elsewhere; the drawer scrolls, so overflow and uneven leave it out by design). kit-169 adds the
// Jobs page itself, on the same fixtures, judged whole like any shell page (its entry is marked 'page': no peek options).
const JOBS_PAGES = ((
  DASH_FX = fs.readFileSync(new URL('./fixtures/recurring/dashboard.json', import.meta.url), 'utf8'),
  PEEK_FX = fs.readFileSync(new URL('./fixtures/recurring/peek.json', import.meta.url), 'utf8'),
  init = `(() => {
  const rec = ${DASH_FX}, peeks = ${PEEK_FX}, real = window.fetch;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  window.fetch = async (u, o) => {
    const url = String(u && u.url ? u.url : u);
    if (String(o?.method || 'GET').toUpperCase() === 'GET' && url.startsWith('/api/peek?')) {
      const q = new URLSearchParams(url.slice(10));
      if (q.get('kind') === 'recurring') return peeks[q.get('id')] ? json(peeks[q.get('id')]) : json({ error: 'no such job' }, 404);
    }
    const r = await real(u, o);
    if (!r.ok || !url.startsWith('/api/data')) return r;
    const d = await r.json();
    d.upkeep = { ...(d.upkeep || {}), recurring: rec };
    return json(d);
  };
})();`,
  rest = "!document.getElementById('drawer').hidden && document.body.classList.contains('peek-open') && getComputedStyle(document.getElementById('drawer')).transform === 'none' && !document.querySelector('#drawer-body .loading')",
  sect = (head) => `[...document.querySelectorAll('#drawer-body > .card.psect > .card-head')].some((h) => h.textContent.trim() === ${JSON.stringify(head)})`,
) => [
  ['#goal/upkeep', `${rest} && !!document.querySelector('#drawer-body [data-gp="jobs"] table.db-t') && !!document.querySelector('#drawer-body [data-gp="proposals"] table.db-t')`],
  ['#recurring/ci-main', `${rest} && ${sect('What the loop noticed')} && ${sect('Recent runs')} && !!document.querySelector('#drawer-body [data-tbl="job:runs"]')`],
  ['#recurring/deps-bump', `${rest} && ${sect('Recent runs')} && !!document.querySelector('#drawer-body .measure')`],
  ['#builtin/retro', `${rest} && DRAWER.kind === 'builtin' && !!document.querySelector('#drawer-body section.attrs dl.props')`],
  // kit-169: the Jobs page under Autonomy, with rows in its Jobs and What the loop noticed tables. A page, not a peek:
  // it takes no peek options, so every check judges it, page-top at 1440x900 only (narrow), as every shell page
  ['#jobs', "!!document.querySelector('main.page > section#jobs.on') && !!document.querySelector('#jobs [data-jp=\"jobs\"] table.db-t tbody tr[data-row]') && !!document.querySelector('#jobs [data-jp=\"noticed\"] table.db-t tbody tr[data-row]')", 'page'],
].map(([hash, ready, page]) => ({ hash, init, ready, narrow: { view: '#no-such-view' }, ...(page ? {} : { opts: { view: '#no-such-view', inbox: '#no-such-inbox' } }) })))();
const PAGES = [
  // kit-87: Settings, on the shell, whole
  { hash: '#settings', ready: READY },
  // kit-87: every other page's frame (the sidebar, the page bar). Its old section is .no-shell, which the
  // other checks ignore; with the default view it would be taken for the page's first content, whose
  // page-top is its page ticket's, so the view is a selector no element has. (kit-100 moved the interim
  // Inbox page into the Threads panel: its entry is the panel's, below.)
  ...LIBRARY_PAGES, ...AUTONOMY_PAGES, ...LOOP_PAGES,
  // kit-90: Overview and Goals, on the shell, whole, with the goal the test seeds (goalArgs, below)
  ...OVERVIEW_GOALS,
  // kit-91: Board (plain and Needs attention) and Progress, on the shell, with test/lib/kit.mjs's boardFixture
  // (every column, the held items, the burn-up and its forecast exist only with it). page-top is judged at
  // 1440x900 only (narrow: its view a selector no element has, as kit-90's entries above; a load at 720x800
  // and 390x844 starts 104px below the bar, o-20261116-110914358); every other check runs at all three sizes.
  ...['#board', '#board?att=1'].map((hash) => ({ hash, narrow: { view: '#no-such-view' }, init: lib.dataPatchInit(lib.boardFixture().patch), ready: "!!document.querySelector('#board [data-ticket]')" })),
  { hash: '#progress', narrow: { view: '#no-such-view' }, init: lib.dataPatchInit(lib.boardFixture().patch), ready: "!!document.querySelector('#burnup svg') && !!document.querySelector('#w-features .row') && !!document.getElementById('forecast').textContent" },
  // kit-174: Efficiency, on the shell, with test/lib/kit.mjs's fixture (the phase bars and the waste
  // line exist only with it)
  { hash: '#efficiency', init: lib.dataRewriteInit(lib.efficiencyFixture()), ready: "!!document.querySelector('#efficiency [data-fit] svg rect') && /kit-87/.test(document.querySelector('#efficiency').textContent)" },
  // kit-97, kit-99, kit-171: their pages, peeks and threads (empty until each adds its own)
  ...THREAD_PAGES, ...TRUST_SUGG_PAGES, ...ATTACH_PAGES,
  // kit-166: Upkeep's jobs and a job's peek (each an init entry: a document of its own)
  ...JOBS_PAGES,
];

// kit-88: one peek of each kind (spec §2.6), on a second project seeded with test/lib/kit.mjs's
// peekFixture, so the pages above keep their own data. Each opens over its kind's home page: header-pad
// judges the page bar's title; inbox matches nothing, since the top-right button moves left of the peek
// on purpose (dashboard-peek.test.mjs owns its place); prose, head-h and head-end judge the peek's own
// text and card heads; overflow and uneven skip the drawer by design (it scrolls; uneven leaves out
// .drawer cards).
const PEEK_READY = "!document.getElementById('drawer').hidden && !!document.querySelector('#drawer-body section.attrs') && document.body.classList.contains('peek-open') && getComputedStyle(document.getElementById('drawer')).transform === 'none'";
// view matches nothing: the pages under the peek are unconverted until their own tickets, the same as the page entries above
const PEEK_OPTS = { view: '#no-such-view', inbox: '#no-such-inbox' };
const PEEKS_MEASURED = (ids) => {
  const e = encodeURIComponent;
  return [
    ['ticket', ids.ticket], ['goal', ids.goal], ['feature', ids.feature], ['story', ids.story], ['release', ids.release], ['wave', ids.wave], ['milestone', ids.milestone],
    ['act', ids.act], ['decision', ids.decision], ['lesson', ids.lesson], ['problem', ids.problem], ['signal', ids.signal], ['observation', ids.observation], ['learning', ids.learning],
    ['retro', ids.retro], ['thread', ids.thread], ['planner', ids.planner], ['q', ids.qAnswered], ['sensor', ids.sensorHttp],
  ].map(([kind, id]) => ({ hash: `#${kind}/${e(id)}`, ready: PEEK_READY, opts: PEEK_OPTS }))
    .concat([{ hash: `#file?path=${e(ids.file)}`, ready: PEEK_READY, opts: PEEK_OPTS }]);
};

// kit-95: every page the dashboard has (a data-page section) is on the list, but Self Improvement (the Loop),
// whose entries are kit-96's; a page added without an entry fails here, with no browser needed
test('the dashboard measure: every page but the Loop is listed', () => {
  const html = fs.readFileSync(new URL('../docs/devteam/dashboard/index.html', import.meta.url), 'utf8');
  const pages = [...new Set([...html.matchAll(/<section id="[^"]+"[^>]*\sdata-page="([a-z-]+)"/g)].map((m) => m[1]))].filter((id) => id !== 'loop');
  assert.ok(pages.length >= 12, `the page sections are found: ${pages.join(' ')}`);
  const listed = (id) => PAGES.some((pg) => pg.hash === `#${id}` || pg.hash.startsWith(`#${id}?`));
  assert.deepEqual(pages.filter((id) => !listed(id)), []);
});

test('the dashboard measure: every listed page at three sizes', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 300000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-dash-measure-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(lib.PORTS + 2), DEVTEAM_PORT_BASE: String(lib.PORTS + 3), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'DEVTEAM_HOME', 'TMUX', 'TMUX_PANE']) delete env[k];
  const root = lib.bareProject(base, 'measure');
  // kit-90: one goal, so Goals' Active tab has a goal's card beside Upkeep's and its peek has a goal to open
  const g = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), ...goalArgs('Self-serve billing', 1)], { cwd: root, env: { ...env, DEVTEAM_ROLE: 'supervisor' }, encoding: 'utf8' });
  assert.equal(g.status, 0, g.stderr);
  const goalId = idOf(g.stdout);
  const { dash, port } = await lib.dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  const url = (hash) => `http://127.0.0.1:${port}/${hash}`;
  if (!PAGES.length) {
    // the plumbing, on today's Overview, which isn't on the shell yet: a result for each size, not a judgement
    const res = await measureAt(p, url('#overview'), { ready: "!document.querySelector('main.waiting')" });
    assert.deepEqual(Object.keys(res), SIZES.map(([w, h]) => `${w}x${h}`));
    for (const r of Object.values(res)) assert.ok(Array.isArray(r));
    return;
  }
  for (const pg of PAGES) {
    if (!pg.init) {
      const at = url(pg.hash.replace('<seeded>', encodeURIComponent(goalId))), o = { ready: pg.ready ?? 'true', ...(pg.opts || {}) };
      const res = pg.narrow ? { ...(await measureAt(p, at, { ...o, sizes: SIZES.slice(0, 1) })), ...(await measureAt(p, at, { ...o, ...pg.narrow, sizes: SIZES.slice(1) })) } : await measureAt(p, at, o);
      assert.deepEqual(Object.keys(res), SIZES.map(([w, h]) => `${w}x${h}`));
      for (const [size, fails] of Object.entries(res)) assert.deepEqual(fails, [], `${pg.hash} at ${size}`);
      continue;
    }
    // with an init script: one new document (from about:blank; the dashboard serves only / and
    // /index.html, so no query is added to force one), measured at the three sizes as a listed page
    // is. Not a fresh document per size: on a fresh load at 720x800 every shell page fails page-top
    // (kit-87's nav row sits between the bar and the page below 900px; o-20261116-110914358). In one
    // document the narrow sizes are reached scrolled down, and measure.mjs skips page-top there, as
    // it does for Settings. The script is removed after.
    const { identifier } = await p.send('Page.addScriptToEvaluateOnNewDocument', { source: pg.init });
    try {
      await p.send('Page.navigate', { url: 'about:blank' });
      for (let i = 0; i < 200 && (await p.ev('location.href').catch(() => '')) !== 'about:blank'; i++) await new Promise((r) => setTimeout(r, 50));
      const o = { ready: pg.ready ?? 'true', ...(pg.opts || {}) };
      const res = pg.narrow ? { ...(await measureAt(p, url(pg.hash), { ...o, sizes: SIZES.slice(0, 1) })), ...(await measureAt(p, url(pg.hash), { ...o, ...pg.narrow, sizes: SIZES.slice(1) })) } : await measureAt(p, url(pg.hash), o);
      assert.deepEqual(Object.keys(res), SIZES.map(([w, h]) => `${w}x${h}`));
      for (const [at, fails] of Object.entries(res)) assert.deepEqual(fails, [], `${pg.hash} at ${at}`);
    } finally {
      await p.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    }
  }
});

test('the dashboard measure: one peek of each kind at three sizes', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 600000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-dash-measure-peeks-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(lib.PORTS + 2), DEVTEAM_PORT_BASE: String(lib.PORTS + 3), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'DEVTEAM_HOME', 'TMUX', 'TMUX_PANE']) delete env[k];
  const t0 = Date.now();
  const { root, ids } = lib.peekFixture(base, 'measure-peeks');
  t.diagnostic(`peekFixture took ${Date.now() - t0} ms`);
  const { dash, port } = await lib.dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  const url = (hash) => `http://127.0.0.1:${port}/${hash}`;
  const peeks = PEEKS_MEASURED(ids);
  // every peek kind the page draws is measured
  assert.ok(peeks.every((pk) => !/undefined/.test(pk.hash)), `a fixture id is missing: ${peeks.map((pk) => pk.hash).join(' ')}`);
  // every peek's failures, gathered, so one run names them all
  const failed = {};
  for (const pk of peeks) {
    // each from a fresh document (about:blank first), so its first size is a cold load over its home
    // page and the ready test can't be met by the previous peek still open; the other two sizes are
    // the same hash in the same document. A fresh visit per peek also keeps each well under Chrome's
    // navigation throttle (200 in 10 s).
    await p.send('Page.navigate', { url: 'about:blank' });
    for (let i = 0; i < 200 && (await p.ev('location.href').catch(() => '')) !== 'about:blank'; i++) await new Promise((r) => setTimeout(r, 50));
    const res = await measureAt(p, url(pk.hash), { ready: pk.ready, ...pk.opts });
    for (const [at, fails] of Object.entries(res)) if (fails.length) failed[`${pk.hash} at ${at}`] = fails;
  }
  assert.deepEqual(failed, {});
});

// kit-89: the Threads panel and a floating card (spec AC8), on a third project with a few threads
// (threadsFixture, as dashboard-threads-sidebar.test.mjs seeds it), so the pages above keep their own
// data. The panel and the card are overlays the measure leaves out by design (the panel is fixed to the
// window and scrolls; the card floats at its pin), and the top-right button hides while the panel is
// open: inbox matches nothing; view matches nothing, as for the pages above. What is judged is the page
// under them and the panel's own text, in each of the three sizes. localStorage is cleared by a script
// every load runs first, so no entry inherits another's open panel.
const goalArgs = (title, priority) => ['goal', 'add', '--title', title, '--outcome', 'admins pay alone', '--measure', 'self-serve share', '--target', '80', '--unit', '%', '--direction', 'up', '--source', 'prod', '--check', 'echo 5', '--horizon', '2027-03-31', '--non-goals', 'enterprise invoicing', '--preconditions', 'cards work', 'prices defined', '--priority', String(priority)];
const idOf = (out) => out.split('\n')[0].trim();
const THREADS_OPTS = { view: '#no-such-view', inbox: '#no-such-inbox' };
const PANEL_AT_REST = "document.body.classList.contains('threads-open') && getComputedStyle(document.getElementById('threads')).transform === 'none'";
const THREADS_PAGES = (A, G) => [
  { hash: '#overview?th=open', ready: `${PANEL_AT_REST} && !!document.querySelector('#tl-list .th-row')` },
  { hash: `#overview?th=open&t=${A}`, ready: `${PANEL_AT_REST} && !!document.querySelector('#th-card-slot > #tl-card.in-panel') && !document.getElementById('tl-card').hidden` },
  { hash: `#goals?t=${G}`, ready: `!document.getElementById('tl-card').hidden && document.getElementById('tl-card').parentElement.id === 'tl' && !document.body.classList.contains('threads-open')` },
].map((pg) => ({ ...pg, opts: THREADS_OPTS }));

test('the dashboard measure: the Threads panel and a card at three sizes', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 600000 }, async (t) => {
  const F = lib.threadsFixture('measure-threads');
  const later = cleanup(t);
  later(() => F.done());
  F.sup(goalArgs('Self-serve billing', 2));
  const A = idOf(F.owner(['thread', 'new', 'Where do we start?']));
  F.sup(['thread', 'reply', A, 'Here, I think.']);
  F.owner(['thread', 'new', 'Is the build green?']);
  const G = idOf(F.owner(['thread', 'new', 'About this goal', '--subject', JSON.stringify({ kind: 'item', ref: `goal:${F.goal}` })]));
  F.sup(['thread', 'reply', G, 'On it.']);
  const { dash, port } = await lib.dashboardOnFreePort(F.old, F.env({}));
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.removeItem('devteam.threads.open'); } catch {}" });
  const url = (hash) => `http://127.0.0.1:${port}/${hash}`;
  const failed = {};
  for (const pg of THREADS_PAGES(A, G)) {
    await p.send('Page.navigate', { url: 'about:blank' });
    for (let i = 0; i < 200 && (await p.ev('location.href').catch(() => '')) !== 'about:blank'; i++) await new Promise((r) => setTimeout(r, 50));
    const res = await measureAt(p, url(pg.hash), { ready: pg.ready, ...pg.opts });
    for (const [at, fails] of Object.entries(res)) if (fails.length) failed[`${pg.hash} at ${at}`] = fails;
  }
  assert.deepEqual(failed, {});
});

// kit-100: the Inbox in the panel (spec AC6), on a fourth project seeded with test/lib/kit.mjs's
// inboxFixture (as dashboard-inbox-panel.test.mjs seeds it), so the pages above keep their own data, plus
// one question whose choice's detail is a 120-character unbroken link (a long string at 390 wide, Review
// Focus 5). Over Settings, which is on the shell, so page-top and header-pad judge the page under the
// panel; the Inbox button hides while the panel is open, so inbox matches nothing. #th-body scrolls, and
// measure.mjs skips what a scrolling container holds, so ready fixes #th-body's width at its own (the
// scrollbar's loss included) and makes it overflow visible: the Inbox's boxes are then judged at their real
// width (prose, overflow, head-h, head-end; tab-motion the panel's tab bar). The width is reset before it is
// read, since the three sizes are one document. #answered-wrap is opened, so its cards are judged too. The
// page under the panel is measured at rest: a resize from 1440 slides .main's margin-right (the panel's room)
// to 0 below 900px, and a box read mid-slide is narrower than its page lays it out.
// page-top runs at 1440x900 only. At 720x800 and 390x844 every shell page starts 104px below the bar on a
// load at scrollY 0 (kit-87's nav row sits between the bar and the page at 900px and below:
// o-20261116-110914358), and #settings?th=inbox names no element, so nothing scrolls it past the check as
// #settings's own fragment does for the Settings entry above. There the view is a selector no element has,
// as for the other entries facing that gap; every other check runs at all three sizes.
const LONG_LINK = `https://example.com/${'a'.repeat(100)}`;
const INBOX_READY = `(() => {
  if (!(${PANEL_AT_REST}) || !document.querySelector('#th-inbox [data-qcard]') || document.getElementById('th-inbox').hidden) return false;
  getComputedStyle(document.querySelector('.main')).marginRight;
  if (document.getAnimations().some((a) => a.transitionProperty === 'margin-right')) return false;
  if (!document.getElementById('th-inbox').textContent.includes(${JSON.stringify(LONG_LINK)})) return false;
  document.getElementById('answered-wrap').open = true;
  const b = document.getElementById('th-body');
  b.style.width = ''; b.style.overflowY = '';
  b.style.width = getComputedStyle(b).width; b.style.overflowY = 'visible';
  return true;
})()`;

test('the dashboard measure: the Inbox in the panel at three sizes', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 300000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-dash-measure-inbox-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(lib.PORTS + 2), DEVTEAM_PORT_BASE: String(lib.PORTS + 3), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'DEVTEAM_HOME', 'TMUX', 'TMUX_PANE']) delete env[k];
  const root = lib.bareProject(base, 'measure-inbox');
  lib.inboxFixture(root, env);
  const choices = [{ label: 'Keep the link', detail: LONG_LINK }, { label: 'Drop it' }];
  const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), 'ask', '--question', 'Keep the long link?', '--choices', JSON.stringify(choices), '--stake', '1', '--urgency', '1'], { cwd: root, env: { ...env, DEVTEAM_ROLE: 'supervisor' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const { dash, port } = await lib.dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.removeItem('devteam.threads.open'); } catch {}" });
  await p.send('Page.navigate', { url: 'about:blank' });
  for (let i = 0; i < 200 && (await p.ev('location.href').catch(() => '')) !== 'about:blank'; i++) await new Promise((r) => setTimeout(r, 50));
  const url = `http://127.0.0.1:${port}/#settings?th=inbox`;
  const res = {
    ...(await measureAt(p, url, { sizes: SIZES.slice(0, 1), ready: INBOX_READY, inbox: '#no-such-button' })),
    ...(await measureAt(p, url, { sizes: SIZES.slice(1), ready: INBOX_READY, inbox: '#no-such-button', view: '#no-such-view' })),
  };
  assert.deepEqual(Object.keys(res), SIZES.map(([w, h]) => `${w}x${h}`));
  const failed = {};
  for (const [at, fails] of Object.entries(res)) if (fails.length) failed[`#settings?th=inbox at ${at}`] = fails;
  assert.deepEqual(failed, {});
});
