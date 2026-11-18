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
  assert.ok(Date.now() - t0 < 1000, `hello took ${Date.now() - t0} ms`);
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
