// A fake of the terminal routes (terminal@1, test/contracts/terminal.md §14), for the page's tests:
// it answers every /api/term/* route from a scripted screen, with the contract's guards checked in
// the contract's order (§3), one post at a time per pane, the last seq kept per page and which, and
// typed bytes echoed into its screen. It never runs tmux, verifies no gateway signature, takes no
// lock and keeps no floor. Node built-ins only.
import crypto from 'node:crypto';
import http from 'node:http';

export const WHYS = ['view', 'not-loopback', 'cross-site', 'relay', 'host'];

const CAP = 102400;
const DATA_MAX = 4096;
const PASTE_MAX = 65536;
const DEFAULT_HELD = Object.freeze({ count: 0, oldest_ms: 0, prompt: 'readable' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startTermFake(opts = {}) {
  const o = {
    cols: 80, rows: 24, lines: [], shell: true, supervisor: 'live', pane: '%1', bracketPaste: false,
    held: DEFAULT_HELD, refuse: null, gatewayView: false, busy: false, history: [], sendMs: 0, serve: null, shellPane: '%2', openFails: false,
    ...opts,
  };
  const token = crypto.randomBytes(32).toString('hex');
  const term = (lines, history) => ({ buf: [...lines], cx: 0, cy: 0, history: [...history], typed: [] });
  const t = { supervisor: term(o.lines, o.history), shell: term([], []) };
  let shellOpen = o.shell !== false;
  let shellSize = { cols: 80, rows: 24 };
  const last = new Map();
  const chain = { supervisor: Promise.resolve(), shell: Promise.resolve() };
  let port = 0;

  const live = (which) => (which === 'supervisor' ? o.supervisor === 'live' : shellOpen);
  const size = (which) => (which === 'supervisor' ? { cols: o.cols, rows: o.rows } : shellSize);
  const paneOf = (which) => (which === 'supervisor' ? o.pane : o.shellPane);
  const heldOf = (which) => ({ ...(which === 'supervisor' ? o.held : DEFAULT_HELD) });
  function rowsOf(which) {
    const s = t[which];
    const { rows } = size(which);
    while (s.buf.length < rows) s.buf.push('');
    while (s.buf.length > rows) s.history.push(s.buf.shift());
    if (s.cy >= rows) s.cy = rows - 1;
    return s.buf;
  }
  function screenOf(which) {
    const held = heldOf(which);
    const base = live(which)
      ? {
        v: 1, which, pane: paneOf(which), state: 'live', ...size(which),
        cursor: { x: t[which].cx, y: t[which].cy, visible: true }, modes: { app_cursor: false, app_keypad: false },
        history_size: t[which].history.length, held, lines: rowsOf(which).map((l) => l.trimEnd()),
      }
      : {
        v: 1, which, pane: null, state: 'gone', cols: 0, rows: 0, cursor: { x: 0, y: 0, visible: false },
        modes: { app_cursor: false, app_keypad: false }, history_size: 0, held, lines: [],
      };
    // every field but held.oldest_ms, which counts in its place only once the waiting note is due (§6)
    const tagged = { ...base, held: { ...held, oldest_ms: held.oldest_ms >= 120000 } };
    return { ...base, etag: crypto.createHash('sha1').update(JSON.stringify(tagged)).digest('hex') };
  }
  // The echo (§14): a printable character at the cursor, \r (or a paste's \n) to the next row, \x7f erasing one.
  function draw(which, text) {
    const s = t[which];
    const { cols, rows } = size(which);
    const buf = rowsOf(which);
    const nl = () => { s.cx = 0; s.cy += 1; if (s.cy >= rows) { s.history.push(buf.shift()); buf.push(''); s.cy = rows - 1; } };
    let esc = 0; // 0 none, 1 after ESC, 2 inside a CSI sequence, 3 the one character after ESC O
    for (const ch of text) {
      if (esc === 1) { esc = ch === '[' ? 2 : ch === 'O' ? 3 : 0; continue; }
      if (esc === 3) { esc = 0; continue; }
      if (esc === 2) { if (ch >= '@' && ch <= '~') esc = 0; continue; }
      if (ch === '\x1b') { esc = 1; continue; }
      if (ch === '\r' || ch === '\n') nl();
      else if (ch === '\x7f') { if (s.cx > 0) { s.cx -= 1; const l = buf[s.cy]; buf[s.cy] = l.slice(0, s.cx) + l.slice(s.cx + 1); } }
      else if (ch >= ' ' && ch !== '\x7f' && !(ch.codePointAt(0) >= 0x80 && ch.codePointAt(0) <= 0x9f)) {
        const l = buf[s.cy].padEnd(s.cx, ' ');
        buf[s.cy] = l.slice(0, s.cx) + ch + l.slice(s.cx + 1);
        s.cx += 1;
        if (s.cx >= cols) nl();
      }
    }
  }

  const NO_STORE = { 'cache-control': 'no-store' };
  const sendJson = (res, status, obj) => { res.writeHead(status, { 'content-type': 'application/json', ...NO_STORE }); res.end(JSON.stringify(obj)); };
  const tokenOk = (got) => { if (typeof got !== 'string') return false; const a = Buffer.from(got), b = Buffer.from(token); return a.length === b.length && crypto.timingSafeEqual(a, b); };
  const jsonType = (ct) => String(ct ?? '').split(';')[0].trim().toLowerCase() === 'application/json';
  const readBody = (req) => new Promise((resolve) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => { n += c.length; if (n > 4 * CAP) { req.destroy(); resolve(null); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
  // The routes and their methods; anything else under /api/term/ is 404 (§4).
  function route(pathname) {
    if (pathname === '/api/term/token') return { name: 'token', method: 'GET' };
    if (pathname === '/api/term/shell/open') return { name: 'open', method: 'POST', which: 'shell' };
    const m = /^\/api\/term\/(supervisor|shell)\/(screen|history|keys)$/.exec(pathname);
    if (!m) return null;
    return { name: m[2], method: m[2] === 'keys' ? 'POST' : 'GET', which: m[1] };
  }
  // host, then relay: the dashboard's global guards, before any routing (§3 step 1)
  function globalWhy(req) {
    if (o.refuse === 'host' || o.refuse === 'relay') return o.refuse;
    const host = req.headers.host;
    if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host)) return 'host';
    if (req.headers['x-devteam-relay'] !== undefined) return 'relay';
    return null;
  }
  function whyOf(req, r) {
    if (req.headers['x-devteam-level'] === 'view') return 'view';
    if (o.refuse) return o.refuse;
    const host = req.headers.host;
    const site = req.headers['sec-fetch-site'];
    if (r.name === 'token') return site === 'same-origin' ? null : 'cross-site';
    if (r.method === 'GET') return site === undefined || site === 'same-origin' ? null : 'cross-site';
    return site === 'same-origin' && req.headers.origin === `http://${host}` ? null : 'cross-site';
  }
  const shapeOk = {
    keys(b, which) {
      const ks = Object.keys(b).sort().join(',');
      if (ks !== 'data,page,pane,seq,token,which' && ks !== 'page,pane,paste,seq,token,which') return false;
      if (b.which !== which || typeof b.pane !== 'string' || !/^%\d+$/.test(b.pane)) return false;
      if (typeof b.page !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(b.page) || !Number.isSafeInteger(b.seq) || b.seq < 1) return false;
      if ('data' in b) return typeof b.data === 'string' && /^(?:[0-9a-fA-F]{2})+$/.test(b.data);
      return typeof b.paste === 'string' && b.paste.length > 0;
    },
    open(b) {
      const ks = Object.keys(b).sort().join(',');
      return ks === 'cols,page,rows,token,which' && b.which === 'shell' && typeof b.page === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(b.page)
        && Number.isInteger(b.cols) && b.cols >= 20 && b.cols <= 500 && Number.isInteger(b.rows) && b.rows >= 5 && b.rows <= 200;
    },
  };
  // One post at a time per pane, in arrival order (§8).
  const queue = (which, f) => { const p = chain[which].then(f); chain[which] = p.then(() => {}, () => {}); return p; };

  async function keys(res, which, b) {
    if (!live(which)) return sendJson(res, 409, { error: which === 'supervisor' ? "the supervisor isn't running" : 'the shell is not open' });
    if (b.pane !== paneOf(which)) return sendJson(res, 423, { error: 'the terminal moved to another pane; reading it again' });
    const key = `${b.page}\n${which}`;
    if (b.seq <= (last.get(key) ?? 0)) return sendJson(res, 200, { ...screenOf(which), taken: false });
    if (which === 'supervisor' && o.busy) return sendJson(res, 503, { error: 'the terminal is busy; try again' });
    last.set(key, b.seq);
    const text = 'data' in b ? Buffer.from(b.data, 'hex').toString('latin1') : b.paste;
    t[which].typed.push('paste' in b && o.bracketPaste ? `\x1b[200~${text}\x1b[201~` : text);
    if (o.sendMs > 0) await sleep(o.sendMs);
    draw(which, text);
    return sendJson(res, 200, { ...screenOf(which), taken: true });
  }
  function open(res, b) {
    if (o.openFails && !shellOpen) return sendJson(res, 409, { error: 'the shell could not be opened' });
    shellSize = { cols: b.cols, rows: b.rows };
    shellOpen = true;
    return sendJson(res, 200, screenOf('shell'));
  }

  async function handle(req, res) {
    const u = new URL(req.url, 'http://fake');
    if (!u.pathname.startsWith('/api/term/')) {
      if (o.serve) return o.serve(req, res);
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
    }
    if (o.gatewayView) { req.resume(); res.writeHead(403, { 'content-type': 'application/json', ...NO_STORE }); return res.end('{"why":"view"}'); }
    const global = globalWhy(req);
    if (global) { req.resume(); return sendJson(res, 403, req.method === 'POST' ? { error: 'the terminal answers only on this page', why: global } : { why: global }); }
    const body = req.method === 'POST' ? await readBody(req) : Buffer.alloc(0);
    if (body === null) return;
    const r = route(u.pathname);
    if (!r) return sendJson(res, 404, { error: 'not found' });
    if (req.method !== r.method) return sendJson(res, 405, { error: 'not this method' });
    const why = whyOf(req, r);
    if (why) return sendJson(res, 403, r.method === 'GET' ? { why } : { error: 'the terminal answers only on this page', why });
    if (r.name === 'token') return sendJson(res, 200, { token });
    if (r.name === 'screen') {
      const s = screenOf(r.which);
      if (req.headers['if-none-match'] === `"${s.etag}"`) { res.writeHead(304, { etag: `"${s.etag}"`, ...NO_STORE }); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/json', etag: `"${s.etag}"`, ...NO_STORE });
      return res.end(JSON.stringify(s));
    }
    if (r.name === 'history') {
      const s = screenOf(r.which);
      const before = u.searchParams.get('before');
      const count = u.searchParams.get('count');
      if (!/^\d+$/.test(before ?? '') || !/^\d+$/.test(count ?? '')) return sendJson(res, 400, { error: 'missing or invalid before or count' });
      const n = Number(before), k = Number(count);
      if (n > s.history_size || k < 1 || k > 500) return sendJson(res, 400, { error: 'missing or invalid before or count' });
      const lines = live(r.which) ? t[r.which].history.slice(Math.max(0, n - k), n) : [];
      return sendJson(res, 200, { v: 1, which: r.which, pane: s.pane, before: n, history_size: s.history_size, lines });
    }
    // the two POSTs
    if (!jsonType(req.headers['content-type'])) return sendJson(res, 403, { error: 'the terminal answers only on this page' });
    if (body.length > CAP) return sendJson(res, 413, { error: 'that is too large to send' });
    let b;
    try { b = JSON.parse(body.toString('utf8')); } catch { return sendJson(res, 400, { error: 'that was not understood' }); }
    if (b === null || typeof b !== 'object' || Array.isArray(b)) return sendJson(res, 400, { error: 'that was not understood' });
    if (!tokenOk(b.token)) return sendJson(res, 403, { error: 'reload the page to type here' });
    if (!shapeOk[r.name](b, r.which)) return sendJson(res, 400, { error: 'that was not understood' });
    if (r.name === 'keys' && 'data' in b && b.data.length / 2 > DATA_MAX) return sendJson(res, 413, { error: 'that is too large to send' });
    if (r.name === 'keys' && 'paste' in b && Buffer.byteLength(b.paste, 'utf8') > PASTE_MAX) return sendJson(res, 413, { error: 'that is too large to paste' });
    return queue(r.which, () => (r.name === 'keys' ? keys(res, r.which, b) : open(res, b)));
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => { if (!res.headersSent) sendJson(res, 500, { error: String(e?.message ?? e) }); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    token,
    set(patch) {
      Object.assign(o, patch);
      if ('shell' in patch) shellOpen = patch.shell !== false;
      if ('lines' in patch) { t.supervisor.buf = [...patch.lines]; t.supervisor.cx = 0; t.supervisor.cy = 0; }
      if ('history' in patch) t.supervisor.history = [...patch.history];
    },
    screen: (which) => screenOf(which),
    typed: (which) => [...t[which].typed],
    close: () => new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); }),
  };
}
