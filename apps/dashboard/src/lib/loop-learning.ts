// kit-996: the learning block of index.html (lineChart and learningSection), as index.html has it, with types. No
// imports and no DOM at import: compiled to lib-dist/lib/loop-learning.js, which test/ooda-learning.test.mjs imports.
// What the block uses from outside it comes through wireLoopLearning(), which src/views/loop/wire.ts calls once with
// the shell's DAY, esc and fmtDate; a seam not wired throws.
// `Loose` is `any`: the page's data has no fixed shape in index.html.
type Loose = any;
type Fn = (...a: Loose[]) => Loose;

const SEAMS = ['esc', 'fmtDate'] as const;
export type LoopLearningWire = { DAY: number; } & { [k in (typeof SEAMS)[number]]: Fn };

let DAY: number;
const wired: { [k: string]: Fn } = {};

// Each key given replaces that one seam or value; a key left out keeps what it had (as words-plain's wireWords).
export function wireLoopLearning(w: Partial<LoopLearningWire>): void {
  if (typeof w.DAY === 'number') DAY = w.DAY;
  for (const k of SEAMS) if (typeof w[k] === 'function') wired[k] = w[k];
}
const need = (n: string): Fn => {
  const f = wired[n];
  if (typeof f !== 'function') throw new Error(`loop: ${n} is not wired`);
  return f;
};
const esc = (...a: Loose[]) => need('esc')(...a);
const fmtDate = (...a: Loose[]) => need('fmtDate')(...a);

// ---- index.html's lines ----
/* learning start */
// A small time chart: one line per series over time, optional horizontal marks (targets).
// span: [from, to] in ms to fix the x axis (a sensor's last 24h); width: the drawing's own width,
// so a narrow card draws a narrow chart with readable text; a series may name its color. A point
// is [ts, value] or [ts, value, { hollow, href, title }]: hollow for too few to say, href to open
// what it counts. xmarks: [{ at, label, href }] draws dashed vertical lines (a retro, a rung change).
export function lineChart(series: Loose, { marks = [], xmarks = [], unit = '', height = 160, yMin = 0, span = null, width = 640 }: Loose = {}) {
  const pts = series.flatMap((s: Loose) => s.points);
  if (!pts.length) return '';
  const W = width, H = height, L = 40, R = 12, T = 12, B = 22;
  const xs = pts.map((p: Loose) => p[0]);
  let t0 = span ? span[0] : Math.min(...xs), t1 = span ? span[1] : Math.max(...xs, Date.now());
  if (!span && t1 - t0 < DAY) t0 = t1 - DAY;
  const yMax = Math.max(...pts.map((p: Loose) => p[1]), ...marks.map((m: Loose) => m.value), 1) * 1.1;
  const x = (ts: Loose) => L + ((ts - t0) / (t1 - t0)) * (W - L - R);
  const y = (v: Loose) => H - B - ((v - yMin) / (yMax - yMin)) * (H - T - B);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((s: Loose) => s.name).join(', '))} over time">`;
  for (const v of [yMin, (yMin + yMax) / 2, yMax / 1.1]) svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${esc(+v.toFixed(v < 10 ? 2 : 0))}${esc(unit)}</text>`;
  const xl = (ts: Loose) => (t1 - t0 <= 2 * DAY ? new Date(ts).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : fmtDate(ts));
  svg += `<text x="${L}" y="${H - 6}" font-size="10" fill="var(--muted)">${esc(xl(t0))}</text><text x="${W - R}" y="${H - 6}" text-anchor="end" font-size="10" fill="var(--muted)">${esc(xl(t1))}</text>`;
  const merged = ([] as Loose[]);
  for (const m of marks) { const same = merged.find((x: Loose) => x.value === m.value); if (same) { same.label = `${same.label}; ${m.label}`; same.strong ||= m.strong; } else merged.push({ ...m }); }
  let lastY = Infinity;
  for (const m of merged.sort((a: Loose, b: Loose) => b.value - a.value)) {
    const ly = Math.max(y(m.value) - 4, T + 8);
    const ty = lastY - ly < 12 ? lastY + 12 : ly;
    lastY = ty;
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(m.value)}" y2="${y(m.value)}" stroke="var(--muted)" stroke-dasharray="${m.strong ? '6 4' : '2 4'}"/><text x="${W - R - 2}" y="${ty}" text-anchor="end" font-size="10" fill="var(--fg)">${esc(m.label)}</text>`;
  }
  series.forEach((s: Loose, i: Loose) => {
    const ps = s.points.slice().sort((a: Loose, b: Loose) => a[0] - b[0]);
    svg += `<polyline fill="none" stroke="${s.color || `var(--series-${(i % 4) + 1}, var(--blue))`}" stroke-width="2" points="${ps.map((p: Loose) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')}"/>`;
    const c = s.color || `var(--series-${(i % 4) + 1}, var(--blue))`;
    if (ps.length <= 60) for (const p of ps) {
      const o = p[2] || {};
      const dot = `<circle cx="${x(p[0]).toFixed(1)}" cy="${y(p[1]).toFixed(1)}" r="3" ${o.hollow ? `fill="none" stroke="${c}" stroke-width="1.5" pointer-events="all" data-hollow` : `fill="${c}"`}><title>${esc(o.title ?? `${s.name}: ${p[1]}${unit} · ${fmtDate(p[0])}`)}</title></circle>`;
      svg += o.href ? `<a href="${esc(o.href)}">${dot}</a>` : dot;
    }
  });
  for (const m of xmarks) {
    const ts = Date.parse(m.at);
    if (!(ts >= t0 && ts <= t1)) continue;
    const X = x(ts).toFixed(1);
    const mark = `<g class="xmark"><line x1="${X}" x2="${X}" y1="${T}" y2="${H - B}" stroke="var(--muted)" stroke-dasharray="3 3"/><line x1="${X}" x2="${X}" y1="${T}" y2="${H - B}" stroke="transparent" stroke-width="8"/><title>${esc(`${m.label} · ${fmtDate(ts)}`)}</title></g>`;
    svg += m.href ? `<a href="${esc(m.href)}">${mark}</a>` : mark;
  }
  return `<div class="card chart mini-chart">${series.length > 1 ? `<div class="legend">${series.map((s: Loose, i: Loose) => `<span><i style="border-top-color:${s.color || `var(--series-${(i % 4) + 1}, var(--blue))`}"></i>${esc(s.name)}</span>`).join('')}</div>` : ''}${svg}</svg></div>`;
}
// Is the loop making the system smarter? Six small charts, two per column (Informed, Autonomous,
// Trusted), from the weekly learning records, oldest first. Three columns, never one score: a
// correction in one class shows as a dip, not averaged away by a promotion in another. A count and
// a share never share a chart. A point whose denominator is under LEARN_MIN is hollow: too few to say.
export const LEARN_MIN = 5;
export const learnShare = (a: Loose, b: Loose) => (b ? Math.round((100 * a) / b) : 0);
export const LEARN_CHARTS = [
  ['Informed', [
    { title: 'Accepted knowledge', note: 'lessons, facts and rules in force at the week\'s end', series: [{ name: 'accepted knowledge', v: (f: Loose) => f.informed.knowledge }] },
    { title: 'Explained, and given', note: 'recurring signals explained, of those formed; fresh starts given a lesson', unit: '%', series: [
      { name: 'signals explained', v: (f: Loose) => learnShare(f.informed.signals_explained, f.informed.signals_formed), n: (f: Loose) => f.informed.signals_formed },
      { name: 'starts given a lesson', v: (f: Loose) => learnShare(f.informed.starts_given, f.informed.starts), n: (f: Loose) => f.informed.starts },
    ] },
  ]],
  ['Autonomous', [
    { title: 'Ladder calls made on trust', note: 'of the calls in a trust-ladder class, the ones made on its rung or a standing rule, not asked', unit: '%', series: [{ name: 'on trust', v: (f: Loose) => learnShare(f.autonomous.trusted_calls, f.autonomous.ladder_calls), n: (f: Loose) => f.autonomous.ladder_calls }] },
    { title: 'Questions per merged ticket', note: 'decisions put to you, for each ticket merged', series: [{ name: 'questions per merged ticket', v: (f: Loose) => +(f.autonomous.questions / Math.max(1, f.autonomous.merged)).toFixed(2), n: (f: Loose) => f.autonomous.merged, none: 'no ticket merged' }] },
  ]],
  ['Trusted', [
    { title: 'Agreement', note: 'your answers that went with the recommendation', unit: '%', series: [{ name: 'agreement', v: (f: Loose) => learnShare(f.trusted.agreed, f.trusted.answered), n: (f: Loose) => f.trusted.answered }] },
    { title: 'Corrections per 100 calls', note: 'calls you corrected, for every hundred the supervisor made', series: [{ name: 'corrections per 100 calls', v: (f: Loose) => +((100 * f.trusted.corrections) / Math.max(1, f.trusted.calls)).toFixed(1), n: (f: Loose) => f.trusted.calls }] },
  ]],
];
// a record whose three columns aren't objects (a hand-written line) is left out, not drawn
export const learnable = (r: Loose) => !!r && !!r.figures && ['informed', 'autonomous', 'trusted'].every((k: Loose) => r.figures[k] && typeof r.figures[k] === 'object');
export function learningSection(o: Loose) {
  const recs = (o.learning || []).filter(learnable);
  const T = o.learning_totals || {};
  const plural = (n: Loose, one: Loose, many: Loose = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  if (recs.length < 3) {
    const since = T.since ? fmtDate(Date.parse(T.since)) : 'the start';
    return `<div class="learn-young" data-learn="young"><div class="grid">${[['calls', T.calls], ['lessons kept', T.lessons], ['corrections', T.corrections]].map(([k, v]: Loose) => `<div class="stat"><span>${esc(`${k} since ${since}`)}</span><b>${esc(v ?? 0)}</b></div>`).join('')}</div>
      <p class="small muted">Since ${esc(since)}: ${esc(plural(T.calls ?? 0, 'call'))}, ${esc(plural(T.lessons ?? 0, 'lesson'))} kept, ${esc(plural(T.corrections ?? 0, 'correction'))}. The loop needs a few weeks of calls, answers and lessons before trends mean anything.</p></div>`;
  }
  const xmarks = (o.learning_marks || []).map((m: Loose) => ({ at: m.at, label: m.label, href: m.href }));
  const span = [Date.parse(recs[0].from), Date.parse(recs[recs.length - 1].from) + 7 * DAY];
  const chart = (c: Loose) => {
    const series = c.series.map((s: Loose, i: Loose) => ({ name: s.name, color: i ? 'var(--amber)' : 'var(--series-1)', points: recs.map((r: Loose) => {
      const v = s.v(r.figures);
      const n = s.n ? s.n(r.figures) : null;
      const few = n !== null && n < LEARN_MIN;
      return [Date.parse(r.from), v, { hollow: few, href: `#learning/${encodeURIComponent(r.id)}`, title: few ? `${s.name}, week ${r.week}: ${n === 0 && s.none ? s.none : `too few to say (n = ${n})`}` : `${s.name}, week ${r.week}: ${v}${c.unit || ''}${n !== null ? ` (n = ${n})` : ''}` }];
    }) }));
    return `<div class="learn-chart" data-chart="${esc(c.title)}"><h4>${esc(c.title)}</h4>${lineChart(series, { unit: c.unit || '', height: 120, width: 360, span, xmarks })}<p class="small muted">${esc(c.note)}</p></div>`;
  };
  return `<div class="learn-cols" data-learn="charts">${LEARN_CHARTS.map(([col, charts]: Loose) => `<div class="learn-col"><h3>${esc(col)}</h3>${charts.map(chart).join('')}</div>`).join('')}</div>
    <p class="small muted">Weekly, from each week's learning record: open a point for what it counted. A hollow point is too few to say (under ${LEARN_MIN}). Dashed lines are retros and rung changes.</p>`;
}
/* learning end */
