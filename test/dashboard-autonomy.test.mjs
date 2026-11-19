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
});
