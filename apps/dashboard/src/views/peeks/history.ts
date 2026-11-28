// kit-997: a peek's history (index.html's peeks lines 5536-5595): the words for each change and the History section.
import { emptyVal } from '../review';
import { empty, esc } from '../shell';
import { actView, cap, dlink, flink, glink, linkify, qlink, tlink, when, who, words } from '../words';
import { wordsState } from '../words/state';
import { decisionTitle, fmtShort, psect, unitOf } from './props';
import { peeksState } from './state';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


export const NEW_WORDS = { goal: 'Proposed', feature: 'Planned', problem: 'Opened', knowledge: 'Proposed', ticket: 'Added to the plan', observation: 'Noticed', question: 'Asked', decision: 'Decided', act: 'Did' };
// A set line on the object itself carries what it replaced: each field from what to what.
export function changeView(l: Loose) {
  const by = cap(who(l.by));
  const fields = Object.keys(l).filter((k: Loose) => !ENVELOPE_KEYS.includes(k) && k !== 'prev');
  if (l.type === 'ticket' && fields.length === 1 && fields[0] === 'held') return ['', l.held ? `${esc(by)} put it on hold: ${linkify(l.held)}` : `${esc(by)} took it off hold`];
  if (l.type === 'goal' && fields.length === 1 && fields[0] === 'hold') return ['', `${esc(by)} set it to ${esc(words(l.hold?.mode ?? 'run'))}${l.hold?.reason ? `: ${linkify(l.hold.reason)}` : ''}`];
  const objs = (v: Loose) => Array.isArray(v) && v.some((x: Loose) => x && typeof x === 'object') || (v && typeof v === 'object' && !Array.isArray(v));
  const one = (k: Loose) => (k === 'decision' && l.decision?.verdict ? `<b>verdict</b> ${esc(words(l.decision.verdict).toLowerCase())}${l.decision.notes ? `: ${linkify(l.decision.notes)}` : ''}` : k === 'hold' ? `<b>hold</b> to ${esc(words(l.hold?.mode ?? 'run').toLowerCase())}` : objs(l[k]) || objs(l.prev?.[k]) ? `<b>${esc(words(k).toLowerCase())}</b>${Array.isArray(l[k]) ? ` (now ${l[k].length})` : ''}` : `<b>${esc(words(k).toLowerCase())}</b> ${emptyVal(l.prev?.[k]) ? '' : `from ${fmtShort(l.prev[k])} `}to ${fmtShort(l[k])}`);
  return ['', `${esc(by)} changed ${fields.map(one).join('; ')}`];
}
export const ENVELOPE_KEYS = ['v', 'id', 'type', 'op', 'at', 'by', 'channel'];
export function lineView(l: Loose, self: Loose) {
  const by = who(l.by);
  if (l.ignored) return ['', `<span class="muted">${esc(cap(by))} tried to ${l.op === 'new' ? 'add' : 'change'} ${esc(Object.keys(l).filter((k: Loose) => !ENVELOPE_KEYS.includes(k) && !['prev', 'ignored'].includes(k)).map((k: Loose) => words(k).toLowerCase()).join(', ') || l.type)}: ignored (${esc(l.ignored)})</span>`];
  if (l.op === 'set' && l.prev && !['question', 'decision', 'act'].includes(l.type)) return changeView(l);
  if (l.op === 'new' && l.id === self && !['phase', 'gate', 'message', 'question', 'decision', 'act'].includes(l.type)) return ['', `${esc((NEW_WORDS as Loose)[l.type] || 'Created')} by ${esc(by)}`];
  switch (l.type) {
    case 'ticket': {
      if (l.op === 'new') return ['', `${esc(cap(by))} added ${tlink(l.id)} to the plan`];
      const keys = Object.keys(l).filter((k: Loose) => (wordsState.FIELD_WORDS as Loose)[k]);
      if (keys.length === 1 && keys[0] === 'held') return ['', l.held ? `${esc(cap(by))} put ${tlink(l.id)} on hold: ${linkify(l.held)}` : `${esc(cap(by))} took ${tlink(l.id)} off hold`];
      return ['', `${esc(cap(by))} changed ${keys.map((k: Loose) => (wordsState.FIELD_WORDS as Loose)[k]).join(', ') || 'details'}${l.id !== self ? ` of ${tlink(l.id)}` : ''}`];
    }
    case 'phase': return l.to === 'supervisor' || (l.from && l.from === l.to) ? null : ['', `Agent: ${esc((wordsState.PHASE_WORDS as Loose)[l.to] || l.to)}${l.task ? ` (${esc(l.task)})` : ''}${l.note ? ` · ${linkify(l.note)}` : ''}`];
    case 'gate': return [l.ok ? 'gate' : 'gate fail', `Check “${esc(l.gate)}” ${l.ok ? 'passed' : 'failed'}${l.sha ? ` at <code>${esc(l.sha.slice(0, 12))}</code>` : ''}`];
    case 'message': return ['msg', `${esc(cap(by))} ${esc((peeksState.MSG_WORDS as Loose)[l.kind] || l.kind)}${l.to ? ` → ${esc(who(l.to))}` : ''}: ${linkify(l.text)}`];
    case 'question': return l.op === 'new' ? ['q', `Asked you: ${qlink(l.id, l.question)}`] : l.answer !== undefined ? ['q', `You answered ${qlink(l.id, 'the question')}: <b>${esc(l.answer)}</b>`] : l.status ? ['q', `Question ${esc(l.status)}${l.reason ? `: ${linkify(l.reason)}` : ''}`] : null;
    case 'act': {
      if (l.op === 'set') return l.corrected ? ['act', `${esc(cap(by))} corrected it: ${esc(l.corrected.reason)}`] : l.repaired ? ['act', `${esc(cap(by))} repaired it: ${esc(l.repaired)}`] : null;
      if (['add-ticket', 'replan-within-feature'].includes(l.class)) return null;
      const v = actView(l);
      return ['act', `${v.head}${v.detail ? `<div class="act-detail">${v.detail}</div>` : ''}${l.decision ? `<div class="act-detail">under ${dlink(l.decision, decisionTitle(l.decision))}</div>` : ''}`];
    }
    case 'decision': return l.op === 'new' ? ['act', `The supervisor decided (${esc(words(l.class))}): ${dlink(l.id, l.what)}${l.rationale ? `<div class="act-detail">${linkify(l.rationale)}</div>` : ''}`] : l.corrected ? ['act', `${esc(cap(by))} corrected ${dlink(l.id, 'a decision')}: ${esc(l.corrected.reason)}`] : l.repaired ? ['act', `${esc(cap(by))} repaired ${dlink(l.id, 'a decision')}: ${esc(l.repaired)}`] : null;
    case 'observation': return l.kind === 'reading' && l.measure ? ['', `${esc(cap(by))} read the measure: <b>${esc(l.measure.value)}</b>${unitOf(l.measure.unit)}`] : ['', `${esc(cap(by))} noticed (${esc(words(l.kind))}): ${linkify(l.detail)}`];
    case 'knowledge': return l.op === 'new' ? ['', `Learned: ${linkify(l.statement)}`] : ['', `${esc(cap(by))} set ${linkify(l.id)} to ${esc(l.status ?? 'changed')}`];
    case 'spend': return ['', `Spent $${esc(Number(l.usd ?? 0).toFixed(2))} (${esc(l.role ?? 'agent')}${l.phase ? `, ${esc(l.phase)}` : ''})`];
    case 'goal': return ['', `${esc(cap(by))} ${l.op === 'new' ? 'proposed' : 'changed'} ${glink(l.id)}`];
    case 'feature': return ['', `${esc(cap(by))} ${l.op === 'new' ? 'planned' : 'changed'} ${flink(l.id)}`];
    case 'problem': return ['', `${esc(cap(by))} ${l.op === 'new' ? 'opened' : 'updated'} a problem: ${linkify(l.title ?? l.id)}${l.status ? ` (${esc(l.status)})` : ''}`];
    default: return ['', `${esc(words(l.type))} ${esc(l.op)}`];
  }
}
// Always the last card of a peek, a missing or failed one's too (kit-88 spec §2.2).
// ui-candidate: timeline (apps-src@2: src/shared/ui/ has no component yet, so the port keeps index.html's markup)
export function historySection(peek: Loose, self: Loose) {
  const card = (html: Loose) => psect('History', html);
  if (peek === undefined) return card('<p class="loading">Loading…</p>');
  if (peek?.transient) return card(empty('Could not load it just now.'));
  if (!peek || peek.error) return card(empty('None'));
  if (peeksState.DRAWER.kind === 'file') {
    const cs = peek.history || [];
    return card(cs.length ? `<ol class="tl">${cs.map((c: Loose) => `<li><time>${esc(when(c.at))}</time>${esc(c.subject)} <span class="muted">· ${esc(c.author)} · <code>${esc(c.sha.slice(0, 12))}</code></span></li>`).join('')}</ol>` : empty('None'));
  }
  const items = (peek.history || []).map((l: Loose) => [l, lineView(l, self)]).filter(([, x]: Loose) => x);
  return card(items.length ? `<ol class="tl">${items.map(([l, [c, h]]: Loose) => `<li class="${c}"><time>${when(l.at)}</time>${h}</li>`).join('')}</ol>` : empty('None'));
}
