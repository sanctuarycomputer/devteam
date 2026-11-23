// The responder end to end, first slice (kit-110; stories FT-S1 and FT-S3): `devteam.mjs responder`
// starts the owner's responder_command, here a stub agent (test/fixtures/responder-e2e/stub-responder.mjs)
// that answers each typed [devteam thread …] line with thread reply and hands a turn saying "merge"
// over with send supervisor --kind handoff --thread <t>. Through the kit's own routing, typing,
// wait, messages and metrics: an owner's turn gets the responder's reply within 10 s and nothing is
// typed into the supervisor's pane; a handed-over turn wakes a running wait and stays an open message
// until the supervisor answers in the thread; the goal's measure check reads 0 over 20 answered
// turns; and with the responder's window gone the next turn is the supervisor's, typed into its pane,
// with responder-down raised.
// Run: node --test test/responder-e2e.test.mjs (tmux, on a private TMUX_TMPDIR and a server of its own)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SUP, NO_TMUX, sleep, fixture } from './lib/responder-routing.mjs';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'responder-e2e');
const STUB = path.join(FIX, 'stub-responder.mjs');
const MEASURE = path.join(FIX, 'measure.sh');

test('the responder end to end (kit-110)', { skip: NO_TMUX, timeout: 280000 }, async (t) => {
  const F = fixture('responder-e2e');
  t.after(() => F.done());
  const supPane = () => F.tmux(['capture-pane', '-p', '-t', F.P.target]).stdout ?? '';
  const stubLog = () => { try { return fs.readFileSync(path.join(F.old, 'docs/devteam/run/stub-responder.log'), 'utf8'); } catch { return ''; } };
  // the responder's turn that came after the owner's turn U in thread T, waited for up to ms
  const replyTo = (T, U, ms) => {
    const end = Date.now() + ms;
    for (;;) {
      const ts = F.show(T).turns;
      const at = ts.find((u) => u.id === U)?.at;
      const r = at && ts.find((u) => u.writer === 'responder' && u.at > at);
      if (r || Date.now() > end) return r ? { ...r, ms: Date.parse(r.at) - Date.parse(at) } : null;
      sleep(100);
    }
  };
  // an owner's turn and the stub's reply to it; every case below waits for it before the next turn,
  // so the responder is idle for each and every turn is typed (never queued). The wait is long, so a
  // slow reply reaches the measure (E3) rather than failing here
  const answered = (T, words) => {
    const s = F.say(T, words);
    const r = replyTo(T, s.U, 45000);
    assert.ok(r, `the stub replied to ${s.U} (${words}); stub log:\n${stubLog()}`);
    return { ...s, reply: r };
  };
  const opened = (title) => {
    const n = F.thread(title);
    const r = replyTo(n.T, n.U, 20000);
    assert.ok(r, `the stub replied to ${n.T}'s first turn; stub log:\n${stubLog()}`);
    return n;
  };

  await t.test('E0 the stub is the owner\'s responder_command, started by devteam.mjs responder on a private tmux', () => {
    // the fixture's tmux is a server of its own: a private TMUX_TMPDIR, and no TMUX from the shell
    // running the tests (test/lib/kit.mjs drops it), which would reach that shell's server instead
    const e = F.env();
    assert.ok(/[\\/]dt-tmux-[^\\/]+$/.test(e.TMUX_TMPDIR ?? '') && !('TMUX' in e) && !('TMUX_PANE' in e), `a private TMUX_TMPDIR (${e.TMUX_TMPDIR}) and no TMUX (${e.TMUX})`);
    // the owner's setting, as their PR lands it: on main, pushed (a start reads origin's main)
    const sf = path.join(F.old, 'docs/devteam/project/settings.md');
    const text = fs.readFileSync(sf, 'utf8');
    const block = /```json devteam\s*\n([\s\S]*?)\n```/.exec(text);
    fs.writeFileSync(sf, text.replace(block[1], JSON.stringify({ ...JSON.parse(block[1]), responder_command: `${process.execPath} ${STUB}` }, null, 2)));
    F.g(['commit', '-qam', 'settings: responder_command'], F.old);
    F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
    // the fleet's session up first, holding a window of its own, so it outlives the responder's
    assert.equal(F.tmux(['new-session', '-d', '-x', '220', '-y', '50', '-s', F.session, '-n', 'hold', `${process.execPath} -e "setInterval(()=>{},1000)"`]).status, 0);
    const r = F.run(['responder'], SUP);
    assert.equal(r.status, 0, r.err || r.out);
    for (let i = 0; i < 300 && !F.capture().includes('stub responder up'); i++) sleep(100);
    assert.ok(F.capture().includes('stub responder up'), `the stub is up in the responder's window:\n${F.capture()}`);
    assert.match(stubLog(), /up in .*\.worktrees\/responder as responder /, 'it runs in the responder\'s worktree, as the responder');
  });

  let T;
  await t.test('E1 an owner\'s thread say gets the responder\'s turn within 10 s; the supervisor\'s pane is unchanged', () => {
    // its first turn answered first, so the responder is idle for the say; not asserted here, so a
    // turn that never reaches the responder fails on E1's own check below
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

  await t.test('E2 a turn the stub hands over wakes a running wait within 60 s; messages --open lists the handoff until a supervisor turn', async () => {
    const sinceFile = path.join(F.old, 'docs/devteam/run/wait-since');
    fs.writeFileSync(sinceFile, `${Date.now()}\n`);
    // wait's trace: one line per look (cycle 0 the first, before its loop), so the test knows the
    // loop is running before the owner's turn, and a late first look can't be what sees the handoff
    const trace = path.join(F.base, 'wait-trace.jsonl');
    const looks = () => { try { return fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };
    let out = '';
    const c = spawn(process.execPath, [F.DT, 'wait', '--minutes', '3'], { cwd: F.old, detached: true, env: F.env(F.withSup({ ...SUP, DEVTEAM_TEST_WAIT_CYCLE_MS: '1000', DEVTEAM_TEST_WAIT_TRACE: trace })) });
    c.stdout.on('data', (d) => { out += d; });
    const exited = new Promise((resolve) => c.on('exit', () => resolve(true)));
    try {
      for (let i = 0; i < 300 && looks() < 2 && c.exitCode === null; i++) await new Promise((resolve) => setTimeout(resolve, 100));
      assert.ok(looks() >= 2 && c.exitCode === null, `wait is in its loop before the turn (${looks()} looks): ${out}`);
      const s = answered(T, 'Please merge the release PR');
      assert.equal(s.line.routed_to, 'responder', 'the merge turn went to the responder first');
      const h = JSON.parse(F.sup(['messages', '--open', '--to', 'supervisor', '--json'])).find((m) => m.kind === 'handoff' && m.thread === T);
      // open, with the stub's own turn ("Passed to the supervisor") already after it in the thread:
      // only a supervisor's turn settles a handoff
      assert.ok(h, `the stub's handoff is open after the responder's turn; stub log:\n${stubLog()}`);
      // its report writes wait-since as it wakes: the wake's own time, whenever the test sees the exit
      const left = Date.parse(h.created_at) + 60000 - Date.now();
      const done = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve(false), Math.max(left, 0) + 5000))]);
      const at = done ? Number(fs.readFileSync(sinceFile, 'utf8')) : null;
      assert.ok(at && at - Date.parse(h.created_at) <= 60000, `wait returned within 60 s of the handoff (${at ? at - Date.parse(h.created_at) : 'no'} ms): ${out}`);
      assert.match(out, new RegExp(`something needs you:\\n\\s+message ${h.id}`), 'it woke on the handoff');
      assert.match(F.sup(['messages', '--open', '--to', 'supervisor']), new RegExp(`${h.id} \\[handoff\\] from responder`), 'still open after the wait woke');
      F.sup(['thread', 'reply', T, '--', 'Merging it now.']);
      assert.doesNotMatch(F.sup(['messages', '--open', '--to', 'supervisor']), new RegExp(h.id), 'settled by the supervisor\'s turn in that thread');
    } finally { try { process.kill(-c.pid, 'SIGKILL'); } catch {} }
  });

  await t.test('E3 the goal\'s measure check, on this log with 20 owner turns the stub answered, prints 0', () => {
    // 21 owner turns in all, each answered before the next: the three above and eighteen more. The
    // measure counts from the responder's first turn, so the first thread's opening turn, written
    // before it, is left out: 20 counted
    for (let i = 0; i < 4; i++) {
      const n = opened(`Question ${i + 1}`);
      for (let j = 0; j < (i === 0 ? 5 : 3); j++) answered(n.T, `follow-up ${j + 1} on question ${i + 1}`);
    }
    const all = JSON.parse(F.owner(['thread', 'list', '--all', '--json'])).flatMap((x) => x.turns.map((u) => ({ ...u, thread: x })));
    const owners = all.filter((u) => u.writer === 'owner');
    assert.equal(owners.length, 21, 'twenty-one owner turns');
    for (const u of owners) {
      const first = u.thread.turns.find((x) => x.writer !== 'owner' && x.at > u.at);
      assert.equal(first?.writer, 'responder', `the stub answered ${u.id} first`);
    }
    const r = spawnSync('sh', [MEASURE], { cwd: F.old, env: F.env(), encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines.at(-1), '0', `the measure prints 0: ${r.stdout}`);
    assert.match(lines[0], /^owner turns: 20 since the responder started, over 30 s: $/);
  });

  await t.test('E4 with the responder\'s window killed, the next owner turn is the supervisor\'s, typed into its pane, and metrics shows responder-down', () => {
    F.down();
    assert.doesNotMatch(F.tmux(['list-windows', '-t', `=${F.session}`, '-F', '#W']).stdout, /^responder$/m, 'the window is gone, the fleet\'s session up');
    const s = F.say(T, 'Is anyone there?');
    assert.equal(s.line.routed_to, 'supervisor', 'routed_to supervisor');
    assert.equal(s.said, "sent to the supervisor's pane");
    assert.ok(F.reaches(F.P.typed, new RegExp(`\\[devteam thread ${T} from owner\\] Is anyone there\\?`)), 'typed into the supervisor\'s pane');
    const f = F.finding('responder-down', 'responder');
    assert.equal(f?.severity, 'medium', 'metrics shows responder-down');
  });
});
