// kit-1008: the hub shell's panes (hub.html 850-1076): the elements, a project's key, what shows, the
// selects, a project's frame and a refused one. Nothing runs at import: bootHub() (boot.ts) calls
// lookUp() and installPanes() in hub.html's order.
import { hubShellState as hs } from './state';
import { _closeMenu, _el, _hubKey, _paintOverview, _paintSettings, _tlLeave, _tlRefresh } from './others';
import { hubAddr, hubBase, hubShow, hubWrite, tlHash } from './route';
import { keptHead } from '../../lib/hub-shell-head';
import { dropRefused, markRefused, refusedItem } from '../../lib/hub-shell-frames';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

// The hub's page: a tab per devteam instance on the machine (its name, and a badge when its Inbox
// has something), and that instance's own dashboard in a frame under it, on the instance's own
// address. The list comes from the hub's own server (instances.json); text goes in as text.
export const $ = (id: string): Loose => document.getElementById(id);
// tabsEl, framesEl and empty, looked up at boot (step 2)
export const dom = { tabsEl: null as Loose, framesEl: null as Loose, empty: null as Loose };
export function lookUp() {
  dom.tabsEl = $('tabs');
  dom.framesEl = $('frames');
  dom.empty = $('empty');
  hs.ovEl = $('overview');
  hs.ovBody = $('ov-body');
  hs.setEl = $('settings-view');
}
const hex6 = new Map<string, string>(); // root -> 6 hex of its sha1, for telling two same-named instances apart
export const hexAt = (root: string) => hex6.get(root);

export async function hexOf(root: string) {
  if (!hex6.has(root)) {
    try { const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(root)); hex6.set(root, [...new Uint8Array(d)].slice(0, 3).map((b) => b.toString(16).padStart(2, '0')).join('')); } catch { hex6.set(root, String(hex6.size)); }
  }
  return hex6.get(root);
}
export function keyOf(it: Loose) {
  const twins = [...hs.items.values()].filter((o) => o.x.name === it.x.name).length > 1;
  return _hubKey(it.x.name, twins, hex6.get(it.x.root));
}
export const TERM = '\u0000terminal';
let term: Loose = null; // { tab, frame }
export const getTerm = () => term;
export const setTerm = (t: Loose) => { term = t; };
export const byRoot = (a: unknown, b: unknown) => String(a).localeCompare(String(b));

// Whatever is selected, only its own view shows: the Overview, the terminal or one dashboard.
export function showOnly(key: string | null) {
  // a card's ⋯ menu belongs to the Overview
  _closeMenu();
  const { OVERVIEW, SETTINGS, ovTab } = hs;
  // under Settings no tab is selected, but the Overview tab stays in the tab order: the keyboard's way back
  if (ovTab) { ovTab.setAttribute('aria-selected', String(key === OVERVIEW)); ovTab.tabIndex = key === OVERVIEW || key === SETTINGS ? 0 : -1; }
  hs.ovEl.hidden = key !== OVERVIEW;
  hs.setEl.hidden = key !== SETTINGS;
  // the thread layer is the Overview's: its dock, its pins and its polls go with it
  $('tl').hidden = key !== OVERVIEW;
  if (key !== OVERVIEW) _tlLeave();
  if (term) { term.tab.setAttribute('aria-selected', String(key === TERM)); term.tab.tabIndex = key === TERM ? 0 : -1; if (term.frame) term.frame.hidden = key !== TERM; }
  for (const [r, o] of hs.items) {
    o.tab.setAttribute('aria-selected', String(r === key));
    o.tab.tabIndex = r === key ? 0 : -1;
    if (o.frame) o.frame.hidden = r !== key;
  }
  // the one tab panel, labelled by the selected tab (none under Settings)
  const on = key === TERM ? term?.tab : key === OVERVIEW ? ovTab : hs.items.get(key as string)?.tab;
  if (on?.id) dom.framesEl.setAttribute('aria-labelledby', on.id); else dom.framesEl.removeAttribute('aria-labelledby');
  hubShow(key);
}
export function selectOverview() {
  hs.selected = hs.OVERVIEW;
  hubAddr(tlHash(), true);
  showOnly(hs.OVERVIEW);
  _paintOverview();
  _tlRefresh();
}
export function selectSettings() {
  hs.selected = hs.SETTINGS;
  hubAddr('#settings', true);
  showOnly(hs.SETTINGS);
  _paintSettings();
}
export function selectTerminal() {
  if (!term) return;
  hs.selected = TERM;
  hubAddr('#terminal', true);
  if (!term.frame) {
    term.frame = document.createElement('iframe');
    term.frame.title = 'Terminal';
    term.frame.className = 'no-shell';
    term.frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-pointer-lock');
    term.frame.setAttribute('allow', 'clipboard-read; clipboard-write');
    term.frame.src = hs.box.terminal;
    dom.framesEl.append(term.frame);
  }
  showOnly(TERM);
  term.frame.focus();
}
export function select(root: string) {
  if (root === TERM) return selectTerminal();
  if (root === hs.OVERVIEW) return selectOverview();
  if (root === hs.SETTINGS) return selectSettings();
  const it = hs.items.get(root);
  if (!it) return;
  hs.selected = root;
  // the address the view its kept frame shows: the head its frame last said (§10)
  hubWrite(it, true);
  frameFor(it);
  showOnly(root);
  hubBase(it);
}
// A project's dashboard in its frame, made once and kept; hidden until its tab is chosen. The
// Overview's fleet controls use it too: the dashboard does the owner action, on its own origin.
// A project with no address on this box gets a panel instead, saying why and how to fix it; one
// whose frame the hub's policy refused (frameRefused) gets one saying to reload in a moment.
// it.addr is the address the frame was made for: draw compares it with the project's address now.
export function frameFor(it: Loose) {
  const { urlOf } = hs;
  if (!it.frame && !urlOf(it.x)) {
    const [short, full] = urlOf.words[urlOf.why(it.x) as string];
    it.frame = _el('section', 'page');
    it.frame.setAttribute('role', 'tabpanel');
    it.frame.setAttribute('aria-label', String(it.x.name));
    it.frame.hidden = hs.selected !== it.x.root;
    const why = _el('p');
    why.innerHTML = `This project has no address on this box: ${short} (${full(it.x.name)}).`;
    const fix = _el('p');
    fix.innerHTML = 'To fix it, set <code>project</code> in that project\'s <code>docs/devteam/project/settings.md</code> to a name that can be a host, and restart its dashboard.';
    for (const p of [why, fix]) p.style.maxWidth = 'var(--measure)';
    it.frame.append(_el('h2', '', it.x.name), why, fix);
    it.addr = null;
    it.loaded = Promise.resolve();
    dom.framesEl.append(it.frame);
  }
  // the address kept: draw sees no change, and doesn't make a frame this page's policy would refuse again
  if (!it.frame && it.refused) {
    it.frame = _el('section', 'page');
    it.frame.setAttribute('role', 'tabpanel');
    it.frame.setAttribute('aria-label', String(it.x.name));
    it.frame.hidden = hs.selected !== it.x.root;
    const say = _el('p', '', 'The hub doesn\'t know this project yet: the box hasn\'t caught up with it. Reload this page in a moment.');
    say.style.maxWidth = 'var(--measure)';
    it.frame.append(_el('h2', '', it.x.name), say);
    it.addr = urlOf(it.x);
    it.loaded = Promise.resolve();
    dom.framesEl.append(it.frame);
  }
  if (!it.frame) {
    it.addr = urlOf(it.x);
    it.frame = document.createElement('iframe');
    it.frame.title = String(it.x.name);
    it.frame.className = 'no-shell';
    it.frame.hidden = hs.selected !== it.x.root;
    // A dashboard runs scripts, fetches its own origin, posts forms and opens links in new tabs; it
    // never navigates this page, whatever answers in the block. A nested frame can't gain what this
    // one lacks, so modals, pointer lock and fullscreen are here for the dashboard's artifact viewer.
    it.frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-pointer-lock');
    it.frame.setAttribute('allow', 'clipboard-write; fullscreen');
    it.loaded = new Promise((resolve) => it.frame.addEventListener('load', resolve, { once: true }));
    // a frame that loaded was let in: its origin may make the hub reload again, once, if refused later.
    // A refused frame fires load too (its error page), after the violation: this page's seen says so.
    const f = it.frame;
    // on every load, not once: the dashboard reloads itself, and a sign-in inside the frame is a navigation
    f.addEventListener('load', () => hubBase(it));
    f.addEventListener('load', () => { let origin: string; try { origin = new URL(f.src).origin; } catch { return; } setTimeout(() => { if (!frameRefused.seen.has(origin)) frameRefused.drop(origin); }, 300); });
    it.frame.src = `${urlOf(it.x)}${keptHead(it.head)}`;
    dom.framesEl.append(it.frame);
  }
  return it.frame;
}
// A project frame the hub's own Content-Security-Policy refused (box: 2: the gateway's frame-src names
// each project's host as it knew them when it served this page, fixed until a reload). The selected
// tab's reloads the page once per host (sessionStorage, across the reload; the hash is kept), and if
// still refused says the hub doesn't know the project yet. A hidden one (a fleetAsk) never reloads:
// its ask ends with that error. Which item a violation refuses is the lib's (C14, C15).
function frameRefused(ev: SecurityPolicyViolationEvent) {
  const r = refusedItem(ev, hs.box?.v, hs.items.values(), (o: Loose) => o.addr);
  if (!r) return;
  const { it, origin } = r;
  frameRefused.seen.add(origin);
  frameRefused.wake.get(it.x.root)?.();
  if (hs.selected !== it.x.root) return;
  if (frameRefused.mark(origin)) return void location.reload();
  it.refused = true;
  it.frame?.remove();
  it.frame = null;
  it.loaded = null;
  frameFor(it);
  showOnly(hs.selected);
}
// this page's refused origins; root -> the waiting fleetAsk's wake; the list kept across a reload
frameRefused.seen = new Set<string>();
frameRefused.wake = new Map<string, () => void>();
// true only when the origin is newly kept, read back: a storage that can't keep it never reloads
frameRefused.mark = (origin: string) => markRefused(sessionStorage, origin);
frameRefused.drop = (origin: string) => dropRefused(sessionStorage, origin);
// boot step 3, first
export function installPanes() {
  window.addEventListener('securitypolicyviolation', frameRefused);
}
export { frameRefused };
