// kit-993: the Board's cards (index.html's board lines): a card's pills, its attention row, the columns and renderBoard.
import { COLUMNS, columnOf } from '../../lib/board-columns';
import { boardKeep, needsAttention } from '../../lib/board-filter';
import { plannerCards } from '../goals';
import { peekFor } from '../peeks';
import { esc, subj } from '../shell';
import { $ } from '../shell/page';
import { shell } from '../shell/state';
import { cardMenu, ticketMap, words } from '../words';
import { wordsState } from '../words/state';
import { filtersNow } from './filters';
import { goalFeatures } from './progress';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


// A card's pills (kit-91, the mock's order and words): critical path first, then the phase in words with its task
// (an unmerged ticket not blocked or done), then usage limit or stuck on a prompt, held, high risk, then the
// component, last. No Blocked pill: the red outline and the attention row say it. [label, tone, title, icon]
export function ticketPills(t: Loose, crit: Loose) {
  const ps = [];
  if (crit && crit.has(t.id)) ps.push(['critical path', 'high cp', 'On the critical path: it delays the goal', 'route']);
  if (t.phase && !['blocked', 'done'].includes(t.phase) && !['merged', 'released'].includes(t.stage)) ps.push([`${(wordsState.PHASE_WORDS as Loose)[t.phase] || (words(t.phase) as Loose).toLowerCase()}${t.task ? `, task ${String(t.task).replace(/^T(?=\d)/i, '')}` : ''}`, '']);
  if (t.waiting) ps.push(t.waiting.kind === 'limit' ? ['usage limit', 'medium', t.waiting.line] : ['stuck on a prompt', 'high', t.waiting.line]);
  if (t.held) ps.push(['held', 'medium', t.held]);
  if (t.risk === 'high') ps.push(['high risk', 'high']);
  if (t.component) ps.push([t.component, '']);
  return ps;
}
export const pillsOf = (ps: Loose) => (ps.length ? `<div class="pills">${ps.map(([label, tone, tip, icon]: Loose) => `<span class="badge pill${tone ? ` ${tone}` : ''}" title="${esc(tip || label)}">${icon ? `<i class="icon-${icon}" aria-hidden="true"></i>` : ''}${esc(label)}</span>`).join('')}</div>` : '');
// A card's attention row (a ticket or planner that needs attention): the question holding it, a link that opens
// the panel's Inbox tab at its card (its text from DATA.questions; "a question" once it has left them), or "no
// question yet".
export const attLine = (x: Loose) => (x.held_by
  ? `<a class="att-q" href="#q/${esc(encodeURIComponent(x.held_by))}"><i class="icon-inbox" aria-hidden="true"></i><span>${esc(((shell.DATA as Loose)?.questions || []).find((q: Loose) => q.id === x.held_by)?.question || 'a question')}</span></a>`
  : '<span class="badge high">no question yet</span>');
// The board's columns and cards, for the Board and for a sidepeek's tickets (only: the columns that
// have cards, so a few tickets don't sit in seven mostly empty columns). Each item is joined with its
// /api/data ticket row by id for held_by, so a peek's board shows the outline and the question too.
export function boardCols(items: Loose, crit: Loose, { only = false, inert = false }: Loose = {}) {
  const rows = ticketMap();
  const live = items.filter((t: Loose) => t.stage !== 'superseded').map((t: Loose) => ({ ...t, held_by: t.held_by ?? (rows as Loose).get(t.id)?.held_by ?? null }));
  return COLUMNS.filter(([name]: Loose) => !only || live.some((t: Loose) => columnOf(t) === name)).map(([name]: Loose) => {
    let cards = live.filter((t: Loose) => columnOf(t) === name).sort((a: Loose, b: Loose) => (a.wave ?? 99) - (b.wave ?? 99));
    const total = cards.length;
    // finished columns show the most recent few; the rest are counted
    if (['Merged', 'Released'].includes(name)) cards = cards.sort((a: Loose, b: Loose) => (b.merged_at || '').localeCompare(a.merged_at || '')).slice(0, 5);
    return `<div class="col${total ? '' : ' none'}"><h3><span>${name}</span><span>${total}</span></h3>${cards.map((t: Loose) => { const att = needsAttention(t); return `
      <div class="tcard${inert ? ' inert' : ''}${att ? ' blocked' : ''}"${subj('ticket', t.id, t.title)} ${inert ? '' : `role="button" tabindex="0" data-ticket="${esc(t.id)}" data-open="ticket/${esc(encodeURIComponent(t.id))}" aria-label="Open ${esc(t.title)}"`}>
        <div class="tc-head"><b>${esc(t.id)}</b>${inert ? '' : cardMenu('ticket', t.id)}</div>
        <div class="t">${inert ? `<b>${esc(t.title)}</b>` : `<a class="title-link" href="${esc(peekFor('ticket', t.id))}"><b>${esc(t.title)}</b></a>`}</div>
        ${pillsOf(ticketPills(t, crit))}${att ? `<div class="att">${attLine(t)}</div>` : ''}
      </div>`; }).join('')}${total > cards.length ? `<div class="more">+ ${total - cards.length} more</div>` : ''}</div>`;
  }).join('');
}
// The Board: the tickets (joined with /api/data's ticket rows for held_by) and planners the header's filters keep.
export function renderBoard() {
  const f = filtersNow('board');
  const ctx = { goalFeatures: (f as Loose).goal ? goalFeatures((f as Loose).goal) : null };
  const rows = new Map(((shell.DATA as Loose).tickets || []).map((t: Loose) => [t.id, t]));
  const items = (shell.DATA as Loose).progress.tickets.map((t: Loose) => ({ ...t, held_by: (rows.get(t.id) as Loose)?.held_by ?? null })).filter((t: Loose) => boardKeep(t, f, ctx));
  $('planners')!.innerHTML = plannerCards(((shell.DATA as Loose).planners || []).filter((x: Loose) => boardKeep(x, f, ctx)));
  $('board-cols')!.innerHTML = boardCols(items, new Set((shell.DATA as Loose).critical_path));
}
export const sevBadge = (n: Loose) => (n >= 3 ? 'high' : n === 2 ? 'medium' : 'low');
