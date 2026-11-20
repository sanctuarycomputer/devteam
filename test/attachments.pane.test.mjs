// Dropped files: the box's folder, a line too long, the supervisor's pane paste, and log-check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { askQuestion, laptop, LAPTOP, logLineCount, newFolderName, newThread, ownerLogFile, questionOf, R, upload } from './lib/attachments-fixture.mjs';
import { hasTmux, threadsFixture, until } from './lib/kit.mjs';

const TOO_LONG = /That is too long with its files; shorten it or attach fewer\./;
const openThreads = (L) => JSON.parse(L.dt(['thread', 'list', '--open', '--json']).stdout).length;

// --- the supervisor's pane gets the files as a pane drop does (spec §7) ------------------------------
// A stand-in for the supervisor's agent: in raw mode, with bracketed paste asked for (as Claude Code
// asks), so tmux wraps a paste in ESC[200~ … ESC[201~; every byte it gets is written down. It draws
// an input box, or first (menu) a numbered menu until it gets a 1, as Claude Code draws them.
const DROP_AGENT = `import fs from 'node:fs';
const [keys, first] = process.argv.slice(2);
const RULE = '─'.repeat(100);
let menu = first === 'menu', draft = '';
const shown = (s) => s.replace(/\\x1b\\[20[01]~/g, '').replace(/[\\x00-\\x1f\\x7f]/g, '');
const draw = () => process.stdout.write('\\x1b[2J\\x1b[H' + ['stand-in supervisor', ...(menu ? [RULE, ' Bash command', '', '   rm -rf  build', '', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No', '', ' Esc to cancel'] : [RULE, '❯ ' + shown(draft), RULE, '  ? for shortcuts'])].join('\\n') + '\\n');
process.stdin.setRawMode(true);
process.stdout.write('\\x1b[?2004h');
process.stdin.on('data', (d) => {
  fs.appendFileSync(keys, d);
  const s = String(d);
  if (menu) { if (s.includes('1')) menu = false; } else draft = (draft + s).split('\\r').pop();
  draw();
});
draw();
`;
const napMs = (ms) => new Promise((r) => setTimeout(r, ms));
function dropPane(F, first = 'input') {
  const dir = fs.mkdtempSync(path.join(F.base, 'drop-'));
  const keys = path.join(dir, 'keys.txt');
  fs.writeFileSync(path.join(dir, 'agent.mjs'), DROP_AGENT);
  const s = `drop-${path.basename(dir).slice(5)}`;
  // the fixture's own tmux (its TMUX_TMPDIR), never the session running the tests
  const e = F.env();
  delete e.TMUX;
  delete e.TMUX_PANE;
  spawnSync('tmux', ['new-session', '-d', '-x', '200', '-y', '40', '-s', s, '-n', 'main', '-c', F.old, `${process.execPath} ${path.join(dir, 'agent.mjs')} ${keys} ${first}`], { env: e });
  const shows = () => spawnSync('tmux', ['-u', 'capture-pane', '-p', '-t', `=${s}:main`], { env: e, encoding: 'utf8' }).stdout ?? '';
  return {
    target: `${s}:main`,
    key: `${s}:main`,
    shows,
    ready: () => until(() => (first === 'menu' ? /Esc to cancel/ : /\? for shortcuts/).test(shows()), 'the stand-in'),
    typed: () => (fs.existsSync(keys) ? fs.readFileSync(keys, 'utf8') : ''),
    press: (k) => spawnSync('tmux', ['send-keys', '-t', `=${s}:main`, k], { env: e }),
  };
}
// The box's folder, seeded by hand as the gateway would fill it: under the fixture, never the real
// HOME or /data/uploads.
function dropFixture(name) {
  const F = threadsFixture(name);
  const root = path.join(F.base, 'uploads');
  const folder = path.join(root, newFolderName());
  fs.mkdirSync(folder, { recursive: true });
  for (const n of ['shot.png', 'notes.pdf']) fs.writeFileSync(path.join(folder, n), `${n} bytes`);
  const file = (n) => ({ name: n, path: fs.realpathSync(path.join(folder, n)), bytes: `${n} bytes`.length });
  return { F, BOX: { DEVTEAM_GATEWAY: '1', DEVTEAM_UPLOADS_DIR: root }, png: file('shot.png'), pdf: file('notes.pdf') };
}
// What the pane got since `from` bytes, once `enters` more Enters have come and nothing more follows.
async function newBytes(pane, from, enters) {
  await until(() => (pane.typed().slice(from).match(/\r/g) ?? []).length >= enters, `${enters} Enter(s) in the pane`);
  await napMs(300);
  return pane.typed().slice(from);
}
const PANE = { skip: hasTmux ? false : 'no tmux', timeout: 240000 };

test('files: on a box the dropped files are the gateway\'s folder, never the laptop\'s (B5)', LAPTOP, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-attach-gwroot-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const folder = newFolderName();
  fs.mkdirSync(path.join(dir, folder));
  fs.writeFileSync(path.join(dir, folder, 'x.png'), 'png!');
  const L = await laptop(t, { DEVTEAM_GATEWAY: '1', DEVTEAM_UPLOADS_DIR: dir });
  const mine = path.join(L.folder(), newFolderName(), 'y.png');
  fs.mkdirSync(path.dirname(mine), { recursive: true });
  fs.writeFileSync(mine, 'png');
  const q1 = askQuestion(L, 'First?');
  const q2 = askQuestion(L, 'Second?');
  const before = logLineCount(L);
  const no = await L.api('answer', { id: q2, answer: 'Yes', files: [{ name: 'y.png', path: mine, bytes: 3 }] });
  assert.equal(no.status, 400, no.text);
  assert.ok(no.json.error.includes(mine), no.text);
  assert.ok(no.json.error.includes(`(${dir})`), `names the box's folder: ${no.text}`);
  assert.equal(logLineCount(L), before);
  const yes = await L.api('answer', { id: q1, answer: 'Yes', files: [{ name: 'x.png', path: path.join(dir, folder, 'x.png'), bytes: 1 }] });
  assert.equal(yes.status, 200, yes.text);
  assert.deepEqual(questionOf(L, q1).updates.find((u) => u.answer !== undefined).files, [{ name: 'x.png', path: fs.realpathSync(path.join(dir, folder, 'x.png')), bytes: 4 }]);
});

test('files: a line its files make too long is refused before anything is written; one exactly at the limit is kept (B7)', LAPTOP, async (t) => {
  const L = await laptop(t);
  const long = `${'n'.repeat(196)}.png`;
  assert.equal(long.length, R.name);
  const paths = [];
  for (let i = 0; i < 10; i++) paths.push(await upload(L, long, Buffer.from(`file ${i}`)));
  const ten = JSON.stringify(paths.map((p) => ({ name: long, path: p, bytes: 1 })));
  const words = 'w'.repeat(1900);
  const qid = askQuestion(L);
  const tid = newThread(L);
  const before = logLineCount(L);
  const threads = openThreads(L);
  for (const [what, args] of [
    ['thread say', ['thread', 'say', tid, '--files', ten, '--', words]],
    ['thread new', ['thread', 'new', '--title', 'Long', '--files', ten, '--', words]],
    ['answer', ['answer', qid, words, '--files', ten]],
  ]) {
    const r = L.dt(args);
    assert.notEqual(r.status, 0, `${what}: accepted`);
    assert.match(r.stderr, TOO_LONG, `${what}: ${r.stderr}`);
    assert.equal(logLineCount(L), before, `${what}: nothing written`);
    assert.equal(openThreads(L), threads, `${what}: no new thread`);
    assert.equal(questionOf(L, qid).updates.length, 0, `${what}: the question is still open`);
  }
  // one file of the longest name goes
  const ok = L.dt(['answer', qid, 'Yes', '--files', JSON.stringify([{ name: long, path: paths[0], bytes: 1 }])]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(questionOf(L, qid).updates.find((u) => u.answer !== undefined).files[0].name, long);
  // the size check builds the very line appendLog writes: exactly LINE_MAX goes, a byte more is refused with the files' words
  const q2 = askQuestion(L, 'Exactly?');
  const files = [{ name: long, path: fs.realpathSync(paths[1]), bytes: 6 }];
  const lineBytes = (answer) => Buffer.byteLength(`${JSON.stringify({ v: 1, id: q2, type: 'question', op: 'set', at: new Date().toISOString(), by: 'owner', channel: 'cli', answer, files, question_hash: '0'.repeat(16) })}\n`);
  const exact = 'a'.repeat(4096 - lineBytes(''));
  assert.equal(lineBytes(exact), 4096);
  const given = JSON.stringify([{ name: long, path: paths[1], bytes: 1 }]);
  const over = L.dt(['answer', q2, `${exact}a`, '--files', given]);
  assert.notEqual(over.status, 0, 'a byte over: accepted');
  assert.match(over.stderr, TOO_LONG, over.stderr);
  const at = L.dt(['answer', q2, exact, '--files', given]);
  assert.equal(at.status, 0, at.stderr);
  const last = fs.readFileSync(ownerLogFile(L), 'utf8').split('\n').filter(Boolean).pop();
  assert.equal(Buffer.byteLength(`${last}\n`), 4096, 'the line written is exactly LINE_MAX');
  assert.equal(JSON.parse(last).id, q2);
});

test('the supervisor\'s pane gets a turn\'s or an answer\'s files as a bracketed paste, and a line with none as today (B8)', PANE, async (t) => {
  const { F, BOX, png, pdf } = dropFixture('drop-pane');
  t.after(() => F.done());
  const pane = dropPane(F);
  await pane.ready();
  const S = { ...BOX, DEVTEAM_SUPERVISOR: pane.target };
  // a turn with no files: exactly the line and Enter
  const tid = F.owner(['thread', 'new', '--title', 'Shots', '--', 'first words'], S).split('\n')[0];
  const turnLine = (words) => `[devteam thread ${tid} from owner] ${words} — devteam.mjs thread show ${tid}`;
  let at = 0;
  let got = await newBytes(pane, at, 1);
  assert.equal(got, `${turnLine('first words')}\r`, 'no files: no space, no paste');
  at += got.length;
  // a .png and a .pdf: the line, a space, the paste, a space (a non-image is there), Enter
  assert.match(F.owner(['thread', 'say', tid, '--files', JSON.stringify([png, pdf]), '--', 'look at these'], S), /sent to the supervisor's pane/);
  got = await newBytes(pane, at, 1);
  assert.equal(got, `${turnLine('look at these')} (2 files dropped) \x1b[200~${png.path} ${pdf.path}\x1b[201~ \r`);
  at += got.length;
  // only the .png: no space after the paste
  F.owner(['thread', 'say', tid, '--files', JSON.stringify([png]), '--', 'just this'], S);
  got = await newBytes(pane, at, 1);
  assert.equal(got, `${turnLine('just this')} (1 file dropped) \x1b[200~${png.path}\x1b[201~\r`);
  at += got.length;
  // an answer: its nudge line, then the same paste
  const qid = F.sup(['ask', '--kind', 'owner-decision', '--question', 'Which one?']).split('\n')[0];
  F.owner(['answer', qid, 'This one', '--files', JSON.stringify([png, pdf])], S);
  got = await newBytes(pane, at, 1);
  assert.equal(got, `[devteam answer ${qid} from owner] read it with: devteam.mjs questions --id ${qid} (2 files dropped) \x1b[200~${png.path} ${pdf.path}\x1b[201~ \r`);
  // the tmux buffer went with the paste: nothing is left on the server
  const e = F.env();
  delete e.TMUX;
  assert.equal(spawnSync('tmux', ['list-buffers', '-F', '#{buffer_name}'], { env: e, encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith('devteam-drop-')).length, 0, 'no devteam-drop buffer left');
});

test('a turn with files held while the pane shows a menu keeps its paste, and is typed with it once the menu is answered (B9)', PANE, async (t) => {
  const { F, BOX, png, pdf } = dropFixture('drop-held');
  t.after(() => F.done());
  const pane = dropPane(F, 'menu');
  await pane.ready();
  const S = { ...BOX, DEVTEAM_SUPERVISOR: pane.target };
  // the thread, started with no pane named: recorded, typed nowhere
  const tid = F.owner(['thread', 'new', '--title', 'Shots', '--', 'first words'], BOX).split('\n')[0];
  assert.match(F.owner(['thread', 'say', tid, '--files', JSON.stringify([png, pdf]), '--', 'look at these'], S), /recorded and held/);
  await napMs(300);
  assert.equal(pane.typed(), '', 'not a byte reached the menu');
  const dir = path.join(F.old, 'docs/devteam/run/held', encodeURIComponent(pane.key));
  const held = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  assert.equal(held.length, 1);
  const rec = JSON.parse(fs.readFileSync(path.join(dir, held[0]), 'utf8'));
  assert.deepEqual(rec.paste, [png.path, pdf.path], 'the held record has the paste');
  // answered at the terminal; the next line flushes the held one first, with its paste
  pane.press('1');
  await until(() => /\? for shortcuts/.test(pane.shows()), 'the input box');
  F.owner(['thread', 'say', tid, '--', 'and this'], S);
  const got = await newBytes(pane, 0, 2);
  const turnLine = (words) => `[devteam thread ${tid} from owner] ${words} — devteam.mjs thread show ${tid}`;
  assert.equal(got, `1${turnLine('look at these')} (2 files dropped) \x1b[200~${png.path} ${pdf.path}\x1b[201~ \r${turnLine('and this')}\r`);
});

test('an answer with files run as the dashboard runs it (DEVTEAM_REPLY_FD) replies first, then reaches the pane with its paste (final review 1b F3)', PANE, async (t) => {
  const { F, BOX, png, pdf } = dropFixture('drop-reply');
  t.after(() => F.done());
  const pane = dropPane(F);
  await pane.ready();
  const qid = F.sup(['ask', '--kind', 'owner-decision', '--question', 'Which one?']).split('\n')[0];
  // the dashboard's runAction: the reply on fd 3, the nudge queued and typed after it
  const r = spawnSync(process.execPath, [path.join(F.old, 'docs/devteam/scripts/devteam.mjs'), 'answer', qid, 'This one', '--files', JSON.stringify([png, pdf])], { cwd: F.old, env: { ...F.env({ ...BOX, DEVTEAM_SUPERVISOR: pane.target }), DEVTEAM_REPLY_FD: '3' }, stdio: ['ignore', 'pipe', 'pipe', 'pipe'], encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(String(r.output[3]), /"out":"answered /, 'the reply came on fd 3');
  const got = await newBytes(pane, 0, 1);
  assert.equal(got, `[devteam answer ${qid} from owner] read it with: devteam.mjs questions --id ${qid} (2 files dropped) \x1b[200~${png.path} ${pdf.path}\x1b[201~ \r`);
});

test('log-check: files are on the owner\'s own turn and answer, never a supervisor\'s turn or an answer recorded from chat or a thread (task review T5-1)', { timeout: 240000 }, (t) => {
  const { F, png } = dropFixture('drop-log');
  t.after(() => F.done());
  const tid = F.owner(['thread', 'new', '--title', 'Shots', '--', 'first words']).split('\n')[0];
  const qid = F.sup(['ask', '--kind', 'owner-decision', '--question', 'Which one?']).split('\n')[0];
  const files = [png];
  // each line as it may be, then with files: only the files are refused
  for (const [what, by, o] of [
    ['a supervisor turn', 'supervisor', { type: 'turn', thread: tid, text: 'here' }],
    ['an answer from chat', 'owner', { type: 'question', op: 'set', id: qid, answer: 'Yes', channel: 'chat', said: 'yes' }],
    // files are set on a question only with the owner's answer, never on its new line (x-set-only; final review 1b F4)
    ['a question\'s new line', 'supervisor', { type: 'question', kind: 'owner-decision', question: 'Which one?' }],
  ]) {
    const plain = F.checkWith([by, o]);
    assert.equal(plain.status, 0, `${what} without files: ${plain.said}`);
    const r = F.checkWith([by, { ...o, files }]);
    assert.notEqual(r.status, 0, `${what} with files: log-check passed`);
    assert.match(r.said, /files/, `${what}: names files`);
  }
  // the owner's own turn with files passes
  const own = F.checkWith(['owner', { type: 'turn', thread: tid, text: 'mine', files }]);
  assert.equal(own.status, 0, own.said);
});
