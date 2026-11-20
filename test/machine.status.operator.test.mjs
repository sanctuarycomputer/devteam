// What the operator may run on a box: every read writes nothing, and it may look and nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { code, conversation, dtIn, repo } from './lib/machine-fixture.mjs';

// Every read the operator is allowed, against a repo with something in it: the log, git status and
// the files on disk are byte-for-byte what they were. That's the point of the list.
test('each read the operator may run writes nothing', () => {
  const r = repo('read-only', { settings: { upstream_base: 'v0.2.0', sensors: { web: { kind: 'http', url: 'https://app.example.test/up' } } } });
  const sup = { DEVTEAM_ROLE: 'supervisor', DEVTEAM_SUPERVISOR_UP: 'off' };
  assert.equal(dtIn(r, ['goal', 'add', '--title', 'a goal', '--outcome', 'x'], sup).status, 0);
  const goal = dtIn(r, ['goal'], sup).stdout.match(/g-\S+/)?.[0];
  assert.ok(goal);
  const k = dtIn(r, ['knowledge', 'add', '--kind', 'fact', '--statement', 's'], sup).stdout.match(/k-\S+/)?.[0];
  assert.ok(k);
  assert.equal(dtIn(r, ['ask', '--question', 'q?', '--kind', 'owner-decision', '--class', 'design', '--reasons', 'x'], sup).status, 0);
  assert.equal(dtIn(r, ['send', 'supervisor', 'hello'], sup).status, 0);
  const p = dtIn(r, ['problem', 'add', '--title', 'a problem', '--severity', '2'], sup).stdout.trim();
  assert.match(p, /^p-/);
  conversation(r);
  const op = { DEVTEAM_ROLE: 'operator', TMUX: 'x', TMUX_PANE: '%7' };
  const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.name === '.git') continue; if (e.isDirectory()) walk(p, out); else out.push(p); } return out; };
  const snap = () => ({ files: Object.fromEntries(walk(r).map((f) => [f, fs.readFileSync(f).toString('base64')])), status: execFileSync('git', ['status', '--porcelain'], { cwd: r, encoding: 'utf8' }) });
  const before = snap();
  const reads = [['search', 'goal'], ['status'], ['status', '--json'], ['ready'], ['ready', '--json'], ['metrics'], ['metrics', '--json'], ['hello', '--json'], ['settings'], ['supervisor-session'], ['prompt', 'supervisor'], ['validate'], ['questions'], ['questions', '--json', '--all'], ['log', '--json', '--tail', '5'], ['messages', '--to', 'supervisor', '--open'], ['knowledge', '--json'], ['knowledge', '--for', 'x'], ['goal', '--json'], ['goal', 'list'], ['goal', 'show', goal], ['fleet', 'status', '--json', '--no-fetch'], ['trust'], ['trust', '--json'], ['problem'], ['problem', '--json', '--all'], ['sensor', 'status'], ['sensor', 'status', '--json'], ['sensor', 'series', 'web', '--range', '7d'], ['knowledge', '--kit'], ['machine', 'pane-state', '%7'], ['peek', 'lesson', k, '--json'], ['peek', 'lesson', k, '--mermaid'], ['peek', 'problem', p, '--json'], ['peek', 'goal', goal, '--json'], ['peek', 'sensor', 'web', '--json']];
  for (const c of reads) { const x = dtIn(r, c, op); assert.equal(x.status, 0, `${c.join(' ')}: ${x.stderr}`); assert.doesNotMatch(x.stderr, /only reads/, c.join(' ')); }
  // and the machine's digest, run from inside the project, reads it the same way
  assert.equal(dtIn(r, ['machine', 'status', '--in', code], op).status, 0);
  const after = snap();
  assert.deepEqual(Object.keys(after.files).sort(), Object.keys(before.files).sort(), 'no file created or removed');
  for (const f of Object.keys(before.files)) assert.equal(after.files[f], before.files[f], `${f} unchanged`);
  assert.equal(after.status, before.status);
});

test('the kit lets a box operator look, and nothing else', () => {
  const r = repo('guarded');
  const op = { DEVTEAM_ROLE: 'operator', TMUX: 'x', TMUX_PANE: '%7' };
  for (const c of [['status'], ['fleet', 'status', '--json', '--no-fetch'], ['settings', '--get', 'main_branch'], ['supervisor-session'], ['questions', '--json'], ['log', '--json'], ['messages', '--to', 'supervisor', '--open'], ['knowledge'], ['knowledge', '--kind', 'fact'], ['goal'], ['goal', 'list']]) assert.equal(dtIn(r, c, op).status, 0, c.join(' '));
  for (const c of [['merge', 't-1'], ['fleet', 'park', '--reason', 'x'], ['fleet', 'unpark'], ['answer', 'q', 'yes'], ['send', 'supervisor', 'hi'], ['knowledge', 'add', '--kind', 'fact', '--statement', 'x'], ['knowledge', 'set', 'k-1'], ['goal', 'add', '--title', 'x'], ['goal', 'set', 'g-1'], ['goal', 'status', 'g-1', 'met'], ['goal', 'hold', 'g-1', 'park'], ['goal', 'reading', 'g-1', '--run'], ['ticket', 'show', 't-1'], ['dashboard-data'], ['ask', '--question', 'q', '--kind', 'x'], ['problem', 'add', '--title', 'x', '--severity', '1'], ['problem', 'set', 'p-1', '--status', 'resolved'], ['sensor', 'poll'], ['sensor', 'test', 'web'], ['sensor', 'ignore', 'f-1', '--reason', 'x'], ['sensor', 'discover'], ['knowledge', 'set', 'k-1', '--kit']]) { const x = dtIn(r, c, op); assert.notEqual(x.status, 0, c.join(' ')); assert.match(x.stderr, /only reads|owner commands/, c.join(' ')); }
  assert.ok(!fs.existsSync(path.join(r, 'docs/devteam/run/supervisor-pane')), 'and it is never taken for the supervisor\'s pane');
  // the one write the operator has: bringing a supervisor back (operator.md)
  const dry = dtIn(r, ['recover', '--dry-run'], op);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /left stopped/);
  const worker = dtIn(r, ['recover', '--dry-run'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'x-1' });
  assert.notEqual(worker.status, 0);
  assert.match(worker.stderr, /recover: /);
});
