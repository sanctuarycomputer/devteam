// kit-992: the Goals page (index.html's goals lines): renderGoals with its tab bar, and the goal order (kit-234):
// Move up / Move down, the arrow keys on a card's handle, and dragging it. The order's page memory (GOAL_ORDER_ERR,
// GOAL_FOCUS, GOAL_DRAG, GOAL_SWALLOW_UP) and GOALS_HTML are this module's own lets, which only goals reads; the
// tab is goalsState.GOALS_TAB. bootGoals() runs, once, what index.html runs of goals's lines at load, in its order:
// the fleet box's listeners, the goal order's, and the tab bar's binding. It lives here because those listeners
// assign this module's lets (an import can't be assigned).
import { SHELL_ROUTES } from '../../lib/shell-routes';
import { press, redrawNow } from '../data';
import { bindTabBar, empty, esc, headFor, parseHead, tabBar } from '../shell';
import { $ } from '../shell/page';
import { shell } from '../shell/state';
import { closedGoalCardHtml, goalCardHtml, upkeepCardHtml } from './cards';
import { fleetLeftPlace } from './fleet';
import { goalsState } from './state';
// `Loose` is `any`: index.html's values and events have no declared types. A cast `(x as Loose)` or a `!` is a type
// only (SWC strips it).
type Loose = any;

// Goals: the tab bar (Active, Met, Let go; the gt key), then the tab's cards two across. Drawn only when
// it changed, so a redraw keeps focus and an in-place confirm.
let GOALS_HTML = '';
// The Active tab's goals from a goals array, first to last: not met or let go, by priority (none last, ties
// as given). The one rule for the order: renderGoals draws it and activeGoalOrder saves from it.
export function activeGoalsOf(goals: Loose) {
  const pri = (g: Loose) => (typeof g.priority === 'number' ? g.priority : Infinity);
  return goals.filter((g: Loose) => !['met', 'abandoned'].includes(g.status)).sort((a: Loose, b: Loose) => pri(a) - pri(b));
}
// ui-candidate: empty (apps-src@2: renderGoals writes HTML strings and src/shared/ui/'s components are React, so no component's output is this markup; the port keeps index.html's)
export function renderGoals() {
  // a drag moves the cards itself; its drop or cancel draws again once it is over
  if (!shell.DATA || GOAL_DRAG) return;
  const o = (shell.DATA as Loose).ooda, R = o.roadmap, openQs = (shell.DATA as Loose).questions || [];
  const live = activeGoalsOf(o.goals);
  const met = o.goals.filter((g: Loose) => g.status === 'met'), gone = o.goals.filter((g: Loose) => g.status === 'abandoned');
  const tabs = tabBar({ tabs: [{ id: 'active', label: 'Active', count: live.length + ((shell.DATA as Loose).upkeep ? 1 : 0) }, { id: 'met', label: 'Met', count: met.length }, { id: 'letgo', label: 'Let go', count: gone.length }], selected: goalsState.GOALS_TAB });
  const grid = (cards: Loose) => `<div class="g12 goal-grid">${cards.join('')}</div>`;
  let body;
  if (goalsState.GOALS_TAB === 'active') {
    const cards = [(shell.DATA as Loose).upkeep ? upkeepCardHtml((shell.DATA as Loose).upkeep, (shell.DATA as Loose).upkeep_days) : '', ...live.map((g: Loose, i: Loose) => goalCardHtml(g, R, openQs, { i, n: live.length }))].filter(Boolean);
    body = (cards.length ? grid(cards) : '') + (o.goals.length ? live.length ? '' : '<p class="empty">None</p>' : empty('None'));
  } else {
    const list = goalsState.GOALS_TAB === 'met' ? met : gone;
    body = list.length ? grid(list.map((g: Loose) => closedGoalCardHtml(g, R, openQs))) : '<p class="empty">None</p>';
  }
  // the Active tab's reorder error (GOAL_ORDER_ERR, kept in page memory so every redraw keeps it), right under the tab bar
  const html = tabs + (goalsState.GOALS_TAB === 'active' ? `<span class="err" id="e-goal-order">${esc(GOAL_ORDER_ERR)}</span>` : '') + body;
  const list = $('goals-list')!;
  const ae = document.activeElement;
  const inList = !!ae && ae !== document.body && list.contains(ae);
  // the goal control that has focus (put back on its new copy)
  const had = inList ? goalControlOf(ae) : null;
  if (html !== GOALS_HTML) { list.innerHTML = html; GOALS_HTML = html; }
  // focus, across the redraw: the control that had it; else, fallen to the page, the moved goal's
  const now = document.activeElement;
  const lost = !now || now === document.body;
  const to = had && lost ? had : lost && GOAL_FOCUS ? GOAL_FOCUS : null;
  const el = to && goalControlEl(to);
  if (el && el !== now) el.focus(to === had ? { preventScroll: true } : undefined);
}
// ---- the goal order (kit-234): Move up / Move down in a goal's ⋯, ArrowUp / ArrowDown on its handle ----
// A refused order's reason, drawn under the Active tab's bar on every redraw until the next move.
let GOAL_ORDER_ERR = '';
// Where focus belongs after a move ({ id, what: 'grip' | 'menu' }): the moved goal's handle or ⋯ summary.
// Cleared once the owner moves on: focus anywhere else (not the page, which is a redraw dropping it), or a
// press off it.
let GOAL_FOCUS: Loose = null;
// The drag in progress: { id, pointerId, start (the ids as drawn when it began), card, x, y (where it was
// pressed), moved (the pointer has gone more than 3px from there) }, else null. While it is set renderGoals
// draws nothing: the drag moves the cards.
let GOAL_DRAG: Loose = null;
// A moved drag called off with the button still down (Escape, capture lost): that pointer's id, so its
// release swallows the click it makes; else null. A new press forgets it.
let GOAL_SWALLOW_UP: Loose = null;
// The goal control el is in: { id, what } for an active goal card's handle or ⋯ summary, else null.
export function goalControlOf(el: Loose) {
  const grip = el?.closest?.('.goal-grip[data-goal-grip]');
  if (grip) return { id: grip.dataset.goalGrip, what: 'grip' };
  const sum = el?.closest?.('details.menu > summary');
  const c = sum?.closest('[data-goal-card]');
  return c ? { id: c.dataset.goalCard, what: 'menu' } : null;
}
// The element for { id, what } in the goals list, or null.
export function goalControlEl({ id, what }: Loose) {
  const list = $('goals-list')!;
  if (what === 'grip') return list.querySelector(`.goal-grip[data-goal-grip="${CSS.escape(id)}"]`) as Loose;
  return list.querySelector(`[data-goal-card="${CSS.escape(id)}"] details.menu > summary`) as Loose;
}
export const sameGoalControl = (a: Loose, b: Loose) => !!a && !!b && a.id === b.id && a.what === b.what;
// The Active tab's goal ids as drawn (DATA, overlays and all, by activeGoalsOf, the rule renderGoals draws
// by; Upkeep left out), first to last. It reads DATA, not the page, so a drag's live preview doesn't move
// it: Move up / Move down and the arrow keys use it; a drag's drop reads the cards (drawnGoalOrder).
export function activeGoalOrder() {
  return shell.DATA ? activeGoalsOf((shell.DATA as Loose).ooda.goals).map((g: Loose) => g.id) : [];
}
// Save ids (every active goal, first to last) as the goal order: one POST /api/goal-order through press (all
// keyed goal-order, so moves post in turn, each with the order it was made with). The overlay draws the
// order at once (each goal's priority its new place); a refusal drops it and keeps the reason. focus: where
// focus goes after (the moved goal id's 'grip' or 'menu'), null for none.
export function saveGoalOrder(ids: Loose, { id = null as Loose, focus = null as Loose } = {}) {
  ids = [...ids];
  GOAL_FOCUS = id && focus ? { id, what: focus } : null;
  return press('goal-order', {
    build: () => ({ action: 'goal-order', body: { ids } }),
    overlay: {
      data: (d: Loose) => ({ ...d, ooda: { ...d.ooda, goals: d.ooda.goals.map((g: Loose) => (ids.includes(g.id) ? { ...g, priority: ids.indexOf(g.id) + 1 } : g)) } }),
      agrees: (raw: Loose) => ids.every((g: Loose, i: Loose) => raw.ooda.goals.find((x: Loose) => x.id === g)?.priority === i + 1),
    },
    apply: () => { GOAL_ORDER_ERR = ''; redrawNow(); },
    onError: (e: Loose) => { GOAL_ORDER_ERR = `Not saved: ${e}`; },
  } as Loose);
}
// Move goal id to index to among the active goals and save; null (nothing done) when to is out of range or
// its place already.
export function moveGoal(id: Loose, to: Loose, focus: Loose = null) {
  const cur = activeGoalOrder();
  const at = cur.indexOf(id);
  if (at < 0 || to < 0 || to >= cur.length || to === at) return null;
  const ids = cur.filter((x: Loose) => x !== id);
  ids.splice(to, 0, id);
  GOAL_FOCUS = focus ? { id, what: focus } : null;
  return saveGoalOrder(ids, { id, focus });
}
// ---- dragging a goal by its handle (kit-234; GOAL_DRAG above) ----
// The Active tab's goal ids as the cards stand on the page, first to last. During a drag this is its live
// preview, which DATA (activeGoalOrder) doesn't have; the drop saves this.
export function drawnGoalOrder() {
  return [...$('goals-list')!.querySelectorAll('.card.goal[data-goal-card]')].map((c: Loose) => c.dataset.goalCard);
}
export const goalCardEl = (id: Loose) => $('goals-list')!.querySelector(`.card.goal[data-goal-card="${CSS.escape(id)}"]`);
export const sameIds = (a: Loose, b: Loose) => a.length === b.length && a.every((x: Loose, i: Loose) => x === b[i]);
// The click a moved drag's release makes, swallowed so it opens nothing (no peek): one shot, in the capture
// phase, gone on the next tick.
export function swallowNextClick() {
  const swallow = (c: Loose) => { c.stopPropagation(); c.preventDefault(); };
  document.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 0);
}
// A drag called off (Escape, pointercancel, capture lost): the cards back in the order they began in, no post.
// After a move, its click is swallowed: at the release still to come when the button is held (held), else now.
export function cancelGoalDrag(held: Loose) {
  const d = GOAL_DRAG;
  if (!d) return;
  GOAL_DRAG = null;
  if (d.moved) { if (held) GOAL_SWALLOW_UP = d.pointerId; else swallowNextClick(); }
  const grip = d.card.querySelector('.goal-grip');
  try { if (grip?.hasPointerCapture(d.pointerId)) grip.releasePointerCapture(d.pointerId); } catch {}
  // put back only when the preview moved them: a card moved for nothing loses the press's click, and the
  // swallow above is what keeps that click from opening a peek
  const grid = d.card.parentNode;
  if (!sameIds(drawnGoalOrder(), d.start)) for (const id of d.start) { const c = goalCardEl(id); if (c && grid && c.parentNode === grid) grid.appendChild(c); }
  d.card.classList.remove('dragging');
  renderGoals();
}

// index.html's goals statements that run at load, in its order, once (GoalsClient's effect).
export function bootGoals() {
  document.addEventListener('focusin', fleetLeftPlace);
  document.addEventListener('focusout', () => setTimeout(fleetLeftPlace));
  document.addEventListener('keydown', (e: Loose) => { if (e.key === 'Escape' && (document.activeElement as Loose)?.closest?.('.fleet-left')) (document.activeElement as Loose).blur(); });
  window.addEventListener('resize', fleetLeftPlace);
  // the word scrolled with its strip or page: the box follows it, and closes once it is out of the window
  window.addEventListener('scroll', (e: Loose) => {
    const pop = document.getElementById('fleet-left-pop'), el = (document.activeElement as Loose)?.closest?.('.fleet-left');
    if (!el || !pop || pop.hidden || e.target === pop) return;
    const r = el.getBoundingClientRect();
    if (r.right < 0 || r.left > document.documentElement.clientWidth || r.bottom < 0 || r.top > innerHeight) el.blur();
    else fleetLeftPlace();
  }, true);
  document.addEventListener('focusin', (e: Loose) => {
    if (!GOAL_FOCUS || !(e.target instanceof Element) || e.target === document.body) return;
    if (!sameGoalControl(goalControlOf(e.target), GOAL_FOCUS)) GOAL_FOCUS = null;
  }, true);
  window.addEventListener('pointerdown', (e: Loose) => {
    if (GOAL_FOCUS && !sameGoalControl(goalControlOf(e.target), GOAL_FOCUS)) GOAL_FOCUS = null;
  }, true);
  // ArrowUp / ArrowDown on a goal's handle (by e.key; no modifier) moves it one place
  document.addEventListener('keydown', (e: Loose) => {
    if (GOAL_DRAG || !['ArrowUp', 'ArrowDown'].includes(e.key) || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    const grip = e.target?.closest?.('.goal-grip[data-goal-grip]');
    if (!grip) return;
    e.preventDefault();
    const id = grip.dataset.goalGrip;
    const at = activeGoalOrder().indexOf(id);
    if (at >= 0) moveGoal(id, e.key === 'ArrowUp' ? at - 1 : at + 1, 'grip');
  });
  // A press with the primary button on a goal's handle starts a drag; the handle holds the pointer (capture)
  document.addEventListener('pointerdown', (e: Loose) => {
    GOAL_SWALLOW_UP = null;
    if (GOAL_DRAG || e.button !== 0 || !e.isPrimary) return;
    const grip = e.target?.closest?.('.goal-grip[data-goal-grip]');
    const card = grip?.closest('.card.goal[data-goal-card]');
    if (!card || !$('goals-list')!.contains(card)) return;
    try { grip.setPointerCapture(e.pointerId); } catch { return; }
    GOAL_DRAG = { id: grip.dataset.goalGrip, pointerId: e.pointerId, start: drawnGoalOrder(), card, x: e.clientX, y: e.clientY, moved: false };
    card.classList.add('dragging');
  });
  // The live preview: the goal card under the pointer gives the dragged card its place. The cards between
  // them move past the dragged one (insertBefore), which itself never leaves the page, so capture holds.
  document.addEventListener('pointermove', (e: Loose) => {
    const d = GOAL_DRAG;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3) d.moved = true;
    const over = document.elementsFromPoint(e.clientX, e.clientY).map((el: Loose) => el.closest?.('.card.goal[data-goal-card]')).find((c: Loose) => c && c !== d.card && c.parentNode === d.card.parentNode);
    if (!over) return;
    const grid = d.card.parentNode;
    const cards = [...grid.querySelectorAll(':scope > .card.goal[data-goal-card]')];
    const from = cards.indexOf(d.card), to = cards.indexOf(over);
    if (from < 0 || to < 0) return;
    // over earlier: it and the cards up to the dragged one go after it, in order; over later: the cards
    // after the dragged one up to it go before it
    if (to < from) { const after = d.card.nextSibling; for (const c of cards.slice(to, from)) grid.insertBefore(c, after); }
    else for (const c of cards.slice(from + 1, to + 1)) grid.insertBefore(c, d.card);
  });
  // The drop: a changed order is saved once (focus back on the handle); an unchanged one is drawn again. After
  // a move, the release's click is swallowed either way. A press that never moved stays a plain click.
  document.addEventListener('pointerup', (e: Loose) => {
    if (GOAL_SWALLOW_UP !== null && e.pointerId === GOAL_SWALLOW_UP) { GOAL_SWALLOW_UP = null; swallowNextClick(); return; }
    if (!GOAL_DRAG || e.pointerId !== GOAL_DRAG.pointerId) return;
    const ids = drawnGoalOrder();
    const d = GOAL_DRAG;
    GOAL_DRAG = null;
    d.card.classList.remove('dragging');
    if (d.moved) swallowNextClick();
    if (sameIds(ids, d.start)) { renderGoals(); return; }
    saveGoalOrder(ids, { id: d.id, focus: 'grip' });
  });
  document.addEventListener('pointercancel', (e: Loose) => { if (GOAL_DRAG && e.pointerId === GOAL_DRAG.pointerId) cancelGoalDrag(false); });
  document.addEventListener('lostpointercapture', (e: Loose) => { if (GOAL_DRAG && e.pointerId === GOAL_DRAG.pointerId) cancelGoalDrag((e.buttons & 1) === 1); });
  // Escape during a drag cancels it, and only that: taken first (window, capture) so the page's own Escape
  // (closing a peek or the Threads panel) never sees it
  window.addEventListener('keydown', (e: Loose) => {
    if (!GOAL_DRAG || e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    cancelGoalDrag(true);
  }, true);
  // Selecting a tab is a new entry (#goals, #goals?gt=met), so Back restores the tab before and a reload keeps it.
  bindTabBar($('goals') as Loose, { onSelect: (id: Loose) => {
    if (!goalsState.GOALS_TABS.includes(id)) return;
    const cur = parseHead(location.hash, SHELL_ROUTES) as Loose;
    const state = cur.link === undefined && !cur.legacy && cur.page === 'goals' ? { ...cur.state } : {};
    if (id === 'active') delete state.gt; else state.gt = id;
    goalsState.GOALS_TAB = id;
    renderGoals();
    location.hash = headFor({ page: 'goals', state });
  } });
}
