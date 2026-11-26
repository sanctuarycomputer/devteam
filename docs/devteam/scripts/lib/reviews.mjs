/* imports start */
import { DOOR_PICK_LINE } from './log-sync.mjs';
import { FULL_SHA } from './base.mjs';
import { HOME_CWD } from './base.mjs';
import { LINK_KINDS } from './links.mjs';
import { SETTINGS_DEFAULTS } from './settings.mjs';
import { WORKTREE } from './repos.mjs';
import { approvalOf } from './panes.mjs';
import { canonical } from './settings.mjs';
import { compileLines } from './graph.mjs';
import { componentsOn } from './links.mjs';
import { coverage } from './graph.mjs';
import { devteamLine } from './links.mjs';
import { factsRepo } from './repos.mjs';
import { features } from './graph.mjs';
import { git } from './base.mjs';
import { hasWild } from './graph.mjs';
import { headIn } from './repos.mjs';
import { homeRecordsRef } from './repos.mjs';
import { isHandoffFile } from './fleet.mjs';
import { isObj } from './artifact-notes.mjs';
import { landingTree } from './check-ticket.mjs';
import { leafWords } from './graph.mjs';
import { linesDeclared } from './links.mjs';
import { loadSettings } from './settings.mjs';
import { mainRef } from './log.mjs';
import { mainSha } from './log.mjs';
import { memo } from './graph.mjs';
import { mergeShaFor } from './repos.mjs';
import { out } from './base.mjs';
import { ownEntry } from './artifact-notes.mjs';
import { ownersIn } from './graph.mjs';
import { partsChanged } from './graph.mjs';
import { pathMatches } from './graph.mjs';
import { projectInRepo } from './settings.mjs';
import { projectRel } from './settings.mjs';
import { recordsHomeSetting } from './repos.mjs';
import { recordsInHome } from './repos.mjs';
import { recordsInHomeId } from './repos.mjs';
import { recurringRegistry } from './recurring.mjs';
import { repo } from './repos.mjs';
import { repoOfTicketId } from './repos.mjs';
import { resolveCommit } from './log-sync.mjs';
import { settingsAt } from './settings.mjs';
import { spawnSync } from 'node:child_process';
import { srcList } from './repos.mjs';
import { srcRead } from './repos.mjs';
import { ticketBranchRef } from './repos.mjs';
import { tickets } from './graph.mjs';
import { touchPart } from './graph.mjs';
import { touchPath } from './graph.mjs';
import { trimSlash } from './graph.mjs';
import { warn } from './base.mjs';
import { warnLeftInRepo } from './repos.mjs';
/* imports end */
// A cell may hold an escaped pipe (\|), as GitHub tables allow; only an unescaped | separates cells.
export const tableCells = (row) => row.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

// A record is <stage>-<pass>[<track>].md with "- Reviewer: <name>" and a last line
// "Verdict: APPROVE|CHANGES <full sha>"; findings are table rows whose id is a capital prefix and a
// number (F1, R2, CR3) under a header with a Disposition column.
export function parseReview(file, text) {
  const m = file.match(/^([a-z]+)-(\d+)([a-z]?)\.md$/);
  const verdict = [...text.matchAll(/^Verdict:[ \t]*(APPROVE|CHANGES)[ \t]+(\S+)[ \t]*$/gm)].pop();
  const reviewerRaw = text.match(/^-[ \t]*Reviewer:[ \t]*(.*)$/m)?.[1]?.trim() ?? '';
  // A records-in-home ticket's final review names the home commit of the records it reviewed too.
  // the last such line counts, as the last verdict line does
  const recordsRaw = [...text.matchAll(/^-[ \t]*Records:[ \t]*(\S+)[ \t]*$/gm)].pop()?.[1] ?? null;
  // A plan review that relies on a goal-level one-way-door answer says so: "- Goal-level door: <qid> covers this plan".
  // When the review was made ("- Date: 2026-11-20T19:40Z", or a bare day): what lets metrics read
  // first passes since a date, and the last 7 days apart from all time. A record without one is undated.
  const dateRaw = text.match(/^-[ \t]*Date:[ \t]*(\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?)[ \t]*$/m)?.[1] ?? null;
  const dateMs = dateRaw ? Date.parse(dateRaw.length === 10 ? `${dateRaw}T00:00:00Z` : dateRaw.replace(' ', 'T').replace(/(\d)$/, '$1Z')) : NaN;
  const doors = [...text.matchAll(/^-[ \t]*Goal-level door:[ \t]*(q-\S+)[ \t]+covers this plan\.?[ \t]*$/gm)].map((d) => d[1]);
  // and one built on the owner's pick of a door's marked alternative names it, as the plan does: "- One-way door <qid>: <choice>"
  const doorPicks = [...text.matchAll(DOOR_PICK_LINE)].map((d) => ({ id: d[1], pick: d[2].trim() }));
  const findings = [];
  let dispIdx = -1;
  let sevIdx = 1;
  let ruleIdx = -1;
  let findIdx = -1;
  let width = 0;
  // the category word a Finding opens with (quality.md §3), markup stripped; any other word is none
  const CATEGORIES = ['weak-check', 'code-fact', 'undecided', 'defect', 'contradicts', 'coverage', 'harness', 'untraced', 'tldr', 'touches', 'other'];
  const category = (cell) => { const w = String(cell ?? '').replace(/[`*]/g, '').match(/^\s*([A-Za-z-]+)\s*:/)?.[1]?.toLowerCase(); return CATEGORIES.includes(w) ? w : 'none'; };
  for (const row of text.split('\n')) {
    if (!row.trim().startsWith('|')) continue;
    const cells = tableCells(row);
    const lower = cells.map((c) => c.toLowerCase());
    if (lower.includes('disposition')) { dispIdx = lower.indexOf('disposition'); sevIdx = Math.max(lower.indexOf('severity'), 1); ruleIdx = lower.indexOf('rule'); findIdx = lower.indexOf('finding'); width = cells.length; continue; }
    // A row wider than its header (a stray empty cell before the disposition) still has its
    // disposition: the first non-empty cell from the Disposition column on.
    const disposition = dispIdx < 0 ? '' : cells.length > width ? (cells.slice(dispIdx).find((c) => c) ?? '') : (cells[dispIdx] ?? '');
    if (FINDING_ID.test(cells[0] ?? '')) findings.push({ id: cells[0], severity: cells[sevIdx] ?? '', disposition, category: findIdx < 0 ? 'none' : category(cells[findIdx]), ...(ruleIdx > 0 && cells[ruleIdx] ? { rule: cells[ruleIdx] } : {}), ...(width && cells.length !== width ? { cells: cells.length, width } : {}) });
  }
  return {
    file, stage: m ? m[1] : file.replace(/\.md$/, ''), pass: m ? Number(m[2]) : 0, variant: m ? m[3] : '',
    verdict: verdict ? verdict[1] : null, sha: verdict ? verdict[2] : null, shaValid: verdict ? /^[0-9a-f]{40}$/.test(verdict[2]) : false,
    reviewer: reviewerRaw && !reviewerRaw.startsWith('<') ? reviewerRaw : null, findings, doors, doorPicks,
    records: recordsRaw && /^[0-9a-f]{40}$/.test(recordsRaw) ? recordsRaw : null,
    // a date after now is author-asserted and would sit in last_7d forever: undated
    date: Number.isFinite(dateMs) && dateMs <= Date.now() + 5 * 60000 ? dateMs : null,
    // a fast task that had to be redone on strong (worker.md §3): "- Model miss: fast"
    model_miss: /^-[ \t]*Model miss:[ \t]*fast\b/im.test(text),
  };
}
export const reviewRecordsIn = (src, relDir) => srcList(src, relDir).filter((f) => f.endsWith('.md')).map((f) => parseReview(f, srcRead(src, `${relDir}/${f}`) ?? ''));
// A ticket's review records, from its own repo: a sibling's WORKTREE reads that repo's main.
// A records-in-home ticket's are home's, whatever repo a caller passes: an exact sha as given, a
// branch name resolved again in home (a caller's ref is the link's), and no ref (merged) home's main.
// A command that judged a commit passes its decision (src.inHome), so the reviews come from where
// the rest of its records did; else the views form decides.
// A dashboard request reads every ticket's records several times (deriveStatus and collectMetrics
// each run more than once, and metrics reads them for reviewStats and reviewPasses): while one runs,
// each ticket's folder is read once (reviewMemo, set by dashboardData) and reviewReads counts reads.
export let reviewMemo = null;
export let reviewReads = 0;
export const ticketReviews = (id, src) => {
  if (!reviewMemo) return ticketReviewsRead(id, src);
  const k = `${id}\0${src === WORKTREE ? 'worktree' : `${src.ref ?? ''}\0${src.repo?.name ?? ''}\0${src.inHome ?? ''}`}`;
  if (!reviewMemo.has(k)) { reviewReads++; reviewMemo.set(k, ticketReviewsRead(id, src)); }
  return reviewMemo.get(k);
};
export const ticketReviewsRead = (id, src) => {
  if (src.inHome ?? recordsInHomeId(id)) {
    const ref = src.ref ? (FULL_SHA.test(src.ref) ? src.ref : homeRecordsRef(id)) : mainRef();
    return ref ? reviewRecordsIn({ ref }, `tickets/${id}/reviews`) : [];
  }
  const R = src.repo ?? factsRepo(id); return R ? reviewRecordsIn(R.name === 'home' ? src : { ...src, repo: R }, `tickets/${id}/reviews`) : []; };
export const featureReviews = (feature) => reviewRecordsIn(WORKTREE, `reviews/${feature}`);
export function latestPerTrack(records, stage) {
  const latest = new Map();
  for (const r of records.filter((x) => x.stage === stage)) { const p = latest.get(r.variant); if (!p || r.pass > p.pass) latest.set(r.variant, r); }
  return [...latest.values()];
}
// A finding's id: a short capital prefix and a number (F1, R2, CR3, S1b): reviewers prefix by kind.
export const FINDING_ID = /^[A-Z]{1,4}\d+(?:-\d+)?[a-z]?$/;
export const blocking = (sev) => /^(critical|important)$/i.test(sev);
export const disposed = (d) => /^(fixed|wrong|wont-fix\b|won't-fix\b)/i.test(d ?? '');

// The rule a finding cites, as one key: a Law, value or refusal id (L-LOGIC-3, V2, R1) alone; a
// document and its section (spec §3, quality.md §6) as written, capped.
export const ruleKey = (rule) => { const t = String(rule).trim().replace(/\s+/g, ' '); const id = t.match(/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*\b/); return (id && /\d/.test(id[0]) ? id[0] : t).slice(0, 40); };
// since: count only first passes dated on or after it (metrics --since); undated ones are left out
// then, and counted in `undated`. Each stage also carries last_7d, its dated first passes of the
// last seven days, so a lever's effect shows apart from the all-time rate it would barely move.
export const RECENT_DAYS = 7;
export function reviewStats(since = 0) {
  const byStage = {};
  const recentFrom = Date.now() - RECENT_DAYS * 86400000;
  let findings = 0;
  let wrong = 0;
  const all = [];
  for (const id of tickets().keys()) { const b = ticketBranchRef(id); all.push(...ticketReviews(id, b && !mergeShaFor(id) ? { ref: b } : WORKTREE)); }
  for (const fid of features().keys()) all.push(...featureReviews(fid));
  for (const r of all) {
    for (const f of r.findings) { findings++; if (/^wrong/i.test(f.disposition)) wrong++; }
    if (r.pass !== 1 || r.variant || !r.verdict) continue;
    byStage[r.stage] ??= { first_passes: 0, rejected: 0, undated: 0, last_7d: { first_passes: 0, rejected: 0, rules: {} }, rules: {}, categories: {} };
    if (r.date === null) byStage[r.stage].undated++;
    if (since && (r.date === null || r.date < since)) continue;
    if (r.date !== null && r.date >= recentFrom) {
      const l = byStage[r.stage].last_7d;
      l.first_passes++; if (r.verdict === 'CHANGES') l.rejected++;
      for (const f of r.findings) if (blocking(f.severity) && f.rule) { const k = ruleKey(f.rule); l.rules[k] = (l.rules[k] ?? 0) + 1; }
    }
    byStage[r.stage].first_passes++;
    if (r.verdict === 'CHANGES') byStage[r.stage].rejected++;
    // what first passes keep blocking on, by the rule each blocking finding cites: what a new
    // session's prompt, or the stage's template, should have said from the start (supervisor.md §10)
    for (const f of r.findings) if (blocking(f.severity) && f.rule) { const k = ruleKey(f.rule); byStage[r.stage].rules[k] = (byStage[r.stage].rules[k] ?? 0) + 1; }
    // and by the category word each opens with (quality.md §3): every blocking finding, none without one
    for (const f of r.findings) if (blocking(f.severity)) { const k = f.category ?? 'none'; byStage[r.stage].categories[k] = (byStage[r.stage].categories[k] ?? 0) + 1; }
  }
  for (const s of Object.values(byStage)) {
    s.rejection_rate = s.first_passes ? +(s.rejected / s.first_passes).toFixed(2) : null;
    s.last_7d.rejection_rate = s.last_7d.first_passes ? +(s.last_7d.rejected / s.last_7d.first_passes).toFixed(2) : null;
    s.last_7d.top_blocking_rules = Object.entries(s.last_7d.rules).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([rule, count]) => ({ rule, count }));
    delete s.last_7d.rules;
    s.top_blocking_rules = Object.entries(s.rules).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([rule, count]) => ({ rule, count }));
    s.top_blocking_categories = Object.entries(s.categories).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([category, count]) => ({ category, count }));
    delete s.rules;
    delete s.categories;
  }
  return { by_stage: byStage, findings, false_positive_rate: findings ? +(wrong / findings).toFixed(2) : null };
}
export function reviewPasses() {
  const o = {};
  for (const id of tickets().keys()) {
    const b = ticketBranchRef(id);
    const finals = ticketReviews(id, b && !mergeShaFor(id) ? { ref: b } : WORKTREE).filter((r) => r.stage === 'final');
    if (finals.length) o[id] = Math.max(...finals.map((r) => r.pass));
  }
  return o;
}

// The PR body's "## One-way doors" section is "None." or links the owner's answer.
export function oneWayDoorsSection(body) {
  const m = body.match(/^##\s+One-way doors\s*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  if (!m) return { ok: false, why: 'PR body has no "## One-way doors" section' };
  const text = m[1].replace(/<!--[\s\S]*?-->/g, '').trim();
  if (text === 'None.') return { ok: true, none: true };
  if (/\bq-\d{8}-\d{6,9}-[a-z0-9-]+\b|https?:\/\/\S+/.test(text)) return { ok: true, none: false };
  return { ok: false, why: 'the "## One-way doors" section must be "None." or link the owner\'s answer (a q-… id or a URL)' };
}

// A verdict at commit V holds at head H only if V is an ancestor of H, every non-merge commit V..H
// just ADDS review-record files under `dir` or fills one in (fillInOnly), save a commit and its exact
// revert, which change nothing together, and any merge between only brought main in: each merge's
// other parents are on main, and the branch's own change against main (three-dot, review records
// aside) is byte-identical at H to what was reviewed at V, or, where main touched the same files,
// each merge is exactly git's own merge of its parents. A conflict fix that touched the work
// changes both, so it voids the verdict; a clean merge of main does not.
// A record edit that only fills in what the record lacked: a "- Reviewer:" line where there was
// none, a "- Records: <full sha>" line where there was none (only where `records` allows it:
// verdictHolds allows it on a record written after the verdict's commit), and Disposition cells
// that were empty or held no disposition yet, each given a disposition. Verdicts, findings and
// dispositions already given can't change this way, so a dissent still can't be edited away.
export function fillInOnly(before, after, records = false) {
  if (before === null || after === null) return false;
  // blank lines carry nothing in a record, so they're left out of the comparison
  const a = before.split('\n').filter((l) => l.trim()), b = after.split('\n').filter((l) => l.trim());
  // each added line one of these, at most once, where the record had no such line (the parser's own patterns)
  const ADDED = [[/^-[ \t]*Reviewer:[ \t]*\S/, /^-[ \t]*Reviewer:[ \t]*\S/], ...(records ? [[/^-[ \t]*Records:[ \t]*[0-9a-f]{40}[ \t]*$/, /^-[ \t]*Records:/]] : [])];
  const open = ADDED.filter(([, had]) => !a.some((l) => had.test(l)));
  while (b.length > a.length) {
    const i = b.findIndex((l, k) => l !== a[k]);
    const k = open.findIndex(([line]) => line.test(b[i]));
    if (i < 0 || k < 0) return false;
    b.splice(i, 1);
    open.splice(k, 1);
  }
  if (b.length !== a.length) return false;
  let disp = -1;
  for (let k = 0; k < a.length; k++) {
    if (a[k].trim().startsWith('|')) { const lower = tableCells(a[k]).map((c) => c.toLowerCase()); if (lower.includes('disposition')) disp = lower.indexOf('disposition'); }
    if (a[k] === b[k]) continue;
    if (disp < 0 || !a[k].trim().startsWith('|') || !b[k].trim().startsWith('|')) return false;
    const x = tableCells(a[k]), y = tableCells(b[k]);
    // an empty cell, or one that isn't a disposition yet (a reviewer's "Accepted; …"), may become one
    if (x.length !== y.length || x.some((c, j) => j !== disp && c !== y[j]) || !(x[disp] === '' ? y[disp] : !disposed(x[disp]) && disposed(y[disp]))) return false;
  }
  return true;
}
export function verdictHolds(v, head, dir, R = repo('home')) {
  if (!head || !v || !/^[0-9a-f]{40}$/.test(v)) return false;
  if (v === head) return true;
  if (!dir || R.git(['merge-base', '--is-ancestor', v, head]) === null) return false;
  const main = R.mainRef();
  // the branch's own commits since V: what a merge brought in from main is main's, not the branch's.
  // Each adds a review record, or fills one in mechanically (fillInOnly): an empty Disposition cell
  // filled, a missing "- Reviewer:" line added, a missing "- Records:" line added to a record written
  // after V. Nothing else in a record may change, except by a commit its exact revert undoes.
  let commit = null;
  const range = [`${v}..${head}`, ...(main ? [`^${main}`] : [])];
  // <stage>-<pass>[<track>].md, or a task's later pass, task-<n>-<pass>[<track>].md
  const isRecord = (file) => file?.startsWith(dir) && /^(?:[a-z0-9-]+\/)?[a-z]+-\d+(?:-\d+)?[a-z]?\.md$/.test(file.slice(dir.length));
  // A commit and a later one whose diff is its exact inverse change nothing together: both are left
  // out. Each pairs once, with the oldest later match, so an edit reverted and redone is still judged;
  // a commit adding or deleting a record never pairs, so a dissent added and reverted still voids.
  // Worked out only once a commit would otherwise be refused; a diff git can't make never pairs.
  let paired = null;
  const undone = (c) => {
    if (!paired) {
      paired = new Set();
      const list = (R.git(['rev-list', '--no-merges', '--reverse', ...range]) ?? '').split('\n').filter(Boolean);
      const diff = (x, y) => R.git(['diff', '--binary', '--full-index', '--no-renames', '--no-ext-diff', '--no-textconv', x, y]);
      const addsOrDeletes = (x) => (R.git(['diff', '--name-status', '--no-renames', `${x}^`, x]) ?? 'x').split('\n').some((l) => { const [st, file] = l.split('\t'); return st !== 'M' && (st === 'x' || isRecord(file)); });
      const forward = list.map((x) => (addsOrDeletes(x) ? null : diff(`${x}^`, x)));
      const inverse = [];
      const inverseOf = (j) => (j in inverse ? inverse[j] : (inverse[j] = diff(list[j], `${list[j]}^`)));
      for (let i = 0; i < list.length; i++) {
        if (paired.has(list[i]) || !forward[i]) continue;
        for (let j = i + 1; j < list.length; j++) if (!paired.has(list[j]) && forward[j] !== null && inverseOf(j) === forward[i]) { paired.add(list[i]); paired.add(list[j]); break; }
      }
    }
    return !!c && paired.has(c);
  };
  const onlyRecords = (R.git(['log', '--no-merges', '--no-renames', '--format=@%H', '--name-status', ...range]) ?? 'x').split('\n').filter(Boolean).every((l) => {
    if (l.startsWith('@')) { commit = l.slice(1); return true; }
    const [st, file] = l.split('\t');
    // a drained session's handoff note is prose about the session, not the work (supervisor.md, Moving the fleet)
    if (isHandoffFile(file) && (st === 'A' || st === 'M')) return true;
    if (isRecord(file) && st === 'A') return true;
    if (isRecord(file) && st === 'M' && !!commit && fillInOnly(R.git(['show', `${commit}^:${file}`]), R.git(['show', `${commit}:${file}`]), R.git(['cat-file', '-e', `${v}:${file}`]) === null)) return true;
    return undone(commit);
  });
  if (!onlyRecords) return false;
  const merges = (R.git(['rev-list', '--merges', `${v}..${head}`]) ?? 'x').split('\n').filter(Boolean);
  if (!merges.length) return true;
  if (!main) return false;
  for (const m of merges) {
    const others = (R.git(['rev-list', '--parents', '-n', '1', m]) ?? '').split(' ').slice(2);
    if (!others.length || others.some((p) => R.git(['merge-base', '--is-ancestor', p, main]) === null)) return false;
  }
  const records = `:(exclude)${dir.replace(/\/$/, '')}`;
  const own = (x) => R.git(['diff', '--binary', `${main}...${x}`, '--', '.', records]);
  const a = own(v), b = own(head);
  if (a !== null && a === b) return true;
  // When main also changed a file the work touches, that diff's text moves (blob ids, line
  // numbers, context) though the work didn't. Then each merge must be exactly what git makes of
  // its parents on its own: redo it and compare trees, records aside. A conflict, a resolution or
  // any hand edit in the merge differs from that, so it voids the verdict.
  return merges.every((m) => {
    const parents = (R.git(['rev-list', '--parents', '-n', '1', m]) ?? '').split(' ').slice(1);
    if (parents.length !== 2) return false;
    const tree = R.git(['merge-tree', '--write-tree', '--no-messages', parents[0], parents[1]])?.split('\n')[0];
    return !!tree && /^[0-9a-f]{40}$/.test(tree) && R.git(['diff', '--quiet', tree, `${m}^{tree}`, '--', '.', records]) !== null;
  });
}
// The three tree reads every repo needs, over one git function and runner (home's, or a repo link's bound to
// its checkout; the tree reads use its runner, which returns { status, out, err }). changedFiles is -z: no quoting of spaces or
// non-ASCII, so every enforcement point compares the same bytes treePaths gives (git's
// quoted octal never meets a raw path). treePaths reads a commit's tree (or a tree id): dotfiles, submodule
// gitlinks and symlinks included, never the index or the working tree; a git that fails throws,
// so no caller can read a failure as an empty tree. mergeTree is what landing sha on base would
// produce: { tree }, { conflict: true }, or { error } when git couldn't say (git < 2.38 has no
// merge-tree --write-tree), which callers fail closed on.
export class GitReadError extends Error {}
export const firstLine = (s) => String(s ?? '').trim().split('\n')[0];
export const gitFacts = (gitFn, run) => ({
  changedFiles: (base, sha) => (gitFn(['diff', '-z', '--name-only', '--no-renames', base, sha]) ?? '').split('\0').filter(Boolean),
  treePaths: (ref) => {
    const r = run(['ls-tree', '-r', '-z', '--name-only', ref]);
    if (r.status !== 0) throw new GitReadError(`could not read the tree at ${String(ref).slice(0, 12)} (git ls-tree: ${firstLine(r.err) || `exit ${r.status}`})`);
    return r.out.split('\0').filter(Boolean);
  },
  mergeTree: (base, sha) => {
    const r = run(['merge-tree', '--write-tree', '--no-messages', base, sha]);
    const t = r.out.split('\n')[0];
    if (r.status === 0 && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(t)) return { tree: t };
    if (r.status === 1 && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(t)) return { conflict: true };
    return { error: firstLine(r.err) || `exit ${r.status}` };
  },
});
// git with its exit status, for the reads whose failure means something (the tree reads above).
export function gitRun(args, cwd = HOME_CWD) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status ?? -1, out: (r.stdout ?? '').replace(/\n$/, ''), err: r.stderr || r.error?.message || '' };
}
export const { changedFiles, treePaths, mergeTree } = gitFacts((args, cwd) => git(args, cwd), gitRun);
// merge-tree --write-tree is git 2.38's; an older git can't say what a PR would land.
export const gitVersion = () => memo('git-version', () => /(\d+\.\d+(\.\d+)?)/.exec(git(['--version']) ?? '')?.[1] ?? null);
export const gitTooOld = () => { const v = gitVersion(); const [a, b] = (v ?? '').split('.').map(Number); return v && (a < 2 || (a === 2 && b < 38)) ? `coverage needs git ≥ 2.38 (merge-tree --write-tree); found ${v}` : null; };
// Home as the coverage code sees a repo. Every coverage helper takes a repo argument defaulting to
// this, so a repo link's object (with the same fields) can slot in later without new call shapes.
export const homeFacts = {
  name: 'home', changedFiles, treePaths, mergeTree,
  mainRef: () => mainRef(), devteamLine: () => devteamLine(),
  get settings() { return loadSettings(); },
};
// Main's committed settings (home's main: settings live in home), or the defaults before they land.
export const mainSettings = (fallback = { ...SETTINGS_DEFAULTS }) => (mainRef() ? settingsAt(mainRef(), { orNull: true }) : null) ?? fallback;
// The settings that judge a PR. Never the working tree's.
// - A ticket PR, and any PR that leaves settings.md alone: main's, committed. A ticket can never
//   change settings.md (it's in the kit's line), so its head's settings never decide.
// - A plan or chore PR that changes settings.md: the settings that would land. That is the head's
//   when main's settings.md hasn't moved since the branch left it. Else, once lines are declared on
//   main or at the head, the merge's (read from the landing tree, so a git that can't merge-tree
//   fails closed): judging a chore by what it lands is the point of a chore that redraws lines.
//   With no lines, only the registry is judged, so no tree is merged (git < 2.38 is fine): the
//   settings are merged key by key, and links entry by entry, from base, head and main as git show
//   reads them (mergeSettings).
// settings.md lives in home, so for a PR in another repo they would be home main's.
// Returns { sMain, head, fromHead, landed() → { settings, tree? } | { problem } }.
export function settingsInForce(base, sha, R = homeFacts, { ticket = false } = {}) {
  const sMain = mainSettings();
  const rel = `${projectRel}/settings.md`;
  const changed = (a, b) => !!a && !!b && git(['diff', '--quiet', a, b, '--', rel]) === null;
  if (R.name !== 'home' || ticket || !changed(base, sha)) return { sMain, head: sMain, fromHead: false, landed: () => ({ settings: sMain }) };
  const head = settingsAt(sha, { orNull: true });
  const invalid = (at) => ({ problem: `${rel} at ${at}: the json devteam block is missing or not valid JSON` });
  return {
    sMain, head, fromHead: true,
    landed: () => {
      if (!changed(base, R.mainRef())) return head ? { settings: head } : invalid(sha.slice(0, 12));
      if (!linesDeclared(head ?? {}) && !linesDeclared(sMain)) {
        if (!head) return invalid(sha.slice(0, 12));
        const sBase = settingsAt(base, { orNull: true });
        return sBase ? mergeSettings(sBase, head, sMain) : { settings: head };
      }
      const land = landingTree(sha, R);
      if (land.problem) return land;
      const s = settingsAt(land.tree, { orNull: true });
      return s ? { settings: s, tree: land.tree } : invalid(`the merge of ${sha.slice(0, 12)} onto ${R.mainRef()}`);
    },
  };
}
// The settings a merge of head onto main lands, for a project with no lines (no tree is merged):
// a key the head left as the base had it is main's, else the head's; links go entry by entry the
// same way. Where both sides changed one key, or one link entry, and differently, it is refused:
// git's text merge may still combine the two into a value neither side wrote (an entry no act
// wrote), or conflict, and either way what lands isn't this merge's to say.
// Returns { settings } | { problem }.
export function mergeSettings(b, h, m) {
  const both = [];
  const pick = (x, y, z, pre = '') => {
    const out = Object.create(null);
    for (const k of new Set([...Object.keys(x ?? {}), ...Object.keys(y ?? {}), ...Object.keys(z ?? {})])) {
      if (!pre && k === 'links') continue;
      const [cb, ch, cm] = [ownEntry(x, k), ownEntry(y, k), ownEntry(z, k)].map(canonical);
      if (ch !== cb && cm !== cb && ch !== cm) both.push(`${pre}${k}`);
      const v = ch === cb ? ownEntry(z, k) : ownEntry(y, k);
      if (v !== undefined) out[k] = v;
    }
    return out;
  };
  const settings = { ...pick(b, h, m), links: pick(b.links, h.links, m.links, 'links.') };
  return both.length ? { problem: `${projectRel}/settings.md: both main and this branch changed ${both.join(', ')}; merge main into the branch first` } : { settings };
}
// Coverage of one repo's tree under one set of settings, once per read of the log; null with no lines.
export const coverageAt = (ref, s, R = homeFacts) => (linesDeclared(s) ? memo(`coverage\0${R.name}\0${ref}\0${canonical(s.components)}`, () => coverage(R.treePaths(ref), componentsOn(s, R.name), R.devteamLine())) : null);
// Gaps on main under main's committed lines: commits that bypassed devteam. Zero
// with no lines. While non-zero, no new ticket starts in that repo.
// What blocks new tickets in a repo, by class, so the message names what it counted:
// { count, words }. A main whose tree can't be read counts as a gap (fail closed).
export const coverageGapInfo = (name = 'home', R = homeFacts) => memo(`coverageGap\0${name}`, () => {
  const main = R.mainRef();
  const s = main && projectInRepo ? mainSettings(null) : null;
  const read = s ? readCoverage(() => coverageAt(main, s, R)) : {};
  if (read.error) return { count: 1, words: `its tree can't be read (${read.error})` };
  if (!read.value) return { count: 0, words: '' };
  const g = coverageGaps(read.value, s);
  // an empty glob excludes nothing: a line-empty finding of its own, never a block
  const parts = [[g.unowned.length, 'unowned'], [g.contested.length, 'contested'], [g.unlinked.length, 'unlinked'], [g.case_collisions.length, 'case collision(s)']].filter(([n]) => n);
  return { count: parts.reduce((t, [n]) => t + n, 0), words: parts.map(([n, w]) => `${n} ${w}`).join(', '), empty: g.empty };
});
export const coverageGap = (name = 'home', R = homeFacts) => coverageGapInfo(name, R).count;
// A coverage read whose tree git couldn't read: { error }, never an empty tree (fail closed).
export function readCoverage(fn) {
  try { return { value: fn() }; } catch (e) { if (e instanceof GitReadError) return { error: e.message }; throw e; }
}
// The Baseline's floor gaps (planning.md §7): unowned, owned twice, a component whose link can't hold files,
// an owns glob that matches nothing. Case collisions fail the check but aren't a gap class.
export function coverageGaps(cov, s) {
  const unlinked = Object.entries(s.components ?? {}).filter(([, c]) => isObj(c) && (c.link ?? 'home') !== 'home' && !LINK_KINDS[ownEntry(s.links, c.link)?.kind]?.hostsComponents).map(([n]) => n);
  return { ...cov, unlinked, count: cov.unowned.length + cov.contested.length + cov.empty.length + unlinked.length };
}

export const OFF_LINE = 'changes files outside the line of';
// A records-in-home ticket's home branch holds only its records: every file it changes against
// home's main, by merge-base as a ticket's footprint is read, is in its own records folder. This
// keeps a link ticket from changing home's settings, log or strategy through its records branch.
// Every merge base is read (final-11 F1): with more than one, git merges from a virtual base that
// no diff against one of them shows, so a criss-cross could carry any file past the folder rule;
// such a branch merges home's main in first. Records never change the jobs either: what the merge
// lands at recurring.json is main's (recurringRegistry.landing), or the branch is refused.
export function recordsBranchFails(id, recSha) {
  const main = mainRef();
  const bases = main ? (git(['merge-base', '--all', main, recSha]) ?? '').split('\n').filter(Boolean) : [];
  if (!bases.length) return [`cannot resolve home's main branch; home's ticket/${id} footprint not checked`];
  if (bases.length > 1) return [`home's ticket/${id} has ${bases.length} merge bases with home's main, so what it lands is more than its changes show; merge home's main into it first`];
  const own = `${projectRel}/tickets/${id}/`;
  const off = changedFiles(bases[0], recSha).filter((x) => !x.startsWith(own));
  const fails = off.length ? [`home's ticket/${id} changes files outside its records folder ${own}: ${off.slice(0, 10).join(', ')}${off.length > 10 ? ` (+${off.length - 10} more)` : ''}`] : [];
  const L = recurringRegistry.landing(mainSha(), recSha, loadSettings().merge_method);
  if (L.problem) fails.push(`home's ticket/${id}: ${L.problem}`);
  else if (Object.keys(L.changed).length) fails.push(`home's ticket/${id} changes the jobs (recurring.json: ${Object.keys(L.changed).join(', ')}): records never change them`);
  return fails;
}
// Definition of done at an exact head, reading the files committed at that head. The forge's
// check-pr passes approvals: false, because the supervisor's approval acts live in its log.
export function checkTicket(id, { sha: shaArg, title, body, approvals = true, records: recordsArg, inHome }) {
  const t = tickets().get(id);
  if (!t) return [`no ticket ${id}`];
  const fails = [];
  if (t.superseded_by) fails.push(`ticket is superseded by ${t.superseded_by}`);
  // the ticket's own repo (an act: fails fast on a missing or wrong checkout)
  const R = repoOfTicketId(id);
  let sha = null;
  let src = WORKTREE;
  // Records in home: the records are home's at recSha (merge pins it; else home's ticket/<id>, the
  // local branch, else origin's), the code the link's at sha. Never home's working tree.
  let recSha = null;
  if (R.commonDir) {
    sha = headIn(R, shaArg);
    if (!sha) return [`commit ${shaArg} not found locally${R.name === 'home' ? '' : ` in ${R.name}`} (fetch it first)`];
  }
  // Decided once, at the head judged (or as merge and check-pr decided it), and used for every
  // records read below: records left in the link are read there, as under records "repo".
  const H = inHome ?? recordsInHome(t, { at: sha });
  if (recordsHomeSetting(t) && !H) warnLeftInRepo(t, R);
  if (R.commonDir) {
    if (H) {
      // records: undefined reads home's ticket/<id>; null is merge's "none pinned" (it says why)
      const ref = recordsArg === undefined ? homeRecordsRef(id) : recordsArg;
      recSha = ref ? resolveCommit(ref) : null;
      if (recordsArg && !recSha) return [`records commit ${recordsArg} not found in home (fetch it first)`];
      src = { ref: recSha };
    } else if (R.projectInRepo) src = R.name === 'home' ? { ref: sha } : { ref: sha, repo: R };
  }
  if (H && !recSha && recordsArg !== null) fails.push(`no records for ${id} in home: commit them under ${projectRel}/tickets/${id}/ on home's ticket/${id}`);
  if (H && recSha) fails.push(...recordsBranchFails(id, recSha));
  if (!H || recSha) {
  const read = (rel) => srcRead(src, `tickets/${id}/${rel}`);
  if (read('spec.md') === null) fails.push('spec.md missing at this head');
  else if (approvals && !approvalOf(id, 'approve-spec')) fails.push('spec not approved (the supervisor logs act --class approve-spec --refs <id>)');
  if (read('plan.md') === null) fails.push('plan.md missing at this head');
  else if (approvals && !approvalOf(id, 'approve-plan')) fails.push('plan not approved (the supervisor logs act --class approve-plan --refs <id>)');
  const verText = read('verification.md');
  if (verText === null) fails.push('verification.md missing: a table with a row per done-when, the command run and its result');
  else {
    const rows = verText.split('\n').filter((l) => /^\|/.test(l.trim()) && !/^\|\s*-/.test(l.trim())).length - 1;
    if (rows < (t.done_when ?? []).length) fails.push(`verification has ${Math.max(rows, 0)} row(s) for ${t.done_when.length} done-when(s)`);
  }
  // A WORKTREE src goes on without H: a link ticket never reaches it (linkRepo always has commonDir
  // and projectInRepo), and a home ticket's records setting is false, so the views form agrees.
  const reviews = ticketReviews(id, src === WORKTREE ? src : { ...src, inHome: H });
  // An unnamed record counts for nothing; it fails the ticket only while it is the latest in its
  // track (a later, named pass in the same track supersedes it).
  const superseded = (r) => reviews.some((o) => o !== r && o.stage === r.stage && o.variant === r.variant && o.pass > r.pass);
  for (const r of reviews) {
    if (r.verdict && !r.shaValid) fails.push(`${r.file}: the verdict needs the full 40-character SHA`);
    if (r.verdict && !r.reviewer && !superseded(r)) fails.push(`${r.file}: no "- Reviewer:" line; an unnamed review does not count`);
  }
  // The latest record in every final track must say APPROVE at a commit that holds at this head.
  const reviewsDir = R.projectInRepo ? `${R.projectRel}/tickets/${id}/reviews/` : null;
  const codeHolds = (v) => (sha ? verdictHolds(v, sha, reviewsDir, R) : false);
  // records in home: the verdict also names the records it reviewed (- Records: <sha>), which must
  // hold at the records head by the same rule, in home
  const homeReviewsDir = `${projectRel}/tickets/${id}/reviews/`;
  const recordsHold = (r) => !H || (!!r.records && verdictHolds(r.records, recSha, homeReviewsDir, repo('home')));
  const holdsAt = (r) => codeHolds(r.sha) && recordsHold(r);
  const latest = latestPerTrack(reviews, 'final');
  if (!latest.length) fails.push('no final review record (reviews/final-<n>.md)');
  for (const r of latest) {
    if (r.verdict === 'CHANGES') fails.push(`${r.file}: the latest final review in its track says CHANGES`);
    else if (r.verdict !== 'APPROVE') fails.push(`${r.file}: no verdict line (Verdict: APPROVE|CHANGES <sha>)`);
    else if (!codeHolds(r.sha)) fails.push(`${r.file}: its verdict is at ${(r.sha ?? '').slice(0, 12)}, which does not hold at ${sha?.slice(0, 12)}: a verdict holds at its own commit, or at a later head whose only changes are newly added review records`);
    else if (H && !r.records) fails.push(`${r.file}: no "- Records: <full sha>" line; a review of a ticket whose records are in home names the home commit of the records it reviewed`);
    else if (!recordsHold(r)) fails.push(`${r.file}: its records verdict is at ${r.records.slice(0, 12)}, which does not hold at home's ${recSha.slice(0, 12)}: the records changed since the review in more than newly added review records`);
  }
  const approvers = new Set(latest.filter((r) => r.verdict === 'APPROVE' && holdsAt(r) && r.reviewer).map((r) => r.reviewer));
  const need = t.risk === 'high' ? 2 : 1;
  if (approvers.size < need) fails.push(`needs ${need} final APPROVE review(s) at this head from different named reviewers; found ${approvers.size}`);
  for (const r of reviews) for (const f of r.findings) if (blocking(f.severity) && !disposed(f.disposition)) fails.push(`${r.file} ${f.id} (${f.severity}) has no disposition${f.disposition ? ` ("${f.disposition.slice(0, 40)}" isn't one)` : ''}: the author starts its Disposition cell with fixed, wont-fix <reason> or wrong <reason>`);
  // a row whose cell count differs from its header reads fine here, but not to a reviewer, and dispose
  // refuses it: say how to fix its shape, then fill it
  for (const r of reviews) for (const f of r.findings) if (f.cells) warn(`${r.file} ${f.id}: its row has ${f.cells} cells and the header ${f.width}, so dispose refuses it: ${f.cells > f.width ? 'a "|" inside a cell (a code span too) splits it; escape each as "\\|" (or remove a stray cell)' : 'a cell is missing (an empty Disposition is a cell too, "| |"); add it'}, then fill its Disposition with devteam.mjs dispose ${'<ticket>'} ${r.file} ${f.id} "fixed"`);
  }
  const base = R.mainRef() && sha ? R.git(['merge-base', R.mainRef(), sha]) : null;
  if (R.commonDir && !base) fails.push(`cannot resolve main branch "${R.settings.main_branch}"${R.name === 'home' ? '' : ` in ${R.name}`}; footprint not checked`);
  if (base) {
    const changed = R.changedFiles(base, sha);
    // records in home: nothing of the project's in the link, its own folder included
    const own = R.projectInRepo && !H ? `${R.projectRel}/tickets/${id}/` : null;
    const mineOwn = (f) => !!own && f.startsWith(own);
    // A whole entry (no #part) covers a file as before; a file is also inside touches when an entry
    // names a part of it, and then only the parts named may change.
    const entries = t.touches ?? [];
    const whole = (f) => entries.some((g) => !touchPart(g) && pathMatches(g, f));
    const partsNamed = (f) => entries.filter((g) => touchPart(g) && trimSlash(touchPath(g)) === f && !hasWild(touchPath(g))).map(touchPart);
    const outside = changed.filter((f) => !mineOwn(f) && !whole(f) && !partsNamed(f).length);
    for (const f of changed) {
      if (mineOwn(f) || whole(f) || !partsNamed(f).length) continue;
      const show = (at) => R.git(['cat-file', 'blob', `${at}:${f}`]);
      const gap = partsChanged(show(base), show(sha), f, partsNamed(f));
      if (gap.length) fails.push(`changes parts of ${f} the ticket doesn't name: ${[...new Set(gap.map(leafWords))].slice(0, 10).join(', ')}${gap.length > 10 ? ` (+${gap.length - 10} more)` : ''} (the file's rest is the lines outside every declaration, heading and region); a part not named is a design-change to the supervisor (worker.md §3)`);
    }
    if (outside.length) fails.push(`changes files outside touches: ${outside.slice(0, 10).join(', ')}${outside.length > 10 ? ` (+${outside.length - 10} more)` : ''}; if the supervisor widened touches with ticket set since the log last landed, land the log first (log-sync, then merge --chore log) and check again`);
    // Component lines: a changed file is also inside the ticket's component's line or
    // a touches_components member's; the kit's own line is closed but for the ticket's own folder.
    // Judged by main's committed settings, so neither a line widened in a working tree nor the
    // ticket's own edit to settings.md changes anything. Settings live in home, so another
    // repo's ticket is judged by home main's lines for that repo.
    const s = mainSettings();
    if (linesDeclared(s)) {
      const comps = componentsOn(s, R.name);
      // touches_components widens only a contract or integration ticket, as in validate
      const tc = t.touches_components ?? [];
      const wide = ['contract', 'integration'].includes(t.kind);
      if (tc.length && !wide) fails.push(`touches_components is for contract and integration tickets; this ${t.kind ?? ''} ticket's line is ${t.component}'s alone`);
      const names = [t.component, ...(wide ? tc : [])];
      const L = compileLines(comps, R.devteamLine());
      const ownerOf = new Map(changed.map((f) => [f, ownersIn(f, L)]));
      const inLine = (f) => { const o = ownerOf.get(f); return o[0] !== 'devteam' && o.some((n) => names.includes(n)); };
      const off = changed.filter((f) => !mineOwn(f) && !outside.includes(f) && !inLine(f));
      if (off.length) {
        // each file with whose line it is in, and the fixes that fit
        const where = (f) => { const o = ownerOf.get(f); return o[0] === 'devteam' ? "the kit's own line" : o.length ? `${o.join(' and ')}'s line` : 'no line'; };
        const others = [...new Set(off.flatMap((f) => ownerOf.get(f)).filter((n) => n !== 'devteam' && !names.includes(n)))];
        const fixes = ['drop those changes', ...(others.length ? [`plan them as a contract or integration ticket that lists ${others.join(', ')} in touches_components`] : []), ...(off.some((f) => ownerOf.get(f)[0] === 'devteam') ? ['make kit changes in a chore'] : []), ...(off.some((f) => !ownerOf.get(f).length) ? ['draw a line around unowned files in a chore PR'] : []), 'or split the ticket'];
        fails.push(`${OFF_LINE} ${names.join(', ')}: ${off.slice(0, 10).map((f) => `${f} (${where(f)})`).join(', ')}${off.length > 10 ? ` (+${off.length - 10} more)` : ''}; ${fixes.join(', ')}`);
      }
    }
  }
  if (title !== undefined && !new RegExp(`^${id.replace(/-/g, '\\-')}: \\S`).test(title)) fails.push(`PR title must start with "${id}: "`);
  if (body !== undefined) {
    const owd = oneWayDoorsSection(body);
    if (!owd.ok) fails.push(owd.why);
    else if (owd.none && (t.one_way_doors ?? []).length) fails.push('the ticket lists one-way doors but the PR body says "None."; link the owner\'s answer');
  }
  return fails;
}
