/* imports start */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HUB_PORT } from './orient.mjs';
import { ID_BLOCK_DEFAULT } from './sessions.mjs';
import { IF_GONE_LEFT } from './accounts.mjs';
import { KNOWLEDGE_IDS_MAX } from './log.mjs';
import { LINKS_LOCAL } from './settings.mjs';
import { LINK_KINDS } from './links.mjs';
import { REPO_OWN_DEFAULTS } from './links.mjs';
import { RESPONDER_GIT } from './responder.mjs';
import { RUN_KNOWN } from './settings.mjs';
import { SETTLED_MS } from './accounts.mjs';
import { TMUX_TIMEOUT_MS } from './base.mjs';
import { accountsState } from './hub/health-pool.mjs';
import { ancestorOf } from './base.mjs';
import { appendLog } from './log-sync.mjs';
import { artifactsBlock } from './observe.mjs';
import { byTime } from './log-sync.mjs';
import { causeOf } from './holds.mjs';
import { citing } from './questions.mjs';
import { claudePolicy } from './responder.mjs';
import { commonDir } from './state.mjs';
import { coverageGap } from './reviews.mjs';
import { coverageGapInfo } from './reviews.mjs';
import { currentTicketId } from './log.mjs';
import { cwdGit } from './base.mjs';
import { cwdGitOrDie } from './base.mjs';
import { die } from './base.mjs';
import { ensureRecordsWorktree } from './sessions.mjs';
import { factsRepo } from './repos.mjs';
import { fetchLinkMain } from './log-sync.mjs';
import { fileURLToPath } from 'node:url';
import { firstLine } from './reviews.mjs';
import { flagNum } from './base.mjs';
import { flagStr } from './base.mjs';
import { flags } from './base.mjs';
import { fleetHost } from './host.mjs';
import { fleetMode } from './holds.mjs';
import { fleetOpInForce } from './holds.mjs';
import { git } from './base.mjs';
import { gitOrDie } from './base.mjs';
import { gitRun } from './reviews.mjs';
import { goalMode } from './holds.mjs';
import { here } from './state.mjs';
import { holdWords } from './holds.mjs';
import { holdableGoals } from './holds.mjs';
import { hostCheck } from './host.mjs';
import { hostHolder } from './host.mjs';
import { hostNet } from './host.mjs';
import { idBlockFor } from './sessions.mjs';
import { idBlockText } from './sessions.mjs';
import { inFlightPlanTickets } from './sessions.mjs';
import { isPlanFile } from './log.mjs';
import { isUpkeep } from './holds.mjs';
import { json } from './base.mjs';
import { knowledgeBlock } from './observe.mjs';
import { knowledgeFor } from './observe.mjs';
import { lastLaunches } from './accounts.mjs';
import { linkLocation } from './links.mjs';
import { linksBlock } from './observe.mjs';
import { liveLogDir } from './log.mjs';
import { liveSessions } from './holds.mjs';
import { loadSettings } from './settings.mjs';
import { logCache } from './log-sync.mjs';
import { logGet } from './log-sync.mjs';
import { logObjects } from './log-sync.mjs';
import { mainLog } from './repos.mjs';
import { mainRef } from './log.mjs';
import { mainRefCache } from './log.mjs';
import { mainRoot } from './state.mjs';
import { memoryFull } from './hub/operator.mjs';
import { mergeShaFor } from './repos.mjs';
import { modeOf } from './holds.mjs';
import { movingFleet } from './holds.mjs';
import { newFleetId } from './holds.mjs';
import { newer } from './box-pins.mjs';
import { nowIso } from './base.mjs';
import { nudgeSupervisor } from './sessions.mjs';
import { out } from './base.mjs';
import { ownEntry } from './artifact-notes.mjs';
import { ownerWriter } from './log.mjs';
import { padNN } from './sessions.mjs';
import { paneStoppedAtLimit } from './accounts.mjs';
import { parseSink } from './secrets.mjs';
import { pastHalfMade } from './check-ticket.mjs';
import { pinsHint } from './check-ticket.mjs';
import { plannerLaunchGoals } from './holds.mjs';
import { planners } from './panes.mjs';
import { positional } from './base.mjs';
import { previewsBlock } from './previews.mjs';
import { projectInRepo } from './settings.mjs';
import { projectRel } from './settings.mjs';
import { promptFor } from './sessions.mjs';
import { promptPointer } from './sessions.mjs';
import { questionView } from './log-sync.mjs';
import { questions } from './log-sync.mjs';
import { reReserved } from './lens.mjs';
import { readJson } from './base.mjs';
import { readLog } from './log-sync.mjs';
import { readText } from './base.mjs';
import { realOrSelf } from './spend.mjs';
import { realPath } from './state.mjs';
import { recordsInHomeId } from './repos.mjs';
import { recordsParkProblems } from './holds.mjs';
import { recurringLock } from './chores.mjs';
import { redactUrl } from './links.mjs';
import { removeWorkerWorktree } from './sessions.mjs';
import { replacePaneProcess } from './accounts.mjs';
import { repo } from './repos.mjs';
import { repoOfTicket } from './repos.mjs';
import { repoOfTicketLink } from './repos.mjs';
import { repoReadable } from './repos.mjs';
import { repoRoot } from './state.mjs';
import { reserveIdBlock } from './sessions.mjs';
import { resolveCommit } from './log-sync.mjs';
import { resolvePane } from './sessions.mjs';
import { responderGit } from './responder.mjs';
import { restartCommands } from './holds.mjs';
import { restartTimes } from './accounts.mjs';
import { reviewResultRel } from './lens.mjs';
import { runDir } from './state.mjs';
import { runPath } from './settings.mjs';
import { seedWorktree } from './check-ticket.mjs';
import { sendParkRulings } from './holds.mjs';
import { sessionGoals } from './holds.mjs';
import { sessionMarkerPrefix } from './sessions.mjs';
import { sessionMode } from './holds.mjs';
import { sh } from './base.mjs';
import { sha256 } from './lens.mjs';
import { shq } from './scores.mjs';
import { slug } from './base.mjs';
import { spawnSync } from 'node:child_process';
import { spendItems } from './spend.mjs';
import { stopPreviewsOf } from './previews.mjs';
import { stopResponder } from './responder.mjs';
import { stoppedLaunch } from './graph.mjs';
import { supervisorOnly } from './log.mjs';
import { supervisorRecovery } from './accounts.mjs';
import { supervisorSessionId } from './accounts.mjs';
import { sweepDeadTempWorktrees } from './pr-checks.mjs';
import { ticketMode } from './holds.mjs';
import { tickets } from './graph.mjs';
import { tmux } from './sessions.mjs';
import { tmuxServerEnv } from './sessions.mjs';
import { tmuxSession } from './base.mjs';
import { trustWorktree } from './responder.mjs';
import { typeNow } from './sessions.mjs';
import { warn } from './base.mjs';
import { withLock } from './log.mjs';
import { withScratch } from './secrets.mjs';
import { within } from './recover.mjs';
import { workLines } from './goals.mjs';
import { worktreeRepo } from './pr-checks.mjs';
import { writeHold } from './holds.mjs';
import { writeJson } from './base.mjs';
import { writerClass } from './log.mjs';
import { writerOfFile } from './log.mjs';
/* imports end */
// The tick's tidy (observe-metrics, at most every 30 minutes): a worktree under home's .worktrees
// whose work is finished goes, so finished checkouts don't fill the disk. Finished: a ticket's once
// it is merged and its worker logged phase done; a chore's once chore-<slug> is in main (or merged
// at exactly its head); a planner's once its plan landed on main; a reviewer's (detached) once it
// is an hour old or its ticket merged. And only when nothing could be lost or disturbed: no tmux
// pane and no process in it, nothing uncommitted (git's own remove refuses that again), its head on
// origin or main (or merged at exactly that sha), no harness worktrees inside it, and quiet for a
// while (no commit, checkout or launch). A locked worktree, the main checkout, a repo's own root
// and anything git doesn't list as a worktree of its repo directly under .worktrees are never
// touched. The branch stays, so a session started again makes the worktree anew. Reads only what
// is here (the tick fetched already), and each removal is a worker-slots act naming why.
export const TIDY_FILE = runPath('worktree-tidy.json');
export const TIDY_EVERY_MS = 30 * 60000;
export const REVIEW_TIDY_MS = 60 * 60000;
export const tidyQuietMs = () => { const v = Number(process.env.DEVTEAM_WORKTREE_QUIET_MS); return Number.isFinite(v) && v >= 0 ? v : 15 * 60000; };
// Every directory a tmux pane started in or is in now, and every process's working directory, all
// resolved; null when it can't be said (tmux or the process table didn't answer), and then nothing goes.
export function busyDirs({ processes = true } = {}) {
  const dirs = new Set();
  const add = (p) => { if (p && p.startsWith('/')) { dirs.add(p); dirs.add(realPath(p)); } };
  const t = spawnSync('tmux', ['list-panes', '-a', '-F', '#{pane_start_path}\t#{pane_current_path}'], { encoding: 'utf8', timeout: TMUX_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] });
  if (t.error?.code !== 'ENOENT') {
    if (t.status === 0) for (const l of t.stdout.split('\n')) l.split('\t').forEach(add);
    else if (!/no server running|no sessions|error connecting|no such file/i.test(t.stderr ?? '')) return null;
  }
  if (!processes) return dirs;
  if (process.platform === 'linux' && fs.existsSync('/proc/self/cwd')) {
    for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) { try { add(fs.readlinkSync(`/proc/${pid}/cwd`)); } catch {} }
  } else {
    const l = spawnSync('lsof', ['-w', '-n', '-P', '-d', 'cwd', '-Fn'], { encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    const rows = (l.stdout ?? '').split('\n').filter((x) => x.startsWith('n/'));
    if (l.error || !rows.length) return null;
    rows.forEach((x) => add(x.slice(1)));
  }
  return dirs;
}
// git's list of a repo's worktrees, each { path (resolved), head, branch, detached, locked }.
export function worktreeRecords(R) {
  const recs = [];
  for (const block of (R.git(['worktree', 'list', '--porcelain'], R.root) ?? '').split('\n\n')) {
    const lines = block.split('\n');
    const at = lines.find((l) => l.startsWith('worktree '))?.slice(9);
    if (!at) continue;
    const field = (k) => lines.find((l) => l === k || l.startsWith(`${k} `));
    recs.push({ path: realPath(at), head: field('HEAD')?.slice(5) ?? null, branch: field('branch')?.slice(7) ?? null, detached: !!field('detached'), locked: !!field('locked') });
  }
  return recs;
}
// Was this exact commit merged (merge's act names the sha it verified and landed)?
export const mergedAtSha = (branch, sha) => logObjects('act').some((a) => String(a.what ?? '').startsWith(`merged ${branch} at ${sha}`));
// Why this worktree's work is finished, or null while it isn't (or isn't a kind the tidy knows).
export function tidyFinished(name, rec, R, gitdir) {
  const main = R.mainRef();
  const inMain = (sha) => !!main && ancestorOf(sha, main, R.root) === true;
  if (tickets().has(name)) {
    if (rec.detached || rec.branch !== `refs/heads/ticket/${name}` || factsRepo(name)?.name !== R.name) return null;
    return mergeShaFor(name) && lastPhaseOf(name)?.to === 'done' ? `ticket ${name} is merged and its worker logged phase done` : null;
  }
  if (name.startsWith('records-') && tickets().has(name.slice('records-'.length))) {
    const tid = name.slice('records-'.length);
    if (R.name !== 'home' || rec.detached || rec.branch !== `refs/heads/ticket/${tid}` || !recordsInHomeId(tid)) return null;
    return mergeShaFor(tid) && lastPhaseOf(tid)?.to === 'done' ? `ticket ${tid} is merged and its worker logged phase done` : null;
  }
  if (name.startsWith('chore-')) {
    if (R.name !== 'home' || rec.detached || rec.branch !== `refs/heads/${name}`) return null;
    // not one just started (or reset) at main's tip, with nothing of its own yet: the supervisor may be about to write in it
    if (mainLog().some((c) => c.sha === rec.head)) return null;
    return inMain(rec.head) ? `${name} is merged into main` : mergedAtSha(name, rec.head) ? `${name} was merged at its head` : null;
  }
  if (name.startsWith('plan-')) {
    const feature = name.slice('plan-'.length);
    if (R.name !== 'home' || rec.detached || rec.branch !== `refs/heads/plan/${feature}`) return null;
    // landed as planners() reads it: its plan file on main, or its branch merged in (not a fresh
    // planner's branch, which sits on main's own first-parent line)
    if (main && git(['cat-file', '-e', `${main}:${projectRel}/log/${name}.jsonl`]) !== null) return `the plan for ${feature} landed on main`;
    if (inMain(rec.head) && !mainLog().some((c) => c.sha === rec.head)) return `plan/${feature} is merged into main`;
    return mergedAtSha(`plan/${feature}`, rec.head) ? `plan/${feature} was merged at its head` : null;
  }
  if (name.startsWith('review-') && rec.detached) {
    const short = /^review-(.+?-\d+)-[0-9a-f]{8}(-|$)/.exec(name)?.[1] ?? /^review-(.+)-[0-9a-f]{12}$/.exec(name)?.[1];
    const ids = short ? [...tickets().keys()].filter((id) => id === short || id.startsWith(`${short}-`)) : [];
    if (ids.length === 1 && mergeShaFor(ids[0])) return `its ticket ${ids[0]} is merged`;
    // made when git wrote its admin folder's commondir, which nothing rewrites
    const made = fs.statSync(path.join(gitdir, 'commondir'), { throwIfNoEntry: false })?.mtimeMs;
    return made && Date.now() - made > REVIEW_TIDY_MS ? 'a final review\'s checkout over an hour old' : null;
  }
  return null;
}
export function tidyFinishedWorktrees() {
  if (!commonDir || !fs.existsSync(path.join(mainRoot, '.worktrees'))) return [];
  // at most once every 30 minutes, and one tidy at a time: the next is due from when this one began
  const due = withLock(TIDY_FILE, () => {
    let last = NaN;
    try { last = Date.parse(readJson(TIDY_FILE).at); } catch {}
    if (Number.isFinite(last) && last <= Date.now() && Date.now() - last < TIDY_EVERY_MS) return false;
    writeJson(TIDY_FILE, { at: nowIso() });
    return true;
  });
  if (!due) return [];
  sweepDeadTempWorktrees(repo('home'));
  const root = realPath(path.join(mainRoot, '.worktrees'));
  // asked once, and only when some worktree is otherwise finished; not knowing keeps every one
  let busy;
  const within = (dirs, wt) => !dirs || [...dirs].some((d) => d === wt || d.startsWith(`${wt}${path.sep}`));
  const inUse = (wt) => { if (busy === undefined) busy = busyDirs(); return within(busy, wt); };
  const windowNames = () => new Set((sh('tmux', ['list-windows', '-t', `=${tmuxSession()}`, '-F', '#W']) ?? '').split('\n').filter(Boolean));
  const launches = lastLaunches();
  const records = new Map();
  const removed = [];
  for (const name of fs.readdirSync(root).sort()) {
    if (name.startsWith('tmp-')) continue; // the temp sweep's
    const wt = path.join(root, name);
    const st = fs.lstatSync(wt, { throwIfNoEntry: false });
    if (!st?.isDirectory() || st.isSymbolicLink()) continue;
    const R = worktreeRepo(wt);
    if (!R || [realPath(R.root), realPath(mainRoot)].includes(wt)) continue;
    if (!records.has(R.name)) records.set(R.name, worktreeRecords(R));
    const rec = records.get(R.name).find((r) => r.path === wt);
    if (!rec || rec.locked || !rec.head || realPath(path.dirname(rec.path)) !== root) continue;
    const gitdir = R.git(['rev-parse', '--path-format=absolute', '--git-dir'], wt);
    if (!gitdir || realPath(gitdir) === realPath(R.commonDir)) continue;
    const why = tidyFinished(name, rec, R, gitdir);
    if (!why || inUse(wt)) continue;
    // a session being launched or just at work: its prompt written, its launch logged, a commit or a checkout
    const stamps = [wt, path.join(gitdir, 'HEAD'), path.join(gitdir, 'logs', 'HEAD'), path.join(runDir, 'prompts', `${name}.txt`)].map((f) => fs.statSync(f, { throwIfNoEntry: false })?.mtimeMs ?? 0);
    if (Math.max(...stamps, launches.get(name)?.at ?? 0) > Date.now() - tidyQuietMs()) continue;
    // a harness's own worktrees inside it (gitignored) would go with it
    try { if (fs.readdirSync(path.join(wt, '.claude', 'worktrees')).length) continue; } catch {}
    // every untracked file whatever the config says, and no file git was told to stop looking at
    const status = R.git(['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all', '--ignore-submodules=none'], wt);
    if (status === null || status !== '') continue;
    const flagged = R.git(['ls-files', '-v'], wt);
    if (flagged === null || flagged.split('\n').some((l) => /^([a-z]|S) /.test(l))) continue;
    const branch = rec.branch?.replace(/^refs\/heads\//, '');
    const pushed = R.git(['for-each-ref', '--contains', rec.head, '--count=1', '--format=%(refname)', 'refs/remotes/origin/', `refs/heads/${R.settings.main_branch}`], R.root);
    if (!pushed && !(branch && mergedAtSha(branch, rec.head))) continue;
    // Under the session's launch lock, so a launch can't come in between the last look and the
    // removal: a rename out of its name there (quick, well inside the lock's 10 s), the slow delete
    // after. A tidy that dies in between leaves a tmp-…-<pid>, which the temp sweep takes.
    const away = path.join(root, `tmp-tidy-${name}-${process.pid}`);
    const moved = withLock(path.join(runDir, `launch-${name}`), () => {
      // tmux again, as it is now (a process scan is the slow part, so that one is the tick's)
      if (windowNames().has(name) || within(busyDirs({ processes: false }), wt)) return false;
      return R.git(['worktree', 'move', wt, away], R.root) !== null;
    });
    if (!moved) continue;
    // without --force: git refuses a worktree with anything uncommitted or untracked in it; it goes back then
    if (R.git(['worktree', 'remove', away], R.root) === null) {
      if (!fs.existsSync(wt)) R.git(['worktree', 'move', away, wt], R.root);
      continue;
    }
    if (tickets().has(name) || name.startsWith('plan-')) stopPreviewsOf(name, { keepRecords: false });
    appendLog({ type: 'act', class: 'worker-slots', what: `removed worktree .worktrees/${name}${R.name === 'home' ? '' : ` (a worktree of ${R.name})`}: ${why}`, refs: [tickets().has(name) ? name : branch ?? name], reversible: true }, 'supervisor');
    removed.push(name);
  }
  if (removed.length) out(`tidied ${removed.length} finished worktree(s): ${removed.join(', ')}`);
  return removed;
}
export function makeSession(role) {
  supervisorOnly(role);
  // accounts-tick's relaunch of a session stopped at a limit: the pane's process is replaced here,
  // after every refusal and after seedWorktree, so a refusal or a failing setup leaves it running.
  const replaceAgent = !!flags['replace-agent'] && !!flags.resume;
  // accounts-tick's relaunch of a session whose window is gone: refused if the window is there after
  // all, so it can never type into a live agent. Decided under the launch lock below.
  const ifGone = !!flags['if-gone'] && !!flags.resume;
  if (flags['if-gone'] && !flags.resume) die('--if-gone goes with --resume');
  const id = positional[0] ?? die(`usage: ${role} <${role === 'worker' ? 'ticket-id' : 'feature'}> [--resume] [--force]`);
  if (repoRoot !== mainRoot) die(`run this from the main checkout (${mainRoot})`);
  if (role === 'worker' && !tickets().has(id)) die(`no ticket ${id} (devteam.mjs ticket show ${id})`);
  if (role === 'worker' && flags.remove) return removeWorkerWorktree(id);
  // A repo with files no line owns starts no new ticket; a ticket already started carries on.
  // A launch stopped before it ran (stoppedLaunch) never ran: starting it again is a new start.
  const ranBefore = role === 'worker' && !!lastPhaseOf(id) && !stoppedLaunch(id);
  if (role === 'worker' && !ranBefore) {
    const R = repoOfTicket(tickets().get(id)); // an act: fails fast on a missing or wrong checkout
    if (coverageGap(R.name, R)) die(`${R.name}'s main has coverage gaps (${coverageGapInfo(R.name, R).words}): no new ticket starts there until a chore PR fixes the lines (devteam.mjs components check${R.name === 'home' ? '' : ` --repo ${R.name}`})`);
  }
  // Every session serves a goal, and the goal's hold says whether it may start (planning.md §1):
  // drain lets a session that already ran carry on but starts nothing new; park and let-go start
  // nothing. --force does anyway, and its act says so. A planner names its goal until its feature
  // line or a question does.
  const goalOpt = flagStr('goal');
  if (goalOpt && (role !== 'planner' || logGet(goalOpt)?.type !== 'goal')) die(role === 'planner' ? `--goal ${goalOpt}: no such goal` : '--goal is for a planner');
  let goalIds = [];
  if (role === 'planner') {
    goalIds = planners().find((p) => p.feature === id)?.goals ?? plannerLaunchGoals(id);
    if (!goalIds.length && goalOpt) goalIds = [goalOpt];
    if (!goalIds.length && !resolveCommit(`refs/heads/plan/${id}`)) die(`planner ${id} --goal <g-id>: which goal it plans (needed until its feature line or a question names one)`);
  }
  const legacyDrain = draining();
  const mode = legacyDrain ? 'park' : role === 'worker' ? ticketMode(tickets().get(id)) : goalIds.length ? modeOf(goalIds.map((g) => logGet(g))) : fleetMode() ?? 'run';
  const started = role === 'worker' ? ranBefore : !!resolveCommit(`refs/heads/plan/${id}`);
  const refused = ['park', 'let-go'].includes(mode) || (mode === 'drain' && !started);
  if (refused && !flags.force) die(legacyDrain ? `the fleet is drained by an old drain (${legacyDrain.id}): fleet unpark first (supervisor.md §12); to start this one anyway, add --force (it is logged)` : `its goal is ${holdWords(mode)}: ${mode === 'drain' ? 'a draining goal finishes what is running and starts nothing new' : 'nothing starts for it'} (planning.md §1, holds). To start it anyway, add --force (it is logged)`);
  // The machine is shared with other fleets: a new session doesn't start while its memory is at the
  // supervisor's ceiling (supervisor.md §5). A resume of one that already ran always does, so a
  // dead machine's sessions all come back; --resume on one that never ran is a new start.
  // A planner moved from another machine has its plan branch on origin only, and continues from it.
  const ran = started || (role === 'planner' && !!resolveCommit(`refs/remotes/origin/plan/${id}`));
  const memNow = memoryFull();
  const memFull = flags.resume && ran ? null : memNow;
  if (memFull && !flags.force) die(`${memFull.words}: start this ${role} when some sessions finish, or pass --force (it is logged)`);
  if (!sh('tmux', ['-V'])) die('tmux not found');
  // A warning only: the numbers can be 10 minutes old, and the supervisor may know better. Not for
  // a relaunch at a limit: the tick starts that once there's room, and this file can lag it.
  if (!replaceAgent && !ifGone && accountsState()?.active_no_room) warn(`the active Claude account (${String(accountsState().active ?? 'unknown').slice(0, 80)}) has no room left, so this ${role} may stop at its limit: wait for a reset or switch account (cswap)`);
  const s = loadSettings();
  let resume = !!flags.resume;
  const blockSize = flagNum('id-block') ?? ID_BLOCK_DEFAULT;
  if (role === 'planner' && !(Number.isInteger(blockSize) && blockSize >= 1)) die('--id-block takes a whole number of ticket numbers to reserve (at least 1)');
  const name = role === 'worker' ? id : `plan-${id}`;
  const branch = role === 'worker' ? `ticket/${id}` : `plan/${id}`;
  const wt = path.join(mainRoot, '.worktrees', name);
  if (replaceAgent && !fs.existsSync(wt)) die(`--replace-agent: ${name} has no worktree at ${wt}; nothing to resume, and its process is left as it is`);
  if (ifGone && !fs.existsSync(wt)) die(`--if-gone: ${name} has no worktree at ${wt}; nothing to resume`, IF_GONE_LEFT);
  fs.mkdirSync(path.join(runDir, 'prompts'), { recursive: true });
  // A planner gets a block of ticket numbers before it numbers anything; one that has a block keeps
  // it, and one that numbered tickets before blocks existed gets none (nothing to check it against).
  const block = role === 'planner' && !idBlockFor(id) && !inFlightPlanTickets(branch).length ? reserveIdBlock(id, blockSize) : null;
  let madeWorktree = false;
  let keptWords = ''; // commits origin lacks that this start keeps, for its act
  // A worker's worktree is a checkout of its ticket's repo, under home's .worktrees;
  // a planner's is home's. s stays home's for the session, the agent and its policy.
  const R = role === 'worker' ? repoOfTicket(tickets().get(id)) : repo('home');
  const mb = R.settings.main_branch;
  // A start makes its worktree locked, with this reason, and unlocks it once it is whole: one that is
  // still locked was left by a start that stopped, or is being made now (kit-856).
  const making = `devteam: a start of ${name} is making this worktree`;
  // this start's own: those words and a token, so no start takes another's lock for its own (final-1 F1)
  const mine = `${making} (${process.pid}.${Date.now().toString(36)}.${crypto.randomBytes(3).toString('hex')})`;
  // the reason wt is locked with ('' for none), or null when it isn't locked. From git's list, so a
  // folder that is empty or gone counts too.
  const lockOf = () => {
    const at = path.join(realPath(path.dirname(wt)), path.basename(wt));
    const list = R.git(['worktree', 'list', '--porcelain'], R.root);
    // another worktree's broken record fails the list: then this one's own says
    if (list === null) return readText(path.join(/^gitdir: (.*)$/m.exec(readText(path.join(wt, '.git')) ?? '')?.[1] ?? wt, 'locked'))?.trim() ?? null;
    const l = list.split('\n\n').map((b) => b.split('\n')).find((ls) => ls.includes(`worktree ${at}`))?.find((x) => x === 'locked' || x.startsWith('locked '));
    return l === undefined ? null : l.slice('locked '.length);
  };
  // A start that moves the branch under a worktree marks it, in the worktree's own git folder, until its
  // files are the new commit's: an undo that must leave the worktree (its lock not this start's) leaves
  // the mark, and a retry refuses it rather than resume with the older commit's files read as changes (kit-886).
  const markOf = () => { const g = responderGit(['rev-parse', '--absolute-git-dir'], wt); return g.status === 0 && g.stdout.trim() ? path.join(g.stdout.trim(), 'devteam-start-filling') : null; };
  const filling = () => {
    const mark = markOf();
    const said = mark && readText(mark);
    if (said === null || said === undefined) return null;
    const [from, to] = said.trim().split(' ');
    const head = responderGit(['rev-parse', '--verify', '--quiet', 'HEAD'], wt);
    const at = head.status === 0 ? head.stdout.trim() : null;
    const was = (from ?? '').slice(0, 8) || 'another commit';
    const look = `look in it (git -C ${shq(wt)} status), keep what it holds, and remove ${shq(mark)}`;
    // at the commit the start moved to, with no change git sees to its files: the start stopped after
    // it filled them and before it took the mark off (kit-886 final-1 F3). Read without git's index lock.
    const st = at && at === to ? responderGit(['--no-optional-locks', 'status', '--porcelain', '--untracked-files=no'], wt) : null;
    if (st && st.status === 0 && st.stdout === '') return `the worktree ${wt} is at ${at.slice(0, 8)} and its files are in place, but a start that moved its branch there from ${was} stopped before it took its mark off: ${look}`;
    return `the worktree ${wt} is at ${at ? at.slice(0, 8) : 'no commit git can read'}, but a start was moving its branch from ${was}${to ? ` to ${to.slice(0, 8)}` : ''} and may not have checked out its files, so they may be another commit's, read as changes: ${look}`;
  };
  // locked by a start, this one or another
  const startsLock = (why) => why === making || (why ?? '').startsWith(`${making} (`);
  const unfinished = () => startsLock(lockOf());
  // git's record of a worktree a start is adding now: git writes its lock before the folder, and its
  // gitdir (what the list reads) after, so in between only the record says (final-1 F3)
  const beingMade = () => {
    const dir = path.join(R.git(['rev-parse', '--path-format=absolute', '--git-common-dir'], R.root) ?? path.join(R.root, '.git'), 'worktrees');
    let names = [];
    try { names = fs.readdirSync(dir); } catch {}
    return names.map((n) => path.join(dir, n)).find((d) => !fs.existsSync(path.join(d, 'gitdir')) && startsLock(readText(path.join(d, 'locked'))?.trim() ?? null)) ?? null;
  };
  // what is at wt, in words, or null when it is a worktree of its own, or nothing. The commands clear
  // only a locked one: unlock refuses on a worktree a start has finished since (kit-856).
  const inRepo = `git -C ${shq(R.root)} worktree`;
  const leftAt = () => {
    const there = fs.existsSync(wt);
    if (there && !fs.statSync(wt).isDirectory()) return `${wt} is a file, where the worktree goes: move it away`;
    const rec = beingMade();
    if (rec) return `git is making a worktree for ${wt} (its record ${rec} has no gitdir yet): if no other start is making it, remove that record`;
    const locked = unfinished();
    if (!there) return locked ? `git still holds a worktree for ${wt}, whose folder is gone: if no other start is making it, clear it (${inRepo} unlock ${shq(wt)} && ${inRepo} remove --force ${shq(wt)})` : null;
    if (!locked && !fs.readdirSync(wt).length) return null;
    const top = responderGit(['rev-parse', '--show-toplevel'], wt);
    if (top.status !== 0 && fs.existsSync(path.join(wt, '.git'))) return `git can't read ${wt} as a worktree (${firstLine(top.stderr).replace(/^fatal: /, '') || `exit ${top.status}`}), and it may hold work: ${inRepo} repair ${shq(wt)} mends one that moved; if it holds nothing to keep, move it away`;
    if (top.status !== 0 || realPath(top.stdout.trim()) !== realPath(wt)) return `${wt} is no worktree git knows: look in it, then move it away`;
    if (!locked) return filling();
    const head = responderGit(['rev-parse', '--verify', '--quiet', 'HEAD'], wt);
    return `the worktree ${wt} is there, ${head.status === 0 ? `at ${head.stdout.trim().slice(0, 8)}` : 'with no commit git can read'}: if no other start is making it and it holds nothing to keep, remove it (${inRepo} unlock ${shq(wt)} && ${inRepo} remove --force ${shq(wt)})`;
  };
  // read before the look: a worktree another start adds after this fails the add below, never a resume
  const there = fs.existsSync(wt);
  const leftBefore = leftAt();
  if (leftBefore) die(`${name}'s start isn't finished, so nothing was started: ${leftBefore}, then start it again`);
  if (!there) {
    // what origin holds, by sha: main, and the branch if it was pushed (a moved fleet continues from
    // it, never from main). Every local ref is any session's to write without a push (kit-790).
    const at = fetchLinkMain(R, 'refusing to start a ticket on a stale main', { start: branch });
    // a symbolic branch would move whatever branch it names
    const names = R.git(['symbolic-ref', '--quiet', `refs/heads/${branch}`], R.root);
    if (names !== null) die(`${branch} here is a symbolic ref to ${names}, so nothing was started: delete it (git symbolic-ref --delete refs/heads/${branch})`);
    const local = R.resolveCommit(`refs/heads/${branch}`);
    const base = at.branch ?? at.main;
    // no grafts file or commit-graph a session wrote counts as a commit's history
    const history = (args) => responderGit(['-c', 'core.commitGraph=false', '-c', 'advice.graftFileDeprecated=false', ...args], R.root, { GIT_GRAFT_FILE: '/dev/null' });
    const cannot = (r) => die(`git could not compare ${branch} with origin's: ${redactUrl(firstLine(r.stderr).replace(/^fatal: /, '')) || `exit ${r.status}`}; nothing was started`);
    const anc = (a, b) => { const r = history(['merge-base', '--is-ancestor', a, b]); return r.status === 0 || (r.status === 1 ? false : cannot(r)); };
    // Only a session that ran here has commits of its own origin may lack (worker --remove keeps the
    // branch). Any phase line but starting says so too: a ran ticket's fresh resume stopped before it
    // ran is not ranBefore.
    const kept = role === 'worker' ? ranBefore || logObjects('phase').some((p) => p.created_by === id && p.to !== 'starting') : started;
    const short = (c) => c.slice(0, 8);
    let sha = base;
    if (local && anc(local, base)) {
      // nothing beyond origin's: a stopped launch's own branch, or one behind
      if (local !== base) warn(`${branch} here (${short(local)}) holds nothing origin's ${at.branch ? branch : mb} doesn't, so it starts at origin's (${short(base)})`);
    } else if (local && !kept) {
      die(`${branch} here is at ${short(local)}, but ${at.branch ? `origin's is at ${short(at.branch)}` : `origin has no ${branch}`}, so nothing was started: a ticket that hasn't run starts from origin, and a local branch is any session's to make. Push it if it is real work, or delete it (git branch -D ${branch})`);
    } else if (local && at.branch && !anc(at.branch, local)) {
      die(`${branch} here is at ${short(local)}, but origin's is at ${short(at.branch)} and neither holds the other, so nothing was started: merge one into the other and push it, or delete the local branch (git branch -D ${branch})`);
    } else if (local) {
      sha = local;
      const counted = history(['rev-list', '--count', `${base}..${local}`]);
      if (counted.status !== 0) cannot(counted);
      const n = counted.stdout.trim();
      const commits = `${n} commit${n === '1' ? '' : 's'} origin doesn't hold yet`;
      warn(`${branch} starts at ${short(local)}, ${commits}: this ${role === 'worker' ? 'ticket' : 'plan'} ran here, and its unpushed work is kept`);
      keptWords = `, at ${short(local)}: ${commits}`;
    }
    // Everything that can fail is written before the worktree: a launch that stops here leaves none, so
    // its retry does all of it again, and nothing is taken for an earlier session's (kit-807).
    const write = (args, what) => { const r = responderGit(args, R.root); if (r.status !== 0) die(`could not ${what}: ${redactUrl(firstLine(r.stderr).replace(/^(fatal|error): /, '')) || `exit ${r.status}`}; nothing was started`); };
    // A tracking ref for a branch origin lacks can be the last ref on pushed work: it goes only once
    // its commits are in the start, or under a ref of their own. A symbolic one holds none.
    const tracking = `refs/remotes/origin/${branch}`;
    const keptAt = `refs/devteam/kept/${branch}/`;
    const exact = at.branch ? null : responderGit(['show-ref', '--verify', '--hash', tracking], R.root);
    const raw = exact?.status === 0 ? exact.stdout.trim() : null; // read once: a tag's own object too
    const peeled = raw && responderGit(['rev-parse', '--verify', '--quiet', `${raw}^{commit}`], R.root);
    const stale = peeled && peeled.status === 0 ? peeled.stdout.trim() : null;
    let keptNow = null;
    let keptUntil = null; // this start's own kept ref for commits the new worktree will hold
    if (stale) {
      const symbolic = R.git(['symbolic-ref', '--quiet', tracking], R.root) !== null;
      // the branch can be moved back before the checkout: only origin's main holds them whatever happens
      const keep = !symbolic && !anc(stale, at.main);
      if (keep) keptNow = `${keptAt}${stale}`;
      if (keep && anc(stale, sha) && responderGit(['show-ref', '--verify', '--quiet', keptNow], R.root).status !== 0) keptUntil = keptNow;
      if (keep) write(['update-ref', '--no-deref', `${keptAt}${stale}`, stale], `keep ${stale} under ${keptAt}`);
      warn(`origin has no ${branch}: its tracking ref here (${short(stale)}) is ignored and removed${keep ? `, its commits kept at ${keptAt}${stale}${keptUntil ? ' until the worktree holds them' : ''}` : ''}${sha === at.main ? `, and the branch starts from origin's ${mb} (${short(at.main)})` : ''}`);
      write(['update-ref', '--no-deref', '-d', tracking, raw], `remove ${tracking}`);
    }
    // read back, so a retry's act names what a stopped launch kept
    const found = (R.git(['for-each-ref', '--format=%(refname)', keptAt], R.root) ?? '').split('\n').filter((r) => r.startsWith(keptAt) && /^[0-9a-f]{40,64}$/.test(r.slice(keptAt.length)));
    let keptRefs = [...new Set([...(keptNow ? [keptNow] : []), ...found])];
    const sayKept = () => { if (keptRefs.length) keptWords += `; commits kept at ${keptRefs.slice(0, 3).join(', ')}${keptRefs.length > 3 ? ` and ${keptRefs.length - 3} more` : ''}`; };
    // set by config: --track fails where the checkout's fetch refspec is blank
    // set again when it is main's and origin holds the branch now: a launch refused below leaves it written
    const merge = R.git(['config', '--get', `branch.${branch}.merge`], R.root);
    if (merge === null || (at.branch && merge === `refs/heads/${mb}` && R.git(['config', '--get', `branch.${branch}.remote`], R.root) === 'origin')) {
      write(['config', '--replace-all', `branch.${branch}.remote`, 'origin'], `set ${branch}'s upstream`);
      write(['config', '--replace-all', `branch.${branch}.merge`, `refs/heads/${at.branch ? branch : mb}`], `set ${branch}'s upstream`);
    }
    const ref = `refs/heads/${branch}`;
    // A branch that was read is checked out where it is, so git itself refuses one another worktree has
    // (mid-rebase too), and only then moved, from what was read: git's own -B drops a commit that
    // landed since. A new one is made only if it still isn't there.
    if (!local) {
      const made = responderGit(['update-ref', '--no-deref', ref, sha, '0'.repeat(sha.length)], R.root);
      if (made.status !== 0) die(`could not make ${branch}: ${redactUrl(firstLine(made.stderr).replace(/^fatal: /, '')) || `exit ${made.status}`}; nothing was started`);
    }
    // -c core.useReplaceRefs=false (kit-778): a replace ref or core.useReplaceRefs any session can set would otherwise swap the tree checked out
    const headOf = () => { const h = responderGit(['rev-parse', '--verify', '--quiet', 'HEAD'], wt); return h.status === 0 ? short(h.stdout.trim()) : 'no commit'; };
    const leftWords = (left) => (left ? `, but ${left}${unfinished() ? '. If git gave no reason above, a post-checkout hook may have failed: mend it first' : ''}` : fs.existsSync(wt) && fs.readdirSync(wt).length ? `; ${wt} is there, made by another start or left by this one (a post-checkout hook that unlocked it), at ${headOf()}: look at its commit before resuming it` : '');
    const added = pastHalfMade(() => { const r = gitRun(['-c', 'core.useReplaceRefs=false', 'worktree', 'add', '--quiet', '--no-guess-remote', '--lock', '--reason', mine, wt, branch], R.root); return { ...r, ok: r.status === 0 }; }, { common: R.commonDir, wt });
    if (added.status !== 0) die(`git worktree add ${branch} failed: ${redactUrl(firstLine(added.err.split('\n').find((l) => /^fatal: /.test(l)) ?? added.err).replace(/^fatal: /, '')) || `exit ${added.status}`}; nothing was started${leftWords(leftAt())}${/is already locked/.test(added.err) ? '; a post-checkout hook may not lock the worktree while a start makes it' : ''}${added.note}`);
    // The add checks the branch out by name, so a session moving it meanwhile would win: what landed is
    // read back, and the worktree undone if it isn't the sha expected, on the branch (its full name: a
    // tag of the same name makes git print a longer short one). A branch still where this launch put it
    // goes back; one that moved keeps what landed on it.
    const read = (args, cwd) => { const r = responderGit(args, cwd); return r.status === 0 ? r.stdout.trim() : null; };
    const undo = (why) => {
      // only while the lock is this start's own: one locked, unlocked or made again by anything else
      // since is theirs, and the branch stays where it is (final-1 F1, final-1b F1)
      const now = lockOf();
      if (now !== mine) die(`${why}, so nothing was started; ${!fs.existsSync(wt) && now === null ? `${wt} went` : `something else ${now === null ? 'unlocked' : 'locked'} ${wt}`} while it was made, so the undo left it, and ${branch} at ${short(read(['rev-parse', '--verify', '--quiet', ref], R.root) ?? 'no commit')}: look in it before resuming it, since it may hold an older commit's files, then start it again`);
      gitRun(['worktree', 'remove', '--force', '--force', wt], R.root); // forced twice: this start's own lock
      // the branch stays under a worktree that is still there, or its files would read as changes to it
      // an empty folder would be taken as a session's: with a file in it, it is refused
      if (fs.existsSync(wt) && !fs.readdirSync(wt).length) { try { fs.writeFileSync(path.join(wt, 'start-unfinished.txt'), 'A start that failed could not remove this folder.\n'); } catch {} }
      const left = leftAt() ?? (fs.existsSync(wt) ? `${wt} is still there, unlocked: look in it, then move it away` : null);
      if (left) die(`${why}, so nothing was started; the undo couldn't remove it all, and ${branch} stays at ${short(read(['rev-parse', '--verify', '--quiet', ref], R.root) ?? 'no commit')}: ${left}, then start it again`);
      if (local !== sha) responderGit(['update-ref', '--no-deref', ...(local ? [ref, local, sha] : ['-d', ref, sha])], R.root);
      die(`${why}, so nothing was started; try again`);
    };
    const landed = (want) => {
      const head = read(['rev-parse', '--verify', '--quiet', 'HEAD'], wt);
      const on = read(['symbolic-ref', 'HEAD'], wt) === ref;
      if (head !== want || !on) undo(`the new worktree ${head === want ? `isn't on ${branch}` : `holds ${head ? short(head) : 'no commit'}, not ${short(want)}`}: something moved ${branch} while it was checked out`);
    };
    landed(local ?? sha);
    if (local && local !== sha) {
      const mark = markOf();
      try { if (!mark) throw new Error('git found no git folder for it'); fs.writeFileSync(mark, `${local} ${sha}\n`); } catch (e) { undo(`could not mark ${wt} as being filled: ${e.message}`); }
      // the branch isn't moved yet, so its files are still its own: off with the mark, then undo
      const unmarked = (why) => { try { fs.rmSync(mark, { force: true }); } catch {} undo(why); };
      // read again once the mark is there: a lock taken off or replaced before it was there let another
      // start resume in this worktree, so the branch isn't moved under it (plan-1 P1-1)
      if (lockOf() !== mine) unmarked('the new worktree\'s lock changed while it was made');
      const moved = responderGit(['update-ref', '--no-deref', ref, sha, local], R.root);
      // a move that fails keeps the mark: most often something else moved the branch, and HEAD with it, off these files
      if (moved.status !== 0) undo(`could not move ${branch} to ${short(sha)}: something moved it while it was checked out`);
      // as worktree add fills one: no time limit (a filter or a lazy fetch can be slow), no submodules
      const filled = gitRun([...RESPONDER_GIT, 'read-tree', '--reset', '-u', '--no-recurse-submodules', sha], wt);
      if (filled.status !== 0) undo(`could not check out ${short(sha)}: ${redactUrl(firstLine(filled.err).replace(/^(fatal|error): /, '')) || `exit ${filled.status}`}`);
      landed(sha);
      try { fs.rmSync(mark); } catch (e) { undo(`could not remove ${mark}: ${e.message}`); }
    }
    // only its own lock: one a hook or a person put on it in its place is theirs, and stays (final-1 F2, final-1b F4)
    const lockNow = lockOf();
    // unlocked by something else, or locked by another start, so another start may be in it: the undo leaves it
    if (lockNow === null || (lockNow !== mine && startsLock(lockNow))) undo(`the new worktree was ${lockNow === null ? 'unlocked' : 'locked by another start'} while it was made`);
    const unlocked = lockNow === mine ? responderGit(['worktree', 'unlock', wt], R.root) : { status: 0 };
    if (unlocked.status !== 0) undo(`could not unlock the new worktree: ${redactUrl(firstLine(unlocked.stderr).replace(/^(fatal|error): /, '')) || `exit ${unlocked.status}`}`);
    // the worktree's branch holds them now
    if (keptUntil && responderGit(['update-ref', '--no-deref', '-d', keptUntil, stale], R.root).status === 0) keptRefs = keptRefs.filter((r) => r !== keptUntil);
    sayKept();
    madeWorktree = true;
  }
  // looked at again before anything is written there: another start's add into a folder that was
  // there, empty, may have locked it since the look (final-1 F3), or marked it as being filled (kit-921)
  if (there && (beingMade() || unfinished() || filling())) die(`${name}'s start isn't finished, so nothing was started: ${leftAt() ?? `another start is making ${wt}`}, then start it again`);
  // A harness keeps its sessions by directory on its own machine: a worktree made just now has no
  // session to continue (a new machine, or the worktree was removed), so start fresh, with the
  // handoff note if there is one, and say so.
  if (resume && madeWorktree) {
    warn(`no ${role} session to resume for ${name}: its worktree was just made here, so the agent has no earlier session in it (a new machine, or the worktree was removed); starting it fresh with agent_command${handoffFor(name) ? ' and its handoff note' : ''} instead`);
    resume = false;
  }
  seedWorktree(wt, { repo: R, session: true });
  // the relaunch's deadline is the setup's alone: no tmux server, window or agent started below inherits it
  delete process.env.DEVTEAM_SETUP_DEADLINE;
  // records in home: home's ticket/<id> in its own worktree, made on its own (a resume whose
  // records worktree was removed gets it back)
  if (role === 'worker' && recordsInHomeId(id)) ensureRecordsWorktree(id);
  // the agent's trust in its folder, before it starts (agent_trust_command); a dialog left up is a finding
  trustWorktree(wt, s, R);
  const promptFile = path.join(runDir, 'prompts', `${name}.txt`);
  const knowledge = knowledgeBlock(id);
  // What the prompt's knowledge block carries, for the start's act (a lesson's effect is measured
  // from it): only on a fresh start, since a resumed session never reads the new prompt; the newest
  // first, as many as fit a line.
  const given = resume ? [] : knowledgeFor(id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, KNOWLEDGE_IDS_MAX).map((k) => k.id);
  const links = linksBlock(id);
  const arts = artifactsBlock(id);
  const held = block ?? (role === 'planner' ? idBlockFor(id) : null);
  const text = `${promptFor(role, id, R)}${held ? ` ${idBlockText(held)}` : ''}`;
  const handoff = handoffBlock(name);
  const previews = previewsBlock(name);
  fs.writeFileSync(promptFile, `${text}${handoff ? `\n\n${handoff}` : ''}${previews ? `\n\n${previews}` : ''}${links ? `\n\n${links}` : ''}${arts ? `\n\n${arts}` : ''}${knowledge ? `\n\n${knowledge}` : ''}\n`);
  // One step under a lock per session, the look at the window through the act that records the
  // launch, so two launches of one session at the same moment can't both type into it: whichever
  // comes second finds the first's window and leaves it alone. withLock clears a lock older than
  // 10 s, so a launch that crashed halfway costs the next one a wait, never a wedge.
  class LaunchRefused extends Error { constructor(m, code) { super(m); this.code = code; } }
  const refuse = (m, code = 1) => { throw new LaunchRefused(m, code); };
  try {
    withLock(path.join(runDir, `launch-${name}`), () => {
    // Workers live in detached tmux windows the owner can attach to; the supervisor is not one of them.
    let fresh = false;
    const session = tmuxSession({ save: true });
    if (replaceAgent && !(sh('tmux', ['list-windows', '-t', `=${session}`, '-F', '#W']) ?? '').split('\n').includes(name)) refuse(`--replace-agent: no window ${session}:${name} to restart in`);
    if (!tmux(['has-session', '-t', `=${session}`])) { fresh = sh('tmux', ['new-session', '-d', '-s', session, '-n', name, '-c', wt], { env: tmuxServerEnv() }) !== null; if (!fresh) refuse('could not start tmux'); }
    const windows = (sh('tmux', ['list-windows', '-t', `=${session}`, '-F', '#W']) ?? '').split('\n');
    if (!fresh && windows.includes(name)) {
      if (ifGone) refuse(`--if-gone: window ${session}:${name} exists; left as it is`, IF_GONE_LEFT);
      if (!flags.resume) refuse(`window ${session}:${name} exists (use --resume to relaunch in it)`);
      // the race with the tick's relaunch: it recorded this session a moment ago and its agent is still
      // coming up, so its window is left alone. The record ages out, so this can't wedge a real resume.
      const t = restartTimes(Date.now())[name]?.at(-1);
      if (!replaceAgent && t && Date.now() - t < SETTLED_MS) refuse(`window ${session}:${name} was relaunched by the dashboard moments ago; left as it is`, 0);
      // a resume is typed into the pane: with an agent running there it would land in that agent's input
      if (!replaceAgent && !resolvePane(`=${session}:${name}`).problem) refuse(`window ${session}:${name} has a live agent; quit it or close the window first, then --resume`);
    } else if (!fresh) tmux(['new-window', '-d', '-t', `=${session}`, '-n', name, '-c', wt]);
    const target = `=${session}:${name}`;
    const shown = `${session}:${name}`;
    const env = `export DEVTEAM_HOME=${shq(mainRoot)} DEVTEAM_RUN='${runDir}' DEVTEAM_ROLE='${role}' ${role === 'worker' ? `DEVTEAM_TICKET='${id}'` : `DEVTEAM_FEATURE='${id}'`}`;
    if (replaceAgent) {
      // worktree_setup can take minutes: the owner may have quit the agent and started something since
      if (resolvePane(target).problem || !paneStoppedAtLimit(target)) refuse(`--replace-agent: ${shown} no longer shows a limit stop; left as it is`);
      const failed = replacePaneProcess(target, wt);
      if (failed) refuse(failed);
    }
    // Past the replacement nothing is left running there, so a failure has to surface, not log success.
    const type = (line) => { if (!typeNow(target, line) && (replaceAgent || ifGone)) refuse(`could not type into ${shown}: ${replaceAgent ? 'its old process is gone and the new one did not start' : 'its new window has no agent in it'}; ${role} ${id} --resume starts it`); };
    type(env);
    // Worker and planner policy travels with the launch, not the repo's agent config (which may be
    // gitignored, and would bind the supervisor too): for Claude Code, a --settings file in run/.
    let cmd = resume ? s.resume_command : s.agent_command;
    if (/^claude(\s|$)/.test(cmd)) {
      // per session: the deny rules name the main branch of the repo this session works in (claudePolicy)
      cmd = cmd.replace(/^claude/, `claude --settings '${claudePolicy(name, s, mb, { stopHook: true })}'`);
    }
    // A tmux server started from inside an agent session (the supervisor's, on a new machine) hands
    // every window that session's markers; a worker that inherits them runs as its child (Claude Code
    // then saves no transcript, so its spend goes unmeasured). Strip them for the agent, whatever the
    // window's shell is. Only per-session markers: settings an owner may export (CLAUDE_CONFIG_DIR) stay.
    // by its file, fresh or resumed: a resume's prompt is as large as a fresh start's
    type(`${sessionMarkerPrefix()}${cmd} ${shq(promptPointer(promptFile))}`);
    if (role === 'worker' && !resume) appendLog({ type: 'phase', from: null, to: 'starting', note: `started in ${shown}` }, id);
    // a planner parked by a park is running again
    if (role === 'planner' && lastPhaseOf(name)?.to === 'parked') appendLog({ type: 'phase', from: 'parked', to: 'starting', note: `started in ${shown}` }, name);
    appendLog({ type: 'act', decision: citing(), class: 'worker-slots', what: `${resume ? 'resumed' : 'made'} ${role} ${name} in ${shown}${block ? `, ticket numbers ${padNN(block.from)}-${padNN(block.to)}` : ''}${refused || memFull ? ` while ${[refused && `its goal is ${holdWords(mode)}`, memFull?.words].filter(Boolean).join(' and ')}, with --force` : memNow && !resume ? `, a resume that started fresh while ${memNow.words}` : ''}${keptWords}`, refs: role === 'worker' ? [id] : goalIds, reversible: true, id_block: block ?? undefined, knowledge: given.length ? given : undefined }, 'supervisor');
    out(`${resume ? 'resumed' : 'made'} ${role} ${name} in ${shown} at ${wt}${block ? `; ticket numbers ${padNN(block.from)}-${padNN(block.to)} reserved` : ''}`);
    });
  } catch (e) {
    if (e instanceof LaunchRefused) die(e.message, e.code);
    throw e;
  }}

// A session's deny rules: the owner's worker_denied_commands, where a push rule that names the
// literal branch main also names the main branch of the repo the session works in (a sibling on
// trunk, or a home whose main_branch isn't main), so no worker pushes straight to its repo's main.
export function deniedFor(rules, mb) {
  const out = [...rules];
  if (mb && mb !== 'main') for (const c of rules) if (/^git push\b/.test(c) && /\bmain\b/.test(c)) out.push(c.replace(/\bmain\b/g, mb));
  return [...new Set(out)];
}

// --- moving the fleet: fleet park | drain, fleet status, fleet unpark | undrain (supervisor.md §12) ---
//
// What git doesn't carry stays on this machine: run/ (the live log, review results and drafts,
// forge-git PR text, caches), each session's worktree and its harness session, worktree_files and
// secret keys, and the tools. A drain stops every worker and planner with its work pushed and a
// handoff note on its branch, and records itself in the log, so that once the log lands, a clone
// anywhere knows the fleet is drained and what to restart. Neither grants anything: drain and
// undrain are operational acts, logged so the owner sees them.
export const drainActs = () => logObjects('act').filter((a) => a.class === 'drain' || a.class === 'undrain').sort(byTime);
// The drain in force: the latest drain act with no undrain after it.
export const draining = () => { const l = drainActs().pop(); return l?.class === 'drain' ? l : null; };
export const latestDrain = () => drainActs().filter((a) => a.class === 'drain').pop() ?? null;
export const DRAIN_WHAT = /^drained the fleet on (\S+?): ([\s\S]*)$/;
export const drainHost = (a) => DRAIN_WHAT.exec(a?.what ?? '')?.[1] ?? null;
export const drainReason = (a) => DRAIN_WHAT.exec(a?.what ?? '')?.[2] ?? a?.what ?? '';
export const lastPhaseOf = (who) => logObjects('phase').filter((p) => p.created_by === who).sort(byTime).pop() ?? null;
// A session by its writer name: a ticket id, or plan-<feature>.
// A session by its writer name: a ticket id, or plan-<feature>. Its repo by name; the object only
// on use, so listing sessions never needs a checkout of every repo.
export function sessionOf(name) {
  const planner = writerClass(name) === 'planner';
  const id = planner ? name.slice('plan-'.length) : name;
  const t = planner ? null : tickets().get(id);
  const repoName = t ? repoOfTicketLink(t) : 'home';
  return { name, role: planner ? 'planner' : 'worker', id, branch: planner ? `plan/${id}` : `ticket/${id}`, wt: path.join(mainRoot, '.worktrees', name), handoff: `${projectRelOf(repoName)}/${planner ? `plans/${id}` : `tickets/${id}`}/handoff.md`, repoName, readable: repoReadable(repoName), get repo() { return repo(repoName); } };
}
// A repo's project folder by name, from settings alone (no checkout needed).
export const projectRelOf = (name) => { if (name === 'home') return projectRel; const s = loadSettings(); const l = ownEntry(s.links, name); return LINK_KINDS[l?.kind]?.effectiveSettings(l, s)?.project ?? REPO_OWN_DEFAULTS.project; };
// A handoff note's old file form, under any repo's project folder.
export const isHandoffFile = (file) => !!file && [...new Set([projectRel, ...Object.keys(loadSettings().links ?? {}).filter((id) => LINK_KINDS[loadSettings().links[id]?.kind]?.hostsComponents).map(projectRelOf)])].some((rel) => new RegExp(`^${reReserved(rel)}/(tickets|plans)/[^/]+/handoff\\.md$`).test(file));
// What parked a session at a time: an old fleet drain in force then, or the park or let-go of one
// of its goals (a fleet park is one on every goal) in force then. A session parked for another
// reason (a ruling about its ticket) has no cause, and so no handoff block.
export function parkCauseAt(name, at) {
  const t = Date.parse(at);
  const legacy = drainActs().filter((a) => Date.parse(a.created_at) <= t).pop();
  if (legacy?.class === 'drain') return { kind: 'fleet', at: legacy.created_at, marker: `drain:${legacy.id}`, reason: drainReason(legacy), host: drainHost(legacy), legacy };
  const gs = sessionGoals(name);
  const set = gs.length ? gs : holdableGoals();
  return set.map((g) => causeOf(g, t)).filter(Boolean).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
}
// The handoff note a session gets in its prompt, only while it is current: the session's latest
// parked line had a park cause, and it has logged no phase of its own since (a "starting" line is
// the launch's). After its first real phase line the note is history: it stays in its folder,
// never prompted again, until a later park overwrites it.
export function handoffFor(name) {
  const planner = writerClass(name) === 'planner';
  const mine = readLog().lines.filter((l) => l.by === name).sort((x, y) => x.at.localeCompare(y.at));
  const parked = mine.filter((l) => l.type === 'phase' && l.to === 'parked').pop();
  if (!parked) return null;
  // A planner logs no phases while it works, so any line of its own (a message, an observation) ends it.
  const launch = (l) => l.type === 'phase' && ['parked', 'starting'].includes(l.to);
  if (mine.some((l) => l.at > parked.at && (planner || l.type === 'phase') && !launch(l))) return null;
  const s = sessionOf(name);
  // its branch is in its own repo; one this machine can't read has no handoff here
  if (!s.readable) return null;
  const R = s.repo;
  // A hold released while the session was parking leaves no cause in force at its parked line;
  // a handoff commit it made for that park still counts.
  const prev = mine.filter((l) => l.type === 'phase' && l.at < parked.at && !launch(l)).pop();
  const own = [`refs/heads/${s.branch}`, `refs/remotes/origin/${s.branch}`].map((r) => handoffCommit(r, name, R)).find((c) => c && (!prev || c.at >= prev.at));
  const cause = parkCauseAt(name, parked.at) ?? (own ? { kind: 'self', at: parked.at, marker: `self:${name}@${parked.at}`, reason: null } : null);
  if (!cause) return null;
  for (const r of [`refs/heads/${s.branch}`, `refs/remotes/origin/${s.branch}`]) {
    const c = handoffCommit(r, name, R);
    if (c) return { ...s, text: c.body, where: `the handoff commit ${c.sha.slice(0, 12)} on ${s.branch}, ${c.at}`, cause, parked_at: parked.at };
  }
  // the note used to be a file: read one a session parked by an old drain left
  const local = readText(path.join(s.wt, s.handoff));
  if (local !== null) return { ...s, text: local, where: `${s.handoff} in its worktree`, cause, parked_at: parked.at };
  for (const r of [`refs/heads/${s.branch}`, `refs/remotes/origin/${s.branch}`]) {
    if (!R.resolveCommit(r)) continue;
    const text = R.git(['show', `${r}:${s.handoff}`]);
    if (text !== null) return { ...s, text, where: `${s.handoff} on ${s.branch}, committed ${R.git(['log', '-1', '--format=%cI', r, '--', s.handoff]) ?? '?'}`, cause, parked_at: parked.at };
  }
  return null;
}
// A parked session's handoff is an empty commit on its own branch, titled "devteam handoff: <name>",
// with the note as its body: nothing extra lands in the repo, and it travels with the branch.
export const HANDOFF_SUBJECT = (name) => `devteam handoff: ${name}`;
export function handoffCommit(ref, name, R = repo('home')) {
  if (!R.resolveCommit(ref)) return null;
  const raw = R.git(['log', '-1', '--format=%H%x00%cI%x00%B', `--grep=^${HANDOFF_SUBJECT(name).replace(/[.[\]*^$]/g, '\\$&')}$`, ref]);
  if (!raw) return null;
  const [sha, at, msg] = raw.split('\0');
  return { sha, at, body: msg.split('\n').slice(1).join('\n').trim() };
}
// The supervisor's handoff is an annotated tag on origin, devteam-handoff/<fleet op>, with the note
// as its message: no file, no PR. An older move's file on main is still read.
export const SUPERVISOR_TAGS = 'refs/tags/devteam-handoff/';
export function supervisorHandoff(since) {
  if (!flags['no-fetch'] && commonDir) git(['fetch', '--quiet', 'origin', `+${SUPERVISOR_TAGS}*:${SUPERVISOR_TAGS}*`]);
  const rows = (git(['for-each-ref', '--sort=-taggerdate', '--format=%(refname:short)%00%(taggerdate:iso-strict)%00%(contents)%00%01', SUPERVISOR_TAGS]) ?? '').split('\x01').map((x) => x.replace(/^\n/, '')).filter(Boolean);
  for (const r of rows) {
    const [tag, at, text] = r.split('\0');
    if (!since || Date.parse(at) >= Date.parse(since) - 60000) return { text: (text ?? '').trim(), at, rel: tag };
  }
  const legacy = supervisorHandoffOnMain();
  return legacy && (!since || Date.parse(legacy.at) >= Date.parse(since) - 60000) ? legacy : null;
}
// handoff [--file f] [--supervisor]: a worker or planner records its handoff note (stdin or a file)
// as an empty commit on its branch and pushes the branch; the supervisor records its own as an
// annotated tag on origin.
export function cmdHandoff() {
  const note = (flagStr('file') ? fs.readFileSync(flagStr('file'), 'utf8') : fs.readFileSync(0, 'utf8')).trim();
  if (!note) die('handoff: the note is empty (stdin or --file): what is done, the exact next step, open questions, anything not committed');
  if (flags.supervisor) {
    supervisorOnly('handoff --supervisor');
    const op = fleetOpInForce()?.fleet ?? (draining() ? draining().id : null) ?? (fleetMode() ? `held-${newFleetId().slice(2)}` : null) ?? die('handoff --supervisor is for a fleet park or drain in force');
    git(['fetch', '--quiet', 'origin', loadSettings().main_branch]);
    const tag = `devteam-handoff/${op}-${newFleetId().slice(2)}`;
    const base = mainRef() ?? 'HEAD';
    withScratch((dir) => {
      const f = path.join(dir, 'note');
      fs.writeFileSync(f, `Supervisor handoff (${op})\n\n${note}\n`);
      gitOrDie(['tag', '-a', tag, '-F', f, base], mainRoot);
    });
    gitOrDie(['push', '--quiet', 'origin', `refs/tags/${tag}`], mainRoot);
    return out(`pushed ${tag} with your handoff; fleet status checks it, and fleet unpark prints it on the new machine`);
  }
  const role = process.env.DEVTEAM_ROLE;
  if (!['worker', 'planner'].includes(role)) die('handoff: a worker or planner records its own (the supervisor adds --supervisor)');
  const name = role === 'worker' ? (process.env.DEVTEAM_TICKET ?? currentTicketId() ?? die('handoff: no ticket')) : `plan-${process.env.DEVTEAM_FEATURE ?? die('handoff: no feature')}`;
  const sess = sessionOf(name);
  if (workLines(cwdGit(['status', '--porcelain'])).length) die('handoff: commit your work in progress first (a WIP commit is fine); the handoff commit holds only the note');
  const branch = cwdGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== sess.branch) die(`handoff: you are on ${branch}, not ${sess.branch}`);
  // what was running, for the session that picks this up (phase parked stops it next)
  const listed = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'preview', 'list', '--json'], { cwd: process.cwd(), encoding: 'utf8' });
  let running = [];
  try { running = JSON.parse(listed.stdout).filter((r) => r.session === name); } catch {}
  const previews = running.length ? `\n\n## Previews running\n\n${JSON.stringify(running, null, 2)}` : '';
  withScratch((dir) => {
    const f = path.join(dir, 'msg');
    fs.writeFileSync(f, `${HANDOFF_SUBJECT(name)}\n\n${note}${previews}\n`);
    cwdGitOrDie(['commit', '--quiet', '--allow-empty', '-F', f]);
  });
  cwdGitOrDie(['push', '--quiet', 'origin', `HEAD:refs/heads/${sess.branch}`]);
  out(`handoff committed on ${sess.branch} and pushed; now: devteam.mjs phase parked --note "parked", and stop`);
}
export const causeWords = (c) => (c.kind === 'self' ? 'it was told to park' : c.kind === 'fleet' ? `the fleet was parked${c.host ? ` on ${c.host}` : ''}${c.reason ? ` (${c.reason})` : ''}` : c.kind === 'let-go' ? `the owner let go of "${c.title}"` : `"${c.title}" was parked${c.reason ? ` (${c.reason})` : ''}`);
export const HANDOFF_MAX = 12000;
export function handoffBlock(name) {
  const h = handoffFor(name);
  if (!h) return null;
  const body = h.text.length > HANDOFF_MAX ? `${h.text.slice(0, HANDOFF_MAX)}\n\n(cut at ${HANDOFF_MAX} characters; read the whole file)` : h.text;
  return `## Handoff from a parked session\n\nThis session was parked (${causeWords(h.cause)}, ${h.cause.at}) and starts without the earlier one's context. Before anything else in ${h.role === 'worker' ? 'worker.md §2' : 'planning.md'}, read this note, left by the session that stopped (${h.where}); then check it against your branch, your files and the log. It stays on your branch as a commit and lands with your PR. Between the lines below is the note itself, as that session wrote it.\n\n-----\n${body.trimEnd()}\n-----`;
}
// The supervisor's own handoff: its context doesn't move either, so it writes one too, and it lands
// on main like any project file (chore drain-handoff), so the next supervisor reads it from git.
export const SUPERVISOR_HANDOFF = 'handoffs/supervisor.md';
export const supervisorHandoffOnMain = () => {
  const main = mainRef();
  if (!main || !projectInRepo) return null;
  const rel = `${projectRel}/${SUPERVISOR_HANDOFF}`;
  const text = git(['show', `${main}:${rel}`]);
  return text === null ? null : { text, at: git(['log', '-1', '--format=%cI', main, '--', rel]), rel };
};
// An agent harness's own memory for this project, outside the repo (Claude Code keeps it per
// checkout folder). It doesn't move; what the next session needs goes into knowledge or a handoff.
export function harnessMemoryFiles() {
  const root = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'projects');
  const slug = realOrSelf(mainRoot).replace(/[^a-zA-Z0-9]/g, '-');
  const outFiles = [];
  let dirs = [];
  try { dirs = fs.readdirSync(root).filter((d) => d === slug || d.startsWith(`${slug}--worktrees-`)); } catch { return []; }
  for (const d of dirs) {
    const mem = path.join(root, d, 'memory');
    let names = [];
    try { names = fs.readdirSync(mem).filter((f) => f.endsWith('.md')); } catch { continue; }
    for (const f of names) { try { outFiles.push({ path: path.join(mem, f), mtime: fs.statSync(path.join(mem, f)).mtimeMs }); } catch {} }
  }
  return outFiles;
}
// One fingerprint of everything the log says, the same on any machine that holds the same log: the
// drained machine prints it when ready, the new one after undrain. The log's own landing act and
// the undrain itself are the two lines only one side has, so neither counts.
export function parityPrint() {
  logCache = null;
  const lines = readLog().lines.filter((l) => !(l.type === 'act' && (['undrain', 'fleet-unpark', 'fleet-undrain'].includes(l.class) || (l.class === 'merge-chore' && /^merged chore-log at /.test(l.what ?? '')))) && !(l.type === 'goal' && l.hold?.undoes));
  const ids = lines.map((l) => `${l.id}\t${JSON.stringify(l)}`).sort();
  return { hash: sha256(Buffer.from(ids.join('\n'))).slice(0, 16), lines: ids.length };
}

// drain and undrain are the old names. drain used to park the fleet; now fleet park does that and
// fleet drain lets in-flight work finish. undrain still lifts an old drain still in force.
export function cmdDrain() {
  if (flags.status) return fleetStatus();
  die('drain has split in two (supervisor.md §12): fleet park stops every session with a WIP commit, a push and a handoff note (what drain used to do; use it to move machines), and fleet drain lets in-flight work finish while nothing new starts. Run the one you mean');
}
export function cmdUndrain() {
  if (!draining()) die('undrain lifts an old fleet drain; for a fleet op use fleet unpark or fleet undrain');
  return fleetUndo('park');
}
export const fleetWriter = () => (flags.owner ? ownerWriter().by : (supervisorOnly('fleet'), 'supervisor'));
export const fleetAt = (op) => (op ? `${op.slice(2, 6)}-${op.slice(6, 8)}-${op.slice(8, 10)}T${op.slice(11, 13)}:${op.slice(13, 15)}:${op.slice(15, 17)}.${op.slice(17, 20)}Z` : null);
// fleet drain | park | undrain | unpark | status
export function cmdFleet() {
  const sub = positional[0];
  if (sub === 'status') return fleetStatus();
  if (sub === 'host') return fleetHost();
  if (sub === 'drain' || sub === 'park') return fleetOp(sub);
  if (sub === 'undrain') return fleetUndo('drain');
  if (sub === 'unpark') return fleetUndo('park');
  // resume: undo whatever fleet ops are in force, park first (a move), then drain.
  if (sub === 'resume') {
    const inForce = (m) => holdableGoals().some((g) => g.hold?.fleet && g.hold.mode === m);
    if (!inForce('park') && !inForce('drain') && !draining()) return out('no fleet park or drain in force; nothing to resume');
    if (inForce('park') || draining()) { fleetUndo('park'); logCache = null; }
    if (inForce('drain')) fleetUndo('drain');
    return;
  }
  die('usage: fleet drain | park [--reason "…"] [--move]   |   fleet undrain | unpark | resume   |   fleet status   |   fleet host [--release | --take]   (add --owner when the owner runs it)');
}
// Set every goal's hold at once (Upkeep included), recording what each was. A fleet drain touches
// only running goals and a fleet park only goals not already parked, so undoing it puts back
// exactly what it changed.
export function fleetOp(mode) {
  const by = fleetWriter();
  // a fleet park stops the thread responder (kit-103): only once the writer is allowed, and before
  // any return below, so a park with every goal already parked, or a move's marking, stops it too
  if (mode === 'park') { const at = stopResponder(); if (at) out(`stopped the responder (${at})`); }
  // A park or drain is a pause unless it says it is a move (--move): throttling spend, waiting on
  // the owner or on information, a quiet week. Only a move releases the host claim (hostClaimBody).
  const move = !!flags.move;
  const reason = flagStr('reason') ?? (mode === 'park' ? (move ? 'moving the fleet to another machine' : 'paused: nothing runs until the fleet is unparked') : (move ? 'finishing in-flight work, then moving the fleet to another machine' : 'finishing in-flight work, starting none'));
  const op = newFleetId();
  const host = os.hostname();
  const changed = [];
  for (const g of holdableGoals()) {
    const m = goalMode(g);
    if (mode === 'drain' ? m !== 'run' : m === 'park') continue;
    const cur = g.hold ?? { mode: 'run' };
    const prior = { mode: cur.mode, ...(cur.reason ? { reason: cur.reason } : {}), ...(cur.fleet ? { fleet: cur.fleet } : {}) };
    writeHold(g, { mode, reason, fleet: op, host, ...(move ? { move: true } : {}), prior }, by);
    changed.push(isUpkeep(g) ? 'upkeep' : g.id);
  }
  // a pause already in force becomes a move with --move: mark each held goal's hold a move (same op),
  // so the claim is released, without unparking and re-sending the park rulings
  if (!changed.length && move) {
    const marked = [];
    for (const g of holdableGoals()) {
      const m = goalMode(g);
      // only a fleet op's hold can be marked (movingFleet reads fleetOpInForce): a goal's own hold,
      // the owner's per-goal toggle, has no fleet op to carry the move
      if (m === 'run' || !g.hold?.fleet || g.hold.move) continue;
      writeHold(g, { ...g.hold, move: true }, by);
      marked.push(isUpkeep(g) ? 'upkeep' : g.id);
    }
    const own = holdableGoals().filter((g) => goalMode(g) !== 'run' && !g.hold?.fleet).map((g) => (isUpkeep(g) ? 'upkeep' : g.id));
    if (!marked.length && own.length && !fleetOpInForce()) return out(`nothing marked: ${own.length} goal(s) are held by their own holds, not a fleet op (${own.slice(0, 5).join(', ')}${own.length > 5 ? ', …' : ''}), so there is no fleet op to make a move. A move needs one: fleet unpark (or the owner lifts those holds), then fleet ${mode} --move`);
    if (!marked.length) return out(`every goal is already held as a move; nothing to do`);
    logCache = null;
    if (by === 'supervisor') { hostCheck(); appendLog({ type: 'act', decision: citing(), class: `fleet-${mode}`, what: `marked the held fleet on ${host} a move: ${reason}`, refs: marked.filter((x) => x !== 'upkeep'), reversible: true }, 'supervisor'); }
    out(`marked the held fleet a move: ${marked.length} goal(s), Upkeep included; this machine releases its claim`);
    return out('then: fleet status until it says "ready to move" (it lists what is left, and the new machine\'s checklist)');
  }
  if (!changed.length) return out(`every goal is already ${mode === 'park' ? 'parked' : 'draining or parked'}; nothing to do`);
  // only a move releases the claim, so the machine it moves to may take it over; a pause keeps it here
  logCache = null;
  if (by === 'supervisor') hostCheck();
  if (by === 'supervisor') appendLog({ type: 'act', decision: citing(), class: `fleet-${mode}`, what: `${mode === 'park' ? 'parked' : 'drained'} the fleet on ${host} (${op})${move ? ' to move it' : ''}: ${reason}`, refs: changed.filter((x) => x !== 'upkeep'), reversible: true }, 'supervisor');
  out(`${mode === 'park' ? 'parked' : 'draining'} the fleet (${op}): ${changed.length} goal(s) set to ${mode}, Upkeep included; nothing new starts until fleet un${mode}`);
  if (mode === 'park') {
    if (by === 'supervisor') {
      const sent = sendParkRulings();
      out(sent.length ? `told ${sent.join(', ')} to commit, push, write a handoff and park` : 'no running worker or planner to tell');
      out("next: once every session is parked, write your own handoff (what you were in the middle of, what you are waiting on, what you told the owner you would do, and anything from your agent's own memory the next supervisor needs: owner rules belong in knowledge) and push it: devteam.mjs handoff --supervisor, the note on stdin");
    } else nudgeSupervisor(`[devteam fleet park ${op} from owner] send the park rulings (goal park-sessions --all), write your handoff and land it, then fleet status`);
  } else {
    out(move ? 'in-flight work carries on and merges; fleet status says "ready to move" once nothing is running' : 'in-flight work carries on and merges; nothing new starts until fleet undrain');
    if (by !== 'supervisor') nudgeSupervisor(`[devteam fleet drain ${op} from owner] start nothing new; let in-flight work finish and merge`);
  }
  out(move ? 'then: fleet status until it says "ready to move" (it lists what is left, and the new machine\'s checklist)' : `a pause on this machine, not a move: it keeps supervising here. To move machines, fleet ${mode} --move (supervisor.md §12)`);
}
// Everything the move needs, checked, then the new machine's checklist. Writes nothing.
// A whole fleet parked or drained can move: parked sessions carry their work in git with a handoff
// note, and a drained fleet has nothing in flight at all.
export function fleetStatus() {
  const s = loadSettings();
  const legacy = draining();
  const fm = legacy ? 'park' : fleetMode();
  const op = fleetOpInForce();
  const since = legacy ? legacy.created_at : op ? fleetAt(op.fleet) : null;
  const d = fm ? { id: legacy?.id ?? op?.fleet ?? 'holds', created_at: since } : null;
  // Every repo link, and whether this machine can read it (a view: never fails on one it can't).
  const repoLinks = Object.entries(s.links ?? {}).filter(([, l]) => LINK_KINDS[l?.kind]?.hostsComponents);
  const readableLinks = repoLinks.filter(([id]) => repoReadable(id)).map(([id]) => repo(id));
  // another repo's fetch failing is a blocker: its sessions' pushed state would be read from a stale origin
  // home's too (kit-339): with no prompt and a deadline, and a failure said, never a check that reads as done;
  // and how to clear it (kit-341): the fetch can't prompt, so a key or a password it needed gets the agent and
  // the saved login; every failure gets a fetch from a terminal, which shows why and clears the rest
  const fetchFails = [];
  let fetchError = null;
  if (!flags['no-fetch'] && commonDir) {
    if (git(['config', '--get', 'remote.origin.url'], mainRoot)) {
      const f = hostNet(['fetch', '--quiet', 'origin']);
      const needsLogin = f.status !== null && /Permission denied \(publickey|could not read (Username|Password)|Authentication failed|passphrase/i.test(f.err);
      const clear = needsLogin ? "The fetch can't prompt: load the ssh key into an agent (ssh-add) or save an https login (a git credential helper), or run git fetch origin in a terminal, then check again" : 'Run git fetch origin in a terminal to see why, then check again';
      if (f.status !== 0) fetchFails.push(fetchError = `home: could not fetch origin: ${f.status === null ? 'timed out' : redactUrl(firstLine(f.err)) || `exit ${f.status}`}; what its sessions pushed is unchecked. ${clear}`);
    }
    for (const R of readableLinks) {
      if (R.git(['config', '--get', 'remote.origin.url'], R.root) === null) continue;
      const f = gitRun(['fetch', '--quiet', 'origin'], R.root);
      if (f.status !== 0) fetchFails.push(`${R.name}: could not fetch origin: ${redactUrl(firstLine(f.err)) || `exit ${f.status}`}; what its sessions pushed is unchecked`);
      R.resetCaches();
    }
  }
  mainRefCache = undefined;
  const main = mainRef();
  const blockers = [...fetchFails];
  const warnings = [];
  if (!fm) blockers.push(`the fleet is neither parked nor drained (${holdableGoals().filter((g) => goalMode(g) === 'run').map((g) => (isUpkeep(g) ? 'Upkeep' : `"${g.title}"`)).join(', ')} still running): run fleet park or fleet drain first`);

  const sessions = liveSessions().map((x) => {
    const phase = lastPhaseOf(x.name);
    // a session in a repo this machine can't read: one blocker that says what to clone where
    if (!x.readable) {
      const l = ownEntry(s.links, x.repoName);
      const p = `its repo ${x.repoName} has no checkout here, or the wrong one: ${LINK_KINDS[l?.kind]?.fixHint(l, x.repoName) ?? `no repo link "${x.repoName}"`}`;
      blockers.push(`${x.name}: ${p}`);
      return { name: x.name, role: x.role, branch: x.branch, repo: x.repoName, readable: false, parked: phase?.to === 'parked', phase: phase?.to ?? null, problems: [p] };
    }
    // its branch, remote and handoff in its own repo (home's for a home ticket or a planner)
    const R = x.repo;
    const cause = phase?.to === 'parked' ? parkCauseAt(x.name, phase.created_at) : null;
    const local = R.resolveCommit(`refs/heads/${x.branch}`);
    const remote = R.resolveCommit(`refs/remotes/origin/${x.branch}`);
    const dirty = fs.existsSync(x.wt) ? workLines(git(['status', '--porcelain'], x.wt)) : [];
    const hc = remote ? handoffCommit(`refs/remotes/origin/${x.branch}`, x.name, R) : null;
    const handoffAt = hc ? hc.at : remote && R.git(['cat-file', '-e', `${remote}:${x.handoff}`]) !== null ? R.git(['log', '-1', '--format=%cI', remote, '--', x.handoff]) : null;
    const r = {
      name: x.name, role: x.role, branch: x.branch, ...(x.repoName === 'home' ? {} : { repo: x.repoName, readable: true }),
      parked: phase?.to === 'parked', phase: phase?.to ?? null,
      pushed: !!remote && (!local || local === remote), local, remote,
      clean: !dirty.length, uncommitted: dirty.slice(0, 20),
      handoff: !!handoffAt && (!cause || Date.parse(handoffAt) >= Date.parse(cause.at) - 60000), handoff_path: x.handoff, handoff_at: handoffAt,
    };
    r.problems = [
      !r.parked && (fm === 'drain' ? `still running (phase ${r.phase ?? 'none'}): a drain finishes in-flight work; wait for it to merge, or fleet park to stop it now` : `not parked (phase ${r.phase ?? 'none'})`),
      !remote ? `${x.branch} is not on origin: push it` : !r.pushed && `${x.branch} here (${local.slice(0, 12)}) is not what origin has (${remote.slice(0, 12)}): push it`,
      !r.clean && `${dirty.length} uncommitted change(s) in its worktree`,
      r.parked && !r.handoff && (handoffAt ? 'its handoff on origin is older than the park that stopped it' : `no handoff commit on origin/${x.branch} (devteam.mjs handoff in its worktree)`),
      ...recordsParkProblems(x),
    ].filter(Boolean);
    for (const p of r.problems) blockers.push(`${x.name}: ${p}`);
    return r;
  });

  // The live log has landed when every live file is on main as it is here. The one line that can't
  // land first is the act of merging the log itself (merge --chore log logs it after the merge):
  // git keeps that merge, so the line may stay behind.
  const live = liveLogDir();
  const files = fs.existsSync(live) ? fs.readdirSync(live).filter((f) => f.endsWith('.jsonl') && !isPlanFile(f)).sort() : [];
  const unlanded = [];
  let leftBehind = 0;
  const logMerge = (l) => { try { const o = JSON.parse(l); return o.type === 'act' && o.class === 'merge-chore' && /^merged chore-log at /.test(o.what ?? ''); } catch { return false; } };
  for (const f of files) {
    let text = readText(path.join(live, f)) ?? '';
    text = text.slice(0, text.lastIndexOf('\n') + 1);
    if (!text) continue;
    const shown = main && projectInRepo ? git(['show', `${main}:${projectRel}/log/${f}`]) : null;
    const landed = shown === null ? '' : `${shown}\n`;
    if (landed.startsWith(text)) continue;
    const have = new Set(landed.split('\n'));
    const extra = text.split('\n').filter((l) => l && !have.has(l));
    if (writerOfFile(f) === 'supervisor' && extra.every(logMerge)) { leftBehind += extra.length; continue; }
    unlanded.push({ file: f, lines: extra.length });
  }
  if (unlanded.length) blockers.push(`the live log is not on ${s.main_branch} yet (${unlanded.map((u) => `${u.file}: ${u.lines} line(s)`).join(', ')}): run log-sync, then merge --chore log`);

  // Spend is read from each harness's session logs on this machine: observe it before the log
  // lands. The supervisor's own session spends while it checks; what it spends after its last
  // observe-spend stays behind, so that is a warning, not a blocker.
  const pending = new Map();
  for (const it of spendItems().filter((x) => !x.logged)) pending.set(it.who, (pending.get(it.who) ?? 0) + it.usd);
  const spendOthers = [...pending].filter(([who]) => who !== 'supervisor').map(([who, usd]) => ({ who, usd: +usd.toFixed(2) }));
  if (spendOthers.length) blockers.push(`spend not yet in the log for ${spendOthers.map((x) => x.who).join(', ')}: run observe-spend, then log-sync and merge --chore log`);
  const supUsd = +(pending.get('supervisor') ?? 0).toFixed(2);
  if (supUsd) warnings.push(`the supervisor's own spend since its last observe-spend ($${supUsd}) stays in this machine's harness logs unless you observe-spend and land the log once more`);

  // The owner's review results live in run/questions until review result --commit puts them in their PR.
  const uncommitted = [];
  for (const q of questions().filter((x) => x.kind === 'review' && x.review && x.status === 'answered' && !x.declined && x.result?.sha256)) {
    const ticket = q.review.ref?.startsWith('ticket/') ? q.review.ref.slice('ticket/'.length) : null;
    const rels = [reviewResultRel(q.id, ticket), reviewResultRel(q.id, null)];
    const refs = [main, `refs/remotes/origin/${q.review.ref}`].filter((r) => r && resolveCommit(r));
    if (!refs.some((r) => rels.some((rel) => git(['cat-file', '-e', `${r}:${rel}`]) !== null))) uncommitted.push({ id: q.id, ref: q.review.ref, path: rels[0] });
  }
  for (const u of uncommitted) blockers.push(`the owner's review result ${u.id} is only in run/questions: in ${u.ref}'s worktree, review result ${u.id} --commit, then commit and push it`);
  const qdir = path.join(runDir, 'questions');
  const drafts = (fs.existsSync(qdir) ? fs.readdirSync(qdir) : []).filter((qid) => fs.existsSync(path.join(qdir, qid, 'draft.json')) && logGet(qid)?.type === 'question' && questionView(logGet(qid)).status === 'open');
  for (const qid of drafts) blockers.push(`the owner's saved draft of review ${qid} is only in run/questions: ask the owner to answer it (or send it back) before the move`);

  // The supervisor's handoff, on main, written since the drain; and nothing the agents keep outside
  // the repo changed after it (what the next supervisor needs from it is folded into the handoff).
  const sh0 = d ? supervisorHandoff(d.created_at ?? null) : null;
  const handoffOk = !!sh0;
  if (d && !handoffOk) blockers.push(`no supervisor handoff since the fleet ${fm}: write it and push it (devteam.mjs handoff --supervisor, the note on stdin)`);
  const memory = harnessMemoryFiles();
  const newer = handoffOk ? memory.filter((m) => m.mtime > Date.parse(sh0.at)) : [];
  if (newer.length) blockers.push(`agent memory outside the repo changed after the supervisor's handoff landed (${newer.map((m) => path.basename(m.path)).join(', ')}): fold what the next session needs into knowledge or the handoff, and land it again`);

  // Nothing else of value only here: files put in run/ by hand, and worktrees with work not on the remote.
  // run/recurring/ is the recurring runner's (its lock, tails and log): named here, as a fresh
  // process may not have run the runner's code that names it
  runPath('recurring');
  const loose = (fs.existsSync(runDir) ? fs.readdirSync(runDir) : []).filter((f) => !RUN_KNOWN.has(f) && !f.endsWith('.lock'));
  if (loose.length) blockers.push(`files in run/ the kit didn't make, which don't move: ${loose.join(', ')}: move what matters into ${projectRel}/ (a chore) and delete the rest`);
  // a check running now would be cut off by the move, its checkout and lock left behind
  const rl = recurringLock.read();
  if (recurringLock.live(rl)) blockers.push(`a recurring check is running (runner pid ${rl.pid}${rl.current?.name ? `, ${rl.current.name}` : ''}): wait for it to finish before the move`);
  const wtRoot = path.join(mainRoot, '.worktrees');
  const strays = [];
  for (const n of fs.existsSync(wtRoot) ? fs.readdirSync(wtRoot) : []) {
    const at = path.join(wtRoot, n);
    if (sessions.some((x) => x.name === n) || !fs.statSync(at).isDirectory()) continue;
    if (!fs.existsSync(path.join(at, '.git'))) { strays.push(`${n} (not a git worktree)`); continue; }
    const dirty = workLines(git(['status', '--porcelain'], at)).length;
    const unpushed = Number(git(['rev-list', '--count', 'HEAD', '--not', '--remotes'], at) ?? 0);
    if (dirty || unpushed) strays.push(`${n} (${[dirty && `${dirty} uncommitted`, unpushed && `${unpushed} commit(s) on no remote`].filter(Boolean).join(', ')})`);
  }
  if (strays.length) blockers.push(`worktrees holding work that isn't on the remote: ${strays.join('; ')}: push or land it, or remove the worktree`);
  // in every repo this machine can read: home's branches as before, another repo's named <repo>:<branch>
  const unpushedIn = (R) => (R.git(['for-each-ref', '--format=%(refname:short)', 'refs/heads']) ?? '').split('\n').filter(Boolean)
    .filter((b) => Number(R.git(['rev-list', '--count', b, '--not', '--remotes']) ?? 0) > 0 && R.git(['cherry', R.mainRef() ?? 'HEAD', b])?.split('\n').some((l) => l.startsWith('+')));
  const unpushedBranches = [...unpushedIn(repo('home')), ...readableLinks.flatMap((R) => unpushedIn(R).map((b) => `${R.name}:${b}`))];
  if (unpushedBranches.length) warnings.push(`local branches with commits on no remote (squash-merged ones show here too): ${unpushedBranches.join(', ')}: push any that still matter`);
  if ((git(['stash', 'list']) ?? '').trim()) warnings.push('git stash has entries; they stay here: commit what matters to a branch and push it');

  // What moves on its own (open PRs with the forge, owner questions with the log), listed so nothing surprises.
  const openQs = questions().filter((q) => q.status === 'open').map((q) => ({ id: q.id, question: q.question }));
  let prs = null;
  if (s.forge !== 'git') {
    const raw = repo('home').gh(['pr', 'list', '--state', 'open', '--json', 'number,title,headRefName,url']);
    try { prs = raw === null ? null : JSON.parse(raw); } catch { prs = null; }
    if (prs === null) warnings.push('gh could not list the open PRs');
  } else {
    const dir = path.join(runDir, 'pr');
    const texts = [];
    const walk = (at) => { for (const e of fs.existsSync(at) ? fs.readdirSync(at, { withFileTypes: true }) : []) { const p = path.join(at, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.md')) texts.push(path.relative(dir, p).replace(/\.md$/, '')); } };
    walk(dir);
    prs = texts.map((b) => ({ headRefName: b, title: (readText(path.join(dir, `${b}.md`)) ?? '').split('\n')[0].replace(/^# /, '') }));
    if (texts.length) warnings.push(`forge is git: the PR text for ${texts.join(', ')} is only in run/pr here; copy run/pr/ to the new machine`);
  }
  // each repo link on GitHub lists its own (forge git PR text is in home's run/pr, above)
  for (const R of readableLinks.filter((x) => x.settings.forge !== 'git')) {
    let theirs = null;
    try { theirs = JSON.parse(R.gh(['pr', 'list', '--state', 'open', '--json', 'number,title,headRefName,url']) ?? 'null'); } catch { theirs = null; }
    if (theirs === null) warnings.push(`gh could not list ${R.name}'s open PRs`);
    else prs = [...(prs ?? []), ...theirs.map((p) => ({ ...p, headRefName: `${R.name}:${p.headRefName}` }))];
  }

  // Every repo link: where its checkout is here. Only with repo links, so a single-repo
  // project's JSON and text are as before.
  const repos = repoLinks.map(([id, l]) => {
    const at = linkLocation(id);
    const readable = repoReadable(id);
    if (!readable) blockers.push(`${id}: ${LINK_KINDS[l.kind].fixHint(l, id)}`);
    return { id, remote: redactUrl(l.remote), path: at, found: fs.existsSync(at), readable };
  });
  const checklist = moveChecklist(s, memory);
  const ready = !blockers.length;
  const parity = ready ? parityPrint() : null;
  const recovery = supervisorRecovery(supervisorSessionId());
  // which machine supervises this repo (origin's claim): the one a move hands over
  const host = hostHolder({ fetch: !flags['no-fetch'] });
  if (fm && host.holder?.mine && !host.holder.fleet) warnings.push(`the claim on origin doesn't say this fleet is ${fm === 'park' ? 'parked' : 'drained'} yet (it couldn't be written), so the new machine waits until it lapses, 45 minutes after this one was last seen: run fleet ${fm} again once origin answers`);
  const r = { parity, ...(host.holder ? { host: host.holder } : {}), supervisor_handoff: sh0 ? { at: sh0.at, current: handoffOk } : null, fleet: fm ? { mode: fm, op: op?.fleet ?? legacy?.id ?? null, at: since, host: legacy ? drainHost(legacy) : op?.host ?? null, reason: legacy ? drainReason(legacy) : op?.reason ?? null } : null, sessions, log: { landed: !unlanded.length, unlanded, left_behind: leftBehind }, spend: { unobserved: spendOthers, supervisor_usd: supUsd }, reviews: { uncommitted, drafts }, open_prs: prs ?? [], open_questions: openQs, ...(repoLinks.length ? { repos } : {}), blockers, warnings, ready, checklist, ...(recovery ? { recovery } : {}), ...(fetchError ? { fetch_error: fetchError } : {}) };
  if (flags.json) return json(r);
  if (r.recovery) out(`recovery (to bring the supervisor back, from the main checkout): ${r.recovery}`);
  out(fm ? `${fm === 'park' ? 'parked' : 'draining'}${since ? ` since ${since}` : ''} (${r.fleet.op ?? 'every goal held one by one'}${r.fleet.host ? `, on ${r.fleet.host}` : ''})${r.fleet.reason ? `: ${r.fleet.reason}` : ''}` : 'neither parked nor drained');
  out(host.words);
  out(`\nsessions:${sessions.length ? '' : ' none'}`);
  for (const x of sessions) out(x.readable === false ? `  ${x.name.padEnd(28)} ${x.parked ? 'parked' : `NOT PARKED (${x.phase ?? '-'})`}  ${x.repo}: NO CHECKOUT HERE` : `  ${x.name.padEnd(28)} ${x.parked ? 'parked' : fm === 'drain' ? `STILL RUNNING (${x.phase ?? '-'})` : `NOT PARKED (${x.phase ?? '-'})`}  ${x.pushed ? 'pushed' : 'NOT PUSHED'}  ${x.clean ? 'clean' : 'UNCOMMITTED'}  ${x.handoff ? 'handoff' : 'NO HANDOFF'}${x.repo ? `  (${x.repo})` : ''}`);
  if (repoLinks.length) { out('\nrepos:'); for (const x of repos) out(`  ${x.id.padEnd(28)} ${x.remote} at ${x.path}  ${x.readable ? 'found' : x.found ? 'WRONG CHECKOUT' : 'MISSING'}`); }
  out(`\nlog: ${unlanded.length ? `not landed (${unlanded.map((u) => u.file).join(', ')}): run log-sync, then merge --chore log` : `on ${s.main_branch}`}${leftBehind ? " (the log's own merge act stays behind; git keeps the merge)" : ''}`);
  out(`spend: ${spendOthers.length ? `not yet observed for ${spendOthers.map((x) => `${x.who} $${x.usd}`).join(', ')}` : 'observed up to now'}${supUsd ? `; the supervisor's own $${supUsd} since its last observe-spend` : ''}`);
  out(`review results: ${uncommitted.length ? uncommitted.map((u) => `${u.id} not committed to ${u.ref}`).join('; ') : 'all in their PRs'}${drafts.length ? `; drafts that won't move: ${drafts.join(', ')}` : ''}`);
  out(`open PRs (they stay on the forge): ${prs?.length ? prs.map((p) => `${p.number ? `#${p.number} ` : ''}${p.headRefName}`).join(', ') : prs === null ? 'unknown' : 'none'}`);
  out(`open owner questions (they move with the log): ${openQs.length ? openQs.map((q) => `${q.id} "${q.question.slice(0, 60)}"`).join('; ') : 'none'}`);
  if (blockers.length) { out('\nleft to do:'); for (const b of blockers) out(`  - ${b}`); }
  if (warnings.length) { out('\nwarnings:'); for (const w of warnings) out(`  - ${w}`); }
  if (fm && !movingFleet()) out(`\n${fm === 'park' ? 'parked' : 'draining'} as a pause on this machine, not a move (its claim stays here); to move it, ${op ? `fleet ${fm} --move` : `make it a fleet op first (fleet unpark, or the owner lifts each goal's own hold), then fleet ${fm} --move`}`);
  out(`\nready to move: ${ready ? 'yes' : 'no'}`);
  if (parity) out(`parity: ${parity.hash} (${parity.lines} log entries). fleet un${fm} on the new machine prints its own before it writes anything; they match when the move is 1:1. Stop now: anything you log from here on stays on this machine.`);
  out('\nnew-machine checklist:');
  checklist.forEach((c, i) => out(`  ${i + 1}. ${c}`));
}

// The new machine's steps, from the settings and the log: what git doesn't carry.
export function moveChecklist(s, memory = []) {
  const url = redactUrl(git(['remote', 'get-url', 'origin']) ?? '<the repo>');
  const pins = ['.tool-versions', '.nvmrc', '.node-version'].filter((f) => fs.existsSync(path.join(mainRoot, f)));
  const agent = (s.agent_command ?? '').trim().split(/\s+/)[0] || 'the agent CLI';
  const keys = new Map();
  const commands = new Set();
  for (const q of questions()) for (const x of q.secrets ?? []) {
    let k;
    try { k = parseSink(x.sink, { soft: true }); } catch { continue; }
    if (k.type === 'file') keys.set(k.file, `${k.file} (where ${x.name} was posted)`);
    else if (k.type === 'rails-credentials') { const f = k.env === 'default' ? 'config/master.key' : `config/credentials/${k.env}.key`; if (fs.existsSync(path.join(mainRoot, f))) keys.set(f, `${f} (decrypts the ${k.env} Rails credentials)`); }
    else if (k.type === 'sops') keys.set(`sops:${k.file}`, `the SOPS key (age or PGP) that decrypts ${k.file}`);
    else if (k.type === 'stdin') commands.add(k.argv.slice(0, 2).join(' '));
  }
  const files = (s.worktree_files ?? []).filter((f) => !keys.has(f));
  // each repo link cloned where its path says (its checkout's own origin when it is here)
  const siblings = Object.entries(s.links ?? {}).filter(([, l]) => LINK_KINDS[l?.kind]?.hostsComponents).map(([id, l]) => {
    const from = redactUrl((repoReadable(id) ? git(['config', '--get', 'remote.origin.url'], linkLocation(id)) : null) ?? l.remote);
    return `clone ${redactUrl(l.remote)}: git clone ${shq(from)} ${shq(linkLocation(id))} (where settings path says)`;
  });
  return [
    `clone the repo: git clone ${url}, and cd into it`,
    ...siblings,
    ...(fs.existsSync(LINKS_LOCAL) ? ['this machine kept its own checkout paths in run/links.local.json (it doesn\'t move): on the new machine, clone where settings say, or write run/links.local.json there with that machine\'s paths'] : []),
    pins.length ? `install the pinned tools from ${pins.join(', ')} (asdf: asdf install)` : 'install Node 18 or newer',
    `install git, tmux${s.forge === 'git' ? '' : ', the GitHub CLI'} and ${agent} with superpowers; log in to ${agent}${s.forge === 'git' ? '' : ' and gh (gh auth login)'}`,
    ...(files.length ? [`copy these gitignored files from the old checkout over a secure channel (never git, chat or the log): ${files.join(', ')}`] : []),
    ...(keys.size ? [`copy the keys the secret sinks need, the same way: ${[...keys.values()].join('; ')}`] : []),
    ...(commands.size ? [`log in to the commands that take posted secrets: ${[...commands].join(', ')}`] : []),
    ...(s.forge === 'git' ? ['copy run/pr/ from the old checkout (forge git keeps the PR text there)'] : []),
    ...(memory.length ? [`your agent's own memory for this project (${memory.length} file(s) under ${path.dirname(path.dirname(memory[0].path))}) isn't in the repo; the supervisor folded what the next session needs into knowledge and its handoff, so nothing to copy`] : []),
    `start the supervisor in the repo: open ${agent} there and say "Assume the role of the devteam supervisor and resume the fleet" (or step 9's command: DEVTEAM_ROLE=supervisor ${agent} "$(node docs/devteam/scripts/devteam.mjs prompt supervisor)"); tmux need only be installed: the workers get a tmux session of their own`,
    'the supervisor runs fleet unpark, or fleet undrain for a drained fleet (it rebuilds run/log from the landed log, prints the parity fingerprint, puts every goal back as it was) and restarts each parked session with the command it prints',
    'in the browser you use there: open the hub and turn on "Notify me of new Inbox items" again (a browser setting)',
    `restart the dashboard where it outlives the session: tmux new-window -d -t '=${tmuxSession()}' -n dashboard 'node docs/devteam/scripts/devteam.mjs dashboard' (or another terminal), then open the hub, http://127.0.0.1:${HUB_PORT}, which lists every instance on the machine (or the address the dashboard prints)`,
  ];
}

// fleet undrain | unpark: on any machine (after cloning, for a move). Rebuild run/log from the
// landed log if it is empty, take the parity fingerprint before writing anything, put back each
// goal the fleet op changed (and the owner hasn't changed since), and say how to restart the
// sessions that may run again. An old drain act still in force is lifted by unpark.
export function fleetUndo(mode) {
  const by = fleetWriter();
  if (!commonDir || !projectInRepo) die(`fleet un${mode} needs a git checkout with the project folder inside it`);
  if (repoRoot !== mainRoot) die(`run it from the main checkout (${mainRoot})`);
  git(['fetch', '--quiet', 'origin']);
  mainRefCache = undefined;
  // the supervisor resuming is a start: never while another machine supervises this repo. The
  // owner's unpark starts no supervisor here, so it leaves the claim to the supervisor's tick
  const hc = by === 'supervisor' ? hostCheck({ start: true }) : {};
  if (hc.refused) die(`fleet un${mode}: not here. ${hc.refused}`);
  const live = liveLogDir();
  if (!(fs.existsSync(live) && fs.readdirSync(live).some((f) => f.endsWith('.jsonl')))) {
    const main = mainRef() ?? die('no main branch to rebuild run/log from');
    const files = (git(['ls-tree', '--name-only', `${main}:${projectRel}/log`]) ?? '').split('\n').filter((f) => f.endsWith('.jsonl') && !isPlanFile(f));
    fs.mkdirSync(live, { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(live, f), `${git(['show', `${main}:${projectRel}/log/${f}`])}\n`);
    logCache = null;
    out(`run/log was empty: rebuilt ${files.length} file(s) from ${projectRel}/log on ${main}`);
  }
  const legacy = mode === 'park' ? draining() : null;
  const held = holdableGoals().filter((g) => g.hold?.fleet && g.hold.mode === mode);
  const op = held.map((g) => g.hold.fleet).sort().pop() ?? null;
  const oneByOne = !op && !legacy && fleetMode() === mode;
  if (!op && !legacy && !oneByOne) die(`no fleet ${mode} is in force (no goal holds a fleet op's ${mode}). If the fleet was ${mode === 'park' ? 'parked' : 'drained'} on another machine, land its log there first: log-sync, then merge --chore log`);
  if (oneByOne) out(`every goal was ${mode === 'park' ? 'parked' : 'drained'} one by one, not by a fleet op: nothing to put back here; set each goal with its toggle (goal hold <id> run)`);
  if (legacy && by !== 'supervisor') die('an old drain is in force; the supervisor lifts it (fleet unpark, as the supervisor)');
  const parity = parityPrint();
  const host = os.hostname();
  const restored = [];
  for (const g of held.filter((x) => x.hold.fleet === op)) {
    const p = g.hold.prior ?? { mode: 'run' };
    // a supervisor's own drain comes back with its cause: the line that set it is the latest hold
    // line before this op's (a park then a park --move writes two)
    let extra = {};
    if (p.mode === 'drain' && !p.fleet) {
      const u = [...(g.updates ?? [])].reverse().find((x) => x.hold && x.hold.fleet !== op);
      if (u?.hold.mode === 'drain' && !u.hold.fleet && u.hold_for) extra = { hold_for: u.hold_for, hold_until: u.hold_until ?? null };
    }
    writeHold(g, { mode: p.mode, ...(p.reason ? { reason: p.reason } : {}), ...(p.fleet ? { fleet: p.fleet } : {}), undoes: op, host }, by, extra);
    restored.push(`${isUpkeep(g) ? 'Upkeep' : g.title} → ${p.mode}`);
  }
  if (legacy) appendLog({ type: 'act', class: 'undrain', what: `undrained the fleet on ${host} (drained by ${legacy.id}${drainHost(legacy) ? ` on ${drainHost(legacy)}` : ''})`, refs: [legacy.id], reversible: true }, 'supervisor');
  if (op && by === 'supervisor') appendLog({ type: 'act', decision: citing(), class: `fleet-un${mode}`, what: `un${mode === 'park' ? 'parked' : 'drained'} the fleet on ${host} (${op})`, refs: held.filter((x) => x.hold.fleet === op && !isUpkeep(x)).map((x) => x.id), reversible: true }, 'supervisor');
  logCache = null;
  out(`un${mode === 'park' ? 'parked' : 'drained'} the fleet${op ? ` (${op})` : ''}${legacy ? `, and lifted the old drain ${legacy.id}` : ''}: ${restored.length ? restored.join('; ') : 'no goal to put back'}`);
  // the claim no longer says held for a move
  if (by === 'supervisor') hostCheck();
  const rows = restartCommands().map((x) => `  devteam.mjs ${x.cmd.padEnd(36)} ${x.handoff ? 'its handoff note goes into its prompt' : 'no current handoff note'}`);
  const hint = rows.length ? pinsHint() : null;
  if (hint) out(`before restarting anything: ${hint}`);
  out(rows.length ? `restart the parked sessions that may run again, as the supervisor:\n${rows.join('\n')}` : 'no parked session to restart');
  const stillParked = liveSessions().filter((x) => lastPhaseOf(x.name)?.to === 'parked' && ['park', 'let-go'].includes(sessionMode(x.name))).map((x) => x.name);
  if (stillParked.length) out(`still parked, because their goal is: ${stillParked.join(', ')}`);
  out('then make sure the dashboard is running (supervisor.md §11)');
  out(`parity: ${parity.hash} (${parity.lines} log entries), taken before this wrote anything: fleet status printed the same on the old machine when the move is 1:1`);
  const at = op ? fleetAt(op) : legacy?.created_at;
  const sh0 = at || oneByOne ? supervisorHandoff(at ?? null) : null;
  if (sh0) out(`\n## Handoff from the previous supervisor (${sh0.rel}, ${sh0.at})\n\n${sh0.text.trimEnd()}\n\nRead it before anything else; it stays in the repo as the record.`);
  else if (mode === 'park') out('\nno supervisor handoff from this park (no devteam-handoff tag on origin since it)');
}

// The supervisor's prompt while the fleet is parked or draining: what to do first.
export function drainedPreface() {
  const legacy = draining();
  const fm = fleetMode();
  if (!legacy && !fm) return null;
  const op = fleetOpInForce();
  const host = legacy ? drainHost(legacy) : op?.host ?? null;
  const what = legacy ? `drained by an old drain (${legacy.id}, ${legacy.created_at}: ${drainReason(legacy)})` : `${fm === 'park' ? 'parked' : 'draining'}${op ? ` (${op.fleet}${op.reason ? `: ${op.reason}` : ''})` : ' (every goal is held)'}`;
  if (fm === 'drain' && !legacy) return `The fleet is ${what}${host ? `, set on ${host}` : ''}: every goal is draining, so in-flight work finishes and merges and nothing new starts. Carry on with what is running${movingFleet() ? '; fleet status says "ready to move" once nothing is' : ''}. fleet undrain lifts it.`;
  // a pause, not a move: this machine keeps supervising, and nothing here is about moving
  if (!legacy && !movingFleet()) return `The fleet is ${what}${host ? `, on ${host}` : ''}: a pause on this machine, not a move (the owner may be throttling spend or waiting on something). Start no ticket and no planner. Keep the loop: observe, answer threads and messages, keep questions and the log current. Resume when the owner unparks it, or says to (fleet unpark). Moving machines is fleet park --move (supervisor.md §12).`;
  // A checkout with no live log is a fresh clone; hostnames repeat (a default laptop name), so a
  // matching one counts only where run/log is still there.
  const liveHere = fs.existsSync(liveLogDir()) && fs.readdirSync(liveLogDir()).some((f) => f.endsWith('.jsonl'));
  const here = liveHere && (!host || host === os.hostname());
  return `The fleet is ${what}${host ? `, on ${host}` : ''}. ${here
    ? 'This is the machine it was parked on. If a move is under way, carry on with it (supervisor.md §12): node docs/devteam/scripts/devteam.mjs fleet status until it says "ready to move", landing the log with log-sync and merge --chore log; start nothing. Run fleet unpark here only if the owner says to resume on this machine.'
    : `This looks like the machine it moved to. Before anything else: ${(() => { const h = pinsHint(); return h ? `(0) ${h}; ` : ''; })()}(1) DEVTEAM_ROLE=supervisor node docs/devteam/scripts/devteam.mjs fleet unpark (it rebuilds run/log from the landed log, prints the parity fingerprint, puts every goal back as it was and prints the restart command for each parked session); (2) run each of those commands; (3) make sure the dashboard is running (supervisor.md §11) and tell the owner its address; then carry on from supervisor.md §1.`}`;
}

