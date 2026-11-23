// A stand-in responder agent for test/responder-e2e.test.mjs (kit-110): the owner's responder_command
// in that test. `devteam.mjs responder` types it into a shell in the window `responder`, with
// DEVTEAM_HOME, DEVTEAM_RUN and DEVTEAM_ROLE=responder exported, and its prompt file's pointer as the
// last argument. It answers what the kit types into its pane, as supervisor.md §13 tells a responder:
//   [devteam thread <t> from owner…] <words> — devteam.mjs thread show <t>
//     a reply in that thread (thread reply); a turn whose words say "merge" is the supervisor's, so
//     it is handed over first (send supervisor … --kind handoff --thread <t>), then the reply says so
//   [devteam responder] a turn is waiting — …
//     the nudge: it takes its queue (thread list --waiting --responder --json) and replies to each
// Every line it reads and every command it runs goes to $DEVTEAM_RUN/stub-responder.log, so the
// test can say what it did. It never exits on its own.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const home = process.env.DEVTEAM_HOME;
const dt = path.join(home, 'docs/devteam/scripts/devteam.mjs');
const logFile = path.join(process.env.DEVTEAM_RUN, 'stub-responder.log');
const note = (s) => fs.appendFileSync(logFile, `${new Date().toISOString()} ${s}\n`);
// a kit command as the responder, from the main checkout; its status and what it printed are noted
const kit = (args) => {
  const r = spawnSync(process.execPath, [dt, ...args], { cwd: home, env: { ...process.env, DEVTEAM_ROLE: 'responder' }, encoding: 'utf8', timeout: 30000 });
  note(`ran ${args.slice(0, 2).join(' ')} ${args[2] ?? ''} -> ${r.status} ${(r.stdout || r.stderr || '').trim().split('\n').join(' | ')}`);
  return r;
};
const answer = (t, words) => {
  if (/merge/i.test(words)) {
    kit(['send', 'supervisor', `the owner asks for a merge in ${t}: ${words.slice(0, 120)}`, '--kind', 'handoff', '--thread', t]);
    kit(['thread', 'reply', t, '--', 'Passed to the supervisor: a merge is its call.']);
  } else kit(['thread', 'reply', t, '--', `stub reply: ${words.slice(0, 80)}`]);
};
const line = (l) => {
  note(`read ${l}`);
  const turn = /^\[devteam thread (t-[0-9]{8}-[0-9]{9}-[a-z0-9-]+) from owner[^\]]*\] (.*) — devteam\.mjs thread show \1/.exec(l);
  if (turn) return answer(turn[1], turn[2]);
  if (/^\[devteam responder\] a turn is waiting/.test(l)) {
    const q = JSON.parse(kit(['thread', 'list', '--waiting', '--responder', '--json']).stdout || '[]');
    for (const x of q) answer(x.thread, x.text ?? '');
  }
};
note(`up in ${process.cwd()} as ${process.env.DEVTEAM_ROLE} with ${process.argv.slice(2).join(' ')}`);
process.stdout.write('stub responder up\n');
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  for (let i = buf.search(/[\r\n]/); i >= 0; i = buf.search(/[\r\n]/)) {
    const l = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (l) line(l);
  }
});
setInterval(() => {}, 1000);
