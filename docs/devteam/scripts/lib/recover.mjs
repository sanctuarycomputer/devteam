/* imports start */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HUB_PORT } from './orient.mjs';
import { LIMIT_BANNER } from './accounts.mjs';
import { LIMIT_HIT } from './graph.mjs';
import { LIMIT_REACHED } from './graph.mjs';
import { PANE_BUSY } from './panes.mjs';
import { PANE_CODE } from './graph.mjs';
import { SHELLS } from './sessions.mjs';
import { SKIP_PERMISSIONS } from './accounts.mjs';
import { capBytes } from './threads.mjs';
import { die } from './base.mjs';
import { fileAge } from './sensors.mjs';
import { flagStr } from './base.mjs';
import { flags } from './base.mjs';
import { git } from './base.mjs';
import { here } from './state.mjs';
import { hostCheck } from './host.mjs';
import { isSupervisorProcess } from './accounts.mjs';
import { limitState } from './accounts.mjs';
import { listFlag } from './base.mjs';
import { loadSettings } from './settings.mjs';
import { logWriter } from './log.mjs';
import { machineKnowledge } from './hub/operator.mjs';
import { machineQuestions } from './hub/operator.mjs';
import { machineStatus } from './hub/health-pool.mjs';
import { mainRoot } from './state.mjs';
import { markedPane } from './log.mjs';
import { nowIso } from './base.mjs';
import { out } from './base.mjs';
import { paneAgentProcess } from './accounts.mjs';
import { paneStartedIn } from './accounts.mjs';
import { positional } from './base.mjs';
import { processInfo } from './accounts.mjs';
import { promptPointer } from './sessions.mjs';
import { readJson } from './base.mjs';
import { readText } from './base.mjs';
import { realPath } from './state.mjs';
import { realPathMade } from './state.mjs';
import { recordSupervisorPane } from './log.mjs';
import { remoteKeyAt } from './state.mjs';
import { repo } from './repos.mjs';
import { repoLinksIn } from './state.mjs';
import { repoRoot } from './state.mjs';
import { rest } from './base.mjs';
import { runDir } from './state.mjs';
import { runPath } from './settings.mjs';
import { sessionMarkerPrefix } from './sessions.mjs';
import { sh } from './base.mjs';
import { shq } from './scores.mjs';
import { spawnSync } from 'node:child_process';
import { startedSkippingPermissions } from './accounts.mjs';
import { supervisorOpeningPrompt } from './sessions.mjs';
import { supervisorPaneFile } from './log.mjs';
import { supervisorPaneMark } from './log.mjs';
import { supervisorResumeCommand } from './accounts.mjs';
import { supervisorSessionId } from './accounts.mjs';
import { tmux } from './sessions.mjs';
import { tmuxServerEnv } from './sessions.mjs';
import { tmuxSession } from './base.mjs';
import { typeLock } from './log.mjs';
import { typeNow } from './sessions.mjs';
import { withLock } from './log.mjs';
import { withSupervisorPolicy } from './responder.mjs';
import { withoutSkipPermissions } from './accounts.mjs';
import { writeJson } from './base.mjs';
/* imports end */
// ===== recover: the supervisor back after a restart =====
//
// A dead machine writes nothing at the end, so whether the supervisor was up has to be noted while it
// is: run/supervisor-up.json, by each dashboard's minute tick (what it can see of the pane or the
// process) and by the supervisor's own commands (the only way to know one in a plain terminal). It
// holds a boot's identity, so a supervisor that went with the machine reads differently from one the
// owner closed while the machine stayed up, and what the OS said about the process's own flags.
export const SUPERVISOR_UP_FILE = runPath('supervisor-up.json');
export const SUPERVISOR_UP_CHECK = runPath('supervisor-up.checked');
export const SUPERVISOR_UP_EVERY_MS = 60000;
// A record this old says nothing about the machine that wrote it. The same age as the box's restore list.
export const SUPERVISOR_UP_MAX_MS = 3 * 24 * 3600000;
// Long enough for a window to open and the agent's process to appear; a second recover meanwhile is a no-op.
export const RECOVER_STARTING_MS = 3 * 60000;
// A recover has claimed this start and the agent may not have exec'd yet. Dated in the future, or past the window, it counts for nothing.
export const recoverStarting = (rec) => { const t = rec?.starting ? Date.now() - rec.starting : Infinity; return t >= 0 && t < RECOVER_STARTING_MS; };
export const supervisorUpRecord = () => { try { const r = readJson(SUPERVISOR_UP_FILE); return r && typeof r === 'object' ? r : null; } catch { return null; } };
export const writeSupervisorUp = (r) => { writeJson(SUPERVISOR_UP_FILE, { at: nowIso(), ...r }); registerOnMachine(); };
// Which boot this is: a reboot or a new container changes it, and nothing else does. On Linux both
// halves are needed: init's start time counts ticks since boot, so it's near the same on every boot
// of a bare host, and the kernel's boot id is the host's, so it outlives a container's redeploy. Elsewhere, when
// init started. Null if it can't be read; DEVTEAM_MACHINE_EPOCH is a test's stand-in for a boot.
export function machineEpoch() {
  if (process.env.DEVTEAM_MACHINE_EPOCH) return process.env.DEVTEAM_MACHINE_EPOCH;
  const init = processStart(1);
  if (process.platform !== 'linux' || !init) return init;
  try { const boot = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); return boot ? `${boot}:${init}` : null; } catch { return null; }
}
// When a pid's process started, so a pid the OS has reused is told from the one that was recorded.
export function processStart(pid) {
  if (process.platform === 'linux') {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null;
    } catch { return null; }
  }
  return sh('ps', ['-o', 'lstart=', '-p', String(pid)]) || null;
}
export function parentPid(pid) {
  if (process.platform === 'linux') {
    try { const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]); } catch { return 0; }
  }
  return Number(sh('ps', ['-o', 'ppid=', '-p', String(pid)])) || 0;
}
export const isAgentArgs = (args) => args.slice(0, 2).some((a) => /(^|\/)(claude|codex|opencode)(\.[cm]?js)?$/.test(a) || a.includes('/claude-code/') || a.includes('/claude/versions/'));
// The agent this process runs under, in a plain terminal: the nearest ancestor that is one, or null.
export function agentAncestor() {
  let pid = process.ppid;
  for (let i = 0; i < 12 && pid > 1; i++) {
    const info = processInfo(pid);
    if (!info) return null;
    if (isAgentArgs(info.args)) return { pid, args: info.args };
    pid = parentPid(pid);
  }
  return null;
}
// The tmux server's pid, or null with none running (or none answering).
export const tmuxServerPid = () => sh('tmux', ['list-sessions', '-F', '#{pid}'])?.split('\n')[0] || null;
// The supervisor's pane now, or null: the one it noted, or else anything agent-shaped started at the
// repo's root. Never a preview, a dashboard or the operator's window, and never a pane started in a
// worktree: pane ids restart at %0 with the tmux server, so a noted id can be anyone's by now.
export const SUPERVISOR_NOT_WINDOW = /^(dev~|dash-|dashboard$|operator$)/;
// What an agent's process is called in tmux: Claude Code shows as its version (2.1.307).
export const AGENT_PANE_CMD = /claude|node|codex|opencode|bun|^\d+\.\d+/;
export function supervisorPaneNow(rec = supervisorUpRecord(), opts = {}) { return supervisorPaneIn(mainRoot, markedPane(runDir), rec, opts); }
// Any repo's, for the machine's commands: its root, the pane it noted, its supervisor-up record.
// strict, for typing into it: started at the root whatever the record says, and never a window
// named shell (the owner's).
export function supervisorPaneIn(repo, noted, rec, { notedOnly = false, strict = false } = {}) {
  const listed = sh('tmux', ['list-panes', '-a', '-F', '#{pane_id}\t#{window_name}\t#{pane_start_path}\t#{pane_current_command}\t#{@devteam-shell}']);
  if (listed === null) return null;
  if (noted && !noted.startsWith('%')) noted = sh('tmux', ['display-message', '-p', '-t', noted, '#{pane_id}']);
  const root = realPath(repo);
  const server = tmuxServerPid();
  let other = null;
  for (const l of listed.split('\n').filter(Boolean)) {
    const [id, win, start, cmd, tag] = l.split('\t');
    // a pane tagged @devteam-shell is a terminal's own shell, never the supervisor unless noted as it
    if (tag && id !== noted) continue;
    if (SUPERVISOR_NOT_WINDOW.test(win) || SHELLS.has(cmd.replace(/^-/, ''))) continue;
    const at = realPath(start);
    if (at === path.join(root, '.worktrees') || at.startsWith(path.join(root, '.worktrees') + path.sep)) continue;
    if (strict && (at !== root || win === 'shell')) continue;
    // a noted id is only as good as the server it was noted on; with nothing to say so, it must be
    // started at the root, or a restored fleet's panes %0, %1… would read as this repo's own
    if (id === noted && (rec?.server ? rec.server === server : at === root)) return id;
    if (at === root && AGENT_PANE_CMD.test(cmd) && !other) other = id;
  }
  return notedOnly ? null : other;
}
// Is the supervisor running right now? Its pane, or a recorded foreground process still alive.
export function supervisorRunningNow(rec) {
  if (supervisorPaneNow(rec)) return true;
  return rec?.kind === 'foreground' && !!rec.pid && !!rec.start && processStart(rec.pid) === rec.start;
}
// Just after an upgrade, a running supervisor's pane is still recorded bare, as its older kit wrote it,
// until its next command with the role. Read as no pane, the tick would write it stopped, and a
// restart in that window would leave it down. A bare pane started at the root whose agent runs as the
// supervisor is its pane, whoever recorded it: marked here, it counts from this tick on. Only the
// mark is written: the bare record is the one just read, and rewriting it could race a newer one.
export function markUpgradedPane() {
  if (markedPane(runDir)) return;
  const bare = readText(supervisorPaneFile(runDir))?.trim();
  if (bare && paneStartedIn(bare, realPath(mainRoot)) && isSupervisorProcess(paneAgentProcess(bare))) fs.writeFileSync(supervisorPaneMark(runDir), bare);
}
// From the dashboard's minute tick. It doesn't touch a record once the machine or the tmux server has
// changed under it, so a dashboard that comes up after a restart, before recover has run, can't erase
// what recover needs. Nor does it say "stopped" when tmux doesn't answer: not knowing isn't a stop.
export function noteSupervisorFromTick() {
  try {
    registerOnMachine();
    const rec = supervisorUpRecord();
    const machine = machineEpoch();
    if (!machine) return;
    // only the pane the supervisor noted: an ad-hoc agent at the repo's root isn't it, though it's
    // reason enough not to start a second one (supervisorRunningNow)
    markUpgradedPane();
    const pane = supervisorPaneNow(rec, { notedOnly: true });
    if (pane) {
      const agent = paneAgentProcess(pane);
      // Only what the process's own arguments say: unreadable, or with the flag but not running as
      // the supervisor, it says nothing new. Left undefined, it says nothing at all.
      const prev = rec?.pane === pane ? rec.skip : undefined;
      const skip = !agent ? prev : !startedSkippingPermissions(agent.args) ? false : isSupervisorProcess(agent) ? true : prev;
      return writeSupervisorUp({ up: true, kind: 'tmux', pane, server: tmuxServerPid(), machine, skip });
    }
    if (!rec?.up) return;
    // the window is open and the agent hasn't exec'd yet: not a supervisor someone closed
    if (recoverStarting(rec)) return;
    if (rec.kind === 'foreground') {
      if (rec.pid && processStart(rec.pid) === rec.start) return writeSupervisorUp({ ...rec, at: nowIso() });
      if (rec.machine === machine) writeSupervisorUp({ ...rec, up: false });
      return;
    }
    if (rec.machine === machine && rec.server && tmuxServerPid() === rec.server) writeSupervisorUp({ ...rec, up: false });
  } catch {}
}
// From the supervisor's own commands, at most once a minute: the only record of one in a plain
// terminal, where no pane says what it is. Only under DEVTEAM_ROLE=supervisor and only an agent's
// process, so the owner running a command by hand is never taken for it.
// DEVTEAM_SUPERVISOR_UP=off: a test's stand-in supervisor, under whatever agent runs the tests, isn't it.
export function noteSupervisorSelf() {
  if (process.env.DEVTEAM_ROLE !== 'supervisor' || process.env.DEVTEAM_SUPERVISOR_UP === 'off') return;
  try {
    if (fileAge(SUPERVISOR_UP_CHECK) < SUPERVISOR_UP_EVERY_MS) return;
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(SUPERVISOR_UP_CHECK, '');
    const machine = machineEpoch();
    if (!machine) return;
    // TMUX with no pane is the dashboard's tick relaunching a session, not the supervisor's own command
    if (process.env.TMUX && !process.env.TMUX_PANE) return;
    // Its own ancestors, not the pane's children: BSD pgrep leaves out the caller's ancestors, so on
    // macOS a command run under the agent can't find it that way. A command typed at a shell, role
    // or no role, has no agent above it and says nothing.
    const agent = agentAncestor();
    if (!agent) return;
    const skip = startedSkippingPermissions(agent.args);
    const pane = process.env.TMUX_PANE;
    writeSupervisorUp(pane ? { up: true, kind: 'tmux', pane, server: tmuxServerPid(), machine, skip } : { up: true, kind: 'foreground', pid: agent.pid, start: processStart(agent.pid), machine, skip });
  } catch {}
}
// Why the supervisor shouldn't come back, or null if it should: the record never says more than
// "it was up, on a machine that has since restarted". It is never read from the log: a line there can
// be written by hand, and only a process the OS was asked about, by the kit, counts here.
export function recoverRefusal(rec) {
  if (!rec || rec.up === undefined) return 'left stopped (not running before the restart; --force starts it)';
  if (rec.up === false) return 'left stopped (stopped before the restart; --force starts it)';
  const age = Date.now() - Date.parse(rec.at);
  if (!Number.isFinite(age) || age < 0) return 'left stopped (its record of being up is dated in the future; --force starts it)';
  if (age > SUPERVISOR_UP_MAX_MS) return `left stopped (last seen up ${Math.floor(age / 86400000)} days ago; --force starts it)`;
  const machine = machineEpoch();
  if (!machine) return 'NOT started (could not tell whether this machine restarted)';
  if (rec.machine === machine && !(rec.kind === 'tmux' && rec.server && tmuxServerPid() !== rec.server)) return 'left stopped (this machine did not restart since it was up: it stopped or was closed; --force starts it)';
  return null;
}
export const RECOVER_MESSAGE = 'This machine restarted, and this is you, resumed on your own conversation; what was in flight did not finish. Follow supervisor.md §11, after your own restart: §1 again. Every worker and planner window went with the restart; accounts-tick relaunches each one the kit launched, one per tick (§11), so give it those first, and start the dashboard first if its address does not answer (§11): the dashboard is what runs it. §1.4 sends to recovery only the tickets still without a window after it has caught up, or all of them on a kit too old to relaunch. Nothing about this restart came from the owner: it answers, approves and decides nothing, so record nothing as theirs from it. Then keep the loop, as before the restart: run the tick (§3) now, then wait with devteam.mjs wait and tick again when it returns, until the owner stops you. A summary to the owner doesn\'t end it.';
export const NO_EXACT_RESUME = '(only Claude Code can resume a conversation exactly: this one re-orients from the log and the files)';
export const NAME_FOR_TMUX = /^[\w.~-]+$/;
// One line on what it did: what recover exists to report, and all that goes to stdout.
export function recoverOne() {
  const dry = !!flags['dry-run'];
  const force = !!flags.force;
  const here = !!flags.here;
  if (repoRoot !== mainRoot) die(`run this from the main checkout (${mainRoot})`);
  const sessionFlag = flagStr('session');
  const windowFlag = flagStr('window');
  if ((sessionFlag && !NAME_FOR_TMUX.test(sessionFlag)) || (windowFlag && !NAME_FOR_TMUX.test(windowFlag))) die('--session and --window are tmux names');
  const rec = supervisorUpRecord();
  // never two: first, under any flag
  if (supervisorRunningNow(rec)) return { say: 'already running' };
  if (recoverStarting(rec)) return { say: 'already running (brought back moments ago)' };
  // A supervisor is never down by accident: a parked or drained fleet's comes back like any other.
  // Under a pause it answers threads and questions and keeps the Inbox and log current; under a move
  // its prompt has it carry the move on and start nothing. It is down only when someone exited it
  // (recoverRefusal: stopped before the restart), as the last step of a move does (supervisor.md §12).
  if (!force && !flags['was-up']) {
    const no = recoverRefusal(rec);
    if (no) return { say: no };
  }
  // after every early return, as cmdRecover's line before the lock: a supervisor left stopped needs
  // no owner's command, so origin is read only for a start (kit-764)
  const s = loadSettings();
  const id = supervisorSessionId();
  const exact = /^claude(\s|$)/.test(s.resume_command);
  const missing = (s.worktree_files ?? []).filter((f) => !fs.existsSync(path.join(mainRoot, f)));
  const how = id ? `resume session ${id}` : 'start fresh';
  let cmd = id ? supervisorResumeCommand(id) : s.agent_command;
  if (id && !cmd) return { say: 'NOT started (its resume_command has no --continue to replace)' };
  // An unattended restore (the box's --session or --was-up) and --force use the owner's command as
  // configured: no one is there to answer a prompt, and a dropped flag must not perpetuate itself
  // through the record. Someone at a laptop with evidence the supervisor ran without the flag (the
  // OS's word on its own process, never the log) gets it left off.
  const dropFlag = !sessionFlag && !flags['was-up'] && !force && rec?.skip === false;
  const notes = [];
  if (missing.length) notes.push(`${dry ? 'missing here' : 'asked to get'}: ${missing.join(' ')}`);
  if (dropFlag && cmd.includes(SKIP_PERMISSIONS)) { cmd = withoutSkipPermissions(cmd); notes.push(`without ${SKIP_PERMISSIONS}: it ran without it`); }
  const tail = `${notes.length ? ` (${notes.join('; ')})` : ''}${!id && !exact ? ` ${NO_EXACT_RESUME}` : ''}`;
  // another machine live on this repo: never a second supervisor, --force or not
  // (only read here: it is written once the supervisor has really started, below)
  const hc = hostCheck({ start: true, write: false });
  if (hc.refused) return { say: `NOT started (${hc.refused})` };
  if (dry) return { say: `would ${how}${tail}` };
  // its Stop hook: an ask of the owner left in its window with no Inbox question goes back to it.
  // Written before the start is claimed, so a failed write leaves no claim behind
  cmd = withSupervisorPolicy(cmd);
  // Claimed before a window opens: a shell pane says nothing, so anyone who gets past the lock must
  // find this. Taken back on any exit that started nothing, so the next try doesn't wait it out.
  writeJson(SUPERVISOR_UP_FILE, { ...(rec ?? {}), starting: Date.now() });
  const notStarted = (say) => { if (rec) writeJson(SUPERVISOR_UP_FILE, rec); else fs.rmSync(SUPERVISOR_UP_FILE, { force: true }); return { say }; };
  let msg = id ? RECOVER_MESSAGE : supervisorOpeningPrompt();
  if (missing.length) msg = `${msg}\n\nThis machine is missing: ${missing.join(' ')} (worktree_files). Before unparking or starting any worker, ask the owner for each in the Inbox: an owner-action question with --secrets and the sink file:<path>. Never in chat.`;
  fs.mkdirSync(runDir, { recursive: true });
  const promptFile = path.join(runDir, 'supervisor-prompt.txt');
  fs.writeFileSync(promptFile, `${msg}\n`);
  const didHow = id ? `resumed session ${id}` : 'started fresh';
  const machine = machineEpoch();
  // A supervisor that ran in a plain terminal comes back in one, when there's one to take; otherwise
  // in tmux, as any unattended restore (a box, --machine) must.
  const inPlace = here || (rec?.kind === 'foreground' && !sessionFlag && process.stdin.isTTY && process.stdout.isTTY && !process.env.TMUX);
  // a resume's message is a short constant, passed as it is; a fresh start's prompt by its file
  const line = `export DEVTEAM_ROLE=supervisor; ${sessionMarkerPrefix()}${cmd} ${id ? `"$(cat '${promptFile}')"` : shq(promptPointer(promptFile))}`;
  if (inPlace) {
    writeSupervisorUp({ up: true, kind: 'foreground', pid: null, start: null, machine, skip: !dropFlag && cmd.includes(SKIP_PERMISSIONS), starting: Date.now() });
    hostCheck({ start: true });
    return { say: `${didHow} in this terminal${tail}`, run: line };
  }
  if (sh('tmux', ['-V']) === null) return notStarted(`NOT started (no tmux here: run this in a terminal: DEVTEAM_ROLE=supervisor ${cmd})`);
  const session = sessionFlag ?? tmuxSession({ save: true });
  const target = sessionFlag ?? `=${session}`;
  const window = windowFlag ?? 'supervisor';
  let pane;
  if (tmux(['has-session', '-t', target])) pane = sh('tmux', ['new-window', '-dP', '-F', '#{pane_id}', '-t', target, '-n', window, '-c', mainRoot]);
  else if (sessionFlag) return notStarted(`NOT started (no tmux session ${sessionFlag})`);
  else pane = sh('tmux', ['new-session', '-d', '-P', '-F', '#{pane_id}', '-s', session, '-n', window, '-c', mainRoot], { env: tmuxServerEnv() });
  if (!pane) return notStarted('NOT started (tmux would not open its window)');
  recordSupervisorPane(runDir, pane);
  if (!typeNow(pane, line)) return notStarted(`NOT started (its window opened but could not be typed into: pane ${pane})`);
  writeSupervisorUp({ up: true, kind: 'tmux', pane, server: tmuxServerPid(), machine, skip: !dropFlag && cmd.includes(SKIP_PERMISSIONS), starting: Date.now() });
  hostCheck({ start: true });
  return { say: `${didHow}${rec?.kind === 'foreground' ? ' in tmux, where it ran in a terminal before' : ''}${tail}` };
}
export function cmdRecover() {
  const writer = logWriter();
  if (writer !== 'supervisor' || ['worker', 'planner'].includes(process.env.DEVTEAM_ROLE)) die(`recover: not from here: ${writer !== 'supervisor' ? `this session or checkout is ${writer}'s (a ticket or plan branch)` : `this session is a ${process.env.DEVTEAM_ROLE}`}. The owner, the operator or the supervisor runs it, from the main checkout (${mainRoot})`);
  if (flags.machine) return recoverMachine();
  if (!flags['dry-run']) fs.mkdirSync(runDir, { recursive: true });
  // the owner's settings before the lock, unless nothing will start (one is up, or recoverOne's own
  // refusal leaves it stopped; offline too): a start refused for them (an unreadable origin, kit-764)
  // exits, and an exit under the lock would leave it held for the next recover to wait out
  { const rec = supervisorUpRecord(); if (!supervisorRunningNow(rec) && !recoverStarting(rec) && (flags.force || flags['was-up'] || !recoverRefusal(rec))) loadSettings(); }
  // One recover at a time, for longer than the usual lock: on a loaded box tmux alone can take most
  // of 10 s. Still stale in the end, so a crash halfway can't wedge the next one.
  const { say, run } = flags['dry-run'] ? recoverOne() : withLock(path.join(runDir, 'recover'), recoverOne, { staleMs: 90000, waitMs: 100000 });
  out(say);
  if (say.startsWith('NOT started')) process.exitCode = 1;
  if (run) { const r = spawnSync(process.env.SHELL || '/bin/sh', ['-c', run], { cwd: mainRoot, stdio: 'inherit' }); process.exitCode = r.status ?? 1; }
}
// Every repo on this machine, for `recover --machine`: a file each in ~/.devteam, written by each
// dashboard's tick and the supervisor's own commands. The hub won't do: it lists what answers on the
// dashboard ports, and after a dead machine none does, which is exactly when this is needed.
// Named for the hub port, so a fixture has its own. One file each, so nothing there is shared.
export const machineRepoDir = () => path.join(os.homedir(), '.devteam', `repos-${HUB_PORT}`);
// Only a project's own runs record it: never a kit run in the temp folder or a session's scratchpad
// (a probe, a reviewer's check: one once showed on an owner's Overview as a project), nor one a
// worker or planner started, nor any run with DEVTEAM_HUB_RECORD=off (what a session's dashboard
// gives its tick, which runs as the supervisor). An explicit DEVTEAM_HUB_PORT is a fixture with a
// hub of its own, whose projects all live in the temp folder: it records as before, unless told off.
export const hubPortExplicit = () => !!process.env.DEVTEAM_HUB_PORT;
export const hubRecordOff = () => process.env.DEVTEAM_HUB_RECORD === 'off';
export const sessionRun = () => !!process.env.DEVTEAM_TICKET || !!process.env.DEVTEAM_FEATURE || ['worker', 'planner'].includes(process.env.DEVTEAM_ROLE);
// p is dir or inside it, by whole segments (/tmpx is not under /tmp)
export const within = (dir, p) => { const rel = path.relative(dir, p); return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); };
// The temp folders, resolved; never one that holds the home folder (a TMPDIR set that wide would
// make every real project a stray, and recover --machine would skip them all)
export const tempDirs = () => { const home = realPath(os.homedir()); return [...new Set([os.tmpdir(), process.env.TMPDIR].filter(Boolean).map((d) => realPath(path.resolve(d))))].filter((d) => !within(d, home)); };
export const scratchRootWhy = (root) => {
  // resolved as far as it exists: a record can name a root since deleted (/var is /private/var on macOS)
  const r = realPathMade(root);
  if (tempDirs().some((d) => within(d, r))) return 'under the temp folder';
  if (r.split(path.sep).includes('scratchpad')) return 'in a scratchpad';
  return null;
};
export function registerOnMachine() {
  try {
    const root = realPath(mainRoot);
    if (hubRecordOff() || (!hubPortExplicit() && (sessionRun() || scratchRootWhy(root)))) return;
    writeJson(path.join(machineRepoDir(), `${crypto.createHash('sha1').update(root).digest('hex').slice(0, 16)}.json`), { root, at: nowIso() });
  } catch {}
}
// The records, and the strays among them: a root in the temp folder or a scratchpad, recorded by a
// kit from before these were refused (or by hand). Ignored, and named by machine status for removal;
// a fixture's (explicit hub port) are its projects.
export function machineRecords() {
  let files = [];
  try { files = fs.readdirSync(machineRepoDir()).filter((f) => f.endsWith('.json')).sort(); } catch { return { roots: [], strays: [] }; }
  const strays = [];
  const roots = files.flatMap((f) => {
    let r;
    try { r = readJson(path.join(machineRepoDir(), f)).root; } catch { return []; }
    if (typeof r !== 'string' || !path.isAbsolute(r)) return [];
    const why = hubPortExplicit() ? null : scratchRootWhy(r);
    if (why) { strays.push({ file: f, why }); return []; }
    return [r];
  });
  return { roots: [...new Set(roots)].sort(), strays };
}
export const machineRepos = () => machineRecords().roots;
export const kitAt = (root) => path.join(root, 'docs', 'devteam', 'scripts', 'devteam.mjs');
// A sibling is started by the home that links it, unless the two link each other. Only for --force,
// where nothing says it was up: a repo that ran its own supervisor is a home whatever links to it.
export function siblingOf(root, repos) {
  const ownKey = remoteKeyAt(git(['config', '--get', 'remote.origin.url'], root) ?? root, root);
  const linksOf = (r) => repoLinksIn(path.join(r, 'docs', 'devteam', 'project', 'settings.md'));
  const links = (from, key) => linksOf(from).some(([, l]) => remoteKeyAt(l.remote, from) === key);
  return repos.find((h) => {
    if (h === root) return false;
    const homeKey = remoteKeyAt(git(['config', '--get', 'remote.origin.url'], h) ?? h, h);
    return links(h, ownKey) && !links(root, homeKey);
  }) ?? null;
}
// The projects this machine knows: the ones recorded in ~/.devteam, each adopted repo directly under
// an --in folder (a box keeps them in ~/code, and a kit older than the record never wrote one), and
// any the caller names. Resolved, so one checkout counts once however it was reached.
// Whole or not at all: a reader never sees half a file.
export function writeText(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, p);
}
export const isAdopted = (root) => fs.existsSync(kitAt(root)) && fs.existsSync(path.join(root, 'docs', 'devteam', 'project', 'settings.md'));
export function machineProjects(extra = []) {
  const under = listFlag('in').flatMap((d) => { try { return fs.readdirSync(path.resolve(d)).map((n) => path.join(path.resolve(d), n)).filter(isAdopted); } catch { return []; } });
  return [...new Set([...machineRepos(), ...under, ...extra].map(realPath))].sort();
}
// Another project's kit, for what it says about itself: never this kit folding its files by this
// kit's rules, since it can be older. As the operator, so a kit that has the role only reads; with
// nothing of this session's own home, ticket or pane, so nothing it runs is taken for ours.
export function projectKit(root, args, { timeout = 60000 } = {}) {
  const env = { ...process.env, DEVTEAM_ROLE: 'operator' };
  for (const k of ['DEVTEAM_HOME', 'DEVTEAM_RUN', 'DEVTEAM_PROJECT', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'TMUX_PANE']) delete env[k];
  const r = spawnSync(process.execPath, [kitAt(root), ...args], { cwd: root, env, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
  return r.status === 0 ? r.stdout : null;
}
export const projectJson = (root, args) => { try { return JSON.parse(projectKit(root, args) ?? 'null'); } catch { return null; } };
// Whether a repo's kit has recover, from its own help: what it says it does, however a later kit
// is written inside. help reads nothing of the repo's and writes nothing.
export const kitHasRecover = (root) => /^\s+recover \[/m.test(projectKit(root, ['help']) ?? '');
// The supervisor's pane a repo noted, for the machine's commands: marked, on a kit with recover;
// bare, as it is written, on a kit older than recover, which never marks it (nor does legacyRecover,
// which writes only what that kit writes). Its supervisor has no role-less pane to take but by its
// own kit's rules, and supervisorPaneIn still holds it to its root and server.
export function notedPaneOf(root) {
  const run = path.join(root, 'docs', 'devteam', 'run');
  return kitHasRecover(root) ? markedPane(run) : readText(supervisorPaneFile(run))?.trim() || null;
}
// A window name tmux takes as it is: a dot or a colon in a target means a pane or a window.
export const tmuxName = (s) => s.replace(/[^\w.~-]/g, '-');
// The box's list of what was up before a restart (cloud/Dockerfile keeps it from what it saw each
// minute): `<seconds> <root>` a line, when it was first listed. A root alone is an older box's line,
// listed now. Past SUPERVISOR_UP_MAX_MS an entry says nothing any more, as a supervisor-up record.
export function readUpList(file) {
  const at = new Map();
  for (const l of (readText(file) ?? '').split('\n')) {
    const m = /^(?:(\d+) )?(\/.*)$/.exec(l.trim());
    if (!m) continue;
    const root = realPath(m[2]);
    const t = m[1] ? Number(m[1]) * 1000 : null;
    if (!at.has(root) || (t !== null && (at.get(root) === null || t > at.get(root)))) at.set(root, t);
  }
  return new Map([...at].map(([r, t]) => [r, t ?? Date.now()]).filter(([, t]) => Date.now() - t < SUPERVISOR_UP_MAX_MS));
}
// recover --machine [--was-up <list>] [--session s] [--in <dir>…] [--only <repo>]: each repo's own
// recover, one line each. --was-up: the roots listed were up before the restart (the box's list);
// a repo not listed has only its own record to go on. --session: every supervisor in that tmux
// session, in a window sup-<repo> (the box's home). Without --dry-run or --force, what couldn't
// start stays listed for the next try and the rest comes off.
export function recoverMachine() {
  const dry = !!flags['dry-run'];
  const force = !!flags.force;
  if (flags['was-up'] === true) die('recover --machine --was-up <file>: the list of roots that were up before the restart');
  const listFile = flagStr('was-up') ? path.resolve(flagStr('was-up')) : null;
  const session = flagStr('session');
  if (session && !NAME_FOR_TMUX.test(session)) die('--session is a tmux name');
  const only = flagStr('only');
  const listed = listFile ? readUpList(listFile) : new Map();
  const known = machineProjects([...listed.keys()]);
  if (only && !known.some((r) => path.basename(r) === only && isAdopted(r))) die(`no adopted repo "${only}" on this machine`);
  if (!known.length) return out('no repos recorded on this machine yet: run recover in each repo, or start its dashboard so it is recorded');
  const adopted = known.filter(isAdopted);
  const keep = new Set();
  let failed = false;
  for (const root of known) {
    const name = path.basename(root);
    if (only && name !== only) continue;
    if (!adopted.includes(root)) { out(`${name}: skipped (not an adopted repo here any more: ${root})`); continue; }
    const sib = force ? siblingOf(root, adopted) : null;
    if (sib) { out(`${name}: skipped (a sibling of ${path.basename(sib)})`); continue; }
    const wasUp = listed.has(root);
    const where = session ? { session, window: tmuxName(`sup-${name}`) } : null;
    let said;
    if (!kitHasRecover(root)) {
      // A kit older than recover has no record of being up: only the box's list, or --force, says so.
      if (listFile && !wasUp && !force) said = 'left stopped (not running before the restart; --force starts it)';
      else if (!where || !(wasUp || force)) said = 'NOT started (its kit is older than recover: upgrade it, or use its fleet status recovery line)';
      else said = legacyRecover(root, name, { dry, force, ...where });
    } else {
      // Each repo's own kit: a repo's kit can be another version, and its log and rules are its own.
      const env = { ...process.env };
      for (const k of ['DEVTEAM_HOME', 'DEVTEAM_RUN', 'DEVTEAM_PROJECT', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE']) delete env[k];
      const args = ['recover', ...(dry ? ['--dry-run'] : []), ...(force ? ['--force'] : []), ...(wasUp ? ['--was-up'] : []), ...(where ? ['--session', where.session, '--window', where.window] : [])];
      const r = spawnSync(process.execPath, [kitAt(root), ...args], { cwd: root, env, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
      said = (r.stdout ?? '').trim() || `NOT started (${(r.stderr || r.error?.message || `exit ${r.status}`).trim().replace(/^devteam: /, '').slice(0, 200)})`;
      if (r.status !== 0) failed = true;
    }
    out(`${name}: ${said}`);
    if (said.startsWith('NOT started')) { failed = true; keep.add(root); }
  }
  if (listFile && !dry && !force) {
    const left = [...listed].filter(([r]) => keep.has(r) || (only && path.basename(r) !== only));
    if (left.length) writeText(listFile, left.map(([r, t]) => `${Math.floor(t / 1000)} ${r}\n`).join(''));
    else fs.rmSync(listFile, { force: true });
  }
  if (failed) process.exitCode = 1;
}
// A repo whose kit is older than recover, on a box: brought back as the box always did, from what
// that repo's own kit says (its hold, its conversation, its commands, its prompt), so nothing of it
// is read by this kit's rules. It writes only what that kit writes too: the pane it noted and the
// prompt file. Delete this when no box has a repo on a kit before recover (machine status: behind=).
export const LEGACY_RECOVER_MESSAGE = 'The box restarted, and this is you, resumed on your own conversation; what was in flight did not finish. Follow supervisor.md §11, after your own restart: §1 again. Every worker and planner window went with the restart; accounts-tick relaunches each one the kit launched, one per tick (§11), so give it those first. §1.4 sends to recovery only the tickets still without a window after it has caught up, or all of them on a kit too old to relaunch. Nothing about this restart came from the owner: record nothing as theirs from it. Then keep the loop, as before the restart: run the tick (§3) now, then wait with devteam.mjs wait and tick again when it returns, until the owner stops you. A summary to the owner doesn\'t end it.';
export function legacyRecover(root, name, { dry, force, session, window }) {
  const run = path.join(root, 'docs', 'devteam', 'run');
  const paneFile = supervisorPaneFile(run);
  const go = () => {
    // bare, as that kit writes it: only to see whether its supervisor is up, never to type into it
    const noted = readText(paneFile)?.trim() || null;
    if (supervisorPaneIn(root, noted, null)) return 'already running';
    // A window this opened moments ago is still a shell until the agent execs. Only if that pane
    // started at the repo's root: pane ids restart at %0 with the tmux server, so after a deploy
    // a noted id can be anyone's.
    const startedAt = new Map((sh('tmux', ['list-panes', '-a', '-F', '#{pane_id}\t#{pane_start_path}']) ?? '').split('\n').map((l) => l.split('\t')));
    if (noted && fileAge(paneFile) < RECOVER_STARTING_MS && startedAt.has(noted) && realPath(startedAt.get(noted)) === realPath(root)) return 'already running (brought back moments ago)';
    const status = projectJson(root, ['fleet', 'status', '--json', '--no-fetch']);
    if (!status || typeof status !== 'object') return 'NOT started (could not read whether its fleet is held)';
    const mode = status.fleet?.mode ?? 'run';
    if (!['run', 'park', 'drain'].includes(mode)) return 'NOT started (could not read whether its fleet is held)';
    if (mode !== 'run' && !force) return `left stopped (its fleet is held: ${mode})`;
    const said = (projectKit(root, ['supervisor-session']) ?? '').trim();
    const id = /^[\w-]+$/.test(said) ? said : null;
    const files = projectJson(root, ['settings', '--get', 'worktree_files']);
    const missing = (Array.isArray(files) ? files : []).filter((f) => typeof f === 'string' && !fs.existsSync(path.join(root, f)));
    if (dry) return `would ${id ? `resume session ${id}` : 'start fresh'}${missing.length ? ` (missing here: ${missing.join(' ')})` : ''}`;
    let cmd;
    let msg;
    if (id) {
      cmd = (projectKit(root, ['settings', '--get', 'resume_command']) ?? '').trim();
      if (!` ${cmd} `.includes(' --continue ')) return 'NOT started (its resume_command has no --continue to replace)';
      cmd = ` ${cmd} `.replace(' --continue ', ` --resume ${id} `).trim();
      msg = LEGACY_RECOVER_MESSAGE;
    } else {
      cmd = (projectKit(root, ['settings', '--get', 'agent_command']) ?? '').trim();
      msg = (projectKit(root, ['prompt', 'supervisor']) ?? '').trim();
      if (!cmd || !msg) return 'NOT started (its kit gave no agent_command or supervisor prompt)';
    }
    if (missing.length) msg = `${msg}\n\nThis machine is missing: ${missing.join(' ')} (worktree_files). Before unparking or starting any worker, ask the owner for each in the Inbox: an owner-action question with --secrets and the sink file:<path>. Never in chat.`;
    if (!tmux(['has-session', '-t', `=${session}`])) return `NOT started (no tmux session ${session})`;
    const promptFile = path.join(run, 'supervisor-prompt.txt');
    fs.writeFileSync(promptFile, `${msg}\n`);
    const pane = sh('tmux', ['new-window', '-dP', '-F', '#{pane_id}', '-t', `=${session}:`, '-n', window, '-c', root]);
    if (!pane) return 'NOT started (tmux would not open its window)';
    // bare, as that kit writes it: a supervisor-pane-role there is a file its kit doesn't know, which
    // its fleet status says holds a move
    fs.writeFileSync(paneFile, pane);
    // by pane id: a dot in a window name reads as a pane to tmux; under that pane's typing lock in the
    // repo's own run folder (kit-618). A pane just opened has no floor of the owner's; a busy lock is
    // a window that could not be typed into
    const typed = typeLock.run(pane, (outer) => !(outer && ownerLineOpen(pane)) && tmux(['send-keys', '-t', pane, '-l', `export DEVTEAM_ROLE=supervisor; ${sessionMarkerPrefix(session)}${cmd} ${id ? `"$(cat '${promptFile}')"` : shq(promptPointer(promptFile))}`]) && tmux(['send-keys', '-t', pane, 'Enter']), { run });
    if (typed.busy || !typed.value) return `NOT started (its window opened but could not be typed into: pane ${pane})`;
    return `${id ? `resumed session ${id}` : 'started fresh'}${missing.length ? ` (asked to get: ${missing.join(' ')})` : ''}`;
  };
  if (dry) return go();
  fs.mkdirSync(run, { recursive: true });
  return withLock(path.join(run, 'recover'), go, { staleMs: 90000, waitMs: 100000 });
}

// ===== machine: every project on this machine, for whoever looks after it =====
//
// What a box's operator works from (process/operator.md), and the owner can run on a laptop: a digest
// of the machine and each project, a message into a project's supervisor, a line on the hub, and
// what a pane is at. Each runs from any directory, with this kit or a newer one than the projects':
// what a project says about itself comes from its own kit, and only plain files of its are read here.

// What a pane is at, from what is on it. Nothing is typed here. The agent's input box is the last box
// drawn at the bottom (between two rules); text in it is someone's unless it's dim, the harness's own
// suggestion, never the owner's words. A screen that shows no box is unknown.
// Anchored at the line's start (or a y/n at its end): with no input box drawn, a line that only
// mentions these words in the agent's prose isn't the harness asking.
export const PANE_DIALOG = /^(do you (trust|want to)|quick safety check|❯ *(yes|no)([, ]|$)|press enter to continue|yes, i accept|no, exit|select login method|paste code|.*text style)|(\[y\/n\]|\(y\/n\)) *$/i;
// A limit banner, whole and at the start of its line: the agent's prose can name a limit anywhere.
export const PANE_LIMIT_LINE = new RegExp(`^(?:[⎿■✖!]\\s*)?(?:claude\\s+)?${LIMIT_REACHED}|${LIMIT_HIT}`, 'i');
export const plainText = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').replace(/ /g, ' ');
export function paneState(pane, cmd = (sh('tmux', ['list-panes', '-a', '-F', '#{pane_id}\t#{pane_current_command}']) ?? '').split('\n').map((l) => l.split('\t')).find(([id]) => id === pane)?.[1]) {
  if (cmd === undefined) return 'gone';
  if (SHELLS.has(cmd.replace(/^-/, ''))) return 'shell';
  if (!AGENT_PANE_CMD.test(cmd)) return 'other';
  const raw = (sh('tmux', ['capture-pane', '-e', '-p', '-t', pane]) ?? '').split('\n').filter((l) => l.trim()).slice(-20);
  // what the agent itself drew, as the kit reads a pane: a line of code, a diff or a quote never is
  const ui = raw.map((l) => plainText(l).trimStart()).filter((l) => !PANE_CODE.test(l));
  if (ui.some((l) => /^❯ *\d+\. /.test(l))) return 'dialog';
  const rules = raw.map((l, i) => (/^ *─+ *$/.test(plainText(l)) ? i : -1)).filter((i) => i !== -1);
  const [a, b] = rules.slice(-2);
  const input = rules.length >= 2 ? raw.slice(a + 1, b).find((l) => l.includes('❯')) ?? null : null;
  // With an input box up, the words of a dialog above it are only something the agent said.
  if (!input && ui.some((l) => PANE_DIALOG.test(l))) return 'dialog';
  const busy = ui.some((l) => PANE_BUSY.test(l));
  if (!busy && ui.some((l) => LIMIT_BANNER.test(l) || PANE_LIMIT_LINE.test(l))) return 'limit';
  if (input === null) return 'unknown';
  // up to any dim text: what was really typed, if anything
  const text = input.slice(input.lastIndexOf('❯') + 1);
  const dim = text.indexOf('\x1b[2m');
  if (plainText(dim === -1 ? text : text.slice(0, dim)).trim()) return 'typing';
  return busy ? 'busy' : 'ready';
}
// The owner's floor (kit-618, terminal@1 §11): the keys route records `<ms> done|open` on the
// supervisor's pane as @devteam-owner-floor, and while it holds no kit writer types there or presses
// Enter. Whether it still holds, read by a writer under the pane's typing lock (or, release: false,
// by a reader that only looks). With no floor, false, and nothing more is read. A value that doesn't
// parse is open, from time 0. A pane at a shell or gone took the owner's line with its agent: both
// marks go, and false, before the settle. Within 3 s of its stamp (or up to 3 s ahead of it) it
// holds. After: on a prompt read readable, ready or busy release it, and so do a dialog or a limit
// a done floor; on one never read, a done floor is released and an open one holds. A release unsets
// it, or the kit's own half-typed line would later read typing and hold its next write.
export function ownerLineOpen(pane, { release = true } = {}) {
  const SETTLE_MS = 3000;
  // the pane's command in the same read: a pane this read found is never gone by a second call failing
  const got = sh('tmux', ['display', '-p', '-t', pane, '#{pane_id}\tC#{pane_current_command}\tR#{@devteam-prompt-readable}\tF#{@devteam-owner-floor}']);
  const c = got?.indexOf('\tC') ?? -1;
  const r = c === -1 ? -1 : got.indexOf('\tR', c + 2);
  const f = r === -1 ? -1 : got.indexOf('\tF', r + 2);
  if (f === -1) return false;
  const floor = got.slice(f + 2);
  if (!floor) return false;
  const id = got.slice(0, c);
  const m = /^(\d{13}) (done|open)$/.exec(floor);
  const at = m ? Number(m[1]) : 0;
  const kind = m ? m[2] : 'open';
  const s = paneState(id, got.slice(c + 2, r));
  if (s === 'shell' || s === 'gone') {
    sh('tmux', ['set-option', '-p', '-u', '-t', id, '@devteam-owner-floor', ';', 'set-option', '-p', '-u', '-t', id, '@devteam-prompt-readable']);
    return false;
  }
  const readable = promptReadable(id, s, got.slice(r + 2, f));
  const age = Date.now() - at;
  if (age < SETTLE_MS && age >= -SETTLE_MS) return true;
  const released = readable ? s === 'ready' || s === 'busy' || (kind === 'done' && (s === 'dialog' || s === 'limit')) : kind === 'done';
  if (!released) return true;
  if (release) sh('tmux', ['set-option', '-p', '-u', '-t', id, '@devteam-owner-floor']);
  return false;
}
// Whether the pane's prompt has ever been read as one (@devteam-prompt-readable, the first time
// at ready, busy or typing, recorded then): until it has, a floor's release can't trust a reading.
export function promptReadable(pane, s, mark = sh('tmux', ['display', '-p', '-t', pane, '#{@devteam-prompt-readable}'])) {
  if (mark) return true;
  if (!['ready', 'busy', 'typing'].includes(s)) return false;
  sh('tmux', ['set-option', '-p', '-t', pane, '@devteam-prompt-readable', String(Date.now())]);
  return true;
}
export const machineUsage = 'usage: machine status [--questions | --knowledge] [--in <dir>…] [--notes <file>] | machine tell <repo> <message> | machine alert <text> | machine alert --clear | machine limit-state <pane> | machine pane-state <pane>';
// tell and alert speak on the machine: the operator's, or the owner's at a terminal; never a session
// in a fleet, which would be speaking as someone else.
export function machineSpeaker(what) {
  const role = process.env.DEVTEAM_ROLE;
  if (['supervisor', 'worker', 'planner'].includes(role) || logWriter() !== 'supervisor') die(`machine ${what}: the operator's or the owner's, not from a ${role || logWriter()} session`);
}
export function cmdMachine() {
  const sub = positional[0];
  const words = rest ?? positional.slice(1);
  if (sub === 'pane-state') {
    if (!positional[1]) die(machineUsage, 2);
    return out(paneState(positional[1]));
  }
  if (sub === 'limit-state') {
    if (!positional[1]) die(machineUsage, 2);
    return out(limitState(positional[1]));
  }
  if (sub === 'alert') return machineAlert(words);
  if (sub === 'tell') return machineTell(words);
  if (sub === 'status') return flags.questions ? machineQuestions() : flags.knowledge ? machineKnowledge() : machineStatus();
  die(machineUsage, 2);
}
// The operator's word to the owner, on the hub and their devices: one line, in the file every
// kit's hello reads (boxAlert), whatever its version.
export function machineAlert(words) {
  machineSpeaker('alert');
  const f = path.join(os.homedir(), '.box', 'alert');
  if (flags.clear || (words.length === 1 && words[0] === '--clear')) { fs.rmSync(f, { force: true }); return out('alert cleared'); }
  const text = capBytes(words.join(' ').replace(/[\r\n]/g, ' ').replace(/^ +| +$/g, ''), 200);
  if (!text) die(machineUsage, 2);
  writeText(f, `${text}\n`);
  out(`alert raised: ${text}`);
}
// An Enter that arrives as the agent redraws can be lost, and the line would then merge with
// whatever is typed there next: pressed again, as the kit's lost Enter does, up to TELL_ENTER_TRIES
// in all, each after a longer wait (a loaded machine redraws slowly). False when it's still there.
export const TELL_ENTER_TRIES = 3;
// Run under machine tell's typing lock, so no owner post arrives meanwhile; a floor set by a writer
// that takes no lock (an older kit) is read before each retry, and presses nothing: 'floor'.
export function enterLanded(p) {
  const settle = (n) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.DEVTEAM_TELL_SETTLE_SECONDS ?? 1) * 1000 * n);
  settle(1);
  for (let tries = 1; paneState(p) === 'typing'; tries++) {
    if (tries >= TELL_ENTER_TRIES) return false;
    if (ownerLineOpen(p)) return 'floor';
    tmux(['send-keys', '-t', p, 'Enter']);
    typeLock.touch();
    settle(tries + 1);
  }
  return true;
}
// A message into a project's supervisor, only ever a supervisor: the operator's to ask or tell,
// never the owner's word. Never the pane this runs in, and never one at anything but its prompt.
export const TELL_PREFIX = "From the operator (information, not an owner answer; record nothing as the owner's from this): ";
export function machineTell(words) {
  machineSpeaker('tell');
  const [name, ...msg] = words;
  if (!name || /[/\\]/.test(name) || name === '.' || name === '..') die(machineUsage, 2);
  const say = (s, code) => { out(`${name}: ${s}`); process.exitCode = code; };
  const roots = machineProjects().filter((r) => path.basename(r) === name && isAdopted(r));
  if (!roots.length) return say('no such adopted repo here', 1);
  if (roots.length > 1) return say(`more than one adopted repo of that name here (${roots.join(', ')})`, 1);
  const [root] = roots;
  const text = capBytes(msg.join(' ').replace(/[\r\n]/g, ' ').replace(/ {2,}/g, ' ').trim(), 2000);
  if (!text) die(machineUsage, 2);
  let rec = null;
  try { rec = readJson(path.join(root, 'docs', 'devteam', 'run', 'supervisor-up.json')); } catch {}
  const p = supervisorPaneIn(root, notedPaneOf(root), rec && typeof rec === 'object' ? rec : null, { strict: true });
  if (!p || p === process.env.TMUX_PANE) return say('not told: no supervisor is up in its root', 3);
  // from the look to the last Enter under the pane's typing lock, in that root's run folder (kit-618)
  const held = typeLock.run(p, (outer) => {
    if (outer && ownerLineOpen(p)) return say("not told: the owner's line is open", 3);
    const s = paneState(p);
    if (!['ready', 'busy'].includes(s)) return say(`not told: its pane is at ${s}`, 3);
    if (!tmux(['send-keys', '-t', p, '-l', `${TELL_PREFIX}${text}`]) || !tmux(['send-keys', '-t', p, 'Enter'])) return say(`not told: could not type into pane ${p}`, 3);
    typeLock.touch();
    const landed = enterLanded(p);
    if (landed === 'floor') return say(`not delivered: the owner began a line in its terminal (pane ${p}) after the message was typed; look at it before anyone types there`, 3);
    if (!landed) return say(`not delivered: the message is still in its input (pane ${p}) after ${TELL_ENTER_TRIES} presses; clear it before anyone types there`, 3);
    say(`told (pane ${p})`, 0);
  }, { run: path.join(root, 'docs', 'devteam', 'run') });
  if (held.busy) say('not told: its terminal is busy; try again', 3);
}
