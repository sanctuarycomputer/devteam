// The artifact-notes contract (kit-143, log.schema.json@artifact-notes-1): who a note was handed to
// (thread.handed, the owner's), a session's mark that it addressed the note (message kind addressed),
// the supervisor's picture of a mark or of a ready (shot, noshot), its withdrawal (unready), and the
// frame the owner saw (frame). The kit reads and checks them; kit-144, kit-145 and kit-147 write them.
// The fake is test/fixtures/artifact-notes/: one folder per case (log/ and the expected.json its
// view must equal) and refused.json; build.mjs there writes them.
// Run: node --test test/artifact-notes-contract.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { testDir, threadsFixture } from './lib/kit.mjs';

const FAKE = path.join(testDir, 'fixtures', 'artifact-notes');
const REFUSED = JSON.parse(fs.readFileSync(path.join(FAKE, 'refused.json'), 'utf8'));
const SCHEMA = JSON.parse(fs.readFileSync(path.join(testDir, '..', 'docs', 'devteam', 'schema', 'log.schema.json'), 'utf8'));
const FOLDERS = fs.readdirSync(FAKE, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const expected = (f) => JSON.parse(fs.readFileSync(path.join(FAKE, f, 'expected.json'), 'utf8'));
const C1 = 'c01-handed';

test('artifact-notes-contract: the schema, the fake, and what log-check refuses', async (t) => {
  const F = threadsFixture('artifact-notes');
  try {
    const logCheck = () => { const r = F.run(F.old, ['log-check']); return { status: r.status, said: `${r.out}\n${r.err}` }; };
    // each folder's log files in the live log, appended to any file of the same name (ids are unique
    // across folders, and readers sort by at), and extra lines, each in its writer's file; fn runs on
    // that log, which is put back after
    const withLogs = (folders, fn, extra = []) => {
      const snap = F.snapLog();
      try {
        for (const f of folders) for (const n of fs.readdirSync(path.join(FAKE, f, 'log'))) fs.appendFileSync(path.join(F.logDir, n), fs.readFileSync(path.join(FAKE, f, 'log', n)));
        for (const { file, line } of extra) fs.appendFileSync(path.join(F.logDir, file), `${JSON.stringify(line)}\n`);
        return fn();
      } finally { F.restoreLog(snap); }
    };

    await t.test('A0: the schema carries artifact-notes-1', () => {
      const th = SCHEMA.$defs.types.thread;
      const ms = SCHEMA.$defs.types.message;
      for (const [ty, k] of [['thread', 'handed'], ['thread', 'shot'], ['thread', 'noshot'], ['thread', 'unready'], ['thread', 'frame'], ['message', 'draft'], ['message', 'shot']]) {
        const p = SCHEMA.$defs.types[ty].properties[k];
        assert.ok(p, `${ty}.${k} is in the schema`);
        assert.match(p.description, /^artifact-notes-1\. /, `${ty}.${k}'s description starts artifact-notes-1.`);
      }
      assert.ok(ms.properties.kind.enum.includes('addressed'), 'message.kind takes addressed');
      assert.match(ms.properties.kind.description, /artifact-notes-1[^.]*addressed[^.]*no reply/, 'the kind says an addressed message awaits no reply');
      assert.deepEqual(SCHEMA['x-authority'].set.thread, { owner: ['status', 'outcome', 'handed'], supervisor: ['ready', 'shot', 'noshot', 'unready'] });
      assert.deepEqual(th.properties.shot, ms.properties.shot, 'the two copies of shot are the same');
      for (const k of ['handed', 'shot', 'noshot', 'unready']) assert.ok(th['x-set-only'].includes(k), `thread.${k} is set-only`);
      assert.ok(!th['x-set-only'].includes('frame'), 'frame is on the new line');
      assert.match(th.description, /artifact-notes-1/);
      assert.match(ms.description, /artifact-notes-1/);
    });

    await t.test('A1a: log-check accepts every fixture, setting none of it aside', () => {
      for (const f of FOLDERS.filter((x) => !REFUSED.readOnly.includes(x))) withLogs([f], () => {
        const r = logCheck();
        assert.equal(r.status, 0, `${f}: ${r.said}`);
        assert.doesNotMatch(r.said, /newer kit/i, `${f}: ${r.said}`);
      });
    });

    await t.test('A1d: the valid shapes DW3 names pass', () => {
      for (const [name, c] of Object.entries(REFUSED.valid)) withLogs([C1], () => {
        const r = logCheck();
        assert.equal(r.status, 0, `${name}: ${r.said}`);
        assert.doesNotMatch(r.said, /newer kit/i, `${name}: ${r.said}`);
      }, [c]);
    });

    await t.test('A1b-auth: what the schema and its authority table refuse, by name', () => {
      const cases = Object.entries(REFUSED.cases).filter(([, c]) => c.task === 1);
      assert.ok(cases.length >= 30, `refused.json has the schema's cases: ${cases.length}`);
      for (const [name, c] of cases) withLogs([C1], () => {
        const r = logCheck();
        assert.equal(r.status, 1, `${name}: log-check should refuse it: ${r.said}`);
        assert.match(r.said, new RegExp(c.why), name);
      }, [c]);
    });
  } finally { F.done(); }
});
