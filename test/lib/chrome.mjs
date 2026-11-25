// Real headless Chrome, driven over the DevTools Protocol: real mouse and key events, for what a
// synthetic DOM event can't show (where focus goes, what a space bar scrolls). A machine with no
// Chrome, or a Node with no WebSocket (before 22), skips what needs it.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const found = () => {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (fs.existsSync(mac)) return mac;
  for (const c of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) { const r = spawnSync('sh', ['-c', `command -v ${c}`], { encoding: 'utf8' }); if (r.status === 0) return r.stdout.trim(); }
  return null;
};
export const chromePath = found();
export const canDrive = !!chromePath && typeof WebSocket === 'function';

// 'an alert', 'a confirm': a dialog's type with its article
const an = (w) => `${/^[aeiou]/.test(w) ? 'an' : 'a'} ${w}`;
const KEYS = { Tab: 9, Enter: 13, Escape: 27, ' ': 32, ArrowLeft: 37, ArrowRight: 39 };
const CODES = { ' ': 'Space' };

// What openChrome starts Chrome with. The second line keeps each browser small on a shared machine:
// at most two renderer processes, no extensions, component updates or background requests, and a
// 256 MB JavaScript heap per renderer.
export const chromeArgs = (profile) => [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--remote-debugging-port=0',
  '--renderer-process-limit=2', '--disable-extensions', '--disable-component-update', '--disable-background-networking', '--js-flags=--max-old-space-size=256',
  'about:blank',
];

export async function openChrome() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-chrome-'));
  // Its own process group, so its helpers go with it: one left holding the stderr pipe open keeps this
  // test process (and the job) alive after every test has finished.
  // Chrome's own temp folders (org.chromium.Chromium.*) go in a short folder of this browser's, removed
  // with it: a killed Chrome leaves them, and loose in the machine's temp folder they piled up by the
  // thousand. Short: a socket's path is capped, so not inside the profile.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dc'));
  const proc = spawn(chromePath, chromeArgs(profile), { stdio: ['ignore', 'ignore', 'pipe'], detached: true, env: { ...process.env, TMPDIR: tmp } });
  const signal = (sig) => { try { process.kill(-proc.pid, sig); } catch { try { proc.kill(sig); } catch {} } };
  const atExit = () => { signal('SIGKILL'); for (const d of [profile, tmp]) try { fs.rmSync(d, { recursive: true, force: true }); } catch {} };
  process.once('exit', atExit);
  const base = await new Promise((resolve, reject) => {
    let err = '';
    const failing = setTimeout(() => { signal('SIGKILL'); reject(new Error(`chrome said nothing for 60 s: ${err.slice(0, 400)}`)); }, 60000);
    proc.stderr.on('data', (b) => { err += b; const m = err.match(/DevTools listening on ws:\/\/([^/]+)\//); if (m) { clearTimeout(failing); resolve(`http://${m[1]}`); } });
    proc.on('exit', () => { clearTimeout(failing); reject(new Error(`chrome exited: ${err.slice(0, 400)}`)); });
  });
  // from here nothing about the browser holds this process open, whatever a test does or doesn't close
  proc.unref();
  proc.stderr.unref();
  let closing = null;
  // A timer is pending for as long as close() is: SIGKILL at 3 s, then a 5 s bound on the exit. Chrome
  // and its stderr are unref'd, so without one a Chrome slow to act on SIGTERM would let this process's
  // event loop empty while close() waits for its exit, and node would cancel every test left in the
  // file. If even SIGKILL brings no exit in 5 s, close() ends anyway.
  const close = () => (closing ??= new Promise((r) => {
    let last = null;
    const hard = setTimeout(() => { signal('SIGKILL'); last = setTimeout(done, 5000); }, 3000);
    function done() {
      clearTimeout(hard);
      clearTimeout(last);
      signal('SIGKILL'); // whatever helpers outlived it
      process.off('exit', atExit);
      proc.off('exit', done);
      proc.stderr.destroy();
      for (const d of [profile, tmp]) try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
      r();
    }
    // 'exit', not 'close': Chrome's helpers can hold its stderr open after it is gone
    if (proc.exitCode !== null || proc.signalCode !== null) return done();
    proc.once('exit', done);
    signal('SIGTERM');
  }));
  // The JS dialogs open on this browser's tabs, by target id (a page with Page.enable is told of
  // them): one holds its tab, and every tab its renderer runs, until it is answered, and nothing here
  // answers one. Kept after this side's socket to the tab closes (the tab and its dialog stay: a test
  // that gave up on a tab and dropped it, say), until Chrome's list no longer has the tab.
  const dialogs = new Map();
  // What Chrome was doing when a call on tab tid got no answer. Each look at Chrome's own endpoint is
  // raced with a second or two, and all of them with 6 s, so a Chrome that answers nothing still lets
  // the call fail soon; what was seen by then is said, and a look that failed says how.
  const whatChromeDid = async (tid, heard) => {
    const out = [];
    const stop = new AbortController();
    let b = null;
    const within = (ms, p) => { let t; return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(new Error(`no answer in ${ms / 1000} s`)), ms); })]).finally(() => clearTimeout(t)); };
    const ago = (at) => `${((Date.now() - at) / 1000).toFixed(1)} s`;
    const looks = (async () => {
      const tab = out.push(`tab ${tid.slice(0, 8)}`) - 1;
      const open = out.length;
      // each dialog still open, said after the tab
      const said = () => out.splice(open, 0, ...[...dialogs].map(([id, d]) => `${an(d.type)} dialog (${JSON.stringify(String(d.message).slice(0, 80))}, at ${d.url}) open on ${id === tid ? 'this tab' : `tab ${id.slice(0, 8)}`} for ${ago(d.at)}`));
      out.push(`last heard on its socket: ${heard.length ? heard.slice(-4).map((h) => `${h.what} ${ago(h.at)} ago`).join(', ') : 'nothing'}`);
      out.push(proc.exitCode !== null || proc.signalCode !== null ? `Chrome exited (${proc.exitCode ?? proc.signalCode})` : 'Chrome running');
      try {
        const list = await within(2000, fetch(`${base}/json/list`, { signal: stop.signal }).then((r) => r.json()));
        const t = list.find((x) => x.id === tid);
        out[tab] += t ? ` at ${t.url}` : ' not listed (closed or crashed)';
        // a dialog whose tab is gone went with it
        const ids = new Set(list.map((x) => x.id));
        for (const id of dialogs.keys()) if (!ids.has(id)) dialogs.delete(id);
        said();
      } catch (e) { out[tab] += ` (Chrome's list of tabs: ${e.message})`; said(); }
      const v = await within(2000, fetch(`${base}/json/version`, { signal: stop.signal }).then((r) => r.json()));
      b = new WebSocket(v.webSocketDebuggerUrl);
      await within(2000, new Promise((ok, no) => { b.onopen = ok; b.onerror = () => no(new Error('could not reach it')); }));
      let n = 0;
      const calls = new Map();
      b.onmessage = (m) => { const o = JSON.parse(m.data); const c = calls.get(o.id); if (!c) return; calls.delete(o.id); if (o.error) c.no(new Error(o.error.message)); else c.ok(o.result); };
      const call = (ms, method, params = {}, sessionId) => within(ms, new Promise((ok, no) => { const id = ++n; calls.set(id, { ok, no }); b.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) })); }));
      const cpu = () => call(1000, 'SystemInfo.getProcessInfo').then((r) => new Map(r.processInfo.filter((p) => p.type === 'renderer').map((p) => [p.id, p.cpuTime])), () => null);
      const c0 = await cpu();
      const t0 = Date.now();
      // a second session on the same tab (closing the socket below ends it): does the page answer anyone?
      try {
        const { sessionId } = await call(1000, 'Target.attachToTarget', { targetId: tid, flatten: true });
        const t = Date.now();
        out.push(await call(2000, 'Runtime.evaluate', { expression: '1', returnByValue: true }, sessionId).then(() => `its page answers a second session in ${Date.now() - t} ms`, (e) => `its page gives a second session ${e.message}`));
      } catch (e) { out.push(`a second session: ${e.message}`); }
      const c1 = await cpu();
      const s = (Date.now() - t0) / 1000;
      out.push(c0 && c1 ? `renderers: ${[...c1].map(([pid, c]) => `${pid} ${c0.has(pid) ? `${Math.round(((c - c0.get(pid)) / s) * 100)}% cpu` : 'new'}`).join(', ') || 'none'}` : 'renderers: no process info');
    })().catch((e) => { out.push(`Chrome's endpoint: ${e.message}`); });
    let cut;
    await Promise.race([looks, new Promise((r) => { cut = setTimeout(() => r(out.push('diagnosis cut at 6 s')), 6000); })]);
    clearTimeout(cut);
    stop.abort();
    try { b?.close(); } catch {}
    return out.join('; ');
  };
  const newPage = async () => {
    const target = await (await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('could not reach the page')); });
    let seq = 0;
    const waiting = new Map();
    // each call's method by its id until answered (one answered after its call gave up is "late"), and
    // the last six things the socket brought, for what a call with no answer says
    const names = new Map();
    const heard = [];
    // the page's script worlds by origin (Runtime.enable sends them), for evIn: a frame of another origin is out of its parent's reach
    const worlds = new Map();
    ws.onmessage = (m) => { const o = JSON.parse(m.data);
      heard.push({ what: o.method === 'Page.javascriptDialogOpening' ? `${an(o.params.type)} dialog` : o.method ?? `the answer to ${names.get(o.id) ?? o.id}${waiting.has(o.id) ? '' : ' (late)'}`, at: Date.now() });
      if (heard.length > 6) heard.shift();
      names.delete(o.id);
      if (o.method === 'Runtime.executionContextCreated' && o.params.context.auxData?.isDefault) worlds.set(o.params.context.id, o.params.context.origin);
      else if (o.method === 'Runtime.executionContextDestroyed') worlds.delete(o.params.executionContextId);
      else if (o.method === 'Runtime.executionContextsCleared') worlds.clear();
      else if (o.method === 'Page.javascriptDialogOpening') dialogs.set(target.id, { ...o.params, at: Date.now() });
      else if (o.method === 'Page.javascriptDialogClosed') dialogs.delete(target.id);
      const w = waiting.get(o.id); if (!w) return; waiting.delete(o.id); if (o.error) w.reject(new Error(`${w.method}: ${o.error.message}`)); else w.resolve(o.result); };
    // A page that stops answering fails the call: an await nobody will ever settle hangs the run.
    // the page's socket gone (Chrome died or closed it): every call still waiting fails, saying so
    let ended = null;
    ws.onclose = (e) => {
      ended = `Chrome's page connection closed (code ${e.code}${e.reason ? `, ${e.reason}` : ''}${proc.exitCode !== null || proc.signalCode !== null ? `; Chrome exited: ${proc.exitCode ?? proc.signalCode}` : ''})`;
      for (const [id, w] of waiting) { waiting.delete(id); w.reject(new Error(`${w.method}: ${ended}`)); }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      if (ended) return reject(new Error(`${method}: ${ended}`));
      const id = ++seq;
      names.set(id, method);
      // no answer in 30 s: the call fails once (never sent again), saying what Chrome was doing
      const timer = setTimeout(() => { waiting.delete(id); whatChromeDid(target.id, heard).catch((e) => `what Chrome was doing is unknown: ${e.message}`).then((why) => reject(new Error(`${method}: no answer from Chrome in 30 s; ${why}`))); }, 30000);
      timer.unref();
      const settled = (f) => (v) => { clearTimeout(timer); f(v); };
      waiting.set(id, { resolve: settled(resolve), reject: settled(reject), method });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const ev = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`${expression}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    };
    // ev, in the newest page of that origin (a frame under a page of another one)
    const evIn = async (origin, expression) => {
      // newest first, and one that is really at that origin: a frame's first, empty document has a world of its own
      for (const id of [...worlds].filter(([, o]) => o === origin).map(([i]) => i).reverse()) {
        const at = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true, contextId: id }).catch(() => null);
        if (!String(at?.result?.value).startsWith(origin)) continue;
        const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, contextId: id });
        if (r.exceptionDetails) throw new Error(`${expression}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
        return r.result.value;
      }
      throw new Error(`no page of ${origin} yet`);
    };
    const key = async (k, modifiers = 0) => {
      const printable = k.length === 1;
      const common = { key: k, code: CODES[k] ?? (printable ? `Key${k.toUpperCase()}` : k), modifiers, windowsVirtualKeyCode: KEYS[k] ?? k.toUpperCase().charCodeAt(0) };
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...common, ...(printable ? { text: k } : {}) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
    };
    const type = async (text) => { for (const c of text) await key(c); };
    // A click in the middle of whatever the selector finds, brought into view first.
    const click = async (selector) => {
      const at = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', clickCount: 1 });
    };
    // A key held down or let go (Shift: modifiers 8), the middle of what a selector finds, and the
    // mouse there with modifiers: a Shift+click is a press and release with modifiers 8.
    const hold = (k, down) => send('Input.dispatchKeyEvent', { type: down ? 'rawKeyDown' : 'keyUp', key: k, code: `${k}Left`, windowsVirtualKeyCode: { Shift: 16, Alt: 18, Control: 17 }[k], modifiers: down ? { Shift: 8, Alt: 1, Control: 2 }[k] : 0 });
    const at = (selector) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const move = (x, y, modifiers = 0) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers });
    const clickAt = async (x, y, modifiers = 0) => {
      await move(x, y, modifiers);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, modifiers, button: 'left', buttons: 1, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, modifiers, button: 'left', buttons: 0, clickCount: 1 });
    };
    return { send, ev, evIn, key, type, click, hold, at, move, clickAt, close: () => ws.close() };
  };
  // pid: the leader of Chrome's process group; proc, its ChildProcess, for a test of close() itself; tmp, its own temp folder (TMPDIR), removed by close()
  return { newPage, close, pid: proc.pid, proc, tmp };
}

// A test's teardown, run last-registered first, each step on its own: a folder's removal registered
// first runs after every stop, and one step that throws skips none of the others (node runs t.after
// hooks in the order they were registered, and stops at the first that throws). The first error is
// thrown once every step has run. const later = cleanup(t); later(() => dash.stop());
export function cleanup(t) {
  const fns = [];
  t.after(async () => {
    let first = null;
    for (const f of fns.reverse()) { try { await f(); } catch (e) { first ??= e; } }
    if (first) throw first;
  });
  return (f) => { fns.push(f); };
}
