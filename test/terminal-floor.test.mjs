// The owner's line comes first (terminal@1 §11, kit-618): every kit writer to the supervisor's pane
// takes one lock (run/type-lock-<pane>) and, while the owner has an unsent line there (the pane
// option @devteam-owner-floor), types nothing and presses no Enter; paneAnswer takes the lock and
// ignores the floor. Real tmux on the test lib's own server; a stand-in supervisor that draws the
// screen the test writes and keeps every byte it is sent.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { until, write } from './lib/kit.mjs';
import { keysBody, keysTo, pause, screenOf, termFixture, tokenOf } from './lib/terminal-server-fixture.mjs';
import { menuPane } from './lib/pane-question-fixture.mjs';
import { CLAUDE_RESUME, fixture as recoveryFixture, MENU, rateLimit, SID, SKIP, SUP, supervisorPane } from './lib/recovery-fixture.mjs';

// tmux reads UTF-8 from the locale's name: the prompt's ❯ and its non-breaking space must survive
process.env.LANG = process.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8';

const STAND_IN = `const fs = require('fs'), path = require('path');
const dir = process.argv[2];
process.stdin.setRawMode(true);
let last = null;
const draw = () => { let t; try { t = fs.readFileSync(path.join(dir, 'screen'), 'utf8'); } catch { return; } if (t === last) return; last = t; process.stdout.write('\\x1b[2J\\x1b[H' + t.replace(/\\n/g, '\\r\\n')); };
process.stdin.on('data', (d) => {
  fs.appendFileSync(path.join(dir, 'bytes'), d);
  // on Enter, the screen it was told to show next, if any
  if (d.includes(13)) { try { fs.renameSync(path.join(dir, 'next'), path.join(dir, 'screen')); } catch {} }
});
setInterval(draw, 30);
draw();
fs.writeFileSync(path.join(dir, 'up'), '');
`;
const RULE = `\x1b[38;5;244m${'─'.repeat(60)}\x1b[39m`;
const PROMPT = '❯ ';
const box = (inside) => `the agent's last output\n${RULE}\n${inside}\n${RULE}\n\x1b[38;5;211mstatus\x1b[39m\n`;
const SCREEN = {
  ready: box(PROMPT),
  typing: box(`${PROMPT}half a line of the owner's`),
  busy: `✻ Working… (esc to interrupt)\n${box(PROMPT)}`,
  dialog: 'Do you want to proceed?\n❯ 1. Yes\n  2. No\n',
  limit: `You've hit your limit · resets 3pm\n${box(PROMPT)}`,
  unknown: 'a screen with no input box',
};
const tm = (T, args) => spawnSync('tmux', args, { env: T.env, encoding: 'utf8' });
const opt = (T, pane, name) => (tm(T, ['display', '-p', '-t', pane, `#{${name}}`]).stdout ?? '').trim();
const floorOf = (T, pane) => opt(T, pane, '@devteam-owner-floor');
// a floor as the keys route writes it, ago ms old (past the 3 s settle by default)
const setFloor = (T, pane, kind, ago = 5000) => assert.equal(tm(T, ['set-option', '-p', '-t', pane, '@devteam-owner-floor', `${Date.now() - ago} ${kind}`]).status, 0);
const unsetOpt = (T, pane, name) => tm(T, ['set-option', '-p', '-u', '-t', pane, name]);
const setReadable = (T, pane, on = true) => (on ? tm(T, ['set-option', '-p', '-t', pane, '@devteam-prompt-readable', String(Date.now())]) : unsetOpt(T, pane, '@devteam-prompt-readable'));
const runDirOf = (T) => path.join(T.root, 'docs/devteam/run');

// The stand-in, in a window of the project's session, at its root, marked as the supervisor's pane.
let shows = 0;
function sup(T, screen = SCREEN.ready, window = 'sup') {
  const dir = fs.mkdtempSync(path.join(T.F.base, 'sup-'));
  write(path.join(dir, 'screen'), screen);
  write(path.join(dir, 'agent.cjs'), STAND_IN);
  const made = tm(T, ['new-window', '-d', '-P', '-F', '#{pane_id}', '-t', `=${T.session}:`, '-n', window, '-c', T.root, process.execPath, path.join(dir, 'agent.cjs'), dir]);
  assert.equal(made.status, 0, made.stderr);
  const pane = made.stdout.trim();
  for (let i = 0; i < 300 && !fs.existsSync(path.join(dir, 'up')); i++) spawnSync('sleep', ['0.1']);
  assert.ok(fs.existsSync(path.join(dir, 'up')), 'the stand-in started');
  write(path.join(runDirOf(T), 'supervisor-pane'), `${pane}\n`);
  write(path.join(runDirOf(T), 'supervisor-pane-role'), `${pane}\n`);
  const key = `${T.session}:${window}`;
  const bytes = () => { try { return fs.readFileSync(path.join(dir, 'bytes'), 'latin1'); } catch { return ''; } };
  // drawn, with a marker of its own at the top, so the test knows it is on the pane
  const show = async (text) => {
    const m = `shown-${++shows}`;
    write(path.join(dir, 'screen'), `${m}\n${text}`);
    await until(() => (tm(T, ['capture-pane', '-p', '-t', pane]).stdout ?? '').includes(m), `${m} on ${pane}`);
  };
  const onEnter = (text) => write(path.join(dir, 'next'), text);
  // nothing more arrives for ms
  const quiet = async (ms = 400) => { let b = bytes(); for (let since = Date.now(); Date.now() - since < ms; await pause(50)) if (bytes() !== b) { b = bytes(); since = Date.now(); } return b; };
  const heldDir = path.join(runDirOf(T), 'held', encodeURIComponent(key));
  const held = () => { try { return fs.readdirSync(heldDir).filter((n) => n.endsWith('.json')).sort(); } catch { return []; } };
  const clearHeld = () => fs.rmSync(heldDir, { recursive: true, force: true });
  // a held line as typeInto writes one, ago ms old
  let n = 0;
  const holdByHand = (line, ago = 0) => write(path.join(heldDir, `${String(Date.now() - ago).padStart(15, '0')}-${String(process.pid).padStart(8, '0')}-${String(++n).padStart(5, '0')}.json`), JSON.stringify({ line, target: pane, at: new Date(Date.now() - ago).toISOString() }));
  return { pane, dir, key, bytes, show, onEnter, quiet, held, heldDir, clearHeld, holdByHand };
}
const send = (T, text) => T.run(['send', 'supervisor', text, '--owner']);
const sendAsync = (T, text, extra = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(T.root, 'docs/devteam/scripts/devteam.mjs'), 'send', 'supervisor', text, '--owner'], { cwd: T.root, env: { ...T.env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('close', (status) => resolve({ status, out, err }));
});
const tick = (T) => { const r = T.run(['accounts-tick'], { DEVTEAM_ROLE: 'supervisor', DEVTEAM_CSWAP: 'off' }); assert.equal(r.status, 0, r.err); return r; };
const lockFile = (T, pane) => path.join(runDirOf(T), `type-lock-${pane}`);
const deadPid = () => spawnSync('true').pid;
// a lock as a holder writes one: its pid, and the stamp as the file's mtime
const holdLock = (T, pane, pid, ageMs = 0) => { const f = lockFile(T, pane); write(f, JSON.stringify({ pid, at: Date.now() - ageMs })); const t = new Date(Date.now() - ageMs); fs.utimesSync(f, t, t); return f; };
// what reached the pane, without the kit's [devteam … from …] heads on its messages
const plain = (b) => b.replace(/\[devteam [^\]\n]*\] /g, '');
const HELD_FLOOR = /recorded and held: [^\n]*the owner is typing a line/;

test('terminal A7: typeInto holds a line while the floor is open, and with no floor types at once', async () => {
  const T = termFixture('floor-a7-hold');
  after(() => T.done());
  const s = sup(T, SCREEN.typing);
  setReadable(T, s.pane);
  setFloor(T, s.pane, 'open');
  const r = send(T, 'first kit line');
  assert.equal(r.status, 0, r.err);
  assert.equal(plain(await s.quiet()), '', 'nothing typed into the owner\'s line');
  assert.match(`${r.err}\n${r.out}`, HELD_FLOOR);
  assert.equal(s.held().length, 1, 'held in run/held/');
  // with no floor (C9's control): typed at once, held lines first
  unsetOpt(T, s.pane, '@devteam-owner-floor');
  await s.show(SCREEN.ready);
  const r2 = send(T, 'second kit line');
  assert.equal(r2.status, 0, r2.err);
  await until(() => s.bytes().includes('second kit line'), 'the second line');
  assert.equal(plain(await s.quiet()), 'first kit line\rsecond kit line\r');
});

test('terminal A7: held lines go in once the floor is released, in order, once', async () => {
  const T = termFixture('floor-a7-release');
  after(() => T.done());
  const s = sup(T, SCREEN.ready);
  setReadable(T, s.pane);
  s.holdByHand('held one', 2000);
  s.holdByHand('held two', 1000);
  setFloor(T, s.pane, 'open');
  // an open floor on an empty prompt, past the settle: released (the owner cleared their line)
  const r = send(T, 'third');
  assert.equal(r.status, 0, r.err);
  await until(() => s.bytes().includes('third'), 'the third line');
  assert.equal(plain(await s.quiet()), 'held one\rheld two\rthird\r', 'each once, oldest first');
  assert.deepEqual(s.held(), []);
  assert.equal(floorOf(T, s.pane), '', 'a released floor is unset, so the kit\'s own half-typed line never holds its next write');
});

test('terminal A7: flushHeld keeps its lines past HELD_NO_INPUT_MS while the floor holds', async () => {
  const T = termFixture('floor-a7-flush');
  after(() => T.done());
  const s = sup(T, SCREEN.unknown);
  setReadable(T, s.pane);
  s.holdByHand('held three minutes', 3 * 60 * 1000);
  setFloor(T, s.pane, 'open');
  const r = send(T, 'kit line');
  assert.equal(r.status, 0, r.err);
  assert.equal(plain(await s.quiet()), '', 'the two-minute rule types nothing under the floor');
  assert.equal(s.held().length, 2);
  // the control: no floor, the same screen, and the two-minute rule types them
  unsetOpt(T, s.pane, '@devteam-owner-floor');
  assert.equal(send(T, 'kit line two').status, 0);
  await until(() => s.bytes().includes('kit line two'), 'the lines, by the two-minute rule');
});

test('terminal A7: flushAllHeld (accounts-tick) types nothing while the floor holds', async () => {
  const T = termFixture('floor-a7-flushall');
  after(() => T.done());
  const s = sup(T, SCREEN.unknown);
  setReadable(T, s.pane);
  s.holdByHand('held for the tick', 3 * 60 * 1000);
  setFloor(T, s.pane, 'open');
  tick(T);
  assert.equal(plain(await s.quiet()), '', 'accounts-tick typed nothing under the floor');
  assert.equal(s.held().length, 1);
  await s.show(SCREEN.ready);
  tick(T);
  await until(() => s.bytes().includes('held for the tick'), 'typed once the floor is released');
  assert.deepEqual(s.held(), []);
});

test('terminal A7: the lost-Enter rescue presses no Enter while the floor holds', async () => {
  const T = termFixture('floor-a7-lost-enter');
  after(() => T.done());
  const text = 'a kit line still sitting in the input box';
  const s = sup(T, box(`${PROMPT}${text}`));
  setReadable(T, s.pane);
  const sent = path.join(runDirOf(T), 'sent', `${encodeURIComponent(s.key)}.json`);
  write(sent, JSON.stringify({ text, at: new Date(Date.now() - 40000).toISOString() }));
  setFloor(T, s.pane, 'open');
  tick(T);
  assert.equal(plain(await s.quiet()), '', 'no Enter pressed on the owner\'s floor');
  assert.ok(fs.existsSync(sent), 'the record stays for a later look');
  // the control: no floor, and the rescue presses Enter
  unsetOpt(T, s.pane, '@devteam-owner-floor');
  tick(T);
  await until(() => s.bytes().includes('\r'), 'the rescue\'s Enter');
});

test("terminal A7: machine tell exits 3 'not told: the owner's line is open' while the floor holds", async () => {
  const T = termFixture('floor-a7-tell');
  after(() => T.done());
  const s = sup(T, SCREEN.ready);
  setReadable(T, s.pane);
  const tell = (extra = {}) => spawnSync(process.execPath, [path.join(T.root, 'docs/devteam/scripts/devteam.mjs'), 'machine', 'tell', '--in', path.dirname(T.root), '--', path.basename(T.root), 'disk is low'], { cwd: T.F.base, env: { ...T.env, DEVTEAM_TELL_SETTLE_SECONDS: '0.3', ...extra }, encoding: 'utf8' });
  setFloor(T, s.pane, 'open', 0);
  const r = tell();
  assert.equal(plain(await s.quiet()), '', 'nothing typed');
  assert.equal(r.status, 3, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /not told: the owner's line is open/);
  // the control: no floor, told
  unsetOpt(T, s.pane, '@devteam-owner-floor');
  const ok = tell();
  assert.equal(ok.status, 0, `${ok.stdout}${ok.stderr}`);
  assert.match(ok.stdout, /told \(pane/);
});

test('terminal A7: enterLanded presses no Enter once a floor appears', async () => {
  const T = termFixture('floor-a7-enter-landed');
  after(() => T.done());
  const s = sup(T, SCREEN.ready);
  setReadable(T, s.pane);
  // the message stays in the input after its Enter, so tell would press again
  s.onEnter(box(`${PROMPT}From the operator (information`));
  const done = new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(T.root, 'docs/devteam/scripts/devteam.mjs'), 'machine', 'tell', '--in', path.dirname(T.root), '--', path.basename(T.root), 'disk is low'], { cwd: T.F.base, env: { ...T.env, DEVTEAM_TELL_SETTLE_SECONDS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', (status) => resolve({ status, out }));
  });
  await until(() => s.bytes().includes('\r'), 'tell\'s own Enter');
  // a floor set by a writer that takes no lock (an older kit), inside tell's settle
  setFloor(T, s.pane, 'open', 0);
  const r = await done;
  assert.equal(s.bytes().split('\r').length - 1, 1, 'no second Enter under the floor');
  assert.equal(r.status, 3, r.out);
  assert.match(r.out, /not delivered: the owner began a line/);
});

test('terminal A7: release follows the floor rules (readable or not, done or open, each reading)', async () => {
  const T = termFixture('floor-a7-rules');
  after(() => T.done());
  const s = sup(T, SCREEN.ready);
  // [what, readable, floor, screen, typed]
  const cases = [
    ['a done floor, the line went in', true, 'done', SCREEN.ready, true],
    ['a done floor, the agent took the line', true, 'done', SCREEN.busy, true],
    ['an Enter that left words in the prompt', true, 'done', SCREEN.typing, false],
    ['an open floor, the prompt emptied', true, 'open', SCREEN.ready, true],
    ['an open floor, the agent took the line', true, 'open', SCREEN.busy, true],
    ['an open floor, words in the prompt', true, 'open', SCREEN.typing, false],
    ['a done floor on a prompt never read, past 3 s', false, 'done', SCREEN.unknown, true],
    ['an open floor on a prompt never read', false, 'open', SCREEN.unknown, false],
    ['a passing unknown on a readable pane', true, 'done', SCREEN.unknown, false],
    ['words in a prompt never read before: it is readable now', false, 'open', SCREEN.typing, false],
  ];
  let i = 0;
  for (const [what, readable, kind, screen, typed] of cases) {
    s.clearHeld();
    unsetOpt(T, s.pane, '@devteam-owner-floor');
    setReadable(T, s.pane, readable);
    await s.show(screen);
    const before = s.bytes();
    setFloor(T, s.pane, kind);
    const line = `case ${++i}`;
    const r = send(T, line);
    assert.equal(r.status, 0, `${what}: ${r.err}`);
    const got = plain((await s.quiet()).slice(before.length));
    assert.equal(got, typed ? `${line}\r` : '', `${what}: ${typed ? 'typed' : 'held'}`);
    assert.equal(floorOf(T, s.pane) === '', typed, `${what}: the floor ${typed ? 'released' : 'kept'}`);
  }
  assert.notEqual(opt(T, s.pane, '@devteam-prompt-readable'), '', 'the typing reading made the pane readable');
});

test('terminal A7b: a kit write waits for a key post, and a key post for a kit write', async () => {
  const T = termFixture('floor-a7b-lock');
  after(() => T.done());
  const s = sup(T, SCREEN.typing);
  setReadable(T, s.pane);
  // the dashboard's sends take 1.5 s, holding the lock that long
  write(path.join(T.F.base, 'tmux-delay.json'), JSON.stringify({ 'send-keys': 1500 }));
  const { port } = await T.dashboard();
  const tok = await tokenOf(T, port);
  const posted = keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 1, { data: '61' }));
  await pause(500);
  const t0 = Date.now();
  const r = await sendAsync(T, 'kit line');
  const p = await posted;
  assert.equal(p.status, 200, p.text);
  assert.equal(plain(await s.quiet()), 'a', 'the kit line never went in beside the owner\'s key');
  assert.ok(Date.now() - t0 >= 700, `the kit write waited for the key post (${Date.now() - t0} ms)`);
  assert.match(`${r.err}\n${r.out}`, HELD_FLOOR, 'and then found the owner\'s floor');
  // a key post waits 2 s for a lock a kit writer holds, then 503, nothing typed, its seq still free
  fs.rmSync(path.join(T.F.base, 'tmux-delay.json'));
  const f = holdLock(T, s.pane, process.pid);
  const t1 = Date.now();
  const busy = await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 2, { data: '62' }));
  assert.equal(busy.status, 503, busy.text);
  assert.ok(Date.now() - t1 >= 1900, `it waited the 2 s (${Date.now() - t1} ms)`);
  assert.equal(plain(await s.quiet()), 'a', 'nothing typed');
  fs.rmSync(f);
  const again = await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 2, { data: '62' }));
  assert.equal(again.status, 200, again.text);
  assert.equal(again.json.taken, true, 'the refused seq was free');
  assert.equal(plain(await s.quiet()), 'ab');
});

test("terminal A7b: nested writers on one chain don't deadlock (typeInto, flushHeld, typeNow)", async () => {
  const T = termFixture('floor-a7b-nested');
  after(() => T.done());
  const s = sup(T, SCREEN.ready);
  s.holdByHand('held before', 1000);
  const t0 = Date.now();
  const r = send(T, 'after it');
  assert.equal(r.status, 0, r.err);
  await until(() => s.bytes().includes('after it'), 'both lines');
  assert.ok(Date.now() - t0 < 5000, `no wait on its own lock (${Date.now() - t0} ms)`);
  assert.equal(plain(await s.quiet()), 'held before\rafter it\r');
});

test('terminal A7b: a dead holder is taken over at once, a stale one at 60 s, a live one never', async () => {
  const T = termFixture('floor-a7b-takeover');
  after(() => T.done());
  const s = sup(T, SCREEN.ready);
  // a live holder, fresh: the kit writer holds its line after 10 s, nothing typed, the lock left alone
  const f = holdLock(T, s.pane, process.pid);
  const t0 = Date.now();
  const r = send(T, 'behind a live holder');
  assert.equal(r.status, 0, r.err);
  assert.equal(plain(await s.quiet()), '', 'nothing typed past a live holder');
  assert.ok(Date.now() - t0 >= 9500, `it waited the 10 s (${Date.now() - t0} ms)`);
  assert.match(`${r.err}\n${r.out}`, /recorded and held: [^\n]*another writer/);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).pid, process.pid, 'the holder\'s lock is still its own');
  s.clearHeld();
  // a dead holder: taken at once
  holdLock(T, s.pane, deadPid());
  let t = Date.now();
  assert.equal(send(T, 'past a dead holder').status, 0);
  await until(() => s.bytes().includes('past a dead holder'), 'typed');
  assert.ok(Date.now() - t < 3000, `at once (${Date.now() - t} ms)`);
  // a live holder whose stamp is 61 s old: taken at once
  holdLock(T, s.pane, process.pid, 61000);
  t = Date.now();
  assert.equal(send(T, 'past a stale holder').status, 0);
  await until(() => s.bytes().includes('past a stale holder'), 'typed');
  assert.ok(Date.now() - t < 3000, `at once (${Date.now() - t} ms)`);
  assert.ok(!fs.existsSync(f), 'each writer removes its own lock when it is done');
});

test('terminal A7b and A7d: paneAnswer holds the lock from its look to its Enter, answers whatever the floor, and lets go before pane answered', async () => {
  const T = termFixture('floor-a7b-answer');
  after(() => T.done());
  const m = menuPane(T.F, 'menu:move,menu2:move,menu:move,input', T.root);
  const pane = tm(T, ['display', '-p', '-t', `=${m.target}`, '#{pane_id}']).stdout.trim();
  write(path.join(runDirOf(T), 'supervisor-pane'), `${pane}\n`);
  write(path.join(runDirOf(T), 'supervisor-pane-role'), `${pane}\n`);
  // the moment between paneAnswer's last look and its digit, inside its hold
  const { port } = await T.dashboard([], { DEVTEAM_HELLO_MS: '1000', DEVTEAM_PANE_ANSWER_DELAY_MS: '1500' });
  const tok = await tokenOf(T, port);
  const question = (not) => until(async () => { const r = await T.req(port, 'GET', '/api/threads', { headers: { 'sec-fetch-site': 'same-origin' } }); const q = r.json?.supervisor?.question; return q && q.kind === 'menu' && q.digest !== not ? q : null; }, 'the question');
  const answer = (q, option) => T.post(port, '/api/pane-answer', { digest: q.digest, option, token: q.token }, { 'sec-fetch-site': 'same-origin' });
  // a key post inside the hold lands after the Enter, never between the digit and it
  const q1 = await question();
  const answered = answer(q1, 2);
  await pause(500);
  const k = await keysTo(T, port, 'supervisor', keysBody(tok, pane, 1, { data: '7a' }));
  const a1 = await answered;
  assert.equal(a1.status, 200, a1.text);
  assert.equal(k.status, 200, k.text);
  assert.equal(m.typed(), '2\rz', 'the key post waited for the answer\'s Enter');
  // whatever the floor says: the owner's own press on a card
  setFloor(T, pane, 'open', 0);
  const q2 = await question(q1.digest);
  const a2 = await answer(q2, 2);
  assert.equal(a2.status, 200, a2.text);
  assert.equal(m.typed(), '2\rz2\r');
  // a line held while it asks, typed by pane answered's flush: the lock was let go before it ran
  unsetOpt(T, pane, '@devteam-owner-floor');
  const q3 = await question(q2.digest);
  const h = send(T, 'held while it asked');
  assert.equal(h.status, 0, h.err);
  const t0 = Date.now();
  const a3 = await answer(q3, 2);
  assert.equal(a3.status, 200, a3.text);
  await until(() => m.typed().includes('held while it asked'), 'the held line');
  assert.ok(Date.now() - t0 < 8000, `pane answered's flush took no wait on a held lock (${Date.now() - t0} ms)`);
});

test('terminal A7d: a done floor is released by dialog or limit after the 3 s settle; an open one is not; Escape keeps it', async () => {
  const T = termFixture('floor-a7d-settle');
  after(() => T.done());
  const s = sup(T, SCREEN.ready);
  setReadable(T, s.pane);
  const { port } = await T.dashboard();
  const tok = await tokenOf(T, port);
  let seq = 0;
  const key = async (hexData) => { const r = await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, ++seq, { data: hexData })); assert.equal(r.status, 200, r.text); return r; };
  const look = () => { const r = send(T, `look ${seq}`); assert.equal(r.status, 0, r.err); };
  // an Enter: done; a dialog comes up; inside the settle it holds, after it the dialog releases it
  await key('0d');
  assert.match(floorOf(T, s.pane), /^\d{13} done$/, 'the keys route records a done floor');
  await s.show(SCREEN.dialog);
  look();
  assert.match(floorOf(T, s.pane), /done$/, 'held inside the 3 s settle');
  await pause(3200);
  look();
  assert.equal(floorOf(T, s.pane), '', 'a done floor, released by the dialog after the settle');
  // Ctrl+C: done; a limit banner releases it after the settle
  await s.show(SCREEN.ready);
  await key('03');
  assert.match(floorOf(T, s.pane), /^\d{13} done$/, 'Ctrl+C records a done floor');
  await s.show(SCREEN.limit);
  await pause(3200);
  look();
  assert.equal(floorOf(T, s.pane), '', 'a done floor, released by a limit after the settle');
  // a key: open; a dialog and then a limit banner keep it
  await s.show(SCREEN.ready);
  await key('78');
  assert.match(floorOf(T, s.pane), /^\d{13} open$/, 'the keys route records an open floor');
  await s.show(SCREEN.dialog);
  await pause(3200);
  look();
  assert.match(floorOf(T, s.pane), /open$/, 'the owner\'s words come back when the menu closes');
  await s.show(SCREEN.limit);
  look();
  assert.match(floorOf(T, s.pane), /open$/, 'nor a limit');
  // Escape doesn't end a line
  unsetOpt(T, s.pane, '@devteam-owner-floor');
  await s.show(SCREEN.typing);
  await key('1b');
  assert.match(floorOf(T, s.pane), /^\d{13} open$/, 'Escape records an open floor');
  await pause(3200);
  look();
  assert.match(floorOf(T, s.pane), /open$/, 'held while the words are there');
  // a paste, even one ending in a newline: open
  unsetOpt(T, s.pane, '@devteam-owner-floor');
  const pasted = await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, ++seq, { data: undefined, paste: 'two lines\npasted\n' }));
  assert.equal(pasted.status, 200, pasted.text);
  assert.match(floorOf(T, s.pane), /^\d{13} open$/, 'a paste records an open floor');
});

test("terminal A7d: a floor that can't be recorded sends nothing, answers 503, and keeps the seq", async () => {
  const T = termFixture('floor-a7d-unrecorded');
  after(() => T.done());
  const s = sup(T, SCREEN.ready);
  const { port } = await T.dashboard();
  const tok = await tokenOf(T, port);
  write(path.join(T.F.base, 'tmux-fail.json'), JSON.stringify({ 'set-option': 'no such option' }));
  const r = await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 1, { data: '61' }));
  assert.equal(r.status, 503, r.text);
  assert.equal(plain(await s.quiet()), '', 'nothing sent without the floor');
  fs.rmSync(path.join(T.F.base, 'tmux-fail.json'));
  const ok = await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 1, { data: '61' }));
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.taken, true, 'the seq was kept');
  assert.equal(plain(await s.quiet()), 'a');
});

test('terminal A7: every send-keys and paste-buffer in the kit runs under a typing lock', () => {
  const src = fs.readFileSync(new URL('../docs/devteam/scripts/devteam.mjs', import.meta.url), 'utf8').split('\n');
  // each top-level declaration's lines, by its name
  const starts = [];
  src.forEach((l, i) => { const m = /^(?:async )?function\*? (\w+)|^(?:const|let) (\w+) = /.exec(l); if (m) starts.push({ name: m[1] ?? m[2], i }); });
  const bodyOf = (i) => { const k = starts.findLastIndex((d) => d.i <= i); const from = starts[k]; const to = starts[k + 1]?.i ?? src.length; return { name: from?.name, text: src.slice(from?.i ?? 0, to).join('\n') }; };
  // typeLine types into the operator's pane, never the supervisor's; the Shell's sends take no lock (terminal@1 §11)
  const EXEMPT = new Set(['typeLine']);
  const writes = src.map((l, i) => [l, i]).filter(([l]) => /['"](send-keys|paste-buffer)['"]/.test(l) && !/^\s*\/\//.test(l));
  assert.ok(writes.length >= 10, `found the kit's pane writes (${writes.length})`);
  for (const [l, i] of writes) {
    const { name, text } = bodyOf(i);
    if (EXEMPT.has(name)) continue;
    // a write's lock is its own, or (enterLanded, under machine tell's) one whose floor it reads
    assert.match(text, /typeLock(Async)?\b|ownerLineOpen\(/, `${name} types into a pane with no typing lock (line ${i + 1}: ${l.trim().slice(0, 80)})`);
  }
  // the supervisor's restart replaces its pane's process (respawn-pane, in replacePaneProcess) under the lock
  assert.match(bodyOf(starts.find((d) => d.name === 'restartSupervisor').i).text, /typeLock\b/, 'restartSupervisor replaces the pane with no typing lock');
});

test('terminal A7 (K3-1): a floor on a pane whose agent exited is cleared, before the settle', async () => {
  const T = termFixture('floor-k3-1-shell');
  after(() => T.done());
  const s = sup(T, SCREEN.ready);
  setReadable(T, s.pane);
  assert.equal(tm(T, ['respawn-pane', '-k', '-t', s.pane, 'sh']).status, 0);
  await until(() => opt(T, s.pane, 'pane_current_command') === 'sh', 'a shell');
  setFloor(T, s.pane, 'open', 0);
  const r = T.run(['status']);
  assert.equal(r.status, 0, r.err);
  assert.equal(floorOf(T, s.pane), '', 'the floor cleared on a shell pane');
  assert.equal(opt(T, s.pane, '@devteam-prompt-readable'), '', 'and the readable mark');
  assert.doesNotMatch(r.out, /owner's line open/);
});

test('terminal A7d: a key post waiting on the lock never delays a screen read', async () => {
  const T = termFixture('floor-a7d-async');
  after(() => T.done());
  const s = sup(T, SCREEN.ready);
  const { port } = await T.dashboard();
  const tok = await tokenOf(T, port);
  holdLock(T, s.pane, process.pid);
  const posted = keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 1, { data: '61' }));
  await pause(200);
  for (let i = 0; i < 5; i++) {
    const t = Date.now();
    const r = await screenOf(T, port);
    assert.equal(r.status, 200, r.text);
    assert.ok(Date.now() - t < 500, `a screen read while a post waits on the lock took ${Date.now() - t} ms`);
    await pause(150);
  }
  assert.equal((await posted).status, 503);
});

test("terminal A7e: the screen's held counts the supervisor's held lines, with the oldest one's age", async () => {
  const T = termFixture('floor-a7e-held');
  after(() => T.done());
  const s = sup(T, SCREEN.ready);
  const { port } = await T.dashboard();
  let r = await screenOf(T, port);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.held.count, r.json.held.oldest_ms], [0, 0], 'none held');
  s.holdByHand('one', 5000);
  s.holdByHand('two', 2000);
  s.holdByHand('three', 1000);
  await pause(1200);
  r = await screenOf(T, port);
  assert.equal(r.json.held.count, 3, JSON.stringify(r.json.held));
  assert.ok(r.json.held.oldest_ms >= 5000 && r.json.held.oldest_ms < 15000, `oldest_ms ${r.json.held.oldest_ms}`);
});

test("terminal A7e: the screen's held.prompt reads whether the supervisor's prompt is readable", async () => {
  const T = termFixture('floor-a7e-prompt');
  after(() => T.done());
  const s = sup(T, SCREEN.ready);
  const { port } = await T.dashboard();
  setReadable(T, s.pane, false);
  await pause(1200);
  let r = await screenOf(T, port);
  assert.equal(r.json.held.prompt, 'unknown', 'a pane never read readable');
  setReadable(T, s.pane, true);
  await pause(1200);
  r = await screenOf(T, port);
  assert.equal(r.json.held.prompt, 'readable');
});

test("terminal A7e: status shows the supervisor's pane as owner's line open while the floor holds", async () => {
  const T = termFixture('floor-a7e-status');
  after(() => T.done());
  const s = sup(T, SCREEN.typing);
  setReadable(T, s.pane);
  const line = new RegExp(`^supervisor +${s.pane} +\\[owner's line open\\]$`, 'm');
  setFloor(T, s.pane, 'open');
  const r = T.run(['status']);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, line);
  assert.notEqual(floorOf(T, s.pane), '', 'status only looks: it releases nothing');
  unsetOpt(T, s.pane, '@devteam-owner-floor');
  assert.doesNotMatch(T.run(['status']).out, /owner's line open/);
  // a floor a writer would release (past the settle, on a readable ready prompt): status shows no
  // open line, and leaves the floor set
  await s.show(SCREEN.ready);
  setFloor(T, s.pane, 'open', 5000);
  const ready = T.run(['status']);
  assert.equal(ready.status, 0, ready.err);
  assert.doesNotMatch(ready.out, /owner's line open/);
  assert.notEqual(floorOf(T, s.pane), '', 'status releases no floor, even one a writer would release');
});

test('terminal A7 (K3-1): a prompt-readable mark goes when the pane is marked anew or its agent exits', async () => {
  const T = termFixture('floor-k3-1');
  after(() => T.done());
  const s = sup(T, SCREEN.ready);
  const { port } = await T.dashboard();
  // marking a supervisor pane (a command run as the supervisor in it) clears both marks on it
  const other = sup(T, SCREEN.ready, 'sup2');
  write(path.join(runDirOf(T), 'supervisor-pane'), `${s.pane}\n`);
  write(path.join(runDirOf(T), 'supervisor-pane-role'), `${s.pane}\n`);
  setReadable(T, other.pane);
  setFloor(T, other.pane, 'open');
  const sock = `${T.env.TMUX_TMPDIR}/tmux-${process.getuid()}/default,1,0`;
  const r = T.run(['knowledge', 'add', '--kind', 'fact', '--statement', 'marks its pane'], { DEVTEAM_ROLE: 'supervisor', TMUX: sock, TMUX_PANE: other.pane });
  assert.equal(r.status, 0, r.err);
  assert.equal(fs.readFileSync(path.join(runDirOf(T), 'supervisor-pane-role'), 'utf8').trim(), other.pane, 'the command marked its pane');
  assert.equal(opt(T, other.pane, '@devteam-prompt-readable'), '', 'prompt-readable cleared on the pane it marks');
  assert.equal(floorOf(T, other.pane), '', 'and the floor');
  // the marked pane at a shell: the screen route clears its prompt-readable
  write(path.join(runDirOf(T), 'supervisor-pane'), `${s.pane}\n`);
  write(path.join(runDirOf(T), 'supervisor-pane-role'), `${s.pane}\n`);
  setReadable(T, s.pane);
  assert.equal(tm(T, ['respawn-pane', '-k', '-t', s.pane, 'sh']).status, 0);
  await until(() => opt(T, s.pane, 'pane_current_command') === 'sh', 'a shell');
  await until(async () => (await screenOf(T, port)).json?.state === 'gone', 'gone');
  await until(() => opt(T, s.pane, '@devteam-prompt-readable') === '', 'cleared when the agent exited');
});

test("terminal A7: the supervisor's restart at a usage limit replaces nothing while the owner's line is open", async () => {
  const F = recoveryFixture('floor-restart', { resume: CLAUDE_RESUME });
  after(() => F.done());
  F.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
  const pane = supervisorPane(F, MENU, { args: SKIP });
  await until(() => pane.shows().includes('Esc to cancel'), 'the menu');
  const tmx = (args) => spawnSync('tmux', args, { env: F.env(), encoding: 'utf8' });
  const id = tmx(['display', '-p', '-t', `=${F.session}:sup-pane`, '#{pane_id}']).stdout.trim();
  const pid = () => tmx(['display', '-p', '-t', id, '#{pane_pid}']).stdout.trim();
  const was = pid();
  const tickNow = () => F.tick({ DEVTEAM_CSWAP: F.cswap });
  assert.equal(tickNow(), '', 'the first tick: this project has not seen the account settle');
  // the owner typing at the limit menu's prompt: an open floor
  assert.equal(tmx(['set-option', '-p', '-t', id, '@devteam-owner-floor', `${Date.now() - 5000} open`]).status, 0);
  assert.doesNotMatch(tickNow(), /restarted the supervisor/);
  assert.equal(pid(), was, 'the pane\'s process is the same: nothing respawned over the owner\'s line');
  assert.deepEqual(F.claudeCalls(), [], 'no restart');
  assert.ok(!fs.existsSync(F.restartsFile) || !/"supervisor"/.test(fs.readFileSync(F.restartsFile, 'utf8')), 'no attempt spent');
  // the line ended, but a writer holds the pane's lock: the restart waits for it (10 s) and replaces nothing
  tmx(['set-option', '-p', '-u', '-t', id, '@devteam-owner-floor']);
  const lock = path.join(F.root, 'docs/devteam/run', `type-lock-${id}`);
  write(lock, JSON.stringify({ pid: process.pid, at: Date.now() }));
  assert.doesNotMatch(tickNow(), /restarted the supervisor/);
  assert.equal(pid(), was, 'nothing respawned while another writer held the lock');
  fs.rmSync(lock);
  assert.match(tickNow(), /restarted the supervisor/);
});
