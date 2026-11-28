// kit-991: overview's hello-pulse block of index.html (/api/hello, the Status row's time and the Commit history
// mosaic), as index.html has it, with types. No imports and no DOM at import: compiled to
// lib-dist/lib/overview-hello.js (a lib module that imports code fails on Node from lib-dist/). What the block uses
// from outside it comes through wireHello(), which src/views/overview/wire.ts calls once with the real objects: the
// shell's page state (each rewritten name is `shell.X`), overview's state (`overviewState.HELLO`), and the three
// functions of other views (renderOverview, renderLibrary, esc). The page globals the block calls (fetch,
// AbortSignal, Intl, Date) are the global ones unless a wire gives its own, as a test's node:vm context did.
// `Loose` is `any`: /api/hello's answer has no fixed shape in index.html.
type Loose = any;
type Fn = (...a: Loose[]) => Loose;

const SEAMS = ['renderOverview', 'renderLibrary', 'esc'] as const;
export type HelloWire = {
  shell: { DATA: Loose; PAGE_NOW?: Loose };
  overviewState: { HELLO: Loose };
  fetch: Fn;
  AbortSignal: Loose;
  Intl: Loose;
  Date: Loose;
} & { [k in (typeof SEAMS)[number]]: Fn };

let shell: HelloWire['shell'] = { DATA: null, PAGE_NOW: undefined };
let overviewState: HelloWire['overviewState'] = { HELLO: null };
const wired: { [k: string]: Fn } = {};
// the page globals the block calls, the real ones until a wire gives its own; fetch is looked up at call time, as
// the page's bare `fetch` is, so a page that wraps window.fetch after load is still heard
let fetch: Fn = (...a) => (globalThis.fetch as Fn)(...a);
let AbortSignal: Loose = globalThis.AbortSignal;
let Intl: Loose = globalThis.Intl;
let Date: Loose = globalThis.Date;

// Each key given replaces that one seam, state object or global; a key left out keeps what it had.
export function wireHello(w: Partial<HelloWire>): void {
  if (w.shell) shell = w.shell;
  if (w.overviewState) overviewState = w.overviewState;
  if (typeof w.fetch === 'function') fetch = w.fetch;
  if (w.AbortSignal) AbortSignal = w.AbortSignal;
  if (w.Intl) Intl = w.Intl;
  if (w.Date) Date = w.Date;
  for (const k of SEAMS) if (typeof w[k] === 'function') wired[k] = w[k];
}
const need = (n: string): Fn => {
  const f = wired[n];
  if (typeof f !== 'function') throw new Error(`overview-hello: ${n} is not wired`);
  return f;
};
const renderOverview = (...a: Loose[]) => need('renderOverview')(...a);
const renderLibrary = (...a: Loose[]) => need('renderLibrary')(...a);
const esc = (...a: Loose[]) => need('esc')(...a);

/* hello-pulse start */
// /api/hello, as the hub reads it (pulse: state, last_activity, activity): asked on load and with each
// redraw; a failed ask leaves none, so the pill says unknown (spec §1) and the mosaic is empty.
// Asks can overlap (each poll, each loadNow): only the latest ask's answer is applied, and Overview is
// redrawn only when the answer changed (render draws it on each poll anyway).
let HELLO_SEQ = 0, HELLO_JSON = 'null';
export async function helloLoad() {
  const seq = ++HELLO_SEQ;
  let h = null;
  try {
    const r = await fetch('/api/hello', { signal: AbortSignal.timeout(10000) });
    if (r.ok) h = await r.json();
  } catch {}
  if (seq !== HELLO_SEQ) return;
  h = h && typeof h === 'object' ? h : null;
  const json = JSON.stringify(h);
  if (json === HELLO_JSON) return;
  // who this dashboard is decides the Library's links, so a change of name or port redraws it
  const moved = overviewState.HELLO?.name !== h?.name || overviewState.HELLO?.port !== h?.port;
  overviewState.HELLO = h;
  HELLO_JSON = json;
  if (shell.DATA) renderOverview();
  if (shell.DATA && moved && typeof shell.PAGE_NOW !== 'undefined' && shell.PAGE_NOW === 'library') renderLibrary(shell.DATA.library);
}
// "2 min ago", as the hub says it
export function ovAgo(iso: Loose) {
  const t = Date.parse(iso ?? '');
  if (!(t > 0)) return 'never';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
}
export const BUGS_MERGED_TIP = 'A production error traced to a merged change, or one you reported. Shown once the project has a production sensor.';
export const AUTONOMY_SCORE_TIP = 'The mean of the Trust, Efficiency and Awareness Scores, weighted equally; – until all three exist';
// Commit history: hello's commits a day, oldest first, as a column a week and a row a day. One day
// formatter, made on first use; the mosaic is kept while the activity and the day are the same.
let OV_DAY_FMT: Loose = null, OV_MOSAIC = { key: null as Loose, html: '' };
export function ovMosaic(activity: Loose) {
  const xs = Array.isArray(activity) ? activity.map((x) => (Number.isFinite(x) && x > 0 ? x : 0)) : [];
  const key = `${new Date().toDateString()}|${JSON.stringify(xs)}`;
  if (OV_MOSAIC.key === key) return OV_MOSAIC.html;
  OV_DAY_FMT ??= new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  const max = Math.max(0, ...xs), n = xs.length;
  const cells = xs.map((x, i) => {
    const day = OV_DAY_FMT.format(new Date(Date.now() - (n - 1 - i) * 864e5));
    return `<i${x ? ` class="l${Math.max(1, Math.ceil((4 * x) / max))}"` : ''} title="${esc(`${day}: ${x} commit${x === 1 ? '' : 's'}`)}"></i>`;
  }).join('');
  const html = `<div class="mosaic" role="img" aria-label="Commits a day, the last ${Math.ceil(n / 7)} weeks" style="grid-template-columns:repeat(${Math.max(1, Math.ceil(n / 7))}, minmax(0, 1fr))">${cells}</div>`;
  OV_MOSAIC = { key, html };
  return html;
}
/* hello-pulse end */
