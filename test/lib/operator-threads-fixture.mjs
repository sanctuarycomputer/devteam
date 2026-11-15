// What operator-threads.*.test.mjs share. The owner's threads with the machine's operator, from the
// hub's Overview: the store beside the operator (operator-thread), who may write what in it, the line
// an owner turn becomes in the operator's pane, a laptop's operator started once, the hub's routes,
// and the Overview's dock and pin in a real Chrome. Real tmux on each part's own server, with
// stand-in agents.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hubSignature } from '../../cloud/gateway.mjs';
import { hasTmux, kit, PORTS, until, write } from './kit.mjs';

// tmux reads UTF-8 from the locale's name: the prompt's ❯ and its non-breaking space must survive
process.env.LANG = process.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8';
for (const k of Object.keys(process.env)) if (/^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_PID|CLAUDE_CONFIG_DIR)$/.test(k)) delete process.env[k];
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-operator-')));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
const KIT = path.join(kit, 'scripts', 'devteam.mjs');
const nowhere = path.join(tmp, 'nowhere');
fs.mkdirSync(nowhere);
// a claude that notes how it was run and stays up as node (what a real one shows as, to tmux): first
// on PATH, and the only claude a pane's shell finds
const bin = path.join(tmp, 'bin');
// (in a folder that holds a stand-in agent, agent.cjs, it becomes that agent: the real start line, and a prompt to type into)
write(path.join(bin, 'claude'), `#!/bin/sh\nprintf '%s|%s|%s\\n' "$DEVTEAM_ROLE" "$DEVTEAM_KIT" "$(printf '%s' "$*" | tr '\\n' ' ')" >> .claude-calls\n[ -f ./agent.cjs ] && exec ${JSON.stringify(process.execPath)} ./agent.cjs\nexec ${JSON.stringify(process.execPath)} -e 'setInterval(() => {}, 1e6)'\n`);
const stubShell = path.join(bin, 'stubshell');
write(stubShell, `#!/bin/sh\nPATH=${bin}:/usr/bin:/bin\nexport PATH\nENV=/dev/null\nexport ENV\ncase "$1" in -c) exec /bin/sh "$@" ;; *) exec /bin/sh -i ;; esac\n`);
for (const f of ['claude', 'stubshell']) fs.chmodSync(path.join(bin, f), 0o755);
// A box's gateway, as far as threads go: its key (signed with the gateway's own hubSignature), whose
// public half a box's hub and kit read from the file DEVTEAM_GATEWAY_THREAD_KEY names (on a real box,
// the root-owned /etc/devteam/thread-key.pub, and only that).
const gwKey = crypto.generateKeyPairSync('ed25519');
const GW_PRIVATE = gwKey.privateKey.export({ type: 'pkcs8', format: 'pem' });
const GW_PUBLIC = path.join(tmp, 'thread-key.pub');
fs.writeFileSync(GW_PUBLIC, gwKey.publicKey.export({ type: 'spki', format: 'pem' }));
const otherKey = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
// A press as the gateway sends it to the hub: the body, its headers, and the proof the hub hands the
// owner's command on stdin.
function signedPress(action, body, { key = GW_PRIVATE, ts, nonce } = {}) {
  const route = `/operator/${action}`;
  const data = Buffer.from(JSON.stringify(body));
  const headers = hubSignature(key, route, data, ts, nonce);
  return { route, data, headers, proof: { path: route, ts: headers['x-devteam-gateway-ts'], nonce: headers['x-devteam-gateway-nonce'], sig: headers['x-devteam-gateway-sig'], body: data.toString('base64') } };
}
// The owner's command the hub runs for a press (devteam.mjs HUB_ACTIONS)
const pressArgs = (action, b) => ({
  'thread-new': () => ['new', ...(b.title ? [`--title=${b.title}`] : []), ...(b.subject ? [`--subject=${JSON.stringify(b.subject)}`] : []), '--', b.text.trim()],
  'thread-say': () => ['say', b.id, '--', b.text.trim()],
  'thread-close': () => ['close', b.id],
  'thread-reopen': () => ['reopen', b.id, ...(b.text?.trim() ? ['--', b.text.trim()] : [])],
  start: () => ['start'],
})[action]();
// A machine of its own per test: its home (so its store and its operator's folder) and its hub port
// (so its operator's tmux session), on this file's one tmux server. starts: false is a laptop with no
// agent command, for tests about the store alone: nothing is started for the words they write.
let machines = 0;
function machine({ box = false, starts = true } = {}) {
  const n = ++machines;
  const home = path.join(tmp, `home-${n}`);
  fs.mkdirSync(home);
  const hub = PORTS + 80 + n;
  const env = { ...process.env, HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH}`, DEVTEAM_HUB_PORT: String(hub), DEVTEAM_TELL_SETTLE_SECONDS: '0.3', ...(box ? { DEVTEAM_PUBLIC_URL: 'https://box.example.com', DEVTEAM_GATEWAY_THREAD_KEY: GW_PUBLIC } : {}), ...(starts ? {} : { DEVTEAM_OPERATOR_COMMAND: '' }) };
  const dir = box ? path.join(home, 'operator') : path.join(home, '.devteam', `operator-${hub}`);
  // input: a press's proof on stdin, as the hub hands it over (and says it has)
  const run = (args, extra = {}, input = undefined) => spawnSync(process.execPath, [KIT, 'operator-thread', ...args], { cwd: nowhere, encoding: 'utf8', env: { ...env, ...(input === undefined ? {} : { DEVTEAM_THREAD_PROOF: 'stdin' }), ...extra }, input });
  const ok = (args, extra) => { const r = run(args, extra); assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
  // on a box, an owner's verb as the hub runs it for a press the gateway signed
  const press = (action, body, o = {}) => run(o.args ?? pressArgs(action, body), {}, JSON.stringify(o.proof ?? signedPress(action, body, o).proof));
  const pressOk = (action, body, o) => { const r = press(action, body, o); assert.equal(r.status, 0, `${action}: ${r.stderr}`); return r.stdout.trim(); };
  const store = () => (fs.existsSync(path.join(dir, 'threads.jsonl')) ? fs.readFileSync(path.join(dir, 'threads.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { home, hub, env, dir, session: box ? 'home' : `devteam-home-${hub}`, run, ok, press, pressOk, store, list: (...f) => JSON.parse(ok(['list', '--json', ...f])) };
}
const OP = { DEVTEAM_ROLE: 'operator' };
const tmuxSh = (args) => spawnSync('tmux', args, { encoding: 'utf8' });
if (hasTmux) {
  execFileSync('tmux', ['new-session', '-d', '-s', 'keep', '-x', '200', '-y', '50', 'sleep 86400']);
  execFileSync('tmux', ['set-option', '-g', 'default-shell', stubShell]);
}
// A stand-in agent as the operator: it draws one screen after another, the next on each Enter, and
// keeps every key it was sent.
const rule = `\x1b[38;5;244m${'─'.repeat(60)}\x1b[39m`;
const prompt = '❯\u00a0';
const box = (inside) => `the operator's last output\n${rule}\n${inside}\n${rule}\n\x1b[38;5;211mstatus\x1b[39m\n`;
let agents = 0;
function agentProgram(screens) {
  const id = ++agents;
  const keys = path.join(tmp, `keys-${id}`);
  fs.writeFileSync(keys, '');
  const prog = path.join(tmp, `agent-${id}.cjs`);
  fs.writeFileSync(prog, `const fs = require('fs'); const screens = ${JSON.stringify(screens)}; let i = 0;
const show = () => process.stdout.write('\\x1b[2J\\x1b[H' + screens[Math.min(i, screens.length - 1)].replace(/\\n/g, '\\r\\n'));
show(); process.stdin.setRawMode(true);
process.stdin.on('data', (d) => { fs.appendFileSync(${JSON.stringify(keys)}, d); for (const c of d.toString()) if (c === '\\r') { i++; show(); } });
setInterval(() => {}, 1e6);\n`);
  return { prog, keys: () => fs.readFileSync(keys, 'utf8') };
}
// The operator's window, as the box's boot or an earlier start left it, with a stand-in agent in it.
function seat(M, screens = [box(prompt)]) {
  const a = agentProgram(screens);
  const pane = tmuxSh(['new-session', '-d', '-P', '-F', '#{pane_id}', '-s', M.session, '-n', 'operator', '-x', '200', '-y', '50', '-c', nowhere, `exec ${process.execPath} ${a.prog}`]).stdout.trim();
  assert.match(pane, /^%\d+$/);
  return { ...a, pane, kill: () => tmuxSh(['kill-session', '-t', `=${M.session}`]) };
}
const shown = (pane, text) => until(() => tmuxSh(['capture-pane', '-p', '-t', pane]).stdout.includes(text), `pane ${pane} drawn`);
const SUBJECT = (root, selector = 'inbox', label = 'Inbox 3') => ({ kind: 'overview', root, name: path.basename(root), anchor: { selector, label } });

// A test's stops, run last-registered first, each on its own: a removal registered first runs
// after every stop, and one stop that throws skips none of the others (node runs t.after hooks in
// the order they were registered and stops at the first that throws). The first error is thrown
// once all have run.
function cleanup(t) {
  const fns = [];
  t.after(async () => {
    let first = null;
    for (const f of fns.reverse()) { try { await f(); } catch (e) { first ??= e; } }
    if (first) throw first;
  });
  return (f) => { fns.push(f); };
}

export { agentProgram, bin, box, cleanup, GW_PUBLIC, KIT, machine, nowhere, OP, otherKey, prompt, seat, shown, signedPress, stubShell, SUBJECT, tmp, tmuxSh };
