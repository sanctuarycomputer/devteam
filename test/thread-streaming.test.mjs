// kit-797 (QT-S7; dev-710's W1): a reply handed over a paragraph at a time. The replier hands
// over each paragraph but the last with `thread reply <t> --part <n> "<words>"`, then writes the turn
// with `thread reply <t> --after-parts "<last words>"`. The parts sit on the thread's working record
// (run/thread-working.json, markThreadWorking), never as a log line; /api/threads serves them
// (threadWorking). kit-718 adds the page's cases (qt-stream).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dashboardOnFreePort, threadsFixture } from './lib/kit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MEASURE = path.join(here, 'fixtures', 'responder-e2e', 'measure.sh');
const SUP = { DEVTEAM_ROLE: 'supervisor' };
const RESPONDER = { DEVTEAM_ROLE: 'responder' };
const WORKER = { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'kit-9' };
const PLANNER = { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'checkout' };
const DASH = { DEVTEAM_ROLE: 'supervisor', DEVTEAM_CHANNEL: 'dashboard' };
const CAP = '/c/1700000000000.abcdefghijklmnop.abcdefghijklmnopqrstuv';
const ago = (ms) => new Date(Date.now() - ms).toISOString();

// the fixture, its record file and its served copy, and the helpers every case below uses
async function streaming(name) {
  const F = threadsFixture(name);
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  const file = path.join(F.old, 'docs/devteam/run/thread-working.json');
  const rec = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
  const setRec = (T, f) => { const m = rec(); m[T] = f(m[T]); fs.writeFileSync(file, JSON.stringify(m)); };
  const served = async (T) => (await (await fetch(`http://127.0.0.1:${port}/api/threads`)).json()).working?.[T];
  const thread = (title) => {
    const T = F.owner(['thread', 'new', `First words on ${title}`, '--title', title]).split('\n')[0];
    return { T, U: JSON.parse(F.owner(['thread', 'show', T, '--json'])).turns[0].id };
  };
  const turns = (T) => JSON.parse(F.owner(['thread', 'show', T, '--json'])).turns;
  // every line of the live log, of any type
  const logLines = () => fs.readdirSync(F.logDir).filter((f) => f.endsWith('.jsonl')).reduce((n, f) => n + fs.readFileSync(path.join(F.logDir, f), 'utf8').split('\n').filter(Boolean).length, 0);
  const part = (T, n, words, role = SUP) => F.owner(['thread', 'reply', T, '--part', String(n), words], role);
  const refused = (T, n, words, role = SUP) => F.fails(['thread', 'reply', T, '--part', String(n), words], role);
  const after = (T, words, role = SUP) => F.owner(['thread', 'reply', T, '--after-parts', ...(words === undefined ? [] : [words])], role);
  return { F, dash, port, file, rec, setRec, served, thread, turns, logLines, part, refused, after, done: async () => { await dash.stop(); F.done(); } };
}

test('reply streams: the parts on the working record, then one turn', async (t) => {
  const S = await streaming('streams');
  t.after(() => S.done());

  await t.test('S1 each part is served on the thread\'s working record and is never a log line', async () => {
    const { T } = S.thread('Streams');
    const before = S.turns(T).length;
    const lines = S.logLines();
    S.part(T, 1, 'p1');
    let w = await S.served(T);
    assert.equal(w?.partial, 'p1', `part 1 served: ${JSON.stringify(w)}`);
    assert.equal(w.parts, 1);
    S.part(T, 2, 'p2');
    w = await S.served(T);
    assert.equal(w?.partial, 'p1\n\np2', `part 2 served after part 1: ${JSON.stringify(w)}`);
    assert.equal(w.parts, 2);
    assert.equal(w.stage, 'responding');
    assert.equal(S.turns(T).length, before, 'no part is a turn line');
    assert.equal(S.logLines(), lines, 'no part writes a log line of any type');
  });

  await t.test('S2 --after-parts writes one turn, the parts and the last words joined, and clears the record', async () => {
    const { T } = S.thread('Streams whole');
    S.part(T, 1, 'p1');
    S.part(T, 2, 'p2');
    const before = S.turns(T).length;
    const said = S.after(T, 'last');
    const ts = S.turns(T);
    assert.equal(ts.length, before + 1, 'exactly one turn line');
    assert.equal(ts.at(-1).text, 'p1\n\np2\n\nlast', 'the parts and the last words, joined');
    assert.equal(said.split('\n')[0], ts.at(-1).id, 'it prints the turn\'s id first');
    assert.equal(await S.served(T), undefined, 'the record is gone with the turn');
    assert.equal(S.rec()[T], undefined, 'and gone from the file');
  });
});

test('reply streams checks: who, order, size, the writer, and when parts stop', async (t) => {
  const S = await streaming('streams-checks');
  t.after(() => S.done());

  await t.test('C1 a part past TURN_MAX or TURN_ENCODED_MAX is refused and the partial is unchanged', () => {
    const { T } = S.thread('Caps');
    S.part(T, 1, 'a'.repeat(1500));
    assert.match(S.refused(T, 2, 'b'.repeat(600)), /at most 2000 bytes/, 'a part past TURN_MAX is refused');
    assert.equal(S.rec()[T]?.partial, 'a'.repeat(1500), 'the partial is as it was');
    const { T: T2 } = S.thread('Encoded cap');
    S.part(T2, 1, 'x');
    assert.match(S.refused(T2, 2, '"'.repeat(1899)), /too many quotation marks/, 'a part past TURN_ENCODED_MAX is refused');
    assert.equal(S.rec()[T2]?.partial, 'x', 'the partial is as it was');
  });

  await t.test('C2 a box capability in a part is cut in the served partial', async () => {
    const { T } = S.thread('Capability');
    S.part(T, 1, `see ${CAP} here`);
    const w = await S.served(T);
    assert.equal(w?.partial, 'see [link removed] here', `the capability is cut in the served partial: ${w?.partial}`);
    assert.equal(S.rec()[T]?.partial, `see ${CAP} here`, 'the file keeps the words as given');
  });

  await t.test('C4 a part from a worker, a planner, the owner\'s terminal or the dashboard is refused, and so is one on a resolved thread', () => {
    const { T } = S.thread('Who');
    for (const [who, role] of [['a worker', WORKER], ['a planner', PLANNER], ["the owner's terminal", {}], ['the dashboard', DASH]]) {
      assert.match(S.refused(T, 1, 'p1', role), /agent session|the supervisor does this|DEVTEAM_ROLE/, `${who} is refused`);
      assert.equal(S.rec()[T]?.partial, undefined, `${who} wrote nothing`);
    }
    S.F.owner(['thread', 'resolve', T]);
    assert.match(S.refused(T, 1, 'p1'), /resolved/, 'a resolved thread is refused');
  });

  await t.test('C4c n is a whole number 1 to 999, and the owner\'s say takes neither flag', () => {
    const { T } = S.thread('Range');
    for (const n of ['0', '1000', '1.5']) assert.match(S.refused(T, n, 'p'), /at most 999/, `--part ${n} is refused`);
    assert.equal(S.rec()[T]?.partial, undefined, 'nothing taken');
    assert.match(S.F.fails(['thread', 'say', T, '--part', '1', 'x']), /go with a reply/, 'thread say --part is refused');
    assert.match(S.F.fails(['thread', 'say', T, '--after-parts', 'x']), /go with a reply/, 'thread say --after-parts is refused');
  });

  await t.test('C5 --after-parts with no partial of its own is refused and writes no turn', () => {
    const { T } = S.thread('No parts');
    const before = S.turns(T).length;
    assert.match(S.F.fails(['thread', 'reply', T, '--after-parts', 'last'], SUP), /no parts of yours/);
    assert.equal(S.turns(T).length, before, 'no turn written');
  });

  await t.test('C4b words after n and after the thread id are refused, never joined', () => {
    const { T } = S.thread('Words twice');
    assert.match(S.F.fails(['thread', 'reply', T, 'a', '--part', '1', 'b'], SUP), /the words once/);
    assert.equal(S.rec()[T]?.partial, undefined, 'nothing taken');
  });

  await t.test('C5b --after-parts refused by a reply guard keeps the partial, and a corrected rerun writes it', () => {
    const { T } = S.thread('Guarded');
    S.F.sup(['thread', 'reply', T, 'first']);
    S.part(T, 1, 'more');
    assert.match(S.F.fails(['thread', 'reply', T, '--after-parts', 'x'], SUP), /nothing in .* is waiting on you/);
    assert.equal(S.rec()[T]?.partial, 'more', 'the partial stays');
    S.F.sup(['thread', 'reply', T, '--after-parts', 'x', '--off-subject', 'a follow-on to my reply']);
    assert.equal(S.turns(T).at(-1).text, 'more\n\nx');
  });

  await t.test('C6 order: a gap is refused, a repeat with the same words is a no-op, with other words refused', () => {
    const { T } = S.thread('Order');
    S.part(T, 1, 'p1');
    assert.match(S.refused(T, 3, 'p3'), /part 3: expected 2/);
    S.part(T, 2, 'p2');
    assert.match(S.part(T, 2, 'p2'), /already taken/, 'the same part again is a no-op');
    assert.match(S.refused(T, 2, 'other'), /part 2/, 'part 2 with other words is refused');
    assert.equal(S.rec()[T]?.partial, 'p1\n\np2');
    S.after(T, 'end');
    assert.equal(S.turns(T).at(-1).text, 'p1\n\np2\n\nend', 'each part once, in order of n');
  });

  await t.test('C7 the writer: with the supervisor\'s partial live, the responder\'s part is refused', () => {
    const { T } = S.thread('Writer');
    S.part(T, 1, 'p1');
    assert.match(S.refused(T, 1, 'mine', RESPONDER), /supervisor is replying in this thread/);
    assert.equal(S.rec()[T]?.partial, 'p1');
  });

  await t.test('C8 a dead or stale holder\'s partial is never inherited', () => {
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    for (const [why, change] of [['a dead pid', (e) => ({ ...e, pid: dead })], ['a beat 11 minutes old', (e) => ({ ...e, beat: ago(11 * 60000) })]]) {
      const { T } = S.thread(`Dead ${why}`);
      S.part(T, 1, 'old words');
      S.setRec(T, change);
      let took = '';
      try { S.part(T, 1, 'fresh'); } catch (e) { took = e.message; }
      assert.equal(S.rec()[T]?.partial, 'fresh', `a fresh partial after ${why}: ${took || S.rec()[T]?.partial}`);
      S.after(T, 'end');
      assert.equal(S.turns(T).at(-1).text, 'fresh\n\nend', `none of the old words after ${why}`);
    }
  });

  await t.test('C9 a new owner turn starts a fresh partial', () => {
    const { T } = S.thread('New owner turn');
    S.part(T, 1, 'p1');
    S.part(T, 2, 'p2');
    S.F.owner(['thread', 'say', T, 'one more thing']);
    assert.match(S.refused(T, 3, 'p3'), /expected 1/);
    S.part(T, 1, 'again');
    assert.equal(S.rec()[T]?.partial, 'again');
  });

  await t.test('C10 thread working and thread show mid-stream keep the partial', () => {
    const { T } = S.thread('Keeps');
    S.part(T, 1, 'p1');
    S.F.sup(['thread', 'working', T]);
    assert.equal(S.rec()[T]?.partial, 'p1', 'working keeps the partial');
    S.F.sup(['thread', 'show', T]);
    assert.equal(S.rec()[T]?.partial, 'p1', 'show keeps the partial');
    assert.equal(S.rec()[T].parts, 1);
    S.after(T);
    assert.equal(S.turns(T).at(-1).text, 'p1', '--after-parts with no last words writes the parts alone');
  });

  await t.test('C13 a partial left 10 minutes, or whose pid is gone, is dropped and deleted from the file', async () => {
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    // each read right after its record went stale, so the read that finds it is the one served
    for (const [why, change] of [['stale', (e) => ({ ...e, beat: ago(11 * 60000) })], ['dead', (e) => ({ ...e, pid: dead })]]) {
      const { T } = S.thread(`Dropped ${why}`);
      S.part(T, 1, `old words ${why}`);
      S.setRec(T, change);
      const w = await S.served(T);
      assert.equal(w?.partial, undefined, `${why}: no partial served`);
      assert.equal(w?.stage, 'unfinished', `${why}: the mark is served: ${JSON.stringify(w)}`);
      assert.equal(S.rec()[T]?.partial, undefined, `the ${why} partial is deleted from the file: ${S.rec()[T]?.partial}`);
      assert.equal(S.rec()[T]?.stage, 'unfinished', `${why}: the file keeps the mark: ${JSON.stringify(S.rec()[T])}`);
      assert.equal(S.rec()[T].pid, null, `${why}: the mark names no holder`);
      assert.equal((await S.served(T))?.stage, 'unfinished', `${why}: a later read still serves the mark`);
    }
    const { T } = S.thread('Dropped a day ago');
    S.part(T, 1, 'old words');
    S.setRec(T, (e) => ({ by: e.by, stage: 'unfinished', turn: e.turn, at: e.at, beat: ago(25 * 3600000), pid: null }));
    assert.equal(await S.served(T), undefined, 'a mark over a day old is not served');
  });
});

test('reply streams measure: the goal\'s measure reads the same with and without streaming', async (t) => {
  // Twin fixtures, each given an owner turn 20 s old at the same moment: one is replied to in parts,
  // the other not yet. The parts come inside the measure's 30 s and every read after it, so a part
  // written as a turn would be a first reply under 30 s, and the streamed twin would read 0, not 1.
  const OLD = 20000;
  const a = await streaming('streams-measure');
  const b = await streaming('streams-measure-twin');
  t.after(async () => { await a.done(); await b.done(); });
  const owe = (S) => {
    const T = S.F.hand('owner', { type: 'thread', title: 'Old turn' }, OLD);
    S.F.hand('owner', { type: 'turn', thread: T, text: 'still waiting' }, OLD);
    return T;
  };
  const measure = (S) => {
    const r = spawnSync('sh', [MEASURE], { cwd: S.F.old, env: S.F.env({}), encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim().split('\n').at(-1);
  };
  const at = Date.now() - OLD;
  const Ta = owe(a);
  const Tb = owe(b);
  a.part(Ta, 1, 'p1');
  a.part(Ta, 2, 'p2');
  const took = Date.now() - at;
  await new Promise((r) => setTimeout(r, Math.max(0, 31000 - (Date.now() - at))));
  // the mid-stream read tells a part from a turn only while the parts came inside 30 s
  if (took < 29000) assert.equal(measure(a), measure(b), 'mid-stream reads as no reply: no part is a turn');
  else t.diagnostic(`the parts took ${took} ms on this machine; the mid-stream read can't tell, and is skipped`);
  assert.equal(measure(b), '1', 'the owner turn, 31 s old with no reply, counts');
  a.after(Ta, 'end');
  b.F.sup(['thread', 'reply', Tb, 'p1\n\np2\n\nend']);
  assert.equal(measure(a), measure(b), 'after the turn, the same as a plain reply');
});

test('reply streams help: the usage and help name --part and --after-parts', () => {
  const F = threadsFixture('streams-help');
  try {
    const help = F.owner(['help']);
    assert.equal(/thread reply <t-id> --part <n>/.test(help) && /--after-parts/.test(help), true, 'help names --part and --after-parts');
    const usage = F.fails(['thread']);
    assert.equal(/--part <n>/.test(usage) && /--after-parts/.test(usage), true, 'the usage line names them');
  } finally { F.done(); }
});
