// A stand-in agent for test/fast-threads-e2e.test.mjs (kit-107): the owner's responder_command in that
// test (started by `devteam.mjs responder`, with DEVTEAM_HOME, DEVTEAM_RUN and DEVTEAM_ROLE=responder
// exported and its prompt file's pointer as the last argument), and, started by the test in a window
// named after a ticket with DEVTEAM_TICKET set, a stub worker. It answers what the kit types into its
// pane, as supervisor.md §13 tells a responder:
//   [devteam thread <t> from owner…] <words> — devteam.mjs thread show <t>
//     a reply in that thread (thread reply); a turn whose words say "merge" is the supervisor's, so it
//     is handed over first (send supervisor … --kind handoff --thread <t>), then the reply says so
//   [devteam responder] a turn is waiting — …
//     the nudge: it takes its queue (thread list --waiting --responder --json) and answers each turn
// The test steers it with lines it types into the same pane, each starting "stub:":
//   stub: mode silent    read and log every line, answer nothing (a busy or silent agent)
//   stub: mode answer    answer again, first every thread line read while silent, in order
//   stub: prompt         show a blocked prompt (a menu the kit reads as waiting on a person), go silent
//   stub: unprompt       clear the screen, and answer again as mode answer does
//   stub: pending <t> <words>
//                        a reply in <t> that promises more (thread reply --pending): busy until it follows up
//   stub: reply <t> <words>
//                        a reply in <t> the stub chose to send; refused because the supervisor has
//                        answered, it is sent again with --anyway (adding something new, §13), as the
//                        follow-up (--re) of its pending turn there if it has one
//   stub: forget         drop the thread lines it read while silent
//   stub: draft <slug>   responder draft <slug> --new (a chore-artifact draft of its own)
//   stub: edit <slug> <title>
//                        rewrite the draft's index.html with that title
// Every line it reads and every command it runs (its status and what it printed) goes to
// $DEVTEAM_RUN/stub-<name>.log (name: DEVTEAM_TICKET, else responder). It never exits on its own.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const home = process.env.DEVTEAM_HOME;
const dt = path.join(home, 'docs/devteam/scripts/devteam.mjs');
const name = process.env.DEVTEAM_TICKET || 'responder';
const logFile = path.join(process.env.DEVTEAM_RUN, `stub-${name}.log`);
const note = (s) => fs.appendFileSync(logFile, `${new Date().toISOString()} ${s}\n`);
// a kit command as this session (its own environment, the responder's role by default), from the
// main checkout; its status and what it printed are noted
const kit = (args) => {
  const env = { ...process.env, DEVTEAM_ROLE: process.env.DEVTEAM_ROLE || 'responder' };
  const r = spawnSync(process.execPath, [dt, ...args], { cwd: home, env, encoding: 'utf8', timeout: 30000 });
  note(`ran ${args.slice(0, 3).join(' ')}${args.includes('--anyway') ? ' --anyway' : ''} -> ${r.status} ${`${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').join(' | ')}`);
  return r;
};
const answer = (t, words) => {
  if (/merge/i.test(words)) {
    kit(['send', 'supervisor', `the owner asks for a merge in ${t}: ${words.slice(0, 120)}`, '--kind', 'handoff', '--thread', t]);
    kit(['thread', 'reply', t, '--', 'Passed to the supervisor: a merge is its call.']);
  } else kit(['thread', 'reply', t, '--', `stub reply: ${words.slice(0, 80)}`]);
};
const takeQueue = () => {
  const q = JSON.parse(kit(['thread', 'list', '--waiting', '--responder', '--json']).stdout || '[]');
  for (const x of q) answer(x.thread, x.text ?? '');
};
let silent = false;
let held = [];
const pending = new Map();
const drafts = new Map();
const resume = () => { silent = false; const h = held; held = []; for (const [t, w] of h) answer(t, w); };
const control = (c) => {
  let m;
  if (c === 'mode silent') silent = true;
  else if (c === 'mode answer') resume();
  else if (c === 'prompt') { silent = true; process.stdout.write('\nDo you want to proceed?\n❯ 1. Yes\n  2. No\n'); }
  else if (c === 'unprompt') { process.stdout.write('\x1bc'); process.stdout.write('stub back\n'); resume(); }
  else if (c === 'forget') held = [];
  else if ((m = /^pending (t-\S+) (.+)$/.exec(c))) {
    const r = kit(['thread', 'reply', m[1], '--pending', '--', m[2]]);
    // its pending turn's id: its newest turn in the thread, the one just written
    const ts = r.status === 0 ? JSON.parse(kit(['thread', 'show', m[1], '--json']).stdout || '{}').turns ?? [] : [];
    const u = ts.filter((x) => x.writer === (process.env.DEVTEAM_TICKET || 'responder')).at(-1);
    if (u) pending.set(m[1], u.id);
  } else if ((m = /^reply (t-\S+) (.+)$/.exec(c))) {
    const re = pending.has(m[1]) ? ['--re', pending.get(m[1])] : [];
    const r = kit(['thread', 'reply', m[1], ...re, '--', m[2]]);
    if (r.status !== 0 && /the supervisor has answered this/.test(r.stderr || '')) kit(['thread', 'reply', m[1], '--anyway', ...re, '--', m[2]]);
    pending.delete(m[1]);
  } else if ((m = /^draft (\S+)$/.exec(c))) {
    const r = kit(['responder', 'draft', m[1], '--new', '--title', `Draft ${m[1]}`, '--summary', 'the stub\'s draft']);
    const at = (r.stdout || '').trim().split('\n').find((l) => l.includes(`chore-artifact-${m[1]}`));
    if (r.status === 0 && at) drafts.set(m[1], at.trim());
  } else if ((m = /^edit (\S+) (\S+)$/.exec(c))) {
    const f = path.join(drafts.get(m[1]) ?? '', 'docs/devteam/project/artifacts', m[1], 'index.html');
    try { fs.writeFileSync(f, `<!doctype html><html><head><title>${m[2]}</title></head><body><p>${m[2]}</p></body></html>\n`); note(`edited ${f} -> ${m[2]}`); } catch (e) { note(`edit failed: ${e.message}`); }
  } else note(`unknown control: ${c}`);
};
const line = (l) => {
  note(`read ${l}`);
  const stub = /^stub: (.*)$/.exec(l);
  if (stub) return control(stub[1].trim());
  const turn = /^\[devteam thread (t-[0-9]{8}-[0-9]{9}-[a-z0-9-]+) from owner[^\]]*\] (.*) — devteam\.mjs thread show \1/.exec(l);
  if (turn) { if (silent) held.push([turn[1], turn[2]]); else answer(turn[1], turn[2]); return; }
  if (/^\[devteam responder\] a turn is waiting/.test(l) && !silent) takeQueue();
};
note(`up in ${process.cwd()} as ${process.env.DEVTEAM_ROLE} (${name}) with ${process.argv.slice(2).join(' ')}`);
process.stdout.write(`stub ${name} up\n`);
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
