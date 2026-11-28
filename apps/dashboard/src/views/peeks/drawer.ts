// kit-997: the drawer (index.html's peeks lines 5399-5534): what is open, redraw and focus, the slide in and out, and
// drawerFor.
import { PEEK_FAIL, fetchPeek, peekKey } from '../../lib/peeks-cache';
import { openClass, openSensor } from '../autonomy';
import { goHead, typingIn } from '../data';
import { dataState } from '../data/state';
import { openLib } from '../library';
import { openAct, openBuiltin, openDecision, openFeature, openFile, openGoal, openJob, openLearning, openLesson, openMilestone, openObservation, openPlanner, openProblem, openQuestion, openRelease, openRetro, openSignal, openStory, openThread, openTicket, openWave, refetchFile } from '../peek-kinds';
import { peekKindsState } from '../peek-kinds/state';
import { closeTarget, esc, ttPeekPlace } from '../shell';
import { $ } from '../shell/page';
import { peeksState } from './state';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


// On each data refresh: the open object's peek again (not one that wasn't found), then a redraw.
export function refreshDrawer() {
  if (!peeksState.DRAWER.kind || $('drawer')!.hidden) return;
  for (const [kind, id, q] of [[peeksState.DRAWER.kind, peeksState.DRAWER.id, (peeksState.DRAWER as Loose).q || {}], ...((peeksState.DRAWER as Loose).deps || [])]) {
    const p = peeksState.PEEKS.get(peekKey(kind, id, q || {}));
    if (!p?.missing) fetchPeek(kind, id, q || {});
  }
  if (peeksState.DRAWER.kind === 'file' && (peeksState.DRAWER as Loose).url) refetchFile((peeksState.DRAWER as Loose).url);
  redraw();
}
// ---- drawer ----
export let lastFocus: Loose = null;
// The hash that opens a record's peek: #<kind>/<encoded id>; a file's is #file?path=<encoded path>.
export const peekFor = (kind: Loose, id: Loose) => (kind === 'file' ? `#file?path=${encodeURIComponent(id)}` : `#${kind}/${encodeURIComponent(id)}`);
export const OPENERS = () => ({ ticket: openTicket, goal: openGoal, feature: openFeature, story: openStory, release: openRelease, wave: openWave, milestone: openMilestone, act: openAct, decision: openDecision, retro: openRetro, lesson: openLesson, problem: openProblem, thread: openThread, planner: openPlanner, q: openQuestion, file: openFile, sensor: openSensor, observation: openObservation, signal: openSignal, learning: openLearning, lib: openLib, class: openClass, recurring: openJob, builtin: openBuiltin });
// Not under someone mid-action: typing or choosing in the drawer, a confirm step showing, a request
// in flight. The next refresh draws it.
export function busyDrawer() {
  const body = $('drawer-body');
  const ae = document.activeElement;
  return !!(body!.querySelector('.confirm, [aria-busy="true"]') || (ae && body!.contains(ae) && ['TEXTAREA', 'SELECT', 'INPUT'].includes(ae.tagName)));
}
export function redraw() { if (peeksState.DRAWER.kind && !$('drawer')!.hidden && !busyDrawer()) (OPENERS() as Loose)[peeksState.DRAWER.kind]?.((peeksState.DRAWER as Loose).arg ?? peeksState.DRAWER.id); }
// Where focus was, as a selector that finds the same control after a redraw.
export function focusKey(el: Loose) {
  if (!el) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  // a property's key (a dt with its tip) is found again by its tip
  const named = [...el.attributes].filter((a: Loose) => a.value && (/^(data-.*|href|name|value|aria-describedby)$/.test(a.name) || (el.tagName === 'DT' && a.name === 'title')));
  return named.length ? el.tagName.toLowerCase() + named.map((a: Loose) => `[${a.name}="${CSS.escape(a.value)}"]`).join('') : null;
}
// Note where focus is before a redraw, and put it back after: the same control (the nth, if a link
// is on the page twice), its caret and selection, and the page's scroll.
export function focusMark() {
  const el = document.activeElement;
  const key = el && el !== document.body ? focusKey(el) : null;
  return { el, key, nth: key ? [...document.querySelectorAll(key)].indexOf((el as Loose)) : -1, y: window.scrollY, sel: typingIn(el) && (el as Loose)!.selectionStart != null ? [(el as Loose)!.selectionStart, (el as Loose)!.selectionEnd, (el as Loose)!.selectionDirection] : null, top: el?.scrollTop };
}
export function focusBack(m: Loose) {
  if (m.key && !m.el.isConnected) {
    const el = document.querySelectorAll(m.key)[m.nth];
    el?.focus({ preventScroll: true });
    if (el && m.sel) { el.setSelectionRange(...m.sel); el.scrollTop = m.top; }
  }
  if (window.scrollY !== m.y) window.scrollTo(0, m.y);
}
// Draw the drawer; the same HTML again leaves it as it is (charts, diagrams, scroll and focus kept).
export function showDrawer(html: Loose) {
  const after = peeksState.AFTER;
  peeksState.AFTER = [];
  // a drawer sliding out is opening again
  const opening = !peekIsOpen();
  if (!opening && html === peeksState.LAST_HTML) return;
  const fresh = opening || peeksState.LAST_HTML === '';
  const keep = !fresh && $('drawer-body')!.contains(document.activeElement) ? focusKey(document.activeElement) : null;
  peeksState.LAST_HTML = html;
  if (opening) lastFocus = document.activeElement;
  $('drawer-body')!.innerHTML = html;
  const h = $('drawer-body')!.querySelector('h2#drawer-title');
  const [icon, label] = (peeksState.TYPE_META as Loose)[peeksState.DRAWER.kind] || [];
  $('drawer-bar-title')!.innerHTML = `${label ? `<span class="dtype"><i class="icon-${icon}" aria-hidden="true"></i><span class="badge">${esc(label)}</span></span>` : ''}<span class="dtitle"${h ? ` title="${esc(h.textContent.trim())}"` : ''}>${h ? h.innerHTML : ''}</span>`;
  if (h) h.remove();
  peekShow();
  if (fresh) $('drawer-close')!.focus();
  else if (keep) ($('drawer-body')!.querySelector(keep) as Loose)?.focus();
  for (const f of after) f();
}
// The peek on the shell's frame (test/contracts/shell.md §3, kit-88 spec §2.1): peek-open on the .shell element (<body>)
// slides the drawer in and fades the scrim. Opening unhides both and forces a style flush first, so the
// slide starts from the closed place; closing removes peek-open and hides both once the slide ends (its
// transform transition, or --dur if none runs; at once under reduced motion, --dur 0). A reopen before then
// cancels the pending hide, so #drawer.hidden still means "closed", only now after the slide.
export let PEEK_HIDE: Loose = null;
export const peekIsOpen = () => !$('drawer')!.hidden && document.body.classList.contains('peek-open');
export function peekShow() {
  if (PEEK_HIDE) PEEK_HIDE.cancel();
  const d = $('drawer'), s = $('scrim');
  if (d!.hidden || s!.hidden) { d!.hidden = false; s!.hidden = false; void d!.offsetWidth; }
  // opened over the open panel, it is on top of it at 900px and below (final-1 F1); a redraw changes nothing
  if (!document.body.classList.contains('peek-open')) document.body.classList.toggle('th-under-peek', document.body.classList.contains('threads-open'));
  document.body.classList.add('peek-open');
  document.body.style.overflow = 'hidden';
  ttPeekPlace();
}
export function peekHide({ now = false }: Loose = {}) {
  const d = $('drawer'), body = document.body;
  // already sliding out: that slide's hide stands, unless this one is at once
  if (PEEK_HIDE && !now) return;
  if (PEEK_HIDE) PEEK_HIDE.cancel();
  body.classList.remove('peek-open');
  // the viewer, a preview or a review it was under keeps the scrim (and the page's scroll held)
  const hide = () => { if (PEEK_HIDE) PEEK_HIDE.cancel(); d!.hidden = true; if (!body.classList.contains('overlay-open')) { $('scrim')!.hidden = true; body.style.overflow = ''; } };
  const cs = getComputedStyle(document.documentElement).getPropertyValue('--dur').trim();
  const dur = /ms$/.test(cs) ? parseFloat(cs) : parseFloat(cs) * 1000 || 0;
  if (now || d!.hidden || !(dur > 0)) return hide();
  // a leftover end or cancel from the slide in (a close during it, or in the frame it ended) is ignored while the slide out runs
  const end = (e: Loose) => { if (e.target === d && e.propertyName === 'transform' && !d!.getAnimations().some((a: Loose) => a.transitionProperty === 'transform')) hide(); };
  // a slide that never starts (nothing to move) ends at --dur; one that runs ends with its transitionend
  // (or its cancel), however long a loaded machine takes to draw it: once it runs, that timer is off.
  // Whether it runs is known now (getAnimations flushes the style that removing peek-open changed), not
  // only when its transitionrun arrives, which a loaded machine can deliver after --dur: hiding then would
  // cut the slide short. One that runs and sends neither (a background tab, the frame's display changed)
  // is caught by the safety net, well past --dur, which hides only a frame still closed: never shown-but-closed
  const sliding = d!.getAnimations().some((a: Loose) => a.transitionProperty === 'transform');
  const timer = sliding ? null : setTimeout(hide, dur + 100);
  const net = setTimeout(() => { if (!body.classList.contains('peek-open')) hide(); }, dur + 1000);
  const run = (e: Loose) => { if (e.target === d && e.propertyName === 'transform') clearTimeout((timer as Loose)); };
  d!.addEventListener('transitionrun', run);
  d!.addEventListener('transitionend', end);
  d!.addEventListener('transitioncancel', end);
  PEEK_HIDE = { cancel: () => { clearTimeout((timer as Loose)); clearTimeout(net); d!.removeEventListener('transitionrun', run); d!.removeEventListener('transitionend', end); d!.removeEventListener('transitioncancel', end); PEEK_HIDE = null; } };
}
// Closing a peek (×, Escape, the scrim): to the page under it, by closeTarget (test/contracts/shell.md §7): Back
// over every entry this visit pushed down to the page, else in place to the page in its stamp.
export function closeDrawer() {
  // already sliding out: one close, one history move
  if (!peekIsOpen()) return;
  peeksState.DRAWER = { kind: null, id: null };
  peeksState.LAST_HTML = '';
  peekHide();
  lastFocus?.focus?.();
  const c = closeTarget(history.state);
  // back to the entry below, which has its own head: the panel's th and t from under the peek go with it (kit-89 §2.5)
  if ((c as Loose).go) { dataState.TH_CARRY = history.state?.page ?? null; dataState.TH_CARRY_FROM = location.hash; history.go((c as Loose).go); } else goHead((c as Loose).replace, { replace: true });
}
// Each opener names the object (and how to draw it again), then draws it.
export const drawerFor = (kind: Loose, id: Loose, arg: Loose) => {
  // another drawer: what failed to load (a peek, a lineage graph) is tried again
  if (peeksState.DRAWER.kind !== kind || peeksState.DRAWER.id !== id) { peeksState.LAST_HTML = ''; const k = peekKey(kind, id); for (const f of [...PEEK_FAIL.keys()]) if (f === k || f.startsWith(`${k}\0`)) PEEK_FAIL.delete(f); for (const [g, svg] of [...peekKindsState.LINEAGE_SVG]) if (svg === false) peekKindsState.LINEAGE_SVG.delete(g); }
  const same = peeksState.DRAWER.kind === kind && peeksState.DRAWER.id === id;
  peeksState.DRAWER = { kind, id, arg, q: same ? (peeksState.DRAWER as Loose).q : undefined, deps: same ? (peeksState.DRAWER as Loose).deps : undefined, url: same ? (peeksState.DRAWER as Loose).url : undefined } as Loose;
};
