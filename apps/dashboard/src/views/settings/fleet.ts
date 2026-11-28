// kit-995: the fleet switch's posts and reads (index.html's settings lines): FLEET_PRESSED, fleetRefocus, postFleet, loadFleet.
import { drawOrHold, press, redrawNow, render } from '../data';
import { dataState } from '../data/state';
import { drawFleet } from '../goals';
import { goalsState } from '../goals/state';
import { shell } from '../shell/state';
import { drawSettings } from './page';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


// One fleet op through press(): the overlay shows the mode at once, the busy line holds the switch
// while the request is out, and a refusal shows in the switch with the mode the data's again.
// the button a press came from (its slot and data-fleet), to give focus back once the press ends:
// the switch's buttons are disabled while it is out, so focus falls to the page
export let FLEET_PRESSED: Loose = null;
export function fleetRefocus() {
  const at = FLEET_PRESSED;
  FLEET_PRESSED = null;
  if (!at || !at.slot?.isConnected) return;
  const ae = document.activeElement;
  if (ae && ae !== document.body && !at.slot.contains(ae)) return; // the owner has moved on
  at.slot.querySelector(`[data-fleet="${CSS.escape(at.fleet)}"]`)?.focus({ preventScroll: true });
}
export function postFleet(op: Loose) {
  const fleetNow = ({ drain: { mode: 'drain' }, park: { mode: 'park' }, resume: { mode: null, op: null } } as Loose)[op];
  if (!fleetNow) return;
  const ae = document.activeElement, slot = ae?.closest?.('[data-fleet-slot]');
  FLEET_PRESSED = slot && (ae as Loose)!.dataset.fleet ? { slot, fleet: (ae as Loose)!.dataset.fleet } : null;
  Object.assign(goalsState.FLEET_UI, { confirming: false, busy: ({ drain: 'asking the fleet to drain…', park: 'asking the fleet to park…', resume: 'asking the fleet to run…' } as Loose)[op], error: null });
  press('fleet', {
    build: () => ({ action: 'fleet', body: { op } }),
    overlay: { data: (d: Loose) => ({ ...d, fleet: { ...(d.fleet || {}), ...fleetNow, reason: fleetNow.mode ? d.fleet?.reason ?? null : null } }), agrees: (raw: Loose) => (raw.fleet?.mode ?? null) === (fleetNow.mode ?? null) },
    apply: () => { goalsState.FLEET = { ...goalsState.FLEET, data: null, at: 0 }; redrawNow(); drawFleet(); },
    onOk: () => { goalsState.FLEET_UI.busy = null; drawFleet(); fleetRefocus(); loadFleet(); },
    // drawn here with the buttons enabled, so focus can go back; press redraws after
    onError: (error: Loose) => { Object.assign(goalsState.FLEET_UI, { busy: null, error: `Not saved: ${error}` }); drawFleet(); fleetRefocus(); },
    errId: 'fleet',
  });
}
// A check (fetchToo: fetch from origin and check again) is a POST, since a fetch moves refs and no
// GET changes anything (kit-251). One refused (403: a view session may not POST, or a guard said no)
// reads instead, so the card still shows, and says it wasn't checked. One asked for while a read is
// out is kept in FLEET.wantFetch and runs once that read ends, so arriving on Settings always checks again.
// A check that failed otherwise (502: origin unreachable; 500) with nothing drawn yet reads too, so the card
// still has its blockers under the error (kit-341); over an answer already drawn, that answer stays, marked old.
export async function loadFleet(fetchToo: Loose = false) {
  if (goalsState.FLEET.busy) { if (fetchToo) (goalsState.FLEET as Loose).wantFetch = true; return; }
  goalsState.FLEET.busy = true;
  drawSettings(); // Check now disabled while the read is out
  const PLAIN = ' What shows is a plain read, not checked against origin.';
  try {
    let r = await (fetchToo ? fetch('/api/fleet-check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }) : fetch('/api/fleet'));
    // refused: a plain read instead, said to be one
    let refused: Loose = null;
    if (fetchToo && r.status === 403) { const e = (await r.json().catch(() => ({})))?.error; refused = typeof e === 'string' && e.trim() ? e.trim() : "This session can't run a check"; r = await fetch('/api/fleet'); }
    if (r.ok) goalsState.FLEET = { ...goalsState.FLEET, data: await r.json(), at: Date.now(), error: refused ? `${refused.replace(/\.$/, '')}.${PLAIN}` : null } as Loose;
    else {
      const j = await r.json().catch(() => ({}));
      const error = String(j.error ?? `HTTP ${r.status}`);
      // a read that fails (an answer, a throw, a body that isn't JSON) leaves the check's error alone
      const plain = fetchToo && !refused && !goalsState.FLEET.data ? await fetch('/api/fleet').then((p: Loose) => (p.ok ? p.json() : null)).catch(() => null) : null;
      if (plain) goalsState.FLEET = { ...goalsState.FLEET, data: plain, at: Date.now(), error: `${error.replace(/\.?$/, '.')}${PLAIN}` } as Loose;
      else (goalsState.FLEET as Loose).error = error;
    }
  } catch (e) { (goalsState.FLEET as Loose).error = String((e as Loose)?.message ?? e); }
  const wasReady = !!(goalsState.FLEET as Loose).prevReady;
  goalsState.FLEET.busy = false;
  (goalsState.FLEET as Loose).prevReady = !!goalsState.FLEET.data?.ready;
  drawFleet();
  drawSettings();
  // the goal cards say parking or parked by the fleet's readiness: redraw them when it changes
  if (shell.DATA && wasReady !== (goalsState.FLEET as Loose).prevReady && typeof render === 'function') drawOrHold(dataState.HELD ?? dataState.RAW);
  if ((goalsState.FLEET as Loose).wantFetch) { (goalsState.FLEET as Loose).wantFetch = false; loadFleet(true); }
}
