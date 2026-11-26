/* imports start */
import fs from 'node:fs';
import path from 'node:path';
import { GITLEAKS_FILE } from './links.mjs';
import { KIT_CLASSES } from './settings.mjs';
import { OFF_LINE } from './reviews.mjs';
import { RUNG } from './links.mjs';
import { SUPERVISOR_LINK_CLASSES } from './links.mjs';
import { appendLog } from './log-sync.mjs';
import { changedFiles } from './reviews.mjs';
import { checkPr } from './check-ticket.mjs';
import { choreSlug } from './goals.mjs';
import { ciFixApproval } from './pr-checks.mjs';
import { citing } from './questions.mjs';
import { covered } from './observe.mjs';
import { decisionFor } from './questions.mjs';
import { deployingFiles } from './world-model.mjs';
import { detachedWorktree } from './pr-checks.mjs';
import { die } from './base.mjs';
import { execFileSync } from 'node:child_process';
import { fetchMain } from './log-sync.mjs';
import { flagStr } from './base.mjs';
import { flags } from './base.mjs';
import { forgeCheckFails } from './world-model.mjs';
import { forgeCoverage } from './world-model.mjs';
import { gateAdditions } from './settings.mjs';
import { gateEnv } from './check-ticket.mjs';
import { git } from './base.mjs';
import { gitRun } from './reviews.mjs';
import { goalMode } from './holds.mjs';
import { holdWords } from './holds.mjs';
import { isKitFile } from './links.mjs';
import { isObj } from './artifact-notes.mjs';
import { isRecordKeeping } from './goals.mjs';
import { keepTests } from './spend.mjs';
import { ladder } from './links.mjs';
import { landRecords } from './world-model.mjs';
import { logGet } from './log-sync.mjs';
import { logObjects } from './log-sync.mjs';
import { mainLogCache } from './repos.mjs';
import { mainRef } from './log.mjs';
import { mainRoot } from './state.mjs';
import { mainSha } from './log.mjs';
import { mergeShaCache } from './repos.mjs';
import { out } from './base.mjs';
import { ownerAnswer } from './world-model.mjs';
import { ownerLinkActFails } from './check-ticket.mjs';
import { ownerRuleFor } from './log-sync.mjs';
import { ownerSettingsChanged } from './settings.mjs';
import { pathMatches } from './graph.mjs';
import { pinRecords } from './world-model.mjs';
import { positional } from './base.mjs';
import { projectRel } from './settings.mjs';
import { readJunit } from './spend.mjs';
import { recordsHomeSetting } from './repos.mjs';
import { recordsInHomeId } from './repos.mjs';
import { recurringBindingFails } from './recurring.mjs';
import { recurringRegistry } from './recurring.mjs';
import { registryActFails } from './check-ticket.mjs';
import { releaseAnswerGap } from './world-model.mjs';
import { remediationBindingFails } from './check-ticket.mjs';
import { repo } from './repos.mjs';
import { repoOfTicket } from './repos.mjs';
import { report } from './log-sync.mjs';
import { resolveCommit } from './log-sync.mjs';
import { runDir } from './state.mjs';
import { rungFor } from './trust.mjs';
import { secretStores } from './secrets.mjs';
import { secretsAllowlistApproval } from './pr-checks.mjs';
import { settingsAt } from './settings.mjs';
import { slug } from './base.mjs';
import { supervisorOnly } from './log.mjs';
import { ticketMode } from './holds.mjs';
import { tickets } from './graph.mjs';
import { upkeepOrVirtual } from './holds.mjs';
import { upstreamSyncApproval } from './pr-checks.mjs';
import { warn } from './base.mjs';
import { worldFileFails } from './pr-checks.mjs';
/* imports end */
export function cmdMerge() {
  supervisorOnly('merge');
  const [id] = positional;
  const plan = flagStr('plan');
  const chore = flagStr('chore') !== undefined ? choreSlug(flagStr('chore')) : undefined;
  const dry = !!flags['dry-run'];
  const branch = plan ? `plan/${plan}` : chore ? `chore-${chore}` : id ? `ticket/${id}` : die('usage: merge <ticket-id> | merge --plan <feature> | merge --chore <slug>   [--approved <qid>] [--no-gates] [--dry-run [--title t] [--body-file f]]');
  // A ticket merges in its own repo: its PR, gates, forge and merge method; plans and
  // chores are always home's. For home R is today's functions and settings.
  const R = id && tickets().has(id) ? repoOfTicket(tickets().get(id)) : repo('home');
  const S = R.settings;
  const onR = R.name === 'home' ? {} : { repo: R.name };
  const inR = R.name === 'home' ? '' : ` in ${R.name}`;
  const viaGit = S.forge === 'git';
  if (viaGit && !flagStr('title') && !flagStr('body-file')) {
    // The PR, with no forge: run/pr/<branch>.md in home's run/ (ticket ids are unique across
    // repos), a '# <title>' line then the body (worker.md §8).
    const f = path.join(runDir, 'pr', `${branch}.md`);
    if (fs.existsSync(f)) {
      const first = fs.readFileSync(f, 'utf8').split('\n')[0];
      if (first.startsWith('# ')) { flags.title = first.slice(2).trim(); flags['body-file'] = f; }
    }
  }
  if (viaGit && !dry && !(flagStr('title') && flagStr('body-file'))) die(`forge is git: merge needs the PR text, in ${path.relative(mainRoot, path.join(runDir, 'pr', `${branch}.md`))} ('# <title>' then the body) or as --title and --body-file`);
  // Every gh call merge makes is killed at its bound (kit-787, kit-793): gh pr merge at 60 s, each read
  // at 15 s (DEVTEAM_GH_TIMEOUT_MS, a positive whole number of ms, sets both, only while DEVTEAM_TEST
  // is set, for tests). Before and in the gates: this PR read, pinRecords' two reads of home's records
  // PR, and the covered_by read; after them each landing's (landCode below, landRecords). So a ticket's
  // gh calls wait at most 15 + 15 + 109 = 139 s (the PR read, the covered_by read, the landing), and
  // 15 + 2 x 15 + 15 + 109 + 109 = 278 s with records in home. A killed call reads as failed: a read as
  // no answer, gh pr merge as not merged (its state is read, as for any error); refused as before
  const ghMs = process.env.DEVTEAM_TEST ? Math.trunc(Number(process.env.DEVTEAM_GH_TIMEOUT_MS)) : NaN;
  const ghSet = Number.isSafeInteger(ghMs) && ghMs > 0;
  const ghMerge = { timeout: ghSet ? ghMs : 60000, killSignal: 'SIGKILL' };
  const ghRead = { timeout: ghSet ? ghMs : 15000, killSignal: 'SIGKILL' };
  const prJson = viaGit ? null : R.gh(['pr', 'view', branch, '--json', 'number,headRefOid,title,body,isDraft,mergeStateStatus,state,url,statusCheckRollup'], ghRead);
  if (prJson === null && !dry && !viaGit) die(`no open PR from ${branch}${inR} (gh pr view failed or did not answer; with no forge CLI set forge: "git")`);
  R.git(['fetch', '--quiet', 'origin', branch]);
  // main as each origin has it now: home's (the settings) and the ticket's repo's (what it lands on)
  fetchMain(R);
  const pr = prJson !== null ? JSON.parse(prJson) : { headRefOid: R.resolveCommit(`origin/${branch}`) ?? R.resolveCommit(branch) ?? die(`no branch ${branch}${inR}`), title: flagStr('title'), body: flagStr('body-file') ? fs.readFileSync(flagStr('body-file'), 'utf8') : undefined };
  if (pr.isDraft) die(`${pr.url} is a draft`);
  const sha = pr.headRefOid;
  if (!R.resolveCommit(sha)) die(`cannot find ${sha} locally after fetching ${branch}${inR}`);
  // Merged already (a second run, a stale background job): nothing lands, nothing is logged. The
  // forge still shows a merged PR, and its head is on main.
  const mainBranch0 = S.main_branch;
  R.git(['fetch', '--quiet', 'origin', mainBranch0]);
  // main as the checks judge it: the code lands onto exactly this commit, or not at all (kit-162).
  // home's is mainSha(), the main checkPr's recurringRegistry.landing judges, so the landing and the land agree
  let checkedMain = R.name === 'home' ? mainSha() : R.resolveCommit(`origin/${mainBranch0}`);
  // A landing whose push timed out may still have landed (final-13 F1): when main is exactly the kit's
  // own landing merge of this head, as it recorded it before the push, whatever its message, with the
  // tree merge builds from its parents (kitMergeOf: final-15 F1, final-16 F1 and F2), and no
  // act for it was logged, this run checks the head onto the main it landed on (main is pinned there
  // for every check, so their base is that main, not the head), lands nothing, and logs its act as a
  // normal landing; checks that refuse it log nothing. Anything else already on main is a second run:
  // nothing lands, nothing is logged.
  let relanded = null;
  let unpinCode = null;
  if (checkedMain && R.git(['merge-base', '--is-ancestor', sha, checkedMain]) !== null) {
    const cls0 = id ? 'merge-word' : plan ? 'approve-feature-plan' : 'merge-chore';
    const logged = logObjects('act').some((a) => a.class === cls0 && String(a.what ?? '').startsWith(`merged ${branch} at ${sha}`) && (a.repo ?? null) === (onR.repo ?? null));
    const own = viaGit && !logged ? recurringRegistry.kitMergeOf((args) => R.git(args), checkedMain, sha, `${pr.title}\n\n${(pr.body ?? '').trim()}\n\nMerged ${branch} at ${sha}`, recurringRegistry.landingFile(R.name, branch, sha), R.root, mainBranch0) : null;
    if (own?.noReflog) die(recurringRegistry.noReflog(`${branch}${inR} at ${sha.slice(0, 12)}: main's tip ${checkedMain.slice(0, 12)} is a landing merge recorded for this head onto ${own.unseen.slice(0, 12)}`, mainBranch0));
    if (own?.unseen) die(`${branch}${inR} at ${sha.slice(0, 12)}: main's tip ${checkedMain.slice(0, 12)} is a landing merge recorded for this head onto ${own.unseen.slice(0, 12)}, which this clone never saw as origin's ${mainBranch0}: not the kit's own landing; nothing logged (${own.lookalike}). Someone else made that merge and planted its record: verify from the start`);
    if (own?.lookalike && own.recorded) die(`${branch}${inR} at ${sha.slice(0, 12)}: main's tip ${checkedMain.slice(0, 12)} is a landing merge recorded for this head, but not the tree the kit's merge of its parents builds: not the kit's own landing; nothing logged (${own.lookalike}). Someone else made that merge, or planted its record: verify from the start`);
    if (own?.lookalike) die(`${branch}${inR} at ${sha.slice(0, 12)}: main's tip ${checkedMain.slice(0, 12)} has the kit's landing message and parents, but it isn't the landing merge the kit recorded for this head before its push: not the kit's own landing; nothing logged (${own.lookalike}). Someone else made that merge: verify from the start`);
    if (!own) return out(`${branch}${inR} at ${sha.slice(0, 12)} is already on ${mainBranch0}: nothing to merge, nothing logged`);
    relanded = { tip: checkedMain, onto: own.onto };
    out(`${branch}${inR} at ${sha.slice(0, 12)} is on ${mainBranch0} in the kit's own landing merge ${checkedMain.slice(0, 12)}, with no act logged (a push that timed out, which origin took): checking it onto ${own.onto.slice(0, 12)}, the main it landed on, to log its landing`);
    checkedMain = own.onto;
    unpinCode = recurringRegistry.pinMain(R, own.onto);
  }
  // records in home: one pinned home commit, checked here and landed below. Decided once, at the
  // head, after fetching home's ticket/<id>, so records pushed from another clone count (home wins)
  if (id && tickets().has(id) && recordsHomeSetting(tickets().get(id))) gitRun(['fetch', '--quiet', 'origin', `+refs/heads/ticket/${id}:refs/remotes/origin/ticket/${id}`]);
  const inHome = !!id && tickets().has(id) && recordsInHomeId(id, { at: sha });
  const rec = inHome ? pinRecords(id) : null;
  const recordsLanded = () => logObjects('act').some((a) => a.class === 'merge-word' && String(a.what ?? '').startsWith(`merged home's ticket/${id} at ${rec.sha}: the records of ${id},`));
  // records landed by a push that timed out, with no act: adopted when home's main is exactly the
  // records merge the kit recorded before that push (final-13 F1, final-15 F1), and then checked, as
  // the code is, onto the home main they landed on (home's main pinned there for checkPr). Records
  // with the kit's message and parents that it never recorded are refused, and nothing is logged.
  let recOwn = null;
  if (rec?.landed && repo('home').settings.forge === 'git' && !recordsLanded()) {
    const tip = resolveCommit(`origin/${repo('home').settings.main_branch}`);
    const own = tip ? recurringRegistry.kitMergeOf((args) => git(args), tip, rec.sha, recurringRegistry.recordsMessage(id, rec.sha, R.name), recurringRegistry.landingFile('home', `records-${id}`, rec.sha), mainRoot, repo('home').settings.main_branch) : null;
    if (own?.noReflog) die(recurringRegistry.noReflog(`the records of ${id} at ${rec.sha.slice(0, 12)}: home's main tip ${tip.slice(0, 12)} is a records merge recorded for them onto ${own.unseen.slice(0, 12)}`, repo('home').settings.main_branch));
    if (own?.unseen) die(`the records of ${id} at ${rec.sha.slice(0, 12)}: home's main tip ${tip.slice(0, 12)} is a records merge recorded for them onto ${own.unseen.slice(0, 12)}, which this clone never saw as origin's ${repo('home').settings.main_branch}: not the kit's own records merge; nothing logged (${own.lookalike}). Someone else made that merge and planted its record: verify from the start`);
    if (own?.lookalike && own.recorded) die(`the records of ${id} at ${rec.sha.slice(0, 12)}: home's main tip ${tip.slice(0, 12)} is a records merge recorded for them, but not the tree the kit's merge of its parents builds: not the kit's own records merge; nothing logged (${own.lookalike}). Someone else made that merge, or planted its record: verify from the start`);
    if (own?.lookalike) die(`the records of ${id} at ${rec.sha.slice(0, 12)}: home's main tip ${tip.slice(0, 12)} has the kit's records message and parents, but it isn't the records merge the kit recorded before its push: not the kit's own records merge; nothing logged (${own.lookalike}). Someone else made that merge: verify from the start`);
    if (own) { recOwn = { tip, onto: own.onto }; out(`the records of ${id} at ${rec.sha.slice(0, 12)} are on home's ${repo('home').settings.main_branch} in the kit's own records merge ${tip.slice(0, 12)}, with no act logged (a push that timed out, which origin took): checking them onto ${own.onto.slice(0, 12)}, the main they landed on, to log their landing`); }
  }
  const unpinRecords = recOwn ? recurringRegistry.pinMain(repo('home'), recOwn.onto) : null;
  const fails = checkPr({ headRef: branch, sha, title: pr.title, body: pr.body, repo: R, ...(id && tickets().has(id) ? { inHome } : {}), ...(inHome ? { records: rec.sha ?? null } : {}) });
  if (unpinRecords) unpinRecords();
  if (rec?.problems) fails.push(...rec.problems);
  // A refused footprint is a sign about the line (line-pressure): one observation per head.
  if (id && fails.some((x) => x.startsWith(OFF_LINE))) {
    const key = `footprint:${id}:${sha}`;
    if (!logObjects('observation').some((o) => o.source_key === key)) appendLog({ type: 'observation', source: 'supervisor', subject: tickets().get(id)?.component ?? id, kind: 'footprint-refusal', detail: `${id} at ${sha.slice(0, 12)} changes files outside its line`, source_key: key, refs: [id] }, 'supervisor');
  }
  // A parked or let-go goal's ticket waits to merge (a draining one merges: that's the point), and
  // so does an upkeep chore while Upkeep is parked; record-keeping chores never wait. --force does.
  const heldBy = id && tickets().has(id) ? ticketMode(tickets().get(id)) : chore && !isRecordKeeping(chore) ? goalMode(upkeepOrVirtual()) : 'run';
  if (['park', 'let-go'].includes(heldBy) && !flags.force) fails.push(`its goal is ${holdWords(heldBy)}: it merges when the goal runs or drains again (planning.md §1, holds); --force merges it anyway, logged`);
  // A plan's ticket ids are new: one already on main (another plan took the number) is refused
  // outright; renumber on the branch.
  if (plan) {
    const by = `plan-${plan}`;
    const onMain = tickets();
    const text = git(['show', `${sha}:${projectRel}/log/${by}.jsonl`]) ?? '';
    const dup = [...new Set(text.split('\n').filter(Boolean).map((t) => { try { return JSON.parse(t); } catch { return null; } }).filter((o) => o?.type === 'ticket' && o.op === 'new' && onMain.has(o.id) && onMain.get(o.id).created_by !== by).map((o) => o.id))];
    if (dup.length) fails.push(`ticket id${dup.length > 1 ? 's' : ''} already on main: ${dup.join(', ')}; renumber them on ${branch} (from its reserved block) and ask again`);
  }
  if (['BEHIND', 'DIRTY'].includes(pr.mergeStateStatus)) fails.push(`PR is ${pr.mergeStateStatus.toLowerCase()} relative to main; the author merges main and asks again`);
  // The forge's own checks at this head (CI, a deploy pipeline): pending is not passed and failing
  // fails, whether or not branch protection marks them required. The owner can name checks to
  // skip (settings ignored_checks, gate-change).
  fails.push(...forgeCheckFails(pr, S.ignored_checks, sha));
  // A chore PR that changes files outside project/ (the agent config, the forge config) carries an
  // owner answer; real kit files need it in a kit class (KIT_CLASSES). project/ files are the supervisor's.
  let approved = flagStr('approved') ?? null;
  let standing = null;
  // gates this PR adds as the supervisor's own call (gateAdditions): run at its head below, and
  // logged as their own gate-add act once it lands
  let gateAdds = null;
  // owner-classed settings changes (home only) and a chore's files outside project/, for the
  // link-landing rule under --approved below
  let ownerChanged = null;
  let choreOutside = [];
  // the jobs (recurring.json, kit-162): whether this PR changes them, whether --approved is a
  // recurring-edit answer (each holds a chore to project/ files below), and the Upkeep hold this
  // merge was forced past, for the act's words
  let jobsChanged = false;
  let jobAnswer = false;
  let jobsForced = null;
  // what the checks said lands at the jobs file (recurringRegistry.landing, home only): the landing
  // merge is held to it before its push (final-10 F1)
  let landsJobs = null;
  { const aq = approved ? logGet(approved) : null; jobAnswer = aq?.type === 'question' && aq.class === 'recurring-edit'; }
  // a linked repo's ticket never changes home's jobs file, so it never lands a job change (task-2 F3)
  if (R.name !== 'home' && jobAnswer) fails.push(`${approved} approves job changes in this repo's recurring.json: land it in a chore PR here`);
  // Owner-only settings, on every kind of PR (a ticket, a plan or a chore) in home, where
  // settings.md is: another repo's PR can't change it.
  if (R.name === 'home') {
    const base = mainRef() ? git(['merge-base', mainRef(), sha]) : null;
    // The jobs that land onto the checked main (recurringRegistry.landing), against main's: a change
    // is the owner's recurring-edit. A landing problem is checkPr's fail line already, which refuses
    // the PR on its own; it isn't read as a job change too. A main file that doesn't read is {}.
    const L = checkedMain ? recurringRegistry.landing(checkedMain, sha, S.merge_method) : null;
    landsJobs = L;
    jobsChanged = !!L && !L.problem && Object.keys(L.changed).length > 0;
    const classed0 = base ? ownerSettingsChanged(base, sha) : [];
    const classed = classed0 && [...classed0, ...(jobsChanged ? [{ key: 'recurring', cls: 'recurring-edit' }] : [])];
    // One answer, one change: read before the supervisor's own classes are taken out, so any other
    // change (an owner key, a gate the supervisor adds alone, a link) splits the PR, whatever --approved is.
    if (jobsChanged && classed?.length > 1) fails.push(`changes the jobs (recurring.json) and also ${classed.filter((c) => c.key !== 'recurring').map((c) => c.key).join(', ')}: one answer lands one change, so split this into two PRs`);
    // Only a chore: the supervisor's own PR. A plan PR is a planner's, and a ticket's can't change
    // settings.md at all, so a gate added there is still the owner's gate-change.
    const gateAdd = classed?.some((c) => c.key === 'gates') ? (chore ? gateAdditions(base, sha) : { problem: 'only the supervisor\'s own chore PR adds a gate without the owner' }) : null;
    if (gateAdd?.added?.length) { gateAdds = gateAdd.added.map((n) => [n, settingsAt(sha).gates[n]]); out(`adds gate${gateAdds.length > 1 ? 's' : ''} ${gateAdd.added.join(', ')} and leaves main's as they are: a new check is the supervisor's call (constitution.md §4), to be logged as a gate-add act when it lands`); }
    const changed = classed?.filter((c) => !SUPERVISOR_LINK_CLASSES.includes(c.cls) && !(c.key === 'gates' && gateAdds)) ?? null;
    ownerChanged = changed;
    fails.push(...registryActFails(base, sha));
    fails.push(...worldFileFails(base, sha, approved, worldFileFails.actOf(branch)));
    if (changed === null) fails.push(`${projectRel}/settings.md: the json devteam block is not valid JSON at the head`);
    else if (changed.length) {
      const classes = [...new Set(changed.map((c) => c.cls))];
      const what = changed.map((c) => `${c.key} (${c.cls})`).join(', ');
      const gatesWhy = gateAdd?.problem && changed.some((c) => c.key === 'gates') ? ` (gates: ${gateAdd.problem}; only adding a gate is the supervisor's)` : '';
      // A standing rule the owner gave themselves settles a class in owner_rules (constitution.md):
      // only when every changed setting is of such a class, and only the owner's own accepted rule.
      // Never for the jobs: only an answer that showed the exact change lands one (kit-162).
      const ruled = !approved && !classes.includes('recurring-edit') && classes.every((c) => (ladder().owner_rules ?? []).includes(c)) && classes.map((c) => ownerRuleFor(c)).every(Boolean);
      if (ruled) { const rs = classes.map((c) => ownerRuleFor(c)); standing = { rule: rs[0] }; out(`changes owner settings: ${what}; approved by the owner's standing rule${rs.length > 1 ? 's' : ''} ${rs.map((r) => `${r.id} ("${r.statement}")`).join(', ')}`); }
      else if (!approved) fails.push(`changes owner settings: ${what}${gatesWhy}; the owner's answer is needed: --approved <qid> of class ${classes.join(' or ')}`);
      else {
        const q = ownerAnswer(approved, 'merge --approved');
        // a landing of repo link changes only: either class of the owner's link questions (each change is bound to the line its answer showed, ownerLinkActFails)
        const linksOnly = changed.every((c) => c.key.startsWith('links.')) && ['governance-edit', 'gate-change'].includes(q.class);
        if (!classes.includes(q.class) && !linksOnly) fails.push(`${approved} is a ${q.class ?? 'classless'} question; changing ${what} needs an answered ${classes.join(' or ')} question`);
        fails.push(...ownerLinkActFails(changed, sha, approved));
        fails.push(...remediationBindingFails(base, sha, approved));
      }
    }
    // The jobs' binding: whenever --approved is a recurring-edit answer, the PR changing the jobs or
    // not (it then lands none of what the answer showed), on the jobs that land against main's.
    if (approved && jobAnswer && L && !L.problem) fails.push(...recurringBindingFails(L.main, L.jobs, approved));
    // A change to the jobs, or the recurring chore, waits while Upkeep is drained or parked, whatever
    // its slug (record-keeping ones too); heldBy's own refusal, when it has one, is the one given.
    const jobsHold = chore === 'recurring' || jobsChanged ? goalMode(upkeepOrVirtual()) : 'run';
    if (jobsHold !== 'run' && !['park', 'let-go'].includes(heldBy)) {
      if (flags.force) jobsForced = jobsHold === 'drain' ? 'drained' : holdWords(jobsHold);
      else if (jobsHold === 'drain') fails.push('Upkeep is drained: a change to the jobs lands when Upkeep runs (goal hold upkeep run --owner); --force lands it anyway, logged');
      else fails.push(`its goal is ${holdWords(jobsHold)}: it merges when the goal runs or drains again (planning.md §1, holds); --force merges it anyway, logged`);
    }
  }
  // Deploys on merge: merging this is releasing it, so it needs release-production's authority: the
  // class on rung 3, or a release-production decision this merge carries out (--decision).
  // In the ticket's own repo, under that repo's release setting (a link inherits home's).
  let release = null;
  // the decision is checked like an act's (decisionFor: not corrected, not lapsed, its recorded
  // authority holds against the log, its owner answer not used for anything else)
  const decided = flagStr('decision') ? decisionFor(flagStr('decision')) : null;
  const releaseDecision = decided?.class === 'release-production' ? decided : null;
  // A decision is carried out once per target: an act already under it for this PR (a merge on
  // another branch, an earlier landing) means it was used, so decide again. One decision naming
  // several targets (a batch) carries out each once; a release decision has its own check below.
  const targetsNow = [id ?? (chore ? `chore-${chore}` : plan), plan ? `plan-${plan}` : null].filter(Boolean);
  const carriedOut = decided && !releaseDecision ? logObjects('act').find((a) => a.decision === decided.id && (!(a.refs ?? []).length || a.refs.some((r) => targetsNow.includes(r)))) : null;
  if (carriedOut) fails.push(`${decided.id} was already carried out for ${targetsNow[0]} (${carriedOut.id}: ${String(carriedOut.what ?? '').slice(0, 80)}); a decision is carried out once per target, so decide again for this one`);
  {
    const base = R.mainRef() ? R.git(['merge-base', R.mainRef(), sha]) : null;
    const dep = deployingFiles(R, base, sha);
    const deploys = dep.files ?? [];
    const target = id ?? (chore ? `chore-${chore}` : plan);
    const targets = [target, plan ? `plan-${plan}` : null].filter(Boolean);
    if (dep.warning) warn(dep.warning);
    if (dep.problem) fails.push(dep.problem);
    else if (deploys.length) {
      const d = releaseDecision;
      const rung = rungFor('release-production');
      // One release decision is carried out once per target: a second merge of the same chore slug
      // (or the same decision cited again) decides again.
      const done = d && logObjects('act').find((a) => a.decision === d.id && a.class === 'release-production' && (a.refs ?? []).some((r) => targets.includes(r)));
      const unbound = d && releaseAnswerGap(d, targets);
      if (d && !(d.refs ?? []).some((r) => targets.includes(r))) fails.push(`${d.id} releases ${(d.refs ?? []).join(', ') || 'nothing named'}, not ${target}; decide again for this one`);
      else if (unbound) fails.push(`${d.id} ${unbound}`);
      else if (done) fails.push(`${d.id} was already carried out for ${target} (${done.id}); a release decision releases once: decide again for this one`);
      else if (d) release = { decision: d.id, target };
      else if (rung >= 3) release = { rung, target };
      else fails.push(`merging deploys to production${inR} (release: merge; it changes ${deploys.slice(0, 3).join(', ')}${deploys.length > 3 ? ', …' : ''}), and release-production is on rung ${rung} (${RUNG[rung]}): ask --class release-production --ticket ${target} …, then decide --class release-production --refs ${target} --approved <qid> -- "release …", then merge --decision <d-id>`);
      if (release) out(`merging deploys to production${inR}: a release-production act will be logged (${release.decision ? `under ${release.decision}` : `rung ${rung}`})`);
    } else if (releaseDecision) out(`${releaseDecision.id} is a release-production decision, and this merge deploys nothing; it is not carried out`);
  }
  if (chore) {
    const base = mainRef() ? git(['merge-base', mainRef(), sha]) : null;
    const outside = base ? changedFiles(base, sha).filter((f) => !f.startsWith(`${projectRel}/`)) : [];
    choreOutside = outside;
    // a recurring-edit answer approves the jobs it showed and nothing else: no file outside project/ beside them
    if ((jobsChanged || jobAnswer) && outside.length) fails.push(`changes files outside project/ (${outside.slice(0, 6).join(', ')}${outside.length > 6 ? ', …' : ''}) beside the jobs: a recurring-edit answer approves the jobs it showed and nothing else; land those in a PR of their own`);
    const kitFiles = outside.filter(isKitFile);
    const kitAnswer = approved && kitFiles.length ? ownerAnswer(approved, 'merge --approved') : null;
    // A secret chore isn't a kit change: the encrypted stores its answer posted (a sops file can
    // sit under the kit) need only that answer, held to its own chore below.
    const secretChore = kitAnswer?.secrets.length && kitAnswer.secrets_posted?.length && chore.startsWith('secret-') && kitAnswer.answer?.startsWith('Posted');
    const kit = secretChore ? kitFiles.filter((f) => !secretStores(kitAnswer).includes(f)) : kitFiles;
    const kitApproved = !kit.length || KIT_CLASSES.includes(kitAnswer?.class);
    // Only these two standing rules approve kit files: an owner's rule that settles owner settings
    // (a gate-change rule, owner_rules) says nothing about the kit's files. Files verbatim from
    // upstream need no question, so an --approved answer outside the kit classes doesn't stop this.
    let kitRule = null;
    if (outside.length && (!approved || !kitApproved) && chore.startsWith('devteam-sync-')) {
      const r = upstreamSyncApproval(chore, sha, outside);
      if (r.rule || r.policy) { kitRule = standing = r; out(`kit files match upstream ${r.tag} exactly${r.stub ? `, and ${GITLEAKS_FILE} only extends the kit's gitleaks.toml` : ''}; approved by ${r.rule ? `the owner's standing rule ${r.rule.id}` : 'settings.upstream_sync "adopt"'}; ${r.tag} is ${r.tagSha}`); } else if (r.problem && !approved) fails.push(r.problem);
    }
    if (outside.length && !approved && !kitRule && base) {
      const r = ciFixApproval(chore, sha, base, outside);
      if (r.rule) { kitRule = standing = r; out(`changes only workflow files and keeps every job; approved by the owner's standing rule ${r.rule.id} ("${r.rule.statement}")`); } else if (r.problem) fails.push(r.problem);
    }
    if (outside.length && !approved && !kitRule && base) {
      const r = secretsAllowlistApproval(chore, sha, base, outside);
      if (r.rule) { kitRule = standing = r; out(`only adds secret-scan exceptions; approved by the owner's standing rule ${r.rule.id} ("${r.rule.statement}")`); } else if (r.problem) fails.push(r.problem);
    }
    if (outside.length && !approved && !kitRule) fails.push(`touches files outside project/ (${outside.slice(0, 6).join(', ')}${outside.length > 6 ? ', …' : ''}); the owner's answer is needed: merge --chore ${chore} --approved <qid>`);
    else if (approved && !kitRule && !kitApproved) fails.push(`changes kit files (${kit.slice(0, 6).join(', ')}${kit.length > 6 ? ', …' : ''}); that needs the owner's answer in a ${KIT_CLASSES.join(', ')} question, and ${approved} is ${kitAnswer.class ?? 'classless'}`);
  }
  if (approved) {
    const av = ownerAnswer(approved, 'merge --approved');
    // A secrets question approves landing only the stores it posted, and only once posted.
    if (av.secrets.length && (!chore?.startsWith('secret-') || !av.answer?.startsWith('Posted'))) fails.push(`${approved} asked for secrets; it approves only its own chore-secret PR, once the owner posted them (its answer: ${av.answer})`);
    // One answer approves one thing. The exception: one act of the answer's class that recorded the
    // decision for this very ticket or chore, which this merge now lands.
    // A question that declared its acts (ask --approves) approves each of them once: only the
    // prior acts for this one count, and one not on its list is never approved by it.
    const target = id ?? (chore ? `chore-${chore}` : plan);
    const declared = av.approves ?? [];
    const mine = (a) => !declared.length || (a.refs ?? []).some((r) => [target, `plan-${plan}`].includes(r));
    if (declared.length && !declared.includes(target) && !(plan && declared.includes(`plan-${plan}`))) fails.push(`${approved} approves ${declared.join(', ')}, not ${target}; ask again for this one`);
    // Every earlier use counts, merges that cited a decision included; only the decision this merge
    // carries out (--decision) is the call the answer approved, not a prior one.
    const prior = [...logObjects('decision'), ...logObjects('act')].filter((a) => a.approved_by === approved && mine(a) && a.id !== flagStr('decision'));
    // A bundle's link acts (one per entry its question showed) are one landing too. A link act binds
    // the change, not a slug: its entry hashes and its question's diff (ownerLinkActFails), so it
    // lands on a chore of any name that changes those links and nothing else outside project/. Old
    // acts that also carry chore-registry follow the same rule.
    const linkAct = (a) => Object.hasOwn(a, 'entry_hash') && (a.refs ?? []).some((r) => r.startsWith('link:'));
    const linkIds = new Set(prior.filter(linkAct).flatMap((a) => a.refs.filter((r) => r.startsWith('link:')).map((r) => r.slice(5))));
    const allLinks = prior.length >= 1 && prior.every(linkAct) && prior.every((a) => a.class === av.class);
    let landing;
    if (allLinks) {
      const extras = [...choreOutside, ...(ownerChanged ?? []).filter((c) => !c.key.startsWith('links.') || !linkIds.has(c.key.split('.')[1])).map((c) => c.key)];
      const linksLanded = (ownerChanged ?? []).some((c) => c.key.startsWith('links.'));
      landing = !!chore && !extras.length && linksLanded;
      if (!landing) fails.push(`${approved} approved repo link entries only (${[...linkIds].map((l) => `links.${l}`).join(', ')}), landing on a chore; this ${chore ? 'chore' : 'merge'} ${extras.length ? `also changes ${extras.slice(0, 6).join(', ')}` : 'lands none of them'}: ask again for this one, or take the rest out`);
    } else {
      landing = prior.length === 1 && prior[0].class === av.class && (prior[0].refs ?? []).includes(target);
      if (prior.length && !landing) fails.push(`${approved} already approved ${declared.length ? `an act for ${target}` : 'an act'}; ask again for this one`);
    }
  }
  // Gates: the repo's own commands (never inherited), at the exact head, in a detached
  // worktree of that repo seeded from that repo's settings.
  const gates = Object.entries(S.gates ?? {});
  const coveredNotes = []; // gates the forge's checks covered at this head, for the merge act
  if (!gates.length && !flags['no-gates'] && !chore) fails.push(R.name === 'home' ? 'no gates in settings (gates: {name: command}); pass --no-gates to merge without running any' : `no gates in ${R.name}'s settings (links.${R.name}.gates); pass --no-gates to merge without running any`);
  if (!fails.length && gates.length && !chore && !flags['no-gates']) {
    // A gate with `paths` runs only when the PR changes a file matching one of them (a monorepo's
    // per-app gates); a gate without runs on every PR.
    const base = R.mainRef() ? R.git(['merge-base', R.mainRef(), sha]) : null;
    const changed = base ? R.changedFiles(base, sha) : null;
    const applies = ([, spec]) => typeof spec === 'string' || !spec.paths || !changed || changed.some((f) => spec.paths.some((g) => pathMatches(g, f)));
    const skipped = gates.filter((g) => !applies(g)).map(([n]) => n);
    if (skipped.length) out(`gates not applicable to this PR: ${skipped.join(', ')}`);
    // A gate the owner declared covered_by (gate-change) isn't run here when the forge's checks ran
    // it green at this exact head: the PR is read again, by number, and its head must still be sha.
    // Everything that can't be read or listed covers nothing. A PR that changes .github/ covers
    // nothing either: a pull_request workflow runs the PR's own workflow files, so the PR would
    // define the very CI that excuses the gate.
    const declared = gates.filter(applies).filter(([, s]) => isObj(s) && s.covered_by !== undefined);
    let fresh = null;
    if (declared.length) {
      const diff = base ? R.git(['diff', '-z', '--name-only', '--no-renames', base, sha]) : null; // the diff itself: changedFiles reads a failed diff as no files
      const ci = diff === null ? null : diff.split('\0').filter((f) => f.startsWith('.github/'));
      if (viaGit) fresh = { why: 'forge is git: no checks to read' };
      else if (!pr.number) fresh = { why: 'no PR to read' };
      else if (ci === null) fresh = { why: 'cannot tell what the PR changes' };
      else if (ci.length) fresh = { why: `the PR changes the forge's CI configuration (${ci.slice(0, 3).join(', ')}${ci.length > 3 ? ', …' : ''})` };
      else {
        let v = null;
        try { v = JSON.parse(R.gh(['pr', 'view', String(pr.number), '--json', 'headRefOid,statusCheckRollup'], ghRead) ?? 'null'); } catch { v = null; }
        if (!isObj(v)) fresh = { why: "could not read the PR's checks again" };
        else if (v.headRefOid !== sha) fresh = { why: `the head moved to ${String(v.headRefOid ?? '?').slice(0, 12)}` };
        else fresh = { rollup: v.statusCheckRollup ?? [] };
      }
    }
    const coveredNow = new Map();
    for (const [name, spec] of declared) {
      const shape = forgeCoverage(spec.covered_by, []);
      const c = shape.bad ? shape : fresh.rollup ? forgeCoverage(spec.covered_by, fresh.rollup, S.ignored_checks ?? []) : { covered: false, why: fresh.why };
      if (c.bad) warn(`gate ${name}: ${c.why}; it runs`);
      else if (c.covered) {
        out(`gate ${name} not run here: the forge's checks ran it green at ${sha.slice(0, 12)} (${c.checks.join(', ')})`);
        coveredNow.set(name, c.checks);
        coveredNotes.push(`gate ${name} covered by the forge's checks at ${sha} (${c.checks.join(', ')})`);
        continue;
      }
      if (!c.bad) out(`gate ${name} runs here: ${c.why}`);
    }
    const wt = detachedWorktree(sha, `merge-${slug(branch)}`, R);
    try {
      for (const [name, spec] of gates.filter(applies).filter(([n]) => !coveredNow.has(n))) {
        const cmd = typeof spec === 'string' ? spec : spec.cmd;
        const started = Date.now();
        let ok = true;
        try {
          execFileSync('sh', ['-c', cmd], { cwd: wt, stdio: 'inherit', env: gateEnv(!plan && !chore ? id : null, R) });
        } catch {
          ok = false;
        }
        const tests = typeof spec === 'object' && spec.junit ? readJunit(path.join(wt, spec.junit)) : [];
        const ms = Date.now() - started;
        // A ratchet gate that fails here and also fails at the merge base is pre-existing debt, not
        // this PR's: it passes with a warning (quality.md §2, modes), and its line says so, so the
        // gate's fail rate counts only failures that were the PR's.
        let preexisting = false;
        if (!ok && spec.mode === 'ratchet' && base) {
          const bwt = detachedWorktree(base, `base-${slug(branch)}`, R);
          let baseOk = true;
          try { execFileSync('sh', ['-c', cmd], { cwd: bwt, stdio: 'ignore', env: gateEnv(!plan && !chore ? id : null, R) }); } catch { baseOk = false; } finally { R.git(['worktree', 'remove', '--force', bwt], R.root); }
          preexisting = !baseOk;
        }
        // the gate line lands in home's live log, naming the repo it ran in when not home
        appendLog({ type: 'gate', gate: name, ok, ms, sha, tests_total: tests.length, tests: keepTests(tests), preexisting: preexisting || undefined, ...onR }, 'supervisor');
        if (preexisting) { warn(`gate ${name} fails at the merge base ${base.slice(0, 12)} too: pre-existing, allowed by ratchet mode`); continue; }
        if (!ok) fails.push(`gate ${name} failed at ${sha.slice(0, 12)}`);
      }
    } finally {
      R.git(['worktree', 'remove', '--force', wt], R.root);
    }
  }
  // A gate this PR adds runs at its head before it lands, on every kind of PR: one that fails there
  // would refuse every merge after it, and taking it out again is the owner's gate-change. A
  // ratchet gate may fail (pre-existing debt is what ratchet mode is for).
  if (!fails.length && gateAdds?.length) {
    const wt = detachedWorktree(sha, `gate-add-${slug(branch)}`, R);
    try {
      for (const [name, spec] of gateAdds) {
        const started = Date.now();
        let ok = true;
        try { execFileSync('sh', ['-c', typeof spec === 'string' ? spec : spec.cmd], { cwd: wt, stdio: 'inherit', env: gateEnv(null, R) }); } catch { ok = false; }
        appendLog({ type: 'gate', gate: name, ok, ms: Date.now() - started, sha, tests_total: 0, tests: [], preexisting: !ok && spec.mode === 'ratchet' ? true : undefined }, 'supervisor');
        if (!ok && spec.mode !== 'ratchet') fails.push(`the gate ${name} this PR adds fails at ${sha.slice(0, 12)}: fix it, or add it with "mode": "ratchet", since a failing gate would refuse every merge after it`);
      }
    } finally {
      R.git(['worktree', 'remove', '--force', wt], R.root);
    }
  }
  if (fails.length) report(fails, '');
  if (unpinCode) unpinCode();
  const recWords = rec ? `, records at ${rec.sha.slice(0, 12)} in home${rec.landed ? ' (landed already: only the code lands)' : ''}` : '';
  if (dry) return out(`ok: ${branch} at ${sha.slice(0, 12)} would merge${inR}${recWords}`);
  const mainBranch = S.main_branch;
  // Records first: they land on home's main at exactly the pinned sha (once: a rerun finds them
  // landed), then the code. A code landing that fails after them leaves home with the records and
  // the link without the code, no act logged; merge again re-checks and lands only the code.
  // records adopted above (recOwn): their act, now that every check passed
  if (recOwn) {
    const ra = appendLog({ type: 'act', class: 'merge-word', what: `merged home's ticket/${id} at ${rec.sha}: the records of ${id}, ahead of its code in ${R.name}`, refs: [], reversible: false }, 'supervisor');
    out(`the records of ${id} at ${rec.sha.slice(0, 12)} are on home's ${repo('home').settings.main_branch} in the kit's own records merge ${recOwn.tip.slice(0, 12)}: logged their landing (${ra.id})`);
  }
  const rerun = `merge ${id ? id : plan ? `--plan ${plan}` : `--chore ${chore}`}${approved ? ` --approved ${approved}` : ''}`;
  if (rec && !rec.landed) {
    const why = landRecords(id, rec, R.name);
    if (why?.maybe) die(`the records of ${id} may have landed in home (${why.maybe}): run ${rerun} again; it recognises the kit's own records merge and logs their act, or lands them`);
    if (why) die(`the records of ${id} did not land in home (${why}); nothing landed: verify from the start`);
    // Its own act, logged as it lands: the merge it made on home's main is named by what merge did,
    // never inferred from git later (a subject, a tree or a parent is anything anyone can push). No
    // refs: the ticket isn't merged until its code lands (merged-without-merge reads merge-word refs).
    const ra = appendLog({ type: 'act', class: 'merge-word', what: `merged home's ticket/${id} at ${rec.sha}: the records of ${id}, ahead of its code in ${R.name}`, refs: [], reversible: false }, 'supervisor');
    out(`landed the records of ${id} at ${rec.sha.slice(0, 12)} in home (${ra.id})`);
  }
  // The code lands onto the main the checks judged (kit-162): what they cleared holds only there.
  // A fetch that fails or times out can't tell: it refuses, never clears (T3-1). The landing's git
  // calls are bounded (recurringRegistry.git: a timeout, then SIGKILL), and one that times out
  // refuses like one that fails (final-10 F4).
  const lg = (args, cwd) => { const r = recurringRegistry.git(args, { cwd }); return r.ok ? r.out.trim() : null; };
  const moved = () => {
    if (lg(['fetch', '--quiet', 'origin', mainBranch], R.root) === null) return `couldn't fetch ${mainBranch}${inR} to check it hasn't moved since the checks; run merge again`;
    const tip = R.resolveCommit(`origin/${mainBranch}`);
    return tip === checkedMain ? null : `main moved since the checks (${String(checkedMain).slice(0, 12)} to ${String(tip).slice(0, 12)}); run merge again`;
  };
  const landCode = () => {
    if (!checkedMain) return `no ${mainBranch}${inR} to land on`;
    if (viaGit) {
      // Merge the exact verified sha (never the branch name, which may have moved) onto the checked
      // main, never a re-fetched tip, and push only if origin's main is still that commit. Directory
      // renames are a conflict, whatever the user's git config says, and no hook runs: a hooks dir the
      // branch tracks (core.hooksPath) would otherwise run inside this merge (final-10 F1).
      const noHooks = ['-c', 'core.hooksPath=/dev/null'];
      const wt = detachedWorktree(checkedMain, `land-${slug(branch)}`, R);
      try {
        // one killed at the timeout says so, never that the head doesn't merge (final-11 F6)
        const lm = recurringRegistry.git([...noHooks, ...recurringRegistry.MERGE_FLAGS, 'merge', '--no-ff', '--quiet', '-m', `${pr.title}\n\n${(pr.body ?? '').trim()}\n\nMerged ${branch} at ${sha}`, sha], { cwd: wt });
        if (!lm.ok) return lm.timedOut ? `the landing merge of ${sha.slice(0, 12)} onto ${mainBranch}${inR} timed out; nothing pushed` : `${sha.slice(0, 12)} does not merge onto ${mainBranch}${inR}`;
        // What is pushed is what was judged: one merge commit of exactly the checked main and the
        // head, in that order, whose jobs are the ones the checks said land. Anything that moved HEAD
        // is refused, and nothing is pushed.
        const head = lg(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], wt);
        if (!head) return `couldn't read the landing merge's commit; nothing pushed`;
        const parents = (lg(['rev-list', '--parents', '-n', '1', head], wt) ?? '').split(' ').slice(1);
        if (parents.length !== 2 || parents[0] !== checkedMain || parents[1] !== sha) return `the landing merge at ${head.slice(0, 12)} is not the merge of ${sha.slice(0, 12)} onto ${mainBranch}${inR} at ${checkedMain.slice(0, 12)} the checks judged; nothing pushed`;
        // (main's broken file, left as it is, lands as it was: its entry is main's, entry for entry)
        if (R.name === 'home' && landsJobs && !landsJobs.problem) {
          const H = recurringRegistry.read(head);
          const M = H.problem && !H.failed ? recurringRegistry.read(checkedMain) : null;
          const kept = !!M?.problem && !!H.entry && H.entry === M.entry && !Object.keys(landsJobs.changed).length;
          if (H.failed || (H.problem ? !kept : Object.keys(recurringRegistry.changed(landsJobs.jobs, H.jobs)).length > 0)) return `the landing merge at ${head.slice(0, 12)} lands other jobs (recurring.json) than the checks judged${H.problem ? ` (${H.problem})` : ''}; nothing pushed`;
        }
        // the merge's own sha, before its push: the only landing a rerun adopts (final-15 F1)
        const noted = recurringRegistry.recordLanding(recurringRegistry.landingFile(R.name, branch, sha), head, checkedMain);
        if (noted) return `couldn't record the landing merge ${head.slice(0, 12)} before its push (${noted}); nothing pushed`;
        // the checked commit, by sha: never HEAD, read again at push time (final-11 F5)
        const pushed = recurringRegistry.git([...noHooks, 'push', '--quiet', '--no-verify', `--force-with-lease=${mainBranch}:${checkedMain}`, 'origin', `${head}:refs/heads/${mainBranch}`], { cwd: wt });
        if (!pushed.ok) {
          // origin may have taken it and only its answer failed or timed out (a slow post-receive): when
          // origin's main is exactly the merge built and checked here, the code landed (final-11 F3)
          if (lg(['fetch', '--quiet', 'origin', mainBranch], R.root) !== null && R.resolveCommit(`origin/${mainBranch}`) === head) {
            out(`the push to ${mainBranch}${inR} ${recurringRegistry.why(pushed)}, but origin's ${mainBranch} is the landing merge the kit built and checked (${head.slice(0, 12)}): landed`);
            return null;
          }
          // killed at the timeout, origin may still take it (a slow pre-receive): never "nothing landed" (final-13 F1)
          if (pushed.timedOut) { pushTimedOut = true; return `the push to ${mainBranch}${inR} timed out before origin answered, and its ${mainBranch} isn't the landing merge yet, so it may still land`; }
          return moved() ?? `push to ${mainBranch}${inR} refused (did main move?)`;
        }
      } finally {
        R.git(['worktree', 'remove', '--force', wt], R.root);
      }
      return null;
    }
    // GitHub has no lease on the base: main is read again just before gh pr merge. Its gh calls use
    // merge's bounds (ghMerge, ghRead, above: kit-787), so the code's landing waits at most
    // 60 + 3 x 15 + 2 x 2 = 109 s on gh (with records in home, 218 s for both landings' gh calls).
    // The git fetches are apart: moved()'s is bounded (recurringRegistry.git, 120 s), the one after
    // landing is too (kit-791: 120 s, 240 s with records in home)
    const gone = moved();
    if (gone) return gone;
    const merged = R.gh(['pr', 'merge', String(pr.number), `--${S.merge_method}`, ...(S.merge_admin === true ? ['--admin'] : []), '--match-head-commit', sha], ghMerge);
    if (merged !== null) return null;
    // gh can exit non-zero after GitHub merged (an error or a timeout in its answer, a slow GitHub):
    // GitHub's own state says, read while it still says OPEN, three times at most, 2 s apart. A PR that
    // was OPEN when merge began and is MERGED at the gated head now is this merge's landing, and its
    // act is written; one merged before (a squash elsewhere) or anything else is refused (kit-782)
    let st = null;
    if (pr.state === 'OPEN') for (let i = 0; i < 3; i++) {
      if (i) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
      st = null;
      try { st = JSON.parse(R.gh(['pr', 'view', String(pr.number), '--json', 'state,headRefOid'], ghRead) ?? 'null'); } catch {}
      if (st?.state !== 'OPEN') break;
    }
    if (!(st?.state === 'MERGED' && st.headRefOid === sha)) return 'gh pr merge refused (did the head move?)';
    out(`gh pr merge of #${pr.number} exited non-zero, but GitHub has #${pr.number} merged at ${sha.slice(0, 12)}: landed`);
    return null;
  };
  let pushTimedOut = false;
  const codeFail = relanded ? null : landCode();
  if (codeFail && pushTimedOut) die(`${rec ? `the records of ${id} landed in home at ${rec.sha.slice(0, 12)}; ` : ''}the code may have landed${inR} (${codeFail}): run ${rerun} again; it recognises the kit's own landing merge and logs its act, or lands it`);
  if (codeFail) die(rec ? `the records of ${id} landed in home at ${rec.sha.slice(0, 12)}; the code did not land in ${R.name} (${codeFail}): run merge ${id} again` : `${codeFail}; verify from the start`);
  // The fetch after the landing only refreshes origin/<main> here: the code has landed. It is bounded
  // (recurringRegistry.git: 120 s, then SIGKILL; DEVTEAM_GIT_TIMEOUT_MS for tests), and one that fails
  // or times out is said, never a refusal: the act below is still written (kit-791)
  const fetched = recurringRegistry.git(['fetch', '--quiet', 'origin', mainBranch], { cwd: R.root });
  if (!fetched.ok) warn(`merged, but the fetch of ${mainBranch}${inR} after the landing ${recurringRegistry.why(fetched)}; origin/${mainBranch} in ${R.root} may not show it yet: check with git fetch origin ${mainBranch} there`);
  // home resets exactly what it reset before (G1); another repo resets all of its own caches
  if (R.name === 'home') { mainLogCache = undefined; mergeShaCache.clear(); } else R.resetCaches();
  const cls = id ? 'merge-word' : plan ? 'approve-feature-plan' : 'merge-chore';
  // A release-production decision is carried out by the release act, never by the merge act.
  const act = appendLog({ type: 'act', decision: releaseDecision ? undefined : citing(), class: cls, what: `merged ${branch} at ${sha}${rec ? `; records at ${rec.sha} in home` : ''}${['park', 'let-go'].includes(heldBy) ? ` while its goal is ${holdWords(heldBy)}, with --force` : jobsForced ? ` while its goal is ${jobsForced}, with --force` : ''}${standing?.tag ? ` (upstream ${standing.tag} at ${standing.tagSha}, verbatim${standing.policy ? ', under settings.upstream_sync "adopt"' : ''})` : standing ? ` (${standing.what}, under the owner's standing rule)` : ''}${coveredNotes.map((n) => `; ${n}`).join('')}`, refs: id ? [id] : plan ? [plan] : [`chore-${chore}`], reversible: false, approved_by: approved ?? standing?.rule?.id ?? undefined, ...onR }, 'supervisor');
  // Adding a gate is the supervisor's own act (constitutional gate-add), recorded apart from the merge
  // so the owner sees each new check in the act feed and can correct it.
  if (gateAdds?.length) {
    const ga = appendLog({ type: 'act', class: 'gate-add', what: `added gate${gateAdds.length > 1 ? 's' : ''} ${gateAdds.map(([n, spec]) => `${n} (${JSON.stringify(typeof spec === 'string' ? spec : spec.cmd).slice(0, 200)})`).join(', ')} to settings.gates by merging ${branch} at ${sha}`, refs: [...act.refs, act.id], reversible: false }, 'supervisor');
    out(`added gate${gateAdds.length > 1 ? 's' : ''} ${gateAdds.map(([n]) => n).join(', ')} (${ga.id})`);
  }
  if (release) {
    const rel = appendLog({ type: 'act', class: 'release-production', decision: release.decision, rung: release.rung, what: `released ${release.target}${inR} to production by merging ${branch} at ${sha} (release: merge)`, refs: [release.target, act.id], reversible: false, ...onR }, 'supervisor');
    out(`released ${release.target}${inR} to production (${rel.id})`);
  }
  out(`merged ${branch} at ${sha.slice(0, 12)}${inR} (${act.id})`);
}
// ===== 7. trust =====

