// kit-996: the Loop's tables (index.html's loop-tables block): each tab one of the shell's record tables, its rows,
// and Correct on a row or in a peek. Its two listeners are bootLoop()'s, which client.tsx runs once, in an effect.
// `Loose` is `any`: the page's data has no fixed shape in index.html.
import { bindPageTables, pageTable } from '../autonomy';
import { filtersNow } from '../board';
import { hoursWords, signalTitle } from '../peek-kinds';
import { decSubject, esc, shellText, subj } from '../shell';
import { $ } from '../shell/page';
import { shell } from '../shell/state';
import { tCut, tLine } from '../threads-core';
import { threadsCoreState } from '../threads-core/state';
import { tlStart } from '../threads-panel';
import { actView, linkify, scopeWords, when, who, words } from '../words';
import { DEC_KIND, routine } from './ooda';
import { loopState } from './state';
type Loose = any;

/* loop-tables start */
// Self Improvement (kit-96): each tab is one of the shell's record tables (pageTable), with no type column: the
// tab picks the type. Each row's first cell holds its record's data-subject span (Shift+click, pins, Correct's
// title); a row opens its record's peek.
export const LOOP_COLS = {
  observe: ['What', 'Source', 'How much it matters', 'Good or bad', 'Seen by', 'When'],
  orient: ['What', 'Kind', 'Status', 'Applies to', 'Waiting', 'Needs orienting'],
  decide: ['Decision', 'Kind', 'Who', 'Confidence', 'Corrected', 'When', ''],
  act: ['Act', 'Kind', 'Reversible', 'When', ''],
};
export const LOOP_BOX = { observe: 'observations', orient: 'knowledge', decide: 'decisions-feed', act: 'acts-feed' };
// Orient's kinds, as its Kind filter offers them (the URL's kind on #loop?lt=orient)
// ORIENT_KINDS: loopState's (src/views/loop/state.ts holds it; kit-989)
export const KNOW_STATUS = { accepted: 'kept', candidate: 'proposed', stale: 'stale' };
// Decide's two header toggles, kept in page memory (STATE_KEYS.loop has no key for them)
// LOOP_DEC: loopState's (src/views/loop/state.ts holds it; kit-989)
// a valence, -2..2, red to green; blank when there is none
export const signHtml = (v: Loose) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? '' : `<span class="sign s${Number(v)}">${Number(v) > 0 ? `+${Number(v)}` : Number(v) < 0 ? `−${-Number(v)}` : '0'}</span>`);
export const loopWhen = (iso: Loose) => (iso ? esc(when(iso)) : '');
// a call the owner may correct: the supervisor's own (a decision, or an act that was its own call), not corrected yet
export const mayCorrect = (r: Loose) => r.who === 'supervisor' && ['decision', 'act'].includes(r.kind) && !r.correction;
// Correct is a thread on the record (fast-threads' item subject), titled with the record's own words (title, else
// its row's subject): the owner's words there are the correction once the supervisor records them (correct
// --from-turn); nothing is posted from the click
export const correctBtn = (kind: Loose, id: Loose, title: Loose = '') => `<button type="button" class="ghost mini" data-thread-on="${esc(`${kind}:${id}`)}"${title ? ` data-title="${esc(tLine(title, threadsCoreState.T_TITLE_MAX))}"` : ''}>Correct</button>`;
export function obsRows(o: Loose) {
  return (o?.observations || []).map((x: Loose) => ({
    cells: [`<span${subj('observation', x.id, `${words(x.kind)}: ${x.detail}`)}>${linkify(x.detail)}</span>`, esc(x.source ?? ''), x.severity === null || x.severity === undefined ? '' : esc(x.severity), signHtml(x.valence), esc(who(x.created_by)), loopWhen(x.created_at)],
    sort: [String(x.detail ?? ''), String(x.source ?? ''), x.severity ?? null, x.valence ?? null, who(x.created_by), x.created_at ?? null],
    open: `observation/${encodeURIComponent(x.id)}`,
  }));
}
export function decRows(o: Loose) {
  return (o?.decisions || []).filter((r: Loose) => (loopState.LOOP_DEC.routine || !routine(r)) && (!loopState.LOOP_DEC.corrected || r.correction || r.kind === 'correction')).map((r: Loose) => {
    const kind = decSubject(r);
    const corrected = r.correction || r.kind === 'correction';
    const kindWords = r.class_name || (DEC_KIND as Loose)[r.kind] || r.kind;
    return {
      cells: [`<span${subj(kind, r.id, r.what)}>${linkify(r.what)}</span>`, esc(kindWords), esc(who(r.who)), r.confidence === null || r.confidence === undefined ? '' : `${Math.round(r.confidence * 100)}%`, corrected ? 'yes' : '', loopWhen(r.at), mayCorrect(r) ? correctBtn(r.kind, r.id) : ''],
      sort: [String(r.what ?? ''), kindWords, who(r.who), r.confidence ?? null, corrected ? 'yes' : '', r.at ?? null, null],
      open: `${kind === 'question' ? 'q' : kind}/${encodeURIComponent(r.id)}`,
    };
  });
}
export function actRows(o: Loose) {
  return (o?.acts || []).map((a: Loose) => {
    const v = actView(a);
    return {
      cells: [`<span${subj('act', a.id, a.what)}>${v.head}</span>${a.correction ? ' <span class="badge high">corrected</span>' : ''}`, esc(a.class_name ?? ''), a.reversible === false ? 'no' : 'yes', loopWhen(a.created_at), !a.correction && !a.decision ? correctBtn('act', a.id) : ''],
      sort: [shellText(v.head), a.class_name ?? '', a.reversible === false ? 'no' : 'yes', a.created_at ?? null, null],
      open: `act/${encodeURIComponent(a.id)}`,
    };
  });
}
// Orient, one Knowledge table: recurring signals, problems (an incident as one), fixed incidents nothing learned
// from, then knowledge by its own kind. Needs orienting: a signal unexplained a day or more (debt.signals), an open
// problem, a fixed incident owed a lesson (debt.incidents); each with how long it has waited. f: filtersNow('loop').
export function orientRows(o: Loose, f: Loose = {}) {
  const now = Date.now();
  const hoursSince = (iso: Loose) => Math.max(0, Math.floor((now - Date.parse(iso)) / 3600000));
  const owed = new Map((o?.debt?.signals || []).map((x: Loose) => [x.key, x]));
  const row = (kind: Loose, status: Loose, applies: Loose, wait: Loose, waitSort: Loose, flag: Loose, what: Loose, whatSort: Loose, open: Loose) => ({
    kind,
    flag,
    cells: [what, esc(kind), esc(status), esc(applies), esc(wait), esc(flag)],
    sort: [whatSort, kind, status, applies, waitSort, flag],
    open,
  });
  const rows = [];
  for (const c of o?.clusters || []) {
    const d = owed.get(c.key);
    rows.push(row('recurring signal', 'unexplained', '', d ? hoursWords((d as Loose).hours) : '', d ? (d as Loose).hours : null, d ? 'Needs orienting' : '',
      `<b>${esc(signalTitle(c.key))}</b> ${linkify(c.latest ?? '')}`, `${signalTitle(c.key)} ${c.latest ?? ''}`, `signal/${encodeURIComponent(c.key)}`));
  }
  for (const p of o?.problems || []) {
    const open = p.status === 'open';
    const h = open && p.created_at ? hoursSince(p.created_at) : null;
    rows.push(row(Array.isArray(p.fingerprints) && p.fingerprints.length ? 'incident' : 'problem', p.status ?? '', (p.threatens || []).join(', '), h !== null ? hoursWords(h) : '', h, open ? 'Needs orienting' : '',
      `<span${subj('problem', p.id, p.title)}>${linkify(p.title ?? '')}</span>`, String(p.title ?? ''), `problem/${encodeURIComponent(p.id)}`));
  }
  for (const x of o?.debt?.incidents || []) {
    const h = x.resolved_at ? hoursSince(x.resolved_at) : null;
    // days since it was fixed, even under a day; the sort key stays hours
    const d = x.days ?? (h !== null ? Math.floor(h / 24) : null);
    const wait = d !== null ? `${d} day${d === 1 ? '' : 's'}` : '';
    rows.push(row('incident', 'fixed', '', wait, h ?? (x.days ?? 0) * 24, 'What did it teach?',
      `<span${subj('problem', x.id, x.title)}>${linkify(x.title ?? '')}</span>`, String(x.title ?? ''), `problem/${encodeURIComponent(x.id)}`));
  }
  for (const k of o?.knowledge || []) {
    rows.push(row(k.kind ?? '', (KNOW_STATUS as Loose)[k.status] ?? k.status ?? '', scopeWords(k.scope), '', null, '',
      `<span${subj('lesson', k.id, k.statement)}>${linkify(k.statement ?? '')}</span>`, String(k.statement ?? ''), `lesson/${encodeURIComponent(k.id)}`));
  }
  return rows.filter((r: Loose) => (!f.kind || r.kind === f.kind) && (!f.orient || r.flag));
}
loopState.LOOP_ROWS = { observe: obsRows, orient: (o: Loose) => orientRows(o, filtersNow('loop')), decide: decRows, act: actRows };
// One tab's table, written only when its HTML changed (focus and scroll kept), and its new wrapper bound: a header
// sorts and redraws the page, a row opens its record. Its count on the tab and on its card's head.
export function loopDraw(tab: Loose, o: Loose = (shell.DATA as Loose)?.ooda) {
  const el = $((LOOP_BOX as Loose)[tab]);
  if (!el || !o) return;
  const rows = loopState.LOOP_ROWS![tab](o);
  for (const id of [`n-${tab}`, `c-${tab}`]) { const c = $(id); if (c && c.textContent !== String(rows.length || '')) c.textContent = (rows.length || '' as Loose); }
  const html = pageTable(`loop:${tab}`, (LOOP_COLS as Loose)[tab], rows);
  if ((el as Loose).__html === html) return;
  (el as Loose).__html = html;
  el.innerHTML = html;
  bindPageTables(el, renderLoop);
}
export function renderLoop() { for (const tab of Object.keys(LOOP_BOX)) loopDraw(tab); }
// Correct, on a row or in a peek: a thread titled with the record's own words (the button's data-title, else its
// row's subject span's), placed at the button. Taken here, before the page's [data-thread-on] handler, which titles
// a thread from the peek's bar (an act's peek bar holds its plain head, not its words).
export function loopCorrect(e: Loose) {
  const b = e.target.closest?.('[data-thread-on]');
  if (!b || !e.currentTarget.contains(b)) return;
  const s = b.closest('tr')?.querySelector('[data-subject]');
  const ref = b.dataset.threadOn;
  // a row's record with no words of its own (no what) is titled by its kind, never by a stale peek bar
  const words = b.dataset.title || s?.dataset.title || (b.closest('tr') ? (threadsCoreState.T_KIND as Loose)[ref.split(':')[0]] : '');
  if (!words) return;
  e.stopPropagation();
  const title = tLine(words, threadsCoreState.T_TITLE_MAX) || (threadsCoreState.T_KIND as Loose)[ref.split(':')[0]];
  const r = b.getBoundingClientRect();
  tlStart({ subject: { kind: 'item', ref, quote: tCut(title, 300) }, title, el: s || b, x: r.left + r.width / 2, y: r.top + r.height / 2 });
}
export function bootLoop() {
  $('loop')!.addEventListener('click', loopCorrect);
  $('drawer')?.addEventListener('click', loopCorrect);
}
/* loop-tables end */


