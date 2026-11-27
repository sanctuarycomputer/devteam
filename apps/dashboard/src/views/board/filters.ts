// kit-993: the header filters of the Board and Progress (index.html's board lines): what they offer, read and write.
import { SHELL_ROUTES } from '../../lib/shell-routes';
import { STATE_KEYS } from '../../shared/shell/shell';
import { dataState } from '../data/state';
import { renderLibrary } from '../library';
import { libraryState } from '../library/state';
import { renderLoop } from '../loop';
import { loopState } from '../loop/state';
import { focusBack, focusMark } from '../peeks';
import { esc, headFor, parseHead, rememberedFilters, saveFilters, storedFilters, withPage } from '../shell';
import { shell } from '../shell/state';
import { cap, featureTitle } from '../words';
import { renderBoard } from './cards';
import { filterTickets, goalFeatures, renderProgress, views } from './progress';
import { boardState } from './state';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


export const NARROW_GROUPS = ['Milestones', 'Features', 'Releases', 'Waves', 'Stories'];
// the goals a filter can name: every goal not let go, by title
export const filterGoals = () => ((shell.DATA as Loose)?.ooda?.goals || []).filter((g: Loose) => g.status !== 'abandoned').sort((a: Loose, b: Loose) => String(a.title ?? a.id).localeCompare(String(b.title ?? b.id)));
// Narrow's views: today's views() less Everything and the goals; with a goal, the goal's own milestones and the
// features, releases, waves and stories of the goal's tickets
export function narrowViews(p: Loose, goal: Loose) {
  const own = (vs: Loose) => vs.filter(([, , g]: Loose) => NARROW_GROUPS.includes(g));
  if (!goal) return own(views(p));
  const ts = filterTickets(p, `goal:${goal}`);
  const sub = { ...p, tickets: ts, features: p.features.filter((f: Loose) => ts.some((t: Loose) => t.feature === f)), stories: Object.fromEntries(Object.entries(p.stories).filter(([id]: Loose) => ts.some((t: Loose) => t.serves.includes(id)))) };
  return own(views(sub)).filter(([k, , g]: Loose) => g !== 'Milestones' || k.startsWith(`milestone:${goal}:`));
}
// The page head in force: the hash's, or under a link (a peek) the head in its stamp.
export function pageHeadNow() {
  const h = parseHead(location.hash, SHELL_ROUTES);
  return h.link === undefined && !h.legacy ? h : parseHead(typeof history.state?.page === 'string' ? history.state.page : '#overview', SHELL_ROUTES);
}
// A page's filters as the head in force has them (none when another page shows), with a goal naming no goal
// a filter can pick, a Narrow outside the goal's views and a Show that isn't one dropped: the controls then show
// All goals, Every view, Active, and nothing is filtered by them.
export function filtersNow(page: Loose) {
  const h = pageHeadNow();
  const f = {};
  if ((h as Loose).page === page) for (const k of STATE_KEYS[page] || []) if ((h as Loose).state[k]) (f as Loose)[k] = (h as Loose).state[k];
  if ((f as Loose).goal && !filterGoals().some((g: Loose) => g.id === (f as Loose).goal)) delete (f as Loose).goal;
  if ((f as Loose).att && (f as Loose).att !== '1') delete (f as Loose).att; // the toggle writes att=1; any other value is no filter
  if (page === 'progress') {
    if ((f as Loose).narrow && !(shell.DATA && narrowViews((shell.DATA as Loose).progress, (f as Loose).goal).some(([k]: Loose) => k === (f as Loose).narrow))) delete (f as Loose).narrow;
    if ((f as Loose).show && !['complete', 'all'].includes((f as Loose).show)) delete (f as Loose).show;
  }
  if (page === 'library' && (f as Loose).kind && !libraryState.LIB_KINDS.some(([k]: Loose) => k === (f as Loose).kind)) delete (f as Loose).kind;
  // Self Improvement: its tab (lt) kept; Kind and Needs orienting are Orient's only, a kind naming none dropped
  if (page === 'loop') {
    if ((f as Loose).lt !== 'orient') { delete (f as Loose).kind; delete (f as Loose).orient; }
    if ((f as Loose).kind && !loopState.ORIENT_KINDS.includes((f as Loose).kind)) delete (f as Loose).kind;
    if ((f as Loose).orient && (f as Loose).orient !== '1') delete (f as Loose).orient;
  }
  return f;
}
// A filter changed: the new state (a goal changed clears the feature and the narrow, which were the old goal's),
// remembered (the shell's saveFilters: each page its own keys; a goal changed on Progress or Library also drops the
// Board's stored feature, so a later Board visit isn't emptied by it), then a new entry with the new head.
export function setFilters(page: Loose, patch: Loose) {
  const h = pageHeadNow();
  const state = { ...filtersNow(page) };
  for (const k of STATE_KEYS['*']) if ((h as Loose).page === page && (h as Loose).state[k] !== undefined) (state as Loose)[k] = (h as Loose).state[k];
  const goalChanged = Object.hasOwn(patch, 'goal') && (patch.goal || undefined) !== (state as Loose).goal;
  for (const [k, v] of Object.entries(patch)) { if (v) (state as Loose)[k] = String(v); else delete (state as Loose)[k]; }
  if (goalChanged) { delete (state as Loose).feat; delete (state as Loose).narrow; }
  saveFilters(page, state);
  if ((page === 'progress' || page === 'library') && goalChanged) saveFilters('board', { ...(storedFilters() || {}), goal: (state as Loose).goal, feat: undefined });
  location.hash = headFor({ page, state });
}
// The page's filters drawn into the page bar's .extra; emptied on every other page. Written only when they
// change: every read draws them, and a control replaced under a press would lose the press.
export function drawFilters(page: Loose) {
  const el = document.querySelector('.pagebar .extra');
  if (!el) return;
  const html = filtersHtml(page);
  if ((el as Loose).dataset.drawn !== html) { el.innerHTML = html; (el as Loose).dataset.drawn = html; }
}
export function filtersHtml(page: Loose) {
  if (!shell.DATA || !boardState.FILTER_PAGES.includes(page)) return '';
  const f = filtersNow(page);
  const opt = (v: Loose, label: Loose, cur: Loose) => `<option value="${esc(v)}"${(cur || '') === v ? ' selected' : ''}>${esc(label)}</option>`;
  const sel = (k: Loose, label: Loose, inner: Loose) => `<select data-f="${k}" aria-label="${label}">${inner}</select>`;
  const toggle = (attr: Loose, on: Loose, icon: Loose, label: Loose) => `<button type="button" class="ghost" ${attr} aria-pressed="${on ? 'true' : 'false'}"><i class="icon-${icon}" aria-hidden="true"></i>${label}</button>`;
  // Self Improvement: on Orient its Kind and Needs orienting (in the URL); on Decide its two toggles (page memory)
  if (page === 'loop') {
    if ((f as Loose).lt === 'orient') return sel('kind', 'Kind', opt('', 'Every kind', (f as Loose).kind) + loopState.ORIENT_KINDS.map((k: Loose) => opt(k, cap(k), (f as Loose).kind)).join('')) + toggle('data-f="orient"', (f as Loose).orient, 'compass', 'Needs orienting');
    if ((f as Loose).lt === 'decide') return toggle('data-dec="corrected"', loopState.LOOP_DEC.corrected, 'rotate-ccw', 'Only corrected') + toggle('data-dec="routine"', loopState.LOOP_DEC.routine, 'repeat', 'Include routine acts');
    return '';
  }
  const goal = sel('goal', 'Goal', opt('', 'All goals', (f as Loose).goal) + filterGoals().map((g: Loose) => opt(g.id, g.title || g.id, (f as Loose).goal)).join(''));
  if (page === 'library') return goal + sel('kind', 'Kind', opt('', 'All kinds', (f as Loose).kind) + libraryState.LIB_KINDS.map(([k, label]: Loose) => opt(k, label, (f as Loose).kind)).join(''));
  if (page === 'board') {
    const p = (shell.DATA as Loose).progress;
    const gf = (f as Loose).goal ? goalFeatures((f as Loose).goal) : null;
    // the features of the goal's tickets and planners (every one with no goal); a feature named outside them (a
    // hand-made URL) is still offered, so the select shows what filters the cards
    const feats = [...new Set([...p.tickets.filter((t: Loose) => !gf || gf.has(t.feature)), ...((shell.DATA as Loose).planners || []).filter((x: Loose) => !(f as Loose).goal || (x.goals || []).includes((f as Loose).goal))].map((x: Loose) => x.feature).filter(Boolean))];
    if ((f as Loose).feat && !feats.includes((f as Loose).feat)) feats.push((f as Loose).feat);
    const repos = [...new Set(['home', ...p.tickets.map((t: Loose) => t.repo).filter(Boolean)])];
    if ((f as Loose).repo && !repos.includes((f as Loose).repo)) repos.push((f as Loose).repo);
    return goal
      + sel('feat', 'Feature', opt('', 'All features', (f as Loose).feat) + feats.map((x: Loose) => opt(x, featureTitle(x), (f as Loose).feat)).join(''))
      + sel('repo', 'Repo', opt('', 'All repos', (f as Loose).repo) + repos.map((r: Loose) => opt(r, r, (f as Loose).repo)).join(''))
      + `<button type="button" class="ghost" data-f="att" aria-label="Needs attention" aria-pressed="${(f as Loose).att ? 'true' : 'false'}"><i class="icon-circle-alert" aria-hidden="true"></i>Needs attention</button>`;
  }
  const vs = narrowViews((shell.DATA as Loose).progress, (f as Loose).goal);
  const narrow = opt('', 'Every view', (f as Loose).narrow) + NARROW_GROUPS.map((g: Loose) => { const xs = vs.filter((v: Loose) => v[2] === g); return xs.length ? `<optgroup label="${esc(g)}">${xs.map(([k, label]: Loose) => opt(k, label, (f as Loose).narrow)).join('')}</optgroup>` : ''; }).join('');
  return goal + sel('narrow', 'Narrow', narrow) + sel('show', 'Show', opt('', 'Active', (f as Loose).show) + opt('complete', 'Complete', (f as Loose).show) + opt('all', 'Everything', (f as Loose).show));
}
// The page shown drawn again for its filters (a filter change, Back, Forward): at once, not at the next read,
// focus kept on the control it was on.
export function drawFilterPage(page: Loose) {
  if (!shell.DATA || !boardState.FILTER_PAGES.includes(page)) return void drawFilters(page);
  const m = focusMark();
  drawFilters(page);
  if (page === 'board') renderBoard(); else if (page === 'library') renderLibrary((shell.DATA as Loose).library); else if (page === 'loop') renderLoop(); else renderProgress();
  focusBack(m);
}
// Board and Progress on a route (in routeHead, once the entry is stamped): a fresh entry whose head has none of
// the page's remembered keys gets them written into its hash (the shell's rememberedFilters), and a head that isn't
// its canonical self (a key of no page, or another page's: #progress?feat=x) is replaced by it; in place, the
// stamp's page head with it, so a peek opened over it closes back to the filtered head.
export function filterHead(fresh: Loose) {
  let p = parseHead(location.hash, SHELL_ROUTES);
  if (p.link !== undefined || p.legacy || p.redirected || !boardState.FILTER_PAGES.includes(p.page)) return;
  const r = fresh ? rememberedFilters(p.page, Object.keys(p.state), true) : null;
  if (r) p = { page: p.page, state: { ...p.state, ...r } };
  const head = headFor(p);
  if (location.hash === head) return;
  history.replaceState(withPage(history.state, head), '', head);
  dataState.HERE = history.state;
}
