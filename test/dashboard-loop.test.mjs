// kit-96: Self Improvement (the Loop page) as sortable record tables (design: Autonomy pages › Self Improvement).
// Observe, Orient, Decide and Act are the shell's dbTables with no type column; Orient is one Knowledge table with
// a Kind filter and a Needs orienting toggle in the page header; a lesson's peek shows its evidence and who it was
// given to; Correct on a decision or an act opens a thread about it (fast-threads' item subject), and the owner's
// turn there is the correction once the supervisor records it (kit-101's correct --from-turn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { kit, threadsFixture, dashboardOnFreePort } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const SKIP = canDrive ? false : 'needs Chrome and a Node with WebSocket';
const idOf = (out) => out.split('\n')[0].trim();
const read = (rel) => fs.readFileSync(path.join(kit, rel), 'utf8');

// The page's own polls every 300 ms; every POST kept in window.__posts.
const INIT = `(() => {
  const si = window.setInterval;
  window.setInterval = (f, ms, ...a) => si(f, ms === 10000 ? 300 : ms, ...a);
  window.__posts = [];
  const rf = window.fetch;
  window.fetch = (u, o) => { if (String(o?.method || 'GET').toUpperCase() === 'POST') window.__posts.push(String(u && u.url ? u.url : u)); return rf(u, o); };
})()`;
const soonIn = (p, ms = 30000) => async (expr, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v, err = null;
    try { v = await p.ev(expr); } catch (e) { err = e; }
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out: ${what}${err ? `; last: ${err.message}` : ''}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};
const FRAMES = 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))';

// The tables' columns, as the design's mock draws them: no type column on any (the tab picks the type).
const COLS = {
  observe: ['What', 'Source', 'How much it matters', 'Good or bad', 'Seen by', 'When'],
  orient: ['What', 'Kind', 'Status', 'Applies to', 'Waiting', 'Needs orienting'],
  decide: ['Decision', 'Kind', 'Who', 'Confidence', 'Corrected', 'When', ''],
  act: ['Act', 'Kind', 'Reversible', 'When', ''],
};
// each tab's table, inside the container today's tests (thread-per-subject, dashboard.test.mjs) find its rows in
const BOX = { observe: '#observations', orient: '#knowledge', decide: '#decisions-feed', act: '#acts-feed' };
const rowsOf = (tab) => `[...document.querySelectorAll('${BOX[tab]} table.db-t tbody tr[data-row]')]`;
const cellsOf = (tab, col) => `${rowsOf(tab)}.map((tr) => tr.children[${col}]?.textContent.trim())`;

// The Loop's parts of index.html (its touches, the parts it adds, and the Loop's own styles), read with the kit's
// own parts reader, as dashboard-copy.test.mjs reads them.
const LOOP_PARTS = ['html-loop', 'ooda-learning', 'ooda-observe', 'ooda-orient', 'ooda-decide', 'ooda-act', 'renderDecisions', 'decideRows', 'DEC_KIND', 'howItChanges', 'openLesson', 'openAct', 'openDecision', 'loop-tables', 'css-loop-tables'];
function loopText() {
  const src = read('scripts/devteam.mjs');
  const a = src.indexOf('/* parts start */'), b = src.indexOf('/* parts end */');
  const fileParts = vm.runInContext(`${src.slice(a, b)}\n;({ fileParts })`, vm.createContext({})).fileParts;
  const text = read('dashboard/index.html');
  const P = fileParts(text, 'index.html');
  const out = [], missing = [];
  for (const name of LOOP_PARTS) {
    const places = P.places.get(name);
    if (!places?.length) { missing.push(name); continue; }
    for (const { from, to } of places) out.push(P.lines.slice(from - 1, to).map((l) => (/^\s*(\/\/|\/\*|\*)/.test(l) ? '' : l)).join('\n'));
  }
  // tooltips are not copy on the page
  return { text: out.join('\n').replace(/\btitle="[^"]*"/g, 'title=""').replace(/\.title = (['`])(?:(?!\1).)*\1/g, ".title = ''"), missing };
}
// kit-95's list and patterns, taken from its test so the two can't drift: GONE_INDEX, KEY_HINT, SUB_LINE
function copyRules() {
  const src = fs.readFileSync(new URL('./dashboard-copy.test.mjs', import.meta.url), 'utf8');
  const grab = (name) => { const m = new RegExp(`^const ${name} = ([\\s\\S]*?);\\n`, 'm').exec(src); assert.ok(m, `dashboard-copy.test.mjs defines ${name}`); return vm.runInNewContext(`(${m[1]})`); };
  return { GONE: grab('GONE_INDEX'), KEY_HINT: grab('KEY_HINT'), SUB_LINE: grab('SUB_LINE') };
}

test('the Loop\'s explanatory copy is gone (kit-95\'s list, on the Loop\'s parts)', () => {
  const { text, missing } = loopText();
  const { GONE, KEY_HINT, SUB_LINE } = copyRules();
  const at = (i) => text.slice(0, i).split('\n').length;
  const bad = [
    ...GONE.filter((s) => text.includes(s)).map((s) => `on the list: ${s}`),
    ...[KEY_HINT, SUB_LINE].flatMap((re) => [...text.matchAll(new RegExp(re.source, 'g'))].map((m) => `${re === KEY_HINT ? 'a key hint' : 'a heading sub-line'} (part line ${at(m.index)}): ${m[0].slice(0, 80)}`)),
    // the Loop's own explanations, which kit-95's list left to this ticket
    ...['how the supervisor notices, makes sense of, decides and acts', 'What the workers and the supervisor noticed', 'What the signal adds up to', 'Every call, newest first', 'What the supervisor did, newest first', 'Recurring signals nothing has explained for more than a day', 'proposed lesson', "The agents' own lessons, waiting for the supervisor", 'Nothing waiting: every recurring signal', 'Something noticed more than once shows here', 'Every call, the supervisor\\\'s and yours, shows here', 'Everything the supervisor does shows here']
      .filter((s) => text.includes(s)).map((s) => `the Loop's explanation: ${s}`),
  ];
  assert.deepEqual(bad, []);
  // every part read: a renamed part can't narrow what is checked
  assert.deepEqual(missing, [], 'index.html has each of the Loop\'s parts');
});

test('Self Improvement: sortable record tables, Orient as knowledge, lessons you can follow, Correct as a thread', { skip: SKIP, timeout: 600000 }, async (t) => {
  const F = threadsFixture('loop-page');
  const later = cleanup(t);
  later(() => F.done());
  const HOUR = 3600000;
  const stamp = (d) => `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
  // Observe: two notes that matter differently, one good and one bad
  const OBAD = idOf(F.sup(['observe', '--subject', 'app', '--kind', 'slow-test', '--detail', 'the checkout test takes 40s', '--severity', '3', '--valence', '-2']));
  const OGOOD = idOf(F.sup(['observe', '--subject', 'docs', '--kind', 'went-well', '--detail', 'the review caught the bug', '--severity', '0', '--valence', '1']));
  // a lesson from two observations, given to a worker's prompt, whose signal came back once after
  const O3 = F.hand('supervisor', { type: 'observation', source: 'supervisor', kind: 'timeout', subject: 'pay', detail: 'payments timed out' }, 120000);
  const O4 = F.hand('supervisor', { type: 'observation', source: 'supervisor', kind: 'timeout', subject: 'pay', detail: 'payments timed out again' }, 110000);
  const K = F.hand('supervisor', { id: `k-${stamp(new Date(Date.now() - 60000))}-supervisor`, type: 'knowledge', kind: 'lesson', scope: 'project', statement: 'payments time out under load', status: 'accepted', evidence: [O3, O4] }, 60000);
  const START = F.hand('supervisor', { id: `a-${stamp(new Date(Date.now() - 30000))}-supervisor`, type: 'act', class: 'worker-slots', what: 'made worker kit-01-pay in loop-page:kit-01-pay', refs: ['kit-01-pay'], reversible: true, knowledge: [K] }, 30000);
  F.sup(['observe', '--subject', 'pay', '--kind', 'timeout', '--detail', 'payments timed out a third time']);
  // a fact, and a preference of the owner's (a standing rule: a Decide row whose Who is you)
  const KFACT = F.sup(['knowledge', 'add', '--kind', 'fact', '--scope', 'project', '--statement', 'the box runs no SSH server']).match(/k-\S+/)[0];
  F.sup(['knowledge', 'set', KFACT, '--status', 'accepted']);
  const KPREF = F.hand('owner', { id: `k-${stamp(new Date(Date.now() - 40000))}-owner`, type: 'knowledge', kind: 'preference', scope: 'project', statement: 'running text stays within half the grid', status: 'accepted' }, 40000);
  // a recurring signal unexplained for 30 hours (Orient owes it), as dashboard.test.mjs writes one
  for (const h of [30, 28, 2]) {
    const d = new Date(Date.now() - h * HOUR);
    fs.appendFileSync(path.join(F.logDir, `supervisor-${d.toISOString().slice(0, 7)}.jsonl`), `${JSON.stringify({ v: 1, op: 'new', type: 'observation', id: `o-${stamp(d)}-supervisor`, at: d.toISOString(), by: 'supervisor', source: 'metrics', detector: 'metrics', subject: 'web/e2e', kind: 'flaky-gate', detail: 'web/e2e failed, then passed', source_key: 'metrics:flaky-gate:web/e2e' })}\n`);
  }
  const SIG = 'metrics:flaky-gate:web/e2e';
  // an open problem nobody owns yet, and an incident fixed and verified two days ago that nobody learned from
  const pid = (h) => `p-${stamp(new Date(Date.now() - h * HOUR))}-supervisor`;
  const P = F.hand('supervisor', { id: pid(5), type: 'problem', title: 'A typed answer sat unsubmitted in the pane', realized: true, severity: 2, status: 'open' }, 5 * HOUR);
  const INC = F.hand('supervisor', { id: pid(72), type: 'problem', title: 'Hub refused connections for 6 minutes', realized: true, severity: 3, status: 'open', fingerprints: ['hub:econnrefused'] }, 72 * HOUR);
  F.hand('supervisor', { op: 'set', id: INC, type: 'problem', status: 'resolved' }, 48 * HOUR, `supervisor-${new Date(Date.now() - 48 * HOUR).toISOString().slice(0, 7)}.jsonl`);
  F.hand('supervisor', { type: 'observation', kind: 'outcome', subject: 'hub', detail: 'the hub stayed up for a day', valence: 1, refs: [INC] }, 47 * HOUR);
  // Decide: a call to correct, one already corrected, one with an open thread; an act of its own; a routine act
  const D1 = idOf(F.sup(['decide', '--class', 'rename-column', '--confidence', '0.6', '--', 'renamed the Owner column to Who']));
  const D2 = idOf(F.sup(['decide', '--class', 'rename-column', '--', 'split kit-09 into two tickets']));
  F.owner(['correct', D2, '--reason', 'one ticket was right']);
  const D3 = idOf(F.sup(['decide', '--class', 'rename-column', '--', 'named the page Self Improvement']));
  const T3 = idOf(F.owner(['thread', 'new', 'Is this right?', '--title', 'About this call', '--subject', JSON.stringify({ kind: 'item', ref: `decision:${D3}` })]));
  const A1 = F.hand('supervisor', { id: `a-${stamp(new Date(Date.now() - 20000))}-supervisor`, type: 'act', class: 'release-scope', what: 'tagged release v1.0.0', refs: [], reversible: true, approved_by: KPREF }, 20000);
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: INIT });
  const soon = soonIn(p);
  const go = async (hash) => { await p.ev(`location.hash = ${JSON.stringify(hash)}; void 0`); await p.ev(FRAMES); };
  const closePeek = async () => { await p.ev("document.getElementById('drawer-close')?.click(); void 0"); await soon("document.getElementById('drawer').hidden", 'the peek closed'); };
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#loop` });
  await soonIn(p, 120000)('!!DATA && !document.querySelector("main.waiting")', 'the first data drawn');

  await t.test('Observe, Orient, Decide and Act are dbTables with sortable headers and no type column', async () => {
    for (const tab of ['observe', 'orient', 'decide', 'act']) {
      await go(tab === 'observe' ? '#loop' : `#loop?lt=${tab}`);
      await soon(`${rowsOf(tab)}.length > 0`, `${tab}'s rows`);
      assert.deepEqual(await p.ev(`[...document.querySelectorAll('${BOX[tab]} table.db-t thead th')].map((th) => th.textContent.replace(/[↑↓]/g, '').trim())`), COLS[tab], `${tab}'s columns`);
      // every named header sorts: a button, and a press marks it sorted
      assert.equal(await p.ev(`[...document.querySelectorAll('${BOX[tab]} table.db-t thead th')].filter((th) => th.textContent.trim()).every((th) => th.querySelector('button.sort'))`), true, `${tab}'s headers are sort buttons`);
    }
    assert.equal(await p.ev("!!document.querySelector('#dec-who, #dec-class, #learning, #debt, #clusters, #problems')"), false, 'none of the feeds, filters or charts of today\'s page');
  });

  await t.test('Observe: How much it matters (0-4) and Good or bad (a coloured -2..2), each sortable', async () => {
    await go('#loop');
    await soon(`${rowsOf('observe')}.some((tr) => tr.textContent.includes('the checkout test takes 40s'))`, 'the observation rows');
    const row = (detail) => `${rowsOf('observe')}.find((tr) => tr.textContent.includes(${JSON.stringify(detail)}))`;
    assert.equal(await p.ev(`${row('the checkout test takes 40s')}.children[2].textContent.trim()`), '3');
    assert.equal(await p.ev(`${row('the review caught the bug')}.children[2].textContent.trim()`), '0');
    // the sign, coloured by its value: −2 and +1 are two classes and two colours
    const sign = (detail) => p.ev(`(() => { const s = ${row(detail)}.children[3].querySelector('.sign'); return s ? [s.textContent.trim(), s.className, getComputedStyle(s).color] : null; })()`);
    const bad = await sign('the checkout test takes 40s'), good = await sign('the review caught the bug');
    assert.ok(bad && good, 'Good or bad is a .sign');
    assert.match(bad[0], /^[−-]2$/);
    assert.equal(good[0], '+1');
    assert.notEqual(bad[2], good[2], 'coloured by value');
    // sorting by How much it matters: ascending, then descending
    // an observation with no severity leaves its cell blank (not 0), and sorts first going up
    assert.equal(await p.ev(`${rowsOf('observe')}.find((tr) => tr.children[0].textContent.trim() === 'payments timed out').children[2].textContent.trim()`), '');
    const sev = () => p.ev(`${cellsOf('observe', 2)}.filter((x) => x !== '').map(Number)`);
    await p.click(`${BOX.observe} table.db-t thead th:nth-child(3) button.sort`);
    await soon(`document.querySelector('${BOX.observe} table.db-t thead th:nth-child(3)')?.getAttribute('aria-sort') === 'ascending'`, 'sorted up');
    const up = await sev();
    assert.deepEqual(up, [...up].sort((a, b) => a - b));
    assert.equal(await p.ev(`${cellsOf('observe', 2)}[0]`), '', 'a blank severity sorts first going up');
    await p.click(`${BOX.observe} table.db-t thead th:nth-child(3) button.sort`);
    await soon(`document.querySelector('${BOX.observe} table.db-t thead th:nth-child(3)')?.getAttribute('aria-sort') === 'descending'`, 'sorted down');
    const down = await sev();
    assert.deepEqual(down, [...down].sort((a, b) => b - a));
    assert.equal(down[0], 3);
  });

  await t.test('Orient: lessons, facts, preferences, problems, incidents and recurring signals, with Kind, Status, Needs orienting, how long each has waited, and the header\'s Kind filter and toggle', async () => {
    await go('#loop?lt=orient');
    await soon(`${rowsOf('orient')}.length >= 6`, 'the knowledge rows');
    const kinds = await p.ev(cellsOf('orient', 1));
    for (const k of ['lesson', 'fact', 'preference', 'problem', 'incident', 'recurring signal']) assert.ok(kinds.includes(k), `a ${k} row (${kinds.join(', ')})`);
    const row = (what) => `${rowsOf('orient')}.find((tr) => tr.children[0].textContent.includes(${JSON.stringify(what)}))`;
    // what needs orienting, and how long it has waited: the signal 30 hours, the open problem 5, the fixed incident's
    // "What did it teach?" two days after it was fixed; a kept lesson needs nothing
    assert.deepEqual(await p.ev(`[${row('web/e2e failed')}.children[4].textContent.trim(), ${row('web/e2e failed')}.children[5].textContent.trim()]`), ['30 hours', 'Needs orienting']);
    assert.deepEqual(await p.ev(`[${row('A typed answer sat')}.children[4].textContent.trim(), ${row('A typed answer sat')}.children[5].textContent.trim()]`), ['5 hours', 'Needs orienting']);
    assert.deepEqual(await p.ev(`[${row('Hub refused connections')}.children[4].textContent.trim(), ${row('Hub refused connections')}.children[5].textContent.trim()]`), ['2 days', 'What did it teach?']);
    assert.deepEqual(await p.ev(`[${row('payments time out under load')}.children[2].textContent.trim(), ${row('payments time out under load')}.children[5].textContent.trim()]`), ['kept', '']);
    // the Kind filter and the Needs orienting toggle sit in the page header, and each is in the URL
    assert.equal(await p.ev("!!document.querySelector('.pagebar .extra select[data-f=\"kind\"]') && !!document.querySelector('.pagebar .extra button[data-f=\"orient\"]')"), true, 'both in the page header');
    await p.ev("(() => { const s = document.querySelector('.pagebar .extra select[data-f=\"kind\"]'); s.value = 'lesson'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
    await soon("location.hash === '#loop?lt=orient&kind=lesson'", 'the Kind filter in the URL');
    await soon(`${cellsOf('orient', 1)}.length > 0 && ${cellsOf('orient', 1)}.every((k) => k === 'lesson')`, 'lessons only');
    await go('#loop?lt=orient');
    await soon(`${rowsOf('orient')}.length >= 6`, 'every kind again');
    await p.click('.pagebar .extra button[data-f="orient"]');
    await soon("location.hash === '#loop?lt=orient&orient=1'", 'the toggle in the URL');
    await soon(`document.querySelector('.pagebar .extra button[data-f="orient"]')?.getAttribute('aria-pressed') === 'true' && ${cellsOf('orient', 5)}.length === 3 && ${cellsOf('orient', 5)}.every((x) => x)`, 'only what needs orienting');
    // the header holds them on Orient only
    await go('#loop?lt=act');
    await soon("!document.querySelector('.pagebar .extra select[data-f=\"kind\"]')", 'no Kind filter on Act');
  });

  await t.test('Decide: no filter dropdowns; Only corrected and Include routine acts in the header; Who includes the owner, never the operator', async () => {
    await go('#loop?lt=decide');
    await soon(`${rowsOf('decide')}.length >= 3`, 'the decision rows');
    assert.equal(await p.ev(`document.querySelectorAll('#loop select, .pagebar .extra select').length`), 0, 'no dropdowns');
    const toggle = (name) => `[...document.querySelectorAll('.pagebar .extra button[aria-pressed]')].find((b) => b.textContent.trim() === ${JSON.stringify(name)})`;
    assert.equal(await p.ev(`!!${toggle('Only corrected')} && !!${toggle('Include routine acts')}`), true, 'the two toggles in the header');
    const whos = await p.ev(cellsOf('decide', 2));
    assert.ok(whos.includes('you'), `the owner's standing rule is a row of yours (${whos.join(', ')})`);
    assert.ok(whos.includes('the supervisor'));
    assert.ok(whos.every((w) => !/operator/i.test(w)), 'never the operator');
    // the worker-slots start is routine: shown only with Include routine acts
    const has = (what) => `${rowsOf('decide')}.some((tr) => tr.children[0].textContent.includes(${JSON.stringify(what)}))`;
    assert.equal(await p.ev(has('made worker kit-01-pay')), false, 'no routine act at first');
    await p.ev(`${toggle('Include routine acts')}.click()`);
    await soon(`${toggle('Include routine acts')}.getAttribute('aria-pressed') === 'true' && ${has('made worker kit-01-pay')}`, 'the routine act shown');
    await p.ev(`${toggle('Include routine acts')}.click()`);
    await p.ev(`${toggle('Only corrected')}.click()`);
    await soon(`${toggle('Only corrected')}.getAttribute('aria-pressed') === 'true' && ${has('split kit-09')} && !${has('renamed the Owner column')}`, 'only the corrected call');
    await p.ev(`${toggle('Only corrected')}.click()`);
    await soon(has('renamed the Owner column'), 'every call again');
  });

  await t.test('every row of Observe, Orient, Decide and Act opens its record\'s peek on a click or Enter', async () => {
    for (const tab of ['observe', 'orient', 'decide', 'act']) {
      const head = tab === 'observe' ? '#loop' : `#loop?lt=${tab}`;
      await go(head);
      await soon(`${rowsOf(tab)}.length > 0`, `${tab}'s rows`);
      const n = await p.ev(`${rowsOf(tab)}.length`);
      for (let i = 0; i < n; i++) {
        for (const how of ['click', 'Enter']) {
          await go(head);
          await soon(`${rowsOf(tab)}.length === ${n}`, `${tab}'s rows again`);
          await p.ev(`(() => { const tr = ${rowsOf(tab)}[${i}]; tr.scrollIntoView({ block: 'center' }); tr.focus(); })()`);
          if (how === 'click') await p.ev(`${rowsOf(tab)}[${i}].children[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))`);
          else await p.key('Enter');
          // its own record: the kind and id its row's subject names (a question is #q/…), a signal by its key
          const want = await p.ev(`(() => { const tr = ${rowsOf(tab)}[${i}]; const s = tr.querySelector('[data-subject]')?.dataset.subject; if (!s) return /web\\/e2e/.test(tr.textContent) ? ['signal', ${JSON.stringify(SIG)}] : null; const at = s.indexOf(':'); return [{ question: 'q' }[s.slice(0, at)] ?? s.slice(0, at), s.slice(at + 1)]; })()`);
          assert.ok(want, `${tab} row ${i} names its record`);
          await soon(`location.hash === ${JSON.stringify(`#${want[0]}/${encodeURIComponent(want[1])}`)} && !document.getElementById('drawer').hidden && DRAWER.id === ${JSON.stringify(want[1])}`, `${tab} row ${i} opens its own peek (${want.join('/')}) on ${how}`);
          await closePeek();
        }
      }
    }
  });

  await t.test('a lesson\'s peek: its properties (status, scope, who it reaches), its evidence, and Given to with what changed after', async () => {
    // the data: the start that carried it, and its signal seen once since (the third timeout)
    const pk = JSON.parse(F.owner(['peek', 'lesson', K, '--json']));
    assert.deepEqual(pk.given_to, [{ act: START, session: 'kit-01-pay', role: 'worker', at: pk.given_to?.[0]?.at, since: 1 }]);
    assert.ok(Date.parse(pk.given_to[0].at) > 0, 'when it was given');
    assert.equal(JSON.parse(F.owner(['peek', 'lesson', KFACT, '--json'])).given_to.length, 0, 'a fact given to no one');
    await go(`#lesson/${K}`);
    await soon("!document.getElementById('drawer').hidden && !document.querySelector('#drawer-body .loading') && !!document.querySelector('#drawer-body section.attrs')", 'the lesson peek');
    const dts = await p.ev("[...document.querySelectorAll('#drawer-body section.attrs dt')].map((x) => x.textContent.trim())");
    for (const k of ['Status', 'Scope', 'Goes to']) assert.ok(dts.includes(k), `${k} (${dts.join(', ')})`);
    const sect = (head) => `[...document.querySelectorAll('#drawer-body .psect')].find((s) => s.querySelector('.card-head')?.textContent.trim() === ${JSON.stringify(head)})`;
    await soon(`!!${sect('Evidence')}`, 'its Evidence section');
    assert.deepEqual(await p.ev(`[...${sect('Evidence')}.querySelectorAll('tbody tr[data-row]')].map((tr) => tr.children[0].textContent.trim()).sort()`), ['payments timed out', 'payments timed out again']);
    // after several of the page's refreshes (every 300 ms here), one header click redraws the peek once: each listener
    // a poll stacked would write it again within the same click, which no poll can land inside (counted in one evaluation)
    await new Promise((r) => setTimeout(r, 1500));
    const evH = `${sect('Evidence')}.querySelector('thead th:nth-child(1)')`;
    const writesOnClick = () => p.ev(`(() => { const mo = new MutationObserver(() => {}); mo.observe(document.getElementById('drawer-body'), { childList: true }); ${evH}.querySelector('button.sort').click(); const n = mo.takeRecords().filter((r) => r.addedNodes.length).length; mo.disconnect(); return n; })()`);
    assert.equal(await writesOnClick(), 1, 'one write for one click');
    await soon(`${sect('Evidence')}?.querySelector('thead th:nth-child(1)')?.getAttribute('aria-sort') === 'ascending'`, 'the Evidence table sorted up');
    await new Promise((r) => setTimeout(r, 1000));
    assert.equal(await writesOnClick(), 1, 'one write for one click, after more refreshes');
    await soon(`${sect('Evidence')}?.querySelector('thead th:nth-child(1)')?.getAttribute('aria-sort') === 'descending'`, 'down by the next click');
    await soon(`!!${sect('Given to')}`, 'its Given to section');
    const given = await p.ev(`[...${sect('Given to')}.querySelectorAll('tbody tr[data-row]')].map((tr) => [...tr.children].map((c) => c.textContent.trim()))`);
    assert.equal(given.length, 1, JSON.stringify(given));
    assert.equal(given[0][0], 'kit-01-pay');
    assert.match(given[0].at(-1), /^seen again 1 time since$/);
    // a session's row opens the start that carried it
    await p.ev(`${sect('Given to')}.querySelector('tbody tr[data-row]').children[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))`);
    await soon(`location.hash === '#act/${START}'`, 'the start\'s act');
    await closePeek();
  });

  await t.test('the Trust Score\'s lessons link lands on Orient filtered to lessons', async () => {
    await go('#trust');
    await soon("!!document.querySelector('#trust a[href=\"#loop?lt=orient&kind=lesson\"]')", 'the lessons link');
    await p.ev("document.querySelector('#trust a[href=\"#loop?lt=orient&kind=lesson\"]').click()");
    await soon("location.hash === '#loop?lt=orient&kind=lesson' && document.querySelector('#loop-tabs [aria-selected=\"true\"]')?.dataset.tab === 'orient'", 'Orient');
    await soon(`${cellsOf('orient', 1)}.length > 0 && ${cellsOf('orient', 1)}.every((k) => k === 'lesson') && document.querySelector('.pagebar .extra select[data-f="kind"]')?.value === 'lesson'`, 'filtered to lessons, the filter showing it');
  });

  await t.test('Self Improvement\'s kind and orient are never remembered: a nav click carries neither, and a Library Kind filter never lands on it', async () => {
    await go('#loop?lt=orient&kind=lesson&orient=1');
    await soon("location.hash === '#loop?lt=orient&kind=lesson&orient=1'", 'filtered');
    await go('#library');
    // the Library's Kind filter, remembered
    await p.ev("localStorage.setItem('devteam.board.filters', JSON.stringify({ kind: 'artifact' })); void 0");
    await p.ev("document.querySelector('nav a[href=\"#loop\"]').click()");
    await soon("location.hash === '#loop'", 'a nav click lands on #loop with no filter');
    await p.ev(FRAMES);
    assert.equal(await p.ev('location.hash'), '#loop', 'and stays so');
    assert.equal(await p.ev("JSON.parse(localStorage.getItem('devteam.board.filters') || '{}').orient ?? null"), null, 'orient is never stored');
  });

  await t.test('Correct on a decision or an act, on its row and in its peek, opens a thread about it; nothing is recorded from the click', async () => {
    const posts0 = await p.ev('window.__posts.length');
    const draftOn = (ref, words) => `!!TL.draft && TL.draft.subject?.kind === 'item' && TL.draft.subject?.ref === ${JSON.stringify(ref)} && !TL.open && String(TL.draft.title).includes(${JSON.stringify(words)})`;
    // a peek opened first, so a title left over from it would show (the row's Correct titles its thread from the row)
    await go(`#lesson/${K}`);
    await soon("!document.getElementById('drawer').hidden", 'another peek first');
    await closePeek();
    const dropDraft = async () => { await p.key('Escape'); await soon('!TL.draft', 'the draft dropped'); };
    // on its row
    await go('#loop?lt=decide');
    const corr = (box, ref) => `${box} [data-thread-on="${ref}"]`;
    await soon(`!!document.querySelector(${JSON.stringify(corr(BOX.decide, `decision:${D1}`))})`, 'Correct on the decision\'s row');
    assert.equal(await p.ev(`document.querySelector(${JSON.stringify(corr(BOX.decide, `decision:${D1}`))}).textContent.trim()`), 'Correct');
    await p.ev(`document.querySelector(${JSON.stringify(corr(BOX.decide, `decision:${D1}`))}).click()`);
    await soon(draftOn(`decision:${D1}`, 'renamed the Owner column to Who'), 'a thread about to start on the decision, titled with its words');
    assert.equal(await p.ev("location.hash.startsWith('#loop')"), true, 'the row\'s own Correct opens no peek');
    await dropDraft();
    await go('#loop?lt=act');
    await soon(`!!document.querySelector(${JSON.stringify(corr(BOX.act, `act:${A1}`))})`, 'Correct on the act\'s row');
    await p.ev(`document.querySelector(${JSON.stringify(corr(BOX.act, `act:${A1}`))}).click()`);
    await soon(draftOn(`act:${A1}`, 'tagged release v1.0.0'), 'a thread about to start on the act, titled with its words');
    await dropDraft();
    // in its peek
    for (const [kind, id, words] of [['decision', D1, 'renamed the Owner column to Who'], ['act', A1, 'tagged release v1.0.0']]) {
      await go(`#${kind}/${id}`);
      await soon(`!document.getElementById('drawer').hidden && !!document.querySelector('#drawer-body [data-thread-on="${kind}:${id}"]')`, `Correct in the ${kind}'s peek`);
      assert.equal(await p.ev(`document.querySelector('#drawer-body [data-thread-on="${kind}:${id}"]').textContent.trim()`), 'Correct');
      await p.ev(`document.querySelector('#drawer-body [data-thread-on="${kind}:${id}"]').click()`);
      await soon(draftOn(`${kind}:${id}`, words), `a thread about to start on the ${kind}, from its peek, titled with its words`);
      await dropDraft();
      await closePeek();
    }
    // none of today's correct forms
    assert.equal(await p.ev("document.querySelectorAll('#loop [data-correct], #loop [data-correct-form]').length"), 0, 'no inline correct form');
    assert.deepEqual(await p.ev(`window.__posts.slice(${posts0})`), [], 'nothing posted by a Correct');
    // a subject with an unresolved thread: its Correct opens that thread, and no second is made
    await go('#loop?lt=decide');
    await soon(`!!document.querySelector(${JSON.stringify(corr(BOX.decide, `decision:${D3}`))})`, 'Correct on the call with a thread');
    await p.ev(`document.querySelector(${JSON.stringify(corr(BOX.decide, `decision:${D3}`))}).click()`);
    await soon(`TL.open === ${JSON.stringify(T3)} && !TL.draft`, 'its open thread');
    await p.key('Escape');
    assert.deepEqual(await p.ev(`window.__posts.slice(${posts0})`), [], 'nothing posted');
    const threadsOn = (ref) => JSON.parse(F.owner(['thread', 'list', '--json'])).filter((x) => x.subject?.ref === ref);
    assert.equal(threadsOn(`decision:${D3}`).length, 1, 'one thread on it');
  });

  await t.test('the owner\'s words in the thread Correct opened become the correction when the supervisor records them (kit-101)', async () => {
    await go('#loop?lt=decide');
    const sel = `${BOX.decide} [data-thread-on="decision:${D1}"]`;
    await soon(`!!document.querySelector(${JSON.stringify(sel)})`, 'Correct on the decision');
    await p.ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
    await soon(`TL.draft?.subject?.ref === 'decision:${D1}'`, 'the draft');
    // no '.': the typing helper sends it as Delete (test/lib/chrome.mjs KEYS)
    const words = 'That was the wrong name: keep Owner';
    await p.click('#tl-c-text');
    await p.type(words);
    await p.click('[data-tl-send]');
    const T = await soon(`TL.threads.find((x) => x.subject?.ref === 'decision:${D1}' && !String(x.id).startsWith('pending-'))?.id`, 'the thread read back');
    const th = JSON.parse(F.owner(['thread', 'show', T, '--json']));
    assert.deepEqual({ kind: th.subject.kind, ref: th.subject.ref }, { kind: 'item', ref: `decision:${D1}` });
    // the thread's opening words are no correction: the log has none on D1
    const corrections = () => fs.readdirSync(F.logDir).flatMap((f) => fs.readFileSync(path.join(F.logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))).filter((l) => l.id === D1 && l.corrected);
    assert.deepEqual(corrections(), [], 'no correction from the click or the thread');
    const U = th.turns[0].id;
    F.sup(['correct', D1, '--from-turn', U, '--said', words]);
    const c = corrections();
    assert.equal(c.length, 1);
    assert.deepEqual([c[0].by, c[0].channel, c[0].corrected.turn, c[0].corrected.said], ['owner', 'thread', U, words]);
    // and the row says so once the page reads it
    // D1's own row (not the correction's row, which names it too): Corrected yes, and no Correct left on it
    const own = `${rowsOf('decide')}.find((tr) => tr.querySelector('[data-subject="decision:${D1}"]') && tr.children[0].textContent.trim().startsWith('renamed the Owner column'))`;
    await soon(`!!${own} && ${own}.children[4].textContent.trim() === 'yes' && !${own}.querySelector('[data-thread-on]')`, 'its own row corrected, its Correct gone');
  });

  await t.test('Self Improvement keeps its tables only: no learning charts or Informed card', async () => {
    for (const tab of ['observe', 'orient', 'decide', 'act']) {
      await go(tab === 'observe' ? '#loop' : `#loop?lt=${tab}`);
      await soon(`document.querySelector('#loop-tabs [aria-selected="true"]')?.dataset.tab === '${tab}'`, `${tab} shown`);
      assert.equal(await p.ev("document.querySelectorAll('#loop svg, #loop .learning, #loop [data-learn], #loop .loop-intro, #loop h2 .sub').length"), 0, `${tab}: no charts, no Informed card, no explanations`);
    }
    assert.ok(!(await p.ev("document.getElementById('loop').textContent")).includes('Informed'), 'no Informed card');
  });
});
