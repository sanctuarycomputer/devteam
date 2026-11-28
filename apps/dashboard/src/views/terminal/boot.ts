// kit-1006: bootTerminal(), the statement index.html's term-js runs at load, as it has it, which TerminalClient's
// effect runs once: the token, the listeners (visibility, the hub's frame messages, resize, the colour scheme).
import { TERM_IDS } from '../../lib/terminal-defs';
import { viewer } from '../shell/state';
import { TERM, termPaint, termSync, termTab, termTheme, termToken } from './term';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


export function bootTerminal() {
  if (!viewer()) {
    termToken();
    document.addEventListener('visibilitychange', () => termSync());
    // the hub's word that this frame is hidden or shown (dashboard-shell@3; kit-616 sends it), taken only when every
    // guard holds, in @3's order: from the parent; from the origin of the hub-base the page accepted (none yet: ignored);
    // devteam 'hub-visible'; a boolean visible. The hub-base's origin is kept here by @3's own rule for a hub-base:
    // from the parent, an origin not the page's and not 'null', a base that is an http(s) URL of at most 2,048
    // characters with no user name or password.
    window.addEventListener('message', (ev: Loose) => {
      if (ev.source !== window.parent || window.parent === window) return;
      const m = ev.data;
      if (m && typeof m === 'object' && m.devteam === 'hub-base') {
        if (ev.origin === location.origin || ev.origin === 'null' || typeof m.base !== 'string' || m.base.length > 2048) return;
        let u: Loose = null;
        try { u = new URL(m.base); } catch {}
        if (u && /^https?:$/.test(u.protocol) && !u.username && !u.password) TERM.hubOrigin = ev.origin;
        return;
      }
      if (!TERM.hubOrigin || ev.origin !== TERM.hubOrigin) return;
      if (!m || typeof m !== 'object' || m.devteam !== 'hub-visible' || typeof m.visible !== 'boolean') return;
      TERM.hubHidden = !m.visible;
      termSync();
    });
    addEventListener('resize', () => { for (const w of TERM_IDS) if (termTab(w).term) termPaint(w); });
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { for (const w of TERM_IDS) if (termTab(w).term) termTab(w).term.options.theme = termTheme(); });
  }
}
