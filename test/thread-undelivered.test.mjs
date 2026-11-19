// kit-311: an owner's thread turn that no supervisor terminal took says so (the CLI's words and the
// dashboard card's), is recorded machine-local (run/undelivered-turns.json), and, left unseen or
// unanswered, raises a high finding that reaches someone other than the stalled supervisor
// (hello's alert, which machine status prints for the box operator and the hub shows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { hasTmux, line, threadsFixture, until } from './lib/kit.mjs';

const MIN = 60000;
const NOT_DELIVERED = /^not delivered: no supervisor terminal took it, so the supervisor sees it only when it next checks; it last checked (\d+) min ago \((\d\d:\d\d) UTC\)$/;

test('an undelivered turn: the words, the last check, and the record', async (t) => {
  const F = threadsFixture('undelivered');
  t.after(() => F.done());
  const run = path.join(F.old, 'docs/devteam/run');
  const file = path.join(run, 'undelivered-turns.json');
  const claim = path.join(run, 'host-claim.json');
  const since = path.join(run, 'wait-since');
  const clear = () => { for (const f of [file, claim, since]) fs.rmSync(f, { force: true }); };
  const record = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);
  const [T, first] = F.owner(['thread', 'new', 'Narrow this to the EU launch', '--title', 'Launch checkout']).split('\n');
  clear();

  await t.test('no pane: not delivered, and when the supervisor last checked', () => {
    const at = Date.now() - 37 * MIN - 20000;
    fs.writeFileSync(claim, JSON.stringify({ checked: at }));
    const [U, said] = F.owner(['thread', 'say', T, 'hi']).split('\n');
    const m = NOT_DELIVERED.exec(said);
    assert.ok(m, `the words: ${said}`);
    assert.equal(m[1], '37', 'floored minutes since the check');
    assert.equal(m[2], hhmm(at));
    assert.doesNotMatch(said, /supervisor's pane/, 'the page reads that as delivered');
    assert.doesNotMatch(said, /^recorded and held/);
    const r = record();
    assert.deepEqual(Object.keys(r[U] ?? {}).sort(), ['at', 'thread']);
    assert.equal(r[U].thread, T);
    assert.ok(Math.abs(Date.parse(r[U].at) - Date.now()) < MIN, 'when it was written');
    clear();
  });

  await t.test('the first turn of a new thread was recorded too, before any record existed', () => {
    assert.match(first, /^not delivered: .*; it has not checked yet$/);
  });

  await t.test('the last check: none, wait-since, and a refused host claim', () => {
    assert.match(F.owner(['thread', 'say', T, 'one']).split('\n')[1], /^not delivered: .*; it has not checked yet$/);
    fs.writeFileSync(since, `${Date.now() - 12 * MIN - 5000}\n`);
    assert.match(F.owner(['thread', 'say', T, 'two']).split('\n')[1], /it last checked 12 min ago/);
    fs.rmSync(since);
    // another machine holds the repo: its claim's times are no check by this supervisor
    fs.writeFileSync(claim, JSON.stringify({ refused: true, checked: Date.now() - 3 * MIN, at: new Date(Date.now() - 4 * MIN).toISOString() }));
    assert.match(F.owner(['thread', 'say', T, 'three']).split('\n')[1], /; it has not checked yet$/);
    // the newest of the three wins
    fs.writeFileSync(claim, JSON.stringify({ checked: Date.now() - 30 * MIN, at: new Date(Date.now() - 20 * MIN - 5000).toISOString() }));
    fs.writeFileSync(since, `${Date.now() - 50 * MIN}\n`);
    assert.match(F.owner(['thread', 'say', T, 'four']).split('\n')[1], /it last checked 20 min ago/);
    clear();
  });

  await t.test('reopen with words says the same, and records it', () => {
    F.owner(['thread', 'resolve', T, '--outcome', 'done for now']);
    const out = F.owner(['thread', 'reopen', T, '--', 'one more thing']).split('\n');
    assert.equal(out[0], `reopened ${T}`);
    assert.match(out[1], /^not delivered: /);
    assert.equal(Object.values(record()).filter((x) => x.thread === T).length, 1);
    clear();
  });

  await t.test('old entries go, and a file that is not a map is replaced', () => {
    fs.writeFileSync(file, JSON.stringify({ 'u-20200101-000000000-owner': { thread: T, at: new Date(Date.now() - 8 * 86400000).toISOString() }, 'u-20200102-000000000-owner': { thread: T, at: new Date(Date.now() - 6 * 86400000).toISOString() } }));
    const [U] = F.owner(['thread', 'say', T, 'five']).split('\n');
    assert.deepEqual(Object.keys(record()).sort(), ['u-20200102-000000000-owner', U].sort(), 'over 7 days dropped, under kept');
    for (const junk of ['not json', '[]', '"x"']) {
      fs.writeFileSync(file, junk);
      const [V] = F.owner(['thread', 'say', T, 'six']).split('\n');
      assert.deepEqual(Object.keys(record()), [V], `replaced: ${junk}`);
    }
    clear();
  });

  await t.test('the record is written under a lock', async () => {
    const lock = `${file}.lock`;
    fs.mkdirSync(lock);
    const p = spawn(process.execPath, [path.join(F.old, 'docs/devteam/scripts/devteam.mjs'), 'thread', 'say', T, 'held by the lock'], { cwd: F.old, env: F.env(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    const exited = new Promise((r) => p.on('exit', r));
    const logged = () => fs.readdirSync(F.logDir).some((f) => fs.readFileSync(path.join(F.logDir, f), 'utf8').includes('held by the lock'));
    await until(logged, 'the turn line, written before the lock is taken');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(fs.existsSync(file), false, 'nothing written while the lock is held');
    fs.rmSync(lock, { recursive: true });
    assert.equal(await exited, 0);
    const [U] = out.split('\n');
    assert.ok(record()[U], 'written once the lock is free');
    clear();
  });
});

test('an undelivered turn left unseen or unanswered: a high finding, and an alert for the hub and the operator', async (t) => {
  const F = threadsFixture('undelivered-finding');
  t.after(() => F.done());
  const run = path.join(F.old, 'docs/devteam/run');
  const file = path.join(run, 'undelivered-turns.json');
  const since = path.join(run, 'wait-since');
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  // a thread with the owner's turn agoMs back, recorded as no terminal took it (missed) or not
  const scene = (agoMs, { missed = true } = {}) => {
    const T = F.hand('owner', { type: 'thread', title: 'Checkout copy' }, agoMs + 1000);
    const U = F.hand('owner', { type: 'turn', thread: T, text: 'Shorter, please' }, agoMs);
    if (missed) fs.writeFileSync(file, JSON.stringify({ [U]: { thread: T, at: ago(agoMs) } }));
    return { T, U };
  };
  const findings = () => JSON.parse(F.sup(['metrics', '--json'])).findings.filter((f) => f.kind === 'thread-undelivered');
  const alert = () => JSON.parse(F.owner(['hello', '--json'])).alert ?? '';
  // each case on the log and run files as they were
  const fresh = (fn) => () => { const snap = F.snapLog(); try { fn(); } finally { F.restoreLog(snap); for (const f of [file, since]) fs.rmSync(f, { force: true }); } };

  await t.test('unseen over 5 minutes: high, named, with the minutes and the last check', fresh(() => {
    const { T } = scene(6 * MIN + 20000);
    const f = findings();
    assert.equal(f.length, 1, JSON.stringify(f));
    assert.deepEqual([f[0].severity, f[0].subject], ['high', T]);
    assert.match(f[0].detail, /^the owner wrote 6 min ago and no supervisor terminal took it; the supervisor has no record of checking$/);
    assert.match(f[0].suggestion, new RegExp(`resume it .*thread show ${T}`));
    assert.match(alert(), new RegExp(`^A message in a thread reached no supervisor and has waited 6 min \\(thread ${T}\\); the supervisor has no record of checking: resume it`));
  }));

  await t.test('not yet: under 5 minutes', fresh(() => {
    scene(2 * MIN);
    assert.deepEqual(findings(), []);
    assert.doesNotMatch(alert(), /reached no supervisor/);
  }));

  await t.test('seen: a check after the turn holds it off until 15 minutes', fresh(() => {
    scene(6 * MIN + 20000);
    fs.writeFileSync(since, `${Date.now() - 3 * MIN}\n`);
    assert.deepEqual(findings(), [], 'checked since: the supervisor has it');
    assert.doesNotMatch(alert(), /reached no supervisor/);
  }));

  await t.test('unanswered over 15 minutes, whatever the checks', fresh(() => {
    const { T } = scene(16 * MIN + 20000);
    fs.writeFileSync(since, `${Date.now() - 10 * MIN - 20000}\n`);
    const f = findings();
    assert.deepEqual(f.map((x) => [x.severity, x.subject]), [['high', T]]);
    assert.match(f[0].detail, /^the owner wrote 16 min ago and no supervisor terminal took it; the supervisor last checked 10 min ago$/);
    assert.match(alert(), /has waited 16 min .*; the supervisor last checked 10 min ago: resume it/);
  }));

  await t.test('answered, or a later turn delivered: none', fresh(() => {
    const a = scene(6 * MIN + 20000);
    F.hand('supervisor', { type: 'turn', thread: a.T, text: 'On it.' }, 60000);
    assert.deepEqual(findings(), [], 'the supervisor replied');
    const b = scene(7 * MIN + 20000);
    F.hand('owner', { type: 'turn', thread: b.T, text: 'And this, typed' }, 6 * MIN);
    assert.deepEqual(findings(), [], 'a later turn reached the supervisor');
    assert.doesNotMatch(alert(), /reached no supervisor/);
  }));

  await t.test('several unseen turns: counted from the first; more threads named by count', fresh(() => {
    const a = scene(9 * MIN + 20000);
    const U2 = F.hand('owner', { type: 'turn', thread: a.T, text: 'Still there?' }, 2 * MIN);
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    m[U2] = { thread: a.T, at: ago(2 * MIN) };
    const T2 = F.hand('owner', { type: 'thread', title: 'Second' }, 8 * MIN);
    const U3 = F.hand('owner', { type: 'turn', thread: T2, text: 'Another' }, 7 * MIN);
    m[U3] = { thread: T2, at: ago(7 * MIN) };
    fs.writeFileSync(file, JSON.stringify(m));
    const f = findings();
    assert.deepEqual(f.map((x) => x.subject).sort(), [a.T, T2].sort());
    assert.match(f.find((x) => x.subject === a.T).detail, /^the owner wrote 9 min ago/);
    assert.match(alert(), new RegExp(`has waited 9 min \\(thread ${a.T}, and 1 more\\)`));
  }));

  await t.test('a file that is not a map is none, and breaks nothing', fresh(() => {
    scene(6 * MIN + 20000, { missed: false });
    for (const junk of ['not json', '[]']) {
      fs.writeFileSync(file, junk);
      assert.deepEqual(findings(), [], junk);
      assert.doesNotMatch(alert(), /reached no supervisor/);
    }
  }));

  await t.test('delivered: typed into the pane, recorded nowhere, and never a finding', { skip: hasTmux ? false : 'no tmux' }, fresh(() => {
    const pane = F.standIn();
    const T = F.hand('owner', { type: 'thread', title: 'Typed' }, 60000);
    const [U, said] = F.owner(['thread', 'say', T, 'this one is typed'], { DEVTEAM_SUPERVISOR: pane.target }).split('\n');
    assert.equal(said, "sent to the supervisor's pane");
    assert.ok(!fs.existsSync(file) || !JSON.parse(fs.readFileSync(file, 'utf8'))[U], 'no record');
    // and the same, as if 6 and 16 minutes on: never raised
    scene(6 * MIN + 20000, { missed: false });
    scene(16 * MIN + 20000, { missed: false });
    assert.deepEqual(findings(), []);
    assert.doesNotMatch(alert(), /reached no supervisor/);
  }));
});

test('machine status prints the alert for the box operator', { skip: hasTmux ? false : 'no tmux' }, async () => {
  const { dtIn, home, machine, repo } = await import('./lib/machine-fixture.mjs');
  fs.rmSync(path.join(home, '.box/alert'), { force: true });
  const r = repo('undelivered');
  const d = new Date(Date.now() - 6 * MIN - 20000);
  const stamp = (x) => `${x.toISOString().slice(0, 10).replace(/-/g, '')}-${x.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
  const T = `t-${stamp(new Date(d - 1000))}-owner`;
  const U = `u-${stamp(d)}-owner`;
  const logDir = path.join(r, 'docs/devteam/run/log');
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(path.join(logDir, `owner-${d.toISOString().slice(0, 7)}.jsonl`),
    `${line({ op: 'new', channel: 'cli', type: 'thread', id: T, at: new Date(d - 1000).toISOString(), by: 'owner', title: 'Checkout' })}${line({ op: 'new', channel: 'cli', type: 'turn', id: U, at: d.toISOString(), by: 'owner', thread: T, text: 'hello' })}`);
  fs.writeFileSync(path.join(r, 'docs/devteam/run/undelivered-turns.json'), JSON.stringify({ [U]: { thread: T, at: d.toISOString() } }));
  const lc = dtIn(r, ['log-check']);
  assert.equal(lc.status, 0, lc.stderr + lc.stdout);
  const st = machine(['machine', 'status']);
  assert.match(st.stdout, new RegExp(`^attention: undelivered: A message in a thread reached no supervisor and has waited 6 min \\(thread ${T}\\)`, 'm'), st.stdout + st.stderr);
});
