/* imports start */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ASKED_SAVED } from './orient.mjs';
import { DAY } from './base.mjs';
import { EFF_MIN_MERGED } from './orient.mjs';
import { EFF_MIN_PASSES } from './orient.mjs';
import { FETCH_FILE } from './questions.mjs';
import { LINK_KINDS } from './links.mjs';
import { LINK_PRS_FILE } from './questions.mjs';
import { LINK_PRS_MAX_AGE_MS } from './questions.mjs';
import { LINK_PRS_UNREAD_HOURS } from './questions.mjs';
import { MODEL_PRICES } from './spend.mjs';
import { PROBE_FILE } from './observe.mjs';
import { RECENT_DAYS } from './reviews.mjs';
import { RECORDS_ONLY_FIX } from './panes.mjs';
import { RESPONDER_NAME } from './responder.mjs';
import { RESTART_MAX } from './accounts.mjs';
import { RUNTIME_RES } from './goals.mjs';
import { SESSION_ID } from './accounts.mjs';
import { THREAD_WAIT_MS } from './threads.mjs';
import { TIER_MIN_TICKETS } from './orient.mjs';
import { TRIAGE_KINDS } from './sensors.mjs';
import { UNREAD_GRACE_MS } from './sessions.mjs';
import { WEEK } from './scores.mjs';
import { WORKTREE } from './repos.mjs';
import { accountsState } from './hub/health-pool.mjs';
import { activeWorker } from './graph.mjs';
import { agentExited } from './panes.mjs';
import { askedSettingsView } from './orient.mjs';
import { boundWriter } from './responder.mjs';
import { byTime } from './log-sync.mjs';
import { canonical } from './settings.mjs';
import { capOf } from './holds.mjs';
import { capWords } from './holds.mjs';
import { chatQuotesNotFound } from './spend.mjs';
import { closures } from './graph.mjs';
import { countsAsWorker } from './graph.mjs';
import { coverageGapInfo } from './reviews.mjs';
import { covered } from './observe.mjs';
import { dateOnly } from './base.mjs';
import { deployCommit } from './sensors.mjs';
import { deploysSince } from './sensors.mjs';
import { discoveryKey } from './sensors.mjs';
import { draining } from './fleet.mjs';
import { effectivePriorities } from './holds.mjs';
import { efficiencyOf } from './orient.mjs';
import { explained } from './observe.mjs';
import { exteriorFindings } from './world-model.mjs';
import { factsRepo } from './repos.mjs';
import { fileAge } from './sensors.mjs';
import { fixTicketOf } from './sensors.mjs';
import { fleetMode } from './holds.mjs';
import { fmtMs } from './sensors.mjs';
import { followTicket } from './sensors.mjs';
import { fpIdOfObservation } from './sensors.mjs';
import { fromSensor } from './sensors.mjs';
import { gateStats } from './spend.mjs';
import { git } from './base.mjs';
import { gitBlob } from './lens.mjs';
import { goalAtTarget } from './goals.mjs';
import { goalAtTargetQuiet } from './orient.mjs';
import { goalImpact } from './log-sync.mjs';
import { goalMode } from './holds.mjs';
import { groupBy } from './base.mjs';
import { heldByMap } from './questions.mjs';
import { holdFindings } from './holds.mjs';
import { holdWords } from './holds.mjs';
import { homeRecordsRef } from './repos.mjs';
import { hours } from './base.mjs';
import { idleOnApiError } from './panes.mjs';
import { idlePlanningGoals } from './orient.mjs';
import { idleWithShell } from './panes.mjs';
import { incidentDecisions } from './sensors.mjs';
import { incidentList } from './sensors.mjs';
import { incidentOfTicket } from './sensors.mjs';
import { incidentSeverity } from './sensors.mjs';
import { isActive } from './graph.mjs';
import { isHarnessRuntime } from './goals.mjs';
import { isHeld } from './graph.mjs';
import { isIncident } from './sensors.mjs';
import { isObj } from './artifact-notes.mjs';
import { jsonOr } from './sensors.mjs';
import { knownCommit } from './sensors.mjs';
import { ladder } from './links.mjs';
import { linesDeclared } from './links.mjs';
import { linkLocation } from './links.mjs';
import { linkMaintains } from './links.mjs';
import { linkPrRepos } from './questions.mjs';
import { loadSettings } from './settings.mjs';
import { logGet } from './log-sync.mjs';
import { logObjects } from './log-sync.mjs';
import { mainRef } from './log.mjs';
import { mainRoot } from './state.mjs';
import { measureOf } from './goals.mjs';
import { median } from './base.mjs';
import { memoryFull } from './hub/operator.mjs';
import { mergeShaFor } from './repos.mjs';
import { mergedAt } from './repos.mjs';
import { misRated } from './orient.mjs';
import { modeOf } from './holds.mjs';
import { modelKey } from './spend.mjs';
import { mondayOf } from './scores.mjs';
import { moveFindings } from './orient.mjs';
import { nextMoves } from './orient.mjs';
import { notSchedulable } from './holds.mjs';
import { openIncidentOf } from './sensors.mjs';
import { out } from './base.mjs';
import { overlapsActive } from './holds.mjs';
import { owedIn } from './responder.mjs';
import { ownEntry } from './artifact-notes.mjs';
import { ownPriority } from './holds.mjs';
import { ownerLinesUnread } from './sessions.mjs';
import { paneWaiting } from './panes.mjs';
import { planners } from './panes.mjs';
import { plural } from './questions.mjs';
import { priceFor } from './spend.mjs';
import { projectInRepo } from './settings.mjs';
import { projectRel } from './settings.mjs';
import { questions } from './log-sync.mjs';
import { readJson } from './base.mjs';
import { readLog } from './log-sync.mjs';
import { readPreviews } from './previews.mjs';
import { readyOrder } from './holds.mjs';
import { recordsInHomeId } from './repos.mjs';
import { recordsLandedOnly } from './panes.mjs';
import { recurringChores } from './chores.mjs';
import { recurringFailures } from './chores.mjs';
import { recurringLock } from './chores.mjs';
import { recurringRunDue } from './chores.mjs';
import { redactUrl } from './links.mjs';
import { repo } from './repos.mjs';
import { repoOfTicketLink } from './repos.mjs';
import { repoReadable } from './repos.mjs';
import { responderHealth } from './responder.mjs';
import { responderOverdue } from './responder.mjs';
import { reviewPasses } from './reviews.mjs';
import { reviewPins } from './artifact-notes.mjs';
import { reviewResultPath } from './lens.mjs';
import { reviewStats } from './reviews.mjs';
import { runDir } from './state.mjs';
import { sameAnswer } from './questions.mjs';
import { selfFindings } from './self-model.mjs';
import { sensorCredentialState } from './sensors.mjs';
import { sensorDir } from './sensors.mjs';
import { sensorIgnores } from './sensors.mjs';
import { sensorList } from './sensors.mjs';
import { sensorStatus } from './sensors.mjs';
import { sessionWords } from './responder.mjs';
import { sessionsOverdue } from './responder.mjs';
import { settledByLanding } from './sessions.mjs';
import { sh } from './base.mjs';
import { sha256 } from './lens.mjs';
import { shq } from './scores.mjs';
import { spendItems } from './spend.mjs';
import { splitFpId } from './sensors.mjs';
import { srcRead } from './repos.mjs';
import { stoppedLaunch } from './graph.mjs';
import { strategyRel } from './pr-checks.mjs';
import { strategyState } from './pr-checks.mjs';
import { supervisorRecovery } from './accounts.mjs';
import { threadAnswersUnbound } from './spend.mjs';
import { threadViews } from './threads.mjs';
import { ticketBranchRef } from './repos.mjs';
import { ticketGoals } from './holds.mjs';
import { ticketMode } from './holds.mjs';
import { ticketReviews } from './reviews.mjs';
import { tickets } from './graph.mjs';
import { tmuxSession } from './base.mjs';
import { tmuxTarget } from './base.mjs';
import { turnsByThread } from './responder.mjs';
import { undeliveredTurns } from './threads.mjs';
import { unreadWhat } from './sessions.mjs';
import { upgradeAt } from './repos.mjs';
import { upkeepOrVirtual } from './holds.mjs';
import { verifyDefaults } from './sensors.mjs';
import { waitAliveFile } from './sensors.mjs';
import { workerState } from './graph.mjs';
import { writeMovesCache } from './orient.mjs';
import { writerClass } from './log.mjs';
/* imports end */
export const METRICS_INTERNALS = Symbol('metrics internals');
// kit-98's weeks: the last 12 calendar weeks (Monday 00:00 UTC), oldest first, ending with this one.
export const efficiencyWeeks = (now) => Array.from({ length: 12 }, (_, i) => { const start = mondayOf(now) - (11 - i) * WEEK; return { start, end: start + WEEK }; });
// A ticket's review record as a pass of its own work, by file name: parseReview reads task-2.md as
// pass 2 and task-2-2.md as stage task-2-2, but each task-<n>.md is task n's first review (ruling
// m-20261115-204118085-supervisor). Tracks, contracts, designs and graphs aren't counted.
export function reviewPassOf(file) {
  const x = /^(spec|plan|final)-(\d+)\.md$/.exec(file);
  if (x) return { stage: x[1], first: Number(x[2]) === 1 };
  if (/^task-\d+\.md$/.test(file)) return { stage: 'task', first: true };
  if (/^task-\d+-\d+\.md$/.test(file)) return { stage: 'task', first: false };
  return null;
}
export function firstPassOf(records) {
  const firsts = records.filter((r) => r.verdict && reviewPassOf(r.file)?.first);
  return { first_passes: firsts.length, rejected: firsts.filter((r) => r.verdict === 'CHANGES').length };
}
// every ticket's records, from where reviewStats reads them (shared through reviewMemo)
export const ticketReviewWalk = () => new Map([...tickets().keys()].map((id) => { const b = ticketBranchRef(id); return [id, ticketReviews(id, b && !mergeShaFor(id) ? { ref: b } : WORKTREE)]; }));
export const TOKEN_KINDS = ['input', 'output', 'cache_read', 'cache_write'];
export function tokensByPhase(items) {
  const o = {};
  for (const r of items) { const t = (o[r.phase] ??= { input: 0, output: 0, cache_read: 0, cache_write: 0 }); for (const k of TOKEN_KINDS) t[k] += r[k]; }
  return o;
}
// The score (the design's Efficiency section): a week with 3 or more tickets is scored against the
// best (lowest) dollars and hours per point among the 12 weeks' scored weeks. A week with an escaped
// defect can't score a saving it made by letting the defect through: its spend and time are the
// lowest raw values of the other scored weeks, 0 with none.
export function scoreWeeks(weeks) {
  const scored = weeks.filter((w) => w.tickets >= 3);
  if (!scored.length) return { best: null };
  const best = { usd_per_point: Math.min(...scored.map((w) => w.usd_per_point)), hours_per_point: Math.min(...scored.map((w) => w.hours_per_point)) };
  const raw = (w, k) => (w[k] === 0 ? 1 : best[k] / w[k]);
  for (const w of scored) {
    const others = scored.filter((o) => o !== w);
    const part = (k) => (!w.escaped_defects ? Math.min(1, raw(w, k)) : others.length ? Math.min(...others.map((o) => raw(o, k))) : 0);
    const p = { spend: part('usd_per_point'), time: part('hours_per_point'), rework: w.first_pass };
    w.score = Math.round((100 * (p.spend + p.time + p.rework)) / 3);
    w.parts = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, +v.toFixed(2)]));
  }
  return { best };
}
export const SPEND_FINDINGS = ['cost-hotspot', 'costly-ticket', 'low-cache-hit', 'cost-per-point-rising', 'unpriced-model'];
// Orient: the open spend findings, each with the newest observation that recorded it (null until
// observe-metrics logs one).
export function efficiencyWaste(m) {
  const newest = new Map();
  for (const o of logObjects('observation')) if (o.source_key?.startsWith('metrics:') && (!newest.has(o.source_key) || o.created_at >= newest.get(o.source_key).created_at)) newest.set(o.source_key, o);
  return m.findings.filter((f) => SPEND_FINDINGS.includes(f.kind)).map((f) => ({ id: newest.get(`metrics:${f.kind}:${f.subject}`)?.id ?? null, kind: f.kind, subject: f.subject, detail: f.detail }));
}
// Act: the levers on trial: improvement-trial acts that cite a spend finding or name cost per point,
// newest first; running until an outcome observation cites one, then kept or dropped by the newest.
export function efficiencyTrials(perPoint) {
  const spendObs = new Set(logObjects('observation').filter((o) => SPEND_FINDINGS.includes(o.kind)).map((o) => o.id));
  const outcomes = logObjects('observation').filter((o) => o.kind === 'outcome').sort(byTime);
  const defects = logObjects('observation').filter((o) => o.kind === 'escaped-defect').map((o) => Date.parse(o.created_at));
  const now = Date.now();
  return logObjects('act').filter((a) => a.class === 'improvement-trial' && ((a.refs ?? []).some((r) => spendObs.has(r)) || /cost[- ]per[- ](merged )?point/i.test(a.what ?? '')))
    .sort(byTime).reverse().map((a) => {
      const since = Date.parse(a.created_at);
      const last = outcomes.filter((o) => (o.refs ?? []).includes(a.id)).pop();
      return {
        id: a.id, what: a.what ?? '', since: a.created_at,
        usd_per_point_start: perPoint(since - WEEK, since)?.usd_per_point ?? null, usd_per_point_now: perPoint(since, now + 1)?.usd_per_point ?? null,
        escaped_defects_since: defects.filter((t) => t >= since).length,
        state: !last ? 'running' : (last.valence ?? 0) >= 0 ? 'kept' : 'dropped',
      };
    });
}
// Model families from the top, for "a smaller model": the same version one family down, or, when
// that version isn't priced, that family's newest priced version. Priced means named exactly in
// MODEL_PRICES or settings.model_prices (priceFor's prefix fallback prices versions nobody listed).
/* model families start */
export const MODEL_FAMILIES = [['fable', 'mythos'], ['opus'], ['sonnet'], ['haiku']];
export const parseModelKey = (k) => { const x = /^claude-([a-z]+)-(\d+(?:-\d+)*)$/.exec(k ?? ''); return x ? { family: x[1], version: x[2] } : null; };
export const versionCmp = (a, b) => { const p = a.split('-').map(Number), q = b.split('-').map(Number); for (let i = 0; i < Math.max(p.length, q.length); i++) { const d = (p[i] ?? 0) - (q[i] ?? 0); if (d) return d; } return 0; };
export function smallerModel(key, priced) {
  const m = parseModelKey(key);
  const tier = m ? MODEL_FAMILIES.findIndex((f) => f.includes(m.family)) : -1;
  if (tier < 0 || tier === MODEL_FAMILIES.length - 1) return null;
  const down = MODEL_FAMILIES[tier + 1][0];
  if (priced.includes(`claude-${down}-${m.version}`)) return `claude-${down}-${m.version}`;
  const newest = priced.map(parseModelKey).filter((x) => x?.family === down).sort((a, b) => versionCmp(b.version, a.version))[0];
  return newest ? `claude-${down}-${newest.version}` : null;
}
// a model as the owner reads it: claude-sonnet-5-5 is Sonnet 5.5
export const modelWords = (key) => { const m = parseModelKey(key); return m ? `${m.family[0].toUpperCase()}${m.family.slice(1)} ${m.version.replace(/-/g, '.')}` : 'that model'; };
/* model families end */
// A suggestion's id: stable while its condition holds, never from a rank or a date, and safe as a
// thread subject (suggestion:<id>). Two subjects can make one id (a:b and a/b, or a cut at 110), and
// the id names a thread, so a list's later clash takes -2, -3 and so on, cut to stay within 110; a
// suffixed id can itself be taken (x-2 as a subject), so each is checked against every id so far.
/* suggestion ids start */
export const suggestionId = (prefix, kind, subject) => `${prefix}-${kind}-${subject}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 110);
export function uniqueIds() {
  const taken = new Set();
  return (id) => {
    let out = id;
    for (let n = 2; taken.has(out); n++) out = id.slice(0, 110 - `-${n}`.length) + `-${n}`;
    taken.add(out);
    return out;
  };
}
export const effId = (k, s) => suggestionId('eff', k, s);
/* suggestion ids end */
export const dollars = (x) => `$${Number.isInteger(x) ? x : x.toFixed(2)}`;
// Decide: up to five suggestions whose condition holds this week, by estimated dollars (the design's
// five kinds). ids are this week's tickets, ids12 the 12 weeks', [start, end) this week.
export function efficiencySuggestions(m, { items, walk, ids, ids12, start, end, POINTS }) {
  const ts = tickets();
  const out = [];
  const add = (kind, subject, usd, per, what, evidence) => out.push({ id: effId(kind, subject), kind, what, evidence, effect: `about ${dollars(+usd.toFixed(2))} ${per === 'once' ? 'once' : 'a week'}`, usd: +usd.toFixed(2), per });
  const recs = (id) => walk.get(id) ?? [];
  // a review pass, priced from final-review reviewer spend: the median over the 12 weeks' tickets
  // with a final record of their reviewer spend over their final records
  const perTicket = ids12.map((id) => {
    const finals = recs(id).filter((r) => r.verdict && /^final-\d+[a-z]?\.md$/.test(r.file)).length;
    const usd = items.filter((x) => x.who === id && x.role === 'reviewer' && (x.phase === 'final-review' || x.phase === 'review')).reduce((a, x) => a + x.usd, 0);
    return finals ? usd / finals : null;
  }).filter((x) => x !== null);
  // with no spend items (spend reported on phase lines only) there is no reviewer spend to price from
  const perPass = items.length ? median(perTicket) : null;
  if (perPass !== null) {
    const small = ids.filter((id) => ts.get(id)?.size === 'S' && ts.get(id)?.risk === 'normal');
    const passes = small.reduce((a, id) => a + recs(id).filter((r) => r.verdict && ['spec', 'plan'].includes(reviewPassOf(r.file)?.stage)).length, 0);
    if (passes >= 3) add('review-depth', 's-normal', passes * perPass, 'week', 'Fit review depth to small, normal-risk tickets: fewer spec and plan review rounds, keeping the final review', `${passes} spec and plan reviews this week on ${small.length} small, normal-risk ticket${small.length === 1 ? '' : 's'}, at about ${dollars(+perPass.toFixed(2))} a review`);
    for (const stage of ['spec', 'plan', 'task', 'final']) {
      const all = ids.flatMap((id) => recs(id)).filter((r) => r.verdict && reviewPassOf(r.file)?.stage === stage);
      const firsts = all.filter((r) => reviewPassOf(r.file).first);
      const rejected = firsts.filter((r) => r.verdict === 'CHANGES').length;
      if (firsts.length >= 4 && rejected / firsts.length > 0.5) add('tighter-specs', stage, (all.length - firsts.length) * perPass, 'week', `Tighten ${stage} work before it is reviewed: most first ${stage} reviews asked for changes`, `${rejected} of ${firsts.length} first ${stage} reviews asked for changes this week, and ${all.length - firsts.length} more rounds followed`);
    }
  }
  // a smaller model: one model over 90% of this week's spend above $50
  const week = items.filter((x) => x.at >= start && x.at < end);
  const total = week.reduce((a, x) => a + x.usd, 0);
  const byModel = {};
  for (const x of week) for (const [mdl, v] of Object.entries(x.by_model)) byModel[modelKey(mdl)] = (byModel[modelKey(mdl)] ?? 0) + v.usd;
  const [dom, domUsd] = Object.entries(byModel).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (total > 50 && domUsd > 0.9 * total) {
    const priced = [...Object.keys(MODEL_PRICES), ...Object.keys(loadSettings().model_prices ?? {})].map(modelKey);
    const target = smallerModel(dom, priced);
    const from = priceFor(dom), to = target && priceFor(target);
    if (from && to && to.output < from.output) {
      const NOT = ['final-review', 'review', 'spec', 'plan', 'planning'];
      const work = week.filter((x) => !NOT.includes(x.phase)).reduce((a, x) => a + Object.entries(x.by_model).filter(([mdl]) => modelKey(mdl) === dom).reduce((b, [, v]) => b + v.usd, 0), 0);
      add('smaller-model', dom, work * (1 - to.output / from.output), 'week', `Try ${modelWords(target)} for building, outside reviews, specs and planning`, `${modelWords(dom)} was ${Math.round((100 * domUsd) / total)}% of this week's ${dollars(+total.toFixed(2))}, ${dollars(+work.toFixed(2))} of it outside reviews, specs and planning`);
    }
  }
  // keep the prompt cache: low-cache-hit's window, priced at its highest-spend priced model
  if (m.findings.some((f) => f.kind === 'low-cache-hit')) {
    const recent = items.filter((x) => x.at >= Date.now() - 7 * DAY);
    const inSide = recent.reduce((a, x) => a + x.input + x.cache_read + x.cache_write, 0);
    const reads = recent.reduce((a, x) => a + x.cache_read, 0);
    const spendBy = {};
    for (const x of recent) for (const [mdl, v] of Object.entries(x.by_model)) spendBy[modelKey(mdl)] = (spendBy[modelKey(mdl)] ?? 0) + v.usd;
    const model = Object.entries(spendBy).sort((a, b) => b[1] - a[1]).map(([k]) => k).find((k) => priceFor(k));
    if (model) { const p = priceFor(model); add('cache', 'prompt-cache', (Math.max(0, 0.6 * inSide - reads) * (p.input - p.read)) / 1e6, 'week', 'Keep the prompt cache: resume sessions instead of relaunching them, and keep prompts stable at the start', `${inSide ? Math.round((100 * reads) / inSide) : 0}% of input tokens were cache reads in the last 7 days, short of 60%`); }
  }
  // a costly ticket: its spend above the median per point (as the finding counts it), once
  const pp = (id) => (m.cost.by_ticket[id] ?? 0) / (POINTS[ts.get(id)?.size] ?? 1);
  const merged = [...ts.keys()].filter((id) => mergedAt(id) && m.cost.by_ticket[id] !== undefined).map(pp).sort((a, b) => a - b);
  const med = merged[Math.floor(merged.length / 2)];
  for (const f of m.findings.filter((x) => x.kind === 'costly-ticket')) {
    const points = POINTS[ts.get(f.subject)?.size] ?? 1;
    const spent = m.cost.by_ticket[f.subject] ?? 0;
    add('costly-ticket', f.subject, spent - med * points, 'once', `Find where ${f.subject}'s spend went, and try a lever on the next tickets like it`, `${dollars(+spent.toFixed(2))} on ${points} point${points === 1 ? '' : 's'}, against a median of ${dollars(+med.toFixed(2))} a point`);
  }
  return out.sort((a, b) => b.usd - a.usd || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, 5);
}
export function efficiencyData(m, now = Date.now()) {
  const { cycles, ticketUsd, perPoint, items, POINTS } = m[METRICS_INTERNALS];
  const weekIds = [];
  const walk = ticketReviewWalk();
  const defects = logObjects('observation').filter((o) => o.kind === 'escaped-defect').map((o) => Date.parse(o.created_at));
  const r2 = (x) => +x.toFixed(2);
  const W12 = efficiencyWeeks(now);
  const weeks = W12.map(({ start, end }) => {
    // the week's tickets: merged in it with spend recorded, the set perPoint counts
    const done = cycles.filter((c) => { const t = mergedAt(c.id); return t >= start && t < end && ticketUsd[c.id] !== undefined; });
    weekIds.push(done.map((c) => c.id));
    const pp = perPoint(start, end);
    const points = pp?.points ?? 0;
    const fp = done.map((c) => firstPassOf(walk.get(c.id) ?? [])).reduce((a, f) => ({ n: a.n + f.first_passes, bad: a.bad + f.rejected }), { n: 0, bad: 0 });
    // the week's spend items: those timed in it, as collectMetrics selects them for its window
    const its = items.filter((x) => x.at >= start && x.at < end);
    const usd = {};
    for (const r of its) usd[r.phase] = (usd[r.phase] ?? 0) + r.usd;
    const inSide = its.reduce((a, x) => a + x.input + x.cache_read + x.cache_write, 0);
    return {
      starts_at: new Date(start).toISOString(), tickets: done.length, points, usd_per_point: pp?.usd_per_point ?? null,
      hours_per_point: points ? r2(done.reduce((a, c) => a + c.ms, 0) / 3600000 / points) : null,
      first_pass: fp.n ? r2((fp.n - fp.bad) / fp.n) : 1, first_passes: fp.n,
      cache_read_share: inSide ? r2(its.reduce((a, x) => a + x.cache_read, 0) / inSide) : null,
      escaped_defects: defects.filter((t) => t >= start && t < end).length,
      usd_by_phase: Object.fromEntries(Object.entries(usd).map(([k, v]) => [k, r2(v)])), tokens_by_phase: tokensByPhase(its),
      score: null, parts: null,
    };
  });
  const { best } = scoreWeeks(weeks);
  return { weeks, best, score: { this_week: weeks[11].score, last_week: weeks[10].score }, parts: weeks[11].parts,
    observe: { phase_hours: m.phase_hours, phase_usd: m.phase_usd, by_model: m.cost.by_model, tokens: m.cost.tokens, tokens_by_phase: tokensByPhase(items.filter((x) => x.at >= (Date.parse(m.since ?? '') || 0))) },
    waste: efficiencyWaste(m), trials: efficiencyTrials(perPoint),
    suggestions: efficiencySuggestions(m, { items, walk, ids: weekIds[11], ids12: weekIds.flat(), start: W12[11].start, end: W12[11].end, POINTS }) };
}

// How many places below a goal's priority the unstarted work it waits on must be to be a finding.
export const PRIORITY_INVERSION_GAP = 3;

// A repo link the supervisor maintains: open PRs to review, fix, comment on and merge, and (with
// its own release: "tag") releases to cut. Nothing else notices when that work stops, so:
// pr-unreviewed, an open PR (not the fleet's own, not a draft) whose head has had no review for
// LINK_PR_STALL_MS; pr-changes-unanswered, one whose latest review says CHANGES at its head that
// long, with nothing posted on the PR since, so its author never saw the findings; release-due,
// merges on the link's main waiting RELEASE_DUE_HOURS since its latest tag. A review is a record
// under run/reviews/ in a folder or file named for the PR (…pr-<n>/…md, …pr-<n>…md) whose
// "Verdict: APPROVE|CHANGES <full sha>" names the head (run/reviews/<link>-pr-<n>/, or
// <maintain.reviews>-pr-<n>/, or a bare pr-<n> when there's one GitHub link), or a person's review
// of that head on the forge. A PR whose reviews or comments ran past gh's page raises nothing.
// The PRs come from the tick's read (fetchLinkPrs); with no good read nothing about PRs is raised,
// and reads failing for LINK_PRS_UNREAD_HOURS are a low link-prs-unread.
// 15 min: a supervisor that maintains a repo looks at a new head within a tick or two, not a day
// later (a restart wipes its memory of what it meant to review, so the finding is what brings it back)
export const LINK_PR_STALL_MS = 15 * 60000;
export const RELEASE_DUE_HOURS = 6;
export function linkPrReviewRecords(ids, prefixes = new Map()) {
  const root = path.join(runDir, 'reviews');
  const byPr = new Map();
  const put = (key, file) => {
    let text, st;
    try { st = fs.statSync(file); if (!st.isFile() || st.size > 1e6) return; text = fs.readFileSync(file, 'utf8'); } catch { return; }
    const v = [...text.matchAll(/^Verdict:[ \t]*(APPROVE|CHANGES)[ \t]+([0-9a-f]{40}(?:[0-9a-f]{24})?)[ \t]*$/gm)].pop();
    // when the record was written: its birth time where the filesystem keeps one, so filling in a
    // Disposition later doesn't move it past a comment already posted
    const at = st.birthtimeMs > 0 ? Math.min(st.birthtimeMs, st.mtimeMs) : st.mtimeMs;
    if (v) (byPr.get(key) ?? byPr.set(key, []).get(key)).push({ verdict: v[1], sha: v[2], at, file: path.relative(mainRoot, file) });
  };
  // <link>-pr-<n> names the link; a bare pr-<n> (not <other>-pr-<n>) counts only when there is one GitHub repo link
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const named = ids.flatMap((id) => [[id, id], ...(prefixes.has(id) ? [[id, prefixes.get(id)]] : [])]).sort((a, b) => b[1].length - a[1].length).map(([id, pre]) => [id, new RegExp(`(?:^|[^a-z0-9])${esc(pre)}-pr-(\\d+)(?![0-9])`, 'i')]);
  const keyOf = (name) => {
    for (const [id, re] of named) { const m = re.exec(name); if (m) return `${id}#${Number(m[1])}`; }
    const m = /(?:^|[^a-z0-9-])pr-(\d+)(?![0-9])/i.exec(name);
    return m && ids.length === 1 ? `${ids[0]}#${Number(m[1])}` : null;
  };
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return byPr; }
  for (const e of entries) {
    const key = keyOf(e.name);
    if (!key) continue;
    if (e.isDirectory()) { let fs2 = []; try { fs2 = fs.readdirSync(path.join(root, e.name)); } catch {} for (const f of fs2) if (f.endsWith('.md')) put(key, path.join(root, e.name, f)); }
    else if (e.name.endsWith('.md')) put(key, path.join(root, e.name));
  }
  return byPr;
}
export function linkDutyFindings(settings, now, add) {
  const stall = LINK_PR_STALL_MS;
  // how long, in the unit that reads: minutes under an hour
  const waitedFor = (ms) => (ms < 3600000 ? `${Math.max(1, Math.floor(ms / 60000))} min` : `${Math.floor(ms / 3600000)} h`);
  let read = {};
  try { read = readJson(LINK_PRS_FILE); } catch {}
  const repos = linkPrRepos(settings);
  const records = repos.some(([id]) => ownEntry(read, id)) ? linkPrReviewRecords(repos.map(([id]) => id), new Map(repos.map(([id]) => [id, settings.links[id].maintain.reviews]).filter(([, p]) => typeof p === 'string'))) : new Map();
  const hours = (ms) => Math.floor(ms / 3600000);
  for (const [id, spec] of repos) {
    const entry = ownEntry(read, id);
    if (!entry) continue;
    // a failing or old read (the tick's budget cut it) raises no PR finding from what it last saw,
    // and says so once that has lasted
    const age = now - (Date.parse(entry.at) || 0);
    if (entry.failing_since || age > LINK_PRS_MAX_AGE_MS) {
      const unread = entry.failing_since ? now - (Date.parse(entry.failing_since) || now) : age;
      if (unread > LINK_PRS_UNREAD_HOURS * 3600000) add('low', 'link-prs-unread', id, `${id}'s open PRs haven't been read for ${hours(unread)} h${entry.at ? ` (last read ${entry.at})` : ''}: ${entry.failing_since ? entry.error ?? 'gh failed' : "the tick's time budget ran out first"}`, `check gh on this machine (gh auth status; gh pr list -R ${spec} --state open --limit 5): until it reads, pr-unreviewed and pr-changes-unanswered can't fire for ${id}`);
      continue;
    }
    if (!Array.isArray(entry.prs)) continue;
    for (const pr of entry.prs) {
      if (!Number.isInteger(pr?.number) || typeof pr.head !== 'string' || pr.truncated) continue;
      const subject = `${id}#${pr.number}`;
      const mine = (records.get(subject) ?? []).sort((a, b) => a.at - b.at);
      const atHead = mine.filter((r) => r.sha === pr.head);
      const forgeAtHead = pr.forge_reviews ?? [];
      const latest = mine.at(-1);
      if (latest && latest.verdict === 'CHANGES' && latest.sha === pr.head) {
        const since = now - latest.at;
        const answered = pr.last_comment_at && Date.parse(pr.last_comment_at) > latest.at;
        if (since > stall && !answered) add('medium', 'pr-changes-unanswered', subject, `review ${latest.file} asked for changes at its head ${pr.head.slice(0, 12)} ${waitedFor(since)} ago, and nothing has been posted on the PR since: its author hasn't seen the findings`, `comment the findings to its author on ${pr.url ?? `the PR`} (gh pr comment ${pr.number} --body-file ${latest.file}); a fix the fleet should make is a ticket in ${id}`);
        continue;
      }
      if (atHead.length || forgeAtHead.length) continue;
      const waited = now - (Date.parse(pr.head_at) || now);
      if (waited > stall) add('medium', 'pr-unreviewed', subject, `"${pr.title}" has waited ${waitedFor(waited)} at head ${pr.head.slice(0, 12)} with no review of that head`, `review it in a fresh session (a record under ${path.relative(mainRoot, path.join(runDir, 'reviews', `${settings.links[id].maintain.reviews ?? id}-pr-${pr.number}`))}/ ending "Verdict: APPROVE|CHANGES <head>"), then comment the verdict to its author`);
    }
  }
  // release-due: only for a repo link whose releases the supervisor keeps (maintain.releases) and
  // that releases from a tag, read from its local main as the tick fetched it (with its v* tags),
  // against the nearest release tag on it (v*, not a release candidate, as releasedInAt).
  for (const [id, l] of Object.entries(settings.links ?? {})) {
    if (!LINK_KINDS[l?.kind]?.hostsComponents || !linkMaintains(l, 'releases') || LINK_KINDS[l.kind].effectiveSettings(l, settings).release !== 'tag' || !repoReadable(id)) continue;
    const R = repo(id);
    const ref = R.mainRef();
    if (!ref) continue;
    const tag = R.git(['describe', '--tags', '--abbrev=0', '--match', 'v*', '--exclude', '*-rc*', ref]);
    if (!tag) continue;
    const rows = (R.git(['log', '--first-parent', '--format=%ct', `refs/tags/${tag}..${ref}`]) ?? '').split('\n').filter(Boolean);
    if (!rows.length) continue;
    const waited = now - Number(rows.at(-1)) * 1000;
    if (waited > RELEASE_DUE_HOURS * 3600000) add('medium', 'release-due', id, `${rows.length} commit(s) on ${id}'s main since ${tag}, the oldest waiting ${hours(waited)} h`, `a tag on ${id} deploys to production, so a release is a release-production decision on its ladder (decide, or ask the owner), or record why it waits (observe)`);
  }
}
// Model tiers (worker.md §3): each plan task's `Model: fast | strong` line, decided before the build,
// against what the build spent. Over recent tickets (merged in the last 14 days, or building in them)
// whose plan has tier lines: fast and strong task counts, model misses (a fast task redone on strong), and each
// ticket's build spend on a cheaper model than the dearest it used there, priced by output tokens. A
// ticket is unrouted when its plan has fast tasks not marked built here, its build cost at least $2,
// none of it on an unpriced model, and under 5% of it went to a cheaper model: the plan chose fast
// and the build ran it all on strong. A worker's own cheap subagents (reading, running tests) count
// toward the 5% too, so a build can clear it with every fast task still built on strong: the
// finding is a floor, not proof of routing. Vendor-neutral:
// "cheaper" is read from prices, not from model names.
export const TIER_LINE = /^[\s>*_-]*(?:\*\*)?Model(?:\*\*)?:(?:\*\*)?[ \t]*[`*_]*(fast|strong)\b/gim;
// a fast task built in the worker's own session on purpose: "- Built here: <why>" under it (worker.md
// §3), or the "(inline)" older plans wrote on its Model line
export const BUILT_HERE = /^[\s>*_-]*Built here:|\binline\b/im;
export const TIER_WINDOW_DAYS = 14;
export function ticketRecordText(id, rel) {
  const b = ticketBranchRef(id);
  const src = b && !mergeShaFor(id) ? { ref: b } : WORKTREE;
  if (recordsInHomeId(id)) { const ref = src.ref ? homeRecordsRef(id) : mainRef(); return ref ? srcRead({ ref }, `tickets/${id}/${rel}`) : null; }
  const R = factsRepo(id);
  return R ? srcRead(R.name === 'home' ? src : { ...src, repo: R }, `tickets/${id}/${rel}`) : null;
}
export function modelTierStats(items, now = Date.now()) {
  const from = now - TIER_WINDOW_DAYS * 86400000;
  const out = { window_days: TIER_WINDOW_DAYS, tickets: 0, fast_tasks: 0, strong_tasks: 0, fast_built_here: 0, misses: 0, miss_rate: null, build_usd: 0, build_usd_cheaper: 0, cheaper_share: null, unrouted: [] };
  const build = new Map();
  const builtAt = new Map();
  for (const it of items) if (it.phase === 'build') { builtAt.set(it.who, Math.max(builtAt.get(it.who) ?? 0, it.at)); const b = build.get(it.who) ?? {}; for (const [mdl, v] of Object.entries(it.by_model ?? {})) b[mdl] = (b[mdl] ?? 0) + v.usd; build.set(it.who, b); }
  for (const [id, t] of tickets()) {
    const merged = mergedAt(id);
    // merged in the window, or not merged and building in it
    if (merged ? merged < from : !isActive(t) || (builtAt.get(id) ?? 0) < from) continue;
    const plan = ticketRecordText(id, 'plan.md');
    if (!plan) continue;
    // each task's text runs from its Model line to the next one
    const marks = [...plan.matchAll(TIER_LINE)];
    if (!marks.length) continue;
    const tasks = marks.map((x, i) => ({ tier: x[1].toLowerCase(), text: plan.slice(x.index, marks[i + 1]?.index ?? plan.length) }));
    const fastTasks = tasks.filter((x) => x.tier === 'fast');
    const routable = fastTasks.filter((x) => !BUILT_HERE.test(x.text)).length;
    out.tickets++; out.fast_tasks += fastTasks.length; out.strong_tasks += tasks.length - fastTasks.length; out.fast_built_here += fastTasks.length - routable;
    // a miss is noted in that task's review (task-<n>.md, a later pass task-<n>-<pass>.md): once per task, however many passes
    // or a final restating it
    const rb = ticketBranchRef(id);
    const missed = new Set(ticketReviews(id, rb && !mergeShaFor(id) ? { ref: rb } : WORKTREE).filter((r) => r.model_miss && /^task-\d+(?:-\d+)?[a-z]?\.md$/.test(r.file)).map((r) => r.file.match(/^task-(\d+)/)[1]));
    out.misses += missed.size;
    const b = build.get(id) ?? {};
    const priced = Object.entries(b).map(([mdl, usd]) => ({ usd, out: priceFor(modelKey(mdl))?.output ?? null }));
    // a build with spend on an unpriced model can't say what was cheaper: not judged (unpriced-model asks for prices)
    const unpriced = priced.some((x) => x.out === null && x.usd > 0);
    const top = Math.max(0, ...priced.map((x) => x.out ?? 0));
    const usd = priced.reduce((a, x) => a + x.usd, 0);
    const cheaper = priced.filter((x) => x.out !== null && x.out < top).reduce((a, x) => a + x.usd, 0);
    out.build_usd += usd; out.build_usd_cheaper += cheaper;
    if (routable && !unpriced && usd >= 2 && cheaper / usd < 0.05) out.unrouted.push({ id, fast_tasks: routable, tasks: tasks.length, build_usd: +usd.toFixed(2) });
  }
  out.miss_rate = out.fast_tasks ? +(out.misses / out.fast_tasks).toFixed(2) : null;
  out.cheaper_share = out.build_usd ? +(out.build_usd_cheaper / out.build_usd).toFixed(2) : null;
  out.build_usd = +out.build_usd.toFixed(2); out.build_usd_cheaper = +out.build_usd_cheaper.toFixed(2);
  return out;
}
// reviewsSince: only `metrics --since` windows first passes by their dates; every other caller (the
// retro, the dashboard) keeps all-time review counts, as before review records were dated.
export function collectMetrics(since, reviewsSince = 0) {
  const settings = loadSettings();
  const now = Date.now();
  const ts = tickets();
  const phaseLines = new Map();
  // a planner's phase lines (parked, starting: a drain) are not ticket time
  for (const l of logObjects('phase')) if (writerClass(l.created_by) !== 'planner') (phaseLines.get(l.created_by) ?? phaseLines.set(l.created_by, []).get(l.created_by)).push(l);
  for (const ls of phaseLines.values()) ls.sort(byTime);

  // Cycle time: a ticket's first phase line to its merge.
  const cycles = [];
  for (const id of ts.keys()) {
    const m = mergedAt(id);
    const first = phaseLines.get(id)?.[0];
    if (m && m >= since && first && m > Date.parse(first.created_at)) cycles.push({ id, ms: m - Date.parse(first.created_at) });
  }
  cycles.sort((a, b) => b.ms - a.ms);

  // Time and cost per phase. Each phase lasts until the next line, the merge, or now; spend between
  // two lines is charged to the earlier line's phase.
  const phaseMs = {};
  const phaseNow = new Map();
  const phaseUsd = {};
  const ticketUsd = {};
  for (const [who, ls] of phaseLines) {
    let lastUsd = 0;
    ls.forEach((l, i) => {
      const at = Date.parse(l.created_at);
      if (typeof l.usd === 'number') {
        const delta = Math.max(0, l.usd - lastUsd);
        const charged = who === 'supervisor' ? 'supervisor' : (ls[i - 1]?.to ?? l.from ?? 'starting');
        if (at >= since) { phaseUsd[charged] = (phaseUsd[charged] ?? 0) + delta; ticketUsd[who] = (ticketUsd[who] ?? 0) + delta; }
        lastUsd = l.usd;
      }
      if (who === 'supervisor' || at < since) return;
      const merged = mergedAt(who);
      const endMs = i + 1 < ls.length ? Date.parse(ls[i + 1].created_at) : merged ? Math.max(at, merged) : ['done', 'parked'].includes(l.to) ? at : now;
      phaseMs[l.to] = (phaseMs[l.to] ?? 0) + (endMs - at);
      if (i === ls.length - 1 && !merged) phaseNow.set(who, { phase: l.to, sinceMs: at });
    });
  }
  // Measured usage, where a harness logged it, replaces what agents reported: each response is
  // charged to the phase its ticket was in at that moment (a planner's to planning, a reviewer's
  // to review, the main checkout's to the supervisor).
  const items = spendItems();
  const costSource = items.length ? 'measured' : 'reported';
  const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  const byModel = {};
  const unpricedModels = {};
  if (items.length) {
    for (const k of Object.keys(phaseUsd)) delete phaseUsd[k];
    for (const k of Object.keys(ticketUsd)) delete ticketUsd[k];
    for (const r of items) {
      if (r.at < since) continue;
      phaseUsd[r.phase] = (phaseUsd[r.phase] ?? 0) + r.usd;
      if (r.role === 'worker' || r.role === 'reviewer') ticketUsd[r.who] = (ticketUsd[r.who] ?? 0) + r.usd;
      for (const k of Object.keys(tokens)) tokens[k] += r[k];
      for (const [mdl, v] of Object.entries(r.by_model)) {
        const bm = (byModel[mdl] ??= { usd: 0, output_tokens: 0 });
        bm.usd += v.usd; bm.output_tokens += v.output_tokens;
        if (v.unpriced_tokens) unpricedModels[mdl] = (unpricedModels[mdl] ?? 0) + v.unpriced_tokens;
      }
    }
  }
  // Cost per merged point (S = 1, M = 2), all time and for the last two weeks: what a spend trial moves.
  const POINTS = { S: 1, M: 2 };
  const perPoint = (from, to) => {
    const done = cycles.filter((c) => { const m = mergedAt(c.id); return m >= from && m < to && ticketUsd[c.id] !== undefined; });
    const pts = done.reduce((a, c) => a + (POINTS[ts.get(c.id)?.size] ?? 1), 0);
    return pts ? { usd_per_point: +(done.reduce((a, c) => a + ticketUsd[c.id], 0) / pts).toFixed(2), points: pts, tickets: done.length } : null;
  };
  const mergedCosts = cycles.map((c) => ticketUsd[c.id]).filter((x) => x !== undefined);

  const msgs = logObjects('message').filter((m) => Date.parse(m.created_at) >= since).sort(byTime);
  const replies = new Map();
  for (const m of [...msgs, ...logObjects('question')].sort(byTime)) if (m.re && !replies.has(m.re)) replies.set(m.re, Date.parse(m.created_at));
  const expecting = msgs.filter((m) => !['info', 'ruling', 'answer', 'addressed'].includes(m.kind));
  const openMsgs = expecting.filter((m) => !replies.has(m.id) && !settledByLanding(m));
  const msgWaits = expecting.filter((m) => replies.has(m.id)).map((m) => replies.get(m.id) - Date.parse(m.created_at));
  const qs = questions().filter((q) => Date.parse(q.asked_at) >= since);
  const qWaits = qs.filter((q) => q.answered_at && q.status === 'answered').map((q) => Date.parse(q.answered_at) - Date.parse(q.asked_at));
  // a held goal's open questions wait with it: not counted as the owner falling behind
  const openQs = qs.filter((q) => q.status === 'open' && !q.goal_hold);
  const grace = settings.question_default_after_hours * 3600000;
  const recentQs = questions().filter((q) => now - Date.parse(q.asked_at) <= 14 * DAY && q.status !== 'withdrawn' && !(q.status === 'open' && q.goal_hold) && (q.status !== 'open' || now - Date.parse(q.asked_at) > grace));
  const answeredRecent = recentQs.filter((q) => q.status === 'answered').length;

  const reviews = reviewStats(reviewsSince);
  const gates = gateStats(logObjects('gate').filter((g) => Date.parse(g.created_at) >= since));
  const round = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +v.toFixed(2)]));
  const m = {
    since: since ? new Date(since).toISOString() : null,
    tickets_merged: cycles.length,
    cycle_hours: { median: hours(median(cycles.map((c) => c.ms))), slowest: cycles.slice(0, 5).map((c) => ({ id: c.id, hours: hours(c.ms) })) },
    phase_hours: Object.fromEntries(Object.entries(round(phaseMs)).map(([k, v]) => [k, hours(v)])),
    phase_usd: round(phaseUsd),
    cost: { source: costSource, usd_all: +Object.values(phaseUsd).reduce((a, b) => a + b, 0).toFixed(2), tokens, by_model: Object.fromEntries(Object.entries(byModel).map(([k, v]) => [k, { usd: +v.usd.toFixed(2), output_tokens: v.output_tokens }])), unpriced_models: unpricedModels, per_point: perPoint(0, now + 1), per_point_this_week: perPoint(now - 7 * DAY, now + 1), per_point_last_week: perPoint(now - 14 * DAY, now - 7 * DAY), usd_total: +Object.values(ticketUsd).reduce((a, b) => a + b, 0).toFixed(2), usd_per_merged_ticket: mergedCosts.length ? +(mergedCosts.reduce((a, b) => a + b, 0) / mergedCosts.length).toFixed(2) : null, by_ticket: round(ticketUsd) },
    reviews, gates,
    messages: { expecting_reply: expecting.length, still_open: openMsgs.length, median_reply_minutes: msgWaits.length ? +(median(msgWaits) / 60000).toFixed(1) : null },
    owner_questions: { asked: qs.length, open: openQs.length, median_answer_hours: hours(median(qWaits)), oldest_open_hours: openQs.length ? hours(now - Math.min(...openQs.map((q) => Date.parse(q.asked_at)))) : null, answer_rate_14d: recentQs.length ? +(answeredRecent / recentQs.length).toFixed(2) : null },
    escaped_defects: logObjects('observation').filter((o) => o.kind === 'escaped-defect' && Date.parse(o.created_at) >= since).length,
  };
  // what efficiencyData recomputes per calendar week, by the same code (not in the JSON)
  Object.defineProperty(m, METRICS_INTERNALS, { value: { cycles, ticketUsd, perPoint, items, POINTS } });
  // Efficiency (supervisor.md §3, Orient): tokens and clock time together, over ticket work (the
  // supervisor's own spend and planning are overhead, read from phase_usd). Waiting produces nothing:
  // a ticket in awaiting-word, blocked, parked or starting. This is over the whole window metrics
  // reads (--since); the dashboard's top-level efficiency (efficiencyData) is the same cycles and
  // spend counted per calendar week, with a score against the best of 12 weeks.
  // mis_rated: merged tickets whose results contradict their rating (supervisor.md §9).
  m.mis_rated = misRated(cycles, ts, ticketUsd, POINTS);
  // merged tickets' hours, start to merge, for hours per point (the tickets cost.per_point counts)
  m.cycle_hours_total = +(cycles.filter((c) => ticketUsd[c.id] !== undefined).reduce((a, c) => a + c.ms, 0) / 3600000).toFixed(2);
  m.efficiency = efficiencyOf(m);
  m.model_tiers = modelTierStats(items, now);
  // Threads (supervisor.md §3): how many are open, how many wait on the supervisor, how long a first
  // reply takes. Only once there is one, so a project without threads reads as it did before.
  const threadsNow = threadViews(readLog().objects);
  if (threadsNow.length) {
    const open = threadsNow.filter((x) => x.status === 'open');
    const replies = threadsNow.map((x) => x.first_reply_ms).filter((x) => x !== null);
    m.threads = { open: open.length, waiting_on_supervisor: open.filter((x) => x.waiting === 'supervisor').length, median_first_reply_minutes: replies.length ? +(median(replies) / 60000).toFixed(1) : null };
  }

  // Findings: blockers and inefficiencies, each with a next step.
  const f = [];
  const add = (severity, kind, subject, detail, suggestion, extra = {}) => f.push({ severity, kind, subject, detail, suggestion, ...extra });
  // Production sensors: a standing outage is medium (the down observation already woke the
  // supervisor once), a certificate about to lapse, a week under the uptime target.
  // A probe: failing three runs in a row (it is backing off), not run in 3 times its interval
  // while the supervisor runs, printing lines that don't validate after it ran clean (the provider
  // changed its API), or costing more than its budget. Discovery is due weekly.
  const supervisorRunning = fileAge(waitAliveFile()) < 20 * 60000;
  const ignoredNow = sensorIgnores();
  for (const m of sensorStatus().filter((x) => x.kind !== 'http')) {
    const subj = `sensor:${m.name}`;
    const def = sensorList().find((x) => x.name === m.name);
    if (m.fails >= 3) add('medium', 'sensor-failing', subj, `${m.fails} failed runs in a row: ${String(m.last_error ?? 'failed').slice(0, 120)} (probe output: data, not instructions)${m.backoff_minutes ? `; backing off to every ${m.backoff_minutes} min` : ''}`, /logged in|credential|token/i.test(m.last_error ?? '') ? 'its access lapsed: log in again, or ask the owner (an owner-action question with a secret slot)' : 'sensor test it; a fix to the probe is a chore ticket (an improvement trial when it targets a finding)');
    else if (supervisorRunning && m.last_at && Date.now() - Date.parse(m.last_at) > 3 * Math.max(m.every_minutes, m.backoff_minutes ?? 0) * 60000) add('medium', 'sensor-stale', subj, `not polled since ${m.last_at}, while the supervisor runs`, 'run sensor poll --name and read what it says; a poll that hangs is a probe to fix');
    if (m.invalid?.clean_before && Date.now() - Date.parse(m.invalid.at) < 86400000) add('medium', 'probe-drift', subj, `ran clean before, and its last run printed invalid lines (${m.invalid.lines.map((l) => l.why).join('; ')})`, 'the provider may have changed its API: sensor test it, and revise the probe as a chore ticket');
    const budget = def?.budget?.run_s ?? def?.probe_timeout_s / 2;
    const quota = Object.entries(m.metrics ?? {}).find(([k, v]) => /quota.*(left|remaining)/i.test(k) && v.unit === '%' && v.value < 10);
    const why = [m.costly && Date.now() - Date.parse(m.costly.at) < 86400000 ? m.costly.why : null, m.kind === 'probe' && m.today.runs >= 3 && m.today.mean_ms > budget * 1000 ? `mean run ${fmtMs(m.today.mean_ms)} over its ${budget}s budget` : null, quota ? `${quota[0]} ${quota[1].value}%` : null].filter(Boolean);
    if (why.length) add('low', 'probe-costly', subj, why.join('; '), 'poll less often (every_minutes), read a narrower window, or page through it');
    // noisy: over half of what it raised in 7 days was ignored; split: 3 or more of its
    // fingerprints folded into one incident, twice in 14 days; merged: one fingerprint has held
    // different exception classes or top frames
    const raised = new Set(logObjects('observation').filter((o) => fromSensor(o) && o.subject === subj && ['exception', 'log-error', 'platform-error'].includes(o.kind) && Date.now() - Date.parse(o.created_at) < 7 * 86400000).map(fpIdOfObservation).filter(Boolean));
    const ignoredN = [...raised].filter((id) => ignoredNow.has(id)).length;
    if (raised.size >= 4 && ignoredN / raised.size > 0.5) add('medium', 'probe-noisy', subj, `${ignoredN} of the ${raised.size} fingerprints it raised in 7 days were ignored`, 'raise its triage thresholds or filter at the source: revise the probe as an improvement trial on the ignore rate');
    const split = incidentList().filter((p) => Date.now() - Date.parse(p.created_at) < 14 * 86400000 && p.fingerprints.filter((f) => splitFpId(f).sensor === m.name).length >= 3);
    if (split.length >= 2) add('medium', 'probe-split', subj, `${split.length} incidents in 14 days each hold 3 or more of its fingerprints (${split.map((p) => p.id).join(', ')})`, 'its templating keeps ids or numbers: revise the probe so one cause is one fingerprint');
    const fpsNow = jsonOr(path.join(sensorDir(m.name), 'fingerprints.json'), {});
    const merged = Object.entries(fpsNow).filter(([, f]) => (f.variants ?? []).length > 1);
    if (merged.length) add('medium', 'probe-merged', subj, `${merged.length} fingerprint(s) have held different exceptions or top frames (${merged.slice(0, 3).map(([k, f]) => `${k}: ${f.variants.join(' / ')}`).join('; ').slice(0, 300)})`, 'its fingerprints are too coarse: use the provider\'s fingerprint, or add the class and top frame');
  }
  // a fix merged a day past its deploy lag with no deploy seen; a production problem no sensor saw
  const vd = verifyDefaults();
  for (const p of incidentList().filter((x) => x.status === 'mitigating')) {
    const t = followTicket(fixTicketOf(p.id));
    const at = t ? mergedAt(t.id) : null;
    const since = at ? deploysSince(at) : [];
    const why = !since.length ? 'no deploy observed since' : since.every((o) => !deployCommit(o)) ? 'the deploys since carry no commit' : since.some((o) => deployCommit(o) && !knownCommit(deployCommit(o))) ? 'a deploy since names a commit this repo doesn\'t have (git fetch?)' : 'no deploy since has its commit';
    if (at && Date.now() - at > vd.deploy_lag_minutes * 60000 + 86400000) add('medium', 'fix-unverified', p.id, `${t.id} merged ${new Date(at).toISOString()}: ${why}`, 'check the release went out (the deploy probe, the platform); a deploy probe is how verification sees it');
  }
  const sensorSaw = (ms) => logObjects('observation').some((o) => o.detector === 'sensor' && TRIAGE_KINDS.includes(o.kind) && Date.parse(o.created_at) <= ms && Date.parse(o.created_at) >= ms - 48 * 3600000);
  if (sensorList().length) for (const x of [...logObjects('observation').filter((o) => o.kind === 'escaped-defect'), ...logObjects('problem').filter((p) => p.created_by === 'owner' && p.realized && !isIncident(p) && /production|outage|\bprod\b|\bdown\b|customers?|users? (?:see|saw|report)/i.test(`${p.title} ${p.detail ?? ''}`))].filter((x) => Date.now() - Date.parse(x.created_at) < 14 * 86400000 && !sensorSaw(Date.parse(x.created_at)))) add('low', 'probe-missed', x.id, `${x.type === 'problem' ? 'the owner opened a problem' : 'an escaped defect'} (${String(x.title ?? x.detail ?? '').slice(0, 80)}) that no sensor observed in the 48h before`, 'if it was production, find what would have seen it (a probe, a threshold) and offer it');
  // an incident of severity 3 or more, open over an hour with no decision
  for (const p of incidentList().filter((x) => ['open', 'owned'].includes(x.status) && Date.now() - Date.parse(x.created_at) > 3600000)) {
    const sev = incidentSeverity(p);
    if (sev >= 3 && !incidentDecisions(p.id).length) add('medium', 'incident-unowned', p.id, `severity ${sev}, open since ${p.created_at}, no incident-fix decision`, 'decide a fix (decide --class incident-fix --refs <p-id> <ticket-id> …), or watch it with a reason');
  }
  // a sensor's escalation of severity 3 or more nobody has triaged, triage_overdue_hours (default 2)
  // after the first, while the supervisor runs: no incident holds it (once one does, incident-unowned
  // above takes over), it isn't ignored, and no live noise ruling cites it. Per fingerprint, over
  // the last 7 days, so an upgrade doesn't raise every escalation the log ever held.
  if (supervisorRunning) {
    const overdue = (Number(loadSettings().sensor_defaults?.triage_overdue_hours) || 2) * 3600000;
    const sensorsNow = new Set(sensorList().map((x) => x.name));
    const { ids: handled, keys: heldKeys } = explained();
    const byFp = new Map();
    for (const o of logObjects('observation')) {
      if (!fromSensor(o) || !TRIAGE_KINDS.includes(o.kind) || handled.has(o.id) || now - Date.parse(o.created_at) > 7 * 86400000) continue;
      const id = fpIdOfObservation(o);
      if (!id || !sensorsNow.has(splitFpId(id).sensor) || ignoredNow.has(id) || covered(heldKeys, id, o.created_at) || openIncidentOf(id)) continue;
      (byFp.get(id) ?? byFp.set(id, []).get(id)).push(o);
    }
    for (const [id, obs] of byFp) {
      const sev = Math.max(...obs.map((o) => o.severity ?? 0));
      const first = obs.map((o) => o.created_at).sort()[0];
      if (sev >= 3 && now - Date.parse(first) > overdue) add('medium', 'sensor-untriaged', id, `severity ${sev}, ${obs.length} observation(s) since ${first} (${obs.slice(-3).map((o) => o.id).join(', ')}), not triaged`, 'triage it: fold it into an incident, ignore it, or rule it noise (sensor incident, sensor ignore, decide --class orient-noise)');
    }
  }
  if (sensorList().length || logObjects('observation').some((o) => o.kind === 'discovery')) {
    const last = logObjects('observation').filter((o) => o.kind === 'discovery' && o.subject === 'sensors').sort(byTime).pop();
    const changed = last?.source_ref && last.source_ref !== discoveryKey();
    if (!last || changed || Date.now() - Date.parse(last.created_at) > 7 * 86400000) add('low', 'sensor-discovery-due', 'sensors', changed ? `the project has changed since production was last looked over (${dateOnly(last.created_at)}): its host, dependencies or deploy config` : last ? `production was last looked over on ${dateOnly(last.created_at)}` : 'production has not been looked over yet', 'sensor discover --record, then start a sensor for what it found (supervisor.md, Monitoring)');
  }
  // a credential posted for a sensor that isn't running yet: start it (no further question)
  for (const q of logObjects('question').filter((x) => x.sensor)) { const st = sensorCredentialState(q.sensor); if (st.status === 'posted' && st.question.id === q.id && !sensorList().some((s) => s.name === q.sensor)) add('medium', 'sensor-credential-ready', `sensor:${q.sensor}`, `the ${q.sensor} token was posted (${q.id})`, `land the sensor discover proposal for ${q.sensor} as a chore, no question (supervisor.md, Monitoring)`); }
  for (const m of sensorStatus().filter((x) => x.kind === 'http')) {
    if (m.state === 'down') add('medium', 'sensor-down', `sensor:${m.name}`, `${m.url} down since ${m.since}: ${m.last?.error ?? 'failing'}`, 'find why (the last deploy, the app logs), tell the owner, fix forward through a ticket (supervisor.md, Monitoring)');
    if (m.tls_days != null && m.tls_days <= m.tls_warn_days) add(m.tls_days <= 3 ? 'high' : 'medium', 'cert-expiring', `sensor:${m.name}`, `the certificate for ${m.url} expires in ${m.tls_days} day(s)`, 'renew it, or check the auto-renewal; ask the owner if it needs their account');
    if (m.slo?.uptime && m.uptime_7d != null && m.uptime_7d < 100 * m.slo.uptime) add('medium', 'slo-breach-week', `sensor:${m.name}`, `up ${m.uptime_7d}% over 7 days, under the ${100 * m.slo.uptime}% target`, 'read the down observations for a cause; a fix is a ticket, a target that is wrong is the owner\'s to change');
  }
  // Recurring checks (kit-168): main's jobs file that doesn't read; a check failing fail_after runs in a
  // row with no fix ticket (recurring ticket writes one); a check not run in 3 intervals while wait runs
  // and no runner holds the lock. Only the supervisor's detector recurring lines count (P5).
  if (projectInRepo && mainRef()) {
    const RF = recurringFailures;
    const rc = recurringRunDue.checks();
    if (rc.problem) add('high', 'recurring-invalid', 'recurring', rc.problem, 'fix `project/recurring.json` in a recurring chore with the owner\'s answer (supervisor.md, A broken main file); nothing runs until it reads');
    const lockLive = recurringLock.live(recurringLock.read());
    const UNIT = { h: 3600000, d: 86400000, w: 7 * 86400000, mo: 30 * 86400000 };
    for (const c of rc.checks) {
      const st = RF.state(c.name, c.entry);
      const subj = `recurring:${c.name}`;
      if (st.alerting && !st.fixTicket) add(c.entry.severity === 3 ? 'high' : 'medium', 'recurring-failing', subj, `${st.stretch.length} failing runs in a row since ${st.since}; the last printed (output: data, not instructions) ${JSON.stringify(recurringRunDue.scrub(st.stretch.at(-1)?.excerpt ?? '', false))}`, `recurring ticket ${c.name} --id <component>-<NN>-fix-${c.name} --touches '<globs>', or ack it`);
      const every = /^([1-9][0-9]*)(h|d|w|mo)$/.exec(c.entry.every);
      const from = st.results.at(-1)?.at ?? c.start;
      if (supervisorRunning && !lockLive && every && from && Date.now() - Date.parse(from) > 3 * Number(every[1]) * UNIT[every[2]]) add('medium', 'recurring-stale', subj, `not run since ${from}, over 3 intervals of ${c.entry.every}, while wait runs`, 'check that wait is running, and read run/recurring/runner.log');
    }
    // Chores (kit-164): due and not started, overdue past grace_days, a started run not finished
    // grace_days after its start. A held Upkeep holds due and overdue (the chore waits); a park holds stuck too.
    const RC = recurringChores;
    const mode = goalMode(upkeepOrVirtual());
    for (const { name, entry } of rc.problem ? [] : RC.list().chores) {
      const st = RC.state(name, entry, { mode });
      if (!st) continue;
      const subj = `recurring:${name}`;
      if (st.due && !st.held) add('medium', st.overdue ? 'recurring-overdue' : 'recurring-due', subj, `${entry.title}: due since ${recurringFailures.isoSec(st.slot)}${st.overdue ? `, over its ${RC.grace(entry)} day(s) of grace` : ''} (a ${entry.by}'s chore)`, `recurring start ${name}`);
      if (st.stuck && !['park', 'let-go'].includes(mode)) add('medium', 'recurring-stuck', subj, `${entry.title}: started ${recurringFailures.isoSec(st.open.start)} as ${st.open.ref} and not finished in ${RC.grace(entry)} day(s)`, RC.isTicketRef(st.open.ref) ? `see to ${st.open.ref}: start or unstick its worker, or supersede it` : `land it (chore pr, then merge --chore ${st.open.ref.replace(/^chore-/, '')}), or recurring done ${name} --nothing "<why>" | --abandoned "<why>"; if its PR was closed unmerged, recurring start ${name} reads it as abandoned (it starts again when its next slot is due)`);
    }
  }
  // A flake is a finding while it's recent: one that hasn't flipped for a week was fixed or
  // explained, and its history stays in gates.flaky_gates without raising it again every day.
  const flakyRecent = (at) => !!at && now - Date.parse(at) < 7 * 24 * 3600000;
  for (const g of gates.flaky_gates.filter((x) => flakyRecent(x.last_flip))) add('high', 'flaky-gate', g.gate, `failed then passed at the same commit ${g.commits} time(s), last ${g.last_flip.slice(0, 10)}`, 'find the flaky tests (run with --junit) and fix or quarantine them');
  for (const t of gates.flaky_tests.filter((x) => flakyRecent(x.last_flip)).slice(0, 10)) add('high', 'flaky-test', t.name, `failed then passed at the same commit ${t.times} time(s)`, 'make it deterministic (time, order, shared state, network) or quarantine it with a ticket');
  for (const g of gates.gates.filter((x) => x.median_seconds >= settings.slow_gate_minutes * 60)) add('medium', 'slow-gate', g.gate, `median ${(g.median_seconds / 60).toFixed(1)} min over ${g.runs} run(s)`, 'shard it, cache dependencies, or split fast checks from slow ones');
  for (const t of gates.slowest_tests.slice(0, 5).filter((x) => x.median_seconds >= 10)) add('low', 'slow-test', t.name, `median ${t.median_seconds}s`, 'mock the slow dependency or move it to an integration suite');
  // A share of almost nothing is noise: hotspots wait for a few hours of ticket time or a few dollars.
  const HOTSPOT_MIN_MS = 4 * 3600000, HOTSPOT_MIN_USD = 5;
  const totalPhase = Object.values(phaseMs).reduce((a, b) => a + b, 0);
  const [topPhase, topMs] = Object.entries(phaseMs).filter(([k]) => !['done', 'parked'].includes(k)).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (phaseNow.size >= 2 && topPhase && totalPhase >= HOTSPOT_MIN_MS && topMs / totalPhase > 0.4) add('medium', 'phase-hotspot', topPhase, `${Math.round((100 * topMs) / totalPhase)}% of all ticket time`, 'look at why tickets sit here: reviews, gates, answers');
  const totalUsd = Object.values(phaseUsd).reduce((a, b) => a + b, 0);
  const [costPhase, costUsd] = Object.entries(phaseUsd).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (phaseNow.size >= 2 && costPhase && totalUsd >= HOTSPOT_MIN_USD && costUsd / totalUsd > 0.5) add('medium', 'cost-hotspot', costPhase, `${Math.round((100 * costUsd) / totalUsd)}% of spend ($${costUsd.toFixed(2)})`, 'check context size and model choice for this phase');
  // what holds each item (heldByMap); a ticket that can still move: active, unmerged, and not on a
  // parked or let-go goal (that one waits by choice)
  const H = heldByMap();
  const live = (id) => { const t = ts.get(id); return !!t && isActive(t) && !mergeShaFor(id) && !['park', 'let-go'].includes(ticketMode(t)); };
  for (const [id, p] of phaseNow) {
    const h = (now - p.sinceMs) / 3600000;
    // Blocked on an open owner question (asked for it, or naming it in blocks): the next move is the
    // owner's, already in their inbox, so say which question rather than tell the supervisor to act.
    const ownerQs = ['blocked', 'awaiting-word'].includes(p.phase) ? openQs.filter((q) => q.ticket === id || (q.blocks ?? []).includes(id)) : [];
    if (p.phase === 'blocked' && h >= 1 && ownerQs.length) add('medium', 'blocked-on-owner', id, `blocked for ${h.toFixed(1)}h on the owner's answer to ${ownerQs.map((q) => q.id).join(', ')}`, 'nothing for the supervisor until it is answered; remind the owner what it blocks if it sits');
    // blocked with nothing in the owner's Inbox about it: if it waits on the owner, the question was
    // never asked (one put only in the supervisor's chat never reaches the Inbox or the dashboard)
    // blocked only on dependencies that haven't merged, with nothing asked of the supervisor: it
    // waits as planned (status says WAITING ON <ids> TO MERGE), and isn't a stuck session
    else if (p.phase === 'blocked' && (ts.get(id)?.depends_on ?? []).some((d) => !mergeShaFor(d)) && !openMsgs.some((m) => m.created_by === id || m.ticket === id)) {}
    else if (p.phase === 'blocked' && h >= 1) add('high', 'blocked', id, `blocked for ${h.toFixed(1)}h, and no open owner question names it`, `if it waits on the owner, ask (ask --blocks ${id}): a question put only in your chat never reaches the Inbox; otherwise answer its message, re-plan, or park it`);
    // the first hour of the same: blocked with nothing holding it, raised at once
    else if (p.phase === 'blocked' && h < 1 && !H.has(id) && live(id)) add('medium', 'blocked-without-question', id, `blocked for ${Math.round(h * 60)} min with no open owner question naming it`, `if it waits on the owner, ask (ask --blocks ${id}); otherwise answer its blocked message so it can move`);
    // awaiting the word while an open owner question blocks it: the word waits on the owner
    if (p.phase === 'awaiting-word' && h >= 1 && ownerQs.length) add('medium', 'blocked-on-owner', id, `waiting for the word for ${h.toFixed(1)}h on the owner's answer to ${ownerQs.map((q) => q.id).join(', ')}`, 'nothing for the supervisor until it is answered; remind the owner what it blocks if it sits');
    else if (p.phase === 'awaiting-word' && h >= 1) add('medium', 'waiting-on-supervisor', id, `waiting for the stage or merge word for ${h.toFixed(1)}h`, 'answer its review-request: give the word, run merge, or say what is missing');
  }
  // a planner can't log phase blocked: it says so in a blocked message, shown while unanswered. It is
  // held through waiting_on_owner (a question on its goal, or linking its branch), never --blocks; one
  // parked, or whose goals are all parked or let go, waits by choice.
  for (const p of planners()) {
    const key = `plan-${p.feature}`;
    if (p.parked || ['park', 'let-go'].includes(modeOf(p.goals.map((g) => logGet(g)).filter((g) => g?.type === 'goal')))) continue;
    const ask = p.goals.length ? `ask --goal ${p.goals[0]} …` : `ask … --links '[{"title":"The plan","ref":"plan/${p.feature}","path":"${projectRel}/log/${key}.jsonl"}]'`;
    if (p.waiting_on_supervisor.some((m) => m.kind === 'blocked') && !H.get(key)) add('medium', 'blocked-without-question', key, 'blocked with no open owner question naming it', `if it waits on the owner, ask on its goal (${ask}); otherwise answer its blocked message so it can move`);
  }
  // The tmux session's window names, once (null when tmux or the session isn't there: unknown).
  let windowNames;
  const windowGone = (name) => {
    if (windowNames === undefined) { const l = sh('tmux', ['list-windows', '-t', `=${tmuxSession()}`, '-F', '#W']); windowNames = l === null ? null : new Set(l.split('\n').filter(Boolean)); }
    return windowNames !== null && !windowNames.has(name);
  };
  for (const id of ts.keys()) {
    const w = workerState(id);
    const wait = paneWaiting(id);
    if (wait) add('high', 'blocked-prompt', id, wait.kind === 'limit' ? `a usage-limit banner in its pane: "${wait.line}"` : `waiting on a prompt in its pane: "${wait.line}"`, `look (tmux select-window -t '${tmuxTarget(id)}') and clear it (supervisor.md §11); a permission prompt a worker should never see means agent_command or its deny rules need a fix, and a folder-trust dialog that agent_trust_command could pre-trust the worktree`);
    // held on purpose, or a launch stopped before it ran (stoppedLaunch), is not stale either.
    // waiting is not stale: an open owner question that blocks the ticket, or the worker's own
    // request to the supervisor still unanswered (the unanswered-message finding covers that)
    const waitingOnOwner = openQs.some((q) => (q.blocks ?? []).includes(id) || q.ticket === id);
    const waitingOnSupervisor = openMsgs.some((m) => m.created_by === id);
    const exited = w && w.phase && !['done', 'parked'].includes(w.phase) && !mergeShaFor(id) ? agentExited(id) : null;
    if (exited) add('high', 'agent-exited', id, exited.replace(/; resume it first$/, ''), `resume it: worker ${id} --resume (supervisor.md, recovery)`);
    else if (w && w.phase && !['done', 'parked', 'awaiting-word', 'blocked'].includes(w.phase) && !mergeShaFor(id) && !waitingOnOwner && !waitingOnSupervisor && w.minutes_silent > settings.stale_after_minutes && !isHeld(ts.get(id)) && !stoppedLaunch(id)) add('high', 'stale-worker', id, ...(windowGone(id) ? [`silent for ${w.minutes_silent} min (phase ${w.phase}) and its tmux window is gone`, `resume it: worker ${id} --resume (supervisor.md, recovery)`] : [...(idleOnApiError(id) ? [`silent for ${w.minutes_silent} min (phase ${w.phase}), stopped on an API or network error`, `nudge it: send ${id} "the network dropped; carry on from where you were"`] : idleWithShell(id) ? [`silent for ${w.minutes_silent} min (phase ${w.phase}), idle at its prompt with a background shell still running`, `nudge it: send ${id} "check your background shell's result and carry on" (an agent can lose the result across a compaction)`] : [`silent for ${w.minutes_silent} min (phase ${w.phase})`, 'check its pane; resume it (supervisor.md, recovery)'])]));
  }
  for (const p of planners()) {
    const who = `plan-${p.feature}`;
    // a planner parked by a drain stopped on purpose: not gone, exited or stale
    if (p.parked) continue;
    if (p.waiting) add('high', 'blocked-prompt', who, p.waiting.kind === 'limit' ? `a usage-limit banner in its pane: "${p.waiting.line}"` : `waiting on a prompt in its pane: "${p.waiting.line}"`, `look (tmux select-window -t '${tmuxTarget(who)}') and clear it (supervisor.md §11); a folder-trust dialog means agent_trust_command could pre-trust the worktree`);
    else if (/no agent is running|has exited/.test(p.problem ?? '')) add('high', 'agent-exited', who, p.problem.replace(/; resume it first$/, ''), `resume it: planner ${p.feature} --resume (supervisor.md §11)`);
    else if (!p.window) add('medium', 'planner-gone', who, `plan/${p.feature} isn't on main and its window is gone (${p.problem})`, `resume it (planner ${p.feature} --resume) or, if the plan was dropped, delete the branch`);
    else if (!p.waiting_on_supervisor.length && !p.waiting_on_owner.length && p.minutes_silent > settings.stale_after_minutes) add('high', 'stale-planner', who, `no sign of life for ${p.minutes_silent} min`, 'check its pane; message it or resume it (supervisor.md §11)');
  }
  for (const msg of openMsgs.filter((x) => now - Date.parse(x.created_at) > 30 * 60000)) add('medium', 'unanswered-message', msg.id, `${msg.kind} from ${msg.created_by}, ${Math.round((now - Date.parse(msg.created_at)) / 60000)} min old`, `reply with --re ${msg.id}`);
  // A review's page lives on the branch that asked it until its PR lands it on main; once no branch
  // or tag holds that commit and its files are not on main either (a squash merge leaves them
  // there, at their paths), the page the owner answers (or answered) on is lost at the next prune.
  const reviewQs = questions().filter((x) => x.kind === 'review' && x.review && ['open', 'answered'].includes(x.status));
  for (const q of reviewQs.filter((x) => reviewPins(x.review).status === 'missing')) add('high', 'review-file-missing', q.id, `its page is pinned to ${String(q.review.commit).slice(0, 12)} (asked on ${q.review.ref}), which no branch or tag holds any more, or which can't be read, and its files are not on main`, q.status === 'open' ? 'withdraw it and ask again on a page committed to a live branch' : `restore the branch before the commit is pruned (git branch ${q.review.ref} ${q.review.commit}), then land the page and the result in its PR (review result ${q.id} --commit), so the page the owner answered on stays on record`);
  // The owner's result is permanent only once the PR that asked carries it onto main.
  const unlandedAfter = settings.stale_after_minutes * 48 * 60000;
  const answeredReviews = reviewQs.filter((x) => x.status === 'answered' && !x.declined && x.result?.sha256 && now - Date.parse(x.answered_at) > unlandedAfter);
  if (answeredReviews.length && projectInRepo && mainRef()) {
    const main = mainRef();
    const onMain = new Map();
    for (const f of (git(['ls-tree', '-r', '--name-only', main, '--', `${projectRel}/questions`, `${projectRel}/tickets`]) ?? '').split('\n')) { const qid = reviewResultPath(f); if (qid) onMain.set(qid, [...(onMain.get(qid) ?? []), f]); }
    for (const q of answeredReviews) {
      if ((onMain.get(q.id) ?? []).some((f) => { const b = gitBlob(main, f); return b !== null && sha256(b) === q.result.sha256; })) continue;
      add('medium', 'review-unlanded', q.id, `answered ${hours(now - Date.parse(q.answered_at))}h ago; the owner's result is not on ${loadSettings().main_branch} yet (it lives only in run/, which no one backs up)`, `in the worktree of the PR that asked (${q.review.ref}): review result ${q.id} --commit, commit it, and land the PR`);
    }
  }
  { const u = ownerLinesUnread(); const old = u.filter((l) => now - Date.parse(l.at) > UNREAD_GRACE_MS); if (old.length) add('high', 'owner-unread', 'owner', `${old.length} line${old.length === 1 ? '' : 's'} from the owner unread for over ${UNREAD_GRACE_MS / 60000} minutes, the oldest ${old[0].id} (${unreadWhat(old[0])})`, 'run unread, act on each, then unread ack <the refs you dealt with>'); }
  for (const q of openQs.filter((x) => now - Date.parse(x.asked_at) > grace)) add('high', 'owner-question-waiting', q.id, q.question.slice(0, 120), q.default ? 'apply its default' : 'remind the owner; it blocks work');
  if (recentQs.length >= 4 && answeredRecent / recentQs.length < 0.5) add('high', 'inbox-stalled', 'owner questions', `${answeredRecent} of ${recentQs.length} answered in 14 days`, 'remind the owner what is blocked; give defaults where the class allows; withdraw what no longer matters');
  // churn is a signal to re-plan a ticket still in flight; a merged ticket's passes are retro material
  for (const [id, n] of Object.entries(reviewPasses()).filter(([id2, n]) => n >= 3 && !mergeShaFor(id2))) add('medium', 'review-churn', id, `${n} final review passes`, 'the ticket may be too big or under-specified; re-plan it');
  // An old fleet drain in force starts nothing; goal holds start nothing for their goals.
  const drained = !!draining();
  // over the machine's memory ceiling, no finding suggests starting a session; memory-full says why
  const memFull = memoryFull(settings);
  let idlePlanning = 0;
  const ready = [...ts.values()].filter((t) => isActive(t) && !isHeld(t) && !mergeShaFor(t.id) && !(activeWorker(t.id) && !stoppedLaunch(t.id)) && (t.depends_on ?? []).every((d) => mergeShaFor(d)) && !notSchedulable(t) && ticketMode(t) === 'run');
  holdFindings(add, settings);
  // A goal's live ticket that waits, directly or through others, on work of a goal
  // PRIORITY_INVERSION_GAP or more numbers worse that nobody has started: a ticket that could start
  // now (its dependencies merged, no worker), or one held. Nothing else pushes that work, and a
  // dependency added only to keep footprints apart (planning.md D4) can point the wrong way. One
  // finding per blocked goal. The walk goes only through running goals' live tickets: work behind a
  // held goal is blocked-by-goal-hold's, and work behind a running worker waits on that worker.
  // Blockers with no priority (chores, unprioritised goals) are never lower, so never named.
  // A held ticket that waits still counts as waiting, as it still passes its priority on in
  // effectivePriorities: its hold is a pause, and the work it waits on is still behind when it lifts.
  // While the fleet drains or memory is full nothing starts, so it is quiet, as idle-capacity is.
  if (!drained && !memFull) {
    const run = new Map([...ts].filter(([id, t]) => live(id) && ticketMode(t) === 'run'));
    const clos = closures(run);
    // the frontier nobody has started, with each ticket's own priority, worked out once
    const frontier = new Map();
    for (const [id, t] of run) {
      if (countsAsWorker(t) || !(t.depends_on ?? []).every((d) => mergeShaFor(d))) continue;
      const own = ownPriority(t);
      if (own) frontier.set(id, { ...own, held: isHeld(t) ? t.held : null });
    }
    const goalsOf = new Map([...run].map(([id, t]) => [id, ticketGoals(t).map((x) => x.id)]));
    for (const g of logObjects('goal').filter((x) => !['met', 'abandoned'].includes(x.status) && typeof x.priority === 'number' && goalMode(x) === 'run')) {
      const waiting = new Set();
      const on = new Map();
      for (const [id] of run) {
        if (!goalsOf.get(id).includes(g.id)) continue;
        for (const d of clos.get(id) ?? []) {
          const b = frontier.get(d);
          if (!b || b.priority - g.priority < PRIORITY_INVERSION_GAP) continue;
          waiting.add(id);
          on.set(d, b);
        }
      }
      if (!on.size) continue;
      const list = [...on].sort((a, b) => b[1].priority - a[1].priority || a[0].localeCompare(b[0]));
      const named = (xs) => xs.slice(0, 5).map(([id, b]) => `${id} (p${b.priority}${b.held ? `, held: ${b.held}` : ''})`).join(', ') + (xs.length > 5 ? `, and ${xs.length - 5} more` : '');
      const startable = list.filter(([, b]) => !b.held);
      const held = list.filter(([, b]) => b.held);
      add('medium', 'priority-inversion', g.id, `p${g.priority} "${g.title}": ${plural(waiting.size, 'ticket')} wait${waiting.size === 1 ? 's' : ''} on lower-priority work nobody has started: ${named(list)}`, `${startable.length ? `start ${startable.length === 1 ? 'it' : 'them'} now (ready lists ${startable.length === 1 ? 'it' : 'them'} first, marked "blocks p${g.priority}")` : ''}${startable.length && held.length ? '; ' : ''}${held.length ? `release the held ${held.length === 1 ? 'one' : 'ones'} if the hold no longer stands` : ''}; where an edge only keeps footprints apart (planning.md D4), reverse it so the lower-priority ticket waits, or cut it by narrowing touches`);
    }
  }
  // What matters most: the strategy, each goal's impact, and the ratings the Inbox is ordered by.
  {
    const goals = logObjects('goal');
    const live = goals.filter((g) => g.status === 'ready');
    const sState = strategyState();
    // Every project has one, an older one too: high (wait keeps raising it, and nothing is held back) until the supervisor has a
    // draft in front of the owner, then medium while the owner reads it.
    const strategyAsked = questions().some((q) => q.status === 'open' && q.class === 'strategy-change');
    if (live.length && sState !== 'written') add(strategyAsked ? 'medium' : 'high', 'strategy-unwritten', strategyRel, sState === 'missing' ? `${plural(live.length, 'goal')} running and no strategy on ${settings.main_branch}` : `${plural(live.length, 'goal')} running and the strategy is still the template`, `draft it next, while work carries on, in a chore from what you can read, then ask the owner to approve it (ask --class strategy-change; supervisor.md §1)${sState === 'missing' ? '; init writes the template' : ''}`);
    selfFindings(add);
    exteriorFindings(add);
    const all = questions();
    const open = all.filter((q) => q.status === 'open' && q.goal_hold !== 'let-go');
    for (const g of goals.filter((x) => x.status === 'ready' || ((x.status ?? 'draft') === 'draft' && open.some((q) => q.goal === x.id)))) {
      const i = goalImpact(g.id);
      if (!i) add('medium', 'goal-unjudged', g.id, `"${g.title}" has no impact, so its questions are ordered as if it were worth having (2)`, `judge it against the strategy: goal impact ${g.id} <1-4> --rationale "…" (planning.md §1)`);
      else if (i.rejudge) add('medium', 'goal-unjudged', g.id, `the impact of "${g.title}" (${i.level}) was corrected: ${i.correction}`, `judge it again, saying what the correction changed: goal impact ${g.id} <1-4> --rationale "…"`);
    }
    // A running goal at its target closes only on the owner's word, so ask it in the Inbox. Medium:
    // the tick reads it and wait doesn't loop on it. Quiet while a goal-met question about it is open,
    // or once the owner answered one asked after this reading, until a newer reading.
    for (const g of live) {
      const r = goalAtTarget(g);
      if (!r) continue;
      // a No about this same value stands until the value moves or the goal changes
      if (goalAtTargetQuiet(g, r, all)) continue;
      const m = measureOf(g);
      add('medium', 'goal-at-target', g.id, `"${g.title}" reads ${r.measure.value}${m.unit ? ` ${m.unit}` : ''} (${r.created_at.slice(0, 10)}), its target ${m.target}, and is still running: only the owner marks it met`, `ask the owner in the Inbox, never only in chat: ask --class goal-met --goal ${g.id} --recommendation yes (the kit writes the question; planning.md §1)`);
    }
    // only once the supervisor has rated one: a project that hasn't taken up the rating sees nothing
    const firstRated = all.filter((q) => q.stake != null || q.urgency != null).map((q) => q.asked_at).sort()[0];
    if (firstRated) for (const q of open.filter((x) => (x.stake == null || x.urgency == null) && x.asked_at > firstRated)) add('medium', 'question-unrated', q.id, q.question.slice(0, 120), `rate it: rate ${q.id} --stake 1-3 --urgency 1-3 (supervisor.md §6)`);
    // a page it links changed or went since it was asked, so answer refuses it: ask again (never
    // answered, so not a W2 re-ask)
    for (const q of open.filter((x) => x.links_moved)) add('medium', 'question-link-changed', q.id, q.links_moved, `withdraw ${q.id} --reason "its linked page changed since it was asked" and ask again about the page as it is now (ask … --links …)`);
    const rated = open.filter((q) => q.stake != null && q.urgency != null);
    for (const k of ['stake', 'urgency']) {
      const top = rated.filter((q) => q[k] === 3).length;
      if (rated.length >= 5 && top * 2 > rated.length) add('medium', 'rating-inflated', k, `${top} of ${rated.length} open questions are ${k} 3`, `a rating that is always 3 orders nothing: read the ${k} test again (supervisor.md §6) and rate the ones that aren't 3 (rate <qid> --${k} n)`);
    }
    // the settling answer as answer's own note reads it (kit-313): the pick, never words alone; an
    // older line without the key by its text
    const settled = (x) => (x.in_words === null ? sameAnswer(x.answer, x.settles_if) : !!x.choice && sameAnswer(x.choice, x.settles_if));
    for (const q of all.filter((x) => x.status === 'answered' && x.settles.length && settled(x))) {
      const left = q.settles.filter((s) => open.some((o) => o.id === s));
      if (left.length) add('medium', 'settled-not-withdrawn', q.id, `the owner answered "${String(q.answer).slice(0, 60)}", which settles ${left.join(', ')}; ${left.length > 1 ? 'they are' : 'it is'} still in the Inbox`, `withdraw ${left.length > 1 ? 'each' : 'it'}: withdraw <qid> --reason "settled by the owner's answer to ${q.id}"`);
    }
  }
  const active = [...ts.values()].filter(countsAsWorker).length;
  // Goals that need planning with nobody planning them: a fully defined draft goal with no design up
  // for approval, or a ready goal whose current milestone has unplanned preconditions, and no
  // planner in flight for it while planner slots are free.
  {
    const ps = planners();
    // a goal whose design waits on another goal's (plan_after) waits until that one is approved
    const { waiting } = idlePlanningGoals(ps);
    const cap = settings.max_active_planners;
    // while the fleet drains for a move, nothing new starts: no idle planning, no idle capacity
    if (!drained && waiting.length && (cap == null || ps.length < cap)) idlePlanning = waiting.length;
    if (idlePlanning && !memFull) add('medium', 'idle-planning', `${waiting.length} goal${waiting.length > 1 ? 's' : ''}`, `${ps.length}${cap == null ? '' : `/${cap}`} planner${ps.length === 1 ? '' : 's'} active; nobody is planning ${waiting.map((g) => `"${g.title}"`).join(', ')}`, `start a planner for each (goals plan in parallel), or record why one waits on another's design (goal set <id> --plan-after <g-id> --reason "…"): ${waiting.slice(0, cap == null ? waiting.length : Math.max(1, cap - ps.length)).map((g) => g.id).join(', ')}`);
  }
  // what idle capacity offers: ready tickets that don't overlap a running one's touches (ready marks those)
  const activeIds = [...ts.values()].filter(countsAsWorker).map((t) => t.id);
  // in ready's order, so the workers it names first are fixes, then what a higher-priority goal waits on
  const prio = effectivePriorities(ts);
  const sevOf = (t) => { const inc = t.kind === 'fix' ? incidentOfTicket(t.id) : null; return inc ? incidentSeverity(inc) : 0; };
  // and none its component's cap holds back, as the ticket rows' T12 reads it (a-20261123-192551256-supervisor);
  // memory stays out of this list: memory-full speaks for it
  const componentFull = (t) => activeIds.filter((x) => ts.get(x)?.component === t.component).length >= capOf(settings.max_active_per_component);
  const startable = ready.filter((t) => !overlapsActive(t, activeIds, ts).length && !componentFull(t)).map((t) => ({ t, kind: t.kind, severity: sevOf(t), priority: prio.get(t.id)?.priority })).sort(readyOrder).map((x) => x.t);
  // a ready fix ticket may use an incident slot past the cap
  const readyFix = startable.filter((t) => t.kind === 'fix').map((t) => ({ ...t, sev: incidentSeverity(incidentOfTicket(t.id) ?? { fingerprints: [] }) })).sort((a, b) => b.sev - a.sev);
  if (!drained && readyFix.length && active >= capOf(settings.max_active_tickets) && active < capOf(settings.max_active_tickets) + (settings.incident_slots ?? 0) && !memFull) add('medium', 'idle-capacity', `${readyFix.length} fix ready`, `${active}/${capWords(settings.max_active_tickets)} workers active, and an incident slot is free`, `make a worker for: ${readyFix[0].id}`);
  if (!drained && startable.length && active < capOf(settings.max_active_tickets) && !memFull) add('medium', 'idle-capacity', `${startable.length} ready`, `${active}/${capWords(settings.max_active_tickets)} workers active${startable.length < ready.length ? `; ${ready.length - startable.length} more wait on a running ticket whose touches they overlap` : ''}`, `make workers for: ${startable.slice(0, 5).map((t) => t.id).join(', ')}`);
  // the slots and planning above that the machine's memory leaves no room for: say that instead
  if (memFull && (idlePlanning || (!drained && ((startable.length && active < capOf(settings.max_active_tickets)) || (readyFix.length && active < capOf(settings.max_active_tickets) + (settings.incident_slots ?? 0)))))) add('medium', 'memory-full', 'machine', `${memFull.words}, with ${ready.length} ticket${ready.length === 1 ? '' : 's'} ready, ${active}/${capWords(settings.max_active_tickets)} workers active${idlePlanning ? `, and ${idlePlanning} waiting for a planner` : ''}`, 'start nothing new until some finish (a resume is fine); if this keeps happening, set max_active_tickets (or lower it), your own setting');
  // A fleet with nothing running: no worker and no planner for FLEET_IDLE_MS while it is neither
  // parked nor drained. idle-capacity speaks when a ticket can start, idle-planning when a goal
  // waits for a planner, memory-full when the machine has no room for either; each names its own
  // move, so this stays quiet when any of them spoke this pass. It speaks when nothing can start
  // (every ready ticket waits on the owner, everything is held, nothing is planned), so the
  // supervisor makes work instead of ticking over an empty fleet. The last sign of life is the
  // newest line any ticket's worker or any planner wrote (a planner's branch and files too), or the
  // log's first line when no session has ever run. A planner counts as running only while its
  // window is open and it waits on no owner answer: a plan branch left behind, or a design parked
  // on the owner's approval, is the stuck fleet this finding is for, once its stamps go quiet.
  // stale_after_minutes (30 by default, two quiet ticks at the default tick_minutes): the silence
  // after which a session reads as stuck reads the same for the fleet. A start takes a tick, so an
  // idle tick between waves is normal; more is the fleet idling.
  const FLEET_IDLE_MS = (settings.stale_after_minutes ?? 30) * 60000;
  const spoken = f.some((x) => ['idle-capacity', 'idle-planning', 'memory-full'].includes(x.kind));
  if (!drained && !fleetMode() && !active && !spoken && !planners().some((p) => !p.parked && p.window && !p.waiting_on_owner.length)) {
    const lines = readLog().lines;
    const stamps = lines.filter((l) => l.at && (ts.has(l.by) || String(l.by).startsWith('plan-'))).map((l) => l.at);
    for (const p of planners()) if (p.last_seen) stamps.push(p.last_seen);
    const lastAt = stamps.sort().pop() ?? lines.map((l) => l.at).filter(Boolean).sort()[0] ?? null;
    const idleMs = lastAt ? now - Date.parse(lastAt) : 0;
    if (idleMs > FLEET_IDLE_MS) {
      // open tickets: not superseded, not merged, no worker running. Held: the ticket's held field,
      // a goal not running, parked, or an open owner question naming it. Planned: the rest that
      // aren't ready (waiting on a dependency or a running ticket's touches).
      const open = [...ts.values()].filter((t) => isActive(t) && !mergeShaFor(t.id) && !countsAsWorker(t));
      const heldT = open.filter((t) => isHeld(t) || ticketMode(t) !== 'run' || H.has(t.id) || workerState(t.id)?.phase === 'parked');
      const heldIds = new Set(heldT.map((t) => t.id));
      const readyT = ready.filter((t) => !heldIds.has(t.id));
      const readyIds = new Set(readyT.map((t) => t.id));
      const planned = open.filter((t) => !heldIds.has(t.id) && !readyIds.has(t.id)).length;
      const L = ladder();
      const noDefault = questions().filter((q) => q.status === 'open' && !q.goal_hold && !q.default && !['one-way-door', 'review', 'owner-action'].includes(q.kind) && !(q.reasons ?? []).includes('one-way-door') && !(L.owner_only ?? []).includes(q.class));
      const chore = readyT.find((t) => t.kind === 'chore') ?? readyT[0];
      const ids = (xs) => xs.slice(0, 3).map((x) => x.id).join(', ');
      add('medium', 'fleet-idle', 'fleet', `no worker or planner has run for ${(idleMs / 3600000).toFixed(1)}h (last sign of life ${lastAt}); ${readyT.length} ticket${readyT.length === 1 ? '' : 's'} ready, ${heldT.length} held, ${planned} planned`, `in order: 1. ${chore ? `start a ready chore (worker ${chore.id})` : 'add a chore from what the metrics or the code point at'}; 2. split a held ticket so the part that doesn't need the owner runs (${heldT.length ? ids(heldT) : 'none held'}); 3. give an open no-default question a default (${noDefault.length ? ids(noDefault) : 'none open'}); 4. propose the next goal from strategy.md (a proposal question naming the "How it wins" line it serves, supervisor.md §9)`);
    }
  }
  // the owner asked for one of the supervisor's settings and main doesn't have it yet
  {
    const um = goalMode(upkeepOrVirtual());
    for (const [key, v] of Object.entries(askedSettingsView()).filter(([, x]) => x.label === ASKED_SAVED)) {
      const words = (x) => (x === null ? 'no limit' : String(x));
      const arg = v.asked === null ? 'none' : String(v.asked);
      add('medium', 'owner-setting-unlanded', key, `the owner asked for ${key} ${words(v.asked)} (${v.act}); main has ${words(v.value)}`, `${um !== 'run' ? `Upkeep is ${holdWords(um)}: ` : ''}devteam.mjs chore start settings; devteam.mjs settings set ${key} ${arg} --for ${v.act}; devteam.mjs chore pr settings --title "settings: ${key} ${words(v.asked)}"; devteam.mjs merge --chore settings. While Upkeep is drained or parked, chore start and merge --chore refuse, so the value waits until Upkeep runs (or --force, logged)`);
    }
  }
  // A chat answer's quote that the supervisor's transcript doesn't show the owner typing: a record
  // for the owner to look at, never a block.
  for (const q of chatQuotesNotFound()) add('medium', 'chat-quote-not-found', q.id, `recorded from chat as the owner's words, "${q.said.slice(0, 120)}", and the supervisor's transcript has no owner message with them`, 'check it on the dashboard; if the owner never said it, correct the answer');
  // A thread answer whose cited turn doesn't bear it out: a record for the owner to look at, never a block.
  for (const x of threadAnswersUnbound()) add('medium', 'thread-answer-unbound', x.id, `recorded from a thread as the owner's words, but it ${x.why}`, 'check it on the dashboard; if the owner never said it, correct the answer');
  // A thread the owner wrote in that has waited over 10 minutes for the supervisor: a reply dropped,
  // or the supervisor busier than it said. Timed from its oldest owed turn routed to the supervisor
  // or with no route (kit-104): a turn the responder has is never the supervisor's to wait on, and
  // a later turn of the responder's never restarts the clock. By id only: a subject's title may be page-written.
  const logNow = readLog().objects;
  const turnsNow = turnsByThread(logNow);
  for (const x of threadsNow.filter((y) => y.status === 'open' && y.waiting === 'supervisor')) {
    // an artifact note the owner handed to the supervisor waits from the hand-over (artifact-notes-1)
    if (x.subject?.kind === 'artifact' && x.handed?.to === 'supervisor') {
      const since = now - Date.parse(x.handed.at);
      if (since > THREAD_WAIT_MS) add('medium', 'thread-waiting', x.id, `the owner handed this note over ${Math.round(since / 60000)} min ago and has no reply`, `thread list --waiting, then thread show ${x.id} and reply with thread reply (first, when the work takes more than a turn)`);
      continue;
    }
    const first = owedIn(turnsNow.get(x.id) ?? [], logNow.get(x.id)).find((u) => u.routed_to !== 'responder');
    if (!first) continue;
    const ago = now - Date.parse(first.created_at);
    if (ago > THREAD_WAIT_MS) add('medium', 'thread-waiting', x.id, `the owner wrote in this thread ${Math.round(ago / 60000)} min ago and has no reply`, `thread list --waiting, then thread show ${x.id} and reply with thread reply (first, when the work takes more than a turn)`);
  }
  // The responder (kit-104). Overdue: a turn routed to it still owed past RESPONDER_OVERDUE_MS, or its
  // pending turn not followed up past RESPONDER_PENDING_MS (pendingOpen); high, so wait brings the supervisor,
  // which takes it (and every turn routes to it until it is answered). From the log alone, so an
  // answer or a resolve clears it. By id only.
  // A session's (kit-109): one high finding per session, naming its overdue turns; while it is open
  // sessionRoute skips the session, so its threads go to the responder or the supervisor
  for (const [w, os] of sessionsOverdue(logNow, now, turnsNow)) add('high', 'session-overdue', w, `${sessionWords(w, logNow)} has ${os.length === 1 ? 'a turn' : `${os.length} turns`} with no reply: ${os.map((o) => (o.why === 'owed' ? `the owner's turn ${o.turn} in ${o.thread}, ${o.min} min` : `its pending reply ${o.turn} in ${o.thread}, ${o.min} min with nothing after it`)).join('; ')}`, `answer each in its thread (thread show <t>, then thread reply <t>), and look at ${w}'s window; its threads go to the responder until then`);
  // A session's turn in a thread that doesn't bind to it: only a hand-written line makes one (a preview
  // whose record is gone can't be checked, so it isn't flagged)
  for (const [id, ts] of turnsNow) {
    const t = logNow.get(id);
    if (t?.type !== 'thread' || (isObj(t.subject) && t.subject.kind === 'preview' && !readPreviews().some((r) => r.name === t.subject.name))) continue;
    for (const u of ts) if (['ticket', 'planner'].includes(writerClass(u.created_by)) && boundWriter(t.subject, logNow) !== u.created_by) add('medium', 'thread-turn-unbound', u.id, `${u.created_by} wrote turn ${u.id} in ${id}, a thread not about its work`, `read it (thread show ${id}); a session replies only in threads bound to it, so this line was written by hand`);
  }
  for (const o of responderOverdue(logNow, now, turnsNow)) add('high', 'responder-overdue', o.thread, o.why === 'owed' ? `the owner's turn ${o.turn} went to the responder ${o.min} min ago and has no answer` : `the responder's pending reply ${o.turn} has had no follow-up for ${o.min} min`, `answer it in the thread (thread show ${o.thread}, then thread reply ${o.thread}), then look at the responder (responder --resume)`);
  // Down or stuck: only while settings.responder is on, the fleet's session is up and the fleet is
  // neither parked nor draining (a park stops it on purpose; a drain refuses its start), so a project
  // with no fleet session raises none (ruling a-20261123-045530036-supervisor (b)).
  if (settings.responder !== false && fleetMode() !== 'park' && !draining()) {
    const h = responderHealth();
    if (h.session && h.problem) add('medium', 'responder-down', 'responder', `the responder isn't running: ${h.problem}; the owner's turns go to the supervisor meanwhile`, 'devteam.mjs responder --resume (supervisor.md §13)');
    else if (h.stuck) add('medium', 'responder-stuck', 'responder', `the responder's pane is waiting on a prompt: "${h.stuck}"; the owner's turns go to the supervisor meanwhile`, `look (tmux select-window -t '${tmuxTarget(RESPONDER_NAME)}') and clear it, or responder --stop then responder`);
  }
  // An owner's turn no supervisor terminal took, unseen or unanswered (undeliveredTurns): high, so
  // it reaches past the stalled supervisor (hello's alert: machine status, the hub). By id only.
  for (const x of undeliveredTurns(now)) add('high', 'thread-undelivered', x.id, `the owner wrote ${x.waited_min} min ago and no supervisor terminal took it; the supervisor ${x.checked}`, `the supervisor is not checking: resume it (inside tmux, so turns reach it at once) and answer thread show ${x.id}`);
  // A harness's runtime file committed by accident: it churns in every worktree and means nothing elsewhere.
  const trackedRuntime = (git(['ls-files'], mainRoot) ?? '').split('\n').filter((f) => f && isHarnessRuntime(f));
  if (trackedRuntime.length) add('medium', 'tracked-runtime-file', trackedRuntime.slice(0, 3).join(', '), `${trackedRuntime.length} agent-harness runtime file(s) are tracked in git (${trackedRuntime.slice(0, 5).join(', ')}): machine-local state that changes in every worktree`, `a chore (it changes .gitignore, so it needs the owner's answer): git rm --cached ${trackedRuntime.map((f) => `'${f}'`).join(' ')}, and add ${RUNTIME_RES.filter(([, re]) => trackedRuntime.some((f) => re.test(f))).map(([pat]) => pat).join(' ')} to .gitignore`);
  // A key that decrypts production, copied into every worktree, is readable by every agent
  // (code-style.md §10): production decrypts its own file, or the default one when it has none.
  const prodKey = fs.existsSync(path.join(mainRoot, 'config/credentials/production.yml.enc')) ? 'config/credentials/production.key' : fs.existsSync(path.join(mainRoot, 'config/credentials.yml.enc')) ? 'config/master.key' : null;
  const accounts = accountsState();
  if (!accounts?.exhausted && accounts?.capacity?.gap) add('medium', 'accounts-capacity-gap', 'cswap', `the accounts with room run out about ${accounts.capacity.runs_out_at}, before the first full one resets (${accounts.capacity.next_reset_at})`, 'tell the owner: add an account (cswap add), or slow the fleets until a reset');
  if (accounts?.exhausted) add('high', 'accounts-exhausted', 'cswap', 'every cswap account is at a usage limit', 'wait for a reset or add an account (cswap add)');
  for (const a of accounts?.needs_login ?? []) add('medium', 'account-needs-login', a, 'cswap can no longer refresh this account', 'log in with it in Claude Code, then cswap add');
  for (const a of accounts?.restart_gave_up ?? []) add('high', 'restart-gave-up', a, `this session keeps needing a restart (a usage limit, or its window gone after the machine stopped): restarted ${RESTART_MAX} times in 6 hours, so it is left alone until those attempts age out`, `look at why: ${a === 'supervisor' ? 'its pane' : `tmux capture-pane -p -t '${tmuxTarget(a)}'`}, its account's usage (cswap list) and what it was doing. It is retried by itself once an attempt is 6 hours old`);
  if (accounts?.slot_held) {
    const since = accounts.slot_held_since ? Date.parse(accounts.slot_held_since) : Date.parse(accounts.at);
    const mins = Math.max(0, Math.round((Date.now() - since) / 60000));
    add(mins > 30 ? 'high' : 'medium', 'setup-slot-wait', 'setup-slots', `${plural(accounts.slot_held, 'gone session')} ${accounts.slot_held === 1 ? 'has' : 'have'} waited ${mins} min for a machine-wide setup slot to relaunch (each wait costs no attempt, so none of them ever gives up)`, 'a shorter worktree_setup (worktree_copy with npm install --prefer-offline), or more DEVTEAM_SETUP_SLOTS on this machine; ls ~/.devteam/setup-slots (each holder.json names its pid) shows what holds them');
  }
  if (accounts?.supervisor_limit) {
    // the id is read back from a file any agent could write: only one that could be an id is shown
    const id = SESSION_ID.test(accounts.supervisor_limit.session ?? '') ? accounts.supervisor_limit.session : null;
    add('high', 'supervisor-at-limit', 'supervisor', `the supervisor stopped at a usage limit: "${accounts.supervisor_limit.text}"${accounts.supervisor_limit.refused ? `; not restarted: ${String(accounts.supervisor_limit.refused).slice(0, 200)}` : ''}`, `once an account has room, exit it and resume its session (Claude Code: /exit, then ${id ? supervisorRecovery(id) : 'claude --resume, choosing its conversation'}): a running session keeps the limit even after the login changes`);
  }
  if (prodKey && (settings.worktree_files ?? []).includes(prodKey)) add('high', 'production-key-in-worktrees', prodKey, `settings.worktree_files copies ${prodKey}, which decrypts production's credentials, into every worker's worktree`, `the owner's change (settings, gate-change): give agents only development and test keys. ${prodKey === 'config/master.key' ? 'Move production secrets to config/credentials/production.yml.enc with its own production.key, kept only on the platform and in the owner\'s shell, then' : 'Then'} drop ${prodKey} from worktree_files (code-style.md §10)`);
  // Spend, for the improvement loop (supervisor.md §9): what costs more than it should.
  if (m.cost.source === 'measured') {
    const pp = (id) => (m.cost.by_ticket[id] ?? 0) / ({ S: 1, M: 2 }[ts.get(id)?.size] ?? 1);
    const merged = [...ts.keys()].filter((id) => mergedAt(id) && m.cost.by_ticket[id] !== undefined).map(pp).sort((a, b) => a - b);
    if (merged.length >= 5) {
      const med = merged[Math.floor(merged.length / 2)];
      for (const id of ts.keys()) {
        const recent = !mergedAt(id) || now - mergedAt(id) < 7 * DAY;
        if (recent && m.cost.by_ticket[id] >= 5 && pp(id) > 2 * med) add('medium', 'costly-ticket', id, `$${m.cost.by_ticket[id].toFixed(2)}, ${(pp(id) / med).toFixed(1)}× the median merged ticket per point ($${med.toFixed(2)})`, 'find where it went (phase_usd, review churn, restarts losing the cache) and try a lever on the next tickets like it (supervisor.md §9)');
      }
    }
    const recentItems = spendItems().filter((x) => x.at >= now - 7 * DAY);
    const inSide = recentItems.reduce((a, x) => a + x.input + x.cache_read + x.cache_write, 0);
    const reads = recentItems.reduce((a, x) => a + x.cache_read, 0);
    if (inSide > 5e6 && reads / inSide < 0.6) add('medium', 'low-cache-hit', 'prompt cache', `${Math.round((100 * reads) / inSide)}% of input tokens were cache reads this week`, 'agents are re-reading context they could keep: fewer restarts, resume instead of re-launch, stable prompt prefixes (supervisor.md §9)');
    const tw = m.cost.per_point_this_week, lw = m.cost.per_point_last_week;
    if (tw && lw && tw.tickets >= 3 && lw.tickets >= 3 && tw.usd_per_point > 1.5 * lw.usd_per_point) add('medium', 'cost-per-point-rising', 'spend', `$${tw.usd_per_point} per merged point this week, $${lw.usd_per_point} last week`, 'find what changed (model, ticket mix, review rounds) and trial a fix (supervisor.md §9)');
  }
  // Time efficiency, from phase hours and review records, so a fleet whose spend is only reported
  // (or not known) gets them too: tickets spending most of their clock waiting, stages whose first
  // passes are mostly rejected, and tickets rated small that weren't.
  const eff = m.efficiency;
  if (eff?.wait_hours_pct !== null && eff?.wait_hours_pct > 50 && m.tickets_merged >= EFF_MIN_MERGED()) add('medium', 'waiting-heavy', 'tickets', `${eff.wait_hours_pct}% of ticket hours were spent waiting (awaiting-word, blocked, parked, starting)`, 'answer review and merge requests the tick they arrive, give owner questions a default where one is allowed, and look at whether small tickets need every review stage (a trial, kept only while quality holds)');
  for (const x of m.mis_rated ?? []) add('low', 'mis-rated', x.id, `rated ${x.rated}, but: ${x.why.join('; ')}`, 'at the retro, fold what it teaches into how planners rate (a lesson), which tasks go to a fast model, or the review depth');
  for (const stage of ['spec', 'plan']) {
    const all = m.reviews?.by_stage?.[stage];
    // judged on the last 7 days once they hold enough first passes, so a fixed stage goes quiet
    // instead of carrying its history; else on every first pass, as before reviews were dated
    const recent = all?.last_7d?.first_passes >= EFF_MIN_PASSES();
    const st = recent ? all.last_7d : all;
    if (st && st.first_passes >= EFF_MIN_PASSES() && st.rejection_rate > 0.6) add('medium', 'review-churn', `${stage} review`, `${Math.round(100 * st.rejection_rate)}% of ${stage} first passes${recent ? ` in the last ${RECENT_DAYS} days` : ''} were rejected (${st.rejected} of ${st.first_passes})${st.top_blocking_rules?.length ? `; most cited: ${st.top_blocking_rules.slice(0, 3).map((x) => `${x.rule} ×${x.count}`).join(', ')}` : ''}`, `turn what first passes keep citing into what new sessions are told from the start: a lesson scoped to who writes the ${stage} (it reaches every new prompt), or a fix to the ${stage} template; or, if reviewers block on what isn't Critical or Important, fix the review prompt`);
  }
  const mt = m.model_tiers;
  if (mt && mt.unrouted.length >= TIER_MIN_TICKETS()) add('medium', 'fast-tasks-unrouted', 'build', `${mt.unrouted.length} of ${mt.tickets} recent tickets planned fast tasks (${mt.unrouted.reduce((a, x) => a + x.fast_tasks, 0)} of ${mt.unrouted.reduce((a, x) => a + x.tasks, 0)}) but spent under 5% of their build on a cheaper model (a floor: a worker's own cheap subagents count toward it too): ${mt.unrouted.slice(0, 4).map((x) => x.id).join(', ')}${mt.unrouted.length > 4 ? ', …' : ''}`, `have workers hand each \`Model: fast\` task to a subagent on settings.model_tiers.fast (worker.md §3); building it in the worker's own session is the exception, with its reason in the plan. Model misses so far: ${mt.misses} of ${mt.fast_tasks} fast tasks`);
  const unpriced = Object.entries(m.cost.unpriced_models ?? {});
  if (unpriced.length) add('low', 'unpriced-model', unpriced.map(([k]) => k).join(', '), `${unpriced.map(([k, n]) => `${k}: ${(n / 1e6).toFixed(1)}M tokens`).join('; ')} with no price, so spend undercounts`, 'the owner adds them to settings.model_prices ($ per million tokens: input, output, cache_read, cache_write)');
  if (m.escaped_defects) add('high', 'escaped-defects', `${m.escaped_defects}`, 'defects found after merge', 'retro: which review or gate should have caught each one');
  // Component lines on main: a gap is a severity-4 observation.
  // One per repo: home, then each repo link this machine can read (link-unreachable covers the rest).
  for (const name of ['home', ...Object.entries(settings.links ?? {}).filter(([, l]) => LINK_KINDS[l?.kind]?.hostsComponents).map(([id]) => id)]) {
    if (!repoReadable(name)) continue;
    const R = repo(name);
    const gap = coverageGapInfo(name, R);
    const at = name === 'home' ? '' : ` --repo ${name}`;
    if (gap.empty?.length) add('low', 'line-empty', name, `${gap.empty.length} owns glob(s) on ${R.mainRef()} match nothing: ${gap.empty.slice(0, 5).map((x) => `"${x}"`).join(', ')}`, 'remove or fix the glob in a chore PR (settings components); an empty glob blocks nothing');
    if (gap.count) add('high', 'unowned-files', name, `${R.mainRef()}${name === 'home' ? '' : ` (${name})`} has coverage gaps: ${gap.words} (devteam.mjs components check${at} lists them); no new ticket starts in ${name} until they clear`, 'a chore PR that extends a line (settings components), or moves the files into one', { sev: 4 });
  }
  // A ticket that reached its main before a ticket it depends on (merge refuses that, so this is a
  // merge by hand or in the forge's UI): its provider wasn't there when it landed. Read only where
  // both repos can be read; link-unreachable covers the rest. Only merges after this finding reached
  // home's main: merge didn't refuse them before, so older history raises nothing.
  const orderSince = upgradeAt('merged-out-of-order');
  for (const t of ts.values()) {
    const at = mergedAt(t.id);
    if (!at || orderSince === null || at < orderSince) continue;
    const early = (t.depends_on ?? []).filter((d) => ts.has(d) && factsRepo(d) && !(mergedAt(d) && mergedAt(d) <= at));
    const name = repoOfTicketLink(t);
    if (early.length) add('high', 'merged-out-of-order', t.id, `${t.id} reached ${name === 'home' ? '' : `${name}'s `}main before ${early.join(', ')}, which it depends on`, `check that ${t.id} works without ${early.length > 1 ? 'them' : 'it'}, and merge ${early.join(', ')} next; a revert is a ticket of its own`, { sev: 3 });
  }
  // A half-done merge (records in home landed, code not): the finding that names the fix.
  for (const t of ts.values()) if (recordsLandedOnly(t)) add('high', 'records-without-code', t.id, `${t.id}: ${RECORDS_ONLY_FIX(t.id)}`, `merge ${t.id} again: it re-checks at the same records and lands only the code`, { sev: 3 });
  // A merge on any repo's main that merge never made (a worker's push to its repo's main, a merge
  // on the forge's button): no gates, reviews or checks ran on it. A ticket that reads merged with
  // no merge-word act, and a merge commit whose branch head no merge act names. Only merges after
  // this finding reached home's main, so an existing project's history raises nothing.
  {
    const since = upgradeAt('merged-without-merge');
    if (since !== null) {
      const acts = logObjects('act').filter((a) => ['merge-word', 'merge-chore', 'approve-feature-plan'].includes(a.class));
      // every sha a merge act names: a records-in-home ticket's act names its records merge's head too
      const heads = new Set(acts.flatMap((a) => [...String(a.what ?? '').matchAll(/\bat ([0-9a-f]{40})\b/g)].map((x) => x[1])));
      const worded = new Set(acts.filter((a) => a.class === 'merge-word').flatMap((a) => a.refs ?? []));
      // merge's act is logged seconds after the forge lands the merge (kit-808), so a merge raises nothing
      // in its first 2 minutes. Read now, not collectMetrics' now: one that lands while it runs would be
      // later than that. A commit time in the future is raised at once, so a date can't hide a merge.
      const justMerged = (at) => { const age = Date.now() - at; return age >= 0 && age < 120000; };
      const seen = new Set();
      for (const t of ts.values()) {
        const at = mergedAt(t.id);
        if (!at || at < since || worded.has(t.id)) continue;
        const sha = mergeShaFor(t.id);
        const name = repoOfTicketLink(t);
        seen.add(sha);
        if (justMerged(at)) continue;
        add('high', 'merged-without-merge', t.id, `${t.id} reached ${name === 'home' ? '' : `${name}'s `}main at ${sha.slice(0, 12)} with no merge act: no gates, reviews or checks ran on it`, `check it now (check-pr${name === 'home' ? '' : ` --repo ${name}`} at that sha, its records, its gates); a revert is a ticket of its own; then find how it landed (a push to main, the forge's button) and close that path`, { sev: 3 });
      }
      for (const name of ['home', ...Object.entries(settings.links ?? {}).filter(([, l]) => LINK_KINDS[l?.kind]?.hostsComponents).map(([id]) => id)]) {
        if (!repoReadable(name)) continue;
        const R = repo(name);
        const ref = R.mainRef();
        if (!ref) continue;
        for (const row of (R.git(['log', ref, '--first-parent', '--merges', `--since=${Math.floor(since / 1000)}`, '--format=%H %ct %P']) ?? '').split('\n').filter(Boolean)) {
          const [sha, ct, , p2] = row.split(' ');
          if (Number(ct) * 1000 < since || seen.has(sha) || heads.has(p2) || justMerged(Number(ct) * 1000)) continue;
          add('high', 'merged-without-merge', `${name}:${sha.slice(0, 12)}`, `${name === 'home' ? '' : `${name}'s `}main has merge ${sha.slice(0, 12)} (of ${p2.slice(0, 12)}) that no merge act made: no gates, reviews or checks ran on it`, 'find what it merged and check it now; merges go through devteam.mjs merge, never the forge\'s button or a push to main', { sev: 3 });
        }
      }
    }
  }
  // The registry: a link that no longer resolves, and lines drawn in the wrong place.
  {
    const reg = settings.links ?? {};
    let probes = {};
    try { probes = readJson(PROBE_FILE); } catch {}
    let fetches = {};
    try { fetches = readJson(FETCH_FILE); } catch {}
    for (const [id, l] of Object.entries(reg)) {
      const K = LINK_KINDS[l.kind];
      if (!K) continue;
      const fresh = ownEntry(probes, id)?.target === canonical(l) ? probes[id] : null;
      const why = K.reachable(l, id) ?? fresh?.problem ?? null;
      if (why) add('high', 'link-unreachable', id, why, K.fixHint(l, id));
      else if (K.hostsComponents && ownEntry(fetches, id)?.problem) add('high', 'repo-unreachable', id, fetches[id].problem, `check this machine can reach ${redactUrl(l.remote)} (credentials, network), then git -C ${shq(linkLocation(id))} fetch origin; the next tick fetches it again`);
      else if (fresh?.note) add('low', 'link-behind-auth', id, fresh.note, 'fine if the fleet needs no access to it; "check": false stops the daily probe');
    }
    if (linesDeclared(settings)) {
      const since14 = now - 14 * DAY;
      const refusals = groupBy(logObjects('observation').filter((o) => o.kind === 'footprint-refusal' && Date.parse(o.created_at) >= since14), (o) => o.subject);
      const shared = Object.entries(settings.components).filter(([, c]) => c?.shared).map(([n]) => n);
      for (const c of [...new Set([...Object.keys(refusals), ...shared])]) {
        // tickets, not heads or dry runs: one ticket refused three times is that ticket's
        const n = new Set((refusals[c] ?? []).map((o) => o.refs?.[0] ?? String(o.source_key ?? '').split(':')[1] ?? o.id)).size;
        const planned = shared.includes(c) ? [...ts.values()].filter((t) => Date.parse(t.created_at) >= since14 && (t.component === c || (t.touches_components ?? []).includes(c))).length : 0;
        if (n >= 3 || planned >= 3) add('medium', 'line-pressure', c, [n >= 3 && `footprint refusals on ${n} tickets in 14 days`, planned >= 3 && `${planned} tickets planned against the shared component in 14 days`].filter(Boolean).join('; '), 'the line may be in the wrong place: move it in a chore PR (settings components), or plan a contract ticket that settles the shared part');
      }
    }
  }
  linkDutyFindings(settings, now, add);
  // The move findings come last: a move is covered by what the run raised above (next-moves).
  const moves = nextMoves();
  for (const x of moveFindings(moves, f, now)) add(x.severity, x.kind, x.subject, x.detail, x.suggestion);
  writeMovesCache(moves);
  const order = { high: 0, medium: 1, low: 2 };
  // A finding someone has looked at and set aside (`ack`) moves to acknowledged until the ack
  // expires or its subject changes; it is never hidden.
  const ackWindow = settings.finding_ack_hours * 3600000;
  // A merge commit on a main never changes, so an ack of one (merged-without-merge on <repo>:<sha>)
  // never lapses: it would only bring the same merge back a day later (kit-348). Only ack's own
  // lines, by the supervisor or the owner: a worker's finding-ack (observe) keeps the window, so it
  // can't hide a merge it pushed for good (final-1 F1). cmdAck words the same subjects "for good".
  const lasting = (a) => a.source === 'ack' && ['supervisor', 'owner'].includes(writerClass(a.created_by)) && /^merged-without-merge [^\s:]+:[0-9a-f]{12}$/.test(a.subject);
  const acks = logObjects('observation').filter((o) => o.kind === 'finding-ack' && (lasting(o) || now - Date.parse(o.created_at) < ackWindow));
  const ackOf = (x) => acks.filter((a) => a.subject === `${x.kind} ${x.subject}`).sort(byTime).pop();
  const sorted = f.sort((a, b) => order[a.severity] - order[b.severity]);
  m.findings = sorted.filter((x) => !ackOf(x));
  m.acknowledged = sorted.filter(ackOf).map((x) => { const a = ackOf(x); return { ...x, ack: { by: a.created_by, at: a.created_at, reason: a.detail, until: lasting(a) ? null : new Date(Date.parse(a.created_at) + ackWindow).toISOString() } }; });
  return m;
}
