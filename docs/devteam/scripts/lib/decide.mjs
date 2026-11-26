/* imports start */
import fs from 'node:fs';
import { BROWSER_KEY } from './browser.mjs';
import { CREDENTIALS_REFUSED } from './links.mjs';
import { DECLINING_LABEL } from './log-sync.mjs';
import { FILES_TOO_LONG } from './hub/operator.mjs';
import { GOAL_CHANGE_FIELDS } from './log-sync.mjs';
import { GOAL_MET_CHOICES } from './goals.mjs';
import { LINE_MAX } from './log.mjs';
import { LINK_ID } from './links.mjs';
import { LINK_KINDS } from './links.mjs';
import { MAX_SECRETS } from './secrets.mjs';
import { MEASURE_SOURCES } from './goals.mjs';
import { OUTCOME_MAX } from './threads.mjs';
import { OWNER_ACTS } from './links.mjs';
import { PREVIEW_NAME } from './previews.mjs';
import { RUNG } from './links.mjs';
import { SCHEMA } from './log.mjs';
import { TURN_ID } from './threads.mjs';
import { UNSAFE_TEXT } from './links.mjs';
import { UNSAFE_TEXT_ALL } from './links.mjs';
import { acceptReviewResult } from './artifact-notes.mjs';
import { activeTickets } from './graph.mjs';
import { allArtifacts } from './artifact-notes.mjs';
import { allowedCommand } from './secrets.mjs';
import { appendLog } from './log-sync.mjs';
import { artifactLinksMoved } from './log-sync.mjs';
import { asList } from './base.mjs';
import { blocksOpenIncident } from './questions.mjs';
import { byTime } from './log-sync.mjs';
import { calls } from './log-sync.mjs';
import { canonical } from './settings.mjs';
import { capBytes } from './threads.mjs';
import { capBytes300 } from './observe.mjs';
import { checkLine } from './log.mjs';
import { citing } from './questions.mjs';
import { declinedSensors } from './sensors.mjs';
import { defaultGap } from './questions.mjs';
import { die } from './base.mjs';
import { droppedPaths } from './sessions.mjs';
import { droppedWords } from './sessions.mjs';
import { escRe } from './graph.mjs';
import { filesFlag } from './hub/operator.mjs';
import { flagNum } from './base.mjs';
import { flagStr } from './base.mjs';
import { flags } from './base.mjs';
import { forecastText } from './goals.mjs';
import { git } from './base.mjs';
import { goalAtTarget } from './goals.mjs';
import { goalCheck } from './goals.mjs';
import { goalForecast } from './goals.mjs';
import { goalMetApply } from './goals.mjs';
import { goalMetBasis } from './goals.mjs';
import { goalMetPlan } from './goals.mjs';
import { goalMetReadingWords } from './goals.mjs';
import { goalMetWording } from './goals.mjs';
import { goalOrderRefusal } from './log-sync.mjs';
import { goalReadings } from './goals.mjs';
import { hasCredentials } from './links.mjs';
import { inboxRanks } from './questions.mjs';
import { incidentSeverity } from './sensors.mjs';
import { isDoorQuestion } from './log-sync.mjs';
import { isIncident } from './sensors.mjs';
import { isObj } from './artifact-notes.mjs';
import { jsonDuplicateKeys } from './settings.mjs';
import { ladder } from './links.mjs';
import { lineFits } from './log-sync.mjs';
import { linkAnswerCovers } from './settings.mjs';
import { linkFieldChanges } from './settings.mjs';
import { linkFields } from './links.mjs';
import { listFlag } from './base.mjs';
import { loadSettings } from './settings.mjs';
import { logCache } from './log-sync.mjs';
import { logFileFor } from './log.mjs';
import { logGet } from './log-sync.mjs';
import { logLineFor } from './log-sync.mjs';
import { logObjects } from './log-sync.mjs';
import { logWriter } from './log.mjs';
import { mainRef } from './log.mjs';
import { mainSettings } from './reviews.mjs';
import { markThreadWorking } from './threads.mjs';
import { measureOf } from './goals.mjs';
import { mergeShaFor } from './repos.mjs';
import { migrationsSince } from './remediation.mjs';
import { nowIso } from './base.mjs';
import { nudgeSupervisor } from './sessions.mjs';
import { out } from './base.mjs';
import { ownEntry } from './artifact-notes.mjs';
import { ownerChannel } from './log.mjs';
import { ownerWriter } from './log.mjs';
import { ownersKind } from './settings.mjs';
import { parseSink } from './secrets.mjs';
import { pinReview } from './artifact-notes.mjs';
import { plural } from './questions.mjs';
import { positional } from './base.mjs';
import { projectInRepo } from './settings.mjs';
import { questionAbout } from './questions.mjs';
import { questionView } from './log-sync.mjs';
import { questions } from './log-sync.mjs';
import { quoteData } from './links.mjs';
import { readLog } from './log-sync.mjs';
import { readPreviews } from './previews.mjs';
import { recurringEntryProblems } from './recurring.mjs';
import { recurringRegistry } from './recurring.mjs';
import { redactClaimLinks } from './log-sync.mjs';
import { redactUrl } from './links.mjs';
import { registryAttestText } from './goals.mjs';
import { registryProblems } from './links.mjs';
import { releasesOnMerge } from './sensors.mjs';
import { remediationDenied } from './remediation.mjs';
import { remediationDeniedWords } from './remediation.mjs';
import { remediationEntryHash } from './remediation.mjs';
import { remediationHold } from './remediation.mjs';
import { remediationHoldWords } from './remediation.mjs';
import { remediationOf } from './remediation.mjs';
import { repoOfTicketLink } from './repos.mjs';
import { rest } from './base.mjs';
import { reviewDraftFile } from './lens.mjs';
import { rungFor } from './trust.mjs';
import { sameAnswer } from './questions.mjs';
import { searchIndex } from './observe.mjs';
import { searchSimilar } from './observe.mjs';
import { sevScope } from './sensors.mjs';
import { sharesWork } from './questions.mjs';
import { shq } from './scores.mjs';
import { subjectIds } from './threads.mjs';
import { supervisorOnly } from './log.mjs';
import { textOf } from './observe.mjs';
import { threadViews } from './threads.mjs';
import { tickets } from './graph.mjs';
import { trustEvidence } from './trust.mjs';
import { upkeepAllows } from './goals.mjs';
import { warn } from './base.mjs';
import { worldFileFails } from './pr-checks.mjs';
import { writerClass } from './log.mjs';
/* imports end */
export function openQuestion(id, okStatuses = ['open']) {
  const q = logGet(id);
  if (!q || q.type !== 'question') die(`no question ${id}`);
  const v = questionView(q);
  if (!okStatuses.includes(v.status)) die(`${id} is already ${v.status}`);
  return v;
}

// A flag whose value is JSON (`--choices '[…]'`); undefined when absent.
export function jsonFlag(name) {
  const v = flagStr(name);
  if (v === undefined) return undefined;
  try { return JSON.parse(v); } catch (e) { return die(`--${name} is not valid JSON: ${e.message}`); }
}
// --change '{…}': the exact goal fields a goal-change question proposes; required for one about a goal.
export function goalChangeFlag(cls) {
  const c = jsonFlag('change');
  if (c === undefined) {
    if (cls === 'goal-change' && flagStr('goal')) die('a goal-change question about a goal says the exact change: --change \'{"milestones": […]}\' (its answer authorises that and nothing else)');
    return undefined;
  }
  if (cls !== 'goal-change' || !flagStr('goal')) die('--change belongs on a goal-change question with --goal');
  const bad = Object.keys(c).filter((k) => !GOAL_CHANGE_FIELDS.includes(k));
  if (!Object.keys(c).length || bad.length) die(`--change sets goal fields (${GOAL_CHANGE_FIELDS.join(', ')})${bad.length ? `; not ${bad.join(', ')}` : ''}`);
  return c;
}
// --order '["g-…",…]': the goal order a goal-change question proposes, about no one goal (its
// answer authorises goal order --approved, exactly that order); undefined when absent.
export function goalOrderFlag(cls) {
  const o = jsonFlag('order');
  if (o === undefined) return undefined;
  if (cls !== 'goal-change') die('--order belongs on a goal-change question (--class goal-change)');
  if (flagStr('goal') !== undefined) die('--order proposes the order of several goals: it takes no --goal (the order names its goals)');
  if (flagStr('change') !== undefined) die('--order is the whole change: it takes no --change');
  if (!Array.isArray(o) || o.some((x) => typeof x !== 'string')) die('--order is a JSON list of goal ids: \'["g-…","g-…"]\'');
  if (o.length < 2) die('--order puts at least two goals in order; one goal\'s priority is a goal-change with --goal and --change');
  const why = goalOrderRefusal(o, readLog().byType.get('goal') ?? []);
  if (why) die(`--order: ${why}`);
  if (String(ownerText(flagStr('context')) ?? '').includes('The order proposed:')) die('--order: the kit writes "The order proposed:" itself, from the order; leave it out of --context');
  if (!flagStr('recommendation')?.trim()) die('a goal-change --order question recommends the order (--recommendation "Yes, this order"): only the owner\'s answer with it approves');
  return o;
}
// The order in the owner's words, written into the question's context (which its hash covers).
// Each title on one line: a title can't add lines (or a list of its own) to what the owner reads.
export const goalOrderText = (ids, titleOf = (id) => logGet(id)?.title ?? id) => ['The order proposed:', ...ids.map((id, i) => `${i + 1}. ${String(titleOf(id)).replace(/\s+/g, ' ').trim()} (${id})`), 'Goals left out keep their order after these.'].join('\n');
// --stake and --urgency on ask and rate: 1, 2 or 3 each; undefined when not given.
export function ratingFlags() {
  const r = {};
  for (const k of ['stake', 'urgency']) {
    if (flags[k] === undefined) continue;
    r[k] = flagNum(k);
    if (![1, 2, 3].includes(r[k])) die(`--${k} is 1, 2 or 3 (supervisor.md §6)`);
  }
  return r;
}
export const idsFlag = (k) => [...new Set(asList(flags[k]).flatMap((x) => String(x).split(',')).map((x) => x.trim()).filter(Boolean))];
// What ask and rate check before a question says it settles others. settles is the whole list it
// would carry, added the ids new on this line, self the question's own id (null when new).
export function settleChecks({ self, kind, stake, settles, added, settlesIf, choices, about }) {
  if (!settles.length) return;
  if (['review', 'owner-action', 'goal-approval', 'trust'].includes(kind)) die(`a ${kind} question settles no others: --settles is for a decision whose answer makes other questions unnecessary`);
  if (stake !== 3) die('a question that settles others is one the work turns on: --stake 3 (supervisor.md §6)');
  if (!settlesIf) die('--settles needs --settles-if "<the answer that settles them>"');
  if ((choices ?? []).length && !choices.some((c) => sameAnswer(c.label, settlesIf))) die(`--settles-if "${settlesIf}" is none of the choices (${choices.map((c) => c.label).join(', ')})`);
  if (settles.length > 20) die('--settles names at most 20 questions');
  const all = new Map(logObjects('question').map((x) => [x.id, x]));
  for (const id of added) {
    if (id === self) die(`--settles ${id}: a question can't settle itself`);
    const x = all.get(id);
    if (!x) die(`--settles ${id}: no such question`);
    const v = questionView(x);
    if (v.status !== 'open') die(`--settles ${id}: it is already ${v.status}`);
    if (!sharesWork(about, questionAbout(v))) die(`--settles ${id}: it is about another goal or feature; a question settles only questions about its own (name the goal on both with --goal, or the ticket)`);
    // a cycle: the question it would settle already settles this one, directly or through others
    const seen = new Set();
    const reaches = (y) => y === self || (!seen.has(y) && (seen.add(y), (all.get(y)?.settles ?? []).some(reaches)));
    if (self && reaches(id)) die(`--settles ${id}: ${id} already settles ${self}; two questions can't settle each other`);
  }
}
// A rating the kit will count for less than it says, or that contradicts the question: said once, on stderr.
export function ratingWarnings({ stake, urgency, blocks, def }) {
  if (urgency === 3 && !def && !(blocks ?? []).some((b) => activeTickets().has(b) && !mergeShaFor(b)) && !blocksOpenIncident(blocks)) warn('urgency 3 says work is stopped on it now: it counts as 3 only while --blocks names a ticket that is waiting or an open incident, or the question has a default; this one counts as 2');
  if (stake === 3 && def) warn('a question the work turns on (stake 3) shouldn\'t go ahead by default');
}
export function cmdAsk() { out(askLine().id); }
// Every check and refusal ask makes, and the line it writes. thread ask calls it with the thread the
// question is asked in; nothing else about the question differs.
// Before a question goes to the owner: standing rules and earlier answers that look like it, on
// stderr. Alike means the rule or question has 60% of this one's words, and a third of the score
// this one would get against itself (on a small project, words only this one has weigh most). A
// rule the owner gave for this class settles it (decide --approved k-…); any other rule,
// and every earlier answer, is for the recommendation and approves nothing. The kit's own wordings
// (goal-met, registry attestations, reviews, goal approvals) are alike by design and skipped.
export const KIT_WORDED = (cls, kind) => ['goal-met', 'registry-attest'].includes(cls) || ['review', 'goal-approval'].includes(kind);
// A decision the owner has made is never put to them again (supervisor.md §6): ask refuses a
// question as close as those above to one the owner answered (their own line, bound to the question
// as asked; never a default or an open one) about the same work: a ticket or incident both name, or
// the same goal or feature, and neither about other tickets; or neither about any work at all.
// --new-because says what materially changed, and the owner reads it first. Not for the questions
// whose answers lapse by design (a trust step's evidence, an incident's fix, a remediation's window,
// a sensor's token, asked again only after the owner's own sensor reconsider),
// nor for the kit's own wordings, nor for an answer already spent: one answer approves one call (one
// per item it approves), so a yes that approved its call can't be cited again, and the next call of
// the kind is a new question (the warning below still shows the earlier answer). A one-way door is
// never spent: it covers each plan inside it.
export const REASK_EXEMPT = (cls, kind) => KIT_WORDED(cls, kind) || !['owner-decision', 'one-way-door', 'owner-action'].includes(kind) || ['incident-fix', 'production-remediation'].includes(cls);
// An answer settles a question in its own class (an answer in another class can't be cited for this
// one: the kit refuses it, so asking in the right class is no re-ask), or a one-way door's answer
// settles a door asked again in any shape: what the owner was re-asked here.
export const settlesClass = (v, cls, kind) => (v.class ?? null) === (cls ?? null) || (isDoorQuestion(v) && (isDoorQuestion({ kind, class: cls }) || !cls || cls === 'approve-plan'));
export function sameWork(a, b) {
  // a request for secrets is about what it asks for: the same secret to the same place, or not the same
  const sinks = (x) => (x.secrets ?? []).map((y) => `${y.name}\n${y.sink}`);
  if (sinks(a).length || sinks(b).length) return sinks(a).some((y) => sinks(b).includes(y));
  // a question pinned to a text (a draft's blob, an artifact's hash) is about that text: a new draft is a new decision
  const pins = (x) => ((x.id ? logGet(x.id)?.links : x.links) ?? []).filter(isObj).map((l) => l.blob ?? l.sha256).filter(Boolean);
  if (pins(a).length || pins(b).length) { if (!pins(a).some((y) => pins(b).includes(y))) return false; }
  const ta = [a.ticket, ...(a.blocks ?? [])].filter(Boolean);
  const tb = [b.ticket, ...(b.blocks ?? [])].filter(Boolean);
  if (ta.some((x) => tb.includes(x))) return true;
  // about two different tickets: two decisions (a question that only blocks a ticket may still be the goal's)
  if (a.ticket && b.ticket) return false;
  if (!ta.length && !tb.length && !a.goal && !b.goal) return true;
  if (a.goal && a.goal === b.goal) return true;
  return sharesWork(questionAbout(a), questionAbout(b));
}
// The search above finds questions alike enough to mention; a refusal needs more: the two questions
// themselves (not their context) share most of their words, every word counted whole ("v0.3.0" and
// "v0.4.0", "UK" and "US" differ), only the glue words left out.
export const REASK_GLUE = new Set(['a', 'an', 'the', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'at', 'is', 'it', 'be', 'we', 'i', 'you', 'should', 'would', 'could', 'can', 'do', 'does', 'shall', 'will', 'please', 'this', 'that']);
export const questionWords = (t) => new Set((String(t ?? '').toLowerCase().match(/[\p{L}\p{N}]+(?:[.'’-][\p{L}\p{N}]+)*/gu) ?? []).filter((w) => !REASK_GLUE.has(w)));
export function nearlySameQuestion(a, b) {
  const x = questionWords(a);
  const y = questionWords(b);
  if (!x.size || !y.size) return false;
  const both = [...x].filter((w) => y.has(w)).length;
  return both / (x.size + y.size - both) >= 0.7;
}
export function answerSpent(v) {
  if (isDoorQuestion(v)) return false;
  // a goal change records its answer on the goal line, not as a call
  if (logObjects('goal').some((g) => g.updates.some((u) => u.approved === v.id))) return true;
  const used = calls().filter((c) => c.approved_by === v.id);
  const declared = v.approves ?? [];
  if (!declared.length) return used.length > 0;
  const done = new Set(used.flatMap((c) => (c.refs ?? []).flatMap((x) => String(x).split(','))));
  return declared.every((a) => done.has(a));
}
export function reaskWords(v) {
  const door = isDoorQuestion(v);
  const cite = v.in_words && !v.reading ? `they answered in their own words; read them (answer ${v.id} --read "<label>" --cite "<their words>" --class ${v.class ?? v.kind}) or ask back in its thread` : v.recommendation && v.matched === false && !door ? `they answered other than your recommendation, and that is their decision; act on it, and use it in your recommendations` : `cite the answer instead (--approved ${v.id} on decide or act${door ? `; for a plan under it, act --class approve-plan --approved ${v.id}, and when it was asked for the goal, "- Goal-level door: ${v.id} covers this plan" in the plan review` : ''})`;
  return `the owner already decided this: ${v.id} ${quoteData(capBytes300(v.question))} (answered ${quoteData(capBytes300(v.answer))} on ${String(v.answered_at).slice(0, 10)}). Never ask the owner a decision they have made: ${cite}. If something material changed since, ask again with --new-because "<what changed>", which the owner reads first (supervisor.md §6)`;
}
// Returns the --new-because to record: left off when nothing the owner answered is like this.
export function askLikeWarnings({ text, question, cls, kind, about, newBecause }) {
  if (!text.trim() || KIT_WORDED(cls, kind)) return newBecause;
  const rules = logObjects('knowledge').filter((k) => k.status === 'accepted' && k.kind === 'preference');
  const answered = questions().filter((x) => x.status === 'answered' && x.answer && !KIT_WORDED(x.class, x.kind));
  const docs = [...rules.map((k) => ({ id: k.id, rule: k, fields: [{ text: k.statement }] })), ...answered.map((x) => ({ id: x.id, q: x, fields: [{ text: textOf(x.question, x.context, x.recommendation, (x.choices ?? []).map((c) => c?.label)) }] }))];
  if (!docs.length) return newBecause ? (warn('--new-because is for asking again a decision the owner made; nothing they answered is that decision, so it is left off'), null) : newBecause;
  const ix = searchIndex(docs);
  const close = ix.docs.map((d) => ({ d, ...searchSimilar(ix, text, d) })).filter((c) => c.coverage >= 0.6 && c.ratio >= 0.3).sort((a, b) => b.ratio - a.ratio);
  const line = (s) => quoteData(capBytes300(s));
  const reaskable = (k, secrets) => !(k === 'owner-action' && !(secrets ?? []).length);
  const like = (c) => c.d.q && c.d.q.answered_by === 'owner' && !REASK_EXEMPT(c.d.q.class, c.d.q.kind) && reaskable(c.d.q.kind, c.d.q.secrets) && settlesClass(c.d.q, cls, kind) && nearlySameQuestion(question, c.d.q.question) && sameWork(about, c.d.q) && !answerSpent(c.d.q);
  const same = close.find(like);
  if (same && !REASK_EXEMPT(cls, kind) && !about.sensor && reaskable(kind, about.secrets) && !newBecause) die(reaskWords(same.d.q));
  // asked again: the owner reads why only on a question that asks again what they decided
  if (newBecause && !same) { warn('--new-because is for asking again a decision the owner made; nothing they answered is that decision, so it is left off'); newBecause = null; }
  for (const c of close.filter((x) => x.d.rule).slice(0, 3)) {
    const k = c.d.rule;
    if (cls && writerClass(k.created_by) === 'owner' && k.scope === `class:${cls}`) warn(`a standing rule may settle this: ${k.id} ${line(k.statement)}. If it does, withdraw this question and cite it (--approved ${k.id})`);
    else warn(`an accepted rule may bear on this: ${k.id} ${line(k.statement)}. It approves nothing here; use it in your recommendation`);
  }
  // An answered one-way door covers each plan inside it, whatever kind it was asked as: cited, never asked again.
  for (const c of close.filter((x) => x.d.q).slice(0, 3)) {
    if (isDoorQuestion(c.d.q)) warn(`the owner answered a similar one-way door before: ${c.d.q.id} ${line(c.d.q.question)} (answer: ${line(c.d.q.answer)}). If it covers this decision, withdraw this and cite it, never ask it again (supervisor.md §6): act --class approve-plan --approved ${c.d.q.id}, with "- Goal-level door: ${c.d.q.id} covers this plan" in the plan review when it was asked for the goal`);
    else warn(`the owner answered a similar question before: ${c.d.q.id} ${line(c.d.q.question)} (answer: ${line(c.d.q.answer)}). If it was this very call and that answer is unused, withdraw this and cite it (--approved ${c.d.q.id}); otherwise it approves nothing here, so use it in your recommendation`);
  }
  return newBecause;
}
// Text the owner reads: a literal "\n" typed in a shell argument becomes a line break, so lists and
// paragraphs reach the dashboard as written (supervisor.md §6). Only where it can't be anything else:
// text that already has real line breaks is left alone, and so are `code`, a Windows path
// (C:\new\node_modules) and an escaped backslash (\\n).
export const ownerText = (t) => (t == null || String(t).includes('\n') ? t : String(t).split(/(`[^`]*`|\b[A-Za-z]:\\\S*)/).map((p, i) => (i % 2 ? p : p.replace(/(?<!\\)\\n/g, '\n'))).join(''));
// The owner reads every question cold, on the dashboard, without the fleet's context or its words
// (supervisor.md §6, Ask less, act more). What ask refuses, and what it warns about.
// A question about asking the owner: "should I ask you for…", "want me to request access?", "is it ok
// to ask for the key?". Asking someone else ("should I ask the vendor for a refund?", "request a key
// from Stripe?") or a product's own prompt ("should the app request access to contacts?") is not one.
export const OWNER_GIVES = String.raw`(?:access|permissions?|logins?|keys?|tokens?|secrets?|certificates?|passwords?|passphrases?|credentials?|env(?:ironment)?[ _-]?var(?:iable)?s?|\.env)`;
// Someone other than the owner, before the verb ("let users request access", "require customers to
// ask for access") or between it and the thing asked for: a question about the product, not about
// asking the owner. And "ask you to <do something> each time / from now on" is about the owner's part
// in the process, not whether to ask them once.
export const THIRD_PARTY = String.raw`(?:users?|customers?|clients?|members?|people|visitors?|guests?|admins?|them|they|anyone|everyone|someone)`;
export const NOT_THIRD = (n) => String.raw`(?:(?!\b${THIRD_PARTY}\b)[^?.]){0,${n}}?`;
export const META_ASK = new RegExp(String.raw`\b(?:should|shall|can|may|could|might|want|need|do you mind|would you (?:like|mind|prefer)|is it (?:ok(?:ay)?|fine|all ?right)|are you (?:ok(?:ay)?|fine|happy) (?:with|for)|would it (?:help|be (?:ok(?:ay)?|useful|helpful|better))|does it make sense)\b${NOT_THIRD(40)}(?:\b(?:i|we|me|us)\b${NOT_THIRD(24)}|\bto\s+)\b(?:ask(?:ing|ed)?|request(?:ing|ed)?|prompt(?:ing|ed)?)\s+(?:you\b(?!\s+to\s+(?!(?:share|send|give|provide|paste|post|supply|set|add|grant|create|generate|upload)\b)[^?.]*\b(?:each|every|always|from now on|going forward|in (?:the )?future|as well)\b)|(?:for\s+)?(?:(?:the|a|an|your|some|more|those|these|that|this)\s+)?(?:(?!${THIRD_PARTY}\b)[\w.-]+\s+){0,2}?${OWNER_GIVES}\b(?!\s+(?:from|of)\s+(?!you\b)))`, 'i');
export const CRED_WORDS = /\b(?:passwords?|passphrases?|api[ _-]?keys?|access[ _-]?keys?|secret[ _-]?keys?|private[ _-]?keys?|(?:auth|access|api|bearer|personal access) tokens?|credentials?|env(?:ironment)?[ _-]?var(?:iable)?s?|\.env\b)/i;
export const KIT_ID = /\b(?:q|[gkapmodt])-\d{8}-\d{9}-[a-z0-9]+(?:-[a-z0-9]+)*/;
// A credential asked for in a decision's words ("can you share the staging password?", "may I have
// the API key?"): the owner would have to type it into an answer. It is an owner-action with --secrets.
export const CRED_REQUEST = new RegExp(String.raw`\b(?:(?:share|send|give|provide|paste|post|supply)\s+(?:me|us)\b\s*(?:with\s+)?(?:(?:the|a|an|your|our|that|those)\s+)?|(?:(?:can|could|will|would) you|please|do you want to|would you like to|i need you to)\s+(?:\w+\s+){0,2}?(?:share|send|give|provide|paste|post|supply)\s+(?:the|a|an|your|that|those)\s+|(?:may|can|could) (?:i|we) (?:have|get)\s+(?:(?:the|a|an|your|that|those)\s+)?)(?:[\w.-]+\s+){0,3}?${CRED_WORDS.source}(?!\s+from\s+(?!you\b))`, 'i');
// "dry-run/staging" is the project's; run/… on its own is the kit's folder
export const KIT_WORDS = /\b(?:rungs?|trust ladder|worktrees?|secret sinks?|devteam\.mjs|DEVTEAM_[A-Z_]+|(?<![\w/-])run\/[\w./-]+)\b/i;
export function askPlainChecks({ q, context, kind, cls, secrets, reasons, confidence, recommendation, L }) {
  if (!q || KIT_WORDED(cls, kind)) return;
  if (META_ASK.test(q)) die(`don't ask whether to ask: ask for the thing itself. A credential, key or password is an owner-action with --secrets naming it, so the owner gets the paste box at once (supervisor.md §6, Ask less, act more)`);
  if (!secrets?.length && kind !== 'owner-action' && CRED_REQUEST.test(q)) die(`don't ask for a credential in a decision's words: the owner would have to type it into an answer. Ask with --kind owner-action and --secrets naming each one and where it goes, so the owner gets the paste box at once (supervisor.md §6, Secrets)`);
  if (KIT_ID.test(q)) die(`the question names a kit id (${q.match(KIT_ID)[0]}): the owner doesn't know it. Say what it is in words; a link or --refs carries the id`);
  const tid = [...tickets().keys()].find((t) => new RegExp(`(?<![\\w-])${escRe(t)}(?![\\w-])`, 'i').test(q));
  if (tid) die(`the question names the ticket ${tid}: the owner doesn't know it by its id. Say what it is in words; --ticket or a link carries the id`);
  // --plain-ok <word>…: the question is about that very thing (a git worktree, the trust ladder
  // itself), so that word may stay. Only the words named; ids, asking about asking and credentials
  // never pass.
  // a word and its plural are one word: --plain-ok worktree covers "worktrees"
  const stem = (w) => String(w).toLowerCase().replace(/s$/, '');
  const plainOk = new Set(asList(flags['plain-ok']).map(stem));
  const classes = [...Object.keys(L.classes ?? {}), ...(L.owner_only ?? []), ...(L.constitutional ?? [])];
  const cw = classes.find((c) => c.includes('-') && !plainOk.has(stem(c)) && new RegExp(`\\b${c.replace(/[-]/g, '\\-')}\\b`).test(q));
  if (cw) die(`the question says "${cw}", a class name the owner doesn't use. Say in plain words what is being decided; --class carries it (if the question is about that class itself, --plain-ok ${cw})`);
  const jw = [...q.matchAll(new RegExp(KIT_WORDS.source, 'gi'))].map((m) => m[0]).find((w) => !plainOk.has(stem(w)));
  if (jw) die(`the question uses the kit's own word "${jw}". Ask it as you would a person who has never seen the fleet; the dashboard shows the kit's details itself. If the question is about that very thing, keep the word and say so: --plain-ok ${shq(stem(jw))}`);
  if (plainOk.size) warn(`--plain-ok ${[...plainOk].join(' ')}: the owner reads those words as they are, so make sure the question explains them`);
  if (q.length > 300) die(`the question is ${q.length} characters: lead with the decision in one or two sentences (300 at most) and put the rest in --context, as a list where it is one`);
  if (context && KIT_ID.test(context)) warn(`--context names a kit id (${context.match(KIT_ID)[0]}): fine as a link, but say in words what it is`);
  if (context && KIT_WORDS.test(context)) warn(`--context uses the kit's word "${context.match(KIT_WORDS)[0]}": say it in plain words, the owner hasn't got the fleet's vocabulary`);
  if (context && context.length > 600 && !/\n\s*(?:[-*•]|\d{1,2}[.)])\s/.test(context)) warn(`--context is ${context.length} characters of prose: break it into short paragraphs or a list ("- " or "1. " lines) so it can be read at a glance`);
  if (!secrets?.length && (CRED_WORDS.test(q) || (kind === 'owner-action' && CRED_WORDS.test(context ?? '')))) warn(`this looks like it needs a credential. Ask for it directly: --kind owner-action with --secrets naming each one and where it goes, so the owner pastes it on the dashboard (supervisor.md §6, Secrets)`);
  if (['owner-decision', 'clarification', 'one-way-door'].includes(kind) && !recommendation) warn('no --recommendation: say what you would do and how sure you are (--confidence); the owner answers faster with a pick to agree or disagree with');
  // only when low confidence is the whole reason: a question asked for another reason too stands on that
  if (reasons.length && reasons.every((r) => r === 'low-confidence') && confidence != null && confidence >= 0.7) die(`--reasons low-confidence with --confidence ${confidence}: at 0.7 or more you are sure enough. Decide it yourself if it is yours (constitution.md §1), or give the real reason`);
}
export function asksGoalApproval({ goal, kind, question, choices, options, recommendation, def }) {
  // A yes that would approve a draft goal goes through goal decide, which takes only a goal-approval
  // answer: an approval asked as another kind wastes the owner's yes. These kinds name a draft goal
  // for reasons of their own (defining it, a door in its design, something only the owner can do).
  if (['goal-approval', 'goal-definition', 'one-way-door', 'owner-action'].includes(kind)) return false;
  const g = goal ? logGet(goal) : null;
  if (g?.type !== 'goal' || (g.status ?? 'draft') !== 'draft') return false;
  const lit = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const title = lit(String(g.title ?? '').trim()).replace(/\s+/g, '\\s+');
  const aim = `(?:${title ? `${title}|` : ''}goal|design|approach|plan)(?!\\w)`;
  const text = String(question ?? '');
  // approval words aimed at the goal: "Approve <title>?", "Do you approve the design?"
  if (new RegExp(`\\b(?:approve|approval\\s+of|sign\\s+off\\s+on|green-?light)\\s+(?:(?:the|this|its|your|our)\\s+)?${aim}`, 'i').test(text)) return true;
  // a bare Approve answer, on a question that names the goal or its design (a sub-decision of the
  // design with an Approve choice is the owner's to settle before the approval, so it stays askable)
  if (!new RegExp(`\\b(?:${title ? `${title}|` : ''}goal|design(?:ed)?|approach|plan)(?!\\w)`, 'i').test(text)) return false;
  const bare = new RegExp(`^\\s*approv(?:e|ed|al)(?:\\s+(?:it|this|the\\s+${aim}))?\\s*[.!]?\\s*$`, 'i');
  const labels = Array.isArray(choices) ? choices.map((c) => c?.label) : [];
  return [...labels, ...[].concat(options ?? []), recommendation, def].some((a) => typeof a === 'string' && bare.test(a));
}
// about (thread ask --turn): the owner's turn it asks about, the newest owner turn read, and a hold's
// lift from a clause of that turn (owner_said as the raw slice), all checked by cmdThread first.
export function askLine({ thread, about } = {}) {
  supervisorOnly('ask');
  if (!about) for (const k of ['turn', 'seen-turn', 'at']) if (flags[k] !== undefined) die(`ask --${k}: a question about the owner's turn is asked in its thread: thread ask <t-id> --turn <u-id>`);
  // a goal-met question's words are the kit's (below)
  let q = ownerText(flagStr('question') ?? (flagStr('class') === 'goal-met' ? null : die('ask needs --question')));
  const cls = flagStr('class') ?? null;
  // A question in the owner-only class one-way-door is a one-way door: left without --kind it is
  // asked as one, and asked as another kind it is refused, so the owner's answer is the one-way-door
  // answer approve-plan and the plan review cite (and never re-asked as one), and the kind's own
  // rules (no default, below; the Inbox's floor) hold. Refused, not rewritten: another kind given on purpose
  // (a review, an owner-action with secrets) has rules of its own a silent change would drop.
  const kind = flagStr('kind') ?? (cls === 'one-way-door' ? 'one-way-door' : 'owner-decision');
  // browser-handover (kit-67): the browser held for the owner's login until they answer. Only the
  // owner's Done hands it back, so it has no default; it is one owner-action about one instance's
  // browser (browser:<instance key>, BROWSER_KEY: initialised at load, long before this runs), and
  // that browser has one handover open at a time. Checked in this order, before anything else.
  // Another case (Browser-Handover) is refused first: className would name it a handover while
  // these checks, and the hold, skipped it.
  if (cls !== 'browser-handover' && cls?.toLowerCase() === 'browser-handover') die('ask: the class is browser-handover, in lower case');
  if (cls === 'browser-handover') {
    if (flags.default !== undefined) die('a browser-handover question has no --default: only the owner hands the browser back');
    if (kind !== 'owner-action') die(`a browser-handover question is an owner-action (the owner logs in, then answers Done): ask it --kind owner-action, not --kind ${kind}`);
    const hs = flagStr('scope') ?? null;
    if (typeof hs !== 'string' || !hs.startsWith('browser:') || !BROWSER_KEY.test(hs.slice('browser:'.length))) die(`a browser-handover question's scope is browser:<instance key> (the browser it hands over, as browser status names it)${hs == null ? ', and this one has no --scope' : `, not ${hs}`}`);
    const held = questions().filter((x) => x.class === 'browser-handover' && x.scope === hs && x.status === 'open');
    if (held.length) die(`a browser-handover question for ${hs} is already open (${held.map((x) => x.id).join(', ')}): the browser is handed over once at a time; wait for the owner's answer, or withdraw it first`);
  }
  if (cls === 'one-way-door' && kind !== 'one-way-door') die(`a question in class one-way-door is a one-way door: ask it --kind one-way-door, not --kind ${kind}`);
  // --options takes each choice as its own value (or one JSON array of strings). One value holding
  // several choices joined by | ("yes|no", "Merge it | Let it go") would show the owner a single choice
  // that reads that way, so it is refused with the command it meant; on a decision, so is a value of
  // whole words joined by , or / ("yes,no"), and a decision whose drawn choices (--choices, else
  // --options) are one offers nothing to choose. Skipped where the kit writes the choices itself.
  if (!(cls === 'goal-met' || cls === 'recurring-edit' || flags['link-change'] !== undefined)) {
    const decision = ['owner-decision', 'one-way-door'].includes(kind);
    const opts = flags.options === undefined ? [] : listFlag('options').map(String);
    const labels = flags.choices !== undefined ? (jsonFlag('choices') ?? []).map((c) => String(c?.label ?? '')) : opts;
    const joined = (v) => {
      const pipe = v.split(/\s*\|\s*/).filter(Boolean);
      if (pipe.length > 1) return pipe;
      const words = v.split(/\s*[,/]\s*/).filter(Boolean);
      return decision && words.length > 1 && words.every((x) => /^[A-Za-z][A-Za-z-]+$/.test(x)) ? words : null;
    };
    if (labels.length === 1) {
      const parts = joined(labels[0]);
      if (parts) die(flags.choices !== undefined ? `--choices has one choice labelled "${labels[0]}": give each choice its own entry (--choices '${JSON.stringify(parts.map((label) => ({ label })))}')` : `--options takes each choice as its own value: --options ${parts.map((x) => JSON.stringify(x)).join(' ')} (one value "${labels[0]}" shows the owner a single choice that reads "${labels[0]}")`);
      if (decision) die(`${flags.choices !== undefined ? '--choices' : '--options'} "${labels[0]}" is one choice, so there is nothing to choose: give each choice its own value (--options "a" "b"), or leave the choices out and the owner answers in words`);
    }
  }
  if (asksGoalApproval({ goal: flagStr('goal'), kind, question: q, choices: jsonFlag('choices'), options: asList(flags.options), recommendation: flagStr('recommendation'), def: flagStr('default') })) die(`this asks the owner to approve ${flagStr('goal')} (a draft goal), but goal decide uses only a goal-approval answer, so a yes to a ${kind} question is wasted: ask it with ask --kind goal-approval --goal ${flagStr('goal')} --links '<the design>' (planning.md §1). If it decides one part of the design instead, ask that part in its own words, with choices that say what each does`);
  if (['proposal', 'trust'].includes(kind)) upkeepAllows(`a ${kind} question`);
  const L = ladder();
  if (kind === 'goal-approval') {
    const g = logGet(flagStr('goal') ?? '');
    if (g?.type !== 'goal') die('a goal-approval question needs --goal <g-id>');
    if ((g.status ?? 'draft') !== 'draft') die(`${g.id} is ${g.status}; only a draft goal is up for approval`);
    const c = goalCheck(g);
    if (c.definition.length) die(`${g.id} is not fully defined yet (ask a goal-definition question first):\n  - ${c.definition.join('\n  - ')}`);
    if (!(jsonFlag('links') ?? []).length) die('a goal-approval question links the design the owner is approving (--links)');
    if (questions().some((q) => q.kind === 'goal-approval' && q.goal === g.id && q.status === 'open')) die(`a goal-approval question for ${g.id} is already open; withdraw it first`);
    // The design's open decisions are the owner's to settle one by one, before the approval: an
    // approval is a yes to an approach whose decisions are already made, never a bundle of them.
    const unsettled = questions().filter((q) => q.kind !== 'goal-approval' && q.goal === g.id && q.status === 'open');
    if (unsettled.length) die(`${g.id} still has open questions about its design (${unsettled.map((q) => q.id).join(', ')}); ask the approval once they're answered (planning.md §1)`);
    if (c.approval.length) die(`${g.id}'s design has not given it milestones yet (planning.md §1):\n  - ${c.approval.join('\n  - ')}`);
    if (cls) die('a goal-approval question has no --class: approving a goal is never delegated');
  }
  if (kind === 'goal-definition' && cls) die('a goal-definition question has no --class: defining a goal is never delegated (reason goal-ambiguity)');
  // goal-change --order: one question proposing a whole goal order, applied by goal order --approved
  const orderAsked = goalOrderFlag(cls);
  // recurring-edit: the exact job change only the owner's Yes approves, entry by entry
  // (recurringBindingFails). --change is read here, before goalChangeFlag (which takes it only on a
  // goal-change). The kit writes the approval lines into the context, and the Yes and No choices.
  let recurringChange;
  let recurringText;
  if (cls === 'recurring-edit') {
    const R = recurringRegistry;
    const c = jsonFlag('change');
    if (c === undefined) die('a recurring-edit question shows the exact change: --change \'{"recurring":{"<name>":{…} | null}}\'');
    // a key twice in one object: JSON.parse keeps the last, so the words and the change could differ (final-14b F7)
    const dup = (jsonDuplicateKeys(flagStr('change')) ?? [])[0];
    if (dup) die(`--change for recurring-edit: ${JSON.stringify(String(dup.at(-1)))} appears twice in one object (${dup.join('.')}): JSON keeps only the last, so the question would show one thing and the kit read another`);
    const extra = isObj(c) ? Object.keys(c).filter((k) => k !== 'recurring') : [];
    if (extra.length) die(`--change for recurring-edit has only "recurring"; not ${extra.join(', ')}`);
    if (!isObj(c) || !isObj(c.recurring) || !Object.keys(c.recurring).length) die('--change for recurring-edit is {"recurring":{"<name>":{…} | null}}, with at least one job');
    const change = c.recurring;
    // a stop's name is checked as an entry's is; an entry, whole
    const probs = Object.entries(change).flatMap(([n, e]) => (e === null ? recurringEntryProblems(n, null).filter((p) => !p.startsWith(`recurring.json ${n}: an object`)) : recurringEntryProblems(n, e)));
    if (probs.length) die(`--change for recurring-edit:\n  - ${probs.join('\n  - ')}`);
    // main's jobs file; one that doesn't read is {} here, as it is for the binding, but git itself
    // failing (or timing out) is never read as no jobs (task-2 T2-1)
    const mainRead = R.read(mainRef());
    if (mainRead.failed) die(`recurring.json: couldn't read main's jobs (${mainRead.problem}); try again`);
    const onMain = isObj(mainRead.jobs) ? mainRead.jobs : {};
    for (const [n, e] of Object.entries(change)) {
      if (e === null && !Object.hasOwn(onMain, n)) die(`recurring.${n}: main has no such job; there is nothing to stop`);
      if (e !== null && Object.hasOwn(onMain, n) && canonical(onMain[n]) === canonical(e)) die(`recurring.${n}: main already has exactly this`);
    }
    // a plain yes or no: only the owner's Yes approves (no default: the class is owner-only, below)
    if (flagStr('recommendation')?.trim().toLowerCase() !== 'yes') die('a recurring-edit question recommends Yes (--recommendation Yes): only the owner\'s Yes approves a job change');
    if (flags.choices !== undefined || flags.options !== undefined) die('a recurring-edit question is a plain yes or no: the kit writes its choices (Yes, No); leave out --choices and --options');
    if (kind !== 'owner-decision' || flags.secrets !== undefined) die('a recurring-edit question is a plain yes or no: --kind owner-decision and no --secrets (only the owner\'s Yes approves a job change)');
    // one pending question per job
    for (const p of R.pending()) {
      const n = Object.keys(change).find((x) => Object.hasOwn(p.change, x));
      if (n) die(`recurring.${n} already has ${p.qid} (${p.status === 'open' ? 'open' : 'answered Yes, not landed yet'}): one question per job at a time; ${p.status === 'open' ? 'withdraw it, or wait for its answer and land it' : 'an answered question can\'t be withdrawn: land it first (recurring apply, then merge --chore recurring --approved), or wait for its reopen'}`);
    }
    // asked again: the decision is the change, not the words (ask's check on words is skipped below),
    // so exactly this change, answered other than a Yes and not superseded, needs --new-because
    if (!flagStr('new-because')?.trim()) {
      const before = R.questions().find((v) => v.status === 'answered' && v.matched !== true && R.shown(v) && canonical(R.shown(v)) === canonical(change) && !R.superseded(v));
      if (before) die(`${before.id} already asked exactly this change and the owner answered ${JSON.stringify(String(before.answer))}; ask again only with --new-because "<what changed>"`);
    }
    // the cap, worst case: each job at the most it could run, whichever way the counted questions go
    const most = new Map();
    const mostUnits = new Map();
    const take = (n, e) => { most.set(n, Math.max(most.get(n) ?? 0, R.runsADay(e))); mostUnits.set(n, Math.max(mostUnits.get(n) ?? 0, R.unitsADay(e))); };
    for (const [n, e] of Object.entries(onMain)) take(n, e);
    for (const p of R.counted()) for (const [n, e] of Object.entries(p.change)) take(n, e);
    for (const [n, e] of Object.entries(change)) take(n, e);
    const units = [...mostUnits.values()].reduce((t, r) => t + r, 0);
    const total = units / R.UNIT;
    // a change that adds no runs (a stop, a slower schedule) is never refused: it can bring an over-cap registry back under
    const adds = R.addsRuns(change, onMain);
    if (adds && units > R.CAP * R.UNIT) die(`this change could take the jobs to ${R.runsWords(total)} runs a day, over the cap of ${R.CAP}, counting each job at the most it could run whichever way the pending questions are answered (a stop frees nothing until it lands): ${R.tally([...most].filter(([, r]) => r > 0))}`);
    // the approval lines are the kit's alone
    if (`${q}\n${ownerText(flagStr('context')) ?? ''}`.split(/\r\n|\r|\n/).some((l) => l.includes(R.HEADER) || /^\s*recurring\.[^\s:]*\s*:/.test(l))) die('--question and --context may not hold a job approval line ("recurring.<name>: …") or its header: the kit writes them, from --change');
    recurringChange = { recurring: change };
    const lines = Object.entries(change).map(([n, e]) => (e === null ? `recurring.${n}: stop it (main has ${JSON.stringify(onMain[n])})` : Object.hasOwn(onMain, n) ? `recurring.${n}: main has ${JSON.stringify(onMain[n])}; would be ${JSON.stringify(e)}` : `recurring.${n}: add ${JSON.stringify(e)}`));
    const kinds = new Set(Object.values(change).filter((e) => e !== null).map((e) => e.kind));
    const plain = [
      ...(kinds.has('check') ? ['A check only looks: it never changes production. Any file in this repo its command runs is run as it is on main each time.'] : []),
      ...(kinds.has('chore') ? ['A chore changes only what a chore PR or chore ticket may change, never production.'] : []),
    ];
    recurringText = [[R.HEADER, ...lines].join('\n'), plain.join(' ')].filter(Boolean).join('\n\n');
  }
  // goal-met: the owner's yes that a running goal is met (planning.md §1), for every source. Owner
  // only and never defaulted. The kit writes the words and the choices, and the question carries the
  // goal as asked (met.basis) and the reading it shows, so the owner's yes applies to that goal as it
  // was and nothing else (answer, goalMetApply).
  let goalMet;
  if (cls === 'goal-met') {
    const g = logGet(flagStr('goal') ?? '');
    if (g?.type !== 'goal' || g.kind === 'upkeep') die('a goal-met question needs --goal <g-id>');
    if (g.status !== 'ready') die(`${g.id} is ${g.status ?? 'draft'}; a goal-met question is for a running (ready) goal`);
    const m = measureOf(g);
    if (!MEASURE_SOURCES.includes(m.source)) die(`${g.id} is read by hand: give it a measure source first (a goal-change), then ask`);
    if (m.source === 'owner' ? !m.question : !m.check) die(`${g.id} has no ${m.source === 'owner' ? 'measure.question' : 'measure.check'} to ask about (goal check)`);
    if (m.source === 'owner' && (m.target !== 1 || m.direction !== 'up')) die(`${g.id} is owner-read, so its target is 1, up (a yes); it says ${m.target} ${m.direction}: a goal-change first`);
    if (!['owner-decision', 'one-way-door'].includes(kind)) die('a goal-met question is an owner-decision');
    if (flagStr('recommendation')?.trim().toLowerCase() !== 'yes') die('a goal-met question recommends yes (--recommendation yes): the owner says no when it is not met');
    if (flagStr('default') !== undefined) die('a goal-met question has no --default: only the owner says a goal is met');
    if (flags.choices !== undefined || flags.options !== undefined) die('a goal-met question\'s choices are the kit\'s (Yes and No)');
    if (questions().some((x) => x.class === 'goal-met' && x.goal === g.id && x.status === 'open')) die(`a goal-met question for ${g.id} is already open; withdraw it first`);
    let reading = null;
    if (m.source !== 'owner') {
      const r = goalAtTarget(g);
      const last = goalReadings(g.id).pop();
      if (!r) die(`${g.id}'s latest reading ${last ? `is ${last.measure.value}${m.unit ? ` ${m.unit}` : ''} (${last.created_at.slice(0, 10)})` : 'is missing'}, not at its target ${m.target}${(g.milestones ?? []).length ? ' on its last milestone' : ''}: take one (goal reading ${g.id} --run), and ask once it reaches it`);
      reading = { id: r.id, value: r.measure.value, ...(m.unit ? { unit: m.unit } : {}), at: r.created_at, ...(r.sha ? { sha: r.sha } : {}) };
    }
    const words = goalMetWording(g, reading);
    if (q !== null && q.trim() !== String(words).trim()) die(`a goal-met question asks in the kit's words; leave out --question (it asks: ${words})`);
    q = words;
    const said = m.source === 'owner' ? goalReadings(g.id).filter((x) => x.measure.value >= 1).pop() : null;
    goalMet = { basis: goalMetBasis(g), reading, words: reading ? goalMetReadingWords(g, reading) : `About "${g.title}".${said ? ` You said yes${said.approved ? ` to ${said.approved}` : ''} on ${said.created_at.slice(0, 10)}, but the goal was never marked met; this marks it.` : ''} If you say yes, the goal is marked met and its work stops.` };
  }
  // registry-attest: the owner's yes that the registry lists every repo, design file and doc the
  // project depends on (planning.md §7). Owner-only, like goal-met: never defaulted.
  if (cls === 'registry-attest') {
    const g = logGet(flagStr('goal') ?? '');
    if (g?.type !== 'goal') die('a registry-attest question needs --goal <g-id> (the goal with a --registry-precondition)');
    if (kind !== 'owner-decision') die('a registry-attest question is an owner-decision');
    if (flagStr('recommendation')?.trim().toLowerCase() !== 'yes') die('a registry-attest question recommends --recommendation yes (the owner says no when something is missing)');
    if (flagStr('default') !== undefined) die('a registry-attest question has no --default: only the owner knows what the registry is missing');
  }
  // A review is answered with its result or sent back: never defaulted, never a secret, and its
  // choices and recommendation are the page and the data's proposals.
  let review;
  if (kind === 'review') {
    const why = { default: 'a review is never defaulted; the owner answers it or sends it back', secrets: 'a review never carries a secret; ask for secrets with --secrets on an owner-action question', choices: "a review's choices are its page", options: "a review's choices are its page", recommendation: "a review's recommendation is the proposals in its data" };
    for (const [k, w] of Object.entries(why)) if (flags[k] !== undefined) die(`ask --kind review takes no --${k}: ${w}`);
    // a review page is pinned to a commit of home; a ticket in another repo draws its page in a home chore
    if (flagStr('ticket') && tickets().has(flagStr('ticket')) && repoOfTicketLink(tickets().get(flagStr('ticket'))) !== 'home') die(`${flagStr('ticket')} is a ticket in ${repoOfTicketLink(tickets().get(flagStr('ticket')))}: a review question pins a page committed in home, so draw the page in a home chore and ask it there`);
    review = pinReview();
  } else for (const k of ['page', 'ref', 'data', 'result-schema', 'allow-partial']) if (flags[k] !== undefined) die(`--${k} belongs on a review question (--kind review)`);
  const onLadder = cls && L.classes[cls];
  if (kind === 'trust' && !onLadder) die(`a trust question needs --class, one of: ${Object.keys(L.classes).join(', ')}`);
  const def = flagStr('default') ?? null;
  const reasons = asList(flags.reasons);
  const known = L.reasons.map((r) => r.id);
  for (const r of reasons) if (known.length && !known.includes(r)) warn(`reason "${r}" is not in constitution.md's table`);
  // silence is never a yes on a one-way door or on what is the owner's alone (constitution.md §1)
  if (def !== null && (kind === 'one-way-door' || reasons.includes('one-way-door'))) die('a one-way door has no --default: only the owner\'s answer goes through it');
  // a door's answer approves a plan only as recommended (doorAgreed), so a door says what it recommends
  if (kind === 'one-way-door' && !flagStr('recommendation')?.trim()) die('a one-way door needs --recommendation: the owner\'s yes to it is what approves the plan built on it');
  // a door's other choices the owner may pick instead, each approving the plan built on it (doorPick):
  // marked "approves": true; a choice that declines never is. Only a door's choices carry it
  const approving = (jsonFlag('choices') ?? []).filter((c) => isObj(c) && Object.hasOwn(c, 'approves'));
  if (approving.length && kind !== 'one-way-door' && cls !== 'one-way-door') die('"approves" goes on a one-way door\'s choices: the other choices the owner may pick, each approving the plan built on it');
  for (const c of approving) {
    if (c.approves !== true) die(`--choices "${c.label}": "approves" is true or left out (a choice that declines leaves it out)`);
    if (DECLINING_LABEL.test(String(c.label ?? ''))) die(`--choices "${c.label}" reads as a no: a choice that declines never approves a plan, so it never carries "approves"`);
    if (String(c.label ?? '').trim().toLowerCase() === String(flagStr('recommendation') ?? '').trim().toLowerCase()) die(`--choices "${c.label}" is the recommendation, which approves already: leave "approves" off it`);
  }
  if (def !== null && (L.owner_only ?? []).includes(cls)) die(`${cls} is the owner's (constitution.md §1): no --default, only their answer approves it`);
  const blocks = asList(flags.blocks);
  for (const b of blocks) if (!tickets().has(b) && !isIncident(logGet(b)) && !(cls === 'production-remediation' && /^(remediation|release):\S+$/.test(b))) die(`--blocks ${b}: no such ticket (or incident)`);
  // a remediation question names the remediation (and a rollback its release), so the answer
  // approves that and nothing else
  let ownerSaid = null;
  let remediationPin = null;
  // the owner's own words, recorded like a chat answer's --said; never a way to bring back a default
  if (flagStr('owner-said') !== undefined && !flagStr('owner-said').trim()) die('--owner-said is the owner\'s words, verbatim; it can\'t be blank');
  if (flagStr('owner-said') && def) die('--owner-said goes without --default: after the owner\'s no, only their answer can start this again');
  if (cls === 'production-remediation' && !['trust', 'proposal'].includes(kind)) {
    const rs = blocks.filter((b) => b.startsWith('remediation:'));
    if (rs.length !== 1) die('a production-remediation question names its remediation in --blocks remediation:<action> (and, for a rollback, release:<version>)');
    const r = remediationOf(rs[0].slice('remediation:'.length));
    const rel = blocks.filter((b) => b.startsWith('release:'));
    if (r.kind === 'rollback' && rel.length !== 1) die('a rollback question names its target in --blocks release:<version>');
    if (r.kind !== 'rollback' && rel.length) die(`${r.name} is a ${r.kind}, not a rollback: it takes no release`);
    if (rel.length && !migrationsSince(rel[0].slice('release:'.length))) die(`no deploy of ${rel[0].slice('release:'.length)} was observed by a sensor: a rollback goes to a release the sensors saw`);
    upkeepAllows('a remediation', { noForce: true });
    // pin what the owner is shown: remediate refuses if this entry changes after they answer
    remediationPin = { name: r.name, sha: r.sha, entry_hash: remediationEntryHash(loadSettings().remediations[r.name]) };
    // a default is the recommendation or nothing: silence never runs something the owner wasn't recommended
    const rec = flagStr('recommendation');
    if (!rec) die('a production-remediation question needs --recommendation');
    if (def && def.trim().toLowerCase() !== rec.trim().toLowerCase()) die('a production-remediation default is its recommendation (or there is none): silence never runs anything else');
    // after the owner's no, not again for the same remediation and target, whichever incident is named
    const hold = remediationHold(rs[0], rel[0] ?? null, r.valid_minutes);
    if (hold && !flagStr('owner-said')) die(remediationHoldWords(r.name, rel[0] ?? null, hold, r.valid_minutes));
    ownerSaid = about?.owner_said ?? (flagStr('owner-said')?.trim() || null);
  }
  if (!orderAsked && cls !== 'browser-handover' && !flagStr('goal') && !flagStr('ticket') && !blocks.length && !['trust', 'proposal'].includes(kind)) warn('this question names no --goal, --ticket or --blocks: when it serves a goal, add --goal <g-id> so the goal shows it');
  // A question that asks about several acts names them up front; the owner's card lists them, and
  // the answer approves each once and nothing else (constitution.md §3, one answer, one act).
  const approves = [...new Set(asList(flags.approves).flatMap((x) => String(x).split(',')).map((x) => x.trim()).filter(Boolean))];
  // A Self or exterior change names its one chore, the branch its draft is on (checked with the
  // link below), so the chore waits on the owner and merge lands the file in that chore only.
  const oneAct = ['self-change', 'exterior-change'].includes(cls);
  if (oneAct && !approves.length) die(`a ${cls} question names its chore: --approves chore-<slug>, the chore whose branch the link pins`);
  if (oneAct && (approves.length !== 1 || !/^chore-[a-z0-9][a-z0-9-]*$/.test(approves[0]))) die(`a ${cls} question approves exactly one act, the chore chore-<slug> whose branch holds the draft`);
  if (approves.length) {
    if (!['owner-decision', 'one-way-door'].includes(kind)) die(`--approves belongs on an owner-decision or one-way-door question, not ${kind}`);
    if (approves.length < 2 && !oneAct) die('--approves names two or more acts; a question about one act needs no --approves');
    if (approves.length > 10) die('--approves names at most 10 acts; split the question');
    for (const a of approves) if (!(tickets().has(a) || /^chore-[a-z0-9][a-z0-9-]*$/.test(a) || /^plan-[a-z0-9][a-z0-9-]*$/.test(a))) die(`--approves ${a}: name a ticket id, chore-<slug> or plan-<feature>`);
  }
  const open = questions().filter((x) => x.status === 'open');
  let evidence = asList(flags.evidence);
  let recommendation = flagStr('recommendation') ?? '';
  if (kind === 'trust') {
    if (open.some((x) => x.kind === 'trust' && x.class === cls)) die(`a trust question for ${cls} is already open`);
    if (open.filter((x) => x.kind === 'trust').length >= 2) die('two trust questions are already open');
    const ev = trustEvidence(cls);
    const r = rungFor(cls);
    if (r >= L.classes[cls].ceiling) die(`${cls} is already at its ceiling (rung ${r})`);
    if (!ev.meets_agreement) die(`${cls}: the owner agreed with the recommendation on ${ev.agreement_questions.length ? `${Math.round((ev.agreement ?? 0) * 100)}% of the last ${ev.agreement_questions.length}` : 'no'} answered questions; a trust question needs ${L.promotion.agreement * 100}% of the last ${L.promotion.agreement_window} (constitution.md §2)`);
    evidence = [...new Set([...evidence, ...ev.agreement_questions, ...ev.uncorrected_acts.slice(-10)])];
    if (!recommendation) recommendation = `move ${cls} to rung ${r + 1} (${RUNG[r + 1]})`;
  }
  let scope = flagStr('scope') ?? null;
  // the owner said not to use this sensor: nothing asks about it again until they reverse that
  if (flagStr('sensor') && declinedSensors().has(flagStr('sensor'))) die(`the owner said not to use the sensor ${flagStr('sensor')}: it isn't asked about again until sensor reconsider ${flagStr('sensor')}`);
  // an incident-fix question is scoped by its incident's computed severity, and says when merging deploys
  let context = ownerText(flagStr('context'));
  if (remediationPin) context = [context, `This runs ${remediationPin.name} at script blob ${remediationPin.sha}.`].filter(Boolean).join('\n\n');
  if (ownerSaid) context = [context, `The owner said: ${ownerSaid}`].filter(Boolean).join('\n\n');
  if (goalMet) context = [context, goalMet.words].filter(Boolean).join('\n\n');
  if (goalMet) recommendation = GOAL_MET_CHOICES[0].label;
  if (recurringText) [context, recommendation] = [[context, recurringText].filter(Boolean).join('\n\n'), 'Yes'];
  if (cls === 'incident-fix' && !['trust', 'proposal'].includes(kind)) {
    upkeepAllows('an incident fix');
    const incs = blocks.map((b) => logGet(b)).filter(isIncident);
    if (incs.length !== 1) die(`an incident-fix question names exactly one incident in --blocks <p-id>; it names ${incs.length}`);
    const inc = incs[0];
    const want = sevScope(incidentSeverity(inc));
    if (scope && scope !== want) die(`${inc.id} has computed severity ${incidentSeverity(inc)}: its scope is ${want}, not ${scope}`);
    scope = want;
    if (releasesOnMerge()) context = [context, 'Merging deploys this fix to production (release: "merge").'].filter(Boolean).join('\n\n');
  }
  // Below rung 2 a default can never fire, so it would only be a promise the kit can't keep; and the
  // rung it was asked on is recorded (why_asked), so a later promotion never wakes it (defaultGap).
  if (def !== null && onLadder && rungFor(cls, scope) < 2) die(`${cls}${scope ? ` (${scope})` : ''} is on rung ${rungFor(cls, scope)}: no --default until it's on rung 2`);
  // --deadline 15m|2h|<time>: the default may fire before question_default_after_hours
  const dl = flagStr('deadline');
  if (dl !== undefined && !def) die('--deadline goes with --default: it is when the default may be applied');
  // a shorter wait than question_default_after_hours is for an incident fix only (supervisor.md, Incidents)
  if (dl !== undefined && !['incident-fix', 'production-remediation'].includes(cls)) die('--deadline is for an incident-fix or production-remediation question; other defaults wait question_default_after_hours');
  const dm = /^(\d+)(m|h)$/.exec(dl ?? '');
  const deadlineAt = dl === undefined ? null : dm ? new Date(Date.now() + Number(dm[1]) * (dm[2] === 'h' ? 3600000 : 60000)).toISOString() : !Number.isNaN(Date.parse(dl)) ? new Date(dl).toISOString() : die('--deadline is minutes or hours (15m, 2h) or a time');
  if (deadlineAt && Date.parse(deadlineAt) < Date.now() + 15 * 60000 - 1000) die('--deadline is at least 15 minutes away: the owner needs time to see it');
  // the remediation entries a governance-edit question would approve: the owner sees each one
  const remediationsAsked = jsonFlag('remediations');
  let remediationEntries;
  if (remediationsAsked !== undefined) {
    if (cls !== 'governance-edit') die('--remediations goes with --class governance-edit: a remediation entry is the owner\'s');
    if (!isObj(remediationsAsked) || !Object.keys(remediationsAsked).length) die('--remediations is a JSON object: { "<name>": <the entry that would land> | null to remove }');
    remediationEntries = Object.entries(remediationsAsked).map(([name, e]) => {
      if (e !== null && !(isObj(e) && typeof e.script === 'string' && /^[0-9a-f]{40}$/.test(e.sha ?? ''))) die(`--remediations ${name}: an entry has its script and its 40-character sha, or null to remove it`);
      return { name, script: e?.script ?? null, sha: e?.sha ?? null, entry_hash: remediationEntryHash(e) };
    });
    // what the owner reads in the Inbox says exactly what approving this lands
    context = [context, `Approving this lands: ${remediationEntries.map((e) => (e.sha ? `${e.name} (${e.script} at blob ${e.sha})` : `the removal of ${e.name}`)).join('; ')}`].filter(Boolean).join('\n\n');
  }
  // A repo link change asked in the supervisor's own words (--link-change): the kit writes the lines
  // the owner's answer binds by (linkAnswerCovers), from main's settings, and nobody else may: a
  // binding line typed or quoted in the question's own words is refused, so it never approves by accident.
  // checked as stored (ownerText turns a typed \n into a line), line by line, on any line break, and
  // broadly: whatever the binder could read as a line (linkAnswerCovers.lines) is refused
  const typed = `${q}\n${context ?? ''}`.split(/\r\n|\r|\n/);
  if (typed.some((l) => l.includes(linkAnswerCovers.HEADER) || (/^\s*links\./.test(l) && /main\s+has/.test(l)))) die('--question and --context may not hold a repo link approval line ("links.<id>[.<field>]: main has …; would be …") or its header: the kit writes them, from --link-change');
  if (flagStr('change') !== undefined && ['governance-edit', 'gate-change'].includes(cls)) die('--change belongs on a goal-change question; a repo link change is --link-change \'{"link":"<id>","field":"<field>","value":<value>}\' (or "entry" for an add or a removal)');
  const linkChange = jsonFlag('link-change');
  if (linkChange !== undefined) {
    if (!['governance-edit', 'gate-change'].includes(cls)) die('--link-change goes with --class governance-edit or gate-change: a repo link change is the owner\'s');
    // its answer approves the change only as a yes: the question recommends yes and offers no other choice
    if (recommendation.trim().toLowerCase() !== 'yes' || flags.choices !== undefined || flags.options !== undefined) die('--link-change asks yes or no: --recommendation yes, and no --choices or --options (only the owner\'s yes approves the change)');
    const shape = '--link-change: each item is {"link":"<id>","field":"<field>","value":<value>} or {"link":"<id>","entry":{…} | null}';
    const items = Array.isArray(linkChange) ? linkChange : [linkChange];
    if (!items.length) die(shape);
    const mainLinks = mainSettings(null)?.links ?? {};
    const after = Object.assign(Object.create(null), structuredClone(mainLinks));
    for (const it of items) {
      if (!isObj(it) || typeof it.link !== 'string' || Object.hasOwn(it, 'entry') === (Object.hasOwn(it, 'field') || Object.hasOwn(it, 'value'))) die(shape);
      const onMain = ownEntry(mainLinks, it.link);
      if (Object.hasOwn(it, 'field')) {
        if (!onMain) die(`--link-change: ${it.link} is not a link on main; ask about it whole: {"link":"${it.link}","entry":{…}}`);
        if (!ownersKind(onMain)) die(`--link-change: ${it.link} is a ${onMain.kind} link, the supervisor's (link set)`);
        if (!linkFields(onMain.kind).includes(it.field) || !LINK_KINDS[onMain.kind].ownerClass(it.field) || !Object.hasOwn(it, 'value')) die(`--link-change: "${it.field}" is not a field of a ${onMain.kind} link the owner approves, with its value`);
        after[it.link] = { ...ownEntry(after, it.link), [it.field]: it.value };
      } else if (it.entry === null) {
        if (!onMain) die(`--link-change: ${it.link} is not a link on main; there is nothing to remove`);
        delete after[it.link];
      } else {
        if (!isObj(it.entry) || !ownersKind(it.entry) && !ownersKind(onMain)) die('--link-change: an entry is a repo link\'s ({"kind":"repo",…})');
        after[it.link] = it.entry;
      }
    }
    const { errors } = registryProblems({ ...loadSettings(), links: after });
    if (errors.length) die(`--link-change: not a valid registry:\n  - ${errors.join('\n  - ')}`);
    const named = new Set(items.map((it) => it.link));
    const changes = linkFieldChanges(mainLinks, after).filter((c) => named.has(c.id));
    if (!changes.length) die('--link-change: main already has that; there is nothing to approve');
    context = [context, [linkAnswerCovers.HEADER, ...changes.map(linkFieldChanges.line)].join('\n')].filter(Boolean).join('\n\n');
  }
  const secrets = jsonFlag('secrets');
  if (secrets !== undefined) {
    if (kind !== 'owner-action') die('--secrets belongs on an owner-action question: the owner posts values, the supervisor never holds them');
    if (!Array.isArray(secrets) || !secrets.length || secrets.some((x) => !x || typeof x !== 'object' || Array.isArray(x))) die('--secrets is a JSON array of objects: [{"name":"STRIPE_TEST_KEY","sink":"rails-credentials:test:stripe.secret_key"}, …]');
    if (secrets.length > MAX_SECRETS) die(`at most ${MAX_SECRETS} secrets per question`);
    if (flags.default !== undefined) die('a question asking for secrets has no --default: only the owner can post them');
    const names = new Set();
    for (const x of secrets) {
      x.kind ??= 'string';
      if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(x.name ?? '')) die(`secret name "${x.name}" must be UPPER_SNAKE_CASE`);
      if (names.has(x.name)) die(`secret ${x.name} is listed twice`);
      names.add(x.name);
      if (!['string', 'file'].includes(x.kind)) die(`secret ${x.name}: kind is string or file`);
      const k = parseSink(x.sink);
      if (k.type === 'stdin' && !allowedCommand(k.argv)) die(`secret ${x.name}: \`${k.argv.join(' ')}\` is not in settings.secret_commands, the commands the owner lets a secret be piped to`);
    }
  }
  // A question with no default stops the work behind it until the owner answers (supervisor.md §6,
  // Ask with a default where you can). Where a default is allowed, a clarification and an
  // owner-decision in a ladder class on rung 2 or above carry one, or say with --no-default why
  // silence can't go ahead. Not where silence is never a yes (a one-way door, the owner's alone, an
  // answer after the owner's no, a secret), below rung 2, nor on the kit's own wordings; the kinds
  // whose job is to ask (trust, proposal, goal-definition, goal-approval, owner-action, review) never.
  let noDefault = flagStr('no-default');
  if (flags['no-default'] !== undefined && !noDefault?.trim()) die('--no-default says why this can\'t go ahead on the owner\'s silence; it can\'t be blank');
  noDefault = noDefault?.trim();
  if (noDefault && def !== null) die('--default or --no-default, not both');
  const rungNow = onLadder ? rungFor(cls, scope) : null;
  const silenceNeverYes = kind === 'one-way-door' || reasons.includes('one-way-door') || reasons.includes('owner-only') || (L.owner_only ?? []).includes(cls) || flagStr('owner-said') !== undefined || secrets !== undefined || KIT_WORDED(cls, kind);
  const wantsDefault = !silenceNeverYes && (kind === 'clarification' ? !onLadder || rungNow >= 2 : kind === 'owner-decision' && onLadder && rungNow >= 2);
  if (wantsDefault && def === null && !noDefault) die(`${kind === 'clarification' ? 'a clarification' : `${cls}${scope ? ` (${scope})` : ''} is on rung ${rungNow} (${RUNG[rungNow]}), so this question`} needs --default: the choice you would act on if the owner hasn't answered by the deadline, so the work goes on. If silence can't be a yes here, say why: --no-default "<why it can't go ahead without the owner>" (supervisor.md §6)`);
  if (noDefault && !wantsDefault) { warn('--no-default is for a question that would otherwise need a --default; this one doesn\'t, so it is left off'); noDefault = undefined; }
  // Each link is one thing to look at: a repo path, a url, a registry link or an artifact. A name
  // lets the question's text point at it inline ([[name]]). An artifact is pinned to where it was
  // and what it held when asked, in this one line: the question's hash covers its links, so
  // nothing is added to them later.
  const links = jsonFlag('links');
  if (links !== undefined && !Array.isArray(links)) die('--links is a JSON array of objects');
  const LINK_WAYS = ['path', 'url', 'link', 'artifact', 'preview'];
  const names = new Set();
  let arts = null;
  for (const l of links ?? []) {
    if (!isObj(l)) die('--links: each item is an object');
    const ways = LINK_WAYS.filter((k) => l[k] !== undefined);
    if (ways.length !== 1) die(`--links: "${l.title ?? '?'}" has exactly one of ${LINK_WAYS.join(', ')} (it has ${ways.join(', ') || 'none'})`);
    if (l.name !== undefined) {
      if (typeof l.name !== 'string' || !LINK_ID.test(l.name)) die(`--links: a name is lowercase words joined by - ("${l.name}")`);
      if (names.has(l.name)) die(`--links: the name "${l.name}" is used twice`);
      names.add(l.name);
    }
    if (l.link !== undefined && !ownEntry(loadSettings().links, l.link)) die(`--links: link "${l.link}" is not in settings links (devteam.mjs links)`);
    // a preview is named, never addressed: the question reads right on a laptop and on the box
    if (l.preview !== undefined && !(typeof l.preview === 'string' && PREVIEW_NAME.test(l.preview) && readPreviews().some((r) => r.name === l.preview))) die(`--links: no preview "${l.preview}" on this instance (devteam.mjs preview list)`);
    // an inline link is logged as given, so a credential in it would be in the log and every view of the question
    if (hasCredentials(l.url)) die(`--links: ${redactUrl(l.url)} carries credentials; ${CREDENTIALS_REFUSED}`);
    if (l.sha256 !== undefined) die('--links: sha256 is written by ask (the artifact as it is now), never given');
    if (l.blob !== undefined) die('--links: blob is written by ask (the draft as it is now), never given');
    if (l.at !== undefined && l.artifact === undefined) die('--links: at belongs to an artifact link');
    if (l.artifact !== undefined) {
      arts ??= allArtifacts();
      const all = arts.filter((a) => a.slug === l.artifact);
      if (!all.length) die(`--links: no artifact "${l.artifact}" (devteam.mjs artifacts)`);
      // A draft fetched from another machine (origin:<branch>, kit-750) is the Library's to show; a
      // question links main's copy or one in a worktree here, as before kit-750 (kit-752, ruling
      // a-20261122-082323258): with no at it is never picked, and naming it, or any at
      // when it is the only copy, is refused.
      const far = typeof l.at === 'string' && l.at.startsWith('origin:') ? [l.at] : all.every((a) => a.remote) ? all.map((a) => a.at) : null;
      if (far) die(`--links: artifact "${l.artifact}" in ${far.join(' and ')} is a draft from another machine, which a question can't link: check its branch out in a worktree here, or merge it to main, first`);
      const cands = all.filter((a) => !a.remote);
      const pick = l.at !== undefined ? cands.find((a) => a.at === l.at) : cands.length === 1 ? cands[0] : null;
      if (pick?.error) die(`--links: artifact "${l.artifact}" in ${pick.at} is broken (${pick.error}); fix it first (artifact check)`);
      if (!pick) die(`--links: artifact "${l.artifact}" is ${l.at !== undefined ? `not at ${l.at}; it is in ${cands.map((a) => a.at).join(' and ')}` : `in ${cands.map((a) => a.at).join(' and ')}`}; say which with "at"`);
      l.at = pick.at;
      l.sha256 = pick.fp;
    }
  }
  for (const [, n] of `${q}\n${flagStr('context') ?? ''}`.matchAll(/\[\[([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\]\]/g)) if (!names.has(n)) die(`--links: the text names [[${n}]] but no link has "name": "${n}"`);
  // A change to the strategy, the Self or the exterior is asked about one text: the draft's blob and
  // commit are pinned here, in this one line the question's hash covers. merge lands that blob and
  // no other, and the link shows the owner that commit's text however the branch moves after. The
  // Self's and the exterior's link is on the branch of the one chore the question names, read as a
  // branch (never a tag or another ref of that name).
  const world = worldFileFails.files().find((w) => w.cls === cls);
  if (world && projectInRepo) {
    const rel = world.rel;
    const l = (links ?? []).find((x) => isObj(x) && x.path === rel);
    if (!l?.ref) die(`--links: a ${cls} question links the draft it asks about, on its branch: {"title":"${world.title}","path":"${rel}","ref":"<the chore's branch>"}`);
    if (oneAct && l.ref !== approves[0]) die(`--approves ${approves[0]}: the link pins the draft on ${l.ref}; link it on ${approves[0]}, the chore's branch`);
    const commit = /^-/.test(l.ref) ? null : git(['rev-parse', '--verify', '--quiet', oneAct ? `refs/heads/${l.ref}^{commit}` : `${l.ref}^{commit}`]);
    const blob = commit && git(['rev-parse', '--verify', '--quiet', `${commit}:${rel}`]);
    if (!blob) die(`--links: no ${rel} at ${l.ref}; commit the draft to its branch first`);
    l.ref = commit;
    l.blob = blob;
  }
  // The rating: how much rides on the answer and how soon, and the open questions one answer
  // would settle. The kit orders the Inbox from it (inboxRanks); it is never part of what the
  // owner's answer covers.
  const rating = ratingFlags();
  const settles = idsFlag('settles');
  if (flags['settles-if'] !== undefined && !settles.length) die('--settles-if needs --settles <qid>…: the questions that answer settles');
  settleChecks({ self: null, kind, stake: rating.stake, settles, added: settles, settlesIf: flagStr('settles-if'), choices: jsonFlag('choices'), about: questionAbout({ goal: flagStr('goal'), ticket: flagStr('ticket'), blocks }) });
  if (rating.stake === undefined || rating.urgency === undefined) warn('rate it: --stake 1-3 --urgency 1-3, so the Inbox can put the most valuable question first (supervisor.md §6)');
  ratingWarnings({ ...rating, blocks, def });
  askPlainChecks({ q, context, kind, cls, secrets, reasons, confidence: flagNum('confidence'), recommendation, L });
  // what the owner may already have said about it: never in the way of asking
  // and a decision they already made is refused, unless something material changed (--new-because)
  let newBecause = flagStr('new-because');
  if (newBecause !== undefined && !newBecause.trim()) die('--new-because says what materially changed since the owner answered; it can\'t be blank');
  // a recurring-edit question is its exact change, not its words: one pending question per job
  // and "main already has exactly this" (above) say when it may be asked again
  if (cls !== 'recurring-edit') try { newBecause = askLikeWarnings({ text: textOf(q, flagStr('context'), flagStr('recommendation'), [].concat(jsonFlag('choices') ?? []).map((c) => c?.label)), question: q, cls, kind, about: { goal: flagStr('goal'), ticket: flagStr('ticket'), blocks, secrets, links, sensor: flagStr('sensor') }, newBecause: newBecause?.trim() }); } catch (e) { warn(`the check for earlier answers failed (${e.message}); the question is asked anyway`); }
  return appendLog({
    type: 'question', kind, class: cls ?? undefined, scope: scope ?? undefined, ticket: flagStr('ticket'), re: flagStr('re'), sensor: flagStr('sensor'), remediation: remediationPin ?? undefined, remediation_entries: remediationEntries, owner_said: ownerSaid ?? undefined, new_because: newBecause?.trim() || undefined, question: q, context: kind === 'goal-approval' ? [ownerText(flagStr('context')), forecastText(logGet(flagStr('goal')), goalForecast(logGet(flagStr('goal')))), registryAttestText(logGet(flagStr('goal')))].filter(Boolean).join('\n\n') : orderAsked ? [context, goalOrderText(orderAsked)].filter(Boolean).join('\n\n') : context,
    rule_scope: flagStr('rule-scope'), goal: flagStr('goal'), change: orderAsked ? { order: orderAsked } : recurringChange ?? goalChangeFlag(cls), options: flags.options === undefined ? [] : listFlag('options'), choices: goalMet ? GOAL_MET_CHOICES : cls === 'recurring-edit' ? [{ label: 'Yes' }, { label: 'No' }] : jsonFlag('choices'), met: goalMet ? { basis: goalMet.basis, reading: goalMet.reading } : undefined, links, recommendation: recommendation || undefined, confidence: flagNum('confidence'), default: def ?? undefined, no_default: noDefault,
    deadline: def ? deadlineAt ?? new Date(Date.now() + loadSettings().question_default_after_hours * 3600000).toISOString() : undefined,
    blocks, ...rating, settles: settles.length ? settles : undefined, settles_if: settles.length ? flagStr('settles-if') : undefined,
    approves: approves.length ? approves : undefined, evidence, note: flagStr('note'), secrets, review, thread,
    about_turn: about?.about_turn, seen: about?.seen, owner_said_turn: about?.owner_said_turn, owner_said_at: about?.owner_said_at,
    why_asked: { rung: onLadder ? rungFor(cls, scope) : undefined, ceiling: onLadder ? L.classes[cls].ceiling : undefined, reasons },
  }, 'supervisor');
}

/* turnClause start */
// Turn authority (turn-authority-1): the owner's words in a thread settle a question, lift a hold or
// correct a call through whole clauses of their turn, bound one span to one thing. These are the
// rules every writer and metrics share.
//
// Whether [start, end) of a turn is whole clauses. A clause starts at the turn's start, a line start,
// or after . ! ? or ; and whitespace; it ends at the turn's end, a line end, or one of those marks
// followed by whitespace or the end. A span may leave out a closing . or ;, never ? or !: "Ship it"
// is no clause of "Ship it? Or wait for CI?". A mark inside a word ("3.5") is no boundary.
export function clauseBounds(text, start, end) {
  const s = String(text);
  let k = start - 1;
  let gap = false;
  let line = false;
  while (k >= 0 && /\s/.test(s[k])) { gap = true; if (s[k] === '\n' || s[k] === '\r') line = true; k--; }
  const startOk = k < 0 || line || (gap && /[.!?;]/.test(s[k]));
  if (!startOk) return false;
  if (end >= s.length) return true;
  if (/[.!?;]/.test(s[end - 1]) && /\s/.test(s[end])) return true;
  let j = end;
  while (j < s.length && /[ \t]/.test(s[j])) j++;
  if (j >= s.length || s[j] === '\n' || s[j] === '\r') return true;
  return /[.;]/.test(s[end]) && (end + 1 >= s.length || /\s/.test(s[end + 1]));
}
// The clause around raw offset i, for a refusal to name: from the boundary before it to the mark
// (or line end) after it.
export function clauseAround(text, i) {
  const s = String(text);
  let a = i;
  while (a > 0 && !(s[a - 1] === '\n' || (/\s/.test(s[a - 1]) && a > 1 && /[.!?;]/.test(s[a - 2])))) a--;
  let b = i;
  while (b < s.length && s[b] !== '\n' && !(/[.!?;]/.test(s[b]) && (b + 1 >= s.length || /\s/.test(s[b + 1])))) b++;
  return s.slice(a, Math.min(b + 1, s.length)).trim();
}
// --said "<words>" as whole clauses of a turn: matched on whitespace-collapsed text, mapped back to
// raw UTF-16 offsets. { said, said_at } (said is the raw slice), or { why }.
export function turnClause(text, said, at = null) {
  const s = String(text);
  const want = String(said ?? '').replace(/\s+/g, ' ').trim();
  if (!want) return { why: 'say which words: --said "<whole clauses of the turn>"' };
  let flat = '';
  const map = [];
  for (let i = 0; i < s.length;) {
    if (/\s/.test(s[i])) { map.push(i); flat += ' '; while (i < s.length && /\s/.test(s[i])) i++; } else { map.push(i); flat += s[i]; i++; }
  }
  const found = [];
  for (let i = flat.indexOf(want); i !== -1; i = flat.indexOf(want, i + 1)) {
    const start = map[i];
    const end = map[i + want.length - 1] + 1;
    found.push({ start, end, whole: clauseBounds(s, start, end) });
  }
  if (!found.length) return { why: `"${want}" isn't in the turn` };
  const part = (m) => ({ why: `"${want}" is part of a clause; give the whole clause: "${clauseAround(s, m.start)}"` });
  let m;
  if (at !== null) {
    m = found.find((x) => x.start === at);
    if (!m) return { why: `no match of "${want}" starts at offset ${at}; matches start at ${found.map((x) => x.start).join(', ')}` };
    if (!m.whole) return part(m);
  } else {
    const whole = found.filter((x) => x.whole);
    if (!whole.length) return part(found[0]);
    if (whole.length > 1) return { why: `"${want}" is in the turn ${whole.length} times, at offsets ${whole.map((x) => x.start).join(', ')}; pick one with --at <offset>` };
    [m] = whole;
  }
  return { said: s.slice(m.start, m.end), said_at: [m.start, m.end] };
}
// --at <offset>: which match of a repeated clause, as a refusal lists them. null when not given.
export function clauseAt() {
  if (flags.at === undefined) return null;
  const n = Number(flagStr('at'));
  if (!Number.isInteger(n) || n < 0) die('--at <offset>: where the clause starts in the turn, a whole number (a refusal lists them)');
  return n;
}
// What is already bound to an owner's turn: answers (a clause, or the whole turn when said_at is
// absent) and corrections. A lifted hold (owner_said_turn) binds nothing. Spans overlap when they
// share an offset; the whole turn overlaps everything.
export const turnBindings = (lines, uid) => lines.flatMap((l) => (l.op !== 'set' ? []
  : l.type === 'question' && l.turn === uid ? [{ id: l.id, at: l.at, kind: 'answer', span: Array.isArray(l.said_at) ? l.said_at : null, line: l }]
    : ['decision', 'act'].includes(l.type) && isObj(l.corrected) && l.corrected.turn === uid ? [{ id: l.id, at: l.at, kind: 'correction', span: Array.isArray(l.corrected.said_at) ? l.corrected.said_at : null, line: l }]
      : []));
export const spansOverlap = (a, b) => !a || !b || (a[0] < b[1] && b[0] < a[1]);
// The owner's turns in a thread, oldest first, from the fold's created_by (never a view's display by).
export const ownerTurnsIn = (threadId) => logObjects('turn').filter((x) => x.thread === threadId && x.created_by === 'owner').sort(byTime);
// The owner's newest turn in a thread, once everything after `after` has been read: refused, with
// those turns printed, unless --seen-turn names the newest. Returns its id.
export function ownerTurnsRead(threadId, after) {
  const all = ownerTurnsIn(threadId);
  const newest = all[all.length - 1]?.id ?? null;
  // by the log's order, not the clock: a turn stamped in the same millisecond is still after it
  const at = all.findIndex((x) => x.id === after.id);
  const later = at >= 0 ? all.slice(at + 1) : all.filter((x) => x.created_at > after.created_at);
  const seen = flagStr('seen-turn');
  if (later.length && seen !== newest) die(`the owner wrote in ${threadId} after ${after.id}; read it first, then run this again with --seen-turn ${newest}:\n${later.map((x) => `  ${x.id} ${x.created_at}: ${String(x.text ?? '').replace(UNSAFE_TEXT_ALL, ' ').replace(/\s+/g, ' ').trim()}`).join('\n')}`);
  if (!later.length && seen !== undefined && seen !== newest) die(`--seen-turn ${seen}: the newest owner turn in ${threadId} is ${newest}`);
  return newest;
}
/* turnClause end */
// The checks every record of the owner's word in chat shares: only the supervisor records it, and
// only with the owner's words verbatim. What they said, ready for the line.
export function chatAnswer(what) {
  if (process.env.DEVTEAM_ROLE !== 'supervisor' || logWriter() !== 'supervisor') die(`${what} --from-chat: the supervisor records what the owner said in its session; in your own terminal, answer directly`);
  if (!flagStr('said')?.trim()) die(`${what} --from-chat needs --said "<the owner's words, verbatim>"`);
  return flagStr('said').trim();
}
// An Inbox question in a thread: the supervisor's turn there, before the owner's, that names it (thread
// ask's question, or a reply's --refs question:<qid>). Without one, a yes in that thread may have been
// to anything, another question in it included.
export const questionNamed = (objects, thread, qid, before) => [...objects.values()].some((o) => o.type === 'turn' && o.thread === thread && o.created_by === 'supervisor' && o.created_at < before && (o.question === qid || (Array.isArray(o.refs) && o.refs.includes(`question:${qid}`))));
// --from-turn: the owner said it in a thread, in a turn already verbatim in the log, and the supervisor
// records the decision it settles, as from chat but with the turn in place of a quote, so no
// transcript check is needed. One turn settles one question, and only one it is bound to: asked in
// the turn's own thread before it, or asked with no thread (in the Inbox) before it and named in the
// turn's thread by the supervisor before the turn (questionNamed), so the words were said to it.
export function turnAnswer(what, v) {
  if (process.env.DEVTEAM_ROLE !== 'supervisor' || logWriter() !== 'supervisor') die(`${what} --from-turn: the supervisor records what the owner said in a thread; in your own terminal, answer directly`);
  if (flags['from-chat']) die(`${what}: --from-turn or --from-chat, not both`);
  const uid = flagStr('from-turn');
  if (!TURN_ID.test(uid ?? '')) die(`${what} --from-turn <u-id>: the owner's turn whose words settle it`);
  const u = logGet(uid);
  if (u?.type !== 'turn') die(`--from-turn ${uid}: no such turn`);
  if (u.created_by !== 'owner') die(`--from-turn ${uid}: that turn is the ${u.created_by}'s; only the owner's words settle a question`);
  // --said: whole clauses of the turn the question was asked about (thread ask --turn), a span no
  // other binding on the turn overlaps, with what the owner wrote since the question read first
  if (flags.said !== undefined) {
    if (v.about_turn !== uid) die(`--from-turn ${uid}: ${v.id} wasn't asked about that turn${v.about_turn ? ` (it's about ${v.about_turn})` : ''}; a clause binds only to the turn its question is about: thread ask ${u.thread} --turn ${uid} …, then answer that`);
    if (v.thread !== u.thread) die(`--from-turn ${uid}: ${v.id} was asked in ${v.thread}, and that turn is in ${u.thread}`);
    const c = turnClause(u.text, flagStr('said'), clauseAt());
    if (c.why) die(`--said: ${c.why}`);
    const clash = turnBindings(readLog().lines, uid).find((b) => spansOverlap(b.span, c.said_at));
    if (clash) die(clash.span ? `--said: those words overlap what already ${clash.kind === 'answer' ? 'settled' : 'corrected'} ${clash.id} (offsets ${clash.span[0]} to ${clash.span[1]}); one span settles one thing` : `--from-turn ${uid}: that turn already settled ${clash.id} whole; it takes no more`);
    const answerSeen = ownerTurnsRead(u.thread, logGet(v.seen ?? '')?.type === 'turn' ? logGet(v.seen) : u);
    return { said: c.said, said_at: c.said_at, turn: uid, answer_seen: answerSeen };
  }
  for (const k of ['at', 'seen-turn']) if (flags[k] !== undefined) die(`${what} --${k} goes with --said`);
  // the whole turn: refused once anything is bound to it (an answer, whole or a clause, or a correction)
  const used = turnBindings(readLog().lines, uid)[0];
  if (used) die(`--from-turn ${uid}: that turn already settled ${used.id}; one turn settles one question (the owner answers the other in the card, or says it again)`);
  if (v.thread && u.thread !== v.thread) die(`--from-turn ${uid}: ${v.id} was asked in ${v.thread}, and that turn is in ${u.thread}`);
  if (u.created_at <= v.asked_at) die(`--from-turn ${uid}: the turn is older than ${v.id}; words said before the question was asked don't answer it`);
  if (!v.thread && !questionNamed(readLog().objects, u.thread, v.id, u.created_at)) die(`--from-turn ${uid}: ${v.id} was asked in the Inbox, and no reply of yours in ${u.thread} named it before that turn; reply there first, quoting it, with --refs question:${v.id}, and record the owner's answer to that`);
  return { said: String(u.text), turn: uid };
}
// The owner answers (terminal, dashboard or, through the supervisor, chat). The supervisor may only
// apply a default or withdraw.
export function cmdAnswer() {
  // the words: after the qid, or after "--" (the dashboard's form, so words that start with "--" stay words)
  const [id, ...restWords] = [...positional, ...(rest ?? [])];
  const reviewResult = flagStr('review-result');
  const decline = !!flags.decline;
  // --read: the supervisor reads words the owner answered alone as one choice, citing the words it
  // rests on. It is a call in the question's class, which the owner can correct: its act, then the
  // reading, which questionView checks again itself.
  const readWords = () => {
    supervisorOnly('answer --read');
    const [label, cite, cls] = ['read', 'cite', 'class'].map(flagStr);
    if (!id || !label || !cite || !cls || restWords.length) die('usage: answer <qid> --read "<label>" --cite "<the owner\'s words it rests on>" --class <the question\'s class>   (supervisor)');
    for (const f of ['choice', 'in-words', 'defaulted', 'from-chat', 'from-turn', 'review-result', 'decline', 'files', 'autonomy', 'rule']) if (flags[f] !== undefined) die(`answer --read records the supervisor's reading of the owner's words: not with --${f}`);
    const q = logGet(id);
    const v = q?.type === 'question' ? questionView(q) : null;
    if (!v) die(`no question ${id}`);
    if (v.status !== 'answered') die(`${id} is not answered by the owner (${v.status}): a reading reads the owner's own words, never silence or a default`);
    if (v.in_words === null) die(`${id}'s answer carries no pick of its own (an older line, or one from the terminal, chat or a thread): its leading label is the answer; nothing to read`);
    if (!v.in_words) die(`${id} was answered with a pick ("${v.choice}"): that is the owner's choice; nothing to read`);
    if (v.reading) die(`${id} is already read as "${v.reading.choice}" (${v.reading.act}): a misreading is corrected (correct ${v.reading.act}), never read over`);
    const picked = v.labels.find((l) => l.trim().toLowerCase() === label.trim().toLowerCase());
    if (!picked) die(`--read "${label}" is not one of ${id}'s choices (${v.labels.join(', ') || 'it has none'})`);
    if (cls !== (v.class ?? v.kind)) die(`--class ${cls}: ${id} was asked in ${v.class ?? v.kind}; a reading is a call in the question's class`);
    if (OWNER_ACTS.includes(cls)) die(`${cls} acts are the owner's: ask back in its thread`);
    // a job change lands only on the owner's own Yes, never on a reading (d-20261120-195829274-supervisor)
    if (cls === 'recurring-edit') die(`${id} is a recurring-edit question: only the owner's own pick of Yes approves a job change, never a reading of their words; ask back in its thread, or ask again`);
    // the cite as the view will check it: everything else here already passes, so only the cite can fail
    const said = cite.replace(/\s+/g, ' ').trim();
    const reading = { choice: picked, cite: said, class: cls, of: v.answered_at };
    if (!questionView({ ...q, updates: [...q.updates, { at: nowIso(), by: 'supervisor', reading: { ...reading, act: '' } }] }).reading) die(`--cite "${said.slice(0, 80)}" is not the owner's words on ${id} as whole words: quote 1 to 600 characters of them exactly`);
    const act = appendLog({ type: 'act', class: cls, what: `read the owner's words on ${id} ("${said}") as "${picked}"`, refs: [id], reversible: true }, 'supervisor');
    appendLog({ type: 'question', op: 'set', id, reading: { ...reading, act: act.id } }, 'supervisor');
    out(`read ${id} as "${picked}" (${act.id}); the owner can correct it with correct ${act.id}`);
  };
  if (flags.read !== undefined) return readWords();
  // --choice records the owner's pick beside their words, --in-words their words alone: the owner's
  // own answer only, never a default, a review's result or words the supervisor recorded
  const picks = flags.choice !== undefined;
  const inWords = flags['in-words'] !== undefined;
  const pickFlag = picks ? 'choice' : inWords ? 'in-words' : null;
  if (flags.choice === true) die('answer <qid> ["<words>"] --choice "<label>": name the choice picked');
  if (picks && inWords) die('answer takes --choice or --in-words, not both: a pick (with any words), or words alone');
  if (pickFlag) for (const f of ['defaulted', 'from-chat', 'from-turn', 'review-result', 'decline']) if (flags[f] !== undefined) die(`answer --${pickFlag} records the owner's own pick or words: not with --${f}`);
  if (inWords && !restWords.join(' ').trim() && flags.files === undefined) die('answer <qid> "<words>" --in-words: the words are the answer; give them');
  if (flags['review-result'] === true) die('answer <qid> --review-result <file|->: the result file, or - for stdin');
  // dropped files go with the owner's own words, never with a default, a review's result or reason, or words the supervisor recorded
  if (flags.files !== undefined && (flags.defaulted || flags['review-result'] !== undefined || decline || flags['from-chat'] || flags['from-turn'] !== undefined)) die("--files go with the owner's own answer");
  if (!id || (!restWords.length && !flags.defaulted && !reviewResult && !decline && !picks && flags.files === undefined)) die('usage: answer <qid> "<answer>" [--files <json>] [--autonomy 1|2|3 [--scope s]] [--rule "<standing rule>" [--rule-scope s]]   |   answer <qid> --review-result <file|->   |   answer <qid> "<why>" --decline   |   answer <qid> "<answer>" --from-chat --said "<owner\'s words>" [--autonomy n] [--rule "<standing rule>"]   |   answer <qid> "<answer>" --from-turn <u-id> [--said "<whole clauses>" [--at <n>] [--seen-turn <u-id>]] [--autonomy n] [--rule "<standing rule>"]   |   answer <qid> ["<words>"] --choice "<label>"   |   answer <qid> "<words>" --in-words   |   answer <qid> --defaulted   (supervisor)   |   answer <qid> --read "<label>" --cite "<words>" --class <class>   (supervisor)');
  if (flags.defaulted) {
    supervisorOnly('answer --defaulted');
    const v = openQuestion(id);
    if (!v.default) die(`${id} has no default to apply`);
    // a default fires at its deadline, not before, and only where it could fire when asked (defaultGap)
    { const why = defaultGap(v, new Date().toISOString()); if (why) die(why); }
    // a default never overrides the owner's later no on the same remediation and target
    if (v.class === 'production-remediation') {
      const rem = (v.blocks ?? []).find((b) => b.startsWith('remediation:'));
      const rel = (v.blocks ?? []).find((b) => b.startsWith('release:')) ?? null;
      const denied = rem ? remediationDenied(v, rem, rel) : null;
      if (denied) die(remediationDeniedWords(rem.slice('remediation:'.length), rel, denied));
    }
    appendLog({ type: 'question', op: 'set', id, status: 'defaulted' }, 'supervisor');
    appendLog({ type: 'act', class: 'apply-default', what: `applied the default to ${id}: ${v.default}`, refs: [id], reversible: true }, 'supervisor');
    return out(`defaulted ${id}: ${v.default}`);
  }
  // --from-chat: the owner said it in the supervisor's own session, and that carries the same
  // weight as answering in the Inbox, for every question and everything that reads an answer. The
  // supervisor records it as the owner's answer with their words verbatim; the dashboard lists it
  // for the owner to check, and metrics flags a quote the transcript doesn't show them typing.
  const fromChat = !!flags['from-chat'];
  if (fromChat) chatAnswer('answer');
  const fromTurn = flags['from-turn'] !== undefined;
  // --at and --seen-turn pick and read a turn's clause: only with --from-turn --said (final-1 F2)
  if (!fromTurn) for (const k of ['at', 'seen-turn']) if (flags[k] !== undefined) die(`answer --${k} goes with --from-turn <u-id> --said`);
  const { by } = fromChat || fromTurn ? ownerWriter(null, { heard: true }) : ownerWriter();
  const files = filesFlag();
  const v = openQuestion(id, ['open', 'defaulted']);
  // a job change takes only the owner's own Yes: never words the supervisor records from chat, and
  // from a turn only when the owner's words there start with it (final-11b F1)
  if (fromChat && v.class === 'recurring-edit') die(`${id} is a recurring-edit question: only the owner's own Yes approves a job change, never words recorded from chat; the owner answers it in the card, or says Yes in its thread (answer --from-turn)`);
  // and only a whole owner turn newer than the question: a clause (--said) may sit in a No, or in a
  // turn written before the question about something else (final-12b F1)
  if (fromTurn && v.class === 'recurring-edit' && flags.said !== undefined) die(`${id} is a recurring-edit question: only a whole owner turn newer than the question approves a job change, never a clause of one (--said); the owner says Yes in its thread, then answer ${id} "Yes" --from-turn <that turn>`);
  if (pickFlag) {
    const own = v.kind === 'review' ? 'a review' : v.kind === 'goal-approval' ? 'a goal approval' : (v.secrets ?? []).length ? 'a secrets question' : null;
    if (own) die(`answer --${pickFlag}: ${id} is ${own}, answered its own way, not by a pick or words alone`);
  }
  const picked = picks ? v.labels.find((l) => l.trim().toLowerCase() === flagStr('choice').trim().toLowerCase()) : undefined;
  if (picks && !picked) die(`answer --choice "${flagStr('choice')}" is not one of ${id}'s choices (${v.labels.join(', ') || 'it has none'})`);
  // a goal-met answer marks the goal met or not, so it is a pick, never words to read
  if (inWords && v.class === 'goal-met') die(`${id} is a goal-met question: pick Yes or No (answer ${id} ["<words>"] --choice Yes|No)`);
  if (fromTurn && v.kind === 'review') die(`${id} is a review: its answer is the owner's result, which a turn can't carry`);
  const turn = fromTurn ? turnAnswer('answer', v) : null;
  if (turn && v.class === 'recurring-edit' && !recurringRegistry.saysYes(turn.said)) die(`--from-turn ${turn.turn}: ${id} is a recurring-edit question, and the owner's words there don't start with Yes ("${String(turn.said).slice(0, 80)}"): only the owner's own Yes approves a job change; ask back in its thread`);
  // and never once the owner has written anything after it in its thread: their later words may take
  // it back ("Wait, no"), so the Yes is shown again and their next turn taken (final-14b F3). Any
  // later owner line counts, whatever it answers or binds (d-20261121-072341505-supervisor, final-16b
  // F1 to F4, final-17b F1): recurringRegistry.laterOwner. So each recurring-edit answer is recorded
  // before the next question is shown.
  if (turn && v.class === 'recurring-edit') {
    const u = logGet(turn.turn);
    const what = u ? recurringRegistry.laterOwner(u) : null;
    if (what) die(`--from-turn ${turn.turn}: ${id} is a recurring-edit question, and the owner wrote again after that turn (${what}): their later words may take the Yes back; show it again (thread reply <t-id> "…" --refs question:${id}) and take their next turn; record each recurring-edit answer before you show the next question`);
  }
  // and only the owner's very next turn after the supervisor's turn that shows it, so a Yes said to
  // another question, in a turn or in plain words, or after a No, binds nothing (final-13b F1, final-14b F1)
  { const why = turn && v.class === 'recurring-edit' ? recurringRegistry.turnBinds(logGet(turn.turn), id) : null; if (why) die(`--from-turn ${turn.turn}: ${id} is a recurring-edit question, and that turn isn't the owner's first right after your turn that shows it (${why}): only the owner's Yes right after the question approves a job change; show it again (thread reply <t-id> "…" --refs question:${id}) and take their next turn`); }
  // a credential question has two answers: the token posted, or don't use this sensor
  if (v.sensor && !/^don['’]?t use this sensor\s*$/i.test(restWords.join(' ').trim())) die(`${id} asks for a sensor's token: post it (dashboard, or devteam.mjs secret post ${id}), or answer "Don't use this sensor". Any other answer would close it with neither`);
  if (flagStr('seen') && flagStr('seen') !== v.hash) die(`${id} changed since you saw it; reload and read it again before you answer`);
  { const moved = artifactLinksMoved(v); if (moved) die(moved); }
  if (v.kind === 'goal-approval') die(`${id} approves a goal on its design: the owner answers it with goal decide ${v.goal} approve|refine|let-go [--notes "…"] (or on the dashboard)${fromChat ? `; from chat, goal decide ${v.goal} <verdict> --from-chat --said "<the owner's words>"` : fromTurn ? `; from a thread, goal decide ${v.goal} <verdict> --from-turn <u-id>` : ''}`);
  // A review is answered by the owner's own process with its result, or sent back with a reason;
  // never in free text, wherever it comes from (a result file carries the rows, and chat can't).
  if (v.kind === 'review' || reviewResult || decline) {
    if (v.kind !== 'review') die(`--review-result and --decline answer a review question; ${id} is ${v.kind}`);
    if (v.status !== 'open') die(`${id} is already ${v.status}`);
    if (reviewResult && decline) die('a review is answered with --review-result or sent back with --decline, not both');
    if (!reviewResult && !decline) die(`${id} is a review: answer it with its result (answer ${id} --review-result <file|->) or send it back (answer ${id} "<why>" --decline)`);
    if (reviewResult && restWords.length) die('answer --review-result takes no text: the result is the answer');
    if (decline && !restWords.join(' ').trim()) die(`answer ${id} "<why>" --decline: say why it goes back`);
  }
  // files alone (no words, no pick): the log needs words, so the answer names the count, as the
  // pane line does (droppedWords)
  const typed = restWords.join(' ').trim() || (files?.length && !picked ? `${plural(files.length, 'file')} dropped` : '');
  // a pick is written as the set spells it, with the owner's words after it
  const answer = picked ? (typed ? `${picked} — ${typed}` : picked) : typed;
  let autonomy;
  if (flags.autonomy !== undefined) {
    const def = ladder().classes[v.class];
    if (!def) die(`${id} has no ladder class, so it carries no autonomy direction`);
    const rung = flagNum('autonomy');
    if (![1, 2, 3].includes(rung)) die('--autonomy is 1 (ask), 2 (ask with a default) or 3 (act and report)');
    if (rung > def.ceiling) die(`${v.class} has a ceiling of rung ${def.ceiling} (constitution.md)`);
    autonomy = { class: v.class, rung, scope: flagStr('scope') ?? null };
  }
  const reviewFields = reviewResult ? acceptReviewResult(v, reviewResult, fromChat ? 'chat' : ownerChannel()) : decline ? { answer: `Sent back: ${answer}`, declined: true } : {};
  // a goal-met question is answered Yes or No, so a near-yes can't pass for a no
  if (v.class === 'goal-met' && v.met && !GOAL_MET_CHOICES.some((c) => sameAnswer(answer, c.label))) die(`${id} is answered Yes or No (a note may follow " — ")`);
  const setLine = { type: 'question', op: 'set', id, answer, ...(pickFlag ? { choice: picked ?? null } : {}), autonomy, standing_rule: flagStr('rule'), ...reviewFields, ...(fromChat ? { channel: 'chat', said: flagStr('said').trim() } : turn ? { channel: 'thread', said: turn.said, turn: turn.turn, said_at: turn.said_at, answer_seen: turn.answer_seen } : {}), files };
  if (files && !lineFits(setLine, by)) die(FILES_TOO_LONG);
  // a goal-met yes reads a repo or prod check again first: a failed check writes nothing
  const metPlan = v.class === 'goal-met' ? goalMetPlan(v, answer) : null;
  appendLog(setLine, by);
  const metNote = metPlan ? goalMetApply(v, metPlan, by, fromChat ? { channel: 'chat' } : turn ? { channel: 'thread' } : {}) : null;
  if (v.kind === 'review') fs.rmSync(reviewDraftFile(id), { force: true });
  // A standing rule applies where the owner says (--rule-scope), else where the question says its
  // rule would apply (ask --rule-scope; the dashboard shows it next to the rule field), else the
  // whole project.
  if (flagStr('rule')) appendLog({ type: 'knowledge', kind: 'preference', statement: flagStr('rule'), scope: flagStr('rule-scope') ?? v.rule_scope ?? 'project', status: 'accepted', confidence: 1, evidence: [id], channel: fromChat ? 'chat' : turn ? 'thread' : undefined }, by);
  // The answer this question said would settle others: the supervisor withdraws each (its own act).
  // with a pick recorded, the pick decides it: words alone settle nothing
  const settles = pickFlag ? !!picked && sameAnswer(picked, v.settles_if) : sameAnswer(answer, v.settles_if);
  const settled = settles ? v.settles.filter((s) => { const x = logGet(s); return x?.type === 'question' && questionView(x).status === 'open'; }) : [];
  const settledNote = settled.length ? `it settles ${plural(settled.length, 'open question')} (${settled.join(', ')}): withdraw each with withdraw <qid> --reason "settled by the owner's answer to ${id}"` : '';
  if (!fromChat && !turn) nudgeSupervisor(`[devteam answer ${id} from owner] read it with: devteam.mjs questions --id ${id}${metNote ? `; ${metNote}` : ''}${settledNote ? `; ${settledNote}` : ''}${droppedWords(files)}`, droppedPaths(files));
  out(`${decline ? 'sent back' : 'answered'} ${id}${fromChat ? ' (from chat; listed on the dashboard for the owner to check)' : turn ? ` (from ${turn.turn}; listed on the dashboard for the owner to check)` : reviewFields.result ? `: ${reviewFields.answer} (result sha256 ${reviewFields.result.sha256.slice(0, 12)})` : ''}`);
  if (metNote) out(metNote);
  if (settledNote && (fromChat || turn)) out(settledNote);
  // the owner's own answer resolves the question's thread; the supervisor's record of the owner's
  // turn there proposes it; chat, a default and a review sent back leave it open (kit-720)
  if (turn) resolveQuestionThreads(id, null, 'supervisor', { turn: { id: turn.turn, thread: logGet(turn.turn)?.thread, said: turn.said } });
  else if (!fromChat && !decline) resolveQuestionThreads(id, setLine.answer, by);
}
// Answering a question resolves its thread (kit-720, question-threads D2): each open thread whose
// subject is the question (question:<qid>, "Ask about this") ends with the answer. The owner's own
// answer resolves it with the owner's thread set and thread-resolved observation, as thread resolve
// writes them. The supervisor's record of the owner's words from a turn in that thread (turn: its
// id, thread and the words the answer recorded) only proposes it (thread ready), since resolving is
// the owner's alone (threadOwner): the owner's Accept resolves it. Every line is checked before
// anything is written, and a thread whose lines the log would refuse is left open with a warning:
// the answer is already written, and it stands.
export function resolveQuestionThreads(qid, answer, by, { turn = null } = {}) {
  const ell = '…';
  const flat = (s) => redactClaimLinks(String(s ?? '')).replace(UNSAFE_TEXT_ALL, ' ').replace(/\s+/g, ' ').trim();
  // a cut can make a claim link match again, and appendLog's own redaction would then take it past
  // OUTCOME_MAX: redact and cut until neither changes it, up to eight rounds (a link with more "%23"
  // than that is for the check below, and may be printed less redacted than it is logged)
  const cut = (s) => {
    let x = flat(s);
    for (let i = 0; i < 8; i++) {
      const y = Buffer.byteLength(x) <= OUTCOME_MAX ? x : `${capBytes(x, OUTCOME_MAX - Buffer.byteLength(ell))}${ell}`;
      if ((x = flat(y)) === y) break;
    }
    return x;
  };
  // a line as appendLog would write it, refused here instead of there (checkLine, LINE_MAX)
  const refusal = (fields, w) => {
    const text = `${JSON.stringify(logLineFor(redactClaimLinks(fields), w, `${SCHEMA['x-id'].prefix[fields.type]}-00000000-000000000-${w}`))}\n`;
    const errs = checkLine(JSON.parse(text), logFileFor(w, fields.type));
    if (Buffer.byteLength(text) > LINE_MAX) errs.push(`the line is over ${LINE_MAX} bytes`);
    return errs.length ? errs.join('; ') : null;
  };
  logCache = null;
  const ref = `question:${qid}`;
  const open = threadViews(readLog().objects).filter((v) => v.status === 'open' && v.subject?.kind === 'item' && v.subject.ref === ref && (!turn || v.id === turn.thread));
  for (const v of open) {
    // an answer that already says Answered (a review's result) isn't said twice
    const outcome = cut(turn ? `Answered in thread: ${turn.said}` : /^Answered: /.test(String(answer)) ? String(answer) : `Answered: ${answer}`);
    const lines = turn ? [[{ type: 'thread', op: 'set', id: v.id, ready: { outcome, at: nowIso() } }, 'supervisor']]
      : [[{ type: 'thread', op: 'set', id: v.id, status: 'resolved', outcome: outcome || null }, by], [{ type: 'observation', source: 'owner', subject: `thread:${v.id}`, kind: 'thread-resolved', detail: outcome || 'resolved', refs: [v.id, ...subjectIds(v.subject)] }, by]];
    const why = (UNSAFE_TEXT.test(outcome) ? 'the outcome is not one line of plain text' : Buffer.byteLength(outcome) > OUTCOME_MAX ? `the outcome is over ${OUTCOME_MAX} bytes` : null) ?? lines.map(([f, w]) => refusal(f, w)).find(Boolean);
    if (why) { warn(`${v.id} stays open (${why}); ${qid} is answered, so ${turn ? 'propose it yourself (thread ready)' : 'resolve it by hand (thread resolve)'}`); continue; }
    // still open as it is written: a resolve since the read is the owner's, and stands
    logCache = null;
    if (logGet(v.id)?.status === 'resolved') continue;
    // a thrown file error (die exits, and isn't caught) is a warning too: the answer stands
    try { for (const [f, w] of lines) appendLog(f, w); } catch (e) { warn(`${v.id}: its lines were not all written (${e.code ?? e.message}); ${qid} is answered, so check the thread (thread show ${v.id}) and ${turn ? 'propose it yourself (thread ready)' : 'resolve it by hand (thread resolve)'}`); continue; }
    // the thread's turn is settled, as thread resolve and thread ready clear it (spoke)
    try { markThreadWorking(v.id, null); } catch {}
    out(turn ? `proposed resolving ${v.id}: ${outcome} (the owner's Accept resolves it)` : `resolved ${v.id}: ${outcome}`);
  }
}
export function cmdWithdraw() {
  const [id] = positional;
  if (!id) die('usage: withdraw <qid> [--reason r]');
  supervisorOnly('withdraw');
  openQuestion(id);
  appendLog({ type: 'question', op: 'set', id, status: 'withdrawn', reason: flagStr('reason') }, 'supervisor');
  appendLog({ type: 'act', decision: citing(), class: 'withdraw-question', what: `withdrew ${id}${flagStr('reason') ? `: ${flagStr('reason')}` : ''}`, refs: [id], reversible: true }, 'supervisor');
  out(`withdrew ${id}`);
}
// rate: the supervisor rates an open question again (its stake, its urgency, what it settles). One
// set line; the order is computed from it on the next read. --settles adds to what it settles.
export function cmdRate() {
  const [id] = positional;
  const usage = 'usage: rate <qid> [--stake 1-3] [--urgency 1-3] [--settles <qid>… | --settles none] [--unsettles <qid>…] [--settles-if "<the answer that settles them>"]';
  if (!id) die(usage);
  supervisorOnly('rate');
  const v = openQuestion(id);
  const r = ratingFlags();
  const clear = flagStr('settles') === 'none';
  const added = clear ? [] : idsFlag('settles').filter((x) => !v.settles.includes(x));
  const drop = idsFlag('unsettles');
  if (flags.settles === true || flags.unsettles === true) die(usage);
  if (r.stake === undefined && r.urgency === undefined && flags.settles === undefined && !drop.length && flags['settles-if'] === undefined) die(usage);
  for (const d of drop) if (!v.settles.includes(d)) die(`${id} doesn't settle ${d}`);
  const settles = clear ? [] : [...v.settles, ...added].filter((x) => !drop.includes(x));
  const stake = r.stake ?? v.stake ?? undefined;
  const settlesIf = flagStr('settles-if') ?? v.settles_if ?? undefined;
  if (flags['settles-if'] !== undefined && !settles.length) die('--settles-if needs --settles <qid>…: the questions that answer settles');
  settleChecks({ self: id, kind: v.kind, stake, settles, added, settlesIf, choices: v.choices, about: questionAbout(v) });
  const changed = clear || added.length || drop.length;
  appendLog({ type: 'question', op: 'set', id, ...r, settles: changed ? settles : undefined, settles_if: flagStr('settles-if') }, 'supervisor');
  ratingWarnings({ stake, urgency: r.urgency, blocks: v.blocks, def: v.default });
  const rank = inboxRanks(questions().filter((q) => q.status === 'open' && q.goal_hold !== 'let-go')).get(id);
  out(`rated ${id}${rank ? `: ${rank.position} of ${rank.of} in the Inbox, score ${rank.score}${rank.reason ? ` (${rank.reason})` : ''}` : ''}`);
}

