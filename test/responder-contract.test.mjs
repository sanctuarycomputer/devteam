// The responder's contract (kit-102, responder-1): the responder writes turns, handoff and info
// messages and its own observations, and nothing else; integrity refuses the rest, so every reader
// drops such a line, not only log-check. The contract is log.schema.json@responder-1; its fake is
// test/fixtures/responder/ (log/, an accepted log, and refused.json, one line per refusal).
// Run: node --test test/responder-contract.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { dashboardOnFreePort, testDir, threadsFixture } from './lib/kit.mjs';

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
        // final-1 F1: metrics' line-pressure counts footprint-refusal observations by kind, from any writer
        const footprint = place({ ...cases['responder observation finding-ack'].repaired, kind: 'footprint-refusal', subject: 'kit' }, cases['responder observation finding-ack']);
        for (const [what, id] of [['a handoff with thread null', nullThread], ['a responder discovery observation', discovery], ['a responder observation with a detector', detector], ['a responder footprint-refusal observation', footprint]]) assert.ok(!found(id), `record finds no ${what}`);
        assert.ok(!open().includes(nullThread), 'the null-thread handoff is not open');
      } finally { F.restoreLog(snap); }
    });
  } finally { F.done(); }
});

// every file under each dir (recursively), by path: size and sha256; a dir that isn't there is empty
const hashDirs = (dirs) => {
  const m = new Map();
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { const b = fs.readFileSync(p); m.set(p, `${b.length}:${crypto.createHash('sha256').update(b).digest('hex')}`); }
    }
  };
  for (const d of dirs) walk(d);
  return m;
};
const RESPONDER = { DEVTEAM_ROLE: 'responder' };

test('responder-contract A2: the responder is its own writer, and is refused the supervisor\'s commands', async (t) => {
  const F = threadsFixture('responder-a2');
  try {
    // as the supervisor first: a goal (the fixture's), a question, a thread with an owner turn, a decision
    const q = F.sup(['ask', '--question', 'Ship it?', '--goal', F.goal, '--stake', '1', '--urgency', '1', '--recommendation', 'Yes']).split('\n')[0];
    const T = F.owner(['thread', 'new', '--title', 'Header colour', '--', 'Make the header darker.']).split('\n')[0];
    F.sup(['decide', '--class', 'rename-column', '--', 'renamed a column']);
    const wt = path.join(F.base, 'wt-r');
    F.g(['worktree', 'add', '-q', '--detach', wt], F.old);
    const R = (args, extra = {}) => F.run(wt, args, { ...RESPONDER, ...extra });

    await t.test('A2a: whoami in a detached worktree says writer=responder, with DEVTEAM_TICKET set too', () => {
      for (const extra of [{}, { DEVTEAM_TICKET: 'kit-9-probe' }]) {
        const r = R(['whoami'], extra);
        assert.equal(r.status, 0, r.err);
        assert.match(r.out, /# writer=responder\b/, r.out);
        // the worktree's live log is the main checkout's (runDir from mainRoot), F.logDir
        assert.equal(fs.realpathSync(r.out.match(/^DEVTEAM_RUN=(.*)$/m)[1]), fs.realpathSync(path.join(F.old, 'docs/devteam/run')), r.out);
      }
    });

    await t.test('A2b: each supervisor or owner command, run as the responder, exits non-zero and writes no log file', () => {
      const dirs = [F.logDir, path.join(F.old, 'docs/devteam/project/log'), path.join(wt, 'docs/devteam/project/log'), path.join(wt, 'docs/devteam/run/log')];
      const ask = ['--question', 'Which?', '--goal', F.goal, '--stake', '1', '--urgency', '1'];
      // a current finding to ack (task-3 T3-1): a worker's review-request 40 min old is unanswered-message
      const d = new Date(Date.now() - 40 * 60000);
      const mid = `m-${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}-kit-9-probe`;
      F.hand('kit-9-probe', { id: mid, type: 'message', to: 'supervisor', kind: 'review-request', text: 'review please', re: null, sha: null, ticket: null }, 40 * 60000, 'kit-9-probe.jsonl');
      const m = F.run(F.old, ['metrics', '--json'], F.SUP);
      assert.equal(m.status, 0, m.err);
      assert.ok((JSON.parse(m.out).findings ?? []).some((x) => x.kind === 'unanswered-message' && x.subject === mid), `the finding to ack is current: ${mid}`);
      // each refusal comes from the guard: the responder's hand-over hint, or the owner's commands' refusal
      const GUARD = /the supervisor does this; hand it over: send supervisor "…" --kind handoff --thread <t-id>/;
      const OWNER = /owner commands don't run in an agent session \(DEVTEAM_ROLE=responder\)/;
      const cmds = [
        [['answer', q, 'yes'], OWNER],
        [['ask', ...ask], GUARD],
        [['ack', 'unanswered-message', mid, '--reason', 'r'], GUARD],
        [['thread', 'ask', T, ...ask], GUARD],
        [['thread', 'ready', T, '--outcome', 'done'], GUARD],
        [['merge', 'kit-9-probe'], GUARD],
        [['act', '--class', 'worker-slots', '--', 'x'], GUARD],
        [['decide', '--class', 'rename-column', '--', 'x'], GUARD],
        [['goal', 'set', F.goal, '--title', 'x'], GUARD],
        [['chore', 'start', 'x'], GUARD],
        [['thread', 'say', T, 'words'], OWNER],
        [['phase', 'supervisor', '--usd', '1'], GUARD],
        [['phase', 'supervisor'], GUARD],
      ];
      for (const [args, why] of cmds) {
        const before = hashDirs(dirs);
        const r = R(args);
        assert.notEqual(r.status, 0, `${args.join(' ')} should fail as the responder: ${r.out}`);
        assert.match(r.err, why, `${args.join(' ')} is refused by its guard: ${r.err}`);
        assert.deepEqual(hashDirs(dirs), before, `${args.join(' ')} leaves every log file as it was, and adds none`);
      }
    });

    await t.test('A2c: act\'s refusal says the supervisor does it and how to hand it over', () => {
      const r = R(['act', '--class', 'worker-slots', '--', 'x']);
      assert.notEqual(r.status, 0);
      assert.match(r.err, /the supervisor does this/, r.err);
      assert.match(r.err, /--kind handoff --thread/, r.err);
    });
  } finally { F.done(); }
});

test('responder-contract C2: the reply guard, the responder\'s reply and refs, its turn cited, its observations', async (t) => {
  const F = threadsFixture('responder-c2');
  try {
    const T = F.owner(['thread', 'new', '--title', 'Header colour', '--', 'Make the header darker.']).split('\n')[0];
    const R = (args) => F.run(F.old, args, RESPONDER);
    const raw = (id) => fs.readdirSync(F.logDir).flatMap((f) => fs.readFileSync(path.join(F.logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))).find((l) => l.id === id);
    let U;

    await t.test("a worker's and a planner's thread reply are refused, the log unchanged", () => {
      for (const role of [{ DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'kit-9-probe' }, { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'probe' }]) {
        const before = hashDirs([F.logDir]);
        const r = F.run(F.old, ['thread', 'reply', T, 'x'], role);
        assert.notEqual(r.status, 0, `${role.DEVTEAM_ROLE}'s reply should fail: ${r.out}`);
        assert.deepEqual(hashDirs([F.logDir]), before, `${role.DEVTEAM_ROLE}'s refused reply writes nothing`);
      }
    });

    await t.test("the responder's reply with --refs is a responder turn with those refs", () => {
      const r = R(['thread', 'reply', T, 'On it', '--refs', `goal:${F.goal}`]);
      assert.equal(r.status, 0, r.err);
      U = r.out.split('\n')[0];
      assert.match(U, /^u-\S+-responder$/, r.out);
      const l = raw(U);
      assert.equal(l?.by, 'responder', JSON.stringify(l));
      assert.equal(l.type, 'turn');
      assert.deepEqual(l.refs, [`goal:${F.goal}`]);
    });

    await t.test("thread ask --turn naming the responder's turn is refused, naming the responder's", () => {
      assert.ok(U, 'the responder turn above');
      assert.match(F.fails(['thread', 'ask', T, '--turn', U, '--question', 'Which?', '--goal', F.goal, '--stake', '1', '--urgency', '1'], F.SUP), /that turn is the responder's/);
    });

    await t.test("the responder's observation is source responder; --source supervisor is refused", () => {
      const r = R(['observe', '--subject', 's', '--kind', 'note', '--detail', 'd']);
      assert.equal(r.status, 0, r.err);
      const id = r.out.split('\n')[0].match(/o-\S+/)?.[0];
      const l = raw(id);
      assert.equal(l?.type, 'observation', `${r.out}: ${JSON.stringify(l)}`);
      assert.equal(l.source, 'responder');
      assert.equal(l.by, 'responder');
      const before = hashDirs([F.logDir]);
      const s = R(['observe', '--subject', 's', '--kind', 'note', '--detail', 'd', '--source', 'supervisor']);
      assert.notEqual(s.status, 0, s.out);
      assert.match(s.err, /the responder's observation is from responder/, s.err);
      assert.deepEqual(hashDirs([F.logDir]), before);
    });
  } finally { F.done(); }
});

test('responder-contract A3: the handoff, sent, open and settled; writer on thread views', async (t) => {
  const F = threadsFixture('responder-a3');
  try {
    const R = (args) => F.run(F.old, args, RESPONDER);
    const raw = (id) => fs.readdirSync(F.logDir).flatMap((f) => fs.readFileSync(path.join(F.logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))).find((l) => l.id === id);
    const open = () => JSON.parse(F.sup(['messages', '--open', '--to', 'supervisor', '--json'])).map((m) => m.id);
    const newThread = (title) => F.owner(['thread', 'new', '--title', title, '--', 'Make the header darker.']).split('\n')[0];
    const handoff = (T, text = 'merge it') => {
      const r = R(['send', 'supervisor', text, '--kind', 'handoff', '--thread', T]);
      assert.equal(r.status, 0, `the responder's handoff: ${r.err || r.out}`);
      const id = r.out.split('\n')[0];
      assert.match(id, /^m-\S+-responder$/, r.out);
      return id;
    };
    const T = newThread('Header colour');

    await t.test('A3a: a handoff stays open through a responder turn, and closes on the supervisor\'s turn after it', () => {
      const U = JSON.parse(F.owner(['thread', 'show', T, '--json'])).turns[0].id;
      const H = handoff(T, `merge it (owner's turn ${U})`);
      assert.ok(open().includes(H), 'the handoff is open');
      const l = raw(H);
      assert.equal(l?.thread, T, JSON.stringify(l));
      assert.equal(l.kind, 'handoff');
      const r = R(['thread', 'reply', T, 'Passed to the supervisor']);
      assert.equal(r.status, 0, r.err);
      assert.ok(open().includes(H), "a responder turn doesn't settle it");
      F.sup(['thread', 'reply', T, 'Merged']);
      assert.ok(!open().includes(H), "the supervisor's turn after it settles it");
    });

    await t.test("A3b: a supervisor turn before the handoff doesn't settle it", () => {
      const Tb = newThread('Footer colour');
      F.sup(['thread', 'reply', Tb, 'Looking']);
      const H = handoff(Tb);
      assert.ok(open().includes(H), 'still open');
    });

    await t.test("A3c: send's refusals write nothing", () => {
      const Tc = newThread('Resolved one');
      F.owner(['thread', 'resolve', Tc]);
      const Topen = newThread('Open one');
      const worker = { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'kit-9-probe' };
      const M = handoff(Topen);
      const cases = [
        ['a handoff without --thread', ['send', 'supervisor', 'x', '--kind', 'handoff'], RESPONDER, /a handoff names its thread/],
        ['a t- id naming no thread', ['send', 'supervisor', 'x', '--kind', 'handoff', '--thread', 't-20990101-000000000-owner'], RESPONDER, /no thread t-20990101-000000000-owner/],
        ['a resolved thread', ['send', 'supervisor', 'x', '--kind', 'handoff', '--thread', Tc], RESPONDER, /the owner closed it.*reopen.*--kind info/],
        ['--thread with --kind info', ['send', 'supervisor', 'x', '--kind', 'info', '--thread', Topen], RESPONDER, /--thread goes with --kind handoff/],
        ['a handoff from the supervisor', ['send', 'supervisor', 'x', '--kind', 'handoff', '--thread', Topen], F.SUP, /the responder hands threads to the supervisor/],
        ['a handoff from a worker', ['send', 'supervisor', 'x', '--kind', 'handoff', '--thread', Topen], worker, /the responder hands threads to the supervisor/],
        ['a handoff to a ticket', ['send', 'kit-9-probe', 'x', '--kind', 'handoff', '--thread', Topen], RESPONDER, /the responder hands threads to the supervisor/],
        // cmdSend's own words (task-4 T4-2): integrity's refusal starts the same way, so match what only send says
        ["the responder's info with --re", ['send', 'supervisor', 'x', '--re', M], RESPONDER, /the responder replies to no message \(re\): a reply would close what it names/],
        ["the responder's handoff with --re", ['send', 'supervisor', 'x', '--kind', 'handoff', '--thread', Topen, '--re', M], RESPONDER, /the responder replies to no message \(re\): a reply would close what it names/],
      ];
      for (const [what, args, role, why] of cases) {
        const before = hashDirs([F.logDir]);
        const r = F.run(F.old, args, role);
        assert.notEqual(r.status, 0, `${what} should be refused: ${r.out}`);
        assert.match(r.err, why, `${what}: ${r.err}`);
        assert.deepEqual(hashDirs([F.logDir]), before, `${what} writes nothing`);
      }
    });

    await t.test("A3d: a resolve doesn't settle a handoff; the supervisor's --re does", () => {
      const Td = newThread('Resolved later');
      const H = handoff(Td);
      F.owner(['thread', 'resolve', Td]);
      assert.ok(open().includes(H), 'a resolve leaves it open');
      const r = F.run(F.old, ['send', 'responder', 'done', '--re', H], F.SUP);
      assert.equal(r.status, 0, r.err);
      assert.ok(!open().includes(H), "the supervisor's --re settles it");
    });

    await t.test('A3e: thread show gives each turn writer, its line\'s by, and keeps by', () => {
      const v = JSON.parse(F.owner(['thread', 'show', T, '--json']));
      const writers = v.turns.map((u) => u.writer);
      assert.deepEqual(writers, v.turns.map((u) => raw(u.id).by));
      assert.deepEqual(writers, ['owner', 'responder', 'supervisor']);
      assert.deepEqual(v.turns.map((u) => u.by), ['owner', 'supervisor', 'supervisor']);
    });

    await t.test('A3f: metrics and messages --open agree on a handoff a later supervisor turn settled', () => {
      const snap = F.snapLog();
      try {
        const T2 = newThread('Settled handoff');
        const T3 = newThread('Unsettled handoff');
        // one clock read for every id (task-4 T4-1): two reads a millisecond apart made H1 and H2 the same id
        const now = Date.now();
        const mid = (ago, n) => { const d = new Date(now - ago - n); return `m-${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}-responder`; };
        const H1 = mid(40 * 60000, 0);
        const H2 = mid(40 * 60000, 1);
        const H3 = mid(40 * 60000, 2);
        assert.equal(new Set([H1, H2, H3]).size, 3, 'three distinct ids');
        F.hand('responder', { id: H1, type: 'message', to: 'supervisor', kind: 'handoff', text: 'merge it', re: null, sha: null, ticket: null, thread: T2 }, 40 * 60000, 'responder.jsonl');
        F.hand('responder', { id: H2, type: 'message', to: 'supervisor', kind: 'handoff', text: 'merge that', re: null, sha: null, ticket: null, thread: T3 }, 40 * 60000 + 1, 'responder.jsonl');
        F.hand('supervisor', { type: 'turn', thread: T2, text: 'Done.' }, 35 * 60000);
        // a hand-written handoff to anyone but the supervisor is no line at all (task-4 T4-4)
        F.hand('responder', { id: H3, type: 'message', to: 'kit-9-probe', kind: 'handoff', text: 'merge this', re: null, sha: null, ticket: null, thread: T3 }, 40 * 60000 + 2, 'responder.jsonl');
        assert.notEqual(F.run(F.old, ['record', H3], F.SUP).status, 0, 'record finds no handoff to a worker');
        assert.ok(!JSON.parse(F.run(F.old, ['messages', '--open', '--to', 'kit-9-probe', '--json'], F.SUP).out).map((x) => x.id).includes(H3), 'the worker owes no reply to it');
        const m = F.run(F.old, ['metrics', '--json'], F.SUP);
        assert.equal(m.status, 0, m.err);
        const unanswered = (JSON.parse(m.out).findings ?? []).filter((x) => x.kind === 'unanswered-message').map((x) => x.subject);
        assert.ok(!unanswered.includes(H1), `metrics raises no unanswered-message for the settled handoff: ${unanswered.join(', ')}`);
        assert.ok(unanswered.includes(H2), `metrics raises unanswered-message for the open handoff: ${unanswered.join(', ')}`);
        const o = open();
        assert.ok(!o.includes(H1), 'messages --open leaves out the settled handoff');
        assert.ok(o.includes(H2), 'messages --open lists the open handoff');
      } finally { F.restoreLog(snap); }
    });
  } finally { F.done(); }
});

test('responder-contract A4 A7: a responder turn is never cited; artifact new stamps the responder', async (t) => {
  const F = threadsFixture('responder-a4');
  try {
    const R = (cwd, args, extra = {}) => F.run(cwd, args, { ...RESPONDER, ...extra });
    const q = F.sup(['ask', '--question', 'Ship it?', '--goal', F.goal, '--stake', '1', '--urgency', '1', '--recommendation', 'Yes']).split('\n')[0];
    const T = F.owner(['thread', 'new', '--title', 'Header colour', '--subject', JSON.stringify({ kind: 'item', ref: 'decision:d-20990101-000000000-supervisor' }), '--', 'Make the header darker.']).split('\n')[0];
    const ru = R(F.old, ['thread', 'reply', T, 'x']);
    assert.equal(ru.status, 0, ru.err);
    const U = ru.out.split('\n')[0];
    assert.match(U, /^u-\S+-responder$/, ru.out);
    const D = F.sup(['decide', '--class', 'rename-column', '--', 'renamed a column']).match(/d-\S+/)?.[0];
    assert.ok(D, 'a decision to correct');

    await t.test("A7: answer and correct --from-turn naming the responder's turn are refused, the log unchanged", () => {
      for (const args of [['answer', q, 'Yes', '--from-turn', U], ['correct', D, '--from-turn', U, '--said', 'x']]) {
        const before = hashDirs([F.logDir]);
        const r = F.run(F.old, args, { DEVTEAM_ROLE: 'supervisor' });
        assert.notEqual(r.status, 0, `${args.join(' ')} should fail: ${r.out}`);
        assert.match(r.err, /that turn is the responder's/, r.err);
        assert.deepEqual(hashDirs([F.logDir]), before, `${args[0]} writes nothing`);
      }
      // the control (task-5 T5-2): the owner's turn in the same thread passes this guard, so the refusal above is the turn's writer
      const O = JSON.parse(F.owner(['thread', 'show', T, '--json'])).turns.find((u) => u.writer === 'owner').id;
      for (const args of [['answer', q, 'Yes', '--from-turn', O], ['correct', D, '--from-turn', O, '--said', 'x']]) {
        const r = F.run(F.old, args, { DEVTEAM_ROLE: 'supervisor' });
        assert.doesNotMatch(r.err, /that turn is the/, `${args[0]} with the owner's turn passes the writer guard: ${r.err}`);
      }
    });

    await t.test('A4: artifact new as the responder stamps by: responder, and it checks; a role-less one stamps owner', () => {
      const a = path.join(F.base, 'wt-a');
      F.g(['worktree', 'add', '-q', '--detach', a], F.old);
      const n = R(a, ['artifact', 'new', 'mock-r', '--title', 'Mock', '--summary', 'A mock']);
      assert.equal(n.status, 0, n.err || n.out);
      const man = (cwd, s) => JSON.parse(fs.readFileSync(path.join(cwd, 'docs/devteam/project/artifacts', s, 'artifact.json'), 'utf8'));
      assert.equal(man(a, 'mock-r').by, 'responder');
      const c = R(a, ['artifact', 'check', 'mock-r']);
      assert.equal(c.status, 0, c.err || c.out);
      const o = F.run(a, ['artifact', 'new', 'mock-o', '--title', 'Mock', '--summary', 'A mock'], {});
      assert.equal(o.status, 0, o.err || o.out);
      assert.equal(man(a, 'mock-o').by, 'owner');
      // every other role stamps what it did before (task-5 T5-1): a worker its ticket, a planner plan-<feature>, the supervisor
      for (const [slug, role, by] of [['mock-w', { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'kit-9-probe' }, 'kit-9-probe'], ['mock-p', { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'probe' }, 'plan-probe'], ['mock-s', { DEVTEAM_ROLE: 'supervisor' }, 'supervisor'], ['mock-rt', { ...RESPONDER, DEVTEAM_TICKET: 'kit-9-probe' }, 'responder']]) {
        const w = F.run(a, ['artifact', 'new', slug, '--title', 'Mock', '--summary', 'A mock'], role);
        assert.equal(w.status, 0, w.err || w.out);
        assert.equal(man(a, slug).by, by, `${slug} stamps ${by}`);
      }
    });
  } finally { F.done(); }
});

// A GET on the dashboard with the headers the test chooses: status, headers and body text.
const dashGet = (port, route, headers = {}) => new Promise((resolve, reject) => {
  const r = http.get({ host: '127.0.0.1', port, path: route, headers: { host: `127.0.0.1:${port}`, ...headers }, timeout: 30000 }, (res) => {
    let b = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { b += c; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
  });
  r.on('timeout', () => r.destroy(new Error(`${route} timed out`)));
  r.on('error', reject);
});

test('responder-contract A5 A8: the draft fingerprint route, the /api/view comment, writer on /api/threads', async (t) => {
  const F = threadsFixture('responder-a5');
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  t.after(async () => { await dash.stop(); F.done(); });
  const SAME = { 'sec-fetch-site': 'same-origin' };
  const wt = path.join(F.old, '.worktrees', 'wt-fp');
  F.g(['worktree', 'add', '-q', '--detach', wt], F.old);
  const draft = path.join(wt, 'docs/devteam/project/artifacts/fp-fixture');
  fs.cpSync(path.join(testDir, 'fixtures', 'artifact-fp', 'draft'), draft, { recursive: true });
  const fpRoute = (slug = 'fp-fixture', at = 'wt-fp') => `/api/artifact-fp?slug=${encodeURIComponent(slug)}&at=${encodeURIComponent(at)}`;
  const fp = async () => {
    const r = await dashGet(port, fpRoute(), SAME);
    assert.equal(r.status, 200, r.body);
    return JSON.parse(r.body).fp;
  };

  await t.test("A5a: 200 {fp, at}, no-store, fp the same as artifact describe's", async () => {
    const r = await dashGet(port, fpRoute(), SAME);
    assert.equal(r.status, 200, r.body);
    assert.match(r.headers['cache-control'] ?? '', /no-store/);
    const b = JSON.parse(r.body);
    assert.deepEqual(Object.keys(b).sort(), ['at', 'fp']);
    assert.equal(b.at, 'wt-fp');
    assert.equal(typeof b.fp, 'string');
    assert.ok(b.fp.length > 0, 'fp is not empty');
    const d = F.run(F.old, ['artifact', 'describe', 'fp-fixture', '--at', 'wt-fp', '--json']);
    assert.equal(d.status, 0, d.err || d.out);
    assert.equal(b.fp, JSON.parse(d.out).fp, "describe's fingerprint");
  });

  await t.test('A5b: fp moves with one byte (same size), and comes back when the byte does', async () => {
    const first = await fp();
    assert.equal(await fp(), first, 'nothing changed: the same fp');
    const notes = path.join(draft, 'notes.txt');
    const was = fs.readFileSync(notes, 'utf8');
    assert.ok(was.trimEnd().endsWith('A'), 'the fixture ends in A');
    const at = (s) => new Date(Date.now() + s * 1000);
    fs.writeFileSync(notes, `${was.trimEnd().slice(0, -1)}B${was.slice(was.trimEnd().length)}`);
    assert.equal(fs.statSync(notes).size, Buffer.byteLength(was), 'the same size');
    fs.utimesSync(notes, at(60), at(60));
    const moved = await fp();
    assert.notEqual(moved, first, 'one byte changed: another fp');
    assert.equal(await fp(), moved, 'asked again: the same');
    fs.writeFileSync(notes, was);
    fs.utimesSync(notes, at(120), at(120));
    assert.equal(await fp(), first, 'the byte put back and the file touched: the first fp again');
  });

  await t.test('A5c: unknown slug 404, main 400, cross-site 403 as /api/threads', async () => {
    assert.equal((await dashGet(port, fpRoute('no-such-thing'), SAME)).status, 404);
    assert.equal((await dashGet(port, fpRoute('fp-fixture', 'no-such-wt'), SAME)).status, 404);
    assert.equal((await dashGet(port, fpRoute('fp-fixture', 'main'), SAME)).status, 400);
    assert.equal((await dashGet(port, fpRoute('fp-fixture', `tree:${'a'.repeat(40)}`), SAME)).status, 400);
    assert.equal((await dashGet(port, fpRoute('Not_A_Slug'), SAME)).status, 400);
    // drafts only where a draft can be (task-6 T6-1): a reviewer's or a scratch worktree, and a symlinked folder, are nothing
    for (const name of ['review-fp', 'tmp-fp']) {
      const w = path.join(F.old, '.worktrees', name);
      F.g(['worktree', 'add', '-q', '--detach', w], F.old);
      fs.cpSync(path.join(testDir, 'fixtures', 'artifact-fp', 'draft'), path.join(w, 'docs/devteam/project/artifacts/fp-fixture'), { recursive: true });
      assert.equal((await dashGet(port, fpRoute('fp-fixture', name), SAME)).status, 404, `${name}: not a draft`);
    }
    fs.symlinkSync(draft, path.join(wt, 'docs/devteam/project/artifacts/fp-link'));
    assert.equal((await dashGet(port, fpRoute('fp-link'), SAME)).status, 404, 'a symlinked folder: not a draft');
    const CROSS = { 'sec-fetch-site': 'cross-site' };
    const x = await dashGet(port, fpRoute(), CROSS);
    assert.equal(x.status, 403, x.body);
    assert.ok(JSON.parse(x.body).error, 'an {error}');
    assert.equal((await dashGet(port, '/api/threads', CROSS)).status, 403, 'the reference refuses it too');
    assert.equal((await dashGet(port, fpRoute())).status, 200, 'no sec-fetch-site (not a browser): answered');
  });

  await t.test('A8: the comment over /api/view says it is polled, and names /api/artifact-fp', () => {
    const src = fs.readFileSync(path.join(F.old, 'docs/devteam/scripts/devteam.mjs'), 'utf8');
    const at = src.indexOf("u.pathname === '/api/view'");
    assert.ok(at > 0, 'the /api/view route');
    const lines = src.slice(0, at).split('\n');
    let i = lines.length - 2;
    while (i >= 0 && /^\s*\/\//.test(lines[i])) i--;
    const comment = lines.slice(i + 1, -1).join('\n');
    assert.ok(comment.length > 0, 'a comment above it');
    assert.doesNotMatch(comment, /never polled/);
    assert.match(comment, /every 10 s/);
    assert.match(comment, /\/api\/artifact-fp/);
  });

  await t.test("A3e (/api/threads): each turn's writer is its line's by, and by unchanged", async () => {
    const T = F.owner(['thread', 'new', '--title', 'Header colour', '--', 'Make the header darker.']).split('\n')[0];
    const ru = F.run(F.old, ['thread', 'reply', T, 'On it'], RESPONDER);
    assert.equal(ru.status, 0, ru.err);
    F.sup(['thread', 'reply', T, 'Merged']);
    const r = await dashGet(port, '/api/threads', SAME);
    assert.equal(r.status, 200, r.body);
    const th = JSON.parse(r.body).threads.find((x) => x.id === T);
    assert.ok(th, `${T} on /api/threads`);
    assert.deepEqual(th.turns.map((u) => [u.writer, u.by]), [['owner', 'owner'], ['responder', 'supervisor'], ['supervisor', 'supervisor']]);
    for (const u of th.turns) assert.ok(u.id.endsWith(`-${u.writer}`), `${u.id}: writer is its line's by`);
  });
});
