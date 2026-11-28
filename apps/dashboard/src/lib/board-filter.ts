// kit-993: the Board's and Progress's filter rules, the board-filter block (index.html:2890-2921), as index.html has it, with types and exports.
// No imports and no DOM at import: compiled to lib-dist/lib/board-filter.js, which test/dashboard-board-progress.test.mjs imports.
// `Loose` is `any`: a ticket or planner row as /api/data serves it.
type Loose = any;

/* board-filter start */
// The Board's and Progress's pure rules (kit-91), run alone in vm by test/dashboard-board-progress:
// no page globals. x is a ticket row or a planner row as /api/data serves them. A ticket row always has
// a stage (and its own kind: build, chore…); a planner row has goals and no stage.
export const isPlannerRow = (x: Loose) => x.stage === undefined && Array.isArray(x.goals);
// needsAttention: a ticket blocked, waiting at a pane or held by a question; a planner waiting at a
// pane, with no window, or held by a question.
export function needsAttention(x: Loose) {
  if (isPlannerRow(x)) return !!(x.waiting || x.window === false || x.held_by);
  return !!(x.phase === 'blocked' || x.waiting || x.held_by);
}
// boardKeep: whether the Board shows x under the header's filters f = { goal, feat, repo, att };
// ctx.goalFeatures is the goal's features (a Set), or null when no goal applies (none, or unknown).
// A planner is always home's, and is kept by its own goals, not its feature's.
export function boardKeep(x: Loose, f: Loose, ctx: Loose) {
  const gf = f.goal && ctx && ctx.goalFeatures ? ctx.goalFeatures : null;
  if (f.feat && x.feature !== f.feat) return false;
  if (f.att && !needsAttention(x)) return false;
  if (isPlannerRow(x)) {
    if (gf && !x.goals.includes(f.goal)) return false;
    return !f.repo || f.repo === 'home';
  }
  if (gf && !gf.has(x.feature)) return false;
  return !f.repo || x.repo === f.repo;
}
// progressShown: a Progress row by Show: 'complete' the done, 'all' both, else (Active) the not done.
export function progressShown(done: Loose, show: Loose) {
  if (show === 'complete') return !!done;
  if (show === 'all') return true;
  return !done;
}
/* board-filter end */
