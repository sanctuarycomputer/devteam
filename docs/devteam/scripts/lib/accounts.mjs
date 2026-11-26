/* imports start */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HUB_PORT } from './orient.mjs';
import { PANE_BUSY } from './panes.mjs';
import { PANE_CODE } from './graph.mjs';
import { PANE_SHELL } from './panes.mjs';
import { PANE_TRUST } from './graph.mjs';
import { PANE_WAITS } from './graph.mjs';
import { SHELLS } from './sessions.mjs';
import { TMUX_TIMEOUT_MS } from './base.mjs';
import { appendLog } from './log-sync.mjs';
import { byTime } from './log-sync.mjs';
import { draining } from './fleet.mjs';
import { execFileSync } from 'node:child_process';
import { fleetMode } from './holds.mjs';
import { handledMessages } from './log-sync.mjs';
import { isObj } from './artifact-notes.mjs';
import { lastPhaseOf } from './fleet.mjs';
import { loadSettings } from './settings.mjs';
import { logObjects } from './log-sync.mjs';
import { mainRoot } from './state.mjs';
import { out } from './base.mjs';
import { ownerLineOpen } from './recover.mjs';
import { planners } from './panes.mjs';
import { readLog } from './log-sync.mjs';
import { readText } from './base.mjs';
import { realOrSelf } from './spend.mjs';
import { repo } from './repos.mjs';
import { repoOfTicket } from './repos.mjs';
import { repoOfTicketLink } from './repos.mjs';
import { repoReadable } from './repos.mjs';
import { resolvePane } from './sessions.mjs';
import { runDir } from './state.mjs';
import { runPath } from './settings.mjs';
import { sessionMarkerPrefix } from './sessions.mjs';
import { sessionOf } from './fleet.mjs';
import { setupMarker } from './check-ticket.mjs';
import { setupSlots } from './check-ticket.mjs';
import { sh } from './base.mjs';
import { spawnSync } from 'node:child_process';
import { supervisorTarget } from './sessions.mjs';
import { threadViews } from './threads.mjs';
import { tickets } from './graph.mjs';
import { tmux } from './sessions.mjs';
import { tmuxSession } from './base.mjs';
import { tmuxTarget } from './base.mjs';
import { typeLock } from './log.mjs';
import { typeNow } from './sessions.mjs';
import { withLock } from './log.mjs';
import { withSupervisorPolicy } from './responder.mjs';
/* imports end */
// ===== account rotation: cswap (claude-swap), when it's installed =====
// A machine has one active Claude account, so one dashboard a minute drives the switch: whichever
// takes the machine-wide claim first (claimRotation). The hub plays no part, so a dashboard on an
// older kit, or a dead one, can't stop it. Each dashboard then looks after its own instance's panes.
// Every dashboard runs this as the supervisor, never as the owner (a cswap found on a path an agent
// can write gets no owner identity), and only the supervisor acts on a pane, as everywhere else
// (supervisor.md §11).
export const ACCOUNTS_FILE = runPath('accounts.json');
export const ACCOUNTS_RESUMED = runPath('accounts-resumed.json');
export const ACCOUNTS_FRESH_MS = 10 * 60000;
// A session that keeps stopping is left alone and reported (restart_gave_up): at most one restart
// per 10 minutes and 3 in any 6 hours. Older attempts expire, so it recovers without a person.
export const RESTART_EVERY_MS = 10 * 60000;
export const RESTART_SPAN_MS = 6 * 3600000;
export const RESTART_MAX = 3;
// Under the dashboard's 120 s SIGKILL of a tick, whatever cswap took before it: each relaunch or
// restart has up to 100 s, and another starts only with at least 30 s (100 s, after the first, for a
// relaunch whose repo has a worktree_setup) of the tick's 110 left.
export const RESTART_CHILD_MS = 100000;
export const RESTART_TICK_MS = 110000;
export const RESTART_MIN_MS = 30000;
// How long a dashboard read waits on a dashboard-data run before it has the last good data instead
// (0 is no wait at all; anything that isn't a number is the default).
export const DATA_WAIT_MS = ((n) => (process.env.DEVTEAM_DATA_WAIT_MS?.trim() && Number.isFinite(n) && n >= 0 ? n : 20000))(Number(process.env.DEVTEAM_DATA_WAIT_MS));
// How long a dashboard serves a finished dashboard-data build again (kit-595): 20 s after it ended,
// while it is still current (cmdDashboard's dataEpoch). DEVTEAM_DATA_REUSE_MS is for tests only, not a
// setting: test/presence-changed.test.mjs sets 3000 to keep checking kit-633's 3 s start gap. Anything
// that isn't a number of at least 0 is the default.
export const DATA_REUSE_MS = ((n) => (process.env.DEVTEAM_DATA_REUSE_MS?.trim() && Number.isFinite(n) && n >= 0 ? n : 20000))(Number(process.env.DEVTEAM_DATA_REUSE_MS));
// makeSession --if-gone found the window there after all (it never types into one): not a failure.
export const IF_GONE_LEFT = 3;
// The last moment a tick may start a cswap switch (its 45 s timeout, inside RESTART_TICK_MS).
export const SWITCH_LATEST_MS = RESTART_TICK_MS - 45000;
// Claude Code's limit menu and banner, anchored: an agent's prose can quote either, and cswap only
// rotates Claude accounts, so another harness's limit stop is not ours to restart. No key ever goes
// to the menu: its third item spends money.
export const LIMIT_MENU = /^(?:❯\s*)?\d+\.\s*Stop and wait for limit to reset$/;
// Read untrimmed: bare only at column 0, or with its ⎿ at any indent. An indented continuation of the
// agent's own prose can start with the same words.
export const LIMIT_BANNER = /^(?:\s*⎿\s*)?You['’]ve hit your (?:\w+ )*limit · resets\b/;
export function findCswap() {
  const v = process.env.DEVTEAM_CSWAP;
  if (v === 'off') return null;
  if (v?.includes('/')) return fs.existsSync(v) ? v : null;
  // a fixture dashboard on its own hub port never finds the machine's real accounts
  if (!v && HUB_PORT !== 4320) return null;
  for (const d of [...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean), path.join(os.homedir(), '.local', 'bin')]) {
    const f = path.join(d, v || 'cswap');
    try { fs.accessSync(f, fs.constants.X_OK); if (fs.statSync(f).isFile()) return f; } catch {}
  }
  return null;
}
export const runCswap = (bin, args) => spawnSync(bin, args, { cwd: os.homedir(), encoding: 'utf8', timeout: 45000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
// One pass of cswap's own engine. It exits 2 (nothing to do) and 3 (no viable account) as a matter
// of course, so what it said is read whatever the exit code.
export function rotateAccounts(bin) {
  const r = runCswap(bin, ['auto', '--once', '--json']);
  const events = (r.stdout ?? '').split('\n').flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }).filter((e) => typeof e?.event === 'string');
  const said = events.find((e) => e.event === 'error')?.message ?? r.stderr ?? '';
  return { ok: [0, 2, 3].includes(r.status), failure: `cswap auto: ${r.error?.message ?? `exit ${r.status}: ${String(said).trim().slice(0, 200)}`}`, switched: events.filter((e) => e.event === 'switch'), exhausted: events.some((e) => e.event === 'all-exhausted') };
}
export const accountsEveryMs = () => { const n = Number(process.env.DEVTEAM_ACCOUNTS_MS ?? 60000); return n > 0 ? n : 60000; };
// In the home directory, not the tmp dir: dashboards started from different shells can have different
// TMPDIRs, and cswap's accounts are the user's. Named for the hub port, so a fixture has its own.
export const rotateClaimFile = () => path.join(os.homedir(), '.devteam', `accounts-rotate-${HUB_PORT}.json`);
// Whose claim it is, if it's still good. It goes stale just under a tick so the dashboard that took it
// can take it again on its next one, and a crash holds it for less than a minute. Dated in the
// future (the clock moved back) or unreadable, it holds nothing.
export function rotateClaim(file) {
  try {
    const c = JSON.parse(readText(file));
    const age = Date.now() - c.at;
    return age >= 0 && age < accountsEveryMs() * 0.9 ? c : null;
  } catch { return null; }
}
export const writeRotateClaim = (file) => { fs.rmSync(file, { recursive: true, force: true }); fs.writeFileSync(file, JSON.stringify({ at: Date.now(), by: process.pid })); };
// One dashboard per interval runs cswap's engine. withLock makes the look and the write one step,
// and its own lock goes stale too. Failing to take it means no rotation this tick, said out loud.
export function claimRotation() {
  try {
    const file = rotateClaimFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    return withLock(file, () => {
      if (rotateClaim(file)) return false;
      writeRotateClaim(file);
      return true;
    });
  } catch (e) { out(`cswap rotation claim: ${e.message}`); return false; }
}
// Before a switch, which can start a long way into the claim: still ours, or another dashboard has
// taken over and this one leaves the accounts alone. Keeping it covers the switch's own 45 s.
export function renewRotation() {
  try {
    const file = rotateClaimFile();
    return withLock(file, () => {
      let c = null;
      try { c = JSON.parse(readText(file)); } catch {}
      if (c?.by !== process.pid) return false;
      writeRotateClaim(file);
      return true;
    });
  } catch { return false; }
}
export function cswapAccounts(bin) {
  const r = runCswap(bin, ['list', '--json']);
  try { const a = JSON.parse(r.stdout).accounts; return Array.isArray(a) ? a : null; } catch { return null; }
}
export const mainWindows = (a) => [a?.usage?.fiveHour, a?.usage?.sevenDay].filter(Boolean);
// Room to work: its usage reads ok, both windows it has are measured and under 100, and no per-model
// window is full (a session stopped on one would only stop again).
export function accountHasRoom(a) {
  const w = mainWindows(a);
  const scoped = Array.isArray(a?.usage?.scoped) ? a.usage.scoped : [];
  return a?.usageStatus === 'ok' && w.length > 0 && w.every((x) => typeof x.pct === 'number' && x.pct < 100) && !scoped.some((x) => x?.pct >= 100);
}
// Known to be full. An account whose usage can't be read right now (a 429, a timeout, an API key) isn't.
export const accountAtLimit = (a) => a?.usageStatus === 'ok' && mainWindows(a).some((x) => x.pct >= 100);
// How long a full window can last, for a reading with no reset time on it.
export const WINDOW_MS = { fiveHour: 5 * 3600000, sevenDay: 7 * 86400000 };
// An expired token hides an account's usage, but cswap keeps the last reading. Full counts while that
// window can't have reset: by its reset time, or failing that by the reading's age. With neither it
// isn't known, and neither is an account whose usage just can't be read.
export function lastReadingFull(a) {
  if (a?.usageStatus !== 'token_expired') return false;
  const age = typeof a.lastGoodAgeSeconds === 'number' ? a.lastGoodAgeSeconds * 1000 : Date.now() - Date.parse(a.lastGoodFetchedAt);
  return Object.keys(WINDOW_MS).some((k) => {
    const w = a.lastGoodUsage?.[k];
    if (!(w?.pct >= 100)) return false;
    const resets = Date.parse(w.resetsAt);
    return Number.isFinite(resets) ? resets > Date.now() : age >= 0 && age < WINDOW_MS[k];
  });
}
export const accountKnownFull = (a) => accountAtLimit(a) || lastReadingFull(a);
// Each account's numbers, for the machine's hub (box-health@1): built from named fields, never by
// copying a row, so no email, token or new field of cswap's leaves with it. Text is kept only in a known
// form: the alias as the label (else "Account n"; an address, in any width of @, or one over 40
// characters is not kept) and a one-word status; a time is written again in UTC (and left out if that
// leaves the years 0 to 9999). A percent is of the window used. What can't be read is left out, never
// zero, but for one: on status ok an absent five-hour window is unused. A usage that is a list is no
// usage. A disabled account is listed, marked; a row with no slot number isn't.
export function capacityList(rows) {
  const pct = (w) => (Number.isFinite(w?.pct) ? Math.min(100, Math.max(0, w.pct)) : undefined);
  const at = (t) => (typeof t === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+(Z|[+-]\d\d:\d\d)$/.test(t) && Number.isFinite(Date.parse(t)) && /^\d{4}-/.test(new Date(t).toISOString()) ? new Date(t).toISOString() : undefined);
  const label = (a) => {
    const alias = typeof a.alias === 'string' ? a.alias.trim() : '';
    return alias && alias.length <= 40 && !/[@\p{C}]/u.test(alias.normalize('NFKC')) ? alias : `Account ${a.number}`;
  };
  return rows.filter((a) => Number.isSafeInteger(a.number) && a.number > 0).map((a) => {
    const u = a.usage;
    const unused = a.usageStatus === 'ok' && u && typeof u === 'object' && !Array.isArray(u) && (u.fiveHour ?? null) === null;
    const tier = Number(/_([1-9]\d{0,2})x$/.exec(typeof a.plan?.tier === 'string' ? a.plan.tier : '')?.[1]);
    return {
      n: a.number, label: label(a), active: a.active === true, disabled: !!a.disabled,
      status: typeof a.usageStatus === 'string' && /^[a-z][a-z_]{0,29}$/.test(a.usageStatus) ? a.usageStatus : undefined,
      week_pct: pct(u?.sevenDay), week_resets_at: at(u?.sevenDay?.resetsAt),
      five_pct: unused ? 0 : pct(u?.fiveHour), five_resets_at: at(u?.fiveHour?.resetsAt),
      models_full: Array.isArray(u?.scoped) ? u.scoped.filter((x) => Number.isFinite(x?.pct) && x.pct >= 100).map((x) => ({ resets_at: at(x.resetsAt) })) : [],
      tier: tier || undefined,
    };
  });
}
// The fleet's Claude capacity across every cswap account, for the operator and the supervisors: how many
// have room, the active one's use, and whether the room left lasts until a full account resets. cswap
// projects each window (projectedExhaustionAt, willLastToReset); a gap is room that runs out first. An
// account whose usage can't be read is neither room nor full: it's counted as unknown, never as none.
export function capacityOf(rows) {
  const usable = rows.filter((a) => !a.disabled);
  const room = usable.filter(accountHasRoom);
  const full = usable.filter(accountKnownFull);
  const unknown = usable.length - room.length - full.length;
  const week = (a) => a?.usage?.sevenDay ?? a?.lastGoodUsage?.sevenDay ?? null;
  const pct = (w) => (typeof w?.pct === 'number' ? Math.round(w.pct) : null);
  const active = rows.find((a) => a.active);
  const resets = full.map((a) => [a?.usage?.fiveHour, week(a)].filter((w) => w?.pct >= 100 && w.resetsAt).map((w) => w.resetsAt).sort().pop()).filter(Boolean).sort();
  const lasts = room.some((a) => mainWindows(a).every((w) => w.willLastToReset !== false));
  const outs = room.map((a) => mainWindows(a).map((w) => w.projectedExhaustionAt).filter(Boolean).sort()[0]).filter(Boolean).sort();
  const runsOut = lasts || outs.length < room.length ? null : outs.pop() ?? null;
  const nextReset = resets[0] ?? null;
  return {
    accounts: usable.length, room: room.length, unknown,
    active_week_pct: pct(week(active)), active_5h_pct: pct(active?.usage?.fiveHour),
    runs_out_at: runsOut, next_reset_at: nextReset,
    gap: !!(room.length && runsOut && nextReset && Date.parse(runsOut) < Date.parse(nextReset)),
    list: capacityList(rows),
  };
}
// One switch, and what it said, whatever the exit code: a switch that stays put is not a failure.
export function switchAccount(bin, args) {
  const r = runCswap(bin, ['switch', ...args, '--json']);
  let o = null;
  try { o = JSON.parse(r.stdout); } catch {}
  const failed = o?.error || (r.status !== 0 && !o);
  return { failure: failed ? `cswap switch: ${o?.error?.message ?? r.error?.message ?? `exit ${r.status}: ${String(r.stderr ?? '').trim().slice(0, 200)}`}` : null, moved: !failed && o?.switched !== false, from: o?.from, to: o?.to, reason: o?.reason };
}
// Where cswap keeps its files, by its own rule (paths.py): XDG on Linux, its value ignored unless absolute.
export function cswapBackupRoot() {
  if (process.platform !== 'linux') return path.join(os.homedir(), '.claude-swap-backup');
  const xdg = (process.env.XDG_DATA_HOME ?? '').replace(/^~(?=\/|$)/, os.homedir());
  return path.isAbsolute(xdg) ? path.join(xdg, 'claude-swap') : path.join(os.homedir(), '.local', 'share', 'claude-swap');
}
// The slots auto has quarantined, which it never activates: its state file is the only place that says
// (`list --json` doesn't). A map keyed by slot number; a file that can't be read means none.
export function cswapQuarantined() {
  try {
    const q = JSON.parse(readText(path.join(cswapBackupRoot(), 'autoswitch_state.json')))?.quarantine;
    return new Set(q && typeof q === 'object' && !Array.isArray(q) ? Object.keys(q) : []);
  } catch { return new Set(); }
}
// cswap auto is slow to leave a full account whose token expired while idle: it holds for 30 minutes
// (idleHoldSince is persisted, so --once counts them too), then waits out unhealthy_ticks before it
// fails over. So switch from here, when auto has stayed on any known-full account and another enabled
// one has room, which cuts a stall of over 30 minutes to about a minute; only under a claim that's
// still ours, inside the tick. Always by number: `best` declines on an expired token (it needs the
// active account's usage), and neither it nor `switch <n>` checks quarantine, so the pick is made here.
export function leaveFullAccount(bin, active, rows, began) {
  const quarantined = cswapQuarantined();
  const free = (a) => Math.min(...mainWindows(a).map((x) => 100 - x.pct));
  const [target] = rows.filter((a) => a !== active && !a.disabled && Number.isInteger(a.number) && !quarantined.has(String(a.number)) && accountHasRoom(a)).sort((a, b) => free(b) - free(a));
  return target && Date.now() - began < SWITCH_LATEST_MS && renewRotation() ? switchAccount(bin, [String(target.number)]) : null;
}
// What a pane's bottom lines say about a limit stop. A banner counts only as the last thing the
// agent said: nothing of its own after it, just the input box and status lines.
export const INPUT_LINE = /^[│┃|]?\s*[>❯](?:\s+(.*?))?\s*[│┃|]?$/;
export function limitStop(rawLines) {
  const lines = rawLines.map((l) => l.trim());
  const raw = rawLines.filter((l) => !PANE_CODE.test(l.trim()));
  const own = raw.map((l) => l.trim());
  const at = own.findIndex((l) => LIMIT_MENU.test(l));
  const menu = at !== -1 && own.slice(at + 1).some((l) => /^Enter to confirm/.test(l));
  const banner = raw.findLastIndex((l) => LIMIT_BANNER.test(l));
  const after = banner === -1 ? [] : own.slice(banner + 1);
  const [, promptRe] = PANE_WAITS.find(([k]) => k === 'prompt');
  // the input line under a banner, from the unfiltered lines (PANE_CODE takes "> text" for code)
  const input = banner === -1 ? null : rawLines.slice(rawLines.findLastIndex((l) => LIMIT_BANNER.test(l)) + 1).map((l) => INPUT_LINE.exec(l.trim())).filter(Boolean).pop();
  return { menu, draft: !menu && !!input?.[1], limit: menu || (banner !== -1 && !after.some((l) => /^[⏺●⎿]/.test(l))), otherPrompt: !menu && own.some((l) => promptRe.test(l) || PANE_TRUST.test(l) || /Enter to confirm/.test(l)), busy: lines.some((l) => PANE_BUSY.test(l)), shells: lines.some((l) => PANE_SHELL.test(l)) };
}
// Not sh(): it trims the output, which would put the pane's first line at column 0.
export function paneBottom(target) {
  let text = '';
  try { text = execFileSync('tmux', ['capture-pane', '-p', '-t', target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: TMUX_TIMEOUT_MS }); } catch {}
  return text.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-15);
}
// Whether a pane (the box's operator, which no project's dashboard looks after) is stopped at a usage
// limit, and whether there is room to start it again: none (not stopped at a limit), unsafe (stopped,
// but a person, a draft or another prompt is there: left alone), room (the machine's active cswap
// account has room: relaunch it on the same conversation), no-room (every account is at its limit),
// or unknown (no cswap, or its accounts can't be read). The box's minute loop acts on it.
export function limitState(target) {
  const st = limitStop(paneBottom(target));
  if (!st.limit) return 'none';
  if (!paneStoppedAtLimit(target)) return 'unsafe';
  const bin = findCswap();
  const rows = bin ? cswapAccounts(bin) : null;
  if (!rows) return 'unknown';
  const active = rows.find((a) => a.active);
  if (active && accountHasRoom(active)) return 'room';
  const usable = rows.filter((a) => !a.disabled);
  return usable.length && usable.every(accountKnownFull) ? 'no-room' : 'unknown';
}
// A window that is one pane, stopped at a limit with nothing else going on: the tick asks before it
// starts a relaunch, and makeSession again right before it replaces the process (worktree_setup may
// have run for a while in between). A split window could lose the wrong pane; a background shell's
// work would die with the session. Nor is it replaced with a person at it: a half-typed line under
// the banner, or a client on that pane that pressed a key lately (read from tmux each time, so it
// can't outlive the client).
export function paneStoppedAtLimit(target) {
  if ((sh('tmux', ['list-panes', '-t', target, '-F', '#{pane_id}']) ?? '').split('\n').filter(Boolean).length !== 1) return false;
  const st = limitStop(paneBottom(target));
  return st.limit && !st.busy && !st.otherPrompt && !st.shells && !st.draft && !clientActiveOn(target);
}
export function clientActiveOn(target) {
  const [active, session] = (sh('tmux', ['display-message', '-p', '-t', target, '#{window_active}#{pane_active}\t#{session_name}']) ?? '').split('\t');
  if (active !== '11') return false;
  const now = Date.now() / 1000;
  return (sh('tmux', ['list-clients', '-t', `=${session}`, '-F', '#{client_activity}']) ?? '').split('\n').map(Number).some((t) => t > 0 && now - t < SETTLED_MS / 1000);
}
// Did this pane start in that directory? Compared resolved: tmux keeps the path as it was given.
export function paneStartedIn(target, dir) {
  try { return fs.realpathSync(sh('tmux', ['display-message', '-p', '-t', target, '#{pane_start_path}'])) === dir; } catch { return false; }
}
// Is this window a session the supervisor launched? A name and a banner are not enough: an agent can
// open a window called anything showing anything, and the relaunch runs as the supervisor. It must
// have started in that session's own worktree under the main checkout, the supervisor's log must
// show the launch, and a worker's ticket must have started.
export function launchedByKit(target, name, role) {
  if (!paneStartedIn(target, path.join(fs.realpathSync(mainRoot), '.worktrees', name))) return false;
  if (role === 'worker' && !lastPhaseOf(name)) return false;
  const said = [`made ${role} ${name} in `, `resumed ${role} ${name} in `];
  return logObjects('act').some((a) => a.class === 'worker-slots' && a.created_by === 'supervisor' && said.some((p) => String(a.what).startsWith(p)));
}
// Each session's restart times still in force. The file is untrusted: any shape reads as nothing,
// a lone number is the old form, and a time in the future is ignored.
export function restartTimes(now) {
  let o;
  try { o = JSON.parse(readText(ACCOUNTS_RESUMED) ?? '{}'); } catch { return {}; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
  const live = {};
  for (const [k, v] of Object.entries(o)) {
    const t = (Array.isArray(v) ? v : [v]).map(Number).filter((x) => Number.isFinite(x) && x <= now && now - x < RESTART_SPAN_MS).sort((a, b) => a - b).slice(-RESTART_MAX);
    if (t.length) live[k] = t;
  }
  return live;
}
// Takes this session's next restart from the record: 'go', 'gave-up' (past the cap) or null (not due,
// or no budget). Recorded before anything is done, under the lock, so a tick killed halfway can't
// restart it twice and a session that keeps stopping runs into the cap: if it can't be recorded,
// nothing is done. A budget of 0 only looks.
// Gives back a claim nothing was done with, so a pane that turned out fine costs no attempt. Best
// effort: a crash before this leaves the attempt counted, and it ages out with the others.
export function releaseRestart(name, at) {
  try { withLock(ACCOUNTS_RESUMED, () => { const live = restartTimes(Date.now()); const left = (live[name] ?? []).filter((t) => t !== at); if (left.length) live[name] = left; else delete live[name]; writeRestarts(live); }); } catch {}
}
export function writeRestarts(live) {
  fs.writeFileSync(`${ACCOUNTS_RESUMED}.${process.pid}`, JSON.stringify(live));
  fs.renameSync(`${ACCOUNTS_RESUMED}.${process.pid}`, ACCOUNTS_RESUMED);
}
export function claimRestart(name, budget, now = Date.now()) {
  try {
    fs.mkdirSync(runDir, { recursive: true });
    // withLock clears a lock older than 10 s, so one left by a crash costs one wait
    return withLock(ACCOUNTS_RESUMED, () => {
      const live = restartTimes(now);
      const times = live[name] ?? [];
      if (times.length >= RESTART_MAX) return 'gave-up';
      if (!budget || (times.length && now - times.at(-1) < RESTART_EVERY_MS)) return null;
      live[name] = [...times, now];
      writeRestarts(live);
      return 'go';
    });
  } catch { return null; }
}
// `worker|planner <id> --resume <flag>`, as the supervisor, but not from its pane: rememberSupervisorPane
// needs both markers, and TMUX stays so the child talks to this tmux server. Its worktree_setup is
// given DEVTEAM_SETUP_DEADLINE, 5 s before the child's own SIGKILL, or the one this process was
// given if that is still ahead and earlier (one handed down is never moved later; a past one is ignored).
export function relaunchChild(launch, flag, budget) {
  const env = { ...process.env, DEVTEAM_ROLE: 'supervisor' };
  for (const k of ['TMUX_PANE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE']) delete env[k];
  const now = Date.now();
  const own = process.env.DEVTEAM_SETUP_DEADLINE ? Number(process.env.DEVTEAM_SETUP_DEADLINE) : NaN;
  const mine = now + budget - 5000;
  env.DEVTEAM_SETUP_DEADLINE = String(Number.isFinite(own) && own > now ? Math.min(own, mine) : mine);
  return spawnSync(process.execPath, [process.argv[1], ...launch, '--resume', flag], { cwd: mainRoot, env, encoding: 'utf8', timeout: budget, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'] });
}
// A session cswap's switch stopped while it waited on its limit: Claude Code says "Automatic continue
// stopped · your login changed or ended · send a prompt to continue". Its process already has the new
// login and wants only a prompt, so one is typed (nothing is relaunched). False when the pane isn't
// stopped so, and the caller goes on as before; otherwise what was done: null (not ours, or not due),
// 'gave-up' (past the restart caps, which it shares), 'continued' or 'failed'. The stop must be the
// last thing the agent said, matched by its head (the whole line wraps at 80 columns), with an empty
// input: a draft is someone's and is never typed over, except the kit's own prompt whose Enter was
// lost, which gets the Enter (the lost-Enter rescues skip a pane that still shows a limit banner).
export function loginChangedStop(target, name, budget, ours) {
  const prompt = 'The kit: your login changed and the account has room now. Carry on.';
  const stopHead = /^\s*(?:[⎿⏺●■✖!]\s*)?Automatic continue stopped · your login changed\b/;
  if ((sh('tmux', ['list-panes', '-t', target, '-F', '#{pane_id}']) ?? '').split('\n').filter(Boolean).length !== 1) return false;
  const raw = paneBottom(target);
  const at = raw.findLastIndex((l) => !PANE_CODE.test(l.trim()) && stopHead.test(l));
  if (at === -1) return false;
  const below = raw.slice(at + 1).map((l) => l.trim());
  if (below.some((l) => /^[⏺●⎿]/.test(l))) return false;
  const draft = below.map((l) => INPUT_LINE.exec(l)).filter(Boolean).pop()?.[1] ?? '';
  if (draft && draft !== prompt) return false;
  const [, promptRe] = PANE_WAITS.find(([k]) => k === 'prompt');
  if (raw.map((l) => l.trim()).some((l) => PANE_BUSY.test(l) || promptRe.test(l) || PANE_TRUST.test(l) || /Enter to confirm/.test(l) || LIMIT_MENU.test(l))) return false;
  if (clientActiveOn(target) || !ours()) return null;
  const now = Date.now();
  // the claim and the key under the pane's typing lock (kit-618): the owner's floor, or a busy lock,
  // is not due (null), before any restart is spent on it
  const held = typeLock.run(target, (outer) => {
    if (outer && ownerLineOpen(target)) return { verdict: null };
    const verdict = claimRestart(name, budget, now);
    if (verdict !== 'go') return { verdict };
    return { ok: draft ? tmux(['send-keys', '-t', target, 'Enter']) : typeNow(target, prompt) };
  });
  if (held.busy) return null;
  if ('verdict' in held.value) return held.value.verdict;
  const { ok } = held.value;
  appendLog({ type: 'observation', source: 'pane', kind: 'login-continued', subject: name, detail: !ok ? 'a session stopped by a login change could not be sent its continue prompt' : draft ? "a session stopped by a login change had the kit's continue prompt unsent in its input: Enter was pressed" : 'a session stopped by a login change was sent a continue prompt on the active account, which has room', detector: 'pane', source_key: `login-continued ${name} ${now}` });
  if (!ok) out(`could not continue ${name}: tmux did not take the keys`);
  return ok ? 'continued' : 'failed';
}
// Restart one session stopped at a limit: 'restarted', 'failed' (tried, and it may not be running),
// 'gave-up' (stopped again, past the cap), 'slot-held' (its setup found no slot: left running, no
// attempt spent), or null when there is nothing to do. A running Claude Code
// session keeps the limit it hit even after the machine's login moves to an account with room (typing
// "carry on" into it meets the same banner), so it is relaunched as `worker|planner <id> --resume`
// would, in a fresh process on the active account, continuing the same conversation. makeSession
// replaces the old process itself, after everything that can refuse, and no key is sent to it.
// (A session stopped by a login change is another matter: loginChangedStop, above.)
export function restartPane(name, launch, budget) {
  const { target, problem } = resolvePane(tmuxTarget(name));
  if (problem || !target) return null;
  // the stop can sit under an old limit banner: it is the newer state, so a prompt, not a relaunch
  const login = loginChangedStop(target, name, budget, () => launchedByKit(target, name, launch[0]));
  if (login !== false) return login;
  if (!paneStoppedAtLimit(target) || !launchedByKit(target, name, launch[0])) return null;
  const now = Date.now();
  const verdict = claimRestart(name, budget, now);
  if (verdict !== 'go') return verdict;
  const r = relaunchChild(launch, '--replace-agent', budget);
  // no setup slot came free before the deadline: nothing was done, so the attempt is given back
  if (r.status === setupSlots.SLOT_WAIT) { releaseRestart(name, now); return 'slot-held'; }
  const ok = r.status === 0;
  const why = (r.stderr || r.error?.message || `exit ${r.status}`).trim().slice(0, 200);
  appendLog({ type: 'observation', source: 'pane', kind: 'limit-restarted', subject: name, detail: ok ? 'a session stopped at a usage limit was restarted on the active account, which has room' : `a session stopped at a usage limit could not be restarted: ${why}`, detector: 'pane', source_key: `limit-restarted ${name} ${now}` });
  if (!ok) out(`could not restart ${name}: ${why}`);
  return ok ? 'restarted' : 'failed';
}
// A machine that died (a dead battery, a redeploy) took the tmux server with it, and what survives
// on disk says which sessions to bring back: every worker and planner the kit launched, not held
// (its goal or the fleet parked, let go or drained, or its ticket's held field) or finished, whose
// worktree still exists and whose window doesn't. Only when the tmux session is gone, or was
// created after that session's last launch: a window closed in a session older than its launch was
// closed on purpose, and stays closed (the findings report it). Work in progress comes back first.
export const LAUNCH_ACT = /^(?:made|resumed) (worker|planner) (\S+) in /;
export const SETTLED_MS = 2 * 60000;
export function lastLaunches() {
  const last = new Map();
  for (const a of logObjects('act')) {
    const m = a.class === 'worker-slots' && a.created_by === 'supervisor' ? LAUNCH_ACT.exec(String(a.what)) : null;
    const at = m ? Date.parse(a.created_at) : NaN;
    if (Number.isFinite(at) && !(last.get(m[2])?.at > at)) last.set(m[2], { role: m[1], at });
  }
  return last;
}
// When this project's tmux session was created, { missing: true } if there's none (no server at all,
// after a reboot), or null if tmux didn't answer: not knowing is not a reason to start anything.
export function tmuxSessionAge(session) {
  const r = spawnSync('tmux', ['list-sessions', '-F', '#{session_name}\t#{session_created}'], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) return /no server running|no sessions|error connecting|no such file/i.test(r.stderr ?? '') ? { missing: true } : null;
  const row = r.stdout.split('\n').map((l) => l.split('\t')).find(([n]) => n === session);
  if (!row) return { missing: true };
  const created = Number(row[1]) * 1000;
  return Number.isFinite(created) && created > 0 ? { created } : null;
}
export function sessionsToRelaunch(launchOf, held) {
  const session = tmuxSession();
  const age = tmuxSessionAge(session);
  if (!age) return [];
  const windows = new Set(age.missing ? [] : (sh('tmux', ['list-windows', '-t', `=${session}`, '-F', '#W']) ?? '').split('\n'));
  const found = [];
  for (const [name, { role, at }] of lastLaunches()) {
    const launch = launchOf(name);
    if (!launch || launch[0] !== role || windows.has(name) || !(age.missing || age.created > at)) continue;
    if (!fs.existsSync(path.join(mainRoot, '.worktrees', name)) || !sessionOf(name).readable || held(name)) continue;
    if (role === 'worker' ? !lastPhaseOf(name) || tickets().get(name)?.superseded_by : !planners().some((p) => p.feature === launch[1])) continue;
    found.push({ name, launch });
  }
  // stable: within a tier, the launch order
  const tier = new Map(found.map((f) => [f.name, relaunchTier(f.name, f.launch)]));
  return found.sort((a, b) => tier.get(a.name) - tier.get(b.name));
}
// Which gone sessions come back first: 0, work in progress (uncommitted changes in its worktree, a
// planner the owner waits on, a worker in build); 2, a worker idle on a dependency (blocked or
// awaiting word, or its last message to the supervisor an unanswered blocked); 1, the rest.
export function relaunchTier(name, [role, id]) {
  const wt = path.join(mainRoot, '.worktrees', name);
  // a checkout of its own: a plain directory would read the enclosing repo's status
  if (fs.existsSync(path.join(wt, '.git'))) {
    const r = spawnSync('git', ['status', '--porcelain'], { cwd: wt, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] });
    if (r.status === 0 && r.stdout.trim()) return 0;
  }
  if (role === 'planner') return plannerAwaitsOwner(name, id) ? 0 : 1;
  const ph = lastPhaseOf(name)?.to;
  if (ph === 'build') return 0;
  if (['blocked', 'awaiting-word'].includes(ph)) return 2;
  const said = logObjects('message').filter((m) => m.created_by === name).sort(byTime).pop();
  return said?.kind === 'blocked' && !handledMessages().has(said.id) ? 2 : 1;
}
// An open question on the planner's goals or plan branch (its row's waiting_on_owner), or an open
// thread on it: on its card (planner:<feature>) or on an artifact drawn in its worktree.
export function plannerAwaitsOwner(name, feature) {
  if (planners().find((p) => p.feature === feature)?.waiting_on_owner?.length) return true;
  const on = (s) => isObj(s) && ((s.kind === 'item' && [`planner:${feature}`, `planner:${name}`].includes(s.ref)) || (s.kind === 'artifact' && s.at === name));
  return threadViews(readLog().objects).some((t) => t.status === 'open' && on(t.subject));
}
// Whether a resume of this session runs a worktree_setup: its repo's setting (a worker's ticket's
// repo, a planner's home), unless its worktree's setup marker matches (the resume skips it). repo()
// exits on a link it can't read, so that is checked first, and a repo that can't be read counts as
// having one.
export function hasWorktreeSetup(name, [role]) {
  const t = role === 'worker' ? tickets().get(name) : null;
  if (t && !repoReadable(repoOfTicketLink(t))) return true;
  const R = t ? repoOfTicket(t) : repo('home');
  const s = R.settings;
  return !!s.worktree_setup && setupMarker.needed(path.join(mainRoot, '.worktrees', name), s, R.root);
}
// Bring one back in a new window: 'relaunched', 'failed', 'gave-up', 'slot-held' (its setup found no
// slot before the deadline: the attempt given back, tried next tick), or null when not due. --if-gone
// refuses if the window has appeared meanwhile, which is not a failure: someone else got there first.
export function relaunchGone(name, launch, budget) {
  const now = Date.now();
  const verdict = claimRestart(name, budget, now);
  if (verdict !== 'go') return verdict;
  const r = relaunchChild(launch, '--if-gone', budget);
  if (r.status === IF_GONE_LEFT) return 'left';
  if (r.status === setupSlots.SLOT_WAIT) { releaseRestart(name, now); return 'slot-held'; }
  const ok = r.status === 0;
  const why = (r.stderr || r.error?.message || `exit ${r.status}`).trim().slice(0, 200);
  appendLog({ type: 'observation', source: 'pane', kind: 'session-relaunched', subject: name, detail: ok ? 'a session whose window was gone after the machine stopped was relaunched' : `a session whose window was gone could not be relaunched: ${why}`, detector: 'pane', source_key: `session-relaunched ${name} ${now}` });
  if (!ok) out(`could not relaunch ${name}: ${why}`);
  return ok ? 'relaunched' : 'failed';
}
// makeSession --replace-agent: the pane's process becomes a shell in the worktree. respawn-pane -k
// only sends SIGHUP, so the process and its direct children (the agent, under the pane's shell) are
// noted first, and any still alive a moment later get a SIGTERM. Only those pids.
export function replacePaneProcess(target, wt) {
  const pid = Number(sh('tmux', ['display-message', '-p', '-t', target, '#{pane_pid}']));
  if (!Number.isInteger(pid) || pid <= 1) return `could not read the process of ${target}: left as it was`;
  const pids = [pid, ...(sh('pgrep', ['-P', String(pid)]) ?? '').split('\n').map(Number).filter((p) => Number.isInteger(p) && p > 1)];
  // a login shell, as a new window gets, not the pane's first command (respawn-pane's default), which may be the agent itself
  const shell = sh('tmux', ['show-options', '-gv', 'default-shell'])?.trim() || process.env.SHELL || '/bin/sh';
  if (!tmux(['respawn-pane', '-k', '-c', wt, '-t', target, `${shell} -l`])) return `could not replace the process in ${target}`;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  for (const p of pids) {
    try { process.kill(p, 0); process.kill(p, 'SIGTERM'); } catch {}
  }
  return null;
}
// The supervisor's transcript ending on a rate-limit error means it has stopped: reported, and when
// it runs in tmux and can be restarted on that exact conversation, restarted (restartSupervisor).
// Which one is the supervisor's: of the newest few in the main checkout, the one the kit started as the supervisor or
// that ran supervisor commands (a command it ran: reading or quoting the words is not enough).
// Nothing else is taken for it, and a limit lasts a week at most.
// `DEVTEAM_ROLE=supervisor node …`, after an optional `cd <dir> &&` or `cd <dir>;`, and the
// `export DEVTEAM_ROLE=supervisor; …devteam.mjs …` form a session that set up its own fleet writes
export const SUPERVISOR_COMMAND = /^\s*(?:cd \S+\s*(?:&&|;)\s*)?(?:DEVTEAM_ROLE=supervisor node |export DEVTEAM_ROLE=supervisor\s*(?:;|&&)[^\n]*\bdevteam\.mjs\b)/;
export const SUPERVISOR_LIMIT_MAX_MS = 7 * 24 * 3600000;
export function supervisorTranscript() {
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'projects', realOrSelf(mainRoot).replace(/[^a-zA-Z0-9]/g, '-'));
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => ({ f: path.join(dir, f), m: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.m - a.m).slice(0, 5); } catch { return null; }
  // The head is read far enough to reach the first user message: Claude Code can write large
  // attachment and snapshot lines before it (85 KB of them in one supervisor's transcript).
  const read = (f, tail) => { const fd = fs.openSync(f, 'r'); try { const size = fs.fstatSync(fd).size; const n = Math.min(size, tail ? 1024 * 1024 : 4 * 1024 * 1024); const b = Buffer.alloc(n); return b.toString('utf8', 0, fs.readSync(fd, b, 0, n, tail ? size - n : 0)); } finally { fs.closeSync(fd); } };
  const lines = (t) => t.split('\n').flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  for (const { f } of files) {
    try {
      const end = read(f, true);
      const first = read(f, false).split('\n').reduce((u, l) => { if (u || !l.includes('"user"')) return u; try { const o = JSON.parse(l); return o?.type === 'user' ? o : null; } catch { return null; } }, null);
      const ran = lines(end).some((o) => o?.type === 'assistant' && Array.isArray(o.message?.content) && o.message.content.some((c) => c?.type === 'tool_use' && SUPERVISOR_COMMAND.test(String(c.input?.command ?? ''))));
      if (ran || JSON.stringify(first?.message ?? '').includes('You are the supervisor for this repository')) return { file: f, entries: lines(end) };
    } catch {}
  }
  return null;
}
export function supervisorLimit() {
  const t = supervisorTranscript();
  const last = t?.entries.filter((o) => o?.type === 'assistant').pop();
  if (!last) return null;
  if (last?.error !== 'rate_limit' || !(Date.now() - Date.parse(last.timestamp) < SUPERVISOR_LIMIT_MAX_MS)) return null;
  const c = last.message?.content;
  return { at: last.timestamp, text: String((Array.isArray(c) ? c[0]?.text : c) ?? 'usage limit').slice(0, 200), session: supervisorSessionId(t) };
}
// supervisor-session: the id of the supervisor's conversation, for resuming it after the machine
// died: it reads only what's on disk. Claude Code's alone; another harness, or none found, prints
// nothing, so nobody resumes a guess.
export function cmdSupervisorSession() {
  const id = supervisorSessionId();
  if (id) out(id);
}
// The conversation's id, only for Claude Code and only in the characters an id has: it goes on a
// command line. Null means nothing to resume rather than a guess.
export const SESSION_ID = /^[A-Za-z0-9_-]+$/;
export function supervisorSessionId(t = supervisorTranscript()) {
  if (!/^claude(\s|$)/.test(loadSettings().resume_command) || !t) return null;
  const id = path.basename(t.file, '.jsonl');
  return SESSION_ID.test(id) ? id : null;
}
// The repo's resume_command on this exact conversation (--continue replaced, as the box's boot
// does), or null when it has no --continue to replace.
export function supervisorResumeCommand(id, s = loadSettings()) {
  const cmd = s.resume_command;
  return /\s--continue(\s|$)/.test(cmd) ? cmd.replace(/(\s)--continue(?=\s|$)/, `$1--resume ${id}`) : null;
}
// A process's arguments and environment, from the OS, or null if they can't be read; a caller that
// needs the environment checks it isn't empty. Linux keeps them exact; ps runs each together with
// spaces, so the environment is what `ps e` adds to the arguments (nothing, on macOS, for a shell in
// /bin), and the arguments are only words.
export function processInfo(pid) {
  if (process.platform === 'linux') {
    const read = (f) => fs.readFileSync(`/proc/${pid}/${f}`, 'utf8').split('\0').filter(Boolean);
    try { return { args: read('cmdline'), env: read('environ') }; } catch { return null; }
  }
  const args = sh('ps', ['-ww', '-o', 'command=', '-p', String(pid)]);
  const both = sh('ps', ['eww', '-o', 'command=', '-p', String(pid)]);
  if (!args || !both?.startsWith(args)) return null;
  return { args: args.split(/\s+/), env: both.slice(args.length).trim().split(/\s+/).filter(Boolean) };
}
// The agent in a pane: the pane's own process, or the one child of its shell. Null when that can't
// be said for sure, and a caller deciding on it refuses.
export function paneAgentProcess(target) {
  const pid = Number(sh('tmux', ['display-message', '-p', '-t', target, '#{pane_pid}']));
  if (!Number.isInteger(pid) || pid <= 1) return null;
  const own = processInfo(pid);
  if (!own || !SHELLS.has(path.basename(own.args[0] ?? '').replace(/^-/, ''))) return own;
  const kids = (sh('pgrep', ['-P', String(pid)]) ?? '').split('\n').filter(Boolean);
  return kids.length === 1 ? processInfo(Number(kids[0])) : null;
}
// Was it started with the flag? Only among the options before its first plain argument: the prompt
// is an argument too, and can mention the flag. Not knowing reads as no.
export const SKIP_PERMISSIONS = '--dangerously-skip-permissions';
export function startedSkippingPermissions(args) {
  for (let i = /^(node|bun)$/.test(path.basename(args[0] ?? '')) ? 2 : 1; args[i]?.startsWith('-'); i++) {
    if (args[i] === SKIP_PERMISSIONS) return true;
    if (args[i + 1] && !args[i + 1].startsWith('-')) i++;
  }
  return false;
}
export const withoutSkipPermissions = (cmd) => cmd.replace(new RegExp(`\\s${SKIP_PERMISSIONS}(?=\\s|$)`, 'g'), '');
export const isSupervisorProcess = (p) => !!p && p.env.includes('DEVTEAM_ROLE=supervisor');
// The line that brings the supervisor back by hand (in a terminal, after a dead machine or a refused
// restart): DEVTEAM_ROLE first, as its own start has it. Null without a conversation to resume.
// Permission prompts stay on unless the supervisor running now was started without them.
export function supervisorRecovery(id) {
  if (!id) return null;
  const cmd = supervisorResumeCommand(id) ?? loadSettings().resume_command.replace(/^claude(?=\s|$)/, `claude --resume ${id}`);
  const { target } = resolvePane(supervisorTarget());
  const agent = target ? paneAgentProcess(target) : null;
  // with its Stop hook once a start (recover, the restart after a limit) has written it (supervisor.md
  // §6, Every ask is an Inbox question); printed only, so it writes nothing
  return `DEVTEAM_ROLE=supervisor ${withSupervisorPolicy(isSupervisorProcess(agent) && startedSkippingPermissions(agent.args) ? cmd : withoutSkipPermissions(cmd), { write: false })}`;
}
// A supervisor in tmux stopped at a limit, on its exact conversation: claude --resume <id> from
// resume_command, in place of the pane's process, after the same refusals as a worker. Claude Code
// only; without an id, or for anything else, it isn't guessed at, and the finding says how to resume
// by hand. The same record and caps as restartPane, under the name "supervisor". A parked or drained
// fleet's supervisor stays stopped, as recover leaves it.
export const SUPERVISOR_RESTART_PROMPT = 'You were restarted after a usage limit, on this same conversation. Carry on from where you were.';
// What to restart, null if it isn't due, or { refused } if the process can't be read. A banner in the
// recorded pane says nothing about whose conversation it is, so the id comes from a transcript that
// itself ends on a limit, and the pane's process must be running as the supervisor. It keeps the
// permissions it had: a supervisor started by hand without the flag is not given it.
// until (kit-780): when its origin read must end, inside the restart's budget; null only looks, and
// origin isn't asked (no restart follows, so no command is needed).
export function supervisorToRestart(until) {
  const { target, problem } = resolvePane(supervisorTarget());
  if (problem || !target || !paneStoppedAtLimit(target) || !paneStartedIn(target, fs.realpathSync(mainRoot))) return null;
  const id = supervisorLimit()?.session;
  if (!id) return null;
  // a pane whose process is plainly not the supervisor needs no command, so origin isn't asked
  const agent = paneAgentProcess(target);
  if (agent?.env.length && !isSupervisorProcess(agent)) return null;
  if (!until) return agent?.env.length && isSupervisorProcess(agent) ? { target, id, cmd: null } : null;
  // the owner's resume_command as origin has it, never a local ref's (kit-764): a refusal skips this
  // restart and says why
  const s = loadSettings({ origin: true, until });
  if (s.refused) return { refused: s.refused };
  const cmd = supervisorResumeCommand(id, s);
  if (!cmd) return null;
  if (!agent?.env.length) return { refused: `could not read the environment of the process in ${target}` };
  if (!isSupervisorProcess(agent)) return null;
  return { target, id, cmd: startedSkippingPermissions(agent.args) ? cmd : withoutSkipPermissions(cmd) };
}
export function restartSupervisor(budget) {
  if (draining() || fleetMode()) return null;
  // a test's smaller budget (DEVTEAM_TEST only): a whole number of ms, 0 only looks
  const cap = process.env.DEVTEAM_TEST ? process.env.DEVTEAM_RESTART_BUDGET_MS : undefined;
  if (/^\d+$/.test(cap ?? '')) budget = Math.min(budget, Number(cap));
  // origin's read ends within 15 s (a healthy read takes seconds, and a refusal spends no attempt, so
  // the next due tick asks again), and 5 s before the budget, as a relaunch's child does
  // (relaunchChild), so the pane is still typed into inside it; no budget, no read (kit-780)
  const until = budget ? Date.now() + Math.min(15000, budget - 5000) : null;
  // stopped by a login change: a prompt into its own pane, no transcript or resume command needed
  const { target: pane, problem } = resolvePane(supervisorTarget());
  if (!problem && pane) {
    const login = loginChangedStop(pane, 'supervisor', budget, () => paneStartedIn(pane, fs.realpathSync(mainRoot)) && isSupervisorProcess(paneAgentProcess(pane)));
    if (login !== false) return login;
  }
  const found = supervisorToRestart(until);
  if (!found || found.refused) return found;
  const { target, id } = found;
  // its Stop hook, as recover's start has it: --settings does not outlive the process it was given to
  const cmd = withSupervisorPolicy(found.cmd);
  const now = Date.now();
  const verdict = claimRestart('supervisor', budget, now);
  if (verdict !== 'go') return verdict;
  // the same order as --replace-agent: everything is checked once more, right before it is replaced
  const again = supervisorToRestart(until);
  if (again?.target !== target || again.id !== id) { releaseRestart('supervisor', now); return null; }
  // the respawn and its typing under the pane's typing lock (kit-618), taken only now, so the owner's
  // keys never wait on origin's read: while the owner's line is open, or another writer holds the
  // lock, nothing is replaced and the attempt is given back (the next due tick asks again)
  const held = typeLock.run(target, (outer) => {
    if (outer && ownerLineOpen(target)) return null;
    let why = replacePaneProcess(target, mainRoot);
    if (!why && !typeNow(target, `export DEVTEAM_ROLE=supervisor; ${sessionMarkerPrefix()}${cmd} '${SUPERVISOR_RESTART_PROMPT}'`)) why = `could not type into ${target}; run ${cmd} there`;
    return { why };
  });
  if (held.busy || !held.value) { releaseRestart('supervisor', now); return null; }
  const failed = held.value.why;
  appendLog({ type: 'observation', source: 'pane', kind: 'limit-restarted', subject: 'supervisor', detail: failed ? `the supervisor, stopped at a usage limit, could not be restarted: ${failed}` : `the supervisor, stopped at a usage limit, was restarted on conversation ${id}`, detector: 'pane', source_key: `limit-restarted supervisor ${now}` });
  if (failed) out(`could not restart the supervisor: ${failed}`);
  return failed ? 'failed' : 'restarted';
}
