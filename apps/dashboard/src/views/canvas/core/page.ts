// The canvas page's state and its bar, the Pages list and the page select (canvas.html 290-511, kit-1013).
// Each declaration is the page's own, with types added; checks/faithful.mjs holds it to the page's tokens.
// No DOM at import: prerender evaluates this module on Node.
import { edit, editable, freeText } from '../sync';
import { goPage } from '../panels';

/** A canvas-doc@1 value: the page's checkers judge it at run time. */
export type Json = any;

/** What the page holds (see the comment on `state`). */
export type State = {
  slug: string | null; session: Json; rev: Json; doc: Json; repo: Json; pageId: Json; sel: Json; sels: Json[];
  base: Json; pending: Json[]; kept: Json[]; saved: Json; savedOn: Json; locked: 'view' | 'closed' | null; paused: boolean; closedText: string | null;
  variantMode: Json; placing: Json;
};

/** The page's state other sections reassign: the old page's top-level lets, and #pageAdd (looked up at mount). */
export type Live = {
  drawn: Map<string, HTMLElement | SVGElement>;
  layerRows: Map<string, HTMLElement>;
  renaming: string | null;
  pagesDrawn: string | null;
  pageSelDrawn: string | null;
  pageAdd: HTMLButtonElement | null;
};

export const SLUG_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const TEXT = {
  notAddress: "This isn't a canvas address.",
  notOpen: "This canvas isn't open for editing.",
  notLoaded: "This canvas couldn't be loaded.",
  empty: 'This page is empty.',
  noSelection: 'Select a layer to see what it is.',
};
export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
export const isObj = (v: Json): boolean => v !== null && typeof v === 'object' && !Array.isArray(v);
export const own = (o: Json, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

// What the page holds: the slug, the response's session and rev, the document drawn, and the page
// shown. Editing (kit-662) keeps two copies: `base`, the document as the server has applied it, and
// `pending`, the page's own edits not yet acked ({ ops, seq, kind, entry }, seq null until sent), in
// order; `doc` is base with pending applied over it, what is drawn. `kept` (kit-668) holds the page's
// own edits acked but not yet saved, each with the `rev` of its ack and the socket's `session` then:
// a new session resends them. `saved` is the last `saved` rev and `savedOn` the socket's session it
// came on; `locked` is null, 'view' (refused as a View person) or 'closed' (landed or removed): no
// more edits either way.
export const state: State = {
  // sels (kit-669 §2): the selected ids of the shown page, in layer order; sel: the one id when
  // exactly one is selected, else null (every single-node tool reads it)
  slug: null, session: null, rev: null, doc: null, repo: null, pageId: null, sel: null, sels: [],
  base: null, pending: [], kept: [], saved: null, savedOn: null, locked: null, paused: false, closedText: null,
  // Change in (spec §3): { comp, name }, the variant a component's nodes are edited in, or null (Base);
  // placing: the component Place instance adds an instance of at the next click, or null
  variantMode: null, placing: null,
};

// The page's lets other sections reassign, on one holder (the page's own `let`s, as they started):
// the shown page's drawn nodes and Layers rows, by node id (Maps: an id is the document's string);
// the Pages list's and the page select's drawn keys; `renaming`, the page whose name input is open,
// or null (kit-669 §1); and the Pages panel's `+` (#pageAdd), now markup, looked up by mount().
export const live: Live = {
  drawn: new Map(),
  layerRows: new Map(),
  renaming: null,
  pagesDrawn: null,
  pageSelDrawn: null,
  pageAdd: null,
};

export const setState = (s: string) => { document.body.dataset.state = s; };
export function showMsg(text: string) {
  const m = $('msg');
  m.textContent = text;
  m.hidden = false;
}
export function hideMsg() {
  const m = $('msg');
  m.textContent = '';
  m.hidden = true;
}
export function fail(text: string) {
  showMsg(text);
  setState('error');
}

// The doc-response frame the page needs to walk the document; the server judges the rest.
export function frameOk(b: Json): boolean {
  return isObj(b) && isObj(b.doc) && Array.isArray(b.doc.pages) && b.doc.pages.length > 0
    && b.doc.pages.every(isObj) && isObj(b.doc.nodes) && isObj(b.repo);
}

// The bar's chip: where every edit goes, and whether that place may be public (null counts as public).
export function showRepo(repo: Json) {
  const name = typeof repo.name === 'string' && repo.name ? repo.name : null;
  const where = name === null ? "this project's repo" : name;
  const pub = name === null ? null : repo.public;
  const how = pub === true ? 'public' : pub === false ? 'private' : 'may be public';
  const chip = $('repoChip');
  const nameEl = document.createElement('span');
  nameEl.className = 'repo-name';
  nameEl.textContent = `Saved to ${where}`;
  const visEl = document.createElement('span');
  visEl.className = 'repo-vis';
  visEl.textContent = `· ${how}`;
  // the space between is text, so the chip's whole text reads `Saved to <where> · <how>`
  chip.replaceChildren(nameEl, ' ', visEl);
  chip.title = `Every edit is committed and pushed to ${where}.`;
  chip.classList.toggle('public', pub !== false);
  chip.hidden = false;
}

export const pages = (): Json[] => state.doc.pages;
export const pageById = (id: Json): Json => pages().find((pg) => pg.id === id) || null;
export const pageName = (pg: Json): string => (typeof pg.name === 'string' ? pg.name : '');

// The pages' ids and names, in order, as one string: the Pages list and the page select are rebuilt
// only when it changes, so another person's edit leaves a focused link focused and an open picker's
// options in place (redraw runs on every edit).
export const pagesKey = () => JSON.stringify(pages().map((pg) => [typeof pg.id === 'string' ? pg.id : '', pageName(pg)]));

// The shown page's row buttons: data-action, aria-label, text.
export const PAGE_ACTS = [['page-rename', 'Rename page', '✎'], ['page-up', 'Move page up', '↑'], ['page-down', 'Move page down', '↓'], ['page-delete', 'Delete page', '✕']];

// The Pages list: one row per page (div.prow), holding its link, by name, in order, and on the shown
// page's row while editing is allowed its four buttons (Move up disabled on the first page, Move
// down on the last); the page being renamed holds its name input in place of the link. Rebuilt only
// when the pages, whether editing is allowed, the shown page or the page being renamed change, and
// never while the name input is open. A link or button that had focus has it again (its page's new
// link, or the same button of its row while it is still enabled, else the row's link).
export function renderPages() {
  const nav = $('pages');
  const can = editable();
  live.pageAdd!.hidden = !can;
  if (live.renaming !== null && nav.querySelector('input[data-action="page-name"]')) return;
  const key = `${pagesKey()}|${can}|${state.pageId}|${live.renaming}`;
  if (key === live.pagesDrawn) return;
  live.pagesDrawn = key;
  const a = document.activeElement as HTMLElement;
  const was = a instanceof Element ? a.closest<HTMLElement>('#pages .prow') : null;
  const focusPage = was ? was.dataset.page : null;
  const focusAct = was && a.matches('button[data-action]') ? a.dataset.action : null;
  const list = pages();
  const rows = list.map((pg, i) => {
    const id = typeof pg.id === 'string' ? pg.id : '';
    const row = document.createElement('div');
    row.className = 'prow';
    row.dataset.page = id;
    if (can && live.renaming === id) {
      row.append(nameInput(id, pageName(pg)));
      return row;
    }
    const link = document.createElement('a');
    link.dataset.page = id;
    link.href = `#page=${encodeURIComponent(id)}`;
    link.textContent = pageName(pg);
    if (pg.id === state.pageId) link.setAttribute('aria-current', 'page');
    row.append(link);
    if (can && pg.id === state.pageId) {
      for (const [act, label, glyph] of PAGE_ACTS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.action = act;
        b.setAttribute('aria-label', label);
        b.title = label;
        b.textContent = glyph;
        if ((act === 'page-up' && i === 0) || (act === 'page-down' && i === list.length - 1)) b.disabled = true;
        row.append(b);
      }
    }
    return row;
  });
  nav.replaceChildren(...rows);
  const input = nav.querySelector<HTMLInputElement>('input[data-action="page-name"]');
  if (input) { input.focus({ preventScroll: true }); input.select(); return; }
  if (focusPage === null) return;
  const row = rows.find((r) => r.dataset.page === focusPage) || null;
  let back: HTMLElement | null = null;
  if (row && focusAct !== null) back = [...row.querySelectorAll<HTMLButtonElement>('button[data-action]')].find((b) => b.dataset.action === focusAct && !b.disabled) || null;
  if (!back && row) back = row.querySelector<HTMLElement>('a[data-page]');
  if (!back) back = nav.querySelector<HTMLElement>('a[data-page]');
  if (back) back.focus({ preventScroll: true });
}
// A page's name input: Enter or leaving it sends the name when it differs, is at most 200 characters
// (code points) and is free text; Escape sends nothing. Either way the list is rebuilt, the link back.
export function nameInput(id: string, name: string) {
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.dataset.action = 'page-name';
  inp.setAttribute('aria-label', 'Page name');
  inp.value = name;
  let done = false;
  const close = (send: boolean) => {
    if (done) return;
    done = true;
    const v = inp.value;
    const pg = pageById(id);
    if (send && v !== (pg ? pageName(pg) : name) && [...v].length <= 200 && freeText(v)) edit([{ op: 'set', id, prop: 'name', value: v }]);
    live.renaming = null;
    renderPages();
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); close(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
  });
  // left for a page's link: the rebuild replaces that link under the click, so its page is shown here
  inp.addEventListener('blur', (e) => {
    const to = e.relatedTarget instanceof Element ? e.relatedTarget.closest<HTMLElement>('#pages a[data-page]') : null;
    const go = to ? to.dataset.page : null;
    close(true);
    if (go !== null && pageById(go)) goPage(go);
  });
  return inp;
}

// The page <select> (the stage's page switch on a narrow screen): one option per page, by name.
export function renderPageSel() {
  const sel = $<HTMLSelectElement>('pageSel');
  const key = pagesKey();
  if (key === live.pageSelDrawn) return;
  live.pageSelDrawn = key;
  const opts = pages().map((pg) => {
    const o = document.createElement('option');
    o.value = typeof pg.id === 'string' ? pg.id : '';
    o.textContent = pageName(pg);
    return o;
  });
  sel.replaceChildren(...opts);
}

// The images drawn on the page, loaded or failed: the page is ready once none is still loading.
export function imagesSettled() {
  const imgs = [...$('surface').querySelectorAll('img')].filter((img) => !img.complete);
  return Promise.all(imgs.map((img) => new Promise((r) => {
    img.addEventListener('load', r, { once: true });
    img.addEventListener('error', r, { once: true });
  })));
}
