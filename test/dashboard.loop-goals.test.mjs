// The Loop and goals in Chrome: the sidepeeks, and a goal approval from the phone.
// Ports: +0/+1..25 lib/kit.mjs's; +84/85 a goal approval from the phone
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PORTS, fleetFixture, bareProject, dashboardOnFreePort } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { soonIn, POLL_FAST } from './lib/dashboard-page.mjs';

// The Loop's sidepeeks (the OODA spec, PR 3): every card opens one when clicked anywhere on it; an
// observation's says where it came from and where it sits; a signal opens by its key, / and all.
test('the Loop: a card opens its sidepeek; an observation says where it came from and where it sits; a signal opens by its key', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 }, async (t) => {
  // stopped last-in first-out, each whatever the one before did: the fixture's files go only once the
  // dashboard writing into them (a data run every 300 ms here) has stopped
  const later = cleanup(t);
  const F = fleetFixture('loop-peeks');
  later(() => F.done());
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const O1 = F.ok(F.old, ['observe', '--subject', 'app', '--kind', 'slow-test', '--detail', 'the checkout test is slow'], SUP);
  const O2 = F.ok(F.old, ['observe', '--subject', 'app', '--kind', 'slow-test', '--detail', `slower than ${O1}`], SUP);
  // two more that became a lesson: each has a lineage to draw
  const O3 = F.ok(F.old, ['observe', '--subject', 'pay', '--kind', 'timeout', '--detail', 'payments timed out'], SUP);
  const O4 = F.ok(F.old, ['observe', '--subject', 'pay', '--kind', 'timeout', '--detail', 'payments timed out again'], SUP);
  const K = F.ok(F.old, ['knowledge', 'add', '--kind', 'lesson', '--scope', 'project', '--statement', 'payments time out under load', '--evidence', O3, O4], SUP).match(/k-\S+/)[0];
  // a finding whose subject holds a /, three times on two days: a recurring signal
  const logDir = path.join(F.old, 'docs/devteam/run/log');
  const stamp = (d) => `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
  for (const h of [30, 28, 2]) {
    const d = new Date(Date.now() - h * 3600000);
    fs.appendFileSync(path.join(logDir, `supervisor-${d.toISOString().slice(0, 7)}.jsonl`), `${JSON.stringify({ v: 1, op: 'new', type: 'observation', id: `o-${stamp(d)}-supervisor`, at: d.toISOString(), by: 'supervisor', source: 'metrics', detector: 'metrics', subject: 'web/e2e', kind: 'flaky-gate', detail: 'web/e2e failed, then passed', source_key: 'metrics:flaky-gate:web/e2e' })}\n`);
  }
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
  // the fixture's hooks, so a click can hold the page still; its polls every 300 ms, so a refresh
  // landing mid-step is the usual case here, not a rare one
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: POLL_FAST });
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#loop` });
  // 30 s a look, by the clock: a count of looks is shorter the slower each one is
  const soon = soonIn(p, 30000, () => dash.out());
  // The first read waits for the server's first data run, however long: on a loaded runner a fleet
  // fixture's takes tens of seconds, and the server gives it 2 minutes before it stops it.
  await soonIn(p, 120000, () => dash.out())('!!DATA', 'the first data drawn');
  // A click with nothing landing from finding the card to the release's own work (pointerup's
  // setTimeout draws what the press held back), so a refresh can't move or replace what is clicked.
  const click = async (sel) => { await p.ev('window.__still()'); try { await p.click(sel); await soon('PRESSED === 0', 'the release handled'); } finally { await p.ev('window.__stir()'); } };
  // kit-96: the Observe feed is a table, one row per observation, its first cell's [data-subject] naming the record; the
  // card's place line and the young instance's tiles are gone (the place is the peek's Where it sits, checked below)
  const card = (sel) => `#observations tr[data-row]:has([data-subject="observation:${sel}"])`;
  await soon(`!!document.querySelector('${card(O1)}')`, 'the observation row');
  // an o- id in text links to its sidepeek
  assert.equal(await p.ev(`document.querySelector('${card(O2)}').querySelector('a[href="#observation/${O1}"]') !== null`), true, 'an o- id in text is a link');
  // a click anywhere on the row (here its first cell, no link in it) opens it
  await click(`${card(O1)} td`);
  await soon(`location.hash === '#observation/${O1}' && !document.getElementById('drawer').hidden`, 'the observation sidepeek');
  // where it came from, under its properties (kit-88: every peek opens with its properties)
  await soon(`/From the supervisor/.test(document.querySelector('#drawer-body section.attrs + [data-from]')?.textContent ?? '')`, 'where it came from, under the properties');
  // an attribute's value, by its label (its tooltip is the key's title)
  const attr = (label) => p.ev(`[...document.querySelectorAll('#drawer-body .attrs dt')].find((x) => x.textContent.startsWith(${JSON.stringify(label)}))?.nextElementSibling?.textContent ?? null`);
  assert.equal(await attr('Where it sits'), 'Part of a recurring signal (2 of 3)', 'two slow-test notes on app, of the three a signal takes');
  assert.match(await p.ev(`document.getElementById('drawer-bar-title').textContent`), /Observation/);
  // a signal whose key holds a /: its card opens #signal/<key>
  await p.ev(`document.getElementById('drawer-close').click()`);
  // closed once it has slid out (kit-88): until then it still covers the cards under it
  await soon(`document.getElementById('drawer').hidden`, 'the peek closed');
  await click('[data-tab="orient"]');
  // kit-96: the recurring signal is a row of the Knowledge table (its first cell holds the signal's detail, no data-subject);
  // #debt is gone (the thirty hours unexplained are that table's Waiting column, checked by A3 in dashboard-loop.test.mjs)
  const sigAt = `[...document.querySelectorAll('#knowledge tr[data-row]')].find((tr) => /web\\/e2e failed/.test(tr.children[0].textContent))`;
  await soon(`!!(${sigAt})`, 'the signal row');
  const sig = `#knowledge tr[data-row="${await p.ev(`${sigAt}.dataset.row`)}"]`;
  await click(`${sig} td`);
  await soon(`decodeURIComponent(location.hash) === '#signal/metrics:flaky-gate:web/e2e' && !document.getElementById('drawer').hidden`, 'the signal sidepeek');
  await soon(`document.querySelectorAll('#drawer-body .psect-body > ul a[href^="#observation/"]').length === 3`, 'its three observations');
  assert.match(await p.ev(`document.getElementById('drawer-bar-title').textContent`), /Recurring signal/);
  assert.equal(await attr('Unexplained for'), '30 hours');
  // the lineage: Mermaid blocked, the list stands in, every record in it a link
  await p.ev(`document.getElementById('drawer-close').click(); void (MERMAID = Promise.reject(new Error('blocked')))`);
  await p.ev(`location.hash = '#observation/${O3}'`);
  await soon(`document.querySelectorAll('#drawer-body .lineage-list a[href]').length === 2`, 'the lineage as a list');
  assert.deepEqual(await p.ev(`[...document.querySelectorAll('#drawer-body .lineage-list a[href]')].map((a) => a.getAttribute('href'))`), [`#observation/${O3}`, `#lesson/${K}`]);
  assert.equal(await p.ev(`document.querySelector('#drawer-body .lineage-list [aria-current]').getAttribute('href')`), `#observation/${O3}`);
  assert.equal(await p.ev(`/flowchart/.test(document.getElementById('drawer-body').textContent)`), false, 'never the Mermaid source');
  // Mermaid available (it loads from its CDN, so a machine offline keeps the list): each node opens its sidepeek
  await p.ev(`document.getElementById('drawer-close').click(); MERMAID = null`);
  await p.ev(`location.hash = '#observation/${O4}'`);
  await soon(`!!document.querySelector('#drawer-body .lineage-list, #drawer-body .lineage svg')`, 'the lineage');
  let drawn = false;
  for (let i = 0; i < 300 && !drawn; i++) { drawn = await p.ev(`!!document.querySelector('#drawer-body .lineage svg a.lineage-node')`); if (!drawn) await new Promise((r) => setTimeout(r, 100)); }
  if (!drawn) return t.diagnostic('Mermaid did not load (offline?): the graph and its links were not checked');
  assert.equal(await p.ev(`document.querySelector('#drawer-body .lineage svg a[aria-current]').getAttribute('href')`), `#observation/${O4}`);
  assert.equal(await p.ev(`document.querySelectorAll('#drawer-body .lineage svg a.lineage-node title').length`), 2, 'each node titled');
  // the peek at rest (kit-88: it reopened as the last one slid out), so the click lands where the node is
  await soon(`getComputedStyle(document.getElementById('drawer')).transform === 'none'`, 'the peek at rest');
  await click('#drawer-body .lineage svg a.lineage-node:not([aria-current])');
  await soon(`location.hash === '#lesson/${K}'`, 'a node opens its sidepeek');
});

// kit-287: a goal's approval from the phone, the way the owner presses it (390 px wide, the Inbox's
// card): the recommended choice and Send record the approval once; a recommendation that names no
// verdict is said in words; a refusal says plainly what went wrong, and Send works again.
test('a goal approval from the phone', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 240000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-goal-phone-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 84), DEVTEAM_PORT_BASE: String(PORTS + 85), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of Object.keys(env)) if (k.startsWith('DEVTEAM_') && !['DEVTEAM_HUB_PORT', 'DEVTEAM_PORT_BASE'].includes(k)) delete env[k];
  for (const k of ['TMUX', 'TMUX_PANE']) delete env[k];
  const root = bareProject(base, 'goal-phone');
  const dt = (args, role = { DEVTEAM_ROLE: 'supervisor' }) => { const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: root, env: { ...env, ...role }, encoding: 'utf8' }); assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
  // a goal defined in full, with a reading and milestones, and its design up for approval
  const approval = (title, rec, priority) => {
    const g = dt(['goal', 'add', '--title', title, '--outcome', `${title} holds`, '--measure', 'self-serve share', '--target', '80', '--unit', '%', '--direction', 'up', '--source', 'prod', '--check', 'echo 5', '--horizon', '2027-03-31', '--non-goals', 'enterprise invoicing', '--preconditions', 'cards work', 'prices defined', '--priority', String(priority)]).split('\n')[0].trim();
    dt(['goal', 'reading', g, '--run']);
    dt(['goal', 'set', g, '--milestones', JSON.stringify([{ title: 'Most admins pay alone', target: 80, preconditions: [1, 2], tickets: 2 }])]);
    const q = dt(['ask', '--kind', 'goal-approval', '--goal', g, '--question', `Approve the ${title} design?`, '--recommendation', rec, '--links', JSON.stringify([{ title: 'The design', path: 'docs/devteam/project/designs/x.md' }])]).split('\n')[0].trim();
    return { g, q };
  };
  const GY = approval('Admins pay alone', 'Yes', 1);
  const GR = approval('Refunds without support', 'Refine the measure', 2);
  // what the log holds for a goal's decision and its question's answer, as goal decide writes them
  const logLines = () => fs.readdirSync(path.join(root, 'docs/devteam/run/log')).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(root, 'docs/devteam/run/log', f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  const decided = (g, verdict) => logLines().filter((l) => l.type === 'goal' && l.op === 'set' && l.id === g && l.decision?.verdict === verdict).length;
  const answers = (q) => logLines().filter((l) => l.type === 'question' && l.op === 'set' && l.id === q && l.answer !== undefined).length;
  const asked = (q) => JSON.parse(dt(['questions', '--all', '--json'])).find((x) => x.id === q);
  const { dash, port } = await dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  // kit-300: DEVTEAM_TEST_CPU_THROTTLE=<n> runs the page n times slower, as a loaded runner does;
  // DEVTEAM_TEST_SLIDE_MS=<ms> makes the panel's slide-in take that long, so a click aimed while it
  // moves (the race this test lost on CI, where the cards drew before the slide had ended) always shows
  if (process.env.DEVTEAM_TEST_CPU_THROTTLE) await p.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.DEVTEAM_TEST_CPU_THROTTLE) });
  if (process.env.DEVTEAM_TEST_SLIDE_MS) await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => document.documentElement.style.setProperty('--dur', '${Number(process.env.DEVTEAM_TEST_SLIDE_MS)}ms'))` });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: POLL_FAST });
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#questions` });
  const soon = soonIn(p, 30000, () => dash.out());
  const card = (q) => `document.getElementById('q-${q}')`;
  // a step no read lands in, from finding what to click to the release's own work (pointerup's
  // setTimeout draws what the press held back), as the presses test has it: a redraw can't replace
  // what is clicked between its press and its release
  const still = async (f) => { await p.ev('window.__still()'); try { await f(); await soon('PRESSED === 0', 'the release handled'); } finally { await p.ev('window.__stir()'); } };
  await soon(`!!${card(GY.q)} && !!${card(GR.q)} && innerWidth === 390`, 'both approvals, on a phone');
  // kit-300: the cards are the Threads panel's Inbox tab (#th-inbox #questions), which slides in over
  // --dur. A click aims at where its target is, then presses there: aimed while the panel still moves
  // (the cards can draw before the slide ends), the press lands beside the choice and picks nothing
  await soon(`document.body.classList.contains('threads-open') && getComputedStyle(document.getElementById('threads')).transform === 'none'`, 'the panel open on Inbox, at rest');

  await t.test('a recommendation that names no verdict is said as words', async () => {
    const shown = async (q) => JSON.parse(await p.ev(`JSON.stringify((() => { const c = ${card(q)}; return { suggest: c.querySelector('[data-goal-suggest]')?.textContent ?? null, labels: [...c.querySelectorAll('input[data-pick]')].map((i) => i.value), rec: [...c.querySelectorAll('.choice.rec input')].map((i) => i.value) }; })())`));
    assert.deepEqual(await shown(GR.q), { suggest: 'Suggested: Refine the measure', labels: ['Approve', 'Refine', 'Let go'], rec: [] }, 'the suggestion in words; no choice marked, none added');
    assert.deepEqual(await shown(GY.q), { suggest: null, labels: ['Approve', 'Refine', 'Let go'], rec: ['Approve'] }, '"Yes" marks Approve, with no line of its own');
  });

  // the goal's status as the dashboard's server has it
  const goalStatus = async (g) => (await (await fetch(`http://127.0.0.1:${port}/api/data`)).json()).ooda.goals.find((x) => x.id === g)?.status;
  // a wait on the server, whose failure says what the card said (a refusal, in the red run)
  const onServer = async (f, what, q) => {
    const end = Date.now() + 30000;
    while (!(await f())) {
      if (Date.now() > end) assert.fail(`timed out: ${what}; the card says: ${JSON.stringify(await p.ev(`${card(q)}?.querySelector('[data-refused]')?.textContent ?? ${card(q)}?.querySelector('.err')?.textContent ?? 'no card'`))}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  await t.test('a stale pick is refused on the page, and nothing is posted', async () => {
    let said = null;
    // the click and the read in one still step: no read redraws the card's error line between them
    await still(async () => { said = await p.ev(`(() => { picks['${GR.q}'] = 'Yes'; window.__posts = []; ${card(GR.q)}.querySelector('[data-answer]').click(); return document.getElementById('e-${GR.q}').textContent; })()`); });
    assert.equal(said, 'Choose Approve, Refine or Let go.');
    assert.deepEqual(JSON.parse(await p.ev('JSON.stringify(window.__posts)')), [], 'nothing posted');
    await p.ev(`delete picks['${GR.q}']; void 0`);
  });

  await t.test('refused, said plainly, and pressed again: recorded once', async () => {
    // the next goal press reaches the real server with a verdict it doesn't take, as a page older
    // than its server could send one
    await p.ev(`(() => { const f0 = window.fetch; window.__badVerdict = true; window.fetch = (u, o) => { if (window.__badVerdict && String(u) === '/api/goal-decide') { window.__badVerdict = false; o = { ...o, body: JSON.stringify({ ...JSON.parse(o.body), verdict: 'yes' }) }; } return f0(u, o); }; })(); void 0`);
    // the pick pressed, and the note written as an input event (a focus from a phone's emulated tap
    // isn't certain on a loaded runner, and typing isn't what this checks), in one still step: no
    // read redraws the card between them
    await still(async () => {
      await p.click(`#q-${GR.q} input[data-pick][value="Refine"]`);
      await p.ev(`(() => { const ta = ${card(GR.q)}.querySelector('textarea[data-q]'); ta.value = 'a smaller measure'; ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    });
    await soon(`${card(GR.q)}.querySelector('textarea[data-q]').value === 'a smaller measure'`, 'the note typed');
    await still(() => p.click(`#q-${GR.q} [data-answer]`));
    // timed out, it says what the card showed instead: its error line, the pick, what was posted
    for (const end = Date.now() + 30000; !(await p.ev(`!!${card(GR.q)}?.querySelector('[data-refused]')`));) {
      if (Date.now() > end) assert.fail(`timed out: the refusal, on the card; it shows ${await p.ev(`JSON.stringify({ err: document.getElementById('e-${GR.q}')?.textContent ?? null, pick: picks['${GR.q}'] ?? null, posts: (window.__posts ?? []).map((x) => x.url) })`)}`);
      await new Promise((r) => setTimeout(r, 50));
    }
    const said = await p.ev(`${card(GR.q)}.querySelector('[data-refused]').textContent`);
    assert.match(said, /^Not saved: the server didn't take this approval as sent, and nothing was recorded\. Reload the page and press Approve, Refine or Let go again\./, said);
    assert.doesNotMatch(said, /missing or invalid fields/, 'never the server\'s terse words');
    assert.equal(await p.ev(`${card(GR.q)}.querySelector('input[data-pick][value="Refine"]').checked`), true, 'the pick back');
    assert.equal(await p.ev(`${card(GR.q)}.querySelector('textarea[data-q]').value`), 'a smaller measure', 'the note back');
    assert.equal(asked(GR.q).status, 'open', 'nothing recorded');
    await still(() => p.click(`#q-${GR.q} [data-answer]`));
    await onServer(() => asked(GR.q).status === 'answered', 'the approval pressed again, on the server', GR.q);
    assert.equal(asked(GR.q).answer, 'Refine — a smaller measure');
    assert.equal(decided(GR.g, 'refine'), 1, 'one decision');
    assert.equal(answers(GR.q), 1, 'one answer');
  });

  await t.test("any other press's refusal of a body the server can't read is said plainly too", async () => {
    // the goal's own Let go and Restore post goal-decide as well: their refusal names no Approve or Refine
    const said = await p.ev(`(async () => { const s = document.createElement('span'); s.id = 'e-plain-probe'; document.body.append(s); await press('plain-probe', { build: () => ({ action: 'goal-decide', body: { id: '${GR.g}', verdict: 'nonsense' } }), errId: 'plain-probe' }); const t = s.textContent; s.remove(); return t; })()`);
    assert.equal(said, "Not saved: the server didn't take what this page sent, and nothing was recorded. Reload the page and try again.");
  });

  await t.test('the recommended press is recorded once', async () => {
    await still(() => p.click(`#q-${GY.q} .choice.rec input[data-pick]`));
    await soon(`${card(GY.q)}.querySelector('.choice.rec input[data-pick]').checked`, 'the recommended choice picked');
    // pressed as the owner presses it, whatever the recommended choice is called: before #337 it was
    // "Yes", and the server refused the press ("missing or invalid fields", shown by this wait failing)
    await still(() => p.click(`#q-${GY.q} [data-answer]`));
    await onServer(async () => asked(GY.q).status === 'answered' && (await goalStatus(GY.g)) === 'ready', 'the approval recorded and the goal ready', GY.q);
    assert.equal(asked(GY.q).answer, 'Approve');
    assert.equal(decided(GY.g, 'approve'), 1, 'one decision');
    assert.equal(answers(GY.q), 1, 'one answer');
  });
});
