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
      // still held without it
      refused(['thread', 'ask', T, '--turn', U, '--question', 'Restart web again?', ...rem], /stays held/);
      const Q = F.sup(ask(U, 'Restart it  now, the fix\nis in.'));
      const [line] = raw(Q);
      assert.deepEqual([line.owner_said, line.owner_said_turn, line.owner_said_at, line.about_turn], ['Restart it now, the fix is in.', U, [0, 30], U]);
      assert.match(line.context, /The owner said: Restart it now, the fix is in\./);
    });
  } finally { F.done(); }
});
