/* imports start */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BOX_THREAD_KEY } from './hub/operator.mjs';
import { GATE_NAME } from './spend.mjs';
import { OPERATOR_PROOF_MS } from './hub/operator.mjs';
import { OPERATOR_WINDOW } from './hub/operator.mjs';
import { REPLY_FD } from './base.mjs';
import { UNSAFE_TEXT_ALL } from './links.mjs';
import { appendLog } from './log-sync.mjs';
import { artifactsBlock } from './observe.mjs';
import { askableProblem } from './settings.mjs';
import { boundWriter } from './responder.mjs';
import { byTime } from './log-sync.mjs';
import { commonDir } from './state.mjs';
import { currentTicketId } from './log.mjs';
import { cwdGit } from './base.mjs';
import { cwdRepo } from './repos.mjs';
import { die } from './base.mjs';
import { drainedPreface } from './fleet.mjs';
import { dropPaste } from './hub/operator.mjs';
import { dropSpace } from './hub/operator.mjs';
import { execFileSync } from 'node:child_process';
import { fetchPastHalfMade } from './pr-checks.mjs';
import { flagNum } from './base.mjs';
import { flagStr } from './base.mjs';
import { flags } from './base.mjs';
import { flushHeld } from './panes.mjs';
import { gateEnv } from './check-ticket.mjs';
import { gatewayThreadKey } from './hub/operator.mjs';
import { git } from './base.mjs';
import { gitOrDie } from './base.mjs';
import { handledMessages } from './log-sync.mjs';
import { handoffBlock } from './fleet.mjs';
import { heldLock } from './panes.mjs';
import { heldPending } from './panes.mjs';
import { holdLine } from './panes.mjs';
import { hostCheck } from './host.mjs';
import { isObj } from './artifact-notes.mjs';
import { json } from './base.mjs';
import { keepTests } from './spend.mjs';
import { knowledgeBlock } from './observe.mjs';
import { lastPhaseOf } from './fleet.mjs';
import { linksBlock } from './observe.mjs';
import { loadSettings } from './settings.mjs';
import { locatorForPrompt } from './links.mjs';
import { logGet } from './log-sync.mjs';
import { logObjects } from './log-sync.mjs';
import { logWriter } from './log.mjs';
import { mainRef } from './log.mjs';
import { mainRoot } from './state.mjs';
import { markedPane } from './log.mjs';
import { mergeShaFor } from './repos.mjs';
import { nowIso } from './base.mjs';
import { out } from './base.mjs';
import { ownEntry } from './artifact-notes.mjs';
import { ownerLineOpen } from './recover.mjs';
import { ownerProcessEnv } from './secrets.mjs';
import { ownerWriter } from './log.mjs';
import { paneAsking } from './panes.mjs';
import { paneKey } from './panes.mjs';
import { parseAskable } from './settings.mjs';
import { plural } from './questions.mjs';
import { positional } from './base.mjs';
import { previewsBlock } from './previews.mjs';
import { projectRel } from './settings.mjs';
import { projectRelOf } from './fleet.mjs';
import { queuedNudges } from './base.mjs';
import { readJunit } from './spend.mjs';
import { readLog } from './log-sync.mjs';
import { readNum } from './hub/operator.mjs';
import { readText } from './base.mjs';
import { recordSent } from './panes.mjs';
import { recordsInHomeId } from './repos.mjs';
import { replyNow } from './base.mjs';
import { repo } from './repos.mjs';
import { repoOfTicket } from './repos.mjs';
import { repoOfTicketLink } from './repos.mjs';
import { report } from './log-sync.mjs';
import { resolveCommit } from './log-sync.mjs';
import { rest } from './base.mjs';
import { runDir } from './state.mjs';
import { runPath } from './settings.mjs';
import { sh } from './base.mjs';
import { sha256 } from './lens.mjs';
import { shq } from './scores.mjs';
import { stopPreviewsOf } from './previews.mjs';
import { supervisorAsk } from './panes.mjs';
import { supervisorOnly } from './log.mjs';
import { threadsNeedGateway } from './hub/operator.mjs';
import { tickets } from './graph.mjs';
import { tmuxSession } from './base.mjs';
import { tmuxTarget } from './base.mjs';
import { typeLock } from './log.mjs';
import { warn } from './base.mjs';
import { worktreeAddOrDie } from './check-ticket.mjs';
import { worktreeRepo } from './pr-checks.mjs';
import { writerClass } from './log.mjs';
/* imports end */
/* cmdDashboard end */
export const PROMPTS = {
  supervisor: 'You are the supervisor for this repository, running in the owner\'s terminal. Read the devteam section of AGENTS.md, then docs/devteam/process/supervisor.md, and follow it from the start. You write no production code. The log (devteam.mjs log, questions, status) and the tracked files are the record; chat is not. When you start, and again whenever the project changes, discover every production signal the project already has access to (production URLs, log access such as heroku logs, error trackers such as Sentry or Honeybadger, the CLIs and tokens here) and start a sensor for each, with no question to the owner (supervisor.md, Monitoring). Your default is to act: decide what is yours and log it; when work needs a credential or access, ask for it at once with an owner-action question and --secrets, and never ask whether to ask, in the Inbox or in chat; write to the owner in plain words, without the kit\'s vocabulary (supervisor.md §6, Ask less, act more). Run any multi-step shell (rm, redirects, quotes inside quotes) as a script file you write and then run, never inline: an inline one stops on a permission prompt nobody answers, and while it waits your whole loop stops. For any login, 2FA or captcha in devteam.mjs browser, hand the browser to the owner with browser handover, and never type a password or one-time code yourself (supervisor.md, The browser: outside websites). If there are no ready goals, begin at docs/devteam/process/planning.md §1 by asking the owner what the project is for. Setup ends when start-up (supervisor.md §1, steps 1-6) has run, whatever it held (for a new adoption, the strategy draft and the first question to the owner). From then on, keep the loop until the owner stops you (or a move is ready, supervisor.md §12): run the tick (supervisor.md §3), then start node docs/devteam/scripts/devteam.mjs wait in the background (in the foreground only where your harness can\'t be woken by a finished command), tick again when it returns, and start it again. Never end a turn without a wait running, not even one that ends on a question to the owner or a summary: the owner answers in the Inbox and in threads, not in this chat, and unless your tmux pane is recorded to have them typed in, only wait brings them to you.',
  worker: 'You are the worker for ticket {{ID}}. Read the devteam section of AGENTS.md, then docs/devteam/process/worker.md, and follow it from §1. Your ticket: node docs/devteam/scripts/devteam.mjs ticket show {{ID}}. Use superpowers for every step; devteam says where files go and what must be true before you ask for the merge. Before asking for a spec or plan review, run the first-pass checks in worker.md §4 (every done-when shown by acceptance checks that fail when the behaviour breaks, each seen failing against broken code, its line in the acceptance table\'s red seen cell; every claim about code sourced with a file:line or a command in the spec\'s Today (sources) table; a Refusals and edges section in every spec; a TL;DR that names the approach and matches the plan; a plan buildable as written). Run any multi-step shell (rm, redirects, quotes inside quotes) as a script file you write and then run, never inline: an inline one stops on a permission prompt nobody answers (worker.md §3). Build each plan task marked `Model: fast` in a subagent on the fast model (`settings --get model_tiers`) unless the plan says `- Built here: <why>` under it (worker.md §3).',
  responder: 'You are the responder for this repository: you answer the owner\'s thread messages at once, while the supervisor works. Read docs/devteam/process/supervisor.md §13 (The responder), the only part of that doc that is yours, and follow it. Your first action on any turn, typed or taken from the queue, is a reply: node docs/devteam/scripts/devteam.mjs thread reply <t-id> "…" (add --pending only when you will do the work yourself, then reply again when it is done, with --re <the pending reply\'s u-id>). When you are done, run node docs/devteam/scripts/devteam.mjs thread list --waiting --responder and take the next turn. Hand anything else to the supervisor with node docs/devteam/scripts/devteam.mjs send supervisor "…" --kind handoff --thread <t-id>. Write to the owner in plain words. Run any multi-step shell (rm, redirects, quotes inside quotes) as a script file you write in your folder and then run, never inline, and remove it when it has run.',
  planner: 'You are planning feature {{ID}} on branch plan/{{ID}}, in this worktree. Read the devteam section of AGENTS.md, then docs/devteam/process/planning.md, and run the pipeline from §2 for this feature. Run any multi-step shell (rm, redirects, quotes inside quotes) as a script file you write and then run, never inline: an inline one stops on a permission prompt nobody answers. Your tickets and the feature line go to the log with devteam.mjs feature add / ticket add; commit everything as you go; message the supervisor (devteam.mjs send supervisor) when the graph review passes.',
};
// What a prompt says about a repo, from settings alone (a view: no checkout needed).
export const repoAbout = (name) => (name === 'home' ? repo('home') : { name, remote: ownEntry(loadSettings().links, name)?.remote, projectRel: projectRelOf(name) });
// A role's opening prompt. A ticket in another repo has no kit of its own in its worktree: it runs
// home's kit by absolute path and keeps its records in that repo's project folder. The remote and
// the folder come from settings, so each is shown as one token (a hand edit on main is never validated).
// What a fix ticket's worker is told about care: back up what a change could destroy, and hold for
// a human when not confident (process/worker.md, A fix ticket).
export const FIX_CARE = ' This ticket fixes a production incident, so take care. Before anything that can destroy or overwrite data or is hard to undo (a destructive migration, a backfill, a bulk update or delete, a schema change, a config or access change), back up first: for a database or data change, take a snapshot or dump of what it touches (heroku pg:backups:capture or pg_dump, or a copy of the affected rows kept outside the change), restore it once to a non-production copy (never production) to prove it works, write the undo, keep the change additive and reversible where it can be, and say in verification.md where the backup is and how to restore it. If you are not confident in the fix, or cannot back up what it touches, hold: stop before shipping, devteam.mjs phase blocked, and devteam.mjs send supervisor "<what you are unsure of, and your recommendation>" --kind blocked; the supervisor asks the owner an ordinary Inbox question and you wait for the answer.';
export function promptFor(role, id, R = repo('home')) {
  const fixCare = role === 'worker' && tickets().get(id)?.kind === 'fix' ? FIX_CARE : '';
  const base = `${PROMPTS[role].replace(/\{\{ID\}\}/g, id)}${fixCare}`;
  if (R.name === 'home') return base;
  const kitCmd = `node ${shq(path.join(mainRoot, 'docs', 'devteam', 'scripts', 'devteam.mjs'))}`;
  const head = `${base.replace(/node docs\/devteam\/scripts\/devteam\.mjs/g, kitCmd).replace('Read the devteam section of AGENTS.md, then docs/devteam/process/worker.md', `Read ${path.join(mainRoot, 'docs', 'devteam', 'process', 'worker.md')}`)} This worktree is a checkout of ${R.name} (${locatorForPrompt(R.remote)}); run every devteam command as ${kitCmd}`;
  // records in home: the code goes here, the records in home's ticket/<id>
  if (role === 'worker' && recordsInHomeId(id)) return `${head}. Only this ticket's code goes in ${R.name}: nothing of the project, records included. Keep its records (spec, plan, verification, reviews) under ${projectRel}/tickets/${id}/ in ${recordsWorktreePath(id)}, a checkout of home on its branch ticket/${id}; commit and push them there, and run dispose there. A final review record names the home commit of the records it reviewed in a line "- Records: <full sha>" beside its verdict on this repo's head.${repo('home').settings.forge === 'git' ? '' : ` Open a PR in home from ticket/${id} with this ticket's PR title too: merge lands it with the code.`}`;
  return `${head}, and keep this ticket's records under ${locatorForPrompt(R.projectRel)}/tickets/${id}/ in this repo.`;
}
// The supervisor's opening prompt: the drained or parked preface first, when there is one, and
// what the owner wrote while it was away.
export function supervisorOpeningPrompt(p = PROMPTS.supervisor) {
  const d = drainedPreface();
  let n = 0;
  try { seedOwnerCursor(); n = ownerLinesUnread().length; } catch {}
  const u = n ? `The owner wrote ${n} line${n === 1 ? '' : 's'} you haven't dealt with yet (answers, thread turns, decisions). First, run node docs/devteam/scripts/devteam.mjs unread, act on each, and ack each one you dealt with (unread ack <ref> …).` : null;
  return [d, u, p].filter(Boolean).join('\n\n');
}

// What the owner wrote that the supervisor hasn't dealt with yet: a cursor over the owner's log lines
// (answers, thread turns, goal decisions, corrections, secrets posted, acks), kept in run/. Every
// owner line is written to the log whether the supervisor is up or not; the cursor moves only when
// the supervisor says it has dealt with a line (unread ack), never because a nudge was typed or a
// screen shown. So a nudge lost to a supervisor that was down, at a dialog or restarting costs a
// few minutes, never the line: `unread` lists it, the prompt at every start says how many, and
// past UNREAD_GRACE_MS the owner-unread finding (high) wakes wait and shows in status and metrics.
export const UNREAD_GRACE_MS = 10 * 60000;
export const ownerCursorFile = () => runPath('owner-cursor.json');
// The cursor is a floor and the lines dealt with since, each by its key (at and id: a `set` line
// carries the id of the object it changes, so several owner lines share one id). A line that
// reaches this machine late (synced from another clone, written with an earlier stamp) is still
// unread, as a time alone would not see; one stamped more than UNREAD_LATE_MS before the floor
// moved past it is not.
export const UNREAD_LATE_MS = 24 * 3600000;
export const ownerLineKey = (l) => `${l.at}|${l.id}`;
export function ownerCursor() {
  try { const c = JSON.parse(readText(ownerCursorFile()) ?? 'null'); if (c && typeof c.floor === 'string' && Array.isArray(c.acked)) return c; } catch {}
  return null;
}
// no cursor yet (a new machine, or a kit from before it): what the owner wrote after the
// supervisor's own last line is unread, so an upgrade never hides an answer and never replays years
export const noCursorFloor = () => readLog().lines.filter((l) => l.by === 'supervisor' && typeof l.at === 'string').map((l) => l.at).sort().pop() ?? '';
export function ownerFloor() { return ownerCursor()?.floor ?? noCursorFloor(); }
// Pin that floor in a cursor file the first time the supervisor writes or starts, so its own later
// lines (a tick's spend line, an observation) never mark earlier owner lines read.
export function seedOwnerCursor() {
  try {
    if (ownerCursor()) return;
    // missing: pin the no-cursor floor (what the owner wrote after the supervisor's last line). A file
    // there but unreadable (a crash mid-write) lost the acks too: pin a day back instead, so a line
    // not yet dealt with is read again rather than hidden under the supervisor's later lines
    const lost = fs.existsSync(ownerCursorFile());
    writeOwnerCursor({ floor: lost ? new Date(Date.now() - UNREAD_LATE_MS).toISOString() : noCursorFloor(), acked: [], acked_at: null });
  } catch {}
}
// write the cursor whole or not at all: a temp file renamed over it
export function writeOwnerCursor(c) {
  fs.mkdirSync(runDir, { recursive: true });
  const tmp = `${ownerCursorFile()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(c)}\n`);
  fs.renameSync(tmp, ownerCursorFile());
}
export function ownerLinesUnread() {
  const floor = ownerFloor();
  const acked = new Set(ownerCursor()?.acked ?? []);
  return readLog().lines.filter((l) => l.by === 'owner' && typeof l.at === 'string' && typeof l.id === 'string' && l.at > floor && !acked.has(ownerLineKey(l))).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
}
export const unreadWhat = (l) => {
  const text = [l.answer, l.text, l.verdict, l.note, l.outcome, l.status].find((x) => typeof x === 'string' && x);
  return `${l.type}${l.op && l.op !== 'new' ? ` ${l.op}` : ''}${text ? `: ${String(text).replace(/\s+/g, " ").slice(0, 120)}` : ''}`;
};
// unread [--json]: the owner's lines past the cursor, oldest first, each with its ref. unread ack
// <ref> [<ref> …]: the supervisor has dealt with exactly those lines.
export function cmdUnread() {
  const sub = positional[0];
  if (sub === 'ack') {
    supervisorOnly('unread ack');
    const list = ownerLinesUnread();
    // ack acts only on the lines the supervisor names, each by the ref unread printed: never on a
    // range, since a line synced in late sorts among them unseen, and never --all. A bare id names
    // its line only when one unread line has it (a set line shares its object's id).
    if (flags.all) die('unread ack takes the refs of the lines you dealt with, as unread listed them: --all would also ack a line the owner wrote since');
    const names = positional.slice(1);
    if (!names.length) die('usage: unread ack <ref> [<ref> …]');
    const picked = [];
    for (const name of names) {
      const byRef = list.find((l) => ownerLineKey(l) === name);
      const byId = list.filter((l) => l.id === name);
      if (!byRef && byId.length > 1) die(`${byId.length} unread lines carry ${name}: ack by the refs unread lists (${byId.map(ownerLineKey).join(', ')})`);
      const l = byRef ?? byId[0];
      if (!l) die(`${name} is not an unread owner line (unread lists them)`);
      picked.push(l);
    }
    fs.mkdirSync(runDir, { recursive: true });
    const c = ownerCursor() ?? { floor: noCursorFloor(), acked: [] };
    const acked = new Set([...c.acked, ...picked.map(ownerLineKey)]);
    // move the floor up past what is dealt with, but never closer to now than UNREAD_LATE_MS (room for
    // a late line) and never past a line still unread; keys under the floor are dropped, so the list
    // stays the size of a day's lines
    const stillUnread = ownerLinesUnread().filter((l) => !acked.has(ownerLineKey(l)));
    const late = new Date(Date.now() - UNREAD_LATE_MS).toISOString();
    const cap = stillUnread.length ? (stillUnread[0].at < late ? stillUnread[0].at : late) : late;
    const before = (x) => { const t = Date.parse(x) - 1; return Number.isFinite(t) ? new Date(t).toISOString() : x; };
    const floor = [c.floor, before(cap)].sort().pop();
    writeOwnerCursor({ floor, acked: [...acked].filter((k) => k.split('|')[0] > floor), acked_at: nowIso() });
    const left = ownerLinesUnread().length;
    return out(`read ${picked.length} line${picked.length === 1 ? '' : 's'}; ${left ? `${left} still unread` : 'nothing unread'}`);
  }
  if (sub) die('usage: unread [--json] | unread ack <ref> [<ref> …]');
  const list = ownerLinesUnread().map((l) => ({ ref: ownerLineKey(l), id: l.id, type: l.type, op: l.op ?? 'new', at: l.at, what: unreadWhat(l), read: `devteam.mjs log --id ${l.id}` }));
  if (flags.json) return json({ unread: list, cursor: ownerCursor() });
  if (!list.length) return out('nothing unread from the owner');
  for (const x of list) out(`${x.ref}  ${x.what}  (${x.read})`);
  out(`\n${list.length} unread. Act on each (its question, thread or goal), then ack the ones you dealt with: devteam.mjs unread ack ${list.map((x) => x.ref).join(' ')}`);
}

export function cmdPrompt() {
  const role = positional[0];
  if (!PROMPTS[role]) die('usage: prompt supervisor|worker <ticket-id>|planner <feature>|responder');
  // exactly what the responder's start writes to its prompt file, nothing added
  if (role === 'responder') return out(promptFor('responder'));
  const t = role === 'worker' && positional[1] ? tickets().get(positional[1]) : null;
  const p = role === 'planner' && positional[1] ? plannerPrompt(positional[1]) : t ? promptFor('worker', t.id, repoAbout(repoOfTicketLink(t))) : PROMPTS[role].replace(/\{\{ID\}\}/g, positional[1] ?? '');
  if (role === 'supervisor') {
    // a start: another machine live on this repo is the whole prompt, so the agent stops there.
    // The box's operator only reads it: no claim, no network.
    const hc = process.env.DEVTEAM_ROLE === 'operator' ? {} : hostCheck({ start: true });
    if (hc.refused) { out(`Do not supervise this repo from this machine. ${hc.refused}`); process.exitCode = 1; return; }
    return out(supervisorOpeningPrompt(p));
  }
  const handoff = positional[1] ? handoffBlock(role === 'worker' ? positional[1] : `plan-${positional[1]}`) : null;
  const links = linksBlock(positional[1]);
  const arts = artifactsBlock(positional[1]);
  const block = knowledgeBlock(positional[1]);
  const previews = positional[1] ? previewsBlock(role === 'worker' ? positional[1] : `plan-${positional[1]}`) : null;
  out([p, handoff, previews, links, arts, block].filter(Boolean).join('\n\n'));
}

export const tmux = (args) => sh('tmux', args) !== null;
// Environment variables that mark a process as inside one running agent session (Claude Code's).
export const SESSION_MARKERS = /^(CLAUDECODE|CLAUDE_CODE_[A-Z0-9_]+|CLAUDE_PID)$/;
// `env -u` for the session markers this process or the tmux server carries; empty when there are none.
export function sessionMarkerPrefix(session = tmuxSession()) {
  const markers = [...new Set([...Object.keys(process.env), ...(sh('tmux', ['show-environment', '-g']) ?? '').split('\n'), ...(sh('tmux', ['show-environment', '-t', `=${session}`]) ?? '').split('\n')].map((l) => l.replace(/^-/, '').split('=')[0]).filter((k) => SESSION_MARKERS.test(k)))].sort();
  return markers.length ? `env ${markers.map((k) => `-u ${k}`).join(' ')} ` : '';
}
// What a tmux server started here keeps in its global environment for every window it ever opens:
// nothing that says which session started it (the tick's relaunch is the supervisor, and a window
// the owner opens there would have owner commands refused).
export function tmuxServerEnv() {
  const env = ownerProcessEnv();
  for (const k of Object.keys(env)) if (k === 'DEVTEAM_CHANNEL' || k === 'TMUX_PANE' || SESSION_MARKERS.test(k)) delete env[k];
  return env;
}
// The session:window running this command. TMUX_PANE pins it to our own pane.
export const tmuxHere = () => (process.env.TMUX && process.env.TMUX_PANE ? sh('tmux', ['display-message', '-p', '-t', process.env.TMUX_PANE, '#S:#W']) : null);
export const supervisorTarget = () => process.env.DEVTEAM_SUPERVISOR ?? markedPane(runDir);
export const SHELLS = new Set(['bash', 'zsh', 'sh', 'fish', 'dash', 'ksh', 'tcsh', 'csh', 'login']);
// Resolve a session:window exactly and check an agent, not a bare shell, is running there (typing
// into a shell would execute the text).
// A session's windows, each with its active pane's state, from one tmux call kept for a few
// seconds: a busy tmux server answers each call slowly (seconds, with many agents' panes), and a
// dashboard refresh asked it two calls per window.
export const paneTables = new Map();
export function paneTable(session, { fresh = false } = {}) {
  const hit = paneTables.get(session);
  if (hit && !fresh && Date.now() - hit.at < 5000) return hit.rows;
  const listed = sh('tmux', ['list-panes', '-s', '-t', session, '-F', '#{window_index}\t#{window_name}\t#{pane_active}\t#{pane_dead}\t#{pane_current_command}']);
  const rows = listed === null ? null : listed.split('\n').filter(Boolean).map((l) => l.split('\t')).filter((r) => r[2] === '1').map(([index, name, , dead, cmd]) => ({ index, name, dead, cmd: cmd ?? '' }));
  paneTables.set(session, { at: Date.now(), rows });
  return rows;
}
export function resolvePane(target) {
  if (!target) return { problem: 'the supervisor has not run inside tmux yet (no pane recorded); it reads messages on its tick' };
  let exact = target;
  let dead;
  let cmd = '';
  if (!target.startsWith('%')) {
    const i = target.lastIndexOf(':');
    const [session, win] = i === -1 ? [target, '0'] : [target.slice(0, i), target.slice(i + 1)];
    const find = (rows) => rows?.find((r) => r.name === win || r.index === win);
    let rows = paneTable(session);
    let row = find(rows);
    if (!row) { rows = paneTable(session, { fresh: true }); row = find(rows); }
    if (rows === null) return { problem: `no tmux session "${session}"` };
    if (!row) return { problem: `no tmux window "${win}" in session "${session}"` };
    exact = `${session}:${row.index}`;
    ({ dead, cmd } = row);
  } else {
    const info = sh('tmux', ['display-message', '-p', '-t', exact, '#{pane_dead} #{pane_current_command}']);
    if (info === null) return { problem: `cannot inspect ${exact}` };
    [dead, cmd = ''] = info.split(' ');
  }
  if (dead === '1') return { problem: `the pane in ${exact} has exited` };
  if (SHELLS.has(cmd.replace(/^-/, ''))) return { problem: `no agent is running in ${exact} (it is at a ${cmd} prompt); resume it first` };
  return { target: exact };
}
// A prompt goes to the agent as a file it is told to read, never as its text on the command line:
// one argument is at most 128 KB on Linux (MAX_ARG_STRLEN), and a prompt with a large knowledge block
// passes that, so the shell refuses the line and no agent starts. Plain words, for any agent_command.
export const promptPointer = (file) => `Your prompt for this session is in the file ${path.resolve(file)}. Read all of it now, every part (a long file takes more than one read), and follow it.`;
// Each delivery is recorded per window, so a lost Enter can be pressed later (resendLostEnter).
// With paste (files the owner dropped, their paths), the line and a space, then the paths as one
// bracketed paste, as a drop on the terminal's page sends them (spec §7): tmux wraps it in ESC[200~ …
// ESC[201~ when the agent asked for that, so Claude Code takes an image path as an attachment. The
// text goes in on stdin, never as an argument, under a name of this process's own; -d drops it
// once pasted, and a paste that fails drops it too, so nothing is left on the server. Only the line
// is recorded: the lost-Enter rescue matches the line's tail, and a pasted image shows as [Image #n].
export let dropSeq = 0;
// All of it under the pane's typing lock: outermost, it first reads the owner's floor, and types
// nothing (false) while that holds, or when the lock stays busy; under a caller's hold (typeInto,
// flushHeld, loginChangedStop, a restart), the caller read it. The stamp is touched after each call.
export function typeNow(target, line, paste = null) {
  const files = Array.isArray(paste) && paste.length ? paste : null;
  const t = (args) => { const r = tmux(args); typeLock.touch(); return r; };
  const held = typeLock.run(target, (outer) => {
    if (outer && ownerLineOpen(target)) return false;
    let ok;
    if (!files) ok = t(['send-keys', '-t', target, '-l', line]) && t(['send-keys', '-t', target, 'Enter']);
    else {
      const buf = `devteam-drop-${process.pid}-${++dropSeq}`;
      // the paths loaded first, the line typed only then: a load that fails leaves nothing in the input
      // box, so a held line typed again later isn't typed after a copy of itself
      ok = sh('tmux', ['load-buffer', '-b', buf, '-'], { input: dropPaste(files), stdio: ['pipe', 'pipe', 'ignore'] }) !== null;
      if (ok && !t(['send-keys', '-t', target, '-l', `${line} `])) { tmux(['delete-buffer', '-b', buf]); ok = false; }
      if (ok && !t(['paste-buffer', '-p', '-d', '-b', buf, '-t', target])) { tmux(['delete-buffer', '-b', buf]); ok = false; }
      ok = ok && (!dropSpace(files) || t(['send-keys', '-t', target, '-l', ' '])) && t(['send-keys', '-t', target, 'Enter']);
    }
    if (ok) recordSent(target, line);
    return ok;
  });
  return held.busy ? false : held.value;
}
// A message for an agent: typed now, or held while its pane asks (flushHeld types it once the pane
// is ready again) and behind any line already held for it, so they arrive in order. True once
// typed; while it waits, why: 'held-card' (a menu the owner answers on the dashboard), 'held-terminal'
// (a dialog answered in the terminal), 'held-limit' (the usage-limit menu), 'held-queued' (nothing
// asked now, but lines held earlier go first and the pane is not ready for them); false when it
// could be neither. A launch command typed into a fresh window is typeNow's: it must not wait.
// The whole decision under the pane's typing lock (kit-618): the owner's floor first, whatever the
// pane asks (a writer's look can release a done floor on a dialog), then the asking look, then the
// hold. While the floor holds the line is held: 'held-floor', or the asking reason when it asks.
// The lock busy for 10 s: held outside it (a hold types nothing), 'held-busy'.
export function typeInto(target, line, paste = null) {
  const held = typeLock.run(target, (outer) => {
    const floor = outer && ownerLineOpen(target);
    const key = paneKey(target);
    if (!key) return floor ? false : typeNow(target, line, paste);
    const asking = paneAsking(target);
    const waits = floor || asking;
    // the look and the hold under the window's lock: a put-back can't fall between them. null: type
    // now; false: it could not be held
    const file = heldLock(key, () => (!waits && !heldPending(key)) ? null : holdLine(key, target, line, paste) ?? false);
    if (file === null) return typeNow(target, line, paste);
    if (!file) return waits ? false : typeNow(target, line, paste);
    if (!waits) flushHeld(key);
    if (!fs.existsSync(file)) return true;
    return asking ? (asking.kind === 'menu' ? 'held-card' : asking.kind === 'limit' ? 'held-limit' : 'held-terminal') : floor ? 'held-floor' : 'held-queued';
  });
  if (!held.busy) return held.value;
  // held under the window's own lock, as every hold is: a flusher's claim can't fall inside it
  const key = paneKey(target);
  return key && heldLock(key, () => holdLine(key, target, line, paste)) ? 'held-busy' : false;
}
// Why a line is held, in words: every one begins "recorded and held" (the dashboard reads that).
export const heldWords = (why, whose) => `recorded and held: ${{
  'held-card': `${whose} terminal is asking a question, and typing now would answer it. ${whose === "the supervisor's" ? 'The owner answers it on the dashboard (the card at the top of the Inbox)' : 'Someone answers it in that terminal'}; this is typed after, and is never the answer to it`,
  'held-terminal': `${whose} terminal has a dialog up that only the terminal can answer (no card can), and typing now would answer it. It is typed once someone answers it there`,
  'held-limit': `${whose} terminal is stopped at a usage-limit menu, and typing now would answer it. It is typed once the session is running again`,
  'held-queued': `${whose} terminal asks nothing now, but lines held for it earlier go first and it is not showing its input box yet. It is typed, in order, at the next look`,
  'held-floor': 'the owner is typing a line in that terminal, and typing now would join it. It is typed once they send or clear their line',
  'held-busy': 'another writer has been typing into that terminal for 10 s. It is typed, in order, at the next look',
}[why]}`;
// paste: the paths of files the owner dropped with it, pasted after the line (typeNow)
export function nudgeSupervisor(line, paste = null) {
  if (REPLY_FD !== null) return void queuedNudges.push({ line, paste });
  typeNudge(line, paste);
}
export function deliverNudges() { for (const { line, paste } of queuedNudges.splice(0)) typeNudge(line, paste); }
export function typeNudge(line, paste = null) {
  const { target, problem } = resolvePane(supervisorTarget());
  if (problem) return void warn(`not delivered to the supervisor: ${problem}; the line stays unread until it acks it (unread)`);
  typeInto(target, line, paste);
}
// The words before a paste of dropped files, and the paths pasted: none for a line with no files.
export const droppedWords = (files) => (files?.length ? ` (${plural(files.length, 'file')} dropped)` : '');
export const droppedPaths = (files) => (files?.length ? files.map((f) => f.path) : null);
export const myAddress = () => { const w = logWriter(); return w === 'supervisor' ? 'supervisor' : w; };

// pane question [--json]: what the supervisor's terminal is asking, if anything. Reading is all a
// command does: none sends a key to that terminal. The owner answers on the dashboard's card, and
// the dashboard's own process sends the key (cmdDashboard, paneAnswer), after its checks of the
// page that asked. pane answered is what it runs after: the owner's act for the log, and the lines
// held for the pane while it asked. On a box it takes that only with the gateway's signature for
// the press, each taken once, as a thread with the operator does.
// A press the dashboard's card sends: exactly { digest, option, token } (option 1 to 9) or exactly
// { digest, escape: true, token }. The route takes nothing else, and on a box pane answered holds the
// gateway's signed body to the same shape.
export function paneAnswerShape(b) {
  if (!isObj(b) || typeof b.digest !== 'string' || !/^[0-9a-f]{40}$/.test(b.digest) || typeof b.token !== 'string') return false;
  const keys = Object.keys(b).sort().join(',');
  if (keys === 'digest,option,token') return Number.isInteger(b.option) && b.option >= 1 && b.option <= 9;
  return keys === 'digest,escape,token' && b.escape === true;
}
// Whether a numbered menu's hint says Esc cancels it, and nowhere that Esc exits or quits.
export const paneEscCancels = (hint) => { const h = String(hint ?? ''); return /\bEsc to cancel\b/i.test(h) && !/\bEsc to (?:exit|quit)\b/i.test(h); };
export const paneSigned = (port, ts, nonce, body) => Buffer.from(`devteam-pane-answer-v1\n${port}\n${ts}\n${nonce}\n${sha256(body)}`);
// The owner's Save on the Settings page (gateway.mjs, ownerSettingSignature): the same, under its own name.
export const ownerSettingSigned = (port, ts, nonce, body) => Buffer.from(`devteam-owner-setting-v1\n${port}\n${ts}\n${nonce}\n${sha256(body)}`);
export const paneProofProblem = (proof, now = Date.now()) => dashboardProofProblem(proof, paneSigned, now);
export const ownerSettingProofProblem = (proof, now = Date.now()) => dashboardProofProblem(proof, ownerSettingSigned, now);
// Why a dashboard press's proof isn't the gateway's for the bytes `signed` names (null when it is).
export function dashboardProofProblem(proof, signed, now = Date.now()) {
  if (!isObj(proof)) return 'it carries no signature from the gateway';
  const { port, ts, nonce, sig, body } = proof;
  if (!Number.isInteger(port) || typeof ts !== 'string' || !/^\d{13}$/.test(ts) || typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{22,64}$/.test(nonce) || typeof sig !== 'string' || !/^[A-Za-z0-9_-]{80,100}$/.test(sig) || typeof body !== 'string') return 'its signature is malformed';
  if (Math.abs(now - Number(ts)) > OPERATOR_PROOF_MS) return 'its signature is too old';
  const key = gatewayThreadKey();
  if (!key) return `this box has no gateway key (${BOX_THREAD_KEY})`;
  let ok = false;
  try { ok = crypto.verify(null, signed(port, ts, nonce, Buffer.from(body, 'base64')), key, Buffer.from(sig, 'base64url')); } catch {}
  return ok ? null : 'its signature is not the gateway\'s';
}
// Another account's artifact is named by its id, never its link: the log is mirrored to git.
export const noArtifactLinks = (t) => String(t ?? '').replace(/(?:https?:\/\/)?claude\.ai\/(?:code\/)?artifact\/([A-Za-z0-9-]{6,64})\S*/g, 'artifact $1');
// This checkout's dashboard port, as a number: the last one the running dashboard logged
// (run/dashboard.log; a pinned --port writes no run/dashboard-port), else run/dashboard-port.
export function ownDashboardPort() {
  const logged = [...(readText(path.join(runDir, 'dashboard.log')) ?? '').matchAll(/started on http:\/\/127\.0\.0\.1:(\d+)/g)].pop()?.[1];
  const n = logged ? Number(logged) : readNum(path.join(runDir, 'dashboard-port'));
  return Number.isInteger(n) ? n : null;
}
// The owner's requests for the supervisor's askable settings, oldest first, and the latest one.
export const ownerSettingActs = (key) => logObjects('act').filter((a) => a.class === 'owner-setting' && a.created_by === 'owner' && a.key === key).sort(byTime);
export const latestOwnerSetting = (key) => ownerSettingActs(key).at(-1) ?? null;
// owner-setting <key> <1..20|none>: the owner asks for one of the supervisor's own settings (the
// dashboard's Settings page runs it on Save). It writes one owner act and nothing else: the
// supervisor lands it with settings set in its settings chore, and owner-setting-unlanded stays
// raised until main has it. Only the dashboard's channel or the owner's own terminal runs it.
export function cmdOwnerSetting() {
  const [key, arg] = positional;
  if (!key || arg === undefined || positional.length !== 2) die('usage: owner-setting <key> <1..20|none>   (the owner asks for one of the supervisor\'s settings; the dashboard\'s Settings page runs it)');
  const { by } = ownerWriter('the owner asks for a setting on the dashboard\'s Settings page; you change your own with settings set in the settings chore');
  if (process.env.DEVTEAM_CHANNEL !== 'dashboard' && !process.stdin.isTTY) die('owner-setting: the owner asks for a setting on the dashboard\'s Settings page or in their own terminal; you change your own with settings set in the settings chore');
  const value = parseAskable(arg);
  const why = askableProblem(key, value === undefined ? NaN : value);
  if (why) die(`owner-setting: ${why}`);
  // On a box every agent can reach the dashboard and run this: only the gateway's signature for the
  // owner's Save, for this dashboard and exactly this key and value, each taken once (the log keeps
  // the nonces past a dashboard restart).
  let proof = null;
  if (threadsNeedGateway()) {
    const no = (w) => die(`owner-setting: on a box the owner saves settings only on the dashboard through the box's gateway, which signs the press, and ${w}`);
    let b = null;
    try { if (!process.stdin.isTTY) b = JSON.parse(fs.readFileSync(0, 'utf8') || 'null'); } catch {}
    const p = isObj(b) ? b.proof : null;
    const w = ownerSettingProofProblem(p);
    if (w) no(w);
    let signed = null;
    try { signed = JSON.parse(Buffer.from(p.body, 'base64').toString('utf8')); } catch {}
    if (!isObj(signed) || Object.keys(signed).sort().join(',') !== 'key,value' || signed.key !== key || signed.value !== value) no('the gateway signed another save than this one');
    if (p.port !== ownDashboardPort()) no('that signature is for another dashboard');
    if (logObjects('act').some((a) => a.class === 'owner-setting' && a.proof?.nonce === p.nonce)) no('that save was taken already');
    proof = { port: p.port, ts: p.ts, nonce: p.nonce, sig: p.sig, body: p.body };
  }
  out(appendLog({ type: 'act', class: 'owner-setting', key, value, what: `asked for ${key} ${value === null ? 'no limit' : value}`, refs: [], reversible: true, ...(proof ? { proof } : {}) }, by).id);
}
export function cmdPane() {
  const sub = positional[0];
  if (sub === 'question') {
    const a = supervisorAsk();
    if (flags.json) return json({ ask: a.ask, problem: a.problem ?? null, ...(flags.pane ? { target: a.target } : {}) });
    const q = a.ask;
    if (!q) return out(`the supervisor's terminal is asking nothing${a.problem ? ` (${a.problem})` : ''}`);
    if (q.kind !== 'menu') return out(`${q.text}\n\n${q.kind === 'limit' ? "the supervisor is stopped at a usage-limit menu: the dashboard restarts it once an account has room" : "the supervisor's terminal needs someone at it: this is answered in the terminal, not on the dashboard"}${a.problem ? ` (${a.problem})` : ''}`);
    return out(`${q.question || '(no words above the options)'}\n${q.options.map((o) => `${o.n === q.selected ? '>' : ' '} ${o.n}. ${o.label}`).join('\n')}${q.hint ? `\n${q.hint}` : ''}\ndigest ${q.digest}`);
  }
  if (sub === 'answer') die("pane answer: no command answers what the supervisor's terminal asks. The owner answers on the dashboard's card (the top of the Inbox), or in the terminal; `pane question` prints what it is asking");
  if (sub !== 'answered' || !flags.owner) die('usage: pane question [--json]   (what the supervisor\'s terminal is asking; the owner answers it on the dashboard\'s card, which no command stands in for)');
  const { by } = ownerWriter('a question a tool asks in your terminal is the owner\'s to answer, on the dashboard; wait for it');
  let b = null;
  try { if (!process.stdin.isTTY) b = JSON.parse(fs.readFileSync(0, 'utf8') || 'null'); } catch {}
  const line1 = (x, max) => typeof x === 'string' && x.length <= max;
  // an option (its number, its label, the keys that took it) or Esc (the Escape key, no option, no label)
  const asOption = isObj(b) && b.escape === undefined && Number.isInteger(b.option) && b.option >= 1 && b.option <= 9 && line1(b.label, 4000) && /^\d(, Enter)?$/.test(b.keys ?? '');
  const asEsc = isObj(b) && b.escape === true && b.option === undefined && b.label === undefined && b.keys === 'Escape';
  if (!isObj(b) || !/^[0-9a-f]{40}$/.test(b.digest ?? '') || !(asOption || asEsc) || !line1(b.first, 4000) || typeof b.taken !== 'boolean' || (b.why !== undefined && !line1(b.why, 400))) die('pane answered: this is what the dashboard runs after the owner\'s click on its card; nothing was recorded');
  let proof = null;
  if (threadsNeedGateway()) {
    const no = (why) => die(`pane answered: on a box the owner answers only on the dashboard through the box's gateway, which signs the press, and ${why}`);
    const why = paneProofProblem(b.proof);
    if (why) no(why);
    let signed = null;
    try { signed = JSON.parse(Buffer.from(b.proof.body, 'base64').toString('utf8')); } catch {}
    if (!paneAnswerShape(signed) || signed.digest !== b.digest || signed.option !== b.option || signed.escape !== b.escape) no('the gateway signed another press than this one');
    if (logObjects('act').some((a) => a.class === 'pane-answer' && a.proof?.nonce === b.proof.nonce)) no('that press was taken already');
    proof = { port: b.proof.port, ts: b.proof.ts, nonce: b.proof.nonce, sig: b.proof.sig, body: b.proof.body };
  }
  const flat = (t, max) => { const x = noArtifactLinks(t).replace(UNSAFE_TEXT_ALL, ' ').replace(/\s+/g, ' ').trim(); return x.length > max ? `${x.slice(0, max - 1)}…` : x; };
  const about = `"${flat(b.first, 120) || '(no words above the options)'}"${typeof b.artifact === 'string' && /^[A-Za-z0-9-]{6,64}$/.test(b.artifact) ? ` (artifact ${b.artifact})` : ''}`;
  const chose = asEsc ? 'Esc' : `${b.option}. ${flat(b.label, 120)}`;
  appendLog({ type: 'act', class: 'pane-answer', what: b.taken ? `answered the supervisor's terminal: ${about} with ${chose} (keys: ${b.keys}; question ${b.digest})` : `sent ${b.keys} to the supervisor's terminal for ${about}${asEsc ? '' : `, option ${chose}`}, and it may not have landed: ${flat(b.why ?? 'the terminal did not show that it took it', 300)} (question ${b.digest})`, ...(proof ? { proof } : {}) }, by);
  out(b.taken ? `answered: ${chose}` : `sent, and it may not have landed: ${chose}`);
  // the dashboard has its answer; then what was held for the pane while it asked, if it took the key
  replyNow();
  if (!b.taken) return;
  const { target } = resolvePane(supervisorTarget());
  const key = target ? paneKey(target) : null;
  if (!key || !heldPending(key)) return;
  // its input box comes back a moment after the menu goes
  for (let i = 0; i < 20 && heldPending(key); i++) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); flushHeld(key); }
}

export function cmdSend() {
  const [to, ...words] = positional;
  const text = words.join(' ').replace(/\s+/g, ' ').trim();
  if (!to || !text) die('usage: send <supervisor|ticket-id|plan-<feature>> "<text>" [--kind k] [--re m-…] [--sha s] [--thread t-… (handoff)]');
  const kind = flagStr('kind') ?? 'info';
  const thread = flagStr('thread') ?? null;
  if (thread && kind !== 'handoff') die('--thread goes with --kind handoff only: a handoff names the thread it hands over');
  // --owner: the owner, in their own terminal, telling a session something. Logged as the owner's.
  const from = flags.owner ? ownerWriter().by : myAddress();
  if (from === 'owner' && kind !== 'info') die('the owner sends info messages; answers go through answer <qid>, rulings come from the supervisor');
  if (['ruling', 'answer'].includes(kind) && from !== 'supervisor') die(`only the supervisor sends ${kind} messages`);
  const sha = flagStr('sha') ?? (kind === 'merge-request' ? cwdGit(['rev-parse', 'HEAD']) : null);
  const re = flagStr('re') ?? null;
  // responder-1: a reply's re closes what it names in every reader of open messages, so the
  // responder's never carries one (integrity refuses the line too; this says so before it is built)
  if (re && from === 'responder') die('the responder replies to no message (re): a reply would close what it names; send info, or hand the thread over with --kind handoff --thread <t-id>');
  // kit-109: a ticket or planner writer hands over a thread bound to it, and only the supervisor's
  // re closes a handoff (handledMessages), so a session's re naming one is refused before it is written
  const session = ['ticket', 'planner'].includes(writerClass(from));
  if (re && session && logGet(re)?.type === 'message' && logGet(re).kind === 'handoff') die('a handoff stays open until the supervisor answers it in its thread; say more there with thread reply, or send another handoff');
  if (kind === 'handoff') {
    if (!(from === 'responder' || session) || to !== 'supervisor') die('a handoff is the responder\'s: the responder hands threads to the supervisor (send supervisor "…" --kind handoff --thread <t-id>, run as the responder)');
    if (!thread) die('a handoff names its thread: --thread <t-id>');
    const t = logGet(thread);
    if (t?.type !== 'thread') die(`no thread ${thread} (devteam.mjs thread list)`);
    // a resolved thread takes no supervisor turn, so its handoff could never settle
    if (t.status === 'resolved') die(`${thread} is resolved: the owner closed it, so a handoff on it could never be answered there; ask the owner to reopen it, or send --kind info`);
    if (session && boundWriter(t.subject) !== from) die("this thread isn't about your work; hand over only in a thread about your ticket or plan");
  }
  if (re && logGet(re)?.type !== 'message') warn(`--re ${re} matches no logged message`);
  out(sendLine({ to, kind, text, re, sha, from, ticket: flagStr('ticket') ?? (from === 'owner' ? null : currentTicketId()), thread }).id);
}
// Log one message and type it into the recipient's pane. The log is the record; the pane is
// delivery. A recipient whose pane is gone catches up with `messages`.
// report: an object a caller passes to learn what was typed (typeInto's answer; false when no pane took
// it) and the line itself.
export function sendLine({ to, kind, text, re = null, sha = null, from, ticket = null, thread = null }, report = null) {
  const target = to === 'supervisor' ? supervisorTarget() : tmuxTarget(to);
  const resolved = resolvePane(target);
  const { target: exact } = resolved;
  let { problem } = resolved;
  // never into the machine's operator, by its name or a window number (on a box a fleet's session
  // can be home): only the owner's threads reach it from the kit
  if (!problem && sh('tmux', ['display-message', '-p', '-t', exact, '#{window_name}']) === OPERATOR_WINDOW) problem = 'that is the machine\'s operator, which takes no messages from a fleet';
  // thread only on a handoff's line, so every other message's line is as before
  const line = appendLog({ type: 'message', to, kind, text, re, sha, ticket: ticket ?? (tickets().has(to) ? to : null), ...(thread ? { thread } : {}) }, from);
  const said = `[devteam ${kind} ${line.id} from ${from}${re ? ` re ${re}` : ''}${sha ? ` @ ${sha}` : ''}] ${text}`;
  const typed = problem ? false : typeInto(exact, said);
  if (report) Object.assign(report, { typed, line: said });
  if (!typed) warn(`${line.id} recorded but not delivered to "${to}": ${problem ?? `could not type into ${exact}`}; it shows in their \`messages\``);
  else if (typed !== true) warn(`${line.id} ${heldWords(typed, to === 'supervisor' ? "the supervisor's" : `${to}'s`)}`);
  return line;
}
// A request is settled when the work it is about has landed: a ticket's once it merged, a
// planner's once its plan file is on main, a ticket's review request once it was approved. The
// merge or the approval is the answer even if nobody replied.
//
// Every reader of open messages calls this (messages --open, metrics' unanswered-message and
// messages.still_open, /api/data's open_messages, idsAwaitingReply), so the handoff rule lives here
// and they all agree: a handoff is settled by a supervisor turn in its thread after it, and by
// nothing else here (a responder turn or the owner's resolve never settles it; a reply citing it
// with --re closes it through each reader's replied set, as for any message).
export function settledByLanding(m) {
  // a session's mark on an artifact note awaits no reply: the owner checks the note
  if (m.kind === 'addressed') return true;
  if (m.kind === 'handoff') {
    // the supervisor's newest turn per thread, worked out once per fold (readLog's object), not per message per read
    const log = readLog();
    if (settledByLanding.log !== log) {
      const last = new Map();
      for (const u of log.byType.get('turn') ?? []) if (u.created_by === 'supervisor' && typeof u.thread === 'string' && !(last.get(u.thread) >= u.created_at)) last.set(u.thread, u.created_at);
      Object.assign(settledByLanding, { log, last });
    }
    return (settledByLanding.last.get(m.thread) ?? '') > m.created_at;
  }
  const by = m.created_by ?? m.by;
  if (!by) return false;
  const cls = writerClass(by);
  if (cls === 'ticket' && mergeShaFor(by)) return true;
  // A review request is answered by the approval it asked for: an approve-spec or approve-plan act
  // on the ticket logged after it, whether or not a reply cites the request.
  if (cls === 'ticket' && m.kind === 'review-request') return logObjects('act').some((a) => ['approve-spec', 'approve-plan'].includes(a.class) && (a.refs ?? [])[0] === by && a.created_at > m.created_at);
  if (cls === 'ticket') return false;
  if (cls === 'planner') return !!mainRef() && git(['cat-file', '-e', `${mainRef()}:${projectRel}/log/${by}.jsonl`]) !== null;
  return false;
}
export function cmdMessages() {
  const me = flagStr('to') ?? myAddress();
  const all = logObjects('message').sort(byTime);
  const replied = handledMessages();
  let mine = all.filter((m) => m.to === me);
  if (flags.open) mine = mine.filter((m) => !replied.has(m.id) && !['info', 'ruling', 'answer'].includes(m.kind) && !settledByLanding(m));
  mine = mine.slice(-Number(flagStr('tail') ?? 50));
  if (flags.json) return json(mine);
  if (!mine.length) return out(flags.open ? 'no open messages' : 'no messages');
  for (const m of mine) out(`${m.created_at} ${m.id} [${m.kind}] from ${m.created_by}${m.re ? ` re ${m.re}` : ''}${m.sha ? ` @ ${m.sha.slice(0, 12)}` : ''}: ${m.text}`);
}

// phase <to> [--task t] [--note n] [--usd x --in n --out n]: a worker's phase change, or a liveness
// ping (same phase). Writes a line only when something changed or the last one is older than 15 min.
export function cmdPhase() {
  const to = positional[0];
  const supervisor = to === 'supervisor';
  // A planner logs one phase of its own: parked, when it stops for a drain (supervisor.md, Moving the fleet).
  const planner = !supervisor && !currentTicketId() && writerClass(logWriter()) === 'planner' ? logWriter() : null;
  if (planner && to !== 'parked') die(`a planner logs only phase parked (when drained); its sign of life is its messages, commits and plan file`);
  const id = supervisor ? 'supervisor' : planner ?? currentTicketId() ?? die('phase needs DEVTEAM_TICKET or a ticket/<id> branch');
  if (!to) die('usage: phase <starting|spec|plan|contract|build|verify|final-review|awaiting-word|merging|done|blocked|parked> [--task t] [--note n] [--usd x --in n --out n]');
  for (const k of ['usd', 'in', 'out']) if (flags[k] !== undefined && !(Number(flagStr(k)) >= 0)) die(`--${k} must be a number ≥ 0`);
  const prev = logObjects('phase').filter((p) => p.created_by === id).sort(byTime).pop() ?? null;
  const cost = flags.usd !== undefined || flags.in !== undefined || flags.out !== undefined
    ? { usd: flagNum('usd') ?? prev?.usd ?? 0, input_tokens: flagNum('in') ?? prev?.input_tokens ?? 0, output_tokens: flagNum('out') ?? prev?.output_tokens ?? 0 }
    : {};
  if (supervisor) {
    supervisorOnly('phase supervisor');
    if (cost.usd === undefined) die('phase supervisor needs --usd (its cumulative spend)');
    appendLog({ type: 'phase', from: 'supervisor', to: 'supervisor', ...cost }, 'supervisor');
    return out('recorded supervisor cost');
  }
  const task = flagStr('task') ?? prev?.task;
  const changed = !prev || prev.to !== to || prev.task !== task || (cost.usd !== undefined && cost.usd !== prev.usd) || flags.note !== undefined;
  const stale = !prev || Date.now() - Date.parse(prev.created_at) > Math.min(15, loadSettings().stale_after_minutes / 3) * 60000;
  // Parking stops the session's own servers; the records stay for preview start after a resume.
  if (to === 'parked') stopPreviewsOf(id, { keepRecords: true });
  if (!changed && !stale) return out(`phase ${to} (unchanged)`);
  appendLog({ type: 'phase', from: prev?.to ?? null, to, task, note: flagStr('note')?.slice(0, 280), sha: cwdGit(['rev-parse', 'HEAD']) ?? undefined, ...cost }, id);
  out(`phase ${to}${task ? ` ${task}` : ''}`);
  // Waiting with nothing asked looks the same as waiting with a request answered: say so.
  if (['awaiting-word', 'blocked'].includes(to)) {
    const msgs = logObjects('message');
    const replied = handledMessages();
    if (!msgs.some((m) => m.created_by === id && m.to === 'supervisor' && !replied.has(m.id) && !['info', 'ruling', 'answer'].includes(m.kind)))
      warn(`${to} with no open request to the supervisor: send one (--kind review-request for approve-spec, approve-plan or the stage word; merge-request at the end; blocked), since info expects no reply`);
  }
}

// gate <name> [--junit report.xml] -- <command…>: run a gate and record its time, result and tests.
export function cmdGate() {
  if (flags.all) return gateAll();
  const name = positional[0];
  if (!name || !rest?.length) die('usage: gate <name> [--junit <report.xml>] -- <command> [args…]   |   gate --all');
  // A gate's name is a short word (test, lint, model-size): a stray shell expansion once recorded
  // node's help text as hundreds of "gates".
  if (!GATE_NAME.test(name)) die(`gate name "${name.slice(0, 60)}" must be a short lowercase word or words joined by hyphens (test, lint, model-size)`);
  const started = Date.now();
  let ok = true;
  try {
    execFileSync(rest[0], rest.slice(1), { stdio: 'inherit' });
  } catch {
    ok = false;
  }
  const tests = readJunit(flagStr('junit'));
  appendLog({ type: 'gate', gate: name, ok, ms: Date.now() - started, ...repoField(cwdRepo()), sha: cwdGit(['rev-parse', 'HEAD']) ?? undefined, dirty: cwdGit(['status', '--porcelain']) ? true : undefined, tests_total: tests.length, tests: keepTests(tests) });
  process.stderr.write(`devteam: gate ${name} ${ok ? 'passed' : 'FAILED'} in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
  process.exit(ok ? 0 : 1);
}

// A gate line run in a repo link's checkout names that repo; home's carry no field, as before.
export const repoField = (R) => (R && R.name !== 'home' ? { repo: R.name } : {});
// Run every gate in the settings here, as merge would, and print which pass. Run once at adoption
// on main: a gate that fails there goes on in ratchet mode or gets a chore ticket (quality.md §2).
// "Here" is the repo of this checkout: in a repo link's, that repo's gates and DEVTEAM_MAIN, never
// home's.
export function gateAll() {
  const R = cwdRepo() ?? repo('home');
  const gates = Object.entries(R.settings.gates ?? {});
  if (!gates.length) die(R.name === 'home' ? 'no gates in settings' : `no gates for ${R.name} in settings (links.${R.name}.gates)`);
  const rows = [];
  for (const [name, spec] of gates) {
    const cmd = typeof spec === 'string' ? spec : spec.cmd;
    const started = Date.now();
    let ok = true;
    try { execFileSync('sh', ['-c', cmd], { stdio: ['ignore', 'ignore', 'inherit'], env: gateEnv(null, R) }); } catch { ok = false; }
    const ms = Date.now() - started;
    appendLog({ type: 'gate', gate: name, ok, ms, ...repoField(R), sha: cwdGit(['rev-parse', 'HEAD']) ?? undefined, tests_total: 0, tests: [] });
    rows.push({ name, ok, ms, mode: spec.mode ?? 'enforced' });
    out(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(20)} ${(ms / 1000).toFixed(1)}s  ${spec.mode ?? 'enforced'}`);
  }
  const bad = rows.filter((r) => !r.ok && r.mode !== 'ratchet');
  if (bad.length) { out(`\n${bad.length} enforced gate(s) fail here: fix the toolchain, set "mode": "ratchet", or open a chore ticket for each`); process.exit(1); }
}

// --- every ask of the owner is an Inbox question ---
//
// The owner looks at the Inbox, not at a pane or a thread's scrollback: an ask that lives only in
// words gets forgotten. ownerAsks(text) reads words written to the owner (a reply in a thread, the
// supervisor's own message in its window) for the things they ask: a line that ends in a question
// mark, and each item listed under a lead line such as "Waiting on you:" or "Open questions for
// you:". Code blocks and quoted lines are left out. An ask that names a q-… id of a question in the
// log is filed: it points at its Inbox question. On a line ending in a question mark the ask is its
// last sentence, so an id earlier in the line files nothing after it. What's left are asks only the
// words hold.
export const OWNER_ASK_QID = /\bq-\d{8}-\d{6,9}(-[a-z0-9]+)*\b/g;
// an id as written may run on into its writer's name (q-…-supervisor) or not: the longest that is one
export const isLoggedQuestion = (id) => { for (let p = id.split('-'); p.length >= 3; p.pop()) if (logGet(p.join('-'))?.type === 'question') return true; return false; };
export const OWNER_ASK_LEAD = /\b(waiting on you|(open |pending )?questions? for you|for you to (decide|answer|do|check)|needs? (from )?you|from you:|your (call|answer|decision)s?)\b/i;
export function ownerAsks(text, isQuestion = isLoggedQuestion) {
  const asks = [];
  let fence = false;
  let listed = false;
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence || line.startsWith('>')) continue;
    if (!line) { listed = false; continue; }
    const item = /^([-*•]|\d+[.)])\s+/.test(line);
    if (!item) listed = OWNER_ASK_LEAD.test(line) && /:\s*$/.test(line);
    const words = line.replace(/^([-*•]|\d+[.)])\s+/, '');
    const asked = /\?[\s"'”’)*_\]]*$/.test(words);
    const asking = asked || (item && listed);
    const ask = asked ? words.split(/(?<=[.!?])\s+(?=\S)/).pop() : words;
    if (asking && !(OWNER_ASK_LEAD.test(line) && /:\s*$/.test(line))) asks.push({ line: words, filed: (ask.match(OWNER_ASK_QID) ?? []).some((id) => isQuestion(id)) });
  }
  return asks;
}
// The asks in text that point at no Inbox question. A reply that shows questions (--refs
// question:<id>, ids its words don't already name) covers that many of them, in order: "Ship it?"
// with --refs question:q-… is that question asked in the thread.
export function unfiledOwnerAsks(text, shown = []) {
  const named = shown.filter((q) => !String(text ?? '').includes(q));
  return ownerAsks(text).filter((a) => !a.filed).slice(named.length).map((a) => a.line);
}
export const UNFILED_ASKS_WHY = 'the owner answers in the Inbox and can lose an ask that lives only in words (supervisor.md §6, Every ask is an Inbox question)';
// The last thing the session said, from a Stop hook's input: last_assistant_message where Claude Code
// gives it, else the newest assistant entry with text in the transcript.
export function stopHookLastWords(input) {
  if (typeof input?.last_assistant_message === 'string') return input.last_assistant_message;
  const lines = (readText(String(input?.transcript_path ?? '')) ?? '').split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    const content = e?.type === 'assistant' ? e.message?.content : null;
    const text = Array.isArray(content) ? content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n') : typeof content === 'string' ? content : '';
    if (text.trim()) return text;
  }
  return '';
}
// For an agent's stop hook: exit 2 while the worker's last commit is newer than its last phase line;
// for the supervisor's, while its last words ask the owner something no Inbox question holds.
export function cmdStopOk() {
  // what Claude Code hands a Stop hook (never read from a terminal). stop_hook_active is its "this hook
  // already sent it back": the second stop always goes through, so no stop is blocked twice
  let input = null;
  if (!process.stdin.isTTY) try { input = JSON.parse(fs.readFileSync(0, 'utf8') || 'null'); } catch {}
  if (input?.stop_hook_active) process.exit(0);
  // the supervisor's own window (its Stop hook, supervisorPolicy, says --supervisor), by its role and
  // never its folder: it cds into a ticket's worktree to review or merge, and stays the supervisor.
  // Once per stop, an ask of the owner that names no Inbox question sends it back to ask it there.
  if (flags.supervisor || process.env.DEVTEAM_ROLE === 'supervisor') {
    const left = unfiledOwnerAsks(stopHookLastWords(input));
    if (!left.length) process.exit(0);
    process.stderr.write(`devteam: you asked the owner ${left.length === 1 ? 'something' : `${left.length} things`} in your window with no Inbox question, and ${UNFILED_ASKS_WHY}:\n${left.slice(0, 12).map((l) => `  - ${l}`).join('\n')}\nFor each: ask it in the Inbox (ask, or thread ask <t-id> when it came up in a thread, so the question and the thread link to each other), give it a --default where §6 allows one, or decide it yourself and log it when it is your call; one already asked, cite it by its q-… id. Then say it again with each q-… id beside its line.\n`);
    process.exit(2);
  }
  const id = currentTicketId();
  if (!id) process.exit(0);
  const last = logObjects('phase').filter((p) => p.created_by === id).sort(byTime).pop();
  const commitAt = Date.parse(cwdGit(['log', '-1', '--format=%cI']) ?? '');
  if (last && !['done', 'parked'].includes(last.to) && commitAt > Date.parse(last.created_at) + 60000) {
    process.stderr.write(`devteam: your last commit is newer than your last phase line; run: devteam.mjs phase ${last.to} [--task …]\n`);
    process.exit(2);
  }
  process.exit(0);
}

// --- ticket number blocks ---
//
// Planners run in parallel, each on its own branch, so none can see the numbers the others take.
// `planner <feature>` reserves a block of ticket numbers for the feature (an id_block on the act
// that made it) above every number on main, in another planner's graph, and in every earlier block;
// the planner numbers its tickets from it. Numbers are counted across components, so a block is
// free whatever components the feature touches.
export const ID_BLOCK_DEFAULT = 20;
// The NN of <component>-NN-<slug>, or null.
export function ticketNumber(id, component) {
  const m = component && id.startsWith(`${component}-`) ? id.slice(component.length + 1).match(/^(\d{2,})-/) : id.match(/-(\d{2,})-/);
  return m ? Number(m[1]) : null;
}
export const padNN = (n) => String(n).padStart(2, '0');
export const idBlocks = () => logObjects('act').filter((a) => a.id_block).sort(byTime).map((a) => a.id_block);
export const idBlockFor = (feature) => idBlocks().filter((b) => b.feature === feature).pop() ?? null;
// The ticket lines (op new) of every plan branch in flight, or of one: its worktree's plan file,
// else the branch's.
export function inFlightPlanTickets(only = null) {
  const branches = only ? [only] : (git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/plan/']) ?? '').split('\n').filter(Boolean);
  return branches.flatMap((b) => {
    const by = `plan-${b.slice('plan/'.length)}`;
    const text = readText(path.join(mainRoot, '.worktrees', by, projectRel, 'log', `${by}.jsonl`)) ?? git(['show', `${b}:${projectRel}/log/${by}.jsonl`]) ?? '';
    return text.split('\n').filter(Boolean).map((t) => { try { return JSON.parse(t); } catch { return null; } }).filter((o) => o?.type === 'ticket' && o.op === 'new' && typeof o.id === 'string');
  });
}
export function reserveIdBlock(feature, size) {
  const used = [
    ...[...tickets().values()].map((t) => ticketNumber(t.id, t.component)),
    ...inFlightPlanTickets().map((t) => ticketNumber(t.id, t.component)),
    ...idBlocks().map((b) => b.to),
  ].filter((n) => Number.isInteger(n));
  const from = Math.max(0, ...used) + 1;
  return { feature, from, to: from + size - 1 };
}
export const idBlockText = (b) => `Your ticket numbers: ${padNN(b.from)} to ${padNN(b.to)}, reserved for this feature (other planners number in parallel). Number every ticket <component>-NN-<slug> with NN in that block, in order; if you need more, ask the supervisor for another block rather than going past it.`;
export const plannerPrompt = (feature) => {
  const b = idBlockFor(feature);
  return `${PROMPTS.planner.replace(/\{\{ID\}\}/g, feature)}${b ? ` ${idBlockText(b)}` : ''}`;
};

// worker <ticket-id> [--resume] | planner <feature> [--resume]: a git worktree, a tmux window, the
// agent command from the settings, and the role's prompt (plus the knowledge that applies).
// worker <id> --remove: after its merge, a worker's worktree removed through the repo it is a
// worktree of (a sibling's can't be removed by home's git), and that repo's worktree list pruned, so
// one removed by hand leaves no stale entry holding ticket/<id> checked out. Refused until the
// ticket is merged and its worker has logged phase done (its final spend); --force removes it
// anyway. The branch stays, so a reopened ticket's worker starts again from it.
// A records-in-home worker's checkout of home on ticket/<id>: the local branch, else origin's
// (a moved fleet), else new from home's main. Not seeded: it holds only records.
export const recordsWorktreePath = (id) => path.join(mainRoot, '.worktrees', `records-${id}`);
export function ensureRecordsWorktree(id) {
  const rw = recordsWorktreePath(id);
  if (fs.existsSync(rw)) return rw;
  const branch = `ticket/${id}`;
  const mb = loadSettings().main_branch;
  const clock = {}; // one 5 s for both fetches
  fetchPastHalfMade(['fetch', '--quiet', 'origin', mb], clock);
  fetchPastHalfMade(['fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], clock);
  // -c core.useReplaceRefs=false (kit-778): a replace ref or core.useReplaceRefs any session can set would otherwise swap the tree checked out
  const add = ['-c', 'core.useReplaceRefs=false', 'worktree', 'add', '--quiet'];
  // asked anew for each try: a failed one leaves the branch it made
  worktreeAddOrDie(() => (resolveCommit(`refs/heads/${branch}`) ? [...add, rw, branch]
    : resolveCommit(`refs/remotes/origin/${branch}`) ? [...add, '--track', '-b', branch, rw, `origin/${branch}`]
      : [...add, '-b', branch, rw, resolveCommit(`origin/${mb}`) ? `origin/${mb}` : mb]), rw, { root: mainRoot, common: commonDir });
  return rw;
}
export function removeWorkerWorktree(id) {
  const wt = path.join(mainRoot, '.worktrees', id);
  const T = repoOfTicket(tickets().get(id)); // an act: fails fast on a missing or wrong checkout
  if (!flags.force) {
    if (!T.mergeShaFor(id)) die(`${id} is not merged yet; --force removes its worktree anyway (uncommitted work in it is lost)`);
    if (lastPhaseOf(id)?.to !== 'done') die(`${id}'s worker hasn't logged phase done (its final spend); wait for it, or --force removes its worktree anyway`);
  }
  stopPreviewsOf(id, { keepRecords: false });
  const R = fs.existsSync(wt) ? worktreeRepo(wt) ?? die(`${wt} is a worktree of no repo this machine can read`) : T;
  // records in home: its records worktree goes too, through home, and first, so one git refuses
  // (uncommitted records) before anything is removed
  if (recordsInHomeId(id)) {
    const rw = recordsWorktreePath(id);
    if (fs.existsSync(rw)) { gitOrDie(['worktree', 'remove', ...(flags.force ? ['--force'] : []), rw], mainRoot); out(`removed ${rw} (a worktree of home)`); }
    gitOrDie(['worktree', 'prune'], mainRoot);
  }
  if (fs.existsSync(wt)) {
    R.gitOrDie(['worktree', 'remove', ...(flags.force ? ['--force'] : []), wt], R.root);
    out(`removed ${wt} (a worktree of ${R.name})`);
  }
  R.gitOrDie(['worktree', 'prune'], R.root);
  out(`pruned ${R.name}'s worktree list; now close its window`);
}
