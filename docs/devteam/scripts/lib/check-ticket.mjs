/* imports start */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ARTIFACTS_REL } from './artifacts.mjs';
import { GitReadError } from './reviews.mjs';
import { LINK_KINDS } from './links.mjs';
import { LOG_BRANCH } from './log-sync.mjs';
import { appendLog } from './log-sync.mjs';
import { artifactProblems } from './artifacts.mjs';
import { byTime } from './log-sync.mjs';
import { canonical } from './settings.mjs';
import { changedFiles } from './reviews.mjs';
import { checkTicket } from './reviews.mjs';
import { commonDir } from './state.mjs';
import { coverageAt } from './reviews.mjs';
import { coverageGaps } from './reviews.mjs';
import { coverageReport } from './lineage.mjs';
import { cwdGit } from './base.mjs';
import { cwdRepo } from './repos.mjs';
import { detachedWorktree } from './pr-checks.mjs';
import { die } from './base.mjs';
import { execFileSync } from 'node:child_process';
import { exteriorDraftLines } from './world-model.mjs';
import { firstLine } from './reviews.mjs';
import { flagStr } from './base.mjs';
import { git } from './base.mjs';
import { gitRun } from './reviews.mjs';
import { gitTooOld } from './reviews.mjs';
import { headIn } from './repos.mjs';
import { homeFacts } from './reviews.mjs';
import { isObj } from './artifact-notes.mjs';
import { linesDeclared } from './links.mjs';
import { linkAnswerCovers } from './settings.mjs';
import { linkEntryHash } from './links.mjs';
import { linkFieldChanges } from './settings.mjs';
import { linkOwnerChanges } from './settings.mjs';
import { loadSettings } from './settings.mjs';
import { logGet } from './log-sync.mjs';
import { logObjects } from './log-sync.mjs';
import { logRule } from './log-sync.mjs';
import { mainRef } from './log.mjs';
import { mainRoot } from './state.mjs';
import { mainSettings } from './reviews.mjs';
import { mainSha } from './log.mjs';
import { memo } from './graph.mjs';
import { oneWayDoorsSection } from './reviews.mjs';
import { out } from './base.mjs';
import { ownEntry } from './artifact-notes.mjs';
import { pidAlive } from './sensors.mjs';
import { positional } from './base.mjs';
import { projectInRepo } from './settings.mjs';
import { projectRel } from './settings.mjs';
import { reached } from './goals.mjs';
import { readJson } from './base.mjs';
import { readText } from './base.mjs';
import { realPath } from './state.mjs';
import { realPathMade } from './state.mjs';
import { recordsBranchFails } from './reviews.mjs';
import { recordsInHomeId } from './repos.mjs';
import { recurringEntryProblems } from './recurring.mjs';
import { recurringRegistry } from './recurring.mjs';
import { redactUrl } from './links.mjs';
import { registryProblems } from './links.mjs';
import { remediationEntryHash } from './remediation.mjs';
import { repo } from './repos.mjs';
import { repoOfTicketId } from './repos.mjs';
import { repoOfTicketLink } from './repos.mjs';
import { repoReadable } from './repos.mjs';
import { report } from './log-sync.mjs';
import { reviewRule } from './log-sync.mjs';
import { runDir } from './state.mjs';
import { selfDraftLines } from './self-model.mjs';
import { sensorProblems } from './sensors.mjs';
import { settingsAt } from './settings.mjs';
import { settingsInForce } from './reviews.mjs';
import { sh } from './base.mjs';
import { sha256 } from './lens.mjs';
import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { tickets } from './graph.mjs';
import { treeEntries } from './artifacts.mjs';
import { warn } from './base.mjs';
/* imports end */
export function cmdCheckTicket() {
  const id = positional[0] ?? die('usage: check-ticket <ticket-id> [--sha <head>] [--title "<pr title>"] [--body-file <path>] [--pr <n>]');
  let title = flagStr('title');
  let body = flagStr('body-file') ? fs.readFileSync(flagStr('body-file'), 'utf8') : undefined;
  let sha = flagStr('sha');
  const records = flagStr('records');
  const R = repoOfTicketId(id);
  if (flagStr('pr')) {
    const pr = R.gh(['pr', 'view', flagStr('pr'), '--json', 'title,body,headRefOid']);
    if (!pr) die('gh pr view failed');
    const p = JSON.parse(pr);
    title ??= p.title; body ??= p.body; sha ??= p.headRefOid;
  }
  // Run anywhere but on the ticket's own branch (the supervisor's main checkout), with no head
  // named: the ticket's branch is what's judged, not whatever this checkout has checked out.
  if (!sha && R.commonDir && (cwdRepo() !== R || cwdGit(['rev-parse', '--abbrev-ref', 'HEAD']) !== `ticket/${id}`)) {
    sha = R.resolveCommit(`ticket/${id}`) ?? R.resolveCommit(`origin/ticket/${id}`) ?? undefined;
    if (sha) out(`checking ticket/${id} at ${sha.slice(0, 12)} (no --sha given, and this checkout isn't on it)`);
  }
  report(checkTicket(id, { sha, title, body, records }), `${id} meets the definition of done at ${(headIn(R, sha) ?? '').slice(0, 12)}`);
}


// The tree a PR would put on main: the merge of the head onto main, on every forge.
// Squash, rebase and merge all land that tree when the merge is clean, and a forge that merges a
// behind PR (github without "require branches to be up to date") lands it by 3-way merge, so the
// head alone is not what lands. A conflict, or a git that can't say, fails closed.
export function landingTree(sha, R = homeFacts) {
  const main = R.mainRef();
  return memo(`landing\0${R.name}\0${main}\0${sha}`, () => {
    const m = R.mergeTree(main, sha);
    if (m.tree) return { tree: m.tree };
    if (m.conflict) return { problem: `components: ${sha.slice(0, 12)} does not merge cleanly onto ${main}, so the tree it would land can't be checked; merge main into the branch and ask again` };
    return { problem: `components: ${gitTooOld() ?? `could not compute the tree ${sha.slice(0, 12)} would land on ${main} (git merge-tree --write-tree: ${m.error})`}; coverage fails closed until it can` };
  });
}
// Coverage problems in the landing tree that main doesn't already have: a path added outside every
// line, renamed out of one, or left behind by a narrowed glob, judged by the settings
// in force (settingsInForce). Only once lines are declared: with none on main or at the head, no
// tree is read and nothing is merged.
export function coverageFails(base, sha, R = homeFacts, { ticket = false } = {}) {
  const main = R.mainRef();
  if (!main || !projectInRepo) return [];
  const pre = `components${R.name === 'home' ? '' : ` (${R.name})`}`;
  const S = settingsInForce(base, sha, R, { ticket });
  if (!linesDeclared(S.head ?? {}) && !linesDeclared(S.sMain)) return [];
  const land = landingTree(sha, R);
  if (land.problem) return [land.problem];
  const J = S.landed();
  if (J.problem) return [J.problem.startsWith('components') ? J.problem : `${pre}: ${J.problem}`];
  const sLand = J.settings;
  try {
    const now = coverageAt(land.tree, sLand, R);
    if (!now) return [];
    // main's own state, under main's committed settings
    const before = coverageAt(main, S.sMain, R) ?? { unowned: [], contested: [], empty: [], case_collisions: [] };
    const nowG = coverageGaps(now, sLand), wasG = coverageGaps(before, S.sMain);
    const was = new Set([...before.unowned.map((p) => `u${p}`), ...before.contested.map(([p, o]) => `c${p}\0${o}`), ...before.empty.map((x) => `e${x}`), ...before.case_collisions.map((x) => `k${x}`), ...wasG.unlinked.map((n) => `l${n}`)]);
    const fresh = { unowned: now.unowned.filter((p) => !was.has(`u${p}`)), contested: now.contested.filter(([p, o]) => !was.has(`c${p}\0${o}`)), empty: [], case_collisions: now.case_collisions.filter((x) => !was.has(`k${x}`)), unlinked: nowG.unlinked.filter((n) => !was.has(`l${n}`)), ref: land.tree };
    return coverageReport(fresh, sLand, R).map((l) => `${pre}: ${l}`);
  } catch (e) {
    if (e instanceof GitReadError) return [`${pre}: ${e.message}; coverage fails closed until it can`];
    throw e;
  }
}
// The registry that would land, checked as validate checks it, on a PR of any kind that
// changes settings.md: an unknown kind, a reserved id, a component on a link that can't hold one.
// A project with no links and no lines on either side has nothing to check (G1).
export function registryFails(base, sha, R = homeFacts) {
  const S = settingsInForce(base, sha, R);
  if (!S.fromHead) return [];
  const has = (x) => !!x && (Object.keys(x.links ?? {}).length > 0 || linesDeclared(x));
  if (!has(S.head) && !has(S.sMain)) return [];
  const J = S.landed();
  if (J.problem) return [J.problem];
  return registryProblems(J.settings).errors.map((e) => `settings at landing: ${e}`);
}
// The registry-edit acts that can carry link id from one entry to another: each records the entry
// it replaced (prior_hash, null for an add) and the one it wrote (entry_hash, null for a removal).
// An act without both (written before they existed) never counts.
// Only acts logged since main last changed that link's entry count: an owner's hand-revert of
// the link on main would otherwise let an old act, made from the entry main has again, carry its
// entry back over the revert. Another link's change, or any other settings change, expires nothing.
export const linkActs = (id) => {
  const since = linkChangedOnMain(id);
  return logObjects('act').filter((a) => a.class === 'registry-edit' && Object.hasOwn(a, 'entry_hash') && Object.hasOwn(a, 'prior_hash') && (a.refs ?? []).includes(`link:${id}`) && (since === null || Date.parse(a.created_at) >= since)).sort(byTime);
};
// When main's first-parent line last changed links.<id>'s entry (ms; commit times are whole
// seconds, so an act in that same second still counts), looking back over the last
// LINK_HISTORY_DEPTH commits that touched settings.md; null when none of them changed it. Each
// commit's entry is compared with its first parent's. Cached for the run (fetchMain clears it;
// entries by sha never change).
export const LINK_HISTORY_DEPTH = 200;
export const linkChangedCache = new Map();
export const linkEntryAtCache = new Map();
export function linkChangedOnMain(id) {
  if (linkChangedCache.has(id)) return linkChangedCache.get(id);
  const ref = mainRef();
  const rows = ref ? (git(['log', '--first-parent', '-n', String(LINK_HISTORY_DEPTH), '--format=%H %ct', ref, '--', `${projectRel}/settings.md`]) ?? '').split('\n').filter(Boolean) : [];
  const entryAt = (rev) => {
    if (!linkEntryAtCache.has(rev)) linkEntryAtCache.set(rev, settingsAt(rev, { orNull: true })?.links ?? {});
    return linkEntryHash(ownEntry(linkEntryAtCache.get(rev), id));
  };
  let at = null;
  for (const row of rows) {
    const [sha, ct] = row.split(' ');
    if (entryAt(sha) !== entryAt(`${sha}^`)) { at = Number(ct) * 1000; break; }
  }
  linkChangedCache.set(id, at);
  return at;
}
// Whether link id's acts, in the order they were written, lead from entry hash `from` (main's) to
// `to`: one act from main's entry, or a chain of them (link add, then link set, between landings).
// An act whose prior_hash main no longer has leads nowhere, so an act for an older main never lands.
export function linkActsLead(id, from, to) {
  const reached = new Set([from]);
  for (const a of linkActs(id)) if (reached.has(a.prior_hash)) reached.add(a.entry_hash);
  return reached.has(to);
}
// A url link lands only as registry-edit acts wrote it (link add|set|rm), matched by content:
// each url link the merge would change on main, main's settings against the ones that would land,
// needs acts naming it that lead from the entry main has (prior_hash) to the entry that lands
// (entry_hash, null: removed). No time window, so an unrelated settings landing expires nothing; a
// link already as main has it needs nothing; an act for one value never covers another, and an act
// made from an entry main has since changed never matches, so neither a stale set nor an rm of an
// earlier entry lands. A landing that can't be computed is registryFails' to report.
export function registryActFails(base, sha) {
  const S = settingsInForce(base, sha);
  if (!S.fromHead) return [];
  const J = S.landed();
  if (J.problem) return [];
  const lands = J.settings.links ?? {};
  const edits = linkOwnerChanges(S.sMain.links, lands).filter((c) => c.cls === 'registry-edit').map((c) => c.key.slice('links.'.length));
  if (!edits.length) return [];
  const bare = edits.filter((l) => !linkActsLead(l, linkEntryHash(ownEntry(S.sMain.links, l)), linkEntryHash(ownEntry(lands, l))));
  return bare.length ? [`changes ${bare.map((l) => `links.${l}`).join(', ')} to an entry no registry-edit act wrote: make each change with link add|set|rm, which logs the act with the entry it wrote and the one it replaced, rather than by hand in settings.md (an act for an earlier value of the link, or made from an entry main has since changed, doesn't cover this one)`] : [];
}
// A link of an owner's kind lands only as the answer approved it: each one the merge changes
// needs an act of that answer (linkByOwner's, approved_by) naming the link, written from the entry
// main has (prior_hash) to the entry that lands (entry_hash). One answer may approve a bundle (its
// question showed every entry), but an entry its question never showed, or a hand edit of one it
// did, has no such act and is refused by name.
// What the owner saw binds what lands: every changed owner-kind link entry must appear in the
// answered question's settings diff exactly (main's entry then, and the entry that lands). Acts
// are history only: a hand-written act line can't widen an answer. The question is read as it
// stood when the owner answered; a context written after the answer approves nothing.
// A remediation is a production write: the answer must be to a question naming exactly the entries
// this PR adds or changes (ask --remediations), with the script's sha it would run. One answer for
// a bundle covers what its question lists; it never approves a script it didn't show.
export function remediationBindingFails(base, sha, approved) {
  const [a, b] = [settingsAt(base, { orNull: true }) ?? {}, settingsAt(sha, { orNull: true }) ?? {}];
  const [from, to] = [isObj(a.remediations) ? a.remediations : {}, isObj(b.remediations) ? b.remediations : {}];
  const changed = [...new Set([...Object.keys(from), ...Object.keys(to)])].filter((n) => canonical(from[n] ?? null) !== canonical(to[n] ?? null));
  if (!changed.length) return [];
  const named = logGet(approved)?.remediation_entries ?? [];
  const words = (n) => `${n}${to[n]?.sha ? ` at ${to[n].sha.slice(0, 12)}` : ' (removed)'}`;
  if (!named.length) return [`${approved} doesn't name the remediations this changes (${changed.map(words).join(', ')}): ask --class governance-edit --remediations '<the entries>' so the owner sees each one`];
  const fails = [];
  for (const n of changed) { const row = named.find((x) => x.name === n); if (!row) fails.push(`${approved} doesn't name remediations.${n}: ask again, naming it`); else if (row.entry_hash !== remediationEntryHash(to[n] ?? null)) fails.push(`remediations.${n} isn't what ${approved} showed the owner (${row.sha?.slice(0, 12) ?? 'removed'}): ask again`); }
  for (const r of named) if (!changed.includes(r.name)) fails.push(`${approved} names remediations.${r.name}, which this PR doesn't change: ask again, naming only what it changes`);
  return fails;
}
// Each repo link change a merge lands (linkFieldChanges, main against the head) needs an owner's
// answer whose question showed exactly that change (linkAnswerCovers): the --approved one, or an
// earlier yes for a field it never asked again about; and the --approved answer must cover one of
// them. A question changed after its answer approves nothing.
export function ownerLinkActFails(changed, sha, approved) {
  const keys = changed.filter((c) => c.key.startsWith('links.'));
  if (!keys.length) return [];
  const why = linkAnswerCovers.why(approved);
  if (why) return [why];
  const lands = settingsAt(sha, { orNull: true })?.links ?? {};
  const onMain = mainSettings(null)?.links ?? {};
  const key = linkFieldChanges.key;
  const cs = linkFieldChanges(onMain, lands);
  const mine = cs.filter((c) => linkAnswerCovers(approved, c));
  const bare = cs.filter((c) => !mine.includes(c) && !linkAnswerCovers.any(c)).map(key);
  if (bare.length) return [`changes ${bare.join(', ')}, which ${approved} did not approve: an answer lands only the changes its question showed, exactly as it showed them; ask the owner about ${bare.length > 1 ? 'these' : 'this one'} (link add|set|rm, whose question asks about every repo link change no answer covers yet), or take ${bare.length > 1 ? 'them' : 'it'} out of this PR`];
  if (cs.length && !mine.length) return [`${approved} approves none of the repo link changes this lands (${cs.map(key).join(', ')}): cite an answer that approved one of them`];
  return [];
}
// What the forge's check (optional) and `merge` both check for a PR, by branch kind. Gates are not
// run here. A chore PR may not touch the log (chore-log touches nothing else) or a ticket's folder.
// Every artifact a PR adds or changes passes artifact check's refusals as the PR would land it
// (read from the head's tree: there is no checkout of it). Warnings never block.
export function artifactRule(sha) {
  if (!commonDir || !projectInRepo) return [];
  const base = mainRef() ? git(['merge-base', mainRef(), sha]) : null;
  if (!base) return [];
  const pre = `${ARTIFACTS_REL}/`;
  const slugs = [...new Set(changedFiles(base, sha).filter((f) => f.startsWith(pre)).map((f) => f.slice(pre.length).split('/')[0]))];
  const fails = [];
  for (const s of slugs) {
    const entries = treeEntries(sha, `${ARTIFACTS_REL}/${s}`);
    if (!entries.length) continue; // removed: deleting an artifact is a PR that removes its folder
    fails.push(...artifactProblems(s, entries).errors.map((e) => `${pre}${e}`));
  }
  return fails;
}
export function checkPr({ headRef, sha, title, body, forge = false, repo: R = repo('home'), records, inHome }) {
  const branch = headRef.replace(/^refs\/heads\//, '');
  // A ticket's PR is in its own repo; plan and chore PRs are always home's.
  if (R.name !== 'home' && !branch.startsWith('ticket/')) return ["plan and chore PRs are always home's; a chore in another repo is a ticket of kind chore in its component"];
  if (branch.startsWith('ticket/') && tickets().has(branch.slice('ticket/'.length))) {
    const own = repoOfTicketLink(tickets().get(branch.slice('ticket/'.length)));
    // home's ticket/<id> of a records-in-home link ticket is its records branch: only its footprint
    // is home's to check here (its code, reviews and gates are checked with the link's PR)
    if (own !== R.name && R.name === 'home' && recordsInHomeId(branch.slice('ticket/'.length))) return recordsBranchFails(branch.slice('ticket/'.length), sha);
    if (own !== R.name) return [`${branch} is a ticket of ${own}, not ${R.name}`];
  }
  const fails = [...logRule(branch, sha, R), ...reviewRule(sha, { forge, repo: R }), ...(R.name === 'home' ? artifactRule(sha) : [])];
  // Every PR, every kind, ticket PRs included (they return on the next line): the tree that would
  // land keeps every path in exactly one line. A chore or settings PR gets this, never full
  // validate, so an old graph error can't block a log PR.
  const base0 = R.mainRef() ? R.git(['merge-base', R.mainRef(), sha]) : null;
  fails.push(...coverageFails(base0, sha, R, { ticket: branch.startsWith('ticket/') }), ...registryFails(base0, sha, R));
  // the sensors that would land: a changed sensors setting is checked as validate checks it
  if (R.name === 'home' && base0) {
    const [a, b] = [settingsAt(base0, { orNull: true }), settingsAt(sha, { orNull: true })];
    if (a && b && ['sensors', 'sensor_defaults'].some((k) => canonical(a[k]) !== canonical(b[k]))) fails.push(...sensorProblems(b).map((e) => `settings at landing: ${e}`));
  }
  // sensors are the supervisor's: no owner answer, and no ticket or plan either (a chore PR)
  if (R.name === 'home' && base0 && /^(ticket|plan)\//.test(branch)) {
    const [a, b] = [settingsAt(base0, { orNull: true }), settingsAt(sha, { orNull: true })];
    const keys = a && b ? ['sensors', 'sensor_defaults', 'sensor_scrub'].filter((k) => canonical(a[k]) !== canonical(b[k])) : [];
    const files = (changedFiles(base0, sha) ?? []).filter((f) => f.startsWith(`${projectRel}/sensors/`));
    if (keys.length || files.length) fails.push(`${branch} changes ${[...keys, ...files].slice(0, 4).join(', ')}: sensors are the supervisor's, so they land in a chore PR (chore start …), not a ticket or plan`);
  }
  // The jobs that would land (kit-162, recurringRegistry.landing): onto main as it is now, under the
  // merge method in force. A history the kit can't judge is a fail; main's own file not reading is
  // said and passes. When the landed jobs differ from main's: each entry's shape and the cap on the
  // landed jobs, and never from a ticket or plan. settings.md holds no jobs at the head.
  if (R.name === 'home' && mainSha()) {
    const L = recurringRegistry.landing(mainSha(), sha, R.settings.merge_method);
    if (L.warn) warn(L.warn);
    if (L.problem) fails.push(L.problem);
    else if (Object.keys(L.changed).length) {
      fails.push(...Object.entries(L.jobs).flatMap(([n, e]) => recurringEntryProblems(n, e)).map((e) => `at landing: ${e}`));
      // over the cap only when the change adds runs: a stop on a main over it by hand still lands (final-10b F4)
      const over = recurringRegistry.addsRuns(L.changed, L.main) ? recurringRegistry.capProblem(L.jobs, "main's jobs with this PR's changes; a check every n hours runs 24/n times, anything daily or slower once") : null;
      if (over) fails.push(`at landing: ${over}`);
      if (/^(ticket|plan)\//.test(branch)) fails.push(`${branch} changes the jobs (recurring.json): they are the owner's, so they land only in the supervisor's chore PR with the owner's answer (recurring apply), never from a ticket or plan`);
    }
    const own = settingsAt(sha, { orNull: true });
    if (own && Object.hasOwn(own, 'recurring')) fails.push(recurringRegistry.inSettings());
  }
  // a PR changing self.md: its contract, its parts' paths and the names hold (selfDraftLines), every kind
  if (R.name === 'home' && mainRef()) {
    const held = selfDraftLines(git(['merge-base', mainRef(), sha]), sha, branch);
    fails.push(...held.fails);
    for (const w of held.warns) out(`warn: ${w}`);
  }
  // a PR changing exterior.md: steps 1 to 3 at the head, the names rule and its words over every
  // version (exteriorDraftLines, kit-135); with no main, one warning
  if (R.name === 'home') {
    const held = exteriorDraftLines(mainRef() ? git(['merge-base', mainRef(), sha]) : null, sha, branch);
    fails.push(...held.fails);
    for (const w of held.warns) out(`warn: ${w}`);
  }
  if (branch.startsWith('ticket/')) return [...fails, ...checkTicket(branch.slice('ticket/'.length), { sha, title, body, approvals: !forge, records, inHome }), ...depsFails(branch.slice('ticket/'.length), R)];
  if (branch.startsWith('plan/')) {
    const feature = branch.slice('plan/'.length);
    if (title !== undefined && !title.startsWith(`plan-${feature}: `)) fails.push(`PR title must start with "plan-${feature}: "`);
    // validate --strict at the exact head, in a detached worktree of that head. It only reads the
    // plan and the log, so the checkout is not seeded: no worktree_files, no worktree_setup (a CI
    // runner has neither the project's untracked files nor its toolchain).
    const wt = detachedWorktree(sha, `check-${feature}`, repo('home'), { seed: false });
    try {
      execFileSync(process.execPath, [path.join(wt, 'docs', 'devteam', 'scripts', 'devteam.mjs'), 'validate', '--strict', '--plan', feature], { cwd: wt, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      fails.push(`validate --strict fails at ${sha.slice(0, 12)}:\n${(e.stdout ?? '').toString().trim()}`);
    } finally {
      git(['worktree', 'remove', '--force', wt], mainRoot);
    }
  } else {
    if (!/^chore-[a-z0-9]+([.-][a-z0-9]+)*: \S/.test(title ?? 'chore-x: y')) fails.push('a PR that is not from a ticket/ or plan/ branch is titled "chore-<slug>: <summary>"');
    const base = mainRef() ? git(['merge-base', mainRef(), sha]) : null;
    const changed = base ? changedFiles(base, sha) : [];
    const logDir = `${projectRel}/log/`;
    const stray = branch === LOG_BRANCH ? changed.filter((f) => !f.startsWith(logDir)) : changed.filter((f) => f.startsWith(logDir) || f.startsWith(`${projectRel}/tickets/`));
    if (stray.length) fails.push(`${branch === LOG_BRANCH ? 'chore-log changes only project/log' : 'a chore PR never touches project/log or project/tickets'}: ${stray.slice(0, 8).join(', ')}${stray.length > 8 ? ` (+${stray.length - 8})` : ''}`);
  }
  if (body !== undefined && !branch.startsWith('ticket/')) {
    const owd = oneWayDoorsSection(body);
    if (!owd.ok) fails.push(owd.why);
  }
  return fails;
}
// A ticket lands only after every ticket it depends on has, in whatever repo each is: across repos
// neither the branch (cut from its own repo's main) nor its gates can see a provider that hasn't
// landed. Home's main and R's are fetched by the caller; a third repo's main is fetched here. A
// dependency this machine can't read, or whose main it can't fetch, fails closed.
export function depsFails(id, R) {
  const t = tickets().get(id);
  const fails = [];
  const fetched = new Set(['home', R.name]);
  for (const d of t?.depends_on ?? []) {
    const dt = tickets().get(d);
    if (!dt) { fails.push(`cannot confirm ${d} is merged: there is no such ticket`); continue; }
    const name = repoOfTicketLink(dt);
    if (!repoReadable(name)) { const l = ownEntry(loadSettings().links, name); fails.push(`cannot confirm ${d} is merged: ${(l && LINK_KINDS[l.kind]?.reachable(l, name)) ?? `${name} is no repo link here`}`); continue; }
    const D = repo(name);
    if (!fetched.has(name)) {
      fetched.add(name);
      if (D.git(['config', '--get', 'remote.origin.url'], D.root) !== null) {
        const f = gitRun(['fetch', '--quiet', 'origin', D.settings.main_branch], D.root);
        if (f.status !== 0) { fails.push(`cannot confirm ${d} is merged: could not fetch origin ${D.settings.main_branch} in ${name}: ${redactUrl(firstLine(f.err)) || `exit ${f.status}`}`); continue; }
        D.resetCaches();
      }
    }
    if (!D.mergeShaFor(d)) fails.push(`depends on ${d}, which is not merged${name === 'home' ? '' : ` in ${name}`} yet: merge it first`);
  }
  return fails;
}
// Copy a repo's worktree_files from its main checkout into a new worktree.
// Then run its worktree_setup there (with DEVTEAM_MAIN set to that main checkout).
// What every gate and worktree_setup command sees: the main checkout of the repo it runs for
// (DEVTEAM_MAIN), home's (DEVTEAM_HOME: the kit and the live log), and a gitignored cache dir for
// build outputs and package caches shared across worktrees (quality.md §2).
// A gate run for a ticket's merge knows which ticket it checks (DEVTEAM_GATE_TICKET), so validate
// can fail it only for what is its own (D4 below).
export const gateEnv = (ticket, R = repo('home')) => { const cache = path.join(runDir, 'cache'); fs.mkdirSync(cache, { recursive: true }); return { ...process.env, DEVTEAM_MAIN: R.root, DEVTEAM_HOME: mainRoot, DEVTEAM_CACHE: cache, ...(ticket ? { DEVTEAM_GATE_TICKET: ticket } : {}) }; };
// The tools .tool-versions pins that this machine's asdf or mise hasn't installed. On a new machine
// worktree_setup otherwise fails under whatever runtime the system has, which reads as a project bug.
// Empty when there is no .tool-versions or neither manager is here (there is nothing to ask).
export function missingPins(root = mainRoot) {
  const pins = (readText(path.join(root, '.tool-versions')) ?? '').split('\n').map((l) => l.replace(/#.*/, '').trim().split(/\s+/)).filter((p) => p[0] && p[1] && !['system', 'latest'].includes(p[1]));
  // The first manager that is installed answers for every pin; one that isn't (ENOENT) passes to the
  // next. A probe that times out on a loaded machine proves nothing, so it counts as installed.
  for (const [bin, args] of [['asdf', (t, v) => ['where', t, v]], ['mise', (t, v) => ['where', `${t}@${v}`]]]) {
    const missing = [];
    let absent = false;
    for (const [t, v] of pins) {
      const r = spawnSync(bin, args(t, v), { cwd: root, stdio: 'ignore', timeout: 60000 });
      if (r.error?.code === 'ENOENT') { absent = true; break; }
      if (!r.error && r.status !== 0) missing.push(`${t} ${v}`);
    }
    if (!absent) return missing;
  }
  return [];
}
export const pinsHint = (miss = missingPins(), root = mainRoot) => (miss.length ? `this machine lacks the tools .tool-versions pins (${miss.join(', ')}): run asdf install (or mise install) in ${root}, then try again` : null);
// The setup marker (kit-596): <git dir>/devteam-setup in a session or chore worktree says its
// worktree_setup passed for this setup string and these lockfiles ({ v: 1, setup, files }, each a
// sha256), so a resume skips it unless one changed or worktree_setup_always. Only in a checkout of
// its own: a plain folder inside another checkout would share that one's git dir, and always runs
// its setup. s is the repo's effective settings. Runtime state, safe to delete.
export const setupMarker = Object.freeze({
  FILE: 'devteam-setup',
  LOCKFILES: ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'Gemfile.lock', 'uv.lock', 'poetry.lock', 'Pipfile.lock', 'Cargo.lock', 'go.sum', 'composer.lock'],
  gitDir(wt) {
    const top = sh('git', ['rev-parse', '--show-toplevel'], { cwd: wt });
    if (!top || realPath(top) !== realPath(wt)) return null;
    return sh('git', ['rev-parse', '--absolute-git-dir'], { cwd: wt }) || null;
  },
  // the lockfiles at the root and one folder down (dot-folders and symlinks left out), and each
  // worktree_copy key there
  state(wt, s) {
    const files = {};
    const add = (rel) => { try { const f = path.join(wt, rel); if (fs.lstatSync(f).isFile()) files[rel.split(path.sep).join('/')] = sha256(fs.readFileSync(f)); } catch {} };
    for (const l of setupMarker.LOCKFILES) add(l);
    let tops = [];
    try { tops = fs.readdirSync(wt, { withFileTypes: true }); } catch {}
    for (const d of tops) if (d.isDirectory() && !d.name.startsWith('.')) for (const l of setupMarker.LOCKFILES) add(path.join(d.name, l));
    for (const e of Array.isArray(s.worktree_copy) ? s.worktree_copy : []) if (isObj(e) && typeof e.key === 'string' && e.key && !path.isAbsolute(e.key) && !path.normalize(e.key).split(/[\\/]/).includes('..')) add(path.normalize(e.key));
    return { v: 1, setup: sha256(String(s.worktree_setup ?? '')), files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) };
  },
  // root (the repo's main checkout): a worktree_copy folder main has, whose key matches main's, but
  // that is missing here (deleted since: rm -rf node_modules) needs the setup, whatever the marker says
  needed(wt, s, root = null) {
    if (s.worktree_setup_always === true) return true;
    const g = setupMarker.gitDir(wt);
    if (!g) return true;
    let m;
    try { m = JSON.parse(fs.readFileSync(path.join(g, setupMarker.FILE), 'utf8')); } catch { return true; }
    const now = setupMarker.state(wt, s);
    if (!isObj(m) || m.v !== 1 || m.setup !== now.setup || !isObj(m.files)) return true;
    const keys = Object.keys(now.files);
    if (keys.length !== Object.keys(m.files).length || keys.some((k) => m.files[k] !== now.files[k])) return true;
    const ok = (p) => typeof p === 'string' && p !== '' && !path.isAbsolute(p) && !path.normalize(p).split(/[\\/]/).includes('..');
    const has = (p, link = true) => { try { const st = fs.lstatSync(p); return link || !st.isSymbolicLink(); } catch { return false; } };
    const same = (a, b) => { try { return fs.readFileSync(a).equals(fs.readFileSync(b)); } catch { return false; } };
    return !!root && (Array.isArray(s.worktree_copy) ? s.worktree_copy : []).some((e) => isObj(e) && ok(e.path) && ok(e.key) && !has(path.join(wt, e.path)) && has(path.join(root, e.path), false) && same(path.join(root, e.key), path.join(wt, e.key)));
  },
  write(wt, s) {
    const g = setupMarker.gitDir(wt);
    if (!g) return;
    try { fs.writeFileSync(path.join(g, setupMarker.FILE), `${JSON.stringify(setupMarker.state(wt, s))}\n`); } catch (e) { warn(`could not write the setup marker in ${g}: ${e.message}`); }
  },
  clear(wt) {
    const g = setupMarker.gitDir(wt);
    if (g) try { fs.rmSync(path.join(g, setupMarker.FILE), { force: true }); } catch {}
  },
});
// Machine-wide setup slots (kit-596): on one machine at most N worktree_setups of session and chore
// worktrees run at once, each through a runner (setupRunner) that holds a slot for its run. A slot is
// the folder ~/.devteam/setup-slots/<n> holding holder.json ({ id, pid, start, at }, then pgid and
// leader_start once the setup runs). Every step is a rename, so two takers never both get <n>, and a
// waiter frees a slot only when it is still the one it judged. lib is run as text on its own
// (node -e, beside setupRunner), so it closes over nothing here and requires what it uses.
export const setupSlots = Object.freeze({
  SLOT_WAIT: 75,
  PAST_DEADLINE: 124,
  DEFAULT: 2,
  MAX: 8,
  dir: () => path.join(os.homedir(), '.devteam', 'setup-slots'),
  lib: function () {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const cp = require('child_process');
    // DEFAULT and MAX as above (this text can't read them)
    const DEFAULT = 2;
    const MAX = 8;
    const UNREADABLE_MS = 10000;
    const LEFTOVER_MS = 60000;
    const OLD_MS = 15 * 60000;
    const RECHECK_MS = 60000;
    let attempts = 0;
    const rand = () => `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
    // a slot entry is a real folder or nothing the protocol made (a file, a symlink: a hand edit),
    // which holds no holder and is judged by its own (lstat) age
    const isDir = (p) => { try { return fs.lstatSync(p).isDirectory(); } catch { return false; } };
    const holderOf = (p) => (isDir(p) ? readJson(path.join(p, 'holder.json')) : null);
    const atMs = (h) => (typeof h?.at === 'number' ? h.at : Date.parse(h?.at));
    // a holder the protocol wrote whole: an id, a numeric pid and a readable at
    const whole = (h) => !!h && typeof h === 'object' && typeof h.id === 'string' && h.id !== '' && Number.isInteger(h.pid) && h.pid > 0 && Number.isFinite(atMs(h));
    // a pid (or, negative, a group) that exists; EPERM is someone else's, still alive
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
    // field 22 of /proc/<pid>/stat on Linux (after the command's closing paren), ps lstart elsewhere;
    // null when it can't be read, which never matches
    const proc = os.platform() === 'linux' && fs.existsSync('/proc/self/stat');
    function startTime(pid) {
      if (proc) {
        try { const t = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return t.slice(t.lastIndexOf(')') + 2).split(' ')[19] ?? null; } catch { return null; }
      }
      // one locale and zone, so runners started from different environments read the same text
      const r = cp.spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 10000, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } });
      return (r.status === 0 && r.stdout.trim()) || null;
    }
    const same = (pid, start) => { const s = startTime(pid); return s !== null && s === start; };
    function count(env, warn) {
      const v = env.DEVTEAM_SETUP_SLOTS;
      if (v === undefined) return DEFAULT;
      if (/^[0-9]+$/.test(v) && Number(v) >= 1 && Number(v) <= MAX) return Number(v);
      warn(`DEVTEAM_SETUP_SLOTS "${v}" is not a whole number from 1 to ${MAX}; using ${DEFAULT}`);
      return DEFAULT;
    }
    // The first free slot (or only slot `only`), taken: holder.json written and fsynced in a private
    // folder, then that folder renamed to <n>, which succeeds only where <n> is missing (or an empty
    // folder). A failure other than <n> being occupied (a read-only or full disk) is thrown: the
    // slots folder is broken, not busy.
    function take(dir, n, me, only = null) {
      for (let slot = only ?? 0; slot < (only === null ? n : only + 1); slot++) {
        const to = path.join(dir, String(slot));
        try { if (!fs.lstatSync(to).isDirectory() || fs.readdirSync(to).length) continue; } catch {}
        const tmp = path.join(dir, `.take-${me.id}-${++attempts}`);
        try {
          fs.mkdirSync(tmp);
          const fd = fs.openSync(path.join(tmp, 'holder.json'), 'w');
          try { fs.writeSync(fd, JSON.stringify({ ...me, at: new Date().toISOString() })); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
          fs.renameSync(tmp, to);
          return slot;
        } catch (e) {
          try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
          if (!(e.syscall === 'rename' && ['ENOTEMPTY', 'EEXIST', 'ENOTDIR'].includes(e.code))) throw e;
        }
      }
      return null;
    }
    // 'gone' (free it now), 'old' (held past 15 minutes: take it over) or 'held'. The id judged is
    // left in memo.judged[slot] (null: an unreadable holder) for free to compare against. A holder
    // already seen alive with the same start times is checked with kill(…, 0) only, and its start
    // times read again once a minute.
    function judge(dir, slot, memo, now = Date.now()) {
      memo.seen ??= new Map();
      memo.judged ??= {};
      const at = path.join(dir, String(slot));
      const h = holderOf(at);
      if (!whole(h)) {
        memo.judged[slot] = null;
        let st;
        try { st = fs.lstatSync(at); } catch { memo.judged[slot] = undefined; return 'gone'; }
        // younger, it may be a rewrite in flight
        return now - st.mtimeMs > UNREADABLE_MS ? 'gone' : 'held';
      }
      memo.judged[slot] = h.id;
      const key = `${h.id} ${h.pgid ?? ''}`;
      const hasGroup = Number.isInteger(h.pgid) && h.pgid > 0;
      let up;
      const seen = memo.seen.get(key);
      if (seen !== undefined && now - seen < RECHECK_MS) up = alive(h.pid) || (hasGroup && alive(-h.pgid));
      else {
        const runner = alive(h.pid) && same(h.pid, h.start);
        // the group lives unless its leader is alive with another start (a reused group id)
        const group = hasGroup && alive(-h.pgid) && !(alive(h.pgid) && !same(h.pgid, h.leader_start));
        up = runner || group;
        if (up) memo.seen.set(key, now);
      }
      if (!up) { memo.seen.delete(key); return 'gone'; }
      return now - atMs(h) > OLD_MS ? 'old' : 'held';
    }
    // Move <n> away, then remove it only if it still holds the holder judged (judgedId null: one
    // still unreadable); otherwise put it back untouched. True when it was removed.
    function free(dir, slot, judgedId) {
      const at = path.join(dir, String(slot));
      const away = path.join(dir, `.free-${Date.now()}-${rand()}`);
      try { fs.renameSync(at, away); } catch { return false; }
      const h = holderOf(away);
      const judged = judgedId === null ? !whole(h) : whole(h) && h.id === judgedId;
      if (judged) { try { if (isDir(away)) fs.rmSync(away, { recursive: true, force: true }); else fs.unlinkSync(away); } catch {} return true; }
      // <n> taken again meanwhile: the leftover is swept in a minute (the protocol's one gap)
      try { fs.renameSync(away, at); } catch {}
      return false;
    }
    // a runner's own slot, freed at its end; one taken over (another id at <n>) is left alone
    function release(dir, slot, myId) { free(dir, slot, myId); }
    // .take-* and .free-* folders a killed process left, removed past a minute (a .free-'s time is
    // in its name: renaming a folder keeps its old mtime)
    function sweep(dir, now = Date.now()) {
      let names;
      try { names = fs.readdirSync(dir); } catch { return; }
      for (const e of names) {
        if (!/^\.(take|free)-/.test(e)) continue;
        const p = path.join(dir, e);
        let t = Number(/^\.free-(\d+)-/.exec(e)?.[1]);
        if (!t) { try { t = fs.statSync(p).mtimeMs; } catch { continue; } }
        if (now - t > LEFTOVER_MS) try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
      }
    }
    return { count, take, judge, free, release, sweep, startTime };
  },
});
// The setup runner's main (kit-596), run as text by seedWorktree (node -e, with setupSlots.lib as
// slots), so self-contained. It takes a slot (waiting 1 s between rounds until config.deadline, or
// config.maxWaitMs with none), runs `sh -c config.cmd` as the leader of its own process group,
// forwards SIGINT, SIGTERM and SIGHUP to that group, kills the group at the deadline, releases the
// slot, and writes its report as one JSON line to fd 3: { outcome: 'ran' | 'no-slot' |
// 'waited-deadline' | 'deadline', code, signal, took_over }. Exit 0 (ran, the setup exited 0), 75 (no
// slot; or killed at the deadline after waiting for its slot, so the time lost was a slot wait), 124
// (killed at the deadline with its slot got at once), else 1.
export async function setupRunner(config, slots) {
  const fs = require('fs');
  const path = require('path');
  const { spawn } = require('child_process');
  const crypto = require('crypto');
  const say = (s) => process.stderr.write(`devteam: ${s}\n`);
  const warn = (s) => say(`warning: ${s}`);
  const tookOver = [];
  const report = (outcome, code = null, signal = null) => { try { fs.writeSync(3, `${JSON.stringify({ outcome, code, signal, took_over: tookOver })}\n`); } catch {} };
  const me = { id: crypto.randomBytes(8).toString('hex'), pid: process.pid, start: slots.startTime(process.pid) };
  const n = slots.count(process.env, warn);
  const dir = config.dir;
  let child = null;
  let finished = false;
  // While the setup runs a signal goes to its group. While waiting it ends the wait: handlers run
  // between whole steps, so nothing is half-taken; no report, so seedWorktree says the setup failed.
  const onSignal = (sig) => {
    if (finished) return;
    if (child) { try { process.kill(-child.pid, sig); } catch {} return; }
    process.exit(1);
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, onSignal);
  let slot = null;
  // at least one wait round (1 s) passed before the take
  let waited = false;
  // a slots folder that can't be made or written to stops no install: the setup runs without a slot
  let haveDir = true;
  const broken = (e) => {
    haveDir = false;
    warn(`no usable setup slots folder (${dir}: ${e.code ?? e.message}); running worktree_setup without a slot`);
    return null;
  };
  const take = (only) => { try { return slots.take(dir, n, me, only); } catch (e) { return broken(e); } };
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { broken(e); }
  if (haveDir) {
    const limit = config.deadline ?? Date.now() + config.maxWaitMs;
    const memo = {};
    let told = 0;
    for (;; waited = true) {
      const now = Date.now();
      slots.sweep(dir, now);
      slot = take();
      if (slot !== null || !haveDir) break;
      // gone ones are freed for anyone; an old one is freed and taken at once, at most one a round,
      // so a takeover never frees a slot for another waiter
      let freed = false;
      const old = [];
      for (let s = 0; s < n; s++) {
        const verdict = slots.judge(dir, s, memo, now);
        if (verdict === 'old') old.push([s, memo.judged[s]]);
        else if (verdict === 'gone' && slots.free(dir, s, memo.judged[s])) freed = true;
      }
      if (freed) { slot = take(); if (slot !== null || !haveDir) break; }
      if (old.length) {
        const [s, id] = old[0];
        let h = null;
        try { h = JSON.parse(fs.readFileSync(path.join(dir, String(s), 'holder.json'), 'utf8')); } catch {}
        if (h?.id === id && slots.free(dir, s, id)) {
          slot = take(s);
          if (slot !== null) {
            warn(`took over setup slot ${s}, held since ${h.at} by pid ${h.pid}`);
            tookOver.push({ slot: s, pid: h.pid, since: h.at });
            break;
          }
          if (!haveDir) break;
        }
      }
      if (!told || Date.now() - told >= 60000) {
        let inUse = 0;
        for (let s = 0; s < n; s++) try { fs.lstatSync(path.join(dir, String(s))); inUse++; } catch {}
        say(`waiting for a setup slot (${inUse} of ${n} in use on this machine)`);
        told = Date.now();
      }
      if (Date.now() >= limit) { report('no-slot'); process.exit(75); }
      await new Promise((r) => setTimeout(r, Math.max(0, Math.min(1000, limit - Date.now()))));
    }
  }
  child = spawn('sh', ['-c', config.cmd], { detached: true, stdio: 'inherit' });
  if (slot !== null && child.pid) {
    // the setup's group into the holder (temp file, fsync, rename), so a waiter sees it alive even
    // after this runner is gone
    try {
      const f = path.join(dir, String(slot), 'holder.json');
      const h = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (h.id === me.id) {
        const tmp = `${f}.${me.id}.tmp`;
        const fd = fs.openSync(tmp, 'w');
        try { fs.writeSync(fd, JSON.stringify({ ...h, pgid: child.pid, leader_start: slots.startTime(child.pid) })); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(tmp, f);
      }
    } catch {}
  }
  let timer = null;
  let hit = false;
  const arm = () => {
    if (config.deadline === null) return;
    const wait = config.deadline - Date.now();
    if (wait > 0) { timer = setTimeout(arm, Math.min(wait, 2147483647)); return; }
    hit = true;
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  };
  if (child.pid) arm();
  const [code, signal] = await new Promise((resolve) => {
    child.once('exit', (c, s) => resolve([c, s]));
    child.once('error', (e) => { warn(`could not start worktree_setup: ${e.message}`); resolve([null, null]); });
  });
  clearTimeout(timer);
  finished = true;
  if (slot !== null) slots.release(dir, slot, me.id);
  if (hit && waited) { report('waited-deadline', code, signal); process.exit(75); }
  if (hit) { report('deadline', code, signal); process.exit(124); }
  report('ran', code, signal);
  process.exit(code === 0 ? 0 : 1);
}
// A worktree of repo R is seeded from R's own settings and main checkout, never home's.
// A session or chore worktree (session) runs its setup through the setup runner, in a machine-wide
// slot and before DEVTEAM_SETUP_DEADLINE; a gate checkout runs it inline, as it always has.
export function seedWorktree(wt, { setup = true, repo: R = repo('home'), session = false } = {}) {
  const s = R.settings;
  for (const rel of s.worktree_files ?? []) {
    const from = path.join(R.root, rel);
    if (!fs.existsSync(from)) { warn(`worktree_files: ${rel} is not in ${R.name === 'home' ? 'the main checkout' : `${R.name}'s checkout (${R.root})`}`); continue; }
    fs.mkdirSync(path.dirname(path.join(wt, rel)), { recursive: true });
    fs.copyFileSync(from, path.join(wt, rel));
  }
  if (setup && s.worktree_setup && session) {
    // a resume whose setup already passed for this setup string and these lockfiles skips it
    if (!setupMarker.needed(wt, s, R.root)) return;
    setupMarker.clear(wt);
    const d = process.env.DEVTEAM_SETUP_DEADLINE;
    const deadline = d && Number.isFinite(Number(d)) ? Number(d) : null;
    // worktree_copy: main's installed folder into a worktree whose key file is byte-identical to
    // main's, through a temp sibling renamed into place, under the same deadline; any failure warns
    // and the setup runs without it
    const filesOf = (s.worktree_files ?? []).map((f) => path.normalize(String(f)).replace(/\/+$/, ''));
    const okRel = (p) => typeof p === 'string' && p !== '' && !path.isAbsolute(p) && !path.normalize(p).split(/[\\/]/).includes('..');
    for (const e of Array.isArray(s.worktree_copy) ? s.worktree_copy : []) {
      if (!isObj(e) || !okRel(e.path) || !okRel(e.key)) { warn(`worktree_copy: ${JSON.stringify(e)} is not { "path": "<dir>", "key": "<file>" } with both relative paths; skipped`); continue; }
      const rel = path.normalize(e.path).replace(/\/+$/, '');
      if (filesOf.some((f) => f === rel || f.startsWith(`${rel}/`) || rel.startsWith(`${f}/`))) { warn(`worktree_copy: ${e.path} is or holds a worktree_files entry, which stays the owner's to name; not copied`); continue; }
      const from = path.join(R.root, rel);
      const to = path.join(wt, rel);
      const tmp = `${to}.devteam-copy-${process.pid}`;
      // inside root once links are resolved (a missing path resolves as far as it exists)
      const inside = (p, root) => { const r = realPath(root); const q = realPathMade(p); return q === r || q.startsWith(`${r}${path.sep}`); };
      const skip = (why) => warn(`worktree_copy: ${e.path} not copied: ${why}`);
      try {
        // a copy a killed process left (its pid gone), and one of this pid's from before: swept
        // whatever the entry's state now, and only where the folder is the worktree's own
        const parent = path.dirname(to);
        if (fs.existsSync(parent) && inside(parent, wt)) {
          const prefix = `${path.basename(to)}.devteam-copy-`;
          for (const x of fs.readdirSync(parent)) {
            const pid = x.startsWith(prefix) ? Number(x.slice(prefix.length)) : NaN;
            if (Number.isInteger(pid) && (pid === process.pid || !pidAlive(pid))) fs.rmSync(path.join(parent, x), { recursive: true, force: true });
          }
        }
        const mainKey = path.join(R.root, e.key);
        const wtKey = path.join(wt, e.key);
        if (!fs.existsSync(mainKey) || !fs.existsSync(wtKey)) continue;
        if (!inside(mainKey, R.root) || !inside(wtKey, wt)) { skip(`its key ${e.key} resolves outside the checkout`); continue; }
        if (!fs.readFileSync(mainKey).equals(fs.readFileSync(wtKey))) continue;
        let st;
        try { st = fs.lstatSync(from); } catch { continue; }
        // a link (to a shared store, say) would be copied as the link, and the worktree's install
        // would write through it into main's
        if (st.isSymbolicLink()) { skip(`${from} is a symlink, and a copy of it would write into what it points to`); continue; }
        if (!inside(from, R.root)) { skip(`${from} resolves outside ${R.root}`); continue; }
        try { fs.lstatSync(to); continue; } catch {}
        if (!inside(parent, wt)) { skip(`${parent} resolves outside the worktree`); continue; }
        fs.mkdirSync(parent, { recursive: true });
        const timeLeft = () => (deadline === null ? undefined : deadline - Date.now());
        const cp = (args) => {
          const left = timeLeft();
          if (left !== undefined && left <= 0) return { status: null, error: { code: 'ETIMEDOUT' } };
          return spawnSync('cp', [...args, from, tmp], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', timeout: left, killSignal: 'SIGKILL' });
        };
        let r = os.platform() === 'darwin' ? cp(['-cR']) : os.platform() === 'linux' ? cp(['-a', '--reflink=auto']) : cp(['-R']);
        if (os.platform() === 'darwin' && r.status !== 0 && !r.error) { fs.rmSync(tmp, { recursive: true, force: true }); r = cp(['-R']); }
        if (r.status !== 0) throw new Error(r.error?.code === 'ETIMEDOUT' ? 'cut short at the deadline' : (r.stderr || r.error?.message || `exit ${r.status}`).trim().slice(0, 200));
        fs.renameSync(tmp, to);
      } catch (err) {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
        warn(`worktree_copy: could not copy ${e.path} from ${R.root} (${err.message}); worktree_setup runs without it`);
      }
    }
    const config = { cmd: s.worktree_setup, dir: setupSlots.dir(), deadline, maxWaitMs: 900000 };
    const r = spawnSync(process.execPath, ['-e', `const lib = (${setupSlots.lib})(); (${setupRunner})(JSON.parse(process.argv[1]), lib)`, JSON.stringify(config)], { cwd: wt, env: gateEnv(null, R), stdio: ['ignore', 'inherit', 'inherit', 'pipe'] });
    // decided from the report, never the exit code alone; none at all is a runner that crashed
    let rep = null;
    try { rep = JSON.parse(String(r.output?.[3] ?? '').trim().split('\n').pop()); } catch {}
    for (const t of rep?.took_over ?? []) {
      try { appendLog({ type: 'observation', source: 'kit', kind: 'setup-slot-taken-over', subject: `setup-slot-${t.slot}`, detail: `a worktree_setup for ${wt} took over setup slot ${t.slot}, held since ${t.since} by pid ${t.pid} (past 15 minutes)`, detector: 'kit', severity: 2, valence: -1, source_key: `setup-slot-taken-over ${t.slot} ${t.pid} ${t.since}` }); } catch {}
    }
    if (rep?.outcome === 'ran' && rep.code === 0) { setupMarker.write(wt, s); return; }
    if (rep?.outcome === 'no-slot') die('setup-slot-wait: no setup slot free before the deadline', setupSlots.SLOT_WAIT);
    if (rep?.outcome === 'waited-deadline') die(`setup-slot-wait: a setup slot came free too late for worktree_setup to finish before the deadline in ${wt}`, setupSlots.SLOT_WAIT);
    if (rep?.outcome === 'deadline') die(`worktree_setup ran past its deadline in ${wt}`, setupSlots.PAST_DEADLINE);
    const hint = pinsHint(missingPins(R.root), R.root);
    die(`worktree_setup failed in ${wt}${hint ? `; ${hint}` : ''}`);
  }
  if (setup && s.worktree_setup) {
    try {
      execFileSync('sh', ['-c', s.worktree_setup], { cwd: wt, stdio: ['ignore', 'inherit', 'inherit'], env: gateEnv(null, R) });
    } catch {
      const hint = pinsHint(missingPins(R.root), R.root);
      die(`worktree_setup failed in ${wt}${hint ? `; ${hint}` : ''}`);
    }
  }
}
// git dies on a sibling's .git/worktrees/<name>/commondir that is there and still empty: another
// worktree add, between making the file and filling it. Every add and fetch reads them all. run
// (which returns at least { ok, err }) is tried again once that file is filled or gone, for 5 s in all
// (clock shares the 5 s between calls); any other failure is returned at once. A commondir that can't
// be read is another failure, and so is one once the worktree (wt) is there: a hook's; so is one that
// names this add's own entry, which its gitdir tells, or one that was never there. The path in git's
// line is matched, not its words, which follow the locale. before() is called before each try and
// after() once it failed; stop() says, after a wait, why not to try again. Returned: run's answer,
// with waited (whether any wait was) and note (a line to add to git's words, or '').
export function pastHalfMade(run, { common, wt = null, clock = {}, before = () => {}, after = () => {}, stop = () => null }) {
  const LIMIT_S = 5;
  const dir = path.join(common, 'worktrees');
  const half = (name) => { try { return fs.readFileSync(path.join(dir, name, 'commondir'), 'utf8') === ''; } catch (e) { return e.code === 'ENOENT' ? false : null; } };
  const entries = () => { try { return fs.readdirSync(dir); } catch { return []; } };
  const own = (name) => { if (!wt) return false; const at = path.join(dir, name); try { return realPathMade(path.resolve(at, fs.readFileSync(path.join(at, 'gitdir'), 'utf8').trim())) === realPathMade(path.join(wt, '.git')); } catch { return false; } };
  for (let waited = false; ;) {
    before();
    const listed = entries();
    const r = run();
    if (r.ok) return { ...r, waited, note: '' };
    after();
    const name = /worktrees\/([^/\n]+)\/commondir/.exec(r.err ?? '')?.[1];
    const seen = name !== undefined && (listed.includes(name) || entries().includes(name)) && !own(name);
    if (!seen || (wt && fs.existsSync(wt)) || half(name) === null) return { ...r, waited, note: '' };
    waited = true;
    clock.end ??= performance.now() + LIMIT_S * 1000;
    do Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); while (half(name) && performance.now() < clock.end);
    const why = stop();
    if (performance.now() < clock.end && !why) continue;
    return { ...r, waited, note: why ? `\n${why}` : half(name) ? `\nthe entry ${name} in ${dir} was still half made after ${LIMIT_S} s (its commondir is empty): another git may be making that worktree, or stopped while it did` : '' };
  }
}
// git worktree add past a sibling's half-made entry, dying as gitOrDie does. args: the add's, or a
// function that gives them anew for each try (a failed one can leave its branch).
export function worktreeAddOrDie(args, wt, { root, common }) {
  let last;
  const r = pastHalfMade(() => {
    last = typeof args === 'function' ? args() : args;
    try { execFileSync('git', last, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return { ok: true }; } catch (e) { return { ok: false, err: e.stderr, words: (e.stderr || e.message).toString().trim() }; }
  }, { common, wt });
  if (!r.ok) die(`git ${last.join(' ')} failed: ${r.words}${r.note}`);
}
