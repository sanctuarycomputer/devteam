// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;

// kit-994: the score charts' pure parts (index.html's autonomy lines): week names, the gap path, the score line, the
// spend colours and keys. No imports and no DOM at import: compiled to lib-dist/lib/autonomy-charts.js.

export const effM = (n: Loose) => `${((n || 0) / 1e6).toFixed(1)}M`;
// ---- the score charts (ported from the mock, project/artifacts/dashboard-cleanup at main): a null is a
// gap, never a zero. kit-93 and kit-99 reuse them for Trust: a chart drawn at the width it gets is a
// .fit[data-fit=<key>] element, drawn by FIT_DRAW[key](el, W) whenever its width changes ----
export const weekName = (i: Loose, n: Loose) => (i === n - 1 ? 'this week' : i === n - 2 ? 'last week' : `${n - 1 - i} weeks ago`);
export const effNum = (x: Loose) => typeof x === 'number' && Number.isFinite(x);
// a path through the points, broken at every null: one M per run; a run of one point is a dot (a
// zero-length line, which a round cap shows)
export const gapPath = (v: Loose, X: Loose, Y: Loose) => { let d = ''; v.forEach((x: Loose, i: Loose) => { if (!effNum(x)) return; const p = `${X(i).toFixed(1)},${Y(x).toFixed(1)}`; d += effNum(v[i - 1]) ? `L${p}` : `M${p}${effNum(v[i + 1]) ? '' : `L${p}`}`; }); return d; };
// a score over the weeks, oldest first, on a fixed axis (0 to 100 by default): this week last and
// marked, last week marked, its value labelled; a null week has no point and breaks the line
export function scoreLine(v: Loose, W: Loose = 560, { min = 0, max = 100 }: Loose = {}) {
  const H = 120, P = 34, n = v.length, tw = n - 1, lw = n - 2;
  const X = (i: Loose) => P + (i * (W - P - 6)) / Math.max(1, n - 1);
  const Y = (x: Loose) => H - 18 - ((H - 30) * (Math.min(max, Math.max(min, x)) - min)) / (max - min || 1);
  const ty = (y: Loose) => Math.min(H - 14, Math.max(10, y));
  return `<svg class="score-line" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="The score over the last 12 weeks">
    ${[min, (min + max) / 2, max].map((g: Loose) => `<line x1="${P}" x2="${W}" y1="${Y(g)}" y2="${Y(g)}" stroke="var(--line-2)"/><text x="0" y="${Y(g) + 3}" class="lc-t">${g}%</text>`).join('')}
    <path class="line" fill="none" stroke="var(--series-1)" stroke-width="2" d="${gapPath(v, X, Y)}"/>
    ${v.map((x: Loose, i: Loose) => (!effNum(x) ? '' : `<circle data-i="${i}"${i === tw ? ' class="tw"' : i === lw ? ' class="lw"' : ''} cx="${X(i).toFixed(1)}" cy="${Y(x).toFixed(1)}" r="${i >= lw ? 4 : 2.5}" fill="${i === lw ? 'var(--surface)' : 'var(--series-1)'}" stroke="var(--series-1)" stroke-width="${i === lw ? 2 : 0}"><title>${weekName(i, n)}: ${x}%</title></circle>`)).join('')}
    ${effNum(v[lw]) ? `<text x="${X(lw) + 4}" y="${ty(Y(v[lw]) + 18)}" text-anchor="end" class="lc-t">last week ${v[lw]}%</text>` : ''}
    ${effNum(v[tw]) ? `<text x="${X(tw)}" y="${ty(Y(v[tw]) - 9)}" text-anchor="end" class="lc-t lc-b">this week ${v[tw]}%</text>` : ''}
    <text x="${P}" y="${H - 2}" class="lc-t">12 weeks ago</text><text x="${W}" y="${H - 2}" text-anchor="end" class="lc-t">this week</text></svg>`;
}
// Spend by phase, each week: a stacked bar a week, one segment per phase key (the union of the weeks'
// keys, the most spent over the 12 weeks at the bottom; ties by key); a week with no spend is an empty slot
// the page's own colour tokens (it defines only --series-1), never the error colour, cycled past the end
export const EFF_COLORS = ['var(--series-1)', 'var(--amber)', 'var(--green)', 'color-mix(in srgb, var(--series-1) 50%, var(--surface))', 'color-mix(in srgb, var(--amber) 50%, var(--surface))', 'color-mix(in srgb, var(--green) 50%, var(--surface))', 'var(--muted)'];
export const effUsd = (x: Loose) => `$${+(+x).toFixed(2)}`;
export function effPhaseKeys(weeks: Loose) {
  const tot = {};
  for (const w of weeks) for (const [k, v] of Object.entries(w.usd_by_phase || {})) if (effNum(v)) (tot as Loose)[k] = ((tot as Loose)[k] ?? 0) + v;
  return Object.keys(tot).sort((a: Loose, b: Loose) => (tot as Loose)[b] - (tot as Loose)[a] || (a < b ? -1 : 1));
}
