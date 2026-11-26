/* imports start */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendLog } from './log-sync.mjs';
import { argv } from './base.mjs';
import { asList } from './base.mjs';
import { choreWorktree } from './goals.mjs';
import { die } from './base.mjs';
import { flags } from './base.mjs';
import { git } from './base.mjs';
import { gitOrDie } from './base.mjs';
import { loadSettings } from './settings.mjs';
import { logCache } from './log-sync.mjs';
import { logGet } from './log-sync.mjs';
import { mainRoot } from './state.mjs';
import { modeOf } from './holds.mjs';
import { nowIso } from './base.mjs';
import { nudgeSupervisor } from './sessions.mjs';
import { openQuestion } from './decide.mjs';
import { out } from './base.mjs';
import { ownerWriter } from './log.mjs';
import { positional } from './base.mjs';
import { repoPath } from './sensors.mjs';
import { resolveQuestionThreads } from './decide.mjs';
import { rest } from './base.mjs';
import { runDir } from './state.mjs';
import { slug } from './base.mjs';
import { spawnSync } from 'node:child_process';
import { ticketGoals } from './holds.mjs';
import { tickets } from './graph.mjs';
import { warn } from './base.mjs';
import { writerClass } from './log.mjs';
/* imports end */
// ===== secrets: the owner posts a value straight to where it goes =====
//
// An owner-action question may declare secrets, each with a sink. The owner's own process (their
// terminal, or the dashboard's child, fed on stdin) pipes the value into the sink; it is never
// written to the log, to run/, or to argv, and the log records only that a name was posted and when.
// Sinks:
//   rails-credentials:<env|default>:<dotted.key>   bin/rails credentials:edit, in a chore worktree
//   sops:<repo file>:<dotted.key>                  sops set --value-stdin, in a chore worktree
//   file:<repo path>                               a gitignored file in the main checkout (a key file)
//   stdin:<command> <args…>                        a command the owner allowed (settings
//                                                  secret_commands) that reads the value on stdin
// Encrypted-store changes are committed to chore-secret-<n>; the supervisor lands them with
// merge --chore secret-<n> --approved <qid>. This guards against accidents (a value in the log, git,
// chat, a PR or an agent's context). It is not a sandbox: the Rails and SOPS sinks run the repo's
// own code and tools with the value, and a key on disk lets any local process decrypt the store.
export const SINK_RE = /^(rails-credentials|sops|file|stdin):(.+)$/;
export const insideDir = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`);
// The real path of p, resolving symlinks through the deepest part of it that exists.
export function realish(p) {
  let cur = path.resolve(p);
  const tail = [];
  while (!fs.existsSync(cur)) { tail.unshift(path.basename(cur)); const up = path.dirname(cur); if (up === cur) break; cur = up; }
  return path.join(fs.realpathSync(cur), ...tail);
}
export function parseSink(sink, { soft = false } = {}) {
  const fail = (msg) => { if (soft) throw new Error(msg); die(msg); };
  const m = SINK_RE.exec(sink ?? '');
  if (!m) fail(`sink "${sink}" is one of rails-credentials:<env>:<key.path>, sops:<file>:<key.path>, file:<gitignored path>, stdin:<command> <args…>`);
  const [, type, rest] = m;
  const keyPath = (k) => { if (!/^[A-Za-z0-9_][A-Za-z0-9_-]*(\.[A-Za-z0-9_][A-Za-z0-9_-]*)*$/.test(k ?? '')) fail(`sink "${sink}": the key path is dotted words (stripe.secret_key)`); return k.split('.'); };
  const repoPath = (p) => {
    if (!p || path.isAbsolute(p) || /\s/.test(p) || p.split(/[\\/]/).some((seg) => seg === '..' || seg.startsWith('-'))) fail(`sink "${sink}": a path inside the repo, relative, no .. and no segment starting with -`);
    const real = realish(path.join(mainRoot, p));
    if (!insideDir(real, realish(mainRoot))) fail(`sink "${sink}": resolves outside the repo`);
    if (insideDir(real, realish(runDir))) fail(`sink "${sink}": not under devteam's run/, which agents read`);
    return p;
  };
  if (type === 'rails-credentials') {
    const i = rest.indexOf(':');
    const env = i < 0 ? '' : rest.slice(0, i);
    if (!/^[a-z][a-z0-9_]*$/.test(env)) fail(`sink "${sink}": rails-credentials:<env|default>:<key.path>`);
    return { type, env, keys: keyPath(rest.slice(i + 1)), commits: true };
  }
  if (type === 'sops') {
    const i = rest.lastIndexOf(':');
    if (i < 0) fail(`sink "${sink}": sops:<file>:<key.path>`);
    return { type, file: repoPath(rest.slice(0, i)), keys: keyPath(rest.slice(i + 1)), commits: true };
  }
  if (type === 'file') return { type, file: repoPath(rest) };
  const argv = rest.trim().split(/\s+/);
  if (!argv[0]) fail(`sink "${sink}": stdin:<command> <args…> (arguments can't contain spaces)`);
  return { type, argv };
}
// The files a secrets question's sinks write: what its chore lands.
export const secretStores = (v) => (v.secrets ?? []).flatMap((x) => { try { const f = parseSink(x.sink, { soft: true }).file; return f ? [f] : []; } catch { return []; } });
// A stdin sink runs as the owner, so it must start with a command the owner allowed in settings.
export function allowedCommand(argv) {
  const line = argv.join(' ');
  return (loadSettings().secret_commands ?? []).some((p) => typeof p === 'string' && p.trim() && (line === p.trim() || line.startsWith(`${p.trim()} `)));
}
// Rails credentials that production decrypts (its own file, or the default one when there is no
// production file) should have their key only on the platform and in the owner's shell
// (code-style.md §10). A key in the checkout is readable by every agent on this machine, so the
// card says so before the owner posts a production secret behind it.
export function sinkWarning(sink) {
  let k;
  try { k = parseSink(sink, { soft: true }); } catch { return null; }
  if (k.type !== 'rails-credentials') return null;
  const prodFile = fs.existsSync(path.join(mainRoot, 'config/credentials/production.yml.enc'));
  if (!(k.env === 'production' || (k.env === 'default' && !prodFile))) return null;
  const keyFile = k.env === 'default' ? 'config/master.key' : 'config/credentials/production.key';
  if (!fs.existsSync(path.join(mainRoot, keyFile))) return null;
  return `${keyFile} is on disk in this checkout, and production decrypts these credentials: any agent on this machine can read the key, so it can read this secret. Keep a production key only on the platform and in your shell (code-style.md §10)${k.env === 'default' ? ', e.g. move production secrets to config/credentials/production.yml.enc with its own key' : ''}.`;
}
export function sinkWords(sink) {
  let k;
  try { k = parseSink(sink, { soft: true }); } catch { return `an unreadable sink (${sink})`; }
  return k.type === 'rails-credentials' ? `Rails credentials (${k.env}) → ${k.keys.join('.')}` : k.type === 'sops' ? `${k.file} (SOPS) → ${k.keys.join('.')}` : k.type === 'file' ? `the file ${k.file} (gitignored, this machine only)` : `this command, on its stdin: ${k.argv.join(' ')}`;
}
// Every form a value might take in a tool's output, longest first, so none survives in what we print.
export function redactor(values) {
  const forms = [];
  for (const [name, buf] of values) {
    const raw = buf.toString('utf8');
    for (const f of [raw, raw.trim(), JSON.stringify(raw).slice(1, -1), buf.toString('base64'), encodeURIComponent(raw)]) if (f && f.length >= 4) forms.push([f, name]);
  }
  forms.sort((a, b) => b[0].length - a[0].length);
  return (text) => forms.reduce((t, [f, name]) => t.split(f).join(`[secret:${name}]`), String(text ?? ''));
}
// A private scratch folder (0700) for one post, removed whatever happens.
export function withScratch(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-secret-'));
  fs.chmodSync(dir, 0o700);
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
// The editor credentials:edit runs: sets one key, keeps the rest (comments are not kept: YAML is
// re-dumped), and leaves a marker so a failure Rails ignores is not taken for success.
export const RAILS_EDITOR = `require "yaml"
require "date"
path = ARGV.last
text = File.read(path)
data = if text.strip.empty? then {} elsif YAML.respond_to?(:unsafe_load) then YAML.unsafe_load(text) else YAML.load(text) end
data = {} unless data.is_a?(Hash)
keys = ENV.fetch("DEVTEAM_SECRET_KEYPATH").split(".")
value = File.binread(ENV.fetch("DEVTEAM_SECRET_FILE")).force_encoding("UTF-8")
value = value.chomp if ENV["DEVTEAM_SECRET_KIND"] == "string"
h = data
keys[0..-2].each { |k| h[k] = {} unless h[k].is_a?(Hash); h = h[k] }
h[keys.last] = value
File.write(path, YAML.dump(data))
File.write(ENV.fetch("DEVTEAM_SECRET_DONE"), "ok")
`;
export const isUtf8 = (buf) => { try { new TextDecoder('utf-8', { fatal: true }).decode(buf); return true; } catch { return false; } };
// DEVTEAM_HUB_RECORD too: a session's mark, so the tmux server or owner action it starts records as usual
export const ownerProcessEnv = () => { const e = { ...process.env }; for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_HUB_RECORD']) delete e[k]; return e; };
// SOPS stores and their age keys. sops itself only looks in the environment and
// ~/.config/sops/age/keys.txt, and a repo's key is often a gitignored file in its main checkout, so
// the kit finds it. Anything that can write ignored paths could plant a key, or a store made for one,
// so a post never runs sops on a file in the repo: it works on a private copy of the store as the
// remote's main holds it (or as an earlier post of this kit wrote it), and a found key is used only
// if it is one of that store's age recipients. Only that one native identity reaches sops.
export const sopsHash = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const SOPS_NAME = /(^|[-_./])(age|sops)([-_.]|$)/i;
export const SOPS_FOLDER = /(^|[-_./])(age|sops|secrets?|keys?)([-_./]|$)/i;
// A failed key search, remembered so a poll doesn't repeat it. Only ever a hint to skip a search:
// a post always reads its store, and the key it needs, from the remote's main.
export const sopsMissFile = () => path.join(process.env.HOME ?? os.homedir(), '.devteam', 'sops-misses.json');
export function sopsMisses() {
  try { const j = JSON.parse(fs.readFileSync(sopsMissFile(), 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; }
}
export function saveSopsMisses(v) {
  try {
    const f = sopsMissFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(v), { mode: 0o600 });
    fs.renameSync(tmp, f);
  } catch {}
}
// A private folder, with a config of its own so no .sops.yaml in a parent folder applies. One left by
// a killed run holds only ciphertext, and goes once it is an hour old.
export function sopsPrivateDir() {
  const base = os.tmpdir();
  try {
    for (const n of fs.readdirSync(base)) if (n.startsWith('devteam-sops-')) {
      const d = path.join(base, n);
      try { if (Date.now() - fs.statSync(d).mtimeMs > 3600000) fs.rmSync(d, { recursive: true, force: true }); } catch {}
    }
  } catch {}
  const dir = fs.mkdtempSync(path.join(base, 'devteam-sops-'));
  const config = path.join(dir, '.sops-config.yaml');
  fs.writeFileSync(config, 'creation_rules: []\n', { mode: 0o600 });
  return { dir, config };
}
export let sopsKeyNote = '';
export const sopsRecipients = (b) => [...new Set(b.toString('utf8').split('\n').filter((l) => /recipient/i.test(l)).flatMap((l) => l.match(/age1[02-9ac-hj-np-z]{58}/g) ?? []))].sort();
// The store on the remote's main, read past local refs and replace objects.
export function sopsMainBlob(file) {
  const main = loadSettings().main_branch;
  // ls-remote matches a pattern against the tail of a ref name, so a branch a/refs/heads/main matches too
  const ref = `refs/heads/${main}`;
  const lines = (spawnSync('git', ['ls-remote', 'origin', ref], { cwd: mainRoot, encoding: 'utf8', timeout: 20000, killSignal: 'SIGKILL' }).stdout ?? '').split('\n').filter(Boolean).map((l) => l.split('\t')).filter(([, name]) => name === ref);
  if (lines.length !== 1) return null;
  const head = lines[0][0];
  if (!/^[0-9a-f]{40,64}$/.test(head)) return null;
  // the remote can be ahead of what is here: fetch exactly that commit
  if (spawnSync('git', ['cat-file', '-e', `${head}^{commit}`], { cwd: mainRoot, stdio: 'ignore' }).status !== 0) {
    spawnSync('git', ['fetch', '--quiet', '--no-tags', 'origin', head], { cwd: mainRoot, stdio: 'ignore', timeout: 30000, killSignal: 'SIGKILL' });
    if (spawnSync('git', ['--no-replace-objects', 'rev-parse', '--verify', '--quiet', `${head}^{commit}`], { cwd: mainRoot, encoding: 'utf8' }).stdout?.trim() !== head) return null;
  }
  const r = spawnSync('git', ['--no-replace-objects', 'show', `${head}:${file}`], { cwd: mainRoot, maxBuffer: 16 * 1024 * 1024, timeout: 10000, killSignal: 'SIGKILL' });
  return r.status === 0 ? r.stdout : null;
}
export function sopsIdentities(f, follow) {
  try {
    const st = follow ? fs.statSync(f) : fs.lstatSync(f);
    if (!st.isFile() || st.size > 65536) return [];
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    return lines.length && lines.every((l) => /^AGE-SECRET-KEY-1[0-9A-Z]+$/.test(l)) ? lines : [];
  } catch { return []; }
}
export function sopsKeyCandidates() {
  const inRepo = [];
  for (const e of (git(['ls-files', '-o', '-i', '--exclude-standard', '--directory'], mainRoot) ?? '').split('\n').filter(Boolean)) {
    if (e.endsWith('/')) {
      if (/(^|\/)(node_modules|\.worktrees|\.git)\/$/.test(e) || !SOPS_FOLDER.test(e)) continue;
      try { for (const n of fs.readdirSync(path.join(mainRoot, e))) inRepo.push(path.join(mainRoot, e, n)); } catch {}
    } else if (SOPS_NAME.test(e)) inRepo.push(path.join(mainRoot, e));
  }
  // the owner's own folder may link to a key elsewhere; a link inside the repo is never followed
  const dir = path.join(process.env.HOME ?? os.homedir(), '.config', 'sops', 'age');
  let own = [];
  try { own = fs.readdirSync(dir).map((n) => path.join(dir, n)); } catch {}
  return [...own.map((f) => [f, true]), ...inRepo.map((f) => [f, false])].slice(0, 500);
}
// The environment that gives sops this store's key, or {} to leave sops to its own lookup. A miss is
// remembered only when every candidate was really checked; a search cut short waits a minute and
// says so, and a tool that could not run is never held against the key.
export function sopsKeyFor(file, blob, base) {
  sopsKeyNote = '';
  if (base.SOPS_AGE_KEY || base.SOPS_AGE_KEY_FILE || base.SOPS_AGE_KEY_CMD) return {};
  const recipients = new Set(sopsRecipients(blob));
  if (!recipients.size) return {};
  const candidates = sopsKeyCandidates();
  // a key added or changed since the last search ends the wait at once
  const seen = candidates.map(([f]) => { try { const st = fs.statSync(f); return `${f}:${st.size}:${st.mtimeMs}`; } catch { return f; } }).join('\n');
  const missKey = sopsHash(`${file}\0${sopsHash(blob)}\0${seen}`);
  const misses = sopsMisses();
  const held = misses[missKey];
  if (held && Date.now() - held.at < held.ttl) { if (held.ttl < 600000) sopsKeyNote = 'the search for its age key did not finish'; return {}; }
  const deadline = Date.now() + 5000;
  let tried = 0, unchecked = false, cut = false;
  search: for (const [f, follow] of candidates) for (const id of sopsIdentities(f, follow)) {
    const left = deadline - Date.now();
    if (tried++ >= 32 || left <= 0) { cut = true; break search; }
    const r = spawnSync('age-keygen', ['-y'], { input: `${id}\n`, encoding: 'utf8', timeout: Math.min(2000, left), killSignal: 'SIGKILL' });
    if (r.status === 0) { if (recipients.has(r.stdout.trim())) return { SOPS_AGE_KEY: id }; continue; }
    unchecked = true;
    if (r.error) sopsKeyNote = `age-keygen could not run (${r.error.code ?? r.error.message}), and the kit needs it on PATH to match an age key`;
  }
  if (cut) sopsKeyNote ||= 'the search for its age key did not finish';
  if (!unchecked) {
    const now = Date.now();
    for (const [k, m] of Object.entries(misses)) if (now - (m?.at ?? 0) >= (m?.ttl ?? 0)) delete misses[k];
    misses[missKey] = { at: now, ttl: cut ? 60000 : 600000 };
    saveSopsMisses(misses);
  }
  return {};
}
// A per-question lock that only its live holder can lose. A lock file is born whole and removed only by
// its holder; a dead holder's is cleared under <lock>.clearing, and only while it is still that holder's.
// Anything at the lock path that isn't a regular file is named in a refusal, and nothing is posted.
export function sopsQuestionLock(id, fn) {
  const dir = path.join(runDir, 'secret-locks');
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, encodeURIComponent(id));
  const breaker = `${lock}.clearing`;
  const me = `${process.pid}:${crypto.randomUUID()}`;
  const alive = (pid) => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  // never follows a link or blocks on a pipe: anything but a regular file reads as ''
  const read = (p) => {
    let fd;
    try { fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); return fs.fstatSync(fd).isFile() ? fs.readFileSync(fd, 'utf8') : ''; } catch (e) { return e.code === 'ENOENT' ? null : ''; } finally { if (fd !== undefined) fs.closeSync(fd); }
  };
  const kind = (st) => (st.isDirectory() ? 'a folder' : st.isSymbolicLink() ? 'a link' : st.isFIFO() ? 'a named pipe' : st.isSocket() ? 'a socket' : 'a special file');
  const odd = (what) => die(`${lock} is ${what}, not a lock file. Nothing was posted; remove it${what === 'a folder' ? ' (rm -r)' : ''} and post again`);
  // A lock file is born whole: written under a private name, then linked into place, which fails if one is there.
  const claim = (p) => {
    const tmp = `${p}.${process.pid}.${crypto.randomUUID()}`;
    fs.writeFileSync(tmp, me, { flag: 'wx', mode: 0o600 });
    let refused;
    try { fs.linkSync(tmp, p); return true; } catch (e) { if (e.code === 'EEXIST') return false; refused = e; } finally { fs.rmSync(tmp, { force: true }); }
    // no fallback to a plain create: a lock seen before its holder is written reads as a dead holder's, and would be cleared
    die(`could not take the lock for ${id}: the filesystem at ${dir} refused a hard link (${refused.code ?? refused.message}). Nothing was posted`);
  };
  const start = Date.now();
  const wait = (why) => {
    if (Date.now() - start > 300000) die(why ?? `another post for ${id} is still running (${lock}); try again when it finishes`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  };
  for (;;) {
    if (claim(lock)) break;
    const st = fs.lstatSync(lock, { throwIfNoEntry: false });
    if (!st) { wait(); continue; } // released between the claim and this look
    if (st.isSymbolicLink() && !fs.existsSync(lock)) { wait(`${lock} is a link to nothing, not a lock file. Nothing was posted; remove it and post again`); continue; }
    if (!st.isFile()) odd(kind(st));
    const owner = read(lock);
    if (owner === null) { wait(); continue; }
    if (alive(Number(owner.split(':')[0]))) { wait(); continue; }
    // Its holder is dead. One process at a time clears a dead lock, and only while the lock is still that
    // dead holder's: nothing else removes a lock, so a live one taken meanwhile is never cleared.
    if (!claim(breaker)) {
      const b = read(breaker);
      if (b !== null && !alive(Number(b.split(':')[0]))) die(`a post for ${id} died while clearing a stale lock; remove ${breaker} and post again`);
      wait();
      continue;
    }
    let bad = null; // refused only after .clearing is let go, so the next post isn't stopped by it
    try {
      const now = fs.lstatSync(lock, { throwIfNoEntry: false });
      if (now && !now.isFile()) bad = kind(now);
      else if (now && read(lock) === owner) { try { fs.unlinkSync(lock); } catch (e) { if (e.code !== 'ENOENT') bad = `something that could not be removed (${e.code})`; } }
    } finally { if (read(breaker) === me) fs.rmSync(breaker, { force: true }); }
    if (bad) odd(bad);
  }
  const release = () => { if (read(lock) === me) fs.rmSync(lock, { force: true }); };
  process.once('exit', release);
  try { return fn(); } finally { process.off('exit', release); release(); }
}
// A question's secrets for one store go in together, or not at all: from a private copy of the store
// on the remote's main, so nothing in a worktree or an ignored file can choose its data key, and with
// no partial state for a later post to continue from.
export function sopsPostAll(id, sinks, declared, posted, values, cwd, redact) {
  const results = new Map();
  const groups = new Map();
  for (const x of sinks) if (x.k.type === 'sops') groups.set(x.k.file, [...(groups.get(x.k.file) ?? []), x]);
  for (const [file, group] of groups) {
    const names = declared.filter((x) => { try { const k = parseSink(x.sink, { soft: true }); return k.type === 'sops' && k.file === file; } catch { return false; } }).map((x) => x.name);
    const earlier = names.filter((n) => posted.some((p) => p.name === n));
    if (earlier.length) nudgeSupervisor(`[devteam secrets for ${id} from owner] ${file} already holds ${earlier.join(', ')} from an earlier post and takes the rest only in one post: ask for all of ${names.join(', ')} again in a new question.`);
    const missing = names.filter((n) => !group.some((x) => x.name === n));
    const r = earlier.length ? { ok: false, out: `${earlier.join(', ')} already went to ${file}, and a store takes all of a question's secrets in one post. Nothing was changed. The supervisor has been told to ask for all of them again in a new question` }
      : missing.length ? { ok: false, out: `${file} takes all of this question's secrets in one post, and ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} missing. Nothing was saved` }
        : sopsSetAll(file, group, values, cwd, redact);
    for (const x of group) results.set(x.name, r);
  }
  return results;
}
export function sopsSetAll(file, group, values, cwd, redact) {
  const target = path.join(cwd, file);
  if (!fs.existsSync(target)) return { ok: false, out: `${file} does not exist on main; create it with sops first` };
  for (const x of group) {
    if (x.k.keys.some((part) => /^\d+$/.test(part))) return { ok: false, out: `${x.sink}: a sops sink names map keys, not list positions` };
    if (x.kind === 'file' && !isUtf8(values.get(x.name))) return { ok: false, out: 'sops stores text; this file is binary (base64 it first, or use a file: sink)' };
  }
  const blob = sopsMainBlob(file);
  if (!blob) return { ok: false, out: `could not read ${file} from the remote's main` };
  const want = sopsRecipients(blob).join();
  const { dir, config } = sopsPrivateDir();
  try {
    const copy = path.join(dir, path.basename(file));
    fs.writeFileSync(copy, blob, { mode: 0o600 });
    const env = { ...ownerProcessEnv(), ...sopsKeyFor(file, blob, ownerProcessEnv()) };
    for (const x of group) {
      const text = values.get(x.name).toString('utf8');
      const input = JSON.stringify(x.kind === 'file' ? text : text.replace(/\r?\n$/, ''));
      const p = spawnSync('sops', ['--config', config, 'set', '--value-stdin', copy, x.k.keys.map((part) => `[${JSON.stringify(part)}]`).join('')], { cwd: dir, encoding: 'utf8', input, env, maxBuffer: 16 * 1024 * 1024, timeout: 120000, killSignal: 'SIGKILL' });
      if (p.error && !(p.error.code === 'EPIPE' && p.status !== null && p.status !== 0)) return { ok: false, out: redact(p.error.message) };
      let out = redact(`${p.stdout ?? ''}${p.stderr ?? ''}`.trim()).split(copy).join(file);
      if (p.status !== 0) {
        if (want && /no master key|failed to load age|failed to get the data key/i.test(out)) out = `no usable age key for ${file}${sopsKeyNote ? ` (${sopsKeyNote})` : ''}. The kit looks in the environment, ~/.config/sops/age/ and this repo's gitignored files with age or sops in their name, needs age-keygen on PATH to match one, and uses a key only if it is one of the file's recipients on the remote's main. ${out}`;
        if (/value-stdin/.test(out)) out += ' (this sops is too old for set --value-stdin; update it)';
        return { ok: false, out };
      }
    }
    const done = fs.readFileSync(copy);
    if (done.equals(blob)) return { ok: false, out: `sops exited 0 but ${file} did not change` };
    if (sopsRecipients(done).join() !== want) return { ok: false, out: `${file}: its recipients changed; not saved` };
    const parent = path.dirname(target);
    if (!insideDir(fs.realpathSync(parent), fs.realpathSync(cwd))) return { ok: false, out: `${file} resolves outside the repo` };
    const tmp = path.join(parent, `.${path.basename(target)}.devteam-${process.pid}`);
    try { fs.writeFileSync(tmp, done, { flag: 'wx', mode: 0o644 }); fs.renameSync(tmp, target); } catch (e) { fs.rmSync(tmp, { force: true }); return { ok: false, out: e.message }; }
    return { ok: true, out: '', files: [file] };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
// Returns { ok, out, files }: files are the tracked paths a commit sink changed.
export function runSink(k, value, kind, cwd, redact) {
  const run = (cmd, args, opts) => {
    const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...opts });
    // a tool that refuses before reading its stdin (sops with no key) gives EPIPE: its own error is the one to show
    if (r.error && !(r.error.code === 'EPIPE' && r.status !== null && r.status !== 0)) return { ok: false, out: redact(r.error.message) };
    return { ok: r.status === 0, out: redact(`${r.stdout ?? ''}${r.stderr ?? ''}`.trim()) };
  };
  const changed = (rel) => (git(['status', '--porcelain', '--', rel], cwd) ?? '').trim() !== '';
  if (k.type === 'stdin') {
    if (!allowedCommand(k.argv)) return { ok: false, out: `\`${k.argv.join(' ')}\` is not in settings.secret_commands` };
    return run(k.argv[0], k.argv.slice(1), { input: value, env: ownerProcessEnv() });
  }
  if (k.type === 'file') {
    if (git(['check-ignore', '-q', '--', k.file], cwd) === null) return { ok: false, out: `${k.file} is not gitignored; a file sink only writes ignored files` };
    const target = path.join(cwd, k.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!insideDir(fs.realpathSync(path.dirname(target)), fs.realpathSync(cwd))) return { ok: false, out: `${k.file} resolves outside the repo` };
    const tmp = path.join(path.dirname(target), `.${path.basename(target)}.devteam-${process.pid}`);
    try {
      fs.writeFileSync(tmp, value, { flag: 'wx', mode: 0o600 });
      fs.renameSync(tmp, target);
    } catch (e) { fs.rmSync(tmp, { force: true }); return { ok: false, out: e.message }; }
    return { ok: true, out: `wrote ${k.file}` };
  }
  if (kind === 'file' && !isUtf8(value)) return { ok: false, out: `${k.type} stores text; this file is binary (base64 it first, or use a file: sink)` };
  // rails-credentials: credentials:edit with an editor that sets one key. Without the environment's
  // key Rails would generate a new key and new credentials, so refuse instead.
  const enc = k.env === 'default' ? 'config/credentials.yml.enc' : `config/credentials/${k.env}.yml.enc`;
  const keyFile = k.env === 'default' ? 'config/master.key' : `config/credentials/${k.env}.key`;
  if (!fs.existsSync(path.join(cwd, enc))) return { ok: false, out: `${enc} does not exist; create the ${k.env} credentials first` };
  if (!fs.existsSync(path.join(cwd, keyFile)) && !process.env.RAILS_MASTER_KEY) {
    if (!fs.existsSync(path.join(mainRoot, keyFile))) return { ok: false, out: `no ${keyFile} and no RAILS_MASTER_KEY in your environment: for production, set RAILS_MASTER_KEY in the shell that runs this rather than keeping the key on disk` };
    if (git(['check-ignore', '-q', '--', keyFile], cwd) === null) return { ok: false, out: `${keyFile} is not gitignored here; refusing to copy a key into a worktree that commits` };
    fs.copyFileSync(path.join(mainRoot, keyFile), path.join(cwd, keyFile));
  }
  return withScratch((dir) => {
    const vf = path.join(dir, 'value');
    const ed = path.join(dir, 'edit.rb');
    const done = path.join(dir, 'done');
    fs.writeFileSync(vf, value, { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(ed, RAILS_EDITOR, { flag: 'wx', mode: 0o600 });
    const args = ['credentials:edit', ...(k.env === 'default' ? [] : ['--environment', k.env])];
    const r = run(fs.existsSync(path.join(cwd, 'bin/rails')) ? 'bin/rails' : 'rails', args, { env: { ...ownerProcessEnv(), EDITOR: `ruby ${ed}`, VISUAL: `ruby ${ed}`, DEVTEAM_SECRET_FILE: vf, DEVTEAM_SECRET_KEYPATH: k.keys.join('.'), DEVTEAM_SECRET_KIND: kind, DEVTEAM_SECRET_DONE: done } });
    if (r.ok && !fs.existsSync(done)) return { ok: false, out: `the credentials editor did not finish, so nothing was set${r.out ? `: ${r.out}` : ''}` };
    if (r.ok && !changed(enc)) return { ok: false, out: `${enc} did not change` };
    return { ...r, files: [enc] };
  });
}
// Read one line from the terminal without echoing it: from /dev/tty, with the terminal's own state
// saved and restored whatever happens (Ctrl-C included, which arrives here as a byte).
export function readHidden(prompt) {
  let fd;
  try { fd = fs.openSync('/dev/tty', 'r+'); } catch { die('secret post: no terminal to read from; pipe JSON with --json, or use the dashboard'); }
  const stty = (...a) => spawnSync('stty', a, { stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8' });
  const saved = stty('-g').stdout?.trim();
  const restore = () => { if (saved) stty(saved); else stty('echo', 'icanon', 'isig'); };
  process.once('exit', restore);
  fs.writeSync(fd, prompt);
  stty('-echo', '-icanon', '-isig', 'min', '1', 'time', '0');
  const bytes = [];
  try {
    const buf = Buffer.alloc(1);
    for (;;) {
      if (!fs.readSync(fd, buf, 0, 1, null)) break;
      const c = buf[0];
      if (c === 3) { restore(); fs.writeSync(fd, '\n'); die('cancelled'); }
      if (c === 4 || c === 10 || c === 13) break;
      if (c === 127 || c === 8) { bytes.pop(); continue; }
      bytes.push(c);
    }
    return Buffer.from(bytes);
  } finally {
    restore();
    fs.writeSync(fd, '\n');
    fs.closeSync(fd);
    bytes.fill(0);
  }
}
export const MAX_SECRETS = 20;
export function cmdSecret() {
  const [sub, id] = positional;
  if (sub === 'sinks') return out('rails-credentials:<env|default>:<key.path>   sops:<file>:<key.path>   file:<gitignored path>   stdin:<command> <args…> (allowed in settings.secret_commands)');
  if (sub !== 'post' || !id) die('usage: secret post <qid> [--file NAME=path …] [--json]   (owner: post a question\'s secrets; --json reads {"NAME": "value" | {"b64": "…"}} on stdin)');
  const { by } = ownerWriter();
  // Drain stdin first, so a writer feeding it never blocks on a process that refused early.
  let body = null;
  if (flags.json) {
    const raw = fs.readFileSync(0);
    try { body = JSON.parse(raw.toString('utf8')); } catch { body = undefined; }
    raw.fill(0);
    if (body === undefined || typeof body !== 'object' || !body) die('secret post --json: stdin is a JSON object');
  }
  const v = openQuestion(id);
  const declared = v.secrets ?? [];
  if (!declared.length) die(`${id} asks for no secrets`);
  const posted = [...(v.secrets_posted ?? [])];
  const todo = declared.filter((x) => !posted.some((p) => p.name === x.name));
  if (!todo.length) die(`${id}: every secret is already posted`);
  const values = new Map();
  if (body) {
    for (const x of todo) {
      const val = body[x.name];
      if (val === undefined || val === '') continue;
      values.set(x.name, typeof val === 'string' ? Buffer.from(val, 'utf8') : typeof val?.b64 === 'string' ? Buffer.from(val.b64, 'base64') : die(`${x.name}: a string or {"b64": "…"}`));
    }
    body = null;
  } else {
    for (const spec of asList(flags.file)) {
      const i = spec.indexOf('=');
      const name = spec.slice(0, i);
      if (i < 1 || !todo.some((x) => x.name === name)) die(`--file ${spec}: NAME=path, for a secret ${id} still needs`);
      values.set(name, fs.readFileSync(spec.slice(i + 1)));
    }
    for (const x of todo) if (!values.has(x.name)) {
      if (x.kind === 'file') { warn(`${x.name} is a file: pass --file ${x.name}=<path>`); continue; }
      const val = readHidden(`${x.name} goes to ${sinkWords(x.sink)}.\nPaste it (hidden; Enter to skip): `);
      if (val.length) values.set(x.name, val);
    }
  }
  if (!values.size) die('nothing to post');
  // a SOPS store takes all of a question's secrets in one post: say what's missing before anything runs
  const storeOf = (x) => { try { const k = parseSink(x.sink, { soft: true }); return k.type === 'sops' ? k.file : null; } catch { return null; } };
  for (const file of new Set(todo.map(storeOf).filter(Boolean))) {
    const names = todo.filter((x) => storeOf(x) === file).map((x) => x.name);
    const missing = names.filter((n) => !values.has(n));
    if (missing.length && missing.length < names.length) die(`${file} takes all of this question's secrets in one post: add ${missing.join(', ')} too. Nothing was posted`);
  }
  // a completing post's own line: the owner's, with the posted names and the answer in one
  const ownPost = (u) => writerClass(u.by) === 'owner' && u.secrets_posted !== undefined && u.answer !== undefined;
  // one post per question at a time, from reading what is posted through the log line
  return sopsQuestionLock(id, () => {
    logCache = null;
    const now = openQuestion(id).secrets_posted ?? [];
    if (now.length !== posted.length) die(`${id} changed while you were posting; nothing was posted from this run. Look again and post what is still open`);
    const had = logGet(id).updates.filter(ownPost).length;
    postSecretsNow(id, v, declared, posted, todo, values, by);
    // the post that completes it answers the question, and that resolves its thread (kit-720): by this
    // post's own line, never an answer that came in meanwhile (a chat answer while a sink ran)
    logCache = null;
    const mine = logGet(id).updates.filter(ownPost)[had];
    if (mine) resolveQuestionThreads(id, mine.answer, by);
  });
}
export function postSecretsNow(id, v, declared, posted, todo, values, by) {
  const redact = redactor(values);
  const sinks = todo.filter((x) => values.has(x.name)).map((x) => ({ ...x, k: parseSink(x.sink) }));
  // Encrypted stores change in one chore worktree per question, committed together; it starts clean.
  const slug = `secret-${id.split('-').slice(1, 3).join('-')}`;
  let wt = null;
  if (sinks.some((x) => x.k.commits)) {
    wt = choreWorktree(slug, { setup: true });
    git(['checkout', '--quiet', '--', '.'], wt);
    git(['clean', '-fdq'], wt);
  }
  const failures = [];
  const done = [];
  const files = new Set();
  try {
    const sopsDone = sopsPostAll(id, sinks, declared, posted, values, wt, redact);
    for (const x of sinks) {
      const r = x.k.type === 'sops' ? sopsDone.get(x.name) : runSink(x.k, values.get(x.name), x.kind, x.k.commits ? wt : mainRoot, redact);
      if (r.ok) { done.push({ name: x.name, at: nowIso() }); for (const f of r.files ?? []) files.add(f); }
      else failures.push(`${x.name} → ${sinkWords(x.sink)}: ${r.out || 'failed'}`);
    }
  } finally {
    for (const buf of values.values()) buf.fill(0);
  }
  let landing = '';
  if (wt && files.size) {
    // Exactly the stores the sinks changed; anything else the run left behind is discarded.
    gitOrDie(['add', '--', ...files], wt);
    gitOrDie(['commit', '--quiet', '-m', `chore-${slug}: post secrets for ${id}\n\nEncrypted values posted by the owner; never in the log.`], wt);
    git(['checkout', '--quiet', '--', '.'], wt);
    git(['clean', '-fdq'], wt);
    landing = ` Land it: chore pr ${slug} --title "post secrets for ${id}", then merge --chore ${slug} --approved ${id}.`;
  }
  if (done.length) {
    const all = [...posted, ...done];
    const complete = declared.every((x) => all.some((p) => p.name === x.name));
    appendLog({ type: 'question', op: 'set', id, secrets_posted: all, ...(complete ? { answer: `Posted ${all.length} secret${all.length > 1 ? 's' : ''}` } : {}) }, by);
    nudgeSupervisor(`[devteam secrets ${complete ? 'posted' : 'partly posted'} for ${id} from owner] ${done.map((d) => d.name).join(', ')}.${landing}`);
    out(`posted ${done.map((d) => d.name).join(', ')}${complete ? `; ${id} is answered` : ''}${landing}`);
  }
  if (failures.length) die(`not posted:\n  - ${failures.join('\n  - ')}`);
}
// The hold on the goal a question is about (its goal, or the goals of the tickets it is about or
// blocks): null while that runs or drains. A let-go goal's open questions leave the inbox until it
// is restored; a parked goal's stay, labelled.
export function questionHold(q) {
  const ts = tickets();
  const goals = q.goal ? [logGet(q.goal)].filter((g) => g?.type === 'goal') : [...new Set([q.ticket, ...(q.blocks ?? [])].filter((id) => ts.has(id)))].flatMap((id) => ticketGoals(ts.get(id)));
  if (!goals.length) return null;
  const m = modeOf(goals);
  return ['park', 'let-go'].includes(m) ? m : null;
}
