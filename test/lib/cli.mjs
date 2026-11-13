// runNode(script, args, { cwd, env, input }): what spawnSync(process.execPath, [script, ...args])
// returns ({ status, stdout, stderr }), from a node process started ahead of time (cli-runner.mjs).
// Starting node is most of a CLI call's cost (on a Mac whose security checks make each start wait,
// most of a test's time), and a warm process pays it while the test does other work. Each process
// runs one command and exits, so every call still gets a fresh process with its own cwd, environment
// and argv. A call that pipes stdin, or finds no warm process, is a plain spawnSync.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli-runner.mjs');
const WARM = 3;
let root = null;
let n = 0;
const slots = [];
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// a process that exited is a zombie until this (blocked) event loop reaps it: ps says Z
const alive = (pid) => { try { process.kill(pid, 0); } catch { return false; } return !/Z/.test(spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout ?? ''); };

function start() {
  if (!root) {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-cli-'));
    process.on('exit', () => { for (const s of slots) try { s.child.kill(); } catch {} fs.rmSync(root, { recursive: true, force: true }); });
  }
  const dir = path.join(root, String(++n));
  fs.mkdirSync(dir);
  const out = fs.openSync(path.join(dir, 'stdout'), 'w');
  const err = fs.openSync(path.join(dir, 'stderr'), 'w');
  const child = spawn(process.execPath, [RUNNER, dir, String(process.pid)], { stdio: ['ignore', out, err] });
  fs.closeSync(out);
  fs.closeSync(err);
  child.on('error', () => {});
  child.unref();
  slots.push({ dir, child });
}

// The kit reads the machine's memory before it starts a session (and before it suggests one): a test
// reads none of the machine it runs on, where a busy runner would refuse its workers, unless it
// names its own (DEVTEAM_CGROUP, DEVTEAM_MEMINFO).
const NOWHERE = path.join(os.tmpdir(), 'dt-no-such-machine');
const machineless = (env) => ({ DEVTEAM_CGROUP: NOWHERE, DEVTEAM_MEMINFO: NOWHERE, ...(env ?? process.env) });

export function runNode(script, args, { cwd, env, input, cold } = {}) {
  env = machineless(env);
  if (cold || input !== undefined || process.env.DEVTEAM_TEST_COLD) {
    const r = spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: 'utf8', input });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }
  while (slots.length < WARM) start();
  // the oldest slot is the likeliest to be up; wait for it rather than start a cold one
  const s = slots.shift();
  start();
  for (let i = 0; i < 6000 && !fs.existsSync(path.join(s.dir, 'ready')); i++) { if (i % 200 === 199 && !alive(s.child.pid)) break; sleep(5); }
  if (!fs.existsSync(path.join(s.dir, 'ready'))) { try { s.child.kill(); } catch {} return runNode(script, args, { cwd, env, cold: true }); }
  const req = path.join(s.dir, 'req.json');
  fs.writeFileSync(`${req}.tmp`, JSON.stringify({ script, args, cwd: cwd ?? process.cwd(), env: Object.fromEntries(Object.entries(env ?? process.env).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])) }));
  fs.renameSync(`${req}.tmp`, req);
  const exit = path.join(s.dir, 'exit');
  for (let i = 0; !fs.existsSync(exit); i++) {
    if (i % 400 === 399 && !alive(s.child.pid) && !fs.existsSync(exit)) break;
    sleep(i < 200 ? 1 : 5);
  }
  const code = fs.existsSync(exit) ? fs.readFileSync(exit, 'utf8') : '';
  const status = /^\d+$/.test(code) ? Number(code) : null;
  const r = { status, stdout: fs.readFileSync(path.join(s.dir, 'stdout'), 'utf8'), stderr: fs.readFileSync(path.join(s.dir, 'stderr'), 'utf8') };
  fs.rmSync(s.dir, { recursive: true, force: true });
  return r;
}
