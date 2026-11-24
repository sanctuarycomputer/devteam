// Fast threads end to end (kit-107; stories FT-S1 to FT-S6): every story of the feature through the
// kit's own commands, with a stub agent (test/fixtures/fast-threads/stub-agent.mjs) as the owner's
// responder_command, started by `devteam.mjs responder` on the fixture's private tmux server, and the
// same stub as a live worker in a ticket's window. The owner's turns go through the kit's routing and
// typing; the stub answers what is typed into its pane with the kit's own thread reply and send …
// --kind handoff, as the responder (or the worker); the supervisor's wait, messages, metrics, thread
// ask, answer and correct see the result. A clock shim (test/fixtures/fast-threads/clock.mjs, loaded
// into every node process the test starts) moves "now" forward past the kit's thresholds (3 minutes
// for responder-overdue) without waiting them out; the machine's clock never moves.
// Run: node --test test/fast-threads-e2e.test.mjs (tmux, on a private TMUX_TMPDIR and a server of its
// own; the Chrome case needs Node 22 or later and a Chrome, and skips without them)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SUP, NO_TMUX, sleep, fixture } from './lib/responder-routing.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { dashboardOnFreePort } from './lib/kit.mjs';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fast-threads');
const STUB = path.join(FIX, 'stub-agent.mjs');
const MEASURE = path.join(FIX, 'measure.sh');
// The clock, set before the fixture (and its tmux server) starts, so every node process it starts
// inherits it: the kit's commands, the responder's shell and the stub, and the stub's own commands
const CLOCK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-clock-'));
const CLOCK = path.join(CLOCK_DIR, 'offset');
fs.writeFileSync(CLOCK, '0\n');
process.env.DT_CLOCK_FILE = CLOCK;
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(path.join(FIX, 'clock.mjs')).href}`.trim();
process.on('exit', () => fs.rmSync(CLOCK_DIR, { recursive: true, force: true }));

const MIN = 60000;
const offset = () => Number(fs.readFileSync(CLOCK, 'utf8')) || 0;
// "now" as the kit reads it
const kitNow = () => Date.now() + offset();
// the kit's clock moved forward by ms; the shim reads the file again within 200 ms
const ahead = (ms) => { fs.writeFileSync(CLOCK, `${offset() + ms}\n`); sleep(400); };
const TICKET = 'web-07-checkout-copy';

test('fast threads end to end (kit-107)', { skip: NO_TMUX, timeout: 290000 }, async (t) => {
  const F = fixture('fast-threads-e2e');
  t.after(() => F.done());
  // probes only: FT_ONLY=<regex> runs E0 and the cases it matches (each case opens its own threads)
  const only = process.env.FT_ONLY ? new RegExp(process.env.FT_ONLY) : null;
  const it = (name, opts, fn) => (fn ? t.test(name, only && !/^E0 /.test(name) && !only.test(name) ? { ...opts, skip: 'FT_ONLY' } : opts, fn) : it(name, {}, opts));
  const run = path.join(F.old, 'docs/devteam/run');
  const supPane = () => F.tmux(['capture-pane', '-p', '-t', F.P.target]).stdout ?? '';
  const stubLog = (name = 'responder') => { try { return fs.readFileSync(path.join(run, `stub-${name}.log`), 'utf8'); } catch { return ''; } };
  // a line typed into the stub's pane, as the test steers it ("stub: …"), and read by it
  const steer = (words, target = F.target, name = 'responder') => {
    const before = stubLog(name).length;
    assert.equal(F.tmux(['send-keys', '-t', target, '-l', `stub: ${words}`]).status, 0);
    assert.equal(F.tmux(['send-keys', '-t', target, 'Enter']).status, 0);
    for (let i = 0; i < 100 && !stubLog(name).slice(before).includes(`read stub: ${words}`); i++) sleep(100);
    assert.ok(stubLog(name).slice(before).includes(`read stub: ${words}`), `the stub read "stub: ${words}":\n${stubLog(name).slice(before)}`);
    return () => stubLog(name).slice(before);
  };
  // the first turn after the owner's turn U in thread T by writer (responder by default), waited for up to ms
  const replyTo = (T, U, ms, writer = 'responder') => {
    const end = Date.now() + ms;
    for (;;) {
      const ts = F.show(T).turns;
      const at = ts.find((u) => u.id === U)?.at;
      const r = at && ts.find((u) => u.writer === writer && u.at > at);
      if (r || Date.now() > end) return r ? { ...r, ms: Date.parse(r.at) - Date.parse(at) } : null;
      sleep(100);
    }
  };
  const answered = (T, words) => {
    const s = F.say(T, words);
    const r = replyTo(T, s.U, 45000);
    assert.ok(r, `the stub replied to ${s.U} (${words}); stub log:\n${stubLog()}`);
    return { ...s, reply: r };
  };
  const opened = (title, subject) => {
    const n = F.thread(title, subject);
    const r = replyTo(n.T, n.U, 20000);
    assert.ok(r, `the stub replied to ${n.T}'s first turn; stub log:\n${stubLog()}`);
    return n;
  };
  const sup = (args) => F.run(args, SUP);
  const routed = (U) => F.turn(U).routed_to;
  const owedToSup = (T) => F.run(['thread', 'list', '--waiting'], SUP).out.split('\n').filter((l) => l.includes(T));
  const queue = () => JSON.parse(F.run(['thread', 'list', '--waiting', '--responder', '--json'], { DEVTEAM_ROLE: 'responder' }).out || '[]');
  const measure = () => { const r = spawnSync('sh', [MEASURE], { cwd: F.old, env: F.env(), encoding: 'utf8', timeout: 60000 }); return { status: r.status, lines: r.stdout.trim().split('\n'), err: r.stderr }; };
  // a supervisor's answer to whatever it owes in T, so no case leaves a turn waiting on it
  const settle = (T) => { const r = sup(['thread', 'reply', T, '--', 'Done here.']); assert.equal(r.status, 0, r.err); };
  // a running wait (cycle 1 s, with its trace); started once its loop has looked twice
  const waiting = async () => {
    // a tick first deals with the owner's lines: with the clock moved on, one left unread for over
    // 10 minutes would wake wait by itself (owner-unread)
    const refs = JSON.parse(F.sup(['unread', '--json'])).unread.map((l) => l.ref);
    if (refs.length) F.sup(['unread', 'ack', ...refs]);
    fs.writeFileSync(path.join(run, 'wait-since'), `${kitNow()}\n`);
    const trace = path.join(F.base, `wait-trace-${Date.now()}.jsonl`);
    const looks = () => { try { return fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };
    const w = { out: '' };
    const c = spawn(process.execPath, [F.DT, 'wait', '--minutes', '30'], { cwd: F.old, detached: true, env: F.env(F.withSup({ ...SUP, DEVTEAM_TEST_WAIT_CYCLE_MS: '1000', DEVTEAM_TEST_WAIT_TRACE: trace })) });
    c.stdout.on('data', (d) => { w.out += d; });
    w.exited = new Promise((resolve) => c.on('exit', () => resolve(true)));
    w.stop = () => { try { process.kill(-c.pid, 'SIGKILL'); } catch {} };
    for (let i = 0; i < 300 && looks() < 2 && c.exitCode === null; i++) await new Promise((resolve) => setTimeout(resolve, 100));
    const up = looks() >= 2 && c.exitCode === null;
    if (!up) w.stop();
    assert.ok(up, `wait is in its loop (${looks()} looks): ${w.out}`);
    // woken within ms of real time, or false
    w.woke = (ms) => Promise.race([w.exited, new Promise((resolve) => setTimeout(() => resolve(false), ms))]);
    return w;
  };

  await it('E0 the stub is the owner\'s responder_command, on a private tmux, and the kit reads the test\'s clock', () => {
    const e = F.env();
    assert.ok(/[\\/]dt-tmux-[^\\/]+$/.test(e.TMUX_TMPDIR ?? '') && !('TMUX' in e) && !('TMUX_PANE' in e), `a private TMUX_TMPDIR (${e.TMUX_TMPDIR}) and no TMUX (${e.TMUX})`);
    const sf = path.join(F.old, 'docs/devteam/project/settings.md');
    const text = fs.readFileSync(sf, 'utf8');
    const block = /```json devteam\s*\n([\s\S]*?)\n```/.exec(text);
    fs.writeFileSync(sf, text.replace(block[1], JSON.stringify({ ...JSON.parse(block[1]), responder_command: `${process.execPath} ${STUB}` }, null, 2)));
    F.g(['commit', '-qam', 'settings: responder_command'], F.old);
    F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
    assert.equal(F.tmux(['new-session', '-d', '-x', '220', '-y', '50', '-s', F.session, '-n', 'hold', `${process.execPath} -e "setInterval(()=>{},1000)"`]).status, 0);
    const r = F.run(['responder'], SUP);
    assert.equal(r.status, 0, r.err || r.out);
    for (let i = 0; i < 300 && !F.capture().includes('stub responder up'); i++) sleep(100);
    assert.ok(F.capture().includes('stub responder up'), `the stub is up in the responder's window:\n${F.capture()}`);
    assert.match(stubLog(), /up in .*\.worktrees\/responder as responder /, 'it runs in the responder\'s worktree, as the responder');
    // the shim: a kit process started now reads the offset the test writes
    const probe = () => Number(spawnSync(process.execPath, ['-e', 'process.stdout.write(String(Date.now()))'], { env: F.env(), encoding: 'utf8' }).stdout);
    const off = offset();
    ahead(5000);
    const seen = probe() - Date.now();
    assert.ok(seen >= off + 4000 && seen <= off + 7000, `a node process the fixture starts is ${seen} ms ahead (want about ${off + 5000})`);
    // and reads a file's times by the same offset, so a lock it just made is new (the kit's locks
    // compare a file's mtime with Date.now())
    const age = Number(spawnSync(process.execPath, ['-e', "const fs = require('fs'); const f = process.argv[1]; fs.writeFileSync(f, 'x'); process.stdout.write(String(Date.now() - fs.statSync(f).mtimeMs))", path.join(F.base, 'clock-stat')], { env: F.env(), encoding: 'utf8' }).stdout);
    assert.ok(Math.abs(age) < 2000, `a file it just wrote is ${age} ms old by its clock (want about 0)`);
    // and a time it stamps on a file (as the kit stamps a held lock: utimesSync with new Date()) reads back as that time
    const stamped = Number(spawnSync(process.execPath, ['-e', "const fs = require('fs'); const f = process.argv[1]; const t = new Date(); fs.utimesSync(f, t, t); process.stdout.write(String(fs.statSync(f).mtimeMs - t.getTime()))", path.join(F.base, 'clock-stat')], { env: F.env(), encoding: 'utf8' }).stdout);
    assert.ok(Math.abs(stamped) < 2000, `a time it stamped on a file reads ${stamped} ms off (want about 0)`);
  });

  let T;
  await it('E1 an owner\'s thread say gets the responder\'s turn within 10 s; the supervisor\'s pane is unchanged', () => {
    const n = F.thread('Release notes');
    replyTo(n.T, n.U, 20000);
    T = n.T;
    const pane = supPane();
    const keys = F.P.typed();
    const s = F.say(T, 'Can you add the changelog link?');
    const r = replyTo(T, s.U, 10000);
    assert.ok(r && r.ms <= 10000, `a responder turn within 10 s of ${s.U} (${r ? `${r.ms} ms` : 'none'}); stub log:\n${stubLog()}`);
    assert.match(r.text, /^stub reply: Can you add the changelog link\?/, 'the stub\'s reply, to these words');
    sleep(1500);
    assert.equal(supPane(), pane, 'the supervisor\'s pane capture is unchanged');
    assert.equal(F.P.typed(), keys, 'nothing typed into the supervisor\'s pane');
    assert.deepEqual([s.line.routed_to, s.line.delivered, s.said], ['responder', 'typed', 'sent to the responder'], 'routed to the responder and typed into its pane');
  });

  await it('E2 a turn the stub hands over wakes a running wait within 60 s; messages --open lists the handoff until a supervisor turn', async () => {
    const w = await waiting();
    try {
      const s = answered(T, 'Please merge the release PR');
      assert.equal(s.line.routed_to, 'responder', 'the merge turn went to the responder first');
      const h = JSON.parse(F.sup(['messages', '--open', '--to', 'supervisor', '--json'])).find((m) => m.kind === 'handoff' && m.thread === T);
      assert.ok(h, `the stub's handoff is open after the responder's turn; stub log:\n${stubLog()}`);
      const left = Date.parse(h.created_at) + MIN - kitNow();
      const done = await w.woke(Math.max(left, 0) + 5000);
      const at = done ? Number(fs.readFileSync(path.join(run, 'wait-since'), 'utf8')) : null;
      assert.ok(at && at - Date.parse(h.created_at) <= MIN, `wait returned within 60 s of the handoff (${at ? at - Date.parse(h.created_at) : 'no'} ms): ${w.out}`);
      assert.match(w.out, new RegExp(`something needs you:\\n\\s+message ${h.id}`), 'it woke on the handoff');
      assert.match(F.sup(['messages', '--open', '--to', 'supervisor']), new RegExp(`${h.id} \\[handoff\\] from responder`), 'still open after the wait woke');
      F.sup(['thread', 'reply', T, '--', 'Merging it now.']);
      assert.doesNotMatch(F.sup(['messages', '--open', '--to', 'supervisor']), new RegExp(h.id), 'settled by the supervisor\'s turn in that thread');
    } finally { w.stop(); }
  });

  await it('E3 the spine\'s measure check, on this log with 20 owner turns the stub answered, prints 0', () => {
    for (let i = 0; i < 4; i++) {
      const n = opened(`Question ${i + 1}`);
      for (let j = 0; j < (i === 0 ? 5 : 3); j++) answered(n.T, `follow-up ${j + 1} on question ${i + 1}`);
    }
    const all = JSON.parse(F.owner(['thread', 'list', '--all', '--json'])).flatMap((x) => x.turns.map((u) => ({ ...u, thread: x })));
    const first = Math.min(...all.filter((u) => u.writer === 'responder').map((u) => Date.parse(u.at)));
    const counted = all.filter((u) => u.writer === 'owner' && Date.parse(u.at) >= first);
    assert.ok(counted.length >= 20, `at least twenty owner turns since the responder's first (${counted.length})`);
    for (const u of counted) assert.equal(u.thread.turns.find((x) => x.writer !== 'owner' && x.at > u.at)?.writer, 'responder', `the stub answered ${u.id} first`);
    const m = measure();
    assert.equal(m.status, 0, m.err);
    assert.equal(m.lines.at(-1), '0', `the measure prints 0: ${m.lines.join(' / ')}`);
    assert.equal(m.lines[0], `owner turns: ${counted.length} since the responder started, over 30 s: `);
  });

  await it('E4 a turn in a thread holding the supervisor\'s open thread ask question is routed_to supervisor, and stays so after it closes', () => {
    const n = opened('Colours', `goal:${F.goal}`);
    const Q = F.sup(['thread', 'ask', n.T, '--question', 'Which colour for the button?', '--goal', F.goal, '--stake', '1', '--urgency', '1']).split('\n')[0];
    assert.match(Q, /^q-/);
    const before = stubLog().length;
    const s = F.say(n.T, 'Blue, I think.');
    assert.equal(s.line.routed_to, 'supervisor', 'routed_to supervisor while the question is open');
    assert.ok(F.reaches(F.P.typed, new RegExp(`\\[devteam thread ${n.T} from owner[^\\]]*\\] Blue, I think\\.`)), 'typed into the supervisor\'s pane');
    assert.ok(F.stays(() => stubLog().slice(before), /Blue, I think/), 'not typed into the stub\'s');
    F.sup(['withdraw', Q, '--reason', 'kit-107: closing it']);
    assert.equal(JSON.parse(F.sup(['questions', '--id', Q, '--json']))[0].status, 'withdrawn', 'the question is closed');
    assert.equal(F.show(n.T).turns.find((u) => u.id === s.U)?.routed_to, 'supervisor', 'the turn stays routed_to supervisor, as the kit shows it');
    assert.match(F.sup(['thread', 'show', n.T]), new RegExp(`owner \\(${s.U}\\), routed to the supervisor:`), 'thread show says so');
    assert.ok(owedToSup(n.T).length, `still waiting on the supervisor: ${F.run(['thread', 'list', '--waiting'], SUP).out}`);
    settle(n.T);
    // one open thread per subject: this goal's thread is closed for E6's
    F.owner(['thread', 'resolve', n.T]);
  });

  await it('E5 "Merge the dashboard PR." settles a question asked after it with thread ask --turn, through answer --from-turn --said; the stub\'s relaying turn is refused', () => {
    const n = opened('Dashboard');
    const s = answered(n.T, 'Merge the dashboard PR.');
    const relay = s.reply;
    assert.match(relay.text, /^Passed to the supervisor/, 'the stub relayed it');
    const Q = F.sup(['thread', 'ask', n.T, '--turn', s.U, '--question', 'Merge the dashboard PR now?', '--recommendation', 'Yes', '--goal', F.goal, '--stake', '1', '--urgency', '1']).split('\n')[0];
    assert.match(Q, /^q-/);
    const no = sup(['answer', Q, 'Yes', '--from-turn', relay.id, '--said', 'Merge the dashboard PR.']);
    assert.notEqual(no.status, 0, 'citing the stub\'s turn is refused');
    assert.match(no.err, new RegExp(`--from-turn ${relay.id}: that turn is the responder's; only the owner's words settle a question`));
    assert.equal(JSON.parse(F.sup(['questions', '--id', Q, '--json']))[0].status, 'open', 'and leaves it open');
    F.sup(['answer', Q, 'Yes', '--from-turn', s.U, '--said', 'Merge the dashboard PR.']);
    const q = JSON.parse(F.sup(['questions', '--id', Q, '--json']))[0];
    assert.deepEqual([q.status, q.channel, q.turn, q.said], ['answered', 'thread', s.U, 'Merge the dashboard PR.'], 'settled by the owner\'s words in that turn');
  });

  await it('E6 thread ask --turn, then "No, hold off.": answer --from-turn --said is refused without --seen-turn; with it, answer_seen, and the answer stands', () => {
    const n = opened('Release day', `goal:${F.goal}`);
    const s = answered(n.T, 'Ship the release notes today.');
    const Q = F.sup(['thread', 'ask', n.T, '--turn', s.U, '--question', 'Ship the notes today?', '--recommendation', 'Yes', '--goal', F.goal, '--stake', '1', '--urgency', '1']).split('\n')[0];
    const later = F.say(n.T, 'No, hold off.');
    const no = sup(['answer', Q, 'Yes', '--from-turn', s.U, '--said', 'Ship the release notes today.']);
    assert.notEqual(no.status, 0, 'refused without --seen-turn');
    assert.match(no.err, new RegExp(`the owner wrote in ${n.T} after ${s.U}; read it first, then run this again with --seen-turn ${later.U}`));
    F.sup(['answer', Q, 'Yes', '--from-turn', s.U, '--said', 'Ship the release notes today.', '--seen-turn', later.U]);
    assert.equal(F.raw(Q).find((l) => l.answer !== undefined)?.answer_seen, later.U, 'the answer line records answer_seen');
    const q = JSON.parse(F.sup(['questions', '--id', Q, '--json']))[0];
    assert.deepEqual([q.status, q.answer], ['answered', 'Yes'], 'the question\'s answer stands');
    assert.equal(F.finding('thread-answer-unbound', Q), undefined, 'and no finding says otherwise');
    settle(n.T);
  });

  await it('E7 the supervisor\'s thread new about a question: the owner\'s "yes" is routed_to supervisor and settles it; an unprompted supervisor turn is refused', () => {
    const Q = F.sup(['ask', '--question', 'Ship on Friday?', '--goal', F.goal, '--stake', '1', '--urgency', '1']).split('\n')[0];
    const keys = F.P.typed();
    const before = stubLog().length;
    const T7 = F.sup(['thread', 'new', '--title', 'Friday', '--subject', JSON.stringify({ kind: 'item', ref: `question:${Q}` }), '--', 'Shall we ship on Friday?']).split('\n')[0];
    assert.match(T7, /^t-/);
    const s = F.say(T7, 'yes');
    assert.equal(s.line.routed_to, 'supervisor', 'routed_to supervisor');
    assert.ok(F.stays(() => stubLog().slice(before), new RegExp(T7)), 'nothing of it typed into the stub\'s pane');
    assert.ok(F.reaches(() => F.P.typed().slice(keys.length), new RegExp(`\\[devteam thread ${T7} from owner[^\\]]*\\] yes`)), 'typed into the supervisor\'s');
    F.sup(['answer', Q, 'yes', '--from-turn', s.U]);
    assert.deepEqual((({ status, turn }) => [status, turn])(JSON.parse(F.sup(['questions', '--id', Q, '--json']))[0]), ['answered', s.U], 'the owner\'s yes settles it');
    settle(T7);
    const no = sup(['thread', 'reply', T7, '--', 'One more thing.']);
    assert.notEqual(no.status, 0, 'an unprompted turn with no refs is refused');
    assert.match(no.err, new RegExp(`nothing in ${T7} is waiting on you`));
  });

  await it('E8 a turn in a thread about a decision is routed_to supervisor; correct --from-turn --said records it and drops the class to rung 1; another decision is refused', () => {
    // two of the supervisor's calls at rung 2, written as the kit writes them (a call at rung 2 asks first)
    const call = (n, what) => F.hand('supervisor', { id: `d-20261118-00000010${n}-supervisor`, type: 'decision', class: 'release-scope', what, authority: 'rung', rung: 2 }, 3600000 - n);
    const D = call(1, 'Ship the dashboard without a review');
    const D2 = call(2, 'Ship the notes without a review');
    const said = 'That was the wrong call: the PR needed review.';
    const out = F.owner(['thread', 'new', '--title', 'The dashboard call', '--subject', JSON.stringify({ kind: 'item', ref: `decision:${D}` }), '--', said], F.withSup()).split('\n');
    const T8 = out[0];
    const U = F.show(T8).turns[0].id;
    assert.equal(routed(U), 'supervisor', 'routed_to supervisor');
    const no = sup(['correct', D2, '--from-turn', U, '--said', said]);
    assert.notEqual(no.status, 0, 'naming a different decision is refused');
    assert.match(no.err, new RegExp(`that thread is about decision:${D}, not ${D2}`));
    const ok = sup(['correct', D, '--from-turn', U, '--said', said]);
    assert.equal(ok.status, 0, ok.err);
    assert.match(`${ok.out}\n${ok.err}`, /release-scope drops to rung 1/);
    const c = F.raw(D).find((l) => l.corrected)?.corrected;
    assert.deepEqual([c?.turn, c?.said], [U, said], 'recorded inside corrected');
    assert.equal(JSON.parse(F.sup(['trust', '--json'])).find((r) => r.class === 'release-scope')?.rung, 1, 'the class is at rung 1');
    settle(T8);
    const next = F.say(T8, 'Thanks for fixing it.');
    assert.equal(next.line.routed_to, 'responder', 'the next owner turn there takes the ordinary rules');
    assert.ok(replyTo(T8, next.U, 20000), `the stub answered it; stub log:\n${stubLog()}`);
  });

  await it('E9 the supervisor answers a turn while the stub is held busy: it leaves the stub\'s queue, and the stub\'s reply to it needs --anyway', () => {
    const B = opened('Build check');
    steer('mode silent');
    const x = F.say(B.T, 'Can you check the build?');
    assert.equal(x.line.delivered, 'typed', 'typed into the stub');
    // the stub's promise of more (thread reply --pending): busy until it follows up
    const log = steer(`pending ${B.T} Looking into it.`);
    for (let i = 0; i < 100 && !/ran thread reply t-\S+ -> 0/.test(log()); i++) sleep(100);
    steer('forget');
    const c = F.say(B.T, 'Any news?');
    assert.deepEqual([c.line.routed_to, c.line.delivered, c.said], ['responder', 'queued', 'the responder is busy; it takes this next'], 'the next turn is queued: the stub is busy');
    assert.ok(queue().some((q) => q.turn === c.U), 'in the stub\'s queue');
    settle(B.T);
    assert.ok(!queue().some((q) => q.turn === c.U), `out of the stub's queue once the supervisor answered: ${JSON.stringify(queue())}`);
    const r = steer(`reply ${B.T} Here is what I found.`);
    for (let i = 0; i < 100 && !/--anyway -> /.test(r()); i++) sleep(100);
    assert.match(r(), /ran thread reply t-\S+ -> 1 .*the supervisor has answered this/, `its reply is refused: ${r()}`);
    assert.match(r(), /ran thread reply t-\S+ --anyway -> 0/, `and goes with --anyway: ${r()}`);
    assert.ok(F.show(B.T).turns.some((u) => u.writer === 'responder' && u.text === 'Here is what I found.'), 'the reply is in the thread');
    steer('mode answer');
  });

  await it('E10 an owner turn, then the thread resolved: no responder-overdue, nothing routed to the supervisor, left out of the measure', () => {
    steer('mode silent');
    const keys = F.P.typed();
    const m0 = measure();
    const K = F.thread('Never mind');
    ahead(40000);
    const m1 = measure();
    assert.equal(Number(m1.lines.at(-1)), Number(m0.lines.at(-1)) + 1, `unanswered, it counts as slow before the resolve: ${m1.lines.join(' / ')}`);
    F.owner(['thread', 'resolve', K.T]);
    const m2 = measure();
    assert.equal(m2.lines.at(-1), m0.lines.at(-1), `left out of the measure once resolved: ${m2.lines.join(' / ')}`);
    assert.equal(Number(/owner turns: (\d+)/.exec(m2.lines[0])[1]), Number(/owner turns: (\d+)/.exec(m1.lines[0])[1]) - 1, 'one turn fewer counted');
    ahead(3 * MIN + 5000);
    assert.equal(F.finding('responder-overdue', K.T), undefined, 'no responder-overdue past 3 minutes');
    assert.equal(routed(K.U), 'responder', 'the turn stayed the responder\'s');
    assert.deepEqual(owedToSup(K.T), [], 'nothing waits on the supervisor there');
    assert.doesNotMatch(F.P.typed().slice(keys.length), new RegExp(`\\[devteam thread ${K.T} from owner`), 'the turn was never typed into the supervisor\'s pane');
    steer('mode answer');
  });

  await it('E11 a silent stub: responder-overdue within 3 minutes, wait wakes on it, and the next owner turn is routed_to supervisor', async () => {
    steer('mode silent');
    const w = await waiting();
    try {
      const S = F.thread('Silence');
      assert.equal(F.turn(S.U).delivered, 'typed');
      ahead(3 * MIN + 2000);
      assert.equal(F.finding('responder-overdue', S.T)?.severity, 'high', 'metrics shows responder-overdue past 3 minutes');
      const done = await w.woke(20000);
      assert.ok(done, `wait woke: ${w.out}`);
      assert.match(w.out, new RegExp(`finding responder-overdue ${S.T}: the owner's turn ${S.U} went to the responder 3 min ago`), 'on responder-overdue');
      const next = F.thread('After the silence');
      assert.deepEqual([routed(next.U), next.said], ['supervisor', 'sent to the supervisor\'s pane'], 'the next owner turn is the supervisor\'s');
      settle(S.T);
      settle(next.T);
    } finally { w.stop(); }
    steer('mode answer');
  });

  await it('E12 a stub that never drains its queue: the idle nudge is typed within a minute, then the queued turn is responder-overdue and the next turn the supervisor\'s', async (tt) => {
    // the dashboard, as a fleet runs it: its accounts tick every DEVTEAM_ACCOUNTS_MS, the default (60 s)
    const later = cleanup(tt);
    const e = F.env();
    delete e.DEVTEAM_ACCOUNTS_MS;
    const { dash } = await dashboardOnFreePort(F.old, e);
    later(() => dash.stop());
    steer('mode silent');
    const X = F.thread('Busy first');
    const Y = F.thread('Waiting in line');
    assert.equal(F.turn(Y.U).delivered, 'queued');
    const before = stubLog().length;
    // the stub idle with a turn in its queue, from now
    settle(X.T);
    const idle = Date.now();
    const nudged = () => /read \[devteam responder\] a turn is waiting/.test(stubLog().slice(before));
    while (!nudged() && Date.now() - idle < 65000) await new Promise((r) => setTimeout(r, 250));
    assert.ok(nudged(), `the nudge typed into the stub within a minute (${Date.now() - idle} ms): ${stubLog().slice(before)}`);
    await dash.stop();
    assert.ok(queue().some((x) => x.turn === Y.U), 'not taken: still queued');
    ahead(3 * MIN + 2000);
    assert.equal(F.finding('responder-overdue', Y.T)?.severity, 'high', 'the queued turn is responder-overdue');
    const next = F.thread('After the queue');
    assert.equal(routed(next.U), 'supervisor', 'the next owner turn is the supervisor\'s');
    settle(Y.T);
    settle(next.T);
    steer('mode answer');
  });

  await it('E13 a stub held on a blocked prompt: responder-stuck, and the next owner turn is routed_to supervisor', () => {
    steer('prompt');
    for (let i = 0; i < 50 && !/Do you want to proceed\?/.test(F.capture()); i++) sleep(100);
    const f = F.finding('responder-stuck', 'responder');
    assert.equal(f?.severity, 'medium', `responder-stuck: ${F.capture()}`);
    const before = stubLog().length;
    const s = F.thread('While it asks');
    assert.equal(routed(s.U), 'supervisor', 'routed_to supervisor');
    assert.ok(F.stays(() => stubLog().slice(before), new RegExp(s.T)), 'not typed into the stuck stub');
    settle(s.T);
    steer('unprompt');
    for (let i = 0; i < 50 && F.finding('responder-stuck', 'responder'); i++) sleep(100);
    assert.equal(F.finding('responder-stuck', 'responder'), undefined, 'cleared once the prompt is gone');
  });

  await it('E14 a thread about a ticket with a live stub worker goes to the worker\'s pane; its reply counts; its handoff wakes wait and stays open', async () => {
    F.sup(['feature', 'add', 'checkout', '--json', JSON.stringify({ title: 'Checkout', goals: [F.goal], stories: [{ id: 'CO-S1', text: 'copy reads well', release: 'v1.0.0' }] })]);
    F.sup(['ticket', 'add', TICKET, '--json', JSON.stringify({ title: 'the checkout copy', feature: 'checkout', component: 'web', kind: 'build', size: 'S', risk: 'normal', serves: ['CO-S1'], depends_on: [], touches: ['src/**'], done_when: ['the copy test passes'] })]);
    const wt = path.join(F.old, '.worktrees', TICKET);
    F.g(['worktree', 'add', '-q', '-b', `ticket/${TICKET}`, wt, 'origin/main'], F.old);
    const W = { DEVTEAM_TICKET: TICKET, DEVTEAM_ROLE: 'worker' };
    const ph = F.run(['phase', 'build'], W);
    assert.equal(ph.status, 0, ph.err);
    const env = `DEVTEAM_HOME=${F.old} DEVTEAM_RUN=${run} DEVTEAM_TICKET=${TICKET} DEVTEAM_ROLE=worker`;
    assert.equal(F.tmux(['new-window', '-d', '-t', `=${F.session}:`, '-n', TICKET, '-c', wt, `env ${env} ${process.execPath} ${STUB}`]).status, 0);
    const wTarget = `=${F.session}:${TICKET}`;
    for (let i = 0; i < 300 && !(F.tmux(['capture-pane', '-p', '-t', wTarget]).stdout ?? '').includes(`stub ${TICKET} up`); i++) sleep(100);
    const keys = F.P.typed();
    const rBefore = stubLog().length;
    const m0 = measure();
    const n = F.thread('Checkout copy', `ticket:${TICKET}`);
    assert.deepEqual([routed(n.U), F.turn(n.U).routed_session], ['session', TICKET], `routed_to session ${TICKET}: ${JSON.stringify(F.turn(n.U))}`);
    const r = replyTo(n.T, n.U, 20000, TICKET);
    assert.ok(r, `the worker's reply lands in the thread; worker log:\n${stubLog(TICKET)}`);
    assert.match(stubLog(TICKET), new RegExp(`read \\[devteam thread ${n.T} from owner`), 'typed into the worker\'s pane');
    assert.doesNotMatch(stubLog().slice(rBefore), new RegExp(n.T), 'not the responder\'s');
    assert.doesNotMatch(F.P.typed().slice(keys.length), new RegExp(n.T), 'nor the supervisor\'s');
    // 31 s on: had the worker's reply not counted as the turn's first reply, the turn would read slow
    ahead(31000);
    const m1 = measure();
    assert.equal(Number(/owner turns: (\d+)/.exec(m1.lines[0])[1]), Number(/owner turns: (\d+)/.exec(m0.lines[0])[1]) + 1, `the measure counts the turn: ${m1.lines.join(' / ')}`);
    assert.equal(m1.lines.at(-1), m0.lines.at(-1), `and the worker's reply as its first: ${m0.lines.join(' / ')} then ${m1.lines.join(' / ')}`);
    const w = await waiting();
    try {
      const s = F.say(n.T, 'Please merge it when it is green.');
      assert.ok(replyTo(n.T, s.U, 20000, TICKET), `the worker replied; worker log:\n${stubLog(TICKET)}`);
      const h = JSON.parse(F.sup(['messages', '--open', '--to', 'supervisor', '--json'])).find((m) => m.kind === 'handoff' && m.thread === n.T);
      assert.ok(h, `the worker's handoff is open; worker log:\n${stubLog(TICKET)}`);
      assert.ok(await w.woke(MIN + 5000), `wait woke on it: ${w.out}`);
      assert.match(w.out, new RegExp(`message ${h.id}`));
      assert.match(F.sup(['messages', '--open', '--to', 'supervisor']), new RegExp(h.id), 'still open');
      F.sup(['thread', 'reply', n.T, '--', 'I will merge it once CI is green.']);
      assert.doesNotMatch(F.sup(['messages', '--open', '--to', 'supervisor']), new RegExp(h.id), 'settled by the supervisor\'s turn');
    } finally { w.stop(); }
  });

  await it('E15 in Chrome, the viewer open on the stub\'s chore-artifact draft reloads within 5 s of the stub editing it', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (tt) => {
    const later = cleanup(tt);
    const log = steer('draft demo');
    for (let i = 0; i < 100 && !/ran responder draft demo -> \d/.test(log()); i++) sleep(100);
    assert.match(log(), /ran responder draft demo -> 0/, `the stub drew its draft: ${log()}`);
    const draft = path.join(F.old, '.worktrees', 'chore-artifact-demo');
    assert.ok(fs.existsSync(path.join(draft, 'docs/devteam/project/artifacts/demo')), 'in its chore worktree');
    const e1 = steer('edit demo v1');
    for (let i = 0; i < 50 && !/edited /.test(e1()); i++) sleep(100);
    const { dash, port } = await dashboardOnFreePort(F.old, F.env({ DEVTEAM_ACCOUNTS_MS: '3600000' }));
    later(() => dash.stop());
    const chrome = await openChrome();
    later(() => chrome.close());
    const p = await chrome.newPage();
    later(() => p.close());
    await p.send('Page.enable');
    await p.send('Runtime.enable');
    // the lens's ready messages, with their titles and times: how the test sees a reload
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__titles = []; addEventListener('message', (e) => { const fr = document.getElementById('av-frame'); if (fr && e.source === fr.contentWindow && e.data?.lens === 1 && e.data.type === 'ready') window.__titles.push({ title: e.data.title, t: Date.now() }); });" });
    await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#artifact/wt/chore-artifact-demo/demo` });
    const until = async (expr, ms, what) => { const end = Date.now() + ms; for (;;) { let v; try { v = await p.ev(expr); } catch {} if (v) return v; if (Date.now() > end) assert.fail(`timed out: ${what}`); await new Promise((r) => setTimeout(r, 50)); } };
    await until("window.__titles?.some((x) => x.title === 'v1')", 30000, 'the draft at v1 in the viewer');
    const e2 = steer('edit demo v2');
    for (let i = 0; i < 100 && !/edited /.test(e2()); i++) sleep(20);
    // from the moment the file is written (the machine's clock, which the page reads too)
    const t0 = Date.now();
    await until(`window.__titles.some((x) => x.title === 'v2' && x.t >= ${t0 - 1000})`, 5000, 'the viewer reloaded to v2 within 5 s of the edit');
    tt.diagnostic('kit-107 E15 ran in Chrome');
  });

  await it('E16 with the responder\'s window killed, the next owner turn is the supervisor\'s, typed into its pane, and metrics shows responder-down', () => {
    T ??= opened('Release notes').T;
    F.down();
    assert.doesNotMatch(F.tmux(['list-windows', '-t', `=${F.session}`, '-F', '#W']).stdout, /^responder$/m, 'the window is gone, the fleet\'s session up');
    const s = F.say(T, 'Is anyone there?');
    assert.equal(s.line.routed_to, 'supervisor', 'routed_to supervisor');
    assert.equal(s.said, "sent to the supervisor's pane");
    assert.ok(F.reaches(F.P.typed, new RegExp(`\\[devteam thread ${T} from owner\\] Is anyone there\\?`)), 'typed into the supervisor\'s pane');
    assert.equal(F.finding('responder-down', 'responder')?.severity, 'medium', 'metrics shows responder-down');
  });
});
