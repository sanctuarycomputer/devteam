// An answer the kit refuses stays on its card until the owner dismisses it, and a question whose
// linked page changed says so first and can't be answered. Real headless Chrome over a real
// dashboard; only the page's fetch is stubbed: /api/answer refuses, and /api/data marks Q2's link moved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PORTS, bareProject, dashboardOnFreePort } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const REASON = 'the mock <b>moved</b>';
const MOVED_TITLE = 'The moving mock';

// The page's fetch, in two layers: the stub inside (the refusal, the moved link), the recorder outside
// it, so every post the page makes is recorded whether or not the stub answers it.
const initScript = (moved) => `(() => {
  const si = window.setInterval;
  window.setInterval = (f, ms, ...a) => si(f, ms === 10000 ? 300 : ms, ...a);
  window.__polls = 0;
  window.__posts = [];
  window.__moved = ${JSON.stringify(moved)};
  window.__rewrite = (d) => ({ ...d, questions: (d.questions || []).map((q) => q.id !== window.__moved ? q : { ...q,
    links_moved: q.id + ' links the artifact moving, which changed since it was asked; ask again about the page as it is now',
    links: [{ name: 'moving', artifact: 'moving', title: ${JSON.stringify(MOVED_TITLE)}, sha256: 'a'.repeat(64), at: 'main', href: '#artifact/main/moving', changed: true }] }) });
  const real = window.fetch;
  const stub = async (u, o) => {
    if (String(u).startsWith('/api/answer') && o?.method === 'POST') return new Response(JSON.stringify({ error: ${JSON.stringify(REASON)} }), { status: 409, headers: { 'content-type': 'application/json' } });
    const r = await real(u, o);
    if (String(u).startsWith('/api/data') && window.__rewrite && r.ok) return new Response(JSON.stringify(window.__rewrite(await r.json())), { status: r.status, statusText: r.statusText, headers: r.headers });
    return r;
  };
  window.fetch = async (u, o) => {
    if (String(u).startsWith('/api/data')) window.__polls++;
    if (o?.method === 'POST' && String(u).startsWith('/api/')) window.__posts.push({ url: String(u), body: o.body });
    return stub(u, o);
  };
})();`;

// A wait on a condition in the page (this file's own copy of dashboard.test.mjs's soonIn).
const soonIn = (p, ms = 15000, server = null) => async (expr, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v, err = null;
    try { v = await p.ev(expr); } catch (e) { err = e; }
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out: ${what}${err ? `; last: ${err.message}` : ''}${server ? `; the server said, last: ${JSON.stringify(String(server()).slice(-600))}` : ''}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

test('answers: a refusal stays on its card, and a moved link disables Answer', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-answers-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { ...process.env, DEVTEAM_HUB_PORT: String(PORTS + 58), DEVTEAM_PORT_BASE: String(PORTS + 59), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'TMUX', 'TMUX_PANE']) delete env[k];
  const root = bareProject(base, 'answers');
  const dt = (args, role = {}) => { const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: root, env: { ...env, ...role }, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const Q1 = dt(['ask', '--question', 'Ship it?', '--choices', '[{"label":"Yes"},{"label":"No"}]'], SUP);
  const Q2 = dt(['ask', '--question', 'Which colour?', '--choices', '[{"label":"Red"},{"label":"Blue"}]'], SUP);
  const { dash, port } = await dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: initScript(Q2) });
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#questions` });
  const soon = soonIn(p, 15000, () => dash.out());
  const polls = async (n = 2) => { const at = await p.ev('window.__polls'); await soon(`window.__polls >= ${at + n}`, `${n} polls`); };
  const card = (q) => `document.querySelector('#questions [data-qcard="${q}"]')`;
  const refusedLine = (q) => `${card(q)}?.querySelector('[data-refused]')?.textContent ?? ''`;
  const answerPosts = (q) => p.ev(`window.__posts.filter((x) => x.url === '/api/answer' && JSON.parse(x.body).id === ${JSON.stringify(q)}).length`);
  await soon(`!!${card(Q1)} && !!${card(Q2)}`, 'the question cards');

  await t.test('refused: the reason stays on the card across redraws, with the pick and the note, until dismissed', async () => {
    await p.click(`#questions [data-qcard="${Q1}"] input[data-pick][value="No"]`);
    await p.click(`#questions [data-qcard="${Q1}"] textarea[data-q]`);
    await soon(`document.activeElement === ${card(Q1)}?.querySelector('textarea[data-q]')`, 'the note focused');
    await p.type('not this week');
    await soon(`${card(Q1)}?.querySelector('textarea[data-q]')?.value === 'not this week'`, 'the note typed');
    await p.click(`#questions [data-qcard="${Q1}"] [data-answer]`);
    await soon(`window.__posts.some((x) => x.url === '/api/answer' && JSON.parse(x.body).id === ${JSON.stringify(Q1)})`, 'the answer posted (and recorded)');
    const re = /^Not saved: the mock <b>moved<\/b>/;
    assert.match(await soon(refusedLine(Q1), 'the refusal, on the card'), re);
    for (let i = 0; i < 3; i++) await p.ev('redrawNow(); void 0');
    assert.match(await p.ev(refusedLine(Q1)), re, 'still there after three forced redraws');
    // three ordinary polls, with nothing holding the draw: the card is rebuilt each time
    await p.ev(`document.activeElement?.blur(); ${card(Q1)}.__old = 1; void 0`);
    await polls(3);
    await soon(`!${card(Q1)}?.__old`, 'a poll rebuilt the card');
    assert.match(await p.ev(refusedLine(Q1)), re, 'still there after three polls');
    assert.equal(await p.ev(`${card(Q1)}.querySelector('input[data-pick][value="No"]').checked`), true, 'the pick still chosen');
    assert.equal(await p.ev(`${card(Q1)}.querySelector('textarea[data-q]').value`), 'not this week', 'the note still in its box');
    await p.click(`#questions [data-qcard="${Q1}"] [data-dismiss-refused]`);
    await soon(`document.querySelectorAll('[data-qcard="${Q1}"] [data-refused]').length === 0`, 'dismissed, on every copy');
    await polls(2);
    assert.equal(await p.ev(`document.querySelectorAll('[data-qcard="${Q1}"] [data-refused]').length`), 0, 'still gone after redraws');
    assert.equal(await p.ev(`${card(Q1)}.querySelector('textarea[data-q]').value`), 'not this week', 'the note kept after dismissing');
  });

  await t.test('a moved link: the card says so first, Answer is disabled, and the note still takes text', async () => {
    const line = `${card(Q2)}.querySelector('.card-head').nextElementSibling`;
    await soon(`${line}?.hasAttribute('data-links-moved')`, 'the moved line, straight after the card head');
    assert.equal(await p.ev(`${line}.textContent.trim()`), `${MOVED_TITLE} changed since this was asked; the supervisor will ask again`);
    assert.equal(await p.ev(`${card(Q2)}.querySelector('[data-answer]').disabled`), true, 'Answer disabled');
    assert.equal(await p.ev(`${card(Q1)}.querySelector('[data-answer]').disabled`), false, 'the other card\'s Answer is live');
    await p.click(`#questions [data-qcard="${Q2}"] textarea[data-q]`);
    await soon(`document.activeElement === ${card(Q2)}?.querySelector('textarea[data-q]')`, 'the note focused');
    await p.type('later');
    await soon(`${card(Q2)}?.querySelector('textarea[data-q]')?.value === 'later'`, 'the note takes text');
    // Shift+Enter presses the card's Answer (kit-207); disabled, it posts nothing
    assert.equal(await answerPosts(Q2), 0);
    await p.key('Enter', 8);
    await polls(1);
    assert.equal(await answerPosts(Q2), 0, 'nothing posted for the moved question');
    assert.equal(await p.ev(`${card(Q2)}.querySelector('textarea[data-q]').value`), 'later', 'no newline added, the words kept');
  });
});
