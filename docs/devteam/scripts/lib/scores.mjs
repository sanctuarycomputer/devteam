/* imports start */
import fs from 'node:fs';
import path from 'node:path';
import { DAY } from './base.mjs';
import { FP_OBS } from './sensors.mjs';
import { KNOWLEDGE_IDS_MAX } from './log.mjs';
import { LINE_MAX } from './log.mjs';
import { LINKS } from './lineage.mjs';
import { LINK_ID } from './links.mjs';
import { LINK_KINDS } from './links.mjs';
import { LINK_TEXT_MAX } from './links.mjs';
import { PLACE_CTX } from './lineage.mjs';
import { RESERVED_LINKS } from './links.mjs';
import { SENSOR_KEYS } from './sensors.mjs';
import { SIGNALS } from './observe.mjs';
import { STATUS_MEMO } from './sensors.mjs';
import { actAuthority } from './trust.mjs';
import { answers } from './orient.mjs';
import { appendLog } from './log-sync.mjs';
import { artifactLinksMoved } from './log-sync.mjs';
import { asList } from './base.mjs';
import { byTime } from './log-sync.mjs';
import { calls } from './log-sync.mjs';
import { capOf } from './holds.mjs';
import { className } from './links.mjs';
import { command } from './base.mjs';
import { correctionOf } from './log-sync.mjs';
import { covered } from './observe.mjs';
import { dateOnly } from './base.mjs';
import { efficiencyWeeks } from './metrics.mjs';
import { explained } from './observe.mjs';
import { fixedIncidents } from './observe.mjs';
import { flags } from './base.mjs';
import { fold } from './log.mjs';
import { forOwner } from './observe.mjs';
import { git } from './base.mjs';
import { heldByMap } from './questions.mjs';
import { incidentDebt } from './observe.mjs';
import { isObj } from './artifact-notes.mjs';
import { isStr } from './sensors.mjs';
import { json } from './base.mjs';
import { jsonOr } from './sensors.mjs';
import { ladder } from './links.mjs';
import { linkTextProblem } from './links.mjs';
import { liveDecision } from './sensors.mjs';
import { loadSettings } from './settings.mjs';
import { logCache } from './log-sync.mjs';
import { logGet } from './log-sync.mjs';
import { logObjects } from './log-sync.mjs';
import { mainRef } from './log.mjs';
import { memo } from './graph.mjs';
import { mergedAt } from './repos.mjs';
import { nearlySameQuestion } from './decide.mjs';
import { nowIso } from './base.mjs';
import { orientClusters } from './observe.mjs';
import { orientationDebt } from './observe.mjs';
import { out } from './base.mjs';
import { ownerRuleFor } from './log-sync.mjs';
import { planFeature } from './log.mjs';
import { planners } from './panes.mjs';
import { plural } from './questions.mjs';
import { projectDir } from './state.mjs';
import { projectInRepo } from './settings.mjs';
import { questions } from './log-sync.mjs';
import { quoteData } from './links.mjs';
import { readLog } from './log-sync.mjs';
import { readText } from './base.mjs';
import { redactUrl } from './links.mjs';
import { releasesOnMerge } from './sensors.mjs';
import { roadmapMemo } from './goals.mjs';
import { runDir } from './state.mjs';
import { runPath } from './settings.mjs';
import { rungFor } from './trust.mjs';
import { rungHistory } from './trust.mjs';
import { scopeValid } from './links.mjs';
import { sensorCredentialState } from './sensors.mjs';
import { sensorStatus } from './sensors.mjs';
import { signalKeyOf } from './observe.mjs';
import { slug } from './base.mjs';
import { spendItemsMemo } from './spend.mjs';
import { spendMemo } from './spend.mjs';
import { spendWhoMemo } from './spend.mjs';
import { strategyRel } from './pr-checks.mjs';
import { strategyState } from './pr-checks.mjs';
import { suggestionId } from './metrics.mjs';
import { tickets } from './graph.mjs';
import { trustTable } from './trust.mjs';
import { uniqueIds } from './metrics.mjs';
import { unsafeLocator } from './links.mjs';
import { weight } from './graph.mjs';
import { withLock } from './log.mjs';
import { writerClass } from './log.mjs';
/* imports end */
// ISO weeks, in UTC: Monday 00:00 of the week ms falls in, the week's name, and back.
export const WEEK = 7 * DAY;
export const mondayOf = (ms) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY; };
export const isoWeekOf = (ms) => { const m = mondayOf(ms); const y = new Date(m + 3 * DAY).getUTCFullYear(); return `${y}-W${String(1 + Math.round((m - mondayOf(Date.UTC(y, 0, 4))) / WEEK)).padStart(2, '0')}`; };
export const weekStartOf = (week) => { const [y, w] = String(week).split('-W').map(Number); return mondayOf(Date.UTC(y, 0, 4)) + (w - 1) * WEEK; };
// Run fn against the log as it stood at cut: a fold of only the lines with at <= cut, every memo
// built on readLog() following it, and the log-derived globals that aren't (SENSOR_KEYS and the
// process-wide memos) reset for fn and put back after. Git facts (mergedAt) replay as they are.
export function withLogAt(cut, fn) {
  const full = readLog();
  // no line newer than cut (this week's cut is in the future): the log as it is, with no refold
  if (full.lines.every((l) => l.at <= cut)) return fn();
  const saved = { logCache, SENSOR_KEYS, roadmapMemo, STATUS_MEMO, spendMemo, spendItemsMemo, spendWhoMemo, SIGNALS, FP_OBS, LINKS, PLACE_CTX };
  try {
    const lines = full.lines.filter((l) => l.at <= cut);
    const { objects, ignored } = fold(lines);
    const byType = new Map();
    for (const o of objects.values()) { if (!byType.has(o.type)) byType.set(o.type, []); byType.get(o.type).push(o); }
    logCache = { lines, objects, errors: full.errors, ignored, unknown: full.unknown, byType };
    SENSOR_KEYS = roadmapMemo = STATUS_MEMO = spendMemo = spendItemsMemo = spendWhoMemo = SIGNALS = FP_OBS = LINKS = PLACE_CTX = null;
    return fn();
  } finally {
    ({ logCache, SENSOR_KEYS, roadmapMemo, STATUS_MEMO, spendMemo, spendItemsMemo, spendWhoMemo, SIGNALS, FP_OBS, LINKS, PLACE_CTX } = saved);
  }
}
// The questions that put a decision to the owner (the schema's kinds, less an action only the owner
// can do, a review, and defining or approving a goal).
export const DECISION_KINDS = ['owner-decision', 'one-way-door', 'proposal', 'trust', 'clarification'];
export const authorityOfCall = (c) => (c.type === 'decision' ? c.authority : actAuthority(c));
// Every group a signal recurs on, before what explains it is taken out (signalGroups takes it out
// first): the observations bar a few kinds, and the corrections, each item { id, at, who }, sorted by
// at and then id so equal times order the same on every read. formed_at: the at of the item that
// first made it recurring, the first from the third on where the items so far come from two writers
// or fall on two days; null when it never did. learningFigures counts the formed ones; the Awareness
// Score (kit-242) times them from formed_at.
export function recurringGroups() {
  const groups = new Map();
  const add = (key, item) => (groups.get(key) ?? groups.set(key, { key, items: [], formed_at: null }).get(key)).items.push(item);
  for (const o of logObjects('observation')) if (!['reading', 'retro', 'outcome', 'link', 'learning', 'recurring-run', 'recurring-recovered'].includes(o.kind)) add(signalKeyOf(o), { id: o.id, at: o.created_at, who: o.created_by });
  for (const a of calls()) { const c = correctionOf(a); if (c) add(`correction:${a.class}:${a.scope ?? 'any'}`, { id: a.id, at: c.at, who: c.by }); }
  for (const g of groups.values()) {
    g.items.sort((a, b) => a.at.localeCompare(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const who = new Set(), days = new Set();
    for (const [j, i] of g.items.entries()) { who.add(i.who); days.add(dateOnly(i.at)); if (j >= 2 && (who.size >= 2 || days.size >= 2)) { g.formed_at = i.at; break; } }
  }
  return groups;
}
// One week's figures (counts, never shares) and the records each counts, from the log as it stood
// at the week's end. "In the week" is the named time falling in it.
export function learningFigures(week, merges = mergeTimes()) {
  const from = weekStartOf(week);
  const fromIso = new Date(from).toISOString(), cut = new Date(from + WEEK - 1).toISOString();
  const inW = (at) => typeof at === 'string' && at >= fromIso && at <= cut;
  return withLogAt(cut, () => {
    const L = ladder();
    const knowledge = logObjects('knowledge').filter((k) => k.status === 'accepted').sort(byTime).map((k) => k.id);
    // recurring signals as Orient forms them, before what explains them is taken out
    const { ids, keys } = explained();
    // listed in the fold's order (observations, then corrections), as the records written so far list them
    const pos = new Map([...logObjects('observation'), ...calls()].map((o, i) => [o.id, i]));
    const signals = [...recurringGroups().values()].filter((g) => g.formed_at).map((g) => {
      const items = [...g.items].sort((a, b) => pos.get(a.id) - pos.get(b.id));
      const by = items.filter((i) => ids.has(i.id) || covered(keys, g.key, i.at)).map((i) => i.id);
      return { key: g.key, ids: items.map((i) => i.id), explained: by.length > 0, by };
    });
    const starts = logObjects('act').filter((a) => a.class === 'worker-slots' && inW(a.created_at) && String(a.what).startsWith('made ')).sort(byTime).map((a) => ({ id: a.id, given: Array.isArray(a.knowledge) ? a.knowledge : [] }));
    const all = calls().sort(byTime);
    const weekCalls = all.filter((c) => inW(c.created_at));
    const ladderCalls = weekCalls.filter((c) => L.classes[c.class]).map((c) => ({ id: c.id, class: c.class, authority: authorityOfCall(c) }));
    const qs = questions();
    const asked = qs.filter((q) => inW(q.asked_at) && DECISION_KINDS.includes(q.kind)).map((q) => q.id);
    // trustEvidence's filter: answered by the owner, with a recommendation (a review's proposals),
    // not in words alone; matched is the owner's own agreement
    const answered = qs.filter((q) => q.status === 'answered' && !q.in_words && inW(q.answered_at) && (q.recommendation || (q.kind === 'review' && (q.review?.data?.proposals ?? 0) > 0))).sort((a, b) => a.answered_at.localeCompare(b.answered_at)).map((q) => ({ id: q.id, matched: !!q.agreed_by_owner }));
    const corrections = all.filter((c) => inW(correctionOf(c)?.at)).map((c) => c.id);
    const merged = merges.filter(([, at]) => at >= from && at < from + WEEK).map(([id]) => id);
    const figures = {
      informed: { knowledge: knowledge.length, signals_explained: signals.filter((s) => s.explained).length, signals_formed: signals.length, starts_given: starts.filter((s) => s.given.length).length, starts: starts.length },
      autonomous: { trusted_calls: ladderCalls.filter((c) => ['rung', 'standing-rule'].includes(c.authority)).length, ladder_calls: ladderCalls.length, questions: asked.length, merged: merged.length },
      trusted: { agreed: answered.filter((q) => q.matched).length, answered: answered.length, corrections: corrections.length, calls: weekCalls.length },
    };
    return { week, from: fromIso, cut, figures, lists: { knowledge, signals, starts, ladder_calls: ladderCalls, questions: asked, merged, answered, calls: weekCalls.map((c) => c.id), corrections } };
  });
}
// When each ticket merged (ms), from git, once per read of the whole log: a back-fill asks every week.
export const mergeTimes = () => memo('mergeTimes', () => [...tickets().keys()].map((id) => [id, mergedAt(id)]).filter(([, at]) => at));
// The record's line: its counts, one sentence of them, and refs to what it counted (at most 60,
// and fewer when long ids would take the line past LINE_MAX: the corrections first, then the
// explained signals, then the knowledge in force, so the ones dropped are from the end).
export function learningLine(r) {
  const { informed: I, autonomous: A, trusted: T } = r.figures;
  const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const detail = `Week ${r.week}: ${n(I.knowledge, 'lesson')} in force, ${I.signals_explained} of ${n(I.signals_formed, 'recurring signal')} explained, ${I.starts_given} of ${n(I.starts, 'start')} given a lesson; ${A.trusted_calls} of ${n(A.ladder_calls, 'ladder call')} made on trust, ${n(A.questions, 'question')} to the owner for ${n(A.merged, 'merged ticket')}; ${T.agreed} of ${n(T.answered, 'recommendation')} agreed, ${n(T.corrections, 'correction')} in ${n(T.calls, 'call')}.`;
  const base = { type: 'observation', source: 'metrics', detector: 'metrics', subject: 'project', kind: 'learning', week: r.week, figures: r.figures, detail: detail.slice(0, 300), source_key: `learning:${r.week}` };
  const refs = [...new Set([...r.lists.corrections, ...r.lists.signals.filter((s) => s.explained).map((s) => s.by[0]), ...r.lists.knowledge])].slice(0, KNOWLEDGE_IDS_MAX);
  // 250: what appendLog adds (op, id, at, by)
  while (refs.length && JSON.stringify({ ...base, refs }).length + 250 > LINE_MAX) refs.pop();
  return { ...base, refs };
}
// Lesson efficacy, as the log stood at cut: for each lesson a start's prompt carried, the
// observations on the keys of its evidence in the four weeks before it was first given and since.
// Lists and counts, never a score: the numbers are small, and the owner should see which.
export function lessonEfficacy(cut) {
  return withLogAt(cut, () => {
    const first = new Map();
    for (const a of logObjects('act').filter((x) => x.class === 'worker-slots' && Array.isArray(x.knowledge)).sort(byTime)) for (const k of a.knowledge) if (!first.has(k)) first.set(k, a.created_at);
    const byKey = new Map();
    for (const o of logObjects('observation').sort(byTime)) { if (['reading', 'retro', 'outcome', 'link', 'learning', 'recurring-run', 'recurring-recovered'].includes(o.kind)) continue; const k = signalKeyOf(o); (byKey.get(k) ?? byKey.set(k, []).get(k)).push(o); }
    return [...first].map(([id, at]) => {
      const k = logGet(id);
      const keys = [...new Set((k?.evidence ?? []).map(logGet).filter((o) => o?.type === 'observation').map(signalKeyOf))];
      const obs = keys.flatMap((key) => byKey.get(key) ?? []);
      const t = Date.parse(at);
      const before = obs.filter((o) => Date.parse(o.created_at) >= t - 4 * WEEK && o.created_at < at).map((o) => o.id);
      const since = obs.filter((o) => o.created_at >= at).map((o) => o.id);
      return { id, statement: k?.statement ?? null, status: k?.status ?? null, first_given: at, keys, before: { count: before.length, ids: before.slice(-40) }, since: { count: since.length, ids: since.slice(-40) } };
    });
  });
}
// The metrics pass (supervisor only): one learning record for each ISO week since the log's
// earliest line (back to LEARN_BACKFILL_WEEKS at most) that has ended and has no record of the
// supervisor's yet, as the dashboard counts them: an owner's or hand line with the source_key
// doesn't stand in for one. A back-filled week's record is stamped now (records can't be
// back-dated) and names its week. Every week is counted before any is written, so each count
// folds the log once; under a lock, read afresh, so two passes at once don't both write a week.
export const LEARN_BACKFILL_WEEKS = 104;
export const isLearningRecord = (o) => o.kind === 'learning' && o.created_by === 'supervisor' && o.detector === 'metrics';
// The records the dashboard draws, oldest week first: one per week, the earliest written (two
// passes at once could each have written one), and only one whose three columns are objects, so
// a malformed line is left out, not drawn.
export function learningRecords() {
  const byWeek = new Map();
  for (const o of logObjects('observation').filter((x) => isLearningRecord(x) && /^\d{4}-W\d{2}$/.test(x.week ?? '') && ['informed', 'autonomous', 'trusted'].every((k) => x.figures?.[k] && typeof x.figures[k] === 'object')).sort((a, b) => a.week.localeCompare(b.week) || byTime(a, b))) if (!byWeek.has(o.week)) byWeek.set(o.week, o);
  return [...byWeek.values()];
}
// ===== the Trust Score's data (the dashboard design's Autonomy pages › Trust; kit-98) =====

// The fleet's own authority: a call made without asking. An owner's answer or a default was asked.
export const OWN_AUTHORITY = ['rung', 'standing-rule', 'constitution'];
// The owner's standing rules: a preference, or a rule for a kind of decision; a fact decides nothing.
export const isOwnerRule = (k) => writerClass(k.created_by) === 'owner' && (k.kind === 'preference' || String(k.scope ?? '').startsWith('class:'));
export const round2 = (x) => Math.round(x * 100) / 100;
// What every week reads, read once per request: the stored records by week, the log's first line,
// the fleet's calls, the questions, the owner's goal decisions and standing rules, and the
// intervals in which a question waited on the owner (open ones end now).
export function autonomyContext(now) {
  const first = readLog().lines.reduce((m, l) => Math.min(m, Date.parse(l.at) || Infinity), Infinity);
  const qs = questions();
  const goalAts = [];
  // every goal, Upkeep's too (logObjects leaves it out; decisionRecords reads it)
  for (const g of readLog().byType.get('goal') ?? []) for (const u of g.updates ?? []) if (writerClass(u.by) === 'owner' && (u.decision || u.status !== undefined || u.hold !== undefined)) goalAts.push(u.at);
  return {
    now, first, qs, goalAts, merges: mergeTimes(),
    records: new Map(learningRecords().map((r) => [r.week, r])),
    calls: calls().map((c) => ({ c, own: OWN_AUTHORITY.includes(authorityOfCall(c)), corrected: correctionOf(c)?.at ?? null })),
    ruleAts: logObjects('knowledge').filter(isOwnerRule).map((k) => k.created_at),
    waits: qs.map((q) => [Date.parse(q.asked_at), q.answered_at ? Date.parse(q.answered_at) : now]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]),
  };
}
// One week of the score (start: its Monday 00:00 UTC, ms). merged, corrected and with the
// recommendation come from its learning record: stored, else computed for this week or a week since
// the log began, else nothing (a missing figure reads 0). The rest is counted from the log on read.
export function autonomyWeek(start, now, x = autonomyContext(now)) {
  const week = isoWeekOf(start), end = start + WEEK;
  const fromIso = new Date(start).toISOString(), cutIso = new Date(end - 1).toISOString();
  const inW = (at) => typeof at === 'string' && at >= fromIso && at <= cutIso;
  const rec = x.records.get(week) ?? null;
  const live = !rec && end > x.first ? learningFigures(week, x.merges) : null;
  const R = rec?.figures ?? live?.figures ?? {};
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const alone = x.calls.filter(({ c, own, corrected }) => own && inW(c.created_at) && !(corrected && corrected <= cutIso)).length;
  const settled = x.qs.filter((q) => ['answered', 'defaulted'].includes(q.status) && inW(q.answered_at));
  const asked = settled.length + x.goalAts.filter(inW).length + x.ruleAts.filter(inW).length;
  const corrected = num(R.trusted?.corrections);
  const decisions = alone + asked + corrected;
  const answers = settled.filter((q) => q.status === 'answered').length;
  const merged = num(R.autonomous?.merged);
  // a declared re-ask, less one that only follows a withdrawn question whose linked page moved
  const linksMoved = (q) => x.qs.some((p) => p.status === 'withdrawn' && p.answered_at <= q.asked_at && (p.class ?? null) === (q.class ?? null) && nearlySameQuestion(p.question, q.question) && artifactLinksMoved(p));
  const askedAgain = x.qs.filter((q) => q.new_because && inW(q.asked_at) && !linksMoved(q)).length;
  // the hours in which at least one question waited: the union of the intervals, clipped to the week
  let waited = 0, upto = start;
  for (const [a, b] of x.waits) { const s = Math.max(a, upto), e = Math.min(b, end); if (e > s) { waited += e - s; upto = e; } }
  const count = num(R.trusted?.agreed), of = num(R.trusted?.answered);
  return {
    starts_at: fromIso, record: rec?.id ?? null,
    alone, asked, corrected, decisions, score: decisions ? Math.round((100 * alone) / decisions) : 0,
    lessons: start === mondayOf(now) ? live?.lists.knowledge ?? [] : [],
    merged, answers, merged_per_answer: round2(merged / Math.max(1, answers)),
    asked_again: askedAgain, hours_waiting: Math.round(waited / 360000) / 10,
    with_recommendation: { count, of, share: of ? round2(count / of) : 0 },
  };
}
// Trust this week: the kinds of decision it takes alone (rung 3) of all, and each class's effective
// rung moves dated this week. The walk starts from the capped start and caps every step as rungFor
// does (its ceiling; incident-fix under release-production where merging releases), so it ends at
// rungFor(cls); an event that leaves the rung where it was is no move.
export function autonomyTrust(now) {
  const L = ladder();
  const from = new Date(mondayOf(now)).toISOString();
  const fix = releasesOnMerge() ? Math.max(2, rungFor('release-production')) : null;
  const cap = (cls, r) => { r = Math.min(r, L.classes[cls].ceiling); return cls === 'incident-fix' && fix != null ? Math.min(r, fix) : r; };
  const classes = Object.keys(L.classes);
  const changes = [];
  for (const cls of classes) {
    let r = cap(cls, L.classes[cls].start);
    for (const e of rungHistory(cls)) { const next = cap(cls, e.rung); if (e.at >= from && next !== r) changes.push({ class: cls, from: r, to: next, at: e.at, id: e.id }); r = next; }
  }
  changes.sort((a, b) => a.at.localeCompare(b.at));
  return { own: classes.filter((c) => rungFor(c) === 3).length, kinds: classes.length, raised: changes.filter((c) => c.to > c.from).length, dropped: changes.filter((c) => c.to < c.from).length, changes };
}
// sensor discover runs CLIs with 30 s timeouts, too slow for a request: each run leaves what it
// found here, and Senses reads that. A cache only: missing or malformed reads as no discovery.
export const DISCOVERY_CACHE = 'sensor-discovery.json';
export function writeDiscoveryCache(d) {
  const names = (xs) => (Array.isArray(xs) ? xs.map((x) => (isStr(x) ? x : x?.name ?? x?.sensor?.name)).filter(isStr) : []);
  try {
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(runPath(DISCOVERY_CACHE), `${JSON.stringify({ at: nowIso(), sensors: names(d.sensors), proposals: names(d.proposals), missing: names(d.missing), outside: names(d.outside?.proposals) })}\n`);
  } catch {}
}
export function readDiscoveryCache() {
  const c = jsonOr(runPath(DISCOVERY_CACHE), null);
  const list = (k) => Array.isArray(c?.[k]) && c[k].every(isStr);
  return isObj(c) && isStr(c.at) && ['sensors', 'proposals', 'missing', 'outside'].every(list) ? c : null;
}
// Senses: what it needs to see (the sensors in place and what discovery proposed, found missing or
// was told of from outside), what it has (no credential needed, the credential posted, or working:
// a sensor that reads has its access), and what works (ok, or an http sensor up). has ⊆ in place ⊆
// needed, so needed >= has.
export function autonomySenses() {
  const rows = sensorStatus();
  const c = readDiscoveryCache();
  const sorted = (xs) => [...new Set(xs)].sort();
  const working = sorted(rows.filter((r) => ['ok', 'up'].includes(r.state)).map((r) => r.name));
  const has = sorted(rows.filter((r) => !(r.credentials ?? []).length || working.includes(r.name) || sensorCredentialState(r.name).status === 'posted').map((r) => r.name));
  const needed = sorted([...rows.map((r) => r.name), ...(c ? [...c.proposals, ...c.missing, ...c.outside] : [])]);
  return { needed: needed.length, has: has.length, working: working.length, missing: needed.filter((n) => !has.includes(n)), names: { needed, has, working }, discovered_at: c?.at ?? null };
}
export function autonomyData(now = Date.now()) {
  const x = autonomyContext(now);
  const weeks = efficiencyWeeks(now).map((w) => autonomyWeek(w.start, now, x));
  const senses = autonomySenses();
  return { decisions: { score: { this_week: weeks[11].score, last_week: weeks[10].score }, this_week: weeks[11], last_week: weeks[10], weeks }, trust: autonomyTrust(now), senses, suggestions: autonomySuggestions(now, senses) };
}
// The Trust Score's suggestions (kit-99): at most five things the owner could do this week, each with
// its evidence and estimated effect (weight: questions a week, or a fixed 0.5 where the log measures
// none), highest first. Derived on read from what the kit already reads, stored nowhere; one drops out
// as soon as its condition stops holding. Rates are over the 28 days to now. Kinds of decision appear
// by their plain names. An id is built from kind and subject only (so it is the same every week while
// the condition holds) and cut at 109, so suggestion:<id> fits a subject ref's 120 bytes; clashes take
// -2, -3, assigned in kind-then-subject order, never rank order. The strategy is read only for the
// bullet lines under its one "## Not known yet" heading (the heading the template writes), nothing else.
export function autonomySuggestions(now, senses) {
  const from = new Date(now - 28 * 86400000).toISOString();
  const to = new Date(now).toISOString();
  const inWindow = (t) => isStr(t) && t >= from && t <= to;
  const qs = questions();
  const byId = new Map(qs.map((q) => [q.id, q]));
  const asked = new Map();
  for (const q of qs) if (isStr(q.class) && inWindow(q.asked_at)) asked.set(q.class, (asked.get(q.class) ?? 0) + 1);
  const fewer = (q, waits) => {
    const n = Math.round(q);
    if (waits) return n < 1 ? 'fewer than one question a week stops waiting on you' : `about ${n} question${n === 1 ? ' a week stops' : 's a week stop'} waiting on you`;
    return n < 1 ? 'fewer than one question a week' : `about ${n} fewer question${n === 1 ? '' : 's'} a week`;
  };
  const out = [];
  // raise: below its effective cap (incident-fix capped as autonomyTrust caps it), agreement met, no
  // correction in the 28 days, no trust question already open for it, and asked in the 28 days
  const L = ladder();
  const fix = releasesOnMerge() ? Math.max(2, rungFor('release-production')) : null;
  const capOf = (cls) => (cls === 'incident-fix' && fix != null ? Math.min(L.classes[cls].ceiling, fix) : L.classes[cls].ceiling);
  const corrected = new Set(calls().filter((a) => inWindow(correctionOf(a)?.at)).map((a) => a.class));
  const trustOpen = new Set(qs.filter((q) => q.kind === 'trust' && q.status === 'open').map((q) => q.class));
  const raised = new Set();
  for (const row of trustTable()) {
    const cls = row.class;
    const n = asked.get(cls) ?? 0;
    if (row.rung >= capOf(cls) || !row.meets_agreement || corrected.has(cls) || trustOpen.has(cls) || n < 1) continue;
    raised.add(cls);
    const q = n / 4;
    const toAct = row.rung + 1 === 3;
    const agree = row.agreement_questions.filter((id) => byId.get(id)?.agreed_by_owner).length;
    out.push({
      kind: 'raise', subject: cls, what: toAct ? `Let "${className(cls)}" decide and tell you` : `Let "${className(cls)}" go ahead at a deadline`,
      evidence: `${agree} of the last ${row.agreement_questions.length} answers went with its recommendation; no corrections in 4 weeks`, effect: fewer(q, !toAct), weight: toAct ? q : q / 2,
    });
  }
  // question: the oldest open question holding a ticket or a planning session
  const holds = new Map();
  for (const [key, qid] of heldByMap()) holds.set(qid, [...(holds.get(qid) ?? []), key]);
  const oldest = [...holds.keys()].map((id) => byId.get(id)).filter(Boolean).sort((a, b) => a.asked_at.localeCompare(b.asked_at) || a.id.localeCompare(b.id))[0];
  if (oldest) {
    const plans = new Set(planners().map((p) => `plan-${p.feature}`));
    const keys = holds.get(oldest.id);
    const names = [...keys.filter((k) => !plans.has(k)), ...keys.filter((k) => plans.has(k)).map(() => 'a planning session')];
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join('');
    const h = Math.floor((now - Date.parse(oldest.asked_at)) / 3600000);
    const age = h < 1 ? 'under an hour' : h < 48 ? `${h} hour${h === 1 ? '' : 's'}` : `${Math.floor(h / 24)} days`;
    out.push({ kind: 'question', subject: oldest.id, what: String(oldest.question ?? '').slice(0, 120), evidence: `open ${age}; holds ${list}`, effect: `${keys.length} can start`, weight: keys.length });
  }
  // sense: each one needed and not connected
  for (const name of senses.missing) out.push({ kind: 'sense', subject: name, what: `Connect ${name}`, evidence: 'needed, not connected', effect: `Senses: has ${senses.has} of ${senses.needed} → ${senses.has + 1} of ${senses.needed}`, weight: 0.5 });
  // strategy: each bullet under "## Not known yet", read from where strategyState reads it
  if (strategyState() === 'written') {
    const text = projectInRepo && mainRef() ? git(['show', `${mainRef()}:${strategyRel}`]) : readText(path.join(projectDir, 'strategy.md'));
    let under = false;
    for (const l of String(text ?? '').split('\n').map((s) => s.trimEnd())) {
      if (/^## /.test(l)) { under = /^## +Not known yet$/.test(l); continue; }
      const m = under && /^- +(.+)$/.exec(l);
      if (m) out.push({ kind: 'strategy', subject: m[1].trim(), what: `"${m[1].trim().slice(0, 120)}" is not known yet`, evidence: 'listed under Not known yet in the strategy', effect: 'goals stop being rated against a guess', weight: 0.5 });
    }
  }
  // rule: asked 3 or more times in the 28 days, no owner rule, not already a raise
  for (const [cls, n] of asked) if (n >= 3 && !ownerRuleFor(cls) && !raised.has(cls)) out.push({ kind: 'rule', subject: cls, what: `A rule for "${className(cls)}"`, evidence: `asked ${n} times in 4 weeks`, effect: fewer(n / 4, false), weight: n / 4 });
  const ORDER = ['question', 'raise', 'rule', 'sense', 'strategy'];
  const taken = new Set();
  for (const s of [...out].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0))) {
    const id = suggestionId('tr', s.kind, s.subject).slice(0, 109);
    let u = id;
    for (let k = 2; taken.has(u); k++) u = id.slice(0, 109 - `-${k}`.length) + `-${k}`;
    taken.add(u);
    s.id = u;
  }
  return out
    .sort((a, b) => b.weight - a.weight || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, 5)
    .map(({ id, kind, what, evidence, effect, weight }) => ({ id, kind, what, evidence, effect, weight }));
}
// ===== the Awareness Score (kit-242) =====
// One week of it (start: its Monday 00:00 UTC, ms), read at E, the week's last millisecond or now:
// four parts, each { count, of, share }, and the score. Counted from the log as it stood at E, never
// from a stored learning record (the record holds no times). E is returned for the suggestions, and
// dropped before serving. kept: each id's new line as the fold keeps it (the first, in fold order).
export const AW_NONE = () => ({ count: 0, of: 0, share: null });
export const awPart = (count, of, share = of ? round2(count / of) : null) => ({ count, of, share });
export function awarenessWeek(start, now, firstMs, kept = awKeptNew()) {
  const E = Math.min(start + WEEK - 1, now);
  const starts_at = new Date(start).toISOString();
  // a week before the log's first line has nothing to read: no refold for it
  if (E < firstMs) return { starts_at, score: null, parts: { signals: AW_NONE(), incidents: AW_NONE(), lessons: AW_NONE(), starts: AW_NONE() }, E };
  const fromIso = starts_at, cut = new Date(E).toISOString(), dayBefore = new Date(E - DAY).toISOString();
  return withLogAt(cut, () => {
    // when each item was first cited by a record still citing it at E: its new line (as kept), then its
    // applied updates in order. A raw set line the fold ignored never counts (it isn't in updates).
    const cited = new Map();
    const walk = (o) => {
      const has = new Set([...(o.evidence ?? []), ...(o.refs ?? [])]);
      const born = kept.get(o.id);
      const steps = [{ at: o.created_at, ids: [...(born?.evidence ?? []), ...(born?.refs ?? [])] }, ...(o.updates ?? []).filter((u) => u.evidence || u.refs).map((u) => ({ at: u.at, ids: [...(u.evidence ?? []), ...(u.refs ?? [])] }))];
      const first = new Map();
      for (const s of steps) for (const r of s.ids) if (!first.has(r)) first.set(r, s.at);
      for (const [r, at] of first) if (has.has(r) && !(cited.get(r) <= at)) cited.set(r, at);
    };
    for (const o of [...logObjects('knowledge'), ...logObjects('problem')]) walk(o);
    // a live decision that cites an observation explains what it cites, as explained() reads it; an
    // orient-noise one also rules on each key it names
    const rulings = new Map();
    for (const d of logObjects('decision')) {
      if (!(d.refs ?? []).some((r) => String(r).startsWith('o-')) || !liveDecision(d)) continue;
      walk(d);
      if (d.class === 'orient-noise') for (const r of d.refs) if (!logGet(r)) (rulings.get(r) ?? rulings.set(r, []).get(r)).push(d.created_at);
    }
    let sOf = 0, sCount = 0;
    for (const g of recurringGroups().values()) {
      if (!g.formed_at || g.formed_at < fromIso || g.formed_at > cut) continue;
      // a ruling covers the sightings at or before it, so one before the first sighting covers none
      const xs = [...g.items.map((i) => cited.get(i.id)), ...(rulings.get(g.key) ?? []).filter((at) => at >= g.items[0].at)].filter(Boolean).sort();
      const x = xs[0];
      // formed in E's last day and not yet explained: it hasn't had its day
      if (!x && g.formed_at > dayBefore) continue;
      sOf++;
      // an explanation from before forming counts as 0 hours
      if (x && Date.parse(x) - Date.parse(g.formed_at) <= DAY) sCount++;
    }
    const incOf = fixedIncidents(E).length;
    const knowledge = logObjects('knowledge').filter((k) => k.status === 'accepted').map((k) => k.id);
    const allStarts = logObjects('act').filter((a) => a.class === 'worker-slots' && String(a.what).startsWith('made '));
    const given = (a) => (Array.isArray(a.knowledge) ? a.knowledge : []);
    const used = new Set(allStarts.filter((a) => a.created_at > new Date(E - 28 * DAY).toISOString() && a.created_at <= cut).flatMap(given));
    const starts = allStarts.filter((a) => a.created_at >= fromIso && a.created_at <= cut);
    const startsGiven = starts.filter((a) => given(a).length).length;
    const parts = {
      signals: awPart(sCount, sOf),
      incidents: awPart(incOf - incidentDebt(E).length, incOf),
      lessons: awPart(knowledge.filter((k) => used.has(k)).length, knowledge.length),
      // with no knowledge in force there was nothing to give
      starts: awPart(startsGiven, starts.length, starts.length && knowledge.length ? round2(startsGiven / starts.length) : null),
    };
    // the mean of the unrounded shares
    const shares = [[sCount, sOf], [parts.incidents.count, incOf], [parts.lessons.count, knowledge.length], [startsGiven, knowledge.length ? starts.length : 0]].filter(([, of]) => of).map(([c, of]) => c / of);
    return { starts_at, score: shares.length ? Math.round((100 * shares.reduce((s, v) => s + v, 0)) / shares.length) : null, parts, E };
  });
}
// Each id's new line as the fold keeps it: the first in the fold's order (at, file, line). The folded
// object holds only current values, so the citations a record was made with are read from here.
export function awKeptNew() {
  const kept = new Map();
  const before = (a, b) => a.at < b.at || (a.at === b.at && (a.__file.localeCompare(b.__file) || a.__line - b.__line) < 0);
  for (const l of readLog().lines) if (l.op === 'new' && (!kept.has(l.id) || before(l, kept.get(l.id)))) kept.set(l.id, l);
  return kept;
}
export function awarenessData(now = Date.now()) {
  const firstMs = readLog().lines.reduce((m, l) => Math.min(m, Date.parse(l.at) || Infinity), Infinity);
  const kept = awKeptNew();
  const weeks = efficiencyWeeks(now).map((w) => awarenessWeek(w.start, now, firstMs, kept)).map(({ E, ...w }) => w);
  return { score: { this_week: weeks[11].score, last_week: weeks[10].score }, parts: weeks[11].parts, weeks, suggestions: awarenessSuggestions(now, weeks[11].parts) };
}
// Up to five things to do this week, in a fixed order: learn from each fixed incident, retire the
// lessons no session is given, then explain each signal that keeps happening. This week's E is now, so
// the log is read as it is. The words are plain (strategy R2): no command, function or score name.
export function awarenessSuggestions(now, parts) {
  const out = [];
  const id = uniqueIds();
  const add = (kind, subject, what, evidence, effect) => out.push({ id: id(suggestionId('aw', kind, subject)), kind, what, evidence, effect });
  const plural = (n, word) => `${word}${n === 1 ? '' : 's'}`;
  const { incidents: inc, lessons: les } = parts;
  for (const r of incidentDebt(now)) add('incident', r.id, `Write down what ${r.title} taught`, `Fixed ${r.days === 0 ? 'today' : `${r.days} ${plural(r.days, 'day')} ago`} and verified since; no lesson cites it`, `Fixed incidents that left a lesson: ${inc.count} of ${inc.of} → ${inc.count + 1} of ${inc.of}`);
  // a quarter or more of the lessons in force reached no session start (4 × unused ≥ of, without floats)
  const n = les.of - les.count;
  if (les.of > 0 && 4 * n >= les.of) add('lessons', 'unused', `Look at the ${n === 1 ? 'lesson' : `${n} lessons`} no session was given in 4 weeks`, `${n} of ${les.of} ${plural(les.of, 'lesson')} in force reached no session start in the last 28 days`, `Lessons sessions use: ${les.count} of ${les.of} → ${les.count} of ${les.count} once ${n === 1 ? 'it is' : 'those are'} retired`);
  for (const r of orientationDebt(now)) {
    // every row has waited a day (orientationDebt's filter), so at least 1
    const d = Math.max(1, Math.floor(r.hours / 24));
    add('signal', r.key, r.latest ? `Find out what keeps causing this: ${String(r.latest).slice(0, 120)}` : `Find out why this keeps happening (${r.count} times)`, `Seen ${r.count} times since ${r.first_at.slice(0, 10)}, unexplained`, `First seen ${d} ${plural(d, 'day')} ago; explaining it stops further sightings piling up`);
  }
  return out.slice(0, 5);
}
export function writeLearning() {
  fs.mkdirSync(runDir, { recursive: true });
  return withLock(runPath('learning'), () => {
    logCache = null;
    const log = readLog();
    const first = log.lines.reduce((m, l) => (l.at < m ? l.at : m), log.lines[0]?.at ?? '');
    const start = Date.parse(first);
    if (!Number.isFinite(start)) return 0;
    const have = new Set(logObjects('observation').filter(isLearningRecord).map((o) => o.source_key).filter((k) => k?.startsWith('learning:')));
    const weeks = [];
    const cur = mondayOf(Date.now());
    for (let t = Math.max(mondayOf(start), cur - LEARN_BACKFILL_WEEKS * WEEK); t < cur; t += WEEK) if (!have.has(`learning:${isoWeekOf(t)}`)) weeks.push(isoWeekOf(t));
    if (!weeks.length) return 0;
    const merges = mergeTimes();
    const lines = weeks.map((w) => learningLine(learningFigures(w, merges)));
    for (const l of lines) appendLog(l, 'supervisor');
    return lines.length;
  }, { staleMs: 300000, waitMs: 310000 });
}
// One value as a POSIX shell word: single-quoted, each ' written '\''. Every value orient puts in a
// command it proposes goes through this, since observation text is anyone's to write and the
// supervisor runs what it pastes (L-SEC-5).
export const shq = (v) => `'${String(v).replace(/'/g, "'\\''")}'`;
// A flag and its value for a proposed command: --key=value when the value starts with --, which
// parseArgs would otherwise read as a flag; a link set value then goes after a bare --.
export const shFlag = (k, v) => (String(v).startsWith('--') ? `--${k}=${shq(v)}` : `--${k} ${shq(v)}`);
export const shSetValue = (v) => (String(v).startsWith('--') ? `-- ${shq(v)}` : shq(v));
// Link observations against the registry, for orient: a URL already there with a better
// title, wider for or new notes is a proposed edit; a fresh URL a proposed add; a URL whose title
// matches another link for an overlapping scope a question about which is the source of truth.
// Proposals only: the supervisor decides and acts with link, or asks.
export function orientLinks() {
  const reg = loadSettings().links ?? {};
  const norm = (u) => String(u ?? '').replace(/\/+$/, '').toLowerCase();
  // handled: a registry entry's source, anything a decision or act cites (a dismissal is a decision
  // that cites the observation), and the evidence of knowledge it became
  const used = new Set([...Object.values(reg).map((l) => l.source), ...[...logObjects('decision'), ...logObjects('act')].flatMap((a) => a.refs ?? []), ...logObjects('knowledge').flatMap((k) => k.evidence ?? [])].filter(Boolean));
  const title = (x) => String(x ?? '');
  // an id link add accepts (LINK_ID, not reserved), unique among the registry and this run's proposals
  const taken = new Set([...Object.keys(reg), ...RESERVED_LINKS]);
  const newId = (t) => {
    let base = slug(t).replace(/-+$/, '');
    if (!/^[a-z]/.test(base)) base = `link-${base}`;
    if (!LINK_ID.test(base)) base = 'link';
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    return id;
  };
  const overlap = (a, b) => { const x = asList(a).length ? asList(a) : ['all'], y = asList(b).length ? asList(b) : ['all']; return x.includes('all') || y.includes('all') || x.some((s) => y.includes(s)); };
  const res = [];
  for (const o of logObjects('observation').filter((x) => x.kind === 'link' && (x.link?.url || x.link?.path) && !used.has(x.id)).sort(byTime)) {
    // A line written by hand can hold text observe-link refuses (log-check flags it, link add refuses
    // it). Nothing from it is proposed: one line says so, with the offending fields quoted as data.
    const unsafe = [...['title', 'notes'].filter((f) => linkTextProblem(f, o.link[f])), ...['url', 'path'].filter((f) => unsafeLocator(o.link[f]))];
    if (unsafe.length) {
      const cut = (f) => { const v = [...String(o.link[f])]; const max = LINK_TEXT_MAX[f] ?? 200; return `${quoteData(v.slice(0, max).join(''))}${v.length > max ? '…' : ''}`; };
      res.push({ key: `link-proposal:${o.id}`, proposal: 'not-proposed', observation: o.id, note: `observation ${o.id} has link text that isn't plain one-line text; not proposed: ${unsafe.map((f) => `${f} ${cut(f)}`).join(', ')}` });
      continue;
    }
    // A worker's or planner's observation is proposed as theirs, to be checked before it is
    // applied, and never for the whole project: all (or project) narrows to its ticket's component
    // or its plan's feature, and goes when there is neither.
    const worker = ['ticket', 'planner'].includes(writerClass(o.created_by)) ? o.created_by : null;
    const narrow = worker ? (tickets().get(worker)?.component ? `component:${tickets().get(worker).component}` : planFeature(worker) ? `feature:${planFeature(worker)}` : tickets().get(worker)?.feature ? `feature:${tickets().get(worker).feature}` : null) : null;
    const fors = worker ? [...new Set(asList(o.link.for).map((sc) => (['all', 'project'].includes(sc) ? narrow : sc)).filter(Boolean))] : asList(o.link.for);
    const l = { ...o.link, for: fors };
    const mark = worker ? { proposed_by: worker } : {};
    // a file in this repo: no v1 link kind holds one, so it becomes a pointer in knowledge
    if (!l.url) {
      const scope = asList(l.for).find((sc) => scopeValid(sc, 'knowledge')) ?? (worker ? narrow : null) ?? 'project';
      res.push({ key: `link-proposal:${l.path}`, proposal: 'pointer', observation: o.id, ...mark, command: `knowledge add --kind pointer ${shFlag('statement', `${l.title}: ${l.path}${l.notes ? ` (${l.notes})` : ''}`)} --scope ${shq(scope)} --evidence ${shq(o.id)}` });
      continue;
    }
    const same = Object.entries(reg).find(([id0, r]) => { const u = LINK_KINDS[r.kind]?.locator(r, id0).url; return !!u && norm(u) === norm(l.url); });
    if (same) {
      const [id, r] = same;
      const wider = asList(l.for).filter((s) => !asList(r.for).includes(s));
      const sets = [...(wider.length ? [`link set ${shq(id)} for ${shq(JSON.stringify([...asList(r.for), ...wider]))}`] : []), ...(l.notes && l.notes !== r.notes ? [`link set ${shq(id)} notes ${shSetValue(l.notes)}`] : []), ...(l.title !== title(r.title) && l.title.length > title(r.title).length ? [`link set ${shq(id)} title ${shSetValue(l.title)}`] : [])];
      // an edit to a link of an owner's kind (repo) is the owner's: the proposal is the question
      if (sets.length) res.push({ key: `link-proposal:${id}`, proposal: 'edit', link: id, observation: o.id, ...mark, command: LINK_KINDS[r.kind]?.ownedByOwner ? `ask --class governance-edit --question ${shq(`Change ${id} in the registry: ${sets.join('; ')}?`)} --evidence ${shq(o.id)} --recommendation yes` : sets.join(' && ') });
      continue;
    }
    const rival = Object.entries(reg).find(([id0, r]) => !!LINK_KINDS[r.kind]?.locator(r, id0).url && title(r.title).toLowerCase() === l.title.toLowerCase() && overlap(r.for, l.for));
    if (rival) { res.push({ key: `link-proposal:${rival[0]}`, proposal: 'conflict', rival: rival[0], observation: o.id, ...mark, command: `ask --question ${shq(`Which is the source of truth for ${l.title}: ${LINK_KINDS[rival[1].kind].locator(rival[1], rival[0]).url} or ${redactUrl(l.url)}?`)} --links ${shq(JSON.stringify([{ title: title(rival[1].title), link: rival[0] }, { title: l.title, url: redactUrl(l.url) }]))} --evidence ${shq(o.id)}` }); continue; }
    const nid = newId(l.title);
    res.push({ key: `link-proposal:${nid}`, proposal: 'add', observation: o.id, ...mark, command: `link add ${shq(nid)} --kind url --url ${shq(l.url)} ${shFlag('title', l.title)}${asList(l.for).length ? ` --for ${asList(l.for).map(shq).join(' ')}` : ''}${l.notes ? ` ${shFlag('notes', l.notes)}` : ''} --source ${shq(o.id)}` });
  }
  return res;
}
export function cmdOrient() {
  const cl = orientClusters();
  const inc = incidentDebt();
  const lk = orientLinks();
  // --json stays the signals and the link proposals its readers count; incident debt is dashboard-data's ooda.debt.incidents
  if (flags.json) return json([...cl, ...lk]);
  // lessons waiting to be kept: the agents' own are the supervisor's to accept or retire, oldest first
  const mine = logObjects('knowledge').filter((k) => k.status === 'candidate' && !forOwner(k));
  const theirs = logObjects('knowledge').filter(forOwner).length;
  if (!cl.length && !inc.length && !lk.length && !mine.length) return out(`nothing recurring that is unexplained${theirs ? `; ${theirs} lesson${theirs > 1 ? 's wait' : ' waits'} for the owner` : ''}`);
  for (const c of cl) out(`${c.key}  x${c.count}  valence ${c.valence}\n  latest: ${c.latest}\n  evidence: ${c.ids.join(' ')}`);
  for (const x of inc) out(`${x.id} was fixed and verified (${x.title}): what did it teach? ${x.explain[0]} or ${x.explain[1]}`);
  if (inc.length) out('  (once a lesson is accepted, a decision it informs cites it: decide … --on <k-…>)');
  if (mine.length) {
    out('lessons for you to keep (the evidence is plain: accept it; it no longer holds: retire it; it would change something the owner set: send it to them):');
    for (const k of mine) out(`  ${k.id} [${k.kind}, ${k.scope}] ${k.statement}${(k.evidence ?? []).length ? ` (evidence: ${k.evidence.join(' ')})` : ''}`);
    out(`  (knowledge set <k-…> --status accepted, or --status retired, or --for-owner --plain "<what would change, and why the owner should care>")${theirs ? `; ${theirs} more wait${theirs > 1 ? '' : 's'} for the owner` : ''}`);
  }
  if (lk.length) { out('link proposals:'); for (const p of lk) out(p.note ? `  ${p.note}` : `  ${p.proposal} (${p.observation})${p.proposed_by ? `, proposed by ${p.proposed_by}; check before adding` : ''}: ${p.command}`); out('  (dismiss one: decide --class registry-edit --refs <observation> -- "<why the registry stays as it is>")'); }
}

// ===== 9. goals, roadmap, retros, chore worktrees =====

