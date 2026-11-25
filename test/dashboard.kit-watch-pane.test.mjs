// Kit watch, a dashboard in its own tmux pane: it respawns the pane, listens again on the old code when the respawn fails, never respawns a pane whose process is no shell, and a plain dashboard stays and says so.
// Ports: +91/92 each kit watch test's hub and base (kwEnv; serial)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PORTS, kit, freePort, write, bareProject, dashboardOnFreePort, until, hasTmux } from './lib/kit.mjs';
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
// A pane runs a process group of its own (its pid the group's id; a shell's or execFile's children
// join it). kill-session only hangs it up: the dashboard it ran still logs into the fixture as it
// stops (stopped by SIGHUP; its hub's restart after a failed respawn), and each log line recreates
// docs/devteam/run, so the fixture's rm waits until every group is gone (kit-346), the way
// lib/kit.mjs's stop() ends a dashboard's group.
const kwKillGroups = (groups) => groups.filter((g) => { try { process.kill(-g, 'SIGKILL'); return true; } catch { return false; } });
function kwSession(F, prefix) {
  const s = `${prefix}-${crypto.randomBytes(3).toString('hex')}`;
  F.later(async () => {
    const groups = kwTmux(['list-panes', '-s', '-t', `=${s}`, '-F', '#{pane_pid}']).out.split('\n').map(Number).filter((n) => n > 1);
    kwTmux(['kill-session', '-t', `=${s}`]);
    let left = kwKillGroups(groups);
    for (let i = 0; i < 200 && left.length; i++) { await kwSleep(50); left = kwKillGroups(left); }
    if (left.length) throw new Error(`tmux session ${s}: process groups ${left.join(', ')} still run after kill-session and SIGKILL`);
  });
  return s;
}
const kwPanePid = (target) => Number(kwTmux(['display-message', '-p', '-t', target, '#{pane_pid}']).out);

test('kit watch: a dashboard that is its own tmux pane respawns it', { skip: hasTmux ? false : 'no tmux', timeout: 180000 }, async (t) => {
  const F = kwFixture(t, 'kwpane');
  const [P1, P2] = [await freePort(), await freePort()];
  const s = kwSession(F, 'kw');
  const run = (p) => `${kwSq(process.execPath)} ${kwSq(F.dt)} dashboard --port ${p}`;
  // exec: tmux runs this with the machine's shell, and dash keeps itself as the pane's process (kit-855)
  assert.equal(kwTmux(['new-session', '-d', '-s', s, '-n', 'a', '-c', F.root, `exec ${kwInPane(F.env, run(P1))}`]).status, 0);
  assert.equal(kwTmux(['new-window', '-d', '-t', `=${s}:`, '-n', 'b', '-c', F.root, `${kwInPane(F.env, run(P2))}; true`]).status, 0);
  const log = kwLogOf(F.root);
  const starts = kwStartsOf(log);
  await until(async () => (await kwHello(P1))?.kit && (await kwHello(P2))?.kit, 'both pane dashboards with their kit');
  const startOf = (p, b = false) => starts().find((x) => x.line.includes(`started ${b ? '(kit B) ' : ''}on http://127.0.0.1:${p}`));
  const [a0, b0] = [kwPanePid(`=${s}:a`), kwPanePid(`=${s}:b`)];
  assert.equal(a0, startOf(P1).pid, "window a's pane process is the dashboard itself");
  assert.notEqual(b0, startOf(P2).pid, "window b's is the shell that runs it");
  kitB(F);
  await until(() => startOf(P1, true) && startOf(P2, true), 'both panes started the new kit');
  await until(async () => (await kwHello(P1)) && (await kwHello(P2)), 'both addresses answer again');
  assert.notEqual(kwPanePid(`=${s}:a`), a0, 'pane a was respawned');
  assert.notEqual(kwPanePid(`=${s}:b`), b0, 'pane b was respawned');
});

test('kit watch: a failed respawn listens again on the old code', { skip: hasTmux ? false : 'no tmux', timeout: 180000 }, async (t) => {
  const F = kwFixture(t, 'kwnorespawn');
  const bin = path.join(F.base, 'kwbin');
  write(path.join(bin, 'tmux'), `#!/bin/sh\ncase " $* " in *" respawn-pane "*) echo 'respawn refused by the test' >&2; exit 1 ;; esac\nPATH=${kwSq(F.env.PATH)} exec tmux "$@"\n`);
  fs.chmodSync(path.join(bin, 'tmux'), 0o755);
  const port = await freePort();
  const s = kwSession(F, 'kwn');
  assert.equal(kwTmux(['new-session', '-d', '-s', s, '-n', 'a', '-c', F.root, kwInPane({ ...F.env, PATH: `${bin}${path.delimiter}${F.env.PATH}` }, `${kwSq(process.execPath)} ${kwSq(F.dt)} dashboard --port ${port}`)]).status, 0);
  const log = kwLogOf(F.root);
  await until(async () => (await kwHello(port))?.kit, 'the pane dashboard with its kit');
  const first = kwStartsOf(log)()[0].pid;
  kitB(F);
  await until(() => /could not respawn/.test(log()), 'the failed respawn said');
  await until(async () => !!(await kwHello(port)), 'the address answers again');
  assert.ok(kwAlive(first), 'from the first process');
  assert.ok(!/started \(kit B\)/.test(log()), 'on the old code');
  fs.appendFileSync(path.join(F.root, 'docs/devteam/dashboard/index.html'), '<!-- c -->\n');
  await until(() => kwCount(log(), /restarting: kit files changed/) === 2, 'a new change noticed again: its timers came back');
});

test("kit watch: a pane whose process is a dashboard's parent but no shell is never respawned", { skip: hasTmux ? false : 'no tmux', timeout: 180000 }, async (t) => {
  // an agent as a pane's own command, its child the dashboard, "dashboard" in its own arguments
  const F = kwFixture(t, 'kwagent');
  const port = await freePort();
  const parent = path.join(F.base, 'agent.mjs');
  write(parent, `import { spawn } from 'node:child_process';\nconst c = spawn(process.execPath, [${JSON.stringify(F.dt)}, 'dashboard', '--port', '${port}'], { stdio: 'inherit', cwd: ${JSON.stringify(F.root)} });\nc.on('exit', () => setInterval(() => {}, 1000));\n`);
  const s = kwSession(F, 'kwa');
  assert.equal(kwTmux(['new-session', '-d', '-s', s, '-n', 'a', '-c', F.root, kwInPane(F.env, `${kwSq(process.execPath)} ${kwSq(parent)} --task kit-288-dashboard-self-restart`)]).status, 0);
  const log = kwLogOf(F.root);
  await until(async () => (await kwHello(port))?.kit, 'the dashboard under the agent');
  const p0 = kwPanePid(`=${s}:a`);
  const dash = kwStartsOf(log)()[0].pid;
  assert.notEqual(p0, dash, "the pane's process is the agent, not the dashboard");
  kitB(F);
  await until(() => /runs older code than its files/.test(log()), 'the stale code said');
  await kwSleep(1000);
  assert.equal(kwPanePid(`=${s}:a`), p0, "the agent's pane was never respawned");
  assert.ok(kwAlive(p0) && kwAlive(dash), 'both still run');
});

test('kit watch: a plain dashboard, or one told off, stays and says so', { skip: hasTmux ? false : 'no tmux', timeout: 180000 }, async (t) => {
  // (a) no loop, and the TMUX_PANE it inherited is a pane whose process is something else
  const F = kwFixture(t, 'kwstay');
  const s = kwSession(F, 'kws');
  assert.equal(kwTmux(['new-session', '-d', '-s', s, '-n', 'a', 'sleep 600']).status, 0);
  const paneId = kwTmux(['display-message', '-p', '-t', `=${s}:a`, '#{pane_id}']).out;
  const sock = kwTmux(['display-message', '-p', '-t', `=${s}:a`, '#{socket_path}']).out;
  const spid = kwTmux(['display-message', '-p', '-t', `=${s}:a`, '#{pid}']).out;
  const p0 = kwPanePid(`=${s}:a`);
  const { dash, port } = await dashboardOnFreePort(F.root, { ...F.env, TMUX: `${sock},${spid},0`, TMUX_PANE: paneId });
  F.later(() => dash.stop());
  const log = kwLogOf(F.root);
  await until(async () => (await kwHello(port))?.kit, 'the plain dashboard with its kit');
  kitB(F);
  await until(() => /runs older code than its files/.test(log()), 'the stale code said');
  await kwSleep(2000);
  assert.equal(kwCount(log(), /runs older code than its files/), 1, 'said once');
  assert.ok(kwAlive(dash.p.pid) && (await kwHello(port)), 'it stays up');
  assert.equal(kwPanePid(`=${s}:a`), p0, 'and never respawned the pane it inherited');
  // (b) under a loop, told off
  const G = kwFixture(t, 'kwoff');
  const gp = await freePort();
  const d = await loopedDashboard(G, gp, { DEVTEAM_DASHBOARD_RESTART: 'off' });
  const first = d.starts()[0].pid;
  kitB(G);
  await until(() => /runs older code than its files;.*\(DEVTEAM_DASHBOARD_RESTART=off\)/.test(d.log()), 'the stale code said, off');
  await kwSleep(1000);
  assert.ok(kwAlive(first) && !d.starts().some((x) => x.line.includes('started (kit B)')), 'it stays on its code');
});
