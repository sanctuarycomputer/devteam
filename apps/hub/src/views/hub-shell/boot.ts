// kit-1008: the hub shell's draw and boot (hub.html 3194-3504): the tabs' paint, notifications, the 10 s
// draw, the late listeners, the drop hint, View only, findBox, and bootHub(), which runs hub.html's top
// level once, after the markup exists, in hub.html's order (spec, Server and client, steps 1-9).
import { hubShellState as hs } from './state';
import { _boxAlertNow, _countsEl, _el, _memoryStart, _oaToast, _openAt, _ownAlert, _paintOverview, _paintSettings, _stateOf, _tlActive, _tlOpen, _tlRefresh } from './others';
import { $, TERM, byRoot, dom, frameFor, getTerm, hexOf, installPanes, keyOf, lookUp, select, selectOverview, selectSettings, selectTerminal, setTerm, showOnly } from './panes';
import { installFleet } from './fleet';
import { hubFind, hubTab, hubTabId, installRoute, nav } from './route';
import { hubSettingsState } from '../hub-settings/state';
import { boxFrom, perRoot as perRootOf } from '../../lib/hub-shell-box';
import { hubHead, keptHead } from '../../lib/hub-shell-head';
import { PULSE_STATES } from '@shared/shell/shell';
import { POLL_MS } from '@shared/poll';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

const lastInbox = new Map<string, number>();
const openedWith = new Set<string>(); // roots already there when the page opened: their first count is a baseline
let firstDraw = true;
const GONE_MS = 30000;
// hub.html 861's value, computed once at boot step 2 (the server render has no Notification)
export function notifyOk(): boolean {
  if (hs.NOTIFY_OK === null) hs.NOTIFY_OK = 'Notification' in window && window.isSecureContext;
  return hs.NOTIFY_OK;
}
// the key the address names: a project's, or overview, settings or terminal (hubHead reads the rest)
const wanted = () => hubHead(location.hash).key;

export function paintOvTab() {
  if (!hs.ovTab) return;
  const box = _boxAlertNow();
  hs.ovTab.replaceChildren('Overview');
  if (box) { const a = _el('span', 'badge', '!'); a.setAttribute('aria-label', box); hs.ovTab.append(a); }
}
export function paintTab(it: Loose) {
  const { x, tab } = it;
  const S = PULSE_STATES[_stateOf(it)];
  tab.replaceChildren();
  // its state's dot (red pulses, except under reduced motion), its name, the Inbox button's counts for it
  tab.append(_el('span', `dot${S.tone ? ` ${S.tone}` : ''}${S.tone === 'red' ? ' pulse' : ''}`), _el('span', '', x.name));
  const c = _countsEl(x);
  if (c) tab.append(c);
  const own = _ownAlert(x);
  if (own) {
    const a = _el('span', 'badge', '!');
    a.setAttribute('aria-label', own);
    tab.append(a);
  }
  tab.title = S.label;
  if (it.frame) it.frame.title = String(x.name);
  tab.classList.toggle('gone', Boolean(it.goneAt));
}
function notifyFor(it: Loose, before: number | undefined) {
  const n = it.x.inbox;
  // on a box the gateway sends these, by push, whether or not this page is open
  if (hs.box || !notifyOk() || Notification.permission !== 'granted' || typeof n !== 'number' || typeof before !== 'number' || n <= before) return;
  const note = new Notification(`${it.x.name}: ${n - before} new in the Inbox`, { body: String(it.x.root), tag: `devteam-${it.x.root}` });
  note.onclick = () => { window.focus(); select(it.x.root); note.close(); };
}
const pushKey = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const pushSave = async (sub: PushSubscription) => { const r = await fetch('/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub) }); if (!r.ok) throw new Error(`the box answered ${r.status}`); };
// On a box this page only subscribes. iOS offers push only to an app on the Home Screen. A device
// already subscribed says so again each time, in case the box has forgotten it.
async function pushControl() {
  const el = $('notify');
  const say = (t: string) => { el.replaceChildren(); el.textContent = t; };
  if (!('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext)) return say((navigator as Loose).standalone === false ? 'Add to Home Screen for notifications' : '');
  navigator.serviceWorker.addEventListener('message', (e) => { if (typeof e.data?.hash === 'string') location.hash = e.data.hash; });
  let reg: ServiceWorkerRegistration;
  try { reg = await navigator.serviceWorker.register('/sw.js'); } catch { return say('Notifications are unavailable here'); }
  const paint = async (): Promise<void> => {
    const p = Notification.permission;
    if (p === 'denied') return say('Notifications are blocked for this page');
    const sub = p === 'granted' ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      await pushSave(sub).catch(() => {});
      hubSettingsState.pushSub = sub;
      say('Notifying you of new Inbox items');
      return void _paintSettings();
    }
    hubSettingsState.pushSub = null;
    const b = document.createElement('button');
    b.textContent = 'Notify me of new Inbox items';
    // asked first and at once: Safari allows the prompt only straight from the click
    b.onclick = async () => {
      try {
        if (await Notification.requestPermission() === 'granted') {
          const ready = await navigator.serviceWorker.ready;
          await pushSave(await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushKey(hs.box.push) }));
        }
        await paint();
      } catch (e) { say(`Couldn't turn on notifications: ${(e as Error).message}`); }
    };
    el.replaceChildren(b);
    _paintSettings();
  };
  await paint().catch(() => say('Notifications are unavailable here'));
}
function notifyControl() {
  if (hs.box?.push) return void pushControl();
  const el = $('notify');
  el.replaceChildren();
  if (!notifyOk()) { el.textContent = "This browser can't notify from this page"; return void _paintSettings(); }
  const p = Notification.permission;
  if (p === 'granted') el.textContent = 'Notifying you of new Inbox items';
  else if (p === 'denied') el.textContent = 'Notifications are blocked for this page';
  else {
    const b = document.createElement('button');
    b.textContent = 'Notify me of new Inbox items';
    b.onclick = async () => { try { await Notification.requestPermission(); } catch {} notifyControl(); };
    el.append(b);
  }
  _paintSettings();
}

export async function draw() {
  const { items, OVERVIEW, SETTINGS } = hs;
  const { tabsEl, empty } = dom;
  // the memory line asks on its own one-minute timer, never on this 10 s one
  _memoryStart();
  let data: Loose;
  try {
    const r = await fetch('/instances.json', { cache: 'no-store' });
    // behind a gateway, a session that ended: load the page again, which signs in first
    if (r.status === 401) return location.reload();
    data = await r.json();
    if (!data || typeof data !== 'object') throw new Error('not a list');
    hs.hubSeen = data;
  } catch { hs.hubSeen = null; _paintOverview(); _paintSettings(); return; }
  const now = Date.now();
  const seen = new Set<string>();
  // One tab per root: if two answers claim one root (a second dashboard of one repo, or something
  // pretending), the tab keeps the port it already shows, else the lowest; the rest are ignored (the lib's).
  const perRoot = perRootOf<Loose>(data.instances, (root) => items.get(root)?.x.port);
  for (const x of perRoot.values()) {
    seen.add(x.root);
    await hexOf(x.root);
    let it = items.get(x.root);
    if (!it) {
      const tab = hubTab(hubTabId(x.root), x.name);
      tabsEl.append(tab);
      it = { x, tab, frame: null, goneAt: null };
      items.set(x.root, it);
    }
    const before = lastInbox.get(x.root);
    it.x = x;
    it.goneAt = null;
    // an instance that turns up later with items already waiting counts them as new; one that was
    // there when the page opened (still starting) takes its first count as the baseline
    if (firstDraw) openedWith.add(x.root);
    else notifyFor(it, before ?? (typeof x.inbox === 'number' && !openedWith.has(x.root) ? 0 : undefined));
    if (typeof x.inbox === 'number') lastInbox.set(x.root, x.inbox);
  }
  for (const [root, it] of items) {
    if (seen.has(root)) continue;
    it.goneAt ??= now;
    if (now - it.goneAt > GONE_MS) {
      it.tab.remove();
      it.frame?.remove();
      items.delete(root);
      if (hs.selected === root) hs.selected = null;
    }
  }
  // An address that changed since its frame was made: a port that moved (the frame follows it, once),
  // or a name that became shared or stopped being shared (a frame becomes a panel, or back).
  for (const [root, it] of items) {
    if (!it.frame) continue;
    const url = hs.urlOf(it.x);
    if (url === it.addr) continue;
    // at its kept head, so the view on screen survives the move
    if (url && it.addr && it.frame instanceof HTMLIFrameElement) { it.frame.src = `${url}${keptHead(it.head)}`; it.addr = url; continue; }
    it.frame.remove();
    it.frame = null;
    it.loaded = null;
    if (hs.selected === root) { frameFor(it); showOnly(hs.selected); }
  }
  // tabs in the hub's order (by root)
  for (const root of [...items.keys()].sort(byRoot)) tabsEl.append(items.get(root).tab);
  const term = getTerm();
  if (hs.ovTab) tabsEl.prepend(hs.ovTab);
  if (term) tabsEl.prepend(term.tab);
  else if (viewTermTab) tabsEl.prepend(viewTermTab);
  for (const it of items.values()) paintTab(it);
  paintOvTab();
  empty.hidden = items.size > 0 || Boolean(term) || hs.selected === OVERVIEW || hs.selected === SETTINGS;
  if (!items.size) empty.textContent = 'No projects running';
  if (!hs.selected || (hs.selected !== TERM && hs.selected !== OVERVIEW && hs.selected !== SETTINGS && !items.has(hs.selected))) {
    nav.hubChoosing = false;
    const { key: want, head, ot } = hubHead(location.hash);
    // the address picks a tab, at the head it names; with none, the Overview (the terminal when the
    // address says so), at the operator thread it names
    const pick = hubFind(want);
    if (pick && head) _openAt(pick.x.root, head);
    else if (pick) select(pick.x.root);
    else if (term && want === 'terminal') selectTerminal();
    else if (want === 'settings') selectSettings();
    else { selectOverview(); if (want === 'overview' && ot) _tlOpen(ot); }
  }
  _paintOverview();
  _paintSettings();
  // the threads with the operator, on the same 10 s, and only while the Overview is what shows
  if (_tlActive() && !firstDraw) _tlRefresh();
  firstDraw = false;
}
/* viewOnly start */
// View only (kit-250), from /box.json's level: <body> gets view-only, a "View only" badge ends the tab
// bar, after the tabs (the hub shows no person's name), the mock's line sits under it on every tab, and a capturing
// listener stops a press on the hub's writes with the toast (oaToast's node). The gateway refuses those
// writes anyway; this is so nobody presses and waits. Anything else is left alone.
const HUB_WRITES = ".fleet-switch [data-fleet], [data-tl-send], #tl-c-text, [data-tl-start], [data-tl-end], [data-tl-reopen], #view-notify";
let viewToastAt = 0;
function viewStop(e: Event) {
  if (!document.body.classList.contains('view-only')) return;
  const el = e.target instanceof Element ? e.target : null;
  const write = el?.closest(HUB_WRITES);
  if (!write || write.id === 'view-notify') return;
  if (e.type === 'keydown') {
    const typing = write.matches('textarea, input');
    const key = (e as KeyboardEvent).key;
    if (!(key === 'Enter' || (key === ' ' && !typing))) return;
  }
  e.preventDefault();
  e.stopImmediatePropagation();
  if (Date.now() - viewToastAt < 2000) return;
  viewToastAt = Date.now();
  _oaToast('View only: you can look, but not change anything');
}
let viewListening = false;
// the Terminal tab at View: there, disabled, and kept first by draw() as term's is (term stays null)
let viewTermTab: HTMLElement | null = null;
export function viewOnly() {
  const view = hs.box?.level === 'view';
  document.body.classList.toggle('view-only', view);
  let badge = $('view-only'), line = $('view-line');
  if (view && !badge) {
    badge = _el('span', '', 'View only');
    badge.id = 'view-only';
    badge.title = 'View only: you can look at everything on this box. Buttons that would change something are greyed out.';
    line = _el('div', 'view-line', 'View only: you can look at everything on this box. Buttons that would change something are greyed out.');
    line.id = 'view-line';
    // the badge ends the header's bar, after the tabs' strip (which scrolls); the line sits under the header
    dom.tabsEl.after(badge);
    dom.tabsEl.parentElement.after(line);
  }
  if (badge) badge.hidden = !view;
  if (line) line.hidden = !view;
  if (view && !viewListening) {
    viewListening = true;
    for (const type of ['click', 'submit', 'keydown']) window.addEventListener(type, viewStop, true);
  }
}
/* viewOnly end */
// The hub on a laptop has no box.json (404); a devteam gateway answers it (its reading is the lib's boxFrom).
export async function findBox() {
  // the Overview's tab, made before this runs: taken in as tabBar's
  if (hs.ovTab && !hs.ovTab.dataset.tab) { const b = hubTab('overview', 'Overview'); b.title = hs.ovTab.title; hs.ovTab.replaceWith(b); hs.ovTab = b; }
  try {
    const r = await fetch('/box.json', { cache: 'no-store' });
    const b = r.ok ? await r.json() : null;
    const box = boxFrom(b, location, hubSettingsState.OA_ROLES);
    if (!box) return;
    hs.box = box;
    const tab = hubTab('terminal', 'Terminal', box.level === 'view');
    dom.tabsEl.prepend(tab);
    if (box.level === 'view') {
      // there but disabled: term stays null, so #terminal and a remembered Terminal tab fall back as a laptop's do
      tab.setAttribute('aria-disabled', 'true');
      tab.setAttribute('aria-selected', 'false');
      tab.tabIndex = -1;
      viewTermTab = tab;
      tab.title = 'View only: no terminal';
      tab.onclick = () => _oaToast('View only: no terminal');
    } else {
      tab.title = 'The box\'s tmux sessions: supervisors, workers, logins';
      setTerm({ tab, frame: null });
    }
    viewOnly();
  } catch {}
}

let booted = false;
// hub.html's top level, once (a second call, as React's StrictMode makes in development, adds nothing)
export function bootHub() {
  if (booted) return;
  booted = true;
  // 1. An app, not a page: iOS ignores user-scalable=no for pinches, so its gesture events are cancelled.
  for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
  // 2. the elements, and NOTIFY_OK
  lookUp();
  notifyOk();
  const { tabsEl } = dom;
  // 3-5. securitypolicyviolation, hub-fleet-done, hub-route, the first hashchange; hubTabs; hubHistory
  installPanes();
  installFleet();
  installRoute();
  // 6. the plain tab switch, the arrows, the drop hint
  window.addEventListener('hashchange', () => {
    const want = wanted();
    if (want === 'terminal' && getTerm()) return void (hs.selected !== TERM && selectTerminal());
    if (want === 'overview') return void (hs.selected !== hs.OVERVIEW && selectOverview());
    if (want === 'settings') return void (hs.selected !== hs.SETTINGS && selectSettings());
    const it = [...hs.items.values()].find((o) => keyOf(o) === want);
    if (it && it.x.root !== hs.selected) select(it.x.root);
  });
  tabsEl.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const term = getTerm();
    const roots = [...(term ? [TERM] : []), hs.OVERVIEW, ...[...hs.items.keys()].sort(byRoot)];
    // Settings has no tab: its arrows move on from the Overview's
    const i = roots.indexOf(hs.selected === hs.SETTINGS ? hs.OVERVIEW : (hs.selected as string));
    const next = roots[(i + (e.key === 'ArrowRight' ? 1 : roots.length - 1)) % roots.length];
    if (next) { select(next); (next === TERM ? term.tab : next === hs.OVERVIEW ? hs.ovTab : hs.items.get(next).tab).focus(); }
  });
  // Left alone, a browser opens whatever is dropped on a page in a new tab. A drop on the terminal
  // goes to the terminal's own page, in its frame; this is for everywhere the hub itself is under
  // the pointer (the tab bar, the margins), where nothing can take it. Refused, with a word why.
  {
    const hint = $('drop-hint');
    let hide: ReturnType<typeof setTimeout> | undefined;
    const say = () => {
      if (getTerm()) hint.textContent = hs.selected === TERM ? 'Drop onto the terminal, below the tabs' : 'Drop onto the Terminal tab';
      else hint.textContent = 'This page doesn\'t take files';
      hint.hidden = false;
      clearTimeout(hide);
      hide = setTimeout(() => { hint.hidden = true; }, 1500);
    };
    window.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'; say(); });
    window.addEventListener('drop', (e) => { e.preventDefault(); say(); });
  }
  // 7. The Overview's tab: after the box's Terminal, before the projects.
  const ovTab = document.createElement('button');
  ovTab.className = 'tab';
  ovTab.setAttribute('role', 'tab');
  ovTab.textContent = 'Overview';
  ovTab.title = 'Every project at a glance: is it moving, what it needs from you';
  ovTab.onclick = selectOverview;
  hs.ovTab = ovTab;
  tabsEl.append(ovTab);
  // 8, 9
  findBox().then(() => { notifyControl(); return draw(); });
  setInterval(draw, POLL_MS);
}
