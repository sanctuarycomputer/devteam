/* imports start */
import { RUNG } from './links.mjs';
import { byTime } from './log-sync.mjs';
import { calls } from './log-sync.mjs';
import { correctionOf } from './log-sync.mjs';
import { flagStr } from './base.mjs';
import { flags } from './base.mjs';
import { json } from './base.mjs';
import { ladder } from './links.mjs';
import { logGet } from './log-sync.mjs';
import { logObjects } from './log-sync.mjs';
import { out } from './base.mjs';
import { questionView } from './log-sync.mjs';
import { questions } from './log-sync.mjs';
import { readLog } from './log-sync.mjs';
import { releasesOnMerge } from './sensors.mjs';
import { writerClass } from './log.mjs';
/* imports end */
// The rung a ladder class is on: its start, then every owner direction and every correction of an
// act in the class (a drop to 1), in time order, capped at the ceiling.
// How a class's rung moved: the owner's trust answers set it, a correction on a call in the class
// drops it to 1. Oldest first; each event says what moved it.
export function rungHistory(cls, scope = null) {
  const events = [];
  for (const q of questions()) if (q.status === 'answered' && q.autonomy?.class === cls && (!q.autonomy.scope || q.autonomy.scope === scope)) events.push({ at: q.answered_at, rung: q.autonomy.rung, by: 'answer', id: q.id, why: q.question });
  for (const a of calls()) { const c = correctionOf(a); if (c && a.class === cls) events.push({ at: c.at, rung: 1, by: 'correction', id: a.id, why: c.reason }); }
  return events.sort((a, b) => a.at.localeCompare(b.at));
}
export function rungFor(cls, scope = null) {
  const def = ladder().classes[cls];
  if (!def) return null;
  let r = def.start;
  for (const e of rungHistory(cls, scope)) r = e.rung;
  r = Math.min(r, def.ceiling);
  // where merging releases, merging a fix deploys it: rung 3 (decide and tell) only with
  // release-production at 3. Rung 2 stays, so a fix can still go ahead at its default.
  const cap = cls === 'incident-fix' && releasesOnMerge() ? Math.max(2, rungFor('release-production')) : null;
  if (cap != null) r = Math.min(r, cap);
  return r;
}
// Evidence for a trust question: how often the owner went with the supervisor's recommendation on
// the last N answered questions of the class (defaulted answers don't count, nor words alone, read
// or not: a reading is the supervisor's, not the owner's agreement), and calls in the class since it
// last dropped (decisions, and acts that were their own), none corrected.
export function trustEvidence(cls) {
  const promo = ladder().promotion;
  const acts = calls().filter((a) => a.class === cls).sort(byTime);
  const drops = acts.map(correctionOf).filter(Boolean).map((c) => c.at).sort();
  const since = drops[drops.length - 1] ?? '';
  const after = acts.filter((a) => a.created_at > since);
  const answered = questions().filter((q) => q.class === cls && q.status === 'answered' && !q.in_words && (q.recommendation || (q.kind === 'review' && (q.review?.data?.proposals ?? 0) > 0))).sort((a, b) => a.answered_at.localeCompare(b.answered_at)).slice(-promo.agreement_window);
  const agree = answered.filter((q) => q.agreed_by_owner).length;
  return {
    acts_since_drop: after.length, uncorrected_acts: after.filter((a) => !correctionOf(a)).map((a) => a.id), corrections: drops.length,
    agreement: answered.length ? +(agree / answered.length).toFixed(2) : null, agreement_questions: answered.map((q) => q.id),
    meets_agreement: answered.length >= promo.agreement_window && agree / answered.length >= promo.agreement,
  };
}
export function trustTable() {
  return Object.entries(ladder().classes).map(([cls, def]) => {
    const ev = trustEvidence(cls);
    const rung = rungFor(cls);
    return { class: cls, about: def.about, rung, rung_name: RUNG[rung], ceiling: def.ceiling, start: def.start, ...ev, can_ask: rung < def.ceiling && ev.meets_agreement, history: rungHistory(cls) };
  });
}

// What a call rested on, for one that recorded none (an act that was its own decision).
export function actAuthority(a) {
  const L = ladder();
  if (a.approved_by?.startsWith('k-')) return 'standing-rule';
  if (a.approved_by) { const q = logGet(a.approved_by); return q?.type === 'question' && questionView(q).status === 'defaulted' ? 'default' : 'answer'; }
  if (L.classes[a.class] && a.rung === 3) return 'rung';
  return 'constitution';
}
// The Decide view: every call, who made it and under what. The supervisor's decisions and the acts
// that were their own decision; the owner's calls computed from the owner's own lines (answers, goal
// verdicts and holds, standing rules, corrections), shown as they are and never rewritten as
// decision lines. Newest first.
export function decisionRecords() {
  const acts = logObjects('act').filter((a) => a.created_by !== 'owner');
  const carried = new Map();
  for (const a of acts) if (a.decision) (carried.get(a.decision) ?? carried.set(a.decision, []).get(a.decision)).push(a.id);
  const rows = [];
  const allCalls = calls();
  const usedBy = new Map();
  for (const c of allCalls) if (c.approved_by) (usedBy.get(c.approved_by) ?? usedBy.set(c.approved_by, []).get(c.approved_by)).push(c.id);
  const call = (o, kind, under) => ({
    id: o.id, at: o.created_at, who: 'supervisor', kind, class: o.class, scope: o.scope ?? null, what: o.what, rationale: o.rationale ?? null, options: o.options ?? [], confidence: o.confidence ?? null,
    refs: o.refs ?? [], reversible: o.reversible !== false, under, acts: kind === 'decision' ? carried.get(o.id) ?? [] : [], correction: correctionOf(o),
  });
  for (const d of logObjects('decision')) rows.push(call(d, 'decision', { authority: d.authority, rung: d.rung ?? null, ceiling: d.ceiling ?? null, approved_by: d.approved_by ?? null }));
  for (const a of acts) if (!a.decision) rows.push(call(a, 'act', { authority: actAuthority(a), rung: a.rung ?? null, ceiling: ladder().classes[a.class]?.ceiling ?? null, approved_by: a.approved_by ?? null }));
  for (const q of questions()) {
    if (q.status !== 'answered') continue;
    rows.push({
      id: q.id, at: q.answered_at, who: 'owner', kind: 'answer', class: q.class, scope: q.scope, what: `${q.question} → ${q.answer}`, refs: [q.ticket, q.goal].filter(Boolean),
      under: { recommendation: q.recommendation || null, matched: q.matched ?? null, autonomy: q.autonomy, standing_rule: q.standing_rule, channel: q.channel }, acts: usedBy.get(q.id) ?? [], correction: null,
    });
  }
  for (const g of readLog().objects.values()) {
    if (g.type !== 'goal') continue;
    const title = g.kind === 'upkeep' ? 'Upkeep' : `"${g.title}"`;
    for (const u of g.updates ?? []) {
      if (writerClass(u.by) !== 'owner') continue;
      const said = [
        u.decision ? `${u.decision.verdict}${u.decision.notes ? ` (${u.decision.notes})` : ''}${u.decision.question ? ` (${u.decision.question})` : ''}` : null,
        u.status !== undefined && !u.decision ? `status ${u.status}` : null,
        u.hold !== undefined ? (u.hold ? `${u.hold.mode}${u.hold.reason ? ` (${u.hold.reason})` : ''}` : 'run') : null,
      ].filter(Boolean);
      if (said.length) rows.push({ id: g.id, at: u.at, who: 'owner', kind: 'goal', class: u.hold !== undefined ? 'goal-hold' : u.decision?.verdict === 'met' ? 'goal-met' : 'goal-approval', scope: null, what: `${title}: ${said.join('; ')}`, refs: [g.id], under: null, acts: [], correction: null });
    }
  }
  for (const k of logObjects('knowledge')) {
    if (writerClass(k.created_by) !== 'owner' || k.status === 'retired') continue;
    rows.push({ id: k.id, at: k.created_at, who: 'owner', kind: 'rule', class: null, scope: k.scope ?? null, what: k.statement, refs: k.evidence ?? [], under: { status: k.status }, acts: usedBy.get(k.id) ?? [], correction: null });
  }
  for (const c of allCalls) {
    const x = correctionOf(c);
    if (x) rows.push({ id: c.id, at: x.at, who: writerClass(x.by), kind: 'correction', class: c.class, scope: c.scope ?? null, what: `corrected "${c.what}": ${x.reason}`, refs: [c.id], under: { severity: x.severity ?? null, repaired: x.repaired }, acts: [], correction: null });
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}
export const AUTHORITY_WORDS = { rung: 'its rung', answer: 'the owner\'s answer', default: 'a default', 'standing-rule': 'a standing rule', constitution: 'the constitution' };
export function cmdDecisions() {
  let rows = decisionRecords();
  if (flagStr('who')) rows = rows.filter((r) => r.who === flagStr('who'));
  if (flagStr('class')) rows = rows.filter((r) => r.class === flagStr('class'));
  if (flags.corrected) rows = rows.filter((r) => r.correction || r.kind === 'correction');
  rows = rows.slice(0, Number(flagStr('tail') ?? 50));
  if (flags.json) return json(rows);
  if (!rows.length) return out('no decisions');
  for (const r of rows) {
    const under = ['decision', 'act'].includes(r.kind) ? ` under ${AUTHORITY_WORDS[r.under.authority] ?? r.under.authority}${r.under.rung ? ` (rung ${r.under.rung}${r.under.ceiling ? ` of ${r.under.ceiling}` : ''})` : ''}${r.under.approved_by ? ` ${r.under.approved_by}` : ''}` : '';
    out(`${r.at.slice(0, 16).replace('T', ' ')} ${r.who.padEnd(10)} ${(r.kind).padEnd(10)} ${r.class ?? '-'}: ${String(r.what).slice(0, 120)}${under}${r.correction ? `  CORRECTED: ${r.correction.reason}` : ''}`);
  }
}
export function cmdTrust() {
  const rows = trustTable();
  if (flags.json) return json(rows);
  for (const r of rows) out(`${r.class.padEnd(20)} rung ${r.rung} (${r.rung_name}) of ${r.ceiling}; agreement ${r.agreement ?? '-'} on ${r.agreement_questions.length}; acts since last drop ${r.acts_since_drop}; corrections ${r.corrections}${r.can_ask ? '  -> evidence supports a trust question' : ''}`);
}

// ===== 8. decide and act =====

