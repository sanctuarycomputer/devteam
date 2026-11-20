// Presses in Chrome: the page answers before the server, and an answer posts the pick and the words.
// Ports: +58/59 presses; +63/64 an answer posts (both pinned)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PORTS, write, pastDeadline, bareProject, dashboardOnFreePort, until } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { soonIn, POLL_FAST } from './lib/dashboard-page.mjs';

// Every press draws its result before the server has it, and a refusal puts back what was there.
// The posts are held on the wire (__postHold), so each check is of what the page drew while the
// server hadn't answered, never a stopwatch.
test('presses: the page answers before the server, and a refusal puts it back', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-press-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { ...process.env, DEVTEAM_HUB_PORT: String(PORTS + 58), DEVTEAM_PORT_BASE: String(PORTS + 59), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'TMUX', 'TMUX_PANE']) delete env[k];
  const root = bareProject(base, 'press');
  const dt = (args, role = {}) => { const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: root, env: { ...env, ...role }, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const Q1 = dt(['ask', '--question', 'Which way?', '--choices', '[{"label":"Left"},{"label":"Right"}]'], SUP);
  const Q2 = dt(['ask', '--question', 'Ship it?', '--choices', '[{"label":"Yes"},{"label":"No"}]'], SUP);
  const K = dt(['knowledge', 'add', '--kind', 'fact', '--statement', 'The build uses make', '--for-owner', '--plain', 'The project is built with one standard tool, so any machine can build it.'], SUP);
  // the agents' own lesson: the supervisor's to keep, so never an Inbox card
  const KA = dt(['knowledge', 'add', '--kind', 'fact', '--statement', 'check-pr reads main\'s log'], SUP);
  const Q3 = dt(['ask', '--question', 'Which port?', '--default', '8080'], SUP);
  pastDeadline(root, Q3);
  dt(['answer', Q3, '--defaulted'], SUP);
  const { dash, port } = await dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: POLL_FAST });
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#questions` });
  const soon = soonIn(p, 15000, () => dash.out());
  const polls = async (n = 2) => { const at = await p.ev('window.__polls'); await soon(`window.__polls >= ${at + n}`, `${n} polls`); };
  const hold = () => p.ev('void (window.__postHold = new Promise((r) => { window.__let = r; }))');
  const letGo = () => p.ev('window.__let(); window.__postHold = null; void 0');
  const card = (q) => `document.querySelector('#questions [data-qcard="${q}"]')`;
  // a step no read lands in, from finding what to click to the release's own work (pointerup's
  // setTimeout draws what the press held back): a redraw can't move or replace what is clicked
  const still = async (f) => { await p.ev('window.__still()'); try { await f(); await soon('PRESSED === 0', 'the release handled'); } finally { await p.ev('window.__stir()'); } };
  const answeredOnServer = (q) => /answered/.test(dt(['questions', '--id', q]).split('\n')[0]);
  // #questions opens the Inbox in the panel (kit-100): the cards, in the panel at rest (a click takes a box's centre once)
  await soon(`!!${card(Q1)} && !!${card(Q2)} && document.body.classList.contains('threads-open') && getComputedStyle(document.getElementById('threads')).transform === 'none'`, 'the question cards');

  await t.test('an answer: the card says so at once; the server has it once the post goes through', async () => {
    await hold();
    await still(() => p.click(`${'#questions'} [data-qcard="${Q1}"] input[data-pick][value="Left"]`));
    await still(() => p.click(`#questions [data-qcard="${Q1}"] [data-answer]`));
    await soon(`/Answered: Left/.test(${card(Q1)}?.textContent ?? '')`, 'drawn while the post is held');
    assert.equal(await p.ev(`$('saving').hidden`), false, 'the page says it is saving');
    assert.equal(answeredOnServer(Q1), false, 'and the server has not got it yet');
    await polls(2);
    assert.match(await p.ev(`${card(Q1)}?.textContent ?? 'gone'`), /Answered: Left|gone/, 'a refresh mid-press keeps it answered');
    await letGo();
    await until(() => answeredOnServer(Q1), 'the answer in the log');
    await soon(`$('saving').hidden`, 'saving done');
  });

  await t.test('refused: the card comes back with the pick and the note, and says why', async () => {
    // the server's data held first, so no refresh redraws the card under the test, and the page
    // keeps the question while the supervisor withdraws it
    await p.ev('void (window.__gate = new Promise((r) => { window.__open = r; }))');
    try {
      // and what was past the gate drawn: the last press's own read (Q1 answered, its card leaving,
      // Q2's moving up) would otherwise land between finding the note and clicking it, or bring the
      // withdrawal in. Anything it left held is drawn now, not on the pick's release.
      await soon('window.__quiet()', 'the reads already past the gate landed');
      await p.ev('drawHeld(); void 0');
      await soon('window.__quiet() && !HELD', 'nothing held back');
      await p.click(`#questions [data-qcard="${Q2}"] input[data-pick][value="No"]`);
      await p.click(`#questions [data-qcard="${Q2}"] textarea[data-q]`);
      await soon(`document.activeElement === document.querySelector('#questions [data-qcard="${Q2}"] textarea[data-q]')`, 'the note focused');
      await p.type('not this week');
      await soon(`document.querySelector('#questions [data-qcard="${Q2}"] textarea[data-q]')?.value === 'not this week'`, 'the note typed');
      await hold();
      await p.click(`#questions [data-qcard="${Q2}"] [data-answer]`);
      await soon(`/Answered: No — not this week/.test(${card(Q2)}?.textContent ?? '')`, 'the card answered while the post is held');
      dt(['withdraw', Q2, '--reason', 'moot'], SUP);
      await letGo();
      await soon(`/Not saved:/.test(${card(Q2)}?.querySelector('[data-refused]')?.textContent ?? '')`, 'the refusal, on the card');
      assert.equal(await p.ev(`document.querySelector('#questions [data-qcard="${Q2}"] textarea[data-q]').value`), 'not this week', 'the note back');
      assert.equal(await p.ev(`document.querySelector('#questions [data-qcard="${Q2}"] input[data-pick][value="No"]').checked`), true, 'the pick back');
    } finally { await p.ev('window.__open?.(); window.__gate = null; window.__let?.(); window.__postHold = null; void 0'); }
  });

  await t.test('a lesson kept: it leaves at once and stays gone across refreshes', async () => {
    const lesson = `document.querySelector('[data-know="${K}"]')`;
    await soon(`!!${lesson}`, 'the lesson card');
    // its plain line first, the technical wording folded under it; the agents' own lesson isn't here
    const kcard = `${lesson}.closest('.card')`;
    assert.equal(await p.ev(`${kcard}.querySelector('h4[data-plain]').textContent`), 'The project is built with one standard tool, so any machine can build it.');
    assert.equal(await p.ev(`${kcard}.querySelector('details[data-technical]').open`), false, 'the technical wording folded');
    assert.match(await p.ev(`${kcard}.querySelector('details[data-technical]').textContent`), /The build uses make/);
    assert.equal(await p.ev(`!!document.querySelector('#questions [data-know="${KA}"]')`), false, 'the agents\' own lesson is not in the Inbox');
    // kit-96: Knowledge is a table; the agents' own candidate is its row (first cell's [data-subject] names the record), Status "proposed"
    assert.equal(await p.ev(`(() => { const tr = [...document.querySelectorAll('#knowledge tr[data-row]')].find((r) => r.querySelector('[data-subject$=":${KA}"]')); return tr ? tr.children[2].textContent.trim() : null; })()`), 'proposed', 'it is in the Loop, as a proposed row');
    await hold();
    await p.click(`[data-know="${K}"][data-status="accepted"]`);
    assert.equal(await p.ev(`!!${lesson}`), false, 'gone at once');
    await polls(2);
    assert.equal(await p.ev(`!!${lesson}`), false, 'still gone after refreshes, the post still held');
    await letGo();
    await until(() => /accepted/.test(dt(['knowledge', '--status', 'accepted'])), 'kept on the server');
  });

  await t.test('an overrule is bound to the question as the page showed it, like every answer', async () => {
    await p.ev(`document.getElementById('answered-wrap').open = true; void 0`);
    await soon(`!!document.querySelector('input[data-overrule="${Q3}"]')`, 'the overrule field');
    await p.ev(`(() => { const f = document.querySelector('input[data-overrule="${Q3}"]'); f.value = '9090'; window.__posts = []; document.querySelector('[data-overrule-send="${Q3}"]').click(); })()`);
    const sent = JSON.parse(await p.ev(`JSON.stringify(window.__posts.find((x) => x.url === '/api/answer'))`));
    const hash = JSON.parse(dt(['questions', '--all', '--json'])).find((x) => x.id === Q3).hash;
    assert.equal(JSON.parse(sent.body).seen, hash, 'the hash the owner saw goes with the overrule');
    await until(() => JSON.parse(dt(['questions', '--all', '--json'])).find((x) => x.id === Q3).answer === '9090', 'overruled on the server');
  });

  await t.test('a new thread: the turn is in the card at once, and two quick Sends make one thread', async () => {
    await p.ev(`document.querySelector('#threads [data-tl-new]').click(); void 0`);
    await soon(`document.activeElement?.id === 'tl-c-text'`, 'the composer');
    await hold();
    await p.type('first words');
    await p.key('Enter', 8);
    assert.match(await p.ev(`document.getElementById('tl-c-turns').textContent`), /first words/, 'drawn while held');
    assert.equal(await p.ev(`document.getElementById('tl-c-state').textContent`), 'Sending…');
    await p.type('second words');
    await p.key('Enter', 8);
    assert.match(await p.ev(`document.getElementById('tl-c-turns').textContent`), /second words/);
    await letGo();
    const threads = () => JSON.parse(dt(['thread', 'list', '--json']));
    await until(() => threads().some((x) => x.turns?.length === 2) || threads().length > 1, 'both sends landed');
    const all = threads();
    assert.equal(all.length, 1, 'one thread');
    assert.deepEqual(all[0].turns.map((u) => u.text), ['first words', 'second words']);
    await soon(`!document.getElementById('tl-c-turns').textContent.includes('Sending')`, 'the card from the server');
  });
});

// An answer is the option picked plus the words typed, posted on the first press (kit-313): the pick
// as `choice`, the words as `answer`, never a step asking which choice the words mean. "Something
// else", or no pick, is the words alone (choice null), which the kit never reads as the recommendation.
test('an answer posts the pick and the words on the first press, with no which-choice step', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-pick-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { ...process.env, DEVTEAM_HUB_PORT: String(PORTS + 63), DEVTEAM_PORT_BASE: String(PORTS + 64), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'TMUX', 'TMUX_PANE']) delete env[k];
  const root = bareProject(base, 'pick');
  const dt = (args, role = {}) => { const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: root, env: { ...env, ...role }, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const door = (q) => dt(['ask', '--kind', 'one-way-door', '--question', q, '--choices', '[{"label":"Yes"},{"label":"No"}]', '--recommendation', 'Yes'], SUP);
  const D1 = door('Keep the sales data?');
  const D2 = door('Open the box?');
  const D3 = door('Turn it on?');
  const D4 = door('Paint it blue?');
  const D6 = door('Lock the door?');
  const D7 = door('Sweep the floor?');
  const D8 = door('Water the plants?');
  const D9 = dt(['ask', '--question', 'Which flag?', '--choices', '[{"label":"--all"},{"label":"none"}]', '--recommendation', 'none'], SUP);
  // a defaulted question, overruled in words from its answered card
  const Q5 = dt(['ask', '--question', 'Lights on?', '--choices', '[{"label":"Yes"},{"label":"No"}]', '--recommendation', 'Yes', '--default', 'No'], SUP);
  pastDeadline(root, Q5);
  dt(['answer', Q5, '--defaulted'], SUP);
  const { dash, port } = await dashboardOnFreePort(root, env);
  later(() => dash.stop());
  // a page loaded before the upgrade posts the old shape, the pick inside the text and no choice key:
  // still taken, as a line judged by its leading label
  const old = await fetch(`http://127.0.0.1:${port}/api/answer`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ id: D6, answer: 'Yes — fine' }), signal: AbortSignal.timeout(60000) });
  assert.equal(old.status, 200, await old.clone().text());
  const d6 = JSON.parse(dt(['questions', '--id', D6, '--json']))[0];
  assert.deepEqual([d6.status, d6.answer, d6.choice, d6.matched], ['answered', 'Yes — fine', null, true], 'an old-shaped body still answers');
  // words, and a label, that start with "--" stay words and a label: never read as a flag (task-3 T3-1, T3-2)
  const api = async (body) => { const r = await fetch(`http://127.0.0.1:${port}/api/answer`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) }); assert.equal(r.status, 200, await r.clone().text()); return JSON.parse(dt(['questions', '--id', body.id, '--json']))[0]; };
  const d7 = await api({ id: D7, answer: '-- but only after the release', choice: 'No' });
  assert.deepEqual([d7.answer, d7.choice], ['No — -- but only after the release', 'No'], 'the words kept');
  const d8 = await api({ id: D8, answer: '--rule=always yes', choice: 'Yes' });
  assert.deepEqual([d8.answer, d8.choice, d8.standing_rule ?? null], ['Yes — --rule=always yes', 'Yes', null], 'typed words make no standing rule');
  const d9 = await api({ id: D9, answer: '', choice: '--all' });
  assert.deepEqual([d9.answer, d9.choice], ['--all', '--all'], 'a label that starts with "--"');
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: POLL_FAST });
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#questions` });
  const soon = soonIn(p, 15000, () => dash.out());
  const polls = async (n = 2) => { const at = await p.ev('window.__polls'); await soon(`window.__polls >= ${at + n}`, `${n} polls`); };
  const still = async (f) => { await p.ev('window.__still()'); try { await f(); await soon('PRESSED === 0', 'the release handled'); } finally { await p.ev('window.__stir()'); } };
  const card = (q) => `#questions [data-qcard="${q}"]`;
  // any which-choice step, anywhere on the page
  const asks = () => p.ev(`document.querySelectorAll('[data-which-for]').length`);
  const logged = (q) => JSON.parse(dt(['questions', '--all', '--json'])).find((x) => x.id === q);
  const answered = (q) => until(() => logged(q).status === 'answered' && logged(q), `${q} answered`);
  const write = async (sel, text) => { await p.click(sel); await soon(`document.activeElement === document.querySelector('${sel}')`, 'the note focused'); await p.type(text); };
  // what the press posted to /api/answer: the body, parsed
  const posted = async () => { const x = JSON.parse(await p.ev(`JSON.stringify((window.__posts ?? []).filter((x) => x.url === '/api/answer'))`)); assert.equal(x.length, 1, 'one post'); return JSON.parse(x[0].body); };
  // #questions opens the Inbox in the panel (kit-100): the cards, in the panel at rest (a click takes a box's centre once)
  await soon(`!!document.querySelector('${card(D1)}') && !!document.querySelector('${card(D2)}') && !!document.querySelector('${card(D3)}') && document.body.classList.contains('threads-open') && getComputedStyle(document.getElementById('threads')).transform === 'none'`, 'the door cards, in the panel at rest');

  await t.test('Something else and words: the words posted at once, no pick, never the recommendation', async () => {
    await still(() => p.click(`${card(D1)} input[data-pick][value="__other"]`));
    await write(`${card(D1)} textarea[data-q]`, 'agreed, keep it');
    await p.ev('window.__posts = []; void 0');
    await still(() => p.click(`${card(D1)} [data-answer]`));
    assert.equal(await asks(), 0, 'no which-choice step');
    const q = await answered(D1);
    assert.deepEqual([q.answer, q.choice, q.matched], ['agreed, keep it', null, false], 'the words alone, which the kit never reads as Yes');
    const sent = await posted();
    assert.deepEqual([sent.answer, sent.choice], ['agreed, keep it', null], 'the words, and no pick');
    assert.equal(sent.seen, q.hash, 'bound to the question as the page showed it');
    await polls(2);
    assert.equal(await asks(), 0, 'none after a redraw either');
    // the Matched row: words wait for a reading, and a reading is never "you went with it" (final-1 F3)
    assert.equal(await p.ev(`matchedWords({ matched: false, in_words: true, read_by: null, label: null })`), 'not yet: you answered in your own words, which the supervisor reads');
    assert.equal(await p.ev(`matchedWords({ matched: true, in_words: true, read_by: 'supervisor', label: 'Yes' })`), 'yes: the supervisor read your words as “Yes”; not counted as your agreement');
    assert.equal(await p.ev(`matchedWords({ matched: true, in_words: false, read_by: null, label: 'Yes' })`), 'yes: you went with its recommendation');
  });

  await t.test('a pick and words: "<label> — <words>", the pick recorded beside them', async () => {
    await still(() => p.click(`${card(D2)} input[data-pick][value="No"]`));
    await write(`${card(D2)} textarea[data-q]`, 'not yet');
    await p.ev('window.__posts = []; void 0');
    await still(() => p.click(`${card(D2)} [data-answer]`));
    assert.equal(await asks(), 0, 'no which-choice step');
    const q = await answered(D2);
    assert.deepEqual([q.answer, q.choice, q.matched], ['No — not yet', 'No', false]);
    const sent = await posted();
    assert.deepEqual([sent.answer, sent.choice], ['not yet', 'No'], 'the words only, and the pick');
  });

  await t.test('a pick and no words: the pick alone, the recommendation matched', async () => {
    await still(() => p.click(`${card(D3)} input[data-pick][value="Yes"]`));
    await p.ev('window.__posts = []; void 0');
    await still(() => p.click(`${card(D3)} [data-answer]`));
    assert.equal(await asks(), 0, 'no which-choice step');
    const q = await answered(D3);
    assert.deepEqual([q.answer, q.choice, q.matched], ['Yes', 'Yes', true]);
    const sent = await posted();
    assert.deepEqual([sent.answer, sent.choice], ['', 'Yes'], 'no words, the pick');
  });

  await t.test("a thread's copy: words with no pick posted at once, no step on either copy", async () => {
    await p.ev(`(() => { const q = DATA.questions.find((x) => x.id === '${D4}'); const d = document.createElement('div'); d.dataset.testCopy = ''; d.innerHTML = questionCard(q, DATA.ooda, {}, true); $('tl').appendChild(d); })()`);
    try {
      await write(`#t-q-${D4} textarea[data-q]`, 'fine');
      await p.ev('window.__posts = []; void 0');
      await still(() => p.click(`#t-q-${D4} button[data-answer]`));
      assert.equal(await asks(), 0, 'no which-choice step on the thread copy or the Inbox copy');
      const q = await answered(D4);
      assert.deepEqual([q.answer, q.choice, q.matched], ['fine', null, false]);
      assert.deepEqual([(await posted()).answer, (await posted()).choice], ['fine', null]);
      await polls(2);
      assert.equal(await asks(), 0, 'none after a redraw');
    } finally { await p.ev(`document.querySelector('[data-test-copy]')?.remove(); void 0`); }
  });

  await t.test("Overrule on a defaulted question: the owner's words, no pick, never the recommendation", async () => {
    await p.ev(`document.getElementById('answered-wrap').open = true; void 0`);
    await soon(`!!document.querySelector('input[data-overrule="${Q5}"]')`, 'the overrule field');
    await p.ev(`(() => { const f = document.querySelector('input[data-overrule="${Q5}"]'); f.value = 'Yes'; window.__posts = []; document.querySelector('[data-overrule-send="${Q5}"]').click(); })()`);
    const sent = await posted();
    assert.deepEqual([sent.answer, sent.choice], ['Yes', null], 'typed text, no picker');
    const q = await until(() => { const x = logged(Q5); return x.answer === 'Yes' && x; }, 'overruled on the server');
    assert.deepEqual([q.status, q.choice, q.matched], ['answered', null, false]);
  });
});
