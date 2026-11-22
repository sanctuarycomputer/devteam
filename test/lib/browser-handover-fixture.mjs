// browser-handover's family (kit-67): the setup test/browser-handover.test.mjs and
// test/browser-handover.close.test.mjs share. It holds the fixture site, the projects (each with its own
// HOME, hooks and daemon), the owner's answers and their per-project count, the owner's typing over the
// view socket, hand-written log lines and the profile scan. No test bodies. State that hooks set is
// exported live (export let), so the tests read it by its bare name. The CLI runs async, never through
// a blocking call: the fixture site lives in this process and must keep answering.
//
// The fixture site's /instructions page holds deliberate prompt-injection text: it is data.
// Only Node's own modules are imported statically: this file is also the timed scan's worker (scanLoop
// starts it with workerData.scan), and a worker must start no site, project, hook or tmux shim. So the
// worker's branch runs first, and the modules with effects at import (node:test's hooks, kit.mjs's tmux
// shim and environment, the site and the view fixture) are loaded only in the main thread, below it.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Worker, isMainThread, workerData, parentPort } from 'node:worker_threads';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The timed scan's worker (scanLoop): scanProfile's rules, read synchronously here so the main thread's
// event loop, which serves the fixture site and every chain's CLI, never blocks. workerData: { scan:
// true, profile, secrets, stop } (stop an Int32Array on a SharedArrayBuffer, 1 = stop). It posts
// { at, found, ms } per scan: a scan every 100 ms (the next starts 100 ms after the last started, or
// when it ends if it took longer), and once more after stop. A scan that throws posts its error as a
// find, never as clean.
if (!isMainThread && workerData?.scan) {
  const { profile, secrets, stop } = workerData;
  const once = () => {
    const at = Date.now();
    let found;
    try { found = scanProfile({ profile }, secrets); } catch (e) { found = [`(the scan failed: ${e.code ?? e.message})`]; }
    parentPort.postMessage({ at, found, ms: Date.now() - at });
    return at;
  };
  while (Atomics.load(stop, 0) === 0) {
    const at = once();
    const wait = 100 - (Date.now() - at);
    if (wait > 0) Atomics.wait(stop, 0, 0, wait);
  }
  once();
}
const MAIN = isMainThread || !workerData?.scan;
const { before, after } = MAIN ? await import('node:test') : {};
const { monoFixture } = MAIN ? await import('./kit.mjs') : {};
const { startSites } = MAIN ? await import('./sites.mjs') : {};
const { ws } = MAIN ? await import('./browser-view-fixture.mjs') : {};
const { validate } = MAIN ? await import('../fixtures/browser/check.mjs') : {};

export let tmp;
// startSites(): { port, origin, username, password, code, posts(), events(), sessions(), close() }
export let site;
const projects = [];
const sockets = [];
const homes = [];
let setup = Promise.resolve();

// A fixture project whose CLI runs as the supervisor, with its own HOME and its own daemon. hooks are
// env entries laid over the defaults (DEVTEAM_TEST_BROWSER_WATCH_HANDLE, _IDLE_MS, a wider _ALLOW …).
// { old, env, home, key, profile, run, state, ledger, name, done, ownerAnswers, … }: run is the run/
// folder (not monoFixture's run()), state its browser/state.json, ledger its browser/resets.json, key the
// kit's browserKey() for it. ownerAnswers counts the owner answers owner() and ownerVia() ran on it.
export function project(name, hooks = {}) {
  if (!site) throw new Error('project(): call handoverFile() at the top of the test file, and make projects in a test or hook');
  const F = monoFixture(name);
  const home = fs.mkdtempSync(path.join(tmp, 'home-'));
  homes.push(home);
  const env = { ...F.env({ DEVTEAM_ROLE: 'supervisor' }), HOME: home, DEVTEAM_TEST: '1', DEVTEAM_TEST_BROWSER_ALLOW: `${site.port}`, ...hooks };
  const key = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project'}-${crypto.createHash('sha1').update(fs.realpathSync(F.old)).digest('hex').slice(0, 12)}`;
  const run = path.join(F.old, 'docs', 'devteam', 'run');
  const P = { ...F, name, home, env, key, profile: path.join(home, '.devteam', 'browser', key), run, state: path.join(run, 'browser', 'state.json'), ledger: path.join(run, 'browser', 'resets.json'), ownerAnswers: 0 };
  projects.push(P);
  return P;
}

// devteam.mjs <args> on project P, as the supervisor unless env says otherwise (a key set to undefined
// is unset): { status, out, err }.
export function kit(P, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...P.env, ...extraEnv };
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
    const child = spawn(process.execPath, [path.join(P.old, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: P.old, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 150000);
    child.on('error', reject);
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, out: out.trim(), err: err.trim() }); });
  });
}
export const browser = (P, args, env) => kit(P, ['browser', ...args], env);

// The handover's two choices, as browser handover asks them.
export const CHOICES = [{ label: 'Done' }, { label: "Can't right now" }];
// The qid a command printed on a line of its own.
export const qidOf = (r) => r.out.split('\n').find((l) => /^q-\d{8}-\d{9}-[a-z0-9-]+$/.test(l));
// browser <args> on P, asserted to exit 0.
export const ok = async (P, args, env) => { const r = await browser(P, args, env); assert.equal(r.status, 0, `browser ${args.join(' ')}: exit ${r.status}: ${r.err || r.out}`); return r; };
// The supervisor withdraws qid on P, asserted to exit 0.
export const withdraw = async (P, qid) => { const r = await kit(P, ['withdraw', qid, '--reason', 'the test closes it']); assert.equal(r.status, 0, r.err || r.out); };

// The owner's own terminal: no DEVTEAM_ROLE, no TMUX, so ownerWriter writes by: 'owner'. Each answer
// that exits 0 counts on P (a refused one writes no line).
export async function owner(P, args) {
  const r = await kit(P, args, { DEVTEAM_ROLE: undefined, TMUX: undefined, TMUX_PANE: undefined });
  if (args[0] === 'answer' && r.status === 0) P.ownerAnswers++;
  return r;
}
// The owner's words recorded by the supervisor: answer … --from-chat --said … or answer … --from-turn
// <u-id>, run as the supervisor (chatAnswer and turnAnswer refuse without it). args are the whole
// command and carry the flag named by how. Its line is by: 'owner', so it counts on P too.
export async function ownerVia(P, how, args) {
  if (!['from-chat', 'from-turn'].includes(how)) throw new Error(`ownerVia: how is from-chat or from-turn, not ${how}`);
  if (args[0] !== 'answer' || !args.includes(`--${how}`)) throw new Error(`ownerVia ${how}: args are answer <qid> … --${how} …`);
  const r = await kit(P, args, { DEVTEAM_ROLE: 'supervisor' });
  if (r.status === 0) P.ownerAnswers++;
  return r;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// fn's first truthy value within ms (polled every 50 ms), or a failure naming what.
export async function until(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return assert.fail(`${what}: not within ${ms} ms`);
    await sleep(50);
  }
}
// P's state.json as written, or null.
export const readState = (P) => { try { return JSON.parse(fs.readFileSync(P.state, 'utf8')); } catch { return null; } };
// browser handover on P (the daemon started if need be): the qid it asked.
export async function askHandover(P, reason = 'Log in to the fixture site, then press Done') {
  const r = await browser(P, ['handover', '--reason', reason]);
  assert.equal(r.status, 0, `browser handover: exit ${r.status}: ${r.err || r.out}`);
  const qid = qidOf(r);
  assert.ok(qid, r.out);
  return qid;
}
// browser wait [args] on P: its output parsed, asserted to exit 0 and to validate as browser@1's wait.
export async function waitJson(P, args = [], env) {
  const r = await browser(P, ['wait', ...args], env);
  assert.equal(r.status, 0, `browser wait ${args.join(' ')}: exit ${r.status}: ${r.err || r.out}`);
  const w = JSON.parse(r.out);
  assert.deepEqual(validate('wait', w), [], r.out);
  return w;
}
// A browser-handover question line of P's scope, for appendLine; extra fields laid over it.
export const handoverLine = (P, extra = {}) => ({ type: 'question', kind: 'owner-action', class: 'browser-handover', scope: `browser:${P.key}`, question: 'Log in (merged by hand)', choices: CHOICES, ...extra });
// P's ledger entries for qid, oldest first.
export const entriesFor = (P, qid) => (readLedger(P)?.resets ?? []).filter((e) => e.qid === qid);
// P's ledger, when there is one, validates as browser@1's resets and is mode 0600.
export function ledgerValid(P) {
  if (!P || !fs.existsSync(P.ledger)) return;
  const l = readLedger(P);
  assert.deepEqual(validate('resets', l), [], JSON.stringify(l));
  assert.equal(fs.statSync(P.ledger).mode & 0o777, 0o600, 'resets.json is mode 0600');
}
// The pids of processes whose command line carries P's profile as --user-data-dir.
export function profilePids(P) {
  const pids = [];
  for (const d of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    let cmd; try { cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8'); } catch { continue; }
    if (cmd.split('\0').some((a) => a === `--user-data-dir=${P.profile}` || a === `--user-data-dir=${P.profile}${path.sep}`)) pids.push(Number(d));
  }
  return pids;
}
// Alive and not a zombie.
export function alive(pid) {
  try { process.kill(pid, 0); } catch { return false; }
  try { const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return st.slice(st.lastIndexOf(')') + 2)[0] !== 'Z'; } catch { return false; }
}
// kill -9 P's daemon (state.json's daemon_pid), waited until it is gone. Its Chrome is left running,
// as a crash leaves it; the next start stops it.
export async function killDaemon(P) {
  const pid = readState(P)?.daemon_pid;
  assert.ok(Number.isInteger(pid) && alive(pid), 'a live daemon to kill');
  process.kill(pid, 'SIGKILL');
  await until(() => !alive(pid), 5000, 'the killed daemon gone');
}
// The owner types text into the open /record page's note over the view: a socket, a frame, a click on
// the page's button, Tab to the note, then a paste; resolved once the site recorded the whole value.
// The socket is returned, still open. v: a socket already open, used instead of a new one.
export async function typeNote(P, text, { v: open } = {}) {
  const v = open ?? await viewSocket(P);
  await v.waitFor((m) => m.t === 'frame', 5000);
  v.send({ t: 'mouse', type: 'click', x: 108, y: 120, button: 'left', clicks: 1 });
  await sleep(200);
  v.tab();
  v.paste(text);
  await until(() => site.events().some((e) => e.kind === 'input' && e.value === text), 5000, 'the typed note on the page');
  return v;
}

// The owner signs in to site S over the view, on a tab already at S's /login (either variant): a click
// on the page's empty corner (the page focused, no field), Tab, a paste of the user, Tab, a paste of the
// password, Enter; then, on the 2FA page once the view showed its URL and 500 ms passed, Tab, a paste
// of the code, Enter. Resolved once S issued the session and, with to, the view shows that masked URL. The
// socket is returned, still open.
export async function ownerLogIn(P, { S = site, to } = {}) {
  const v = await viewSocket(P);
  await v.waitFor((m) => m.t === 'frame', 10000);
  v.send({ t: 'mouse', type: 'click', x: 700, y: 4, button: 'left', clicks: 1 });
  await sleep(150);
  const from = v.msgs.length;
  v.tab(); v.paste(S.username); v.tab(); v.paste(S.password); v.enter();
  // the view's url comes from the commit (a 250 ms tick, so the page's first frame may come before
  // it): the tiny page is parsed well within the settle after it
  await v.c.wait((m) => m.t === 'url' && m.url.startsWith(`${S.origin}/2fa`), 15000, from);
  await sleep(500);
  const issued = S.sessions().length;
  const before2 = v.msgs.length;
  v.tab(); v.paste(S.code); v.enter();
  await until(() => S.sessions().length > issued, 15000, 'the session issued for the code');
  if (to) await v.c.wait((m) => m.t === 'url' && m.url === to, 15000, before2);
  return v;
}

// C12's timed scan of P's profile for secrets, started before the answer, in a worker thread (this
// file, its worker branch at the top): a scan every 100 ms, each dated
// by the time it started and timed (ms), until stop(), and once more after. firstCleanAfter(t): the
// start of the first scan from t on that found nothing, or null. stop() resolves to every scan.
export function scanLoop(P, secrets) {
  const scans = [];
  const stop = new Int32Array(new SharedArrayBuffer(4));
  const w = new Worker(new URL(import.meta.url), { workerData: { scan: true, profile: P.profile, secrets, stop } });
  w.on('message', (m) => scans.push(m));
  const ended = new Promise((resolve) => { w.once('exit', resolve); w.once('error', (e) => { scans.push({ at: Date.now(), found: [`(the scan worker failed: ${e.message})`], ms: 0 }); resolve(); }); });
  return {
    scans,
    firstCleanAfter: (t) => scans.find((s) => s.at >= t && !s.found.length)?.at ?? null,
    stop: async () => { Atomics.store(stop, 0, 1); Atomics.notify(stop, 0); await ended; return scans; },
  };
}
// The code typed into the profile's files at all: polled up to 15 s (Chrome's session save), so a clean
// scan later means the code left, not that the scan can't find it. The files that held it.
export const codeOnDisk = (P, code) => until(async () => { const f = await scanProfileAsync(P, [code]); return f.length ? f : null; }, 15000, 'the code in some profile file (the scan shown able to find it)');

// The owner at the view: a socket to P's view port (state.json's view_port) with the view's own Origin.
// { status, msgs, send(obj), tab(n), paste(text), enter(), waitFor(pred, ms), close(), c }: tab sends n
// Tab key presses (down, up) and paste the text in the page's pieces (at most 10 000 code points each),
// as browser.html sends them; c is the raw client of browser-view-fixture's ws().
export async function viewSocket(P) {
  const port = JSON.parse(fs.readFileSync(P.state, 'utf8')).view_port;
  const c = await ws(port);
  if (c.status !== 101) { c.close(); throw new Error(`viewSocket: ${c.head.split('\r\n')[0] || 'no answer'}`); }
  sockets.push(c);
  const TAB = { key: 'Tab', code: 'Tab' };
  return {
    status: c.status,
    msgs: c.msgs,
    send: (o) => c.send(o),
    tab: (n = 1) => { for (let i = 0; i < n; i++) { c.send({ t: 'key', type: 'down', ...TAB }); c.send({ t: 'key', type: 'up', ...TAB }); } },
    paste: (text) => { const cps = [...String(text)]; for (let i = 0; i < cps.length; i += 10000) c.send({ t: 'paste', text: cps.slice(i, i + 10000).join('') }); },
    enter: () => c.send({ t: 'key', type: 'press', key: 'Enter', code: 'Enter', text: '\r' }),
    waitFor: (pred, ms = 5000) => c.wait(pred, ms),
    close: () => c.close(),
    c,
  };
}

// A line written by hand into P's live log, in the kit's own shape and file (appendLog's): the
// envelope v, id, type, op, at, by (and channel for the owner) filled in where line leaves them out.
// by defaults to supervisor; at to now, after the file's last line; id to <prefix>-<date>-<time>-<by>
// from at. Taken under the file's lock as the kit takes it. Returns the line written.
const ID_PREFIX = MAIN ? JSON.parse(fs.readFileSync(new URL('../../docs/devteam/schema/log.schema.json', import.meta.url), 'utf8'))['x-id'].prefix : null;
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export function appendLine(P, line) {
  if (!line?.type) throw new Error('appendLine: the line needs a type');
  const by = line.by ?? 'supervisor';
  const file = by === 'owner' || by === 'supervisor' ? `${by}-${new Date().toISOString().slice(0, 7)}.jsonl` : `${by}.jsonl`;
  const dir = path.join(P.run, 'log');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, file);
  const lock = `${target}.lock`;
  for (let t0 = Date.now(); ;) {
    try { fs.mkdirSync(lock); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (Date.now() - t0 > 15000) throw new Error(`appendLine: ${lock} held for 15 s`);
      sleepSync(25);
    }
  }
  try {
    let cur = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (cur && !cur.endsWith('\n')) { cur = cur.slice(0, cur.lastIndexOf('\n') + 1); fs.writeFileSync(target, cur); }
    let lastAt = '';
    try { lastAt = JSON.parse(cur.trimEnd().split('\n').pop() || '{}').at ?? ''; } catch {}
    let t = Date.now();
    if (lastAt && Date.parse(lastAt) >= t) t = Date.parse(lastAt) + 1;
    const at = line.at ?? new Date(t).toISOString();
    const id = line.id ?? `${ID_PREFIX[line.type]}-${at.slice(0, 10).replace(/-/g, '')}-${at.slice(11, 23).replace(/[:.]/g, '')}-${by}`;
    const full = { v: 1, id, type: line.type, op: line.op ?? 'new', at, by, ...(by === 'owner' ? { channel: line.channel ?? 'cli' } : {}) };
    for (const [k, v] of Object.entries(line)) if (!(k in full) && v !== undefined) full[k] = v;
    fs.appendFileSync(target, `${JSON.stringify(full)}\n`);
    return full;
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

// Every log line of P, live and durable, each once, in file order (files sorted by name).
function logLines(P) {
  const seen = new Set(), lines = [];
  const files = new Set();
  for (const d of ['run/log', 'project/log']) { const dir = path.join(P.old, 'docs/devteam', d); if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) files.add(f); }
  for (const f of [...files].sort()) {
    for (const d of ['project/log', 'run/log']) {
      const p = path.join(P.old, 'docs/devteam', d, f);
      if (!fs.existsSync(p)) continue;
      for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
        if (!l.trim() || seen.has(l)) continue;
        seen.add(l);
        try { lines.push(JSON.parse(l)); } catch {}
      }
    }
  }
  return lines;
}
// The question set lines of P's log that carry an answer.
export const answerLines = (P) => logLines(P).filter((l) => l.type === 'question' && l.op === 'set' && Object.hasOwn(l, 'answer'));
// P's reset ledger (run/browser/resets.json): its entries, or null with no file.
export const readLedger = (P) => (fs.existsSync(P.ledger) ? JSON.parse(fs.readFileSync(P.ledger, 'utf8')) : null);

// The files under P's profile that hold any of secrets, as UTF-8 or as UTF-16LE: their paths relative
// to the profile, sorted. Every regular file is read whole as bytes, binary included. Only a file or
// folder gone between its listing and its read (ENOENT: Chrome writes while it is read) is passed over;
// any other read error throws, and so does a missing profile, so a scan never reads clean by failing.
export function scanProfile(P, secrets) {
  const needles = secrets.filter(Boolean).flatMap((s) => [Buffer.from(s, 'utf8'), Buffer.from(s, 'utf16le')]);
  const found = [];
  const walk = (dir) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT' && dir !== P.profile) return; throw e; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        let buf;
        try { buf = fs.readFileSync(p); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
        if (needles.some((n) => buf.includes(n))) found.push(path.relative(P.profile, p));
      }
    }
  };
  walk(P.profile);
  return found.sort();
}

// scanProfile's rules, read asynchronously: the timed scans run while this process also serves the
// fixture site and every chain's CLI, so a scan never blocks its event loop. Resolves to the sorted paths.
export async function scanProfileAsync(P, secrets) {
  const needles = secrets.filter(Boolean).flatMap((s) => [Buffer.from(s, 'utf8'), Buffer.from(s, 'utf16le')]);
  const found = [];
  const walk = async (dir) => {
    let ents;
    try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT' && dir !== P.profile) return; throw e; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) {
        let buf;
        try { buf = await fs.promises.readFile(p); } catch (err) { if (err.code === 'ENOENT') continue; throw err; }
        if (needles.some((n) => buf.includes(n))) found.push(path.relative(P.profile, p));
      }
    }
  };
  await walk(P.profile);
  return found.sort();
}

// The pids of processes whose command line carries a profile under one of this file's HOMEs.
function testBrowserPids() {
  if (!fs.existsSync('/proc')) return [];
  const pids = [];
  for (const d of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    let cmd; try { cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8'); } catch { continue; }
    if (homes.some((h) => cmd.includes(`--user-data-dir=${path.join(h, '.devteam', 'browser')}${path.sep}`))) pids.push(Number(d));
  }
  return pids;
}

// The file's hooks, called at the file's top (no work at import). before makes the temp folder and
// starts the fixture site, on every Node (the site needs no Chrome, so the asking checks get projects
// too); after closes every view socket, stops every project's browser, kills what is left of its
// daemon and Chrome, removes each project and the temp folder, and closes the site.
export function handoverFile() {
  before(() => {
    // a kit tmux server reached from here could be the fleet's: the tests run with TMUX unset
    if (process.env.TMUX) throw new Error('handoverFile: TMUX is set; run the browser-handover tests under env -u TMUX, so no daemon window can reach the fleet\'s tmux server');
    setup = (async () => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-bhand-'));
      site = await startSites();
    })();
    return setup;
  });
  after(async () => {
    await setup.catch(() => {});
    for (const c of sockets) c.close();
    for (const P of projects) await browser(P, ['stop']).catch(() => {});
    for (const P of projects) {
      let pid;
      try { pid = JSON.parse(fs.readFileSync(P.state, 'utf8')).daemon_pid; } catch {}
      // only while that pid is still this project's daemon (its command line names the checkout)
      let cmd = '';
      try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch {}
      if (Number.isInteger(pid) && pid > 0 && cmd.includes(P.old)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    }
    for (const pid of testBrowserPids()) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    for (const P of projects) P.done();
    await site?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
}
