// The responder's contract (kit-102, responder-1): the responder writes turns, handoff and info
// messages and its own observations, and nothing else; integrity refuses the rest, so every reader
// drops such a line, not only log-check. The contract is log.schema.json@responder-1; its fake is
// test/fixtures/responder/ (log/, an accepted log, and refused.json, one line per refusal).
// Run: node --test test/responder-contract.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { testDir, threadsFixture } from './lib/kit.mjs';

const FAKE = path.join(testDir, 'fixtures', 'responder');
const FAKE_LOG = path.join(FAKE, 'log');
const REFUSED = JSON.parse(fs.readFileSync(path.join(FAKE, 'refused.json'), 'utf8')).cases;
const SCHEMA = JSON.parse(fs.readFileSync(path.join(testDir, '..', 'docs', 'devteam', 'schema', 'log.schema.json'), 'utf8'));
const fakeLines = fs.readdirSync(FAKE_LOG).flatMap((f) => fs.readFileSync(path.join(FAKE_LOG, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));

test('responder-contract A1: the fake, its refusals by name, and readers dropping refused lines', async (t) => {
  const F = threadsFixture('responder-contract');
  try {
    const logCheck = () => { const r = F.run(F.old, ['log-check']); return { status: r.status, said: `${r.out}\n${r.err}` }; };
    // the fake's files in the live log, by their own names, for fn; taken out again after
    const withFake = (fn) => {
      const snap = F.snapLog();
      try {
        for (const f of fs.readdirSync(FAKE_LOG)) fs.copyFileSync(path.join(FAKE_LOG, f), path.join(F.logDir, f));
        return fn();
      } finally { F.restoreLog(snap); }
    };

    await t.test('A1a: log-check accepts the fake, setting none of it aside', () => withFake(() => {
      const r = logCheck();
      assert.equal(r.status, 0, r.said);
      assert.doesNotMatch(r.said, /newer kit/i, r.said);
      const ids = fakeLines.map((l) => l.id);
      for (const l of r.said.split('\n').filter((x) => /ignored:/.test(x))) for (const id of ids) assert.ok(!l.includes(id), `log-check sets ${id} aside: ${l}`);
    }));

    await t.test('A1b: each refused line fails log-check with its words', () => withFake(() => {
      for (const c of REFUSED) {
        const r = F.checkWith([c.line.by, c.line, c.file]);
        assert.notEqual(r.status, 0, `${c.name}: log-check should refuse it`);
        assert.match(r.said, new RegExp(c.why), c.name);
      }
    }));

    await t.test('A1d: each repaired line passes, and the fake covers every type the responder creates', () => withFake(() => {
      for (const c of REFUSED) {
        const r = F.checkWith([c.repaired.by, c.repaired, c.file]);
        assert.equal(r.status, 0, `${c.name}: its repaired line should pass: ${r.said}`);
      }
      const made = new Set(fakeLines.filter((l) => l.by === 'responder' && l.op === 'new').map((l) => l.type));
      for (const ty of SCHEMA['x-authority'].new.responder) assert.ok(made.has(ty), `the fake has a responder ${ty} line`);
    }));

    await t.test('A1c: readers drop the refused lines and keep their repaired twins', () => {
      const snap = F.snapLog();
      try {
        const T = F.owner(['thread', 'new', '--title', 'Header colour', '--', 'Make the header darker.']).split('\n')[0];
        // the worker's review-request to the supervisor, sent first
        const worker = { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'kit-9-probe' };
        const sent = F.run(F.old, ['send', 'supervisor', 'review please', '--kind', 'review-request'], worker);
        assert.equal(sent.status, 0, `the worker's send: ${sent.err || sent.out}`);
        assert.match(sent.out, /^m-\S+-kit-9-probe$/m, `the worker's send prints its id: ${sent.out}`);
        const req = sent.out.match(/^m-\S+-kit-9-probe$/m)[0];
        // fresh ids, one per line: <prefix>-<yyyymmdd>-<hhmmssmmm>-<writer>, a millisecond apart
        const base = Date.now() - 30000;
        let n = 0;
        const fresh = (o) => {
          const d = new Date(base + n++);
          return `${o.id.split('-')[0]}-${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}-${o.by}`;
        };
        const place = (o, c) => {
          const x = { ...o, id: fresh(o) };
          delete x.at;
          if (x.type === 'turn') x.thread = T;
          if (c.name === 'responder info with re' && x.re) x.re = req;
          F.hand(x.by, x, 20000 - n, c.file);
          return x.id;
        };
        const named = ['responder turn with question', 'routed_to on a supervisor turn', 'responder observation finding-ack', 'responder message blocked', 'responder info with re'];
        const cases = Object.fromEntries(named.map((nm) => [nm, REFUSED.find((c) => c.name === nm)]));
        for (const nm of named) assert.ok(cases[nm], `refused.json has "${nm}"`);
        const bad = Object.fromEntries(named.map((nm) => [nm, place(cases[nm].line, cases[nm])]));
        const twin = Object.fromEntries(named.map((nm) => [nm, place(cases[nm].repaired, cases[nm])]));

        const turns = JSON.parse(F.owner(['thread', 'show', T, '--json'])).turns.map((u) => u.id);
        const found = (id) => F.run(F.old, ['record', id]).status === 0;
        const open = () => JSON.parse(F.owner(['messages', '--open', '--to', 'supervisor', '--json'])).map((m) => m.id);

        // the refused lines: no reader takes them
        assert.ok(!turns.includes(bad['responder turn with question']), 'thread show drops the responder turn with question');
        assert.ok(!turns.includes(bad['routed_to on a supervisor turn']), 'thread show drops the supervisor turn with routed_to');
        for (const nm of ['responder observation finding-ack', 'responder message blocked', 'responder info with re', 'responder turn with question', 'routed_to on a supervisor turn']) assert.ok(!found(bad[nm]), `record finds no "${nm}" line`);
        const o = open();
        assert.ok(o.includes(req), `the worker's request stays open: ${o.join(', ')}`);
        assert.ok(!o.includes(bad['responder message blocked']), 'the blocked message is not open');

        // the control: each repaired twin, written the same way, is read
        assert.ok(turns.includes(twin['responder turn with question']), "thread show lists the responder's repaired turn");
        assert.ok(turns.includes(twin['routed_to on a supervisor turn']), "thread show lists the supervisor's repaired turn");
        for (const nm of named) assert.ok(found(twin[nm]), `record finds the repaired "${nm}" line`);

        // task-2 review: readers drop a handoff whose thread is null (no type check in readers),
        // and the responder's observations of kind discovery or with a detector (acted on by readers)
        const nullThread = place({ ...cases['responder message blocked'].repaired, kind: 'handoff', thread: null }, cases['responder message blocked']);
        const discovery = place({ ...cases['responder observation finding-ack'].repaired, kind: 'discovery', subject: 'sensors' }, cases['responder observation finding-ack']);
        const detector = place({ ...cases['responder observation finding-ack'].repaired, kind: 'exception', detector: 'sensor' }, cases['responder observation finding-ack']);
        for (const [what, id] of [['a handoff with thread null', nullThread], ['a responder discovery observation', discovery], ['a responder observation with a detector', detector]]) assert.ok(!found(id), `record finds no ${what}`);
        assert.ok(!open().includes(nullThread), 'the null-thread handoff is not open');
      } finally { F.restoreLog(snap); }
    });
  } finally { F.done(); }
});
