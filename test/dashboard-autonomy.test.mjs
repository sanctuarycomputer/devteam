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
});
