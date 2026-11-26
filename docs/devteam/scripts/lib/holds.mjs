/* imports start */
import fs from 'node:fs';
import { CHORES } from './settings.mjs';
import { HOLD_RANK } from './panes.mjs';
import { RECENT_DAYS } from './reviews.mjs';
import { RECORDS_ONLY_FIX } from './panes.mjs';
import { RESERVED_LINKS } from './links.mjs';
import { SCHEMA } from './log.mjs';
import { activeTickets } from './graph.mjs';
import { activeWorker } from './graph.mjs';
import { ancestorOf } from './base.mjs';
import { appendLog } from './log-sync.mjs';
import { causeWords } from './fleet.mjs';
import { citing } from './questions.mjs';
import { closures } from './graph.mjs';
import { countsAsWorker } from './graph.mjs';
import { coverageGap } from './reviews.mjs';
import { criticalPath } from './graph.mjs';
import { decisionFor } from './questions.mjs';
import { deriveStatus } from './panes.mjs';
import { die } from './base.mjs';
import { draining } from './fleet.mjs';
import { features } from './graph.mjs';
import { findCycle } from './graph.mjs';
import { flagStr } from './base.mjs';
import { flags } from './base.mjs';
import { gb } from './hub/operator.mjs';
import { git } from './base.mjs';
import { handoffCommit } from './fleet.mjs';
import { handoffFor } from './fleet.mjs';
import { incidentList } from './sensors.mjs';
import { incidentOfTicket } from './sensors.mjs';
import { incidentSeverity } from './sensors.mjs';
import { isActive } from './graph.mjs';
import { isHeld } from './graph.mjs';
import { isIncident } from './sensors.mjs';
import { json } from './base.mjs';
import { lastPhaseOf } from './fleet.mjs';
import { levels } from './graph.mjs';
import { listFlag } from './base.mjs';
import { loadSettings } from './settings.mjs';
import { logGet } from './log-sync.mjs';
import { logObjects } from './log-sync.mjs';
import { logWriter } from './log.mjs';
import { mainRef } from './log.mjs';
import { markedPane } from './log.mjs';
import { memo } from './graph.mjs';
import { mergeShaFor } from './repos.mjs';
import { moveLine } from './orient.mjs';
import { nextMoves } from './orient.mjs';
import { nowIso } from './base.mjs';
import { out } from './base.mjs';
import { ownerLineOpen } from './recover.mjs';
import { planFeature } from './log.mjs';
import { planners } from './panes.mjs';
import { positional } from './base.mjs';
import { readLog } from './log-sync.mjs';
import { recordsInHomeId } from './repos.mjs';
import { recordsWorktreePath } from './sessions.mjs';
import { repo } from './repos.mjs';
import { repoOfTicketLink } from './repos.mjs';
import { repoReadable } from './repos.mjs';
import { resolveCommit } from './log-sync.mjs';
import { resolvePane } from './sessions.mjs';
import { reviewStats } from './reviews.mjs';
import { runDir } from './state.mjs';
import { sendLine } from './sessions.mjs';
import { sessionOf } from './fleet.mjs';
import { settledByLanding } from './sessions.mjs';
import { sevScope } from './sensors.mjs';
import { sh } from './base.mjs';
import { ticketBranchRef } from './repos.mjs';
import { ticketReviews } from './reviews.mjs';
import { tickets } from './graph.mjs';
import { tmuxSession } from './base.mjs';
import { tmuxTarget } from './base.mjs';
import { touchesOverlap } from './graph.mjs';
import { upkeepAllows } from './goals.mjs';
import { upkeepGoal } from './log-sync.mjs';
import { waitCause } from './orient.mjs';
import { workLines } from './goals.mjs';
import { workerState } from './graph.mjs';
import { writerClass } from './log.mjs';
/* imports end */
export const UPKEEP_VIRTUAL = Object.freeze({ id: 'upkeep', type: 'goal', kind: 'upkeep', title: 'Upkeep', hold: null, updates: [] });
export const upkeepOrVirtual = () => upkeepGoal() ?? UPKEEP_VIRTUAL;
export const isUpkeep = (g) => g?.kind === 'upkeep';
// A goal named on the command line: its id, or "upkeep".
export function goalArg(id) {
  if (id === 'upkeep') return upkeepOrVirtual();
  const g = logGet(id ?? '');
  return g?.type === 'goal' ? g : null;
}
export function goalMode(g) {
  if (!g) return 'run';
  if (g.status === 'abandoned') return 'let-go';
  return g.hold?.mode ?? 'run';
}
// The mode work serving several goals runs under: the least restrictive among them, leaving out
// goals already met (a feature that served a met goal and a parked one is parked).
export function modeOf(goals) {
  const known = goals.filter(Boolean);
  const live = known.filter((g) => g.status !== 'met');
  const set = live.length ? live : known;
  if (!set.length) return 'run';
  return set.map(goalMode).sort((a, b) => HOLD_RANK[a] - HOLD_RANK[b])[0];
}
export function ticketGoals(t) {
  if (!t) return [];
  if (t.feature === CHORES) return [upkeepOrVirtual()];
  return (features().get(t.feature)?.goals ?? []).map((id) => logGet(id)).filter((g) => g?.type === 'goal');
}
// A ticket whose feature names no goal (an old project) follows the fleet, like its session.
export const ticketMode = (t) => { const gs = ticketGoals(t); return gs.length ? modeOf(gs) : fleetMode() ?? 'run'; };
// A ticket's own priority: the best (lowest) priority among the running goals it serves (not met,
// abandoned or held), and which goal that is; null when none has one (a chore, an unprioritised goal).
export function ownPriority(t) {
  const g = ticketGoals(t).filter((x) => !['met', 'abandoned'].includes(x.status) && goalMode(x) === 'run' && typeof x.priority === 'number').sort((a, b) => a.priority - b.priority)[0];
  return g ? { priority: g.priority, goal: g.id } : null;
}
// Each live ticket's effective priority: the best of its own and that of every live ticket that
// depends on it, directly or through others. Work a higher-priority goal waits on goes first,
// whatever goal it serves, so the goal isn't left waiting on work nobody pushes (ready, idle
// capacity, priority-inversion). Priority orders the queue, never gates it. Live: active,
// unmerged, its goal running (a drained, parked or let-go goal's ticket starts nothing, so
// pushes nothing).
export function effectivePriorities(ts) {
  const live = new Map([...ts].filter(([, t]) => isActive(t) && !mergeShaFor(t.id) && ticketMode(t) === 'run'));
  // over live tickets only: a chain through a held goal's ticket passes nothing on, and history costs nothing
  const clos = closures(live);
  const own = new Map([...live.values()].map((t) => [t.id, ownPriority(t)]));
  const eff = new Map([...own].map(([id, p]) => [id, { own: p, priority: p?.priority ?? null, goal: p?.goal ?? null }]));
  for (const [id, p] of own) {
    if (!p) continue;
    for (const d of clos.get(id) ?? []) { const e = eff.get(d); if (e && (e.priority == null || p.priority < e.priority)) Object.assign(e, { priority: p.priority, goal: p.goal }); }
  }
  return eff;
}
// What a ready row shows of it: its effective priority, and the goal it blocks when that is better
// than its own.
export const inheritedPriority = (e) => (e && e.priority != null && (e.own == null || e.priority < e.own.priority) ? { priority: e.priority, goal: e.goal } : null);
// Lower first; no priority last.
export const byPriority = (a, b) => (a ?? Infinity) === (b ?? Infinity) ? 0 : (a ?? Infinity) < (b ?? Infinity) ? -1 : 1;
// ready's order, for anything that picks from it: fix tickets first, the most severe incident first
// (incident_slots lets that many run past max_active_tickets), then by effective priority. Rows of
// { kind, severity, priority }.
export const readyOrder = (a, b) => (b.kind === 'fix') - (a.kind === 'fix') || (b.severity ?? 0) - (a.severity ?? 0) || byPriority(a.priority, b.priority);
// The goals that can hold anything: live goals and Upkeep.
export const holdableGoals = () => [upkeepOrVirtual(), ...logObjects('goal').filter((g) => !['met', 'abandoned'].includes(g.status))];
// When every holdable goal is parked, or every one is draining or parked, the fleet is too.
export function fleetMode() {
  const modes = holdableGoals().map(goalMode);
  if (modes.every((m) => m === 'park')) return 'park';
  if (modes.every((m) => m === 'park' || m === 'drain') && modes.includes('drain')) return 'drain';
  return null;
}
// The fleet op in force: the newest one whose hold is still on some goal.
export function fleetOpInForce() {
  const hs = holdableGoals().map((g) => g.hold).filter((h) => h?.fleet);
  return hs.sort((a, b) => b.fleet.localeCompare(a.fleet))[0] ?? null;
}
// How many holdable goals (Upkeep included) are running, draining and parked: a fleet whose goals
// are mixed is partly held, which fleetMode alone (every goal one way, or null) can't say. hello
// --json carries it and machine status reads it, so a fleet with most goals parked never looks fully running.
export const goalModeCounts = () => { const c = { run: 0, drain: 0, park: 0 }; for (const g of holdableGoals()) { const m = goalMode(g); if (m in c) c[m]++; } return c; };
// The fleet is held to move to another machine: a fleet op made with --move, or an old drain (which
// was only ever for a move). A pause (throttling, waiting on the owner) keeps the machine's claim.
export const movingFleet = () => !!draining() || !!fleetOpInForce()?.move;
export const newFleetId = () => { const at = nowIso(); return `f-${at.slice(0, 10).replace(/-/g, '')}-${at.slice(11, 23).replace(/[:.]/g, '')}`; };
// A session's goals: a worker's ticket's; a planner's feature line's, its questions', or its launch's.
export function sessionGoals(name) {
  const s = sessionOf(name);
  if (s.role === 'worker') return ticketGoals(tickets().get(s.id));
  const p = planners().find((x) => x.feature === s.id);
  const ids = p ? p.goals : plannerLaunchGoals(s.id);
  return ids.map((id) => logGet(id)).filter((g) => g?.type === 'goal');
}
// The goal a planner was started for (planner <feature> --goal), from its launch acts.
export function plannerLaunchGoals(feature) {
  const re = new RegExp(` planner plan-${feature} `);
  return [...new Set(logObjects('act').filter((a) => a.class === 'worker-slots' && re.test(` ${a.what} `)).flatMap((a) => (a.refs ?? []).filter((r) => r.startsWith('g-'))))];
}
// A session with no goal (an old planner) follows the fleet.
export function sessionMode(name) {
  const gs = sessionGoals(name);
  return gs.length ? modeOf(gs) : fleetMode() ?? 'run';
}
// The hold (or let-go) that holds a session now, as a cause: which goal, since when, and a marker a
// park ruling carries so it is sent once per cause.
export function currentCause(name) {
  const gs = sessionGoals(name);
  const set = gs.length ? gs.filter((g) => g.status !== 'met') : holdableGoals();
  const causes = set.map((g) => causeOf(g, Date.now())).filter(Boolean);
  if (!causes.length || causes.length < set.length) return null;
  return causes.sort((a, b) => b.at.localeCompare(a.at))[0];
}
// What parked or let go a goal at a time (ms), or null if it was running or draining then.
export function causeOf(g, when) {
  const ups = (g.updates ?? []).filter((u) => Date.parse(u.at) <= when);
  const st = ups.filter((u) => u.status !== undefined).pop();
  if (st?.status === 'abandoned') return { kind: 'let-go', goal: g.id, title: g.title, at: st.at, marker: `let-go:${g.id}@${st.at}`, reason: g.decision?.notes ?? null };
  const h = ups.filter((u) => u.hold !== undefined).pop();
  if (h?.hold?.mode !== 'park') return null;
  return h.hold.fleet
    ? { kind: 'fleet', goal: g.id, title: g.title, at: h.at, fleet: h.hold.fleet, host: h.hold.host ?? null, marker: `fleet:${h.hold.fleet}`, reason: h.hold.reason ?? null }
    : { kind: 'park', goal: g.id, title: g.title, at: h.at, marker: `park:${g.id}@${h.at}`, reason: h.hold.reason ?? null };
}
// What a session told to park must do; the marker in brackets lets a ruling be sent once per cause.
export function parkMessage(s, cause) {
  const title = String(cause.title ?? '').slice(0, 60);
  const reason = cause.reason ? ` (${String(cause.reason).slice(0, 80)})` : '';
  const why = cause.kind === 'fleet' ? `the fleet is parked${reason}` : cause.kind === 'let-go' ? `the owner let go of "${title}"` : `"${title}" is parked${reason}`;
  const tail = ` [${cause.marker}]`;
  const recs = s.role === 'worker' && recordsInHomeId(s.id) ? ` Push records-${s.id} too.` : '';
  const body = `Park: ${why}.${recs} Commit all work (WIP is fine), then devteam.mjs handoff with your note on stdin (done, exact next step, open questions, anything uncommitted; it commits the note and pushes ${s.branch}), then devteam.mjs phase parked --note "parked", and stop (worker.md §9). Any merge-request you sent is void; resend it when resumed.`;
  // a message line holds 600 characters; the marker that sends it once per cause is kept whole
  return `${body.slice(0, 600 - tail.length)}${tail}`;
}
export const parkRulingSent = (name, marker) => logObjects('message').some((m) => m.to === name && m.kind === 'ruling' && (m.text ?? '').includes(`[${marker}]`));
// Every live session: workers with a phase that isn't done and no merge, planners in flight.
export function liveSessions() { return memo('liveSessions', liveSessionsNow); }
export function liveSessionsNow() {
  const names = new Set();
  // a superseded ticket is a session only while something still runs in its window
  const windowUp = (id) => !/^no tmux (session|window)/.test(resolvePane(tmuxTarget(id)).problem ?? '');
  for (const t of tickets().values()) if ((activeWorker(t.id) && (isActive(t) || windowUp(t.id))) || (workerState(t.id)?.phase === 'parked' && !mergeShaFor(t.id) && isActive(t))) names.add(t.id);
  for (const p of planners()) names.add(`plan-${p.feature}`);
  return [...names].sort().map(sessionOf);
}
// Send the park ruling to every running session a park or let-go holds and hasn't been told about
// for its current cause (once; --again re-sends). goal: only that goal's sessions.
export function sendParkRulings({ goal = null, again = false } = {}) {
  const sent = [];
  for (const s of liveSessions()) {
    if (lastPhaseOf(s.name)?.to === 'parked') continue;
    if (goal && !sessionGoals(s.name).some((g) => g.id === goal.id) && !(isUpkeep(goal) && !sessionGoals(s.name).length)) continue;
    if (!['park', 'let-go'].includes(sessionMode(s.name))) continue;
    const cause = currentCause(s.name);
    if (!cause || (!again && parkRulingSent(s.name, cause.marker))) continue;
    sendLine({ to: s.name, kind: 'ruling', text: parkMessage(s, cause), from: 'supervisor', ticket: s.role === 'worker' ? s.id : null });
    sent.push(s.name);
  }
  return sent;
}
// The restart command for each parked session a release lets run again.
export function restartCommands(filter = () => true) {
  const windows = new Set((sh('tmux', ['list-windows', '-t', `=${tmuxSession()}`, '-F', '#W']) ?? '').split('\n').filter(Boolean));
  return liveSessions().filter((s) => lastPhaseOf(s.name)?.to === 'parked' && ['run', 'drain'].includes(sessionMode(s.name)) && filter(s)).map((s) => ({ name: s.name, cmd: `${s.role} ${s.id}${windows.has(s.name) && fs.existsSync(s.wt) ? ' --resume' : ''}`, handoff: !!handoffFor(s.name) }));
}
// Write one goal's hold, creating Upkeep's line the first time it is held. extra: top-level fields of
// the hold line beside hold (a drain's hold_for and hold_until).
export function writeHold(g, hold, by, extra = {}) {
  let target = g;
  if (isUpkeep(g) && !upkeepGoal()) target = appendLog({ type: 'goal', kind: 'upkeep', title: 'Upkeep' }, by);
  return appendLog({ type: 'goal', op: 'set', id: target.id, hold, ...extra }, by);
}
export const holdWords = (m) => ({ run: 'running', drain: 'draining', park: 'parked', 'let-go': 'let go' }[m] ?? m);
// The mode label a goal shows: drain splits into draining (work still running) and drained.
// A parked session has settled once it stopped (phase parked), its branch is on origin as it is here,
// its worktree is clean and its handoff is recorded: until then its goal is still parking.
// A records-in-home worker's records must move with it too: home's ticket/<id> pushed (local =
// origin) and its records worktree clean. A records branch with nothing of its own (none at all,
// or a local one that is still in home's main, never pushed) has nothing to lose.
export function recordsParkProblems(s) {
  if (s.role !== 'worker' || !recordsInHomeId(s.id)) return [];
  const b = `ticket/${s.id}`;
  const local = resolveCommit(`refs/heads/${b}`);
  const remote = resolveCommit(`refs/remotes/origin/${b}`);
  const main = mainRef();
  const nothing = !remote && (!local || (!!main && ancestorOf(local, main) === true));
  const rw = recordsWorktreePath(s.id);
  const dirty = fs.existsSync(rw) ? workLines(git(['status', '--porcelain'], rw)) : [];
  return [
    !nothing && !remote && `records: home's ${b} is not on origin: push it from ${rw}`,
    !nothing && remote && local && local !== remote && `records: home's ${b} here (${local.slice(0, 12)}) is not what origin has (${remote.slice(0, 12)}): push it from ${rw}`,
    dirty.length > 0 && `records: ${dirty.length} uncommitted change(s) in ${rw}`,
  ].filter(Boolean);
}
export const settledMemo = new Map();
export function sessionSettled(s) {
  if (settledMemo.has(s.name)) return settledMemo.get(s.name);
  // a session in a repo this machine can't read never reads as settled (fleet status says why)
  let ok = lastPhaseOf(s.name)?.to === 'parked' && s.readable;
  if (ok) {
    const R = s.repo;
    const local = R.resolveCommit(`refs/heads/${s.branch}`);
    const remote = R.resolveCommit(`refs/remotes/origin/${s.branch}`);
    const dirty = fs.existsSync(s.wt) ? workLines(git(['status', '--porcelain'], s.wt)).join('\n') : '';
    const handoff = remote && (handoffCommit(`refs/remotes/origin/${s.branch}`, s.name, R) || R.git(['cat-file', '-e', `${remote}:${s.handoff}`]) !== null);
    ok = !!remote && (!local || local === remote) && !dirty && !!handoff && !recordsParkProblems(s).length;
  }
  settledMemo.set(s.name, ok);
  return ok;
}
export function holdView(g) {
  const mode = goalMode(g);
  // draining: what still runs; parking: what hasn't settled (stopped, pushed, clean, handed off)
  const running = mode === 'drain' || mode === 'park' ? liveSessions().filter((s) => sessionGoals(s.name).some((x) => x.id === g.id) && (mode === 'park' ? !sessionSettled(s) : lastPhaseOf(s.name)?.to !== 'parked')).map((s) => s.name) : [];
  const state = mode === 'drain' ? (running.length ? 'draining' : 'drained') : mode === 'park' ? (running.length ? 'parking' : 'parked') : mode === 'let-go' ? 'let go' : 'running';
  return { mode, state, running, reason: g.hold?.reason ?? null, by: g.hold_by ?? null, fleet: g.hold?.fleet ?? null, since: (g.updates ?? []).filter((u) => u.hold !== undefined).pop()?.at ?? null };
}

// A session told to park that hasn't within this long is a park-unsettled finding: about two ticks
// (DEVTEAM_PARK_SETTLE_MINUTES for tests).
export const PARK_SETTLE_ENV = process.env.DEVTEAM_PARK_SETTLE_MINUTES ? Number(process.env.DEVTEAM_PARK_SETTLE_MINUTES) : NaN;
export const PARK_SETTLE_MS = (Number.isFinite(PARK_SETTLE_ENV) ? PARK_SETTLE_ENV : 30) * 60000;
// What holds need from the supervisor, as findings with a next step (supervisor.md §3): rulings a
// park hasn't sent yet, sessions parked under a goal that runs again, tickets waiting on a held
// goal's work, a drain that has finished, and a goal parked long enough to ask about.
export function holdFindings(add, settings) {
  const now = Date.now();
  const sessions = liveSessions();
  for (const s of sessions) {
    const parkedNow = lastPhaseOf(s.name)?.to === 'parked';
    const mode = sessionMode(s.name);
    if (!parkedNow && ['park', 'let-go'].includes(mode)) {
      const c = currentCause(s.name);
      const target = c ? (isUpkeep(logGet(c.goal) ?? UPKEEP_VIRTUAL) ? 'upkeep' : c.goal) : null;
      if (c && !parkRulingSent(s.name, c.marker)) add('high', 'park-unsent', s.name, `its goal is ${holdWords(mode)} (${causeWords(c)}), and it hasn't been told`, `goal park-sessions ${target}`);
      // told, and still not parked a while later: a park never waits on a reply or an owner answer
      // (worker.md §9: commit WIP, a handoff naming what it waits on, phase parked), so one session
      // left running doesn't hold the fleet in "parking" for days. Counted from the first ruling for
      // this cause (a re-send that couldn't be delivered doesn't restart it), or from a later launch
      // (a session started on purpose since gets its own time).
      else if (c) {
        const t = (x) => Date.parse(x?.created_at) || 0;
        const first = logObjects('message').filter((m) => m.to === s.name && m.kind === 'ruling' && (m.text ?? '').includes(`[${c.marker}]`)).map(t).sort((a, b) => a - b)[0];
        const launched = logObjects('phase').filter((x) => x.created_by === s.name && x.to === 'starting').map(t).sort((a, b) => b - a)[0] ?? 0;
        const since = first ? Math.max(first, launched) : 0;
        if (since && now - since >= PARK_SETTLE_MS) {
          const gone = /^no tmux (session|window)/.test(resolvePane(tmuxTarget(s.name)).problem ?? '');
          const next = gone
            ? `its window is gone (a restart), so a ruling can't reach it: start it to park, ${s.role} ${s.id} --resume --force, then goal park-sessions ${target} --again (it commits its WIP, writes a handoff naming the questions it waits on, and parks)`
            : `look at its window, then send the ruling again: goal park-sessions ${target} --again (it commits its WIP, writes a handoff naming the questions it waits on, and parks; it resumes from the handoff once they're answered)`;
          add('medium', 'park-unsettled', s.name, `told to park ${Math.floor((now - since) / 60000)} min ago (${causeWords(c)}) and still ${lastPhaseOf(s.name)?.to ?? 'running'}: a park doesn't wait on a reply or an owner answer`, next);
        }
      }
    }
    if (parkedNow && ['run', 'drain'].includes(mode) && !draining()) add('medium', 'parked-under-run', s.name, `parked, and its goal is ${holdWords(mode)} again`, `${s.role} ${s.id} --resume${mode === 'drain' ? ' (a draining goal finishes what it started)' : ''}`);
  }
  const ts = tickets();
  const providers = new Map();
  for (const t of ts.values()) for (const c of t.contracts?.provides ?? []) providers.set(c, t.id);
  for (const t of ts.values()) {
    if (!isActive(t) || mergeShaFor(t.id) || ticketMode(t) !== 'run') continue;
    const blockers = [...(t.depends_on ?? []), ...(t.contracts?.consumes ?? []).map((c) => providers.get(c)).filter(Boolean)].filter((d) => ts.has(d) && !mergeShaFor(d) && ticketMode(ts.get(d)) !== 'run');
    if (blockers.length) add('medium', 'blocked-by-goal-hold', t.id, `waits on ${blockers.map((d) => `${d} (its goal is ${holdWords(ticketMode(ts.get(d)))})`).join(', ')}`, 'ask the owner whether to run the goal it waits on, or re-plan the dependency');
  }
  for (const g of holdableGoals()) {
    const v = holdView(g);
    const name = isUpkeep(g) ? 'upkeep' : g.id;
    if (v.state === 'drained' && !v.fleet) add('low', 'goal-drained', name, `${isUpkeep(g) ? 'Upkeep' : `"${g.title}"`} has finished its in-flight work`, `leave it drained, or run it again (goal hold ${name} run${v.by === 'owner' ? ' --owner: the owner set it' : ''})`);
    const days = v.since ? (now - Date.parse(v.since)) / 86400000 : 0;
    if (v.mode === 'park' && !v.fleet && days >= (settings.hold_review_days ?? 14)) add('low', 'held-long', name, `parked for ${Math.floor(days)} days${v.reason ? ` (${v.reason})` : ''}`, 'ask the owner whether to run it again or let it go (an owner-decision question)');
  }
}
export function notSchedulable(t) {
  if (workerState(t.id)?.phase === 'parked') return 'parked';
  const b = ticketBranchRef(t.id);
  if (b && ticketReviews(t.id, { ref: b }).some((r) => r.stage === 'final')) return 'in review';
  // a ticket in a repo this machine can't read waits; link-unreachable says how to fix it
  const name = repoOfTicketLink(t);
  if (!repoReadable(name)) return 'repo unreachable';
  if (coverageGap(name, repo(name))) return 'unowned files';
  return null;
}
// A cap setting as a number to compare against: null, absent or not a positive number is no cap.
export const capOf = (v) => (typeof v === 'number' && v > 0 ? v : Infinity);
export const capWords = (v) => (Number.isFinite(capOf(v)) ? String(v) : 'no cap');
// The running tickets whose touches overlap t's in the same repo: t waits for them to merge. D4
// usually orders such tickets already; touches widened after planning can still collide.
export function overlapsActive(t, activeIds, ts) {
  const repo = repoOfTicketLink(t);
  const mine = t.touches ?? [];
  return activeIds.filter((id) => { const a = ts.get(id); return a && a.id !== t.id && repoOfTicketLink(a) === repo && (a.touches ?? []).some((ga) => mine.some((gb) => touchesOverlap(ga, gb, repo))); });
}
export function cmdReady() {
  const ts = tickets();
  const prio = effectivePriorities(ts);
  const rows = [];
  const held = [];
  const waiting = [];
  for (const t of ts.values()) {
    // a held ticket goes on to the held list, and a stopped launch is ready again (countsAsWorker)
    if (!isActive(t) || mergeShaFor(t.id) || countsAsWorker(t)) continue;
    const why = notSchedulable(t);
    if (why) { waiting.push({ id: t.id, why }); continue; }
    const depsMerged = (t.depends_on ?? []).every((d) => mergeShaFor(d));
    const gm = ticketMode(t);
    if (gm !== 'run') { waiting.push({ id: t.id, why: `goal ${holdWords(gm)}` }); continue; }
    if (isHeld(t)) { if (depsMerged || flags['plan-ahead']) held.push({ id: t.id, held: t.held }); continue; }
    if (depsMerged || flags['plan-ahead']) {
      const inc = t.kind === 'fix' ? incidentOfTicket(t.id) : null;
      const e = prio.get(t.id);
      const blocks = inheritedPriority(e);
      rows.push({ id: t.id, component: t.component, kind: t.kind, size: t.size, risk: t.risk, mode: depsMerged ? 'build' : 'plan-ahead', priority: e?.priority ?? null, ...(blocks ? { blocks } : {}), ...(inc ? { incident: inc.id, severity: incidentSeverity(inc) } : {}) });
    }
  }
  // a ticket a higher-priority goal waits on takes that goal's place
  rows.sort(readyOrder);
  const s = loadSettings();
  const active = [...ts.values()].filter(countsAsWorker).map((t) => t.id);
  const perComponent = {};
  for (const id of active) perComponent[ts.get(id).component] = (perComponent[ts.get(id).component] ?? 0) + 1;
  // what keeps parallel workers apart: a ready ticket whose touches overlap a running one's waits for
  // it to merge. Only build rows: a plan-ahead ticket specs and plans beside its running dependency.
  for (const r of rows) {
    if (r.mode !== 'build') continue;
    const hits = overlapsActive(ts.get(r.id), active, ts);
    if (hits.length) r.overlaps_active = hits;
  }
  // both caps read the same way: a positive number is a cap, anything else (null, 0) is none
  const capped = (r) => (perComponent[r.component] ?? 0) >= capOf(s.max_active_per_component);
  if (flags.json) return json({ ready: rows, held, waiting, active, active_per_component: perComponent, caps: { max_active_tickets: s.max_active_tickets, max_active_per_component: s.max_active_per_component, incident_slots: s.incident_slots } });
  out(`active workers: ${active.length}/${capWords(s.max_active_tickets)}${s.incident_slots && incidentList().some((p) => p.status !== 'resolved') ? ` (+${s.incident_slots} for fix tickets)` : ''}`);
  for (const r of rows.filter((x) => x.incident)) out(`fix first  ${r.id}  (incident ${r.incident}, severity ${r.severity})`);
  for (const h of held) { const hf = ts.get(h.id).held_for; const hu = ts.get(h.id).held_until; out(`held       ${h.id}  (${h.held}${Array.isArray(hf) && hf.length ? `; for ${hf.join(', ')}` : ''}${hu ? `, until ${hu}` : ''})`); }
  for (const w of waiting) out(`${w.why.padEnd(10)} ${w.id}  (no new worker: ${w.why === 'parked' ? 'resume it with `worker <id> --resume` when its ruling and its goal allow' : w.why.startsWith('goal ') ? 'its goal is on hold (goal hold)' : w.why === 'unowned files' ? 'main has files no component line owns; a chore PR that extends a line clears it (components check)' : w.why === 'repo unreachable' ? 'its repo has no checkout here, or the wrong one (links; link-unreachable)' : 'merge or answer its review'})`);
  if (!rows.length) return out('nothing ready');
  for (const r of rows) out(`${r.mode.padEnd(10)} ${r.id}  (${r.kind}, ${r.size}, ${r.risk})${r.blocks ? `  (blocks p${r.blocks.priority})` : ''}${r.overlaps_active ? `  (touches overlap ${r.overlaps_active.join(', ')}: start it once that merges)` : ''}${capped(r) ? '  (component at cap)' : ''}`);
}

export function cmdWaves() {
  const f = flagStr('feature');
  const sub = new Map([...activeTickets()].filter(([, t]) => !f || t.feature === f));
  if (findCycle(sub)) die('the graph has a cycle; run validate');
  const level = levels(sub);
  const crit = criticalPath(sub);
  const waves = [];
  for (const [id, l] of level) (waves[l] ??= []).push(id);
  if (flags.json) return json({ waves, critical_path: crit.path, critical_weight: crit.len });
  waves.forEach((w, i) => out(`wave ${i + 1} (${w.length}): ${w.sort().join(', ')}`));
  out(`critical path (weight ${crit.len}, S=1 M=2): ${crit.path.join(' -> ')}`);
}

// The sessions with a message to the supervisor still unanswered (a blocked or review request, a
// question): their wait is the supervisor's, whatever else they also wait on.
export function idsAwaitingReply() {
  const msgs = logObjects('message');
  const replied = new Set([...msgs, ...logObjects('question')].map((m) => m.re).filter(Boolean));
  return new Set(msgs.filter((m) => !['info', 'ruling', 'answer'].includes(m.kind) && !replied.has(m.id) && !settledByLanding(m)).flatMap((m) => [m.created_by, m.ticket]).filter(Boolean));
}
export function cmdStatus() {
  const rows = deriveStatus();
  if (flags.json) return json({ generated_at: nowIso(), tickets: rows, reviews: reviewStats() });
  const stale = loadSettings().stale_after_minutes;
  const asking = idsAwaitingReply();
  for (const r of rows) {
    const waiting = ['awaiting-word', 'blocked'].includes(r.phase) && !r.merge_sha;
    // held on purpose or stopped before it ran: never stale (a held one shows its hold, which wins)
    const held = r.held && r.phase !== 'done' && !r.merge_sha ? r.held : null;
    const isStale = r.minutes_silent > stale && !waiting && !['done', 'parked'].includes(r.phase) && !r.merge_sha && !held && !r.not_started;
    // a blocked ticket whose dependencies haven't merged, and that asked the supervisor nothing still
    // unanswered, waits on them, not on the supervisor: say which. awaiting-word is always the
    // supervisor's word to give (a plan-ahead ticket's approval too); so is an unanswered message.
    const deps = r.phase === 'blocked' && !asking.has(r.id) ? (r.depends_on ?? []).filter((d) => !mergeShaFor(d)) : [];
    const waitsOn = deps.length ? ` WAITING ON ${deps.join(', ')} TO MERGE` : ' WAITING ON SUPERVISOR';
    const flag = r.waiting ? ` WAITING ON A ${r.waiting.kind === 'limit' ? 'USAGE LIMIT' : 'PROMPT'}: ${r.waiting.line}` : held ? ` HELD: ${held}` : isStale ? ' STALE' : waiting && r.minutes_silent > stale ? waitsOn : '';
    const shown = r.not_started && !held && !r.waiting ? '  [not started: no window or worktree]' : `  [${r.phase}${r.task ? ` ${r.task}` : ''}, ${r.minutes_silent}m${flag}]`;
    out(`${r.stage.padEnd(18)} ${r.id}${r.phase ? shown : ''}${r.records_landed ? `  [${RECORDS_ONLY_FIX(r.id)}]` : ''}`);
  }
  // each running goal, with its next move under it (next-move@1; moves lists every move)
  for (const m of nextMoves().filter((x) => x.subject.startsWith('goal:') && ['run', 'drain'].includes(goalMode(logGet(x.subject.slice('goal:'.length)))))) {
    out(`${'goal'.padEnd(18)} ${m.subject.slice('goal:'.length)}  ${m.title}`);
    out(`${''.padEnd(18)}   next: ${moveLine(m)}`);
  }
  // the owner's floor (kit-618): status only looks, so it releases no floor, though ownerLineOpen
  // still clears both marks from a pane whose agent exited to a shell (spec, Readers that only look)
  const pane = markedPane(runDir);
  if (pane && ownerLineOpen(pane, { release: false })) out(`supervisor         ${pane}  [owner's line open]`);
  for (const [stage, v] of Object.entries(reviewStats().by_stage)) out(`review ${stage}: first-pass rejection ${v.rejected}/${v.first_passes}${v.last_7d?.first_passes ? `, last ${RECENT_DAYS} days ${v.last_7d.rejected}/${v.last_7d.first_passes}` : ''}`);
}

// Why a hold the supervisor or a planner writes is refused, or null (kit-571; design
// every-wait-names-its-cause-and-every-put, "Writers"): it names what it waits on (--for), each cause
// in a known form (waitCause) and in the log, a date (--until) for a cause the kit can't follow, and
// a date that is a real day from today to 30 days ahead (UTC). kind is ticket or goal, id the held
// thing's, causes trimmed and de-duplicated, until a date or null, whole the --whole words or null.
// Never applied to the owner's holds. Holds already in the log are never read through it.
// A hold may not wait on itself (rule 6): for a ticket, on the ticket, one of its goals or a ticket
// depending on it (transitively); for a goal, on the goal or one of its tickets; nor on a cause whose
// own holds in force (a held ticket's held_for, a draining goal's hold_for) reach one of those.
// A ticket held for a question names why the whole ticket waits (rule 7): whole, else split first.
// ticket is the held ticket (for ticket add, its body: its feature gives its goals).
export function holdCause({ kind, id, causes, until, whole, ticket }) {
  const FORMS = 'a q-… question, a ticket id, goal:<g-id>, chore:<slug>, pr:<link>#<n>, run:<link>:<run id> or external:<words>';
  if (!causes.length) return until ? '--until goes with --for: name what the hold waits on' : `a hold names what it waits on: --for <cause>… (${FORMS})`;
  const today = new Date().toISOString().slice(0, 10);
  const dayAfter = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const latest = dayAfter(today, 30);
  for (const c of causes) {
    const w = waitCause(c);
    if (!w) return `${c} is in no known form (${FORMS})`;
    const there = w.form === 'q' ? logGet(w.id)?.type === 'question'
      : w.form === 'ticket' ? tickets().has(w.id)
      : w.form === 'goal' ? logGet(w.id)?.type === 'goal'
      : w.form === 'chore' ? Boolean(resolveCommit(`refs/heads/chore-${w.id}`) || resolveCommit(`refs/remotes/origin/chore-${w.id}`) || logObjects('act').some((a) => (a.refs ?? []).includes(`chore-${w.id}`)))
      : true;
    if (!there) return w.form === 'chore' ? `${c} is not in the log (no chore-${w.id} branch here or on origin, and no act refs it)` : `${c} is not in the log`;
    if (['pr', 'run', 'external'].includes(w.form) && !until) return `the kit can't follow ${c}: give it --until <date> (today to ${latest}) to look at it again`;
  }
  if (until !== null && until !== undefined) {
    const real = /^\d{4}-\d{2}-\d{2}$/.test(until) && !Number.isNaN(Date.parse(`${until}T00:00:00Z`)) && new Date(Date.parse(`${until}T00:00:00Z`)).toISOString().slice(0, 10) === until;
    if (!real) return `--until ${until} is not a date (YYYY-MM-DD)`;
    if (until < today) return `--until ${until} is in the past (today is ${today}, UTC)`;
    if (until > latest) return `--until ${until} is more than 30 days ahead (at most ${latest})`;
  }
  // rule 6: the subjects a hold of this thing may not wait on, each with why it is the thing itself
  const self = new Map();
  if (kind === 'ticket') {
    self.set(id, null);
    for (const g of ticketGoals(ticket)) self.set(`goal:${g.id}`, `goal:${g.id} is one of its goals`);
    const all = [...tickets().values()];
    const queue = [id];
    const seen = new Set(queue);
    while (queue.length) {
      const at = queue.shift();
      for (const t of all) {
        if (seen.has(t.id) || !(t.depends_on ?? []).includes(at)) continue;
        seen.add(t.id);
        // a superseded or merged dependent waits on nothing (kit-572 reads it resolved or failed)
        if (!isActive(t) || mergeShaFor(t.id)) continue;
        queue.push(t.id);
        self.set(t.id, `${t.id} depends on it`);
      }
    }
  } else {
    self.set(`goal:${id}`, null);
    for (const t of tickets().values()) if (ticketGoals(t).some((g) => g.id === id)) self.set(t.id, `${t.id} is one of its tickets`);
  }
  // a cause as a subject the walk follows: a ticket's id or goal:<id>; anything else ends the walk
  const subject = (c) => { const w = waitCause(c); return w?.form === 'ticket' ? w.id : w?.form === 'goal' ? `goal:${w.id}` : null; };
  const next = (s) => {
    if (s.startsWith('goal:')) { const g = logGet(s.slice(5)); return g?.type === 'goal' && goalMode(g) === 'drain' ? g.hold_for ?? [] : []; }
    // only a hold in force: a superseded or merged ticket's stale held_for is not followed
    const t = tickets().get(s);
    return t && isHeld(t) && isActive(t) && !mergeShaFor(t.id) ? t.held_for ?? [] : [];
  };
  for (const c of causes) {
    const start = subject(c);
    if (!start) continue;
    const from = new Map([[start, null]]);
    const queue = [start];
    while (queue.length) {
      const at = queue.shift();
      if (self.has(at)) {
        const chain = [];
        for (let s = at; s !== null; s = from.get(s)) chain.unshift(s);
        const why = self.get(at);
        return `${c} waits on ${id} itself${chain.length > 1 ? `, through ${chain.join(' -> ')}` : ''}${why ? ` (${why})` : ''}`;
      }
      for (const n of next(at)) {
        const s = subject(n);
        if (s && !from.has(s)) { from.set(s, at); queue.push(s); }
      }
    }
  }
  // rule 7: a question gates only part of a ticket, unless the hold says why it gates the whole
  if (kind === 'ticket' && !whole) {
    const q = causes.find((c) => waitCause(c)?.form === 'q');
    if (q) return `${id} waits on ${q}: hold only the part the answer gates. Split first: ticket add a ticket with the touches and done-whens that don't need the answer, ticket set ${id} to what is left, then hold it; or, if no part can go ahead without the answer, pass --whole "<why>"`;
  }
  return null;
}

// ticket add <id> --json '{…}' | --file f ; ticket set <id> --json '{…}' ; feature add/set likewise.
// ticket hold <id> --reason r --for <cause>… [--until <date>] [--whole w] ; ticket release <id> [--reason r]:
// a hold that names what it waits on (holdCause), and its release, each one ticket line.
export function cmdTicket() {
  const [sub, id] = positional;
  if (sub !== 'hold' && sub !== 'release') return graphEdit('ticket', SCHEMA['x-id'].keyed.ticket);
  if (!id) die(sub === 'hold' ? 'usage: ticket hold <id> --reason "<why>" --for <cause>… [--until <YYYY-MM-DD>] [--whole "<why>"]' : 'usage: ticket release <id> [--reason "<why>"]');
  const by = logWriter();
  const cls = writerClass(by);
  if (!['supervisor', 'planner'].includes(cls)) die('tickets are written by the supervisor or a planner (plan-<feature>)');
  const t = logGet(id);
  if (t?.type !== 'ticket') die(`no ticket ${id}`);
  if (cls === 'planner') {
    const f = planFeature(by);
    if (t.feature !== f) die(`${by} may only change the feature "${f}" and its tickets`);
    // the fold ranks a planner's held below the supervisor's and the owner's: once either wrote it, a
    // planner's line would change nothing (a release with null keeps that rank too)
    const over = readLog().lines.find((l) => l.type === 'ticket' && l.id === id && 'held' in l && ['supervisor', 'owner'].includes(writerClass(l.by)));
    if (over) die(`${id}'s hold was set by the ${writerClass(over.by)}: a planner may not change it`);
  }
  const reason = flagStr('reason')?.trim() || null;
  if (sub === 'release') {
    if (!isHeld(t)) die(`${id} is not held`);
    appendLog({ type: 'ticket', op: 'set', id, held: null, held_for: null, held_until: null }, by);
    if (by === 'supervisor') appendLog({ type: 'act', decision: citing(), class: 'replan-within-feature', what: `released ticket ${id}${reason ? `: ${reason}` : ''}`, refs: [id], reversible: true }, 'supervisor');
    return out(`released ${id}`);
  }
  if (!isActive(t)) die(`${id} is superseded: nothing to hold`);
  if (mergeShaFor(id)) die(`${id} is merged: nothing to hold`);
  if (!reason) die('ticket hold needs --reason "<why>"');
  const causes = [...new Set(listFlag('for').map((c) => String(c).trim()).filter(Boolean))];
  const until = flagStr('until')?.trim() || null;
  // a bare or blank --until is a date given and lost: refused, as goal hold refuses it
  if (flags.until !== undefined && until === null) die('--until needs a date (YYYY-MM-DD)');
  if (flags.whole !== undefined && !flagStr('whole')?.trim()) die('--whole needs the reason no part can go ahead');
  const whole = flagStr('whole')?.trim() || null;
  const why = holdCause({ kind: 'ticket', id, causes, until, whole, ticket: t });
  if (why) die(why);
  const held = whole ? `${reason} (whole: ${whole})` : reason;
  appendLog({ type: 'ticket', op: 'set', id, held, held_for: causes, held_until: until }, by);
  if (by === 'supervisor') appendLog({ type: 'act', decision: citing(), class: 'replan-within-feature', what: `held ticket ${id} for ${causes.join(', ')}`, refs: [id], reversible: true }, 'supervisor');
  out(`held ${id}`);
}
export function cmdFeature() { graphEdit('feature', SCHEMA['x-id'].keyed.feature); }
export function graphEdit(type, idRe) {
  const [sub, id] = positional;
  const by = logWriter();
  if (!['add', 'set', 'show'].includes(sub) || !id) die(`usage: ${type} add <id> --json '{…}' | --file <path>   |   ${type} set <id> --json '{…}'${type === 'ticket' ? ' [--whole "<why>"]' : ''}   |   ${type} show <id>`);
  if (sub === 'show') return json(logGet(id) ?? die(`no ${type} ${id}`));
  if (!new RegExp(idRe).test(id)) die(`${type} id "${id}" must match ${idRe}`);
  if (!['supervisor', 'planner'].includes(writerClass(by))) die(`${type}s are written by the supervisor or a planner (plan-<feature>)`);
  let body;
  try {
    body = JSON.parse(flagStr('json') ?? (flagStr('file') ? fs.readFileSync(flagStr('file'), 'utf8') : die(`${type} ${sub} needs --json or --file`)));
  } catch (e) {
    die(`not valid JSON: ${e.message}`);
  }
  if (sub === 'add' && logGet(id)) die(`${id} exists; use ${type} set`);
  if (type === 'ticket' && body.superseded_by === id) die('a ticket is not superseded by itself');
  // a fix ticket carries out an incident-fix decision that names it
  if (type === 'ticket' && (body.kind === 'fix' || (sub === 'set' && logGet(id)?.kind !== 'fix' && body.kind === 'fix'))) {
    const d = flagStr('decision') ? decisionFor(flagStr('decision')) : null;
    if (!d || d.class !== 'incident-fix' || !(d.refs ?? []).includes(id)) die(`a fix ticket needs --decision <d-…>: an incident-fix decision whose refs name its incident and ${id}`);
    upkeepAllows('an incident fix');
    const inc = (d.refs ?? []).map((r) => logGet(r)).find(isIncident);
    if (inc && d.scope && sevScope(incidentSeverity(inc)) !== d.scope) die(`${d.id} was decided at ${d.scope}; ${inc.id} is ${sevScope(incidentSeverity(inc))} now: decide again`);
  }
  if (sub === 'set' && logGet(id)?.type !== type) die(`no ${type} ${id}`);
  // home and devteam name the repo that holds the kit and the kit's own line
  if (type === 'ticket' && RESERVED_LINKS.includes(body.component)) die(`component "${body.component}" is reserved (reserved: ${RESERVED_LINKS.join(', ')}): home is the repo that holds the kit, devteam the kit's own files; plan the ticket under another component`);
  // a mistyped feature can't be corrected afterwards (a ticket's feature is fixed), so it's caught here
  if (type === 'ticket' && sub === 'add' && by === 'supervisor' && body.feature !== CHORES && logGet(body.feature)?.type !== 'feature') die(`no feature "${body.feature}" (devteam.mjs feature add, or the feature's id as the log has it)`);
  // a held body is held to ticket hold's rule (holdCause): a cause, a date in range, no wait on itself
  if (type === 'ticket') {
    // the fold ranks a planner's held below the supervisor's and the owner's, as ticket hold refuses
    if (writerClass(by) === 'planner' && sub === 'set' && 'held' in body) {
      const over = readLog().lines.find((l) => l.type === 'ticket' && l.id === id && 'held' in l && ['supervisor', 'owner'].includes(writerClass(l.by)));
      if (over) die(`${id}'s hold was set by the ${writerClass(over.by)}: a planner may not change it`);
    }
    if (typeof body.held === 'string' && !body.held.trim()) die('release with null: {"held": null} (a blank held reads released yet keeps its cause)');
    if (typeof body.held === 'string') {
      const t = sub === 'add' ? { ...body, id } : { ...logGet(id), ...body };
      if (!isActive(t)) die(`${id} is superseded: nothing to hold`);
      if (mergeShaFor(id)) die(`${id} is merged: nothing to hold`);
      if (body.held_for !== undefined && body.held_for !== null && !Array.isArray(body.held_for)) die('held_for is a list of causes');
      body.held_for = [...new Set((body.held_for ?? []).map((c) => String(c).trim()).filter(Boolean))];
      if (typeof body.held_until === 'string' && !body.held_until.trim()) die('--until needs a date (YYYY-MM-DD)');
      body.held_until = typeof body.held_until === 'string' ? body.held_until.trim() : body.held_until ?? null;
      if (flags.whole !== undefined && !flagStr('whole')?.trim()) die('--whole needs the reason no part can go ahead');
      const whole = flagStr('whole')?.trim() || null;
      const why = holdCause({ kind: 'ticket', id, causes: body.held_for, until: body.held_until, whole, ticket: t });
      if (why) die(body.held_for.length ? why : `${why}; or ticket hold ${id} --for <cause>… --reason "<why>"`);
      if (whole) body.held = `${body.held} (whole: ${whole})`;
    } else if ((body.held_for ?? null) !== null || (body.held_until ?? null) !== null) {
      die('held_for and held_until go with held: ticket hold <id> --reason "<why>" --for <cause>…');
    } else if (body.held === null) {
      body.held_for ??= null;
      body.held_until ??= null;
    }
  }
  const line = appendLog({ ...body, type, id, op: sub === 'add' ? 'new' : 'set' }, by);
  if (by === 'supervisor') appendLog({ type: 'act', decision: citing(), class: sub === 'add' ? 'add-ticket' : 'replan-within-feature', what: `${sub === 'add' ? 'added' : 'changed'} ${type} ${id}${sub === 'set' ? ` (${Object.keys(body).join(', ')})` : ''}`, refs: [id], reversible: true }, 'supervisor');
  out(`${sub === 'add' ? 'added' : 'updated'} ${line.id}`);
}

// ===== 6. review records and the definition of done =====

