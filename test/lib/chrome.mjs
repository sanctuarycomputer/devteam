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

const KEYS = { Tab: 9, Enter: 13, Escape: 27, ' ': 32, ArrowLeft: 37, ArrowRight: 39 };
const CODES = { ' ': 'Space' };

export async function openChrome() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-chrome-'));
  // Its own process group, so its helpers go with it: one left holding the stderr pipe open keeps this
  // test process (and the job) alive after every test has finished.
  const proc = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  const signal = (sig) => { try { process.kill(-proc.pid, sig); } catch { try { proc.kill(sig); } catch {} } };
  const atExit = () => signal('SIGKILL');
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
  const close = () => (closing ??= new Promise((r) => {
    const hard = setTimeout(() => signal('SIGKILL'), 3000);
    const done = () => {
      clearTimeout(hard);
      signal('SIGKILL'); // whatever helpers outlived it
      process.off('exit', atExit);
      proc.stderr.destroy();
      try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
      r();
    };
    // 'exit', not 'close': Chrome's helpers can hold its stderr open after it is gone
    if (proc.exitCode !== null || proc.signalCode !== null) return done();
    proc.once('exit', done);
    signal('SIGTERM');
  }));
  const newPage = async () => {
    const target = await (await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('could not reach the page')); });
    let seq = 0;
    const waiting = new Map();
    ws.onmessage = (m) => { const o = JSON.parse(m.data); const w = waiting.get(o.id); if (!w) return; waiting.delete(o.id); if (o.error) w.reject(new Error(`${w.method}: ${o.error.message}`)); else w.resolve(o.result); };
    // A page that stops answering fails the call: an await nobody will ever settle hangs the run.
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`${method}: no answer from Chrome in 30 s`)); }, 30000);
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
    return { send, ev, key, type, click, close: () => ws.close() };
  };
  return { newPage, close };
}
