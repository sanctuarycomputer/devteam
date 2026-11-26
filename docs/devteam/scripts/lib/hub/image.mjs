/* imports start */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { OPERATOR_PROOF_MS } from './operator.mjs';
import { SESSION_MARKERS } from '../sessions.mjs';
import { SHELLS } from '../sessions.mjs';
import { dashboardProofProblem } from '../sessions.mjs';
import { execFile } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { json } from '../base.mjs';
import { kitDir } from '../state.mjs';
import { mainRoot } from '../state.mjs';
import { markedPane } from '../log.mjs';
import { out } from '../base.mjs';
import { realPath } from '../state.mjs';
import { runDir } from '../state.mjs';
import { sha256 } from '../lens.mjs';
import { supervisorHeld } from '../panes.mjs';
import { supervisorUpRecord } from '../recover.mjs';
import { threadsNeedGateway } from './operator.mjs';
import { timedOut } from '../box-pins.mjs';
import { tmuxSession } from '../base.mjs';
import { typeLock } from '../log.mjs';
import { typeLockAsync } from '../log.mjs';
/* imports end */
// The port the box's image serves its own hub on (ENV DEVTEAM_IMAGE_HUB), a plain port or nothing. A
// dashboard whose hub port it names leaves the hub to the image; a project still on an older kit can
// take the port in the second the image's hub restarts, until it adopts this release.
export const imageHub = () => (/^\d+$/.test(process.env.DEVTEAM_IMAGE_HUB ?? '') ? Number(process.env.DEVTEAM_IMAGE_HUB) : null);
// The kit a dashboard runs (kit-288): the script Node loaded and the dashboard's own pages, scripts and
// styles. A print of them, by path: size and mtime from a stat, and the sha256 of the bytes, read again
// only for a file whose stat moved since prev. The project's files (project/, run/, its own code) are
// not in it: they never restart a dashboard.
export const kitWatched = (self) => {
  const dir = path.join(kitDir, 'dashboard');
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && /\.(html|js|css)$/.test(e.name)).map((e) => path.join(dir, e.name)); } catch {}
  return [self, ...names.sort()];
};
export function kitPrint(self, prev = new Map()) {
  const print = new Map();
  for (const f of kitWatched(self)) {
    let st;
    try { st = fs.statSync(f); } catch { continue; }
    const was = prev.get(f);
    if (was && was.size === st.size && was.mtime === st.mtimeMs) { print.set(f, was); continue; }
    let sha;
    try { sha = sha256(fs.readFileSync(f)); } catch { continue; }
    print.set(f, { size: st.size, mtime: st.mtimeMs, sha });
  }
  return print;
}
// The files two prints differ in (a sha, or there in one only), relative to the kit; a print's key.
export const kitPrintDiff = (a, b) => [...new Set([...a.keys(), ...b.keys()])].filter((f) => a.get(f)?.sha !== b.get(f)?.sha).map((f) => path.relative(kitDir, f).split(path.sep).join('/')).sort();
export const kitPrintKey = (p) => [...p].map(([f, v]) => `${f}\0${v.sha}`).sort().join('\n');
// How a dashboard whose kit changed hands over to the new code: 'exit' where something restarts it
// (DEVTEAM_DASHBOARD_RESTART=exit, or a while loop around it, as the box's image runs it), 'respawn'
// where it is its own tmux pane's process (a laptop's window: tmux runs the pane's command again),
// else 'stay' (nothing would start it again). The first that holds wins. A pane is respawned only when
// its process is this one, or the one shell running it: a dashboard a test or a probe started inside
// a worker's pane inherits that pane's TMUX_PANE, and must never respawn it.
export function kitHandOver() {
  const want = process.env.DEVTEAM_DASHBOARD_RESTART;
  if (want === 'off') return { how: 'stay', why: 'DEVTEAM_DASHBOARD_RESTART=off' };
  if (want === 'exit') return { how: 'exit' };
  let parent = '';
  try { parent = execFileSync('ps', ['-ww', '-o', 'args=', '-p', String(process.ppid)], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  // a shell running a command line (sh -c '…'), and that line runs the dashboard: never an agent or
  // anything else whose own arguments happen to hold the word
  const shellRunning = /^(\S*\/)?(sh|bash|dash|zsh|ksh|ash)\s+(-\S+\s+)*-\w*c\w*\s/.test(parent) && /\bdashboard\b/.test(parent);
  if (shellRunning && /\bwhile\b/.test(parent)) return { how: 'exit' };
  if (process.env.TMUX && process.env.TMUX_PANE) {
    let pid = null;
    try { pid = Number(execFileSync('tmux', ['display-message', '-p', '-t', process.env.TMUX_PANE, '#{pane_pid}'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch {}
    if (pid === process.pid || (pid === process.ppid && shellRunning)) return { how: 'respawn', pane: process.env.TMUX_PANE };
  }
  return { how: 'stay', why: 'no while loop runs it and it is not its own tmux pane' };
}
/* term-server start */
// The dashboard's terminal (terminal@1, test/contracts/terminal.md): the supervisor's pane and the
// project's Shell, read and typed into over /api/term/*. Sizes in bytes, times in ms.
export const TERM = { CAP: 102400, DATA_MAX: 4096, PASTE_MAX: 65536, HISTORY_MAX: 500, CACHE_MS: 100, SETTLE_MS: 50, TMUX_MS: 30000 };
// What the gateway signs for a terminal POST (§3): its own domain, the port, the path's which, and the body.
export const termSigned = (domain, which) => (p, ts, nonce, body) => Buffer.from(`${domain}\n${p}\n${which}\n${ts}\n${nonce}\n${sha256(body)}`);
export const TERM_LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
// What tmuxServerEnv() removes but TMUX_PANE (tmux sets it fresh for the new pane, and the shell
// needs it): the Shell's command unsets each, since a new window gets the tmux server's environment,
// never the calling client's (S7); its session markers are found at open, as sessionMarkerPrefix does.
export const TERM_SHELL_UNSET = ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_HUB_RECORD', 'DEVTEAM_CHANNEL'];
export const TERM_WORDS = { page: 'the terminal answers only on this page', token: 'reload the page to type here', shape: 'that was not understood', big: 'that is too large to send', paste: 'that is too large to paste', read: 'the terminal could not be read; try again', supervisor: "the supervisor isn't running", shell: 'the shell is not open', moved: 'the terminal moved to another pane; reading it again', sent: 'the keys may not all have reached the terminal; look at it before typing again', open: 'the shell could not be opened' };
// A refusal sent before its body is read drains it, but only so far: past 4 × CAP it is cut off.
export const termDrain = (req) => { if (req.complete) return; let n = 0; req.on('data', (c) => { if ((n += c.length) > 4 * TERM.CAP) req.destroy(); }); req.resume(); };
// The one-call read's display fields (§6), tab-separated; pid is the server's (S1).
export const TERM_FIELDS = ['pane_id', 'pane_width', 'pane_height', 'cursor_x', 'cursor_y', 'cursor_flag', 'keypad_cursor_flag', 'keypad_flag', 'history_size', 'pane_dead', 'pane_current_command', '@devteam-shell', 'session_name', 'pane_start_path', 'pid'];
// A paste without bracketed-paste markers: tmux passes them through, so one inside a paste would end its
// bracket early and the rest, an Enter too, would arrive typed. A drop can join two halves into a new
// one (ESC[20 ESC[201~ 0~), so each is dropped as it completes the output so far: one linear pass (each
// char pushed once, popped at most once; neither marker overlaps itself or the other), the same text as
// dropping them again until none is left, which is quadratic on nested markers.
export const termUnbracket = (s) => { const o = []; for (const c of s) { o.push(c); const n = o.length; if (c === '~' && n >= 6 && o[n - 6] === '\x1b' && o[n - 5] === '[' && o[n - 4] === '2' && o[n - 3] === '0' && (o[n - 2] === '0' || o[n - 2] === '1')) o.length = n - 6; } return o.join(''); };
// tmux's answer that the pane, or the server, isn't there; any other failure is not "gone" (P4)
export const TERM_MISSING = /can't find (pane|session|window)|no server running|error connecting to|no current/;
// A captured line as the page shows it (S10): SGR kept; a CSI, a string (OSC, DCS, SOS, PM, APC, to
// BEL or ESC \ or the line's end, so an OSC 8 link's URL never shows) and any other escape dropped
// (with its intermediates, so ESC ( B goes whole); then C0 and DEL; then trailing spaces.
export function termLine(s) {
  return s.replace(/\x1b(?:\[([0-9;:]*)m|\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]|[\]PX^_](?:[^\x07\x1b]|\x1b(?!\\))*(?:\x07|\x1b\\|$)|[\x20-\x2f]*[\s\S]?)/g, (m, sgr) => (sgr === undefined ? '' : m))
    // every ESC left opens a kept SGR
    .replace(/[\x00-\x1a\x1c-\x1f\x7f]/g, '').replace(/ +$/, '');
}
// The /api/term/* routes, for cmdDashboard: `port` a getter (the dashboard re-picks its port when the
// first is taken), `host` its bind address, `log` its own output (a refusal's reason, never a body).
export function termRoutes({ port, host, log }) {
  // tests only (P6): a longer cache, so a test can hold a read inside it
  const cacheMs = Number(process.env.DEVTEAM_TERM_CACHE_MS) || TERM.CACHE_MS;
  // read once, at the start: tmuxSession() may spawn synchronously, which a request never waits on
  const session = tmuxSession();
  const loopback = TERM_LOOPBACK.has(host);
  // the token's own input, so it is never a pane-answer token; valid until the server restarts
  const termSecret = crypto.randomBytes(32);
  const termToken = () => crypto.createHmac('sha256', termSecret).update('devteam-term-token-v1').digest('hex');
  const tokenOk = (t) => { if (typeof t !== 'string') return false; const a = Buffer.from(t), b = Buffer.from(termToken()); return a.length === b.length && crypto.timingSafeEqual(a, b); };
  // every terminal route's gateway nonces: each once, pruned after twice the window
  const nonces = new Map();
  const json = (res, status, obj, extra = {}) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra }); res.end(JSON.stringify(obj)); };
  // Every tmux call: async (no request blocks the server), -u (a C locale prints a format's tab as _; P1).
  const tmuxCall = (args, input = null) => new Promise((resolve) => {
    let child;
    try {
      child = execFile('tmux', ['-u', ...args], { encoding: 'utf8', timeout: TERM.TMUX_MS, maxBuffer: 64 * 1024 * 1024 }, (e, out, err) => {
        const timedOut = !!e?.killed;
        resolve({ ok: !e, out: out ?? '', err: err ?? '', timedOut, missing: !!e && !timedOut && typeof e.code === 'number' && TERM_MISSING.test(err ?? '') });
      });
    } catch (e) { return resolve({ ok: false, out: '', err: String(e?.message ?? e), timedOut: false, missing: false }); }
    child.stdin.on('error', () => {});
    child.stdin.end(typeof input === 'string' ? input : undefined);
  });
  const root = realPath(mainRoot);
  // the display's two lines (S14, S34): TERM_FIELDS, then the supervisor's held key's window and its
  // prompt-readable mark, kept off TERM_FIELDS; capture's rows follow
  const fmt = `${TERM_FIELDS.map((f) => `#{${f}}`).join('\t')}\n#{@devteam-prompt-readable}\t#{window_name}`;
  // the display line, by field name (a tab in the start path stays in it)
  const fieldsOf = (line) => { const v = line.split('\t'); const n = TERM_FIELDS.length; if (v.length > n) v.splice(n - 2, v.length - n + 1, v.slice(n - 2, -1).join('\t')); return Object.fromEntries(TERM_FIELDS.map((f, i) => [f, v[i] ?? ''])); };
  // the supervisor's: the marked pane only, as an id (S11)
  const marked = () => { const p = markedPane(runDir); return p && /^%\d+$/.test(p) ? p : null; };
  // the Shell's: remembered, else the lowest-numbered live pane of this session tagged with this root,
  // not the marked one (a dead one, kept by remain-on-exit, would shadow a live one; T5-1). A lookup
  // tmux failed (not "isn't there") is { error }, never no pane (P4).
  let shellPane = null;
  async function paneOf(which) {
    if (which === 'supervisor') return marked();
    if (shellPane) return shellPane;
    const got = await tmuxCall(['list-panes', '-s', '-t', `=${session}`, '-F', '#{pane_id}\t#{pane_dead}\t#{@devteam-shell}']);
    if (!got.ok) { if (got.missing) return null; log(`/api/term/shell: tmux failed: ${got.timedOut ? 'timed out' : got.err.trim()}`); return { error: TERM_WORDS.read }; }
    const m = marked();
    // the tag last, whole: a tab in a root stays in it
    const ids = got.out.split('\n').map((l) => l.split('\t')).map(([id, dead, ...tag]) => [id, dead, tag.join('\t')]).filter(([id, dead, tag]) => /^%\d+$/.test(id) && dead === '0' && tag === root && id !== m).map(([id]) => id);
    return (shellPane = ids.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))[0] ?? null);
  }
  // held (§6): the Shell's, and a screen not read, is this; the supervisor's is read with each screen
  // (kit-618), from its window's held lines and its pane's prompt-readable mark. The etag covers only
  // whether oldest_ms is due.
  const held = () => ({ count: 0, oldest_ms: 0, prompt: 'readable' });
  // the keys route's 503 (§8, kit-618): the typing lock busy for 2 s, or the floor not recorded
  const busyWords = 'the terminal is busy; try again';
  const heldOf = (which, f, mark, win) => (which === 'supervisor' ? { ...supervisorHeld(`${f.session_name}:${win}`), prompt: mark ? 'readable' : 'unknown' } : held());
  const withEtag = (s, raw) => {
    const etag = sha256(JSON.stringify({ ...s, held: { ...s.held, oldest_ms: s.held.oldest_ms >= 120000 } })).slice(0, 20);
    // raw, the read's fields, for the keys route's 423s and 409s: never sent
    return Object.defineProperty({ ...s, etag }, 'raw', { value: raw, enumerable: false });
  };
  const gone = (which, raw = null) => withEtag({ v: 1, which, pane: null, state: 'gone', cols: 0, rows: 0, cursor: { x: 0, y: 0, visible: false }, modes: { app_cursor: false, app_keypad: false }, history_size: 0, held: held(), lines: [] }, raw);
  // Why the read pane isn't the route's, or null. Supervisor: resolvePane's checks, the tag, and a
  // noted id from another server (S1); shell: its tag, session, and never the marked pane.
  const notOurs = (which, f) => {
    if (f.pane_dead === '1') return 'dead';
    if (which === 'shell') return f['@devteam-shell'] !== root || f.session_name !== session || f.pane_id === marked() ? 'moved' : null;
    if (SHELLS.has(f.pane_current_command.replace(/^-/, ''))) return 'shell';
    if (f['@devteam-shell']) return 'tagged';
    const rec = supervisorUpRecord();
    return (rec?.server ? String(rec.server) !== f.pid : realPath(f.pane_start_path) !== root) ? 'foreign' : null;
  };
  // One call: display first, so its line is the first, then capture's rows (S16).
  async function readNow(which, again = true) {
    const P = await paneOf(which);
    if (P?.error) return P;
    if (!P) return gone(which, { pane: null, why: 'none' });
    const got = await tmuxCall(['display', '-p', '-t', P, fmt, ';', 'capture-pane', '-e', '-p', '-t', P]);
    if (!got.ok && !got.missing) { log(`/api/term/${which}: tmux failed: ${got.timedOut ? 'timed out' : got.err.trim()}`); return { error: TERM_WORDS.read }; }
    const out = got.ok ? got.out.split('\n') : [];
    if (out.length > 1 && out.at(-1) === '') out.pop();
    const f = got.ok ? fieldsOf(out[0]) : null;
    // a display line that didn't parse is a failed read, never a screen
    if (f && !(/^%\d+$/.test(f.pane_id) && /^\d+$/.test(f.pane_width) && /^\d+$/.test(f.pane_height))) { log(`/api/term/${which}: tmux's display line didn't parse`); return { error: TERM_WORDS.read }; }
    const why = f ? notOurs(which, f) : 'missing';
    // the Shell's pane moved or went: forget it, and look once more
    if (why && which === 'shell') { shellPane = null; if (again) return readNow(which, false); }
    const rows = Number(f?.pane_height ?? 0);
    // the screen is the last rows lines, so a newline in the window's name never shifts a row; the
    // second line is everything between: the mark, a tab, the window's name
    const top = Math.max(2, out.length - rows);
    const [mark = '', ...win] = out.slice(1, top).join('\n').split('\t');
    // the agent that read the prompt is gone: so is its reading (K3-1); a failed unset is read again next time
    if (which === 'supervisor' && (why === 'shell' || why === 'dead') && mark) {
      const unset = await tmuxCall(['set-option', '-p', '-u', '-t', P, '@devteam-prompt-readable']);
      if (!unset.ok) log(`/api/term/${which}: tmux failed to unset @devteam-prompt-readable: ${unset.timedOut ? 'timed out' : unset.err.trim()}`);
    }
    if (why) return gone(which, { pane: P, why, fields: f });
    const lines = out.slice(top, top + rows).map(termLine);
    while (lines.length < rows) lines.push('');
    return withEtag({
      v: 1, which, pane: f.pane_id, state: 'live', cols: Number(f.pane_width), rows,
      cursor: { x: Number(f.cursor_x), y: Number(f.cursor_y), visible: f.cursor_flag === '1' },
      modes: { app_cursor: f.keypad_cursor_flag === '1', app_keypad: f.keypad_flag === '1' },
      history_size: Number(f.history_size), held: heldOf(which, f, mark, win.join('\t')), lines,
    }, { pane: P, why: null, fields: f });
  }
  // Per which: the read in flight, shared, and its result for cacheMs. A send voids it and bumps the
  // generation, so a read begun before the send never fills the cache after it (S12); a failed read
  // is never cached.
  const screens = { supervisor: { gen: 0, at: 0, val: null, flight: null }, shell: { gen: 0, at: 0, val: null, flight: null } };
  function readScreen(which, { fresh = false } = {}) {
    const c = screens[which];
    if (!fresh && c.val && Date.now() - c.at < cacheMs) return Promise.resolve(c.val);
    if (!fresh && c.flight) return c.flight;
    const gen = c.gen;
    const p = readNow(which).then((s) => { if (c.gen === gen && !s.error) { c.val = s; c.at = Date.now(); } return s; })
      .finally(() => { if (c.flight === p) c.flight = null; });
    c.flight = p;
    return p;
  }
  const voidScreen = (which) => { const c = screens[which]; c.gen++; c.val = null; c.flight = null; };
  // History (§7): lines max(0, n - k) to n - 1, by offsets from history_size, with history_size read
  // after them in the same call; read once more if it moved.
  async function readHistory(P, n, k, hs) {
    for (let again = true; ; again = false) {
      const a = Math.max(0, n - k), b = n - 1;
      const got = await tmuxCall(['capture-pane', '-e', '-p', '-S', String(a - hs), '-E', String(b - hs), '-t', P, ';', 'display', '-p', '-t', P, '#{history_size}']);
      if (!got.ok && !got.missing) log(`/api/term/: tmux failed on history: ${got.timedOut ? 'timed out' : got.err.trim()}`);
      if (!got.ok) return got.missing ? { gone: true } : { error: TERM_WORDS.read };
      const out = got.out.split('\n');
      if (out.at(-1) === '') out.pop();
      const now = Number(out.pop());
      if (now === hs || !again || !Number.isInteger(now)) return { lines: out.map(termLine), hs };
      if (n > now) return { range: true };
      hs = now;
    }
  }
  // Keys (§8): one post at a time per pane, in arrival order; the last taken seq per page and which,
  // for the server's life (never pruned, so a late resend never types twice).
  const chains = { supervisor: Promise.resolve(), shell: Promise.resolve() };
  const queue = (which, f) => { const p = chains[which].then(f); chains[which] = p.then(() => {}, () => {}); return p; };
  const lastSeq = new Map();
  const sendData = (pane, buf) => tmuxCall(['send-keys', '-t', pane, '-H', ...[...buf].map((b) => b.toString(16).padStart(2, '0'))]);
  // A paste as one buffer, its text on stdin (never a file or an argument); a failed paste deletes its
  // buffer, so the text never stays in the tmux server.
  let buffers = 0;
  async function sendPaste(pane, text) {
    const name = `devteam-term-${process.pid}-${++buffers}`;
    const loaded = await tmuxCall(['load-buffer', '-b', name, '-'], text);
    const sent = loaded.ok ? await tmuxCall(['paste-buffer', '-p', '-d', '-b', name, '-t', pane]) : loaded;
    if (!sent.ok) {
      const gone = await tmuxCall(['delete-buffer', '-b', name]);
      // its name only, so the owner can delete it by hand; never its text
      if (!gone.ok && !/unknown buffer/.test(gone.err)) log(`/api/term/: tmux buffer ${name} kept after a failed paste; delete it with tmux delete-buffer -b ${name}`);
    }
    return sent;
  }
  // §3 steps 11 and 12, then the send, inside the pane's turn: against a read made in that turn, never
  // the cache (S2), so keys sent just after the supervisor exits find the shell prompt.
  async function keys(res, which, b, left) {
    const no = (status, error, reason) => { log(`refused /api/term/${which}/keys: ${reason}`); return json(res, status, { error }); };
    // checked at the turn's start and again just before the seq (the read can take a while): a refusal
    // before the send, so its seq stays free (§8)
    const went = () => left() && (log(`refused /api/term/${which}/keys: the client went before its turn`), true);
    if (went()) return;
    const s = await readScreen(which, { fresh: true });
    if (s.error) return json(res, 500, { error: s.error });
    // the pane step, in the spec's order (S3); a tagged or marked pane is never the other route's
    if (which === 'supervisor') {
      const { pane, fields } = s.raw;
      if (!pane) return no(409, TERM_WORDS.supervisor, 'no marked pane');
      if (b.pane !== pane) return no(423, TERM_WORDS.moved, 'not the marked pane');
      if (fields?.['@devteam-shell']) return no(423, TERM_WORDS.moved, 'the marked pane is the Shell\'s');
      if (s.state === 'gone') return no(409, TERM_WORDS.supervisor, `the marked pane is ${s.raw.why}`);
    } else {
      if (b.pane === marked()) return no(423, TERM_WORDS.moved, 'the marked pane is the supervisor\'s');
      if (s.state === 'gone') return no(409, TERM_WORDS.shell, 'no Shell pane');
      if (b.pane !== s.pane) return no(423, TERM_WORDS.moved, 'not the Shell\'s pane');
    }
    if (went()) return;
    const key = `${b.page}\n${which}`;
    if (b.seq <= (lastSeq.get(key) ?? 0)) return json(res, 200, { ...s, taken: false });
    const keysNow = async () => {
      // taken the moment the send starts: a send that fails part way is never typed again
      lastSeq.set(key, b.seq);
      return 'data' in b ? sendData(s.pane, Buffer.from(b.data, 'hex')) : sendPaste(s.pane, b.paste);
    };
    let sent;
    if (which === 'supervisor') {
      // §3 steps 13 and 14 (kit-618, §11): the pane's typing lock, then the owner's floor, then the
      // send, all in one hold. An Enter or a Ctrl+C ends the line (done); a paste, Escape or any other
      // key leaves it open. A refusal here keeps the seq free.
      const data = 'data' in b ? Buffer.from(b.data, 'hex') : null;
      const kind = data?.length && [0x0d, 0x03].includes(data[data.length - 1]) ? 'done' : 'open';
      const floor = () => tmuxCall(['set-option', '-p', '-t', s.pane, '@devteam-owner-floor', `${Date.now()} ${kind}`]);
      const locked = await typeLockAsync(s.pane, async () => {
        // the marked pane, again: it can have moved while the post waited for the lock
        if (marked() !== s.pane) return { refused: [423, TERM_WORDS.moved, 'the marked pane moved while the post waited for the typing lock'] };
        if (went()) return { gone: true };
        // the lock's stamp refreshed after each tmux call of the hold (spec, The lock; terminal@1 §11)
        const set = await floor();
        typeLock.touch();
        if (!set.ok) return { refused: [503, busyWords, `the owner's floor could not be recorded: ${set.timedOut ? 'timed out' : set.err.trim()}`] };
        const got = await keysNow();
        typeLock.touch();
        // stamped again once the keys reached tmux, so the settle runs from then; the first stands if not
        const again = await floor();
        typeLock.touch();
        if (!again.ok) log(`/api/term/${which}/keys: tmux failed to record the owner's floor again after the send: ${again.timedOut ? 'timed out' : again.err.trim()}`);
        return { sent: got };
      }, { waitMs: 2000 });
      if (locked.busy) return no(503, busyWords, 'the pane\'s typing lock stayed busy for 2 s');
      if (locked.value.refused) return no(...locked.value.refused);
      if (locked.value.gone) return;
      sent = locked.value.sent;
    } else sent = await keysNow();
    voidScreen(which);
    if (!sent.ok) { log(`/api/term/${which}/keys: tmux failed on the send: ${sent.timedOut ? 'timed out' : sent.err.trim()}`); return json(res, 500, { error: TERM_WORDS.sent }); }
    // the screen after the change: read until it differs, for up to SETTLE_MS; a failed read keeps the
    // last, so if every read fails the answer is the pre-send screen, taken: the keys went (their seq
    // is spent), and a 500 would tell the page they may not have; its next poll shows the change
    let now = s;
    for (const stop = Date.now() + TERM.SETTLE_MS; ;) {
      const got = await readScreen(which, { fresh: true });
      if (got.error) break;
      now = got;
      if (now.etag !== s.etag || Date.now() >= stop) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    return json(res, 200, { ...now, taken: true });
  }
  // Shell open (§9), inside the Shell's turn: the found pane (the read checks a remembered one, and
  // looks again if it moved), else a new window in this project's session, tagged; sized on every
  // call (the kit is the only one that sizes it); then the screen.
  async function openShell(res, b) {
    const failed = (status, reason) => { log(status === 409 ? `refused /api/term/shell/open: ${reason}` : `/api/term/shell/open: tmux failed: ${reason}`); return json(res, status, { error: TERM_WORDS.open }); };
    const why = (got) => (got.timedOut ? 'timed out' : got.err.trim());
    const s = await readScreen('shell', { fresh: true });
    if (s.error) return json(res, 500, { error: s.error });
    let pane = s.state === 'live' ? s.pane : null;
    if (!pane) {
      const has = await tmuxCall(['has-session', '-t', `=${session}`]);
      if (!has.ok) return has.missing ? failed(409, `no tmux session ${session}`) : failed(500, why(has));
      // the markers the new window would get: a failed read could miss one, so it is no open
      const envs = await Promise.all([['-g'], ['-t', `=${session}`]].map((a) => tmuxCall(['show-environment', ...a])));
      const bad = envs.find((e) => !e.ok);
      if (bad) return failed(bad.missing ? 409 : 500, why(bad));
      const markers = [...new Set(envs.flatMap((e) => e.out.split('\n')).map((l) => l.replace(/^-/, '').split('=')[0]).filter((k) => SESSION_MARKERS.test(k)))].sort();
      const ds = await tmuxCall(['show-options', '-gv', 'default-shell']);
      const shell = (ds.ok && ds.out.trim()) || '/bin/sh';
      const made = await tmuxCall(['new-window', '-d', '-P', '-F', '#{pane_id}', '-n', 'shell', '-c', root, '-t', `=${session}:`, 'env', ...[...TERM_SHELL_UNSET, ...markers].flatMap((k) => ['-u', k]), shell, '-l']);
      pane = made.out.trim();
      if (!made.ok || !/^%\d+$/.test(pane)) return failed(made.missing ? 409 : 500, made.ok ? `new-window answered ${JSON.stringify(pane)}` : why(made));
      const tagged = await tmuxCall(['set-option', '-p', '-t', pane, '@devteam-shell', root]);
      // an untagged window would never be found, and the next open would make another
      if (!tagged.ok) { await tmuxCall(['kill-pane', '-t', pane]); return failed(500, why(tagged)); }
    }
    const sized = await tmuxCall(['resize-window', '-t', pane, '-x', String(b.cols), '-y', String(b.rows)]);
    if (!sized.ok) { shellPane = null; return failed(sized.missing ? 409 : 500, why(sized)); }
    shellPane = pane;
    // a read begun before the open never fills the cache after it
    voidScreen('shell');
    const now = await readScreen('shell', { fresh: true });
    if (now.error) return json(res, 500, { error: now.error });
    if (now.state !== 'live') return failed(409, `the Shell's pane ${pane} went`);
    return json(res, 200, now);
  }
  function route(pathname) {
    if (pathname === '/api/term/token') return { name: 'token', method: 'GET' };
    if (pathname === '/api/term/shell/open') return { name: 'open', method: 'POST', which: 'shell' };
    const m = /^\/api\/term\/(supervisor|shell)\/(screen|history|keys)$/.exec(pathname);
    return m ? { name: m[2], method: m[2] === 'keys' ? 'POST' : 'GET', which: m[1] } : null;
  }
  // §3 step 3: view, not-loopback, cross-site, the first that applies
  function whyOf(req, r) {
    if (req.headers['x-devteam-level'] === 'view') return 'view';
    if (!loopback) return 'not-loopback';
    const site = req.headers['sec-fetch-site'];
    if (r.name === 'token') return site === 'same-origin' ? null : 'cross-site';
    if (r.method === 'GET') return site === undefined || site === 'same-origin' ? null : 'cross-site';
    return site === 'same-origin' && req.headers.origin === `http://${req.headers.host}` ? null : 'cross-site';
  }
  // Up to CAP kept; a body over it is read to its end (so the page reads the 413), one over 4 × CAP
  // cut off. A client that goes first (a destroyed slow body) settles it too, as gone.
  const readBody = (req) => new Promise((resolve) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > 4 * TERM.CAP) { chunks.length = 0; resolve({ cut: true }); return req.destroy(); }
      if (n <= TERM.CAP) chunks.push(c); else chunks.length = 0;
    });
    req.on('end', () => resolve(n > TERM.CAP ? { over: true } : { body: Buffer.concat(chunks) }));
    for (const ev of ['error', 'aborted', 'close']) req.on(ev, () => resolve({ gone: true }));
  });
  const jsonType = (ct) => String(ct ?? '').split(';')[0].trim().toLowerCase() === 'application/json';
  const PAGE = /^[A-Za-z0-9_-]{16,64}$/;
  const shapeOk = {
    keys(b, which) {
      const ks = Object.keys(b).sort().join(',');
      if (ks !== 'data,page,pane,seq,token,which' && ks !== 'page,pane,paste,seq,token,which') return false;
      if (b.which !== which || typeof b.pane !== 'string' || !/^%\d+$/.test(b.pane)) return false;
      if (typeof b.page !== 'string' || !PAGE.test(b.page) || !Number.isSafeInteger(b.seq) || b.seq < 1) return false;
      if ('data' in b) return typeof b.data === 'string' && /^(?:[0-9a-fA-F]{2})+$/.test(b.data);
      return typeof b.paste === 'string' && b.paste.length > 0;
    },
    open(b) {
      const ks = Object.keys(b).sort().join(',');
      return ks === 'cols,page,rows,token,which' && b.which === 'shell' && typeof b.page === 'string' && PAGE.test(b.page)
        && Number.isInteger(b.cols) && b.cols >= 20 && b.cols <= 500 && Number.isInteger(b.rows) && b.rows >= 5 && b.rows <= 200;
    },
  };
  // §3 step 10, on a box only: the gateway's proof, bound to this route, its which and this port
  function proofWhy(req, r, body) {
    const gw = (k) => { const v = req.headers[`x-devteam-gateway-${k}`]; return typeof v === 'string' ? v : null; };
    if (!(gw('ts') && gw('nonce') && gw('sig'))) return 'it carries no signature from the gateway';
    const proof = { port: port(), ts: gw('ts'), nonce: gw('nonce'), sig: gw('sig'), body: body.toString('base64') };
    const why = dashboardProofProblem(proof, termSigned(r.name === 'open' ? 'devteam-term-open-v1' : 'devteam-term-keys-v1', r.which)) ?? (nonces.has(proof.nonce) ? 'its signature was used already' : null);
    if (why) return why;
    const now = Date.now();
    for (const [n, at] of nonces) if (now - at > 2 * OPERATOR_PROOF_MS) nonces.delete(n);
    nonces.set(proof.nonce, now);
    return null;
  }
  async function serve(req, res, u) {
    const at = u.pathname.slice('/api/term/'.length);
    // a refusal: its reason to the dashboard's output, never a body
    const no = (status, obj, reason) => { log(`refused /api/term/${at}: ${reason ?? obj.why ?? obj.error}`); termDrain(req); return json(res, status, obj); };
    const r = route(u.pathname);
    if (!r) return no(404, { error: 'not found' });
    if (req.method !== r.method) return no(405, { error: 'not this method' });
    const why = whyOf(req, r);
    if (why) return no(403, r.method === 'GET' ? { why } : { error: TERM_WORDS.page, why });
    if (r.name === 'token') return json(res, 200, { token: termToken() });
    if (r.name === 'history') {
      // the shape (§7); before's top, history_size, is the screen read's
      const before = u.searchParams.get('before'), count = u.searchParams.get('count');
      if (!/^\d+$/.test(before ?? '') || !/^\d+$/.test(count ?? '') || Number(count) < 1 || Number(count) > TERM.HISTORY_MAX) return no(400, { error: 'missing or invalid before or count' });
      const n = Number(before), k = Number(count);
      const s = await readScreen(r.which);
      if (s.error) return json(res, 500, { error: s.error });
      const answer = (pane, hs, lines) => json(res, 200, { v: 1, which: r.which, pane, before: n, history_size: hs, lines });
      // before=0: nothing above it, no history call, live or gone (S8)
      if (n === 0) return answer(s.pane, s.history_size, []);
      if (s.state === 'gone' || n > s.history_size) return no(400, { error: 'before is past the screen\'s top' });
      const h = await readHistory(s.pane, n, k, s.history_size);
      if (h.error) return json(res, 500, { error: h.error });
      if (h.gone) { voidScreen(r.which); return no(400, { error: 'the pane is gone' }); }
      if (h.range) return no(400, { error: 'before is past the screen\'s top' });
      return answer(s.pane, h.hs, h.lines);
    }
    if (r.name === 'screen') {
      const s = await readScreen(r.which);
      if (s.error) return json(res, 500, { error: s.error });
      const etag = `"${s.etag}"`;
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { 'cache-control': 'no-store', etag }); return res.end(); }
      return json(res, 200, s, { etag });
    }
    // the two POSTs, §3 steps 4 to 10
    if (!jsonType(req.headers['content-type'])) return no(403, { error: TERM_WORDS.page }, 'not application/json');
    const got = await readBody(req);
    if (got.cut) return void log(`refused /api/term/${at}: a body far over the cap, cut off`);
    if (got.gone) return void log(`refused /api/term/${at}: the client went before its body ended`);
    if (got.over) return no(413, { error: TERM_WORDS.big }, 'a body over the cap');
    let b;
    try { b = JSON.parse(got.body.toString('utf8')); } catch { return no(400, { error: TERM_WORDS.shape }, 'not JSON'); }
    if (b === null || typeof b !== 'object' || Array.isArray(b)) return no(400, { error: TERM_WORDS.shape }, 'not a JSON object');
    if (!tokenOk(b.token)) return no(403, { error: TERM_WORDS.token }, 'a missing or wrong token');
    if (!shapeOk[r.name](b, r.which)) return no(400, { error: TERM_WORDS.shape }, 'not the route\'s shape');
    // once, with the shape (step 8), before the cap: the cap then measures what would be typed, and a
    // paste of markers only is the empty paste the shape refuses (400, §4's malformed body)
    if (r.name === 'keys' && 'paste' in b && !(b.paste = termUnbracket(b.paste))) return no(400, { error: TERM_WORDS.shape }, 'a paste of bracket markers only');
    if (r.name === 'keys' && 'data' in b && b.data.length / 2 > TERM.DATA_MAX) return no(413, { error: TERM_WORDS.big }, 'data over its cap');
    if (r.name === 'keys' && 'paste' in b && Buffer.byteLength(b.paste, 'utf8') > TERM.PASTE_MAX) return no(413, { error: TERM_WORDS.paste }, 'a paste over its cap');
    if (threadsNeedGateway()) { const p = proofWhy(req, r, got.body); if (p) return no(403, { error: TERM_WORDS.page }, p); }
    if (r.name === 'keys') {
      // a client that goes while its post waits (a timed-out gateway, a closed tab): its turn types
      // nothing, so a line the owner types again never arrives twice (B-2)
      let left = false;
      res.on('close', () => { left = true; });
      return queue(r.which, () => keys(res, r.which, b, () => left));
    }
    return queue('shell', () => openShell(res, b));
  }
  return {
    // any throw answers 500 and never ends the dashboard (S15)
    async handle(req, res, u) {
      try { await serve(req, res, u); } catch (e) {
        log(`/api/term/ failed: ${e?.message ?? e}`);
        if (!res.headersSent) json(res, 500, { error: String(e?.message ?? e) }); else res.destroy();
      }
    },
  };
}
/* term-server end */
