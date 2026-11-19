// kit-314: the session holding an owner's thread turn says so: `thread show` by a session that may
// reply marks the newest owner turn picked up, `thread working` marks it responding, and the
// holder's reply, ask or ready (or the owner's resolve, or --done) clears it. The record is
// machine-local (run/thread-working.json), served on /api/threads and drawn on the open card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { dashboardOnFreePort, hasTmux, kit, threadsFixture } from './lib/kit.mjs';

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

  await t.test('at resets when another writer or another turn takes the record', () => {
    const { T } = thread('At resets');
    F.sup(['thread', 'working', T]);
    const a = rec()[T].at;
    pause(20);
    F.owner(['thread', 'working', T], WORKER);
    assert.equal(rec()[T].by, 'kit-9');
    const b = rec()[T].at;
    assert.ok(Date.parse(b) > Date.parse(a), 'another writer: at is newer');
    pause(20);
    const U = say(T, 'next');
    F.owner(['thread', 'working', T], WORKER);
    assert.equal(rec()[T].turn, U);
    assert.ok(Date.parse(rec()[T].at) > Date.parse(b), 'another turn: at is newer');
  });

  await t.test('entries not written for 24 hours go on the next write', () => {
    const { T } = thread('Old entries');
    const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
    const old = { by: 'supervisor', stage: 'responding', turn: 'x', at: ago(25), beat: ago(25), pid: null };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ 'old-25h': old, 'old-23h': { ...old, at: ago(23), beat: ago(23) } }));
    F.sup(['thread', 'working', T]);
    assert.equal(rec()['old-25h'], undefined, '25 h old is dropped');
    assert.ok(rec()['old-23h'], '23 h old stays');
    assert.ok(rec()[T]);
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

// A wait with its own bound: the stage must show (or go) within seconds, not lib/kit.mjs's 2 min.
async function within(ms, f, what) {
  for (const end = Date.now() + ms; ;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > end) assert.fail(`not within ${ms} ms: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

test('/api/threads serves the live stages, and a change to one is past the etag', async (t) => {
  const F = threadsFixture('responding-api');
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  t.after(async () => { await dash.stop(); F.done(); });
  const file = path.join(F.old, 'docs/devteam/run/thread-working.json');
  const T = F.owner(['thread', 'new', 'Look at this', '--title', 'Live stage']).split('\n')[0];
  const U = JSON.parse(F.owner(['thread', 'show', T, '--json'])).turns[0].id;
  const get = (h = {}) => fetch(`http://127.0.0.1:${port}/api/threads`, { headers: h });
  // an etag the server keeps with nothing changed (the dashboard's first hello may still move its pane)
  const settled = () => within(15000, async () => {
    const r = await get();
    const tag = r.headers.get('etag');
    return (await get({ 'if-none-match': tag })).status === 304 && { tag, j: await r.json() };
  }, 'a 304 for an unchanged answer');

  F.sup(['thread', 'show', T]);
  let { tag, j } = await settled();
  const w = j.working?.[T];
  assert.equal(w?.stage, 'picked-up', JSON.stringify(j.working));
  assert.deepEqual(Object.keys(w).sort(), ['at', 'beat', 'by', 'stage', 'turn'], 'no pid on the page');
  assert.equal(w.by, 'supervisor');
  assert.equal(w.turn, U);

  // P6: the log is unchanged, the stage alone moved, and the etag says so
  F.sup(['thread', 'working', T]);
  let r = await get({ 'if-none-match': tag });
  assert.equal(r.status, 200, 'a new stage is a new body, never a 304');
  assert.equal((await r.json()).working[T]?.stage, 'responding');
  tag = r.headers.get('etag');

  F.sup(['thread', 'working', T, '--done']);
  r = await get({ 'if-none-match': tag });
  assert.equal(r.status, 200, 'a cleared stage is a new body');
  assert.equal((await r.json()).working[T], undefined);

  // the null path, by hand: a fresh beat shows, one 11 min old doesn't
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  const e = (min) => ({ by: 'supervisor', stage: 'responding', turn: U, at: ago(min), beat: ago(min), pid: null });
  const m = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  fs.writeFileSync(file, JSON.stringify({ ...m, 't-20260101-000000000-stale': e(11), 't-20260101-000000000-fresh': e(0) }));
  j = await (await get()).json();
  assert.equal(j.working['t-20260101-000000000-stale'], undefined, 'a beat 11 min old is not shown');
  assert.equal(j.working['t-20260101-000000000-fresh']?.stage, 'responding', 'pid null and a fresh beat is shown');
});

test('a session that died mid-turn: its stage goes from /api/threads', { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const F = threadsFixture('responding-dead');
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  // a tmux server of this test's own (a short socket under the fixture), never the machine's
  const sock = path.join(F.base, 's');
  const tenv = F.env({});
  delete tenv.TMUX;
  delete tenv.TMUX_PANE;
  const tmux = (...a) => spawnSync('tmux', ['-S', sock, ...a], { env: tenv, encoding: 'utf8', timeout: 10000 });
  t.after(async () => { tmux('kill-server'); await dash.stop(); F.done(); });
  const file = path.join(F.old, 'docs/devteam/run/thread-working.json');
  const T = F.owner(['thread', 'new', 'Look at this', '--title', 'Dead session']).split('\n')[0];
  // The stand-in agent: the pane's bash forks it, and it runs the command through a shell hop
  // (`; true` keeps sh from exec'ing), so the walk must pass sh and take the pane shell's child.
  const dir = fs.mkdtempSync(path.join(F.base, 'agent-'));
  const agent = path.join(dir, 'agent.mjs');
  const cfg = path.join(dir, 'cfg.json');
  const pidFile = path.join(dir, 'pid');
  const doneFile = path.join(dir, 'done');
  fs.writeFileSync(cfg, JSON.stringify({ cwd: F.old, pidFile, doneFile, out: path.join(dir, 'out.txt'),
    env: { ...F.env(F.SUP), NODE: process.execPath, DT: path.join(F.old, 'docs/devteam/scripts/devteam.mjs'), T } }));
  fs.writeFileSync(agent, [
    "import fs from 'node:fs';",
    "import { spawnSync } from 'node:child_process';",
    "const c = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));",
    'fs.writeFileSync(c.pidFile, String(process.pid));',
    "const r = spawnSync('sh', ['-c', '\"$NODE\" \"$DT\" thread working \"$T\"; true'], { cwd: c.cwd, env: c.env, encoding: 'utf8', timeout: 60000 });",
    'fs.writeFileSync(c.out, `${r.status}\\n${r.stdout}\\n${r.stderr}`);',
    "fs.writeFileSync(c.doneFile, 'done');",
    'process.stdin.resume();',
    '',
  ].join('\n'));
  // separate words: tmux execs bash itself, which stays the pane's root as a real pane shell does
  assert.equal(tmux('new-session', '-d', '-c', F.old, '--', 'bash', '--norc', '--noprofile').status, 0, 'the throwaway tmux');
  tmux('send-keys', '-l', `${process.execPath} ${agent} ${cfg}`);
  tmux('send-keys', 'Enter');
  await within(10000, () => fs.existsSync(pidFile) && fs.existsSync(doneFile), 'the stand-in ran thread working');
  const standIn = Number(fs.readFileSync(pidFile, 'utf8'));
  const said = fs.readFileSync(path.join(dir, 'out.txt'), 'utf8');
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'))[T];
  assert.equal(rec?.pid, standIn, `the stand-in agent's pid, not the sh's or the pane's bash (${said})`);
  // every read must be a good one: a 500 after the kill has no working map, and must not pass for "gone"
  const working = async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/threads`);
    assert.equal(r.status, 200, '/api/threads answers');
    const w = (await r.json()).working;
    assert.ok(w && typeof w === 'object' && !Array.isArray(w), 'a working map');
    return w;
  };
  assert.equal((await working())[T]?.stage, 'responding');
  process.kill(standIn);
  await within(4000, async () => !(T in await working()), 'the dead session\'s stage gone');
});

// The card's line, as the page draws it: the threads-core block in a vm, as kit-311's test loads it
// (no TL, so the sup and working defaults must not throw).
test('each stage shows for the right signal, and never hides the words for a newer turn', () => {
  const html = fs.readFileSync(path.join(kit, 'dashboard/index.html'), 'utf8');
  const src = html.slice(html.indexOf('/* threads-core start */'), html.indexOf('/* threads-core end */'));
  const ctx = vm.createContext({ TextEncoder, URL });
  vm.runInContext(`${src}\n;globalThis.api = { tCardState };`, ctx);
  const { tCardState } = ctx.api;
  const MIN = 60000;
  const now = Date.parse('2026-11-10T12:00:00Z');
  const iso = (min) => new Date(now - min * MIN).toISOString();
  const T = 't-20261110-110000000-owner';
  const U = 'u-20261110-115700000-owner';
  const U2 = 'u-20261110-115900000-owner';
  const R = 'u-20261110-115800000-supervisor';
  const th = (...turns) => ({ id: T, turns: turns.map(([by, id, min]) => ({ by, id, at: iso(min), text: 'x' })) });
  const rec = (by, stage, turn, min) => ({ [T]: { by, stage, turn, at: iso(min), beat: iso(min) } });
  const card = (t, w, sup = null, typed = true, pane = true) => tCardState(t, now, typed, pane, sup, w);
  const one = th(['owner', U, 3]);

  // the stages, and who
  assert.equal(card(one, rec('supervisor', 'picked-up', U, 2)), 'The supervisor picked it up.');
  assert.equal(card(one, rec('supervisor', 'responding', U, 2)), 'The supervisor is responding…');
  assert.equal(card(one, rec('kit-9', 'responding', U, 2)), 'The session on kit-9 is responding…');
  assert.equal(card(one, rec('plan-dash', 'responding', U, 2)), 'The planner for dash is responding…');
  assert.equal(card(one, rec('responder', 'responding', U, 2)), 'The responder is responding…');
  assert.equal(card(one, rec('', 'responding', U, 2)), 'A session is responding…', 'no name: plain words');
  assert.equal(card(one, rec(7, 'picked-up', U, 2)), 'A session picked it up.', 'not a string: plain words');
  // the record counts over held and over kit-311's record of the same turn: whoever picked it up has it
  assert.equal(card(one, rec('supervisor', 'responding', U, 2), null, 'held', true), 'The supervisor is responding…', 'over held');
  assert.equal(card(one, rec('supervisor', 'picked-up', U, 2), { checked: null, undelivered: [U] }, false, false), 'The supervisor picked it up.', 'over not delivered, for the turn it names');

  // the session's own reply first, then still working (the view names every non-owner turn supervisor)
  const replied = th(['owner', U, 3], ['supervisor', R, 2]);
  for (const by of ['supervisor', 'responder', 'kit-9']) {
    const who = { supervisor: 'The supervisor', responder: 'The responder', 'kit-9': 'The session on kit-9' }[by];
    assert.equal(card(replied, rec(by, 'responding', U, 1)), `${who} is responding…`, `a reply before the record (${by})`);
    assert.equal(card(replied, rec(by, 'responding', U, 2.5)), null, `a reply after the record is the state (${by})`);
  }
  assert.equal(card(replied, rec('supervisor', 'responding', U, 2)), null, 'a reply at the same moment: not before it');
  assert.equal(card(replied, rec('supervisor', 'responding', R, 1)), null, 'a record naming no owner turn');

  // a record for an older owner turn never speaks for the newer one
  const newer = th(['owner', U, 5], ['supervisor', R, 4], ['owner', U2, 1]);
  assert.equal(card(newer, rec('supervisor', 'responding', U, 3)), 'Sent.', "the newest turn's own words");
  assert.equal(card(newer, rec('supervisor', 'responding', U, 3), { checked: null, undelivered: [U2] }),
    'Not delivered: no supervisor terminal took it. The supervisor sees it only when it next checks; it has not checked yet.', "kit-311's words for the newest");
  assert.equal(card(newer, rec('supervisor', 'responding', U, 3), null, 'held', true).startsWith('Held: '), true, 'the held words for the newest');
  assert.equal(card(newer, rec('supervisor', 'responding', U2, 0.5), { checked: null, undelivered: [U2] }), 'The supervisor is responding…', 'a record naming the newest');
  // a record for another thread, or a stage it doesn't know, is no record
  assert.equal(card(one, { 't-other': rec('supervisor', 'responding', U, 2)[T] }), 'Sent.');
  assert.equal(card(one, rec('supervisor', 'replied', U, 2)), 'Sent.');

  // no record: today's words
  assert.equal(card(one, {}), 'Sent.');
  assert.equal(card(one, null), 'Sent.');
  assert.equal(card(replied, {}), null, 'the supervisor has the last word');
  assert.equal(card(th(), rec('supervisor', 'responding', U, 2)), null, 'no turns');
  // the five-argument call, with no TL on the page's globals, doesn't throw
  assert.equal(tCardState(one, now, true, true, null), 'Sent.');
  assert.equal(tCardState(one, now, true, true), 'Sent.');
});
