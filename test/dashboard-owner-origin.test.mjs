// Every dashboard owner action (POST /api/<action>, the ACTIONS table) is taken only from the owner's
// browser on the dashboard's own page: Sec-Fetch-Site same-origin, or an Origin that is the
// dashboard's own, and neither header saying anything else. A bare local client (curl, an agent's
// fetch: no browser headers) and another site's page are refused with 403 and a reason, and nothing
// reaches the log. The same request with the page's own headers is taken, and a real browser on the
// page still answers a question (kit-324; kit-102 final-1 F2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PORTS, bareProject, dashboardOnFreePort, until } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };

// A fixture project with a question, a goal and a thread to act on, and its dashboard. Its teardown
// (later, lib/chrome.mjs's cleanup) runs last-registered first, each step on its own: the dashboard
// (and a test's Chrome) stop before the folder goes, and a removal that throws skips no stop.
async function fixture(t, name, offset) {
  const later = cleanup(t);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `devteam-${name}-`));
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { ...process.env, DEVTEAM_HUB_PORT: String(PORTS + offset), DEVTEAM_PORT_BASE: String(PORTS + offset + 1), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of Object.keys(env)) if (/^DEVTEAM_(ROLE|TICKET|FEATURE|RUN|SUPERVISOR|HOME)$/.test(k) || k === 'TMUX' || k === 'TMUX_PANE') delete env[k];
  const root = bareProject(base, name);
  const dt = (args, role = {}) => { const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: root, env: { ...env, ...role }, encoding: 'utf8' }); assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
  const first = (s) => s.split('\n')[0].trim();
  const Q = first(dt(['ask', '--question', 'Ship it?', '--choices', '[{"label":"Yes"},{"label":"No"}]'], SUP));
  const Q2 = first(dt(['ask', '--question', 'And the docs?', '--choices', '[{"label":"Yes"},{"label":"No"}]'], SUP));
  const G = first(dt(['goal', 'add', '--title', 'Alpha', '--priority', '1'], SUP));
  const T = (dt(['thread', 'new', '--title', 'A thread', '--', 'first words']).match(/\bt-\d{8}-\d{9}-[a-z0-9-]+/) ?? [])[0];
  assert.ok(T, 'a thread to act on');
  const { dash, port } = await dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const B = `http://127.0.0.1:${port}`;
  // every log line, from both log folders
  const logDirs = [path.join(root, 'docs/devteam/run/log'), path.join(root, 'docs/devteam/project/log')];
  const logFiles = () => logDirs.flatMap((d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(d, f)) : []));
  const logHash = () => crypto.createHash('sha256').update(logFiles().sort().map((f) => `${f}\0${fs.readFileSync(f, 'utf8')}`).join('\0')).digest('hex');
  const lines = () => logFiles().flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  return { root, dt, dash, port, B, Q, Q2, G, T, logHash, lines, later };
}

// The action names, read from the dashboard's own source (dashboardActions' ACTIONS table), so an
// action added later is covered here without anyone remembering to.
function actionNames(root) {
  const src = fs.readFileSync(path.join(root, 'docs/devteam/scripts/devteam.mjs'), 'utf8');
  const start = src.indexOf('  const ACTIONS = {\n', src.indexOf('function dashboardActions()'));
  const end = src.indexOf('\n  };\n', start);
  assert.ok(start > 0 && end > start, 'the ACTIONS table in devteam.mjs');
  return [...src.slice(start, end).matchAll(/^ {4}'?([a-z][a-z-]*)'?: \(b\) =>/gm)].map((m) => m[1]);
}

// A body each action would take and act on: refused, nothing may come of it.
const bodies = (F) => ({
  answer: { id: F.Q, answer: 'Yes' },
  correct: { id: F.Q, reason: 'a bare client says so' },
  'goal-hold': { id: F.G, mode: 'park' },
  fleet: { op: 'drain', reason: 'a bare client says so' },
  'goal-met': { id: F.G },
  'goal-order': { ids: [F.G] },
  'goal-decide': { id: F.G, verdict: 'approve' },
  knowledge: { id: F.Q, status: 'retired' },
  ack: { kind: 'unanswered-message', subject: 'm-x', reason: 'a bare client says so' },
  'artifact-publish': { op: 'unpublish', slug: 'some-mock' },
  'preview-stop': { name: 'some-preview' },
  'preview-start': { name: 'some-preview' },
  'thread-new': { title: 'Forged', text: 'from a bare client' },
  'thread-say': { id: F.T, text: 'from a bare client' },
  'thread-resolve': { id: F.T, outcome: 'forged' },
  'thread-reopen': { id: F.T },
  'thread-accept': { id: F.T, at: new Date().toISOString() },
});

const post = (B, name, body, headers) => fetch(`${B}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });

test('kit-324: an owner action without the page\'s own browser signal is refused, and nothing is logged', { timeout: 300000 }, async (t) => {
  const F = await fixture(t, 'owner-origin', 0);
  const names = actionNames(F.root);
  const body = bodies(F);
  assert.deepEqual(names.filter((n) => !Object.hasOwn(body, n)), [], 'a body for every owner action');
  assert.ok(names.length >= 17, `the ACTIONS table read whole (${names.join(', ')})`);
  const own = F.B;
  const other = `http://127.0.0.1:${F.port + 1}`;
  // what a client that isn't the owner's browser on this page sends
  const refused = {
    'a bare local client': {},
    'a cross-site page': { 'sec-fetch-site': 'cross-site', origin: 'http://evil.example' },
    'a same-site page on another port': { 'sec-fetch-site': 'same-site', origin: other },
    'a sandboxed frame': { 'sec-fetch-site': 'cross-site', origin: 'null' },
    'a cross-site Origin alone': { origin: 'http://evil.example' },
    'a cross-site Sec-Fetch-Site alone': { 'sec-fetch-site': 'cross-site' },
    'a Sec-Fetch-Site of none (typed in the address bar)': { 'sec-fetch-site': 'none' },
    'its own Origin, but another site says Sec-Fetch-Site': { 'sec-fetch-site': 'cross-site', origin: own },
    'same-origin said, but another Origin': { 'sec-fetch-site': 'same-origin', origin: 'http://evil.example' },
    // an empty value is not this page (main read it as absent)
    'same-origin beside an empty Origin': { 'sec-fetch-site': 'same-origin', origin: '' },
  };
  // The routes that need both headers act as the owner too: refused the same way, with the same
  // reason (their own checks, a token, a nonce, a signature, come after; the guard reads no body).
  const STRICT = ['pane-answer', 'owner-setting', 'secret', 'review-draft', 'review-answer'];
  const before = F.logHash();
  for (const [who, headers] of Object.entries(refused)) {
    for (const name of [...names, ...STRICT]) {
      const r = await post(F.B, name, body[name] ?? {}, headers);
      const text = await r.text();
      assert.equal(r.status, 403, `${name} from ${who}: ${text}`);
      assert.match(JSON.parse(text).error, /owner actions only from this dashboard's own page/, `${name} from ${who}: the reason`);
    }
  }
  assert.equal(F.logHash(), before, 'nothing reached the log');
  assert.equal(JSON.parse(F.dt(['questions', '--id', F.Q, '--json']))[0].status, 'open', 'the question is still open');

  // the page's own headers pass the guard: each action reaches its own checks (an empty body is a
  // 400 from the action, not the guard's 403), with both headers, or either one alone
  const accepted = {
    'both headers': { 'sec-fetch-site': 'same-origin', origin: own },
    'Sec-Fetch-Site same-origin alone': { 'sec-fetch-site': 'same-origin' },
    'its own Origin alone': { origin: own },
  };
  for (const [how, headers] of Object.entries(accepted)) {
    for (const name of names) {
      const r = await post(F.B, name, {}, headers);
      const text = await r.text();
      assert.equal(r.status, 400, `${name} with ${how}: past the guard to the action's own check: ${text}`);
    }
  }
  assert.equal(F.logHash(), before, 'empty bodies wrote nothing');

  // and acts, as the owner on the dashboard's channel
  const owned = (pred) => F.lines().filter((l) => l.by === 'owner' && l.channel === 'dashboard' && pred(l));
  let r = await post(F.B, 'answer', body.answer, accepted['both headers']);
  assert.equal(r.status, 200, await r.text());
  assert.equal(JSON.parse(F.dt(['questions', '--id', F.Q, '--json']))[0].status, 'answered');
  assert.equal(owned((l) => l.id === F.Q).length, 1, 'one owner line for the answer');
  r = await post(F.B, 'answer', { id: F.Q2, answer: 'No' }, accepted['its own Origin alone']);
  assert.equal(r.status, 200, await r.text());
  assert.equal(JSON.parse(F.dt(['questions', '--id', F.Q2, '--json']))[0].status, 'answered');
  r = await post(F.B, 'thread-say', body['thread-say'], accepted['Sec-Fetch-Site same-origin alone']);
  assert.equal(r.status, 200, await r.text());
  assert.ok(owned((l) => l.type === 'turn' && l.thread === F.T && /bare client/.test(l.text ?? '')).length >= 1, 'the owner\'s turn on the thread');
});

test('kit-324: the owner\'s page in a real browser still answers', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 }, async (t) => {
  const F = await fixture(t, 'owner-origin-browser', 30);
  const { later } = F;
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Page.navigate', { url: `${F.B}/#questions` });
  await until(async () => { try { return await p.ev('document.readyState === "complete" && location.origin') === F.B; } catch { return false; } }, 'the dashboard page');
  // the page's own fetch, unstubbed: Chrome sends what it sends for this page
  const status = await p.ev(`fetch('/api/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify({ id: F.Q, answer: 'Yes' }))} }).then((r) => r.status)`);
  assert.equal(status, 200, F.dash.out().slice(-600));
  assert.equal(JSON.parse(F.dt(['questions', '--id', F.Q, '--json']))[0].status, 'answered');
});
