// The artifact-notes contract (kit-143, log.schema.json@artifact-notes-1): who a note was handed to
// (thread.handed, the owner's), a session's mark that it addressed the note (message kind addressed),
// the kit's picture of a mark or of a ready (shot, noshot), its withdrawal (unready), and the
// frame the owner saw (frame). The kit reads and checks them; kit-144, kit-145 and kit-147 write them.
// The fake is test/fixtures/artifact-notes/: one folder per case (log/ and the expected.json its
// view must equal) and refused.json; build.mjs there writes them.
// Run: node --test test/artifact-notes-contract.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dashboardOnFreePort, testDir, threadsFixture } from './lib/kit.mjs';

const FAKE = path.join(testDir, 'fixtures', 'artifact-notes');
const REFUSED = JSON.parse(fs.readFileSync(path.join(FAKE, 'refused.json'), 'utf8'));
const SCHEMA = JSON.parse(fs.readFileSync(path.join(testDir, '..', 'docs', 'devteam', 'schema', 'log.schema.json'), 'utf8'));
const FOLDERS = fs.readdirSync(FAKE, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const expected = (f) => JSON.parse(fs.readFileSync(path.join(FAKE, f, 'expected.json'), 'utf8'));
const C1 = 'c01-handed';

// every file under a dir, by its path inside it, with its bytes
const filesOf = (root) => {
  const m = new Map();
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else m.set(path.relative(root, p), fs.readFileSync(p, 'utf8')); } };
  walk(root);
  return m;
};

test('artifact-notes-contract A1e: build.mjs writes exactly the committed fake', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-notes-build-'));
  try {
    const r = spawnSync(process.execPath, [path.join(FAKE, 'build.mjs'), out], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    const built = filesOf(out);
    const committed = filesOf(FAKE);
    committed.delete('build.mjs');
    assert.deepEqual([...built.keys()].sort(), [...committed.keys()].sort(), 'the same files');
    for (const [p, text] of built) assert.equal(committed.get(p), text, `${p} is as build.mjs writes it`);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

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

    await t.test('A1b-rules: what integrity and the byte rules refuse, by name', () => {
      const cases = Object.entries(REFUSED.cases).filter(([, c]) => c.task === 2);
      assert.ok(cases.length >= 25, `refused.json has the line checks' cases: ${cases.length}`);
      for (const [name, c] of cases) withLogs([C1], () => {
        const r = logCheck();
        assert.equal(r.status, 1, `${name}: log-check should refuse it: ${r.said}`);
        assert.match(r.said, new RegExp(c.why), name);
      }, [c]);
      // each read-only folder holds a line log-check refuses (else it belongs with the rest)
      for (const f of REFUSED.readOnly) withLogs([f], () => assert.equal(logCheck().status, 1, `${f} holds a line log-check refuses`));
    });

    await t.test('A1c: every reader drops a line integrity refuses', () => {
      const record = (id) => JSON.parse(F.ok(F.old, ['log', '--json', '--id', id]));
      const T1 = expected(C1).thread;
      const before = withLogs([C1], () => record(T1));
      assert.equal(before.length, 1, "c01's thread is read");
      const cases = Object.entries(REFUSED.cases).filter(([, c]) => c.readDropped);
      assert.ok(cases.length >= 20, `refused.json has the read-dropped cases: ${cases.length}`);
      for (const [name, c] of cases) withLogs([C1], () => {
        // a set line on c01's thread leaves it as it was; a new line (a thread, a message) is not read at all
        if (c.line.op === 'set') assert.deepEqual(record(T1), before, `${name}: the thread reads as without the line`);
        else assert.deepEqual(record(c.line.id), [], `${name}: no record ${c.line.id}`);
      }, [c]);
      // A2c by name: the supervisor's noshot with no ready leaves no noshot on the thread
      const a2c = REFUSED.cases['noshot without ready'];
      withLogs([C1], () => { const [x] = record(T1); assert.equal(x.noshot, undefined, 'no noshot'); assert.ok(!x.updates.some((u) => 'noshot' in u), 'no noshot update'); }, [a2c]);
    });
  } finally { F.done(); }
});

// each folder's log files appended into a fixture's live log
const placeLogs = (F, folders) => { for (const f of folders) for (const n of fs.readdirSync(path.join(FAKE, f, 'log'))) fs.appendFileSync(path.join(F.logDir, n), fs.readFileSync(path.join(FAKE, f, 'log', n))); };
// the view's note fields a case names, and with absent where it names none
const noteFieldsEqual = (got, want, what) => {
  for (const [k, v] of Object.entries(want)) assert.deepEqual(got[k], v, `${what}: ${k}`);
  if (!('with' in want)) assert.ok(!('with' in got), `${what}: no with (got ${JSON.stringify(got.with)})`);
};

test('artifact-notes-contract A2: each fixture\'s view, by thread show and thread list --waiting', () => {
  const F = threadsFixture('artifact-notes-view');
  try {
    for (const f of FOLDERS) {
      const snap = F.snapLog();
      try {
        placeLogs(F, [f]);
        const e = expected(f);
        const v = JSON.parse(F.ok(F.old, ['thread', 'show', e.thread, '--json']));
        noteFieldsEqual(v, e.view, f);
        assert.equal(v.source, null, `${f}: source`);
        const waiting = JSON.parse(F.ok(F.old, ['thread', 'list', '--waiting', '--json'])).map((x) => x.id);
        assert.equal(waiting.includes(e.thread), e.view.waiting === 'supervisor', `${f}: in thread list --waiting exactly when waiting is supervisor`);
      } finally { F.restoreLog(snap); }
    }
  } finally { F.done(); }
});

test('artifact-notes-contract A4: /api/threads carries the note fields, with no change to the dashboard server', async () => {
  const F = threadsFixture('artifact-notes-api');
  let dash = null;
  try {
    const folders = ['c11-ready-with-shot', 'c13-unready-after-addressed', 'c16-frame', 'c17-ready-noshot', 'c18-handed-to-supervisor', 'c02-handed-then-addressed'];
    placeLogs(F, folders);
    const started = await dashboardOnFreePort(F.old, F.env({}));
    dash = started.dash;
    const B = `http://127.0.0.1:${started.port}`;
    const r = await fetch(`${B}/api/threads`);
    assert.equal(r.status, 200);
    const threads = (await r.json()).threads;
    for (const f of folders) {
      const e = expected(f);
      const v = threads.find((x) => x.id === e.thread);
      assert.ok(v, `${f}: /api/threads lists ${e.thread}`);
      noteFieldsEqual(v, { ...(e.api ?? e.view), addressed: null }, `${f} (api)`);
      assert.equal(v.source, null, `${f}: source`);
    }
  } finally { if (dash) await dash.stop(); F.done(); }
});
