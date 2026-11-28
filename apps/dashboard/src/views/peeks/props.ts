// kit-997: the side peek's properties (index.html's peeks lines 5110-5362): the record types, the key tips, the
// stored rows by type (ATTR), the sections and How it changes.
import { SHELL_ROUTES } from '../../lib/shell-routes';
import { sevBadge } from '../board';
import { correctBtn, decideRows } from '../loop';
import { emptyVal } from '../review';
import { esc, props, shellPages } from '../shell';
import { shell } from '../shell/state';
import { approvedBy, dlink, fileHref, flink, glink, linkOf, linkify, mlink, qlink, rlink, scopeWords, slink, subjectLink, ticketMap, tlink, when, who, words } from '../words';
import { wordsState } from '../words/state';
import { redraw } from './drawer';
import { peeksState } from './state';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


// ---- sidepeek: every object opens the same way. The bar: its type's icon and name, then its title.
// Then its attributes: ID first, its stored fields (from its record, so a field added to the schema
// shows up with no change here; a known field gets a label and its links, any other a plain value;
// each key's tooltip is the schema's words for the field), then what is computed from other records.
// Then what is particular to it. Its history comes last.
// The record, the history and the particulars come from one /api/peek per object, cached, fetched
// again on each refresh; the drawer is redrawn from DATA and that peek, and left alone when nothing
// it shows changed.
export let SCHEMA_DOCS: Loose = null;
export async function loadSchemaDocs() {
  try { const r = await fetch('/api/schema'); if (r.ok) SCHEMA_DOCS = await r.json(); } catch {}
  if (peeksState.DRAWER.kind) redraw();
}
export const tipFor = (type: Loose, k: Loose) => SCHEMA_DOCS?.types?.[type]?.fields?.[k] ?? (/[.[]/.test(k) ? '' : SCHEMA_DOCS?.envelope?.[k]) ?? '';
// Every key's tooltip, where the schema has no words for it and the opener gave none: each label an
// opener draws (kit-88 spec §2.2; the owner's mock's KEY_HELP and today's tips). A key with none of
// the three says which stored field it is.
// none of the three: no tip (and the peek test's "every key has a tooltip" fails)
export const keyTip = (label: Loose, tip: Loose, field: Loose) => tip || (peeksState.KEY_TIPS as Loose)[label] || (field ? `Stored on the record as ${field}.` : '');
// A property row for props(): [label, value, tip], or null when there is no value to show.
export const attrRow = (label: Loose, html: Loose, tip: Loose, field: Loose) => (html === '' || html == null || html === false ? null : [label, html, keyTip(label, tip, field)]);
export const ISO_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
export const longList = (xs: Loose) => xs.length > 4 || xs.some((x: Loose) => String(x).length > 48);
// Any value, plainly: text links the ids in it, lists become lists, objects their own key/value pairs.
export function fmtAny(v: Loose): Loose {
  if (emptyVal(v)) return '';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return esc(v);
  if (typeof v === 'string') return ISO_AT.test(v) ? esc(when(v)) : linkify(v);
  if (Array.isArray(v)) {
    const items: Loose = v.map((x: Loose) => (x !== null && typeof x === 'object' ? fmtObj(x) : fmtAny(x))).filter(Boolean);
    return v.some((x: Loose) => x !== null && typeof x === 'object') || longList(v) ? `<ul>${items.map((x: Loose) => `<li>${x}</li>`).join('')}</ul>` : items.join(', ');
  }
  return fmtObj(v);
}
export const fmtObj = (o: Loose): Loose => Object.entries(o).filter(([, x]: Loose) => !emptyVal(x)).map(([k, x]: Loose) => `<span class="muted">${esc(words(k).toLowerCase())}</span> ${fmtAny(x)}`).join(' · ');
// A value in one line, for a history entry: long text and lists are cut short.
export const fmtShort = (v: Loose) => {
  if (emptyVal(v)) return '<span class="muted">nothing</span>';
  if (typeof v === 'string') return linkify(v.length > 120 ? `${v.slice(0, 120)}…` : v);
  if (Array.isArray(v) && v.every((x: Loose) => typeof x !== 'object')) return v.length > 6 ? `${v.slice(0, 6).map((x: Loose) => linkify(String(x))).join(', ')} and ${v.length - 6} more` : v.map((x: Loose) => linkify(String(x))).join(', ');
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
  return fmtAny(v);
};
export const list = (xs: Loose, f: Loose) => (xs?.length ? (xs.length > 1 && longList(xs) ? `<ul>${xs.map((x: Loose) => `<li>${f(x)}</li>`).join('')}</ul>` : xs.map(f).join(', ')) : '');
export const linkList = (xs: Loose) => list(xs, (x: Loose) => (ticketMap().has(x) ? tlink(x) : linkify(String(x))));
export const share = (x: Loose) => `${Math.round(x * 100)}%`;
export const fmtDay = (d: Loose) => (d ? esc(new Date(Date.parse(d)).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })) : '');
export const unitOf = (u: Loose) => (u ? (u === '%' ? '%' : ` ${esc(u)}`) : '');
export const decisionTitle = (id: Loose) => ((shell.DATA as Loose).ooda.decisions || []).find((r: Loose) => r.id === id && r.kind === 'decision')?.what ?? null;
// Fields any type may carry, then per type: a label where the field's name isn't plain enough, an
// order where the schema's isn't the one to read in, fields to leave out (hashes and bookkeeping the
// body shows in full), and how to show values that are links or codes. A formatter gets the value
// and the drawer's context (the record, its set_by, and what the opener passed).
export const ATTR_COMMON = {
  label: { refs: 'About', approved_by: 'Approved by', depends_on: 'Waits on', done_when: 'Done when', non_goals: 'Not in scope', superseded_by: 'Replaced by', one_way_doors: 'One-way doors', why_asked: 'Why asked', source_ref: 'Source', fix_hint: 'Fix', plan_after: 'Plan after', held: 'On hold' },
  fmt: {
    refs: linkList, evidence: linkList, blocks: linkList, threatens: (v: Loose) => list(v, glink), goals: (v: Loose) => list(v, glink),
    approved_by: (v: Loose) => approvedBy(v), decision: (v: Loose) => (typeof v === 'string' ? dlink(v, decisionTitle(v)) : fmtObj(v)), confidence: (v: Loose) => (typeof v === 'number' ? share(v) : fmtAny(v)),
    rung: (v: Loose) => esc((wordsState.RUNG_WORDS as Loose)[v] || v), ceiling: (v: Loose) => esc((wordsState.RUNG_WORDS as Loose)[v] || v), scope: (v: Loose) => esc(scopeWords(v)),
    corrected: (v: Loose, c: Loose) => `${esc(v.reason)}${v.severity != null ? ` <span class="muted">(severity ${esc(v.severity)})</span>` : ''}${c.set_by?.corrected ? ` <span class="muted">· by ${esc(who(c.set_by.corrected.by))}, ${esc(when(c.set_by.corrected.at))}</span>` : ''}`,
    horizon: fmtDay, deadline: fmtDay, ticket: (v: Loose) => tlink(v), feature: (v: Loose) => (v === 'chores' ? 'chores (upkeep, not a feature)' : flink(v)),
    links: (v: Loose) => `<div class="links">${v.map(linkOf).join('')}</div>`,
  },
};
peeksState.ATTR = {
  ticket: {
    fmt: {
      size: (v: Loose) => (v === 'M' ? 'M (medium)' : v === 'S' ? 'S (small)' : esc(v)), risk: (v: Loose) => (v === 'high' ? 'high (two reviewers)' : esc(v)),
      serves: (v: Loose) => v.map((x: Loose) => `${slink(x)} ${esc(String((shell.DATA as Loose).progress?.stories?.[x]?.text ?? '').slice(0, 90))}`).join('<br>'),
      depends_on: (v: Loose) => list(v, tlink), superseded_by: (v: Loose) => tlink(v), touches: (v: Loose) => v.map((x: Loose) => `<code>${esc(x)}</code>`).join(', '),
      // registry link ids (settings links), not a question's link objects: ATTR_COMMON's links drew them empty
      links: (v: Loose) => v.map((x: Loose) => `<code>${esc(x)}</code>`).join(', '),
      done_when: (v: Loose) => `<ul>${v.map((x: Loose) => `<li>${linkify(x)}</li>`).join('')}</ul>`,
    },
  },
  goal: {
    order: ['title', 'outcome', 'status', 'priority', 'horizon', 'measure', 'milestones', 'preconditions', 'non_goals'],
    label: { measure: 'Measured by' },
    fmt: {
      measure: (m: Loose) => `${esc(m.description ?? '')}${m.target != null ? `: <b>${esc(m.target)}</b>${unitOf(m.unit)}` : ''}${m.direction ? ` <span class="muted">(${m.direction === 'down' ? 'lower' : 'higher'} is better)</span>` : ''}`,
      milestones: (v: Loose, c: Loose) => `<ol>${v.map((m: Loose, i: Loose) => `<li>${mlink(c.id, i + 1, m.title)}${m.target != null ? `: ${esc(m.target)}` : ''}${m.by ? ` by ${fmtDay(m.by)}` : ''}</li>`).join('')}</ol>`,
      preconditions: (v: Loose, c: Loose) => `<ol>${v.map((x: Loose, i: Loose) => `<li>${linkify(x)}${(c.unplanned || []).includes(i + 1) ? ' <span class="badge medium">no plan yet</span>' : ''}</li>`).join('')}</ol>`,
      non_goals: (v: Loose) => `<ul>${v.map((x: Loose) => `<li>${linkify(x)}</li>`).join('')}</ul>`,
      hold: (h: Loose) => (h ? `${esc(words(h.mode))}${h.reason ? `: ${linkify(h.reason)}` : ''}` : 'run'),
      decision: (d: Loose) => `<b>${esc(words(d.verdict))}</b>${d.notes ? `: ${linkify(d.notes)}` : ''}`,
      approved: (v: Loose) => qlink(v), plan_after: (v: Loose) => (Array.isArray(v) ? list(v, (x: Loose) => (typeof x === 'string' ? glink(x) : fmtObj(x))) : fmtAny(v)),
    },
  },
  feature: {
    order: ['title', 'goals', 'stories', 'preconditions', 'design', 'notes'],
    fmt: {
      stories: (v: Loose) => `<ul>${v.map((s: Loose) => `<li>${slink(s.id)} ${esc(s.text ?? '')}${s.release ? ` <span class="muted">(${rlink(s.release)})</span>` : ''}</li>`).join('')}</ul>`,
      design: (v: Loose) => `<a class="linkish" href="${esc(fileHref({ title: 'The design', path: v.startsWith('docs/') ? v : `docs/devteam/${v}` }))}"><code>${esc(v)}</code></a>`,
    },
  },
  question: {
    order: ['question', 'kind', 'class', 'scope', 'ticket', 'goal', 'recommendation', 'options', 'default', 'deadline', 'answer', 'status'],
    hide: ['review', 'result', 'secrets', 'secrets_posted', 'choices', 'status'],
    fmt: { why_asked: (w: Loose) => `${w.rung ? `${esc((wordsState.RUNG_WORDS as Loose)[w.rung])}` : ''}${w.ceiling ? `, at most ${esc((wordsState.RUNG_WORDS as Loose)[w.ceiling])}` : ''}${(w.reasons || []).length ? ` · ${esc(w.reasons.map(words).join(', '))}` : ''}`, autonomy: (a: Loose) => `${esc(words(a.class))}: ${esc((wordsState.RUNG_WORDS as Loose)[a.rung])}${a.scope ? ` (${esc(a.scope)})` : ''}`, goal: (v: Loose) => glink(v), re: (v: Loose) => linkify(v) },
  },
  decision: { order: ['what', 'class', 'scope', 'authority', 'approved_by', 'knowledge', 'rung', 'ceiling', 'options', 'rationale', 'confidence', 'refs', 'reversible'], label: { knowledge: 'Rests on' }, fmt: { authority: (v: Loose) => esc((AUTHORITY_LABEL as Loose)[v] || v), knowledge: linkList } },
  act: { order: ['what', 'class', 'scope', 'decision', 'approved_by', 'rung', 'refs', 'knowledge', 'reversible'], label: { knowledge: 'Given' }, fmt: { id_block: (b: Loose) => `${esc(b.feature)}: ${esc(b.from)} to ${esc(b.to)}`, knowledge: linkList } },
  knowledge: { order: ['plain', 'statement', 'kind', 'status', 'scope', 'confidence', 'valence', 'evidence'], hide: ['for_owner'], label: { plain: 'In plain words' }, fmt: { valence: (v: Loose) => (v < 0 ? `${esc(v)} (something to avoid)` : esc(v)) } },
  problem: { order: ['title', 'status', 'severity', 'realized', 'threatens', 'assigned_to', 'detail', 'refs'], fmt: { realized: (v: Loose) => (v ? 'yes: an issue' : 'no: a risk'), assigned_to: (v: Loose) => linkify(v), severity: (v: Loose) => `<span class="badge ${sevBadge(v)}">${esc(v)}</span>` } },
  message: { fmt: { to: (v: Loose) => esc(who(v)), re: (v: Loose) => linkify(v) } },
  observation: { order: ['kind', 'subject', 'detail', 'refs'], label: { source: 'Noticed by', source_ref: 'From' }, fmt: { subject: (v: Loose) => subjectLink(v), source: (v: Loose) => esc(who(v)), source_ref: (v: Loose) => /^https:\/\//.test(v) ? `<a href="${esc(v)}" target="_blank" rel="noopener noreferrer">${esc(v)}</a>` : `<a class="linkish" href="${esc(fileHref({ title: v.split('/').pop(), path: `docs/devteam/${v}` }))}"><code>${esc(v)}</code></a>` } },
  story: { fmt: { release: (v: Loose) => rlink(v) } },
  milestone: { fmt: { by: fmtDay } },
};
export const AUTHORITY_LABEL = { rung: 'its rung', answer: 'your answer', default: 'a default', 'standing-rule': 'a standing rule', constitution: 'the constitution' };
export function storedRows(type: Loose, fields: Loose, docType: Loose, ctx: Loose, prefix: Loose = '') {
  const spec = peeksState.ATTR![type] || {};
  const schemaOrder = Object.keys(SCHEMA_DOCS?.types?.[docType]?.fields || {}).filter((k: Loose) => k.startsWith(prefix)).map((k: Loose) => k.slice(prefix.length));
  const keys = Object.keys(fields).filter((k: Loose) => !emptyVal(fields[k]) && !(spec.hide || []).includes(k));
  const rank = (k: Loose) => { const a = (spec.order || []).indexOf(k); if (a >= 0) return a; const b = schemaOrder.indexOf(k); return b >= 0 ? 100 + b : 1000; };
  keys.sort((a: Loose, b: Loose) => rank(a) - rank(b) || a.localeCompare(b));
  return keys.map((k: Loose) => {
    const f = spec.fmt?.[k] ?? (ATTR_COMMON.fmt as Loose)[k] ?? fmtAny;
    let html: Loose;
    try { html = f(fields[k], ctx); } catch { html = fmtAny(fields[k]); }
    return attrRow(spec.label?.[k] ?? (ATTR_COMMON.label as Loose)[k] ?? words(k), html, tipFor(docType, `${prefix}${k}`), `${prefix}${k}`);
  });
}
// The properties (kit-88 spec §2.2), on the block's props(): the ID first, the stored fields, Created
// and Last changed, then How it changes; under them, what is computed from other records. peek: the
// object's peek (undefined while it loads); pick: the part of the record that is this object (a story
// inside its feature, with prefix 'stories[].' for its tooltips); computed: [label, html, tip] rows
// worked out from other records; ctx: what formatters may need; kind and rec: the peek's kind and the
// record How it changes reads (howItChanges). rename: { label: new label } for its own rows (a goal's
// Created reads Opened); front: [label, row, replace] entries drawn right after the ID in that order, each
// its own row of that label (moved up) or, when it has none or replace is set, the row given.
export function attrs({ id, idTip, peek, type, docType, pick = null, prefix = '', computed = [], ctx = {}, noRecord = false, kind = peeksState.DRAWER.kind, rec = null, rename = {}, front = [] }: Loose) {
  const r = peek?.record ?? null;
  const fields = r ? (pick ? pick(r.fields) : r.fields) : null;
  const c = { id, record: r, set_by: r?.set_by ?? {}, ...ctx };
  const made = r && !pick ? [(attrRow as Loose)('Created', `${esc(when(r.created_at))} by ${esc(who(r.created_by))}`), r.updated_at ? (attrRow as Loose)('Last changed', `${esc(when(r.updated_at))} by ${esc(who(r.updated_by))}`) : null] : [];
  const stored = fields ? storedRows(type, fields, docType ?? type, c, prefix)
    : noRecord ? [] : [(attrRow as Loose)('Record', `<span class="muted">${peek === undefined ? 'loading…' : peek?.transient ? 'could not load it just now' : 'not in the log'}</span>`)];
  const idTipped = `${idTip ?? (tipFor('_', 'id') || peeksState.KEY_TIPS.ID)} Copy ID copies exactly this.`;
  let own = [(attrRow as Loose)('ID', `<code>${esc(id)}</code>`, idTipped), ...stored, ...made, howItChanges(kind, { id, ...(rec || {}), record: r })].filter(Boolean)
    .map((x: Loose) => (Object.hasOwn(rename, x[0]) ? [rename[x[0]], x[1], (keyTip as Loose)(rename[x[0]])] : x));
  if (front.length) {
    const take = (l: Loose) => { const i = own.findIndex((x: Loose) => x[0] === l); return i < 0 ? null : own.splice(i, 1)[0]; };
    const lead = front.map(([l, row, replace]: Loose) => { const had = take(l); return replace ? row : had ?? row; }).filter(Boolean);
    own = [own[0], ...lead, ...own.slice(1)];
  }
  const comp = computed.filter((x: Loose) => x && x[1]).map(([l, h, t]: Loose) => (attrRow as Loose)(l, h, t)).filter(Boolean);
  return `<section class="attrs">${props(own)}${comp.length ? `<h4 class="attrs-h">Computed</h4>${props(comp)}` : ''}</section>`;
}
// A section under the properties: a card with its title in the card's head (kit-88 spec §2.2).
export const psect = (title: Loose, html: Loose) => `<div class="card psect"><div class="card-head"><span class="grow">${esc(title)}</span></div><div class="psect-body">${html}</div></div>`;
// How the owner changes the record, from where they are reading (R2; kit-88 spec §2.2). A thread on
// the record starts from its Start a thread button (the subject kind is the log's: a question is
// question:<id>); a correction is on its row in Self Improvement; a defaulted answer is overruled on
// its card in the Inbox; anything else is a thread on the spot of the page where it shows.
export const THREAD_KIND = { goal: 'goal', ticket: 'ticket', planner: 'planner', lesson: 'lesson', problem: 'problem', observation: 'observation', decision: 'decision', act: 'act', q: 'question' };
export const threadOn = (kind: Loose, id: Loose) => `<button type="button" class="ghost" data-thread-on="${esc(`${(THREAD_KIND as Loose)[kind]}:${id}`)}">Start a thread</button>`;
export const homeLink = (kind: Loose, id: Loose) => {
  const page = kind === 'file' ? (SHELL_ROUTES.files.find(([re]: Loose) => re.test(id))?.[1] ?? SHELL_ROUTES.links.file) : SHELL_ROUTES.links[kind];
  const pg = shellPages().find((x: Loose) => x.id === page);
  return pg ? ` <a class="linkish" href="#${esc(pg.id)}">${esc(pg.title)}</a>` : '';
};
export const GOVERNED = /^docs\/devteam\/(governance|process)\/|(^|\/)strategy\.md$|^docs\/devteam\/project\/(self|exterior)\.md$/;
export function howItChanges(kind: Loose, rec: Loose = {}) {
  const id = rec.id;
  const tip = peeksState.KEY_TIPS['How it changes'];
  // who corrected it when that is known (a record whose set_by lacks it says only that it was corrected)
  const corrected = (c: Loose) => `Corrected${c.by ? ` by ${esc(who(c.by))}` : ''}: ${esc(c.reason)}`;
  // a correction from the dashboard's row, else from the record itself (one older than the dashboard holds)
  const fromRecord = () => { const c = rec.record?.fields?.corrected; return c ? { reason: c.reason, by: rec.record?.set_by?.corrected?.by ?? c.by ?? null } : null; };
  let html: Loose;
  switch (kind) {
    case 'act': {
      const a = ((shell.DATA as Loose)?.ooda?.acts || []).find((x: Loose) => x.id === id) ?? rec;
      const dec = a.decision ?? rec.record?.fields?.decision;
      const ac = a.correction ?? fromRecord();
      html = ac ? corrected(ac) : dec ? `Correct its decision: ${dlink(dec, decisionTitle(dec))}. <span class="muted">It went as decided, so the call is the decision's; if the act itself went wrong, that is a problem.</span>` : correctBtn('act', id, a.what ?? rec.record?.fields?.what);
      break;
    }
    case 'decision': {
      // the owner may correct the supervisor's call with no correction yet (decideRows): a thread on it
      const call = (x: Loose) => x.id === id && ['decision', 'act'].includes(x.kind);
      const c = ((shell.DATA as Loose)?.ooda?.decisions || []).find(call)?.correction ?? fromRecord();
      const r = (decideRows((shell.DATA as Loose)?.ooda) as Loose).find(call);
      html = c ? corrected(c) : r ? correctBtn('decision', id, r.what) : threadOn('decision', id);
      break;
    }
    case 'q': {
      const listed = ((shell.DATA as Loose)?.ooda?.answered || []).find((x: Loose) => x.id === id);
      html = listed?.status === 'defaulted' ? `<a class="linkish" href="#inbox" data-answered-go="${esc(id)}">Overrule it from its card in the Inbox</a>` : `Settled; to raise it again, ${threadOn('q', id)}`;
      break;
    }
    case 'thread': {
      const t = rec.record?.fields?.thread ?? rec.thread;
      html = t ? `<a class="linkish" href="#talk/${encodeURIComponent(t)}">Reply in its thread</a>` : 'Reply in its thread';
      break;
    }
    case 'file':
      html = GOVERNED.test(String(id ?? '')) ? 'The supervisor drafts it from your thread; it lands with your yes' : `${SHIFT_SAY}:${homeLink('file', String(id ?? ''))}`;
      break;
    default:
      html = (THREAD_KIND as Loose)[kind] ? threadOn(kind, id) : `${SHIFT_SAY}:${homeLink(kind, id)}`;
  }
  return ['How it changes', html, tip];
}
export const SHIFT_SAY = 'Shift+click it where it shows on its page and say so in a thread';
// ---- peeks: one fetch per object, kept, fetched again on each refresh ----
