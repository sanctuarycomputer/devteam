// The dashboard's terminal (kit-612, terminal@1): the supervisor's pane, read and typed into over
// /api/term. The fixture: a fleet, its session, a stand-in agent in a window of it, a dashboard whose
// tmux is a wrapper that logs each call's subcommands and can hold or fail the terminal's own calls.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { kit, fleetFixture, sessionOf, dashboardOnFreePort, tmuxShim, until, write } from './lib/kit.mjs';

const DT_SRC = fs.readFileSync(path.join(kit, 'scripts/devteam.mjs'), 'utf8');
// one top-level declaration's source: a function to its closing brace, a const to its line's end
const fnSrc = (name) => { const i = DT_SRC.indexOf(`function ${name}(`); assert.ok(i >= 0, name); return DT_SRC.slice(i, DT_SRC.indexOf('\n}\n', i) + 2); };
const constSrc = (name) => { const i = DT_SRC.indexOf(`\nconst ${name} = `); assert.ok(i >= 0, name); return DT_SRC.slice(i + 1, DT_SRC.indexOf('\n', i + 1) + 1); };

// supervisorPaneIn alone, its tmux scripted: list-panes answers `listed`
// (its list-panes arguments kept on the function as .asked)
const paneIn = (listed) => {
  const asked = [];
  const c = vm.createContext({ path, realPath: (p) => p, tmuxServerPid: () => '1', sh: (cmd, args) => { if (args[0] !== 'list-panes') return null; asked.push([...args]); return listed; } });
  vm.runInContext(`${constSrc('SUPERVISOR_NOT_WINDOW')}${constSrc('AGENT_PANE_CMD')}${constSrc('SHELLS')}${fnSrc('supervisorPaneIn')}\nglobalThis.supervisorPaneIn = supervisorPaneIn;`, c);
  return Object.assign(c.supervisorPaneIn, { asked });
};

test('terminal A6: supervisorPaneIn skips a tagged pane', () => {
  const tagged = paneIn('%3\tmain\t/r\tnode\t/r\n');
  assert.equal(tagged('/r', null, null), null, 'a pane tagged @devteam-shell is no supervisor');
  assert.equal(tagged('/r', null, null, { strict: true }), null, 'nor strictly');
  assert.equal(tagged('/r', null, null, { notedOnly: true }), null, 'nor noted-only');
  assert.equal(tagged('/r', '%3', null), '%3', 'unless it is the noted pane');
  const untagged = paneIn('%3\tmain\t/r\tnode\t\n');
  assert.equal(untagged('/r', null, null), '%3', 'an untagged agent pane at the root still is');
  // the tag is the format's last field: a format without it reads every pane as untagged
  assert.ok(tagged.asked.length > 0);
  for (const a of tagged.asked) assert.ok(a[a.indexOf('-F') + 1].endsWith('\t#{@devteam-shell}'), `list-panes -F ${a[a.indexOf('-F') + 1]}`);
});

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

test('terminal fixture: a stand-in pane is marked, takes send-keys bytes, and the wrapper logs the call', async () => {
  const T = termFixture('term-fix');
  after(() => T.done());
  const s = T.standIn({ lines: ['stand-in ready'] });
  const run = path.join(T.root, 'docs/devteam/run');
  assert.match(s.pane, /^%\d+$/);
  assert.equal(fs.readFileSync(path.join(run, 'supervisor-pane'), 'utf8').trim(), s.pane);
  assert.equal(fs.readFileSync(path.join(run, 'supervisor-pane-role'), 'utf8').trim(), s.pane);
  const sent = spawnSync(T.wrapper, ['send-keys', '-t', s.pane, '-H', '61'], { env: T.dashEnv(), encoding: 'utf8' });
  assert.equal(sent.status, 0, sent.stderr);
  assert.equal(String(await s.received(1)), 'a');
  assert.deepEqual(T.callLog().map((c) => c.cmds), [['send-keys']]);
  assert.equal(T.callSpans('send-keys').length, 1);
  assert.equal(spawnSync('tmux', ['display-message', '-p', '-t', s.pane, '#{pane_current_command}'], { env: T.env, encoding: 'utf8' }).stdout.trim(), 'node', 'tmux reports the agent as node');
  write(path.join(T.F.base, 'tmux-delay.json'), JSON.stringify({ 'send-keys': 150 }));
  spawnSync(T.wrapper, ['send-keys', '-t', s.pane, '-H', '62'], { env: T.dashEnv() });
  const [, held] = T.callSpans('send-keys');
  assert.ok(held.end - held.start >= 150, 'a held call is held');
  assert.equal(String(await s.received(2)), 'ab');
  T.clearCalls();
  assert.deepEqual(T.callLog(), []);
  await s.say('hello there');
  write(path.join(T.F.base, 'tmux-fail.json'), JSON.stringify({ 'display+capture-pane': 'server exited unexpectedly' }));
  const failed = spawnSync(T.wrapper, ['display', '-p', '-t', s.pane, 'x', ';', 'capture-pane', '-p', '-t', s.pane], { env: T.dashEnv(), encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /server exited unexpectedly/);
  assert.equal(T.oneCallReads(), 1);
  fs.rmSync(path.join(T.F.base, 'tmux-fail.json'));
  // a hold keyed on a two-command call holds that call
  write(path.join(T.F.base, 'tmux-delay.json'), JSON.stringify({ 'display+capture-pane': 150 }));
  assert.equal(spawnSync(T.wrapper, ['display', '-p', '-t', s.pane, 'x', ';', 'capture-pane', '-p', '-t', s.pane], { env: T.dashEnv() }).status, 0);
  const [, read] = T.callSpans('display+capture-pane');
  assert.ok(read.end - read.start >= 150, 'a held one-call read is held');
  assert.equal(T.oneCallReads(), 2);
  // a history read is its own pair, the other way round
  assert.equal(spawnSync(T.wrapper, ['capture-pane', '-p', '-S', '-3', '-t', s.pane, ';', 'display', '-p', '-t', s.pane, '#{history_size}'], { env: T.dashEnv() }).status, 0);
  assert.equal(T.historyReads(), 1);
  assert.equal(T.oneCallReads(), 2, 'and not a one-call read');
  // -S and -L take a value, which is never a subcommand (no server answers on either: nothing is started)
  T.clearCalls();
  spawnSync(T.wrapper, ['-S', path.join(T.F.base, 'no-server.sock'), 'list-sessions'], { env: T.dashEnv() });
  spawnSync(T.wrapper, ['-L', 'dt-no-server', 'list-sessions', ';', 'list-sessions'], { env: T.dashEnv() });
  assert.deepEqual(T.callLog().map((c) => c.cmds), [['list-sessions'], ['list-sessions', 'list-sessions']]);
  const { port } = await T.dashboard();
  const r = await T.req(port, 'GET', '/', { headers: SAME });
  assert.equal(r.status, 200, 'a real dashboard answers');
  await s.exit();
  s.kill();
});

// ---- the routes' guards (terminal@1 §2 to §4) ----
const JSON_TYPE = /^application\/json\b/;
// a refusal with a why: 403, JSON, exactly { why } (a GET's) or { error, why } (a POST's), never cached
const refusedWhy = (r, why, what, post = false) => {
  assert.equal(r.status, 403, `${what}: ${r.status} ${r.text}`);
  assert.match(r.headers['content-type'] ?? '', JSON_TYPE, what);
  assert.equal(r.headers['cache-control'], 'no-store', what);
  if (post) assert.deepEqual(r.json, { error: 'the terminal answers only on this page', why }, what);
  else assert.equal(r.text, JSON.stringify({ why }), what);
};
const errorAnswer = (r, status, what) => {
  assert.equal(r.status, status, `${what}: ${r.status} ${r.text}`);
  assert.match(r.headers['content-type'] ?? '', JSON_TYPE, what);
  assert.equal(r.headers['cache-control'], 'no-store', what);
  assert.equal(typeof r.json?.error, 'string', what);
  assert.equal(r.json.why, undefined, what);
};
// the terminal's own reads of a pane (the dashboard's other readers capture alone)
const termReads = (T) => T.callLog().filter((c) => c.cmds.includes('capture-pane') && c.cmds.length > 1).length;

test('terminal A5b: screen and history are refused with their why before any pane is read; routing is exact', async () => {
  const T = termFixture('term-a5b');
  after(() => T.done());
  T.standIn({ lines: ['A5b stand-in'] });
  const { dash, port } = await T.dashboard();
  T.clearCalls();
  const reads = ['/api/term/supervisor/screen', '/api/term/shell/screen', '/api/term/supervisor/history?before=0&count=1', '/api/term/shell/history?before=1&count=5'];
  for (const p of reads) {
    refusedWhy(await T.req(port, 'GET', p, { headers: { 'sec-fetch-site': 'cross-site' } }), 'cross-site', `${p} cross-site`);
    refusedWhy(await T.req(port, 'GET', p, { headers: { ...SAME, 'x-devteam-relay': '1' } }), 'relay', `${p} relay`);
    refusedWhy(await T.req(port, 'GET', p, { headers: { ...SAME, 'x-devteam-level': 'view' } }), 'view', `${p} view`);
    refusedWhy(await T.req(port, 'GET', p, { headers: { ...SAME, host: `evil.test:${port}` } }), 'host', `${p} host`);
    // host before relay, relay before view (§3 step 1, 3)
    refusedWhy(await T.req(port, 'GET', p, { headers: { 'x-devteam-relay': '1', 'x-devteam-level': 'view', host: `evil.test:${port}` } }), 'host', `${p} host first`);
    refusedWhy(await T.req(port, 'GET', p, { headers: { 'x-devteam-relay': '1', 'x-devteam-level': 'view' } }), 'relay', `${p} relay before view`);
  }
  // a POST's global refusal carries its error words too, even on a path that isn't a route
  refusedWhy(await T.post(port, '/api/term/supervisor/keys', {}, { 'sec-fetch-site': 'same-origin', 'x-devteam-relay': '1' }), 'relay', 'a relayed post', true);
  refusedWhy(await T.req(port, 'POST', '/api/term/nowhere', { headers: { host: `evil.test:${port}` } }), 'host', 'a post on another host', true);
  refusedWhy(await T.req(port, 'GET', '/api/term/nowhere', { headers: { ...SAME, 'x-devteam-relay': '1' } }), 'relay', 'an unknown path, relayed');
  // routing (§4): unknown paths 404, the wrong method 405, each { error }
  errorAnswer(await T.req(port, 'GET', '/api/term/x', { headers: SAME }), 404, '/api/term/x');
  errorAnswer(await T.req(port, 'GET', '/api/term/', { headers: SAME }), 404, '/api/term/');
  errorAnswer(await T.req(port, 'GET', '/api/term/other/screen', { headers: SAME }), 404, 'another which');
  errorAnswer(await T.post(port, '/api/term/supervisor/open', {}, SAME), 404, 'supervisor/open');
  errorAnswer(await T.req(port, 'GET', '/api/term/supervisor/open', { headers: SAME }), 404, 'GET supervisor/open');
  errorAnswer(await T.req(port, 'GET', '/api/term/supervisor/keys', { headers: SAME }), 405, 'GET keys');
  errorAnswer(await T.req(port, 'GET', '/api/term/shell/open', { headers: SAME }), 405, 'GET shell/open');
  errorAnswer(await T.post(port, '/api/term/supervisor/screen', {}, SAME), 405, 'POST screen');
  errorAnswer(await T.post(port, '/api/term/shell/history', {}, SAME), 405, 'POST history');
  errorAnswer(await T.post(port, '/api/term/token', {}, SAME), 405, 'POST token');
  // the routing happens before view: a View request to an unknown path is a 404 (§3 step 2)
  errorAnswer(await T.req(port, 'GET', '/api/term/x', { headers: { ...SAME, 'x-devteam-level': 'view' } }), 404, 'view on an unknown path');
  await dash.stop();
  // a dashboard on another address (127.0.0.2: loopback to the box, not to the routes, and never
  // every interface as 0.0.0.0 would be): not-loopback, after view
  const wide = await T.dashboard(['--host', '127.0.0.2']);
  const at2 = { to: '127.0.0.2' };
  for (const p of reads) {
    refusedWhy(await T.req(wide.port, 'GET', p, { ...at2, headers: SAME }), 'not-loopback', `${p} on 127.0.0.2`);
    refusedWhy(await T.req(wide.port, 'GET', p, { ...at2, headers: { ...SAME, host: `127.0.0.1:${wide.port}` } }), 'not-loopback', `${p} on 127.0.0.2, by 127.0.0.1`);
    refusedWhy(await T.req(wide.port, 'GET', p, { ...at2, headers: { 'sec-fetch-site': 'cross-site' } }), 'not-loopback', `${p} on 127.0.0.2, not-loopback before cross-site`);
    refusedWhy(await T.req(wide.port, 'GET', p, { ...at2, headers: { ...SAME, 'x-devteam-level': 'view' } }), 'view', `${p} on 127.0.0.2, view first`);
  }
  refusedWhy(await T.req(wide.port, 'GET', '/api/term/token', { ...at2, headers: SAME }), 'not-loopback', 'token on 127.0.0.2');
  refusedWhy(await T.post(wide.port, '/api/term/shell/open', {}, SAME, '127.0.0.2'), 'not-loopback', 'open on 127.0.0.2', true);
  assert.equal(termReads(T), 0, 'no refused read reached the pane');
  assert.equal(T.oneCallReads() + T.historyReads(), 0);
});

test('terminal A5: the token only to a same-origin read, and the same one each time', async () => {
  const T = termFixture('term-a5t');
  after(() => T.done());
  const { port } = await T.dashboard();
  refusedWhy(await T.req(port, 'GET', '/api/term/token'), 'cross-site', 'a token read without Sec-Fetch-Site');
  refusedWhy(await T.req(port, 'GET', '/api/term/token', { headers: { 'sec-fetch-site': 'cross-site' } }), 'cross-site', 'a cross-site token read');
  refusedWhy(await T.req(port, 'GET', '/api/term/token', { headers: { 'sec-fetch-site': 'same-site' } }), 'cross-site', 'a same-site token read');
  refusedWhy(await T.req(port, 'GET', '/api/term/token', { headers: { 'sec-fetch-site': 'none' } }), 'cross-site', 'a typed-in token read');
  // a View request with a cross-site header reads view: the page hides its tabs (§3 step 3)
  refusedWhy(await T.req(port, 'GET', '/api/term/token', { headers: { 'sec-fetch-site': 'cross-site', 'x-devteam-level': 'view' } }), 'view', 'view before cross-site');
  const a = await T.req(port, 'GET', '/api/term/token', { headers: SAME });
  assert.equal(a.status, 200, a.text);
  assert.match(a.headers['content-type'] ?? '', JSON_TYPE);
  assert.equal(a.headers['cache-control'], 'no-store');
  assert.deepEqual(Object.keys(a.json), ['token']);
  assert.match(a.json.token, /^[0-9a-f]{64}$/);
  const b = await T.req(port, 'GET', '/api/term/token', { headers: SAME });
  assert.equal(b.json.token, a.json.token, 'one token for the server\'s life');
  // the third loopback name (§2)
  const six = await T.req(port, 'GET', '/api/term/token', { headers: { ...SAME, host: `[::1]:${port}` } });
  assert.equal(six.status, 200, six.text);
  assert.equal(six.json.token, a.json.token);
  const local = await T.req(port, 'GET', '/api/term/token', { headers: { ...SAME, host: `localhost:${port}` } });
  assert.equal(local.json.token, a.json.token);
});

// ---- the screen and history (terminal@1 §6, §7) ----
// termLine alone, as the script has it
const termLineFn = () => { const c = vm.createContext({}); vm.runInContext(`${fnSrc('termLine')}\nglobalThis.termLine = termLine;`, c); return c.termLine; };
const READ_FAILED = { error: 'the terminal could not be read; try again' };
const screenOf = async (T, port, which = 'supervisor', headers = {}) => { const r = await T.req(port, 'GET', `/api/term/${which}/screen`, { headers: { ...SAME, ...headers } }); return r; };
const historyOf = (T, port, q, which = 'supervisor') => T.req(port, 'GET', `/api/term/${which}/history?${q}`, { headers: SAME });
// until the screen's JSON passes f (the cache holds a read 100 ms)
const screenUntil = async (T, port, f, what, which = 'supervisor') => {
  let last;
  try { await until(async () => { last = await screenOf(T, port, which); return last.status === 200 && f(last.json); }, what); } catch (e) { assert.fail(`${e.message}; the last screen: ${last?.status} ${last?.text}`); }
  return last;
};
const tmuxOut = (T, args) => spawnSync('tmux', args, { env: T.env, encoding: 'utf8' }).stdout ?? '';
// a line for the stand-in to print at once, with nothing after it (say adds its own lines)
const sayRaw = (s, text) => { const t = path.join(s.dir, 'say.tmp'); fs.writeFileSync(t, text); fs.renameSync(t, path.join(s.dir, 'say')); };
const GONE = { pane: null, state: 'gone', cols: 0, rows: 0, cursor: { x: 0, y: 0, visible: false }, modes: { app_cursor: false, app_keypad: false }, history_size: 0, held: { count: 0, oldest_ms: 0, prompt: 'readable' }, lines: [] };
const isGone = (j, which = 'supervisor') => { const { etag, ...rest } = j ?? {}; assert.match(etag ?? '', /^[0-9a-f]{20}$/); assert.deepEqual(rest, { v: 1, which, ...GONE }); return true; };
// tmux 3.3a ends a captured line with no reset; later ones may add one (0 or 39)
const RED_LINE = /^\x1b\[31mred(?:\x1b\[(?:0|39)?m)?$/;
const L53 = Array.from({ length: 53 }, (_, i) => `L${i}`);

test('terminal A3: termLine keeps SGR and drops every other escape, C0 and DEL, and trailing spaces', () => {
  const termLine = termLineFn();
  assert.equal(termLine('a\x1b[1;31mb\x1b[0mc\x1b[m'), 'a\x1b[1;31mb\x1b[0mc\x1b[m', 'SGR kept');
  assert.equal(termLine('a\x1b[38:5:1mb'), 'a\x1b[38:5:1mb', 'SGR with colons kept');
  assert.equal(termLine('\x1b[?25lx\x1b[2Ky\x1b[1 qz'), 'xyz', 'CSI dropped, intermediates and all');
  assert.equal(termLine('\x1b]8;;http://x\x07link\x1b]8;;\x07'), 'link', 'an OSC 8 link shows its text only');
  assert.equal(termLine('a\x1b]8;;http://x\x1b\\b'), 'ab', 'an OSC to ESC \\');
  assert.equal(termLine('a\x1b]0;title never ended'), 'a', 'an unterminated OSC to the line end');
  assert.equal(termLine('a\x1bPq#0;2\x1b\\b\x1bXs\x07c\x1b^p\x07d\x1b_a\x07e'), 'abcde', 'DCS, SOS, PM, APC');
  assert.equal(termLine('\x1b(Bx\x1b=y\x1b>z\x1b'), 'xyz', 'other escapes with their bytes, a lone ESC');
  assert.equal(termLine('a\x07b\x7fc\x00d\x08e\tf'), 'abcdef', 'C0 and DEL');
  assert.equal(termLine('a  \x1b[0m  '), 'a  \x1b[0m', 'trailing spaces');
});

test('terminal A3: the screen in one call, its etag and 304, history above it; no-store everywhere', async () => {
  const T = termFixture('term-a3');
  after(() => T.done());
  const s = T.standIn({ lines: ['plain', '\x1b[31mred\x1b[0m'] });
  sayRaw(s, '\x1b[4;6H');
  const { port } = await T.dashboard();
  const check = (j, what) => {
    assert.equal(j.v, 1, what);
    assert.equal(j.which, 'supervisor', what);
    assert.equal(j.pane, s.pane, what);
    assert.equal(j.state, 'live', what);
    const [w, h, cx, cy] = tmuxOut(T, ['display', '-p', '-t', s.pane, '#{pane_width} #{pane_height} #{cursor_x} #{cursor_y}']).trim().split(' ').map(Number);
    assert.deepEqual([j.cols, j.rows], [w, h], `${what}: the size is tmux's`);
    assert.deepEqual(j.cursor, { x: cx, y: cy, visible: true }, `${what}: the cursor is tmux's`);
    assert.deepEqual(j.cursor, { x: 5, y: 3, visible: true }, what);
    assert.deepEqual(j.modes, { app_cursor: false, app_keypad: false }, what);
    assert.equal(typeof j.history_size, 'number', what);
    assert.deepEqual(j.held, { count: 0, oldest_ms: 0, prompt: 'readable' }, what);
    assert.equal(j.lines.length, j.rows, `${what}: exactly rows lines`);
    assert.equal(j.lines[0], 'plain', what);
    assert.match(j.lines[1], RED_LINE, `${what}: the red line, its SGR only`);
    assert.ok(j.lines.slice(2).every((l) => l === ''), what);
    assert.deepEqual(Object.keys(j), ['v', 'which', 'pane', 'state', 'cols', 'rows', 'cursor', 'modes', 'history_size', 'held', 'lines', 'etag'], `${what}: nothing else, raw not sent`);
    assert.match(j.etag, /^[0-9a-f]{20}$/, what);
  };
  const a = await screenUntil(T, port, (j) => j.cursor.y === 3, 'the cursor moved');
  check(a.json, 'the screen');
  assert.equal(a.headers['cache-control'], 'no-store');
  assert.match(a.headers['content-type'], JSON_TYPE);
  assert.equal(a.headers.etag, `"${a.json.etag}"`, 'the ETag header is the quoted etag');
  const b = await screenOf(T, port, 'supervisor', { 'if-none-match': `"${a.json.etag}"` });
  assert.equal(b.status, 304, b.text);
  assert.equal(b.text, '', 'a 304 has no body');
  assert.equal(b.headers.etag, `"${a.json.etag}"`);
  assert.equal(b.headers['cache-control'], 'no-store');
  for (const inm of [`W/"${a.json.etag}"`, a.json.etag, `"${a.json.etag}", "x"`, '"0"']) {
    const c = await screenOf(T, port, 'supervisor', { 'if-none-match': inm });
    assert.equal(c.status, 200, `If-None-Match ${inm}`);
    assert.equal(c.json.etag, a.json.etag, 'the same screen, the same etag');
  }
  // the shell isn't open: gone, as an answer
  const sh = await screenOf(T, port, 'shell');
  assert.equal(sh.status, 200, sh.text);
  isGone(sh.json, 'shell');
  // the global refusals and a route's refusal carry no-store too (S2-4)
  for (const r of [await screenOf(T, port, 'supervisor', { 'x-devteam-relay': '1' }), await screenOf(T, port, 'supervisor', { host: `evil.test:${port}` }), await historyOf(T, port, 'before=x&count=1')]) assert.equal(r.headers['cache-control'], 'no-store', r.text);
  // history: a stand-in with more lines than the screen holds; the three just above it
  const h = T.standIn({ lines: L53 });
  const sc = await screenUntil(T, port, (j) => j.pane === h.pane && j.lines.includes('L52'), 'the second stand-in');
  const hs = sc.json.history_size;
  assert.ok(hs >= 3, `history_size ${hs}`);
  const hr = await historyOf(T, port, `before=${hs}&count=3`);
  assert.equal(hr.status, 200, hr.text);
  assert.equal(hr.headers['cache-control'], 'no-store');
  const direct = tmuxOut(T, ['capture-pane', '-p', '-S', '-3', '-E', '-1', '-t', h.pane]).split('\n').slice(0, 3).map((l) => l.trimEnd());
  assert.deepEqual(direct, ['L27', 'L28', 'L29'], 'tmux itself');
  assert.deepEqual(hr.json, { v: 1, which: 'supervisor', pane: h.pane, before: hs, history_size: hs, lines: direct });
  h.kill();
  s.kill();
});

test('terminal A3: a C locale still parses (tmux -u)', async () => {
  const T = termFixture('term-a3c');
  after(() => T.done());
  const s = T.standIn({ lines: ['plain', '\x1b[31mred\x1b[0m'] });
  const { port } = await T.dashboard([], { LC_ALL: 'C', LANG: 'C', LC_CTYPE: 'C' });
  const a = await screenUntil(T, port, (j) => j.lines[1]?.includes('red'), 'the red line');
  assert.equal(a.json.state, 'live');
  assert.equal(a.json.pane, s.pane);
  assert.ok(a.json.cols > 0 && a.json.rows > 0, a.text);
  assert.equal(a.json.lines.length, a.json.rows);
  assert.equal(a.json.lines[0], 'plain');
  assert.match(a.json.lines[1], RED_LINE);
  s.kill();
});

test('terminal A5d: history by absolute line, its offsets exact, its range refused', async () => {
  const T = termFixture('term-a5d');
  after(() => T.done());
  const s = T.standIn({ lines: L53 });
  const { port } = await T.dashboard();
  const sc = await screenUntil(T, port, (j) => j.lines.includes('L52'), 'the stand-in\'s lines');
  assert.equal(sc.json.rows, 24);
  assert.equal(sc.json.history_size, 30, sc.text);
  assert.deepEqual(sc.json.lines.slice(0, 23), L53.slice(30), 'the screen is L30 to L52');
  assert.equal(sc.json.lines[23], '', 'and the cursor row');
  const hs = sc.json.history_size;
  const lines = async (q) => { const r = await historyOf(T, port, q); assert.equal(r.status, 200, `${q}: ${r.text}`); assert.equal(r.json.history_size, hs); assert.equal(r.json.pane, s.pane); return r.json.lines; };
  assert.deepEqual(await lines('before=20&count=5'), ['L15', 'L16', 'L17', 'L18', 'L19']);
  assert.deepEqual(await lines(`before=${hs}&count=1`), ['L29'], 'the line just above the screen');
  assert.deepEqual(await lines('before=3&count=10'), ['L0', 'L1', 'L2'], 'fewer when fewer exist');
  assert.deepEqual(await lines(`before=${hs}&count=500`), L53.slice(0, 30));
  const before = T.historyReads();
  const zero = await historyOf(T, port, 'before=0&count=5');
  assert.equal(zero.status, 200, zero.text);
  assert.deepEqual(zero.json, { v: 1, which: 'supervisor', pane: s.pane, before: 0, history_size: hs, lines: [] });
  assert.equal(T.historyReads(), before, 'before=0 reads no history');
  for (const q of [`before=${hs + 1}&count=1`, 'before=-1&count=1', 'before=1&count=0', 'before=1&count=501', 'before=1.5&count=1', 'count=1', 'before=1']) errorAnswer(await historyOf(T, port, q), 400, q);
  // gone: before=0 answers, anything else is 400
  s.kill();
  await screenUntil(T, port, (j) => j.state === 'gone', 'the pane gone');
  const g = await historyOf(T, port, 'before=0&count=5');
  assert.equal(g.status, 200, g.text);
  assert.deepEqual(g.json, { v: 1, which: 'supervisor', pane: null, before: 0, history_size: 0, lines: [] });
  errorAnswer(await historyOf(T, port, 'before=1&count=5'), 400, 'gone, before=1');
  const sh = await historyOf(T, port, 'before=0&count=1', 'shell');
  assert.deepEqual(sh.json, { v: 1, which: 'shell', pane: null, before: 0, history_size: 0, lines: [] });
});

test('terminal A5c: modes from tmux; history count 1 to 500', async () => {
  const T = termFixture('term-a5c-modes');
  after(() => T.done());
  const s = T.standIn({ lines: ['modes'] });
  const { port } = await T.dashboard();
  await screenUntil(T, port, (j) => j.lines[0] === 'modes' && !j.modes.app_cursor && !j.modes.app_keypad, 'modes off');
  await s.say('\x1b[?1h\x1b=on');
  await screenUntil(T, port, (j) => j.modes.app_cursor && j.modes.app_keypad, 'both modes on');
  await s.say('\x1b[?1l\x1b>off');
  await screenUntil(T, port, (j) => !j.modes.app_cursor && !j.modes.app_keypad, 'both modes off again');
  errorAnswer(await historyOf(T, port, 'before=0&count=501'), 400, 'count=501');
  const ok = await historyOf(T, port, 'before=0&count=500');
  assert.equal(ok.status, 200, ok.text);
  assert.ok(String(await s.received()) === '', 'nothing typed');
  s.kill();
});

test('terminal A6: the screen reads gone for a killed pane, a shell prompt, a foreign pane', async () => {
  const T = termFixture('term-a6-gone');
  after(() => T.done());
  const s = T.standIn({ lines: ['A6 stand-in'] });
  const { port } = await T.dashboard();
  await screenUntil(T, port, (j) => j.state === 'live' && j.pane === s.pane, 'live');
  await s.exit();
  isGone((await screenUntil(T, port, (j) => j.state === 'gone', 'gone at a shell prompt')).json);
  s.kill();
  isGone((await screenUntil(T, port, (j) => j.state === 'gone', 'gone when killed')).json);
  // a pane started outside the root, its id noted: foreign when the record names another server
  const made = spawnSync('tmux', ['new-window', '-d', '-P', '-F', '#{pane_id}', '-t', `=${T.session}:`, '-n', 'far', '-c', T.F.base, process.execPath, '-e', 'setInterval(() => {}, 1000)'], { env: T.env, encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  const far = made.stdout.trim();
  await until(() => tmuxOut(T, ['display', '-p', '-t', far, '#{pane_current_command}']).trim() === 'node', 'node in the far pane');
  const run = path.join(T.root, 'docs/devteam/run');
  write(path.join(run, 'supervisor-pane'), `${far}\n`);
  write(path.join(run, 'supervisor-pane-role'), `${far}\n`);
  write(path.join(run, 'supervisor-up.json'), JSON.stringify({ up: true, kind: 'tmux', pane: far, server: '1' }));
  await pause(150);
  const g = await screenOf(T, port);
  assert.equal(g.status, 200, g.text);
  isGone(g.json);
  // the same pane, the record naming this server: it is the supervisor's (so the gone was the pid)
  const pid = tmuxOut(T, ['display', '-p', '#{pid}']).trim();
  write(path.join(run, 'supervisor-up.json'), JSON.stringify({ up: true, kind: 'tmux', pane: far, server: pid }));
  assert.equal((await screenUntil(T, port, (j) => j.state === 'live', 'live on its own server')).json.pane, far);
  // with no server recorded, a pane outside the root is foreign
  fs.rmSync(path.join(run, 'supervisor-up.json'));
  isGone((await screenUntil(T, port, (j) => j.state === 'gone', 'gone with no record')).json);
  // a tagged pane is never the supervisor's
  write(path.join(run, 'supervisor-up.json'), JSON.stringify({ up: true, kind: 'tmux', pane: far, server: pid }));
  await screenUntil(T, port, (j) => j.state === 'live', 'live again');
  assert.equal(spawnSync('tmux', ['set-option', '-p', '-t', far, '@devteam-shell', T.root], { env: T.env }).status, 0);
  isGone((await screenUntil(T, port, (j) => j.state === 'gone', 'gone when tagged')).json);
  // a dead pane (its program exited, the pane kept): gone
  const d = T.standIn({ lines: ['about to die'] });
  await screenUntil(T, port, (j) => j.state === 'live' && j.pane === d.pane, 'the new stand-in live');
  assert.equal(spawnSync('tmux', ['set-option', '-p', '-t', d.pane, 'remain-on-exit', 'on'], { env: T.env }).status, 0);
  process.kill(Number(tmuxOut(T, ['display', '-p', '-t', d.pane, '#{pane_pid}']).trim()));
  await until(() => tmuxOut(T, ['display', '-p', '-t', d.pane, '#{pane_dead}']).trim() === '1', 'the pane dead');
  isGone((await screenUntil(T, port, (j) => j.state === 'gone', 'gone when dead')).json);
  d.kill();
});

test('terminal A8: twenty screen GETs share one read; a failed read is 500, a missing pane gone; a slow read blocks nothing', async () => {
  const T = termFixture('term-a8');
  after(() => T.done());
  const s = T.standIn({ lines: ['A8 stand-in'] });
  const { port } = await T.dashboard();
  await screenUntil(T, port, (j) => j.state === 'live', 'live');
  await pause(150);
  T.clearCalls();
  const all = await Promise.all(Array.from({ length: 20 }, () => screenOf(T, port)));
  for (const r of all) assert.equal(r.status, 200, r.text);
  assert.equal(new Set(all.map((r) => r.json.etag)).size, 1);
  assert.ok(T.oneCallReads() <= 1, `${T.oneCallReads()} one-call reads`);
  // tmux failing: 500, never gone, and nothing cached
  const fail = path.join(T.F.base, 'tmux-fail.json');
  write(fail, JSON.stringify({ 'display+capture-pane': 'server exited unexpectedly' }));
  await pause(150);
  const f = await screenOf(T, port);
  assert.equal(f.status, 500, f.text);
  assert.deepEqual(f.json, READ_FAILED);
  assert.equal(f.headers['cache-control'], 'no-store');
  const fh = await historyOf(T, port, 'before=1&count=1');
  assert.equal(fh.status, 500, fh.text);
  assert.deepEqual(fh.json, READ_FAILED);
  write(fail, JSON.stringify({ 'display+capture-pane': "can't find pane: %9" }));
  const g = await screenOf(T, port);
  assert.equal(g.status, 200, g.text);
  isGone(g.json);
  fs.rmSync(fail);
  await pause(150);
  assert.equal((await screenOf(T, port)).json.state, 'live');
  // the Shell's lookup failing is 500, not "never opened"; tmux saying there's no session is gone (T3-1)
  write(fail, JSON.stringify({ 'list-panes': 'server exited unexpectedly' }));
  const sf = await screenOf(T, port, 'shell');
  assert.equal(sf.status, 500, sf.text);
  assert.deepEqual(sf.json, READ_FAILED);
  write(fail, JSON.stringify({ 'list-panes': "can't find session: x" }));
  const sg = await screenOf(T, port, 'shell');
  assert.equal(sg.status, 200, sg.text);
  isGone(sg.json, 'shell');
  fs.rmSync(fail);
  // a failed read is no refusal (T3-4)
  const dlog = fs.readFileSync(path.join(T.root, 'docs/devteam/run/dashboard.log'), 'utf8');
  assert.match(dlog, /tmux failed/);
  assert.doesNotMatch(dlog, /refused \/api\/term\/(supervisor|shell)\/(screen|history)/);
  // a held read: the dashboard answers meanwhile
  write(path.join(T.F.base, 'tmux-delay.json'), JSON.stringify({ 'display+capture-pane': 3000 }));
  await pause(150);
  let done = false;
  const slow = screenOf(T, port).then((r) => { done = true; return r; });
  await pause(200);
  const t0 = Date.now();
  const hello = await T.req(port, 'GET', '/api/hello');
  assert.equal(hello.status, 200);
  assert.ok(Date.now() - t0 < 2000, `hello took ${Date.now() - t0} ms`);
  assert.equal(done, false, 'the screen read was still in flight');
  assert.equal((await slow).status, 200);
  s.kill();
});

// A POST streaming `total` bytes in 64 KB chunks: cut is true when the server cut it off (the
// request errors, or its socket is destroyed) before the whole body was written; a server that
// drains it all lets it finish, or keeps reading past the 30 s given. Kept alive, as a browser's
// is: a closing connection would end with the answer whatever the server drained.
const streamPost = (port, p, total, headers = {}) => new Promise((resolve) => {
  let wrote = 0, settled = false;
  const finish = (cut) => { if (!settled) { settled = true; clearTimeout(cap); r.destroy(); resolve({ wrote, cut }); } };
  const cap = setTimeout(() => finish(false), 30000);
  const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: p, setHost: false, headers: { host: `127.0.0.1:${port}`, connection: 'keep-alive', 'content-type': 'application/json', 'content-length': String(total), ...headers } }, (res) => res.resume());
  r.on('error', () => finish(wrote < total));
  r.on('finish', () => finish(false));
  const chunk = Buffer.alloc(65536, 0x20);
  const pump = () => { while (wrote < total) { if (r.destroyed) return finish(true); wrote += chunk.length; if (!r.write(chunk)) return void r.once('drain', pump); } r.end(); };
  pump();
});

test('terminal A5b: a refusal before the body drains at most 4 x CAP; a client gone mid-body is logged as gone', async () => {
  const T = termFixture('term-a5b-body');
  after(() => T.done());
  const { port } = await T.dashboard();
  const total = 16 * 1024 * 1024;
  // a 404, a 405, a refusal with a why, the content type, and the global relay refusal
  for (const [p, h] of [['/api/term/x', {}], ['/api/term/supervisor/screen', {}], ['/api/term/supervisor/keys', {}], ['/api/term/supervisor/keys', { ...SAME, origin: `http://127.0.0.1:${port}`, 'content-type': 'text/plain' }], ['/api/term/supervisor/keys', { 'x-devteam-relay': '1' }]]) {
    const { wrote, cut } = await streamPost(port, p, total, h);
    assert.ok(cut, `${p} ${JSON.stringify(h)}: not cut off (${wrote} bytes written)`);
  }
  // a body begun and abandoned: the client went, not a body over the cap
  const tok = (await T.req(port, 'GET', '/api/term/token', { headers: SAME })).json.token;
  await new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/term/supervisor/keys', setHost: false, headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, ...SAME, 'content-type': 'application/json', 'content-length': '1000' } });
    r.on('error', () => {});
    r.write(`{"token":"${tok}",`);
    setTimeout(() => { r.destroy(); setTimeout(resolve, 300); }, 300);
  });
  const log = path.join(T.root, 'docs/devteam/run/dashboard.log');
  await until(() => /refused \/api\/term\/supervisor\/keys: the client went before its body ended/.test(fs.readFileSync(log, 'utf8')), 'the abort logged');
  assert.doesNotMatch(fs.readFileSync(log, 'utf8'), /far over the cap/);
  assert.equal((await T.req(port, 'GET', '/api/term/token', { headers: SAME })).status, 200, 'the dashboard still answers');
});

test('terminal A5d: history re-reads when history_size moved, refuses a shrunk range, and voids the screen on a missing pane', async () => {
  const T = termFixture('term-a5d-moved');
  after(() => T.done());
  const s = T.standIn({ lines: L53 });
  await until(() => tmuxOut(T, ['capture-pane', '-p', '-t', s.pane]).includes('L52'), 'the stand-in drawn');
  // the screen held a minute, so its history_size goes stale on purpose
  const { port } = await T.dashboard([], { DEVTEAM_TERM_CACHE_MS: '60000' });
  const sc = await screenOf(T, port);
  assert.equal(sc.json.history_size, 30, sc.text);
  await s.say('M0');
  const now = Number(tmuxOut(T, ['display', '-p', '-t', s.pane, '#{history_size}']).trim());
  assert.ok(now > 30, `history moved: ${now}`);
  assert.equal((await screenOf(T, port)).json.history_size, 30, 'the cached screen is stale');
  // offsets from 30 would read L29 onwards: the read sees history_size moved and reads again from it
  const reads = T.historyReads();
  const h = await historyOf(T, port, 'before=30&count=3');
  assert.equal(h.status, 200, h.text);
  assert.deepEqual(h.json, { v: 1, which: 'supervisor', pane: s.pane, before: 30, history_size: now, lines: ['L27', 'L28', 'L29'] });
  assert.equal(T.historyReads(), reads + 2, 'one read, then one more');
  // history cleared under a screen that says 30: before=30 is past the top now
  assert.equal(spawnSync('tmux', ['clear-history', '-t', s.pane], { env: T.env }).status, 0);
  errorAnswer(await historyOf(T, port, 'before=30&count=1'), 400, 'history shrank');
  // the pane gone under the cached screen: 400, and the cache is voided, so the screen reads gone now
  s.kill();
  errorAnswer(await historyOf(T, port, 'before=1&count=1'), 400, 'the pane gone');
  const g = await screenOf(T, port);
  assert.equal(g.status, 200, g.text);
  isGone(g.json);
});

// ---- keys and paste (terminal@1 §3 steps 4 to 12, §8) ----
const PAGE_ID = 'page-0123456789abcdef';
const hex = (s) => Buffer.from(s, 'utf8').toString('hex');
const W = {
  page: 'the terminal answers only on this page', token: 'reload the page to type here', shape: 'that was not understood', big: 'that is too large to send', paste: 'that is too large to paste',
  down: "the supervisor isn't running", shut: 'the shell is not open', moved: 'the terminal moved to another pane; reading it again', sent: 'the keys may not all have reached the terminal; look at it before typing again',
};
const JT = { 'content-type': 'application/json' };
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
// The gateway's proof for a terminal POST (§3), as cloud/gateway.mjs signs an owner setting's
const termSig = (priv, domain, port, which, body, { ts = Date.now(), nonce = crypto.randomBytes(24).toString('base64url') } = {}) => {
  const msg = Buffer.from(`${domain}\n${port}\n${which}\n${ts}\n${nonce}\n${crypto.createHash('sha256').update(body).digest('hex')}`);
  return { 'x-devteam-gateway-ts': String(ts), 'x-devteam-gateway-nonce': nonce, 'x-devteam-gateway-sig': crypto.sign(null, msg, crypto.createPrivateKey(priv)).toString('base64url') };
};
const shellWindows = (T) => tmuxOut(T, ['list-windows', '-t', `=${T.session}`, '-F', '#{window_name}']).split('\n').filter((n) => n === 'shell').length;
const markPane = (T, pane) => { const run = path.join(T.root, 'docs/devteam/run'); write(path.join(run, 'supervisor-pane'), `${pane}\n`); write(path.join(run, 'supervisor-pane-role'), `${pane}\n`); };

test('terminal A4: a supervisor key post types with -H and answers the screen after its change', async () => {
  const T = termFixture('term-a4');
  after(() => T.done());
  const s = T.standIn({ lines: ['A4 stand-in'] });
  const { port } = await T.dashboard();
  await screenUntil(T, port, (j) => j.state === 'live' && j.pane === s.pane, 'live');
  const tok = await tokenOf(T, port);
  const r = await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 1, { data: '6563686f2068690d' }));
  assert.equal(r.status, 200, r.text);
  assert.match(r.headers['content-type'] ?? '', JSON_TYPE);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.json.taken, true);
  assert.equal(r.json.state, 'live');
  assert.equal(r.json.pane, s.pane);
  assert.match(r.json.etag, /^[0-9a-f]{20}$/);
  assert.ok(r.json.lines.includes('echo hi'), `the answer is the screen after the change: ${JSON.stringify(r.json.lines)}`);
  assert.equal(String(await s.received()), 'echo hi\r');
  assert.equal(T.callSpans('send-keys').length, 1, 'one send-keys');
  // application/json with a parameter, in any case, is the type (§3)
  const p = await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 2, { data: '78' }), { 'content-type': 'Application/JSON; charset=utf-8' });
  assert.equal(p.status, 200, p.text);
  assert.equal(p.json.taken, true);
  assert.equal(String(await s.received()), 'echo hi\rx');
  s.kill();
});

test('terminal A5: every guard on a key post refuses, in terminal@1 §3 order, and nothing is typed', async () => {
  const T = termFixture('term-a5k');
  after(() => T.done());
  const s = T.standIn({ lines: ['A5 stand-in'] });
  const { port } = await T.dashboard();
  await screenUntil(T, port, (j) => j.state === 'live' && j.pane === s.pane, 'live');
  const tok = await tokenOf(T, port);
  const base = await typedState(T, port, s);
  const origin = `http://127.0.0.1:${port}`;
  const own = { ...SAME, origin, ...JT };
  const good = (more) => JSON.stringify(keysBody(tok, s.pane, 1, more));
  const raw = (p, headers, body) => T.req(port, 'POST', p, { headers, body });
  const big = (n, c = ' ') => c.repeat(n);
  const cases = [
    // step 1: the global guards, then step 3: view, not-loopback, cross-site
    ['another host', { ...own, host: `evil.test:${port}` }, good(), 403, W.page, 'host'],
    ['the relay mark', { ...own, 'x-devteam-relay': '1' }, good(), 403, W.page, 'relay'],
    ['View', { ...own, 'x-devteam-level': 'view' }, good(), 403, W.page, 'view'],
    ['relay before view', { ...own, 'x-devteam-relay': '1', 'x-devteam-level': 'view' }, good(), 403, W.page, 'relay'],
    ['view before cross-site', { ...own, 'sec-fetch-site': 'cross-site', 'x-devteam-level': 'view' }, good(), 403, W.page, 'view'],
    ['no Sec-Fetch-Site', { origin, ...JT }, good(), 403, W.page, 'cross-site'],
    ['a cross-site one', { ...own, 'sec-fetch-site': 'cross-site' }, good(), 403, W.page, 'cross-site'],
    ['a same-site one', { ...own, 'sec-fetch-site': 'same-site' }, good(), 403, W.page, 'cross-site'],
    ['a wrong Origin', { ...own, origin: `http://evil.test:${port}` }, good(), 403, W.page, 'cross-site'],
    ['another loopback name as Origin', { ...own, origin: `http://localhost:${port}` }, good(), 403, W.page, 'cross-site'],
    ['no Origin', { ...SAME, ...JT }, good(), 403, W.page, 'cross-site'],
    // step 3 before 4: cross-site and the wrong type read cross-site
    ['cross-site before the content type', { ...own, 'sec-fetch-site': 'cross-site', 'content-type': 'text/plain' }, good(), 403, W.page, 'cross-site'],
    // step 4: the content type, no why
    ['text/plain', { ...own, 'content-type': 'text/plain' }, good(), 403, W.page],
    ['a form post', { ...own, 'content-type': 'application/x-www-form-urlencoded' }, good(), 403, W.page],
    ['application/json-patch+json', { ...own, 'content-type': 'application/json-patch+json' }, good(), 403, W.page],
    ['no content type', { ...SAME, origin }, good(), 403, W.page],
    ['the content type before the body cap', { ...own, 'content-type': 'text/plain' }, big(102401), 403, W.page],
    // step 5: the body cap; its edge is JSON's business
    ['a body over the cap', own, big(102401), 413, W.big],
    ['a body over the cap before bad JSON', own, big(102401, 'x'), 413, W.big],
    ['a body at the cap, not JSON', own, big(102400, 'x'), 400, W.shape],
    // step 6: JSON, an object
    ['not JSON', own, `{"token":"${tok}",`, 400, W.shape],
    ['null', own, 'null', 400, W.shape],
    ['a string', own, '"x"', 400, W.shape],
    ['an array', own, '[]', 400, W.shape],
    ['a number', own, '7', 400, W.shape],
    // step 7: the token, before the shape
    ['a missing token', own, JSON.stringify({ ...keysBody(tok, s.pane, 1), token: undefined }), 403, W.token],
    ['a wrong token', own, JSON.stringify(keysBody('0'.repeat(64), s.pane, 1)), 403, W.token],
    ['a short token', own, JSON.stringify(keysBody(tok.slice(1), s.pane, 1)), 403, W.token],
    ['a token not a string', own, JSON.stringify(keysBody(7, s.pane, 1)), 403, W.token],
    ['a wrong token before the shape', own, JSON.stringify({ token: '0'.repeat(64), x: 1 }), 403, W.token],
    ['a missing token before the shape', own, JSON.stringify({ x: 1 }), 403, W.token],
    // step 8 before 9: the shape before the caps
    ['data over its cap, with an extra key', own, JSON.stringify({ ...keysBody(tok, s.pane, 1, { data: '61'.repeat(4097) }), x: 1 }), 400, W.shape],
    ['a paste over its cap, with another which', own, JSON.stringify(keysBody(tok, s.pane, 1, { paste: 'a'.repeat(65537) }, 'shell')), 400, W.shape],
    // step 9: the caps, before the pane (step 11)
    ['data of 4097 bytes', own, good({ data: '61'.repeat(4097) }), 413, W.big],
    ['data over its cap, to a stale pane', own, JSON.stringify(keysBody(tok, '%9999', 1, { data: '61'.repeat(4097) })), 413, W.big],
  ];
  for (const [what, headers, body, status, error, why] of cases) {
    refusedWith(await raw('/api/term/supervisor/keys', headers, body), status, error, what, why);
    await nothingTyped(T, port, s, base, what);
  }
  // the same guards on shell/open: refused, and no shell window (S5)
  const ob = JSON.stringify(openBody(tok));
  for (const [what, headers, body, why, error = W.page] of [
    ['no Sec-Fetch-Site', { origin, ...JT }, ob, 'cross-site'],
    ['a wrong Origin', { ...own, origin: `http://evil.test:${port}` }, ob, 'cross-site'],
    ['View', { ...own, 'x-devteam-level': 'view' }, ob, 'view'],
    ['the relay mark', { ...own, 'x-devteam-relay': '1' }, ob, 'relay'],
    ['a wrong token', own, JSON.stringify(openBody('0'.repeat(64))), undefined, W.token],
    ['the content type', { ...own, 'content-type': 'text/plain' }, ob, undefined],
  ]) {
    refusedWith(await raw('/api/term/shell/open', headers, body), 403, error, `shell/open: ${what}`, why);
    assert.equal(shellWindows(T), 0, `shell/open: ${what}: no shell window`);
  }
  await nothingTyped(T, port, s, base, 'after shell/open');
  // a dashboard bound beyond loopback: not-loopback, after view (127.0.0.2, never every interface)
  const wide = await T.dashboard(['--host', '127.0.0.2']);
  const at2 = `http://127.0.0.2:${wide.port}`;
  refusedWith(await T.req(wide.port, 'POST', '/api/term/supervisor/keys', { to: '127.0.0.2', headers: { ...SAME, origin: at2, ...JT }, body: good() }), 403, W.page, 'keys on 127.0.0.2', 'not-loopback');
  refusedWith(await T.req(wide.port, 'POST', '/api/term/supervisor/keys', { to: '127.0.0.2', headers: { ...SAME, origin: at2, ...JT, 'x-devteam-level': 'view' }, body: good() }), 403, W.page, 'view on 127.0.0.2', 'view');
  await nothingTyped(T, port, s, base, 'the wide dashboard');
  // and the guarded post itself, sent right, types
  const ok = await raw('/api/term/supervisor/keys', own, good());
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.taken, true);
  assert.equal(String(await s.received(1)), 'a');
  s.kill();
});

test("terminal A5: on a box a post needs the gateway's proof, bound to its route, which, port and body, each nonce once", async () => {
  const T = termFixture('term-a5-box');
  after(() => T.done());
  const pair = crypto.generateKeyPairSync('ed25519');
  const priv = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const other = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pub = path.join(T.F.base, 'thread-key.pub');
  fs.writeFileSync(pub, pair.publicKey.export({ type: 'spki', format: 'pem' }));
  const s = T.standIn({ lines: ['A5 box stand-in'] });
  const { port } = await T.dashboard([], { DEVTEAM_PUBLIC_URL: 'https://box.example.com', DEVTEAM_GATEWAY_THREAD_KEY: pub });
  await screenUntil(T, port, (j) => j.state === 'live' && j.pane === s.pane, 'live');
  const tok = await tokenOf(T, port);
  const base = await typedState(T, port, s);
  const K = 'devteam-term-keys-v1', O = 'devteam-term-open-v1';
  const body = JSON.stringify(keysBody(tok, s.pane, 1));
  const send = (sig, b = body) => keysTo(T, port, 'supervisor', b, sig);
  const sig = (b = body, o = {}) => termSig(priv, K, port, 'supervisor', b, o);
  const { 'x-devteam-gateway-sig': _, ...noSig } = sig();
  for (const [what, headers, b = body, status = 403, error = W.page] of [
    ['no proof', {}],
    ['a proof without its signature', noSig],
    ['a proof for the other which', termSig(priv, K, port, 'shell', body)],
    ['a proof for the other domain', termSig(priv, O, port, 'supervisor', body)],
    ['a proof for another port', termSig(priv, K, port + 1, 'supervisor', body)],
    ['a proof over a different body', sig(JSON.stringify(keysBody(tok, s.pane, 2)))],
    ['a proof by another key', termSig(other, K, port, 'supervisor', body)],
    ['a proof too old', sig(body, { ts: Date.now() - 10 * 60000 })],
    // the caps before the proof (§3 steps 9, 10), the proof before the pane (10, 11)
    ['data over its cap, no proof', {}, JSON.stringify(keysBody(tok, s.pane, 1, { data: '61'.repeat(4097) })), 413, W.big],
    ['a stale pane, no proof', {}, JSON.stringify(keysBody(tok, '%9999', 1))],
    ['a wrong token, no proof', {}, JSON.stringify(keysBody('0'.repeat(64), s.pane, 1)), 403, W.token],
  ]) {
    refusedWith(await send(headers, b), status, error, what);
    await nothingTyped(T, port, s, base, what);
  }
  // the valid proof types once; its nonce again is refused, before the repeat drop
  const good = sig();
  const r = await send(good);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.taken, true);
  assert.equal(String(await s.received(1)), 'a', 'typed once');
  const after1 = await typedState(T, port, s);
  refusedWith(await send(good), 403, W.page, 'the nonce a second time');
  await nothingTyped(T, port, s, after1, 'the nonce a second time');
  // a fresh proof for the same seq: a repeat, which types nothing
  const again = await send(sig());
  assert.equal(again.status, 200, again.text);
  assert.equal(again.json.taken, false);
  await nothingTyped(T, port, s, after1, 'a repeat');
  // shell/open: no proof, and a keys-domain proof, are refused, and no shell window (S5)
  const ob = JSON.stringify(openBody(tok));
  for (const [what, headers] of [['no proof', {}], ['a keys-domain proof', termSig(priv, K, port, 'shell', ob)], ['an open proof for another port', termSig(priv, O, port + 1, 'shell', ob)]]) {
    refusedWith(await T.post(port, '/api/term/shell/open', ob, { ...SAME, ...headers }), 403, W.page, `shell/open: ${what}`);
    assert.equal(shellWindows(T), 0, `shell/open: ${what}: no shell window`);
  }
  await nothingTyped(T, port, s, after1, 'after shell/open');
  s.kill();
});

test('terminal A5c: a key post of the wrong shape is 400, a paste over its cap 413, a tagged supervisor pane 423; none types', async () => {
  const T = termFixture('term-a5c-keys');
  after(() => T.done());
  const s = T.standIn({ lines: ['A5c stand-in'] });
  const { port } = await T.dashboard();
  await screenUntil(T, port, (j) => j.state === 'live' && j.pane === s.pane, 'live');
  const tok = await tokenOf(T, port);
  let base = await typedState(T, port, s);
  const k = (more = {}, which) => ({ ...keysBody(tok, s.pane, 1, { data: '61' }, which), ...more });
  const shapes = [
    ['not JSON', '{'],
    ['an array', [k()]],
    ['an extra key', { ...k(), x: 1 }],
    ['both data and paste', { ...k(), paste: 'a' }],
    ['neither data nor paste', { ...k(), data: undefined }],
    ['odd-length data', k({ data: '616' })],
    ['empty data', k({ data: '' })],
    ['data not hex', k({ data: 'zz' })],
    ['data not a string', k({ data: 97 })],
    ['an empty paste', { ...k(), data: undefined, paste: '' }],
    ['a paste not a string', { ...k(), data: undefined, paste: ['a'] }],
    ['a which unlike the path', k({ which: 'shell' })],
    ['no which', k({ which: undefined })],
    ['a pane not %<n>', k({ pane: s.pane.slice(1) })],
    ['a pane not a string', k({ pane: 1 })],
    ['a page too short', k({ page: 'short' })],
    ['a page of other characters', k({ page: 'page/0123456789abcdef' })],
    ['seq 0', k({ seq: 0 })],
    ['seq -1', k({ seq: -1 })],
    ['seq 1.5', k({ seq: 1.5 })],
    ['seq as a string', k({ seq: '1' })],
    ['seq past the safe integers', k({ seq: 2 ** 53 })],
  ];
  for (const [what, body] of shapes) {
    refusedWith(await keysTo(T, port, 'supervisor', body), 400, W.shape, what);
    await nothingTyped(T, port, s, base, what);
  }
  // a paste is capped in UTF-8 bytes, not characters
  for (const [what, paste] of [['a 65537-byte paste', 'a'.repeat(65537)], ['32769 two-byte characters', 'é'.repeat(32769)]]) {
    refusedWith(await keysTo(T, port, 'supervisor', { ...k(), data: undefined, paste }), 413, W.paste, what);
    await nothingTyped(T, port, s, base, what);
  }
  // the marked pane carrying @devteam-shell: 423 from both routes (the edge case: neither's)
  assert.equal(spawnSync('tmux', ['set-option', '-p', '-t', s.pane, '@devteam-shell', T.root], { env: T.env }).status, 0);
  await screenUntil(T, port, (j) => j.state === 'gone', 'gone when tagged');
  base = await typedState(T, port, s);
  refusedWith(await keysTo(T, port, 'supervisor', k()), 423, W.moved, 'a tagged supervisor pane');
  await nothingTyped(T, port, s, base, 'a tagged supervisor pane');
  refusedWith(await keysTo(T, port, 'shell', k({}, 'shell')), 423, W.moved, 'a shell post naming the tagged marked pane');
  await nothingTyped(T, port, s, base, 'a shell post naming the tagged marked pane');
  // untagged, the same post types: so the 423 was the tag
  assert.equal(spawnSync('tmux', ['set-option', '-p', '-u', '-t', s.pane, '@devteam-shell'], { env: T.env }).status, 0);
  const ok = await keysTo(T, port, 'supervisor', k());
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.taken, true);
  assert.equal(String(await s.received(1)), 'a');
  s.kill();
});

test('terminal A6: supervisor keys to no, a foreign, a killed or an exited pane get 409, a stale pane 423; each post reads fresh', async () => {
  const T = termFixture('term-a6-keys');
  after(() => T.done());
  const { dash, port } = await T.dashboard();
  const tok = await tokenOf(T, port);
  // nothing marked: 409 on the supervisor, and the shell isn't open: 409
  refusedWith(await keysTo(T, port, 'supervisor', keysBody(tok, '%0', 1)), 409, W.down, 'no marked pane');
  refusedWith(await keysTo(T, port, 'shell', keysBody(tok, '%0', 1, undefined, 'shell')), 409, W.shut, 'no Shell pane');
  const s = T.standIn({ lines: ['A6 stand-in'] });
  await screenUntil(T, port, (j) => j.state === 'live' && j.pane === s.pane, 'live');
  let base = await typedState(T, port, s);
  assert.equal(base.sends, 0);
  for (const [what, which, pane, status, error] of [
    ['an unknown pane', 'supervisor', '%9999', 423, W.moved],
    // the pane step's order (S3): a shell post naming the marked pane is 423 before "no Shell"
    ['a shell post naming the marked pane', 'shell', s.pane, 423, W.moved],
    ['a shell post, no Shell open', 'shell', '%9999', 409, W.shut],
  ]) {
    refusedWith(await keysTo(T, port, which, keysBody(tok, pane, 1, undefined, which)), status, error, what);
    await nothingTyped(T, port, s, base, what);
  }
  // a foreign pane: noted, started outside the root, its record naming another server
  const made = spawnSync('tmux', ['new-window', '-d', '-P', '-F', '#{pane_id}', '-t', `=${T.session}:`, '-n', 'far', '-c', T.F.base, process.execPath, '-e', 'setInterval(() => {}, 1000)'], { env: T.env, encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  const far = made.stdout.trim();
  await until(() => tmuxOut(T, ['display', '-p', '-t', far, '#{pane_current_command}']).trim() === 'node', 'node in the far pane');
  markPane(T, far);
  const up = path.join(T.root, 'docs/devteam/run/supervisor-up.json');
  write(up, JSON.stringify({ up: true, kind: 'tmux', pane: far, server: '1' }));
  refusedWith(await keysTo(T, port, 'supervisor', keysBody(tok, far, 1)), 409, W.down, 'a foreign pane');
  assert.equal(sends(T), 0, 'a foreign pane: nothing sent');
  fs.rmSync(up);
  // a second stand-in marked: the first's id is stale (423), and it is never typed into
  const s2 = T.standIn({ lines: ['A6 second stand-in'] });
  await screenUntil(T, port, (j) => j.state === 'live' && j.pane === s2.pane, 'the second live');
  base = await typedState(T, port, s2);
  refusedWith(await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 1)), 423, W.moved, 'the old pane');
  await nothingTyped(T, port, s2, base, 'the old pane');
  assert.equal(String(await s.received()), '', 'the old pane got nothing');
  // killed: 409, and the screen reads gone
  s2.kill();
  refusedWith(await keysTo(T, port, 'supervisor', keysBody(tok, s2.pane, 1)), 409, W.down, 'a killed pane');
  isGone((await screenUntil(T, port, (j) => j.state === 'gone', 'gone when killed')).json);
  assert.equal(sends(T), 0, 'a killed pane: nothing sent');
  // a post just after a screen GET, inside a long cache, makes its own read (S2, S2-1): the stand-in
  // has exited to a shell since the GET, which only a fresh read sees
  await dash.stop();
  const s3 = T.standIn({ lines: ['A6 third stand-in'] });
  const long = await T.dashboard([], { DEVTEAM_TERM_CACHE_MS: '10000' });
  const tok2 = await tokenOf(T, long.port);
  const g = await screenUntil(T, long.port, (j) => j.state === 'live' && j.pane === s3.pane, 'the third live');
  assert.equal(g.json.pane, s3.pane);
  const reads = T.oneCallReads();
  await s3.exit();
  assert.equal((await screenOf(T, long.port)).json.state, 'live', 'the cache still holds the live screen');
  assert.equal(T.oneCallReads(), reads, 'and read nothing');
  refusedWith(await keysTo(T, long.port, 'supervisor', keysBody(tok2, s3.pane, 1, { data: hex('echo typed\r') })), 409, W.down, 'exited to a shell, inside the cache');
  assert.equal(T.oneCallReads(), reads + 1, 'the post made its own one-call read');
  await pause(300);
  assert.equal(sends(T), 0, 'an exited pane: nothing sent');
  assert.doesNotMatch(tmuxOut(T, ['capture-pane', '-p', '-t', s3.pane]), /typed/, 'the shell got nothing');
  s3.kill();
  s.kill();
});

// ---- the Shell (terminal@1 §9, §10) ----
// a window of its own in `target` running a sleeper: its pane id
const sleeper = (T, target, name, cwd) => { const m = spawnSync('tmux', ['new-window', '-d', '-P', '-F', '#{pane_id}', '-t', target, '-n', name, '-c', cwd, process.execPath, '-e', 'setInterval(() => {}, 1000)'], { env: T.env, encoding: 'utf8' }); assert.equal(m.status, 0, m.stderr); return m.stdout.trim(); };
const tagPane = (T, pane, value) => assert.equal(spawnSync('tmux', ['set-option', '-p', '-t', pane, '@devteam-shell', value], { env: T.env }).status, 0, `tag ${pane}`);
// what an agent's session carries, named here, never read from the script (S2-3)
const AGENT_ENV = ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_HUB_RECORD', 'DEVTEAM_CHANNEL', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_PID'];
const openShellAt = (T, port, token, cols, rows) => T.post(port, '/api/term/shell/open', { ...openBody(token), cols, rows }, SAME);
// the session's panes in windows named shell: id, start path, tag, window size
const shellPanes = (T, session = T.session) => tmuxOut(T, ['list-panes', '-s', '-t', `=${session}`, '-F', '#{window_name}\t#{pane_id}\t#{pane_start_path}\t#{@devteam-shell}\t#{window_width}x#{window_height}']).split('\n').filter((l) => l.startsWith('shell\t')).map((l) => l.split('\t').slice(1));

test('terminal A6: the Shell is the lowest-id pane tagged with this root in this session, never the marked one; shell/open makes one clean window per project, sized; terminal A4: echo hi on the Shell; terminal A5c: the Shell made the marked pane is 423', async () => {
  const T = termFixture('term-shell');
  after(() => T.done());
  // the marked supervisor pane, tagged with this root, and the lowest id: never the Shell
  const s = T.standIn({ lines: ['shell stand-in'] });
  tagPane(T, s.pane, T.root);
  // tagged with another root; and, in another session on this server, tagged with this root
  const otherRoot = sleeper(T, `=${T.session}:`, 'decoy', T.root);
  tagPane(T, otherRoot, path.join(T.F.base, 'elsewhere'));
  assert.equal(spawnSync('tmux', ['new-session', '-d', '-s', 'another-project', '-c', T.F.base], { env: T.env }).status, 0, 'another session');
  const elsewhere = sleeper(T, '=another-project:', 'shell', T.root);
  tagPane(T, elsewhere, T.root);
  // two tagged panes across a digit boundary, %9 and %10: by number %9 is lower, by string %10
  const ids = [];
  while (ids.length < 2) { const p = sleeper(T, `=${T.session}:`, 'tagged', T.root); if (Number(p.slice(1)) >= 9) ids.push(p); else spawnSync('tmux', ['kill-pane', '-t', p], { env: T.env }); }
  assert.deepEqual(ids, ['%9', '%10'], 'the ids cross a digit boundary');
  tagPane(T, '%10', T.root);
  tagPane(T, '%9', T.root);
  const { port } = await T.dashboard();
  const tok = await tokenOf(T, port);
  const shellScreen = () => screenOf(T, port, 'shell');
  let g = await shellScreen();
  assert.equal(g.status, 200, g.text);
  assert.equal(g.json.state, 'live', g.text);
  assert.equal(g.json.pane, '%9', 'the numerically lowest tagged pane');
  // the remembered pane retagged: dropped, and looked up again
  tagPane(T, '%9', path.join(T.F.base, 'elsewhere'));
  await pause(150);
  g = await shellScreen();
  assert.equal(g.json.pane, '%10', g.text);
  // the remembered pane gone: none of this root in this session but the marked one
  spawnSync('tmux', ['kill-pane', '-t', '%10'], { env: T.env });
  await pause(150);
  g = await shellScreen();
  assert.equal(g.status, 200, g.text);
  isGone(g.json, 'shell');
  // an agent's environment in the server's global one: the Shell gets none of it
  for (const k of AGENT_ENV) assert.equal(spawnSync('tmux', ['set-environment', '-g', k, 'x'], { env: T.env }).status, 0, k);
  const global = tmuxOut(T, ['show-environment', '-g']).split('\n');
  for (const k of AGENT_ENV) assert.ok(global.includes(`${k}=x`), `the server's global environment has ${k}`);
  assert.equal(shellPanes(T).length, 0, 'no Shell yet');
  // two opens at once make one window (T5-2)
  const [o, oo] = await Promise.all([openShellAt(T, port, tok, 100, 30), openShellAt(T, port, tok, 100, 30)]);
  assert.equal(o.status, 200, o.text);
  assert.equal(oo.status, 200, oo.text);
  assert.equal(oo.json.pane, o.json.pane, 'two opens at once: one pane');
  assert.equal(o.headers['cache-control'], 'no-store');
  assert.equal(o.json.which, 'shell');
  assert.equal(o.json.state, 'live');
  const pane = o.json.pane;
  assert.match(pane, /^%\d+$/);
  assert.ok(![s.pane, otherRoot, elsewhere, ...ids].includes(pane), `a new pane: ${pane}`);
  assert.deepEqual([o.json.cols, o.json.rows], [100, 30], 'the answer is the sized screen');
  assert.equal(shellWindows(T), 1, 'one shell window');
  assert.deepEqual(shellPanes(T), [[pane, T.root, T.root, '100x30']], 'at the root, tagged with it, sized');
  // A4 on the Shell: typed with -H, and a line exactly hi within 5 s
  const sent = T.callSpans('send-keys').length;
  const k = await keysTo(T, port, 'shell', keysBody(tok, pane, 1, { data: '6563686f2068690d' }, 'shell'));
  assert.equal(k.status, 200, k.text);
  assert.equal(k.json.taken, true);
  assert.equal(T.callSpans('send-keys').length, sent + 1);
  let last;
  for (const stop = Date.now() + 5000; Date.now() < stop; await pause(100)) { last = await shellScreen(); if (last.json?.lines?.includes('hi')) break; }
  assert.ok(last.json?.lines?.includes('hi'), `a line exactly hi: ${last.text}`);
  if (process.platform === 'linux') {
    const pid = tmuxOut(T, ['display', '-p', '-t', pane, '#{pane_pid}']).trim();
    const environ = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
    const names = environ.map((l) => l.split('=')[0]);
    for (const k of AGENT_ENV) assert.ok(!names.includes(k), `the Shell has no ${k}`);
    assert.ok(environ.includes(`TMUX_PANE=${pane}`), 'the Shell has its own TMUX_PANE');
  }
  // a second open, another size: the same window, resized
  const o2 = await openShellAt(T, port, tok, 90, 20);
  assert.equal(o2.status, 200, o2.text);
  assert.equal(o2.json.pane, pane);
  assert.deepEqual([o2.json.cols, o2.json.rows], [90, 20]);
  assert.equal(shellWindows(T), 1, 'still one shell window');
  assert.deepEqual(shellPanes(T), [[pane, T.root, T.root, '90x20']]);
  // a stale pane id: 423, nothing typed
  const before = sends(T);
  for (const stale of ['%9999', '%10']) refusedWith(await keysTo(T, port, 'shell', keysBody(tok, stale, 2, { data: hex('echo stale\r') }, 'shell')), 423, W.moved, `a stale pane ${stale}`);
  // A5c: the Shell's own pane made the marked one: 423, nothing typed
  markPane(T, pane);
  refusedWith(await keysTo(T, port, 'shell', keysBody(tok, pane, 2, { data: hex('echo marked\r') }, 'shell')), 423, W.moved, 'the Shell made the marked pane');
  markPane(T, s.pane);
  await pause(300);
  assert.equal(sends(T), before, 'nothing sent');
  assert.doesNotMatch(tmuxOut(T, ['capture-pane', '-p', '-t', pane]), /stale|marked/, 'the Shell got nothing');
  // unmarked again it is the Shell once more, and the other session's tagged pane never was
  const back = await openShellAt(T, port, tok, 90, 20);
  assert.equal(back.json.pane, pane, back.text);
  assert.equal(shellWindows(T), 1);
  // a second project's dashboard on the same tmux server opens its own Shell
  const F2 = fleetFixture('term-shell-2');
  let d2 = null;
  after(async () => { if (d2) await d2.dash.stop(); F2.done(); });
  const root2 = F2.old;
  const session2 = sessionOf(root2, 'term-shell-2');
  const allWindows = () => tmuxOut(T, ['list-windows', '-a', '-F', '#{session_name}:#{window_id}']);
  // T5-3: its session missing, open is 409 and no window appears anywhere (the dashboard first)
  d2 = await dashboardOnFreePort(root2, { ...F2.env({}), TMUX_TMPDIR: T.env.TMUX_TMPDIR });
  const windows = allWindows();
  refusedWith(await openShellAt(T, d2.port, await tokenOf(T, d2.port), 80, 24), 409, 'the shell could not be opened', 'no session');
  assert.equal(allWindows(), windows, 'no window anywhere');
  assert.equal(spawnSync('tmux', ['new-session', '-d', '-x', '80', '-y', '24', '-s', session2, '-n', 'main', '-c', root2], { env: T.env }).status, 0, 'the second session');
  const o3 = await openShellAt(T, d2.port, await tokenOf(T, d2.port), 80, 24);
  assert.equal(o3.status, 200, o3.text);
  assert.notEqual(o3.json.pane, pane, 'its own pane');
  assert.deepEqual(shellPanes(T, session2), [[o3.json.pane, root2, root2, '80x24']], 'in its own session, tagged with its own root');
  assert.equal(o3.json.which, 'shell');
  assert.deepEqual(shellPanes(T), [[pane, T.root, T.root, '90x20']], 'this project\'s untouched');
  assert.equal((await openShellAt(T, port, tok, 90, 20)).json.pane, pane, 'and still its own');
  // T5-1: a dead Shell kept by remain-on-exit never shadows a live one
  assert.equal(spawnSync('tmux', ['set-option', '-w', '-t', pane, 'remain-on-exit', 'on'], { env: T.env }).status, 0);
  const ex = await keysTo(T, port, 'shell', keysBody(tok, pane, 3, { data: hex('exit\r') }, 'shell'));
  assert.equal(ex.json?.taken, true, ex.text);
  await until(() => tmuxOut(T, ['display', '-p', '-t', pane, '#{pane_dead}']).trim() === '1', 'the first Shell dead, its pane kept');
  const fresh = await openShellAt(T, port, tok, 90, 20);
  assert.equal(fresh.status, 200, fresh.text);
  assert.equal(fresh.json.state, 'live');
  const live = fresh.json.pane;
  assert.ok(Number(live.slice(1)) > Number(pane.slice(1)), `a new, higher pane: ${live} after ${pane}`);
  // the remembered id dropped (the live pane retagged a moment, so the read moves off it): the lookup
  // that follows picks the live pane, not the dead one with the lower id
  tagPane(T, live, path.join(T.F.base, 'elsewhere'));
  await pause(150);
  isGone((await shellScreen()).json, 'shell');
  tagPane(T, live, T.root);
  await pause(150);
  const found = await shellScreen();
  assert.equal(found.json.pane, live, `the live pane, not the dead ${pane}: ${found.text}`);
  const typed = await keysTo(T, port, 'shell', keysBody(tok, live, 4, { data: hex('echo again\r') }, 'shell'));
  assert.equal(typed.status, 200, typed.text);
  assert.equal(typed.json.taken, true);
  s.kill();
});

test('terminal A7c: posts one at a time in arrival order, each seq taken once; a paste whole and bracketed; a failed send keeps its seq', async () => {
  const T = termFixture('term-a7c');
  after(() => T.done());
  const s = T.standIn({ lines: ['A7c stand-in'] });
  const { port } = await T.dashboard();
  await screenUntil(T, port, (j) => j.state === 'live' && j.pane === s.pane, 'live');
  const tok = await tokenOf(T, port);
  const delay = path.join(T.F.base, 'tmux-delay.json');
  write(delay, JSON.stringify({ 'send-keys': 150 }));
  T.clearCalls();
  const answers = await Promise.all(Array.from({ length: 10 }, (_, i) => keysTo(T, port, 'supervisor', keysBody(tok, s.pane, i + 1, { data: hex(String(i)) }))));
  const got = String(await s.received(1));
  assert.match(got, /^[0-9]+$/, got);
  for (let i = 1; i < got.length; i++) assert.ok(got[i] > got[i - 1], `strictly increasing: ${got}`);
  answers.forEach((r, i) => { assert.equal(r.status, 200, r.text); assert.equal(r.json.taken, got.includes(String(i)), `seq ${i + 1}: taken ${r.json.taken}, received ${got}`); });
  assert.ok(got.includes('9'), 'the highest seq is always taken');
  const spans = T.callSpans('send-keys').sort((a, b) => a.start - b.start);
  assert.equal(spans.length, got.length, 'one send-keys per taken post');
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i].start >= spans[i - 1].end, `send-keys overlap: ${JSON.stringify(spans)}`);
  // the highest taken seq again: taken false, nothing more typed
  const base = await typedState(T, port, s);
  const rep = await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 10, { data: hex('9') }));
  assert.equal(rep.status, 200, rep.text);
  assert.equal(rep.json.taken, false);
  assert.equal(rep.json.state, 'live');
  assert.equal(rep.json.pane, s.pane);
  await nothingTyped(T, port, s, base, 'a repeat');
  // another page counts its own seqs
  const other = await keysTo(T, port, 'supervisor', { ...keysBody(tok, s.pane, 1, { data: hex('p') }), page: 'another-page-0123456789' });
  assert.equal(other.json.taken, true, other.text);
  fs.rmSync(delay);
  // a two-line paste into a program that asked for bracketed paste: one bracketed paste, no Enter after
  await s.say('\x1b[?2004hbracketed');
  const before = String(await s.received());
  const p = await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 11, { paste: 'one\ntwo' }));
  assert.equal(p.status, 200, p.text);
  assert.equal(p.json.taken, true);
  const pasted = String(await s.received(before.length + 1)).slice(before.length);
  assert.match(pasted, /^\x1b\[200~one[\r\n]two\x1b\[201~$/, JSON.stringify(pasted));
  assert.equal(T.callSpans('paste-buffer').length, 1, 'one paste-buffer');
  assert.equal(T.callSpans('load-buffer').length, 1, 'one load-buffer');
  const buffers = () => tmuxOut(T, ['list-buffers', '-F', '#{buffer_name}']);
  assert.doesNotMatch(buffers(), /devteam-term-/, 'no buffer left');
  // B-1: a paste can't end its own bracket: every ESC[200~ and ESC[201~ in it is dropped, again until
  // none is left (a drop can join two halves into a marker), so its Enter stays inside the one bracket
  const bp = 'bracket-page-0123456789';
  for (const [i, [text, want]] of [['one\x1b[201~two\r', 'onetwo\r'], ['a\x1b[20\x1b[201~1~b\x1b[2\x1b[200~00~c\r', 'abc\r']].entries()) {
    const at = String(await s.received()).length;
    const r = await keysTo(T, port, 'supervisor', { ...keysBody(tok, s.pane, i + 1, { paste: text }), page: bp });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.taken, true);
    const got = String(await s.received(at + 1)).slice(at);
    assert.equal(got, `\x1b[200~${want}\x1b[201~`, `one bracket, the Enter inside it: ${JSON.stringify(got)}`);
  }
  // a paste of nothing but markers is empty: 400, as an empty paste is; nothing typed, its seq free
  const b1 = await typedState(T, port, s);
  refusedWith(await keysTo(T, port, 'supervisor', { ...keysBody(tok, s.pane, 3, { paste: '\x1b[20\x1b[201~0~' }), page: bp }), 400, W.shape, 'a paste of markers only');
  await nothingTyped(T, port, s, b1, 'a paste of markers only');
  const bx = await keysTo(T, port, 'supervisor', { ...keysBody(tok, s.pane, 3, { paste: 'x' }), page: bp });
  assert.equal(bx.json.taken, true, bx.text);
  // a paste-buffer that fails: 500, its buffer deleted, its seq used
  const fail = path.join(T.F.base, 'tmux-fail.json');
  let b2 = await typedState(T, port, s);
  write(fail, JSON.stringify({ 'paste-buffer': 'server exited unexpectedly' }));
  refusedWith(await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 12, { paste: 'three' })), 500, W.sent, 'a failed paste');
  assert.equal(T.callSpans('delete-buffer').length, 1, 'the buffer deleted');
  assert.doesNotMatch(buffers(), /devteam-term-/, 'no buffer left after a failed paste');
  fs.rmSync(fail);
  const rp = await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 12, { paste: 'three' }));
  assert.equal(rp.status, 200, rp.text);
  assert.equal(rp.json.taken, false, 'a failed send keeps its seq');
  b2 = { ...b2, sends: b2.sends + 2 };
  await nothingTyped(T, port, s, b2, 'a failed paste and its resend');
  // a send-keys that fails: the same
  write(fail, JSON.stringify({ 'send-keys': 'server exited unexpectedly' }));
  refusedWith(await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 13, { data: hex('z') })), 500, W.sent, 'a failed send-keys');
  fs.rmSync(fail);
  const rk = await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 13, { data: hex('z') }));
  assert.equal(rk.json.taken, false, rk.text);
  await nothingTyped(T, port, s, { ...b2, sends: b2.sends + 1 }, 'a failed send-keys and its resend');
  const next = await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 14, { data: hex('z') }));
  assert.equal(next.json.taken, true, next.text);
  assert.ok(String(await s.received()).endsWith('z'));
  // T4-4: a 4096-byte data post is taken whole
  let had = String(await s.received()).length;
  const full = await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 15, { data: '62'.repeat(4096) }));
  assert.equal(full.status, 200, full.text);
  assert.equal(full.json.taken, true);
  assert.equal(String(await s.received(had + 4096)).slice(had), 'b'.repeat(4096));
  // T4-4: the same seq posted twice at once types once
  had = String(await s.received()).length;
  const twice = await Promise.all([0, 1].map(() => keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 16, { data: hex('Y') }))));
  for (const r of twice) assert.equal(r.status, 200, r.text);
  assert.deepEqual(twice.map((r) => r.json.taken).sort(), [false, true]);
  assert.equal(String(await s.received(had + 1)).slice(had), 'Y');
  // T4-1: every read after a taken send failing: the answer is the pre-send screen, taken
  await pause(150);
  write(delay, JSON.stringify({ 'send-keys': 3000 }));
  T.clearCalls();
  const pending = keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 17, { data: hex('Q7') }));
  await until(() => T.callLog().some((c) => c.cmds.join('+') === 'display+capture-pane'), 'the pre-send read');
  write(fail, JSON.stringify({ 'display+capture-pane': 'server exited unexpectedly' }));
  const q = await pending;
  fs.rmSync(fail);
  fs.rmSync(delay);
  assert.equal(q.status, 200, q.text);
  assert.equal(q.json.taken, true);
  assert.equal(q.json.state, 'live');
  assert.ok(!q.json.lines.some((l) => l.includes('Q7')), `the pre-send screen: ${JSON.stringify(q.json.lines)}`);
  assert.ok(T.callLog().filter((c) => c.cmds.join('+') === 'display+capture-pane').length > 1, 'it read after the send');
  assert.ok(String(await s.received()).endsWith('Q7'), 'and the keys went');
  // T4-3: a failed paste whose buffer can't be deleted: the log names the buffer, never its text
  write(fail, JSON.stringify({ 'paste-buffer': 'server exited unexpectedly', 'delete-buffer': 'server exited unexpectedly' }));
  refusedWith(await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 18, { paste: 'secret-paste-T43' })), 500, W.sent, 'a failed paste, its buffer kept');
  fs.rmSync(fail);
  const left = buffers().split('\n').filter((n) => n.startsWith('devteam-term-'));
  assert.equal(left.length, 1, 'the buffer is still there');
  const dlog = path.join(T.root, 'docs/devteam/run/dashboard.log');
  await until(() => fs.readFileSync(dlog, 'utf8').includes(left[0]), 'the buffer named in the log');
  assert.ok(!fs.readFileSync(dlog, 'utf8').includes('secret-paste-T43'), 'never its text');
  assert.equal(spawnSync('tmux', ['delete-buffer', '-b', left[0]], { env: T.env }).status, 0);
  // B-2: a post whose client went while it waited its turn types nothing and leaves its seq free
  const gp = 'gone-client-page-0123456789';
  had = String(await s.received()).length;
  write(delay, JSON.stringify({ 'send-keys': 1500 }));
  T.clearCalls();
  const first = keysTo(T, port, 'supervisor', { ...keysBody(tok, s.pane, 1, { data: hex('G') }), page: gp });
  await until(() => T.callLog().some((c) => c.cmds.join('+') === 'display+capture-pane'), 'the first post\'s read');
  const body2 = JSON.stringify({ ...keysBody(tok, s.pane, 2, { data: hex('H') }), page: gp });
  const second = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/term/supervisor/keys', setHost: false, headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, ...SAME, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body2)) } });
  second.on('error', () => {});
  second.end(body2);
  await pause(400);
  second.destroy();
  const g = await first;
  assert.equal(g.status, 200, g.text);
  assert.equal(g.json.taken, true);
  // a repeat of the first, queued behind the gone one: when it answers, the gone one's turn is over
  const rep1 = await keysTo(T, port, 'supervisor', { ...keysBody(tok, s.pane, 1, { data: hex('G') }), page: gp });
  assert.equal(rep1.json.taken, false, rep1.text);
  fs.rmSync(delay);
  assert.equal(String(await s.received(had + 1)).slice(had), 'G', 'only the first post typed');
  assert.equal(T.callSpans('send-keys').length, 1, 'one send-keys');
  assert.match(fs.readFileSync(dlog, 'utf8'), /refused \/api\/term\/supervisor\/keys: the client went before its turn/);
  const again = await keysTo(T, port, 'supervisor', { ...keysBody(tok, s.pane, 2, { data: hex('H') }), page: gp });
  assert.equal(again.json.taken, true, `its seq was not used: ${again.text}`);
  assert.equal(String(await s.received(had + 2)).slice(had), 'GH');
  s.kill();
});

// ---- nothing typed is logged; agent HTML stays sandboxed (terminal@1 not-logged, S14) ----
const filesUnder = (dir) => { const out = []; const walk = (d) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.isFile()) out.push(p); } }; walk(dir); return out; };
// every place the marker could be: the marker, its hex (both cases) and its UTF-8 bytes
const leaks = (T, dash, marker) => {
  const needles = [marker, hex(marker), hex(marker).toUpperCase(), Buffer.from(marker, 'utf8').toString('latin1')];
  const bad = [];
  const holds = (buf) => needles.some((n) => buf.includes(Buffer.from(n, 'latin1')));
  if (holds(Buffer.from(dash.out(), 'utf8'))) bad.push('the dashboard output');
  for (const d of ['docs/devteam/run', 'docs/devteam/project/log']) for (const f of filesUnder(path.join(T.root, d))) if (holds(fs.readFileSync(f))) bad.push(f);
  return bad;
};

test('terminal not logged: a typed or pasted marker, sent, refused or failed, is in no log, no file and no output', async () => {
  const T = termFixture('term-nolog');
  after(() => T.done());
  const marker = `kit612-marker-${crypto.randomBytes(8).toString('hex')}`;
  const s = T.standIn({ lines: ['not-logged stand-in'] });
  const { dash, port } = await T.dashboard();
  await screenUntil(T, port, (j) => j.state === 'live' && j.pane === s.pane, 'live');
  const tok = await tokenOf(T, port);
  const o = await openShellAt(T, port, tok, 80, 24);
  assert.equal(o.status, 200, o.text);
  const shell = o.json.pane;
  let seq = 0, shellSeq = 0;
  const sup = (more, extra) => keysTo(T, port, 'supervisor', keysBody(tok, s.pane, ++seq, more), extra);
  const sh = (more) => keysTo(T, port, 'shell', keysBody(tok, shell, ++shellSeq, more, 'shell'));
  // typed (as data) and pasted, on both tabs
  for (const r of [await sup({ data: hex(marker) }), await sup({ paste: marker }), await sh({ data: hex(marker) }), await sh({ paste: marker })]) { assert.equal(r.status, 200, r.text); assert.equal(r.json.taken, true); }
  assert.ok(String(await s.received()).includes(marker), 'the marker was typed on the supervisor');
  // refused: a wrong token, and a body of another shape, each carrying it
  refusedWith(await keysTo(T, port, 'supervisor', { ...keysBody(tok, s.pane, ++seq, { data: hex(marker) }), token: 'f'.repeat(64) }), 403, W.token, 'a wrong token');
  refusedWith(await keysTo(T, port, 'supervisor', { ...keysBody(tok, s.pane, ++seq, { data: hex(marker) }), extra: marker }), 400, W.shape, 'a body of the wrong shape');
  // failed: a send-keys, a paste-buffer and a load-buffer that fail
  const fail = path.join(T.F.base, 'tmux-fail.json');
  for (const [key, more, tab] of [['send-keys', { data: hex(marker) }, sup], ['paste-buffer', { paste: marker }, sup], ['load-buffer', { paste: marker }, sup], ['send-keys', { data: hex(marker) }, sh], ['paste-buffer', { paste: marker }, sh]]) {
    write(fail, JSON.stringify({ [key]: `server exited unexpectedly ${key}` }));
    const r = await tab(more);
    fs.rmSync(fail);
    assert.equal(r.status, 500, `${key}: ${r.text}`);
  }
  await pause(300);
  assert.deepEqual(leaks(T, dash, marker), [], 'the marker, its hex and its bytes are nowhere');
  assert.ok(fs.existsSync(path.join(T.root, 'docs/devteam/run/dashboard.log')) || dash.out().length > 0, 'there was output to search');
  // the check can fail: the marker written to run/ by hand is found
  const planted = path.join(T.root, 'docs/devteam/run/planted');
  write(planted, `${marker}\n`);
  assert.deepEqual(leaks(T, dash, marker), [planted], 'a planted marker is seen');
  fs.rmSync(planted);
  s.kill();
});

// a header's directives, split on ; and trimmed
const directives = (csp) => String(csp ?? '').split(';').map((d) => d.trim()).filter(Boolean);
const assertSandboxed = (r, what) => {
  assert.equal(r.status, 200, `${what}: ${r.status} ${r.text.slice(0, 200)}`);
  const sb = directives(r.headers['content-security-policy']).filter((d) => d.split(/\s+/)[0].toLowerCase() === 'sandbox');
  assert.equal(sb.length, 1, `${what}: one sandbox directive in ${r.headers['content-security-policy']}`);
  assert.ok(!sb[0].split(/\s+/).slice(1).includes('allow-same-origin'), `${what}: ${sb[0]} lifts the origin`);
};

test('terminal sandbox: artifacts, repo files, review pages and dropped files are served in a sandbox without allow-same-origin', async () => {
  const T = termFixture('term-sbx');
  after(() => T.done());
  const git = (args) => spawnSync('git', args, { cwd: T.root, encoding: 'utf8' });
  const art = 'docs/devteam/project/artifacts/sbx';
  write(path.join(T.root, art, 'index.html'), '<!doctype html><title>x</title><p>agent page</p>\n');
  write(path.join(T.root, art, 'pic.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>\n');
  write(path.join(T.root, 'a.html'), '<!doctype html><script>1</script>\n');
  write(path.join(T.root, 'a.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>\n');
  write(path.join(T.root, 'a.xml'), '<?xml version="1.0"?><a/>\n');
  for (const a of [['add', '-A'], ['commit', '-qm', 'sandbox fixtures'], ['push', '-q', 'origin', 'main']]) { const g = git(a); assert.equal(g.status, 0, `${a.join(' ')}: ${g.stderr}`); }
  const { port } = await T.dashboard([], { HOME: fs.mkdtempSync(path.join(T.F.base, 'home-')) });
  const frame = { ...SAME, 'sec-fetch-dest': 'iframe' };
  const get = (p, headers) => T.req(port, 'GET', p, { headers });
  for (const h of [frame, SAME, {}]) {
    assertSandboxed(await get(`/artifact/main/sbx/index.html`, h), `artifact page ${JSON.stringify(h)}`);
    assertSandboxed(await get(`/artifact/main/sbx/`, h), `artifact root ${JSON.stringify(h)}`);
    assertSandboxed(await get(`/artifact/main/sbx/pic.svg`, h), `artifact svg ${JSON.stringify(h)}`);
  }
  for (const f of ['a.html', 'a.svg', 'a.xml']) assertSandboxed(await get(`/api/file?path=${f}`, SAME), `/api/file ${f}`);
  assertSandboxed(await get('/review/preview/?path=a.html', frame), 'review page');
  // dropped as the page drops them: a post with its own Origin, then read back as the page would
  for (const name of ['drop.html', 'drop.svg']) {
    const body = name.endsWith('html') ? '<script>1</script>' : '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const up = await T.req(port, 'POST', `/upload?name=${name}`, { headers: { origin: `http://127.0.0.1:${port}`, ...SAME, 'content-length': String(Buffer.byteLength(body)) }, body });
    assert.equal(up.status, 200, `upload ${name}: ${up.text}`);
    const [, folder, file] = /\/([^/]+)\/([^/]+)$/.exec(up.json.path);
    for (const h of [frame, SAME]) assertSandboxed(await get(`/upload/${folder}/${file}`, h), `/upload ${name} ${JSON.stringify(h)}`);
  }
  // the check can fail: no header, and a lifted one, are each refused by it
  assert.throws(() => assertSandboxed({ status: 200, text: '', headers: {} }, 'none'));
  assert.throws(() => assertSandboxed({ status: 200, text: '', headers: { 'content-security-policy': "default-src 'none'; sandbox allow-scripts allow-same-origin" } }, 'lifted'));
});
