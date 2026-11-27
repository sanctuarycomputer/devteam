// The browser view's script (browser.html 91-480), ported as it is: start() wires the server-rendered
// markup to the socket at /socket and to the owner's input. Nothing runs at import; start() runs once.

// browser@1's view messages from the server (test/contracts/browser.schema.json); a message
// that doesn't match its shape is ignored
const JPEG = /^\/9j\/[A-Za-z0-9+/]*={0,2}$/;
const QID = /^q-\d{8}-\d{9}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
// x-masked-url, as the schema writes it (a test holds the two equal)
const MASKED = new RegExp(String.raw`^(?:about:blank|https?://[^/?#@\s]+(?:/(?:•••|(?=(?:[^/?#\s\d]*\d){0,3}[^/?#\s\d]*(?:[/?]|$))[^/?#\s]{0,19}(?=[/?]|$)))*(?:\?(?:(?:[^=&#\s•]+=•••|•••)(?:&(?:[^=&#\s•]+=•••|•••))*)?)?)$`);
const int = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const closed = (m: object, keys: string[]) => Object.keys(m).every((k) => keys.includes(k));

type Msg = Record<string, unknown>;
type Ask = { id: string; kind: 'confirm' | 'prompt' | 'beforeunload'; url: string; text: string; default?: string; frame?: true };
type Press = { id: number; button: string; x: number; y: number; cx: number; cy: number; down: boolean; last: { x: number; y: number } | null };
type Held = { key: string; code?: string; meta: boolean };

let started = false;

export function start(): void {
  if (started) return;
  started = true;
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const canvas = $<HTMLCanvasElement>('screen');
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const area = $('area');
  const addr = $<HTMLInputElement>('addr');

  let socket: WebSocket | null = null;
  let frame: { w: number; h: number } | null = null; // the last frame drawn: { w, h }
  let drawnSeq = -1; // on this socket
  let pendingUrl: string | null = null;
  let wait = 500;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let opened = false; // a socket has opened at least once
  let ended = false; // the server said bye: no reconnect until the owner asks

  const chip = (s: string) => { $('chip').textContent = s; $('chip').classList.toggle('live', s === 'Live'); };

  // The canvas shows the whole frame: as large as fits the page's width and the height under the bar,
  // up or down, aspect kept. Its own size is the frame's, so on-screen points scale by its box alone.
  function fit() {
    if (!frame) return;
    const top = area.getBoundingClientRect().top;
    const below = $('footbar').getBoundingClientRect().height + 8 + 2;
    const s = Math.max(0.05, Math.min(area.clientWidth / frame.w, (innerHeight - top - below) / frame.h));
    canvas.style.width = `${Math.floor(frame.w * s)}px`;
    canvas.style.height = `${Math.floor(frame.h * s)}px`;
  }
  addEventListener('resize', fit);
  // the line under the bar; the canvas fits again, since it moves the screen down or up
  const note = (s: string) => { $('note').textContent = s; fit(); };

  async function draw(m: Msg, sock: WebSocket) {
    if (!closed(m, ['t', 'data', 'w', 'h', 'seq']) || !int(m.w, 1, 8192) || !int(m.h, 1, 8192) || !int(m.seq, 0, Number.MAX_SAFE_INTEGER) || typeof m.data !== 'string' || !JPEG.test(m.data)) return;
    if (m.seq <= drawnSeq) return;
    let bitmap: ImageBitmap;
    try {
      const bin = atob(m.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    } catch { return; }
    // a newer frame, or another socket, got there first
    if (sock !== socket || m.seq <= drawnSeq) { bitmap.close(); return; }
    drawnSeq = m.seq;
    const resized = !frame || frame.w !== m.w || frame.h !== m.h;
    if (resized) { canvas.width = m.w; canvas.height = m.h; }
    ctx.drawImage(bitmap, 0, 0, m.w, m.h);
    bitmap.close();
    frame = { w: m.w, h: m.h };
    if (resized) { canvas.classList.remove('empty'); $('waiting').hidden = true; fit(); }
  }

  function showUrl(url: string) {
    if (document.activeElement === addr) pendingUrl = url;
    else { addr.value = url; pendingUrl = null; }
  }
  addr.addEventListener('blur', () => { if (pendingUrl !== null) showUrl(pendingUrl); });

  function onMessage(data: string, sock: WebSocket) {
    let m: Msg;
    try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return;
    if (m.t === 'frame') draw(m, sock);
    else if (m.t === 'url') { if (closed(m, ['t', 'url']) && typeof m.url === 'string' && MASKED.test(m.url)) showUrl(m.url); }
    else if (m.t === 'dialog') {
      if (!closed(m, ['t', 'id', 'kind', 'url', 'text', 'default', 'frame']) || !dialogId(m.id) || typeof m.kind !== 'string' || !Object.hasOwn(ASKS, m.kind) || typeof m.url !== 'string' || !MASKED.test(m.url) || !URL.canParse(m.url) || !words(m.text)) return;
      if (m.frame !== undefined && m.frame !== true) return;
      if (m.default !== undefined && (m.kind !== 'prompt' || !words(m.default) || !m.default)) return;
      if (!asks.some((x) => x.id === m.id)) asks.push(m as unknown as Ask);
      showAsk();
    }
    else if (m.t === 'dialog_end') { if (closed(m, ['t', 'id']) && dialogId(m.id)) dropAsk(m.id); }
    else if (m.t === 'bye') {
      // 1 to 200 characters, counted as the schema counts them: by code point
      if (!closed(m, ['t', 'why']) || typeof m.why !== 'string' || !int([...m.why].length, 1, 200)) return;
      ended = true;
      $('bye-why').textContent = m.why;
      $('bye').hidden = false;
      $('chip').hidden = true;
      sock.close();
    }
    else if (m.t === 'held') {
      if (!closed(m, ['t', 'qid'])) return;
      if (m.qid === null) $('foot').textContent = 'The supervisor has the browser. You can watch.';
      else if (typeof m.qid === 'string' && QID.test(m.qid)) $('foot').textContent = 'When you\'re done, press Done on the card.';
      fit(); // a line that wraps takes height from the screen
    }
  }

  function connect() {
    clearTimeout(timer);
    const s = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/socket`);
    socket = s;
    drawnSeq = -1;
    // nothing held down on an earlier socket gets its up on this one
    press = null;
    held.clear();
    s.addEventListener('open', () => { if (s !== socket) return; wait = 500; opened = true; $<HTMLButtonElement>('signout').disabled = false; chip('Live'); area.classList.remove('down'); });
    s.addEventListener('message', (e) => { if (s === socket && typeof e.data === 'string') onMessage(e.data, s); });
    s.addEventListener('close', () => {
      if (s !== socket) return;
      socket = null;
      // with no socket, Sign out could only fail: it is off until one opens
      $<HTMLButtonElement>('signout').disabled = true;
      // what was held down went with that socket: its up must not go to the next one
      press = null;
      held.clear();
      area.classList.add('down');
      asks.length = 0; // the next socket is sent what is still open
      showAsk();
      if (ended) return;
      chip(opened ? 'Reconnecting…' : 'Connecting…');
      timer = setTimeout(connect, wait);
      wait = Math.min(wait * 2, 5000);
    });
  }

  // ----- a page's confirm, prompt or beforeunload, the owner's to answer ------------------------
  // The page's words are text, never markup. The page in Chrome picks when its dialog appears, so for
  // a second after one appears or moves neither a press nor a key answers it, and for a second after
  // one goes nothing but an up reaches Chrome (send): a press or key meant for what was there lands on
  // neither.
  const dialogId = (v: unknown): v is string => typeof v === 'string' && /^d-[0-9a-f]{16}$/.test(v);
  const ASKS: Record<Ask['kind'], [string, string]> = { confirm: ['Cancel', 'OK'], prompt: ['Cancel', 'OK'], beforeunload: ['Stay', 'Leave'] };
  const words = (v: unknown): v is string => typeof v === 'string' && [...v].length <= 2000;
  const SETTLE_MS = 1000;
  const asks: Ask[] = []; // open dialogs, the first one shown
  let shown: Ask | null = null;
  let arming: ReturnType<typeof setTimeout> | undefined;
  let began: EventTarget | null = null; // the armed answer this pointer press began on
  let quietUntil = 0;
  const ask = $<HTMLDialogElement>('ask');
  const askNo = $<HTMLButtonElement>('ask-no');
  const askYes = $<HTMLButtonElement>('ask-yes');
  const askText = $<HTMLInputElement>('ask-text');
  const quiet = () => performance.now() < quietUntil;
  function arm() {
    clearTimeout(arming);
    began = null;
    askNo.disabled = askYes.disabled = true;
    if (shown) arming = setTimeout(() => { askNo.disabled = askYes.disabled = false; }, SETTLE_MS);
  }
  function showAsk() {
    const m = asks[0] ?? null;
    if (m === shown) return;
    const was = shown;
    shown = m;
    stale = true;
    if (was) { askText.value = ''; quietUntil = performance.now() + SETTLE_MS; }
    if (!m) { arm(); ask.close(); return; }
    letGo(); // what was held on the canvas was for the page as it was
    confirm.close(); // Sign out's own question never sits under the page's
    const host = m.url === 'about:blank' ? 'A page' : `${m.frame ? 'A frame in the page' : 'The page'} at ${new URL(m.url).host}`;
    $('ask-from').textContent = `${host} ${m.kind === 'beforeunload' ? 'asks before leaving. What you entered may be lost.' : 'says'}`;
    $('ask-said').textContent = m.text;
    $('ask-said').hidden = !m.text;
    askText.hidden = m.kind !== 'prompt';
    askText.value = m.default ?? '';
    [askNo.textContent, askYes.textContent] = ASKS[m.kind];
    arm();
    if (!ask.open) ask.showModal();
    $('ask-from').focus(); // neither an answer nor the text field, so what the owner was typing goes nowhere
  }
  function dropAsk(id: string) {
    const i = asks.findIndex((x) => x.id === id);
    if (i >= 0) asks.splice(i, 1);
    showAsk();
  }
  function answerAsk(accept: boolean) {
    if (!shown || !socket || socket.readyState !== 1) return;
    const m: Msg = { t: 'dialog', id: shown.id, accept };
    if (shown.kind === 'prompt' && accept) m.text = askText.value;
    send(m);
    arm(); // up until its dialog_end: an answer the daemon dropped can be pressed again
  }
  addEventListener('pointerdown', (e) => { began = (e.target as HTMLButtonElement).disabled ? null : e.target; }, true);
  for (const [b, accept] of [[askNo, false], [askYes, true]] as const) {
    b.addEventListener('click', (e) => {
      const ok = e.detail === 0 || began === e.currentTarget; // 0: the keyboard
      began = null;
      if (ok) answerAsk(accept);
    });
    b.addEventListener('keydown', (e) => { if (e.repeat) e.preventDefault(); });
  }
  // Escape is no answer; a browser that closes the modal anyway has it opened again
  ask.addEventListener('cancel', (e) => e.preventDefault());
  ask.addEventListener('close', () => { if (shown) { ask.showModal(); arm(); } });
  addEventListener('resize', () => { if (shown) arm(); });
  document.addEventListener('visibilitychange', () => { if (shown) arm(); });

  // ----- the owner's input, on the canvas only -----------------------------------------------
  // send is the only way out, and it drops what finds no open socket: nothing is queued, so a
  // password typed during a reconnect is never replayed into whatever page is up by then. What the
  // owner types or pastes lives only in the handler that sends it.
  // In the quiet second after a page's dialog goes, only an up, an answer or Sign out
  // (which asks first) is sent.
  const send = (m: Msg) => { if (quiet() && m.t !== 'dialog' && m.t !== 'forget' && m.type !== 'up') return; if (socket && socket.readyState === 1) socket.send(JSON.stringify(m)); };
  type Mods = { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };
  const MODS = (e: Mods) => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
  const withMods = (m: Msg, e: Mods) => { const k = MODS(e); if (k) m.mods = k; return m; };
  const BUTTONS = ['left', 'middle', 'right'];
  const round = (v: number) => Math.round(v * 100) / 100;
  // frame pixels: the on-screen point scaled by the canvas's box to the last frame drawn
  function toFrame(e: { clientX: number; clientY: number }) {
    const f = frame as { w: number; h: number };
    const r = canvas.getBoundingClientRect();
    return {
      x: round(Math.min(f.w, Math.max(0, ((e.clientX - r.left) * f.w) / r.width))),
      y: round(Math.min(f.h, Math.max(0, ((e.clientY - r.top) * f.h) / r.height))),
    };
  }

  // A press is held back until it is a click (released within 4 px) or a drag (it travels further).
  let stale = false; // a key may be held since before a page's dialog
  let press: Press | null = null; // { id, button, x, y, cx, cy, down, last }
  let lastClick: { at: number; cx: number; cy: number; button: string; n: number } | null = null; // the page counts clicks itself
  let queued: Msg | null = null;
  let raf = 0;
  const flush = () => { cancelAnimationFrame(raf); raf = 0; if (queued) { send(queued); queued = null; } };
  const queue = (m: Msg) => { queued = m; if (!raf) raf = requestAnimationFrame(flush); };

  canvas.addEventListener('pointerdown', (e) => {
    if (quiet()) return;
    canvas.focus();
    const button = BUTTONS[e.button];
    if (!frame || press || !button) return;
    canvas.setPointerCapture(e.pointerId);
    flush();
    press = { id: e.pointerId, button, ...toFrame(e), cx: e.clientX, cy: e.clientY, down: false, last: null };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!frame) return;
    if (press && e.pointerId !== press.id) return;
    const at = toFrame(e);
    if (!press) return queue(withMods({ t: 'mouse', type: 'move', ...at, button: 'none' }, e));
    if (!press.down && Math.hypot(e.clientX - press.cx, e.clientY - press.cy) > 4) {
      press.down = true;
      send(withMods({ t: 'mouse', type: 'down', x: press.x, y: press.y, button: press.button, clicks: 1 }, e));
    }
    if (press.down) { press.last = at; queue(withMods({ t: 'mouse', type: 'move', ...at, button: press.button }, e)); }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!press || e.pointerId !== press.id || BUTTONS[e.button] !== press.button) return;
    const p = press;
    press = null;
    // released further than 4 px from the press with no move between: a drag all the same
    if (!p.down && Math.hypot(e.clientX - p.cx, e.clientY - p.cy) > 4) { p.down = true; send(withMods({ t: 'mouse', type: 'down', x: p.x, y: p.y, button: p.button, clicks: 1 }, e)); }
    if (p.down) { flush(); send(withMods({ t: 'mouse', type: 'up', ...toFrame(e), button: p.button, clicks: 1 }, e)); return; }
    const now = performance.now();
    const again = lastClick && lastClick.button === p.button && now - lastClick.at <= 500 && Math.hypot(p.cx - lastClick.cx, p.cy - lastClick.cy) <= 4;
    lastClick = { at: now, cx: p.cx, cy: p.cy, button: p.button, n: again && lastClick ? Math.min(3, lastClick.n + 1) : 1 };
    send(withMods({ t: 'mouse', type: 'click', x: p.x, y: p.y, button: p.button, clicks: lastClick.n }, e));
  });
  // a drag whose capture is lost still ends where it last was; a press not yet a drag just ends
  function letGo() {
    const p = press;
    press = null;
    if (!p || !p.down) return;
    flush();
    send({ t: 'mouse', type: 'up', ...(p.last ?? { x: p.x, y: p.y }), button: p.button, clicks: 1 });
  }
  canvas.addEventListener('lostpointercapture', (e) => { if (press && e.pointerId === press.id) letGo(); });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!frame) return;
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? frame.h : 1;
    const px = (v: number) => Math.max(-100000, Math.min(100000, round(v * k)));
    send(withMods({ t: 'wheel', ...toFrame(e), dx: px(e.deltaX), dy: px(e.deltaY) }, e));
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Keys. A modifier alone sends nothing (it rides as mods on what it modifies); a paste chord is
  // left to the browser so its paste event fires. held maps the physical key (its code) of each
  // down this socket saw to its key name, until its up, so no up goes to a socket that never saw
  // the down. Only keys sent as down are in it: never a typed character or a paste.
  const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Fn', 'FnLock', 'Hyper', 'Super', 'Symbol', 'SymbolLock', 'NumLock', 'ScrollLock', 'OS']);
  const held = new Map<string, Held>(); // code → { key, code?, meta }
  // by its key or, on a layout whose V types something else, by its place on the keyboard
  const pasteChord = (e: KeyboardEvent) => ((e.key === 'v' || e.key === 'V' || e.code === 'KeyV') && (e.ctrlKey || e.metaKey) && !e.altKey) || (e.key === 'Insert' && e.shiftKey);
  // AltGr, or Ctrl and Alt together (how Windows reports it) when the key types something other
  // than its own letter: Ctrl+Alt+Q typing @ is a character, Ctrl+Alt+Q typing q a chord
  const altGr = (e: KeyboardEvent) => e.getModifierState('AltGraph') || (e.ctrlKey && e.altKey && !(/^Key[A-Z]$/.test(e.code) && e.key.toLowerCase() === e.code.slice(3).toLowerCase()));
  const named = (e: KeyboardEvent): { key: string; code?: string } => (e.code && e.code.length <= 32 ? { key: e.key, code: e.code } : { key: e.key });
  // a key held since before a dialog came or went repeats into nothing, wherever the focus is, until a
  // key is pressed afresh after the quiet second
  addEventListener('keydown', (e) => {
    if (!e.repeat) { if (!quiet()) stale = false; return; }
    if (stale) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  canvas.addEventListener('keydown', (e) => {
    if (e.isComposing || MODIFIERS.has(e.key) || pasteChord(e)) return;
    e.preventDefault();
    if (!e.key || e.key.length > 32) return;
    if (e.key === 'Enter') return send(withMods({ t: 'key', type: 'press', ...named(e), text: '\r' }, e));
    if ([...e.key].length === 1 && (!(e.ctrlKey || e.metaKey) || altGr(e))) {
      // a character: its text is what it types, so Ctrl and Alt from AltGr aren't sent with it
      const m: Msg = { t: 'key', type: 'press', ...named(e), text: e.key };
      if (e.shiftKey) m.mods = 8;
      return send(m);
    }
    held.set(e.code || e.key, { ...named(e), meta: e.metaKey });
    send(withMods({ t: 'key', type: 'down', ...named(e) }, e));
  });
  canvas.addEventListener('keyup', (e) => {
    // macOS sends no keyup for a key pressed while Cmd was held: its up goes when Cmd does
    if (e.key === 'Meta') for (const [id, k] of held) if (k.meta) { held.delete(id); send({ t: 'key', type: 'up', key: k.key, ...(k.code ? { code: k.code } : {}) }); }
    const k = held.get(e.code || e.key);
    if (!k) return;
    held.delete(e.code || e.key);
    e.preventDefault();
    send({ t: 'key', type: 'up', ...named(e) });
  });
  // A paste goes as typed text: pieces of at most 10 000 characters, cut between code points, up
  // to 100 000 in all.
  document.addEventListener('paste', (e) => {
    if (document.activeElement !== canvas) return;
    e.preventDefault();
    const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (!text) return;
    if (text.length > 100000) return note('That paste is too long to send.');
    note('');
    for (let i = 0; i < text.length;) {
      let j = Math.min(text.length, i + 10000);
      const c = text.charCodeAt(j - 1);
      if (j < text.length && c >= 0xd800 && c <= 0xdbff) j--;
      send({ t: 'paste', text: text.slice(i, j) });
      i = j;
    }
  });

  // a key still down when the canvas loses focus gets its up now: its keyup goes elsewhere
  canvas.addEventListener('blur', () => {
    for (const k of held.values()) send({ t: 'key', type: 'up', key: k.key, ...(k.code ? { code: k.code } : {}) });
    held.clear();
  });

  // ----- the address bar, Back, Sign out of everything -----------------------------------------
  // What the owner typed, with https:// in front where it names no scheme; the page sends only
  // http and https (the server and the guard check again).
  const SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;
  function toNav(typed: string): { url: string; refuse?: undefined } | { refuse: string } {
    const v = typed.trim();
    const url = SCHEME.test(v) ? v : `https://${v}`;
    let u: URL;
    try { u = new URL(url); } catch { return { refuse: 'Only http and https addresses open here.' }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { refuse: 'Only http and https addresses open here.' };
    if (url.length > 2048) return { refuse: 'That address is too long.' };
    return { url };
  }
  // with no socket an entry or Back would go nowhere: say so rather than drop it silently
  const SOON = 'A page was just asking: not sent. Try again in a second.';
  const live = () => socket && socket.readyState === 1;
  $('go').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!addr.value.trim()) return;
    const r = toNav(addr.value);
    if (r.refuse !== undefined) return note(r.refuse);
    if (!live()) return note('Not connected: not sent.');
    if (quiet()) return note(SOON);
    note('');
    send({ t: 'nav', url: r.url });
    addr.blur();
  });
  $('back').addEventListener('click', () => { if (!live()) return note('Not connected: not sent.'); if (quiet()) return note(SOON); note(''); send({ t: 'back' }); });
  $('again').addEventListener('click', () => {
    ended = false;
    $('bye').hidden = true;
    $('chip').hidden = false;
    chip('Connecting…');
    wait = 500;
    connect();
  });
  const confirm = $<HTMLDialogElement>('confirm');
  $('signout').addEventListener('click', () => confirm.showModal());
  $('cancel').addEventListener('click', () => confirm.close());
  $('forget').addEventListener('click', () => {
    confirm.close();
    // the socket dropped with the confirm open: say so, never sign out silently into nothing
    if (!live()) return note('Not connected: nothing was signed out.');
    send({ t: 'forget' });
  });

  connect();
}
