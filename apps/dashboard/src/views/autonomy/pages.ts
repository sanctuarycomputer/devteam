// kit-994: the Autonomy pages' nav counts and sortable tables, and the Retros cards (index.html's autonomy lines).
import { retroDate } from '../peek-kinds';
import { bindDbTable, dbTable, esc, nextSort } from '../shell';
import { $ } from '../shell/page';
import { cardHead } from '../words';
import { effNone } from './efficiency';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


// kit-93: the Autonomy pages' nav counts. Trust and Awareness carry this week's score; Sensors the
// sensors down, else the findings, hot when one is down or a finding is high.
export function navCounts(d: Loose) {
  const set = (id: Loose, txt: Loose, hot: Loose = false) => { const el = $(id); if (!el) return; el.textContent = txt; el.classList.toggle('hot', !!hot); };
  const pct = (s: Loose) => (Number.isFinite(s?.this_week) ? `${s.this_week}%` : '');
  set('n-trust', pct(d.autonomy?.decisions?.score));
  set('n-awareness', pct(d.awareness?.score));
  const down = (d.sensors || []).filter((m: Loose) => m.state === 'down');
  const fs = d.metrics?.findings || [];
  set('n-sensors', down.length ? `${down.length} down` : (fs.length || ''), down.length > 0 || fs.some((f: Loose) => f.severity === 'high'));
}
// A page's tables (plan D2): each sits in its own <div data-tbl="<page>:<name>">, its rows ({ cells, sort, open })
// kept in TBL_ROWS by that key and its sort in TBL_SORT (kept across redraws). After each write of the page's
// HTML, bindPageTables binds every wrapper: a header sorts and redraws the page, a row opens its open hash.
export const TBL_SORT = new Map();
export const TBL_ROWS = new Map();
export function pageTable(key: Loose, cols: Loose, rows: Loose) {
  TBL_ROWS.set(key, rows);
  return `<div class="tbl-wrap" data-tbl="${esc(key)}">${dbTable(cols, rows, { sort: TBL_SORT.get(key) ?? null })}</div>`;
}
export function bindPageTables(root: Loose, redrawPage: Loose) {
  for (const w of root.querySelectorAll('[data-tbl]')) {
    const key = w.dataset.tbl;
    bindDbTable(w, {
      onSort: (col: Loose) => {
        TBL_SORT.set(key, nextSort(TBL_SORT.get(key), col));
        redrawPage();
        // the page was written again: focus back on the header that sorted it
        root.querySelector(`[data-tbl="${CSS.escape(key)}"] button.sort[data-col="${col}"]`)?.focus();
      },
      onOpen: (i: Loose) => { const open = TBL_ROWS.get(key)?.[i]?.open; if (open) location.hash = open; },
    });
  }
}
// Retros: the next one when due, then a card a retro (a click or Enter opens its peek)
export function retroCards(rt: Loose) {
  const all = rt?.all || [];
  const since = String(rt?.due_since || '').slice(0, 10);
  const due = rt?.due ? `<div class="card">${cardHead('history', 'Next retro', { extra: since ? `<span class="badge medium">due since ${esc(since)}</span>` : '' })}<p>${esc((rt.reasons || []).join('; '))}</p></div>` : '';
  const cards = all.map((r: Loose) => `<div class="card retro-card" data-open="retro/${esc(encodeURIComponent(r.id))}" tabindex="0" role="button" aria-label="Open the retro of ${esc(retroDate(r))}">${cardHead('history', esc(retroDate(r)))}<p>${esc(r.summary)}</p></div>`).join('');
  return due || cards ? `<div class="cards">${due}${cards}</div>` : effNone();
}
