// kit-93: the Autonomy pages (Trust, Awareness, Governance, Sensors, Retros). Real headless Chrome
// over a real bare-project dashboard; only the page's fetch is wrapped (autonomyFixture's init, in
// test/lib/kit.mjs), so /api/data, /api/governance, a sensor's /api/peek and /api/threads carry the
// fixture's data, and every write the page makes is recorded in window.__writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PORTS, autonomyFixture, bareProject, dashboardOnFreePort, write } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

// A wait on a condition in the page.
const soonIn = (p, ms = 15000) => async (expr, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v, err = null;
    try { v = await p.ev(expr); } catch (e) { err = e; }
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out: ${what}${err ? `; last: ${err.message}` : ''}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

test('the Autonomy pages', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 600000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-autonomy-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 6), DEVTEAM_PORT_BASE: String(PORTS + 7), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'DEVTEAM_HOME', 'TMUX', 'TMUX_PANE']) delete env[k];
  const root = bareProject(base, 'autonomy');
  // the project's exterior, written and on main, so the fixture's written Project file has a file to peek
  write(path.join(root, 'docs/devteam/project/exterior.md'), '# Exterior\n\nWhat the project looks like from outside: its users, its hosts and the services it talks to.\n\nThe checkout runs on one host behind a proxy, and reads cards through the processor.\n');
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: root });
  git('add', '-A');
  git('commit', '-qm', 'the project');
  const { dash, port } = await dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const soon = soonIn(p);

  // a fresh document with fx's data: the previous init script removed, the new one added, then a load
  // from about:blank (a hash change alone keeps the old document and its script)
  let script = null;
  const load = async (fx, hash = '#trust') => {
    if (script) await p.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script });
    script = (await p.send('Page.addScriptToEvaluateOnNewDocument', { source: fx.init })).identifier;
    await p.send('Page.navigate', { url: 'about:blank' });
    await soon("location.href === 'about:blank'", 'a blank page');
    await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/${hash}` });
    await soon("typeof DATA !== 'undefined' && !!DATA && !document.querySelector('main.waiting')", 'the dashboard drawn');
  };
  // text, whitespace folded: of the first match, and of every match
  const text = (sel) => p.ev(`(document.querySelector(${JSON.stringify(sel)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`);
  const texts = (sel) => p.ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => e.textContent.replace(/\\s+/g, ' ').trim())`);
  // the body rows of the table(s) under sel, each as its cells' text (a "None" row included)
  const ROWS = (sel) => `[...document.querySelectorAll(${JSON.stringify(`${sel} tbody tr`)})]`;
  const rowsOf = (sel) => p.ev(`${ROWS(sel)}.map((r) => [...r.cells].map((c) => c.textContent.replace(/\\s+/g, ' ').trim()))`);
  const drawerOpen = "!document.getElementById('drawer').hidden && document.body.classList.contains('peek-open')";
  // row i of rowsOf(sel) opened by a click on a spot of it no link or button holds, or by Enter with
  // the row focused: the drawer's kind and id once it shows, or null if nothing shows within 1 s
  const openRow = async (sel, i, how = 'click') => {
    if (how === 'click') {
      const at = await p.ev(`(() => {
        const tr = ${ROWS(sel)}[${i}];
        if (!tr) return null;
        tr.scrollIntoView({ block: 'center' });
        const r = tr.getBoundingClientRect();
        const y = r.top + r.height / 2;
        for (let x = r.left + 2; x < r.right - 1; x += 6) {
          const e = document.elementFromPoint(x, y);
          if (e && tr.contains(e) && !e.closest('a, button, input, select, textarea, summary, label')) return { x, y };
        }
        return null;
      })()`);
      assert.ok(at, `row ${i} of ${sel}: no spot to click`);
      await p.clickAt(at.x, at.y);
    } else if (how === 'enter') {
      assert.ok(await p.ev(`(() => { const tr = ${ROWS(sel)}[${i}]; if (!tr) return false; tr.scrollIntoView({ block: 'center' }); tr.focus(); return document.activeElement === tr; })()`), `row ${i} of ${sel}: not focusable`);
      await p.key('Enter');
    } else assert.fail(`openRow: how is 'click' or 'enter', not ${how}`);
    const end = Date.now() + 1000;
    while (Date.now() < end) {
      if (await p.ev(`${drawerOpen} && !!DRAWER.kind`)) return p.ev('({ kind: DRAWER.kind, id: DRAWER.id })');
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  };
  // the open peek closed (Escape), and gone
  const closePeek = async () => {
    if (!(await p.ev(drawerOpen))) return;
    await p.key('Escape');
    await soon("document.getElementById('drawer').hidden", 'the peek closed');
  };
  // n more of the page's /api/data reads (its 10 s poll, run every 300 ms)
  const polls = async (n) => {
    const from = await p.ev('window.__polls');
    await soon(`window.__polls >= ${from + n}`, `${n} more polls`);
  };

  await t.test('the fixture reaches the page', async () => {
    await load(autonomyFixture(), '#overview');
    const get = (route, pick) => p.ev(`fetch(${JSON.stringify(route)}).then((r) => r.json()).then((d) => ${pick})`);
    assert.equal(await get('/api/data', 'd.autonomy.decisions.score.this_week'), 64);
    assert.equal(await get('/api/data', 'd.awareness.score.this_week'), 71);
    assert.equal(await get('/api/data', 'd.sensors.length'), 3);
    // metrics merged one level: the fixture's findings, the server's cost kept
    assert.equal(await get('/api/data', 'd.metrics.findings.length'), 2);
    assert.equal(await get('/api/data', "typeof d.metrics.cost === 'object' && 'cycle_hours' in d.metrics"), true);
    assert.equal(await get('/api/data', 'd.ooda.trust.length'), 4);
    assert.equal(await get('/api/data', "Array.isArray(d.ooda.knowledge)"), true, 'ooda merged one level');
    assert.equal(await get('/api/governance', 'd.files.length'), 5);
    // a rewritten reply carries none of the original's length or encoding
    assert.deepEqual(await p.ev("fetch('/api/data').then((r) => [r.headers.get('content-length'), r.headers.get('content-encoding'), r.headers.get('content-type')])"), [null, null, 'application/json']);
    assert.equal(await get('/api/peek?kind=sensor&id=errors', 'd.feed.length'), 2);
    await p.ev("fetch('/api/x', { method: 'POST' }).catch(() => null).then(() => 0)");
    assert.deepEqual(await p.ev('window.__writes.map((w) => [w.url, w.method])'), [['/api/x', 'POST']]);
    // a key set to null is gone; governance as a number is that error
    await p.ev('window.__fx.patch.autonomy = null; window.__fx.governance = 500; void 0');
    assert.equal(await get('/api/data', "'autonomy' in d"), false);
    assert.equal(await p.ev("fetch('/api/governance').then(async (r) => [r.status, (await r.json()).error])").then((x) => x.join(' ')), '500 boom');
    await load(autonomyFixture(), '#trust');
    await polls(2);
    assert.deepEqual(await p.ev('window.__errors'), []);
  });
  await t.test('nav order', async () => {
    await load(autonomyFixture(), '#trust');
    assert.deepEqual(await p.ev("[...document.querySelectorAll('.side nav.nav[data-group=\"autonomy\"] a')].map((a) => a.getAttribute('href'))"), ['#trust', '#efficiency', '#awareness', '#governance', '#sensors', '#retros', '#loop']);
  });

  await t.test('#health redirects', async () => {
    // every load adds the same entries to the tab's session history, so a redirect that pushed one would show
    const len = () => p.ev('history.length');
    await load(autonomyFixture(), '#sensors?st=fleet');
    const a = await len();
    await load(autonomyFixture(), '#sensors?st=fleet');
    const b = await len();
    assert.equal(await p.ev('location.hash'), '#sensors?st=fleet');
    await load(autonomyFixture(), '#health');
    await soon("location.hash === '#sensors?st=fleet'", 'health redirected to sensors');
    assert.equal((await len()) - b, b - a, 'the redirect adds no history entry');
  });

  await t.test('Trust counts the score', async () => {
    await load(autonomyFixture(), '#trust');
    assert.equal(await text('#n-trust'), '64%');
  });

  await t.test('Awareness counts its score', async () => {
    await load(autonomyFixture(), '#trust');
    assert.equal(await text('#n-awareness'), '71%');
  });

  await t.test('Sensors count', async () => {
    await load(autonomyFixture(), '#trust');
    assert.equal(await text('#n-sensors'), '2');
    assert.equal(await p.ev("$('n-sensors').classList.contains('hot')"), true);
    await p.ev("window.__fx.patch.sensors[0].state = 'down'; void 0");
    await polls(2);
    await soon("$('n-sensors').textContent.trim() === '1 down'", 'one down');
    assert.equal(await p.ev("$('n-sensors').classList.contains('hot')"), true);
    await p.ev("window.__fx.patch.sensors[0].state = 'up'; window.__fx.patch.metrics.findings.forEach((f) => { f.severity = 'low'; }); void 0");
    await polls(2);
    await soon("$('n-sensors').textContent.trim() === '2'", 'two findings');
    assert.equal(await p.ev("$('n-sensors').classList.contains('hot')"), false);
  });

  await t.test('a #health thread is on Sensors', async () => {
    await load(autonomyFixture(), '#trust');
    assert.equal(await p.ev("tWhere({ kind: 'page', view: '#health' })"), 'Sensors');
  });

  // ---- Trust (T3): the Trust Score card, the kinds in words, How the levels moved, a kind's peek ----
  const LEVELS = ['Asks you first', 'Asks, goes ahead at a deadline', 'Decides and tells you'];
  const secText = (label) => p.ev(`(() => { const s = [...document.querySelectorAll('#trust .card .sec')].find((x) => x.querySelector('.lbl')?.textContent.trim() === ${JSON.stringify(label)}); return s ? s.querySelector('.sec-b').textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
  const KINDS = '#trust [data-tbl="trust:kinds"]', MOVES = '#trust [data-tbl="trust:moves"]';

  await t.test('the Trust Score card', async () => {
    await load(autonomyFixture(), '#trust');
    await soon("!!document.querySelector('#trust .card .card-head')", 'the Trust page drawn');
    // the head's label, then its "this week"
    assert.equal(await p.ev("[...document.querySelector('#trust .card .card-head').childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()"), 'Trust Score');
    assert.equal(await text('#trust .card .card-head .grow'), 'this week');
    assert.deepEqual(await texts('#trust .card:first-child .sec .lbl'), ['Score', 'Trust', 'Senses']);
    const score = await secText('Score');
    assert.match(score, /\b64%/);
    assert.match(score, /last week 58%/);
    await soon("!!document.querySelector('#trust circle.tw')", 'the score line drawn');
    assert.equal(await p.ev("document.querySelector('#trust circle.tw').dataset.i"), '11');
    assert.equal(await p.ev("document.querySelector('#trust circle.lw').dataset.i"), '10');
    assert.equal(await p.ev("document.querySelectorAll('#trust .card:first-child .sparkline').length"), 7);
    await soon("!!document.querySelector('#trust [data-fit=\"trust-split\"] rect[data-i]')", 'the split chart drawn');
    assert.equal(await p.ev("new Set([...document.querySelectorAll('#trust [data-fit=\"trust-split\"] rect[data-i]')].map((r) => r.dataset.i)).size"), 12);
    // the recommendation: this week's count, of, and the share as a %
    assert.match(score, /8 of 9 · 89%/);
    const trust = await secText('Trust');
    assert.match(trust, /3 of 12/);
    assert.match(trust, /1 raised, 1 dropped/);
    const senses = await secText('Senses');
    assert.match(senses, /needed\s*4/);
    assert.match(senses, /has\s*3/);
    assert.match(senses, /working\s*2/);
    assert.match(senses, /Missing: sentry/);
  });

  await t.test('the lessons link', async () => {
    await load(autonomyFixture(), '#trust');
    await soon("!!document.querySelector('#trust a.linkish[href^=\"#loop\"]')", 'the lessons link');
    assert.equal(await p.ev("document.querySelector('#trust a.linkish[href^=\"#loop\"]').getAttribute('href')"), '#loop?lt=orient&kind=lesson');
    assert.equal(await text('#trust a.linkish[href^="#loop"]'), 'the lessons it counted');
    await p.ev("document.querySelector('#trust a.linkish[href^=\"#loop\"]').click(); void 0");
    await soon("location.hash === '#loop?lt=orient&kind=lesson'", 'landed on the lessons');
  });

  await t.test('kinds in words', async () => {
    const fx = autonomyFixture();
    await load(fx, '#trust');
    await soon(`!!document.querySelector(${JSON.stringify(`${KINDS} tbody tr`)})`, 'the kinds table');
    const rows = await rowsOf(KINDS);
    assert.deepEqual(rows.map((r) => r[0]), fx.patch.ooda.trust.map((x) => x.class_name));
    for (const r of rows) {
      assert.ok(LEVELS.some((l) => r[1].startsWith(l)), `Now in words: ${r[1]}`);
      assert.ok(LEVELS.includes(r[2]), `At most in words: ${r[2]}`);
    }
    assert.deepEqual(await texts(`${KINDS} thead th`), ['Kind of decision', 'Now', 'At most', 'Agreed with you', 'Corrected']);
    assert.deepEqual(await texts(`${MOVES} thead th`), ['Kind of decision', 'To', 'Why', 'When']);
    const seen = async (scope) => p.ev(`(() => { const r = document.querySelector(${JSON.stringify(scope)}); return [r.textContent, ...[...r.querySelectorAll('[title], [aria-label]')].flatMap((e) => [e.getAttribute('title') ?? '', e.getAttribute('aria-label') ?? ''])].join('\\n'); })()`);
    const page = await seen('#trust');
    for (const id of fx.ids.classes) assert.ok(!page.includes(id), `no ${id} on the page`);
    assert.ok(await openRow(KINDS, 0), 'a kind opens');
    await soon("!!document.querySelector('#drawer-body .attrs')", 'the kind drawn');
    const peek = await seen('#drawer');
    for (const id of fx.ids.classes) assert.ok(!peek.includes(id), `no ${id} in the peek`);
    await closePeek();
  });

  await t.test('ready to ask for more', async () => {
    const fx = autonomyFixture();
    await load(fx, '#trust');
    await soon(`!!document.querySelector(${JSON.stringify(`${KINDS} tbody tr`)})`, 'the kinds table');
    const rows = await rowsOf(KINDS);
    fx.patch.ooda.trust.forEach((k, i) => {
      assert.equal(rows[i][1].includes('ready to ask for more'), k.class === fx.ids.canAsk, `${k.class_name}: the badge only when it can ask`);
    });
  });

  await t.test("a kind's peek", async () => {
    const fx = autonomyFixture();
    await load(fx, `#class/${fx.ids.newFeature}`);
    await soon("!document.getElementById('drawer').hidden && DRAWER.kind === 'class' && !!document.querySelector('#drawer-body .attrs') && !!document.querySelector('#drawer-body .lvl')", 'the kind peek');
    assert.equal(await text('#drawer-bar-title .dtitle'), fx.patch.ooda.trust.find((k) => k.class === fx.ids.newFeature).class_name);
    assert.equal(await text('#drawer-bar-title .dtype .badge'), 'Kind of decision');
    assert.equal(await p.ev("document.querySelector('#drawer-body').firstElementChild.matches('section.attrs')"), true, 'the properties first');
    assert.deepEqual((await texts('#drawer-body .attrs dt')).slice(0, 6), ['Now', 'At most', 'Since', 'Agreed with you', 'Corrected', 'How it changes']);
    assert.equal(await p.ev("document.querySelectorAll('#drawer-body .lvl').length"), 3);
    assert.equal(await p.ev("document.querySelectorAll('#drawer-body .lvl.now').length"), 1);
    assert.match(await text('#drawer-body .lvl.now'), new RegExp(`^${LEVELS[1]}`));
    assert.match(await text('#drawer-body .lvl.now'), /now$/);
    // since it last moved: the answers after its newest move, and the calls after it, never one before
    const open = await p.ev("[...document.querySelectorAll('#drawer-body .psect .rowline[data-open]')].map((r) => r.dataset.open)");
    const want = [...fx.ids.agreement[fx.ids.newFeature].slice(1).map((id) => `q/${id}`), ...fx.ids.acts[fx.ids.newFeature].slice(1).map((id) => `act/${id}`)];
    assert.deepEqual([...open].sort(), [...want].sort());
    assert.ok(!open.includes(`q/${fx.ids.nfBeforeMove}`), 'the question answered before the move is absent');
    assert.equal(await p.ev("document.querySelectorAll('#drawer-body .psect .rowline[data-open][tabindex=\"0\"][role=\"link\"]').length"), want.length);
    assert.equal(await p.ev("document.querySelectorAll('#drawer-body button, #drawer-body form, #drawer-body select, #drawer-body input, #drawer-body textarea').length"), 0, 'no control in the peek');
    // a row opens its record
    await p.ev(`document.querySelector('#drawer-body .rowline[data-open="act/${fx.ids.acts[fx.ids.newFeature][2]}"]').click(); void 0`);
    await soon(`DRAWER.kind === 'act' && DRAWER.id === ${JSON.stringify(fx.ids.acts[fx.ids.newFeature][2])}`, 'the act opened');
    await closePeek();
  });

  await t.test('evidence the page does not hold', async () => {
    const fx = autonomyFixture();
    // a question its agreement counts that /api/data's answered list doesn't hold: kept, with a muted dot
    const q = 'q-20261101-000000000-gone';
    fx.patch.ooda.trust.find((k) => k.class === fx.ids.newFeature).agreement_questions.push(q);
    await load(fx, `#class/${fx.ids.newFeature}`);
    await soon(`!!document.querySelector('#drawer-body .rowline[data-open="q/${q}"]')`, 'the unheld question listed');
    assert.equal(await p.ev(`document.querySelector('#drawer-body .rowline[data-open="q/${q}"] .dot').className`), 'dot', 'a neutral dot, not a colour');
    assert.equal(await p.ev(`document.querySelector('#drawer-body .rowline[data-open="act/${fx.ids.acts[fx.ids.newFeature][2]}"] .dot').className`), 'dot blue', 'a call keeps its blue dot');
    await closePeek();
  });

  await t.test('Trust rows open', async () => {
    const fx = autonomyFixture();
    await load(fx, '#trust');
    await soon(`!!document.querySelector(${JSON.stringify(`${KINDS} tbody tr`)})`, 'the kinds table');
    for (const [i, how] of [[0, 'click'], [1, 'enter'], [3, 'click']]) {
      assert.deepEqual(await openRow(KINDS, i, how), { kind: 'class', id: fx.patch.ooda.trust[i].class }, `kind row ${i} by ${how}`);
      await closePeek();
    }
    // the newest moves: priority-change's correction (an hour ago), then incident-fix's answer (two hours ago)
    const moves = await rowsOf(MOVES);
    assert.equal(moves.length, 8);
    assert.match(moves[0][2], /^your correction: /);
    assert.equal(moves[1][2], 'your answer');
    assert.deepEqual(await openRow(MOVES, 0, 'click'), { kind: 'act', id: fx.ids.moveCorrection[fx.ids.priorityChange] });
    await closePeek();
    assert.deepEqual(await openRow(MOVES, 1, 'enter'), { kind: 'q', id: fx.ids.moveAnswer[fx.ids.incidentFix] });
    await closePeek();
  });

  await t.test('an unknown kind', async () => {
    await load(autonomyFixture(), '#class/nope');
    await soon("!document.getElementById('drawer').hidden && DRAWER.kind === 'class'", 'the peek');
    await soon("document.getElementById('drawer-body').textContent.includes('No kind of decision by that name.')", 'not found');
    // R2: the id it was asked for shows nowhere in the peek, as text, a title or a label
    assert.equal(await p.ev("(() => { const d = document.getElementById('drawer'); return [d.textContent, ...[...d.querySelectorAll('[title], [aria-label]')].flatMap((e) => [e.getAttribute('title') ?? '', e.getAttribute('aria-label') ?? ''])].join('\\n').includes('nope'); })()"), false, 'no class id in the peek');
    await closePeek();
  });

  await t.test('no autonomy', async () => {
    const fx = autonomyFixture();
    fx.patch.autonomy = null;
    await load(fx, '#trust');
    await soon("!!document.querySelector('#trust .card .sec')", 'the Trust page drawn');
    for (const l of ['Score', 'Trust', 'Senses']) assert.equal(await secText(l), 'None', `${l} says None`);
    await polls(2);
    assert.deepEqual(await p.ev('window.__errors'), []);
  });

  await t.test('redraw keeps focus', async () => {
    await load(autonomyFixture(), '#trust');
    await soon(`!!document.querySelector(${JSON.stringify(`${KINDS} tbody tr`)})`, 'the kinds table');
    assert.ok(await p.ev(`(() => { const tr = document.querySelector(${JSON.stringify(`${KINDS} tbody tr`)}); tr.focus(); window.__f = tr; return document.activeElement === tr; })()`));
    await polls(2);
    assert.equal(await p.ev('document.activeElement === window.__f && window.__f.isConnected'), true);
  });

  await t.test('a sorted table holds', async () => {
    const fx = autonomyFixture();
    await load(fx, '#trust');
    await soon(`!!document.querySelector(${JSON.stringify(`${KINDS} tbody tr`)})`, 'the kinds table');
    const names = fx.patch.ooda.trust.map((x) => x.class_name);
    assert.deepEqual((await rowsOf(KINDS)).map((r) => r[0]), names);
    const HEAD = `${KINDS} button.sort[data-col="0"]`;
    const sortBy = async () => {
      const at = await p.ev(`(() => { const b = document.querySelector(${JSON.stringify(HEAD)}); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      await p.clickAt(at.x, at.y);
    };
    const asc = [...names].sort((a, b) => a.localeCompare(b));
    assert.notDeepEqual(asc, names, 'the fixture is not already in name order');
    await sortBy();
    await soon(`document.querySelector(${JSON.stringify(`${KINDS} th`)}).getAttribute('aria-sort') === 'ascending'`, 'sorted up');
    assert.deepEqual((await rowsOf(KINDS)).map((r) => r[0]), asc);
    assert.equal(await p.ev(`document.activeElement === document.querySelector(${JSON.stringify(HEAD)})`), true, 'focus on the header');
    await polls(2);
    assert.deepEqual((await rowsOf(KINDS)).map((r) => r[0]), asc, 'the order held through two polls');
    assert.equal(await p.ev(`document.activeElement === document.querySelector(${JSON.stringify(HEAD)})`), true, 'focus held on the header');
    await sortBy();
    await soon(`document.querySelector(${JSON.stringify(`${KINDS} th`)}).getAttribute('aria-sort') === 'descending'`, 'sorted down');
    assert.deepEqual((await rowsOf(KINDS)).map((r) => r[0]), [...asc].reverse());
    assert.equal(await p.ev(`document.activeElement === document.querySelector(${JSON.stringify(HEAD)})`), true, 'focus on the header again');
  });

  // ---- Awareness (T4): one Awareness Score card, Efficiency's charts and suggestion list ----
  const AW_WORDS = ['signals explained within a day', 'fixed incidents that left a lesson', 'lessons sessions use', 'fresh starts given what they need'];
  const awSec = (label) => p.ev(`(() => { const s = [...document.querySelectorAll('#awareness .card .sec')].find((x) => x.querySelector('.lbl')?.textContent.trim() === ${JSON.stringify(label)}); return s ? s.querySelector('.sec-b').textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
  const AW_ITEM = (id) => `document.querySelector('#awareness [data-sugg="' + CSS.escape(${JSON.stringify(id)}) + '"]')`;
  const AW_VIEW = (id) => `#awareness?suggestion=${encodeURIComponent(id)}`;
  const awDrawn = () => soon("!!document.querySelector('#awareness .card .sec')", 'the Awareness page drawn');

  await t.test('the Awareness card', async () => {
    await load(autonomyFixture(), '#awareness');
    await awDrawn();
    assert.equal(await p.ev("document.querySelectorAll('#awareness .card').length"), 1);
    assert.equal(await p.ev("[...document.querySelector('#awareness .card .card-head').childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()"), 'Awareness Score');
    assert.deepEqual(await texts('#awareness .card .sec .lbl'), ['Score', 'Suggestions']);
    const score = await awSec('Score');
    assert.match(score, /\b71%/);
    assert.match(score, /last week 66%/);
    // this week's parts: each in its words with "c of o", the starts part (0 of 0) none
    const parts = await p.ev("[...document.querySelectorAll('#awareness .aw-parts .stat')].map((s) => [s.querySelector('.k').textContent.trim(), s.querySelector('b').textContent.trim()])");
    assert.deepEqual(parts.map((x) => x[0]), AW_WORDS);
    assert.deepEqual(parts.slice(0, 3).map((x) => x[1]), ['3 of 4 · 75%', '2 of 3 · 67%', '5 of 7 · 71%']);
    assert.equal(parts[3][1], 'none');
    // the line, broken at the null week: two runs
    await soon("!!document.querySelector('#awareness [data-fit=\"aw-score\"] path.line')", 'the score line drawn');
    assert.equal(await p.ev("(document.querySelector('#awareness [data-fit=\"aw-score\"] path.line').getAttribute('d').match(/M/g) || []).length"), 2);
    assert.equal(await p.ev("document.querySelector('#awareness circle.tw').dataset.i"), '11');
    assert.equal(await p.ev("document.querySelectorAll('#awareness .card .sparkline').length"), 4);
  });

  await t.test('suggestions', async () => {
    await load(autonomyFixture(), '#awareness');
    await awDrawn();
    assert.deepEqual(await texts('#awareness .sugg-n'), ['1', '2', '3']);
    assert.deepEqual(await texts('#awareness .sugg-go'), ['Learn from a fixed incident', 'Retire lessons nobody is given', 'Explain something that keeps happening']);
    assert.equal(await p.ev("document.querySelectorAll('#awareness button').length"), 0);
  });

  await t.test('a suggestion starts its thread', async () => {
    const fx = autonomyFixture();
    const [one, two, three] = fx.ids.suggestions;
    await load(fx, '#awareness');
    await awDrawn();
    await p.ev('window.__writes.length = 0; void 0');
    await p.click(`#awareness [data-sugg="${one}"]`);
    await soon(`TL.draft?.subject?.view === ${JSON.stringify(AW_VIEW(one))}`, 'a draft on the first');
    assert.equal(await p.ev('TL.draft.subject.kind'), 'page');
    assert.equal(await p.ev(`TL.draft.subject.view`), '#awareness?suggestion=aw-incident-p-1');
    assert.equal(await p.ev(`tlRowOf(TL.draft.subject).el === ${AW_ITEM(one)}`), true, 'the item is its row');
    await p.ev('tlClose(); void 0');
    await p.ev(`(${AW_ITEM(two)}).focus(); void 0`);
    await p.key('Enter');
    await soon(`TL.draft?.subject?.view === ${JSON.stringify(AW_VIEW(two))}`, 'a draft by Enter');
    await p.ev('tlClose(); void 0');
    assert.deepEqual(await p.ev('window.__writes'), []);
    // an open thread on the third: a click opens it
    const TH3 = 't-20261116-000000003-owner';
    await p.ev(`window.__fx.threads.push(${JSON.stringify({ id: TH3, title: 'Explain something that keeps happening', subject: { kind: 'page', view: AW_VIEW(three), quote: 'x' }, status: 'open', outcome: null, ready: null, turns: [], questions: [], waiting: 'owner', created_at: new Date(Date.now() - 3600000).toISOString(), resolved_at: null, activity_at: new Date(Date.now() - 3600000).toISOString(), first_reply_ms: null })}); void 0`);
    await soon(`TL.threads.some((t) => t.id === ${JSON.stringify(TH3)})`, 'the threads read');
    await p.click(`#awareness [data-sugg="${three}"]`);
    await soon(`TL.open === ${JSON.stringify(TH3)}`, 'the open thread opened');
    assert.equal(await p.ev('TL.draft'), null);
    await p.ev('tlClose(); void 0');
    assert.deepEqual(await p.ev('window.__writes'), []);
  });

  await t.test("where an Awareness suggestion's thread lives", async () => {
    await load(autonomyFixture(), '#awareness');
    assert.equal(await p.ev("tWhere({ kind: 'page', view: '#awareness?suggestion=aw-x' })"), 'Awareness');
    assert.equal(await p.ev("tWhere({ kind: 'page', view: '#efficiency?suggestion=eff-x' })"), 'Efficiency');
  });

  await t.test('plain words', async () => {
    await load(autonomyFixture(), '#awareness');
    await awDrawn();
    const words = await p.ev("document.getElementById('awareness').textContent");
    assert.doesNotMatch(words, /informed|orient|debt/i);
  });

  await t.test('no awareness', async () => {
    const fx = autonomyFixture();
    fx.patch.awareness = null;
    await load(fx, '#awareness');
    await awDrawn();
    for (const l of ['Score', 'Suggestions']) assert.equal(await awSec(l), 'None', `${l} says None`);
    assert.equal(await text('#n-awareness'), '');
    await polls(2);
    assert.deepEqual(await p.ev('window.__errors'), []);
  });

  // ---- Governance (T5): the files in three sections, each a read-only file peek; a paragraph is a thread's subject ----
  const GOV_TBL = (g) => `#governance [data-tbl="gov:${g}"]`;
  const govDrawn = () => soon("!!document.querySelector('#governance .card .sec tbody tr')", 'the Governance page drawn');
  const govSec = (label) => p.ev(`(() => { const s = [...document.querySelectorAll('#governance .card .sec')].find((x) => x.querySelector('.lbl')?.textContent.trim() === ${JSON.stringify(label)}); return s ? [...s.querySelectorAll('tbody tr')].map((r) => [...r.cells].map((c) => c.textContent.replace(/\\s+/g, ' ').trim())) : null; })()`);
  const fileView = (path) => `#file?path=${encodeURIComponent(path)}`;
  const PEEK_MD = "!!document.querySelector('#drawer-body .md p')";
  // the peek rendered and done redrawing (its history arrives after the file and redraws it): the same .md for 1 s
  const peekSettled = async (what) => {
    await soon(PEEK_MD, what);
    const end = Date.now() + 15000;
    for (;;) {
      await p.ev("window.__md = document.querySelector('#drawer-body .md'); void 0");
      await new Promise((r) => setTimeout(r, 1000));
      if (await p.ev("window.__md === document.querySelector('#drawer-body .md') && !!window.__md?.isConnected")) return;
      assert.ok(Date.now() < end, `${what}: the peek never settled`);
    }
  };
  // Shift held and the pointer moved over the i-th of the peek's rendered blocks matching sel (kept as window.__blk)
  const pointAt = async (sel, i) => {
    const at = await p.ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (!e) return null; window.__blk = e; e.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + Math.min(40, r.width / 2)), y: Math.round(r.top + r.height / 2) }; })()`);
    assert.ok(at, `no ${sel} [${i}] in the peek`);
    await p.hold('Shift', true);
    await p.move(at.x, at.y, 8);
    return at;
  };
  // a paragraph pinned, outlined, Shift+clicked into a draft, sent: the POST's subject and its Threads-panel row
  const pinParagraph = async (path) => {
    await peekSettled('the rendered file');
    const at = await pointAt('#drawer-body .md p', 1);
    await soon('TL.hit?.el === window.__blk', 'the paragraph pointed at');
    const off = await p.ev("(() => { const h = document.getElementById('tl-hl').getBoundingClientRect(), r = window.__blk.getBoundingClientRect(); return [h.left - (r.left - 3), h.top - (r.top - 3), h.width - (r.width + 6), h.height - (r.height + 6)]; })()");
    assert.ok(off.every((d) => Math.abs(d) <= 1), `the outline is the paragraph grown by 3px: ${off}`);
    await p.clickAt(at.x, at.y, 8);
    await p.hold('Shift', false);
    await soon('!!TL.draft', 'a draft on the paragraph');
    const quote = await p.ev("window.__blk.textContent.replace(/\\s+/g, ' ').trim()");
    assert.ok(Buffer.byteLength(quote) <= 300, 'a paragraph under the quote cap');
    const subject = { kind: 'page', view: fileView(path), quote };
    assert.deepEqual(await p.ev('TL.draft.subject'), subject);
    await p.ev('window.__writes.length = 0; void 0');
    await p.click('#tl-c-text');
    await p.type('reword this');
    await p.click('[data-tl-send]');
    await soon("window.__writes.some((w) => w.url === '/api/thread-new')", 'the thread posted');
    const w = await p.ev("window.__writes.filter((x) => x.url === '/api/thread-new')");
    assert.equal(w.length, 1);
    assert.equal(w[0].method, 'POST');
    assert.deepEqual(JSON.parse(w[0].body).subject, subject);
    const id = await soon(`TL.threads.find((t) => t.subject?.view === ${JSON.stringify(subject.view)} && t.subject?.quote === ${JSON.stringify(quote)} && !String(t.id).startsWith('pending-'))?.id`, 'the thread read back');
    assert.equal(await p.ev(`thInPanelId(${JSON.stringify(id)})`), true, 'a Threads-panel thread');
    await p.ev("tlClose(); thGo({ th: 'open' }); void 0");
    await soon(`!!document.querySelector('#th-pane [data-tl-open="${id}"]')`, 'listed in the Threads panel');
    await p.ev('thGo({}); void 0');
  };

  await t.test('Governance in three sections', async () => {
    const fx = autonomyFixture();
    await load(fx, '#governance');
    await govDrawn();
    assert.equal(await p.ev("document.querySelectorAll('#governance .card').length"), 1);
    assert.equal(await p.ev("[...document.querySelector('#governance .card .card-head').childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()"), 'Files');
    assert.deepEqual(await texts('#governance .card .sec .lbl'), ['Governance', 'Process', 'Project']);
    for (const [g, label] of [['governance', 'Governance'], ['process', 'Process'], ['project', 'Project']]) {
      const want = fx.governance.files.filter((f) => f.group === g);
      const rows = await govSec(label);
      assert.deepEqual(rows.map((r) => r.slice(0, 2)), want.map((f) => [f.state ? `${f.title} ${f.state}` : f.title, f.path]), `${label}'s rows`);
      rows.forEach((r, i) => (want[i].written ? assert.notEqual(r[2], '—') : assert.equal(r[2], '—')));
    }
    assert.equal(await p.ev(`[...document.querySelectorAll('#governance .badge')].find((b) => b.textContent.trim() === 'changed here')?.closest('tr').textContent.includes(${JSON.stringify(fx.ids.governance.changed)})`), true);
    assert.equal(await p.ev(`[...document.querySelectorAll('#governance .badge')].find((b) => b.textContent.trim() === 'not written yet')?.closest('tr').textContent.includes(${JSON.stringify(fx.ids.governance.notWritten)})`), true);
  });

  await t.test('a file opens read-only', async () => {
    const fx = autonomyFixture();
    const g = fx.ids.governance;
    await load(fx, '#governance');
    await govDrawn();
    for (const [sel, i, how, id] of [[GOV_TBL('governance'), 1, 'click', g.changed], [GOV_TBL('process'), 0, 'enter', g.process], [GOV_TBL('project'), 1, 'click', g.written], [GOV_TBL('governance'), 0, 'enter', g.constitution]]) {
      assert.deepEqual(await openRow(sel, i, how), { kind: 'file', id }, `${id} by ${how}`);
      await soon(PEEK_MD, `${id} rendered`);
      assert.equal(await p.ev("document.getElementById('drawer-body').firstElementChild?.matches('section.attrs')"), true, 'properties first');
      assert.equal(await p.ev("document.querySelectorAll('#drawer-body textarea, #drawer-body form, #drawer-body input, #drawer-body [contenteditable]').length"), 0, 'no editor');
      assert.deepEqual(await p.ev("[...document.querySelectorAll('#drawer-body button')].filter((b) => !b.matches('[data-mdview]')).map((b) => b.outerHTML)"), [], 'no button but the view toggle');
      await closePeek();
    }
    // the not-written file: nothing to open, and no link in its row (A8)
    assert.equal(await p.ev(`(() => { const tr = ${ROWS(GOV_TBL('project'))}[0]; return !!tr && /not written yet/.test(tr.textContent) && !tr.querySelector('a'); })()`), true, 'the not-written row holds no link');
    assert.equal(await openRow(GOV_TBL('project'), 0, 'click'), null);
    assert.equal(await openRow(GOV_TBL('project'), 0, 'enter'), null);
    assert.deepEqual(await p.ev('window.__writes'), []);
  });

  await t.test('Shift+click pins a paragraph', async () => {
    const fx = autonomyFixture();
    const g = fx.ids.governance;
    await load(fx, '#governance');
    await govDrawn();
    assert.deepEqual(await openRow(GOV_TBL('governance'), 1, 'click'), { kind: 'file', id: g.changed });
    await pinParagraph(g.changed);
    assert.equal(fileView(g.changed), '#file?path=docs%2Fdevteam%2Fgovernance%2Fquality.md');
    // the Project group's file, opened from the page
    await load(fx, '#governance');
    await govDrawn();
    assert.deepEqual(await openRow(GOV_TBL('project'), 1, 'click'), { kind: 'file', id: g.written });
    await pinParagraph(g.written);
    assert.deepEqual(await p.ev('window.__errors'), []);
  });

  await t.test('a listed file with a long path pins on Governance', async () => {
    const fx = autonomyFixture();
    const g = fx.ids.governance;
    await load(fx, '#governance');
    await govDrawn();
    assert.deepEqual(await openRow(GOV_TBL('governance'), 0, 'click'), { kind: 'file', id: g.constitution });
    await peekSettled('the rendered file');
    // the peek's paragraph, as the listing's file and as a listed file whose #file view is over the log's 200 bytes
    const long = `docs/devteam/governance/${'a-very-long-name-'.repeat(12)}.md`;
    const at = (path) => p.ev(`(() => { const was = DRAWER.id; GOV.files.push({ path: ${JSON.stringify(long)}, group: 'governance', title: 'Long', written: true }); DRAWER.id = ${JSON.stringify(path)};
      try { return tSubjectAt(document.querySelector('#drawer-body .md p'), 0, 0, () => null)?.subject?.view ?? null; } finally { DRAWER.id = was; GOV.files.pop(); } })()`);
    assert.equal(await at(g.constitution), fileView(g.constitution));
    assert.ok(Buffer.byteLength(fileView(long)) > 200, 'the long view is over 200 bytes');
    assert.equal(await at(long), '#governance');
    await closePeek();
  });

  await t.test("a peek outside Governance's list", async () => {
    await load(autonomyFixture(), '#governance');
    await govDrawn();
    // a kit file the listing doesn't name (the bare project has no README): its router home is Governance, but
    // the listing decides (C8)
    await p.ev("location.hash = '#file?path=docs%2Fdevteam%2Fprocess%2Fplanning.md&title=Planning'; void 0");
    await soon(`DRAWER.kind === 'file' && DRAWER.id === 'docs/devteam/process/planning.md' && ${PEEK_MD}`, 'planning.md rendered');
    await peekSettled('planning.md settled');
    assert.equal(await p.ev("govListed('docs/devteam/process/planning.md') || !GOV.files?.length"), false, 'a listing without it');
    await pointAt('#drawer-body .md p', 0);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(await p.ev('TL.hit'), null);
    await p.hold('Shift', false);
  });

  await t.test('governance unreachable', async () => {
    const fx = autonomyFixture();
    fx.governance = 500;
    await load(fx, '#governance');
    await soon("/boom/.test(document.getElementById('governance').textContent)", 'the error shown');
    assert.equal(await p.ev("!!document.querySelector('#governance .err')"), true);
    await polls(2);
    assert.deepEqual(await p.ev('window.__errors'), []);
  });

  await t.test('a reply that is not a listing', async () => {
    const fx = autonomyFixture();
    fx.governance = { nope: 1 };
    await load(fx, '#governance');
    await soon("!!document.querySelector('#governance .err')", 'the error shown');
    assert.equal(await p.ev("document.querySelectorAll('#governance .sec').length"), 0, 'no empty sections');
    assert.deepEqual(await p.ev('window.__errors'), []);
  });

  await t.test('a failed re-read keeps the last listing', async () => {
    const fx = autonomyFixture();
    await load(fx, '#governance');
    await govDrawn();
    const before = await govSec('Governance');
    await p.ev('window.__fx.governance = 500; loadGovernance(true); void 0');
    await soon("/boom/.test(document.querySelector('#governance .err')?.textContent ?? '')", 'the error shown');
    assert.deepEqual(await govSec('Governance'), before, 'the last listing still shown');
    assert.equal(await p.ev("(() => { const e = document.querySelector('#governance .err'), s = document.querySelector('#governance .sec'); return !!(e.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING); })()"), true, 'the error above the listing');
    // read again, the error goes
    await p.ev(`window.__fx.governance = ${JSON.stringify(fx.governance)}; loadGovernance(true); void 0`);
    await soon("!document.querySelector('#governance .err')", 'the error gone');
    assert.deepEqual(await govSec('Governance'), before);
    assert.deepEqual(await p.ev('window.__errors'), []);
  });

  // ---- Sensors (T6): Production (the incidents board, a card a sensor) and Fleet (Health's tables) ----
  const J = JSON.stringify;
  const FLEET = (n) => `#monitoring [data-tbl="fleet:${n}"]`;
  const SCARD = (n) => `#monitoring .sensor-card[data-open="sensor/${n}"]`;
  // a card head's own label: its text nodes, without the icon and the .grow extra
  const headLabels = (sel) => p.ev(`[...document.querySelectorAll(${J(sel)})].map((h) => [...h.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim())`);
  const selectedTab = () => p.ev("document.querySelector('#monitoring [role=\"tab\"][aria-selected=\"true\"]')?.dataset.tab ?? null");
  const productionDrawn = () => soon("!!document.querySelector('#monitoring .sensor-card') && !!document.querySelector('#incidents')", 'Production drawn');
  const fleetDrawn = () => soon(`!!document.querySelector(${J(`${FLEET('findings')} tr[data-row]`)})`, 'Fleet drawn');
  // a peek section's body text, and the hashes its rows open (null: no such section)
  const PSECT = (title) => `[...document.querySelectorAll('#drawer-body .psect')].find((x) => x.querySelector('.card-head .grow')?.textContent.trim() === ${J(title)})`;
  const psectText = (title) => p.ev(`(() => { const s = ${PSECT(title)}; return s ? s.querySelector('.psect-body').textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
  const psectOpens = (title) => p.ev(`(() => { const s = ${PSECT(title)}; return s ? [...s.querySelectorAll('.rowline[data-open]')].map((r) => decodeURIComponent(r.dataset.open)) : null; })()`);

  await t.test('Sensors has two tabs', async () => {
    await load(autonomyFixture(), '#sensors');
    await productionDrawn();
    assert.equal(await p.ev("document.getElementById('monitoring').classList.contains('no-shell')"), false);
    const tabs = await texts('#monitoring [role="tab"]');
    assert.equal(tabs.length, 2, tabs.join(' | '));
    assert.match(tabs[0], /^Production\b/);
    assert.match(tabs[1], /^Fleet\b/);
    assert.equal(await selectedTab(), 'production');
    // the incidents card first, then one card per sensor, in the order the server gives them
    assert.deepEqual(await headLabels('#monitoring .g12 > .card > .card-head'), ['Incidents', 'hub', 'kit-github', 'errors']);
    assert.equal(await p.ev("!!document.querySelector('#monitoring .g12 > .card:first-child #incidents')"), true);
    assert.equal(await p.ev("document.querySelectorAll('#monitoring .sensor-card').length"), 3);
    for (const id of ['sensor-feed', 'sensor-exceptions']) assert.equal(await p.ev(`!!document.getElementById(${J(id)})`), false, `no #${id}`);
    const heads = await texts('#monitoring h1, #monitoring h2, #monitoring h3, #monitoring h4, #monitoring .card-head');
    for (const h of ['Observations', 'Exceptions and errors']) assert.ok(!heads.some((x) => x.startsWith(h)), `no heading ${h}: ${heads.join(' | ')}`);
    // the error tracker's card shows its events by level (C7), as the probe's does
    const tracker = await text(SCARD('errors'));
    assert.match(tracker, /\berror 5\b/);
    assert.match(tracker, /\bwarn 3\b/);
    assert.match(await text(SCARD('kit-github')), /\binfo 8\b/);
    // a card is a button to the keyboard
    assert.equal(await p.ev(`[...document.querySelectorAll('#monitoring .sensor-card')].every((c) => c.getAttribute('role') === 'button' && c.getAttribute('tabindex') === '0')`), true);
    assert.deepEqual(await p.ev('window.__errors'), []);
  });

  await t.test('the tabs count zero', async () => {
    const fx = autonomyFixture();
    fx.patch.sensors = [];
    fx.patch.metrics.findings = [];
    await load(fx, '#sensors');
    await soon("document.querySelectorAll('#monitoring [role=\"tab\"]').length === 2", 'the tabs');
    assert.deepEqual(await texts('#monitoring [role="tab"]'), ['Production 0', 'Fleet 0']);
    assert.deepEqual(await p.ev('window.__errors'), []);
  });

  await t.test('the incidents board by stage', async () => {
    const fx = autonomyFixture();
    const inc = fx.ids.incidents;
    await load(fx, '#sensors');
    await soon("!!document.querySelector('#incidents .tcard')", 'the incident board');
    assert.deepEqual(await texts('#incidents .board.inc > .col > h3 > span:first-child'), ['Open', 'Investigating', 'Fixing', 'Watching', 'Resolved']);
    const col = (i) => p.ev(`(() => { const c = document.querySelectorAll('#incidents .board.inc > .col')[${i}]; return c ? [...c.querySelectorAll('.tcard')].map((x) => decodeURIComponent(x.dataset.open)) : null; })()`);
    const P = (...ks) => ks.map((k) => `problem/${inc[k]}`);
    assert.deepEqual(await col(0), P('new', 'regressed'));
    assert.deepEqual(await col(1), P('triaged'));
    assert.deepEqual(await col(2), P('fixing', 'merged'));
    assert.deepEqual(await col(3), P('verifying'));
    assert.deepEqual(await col(4), P('resolved'));
    const card = (id) => `document.querySelector('#incidents .tcard[data-open="problem/${encodeURIComponent(id)}"]')`;
    assert.equal(await p.ev(`${card(inc.regressed)}.classList.contains('blocked')`), true, 'the regressed one marked red');
    assert.equal(await p.ev(`${card(inc.new)}.classList.contains('blocked')`), false);
    assert.match(await p.ev(`${card(inc.merged)}.textContent`), /merged, not yet verified/);
    assert.doesNotMatch(await p.ev(`${card(inc.fixing)}.textContent`), /not yet verified/);
    for (const x of fx.patch.incidents) {
      const c = (await p.ev(`${card(x.id)}.textContent`)).replace(/\s+/g, ' ');
      assert.match(c, new RegExp(`severity ${x.severity}\\b`), `${x.stage}: its severity`);
      assert.match(c, new RegExp(`\\b${x.events} event`), `${x.stage}: its events`);
      if (x.waiting) assert.ok(c.includes(x.waiting.replace(/ at \S+$/, '')), `${x.stage}: its waiting line: ${c}`);
    }
    // none: "None"
    await p.ev('window.__fx.patch.incidents = []; void 0');
    await polls(2);
    await soon("document.getElementById('incidents').textContent.trim() === 'None'", 'no incidents: None');
    assert.deepEqual(await p.ev('window.__errors'), []);
  });

  await t.test("a sensor card's trouble", async () => {
    await load(autonomyFixture(), '#sensors');
    await productionDrawn();
    const errors = await text(SCARD('errors'));
    assert.match(errors, /connection refused/);
    assert.match(errors, /trying again in 4 min/);
    const hub = await text(SCARD('hub'));
    assert.match(hub, /certificate 41 days left/);
    assert.doesNotMatch(hub, /trying again/);
    assert.match(hub, /checked /);
    const kg = await text(SCARD('kit-github'));
    assert.doesNotMatch(kg, /connection refused|trying again/);
    assert.match(kg, /ran /);
  });

  await t.test('Fleet', async () => {
    const fx = autonomyFixture();
    const m = fx.patch.metrics;
    await load(fx, '#sensors?st=fleet');
    await fleetDrawn();
    assert.equal(await selectedTab(), 'fleet');
    assert.deepEqual(await headLabels('#monitoring .card > .card-head'), ['Findings', 'Set aside', 'Checks before merge', 'Flaky tests', 'Slowest tests']);
    const all = await text('#monitoring');
    for (const h of ['Hours by phase', 'USD by phase', 'USD by model', 'Tokens']) assert.ok(!all.includes(h), `R1: no ${h} on Fleet`);
    // each finding with its next step
    const fs = await rowsOf(FLEET('findings'));
    assert.deepEqual(fs.map((r) => r[2]), m.findings.map((f) => f.suggestion));
    assert.match(fs[0][0], /no phase line for 3 hours/);
    assert.match(fs[0][1], /high/);
    // set aside: why, by, until
    const aside = await rowsOf(FLEET('aside'));
    assert.equal(aside.length, 1);
    assert.equal(aside[0][2], 'the suite is being split');
    assert.equal(aside[0][3], 'the supervisor');
    // the configured checks, trouble first; the one-off checks counted in the head, named in its title
    const gs = await rowsOf(FLEET('gates'));
    assert.deepEqual(gs.map((r) => r[0].split(' ')[0]), ['scripts', 'devteam']);
    assert.match(gs[0][0], /\bflaky\b/);
    assert.match(gs[0][3], /allowed because main failed too/);
    assert.doesNotMatch(gs[1][0], /flaky/);
    const gHead = `document.querySelector(${J(FLEET('gates'))}).closest('.card').querySelector('.card-head')`;
    assert.match(await p.ev(`${gHead}.textContent`), /\+ 2 one-off checks/);
    const tip = await p.ev(`${gHead}.querySelector('[title]')?.getAttribute('title') ?? ''`);
    for (const g of fx.ids.oneOff) assert.ok(tip.includes(g), `${g} named in the title: ${tip}`);
    assert.deepEqual((await rowsOf(FLEET('flaky'))).map((r) => r[0]), m.gates.flaky_tests.map((x) => x.name));
    assert.deepEqual((await rowsOf(FLEET('slowest'))).map((r) => r[0]), m.gates.slowest_tests.map((x) => x.name));
    // empty tables say None
    await p.ev('window.__fx.patch.metrics.acknowledged = []; void 0');
    await polls(2);
    await soon(`(document.querySelector(${J(FLEET('aside'))})?.textContent ?? '').trim().startsWith('Finding') && /None$/.test(document.querySelector(${J(FLEET('aside'))}).textContent.trim())`, 'Set aside: None');
    assert.deepEqual(await p.ev('window.__errors'), []);
  });

  await t.test('Fleet rows open', async () => {
    const fx = autonomyFixture();
    const ROW_A = (sel, i) => p.ev(`${ROWS(sel)}[${i}].querySelectorAll('a').length`);
    // the fixture's set-aside subject is a check's name, no record: nothing opens
    await load(fx, '#sensors?st=fleet');
    await fleetDrawn();
    assert.equal(await openRow(FLEET('aside'), 0, 'click'), null);
    // one whose subject names a record (a sensor) opens it; the finding's ticket is a real one, listed in /api/data;
    // a subject shaped like a ticket, and a sensor or planner the data doesn't list, name no record (R2)
    fx.patch.metrics.acknowledged[0].subject = 'sensor:hub';
    fx.patch.tickets = [{ id: fx.ids.findingTicket, title: 'Refund a payment', stage: 'building', phase: 'implementing' }];
    const base = fx.patch.metrics.findings[1];
    fx.patch.metrics.findings.push(...['max-2', 'sensor:no-such-sensor', 'plan-no-such-feature'].map((subject) => ({ ...base, subject })));
    await load(fx, '#sensors?st=fleet');
    await fleetDrawn();
    assert.equal((await rowsOf(FLEET('findings')))[0][3], 'Refund a payment', "the Subject cell names the ticket by its title");
    for (const how of ['click', 'enter']) {
      assert.deepEqual(await openRow(FLEET('findings'), 0, how), { kind: 'ticket', id: fx.ids.findingTicket }, `the ticket finding by ${how}`);
      await closePeek();
      assert.deepEqual(await openRow(FLEET('aside'), 0, how), { kind: 'sensor', id: 'hub' }, `the set-aside row by ${how}`);
      await closePeek();
      assert.equal(await selectedTab(), 'fleet', 'back on Fleet');
      // a commit names no record; a check and a test are figures
      for (const [sel, i] of [[FLEET('findings'), 1], [FLEET('findings'), 2], [FLEET('findings'), 3], [FLEET('findings'), 4], [FLEET('gates'), 0], [FLEET('gates'), 1], [FLEET('flaky'), 0], [FLEET('slowest'), 0]]) {
        assert.equal(await openRow(sel, i, how), null, `${sel} row ${i} by ${how} opens nothing`);
        assert.equal(await ROW_A(sel, i), 0, `${sel} row ${i} holds no link`);
      }
    }
    assert.deepEqual(await p.ev('window.__errors'), []);
  });

  await t.test('the sensor peek', async () => {
    const fx = autonomyFixture();
    await load(fx, '#sensors');
    await productionDrawn();
    // a click on the tracker's card opens its peek
    await p.click(SCARD('errors'));
    await soon(`${drawerOpen} && DRAWER.kind === 'sensor' && DRAWER.id === 'errors'`, "the tracker's peek");
    await soon(`!!(${PSECT('Fingerprints')})`, 'its fingerprints');
    const obs = fx.ids.observations.errors.map((id) => `observation/${id}`);
    assert.deepEqual(await psectOpens('Observations it made'), obs);
    assert.match(await psectText('Observations it made'), /TypeError: card is undefined/);
    const incs = fx.patch.incidents.filter((x) => x.sensor === 'errors').map((x) => `problem/${x.id}`);
    assert.deepEqual((await psectOpens('Incidents')).sort(), incs.sort());
    assert.match(await psectText('Incidents'), /Receipts fail to mail after the fix/);
    const fp = await psectText('Fingerprints');
    assert.match(fp, /5 in 24h · 5 seen/);
    assert.match(fp, /3 in 24h · 3 seen/);
    assert.equal(await psectText('What it read'), null, 'a tracker reads fingerprints');
    // its sections come before its history
    assert.equal(await p.ev(`(() => { const s = ${PSECT('Incidents')}; const h = [...document.querySelectorAll('#drawer-body .psect')].find((x) => /^History/.test(x.querySelector('.card-head .grow')?.textContent.trim() ?? '')); return !h || !!(s.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING); })()`), true);
    // a row opens its record: one by a click, the next by Enter
    await p.ev(`(${PSECT('Observations it made')}).querySelector('.rowline[data-open]').click(); void 0`);
    await soon(`DRAWER.kind === 'observation' && DRAWER.id === ${J(fx.ids.observations.errors[0])}`, 'an observation by a click');
    await p.ev('history.back(); void 0');
    await soon(`DRAWER.kind === 'sensor' && DRAWER.id === 'errors' && !!(${PSECT('Observations it made')})`, 'back on the peek');
    assert.equal(await p.ev(`(() => { const r = (${PSECT('Observations it made')}).querySelectorAll('.rowline[data-open]')[1]; r.focus(); return document.activeElement === r; })()`), true);
    await p.key('Enter');
    await soon(`DRAWER.kind === 'observation' && DRAWER.id === ${J(fx.ids.observations.errors[1])}`, 'an observation by Enter');
    // the probe: What it read, no Fingerprints
    await p.ev("location.hash = '#sensor/kit-github'; void 0");
    await soon(`DRAWER.kind === 'sensor' && DRAWER.id === 'kit-github' && !!(${PSECT('What it read')})`, "the probe's peek");
    assert.equal(await psectText('Fingerprints'), null);
    // no link to an Incidents page, on the page or in a peek
    assert.equal(await p.ev("document.querySelectorAll('a[href=\"#incidents\"]').length"), 0);
    assert.equal(await p.ev("[...document.querySelectorAll('a')].filter((a) => /Incidents page/i.test(a.textContent)).length"), 0);
    await closePeek();
    // a sensor card by Enter
    assert.equal(await p.ev(`(() => { const c = document.querySelector(${J(SCARD('hub'))}); c.focus(); return document.activeElement === c; })()`), true);
    await p.key('Enter');
    await soon(`${drawerOpen} && DRAWER.kind === 'sensor' && DRAWER.id === 'hub'`, "the http sensor's peek by Enter");
    assert.deepEqual(await psectOpens('Observations it made'), fx.ids.observations.hub.map((id) => `observation/${id}`));
    assert.equal(await p.ev("document.querySelectorAll('#drawer-body table.db-t, #drawer-body .sensor-rows button').length"), 0, 'rows, no table or sort button in the peek (D1)');
    assert.deepEqual(await p.ev('window.__errors'), []);
  });

  await t.test('tabs by keyboard', async () => {
    await load(autonomyFixture(), '#sensors');
    await productionDrawn();
    assert.equal(await p.ev("(() => { const b = document.querySelector('#monitoring [role=\"tab\"][data-tab=\"production\"]'); b.focus(); return document.activeElement === b; })()"), true);
    await p.key('ArrowRight');
    await soon("location.hash === '#sensors?st=fleet'", 'Fleet by ArrowRight');
    await fleetDrawn();
    assert.equal(await selectedTab(), 'fleet');
    assert.equal(await p.ev('document.activeElement?.dataset?.tab ?? null'), 'fleet', 'the focus on the Fleet tab');
    await p.ev('history.back(); void 0');
    await soon("location.hash === '#sensors'", 'Back to Production');
    await productionDrawn();
    assert.equal(await selectedTab(), 'production');
    // a click on a tab
    await p.click('#monitoring [role="tab"][data-tab="fleet"]');
    await soon("location.hash === '#sensors?st=fleet'", 'Fleet by a click');
    await fleetDrawn();
  });

  await t.test('redraw keeps the tab', async () => {
    await load(autonomyFixture(), '#sensors?st=fleet');
    await fleetDrawn();
    await polls(2);
    assert.equal(await selectedTab(), 'fleet');
    assert.equal(await p.ev("!!document.querySelector('#monitoring .sensor-card')"), false, 'Production not drawn');
    assert.equal(await p.ev('location.hash'), '#sensors?st=fleet');
    assert.deepEqual(await p.ev('window.__errors'), []);
  });

  await t.test('Retros as cards', async () => {
    const fx = autonomyFixture();
    await load(fx, '#retros');
    await soon("document.querySelectorAll('#retros .cards > .card').length === 3", 'three cards');
    const cards = await texts('#retros .cards > .card');
    assert.match(cards[0], /Next retro/);
    assert.match(cards[0], /due since/);
    assert.match(await text('#retros .cards > .card:first-child .badge.medium'), new RegExp(`^due since ${fx.patch.ooda.retro.due_since.slice(0, 10)}$`), 'the date in a badge');
    assert.match(cards[0], /a feature merged/);
    assert.match(cards[1], /Reviews caught the card-form regressions/);
    assert.match(cards[2], /The first wave merged on time/);
    assert.deepEqual(await p.ev("[...document.querySelectorAll('#retros .cards > .card[data-open]')].map((c) => [c.dataset.open, c.getAttribute('tabindex'), c.getAttribute('role')])"), fx.ids.retros.map((id) => [`retro/${id}`, '0', 'button']));
    assert.equal(await p.ev("document.querySelector('#retros').matches('.no-shell') || !!document.querySelector('#retros .no-shell')"), false, 'no no-shell');
    await p.click('#retros .cards > .card[data-open]:nth-of-type(2)');
    await soon(`${drawerOpen} && DRAWER.kind === 'retro' && DRAWER.id === ${JSON.stringify(fx.ids.retros[0])}`, 'the first retro by a click');
    await closePeek();
    assert.equal(await p.ev("(() => { const c = document.querySelectorAll('#retros .cards > .card[data-open]')[1]; c.focus(); return document.activeElement === c; })()"), true);
    await p.key('Enter');
    await soon(`${drawerOpen} && DRAWER.kind === 'retro' && DRAWER.id === ${JSON.stringify(fx.ids.retros[1])}`, 'the second retro by Enter');
    assert.deepEqual(await p.ev('window.__errors'), []);
  });

  await t.test('a due retro with no date', async () => {
    const fx = autonomyFixture();
    fx.patch.ooda.retro.due_since = null;
    await load(fx, '#retros');
    await soon("/Next retro/.test(document.querySelector('#retros .cards > .card')?.textContent ?? '')", 'the next retro');
    assert.doesNotMatch(await text('#retros .cards > .card'), /due since/);
    assert.match(await text('#retros .cards > .card'), /a feature merged/);
    assert.deepEqual(await p.ev('window.__errors'), []);
  });

  await t.test('no retros', async () => {
    const fx = autonomyFixture();
    fx.patch.ooda.retro = { due: false, all: [] };
    await load(fx, '#retros');
    await soon("/None/.test(document.querySelector('#retros')?.textContent ?? '')", 'None');
    assert.equal(await p.ev("document.querySelectorAll('#retros .card').length"), 0);
    assert.deepEqual(await p.ev('window.__errors'), []);
  });
});
