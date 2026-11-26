/* imports start */
import fs from 'node:fs';
import path from 'node:path';
import { ARTIFACTS_REL } from './artifacts.mjs';
import { ENTER_CONFIRMS } from './panes.mjs';
import { LINK_ID } from './links.mjs';
import { OWNER_SETTINGS } from './settings.mjs';
import { REPO_OWN_DEFAULTS } from './links.mjs';
import { SETTINGS_DEFAULTS } from './settings.mjs';
import { SETTINGS_KEYS } from './settings.mjs';
import { UNSAFE_TEXT_ALL } from './links.mjs';
import { activeWorker } from './graph.mjs';
import { answers } from './orient.mjs';
import { byTime } from './log-sync.mjs';
import { choreWorktree } from './goals.mjs';
import { command } from './base.mjs';
import { commonDir } from './state.mjs';
import { deniedFor } from './fleet.mjs';
import { die } from './base.mjs';
import { draftArtifacts } from './artifacts.mjs';
import { draftWorktree } from './artifacts.mjs';
import { draining } from './fleet.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { flagStr } from './base.mjs';
import { flags } from './base.mjs';
import { fleetMode } from './holds.mjs';
import { gateEnv } from './check-ticket.mjs';
import { handledMessages } from './log-sync.mjs';
import { isObj } from './artifact-notes.mjs';
import { landedArtifacts } from './artifacts.mjs';
import { loadSettings } from './settings.mjs';
import { logGet } from './log-sync.mjs';
import { logWriter } from './log.mjs';
import { mainRoot } from './state.mjs';
import { memoryFull } from './hub/operator.mjs';
import { mergedAtSha } from './fleet.mjs';
import { out } from './base.mjs';
import { paneAsking } from './panes.mjs';
import { paneTable } from './sessions.mjs';
import { paneWaitingIn } from './panes.mjs';
import { pastHalfMade } from './check-ticket.mjs';
import { planners } from './panes.mjs';
import { plural } from './questions.mjs';
import { positional } from './base.mjs';
import { projectDir } from './state.mjs';
import { projectInRepo } from './settings.mjs';
import { projectRel } from './settings.mjs';
import { promptFor } from './sessions.mjs';
import { promptPointer } from './sessions.mjs';
import { readLog } from './log-sync.mjs';
import { readPreviews } from './previews.mjs';
import { readText } from './base.mjs';
import { realPath } from './state.mjs';
import { repo } from './repos.mjs';
import { repoRoot } from './state.mjs';
import { resolvePane } from './sessions.mjs';
import { runDir } from './state.mjs';
import { runPath } from './settings.mjs';
import { sessionMarkerPrefix } from './sessions.mjs';
import { settledByLanding } from './sessions.mjs';
import { sh } from './base.mjs';
import { shq } from './scores.mjs';
import { slug } from './base.mjs';
import { spawnSync } from 'node:child_process';
import { supervisorOnly } from './log.mjs';
import { threadQuestion } from './threads.mjs';
import { tickets } from './graph.mjs';
import { tmux } from './sessions.mjs';
import { tmuxServerEnv } from './sessions.mjs';
import { tmuxSession } from './base.mjs';
import { tmuxTarget } from './base.mjs';
import { typeInto } from './sessions.mjs';
import { typeNow } from './sessions.mjs';
import { warn } from './base.mjs';
import { withLock } from './log.mjs';
import { writeJsonAtomic } from './sensors.mjs';
import { writerClass } from './log.mjs';
/* imports end */
/* responder-session start */
// The thread responder (kit-103; fast-threads.md §The session): a second, narrow session that
// answers the owner's thread turns at once while the supervisor works, and hands the rest over.
// One window, `responder`, in the fleet's tmux session; its worktree .worktrees/responder is
// detached at main and moved to main again at each start. It writes as `responder` (logWriter),
// is refused every supervisor command (supervisorOnly), runs the owner's responder_command (else
// agent_command) with the workers' deny rules and no Stop hook, and makes no branch and no slot act.
export const RESPONDER_NAME = 'responder';
// Whether this process runs in the responder's worktree, whatever its env says (final-1 F2). Both
// sides are real paths, so a linked cwd counts, a look-alike (responder-x) doesn't; only the parent
// of the folder is resolved, so a link AT .worktrees/responder never makes its target the responder's.
export function inResponderWorktree() {
  let cwd;
  try { cwd = realPath(process.cwd()); } catch { return false; }
  const wt = path.join(realPath(path.join(mainRoot, '.worktrees')), 'responder');
  return cwd === wt || cwd.startsWith(`${wt}${path.sep}`);
}
// git for the responder's start. What it could have planted never runs or counts: no shared hook
// (final-1 F6), no fsmonitor (F4), no replaced object (F5; kit-778: core.useReplaceRefs=true in a
// config beats --no-replace-objects on older git (2.39), and the command line's -c beats every config).
export const RESPONDER_GIT = ['--no-replace-objects', '-c', 'core.useReplaceRefs=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false'];
export const responderGit = (args, cwd = mainRoot, env = null) => spawnSync('git', [...RESPONDER_GIT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: 120000, ...(env ? { env: { ...process.env, ...env } } : {}) });
// A git call to origin, in its own process group: at the deadline the whole group goes, so a hung
// transport (ssh) isn't left behind by a refused start (final-2b F4).
export const RESPONDER_GROUP_RUN = "const {spawn}=require('child_process');const [ms,...a]=process.argv.slice(1);const c=spawn(a[0],a.slice(1),{detached:true,stdio:'inherit'});const t=setTimeout(()=>{try{process.kill(-c.pid,'SIGKILL')}catch{}process.exit(124)},Number(ms));c.on('error',()=>process.exit(127));c.on('exit',(code)=>{clearTimeout(t);process.exit(code??1)});";
export function responderOrigin(args) {
  const ms = Number(process.env.DEVTEAM_RESPONDER_GIT_MS) || 120000;
  return spawnSync(process.execPath, ['-e', RESPONDER_GROUP_RUN, '--', String(ms), 'git', ...RESPONDER_GIT, ...args], { cwd: mainRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: ms + 10000 });
}
// The branch the kit treats as main, from the main checkout's own settings file: not through a local
// ref, which the responder can move without a push, and not origin's HEAD (final-2b F3).
export function responderMainBranch() {
  const block = readText(path.join(projectDir, 'settings.md'))?.match(/```json devteam\s*\n([\s\S]*?)\n```/);
  try { const b = block ? JSON.parse(block[1]).main_branch : null; if (typeof b === 'string' && b) return b; } catch {}
  return SETTINGS_DEFAULTS.main_branch;
}
// The owner's settings key that can't be what a start reads, or null. The keys the start reads
// are checked strictly, so a junk value never starts the kit's defaults and a deny list that isn't
// one never drops the workers' rules (final-6 F1, final-6b F1-F3). Every other owner key is checked
// only for the kind the kit reads it as, with null allowed (unset): never SETTING_SHAPES, which
// decides what the Settings page shows and refuses values the kit takes, such as init's
// `project: "My App"` (final-7 F1, rulings-kit-103-r4.md Round 8). An empty deny list is the
// owner's choice, as it is for workers (final-7 F2). A blank responder_command stays unset, as
// done-when 1 has it (R1c); main_branch is checked by responderMain. Only owner keys are judged:
// the start reads those from main, and every other key from the working file (Round 8 addendum).
export const RESPONDER_NEEDS = {
  worker_denied_commands: (v) => Array.isArray(v) && v.every((c) => typeof c === 'string' && c.trim() !== ''),
  agent_command: (v) => typeof v === 'string' && v.trim() !== '',
  responder_command: (v) => v === null || typeof v === 'string',
};
// the kinds the kit reads where the default gives none (null or no default), or more than one
export const RESPONDER_KINDS = { usage_command: ['string'], remediations: ['object'], release: ['string', 'object'] };
export const settingKind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : isObj(v) ? 'object' : typeof v);
export function responderBadSetting(own) {
  for (const [k, v] of Object.entries(own)) {
    if (!Object.hasOwn(OWNER_SETTINGS, k)) continue;
    if (RESPONDER_NEEDS[k]) { if (!RESPONDER_NEEDS[k](v)) return k; continue; }
    if (k === 'main_branch' || v === null) continue;
    const def = SETTINGS_DEFAULTS[k] ?? REPO_OWN_DEFAULTS[k];
    const kinds = RESPONDER_KINDS[k] ?? (def == null ? null : [settingKind(def)]);
    if (kinds && !kinds.includes(settingKind(v))) return k;
  }
  return null;
}
// The commit origin has at that exact branch, and the owner's settings as that commit has them; a
// commit that names another branch as main is refused. Refuses if origin can't be read (final-1 F5).
export function responderMain(s) {
  const branch = responderMainBranch();
  const ref = `refs/heads/${branch}`;
  const ls = responderOrigin(['ls-remote', 'origin', ref]);
  const sha = ls.status === 0 ? ls.stdout.split('\n').map((l) => l.split('\t')).find(([, r]) => r === ref)?.[0] : null;
  if (ls.status === 0 && !sha) die(`responder: origin has no ${ref}, so the owner's command can't be confirmed; check main_branch in settings.md`);
  if (!/^[0-9a-f]{40,64}$/.test(sha ?? '')) die(`responder: could not read main from origin (${ref}), so the owner's command can't be confirmed; try again when origin answers`);
  if (responderOrigin(['fetch', '--quiet', 'origin', ref]).status !== 0 || responderGit(['cat-file', '-e', `${sha}^{commit}`]).status !== 0) die(`responder: could not read main from origin (${sha.slice(0, 8)} did not arrive)`);
  const settings = { ...s };
  if (projectInRepo) {
    const shown = responderGit(['show', `${sha}:${projectRel}/settings.md`]);
    const block = shown.status === 0 ? shown.stdout.match(/```json devteam\s*\n([\s\S]*?)\n```/) : null;
    // never the kit's defaults in place of the owner's command and deny rules (final-3 F3)
    if (!block) die(`responder: could not read the owner's settings at ${ref} (${sha.slice(0, 8)}), so nothing was started`);
    let own;
    try { own = JSON.parse(block[1]); } catch { die(`responder: settings.md on main (${sha.slice(0, 8)}) is not valid JSON`); }
    // null, an array, a scalar, {} or only unknown keys (__proto__ among them) would leave every
    // owner setting at the kit's default (final-4 F1, final-5 F1, m-20261122-080705821-supervisor;
    // F1). A block without main_branch is a project on main, as init writes one; one present must be a
    // branch name (m-20261122-054734545-supervisor).
    if (!isObj(own) || !Object.keys(own).some((k) => SETTINGS_KEYS.includes(k)) || (Object.hasOwn(own, 'main_branch') && (typeof own.main_branch !== 'string' || !own.main_branch))) die(`responder: could not read the owner's settings at ${ref} (${sha.slice(0, 8)}): the settings block is not an object of settings, so nothing was started`);
    if (Object.hasOwn(own, 'main_branch') && responderGit(['check-ref-format', '--branch', own.main_branch]).status !== 0) die(`responder: could not read the owner's settings at ${ref} (${sha.slice(0, 8)}): main_branch is not a branch name, so nothing was started`);
    const bad = responderBadSetting(own);
    if (bad) die(`responder: could not read the owner's settings at ${ref} (${sha.slice(0, 8)}): ${bad} is not a value it can take, so nothing was started`);
    const onMain = { ...SETTINGS_DEFAULTS, ...own };
    if (onMain.main_branch !== branch) die(`responder: could not read main from origin: ${ref} names ${onMain.main_branch} as main`);
    for (const k of Object.keys(OWNER_SETTINGS)) settings[k] = onMain[k];
  }
  return { sha, settings };
}
// The tracked files that differ from a commit, read from the files themselves through a fresh index:
// the worktree's own index can carry the stat of an edited file beside the original blob (final-2 F2).
export function responderDiffers(wt, sha) {
  fs.mkdirSync(path.join(runDir, 'agent'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(runDir, 'agent', 'responder-index-'));
  const env = { GIT_INDEX_FILE: path.join(dir, 'index') };
  try {
    if (responderGit(['read-tree', sha], wt, env).status !== 0) return null;
    // with --ignore-submodules, neither the refresh nor the compare looks inside a nested repo at a
    // gitlink, so its own config (a clean filter) never runs here (final-3b F2, final-4 F7). The
    // refresh's flag alone has no case that goes red: a refresh reads a nested repo's HEAD and runs
    // no filter there, with the flag or without it (git 2.39, probed). It stays so the refresh never
    // looks inside one; R12's planted-gitlink cases go red with all three flags removed.
    responderGit(['update-index', '--ignore-submodules', '-q', '--really-refresh'], wt, env);
    const d = responderGit(['diff-files', '--ignore-submodules=all', '--name-only', '-z'], wt, env);
    return d.status === 0 ? d.stdout.split('\0').filter(Boolean) : null;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
// Why .worktrees/responder isn't the responder's own worktree, or null, from the files alone: no git
// runs in a folder whose .git it may have rewritten (final-1 F1, F4).
export function responderWorktreeProblem(wt) {
  const no = `${wt} is not a git worktree of its own: move it aside or remove it, then responder again`;
  try {
    if (!fs.lstatSync(wt).isDirectory() || !fs.lstatSync(path.join(wt, '.git')).isFile()) return no;
    const to = /^gitdir: (.+?)\n?$/.exec(fs.readFileSync(path.join(wt, '.git'), 'utf8'))?.[1];
    const common = responderGit(['rev-parse', '--absolute-git-dir']).stdout.trim();
    const own = path.join(common, 'worktrees', RESPONDER_NAME);
    if (!to || !common || !fs.lstatSync(own).isDirectory() || realPath(path.resolve(wt, to)) !== realPath(own)) return no;
    // git's own record of it points back here
    return realPath(path.dirname(fs.readFileSync(path.join(own, 'gitdir'), 'utf8').trim())) === realPath(wt) ? null : no;
  } catch { return no; }
}
// A commit's entries as [mode, path]; null if it can't be read.
export function responderTree(wt, rev) {
  const r = responderGit(['ls-tree', '-r', '-z', rev], wt);
  return r.status === 0 ? r.stdout.split('\0').filter(Boolean).map((e) => { const tab = e.indexOf('\t'); return [e.slice(0, 6), e.slice(tab + 1)]; }) : null;
}
// Why the worktree holds something git can't be trusted to report, or null, read without running any
// filter. A gitlink the commit lacks, or files at one it has, would be a nested repo whose own config
// runs in the start's git (final-3b F2). A folder git can't list, or a FIFO, socket or device, hides
// from status and clean (final-3 F2), so the files are walked by lstat, following no link.
export function responderPlanted(wt, sha) {
  const head = responderTree(wt, 'HEAD');
  const main = responderTree(wt, sha);
  const index = responderGit(['ls-files', '--stage', '-z'], wt);
  if (!head || !main || index.status !== 0) return `${wt}: could not read its index or commits, so the responder's worktree is left as it is`;
  const known = (mode) => new Set([...head, ...main].filter(([m]) => m === mode).map(([, f]) => f));
  const gitlinks = known('160000');
  const links = known('120000');
  for (const e of index.stdout.split('\0').filter(Boolean)) {
    if (!e.startsWith('160000 ')) continue;
    const f = e.slice(e.indexOf('\t') + 1);
    if (!gitlinks.has(f)) return `${wt} has a nested repository the commit doesn't have (${f}): remove the worktree, then responder again`;
    let inside = [];
    try { inside = fs.readdirSync(path.join(wt, f)); } catch (err) { if (err.code !== 'ENOENT') inside = [f]; }
    if (inside.length) return `${wt} holds files at a nested repository's path (${f}), as an initialised submodule does, and a start can't check inside one: remove the worktree (git worktree remove --force ${wt}), then responder again`;
  }
  const cant = (f, why) => `${wt}: can't check ${f} (${why}): clear it or remove the worktree, then responder again`;
  const loose = [];
  const folders = [''];
  while (folders.length) {
    const dir = folders.pop();
    let names;
    try { names = fs.readdirSync(path.join(wt, dir)); } catch { return cant(dir, "a folder that can't be listed"); }
    for (const n of names) {
      if (!dir && n === '.git') continue;
      const f = dir ? path.join(dir, n) : n;
      // git never lists a path named .git, file or folder: a nested repo, or what hides in one (final-4 F2)
      if (n === '.git') return `${wt}: can't check ${f} (a nested repository's .git): a submodule or a git dependency (a pip editable install, a git package in node_modules) keeps one there; remove the worktree (git worktree remove --force ${wt}), then responder again`;
      let st;
      try { st = fs.lstatSync(path.join(wt, f)); } catch { return cant(f, "it can't be read"); }
      if (st.isDirectory()) folders.push(f);
      else if (st.isSymbolicLink()) { if (!links.has(f)) loose.push(f); }
      else if (!st.isFile()) return cant(f, 'not a file or a folder');
    }
  }
  // A link the commit lacks is left only where git ignores it, so git clean -ffdX removes it, never
  // following it (node_modules/.bin, a .venv); check-ignore runs no filter (final-4 F5).
  if (loose.length) {
    const ci = spawnSync('git', [...RESPONDER_GIT, 'check-ignore', '--no-index', '-z', '--stdin'], { cwd: wt, input: `${loose.join('\0')}\0`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
    if (ci.status !== 0 && ci.status !== 1) return `${wt}: could not ask git which links it ignores, so the responder's worktree is left as it is`;
    const ignored = new Set((ci.stdout ?? '').split('\0').filter(Boolean));
    const kept = loose.find((f) => !ignored.has(f));
    if (kept) return cant(kept, 'a link the commit does not have');
  }
  return null;
}
// The owner's worktree_files, each written as a new file: whatever is at the path goes first, so a
// hard link or a symlink there is never written through (final-3b F3).
export function responderSeed(wt, files, R) {
  for (const rel of files ?? []) {
    const from = path.join(R.root, rel);
    if (!fs.existsSync(from)) { warn(`worktree_files: ${rel} is not in the main checkout`); continue; }
    const to = path.join(wt, rel);
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.rmSync(to, { force: true });
      const fd = fs.openSync(to, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      try { fs.writeFileSync(fd, fs.readFileSync(from)); fs.fchmodSync(fd, fs.statSync(from).mode & 0o777); } finally { fs.closeSync(fd); }
    } catch (e) { die(`${wt}: could not seed ${rel}: ${e.message}`); }
  }
}
// What in the worktree would outlive a refresh, as full paths: tracked changes, files git was told
// not to look at, and untracked files, but for a regular file the owner's worktree_files seeds from
// a source that exists, so the copy replaces it (final-2 F3).
export function responderDirty(wt, seeded) {
  // --ignore-submodules=all: status never enters a nested repo at a gitlink to run its filter
  const st = responderGit(['status', '--ignore-submodules=all', '--porcelain=v1', '-z', '--untracked-files=all'], wt);
  const flags = responderGit(['ls-files', '-v', '-z'], wt);
  if (st.status !== 0 || flags.status !== 0) return null;
  const seeds = new Set((seeded ?? []).map((f) => path.normalize(String(f))));
  const isSeed = (f) => { try { return seeds.has(path.normalize(f)) && fs.existsSync(path.join(mainRoot, f)) && fs.lstatSync(path.join(wt, f)).isFile(); } catch { return false; } };
  const hits = [];
  const parts = st.stdout.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2);
    const f = parts[i].slice(3);
    if (/[RC]/.test(code)) i++;
    if (!(code === '??' && isSeed(f))) hits.push(f);
  }
  for (const e of flags.stdout.split('\0').filter(Boolean)) if (e[0] !== 'H') hits.push(e.slice(2));
  return hits;
}
// A Claude Code policy file for one session, passed with --settings: the owner's worker deny rules,
// naming the main branch of the repo it works in. A worker or planner also gets the Stop hook
// (stop-ok); the responder doesn't. Its path.
export function claudePolicy(name, s, mb, { stopHook = false } = {}) {
  const policy = path.join(runDir, 'agent', `${name}-claude.json`);
  fs.mkdirSync(path.dirname(policy), { recursive: true });
  const hooks = stopHook ? { hooks: { Stop: [{ hooks: [{ type: 'command', command: `node '${path.join(mainRoot, 'docs', 'devteam', 'scripts', 'devteam.mjs')}' stop-ok` }] }] } } : {};
  fs.writeFileSync(policy, `${JSON.stringify({ permissions: { deny: deniedFor(s.worker_denied_commands, mb).map((c) => `Bash(${c})`) }, ...hooks }, null, 2)}\n`);
  return policy;
}
// The supervisor's: only the Stop hook (stop-ok), which sends an ask of the owner that names no Inbox
// question back to be asked there. No deny rules: the worker's are not the supervisor's. Its path.
export const supervisorPolicyFile = () => path.join(runDir, 'agent', 'supervisor-claude.json');
export function supervisorPolicy() {
  const policy = supervisorPolicyFile();
  fs.mkdirSync(path.dirname(policy), { recursive: true });
  fs.writeFileSync(policy, `${JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `node '${path.join(mainRoot, 'docs', 'devteam', 'scripts', 'devteam.mjs')}' stop-ok --supervisor` }] }] } }, null, 2)}\n`);
  return policy;
}
// A Claude Code supervisor command with that policy: any other agent command as it is. Written only
// where a supervisor is started (recover, restartSupervisor); a command that is only printed (the
// by-hand line, which a read such as fleet status shows) writes nothing, and names the file only once
// a start has written it.
export const withSupervisorPolicy = (cmd, { write = true } = {}) => (/^claude(\s|$)/.test(cmd ?? '') && !/\s--settings\s/.test(` ${cmd} `) && (write || fs.existsSync(supervisorPolicyFile())) ? cmd.replace(/^claude/, `claude --settings '${write ? supervisorPolicy() : supervisorPolicyFile()}'`) : cmd);
// The agent's trust in its folder, before it starts (agent_trust_command); a dialog left up is a finding.
export function trustWorktree(wt, s, R) {
  if (s.agent_trust_command && typeof s.agent_trust_command !== 'string') warn('agent_trust_command is not a string (a shell command), so it was not run');
  else if (s.agent_trust_command?.trim()) {
    try {
      execFileSync('sh', ['-c', s.agent_trust_command], { cwd: wt, stdio: ['ignore', 2, 'inherit'], env: { ...gateEnv(null, R), DEVTEAM_WORKTREE: realPath(wt) }, timeout: 60000 });
    } catch (e) {
      warn(`agent_trust_command failed in ${wt}: ${e.code === 'ETIMEDOUT' ? 'it ran past 60 s' : e.signal ? `killed by ${e.signal}` : `exit ${e.status ?? '?'}`}; if the agent asks whether to trust its folder, the blocked-prompt finding shows it`);
    }
  }
}
// The responder's window in the fleet's session: whether the session and the window are there.
export function responderWindow(session = tmuxSession()) {
  const has = tmux(['has-session', '-t', `=${session}`]);
  const there = has && (sh('tmux', ['list-windows', '-t', `=${session}`, '-F', '#W']) ?? '').split('\n').includes(RESPONDER_NAME);
  return { session, has, there, target: `=${session}:${RESPONDER_NAME}`, shown: `${session}:${RESPONDER_NAME}` };
}
// Kill the responder's window if it is there; what was stopped (session:window), or null.
export function stopResponder() {
  const w = responderWindow();
  return w.there && tmux(['kill-window', '-t', w.target]) ? w.shown : null;
}
// Why the responder can't be started into its window now, or null: one there needs --resume, and
// --resume never types into a live agent (a shell or dead pane is relaunched in).
export function responderWindowRefusal(w) {
  if (!w.there) return null;
  if (!flags.resume) return `the responder is already running in ${w.shown} (responder --stop first, or --resume to restart it there)`;
  // a fresh look, never the few-seconds pane cache: a start just before this one may have an agent up by now
  paneTable(`=${w.session}`, { fresh: true });
  if (!resolvePane(w.target).problem) return `${w.shown} has a live agent; responder --stop first`;
  return null;
}
// A thread's turns from the log's own lines (created_by, created_at), never the view, which names
// every non-owner turn the supervisor's; oldest first.
export const logTurns = (threadId, objects = readLog().objects) => [...objects.values()].filter((o) => o.type === 'turn' && o.thread === threadId).sort(byTime);
// Whether a reply written by `by` answers the owner's turn u (the spine's Answered rule, kit-104):
// a turn routed to the supervisor only by the supervisor; one routed to the responder by the
// responder or the supervisor; one routed to a session (kit-109) by that session (routed_session) or
// the supervisor; one with no route (an older kit's) by any non-owner but a session, which answers
// only what was routed to it (contract-1 F3).
// Every "the owner said it" here is a line's writer (created_by), never its text.
export const answersTurn = (u, by) => by !== 'owner' && (by === 'supervisor' || (u.routed_to === 'session' ? by === u.routed_session : !u.routed_to ? !['ticket', 'planner'].includes(writerClass(by)) : by === u.routed_to));
// The owner's turns still owed an answer, from a thread's turns (log lines, oldest first) and the
// thread: an owner turn is answered by a turn in the thread at or after it (a tie answers) whose
// writer answers it (answersTurn), and a resolve of the thread after it leaves it owed nothing, by
// time, so a reopen with no words doesn't bring it back. One pure rule for the queue, idleness,
// threadView.waiting, thread list --waiting, thread-waiting and responder-overdue (kit-104).
export function owedIn(ts, thread) {
  const resolvedAt = (thread?.updates ?? []).filter((u) => u.status === 'resolved').map((u) => String(u.at)).sort().pop() ?? '';
  return ts.filter((u) => u.created_by === 'owner' && String(u.created_at) > resolvedAt && !ts.some((w) => w.created_at >= u.created_at && answersTurn(u, w.created_by)));
}
// The owner's turns in a thread still owed an answer (owedIn on the log's own lines).
export const owedTurns = (threadId, objects = readLog().objects) => owedIn(logTurns(threadId, objects), objects.get(threadId));
// The responder's open promise in a thread (final-1 F2, final-1b F2): its newest turn there is
// pending, no resolve of the thread came after it, and no supervisor turn after it settled it. A
// supervisor turn settles it unless it is a question, or it was written within RESPONDER_PENDING_MS
// of the promise and every owed owner turn it answered came after the supervisor's own question asked
// after the promise (its reply in that exchange answers the owner's answer, not the promise). Once the
// promise is overdue any reply settles it: the supervisor takes it, as with an owed turn (final-2b
// F1). A reply answering nothing owed takes it over too (the backstop). The owner's answer given
// outside the thread (the Inbox, or chat) to a question the supervisor asked there counts as an owner
// turn at its time, since it writes none (kit-794); one recorded from a turn is that turn. The turn,
// or null. On the log's lines, oldest first.
export function pendingOpen(ts, thread) {
  const mine = ts.filter((u) => u.created_by === 'responder').pop();
  if (mine?.pending !== true) return null;
  const resolvedAt = (thread?.updates ?? []).filter((u) => u.status === 'resolved').map((u) => String(u.at)).sort().pop() ?? '';
  if (resolvedAt > String(mine.created_at)) return null;
  const asked = ts.find((u) => u.created_by === 'supervisor' && u.question && u.created_at >= mine.created_at)?.created_at;
  const inbox = !asked ? [] : ts.filter((u) => u.created_by === 'supervisor' && u.question)
    .flatMap((u) => logGet(u.question)?.updates ?? [])
    .filter((a) => a.answer !== undefined && writerClass(a.by) === 'owner' && !a.turn)
    .map((a) => ({ created_by: 'owner', created_at: a.at }));
  for (const s of ts) {
    if (s.created_by !== 'supervisor' || s.created_at < mine.created_at || s.question) continue;
    if (Date.parse(s.created_at) - Date.parse(mine.created_at) > RESPONDER_PENDING_MS) return null;
    const answers = owedIn([...ts, ...inbox].filter((u) => u.created_at < s.created_at), thread).filter((u) => answersTurn(u, 'supervisor'));
    if (!asked || !answers.length || answers.some((u) => u.created_at < asked)) return null;
  }
  return mine;
}
// The responder's guard: since its own last turn in the thread (or ever, with none) the supervisor
// has written, and the owner has said nothing after that. A reply then would answer what the
// supervisor already answered (both backstop cases of the spine's Failure modes). Never while its
// own promise there is open (pendingOpen): the follow-up it owes is its to write. After the
// supervisor's own question (thread ask) only owner words routed to the responder lift it: the
// owner's answer to that question is the supervisor's (final-3b F2).
export function supervisorAnswered(threadId, objects = readLog().objects, writer = 'responder') {
  const ts = logTurns(threadId, objects);
  if (writer === 'responder' && pendingOpen(ts, objects.get(threadId))) return false;
  const mine = ts.filter((u) => u.created_by === writer).pop()?.created_at ?? '';
  const sup = ts.filter((u) => u.created_by === 'supervisor').pop();
  // an owner turn since, routed to this writer (kit-109: a session's by routed_session)
  const toMe = (u) => (writer === 'responder' ? u.routed_to === 'responder' : u.routed_to === 'session' && u.routed_session === writer);
  return !!sup && sup.created_at > mine && !ts.some((u) => u.created_by === 'owner' && u.created_at > sup.created_at && (!sup.question || toMe(u)));
}
// A turn's first n characters on one line, for a terminal: control characters and runs of
// whitespace as one space, … when cut.
export function turnGist(text, n = 60) {
  const flat = Array.from(String(text ?? '').replace(UNSAFE_TEXT_ALL, ' ').replace(/\s+/g, ' ').trim());
  return `${flat.slice(0, n).join('')}${flat.length > n ? '…' : ''}`;
}
// The responder's queue: owed owner turns routed to it (routed_to, written by kit-104), in open
// threads, oldest first.
export function responderQueue(objects = readLog().objects) {
  const q = [];
  for (const t of objects.values()) {
    if (t.type !== 'thread' || t.status === 'resolved') continue;
    for (const u of owedTurns(t.id, objects)) if (u.routed_to === 'responder') q.push({ turn: u.id, thread: t.id, at: u.created_at, text: String(u.text ?? '') });
  }
  return q.sort((a, b) => a.at.localeCompare(b.at));
}
// kit-104: a turn routed to the responder still owed past this is overdue (the supervisor takes it,
// and every turn after it until it is answered); so is the responder's pending turn not followed up
// (pendingOpen) past RESPONDER_PENDING_MS, which is also how long a pending turn keeps it busy.
export const RESPONDER_OVERDUE_MS = 3 * 60000;
export const RESPONDER_PENDING_MS = 10 * 60000;
// Every thread's turns from a fold's objects, oldest first, in one pass.
export function turnsByThread(objects) {
  const m = new Map();
  for (const o of objects.values()) if (o.type === 'turn' && typeof o.thread === 'string') (m.get(o.thread) ?? m.set(o.thread, []).get(o.thread)).push(o);
  for (const ts of m.values()) ts.sort(byTime);
  return m;
}
// Whether the responder can take a turn now, from tmux alone: { problem } (the fleet's session or
// its window missing, its pane exited or at a shell; session says whether the fleet's session is
// up), { stuck: line } (a blocked-prompt pattern, or a menu or dialog the kit reads, which would
// hold a typed line), or { target } (an agent, asking nothing).
export function responderHealth() {
  const w = responderWindow();
  if (!w.has) return { problem: `no tmux session "${w.session}"`, session: false };
  if (!w.there) return { problem: `no window ${w.shown}`, session: true };
  const { target, problem } = resolvePane(w.target);
  if (problem) return { problem, session: true };
  const waits = paneWaitingIn(RESPONDER_NAME);
  if (waits) return { stuck: waits.line, target, session: true };
  const asking = paneAsking(target);
  if (asking) {
    const lines = String(asking.kind === 'menu' ? asking.question ?? '' : asking.text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    return { stuck: (lines.find((l) => ENTER_CONFIRMS.test(l)) ?? lines[0] ?? `a ${asking.kind}`).slice(0, 200), target, session: true };
  }
  return { target, session: true };
}
// Idle: no owner turn routed to it and typed is still owed, and its own newest turn (any thread)
// is not a pending one under RESPONDER_PENDING_MS old. Turns queued for it never make it busy.
export function responderIdle(objects, now = Date.now(), byThread = turnsByThread(objects)) {
  for (const [id, ts] of byThread) if (owedIn(ts, objects.get(id)).some((u) => u.routed_to === 'responder' && u.delivered === 'typed')) return false;
  const mine = [...byThread.values()].flat().filter((u) => u.created_by === 'responder').sort(byTime).pop();
  return !(mine?.pending === true && now - Date.parse(mine.created_at) < RESPONDER_PENDING_MS);
}
// The responder's overdue turns, per open thread: an owner turn routed to it, still owed, older
// than RESPONDER_OVERDUE_MS; or its open promise (pendingOpen) older than RESPONDER_PENDING_MS.
// [{ thread, turn, why, min }], from the log alone (owedIn), so an answer or a resolve clears it.
export function responderOverdue(objects, now = Date.now(), byThread = turnsByThread(objects)) {
  const found = [];
  for (const [id, ts] of byThread) {
    const t = objects.get(id);
    if (t?.type !== 'thread' || t.status === 'resolved') continue;
    const late = owedIn(ts, t).find((u) => u.routed_to === 'responder' && now - Date.parse(u.created_at) > RESPONDER_OVERDUE_MS);
    if (late) { found.push({ thread: id, turn: late.id, why: 'owed', min: Math.floor((now - Date.parse(late.created_at)) / 60000) }); continue; }
    const p = pendingOpen(ts, t);
    if (p && now - Date.parse(p.created_at) > RESPONDER_PENDING_MS) found.push({ thread: id, turn: p.id, why: 'pending', min: Math.floor((now - Date.parse(p.created_at)) / 60000) });
  }
  return found;
}
// The open handoffs to the supervisor, by thread: of those not settled by a supervisor turn after
// it (settledByLanding) and named by no reply's re, the newest per thread (an older one when the
// newest was answered). Map thread -> message id.
export function openHandoffs(objects = readLog().objects) {
  const replied = handledMessages(objects);
  const m = new Map();
  for (const o of [...objects.values()].filter((x) => x.type === 'message' && x.kind === 'handoff' && x.to === 'supervisor' && typeof x.thread === 'string').sort(byTime)) {
    if (!replied.has(o.id) && !settledByLanding(o)) m.set(o.thread, o.id);
  }
  return m;
}
// The idle nudge (kit-104): when the responder's pane has an agent asking nothing, it is idle and its
// queue isn't empty, the accounts tick types this line into it, at most once a minute
// (RESPONDER_NUDGE_FILE, { at }, written after the typing: a crash between them costs one extra
// nudge, never a turn). Never into a busy responder. Named at load, so the loose-file check knows it.
export const RESPONDER_NUDGE_FILE = runPath('responder-nudge.json');
export const RESPONDER_NUDGE = '[devteam responder] a turn is waiting — devteam.mjs thread list --waiting --responder';
export const RESPONDER_NUDGE_MS = 60000;
export function nudgeResponder(now = Date.now()) {
  if (loadSettings().responder === false) return false;
  const objects = readLog().objects;
  if (!responderQueue(objects).length) return false;
  if (!responderIdle(objects, now)) return false;
  let at = 0;
  try { at = Date.parse(JSON.parse(readText(RESPONDER_NUDGE_FILE) ?? 'null')?.at) || 0; } catch {}
  // a time in the future (the clock stepped back) is no record, so it can't hold the nudge off for long
  if (at <= now && now - at < RESPONDER_NUDGE_MS) return false;
  const h = responderHealth();
  if (!h.target || h.stuck) return false;
  if (!typeInto(h.target, RESPONDER_NUDGE)) return false;
  writeJsonAtomic(RESPONDER_NUDGE_FILE, { at: new Date(now).toISOString() });
  return true;
}
// A thread's state in the supervisor's words (thread list, show): whose reply is owed, or the owner's move.
export const waitingWords = (v, overdue = false) => (v.waiting === 'supervisor' ? 'waiting on the supervisor' : v.waiting === 'responder' ? `the responder has it${overdue ? ' · overdue' : ''}` : "the owner's move");
// Whether the worktree at dir changed <slug>'s folder since it left main: a tracked change against
// its merge-base with origin's main (committed or not), or an untracked file there. A copy older than
// main's but unchanged since the worktree was cut draws nothing. 'unreadable' when git can't say
// (no merge-base, a folder that isn't its own worktree, an error): the caller fails closed on it.
export function artifactChangedIn(dir, slug, main) {
  const top = responderGit(['rev-parse', '--show-toplevel'], dir);
  if (top.status !== 0 || realPath(top.stdout.trim()) !== realPath(dir)) {
    // not its own worktree, so git can't say. A stray plain folder (no .git entry at all) holding no
    // copy of the slug can't be drawing it, and never blocks every draft (final-1 F2); one with a
    // .git git can't read may be deleting the slug, so it stays unreadable (final-2 F3)
    let stray = false;
    try { fs.lstatSync(path.join(dir, '.git')); } catch { stray = true; }
    if (stray) try { fs.lstatSync(path.join(dir, ARTIFACTS_REL, slug)); } catch { return false; }
    return 'unreadable';
  }
  const mb = responderGit(['merge-base', 'HEAD', `origin/${main}`], dir);
  const base = mb.status === 0 ? mb.stdout.trim() : '';
  if (!base) return 'unreadable';
  const folder = `${ARTIFACTS_REL}/${slug}`;
  const diff = responderGit(['diff', '--quiet', base, '--', folder], dir);
  if (diff.status === 1) return true;
  if (diff.status !== 0) return 'unreadable';
  const ls = responderGit(['ls-files', '--others', '--exclude-standard', '--', folder], dir);
  if (ls.status !== 0) return 'unreadable';
  return ls.stdout.trim() !== '';
}
// responder draft <slug> [--new --title t --summary s [--for '<json>'] [--kind k]]: the responder
// opens (or reuses) .worktrees/chore-artifact-<slug>, a chore worktree the supervisor lands with
// chore pr / merge --chore as any other. Refused, naming each one, while a ticket's, planner's or
// other session's worktree (or another machine's branch) draws the slug: the owner's change is
// relayed there. Every git call of its own goes through responderGit/responderOrigin, so nothing
// another session planted (a hook, an fsmonitor, a replace ref) runs as the responder.
export function responderDraft() {
  const slug = positional[1];
  const role = process.env.DEVTEAM_ROLE;
  // DEVTEAM_TICKET or DEVTEAM_FEATURE set at all, blank included, is a worker's or planner's session, as ownerWriter reads it (final-1 F3, final-2 F2)
  if (flags.owner || process.env.DEVTEAM_CHANNEL || process.env.DEVTEAM_TICKET !== undefined || process.env.DEVTEAM_FEATURE !== undefined || logWriter() !== 'responder' || ![undefined, '', 'responder'].includes(role)) die("responder draft: the responder's command; the supervisor opens a draft with chore start artifact-<slug>");
  const usage = 'usage: responder draft <slug> [--new --title "…" --summary "…" [--for \'["goal:g"]\'] [--kind mock|diagram|docs]]';
  if (!slug || !LINK_ID.test(slug) || positional.length > 2) die(usage);
  const title = flagStr('title'), summary = flagStr('summary');
  if (flags.new && (!title || !summary)) die('--new needs --title and --summary');
  const main = loadSettings().main_branch;
  const name = `chore-artifact-${slug}`;
  const wt = path.join(mainRoot, '.worktrees', name);
  const touch = () => { const now = new Date(); try { fs.utimesSync(wt, now, now); } catch {} };
  // a draft already there is the responder's own: used, whoever else draws the slug
  let there = null;
  try { there = fs.lstatSync(wt); } catch {}
  if (there) {
    // a link planted at the draft's path (to a ticket's worktree, say) is never taken as the draft,
    // and no git runs there: only the folder itself, at .worktrees/<name> (final-1 F1)
    const notHere = () => die(`.worktrees/${name} is not a git worktree: move it aside, then responder draft ${slug} again`);
    if (there.isSymbolicLink() || realPath(wt) !== path.join(realPath(path.join(mainRoot, '.worktrees')), name)) notHere();
    const top = responderGit(['rev-parse', '--show-toplevel'], wt);
    if (top.status !== 0 || realPath(top.stdout.trim()) !== realPath(wt)) notHere();
    if (flags.new) die(`.worktrees/${name} is already there: responder draft ${slug} edits it`);
    const st = responderGit(['status', '--porcelain'], wt);
    if (st.status !== 0) die(`.worktrees/${name}: git status failed: ${(st.stderr || '').trim()}`);
    if (st.stdout.trim()) { touch(); return out(realPath(wt)); }
    const fetched = responderOrigin(['fetch', '--quiet', 'origin', main]);
    if (fetched.status !== 0) die(`responder draft: fetching origin's ${main} failed: ${(fetched.stderr || '').trim() || `exit ${fetched.status}`}`);
    const head = responderGit(['rev-parse', 'HEAD'], wt).stdout?.trim();
    const onMain = responderGit(['merge-base', '--is-ancestor', 'HEAD', `origin/${main}`], wt).status === 0;
    // landed (merged, squashed, or never committed to): start again from main as it is now; a
    // pushed chore commit not yet merged is kept
    if (onMain || (head && mergedAtSha(name, head))) choreWorktree(`artifact-${slug}`, { responder: true, reset: true });
    else touch();
    return out(realPath(wt));
  }
  // a session drawing the slug: every worktree that changed its folder since it left main, and every
  // other machine's branch that did (a local row hides those in remote_branches)
  const known = tickets();
  const found = new Map();
  const relay = (who) => `relay the owner's change with send ${who} "…" (thread <t-id>)`;
  const handOver = 'hand it over: send supervisor "…" --kind handoff --thread <t-id>';
  let names = [];
  try { names = fs.readdirSync(path.join(mainRoot, '.worktrees')); } catch {}
  for (const w of names) {
    if (w === name) continue;
    const dir = draftWorktree(w);
    if (!dir) continue;
    const changed = artifactChangedIn(dir, slug, main);
    if (!changed) continue;
    const where = `.worktrees/${w}`;
    if (changed === 'unreadable') { found.set(w, `${where} can't be read, so it may be drawing ${slug} (${w}); ${handOver}`); continue; }
    const rec = /^records-(.+)$/.exec(w);
    const session = known.has(w) || /^plan-./.test(w) ? w : rec && known.has(rec[1]) ? rec[1] : null;
    found.set(w, session ? `${slug} is being drawn in ${where} (${session}); ${relay(session)}` : `${slug} is being drawn in ${where} (${w}); ${handOver}`);
  }
  const branches = new Set();
  for (const a of draftArtifacts().filter((d) => d.slug === slug)) {
    if (String(a.at).startsWith('origin:')) branches.add(a.branch ?? String(a.at).slice('origin:'.length));
    for (const b of a.remote_branches ?? []) branches.add(b);
  }
  for (const b of branches) {
    const t = /^ticket\/(.+)$/.exec(b), p = /^plan\/(.+)$/.exec(b);
    const session = t && known.has(t[1]) ? t[1] : p ? `plan-${p[1]}` : null;
    const where = `branch ${b} on origin`;
    // keyed by the branch's own name, so it sorts among the worktrees by name
    found.set(`${b}\0branch`, session ? `${slug} is being drawn in ${where} (${session}); ${relay(session)}` : `${slug} is being drawn in ${where} (${b}); ${handOver}`);
  }
  if (found.size) die(`responder draft ${slug}: refused, nothing made:\n${[...found.keys()].sort().map((k) => `  ${found.get(k)}`).join('\n')}`);
  const landed = landedArtifacts().some((a) => a.slug === slug);
  if (!flags.new && !landed) die(`no artifact ${slug} on main; to start one: responder draft ${slug} --new --title "…" --summary "…"`);
  if (flags.new && landed) die(`${slug} is on main; responder draft ${slug} edits it`);
  // make it; a failed artifact new takes back only what this run made
  const had = responderGit(['rev-parse', '--verify', '-q', `refs/heads/${name}`]);
  const was = had.status === 0 ? had.stdout.trim() : null;
  choreWorktree(`artifact-${slug}`, { responder: true });
  if (flags.new) {
    const args = ['artifact', 'new', slug, '--title', title, '--summary', summary];
    if (flagStr('for') !== undefined) args.push('--for', flagStr('for'));
    if (flags.kind !== undefined) args.push('--kind', flagStr('kind') ?? '');
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { cwd: wt, env: { ...process.env, DEVTEAM_ROLE: 'responder' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.status !== 0 || r.error) {
      responderGit(['worktree', 'remove', '--force', wt]);
      if (was) responderGit(['branch', '-f', name, was]);
      else responderGit(['branch', '-D', name]);
      die(`responder draft ${slug}: artifact new failed (${r.error?.message ?? `exit ${r.status}`}); the draft was taken back`);
    }
  }
  out(realPath(wt));
}
// Its help lines, in Setup and roles (HELP_SETUP reads them; this region sits above HELP).
export const RESPONDER_HELP = `  responder [--resume | --stop]   supervisor: the thread responder, a quick session that answers the owner's thread turns (window responder, .worktrees/responder at main, the owner's responder_command); --stop ends it, --resume restarts it in its window
  responder draft <slug> [--new --title t --summary s]   the responder: open (or reuse) .worktrees/chore-artifact-<slug> to edit a landed artifact, or start one there with --new; refused, naming the session, while a ticket or planner draws it
  prompt responder   the responder's prompt: its section of supervisor.md (§13)`;
// responder [--resume | --stop]: the supervisor starts, restarts or stops the responder.
export function cmdResponder() {
  if (positional[0] === 'draft') return responderDraft();
  // every channel is one of the owner's surfaces (the dashboard, the hub, the owner's terminal)
  if (flags.owner || process.env.DEVTEAM_CHANNEL) die('responder: the supervisor starts the responder (settings.responder turns it off)');
  supervisorOnly('responder');
  if (repoRoot !== mainRoot) die(`run this from the main checkout (${mainRoot})`);
  if (!sh('tmux', ['-V'])) die('tmux not found');
  // a stop always works: nothing else is checked
  if (flags.stop) { const at = stopResponder(); return out(at ? `stopped the responder (${at})` : 'no responder is running'); }
  const s = loadSettings();
  if (s.responder === false) die("settings.responder is off: the owner's thread turns go to the supervisor; set it true to start the responder");
  // a fleet park stops it (fleetOp) and keeps it stopped; a drain, or a goal's own hold, doesn't
  if (draining() || fleetMode() === 'park') die('the fleet is parked: the responder starts again after fleet unpark');
  const session = tmuxSession({ save: true });
  const early = responderWindowRefusal(responderWindow(session));
  if (early) die(early);
  const mem = memoryFull(s);
  if (mem && !flags.resume) die(`${mem.words}: start the responder when some sessions finish, or responder --resume`);
  // the owner's settings as origin's main has them: unset or blank responder_command means agent_command
  const { sha, settings: owned } = responderMain(s);
  const rc = owned.responder_command;
  let cmd = typeof rc === 'string' && rc.trim() ? rc : owned.agent_command;
  // its worktree, detached at that commit, moved there at each start. One that isn't its own is
  // refused before any git runs in it, and so is any local change (a refresh would keep what git
  // doesn't have to overwrite); ignored files, which git would keep too, are removed (final-1 F3).
  const R = repo('home');
  const mb = owned.main_branch;
  const wt = path.join(mainRoot, '.worktrees', RESPONDER_NAME);
  let found = null;
  try { found = fs.lstatSync(wt); } catch {}
  if (!found) {
    // removed by hand: git's record of it goes first (final-1b F4)
    responderGit(['worktree', 'prune']);
    const add = pastHalfMade(() => { const r = responderGit(['worktree', 'add', '--quiet', '--detach', wt, sha]); return { ...r, ok: r.status === 0, err: r.stderr }; }, { common: commonDir, wt });
    if (add.status !== 0) die(`${wt}: could not add it at ${sha.slice(0, 8)}: ${String(add.stderr ?? '').trim() || `exit ${add.status}`}${add.note}`);
  } else {
    const bad = responderWorktreeProblem(wt);
    if (bad) die(bad);
    const planted = responderPlanted(wt, sha);
    if (planted) die(planted);
    const dirty = responderDirty(wt, owned.worktree_files);
    if (dirty === null) die(`${wt}: git status failed there, so the responder's worktree is left as it is`);
    const changed = (hits) => die(`${wt} has local changes (${plural(hits.length, 'path')}, first ${hits[0]}): the responder starts from main, so clear them or remove the worktree, then responder again`);
    if (dirty.length) changed(dirty);
    const clean = responderGit(['clean', '-ffdXq'], wt);
    if (clean.status !== 0) die(`${wt}: could not clear its ignored files: ${String(clean.stderr ?? '').trim() || `exit ${clean.status}`}`);
    const r = responderGit(['checkout', '--quiet', '--detach', sha], wt);
    if (r.status !== 0) die(`${wt}: could not move it to ${sha.slice(0, 8)}: ${String(r.stderr ?? '').trim() || `exit ${r.status}`}`);
    const differs = responderDiffers(wt, sha);
    if (differs === null) die(`${wt}: could not compare it with ${sha.slice(0, 8)}, so the responder's worktree is left as it is`);
    if (differs.length) changed(differs);
    // again, with every git call behind it: a nested repo put at a gitlink after the first look,
    // which the flagged status and compare never enter (final-4 F3)
    const after = responderPlanted(wt, sha);
    if (after) die(after);
  }
  responderSeed(wt, owned.worktree_files, R);
  trustWorktree(wt, owned, R);
  fs.mkdirSync(path.join(runDir, 'prompts'), { recursive: true });
  const promptFile = path.join(runDir, 'prompts', `${RESPONDER_NAME}.txt`);
  fs.writeFileSync(promptFile, `${promptFor(RESPONDER_NAME)}\n`);
  class Refused extends Error {}
  const refuse = (m) => { throw new Refused(m); };
  try {
    // the look at the window and the typing under one lock, so two starts at once can't both type
    withLock(path.join(runDir, `launch-${RESPONDER_NAME}`), () => {
      let w = responderWindow(session);
      const late = responderWindowRefusal(w);
      if (late) refuse(late);
      // a window left there (a shell, or a pane that has exited) is opened anew, so the agent always
      // starts in the worktree, never in whatever folder that shell was in (final-1b F1)
      const again = w.there;
      if (w.there) { tmux(['kill-window', '-t', w.target]); w = responderWindow(session); if (w.there) refuse(`could not close ${w.shown}; close it, then responder`); }
      if (!w.has) { if (sh('tmux', ['new-session', '-d', '-s', session, '-n', RESPONDER_NAME, '-c', wt], { env: tmuxServerEnv() }) === null) refuse('could not start tmux'); }
      else if (!w.there && !tmux(['new-window', '-d', '-t', `=${session}`, '-n', RESPONDER_NAME, '-c', wt])) refuse(`could not open ${w.shown}`);
      const type = (line) => { if (!typeNow(w.target, line)) refuse(`could not type into ${w.shown}; responder --resume starts it`); };
      type(`export DEVTEAM_HOME=${shq(mainRoot)} DEVTEAM_RUN=${shq(runDir)} DEVTEAM_ROLE='responder'`);
      if (/^claude(\s|$)/.test(cmd)) cmd = cmd.replace(/^claude/, `claude --settings '${claudePolicy(RESPONDER_NAME, owned, mb)}'`);
      // a ticket or feature from the tmux server's environment is never the responder's: env -u, which works in any shell
      type(`env -u DEVTEAM_TICKET -u DEVTEAM_FEATURE ${sessionMarkerPrefix(session)}${cmd} ${shq(promptPointer(promptFile))}`);
      out(`${again ? 'restarted' : 'started'} the responder in ${w.shown} at ${wt}`);
    });
  } catch (e) {
    if (e instanceof Refused) die(e.message);
    throw e;
  }
}
/* responder-session end */
/* sessionBinding start */
// kit-109: threads bound to a session. A thread's subject binds it to one ticket or planner writer
// (boundWriter): that writer may reply and hand over there, and while it is live and not overdue the
// owner's turns there are routed to it and typed into its pane alone (sessionRoute, rule 2 of
// responderRoute). Static: the subject and the log, never tmux or a worktree.
export const SESSION_OVERDUE_MS = 5 * 60000;
export const SESSION_PENDING_MS = 10 * 60000;
export const PLAN_WRITER = /^plan-[a-z0-9]+(-[a-z0-9]+)*$/;
// The ticket or planner a subject binds to, or null: a ticket item that names a ticket in the log; a
// planner item (its feature); an artifact drawn in a ticket's or planner's worktree (never a chore-*
// one, main or a tree); a preview its current record says that session offered.
export function boundWriter(subject, objects = readLog().objects) {
  if (!isObj(subject)) return null;
  const ticket = (id) => typeof id === 'string' && objects.get(id)?.type === 'ticket' && writerClass(id) === 'ticket';
  const session = (w) => (ticket(w) || (typeof w === 'string' && PLAN_WRITER.test(w)) ? w : null);
  if (subject.kind === 'item' && typeof subject.ref === 'string') {
    const i = subject.ref.indexOf(':');
    const [k, id] = [subject.ref.slice(0, i), subject.ref.slice(i + 1)];
    if (k === 'ticket') return ticket(id) ? id : null;
    if (k === 'planner') return session(`plan-${id}`);
    return null;
  }
  if (subject.kind === 'artifact') return typeof subject.at === 'string' && !subject.at.startsWith('chore-') ? session(subject.at) : null;
  if (subject.kind === 'preview') return session(readPreviews().find((r) => r.name === subject.name)?.session ?? null);
  return null;
}
// null when w is a live session, else why not: a ticket at work (not parked, done or merged) or a
// planner in flight and not parked, whose window in the fleet's session runs an agent (not gone,
// dead or a shell)
export function sessionLive(w) {
  const cls = writerClass(w);
  if (cls === 'ticket') { if (!activeWorker(w)) return `${w} isn't at work (parked, done or merged)`; }
  else if (cls === 'planner') {
    const p = planners().find((x) => x?.feature === w.slice('plan-'.length));
    if (!p) return `${w} isn't planning`;
    if (p.parked) return `${w} is parked`;
  } else return 'not a session';
  return resolvePane(tmuxTarget(w)).problem ?? null;
}
// Every session's overdue turns, by writer (spec item 6), in open threads only and whether or not the
// session is live: an owner turn routed to it still owed (owedIn: answered by it or the supervisor)
// past SESSION_OVERDUE_MS; or its newest turn in a thread, pending and the thread's last, past
// SESSION_PENDING_MS. From the log alone, so an answer or a resolve clears it. Map w -> [{ thread,
// turn, why, min }].
export function sessionsOverdue(objects = readLog().objects, now = Date.now(), byThread = turnsByThread(objects)) {
  const m = new Map();
  const add = (w, o) => (m.get(w) ?? m.set(w, []).get(w)).push(o);
  for (const [id, ts] of byThread) {
    const t = objects.get(id);
    if (t?.type !== 'thread' || t.status === 'resolved') continue;
    for (const u of owedIn(ts, t)) {
      const age = now - Date.parse(u.created_at);
      if (u.routed_to === 'session' && typeof u.routed_session === 'string' && age > SESSION_OVERDUE_MS) add(u.routed_session, { thread: id, turn: u.id, why: 'owed', min: Math.floor(age / 60000) });
    }
    const last = ts[ts.length - 1];
    const age = last ? now - Date.parse(last.created_at) : 0;
    if (last?.pending === true && ['ticket', 'planner'].includes(writerClass(last.created_by)) && age > SESSION_PENDING_MS) add(last.created_by, { thread: id, turn: last.id, why: 'pending', min: Math.floor(age / 60000) });
  }
  return m;
}
// The turns that make w overdue: while there are any, sessionRoute skips w
export function sessionOverdue(w, objects = readLog().objects, now = Date.now()) {
  return sessionsOverdue(objects, now).get(w) ?? [];
}
// The session the owner's next turn in t goes to, or null: the setting on (anything but false), a
// subject that binds (an artifact never routes: its notes are handed over, kit-144), the session live
// and nothing of its overdue
export function sessionRoute(t, objects = readLog().objects, s = loadSettings(), now = Date.now()) {
  if (s.session_threads === false || !isObj(t.subject) || t.subject.kind === 'artifact') return null;
  const w = boundWriter(t.subject, objects);
  if (!w || sessionLive(w) !== null || sessionOverdue(w, objects, now).length) return null;
  return w;
}
// w in the owner's words: the agent on its ticket's title, or the planner for its feature
// One line of plain text wherever it prints (thread show's headers, --waiting, session-overdue): a
// title is a planner's words, so a line break or an escape in it never starts a line of its own.
export function sessionWords(w, objects = readLog().objects) {
  if (writerClass(w) === 'planner') return `the planner for ${w.slice('plan-'.length)}`;
  const raw = objects.get(w)?.title;
  const title = typeof raw === 'string' ? raw.replace(UNSAFE_TEXT_ALL, ' ').replace(/\s+/g, ' ').trim() : '';
  return `the agent on ${title || w}`;
}
/* sessionBinding end */
// Who owes the reply to the owner's next turn in thread t (kit-104; the spine's routing rules 1, 3
// and 4), worked out once, before the turn is written, and stored on it (routed_to, and delivered
// for the responder); nothing recomputes it. t may be a thread not yet written ({ subject }).
// { to: 'supervisor' } or { to: 'responder', delivered: 'typed' | 'queued', target }, or no `to` on an
// artifact note (its owner hands it over); why says why
// the supervisor's. A subject naming a record not in the log takes the ordinary rules. Every "the
// owner said it" here is a line's writer, never its text.
export function responderRoute(t, objects = readLog().objects, s = loadSettings(), now = Date.now()) {
  // an artifact note's turns wait for Hand over: no route is written, and nobody owes a reply
  if (isObj(t.subject) && t.subject.kind === 'artifact') return { why: 'an artifact note' };
  const ownerCorrected = (r) => (r.updates ?? []).some((u) => u.corrected !== undefined && writerClass(u.by) === 'owner');
  // 1: its own open question asked in the thread, or a subject still the supervisor's
  if (t.id && [...objects.values()].some((o) => o.type === 'question' && o.thread === t.id && threadQuestion(o).status === 'open')) return { to: 'supervisor', why: 'its open question' };
  const ref = isObj(t.subject) && t.subject.kind === 'item' && typeof t.subject.ref === 'string' ? t.subject.ref : '';
  const rec = ref.includes(':') ? objects.get(ref.slice(ref.indexOf(':') + 1)) : null;
  const kind = ref.slice(0, ref.indexOf(':'));
  if (rec && rec.type === kind) {
    if (kind === 'question' && threadQuestion(rec).status === 'open') return { to: 'supervisor', why: 'an open question' };
    if (kind === 'decision' && !ownerCorrected(rec)) return { to: 'supervisor', why: 'an uncorrected decision' };
    // the owner's own acts can't be corrected, so their threads take the ordinary rules; an act that
    // carried out a decision follows that decision (F8-4)
    if (kind === 'act' && rec.created_by !== 'owner') {
      const d = typeof rec.decision === 'string' ? objects.get(rec.decision) : null;
      if (!ownerCorrected(d?.type === 'decision' ? d : rec)) return { to: 'supervisor', why: 'an uncorrected act' };
    }
  }
  // kit-109: a thread about a live session's work is that session's (the spine's rule 2), after the
  // supervisor's own and before the responder's
  const w = sessionRoute(t, objects, s, now);
  if (w) return { to: 'session', session: w };
  // 2: the responder can't take it
  if (s.responder === false) return { to: 'supervisor', why: 'the responder is off' };
  const h = responderHealth();
  if (h.problem) return { to: 'supervisor', why: h.problem };
  if (h.stuck) return { to: 'supervisor', why: `the responder is stuck: ${h.stuck}` };
  const byThread = turnsByThread(objects);
  if (responderOverdue(objects, now, byThread).length) return { to: 'supervisor', why: 'a responder turn is overdue' };
  // 3: the responder's, typed when idle
  return { to: 'responder', delivered: responderIdle(objects, now, byThread) ? 'typed' : 'queued', target: h.target };
}

