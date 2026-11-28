// kit-989: the hub's fleet ask (index.html:12880-12898): the hub's frame asks this dashboard to park, drain or
// resume its fleet; origin, parent and nonce checked as index.html checks them.
import { later } from '../../lib/data-later';
import { loadFleet } from '../settings';
import { viewer } from '../shell/state';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A5). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


export function installHubFleet() {
  if (!viewer() && window.parent === window.top) {
    const HUB_OPS = { park: 'park', drain: 'drain', run: 'resume' };
    const seen = new Set();
    window.addEventListener('message', async (ev: Loose) => {
      if (window.parent === window || ev.source !== window.parent || ev.origin === location.origin || ev.origin === 'null') return;
      const m = ev.data;
      if (!m || typeof m !== 'object' || m.devteam !== 'hub-fleet' || !Object.hasOwn(HUB_OPS, m.mode) || typeof m.nonce !== 'string' || !/^[a-z0-9]{8,40}$/.test(m.nonce)) return;
      const reply = (o: Loose) => { try { ev.source.postMessage({ devteam: 'hub-fleet-done', nonce: m.nonce, ...o }, ev.origin); } catch {} };
      if (seen.has(m.nonce)) return;
      seen.add(m.nonce);
      try {
        const r = await fetch('/api/fleet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: (HUB_OPS as Loose)[m.mode], ...(m.mode === 'run' ? {} : { reason: m.all ? `${m.mode === 'park' ? 'parked' : 'drained'} with every project, from the hub's Overview` : `${m.mode === 'park' ? 'parked' : 'drained'} from the hub's Overview` }) }) });
        const j = await r.json().catch(() => ({}));
        // "nothing to resume" is the fleet already running: what was asked for holds
        if (r.ok || (m.mode === 'run' && /nothing to resume/.test(String(j.error ?? '')))) { reply({ ok: true }); if (typeof loadFleet === 'function') later(loadFleet); }
        else reply({ ok: false, error: String(j.error ?? `the dashboard answered ${r.status}`).slice(0, 300) });
      } catch (e) { reply({ ok: false, error: String((e as Loose)?.message ?? e).slice(0, 300) }); }
    });
  }
}
