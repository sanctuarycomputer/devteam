// kit-314: the session holding an owner's thread turn says so: `thread show` by a session that may
// reply marks the newest owner turn picked up, `thread working` marks it responding, and the
// holder's reply, ask or ready (or the owner's resolve, or --done) clears it. The record is
// machine-local (run/thread-working.json), served on /api/threads and drawn on the open card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { threadsFixture } from './lib/kit.mjs';

const WORKER = { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'kit-9' };
const RESPONDER = { DEVTEAM_ROLE: 'responder' };
const DASH = { DEVTEAM_ROLE: 'supervisor', DEVTEAM_CHANNEL: 'dashboard' };
const RESPONDING = (t) => `responding: ${t} (the owner's card says so until you reply; run this again every few minutes of longer work)`;

test('thread working and the pickup: the record, who writes it, and what clears it', async (t) => {
  const F = threadsFixture('responding');
  t.after(() => F.done());
  const file = path.join(F.old, 'docs/devteam/run/thread-working.json');
  const rec = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
  const thread = (title) => {
    const T = F.owner(['thread', 'new', `First words on ${title}`, '--title', title]).split('\n')[0];
    return { T, U: JSON.parse(F.owner(['thread', 'show', T, '--json'])).turns[0].id };
  };
  const say = (T, words) => F.owner(['thread', 'say', T, words]).split('\n')[0];
  const lastTurn = (T) => JSON.parse(F.owner(['thread', 'show', T, '--json'])).turns.at(-1);
  const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

  await t.test('picked up: a session that may reply marks the newest owner turn by showing it', () => {
    const { T } = thread('Picked up');
    const U = say(T, 'hi');
    F.owner(['thread', 'show', T]);
    assert.equal(rec()[T], undefined, "the owner's show writes nothing");
    F.owner(['thread', 'show', T], DASH);
    assert.equal(rec()[T], undefined, "the dashboard's show writes nothing");
    F.owner(['thread', 'show', T], WORKER);
    assert.equal(rec()[T], undefined, "a worker's show writes nothing");
    F.sup(['thread', 'show', T]);
    const r = rec()[T];
    assert.equal(r?.by, 'supervisor');
    assert.equal(r.stage, 'picked-up');
    assert.equal(r.turn, U);
    assert.ok(r.at && r.beat && 'pid' in r, 'at, beat and pid are kept');

    const { T: T2, U: U2a } = thread('Picked up by the responder');
    F.owner(['thread', 'show', T2, '--json'], RESPONDER);
    assert.equal(rec()[T2]?.by, 'responder', 'show --json marks too, as the responder');
    assert.equal(rec()[T2].turn, U2a);

    assert.equal(F.sup(['thread', 'working', T]), RESPONDING(T));
    F.sup(['thread', 'show', T]);
    assert.equal(rec()[T].stage, 'responding', 'a responding record is never stepped back');

    const U2 = say(T, 'one more thing');
    F.sup(['thread', 'show', T]);
    assert.equal(rec()[T].turn, U2, 'the stage follows the newest owner turn');
    assert.equal(rec()[T].stage, 'picked-up');
  });

  await t.test('responding: the words, the stage, at kept and beat moved; another writer replaces it', () => {
    const { T } = thread('Responding');
    F.sup(['thread', 'show', T]);
    const p = rec()[T];
    pause(20);
    assert.equal(F.sup(['thread', 'working', T]), RESPONDING(T));
    const r = rec()[T];
    assert.equal(r.stage, 'responding');
    assert.equal(r.at, p.at, 'at kept: the same writer and the same turn');
    assert.ok(r.beat >= p.beat, 'beat moved on');
    assert.equal(F.owner(['thread', 'working', T], WORKER), RESPONDING(T));
    assert.equal(rec()[T].by, 'kit-9', 'the newest holder wins');
    assert.equal(rec()[T].stage, 'responding');
  });

  await t.test('reply first, then keep working', () => {
    const { T } = thread('Reply first');
    F.sup(['thread', 'show', T]);
    F.sup(['thread', 'reply', T, 'On it']);
    assert.equal(rec()[T], undefined, 'the reply cleared it');
    const replied = lastTurn(T).at;
    F.sup(['thread', 'working', T]);
    const r = rec()[T];
    assert.equal(r?.stage, 'responding', "the caller's own newest turn is accepted");
    assert.ok(Date.parse(r.at) > Date.parse(replied), 'at after the reply');
    assert.match(F.fails(['thread', 'working', T], WORKER), /nothing to respond to: the last turn is supervisor's/);
  });

  await t.test('reply first as the responder', () => {
    const { T } = thread('Reply first as the responder');
    F.owner(['thread', 'reply', T, 'On it'], RESPONDER);
    assert.equal(F.owner(['thread', 'working', T], RESPONDER), RESPONDING(T));
    assert.equal(rec()[T]?.by, 'responder');
  });

  await t.test('clears: reply, ask, ready, resolve and --done; a new owner turn keeps it', () => {
    const { T } = thread('Clears');
    const set = () => { F.sup(['thread', 'working', T]); assert.ok(rec()[T], 'set'); };
    set();
    F.sup(['thread', 'reply', T, 'done']);
    assert.equal(rec()[T], undefined, 'reply');
    say(T, 'and this?');
    set();
    F.sup(['thread', 'ask', T, '--question', 'Which colour?', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
    assert.equal(rec()[T], undefined, 'ask');
    say(T, 'blue');
    set();
    F.sup(['thread', 'ready', T, '--outcome', 'x']);
    assert.equal(rec()[T], undefined, 'ready');
    set();
    F.owner(['thread', 'resolve', T, '--outcome', 'done']);
    assert.equal(rec()[T], undefined, 'resolve');
    F.owner(['thread', 'reopen', T, '--', 'one more']);
    set();
    assert.equal(F.sup(['thread', 'working', T, '--done']), `cleared: ${T}`);
    assert.equal(rec()[T], undefined, '--done');
    assert.equal(F.sup(['thread', 'working', T, '--done']), `cleared: ${T} (nothing was set)`);
    set();
    const before = rec()[T];
    say(T, 'a new turn');
    assert.deepEqual(rec()[T], before, 'a new owner turn keeps the record');
  });

  await t.test('refusals: the owner, the dashboard, a resolved thread, a thread with no owner turn', () => {
    const { T } = thread('Refusals');
    assert.match(F.fails(['thread', 'working', T]), /agent session/);
    F.sup(['thread', 'working', T]);
    assert.match(F.fails(['thread', 'working', T, '--done']), /agent session/);
    assert.ok(rec()[T], '--done with no role leaves the record');
    assert.match(F.fails(['thread', 'working', T], DASH), /agent session/);
    F.owner(['thread', 'resolve', T]);
    assert.match(F.fails(['thread', 'working', T], F.SUP), /resolved/);
    const snap = F.snapLog();
    try {
      const H = F.hand('owner', { type: 'thread', title: 'No owner turn' }, 1000);
      assert.match(F.fails(['thread', 'working', H], F.SUP), /no owner turn/);
      assert.equal(rec()[H], undefined);
    } finally { F.restoreLog(snap); }
  });

  await t.test('the pid: null outside tmux, else a live process', () => {
    const { T } = thread('The pid');
    F.sup(['thread', 'working', T]);
    const { pid } = rec()[T];
    if (pid === null) return;
    assert.ok(Number.isInteger(pid) && pid > 1, `a pid: ${pid}`);
    let alive = true;
    try { process.kill(pid, 0); } catch (e) { alive = e.code === 'EPERM'; }
    assert.ok(alive, `pid ${pid} is alive`);
  });
});
