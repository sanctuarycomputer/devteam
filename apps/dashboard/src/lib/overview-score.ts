// kit-991: overview's score-of block of index.html (the Overview's Autonomy row), as index.html has it, with types.
// It uses nothing but its arguments: no imports and no DOM at import, compiled to lib-dist/lib/overview-score.js.
// `Loose` is `any`: /api/data's records have no fixed shape in index.html.
type Loose = any;

/* score-of start */
// The Overview's Autonomy row (kit-90): each tile's label, the path of its score record in /api/data,
// and where in that record its % sits. The place is named per tile, never guessed: autonomy_score
// (kit-242) keeps it at this_week with no score object, while autonomy.decisions (kit-98), efficiency
// (kit-173) and awareness (kit-242) keep it at score.this_week (autonomy.decisions' own this_week is a
// week record). Uses nothing but its arguments.
export const SCORE_TILES = [['autonomy score', 'autonomy_score', 'this_week'], ['trust score', 'autonomy.decisions', 'score.this_week'], ['efficiency score', 'efficiency', 'score.this_week'], ['awareness score', 'awareness', 'score.this_week']];
// A dotted path's value, through own properties only; undefined where any step is missing.
export function scoreAt(o: Loose, dotted: Loose) {
  let v = o;
  for (const k of String(dotted).split('.')) {
    if (v === null || typeof v !== 'object' || !Object.prototype.hasOwnProperty.call(v, k)) return undefined;
    v = v[k];
  }
  return v;
}
// A score record's % (rounded; null unless a finite number sits at its place) and its last 12 weeks'
// scores, oldest first (a null week, or one with no score, stays null; no array, no weeks).
export function scoreOf(rec: Loose, at = 'score.this_week') {
  const num = (x: Loose) => typeof x === 'number' && Number.isFinite(x);
  const v = scoreAt(rec, at);
  const weeks = rec && typeof rec === 'object' && Array.isArray(rec.weeks) ? rec.weeks.slice(-12).map((w: Loose) => (w && typeof w === 'object' && num(w.score) ? w.score : null)) : [];
  return { pct: num(v) ? Math.round(v) : null, weeks };
}
/* score-of end */
