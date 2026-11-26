/* imports start */
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { CHORES } from './settings.mjs';
import { CLASS_WORDS } from './links.mjs';
import { ENVELOPE } from './log.mjs';
import { FILES_MAX } from './hub/operator.mjs';
import { GOAL_MET_CHOICES } from './goals.mjs';
import { IMPACT_WORDS } from './log-sync.mjs';
import { LINK_KINDS } from './links.mjs';
import { OPERATOR_THREAD_ID } from './hub/operator.mjs';
import { OWNER_ASKABLE } from './settings.mjs';
import { PUBLIC_PROJECT } from './artifact-notes.mjs';
import { RECENT_DAYS } from './reviews.mjs';
import { RUNG_PLAIN } from './links.mjs';
import { SETTINGS_DEFAULTS } from './settings.mjs';
import { SET_ASIDE_REFS } from './questions.mjs';
import { THREAD_TITLE_MAX } from './threads.mjs';
import { TURN_ENCODED_MAX } from './threads.mjs';
import { TURN_MAX } from './threads.mjs';
import { UNSAFE_TEXT } from './links.mjs';
import { WORKTREE } from './repos.mjs';
import { actAuthority } from './trust.mjs';
import { activeTickets } from './graph.mjs';
import { allArtifacts } from './artifact-notes.mjs';
import { appendLog } from './log-sync.mjs';
import { asList } from './base.mjs';
import { autonomyData } from './scores.mjs';
import { awarenessData } from './scores.mjs';
import { byTime } from './log-sync.mjs';
import { calls } from './log-sync.mjs';
import { canonical } from './settings.mjs';
import { capOf } from './holds.mjs';
import { className } from './links.mjs';
import { collectMetrics } from './metrics.mjs';
import { collectRoadmap } from './goals.mjs';
import { command } from './base.mjs';
import { correctionOf } from './log-sync.mjs';
import { countsAsWorker } from './graph.mjs';
import { covered } from './observe.mjs';
import { criticalPath } from './graph.mjs';
import { currentMilestone } from './goals.mjs';
import { currentReadings } from './goals.mjs';
import { decisionRecords } from './trust.mjs';
import { deriveStatus } from './panes.mjs';
import { die } from './base.mjs';
import { drainReason } from './fleet.mjs';
import { draining } from './fleet.mjs';
import { effectivePriorities } from './holds.mjs';
import { efficiencyData } from './metrics.mjs';
import { encodedBytes } from './threads.mjs';
import { exteriorDashboard } from './world-model.mjs';
import { exteriorDoc } from './world-model.mjs';
import { exteriorOnMain } from './world-model.mjs';
import { factsRepo } from './repos.mjs';
import { features } from './graph.mjs';
import { fileURLToPath } from 'node:url';
import { findCycle } from './graph.mjs';
import { fitRefs } from './questions.mjs';
import { flagStr } from './base.mjs';
import { flags } from './base.mjs';
import { fleetMode } from './holds.mjs';
import { fleetOpInForce } from './holds.mjs';
import { gitReadCache } from './base.mjs';
import { goalAtTarget } from './goals.mjs';
import { goalCheck } from './goals.mjs';
import { goalFeatures } from './goals.mjs';
import { goalMetBasis } from './goals.mjs';
import { goalMode } from './holds.mjs';
import { goalReadings } from './goals.mjs';
import { goalView } from './goals.mjs';
import { handledMessages } from './log-sync.mjs';
import { heldByMap } from './questions.mjs';
import { holdView } from './holds.mjs';
import { homeRecordsRef } from './repos.mjs';
import { hrefOf } from './lineage.mjs';
import { incidentDebt } from './observe.mjs';
import { incidentList } from './sensors.mjs';
import { incidentSeverity } from './sensors.mjs';
import { incidentView } from './sensors.mjs';
import { isActive } from './graph.mjs';
import { isHeld } from './graph.mjs';
import { isIncident } from './sensors.mjs';
import { isObj } from './artifact-notes.mjs';
import { isUpkeep } from './holds.mjs';
import { json } from './base.mjs';
import { kitVersion } from './lineage.mjs';
import { ladder } from './links.mjs';
import { lastPhaseOf } from './fleet.mjs';
import { latestOwnerSetting } from './sessions.mjs';
import { learningRecords } from './scores.mjs';
import { levels } from './graph.mjs';
import { liveSessions } from './holds.mjs';
import { loadSettings } from './settings.mjs';
import { logGet } from './log-sync.mjs';
import { logObjects } from './log-sync.mjs';
import { mainRef } from './log.mjs';
import { mainRoot } from './state.mjs';
import { measureOf } from './goals.mjs';
import { median } from './base.mjs';
import { memo } from './graph.mjs';
import { memoryFull } from './hub/operator.mjs';
import { mergeShaFor } from './repos.mjs';
import { mergedAt } from './repos.mjs';
import { notSchedulable } from './holds.mjs';
import { nowIso } from './base.mjs';
import { operatorSubjectProblem } from './hub/operator.mjs';
import { orientClusters } from './observe.mjs';
import { orientationDebt } from './observe.mjs';
import { out } from './base.mjs';
import { overlapsActive } from './holds.mjs';
import { ownerWriter } from './log.mjs';
import { placeOf } from './lineage.mjs';
import { planners } from './panes.mjs';
import { positional } from './base.mjs';
import { previewHelloRow } from './previews.mjs';
import { previewUpHere } from './previews.mjs';
import { publishRecords } from './artifact-notes.mjs';
import { publishedView } from './artifact-notes.mjs';
import { questions } from './log-sync.mjs';
import { rankQuestions } from './questions.mjs';
import { reached } from './goals.mjs';
import { readLog } from './log-sync.mjs';
import { readPreviews } from './previews.mjs';
import { readText } from './base.mjs';
import { readyOrder } from './holds.mjs';
import { recordsInHomeId } from './repos.mjs';
import { recurringChores } from './chores.mjs';
import { recurringDashboard } from './chores.mjs';
import { releaseOf } from './repos.mjs';
import { releasedIn } from './repos.mjs';
import { repo } from './repos.mjs';
import { repoOfTicketLink } from './repos.mjs';
import { rest } from './base.mjs';
import { retroDue } from './goals.mjs';
import { reviewMemo } from './reviews.mjs';
import { reviewPasses } from './reviews.mjs';
import { reviewReads } from './reviews.mjs';
import { runDir } from './state.mjs';
import { runPath } from './settings.mjs';
import { rungFor } from './trust.mjs';
import { sameAnswer } from './questions.mjs';
import { selfDashboard } from './self-model.mjs';
import { sensorFeed } from './sensors.mjs';
import { sensorIgnores } from './sensors.mjs';
import { sensorStatus } from './sensors.mjs';
import { sessionGoals } from './holds.mjs';
import { settingsAll } from './settings.mjs';
import { settingsAt } from './settings.mjs';
import { settledByLanding } from './sessions.mjs';
import { spawn } from 'node:child_process';
import { stoppedLaunch } from './graph.mjs';
import { supervisorOnly } from './log.mjs';
import { threadCounts } from './threads.mjs';
import { ticketBranchRef } from './repos.mjs';
import { ticketGoals } from './holds.mjs';
import { ticketMode } from './holds.mjs';
import { ticketReviews } from './reviews.mjs';
import { tickets } from './graph.mjs';
import { trustTable } from './trust.mjs';
import { upkeepDays } from './goals.mjs';
import { upkeepGoal } from './log-sync.mjs';
import { upkeepOrVirtual } from './holds.mjs';
import { warn } from './base.mjs';
import { weekStartOf } from './scores.mjs';
import { weight } from './graph.mjs';
import { withClassName } from './links.mjs';
import { withOoda } from './questions.mjs';
import { workerState } from './graph.mjs';
import { writeJson } from './base.mjs';
import { writerClass } from './log.mjs';
/* imports end */
// ack <finding-kind> <subject> --reason r [--owner]: set a metrics finding aside for
// finding_ack_hours. The subject is the finding's, as metrics prints it.
export function cmdAck() {
  const [kind, ...subj] = positional;
  const subject = subj.join(' ').trim();
  const reason = flagStr('reason');
  if (!kind || !subject || !reason) die('usage: ack <finding-kind> <subject> --reason "<why it can wait>" [--owner]');
  // a worker's or planner's session is never the owner's, whatever DEVTEAM_ROLE says (kit-783): its
  // ack would be recorded as the owner's, and one of a merge commit would never lapse
  const session = ['DEVTEAM_TICKET', 'DEVTEAM_FEATURE'].find((k) => process.env[k]);
  if (flags.owner && session) die(`ack --owner is the owner's: it doesn't run in a worker's or planner's session (${session}=${process.env[session]}); send the supervisor what can wait`);
  const live = collectMetrics(0).findings.find((x) => x.kind === kind && x.subject === subject);
  if (!live) die(`no current finding ${kind} "${subject}" (devteam.mjs metrics lists them)`);
  const by = flags.owner ? ownerWriter().by : (supervisorOnly('ack'), 'supervisor');
  // it cites what it sets aside: the finding's observations (observeFindings'), the newest 40 so the
  // line stays under LINE_MAX; the finding's key, in source_ref, joins the rest
  const key = `metrics:${kind}:${subject}`;
  const refs = logObjects('observation').filter((o) => o.source_key === key && o.detector === 'metrics' && o.created_by === 'supervisor').sort(byTime).slice(-SET_ASIDE_REFS).map((o) => o.id);
  const fields = { type: 'observation', source: 'ack', kind: 'finding-ack', subject: `${kind} ${subject}`, detail: reason, source_ref: key };
  const line = appendLog({ ...fields, refs: fitRefs(fields, refs) }, by);
  // a merge commit's ack never lapses (collectMetrics' lasting(), kit-348)
  const forGood = kind === 'merged-without-merge' && /^[^\s:]+:[0-9a-f]{12}$/.test(subject);
  out(`${line.id}: ${kind} ${subject} set aside ${forGood ? 'for good: a merge commit can\'t change' : `for ${loadSettings().finding_ack_hours}h`}`);
}

// Merged tickets (the last 30 days) rated light (S, normal risk, not high uncertainty) whose results
// say otherwise: over three times the median merged cost per point, three or more final-review passes,
// or an escaped defect that names them. What the loop reads to calibrate ratings (supervisor.md §9).
export function misRated(cycles, ts, ticketUsd, POINTS) {
  const now = Date.now();
  const recent = cycles.filter((c) => now - (mergedAt(c.id) ?? 0) < 30 * 86400000);
  const per = (c) => (ticketUsd[c.id] === undefined ? null : ticketUsd[c.id] / (POINTS[ts.get(c.id)?.size] ?? 1));
  const costs = cycles.map(per).filter((x) => x !== null);
  const med = median(costs);
  const passes = reviewPasses();
  const defects = logObjects('observation').filter((o) => o.kind === 'escaped-defect');
  const out = [];
  for (const c of recent) {
    const t = ts.get(c.id);
    if (!t || t.size !== 'S' || t.risk === 'high' || t.uncertainty === 'high') continue;
    const why = [];
    const p = per(c);
    if (med && p !== null && costs.length >= 5 && p > 3 * med) why.push(`cost ${(p / med).toFixed(1)}x the median per point`);
    if ((passes[c.id] ?? 0) >= 3) why.push(`${passes[c.id]} final-review passes`);
    if (defects.some((o) => (o.refs ?? []).includes(c.id) || String(o.subject ?? '') === c.id)) why.push('an escaped defect traced to it');
    if (why.length) out.push({ id: c.id, rated: `S, ${t.risk ?? 'normal'}, ${t.uncertainty ?? 'low'} uncertainty`, why });
  }
  return out;
}
export const EFFICIENCY_WAIT = ['awaiting-word', 'blocked', 'parked', 'starting'];
// How much evidence a finding needs before it speaks: 5 merged tickets for waiting-heavy, 10 first
// passes at a stage for review-churn. The environment can lower them, for tests and a tiny project
// (DEVTEAM_EFFICIENCY_MIN_MERGED, DEVTEAM_CHURN_MIN_PASSES; named in supervisor.md §3, Orient).
// review-churn is the all-time, evidence-floored sibling of the dashboard's weekly tighter-specs
// suggestion (efficiencySuggestions): the same rejections, a longer window and a higher bar.
export const envInt = (k, d) => { const n = Number(process.env[k]); return Number.isInteger(n) && n > 0 ? n : d; };
export const EFF_MIN_MERGED = () => envInt('DEVTEAM_EFFICIENCY_MIN_MERGED', 5);
export const EFF_MIN_PASSES = () => envInt('DEVTEAM_CHURN_MIN_PASSES', 10);
export const TIER_MIN_TICKETS = () => envInt('DEVTEAM_TIER_MIN_TICKETS', 3);
export const EFFICIENCY_OVERHEAD = ['supervisor', 'planning', 'review'];
export function efficiencyOf(m) {
  const split = (o) => {
    const rows = Object.entries(o ?? {}).filter(([k]) => !EFFICIENCY_OVERHEAD.includes(k));
    const total = rows.reduce((a, [, v]) => a + v, 0);
    const waiting = rows.filter(([k]) => EFFICIENCY_WAIT.includes(k)).reduce((a, [, v]) => a + v, 0);
    return { total, waiting, share: total ? waiting / total : null };
  };
  const h = split(m.phase_hours);
  const u = split(m.phase_usd);
  const points = m.cost?.per_point?.points ?? null;
  const rej = (stage) => m.reviews?.by_stage?.[stage]?.rejection_rate ?? null;
  const pct = (x) => (x === null ? null : Math.round(100 * x));
  return {
    wait_hours_pct: pct(h.share),
    wait_usd_pct: pct(u.share),
    hours_per_point: points && m.cycle_hours_total !== undefined ? +(m.cycle_hours_total / points).toFixed(1) : null,
    usd_per_point: m.cost?.per_point?.usd_per_point ?? null,
    first_pass_rejection: { spec: rej('spec'), plan: rej('plan'), final: rej('final') },
    mis_rated: m.mis_rated ?? [],
  };
}

export function cmdMetrics() {
  const since = flagStr('since') ? Date.parse(flagStr('since')) : 0;
  if (Number.isNaN(since)) die('--since must be a date');
  const m = collectMetrics(since, since);
  if (flags.json) return json(m);
  const kv = (o, unit = '') => Object.entries(o).map(([k, v]) => `${k} ${unit}${v}`).join(', ') || '-';
  // stages in the order work meets them: by_stage's own order follows an unsorted folder listing
  const STAGE_ORDER = ['design', 'graph', 'spec', 'plan', 'contract', 'task', 'final'];
  const rank = (s) => (STAGE_ORDER.includes(s) ? STAGE_ORDER.indexOf(s) : STAGE_ORDER.length);
  const categoryStages = Object.entries(m.reviews.by_stage).filter(([, v]) => v.top_blocking_categories?.length).sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  out([
    `since: ${m.since ?? 'the beginning'}`,
    `tickets merged: ${m.tickets_merged}; median cycle ${m.cycle_hours.median ?? '-'}h; slowest ${m.cycle_hours.slowest.map((c) => `${c.id} ${c.hours}h`).join(', ') || '-'}`,
    `time by phase (h): ${kv(m.phase_hours)}`,
    `efficiency: waiting ${m.efficiency.wait_hours_pct ?? '-'}% of ticket hours, ${m.efficiency.wait_usd_pct ?? '-'}% of ticket dollars; ${m.efficiency.hours_per_point ?? '-'}h and $${m.efficiency.usd_per_point ?? '-'} per point; mis-rated ${m.efficiency.mis_rated.length}`,
    `cost by phase: ${kv(m.phase_usd, '$')}; total $${m.cost.usd_total}; per merged ticket ${m.cost.usd_per_merged_ticket === null ? '-' : `$${m.cost.usd_per_merged_ticket}`}`,
    `gates (median): ${m.gates.gates.map((g) => `${g.gate} ${g.median_seconds}s (fail ${Math.round(g.fail_rate * 100)}%)`).join(', ') || '-'}`,
    `first-pass rejection: ${Object.entries(m.reviews.by_stage).map(([k, v]) => `${k} ${v.rejected}/${v.first_passes}${v.last_7d?.first_passes ? ` (last ${RECENT_DAYS} days ${v.last_7d.rejected}/${v.last_7d.first_passes})` : ''}${m.since && v.undated ? ` (${v.undated} undated left out)` : ''}`).join(', ') || '-'}; false positives ${m.reviews.false_positive_rate ?? '-'}`,
    `blocking categories (first passes): ${categoryStages.map(([k, v]) => `${k} ${v.top_blocking_categories.slice(0, 3).map((c) => `${c.category} ${c.count}`).join(', ')}`).join('; ') || '-'}`,
    `messages: ${m.messages.still_open} of ${m.messages.expecting_reply} awaiting reply; median reply ${m.messages.median_reply_minutes ?? '-'} min`,
    `owner questions: ${m.owner_questions.open} open of ${m.owner_questions.asked}; median answer ${m.owner_questions.median_answer_hours ?? '-'}h; answer rate (14d) ${m.owner_questions.answer_rate_14d ?? '-'}`,
    `escaped defects: ${m.escaped_defects}`,
    '',
    m.findings.length ? 'findings:' : 'findings: none',
    ...m.findings.map((x) => `  [${x.severity}] ${x.kind}: ${x.subject} (${x.detail}) -> ${x.suggestion}`),
  ].join('\n'));
}

// What a hold waits on, read from one entry of a ticket's held_for or a goal's hold_for (design
// every-wait-names-its-cause-and-every-put, the cause table): { form, id, state, since, holder_subject },
// or null for a string in no known form (until:<date> among them: the review date is held_until or
// hold_until, never a cause). form is q | ticket | chore | goal | pr | run | external; id the question's,
// ticket's or goal's id, the chore's slug, <link>#<n>, <link>:<run id>, or the external words. state is
// open | resolved | failed and since when it became so (null while open); here every cause is open,
// and kit-572 (the log's forms) and kit-573 (pr: and run:) read the rest. holder_subject is the
// next-move subject a hold's move is copied from, its via (ticket:, chore:, goal:), null for a question (its
// move is the owner's answer) and for pr:, run: and external:. Whether the kit can follow a cause, and
// so whether it needs a date, is read from form (q, ticket, chore, goal), never from holder_subject.
// Self-contained: its patterns copy the log schema's ids, LINK_ID and choreSlug's slug.
export function waitCause(ref) {
  const ID = /^[a-z]-\d{8}-\d{9}-[a-z0-9]+(-[a-z0-9]+)*$/;
  const TICKET = /^[a-z][a-z0-9]*(-[a-z0-9]+)*-[0-9]{2,}-[a-z0-9]+(-[a-z0-9]+)*$/;
  const LINK = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
  const SLUG = /^[a-z0-9]+([.-][a-z0-9]+)*$/;
  if (typeof ref !== 'string') return null;
  const cause = (form, id, holder_subject = null) => ({ form, id, state: 'open', since: null, holder_subject });
  if (ID.test(ref)) return ref.startsWith('q-') ? cause('q', ref) : null;
  // shaped like a log id (a letter, a date, a time) but not one: never read as a ticket id
  if (/^[a-z]-\d{8}-\d{9}/.test(ref)) return null;
  const i = ref.indexOf(':');
  const [kind, rest] = i === -1 ? [null, ref] : [ref.slice(0, i), ref.slice(i + 1)];
  if (kind === 'chore') return SLUG.test(rest) && !/\.lock$/.test(rest) ? cause('chore', rest, `chore:${rest}`) : null;
  if (kind === 'goal') return ID.test(rest) && rest.startsWith('g-') ? cause('goal', rest, `goal:${rest}`) : null;
  if (kind === 'pr') {
    const m = rest.match(/^([^#]+)#([1-9]\d*)$/);
    return m && LINK.test(m[1]) ? cause('pr', rest) : null;
  }
  if (kind === 'run') {
    const m = rest.match(/^([^:]+):([1-9]\d*)$/);
    return m && LINK.test(m[1]) ? cause('run', rest) : null;
  }
  if (kind === 'external') return rest.length <= 200 && /^\S(?:.*\S)?$/.test(rest) && !/[\r\n\v\f\u0085\u2028\u2029]/.test(rest) ? cause('external', rest) : null;
  if (kind === null && TICKET.test(ref)) return cause('ticket', ref, `ticket:${ref}`);
  return null;
}
/* next-moves start */
// The next-move table. For every running goal, active ticket, planner and open chore branch, exactly
// one next move: what has to happen, who holds it and since when. Its rows (G goals, T tickets, P
// planners, C chores) are tried in order and the first that matches wins. The kit never makes a move
// itself; it names it.
//
// The contract next-move@1. A move is one object:
//   subject     "goal:<g-id>" | "ticket:<id>" | "planner:<feature>" | "chore:<slug>", and the waits goal's
//               "follow-up:<o-id>" (a put-off note), "thread:<t-id>" (a thread bound to work),
//               "answer:<q-id>" (an owner's answer to carry out), "duty:<name>" (a duty fallen due, e.g.
//               duty:retro) and "record:<id>" (a loop record: a corrected act, a trial with no outcome)
//   move        the row's key, kebab-case (e.g. ask-goal-met)
//   words       a plain sentence for the owner (e.g. "Ask you whether it is met")
//   holder      owner | supervisor | planner | worker | nobody
//   ref         null, or { kind, id, url }: kind q | m | ticket | goal | chore | pr | o | t | a; id the
//               question's, message's, ticket's, goal's or chore branch's id as a string, o a follow-up
//               observation's id, t a thread's id, a an act's id, or for a pr the PR number as an
//               integer; url the PR's URL on a pr ref, absent on every other kind
//   title       the subject's own title: the goal's, the ticket's, the planner's feature's, a chore's
//               --what or its tip commit's subject
//   since       ISO time the move began (never stored: each row names its source)
//   command     the supervisor's command for it, or null
//   covered_by  [ { kind, subject } ]: the findings that already cover it, subject a finding subject or
//               "*" (any subject); [] when none
//   quiet       null | hold | drain | queue: it waits on purpose (a park or let-go hold, a drain, the
//               queue for a slot or memory); shown, never raises a finding
//   via         null, or "ticket:<id>" | "planner:<feature>" | "goal:<g-id>" | "chore:<slug>": a copied
//               move (a goal's lead ticket's, planner's, chore's or plan_after goal's; a ticket's
//               dependency's); it shows its source's flag, and findings are raised only on the source
//   flag        null | owed | stalled | none, set by age and holder alone (a covering finding never
//               clears it): owed when the supervisor holds it past next_move_owed_minutes; a chore with
//               no PR yet (C4) is never owed, it goes straight to stalled; stalled when unchanged past
//               next_move_stall_hours, whatever the holder; none for the rows with no next move (G20,
//               T14), held by nobody; null otherwise, and always null when quiet
//   rung        0 | 1 | 2 on the age ladder: 0 fresh, 1 owed, 2 stuck (stalled, or its finding or a
//               covering finding acked three times on one subject since `since`); so an owed move is at
//               rung 1 or 2, a stalled one at 2, a quiet one stays 0
//   chore       on a chore: move only (absent on every other): { branch: "chore-<slug>", ahead: the
//               commits main lacks, pr: null | { number, url }, for: [ the refs from chore start --for ] }
//   wait        on a ticket move whose hold names its causes (held_for) only, absent on every other:
//               { "causes": [ { "ref", "words", "state" } ], "until": null | "<YYYY-MM-DD>" }: each cause
//               as held_for gives it (ref), in words, and its state open | resolved | failed
//               (waitCause()); until the hold's held_until. A page shows what the hold waits on from it
//               without a second read
// Every field but chore and wait is always present; ref, command, quiet, via and flag carry null,
// never go missing.
//
// Its five places:
//   1. moves --json: { "next_move": 1, "moves": [ … ] }
//   2. /api/data: next_moves, the same array
//   3. each goal view (goal show, goal list --json, /api/data ooda.goals[]): next_move, its own move or null;
//      goal show of the Upkeep goal isn't a goal view and has no next_move (chore moves carry its work)
//   4. the hub's cache, run/cache/next-moves.json: { "next_move": 1, "at": "<ISO>", "moves": [ … ] }, the
//      running goals' moves only (no chore moves)
//   5. hello's pulse.next: one move (the top flagged, else top-priority, running goal's), or null
// Additive changes keep @1; a renamed or removed field, or a changed meaning, bumps it. Fixtures:
// test/fixtures/next-moves/, and for the waits goal's additions (its subjects, ref kinds o, t and a, and
// wait) test/fixtures/waits/. via gains no values: the new rows copy moves from tickets and chores.
// The closed lists, one per line (test/next-moves.test.mjs reads them):
// values fields: subject | move | words | holder | ref | title | since | command | covered_by | quiet | via | flag | rung | chore | wait
// values subject: goal: | ticket: | planner: | chore: | follow-up: | thread: | answer: | duty: | record:
// values holder: owner | supervisor | planner | worker | nobody
// values ref.kind: q | m | ticket | goal | chore | pr | o | t | a
// values quiet: null | hold | drain | queue
// values via: null | ticket: | planner: | goal: | chore:
// values flag: null | owed | stalled | none
// values rung: 0 | 1 | 2
// values chore: branch | ahead | pr | for
// values wait.state: open | resolved | failed
export function nextMoves() {
  movesReadAt();
  return memo('next-moves', () => [...goalMovesNow(), ...ticketMoves().values(), ...planners().map(plannerMove)]);
}
// The two thresholds, as numbers: a setting that isn't a number of zero or more counts as its default.
export const moveSetting = (key) => { const v = loadSettings()[key]; return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : SETTINGS_DEFAULTS[key]; };
export const isoOf = (t) => new Date(t).toISOString();
// A move's flag and rung, by its holder and age alone: none for no next move, nothing while quiet,
// stalled past next_move_stall_hours whoever holds it, owed past next_move_owed_minutes when the
// supervisor does. Rung 2 from acks is the age ladder's (kit-297).
export function moveFlag(m) {
  if (m.quiet) return { flag: null, rung: 0 };
  if (m.holder === 'nobody') return { flag: 'none', rung: 0 };
  const age = Date.now() - Date.parse(m.since);
  if (age > moveSetting('next_move_stall_hours') * 3600000) return { flag: 'stalled', rung: 2 };
  if (m.holder === 'supervisor' && age > moveSetting('next_move_owed_minutes') * 60000) return { flag: 'owed', rung: 1 };
  return { flag: null, rung: 0 };
}
export function newMove(subject, title, o) {
  const m = { subject, move: o.move, words: o.words, holder: o.holder, ref: o.ref ?? null, title, since: isoOf(o.since), command: o.command ?? null, covered_by: o.covered_by ?? [], quiet: o.quiet ?? null, via: null, flag: null, rung: 0 };
  const f = moveFlag(m);
  // a row that is never owed (T2b) is only ever stalled
  return Object.assign(m, o.neverOwed && f.flag === 'owed' ? { flag: null, rung: 0 } : f);
}
// A copied move: its source's holder, since, flag and rung (and what it is, unless the row says),
// on this subject, via the source.
export const copiedMove = (subject, title, src, o = {}) => ({ ...src, ...o, subject, title, via: src.subject });
export const qRef = (q) => ({ kind: 'q', id: q.id });
export const askedMove = (q) => ({ move: 'answer-question', words: `Answer: ${q.question}`, holder: 'owner', ref: qRef(q), since: q.asked_at, covered_by: [{ kind: 'owner-question-waiting', subject: q.id }] });
export const PLANNING_COVER = [{ kind: 'idle-planning', subject: '*' }, { kind: 'memory-full', subject: '*' }];
// goal-at-target's quiet rule: a goal-met question about the goal open, or one answered after this
// reading, or a No about the same value and basis, which stands until the value moves or the goal
// changes. collectMetrics' finding and the goal rows (G12) both ask it.
export function goalAtTargetQuiet(g, r, qs = questions()) {
  const basis = goalMetBasis(g);
  return qs.some((q) => q.class === 'goal-met' && q.goal === g.id && (q.status === 'open' || (q.status === 'answered' && (q.asked_at > r.created_at || (q.met?.basis === basis && q.met?.reading?.value === r.measure.value && !sameAnswer(q.answer, GOAL_MET_CHOICES[0].label))))));
}
// A goal whose design waits on another goal's (plan_after) waits while that one is a draft (a goal
// let go, or one that doesn't exist, holds nothing back).
export const planAfterBlockers = (g) => (g.plan_after ?? []).filter((d) => logGet(d.goal)?.type === 'goal' && (logGet(d.goal).status ?? 'draft') === 'draft');
// A ready goal whose current milestone has a precondition no feature covers (or no feature at all).
export function needsFeatures(g, c = goalCheck(g)) {
  return g.status === 'ready' && c.coverage.some((x) => x.includes('has no feature') || x.startsWith('no feature names'));
}
// The goals that need planning with nobody planning them: a fully defined draft goal with no open
// question, or a ready goal that needsFeatures, with no planner on it, running, and waiting on no
// other goal's design; highest priority first. full: the planner slots are all taken.
export function idlePlanningGoals(ps = planners()) {
  const busy = new Set(ps.flatMap((p) => p.goals));
  const waiting = logObjects('goal').filter((g) => {
    if (busy.has(g.id) || ['met', 'abandoned'].includes(g.status) || planAfterBlockers(g).length || goalMode(g) !== 'run') return false;
    const c = goalCheck(g);
    if ((g.status ?? 'draft') === 'draft') return !c.definition.length && !questions().some((q) => q.goal === g.id && q.status === 'open');
    return needsFeatures(g, c);
  }).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  const cap = loadSettings().max_active_planners;
  return { waiting, cap, full: cap != null && ps.length >= cap };
}
// The goal rows, G1 to G20, first match wins (designs/every-goal-always-has-a-next-move.md). G4b and
// G4c are kit-298's; a chore started --for a goal (G16) is kit-293's; until kit-289's ticket rows,
// G16 names the first unmerged ticket, in progress.
export function goalMovesNow() {
  const qs = questions();
  const ps = planners();
  const pMoves = new Map(ps.map((p) => [p.feature, plannerMove(p)]));
  const idle = idlePlanningGoals(ps);
  let memFull;
  const queued = () => idle.full || !!(memFull ??= memoryFull());
  const goals = logObjects('goal').filter((g) => !isUpkeep(g));
  const done = new Map();
  const visiting = new Set();
  const moveOf = (g) => {
    if (!done.has(g.id)) { visiting.add(g.id); done.set(g.id, goalRow(g)); visiting.delete(g.id); }
    return done.get(g.id);
  };
  // the plan_after chain from g comes back to g
  const loops = (g) => { const seen = new Set(); const walk = (x) => planAfterBlockers(x).some((d) => d.goal === g.id || (!seen.has(d.goal) && (seen.add(d.goal), walk(logGet(d.goal))))); return walk(g); };
  function goalRow(g) {
    const status = g.status ?? 'draft';
    const id = g.id;
    const title = g.title ?? id;
    const at = (o) => newMove(`goal:${id}`, title, o);
    const lastChange = (g.updates ?? []).at(-1)?.at ?? g.created_at;
    // the log's schema allows draft, ready, met and abandoned only (a line off it isn't folded), so
    // what isn't met or abandoned is draft or ready
    if (['met', 'abandoned'].includes(status)) return null; // G1
    const mode = goalMode(g);
    if (mode !== 'run') {
      const hv = holdView(g);
      const holder = hv.by === 'owner' ? 'owner' : 'supervisor';
      if (mode === 'park' || mode === 'let-go') return at({ move: mode === 'park' ? 'parked' : 'let-go', words: mode === 'let-go' ? 'Let go' : holder === 'owner' ? 'Parked by you' : 'Parked', holder, quiet: 'hold', since: hv.since ?? lastChange }); // G2
      if (hv.state === 'drained') return at({ move: 'draining', words: 'Draining: nothing new starts', holder, quiet: 'drain', since: hv.since ?? lastChange }); // G3
    }
    // a fleet drain (the drain act, draining()) with nothing of the goal's running
    const fleetDrain = mode === 'run' ? draining() : null;
    if (fleetDrain && !liveSessions().some((x) => sessionGoals(x.name).some((y) => y.id === id))) return at({ move: 'draining', words: 'Draining: nothing new starts', holder: 'supervisor', quiet: 'drain', since: fleetDrain.created_at }); // G3, a fleet drain
    const open = qs.filter((q) => q.goal === id && q.status === 'open').sort((a, b) => a.asked_at.localeCompare(b.asked_at));
    const met = open.find((q) => q.class === 'goal-met');
    if (met) return at({ ...askedMove(met), move: 'answer-goal-met', words: 'Answer: is it met?' }); // G4
    const draft = status === 'draft';
    if (draft && open.length) return at(askedMove(open[0])); // G5
    if (draft && goalCheck(g).definition.length) return at({ move: 'ask-definition', words: "Ask you what's missing from its definition", holder: 'supervisor', since: lastChange, command: `ask --kind goal-definition --goal ${id} --question "…"` }); // G6
    const mineP = ps.filter((p) => p.goals.includes(id)).sort((a, b) => b.waiting_on_supervisor.length - a.waiting_on_supervisor.length || a.feature.localeCompare(b.feature))[0];
    const verdict = (g.updates ?? []).filter((u) => u.decision).at(-1);
    if (draft && !mineP && verdict?.decision.verdict === 'refine') return at({ move: 'rework-design', words: 'Rework the design with your notes', holder: 'supervisor', since: verdict.at, command: `planner <feature> --goal ${id}` }); // G7
    if (mineP) return copiedMove(`goal:${id}`, title, pMoves.get(mineP.feature)); // G8 (its move is P2), G9
    if (draft) {
      const ahead = planAfterBlockers(g);
      if (ahead.length) {
        if (loops(g)) return at({ move: 'break-plan-after-loop', words: 'Break the plan_after loop', holder: 'supervisor', since: lastChange, command: `goal set ${id} --plan-after <g-id> --reason "…"` }); // G10, a loop
        const a = logGet(ahead[0].goal);
        const src = visiting.has(a.id) ? null : moveOf(a);
        if (src) return copiedMove(`goal:${id}`, title, src, { move: 'waits-for-goal', words: `Waits for ${a.title ?? a.id}'s design`, ref: { kind: 'goal', id: a.id } }); // G10
      }
      // since it became defined: its last change, or the baseline reading that completed it
      const defined = [lastChange, currentReadings(id)[0]?.created_at].filter(Boolean).sort().at(-1);
      return at({ move: 'start-planner', words: 'Start a planner', holder: 'supervisor', quiet: queued() ? 'queue' : null, since: defined, command: `planner <feature> --goal ${id}`, covered_by: PLANNING_COVER }); // G11
    }
    // ready
    const r = goalAtTarget(g);
    const ask = `ask --class goal-met --goal ${id} --recommendation yes`;
    if (r && !goalAtTargetQuiet(g, r, qs)) return at({ move: 'ask-goal-met', words: 'Ask you whether it is met', holder: 'supervisor', since: r.created_at, command: ask, covered_by: [{ kind: 'goal-at-target', subject: id }] }); // G12
    const feats = goalFeatures(id);
    const ts = [...tickets().values()].filter((t) => isActive(t) && feats.includes(t.feature)).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const allMerged = ts.length > 0 && ts.every((t) => mergeShaFor(t.id));
    const lastMerge = allMerged ? isoOf(Math.max(...ts.map((t) => mergedAt(t.id) ?? 0))) : null;
    const m = measureOf(g);
    // a goal-met question withdrawn (or defaulted) since the merge asked nothing: it is asked again.
    // An answered one counts by when it was answered: one asked while the last ticket was in flight
    // and answered after it merged judged the merged work (a No there is G18's, not a re-ask).
    if (allMerged && m.source === 'owner' && !qs.some((q) => q.class === 'goal-met' && q.goal === id && ['open', 'answered'].includes(q.status) && (q.status === 'answered' ? q.answered_at : q.asked_at) > lastMerge)) return at({ move: 'ask-goal-met', words: 'Ask you whether it is met', holder: 'supervisor', since: lastMerge, command: ask, covered_by: [{ kind: 'goal-work-merged', subject: id }] }); // G13
    if (needsFeatures(g)) return at({ move: 'plan-next-features', words: 'Plan the next features', holder: 'supervisor', quiet: mode === 'drain' || fleetDrain ? 'drain' : queued() ? 'queue' : null, since: milestoneSince(g), command: `planner <feature> --goal ${id}`, covered_by: PLANNING_COVER }); // G14
    const bare = feats.find((f) => !ts.some((t) => t.feature === f));
    if (bare) return at({ move: 'plan-tickets', words: `Plan the tickets for ${features().get(bare).title ?? bare}`, holder: 'supervisor', since: features().get(bare).created_at, command: `planner ${bare} --goal ${id}` }); // G15
    const lead = leadTicketMove(ts.filter((t) => !mergeShaFor(t.id)));
    if (lead) return copiedMove(`goal:${id}`, title, lead); // G16
    const read = ['repo', 'prod'].includes(m.source);
    const readings = goalReadings(id);
    const last = readings.at(-1) ?? null;
    if (read && !readings.some((x) => x.created_at > lastMerge)) return at({ move: 'take-reading', words: 'Take a reading', holder: 'supervisor', since: lastMerge, command: `goal reading ${id} --run` }); // G17
    const change = open.find((q) => q.class === 'goal-change' && isObj(q.change) && ('measure' in q.change || 'milestones' in q.change));
    if (change) return at(askedMove(change)); // G17b
    const no = qs.filter((q) => q.class === 'goal-met' && q.goal === id && q.status === 'answered').sort((a, b) => a.answered_at.localeCompare(b.answered_at)).at(-1);
    if (no && !sameAnswer(no.answer, GOAL_MET_CHOICES[0].label)) {
      const note = String(no.answer).includes(' — ') ? String(no.answer).split(' — ').slice(1).join(' — ').trim() : '';
      if (!ts.some((t) => t.created_at > no.answered_at)) return at({ move: 're-plan-after-no', words: `Re-plan: you said it isn't met yet${note ? ` (${note})` : ''}`, holder: 'supervisor', since: no.answered_at }); // G18
      if (read && lastMerge > no.answered_at && last && no.met?.basis === goalMetBasis(g) && no.met?.reading?.value === last.measure.value) return at({ move: 're-plan-or-change-measure', words: "Work merged since your No and the measure hasn't moved: re-plan, or propose a change to the measure", holder: 'supervisor', since: lastMerge, command: `ask --class goal-change --goal ${id} --change '{"measure": …}' --question "…"` }); // G18b
    }
    if (last && (currentMilestone(g) || !reached(g, m.target, last.measure.value))) return at({ move: 're-plan-measure-short', words: "Re-plan: the work merged but the measure didn't move enough", holder: 'supervisor', since: last.created_at }); // G19
    return at({ move: 'no-next-move', words: 'No next move', holder: 'nobody', since: lastChange }); // G20
  }
  return goals.map(moveOf).filter(Boolean);
}
// When a ready goal's current milestone became current: the first reading that reached the one
// before it, else the owner's approval, else when the goal was written.
export function milestoneSince(g) {
  const cur = currentMilestone(g);
  const approved = (g.updates ?? []).filter((u) => u.decision?.verdict === 'approve' || u.status === 'ready').at(-1)?.at ?? g.created_at;
  if (!cur || cur.n === 1) return approved;
  const prev = g.milestones[cur.n - 2];
  return goalReadings(g.id).find((r) => r.created_at >= approved && reached(g, prev.target, r.measure.value))?.created_at ?? approved;
}
// A ticket's last sign: its worker's newest line, else its own line's last change.
export function ticketSince(t) {
  const lines = memo('lines-by', () => { const m = new Map(); for (const l of readLog().lines) if (l.at && l.by) m.set(l.by, l.at > (m.get(l.by) ?? '') ? l.at : m.get(l.by)); return m; });
  return lines.get(t.id) ?? (t.updates ?? []).at(-1)?.at ?? t.created_at;
}
// The first line of a writer's current phase run: walking back over its phase lines (oldest first),
// the first with the last line's `to` after one with another (liveness pings repeat the same to).
export function phaseRunStart(phases) {
  const last = phases.at(-1);
  if (!last) return null;
  let i = phases.length - 1;
  while (i > 0 && phases[i - 1].to === last.to) i--;
  return phases[i];
}
// A ticket's phase in words, for the worker's move (T8).
export const PHASE_WORDS = Object.freeze({ starting: 'Starting', spec: 'Writing the spec', plan: 'Writing the plan', contract: 'Landing the contract', build: 'Building', verify: 'Verifying', 'final-review': 'In final review' });
// The open messages that ask for a reply, oldest first per session: from it, or about its ticket
// (idsAwaitingReply's rule: not info, ruling or answer; no message or question re it; not settled
// by a landing).
export function openAsksBy() {
  return memo('open-asks-by', () => {
    const msgs = logObjects('message');
    const replied = new Set([...msgs, ...logObjects('question')].map((m) => m.re).filter(Boolean));
    const by = new Map();
    for (const m of msgs.filter((x) => !['info', 'ruling', 'answer'].includes(x.kind) && !replied.has(x.id) && !settledByLanding(x)).sort(byTime)) for (const who of [m.created_by, m.ticket]) if (who && !by.has(who)) by.set(who, m);
    return by;
  });
}
// The ticket rows, T1 to T14 (T2b after T3), first match wins: one move per active, unmerged
// ticket, by id (designs/every-goal-always-has-a-next-move.md). A ticket waiting on a dependency
// copies that dependency's move (T9, via).
export function ticketMoves() {
  return memo('ticket-moves', () => {
    const ts = tickets();
    const s = loadSettings();
    const openQs = questions().filter((q) => q.status === 'open').sort((a, b) => a.asked_at.localeCompare(b.asked_at));
    const asks = openAsksBy();
    const fleetDrain = draining();
    const activeIds = [...ts.values()].filter(countsAsWorker).map((t) => t.id);
    let memFull;
    // when a slot last freed: the latest merge of any ticket, or the latest park
    let freed;
    const slotFreed = () => (freed ??= Math.max(0, ...[...ts.keys()].map((id) => mergedAt(id) ?? 0), ...logObjects('phase').filter((p) => p.to === 'parked' && writerClass(p.created_by) !== 'planner').map((p) => Date.parse(p.created_at) || 0)));
    // when it became ready: the later of its line and its dependencies' latest merge
    const readySince = (t) => Math.max(Date.parse(t.created_at) || 0, ...(t.depends_on ?? []).map((d) => mergedAt(d) ?? 0));
    const done = new Map();
    const visiting = new Set();
    const moveOf = (t) => {
      if (!done.has(t.id)) { visiting.add(t.id); done.set(t.id, ticketRow(t)); visiting.delete(t.id); }
      return done.get(t.id);
    };
    function ticketRow(t) {
      const id = t.id;
      const title = t.title ?? id;
      const at = (o) => newMove(`ticket:${id}`, title, o);
      if (!isActive(t) || mergeShaFor(id)) return null; // T1
      const mode = ticketMode(t);
      if (mode === 'park' || mode === 'let-go') {
        const g = ticketGoals(t).find((x) => ['park', 'let-go'].includes(goalMode(x)));
        const hv = g ? holdView(g) : null;
        return at({ move: 'held-by-goal', words: `Held: ${hv?.reason ?? (mode === 'let-go' ? 'its goal is let go' : 'its goal is parked')}`, holder: hv?.by === 'owner' ? 'owner' : 'supervisor', quiet: 'hold', since: hv?.since ?? (t.updates ?? []).at(-1)?.at ?? t.created_at }); // T2
      }
      const q = openQs.find((x) => x.ticket === id || (x.blocks ?? []).includes(id));
      if (q) return at({ ...askedMove(q), covered_by: [{ kind: 'blocked-on-owner', subject: id }, { kind: 'owner-question-waiting', subject: q.id }] }); // T3
      if (isHeld(t)) return at({ move: 'held', words: `Held: ${t.held.trim()}. Release it, or ask`, holder: 'supervisor', since: (t.updates ?? []).filter((u) => typeof u.held === 'string' && u.held.trim()).at(-1)?.at ?? t.created_at, command: `ticket release ${id} --reason "…"`, neverOwed: true }); // T2b
      const w = workerState(id);
      const phase = w?.phase ?? null;
      const run = w?.phase_started_at ?? null;
      const msg = asks.get(id);
      if (['done', 'merging'].includes(phase)) return at({ move: 'merge-it', words: 'Merge it', holder: 'supervisor', since: run, command: `merge ${id}` }); // T4
      if (phase === 'awaiting-word') return at({ move: 'give-word', words: 'Give the word, or merge', holder: 'supervisor', since: run, command: `send ${id} "…" --kind ruling${msg ? ` --re ${msg.id}` : ''}`, covered_by: [{ kind: 'waiting-on-supervisor', subject: id }] }); // T5
      const depOpen = (t.depends_on ?? []).find((d) => !mergeShaFor(d));
      if (msg || (phase === 'blocked' && !depOpen)) return at({ move: 'answer-message', words: 'Answer its message', holder: 'supervisor', ref: msg ? { kind: 'm', id: msg.id } : null, since: msg ? msg.created_at : run, command: `send ${id} "…" --kind ruling${msg ? ` --re ${msg.id}` : ''}`, covered_by: [{ kind: 'blocked', subject: id }, { kind: 'blocked-without-question', subject: id }, ...(msg ? [{ kind: 'unanswered-message', subject: msg.id }] : [])] }); // T6
      if (phase === 'parked' && ['run', 'drain'].includes(mode) && !fleetDrain) return at({ move: 'resume', words: 'Resume it', holder: 'supervisor', since: run, command: `worker ${id} --resume`, covered_by: [{ kind: 'parked-under-run', subject: id }] }); // T7
      // an Upkeep chore ticket runs a recurring job: recurring-stuck on that job covers its move too
      const job = t.feature === CHORES ? recurringChores.refJob(id) : null;
      const stuck = job ? [{ kind: 'recurring-stuck', subject: `recurring:${job}` }] : [];
      const notStarted = !phase || (phase === 'starting' && stoppedLaunch(id));
      if (phase in PHASE_WORDS && !notStarted) return at({ move: phase === 'final-review' ? 'final-review' : phase, words: PHASE_WORDS[phase], holder: 'worker', since: run, covered_by: [...['stale-worker', 'agent-exited', 'blocked-prompt'].map((kind) => ({ kind, subject: id })), ...stuck] }); // T8
      if ((notStarted || phase === 'blocked') && depOpen) {
        const d = ts.get(depOpen);
        const src = d && !visiting.has(depOpen) ? moveOf(d) : null;
        const since = isoOf(readySince(t));
        if (src) return copiedMove(`ticket:${id}`, title, src, { move: 'waits-for-ticket', words: `Waits for ${depOpen} to merge`, ref: { kind: 'ticket', id: depOpen }, since }); // T9
        return at({ move: 'no-next-move', words: `No next move: it waits for ${depOpen}, which has none`, holder: 'nobody', since: readySince(t) }); // T14, a dependency with no move
      }
      if (notStarted) {
        const why = notSchedulable(t);
        if (why && why !== 'parked') return at({ move: 'cant-start', words: `Can't start: ${why}`, holder: 'supervisor', since: readySince(t), covered_by: ['link-unreachable', 'repo-unreachable', 'unowned-files'].map((kind) => ({ kind, subject: '*' })) }); // T10
      }
      const goalDrain = mode === 'drain' ? ticketGoals(t).find((x) => goalMode(x) === 'drain') : null;
      if ((notStarted && (goalDrain || fleetDrain)) || (phase === 'parked' && fleetDrain)) {
        const hv = goalDrain && !fleetDrain ? holdView(goalDrain) : null;
        return at({ move: 'draining', words: 'Draining: it starts after', holder: hv?.by === 'owner' ? 'owner' : 'supervisor', quiet: 'drain', since: hv?.since ?? fleetDrain?.created_at ?? readySince(t) }); // T11
      }
      if (notStarted && mode === 'run') {
        const since = readySince(t);
        const overlap = overlapsActive(t, activeIds, ts);
        if (overlap.length) return at({ move: 'waits-for-slot', words: `Waits for ${overlap[0]}`, holder: 'supervisor', quiet: 'queue', since }); // T12, touches overlap
        const cap = capOf(s.max_active_tickets) + (t.kind === 'fix' ? (s.incident_slots ?? 0) : 0);
        const inComponent = activeIds.filter((x) => ts.get(x)?.component === t.component).length;
        if (activeIds.length >= cap || inComponent >= capOf(s.max_active_per_component) || (memFull ??= !!memoryFull(s))) return at({ move: 'waits-for-slot', words: 'Waits for a worker slot', holder: 'supervisor', quiet: 'queue', since }); // T12
        return at({ move: 'start-worker', words: 'Start a worker', holder: 'supervisor', since: Math.max(since, slotFreed()), command: `worker ${id}`, covered_by: [{ kind: 'idle-capacity', subject: '*' }, ...stuck] }); // T13
      }
      return at({ move: 'no-next-move', words: 'No next move', holder: 'nobody', since: ticketSince(t) }); // T14
    }
    for (const t of ts.values()) moveOf(t);
    return new Map([...done].filter(([, m]) => m));
  });
}
// A ready goal's lead ticket's move (G16), from its open tickets (oldest first): one the supervisor
// holds (it owes something), else one the owner holds, else the furthest along in flight (T8), else
// the first ready (T12, T13) in ready's order, else the first not yet ready. Quiet moves hold
// nothing up, so they lead only when nothing else is there; ties go to the oldest move.
export const PHASE_RANK = ['starting', 'spec', 'plan', 'contract', 'build', 'verify', 'final-review'];
export function leadTicketMove(open) {
  const all = ticketMoves();
  const ms = open.map((t) => all.get(t.id)).filter(Boolean);
  const oldest = (xs) => xs.sort((a, b) => a.since.localeCompare(b.since))[0];
  const loud = ms.filter((m) => !m.quiet);
  const idOf = (m) => m.subject.slice('ticket:'.length);
  return oldest(loud.filter((m) => m.holder === 'supervisor'))
    ?? oldest(loud.filter((m) => m.holder === 'owner'))
    ?? loud.filter((m) => !m.via && m.holder === 'worker').sort((a, b) => PHASE_RANK.indexOf(b.move) - PHASE_RANK.indexOf(a.move) || a.since.localeCompare(b.since))[0]
    ?? ((prio) => ms.filter((m) => ['start-worker', 'waits-for-slot'].includes(m.move)).map((m) => ({ m, kind: tickets().get(idOf(m))?.kind, severity: 0, priority: prio.get(idOf(m))?.priority })).sort(readyOrder)[0]?.m)(effectivePriorities(tickets()))
    ?? ms[0] ?? null;
}
// One move on a line: who holds it, what, how long, and owed, stalled or quiet.
export const moveLine = (m) => `${m.holder}  ${m.words}  ${moveAge(m.since)}${m.flag === 'none' ? '  no move' : m.flag ? `  ${m.flag}` : ''}${m.quiet ? `  (${m.quiet})` : ''}`;
// The planner rows, P1 to P4.
export function plannerMove(p) {
  const by = `plan-${p.feature}`;
  const at = (o) => newMove(`planner:${p.feature}`, p.title ?? p.feature, o);
  const q = p.waiting_on_owner.map((id) => questions().find((x) => x.id === id)).filter(Boolean).sort((a, b) => a.asked_at.localeCompare(b.asked_at))[0];
  if (q) return at(askedMove(q)); // P1
  const msg = p.waiting_on_supervisor[0];
  if (msg) return at({ move: 'answer-planner', words: `Answer the planner: ${msg.kind}`, holder: 'supervisor', ref: { kind: 'm', id: msg.id }, since: logGet(msg.id)?.created_at ?? p.last_seen ?? nowIso(), command: `send ${by} "…" --kind ruling`, covered_by: [{ kind: 'unanswered-message', subject: msg.id }, { kind: 'blocked-without-question', subject: by }] }); // P2
  const seen = p.last_seen ?? nowIso();
  const held = p.goals.length && p.goals.every((id) => ['park', 'let-go'].includes(goalMode(logGet(id))));
  if (p.parked || held) return at({ move: 'parked', words: 'Parked', holder: 'planner', quiet: 'hold', since: lastPhaseOf(by)?.created_at ?? seen }); // P3
  return at({ move: 'planning', words: 'Planning', holder: 'planner', since: seen, covered_by: ['stale-planner', 'planner-gone', 'agent-exited', 'blocked-prompt'].map((kind) => ({ kind, subject: by })) }); // P4
}
// The move whose subject is this one ("goal:<g-id>", …), or null.
export function nextMoveOf(subject) {
  return nextMoves().find((m) => m.subject === subject) ?? null;
}
export const MOVE_HOLDERS = ['owner', 'supervisor', 'planner', 'worker', 'nobody'];
// A move's age in words: 45 min, 3 h, 2 d.
export const moveAge = (since) => {
  const t = Date.parse(since);
  if (Number.isNaN(t)) return 'since ?';
  const min = Math.max(0, Math.floor((Date.now() - t) / 60000));
  return min < 120 ? `${min} min` : min < 48 * 60 ? `${Math.floor(min / 60)} h` : `${Math.floor(min / 1440)} d`;
};
// moves [--json] [--holder h]: every move, grouped by holder, oldest first, owed and stalled marked.
// It only reads.
export function cmdMoves() {
  if (flags.holder !== undefined && !MOVE_HOLDERS.includes(flagStr('holder'))) die(`moves --holder takes one of: ${MOVE_HOLDERS.join(', ')}`);
  const holder = flagStr('holder');
  const moves = nextMoves().filter((m) => !holder || m.holder === holder);
  if (flags.json) return out(JSON.stringify({ next_move: 1, moves }));
  if (!moves.length) return out('No next moves.');
  const L = [];
  for (const h of MOVE_HOLDERS) {
    const mine = moves.filter((m) => m.holder === h).sort((a, b) => (Date.parse(a.since) || 0) - (Date.parse(b.since) || 0));
    if (!mine.length) continue;
    L.push(`${h}:`);
    for (const m of mine) L.push(`  ${m.subject}  ${m.words}  ${moveAge(m.since)}${m.flag === 'none' ? '  no move' : m.flag ? `  ${m.flag}` : ''}${m.quiet ? `  (${m.quiet})` : ''}`);
  }
  out(L.join('\n'));
}
// The three move findings, from the moves and the findings already raised in the same run: a pure
// function of the two (and the clock), so a test can load it on its own. Only a move's own subject
// raises one: never a quiet move (it waits on purpose), never a copied one (via: its source raises
// it). A move is covered when a finding its covered_by names was raised in the run, on that subject
// or, for "*", on any; a covered move raises nothing, though it keeps its flag. By the move's flag:
// none (no row knew the state: G20, T14) raises no-next-move, owed (rung 1) move-owed, stalled
// (rung 2) move-stalled; each is high, so wait wakes on it. The finding's subject is
// "<subject> <move>:<ref id>", so an ack sets aside one move with one ref, and a new move or a new
// ref is a new finding.
export function moveFindings(moves, raised, now = Date.now()) {
  const covered = (m) => (m.covered_by ?? []).some((c) => raised.some((f) => f.kind === c.kind && (c.subject === '*' || String(f.subject) === c.subject)));
  const ageOf = (since) => { const t = Date.parse(since); if (Number.isNaN(t)) return 'since ?'; const min = Math.max(0, Math.floor((now - t) / 60000)); return min < 120 ? `${min} min` : min < 2880 ? `${Math.floor(min / 60)} h` : `${Math.floor(min / 1440)} d`; };
  const KIND = { none: 'no-next-move', owed: 'move-owed', stalled: 'move-stalled' };
  const stalledHint = (m) => (m.holder === 'owner' ? 'remind the owner what it holds up; a question that needn\'t be the owner\'s is withdrawn and decided (W1)'
    : m.holder === 'supervisor' ? `${m.command ? `${m.command}: ` : ''}do it, or record why it waits (ack with a reason)`
      : 'look at its pane (capture it), and unstick it or record why it waits');
  const out = [];
  for (const m of moves) {
    const kind = KIND[m.flag];
    if (!kind || m.quiet || m.via || covered(m)) continue;
    const subject = `${m.subject} ${m.move}:${m.ref?.id ?? ''}`;
    const detail = `${m.title}: ${m.words} (${m.holder === 'nobody' ? 'no row knows this state' : `held by the ${m.holder}`}, ${ageOf(m.since)})`;
    const suggestion = kind === 'no-next-move' ? 'work out the move by hand, and file the missing row as a kit lesson (knowledge add --kit)'
      : kind === 'move-owed' ? (m.command ?? 'do it, or record why it waits (ack with a reason)') : stalledHint(m);
    out.push({ severity: 'high', kind, subject, detail, suggestion });
  }
  return out;
}
// The hub's cache (next-move@1's fourth place): the goals' moves, with at the time the log they
// come from was read, so a line written after that read is newer than the cache.
// collectMetrics writes it each run, and observe-metrics again as its last step, from a fresh read
// after every line the tick wrote. A write that fails costs one tick's view, never the run.
// when the log the moves come from was read: taken on that same read, and no earlier than its
// newest line, since appendLog keeps each file's times increasing and a line can run ahead of
// the clock (ISO times in one format compare as strings)
export const movesReadAt = () => memo('next-moves-at', () => {
  const now = nowIso();
  let newest = '';
  for (const l of readLog().lines) if (typeof l.at === 'string' && l.at > newest) newest = l.at;
  return newest > now ? newest : now;
});
export const MOVES_CACHE = () => path.join(runPath('cache'), 'next-moves.json');
export function writeMovesCache(moves = nextMoves(), at = movesReadAt()) {
  // the box's operator only reads (its metrics included), so it leaves the cache as it was
  if (process.env.DEVTEAM_ROLE === 'operator') return;
  try { writeJson(MOVES_CACHE(), { next_move: 1, at, moves: moves.filter((m) => m.subject.startsWith('goal:')) }); } catch {}
}
/* next-moves end */
// Per-ticket progress data for the burn-up, board and roadmap.
export function collectProgress() {
  const sub = activeTickets();
  const level = findCycle(sub) ? new Map() : levels(sub);
  const status = new Map(deriveStatus().map((r) => [r.id, r]));
  const fs_ = features();
  const stories = {};
  for (const [fid, f] of fs_) for (const s of f.stories ?? []) stories[s.id] = { feature: fid, text: s.text, release: s.release ?? null };
  const items = [...sub.values()].map((t) => {
    const st = status.get(t.id);
    const sha = st?.merge_sha;
    const targets = [...new Set((t.serves ?? []).map((x) => stories[x]?.release).filter(Boolean))].sort();
    return {
      id: t.id, title: t.title, feature: t.feature, component: t.component, kind: t.kind, size: t.size, risk: t.risk, weight: weight(t), serves: t.serves ?? [], depends_on: t.depends_on ?? [],
      wave: level.has(t.id) ? level.get(t.id) + 1 : null, added_at: t.created_at,
      merged_at: sha ? new Date(mergedAt(t.id)).toISOString() : null, released_in: sha ? releasedIn(sha, releaseOf(t)) : null, target_release: targets[0] ?? null,
      stage: st?.stage ?? 'planned', phase: st?.phase ?? null, task: st?.task ?? null, held: isHeld(t) ? t.held : null, waiting: st?.waiting ?? null,
      repo: repoOfTicketLink(t),
    };
  });
  return { now: nowIso(), features: [...new Set(items.map((t) => t.feature))], stories, tickets: items };
}

export function collectOoda() {
  const log = readLog();
  const L = ladder();
  const recent = (xs, n) => xs.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, n);
  // A ticket edit's act names the fields; attach the values it set, so the feed can say "put on
  // hold" or "took off hold" as it happened, not as the ticket stands now.
  const ticketSets = log.lines.filter((l) => l.type === 'ticket' && l.op === 'set');
  const changeOf = (a) => {
    if (a.class !== 'replan-within-feature') return undefined;
    const l = ticketSets.filter((x) => (a.refs ?? []).includes(x.id) && x.at <= a.created_at).pop();
    return l ? Object.fromEntries(Object.entries(l).filter(([k]) => !ENVELOPE.includes(k) && !k.startsWith('__'))) : undefined;
  };
  // Each act says what it carried out: a decision (whose correction is the one that counts), an
  // owner's answer or a standing rule, or its own call.
  // the owner's own acts (artifact-publish) are the Library's to show, not the supervisor's feed
  const acts = logObjects('act').filter((a) => a.created_by !== 'owner').map((a) => {
    const d = a.decision ? logGet(a.decision) : null;
    return { ...a, correction: correctionOf(a), ladder: !!L.classes[a.class], change: changeOf(a), under: a.decision ? { decision: a.decision, what: d?.what ?? null, authority: d?.authority ?? null, corrected: d ? !!correctionOf(d) : false } : { authority: actAuthority(a), approved_by: a.approved_by ?? null, own: true } };
  });
  const trust = trustTable();
  return {
    goals: logObjects('goal').map(goalView).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99)),
    roadmap: collectRoadmap(),
    retro: retroDue(),
    // each with where it sits in the loop, so its card can say so without the whole index
    observations: recent(logObjects('observation').filter((o) => !['reading', 'retro', 'finding-ack', 'learning'].includes(o.kind)), 40).map((o) => ({ ...withOoda(o), place: placeOf(o) })),
    clusters: orientClusters(),
    // orientation debt: recurring signals nothing has explained for more than a day, and resolved
    // incidents nobody learned from, each oldest first
    debt: { signals: orientationDebt(), incidents: incidentDebt() },
    // every candidate, however many: the ones sent to the owner are their Inbox, the rest the
    // supervisor's to accept (the owner sees those too, read-only); only the rest are the recent 60
    knowledge: [...recent(logObjects('knowledge').filter((k) => k.status === 'candidate'), Infinity), ...recent(logObjects('knowledge').filter((k) => !['retired', 'candidate'].includes(k.status)), 60)],
    problems: logObjects('problem').filter((p) => p.status !== 'resolved').map((p) => (isIncident(p) ? { ...p, severity: incidentSeverity(p) } : p)).sort((a, b) => b.severity - a.severity),
    acts: recent(acts, 60).map(withClassName),
    decisions: decisionRecords().slice(0, 200).map(withClassName),
    trust: trust.map(withClassName),
    classes: Object.fromEntries(Object.entries(L.classes).map(([k, v]) => [k, { ...v, rung: rungFor(k), class_name: className(k) }])),
    impact_words: IMPACT_WORDS,
    reasons: L.reasons,
    // every settled question, newest first, wherever it was answered (dashboard, terminal, chat) or
    // whether it was defaulted or withdrawn; defaulted ones can still be overruled
    answered: questions().filter((q) => q.status !== 'open').sort((a, b) => b.answered_at.localeCompare(a.answered_at)).slice(0, 80).map(withClassName),
    // the weekly learning records, oldest first: read, never written here (observe-metrics writes them)
    // under three records the Loop shows these since the log began instead of lines; retros and rung
    // changes mark the chart, so cause sits next to effect
    learning_totals: { since: log.lines.reduce((m, l) => (l.at < m ? l.at : m), log.lines[0]?.at ?? '') || null, calls: calls().length, lessons: logObjects('knowledge').filter((k) => k.status === 'accepted').length, corrections: calls().filter(correctionOf).length },
    learning_marks: [...logObjects('observation').filter((x) => x.kind === 'retro' && x.created_by === 'supervisor').map((x) => ({ at: x.created_at, kind: 'retro', label: 'retro', href: `#retro/${encodeURIComponent(x.id)}` })), ...trust.flatMap((t) => t.history.map((e) => ({ at: e.at, kind: 'rung', label: `${className(t.class)} to ${RUNG_PLAIN[e.rung]}`, href: hrefOf(logGet(e.id)) })))].filter((m) => m.at).sort((a, b) => a.at.localeCompare(b.at)),
    learning: learningRecords().map((o) => ({ id: o.id, week: o.week, at: o.created_at, from: new Date(weekStartOf(o.week)).toISOString(), figures: o.figures, detail: o.detail })),
    log: { lines: log.lines.length, errors: log.errors.length, ignored: log.ignored.length, unknown: log.unknown.length },
  };
}
// The Settings page's word on each askable setting: main's value (the one in force) and who set it,
// told from the owner's latest owner-setting act and the supervisor's settings-edit acts. Never
// says a value is the owner's that the owner didn't choose (strategy R1).
export const ASKED_SAVED = 'Saved; applies once the supervisor lands it';
export const askedShown = (v) => (v === null ? 'No limit' : String(v));
// The newest supervisor settings-edit without --for for key, newer than sinceIso, of the value main
// holds, with a settings-chore merge newer than it: the supervisor deliberately set or kept its own
// value after the owner asked (a no-op edit counts). Only main is read: an edit never merged, or
// merged before it was made, lands nothing.
export function landedOverride(key, sinceIso, mainValue) {
  const merges = logObjects('act').filter((a) => a.class === 'merge-chore' && a.created_by === 'supervisor' && (a.refs ?? []).includes('chore-settings'));
  return logObjects('act').filter((a) => a.class === 'settings-edit' && a.created_by === 'supervisor' && a.key === key && a.for === undefined && a.created_at > sinceIso && canonical(a.value) === canonical(mainValue) && merges.some((m) => m.created_at > a.created_at)).sort(byTime).at(-1) ?? null;
}
// Once per run: metrics and dashboard-data both read it.
export let askedMemo = null;
export function askedSettingsView() {
  if (askedMemo) return askedMemo;
  // main's block through mainRef(), the one way of finding main; the working tree before main has one
  const ref = mainRef();
  const s = (ref && settingsAt(ref, { orNull: true })) || loadSettings();
  let all = null;
  return (askedMemo = Object.fromEntries(OWNER_ASKABLE.map((key) => {
    const value = s[key] ?? null;
    const act = latestOwnerSetting(key);
    const label = !act ? ((all ??= settingsAll()).find((e) => e.key === key)?.set ? 'Set by the supervisor' : "The kit's default")
      : canonical(act.value) === canonical(value) ? 'Set by you'
      : landedOverride(key, act.created_at, value) ? `Set by the supervisor (you asked for ${act.value === null ? 'no limit' : act.value})`
      : ASKED_SAVED;
    return [key, { value, shown: askedShown(value), label, asked: act ? act.value : null, act: act?.id ?? null }];
  })));
}
export function dashboardData() {
  reviewMemo = new Map();
  try { return dashboardDataRead(); } finally { reviewMemo = null; }
}
/* autonomy score start */
// The Autonomy Score: the mean of the Trust, Efficiency and Awareness scores for each of the 12 weeks,
// null when any of the three is (a week with no tickets shipped says nothing about autonomy).
export function autonomyScore(autonomy, efficiency, awareness) {
  const weeks = awareness.weeks.map((w, i) => {
    const x = [autonomy.decisions.weeks[i].score, efficiency.weeks[i].score, w.score];
    return { starts_at: w.starts_at, score: x.every((v) => typeof v === 'number') ? Math.round((x[0] + x[1] + x[2]) / 3) : null };
  });
  return { this_week: weeks[11].score, last_week: weeks[10].score, weeks };
}
/* autonomy score end */
export function dashboardDataRead() {
  // one clock for the parts that read the 12 weeks, so they agree on which week is this one
  const now = Date.now();
  const settings = loadSettings();
  const metrics = collectMetrics(0);
  const sub = activeTickets();
  const msgs = logObjects('message');
  const replied = handledMessages();
  const H = heldByMap();
  const efficiency = efficiencyData(metrics, now), awareness = awarenessData(now), autonomy = autonomyData(now);
  return {
    generated_at: nowIso(), project: settings.project, kit: dashboardKit(),
    caps: { max_active_tickets: settings.max_active_tickets },
    asked_settings: askedSettingsView(),
    gates_configured: Object.keys(settings.gates ?? {}),
    // held_by: the open question holding it, or null; repo: its component's repo link, home for home's lines
    tickets: deriveStatus().map((r) => ({ ...r, repo: repoOfTicketLink(r), held_by: H.get(r.id) ?? null })),
    // every kind of decision in plain words; each row with a class carries its class_name
    class_words: CLASS_WORDS,
    critical_path: findCycle(sub) ? [] : criticalPath(sub).path,
    questions: rankQuestions(questions().filter((q) => q.status === 'open' && q.goal_hold !== 'let-go')).map(withClassName),
    open_messages: msgs.filter((m) => !['info', 'ruling', 'answer'].includes(m.kind) && !replied.has(m.id) && !settledByLanding(m)).map((m) => ({ id: m.id, kind: m.kind, actor: m.created_by, to: m.to, summary: m.text })),
    metrics,
    efficiency,
    awareness,
    progress: collectProgress(),
    planners: planners().map((p) => ({ ...p, held_by: H.get(`plan-${p.feature}`) ?? null })),
    // next-move@1: every move the table names (the comment above nextMoves())
    next_moves: nextMoves(),
    ooda: collectOoda(),
    self: selfDashboard(),
    exterior: (() => { const m = exteriorOnMain(); const d = m && exteriorDoc(m.text); return d?.block ? exteriorDashboard(d.block) : null; })(),
    autonomy,
    autonomy_score: autonomyScore(autonomy, efficiency, awareness),
    threads: threadCounts(),
    upkeep_days: upkeepDays(),
    // every kit setting, in words; never a credential (settingsAll)
    settings_all: settingsAll(),
    // holds: Upkeep's, and the fleet's mode when every goal is held (fleet status gives readiness)
    upkeep: (() => { const u = upkeepOrVirtual(); const chores = deriveStatus().filter((r) => r.feature === CHORES && !r.merge_sha && r.stage !== 'superseded'); return { id: upkeepGoal()?.id ?? null, ...holdView(u), chores: chores.map((r) => ({ id: r.id, title: r.title, stage: r.stage, phase: r.phase })), recurring: recurringDashboard() }; })(),
    sensors: sensorStatus(),
    sensor_feed: sensorFeed({ limit: 60 }),
    incidents: incidentList().map(incidentView),
    sensor_ignores: [...sensorIgnores().values()],
    fleet: { mode: draining() ? 'park' : fleetMode(), op: fleetOpInForce()?.fleet ?? draining()?.id ?? null, reason: fleetOpInForce()?.reason ?? (draining() ? drainReason(draining()) : null) },
    // the Library: artifacts landed and drafted, and the registry as it reads (locators redacted)
    library: {
      // publish state is the log's, read here and never in describeArtifact's tree-keyed cache:
      // a publish changes no byte of the artifact
      artifacts: (() => { const rec = publishRecords(); return allArtifacts().map((a) => (a.at === 'main' ? { ...a, published: publishedView(rec.get(a.slug)) } : a)); })(),
      // the running servers sessions have offered; run state, read here on every request
      previews: readPreviews().map((r) => ({ ...previewHelloRow(r, previewUpHere()[r.name] ?? null), expires: r.expires, down_since: r.down_since ?? null })),
      // what the Library matches the gateway's header on (x-devteam-public): this project and checkout
      public: { project: typeof settings.project === 'string' && PUBLIC_PROJECT.test(settings.project) ? settings.project : null, root: fs.realpathSync(mainRoot) },
      links: Object.entries(isObj(settings.links) ? settings.links : {}).filter(([, l]) => isObj(l)).map(([id, l]) => {
        const K = LINK_KINDS[l.kind];
        const loc = K ? K.locator(l, id) : {};
        return { id, kind: l.kind ?? null, title: l.title ?? id, notes: l.notes ?? null, for: asList(l.for), url: loc.url ?? null, remote: loc.remote ?? null, path: loc.path ?? null };
      }),
    },
  };
}
// The kit's release for the sidebar's pill, as `hello` says it. It hashes every kit file, and the
// page asks every 10s, so it is worked out at most once a minute.
export let dashboardKitCache = null;
export function dashboardKit() {
  if (!dashboardKitCache || Date.now() - dashboardKitCache.at > 60000) dashboardKitCache = { at: Date.now(), kit: kitVersion() };
  return dashboardKitCache.kit;
}
export const cmdDashboardData = () => {
  gitReadCache = new Map();
  out(JSON.stringify(dashboardData()));
  if (process.env.DEVTEAM_TEST_REVIEW_READS) process.stderr.write(`review reads: ${reviewReads}\n`);
};

// timeline <ticket-id> [--json]: the ticket, and every log line that bears on it (its own edits,
// its worker's phases, gates and messages, questions it raised or that block it, acts and
// observations that name it), oldest first; plus its review records and its files.
export function timelineView(id) {
  const t = tickets().get(id) ?? die(`no ticket ${id}`);
  const touches = (l) => l.id === id || l.by === id || l.ticket === id || l.to === id || l.subject === id
    || (l.refs ?? []).includes(id) || (l.blocks ?? []).includes(id) || (l.serves ?? []).includes(id);
  const lines = readLog().lines.filter(touches);
  // a question answered later belongs here too: its answer lines name only the question
  const qids = new Set(lines.filter((l) => l.type === 'question').map((l) => l.id));
  const all = readLog().lines.filter((l) => touches(l) || (l.type === 'question' && qids.has(l.id))).sort((a, b) => a.at.localeCompare(b.at));
  const st = deriveStatus().find((r) => r.id === id);
  // a view: the ticket's repo by name, and nothing read from one this machine can't read
  const R = factsRepo(id);
  const branch = ticketBranchRef(id);
  const ref = branch && !mergeShaFor(id) ? branch : R?.mainRef() ?? null;
  // records in home: home's ticket/<id> until merged, then home's main
  const RR = recordsInHomeId(id) ? repo('home') : R;
  const rref = RR === R ? ref : (mergeShaFor(id) ? mainRef() : homeRecordsRef(id));
  const files = !RR ? [] : ['spec.md', 'plan.md', 'verification.md'].map((f) => `${RR.projectRel}/tickets/${id}/${f}`).filter((f) => rref && RR.git(['cat-file', '-e', `${rref}:${f}`]) !== null).map((f) => ({ title: path.basename(f, '.md'), path: f, ref: rref, ...(RR.name === 'home' ? {} : { repo: RR.name }) }));
  const reviews = ticketReviews(id, branch && !mergeShaFor(id) ? { ref: branch } : WORKTREE).map((r) => ({ file: r.file, stage: r.stage, pass: r.pass, verdict: r.verdict, reviewer: r.reviewer }));
  return { ticket: { ...t, ...st }, files, reviews, lines: all.map((l) => Object.fromEntries(Object.entries(l).filter(([k]) => !k.startsWith('__')))), st, all };
}
export function cmdTimeline() {
  gitReadCache = new Map();
  const [id] = positional;
  const { st, all, ...view } = timelineView(id);
  const t = view.ticket;
  if (flags.json) return json(view);
  out(`${id} [${st?.stage}${st?.phase ? `, ${st.phase}` : ''}] ${t.title}`);
  for (const l of all) out(`${l.at} ${l.type.padEnd(11)} ${l.by.padEnd(14)} ${l.what ?? l.text ?? l.question ?? l.detail ?? l.answer ?? (l.type === 'phase' ? `${l.from ?? ''} -> ${l.to}` : l.op)}`);
}

// The dashboard: one page, data computed on each request, owner actions only from that page.
// The dashboard's own record of why it stopped (run/dashboard.log): a window closes with its
// process, taking the output with it. Starts, signals, server errors and crashes with their stack;
// never a request body (secrets pass through it). Kept under ~1 MB by starting afresh.
export function dashboardLogger() {
  const file = path.join(runDir, 'dashboard.log');
  try { if (fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, `${file}.1`); } catch {}
  return (msg) => { try { fs.mkdirSync(runDir, { recursive: true }); fs.appendFileSync(file, `${nowIso()} [${process.pid}] ${msg}\n`); } catch {} };
}
// Every instance on a machine has its own dashboard port in one block, so the hub finds them all
// by asking each port who it is (/api/hello). DEVTEAM_HUB_PORT and DEVTEAM_PORT_BASE are for tests.
export const HUB_PORT = Number(process.env.DEVTEAM_HUB_PORT ?? 4320);
// A kept-alive connection outlives any client's idle reuse: Node's 5 s default closed sockets a
// fetch client (Node 18's keeps them about 4 s) was just reusing, and that request failed.
export const keepAlive = (srv) => { srv.keepAliveTimeout = 65000; srv.headersTimeout = 66000; return srv; };
// What a dashboard handing over to a new kit waits for (kit-288): every request its servers (its own
// and the hub's) have not answered, and every child it started that acts (an owner action, still
// typing its nudge after its reply; an accounts-tick run). Never cut off by the restart.
export const inFlight = new Set();
export const liveChildren = new Set();
export const trackRequests = (srv) => { srv.on('request', (req, res) => { inFlight.add(res); res.once('close', () => inFlight.delete(res)); }); return srv; };
export const trackChild = (child) => { if (child?.pid) { liveChildren.add(child); child.once('close', () => liveChildren.delete(child)); child.once('error', () => liveChildren.delete(child)); } return child; };
export const PORT_BASE = Number(process.env.DEVTEAM_PORT_BASE ?? 4321);
export const PORT_RANGE = Array.from({ length: 25 }, (_, i) => PORT_BASE + i);
// Who answers on a port: a devteam dashboard's /api/hello, or null (closed, slow, or not devteam).
export function probeHello(port, ms = 300) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/hello', timeout: ms, headers: { host: `127.0.0.1:${port}` } }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; if (b.length > 65536) req.destroy(); });
      res.on('end', () => { try { const j = JSON.parse(b); resolve(res.statusCode === 200 && Number(j?.devteam) >= 1 ? j : null); } catch { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}
// Free means nothing answers there and this process could bind it: a dev server on localhost (::1)
// or on every interface would still pass a bind of 127.0.0.1 alone, then take the owner's
// localhost:<port> while the dashboard holds 127.0.0.1:<port>.
// A blocked loop runs timers before I/O when it wakes, so the timeout could fire before a connect
// already made is heard: the timeout's verdict waits one turn (setImmediate), and a connect wins.
export const answers = (port, host) => new Promise((resolve) => {
  let done = false;
  const settle = (v) => { if (!done) { done = true; resolve(v); } };
  const c = net.connect({ port, host, timeout: 300 });
  c.once('connect', () => { c.destroy(); settle(true); });
  c.once('timeout', () => setImmediate(() => { c.destroy(); settle(false); }));
  c.once('error', () => settle(false));
});
export const binds = (port) => new Promise((resolve) => { const v = net.createServer(); v.once('error', () => resolve(false)); v.listen(port, '127.0.0.1', () => v.close(() => resolve(true))); });
export const portFree = async (port) => !(await answers(port, '127.0.0.1')) && !(await answers(port, '::1')) && (await binds(port));
// The dashboard's port: the one pinned (settings or --port); else the one this checkout used last,
// if it is free; else one past the highest instance answering in the block, skipping ports held by
// anything else; else the lowest free one. Saved to run/dashboard-port.
export async function pickDashboardPort({ skip = [] } = {}) {
  const pinned = flagStr('port') ?? loadSettings().dashboard_port;
  const span = `${PORT_RANGE[0]}-${PORT_RANGE.at(-1)}`;
  if (pinned != null) {
    const port = Number(pinned);
    return { port, pinned: true, warn: PORT_RANGE.includes(port) ? null : `port ${port} is outside ${span}: the hub won't list it` };
  }
  const file = path.join(runDir, 'dashboard-port');
  const last = Number(readText(file)?.trim());
  if (PORT_RANGE.includes(last) && !skip.includes(last) && (await portFree(last))) return { port: last, warn: null };
  const hellos = await Promise.all(PORT_RANGE.map((p) => probeHello(p)));
  const top = PORT_RANGE.filter((_, i) => hellos[i]).pop();
  const order = top === undefined ? PORT_RANGE : [...PORT_RANGE.filter((p) => p > top), ...PORT_RANGE.filter((p) => p <= top)];
  for (const p of order) {
    if (skip.includes(p) || hellos[PORT_RANGE.indexOf(p)] || !(await portFree(p))) continue;
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(file, `${p}\n`);
    return { port: p, warn: null };
  }
  die(`every dashboard port in ${span} is taken: stop an instance, or pin one with "dashboard_port" in settings.md (the hub won't list a port outside ${span})`);
}

/* personHeader start */
// kit-252: which of the box's people gave an owner action. The box's gateway says so in
// x-devteam-person (presence@1 §4's form). A dashboard or the hub, once a request has passed every
// check it makes today, hands that person to the action's own child alone, as DEVTEAM_PERSON (JSON),
// and the child's owner lines carry it as person (logLineFor, operatorAppend). Attribution, never
// authority (design P6): nothing reads it to decide who may do what, and with no header nothing
// changes (a laptop, or a gateway from before people).
// Read once, as the script loads, and taken out of this process's environment: nothing it starts (a
// tmux server, an agent, a gate's command, gh) ever inherits a person.
export const ENV_PERSON = process.env.DEVTEAM_PERSON;
delete process.env.DEVTEAM_PERSON;
export const PERSON_ID = /^[A-Za-z0-9._:@/-]{1,64}$/;
export const PERSON_NAME_ENCODED = /^(?:[A-Za-z0-9\-_.!~*'()]|%[0-9A-Fa-f]{2})+$/;
export const PERSON_NAME_BYTES = 80;
export const PERSON_TOO_LONG = 'That is too long with your name on it; shorten it.';
export const PERSON_MALFORMED = "the request's person (x-devteam-person) is malformed";
export const personNameBytes = (s) => Buffer.byteLength(JSON.stringify(s)) - 2;
export const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
// The one rule for a person, wherever one is read: { id, name } and nothing else; the id §4's; the
// name a non-empty, whole string (no lone surrogate) of at most 80 bytes of JSON without its quotes.
export function personOk(p) {
  return isObj(p) && Object.keys(p).length === 2 && typeof p.id === 'string' && PERSON_ID.test(p.id) && typeof p.name === 'string' && p.name !== '' && !LONE_SURROGATE.test(p.name) && personNameBytes(p.name) <= PERSON_NAME_BYTES;
}
// §4's cut: the longest start, by whole characters, of at most 80 bytes of JSON.
export function cutPersonName(name) {
  let out = '';
  let n = 0;
  for (const ch of name) { const b = personNameBytes(ch); if (n + b > PERSON_NAME_BYTES) break; out += ch; n += b; }
  return out;
}
// A request's person: null with no header, { bad: true } for anything §4 refuses (a second header
// included), else { id, name }, the name decoded and cut.
export function requestPerson(req) {
  const vs = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === 'x-devteam-person') vs.push(req.rawHeaders[i + 1]);
  if (!vs.length) return null;
  const m = vs.length === 1 ? /^([^;]*);name=(.*)$/.exec(vs[0]) : null;
  if (!m || !PERSON_ID.test(m[1]) || !PERSON_NAME_ENCODED.test(m[2])) return { bad: true };
  const bytes = [];
  for (let i = 0; i < m[2].length;) { if (m[2][i] === '%') { bytes.push(parseInt(m[2].slice(i + 1, i + 3), 16)); i += 3; } else { bytes.push(m[2].charCodeAt(i)); i += 1; } }
  let name;
  try { name = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes)); } catch { return { bad: true }; }
  const cut = cutPersonName(name);
  return cut ? { id: m[1], name: cut } : { bad: true };
}
// This command's person, from its server: null unset; set but not a person, it dies before anything
// is written.
export let envPersonRead;
export function envPerson() {
  if (ENV_PERSON === undefined) return null;
  if (envPersonRead === undefined) {
    let p = null;
    try { p = JSON.parse(ENV_PERSON); } catch {}
    if (!personOk(p)) die('DEVTEAM_PERSON is not a person');
    envPersonRead = { id: p.id, name: p.name };
  }
  return envPersonRead;
}
// An owner action's env with its request's person, for that child alone.
export const personEnv = (env, person) => (person ? { ...env, DEVTEAM_PERSON: JSON.stringify({ id: person.id, name: person.name }) } : env);
// Checked now, as the script loads: a command handed a bad one does nothing at all (a secret posted
// to its sink and then refused at its log line would be one done and not recorded).
envPerson();
/* personHeader end */
// An owner action a server runs (a dashboard's, or the hub's for the operator's threads): replied to
// as soon as the child says it is done (its reply pipe, fd 3), before it types into a pane; what it
// says on stderr after that goes to the log. A child that exits without replying (refused, or an
// older script) is answered from its exit.
export function runOwnerAction(args, { env, timeout = 0, input = null, log = () => {}, cwd = mainRoot } = {}) {
  return new Promise((resolve) => {
    const child = trackChild(spawn(process.execPath, [fileURLToPath(import.meta.url), ...args], { cwd, env: { ...env, DEVTEAM_REPLY_FD: '3' }, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] }));
    let so = '';
    let se = '';
    let rp = '';
    let done = false;
    let killed = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    const timer = timeout ? setTimeout(() => { killed = true; child.kill('SIGKILL'); }, timeout) : null;
    child.stdin.on('error', () => {});
    child.stdout.on('data', (c) => { so += c; });
    child.stderr.on('data', (c) => { se += c; });
    child.stdio[3].on('data', (c) => {
      rp += c;
      if (!rp.includes('\n')) return;
      let o = null;
      try { o = JSON.parse(rp.slice(0, rp.indexOf('\n'))); } catch {}
      if (o && typeof o.out === 'string') { if (timer) clearTimeout(timer); finish({ ok: true, code: 0, stdout: o.out, stderr: '' }); }
    });
    child.stdio[3].on('error', () => {});
    child.on('error', (e) => finish({ ok: false, code: 1, stdout: so, stderr: `devteam: ${e.message}` }));
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (done) { const late = se.split('\n').filter(Boolean); if (late.length) log(`${args.slice(0, 2).join(' ')}: ${late.join(' | ')}`); return; }
      finish({ ok: code === 0, code: code ?? 1, stdout: so, stderr: killed ? `devteam: ${args.slice(0, 2).join(' ')} took over ${timeout / 1000} s and was stopped` : se });
    });
    child.stdin.end(input ?? undefined);
  });
}
// The environment an owner action runs in: nothing that says an agent's session started the server.
// TMUX_PANE too: a server started in the supervisor's pane would have ownerWriter refuse every
// action as the supervisor's (TMUX stays, so the children's tmux finds the same server).
export function ownerActionEnv(channel) {
  const env = { ...process.env, DEVTEAM_CHANNEL: channel };
  // and never the server's own person (kit-252): a child gets only its request's (personEnv)
  for (const k of ['TMUX_PANE', 'DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_PERSON']) delete env[k];
  return env;
}
// The hub: every dashboard tries to serve 127.0.0.1:HUB_PORT (unless the box's image serves it:
// DEVTEAM_IMAGE_HUB, cmdDashboard), and so does `devteam.mjs hub` alone (cmdHub), which the box's boot
// starts from the image's kit. The one that gets it lists every
// instance in the block by asking each port /api/hello: a tab per instance, with that instance's
// own dashboard in a sandboxed frame on its own address. No proxy, its own Host only, a page that
// fetches only from itself and frames only the block. It does nothing in any project: the page's
// Overview can run, drain and park a fleet, but not through this server: it asks that project's
// dashboard, in its frame, and the dashboard posts to itself (index.html, "The hub's Overview").
// The one thing it keeps and the one thing it does are the owner's threads with the machine's
// operator (operator threads, below): under /operator/ it lists them, and takes the owner's turns
// as a dashboard takes an owner action, each run as the owner's own command, which types the turn
// into the operator's pane. The store is beside the operator, not in this process, so the hub still
// moves when its dashboard stops: the others retry. Something that isn't a devteam hub on the
// port: logged once, and a dashboard stops trying; the hub alone (standalone) keeps retrying whatever
// holds the port, and never exits for it.
// The list, /instances.json: { hub: 1, kit, image?, down?, instances }. down: true is never a hub's:
// only the box's gateway sets it, on the empty list it serves when no hub answers (cloud/gateway.mjs). kit is the release serving the hub,
// fixed when it starts: hub --release's, with image: true (only the box's boot passes it, so no other
// hub can claim the image's release); else the running kit's own version (kitVersion()) when it is its
// project's own checkout, or null (no project, or a kit run against someone else's: ownKitVersion). No hub reads DEVTEAM_KIT_RELEASE: the box's ENV reaches every process there.
// The rule for the list: an additive change keeps hub: 1; anything else bumps it.
export const HUB_BODY_MAX = 20000;
// The hub's owner actions, each the arguments of the owner's command or null: checked here before
// anything is spawned, and by the command again. The owner's words always go after --, so words
// that start with -- stay words; a title and a subject as --key=value, kept whole whatever they hold.
export const hubTurnOk = (v) => typeof v === 'string' && !!v.trim() && Buffer.byteLength(v.trim()) <= TURN_MAX && encodedBytes(v.trim()) <= TURN_ENCODED_MAX;
export const HUB_ACTIONS = {
  'thread-new': (b) => {
    const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim() : null;
    if (!hubTurnOk(b.text) || (b.title !== undefined && (!title || title.length > THREAD_TITLE_MAX || UNSAFE_TEXT.test(title))) || (b.subject != null && operatorSubjectProblem(b.subject))) return null;
    // a press's files as the command's --files: none or an empty list is none; only the count is checked
    // here, the command checks the rest (attachedFiles)
    const files = b.files === undefined ? [] : b.files;
    if (!Array.isArray(files) || files.length > FILES_MAX) return null;
    return ['operator-thread', 'new', ...(files.length ? [`--files=${JSON.stringify(files)}`] : []), ...(title ? [`--title=${title}`] : []), ...(b.subject != null ? [`--subject=${JSON.stringify(b.subject)}`] : []), '--', b.text.trim()];
  },
  'thread-say': (b) => {
    const files = b.files === undefined ? [] : b.files;
    if (!Array.isArray(files) || files.length > FILES_MAX) return null;
    return OPERATOR_THREAD_ID.test(b.id ?? '') && hubTurnOk(b.text) ? ['operator-thread', 'say', b.id, ...(files.length ? [`--files=${JSON.stringify(files)}`] : []), '--', b.text.trim()] : null;
  },
  // the rest keep no files, so a press that sends some is refused, never taken without them
  'thread-close': (b) => ((b.files === undefined || JSON.stringify(b.files) === '[]') && OPERATOR_THREAD_ID.test(b.id ?? '') ? ['operator-thread', 'close', b.id] : null),
  'thread-reopen': (b) => ((b.files === undefined || JSON.stringify(b.files) === '[]') && OPERATOR_THREAD_ID.test(b.id ?? '') && (b.text === undefined || b.text === '' || hubTurnOk(b.text)) ? ['operator-thread', 'reopen', b.id, ...(b.text?.trim() ? ['--', b.text.trim()] : [])] : null),
  start: (b) => (b.files === undefined || JSON.stringify(b.files) === '[]' ? ['operator-thread', 'start'] : null),
};
