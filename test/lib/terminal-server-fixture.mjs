// What terminal-server.*.test.mjs share. The dashboard's terminal (kit-612, terminal@1): the
// supervisor's pane, read and typed into over /api/term. The fixture: a fleet, its session, a stand-in
// agent in a window of it, a dashboard whose tmux is a wrapper that logs each call's subcommands and
// can hold or fail the terminal's own calls.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { dashboardOnFreePort, fleetFixture, sessionOf, tmuxShim, until, write } from './kit.mjs';

// ---- the fixture ----
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export const SAME = { 'sec-fetch-site': 'same-origin' };
// A request with exactly these headers (Host too: <to>:<port> unless given), to <to> (127.0.0.1).
export function req(port, method, p, { headers = {}, body, to = '127.0.0.1' } = {}) {
  const h = Object.keys(headers).some((k) => k.toLowerCase() === 'host') ? headers : { host: `${to}:${port}`, ...headers };
  const data = body === undefined ? null : Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const r = http.request({ host: to, port, method, path: p, headers: h, setHost: false }, (res) => {
      const parts = [];
      res.on('data', (b) => parts.push(b));
      res.on('end', () => { const text = Buffer.concat(parts).toString('utf8'); let j = null; try { j = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, text, json: j }); });
      res.on('error', reject);
    });
    r.on('error', reject);
    r.end(data ?? undefined);
  });
}
export const post = (port, p, body, extra = {}, to = '127.0.0.1') => req(port, 'POST', p, { to, headers: { origin: `http://${to}:${port}`, 'content-type': 'application/json', ...extra }, body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) });

// The dashboard's tmux: logs each call's subcommands (never another argument) and its span, then runs
// the lib's shim by its path (PATH's tmux is this). tmux-delay.json holds, tmux-fail.json fails, a
// call whose subcommands joined with + are a key, so only the terminal's own calls are touched.
const WRAPPER = (base) => `#!${process.execPath}
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const base = ${JSON.stringify(base)};
const args = process.argv.slice(2), cmds = [];
for (let i = 0, head = true; i < args.length; i++) {
  const a = args[i];
  if (a === ';') { head = true; continue; }
  if (!head) continue;
  if (a === '-S' || a === '-L') { i++; continue; }
  if (a.startsWith('-')) continue;
  cmds.push(a); head = false;
}
const key = cmds.join('+');
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(base, f), 'utf8')); } catch { return {}; } };
const start = Date.now();
const log = () => fs.appendFileSync(path.join(base, 'tmux-calls'), JSON.stringify({ cmds, start, end: Date.now() }) + '\\n');
const hold = read('tmux-delay.json')[key];
if (hold) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, hold);
const fail = read('tmux-fail.json')[key];
if (fail) { log(); process.stderr.write(fail + '\\n'); process.exit(1); }
const r = spawnSync(${JSON.stringify(path.join(tmuxShim, 'tmux'))}, args, { stdio: 'inherit' });
log();
process.exit(r.status ?? 1);
`;

// The stand-in agent: raw stdin, its lines, every chunk kept in <dir>/bytes and echoed (printable
// bytes as themselves, \r as \r\n, nothing else), and <dir>/say printed and removed every 50 ms.
const AGENT = `import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2];
const lines = JSON.parse(fs.readFileSync(path.join(dir, 'lines.json'), 'utf8'));
if (process.stdin.isTTY) process.stdin.setRawMode(true);
for (const l of lines) process.stdout.write(l + '\\r\\n');
process.stdin.on('data', (d) => {
  fs.appendFileSync(path.join(dir, 'bytes'), d);
  const o = [];
  for (const b of d) if (b === 13) o.push(13, 10); else if ((b >= 0x20 && b < 0x7f) || b >= 0x80) o.push(b);
  if (o.length) process.stdout.write(Buffer.from(o));
});
setInterval(() => { const f = path.join(dir, 'say'); let t; try { t = fs.readFileSync(f); fs.rmSync(f); } catch { return; } process.stdout.write(t); }, 50);
fs.writeFileSync(path.join(dir, 'ready'), '');
`;

export function termFixture(name) {
  const F = fleetFixture(name);
  const root = F.old;
  const env = F.env({});
  const run = (args, role) => F.run(root, args, role);
  const tmux = (args) => spawnSync('tmux', args, { env, encoding: 'utf8' });
  const session = sessionOf(root, name);
  assert.equal(tmux(['new-session', '-d', '-x', '80', '-y', '24', '-s', session, '-n', 'main', '-c', root]).status, 0, 'the session');
  const wrapDir = path.join(F.base, 'wrap');
  write(path.join(wrapDir, 'tmux'), WRAPPER(F.base));
  fs.chmodSync(path.join(wrapDir, 'tmux'), 0o755);
  const calls = path.join(F.base, 'tmux-calls');
  const callLog = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const clearCalls = () => fs.rmSync(calls, { force: true });
  const exactly = (want) => callLog().filter((c) => c.cmds.length === want.length && c.cmds.every((x, i) => x === want[i])).length;
  const oneCallReads = () => exactly(['display', 'capture-pane']);
  const historyReads = () => exactly(['capture-pane', 'display']);
  const callSpans = (key) => callLog().filter((c) => c.cmds.join('+') === key).map(({ start, end }) => ({ start, end }));
  const dashEnv = (extra = {}) => ({ ...env, PATH: `${wrapDir}${path.delimiter}${env.PATH}`, ...extra });
  const dashes = [];
  const dashboard = async (args = [], extra = {}) => { const d = await dashboardOnFreePort(root, dashEnv(extra), args); dashes.push(d.dash); return d; };
  const runDir = path.join(root, 'docs/devteam/run');
  const standIn = ({ lines = [] } = {}) => {
    const dir = fs.mkdtempSync(path.join(F.base, 'pane-'));
    const agent = path.join(dir, 'agent.mjs');
    write(path.join(dir, 'lines.json'), JSON.stringify(lines));
    write(agent, AGENT);
    const made = tmux(['new-window', '-d', '-P', '-F', '#{pane_id}', '-t', `=${session}:`, '-n', 'sup', '-c', root, process.execPath, agent, dir]);
    assert.equal(made.status, 0, `the stand-in's window: ${made.stderr}`);
    const pane = made.stdout.trim();
    for (let i = 0; i < 300 && !fs.existsSync(path.join(dir, 'ready')); i++) sleepSync(100);
    assert.ok(fs.existsSync(path.join(dir, 'ready')), 'the stand-in started');
    write(path.join(runDir, 'supervisor-pane'), `${pane}\n`);
    write(path.join(runDir, 'supervisor-pane-role'), `${pane}\n`);
    const screen = () => tmux(['capture-pane', '-p', '-t', pane]).stdout ?? '';
    let n = 0;
    const say = async (text) => {
      const k = `say-${++n}`;
      const t = path.join(dir, 'say.tmp');
      fs.writeFileSync(t, `${text}\r\n${k}\r\n`);
      fs.renameSync(t, path.join(dir, 'say'));
      for (let i = 0; i < 100; i++) { if (screen().split('\n').some((l) => l.trim() === k)) return; await pause(100); }
      assert.fail(`the stand-in never showed ${k}`);
    };
    const bytes = () => { try { return fs.readFileSync(path.join(dir, 'bytes')); } catch { return Buffer.alloc(0); } };
    const received = async (min = 0) => {
      let last = bytes(), since = Date.now();
      for (const stop = Date.now() + 10000; Date.now() < stop; await pause(50)) {
        const b = bytes();
        if (!b.equals(last)) { last = b; since = Date.now(); } else if (b.length >= min && Date.now() - since >= 200) return b;
      }
      return bytes();
    };
    const exit = async () => {
      assert.equal(tmux(['respawn-pane', '-k', '-t', pane, 'sh']).status, 0, 'respawn-pane');
      await until(() => tmux(['display-message', '-p', '-t', pane, '#{pane_current_command}']).stdout?.trim() === 'sh', `${pane} running sh`);
    };
    const kill = () => { tmux(['kill-pane', '-t', pane]); };
    return { pane, dir, say, received, exit, kill };
  };
  const done = async () => { for (const d of dashes) await d.stop(); F.done(); };
  return { F, root, run, session, env, wrapper: path.join(wrapDir, 'tmux'), dashEnv, standIn, dashboard, callLog, clearCalls, oneCallReads, historyReads, callSpans, req, post, done };
}

// ---- the routes' guards (terminal@1 §2 to §4) ----
const JSON_TYPE = /^application\/json\b/;
const screenOf = async (T, port, which = 'supervisor', headers = {}) => { const r = await T.req(port, 'GET', `/api/term/${which}/screen`, { headers: { ...SAME, ...headers } }); return r; };
// until the screen's JSON passes f (the cache holds a read 100 ms)
const screenUntil = async (T, port, f, what, which = 'supervisor') => {
  let last;
  try { await until(async () => { last = await screenOf(T, port, which); return last.status === 200 && f(last.json); }, what); } catch (e) { assert.fail(`${e.message}; the last screen: ${last?.status} ${last?.text}`); }
  return last;
};
const tmuxOut = (T, args) => spawnSync('tmux', args, { env: T.env, encoding: 'utf8' }).stdout ?? '';
const GONE = { pane: null, state: 'gone', cols: 0, rows: 0, cursor: { x: 0, y: 0, visible: false }, modes: { app_cursor: false, app_keypad: false }, history_size: 0, held: { count: 0, oldest_ms: 0, prompt: 'readable' }, lines: [] };
const isGone = (j, which = 'supervisor') => { const { etag, ...rest } = j ?? {}; assert.match(etag ?? '', /^[0-9a-f]{20}$/); assert.deepEqual(rest, { v: 1, which, ...GONE }); return true; };

// ---- keys and paste (terminal@1 §3 steps 4 to 12, §8) ----
const PAGE_ID = 'page-0123456789abcdef';
const hex = (s) => Buffer.from(s, 'utf8').toString('hex');
const W = {
  page: 'the terminal answers only on this page', token: 'reload the page to type here', shape: 'that was not understood', big: 'that is too large to send', paste: 'that is too large to paste',
  down: "the supervisor isn't running", shut: 'the shell is not open', moved: 'the terminal moved to another pane; reading it again', sent: 'the keys may not all have reached the terminal; look at it before typing again',
};
const tokenOf = async (T, port) => { const r = await T.req(port, 'GET', '/api/term/token', { headers: SAME }); assert.equal(r.status, 200, r.text); return r.json.token; };
const keysBody = (token, pane, seq, more = { data: '61' }, which = 'supervisor') => ({ which, pane, page: PAGE_ID, seq, token, ...more });
const keysTo = (T, port, which, body, extra = {}) => T.post(port, `/api/term/${which}/keys`, body, { ...SAME, ...extra });
const openBody = (token) => ({ which: 'shell', page: PAGE_ID, cols: 80, rows: 24, token });
// a refusal (or a failure): its status, exactly { error } (and why, when given), never cached
const refusedWith = (r, status, error, what, why) => {
  assert.equal(r.status, status, `${what}: ${r.status} ${r.text}`);
  assert.match(r.headers['content-type'] ?? '', JSON_TYPE, what);
  assert.equal(r.headers['cache-control'], 'no-store', what);
  assert.deepEqual(r.json, why ? { error, why } : { error }, what);
};
// the terminal's sends so far, from the call log
const sends = (T) => T.callLog().filter((c) => c.cmds.some((x) => x === 'send-keys' || x === 'paste-buffer' || x === 'load-buffer')).length;
// what a post could change: the stand-in's bytes, the screen's etag (read fresh: past the 100 ms cache), the sends
const typedState = async (T, port, s) => { const bytes = String(await s.received()); await pause(120); const sc = await screenOf(T, port); assert.equal(sc.status, 200, sc.text); return { bytes, etag: sc.json.etag, sends: sends(T) }; };
const nothingTyped = async (T, port, s, base, what) => assert.deepEqual(await typedState(T, port, s), base, `${what}: nothing typed`);
const shellWindows = (T) => tmuxOut(T, ['list-windows', '-t', `=${T.session}`, '-F', '#{window_name}']).split('\n').filter((n) => n === 'shell').length;
const markPane = (T, pane) => { const run = path.join(T.root, 'docs/devteam/run'); write(path.join(run, 'supervisor-pane'), `${pane}\n`); write(path.join(run, 'supervisor-pane-role'), `${pane}\n`); };

export { hex, isGone, JSON_TYPE, keysBody, keysTo, markPane, nothingTyped, openBody, pause, refusedWith, screenOf, screenUntil, sends, shellWindows, tmuxOut, tokenOf, typedState, W };
