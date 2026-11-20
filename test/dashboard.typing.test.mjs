// Typing in the dashboard in Chrome, and a stale read said on the page.
// Ports: +56/57 typing; +42/43 a stale read (both pinned)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PORTS, bareProject, dashboardOnFreePort } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { AT_REST, soonIn, POLL_FAST } from './lib/dashboard-page.mjs';

test('typing in the dashboard: a refresh never takes the field, the caret or the scroll, and holding it can\'t wedge', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-focus-'));
  // in t.after, each as it starts: they run on a failure and a timeout, where a finally may never be reached
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { ...process.env, DEVTEAM_HUB_PORT: String(PORTS + 56), DEVTEAM_PORT_BASE: String(PORTS + 57), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'TMUX', 'TMUX_PANE']) delete env[k];
  const root = bareProject(base, 'focus');
  const ask = (q, ...more) => {
    const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), 'ask', '--question', q, ...more], { cwd: root, env: { ...env, DEVTEAM_ROLE: 'supervisor' }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const Q = ask('Which way?', '--choices', '[{"label":"Left"},{"label":"Right"}]');
  for (let i = 0; i < 12; i++) ask(`Filler ${i}?`); // enough cards that the page scrolls
  const { dash, port } = await dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  {
    await p.send('Page.enable');
    await p.send('Runtime.enable');
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 600, deviceScaleFactor: 1, mobile: false });
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: POLL_FAST });
    // kit-307: DEVTEAM_TEST_CPU_THROTTLE=<n> runs the page n times slower, as a loaded runner does;
    // DEVTEAM_TEST_ROUTE_DELAY_MS=<ms> runs the page's hashchange listeners that much later, as a runner too
    // loaded to reach the route's task before the test's next step does
    if (process.env.DEVTEAM_TEST_CPU_THROTTLE) await p.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.DEVTEAM_TEST_CPU_THROTTLE) });
    if (process.env.DEVTEAM_TEST_ROUTE_DELAY_MS) await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const add = window.addEventListener; window.addEventListener = function (type, f, ...a) { return add.call(this, type, type === 'hashchange' && typeof f === 'function' ? (e) => setTimeout(() => f(e), ${Number(process.env.DEVTEAM_TEST_ROUTE_DELAY_MS)}) : f, ...a); }; })()` });
    await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#questions` });
    const box = `textarea[data-q="${Q}"]`;
    const soon = soonIn(p, 15000, () => dash.out());
    // the Inbox is the panel's tab (kit-100), and it scrolls in #th-body: the card, in the panel at rest (a click
    // takes the field's centre once)
    await soon(`!!document.querySelector('${box}') && document.body.classList.contains('threads-open') && getComputedStyle(document.getElementById('threads')).transform === 'none'`, 'the question card');
    // Answered by polls actually arriving, however long /api/data takes.
    const polls = async (n = 2) => { const at = await p.ev('window.__polls'); await soon(`window.__polls >= ${at + n}`, `${n} polls`); };
    // jumped: a space on the page scrolls most of a screen; a pixel or two is a caret coming into view
    // the Inbox's scroll: #th-body's, since the Inbox is the panel's tab (kit-100)
    const TH_Y = "document.getElementById('th-body').scrollTop";
    const state = (y) => p.ev(`(() => { const a = document.activeElement, t = document.querySelector('${box}'); return { value: t.value, focus: a === t, start: t.selectionStart, end: t.selectionEnd, jumped: Math.abs(${TH_Y} - ${y ?? TH_Y}) > 20 }; })()`);
    const wrote = (v) => ({ value: v, focus: true, start: v.length, end: v.length, jumped: false });
    // A new question lands in the log: the tab title says so at once, the cards wait.
    const newQuestion = async (q) => {
      const n = await p.ev(`Number((document.title.match(/\\((\\d+)\\)/) || [])[1])`);
      ask(q);
      await soon(`document.title.startsWith('(${n + 1})')`, `the title to count ${q}`);
    };

    await t.test('a refresh already in flight when you click in and type', async () => {
      await p.ev('void (window.__gate = new Promise((r) => { window.__open = r; }))'); // void: evaluating a promise would wait for it
      let y;
      try {
        // a read waiting at the gate, and none past it: counting polls can't say so, since a poll that
        // reached the gate before the count was read is the last one until the gate opens
        await soon('window.__gated > 0 && window.__quiet()', 'a refresh held at the gate');
        await p.click(box);
        await soon(`document.activeElement === document.querySelector('${box}')`, 'the field focused');
        y = await p.ev(TH_Y);
        assert.ok(y > 0, 'the fixture page scrolls');
        await p.type('hello');
        await p.ev('window.__t = document.querySelector(\'' + box + '\'); void 0');
      } finally { await p.ev('window.__open(); window.__gate = null; void 0'); } // never left shut: it would hold every later read
      await polls();
      assert.deepEqual(await state(y), wrote('hello'), 'still in the field after the refresh lands');
      assert.equal(await p.ev('window.__t.isConnected'), true, 'the same field, not a redrawn one');
      await p.type(' world');
      assert.deepEqual(await state(y), wrote('hello world'), 'space typed, not scrolled');
    });

    await t.test('the caret and a selection stay where they were', async () => {
      const y = await p.ev(TH_Y);
      for (let i = 0; i < 5; i++) await p.key('ArrowLeft');
      await p.type('X');
      await polls();
      assert.deepEqual(await state(y), { value: 'hello Xworld', focus: true, start: 7, end: 7, jumped: false });
      await p.key('ArrowRight', 8);
      await p.key('ArrowRight', 8);
      await polls();
      assert.deepEqual(await state(y), { value: 'hello Xworld', focus: true, start: 7, end: 9, jumped: false });
      for (let i = 0; i < 5; i++) await p.key('ArrowRight');
    });

    await t.test('while typing the title and the Inbox count stay fresh, the cards wait; focus leaving draws them', async () => {
      const q = 'Arrived while you typed?';
      await newQuestion(q);
      assert.equal(await p.ev(`document.querySelector('#questions').textContent.includes(${JSON.stringify(q)})`), false, 'not drawn under the typing');
      assert.equal(await p.ev(`document.getElementById('inbox-btn-n').textContent === document.title.match(/\\((\\d+)\\)/)[1]`), true, 'the Inbox count');
      await p.key('Tab');
      await soon(`document.querySelector('#questions').textContent.includes(${JSON.stringify(q)})`, 'the held data, once focus left');
      assert.equal(await p.ev(`document.querySelector('${box}').value`), 'hello Xworld', 'the draft survives the redraw');
      assert.notEqual(await p.ev('document.activeElement.tagName'), 'BODY', 'Tab lands on a control, and the redraw leaves it there');
    });

    await t.test('held for a long time: a hint, and clicking it draws without losing the field or the caret', async () => {
      const y = await p.click(box).then(() => p.ev(TH_Y));
      const q = 'Urgent while you were idle?';
      await newQuestion(q);
      assert.equal(await p.ev(`getComputedStyle($('held')).display`), 'none', 'no hint while typing normally');
      await p.ev('(() => { const n = Date.now; Date.now = () => n() + 300000; })()');
      await soon(`!$('held').hidden`, 'the hint');
      await p.click('#held');
      await soon(`document.querySelector('#questions').textContent.includes(${JSON.stringify(q)})`, 'the held data after the hint');
      assert.equal(await p.ev(`$('held').hidden`), true, 'the hint goes once drawn');
      const s = await state();
      assert.equal(s.value, 'hello Xworld');
      assert.equal(s.focus, true, 'still in the field');
      assert.equal(s.start, 12, 'caret kept');
      await p.type('Z');
      assert.equal((await state()).value, 'hello XworldZ');
      assert.equal((await state(y)).jumped, false, 'and the page stayed put');
    });

    await t.test('an IME composition is not drawn over', async () => {
      await p.send('Input.imeSetComposition', { text: 'かな', selectionStart: 2, selectionEnd: 2 });
      await newQuestion('Mid composition?');
      await polls();
      const v = await p.ev(`document.querySelector('${box}').value`);
      assert.match(v, /かな$/, 'the composition is still there');
      await p.send('Input.insertText', { text: 'かな' });
      assert.match(await p.ev(`document.querySelector('${box}').value`), /Zかな$/);
      assert.equal(await p.ev('document.activeElement.tagName'), 'TEXTAREA');
    });

    await t.test('a radio in the card still picks with a draft and held data, and a space after it doesn\'t scroll', async () => {
      await newQuestion('Before the radio?');
      await p.click(`input[data-pick="${Q}"][value="Right"]`);
      await soon(`document.querySelector('#questions').textContent.includes('Before the radio?')`, 'the redraw after the click');
      assert.equal(await p.ev(`document.querySelector('input[data-pick="${Q}"][value="Right"]').checked`), true, 'the pick took');
      assert.equal(await p.ev(`document.activeElement.dataset.pick`), Q, 'focus is back on the radio, not on the page');
      const y = await p.ev(TH_Y);
      await p.key(' ');
      // a space that scrolls does so smoothly, a little each frame: compared once the page is at rest
      await p.ev(AT_REST);
      assert.equal((await state(y)).jumped, false, 'space on the radio does not scroll');
      assert.match(await p.ev(`document.querySelector('${box}').value`), /Zかな$/, 'draft intact');
    });

    await t.test('a control that keeps focus without typing doesn\'t stop the page refreshing', async () => {
      // its control is the Board's Needs attention toggle, in the page bar (one page at a time)
      const att = '.pagebar .extra [data-f="att"]';
      await p.ev(`location.hash = '#board'`);
      await soon(`getComputedStyle(document.querySelector('#board')).display !== 'none' && !!document.querySelector('${att}')`, 'the Board page and its toggle');
      await p.click(att);
      // each press is awaited until routed (LAST_HEAD): the press changes the hash at once, but its route redraws the
      // page bar and the Board a task later, and the next step (or the open-select subtest) must not start under it
      await soon(`location.hash.includes('att=1') && LAST_HEAD === location.hash && document.activeElement?.matches?.('${att}')`, 'the toggle pressed, routed, and focused');
      const q = 'After the toggle?';
      ask(q);
      await soon(`document.querySelector('#questions').textContent.includes(${JSON.stringify(q)})`, 'a redraw with a toggle focused');
      await p.click(att); // leave the setting as it was
      await soon(`!location.hash.includes('att=') && LAST_HEAD === location.hash && document.querySelector('${att}')?.getAttribute('aria-pressed') === 'false'`, 'the toggle off again, routed and drawn');
      await p.ev(`document.activeElement.blur()`);
    });

    await t.test('an open select is left alone, and a list closed without a choice can\'t stop the refreshing', async () => {
      // the Board's Goal select, in the page bar (drawn again only when it changes); a Board column, drawn on every
      // read the page isn't held, says whether the page is drawing
      const goal = '.pagebar .extra select[data-f="goal"]';
      await p.ev(`window.__o = document.querySelector('${goal}').options[0]`);
      await p.click(goal);
      await p.ev(`window.__c = document.querySelector('#board-cols > .col')`);
      await polls();
      assert.equal(await p.ev(`window.__o.isConnected`), true, 'its options are not redrawn');
      assert.equal(await p.ev(`window.__c.isConnected`), true, 'nothing is drawn while it is open');
      await p.key('Escape');
      await p.ev('(() => { const n = Date.now; Date.now = () => n() + 120000; })()');
      await soon(`!window.__c.isConnected`, 'the page drawing again, no change event to say so');
      await p.ev(`document.activeElement.blur()`);
      // back to the Inbox, for the card (#inbox opens the panel on its Inbox tab, kit-100)
      await p.ev(`location.hash = '#inbox'`);
      await soon(`document.body.classList.contains('threads-open') && getComputedStyle(document.getElementById('threads')).transform === 'none' && !document.getElementById('th-inbox').hidden`, 'the Inbox in the panel, at rest');
    });

    await t.test('Answer still works with a draft and held data: answered at once, and refreshes while it posts keep it so', async () => {
      await p.click(box);
      await newQuestion('Before the answer?');
      // held by the test, not by a clock: on a loaded runner the polls below can outlast any fixed delay
      await p.ev('window.__answerHold = new Promise((r) => { window.__answerGo = r; }); void 0');
      await p.click(`button[data-answer="${Q}"]`);
      assert.match(await p.ev(`document.querySelector('[data-qcard="${Q}"]')?.textContent ?? ''`), /Answered: /, 'answered on the click, the post still held');
      await polls();
      assert.equal(await p.ev(`!!document.querySelector('${box}')`), false, 'a refresh mid-post never brings the card back');
      await p.ev('window.__answerGo(); void 0');
      await soon('SAVING === 0', 'the post through');
      const listed = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), 'questions', '--all', '--json'], { cwd: root, env, encoding: 'utf8' });
      assert.equal(JSON.parse(listed.stdout).find((x) => x.id === Q)?.status, 'answered', listed.stderr);
    });
  }
});

test('a stale read is said on the page: a note at the top with the time of what is shown, on a phone too', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 120000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-stale-note-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  // waiting no time at all on a run: every read after the first is the last good data, marked stale
  // a build served again for 3 s after it ends (the kit's 20 s, kit-595, set back for tests): a stale
  // read is timed to come within this test's 30 s wait
  const env = { ...process.env, DEVTEAM_DATA_WAIT_MS: '0', DEVTEAM_DATA_REUSE_MS: '3000', DEVTEAM_HUB_PORT: String(PORTS + 42), DEVTEAM_PORT_BASE: String(PORTS + 43), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'TMUX', 'TMUX_PANE']) delete env[k];
  const root = bareProject(base, 'stale');
  const { dash, port } = await dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: POLL_FAST });
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  const soon = soonIn(p, 30000, () => dash.out());
  await soon(`DATA && window.__reads?.length >= 1 && window.__reads[0].ms !== null`, 'the first read drawn');
  // one check, in the page, so a read landing between two can't split them: shown, inside a phone's
  // width, below the nav, naming the time of what is drawn
  await soon(`(() => {
    const n = $('stale'), r = n.getBoundingClientRect(), nav = document.querySelector('.side').getBoundingClientRect();
    const want = 'Showing data from ' + new Date(DATA.generated_at).toLocaleTimeString() + '. Newer data is taking a while to load; this page will update by itself.';
    return !n.hidden && getComputedStyle(n).display !== 'none' && r.left >= 0 && r.right <= innerWidth && r.top >= nav.bottom && n.textContent === want;
  })()`, 'the note, once a read is stale, saying what it shows');
});
