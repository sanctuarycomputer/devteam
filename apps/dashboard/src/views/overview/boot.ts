// kit-991: overview's statements that index.html runs at load, in its order: the header filters' two listeners on
// the page bar's .extra (index.html's kit-91 lines) and pull to refresh (kit-759). bootOverview() runs them once,
// from OverviewClient's effect, once the shell's markup is in the DOM. pullRefresh is window.pullRefresh, which
// test/pull-refresh.test.mjs reads in the page (COMPAT's scan missed it): a value, so client.tsx defines it as a
// getter over this module's binding (src/shared/compat.ts), not through expose().
import { drawFilterPage, setFilters } from '../board';
import { boardState } from '../board/state';
import { load } from '../data';
import { loopState } from '../loop/state';
import { shell, viewer } from '../shell/state';
// `Loose` is `any`: index.html's events and values have no declared types. A cast `(x as Loose)` is a type only
// (SWC strips it).
type Loose = any;

// pull to refresh's handle once bootOverview() has run: null in a viewer tab, as index.html's const is
export let pull: { state: () => string } | null = null;

export function bootOverview() {
  // the header filters (kit-91): a select's pick, or the Needs attention toggle, through setFilters
  document.querySelector('.pagebar .extra')!.addEventListener('change', (e: Loose) => {
    const k = e.target?.dataset?.f;
    if (k && boardState.FILTER_PAGES.includes(shell.PAGE_NOW as Loose)) setFilters(shell.PAGE_NOW, { [k]: e.target.value });
  });
  document.querySelector('.pagebar .extra')!.addEventListener('click', (e: Loose) => {
    const b = e.target.closest?.('button[data-f="att"]');
    if (b && shell.PAGE_NOW === 'board') setFilters('board', { att: b.getAttribute('aria-pressed') === 'true' ? '' : '1' });
    // Self Improvement: Orient's Needs orienting in the URL; Decide's two toggles in page memory, drawn again at once
    const o = e.target.closest?.('button[data-f="orient"]');
    if (o && shell.PAGE_NOW === 'loop') setFilters('loop', { orient: o.getAttribute('aria-pressed') === 'true' ? '' : '1' });
    const d = e.target.closest?.('button[data-dec]');
    if (d && shell.PAGE_NOW === 'loop' && Object.hasOwn(loopState.LOOP_DEC, d.dataset.dec)) { (loopState.LOOP_DEC as Loose)[d.dataset.dec] = !(loopState.LOOP_DEC as Loose)[d.dataset.dec]; drawFilterPage('loop'); }
  });

  // Pull to refresh on a touch screen (kit-759), as iOS does it: at the very top of the page a finger
  // dragged down brings a spinner down after it, slower than the finger and slower still the further it
  // goes; let go once the finger has come PULL_AT px, the page reads its data again at once
  // (load({ force: true }), no reload) and the spinner spins until the read lands, then slides back up.
  // Let go short of that, it goes back and nothing is read. Touch events only, so never a mouse; and it
  // never starts with the page scrolled, on a text field or a canvas, inside a box that scrolls or a
  // layer fixed over the page (a panel, a drawer, the viewer), or while a pull's refresh is still going.
  // A frame (an artifact, a preview, a terminal) has its own document and never reaches this one. It
  // sits over the page and moves nothing on it. With reduced motion it keeps still where it stops, and
  // spins at the kit's slow pace. Not in a viewer tab, which has no dashboard to read.
  const pullRefresh = viewer() ? null : (() => {
    const PULL_AT = 70;   // the finger's travel that refreshes on release
    const MAX = 120;      // what the spinner's travel tends to and never passes
    const REST = 56;      // where it spins
    const SIZE = 32;
    const travel = (dy: Loose) => MAX * (1 - Math.exp(-Math.max(0, dy) / 160));
    const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    const el = document.createElement('div');
    el.id = 'pull-refresh';
    el.hidden = true;
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = `position: fixed; top: 0; left: 50%; z-index: 60; width: ${SIZE}px; height: ${SIZE}px; margin-left: ${-SIZE / 2}px; box-sizing: border-box; border-radius: 50%; background: var(--surface); border: 1px solid var(--line-2); box-shadow: 0 2px 8px rgba(0, 0, 0, .12); pointer-events: none; will-change: transform;`;
    const ring = document.createElement('div');
    ring.style.cssText = 'position: absolute; inset: 7px; border-radius: 50%; border: 2px solid var(--fg-2); border-right-color: transparent;';
    el.append(ring);
    document.body.append(el);
    // idle, pulling (a finger down and moving it), refreshing (a read in flight), going (on its way back);
    // at: how far the finger has come down
    let state = 'idle', y0 = 0, x0 = 0, armed = false, at = 0;
    // eased over the page's --dur, which reduced motion makes 0 ms (the page's own rule): no slide, no fade
    const place = (y: Loose, { ease = false } = {}) => {
      el.style.transition = ease ? 'transform var(--dur) var(--ease), opacity var(--dur) var(--ease)' : 'none';
      el.style.transform = `translateY(${Math.round((still() ? REST : y) - SIZE)}px)`;
    };
    // the finger dy px down: the spinner travel(dy), its fade and its ring's turn how far to the threshold
    const show = (dy: Loose) => {
      at = dy;
      el.hidden = false;
      place(travel(dy));
      const k = Math.min(1, Math.max(0, dy) / PULL_AT);
      el.style.opacity = String(k);
      ring.style.transform = `rotate(${Math.round(k * 270)}deg)`;
    };
    const away = () => {
      state = 'going';
      el.classList.remove('spinning');
      ring.style.animation = '';
      place(0, { ease: true });
      el.style.opacity = '0';
      // reduced motion: no slide to wait for, so hidden in this same task (a timer can land frames late)
      if (still()) { el.hidden = true; state = 'idle'; return; }
      // its transition's end, or a bound if it never comes
      const done = () => { clearTimeout(bound); el.removeEventListener('transitionend', done); el.hidden = true; state = 'idle'; };
      const bound = setTimeout(done, 600);
      el.addEventListener('transitionend', done);
    };
    // what refuses a pull from where the finger is: a control that takes the touch, or a box between it
    // and the page that scrolls or is fixed over it
    const refused = (t: Loose) => {
      if (!(t instanceof Element)) return true;
      if (t.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), canvas')) return true;
      for (let e: Loose = t; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.position === 'fixed') return true;
        if (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight) return true;
      }
      return false;
    };
    const top = () => (document.scrollingElement?.scrollTop ?? scrollY) <= 0;
    let hold: Loose = null; // the listeners on the touched element, for this touch
    document.addEventListener('touchstart', (e: Loose) => {
      hold?.abort();
      armed = false;
      // a second finger landing mid-pull cancels it
      if (state === 'pulling') return away();
      if (state !== 'idle' || e.touches.length !== 1 || !top() || refused(e.target)) return;
      armed = true;
      y0 = e.touches[0].clientY;
      x0 = e.touches[0].clientX;
      // a redraw can take the touched element out of the page, and its touch events then stop reaching
      // document: hear them on the element too (move and release are safe to run twice for one event)
      hold = new AbortController();
      e.target.addEventListener('touchmove', move, { passive: false, signal: hold.signal });
      e.target.addEventListener('touchend', release, { passive: true, signal: hold.signal });
      e.target.addEventListener('touchcancel', release, { passive: true, signal: hold.signal });
    }, { passive: true });
    const move = (e: Loose) => {
      if (!armed) return;
      const dy = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
      if (state === 'idle') {
        // a pull is down, more than across, from the top: anything else is the page's own gesture
        if (dy <= 0 || Math.abs(dx) > dy) { armed = false; return; }
        state = 'pulling';
      }
      if (e.cancelable) e.preventDefault();
      show(dy);
    };
    document.addEventListener('touchmove', move, { passive: false });
    const release = async (e: Loose) => {
      hold?.abort();
      if (!armed) return;
      armed = false;
      if (state === 'idle') return;
      if (e.type === 'touchcancel' || at < PULL_AT) return away();
      state = 'refreshing';
      place(REST, { ease: true });
      el.style.opacity = '1';
      el.classList.add('spinning');
      ring.style.animation = `spin ${still() ? '2.5s' : '.7s'} linear infinite`;
      try { await load({ force: true }); } catch (err) { console.error(err); } finally { away(); }
    };
    document.addEventListener('touchend', release, { passive: true });
    document.addEventListener('touchcancel', release, { passive: true });
    return { state: () => state };
  })();
  pull = pullRefresh;
}
