/* imports start */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CHORES } from './settings.mjs';
import { DAY } from './base.mjs';
import { EXTERIOR_REL } from './world-model.mjs';
import { GOAL_CHANGE_FIELDS } from './log-sync.mjs';
import { IMPACT_WORDS } from './log-sync.mjs';
import { LINK_KINDS } from './links.mjs';
import { WORKTREE } from './repos.mjs';
import { activeTickets } from './graph.mjs';
import { ancestorOf } from './base.mjs';
import { appendLog } from './log-sync.mjs';
import { applyGoalOrder } from './log-sync.mjs';
import { asList } from './base.mjs';
import { authorise } from './questions.mjs';
import { byTime } from './log-sync.mjs';
import { calls } from './log-sync.mjs';
import { canonical } from './settings.mjs';
import { capOf } from './holds.mjs';
import { chatAnswer } from './decide.mjs';
import { choreSelfHold } from './self-model.mjs';
import { citing } from './questions.mjs';
import { collectMetrics } from './metrics.mjs';
import { collectProgress } from './orient.mjs';
import { commitDateOf } from './base.mjs';
import { commonDir } from './state.mjs';
import { correctionOf } from './log-sync.mjs';
import { coverage } from './graph.mjs';
import { covered } from './observe.mjs';
import { dateOnly } from './base.mjs';
import { detachedWorktree } from './pr-checks.mjs';
import { die } from './base.mjs';
import { escapeRe } from './box-pins.mjs';
import { execFileSync } from 'node:child_process';
import { exteriorChoreLines } from './world-model.mjs';
import { features } from './graph.mjs';
import { fetchLinkMain } from './log-sync.mjs';
import { fetchMain } from './log-sync.mjs';
import { fetchPastHalfMade } from './pr-checks.mjs';
import { findCycle } from './graph.mjs';
import { firstLine } from './reviews.mjs';
import { flagNum } from './base.mjs';
import { flagStr } from './base.mjs';
import { flags } from './base.mjs';
import { gateEnv } from './check-ticket.mjs';
import { git } from './base.mjs';
import { gitOrDie } from './base.mjs';
import { gitRun } from './reviews.mjs';
import { goalArg } from './holds.mjs';
import { goalChangeProblem } from './log-sync.mjs';
import { goalImpact } from './log-sync.mjs';
import { goalMode } from './holds.mjs';
import { goalOrderApproved } from './log-sync.mjs';
import { goalOrderRefusal } from './log-sync.mjs';
import { groupBy } from './base.mjs';
import { holdCause } from './holds.mjs';
import { holdRefusal } from './log.mjs';
import { holdView } from './holds.mjs';
import { holdWords } from './holds.mjs';
import { impactOf } from './log-sync.mjs';
import { incidentList } from './sensors.mjs';
import { isActive } from './graph.mjs';
import { isUpkeep } from './holds.mjs';
import { json } from './base.mjs';
import { jsonFlag } from './decide.mjs';
import { levels } from './graph.mjs';
import { listFlag } from './base.mjs';
import { loadSettings } from './settings.mjs';
import { logCache } from './log-sync.mjs';
import { logGet } from './log-sync.mjs';
import { logNamesChecked } from './self-model.mjs';
import { logObjects } from './log-sync.mjs';
import { logWriter } from './log.mjs';
import { mainRef } from './log.mjs';
import { mainRefCache } from './log.mjs';
import { mainRoot } from './state.mjs';
import { mainSha } from './log.mjs';
import { mergeShaFor } from './repos.mjs';
import { mergedAt } from './repos.mjs';
import { nextMoveOf } from './orient.mjs';
import { nowIso } from './base.mjs';
import { nudgeSupervisor } from './sessions.mjs';
import { orientClusters } from './observe.mjs';
import { out } from './base.mjs';
import { ownEntry } from './artifact-notes.mjs';
import { ownerChannel } from './log.mjs';
import { ownerWriter } from './log.mjs';
import { pastHalfMade } from './check-ticket.mjs';
import { positional } from './base.mjs';
import { projectFileText } from './repos.mjs';
import { projectInRepo } from './settings.mjs';
import { projectRel } from './settings.mjs';
import { questionView } from './log-sync.mjs';
import { questions } from './log-sync.mjs';
import { readLog } from './log-sync.mjs';
import { realPath } from './state.mjs';
import { recurringFailures } from './chores.mjs';
import { repo } from './repos.mjs';
import { repoReadable } from './repos.mjs';
import { repoRoot } from './state.mjs';
import { resolveCommit } from './log-sync.mjs';
import { resolveQuestionThreads } from './decide.mjs';
import { restartCommands } from './holds.mjs';
import { runDir } from './state.mjs';
import { sameAnswer } from './questions.mjs';
import { seedWorktree } from './check-ticket.mjs';
import { sendParkRulings } from './holds.mjs';
import { sessionGoals } from './holds.mjs';
import { setupMarker } from './check-ticket.mjs';
import { slug } from './base.mjs';
import { spawnSync } from 'node:child_process';
import { strategyRel } from './pr-checks.mjs';
import { strategyState } from './pr-checks.mjs';
import { supervisorOnly } from './log.mjs';
import { ticketBranchRef } from './repos.mjs';
import { ticketReviews } from './reviews.mjs';
import { tickets } from './graph.mjs';
import { trustTable } from './trust.mjs';
import { turnAnswer } from './decide.mjs';
import { upkeepOrVirtual } from './holds.mjs';
import { warn } from './base.mjs';
import { weight } from './graph.mjs';
import { writeHold } from './holds.mjs';
/* imports end */
// How the fleet reads a goal's measure (planning.md §1): repo, a command the kit runs on main;
// prod, a read-only command against production; owner, a yes/no question the owner answers. An
// owner measure is a yes: target 1, unit attested, up, from 0.
export const MEASURE_SOURCES = ['repo', 'prod', 'owner'];
export const measureOf = (g) => (g?.measure?.source === 'owner' ? { target: 1, unit: 'attested', direction: 'up', ...g.measure } : g?.measure ?? {});
export const shaOnMain = new Map();
export const isOnMain = (sha) => {
  if (!shaOnMain.has(sha)) shaOnMain.set(sha, !!mainRef() && /^[0-9a-f]{7,40}$/.test(sha) && ancestorOf(sha, mainSha(), mainRoot) === true);
  return shaOnMain.get(sha);
};
// Why question q does not let the supervisor record goal goalId's owner reading (null when it does):
// a goal-met question about that goal, answered by the owner with its recommendation, before the
// reading was written (at), so a line that cites a question ahead of its answer never counts.
export function goalMetProblem(q, goalId, qid, at = null) {
  const v = q?.type === 'question' ? questionView(q) : null;
  if (!v) return `${qid} is not a question`;
  if (v.class !== 'goal-met') return `${v.id} was asked in class ${v.class ?? '(none)'}, not goal-met`;
  if (v.goal !== goalId) return `${v.id} is about ${v.goal ?? 'no goal'}, not ${goalId} (ask with --goal ${goalId})`;
  if (v.status !== 'answered') return `${v.id} is not answered by the owner (${v.status})`;
  if (!v.matched) return `${v.id} was answered "${v.answer}", not its recommendation${v.recommendation ? ` ("${v.recommendation}")` : ''}`;
  if (at && at < v.answered_at) return `the reading was written before ${v.id} was answered`;
  // asked of the goal as it was (planning.md §1): a yes to an earlier measure is not a yes to this one
  if (v.met && logGet(goalId)?.status !== 'met' && v.met.basis !== goalMetBasis(logGet(goalId))) return `${v.id} was asked before ${goalId}'s title, measure or milestones changed`;
  return null;
}
// What a goal-met question is asked about, so the owner's yes applies only to the goal as it was
// asked: its title, outcome, measure, preconditions (which milestones number) and milestones.
// Status is checked when the answer comes (still ready).
export const goalMetBasis = (g) => crypto.createHash('sha256').update(canonical(Object.fromEntries(['title', 'outcome', 'measure', 'preconditions', 'milestones'].map((k) => [k, g?.[k] ?? null])))).digest('hex').slice(0, 16);
// The answers a goal-met question offers; the kit writes them, and the owner's yes is the first.
export const GOAL_MET_CHOICES = [{ label: 'Yes', detail: 'It is met: mark the goal met, and its work stops.' }, { label: 'No', detail: 'Not yet: the goal keeps running.' }];
// A ready goal whose latest reading that counts (goalReadings) reaches its target, with its
// milestones all reached or only the last left (or none): the reading, else null.
export function goalAtTarget(g) {
  if (g?.type !== 'goal' || g.status !== 'ready' || g.kind === 'upkeep') return null;
  const m = measureOf(g);
  if (!MEASURE_SOURCES.includes(m.source) || typeof m.target !== 'number') return null;
  const last = goalReadings(g.id).pop();
  const v = last?.measure?.value;
  if (typeof v !== 'number' || !reached(g, m.target, v)) return null;
  const ms = (g.milestones ?? []).filter((x) => typeof x?.target === 'number');
  const left = ms.findIndex((x) => !reached(g, x.target, v));
  return left < 0 || left === ms.length - 1 ? last : null;
}
// The words of a goal-met question, the kit's own: an owner goal's is its measure.question; a repo
// or prod goal's says the reading and the target.
export function goalMetWording(g, reading) {
  const m = measureOf(g);
  if (m.source === 'owner') return m.question;
  const u = m.unit ? ` ${m.unit}` : '';
  return `Is "${g.title}" met? ${m.description ?? 'Its measure'} reads ${reading.value}${u}, and its target is ${m.target}${u}.`;
}
// What the owner's answer to goal-met question v does (answer): it sets the goal met only when it
// is yes (the recommendation), the goal is still running and as it was asked (met.basis), and the
// question is in the kit's words and choices for it, so a hand-written question can't stand in for
// one. A repo or prod goal's check runs again here, before anything is written (runMeasureCheck
// dies on a failed check, and the owner can answer again); the new reading decides. why says what
// happened when it sets nothing (null for a no).
export function goalMetPlan(v, answer) {
  if (!v.met) return { why: `${v.id} was asked before goal-met questions carried the goal they are about, so it sets nothing: the supervisor asks again, or the owner marks it met on its card` };
  if (!sameAnswer(answer, GOAL_MET_CHOICES[0].label)) return { why: null };
  const g = logGet(v.goal ?? '');
  if (g?.type !== 'goal') return { why: `${v.id} is about ${v.goal ?? 'no goal'}, which is not a goal; nothing changes` };
  if (g.status !== 'ready') return { why: `${g.id} is ${g.status ?? 'draft'}, not running; nothing changes` };
  if (goalMetBasis(g) !== v.met.basis) return { why: `${g.id}'s title, measure or milestones changed after ${v.id} was asked, so this yes doesn't mark it met: the supervisor asks again` };
  const m = measureOf(g);
  const ours = String(v.recommendation).trim().toLowerCase() === 'yes' && canonical(v.choices) === canonical(GOAL_MET_CHOICES) && (m.source === 'owner' ? !v.met.reading : !!v.met.reading) && v.question === goalMetWording(g, v.met.reading);
  if (!ours) return { why: `${v.id} is not the kit's goal-met question for ${g.id}, so it sets nothing` };
  if (m.source === 'owner') return { g, m, r: null };
  const r = runMeasureCheck(g);
  // the check can take minutes: the goal and the question must still be as they were when it started
  logCache = null;
  const now = logGet(g.id);
  if (now?.status !== 'ready' || goalMetBasis(now) !== v.met.basis) die(`${g.id} changed while its check ran; nothing was answered: read ${v.id} again`);
  if (questionView(logGet(v.id)).status !== 'open') die(`${v.id} is no longer open (it changed while ${g.id}'s check ran); nothing was written`);
  return { g: now, m: measureOf(now), r };
}
export function goalMetApply(v, plan, by, chan) {
  if (!plan.g) return plan.why;
  const { g, m, r } = plan;
  const unit = m.unit;
  // the reading is the supervisor's, as goal reading writes it: the check's number, or the owner's yes
  if (r) appendLog({ type: 'observation', source: m.source, subject: g.id, kind: 'reading', detail: m.source === 'repo' ? `reading ${r.value}${unit ? ` ${unit}` : ''} on ${r.on} at ${r.sha.slice(0, 12)}, read again for ${v.id}` : `reading ${r.value}${unit ? ` ${unit}` : ''} from ${m.check}, read again for ${v.id}: ${r.out.slice(-300)}`, measure: { value: r.value, unit }, ...(r.sha ? { sha: r.sha } : {}), refs: [g.id, v.id] }, 'supervisor');
  else appendLog({ type: 'observation', source: 'owner', subject: g.id, kind: 'reading', detail: `the owner said yes to ${v.id}`, measure: { value: 1, unit }, approved: v.id, refs: [g.id, v.id] }, 'supervisor');
  if (r && !reached(g, m.target, r.value)) return `${g.id} keeps running: its check reads ${r.value}${unit ? ` ${unit}` : ''} now${r.sha ? ` (${r.on} at ${r.sha.slice(0, 12)})` : ''}, not its target ${m.target}`;
  appendLog({ type: 'goal', op: 'set', id: g.id, status: 'met', decision: { verdict: 'met', question: v.id }, ...chan }, by);
  return `${g.id} is met${r ? ` (its check reads ${r.value}${unit ? ` ${unit}` : ''}${r.sha ? ` on ${r.on} at ${r.sha.slice(0, 12)}` : ''})` : ''}`;
}
// How a goal-met reading reads in the question's context: the value, when, and where it came from.
export function goalMetReadingWords(g, r) {
  const m = measureOf(g);
  const when = `${r.at.slice(0, 10)} at ${r.at.slice(11, 16)} UTC`;
  const where = m.source === 'repo' ? `on ${m.link && m.link !== 'home' ? `${m.link}'s ` : ''}main at ${String(r.sha ?? '').slice(0, 12)}` : 'from its production check';
  return `The latest reading is ${r.value}${m.unit ? ` ${m.unit}` : ''}, taken ${when} ${where}. If you say yes, the kit reads it again ${m.source === 'repo' ? 'on main' : 'from production'} and marks the goal met only if it still reaches ${m.target}.`;
}
// The registry is complete (planning.md §7), the precondition the Baseline carries: its count half
// is components check --count, with the gates; its other half is the owner's yes to a
// registry-attest question about the goal, which goal-readiness waits for. Only the owner's own
// answer counts (registry-attest is owner_only, so never a default; chat counts), and only yes.
// The goal carries it as a field, registry_precondition: the number of its precondition that is
// "the registry is complete", set by goal add|set --registry-precondition n (none clears it). The
// check is keyed to that field, never to a precondition's wording.
export function registryPreconditionFlag() {
  const v = flagStr('registry-precondition');
  if (v === undefined) return undefined;
  if (v === 'none') return null;
  if (!/^[1-9]\d*$/.test(v)) die('--registry-precondition is the number of the goal\'s "registry is complete" precondition (1-based), or none');
  return Number(v);
}
export function registryPreconditionCheck(name, g) {
  const n = g.registry_precondition;
  if (n === undefined || n === null) return;
  const count = (g.preconditions ?? []).length;
  if (n > count) die(`--registry-precondition ${n}: ${name} has ${count} precondition${count === 1 ? '' : 's'}; it numbers the one that is "the registry is complete"`);
}
// A goal with no registry_precondition whose precondition reads as the registry being complete
// ("registry" and "complete" in the one precondition, any case): a definition gap, so leaving the
// field unset (or clearing it) can't skip the attestation. The kit has no Baseline marker beyond the
// field itself, so the wording is the only other sign. It only raises the gap; it never satisfies
// the attestation, which stays keyed to the field.
export function registryWording(g) {
  if (g.registry_precondition != null) return null;
  const i = (g.preconditions ?? []).findIndex((t) => /registry/i.test(t) && /complete/i.test(t));
  return i < 0 ? null : { n: i + 1, text: g.preconditions[i] };
}
// The attestation's state for a goal with a registry_precondition (the dashboard card, the approval
// question): its latest registry-attest question, and the owner's answer once there is one.
export function registryAttestView(g) {
  const n = g.registry_precondition;
  if (n == null) return undefined;
  const last = questions().filter((q) => q.class === 'registry-attest' && q.goal === g.id).sort((a, b) => (a.asked_at < b.asked_at ? -1 : 1)).pop();
  if (!last) return { precondition: n, status: 'not asked', question: null, answer: null };
  return { precondition: n, status: last.status === 'open' ? 'open' : 'answered', question: last.id, answer: last.status === 'open' ? null : last.answer ?? null };
}
export function registryAttestText(g) {
  const v = registryAttestView(g);
  if (!v) return '';
  const text = (g.preconditions ?? [])[v.precondition - 1];
  return `Registry attestation: precondition ${v.precondition}${text ? ` ("${text}")` : ''}, ${v.status}${v.question ? ` (${v.question}${v.answer ? `: "${v.answer}"` : ''})` : ''}; goal-readiness waits for the owner's yes.`;
}
// A goal-readiness act or decision is about one goal, named by its id (planning.md §7).
export function readinessGoal(refs) {
  const g = refs.length === 1 ? logGet(refs[0]) : null;
  if (g?.type !== 'goal' || g.kind === 'upkeep') die(`goal-readiness names exactly one goal, an existing goal id: --refs <g-id>${refs.length ? ` (got ${refs.map((r) => JSON.stringify(r)).join(', ')})` : ''}`);
  return g;
}
export function registryAttestGap(goalId) {
  const qs = questions().filter((q) => q.class === 'registry-attest' && q.goal === goalId);
  if (qs.some((q) => q.status === 'answered' && q.matched && String(q.label ?? '').trim().toLowerCase() === 'yes')) return null;
  const last = qs.sort((a, b) => (a.asked_at < b.asked_at ? -1 : 1)).pop();
  if (!last) return 'none asked yet';
  if (last.status !== 'answered') return `${last.id} is not answered by the owner (${last.status})`;
  return `${last.id} was answered "${last.answer}", not yes`;
}
// The readings that count. Each must match how the goal is read, whoever wrote the line: a repo
// reading carries a commit on main, a prod one comes from prod, and an owner goal's only from the
// owner, or with an answered goal-met question, each question once. A goal with no source keeps the
// old rule (the supervisor's or the owner's) until a goal-change gives it one.
export function goalReadings(gid) {
  const all = logObjects('observation').filter((o) => o.kind === 'reading' && o.subject === gid && o.measure && ['supervisor', 'owner'].includes(o.created_by)).sort(byTime);
  const src = logGet(gid)?.measure?.source;
  if (!src) return all;
  const used = new Set();
  // a view: another repo's main only when this machine can read it (else its readings can't be checked)
  const link = logGet(gid)?.measure?.link ?? 'home';
  const onMain = link === 'home' ? isOnMain : (sha) => { if (!repoReadable(link)) return false; const R = repo(link); return !!R.mainRef() && /^[0-9a-f]{7,40}$/.test(sha) && ancestorOf(sha, R.mainRef(), R.root) === true; };
  return all.filter((o) => {
    if (src === 'repo') return o.source === 'repo' && typeof o.sha === 'string' && onMain(o.sha);
    if (src === 'prod') return o.source === 'prod';
    if (o.created_by === 'owner') { if (!o.approved) return true; if (used.has(o.approved)) return false; used.add(o.approved); return true; }
    if (!o.approved || used.has(o.approved) || o.measure.value !== 1 || goalMetProblem(logGet(o.approved), gid, o.approved, o.created_at)) return false;
    used.add(o.approved);
    return true;
  });
}
// The readings taken under the measure as it stands: from the latest goal set that changed what it
// reads (its source, check, question, unit or link) on. One taken before was of another measure, so
// it is no baseline; a change to the measure's wording, target or direction keeps them.
export const MEASURE_DEFINING = ['source', 'check', 'question', 'unit', 'link'];
export let bornMeasures = null;
export function currentReadings(gid) {
  const g = logGet(gid);
  const log = readLog();
  if (bornMeasures?.log !== log) bornMeasures = { log, m: new Map(log.lines.filter((l) => l.type === 'goal' && l.op === 'new').map((l) => [l.id, l.measure ?? {}])) };
  let prev = bornMeasures.m.get(gid) ?? {};
  let since = null;
  for (const u of g?.updates ?? []) {
    if (!u.measure) continue;
    if (MEASURE_DEFINING.some((k) => (u.measure[k] ?? null) !== (prev[k] ?? null))) since = u.at;
    prev = u.measure;
  }
  const all = goalReadings(gid);
  return since ? all.filter((r) => r.created_at >= since) : all;
}
export const goalFeatures = (gid) => [...features().values()].filter((f) => (f.goals ?? []).includes(gid)).map((f) => f.id);

// Run a repo or prod measure's check: repo on a throwaway checkout of main (so the number is main's,
// with its sha), prod from the main checkout (it reads production, read-only by the owner's word).
// The number is the last line of stdout.
// A repo measure runs on the main of the repo its link names (measure.link, default home).
export function runMeasureCheck(g) {
  const m = measureOf(g);
  let cwd = mainRoot;
  let sha = null;
  const R = repo(m.source === 'repo' ? m.link ?? 'home' : 'home'); // an act: fails fast on a missing checkout
  if (m.source === 'repo') {
    if (R.name === 'home') { fetchPastHalfMade(['fetch', '--quiet', 'origin']); mainRefCache = undefined; } else fetchLinkMain(R, 'refusing to read the measure on a stale main');
    sha = R.git(['rev-parse', `${R.mainRef() ?? die(`no main branch${R.name === 'home' ? '' : ` in ${R.name}`} to read the measure on`)}^{commit}`], R.root) ?? die('cannot resolve main');
    cwd = detachedWorktree(sha, 'reading', R);
  }
  // The check is the supervisor's command (it drafted the goal), and goal status met runs it from
  // the owner's terminal or the dashboard: it runs as the supervisor, never as the owner, so what it
  // writes is the supervisor's and owner commands refuse it.
  const env = { ...gateEnv(null, R), DEVTEAM_ROLE: 'supervisor' };
  for (const k of ['DEVTEAM_CHANNEL', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE']) delete env[k];
  const r = spawnSync('sh', ['-c', m.check], { cwd, env, encoding: 'utf8', timeout: 900000, maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) die(`${g.id}'s check failed (${r.error?.message ?? `exit ${r.status}`}): ${(r.stderr ?? '').trim().slice(-400)}`);
  const last = (r.stdout ?? '').trim().split('\n').pop().trim();
  const value = Number(last);
  if (last === '' || !Number.isFinite(value)) die(`${g.id}'s check printed "${last.slice(0, 80)}" last, not a number`);
  return { value, sha, out: (r.stdout ?? '').trim(), on: R.name === 'home' ? 'main' : `${R.name}'s main` };
}

// Mechanical readiness. Definition gaps block approval; coverage gaps are what planning closes.
export function goalCheck(g) {
  const definition = [];
  const coverage = [];
  if (!g.outcome) definition.push('no outcome: what is true for users or the business when this is met');
  const m = measureOf(g);
  if (!m.description) definition.push('no measure: how we will know');
  if (typeof m.target !== 'number') definition.push('no numeric target');
  if (!m.unit) definition.push('no unit');
  if (!m.direction) definition.push('no direction (up or down)');
  // A running goal keeps running while the supervisor asks the owner for its source (a goal-change).
  const draft = (g.status ?? 'draft') === 'draft';
  if (!m.source) (draft ? definition : coverage).push('no source: how the fleet reads the measure (repo, prod or owner; planning.md §1)');
  else if (!MEASURE_SOURCES.includes(m.source)) definition.push(`source "${m.source}" is not repo, prod or owner`);
  else if (m.source === 'owner' ? !m.question : !m.check) definition.push(m.source === 'owner' ? 'no question: the yes/no the owner answers when it is met (measure.question)' : 'no check: the command whose last line is the number (measure.check)');
  if (m.link !== undefined && m.source !== 'repo') definition.push('measure.link is for a repo measure: the repo whose main its check runs on');
  else if (m.link !== undefined && m.link !== 'home' && !LINK_KINDS[ownEntry(loadSettings().links, m.link)?.kind]?.hostsComponents) definition.push(`measure.link "${m.link}" is not a repo link (devteam.mjs links)`);
  // A horizon is the owner's real deadline, when there is one; never required, never guessed. The
  // forecast says when, from the measured rate (planning.md §1).
  if (g.horizon && Number.isNaN(Date.parse(g.horizon))) definition.push(`horizon "${g.horizon}" is not a date`);
  if (!(g.non_goals ?? []).length) definition.push('no non-goals');
  if (!(g.preconditions ?? []).length) definition.push('no preconditions: what must be true for the outcome');
  if (typeof g.priority !== 'number') definition.push('no priority');
  const clash = logObjects('goal').filter((o) => o.id !== g.id && ['ready', 'draft'].includes(o.status ?? 'draft') && typeof g.priority === 'number' && o.priority === g.priority);
  if (clash.length) definition.push(`priority ${g.priority} is shared with ${clash.map((c) => c.id).join(', ')}`);
  if (m.source !== 'owner' && !currentReadings(g.id).length) definition.push(`no baseline reading (devteam.mjs goal reading <id> ${['repo', 'prod'].includes(m.source) ? '--run' : '--value v'})`);
  const unmarked = registryWording(g);
  if (unmarked) definition.push(`precondition ${unmarked.n} ("${unmarked.text}") reads as the registry being complete, and ${g.id} has no registry_precondition: goal set ${g.id} --registry-precondition ${unmarked.n} (goal-readiness then waits for the owner's registry-attest yes; planning.md §7)`);
  const approval = milestoneGaps(g);
  const feats = goalFeatures(g.id);
  const covered = new Set(feats.flatMap((f) => features().get(f).preconditions ?? []));
  const unplanned = (g.preconditions ?? []).map((text, i) => ({ n: i + 1, text })).filter((p) => !covered.has(`${g.id}#${p.n}`));
  // Planning rolls a milestone at a time: only the current milestone's preconditions need features;
  // a later milestone's wait for it (planning.md §1).
  const cur = approval.length ? null : currentMilestone(g);
  const later = cur ? new Set(g.milestones.slice(cur.n).flatMap((m) => m.preconditions)) : new Set();
  const designSlug = slug(g.title ?? g.id);
  if ((g.status ?? 'draft') === 'ready') {
    if (!projectFileText(`designs/${designSlug}.md`)) coverage.push(`no design at project/designs/${designSlug}.md`);
    if (!feats.length) coverage.push('no feature names this goal');
    for (const p of unplanned.filter((x) => !later.has(x.n))) coverage.push(`precondition ${p.n} ("${p.text}") has no feature (${g.id}#${p.n})${cur ? `; it is in milestone ${cur.n}, the current one` : ''}`);
  }
  return { definition, approval, coverage, features: feats, unplanned, later: [...later].sort((a, b) => a - b), current_milestone: cur?.n ?? null, design: `project/designs/${designSlug}.md` };
}

// What the design must give the goal before the owner approves it: its milestones (planning.md §1).
export function milestoneGaps(g) {
  const ms = g.milestones ?? [];
  const pre = g.preconditions ?? [];
  if (!ms.length) return ['no milestones: the outcome in order, each a usable slice with a target on the measure, its preconditions and a size in tickets (goal set --milestones; one is fine for a goal one loop can meet)'];
  const gaps = [];
  const seen = new Map();
  const base = currentReadings(g.id)[0]?.measure.value ?? (measureOf(g).source === 'owner' ? 0 : undefined);
  const up = measureOf(g).direction !== 'down';
  let prevT = base;
  let prevBy = null;
  ms.forEach((m, i) => {
    const n = i + 1;
    if (!m.title) gaps.push(`milestone ${n} has no title`);
    if (typeof m.target !== 'number') gaps.push(`milestone ${n} has no numeric target`);
    else if (typeof prevT === 'number' && (up ? m.target <= prevT : m.target >= prevT)) gaps.push(`milestone ${n}'s target ${m.target} does not move the measure ${up ? 'up' : 'down'} from ${prevT}`);
    if (typeof m.target === 'number') prevT = m.target;
    if (!(m.preconditions ?? []).length) gaps.push(`milestone ${n} makes no precondition true`);
    for (const p of m.preconditions ?? []) {
      if (!Number.isInteger(p) || p < 1 || p > pre.length) gaps.push(`milestone ${n} names precondition ${p}, which the goal does not have`);
      else if (seen.has(p)) gaps.push(`precondition ${p} is in milestones ${seen.get(p)} and ${n}; each belongs to one`);
      else seen.set(p, n);
    }
    if (!(Number.isInteger(m.tickets) && m.tickets > 0)) gaps.push(`milestone ${n} has no size (tickets: a rough count of PRs)`);
    if (m.by != null) {
      const t = Date.parse(m.by);
      if (Number.isNaN(t)) gaps.push(`milestone ${n}'s date "${m.by}" is not a date`);
      else {
        if (prevBy !== null && t < prevBy) gaps.push(`milestone ${n} is due before milestone ${n - 1}`);
        if (g.horizon && t > Date.parse(g.horizon)) gaps.push(`milestone ${n} is due after the horizon`);
        prevBy = t;
      }
    }
  });
  pre.forEach((_, i) => { if (!seen.has(i + 1)) gaps.push(`precondition ${i + 1} is in no milestone`); });
  if (typeof measureOf(g).target === 'number' && ms[ms.length - 1].target !== measureOf(g).target) gaps.push(`the last milestone's target (${ms[ms.length - 1].target}) is not the goal's (${measureOf(g).target})`);
  return gaps;
}
export const reached = (g, target, value) => (measureOf(g).direction === 'down' ? value <= target : value >= target);
// The first milestone the latest reading has not reached; null once all are.
export function currentMilestone(g) {
  const last = goalReadings(g.id).pop()?.measure.value;
  const i = (g.milestones ?? []).findIndex((m) => typeof last !== 'number' || !reached(g, m.target, last));
  return i < 0 ? null : { n: i + 1, ...g.milestones[i] };
}

// The forecast the owner approves a goal against: per milestone, the work left (planned tickets'
// points, or the design's estimate where nothing is planned yet), the waves that takes at the
// current worker slots, and a date where the fleet has a measured rate (planning.md §1).
export let roadmapMemo = null;
export const FORECAST_WIDTH = 8;
export function goalForecast(g, r = null) {
  const ms = g.milestones ?? [];
  if (!ms.length) return null;
  const all = [...tickets().values()].filter(isActive);
  const avgW = all.length ? all.reduce((a, t) => a + weight(t), 0) / all.length : 1;
  // one roadmap per process: every goal's view asks for its forecast, and the roadmap reads git
  r ??= (roadmapMemo ??= collectRoadmap());
  // with no cap, an unplanned milestone is forecast at FORECAST_WIDTH tickets at once; planned features use their own waves
  const slots = Math.max(1, Number.isFinite(capOf(loadSettings().max_active_tickets)) ? loadSettings().max_active_tickets : FORECAST_WIDTH);
  const cur = currentMilestone(g);
  const fs_ = features();
  let cumPts = 0;
  let cumWaves = 0;
  const rows = ms.map((m, i) => {
    const n = i + 1;
    const keys = new Set(m.preconditions.map((p) => `${g.id}#${p}`));
    const feats = [...fs_.values()].filter((f) => (f.goals ?? []).includes(g.id) && (f.preconditions ?? []).some((p) => keys.has(p))).map((f) => f.id);
    const planned = feats.reduce((a, f) => a + (r.features[f]?.points_left ?? 0), 0);
    const plannedTotal = feats.reduce((a, f) => a + (r.features[f]?.points_total ?? 0), 0);
    const status = !cur || n < cur.n ? 'met' : n === cur.n ? 'current' : 'later';
    const left = status === 'met' ? 0 : feats.length ? planned : Math.round(m.tickets * avgW);
    cumPts += left;
    cumWaves += status === 'met' ? 0 : feats.length ? Math.max(0, ...feats.map((f) => r.features[f]?.waves_left ?? 0)) : Math.ceil(m.tickets / slots);
    const eta = r.rate_points_per_day > 0 ? dateOnly(new Date(Date.now() + Math.max(cumPts / r.rate_points_per_day, r.median_cycle_days ? cumWaves * r.median_cycle_days : 0) * DAY).toISOString()) : null;
    const late = Boolean(m.by && eta && eta > dateOnly(new Date(Date.parse(m.by)).toISOString()));
    return { n, title: m.title, target: m.target, by: m.by ?? null, status, features: feats, estimate_tickets: m.tickets, planned_points: plannedTotal, points_left: left, waves_to_here: cumWaves, eta: status === 'met' ? 'met' : eta, late };
  });
  const lastEta = rows[rows.length - 1].eta;
  const pastHorizon = Boolean(g.horizon && lastEta && lastEta !== 'met' && lastEta > dateOnly(new Date(Date.parse(g.horizon)).toISOString()));
  return { milestones: rows, slots, rate_points_per_day: r.rate_points_per_day, median_cycle_days: r.median_cycle_days, eta: lastEta, past_horizon: pastHorizon };
}
export function forecastText(g, f) {
  if (!f) return '';
  const L = f.milestones.map((m) => `${m.n}. ${m.title}: ${m.target}${g.measure?.unit ? ` ${g.measure.unit}` : ''}${m.by ? ` by ${m.by}` : ''}; ${m.status === 'met' ? 'met' : `${m.features.length ? `${m.points_left} points left in ${m.features.join(', ')}` : `about ${m.estimate_tickets} tickets, unplanned`}; ${m.waves_to_here} waves to here at ${f.slots} slots${m.eta ? `; ETA ${m.eta}${m.late ? ' (after its date)' : ''}` : ''}`}`);
  const tail = f.rate_points_per_day > 0 ? `ETA ${f.eta}${f.past_horizon ? `, after the horizon ${g.horizon}` : ''}` : 'no measured rate yet, so no dates: sizes and waves only';
  return `Forecast (computed):\n${L.join('\n')}\n${tail}.`;
}
export function goalView(g) {
  const readings = goalReadings(g.id);
  // the track runs from the baseline under the measure as it stands (currentReadings)
  const current = currentReadings(g.id);
  const first = current[0];
  const last = current[current.length - 1];
  let track = null;
  if (current.length >= 2 && typeof g.measure?.target === 'number' && g.horizon) {
    // Expected value now, on the line from the baseline through each dated milestone to the horizon.
    const pts = [[Date.parse(first.created_at), first.measure.value], ...(g.milestones ?? []).filter((m) => m.by && !Number.isNaN(Date.parse(m.by)) && typeof m.target === 'number').map((m) => [Date.parse(m.by), m.target]), [Date.parse(g.horizon), g.measure.target]].sort((a, b) => a[0] - b[0]);
    const now = Date.now();
    let expected = pts[pts.length - 1][1];
    for (let i = 1; i < pts.length; i++) {
      if (now <= pts[i][0]) {
        const [t0, v0] = pts[i - 1];
        const [t1, v1] = pts[i];
        expected = t1 > t0 ? v0 + (v1 - v0) * Math.max(0, (now - t0) / (t1 - t0)) : v1;
        break;
      }
    }
    track = reached(g, expected, last.measure.value) ? 'on track' : 'behind';
  }
  // A parked or let-go goal stands still on purpose: it is neither on track nor behind.
  const mode = goalMode(g);
  const still = ['park', 'let-go'].includes(mode);
  const forecast = goalForecast(g);
  return { ...g, ...(g.measure ? { measure: measureOf(g) } : {}), status: g.status ?? 'draft', readings: readings.map((r) => ({ at: r.created_at, value: r.measure.value, source: r.source, ...(r.sha ? { sha: r.sha } : {}), ...(r.approved ? { approved: r.approved } : {}) })), track: still ? null : track, check: goalCheck(g), forecast: forecast && still ? { ...forecast, eta: null, past_horizon: false } : forecast, hold_view: holdView(g), registry_attest: registryAttestView(g), impact: goalImpact(g.id), at_target: atTargetView(g), next_move: nextMoveOf(`goal:${g.id}`) };
}
// A running goal at its target, as its card shows it: the reading, and the open goal-met question.
export function atTargetView(g) {
  const r = goalAtTarget(g);
  if (!r) return null;
  const q = questions().find((x) => x.class === 'goal-met' && x.goal === g.id && x.status === 'open');
  return { value: r.measure.value, at: r.created_at, source: r.source ?? null, ...(r.sha ? { sha: r.sha } : {}), question: q?.id ?? null };
}
export function cmdGoal() {
  const [sub, id] = positional;
  const writer = () => (flags.owner ? ownerWriter() : (supervisorOnly('goal'), { by: 'supervisor' }));
  const fields = () => ({
    title: flagStr('title'), outcome: flagStr('outcome'),
    measure: ['measure', 'target', 'unit', 'direction', 'source', 'check', 'question', 'link'].some((k) => flagStr(k) !== undefined)
      ? { ...(id ? logGet(id)?.measure : {}), ...(flagStr('measure') ? { description: flagStr('measure') } : {}), ...(flagStr('target') ? { target: Number(flagStr('target')) } : {}), ...(flagStr('unit') ? { unit: flagStr('unit') } : {}), ...(flagStr('direction') ? { direction: flagStr('direction') } : {}), ...(flagStr('source') ? { source: MEASURE_SOURCES.includes(flagStr('source')) ? flagStr('source') : die('--source is repo, prod or owner (planning.md §1)') } : {}), ...(flagStr('check') ? { check: flagStr('check') } : {}), ...(flagStr('question') ? { question: flagStr('question') } : {}), ...(flagStr('link') ? { link: flagStr('link') } : {}) }
      : undefined,
    // `none` clears it: a horizon is the owner's real deadline or nothing (planning.md §1)
    horizon: flagStr('horizon') === 'none' ? null : flagStr('horizon'),
    non_goals: flags['non-goals'] !== undefined ? listFlag('non-goals') : undefined,
    preconditions: flags.preconditions !== undefined ? listFlag('preconditions') : undefined,
    registry_precondition: registryPreconditionFlag(),
    priority: flagNum('priority'),
    milestones: jsonFlag('milestones'),
    plan_after: flags['plan-after'] !== undefined ? listFlag('plan-after').map((goal) => ({ goal, reason: flagStr('reason') ?? die('--plan-after needs --reason: why this goal\'s design waits on that one') })) : undefined,
  });
  if (sub === 'add') {
    const { by } = writer();
    const f = fields();
    if (!f.title) die('goal add needs --title');
    registryPreconditionCheck(f.title, f);
    return out(appendLog({ type: 'goal', status: 'draft', ...f }, by).id);
  }
  if (sub === 'set') {
    if (!id || logGet(id)?.type !== 'goal') die('usage: goal set <g-id> [--title …] [--outcome …] [--measure …] [--target n] [--unit u] [--direction up|down] [--source repo|prod|owner] [--check "cmd"] [--link <repo>] [--question "…"] [--horizon date] [--non-goals a b | \'["a","b"]\'] [--preconditions a b | \'["a","b"]\'] [--registry-precondition n|none] [--priority n] [--milestones \'[{"title","target","by","preconditions":[n],"tickets"}…]\'] [--plan-after <g-id>… --reason "…"] [--approved <qid>] [--owner]');
    const { by } = writer();
    const approved = flagStr('approved') ?? null;
    if (approved && by !== 'supervisor') die('the owner changes a goal directly; --approved is the supervisor applying an owner answer');
    if (by === 'supervisor' && (logGet(id).status ?? 'draft') !== 'draft' && !approved) die(`${id} is ${logGet(id).status}; only the owner changes it now (class goal-change): ask a goal-change question with --goal ${id}, then goal set ${id} --approved <qid>`);
    if (approved) {
      // an earlier answer carried forward with --change is checked as such (its question recorded no change)
      const problem = goalChangeProblem(logGet(approved), id, approved, logGet(approved)?.type === 'question' && !questionView(logGet(approved)).change && flagStr('change') !== undefined ? { carried: true } : null);
      if (problem) die(`goal set --approved: ${problem}`);
      if (logObjects('goal').some((g) => g.updates.some((u) => u.approved === approved)) || calls().some((a) => a.approved_by === approved)) die(`${approved} already authorised a change; ask again for another`);
      // the answer authorises the change the question proposed, applied as is
      if (Object.values(fields()).some((x) => x !== undefined)) die('goal set --approved applies the change its question proposed; pass no other fields');
      const qv = questionView(logGet(approved));
      if (qv.change) {
        if (flagStr('change') !== undefined) die(`${approved} proposed its change; --change is only for carrying forward an earlier answer that didn't record one`);
        return out(`updated ${id} (${appendLog({ type: 'goal', op: 'set', id, ...qv.change, approved }, by).id})`);
      }
      // carrying forward an answer given before changes were recorded on the question
      const carried = jsonFlag('change') ?? die(`${approved} was asked before changes were recorded on goal-change questions: carry the owner's answer forward with --change '{…}', the change they chose ("${qv.answer}")`);
      const bad = Object.keys(carried).filter((k) => !GOAL_CHANGE_FIELDS.includes(k));
      if (!Object.keys(carried).length || bad.length) die(`--change sets goal fields (${GOAL_CHANGE_FIELDS.join(', ')})${bad.length ? `; not ${bad.join(', ')}` : ''}`);
      const line = appendLog({ type: 'goal', op: 'set', id, ...carried, approved, carried: true }, by);
      appendLog({ type: 'act', class: 'carry-answer', what: `applied your earlier answer to ${approved} ("${qv.answer}") to ${id}: set ${Object.keys(carried).join(', ')}`, refs: [id, approved], reversible: true }, 'supervisor');
      return out(`updated ${id} (${line.id}), carrying ${approved} forward`);
    }
    const f = fields();
    registryPreconditionCheck(id, { ...logGet(id), ...Object.fromEntries(Object.entries(f).filter(([, x]) => x !== undefined)) });
    appendLog({ type: 'goal', op: 'set', id, ...f }, by);
    return out(`updated ${id}`);
  }
  // The goal order in one step: the owner's ids, 1..n, the rest after in their own order (the
  // owner's terminal or the dashboard); or the supervisor applying an answered goal-change --order
  // question, exactly the order it proposed (goal order --approved <qid>).
  if (sub === 'order') {
    const ids = positional.slice(1);
    const approved = flagStr('approved') ?? null;
    if (flags.approved !== undefined && !approved) die('goal order --approved needs the question id: goal order [<g-id> …] --approved <qid>');
    if (approved && /\s/.test(approved)) die('goal order --approved takes one question id: name any goals before it (goal order [<g-id> …] --approved <qid>)');
    if (approved) return goalOrderApproved(approved, ids);
    if (process.env.DEVTEAM_ROLE) die(`goal order is the owner's (DEVTEAM_ROLE=${process.env.DEVTEAM_ROLE}): the supervisor asks one goal-change --order question, then goal order --approved <qid>`);
    const { by } = ownerWriter('the owner orders the goals; ask one goal-change --order question, then goal order --approved <qid>');
    if (!ids.length) die('usage: goal order <g-id> <g-id> … (the owner) | goal order [<g-id> …] --approved <qid> (the supervisor)');
    const why = goalOrderRefusal(ids, readLog().byType.get('goal') ?? []);
    if (why) die(`goal order: ${why}`);
    const said = applyGoalOrder(ids, by);
    nudgeSupervisor(`[devteam goal order from owner] the goals are in a new order: devteam.mjs goal list`);
    return out(said);
  }
  // The owner's decision on a goal, made on its design: approve (ready; planning starts), refine
  // (notes the planner must take into account; the supervisor reworks the design and asks again),
  // or let go (abandoned). It answers the open goal-approval question for the goal.
  if (sub === 'approve' || sub === 'decide') {
    const said = flags['from-chat'] ? chatAnswer('goal decide') : null;
    const fromTurn = flags['from-turn'] !== undefined;
    // a goal is approved on its design, never on words said before it: the whole turn, newer than the question
    if (fromTurn && flags['from-chat'] !== undefined) die('goal decide: --from-turn or --from-chat, not both');
    if (fromTurn && ['said', 'at', 'seen-turn'].some((k) => flags[k] !== undefined)) die('goal decide --from-turn takes the whole turn: a goal is approved on its design, so --said, --at and --seen-turn aren\'t accepted there');
    const { by } = said || fromTurn ? ownerWriter(null, { heard: true }) : ownerWriter();
    const chat = said ? { channel: 'chat' } : fromTurn ? { channel: 'thread' } : {};
    const g = logGet(id);
    if (g?.type !== 'goal') die(`no goal ${id}`);
    const verdict = sub === 'approve' ? 'approve' : positional[2];
    if (!['approve', 'refine', 'let-go', 'restore'].includes(verdict)) die('usage: goal decide <g-id> approve|refine|let-go|restore [--notes "…"] [--question q-…] [--from-chat --said "…" | --from-turn <u-id>]');
    if (said && verdict === 'restore') die('goal decide restore is the owner\'s undo of a let go, not an answer to a question; it doesn\'t come from chat');
    if (fromTurn && verdict === 'restore') die("goal decide restore is the owner's undo of a let go, not an answer to a question; it doesn't come from a thread");
    // Restore undoes a let go: the goal gets back the status it had, parked, and its questions return.
    if (verdict === 'restore') {
      if (g.status !== 'abandoned') die(`${id} is ${g.status ?? 'draft'}, not let go; nothing to restore`);
      const born = readLog().lines.find((l) => l.id === id && l.op === 'new')?.status ?? 'draft';
      const statuses = [{ at: g.created_at, status: born }, ...g.updates.filter((u) => u.status !== undefined)];
      const lastGo = statuses.map((u) => u.status).lastIndexOf('abandoned');
      const prior = statuses.slice(0, lastGo).map((u) => u.status).filter((x) => x !== 'abandoned').pop() ?? 'draft';
      appendLog({ type: 'goal', op: 'set', id, status: prior, decision: { verdict: 'restore', notes: flagStr('notes')?.trim() || undefined }, hold: { mode: 'park', reason: 'restored from let go' } }, by);
      nudgeSupervisor(`[devteam goal restore ${id} from owner] it is back as ${prior}, parked; its questions are in the inbox again`);
      return out(`${id}: restored as ${prior}, parked (goal hold ${id} run --owner to run it)`);
    }
    const notes = flagStr('notes')?.trim() || undefined;
    if (verdict === 'refine' && !notes) die('refine needs --notes: what the planner should change');
    const ask = flagStr('question') ? questions().find((q) => q.id === flagStr('question')) : questions().find((q) => q.kind === 'goal-approval' && q.goal === id && q.status === 'open');
    if (flagStr('question') && (!ask || ask.kind !== 'goal-approval' || ask.goal !== id)) die(`${flagStr('question')} is not a goal-approval question for ${id}`);
    if ((said || fromTurn) && ask?.status !== 'open') die(`goal decide --from-${said ? 'chat' : 'turn'} answers ${id}'s open goal-approval question, and there is none`);
    const turn = fromTurn ? turnAnswer('goal decide', ask) : null;
    if (verdict === 'approve') {
      const c = goalCheck(g);
      if (c.definition.length && !flags.force) die(`${id} is not fully defined:\n  - ${c.definition.join('\n  - ')}\n(--force to approve anyway)`);
      if (!ask && !flags.force) die(`${id} has no design up for approval: the supervisor writes and reviews the design first, then asks (ask --kind goal-approval --goal ${id}); --force to approve without one`);
    }
    const status = { approve: 'ready', refine: undefined, 'let-go': 'abandoned' }[verdict];
    appendLog({ type: 'goal', op: 'set', id, status, decision: { verdict, notes, question: ask?.id }, ...chat }, by);
    if (ask?.status === 'open') appendLog({ type: 'question', op: 'set', id: ask.id, answer: `${{ approve: 'Approve', refine: 'Refine', 'let-go': 'Let go' }[verdict]}${notes ? ` — ${notes}` : ''}`, ...chat, ...(said ? { said } : turn ? { said: turn.said, turn: turn.turn } : {}) }, by);
    if (!said && !turn) nudgeSupervisor(`[devteam goal ${verdict} ${id} from owner] read it with: devteam.mjs goal show ${id}${verdict === 'let-go' ? `; its sessions park: goal park-sessions ${id}` : ''}`);
    out(`${id}: ${verdict}${status ? ` (${status})` : ''}${verdict === 'let-go' ? '; its sessions park and its questions leave the inbox (goal decide restore undoes it)' : ''}`);
    // its answer resolves the question's thread, as answer's does (kit-720)
    if (ask?.status === 'open' && turn) resolveQuestionThreads(ask.id, null, 'supervisor', { turn: { id: turn.turn, thread: logGet(turn.turn)?.thread, said: turn.said } });
    else if (ask?.status === 'open' && !said) resolveQuestionThreads(ask.id, `${{ approve: 'Approve', refine: 'Refine', 'let-go': 'Let go' }[verdict]}${notes ? ` — ${notes}` : ''}`, by);
    return;
  }
  // The goal's toggle (planning.md §1, holds): run, drain or park. The owner sets any; the
  // supervisor drains a running goal (with a reason) and releases only its own drain.
  if (sub === 'hold') {
    const g = goalArg(id) ?? die('usage: goal hold <g-id|upkeep> run|drain|park [--reason "…"] [--for <cause>…] [--until <YYYY-MM-DD>] [--owner]');
    const mode = positional[2];
    if (!['run', 'drain', 'park'].includes(mode)) die('usage: goal hold <g-id|upkeep> run|drain|park [--reason "…"] [--for <cause>…] [--until <YYYY-MM-DD>] [--owner]');
    const by = flags.owner ? ownerWriter().by : (supervisorOnly('goal hold'), 'supervisor');
    if (g.status === 'met') die(`${g.id} is met; there is no work to hold`);
    if (g.status === 'abandoned') die(`${g.id} is let go: goal decide ${g.id} restore brings it back, parked`);
    const why = holdRefusal({ mode }, g.hold ?? { mode: 'run' }, g.hold_by ?? null, by);
    if (why) die(`goal hold: ${why}`);
    const reason = flagStr('reason')?.trim();
    if (by === 'supervisor' && !reason) die('the supervisor says why: --reason "…"');
    // a drain names what it waits on (holdCause): the supervisor's is checked, the owner's written as given
    const causes = flags.for !== undefined ? [...new Set(listFlag('for').map((c) => String(c).trim()).filter(Boolean))] : [];
    // trimmed, as ticket hold reads it; a bare or blank --until is still a date given, for the shape rules
    const until = flagStr('until')?.trim() || null;
    const dated = flags.until !== undefined;
    if (dated && !causes.length && by === 'supervisor') die('--until goes with --for: name what the hold waits on');
    if ((causes.length || dated || flags.for !== undefined) && isUpkeep(g)) die("Upkeep's hold takes no cause (--for, --until)");
    if ((causes.length || dated || flags.for !== undefined) && mode !== 'drain') die('--for goes with a drain');
    if (dated && until === null) die('--until needs a date (YYYY-MM-DD)');
    if (by === 'supervisor' && mode === 'drain' && !isUpkeep(g)) {
      const refusal = holdCause({ kind: 'goal', id: g.id, causes, until, whole: null });
      if (refusal) die(refusal);
    }
    const extra = { ...(causes.length ? { hold_for: causes } : {}), ...(causes.length || until !== null ? { hold_until: until } : {}) };
    const before = goalMode(g);
    const line = writeHold(g, { mode, ...(reason ? { reason: reason.slice(0, 300) } : {}) }, by, extra);
    logCache = null;
    const name = isUpkeep(g) ? 'upkeep' : g.id;
    const now = goalArg(isUpkeep(g) ? 'upkeep' : g.id);
    if (by === 'supervisor') appendLog({ type: 'act', decision: citing(), class: 'goal-hold', what: `${mode === 'drain' ? 'drained' : 'released my drain on'} ${isUpkeep(g) ? 'Upkeep' : `"${g.title}"`}: ${reason}${causes.length ? ` (for ${causes.join(', ')})` : ''}`, refs: [now.id], reversible: true }, 'supervisor');
    out(`${isUpkeep(g) ? 'Upkeep' : g.id} is ${holdWords(mode)} (${line.id})`);
    if (mode === 'park') {
      if (by === 'supervisor') { const sent = sendParkRulings({ goal: now }); out(sent.length ? `told ${sent.join(', ')} to commit, push, write a handoff and park` : 'no running session of it to tell'); }
      else nudgeSupervisor(`[devteam goal park ${name} from owner] send its sessions the park ruling: goal park-sessions ${name}`);
    }
    if (['park', 'let-go'].includes(before) && mode !== 'park') {
      const rows = restartCommands((x) => sessionGoals(x.name).some((y) => y.id === now.id) || (isUpkeep(now) && !sessionGoals(x.name).length));
      if (rows.length) out(`restart its parked sessions, as the supervisor:\n${rows.map((x) => `  devteam.mjs ${x.cmd}`).join('\n')}`);
      if (by !== 'supervisor') nudgeSupervisor(`[devteam goal ${mode} ${name} from owner] ${rows.length ? `restart: ${rows.map((x) => x.cmd).join('; ')}` : 'nothing parked to restart'}`);
    } else if (by !== 'supervisor' && mode !== 'park') nudgeSupervisor(`[devteam goal ${mode} ${name} from owner] ${mode === 'drain' ? 'start nothing new for it; let what runs finish' : 'it runs again'}`);
    return;
  }
  if (sub === 'park-sessions') {
    supervisorOnly('goal park-sessions');
    const g = flags.all ? null : goalArg(id) ?? die('usage: goal park-sessions <g-id|upkeep> | --all  [--again]');
    const sent = sendParkRulings({ goal: g, again: !!flags.again });
    return out(sent.length ? `told ${sent.join(', ')} to commit, push, write a handoff and park` : 'every session it holds has been told (--again re-sends to those not yet parked)');
  }
  if (sub === 'status') {
    const { by } = ownerWriter();
    const g = logGet(id);
    if (g?.type !== 'goal') die(`no goal ${id}`);
    const to = positional[2];
    if (!['draft', 'ready', 'met', 'abandoned'].includes(to)) die('status is draft, ready, met or abandoned');
    if (to === 'ready') die(`a goal becomes ready through its design: goal decide ${id} approve`);
    // Met means the measure says so: a repo goal's is read now, on main, and a prod goal's from
    // production; an owner goal's is the owner's yes. --force sets it anyway (the owner's call).
    const m = measureOf(g);
    if (to === 'met' && !flags.force && ['repo', 'prod'].includes(m.source) && m.check) {
      const r = runMeasureCheck(g);
      if (!reached(g, m.target, r.value)) die(`${id}'s check reads ${r.value}${r.sha ? ` on ${r.on} (${r.sha.slice(0, 12)})` : ' from production'}, not its target ${m.target}${ownerChannel() === 'dashboard' ? '; the goal keeps running' : '; --force to set it met anyway'}`);
    }
    if (to === 'met' && !flags.force && m.source === 'owner' && !goalReadings(id).some((x) => x.measure.value >= 1)) die(`${id} is met when the owner says so: answer its goal-met question, or record it with goal reading ${id} --value 1 --owner; --force to set it met anyway`);
    // marking it met answers its open goal-met question (Yes), as goal decide answers an approval
    const ask = to === 'met' ? questions().find((q) => q.class === 'goal-met' && q.goal === id && q.status === 'open') : null;
    appendLog({ type: 'goal', op: 'set', id, status: to, ...(to === 'met' ? { decision: { verdict: 'met', ...(ask ? { question: ask.id } : {}) } } : {}) }, by);
    if (ask) appendLog({ type: 'question', op: 'set', id: ask.id, answer: GOAL_MET_CHOICES[0].label }, by);
    out(`${id} is ${to}${ask ? ` (and ${ask.id} is answered Yes)` : ''}`);
    if (ask) resolveQuestionThreads(ask.id, GOAL_MET_CHOICES[0].label, by);
    return;
  }
  if (sub === 'forecast') {
    const g = logGet(id)?.type === 'goal' ? logGet(id) : die('usage: goal forecast <g-id>');
    const f = goalForecast(g);
    if (flags.json) return json(f);
    return out(f ? forecastText(g, f) : `${id} has no milestones yet`);
  }
  if (sub === 'show') { const g = goalArg(id) ?? die(`no goal ${id}`); return json(isUpkeep(g) ? { ...g, hold_view: holdView(g) } : goalView(g)); }
  // goal impact: the supervisor's judgment of how much a goal matters to the project, against
  // project/strategy.md. A constitutional decision (no rung, no --approved): the owner sees it on
  // the goal and corrects it with the value they give (correct <d-id> --impact n), which stands.
  if (sub === 'impact') {
    const usage = 'usage: goal impact <g-id> <1-4> --rationale "<why, citing the strategy>" [--confidence 0-1]   (4 the project depends on it, 3 moves a number the project watches, 2 worth having, 1 housekeeping)';
    supervisorOnly('goal impact');
    const g = logGet(id ?? '');
    const level = Number(positional[2]);
    if (g?.type !== 'goal' || isUpkeep(g) || !impactOf(level)) die(usage);
    if (['met', 'abandoned'].includes(g.status)) die(`${id} is ${g.status === 'met' ? 'met' : 'let go'}; its impact orders nothing now`);
    const rationale = flagStr('rationale')?.trim() || die(`goal impact needs --rationale: why, against the strategy (${strategyRel})`);
    const confidence = flagNum('confidence');
    if (confidence !== undefined && !(confidence >= 0 && confidence <= 1)) die('--confidence is a number from 0 to 1');
    const now = goalImpact(id);
    if (now?.by === 'owner') die(`the owner set ${id}'s impact to ${now.level} (${now.words}) when correcting ${now.decision}, and that stands. If you think it is wrong now, ask them; they change it with: correct ${now.decision} --impact <1-4> --reason "…"`);
    if (strategyState() !== 'written') warn(`${strategyRel} is ${strategyState() === 'missing' ? 'not on main yet' : 'still the template'}: an impact is judged against the strategy, so draft it and ask the owner to approve it (supervisor.md §1)`);
    const a = authorise('goal-impact', null, null, [id], 'goal impact');
    const line = appendLog({ type: 'decision', class: 'goal-impact', what: `${g.title}: ${IMPACT_WORDS[level]} (impact ${level} of 4)`, rationale, confidence, refs: [id], impact: level, reversible: true, rung: a.rung, ceiling: a.ceiling, authority: a.authority }, 'supervisor');
    return out(line.id);
  }
  if (sub === 'reading') {
    if (!id || logGet(id)?.type !== 'goal') die('usage: goal reading <g-id> --run | --approved <goal-met qid> | --value n [--source s] [--detail d]');
    const by = flags.owner ? ownerWriter().by : (supervisorOnly('goal reading'), 'supervisor');
    const g = logGet(id);
    const m = measureOf(g);
    const unit = m.unit;
    if (flags.run) {
      if (!['repo', 'prod'].includes(m.source) || !m.check) die(`${id} is read ${m.source ? `from ${m.source}` : 'by hand (no measure source)'}; --run runs a repo or prod measure's check`);
      const r = runMeasureCheck(g);
      appendLog({ type: 'observation', source: m.source, subject: id, kind: 'reading', detail: m.source === 'repo' ? `reading ${r.value}${unit ? ` ${unit}` : ''} on ${r.on} at ${r.sha.slice(0, 12)}` : `reading ${r.value}${unit ? ` ${unit}` : ''} from ${m.check}: ${r.out.slice(-300)}`, measure: { value: r.value, unit }, ...(r.sha ? { sha: r.sha } : {}), refs: [id] }, by);
      return out(`recorded ${r.value} for ${id}${r.sha ? ` (${r.on} at ${r.sha.slice(0, 12)})` : ''}`);
    }
    const approved = flagStr('approved');
    if (approved !== undefined) {
      if (m.source !== 'owner') die(`--approved records an owner goal's yes; ${id} is read ${m.source ? `from ${m.source}` : 'by hand'}`);
      const problem = goalMetProblem(logGet(approved), id, approved);
      if (problem) die(`${approved} does not attest ${id}: ${problem}`);
      if (goalReadings(id).some((x) => x.approved === approved)) die(`${approved} already recorded ${id}'s reading; one answer, one reading`);
      appendLog({ type: 'observation', source: 'owner', subject: id, kind: 'reading', detail: `the owner said yes to ${approved}`, measure: { value: 1, unit }, approved, refs: [id, approved] }, by);
      return out(`recorded 1 for ${id} (${approved})`);
    }
    if (['repo', 'prod'].includes(m.source)) die(`${id} is read from ${m.source}: the kit runs its check (goal reading ${id} --run), nobody types the number`);
    if (m.source === 'owner' && by !== 'owner') die(`${id} is the owner's yes: ask a goal-met question (ask --class goal-met --goal ${id} --recommendation yes); the owner's yes records the reading and marks it met`);
    const v = flagNum('value');
    if (v === undefined || Number.isNaN(v)) die('goal reading needs --value <number>');
    appendLog({ type: 'observation', source: flagStr('source') ?? by, subject: id, kind: 'reading', detail: flagStr('detail') ?? `reading ${v}${unit ? ` ${unit}` : ''}`, measure: { value: v, unit }, refs: [id] }, by);
    return out(`recorded ${v} for ${id}`);
  }
  if (sub === 'check') {
    const gs = (id ? [logGet(id)] : logObjects('goal')).filter((g) => g?.type === 'goal' && !['met', 'abandoned'].includes(g.status));
    let gaps = 0;
    for (const g of gs) {
      const c = goalCheck(g);
      const approvalGaps = (g.status ?? 'draft') === 'draft' || c.approval.length ? c.approval : [];
      gaps += c.definition.length + approvalGaps.length + c.coverage.length;
      out(`${g.id} [${g.status ?? 'draft'}] ${g.title}`);
      for (const d of c.definition) out(`  definition: ${d}`);
      for (const d of approvalGaps) out(`  milestones: ${d}`);
      for (const d of c.coverage) out(`  coverage: ${d}`);
      if (c.later.length) out(`  later milestones: precondition ${c.later.join(', ')} are planned once milestone ${c.current_milestone} is met`);
      if (!c.definition.length && !approvalGaps.length && !c.coverage.length) out('  ok');
    }
    if (gaps && flags.strict) process.exit(1);
    return;
  }
  const gs = logObjects('goal').map(goalView).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  if (flags.json) return json(gs);
  const u = holdView(upkeepOrVirtual());
  out(`upkeep [${u.state}${u.reason ? `: ${u.reason}` : ''}] Upkeep: chores, CI fixes, retros, kit syncs`);
  if (!gs.length) return out('no goals (the owner states them; planning.md §1)');
  for (const g of gs) {
    const last = g.readings[g.readings.length - 1];
    out(`${g.id} [${g.status}${g.priority ? `, p${g.priority}` : ''}${g.impact ? `, impact ${g.impact.level}` : ''}${g.hold_view.mode !== 'run' ? `, ${g.hold_view.state}` : ''}] ${g.title}\n  ${g.measure?.description ?? '-'}: ${last ? last.value : '?'} -> ${g.measure?.target ?? '?'} ${g.measure?.unit ?? ''} by ${g.horizon ?? '?'}${g.track ? ` (${g.track})` : ''}; features: ${g.check.features.join(', ') || 'none'}`);
  }
}

// --- the roadmap: computed, never written ---

export function collectRoadmap() {
  const prog = collectProgress();
  const items = prog.tickets;
  const now = Date.now();
  const firstAdd = Math.min(now, ...items.map((t) => Date.parse(t.added_at)));
  const windowDays = Math.max(1, Math.min(14, (now - firstAdd) / DAY));
  const recentPts = items.filter((t) => t.merged_at && now - Date.parse(t.merged_at) <= windowDays * DAY).reduce((a, t) => a + t.weight, 0);
  const rate = recentPts / windowDays;
  const m = collectMetrics(0);
  const cycleDays = m.cycle_hours.median ? m.cycle_hours.median / 24 : null;
  const openQs = questions().filter((q) => q.status === 'open');
  const goals = logObjects('goal').filter((g) => !['met', 'abandoned'].includes(g.status)).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  // A parked goal's work stands still, so it stays out of the queue the others' dates come from.
  const rankOf = new Map(goals.filter((g) => goalMode(g) !== 'park').map((g, i) => [g.id, i]));
  const fs_ = features();
  const views = [...new Set([...items.map((t) => t.feature), ...fs_.keys()])].map((fid) => {
    const f = fs_.get(fid);
    const ts = items.filter((t) => t.feature === fid);
    const left = ts.filter((t) => !t.merged_at);
    const sub = new Map(left.map((t) => [t.id, { ...t, depends_on: t.depends_on.filter((d) => left.some((x) => x.id === d)) }]));
    const waves = sub.size && !findCycle(sub) ? Math.max(...levels(sub).values()) + 1 : 0;
    const stories = f?.stories ?? [];
    const storyDone = stories.filter((s) => { const st = ts.filter((t) => t.serves.includes(s.id)); return st.length && st.every((t) => t.merged_at); }).length;
    return {
      feature: fid, title: f?.title ?? fid, status: f ? (ts.length && ts.every((t) => t.merged_at) ? 'done' : ts.some((t) => t.merged_at || t.phase) ? 'in progress' : 'planned') : fid === CHORES ? 'chores' : 'no feature line', goals: f?.goals ?? [],
      points_total: ts.reduce((a, t) => a + t.weight, 0), points_left: left.reduce((a, t) => a + t.weight, 0),
      stories: { done: storyDone, total: stories.length }, waves_left: waves,
      releases: [...new Set(stories.map((s) => s.release).filter(Boolean))].sort(),
      blocked_by_questions: openQs.filter((q) => q.blocks.some((b) => ts.some((t) => t.id === b))).map((q) => q.id),
    };
  });
  const bestRank = (v) => Math.min(99, ...v.goals.map((g) => rankOf.get(g) ?? 99));
  const ordered = views.filter((v) => v.goals.some((g) => rankOf.has(g))).sort((a, b) => bestRank(a) - bestRank(b) || b.waves_left - a.waves_left || b.points_left - a.points_left);
  let cum = 0;
  for (const v of ordered) {
    cum += v.points_left;
    v.done = v.points_total > 0 && v.points_left === 0;
    v.eta = !v.points_left || !rate ? null : dateOnly(new Date(now + Math.max(cum / rate, cycleDays ? v.waves_left * cycleDays : 0) * DAY).toISOString());
  }
  const base = { features: Object.fromEntries(views.map((v) => [v.feature, v])), rate_points_per_day: rate, median_cycle_days: cycleDays };
  const goalRows = goals.map((g) => {
    const c = goalCheck(g);
    const feats = ordered.filter((v) => v.goals.includes(g.id));
    const etas = feats.map((v) => v.eta).filter(Boolean).sort();
    // With milestones, the goal's date is the forecast's: later milestones count by their estimate.
    const fc = goalForecast(g, base);
    const parked = goalMode(g) === 'park';
    const eta = parked ? null : fc ? (fc.milestones.every((m) => m.status === 'met') ? 'done' : fc.eta) : c.unplanned.length || !feats.length ? null : feats.every((v) => v.done) ? 'done' : etas.pop() ?? null;
    return { id: g.id, title: g.title, priority: g.priority ?? null, status: g.status ?? 'draft', hold: goalMode(g), unplanned: c.unplanned.filter((u) => !c.later.includes(u.n)), later: c.later, current_milestone: c.current_milestone, milestones: fc?.milestones ?? [], past_horizon: fc?.past_horizon ?? false, features: feats.map((v) => v.feature), eta, has_design: !c.coverage.some((x) => x.startsWith('no design')) };
  });
  return {
    generated_at: nowIso(), rate_points_per_day: +rate.toFixed(2), median_cycle_days: cycleDays === null ? null : +cycleDays.toFixed(1),
    goals: goalRows, features: Object.fromEntries(views.map((v) => [v.feature, v])), unassigned: views.filter((v) => v.feature !== CHORES && !v.goals.some((g) => logGet(g)?.type === 'goal')).map((v) => v.feature),
    note: 'Estimates assume goal-priority order at the current rate; a feature finishes no sooner than its remaining waves times the median cycle time. A goal with milestones is dated by its forecast (unplanned milestones by their size); one without, and with unplanned preconditions, has no date.',
  };
}
export const weekOf = (d) => { if (!d) return 'no date'; const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return `week of ${dateOnly(x.toISOString())}`; };
export function roadmapText(r) {
  const L = [`rate ${r.rate_points_per_day} points/day; median cycle ${r.median_cycle_days ?? '-'} days`];
  for (const g of r.goals) {
    L.push('', `${g.priority ? `p${g.priority} ` : ''}${g.title} [${g.status}${g.hold !== 'run' ? `, ${holdWords(g.hold)}` : ''}] -> ${g.hold === 'park' ? 'no date while parked' : g.eta === 'done' ? 'done' : weekOf(g.eta)}${g.past_horizon ? ' (after its horizon)' : ''}${g.has_design ? '' : ' (no design)'}`);
    for (const m of g.milestones) L.push(`  milestone ${m.n} [${m.status}] ${m.title} -> ${m.eta === 'met' ? 'met' : weekOf(m.eta)}${m.features.length ? '' : ` (about ${m.estimate_tickets} tickets, unplanned)`}${m.late ? ' (after its date)' : ''}`);
    for (const u of g.unplanned) L.push(`  unplanned: precondition ${u.n}: ${u.text}`);
    for (const f of g.features) {
      const v = r.features[f];
      L.push(`  ${v.feature} [${v.status}] ${v.points_total - v.points_left}/${v.points_total} pts, stories ${v.stories.done}/${v.stories.total}, ${v.waves_left} waves left${v.releases.length ? `, ${v.releases.join(' ')}` : ''} -> ${v.done ? 'done' : weekOf(v.eta)}${v.blocked_by_questions.length ? `; waiting on ${v.blocked_by_questions.join(' ')}` : ''}`);
    }
  }
  if (r.unassigned.length) L.push('', `serving no goal: ${r.unassigned.join(', ')}`);
  return L.join('\n');
}
export function cmdRoadmap() {
  const r = collectRoadmap();
  if (flags.json) return json(r);
  out(`${roadmapText(r)}\n\n${r.note}`);
}

// --- chore worktrees: supervisor-written files reach main through their own branch and PR ---

// A chore slug names a branch (chore-<slug>), a worktree and a PR file, so every command that takes
// one checks it the same way: lowercase words joined by hyphens or dots (devteam-sync-v1.2.0), never
// a path, and never ending in .lock (git refuses such branch names).
export function choreSlug(slugName) {
  if (!/^[a-z0-9]+([.-][a-z0-9]+)*$/.test(slugName ?? '') || /\.lock$/.test(slugName)) die(`chore slug "${slugName}" must be lowercase words joined by hyphens (dots allowed, as in devteam-sync-v1.2.0; not ending in .lock)`);
  return slugName;
}
// A new chore worktree gets settings.worktree_files (a gitignored key, an .env) so gates can run in
// it; `chore start` also runs worktree_setup there. log-sync and retro only commit files, so they
// skip the setup. responder: the responder's draft (responder draft), from its own worktree: honoured
// only for the responder writer with DEVTEAM_ROLE unset or responder, so the flag alone lets no one
// else past the main-checkout check (kept inline: test D7 loads this function by itself); it never
// takes a worktree that appeared since the responder looked, so a rollback only removes its own.
// start: the commit a missing worktree starts at (chore start and chore pr on an open branch, kit-296)
export function choreWorktree(slugName, { reset = false, setup = false, responder = false, start } = {}) {
  choreSlug(slugName);
  if (!commonDir || !projectInRepo) die('chores need a git checkout with the project folder inside it');
  if (repoRoot !== mainRoot && !(responder && logWriter() === 'responder' && [undefined, '', 'responder'].includes(process.env.DEVTEAM_ROLE))) die(`run this from the main checkout (${mainRoot})`);
  const wt = path.join(mainRoot, '.worktrees', `chore-${slugName}`);
  const main = loadSettings().main_branch;
  if (!flags['dry-run']) fetchPastHalfMade(['fetch', '--quiet', 'origin', main]);
  const base = resolveCommit(`origin/${main}`) ? `origin/${main}` : main;
  const existed = fs.existsSync(wt);
  // add and reset with -c core.useReplaceRefs=false (kit-778): a replace ref or core.useReplaceRefs any session can set would otherwise swap the tree checked out
  if (!existed) {
    const add = ['-c', 'core.useReplaceRefs=false', 'worktree', 'add', '--quiet', '-B', `chore-${slugName}`, wt, start ?? base];
    const ref = `refs/heads/chore-${slugName}`;
    const branchConfig = () => git(['config', '--local', '--get-regexp', `^branch\\.chore-${slugName.replaceAll('.', '\\.')}\\.[^.]+$`], mainRoot);
    const was = { tip: resolveCommit(ref), config: branchConfig() };
    let set = null, tip, from;
    const r = pastHalfMade(() => {
      try { execFileSync('git', add, { cwd: mainRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return { ok: true }; } catch (e) { return { ok: false, err: e.stderr, words: (e.stderr || e.message).toString().trim() }; }
    }, {
      common: commonDir, wt,
      before: () => { tip = resolveCommit(ref); from = resolveCommit(start ?? base); },
      // where this try moved the branch, read now: origin's main can move during the wait. Only to
      // the commit this start asked for: any other move is another hand's
      after: () => { const now = resolveCommit(ref); if (now !== tip && (now === from || now === resolveCommit(start ?? base))) set = now; },
      // -B would set a branch another hand moved meanwhile back to where this start began
      stop: () => (resolveCommit(ref) !== (set ?? was.tip) ? `chore-${slugName} moved meanwhile and is left where it is: start it again` : null),
    });
    if (!r.ok) {
      // -B sets the branch before it checks out, so a try that met a half-made entry can leave it:
      // put back, unless it moved since, or the worktree or its entry is there now (another start's)
      if (r.waited && !fs.existsSync(wt) && !fs.existsSync(path.join(commonDir, 'worktrees', `chore-${slugName}`))) {
        if (set && set !== was.tip) git(['update-ref', ...(was.tip ? [ref, was.tip, set] : ['-d', ref, set])], mainRoot);
        if (!was.tip && !was.config && branchConfig() && !resolveCommit(ref)) git(['config', '--local', '--remove-section', `branch.chore-${slugName}`], mainRoot);
      }
      die(`git ${add.join(' ')} failed: ${r.words}${r.note}`);
    }
    seedWorktree(wt, { setup, session: true });
  }
  else if (reset) gitOrDie(['-c', 'core.useReplaceRefs=false', 'checkout', '--quiet', '-B', `chore-${slugName}`, base], wt);
  else if (responder) die(`.worktrees/chore-${slugName} appeared meanwhile: responder draft again`);
  // in use again: the tick's tidy leaves a worktree alone until it has been quiet a while
  else { const now = new Date(); try { fs.utimesSync(wt, now, now); } catch {} }
  // one there already whose setup never passed (cut short at the deadline, held for a slot, failed:
  // the marker is cleared before a setup and written only after one passes) is seeded now; never a
  // secret post's (secret-…), whose posting never waits for a setup
  const home = repo('home');
  if (existed && setup && !/^secret-/.test(slugName) && home.settings.worktree_setup && setupMarker.needed(wt, home.settings, home.root)) seedWorktree(wt, { setup, session: true });
  return wt;
}
// chore-records start
// Chore records (kit-296): what a chore is for, and whether its branch is open. A branch with no
// record is still open chore work (the C rows read git); a record adds its title and refs. Two
// rules from the next-moves design's "When a chore is open", which kit-293's C rows reuse:
// choreTipMerged (is this tip landed) and choreDropHolding (which drop ends it). No branch is
// ever deleted or moved here.
//
// The branch's tips: origin's (asked, then fetched into refs/remotes/origin/chore-<slug>) and the
// local one. The tip is origin's unless origin's is an ancestor of the local one (unpushed work
// is work), or the other side is merged; diverged when both carry work. No branch anywhere: tip null.
export function choreBranch(slugName) {
  const ref = `chore-${slugName}`;
  const remote = `refs/remotes/origin/${ref}`;
  let gone = false;
  if (!flags['dry-run'] && git(['config', '--get', 'remote.origin.url']) !== null) {
    const ls = gitRun(['ls-remote', '--exit-code', 'origin', `refs/heads/${ref}`]);
    if (ls.status === 0) {
      const f = fetchPastHalfMade(['fetch', '--quiet', 'origin', `+refs/heads/${ref}:${remote}`]);
      if (f.status !== 0) warn(`couldn't fetch ${ref} from origin (${firstLine(f.err) || `exit ${f.status}`}); reading the refs as they are`);
    } else if (ls.status === 2) gone = true; // not on origin: a stale copy of it says nothing (and stays)
    else warn(`couldn't ask origin for ${ref} (${firstLine(ls.err) || `exit ${ls.status}`}); reading the refs as they are`);
  }
  const at = (r) => git(['rev-parse', '--verify', '--quiet', `${r}^{commit}`]) || null;
  const local = at(`refs/heads/${ref}`);
  const origin = gone ? null : at(remote);
  if (!local || !origin || local === origin) return { local, origin, tip: origin ?? local, diverged: false };
  if (ancestorOf(origin, local) === true) return { local, origin, tip: local, diverged: false };
  if (ancestorOf(local, origin) === true) return { local, origin, tip: origin, diverged: false };
  // a side whose tip is merged carries nothing of its own (a --fresh start not yet pushed, or a
  // pushed tip squashed since): the tip is the other side's
  if (choreTipMerged(slugName, local)) return { local, origin, tip: origin, diverged: false };
  if (choreTipMerged(slugName, origin)) return { local, origin, tip: local, diverged: false };
  return { local, origin, tip: origin, diverged: true };
}
// Merged: in main; or git cherry lists no + (each commit's patch is in main); or a merge-chore act
// names chore-<slug> at the tip or at a commit the tip is an ancestor of (a squash of several).
export function choreTipMerged(slugName, tip) {
  const main = mainRef();
  if (!tip || !main) return false;
  if (ancestorOf(tip, main) === true) return true;
  const ch = gitRun(['cherry', main, tip]);
  if (ch.status === 0 && !/^\+/m.test(ch.out)) return true;
  const at = new RegExp(`^merged chore-${escapeRe(slugName)} at ([0-9a-f]{40})\\b`);
  return logObjects('act').some((a) => {
    if (a.class !== 'merge-chore') return false;
    const s = at.exec(String(a.what ?? ''))?.[1];
    return !!s && (s === tip || ancestorOf(tip, s) === true);
  });
}
// The newest chore-drop decision that holds on tip, as { id, sha }, or null. A decision names the
// branch by refs (exactly chore-<slug>) or by the token chore-<slug> in what, with no letter,
// digit, - or . beside it once one sentence-ending . is set aside. Its sha is the first 7-40 hex
// token after that token (in all of what when only refs name it). With a sha this clone has, it
// holds while the tip is that commit or an ancestor of it; else while no commit is newer than it.
export function choreDropHolding(slugName, tip) {
  if (!tip) return null;
  const name = `chore-${slugName}`;
  const tok = new RegExp(`(?<![A-Za-z0-9.-])${escapeRe(name)}(?=\\.?(?:[^A-Za-z0-9.-]|$))`);
  const tipAt = commitDateOf(tip);
  let held = null;
  for (const d of logObjects('decision')) {
    if (d.class !== 'chore-drop' || correctionOf(d)) continue;
    const what = String(d.what ?? '');
    const m = tok.exec(what);
    if (!m && !(d.refs ?? []).includes(name)) continue;
    const sha = /(?<![0-9A-Za-z])[0-9a-f]{7,40}(?![0-9A-Za-z])/.exec(m ? what.slice(m.index + name.length) : what)?.[0] ?? null;
    // resolved here, never taken on its form: a 40-hex sha this clone lacks reads as no sha
    const full = sha ? git(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]) || null : null;
    const holds = full ? ancestorOf(tip, full) === true : !(tipAt > Date.parse(d.created_at));
    if (holds && (!held || d.created_at >= held.at)) held = { id: d.id, sha, at: d.created_at };
  }
  return held && { id: held.id, sha: held.sha };
}
export const choreDropWords = (slugName, tip, drop, wtThere = false) => `chore-${slugName} at ${tip} is dropped (chore drop ${drop.id}, at ${drop.sha ?? 'no sha'}): ${wtThere ? `remove .worktrees/chore-${slugName} (git worktree remove), then ` : ''}chore start ${slugName} --fresh starts it again from main, or commit to it again to reopen it`;
// --what: one plain line, the chore's title for the owner; --for: the refs it serves (goal:<id>, a ticket).
export function choreRecordFlags(slugName) {
  const what = flags.what === undefined ? undefined : (flagStr('what') ?? '').trim();
  if (what !== undefined && (!what || /[\r\n]/.test(what) || what.length > 200)) die('--what is one plain line of 1 to 200 characters');
  const given = [...new Set(asList(flags.for).flatMap((v) => String(v).split(/[\s,]+/)).filter(Boolean))];
  if (flags.for === true || (flags.for !== undefined && !given.length)) die('--for names the refs the chore serves: --for goal:<id>[,<id>…]');
  const refs = given.filter((r) => r !== `chore-${slugName}`);
  if (refs.length > 10 || refs.some((r) => r.length > 120)) die('--for takes at most 10 refs, each at most 120 characters');
  return { what, refs };
}
export const choreRecord = (slugName, what, refs) => appendLog({ type: 'act', class: 'chore-start', what, refs: [`chore-${slugName}`, ...refs], reversible: true }, 'supervisor');
// chore start and chore pr make a missing worktree from an existing branch only when it is open:
// diverged, dropped and (for pr) merged are refused; for start, merged starts from main
export function choreOpenTip(slugName, b, verb) {
  if (b.diverged) die(`chore-${slugName} differs here (${b.local}) and on origin (${b.origin}): bring them together first; ${verb} changed nothing`);
  if (choreTipMerged(slugName, b.tip)) return null;
  const drop = choreDropHolding(slugName, b.tip);
  if (drop) die(choreDropWords(slugName, b.tip, drop));
  return b.tip;
}
// chore-records end
export function openPr(wt, branch, title, bodyText) {
  const main = loadSettings().main_branch;
  if (loadSettings().forge === 'git') {
    // No forge: the PR text waits in run/pr/ for merge to check.
    const f = path.join(runDir, 'pr', `${branch}.md`);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `# ${title}\n\n${bodyText}\n\n## One-way doors\n\nNone.\n`);
    return `forge is git; PR text in ${path.relative(mainRoot, f)}; land it with: merge --chore ${branch.replace(/^chore-/, '')}`;
  }
  let pr = repo('home').gh(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'url', '--jq', '.[0].url'], { cwd: wt });
  if (pr === null) { warn('gh is not available; open the PR by hand'); return ''; }
  if (!pr) pr = repo('home').gh(['pr', 'create', '--head', branch, '--base', main, '--title', title, '--body', `${bodyText}\n\n## One-way doors\n\nNone.\n`], { cwd: wt }) ?? '';
  return pr;
}
// The improvement loop is Upkeep's work: while Upkeep is drained or parked it starts nothing new
// (a trial, a proposal, a trust question, a proposed lesson, a retro); --force does, logged by
// the act or line itself. Observing (metrics, findings, readings) and the record never stop.
export function upkeepAllows(what, { noForce = false } = {}) {
  const m = goalMode(upkeepOrVirtual());
  if (m === 'run' || (flags.force && !noForce)) return;
  die(`Upkeep is ${holdWords(m)}: ${what} waits until it runs (goal hold upkeep run --owner)${noForce ? ' (--force does not reach a production write)' : ', or --force'}`);
}
// Chores that keep the record rather than do upkeep: never held.
// Files agent harnesses write into a checkout while they run: machine-local state, never the
// project's (a lock, personal settings, the harness's own worktrees, chat caches). init ignores them;
// one already tracked is a finding, and their churn never counts as a session's uncommitted work.
// Shared harness config (.claude/settings.json, skills, agents, AGENTS.md) is the project's and stays.
export const HARNESS_RUNTIME = ['.claude/*.lock', '.claude/settings.local.json', '.claude/worktrees/', '.aider*'];
export const runtimePatRe = (pat) => new RegExp(`^${pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\/$/, '/.*')}$`);
export const RUNTIME_RES = HARNESS_RUNTIME.map((pat) => [pat, runtimePatRe(pat)]);
export const isHarnessRuntime = (f) => RUNTIME_RES.some(([, re]) => re.test(f));
// git status --porcelain, less the harness's runtime files
export const workLines = (porcelain) => (porcelain ?? '').split('\n').filter(Boolean).filter((l) => !isHarnessRuntime(l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop()));
export const isRecordKeeping = (slug) => ['log', 'fleet-handoff', 'drain-handoff'].includes(slug) || /^secret-/.test(slug ?? '');
// Upkeep's last 14 UTC days, oldest first: the chores merged, kit syncs, CI fixes (which mark the day
// failed) and retros, each once a day. Record-keeping chores aren't upkeep; a retro-* chore's retro
// counts as its observation. A merge act with no chore ref (an older line, a plan) is passed over.
export function upkeepDays(now = Date.now()) {
  const DAY = 864e5;
  const n = new Date(now);
  const day0 = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  const days = Array.from({ length: 14 }, (_, i) => ({ starts_at: new Date(day0 - (13 - i) * DAY).toISOString(), items: [], failed: false }));
  const seen = new Set();
  const add = (at, kind, ref, words, failed = kind === 'ci-fix') => {
    const i = Math.floor((Date.parse(at) - (day0 - 13 * DAY)) / DAY);
    if (!(i >= 0 && i <= 13)) return;
    const key = `${i}|${kind}|${ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    days[i].items.push({ kind, ref, words, at });
    if (failed) days[i].failed = true;
  };
  for (const a of logObjects('act')) {
    if (a.created_by !== 'supervisor' || !Array.isArray(a.refs)) continue;
    const ref = a.refs[0];
    if (a.class === 'merge-chore') {
      const slug = typeof ref === 'string' ? ref.match(/^chore-(.+)$/)?.[1] : null;
      if (!slug || isRecordKeeping(slug) || /^retro-/.test(slug)) continue;
      const sync = slug.match(/^devteam-sync-(.+)$/);
      if (sync) add(a.created_at, 'kit-sync', ref, `Kit synced to ${sync[1]}`);
      else if (/^(ci-fix|devteam-workflow)/.test(slug)) add(a.created_at, 'ci-fix', ref, `CI fix ${slug}`);
      else add(a.created_at, 'chore', ref, `Merged chore ${slug}`);
    } else if (a.class === 'merge-word') {
      const t = tickets().get(ref);
      if (t?.feature === CHORES) add(a.created_at, 'chore', ref, `Merged ${t.title}`);
    }
  }
  for (const o of logObjects('observation')) if (o.kind === 'retro' && o.created_by === 'supervisor') add(o.created_at, 'retro', o.id, 'Retro');
  // each check result (kit-168): one per job and slot, the supervisor's detector recurring lines only, for
  // any job that ran, on main now or not; a fail or an error turns its day red
  const ran = new Set(logObjects('observation').filter((o) => o.kind === 'recurring-run' && recurringFailures.counts(o) && String(o.subject ?? '').startsWith('recurring:')).map((o) => o.subject.slice('recurring:'.length)));
  const WORDS = { pass: 'passed', fail: 'failed', error: 'errored' };
  for (const name of ran) for (const r of recurringFailures.results(name)) add(r.at, 'check', r.id, `Check ${name} ${WORDS[r.status]}`, r.status !== 'pass');
  for (const d of days) d.items.sort((a, b) => a.at.localeCompare(b.at));
  return days;
}
export function cmdChore() {
  const [sub, slugName] = positional;
  if (sub === 'start') {
    if (!slugName) die('usage: chore start <slug>');
    supervisorOnly('chore');
    choreSlug(slugName);
    // Upkeep work starts only while Upkeep runs; keeping the record (the log, the fleet handoff,
    // posted secrets) never waits.
    const um = goalMode(upkeepOrVirtual());
    if (um !== 'run' && !isRecordKeeping(slugName) && !flags.force) die(`Upkeep is ${holdWords(um)}: no new upkeep chore starts (goal hold upkeep run --owner, or --force, logged)`);
    const rec = choreRecordFlags(slugName);
    if (!commonDir || !projectInRepo) die('chores need a git checkout with the project folder inside it');
    if (repoRoot !== mainRoot) die(`run this from the main checkout (${mainRoot})`);
    // a missing worktree on a branch that exists: an open tip is checked out as it is, a merged one
    // starts from main, a dropped one only with --fresh (whose act names the old tip first)
    let start;
    let recorded = false;
    const made = !fs.existsSync(path.join(mainRoot, '.worktrees', `chore-${slugName}`));
    if (!made && flags.fresh) die(`.worktrees/chore-${slugName} is there: --fresh starts a missing worktree only; remove it first (git worktree remove .worktrees/chore-${slugName})`);
    if (!made) {
      const head = git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], path.join(mainRoot, '.worktrees', `chore-${slugName}`));
      const drop = head && !choreTipMerged(slugName, head) ? choreDropHolding(slugName, head) : null;
      if (drop) die(choreDropWords(slugName, head, drop, true));
    }
    if (made) {
      const b = choreBranch(slugName);
      if (b.diverged) die(`chore-${slugName} differs here (${b.local}) and on origin (${b.origin}): bring them together first; chore start changed nothing`);
      if (flags.fresh) {
        const drop = choreDropHolding(slugName, b.tip);
        if (!drop) die(`no chore drop holds chore-${slugName}${b.tip ? ` at ${b.tip}` : ''}: --fresh starts again from main only a dropped branch`);
        choreRecord(slugName, `${rec.what ?? `started chore-${slugName}`}; fresh from main; old tip ${b.tip}`, rec.refs);
        recorded = true;
      } else if (b.tip) start = choreOpenTip(slugName, b, 'chore start') ?? undefined;
    }
    const wt = choreWorktree(slugName, { setup: true, start });
    if (!recorded && (made || rec.what !== undefined || rec.refs.length)) choreRecord(slugName, rec.what ?? `started chore-${slugName}`, rec.refs);
    // the jobs' chore started past Upkeep's hold is the supervisor's call, so it is logged (kit-162)
    const holdRefs = ['upkeep', 'chore-recurring'];
    if (um !== 'run' && slugName === 'recurring') appendLog({ type: 'act', class: 'goal-hold', what: `started chore-recurring while Upkeep is ${um === 'drain' ? 'drained' : holdWords(um)}, with --force`, refs: holdRefs, reversible: true }, 'supervisor');
    return out(wt);
  }
  if (sub === 'adopt' || sub === 'drop') {
    if (!slugName) die(`usage: chore ${sub} <slug> ${sub === 'drop' ? '--reason "<why>"' : '[--what "…"] [--for <refs>]'}`);
    supervisorOnly('chore');
    choreSlug(slugName);
    if (flags.fresh) die("--fresh is chore start's");
    const reason = sub === 'drop' ? (flagStr('reason') ?? '').trim() : null;
    if (sub === 'drop' && (!reason || /[\r\n]/.test(reason) || reason.length > 500)) die('chore drop needs --reason "<why>", one line of 1 to 500 characters');
    const rec = sub === 'adopt' ? choreRecordFlags(slugName) : null;
    if (!commonDir) die('chores need a git checkout');
    const b = choreBranch(slugName);
    if (!b.tip) die(`no branch chore-${slugName} locally or on origin`);
    if (sub === 'adopt') return out(choreRecord(slugName, rec.what ?? `adopted chore-${slugName} at ${b.tip}`, rec.refs).id);
    const d = appendLog({ type: 'decision', class: 'chore-drop', what: `dropped chore-${slugName} at ${b.tip}: ${reason}`, rationale: reason, refs: [`chore-${slugName}`], reversible: true, authority: 'constitution' }, 'supervisor');
    return out(`${d.id}\nchore-${slugName} stays on every ref${fs.existsSync(path.join(mainRoot, '.worktrees', `chore-${slugName}`)) ? `, and so does .worktrees/chore-${slugName}` : ''}; chore start ${slugName} --fresh starts it again from main`);
  }
  if (sub !== 'pr' || !slugName || !flagStr('title')) die('usage: chore start <slug> [--what "…"] [--for <refs>] [--fresh]   |   chore adopt <slug> [--what "…"] [--for <refs>]   |   chore drop <slug> --reason "<why>"   |   chore pr <slug> --title "<summary>" [--names-checked <word,…>]');
  // --names-checked a,b: the self.md and exterior.md drafts' words the supervisor has checked are fine to name in public
  const named = flags['names-checked'] === undefined ? null : asList(flags['names-checked']).flatMap((v) => String(v).split(',')).map((x) => x.trim());
  if (named && (!named.length || named.some((x) => !x))) die('--names-checked needs one or more words, comma-separated');
  supervisorOnly('chore');
  choreSlug(slugName);
  const wt = path.join(mainRoot, '.worktrees', `chore-${slugName}`);
  if (flags.fresh) die("--fresh is chore start's");
  if (!fs.existsSync(wt)) {
    const b = commonDir ? choreBranch(slugName) : { tip: null };
    if (!b.tip) die(`no worktree .worktrees/chore-${slugName}; devteam.mjs chore start ${slugName}`);
    const tip = choreOpenTip(slugName, b, 'chore pr');
    if (!tip) die(`chore-${slugName} is merged at ${b.tip}: chore start ${slugName} starts it again from main`);
    choreWorktree(slugName, { setup: true, start: tip });
  }
  // a plain folder left where the worktree was would have git add the main checkout's changes
  if (realPath(git(['rev-parse', '--show-toplevel'], wt) ?? '') !== realPath(wt)) die(`.worktrees/chore-${slugName} is not a worktree (was it tidied away?): move what you wrote aside, then devteam.mjs chore start ${slugName}`);
  // origin's main as it is now: the base and the names the strategy and dependency files allow
  fetchMain();
  // the exterior.md hold (kit-135), before anything is staged: the working tree's draft and every
  // version already committed since main, so a refused name is never committed by this run
  const named0 = named && new Set(named);
  const exTree = exteriorChoreLines(wt, 'tree', { base: mainRef() ? git(['merge-base', mainRef(), gitOrDie(['rev-parse', 'HEAD'], wt)]) : null, checkedWords: named0 });
  if (exTree.fails.length) die(exTree.fails.map((f) => `chore pr: ${f}`).join('\n'));
  gitOrDie(['add', '-A'], wt);
  const committed = Boolean(gitOrDie(['status', '--porcelain'], wt));
  if (committed) gitOrDie(['commit', '--quiet', '-m', `chore-${slugName}: ${flagStr('title')}`], wt);
  // the self.md hold (spec §3.3): a refusal undoes this run's commit, and only it, so the draft stays
  // staged as it was and the refused words never reach a pushed commit
  const head = gitOrDie(['rev-parse', 'HEAD'], wt);
  // a drop that still holds at the head (nothing new committed since it): its commits stay unproposed
  const dropped = choreTipMerged(slugName, head) ? null : choreDropHolding(slugName, head);
  if (dropped) {
    if (committed) gitOrDie(['reset', '--quiet', '--soft', 'HEAD~1'], wt);
    die(choreDropWords(slugName, head, dropped, true));
  }
  // the push is forced: origin's tip as it is now, with commits this head lacks, is open work it would
  // overwrite (a start that couldn't reach origin, or a push from elsewhere), unless it is merged or
  // a drop holds it (the --fresh case)
  const there = choreBranch(slugName).origin;
  if (there && there !== head && ancestorOf(there, head) !== true && !choreTipMerged(slugName, there) && !choreDropHolding(slugName, there)) {
    if (committed) gitOrDie(['reset', '--quiet', '--soft', 'HEAD~1'], wt);
    die(`chore-${slugName} on origin is at ${there}, with commits this head (${head}) lacks: bring them in first (git -C .worktrees/chore-${slugName} pull --rebase origin chore-${slugName}), or chore drop ${slugName} to replace them; chore pr changed nothing`);
  }
  const base = mainRef() ? git(['merge-base', mainRef(), head]) : null;
  // and again over every version since main, after the commit and before the push (kit-135)
  const exRange = exteriorChoreLines(wt, 'range', { base, checkedWords: named0 });
  if (exRange.fails.length) {
    if (committed) gitOrDie(['reset', '--quiet', '--soft', 'HEAD~1'], wt);
    die(exRange.fails.map((f) => `chore pr: ${f}`).join('\n'));
  }
  const held = choreSelfHold(slugName, base, head, named0, exRange.changed);
  if (held) {
    if (committed) gitOrDie(['reset', '--quiet', '--soft', 'HEAD~1'], wt);
    die(held);
  }
  for (const w of exRange.warns) warn(`exterior.md: ${w}`);
  if (named && exRange.words.length) logNamesChecked(slugName, EXTERIOR_REL(), git(['rev-parse', '--verify', '--quiet', `${head}:${EXTERIOR_REL()}`], wt) ?? 'none', exRange.words);
  // forced, but only over the origin tip read above: a push from elsewhere since then is refused
  gitOrDie(['push', '--quiet', `--force-with-lease=chore-${slugName}:${there ?? ''}`, 'origin', `chore-${slugName}:chore-${slugName}`], wt);
  const pr = openPr(wt, `chore-${slugName}`, `chore-${slugName}: ${flagStr('title')}`, flagStr('body') ?? flagStr('title'));
  out(`pushed chore-${slugName}${pr ? `: ${pr}` : ''}\nmerge it once CI passes, then: git worktree remove .worktrees/chore-${slugName}`);
}

// --- retros ---

export const lastRetro = () => logObjects('observation').filter((o) => o.kind === 'retro' && o.created_by === 'supervisor').sort(byTime).pop() ?? null;
export function finishedFeatures() {
  const res = [];
  for (const [fid, ts] of Object.entries(groupBy([...activeTickets().values()].filter((t) => t.feature !== CHORES), (t) => t.feature))) {
    const ats = ts.map((t) => mergedAt(t.id));
    if (ats.some((x) => !x)) continue;
    res.push({ feature: fid, finished_at: new Date(Math.max(...ats)).toISOString() });
  }
  return res;
}
export function retroDue() {
  const last = lastRetro();
  const every = loadSettings().retro_every_days;
  const lastAt = last ? Date.parse(last.created_at) : null;
  const reasons = [];
  let since = null;
  if (!last) {
    const first = logObjects('phase').map((p) => p.created_at).sort()[0];
    if (first && Date.now() - Date.parse(first) >= every * DAY) { reasons.push(`no retro yet, and work started ${dateOnly(first)}`); since = new Date(Date.parse(first) + every * DAY).toISOString(); }
  } else if (Date.now() - lastAt >= every * DAY) { reasons.push(`${every} days since the last retro (${dateOnly(last.created_at)})`); since = new Date(lastAt + every * DAY).toISOString(); }
  for (const f of finishedFeatures()) if (!lastAt || Date.parse(f.finished_at) > lastAt) { reasons.push(`feature ${f.feature} finished ${dateOnly(f.finished_at)}`); if (!since || f.finished_at < since) since = f.finished_at; }
  // every closed retro, newest first: its id is the closing observation's, its write-up the file
  const all = logObjects('observation').filter((o) => o.kind === 'retro' && o.created_by === 'supervisor').sort(byTime).reverse()
    .map((o) => ({ id: o.id, at: o.created_at, summary: o.detail, file: o.source_ref ?? null, refs: o.refs ?? [] }));
  return { due: reasons.length > 0, reasons, due_since: since, last: last ? { id: last.id, at: last.created_at, summary: last.detail, file: last.source_ref ?? null } : null, all };
}
export function retroNumbers(m) {
  return {
    tickets_merged: m.tickets_merged, median_cycle_hours: m.cycle_hours.median, usd_total: m.cost.usd_total, usd_per_merged_ticket: m.cost.usd_per_merged_ticket,
    phase_hours: m.phase_hours, phase_usd: m.phase_usd, first_pass_rejection: Object.fromEntries(Object.entries(m.reviews.by_stage).map(([k, v]) => [k, v.rejection_rate])),
    escaped_defects: m.escaped_defects, owner_answer_rate_14d: m.owner_questions.answer_rate_14d ?? null, median_answer_hours: m.owner_questions.median_answer_hours,
    flaky_tests: m.gates.flaky_tests.length, slowest_gate: m.gates.gates[0] ? `${m.gates.gates[0].gate} ${m.gates.gates[0].median_seconds}s` : null,
  };
}
export function retroDraft() {
  const last = lastRetro();
  const sinceMs = last ? Date.parse(last.created_at) : 0;
  const after = (iso) => Date.parse(iso) > sinceMs;
  const m = collectMetrics(sinceMs);
  const nums = retroNumbers(m);
  const prevText = last?.source_ref ? projectFileText(last.source_ref.replace(/^project\//, '')) : null;
  let prev = null;
  try { prev = JSON.parse(prevText?.match(/```json devteam-retro\s*\n([\s\S]*?)\n```/)?.[1] ?? 'null'); } catch { prev = null; }
  const fmt = (v) => (v === null || v === undefined ? '-' : typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k} ${x}`).join(', ') || '-' : String(v));
  const ts = tickets();
  const merged = [...ts.keys()].filter((id) => mergedAt(id) && mergedAt(id) > sinceMs);
  const rejected = [];
  for (const id of ts.keys()) { const b = ticketBranchRef(id); for (const r of ticketReviews(id, b && !mergeShaFor(id) ? { ref: b } : WORKTREE)) if (r.pass === 1 && !r.variant && r.verdict === 'CHANGES') rejected.push(`${id} ${r.stage}`); }
  const acts = logObjects('act');
  const corrections = calls().map((a) => ({ a, c: correctionOf(a) })).filter((x) => x.c && after(x.c.at));
  const outcomes = logObjects('observation').filter((o) => o.kind === 'outcome');
  const trials = acts.filter((a) => a.class === 'improvement-trial' && after(a.created_at));
  const openTrials = acts.filter((a) => a.class === 'improvement-trial' && !outcomes.some((o) => (o.refs ?? []).includes(a.id)));
  const problems = logObjects('problem');
  const goals = logObjects('goal').filter((g) => !['met', 'abandoned'].includes(g.status));
  const readingDue = goals.filter((g) => !goalReadings(g.id).some((r) => after(r.created_at)));
  const today = dateOnly(nowIso());
  const rows = ['tickets_merged', 'median_cycle_hours', 'usd_total', 'usd_per_merged_ticket', 'escaped_defects', 'owner_answer_rate_14d', 'median_answer_hours', 'flaky_tests', 'slowest_gate', 'first_pass_rejection', 'phase_hours', 'phase_usd'];
  return [
    `# Retro ${today}`, '', `Since: ${last ? last.created_at.slice(0, 16).replace('T', ' ') : 'the start'}`, '',
    '## Summary for the owner', '', '<Two lines: what went well, what changes. This becomes the retro line on the dashboard.>', '',
    '## Numbers', '', '| | Now | Previous retro |', '|---|---|---|',
    ...rows.map((k) => `| ${k.replace(/_/g, ' ')} | ${fmt(nums[k])} | ${prev ? fmt(prev[k]) : '-'} |`),
    '', '```json devteam-retro', JSON.stringify(nums), '```', '',
    '## Since the last retro', '',
    `- **Merged:** ${merged.join(', ') || 'none'}`,
    `- **Slowest:** ${m.cycle_hours.slowest.map((c) => `${c.id} ${c.hours}h`).join(', ') || '-'}`,
    `- **Rejected at first review:** ${rejected.join('; ') || 'none'}`,
    `- **Corrections:** ${corrections.map(({ a, c }) => `${a.id} (${a.class}): ${c.reason}`).join('; ') || 'none'}`,
    `- **Trials started:** ${trials.map((a) => `${a.id} ${a.what}`).join('; ') || 'none'}`,
    `- **Trials without an outcome:** ${openTrials.map((a) => `${a.id} ${a.what}`).join('; ') || 'none'}`,
    `- **Problems:** ${problems.filter((p) => after(p.created_at)).length} opened, ${problems.filter((p) => p.status === 'resolved' && p.updates.some((u) => u.status === 'resolved' && after(u.at))).length} resolved, ${problems.filter((p) => p.status !== 'resolved').length} open`,
    `- **Production:** ${(() => { const inc = incidentList(); const ob = logObjects('observation').filter((o) => o.detector === 'sensor' && after(o.created_at)); return `${inc.filter((p) => after(p.created_at)).length} incident(s) opened, ${ob.filter((o) => o.kind === 'outcome' && o.valence > 0).length} fix(es) verified, ${ob.filter((o) => o.kind === 'outcome' && o.valence === 0).length} resolved unverified, ${ob.filter((o) => o.kind === 'fix-regressed').length} regressed, ${ob.filter((o) => o.kind === 'suspected-escaped-defect').length} suspected escape(s); spend: checks and probes cost nothing, triage is a supervisor turn per tick that found something, fixes are tickets`; })()}`,
    `- **Goal readings due:** ${readingDue.map((g) => `${g.id} (${g.title})`).join(', ') || 'none'}`,
    `- **Recurring, unexplained:** ${orientClusters().map((c) => `${c.key} x${c.count}`).join(', ') || 'none'}`,
    `- **Trust evidence supports asking about:** ${trustTable().filter((t) => t.can_ask).map((t) => t.class).join(', ') || 'nothing yet'}`,
    `- **Findings now:** ${m.findings.slice(0, 8).map((f) => `[${f.severity}] ${f.kind} ${f.subject}`).join('; ') || 'none'}`,
    '', '## Why', '', '<For each slow ticket, rejected review and correction above: why. Cite files and ids.>', '',
    '## What we will change', '', '<Each one: a trial (act), a chore ticket, a lesson or problem, or one proposal question for the owner covering everything that needs them. Or "nothing, because …".>', '',
    '## Roadmap', '', '```', roadmapText(collectRoadmap()), '```', '',
  ].join('\n');
}
export function cmdRetro() {
  const [sub, arg] = positional;
  if (flags.due) {
    const d = retroDue();
    out(d.due ? `due: ${d.reasons.join('; ')}` : `not due${d.last ? ` (last ${dateOnly(d.last.at)})` : ''}`);
    process.exit(d.due ? 0 : 1);
  }
  supervisorOnly('retro');
  if (sub !== 'close' && !flags.print) upkeepAllows('a retro');
  if (sub === 'close') {
    const date = arg ?? die('usage: retro close <YYYY-MM-DD> --summary "<two lines>" [--refs ids]');
    const rel = `retros/${date}.md`;
    if (!projectFileText(rel) && !fs.existsSync(path.join(mainRoot, '.worktrees', `chore-retro-${date}`, projectRel, rel))) die(`no retro file for ${date}; draft it with devteam.mjs retro`);
    return out(appendLog({ type: 'observation', source: 'supervisor', subject: 'project', kind: 'retro', detail: flagStr('summary') ?? die('retro close needs --summary'), source_ref: `project/${rel}`, refs: asList(flags.refs) }, 'supervisor').id);
  }
  if (flags.print) return out(retroDraft());
  const date = dateOnly(nowIso());
  const wt = choreWorktree(`retro-${date}`);
  const file = path.join(wt, projectRel, 'retros', `${date}.md`);
  if (fs.existsSync(file) && !flags.force) die(`${path.relative(mainRoot, file)} exists; edit it, or --force to redraft`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${retroDraft()}\n`);
  out(`drafted ${path.relative(mainRoot, file)}\nwrite Summary, Why and What we will change, then:\n  devteam.mjs chore pr retro-${date} --title "retro ${date}"\n  devteam.mjs retro close ${date} --summary "<two lines>" --refs <ids it produced>`);
}

// ===== 10. metrics, progress, the dashboard =====

