/* imports start */
import fs from 'node:fs';
import path from 'node:path';
import { FULL_SHA } from './base.mjs';
import { HOME_CWD } from './base.mjs';
import { LINK_KINDS } from './links.mjs';
import { ancestorOf } from './base.mjs';
import { commitDateOf } from './base.mjs';
import { commonDir } from './state.mjs';
import { commonOf } from './state.mjs';
import { componentLink } from './links.mjs';
import { cwdCommon } from './state.mjs';
import { cwdGit } from './base.mjs';
import { cwdIsHome } from './state.mjs';
import { devteamLine } from './links.mjs';
import { die } from './base.mjs';
import { factGet } from './base.mjs';
import { factSet } from './base.mjs';
import { git } from './base.mjs';
import { gitCommonDirOf } from './base.mjs';
import { gitFacts } from './reviews.mjs';
import { gitOrDie } from './base.mjs';
import { gitReadCache } from './base.mjs';
import { gitRun } from './reviews.mjs';
import { gitStatus } from './base.mjs';
import { homeFacts } from './reviews.mjs';
import { isObj } from './artifact-notes.mjs';
import { kitRel } from './links.mjs';
import { linkLocation } from './links.mjs';
import { loadSettings } from './settings.mjs';
import { mainRef } from './log.mjs';
import { mainRefCache } from './log.mjs';
import { mainRoot } from './state.mjs';
import { mainSettings } from './reviews.mjs';
import { mainSha } from './log.mjs';
import { memo } from './graph.mjs';
import { ownEntry } from './artifact-notes.mjs';
import { prefetchAt } from './base.mjs';
import { projectDir } from './state.mjs';
import { projectInRepo } from './settings.mjs';
import { projectRel } from './settings.mjs';
import { readText } from './base.mjs';
import { realPath } from './state.mjs';
import { redactUrl } from './links.mjs';
import { releasedInAt } from './base.mjs';
import { remoteKey } from './links.mjs';
import { resolveCommit } from './log-sync.mjs';
import { rest } from './base.mjs';
import { sh } from './base.mjs';
import { shallowOf } from './base.mjs';
import { showAt } from './base.mjs';
import { tickets } from './graph.mjs';
import { warn } from './base.mjs';
/* imports end */
// Pure readers of a repo's main, shared by home's functions below and each repo link's (repo()).
export const parseMainLog = (o) => (o ? o.split('\n') : []).filter(Boolean).map((l) => { const [sha, ...r] = l.split('\t'); return { sha, subject: r.join('\t') }; });
export const parseParents = (o) => (o ? o.split('\n') : []).filter(Boolean).map((l) => l.split(' '));
// The commit on main that landed a ticket, for any repo: a merge from ticket/<id>, a squash titled
// "<id>: …", or a merge whose second parent contains the branch tip and whose first parent does not.
export function findMergeSha(id, { log, parents, resolve, ancestor, ref, landings }) {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fromBranch = new RegExp(`from \\S*ticket/${esc}$`);
  for (const { sha, subject } of log()) if (fromBranch.test(subject) || subject.startsWith(`${id}:`)) return sha;
  if (!ref) return null;
  const refSha = resolve(ref);
  for (const r of [`refs/heads/ticket/${id}`, `refs/remotes/origin/ticket/${id}`]) {
    const tip = resolve(r);
    if (!tip) continue;
    // a read-only command answers from one walk of main's history (mainLandings)
    const walked = landings?.(refSha);
    if (walked) {
      const by = walked.get(tip);
      if (by && parents().some(([sha, , p2]) => sha === by && p2)) return by;
      continue;
    }
    if (ancestor(tip, refSha) !== true) continue;
    for (const [sha, p1, p2] of parents()) {
      if (p2 && ancestor(tip, p2) === true && ancestor(tip, p1) !== true) return sha;
    }
  }
  return null;
}

// For a read-only command: every commit in main's history, with the first-parent merge whose second
// parent brought it in (null for a commit on the first-parent line, or one only a later parent of an
// octopus brought). One rev-list in place of an ancestor check per ticket per merge. Null when git
// can't list it, and the caller asks commit by commit.
export let landingsMemo = null;
export function mainLandings(sha, cwd = HOME_CWD) {
  if (!gitReadCache || !FULL_SHA.test(sha ?? '')) return null;
  if (landingsMemo?.cache !== gitReadCache) landingsMemo = { cache: gitReadCache, m: new Map() };
  const k = `${gitCommonDirOf(cwd)}\0${sha}`;
  if (landingsMemo.m.has(k)) return landingsMemo.m.get(k);
  const o = git(['rev-list', '--parents', sha], cwd);
  let by = null;
  if (o !== null) {
    const ps = new Map(o.split('\n').filter(Boolean).map((l) => { const [c, ...p] = l.split(' '); return [c, p]; }));
    const line = [];
    for (let c = sha; c && ps.has(c); c = ps.get(c)[0]) line.push(c);
    by = new Map();
    const walk = (from, label) => {
      const todo = [from];
      while (todo.length) {
        const c = todo.pop();
        if (by.has(c) || !ps.has(c)) continue;
        by.set(c, label);
        todo.push(...ps.get(c));
      }
    };
    for (const c of line.reverse()) {
      by.set(c, null);
      const [, second, ...rest] = ps.get(c);
      if (second) walk(second, c);
      for (const x of rest) walk(x, null);
    }
  }
  landingsMemo.m.set(k, by);
  return by;
}
export let mainLogCache;
export function mainLog() {
  if (mainLogCache) return mainLogCache;
  const ref = mainRef();
  // First-parent only: merge and squash commits are on it; a branch's own commits are not.
  return (mainLogCache = parseMainLog(ref ? git(['log', ref, '--first-parent', '--format=%H%x09%s']) : null));
}
export let mergeParentsCache;
export function mergeParents() {
  if (mergeParentsCache) return mergeParentsCache;
  const ref = mainRef();
  return (mergeParentsCache = parseParents(ref ? git(['log', ref, '--merges', '--first-parent', '-n', '500', '--format=%H %P']) : null));
}
export function homeTicketBranchRef(id) {
  for (const r of [`refs/heads/ticket/${id}`, `refs/remotes/origin/ticket/${id}`]) if (resolveCommit(r)) return r;
  return null;
}
export const mergeShaCache = new Map();
export function homeMergeShaFor(id) {
  if (mergeShaCache.has(id)) return mergeShaCache.get(id);
  const v = findMergeSha(id, { log: mainLog, parents: mergeParents, resolve: resolveCommit, ancestor: (a, b) => ancestorOf(a, b), ref: mainRef(), landings: (x) => mainLandings(x) });
  mergeShaCache.set(id, v);
  return v;
}
// When a finding first reached home's main: the commit time of the first commit on main whose kit
// script added its token (a sync chore's commit, in a project). A finding about merges reads only
// merges after it, so an upgrade raises nothing for history the kit couldn't have refused. Null
// when the kit isn't tracked on main.
export const upgradeAtCache = new Map();
export function upgradeAt(token) {
  if (upgradeAtCache.has(token)) return upgradeAtCache.get(token);
  const ref = mainRef();
  const file = `${kitRel ? `${kitRel}/` : ''}scripts/devteam.mjs`;
  // fixed for main's commit, so kept across processes (a search of main's whole history)
  const sha = ref && !kitRel.startsWith('..') ? mainSha() : null;
  const k = sha ? `u\0${gitCommonDirOf()}\0${shallowOf()}\0${sha}\0${file}\0${token}` : null;
  let at = k ? factGet(k) : null;
  if (k && at === undefined) {
    const r = gitStatus(['log', '--reverse', '--format=%ct', `-S${token}`, sha, '--', file]);
    const rows = r.status === 0 ? r.stdout.toString('utf8').split('\n').filter(Boolean) : null;
    at = rows?.length ? Number(rows[0]) * 1000 : null;
    if (rows) factSet(k, at);
  }
  at ??= null;
  upgradeAtCache.set(token, at);
  return at;
}
export const mergedAtCache = new Map();
export function homeMergedAt(id) {
  if (!mergedAtCache.has(id)) {
    const sha = homeMergeShaFor(id);
    const t = sha ? commitDateOf(sha) : NaN;
    mergedAtCache.set(id, Number.isNaN(t) ? null : t);
  }
  return mergedAtCache.get(id);
}
export const homeReleasedIn = (sha, pattern) => releasedInAt(sha, pattern);
// Read a project file from a git ref (a ticket's branch, an exact head) or the working tree.
export function srcRead(src, rel) {
  if (src.repo && src.repo.name !== 'home') return src.repo.srcRead(src.ref ?? null, rel);
  if (src.ref && projectInRepo) { const sha = refAt(src.ref); return sha ? showAt(sha, `${projectRel}/${rel}`) : git(['show', `${src.ref}:${projectRel}/${rel}`]); }
  return readText(path.join(projectDir, rel));
}
// A ref as the commit it names, where that costs no git call of its own: a read-only command's ref
// listing, or a ref that is already a full sha. Else null, and the caller asks by name, as before.
export const refAt = (ref, resolve = resolveCommit) => (FULL_SHA.test(ref) ? ref : gitReadCache ? resolve(ref) : null);
// A folder listed at a ref: its files are read at once, all in one git call, at the commit the ref
// named (a dashboard refresh read each ticket branch's review files one call each).
export function listAndPrefetch(ref, dirPath, gitFn, cwd, resolve) {
  const sha = refAt(ref, resolve);
  // the index holds paths as git lists them; a link's project may be spelled ./docs/proj or .
  const index = sha && path.posix.normalize(dirPath) === dirPath ? treeIndexAt(sha, cwd) : null;
  if (index) {
    // every ticket's reviews at this commit in one read, the first time one ticket's are asked for
    const m = /^(.*\/tickets\/)[^/]+\/reviews$/.exec(dirPath);
    if (m && !index.fetched.has(m[1])) {
      index.fetched.add(m[1]);
      const inReviews = new RegExp(`^${m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^/]+/reviews/[^/]+\\.md$`);
      prefetchAt(sha, [...index.paths].filter((p) => inReviews.test(p)), cwd);
    }
    const names = index.children.get(dirPath) ?? [];
    if (names.length) prefetchAt(sha, names.map((n) => `${dirPath}/${n}`), cwd);
    return names;
  }
  const names = (gitFn(['ls-tree', '--full-tree', '-z', '--name-only', `${ref}:${dirPath}`]) ?? '').split('\0').filter(Boolean);
  if (sha && names.length) prefetchAt(sha, names.map((n) => `${dirPath}/${n}`), cwd);
  return names;
}
// For a read-only command: a commit's whole tree from one ls-tree, built the second time a command
// asks about that commit (so a branch read once costs what it did). Null otherwise.
export let treeIndexes = null;
export function treeIndexAt(sha, cwd = HOME_CWD) {
  if (!gitReadCache) return null;
  if (treeIndexes?.cache !== gitReadCache) treeIndexes = { cache: gitReadCache, m: new Map() };
  const k = `${gitCommonDirOf(cwd)}\0${sha}`;
  const had = treeIndexes.m.get(k);
  if (had !== undefined && had !== 'seen') return had;
  if (had === undefined) { treeIndexes.m.set(k, 'seen'); return null; }
  const o = git(['ls-tree', '--full-tree', '-r', '-t', '-z', '--name-only', sha], cwd);
  let index = null;
  if (o !== null) {
    const paths = new Set(o.split('\0').filter(Boolean));
    const children = new Map();
    for (const p of paths) {
      const at = p.lastIndexOf('/');
      if (at === -1) continue;
      const d = p.slice(0, at);
      if (!children.has(d)) children.set(d, []);
      children.get(d).push(p.slice(at + 1));
    }
    index = { paths, children, fetched: new Set() };
  }
  treeIndexes.m.set(k, index);
  return index;
}
// Whether a path is in a commit, as `git cat-file -e <ref>:<path>` says: from the tree index once a
// read-only command has one.
export function hasPathAt(ref, p, cwd = HOME_CWD) {
  const sha = refAt(ref);
  const index = sha && path.posix.normalize(p) === p ? treeIndexAt(sha, cwd) : null;
  return index ? index.paths.has(p) : git(['cat-file', '-e', `${ref}:${p}`], cwd) !== null;
}
export function srcList(src, relDir) {
  if (src.repo && src.repo.name !== 'home') return src.repo.srcList(src.ref ?? null, relDir);
  if (src.ref && projectInRepo) return listAndPrefetch(src.ref, `${projectRel}/${relDir}`, (a) => git(a), HOME_CWD, resolveCommit);
  const p = path.join(projectDir, relDir);
  return fs.existsSync(p) ? fs.readdirSync(p) : [];
}
export const WORKTREE = { ref: null };
// A project file from this checkout, or main's copy when this checkout lacks it.
export const projectFileText = (rel) => readText(path.join(projectDir, rel)) ?? (projectInRepo && mainRef() ? git(['show', `${mainRef()}:${projectRel}/${rel}`]) : null);

// ===== 4b. repos: home and each repo link, one object each =====

// The repo a sibling's GitHub CLI call names (-R): owner/name, or host/owner/name on GitHub
// Enterprise; null for a remote gh can't name (a path, a non-GitHub host), where gh then runs in
// the checkout. Home's calls name none: gh resolves home as it always has (gh repo set-default,
// else the only remote), which need not be origin.
export const ghSpec = (remote) => {
  const k = remoteKey(remote ?? '');
  if (/^[\w.-]+\/[\w.-]+$/.test(k)) return k;
  const m = /^https:\/\/([^/@]+)\/([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(String(remote ?? ''));
  return m ? `${m[1]}/${m[2]}` : null;
};
// One object per repo, made once. Home's is the module's own helpers, so a single-repo project
// runs exactly today's code; a link's binds git and gh to its checkout and keeps its own caches.
export const repoMemo = new Map();
export function repo(name = 'home') {
  if (!repoMemo.has(name)) repoMemo.set(name, name === 'home' ? homeRepo() : linkRepo(name));
  return repoMemo.get(name);
}
// Home's object is homeFacts (name, the three tree reads, mainRef, devteamLine, settings)
// plus the rest, so every coverage helper that defaulted to homeFacts gets the same answers.
export function homeRepo() {
  return Object.assign(Object.create(homeFacts), {
    root: mainRoot, commonDir, projectRel, projectInRepo,
    get remote() { return git(['config', '--get', 'remote.origin.url']); },
    resolveCommit,
    git: (args, cwd) => git(args, cwd),
    gitOrDie: (args, cwd) => gitOrDie(args, cwd),
    gh: (args, opts = {}) => sh('gh', args, opts),
    mergeShaFor: homeMergeShaFor, mergedAt: homeMergedAt, ticketBranchRef: homeTicketBranchRef, releasedIn: homeReleasedIn,
    srcRead: (ref, rel) => srcRead({ ref }, rel), srcList: (ref, relDir) => srcList({ ref }, relDir),
    resetCaches: () => { mainRefCache = undefined; mainLogCache = undefined; mergeParentsCache = undefined; mergeShaCache.clear(); mergedAtCache.clear(); },
  });
}
export function linkRepo(id) {
  const s = loadSettings();
  const l = ownEntry(s.links, id);
  if (!l || !LINK_KINDS[l.kind]?.hostsComponents) die(`no repo link "${id}" in settings links (devteam.mjs links)`);
  const at = linkLocation(id);
  if (!fs.existsSync(at)) die(`repo ${id}: no checkout at ${at}; clone ${redactUrl(l.remote)} there, set its path, or name this machine's in run/links.local.json`);
  const origin = git(['config', '--get', 'remote.origin.url'], at);
  if (!origin || remoteKey(origin) !== remoteKey(l.remote)) die(`repo ${id}: ${at} is a checkout of ${origin ? redactUrl(origin) : 'nothing'}, not ${redactUrl(l.remote)}`);
  const common = commonOf(at);
  const root = path.dirname(common);
  const settings = LINK_KINDS[l.kind].effectiveSettings(l, s);
  const rel = settings.project;
  const g = (args, cwd = root) => git(args, cwd);
  const c = { mainRef: undefined, log: null, parents: null, mergeSha: new Map(), mergedAt: new Map() };
  const resolve = (ref) => resolveCommit(ref, root);
  const mainRefR = () => { if (c.mainRef === undefined) c.mainRef = [`origin/${settings.main_branch}`, settings.main_branch].find((r) => resolve(r)) ?? null; return c.mainRef; };
  const log = () => (c.log ??= parseMainLog(mainRefR() ? g(['log', mainRefR(), '--first-parent', '--format=%H%x09%s']) : null));
  const parents = () => (c.parents ??= parseParents(mainRefR() ? g(['log', mainRefR(), '--merges', '--first-parent', '-n', '500', '--format=%H %P']) : null));
  const R = {
    name: id, root, commonDir: common, remote: l.remote, settings, projectRel: rel, projectInRepo: true,
    mainRef: mainRefR, resolveCommit: resolve,
    // the same three tree reads home has (gitFacts), bound to this checkout
    ...gitFacts(g, (args) => gitRun(args, root)),
    git: g, gitOrDie: (args, cwd = root) => gitOrDie(args, cwd),
    gh: (args, opts = {}) => { const spec = ghSpec(l.remote); return sh('gh', [...args, ...(spec ? ['-R', spec] : [])], { cwd: root, ...opts }); },
    mergeShaFor: (tid) => { if (!c.mergeSha.has(tid)) c.mergeSha.set(tid, findMergeSha(tid, { log, parents, resolve, ancestor: (a, b) => ancestorOf(a, b, root), ref: mainRefR(), landings: (x) => mainLandings(x, root) })); return c.mergeSha.get(tid); },
    mergedAt: (tid) => { if (!c.mergedAt.has(tid)) { const sha = R.mergeShaFor(tid); const t = sha ? commitDateOf(sha, root) : NaN; c.mergedAt.set(tid, Number.isNaN(t) ? null : t); } return c.mergedAt.get(tid); },
    ticketBranchRef: (tid) => [`refs/heads/ticket/${tid}`, `refs/remotes/origin/ticket/${tid}`].find((r) => resolve(r)) ?? null,
    releasedIn: (sha, pattern) => releasedInAt(sha, pattern, root),
    srcRead: (ref, relPath) => { const at = ref ?? mainRefR(); if (!at) return null; const sha = refAt(at, resolve); return sha ? showAt(sha, `${rel}/${relPath}`, root) : g(['show', `${at}:${rel}/${relPath}`]); },
    srcList: (ref, relDir) => (ref ?? mainRefR() ? listAndPrefetch(ref ?? mainRefR(), `${rel}/${relDir}`, g, root, resolve) : []),
    resetCaches: () => { c.mainRef = undefined; c.log = null; c.parents = null; c.mergeSha.clear(); c.mergedAt.clear(); },
    // in another repo the kit's line is only its project folder, where tickets keep their records
    devteamLine: () => [`${rel}/**`],
  };
  return R;
}
// The components that route a ticket to its repo: main's, committed.
export const committedComponents = () => memo('committedComponents', () => mainSettings(null) ?? loadSettings());
// Two routers. By name, for views: never touches a checkout, never fails.
export const repoOfTicketLink = (t) => componentLink(t.component, committedComponents());
// Whether a repo can be read on this machine, without failing: home always; a link when its
// checkout is where it says and of its remote (the repo kind's reachable, memoized per process).
export const repoReadable = (name) => { if (name === 'home') return true; const l = ownEntry(loadSettings().links, name); return !!LINK_KINDS[l?.kind]?.hostsComponents && !LINK_KINDS[l.kind].reachable(l, name); };
// By object, for acts on one ticket: fails fast with one message when the checkout is wrong.
export const repoOfTicket = (t) => repo(repoOfTicketLink(t));
export const repoOfTicketId = (id) => { const t = tickets().get(id); return t ? repoOfTicket(t) : repo('home'); };
// Whether a ticket's repo link says records "home". Read from main's committed settings, like the
// routing above, so a working tree's edit changes nothing until it lands.
export function recordsHomeSetting(t) {
  const name = t ? repoOfTicketLink(t) : 'home';
  if (name === 'home') return false;
  const s = committedComponents();
  const l = ownEntry(s.links, name);
  return LINK_KINDS[l?.kind]?.effectiveSettings(l, s)?.records === 'home';
}
// The ticket folders in a project's tickets/ at a ref: one ls-tree per log read, not one cat-file
// per ticket (a dashboard asks for every ticket).
export const ticketFoldersAt = (ref, rel, g) => new Set(ref ? (g(['ls-tree', '--full-tree', '-z', '--name-only', `${ref}:${rel}/tickets`]) ?? '').split('\0').filter(Boolean) : []);
export const homeTicketFolders = (ref) => memo(`homeTicketFolders:${ref}`, () => ticketFoldersAt(ref, projectRel, git));
export const linkTicketFolders = (R) => memo(`linkTicketFolders:${R.name}`, () => ticketFoldersAt(R.mainRef(), R.projectRel, R.git));
// A ticket of a records-"home" link whose records were left in the link, written before the link
// said "home": home has no folder for it (main, local or origin ticket/<id>; a records branch with
// no commit yet has none), and the link has <project>/tickets/<id>/ at `at` (the commit judged),
// else its ticket branch, else its main. Such a ticket is read as records "repo" until home has
// some; then home wins. A link this machine can't read has none left in it. Refs only, memoized
// per log read, so a dashboard re-decides on its next read.
export function recordsLeftInRepo(t, at) {
  if (!t || !recordsHomeSetting(t)) return false;
  const name = repoOfTicketLink(t);
  if (!repoReadable(name)) return false;
  return memo(`leftInRepo:${t.id}:${at ?? ''}`, () => {
    if (homeTicketFolders(mainRef()).has(t.id)) return false;
    const own = `${projectRel}/tickets/${t.id}`;
    if ([`refs/heads/ticket/${t.id}`, `refs/remotes/origin/ticket/${t.id}`].some((r) => resolveCommit(r) && git(['cat-file', '-e', `${r}:${own}`]) !== null)) return false;
    const R = repo(name);
    const ref = at ?? R.ticketBranchRef(t.id) ?? R.mainRef();
    if (!ref) return false;
    return ref === R.mainRef() ? linkTicketFolders(R).has(t.id) : R.git(['cat-file', '-e', `${ref}:${R.projectRel}/tickets/${t.id}`]) !== null;
  });
}
// Whether a ticket keeps its records in home (its repo link's records is "home", and none were left
// in the link): spec, plan, verification and reviews on home's ticket/<id>, in home's project
// folder, while its code is on its repo's ticket/<id>. Reads refs, never a working tree. `at` is
// the link commit a command judges; views pass none (the link's ticket branch, else its main).
export function recordsInHome(t, { at } = {}) { return recordsHomeSetting(t) && !recordsLeftInRepo(t, at); }
export const recordsInHomeId = (id, opts) => recordsInHome(tickets().get(id), opts);
// Said once per process per ticket (merge and check-pr run checkTicket inside them).
export const leftWarned = new Set();
export function warnLeftInRepo(t, R) {
  if (leftWarned.has(t.id)) return;
  leftWarned.add(t.id);
  warn(`${t.id}: records read from ${R.name} (${R.projectRel}/tickets/${t.id}/), left from before links.${R.name}.records was "home"; move them to home's ${projectRel}/tickets/${t.id}/ once merged`);
}
// The repo that holds a ticket's records: home for records in home, else the ticket's own (an act).
export const recordsRepo = (id) => (recordsInHomeId(id) ? repo('home') : repoOfTicketId(id));
// Home's ticket/<id>, where a records-in-home ticket's records are: the local branch (the worker's
// committed state), else origin's.
export const homeRecordsRef = (id) => homeTicketBranchRef(id);
// A ticket's git facts come from its own repo. Views ask by name, through factsRepo,
// which is null for a repo this machine can't read: its tickets read as unmerged and branchless
// while link-unreachable says why. Home's methods are today's functions.
export const factsRepo = (id) => { const t = tickets().get(id); const name = t ? repoOfTicketLink(t) : 'home'; return repoReadable(name) ? repo(name) : null; };
export const mergeShaFor = (id) => factsRepo(id)?.mergeShaFor(id) ?? null;
export const mergedAt = (id) => factsRepo(id)?.mergedAt(id) ?? null;
export const ticketBranchRef = (id) => factsRepo(id)?.ticketBranchRef(id) ?? null;
// A release of a repo: the component's tag pattern, else v*; home's by default.
export const releasedIn = (sha, { repo: R = repo('home'), pattern } = {}) => R.releasedIn(sha, pattern);
// Where a ticket's release is read: its repo's tags, matching its component's pattern.
// A merge sha is non-null only when factsRepo found the repo; undefined lets releasedIn's default
// (home) apply rather than a null.
export const releaseOf = (t) => { const c = committedComponents().components?.[t.component]; return { repo: factsRepo(t.id) ?? undefined, pattern: isObj(c?.release) ? c.release.tag : undefined }; };
// The head a check of R reads: --sha, else this checkout's HEAD when it is a checkout of R, else
// R's main checkout's.
export const headIn = (R, shaArg) => (shaArg ? R.resolveCommit(shaArg) : cwdRepo() === R ? cwdGit(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']) : R.resolveCommit('HEAD'));
// The repo of the checkout this command runs in (home, or a repo link's), by its git common dir.
export function cwdRepo() {
  if (cwdIsHome) return repo('home');
  if (!cwdCommon) return null;
  for (const [id, l] of Object.entries(loadSettings().links ?? {})) {
    if (!LINK_KINDS[l.kind]?.hostsComponents || !repoReadable(id)) continue;
    if (realPath(commonOf(linkLocation(id)) ?? '') === realPath(cwdCommon)) return repo(id);
  }
  return null;
}

// ===== 5. the graph (tickets and features, folded from the log) =====

