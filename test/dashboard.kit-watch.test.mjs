// Kit watch: a dashboard restarts into the new kit when its own files change, or stays and says so.
// Ports: +91/92 each kit watch test's hub and base (kwEnv; serial)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PORTS, kit, freePort, write, bareProject, until, threadsFixture, hasTmux } from './lib/kit.mjs';
import { cleanup } from './lib/dashboard-page.mjs';

// ----- kit watch (kit-288): a dashboard runs the kit it serves. When its own kit files change
// (scripts/devteam.mjs, dashboard/*.html|js|css) and settle, it finishes what is in flight and hands
// over to the new code: it exits under a while loop (the box's), respawns its own tmux pane (a
// laptop's window), and otherwise stays and says so in run/dashboard.log.
const KW_WATCH = `const g = Number(process.argv[1]); const end = () => { try { process.kill(-g, 'SIGKILL'); } catch {} process.exit(0); };
process.stdin.on('end', end); process.stdin.on('close', end); process.stdin.on('error', end); process.stdin.resume();`;
const kwSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kwAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const KW_GIT = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
const kwHello = async (port) => { try { const r = await fetch(`http://127.0.0.1:${port}/api/hello`); return r.ok ? await r.json() : null; } catch { return null; } };
const kwLogOf = (root) => () => { try { return fs.readFileSync(path.join(root, 'docs/devteam/run/dashboard.log'), 'utf8'); } catch { return ''; } };
// each started line: its pid and its text
const kwStartsOf = (log) => () => log().split('\n').filter((l) => / started (\(kit B\) )?on http/.test(l)).map((l) => ({ pid: Number(l.match(/\[(\d+)\]/)?.[1]), line: l }));
function kwEnv(base, extra = {}) {
  const env = { ...process.env, HOME: path.join(base, 'home'), DEVTEAM_HUB_PORT: String(PORTS + 91), DEVTEAM_PORT_BASE: String(PORTS + 92), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex'), DEVTEAM_KIT_WATCH_MS: '200', ...extra };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'DEVTEAM_DASHBOARD_RESTART', 'TMUX', 'TMUX_PANE']) if (!(k in extra)) delete env[k];
  fs.mkdirSync(env.HOME, { recursive: true });
  return env;
}
// A project of its own on release v0.0.1, its whole tree committed, so its kit reads v0.0.1 (not +local).
function kwFixture(t, name) {
  const later = cleanup(t);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `devteam-kw-${name}-`));
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const root = bareProject(base, name);
  const sf = path.join(root, 'docs/devteam/project/settings.md');
  const s = fs.readFileSync(sf, 'utf8');
  assert.match(s, /"upstream_base": null/);
  fs.writeFileSync(sf, s.replace('"upstream_base": null', '"upstream_base": "v0.0.1"'));
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', [...KW_GIT, 'commit', '-qm', 'v0.0.1'], { cwd: root });
  const dt = path.join(root, 'docs/devteam/scripts/devteam.mjs');
  return { base, root, dt, env: kwEnv(base), later, orig: fs.readFileSync(dt, 'utf8') };
}
// The new kit: the original script with a marker in its start line. With base, made in a clone and
// fast-forwarded in, so the files and main move in one step and the kit reads as that release.
function kitB(F, { base = null, text = null } = {}) {
  const b = text ?? F.orig.replace('started on http://', 'started (kit B) on http://');
  assert.notEqual(b, F.orig, 'the start line is marked');
  if (!base) return void fs.writeFileSync(F.dt, b);
  const c = path.join(F.base, `b-${crypto.randomBytes(3).toString('hex')}`);
  execFileSync('git', ['clone', '-q', F.root, c]);
  fs.writeFileSync(path.join(c, 'docs/devteam/scripts/devteam.mjs'), b);
  const sf = path.join(c, 'docs/devteam/project/settings.md');
  fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace(/"upstream_base": "v[\d.]+"/, `"upstream_base": "${base}"`));
  execFileSync('git', [...KW_GIT, 'commit', '-qam', base], { cwd: c });
  execFileSync('git', ['pull', '-q', '--ff-only', c, 'main'], { cwd: F.root });
}
// A dashboard under a while loop, as the box runs it: a process group of its own, ended when the test
// is done (or by the watcher when the test process dies any way at all), and by its own condition
// when the test process or the fixture is gone. Resolved once /api/hello answers with a kit.
async function loopedDashboard(F, port, extra = {}) {
  const env = { ...F.env, ...extra };
  const loop = `while kill -0 ${process.pid} 2>/dev/null && [ -d '${F.root}' ]; do '${process.execPath}' '${F.dt}' dashboard --port ${port}; sleep 1; done`;
  const p = spawn('sh', ['-c', loop], { cwd: F.root, env, stdio: 'ignore', detached: true });
  p.on('error', () => {});
  const w = spawn(process.execPath, ['-e', KW_WATCH, String(p.pid)], { detached: true, stdio: ['pipe', 'ignore', 'ignore'] });
  w.on('error', () => {});
  w.stdin.on('error', () => {});
  w.unref();
  w.stdin.unref();
  p.unref();
  F.later(async () => {
    try { w.kill('SIGKILL'); } catch {}
    w.stdin.destroy();
    for (let i = 0; i < 200; i++) { try { process.kill(-p.pid, 'SIGKILL'); } catch { break; } await kwSleep(50); }
  });
  const log = kwLogOf(F.root);
  const starts = kwStartsOf(log);
  await until(async () => (await kwHello(port))?.kit, 'the looped dashboard with its kit');
  return { log, starts, group: p.pid };
}
const kwCount = (s, re) => (s.match(new RegExp(re.source, `${re.flags.replace('g', '')}g`)) ?? []).length;

// A request to the dashboard as its own page sends it: its body written by the test, part by part.
function kwPost(port, route, body) {
  const buf = Buffer.from(JSON.stringify(body));
  let resolveRes;
  const answered = new Promise((r) => { resolveRes = r; });
  const req = http.request({ host: '127.0.0.1', port, path: route, method: 'POST', headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin: `http://127.0.0.1:${port}`, 'content-length': buf.length } }, (res) => {
    let b = '';
    res.on('data', (c) => { b += c; });
    res.on('end', () => resolveRes({ status: res.statusCode, body: b }));
  });
  req.on('error', (e) => resolveRes({ status: 0, body: e.message }));
  return { buf, req, answered };
}

// tmux, in the test lib's own server only (its TMUX_TMPDIR shim): never the box's, never kill-server.
const kwTmux = (args) => { const r = spawnSync('tmux', args, { encoding: 'utf8', env: process.env, timeout: 20000 }); return { status: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }; };
const kwSq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
// a pane's command starts with the fixture's whole environment, so a pane's dashboard never touches
// the real ~/.devteam, hub or tmux
const kwInPane = (env, cmd) => `env ${Object.entries(env).filter(([k]) => /^(HOME|PATH|CLAUDE_CONFIG_DIR|CODEX_HOME|TMUX_TMPDIR|DEVTEAM_[A-Z0-9_]+)$/.test(k)).map(([k, v]) => kwSq(`${k}=${v}`)).join(' ')} ${cmd}`;
function kwSession(F, prefix) {
  const s = `${prefix}-${crypto.randomBytes(3).toString('hex')}`;
  F.later(() => { kwTmux(['kill-session', '-t', `=${s}`]); });
  return s;
}
const kwPanePid = (target) => Number(kwTmux(['display-message', '-p', '-t', target, '#{pane_pid}']).out);

test('kit watch: a looped dashboard restarts into the new kit when devteam.mjs changes, naming both versions', { timeout: 180000 }, async (t) => {
  const F = kwFixture(t, 'kwloop');
  const port = await freePort();
  const d = await loopedDashboard(F, port);
  const first = d.starts()[0].pid;
  assert.equal((await kwHello(port)).kit, 'v0.0.1');
  kitB(F, { base: 'v0.0.2' });
  await until(() => /restarting: kit files changed \(scripts\/devteam\.mjs\) from v0\.0\.1 to v0\.0\.2/.test(d.log()), 'the restarting line, with both versions');
  await until(() => d.starts().some((s) => s.line.includes(`started (kit B) on http://127.0.0.1:${port}`)), 'the new kit started');
  assert.equal(kwAlive(first), false, 'the old process is gone');
  await until(async () => (await kwHello(port))?.kit === 'v0.0.2', 'the address answers again, on v0.0.2');
});

test("kit watch: a dashboard page file restarts it too; the project's files do not", { timeout: 180000 }, async (t) => {
  const F = kwFixture(t, 'kwpage');
  const port = await freePort();
  const d = await loopedDashboard(F, port);
  const first = d.starts()[0].pid;
  write(path.join(F.root, 'docs/devteam/project/notes.md'), 'notes\n');
  const sf = path.join(F.root, 'docs/devteam/project/settings.md');
  fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace(/"project": "[^"]*"/, '"project": "kwpage-renamed"'));
  write(path.join(F.root, 'docs/devteam/run/x.txt'), 'x\n');
  await kwSleep(2000);
  assert.doesNotMatch(d.log(), /restarting/, "the project's own files restart nothing");
  assert.ok(kwAlive(first) && (await kwHello(port)), 'the first dashboard still answers');
  fs.appendFileSync(path.join(F.root, 'docs/devteam/dashboard/index.html'), '<!-- b -->\n');
  await until(() => /restarting: kit files changed \(dashboard\/index\.html\)/.test(d.log()) && d.starts().length === 2 && d.starts()[1].pid !== first, 'a restart for the page');
  await until(async () => (await kwHello(port))?.kit, 'the second dashboard with its kit');
  write(path.join(F.root, 'docs/devteam/dashboard/extra.css'), 'body {}\n');
  await until(() => /restarting: kit files changed \(dashboard\/extra\.css\)/.test(d.log()) && d.starts().length === 3, 'a restart for a new stylesheet');
});

test('kit watch: a kit that does not parse is not started', { timeout: 180000 }, async (t) => {
  const F = kwFixture(t, 'kwparse');
  const port = await freePort();
  const d = await loopedDashboard(F, port);
  const first = d.starts()[0].pid;
  fs.writeFileSync(F.dt, `${F.orig}\n}}}\n`);
  await until(() => /does not parse/.test(d.log()), 'the broken kit named');
  await kwSleep(2000);
  assert.equal(kwCount(d.log(), /does not parse/), 1, 'said once, not once a poll');
  assert.ok(kwAlive(first), 'the first dashboard still runs');
  assert.ok(await kwHello(port), 'and answers');
  kitB(F);
  await until(() => d.starts().some((s) => s.line.includes('started (kit B)')), 'the fixed kit started');
});

test('kit watch: an answer in flight is answered before the restart', { timeout: 180000 }, async (t) => {
  const F = kwFixture(t, 'kwflight');
  const port = await freePort();
  const d = await loopedDashboard(F, port);
  const first = d.starts()[0].pid;
  const { buf, req, answered } = kwPost(port, '/api/thread-new', { title: 'kit watch', text: 'in flight' });
  req.write(buf.subarray(0, 10));
  await kwSleep(300);
  kitB(F);
  await until(() => /restarting: .*waiting for 1 open requests/.test(d.log()), 'the restart waiting on the request');
  await kwSleep(2000);
  assert.ok(kwAlive(first), 'the old dashboard waits for the request');
  assert.ok(!d.starts().some((s) => s.line.includes('started (kit B)')), 'and the new kit has not started');
  req.end(buf.subarray(10));
  const r = await answered;
  assert.equal(r.status, 200, r.body);
  assert.equal(JSON.parse(r.body).ok, true);
  await until(() => d.starts().some((s) => s.line.includes('started (kit B)')), 'the new kit started after the answer');
  const threads = JSON.parse(execFileSync(process.execPath, [F.dt, 'thread', 'list', '--json'], { cwd: F.root, env: F.env, encoding: 'utf8' }));
  assert.ok(threads.some((x) => x.title === 'kit watch'), 'the thread the request made is there');
});

test('kit watch: a press whose command is still typing holds the restart', { skip: hasTmux ? false : 'no tmux', timeout: 180000 }, async (t) => {
  const T = threadsFixture('kit-watch-press');
  const later = cleanup(t);
  later(() => T.done());
  const env = { ...T.env({}), HOME: path.join(T.base, 'kwhome'), DEVTEAM_HUB_PORT: String(PORTS + 91), DEVTEAM_PORT_BASE: String(PORTS + 92), DEVTEAM_KIT_WATCH_MS: '200' };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'DEVTEAM_DASHBOARD_RESTART', 'TMUX', 'TMUX_PANE']) delete env[k];
  fs.mkdirSync(env.HOME, { recursive: true });
  const dt = path.join(T.old, 'docs/devteam/scripts/devteam.mjs');
  const F = { base: T.base, root: T.old, dt, env, later, orig: fs.readFileSync(dt, 'utf8') };
  const pane = T.standIn();
  for (const n of ['supervisor-pane', 'supervisor-pane-role']) fs.writeFileSync(path.join(T.old, 'docs/devteam/run', n), pane.target);
  // tmux whose send-keys waits for the test's go: the answer's command is still typing after its reply
  const bin = path.join(T.base, 'kwbin');
  const go = path.join(T.base, 'kwgo');
  write(path.join(bin, 'tmux'), `#!/bin/sh\ncase " $* " in *" send-keys "*) i=0; while [ ! -e '${go}' ] && [ $i -lt 600 ]; do sleep 0.1; i=$((i+1)); done ;; esac\nPATH='${env.PATH}' exec tmux "$@"\n`);
  fs.chmodSync(path.join(bin, 'tmux'), 0o755);
  const port = await freePort();
  const d = await loopedDashboard(F, port, { PATH: `${bin}${path.delimiter}${env.PATH}` });
  const first = d.starts()[0].pid;
  const q = T.sup(['ask', '--question', 'Ship it?', '--choices', '[{"label":"Yes"},{"label":"No"}]']);
  const { buf, req, answered } = kwPost(port, '/api/answer', { id: q, answer: 'Yes' });
  req.end(buf);
  const r = await answered;
  assert.equal(r.status, 200, r.body);
  kitB(F);
  await until(() => /restarting: .*waiting for 0 open requests and 1 running commands/.test(d.log()), 'the restart waiting on the command');
  await kwSleep(2000);
  assert.ok(kwAlive(first), 'the old dashboard waits for the command');
  assert.ok(!d.starts().some((s) => s.line.includes('started (kit B)')), 'and the new kit has not started');
  fs.writeFileSync(go, '');
  await until(() => pane.typed().includes('[devteam answer'), 'the nudge typed');
  assert.ok(!d.starts().some((s) => s.line.includes('started (kit B)')), 'the nudge landed before the new kit started (the loop waits 1 s after the old one exits)');
  await until(() => d.starts().some((s) => s.line.includes('started (kit B)')), 'the new kit started after the nudge');
});

test('kit watch: supervisor.md says the dashboard restarts itself', () => {
  const doc = fs.readFileSync(path.join(kit, 'process', 'supervisor.md'), 'utf8');
  const s11 = doc.slice(doc.indexOf('\n## 11.'), doc.indexOf('\n## 12.'));
  const bullet = s11.split('\n').find((l) => l.startsWith('- The dashboard:'));
  assert.ok(bullet, "§11's dashboard bullet");
  assert.match(bullet, /restarts itself when its kit/);
  assert.match(bullet, /DEVTEAM_DASHBOARD_RESTART/);
  assert.match(bullet, /no manual restart after a sync/i);
});
