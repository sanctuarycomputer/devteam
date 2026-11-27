// kit-989: data's router (index.html:8014-8158's routing): a head to its page, peek and tab; the drawer and the review.
import { later } from '../../lib/data-later';
import { SHELL_ROUTES } from '../../lib/shell-routes';
import { loadGovernance, openClass, openSensor, renderGovernance, renderMonitoring } from '../autonomy';
import { autonomyState } from '../autonomy/state';
import { drawFilterPage, filterHead } from '../board';
import { renderGoals } from '../goals';
import { goalsState } from '../goals/state';
import { openLib } from '../library';
import { openAct, openBuiltin, openDecision, openFeature, openFile, openGoal, openJob, openLearning, openLesson, openMilestone, openObservation, openPlanner, openProblem, openQuestion, openRelease, openRetro, openSignal, openStory, openThread, openTicket, openWave } from '../peek-kinds';
import { peekHide } from '../peeks';
import { peeksState } from '../peeks/state';
import { closeReview, openReview } from '../review';
import { reviewState } from '../review/state';
import { headFor, parseHead, showPage, stampFor } from '../shell';
import { $ } from '../shell/page';
import { shell } from '../shell/state';
import { tlPins } from '../thread';
import { thCarry, thFreshness, thRemember, thRoute, tlLeave, tlRoute } from '../threads-panel';
import { threadsPanelState } from '../threads-panel/state';
import { closeArtifact, openArtifact, openPreview } from '../viewer';
import { viewerState } from '../viewer/state';
import { render } from './render';
import { dataState } from './state';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A5). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


export let ROUTE_COLD = true;

// Go to a head: a new entry (assigned; hashchange routes it), or this entry replaced by it with a fresh stamp, then routed.
export function goHead(head: Loose, { replace = false }: Loose = {}) {
  if (!replace) { location.hash = head; return; }
  history.replaceState(stampFor({ hash: head, state: null }, dataState.HERE, ROUTE_COLD, SHELL_ROUTES), '', head);
  route();
}

export function showHead(p: Loose, opts: Loose) {
  showPage(p.page, opts);
  if (p.page === 'loop') { showTab(dataState.LOOP_TABS.includes(p.state?.lt) ? p.state.lt : 'observe'); tlPins(); }
  if (p.page === 'goals') { goalsState.GOALS_TAB = goalsState.GOALS_TABS.includes(p.state?.gt) ? p.state.gt : 'active'; renderGoals(); }
  // Governance (kit-93): its listing read on arriving (unless read in the last minute), drawn meanwhile
  if (p.page === 'governance') { renderGovernance(); later(loadGovernance); }
  // Sensors (kit-93): its tab from the head's st (fleet; none is Production), drawn again on every head change
  if (p.page === 'sensors') { autonomyState.SENSOR_TAB = p.state?.st === 'fleet' ? 'fleet' : 'production'; if (shell.DATA) renderMonitoring(shell.DATA); }
  drawFilterPage(p.page);
}

// A new entry (a hash assigned, a link followed) is stamped at once: the page under it, its depth, and
// whether this visit pushed every entry down to that page; HERE becomes the entry on screen.
export function stampEntry() {
  if (!history.state || typeof history.state.page !== 'string') history.replaceState(stampFor({ hash: location.hash, state: history.state }, dataState.HERE, ROUTE_COLD, SHELL_ROUTES), '');
  ROUTE_COLD = false;
  dataState.HERE = history.state;
}

// Every route draws the Threads panel from the page head in force after the rest (thRoute), whichever way it went
// (kit-89 spec §2.5): freshness read before the entry is stamped; once stamped (in routeHead, before any link is
// opened, so a talk/ route reads the head with them) a peek closed carries its page's th and t, and on a fresh entry
// the remembered panel is applied; then the panel decided, drawn and remembered. A route run inside routeHead (a
// redirect's stamped replace) has done all of it already.
export let ROUTE_N = 0;

// LAST_HEAD: the last head routed that isn't the viewer's own (kit-141), what a viewer routed next is opened over
export let LAST_HEAD: Loose = null;

export function route() {
  viewerState.AV_FRAME_ESC = false;
  thFreshness();
  const fresh = !!dataState.TH_FRESH && dataState.TH_FRESH.hash === location.hash && dataState.TH_FRESH.fresh;
  dataState.TH_FRESH = null;
  const carry = dataState.TH_CARRY;
  dataState.TH_CARRY = null;
  const n = ++ROUTE_N;
  routeHead({ fresh, carry });
  if (n !== ROUTE_N) return;
  thRoute();
  // the head a viewer opened next is over, as it stands once routed (after a redirect's or the panel's replace)
  if (!/^#(artifact|preview)\//.test(location.hash)) LAST_HEAD = location.hash;
}

export function routeHead({ fresh = false, carry = null }: Loose = {}) {
  stampEntry();
  if (carry) thCarry(carry);
  if (fresh) thRemember();
  filterHead(fresh);
  const raw = location.hash.slice(1);
  const p = parseHead(location.hash, SHELL_ROUTES);
  // leaving a talk/ entry (a route to any other head) closes the card it opened
  if (threadsPanelState.TL.route && raw !== `talk/${encodeURIComponent(threadsPanelState.TL.route)}` && raw !== `talk/${threadsPanelState.TL.route}`) tlLeave();
  // a link opens over the page in its stamp: the one it was clicked on, or on a cold load its kind's home
  if (p.link !== undefined || (p as Loose).legacy) (showHead as Loose)(parseHead(dataState.HERE.page, SHELL_ROUTES));
  // before anything that hides the drawer, the scrim or a review: the viewer opens over them
  // (a viewer opening takes the head it is over, and counts the frame's moves from none)
  if (raw.startsWith('preview/')) { if (!viewerState.AV) { viewerState.AV_RET = dataState.ROUTED ? LAST_HEAD : null; viewerState.AV_NAVS = 0; viewerState.AV_FRAME_ESC = false; } later(openPreview, raw.slice(8)); dataState.ROUTED = true; return; }
  if (raw.startsWith('artifact/')) { if (!viewerState.AV) { viewerState.AV_RET = dataState.ROUTED ? LAST_HEAD : null; viewerState.AV_NAVS = 0; viewerState.AV_FRAME_ESC = false; } openArtifact(raw); dataState.ROUTED = true; return; }
  closeArtifact();
  if (raw.startsWith('review/') || raw.startsWith('review-preview')) { if (!reviewState.RV) RV_FROM = dataState.ROUTED ? raw : null; dataState.ROUTED = true; return void later(openReview, raw); }
  dataState.ROUTED = true; RV_FROM = null;
  // back from a review: the Inbox cards redraw, so a card's progress pill is the one the review just reported
  if (closeReview() && shell.DATA) render(shell.DATA);
  const h = decodeURIComponent(raw);
  const k = h.startsWith('file?') ? 'file' : h.split('/')[0];
  if ((peeksState.TYPE_META as Loose)[k] && h.includes('/') || k === 'file') peeksState.DRAWER = { kind: k, id: null };
  if (h.startsWith('ticket/')) return void later(openTicket, h.slice(7));
  if (h.startsWith('q/')) return void openQuestion(h.slice(2));
  if (h.startsWith('goal/')) return void openGoal(h.slice(5));
  if (h.startsWith('planner/')) return void openPlanner(h.slice(8));
  // a thread: its card, beside its subject (#thread/ is a message's thread, in the sidepeek)
  // over nothing: a drawer it was followed from (or open under it) closes, as for any other link
  // (at once: the card replaces the peek, with no slide)
  // (its own head first: a card on a framed page opens the viewer before this route ends)
  if (h.startsWith('talk/')) { hideDrawer(); peekHide({ now: true }); LAST_HEAD = location.hash; return void later(tlRoute, h.slice(5)); }
  const PEEKS = { feature: openFeature, story: openStory, release: openRelease, wave: openWave, milestone: openMilestone, act: openAct, decision: openDecision, retro: openRetro, lesson: openLesson, problem: openProblem, thread: openThread, sensor: openSensor, observation: openObservation, signal: openSignal, learning: openLearning, lib: openLib, class: openClass, recurring: openJob, builtin: openBuiltin };
  const [kind, ...rest] = h.split('/');
  if ((PEEKS as Loose)[kind] && rest.length) return void (PEEKS as Loose)[kind](rest.join('/'));
  if (h.startsWith('file?')) return void openFile(new URLSearchParams(location.hash.slice(6)));
  hideDrawer();
  // a page head: its page; an unknown or empty head, or a redirect, is replaced in place (#overview, #monitoring → #sensors)
  if (p.link !== undefined || (p as Loose).legacy) return;
  if ((p as Loose).redirected || raw.split('?')[0] !== (p as Loose).page) history.replaceState(history.state, '', headFor(p));
  (showHead as Loose)(p);
}

// The drawer hidden, as when the route moves on (closeDrawer also closes its entry): it slides out
export function hideDrawer() { if (!$('drawer')!.hidden) { peekHide(); peeksState.DRAWER = { kind: null, id: null }; peeksState.LAST_HTML = ''; } }

// a review opened from the dashboard closes back to it; one opened from a link goes to the Inbox
export let RV_FROM: Loose = null;

export function leaveReview() { if (RV_FROM !== null) history.back(); else location.hash = '#overview?th=inbox'; }

export function showTab(tab: Loose) {
  dataState.TAB = tab;
  document.querySelectorAll('#loop-tabs [data-tab]').forEach((b: Loose) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  document.querySelectorAll('.loop-panel').forEach((p: Loose) => { p.hidden = p.dataset.panel !== tab; });
}

export const loopTab = (tab: Loose) => goHead(tab && tab !== 'observe' ? `#loop?lt=${tab}` : '#loop');
