// @ts-nocheck: the block is index.html's JS moved byte for byte, and strict TypeScript can't check its body without
// changing it (escHtml's lookup by the matched character, closest()'s null in bindTabBar, sortRows' nums, a caught
// value's message, segs.pop() in peekHead, Object.hasOwn under ES2020's lib). Its types below are checked wherever
// they are used: every exported name has typed parameters and returns.
// kit-988: the shell's builders, binders and URL rules (dashboard-shell@1, test/contracts/shell.md), which the
// dashboard and the hub share. The block below is index.html's devteam-shell-js, moved with its markers: its only
// changes are `export ` before each top-level declaration and the types. No imports and no DOM at import: compiled
// to lib-dist/shared/shell/shell.js, which test/dashboard-shell.test.mjs imports and also runs in node:vm.

// ---- the block's types: what its builders read and its binders bind ----

/** The part of an element the binders use. An HTMLElement is one. */
export interface ShellEl {
  closest(selectors: string): ShellEl | null;
  contains(other: ShellEl | Node | null): boolean;
  getAttribute(name: string): string | null;
  querySelectorAll(selectors: string): Iterable<ShellEl>;
  focus(): void;
  readonly dataset: { readonly [key: string]: string | undefined };
  readonly isConnected: boolean;
  readonly disabled?: boolean;
}
/** The part of an event the binders read. */
export interface ShellEvent { readonly target: ShellEl; preventDefault(): void }
export interface ShellKeyEvent extends ShellEvent { readonly key: string }
/** A binder's root: the element it listens on. */
export interface ShellRoot extends ShellEl {
  addEventListener(type: 'click', listener: (e: ShellEvent) => void): void;
  addEventListener(type: 'keydown', listener: (e: ShellKeyEvent) => void): void;
}

/** What tabSelected and tabStep read of a tab. */
export type TabState = { id?: string; disabled?: boolean };
/** A tab of tabBar: its count drawn beside its label, blue while waiting. */
export type ShellTab = { id: string; label?: string; count?: string | number | null; waiting?: boolean; disabled?: boolean };
export type TabBarOptions = { tabs?: readonly ShellTab[]; selected?: string | null; panel?: string | null; size?: 'sub' | null };
export type TabPanelOptions = { panel?: string | null; tabs?: readonly TabState[]; selected?: string | null };

/** A record table's column: its label, or { label }. */
export type DbCol = string | { label: string };
/** A record table's row: its cells' HTML, or { cells, sort } with sort[i] the key column i sorts by (null: empty). */
export type DbRow = unknown[] | { cells: unknown[]; sort?: readonly (string | number | null | undefined)[] };
/** The column a record table sorts by (null: none), ascending (1) or descending (-1). */
export type DbSort = { col: number | null; dir?: 1 | -1 };
/** A properties table row: [key, value HTML, tooltip?]. */
export type PropRow = readonly [key: string, html?: unknown, tip?: string | null];

/** The Built or Met step's part: how far along (0 to 1), its words, its tooltip. */
export type StepPart = { frac?: number | null; text?: string | null; title?: string | null };
export type GoalStepsOptions = { step?: number; built?: StepPart | null; met?: StepPart | null };
/** One day of Upkeep's heartbeat: the day (YYYY-MM-DD), what ran, and whether a check failed. */
export type HeartbeatDay = { day?: string | null; items?: unknown[] | null; failed?: boolean };

export type PulseState = { label: string; tone: string; rank: number };
export type FleetMode = 'run' | 'drain' | 'park';
export type FleetSwitchOptions = {
  scope?: 'project' | 'row' | 'machine';
  mode?: FleetMode | 'mixed';
  counts?: { running?: number; draining?: number; parked?: number };
  confirming?: boolean;
  busy?: string | null;
  error?: string | null;
};

/** A registered page: its nav entry, its count, and its draw. */
export type ShellPage = { id: string; title: string; group: string; icon: string; count?(): number | string | null; render?(data: unknown): void };
/** The element a Threads tab draws into. */
export type TabPane = { innerHTML: string };
export type ThreadsTab = { id: string; label: string; count?(): number | string | null; render?(el: TabPane): void; disabled?: boolean };
export type ThreadsTabItem = { id: string; label: string; count: number | string | null; disabled: boolean };
export type ThreadsTabs = { register(tab: ThreadsTab): void; list(): ThreadsTabItem[]; render(id: string, el: TabPane): boolean };

/** The router's table (the page's own: src/lib/shell-routes.ts's SHELL_ROUTES). */
export type ShellRoutes = {
  pages: readonly string[];
  peeks: readonly string[];
  links: Readonly<Record<string, string>>;
  files: readonly (readonly [RegExp, string])[];
  redirects: Readonly<Record<string, string>>;
};
/** A page head's state keys and their values. */
export type HeadState = { [key: string]: string | null | undefined };
/** A parsed page head; legacy when it came from a peek's link head, redirected when from a redirect. */
export type PageHead = { page: string; state: HeadState; legacy?: true; redirected?: true; link?: undefined };
/** A parsed link head: the head, its kind, and the page it opens over on a cold load. */
export type LinkHead = { link: string; kind: string; home: string };
export type ParsedHead = PageHead | LinkHead;
/** What headFor writes: a link head, or a page with its state. */
export type HeadLike = { link: string } | { page: string; state?: HeadState | null; link?: undefined };
/** history.state for an entry. */
export type Stamp = { page: string; depth: number; openedHere: boolean };

/* devteam-shell-js start */
// dashboard-shell@1 (test/contracts/shell.md): the builders, binders and URL rules both
// pages share. Byte-identical in index.html and hub.html; it touches no DOM until a binder is
// called and uses no page global, so test/dashboard-shell.test.mjs runs it in vm.
export const escHtml = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const shellText = (html: unknown): string => String(html ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();

// ---- the tab bar: counts, a disabled state, roving tabindex, arrows that skip disabled tabs ----
export const TAB_PANEL: RegExp = /^[a-z][a-z0-9-]*$/;
export const TAB_ID: RegExp = /^[A-Za-z0-9_-]+$/;
export const goodPanel = (p: unknown): boolean => typeof p === 'string' && TAB_PANEL.test(p);
export const goodTabId = (id: unknown): boolean => TAB_ID.test(String(id ?? ''));
// the tab a bar selects: selected if it is enabled, else the first enabled tab (undefined: none)
export function tabSelected(tabs: readonly TabState[], selected: string | null | undefined): string | null | undefined {
  return tabs.some((t) => t.id === selected && !t.disabled) ? selected : (tabs.find((t) => !t.disabled) || {}).id;
}
export function tabBar({ tabs = [], selected = null, panel = null, size = null }: TabBarOptions = {}): string {
  const sel = tabSelected(tabs, selected);
  return `<div class="tabbar${size === 'sub' ? ' sub' : ''}" role="tablist">${tabs.map((t) => {
    const on = t.id === sel;
    const ctl = goodPanel(panel) && goodTabId(t.id) ? ` id="tab-${panel}-${t.id}" aria-controls="${panel}"` : '';
    const n = t.count === undefined || t.count === null || t.count === '' ? '' : ` <span class="n${t.waiting ? ' blue' : ''}">${escHtml(t.count)}</span>`;
    return `<button type="button" role="tab" data-tab="${escHtml(t.id)}"${ctl} aria-selected="${on}" tabindex="${on ? 0 : -1}"${t.disabled ? ' aria-disabled="true"' : ''}>${escHtml(t.label)}${n}</button>`;
  }).join('')}</div>`;
}
// the panel a tab bar controls, labelled by the tab the bar selects; a bad panel gives html unwrapped
export function tabPanel({ panel, tabs = [], selected = null }: TabPanelOptions = {}, html?: string | null): string {
  const body = html ?? '';
  if (!goodPanel(panel)) return body;
  const sel = tabSelected(tabs, selected);
  const lab = sel !== undefined && goodTabId(sel) ? ` aria-labelledby="tab-${panel}-${sel}"` : '';
  return `<div role="tabpanel" id="${panel}"${lab}>${body}</div>`;
}
// the tab an arrow, Home or End moves to from fromId, wrapping and skipping disabled tabs (null: not a move)
export function tabStep(tabs: readonly TabState[], fromId: string | undefined, key: string): string | null | undefined {
  const on = tabs.filter((t) => !t.disabled);
  if (!on.length || !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(key)) return null;
  if (key === 'Home') return on[0].id;
  if (key === 'End') return on[on.length - 1].id;
  const all = tabs.map((t) => t.id);
  let i = all.indexOf(fromId);
  if (i < 0) return key === 'ArrowRight' ? on[0].id : on[on.length - 1].id;
  for (let n = 0; n < all.length; n++) {
    i = (i + (key === 'ArrowRight' ? 1 : -1) + all.length) % all.length;
    if (!tabs[i].disabled) return tabs[i].id;
  }
  return null;
}
export function bindTabBar(root: ShellRoot, { onSelect }: { onSelect: (id: string | undefined) => void }): void {
  const tabsOf = (bar: ShellEl): TabState[] => [...bar.querySelectorAll('[role="tab"]')].map((b) => ({ id: b.dataset.tab, disabled: b.getAttribute('aria-disabled') === 'true' }));
  // after the page's redraw (if it redraws at once) the tab is a new element: find it again by its id
  const pick = (bar: ShellEl, id: string | undefined): void => {
    onSelect(id);
    const b = [...(bar.isConnected ? bar : root).querySelectorAll('[role="tab"]')].find((x) => x.dataset.tab === id);
    if (b) b.focus();
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[role="tab"]');
    if (!b || !root.contains(b) || b.getAttribute('aria-disabled') === 'true') return;
    pick(b.closest('[role="tablist"]'), b.dataset.tab);
  });
  root.addEventListener('keydown', (e) => {
    const b = e.target.closest('[role="tab"]');
    if (!b || !root.contains(b)) return;
    const bar = b.closest('[role="tablist"]');
    const to = tabStep(tabsOf(bar), b.dataset.tab, e.key);
    if (to === null) return;
    e.preventDefault();
    pick(bar, to);
  });
}

// ---- the record table: one row per record, sortable headers, every row opens its record ----
export const shellCols = (cols: readonly DbCol[]): { label: string }[] => cols.map((c) => (typeof c === 'string' ? { label: c } : c));
export const shellCells = (r: DbRow): unknown[] => (Array.isArray(r) ? r : r.cells);
export const shellKey = (r: DbRow, i: number): string => { const k = Array.isArray(r) ? undefined : r.sort?.[i]; return k === undefined ? shellText(shellCells(r)[i]) : k === null ? '' : String(k); };
export const shellNum = (k: string): number | null => (/^\s*-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*$/i.test(k) ? Number(k) : null);
// a column whose keys are all numbers sorts as numbers (-2, 1.25, 1.5, 10); any other as text with its digit
// runs as numbers (kit-2 before kit-10). One rule per column, so the order never depends on the input's
export const shellText2 = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
// the rows in display order, as [index in rows as passed, row]: numeric-aware, stable
export function sortRows(rows: readonly DbRow[], sort?: DbSort | null): [number, DbRow][] {
  const out: [number, DbRow][] = rows.map((r, i) => [i, r]);
  if (!sort || sort.col === null || sort.col === undefined) return out;
  const dir = sort.dir === -1 ? -1 : 1;
  const keys = out.map(([, r]) => shellKey(r, sort.col));
  const nums = keys.every((k) => k === '' || shellNum(k) !== null) ? keys.map((k) => (k === '' ? -Infinity : shellNum(k))) : null;
  const cmp = nums ? (i: number, j: number): number => (nums[i] === nums[j] ? 0 : nums[i] < nums[j] ? -1 : 1) : (i: number, j: number): number => shellText2(keys[i], keys[j]);
  return out.sort((a, b) => cmp(a[0], b[0]) * dir || a[0] - b[0]);
}
export const nextSort = (sort: DbSort | null | undefined, col: number): DbSort => (sort && sort.col === col ? { col, dir: sort.dir === -1 ? 1 : -1 } : { col, dir: 1 });
export function dbTable(cols: readonly DbCol[], rows: readonly DbRow[], { sort = null }: { sort?: DbSort | null } = {}): string {
  const cs = shellCols(cols);
  const head = cs.map((c, i) => {
    const on = sort && sort.col === i;
    return `<th aria-sort="${on ? (sort.dir === -1 ? 'descending' : 'ascending') : 'none'}"><button type="button" class="sort" data-col="${i}">${escHtml(c.label)}${on ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}</button></th>`;
  }).join('');
  const body = rows.length
    ? sortRows(rows, sort).map(([i, r]) => `<tr class="click" data-row="${i}" tabindex="0">${shellCells(r).map((v) => `<td><div class="cell">${v}</div></td>`).join('')}</tr>`).join('')
    : `<tr class="none"><td colspan="${cs.length || 1}"><div class="cell">None</div></td></tr>`;
  return `<table class="db-t"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
export function bindDbTable(root: ShellRoot, { onSort, onOpen }: { onSort?: (col: number) => void; onOpen?: (row: number) => void }): void {
  root.addEventListener('click', (e) => {
    const s = e.target.closest('button.sort[data-col]');
    if (s && root.contains(s)) { if (onSort) onSort(Number(s.dataset.col)); return; }
    const tr = e.target.closest('tr[data-row]');
    // a link or button inside a row is its own; the row opens on any other click
    if (tr && root.contains(tr) && !e.target.closest('a, button, input, select, textarea, summary, label') && onOpen) onOpen(Number(tr.dataset.row));
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const tr = e.target.closest('tr[data-row]');
    if (!tr || !root.contains(tr) || e.target !== tr || !onOpen) return;
    e.preventDefault();
    onOpen(Number(tr.dataset.row));
  });
}

// ---- the properties table: [key, value HTML, tooltip?] ----
export const props = (rows: readonly PropRow[]): string => `<dl class="props">${rows.map(([k, v, tip]) => `<dt${tip ? ` title="${escHtml(tip)}" tabindex="0"` : ''}>${escHtml(k)}</dt><dd>${v ?? ''}</dd>`).join('')}</dl>`;

// ---- the step bar: Defining, Planning, Waiting on you, Built, Met; each word follows its state ----
export const GOAL_STEP_WORDS: readonly (readonly [string, string, string])[] = [['Defining', 'Defining', 'Defined'], ['Planning', 'Planning', 'Planned'], ['Approval', 'Waiting on you', 'Approved'], ['Built', 'Building', 'Built'], ['Met', 'Met?', 'Met']];
export function goalSteps({ step = 0, built = null, met = null }: GoalStepsOptions = {}): string {
  return `<ol class="steps" aria-label="Progress">${GOAL_STEP_WORDS.map((w, i) => {
    const cls = i < step ? 'done' : i === step ? 'now' : '';
    const part = i === 3 ? built : i === 4 ? met : null;
    const fill = part && i >= step && typeof part.frac === 'number' ? Math.max(0, Math.min(1, part.frac)) : null;
    const tip = part ? part.title || part.text || '' : '';
    return `<li class="${cls || (fill !== null ? 'part' : '')}"${fill !== null ? ` style="--fill:${Math.round(fill * 100)}%"` : ''}${tip ? ` title="${escHtml(tip)}"` : ''}>${w[cls === 'done' ? 2 : cls === 'now' ? 1 : 0]}${part && part.text ? `<span class="step-sub">${escHtml(part.text)}</span>` : ''}</li>`;
  }).join('')}</ol>`;
}
// ---- Upkeep's heartbeat: a cell a day, oldest first, today last; shade by items, red when failed ----
export function heartbeat(days: readonly HeartbeatDay[] = []): string {
  // the date as the day it names (Nov 2), whatever the viewer's locale or zone
  const label = (d: unknown): string => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(d ?? '')); return m && +m[1] >= 1 && +m[1] <= 12 ? `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[1] - 1]} ${+m[2]}` : String(d ?? ''); };
  const cells = days.map((d, i) => {
    const items = Array.isArray(d.items) ? d.items.map(String) : [];
    const cls = d.failed ? 'bad' : items.length ? `l${Math.min(4, items.length)}` : '';
    return `<i class="${cls}" title="${escHtml(`${label(d.day)}${i === days.length - 1 ? ' (today)' : ''}: ${items.length ? items.join(', ') : 'quiet'}`)}"></i>`;
  }).join('');
  return `<div class="heartbeat" role="img" aria-label="Upkeep, the last ${days.length} days" style="--hb-n:${days.length || 1}">${cells}</div><div class="hb-labels"><span>${escHtml(days.length ? label(days[0].day) : '')}</span><span>today</span></div>`;
}

// ---- a project's status pill: the hub's words and tone for each pulse state ----
export const PULSE_STATES: Record<string, PulseState> = {
  building: { label: 'Building', tone: 'green', rank: 3 },
  moving: { label: 'Moving', tone: 'blue', rank: 3 },
  blocked: { label: 'Fully blocked', tone: 'red', rank: 0 },
  waiting: { label: 'Waiting on you', tone: 'amber', rank: 1 },
  stalled: { label: 'Stalled', tone: 'red', rank: 0 },
  idle: { label: 'Idle', tone: '', rank: 4 },
  parked: { label: 'Parked', tone: '', rank: 4 },
  gone: { label: 'Not answering', tone: 'red', rank: 0 },
  starting: { label: 'Starting', tone: '', rank: 5 },
  unknown: { label: 'Running', tone: 'blue', rank: 3 },
};
export const statusPill = (state: string): string => { const s = PULSE_STATES[Object.hasOwn(PULSE_STATES, state) ? state : 'unknown']; return `<span class="pill${s.tone ? ` ${s.tone}` : ''}">${escHtml(s.label)}</span>`; };

// ---- the fleet switch: Run, Drain, Park (with a confirm), for a project, a hub row or the machine ----
export const FLEET_MODES: readonly (readonly [FleetMode, string, string])[] = [['run', 'Run', 'Workers start and continue tickets'], ['drain', 'Drain', 'Workers finish what they have; nothing new starts'], ['park', 'Park', 'Every session stops where it is']];
export function fleetSwitch({ scope = 'project', mode = 'run', counts = {}, confirming = false, busy = null, error = null }: FleetSwitchOptions = {}): string {
  const c = { running: 0, draining: 0, parked: 0, ...counts };
  // the machine's Park asks about the projects it would park: those not parked already
  const toPark = c.running + c.draining;
  const dot = { run: 'green', drain: 'amber', park: '', mixed: 'amber' }[mode] ?? '';
  const label = scope === 'row' ? '' : mode === 'mixed' ? `Mixed: ${c.running} running, ${c.draining} draining, ${c.parked} parked` : scope === 'machine' ? 'Every fleet' : 'Fleet';
  const btns = FLEET_MODES.map(([m, word, why]) => {
    const conf = m === 'park' && confirming;
    const text = conf ? (scope === 'machine' ? `Park ${toPark} project${toPark === 1 ? '' : 's'}?` : 'Confirm park') : word;
    return `<button type="button" data-fleet="${m}"${conf ? ' class="confirm" data-confirm="1"' : ''} title="${escHtml(why)}" aria-pressed="${mode === m}"${busy ? ' disabled' : ''}>${escHtml(text)}</button>`;
  }).join('');
  return `<div class="fleet-switch" data-scope="${escHtml(scope)}" data-mode="${escHtml(mode)}"${confirming ? ' data-confirming="1"' : ''}><span class="k"><span class="dot ${dot}"></span>${escHtml(label)}</span><span class="seg" role="group" aria-label="${scope === 'machine' ? 'Every fleet on this machine' : scope === 'row' ? 'This project' : 'The whole fleet'}: run, drain or park">${btns}</span>${busy ? `<span class="msg">${escHtml(busy)}</span>` : ''}${error ? `<span class="err">${escHtml(error)}</span>` : ''}</div>`;
}
export function bindFleetSwitch(root: ShellRoot, { onPress, onConfirm, onCancel }: { onPress?: (mode: string | undefined) => void; onConfirm?: (mode: string | undefined) => void; onCancel?: () => void }): void {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('.fleet-switch [data-fleet]');
    if (!b || !root.contains(b) || b.disabled) return;
    if (b.dataset.confirm === '1') { if (onConfirm) onConfirm(b.dataset.fleet); return; }
    if (onPress) onPress(b.dataset.fleet);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const sw = e.target.closest('.fleet-switch');
    if (!sw || !root.contains(sw) || sw.dataset.confirming !== '1') return;
    e.preventDefault();
    if (onCancel) onCancel();
  });
}

// ---- pages, and the Threads panel's tabs ----
export const SHELL_PAGES: ShellPage[] = [];
export function registerPage({ id, title, group, icon, count, render }: ShellPage): void {
  if (!/^[a-z][a-z0-9-]*$/.test(String(id))) throw new Error(`a page id is lower-case letters, digits and dashes: ${id}`);
  if (SHELL_PAGES.some((p) => p.id === id)) throw new Error(`page ${id} is registered already`);
  SHELL_PAGES.push({ id, title, group, icon, count, render });
}
export const shellPages = (): ShellPage[] => SHELL_PAGES.slice();
export const threadsTabs: ThreadsTabs = (() => {
  const tabs: ThreadsTab[] = [];
  return {
    register({ id, label, count, render, disabled = false }: ThreadsTab): void {
      if (tabs.some((t) => t.id === id)) throw new Error(`Threads tab ${id} is registered already`);
      tabs.push({ id, label, count, render, disabled });
    },
    list(): ThreadsTabItem[] {
      return tabs.map((t) => { let n = null; try { n = t.count ? t.count() : null; } catch { n = null; } return { id: t.id, label: t.label, count: n, disabled: !!t.disabled }; });
    },
    // one tab's pane: a tab whose render throws shows its error, and the panel keeps working
    render(id: string, el: { innerHTML: string }): boolean {
      const t = tabs.find((x) => x.id === id);
      if (!t || t.disabled || !t.render) { el.innerHTML = ''; return false; }
      try { t.render(el); return true; } catch (e) { el.innerHTML = `<p class="err">${escHtml(`${t.label} could not draw: ${e && e.message ? e.message : e}`)}</p>`; return false; }
    },
  };
})();

// ---- the URL (dashboard-shell@2): page heads (#<page>[?state], p the open peek or viewer) and link heads ----
export const STATE_KEYS: Record<string, readonly string[]> = { '*': ['th', 't', 'i', 'u', 'p'], board: ['goal', 'feat', 'repo', 'att'], progress: ['goal', 'narrow', 'show'], library: ['kind', 'goal'], goals: ['gt'], sensors: ['st'], loop: ['lt', 'kind', 'orient'] };
export const stateKeys = (page: string): string[] => [...(STATE_KEYS[page] || []), ...STATE_KEYS['*']];
// A peek's or a viewer's head without '#' (a p value, or a legacy head's), as the canonical head of that view, or
// null when it names none: its kind one of routes.peeks; a file by its query (path required); an artifact's
// version main, wt/<worktree> or tree/<40 or 64 hex> (anything else is main), its slug an artifact slug, its page
// kept only when the server can serve it (index.html is the default); a preview's route kept unless '/'. A query
// is read with URLSearchParams and written with it again, so a page or a route holding & = # round-trips.
export function peekHead(v: unknown, routes: ShellRoutes): string | null {
  const h = String(v ?? '');
  const q = h.indexOf('?');
  const path = q < 0 ? h : h.slice(0, q);
  const query = new URLSearchParams(q < 0 ? '' : h.slice(q + 1));
  const peeks = routes.peeks || [];
  if (path === 'file') {
    if (!peeks.includes('file') || !query.get('path')) return null;
    const view = query.get('view');
    query.delete('view');
    if (view === 'raw' || view === 'rendered') query.append('view', view);
    return `file?${query}`;
  }
  const s = path.indexOf('/');
  const kind = s < 0 ? path : path.slice(0, s), rest = s < 0 ? '' : path.slice(s + 1);
  if (!rest || !peeks.includes(kind) || kind === 'file') return null;
  if (kind === 'artifact') {
    const segs = rest.split('/'), slug = segs.pop();
    if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(slug)) return null;
    let at = 'main';
    if (segs.length === 2 && segs[0] === 'wt' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segs[1])) at = `wt/${segs[1]}`;
    if (segs.length === 2 && segs[0] === 'tree' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(segs[1])) at = `tree/${segs[1]}`;
    const page = query.get('path');
    const keep = page !== null && page !== 'index.html' && /^[A-Za-z0-9._/-]+$/.test(page) && page.split('/').every((x) => x && !x.startsWith('.'));
    return `artifact/${at}/${slug}${keep ? `?${new URLSearchParams({ path: page })}` : ''}`;
  }
  if (kind === 'preview') {
    if (rest.includes('/')) return null;
    const route = query.get('route');
    return `preview/${rest}${route && route !== '/' ? `?${new URLSearchParams({ route })}` : ''}`;
  }
  return h;
}
// routes (the page's own table, outside this block): { pages, peeks, links: { kind: home }, files: [[RegExp, home]], redirects: { head: head } }
export function parseHead(hash: unknown, routes: ShellRoutes): ParsedHead {
  let h = String(hash ?? '').replace(/^#/, '');
  let redirected = false;
  if (Object.hasOwn(routes.redirects || {}, h)) { h = String(routes.redirects[h]).replace(/^#/, ''); redirected = true; }
  const q = h.indexOf('?'), s = h.indexOf('/');
  const first = h.slice(0, Math.min(q < 0 ? h.length : q, s < 0 ? h.length : s));
  if (s >= 0 && (q < 0 || s < q) || first === 'file' || first === 'review-preview') {
    const kind = first;
    let home = Object.hasOwn(routes.links || {}, kind) ? routes.links[kind] : 'overview';
    if (kind === 'file') {
      let path = '';
      try { path = new URLSearchParams(h.slice(q + 1)).get('path') || ''; } catch { path = ''; }
      const hit = (routes.files || []).find(([re]) => re.test(path));
      home = hit ? hit[1] : 'library';
    }
    // a peek's or a viewer's link head is legacy: its home page with it as p (none when it names no view)
    if ((routes.peeks || []).includes(kind)) { const p = peekHead(h, routes); return { page: home, state: p ? { p } : {}, legacy: true }; }
    return { link: h, kind, home };
  }
  const page = (routes.pages || []).includes(first) ? first : 'overview';
  const got = new URLSearchParams(q < 0 ? '' : h.slice(q + 1));
  const state: HeadState = {};
  for (const k of stateKeys(page)) if (got.has(k)) state[k] = got.get(k);
  // i is a card in the Inbox tab: only with th=inbox; p only a view routes.peeks names, as its canonical head
  if (state.i !== undefined && state.th !== 'inbox') delete state.i;
  if (state.p !== undefined) { const p = peekHead(state.p, routes); if (p) state.p = p; else delete state.p; }
  return redirected ? { page, state, redirected } : { page, state };
}
export function headFor(p: HeadLike): string {
  if (p.link !== undefined) return `#${p.link}`;
  const qs = new URLSearchParams();
  for (const k of stateKeys(p.page)) if (p.state && p.state[k] !== undefined && p.state[k] !== null) qs.set(k, p.state[k]);
  const s = qs.toString();
  return `#${p.page}${s ? `?${s}` : ''}`;
}
// history.state for an entry: { page, depth, openedHere }, page the entry's head without p. entry = { hash, state },
// here = what was on screen (its stamp), cold = the visit's first route
export function stampFor(entry: { hash: unknown; state?: Stamp | null }, here: Stamp | null | undefined, cold: boolean, routes: ShellRoutes): Stamp {
  if (entry.state && typeof entry.state.page === 'string') return entry.state;
  const p = parseHead(entry.hash, routes);
  const link = p.link !== undefined || !!p.legacy;
  if (!link && p.state.p === undefined) return { page: headFor(p), depth: 0, openedHere: !cold };
  // a p head names its page; a link or a legacy head is over its kind's home on a cold load, else over what is on screen
  const page = link ? null : headFor({ page: p.page, state: { ...p.state, p: undefined } });
  if (cold || !here) return { page: page ?? headFor(parseHead(p.link !== undefined ? p.home : p.page, routes)), depth: 1, openedHere: false };
  if (page !== null && page !== here.page) return { page, depth: 1, openedHere: false };
  // from a peek: every entry down to the page was pushed in this visit only if the peek below's were
  if (here.depth > 0) return { page: here.page, depth: here.depth + 1, openedHere: !!here.openedHere };
  return { page: here.page, depth: 1, openedHere: true };
}
// a change to Threads (th, t) while a peek stays open: the same entry, its page head updated (replaceState)
export const withPage = <T extends object>(state: T, page: string): T & { page: string } => ({ ...state, page });
// closing a peek: back to the page under it, by history when this visit pushed the entries, else in place
export const closeTarget = (state: Stamp | null | undefined): { go: number } | { replace: string } => (state && state.openedHere && state.depth > 0 ? { go: -state.depth } : { replace: (state && state.page) || '#overview' });
// remembered filters: a page's own keys, applied only to a fresh entry whose head carries none of them and no p
export const REMEMBERED: Record<string, readonly string[]> = { board: ['goal', 'feat', 'repo', 'att'], progress: ['goal'], library: ['goal', 'kind'] };
// stored as one flat object ({ goal, feat, repo, att, kind }), so the goal is shared by the pages that remember it
export const FILTERS_KEY: string = 'devteam.board.filters';
export function storedFilters(): Record<string, unknown> | null { try { return JSON.parse(localStorage.getItem(FILTERS_KEY) || '{}') || {}; } catch { return null; } }
export function rememberedFilters(page: string, keys: readonly string[] | null | undefined, fresh: boolean, stored: Record<string, unknown> | null = storedFilters()): Record<string, string> | null {
  const own = REMEMBERED[page] || [];
  if (!fresh || !own.length || !stored || typeof stored !== 'object') return null;
  // a head that names one of the page's filters (an empty value too) or a peek says what it shows
  if ((keys || []).some((k) => own.includes(k) || k === 'p')) return null;
  const out: Record<string, string> = {};
  for (const k of own) if (typeof stored[k] === 'string' && stored[k]) out[k] = stored[k];
  return Object.keys(out).length ? out : null;
}
export function saveFilters(page: string, state: Record<string, unknown> | null | undefined): void {
  const own = REMEMBERED[page] || [];
  if (!own.length) return;
  try {
    const cur = storedFilters() || {};
    for (const k of own) { if (state && state[k]) cur[k] = String(state[k]); else delete cur[k]; }
    localStorage.setItem(FILTERS_KEY, JSON.stringify(cur));
  } catch {}
}
/* devteam-shell-js end */
