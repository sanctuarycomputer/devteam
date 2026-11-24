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
      assert.deepEqual(SCHEMA['x-authority'].set.thread, { owner: ['status', 'outcome', 'handed', 'person'], supervisor: ['ready', 'shot', 'noshot', 'unready'] });
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
    const folders = ['c11-ready-with-shot', 'c13-unready-after-addressed', 'c16-frame', 'c17-ready-noshot', 'c18-handed-to-supervisor', 'c02-handed-then-addressed', 'c33-noshot-then-mark', 'r8-bad-draft-and-unready'];
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

test('artifact-notes-contract A3: the readers of waiting (thread show and list, hello\'s counts, thread-waiting, thread-undelivered)', async (t) => {
  const F = threadsFixture('artifact-notes-readers');
  const MIN = 60000;
  const run = path.join(F.old, 'docs/devteam/run');
  const undelivered = path.join(run, 'undelivered-turns.json');
  const fresh = (fn) => () => { const snap = F.snapLog(); try { fn(); } finally { F.restoreLog(snap); fs.rmSync(undelivered, { force: true }); } };
  const ART = { kind: 'artifact', slug: 'pricing-mock', at: 'plan-pricing', path: 'index.html', anchor: { selector: '#trial', text: 'Start trial' } };
  // an artifact note (or, art false, a plain thread) with the owner's first turn agoMs back
  const note = (agoMs, { art = true } = {}) => {
    const T = F.hand('owner', { type: 'thread', title: 'Start trial', ...(art ? { subject: ART } : {}) }, agoMs + 1000);
    const U = F.hand('owner', { type: 'turn', thread: T, text: 'Say Start free trial.' }, agoMs);
    return { T, U };
  };
  const handTo = (T, to, agoMs) => { const at = new Date(Date.now() - agoMs).toISOString(); F.hand('owner', { id: T, op: 'set', type: 'thread', handed: { to, at } }, agoMs); };
  const findings = (kind) => JSON.parse(F.sup(['metrics', '--json'])).findings.filter((f) => f.kind === kind);
  try {
    await t.test('A3a: thread show and thread list say who has the note', fresh(() => {
      placeLogs(F, [C1]);
      const T = expected(C1).thread;
      assert.match(F.owner(['thread', 'show', T]).split('\n')[0], new RegExp(`^${T} · open · with plan-pricing$`));
      assert.match(F.owner(['thread', 'list']), new RegExp(`^${T} \\[open, with plan-pricing\\] `, 'm'));
    }));

    await t.test("A3b: hello's thread counts: with, and a note to check counted as ready", fresh(() => {
      placeLogs(F, ['c02-handed-then-addressed', 'c20-open-never-handed']);
      assert.deepEqual(JSON.parse(F.owner(['hello', '--json'])).threads, { you: 1, waiting: 0, ready: 1 }, 'none with a session: no with key');
      placeLogs(F, [C1]);
      assert.deepEqual(JSON.parse(F.owner(['hello', '--json'])).threads, { you: 1, waiting: 0, ready: 1, with: 1 });
    }));

    await t.test('A3c: thread-waiting on a note handed to the supervisor counts from the hand-over', fresh(() => {
      const { T } = note(60 * MIN);
      handTo(T, 'supervisor', 11 * MIN);
      const f = findings('thread-waiting').filter((x) => x.subject === T);
      assert.equal(f.length, 1, JSON.stringify(f));
      assert.match(f[0].detail, /^the owner handed this note over 11 min ago and has no reply$/);
      // its first turn since: at work, no finding
      F.hand('supervisor', { type: 'turn', thread: T, text: 'On it.' }, 5 * MIN);
      assert.deepEqual(findings('thread-waiting').filter((x) => x.subject === T), []);
    }));

    await t.test('A3c: a hand-over to the supervisor of a note already answered still waits on it', fresh(() => {
      const { T } = note(60 * MIN);
      F.hand('supervisor', { type: 'turn', thread: T, text: 'Which button?' }, 50 * MIN);
      handTo(T, 'supervisor', 12 * MIN);
      const f = findings('thread-waiting').filter((x) => x.subject === T);
      assert.equal(f.length, 1, JSON.stringify(f));
      assert.match(f[0].detail, /handed this note over 12 min ago/);
    }));

    await t.test('A3d: an old undelivered turn raises no thread-undelivered at a fresh hand-over; on a plain thread it does', fresh(() => {
      const a = note(30 * MIN);
      handTo(a.T, 'supervisor', 1 * MIN);
      const b = note(30 * MIN + 5000, { art: false });
      const ago = (ms) => new Date(Date.now() - ms).toISOString();
      fs.writeFileSync(undelivered, JSON.stringify({ [a.U]: { thread: a.T, at: ago(30 * MIN) }, [b.U]: { thread: b.T, at: ago(30 * MIN + 5000) } }));
      const f = findings('thread-undelivered').map((x) => x.subject);
      assert.ok(f.includes(b.T), `the plain thread's undelivered turn is found: ${f.join(', ')}`);
      assert.ok(!f.includes(a.T), `the handed note raises none: ${f.join(', ')}`);
    }));
  } finally { F.done(); }
});

test('artifact-notes-contract A5: supervisor.md states the contract, and every expected.json fits its shape', () => {
  const doc = fs.readFileSync(path.join(testDir, '..', 'docs', 'devteam', 'process', 'supervisor.md'), 'utf8');
  const heads = [...doc.matchAll(/^(#{2,3}) (.+)$/gm)].map((m) => ({ level: m[1].length, title: m[2], at: m.index }));
  const k = heads.findIndex((h) => h.title === 'Artifacts: pages that show an idea');
  assert.ok(k >= 0, 'the Artifacts part');
  assert.deepEqual([heads[k + 1]?.level, heads[k + 1]?.title], [3, 'Artifact notes'], '### Artifact notes comes right after it');
  const end = heads[k + 2]?.at ?? doc.length;
  assert.equal(heads[k + 2]?.level, 2, 'and is the last part of its section');
  const sec = doc.slice(heads[k + 1].at, end);
  for (const s of ['- `handed` `{to, at}`', '- `addressed` `{by, at, note, sha, draft}`', '- `check`:', '- `shot`:', '`noshot` is `\'no-change\'`', '- `unready` `{at, reason}`', '- `frame` `{w, h, hash}`', '- `source`:', "'owner'", "'supervisor'", "'session'", '`with` names `handed.to`', 'last word', '/api/shot/<t-id>/<stamp>-<light|dark>.png', 'is a 404', 'frame {w, h, hash}', 'thread-new', 'artifact-handoff {slug, at}', '{to, typed, count}', 'thread-accept-addressed {id, at}', 'The note changed; read it again', 'artifact notes <slug> --json'])
    assert.ok(sec.includes(s), `the section names ${s}`);
  assert.match(sec, /^resolved; to check; with <session>; open$/m, 'the state order, as one line');
  assert.match(sec, /kit-144[^.]*kit-147[^.]*release|release[^.]*kit-144[^.]*kit-147/, 'the release rule');
  assert.match(sec, /addressed[^.]*no reply/, 'an addressed message awaits no reply');
  assert.match(sec, /until Hand over[^.]*unread/, "the rule until Hand over ships (design-change 1 B)");
  const blocks = [...sec.matchAll(/^```json\n([\s\S]*?)^```$/gm)].map((m) => JSON.parse(m[1]));
  assert.equal(blocks.length, 2, 'two json blocks: the view\'s note fields, and artifact notes --json');
  const [fields, notes] = blocks;
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  for (const f of FOLDERS) {
    const e = expected(f);
    for (const [part, o] of [['view', e.view], ['api', e.api ?? {}]]) for (const [key, v] of Object.entries(o)) {
      assert.ok(Object.hasOwn(fields, key), `${f} ${part}.${key} is a field the doc names`);
      if (v !== null) assert.equal(typeOf(v), typeOf(fields[key]), `${f} ${part}.${key} has the doc's type`);
    }
  }
  assert.ok(Array.isArray(notes) && notes.length === 1, 'artifact notes --json is an array of notes');
  assert.deepEqual(Object.keys(notes[0]), ['id', 'path', 'state', 'title', 'subject', 'turns', 'handed', 'addressed', 'check', 'shot', 'noshot', 'unready', 'frame', 'source']);
});
