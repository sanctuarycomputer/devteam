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
  } finally { F.done(); }
});
