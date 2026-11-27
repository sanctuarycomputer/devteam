// kit-988: the shell's DOM glue (spec, Where each part goes): index.html's page code around the registry, and view
// only's DOM side. It calls four views' functions (spec, Calls into views not ported yet), so it is in the shell's
// cycle once they are ported: it exports function declarations only, and touches the DOM and calls those views
// only inside its functions. Its module flags are vars with no initializer, so a view's top-level call during the import
// cycle reads undefined (as their old initial values read) instead of a let's TDZ, and nothing resets them.
// bootShell() runs what the old script ran at its top level, once the markup exists.
import './pages';
import { shellPages } from '../../shared/shell/shell';
import { VIEW_TOAST, writes } from '../../lib/shell-view-only';
import { shell, viewer } from './state';
import { drawSettings, loadFleet } from '../settings';
import { tlPins } from '../thread';
import { thGo } from '../threads-panel';
import { avStep } from '../viewer';

// Declared without initializers: in the import cycle a view's top-level call may set one before this body runs.
var viewToastAt: number | undefined; // when the view-only toast last showed
var viewListening: boolean | undefined; // viewStop's listeners are on
var booted: boolean | undefined; // bootShell() has run

export function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

// Show one page: its section alone, its title in the page bar, its nav item current; a change of
// page starts at the top, unless the route scrolls to a target on it (keepScroll).
export function showPage(id: string, { keepScroll = false }: { keepScroll?: boolean } = {}): void {
  const pg = shellPages().find((x) => x.id === id) ?? shellPages()[0];
  const changed = shell.PAGE_NOW !== pg.id;
  shell.PAGE_NOW = pg.id;
  for (const sec of document.querySelectorAll<HTMLElement>('main.page > section[data-page]')) sec.classList.toggle('on', sec.dataset.page === pg.id);
  const title = $('page-title');
  if (title) title.textContent = pg.title;
  for (const a of document.querySelectorAll('.side a[href^="#"]')) {
    if (a.getAttribute('href') === `#${pg.id}`) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (changed && !keepScroll) window.scrollTo(0, 0);
  // arriving on Settings: fetch from origin and check again (what Check did), and draw it
  if (changed && pg.id === 'settings') { drawSettings(); loadFleet(true); }
  // the pins are drawn only for subjects on the page shown (one on a hidden page has no box)
  tlPins();
}

// The page an element is on: its section's data-page, else Overview.
export function sectionPage(el: Element | null | undefined): string {
  return el?.closest?.<HTMLElement>('main.page > section[data-page]')?.dataset.page ?? 'overview';
}

// The top-right button beside an open peek (kit-88 spec §2.1): the sticky page bar can't lift .tt above the
// scrim, so #tt-peek on <body> mirrors it: its content (ids dropped, so none is on the page twice), its
// label and title, copied whenever .tt changes; its click is .tt's. CSS shows one or the other.
function ttPeekMirror(): void {
  const tt = document.querySelector('.pagebar .tt'), mirror = $('tt-peek');
  if (!tt || !mirror) return;
  const copy = () => {
    const t = document.createElement('template');
    t.innerHTML = tt.innerHTML;
    for (const el of t.content.querySelectorAll('[id]')) el.removeAttribute('id');
    if (mirror.innerHTML !== t.innerHTML) mirror.innerHTML = t.innerHTML;
    for (const a of ['aria-label', 'title']) { const v = tt.getAttribute(a); if (v == null) mirror.removeAttribute(a); else if (mirror.getAttribute(a) !== v) mirror.setAttribute(a, v); }
  };
  copy();
  ttPeekPlace();
  new MutationObserver(() => { copy(); ttPeekPlace(); }).observe(tt, { subtree: true, characterData: true, childList: true, attributes: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(ttPeekPlace).observe(tt);
  addEventListener('resize', ttPeekPlace);
  mirror.addEventListener('click', () => document.querySelector<HTMLElement>('.pagebar .tt')?.click());
}

// #tt-peek level with .tt, from where .tt is (the page bar is sticky at the window's top), whatever its size
export function ttPeekPlace(): void {
  const tt = document.querySelector('.pagebar .tt'), mirror = $('tt-peek');
  if (!tt || !mirror) return;
  // .tt not drawn (the /view/ tab hides .app): the page's CSS places it (kit-89 spec §2.8)
  if (!tt.getClientRects().length) { if (mirror.style.top) mirror.style.top = ''; return; }
  const top = `${Math.round(tt.getBoundingClientRect().top * 100) / 100}px`;
  if (mirror.style.top !== top) mirror.style.top = top;
}

// ---- view only (kit-250): served to a view-only person (the box's gateway says so in /api/data's viewer, or
// /api/hello's level for the viewer tab, which reads no /api/data), the page says "View only" beside the kit badge
// and greys the writes, and a press on one shows why instead of sending it. The gateway refuses those writes
// anyway; this is so nobody presses and waits. Navigation is left alone: tabs, filters, links, Back, peeks, copy.
export function viewToast(): void {
  if (Date.now() - (viewToastAt ?? 0) < 2000) return;
  viewToastAt = Date.now();
  let t = document.getElementById('view-only-toast') as (HTMLElement & { _hide?: ReturnType<typeof setTimeout> }) | null;
  if (!t) {
    t = document.createElement('div');
    t.id = 'view-only-toast';
    t.setAttribute('role', 'status');
    document.body.append(t);
  }
  t.textContent = VIEW_TOAST;
  t.hidden = false;
  // the viewer's step: a function with properties; its stub has no clear, so this does nothing until its port
  (avStep as unknown as { clear?: () => void }).clear?.();
  clearTimeout(t._hide);
  const toast = t;
  t._hide = setTimeout(() => { toast.hidden = true; }, 2500);
}

export function viewStop(e: Event): void {
  if (!document.body.classList.contains('view-only')) return;
  const el = e.target instanceof Element ? e.target : null;
  if (!el || !writes(e, el)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.type === 'drop') el.closest('.dropbox')?.classList.remove('drop-over');
  viewToast();
}

export function viewOnly(level?: string | null): void {
  const view = level === 'view';
  document.body.classList.toggle('view-only', view);
  let b = document.getElementById('view-only');
  if (view && !b) {
    b = document.createElement('span');
    b.className = 'badge';
    b.id = 'view-only';
    b.textContent = 'View only';
    b.title = 'View only: you can look at everything on this box. Buttons that would change something are greyed out.';
    // the viewer tab hides .app (and #kit with it): there it goes in the viewer's bar, after the kind
    const at = document.getElementById(viewer() ? 'av-kind' : 'kit');
    if (at) at.after(b); else document.body.prepend(b);
  }
  if (b) b.hidden = !view;
  if (view && !viewListening) {
    viewListening = true;
    for (const type of ['click', 'submit', 'drop', 'pointerdown', 'keydown']) window.addEventListener(type, viewStop, true);
  }
}

// What the old script ran at its top level, once: after hydration (ShellClient's effect), when every mounted
// view's markup is in the DOM.
export function bootShell(): void {
  if (booted) return;
  booted = true;
  // An app, not a page: iOS ignores user-scalable=no for pinches, so its gesture events are cancelled.
  for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
  // The Inbox button opens the side panel on its Inbox tab (kit-100 spec §2.3); in the /view/ tab, on Threads (its
  // ruling, m-20261115-230458641-supervisor).
  $('inbox-btn')?.addEventListener('click', () => thGo({ th: viewer() ? 'open' : 'inbox', focus: true }));
  ttPeekMirror();
  if (viewer()) fetch('/api/hello', { cache: 'no-store' }).then((r) => r.json()).then((j: { level?: string | null }) => viewOnly(j.level ?? null)).catch(() => {});
  // in case React dropped it: a client render after a hydration mismatch clears <body>'s attributes (F16)
  document.body.classList.add('shell');
}
