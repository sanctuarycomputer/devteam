// While a pane asks, messages for it are held, then typed in order, once; what the card cannot answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { hasTmux, threadsFixture, until } from './lib/kit.mjs';
import { cleanup, heldDirOf, heldFor, logLines, menuPane, nap } from './lib/pane-question-fixture.mjs';

const tick = (F, S) => { const r = F.run(F.old, ['accounts-tick'], { ...S, ...F.SUP }); assert.equal(r.status, 0, r.err); };
// a held line's file, as if it had been held that long ago
const age = (F, pane, ms, i = 0) => { const n = heldFor(F, pane)[i]; const older = `${String(Date.now() - ms).padStart(15, '0')}${n.slice(15)}`; fs.renameSync(path.join(heldDirOf(F, pane), n), path.join(heldDirOf(F, pane), older)); };

test("a message for a pane that is asking is held, not typed; no command answers the question; answered at the terminal, the held lines are typed in order, once", { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const F = threadsFixture('pane-held');
  const later = cleanup(t);
  later(() => F.done());
  const pane = menuPane(F);
  const S = { DEVTEAM_SUPERVISOR: pane.target };
  const { ask, problem } = JSON.parse(F.owner(['pane', 'question', '--json'], S));
  assert.equal(problem, null);
  assert.equal(ask.question.split('\n')[2], "Claude wants to read someone else's artifact at");
  assert.deepEqual([ask.kind, ask.options.map((o) => o.label), ask.selected], ['menu', ['Yes', 'No'], 1]);
  const hello = JSON.parse(F.owner(['hello', '--json', '--no-kit', '--pane'], S));
  assert.equal(hello.supervisor_question.digest, ask.digest);
  assert.match(hello.pulse.attention[0], /terminal is asking you a question: answer it on the dashboard/);
  assert.equal(JSON.parse(F.owner(['hello', '--json', '--no-kit'], S)).supervisor_question, undefined, 'only when asked: tmux is not read for a plain hello');
  // the owner's words in a thread, and a message: logged, held, and nothing typed into the menu
  assert.match(F.owner(['thread', 'new', 'Approved here'], S), /recorded and held: the supervisor's terminal is asking a question[^]*The owner answers it on the dashboard[^]*never the answer to it/);
  const sent = F.run(F.old, ['send', 'supervisor', 'second line', '--owner'], S);
  assert.equal(sent.status, 0, sent.err);
  assert.match(sent.err, /recorded and held: the supervisor's terminal is asking a question/);
  assert.equal(pane.typed(), '', 'not a byte reached the menu');
  assert.equal(heldFor(F, pane).length, 2);
  // no command answers it: not the owner's, not an agent's with its role set, not one with its role taken off
  const DT = path.join(F.old, 'docs/devteam/scripts/devteam.mjs');
  const bare = F.env(S);
  for (const k of Object.keys(bare)) if (/^(DEVTEAM_(ROLE|TICKET|FEATURE|CHANNEL)|TMUX|TMUX_PANE)$/.test(k)) delete bare[k];
  for (const [who, env] of [['the owner', F.env(S)], ['an agent', F.env({ ...S, DEVTEAM_ROLE: 'worker' })], ['an agent with its role taken off', bare]]) {
    const r = spawnSync(process.execPath, [DT, 'pane', 'answer', '--digest', ask.digest, '--option', '1', '--owner'], { cwd: F.old, env, encoding: 'utf8' });
    assert.notEqual(r.status, 0, who);
    assert.match(r.stderr, /no command answers what the supervisor's terminal asks/, who);
    const rec = spawnSync(process.execPath, [DT, 'pane', 'answered', '--owner'], { cwd: F.old, env, encoding: 'utf8', input: '' });
    assert.notEqual(rec.status, 0, who);
    // even with what the dashboard would hand it, that command sends no key: the terminal is as it was
    spawnSync(process.execPath, [DT, 'pane', 'answered', '--owner'], { cwd: F.old, env, encoding: 'utf8', input: JSON.stringify({ digest: ask.digest, option: 1, label: 'Yes', first: 'Artifact', keys: '1', taken: false, why: 'a test' }) });
  }
  assert.equal(pane.typed(), '', 'no key from any of them');
  assert.equal(JSON.parse(F.owner(['pane', 'question', '--json'], S)).ask.digest, ask.digest, 'the question is as it was');
  assert.equal(heldFor(F, pane).length, 2, 'and nothing held was typed');
  // a look with the question still up types nothing
  tick(F, S);
  assert.equal(pane.typed(), '');
  // answered at the terminal: the next look types the held lines
  pane.press('1');
  await until(() => /answered 1/.test(pane.shows()), 'the answer');
  tick(F, S);
  await until(() => /second line\r/.test(pane.typed()), 'the held lines');
  assert.match(pane.typed(), /^1\[devteam thread t-\S+ from owner\] Approved here — devteam\.mjs thread show t-\S+\r\[devteam info m-\S+ from owner\] second line\r$/, 'the digit, then each held line, in order, once, with its Enter');
  assert.equal(heldFor(F, pane).length, 0);
  // nothing asked now: a message is typed at once
  assert.match(F.owner(['thread', 'new', 'And now'], S), /sent to the supervisor's pane/);
  await until(() => /And now[^\r]*\r/.test(pane.typed()), 'a line typed with no question up');
  // an agent may not write the owner's act
  const forged = F.checkWith(['supervisor', { type: 'act', id: 'a-20990101-000000000-supervisor', class: 'pane-answer', what: 'answered it myself' }]);
  assert.match(forged.said, /pane-answer is the owner's/);
});

test('held lines are typed once each, in the order they came, however many processes look at once', { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const F = threadsFixture('pane-race');
  const later = cleanup(t);
  later(() => F.done());
  const pane = menuPane(F);
  const S = { DEVTEAM_SUPERVISOR: pane.target };
  for (let i = 0; i < 6; i++) assert.equal(F.run(F.old, ['send', 'supervisor', `held ${i}`, '--owner'], S).status, 0);
  assert.equal(heldFor(F, pane).length, 6);
  pane.press('2');
  await until(() => /answered 2/.test(pane.shows()), 'the answer');
  const DT = path.join(F.old, 'docs/devteam/scripts/devteam.mjs');
  const go = (args, role) => new Promise((resolve) => execFile(process.execPath, [DT, ...args], { cwd: F.old, env: F.env({ ...S, ...role }) }, (err, so, se) => resolve({ err, se })));
  const rs = await Promise.all([...Array.from({ length: 4 }, () => go(['accounts-tick'], F.SUP)), ...Array.from({ length: 4 }, (_, i) => go(['send', 'supervisor', `late ${i}`, '--owner'], {}))]);
  for (const r of rs) assert.equal(r.err, null, r.se);
  // whatever a race left held goes with the next look
  const all = ['held 0', 'held 1', 'held 2', 'held 3', 'held 4', 'held 5', 'late 0', 'late 1', 'late 2', 'late 3'];
  await until(() => { if (heldFor(F, pane).length) tick(F, S); return !heldFor(F, pane).length && all.every((x) => pane.typed().includes(`${x}\r`)); }, 'every line typed');
  const lines = pane.typed().slice(1).split('\r').filter(Boolean).map((l) => l.replace(/^\[devteam info \S+ from owner\] /, ''));
  assert.deepEqual([...lines].sort(), all, 'each line once, none lost');
  assert.deepEqual(lines.slice(0, 6), all.slice(0, 6), 'what was held first is typed first, in order');
  assert.deepEqual(fs.readdirSync(path.join(F.old, 'docs/devteam/run/held')).filter((n) => n.includes('.claim-')), [], 'no claim left behind');
});

test('a line sent while a flusher holds the claim goes after the held lines', { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const F = threadsFixture('pane-putback');
  const later = cleanup(t);
  later(() => F.done());
  const pane = menuPane(F);
  const S = { DEVTEAM_SUPERVISOR: pane.target };
  for (let i = 0; i < 3; i++) assert.equal(F.run(F.old, ['send', 'supervisor', `held ${i}`, '--owner'], S).status, 0);
  assert.equal(heldFor(F, pane).length, 3);
  pane.press('2');
  await until(() => /answered 2/.test(pane.shows()), 'the answer');
  // a flusher at work: its claim, under a live pid, touched just now
  const live = spawn('sleep', ['600']);
  later(() => live.kill());
  const k = encodeURIComponent(pane.key);
  const held = heldDirOf(F, pane);
  const claimed = `${held}.claim-${live.pid}-${Date.now()}`;
  fs.renameSync(held, claimed);
  // a late sender, held open between its read of the held folder and its read of the claims
  const DT = path.join(F.old, 'docs/devteam/scripts/devteam.mjs');
  let exited = false;
  const sender = new Promise((resolve) => execFile(process.execPath, [DT, 'send', 'supervisor', 'late', '--owner'], { cwd: F.old, env: F.env({ ...S, DEVTEAM_HELD_CHECK_DELAY_MS: '2000' }) }, (err, so, se) => { exited = true; resolve({ err, se }); }));
  const locks = path.join(F.old, 'docs/devteam/run/held-locks');
  await until(() => exited || fs.existsSync(path.join(locks, `${k}.checking`)), 'the sender inside its check, or gone');
  // the flusher stops and puts its claim back, under the window's lock, as the kit does
  fs.mkdirSync(locks, { recursive: true });
  const lock = path.join(locks, `${k}.lock`);
  await until(() => { try { fs.mkdirSync(lock); return true; } catch (e) { if (e.code !== 'EEXIST') throw e; return false; } }, "the window's lock");
  fs.mkdirSync(held, { recursive: true });
  for (const n of fs.readdirSync(claimed).filter((x) => x.endsWith('.json'))) fs.renameSync(path.join(claimed, n), path.join(held, n));
  fs.rmSync(claimed, { recursive: true, force: true });
  fs.rmSync(lock, { recursive: true, force: true });
  const r = await sender;
  assert.equal(r.err, null, r.se);
  const all = ['held 0', 'held 1', 'held 2', 'late'];
  await until(() => { if (heldFor(F, pane).length) tick(F, S); return !heldFor(F, pane).length && all.every((x) => pane.typed().includes(`${x}\r`)); }, 'every line typed');
  const lines = pane.typed().slice(1).split('\r').filter(Boolean).map((l) => l.replace(/^\[devteam info \S+ from owner\] /, ''));
  assert.deepEqual(lines, all, 'the late line after the held ones, each once');
});

test("a claim nobody is working goes back as it was: its process gone, or alive but silent for a minute (a pid can be anyone's); one being worked is left alone", { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const F = threadsFixture('pane-claims');
  const later = cleanup(t);
  later(() => F.done());
  const root = path.join(F.old, 'docs/devteam/run/held');
  const live = spawn('sleep', ['600']);
  later(() => live.kill());
  const dead = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).stdout.trim();
  const old = new Date(Date.now() - 5 * 60000);
  for (const [name, claim, recovers] of [['dead', () => `${dead}-${Date.now()}`, true], ['stale', () => `${live.pid}-${old.getTime()}`, true], ['fresh', () => `${live.pid}-${Date.now()}`, false]]) {
    const pane = menuPane(F);
    const S = { DEVTEAM_SUPERVISOR: pane.target };
    for (let i = 0; i < 2; i++) F.run(F.old, ['send', 'supervisor', `${name} ${i}`, '--owner'], S);
    const claimed = path.join(root, `${encodeURIComponent(pane.key)}.claim-${claim()}`);
    fs.renameSync(heldDirOf(F, pane), claimed);
    if (name === 'stale') fs.utimesSync(claimed, old, old);
    pane.press('1');
    await until(() => /answered 1/.test(pane.shows()), 'the answer');
    for (let i = 0; i < 3; i++) tick(F, S);
    const later = F.run(F.old, ['send', 'supervisor', `${name} later`, '--owner'], S);
    if (!recovers) {
      nap(500);
      assert.equal(pane.typed(), '1', 'a claim touched just now is someone at work: nothing typed over it');
      assert.match(later.err, /recorded and held: the supervisor's terminal asks nothing now, but lines held for it earlier go first/, 'and the sender is told why');
      continue;
    }
    await until(() => new RegExp(`${name} later\\r`).test(pane.typed()), `the lines of the ${name} claim`);
    assert.match(pane.typed(), new RegExp(`^1\\[devteam info \\S+ from owner\\] ${name} 0\\r\\[devteam info \\S+ from owner\\] ${name} 1\\r\\[devteam info \\S+ from owner\\] ${name} later\\r$`), name);
    assert.deepEqual(fs.readdirSync(root).filter((n) => n.startsWith(encodeURIComponent(pane.key))), [], name);
  }
});

test('held lines wait for the input box: a second prompt holds them again, an agent with no box gets them after two minutes, and one a day old is let go and logged', { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const F = threadsFixture('pane-ready');
  const later = cleanup(t);
  later(() => F.done());
  // a second prompt right after the first
  const two = menuPane(F, 'menu,menu2,input');
  let S = { DEVTEAM_SUPERVISOR: two.target };
  F.run(F.old, ['send', 'supervisor', 'after both', '--owner'], S);
  two.press('1');
  await until(() => /rm -rf {2}build/.test(two.shows()), 'the second prompt');
  tick(F, S);
  nap(300);
  assert.equal(two.typed(), '1', 'nothing typed into the second prompt');
  assert.equal(heldFor(F, two).length, 1);
  two.press('2');
  await until(() => /answered 2/.test(two.shows()), 'the second answer');
  tick(F, S);
  await until(() => /after both\r/.test(two.typed()), 'the held line, once the input box shows');
  // nothing asked, but no input box either: held, and why is said; typed once it has waited two minutes
  const bare = menuPane(F, 'menu,bare');
  S = { DEVTEAM_SUPERVISOR: bare.target };
  F.run(F.old, ['send', 'supervisor', 'for the bare one', '--owner'], S);
  bare.press('1');
  await until(() => /answered 1/.test(bare.shows()), 'the answer');
  tick(F, S);
  assert.match(F.run(F.old, ['send', 'supervisor', 'and another', '--owner'], S).err, /asks nothing now, but lines held for it earlier go first and it is not showing its input box yet/);
  assert.equal(bare.typed(), '1');
  age(F, bare, 3 * 60000);
  tick(F, S);
  await until(() => /and another\r/.test(bare.typed()), 'the lines, after two minutes with nothing asked');
  assert.match(bare.typed(), /^1\[devteam info \S+ from owner\] for the bare one\r\[devteam info \S+ from owner\] and another\r$/);
  // a day old: let go, and the supervisor's log says so; an owner's process leaves that to it
  const stuck = menuPane(F);
  S = { DEVTEAM_SUPERVISOR: stuck.target };
  F.run(F.old, ['send', 'supervisor', 'never read', '--owner'], S);
  age(F, stuck, 25 * 3600000);
  F.run(F.old, ['send', 'supervisor', 'still waiting', '--owner'], S);
  assert.equal(heldFor(F, stuck).length, 2, "the owner's process drops nothing");
  tick(F, S);
  assert.equal(heldFor(F, stuck).length, 1);
  const dropped = logLines(F).filter((l) => l.type === 'observation' && l.kind === 'held-dropped');
  assert.equal(dropped.length, 1);
  assert.match(dropped[0].detail, /was never typed and is let go \(held for over a day\): "\[devteam info \S+ from owner\] never read"/);
  assert.equal(stuck.typed(), '');
  assert.equal(F.run(F.old, ['log-check']).status, 0);
});

test("what the card cannot answer is said as it is: a dialog with no numbers, one taller than the pane, the usage-limit menu, a pane that is not the supervisor's", { skip: hasTmux ? false : 'no tmux' }, () => {
  const F = threadsFixture('pane-kinds');
  try {
    const look = (pane) => { const S = { DEVTEAM_SUPERVISOR: pane.target }; return { S, q: JSON.parse(F.owner(['pane', 'question', '--json'], S)), hello: JSON.parse(F.owner(['hello', '--json', '--no-kit', '--pane'], S)), said: F.owner(['pane', 'question'], S) }; };
    const trust = menuPane(F, 'trust,input');
    let x = look(trust);
    assert.deepEqual([x.q.ask.kind, x.q.ask.options], ['dialog', undefined]);
    assert.match(x.q.ask.text, /❯ Yes\n {3}No/);
    assert.match(x.hello.pulse.attention[0], /terminal needs you: a dialog is up that is answered in the terminal/);
    assert.match(x.said, /answered in the terminal, not on the dashboard/);
    assert.match(F.owner(['thread', 'new', 'Approved here'], x.S), /recorded and held: the supervisor's terminal has a dialog up that only the terminal can answer \(no card can\)/);
    assert.equal(trust.typed(), '');
    const long = menuPane(F, 'long,input');
    x = look(long);
    assert.deepEqual([x.q.ask.kind, x.q.ask.options], ['dialog', undefined], 'its top is off the screen: no buttons');
    assert.match(F.run(F.old, ['send', 'supervisor', 'hello', '--owner'], x.S).err, /only the terminal can answer/);
    const limit = menuPane(F, 'limit,input');
    x = look(limit);
    assert.deepEqual([x.q.ask.kind, x.q.ask.options], ['limit', undefined]);
    assert.match(x.hello.pulse.attention[0], /stopped at a usage-limit menu/);
    assert.match(F.run(F.old, ['send', 'supervisor', 'w1 is done', '--owner'], x.S).err, /recorded and held: the supervisor's terminal is stopped at a usage-limit menu/);
    assert.equal(limit.typed(), '');
    // a menu in a pane that runs in a worktree: recorded as the supervisor's, but a worker's
    const wt = path.join(F.old, '.worktrees', 'some-ticket');
    fs.mkdirSync(wt, { recursive: true });
    const worker = menuPane(F, 'menu,input', wt);
    x = look(worker);
    assert.match(x.q.problem, /runs in a worktree .*: that is a worker's or a planner's/);
    assert.deepEqual([x.q.ask.kind, x.q.ask.options], ['dialog', undefined], 'shown, never offered');
    const elsewhere = menuPane(F, 'menu,input', F.base);
    assert.match(look(elsewhere).q.problem, /not in this checkout/);
  } finally { F.done(); }
});

test("a session at a permission prompt is a red question: hello counts the supervisor's and each worker's into the Inbox, a usage-limit stop not", { skip: hasTmux ? false : 'no tmux' }, () => {
  const F = threadsFixture('pane-prompts');
  try {
    const hello = (S) => JSON.parse(F.owner(['hello', '--json', '--no-kit', '--pane'], S));
    const none = hello({ DEVTEAM_SUPERVISOR: 'no-such-session:0' });
    assert.equal(none.prompts, 0);
    const base = none.inbox;
    assert.equal(JSON.parse(F.owner(['hello', '--json', '--no-kit'])).prompts, undefined, 'only when asked: tmux is not read for a plain hello');
    // the supervisor at a Bash permission prompt: one more in the Inbox
    const sup = menuPane(F, 'menu2,input');
    const S = { DEVTEAM_SUPERVISOR: sup.target };
    let h = hello(S);
    assert.equal(h.supervisor_question.kind, 'menu');
    assert.deepEqual([h.prompts, h.inbox, h.prompt_sessions], [1, base + 1, []]);
    // a dialog with no numbers counts too; the usage-limit menu does not
    assert.deepEqual([hello({ DEVTEAM_SUPERVISOR: menuPane(F, 'trust,input').target }).prompts], [1]);
    const limit = hello({ DEVTEAM_SUPERVISOR: menuPane(F, 'limit,input').target });
    assert.deepEqual([limit.supervisor_question.kind, limit.prompts, limit.inbox], ['limit', 0, base]);
    // a worker's window (started in a worktree, in the fleet's tmux session) at a permission prompt
    const wt = path.join(F.old, '.worktrees', 'some-ticket');
    fs.mkdirSync(wt, { recursive: true });
    const worker = menuPane(F, 'menu2,input', wt);
    fs.writeFileSync(path.join(F.old, 'docs/devteam/run/tmux-session'), `${worker.target.split(':')[0]}\n`);
    h = hello(S);
    assert.deepEqual([h.prompts, h.inbox, h.prompt_sessions.map((x) => x.window)], [2, base + 2, ['main']]);
    assert.match(h.prompt_sessions[0].line, /Do you want to proceed|1\. Yes/);
    assert.match(h.pulse.attention[1], /^main is stopped at a permission prompt: answer it in the terminal/);
    // answered at the worker's terminal: it counts no more
    worker.press('1');
    for (let i = 0; i < 50 && /proceed/.test(worker.shows()); i++) nap(100);
    h = hello(S);
    assert.deepEqual([h.prompts, h.inbox, h.prompt_sessions], [1, base + 1, []]);
    assert.equal(worker.typed(), '1', 'hello types nothing into any pane');
  } finally { F.done(); }
});
