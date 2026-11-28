// kit-1008: the hub's address, its tabs and its history (hub.html 1292-1477: hubFrameRoute, hubTabs,
// hubHistory, hubVisible). Nothing runs at import: bootHub() (boot.ts) calls installRoute() at steps 3-5.
import { hubShellState as hs } from './state';
import { _openAt, _tlOpen } from './others';
import { TERM, byRoot, dom, getTerm, hexAt, keyOf, select, selectOverview } from './panes';
import { hubOverviewState } from '../hub-overview/state';
import { hubThreadsState } from '../hub-threads/state';
import { addrState, hubHead, hubMarked, keptHead, tlHashOf } from '../../lib/hub-shell-head';
import { routeFrom } from '../../lib/hub-shell-frames';
import { bindTabBar, tabBar, tabStep, type ShellRoot } from '@shared/shell/shell';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

/* hubFrameRoute start */
// The hub's half of dashboard-shell@2 §10 (test/contracts/shell.md). The hub's heads are
// #<key>[/<dashboard head>], #overview[?ot=<operator thread id>], #settings and #terminal (hubHead, the lib's).
// The project a key names: its own key, or else the one listed project of that name (its twin, which
// made both keys hex-suffixed, has gone). The hub's own views are never a project's name here.
export function hubFind(key: string) {
  const all = [...hs.items.values()].sort((a, b) => byRoot(a.x.root, b.x.root));
  const own = all.find((o) => keyOf(o) === key);
  if (own || !key || hubOverviewState.HUB_VIEWS.includes(key)) return own ?? null;
  const named = all.filter((o) => !o.goneAt && o.x.name === key);
  return named.length === 1 ? named[0] : null;
}
// the selected project's address: its key and its kept head, in place (the frame's own hash change made the entry)
export function hubWrite(it: Loose, mayPush = false) {
  const key = encodeURIComponent(keyOf(it));
  const head = keptHead(it.head);
  hubAddr(head ? `#${key}/${head.slice(1)}` : `#${key}`, mayPush);
}
// The address Copy link copies for that project, sent to its frame's origin alone: on a box: 2 box its
// own host, else the hub's own address for it.
export function hubBase(it: Loose) {
  const f = it.frame;
  const url = hs.urlOf(it.x);
  if (!(f instanceof HTMLIFrameElement) || !url) return;
  const base = hs.box?.v === 2 ? `${url}#` : `${location.origin}${location.pathname}#${encodeURIComponent(keyOf(it))}/`;
  try { f.contentWindow?.postMessage({ devteam: 'hub-base', base }, new URL(url).origin); } catch {}
  hubVisible(it);
}
// the Overview's address: the operator thread open on it, if one with a name is
export const tlHash = () => tlHashOf(hubThreadsState.TL.open);
/* hubFrameRoute end */

/* hubTabs start */
// The hub's tabs are dashboard-shell@3's tab bar: each is a tab tabBar draws, taken in as nav#tabs's
// own child (nav#tabs keeps its role and label, so there is no tablist inside a tablist), and their one
// tab panel is main#frames. A tab's id in the bar is terminal, overview or p-<its root's 6 hex>: a
// project's key may hold characters an id can't, and tabBar gives such a tab no id.
const HUB_PANEL = 'frames';
export const hubTabId = (root: string) => (root === TERM ? 'terminal' : root === hs.OVERVIEW ? 'overview' : `p-${hexAt(root)}`);
const hubRootOf = (id: string | null | undefined) => (id === 'terminal' ? (getTerm() ? TERM : null) : id === 'overview' ? hs.OVERVIEW : [...hs.items.keys()].find((r) => hubTabId(r) === id) ?? null);
// one tab, as tabBar draws it, with the hub's .tab for its dot, its counts and a gone tab's look
export function hubTab(id: string, label: string, disabled = false) {
  const t = document.createElement('template');
  t.innerHTML = tabBar({ tabs: [{ id, label, disabled }], panel: HUB_PANEL });
  const b = t.content.querySelector('[role="tab"]') as HTMLElement;
  b.classList.add('tab');
  b.setAttribute('aria-selected', 'false');
  b.tabIndex = -1;
  return b;
}
/* hubTabs end */

/* hubHistory start */
// dashboard-shell@3 §10: a tab the owner chooses is a history entry, marked { hub: 1, key }; Back or
// Forward onto a marked entry only selects its tab. Everything else the hub writes (the first entry,
// a hub-route, a hash typed by hand, the step itself) replaces the entry and keeps it marked. A choice
// is what runs inside a click on the hub's page, or the tab bar's keys (hubChoose).
// hubTyped: a hash typed, pasted or linked: its popstate comes before its hashchange, and a frame's hub-route may land between.
// hubHashWas: the hash the page last saw (a popstate onto the same hash has no hashchange to clear hubTyped); set at boot step 5.
// hubPopAt: the hash a popstate this page took left: the hashchange that follows it has nothing to do.
export const nav = { hubChoosing: false, hubTyped: null as string | null, hubHashWas: '', hubPopAt: null as string | null };
export function hubChoose(root: string) {
  if (root === hs.selected) return;
  nav.hubChoosing = true;
  try { select(root); } finally { nav.hubChoosing = false; }
}
// the address, marked with its key (the hash's first part, as written): a new entry only for a choice that changes it.
// Written with History's own methods: Next's App Router patches history.pushState and replaceState to copy its
// router state into every entry (next/dist/client/components/app-router.js), and an entry is the hub's mark alone,
// as hub.html writes it. The popstate listener below keeps Next's off these entries (Next reloads on one it didn't write).
export function hubAddr(url: string, mayPush = false) {
  nav.hubTyped = null;
  const state = addrState(url);
  if (mayPush && nav.hubChoosing && url !== location.hash) { nav.hubChoosing = false; History.prototype.pushState.call(history, state, '', url); }
  else History.prototype.replaceState.call(history, state, '', url);
  nav.hubHashWas = location.hash;
}
/* hubHistory end */

/* hubVisible start */
// dashboard-shell@3 §10's hub-visible: a project's frame hears true when its tab is selected, false
// when it is left, and where it stands after every hub-base. Sent to the frame's origin alone.
let hubShown: string | null = null;
export function hubVisible(it: Loose, visible = hs.selected === it?.x.root) {
  const f = it?.frame;
  const url = it ? hs.urlOf(it.x) : null;
  if (!(f instanceof HTMLIFrameElement) || !url) return;
  try { f.contentWindow?.postMessage({ devteam: 'hub-visible', visible }, new URL(url).origin); } catch {}
}
export function hubShow(key: string | null) {
  if (key === hubShown) return;
  const was = hs.items.get(hubShown as string);
  hubShown = key;
  if (was) hubVisible(was, false);
  const now = hs.items.get(key as string);
  if (now) hubVisible(now, true);
}
/* hubVisible end */

// boot steps 3 (the hub-route listener and the first hashchange), 4 (hubTabs) and 5 (hubHistory), in hub.html's order
export function installRoute() {
  const { tabsEl, framesEl } = dom;
  // A dashboard's head, from its own frame window on its own origin only, and only a head (the lib's
  // routeFrom: C7-C11). Kept per project; the address follows only the selected one's.
  window.addEventListener('message', (ev) => {
    const it = routeFrom(ev, hs.items.values(), (o: Loose) => (o.frame instanceof HTMLIFrameElement ? o.frame.contentWindow : undefined), (o: Loose) => new URL(String(hs.urlOf(o.x))).origin);
    if (!it) return;
    it.head = (ev.data as { head: string | null }).head;
    // not over a hash typed, pasted or linked whose hashchange hasn't run yet: that hashchange decides
    if (hs.selected === it.x.root && nav.hubTyped !== location.hash) hubWrite(it);
    hubBase(it);
  });
  // An address the hub didn't write (a link, a push, one typed): a project at a head opens it there;
  // an operator thread opens its card. Registered before the plain tab switch (boot.ts), which then has
  // nothing left to do for these.
  window.addEventListener('hashchange', () => {
    // never a choice, and nothing to do for a Back or Forward step the popstate below took
    nav.hubChoosing = false;
    nav.hubTyped = null;
    nav.hubHashWas = location.hash;
    if (nav.hubPopAt !== null) { const was = nav.hubPopAt; nav.hubPopAt = null; if (was === location.hash) return; }
    const { key, head, ot } = hubHead(location.hash);
    if (key === 'overview') {
      if (hs.selected !== hs.OVERVIEW) selectOverview();
      // then the address settles on the thread actually open (an ot naming no listed thread opens nothing)
      if (ot) _tlOpen(ot).finally(() => { if (hs.selected === hs.OVERVIEW) hubAddr(tlHash()); });
      return;
    }
    const it = hubFind(key);
    if (!it) return;
    if (head) return void _openAt(it.x.root, head);
    if (it.x.root !== hs.selected) select(it.x.root);
    else hubWrite(it);
  });
  // hubTabs
  tabsEl.classList.add('tabbar');
  framesEl.setAttribute('role', 'tabpanel');
  bindTabBar(tabsEl as ShellRoot, { onSelect: (id) => { const r = hubRootOf(id); if (r !== null) hubChoose(r); } });
  // Arrows, Home and End move from the tab with focus, skipping a disabled one, in the capture phase:
  // the page's older arrow listener on the nav never hears them (it moves from the selection).
  tabsEl.addEventListener('keydown', (e: KeyboardEvent) => {
    const b = (e.target as Loose)?.closest?.('[role="tab"]');
    if (!b || !tabsEl.contains(b)) return;
    const all = [...tabsEl.querySelectorAll('[role="tab"]')] as HTMLElement[];
    const to = tabStep(all.map((x) => ({ id: x.dataset.tab, disabled: x.getAttribute('aria-disabled') === 'true' })), b.dataset.tab, e.key);
    if (to === null || to === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    const r = hubRootOf(to);
    if (r !== null) hubChoose(r);
    all.find((x) => x.dataset.tab === to)?.focus();
  }, true);
  // hubHistory
  nav.hubHashWas = location.hash;
  window.addEventListener('click', () => { nav.hubChoosing = true; setTimeout(() => { nav.hubChoosing = false; }); }, true);
  window.addEventListener('popstate', (e) => {
    nav.hubChoosing = false;
    const was = nav.hubHashWas;
    nav.hubHashWas = location.hash;
    if (!hubMarked(e.state)) { if (location.hash !== was) nav.hubTyped = location.hash; return; }
    // the hub's own entry: the hub's alone to take (Next's listener would reload the page on it)
    e.stopImmediatePropagation();
    let k: string;
    try { k = decodeURIComponent(e.state.key); } catch { return; }
    const it = k === 'overview' || k === 'settings' || k === 'terminal' ? null : hubFind(k);
    const root = k === 'overview' ? hs.OVERVIEW : k === 'settings' ? hs.SETTINGS : k === 'terminal' ? (getTerm() ? TERM : null) : it ? it.x.root : null;
    // a tab no longer here: as unmarked (the hashchange opens it as @2 §10 says)
    if (root === null) return;
    const { head } = hubHead(location.hash);
    // after a reload a project has no frame or kept head yet: it opens at the entry's head, as @2 says
    if (it && head && (!it.frame || !keptHead(it.head))) _openAt(root, head);
    else if (root !== hs.selected) select(root);
    nav.hubPopAt = location.hash;
  }, true);
}
