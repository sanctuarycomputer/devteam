/* imports start */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GITLEAKS_FILE } from './links.mjs';
import { KIT_GITLEAKS } from './links.mjs';
import { LINK_KINDS } from './links.mjs';
import { STRATEGY_MD } from './init.mjs';
import { STRATEGY_TEMPLATE_MARK } from './init.mjs';
import { byTime } from './log-sync.mjs';
import { changedFiles } from './reviews.mjs';
import { checkPr } from './check-ticket.mjs';
import { commonDir } from './state.mjs';
import { commonOf } from './state.mjs';
import { die } from './base.mjs';
import { fetchMain } from './log-sync.mjs';
import { flagStr } from './base.mjs';
import { flags } from './base.mjs';
import { fold } from './log.mjs';
import { git } from './base.mjs';
import { gitOrDie } from './base.mjs';
import { gitReadCache } from './base.mjs';
import { gitRun } from './reviews.mjs';
import { homeRecordsRef } from './repos.mjs';
import { isGitleaksStub } from './links.mjs';
import { isObj } from './artifact-notes.mjs';
import { json } from './base.mjs';
import { kitRel } from './links.mjs';
import { loadSettings } from './settings.mjs';
import { logObjects } from './log-sync.mjs';
import { mainRef } from './log.mjs';
import { mainRoot } from './state.mjs';
import { out } from './base.mjs';
import { ownerAnswer } from './world-model.mjs';
import { pastHalfMade } from './check-ticket.mjs';
import { pidAlive } from './sensors.mjs';
import { positional } from './base.mjs';
import { projectDir } from './state.mjs';
import { projectInRepo } from './settings.mjs';
import { projectRel } from './settings.mjs';
import { projectRoot } from './settings.mjs';
import { readText } from './base.mjs';
import { realPath } from './state.mjs';
import { recordsHomeSetting } from './repos.mjs';
import { recordsInHomeId } from './repos.mjs';
import { redactUrl } from './links.mjs';
import { repo } from './repos.mjs';
import { repoOfTicketId } from './repos.mjs';
import { repoReadable } from './repos.mjs';
import { report } from './log-sync.mjs';
import { resolveCommit } from './log-sync.mjs';
import { seedWorktree } from './check-ticket.mjs';
import { settingsAt } from './settings.mjs';
import { tickets } from './graph.mjs';
import { warn } from './base.mjs';
import { worktreeAddOrDie } from './check-ticket.mjs';
import { worktreeRecords } from './fleet.mjs';
/* imports end */
// a fetch past the same state, for a start that carries on when the fetch fails
export function fetchPastHalfMade(args, clock) {
  return pastHalfMade(() => { const r = gitRun(args); return { ...r, ok: r.status === 0 }; }, { common: commonDir, clock });
}
// What a killed process left behind: its exit hook never ran (a restart, a timeout, a kill), so its
// temp checkouts stay under home's .worktrees and pile up. Only ones that are ours: on git's own
// list, directly under .worktrees, named tmp-<name>-<pid>, and that pid gone. A pid reused since
// keeps one a while longer; nothing else is touched.
export function sweepDeadTempWorktrees(R) {
  const root = realPath(path.join(mainRoot, '.worktrees'));
  const listed = (R.git(['worktree', 'list', '--porcelain'], R.root) ?? '').split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9));
  for (const wt of listed) {
    const pid = Number(/^tmp-.+-(\d+)$/.exec(path.basename(wt))?.[1]);
    if (!pid || pid === process.pid || realPath(path.dirname(wt)) !== root || pidAlive(pid)) continue;
    R.git(['worktree', 'remove', '--force', wt], R.root);
  }
}
// A throwaway checkout of one commit of a repo, under home's .worktrees, removed when the process
// ends however it ends. One a killed
// process left is swept the next time one is made.
// Another repo's lives in the OS temp folder (where secret post already makes its own), never under
// home's tree: a gate there would otherwise pass on home's node_modules, .tool-versions and lint or
// ts configs, found by walking up the directories. Home's stays under home's .worktrees, as before.
export function detachedWorktree(sha, name, R = repo('home'), { seed = true } = {}) {
  const holder = R.name === 'home' ? null : fs.mkdtempSync(path.join(os.tmpdir(), `devteam-${R.name}-`));
  if (!holder) sweepDeadTempWorktrees(R);
  const wt = holder ? path.join(holder, `tmp-${name}`) : path.join(mainRoot, '.worktrees', `tmp-${name}-${process.pid}`);
  // -c core.useReplaceRefs=false (kit-778): a replace ref or core.useReplaceRefs any session can set would otherwise swap the tree checked out
  worktreeAddOrDie(['-c', 'core.useReplaceRefs=false', 'worktree', 'add', '--quiet', '--detach', wt, sha], wt, { root: R.root, common: R.commonDir });
  process.once('exit', () => {
    if (fs.existsSync(wt)) R.git(['worktree', 'remove', '--force', wt], R.root);
    // the empty holder only (rmdir refuses anything with files left in it)
    if (holder) try { fs.rmdirSync(holder); } catch {}
  });
  if (seed) seedWorktree(wt, { repo: R });
  return wt;
}
// The repo a worktree belongs to, computed from git, never recorded: null for a
// worktree of no repo this machine can read.
export function worktreeRepo(wt) {
  const c = fs.existsSync(wt) ? commonOf(wt) : null;
  if (!c) return null;
  if (commonDir && realPath(c) === realPath(commonDir)) return repo('home');
  for (const [id, l] of Object.entries(loadSettings().links ?? {})) if (LINK_KINDS[l?.kind]?.hostsComponents && repoReadable(id) && realPath(repo(id).commonDir) === realPath(c)) return repo(id);
  return null;
}
// review-worktree <ticket> <sha> [--name <suffix>] | review-worktree --remove <path>: a final
// reviewer's checkout of exactly the commit it reviews, under .worktrees/ and seeded like a worker's
// (worktree_files, worktree_setup), so gates and the app run there. Local only, like chore start: it
// changes no branch and nothing anyone else reads, so it logs nothing.
export const REVIEW_SUFFIX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export function cmdReviewWorktree() {
  if (!commonDir) die('review-worktree needs a git checkout');
  const root = path.join(mainRoot, '.worktrees');
  if (flags.remove !== undefined) {
    const target = flagStr('remove') ?? die('usage: review-worktree --remove <path>');
    const abs = path.resolve(target);
    const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
    const at = real(abs);
    // removed through the repo it is a worktree of (home's, or a sibling's)
    const R = at ? worktreeRepo(at) : null;
    const listed = R ? (R.git(['worktree', 'list', '--porcelain'], R.root) ?? '').split('\n').filter((l) => l.startsWith('worktree ')).map((l) => real(l.slice(9))) : [];
    if (!at || path.dirname(at) !== real(root) || !path.basename(at).startsWith('review-') || !listed.includes(at)) die(`${target} is not a review worktree under ${root} (review-worktree removes only what it made)`);
    R.gitOrDie(['worktree', 'remove', '--force', at], R.root);
    out(`removed ${at}`);
    // its records checkout (records in home), made beside it
    const rat = real(`${at}-records`);
    const made = rat && R.name !== 'home' && worktreeRepo(rat)?.name === 'home' && worktreeRecords(repo('home')).some((w) => w.path === rat && w.detached);
    if (made) { gitOrDie(['worktree', 'remove', '--force', rat], mainRoot); out(`removed ${rat}`); }
    return;
  }
  const [id, ref] = positional;
  if (!id || !ref) die('usage: review-worktree <ticket-id> <sha> [--name <suffix>]   |   review-worktree --remove <path>');
  if (!tickets().has(id)) die(`no ticket ${id} (devteam.mjs ticket show ${id})`);
  // a checkout of the ticket's own repo (an act: fails fast on a missing or wrong checkout)
  const R = repoOfTicketId(id);
  const sha = R.resolveCommit(ref) ?? die(`${ref} is not a commit${R.name === 'home' ? '' : ` in ${R.name}`} here (git fetch first?)`);
  const suffix = flagStr('name');
  if (flags.name !== undefined && !REVIEW_SUFFIX.test(suffix ?? '')) die(`--name "${suffix ?? ''}" must be lowercase words joined by hyphens`);
  // Short enough to name things after (a database identifier is 63 bytes in Postgres): the ticket's
  // component and number, not its slug, and 8 hex of the sha.
  const short = /^(.+?-\d+)(-|$)/.exec(id)?.[1] ?? id;
  const wt = path.join(root, `review-${short}-${sha.slice(0, 8)}${suffix ? `-${suffix}` : ''}`);
  if (fs.existsSync(wt)) die(`${wt} exists; give this reviewer its own --name, or remove it: devteam.mjs review-worktree --remove ${wt}`);
  // both checkouts with -c core.useReplaceRefs=false (kit-778): a replace ref or core.useReplaceRefs any session can set would otherwise swap the tree checked out
  worktreeAddOrDie(['-c', 'core.useReplaceRefs=false', 'worktree', 'add', '--quiet', '--detach', wt, sha], wt, { root: R.root, common: R.commonDir });
  seedWorktree(wt, { repo: R });
  out(wt);
  // records in home: a detached checkout of home's ticket/<id> beside it, whose full sha the
  // reviewer writes in its record's "- Records:" line; decided at the sha reviewed
  if (recordsInHomeId(id, { at: sha })) {
    const ref = homeRecordsRef(id);
    const rsha = ref ? resolveCommit(ref) : null;
    if (!rsha) warn(`no records for ${id} in home (home's ticket/${id}), so no records checkout was made`);
    else {
      const rwt = `${wt}-records`;
      worktreeAddOrDie(['-c', 'core.useReplaceRefs=false', 'worktree', 'add', '--quiet', '--detach', rwt, rsha], rwt, { root: mainRoot, common: commonDir });
      out(`records: ${rwt} (${rsha})`);
    }
  }
}
export function cmdCheckPr() {
  const headRef = flagStr('head-ref') ?? die('check-pr needs --head-ref (and --sha, --title, --body-file; --approved <qid> for a PR changing the strategy, self.md or exterior.md)');
  // --repo: a PR in another repo, checked in its checkout (--path names another one, such as a CI run's)
  const R = repo(flagStr('repo') ?? 'home');
  const sha = R.resolveCommit(flagStr('sha') ?? 'HEAD') ?? die(`cannot resolve the head${R.name === 'home' ? '' : ` in ${R.name}`}`);
  const body = flagStr('body-file') ? fs.readFileSync(flagStr('body-file'), 'utf8') : undefined;
  fetchMain(R);
  // a records-in-home ticket's records are on home's ticket/<id>: as origin has it now
  const tid = /^(?:refs\/heads\/)?ticket\/(.+)$/.exec(headRef)?.[1];
  // judged as origin has them (never a local branch that may not be pushed); none there: none.
  // Fetched before deciding, so home records pushed from another clone count (home wins); decided
  // once, at the head.
  const homeSet = R.name !== 'home' && !!tid && tickets().has(tid) && recordsHomeSetting(tickets().get(tid));
  const fetched = homeSet && gitRun(['fetch', '--quiet', 'origin', `+refs/heads/ticket/${tid}:refs/remotes/origin/ticket/${tid}`]).status === 0;
  const inHome = homeSet ? recordsInHomeId(tid, { at: sha }) : undefined;
  const records = inHome ? (fetched ? `refs/remotes/origin/ticket/${tid}` : null) : undefined;
  const fails = checkPr({ headRef, sha, title: flagStr('title'), body, forge: true, repo: R, inHome, ...(records !== undefined ? { records } : {}) });
  // none on origin: say so (checkTicket leaves the why to its caller when told none is pinned)
  if (records === null) fails.push(`no records for ${tid} in home: home's ticket/${tid} is not on origin; push it`);
  // The owner's files (worldFileFails): handed the owner's answer, check-pr refuses what merge
  // refuses; without one, each line is a warning and the exit is unchanged, so a forge's check that
  // runs check-pr bare stays as it was, and merge stays the wall.
  if (R.name === 'home' && mainRef()) {
    const approved = flagStr('approved') ?? null;
    const lines = worldFileFails(git(['merge-base', mainRef(), sha]), sha, approved, worldFileFails.actOf(headRef), 'check-pr --approved');
    if (approved) fails.push(...lines);
    else for (const l of lines) out(`warn: ${l}`);
  }
  report(fails, `${headRef} passes the checks at ${sha.slice(0, 12)}${R.name === 'home' ? '' : ` in ${R.name}`} (gates and the supervisor's approval acts are merge's to check)`);
}
// An owner-answered question, for commands that need the owner's yes.
// A standing approval for upstream syncs: an accepted owner rule scoped chore:devteam-sync
// (`answer <qid> "…" --rule "<rule>" --rule-scope chore:devteam-sync`) approves a
// chore-devteam-sync-<tag> merge in place of a fresh answer, but only when every file the chore
// changes outside project/ is inside the kit and byte-identical to that tag upstream. Anything the
// supervisor wrote itself still needs the owner's answer. Either way the tag must be on upstream's
// default branch, so a tag pushed off to the side isn't a release. settings.upstream_sync "adopt"
// (what init writes) is the same approval from the moment devteam is adopted, read from main's tip
// so a PR can't grant it to itself and a branch cut before the owner went back to "ask" doesn't keep
// it. Nobody chose the release it adopts, so it also needs adoptProblem to find nothing.
// What the check fetched from upstream goes when it's done: a ref left here is foreign history
// in the host repo, for anything that walks every ref (a secrets scan with --all).
export function upstreamSyncApproval(chore, sha, changed) {
  try { return upstreamSyncCheck(chore, sha, changed); } finally {
    for (const r of (git(['for-each-ref', '--format=%(refname)', 'refs/devteam-upstream', 'refs/devteam-upstream-default'], mainRoot) ?? '').split('\n').filter(Boolean)) git(['update-ref', '-d', r], mainRoot);
  }
}
export function upstreamSyncCheck(chore, sha, changed) {
  const rule = logObjects('knowledge').filter((k) => k.created_by === 'owner' && k.scope === 'chore:devteam-sync' && k.status === 'accepted').sort(byTime).pop() ?? null;
  const main = mainRef();
  const mb = main ? git(['merge-base', main, sha]) : null;
  const policy = !rule && !!mb && upstreamSyncMode(settingsAt(main)) === 'adopt';
  if (!rule && !policy) return {};
  const s = loadSettings();
  const src = /^[\w.-]+\/[\w.-]+$/.test(s.upstream_repo ?? '') ? `https://github.com/${s.upstream_repo}.git` : s.upstream_repo;
  // The release the PR adopts: the upstream_base it sets in settings.md (so a sync PR that folded in
  // a later release is checked against that one), else the tag in its slug. Either way the files
  // are compared with that tag fetched from upstream_repo as it is on main.
  const setBase = settingsAt(sha)?.upstream_base;
  const raw = setBase && setBase !== (mb ? settingsAt(mb)?.upstream_base : null) ? setBase : chore.slice('devteam-sync-'.length);
  let tag = null;
  for (const t of new Set([raw, raw.replace(/^(v\d+)-(\d+)-(\d+)/, '$1.$2.$3')])) {
    if (git(['fetch', '--quiet', '--no-tags', src, `+refs/tags/${t}:refs/devteam-upstream/${t}`], mainRoot) !== null) { tag = t; break; }
  }
  if (!tag) return { problem: `standing approval for upstream syncs: no tag "${raw}" at ${redactUrl(s.upstream_repo)}` };
  // The default branch as upstream has it now: forced, like the tag, since only this run's view counts.
  const tagSha = git(['rev-parse', '--verify', '--quiet', `refs/devteam-upstream/${tag}^{commit}`], mainRoot);
  const onDefault = tagSha && git(['fetch', '--quiet', '--no-tags', src, '+HEAD:refs/devteam-upstream-default/HEAD'], mainRoot) !== null
    && git(['merge-base', '--is-ancestor', tagSha, 'refs/devteam-upstream-default/HEAD'], mainRoot) !== null;
  if (!onDefault) return { problem: `standing approval for upstream syncs: tag "${tag}" is not on the default branch of ${redactUrl(s.upstream_repo)}, or that can't be confirmed. The owner's answer is needed: --approved <qid>` };
  // The one file outside the kit a sync may carry: the .gitleaks.toml init writes, where main has
  // none and the release ships the kit's gitleaks.toml it extends. Exactly that (isGitleaksStub), so
  // the PR can't bring an allowlist of its own in with it.
  const blob = (ref, f) => git(['rev-parse', '--verify', '--quiet', `${ref}:${f}`], mainRoot);
  const stub = changed.includes(GITLEAKS_FILE) && mb && !blob(mb, GITLEAKS_FILE) && blob(sha, KIT_GITLEAKS) && isGitleaksStub(git(['show', `${sha}:${GITLEAKS_FILE}`], mainRoot));
  if (stub) changed = changed.filter((f) => f !== GITLEAKS_FILE);
  if (policy) {
    const problem = adoptProblem({ tag, sha, mb, main, changed, src });
    if (problem) return { problem: `settings.upstream_sync "adopt" covers only a whole newer release: ${problem}. The owner's answer is needed: --approved <qid>` };
  }
  const differ = [];
  for (const f of changed) {
    if (!f.startsWith(`${kitRel}/`)) { differ.push(`${f} (outside the kit)`); continue; }
    if (blob(sha, f) !== blob(`refs/devteam-upstream/${tag}`, `docs/devteam/${f.slice(kitRel.length + 1)}`)) differ.push(f);
  }
  if (differ.length) return { problem: `standing approval covers only files copied verbatim from upstream ${tag}; these differ: ${differ.slice(0, 6).join(', ')}${differ.length > 6 ? ', …' : ''}. The owner's answer is needed: --approved <qid>` };
  return { rule, policy, tag, tagSha, stub: !!stub };
}
// What "adopt" needs beyond the standing rule; the reason it isn't met, else null. The PR starts at
// main's tip, or the merge's 3-way result needn't be the files compared here. The tag is strictly
// newer than main's upstream_base, so the kit never goes back. The PR sets upstream_base to the tag,
// or a later sync would measure from a release main no longer has. The kit files it changes are
// exactly those upstream changed between the two, so no release lands in part. Only for "adopt": an
// owner's standing rule has always covered a PR that leaves upstream_base alone or takes part of a
// release, and a project on one can rely on that.
export function adoptProblem({ tag, sha, mb, main, changed, src }) {
  if (mb !== resolveCommit(main)) return `the PR is behind ${main}; merge it in and ask again`;
  const base = settingsAt(main)?.upstream_base;
  const from = releaseParts(base), to = releaseParts(tag);
  if (!from) return `main's upstream_base (${JSON.stringify(base ?? null)}) isn't a release to compare with`;
  if (!to) return `"${tag}" isn't a release version (vX.Y.Z)`;
  if (!(compareRelease(to, from) > 0)) return `${tag} is not newer than main's upstream_base ${base}`;
  const set = settingsAt(sha)?.upstream_base;
  if (set !== tag) return `the PR sets upstream_base to ${JSON.stringify(set ?? null)}, not ${tag}`;
  if (git(['fetch', '--quiet', '--no-tags', src, `+refs/tags/${base}:refs/devteam-upstream/${base}`], mainRoot) === null) return `can't fetch main's upstream_base ${base} from upstream`;
  const released = changedFiles(`refs/devteam-upstream/${base}`, `refs/devteam-upstream/${tag}`).filter((f) => f.startsWith('docs/devteam/') && !/^docs\/devteam\/(project|run)\//.test(f)).map((f) => `${kitRel}/${f.slice('docs/devteam/'.length)}`);
  const unlike = (a, b) => a.filter((f) => !b.includes(f));
  const missing = unlike(released, changed), extra = unlike(changed, released);
  const some = (l) => `${l.slice(0, 6).join(', ')}${l.length > 6 ? ', …' : ''}`;
  if (missing.length || extra.length) return `its kit files aren't exactly what upstream changed from ${base} to ${tag}${missing.length ? `; missing ${some(missing)}` : ''}${extra.length ? `; extra ${some(extra)}` : ''}`;
  return null;
}
// settings.upstream_sync as given, "adopt" where it's absent. Unreadable settings, or anything but the
// two values, fail closed to "ask" (the latter with a warning).
export function upstreamSyncMode(s) {
  if (!s) return 'ask';
  if (s.upstream_sync === undefined) return 'adopt';
  if (s.upstream_sync === 'ask' || s.upstream_sync === 'adopt') return s.upstream_sync;
  warn(`settings.upstream_sync is ${JSON.stringify(s.upstream_sync)}; only "ask" and "adopt" are valid, so it is read as "ask"`);
  return 'ask';
}
export const releaseParts = (t) => /^v(\d+)\.(\d+)\.(\d+)$/.exec(String(t ?? ''))?.slice(1).map(Number) ?? null;
export const compareRelease = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
// A standing approval for CI fixes: an accepted owner rule scoped chore:ci-fix (or
// chore:devteam-workflow, as Stacks' owner first gave it) lets the supervisor merge a ci-fix-* chore
// without asking, when it changes only workflow files, deletes none, and keeps every job each had
// on main, so a "fix" can't drop a check. Its CI must still pass (merge waits for the forge's checks).
export const CI_RULE_SCOPES = ['chore:ci-fix', 'chore:devteam-workflow'];
// A standing approval for secret-scan exceptions: an accepted owner rule scoped chore:gitleaks-allowlist
// lets the supervisor merge a gitleaks-<what> chore without asking, when it only adds fingerprints to the
// repo's .gitleaksignore: each line `<commit>:<path>:<rule-id>:<line>`, with the full 40-hex commit (gitleaks
// compares whole ids, and a line with no commit would exempt that file and line in every commit, a later
// secret there included), exempts exactly one finding, so
// the rule can neither change what the scan's config means nor allow anything broader than the findings
// the owner's rule was about. Nothing else may change: .gitleaks.toml stays an owner answer, and a
// fingerprint in the project log (quality.md, Secrets) or with a wildcard is refused. The file must be a
// plain file, and the chore's CI must pass as usual.
export const SECRETS_RULE_SCOPES = ['chore:gitleaks-allowlist'];
export const SECRETS_IGNORE_FILE = '.gitleaksignore';
export const GITLEAKS_FINGERPRINT = /^[0-9a-f]{40}:([^:\s*?[\]]+):([A-Za-z0-9_.-]+):(\d+)$/;
export function secretsAllowlistApproval(chore, sha, base, changed) {
  if (!/^gitleaks-/.test(chore)) return {};
  const rule = logObjects('knowledge').filter((k) => k.created_by === 'owner' && SECRETS_RULE_SCOPES.includes(k.scope) && k.status === 'accepted').sort(byTime).pop();
  if (!rule) return {};
  const off = changed.filter((f) => f !== SECRETS_IGNORE_FILE);
  if (off.length) return { problem: `the owner's secret-scan exceptions rule covers only fingerprints added to ${SECRETS_IGNORE_FILE}; this also changes ${off.slice(0, 6).join(', ')}. The owner's answer is needed: merge --chore ${chore} --approved <qid>` };
  const mode = (git(['ls-tree', sha, '--', SECRETS_IGNORE_FILE]) ?? '').split(/\s/)[0];
  if (mode !== '100644') return { problem: `the owner's secret-scan exceptions rule covers only a plain ${SECRETS_IGNORE_FILE} (this one is ${mode ? `mode ${mode}` : 'deleted'})` };
  const before = (git(['show', `${base}:${SECRETS_IGNORE_FILE}`]) ?? '').split('\n');
  const now = git(['show', `${sha}:${SECRETS_IGNORE_FILE}`]).split('\n');
  // every line main had is still there, in order: the change only adds
  let i = 0;
  for (const l of now) if (i < before.length && l === before[i]) i++;
  const kept = before.slice(i).find((l) => l.trim());
  if (kept !== undefined) return { problem: `the owner's secret-scan exceptions rule covers only adding fingerprints; ${SECRETS_IGNORE_FILE} changes or removes "${kept.trim().slice(0, 80)}"` };
  const log = `${projectRel}/log/`;
  for (const raw of now.filter((x) => !before.includes(x))) {
    // printable ASCII only: invisible Unicode reads one way here and another way to gitleaks
    if (/[^\x20-\x7e]/.test(raw)) return { problem: `the owner's secret-scan exceptions rule covers only plain-ASCII fingerprint lines; "${JSON.stringify(raw).slice(1, 81)}" has another character` };
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const m = GITLEAKS_FINGERPRINT.exec(l);
    if (!m) return { problem: `the owner's secret-scan exceptions rule covers only one-finding fingerprints (<40-hex commit>:<path>:<rule-id>:<line>); "${l.slice(0, 80)}" isn't one` };
    if (path.posix.normalize(m[1]).replace(/^\.\//, '').startsWith(log)) return { problem: `the owner's secret-scan exceptions rule never covers the project log (${m[1]}): a secret there is a leak to fix, not an exception` };
  }
  return { rule, what: 'secret-scan exception' };
}
export const workflowJobs = (text) => {
  const lines = String(text ?? '').split('\n');
  const i = lines.findIndex((l) => /^jobs:\s*(#.*)?$/.test(l));
  if (i < 0) return [];
  const jobs = [];
  let indent = null;
  for (const l of lines.slice(i + 1)) {
    if (/^\S/.test(l)) break;
    const m = /^(\s+)([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(l);
    if (!m) continue;
    indent ??= m[1].length;
    if (m[1].length === indent) jobs.push(m[2]);
  }
  return jobs;
};
export function ciFixApproval(chore, sha, base, changed) {
  if (!/^(ci-fix|devteam-workflow)/.test(chore)) return {};
  const rule = logObjects('knowledge').filter((k) => k.created_by === 'owner' && CI_RULE_SCOPES.includes(k.scope) && k.status === 'accepted').sort(byTime).pop();
  if (!rule) return {};
  const off = changed.filter((f) => !/^\.github\/workflows\/[^/]+\.ya?ml$/.test(f));
  if (off.length) return { problem: `the owner's CI-fix rule covers only .github/workflows/*.yml; this also changes ${off.slice(0, 6).join(', ')}. The owner's answer is needed: merge --chore ${chore} --approved <qid>` };
  for (const f of changed) {
    const after = git(['show', `${sha}:${f}`]);
    if (after === null) return { problem: `the owner's CI-fix rule doesn't cover deleting ${f}` };
    const before = git(['show', `${base}:${f}`]);
    const lost = workflowJobs(before).filter((j) => !workflowJobs(after).includes(j));
    if (lost.length) return { problem: `the owner's CI-fix rule doesn't cover removing jobs (${f}: ${lost.join(', ')})` };
    if (/devteam\.mjs check-pr/.test(before ?? '') && !/devteam\.mjs check-pr/.test(after)) return { problem: `the owner's CI-fix rule doesn't cover removing devteam's own check (check-pr) from ${f}` };
  }
  return { rule, what: 'CI fix' };
}
// project/strategy.md, the owner's. As main has it: missing, the template init wrote (by a marker
// line it carries, so a later edit of the kit's template doesn't make an untouched file read as
// written), or written.
export const strategyRel = `${projectRel}/strategy.md`;
export function strategyState() {
  const text = projectInRepo && mainRef() ? git(['show', `${mainRef()}:${strategyRel}`]) : readText(path.join(projectDir, 'strategy.md'));
  return text === null ? 'missing' : text.includes(STRATEGY_TEMPLATE_MARK) ? 'template' : 'written';
}
// governance [--json]: the kit's governance and process files, then the project's strategy and
// exterior, each with its title, its last change on main, and whether it was changed here since the
// kit was last synced (differs). Read from main, as strategyState is; with no main, or a project
// outside the repo, from the working tree, with no history. One first-parent walk of main over the
// listed files and settings.md: a file's first appearance is its newest commit, and the settings.md
// commits are the sync candidates. A sync commit is one where upstream_base became a different
// release tag. A file whose newest commit is a sync reads false; one touched after a sync, true; one
// whose newest commit is older than every sync (the kit was committed before its base was first set)
// reads null, as with no sync at all: no known release to compare it with. A sync PR that also
// carried a local edit to a file reads false for that file: the walk can't tell the two apart, and
// that is accepted (spec §1).
export function governanceView() {
  const main = projectInRepo ? mainRef() : null;
  const at = (p) => (main ? git(['show', `${main}:${p}`], projectRoot) : readText(path.join(projectRoot, p)));
  const kitDirs = ['governance', 'process'];
  const listed = main
    ? (git(['ls-tree', '--full-tree', '--name-only', main, '--', ...kitDirs.map((d) => `${kitRel}/${d}/`)], projectRoot) ?? '').split('\n')
    : kitDirs.flatMap((d) => { try { return fs.readdirSync(path.join(projectRoot, kitRel, d)).map((f) => `${kitRel}/${d}/${f}`); } catch { return []; } });
  const kit = kitDirs.flatMap((d) => listed.filter((p) => p.startsWith(`${kitRel}/${d}/`) && p.endsWith('.md')).sort().map((p) => ({ group: d, path: p })));
  const project = [['strategy', 'Strategy'], ['self', 'Self'], ['exterior', 'Exterior']].map(([f, fallback]) => ({ group: 'project', path: `${projectRel}/${f}.md`, fallback, template: f === 'strategy' }));
  const settingsRel = `${projectRel}/settings.md`;
  const newest = new Map();
  const syncs = new Set();
  // the oldest sync's place in the walk (newest first): a file whose newest commit is past it predates every sync
  let oldestSync = -1;
  let shallow = new Set();
  if (main) {
    const paths = [...kit, ...project].map((r) => r.path);
    const walk = (merges) => git(['log', '--first-parent', ...merges, '--format=%x00%H %cI', '--name-only', main, '--', ...paths, settingsRel], projectRoot);
    const commits = (walk(['--diff-merges=first-parent']) ?? walk(['-m']) ?? '').split('\0').slice(1).map((chunk) => {
      const [head, ...names] = chunk.split('\n').filter(Boolean);
      const [sha, iso] = head.split(' ');
      return { sha, iso, names };
    }).map((c, i) => ({ ...c, i }));
    for (const c of commits) for (const p of c.names) if (!newest.has(p)) newest.set(p, c);
    for (const c of commits.filter((x) => x.names.includes(settingsRel))) {
      const base = settingsAt(c.sha, { orNull: true })?.upstream_base;
      if (releaseParts(base) && base !== (settingsAt(`${c.sha}^1`, { orNull: true })?.upstream_base ?? null)) { syncs.add(c.sha); oldestSync = Math.max(oldestSync, c.i); }
    }
    const sf = git(['rev-parse', '--git-path', 'shallow'], projectRoot);
    const text = sf && readText(path.resolve(projectRoot, sf));
    if (text) shallow = new Set(text.split('\n').filter(Boolean));
  }
  const files = [...kit, ...project].map(({ group, path: p, fallback, template }) => {
    const text = at(p);
    // init's untouched strategy template counts as not written, by its marker line, as strategyState
    // reads it; self.md and exterior.md have no template, so each is written once it exists
    const written = text !== null && !(template && text.includes(STRATEGY_TEMPLATE_MARK));
    const c = newest.get(p);
    const known = c && !shallow.has(c.sha);
    const differs = group === 'project' || !syncs.size || !known || c.i > oldestSync ? null : !syncs.has(c.sha);
    return {
      group,
      path: p,
      title: text?.match(/^# (.+)/m)?.[1].trim() ?? (written ? path.basename(p, '.md') : fallback),
      last_change: known ? c.iso : '—',
      differs,
      written,
      state: !written ? 'not written yet' : differs ? 'changed here' : null,
    };
  });
  return { files };
}
export function cmdGovernance() {
  gitReadCache = new Map();
  const view = governanceView();
  if (flags.json) return json(view);
  for (const r of view.files) out(`${r.group.padEnd(10)} ${r.path}  ${r.state ?? ''}`);
}
// The owner's three files: a PR that changes one (any PR: a chore, a plan, a ticket) lands only
// under the owner's answered question of that file's class (strategy-change, self-change,
// exterior-change), pinned to the exact text. The one change that needs none is init's untouched
// strategy template arriving where main has no strategy file: once a file is there, emptying it,
// resetting it or deleting it is a change like any other, and a deletion has no draft to pin, so
// it is never approved. Each file is judged alone, so a PR changing two of them under one answer
// is refused for the file that answer isn't of. act is what a question names for this PR
// (worldFileFails.actOf): a self-change or exterior-change answer names exactly its one chore, so
// a plan or ticket PR carrying either file lands under no answer.
export function worldFileFails(base, sha, approved, act, what = 'merge --approved') {
  if (!projectInRepo) return [];
  // No merge base (an unrelated history, or main unread): what the PR changes can't be known, so
  // the gate refuses on its own rather than lean on another check.
  if (!base) return [`${String(sha).slice(0, 12)} has no merge base with main, so a change to the owner's files can't be ruled out: merge main into it and run it again`];
  const fails = [];
  // The paths the PR adds or changes, for the case twins below: a twin is one it adds, or one
  // already on main that it changes (one it removes is the fix, so it is left out). A diff reads no
  // tree (check-pr with no lines does no tree work). One that fails is refused, never read as no files.
  const listed = git(['diff', '--no-renames', '--diff-filter=AMT', '-z', '--name-status', base, sha]);
  if (listed === null) return [`could not list the files ${String(sha).slice(0, 12)} adds or changes since ${String(base).slice(0, 12)}, so a change to the owner's files can't be ruled out: fetch both and run it again`];
  const parts = listed.split('\0');
  const tree = [];
  for (let i = 0; i + 1 < parts.length; i += 2) tree.push({ verb: parts[i] === 'A' ? 'adds' : 'changes', f: parts[i + 1] });
  // A path as a disk that folds names reads it, part by part: Unicode compatibility normalisation
  // (an NFD spelling is the NFC one, and ſ is s), upper case then lower case (NTFS upper-cases, so
  // a dotless ı is i), default-ignorable code points dropped (all of those HFS+ ignores, such as
  // U+200C, and more, such as a soft hyphen), NFKC again (a mark left beside its letter composes),
  // and then trailing dots and spaces dropped (as Windows drops them). It folds more than any one
  // disk does; a stray path it catches is only refused.
  const fold = (p) => p.split('/').map((s) => s.normalize('NFKC').toUpperCase().toLowerCase().replace(/\p{Default_Ignorable_Code_Point}/gu, '').normalize('NFKC').replace(/[. ]+$/, '')).join('/');
  // f is at, or inside the folder at; twin: such a disk puts f at at, or in it, where git doesn't.
  const under = (f, at) => f === at || f.startsWith(`${at}/`);
  const twin = (f, at) => under(fold(f), fold(at)) && !under(f, at);
  const says = ({ verb, f }, at) => `${verb} ${f}, ${fold(f) === fold(at) ? 'which' : 'in a folder'} a disk that ignores case can't tell from ${at}`;
  // a twin of an owner file is named with that file (below); a twin of a folder on their path (the
  // project folder, or one above it), at the deepest folder it folds into: a path the PR adds, or
  // one an older kit let onto main that it changes (or the twin itself, repointed). Removing it is
  // the fix, and isn't listed.
  const owned = worldFileFails.files().map((w) => w.rel);
  const folders = [...new Set(owned.flatMap((r) => r.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))))].sort((a, b) => b.length - a.length);
  const inFolder = tree.filter((t) => !owned.some((r) => twin(t.f, r))).flatMap((t) => { const at = folders.find((d) => under(fold(t.f), fold(d))); return at && twin(t.f, at) ? [says(t, at)] : []; });
  if (inFolder.length) fails.push(`${inFolder.join('; ')}: the owner's files are read in ${projectRel}, and a twin of a folder on their path can put other files there; remove it`);
  // A plain file, whatever the owner answered: a symlink's blob is the path it points at, so the
  // text read through it changes with no change here; a submodule or a folder pins no text at all.
  // The modes come from one read of the project folder's own listing (the three files sit in it),
  // never a walk of the tree, so check-pr with no lines still does no tree work (landing-git). A
  // listing that doesn't read, or isn't a folder's, is refused, never read as plain files. The type
  // is asked first: a file or symlink in the folder's place prints its own text, which can look
  // like a listing.
  const listing = git(['cat-file', '-t', `${sha}:${projectRel}`]) === 'tree' ? git(['cat-file', '-p', `${sha}:${projectRel}`]) : null;
  const entries = listing === null ? null : listing.split('\n').filter(Boolean).map((l) => /^(\d{6}) \w+ [0-9a-f]+\t(.*)$/.exec(l));
  if (!entries || entries.some((m) => !m)) return [...fails, `could not read ${projectRel} at ${String(sha).slice(0, 12)} as a folder, so the owner's files can't be judged plain files: merge main into it, or fetch it, and run it again`];
  const modes = new Map(entries.map((m) => [`${projectRel}/${m[2]}`, m[1]]));
  for (const { rel, cls, what: words, template } of worldFileFails.files()) {
    const mode = modes.get(rel);
    if (mode && mode !== '100644' && mode !== '100755') { fails.push(`${rel} is ${{ 120000: 'a symlink', 160000: 'a submodule', '040000': 'a folder' }[mode] ?? `of mode ${mode}`} at the head, not a plain file: ${words} is read as written there, so make it one`); continue; }
    // by the file's blob at each end, never a diff (a failed diff reads as no files)
    const before = git(['rev-parse', '--verify', '--quiet', `${base}:${rel}`]);
    const after = git(['rev-parse', '--verify', '--quiet', `${sha}:${rel}`]);
    // A second file whose path folds to this one's (fold, above): on a disk that ignores case or
    // spelling (macOS, Windows) the two are one file, and a checkout may leave this one where it is read.
    const twins = tree.filter((t) => twin(t.f, rel));
    if (twins.length) { fails.push(`${twins.map((t) => says(t, rel)).join('; ')}: ${words} is one file, and the owner's; remove it`); continue; }
    if (before === after) continue;
    if (template && before === null && (git(['show', `${sha}:${rel}`]) ?? '').trim() === template.trim()) continue;
    if (!approved) { fails.push(`changes ${rel}: ${words} is the owner's, so the owner's answer is needed: ask --class ${cls} --reasons owner-only --recommendation "…" with a link to the draft, then --approved <qid>`); continue; }
    const q = ownerAnswer(approved, what);
    if (q.class !== cls) { fails.push(`${approved} is a ${q.class ?? 'classless'} question; changing ${rel} needs an answered ${cls} question`); continue; }
    // the two newer classes name their one chore (ask requires it): no other PR lands their file
    if (cls !== 'strategy-change') {
      const acts = Array.isArray(q.approves) ? q.approves : [];
      if (acts.length !== 1 || acts[0] !== act || !act.startsWith('chore-')) { fails.push(`${approved} approves ${acts.length ? acts.join(', ') : 'nothing'}, not ${act}: a change to ${rel} lands only in the chore its question names`); continue; }
    }
    // The answer approves the text the question pinned when asked, and no other: a branch amended
    // since lands words the owner never saw. The pin must also be what its link shows.
    const pin = (q.links ?? []).find((l) => isObj(l) && l.path === rel && l.blob);
    if (!pin || git(['rev-parse', '--verify', '--quiet', `${pin.ref}:${rel}`]) !== pin.blob) { fails.push(`${approved} pins no draft of ${rel} that this repo can show: ask again with a link to the draft on its branch`); continue; }
    if (after !== pin.blob) fails.push(`${rel} at the head is not the text ${approved} asked the owner about (${after ? after.slice(0, 12) : 'no file'}, not ${pin.blob.slice(0, 12)}); ask again about the text as it is now`);
  }
  return fails;
}
// the three files, in the order a PR's lines name them; title: the link's, as ask shows it; template: init's untouched text, which
// needs no answer where main has no file (the strategy's only). Words keep the strategy's own.
worldFileFails.files = () => [
  { rel: strategyRel, cls: 'strategy-change', what: 'the strategy', title: 'The strategy', template: STRATEGY_MD },
  { rel: `${projectRel}/self.md`, cls: 'self-change', what: 'the Self', title: 'The Self', template: null },
  { rel: `${projectRel}/exterior.md`, cls: 'exterior-change', what: 'the exterior', title: 'The exterior', template: null },
];
// what a question names for the PR on this branch: chore-<slug> for a chore, plan-<feature> for
// a plan, the id for a ticket, and any other branch as it is (so it matches a chore act only on
// that chore's own branch). A ticket whose id reads chore-… keeps its ticket/ prefix: it is no chore.
worldFileFails.actOf = (ref) => {
  const b = String(ref).replace(/^refs\/heads\//, '');
  return b.startsWith('plan/') ? `plan-${b.slice(5)}` : b.startsWith('ticket/') && !b.startsWith('ticket/chore-') ? b.slice(7) : b;
};
