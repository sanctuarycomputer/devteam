// kit-1006: the Supervisor and Shell tabs (index.html's term-js lines): the page's terminal state (TERM), the token,
// the library, the tab's box, the poll, the screen, Shell's open, the keys and paste, the hint line and Wide.
import { TERM_BODY_MAX, TERM_DATA_MAX, TERM_IDS, TERM_LIB, TERM_MS, TERM_WHY_WORDS, TERM_WIDE_KEY, termPageId } from '../../lib/terminal-defs';
import { termBytes, termHex, termSafe, termText } from '../../lib/terminal-screen';
import { termWords } from '../../lib/terminal-words';
import { pageHello } from '../library';
import { esc } from '../shell';
import { $ } from '../shell/page';
import { viewer } from '../shell/state';
import { thDraw } from '../threads-panel';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


// termPaint's hostHere is the page's global, read when termPaint runs, as index.html's bare call finds it: a test
// replaces window.hostHere and reads what termPaint draws (dashboard-terminal-tabs, A13; ruling ask 1, Q3). Library's
// port registers the global (expose); until then the call fails as a stub's does.
const hostHere = (...a: Loose[]) => (window as Loose).hostHere(...a);

export const TERM = { token: null, why: null, pending: !viewer(), asked: 0, page: termPageId(), hubHidden: false, hubOrigin: null, lib: null, shown: null, tabs: {} };
// One tab's state: the last screen and its etag, the poll's interval and timer, the posts (seq, the one in flight,
// the queue), whether this page's own last taken post left the owner's line open (own: 'open' | 'done' | null), the
// last error, whether its box is on screen (seen), and Shell's open (opened: posted once; live: was ever live).
export function termTab(w: Loose) {
  return ((TERM.tabs as Loose)[w] ??= { box: null, term: null, screen: null, etag: null, every: TERM_MS.every, timer: null, reading: false, seq: 0, inflight: false, queue: [], own: null, err: '', seen: false, opened: false, live: false, opening: false, ask: null });
}
// Off: while the token is asked (so a View person never sees them), and on a View person's refusal (why view); the
// /view/ tab asks nothing and keeps them disabled (registered so).
export const termTabsOff = () => TERM.pending || TERM.why === 'view';
// The token, asked once on load (before any tab is pressed): a cross-site answer is asked once more; a second, or
// any other why, stops the asking. why view hides both tabs at once.
export async function termToken() {
  for (;;) {
    TERM.asked++;
    let r: Loose = null, j: Loose = null;
    try { r = await fetch('/api/term/token', { cache: 'no-store' }); j = await r.json().catch(() => null); } catch { r = null; }
    if (r?.ok && typeof j?.token === 'string') { TERM.token = j.token; TERM.why = null; break; }
    const why = r?.status === 403 && typeof j?.why === 'string' ? j.why : null;
    if (why === 'cross-site' && TERM.asked < 2) continue;
    TERM.why = why ?? 'error';
    break;
  }
  TERM.pending = false;
  thDraw();
  termRedraw();
}
// xterm.js and its CSS, once, on the first open: integrity-checked from jsdelivr. A failure (offline, blocked, a bad
// hash) is remembered: the tabs show the plain screen with typing off.
export function termLib() {
  if (TERM.lib) return TERM.lib;
  TERM.lib = (new Promise((ok: Loose, no: Loose) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = TERM_LIB.css; css.integrity = TERM_LIB.cssSri; css.crossOrigin = 'anonymous';
    document.head.append(css);
    const s = document.createElement('script');
    s.src = TERM_LIB.js; s.integrity = TERM_LIB.jsSri; s.crossOrigin = 'anonymous';
    s.onload = () => (typeof (globalThis as Loose).Terminal === 'function' ? ok((globalThis as Loose).Terminal) : no(new Error('no Terminal')));
    s.onerror = () => no(new Error('the terminal library did not load'));
    document.head.append(s);
  }) as Loose);
  (TERM.lib! as Loose).catch(() => {});
  return TERM.lib;
}
// The tab's pane: its one box, made once and moved into the pane on every draw, so xterm keeps its screen.
export function termRender(w: Loose, el: Loose) {
  const s = termTab(w);
  if (!s.box) {
    s.box = document.createElement('div');
    s.box.className = 'term-box';
    s.box.dataset.term = w;
    s.box.innerHTML = `<div class="term-bar"><span class="where">${w === 'supervisor' ? "The supervisor's terminal" : "Shell at the project's root"}</span><span class="live off" data-term-live><i class="dot" aria-hidden="true"></i><span></span></span></div><div class="term-state" hidden></div><div class="term-wrap"><div class="term-screen"></div><pre class="term-plain" hidden></pre></div><div class="term-ask" hidden role="group" aria-label="Paste"></div><div class="term-hint small muted" aria-live="polite"></div>`;
    s.box.addEventListener('click', (e: Loose) => termClick(w, e));
    new IntersectionObserver((es: Loose) => { for (const e of es) s.seen = e.isIntersecting; termSync(); }).observe(s.box);
  }
  el.replaceChildren(s.box);
  termPaint(w);
}
// Live: polled, typed into. Only the shown tab, only while the page is visible, its box on screen, and the hub hasn't
// said its frame is hidden; never without a token or with the tabs refused.
export const termLive = (w: Loose) => !viewer() && TERM.shown === w && document.visibilityState === 'visible' && termTab(w).seen && !TERM.hubHidden && !!TERM.token;
// Which tab is shown (thDraw's, null for none): the + hidden and Wide shown on a terminal tab, the shown tab's poll
// started, every other one stopped.
export function termSync(shown: Loose = TERM.shown) {
  if (viewer()) return;
  TERM.shown = shown;
  const root = document.documentElement;
  root.classList.toggle('th-term', !!shown);
  root.classList.toggle('th-wide', !!shown && termWide());
  termWideButton();
  for (const w of TERM_IDS) {
    const s = termTab(w);
    if (!termLive(w)) { clearTimeout(s.timer); s.timer = null; continue; }
    if (w === 'shell' && !s.opened) { termOpen(); continue; }
    if (!s.timer && !s.reading) termRead(w);
  }
}
export function termSchedule(w: Loose) {
  const s = termTab(w);
  clearTimeout(s.timer);
  s.timer = termLive(w) ? setTimeout(() => { s.timer = null; termRead(w); }, s.screen?.state === 'gone' ? TERM_MS.gone : s.every) : null;
}
// One read of the screen: If-None-Match with the last etag (the gateway forces no-store, so the page keeps the
// screen itself); a 304 keeps it. A read over 300 ms doubles the interval up to 2 s; a fast one brings it back.
export async function termRead(w: Loose) {
  const s = termTab(w);
  // a refused shell/open has no shell to read: it waits for Try again
  if (s.reading || !termLive(w) || s.openErr) return;
  s.reading = true;
  const opens = s.opens ?? 0;
  const t0 = performance.now();
  let r: Loose = null;
  try { r = await fetch(`/api/term/${w}/screen`, { cache: 'no-store', headers: s.etag ? { 'if-none-match': `"${s.etag}"` } : {} }); } catch { r = null; }
  const took = performance.now() - t0;
  let j: Loose = null;
  if (r && r.status !== 304) j = await r.json().catch(() => null);
  s.reading = false;
  // a read started before the latest shell/open is of the shell before it (an ended one's gone): dropped
  if ((s.opens ?? 0) !== opens) return void termSchedule(w);
  // a read that failed counts as slow, so a dashboard that is down is asked less often, not every 150 ms
  const failed = !r || (r.status !== 304 && !(r.ok && j?.v === 1));
  s.every = took > TERM_MS.slow || failed ? Math.min(TERM_MS.most, Math.max(TERM_MS.slow, s.every * 2)) : TERM_MS.every;
  if (r?.status === 403 && typeof j?.why === 'string') { TERM.why = j.why; TERM.token = null; thDraw(); return void termRedraw(); }
  // a read's own words, kept apart from a post's refusal: the next good read takes them away
  const was = s.readErr;
  s.readErr = !failed ? null : !r ? "The dashboard didn't answer; trying again." : "The screen couldn't be read just now; trying again.";
  if (r?.ok && j?.v === 1) termScreen(w, j);
  else if (s.readErr !== was) termHint(w);
  // a key post refused while this read was out (the pane moved): this answer may be from before, so read again now
  if (s.again) { s.again = false; s.etag = null; return void termRead(w); }
  termSchedule(w);
}
// A screen in hand (a read's, or a post's answer): kept with its etag and drawn. Shell's first live screen marks it
// live; a gone one after that is a shell that ended.
export function termScreen(w: Loose, j: Loose) {
  const s = termTab(w);
  if (j.state === 'live') s.live = true;
  // the numbers written into xterm are whole numbers in range, whatever the answer held; a gone screen's 0 by 0
  // (terminal@1 §6) keeps the 80 by 24 a new xterm starts at
  const n = (v: Loose, lo: Loose, hi: Loose, d: Loose) => (Number.isInteger(v) && v >= lo ? Math.min(hi, v) : d);
  const cols = n(j.cols, 1, 2000, 80), rows = n(j.rows, 1, 1000, 24);
  j = { ...j, cols, rows, lines: Array.isArray(j.lines) ? j.lines.filter((l: Loose) => typeof l === 'string').slice(0, rows) : [],
    cursor: { x: n(j.cursor?.x, 0, cols - 1, 0), y: n(j.cursor?.y, 0, rows - 1, 0), visible: j.cursor?.visible === true } };
  s.screen = j;
  s.etag = typeof j.etag === 'string' ? j.etag : null;
  termPaint(w);
}
// Shell's open: posted once per page (and again from Open a new shell), with the panel's size at the largest font.
export async function termOpen() {
  const s = termTab('shell');
  if (s.opening || !TERM.token) return;
  s.opening = true; s.opened = true; s.openErr = ''; s.opens = (s.opens ?? 0) + 1;
  const { cols, rows } = termFitSize(s);
  let r: Loose = null, j: Loose = null;
  try { r = await fetch('/api/term/shell/open', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ which: 'shell', page: TERM.page, token: TERM.token, cols, rows }) }); j = await r.json().catch(() => null); } catch { r = null; }
  s.opening = false;
  // a refused open stays refused (its words, Try again) and reads nothing: there is no shell to read
  if (r?.ok && j?.v === 1) { s.live = false; termScreen('shell', j); termSchedule('shell'); }
  else { s.openErr = r?.status === 409 ? "The shell couldn't be opened: this project has no tmux session." : termWords(r, j); termPaint('shell'); }
}
// The panel's size in cells at 12 px (the shell is made to fit it): terminal@1 §9's bounds.
export function termFitSize(s: Loose) {
  const wrap = s.box?.querySelector('.term-wrap');
  const w = Math.max(0, (wrap?.clientWidth ?? 348) - 2 * 16), h = Math.max(0, (wrap?.clientHeight ?? 600) - 16);
  const cell = termCell(12);
  return { cols: Math.min(500, Math.max(20, Math.floor(w / cell.w))), rows: Math.min(200, Math.max(5, Math.floor(h / cell.h))) };
}
// One cell of the mono font at px, measured once per size.
export const TERM_CELLS = new Map();
export function termCell(px: Loose) {
  if (!TERM_CELLS.has(px)) {
    const c = document.createElement('canvas').getContext('2d');
    c!.font = `${px}px ${getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace'}`;
    TERM_CELLS.set(px, { w: c!.measureText('W'.repeat(50)).width / 50 || px * 0.6, h: Math.ceil(px * 1.2) });
  }
  return TERM_CELLS.get(px);
}
// The font that fits the pane's columns in the box: 12 px down to a floor of 9; below that the screen scrolls sideways.
export function termFont(s: Loose) {
  const wrap = s.box.querySelector('.term-wrap');
  const room = wrap.clientWidth - parseFloat(getComputedStyle(wrap).paddingLeft) - parseFloat(getComputedStyle(wrap).paddingRight);
  const cols = s.screen?.cols || 80;
  for (let px = 12; px > 9; px--) if (termCell(px).w * cols <= room) return px;
  return 9;
}
// The xterm theme from the page's tokens, in light and dark.
export function termTheme() {
  const c = getComputedStyle(document.documentElement), v = (k: Loose) => c.getPropertyValue(k).trim();
  return { background: v('--surface'), foreground: v('--fg'), cursor: v('--fg'), cursorAccent: v('--surface'), selectionBackground: 'rgba(82,168,255,.3)' };
}
// Draw the tab from what it has: a refusal's words, the supervisor not running, the shell ended, or the screen
// (xterm, or the plain text when the library didn't load).
export function termPaint(w: Loose) {
  const s = termTab(w);
  if (!s.box) return;
  const st = s.box.querySelector('.term-state'), wrap = s.box.querySelector('.term-wrap'), live = s.box.querySelector('[data-term-live]');
  const state = (html: Loose, label: Loose) => { st.innerHTML = html; st.hidden = false; wrap.hidden = true; live.classList.add('off'); live.lastChild.textContent = label; termHint(w); };
  if (TERM.why && TERM.why !== 'view') return void state(`<p>${esc(Object.hasOwn(TERM_WHY_WORDS, TERM.why) ? TERM_WHY_WORDS[TERM.why] : "The terminal tabs didn't answer. Reload the page to try again.")}</p>`, 'off');
  const sc = s.screen;
  if (w === 'shell' && sc?.state === 'gone' && s.live) return void state('<h3>The shell ended.</h3><button type="button" data-term-newshell>Open a new shell</button>', 'ended');
  if (w === 'shell' && s.openErr) return void state(`<p>${esc(s.openErr)}</p><button type="button" data-term-newshell>Try again</button>`, 'not open');
  if (w === 'supervisor' && sc?.state === 'gone') {
    const box = hostHere(location, (pageHello(location) as Loose)?.name)?.box;
    return void state(`<h3>The supervisor isn't running.</h3><p>To bring it back, run this in a terminal on this machine:</p><code>node docs/devteam/scripts/devteam.mjs recover</code>${box ? `<p><a class="linkish" data-term-terminal href="${esc(`${location.protocol}//${box}/#terminal`)}" target="_top">Open the Terminal page</a></p>` : ''}`, 'not running');
  }
  st.hidden = true; wrap.hidden = false;
  live.classList.toggle('off', !sc || sc.state !== 'live');
  live.lastChild.textContent = sc?.state === 'live' ? 'live' : 'reading…';
  const plain = s.box.querySelector('.term-plain'), screen = s.box.querySelector('.term-screen');
  if (!s.term && TERM.lib !== 'failed') {
    (termLib()! as Loose).then((Terminal: Loose) => { if (!s.term) termMake(w, Terminal); }, () => { TERM.lib = ('failed' as Loose); for (const x of TERM_IDS) termPaint(x); });
  }
  if (TERM.lib === 'failed') {
    screen.hidden = true; plain.hidden = false;
    plain.textContent = (sc?.lines ?? []).map(termText).join('\n');
  } else if (s.term && sc?.state === 'live') {
    if (s.term.cols !== sc.cols || s.term.rows !== sc.rows) s.term.resize(Math.max(1, sc.cols), Math.max(1, sc.rows));
    const px = termFont(s);
    if (s.term.options.fontSize !== px) s.term.options.fontSize = px;
    const m = sc.modes ?? {};
    s.term.write(`\x1b[?25l\x1b[H\x1b[2J\x1b[0m${sc.lines.map((l: Loose) => `${termSafe(l)}\x1b[0m`).join('\r\n')}\x1b[${(sc.cursor?.y ?? 0) + 1};${(sc.cursor?.x ?? 0) + 1}H${m.app_cursor ? '\x1b[?1h' : '\x1b[?1l'}${m.app_keypad ? '\x1b=' : '\x1b>'}${sc.cursor?.visible ? '\x1b[?25h' : ''}`);
  }
  termHint(w);
}
// The xterm for a tab, once: keys to the pane, Ctrl+] to leave, a paste asked about and sent whole.
export function termMake(w: Loose, Terminal: Loose) {
  const s = termTab(w);
  const screen = s.box.querySelector('.term-screen');
  const sc = s.screen;
  const term = new Terminal({ cols: sc?.cols || 80, rows: sc?.rows || 24, fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono'), fontSize: 12, theme: termTheme(), scrollback: 0, cursorBlink: false, allowProposedApi: false, disableStdin: false });
  term.open(screen);
  s.term = term;
  term.attachCustomKeyEventHandler((e: Loose) => {
    if (e.type === 'keydown' && e.ctrlKey && (e.key === ']' || e.code === 'BracketRight')) { term.blur(); (document.querySelector('#th-tabs [role="tab"][aria-selected="true"]') as Loose)?.focus(); return false; }
    return true;
  });
  term.onData((d: Loose) => termKeys(w, termBytes(d)));
  term.onBinary((d: Loose) => termKeys(w, Uint8Array.from(d, (c: Loose) => c.charCodeAt(0) & 255)));
  // a paste: caught before xterm's own handler, asked about when it is more than one line, sent as one paste post
  screen.addEventListener('paste', (e: Loose) => {
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (text) termPaste(w, text);
  }, true);
  termPaint(w);
}
export const termKeysOn = (w: Loose) => !!termTab(w).term && TERM.lib !== 'failed' && !!TERM.token && termTab(w).screen?.state === 'live';
// Keys: queued behind the post in flight; queued data merges up to 4096 bytes, never across a paste.
export function termKeys(w: Loose, bytes: Loose) {
  const s = termTab(w);
  if (!termKeysOn(w) || !bytes.length) return;
  for (let i = 0; i < bytes.length; i += TERM_DATA_MAX) {
    const part = bytes.subarray(i, i + TERM_DATA_MAX), last = s.queue[s.queue.length - 1];
    if (last?.data && last.data.length + part.length <= TERM_DATA_MAX) { const m = new Uint8Array(last.data.length + part.length); m.set(last.data); m.set(part, last.data.length); last.data = m; }
    else s.queue.push({ data: part });
  }
  termPump(w);
}
// A paste: more than one line asks "Paste N lines?" first; too large for one post is refused here, whole.
export function termPaste(w: Loose, text: Loose) {
  const s = termTab(w);
  if (!termKeysOn(w)) return;
  if (termBytes(JSON.stringify({ which: w, pane: s.screen.pane, page: TERM.page, seq: s.seq + 1, paste: text, token: TERM.token })).length > TERM_BODY_MAX) { s.err = 'That paste is too large to send in one piece, so nothing was sent.'; return void termHint(w); }
  const n = text.split(/\r\n|\r|\n/).length;
  if (n < 2) { s.queue.push({ paste: text }); return void termPump(w); }
  s.ask = { text, n };
  const ask = s.box.querySelector('.term-ask');
  ask.innerHTML = `<span>Paste ${n} lines?</span><button type="button" data-term-paste="yes">Paste</button><button type="button" class="ghost" data-term-paste="no">Cancel</button>`;
  ask.hidden = false;
  ask.querySelector('[data-term-paste="yes"]').focus();
}
// One post in flight per tab: the next queued one when it is answered. Never retried: a failure shows its words and
// drops the queue. A taken post records whether it left the owner's line open (the waiting note's rule).
export async function termPump(w: Loose) {
  const s = termTab(w);
  if (s.inflight || !s.queue.length) return;
  const item = s.queue.shift();
  s.inflight = true;
  const body = { which: w, pane: s.screen?.pane, page: TERM.page, seq: ++s.seq, ...(item.data ? { data: termHex(item.data) } : { paste: item.paste }), token: TERM.token };
  let r: Loose = null, j: Loose = null;
  try { r = await fetch(`/api/term/${w}/keys`, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); j = await r.json().catch(() => null); } catch { r = null; }
  s.inflight = false;
  if (r?.ok && j?.v === 1) {
    if (j.taken) { const b = item.data; s.own = b && (b[b.length - 1] === 0x0d || b[b.length - 1] === 0x03) ? 'done' : 'open'; }
    s.err = '';
    termScreen(w, j);
    return void termPump(w);
  }
  s.queue = [];
  s.err = termWords(r, j);
  if (r?.status === 403 && j?.why) { TERM.why = j.why; TERM.token = null; thDraw(); termRedraw(); }
  // the pane moved or went: read it again now
  if (r?.status === 423 || r?.status === 409) { s.etag = null; clearTimeout(s.timer); s.timer = null; if (s.reading) s.again = true; else termRead(w); }
  termHint(w);
}
// The line under the screen: an error; the waiting note (held lines over 2 minutes behind this page's own open line,
// supervisor ruling 2026-11-18: the count alone never shows it); typing off without the library; else how to leave.
export function termHint(w: Loose) {
  const s = termTab(w);
  const h = s.box?.querySelector('.term-hint');
  if (!h) return;
  const held = s.screen?.held;
  let html: Loose;
  if (s.err || s.readErr) html = `<span class="err">${esc(s.err || s.readErr)}</span>`;
  else if (w === 'supervisor' && s.own === 'open' && held && held.count > 0 && held.oldest_ms >= 120000) html = `<span data-term-waiting>Messages for the supervisor are waiting until you send or clear your line.${held.prompt === 'unknown' ? ' Answer it here to let them through.' : ''}</span>`;
  else if (TERM.lib === 'failed') html = "<span>The terminal couldn't load, so typing is off. This is the screen as text.</span>";
  else if (s.screen?.state === 'live') html = '<span>Click the screen to type.</span> <span><kbd>Ctrl</kbd> <kbd>]</kbd> to leave it.</span>';
  else html = '';
  if (h.innerHTML !== html) h.innerHTML = html;
}
export function termRedraw() { for (const w of TERM_IDS) termPaint(w); termSync(); }
// A press in a tab's box: the paste question, Open a new shell.
export function termClick(w: Loose, e: Loose) {
  const s = termTab(w);
  const p = e.target.closest('[data-term-paste]');
  if (p && s.ask) {
    const { text } = s.ask;
    s.ask = null;
    s.box.querySelector('.term-ask').hidden = true;
    if (p.dataset.termPaste === 'yes') { s.queue.push({ paste: text }); termPump(w); }
    s.term?.focus();
    return;
  }
  if (e.target.closest('[data-term-newshell]') && w === 'shell') { s.screen = null; s.etag = null; s.live = false; termOpen(); }
}
// Wide (design, Size): a toggle in the panel's head, shown on a terminal tab, widening the panel to half the window
// (html.th-wide, #term-css), remembered per browser.
export function termWide() { try { return localStorage.getItem(TERM_WIDE_KEY) === '1'; } catch { return false; } }
export function termWideButton() {
  const end = document.querySelector('.threads-head .end');
  if (!end) return;
  let b = $('th-wide');
  if (!b) {
    b = document.createElement('button');
    (b as Loose).type = 'button'; b.id = 'th-wide'; b.className = 'ghost icon-btn';
    b.setAttribute('aria-label', 'Wide'); b.title = 'Wide: the panel takes half the window';
    b.innerHTML = '<i class="icon-panel-left-open" aria-hidden="true"></i>';
    b.addEventListener('click', () => {
      const on = !termWide();
      try { localStorage.setItem(TERM_WIDE_KEY, on ? '1' : '0'); } catch {}
      termSync();
      setTimeout(() => { for (const w of TERM_IDS) termPaint(w); }, 0);
    });
    end.prepend(b);
  }
  b.hidden = !TERM.shown;
  const on = String(termWide());
  if (b.getAttribute('aria-pressed') !== on) b.setAttribute('aria-pressed', on);
}
