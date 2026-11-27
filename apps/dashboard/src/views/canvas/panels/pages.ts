// Pages and page edits (canvas.html 1528-1658, kit-1014). Each declaration is the page's own, with types
// added; `shown` is on `shared`, `moved` on `held` (./held), core's `renaming` and `pageAdd` on `live`.
// The page's load-time statements run, in its order, from initPages(). No DOM at import.
import { $, TEXT, hideMsg, imagesSettled, live, pageById, pageName, pages, renderPages, setState, showMsg, state, type Json } from '../core/page';
import { kidsOf } from '../core/nodes';
import { drawPage } from '../core/drawing';
import { edit, editable, newId, nodeIn, pageAt, say } from '../sync';
import { drawHandles } from '../editing';
import { subtreeIds } from '../history';
import { placeOthers, sendHere } from '../presence';
import { held, shared } from './held';
import { renderLayers, selectIds } from './layers';
import { fit, ready } from './zoom';

// The shown page marked in the Pages list and the page select.
export function markPage(pg: Json): void {
  for (const a of $('pages').querySelectorAll<HTMLElement>('a[data-page]')) {
    if (a.dataset.page === pg.id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  const id = typeof pg.id === 'string' ? pg.id : '';
  if ($<HTMLSelectElement>('pageSel').value !== id) $<HTMLSelectElement>('pageSel').value = id;
}
export function showPage(id: Json): void {
  const pg = pageById(id) || pages()[0];
  if (pg.id !== state.pageId) { state.sel = null; state.sels = []; } // a page switch clears the selection
  state.pageId = pg.id;
  sendHere(); // presence: the spot follows the shown page (kit-663)
  const n = ++shared.shown;
  renderPages(); // the row buttons follow the shown page
  markPage(pg);
  setState('loading');
  drawPage(pg.id);
  renderLayers(pg.id);
  selectIds(state.sels);
  if (kidsOf(pg).length === 0) showMsg(TEXT.empty); else hideMsg();
  // fitted when shown, and again once its images have their sizes, unless the person has moved since
  fit();
  imagesSettled().then(() => {
    if (n !== shared.shown) return;
    if (!held.moved) fit();
    drawHandles();
    placeOthers();
    setState('ready');
  });
}

// The shown page from the address (#page=<id>), or null.
export function hashPage(): string | null {
  const m = /^#page=(.*)$/.exec(location.hash);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}
// Show a page by putting it in the address (a reload stays on it); the hashchange shows it.
export function goPage(id: Json): void {
  const h = `#page=${encodeURIComponent(id)}`;
  if (location.hash === h) showPage(id); else location.hash = h;
}

// ---- page edits (kit-669 §1): add, rename, reorder, delete ----
export const PAGES_MAX = 100; // canvas@1 §7 pages
export const PAGE_SAY = {
  max: 'A canvas has at most 100 pages.',
  last: "A canvas needs at least one page, so this one wasn't deleted.",
  used: 'A component on this page is used on another page. Delete those instances first.',
};
// A page added after the last one, named Page <n> (n the smallest from the page count + 1 up that no
// page is named), and shown.
export function addPage(): void {
  if (!editable()) return;
  const list = pages();
  if (list.length >= PAGES_MAX) { say(PAGE_SAY.max); return; }
  const names = new Set(list.map(pageName));
  let n = list.length + 1;
  while (names.has(`Page ${n}`)) n++;
  const id = newId();
  const last = list[list.length - 1];
  const after = typeof last.id === 'string' ? last.id : null;
  if (edit([{ op: 'add', node: { id, type: 'page', parent: null, name: `Page ${n}` }, after }])) goPage(id);
}
// The page's name input opened in place of its link.
export function renamePage(id: string): void {
  if (!editable() || !pageById(id)) return;
  live.renaming = id;
  renderPages();
}
// A page moved one place up (dir -1) or down (1) among the pages.
export function movePage(id: string, dir: number): void {
  if (!editable()) return;
  const list = pages();
  const i: Json = pageAt(state.doc, id);
  if (i < 0 || (dir < 0 && i === 0) || (dir > 0 && i === list.length - 1)) return;
  const after = dir < 0 ? (i >= 2 ? list[i - 2].id : null) : list[i + 1].id;
  if (after !== null && typeof after !== 'string') return;
  edit([{ op: 'move', id, parent: null, after }]);
}
// Whether a component in the page's subtree has an instance outside that subtree (the server would
// refuse the delete `ref`).
export function usedElsewhere(id: string): boolean {
  const d = state.doc;
  const inside = new Set<Json>(subtreeIds(d, id));
  // @ts-ignore -- nodeIn is canvas-sync's stub (typed never) until kit-1015 ports it; the line is the page's
  const comps = new Set([...inside].filter((x) => nodeIn(d, x)?.type === 'component'));
  if (comps.size === 0) return false;
  // @ts-ignore -- nodeIn is canvas-sync's stub (typed never) until kit-1015 ports it; the line is the page's
  return Object.keys(d.nodes).some((x) => !inside.has(x) && nodeIn(d, x)?.type === 'instance' && comps.has(d.nodes[x].component));
}
// A page deleted, and the page before it shown (the next one, for the first); never the only page,
// nor one holding a component used on another page. No confirmation: Ctrl+Z undoes it.
export function deletePage(id: string): void {
  if (!editable()) return;
  const list = pages();
  const i: Json = pageAt(state.doc, id);
  if (i < 0) return;
  if (list.length <= 1) { say(PAGE_SAY.last); return; }
  if (usedElsewhere(id)) { say(PAGE_SAY.used); return; }
  const next = list[i > 0 ? i - 1 : i + 1].id;
  if (typeof next === 'string') goPage(next);
  edit([{ op: 'del', id }]);
}

// The page's load-time statements of these lines (1574-1657), in its order: run once by the section's
// init(), from mount().
export function initPages(): void {
  window.addEventListener('hashchange', () => { if (state.doc) showPage(hashPage()); });
  $('pageSel').addEventListener('change', (e: Json) => { if (state.doc) goPage(e.target.value); }); // e.target: the select
  live.pageAdd!.addEventListener('click', () => { if (ready()) addPage(); });
  $('pages').addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('#pages button[data-action]') : null;
    if (!b || b.disabled || !ready() || !editable()) return;
    const id = b.closest<HTMLElement>('.prow')?.dataset.page;
    if (typeof id !== 'string' || !pageById(id)) return;
    const act = b.dataset.action;
    if (act === 'page-rename') renamePage(id);
    else if (act === 'page-up') movePage(id, -1);
    else if (act === 'page-down') movePage(id, 1);
    else if (act === 'page-delete') deletePage(id);
  });
  // A double-click on a page's link shows that page and opens its name input.
  $('pages').addEventListener('dblclick', (e) => {
    const a = e.target instanceof Element ? e.target.closest<HTMLElement>('#pages a[data-page]') : null;
    if (!a || !ready() || !editable()) return;
    const id = a.dataset.page!;
    if (!pageById(id)) return;
    e.preventDefault();
    goPage(id);
    renamePage(id);
  });
}
