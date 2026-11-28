// kit-994: bootAutonomy(), the four statements index.html ran at load among autonomy's lines, in its order (the
// resize redraw, the suggestion's click and Enter, the Sensors tab bar). AutonomyClient's effect runs it once.
import { SHELL_ROUTES } from '../../lib/shell-routes';
import { bindTabBar, headFor, parseHead } from '../shell';
import { $ } from '../shell/page';
import { shell } from '../shell/state';
import { threadsPanelState } from '../threads-panel/state';
import { effSuggGo, fitCharts } from './efficiency';
import { renderMonitoring } from './sensors';
import { autonomyState } from './state';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


export function bootAutonomy() {
  addEventListener('resize', () => requestAnimationFrame(fitCharts));
  document.addEventListener('click', (e: Loose) => {
    const it = e.target.closest?.('#efficiency [data-sugg], #awareness [data-sugg]');
    if (!it || e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || threadsPanelState.TL.pin) return;
    if (String(window.getSelection?.() ?? '')) return;
    e.preventDefault();
    effSuggGo(it, e.clientX, e.clientY);
  });
  document.addEventListener('keydown', (e: Loose) => {
    const t = e.target;
    // Space presses a focused card that is a button (a Board ticket or planner card), as a <button> would
    const space = e.key === ' ' && !!t?.matches?.('[data-open][role="button"][tabindex]');
    if ((e.key !== 'Enter' && !space) || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || threadsPanelState.TL.pin) return;
    // a focused suggestion starts its thread; a focused row with a record (data-open, focusable) opens it
    if (t?.matches?.('#efficiency [data-sugg], #awareness [data-sugg]')) { e.preventDefault(); const r = t.getBoundingClientRect(); effSuggGo(t, r.right, r.top + 10); return; }
    if (t?.matches?.('[data-open][tabindex]')) { e.preventDefault(); location.hash = t.dataset.open; }
  });
  // ---- Sensors (kit-93): Production (the incidents board, a card a sensor) and Fleet (Health's tables) ----
  // SENSOR_TAB: the tab shown, from the head's st (showHead): fleet, else production
  // Selecting a tab is a new entry (#sensors, #sensors?st=fleet), so Back restores the tab before; drawn at once,
  // so the focus moves to the new tab's element
  bindTabBar(($('monitoring') as Loose), { onSelect: (id: Loose) => {
    if (!['production', 'fleet'].includes(id)) return;
    const cur = parseHead(location.hash, SHELL_ROUTES);
    const state = cur.link === undefined && !cur.legacy && cur.page === 'sensors' ? { ...cur.state } : {};
    if (id === 'fleet') state.st = 'fleet'; else delete state.st;
    autonomyState.SENSOR_TAB = id;
    if (shell.DATA) renderMonitoring(shell.DATA);
    location.hash = headFor({ page: 'sensors', state });
  } });
}
