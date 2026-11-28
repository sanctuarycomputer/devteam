// kit-992: the fleet switch's page side (index.html's goals lines): its mode, its state line, the what-is-left box
// and drawFleet, which writes every fleet slot on the page. FLEET, FLEET_UI and FLEET_DRAWN are goals's state
// (goalsState.<name>); the switch's markup is the shell's fleetSwitch. The box's listeners are bootGoals()'s (./order).
import { fleetSwitch, esc } from '../shell';
import { shell } from '../shell/state';
import { goalsState } from './state';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it).
type Loose = any;

// the switch's mode is the fleet's: run unless a fleet op holds it
export const fleetMode = (f: Loose) => (f?.mode === 'park' ? 'park' : f?.mode === 'drain' ? 'drain' : 'run');
// the state line under the switch: parked or drained only once fleet status says the move is ready;
// until then it is a transition
export function fleetStateLine(f: Loose, st: Loose) {
  f = f || {};
  const settled = !!(st && st.ready);
  const words = f.mode === 'park' ? (settled ? 'parked' : 'parking…') : f.mode === 'drain' ? (settled ? 'drained' : 'draining…') : f.op ? 'partly held (a goal was set apart after the fleet op)' : 'running';
  // not ready yet: what is left (fleet status's blockers, each up to its first parenthesis) rides on
  // the line's hover, so a park that stalls says on what without growing the line (it sits under the
  // switch, which must not move)
  // (from the last good answer only: after a failed check it would be old). It takes focus (Tab, or a
  // tap on a phone) and shows on focus too, and screen readers hear it in its label.
  const left = (f.mode === 'park' || f.mode === 'drain') && !settled && !(goalsState.FLEET as Loose).error && st && Array.isArray(st.blockers) && st.blockers.length ? st.blockers : null;
  const leftWords = left ? `Left before the move: ${left.map((b: Loose) => String(b).split(/ \(|: run /)[0].slice(0, 120)).join('; ')}` : '';
  const tip = left ? ` class="fleet-left" tabindex="0" title="${esc(leftWords)}" aria-label="${esc(`${words}. ${leftWords}`)}"` : '';
  return `<b${tip}>${esc(words)}</b>${f.reason ? ` · ${esc(f.reason)}` : ''}`;
}
// Every fleet slot on the page: the sidebar's ([data-fleet-slot="switch"] and "state"), and any other
// page's copies with the same attribute. A slot is written only when its HTML changed (against the last
// string written to it: innerHTML comes back re-serialised, as disabled="" or ' for &#39;), so focus,
// a pending confirm and a click in progress stay; a rewrite keeps focus on the same button (the confirm is Park's), since
// the binder's Escape needs focus inside the switch.
// The fleet line's what-is-left for a keyboard or a tap: a box on the body, kept inside the window,
// below the word or above it when there's no room.
export function fleetLeftPlace() {
  const el = (document.activeElement as Loose)?.closest?.('.fleet-left');
  let pop = document.getElementById('fleet-left-pop');
  if (!el) { if (pop) pop.hidden = true; return; }
  if (!pop) { pop = document.createElement('div'); pop.id = 'fleet-left-pop'; pop.setAttribute('role', 'tooltip'); document.body.appendChild(pop); }
  pop.textContent = el.title;
  pop.hidden = false;
  const at = el.getBoundingClientRect(), box = pop.getBoundingClientRect(), W = document.documentElement.clientWidth, H = window.innerHeight;
  pop.style.left = `${Math.max(8, Math.min(at.left, W - box.width - 8))}px`;
  // under the switch too, when the word sits beside it (the phone's strip)
  const sw = el.closest('#side-state') ? document.getElementById('side-fleet')?.getBoundingClientRect() : null;
  const below = Math.max(at.bottom, sw?.bottom ?? 0) + 6;
  pop.style.top = `${below + box.height <= H - 8 ? below : Math.max(8, at.top - 6 - box.height)}px`;
}
export function drawFleet() {
  const f = (shell.DATA as Loose)?.fleet || {};
  const html: Loose = {
    switch: fleetSwitch({ scope: 'project', mode: fleetMode(f), confirming: goalsState.FLEET_UI.confirming, busy: goalsState.FLEET_UI.busy, error: goalsState.FLEET_UI.error }),
    state: fleetStateLine(f, goalsState.FLEET.data),
  };
  for (const el of document.querySelectorAll('[data-fleet-slot]') as Loose) {
    const want = html[el.dataset.fleetSlot];
    if (want === undefined || goalsState.FLEET_DRAWN.get(el) === want) continue;
    const ae = document.activeElement as Loose;
    const had = ae && el.contains(ae) ? ae.dataset.fleet : null;
    const hadLeft = !!(ae && el.contains(ae) && ae.classList.contains('fleet-left'));
    el.innerHTML = want;
    goalsState.FLEET_DRAWN.set(el, want);
    if (hadLeft) el.querySelector('.fleet-left')?.focus({ preventScroll: true });
    if (had) el.querySelector(`[data-fleet="${CSS.escape(had)}"]`)?.focus({ preventScroll: true });
  }
  fleetLeftPlace();
}
