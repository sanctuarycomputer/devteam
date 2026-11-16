// An owner-action card carries the owner's own controls for the records its context names (Retire it,
// Keep it, Let go then Confirm let go), posting what the Knowledge and Goals pages post; its answers are
// always Done and Can't right now, a recommendation is a line of text, and Done never answers while a
// named record is unchanged. Real headless Chrome over a real dashboard; posts are recorded, not stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PORTS, bareProject, dashboardOnFreePort } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

// the 10 s refresh at 300 ms, a poll counter, and every POST to /api/ recorded
const initScript = `(() => {
  const si = window.setInterval;
  window.setInterval = (f, ms, ...a) => si(f, ms === 10000 ? 300 : ms, ...a);
  window.__polls = 0;
  window.__posts = [];
  const real = window.fetch;
  window.fetch = async (u, o) => {
    if (String(u).startsWith('/api/data')) window.__polls++;
    if (o?.method === 'POST' && String(u).startsWith('/api/')) window.__posts.push({ url: String(u), body: JSON.parse(o.body || 'null') });
    return real(u, o);
  };
})();`;

// a wait on a condition in the page (this file's own copy of dashboard.test.mjs's soonIn)
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

test('owner-action: the named records\' own controls, Done and Can\'t right now, and Done waits for the act', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 240000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-owner-action-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { ...process.env, DEVTEAM_HUB_PORT: String(PORTS + 44), DEVTEAM_PORT_BASE: String(PORTS + 45), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'DEVTEAM_HOME', 'TMUX', 'TMUX_PANE']) delete env[k];
  const root = bareProject(base, 'owner-action');
  const dt = (args, role = {}) => { const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: root, env: { ...env, ...role }, encoding: 'utf8' }); assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
  // a command that makes a record prints its id first (a note may follow)
  const mk = (args, role) => dt(args, role).split('\n')[0].trim();
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const lesson = (statement, status) => { const id = mk(['knowledge', 'add', '--kind', 'fact', '--statement', statement], SUP); if (status) dt(['knowledge', 'set', id, '--status', status], SUP); return id; };
  const goal = (title) => mk(['goal', 'add', '--title', title, '--outcome', `${title} holds`, '--measure', 'gaps', '--target', '0', '--unit', 'gaps', '--direction', 'down', '--source', 'repo', '--check', 'echo 3', '--non-goals', 'none', '--preconditions', 'a'], SUP);
  const KA = lesson('Deploys wait for a green build', 'accepted');
  const KB = lesson('Branches are named after tickets', 'accepted');
  const KC = lesson('Logs are kept for a week', 'accepted');
  const KE = lesson('Only the owner changes DNS', 'accepted');
  const KR = lesson('Banners ship without asking', 'retired');
  const KO = mk(['knowledge', 'add', '--kind', 'fact', '--statement', 'The build uses make', '--for-owner', '--plain', 'The project is built with one standard tool.'], SUP);
  const [G, GT, GB, GQ, GL] = ['Faster pages', 'Fewer pages', 'Better pages', 'Kept pages', 'A goal'].map(goal);
  dt(['goal', 'decide', GL, 'let-go', '--owner']);
  const T = mk(['thread', 'new', 'Tidy the leftovers']);
  const Q = mk(['thread', 'ask', T, '--kind', 'owner-action', '--question', 'Please tidy six records on the dashboard',
    '--context', `- Retire ${KA} and ${KR}.\n- Keep ${KO}.\n- Let go ${G}, ${GT} and ${GL}.`,
    '--recommendation', 'Do all four', '--goal', GQ, '--evidence', KE, '--stake', '1', '--urgency', '1'], SUP);
  const Q2 = mk(['ask', '--kind', 'owner-action', '--question', 'Please renew the certificate', '--context', 'It expires next week.', '--goal', GQ, '--evidence', KE, '--stake', '1', '--urgency', '1'], SUP);
  const Q3 = mk(['ask', '--kind', 'owner-action', '--question', 'Please look at one rule', '--context', `Retire ${KC} if it no longer holds.`, '--stake', '1', '--urgency', '1'], SUP);
  const statusOf = (id) => JSON.parse(dt(['log', '--type', 'knowledge', '--json'])).filter((o) => o.id === id).map((o) => o.status).filter(Boolean).pop();

  const { dash, port } = await dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: initScript });
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#questions` });
  const soon = soonIn(p, 20000, () => dash.out());
  const polls = async (n = 2) => { const at = await p.ev('window.__polls'); await soon(`window.__polls >= ${at + n}`, `${n} polls`); };
  const card = (q) => `document.querySelector('#questions [data-qcard="${q}"]')`;
  const tcard = (q) => `document.querySelector('#t-q-${q}')`;
  const row = (q, id, c = card) => `${c(q)}?.querySelector('[data-oa-rec="${id}"]')`;
  const done = (q, id, c = card) => `(${row(q, id, c)}?.querySelector('[data-oa-done]')?.textContent.trim() ?? '')`;
  const marked = (q, id, c = card) => `!!${row(q, id, c)}?.querySelector('[data-oa-notdone]')`;
  const posts = (url, f = () => true) => p.ev(`window.__posts.filter((x) => x.url === ${JSON.stringify(url)})`).then((xs) => xs.filter(f));
  const answers = (q) => posts('/api/answer', (x) => x.body.id === q);
  // p.click measures, then presses: a reflow in between moves the card under the press. An answered
  // card stays as its note until a redraw of data without it removes it, moving every card below up,
  // and that data makes the next card the next best step: wait for that redraw before the next click.
  const redrawnWithout = (q) => soon(`!DATA.questions.some((x) => x.id === ${JSON.stringify(q)}) && !${card(q)}`, `the Inbox redrawn without ${q}`);
  await soon(`!!${card(Q)} && !!${card(Q2)} && !!${card(Q3)}`, 'the owner-action cards');

  await t.test('answers: Done and Can\'t right now, the recommendation a line of text, a row per record its context names', async () => {
    assert.deepEqual(await p.ev(`[...${card(Q)}.querySelectorAll('input[data-pick]')].map((x) => x.value)`), ['Done', 'Can’t right now']);
    assert.equal(await p.ev(`[...${card(Q)}.querySelectorAll('button, input, label.choice')].filter((x) => /Do all four/.test(x.textContent + (x.value || ''))).length`), 0, 'the recommendation is no button or choice');
    assert.equal(await p.ev(`${card(Q)}.querySelector('[data-oa-suggest]')?.textContent.trim()`), 'Suggested: Do all four');
    assert.deepEqual(await p.ev(`[...${card(Q)}.querySelectorAll('[data-oa-rec]')].map((x) => x.dataset.oaRec)`), [KA, KR, KO, G, GT, GL], 'the context\'s records, not its evidence or its own goal');
    assert.match(await p.ev(`${row(Q, KO)}.textContent`), /The project is built with one standard tool/, 'an owner lesson in its plain words');
    assert.equal(await p.ev(`${card(Q2)}.querySelectorAll('[data-oa-rec]').length`), 0, 'a question citing a rule and serving a goal names no record');
  });

  await t.test('already done shows done, with no control', async () => {
    await soon(`${done(Q, KR)} === 'Done: retired' && ${done(Q, GL)} === 'Done: let go'`, 'the retired rule and the let-go goal done');
    assert.equal(await p.ev(`${row(Q, KR)}.querySelectorAll('button').length + ${row(Q, GL)}.querySelectorAll('button').length`), 0);
    assert.deepEqual(await p.ev(`[...${row(Q, KO)}.querySelectorAll('button')].map((b) => b.textContent.trim())`), ['Keep it', 'Retire it']);
    assert.deepEqual(await p.ev(`[...${row(Q, KA)}.querySelectorAll('button')].map((b) => b.textContent.trim())`), ['Retire it']);
    assert.deepEqual(await p.ev(`[...${row(Q, G)}.querySelectorAll('button')].map((b) => b.textContent.trim())`), ['Let go']);
  });

  await t.test('Done waits: not done yet beside each unchanged record, on both copies, and nothing posted', async () => {
    // the web fonts in first: a monospace face asked for once the cards first draw swaps in and reflows them
    await soon(`document.fonts.status === 'loaded'`, 'the page\'s fonts');
    await p.click(`#questions [data-qcard="${Q}"] input[data-pick][value="Done"]`);
    await p.click(`#questions [data-qcard="${Q}"] [data-answer]`);
    await soon(`${marked(Q, KA)} && ${marked(Q, KO)} && ${marked(Q, G)} && ${marked(Q, GT)}`, 'not done yet on each unchanged record');
    assert.equal(await p.ev(`${marked(Q, KR)} || ${marked(Q, GL)}`), false, 'none on the done ones');
    assert.match(await p.ev(`${card(Q)}.querySelector('[data-oa-anyway]')?.textContent ?? ''`), /Not done yet/);
    await p.ev('redrawNow(); void 0');
    await polls(1);
    assert.equal(await p.ev(`${marked(Q, KA)}`), true, 'still there after a redraw and a poll');
    assert.equal((await answers(Q)).length, 0, 'no answer posted');
    await p.ev(`location.hash = '#talk/${T}'`);
    await soon(`!document.getElementById('tl-card').hidden && !!${tcard(Q)}`, 'the thread, with its copy of the question');
    await soon(`${marked(Q, KA, tcard)} && ${marked(Q, GT, tcard)} && !${marked(Q, KR, tcard)}`, 'the same marks on the thread copy');
  });

  await t.test('controls post what the Knowledge and Goals pages post, on either copy', async () => {
    await p.ev(`${row(Q, KA)}.querySelector('[data-oa-know][data-status="retired"]').click(); void 0`);
    await soon(`${done(Q, KA)} === 'Done: retired'`, 'retired at once');
    assert.deepEqual((await posts('/api/knowledge', (x) => x.body.id === KA)).map((x) => x.body), [{ id: KA, status: 'retired' }]);
    await soon(`SAVING === 0`, 'the press back');
    assert.equal(statusOf(KA), 'retired', 'the server applied it');
    await polls(3);
    assert.equal(await p.ev(done(Q, KA)), 'Done: retired', 'still done from its peek, once it left the data');
    // Let go on the thread copy: the confirm shows there at once, and holds across polls
    await p.ev(`${row(Q, GT, tcard)}.querySelector('[data-oa-goal]').click(); void 0`);
    assert.equal(await p.ev(`${row(Q, GT, tcard)}.querySelector('[data-oa-goal]')?.textContent.trim()`), 'Confirm let go', 'confirm on the thread copy, at once');
    await polls(2);
    assert.equal(await p.ev(`${row(Q, GT, tcard)}.querySelector('[data-oa-goal]')?.textContent.trim()`), 'Confirm let go', 'still confirming after polls');
    assert.equal((await posts('/api/goal-decide')).length, 0, 'nothing posted on the first press');
    await p.ev(`${row(Q, GT, tcard)}.querySelector('[data-oa-goal]').click(); void 0`);
    await soon(`${done(Q, GT, tcard)} === 'Done: let go'`, 'let go on the thread copy');
    assert.deepEqual((await posts('/api/goal-decide')).map((x) => x.body), [{ id: GT, verdict: 'let-go' }]);
    // Keep it on the thread copy: both copies show it at once (read in the same step as the click)
    assert.deepEqual(await p.ev(`(() => { ${row(Q, KO, tcard)}.querySelector('[data-oa-know][data-status="accepted"]').click(); return [${done(Q, KO, tcard)}, ${done(Q, KO)}]; })()`), ['Done: kept', 'Done: kept']);
    assert.deepEqual((await posts('/api/knowledge', (x) => x.body.id === KO)).map((x) => x.body), [{ id: KO, status: 'accepted' }]);
    // Let go on the Inbox copy
    await p.ev(`${row(Q, G)}.querySelector('[data-oa-goal]').click(); void 0`);
    await soon(`${row(Q, G)}.querySelector('[data-oa-goal]')?.textContent.trim() === 'Confirm let go'`, 'confirm');
    await p.ev(`${row(Q, G)}.querySelector('[data-oa-goal]').click(); void 0`);
    await soon(`${done(Q, G)} === 'Done: let go'`, 'let go');
    assert.deepEqual((await posts('/api/goal-decide', (x) => x.body.id === G)).map((x) => x.body), [{ id: G, verdict: 'let-go' }]);
    await soon(`SAVING === 0`, 'the presses back');
    await polls(2);
    assert.equal(await p.ev(done(Q, KO)), 'Done: kept', 'kept, from the data');
    // the positive controls: the Knowledge drawer's Retire it and a goal's hold bar post the same bodies
    await p.ev(`location.hash = '#lesson/${KB}'`);
    await soon(`!!document.querySelector('[data-know="${KB}"][data-status="retired"]')`, 'the Knowledge drawer');
    await p.ev(`document.querySelector('[data-know="${KB}"][data-status="retired"]').click(); void 0`);
    await soon(`window.__posts.some((x) => x.url === '/api/knowledge' && x.body.id === ${JSON.stringify(KB)})`, 'the drawer posted');
    assert.deepEqual((await posts('/api/knowledge', (x) => x.body.id === KB)).map((x) => x.body), [{ id: KB, status: 'retired' }]);
    await p.ev(`location.hash = '#goal/${GB}'`);
    await soon(`!!document.querySelector('[data-hold-id="${GB}"][data-mode="let-go"]')`, 'the goal\'s hold bar');
    await p.ev(`(() => { const b = document.querySelector('[data-hold-id="${GB}"][data-mode="let-go"]'); b.click(); b.click(); })(); void 0`);
    await soon(`window.__posts.some((x) => x.url === '/api/goal-decide' && x.body.id === ${JSON.stringify(GB)})`, 'the hold bar posted');
    assert.deepEqual((await posts('/api/goal-decide', (x) => x.body.id === GB)).map((x) => x.body), [{ id: GB, verdict: 'let-go' }]);
    await p.ev(`location.hash = '#questions'`);
    await soon(`!!${card(Q)}`, 'back on the Inbox');
  });

  await t.test('Done goes through once every record is done; never while one is unchanged', async () => {
    await soon(`[${[KA, KR, KO, G, GT, GL].map((id) => done(Q, id)).join(', ')}].every(Boolean)`, 'every record of Q done');
    await p.click(`#questions [data-qcard="${Q}"] input[data-pick][value="Done"]`);
    await p.click(`#questions [data-qcard="${Q}"] [data-answer]`);
    await soon(`window.__posts.some((x) => x.url === '/api/answer' && x.body.id === ${JSON.stringify(Q)})`, 'Q answered on the first press');
    assert.equal((await answers(Q))[0].body.answer, 'Done');
    await redrawnWithout(Q);
    // naming no record, Done posts at once
    await p.click(`#questions [data-qcard="${Q2}"] input[data-pick][value="Done"]`);
    await p.click(`#questions [data-qcard="${Q2}"] [data-answer]`);
    await soon(`window.__posts.some((x) => x.url === '/api/answer' && x.body.id === ${JSON.stringify(Q2)})`, 'Q2 answered');
    await redrawnWithout(Q2);
    // an unchanged record: Done never posts, however often Send is pressed; Can't right now is the way out
    await p.click(`#questions [data-qcard="${Q3}"] input[data-pick][value="Done"]`);
    await p.click(`#questions [data-qcard="${Q3}"] [data-answer]`);
    await soon(marked(Q3, KC), 'not done yet');
    await p.ev(`(() => { const b = ${card(Q3)}.querySelector('[data-answer]'); b.click(); b.click(); })(); void 0`);
    await polls(1);
    assert.equal((await answers(Q3)).length, 0, 'no answer for three presses of Done');
    await p.click(`#questions [data-qcard="${Q3}"] input[data-pick][value="Can’t right now"]`);
    assert.equal(await p.ev(`${marked(Q3, KC)} || !!${card(Q3)}.querySelector('[data-oa-anyway]:not(:empty)')`), false, 'the marks gone at once');
    await p.click(`#questions [data-qcard="${Q3}"] textarea[data-q]`);
    await soon(`document.activeElement === ${card(Q3)}?.querySelector('textarea[data-q]')`, 'the note focused');
    await p.type('keeping it');
    await soon(`${card(Q3)}?.querySelector('textarea[data-q]')?.value === 'keeping it'`, 'the note typed');
    await p.click(`#questions [data-qcard="${Q3}"] [data-answer]`);
    await soon(`window.__posts.some((x) => x.url === '/api/answer' && x.body.id === ${JSON.stringify(Q3)})`, 'Q3 answered');
    assert.equal((await answers(Q3))[0].body.answer, 'Can’t right now — keeping it');
  });
});
