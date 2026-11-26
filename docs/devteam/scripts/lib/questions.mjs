/* imports start */
import fs from 'node:fs';
import path from 'node:path';
import { CHORES } from './settings.mjs';
import { CREDENTIALS_REFUSED } from './links.mjs';
import { DAY } from './base.mjs';
import { IMPACT_WORDS } from './log-sync.mjs';
import { KNOWLEDGE_IDS_MAX } from './log.mjs';
import { LINE_MAX } from './log.mjs';
import { LINK_KINDS } from './links.mjs';
import { PROBE_AT_ONCE } from './observe.mjs';
import { RUNG } from './links.mjs';
import { SCHEMA } from './log.mjs';
import { SCOPE_HELP } from './links.mjs';
import { TURN_ID } from './threads.mjs';
import { activeTickets } from './graph.mjs';
import { answerIsRun } from './remediation.mjs';
import { appendLog } from './log-sync.mjs';
import { asList } from './base.mjs';
import { byTime } from './log-sync.mjs';
import { calls } from './log-sync.mjs';
import { choreSlug } from './goals.mjs';
import { clauseAt } from './decide.mjs';
import { collectMetrics } from './metrics.mjs';
import { command } from './base.mjs';
import { correctionOf } from './log-sync.mjs';
import { criticalPath } from './graph.mjs';
import { die } from './base.mjs';
import { doorAgreed } from './log-sync.mjs';
import { doorPick } from './log-sync.mjs';
import { doorPickNamed } from './log-sync.mjs';
import { doorPickUndone } from './log-sync.mjs';
import { features } from './graph.mjs';
import { findCycle } from './graph.mjs';
import { flagNum } from './base.mjs';
import { flagStr } from './base.mjs';
import { flags } from './base.mjs';
import { fromSensor } from './sensors.mjs';
import { ghSpec } from './repos.mjs';
import { goalImpact } from './log-sync.mjs';
import { hasCredentials } from './links.mjs';
import { holdWords } from './holds.mjs';
import { hostCheck } from './host.mjs';
import { hostRefusedWhileRunning } from './host.mjs';
import { impactOf } from './log-sync.mjs';
import { incidentSeverity } from './sensors.mjs';
import { isDoorQuestion } from './log-sync.mjs';
import { isIncident } from './sensors.mjs';
import { isUpkeep } from './holds.mjs';
import { json } from './base.mjs';
import { ladder } from './links.mjs';
import { latestPerTrack } from './reviews.mjs';
import { linkMaintains } from './links.mjs';
import { linkTextProblem } from './links.mjs';
import { listFlag } from './base.mjs';
import { loadSettings } from './settings.mjs';
import { logCache } from './log-sync.mjs';
import { logGet } from './log-sync.mjs';
import { logObjects } from './log-sync.mjs';
import { logWriter } from './log.mjs';
import { mainRoot } from './state.mjs';
import { mergeShaFor } from './repos.mjs';
import { nowIso } from './base.mjs';
import { nudgeSupervisor } from './sessions.mjs';
import { observeSpend } from './spend.mjs';
import { onPath } from './sensors.mjs';
import { out } from './base.mjs';
import { ownEntry } from './artifact-notes.mjs';
import { ownerWriter } from './log.mjs';
import { planners } from './panes.mjs';
import { positional } from './base.mjs';
import { probeLinks } from './observe.mjs';
import { questionView } from './log-sync.mjs';
import { questions } from './log-sync.mjs';
import { readJson } from './base.mjs';
import { readLog } from './log-sync.mjs';
import { readinessGoal } from './goals.mjs';
import { recordsRepo } from './repos.mjs';
import { redactUrl } from './links.mjs';
import { registryAttestGap } from './goals.mjs';
import { remediationDenied } from './remediation.mjs';
import { remediationDeniedWords } from './remediation.mjs';
import { remediationOf } from './remediation.mjs';
import { repo } from './repos.mjs';
import { repoReadable } from './repos.mjs';
import { rest } from './base.mjs';
import { reviewApproves } from './world-model.mjs';
import { runPath } from './settings.mjs';
import { runProbe } from './observe.mjs';
import { rungFor } from './trust.mjs';
import { rungHistory } from './trust.mjs';
import { saysRun } from './remediation.mjs';
import { scopeValid } from './links.mjs';
import { sevScope } from './sensors.mjs';
import { spansOverlap } from './decide.mjs';
import { supervisorOnly } from './log.mjs';
import { ticketGoals } from './holds.mjs';
import { ticketReviews } from './reviews.mjs';
import { tickets } from './graph.mjs';
import { tidyFinishedWorktrees } from './fleet.mjs';
import { turnBindings } from './decide.mjs';
import { turnClause } from './decide.mjs';
import { unsafeLocator } from './links.mjs';
import { upkeepAllows } from './goals.mjs';
import { upkeepOrVirtual } from './holds.mjs';
import { warn } from './base.mjs';
import { writeJson } from './base.mjs';
import { writeLearning } from './scores.mjs';
import { writeMovesCache } from './orient.mjs';
import { writerClass } from './log.mjs';
/* imports end */
// ---- the order of the Inbox: computed on every read, never stored ----
// The supervisor rates: each goal's impact (1 to 4, against the strategy), and on every question
// its stake and urgency (1 to 3 each) and the open questions one of its answers would settle. The
// kit counts what it can (tickets held up, tickets behind them, a default) and orders:
//   own   = impact × stake × urgency + unblock        unblock = min(12, 2 per ticket held up on
//           the critical path + 1 per ticket held up off it + 1 per ticket behind them)
//   own   = ceil(own / 2) when the question has a default (the fleet goes on at the deadline),
//           unless that default fires within DEFAULT_SOON_HOURS
//   score = own + the own of every open question it settles, through other settling questions too
// Unrated counts as stake 2 and urgency 2 with blocks, else 1; no goal or an unjudged one as
// impact 2. Urgency 3 counts as 3 only while the question holds up a waiting ticket, is about an
// open incident, or has a default, else as 2. settles counts only for a stake-3 question that shares a goal or feature
// with what it settles. A parked goal's question: urgency 1, no unblock.
// The order is by score within two bands. Above the rest, however they are rated (a low score
// must not bury them): one-way doors, what only the owner can do, goal approvals, a question
// holding up a waiting ticket or an open incident, a default about to fire, and a question that
// would settle any of those. Not while the question's goal is parked. Ties: more settled, then
// older, then id.
export const STAKE_WORDS = { 3: 'decides whether the work goes ahead', 2: 'changes the design or the plan', 1: 'a detail' };
export const STAKE_ACTION_WORDS = { 3: 'a goal or milestone waits on it', 2: 'a feature waits on it', 1: 'one ticket waits on it' };
export const FLOOR_KINDS = { 'one-way-door': 'a one-way door', 'owner-action': 'only you can do it', 'goal-approval': 'a goal waits on your approval' };
export const DEFAULT_SOON_HOURS = 4;
export const URGENCY_WORDS = { 3: 'work is stopped on it now', 2: 'work will stop on it before this milestone is done', 1: 'nothing waits on it yet' };
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// An answer is a choice when it is that label, with or without a note after " — ".
export const sameAnswer = (answer, label) => { const norm = (x) => String(x ?? '').trim().toLowerCase(); return !!label && [norm(answer), norm(String(answer ?? '').split(' — ')[0])].includes(norm(label)); };
// The goals and features a question is about: its goal, else its tickets' (the one it is about and
// those it blocks). Upkeep is no goal here: nobody judges its impact.
export function questionAbout(q) {
  const ts = tickets();
  const about = [...new Set([q.ticket, ...(q.blocks ?? [])].filter((id) => ts.has(id)))];
  const goals = (q.goal ? [logGet(q.goal)] : about.flatMap((id) => ticketGoals(ts.get(id)))).filter((g) => g?.type === 'goal' && !isUpkeep(g));
  return { goals: [...new Map(goals.map((g) => [g.id, g])).values()], features: [...new Set(about.map((id) => ts.get(id).feature).filter((f) => f && f !== CHORES))] };
}
// An incident-fix question's blocks names its incident (p-…): one still open backs an urgency of 3
// as a waiting ticket does.
export const blocksOpenIncident = (blocks) => (blocks ?? []).some((b) => { const p = logGet(b); return isIncident(p) && p.status !== 'resolved'; });
export const sharesWork = (a, b) => a.goals.some((g) => b.goals.some((h) => h.id === g.id)) || a.features.some((f) => b.features.includes(f));
// The rank of every question in the Inbox (the open ones whose goal is not let go: a question
// outside that list adds nothing to another's score), by id.
export function inboxRanks(inbox) {
  const sub = activeTickets();
  const crit = findCycle(sub) ? new Set() : new Set(criticalPath(sub).path);
  const waiting = (id) => sub.has(id) && !mergeShaFor(id);
  const dependents = new Map();
  for (const [id, t] of sub) for (const d of t.depends_on ?? []) (dependents.get(d) ?? dependents.set(d, []).get(d)).push(id);
  const byId = new Map(inbox.map((q) => [q.id, q]));
  const about = new Map(inbox.map((q) => [q.id, questionAbout(q)]));
  const now = Date.now();
  const facts = new Map();
  for (const q of inbox) {
    const a = about.get(q.id);
    const judged = a.goals.map((g) => ({ g, i: goalImpact(g.id) })).filter((x) => x.i).sort((x, y) => y.i.level - x.i.level)[0] ?? null;
    const goal = judged?.g ?? a.goals[0] ?? null;
    const parked = q.goal_hold === 'park';
    const held = [...new Set(q.blocks)].filter(waiting);
    const onPath = held.filter((id) => crit.has(id)).length;
    const after = new Set();
    const walk = (id) => { for (const d of dependents.get(id) ?? []) if (!after.has(d)) { after.add(d); walk(d); } };
    held.forEach(walk);
    const behind = [...after].filter((id) => waiting(id) && !held.includes(id)).length;
    const given = q.urgency ?? (q.blocks.length ? 2 : 1);
    const incident = blocksOpenIncident(q.blocks);
    const clamped = given === 3 && !parked && !held.length && !q.default && !incident;
    const soon = !!q.default && Date.parse(q.deadline) - now <= DEFAULT_SOON_HOURS * 3600000;
    const floor = parked ? null : soon ? 'its default is about to fire' : FLOOR_KINDS[q.kind] ?? (held.length ? 'work is waiting on it' : incident ? 'an open incident waits on it' : null);
    const parts = {
      goal: goal?.id ?? null, goal_title: goal?.title ?? null, goal_impact: judged?.i.level ?? 2, judged: !!judged, impact_by: judged?.i.by ?? null,
      stake: q.stake ?? 2, urgency: parked ? 1 : clamped ? 2 : given, urgency_given: q.urgency ?? null, rated: q.stake != null || q.urgency != null,
      held_up: held.length, on_path: onPath, behind, unblock: parked ? 0 : Math.min(12, 2 * onPath + (held.length - onPath) + behind),
      default: !!q.default, default_soon: soon, parked, floor, age_days: Math.floor((now - Date.parse(q.asked_at)) / DAY),
      settles: q.stake === 3 ? [...new Set(q.settles)].filter((id) => id !== q.id && byId.has(id) && sharesWork(a, about.get(id))) : [], settled_by: [],
    };
    const full = parts.goal_impact * parts.stake * parts.urgency + parts.unblock;
    facts.set(q.id, { q, parts, own: parts.default && !soon ? Math.ceil(full / 2) : full });
  }
  for (const [id, f] of facts) for (const m of f.parts.settles) facts.get(m).parts.settled_by.push(id);
  for (const [id, f] of facts) {
    const seen = new Set([id]);
    const walk = (x) => { for (const m of facts.get(x).parts.settles) if (!seen.has(m)) { seen.add(m); walk(m); } };
    walk(id);
    seen.delete(id);
    f.all = [...seen];
    f.score = f.own + f.all.reduce((s, m) => s + facts.get(m).own, 0);
    // keeps "a question ranks above everything it settles" true across the bands
    f.floor = f.parts.floor ?? (!f.parts.parked && f.all.some((m) => facts.get(m).parts.floor) ? 'it would settle one that is' : null);
  }
  const order = [...facts.values()].sort((x, y) => (y.floor ? 1 : 0) - (x.floor ? 1 : 0) || y.score - x.score || y.all.length - x.all.length || x.q.asked_at.localeCompare(y.q.asked_at) || x.q.id.localeCompare(y.q.id));
  const ranks = new Map();
  order.forEach((f, i) => {
    const { q, parts: p } = f;
    const chips = [];
    if (f.all.length) chips.push(`would settle ${f.all.length} other question${f.all.length > 1 ? 's' : ''}`);
    if (p.held_up) chips.push(`holds up ${plural(p.held_up, 'ticket')}${p.on_path ? `, ${p.on_path} on the critical path` : ''}${p.behind ? `, ${p.behind} more behind ${p.held_up > 1 ? 'them' : 'it'}` : ''}`);
    if (p.default) chips.push(`goes ahead with the default${q.deadline ? ` at ${q.deadline.slice(0, 16).replace('T', ' ')} UTC` : ''}`);
    // what the supervisor judged says so: the owner reads a rating as a rating, not a fact
    if (p.goal) chips.push(p.judged ? `for ${p.goal_title} (${p.impact_by === 'owner' ? 'your rating' : 'the supervisor\'s rating'}): ${IMPACT_WORDS[p.goal_impact]}` : `for ${p.goal_title}: its impact is not judged yet`);
    if (q.stake != null) { const w = q.kind === 'owner-action' ? (q.stake > 1 ? STAKE_ACTION_WORDS[q.stake] : null) : q.stake !== 2 ? STAKE_WORDS[q.stake] : null; if (w) chips.push(`the supervisor's rating: ${w}`); }
    if (p.urgency === 3 && p.held_up) chips.push(URGENCY_WORDS[3]);
    if (p.parked) chips.push('its goal is parked');
    if (p.age_days >= 3) chips.push(`waiting ${p.age_days} days`);
    const sum = [
      `impact ${p.goal_impact} (${p.judged ? IMPACT_WORDS[p.goal_impact] : p.goal ? 'not judged yet, counted as 2' : 'no goal, counted as 2'})`,
      `× stake ${p.stake} (${q.stake != null ? (q.kind === 'owner-action' ? STAKE_ACTION_WORDS : STAKE_WORDS)[p.stake] : 'not rated, counted as 2'})`,
      `× urgency ${p.urgency} (${p.parked ? 'its goal is parked' : p.urgency_given === 3 && p.urgency === 2 ? 'rated 3, counted as 2: it holds up no waiting ticket or open incident and has no default' : p.urgency === 3 && !p.held_up ? `rated 3, backed by ${p.default ? 'its default' : 'an open incident'}` : p.urgency_given != null ? URGENCY_WORDS[p.urgency] : `not rated, counted as ${p.urgency}`})`,
      ...(p.unblock ? [`+ ${p.unblock} for the tickets it holds up`] : []), ...(p.default && !p.default_soon ? ['halved for its default'] : []),
      ...(f.all.length ? [`+ ${f.score - f.own} from the ${plural(f.all.length, 'question')} it would settle`] : []),
    ].join(' ');
    ranks.set(q.id, { score: f.score, own: f.own, position: i + 1, of: order.length, top: i === 0 && q.stake != null && q.urgency != null, floor: f.floor, chips, reason: [...chips, ...(p.settled_by.length ? [`may be settled by ${p.settled_by.join(', ')}`] : [])].join('; '), sum: `score ${f.score}: ${sum}`, parts: { ...p, settles: f.all } });
  });
  return ranks;
}
// Questions in Inbox order, each with its rank (null for one outside the Inbox: closed, or its
// goal let go; those follow, oldest first).
export function rankQuestions(qs, inbox = qs) {
  const ranks = inboxRanks(inbox);
  return qs.map((q) => ({ ...q, rank: ranks.get(q.id) ?? null })).sort((a, b) => (a.rank?.position ?? Infinity) - (b.rank?.position ?? Infinity) || a.asked_at.localeCompare(b.asked_at));
}
// What holds each item that needs the owner: a ticket id, or plan-<feature> for a planner, to the
// open Inbox question holding it (asked for the ticket or naming it in blocks; for a planner, one of
// its waiting_on_owner). With several, the first in Inbox order: the one the owner answers first.
export function heldByMap() {
  const qs = rankQuestions(questions().filter((q) => q.status === 'open' && q.goal_hold !== 'let-go'));
  const H = new Map();
  const hold = (key, qid) => { if (!H.has(key)) H.set(key, qid); };
  const ps = planners();
  for (const q of qs) {
    for (const id of [q.ticket, ...(q.blocks ?? [])].filter(Boolean)) hold(id, q.id);
    for (const p of ps) if (p.waiting_on_owner.includes(q.id)) hold(`plan-${p.feature}`, q.id);
  }
  return H;
}
export function cmdQuestions() {
  let qs = questions();
  const inbox = qs.filter((q) => q.status === 'open' && q.goal_hold !== 'let-go');
  if (flagStr('id')) qs = qs.filter((q) => q.id === flagStr('id'));
  else if (!flags.all) qs = inbox;
  qs = rankQuestions(qs, inbox);
  if (flags.json) return json(qs);
  if (!qs.length) return out('no questions');
  for (const q of qs) {
    out(`${q.id}  [${q.kind}, ${q.status}${q.goal_hold ? `, its goal ${holdWords(q.goal_hold)}` : ''}]${q.blocks.length ? ` blocks ${q.blocks.join(',')}` : ''}${q.new_because ? `\n  Asked again because: ${q.new_because}` : ''}\n  ${q.question}`);
    for (const c of q.choices) out(`  - ${c.label}${c.label === q.recommendation ? ' (recommended)' : ''}${c.detail ? `: ${c.detail}` : ''}${c.effect ? ` For users: ${c.effect}` : ''}`);
    for (const l of q.links) out(`  see: ${l.title} (${l.url ?? (l.remote ? `repo ${l.remote}` : `${l.ref ? `${l.ref}:` : ''}${l.path}`)})`);
    if (q.review) out(`  review: ${q.review.page?.path} at ${String(q.review.commit).slice(0, 12)} (${q.review.ref})${q.review.data ? `, ${q.review.data.rows} rows` : ''}; ${q.result_status} (devteam.mjs review show ${q.id})`);
    if (q.recommendation) out(`  recommend: ${q.recommendation}${q.confidence != null ? ` (${Math.round(q.confidence * 100)}%)` : ''}`);
    if (q.no_default) out(`  no default, because: ${q.no_default}`);
    if (q.why_asked?.reasons?.length) out(`  why asked: ${q.why_asked.reasons.join(', ')}${q.class ? ` (${q.class}, rung ${q.why_asked.rung ?? '-'} of ${q.why_asked.ceiling ?? '-'})` : ''}`);
    if (q.answer) out(`  answer (${q.answered_by}): ${q.answer}`);
    if (q.autonomy) out(`  next time: ${q.autonomy.class} at rung ${q.autonomy.rung} (${RUNG[q.autonomy.rung]})${q.autonomy.scope ? ` for ${q.autonomy.scope}` : ''}`);
    if (q.standing_rule) out(`  standing rule: ${q.standing_rule}`);
    if (q.settles.length && q.status === 'open') out(`  settles, if answered "${q.settles_if}": ${q.settles.join(', ')}`);
    // only a rated question prints its rank: an unrated one prints as it always did
    if (q.rank?.parts.rated) out(`  rank: ${q.rank.score}${q.rank.reason ? ` (${q.rank.reason})` : ''}`);
  }
}
// next: the owner's next best step, the top of the Inbox, and why it is there. (What the fleet
// starts next is still `ready`, in the owner's priority order.)
export function cmdNext() {
  const qs = rankQuestions(questions().filter((q) => q.status === 'open' && q.goal_hold !== 'let-go'));
  const [top, ...then] = qs;
  const owner = top ? { id: top.id, kind: top.kind, question: top.question, rank: top.rank, then: then.map((q) => ({ id: q.id, question: q.question, score: q.rank.score })) } : null;
  if (flags.json) return json({ owner });
  if (!owner) return out('you    nothing: the Inbox is empty');
  out(`you    ${top.id}  ${top.question}`);
  if (top.rank.reason) out(`       ${top.rank.reason}`);
  if (top.rank.floor) out(`       above the ordinary questions: ${top.rank.floor}`);
  out(`       ${top.rank.sum}`);
  if (then.length) out(`       then: ${then.slice(0, 3).map((q) => `${q.id} (score ${q.rank.score})`).join(', ')}${then.length > 3 ? `, ${then.length - 3} more` : ''}`);
}

// An act: a decision the supervisor made. For a ladder class it checks the rung first and refuses
// (writing nothing) when the supervisor may not act alone; an owner-only class needs an owner answer.
// Whether the supervisor may make a call in class cls (scope), and on what authority: the class's
// rung, an owner's answer or a default (approved q-…), a standing rule (approved k-…), or the
// constitution for a class the ladder doesn't hold. Exits 3 when the rung says ask first. One
// answer authorises one call (a decision, or an act that is its own decision); a question that
// declared its acts (ask --approves) authorises one call for each.
export function authorise(cls, scope, approved, refs, verb) {
  const L = ladder();
  const ownerOnly = (L.owner_only ?? []).includes(cls);
  let approval = null;
  let rule = null;
  if (approved?.startsWith('k-')) {
    rule = logGet(approved);
    if (rule?.type !== 'knowledge' || writerClass(rule.created_by) !== 'owner' || rule.status !== 'accepted') die(`${approved} is not a standing rule of the owner's (accepted knowledge the owner wrote)`);
    // Only a rule the owner scoped to this class: a project-wide preference ("flags first") is
    // guidance, never authority over every class on the ladder.
    if (rule.scope !== `class:${cls}`) die(`${approved} applies to ${rule.scope}; a standing rule authorises a call only when the owner scoped it to its class (answer … --rule "…" --rule-scope class:${cls})`);
    if (ownerOnly && !(L.owner_rules ?? []).includes(cls)) die(`${cls} is the owner's (constitution.md); a standing rule never covers it: ask`);
    if (cls === 'production-remediation') die('production-remediation tops out at ask with a default: a standing rule never covers it, so the owner sees each one coming');
  } else if (approved) {
    const q = logGet(approved);
    approval = q?.type === 'question' ? questionView(q) : null;
    if (!approval || !['answered', 'defaulted'].includes(approval.status)) die(`${approved} is not an answered question`);
    if (approval.status === 'defaulted') { const why = defaultGap(approval); if (why) die(`${why}: its default approves nothing; ask again`); }
    reviewApproves(approval, `${verb} --approved`);
  }
  // approve-plan may cite the owner's answer to a one-way door asked at goal level (constitution.md §4);
  // the act checks it against the ticket's goals and its plan review, not as an approve-plan answer.
  const doorCited = cls === 'approve-plan' && isDoorQuestion(approval);
  if (approval && !doorCited) {
    if (approval.class !== cls) die(`${approved} was asked in class ${approval.class ?? '(none)'}, not ${cls}`);
    const declared = approval.approves ?? [];
    if (declared.length) {
      const part = refs.flatMap((x) => String(x).split(',')).find((r) => declared.includes(r));
      if (!part) die(`${approved} approves ${declared.join(', ')}; name the one this ${verb === 'decide' ? 'decision' : 'act'} is for in --refs`);
      const used = calls().find((a) => a.approved_by === approved && (a.refs ?? []).includes(part) && !(a.class === 'approve-plan' && isDoorQuestion(approval)));
      if (used) die(`${approved} already approved ${used.type === 'decision' ? 'a decision' : 'an act'} for ${part} (${used.id}); ask again for another`);
    } else {
      // a door's answer cited for the plans it covers (approve-plan) never uses it up for its own class
      const used = calls().find((a) => a.approved_by === approved && !(a.class === 'approve-plan' && isDoorQuestion(approval)));
      if (used) die(`${approved} already approved ${used.type === 'decision' ? 'a decision' : 'an act'} (${used.id}); ask again for another`);
    }
  }
  const def = L.classes[cls];
  let rung;
  let authority = 'constitution';
  if (ownerOnly) {
    if (!approval || approval.status !== 'answered') die(`${cls} is the owner's (constitution.md); it needs an owner answer in that class (--approved <qid>)`);
    authority = 'answer';
  } else if (def) {
    rung = rungFor(cls, scope);
    if (rule) authority = 'standing-rule';
    else if (approval) {
      if (approval.status === 'defaulted' && rung < 2) die(`${cls} is on rung ${rung} (${RUNG[rung]}); a defaulted answer is not approval there`);
      authority = approval.status === 'defaulted' ? 'default' : 'answer';
    } else if (rung < 3) {
      process.stderr.write(`devteam: ${cls}${scope ? ` (${scope})` : ''} is on rung ${rung} (${RUNG[rung]}); ask first:\n  devteam.mjs ask --class ${cls} --question "…" --recommendation "…"${rung === 2 ? ' --default "…"' : ''} --reasons below-rung\nthen ${verb} with --approved <qid>.\n`);
      process.exit(3);
    } else authority = 'rung';
  } else {
    if (!(L.constitutional ?? []).includes(cls)) warn(`class "${cls}" is not in constitution.md (ladder, constitutional or owner-only)`);
    if (rule) authority = 'standing-rule';
    else if (approval) authority = approval.status === 'defaulted' ? 'default' : 'answer';
  }
  return { rung, ceiling: def?.ceiling, authority, approval, doorCited };
}
// A decision an act may carry out: the supervisor's, and not corrected (decide again after a correction).
// A decision made on the class's own trust (its rung, or a default) lapses when the class drops after
// it: a stockpiled call can't outlive the correction that took the trust back.
export function decisionFor(id) {
  const d = logGet(id);
  if (d?.type !== 'decision') die(`no decision ${id}`);
  if (correctionOf(d)) die(`${id} was corrected (${correctionOf(d).reason}); decide again`);
  if (['rung', 'default'].includes(d.authority) && rungHistory(d.class, d.scope ?? null).some((e) => e.by === 'correction' && e.at > d.created_at)) die(`${d.class} dropped to rung 1 after ${id} was decided; decide again`);
  // The authority a decision records is checked against the log, not taken on its word: a decision
  // line is the supervisor's own, so one written by hand can't carry trust it never had.
  const why = decisionAuthorityGap(d);
  if (why) die(`${id} records authority it doesn't have (${why}); decide again`);
  return d;
}
// Whether an applied default stands in for the owner. Only where it could fire when the owner saw the
// question: its class on rung 2 or above as asked (why_asked.rung, in the line the question's hash
// covers, so a class promoted later doesn't wake an old rung-1 default), and only once its deadline
// passed with no answer. answer --defaulted asks it of now; authorise, a decision's authority and
// log-check ask it of when the default was applied, so a defaulted line written by hand approves
// nothing either. A question from before defaults had deadlines is judged on its rung alone.
export function defaultGap(v, now = null) {
  const rung = v.why_asked?.rung;
  if (typeof rung === 'number' && rung < 2) return `${v.id} was asked on rung ${rung} (${RUNG[rung] ?? '?'}), where a default never stands in for the owner`;
  const at = now ?? v.answered_at;
  if (v.deadline && at && Date.parse(at) < Date.parse(v.deadline)) return now ? `${v.id}'s default fires at ${v.deadline}; until then it is the owner's to answer` : `${v.id} was defaulted before its deadline (${v.deadline})`;
  return null;
}
export function decisionAuthorityGap(d) {
  const L = ladder();
  const ownerOnly = (L.owner_only ?? []).includes(d.class);
  const q = d.approved_by?.startsWith('q-') ? logGet(d.approved_by) : null;
  const v = q?.type === 'question' ? questionView(q) : null;
  const inClass = v && (v.class === d.class || (d.class === 'approve-plan' && isDoorQuestion(v)));
  if (ownerOnly && !(d.authority === 'standing-rule' && (L.owner_rules ?? []).includes(d.class))) return v && inClass && v.status === 'answered' ? answerUseGap(d, v) : `${d.class} is the owner's and needs the owner's answer in that class`;
  switch (d.authority) {
    case 'answer': return v && inClass && v.status === 'answered' ? answerUseGap(d, v) : `no answered ${d.class} question ${d.approved_by ?? ''}`.trim();
    // A default stands in for the owner only where the owner put the class on rung 2 (ask with a
    // default), only once the question's deadline passed with no answer, and once, as decide
    // enforces: a decision line written by hand gets the same rule.
    case 'default': {
      if (!(v && inClass && v.status === 'defaulted' && v.default)) return `no defaulted ${d.class} question ${d.approved_by ?? ''}`.trim();
      if (!L.classes[d.class] || rungFor(d.class, d.scope ?? null) < 2) return `${d.class} is not on rung 2 or above${d.scope ? ` for ${d.scope}` : ''}, so a default is not approval there`;
      return defaultGap(v) ?? answerUseGap(d, v);
    }
    case 'standing-rule': { const k = logGet(d.approved_by ?? ''); return k?.type === 'knowledge' && writerClass(k.created_by) === 'owner' && k.status === 'accepted' && k.scope === `class:${d.class}` ? null : `no accepted owner rule scoped class:${d.class}`; }
    case 'rung': return L.classes[d.class] && rungFor(d.class, d.scope ?? null) >= 3 ? null : `${d.class} is not on rung 3`;
    case 'constitution': return (L.constitutional ?? []).includes(d.class) || !L.classes[d.class] ? null : `${d.class} is on the ladder, not constitutional`;
    default: return `unknown authority ${d.authority}`;
  }
}
// An owner's answer approves one call, as decide and act enforce (or one per item it approves),
// and the call is about what the question was: a decision line written by hand gets the same rule,
// so it can't reuse an answer that already approved something, or carry one asked about another
// ticket. The earliest call citing the answer (for that item) is the one it approved.
export function answerUseGap(d, v) {
  const refs = (d.refs ?? []).flatMap((x) => String(x).split(','));
  if (v.ticket && !refs.includes(v.ticket) && !(v.approves ?? []).some((a) => refs.includes(a))) return `${v.id} was asked about ${v.ticket}, not ${refs.join(', ') || 'nothing'}`;
  if (d.class === 'approve-plan' && isDoorQuestion(v)) return null; // a goal-level door covers each plan it names (approve-plan's own check)
  const declared = v.approves ?? [];
  const part = declared.length ? refs.find((r) => declared.includes(r)) : null;
  if (declared.length && !part) return `${v.id} approves ${declared.join(', ')}, and this names none of them`;
  const first = calls().filter((c) => c.approved_by === v.id && !(c.class === 'approve-plan' && isDoorQuestion(v)) && (!part || (c.refs ?? []).flatMap((x) => String(x).split(',')).includes(part))).sort(byTime)[0];
  return first && first.id !== d.id ? `${v.id} already approved ${first.type === 'decision' ? 'a decision' : 'an act'}${part ? ` for ${part}` : ''} (${first.id})` : null;
}
// What a command's act would be about, for --decision: the act must be about something the decision named.
export function citeTargets() {
  const [a, b] = positional;
  switch (command) {
    case 'merge': return [a, flagStr('chore') !== undefined ? `chore-${choreSlug(flagStr('chore'))}` : null, flagStr('plan'), flagStr('plan') ? `plan-${flagStr('plan')}` : null].filter(Boolean);
    case 'ticket': return ['add', 'set', 'hold', 'release'].includes(a) ? [b] : null;
    case 'withdraw': return [a];
    case 'goal': return a === 'hold' ? [b === 'upkeep' ? upkeepOrVirtual().id : b, b] : null;
    case 'worker': return [a, ...(features().get(tickets().get(a)?.feature)?.goals ?? [])];
    case 'planner': return [a, `plan-${a}`, ...asList(flags.goal)];
    case 'fleet': return ['fleet', ...logObjects('goal').map((g) => g.id)];
    case 'remediate': return a ? [`remediation:${a}`] : null;
    case 'link': return [`link:${b}`];
    default: return null;
  }
}
// --decision on a command that logs its own act: checked before the command runs (see dispatch).
export const citing = () => flagStr('decision') ?? undefined;

export function cmdDecide() {
  const what = rest ? rest.join(' ') : flagStr('what');
  const cls = flagStr('class');
  if (!cls || !what) die('usage: decide --class c [--scope s] [--approved qid|kid] [--options "a" "b"] [--rationale "…"] [--confidence 0-1] [--refs ids] [--on k-…|p-…] [--irreversible] -- "<what you decided>"');
  supervisorOnly('decide');
  if (cls === 'improvement-trial') upkeepAllows('a new trial');
  let scope = flagStr('scope') ?? null;
  const approved = flagStr('approved') ?? null;
  const refs = asList(flags.refs);
  // --on: the knowledge or problems the call rests on, a link for the lineage and the learning
  // record, apart from refs (an act stays within refs) and from approved_by (authorise reads only
  // that). Knowledge must be accepted: a candidate isn't the project's yet, and a retired one no
  // longer is. An id in both would read as what the call is about and what it rests on at once.
  const on = flags.on === true ? die('--on names the knowledge or problems the decision rests on: --on <k-…|p-…>…') : [...new Set(asList(flags.on))];
  if (on.length > KNOWLEDGE_IDS_MAX) die(`--on takes at most ${KNOWLEDGE_IDS_MAX} ids (a log line is at most ${LINE_MAX} bytes): cite the ones the call turns on`);
  for (const k of on) {
    const o = logGet(k) ?? die(`--on ${k}: no such knowledge or problem`);
    if (!['knowledge', 'problem'].includes(o.type)) die(`--on ${k} is ${o.type === 'observation' ? 'an' : 'a'} ${o.type}: a decision rests on knowledge or a problem (cite what it is about in --refs)`);
    if (o.type === 'knowledge' && o.status !== 'accepted') die(`${k} is ${o.status}: a decision rests only on accepted knowledge`);
    if (refs.includes(k)) die(`${k} is in both --refs and --on: --refs is what the decision is about, --on what it rests on`);
  }
  // a remediation decision names the remediation it runs
  if (cls === 'production-remediation') {
    upkeepAllows('a remediation', { noForce: true });
    const rs = refs.filter((r) => String(r).startsWith('remediation:'));
    if (rs.length !== 1) die('a production-remediation decision names exactly one remediation:<action> in --refs (and, if there is one, the incident it is for)');
    const r = remediationOf(rs[0].slice('remediation:'.length));
    const rel = refs.filter((x) => String(x).startsWith('release:'));
    if (r.kind === 'rollback' && rel.length !== 1) die('a rollback decision names its target in --refs release:<version>');
    if (r.kind !== 'rollback' && rel.length) die(`${r.name} is a ${r.kind}, not a rollback: it takes no release`);
    // the answer is about this remediation (and release), and went with the recommendation
    if (approved?.startsWith('q-')) {
      const q = questionView(logGet(approved) ?? die(`no question ${approved}`));
      for (const ref of [rs[0], ...rel]) if (!(q.blocks ?? []).includes(ref)) die(`${approved} was asked about ${(q.blocks ?? []).join(', ') || 'nothing in particular'}, not ${ref}`);
      if (q.status === 'answered' && (!q.matched || !answerIsRun(logGet(approved), q.label ?? q.answer))) die(`${approved}'s answer ("${q.answer}") isn't a yes to running it (recommended: "${q.recommendation}"): a remediation runs only on a yes`);
      if (q.status === 'defaulted' && !saysRun(q.default)) die(`${approved} defaulted to "${q.default}": a remediation runs only on a yes`);
      const denied = remediationDenied(q, rs[0], rel[0] ?? null);
      if (denied) die(remediationDeniedWords(r.name, rel[0] ?? null, denied));
      if (q.status === 'defaulted' && String(q.default ?? '').trim().toLowerCase() !== String(q.recommendation ?? '').trim().toLowerCase()) die(`${approved} defaulted to "${q.default}", not its recommendation: a remediation runs only on a yes`);
    }
  }
  // an incident fix is scoped by the incident's computed severity, never by the caller
  // (one incident per decision, so a low one can't carry a high one past the ladder), and an answer
  // approves a decision only for the incident it was asked about, at the same scope
  if (cls === 'incident-fix') {
    upkeepAllows('an incident fix');
    const incs = refs.map((r) => logGet(r)).filter(isIncident);
    if (incs.length !== 1) die(`an incident-fix decision names exactly one incident in --refs (sensor incident …), then the fix ticket's id; it names ${incs.length}`);
    const inc = incs[0];
    // a fix names its ticket too, picked first: ticket add takes only a decision that names it, and
    // an answer approves one decision, so a fix decided without it meant asking the owner again
    if (!/^\s*(watch|ignore)\b/i.test(what) && !refs.some((r) => r !== inc.id && !/^[a-z]-\d{8}-/.test(r))) die(`a fix decision names its fix ticket's id in --refs too (pick it first): --refs ${inc.id} <ticket-id>. ticket add needs a decision that names the ticket, and an answer approves one decision, so leaving it out means asking again; "watch …" or "ignore …" needs no ticket`);
    const want = sevScope(incidentSeverity(inc));
    if (scope && scope !== want) die(`${inc.id} has computed severity ${incidentSeverity(inc)}: its scope is ${want}, not ${scope}`);
    scope = want;
    if (approved?.startsWith('q-')) {
      const q = logGet(approved);
      if (!(q?.blocks ?? []).includes(inc.id)) die(`${approved} was asked about ${(q?.blocks ?? []).join(', ') || 'no incident'}, not ${inc.id}`);
      if (q.scope && q.scope !== scope) die(`${approved} was asked at ${q.scope}; ${inc.id} is ${scope} now: ask again`);
    }
  }
  const confidence = flagNum('confidence');
  if (confidence !== undefined && !(confidence >= 0 && confidence <= 1)) die('--confidence is a number from 0 to 1');
  if (['approve-spec', 'approve-plan'].includes(cls) && !tickets().has(refs[0])) die(`${cls} names the ticket first: --refs <ticket-id> [other ids]`);
  if (cls === 'goal-readiness') readinessGoal(refs);
  // a noise ruling explains observations by citing them (orientClusters); one that cites none explains nothing
  // (or the fixed incident it rules there is nothing to learn from: incidentDebt)
  if (cls === 'orient-noise' && !refs.some((r) => { const x = logGet(r); return x?.type === 'observation' || (x?.type === 'problem' && isIncident(x) && x.status === 'resolved'); })) die('a noise ruling names the observations it explains: --refs <signal key> <o-…>… (or a fixed incident with nothing to keep: --refs <p-…>)');
  const a = authorise(cls, scope, approved, refs, 'decide');
  if (a.doorCited && a.approval.ticket !== refs[0] && !(features().get(tickets().get(refs[0])?.feature)?.goals ?? []).includes(a.approval.goal)) die(`${approved} answered a one-way door for ${a.approval.ticket ?? a.approval.goal ?? 'something else'}, not for ${refs[0]} or a goal its feature serves`);
  const line = appendLog({
    type: 'decision', class: cls, scope: scope ?? undefined, what, rationale: flagStr('rationale'), options: flags.options !== undefined ? listFlag('options') : undefined,
    confidence, refs, reversible: !flags.irreversible, rung: a.rung, ceiling: a.ceiling, authority: a.authority, approved_by: approved ?? undefined, knowledge: on.length ? [...new Set(on)] : undefined,
  }, 'supervisor');
  out(line.id);
}

export function cmdAct() {
  const what = rest ? rest.join(' ') : flagStr('what');
  const decision = flagStr('decision') ? decisionFor(flagStr('decision')) : null;
  if (decision && flagStr('class') && flagStr('class') !== decision.class) die(`${decision.id} is in class ${decision.class}; an act carrying it out takes its class`);
  if (decision && (flagStr('approved') || flagStr('scope'))) die(`an act carrying out ${decision.id} takes its scope and approval from it; pass no --scope or --approved`);
  const cls = decision?.class ?? flagStr('class');
  if (!cls || !what) die('usage: act --decision d-… -- "<what you did>"   |   act --class c [--scope s] [--approved qid|kid] [--refs ids] [--irreversible] -- "<what you did>"   (without --decision the act is its own decision)');
  supervisorOnly('act');
  // --repo: the repo link the act was about (a release, staging, production), when not home
  const rid = flagStr('repo');
  if (rid && rid !== 'home' && !LINK_KINDS[ownEntry(loadSettings().links, rid)?.kind]?.hostsComponents) die(`--repo ${rid}: not a repo link (devteam.mjs links)`);
  if (cls === 'improvement-trial') upkeepAllows('a new trial');
  // an incident fix is decided first (one incident, its computed scope, an answer about it)
  if (cls === 'production-remediation') die('a remediation is run by remediate <action> --decision <d-…>, which logs its act');
  if (cls === 'incident-fix') upkeepAllows('an incident fix');
  if (cls === 'incident-fix' && !decision) die('an incident-fix act carries out a decision: decide --class incident-fix --refs <p-id> <ticket-id> …, then act --decision <d-id>');
  const scope = decision ? decision.scope ?? null : flagStr('scope') ?? null;
  const approved = decision ? decision.approved_by ?? null : flagStr('approved') ?? null;
  const refs = flags.refs !== undefined ? asList(flags.refs) : decision?.refs ?? [];
  // An act carries out what its decision covered, nothing else.
  if (decision) {
    const outside = refs.filter((r) => !(decision.refs ?? []).includes(r));
    if (outside.length) die(`${decision.id} covers ${(decision.refs ?? []).join(', ') || 'no refs'}; ${outside.join(', ')} ${outside.length > 1 ? 'are' : 'is'} outside it: decide again for ${outside.length > 1 ? 'them' : 'it'}`);
    if (['approve-spec', 'approve-plan'].includes(cls) && refs[0] !== decision.refs?.[0]) die(`${decision.id} approves ${decision.refs?.[0]}; a ${cls} act under it names that ticket first`);
  }
  // A decision was authorised when it was made; an act without one is authorised now.
  let auth;
  if (decision) {
    const q = approved?.startsWith('q-') ? logGet(approved) : null;
    const approval = q?.type === 'question' ? questionView(q) : null;
    auth = { rung: undefined, approval, doorCited: cls === 'approve-plan' && isDoorQuestion(approval) };
  } else auth = authorise(cls, scope, approved, refs, 'act');
  const { approval, doorCited } = auth;
  // Classes that are about one ticket name it first in refs; checkTicket finds approvals by it.
  if (['approve-spec', 'approve-plan'].includes(cls) && !tickets().has(refs[0])) die(`${cls} names the ticket first: --refs <ticket-id> [other ids]`);
  if (cls === 'approve-plan') {
    const t = tickets().get(refs[0]);
    const doors = t.one_way_doors ?? [];
    let goalDoor = null;
    // door questions answered with a marked alternative: any one named in the plan and its review approves
    let picks = [];
    if (doorCited) {
      if (!doors.length) die(`${t.id} lists no one-way doors; ${approved} has nothing to cover`);
      if (approval.status !== 'answered') die(`${approved} was not answered by the owner; a one-way door needs the owner's answer, never a default`);
      if (!doorAgreed(approval)) {
        const pick = doorPick(approval) && !doorPickUndone(approval, questions()) ? doorPick(approval) : null;
        if (!pick) die(`${approved} was answered "${String(approval.answer ?? '').slice(0, 80)}", not its recommendation ("${approval.recommendation}") nor a choice it marked "approves" that the owner picked themselves, with no later answer to the same door: a plan built on the recommendation isn't what the owner said yes to; replan to their answer and ask about that`);
        picks.push({ id: approved, pick });
      }
      if (approval.ticket !== t.id) {
        // a question asked for one ticket is that ticket's door, never a goal-level one for another
        if (approval.ticket) die(`${approved} was asked for ${approval.ticket}, not ${t.id}: a ticket's door answer covers that ticket only`);
        const goals = features().get(t.feature)?.goals ?? [];
        if (!approval.goal) die(`${approved} is a one-way-door question for neither ${t.id} nor a goal`);
        if (!goals.includes(approval.goal)) die(`${approved} answered a one-way door for goal ${approval.goal}, but ${t.id}'s feature ${t.feature} serves ${goals.join(', ') || 'no goal'}; an answer for another goal never covers this plan`);
        goalDoor = approved;
      }
    } else if (doors.length && !questions().some((q) => isDoorQuestion(q) && q.ticket === t.id && q.status === 'answered' && doorAgreed(q))) {
      // the owner picked a marked alternative: that answer approves the plan built on it, once the
      // plan and its approving review name it (below); any one named pick approves, as any one agreed door does
      const qs = questions();
      picks = qs.filter((q) => isDoorQuestion(q) && q.ticket === t.id && doorPick(q) && !doorPickUndone(q, qs)).map((q) => ({ id: q.id, pick: doorPick(q) }));
      if (!picks.length) die(`${t.id} lists one-way doors; the owner answers a one-way-door question (--ticket ${t.id}) before its plan is approved, or you cite the owner's answer to the goal's one-way-door question (--approved <qid>) and the plan review says it covers the plan (constitution.md §4)`);
    }
    // The plan opens with its TL;DR, so a low-risk plan can be approved from it (quality.md §6).
    // where the records are: home's ticket/<id> for records in home, else the ticket's repo (an act:
    // fails fast on a missing or wrong checkout)
    const R = recordsRepo(t.id);
    const ref = [`ticket/${t.id}`, `origin/ticket/${t.id}`].find((r) => R.resolveCommit(r));
    const plan = ref ? R.git(['show', `${ref}:${R.projectRel}/tickets/${t.id}/plan.md`]) : null;
    if (plan === null) die(`no plan.md for ${t.id} on ticket/${t.id}; approve a plan once it is committed`);
    const tldr = tldrGap(plan);
    if (tldr) die(`${t.id}'s plan ${tldr}; send it back to the worker (quality.md §6)`);
    // a plan on the owner's pick of a marked alternative says so, and the latest approving plan review
    // says the same, so the approval is of the plan built on that pick (quality.md §3)
    if (picks.length) {
      const reviewsOk = latestPerTrack(ticketReviews(t.id, R.name === 'home' ? { ref } : { ref, repo: R }), 'plan').filter((r) => r.verdict === 'APPROVE');
      const named = picks.find((p) => doorPickNamed(plan, p.id, p.pick) && reviewsOk.some((r) => (r.doorPicks ?? []).some((d) => d.id === p.id && d.pick.toLowerCase() === p.pick.trim().toLowerCase())));
      if (!named) die(`${picks.map((p) => `${p.id} was answered "${p.pick}", a choice it marked "approves" but not its recommendation`).join('; ')}: the plan approves only when it is built on that pick and both the plan and its latest approving plan review say so, each on the line "- One-way door ${picks[0].id}: ${picks[0].pick}"; replan to it and have the plan reviewed`);
    }
    // A goal-level answer covers the plan only when its reviewer says the plan stays inside it.
    if (goalDoor) {
      const latest = latestPerTrack(ticketReviews(t.id, R.name === 'home' ? { ref } : { ref, repo: R }), 'plan').filter((r) => r.verdict === 'APPROVE');
      if (!latest.some((r) => r.doors.includes(goalDoor))) die(`${goalDoor} is a goal-level answer; the latest approving plan review (reviews/plan-<n>.md on ticket/${t.id}) must say "- Goal-level door: ${goalDoor} covers this plan" (quality.md §3)`);
    }
  }
  if (cls === 'goal-readiness') {
    const g = readinessGoal(refs);
    const why = g.registry_precondition ? registryAttestGap(g.id) : null;
    if (why) die(`${g.id} has precondition ${g.registry_precondition} marked "the registry is complete", and has no owner's yes to a registry-attest question (${why}): ask --class registry-attest --goal ${g.id} --question "Does the registry list every repo, design file and doc this project depends on?" --recommendation yes, and log goal-readiness once the owner answers yes (planning.md §7)`);
  }
  const line = appendLog({ type: 'act', class: cls, scope: scope ?? undefined, what, rung: auth.rung, refs, reversible: decision ? decision.reversible !== false && !flags.irreversible : !flags.irreversible, approved_by: decision ? undefined : approved ?? undefined, decision: decision?.id, repo: rid && rid !== 'home' ? rid : undefined }, 'supervisor');
  out(line.id);
}
// A plan or design opens with '## TL;DR' and a few bullets: the approach, skimmable (quality.md §6).
// Header fields written as bullets (Goal, Architecture, Tech stack, Spec, then a colon; bold,
// underscored or plain, any case) don't count: only the body bullets do. Returns what is wrong, or null.
export function tldrGap(text) {
  const HEADER_FIELD = /^\s{0,3}[-*+]\s+(?:\*\*|__)?(?:goal|architecture|tech[\s-]?stack|spec)(?:\*\*|__)?\s*:/i;
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^##\s+TL;?DR\b/i.test(l.trim()));
  if (at < 0) return 'has no "## TL;DR" section';
  if (lines.slice(0, at).some((l) => /^##\s/.test(l.trim()))) return 'has its TL;DR after another section; it comes first, under the title';
  const body = [];
  for (const l of lines.slice(at + 1)) { if (/^#{1,2}\s/.test(l.trim())) break; body.push(l); }
  const bullets = body.filter((l) => /^\s{0,3}[-*+]\s+\S/.test(l) && !HEADER_FIELD.test(l)).length;
  if (!bullets) return 'has a TL;DR with no bullets';
  if (bullets > 7) return `has a TL;DR of ${bullets} bullets; seven at most, the rest belongs in the plan`;
  return null;
}
// A correction lands on the call that was wrong: a decision, or an act that was its own decision.
// An act that carried out a decision sends you to the decision; if the decision was sound and the
// act went wrong, that is a problem (or an escaped defect), not a trust drop (constitution.md §2).
export function cmdCorrect() {
  const [actId] = positional;
  if (!actId) die('usage: correct <decision-or-act-id> --reason r [--severity 0-4] [--impact 1-4 (a goal-impact decision: the impact you give the goal)]   (owner; the supervisor at a retro adds --retro; the supervisor records the owner\'s words with --from-turn <u-id> --said "<whole clauses>" [--at <n>] or --from-chat --said "<words>")');
  // the owner's correction, said in a thread or in the supervisor's session: the supervisor records it,
  // the line is the owner's, and the reason is the owner's words, nothing else
  const heard = flags['from-turn'] !== undefined || flags['from-chat'] !== undefined;
  if (heard) {
    if (process.env.DEVTEAM_ROLE !== 'supervisor' || logWriter() !== 'supervisor') die('correct --from-turn or --from-chat: the supervisor records what the owner said; in your own terminal, correct directly');
    if (flags['from-turn'] !== undefined && flags['from-chat'] !== undefined) die('correct: --from-turn or --from-chat, not both');
    for (const k of ['severity', 'impact', 'reason', 'retro']) if (flags[k] !== undefined) die(`correct --${flags['from-turn'] !== undefined ? 'from-turn' : 'from-chat'}: --${k} isn't taken; the reason is the owner's words (--said), and the rest is the owner's own correct`);
    if (!flagStr('said')?.trim()) die('correct --from-turn or --from-chat needs --said "<the owner\'s words>"');
    if (flags['from-chat'] !== undefined && flags.at !== undefined) die('correct --at goes with --from-turn: which match of a repeated clause');
  } else for (const k of ['said', 'at']) if (flags[k] !== undefined) die(`correct --${k} goes with --from-turn or --from-chat`);
  const by = heard ? ownerWriter(null, { heard: true }).by : flags.retro ? (supervisorOnly('correct --retro'), 'supervisor') : ownerWriter().by;
  const act = logGet(actId);
  if (!['act', 'decision'].includes(act?.type)) die(`no decision or act ${actId}`);
  if (act.type === 'act' && act.created_by === 'owner') die(`${actId} is the owner's own record (${act.class}), not a call; nothing to correct`);
  if (act.type === 'act' && act.decision) die(`${actId} carried out ${act.decision}. If the decision was wrong: correct ${act.decision} --reason "…". If it was sound and the act went wrong: problem add --title "…" --severity 0-4 --refs ${actId}${by === 'owner' ? ' --owner' : ''} (a problem, not a trust drop; constitution.md §2)`);
  // On a goal-impact decision the owner gives the goal's impact themselves (--impact): it stands,
  // and they may give another later, so one already corrected takes a new value.
  const impact = flags.impact !== undefined ? flagNum('impact') : undefined;
  if (impact !== undefined) {
    if (act.type !== 'decision' || act.class !== 'goal-impact') die('--impact goes with the correction of a goal-impact decision');
    if (by !== 'owner') die('--impact is the owner\'s: only the owner sets a goal\'s impact when correcting it');
    if (!impactOf(impact)) die('--impact is 1 (housekeeping), 2 (worth having), 3 (moves a number the project watches) or 4 (the project depends on it)');
  }
  // the supervisor's retro alone doesn't stand in the owner's way: the owner corrects it after (spec §5)
  const prior = correctionOf(act);
  if (prior && impact === undefined && !(by === 'owner' && writerClass(prior.by) === 'supervisor' && !act.updates.some((x) => x.corrected !== undefined && writerClass(x.by) === 'owner'))) die(`${actId} is already corrected`);
  let corrected;
  if (flags['from-turn'] !== undefined) {
    const uid = flagStr('from-turn');
    if (!TURN_ID.test(uid ?? '')) die("correct --from-turn <u-id>: the owner's turn whose words correct it");
    const u = logGet(uid);
    if (u?.type !== 'turn') die(`--from-turn ${uid}: no such turn`);
    if (u.created_by !== 'owner') die(`--from-turn ${uid}: that turn is the ${u.created_by}'s; only the owner's words correct a call`);
    const ref = logGet(u.thread)?.subject?.ref ?? null;
    const via = ref?.startsWith('act:') ? logGet(ref.slice(4)) : null;
    if (ref !== `${act.type}:${actId}` && !(via?.type === 'act' && via.decision === actId)) die(`--from-turn ${uid}: that thread is about ${ref ?? 'nothing in particular'}, not ${actId}; the owner's words correct the record the thread is on`);
    const c = turnClause(u.text, flagStr('said'), clauseAt());
    if (c.why) die(`--said: ${c.why}`);
    const clash = turnBindings(readLog().lines, uid).find((b) => spansOverlap(b.span, c.said_at));
    if (clash) die(clash.span ? `--said: those words overlap what already ${clash.kind === 'answer' ? 'settled' : 'corrected'} ${clash.id} (offsets ${clash.span[0]} to ${clash.span[1]}); one span settles one thing` : `--from-turn ${uid}: that turn already settled ${clash.id} whole; it takes no more`);
    corrected = { reason: c.said, said: c.said, said_at: c.said_at, turn: uid };
  } else if (heard) corrected = { reason: flagStr('said').trim(), said: flagStr('said').trim() };
  else corrected = { reason: flagStr('reason') ?? die('correct needs --reason'), severity: flagNum('severity'), impact };
  appendLog({ type: act.type, op: 'set', id: actId, ...(heard ? { channel: flags['from-turn'] !== undefined ? 'thread' : 'chat' } : {}), corrected }, by);
  // the act of a supervisor's reading of the owner's words: the correction voids the reading (the
  // owner's, typed in their own terminal or Inbox) or withdraws it (the supervisor's: at a retro, or
  // the owner's words it recorded from chat or a turn, which its own process writes), so it no
  // longer counts from now on
  const read = act.type === 'act' ? logGet(act.refs?.[0]) : null;
  if (read?.type === 'question' && read.updates.some((u) => u.reading?.act === actId)) {
    const own = by === 'owner' && !heard;
    appendLog({ type: 'question', op: 'set', id: read.id, [own ? 'reading_void' : 'reading_withdrawn']: actId }, own ? 'owner' : 'supervisor');
  }
  if (impact !== undefined) out(`${logGet(act.refs?.[0])?.title ?? act.refs?.[0]}: impact ${impact} (${IMPACT_WORDS[impact]}), set by the owner; it stands until the owner changes it`);
  if (ladder().classes[act.class]) out(`${act.class} drops to rung 1 (ask)`);
  // the supervisor wrote it from the owner's words: nobody to tell
  if (by === 'owner' && !heard) nudgeSupervisor(`[devteam correction from owner] on ${actId}; read it with: devteam.mjs log --id ${actId}`);
  out(`corrected ${actId}`);
}
// The supervisor records how it repaired a corrected act.
export function cmdRepair() {
  const [actId] = positional;
  const how = flagStr('how');
  if (!actId || !['undo', 'fix-ticket', 'none'].includes(how)) die('usage: repair <act-id> --how undo|fix-ticket|none');
  supervisorOnly('repair');
  const act = logGet(actId);
  if (!['act', 'decision'].includes(act?.type) || !correctionOf(act)) die(`${actId} is not a corrected decision or act`);
  appendLog({ type: act.type, op: 'set', id: actId, repaired: how }, 'supervisor');
  out(`repaired ${actId}: ${how}`);
}

// --- observe and orient ---

// Where a record sits in the loop and where an observation came from (schema x-ooda), computed
// when it is read and never stored: `source` and `detector` already mean things every kit reads (a
// sensor's name, repo or prod on a goal reading, detector sensor on the kit's own lines), so a
// rewrite would have an older kit on a mixed fleet misread a newer kit's lines.
export const OODA = SCHEMA['x-ooda'];
// observe, learn, decide, act, orient, measurement or inbox; null for the work graph and conversation.
// An act is always Act, whether or not a decision stands behind it.
export const stageOf = (o) => { const s = Object.hasOwn(OODA.stages, o?.type ?? '') ? OODA.stages[o.type] : null; return !s ? null : typeof s === 'string' ? s : Object.hasOwn(s.kind, o.kind ?? '') ? s.kind[o.kind] : s.kind['*']; };
// The sources each writer may name for itself (observe --source); sensor, metrics and spend are the
// kit's own, read off its own lines, never given. The supervisor records what the owner said (an
// answer, a thread, the chat), but never speaks as the owner.
export const SOURCE_FOR = { ticket: ['worker'], planner: ['planner'], supervisor: OODA.sources.filter((s) => !['sensor', 'metrics', 'spend', 'owner', 'worker', 'planner', 'responder'].includes(s)), owner: ['owner', 'owner-answer', 'owner-thread', 'owner-chat'], responder: ['responder'] };
// An owner-* source on a line someone else wrote is a claim about the owner's words, so it counts
// only when its ref is the record that holds them: an answered question (the owner's answer) for
// owner-answer, the owner's turn or thread for owner-thread, either for owner-chat. A ref that
// doesn't check out reads as its writer's (provenanceOf); observe refuses it.
export function ownerRefHolds(from, ref) {
  const o = ref ? logGet(ref) : null;
  if (!o) return false;
  const answered = o.type === 'question' && questionView(o).status === 'answered';
  // a thread the owner started (kit-108: the supervisor starts its own, which holds none of the owner's words)
  const spoke = (o.type === 'turn' || o.type === 'thread') && o.created_by === 'owner';
  return from === 'owner-answer' ? answered : from === 'owner-thread' ? spoke : from === 'owner-chat' ? answered || spoke : true;
}
// { from, ref }: from in x-ooda.sources, ref which one within it (a sensor's name, a finding's kind,
// a question, a thread, a retro's file). First match wins.
export function provenanceOf(o) {
  if (o?.type !== 'observation') return null;
  const cls = writerClass(o.created_by);
  const ref = o.source_ref ?? null;
  // a set-aside (an ack, a triage ignore) is the call of whoever made it, not the check it sets
  // aside: it falls to its writer below, though an ignore carries detector sensor
  const setAside = ['finding-ack', 'sensor-ignored', 'sensor-unignored', 'sensor-reconsidered'].includes(o.kind);
  // the kit's own lines, as the readers already trust them: a sensor's from the supervisor's process
  // (fromSensor, which also takes a supervisor's hand line, as it always has), the findings pass's
  // and the pane check's from the supervisor alone
  if (!setAside && fromSensor(o)) return { from: 'sensor', ref: o.source ?? null };
  if (!setAside && o.detector === 'metrics' && cls === 'supervisor') return { from: o.kind === 'cost-hotspot' ? 'spend' : 'metrics', ref: o.kind };
  if (o.detector === 'pane' && cls === 'supervisor') return { from: 'metrics', ref: 'pane' };
  // a goal reading (goal reading, by the supervisor or the owner): a repo or prod measure is read like a
  // sensor's; an owner measure is the owner's yes to a goal-met question
  const reading = o.kind === 'reading' && ['owner', 'supervisor'].includes(cls);
  if (reading && ['repo', 'prod'].includes(o.source)) return { from: 'sensor', ref: 'goal-measure' };
  if (reading && o.source === 'owner' && ownerRefHolds('owner-answer', o.approved)) return { from: 'owner-answer', ref: o.approved };
  if (o.kind === 'thread-resolved' && cls === 'owner') return { from: 'owner-thread', ref: o.refs?.[0] ?? null };
  if (o.kind === 'retro' && cls === 'supervisor') return { from: 'retro', ref };
  if (!setAside && (SOURCE_FOR[cls] ?? []).includes(o.source) && (cls === 'owner' || !o.source.startsWith('owner-') || ownerRefHolds(o.source, ref))) return { from: o.source, ref };
  if (cls === 'owner') return { from: o.channel === 'chat' ? 'owner-chat' : o.channel === 'thread' ? 'owner-thread' : 'owner', ref };
  return { from: cls === 'ticket' ? 'worker' : cls, ref };
}
// A record as the views show it: its stage, and an observation's provenance.
export const withOoda = (o) => (o?.type === 'observation' ? { ...o, stage: stageOf(o), provenance: provenanceOf(o) } : { ...o, stage: stageOf(o) });
export function cmdObserve() {
  const by = flags.owner ? ownerWriter().by : logWriter();
  // the sensors write their own lines; a hand-made one could fake an outage or hide an error
  if (flagStr('detector') === 'sensor') die('observe --detector sensor: those lines come from the kit itself (sensor poll); use another detector name');
  const subject = flagStr('subject') ?? die('observe needs --subject (a ticket, component, feature, gate, goal, class or act id)');
  // the kit's own detectors write their own lines: a hand-written one could pass for a poll's
  if (['sensor', 'metrics', 'pane'].includes(flagStr('detector'))) die(`observe --detector ${flagStr('detector')}: those lines come from the kit itself (sensor poll, observe-metrics, the pane check); use another detector name`);
  // --source in the loop's words is the writer's own; older free text is still written as given,
  // and reads as its writer's (provenanceOf)
  const src = flagStr('source');
  if (['sensor', 'metrics', 'spend'].includes(src)) die(`observe --source ${src}: those lines come from the kit itself (sensor poll, observe-metrics, observe-spend)`);
  // a goal's reading (source repo, prod or owner) is the kit's, from goal check or an answer
  if (flagStr('kind') === 'reading' && ['repo', 'prod', 'owner'].includes(src)) die(`observe --kind reading --source ${src}: a goal's readings come from the kit itself (goal check, the owner's answer)`);
  const mine = SOURCE_FOR[writerClass(by)];
  if (OODA.sources.includes(src) && !mine.includes(src)) die(`observe --source ${src}: ${{ ticket: 'a worker', planner: 'a planner', supervisor: 'a supervisor', owner: 'a owner', responder: 'the responder' }[writerClass(by)]}'s observation is from ${mine.join(', ')}`);
  if (writerClass(by) !== 'owner' && String(src).startsWith('owner-') && !ownerRefHolds(src, flagStr('ref'))) die(`observe --source ${src} needs --ref <id> naming where the owner said it: ${src === 'owner-answer' ? 'a question they answered' : src === 'owner-thread' ? 'their turn or the thread' : 'a question they answered, or their turn'}`);
  const line = appendLog({
    type: 'observation', source: flagStr('source') ?? writerClass(by), subject, kind: flagStr('kind') ?? die('observe needs --kind (a slug)'),
    detail: flagStr('detail') ?? die('observe needs --detail'), detector: flagStr('detector'), severity: flagNum('severity'), valence: flagNum('valence'),
    source_key: flagStr('key'), source_ref: flagStr('ref'), refs: asList(flags.refs), fix_hint: flagStr('fix'),
    measure: flagStr('value') !== undefined ? { value: Number(flagStr('value')), unit: flagStr('unit') } : undefined,
  }, by);
  out(line.id);
}
// observe-link: a resource the owner mentioned or the work depends on, for orient to fold into the
// registry. Anyone writes it; only the supervisor's link command changes the registry.
export function cmdObserveLink() {
  const by = flags.owner ? ownerWriter().by : logWriter();
  const url = flagStr('url'), p = flagStr('path');
  if (!url === !p) die('observe-link needs --url <https://…> or --path <repo path>, and --title');
  if (url && !url.startsWith('https://')) die('--url must start with https:// (link add refuses anything else)');
  if (hasCredentials(url)) die(`--url carries credentials; ${CREDENTIALS_REFUSED}`);
  if (unsafeLocator(url) || unsafeLocator(p)) die(`--${url ? 'url' : 'path'} is one token, with no spaces or control characters`);
  if (p && (path.isAbsolute(p) || p.split(/[\\/]/).includes('..'))) die('--path is a path inside this repo (a sibling repo is a repo link, which the owner adds: governance-edit)');
  const title = flagStr('title') ?? die('observe-link needs --title (what it is called)');
  for (const [f, v] of [['title', title], ['notes', flagStr('notes')]]) { const why = linkTextProblem(f, v); if (why) die(`--${why}`); }
  const scopes = flags.for !== undefined ? listFlag('for') : [];
  for (const sc of scopes) if (!scopeValid(sc, 'for')) die(`--for "${sc}" is not a scope (${SCOPE_HELP.for})`);
  const line = appendLog({ type: 'observation', source: writerClass(by), subject: url ?? p, kind: 'link', detail: `${title}${flagStr('notes') ? `: ${flagStr('notes')}` : ''}`, source_key: `link:${url ?? p}`, link: { url, path: p, title, for: scopes.length ? scopes : undefined, notes: flagStr('notes') } }, by);
  out(line.id);
}
export const SEV = { low: 1, medium: 2, high: 3 };
// The most observations a set-aside (an ack, a triage ignore) cites: 40 ids keep its line well under
// LINE_MAX; the finding's key or the fingerprint, in source_ref, joins the rest.
export const SET_ASIDE_REFS = 40;
// A set-aside's refs, the newest kept, trimmed so its line (with the envelope's ~250 bytes) fits LINE_MAX:
// a long reason costs refs, never the line.
export const fitRefs = (fields, refs) => { const r = [...refs]; while (r.length && JSON.stringify({ ...fields, refs: r }).length + 250 > LINE_MAX) r.shift(); return r; };
// Each metrics finding becomes an observation, once a day per finding (deduped on source_key).
export function observeFindings(m) {
  const recent = new Map();
  for (const o of logObjects('observation')) if (o.source_key && o.created_by === 'supervisor' && o.detector === 'metrics') recent.set(o.source_key, Math.max(recent.get(o.source_key) ?? 0, Date.parse(o.created_at)));
  let n = 0;
  for (const f of m.findings) {
    const key = `metrics:${f.kind}:${f.subject}${f.key ? `:${f.key}` : ''}`;
    if (Date.now() - (recent.get(key) ?? 0) < DAY) continue;
    appendLog({ type: 'observation', source: 'metrics', subject: String(f.subject), kind: f.kind, detector: 'metrics', detail: f.detail, severity: f.sev ?? SEV[f.severity] ?? 1, valence: -1, source_key: key, fix_hint: f.suggestion }, 'supervisor');
    n++;
  }
  return n;
}
export async function cmdObserveMetrics() {
  supervisorOnly('observe-metrics');
  // the tick's heartbeat: another machine live on this repo stops the tick here
  const hc = hostCheck();
  if (hc.refused) hostRefusedWhileRunning(hc);
  // one budget for the tick's network: each repo link's main first (what the rest reads), then probes, then each GitHub repo link's open PRs
  const end = Date.now() + (Number(process.env.DEVTEAM_PROBE_BUDGET_MS) || 20000);
  const unfetched = await fetchLinkMains(end);
  const { skipped } = await probeLinks(end);
  const unlisted = await fetchLinkPrs(end);
  const s = observeSpend();
  const learned = writeLearning();
  out(`recorded ${s} spend line(s) and ${observeFindings(collectMetrics(0))} new observation(s)${learned ? `; ${learned} weekly learning record(s)` : ''}${unfetched.length ? `; ${unfetched.length} repo link(s) not fetched this tick (time budget): ${unfetched.join(', ')}` : ''}${unlisted.length ? `; ${unlisted.length} repo link(s) whose open PRs weren't read this tick (time budget): ${unlisted.join(', ')}` : ''}${skipped.length ? `; ${skipped.length} link(s) not probed this tick (time budget): ${skipped.join(', ')}` : ''}`);
  // finished worktrees go, at most every 30 minutes (one line when any did)
  tidyFinishedWorktrees();
  // the hub's cache, again after everything the tick wrote, from the log read afresh, so nothing
  // the tick wrote is newer than it (next-moves)
  logCache = null;
  writeMovesCache();
}
// The tick's fetch of each repo link's main (home's is the tick's own git fetch), four at a time
// inside the tick's budget, so status, metrics and the dashboard read every repo's main as its
// origin has it now, not as some other command last fetched it. Never a prompt (as the probe), and
// never a crash: a fetch that fails is recorded in run/ for metrics to raise as repo-unreachable,
// until a later tick's fetch succeeds. A repo this machine can't read is link-unreachable's.
export const FETCH_FILE = runPath('repo-fetches.json');
export async function fetchLinkMains(end) {
  const ids = Object.entries(loadSettings().links ?? {}).filter(([id, l]) => LINK_KINDS[l?.kind]?.hostsComponents && repoReadable(id)).map(([id]) => id);
  if (!ids.length) return [];
  let state = {};
  try { state = readJson(FETCH_FILE); } catch {}
  const skipped = [];
  const queue = [...ids];
  const one = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      if (Date.now() >= end) { skipped.push(id); continue; }
      const R = repo(id);
      const b = R.settings.main_branch;
      const ssh = process.env.GIT_SSH_COMMAND || R.git(['config', '--get', 'core.sshCommand']) ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' };
      const r = await runProbe({ cmd: 'git', args: ['fetch', '--quiet', 'origin', b], cwd: R.root, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '', ...ssh }, judge: (code) => (code === 0 ? {} : { problem: `could not fetch origin ${b} from ${redactUrl(R.remote)} in ${R.root}; its main here is as last fetched` }) }, end);
      if (r === 'budget') { skipped.push(id); continue; }
      state[id] = { at: nowIso(), problem: r.problem ?? null };
      // a repo whose releases are kept (maintain.releases) also gets its release tags, which a
      // fetch of one branch doesn't bring, so a release cut elsewhere clears release-due; never
      // forced, so a local tag that differs stays as it is
      if (!r.problem && linkMaintains(loadSettings().links?.[id], 'releases') && Date.now() < end) await runProbe({ cmd: 'git', args: ['fetch', '--quiet', '--no-tags', 'origin', 'refs/tags/v*:refs/tags/v*'], cwd: R.root, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '', ...ssh }, judge: () => ({}) }, end);
      if (!r.problem) R.resetCaches();
    }
  };
  await Promise.all(Array.from({ length: Math.min(PROBE_AT_ONCE, ids.length) }, one));
  for (const id of Object.keys(state)) if (!ids.includes(id)) delete state[id];
  writeJson(FETCH_FILE, state);
  return skipped;
}
// The open PRs on each GitHub repo link that aren't the fleet's own (ticket/, plan/, chore- branches
// in the repo itself land through merge and their records; a fork's branch of that name is an outside PR), read with gh inside the tick's budget, so metrics can say
// when one waits unreviewed or with findings its author never saw (pr-unreviewed,
// pr-changes-unanswered) without touching the network. A good read is reused for
// LINK_PRS_REUSE_MS (under the findings' 15 min). A failed read (gh missing, logged out, offline, a
// query GitHub refuses) keeps the last PRs but marks the entry failing, with when it started and
// gh's first line, so metrics raises no PR finding from stale data and says (link-prs-unread) when
// reads have failed for LINK_PRS_UNREAD_HOURS. Kept per PR: its head, when that head was first seen
// (the PR's updatedAt, which a push moves, when the head is new to us: never later than the push
// is old, so never a false stall), the forge's reviews of that head and when it was last commented
// on, leaving out bots. The query asks for no `commits`: gh's commits field nests authors under
// commits under PRs and GitHub refuses it for its node count.
export const LINK_PRS_FILE = runPath('link-prs.json');
export const LINK_PRS_REUSE_MS = 10 * 60000;
export const LINK_PRS_UNREAD_HOURS = 6;
// a read older than this raises no PR finding: about two ticks, so findings counted in minutes
// never come from a read the tick's budget kept from refreshing for longer than that
export const LINK_PRS_MAX_AGE_MS = 30 * 60000;
export const FLEET_BRANCH = /^(ticket\/|plan\/|chore-)/;
// gh's GraphQL logins drop the [bot] suffix an app has on the REST API, so the common apps are named too
export const BOT_LOGIN = /\[bot\]$|^(github-actions|copilot-pull-request-reviewer|copilot|dependabot|renovate|vercel|vercel-fleet-prod|netlify|coderabbitai|chatgpt-codex-connector|codecov|sonarcloud|sonarqubecloud|changeset-bot|linear|cursor|gemini-code-assist|sourcery-ai|deepsource-io|snyk-io|socket-security|mergify|graphite-app|pre-commit-ci)$/i;
// gh asks for a PR's first 100 reviews and comments, the oldest: at 100 the newest may be missing
export const LINK_PR_PAGE = 100;
export const linkPrRepos = (s = loadSettings()) => Object.entries(s.links ?? {}).filter(([, l]) => LINK_KINDS[l?.kind]?.hostsComponents && linkMaintains(l, 'prs') && LINK_KINDS[l.kind].effectiveSettings(l, s).forge === 'github' && ghSpec(l.remote)).map(([id, l]) => [id, ghSpec(l.remote)]);
export const trimLinkPr = (p, before) => {
  const head = p.headRefOid;
  const human = (x) => !BOT_LOGIN.test(String(x?.author?.login ?? ''));
  const times = (xs, k) => (xs ?? []).filter(human).map((x) => Date.parse(x?.[k])).filter((t) => !Number.isNaN(t));
  const seen = before && before.head === head && before.head_at ? before.head_at : (() => { const t = Math.max(Date.parse(p.createdAt) || 0, Date.parse(p.updatedAt) || 0); return t ? new Date(t).toISOString() : null; })();
  return {
    number: p.number, title: String(p.title ?? '').slice(0, 200), url: p.url ?? null, head, branch: p.headRefName ?? null,
    head_at: seen,
    // its reviews or comments ran past one page: what's newest may be missing, so nothing is claimed about it
    truncated: (p.reviews?.length ?? 0) >= LINK_PR_PAGE || (p.comments?.length ?? 0) >= LINK_PR_PAGE,
    forge_reviews: (p.reviews ?? []).filter((r) => human(r) && r?.commit?.oid === head).map((r) => ({ state: r.state ?? null, at: r.submittedAt ?? null })),
    last_comment_at: (() => { const t = Math.max(0, ...times(p.comments, 'createdAt'), ...times(p.reviews, 'submittedAt')); return t ? new Date(t).toISOString() : null; })(),
  };
};
export async function fetchLinkPrs(end) {
  const repos = linkPrRepos();
  let state = {};
  try { state = readJson(LINK_PRS_FILE); } catch {}
  if (state === null || typeof state !== 'object' || Array.isArray(state)) state = {};
  const skipped = [];
  const queue = repos.filter(([id]) => { const e = ownEntry(state, id); return !(e && !e.failing_since && Date.now() - Date.parse(e.at) < LINK_PRS_REUSE_MS); });
  const one = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [id, spec] = next;
      if (Date.now() >= end) { skipped.push(id); continue; }
      const r = await runProbe({ cmd: 'gh', args: ['pr', 'list', '-R', spec, '--state', 'open', '--limit', '100', '--json', 'number,title,url,headRefName,headRefOid,isCrossRepository,isDraft,createdAt,updatedAt,reviews,comments'], cwd: mainRoot, env: { ...process.env, GH_PROMPT_DISABLED: '1' }, stderr: true, judge: (code, text, err = '') => {
        const why = () => (String(err).split('\n').map((x) => x.trim()).find(Boolean) ?? (code == null ? 'gh did not run or timed out' : `gh exited ${code}`)).slice(0, 300);
        if (code !== 0) return { error: why() };
        try { const list = JSON.parse(text); return Array.isArray(list) ? { list } : { error: 'gh printed no PR list' }; } catch { return { error: 'gh printed no PR list' }; }
      } }, end);
      if (r === 'budget') { skipped.push(id); continue; }
      const prev = ownEntry(state, id);
      if (r.error) { state[id] = { ...(prev ?? {}), failing_since: prev?.failing_since ?? nowIso(), failed_at: nowIso(), error: r.error }; continue; }
      const before = new Map((Array.isArray(prev?.prs) ? prev.prs : []).map((p) => [p?.number, p]));
      state[id] = { at: nowIso(), prs: r.list.filter((p) => p && !p.isDraft && !(p.isCrossRepository !== true && FLEET_BRANCH.test(p.headRefName ?? ''))).map((p) => trimLinkPr(p, before.get(p.number))) };
    }
  };
  if (queue.length) await Promise.all(Array.from({ length: Math.min(PROBE_AT_ONCE, queue.length) }, one));
  for (const id of Object.keys(state)) if (!repos.some(([r]) => r === id)) delete state[id];
  if (repos.length || fs.existsSync(LINK_PRS_FILE)) writeJson(LINK_PRS_FILE, state);
  return skipped;
}
