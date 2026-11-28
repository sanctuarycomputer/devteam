// kit-993: the board's columns (index.html:2876-2889), as index.html has it, with types and exports.
// No imports and no DOM at import: compiled to lib-dist/lib/board-columns.js.
// `Loose` is `any`: a ticket row as /api/data serves it, and the page's untyped lookups.
type Loose = any;


// ---- kanban board ----
export const COLUMNS = [['Backlog', ['planned']], ['Ready', ['ready']], ['Planning', ["spec'd", 'planned-in-detail']], ['Building', ['building']], ['Review', ['in-review']], ['Merged', ['merged']], ['Released', ['released']]];
// The stage moves on approvals and reviews; a worker already writing the spec or the code belongs
// in that column, not in Ready, or "workers active" and the board disagree.
// Waiting for a word or blocked says nothing about how far along it is: at least Planning, and the
// stage (approvals, review records) moves it further.
export const PHASE_COLUMN: Loose = { starting: 'Planning', spec: 'Planning', plan: 'Planning', 'awaiting-word': 'Planning', blocked: 'Planning', contract: 'Building', build: 'Building', verify: 'Building', 'final-review': 'Review', merging: 'Review' };
export const RANK = Object.fromEntries(COLUMNS.map(([n], i) => [n, i]));
export function columnOf(t: Loose) {
  const byStage = (COLUMNS.find(([, stages]) => stages.includes(t.stage)) ?? COLUMNS[0])[0] as Loose;
  const byPhase = PHASE_COLUMN[t.phase];
  return byPhase && RANK[byPhase] > RANK[byStage] && RANK[byStage] < RANK.Merged ? byPhase : byStage;
}
