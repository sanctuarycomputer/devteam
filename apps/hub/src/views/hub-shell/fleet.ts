// kit-1008: Run, Drain and Park from the Overview (hub.html 1077-1148). The hub can't post an owner
// action: it asks the project's own dashboard, in its frame, which posts it as a click there would
// (index.html, "The hub's Overview"). The answer comes back by message from that frame alone, and
// whether a message is that answer is the lib's (C1-C4); nothing else is listened to.
import { hubShellState as hs } from './state';
import { _paintOverview } from './others';
import { frameFor, frameRefused } from './panes';
import { draw } from './boot';
import { nonceOf } from '../../lib/hub-shell-box';
import { takeFleetDone, type FleetAnswer, type FleetWait } from '../../lib/hub-shell-frames';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

const fleetWait = new Map<string, FleetWait>(); // nonce -> { resolve, origin, win }
// boot step 3, second
export function installFleet() {
  window.addEventListener('message', (ev) => { takeFleetDone(ev, fleetWait); });
}
export async function fleetAsk(it: Loose, mode: string, all = false): Promise<FleetAnswer> {
  const { urlOf } = hs;
  // a project with no address has no dashboard to ask: said at once, and no frame made
  const none = () => (urlOf(it.x) ? null : { ok: false, error: `${it.x.name} has no address on this box: ${urlOf.words[urlOf.why(it.x) as string][0]}` });
  if (none()) return none() as FleetAnswer;
  // nor has one this page's policy refused: a new frame would only be refused again
  const unknown = { ok: false, error: 'the hub doesn\'t know this project yet; reload this page in a moment' };
  if (it.refused) return unknown;
  const root = it.x.root;
  let wake: () => void = () => {};
  const refused = new Promise<FleetAnswer>((r) => { wake = () => r(unknown); });
  frameRefused.wake.set(root, wake);
  // a frame made only to ask is dropped once it has answered, unless its tab was chosen meanwhile:
  // a dashboard reads its data every 10 s for as long as it is open, seen or not
  const made = !it.frame;
  const frame = frameFor(it);
  let done = false;
  let again: ReturnType<typeof setInterval> | undefined;
  let nonce: string | null = null;
  const ask = async (): Promise<FleetAnswer> => {
    await Promise.race([it.loaded, new Promise((r) => setTimeout(r, 15000))]);
    if (done) return unknown;
    // a draw in the wait can have made the name shared
    if (none()) return none() as FleetAnswer;
    const origin = new URL(urlOf(it.x) as string).origin;
    nonce = nonceOf(crypto.getRandomValues(new Uint8Array(12)));
    const n = nonce;
    const answer = new Promise<FleetAnswer>((resolve) => fleetWait.set(n, { resolve, origin, win: frame.contentWindow }));
    // asked again until it answers (a dashboard still starting its script); it does it once per nonce
    const send = () => { try { frame.contentWindow.postMessage({ devteam: 'hub-fleet', mode, nonce: n, all }, origin); } catch {} };
    send();
    again = setInterval(send, 1500);
    return Promise.race([answer, new Promise<FleetAnswer>((r_) => setTimeout(() => r_({ ok: false, error: 'its dashboard didn\'t answer (an older kit can\'t be parked from here)' }), 20000))]);
  };
  try {
    // refused, before or after its load: the error at once, whatever is selected
    return await Promise.race([refused, ask()]);
  } finally {
    done = true;
    clearInterval(again);
    if (nonce) fleetWait.delete(nonce);
    if (frameRefused.wake.get(root) === wake) frameRefused.wake.delete(root);
    if (made && it.frame === frame && hs.selected !== it.x.root) { frame.remove(); it.frame = null; it.loaded = null; }
  }
}
export async function setFleet(roots: string[], mode: string) {
  const words: Record<string, string> = { park: 'Parking…', drain: 'Draining…', run: 'Resuming…' };
  for (const r of roots) hs.fleetBusy.set(r, { asking: words[mode] });
  _paintOverview();
  await Promise.all(roots.map(async (r) => {
    const it = hs.items.get(r);
    const res = it ? await fleetAsk(it, mode, roots.length > 1) : { ok: false, error: 'gone' };
    if (res.ok) { hs.fleetBusy.delete(r); hs.fleetSet.set(r, { mode, until: Date.now() + 30000 }); } else hs.fleetBusy.set(r, { error: res.error ?? 'it didn\'t work' });
  }));
  await draw();
  _paintOverview();
}
