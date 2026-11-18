// The dashboard's terminal (kit-612, terminal@1): the supervisor's pane, read and typed into over
// /api/term. The fixture: a fleet, its session, a stand-in agent in a window of it, a dashboard whose
// tmux is a wrapper that logs each call's subcommands and can hold or fail the terminal's own calls.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
// A request with exactly these headers (Host too: 127.0.0.1:<port> unless given).
export function req(port, method, p, { headers = {}, body } = {}) {
  const h = Object.keys(headers).some((k) => k.toLowerCase() === 'host') ? headers : { host: `127.0.0.1:${port}`, ...headers };
  const data = body === undefined ? null : Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: h, setHost: false }, (res) => {
      const parts = [];
      res.on('data', (b) => parts.push(b));
      res.on('end', () => { const text = Buffer.concat(parts).toString('utf8'); let j = null; try { j = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, text, json: j }); });
      res.on('error', reject);
    });
    r.on('error', reject);
    r.end(data ?? undefined);
  });
}
export const post = (port, p, body, extra = {}) => req(port, 'POST', p, { headers: { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json', ...extra }, body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) });

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
  // a dashboard on another address: not-loopback, after view
  const wide = await T.dashboard(['--host', '0.0.0.0']);
  const wideHost = { host: `0.0.0.0:${wide.port}` };
  for (const p of reads) {
    refusedWhy(await T.req(wide.port, 'GET', p, { headers: { ...SAME, ...wideHost } }), 'not-loopback', `${p} on 0.0.0.0`);
    refusedWhy(await T.req(wide.port, 'GET', p, { headers: { ...SAME, host: `127.0.0.1:${wide.port}` } }), 'not-loopback', `${p} on 0.0.0.0, by 127.0.0.1`);
    refusedWhy(await T.req(wide.port, 'GET', p, { headers: { 'sec-fetch-site': 'cross-site', ...wideHost } }), 'not-loopback', `${p} on 0.0.0.0, not-loopback before cross-site`);
    refusedWhy(await T.req(wide.port, 'GET', p, { headers: { ...SAME, 'x-devteam-level': 'view', ...wideHost } }), 'view', `${p} on 0.0.0.0, view first`);
  }
  refusedWhy(await T.req(wide.port, 'GET', '/api/term/token', { headers: { ...SAME, ...wideHost } }), 'not-loopback', 'token on 0.0.0.0');
  refusedWhy(await T.post(wide.port, '/api/term/shell/open', {}, { ...SAME, ...wideHost, origin: `http://0.0.0.0:${wide.port}` }), 'not-loopback', 'open on 0.0.0.0', true);
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
