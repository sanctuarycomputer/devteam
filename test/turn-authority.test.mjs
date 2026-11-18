// Turn authority (kit-101): what the owner tells the supervisor in a thread carries the weight of
// telling it in its terminal. The supervisor asks about a turn (thread ask --turn), answers from
// whole clauses of it (answer --from-turn --said), records a correction from it (correct
// --from-turn --said, or --from-chat --said), and metrics checks every such binding after the fact.
// The contract is log.schema.json@turn-authority-1; its fake is test/fixtures/turn-authority/lines.json.
// Run: node --test test/turn-authority.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { testDir, threadsFixture } from './lib/kit.mjs';

const FAKE = JSON.parse(fs.readFileSync(path.join(testDir, 'fixtures', 'turn-authority', 'lines.json'), 'utf8'));

test('turn authority', async (t) => {
  const F = threadsFixture('turn-authority');
  try {
    // the fake's lines, written as their writers' files for their month
    const writeLines = (lines) => {
      for (const l of lines) fs.appendFileSync(path.join(F.logDir, `${l.by}-${l.at.slice(0, 7)}.jsonl`), `${JSON.stringify(l)}\n`);
    };
    const logCheck = () => { const r = F.run(F.old, ['log-check']); return { status: r.status, said: `${r.out}\n${r.err}` }; };
    // every log file, as bytes: a refused command leaves each exactly as it was, and adds none
    const logBytes = () => new Map(fs.readdirSync(F.logDir).map((f) => [f, fs.readFileSync(path.join(F.logDir, f))]));
    const refused = (args, why, role = F.SUP) => {
      const before = logBytes();
      const said = F.fails(args, role);
      assert.match(said, why, args.join(' '));
      const after = logBytes();
      assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), `${args.join(' ')}: no log file is added`);
      for (const [f, b] of before) assert.ok(b.equals(after.get(f)), `${args.join(' ')}: ${f} is unchanged`);
      return said;
    };
    // the raw lines for a record, as written
    const raw = (id) => fs.readdirSync(F.logDir).flatMap((f) => fs.readFileSync(path.join(F.logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))).filter((l) => l.id === id).sort((a, b) => a.at.localeCompare(b.at));
    const show = (T) => JSON.parse(F.owner(['thread', 'show', T, '--json']));
    const thread = (title, words) => { const T = F.owner(['thread', 'new', '--title', title, '--', words]).split('\n')[0]; return { T, U: show(T).turns[0].id }; };
    const say = (T, words) => F.owner(['thread', 'say', T, '--', words]).split('\n')[0];
    const q = (words) => ['--question', words, '--recommendation', 'Yes', '--goal', F.goal, '--stake', '1', '--urgency', '1'];
    const askAbout = (T, U, words, more = []) => F.sup(['thread', 'ask', T, '--turn', U, ...q(words), ...more]);
    const answer = (Q, U, said, more = []) => ['answer', Q, 'Yes', '--from-turn', U, '--said', said, ...more];
    // the held remediation A13 lifts, answered in the answers' subtest (A13, A24)
    let held = null;

    await t.test('the fake: log-check accepts its log and refuses each of its refused lines', () => {
      const snap = F.snapLog();
      try {
        writeLines(FAKE.log);
        const ok = logCheck();
        assert.equal(ok.status, 0, ok.said);
        for (const { line, why } of FAKE.refused) {
          const inner = F.snapLog();
          try {
            writeLines([line]);
            const r = logCheck();
            assert.notEqual(r.status, 0, `log-check should refuse ${JSON.stringify(line)}`);
            assert.match(r.said, new RegExp(why), JSON.stringify(line));
          } finally { F.restoreLog(inner); }
        }
      } finally { F.restoreLog(snap); }
    });

    await t.test('thread ask --turn: about the owner\'s turn, in its thread, with what came after it read (A1, A3, A4, A7)', () => {
      const words = 'Merge the dashboard PR. Then tell the team.';
      const { T, U } = thread('Dashboard PR', words);
      const Q = askAbout(T, U, 'Merge the dashboard PR now?');
      const [line] = raw(Q);
      assert.deepEqual([line.thread, line.about_turn, line.seen], [T, U, U]);
      const turn = show(T).turns.find((x) => x.question === Q);
      assert.equal(turn.text, `About your message: "${words}"\nMerge the dashboard PR now?`);
      // a long turn: its first 80 characters, whitespace collapsed, never half a surrogate pair
      const long = `${'🚀'.repeat(79)}   and\nthe rest of a long message`;
      const { T: TL, U: UL } = thread('Long', long);
      const QL = askAbout(TL, UL, 'Ship it?');
      assert.equal(show(TL).turns.find((x) => x.question === QL).text, `About your message: "${'🚀'.repeat(79)} …"\nShip it?`);
      // the turn must be the owner's, and in this thread (A3, A4)
      const S = F.sup(['thread', 'reply', T, 'Looking.']);
      refused(['thread', 'ask', T, '--turn', S, ...q('About that?')], /that turn is the supervisor's/);
      const { T: T2, U: U2 } = thread('Elsewhere', 'Ship the banner.');
      refused(['thread', 'ask', T, '--turn', U2, ...q('About that?')], new RegExp(`that turn is in ${T2}, not ${T}`));
      refused(['thread', 'ask', T, '--turn', 'u-20990101-000000000-owner', ...q('About that?')], /no such turn/);
      refused(['thread', 'ask', T, '--turn', 'nonsense', ...q('About that?')], /--turn <u-id>/);
      // its flags go with --turn, and plain ask takes none of them (A3)
      refused(['thread', 'ask', T, '--seen-turn', U, ...q('x?')], /--seen-turn goes with --turn/);
      refused(['thread', 'ask', T, '--at', '0', ...q('x?')], /--at goes with/);
      refused(['thread', 'ask', T, '--turn', U, '--at', '0', ...q('x?')], /--at goes with/);
      refused(['ask', '--turn', U, ...q('x?')], /thread ask <t-id> --turn/);
      refused(['ask', '--seen-turn', U, ...q('x?')], /thread ask <t-id> --turn/);
      refused(['ask', '--at', '0', ...q('x?')], /thread ask <t-id> --turn/);
      // later owner turns are read first (A7): printed, and refused without --seen-turn naming the newest
      const later = say(T, 'No, hold off until CI is green.');
      for (const extra of [[], ['--seen-turn', U]]) {
        const said = refused(['thread', 'ask', T, '--turn', U, ...q('Merge it?'), ...extra], /the owner wrote in .* after/);
        assert.match(said, new RegExp(later));
        assert.match(said, /No, hold off until CI is green\./);
      }
      const Q2 = askAbout(T, U, 'Merge it?', ['--seen-turn', later]);
      assert.deepEqual([raw(Q2)[0].about_turn, raw(Q2)[0].seen], [U, later]);
      // --seen-turn must name the newest owner turn even when nothing came after
      refused(['thread', 'ask', T, '--turn', later, ...q('x?'), '--seen-turn', U], /newest owner turn .* is/);
      // the supervisor alone asks
      refused(['thread', 'ask', T, '--turn', U, ...q('x?')], /supervisor/, { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'demo-01-x' });
    });

    await t.test('thread ask --turn --owner-said: a held remediation, lifted only by a whole clause said after the no (A13)', () => {
      const sf = path.join(F.old, 'docs/devteam/project/settings.md');
      fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"resume_command":', `"remediations": { "restart-web": { "kind": "restart", "script": "project/remediations/restart.mjs", "sha": "${'a'.repeat(40)}" } }, "resume_command":`));
      F.g(['add', '-A'], F.old);
      F.g(['commit', '-qm', 'a remediation'], F.old);
      F.g(['push', '-q', 'origin', 'main'], F.old);
      const rem = ['--class', 'production-remediation', '--blocks', 'remediation:restart-web', '--recommendation', 'restart it'];
      const { T, U: before } = thread('Restart', 'Restart it.');
      const Qno = F.sup(['ask', '--question', 'Restart web?', ...rem]);
      F.owner(['answer', Qno, 'no']);
      const words = 'Restart it now, the fix is in. Then tell me.';
      const U = say(T, words);
      const ask = (turn, said, more = []) => ['thread', 'ask', T, '--turn', turn, '--question', 'Restart web again?', ...rem, '--owner-said', said, ...more];
      // the turn before the no lifts nothing; a part clause, words not in the turn, or another class are refused
      refused(ask(before, 'Restart it.', ['--seen-turn', U]), /older than the owner's no/);
      refused(ask(U, 'Restart it now'), /part of a clause/);
      refused(ask(U, 'Restart it later.'), /isn't in the turn/);
      refused(['thread', 'ask', T, '--turn', U, ...q('Tell them?'), '--owner-said', 'Then tell me.'], /--owner-said .* production-remediation/);
      refused(['thread', 'ask', T, '--turn', U, '--kind', 'trust', '--question', 'Trust restarts?', ...rem, '--owner-said', 'Then tell me.'], /not a trust or proposal/);
      // still held without it
      refused(['thread', 'ask', T, '--turn', U, '--question', 'Restart web again?', ...rem], /stays held/);
      const Q = F.sup(ask(U, 'Restart it  now, the fix\nis in.'));
      const [line] = raw(Q);
      assert.deepEqual([line.owner_said, line.owner_said_turn, line.owner_said_at, line.about_turn], ['Restart it now, the fix is in.', U, [0, 30], U]);
      assert.match(line.context, /The owner said: Restart it now, the fix is in\./);
      held = { T, U, Q };
    });

    await t.test('answer --from-turn --said: whole clauses of the turn the question is about, one span for one thing (A1-A6, A8-A10, A12, A13, A23, A24)', () => {
      const words = 'Merge the dashboard PR. Then tell the team.';
      const { T, U } = thread('Dashboard PR', words);
      const Q1 = askAbout(T, U, 'Merge the dashboard PR now?');
      const Q2 = askAbout(T, U, 'Tell the team?');
      // A2: a part clause, words not there, or a ? left out
      refused(answer(Q1, U, 'Merge the dashboard'), /part of a clause; give the whole clause: "Merge the dashboard PR\."/);
      refused(answer(Q1, U, 'Merge the PR.'), /isn't in the turn/);
      // A3: the question must be about this turn; flags without --said are refused
      const U2 = say(T, 'And the docs.');
      refused(answer(Q1, U2, 'And the docs.'), /wasn't asked about that turn.*thread ask/);
      const Qplain = F.sup(['thread', 'ask', T, ...q('Plain?')]);
      refused(answer(Qplain, U, 'Merge the dashboard PR.'), /wasn't asked about that turn.*thread ask/);
      refused(['answer', Q1, 'Yes', '--from-turn', U, '--at', '0'], /--at goes with --said/);
      refused(['answer', Q1, 'Yes', '--from-turn', U, '--seen-turn', U2], /--seen-turn goes with --said/);
      // A4: the supervisor's own turn never binds
      const S = F.sup(['thread', 'reply', T, 'Looking.']);
      refused(answer(Q1, S, 'Looking.'), /that turn is the supervisor's/);
      // A8: what the owner wrote after the question's seen is read first
      const said = refused(answer(Q1, U, 'Merge the dashboard PR.'), /the owner wrote in .* after/);
      assert.match(said, new RegExp(U2));
      assert.match(said, /And the docs\./);
      refused(answer(Q1, U, 'Merge the dashboard PR.', ['--seen-turn', U]), /the owner wrote in .* after/);
      // A1: the answer line, and the answer stands
      F.sup(answer(Q1, U, 'Merge the dashboard PR.', ['--seen-turn', U2]));
      const line = raw(Q1).find((l) => l.op === 'set' && l.answer !== undefined);
      assert.deepEqual([line.by, line.channel, line.said, line.said_at, line.turn, line.answer_seen], ['owner', 'thread', 'Merge the dashboard PR.', [0, 23], U, U2]);
      const v = JSON.parse(F.owner(['questions', '--id', Q1, '--json']))[0];
      assert.deepEqual([v.status, v.matched, v.channel, v.said, v.turn, v.said_at, v.answer_seen, v.about_turn, v.seen], ['answered', true, 'thread', 'Merge the dashboard PR.', U, [0, 23], U2, U, U]);
      // A5: the same span, or one that contains it, is refused; A9: the other clause settles Q2
      refused(answer(Q2, U, 'Merge the dashboard PR.', ['--seen-turn', U2]), /overlap what already settled/);
      refused(answer(Q2, U, words, ['--seen-turn', U2]), /overlap what already settled/);
      F.sup(answer(Q2, U, 'Then tell the team.', ['--seen-turn', U2]));
      assert.deepEqual(raw(Q2).find((l) => l.answer !== undefined).said_at, [24, 43]);
      assert.equal(JSON.parse(F.owner(['questions', '--id', Q2, '--json']))[0].status, 'answered');
      // A6: a clause-bound turn takes no whole-turn answer, and a whole-turn-bound one takes no clause
      const Qw = F.sup(['thread', 'ask', T, ...q('Whole?')]);
      const W = say(T, 'Yes to that.');
      refused(['answer', Qw, 'Yes', '--from-turn', U], /already settled/);
      F.sup(['answer', Qw, 'Yes', '--from-turn', W]);
      const Qc = askAbout(T, W, 'About yes?');
      refused(answer(Qc, W, 'Yes to that.'), /already settled .* whole/);
      // A2 again, on fresh turns: a clause inside another, and a ? never left out; a closing . may be
      const { T: T3, U: U3 } = thread('Hold', "Don't merge it yet. Ship it? Or wait for CI?");
      const Q3 = askAbout(T3, U3, 'Merge?');
      refused(answer(Q3, U3, 'merge it'), /part of a clause/);
      refused(answer(Q3, U3, 'Ship it'), /part of a clause; give the whole clause: "Ship it\?"/);
      const { T: T4, U: U4 } = thread('No stop', 'Merge the dashboard PR.');
      F.sup(answer(askAbout(T4, U4, 'Merge the PR, no full stop?'), U4, 'Merge the dashboard PR'));
      assert.deepEqual(raw(show(T4).questions[0].id).find((l) => l.answer !== undefined).said_at, [0, 22]);
      // A10: a repeated clause needs --at
      const { T: T5, U: U5 } = thread('Twice', 'Ship it. Wait. Ship it.');
      const Q5 = askAbout(T5, U5, 'Ship?');
      refused(answer(Q5, U5, 'Ship it.'), /2 times, at offsets 0, 15; pick one with --at/);
      refused(answer(Q5, U5, 'Ship it.', ['--at', '3']), /no match .* starts at offset 3/);
      refused(answer(Q5, U5, 'Ship it.', ['--at', 'x']), /--at <offset>/);
      F.sup(answer(Q5, U5, 'Ship it.', ['--at', '15']));
      assert.deepEqual(raw(Q5).find((l) => l.answer !== undefined).said_at, [15, 23]);
      // A23: whitespace and a character outside the BMP between the words: the raw slice, UTF-16 offsets
      const { T: T6, U: U6 } = thread('Rocket', 'Ship  the\nbanner 🚀 now. Then stop.');
      F.sup(answer(askAbout(T6, U6, 'Ship the rocket banner?'), U6, 'Ship the banner 🚀 now.'));
      const l6 = raw(show(T6).questions[0].id).find((l) => l.answer !== undefined);
      assert.deepEqual([l6.said, l6.said_at], ['Ship  the\nbanner 🚀 now.', [0, 24]]);
      // A12: goal decide takes the whole turn only
      const A = F.approval();
      for (const extra of [['--said', 'approve it'], ['--at', '0'], ['--seen-turn', U]]) refused(['goal', 'decide', A.goal, 'approve', '--from-turn', U, ...extra], /goal decide --from-turn takes the whole turn/);
      // A13: the lifted remediation is answered from the same clause; lifting it bound nothing
      F.sup(answer(held.Q, held.U, 'Restart it now, the fix is in.'));
      assert.equal(JSON.parse(F.owner(['questions', '--id', held.Q, '--json']))[0].status, 'answered');
      // A24: an older kit drops the creation-only fields; the answer still stands there, same hash
      for (const id of [Q1, held.Q]) {
        const before = JSON.parse(F.owner(['questions', '--id', id, '--json']))[0];
        const snap = F.snapLog();
        try {
          for (const file of fs.readdirSync(F.logDir).filter((x) => x.startsWith('supervisor-'))) {
            const p = path.join(F.logDir, file);
            fs.writeFileSync(p, fs.readFileSync(p, 'utf8').split('\n').map((l) => { if (!l.includes(`"id":"${id}"`)) return l; const o = JSON.parse(l); if (o.op !== 'new') return l; for (const k of ['about_turn', 'seen', 'owner_said_turn', 'owner_said_at']) delete o[k]; return JSON.stringify(o); }).join('\n'));
          }
          const after = JSON.parse(F.owner(['questions', '--id', id, '--json']))[0];
          assert.equal(after.about_turn, null, 'the fields are gone');
          assert.deepEqual([after.status, after.hash], ['answered', before.hash], id);
        } finally { F.restoreLog(snap); }
      }
    });
  } finally { F.done(); }
});
