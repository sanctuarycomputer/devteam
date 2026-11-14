// A question in an agent's terminal (a tool that wants a person's yes): read from the pane, never
// answered by a message typed into it, answered by the owner from the dashboard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { kit, testDir, freePort, write, startDashboard, until, threadsFixture, hasTmux } from './lib/kit.mjs';
import { canDrive, openChrome } from './lib/chrome.mjs';

// The parser, loaded from the script by itself.
const fns = (() => {
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const i = src.indexOf('/* pane question start */'), j = src.indexOf('/* pane question end */');
  assert.ok(i >= 0 && j > i, 'the pane question block in devteam.mjs');
  const f = vm.runInContext(`${src.slice(i, j)}\n;({ paneQuestionIn, paneAskingIn })`, vm.createContext({ crypto, UNSAFE_TEXT_ALL: /[\u0000-\u0008\u000b-\u001f\u007f]/g }));
  // as this realm's own objects, so deepEqual compares them
  const plain = (x) => JSON.parse(JSON.stringify(x ?? null));
  return { paneQuestionIn: (l) => plain(f.paneQuestionIn(l)), paneAskingIn: (l) => plain(f.paneAskingIn(l)) };
})();
const screen = (text) => text.replace(/\s+$/, '').split('\n');
const RULE = '─'.repeat(100);
// Claude Code idle at its input box, under whatever it last said.
const idle = (said) => `${said}\n\n${RULE}\n❯ \n${RULE}\n  ⏸ manual mode on · ? for shortcuts`;

test("a Claude Code permission menu, as its terminal showed it (2.1.325): the dialog's words, each option, the one under the cursor", () => {
  const q = fns.paneQuestionIn(screen(fs.readFileSync(path.join(testDir, 'fixtures', 'pane', 'claude-code-permission.txt'), 'utf8')));
  assert.equal(q.question.split('\n').pop(), 'Do you want to proceed?');
  assert.match(q.question, /^Bash command\n/, 'from the top of the dialog, not the conversation above its rule');
  assert.match(q.question, /touch probe\.txt/);
  assert.doesNotMatch(q.question, /Run exactly this/, "the owner's own prompt is above the dialog");
  assert.deepEqual(q.options.map((o) => [o.n, o.label]), [[1, 'Yes'], [2, 'Yes, and always allow access to /home/dev/projects/acme from this project'], [3, 'Yes, and switch to auto mode · auto mode handles these prompts for you'], [4, 'No']], 'a wrapped label is one option');
  assert.equal(q.selected, 1);
  assert.match(q.digest, /^[0-9a-f]{40}$/);
  assert.equal(fns.paneAskingIn(screen(fs.readFileSync(path.join(testDir, 'fixtures', 'pane', 'claude-code-permission.txt'), 'utf8'))).kind, 'menu');
});

test("another account's artifact: the consent prompt, boxed or not, with the cursor on either option; the digest is the question's, not the cursor's", () => {
  const plain = (sel) => `● Artifact(read)\n\n${RULE}\n Artifact\n\n Claude wants to read someone else's artifact at\n https://claude.ai/artifact/0f1e2d3c\n\n ${sel === 1 ? '❯' : ' '} 1. Yes\n ${sel === 2 ? '❯' : ' '} 2. No\n\n Esc to cancel`;
  const a = fns.paneQuestionIn(screen(plain(1)));
  const b = fns.paneQuestionIn(screen(plain(2)));
  assert.equal(a.question, "Artifact\nClaude wants to read someone else's artifact at\nhttps://claude.ai/artifact/0f1e2d3c");
  assert.deepEqual([a.selected, b.selected], [1, 2]);
  assert.equal(a.digest, b.digest, 'moving the cursor is the same question');
  assert.notEqual(fns.paneQuestionIn(screen(plain(1).replace('0f1e2d3c', 'ffffffff'))).digest, a.digest, 'another artifact is another question');
  const boxed = `╭${'─'.repeat(60)}╮\n│ Artifact${' '.repeat(52)}│\n│${' '.repeat(60)}│\n│ Claude wants to read someone else's artifact at${' '.repeat(13)}│\n│ https://claude.ai/artifact/0f1e2d3c${' '.repeat(25)}│\n│ ❯ 1. Yes${' '.repeat(52)}│\n│   2. No${' '.repeat(53)}│\n╰${'─'.repeat(60)}╯`;
  const c = fns.paneQuestionIn(screen(boxed));
  assert.deepEqual([c.question, c.options.map((o) => o.label), c.selected], [a.question, ['Yes', 'No'], 1], "a box's sides drop out");
  assert.equal(c.digest, a.digest);
});

test('nothing recognisable is no question: a numbered list in a reply, numbered code, a diff, a busy agent, a list with no cursor or two', () => {
  const none = (text, why) => assert.equal(fns.paneQuestionIn(screen(text)), null, why);
  none(idle('● Two ways to do it:\n\n  1. Yes, the first\n  2. No, the second'), 'a list in a reply, above the input box');
  none(idle('● Pick one:\n\n❯ 1. Yes\n  2. No'), 'even one drawn like a menu: the input box under it says nothing is asked');
  none(idle('● Read(src/a.js)\n  ⎿  1  function greet() {\n     2 -  console.log("Hello");\n     2 +  console.log("Hi");\n     3  }'), 'numbered source and a diff');
  none(idle('> 1. a quoted list\n> 2. of two'), 'quoted lines');
  none(' Security notes:\n\n 1. Claude can make mistakes.\n    Review what it does.\n\n 2. Only use it with code you trust\n\n Press Enter to continue…', 'a numbered notice has no cursor');
  none(' Pick:\n ❯ 1. Yes\n ❯ 2. No\n\n Esc to cancel', 'two cursors');
  none(' Pick:\n ❯ 2. Yes\n   3. No\n\n Esc to cancel', 'not numbered from 1');
  none(' Pick:\n ❯ 1. Only one\n\n Esc to cancel', 'one option is not a choice');
  none('● Working on it\n ❯ 1. Yes\n   2. No\n\n✻ Thinking… (12s · esc to interrupt)', 'an agent at work is not waiting');
  none(` ❯ 1. Yes\n   2. No\n${Array.from({ length: 6 }, (_, i) => `line ${i}`).join('\n')}`, 'a menu that is not the last thing in the pane');
  assert.equal(fns.paneAskingIn(screen(idle('● Do you want to proceed? [y/n] Press Enter to continue'))), null, "the agent's own words hold nothing");
});

test('a dialog with no numbers still holds what is typed: Enter would confirm it', () => {
  const trust = ` Accessing workspace:\n\n /home/dev/projects/acme\n\n Security guide\n\n ❯ No, exit\n   Yes, I trust this folder\n\n Enter to confirm · Esc to cancel`;
  assert.equal(fns.paneQuestionIn(screen(trust)), null, 'no options a digit could pick');
  assert.equal(fns.paneAskingIn(screen(trust)).kind, 'confirm');
  assert.equal(fns.paneAskingIn(screen(' Security notes:\n\n 1. Claude can make mistakes.\n\n Press Enter to continue…')).kind, 'confirm');
});

// A stand-in for the supervisor's agent with a menu up, as Claude Code draws one: in raw mode, so a
// key reaches it as it is pressed, and every byte it is sent is written down. digit: a digit picks
// (Claude Code's menus); move: a digit moves the cursor and Enter picks; deaf: only Enter picks.
// Once answered it shows no menu and just takes lines.
const AGENT = `import fs from 'node:fs';
const [keys, mode] = process.argv.slice(2);
const OPTS = ['Yes', 'No'];
let sel = 1, answer = 0;
const draw = () => {
  process.stdout.write('\\x1b[2J\\x1b[H');
  if (answer) return process.stdout.write('stand-in supervisor\\nanswered ' + answer + '\\n');
  process.stdout.write(['stand-in supervisor', '${'─'.repeat(70)}', ' Artifact', '', " Claude wants to read someone else's artifact at", ' https://claude.ai/artifact/0f1e2d3c <img src=x onerror=window.__pwned=1>', '', ...OPTS.map((o, i) => ' ' + (i + 1 === sel ? '❯' : ' ') + ' ' + (i + 1) + '. ' + o), '', ' Esc to cancel', ''].join('\\n'));
};
process.stdin.setRawMode(true);
process.stdin.on('data', (d) => {
  fs.appendFileSync(keys, String(d));
  for (const ch of String(d)) {
    if (answer) break;
    const n = Number(ch);
    if (n >= 1 && n <= OPTS.length) { if (mode === 'digit') answer = n; else if (mode === 'move') sel = n; }
    else if (ch === '\\r') answer = sel;
  }
  draw();
});
draw();
`;
function menuPane(F, mode = 'digit') {
  const dir = fs.mkdtempSync(path.join(F.base, 'menu-'));
  const keys = path.join(dir, 'keys.txt');
  write(path.join(dir, 'agent.mjs'), AGENT);
  const s = `ask-${path.basename(dir).slice(5)}`;
  const e = F.env();
  spawnSync('tmux', ['new-session', '-d', '-x', '120', '-y', '40', '-s', s, '-n', 'main', `${process.execPath} ${path.join(dir, 'agent.mjs')} ${keys} ${mode}`], { env: e });
  const shows = () => spawnSync('tmux', ['capture-pane', '-p', '-t', `=${s}:main`], { env: e, encoding: 'utf8' }).stdout ?? '';
  for (let i = 0; i < 300 && !/2\. No/.test(shows()); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  return { target: `${s}:main`, key: `${s}:main`, typed: () => (fs.existsSync(keys) ? fs.readFileSync(keys, 'utf8') : ''), shows, press: (k) => spawnSync('tmux', ['send-keys', '-t', `=${s}:main`, k], { env: e }) };
}
const heldFor = (F, pane) => { try { return fs.readdirSync(path.join(F.old, 'docs/devteam/run/held', encodeURIComponent(pane.key))).filter((n) => n.endsWith('.json')).sort(); } catch { return []; } };
const acts = (F) => fs.readdirSync(F.logDir).flatMap((f) => fs.readFileSync(path.join(F.logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))).filter((l) => l.type === 'act' && l.class === 'pane-answer');

test("a message for a pane that is asking is held, not typed; the owner's answer is one digit, checked against the question showing; then the held lines are typed, in order, once", { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const F = threadsFixture('pane-held');
  t.after(() => F.done());
  const pane = menuPane(F);
  const S = { DEVTEAM_SUPERVISOR: pane.target };
  const q = JSON.parse(F.owner(['pane', 'question', '--json'], S));
  assert.equal(q.question.split('\n')[1], "Claude wants to read someone else's artifact at");
  assert.deepEqual([q.options.map((o) => o.label), q.selected], [['Yes', 'No'], 1]);
  assert.equal(JSON.parse(F.owner(['hello', '--json', '--no-kit', '--pane'], S)).supervisor_question.digest, q.digest);
  assert.match(JSON.parse(F.owner(['hello', '--json', '--no-kit', '--pane'], S)).pulse.attention[0], /terminal is asking you a question/);
  assert.equal(JSON.parse(F.owner(['hello', '--json', '--no-kit'], S)).supervisor_question, undefined, 'only when asked: tmux is not read for a plain hello');
  // the owner's words in a thread, and a message: logged, held, and nothing typed into the menu
  assert.match(F.owner(['thread', 'new', 'Approved here'], S), /held: the supervisor's terminal is asking a question/);
  const sent = F.run(F.old, ['send', 'supervisor', 'second line', '--owner'], S);
  assert.equal(sent.status, 0, sent.err);
  assert.match(sent.err, /recorded and held/);
  F.sup(['observe', '--kind', 'note', '--subject', 'x', '--detail', 'nothing to do with panes'], S);
  assert.equal(pane.typed(), '', 'not a byte reached the menu');
  assert.equal(heldFor(F, pane).length, 2);
  assert.equal(JSON.parse(F.owner(['pane', 'question', '--json'], S)).digest, q.digest, 'the question is as it was');
  // an answer to another question, a bad option, an agent session: refused, and nothing sent
  assert.match(F.fails(['pane', 'answer', '--digest', 'f'.repeat(40), '--option', '1', '--owner'], S), /has changed since the page showed it/);
  assert.match(F.fails(['pane', 'answer', '--digest', q.digest, '--option', '3', '--owner'], S), /no option 3/);
  assert.match(F.fails(['pane', 'answer', '--digest', q.digest, '--option', '1'], S), /usage: pane question/);
  assert.match(F.fails(['pane', 'answer', '--digest', q.digest, '--option', '1', '--owner'], { ...S, DEVTEAM_ROLE: 'supervisor' }), /owner commands don't run in an agent session/);
  assert.match(F.fails(['pane', 'answer', '--digest', q.digest, '--option', '1; rm -rf /', '--owner'], S), /an option is its number/);
  assert.equal(pane.typed(), '');
  assert.equal(acts(F).length, 0);
  // the owner's answer: the digit, and only then the held lines
  assert.equal(F.owner(['pane', 'answer', '--digest', q.digest, '--option', '1', '--owner'], S), 'answered: 1. Yes');
  await until(() => /second line/.test(pane.typed()), 'the held lines');
  const typed = pane.typed();
  assert.equal(typed[0], '1', 'the first byte the pane got is the digit');
  assert.match(typed, /^1\[devteam thread t-\S+ from owner\] Approved here — devteam\.mjs thread show t-\S+\r\[devteam info m-\S+ from owner\] second line\r$/, 'then each held line, in order, once, with its Enter');
  assert.equal(heldFor(F, pane).length, 0);
  assert.match(pane.shows(), /answered 1/);
  const [act] = acts(F);
  assert.deepEqual([acts(F).length, act.by, act.channel], [1, 'owner', 'cli']);
  assert.match(act.what, new RegExp(`^answered the supervisor's terminal: "https://claude\\.ai/artifact/0f1e2d3c .*" with 1\\. Yes \\(keys: 1; question ${q.digest}\\)$`));
  assert.equal(F.run(F.old, ['log-check']).status, 0, "the owner's act passes the log's checks");
  // gone now: an answer to it is refused, and a message is typed at once
  assert.match(F.fails(['pane', 'answer', '--digest', q.digest, '--option', '2', '--owner'], S), /not asking anything now/);
  assert.match(F.owner(['thread', 'new', 'And now'], S), /sent to the supervisor's pane/);
  await until(() => /And now/.test(pane.typed()), 'a line typed with no question up');
  // an agent may not write the owner's act
  const forged = F.checkWith(['supervisor', { type: 'act', id: 'a-20990101-000000000-supervisor', class: 'pane-answer', what: 'answered it myself' }]);
  assert.match(forged.said, /pane-answer is the owner's/);
});

test('a menu whose digit only moves the cursor gets the Enter; one that takes no digit is left as it is, and said so', { skip: hasTmux ? false : 'no tmux' }, () => {
  const F = threadsFixture('pane-keys');
  try {
    const move = menuPane(F, 'move');
    let S = { DEVTEAM_SUPERVISOR: move.target };
    let q = JSON.parse(F.owner(['pane', 'question', '--json'], S));
    assert.equal(F.owner(['pane', 'answer', '--digest', q.digest, '--option', '2', '--owner'], S), 'answered: 2. No');
    assert.equal(move.typed(), '2\r');
    assert.match(move.shows(), /answered 2/);
    assert.match(acts(F)[0].what, /with 2\. No \(keys: 2, Enter;/);
    const deaf = menuPane(F, 'deaf');
    S = { DEVTEAM_SUPERVISOR: deaf.target };
    q = JSON.parse(F.owner(['pane', 'question', '--json'], S));
    assert.match(F.fails(['pane', 'answer', '--digest', q.digest, '--option', '2', '--owner'], S), /did not take the key 2 .*answer it in the terminal/);
    assert.equal(deaf.typed(), '2', 'no Enter: it would have taken option 1');
    assert.match(deaf.shows(), /❯ 1\. Yes/);
    assert.equal(acts(F).length, 1, 'nothing answered, nothing logged');
    // the option the cursor is on already: the digit changes nothing, and Enter takes it
    assert.equal(F.owner(['pane', 'answer', '--digest', q.digest, '--option', '1', '--owner'], S), 'answered: 1. Yes');
    assert.equal(deaf.typed(), '21\r');
  } finally { F.done(); }
});

test('held lines are typed once each, in the order they came, however many processes look at once', { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const F = threadsFixture('pane-race');
  t.after(() => F.done());
  const pane = menuPane(F);
  const S = { DEVTEAM_SUPERVISOR: pane.target };
  for (let i = 0; i < 6; i++) assert.equal(F.run(F.old, ['send', 'supervisor', `held ${i}`, '--owner'], S).status, 0);
  assert.equal(heldFor(F, pane).length, 6);
  // a tick with the question still up types nothing
  assert.equal(F.run(F.old, ['accounts-tick'], { ...S, ...F.SUP }).status, 0);
  assert.equal(pane.typed(), '');
  // answered at the terminal itself; then eight processes at once: ticks, and new messages
  pane.press('2');
  await until(() => /answered 2/.test(pane.shows()), 'the answer');
  const DT = path.join(F.old, 'docs/devteam/scripts/devteam.mjs');
  const go = (args, role) => new Promise((resolve) => execFile(process.execPath, [DT, ...args], { cwd: F.old, env: F.env({ ...S, ...role }) }, (err, so, se) => resolve({ err, se })));
  const rs = await Promise.all([...Array.from({ length: 4 }, () => go(['accounts-tick'], F.SUP)), ...Array.from({ length: 4 }, (_, i) => go(['send', 'supervisor', `late ${i}`, '--owner'], {}))]);
  for (const r of rs) assert.equal(r.err, null, r.se);
  // whatever a race left held goes with the next look
  await until(() => { if (heldFor(F, pane).length) F.run(F.old, ['accounts-tick'], { ...S, ...F.SUP }); return !heldFor(F, pane).length && /late 0/.test(pane.typed()) && /late 1/.test(pane.typed()) && /late 2/.test(pane.typed()) && /late 3/.test(pane.typed()); }, 'every line typed');
  const lines = pane.typed().slice(1).split('\r').filter(Boolean).map((l) => l.replace(/^\[devteam info \S+ from owner\] /, ''));
  assert.deepEqual([...lines].sort(), ['held 0', 'held 1', 'held 2', 'held 3', 'held 4', 'held 5', 'late 0', 'late 1', 'late 2', 'late 3'], 'each line once, none lost');
  assert.deepEqual(lines.slice(0, 6), ['held 0', 'held 1', 'held 2', 'held 3', 'held 4', 'held 5'], 'what was held first is typed first, in order');
  assert.deepEqual(fs.readdirSync(path.join(F.old, 'docs/devteam/run/held')).filter((n) => n.includes('.claim-')), [], 'no claim left behind');
});

test("a claim whose process died goes back as it was: its lines are typed by the next look, none lost", { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const F = threadsFixture('pane-dead-claim');
  t.after(() => F.done());
  const pane = menuPane(F);
  const S = { DEVTEAM_SUPERVISOR: pane.target };
  for (let i = 0; i < 2; i++) F.run(F.old, ['send', 'supervisor', `kept ${i}`, '--owner'], S);
  const root = path.join(F.old, 'docs/devteam/run/held');
  const dead = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).stdout.trim();
  fs.renameSync(path.join(root, encodeURIComponent(pane.key)), path.join(root, `${encodeURIComponent(pane.key)}.claim-${dead}`));
  pane.press('1');
  await until(() => /answered 1/.test(pane.shows()), 'the answer');
  assert.equal(F.run(F.old, ['accounts-tick'], { ...S, ...F.SUP }).status, 0);
  await until(() => /kept 1/.test(pane.typed()), 'the lines of the dead claim');
  assert.match(pane.typed(), /^1\[devteam info \S+ from owner\] kept 0\r\[devteam info \S+ from owner\] kept 1\r$/);
  assert.deepEqual(fs.readdirSync(root), []);
});

test("the dashboard: the question in /api/threads and the hub's pulse; an answer only from this page, only a digit, only to the question showing", { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const F = threadsFixture('pane-route');
  t.after(() => F.done());
  const pane = menuPane(F);
  const port = await freePort();
  const B = `http://127.0.0.1:${port}`;
  const d = startDashboard(F.old, F.env({ DEVTEAM_SUPERVISOR: pane.target }), ['--port', String(port)]);
  t.after(() => d.stop());
  await until(() => new RegExp(`dashboard on http://127\\.0\\.0\\.1:${port}\\b`).test(d.out()), 'the dashboard');
  const asked = () => fetch(`${B}/api/threads`).then((r) => r.json()).then((j) => j.supervisor.question);
  const q = await until(asked, 'the question, from the hello child');
  assert.deepEqual([q.options, q.selected], [[{ n: 1, label: 'Yes' }, { n: 2, label: 'No' }], 1]);
  assert.match(q.question, /someone else's artifact/);
  assert.match((await (await fetch(`${B}/api/hello`)).json()).pulse.attention[0], /terminal is asking you a question/);
  const post = (body, headers = {}) => fetch(`${B}/api/pane-answer`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const good = { digest: q.digest, option: 2 };
  // not this page: another origin, another site, a form's content type
  assert.equal((await post(good, { origin: 'http://evil.example' })).status, 403);
  assert.equal((await post(good, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await post(good, { 'content-type': 'text/plain' })).status, 403);
  // not an option's number, not a digest, too big
  for (const bad of [{ ...good, option: 0 }, { ...good, option: 10 }, { ...good, option: '2' }, { ...good, option: 1.5 }, { ...good, digest: 'nope' }, { option: 2 }, { ...good, keys: 'rm -rf /' , option: null }]) assert.equal((await post(bad)).status, 400, JSON.stringify(bad));
  assert.equal(await post(JSON.stringify({ ...good, pad: 'x'.repeat(30000) })).then((r) => r.status, () => 'cut off') === 200, false, 'a body over the cap is not an answer');
  // another question's digest: refused, and it says why
  let r = await post({ digest: 'a'.repeat(40), option: 2 });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /has changed since the page showed it/);
  assert.equal(pane.typed(), '', 'nothing reached the terminal');
  // the owner's words meanwhile, from the page: held
  r = await fetch(`${B}/api/thread-new`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Import it', text: 'Approved here' }) });
  assert.equal(r.status, 200);
  assert.match((await r.json()).out, /held: the supervisor's terminal is asking/);
  assert.equal(pane.typed(), '');
  // the answer
  r = await post(good);
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(await r.json(), { ok: true, out: 'answered: 2. No' });
  await until(() => /Approved here/.test(pane.typed()), 'the held words, after the answer');
  assert.match(pane.typed(), /^2\[devteam thread \S+ from owner\] Approved here — [^\r]*\r$/, 'the digit alone, then the held line');
  const [act] = acts(F);
  assert.deepEqual([acts(F).length, act.by, act.channel], [1, 'owner', 'dashboard']);
  await until(async () => (await asked()) === null, 'the question gone from /api/threads');
  r = await post(good);
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /not asking anything now/);
});

test("the dashboard page: the card at the top of the Inbox and in the dock, the terminal's words as text, at phone width; a click answers", { skip: !hasTmux ? 'no tmux' : canDrive ? false : 'no Chrome to drive' }, async (t) => {
  const F = threadsFixture('pane-page');
  t.after(() => F.done());
  const pane = menuPane(F);
  const port = await freePort();
  const B = `http://127.0.0.1:${port}`;
  const d = startDashboard(F.old, F.env({ DEVTEAM_SUPERVISOR: pane.target }), ['--port', String(port)]);
  t.after(() => d.stop());
  await until(() => new RegExp(`dashboard on http://127\\.0\\.0\\.1:${port}\\b`).test(d.out()), 'the dashboard');
  await until(() => fetch(`${B}/api/threads`).then((r) => r.json()).then((j) => j.supervisor.question), 'the question');
  const chrome = await openChrome();
  t.after(() => chrome.close());
  const p = await chrome.newPage();
  await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
  await p.send('Page.navigate', { url: `${B}/#inbox` });
  const soon = async (expr, what) => until(() => p.ev(expr).catch(() => false), what);
  await soon(`!!document.querySelector('#ask-inbox [data-ask-option]')`, 'the card in the Inbox');
  const card = await p.ev(`(() => { const c = document.querySelector('#ask-inbox .ask'); const r = c.getBoundingClientRect(); return { text: c.innerText, imgs: c.querySelectorAll('img').length, pwned: window.__pwned === 1, left: r.left, right: r.right, vw: innerWidth, page: document.documentElement.scrollWidth, buttons: [...c.querySelectorAll('[data-ask-option]')].map((b) => b.innerText.trim()), first: !c.parentElement.previousElementSibling || c.parentElement.previousElementSibling.tagName === 'H2' }; })()`);
  assert.match(card.text, /The supervisor's terminal is asking/);
  assert.match(card.text, /Claude wants to read someone else's artifact at/);
  assert.match(card.text, /<img src=x onerror=window\.__pwned=1>/, "the terminal's words, as text");
  assert.deepEqual([card.imgs, card.pwned], [0, false], 'never markup');
  assert.deepEqual(card.buttons, ['1. Yes', '2. No']);
  assert.ok(card.first, 'above the questions');
  assert.ok(card.left >= 0 && card.right <= card.vw && card.page <= card.vw, `inside a phone's width: ${JSON.stringify(card)}`);
  // in the dock too, where the owner was talking
  assert.match(await p.ev(`document.getElementById('tl-pill').innerText`), /terminal asking/);
  await p.click('#tl-pill');
  await soon(`!!document.querySelector('#ask-dock [data-ask-option]')`, 'the card in the dock');
  await p.click('#tl-pill');
  await p.click('#ask-inbox [data-ask-option="1"]');
  await until(() => pane.typed() === '1', 'the digit in the terminal');
  await soon(`!document.querySelector('[data-ask-option]') && /Sent to the supervisor's terminal: 1\\. Yes/.test(document.getElementById('ask-inbox').innerText)`, 'the card gone, and what was sent');
  assert.equal(pane.typed(), '1');
  assert.equal(acts(F)[0].channel, 'dashboard');
});
