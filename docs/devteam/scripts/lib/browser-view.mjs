/* imports start */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { BROWSER_BACK } from './browser-input.mjs';
import { BROWSER_HELD_VERBS } from './browser.mjs';
import { BROWSER_KEY_LIST } from './browser-input.mjs';
import { BROWSER_UNREADABLE_NOW } from './browser-input.mjs';
import { BROWSER_USAGE } from './browser.mjs';
import { askLine } from './decide.mjs';
import { browserAlive } from './browser.mjs';
import { browserCall } from './browser.mjs';
import { browserCandidates } from './browser.mjs';
import { browserDeleteSession } from './browser.mjs';
import { browserDialogLines } from './browser.mjs';
import { browserEnsure } from './browser.mjs';
import { browserErrorFile } from './browser-input.mjs';
import { browserForgetOther } from './browser.mjs';
import { browserForgetRestart } from './browser-input.mjs';
import { browserGate } from './browser-input.mjs';
import { browserGates } from './browser.mjs';
import { browserGone } from './browser.mjs';
import { browserHandovers } from './browser.mjs';
import { browserHeld } from './browser.mjs';
import { browserHeldLine } from './browser.mjs';
import { browserHome } from './browser.mjs';
import { browserHttp } from './browser.mjs';
import { browserIdleMs } from './browser.mjs';
import { browserIsDaemon } from './browser.mjs';
import { browserKey } from './browser.mjs';
import { browserKeyOk } from './browser-input.mjs';
import { browserKillChrome } from './browser.mjs';
import { browserLaunchChrome } from './browser-input.mjs';
import { browserMask } from './browser.mjs';
import { browserOwnerAnswer } from './browser.mjs';
import { browserPrepareProfile } from './browser.mjs';
import { browserPreviewRec } from './browser.mjs';
import { browserProcsOn } from './browser.mjs';
import { browserProfile } from './browser.mjs';
import { browserProfiles } from './browser.mjs';
import { browserReadLastError } from './browser-input.mjs';
import { browserReap } from './browser-input.mjs';
import { browserReaper } from './browser-input.mjs';
import { browserRenew } from './browser.mjs';
import { browserScope } from './browser.mjs';
import { browserShutdown } from './browser-input.mjs';
import { browserSleep } from './browser.mjs';
import { browserStartGate } from './browser-input.mjs';
import { browserState } from './browser.mjs';
import { browserStateFile } from './browser.mjs';
import { browserTestEnv } from './browser.mjs';
import { browserVerbs } from './browser-input.mjs';
import { browserViewClosed } from './browser-input.mjs';
import { browserViewHeld } from './browser-input.mjs';
import { browserViewPending } from './browser-input.mjs';
import { browserViewRead } from './browser-input.mjs';
import { browserWatch } from './browser-input.mjs';
import { browserWatchChrome } from './browser-input.mjs';
import { browserWatchTabs } from './browser.mjs';
import { browserWriteState } from './browser.mjs';
import { die } from './base.mjs';
import { fileURLToPath } from 'node:url';
import { flagStr } from './base.mjs';
import { flags } from './base.mjs';
import { isObj } from './artifact-notes.mjs';
import { json } from './base.mjs';
import { killPreviewWindow } from './previews.mjs';
import { logWriter } from './log.mjs';
import { out } from './base.mjs';
import { positional } from './base.mjs';
import { previewProject } from './previews.mjs';
import { readPreviews } from './previews.mjs';
import { removePreview } from './previews.mjs';
import { rest } from './base.mjs';
import { startBrowserGuard } from './browser-guard.mjs';
import { warn } from './base.mjs';
/* imports end */
// The control server: POST / only, Host 127.0.0.1:<port>, JSON, and the secret (timingSafeEqual);
// anything else 403 and nothing run. Verbs run one at a time; the idle timer is paused while one runs
// and re-armed after it. ping, after the same checks, is answered at once off the queue and leaves the
// idle timer alone.
export function browserControl(ctx, secret) {
  const want = Buffer.from(secret);
  let queue = Promise.resolve();
  // with a viewer's socket open, while the owner has the browser, or with a close not yet handled (the
  // watch queues it within 500 ms: the daemon never idles out from under it), the idle timer arms again
  // rather than stop the daemon. The fold is read as it fires; one that fails keeps the last hold.
  const busy = () => {
    if (ctx.viewer) return true;
    try { browserViewRead(ctx); } catch {}
    return ctx.pending || !!ctx.held;
  };
  const arm = () => { clearTimeout(ctx.idle); ctx.idle = setTimeout(() => (!ctx.stopping && busy() ? arm() : browserShutdown(ctx, 'idle')), browserIdleMs()); };
  // ctx.serial(fn): fn on the verbs' queue (the view's forget), the idle timer paused as for a verb
  ctx.serial = (fn) => {
    const run = queue.then(async () => {
      if (ctx.stopping) return;
      clearTimeout(ctx.idle);
      try { await fn(); } catch {} finally { if (!ctx.stopping) arm(); }
    });
    queue = run;
    return run;
  };
  const server = http.createServer((req, res) => {
    req.on('error', () => {});
    res.on('error', () => {});
    const given = Buffer.from(String(req.headers['x-devteam-browser'] ?? ''));
    const ok = req.method === 'POST' && req.url === '/' && req.headers.host === `127.0.0.1:${server.address().port}` && /^application\/json\b/.test(req.headers['content-type'] ?? '') && given.length === want.length && crypto.timingSafeEqual(given, want);
    if (!ok) { req.resume(); res.writeHead(403, { 'content-type': 'text/plain', connection: 'close' }); return void res.end('forbidden\n'); }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; if (body.length > 1048576) req.destroy(); });
    req.on('end', () => {
      let m;
      try { m = JSON.parse(body); } catch {}
      const verb = typeof m?.verb === 'string' && Object.hasOwn(ctx.verbs, m.verb) ? m.verb : null;
      const run = async () => {
        if (ctx.stopping) return { code: 1, out: 'browser: stopping' };
        if (!verb) return { code: 1, out: `usage: ${BROWSER_USAGE}` };
        if (verb !== 'ping') clearTimeout(ctx.idle); // paused while the verb runs
        try {
          // a close first, so no verb runs ahead of one (settle runs the gate itself), then the hold,
          // read again here: a verb the CLI's check let by (or a call that skipped the CLI) is refused
          // while the owner has the browser. settle serves nothing to the agent.
          if (!['ping', 'status', 'stop', 'settle'].includes(verb)) {
            await browserGate(ctx);
            if (ctx.stopping) return { code: 1, out: 'browser: stopping' };
            const held = browserHeld(browserHandovers());
            if (held) return { code: 3, out: `the owner has the browser (${held})` };
          }
          // the dialogs kept so far (kit-329): a plain-text answer ends with a line per dialog and takes
          // them; ping and a JSON answer (tabs, settle, --json) leave them for the next one
          const args = isObj(m.args) ? m.args : {};
          let r;
          try { r = await ctx.verbs[verb](args); } catch (e) { r = { code: 1, out: `browser ${verb}: ${e?.message ?? 'failed'}` }; }
          if (verb === 'ping' || verb === 'tabs' || verb === 'settle' || args.json) return r;
          const said = browserDialogLines(ctx.dialogs);
          ctx.dialogs = { shown: [], more: 0 };
          return said.length ? { ...r, out: [r.out, ...said].join('\n') } : r;
        } catch (e) { return { code: 1, out: `browser ${verb}: ${e?.message ?? 'failed'}` }; } finally { if (verb !== 'ping' && !ctx.stopping) arm(); }
      };
      // ping reads nothing from Chrome and is answered at once, off the queue: a long verb or a forget
      // never makes the daemon look dead to browserLive (and so a second daemon started over it)
      const ping = verb === 'ping';
      const answered = (ping ? run() : queue.then(run)).then((r) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(r));
        if (ping) return; // ctx.after is the queued verb's (stop's), never taken by a ping
        const after = ctx.after;
        ctx.after = null;
        if (after) res.once('finish', after);
      }).catch(() => { try { res.destroy(); } catch {} }); // one bad answer never stops the queue
      if (!ping) queue = answered;
    });
  });
  return { server, arm };
}
export const browserListen = (server, port) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(server.address().port); }); });
// --- the live view (kit-66): browser.html on the view port, and its one socket (RFC 6455, text only)
// carrying Chrome's screencast to the page. Nothing a viewer sends is logged, written or echoed.
export const BROWSER_WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const BROWSER_WS_MAX = 262144; // a joined message, judged on each header's declared length
export const BROWSER_WS_FRAGMENTS = 1024; // fragments per message: empty ones would grow it with the size still 0
export const BROWSER_WS_BACKLOG = 2097152; // a frame message is dropped while more than this waits to be written
export const BROWSER_FRAME_DATA = /^\/9j\/[A-Za-z0-9+/]*={0,2}$/; // the contract's frame data
export const browserHook = (name, dflt) => { const n = Number(browserTestEnv(name)); return Number.isFinite(n) && n > 0 ? n : dflt; };
export const browserPingMs = () => browserHook('DEVTEAM_TEST_BROWSER_PING_MS', 15000);
export const browserCastMax = () => Math.min(1280, Math.round(browserHook('DEVTEAM_TEST_BROWSER_CAST_MAX', 1280)));
// A header's one value, or null when it is missing or given more than once.
export function browserOneHeader(req, name) {
  let v = null, n = 0;
  for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === name) { v = req.rawHeaders[i + 1]; n++; }
  return n === 1 ? v : null;
}
export const browserViewHost = (req, port) => [`127.0.0.1:${port}`, `localhost:${port}`].includes(browserOneHeader(req, 'host'));
// A CDP call the view makes: never an unhandled rejection (a closing pipe answers with one).
export const browserViewCdp = (ctx, method, params, sid) => { ctx.cdp?.send(method, params, sid).catch(() => {}); };
// One upgraded socket: its frame reader and writer. onText gets each joined text message; onClose runs
// once, however it closed. A ping every pingMs; closed 2 x pingMs after the last byte received (a timer
// every byte resets, not a check at the ping ticks, which would let silence run up to pingMs longer).
export function browserSocket(sock, { onText, onClose, pingMs }) {
  let buf = Buffer.alloc(0), parts = [], joined = 0, inMsg = false, closed = false;
  const write = (op, payload) => {
    if (sock.destroyed || !sock.writable) return;
    const len = payload.length;
    let hdr;
    if (len < 126) hdr = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { hdr = Buffer.alloc(4); hdr[0] = 0x80 | op; hdr[1] = 126; hdr.writeUInt16BE(len, 2); } else { hdr = Buffer.alloc(10); hdr[0] = 0x80 | op; hdr[1] = 127; hdr.writeBigUInt64BE(BigInt(len), 2); }
    try { sock.write(Buffer.concat([hdr, payload])); } catch {}
  };
  const finish = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    clearTimeout(silence);
    buf = Buffer.alloc(0);
    parts = [];
    try { onClose?.(); } catch {}
  };
  // A close frame with code, then a FIN; destroyed 1 s later only if the peer hasn't closed.
  const close = (code) => {
    if (closed) return;
    if (code) { const b = Buffer.alloc(2); b.writeUInt16BE(code); write(8, b); }
    finish();
    try { sock.end(); } catch {}
    const t = setTimeout(() => sock.destroy(), 1000);
    t.unref?.();
    sock.once('close', () => clearTimeout(t));
  };
  const read = () => {
    for (;;) {
      if (closed || buf.length < 2) return;
      const b0 = buf[0], b1 = buf[1], fin = !!(b0 & 0x80), op = b0 & 15;
      if (b0 & 0x70) return close(1002); // a reserved bit
      if (!(b1 & 0x80)) return close(1002); // unmasked
      let len = b1 & 127, at = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; } else if (len === 127) { if (buf.length < 10) return; const big = buf.readBigUInt64BE(2); len = big > BigInt(BROWSER_WS_MAX) ? Infinity : Number(big); at = 10; }
      if (op >= 8) {
        if (op > 10 || !fin || len > 125) return close(1002); // an unknown, fragmented or long control frame
      } else if (op === 2) return close(1003); // binary
      else if (op === 0 ? !inMsg : op === 1 ? inMsg : true) return close(1002); // a stray continuation, a text mid-message, an unknown opcode
      else if (joined + len > BROWSER_WS_MAX || parts.length >= BROWSER_WS_FRAGMENTS) return close(1009); // on the header, before its payload is buffered
      if (buf.length < at + 4 + len) return;
      const mask = buf.subarray(at, at + 4), body = Buffer.from(buf.subarray(at + 4, at + 4 + len));
      for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
      buf = buf.subarray(at + 4 + len);
      if (op === 8) return close(1000);
      if (op === 9) { write(10, body); continue; }
      if (op === 10) continue;
      parts.push(body);
      joined += len;
      inMsg = !fin;
      if (!fin) continue;
      const text = Buffer.concat(parts).toString('utf8');
      parts = [];
      joined = 0;
      onText?.(text);
    }
  };
  const feed = (chunk) => {
    if (closed) return;
    silence.refresh();
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    try { read(); } catch { close(1011); }
  };
  sock.setKeepAlive(true);
  sock.setNoDelay(true);
  const silence = setTimeout(() => close(1001), 2 * pingMs);
  silence.unref?.();
  const timer = setInterval(() => write(9, Buffer.alloc(0)), pingMs);
  timer.unref?.();
  sock.on('data', feed);
  sock.on('end', () => close(0));
  sock.on('close', finish);
  return {
    feed,
    close,
    get closed() { return closed; },
    // false when it wasn't sent: a droppable message (a frame) while the socket's backlog is over 2 MiB
    send(obj, droppable = false) {
      if (closed || (droppable && sock.writableLength > BROWSER_WS_BACKLOG)) return false;
      write(1, Buffer.from(JSON.stringify(obj)));
      return true;
    },
  };
}
// The screencast, on the tab being cast: JPEG, quality 60, at most 1280 x 1280, every frame.
export function browserCast(ctx, tab, on) {
  if (!tab?.sessionId) return;
  if (!on) return browserViewCdp(ctx, 'Page.stopScreencast', {}, tab.sessionId);
  const m = browserCastMax();
  browserViewCdp(ctx, 'Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: m, maxHeight: m, everyNthFrame: 1 }, tab.sessionId);
}
// Every 250 ms while a viewer is open (and once at open): a new active tab moves the screencast to it;
// a changed masked URL is sent. Nothing while Chrome isn't up (a forget restarting it).
export function browserViewTick(ctx, v) {
  try {
    if (!ctx.ready || ctx.stopping || ctx.viewer !== v || v.ws.closed) return;
    const tab = ctx.active?.sessionId ? ctx.active : null;
    if (tab !== v.tab) { browserCast(ctx, v.tab, false); v.tab = tab; browserCast(ctx, tab, true); }
    const url = browserMask(ctx.active?.url ?? 'about:blank', ctx.active?.opening);
    if (url !== v.url && !browserViewPending(ctx)) { v.url = url; v.ws.send({ t: 'url', url }); }
  } catch {}
}
export function browserViewClose(ctx, v) {
  clearInterval(v.timer);
  browserCast(ctx, v.tab, false);
  v.tab = null;
  if (ctx.viewer === v) ctx.viewer = null;
}
// Page.screencastFrame: acknowledged at once; sent as frame only when it comes from the tab being cast
// to the open viewer, its data the contract's pattern and its size (CSS pixels) 1 to 8192. seq lives on
// the viewer's own object, so it rises for as long as the socket lives.
export function browserViewFrame(ctx, params, sessionId) {
  if (params?.sessionId !== undefined) browserViewCdp(ctx, 'Page.screencastFrameAck', { sessionId: params.sessionId }, sessionId);
  const v = ctx.viewer;
  if (!v || v.ws.closed || !v.tab?.sessionId || v.tab.sessionId !== sessionId) return;
  const w = Math.round(params?.metadata?.deviceWidth), h = Math.round(params?.metadata?.deviceHeight);
  if (typeof params.data !== 'string' || !BROWSER_FRAME_DATA.test(params.data) || !(w >= 1 && w <= 8192) || !(h >= 1 && h <= 8192)) return;
  const scale = params.metadata.pageScaleFactor;
  v.scale = typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : 1; // the input's x, y are divided by it
  if (browserViewPending(ctx)) return; // acknowledged above, never sent
  if (v.ws.send({ t: 'frame', data: params.data, w, h, seq: v.seq }, true)) v.seq++;
}
// The page's messages ($defs.view.from_page), checked by hand: closed field sets, types, bounds and
// enums. Not the kit's schemaErrors, so no refusal text can ever carry a typed value; a message that
// fails is null and dropped. Lengths are JSON Schema's (code points).
export const BROWSER_MODS = { type: 'int', min: 0, max: 15 };
export const BROWSER_XY = { type: 'num', min: 0, max: 8192 };
export const BROWSER_FROM_PAGE = {
  mouse: { req: ['type', 'x', 'y'], f: { type: { enum: ['down', 'up', 'move', 'click'] }, x: BROWSER_XY, y: BROWSER_XY, button: { enum: ['none', 'left', 'middle', 'right'] }, clicks: { type: 'int', min: 0, max: 3 }, mods: BROWSER_MODS } },
  wheel: { req: ['x', 'y', 'dx', 'dy'], f: { x: BROWSER_XY, y: BROWSER_XY, dx: { type: 'num', min: -100000, max: 100000 }, dy: { type: 'num', min: -100000, max: 100000 }, mods: BROWSER_MODS } },
  key: { req: ['type', 'key'], f: { type: { enum: ['down', 'up', 'press'] }, key: { type: 'str', min: 1, max: 32 }, code: { type: 'str', min: 1, max: 32 }, text: { type: 'str', min: 1, max: 8 }, mods: BROWSER_MODS } },
  paste: { req: ['text'], f: { text: { type: 'str', min: 1, max: 10000 } } },
  nav: { req: ['url'], f: { url: { type: 'str', min: 1, max: 2048 } } },
  back: { req: [], f: {} },
  forget: { req: [], f: {} },
  dialog: { req: ['id', 'accept'], f: { id: { type: 'str', min: 18, max: 18, re: /^d-[0-9a-f]{16}$/ }, accept: { enum: [true, false] }, text: { type: 'str', min: 0, max: 10000 } } },
};
export function browserViewMessage(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string' || !Object.hasOwn(BROWSER_FROM_PAGE, m.t)) return null;
  const shape = BROWSER_FROM_PAGE[m.t];
  for (const k of shape.req) if (!Object.hasOwn(m, k)) return null;
  for (const k of Object.keys(m)) {
    if (k === 't') continue;
    if (!Object.hasOwn(shape.f, k)) return null;
    const s = shape.f[k], x = m[k];
    if (s.enum) { if (!s.enum.includes(x)) return null; continue; }
    if (s.type === 'str') {
      if (typeof x !== 'string' || x.length < s.min || x.length > 2 * s.max) return null; // UTF-16 length bounds code points both ways
      const n = [...x].length;
      if (n < s.min || n > s.max || (s.re && !s.re.test(x))) return null;
    } else if (typeof x !== 'number' || !Number.isFinite(x) || (s.type === 'int' && !Number.isInteger(x)) || x < s.min || x > s.max) return null;
  }
  return m;
}
// windowsVirtualKeyCode for a key: the named keys, then KeyA-KeyZ and Digit0-9 from code. 0 if none.
export const BROWSER_VK = { Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18, Pause: 19, CapsLock: 20, Escape: 27, ' ': 32, PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Insert: 45, Delete: 46, Meta: 91, ContextMenu: 93, ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, 112 + i])) };
export function browserVk(key, code) {
  if (Object.hasOwn(BROWSER_VK, key)) return BROWSER_VK[key];
  const c = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(code ?? '');
  if (c) return (c[1] ?? c[2]).charCodeAt(0);
  if (code === 'Space') return 32;
  return 0;
}
export const BROWSER_BUTTONS = { none: 0, left: 1, right: 2, middle: 4 };
// One message from the page: parsed, checked, and handed to the active tab's session. Nothing about
// it is logged, printed, stored or echoed; a failed CDP call is dropped (browserViewCdp catches it).
// While Chrome isn't up (the start steps, a forget restarting it) or the daemon is stopping, every
// message is dropped, a second forget among them, so nothing reads a null ctx.active. So is every
// message on a socket whose handover has closed (browserViewClosed), before the close's bye.
export function browserViewInput(ctx, v, text) {
  if (!ctx.ready || ctx.stopping || ctx.viewer !== v) return;
  if (browserViewClosed(ctx, v)) return;
  let m;
  try { m = browserViewMessage(JSON.parse(text)); } catch { return; }
  if (!m) return;
  if (m.t === 'forget') { // Sign out of everything, on the verbs' queue; one queued at a time
    if (ctx.forgetting) return;
    ctx.forgetting = true;
    return void ctx.serial(() => browserForgetRestart(ctx)).finally(() => { ctx.forgetting = false; });
  }
  if (m.t === 'dialog') return browserOwnerAnswer(ctx, m);
  const sid = ctx.active?.sessionId;
  if (!sid) return; // a tab with no session: dropped
  if (ctx.ownerDialogs.has(sid) && m.type !== 'up') return; // a dialog is up: Chrome would keep the input and land it after the answer
  const cdp = (method, params) => browserViewCdp(ctx, method, params, sid);
  const scale = v.scale > 0 ? v.scale : 1;
  switch (m.t) {
    case 'mouse': {
      const button = m.button ?? 'none', base = { x: m.x / scale, y: m.y / scale, button, modifiers: m.mods ?? 0 };
      const held = BROWSER_BUTTONS[button], clickCount = m.clicks ?? 1;
      if (m.type === 'move') return cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base, buttons: held, clickCount: 0 });
      if (m.type === 'down' || m.type === 'click') cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...base, buttons: held, clickCount });
      if (m.type === 'up' || m.type === 'click') cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, buttons: 0, clickCount });
      return;
    }
    case 'wheel':
      return cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: m.x / scale, y: m.y / scale, deltaX: m.dx, deltaY: m.dy, modifiers: m.mods ?? 0 });
    case 'key': {
      const base = { key: m.key, ...(m.code ? { code: m.code } : {}), windowsVirtualKeyCode: browserVk(m.key, m.code), modifiers: m.mods ?? 0 };
      if (m.type === 'press') {
        cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(m.text ? { text: m.text, unmodifiedText: m.text } : {}) });
        return cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      }
      return cdp('Input.dispatchKeyEvent', { type: m.type === 'down' ? 'rawKeyDown' : 'keyUp', ...base });
    }
    case 'paste':
      return cdp('Input.insertText', { text: m.text });
    case 'nav': {
      let u;
      try { u = new URL(m.url); } catch { return; }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return; // file:, javascript:, data:, chrome: … dropped
      return cdp('Page.navigate', { url: u.href }); // not awaited: the guard answers whatever it is
    }
    case 'back':
      ctx.cdp?.send('Page.getNavigationHistory', {}, sid).then((h) => {
        const prev = h?.entries?.[h.currentIndex - 1];
        if (h?.currentIndex > 0 && prev?.id !== undefined) cdp('Page.navigateToHistoryEntry', { entryId: prev.id });
      }).catch(() => {});
      return;
  }
}
// The view server: GET or HEAD / (Host one of the two loopback forms) is browser.html, read once here;
// an upgrade passes five guards in order, each refusal a short HTTP answer and a FIN. One viewer.
export function browserViewServer(ctx) {
  const page = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dashboard', 'browser.html'));
  const plain = (code) => `${http.STATUS_CODES[code].toLowerCase()}\n`;
  const server = http.createServer((req, res) => {
    req.on('error', () => {});
    res.on('error', () => {});
    req.resume();
    const no = (code, extra = {}) => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', connection: 'close', ...extra }); res.end(plain(code)); };
    if (!browserViewHost(req, server.address()?.port)) return no(403);
    if (String(req.url).split('?')[0] !== '/') return no(404);
    if (req.method !== 'GET' && req.method !== 'HEAD') return no(405, { allow: 'GET, HEAD' });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': page.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "frame-ancestors 'self'" });
    res.end(req.method === 'HEAD' ? undefined : page);
  });
  server.on('clientError', (e, s) => s.destroy());
  server.on('upgrade', (req, sock, head) => {
    sock.on('error', () => sock.destroy());
    try {
      const port = server.address()?.port;
      const refuse = (code) => {
        const body = plain(code);
        sock.end(`HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`);
        const t = setTimeout(() => sock.destroy(), 1000);
        t.unref?.();
        sock.once('close', () => clearTimeout(t));
      };
      if (req.url !== '/socket') return refuse(404);
      if (!browserViewHost(req, port)) return refuse(403);
      if (![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(browserOneHeader(req, 'origin'))) return refuse(403);
      const key = browserOneHeader(req, 'sec-websocket-key');
      if (req.method !== 'GET' || String(browserOneHeader(req, 'upgrade')).toLowerCase() !== 'websocket' || browserOneHeader(req, 'sec-websocket-version') !== '13' || !/^[A-Za-z0-9+/]{22}==$/.test(key ?? '')) return refuse(400);
      if (ctx.stopping || (!ctx.ready && !ctx.closing)) return refuse(503);
      const accept = crypto.createHash('sha1').update(key + BROWSER_WS_GUID).digest('base64');
      sock.write(`HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: ${accept}\r\n\r\n`);
      const v = { ws: null, seq: 0, tab: null, url: null, timer: null, scale: 1, handover: null, heldSent: undefined };
      v.ws = browserSocket(sock, { pingMs: browserPingMs(), onText: (text) => browserViewInput(ctx, v, text), onClose: () => browserViewClose(ctx, v) });
      if (head?.length) v.ws.feed(head);
      if (v.ws.closed) return;
      // a close pending: refused with bye, before it can be the viewer, so it is never sent a frame.
      // A bye, not a 503: browser.html stops on it and offers Show it again, where a 503 has it retry
      // A refusal because the log can't be read says so: the handover may still be open (R3-1)
      if (ctx.closing || browserViewPending(ctx, true)) { v.ws.send({ t: 'bye', why: !ctx.closing && ctx.readFailedAt ? BROWSER_UNREADABLE_NOW : BROWSER_BACK }); return v.ws.close(1000); }
      if (ctx.viewer) { v.ws.send({ t: 'bye', why: 'The browser is already open in another window.' }); return v.ws.close(1000); }
      ctx.viewer = v;
      browserViewHeld(ctx, v); // the current hold, from the fold just read
      for (const o of ctx.ownerDialogs.values()) v.ws.send({ t: 'dialog', ...o }); // still open: the owner's to answer
      browserViewTick(ctx, v);
      v.timer = setInterval(() => browserViewTick(ctx, v), 250);
      v.timer.unref?.();
    } catch { try { sock.destroy(); } catch {} }
  });
  return server;
}
// browser serve, in the preview's window: the view server bound first, then the profile and
// its start steps, the guard, Chrome, the CDP tabs, the control server, then state.json. It writes
// nothing to its window once it is up. The bind comes before the start steps (kit-316 final-1b S1): a
// port another preview took fails this daemon and browserEnsure relaunches, and only a daemon that
// got its port may kill a leftover Chrome or clear a lock, so the one that comes up reports them.
export async function browserServe({ chrome: bin }) {
  const ctx = { chrome: null, cdp: null, guard: null, profile: null, notes: [], restarted: false, tabs: [], active: null, bin, preview: null, view: null, control: null, idle: null, renew: null, stopping: null, after: null, viewer: null, ready: false, state: null, serial: null, forgetting: false, handled: new Map(), held: null, folded: [], pending: false, foldAt: 0, closing: false, gateQueued: false, watch: null, dialogs: { shown: [], more: 0 }, dialogHold: null, ownerDialogs: new Map(), ownerNone: 0 };
  for (const s of ['SIGHUP', 'SIGTERM', 'SIGINT']) process.on(s, () => browserShutdown(ctx, 'signal'));
  browserIsDaemon = true;
  const viewPort = Number(process.env.PORT);
  const rec = readPreviews().find((r) => r.project === previewProject() && r.session === logWriter() && r.label === 'browser' && r.port === viewPort);
  if (!rec) die(`browser serve: no browser preview record on port ${process.env.PORT}`);
  ctx.preview = rec.name;
  ctx.profile = browserProfile();
  try {
    ctx.view = browserViewServer(ctx);
    // test hook: the first daemon to find this file missing makes it and fails its bind (T4-1); with
    // DEVTEAM_TEST_BROWSER_BIND_FAIL_N=<n> (kit-877) the first n binds fail, and the file lists their
    // ports, one a line (kit-923)
    const failOnce = browserTestEnv('DEVTEAM_TEST_BROWSER_BIND_FAIL');
    const failN = Number(browserTestEnv('DEVTEAM_TEST_BROWSER_BIND_FAIL_N'));
    if (failOnce && failN > 1) {
      let n = 0;
      try { n = fs.readFileSync(failOnce, 'utf8').split('\n').filter(Boolean).length; } catch {}
      if (n < failN) { fs.appendFileSync(failOnce, `${viewPort}\n`); throw Object.assign(new Error(`listen EADDRINUSE: address already in use 127.0.0.1:${viewPort}`), { code: 'EADDRINUSE' }); }
    } else if (failOnce) { try { fs.writeFileSync(failOnce, '', { flag: 'wx' }); throw Object.assign(new Error(`listen EADDRINUSE: address already in use 127.0.0.1:${viewPort}`), { code: 'EADDRINUSE' }); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
    await browserListen(ctx.view, viewPort);
    ctx.restarted = (await browserPrepareProfile(ctx.profile, ctx.notes)).restarted;
    ctx.guard = await startBrowserGuard();
    // test hook: a stop signal that lands during the start steps, as one can (kit-777 final-1 F2)
    if (browserTestEnv('DEVTEAM_TEST_BROWSER_STOP_BEFORE_LAUNCH')) process.emit('SIGTERM');
    // a stop came during the start steps: no Chrome now. Detached, it would outlive the daemon, whose
    // exit would also remove the temp folder it runs in.
    if (ctx.stopping) return;
    const { cdp } = await browserLaunchChrome(ctx, { headed: process.env.DEVTEAM_BROWSER_HEADED === '1' });
    if (ctx.stopping) { try { process.kill(-ctx.chrome.pid, 'SIGKILL'); } catch {} return; } // a signal came while it launched
    ctx.cdp = cdp;
    browserReaper(ctx); // kit-877: the session files deleted after this daemon, however it ends
    browserWatchChrome(ctx, ctx.chrome, cdp);
    await browserWatchTabs(ctx);
    for (let i = 0; i < 100 && !ctx.tabs.some((t) => t.sessionId); i++) await browserSleep(100);
    ctx.verbs = browserVerbs(ctx);
    const secret = crypto.randomBytes(32).toString('hex');
    const { server, arm } = browserControl(ctx, secret); // the verbs' queue (ctx.serial); ctx.handled is made above
    ctx.control = server;
    // closes made while no daemon ran are handled before any verb is taken (kit-67), then the watch
    browserStartGate(ctx);
    ctx.watch = browserWatch(ctx);
    const controlPort = await browserListen(server, 0);
    ctx.state = { browser: 1, daemon_pid: process.pid, chrome_pid: ctx.chrome.pid, control_port: controlPort, control_secret: secret, guard_port: ctx.guard.port, view_port: viewPort, preview: ctx.preview };
    browserWriteState(ctx.state); // a forget rewrites it with its new chrome_pid
    ctx.ready = true; // the view's guard 5: Chrome is up
    fs.rmSync(browserErrorFile(), { force: true }); // an earlier daemon's failure is history now
    arm();
    ctx.renew = setInterval(() => browserRenew(ctx, viewPort), Number(browserTestEnv('DEVTEAM_TEST_BROWSER_RENEW_MS')) || 3600000);
    ctx.renew.unref();
    process.on('uncaughtException', () => browserShutdown(ctx, 'error'));
    process.on('unhandledRejection', () => browserShutdown(ctx, 'error'));
  } catch (e) {
    if (ctx.chrome?.pid) { try { process.kill(-ctx.chrome.pid, 'SIGKILL'); } catch {} }
    try { ctx.view?.close(); } catch {} // bound before the start steps: a refused start frees its port
    const m = String(e?.message ?? e);
    die(m.startsWith('browser') ? m : `browser: ${m}`);
  }
}
// browser stop: the daemon told to stop, and up to 10 s for it to go. A dead daemon's Chrome is killed
// here (only one proven by its --user-data-dir); then the session files, the window, the preview
// record and state.json. It makes nothing: no profile, no run/browser. rec: the record to remove
// (preview stop hands its own, so any writer's stop takes it); this writer's by default. True back
// unless a leftover Chrome couldn't be stopped (said, and exit 1).
export async function browserStop({ say = true, rec } = {}) {
  let ok = true;
  const s = browserState();
  if (s) {
    let late = null;
    try { await browserCall('stop', {}, { state: s }); } catch (e) { if (e.timedOut) late = e; }
    if (late && browserAlive(s.daemon_pid)) { // still working: its Chrome and session are left to it
      process.stderr.write(`devteam: browser stop: ${late.message}\n`);
      process.exitCode = 1;
      return false;
    }
    await browserGone(s.daemon_pid, 10000);
  }
  const profile = path.join(browserHome(), browserKey());
  if (fs.existsSync(profile)) {
    try {
      await browserKillChrome(profile, [...browserCandidates(profile), ...(browserProcsOn(profile) ?? [])]);
      browserDeleteSession(profile);
    } catch (e) { process.stderr.write(`devteam: ${e.message}\n`); process.exitCode = 1; ok = false; }
  }
  const r = rec ?? browserPreviewRec();
  if (r) { killPreviewWindow(r); removePreview(r.name); }
  fs.rmSync(browserStateFile(), { force: true });
  if (say) out(s ? 'browser stopped' : "browser wasn't running");
  return ok;
}
export async function browserStatus() {
  const s = browserState();
  let r = null;
  if (s) { try { r = await browserCall('status', { json: !!flags.json }, { state: s }); } catch (e) { if (e.timedOut) die(`browser status: ${e.message}`); } }
  if (r) { process.exitCode = r.code; return out(r.out); }
  const off = { browser: 1, instance: browserKey(), running: false, held: browserHeld(browserHandovers()) };
  const err = browserReadLastError();
  return out(flags.json ? JSON.stringify(off) : [`browser isn't running (profile ${off.instance})`, browserHeldLine(off.held), ...(err ? [`last error: ${err}`] : [])].join('\n'));
}
// browser type --stdin's text: stdin read to its end, bounded in bytes (stops once past max + 2, room
// for a \r\n) and in time, decoded once at the end so a character split across reads stays whole,
// with one trailing \n or \r\n dropped and then held to max. A refusal never echoes the text.
export function browserReadStdin({ max, ms }) {
  if (process.stdin.isTTY || browserTestEnv('DEVTEAM_TEST_BROWSER_STDIN_TTY') === '1') die('browser type --stdin reads the text from a pipe: printf %s "$SECRET" | devteam.mjs browser type <ref> --stdin');
  const over = `browser type --stdin: the text is over ${max} bytes`;
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    const timer = setTimeout(() => die(`browser type --stdin: stdin didn't close in ${ms / 1000} s`), ms);
    process.stdin.on('data', (d) => {
      size += d.length;
      if (size > max + 2) { clearTimeout(timer); die(over); }
      chunks.push(d);
    });
    process.stdin.on('error', (e) => { clearTimeout(timer); die(`browser type --stdin: stdin unreadable (${e.code ?? 'error'})`); });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      let b = Buffer.concat(chunks);
      if (b.length >= 2 && b[b.length - 2] === 0x0d && b[b.length - 1] === 0x0a) b = b.subarray(0, -2);
      else if (b.length >= 1 && b[b.length - 1] === 0x0a) b = b.subarray(0, -1);
      if (b.length > max) die(over);
      resolve(b.toString('utf8'));
    });
  });
}
// browser handover --reason "<words>": one owner-action question handing the browser to the owner for a
// login (class browser-handover, scope browser:<key>), linking the live view by its preview name only.
// In order: exactly --reason (non-blank, at most 2000 characters; so no --default reaches ask from
// here), not while one is open, the daemon ensured (the preview exists), the repeated-site warning,
// then askLine's own checks. It prints the qid.
export const BROWSER_HANDOVER_USAGE = 'usage: browser handover --reason "<words>" (non-blank, at most 2000 characters)';
export const BROWSER_HANDOVER_DAYS = 7;
export async function browserHandover() {
  const reason = flagStr('reason');
  if (positional.length !== 1 || rest !== null || Object.keys(flags).some((k) => k !== 'reason') || reason === undefined || !reason.trim() || [...reason].length > 2000) die(BROWSER_HANDOVER_USAGE);
  const scope = browserScope();
  const open = browserHeld(browserHandovers(scope));
  if (open) die(`browser handover: ${open} is already open; wait for it (browser wait) or withdraw it`);
  // root.json's mtime (a forget makes it again): only a missing file reads as none; any other error
  // stops here, before anything starts. Read again once the daemon is up, which makes a missing one.
  const rootMade = () => {
    try { return fs.statSync(path.join(browserHome(), browserKey(), 'root.json')).mtimeMs; } catch (e) { if (e.code === 'ENOENT') return 0; return die(`browser handover: couldn't read the profile's root.json (${e.code ?? e.message})`); }
  };
  rootMade();
  const s = await browserEnsure();
  // the site: the active tab's host (with its port), from the status verb; none on about:blank
  let st = null;
  try { const r = await browserCall('status', { json: true }, { state: s }); if (r.code === 0) st = JSON.parse(r.out); } catch (e) { if (e.timedOut) die(`browser handover: ${e.message}`); }
  let site = null;
  try { const u = new URL(st?.url ?? ''); if (u.protocol === 'http:' || u.protocol === 'https:') site = u.host; } catch {}
  if (site) {
    // an earlier handover of this site, asked within 7 days and after the profile's root.json was made
    // (a forget, or Sign out of everything, makes it again): its session may not have lasted
    const line = `The browser is on ${site}.`;
    const made = rootMade();
    const now = Date.now();
    const seen = browserHandovers(scope).filter((h) => { const at = Date.parse(h.asked_at); return String(h.context).split(/\r\n|\r|\n/).includes(line) && now - at <= BROWSER_HANDOVER_DAYS * 86400000 && at > made; }).pop();
    if (seen) warn(`browser handover: ${site} was handed over on ${seen.asked_at.slice(0, 10)} (${seen.qid}) and not forgotten since; the session may not have lasted`);
  }
  const context = ["Open the browser from the link, do the step there, then press Done. Until you press Done, the supervisor can't use the browser.", site ? `The browser is on ${site}.` : null].filter(Boolean).join('\n\n');
  for (const k of Object.keys(flags)) delete flags[k];
  Object.assign(flags, { kind: 'owner-action', scope, question: reason, context, links: JSON.stringify([{ title: 'Open the browser', preview: s.preview }]), choices: JSON.stringify([{ label: 'Done' }, { label: "Can't right now" }]), stake: '2', urgency: '2' });
  Object.assign(flags, { class: 'browser-handover' }); // its own line: every quoted kebab word beside a class key is read as a class name
  out(askLine().id);
}
// browser wait [--timeout <n>s|<n>m|<n>h]: how this scope's handover ended, as browser@1's wait. The
// handover is the held one (the oldest open), else the most recently asked; only that qid is read.
// While it is open: the fold every 500 ms, the daemon kept running (a dead one and its view started
// again under the same preview name), and after --timeout {outcome: timeout} with the hold left.
// Once it is closed: the daemon's settle (the daemon started if none runs; its start handles the close
// too) until it lists the qid with the fold's outcome, up to 120 s; then the fold's outcome and, on
// done, the entry's reopened. The outcome is always the fold's, never a run/ file's.
export const BROWSER_WAIT_USAGE = 'usage: browser wait [--timeout <n>s|<n>m|<n>h] (1 s to 24 h)';
export async function browserWait() {
  if (positional.length !== 1 || rest !== null || Object.keys(flags).some((k) => k !== 'timeout')) die(BROWSER_WAIT_USAGE);
  let limit = null;
  if (flags.timeout !== undefined) {
    const m = /^([1-9]\d{0,5})([smh])$/.exec(typeof flags.timeout === 'string' ? flags.timeout : '');
    limit = m ? Number(m[1]) * { s: 1000, m: 60000, h: 3600000 }[m[2]] : 0;
    if (!(limit >= 1000 && limit <= 86400000)) die(BROWSER_WAIT_USAGE);
  }
  const scope = browserScope();
  const hs = browserHandovers(scope);
  const qid = browserHeld(hs) ?? hs.at(-1)?.qid;
  if (!qid) die('browser wait: no handover has been asked on this browser');
  const start = Date.now();
  // a qid gone from this scope's fold (its live log file removed: run/ is the machine's own) is no
  // handover of this browser now: said, never a crash
  const find = () => browserHandovers(scope).find((h) => h.qid === qid) ?? die(`browser wait: ${qid} is no longer in the log as a handover of this browser; nothing to wait for`);
  let h = find();
  const firstRead = browserTestEnv('DEVTEAM_TEST_BROWSER_WAIT_FIRST_READ'); // tests: a file made once wait has read the log
  if (firstRead) fs.writeFileSync(firstRead, '');
  while (h.status === 'open') {
    await browserEnsure();
    if (limit !== null && Date.now() - start >= limit) return out(JSON.stringify({ browser: 1, qid, outcome: 'timeout' }));
    await browserSleep(500);
    h = find();
  }
  const bound = Number(browserTestEnv('DEVTEAM_TEST_BROWSER_WAIT_MS')) || 120000;
  const closed = Date.now();
  for (;;) {
    let listed = null;
    try {
      const s = await browserEnsure();
      const r = await browserCall('settle', {}, { state: s });
      if (r.code === 0) listed = JSON.parse(r.out)?.handled?.find((x) => x?.qid === qid) ?? null;
    } catch (e) { if (e?.timedOut) die(`browser wait: ${e.message}`); } // the ruled words, as every verb's (R3-2)
    h = find();
    if (h.status !== 'open' && listed && listed.outcome === h.outcome) {
      return out(JSON.stringify({ browser: 1, qid, outcome: h.outcome, ...(h.outcome === 'done' && Array.isArray(listed.reopened) ? { reopened: listed.reopened } : {}) }));
    }
    if (Date.now() - closed >= bound) die(`browser wait: the browser hasn't confirmed the reset after ${qid} closed; browser status says more`);
    await browserSleep(500);
  }
}
// Which gates each verb runs: status, profiles and stop skip Chrome; the memory check is browserEnsure's.
export const BROWSER_VERBS = {
  ...Object.fromEntries(['start', 'open', 'snapshot', 'click', 'type', 'press', 'scroll', 'back', 'tabs', 'tab', 'screenshot', 'forget', 'serve', 'handover', 'wait'].map((v) => [v, { chrome: true }])),
  status: { chrome: false }, stop: { chrome: false }, profiles: { chrome: false }, reap: { chrome: false },
};
export async function cmdBrowser() {
  const verb = positional[0];
  if (!Object.hasOwn(BROWSER_VERBS, verb ?? '')) die(`usage: ${BROWSER_USAGE}`);
  if (verb === 'serve' && process.env.DEVTEAM_BROWSER_SERVE !== '1') die('browser serve is internal: browser start runs it in its own window');
  if (verb === 'reap' && process.env.DEVTEAM_BROWSER_SERVE !== '1') die('browser reap is internal: the daemon runs it when it ends');
  const { chrome } = browserGates(BROWSER_VERBS[verb]);
  // the hold, before anything starts: no daemon touched, no stdin read, no profile removed
  if (BROWSER_HELD_VERBS.includes(verb)) {
    const held = browserHeld(browserHandovers());
    if (held) die(`browser ${verb}: the owner has the browser (${held}); browser wait says when it is back`, 3);
  }
  if (verb === 'profiles') return out(JSON.stringify({ browser: 1, profiles: browserProfiles() }));
  if (verb === 'forget') {
    if (flags.profile === true) die(`usage: ${BROWSER_USAGE}`);
    const key = flagStr('profile');
    if (key !== undefined && key !== browserKey()) return browserForgetOther(key);
    // this checkout's own: stopped as stop does, then removed as another's is (refused while held)
    await browserStop({ say: false });
    return browserForgetOther(browserKey());
  }
  if (verb === 'serve') return browserServe({ chrome });
  if (verb === 'reap') return browserReap();
  if (verb === 'status') return browserStatus();
  if (verb === 'stop') return browserStop();
  if (verb === 'start') { const s = await browserEnsure({ headed: !!flags.headed }); return out(`browser running (preview ${s.preview}, profile ${browserKey()})`); }
  if (verb === 'handover') return browserHandover();
  if (verb === 'wait') return browserWait();
  // open is refused before any daemon is touched unless its URL is http(s)
  if (verb === 'open' && (positional.length !== 2 || !browserHttp(positional[1]))) die('browser open takes an http: or https: URL');
  // Each verb's arguments, checked here so a wrong one starts nothing; a refusal never echoes a typed
  // value or a key.
  const usage = () => die(`usage: ${BROWSER_USAGE}`);
  const n = positional.length, ref = () => (/^e[1-9]\d{0,5}$/.test(positional[1] ?? '') ? positional[1] : usage());
  let send = {
    open: () => ({ url: positional[1] }),
    snapshot: () => ({ json: !!flags.json }),
    click: () => (n === 2 ? { ref: ref() } : usage()),
    // --stdin alone takes the text from stdin (read below, before any daemon is touched); with a value,
    // text words or text after -- it is a usage error. Any other word starting with -- would be read as
    // an option and dropped: refused (unnamed, it may be part of the text), and text after a bare -- is
    // taken whole
    type: () => (Object.hasOwn(flags, 'stdin') && Object.keys(flags).length === 1 ? (flags.stdin === true && n === 2 && rest === null ? { ref: ref(), stdin: true } : usage())
      : Object.keys(flags).length ? die("browser type: a word starting with -- can't be typed as it stands; put the text after a bare --: browser type <ref> -- <text>")
      : rest !== null ? (n === 2 && rest.length ? { ref: ref(), text: rest.join(' ') } : usage()) : n >= 3 ? { ref: ref(), text: positional.slice(2).join(' ') } : usage()),
    press: () => (n === 2 && browserKeyOk(positional[1]) ? { key: positional[1] } : die(BROWSER_KEY_LIST)),
    scroll: () => (n === 2 && ['up', 'down'].includes(positional[1]) ? { dir: positional[1] } : usage()),
    back: () => (n === 1 ? {} : usage()),
    tabs: () => (n === 1 ? {} : usage()),
    tab: () => (n === 2 && /^[1-9]\d{0,2}$/.test(positional[1]) ? { n: Number(positional[1]) } : die('browser tab takes a tab number (browser tabs lists them)')),
    screenshot: () => (n === 1 && flags.out !== true ? { out: flagStr('out') === undefined ? undefined : path.resolve(flagStr('out')) } : usage()),
  }[verb]();
  if (send.stdin) {
    const text = await browserReadStdin({ max: 65536, ms: Number(browserTestEnv('DEVTEAM_TEST_BROWSER_STDIN_MS')) || 30000 });
    if (!text) usage();
    send = { ref: send.ref, text };
  }
  const s = await browserEnsure();
  let r;
  try { r = await browserCall(verb, send, { state: s }); } catch (e) { die(`browser ${verb}: ${e.message}`); }
  if (r.code === 0) return out(r.out);
  process.stderr.write(`${r.out}\n`);
  process.exitCode = r.code;
}
/* browser end */

