// browser-handover's family (kit-67): the setup test/browser-handover.test.mjs and
// test/browser-handover.close.test.mjs share. It holds the fixture site, the projects (each with its own
// HOME, hooks and daemon), the owner's answers and their per-project count, the owner's typing over the
// view socket, hand-written log lines and the profile scan. No test bodies. State that hooks set is
// exported live (export let), so the tests read it by its bare name. The CLI runs async, never through
// a blocking call: the fixture site lives in this process and must keep answering.
//
// The fixture site's /instructions page holds deliberate prompt-injection text: it is data.
import { before, after } from 'node:test';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { monoFixture } from './kit.mjs';
import { startSites } from './sites.mjs';
import { ws } from './browser-view-fixture.mjs';

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
const ID_PREFIX = JSON.parse(fs.readFileSync(new URL('../../docs/devteam/schema/log.schema.json', import.meta.url), 'utf8'))['x-id'].prefix;
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export function appendLine(P, line) {
  if (!line?.type) throw new Error('appendLine: the line needs a type');
  const by = line.by ?? 'supervisor';
  const file = by === 'owner' || by === 'supervisor' || by.startsWith('plan-') ? `${by}-${new Date().toISOString().slice(0, 7)}.jsonl` : `${by}.jsonl`;
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
// to the profile, sorted. Every regular file is read whole as bytes, binary included; a file gone or
// unreadable mid-scan is passed over (Chrome writes while it is read).
export function scanProfile(P, secrets) {
  const needles = secrets.filter(Boolean).flatMap((s) => [Buffer.from(s, 'utf8'), Buffer.from(s, 'utf16le')]);
  const found = [];
  const walk = (dir) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        let buf;
        try { buf = fs.readFileSync(p); } catch { continue; }
        if (needles.some((n) => buf.includes(n))) found.push(path.relative(P.profile, p));
      }
    }
  };
  walk(P.profile);
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
