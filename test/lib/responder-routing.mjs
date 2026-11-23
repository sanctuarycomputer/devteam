// The fixture both responder-routing test files share (kit-104): a fleet session with a stand-in
// responder agent in its window, the supervisor's stand-in pane, and helpers that write log lines.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hasTmux, threadsFixture, write } from './kit.mjs';

export const MIN = 60000;
export const SUP = { DEVTEAM_ROLE: 'supervisor' };
export const RESPONDER = { DEVTEAM_ROLE: 'responder' };
export const NO_TMUX = !hasTmux && 'no tmux';
export const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export const NUDGE = /\[devteam responder\] a turn is waiting — devteam\.mjs thread list --waiting --responder/;

export function fixture(name) {
  const F = threadsFixture(name);
  const DT = path.join(F.old, 'docs/devteam/scripts/devteam.mjs');
  const session = F.sup(['settings', '--get', 'tmux_session']);
  const tmux = (args) => spawnSync('tmux', args, { env: F.env(), encoding: 'utf8' });
  const P = F.standIn();
  const withSup = (role = {}) => ({ DEVTEAM_SUPERVISOR: P.target, ...role });
  // the owner's and the supervisor's commands, with the supervisor's pane named
  const owner = (args) => F.owner(args, withSup());
  const sup = (args) => F.sup(args, withSup());
  const run = (args, role = {}) => { const r = spawnSync(process.execPath, [DT, ...args], { cwd: F.old, env: F.env(withSup(role)), encoding: 'utf8' }); return { status: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }; };
  // The stand-in responder: an agent (never a shell) in the window `responder` of the fleet's
  // session, logging what is typed into it. mode reply: on the nudge line it takes its queue
  // (thread list --waiting --responder --json) and replies to each turn, as a responder does.
  const keys = path.join(F.base, 'responder-keys.txt');
  const agent = path.join(F.base, 'responder-agent.mjs');
  write(agent, [
    "import fs from 'node:fs';",
    "import { spawnSync } from 'node:child_process';",
    'const [keys, banner, mode, dt, cwd] = process.argv.slice(2);',
    "process.stdout.write(`${banner}\\n`);",
    "process.stdin.on('data', (d) => {",
    '  fs.appendFileSync(keys, String(d));',
    "  if (mode !== 'reply' || !/thread list --waiting --responder/.test(String(d))) return;",
    "  const env = { ...process.env, DEVTEAM_ROLE: 'responder' };",
    "  const q = JSON.parse(spawnSync(process.execPath, [dt, 'thread', 'list', '--waiting', '--responder', '--json'], { cwd, env, encoding: 'utf8' }).stdout || '[]');",
    "  for (const x of q) spawnSync(process.execPath, [dt, 'thread', 'reply', x.thread, '--', `stub reply to ${x.turn}`], { cwd, env, encoding: 'utf8' });",
    "  fs.appendFileSync(keys, `[stub took ${q.length}]\\n`);",
    '});',
    'setInterval(() => {}, 1000);',
  ].join('\n'));
  const target = `=${session}:responder`;
  const hasSession = () => tmux(['has-session', '-t', `=${session}`]).status === 0;
  const down = () => { if (hasSession()) tmux(['kill-window', '-t', target]); };
  const open = (cmd) => {
    down();
    if (!hasSession()) assert.equal(tmux(['new-session', '-d', '-x', '220', '-y', '50', '-s', session, '-n', 'hold', `${process.execPath} -e "setInterval(()=>{},1000)"`]).status, 0);
    assert.equal(tmux(['new-window', '-d', '-t', `=${session}:`, '-n', 'responder', ...(cmd ? [cmd] : [])]).status, 0);
  };
  const capture = () => tmux(['capture-pane', '-p', '-t', target]).stdout ?? '';
  const up = ({ banner = 'stand-in responder', mode = 'log' } = {}) => {
    fs.rmSync(keys, { force: true });
    open(`${process.execPath} ${agent} ${keys} '${banner}' ${mode} ${DT} ${F.old}`);
    for (let i = 0; i < 300 && !capture().includes(banner); i++) sleep(100);
    assert.ok(capture().includes(banner), 'the stand-in responder is up');
  };
  const shell = () => { open(null); sleep(500); };
  const typed = () => (fs.existsSync(keys) ? fs.readFileSync(keys, 'utf8') : '');
  // what reached a pane, waited for (yes) or given a moment to arrive (no)
  const reaches = (read, re) => { for (let i = 0; i < 100 && !re.test(read()); i++) sleep(100); return re.test(read()); };
  const stays = (read, re) => { sleep(1500); return !re.test(read()); };
  // every line in the live log with this id, in order
  const raw = (id) => fs.readdirSync(F.logDir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(F.logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))).filter((l) => l.id === id).sort((a, b) => a.at.localeCompare(b.at));
  const turn = (id) => raw(id)[0];
  let n = 0;
  const thread = (title, subject) => {
    const r = owner(['thread', 'new', '--title', `${title} ${++n}`, ...(subject ? ['--subject', JSON.stringify({ kind: 'item', ref: subject })] : []), '--', `${title}, first words`]).split('\n');
    const T = r[0];
    return { T, U: JSON.parse(F.owner(['thread', 'show', T, '--json'])).turns[0].id, said: r[1] };
  };
  const say = (T, words) => { const [U, said] = owner(['thread', 'say', T, '--', words]).split('\n'); return { U, said, line: turn(U) }; };
  const show = (T) => JSON.parse(F.owner(['thread', 'show', T, '--json']));
  const metrics = () => JSON.parse(sup(['metrics', '--json'])).findings;
  const finding = (kind, subject) => metrics().find((f) => f.kind === kind && (subject === undefined || f.subject === subject));
  // the owner's turn as the kit would have written it agoMs ago, routed as given
  const ownerTurn = (T, agoMs, routed = 'responder', delivered = routed === 'responder' ? 'typed' : undefined) => F.hand('owner', { type: 'turn', thread: T, text: `an earlier turn (${agoMs / MIN} min)`, routed_to: routed, ...(delivered ? { delivered } : {}) }, agoMs);
  const writerTurn = (by, T, agoMs, more = {}) => F.hand(by, { type: 'turn', thread: T, text: `${by}'s turn`, ...more }, agoMs, by === 'responder' ? 'responder.jsonl' : null);
  // each case's hand-written lines go again at its end, so no case leaves the responder overdue or busy
  const isolated = (fn) => () => { const snap = F.snapLog(); try { fn(); } finally { F.restoreLog(snap); } };
  return { ...F, DT, P, session, target, owner, sup, run, withSup, up, down, shell, capture, typed, reaches, stays, raw, turn, thread, say, show, metrics, finding, ownerTurn, writerTurn, isolated, tmux };
}

// The helpers each test uses on its fixture; RR_ONLY=<regex> runs only the cases it names.
export function helpers(F, t) {
  // probes only: RR_ONLY=<regex> runs the cases it matches
  const only = process.env.RR_ONLY ? new RegExp(process.env.RR_ONLY) : null;
  const it = (name, fn) => t.test(name, only && !only.test(name) ? { skip: true } : {}, F.isolated(fn));
  const settingsFile = path.join(F.old, 'docs/devteam/project/settings.md');
  const setResponder = (v) => {
    const text = fs.readFileSync(settingsFile, 'utf8');
    const block = /```json devteam\s*\n([\s\S]*?)\n```/.exec(text);
    fs.writeFileSync(settingsFile, text.replace(block[1], JSON.stringify({ ...JSON.parse(block[1]), responder: v }, null, 2)));
  };
  // a call of the supervisor's, written as the kit would (hand mints no id for a decision or act)
  let calls = 0;
  const call = (type, more = {}) => { const id = `${type === 'decision' ? 'd' : 'a'}-20261118-0000001${String(++calls).padStart(2, '0')}-supervisor`; F.hand('supervisor', { id, type, class: 'release-scope', what: `call ${calls}`, ...(type === 'decision' ? { authority: 'rung', rung: 2 } : {}), ...more }, 3600000 - calls); return id; };
  const ask = (T) => F.sup(['thread', 'ask', T, '--question', 'Which colour?', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
  const inboxAsk = () => F.sup(['ask', '--question', 'Ship on Friday?', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
  const routed = (U) => F.turn(U).routed_to;
  const queue = () => F.run(['thread', 'list', '--waiting', '--responder'], RESPONDER).out;
  // a thread the owner opened agoMs ago, written by hand, so lines can be put before now in order
  let olds = 0;
  const oldThread = (agoMs) => { olds++; return F.hand('owner', { type: 'thread', title: `An older thread ${olds}` }, agoMs + olds); };
  // a line written after everything before it (the log orders by time, to the millisecond)
  const after = (fn) => { sleep(5); return fn(); };
  return { only, it, settingsFile, setResponder, call, ask, inboxAsk, routed, queue, oldThread, after };
}
