// kit-994: the Efficiency page (index.html's autonomy lines): its card, the charts drawn at the width they get, the
// waste rows and the suggestions list (which Trust and Awareness reuse).
import { EFF_COLORS, effM, effNum, effPhaseKeys, effUsd, gapPath, scoreLine, weekName } from '../../lib/autonomy-charts';
import { esc, subj } from '../shell';
import { $ } from '../shell/page';
import { suggView, tCut, tLine } from '../threads-core';
import { threadsCoreState } from '../threads-core/state';
import { tlStart } from '../threads-panel';
import { cardHead, linkify, words } from '../words';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


// ---- Efficiency (kit-174): the Efficiency Score card, its own page beside Trust ----
// It formats /api/data efficiency (kit-173) and metrics.cost, and computes no score, best or ratio.
// Laid out as the mock's: ruled sections (the layout block's .sec: a label, then the body).
export const effSection = (label: Loose, body: Loose) => `<section class="sec"><div class="lbl">${esc(label)}</div><div class="sec-b">${body}</div></section>`;
export const effNone = (s: Loose = 'None') => `<p class="empty">${s}</p>`;
// a bar block, largest first (ties by key), labelled by the kit's own keys; "None" with nothing above 0
export function effBars(obj: Loose, fmt: Loose) {
  const rows = Object.entries(obj || {}).filter(([, v]: Loose) => Number.isFinite(v) && v > 0).sort((a: Loose, b: Loose) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  if (!rows.length) return effNone();
  return `<div class="bars">${rows.map(([k, v]: Loose) => `<div><span class="k" title="${esc(k)}">${esc(k)}</span><span class="b" style="width:${(100 * v) / (rows[0][1] as Loose)}%"></span><span>${esc(fmt(v))}</span></div>`).join('')}</div>`;
}
// Where it goes: Health's four spend cards, and tokens by phase, from efficiency.observe, else (a
// server without efficiency) from metrics, which keeps by_model and tokens under cost; then where the
// figures come from
export function effWhere(d: Loose) {
  const m = d.metrics || {}, o = d.efficiency?.observe;
  const src = o ? { phase_hours: o.phase_hours, phase_usd: o.phase_usd, by_model: o.by_model, tokens: o.tokens, tokens_by_phase: o.tokens_by_phase }
    : { phase_hours: m.phase_hours, phase_usd: m.phase_usd, by_model: m.cost?.by_model, tokens: m.cost?.tokens, tokens_by_phase: null };
  const tk = src.tokens || {};
  const all = (t: Loose) => (t?.input || 0) + (t?.output || 0) + (t?.cache_read || 0) + (t?.cache_write || 0);
  const blocks = [
    ['flame', 'Tokens by phase', src.tokens_by_phase ? effBars(Object.fromEntries(Object.entries(src.tokens_by_phase).map(([k, t]: Loose) => [k, all(t)])), effM) : effNone()],
    ['clock', 'Hours by phase', effBars(src.phase_hours, (v: Loose) => `${v}h`)],
    ['dollar-sign', 'USD by phase', effBars(src.phase_usd, (v: Loose) => `$${v}`)],
    ['cpu', 'USD by model', effBars(Object.fromEntries(Object.entries(src.by_model || {}).map(([k, v]: Loose) => [k, v?.usd])), (v: Loose) => `$${v}`)],
    ['coins', 'Tokens', effBars({ input: tk.input, output: tk.output, 'cache reads': tk.cache_read, 'cache writes': tk.cache_write }, effM)],
  ];
  const c = m.cost || {}, un = Object.keys(c.unpriced_models || {});
  const said = `${c.source === 'measured' ? 'Measured from the agents\' own session logs' : 'Nothing measured: spend shows only what agents reported'}${un.length ? ` · <span class="err">Unpriced: ${esc(un.join(', '))}</span>` : ''}`;
  return `<div class="eff-where">${blocks.map(([ic, h, b]: Loose) => `<div class="eff-obs"><h4 class="props-h"><i class="icon-${ic}" aria-hidden="true"></i> ${h}</h4>${b}</div>`).join('')}</div><p class="eff-src">${said}</p>`;
}
// The card, drawn into #efficiency only when it changed, so a redraw keeps focus and a pin's element;
// the nav count is this week's score
export function renderEfficiency(d: Loose) {
  const e = d.efficiency || null;
  const sc = e?.score?.this_week;
  const n = $('n-efficiency');
  if (n) n.textContent = Number.isFinite(sc) ? `${sc}%` : '';
  const html = `<div class="card eff-card">${cardHead('gauge', 'Efficiency Score', { extra: '<span class="muted">this week</span>' })}${
    effSection('Score', e ? effScore(e) : effNone())}${
    effSection('Where it goes', effWhere(d))}${
    effSection('Waste', e ? effWaste(e.waste || []) : effNone())}${
    effSection('Suggestions', e ? effSuggestions(e.suggestions || []) : effNone('None this week'))}</div>`;
  const el = $('efficiency');
  if (!el || (el as Loose).__html === html) return;
  (el as Loose).__html = html;
  for (const f of el.querySelectorAll('.fit[data-fit]')) FIT_SEEN?.unobserve(f);
  el.innerHTML = html;
  fitCharts();
}
// a sparkline over the weeks, scaled to its own non-null values
export function spark(v: Loose, label: Loose) {
  const xs = v.filter(effNum), max = xs.length ? Math.max(...xs) : 1, min = xs.length ? Math.min(...xs) : 0;
  const X = (i: Loose) => 1 + (i * 78) / Math.max(1, v.length - 1), Y = (x: Loose) => (max === min ? 9 : 17 - (15 * (x - min)) / (max - min));
  return `<svg class="sparkline" viewBox="0 0 80 18" width="100%" height="24" preserveAspectRatio="none" role="img" aria-label="${esc(label)}, the last 12 weeks"><path fill="none" stroke="var(--series-1)" stroke-width="1.5" stroke-linecap="round" vector-effect="non-scaling-stroke" d="${gapPath(v, X, Y)}"/></svg>`;
}
// The charts drawn at the width they get, by key (a page adds its own); one ResizeObserver redraws a
// chart whose width changed, a page coming into view or the window resized
export const FIT_DRAW = {};
export const FIT_SEEN = typeof ResizeObserver === 'function' ? new ResizeObserver(() => requestAnimationFrame(fitCharts)) : null;
export function fitCharts() {
  for (const el of document.querySelectorAll('.fit[data-fit]')) {
    if (!(el as Loose).__fitSeen) { (el as Loose).__fitSeen = true; FIT_SEEN?.observe(el); }
    const W = Math.floor(el.clientWidth), draw = (FIT_DRAW as Loose)[(el as Loose).dataset.fit];
    if (!W || !draw || +(el as Loose).dataset.w === W) continue;
    (el as Loose).dataset.w = W;
    el.innerHTML = draw(el, W);
  }
}
export function effPhaseBars(weeks: Loose, W: Loose = 560) {
  const keys = effPhaseKeys(weeks), n = weeks.length;
  const val = (w: Loose, k: Loose) => (effNum(w.usd_by_phase?.[k]) && w.usd_by_phase[k] > 0 ? w.usd_by_phase[k] : 0);
  const tot = (w: Loose) => keys.reduce((a: Loose, k: Loose) => a + val(w, k), 0);
  const max = Math.max(0, ...weeks.map(tot));
  if (!keys.length || !max) return effNone();
  const H = 96, slot = W / n, bw = Math.max(1, slot - 6), col = (j: Loose) => EFF_COLORS[j % EFF_COLORS.length];
  return `<svg class="split" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Spend by phase, each week">${weeks.map((w: Loose, i: Loose) => {
    let y = H - 14;
    return keys.map((k: Loose, j: Loose) => { const v = val(w, k); if (!v) return ''; const h = ((H - 24) * v) / max; y -= h;
      return `<rect data-i="${i}" x="${(i * slot).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" style="fill:${col(j)}"><title>${esc(`${weekName(i, n)}: ${k} ${effUsd(v)} of ${effUsd(tot(w))}`)}</title></rect>`; }).join('');
  }).join('')}<text x="0" y="${H - 2}" class="lc-t">12 weeks ago</text><text x="${W - 6}" y="${H - 2}" text-anchor="end" class="lc-t">this week</text></svg>
    <div class="legend small">${keys.map((k: Loose, j: Loose) => `<span><i style="border-top-color:${col(j)}"></i>${esc(k)} ${effUsd(val(weeks[n - 1] || {}, k))}</span>`).join('')}</div>`;
}
export let EFF_WEEKS = [];
(FIT_DRAW as Loose)['eff-score'] = (el: Loose, W: Loose) => scoreLine(EFF_WEEKS.map((w: Loose) => w.score), W, { min: 0, max: 100 });
(FIT_DRAW as Loose)['eff-phase'] = (el: Loose, W: Loose) => effPhaseBars(EFF_WEEKS, W);
// The Score section: this and last week's score, the three parts with their ratios, the 12-week line,
// a sparkline per measure, and spend by phase. A week with an escaped defect takes another week's
// spend and time (kit-173), so its ratio would disagree with its part: it says so instead.
export const EFF_FIRST_TIP = 'first passes of each spec, plan, final and task review';
export function effScore(e: Loose) {
  const weeks = Array.isArray(e.weeks) ? e.weeks : [], w = weeks[weeks.length - 1] || {}, best = e.best || {};
  EFF_WEEKS = weeks;
  const pc = (x: Loose) => (effNum(x) ? `${Math.round(100 * x)}%` : '–');
  const sc = (x: Loose) => (effNum(x) ? `${x}%` : '–');
  const usd = (x: Loose) => (effNum(x) ? `$${Math.round(x)}` : '–'), hr = (x: Loose) => (effNum(x) ? x.toFixed(1) : '–');
  const held = 'held down: an escaped defect this week';
  const ratio = (b: Loose, t: Loose, f: Loose, unit: Loose) => (effNum(b) && effNum(t) ? `best ${f(b)} ÷ this week ${f(t)} ${unit}` : '–');
  const defect = w.escaped_defects > 0;
  const parts = [
    ['spend', pc(e.parts?.spend), defect ? held : ratio(best.usd_per_point, w.usd_per_point, usd, 'per point'), ''],
    ['time', pc(e.parts?.time), defect ? held : ratio(best.hours_per_point, w.hours_per_point, hr, 'hours per point'), ''],
    ['rework', pc(e.parts?.rework), 'reviews passed the first time', EFF_FIRST_TIP],
  ];
  const pair = (t: Loose, b: Loose, f: Loose) => (effNum(t) || effNum(b) ? `${f(t)} · best ${f(b)}` : '–');
  const col = (k: Loose) => weeks.map((x: Loose) => (effNum(x[k]) ? x[k] : null));
  const counts = [
    ['$ per merged point', pair(w.usd_per_point, best.usd_per_point, usd), col('usd_per_point'), ''],
    ['hours per merged point', pair(w.hours_per_point, best.hours_per_point, hr), col('hours_per_point'), ''],
    ['reviews passed the first time', pc(w.first_pass), col('first_pass'), EFF_FIRST_TIP],
    ['cache reads of input tokens', pc(w.cache_read_share), col('cache_read_share'), ''],
    ['escaped defects', effNum(w.escaped_defects) ? `${w.escaped_defects} (target 0)` : '–', col('escaped_defects'), ''],
    ['merged points', effNum(w.points) ? String(w.points) : '–', col('points'), ''],
  ];
  const tip = (t: Loose) => (t ? ` title="${esc(t)}"` : '');
  // the charts' data in their attributes, so new data is a new card (renderEfficiency compares the html)
  const sig = esc(JSON.stringify(weeks.map((x: Loose) => [x.score, x.usd_by_phase])));
  return `<div class="score"><b>${sc(e.score?.this_week)}</b><span class="dim">last week ${sc(e.score?.last_week)}</span></div>
    <p class="score-w">spend, time and rework against the best of the last 12 weeks, with quality held</p>
    <div class="eff-parts">${parts.map(([k, v, s, t]: Loose) => `<div class="stat"${tip(t)}><span class="k">${k}</span><b>${v}</b><span class="dim">${esc(s)}</span></div>`).join('')}</div>
    <div class="score-mod"><h4 class="props-h">The score, 12 weeks</h4><div class="fit" data-fit="eff-score" data-v="${sig}"></div></div>
    <div class="score-mod score-counts">${counts.map(([k, v, s, t]: Loose) => `<div class="stat mini"${tip(t)}><span class="k">${esc(k)}</span><b>${esc(v)}</b>${spark(s, k)}</div>`).join('')}</div>
    <div class="score-mod"><h4 class="props-h">Spend by phase, each week</h4><div class="fit" data-fit="eff-phase" data-v="${sig}"></div></div>`;
}
// Waste: the open spend findings, each in plain words; one with an observation opens its peek (a click
// or Enter), one whose observation isn't logged yet (id null) is plain text
export const EFF_WASTE_WORDS = { 'cost-hotspot': 'cost hotspot', 'costly-ticket': 'costly ticket', 'low-cache-hit': 'low cache hits', 'cost-per-point-rising': 'cost per point rising', 'unpriced-model': 'unpriced model' };
export function effWaste(ws: Loose) {
  if (!ws.length) return effNone();
  return `<div class="rows">${ws.map((w: Loose) => {
    const k = Object.hasOwn(EFF_WASTE_WORDS, String(w.kind)) ? (EFF_WASTE_WORDS as Loose)[w.kind] : words(w.kind);
    const open = typeof w.id === 'string' && w.id ? ` data-open="observation/${esc(w.id)}" tabindex="0" role="link"${subj('observation', w.id, w.detail)}` : '';
    return `<div class="rowline"${open}><span class="dot amber"></span><span class="t" title="${esc(w.detail)}">${linkify(w.detail)}</span><span class="r">${esc(k)}</span></div>`;
  }).join('')}</div>`;
}
// Suggestions (ported from the mock; kit-99 reuses it for Trust): numbered, no buttons; each item is
// data-sugg="<id>" and its data-title is the title a thread on it starts with. A click or Enter starts
// a thread on its page subject, or opens the open one (effSuggGo, below). An item given a ref (Trust's)
// also carries it as data-subject, its item subject.
export function suggestionsList(xs: Loose) {
  if (!xs.length) return effNone('None this week');
  return `<ol class="sugg">${xs.map((x: Loose, i: Loose) => `<li class="sugg-i" data-sugg="${esc(x.id)}"${typeof x.ref === 'string' ? ` data-subject="${esc(x.ref)}"` : ''} data-title="${esc(tLine(`${x.title} · ${x.what}`, threadsCoreState.T_TITLE_MAX))}" tabindex="0" role="link" title="Start a thread about this suggestion"><span class="sugg-n">${i + 1}</span><div class="sugg-b"><span class="sugg-go">${esc(x.title)}</span><div class="sugg-w">${esc(x.what)}</div><div class="sugg-m">${esc(x.evidence)}</div><div class="sugg-e">Estimated effect: ${esc(x.effect)}</div></div></li>`).join('')}</ol>`;
}
export const EFF_SUGG_WORDS = { 'review-depth': 'Fit review depth to the ticket', 'smaller-model': 'Use a smaller model where it fits', cache: 'Keep the prompt cache', 'costly-ticket': 'Find where a costly ticket\'s spend went', 'tighter-specs': 'Write tighter specs' };
export function effSuggestions(xs: Loose) {
  return suggestionsList(xs.map((x: Loose) => ({ id: String(x.id), title: Object.hasOwn(EFF_SUGG_WORDS, String(x.kind)) ? (EFF_SUGG_WORDS as Loose)[x.kind] : 'Suggestion', what: x.what ?? '', evidence: x.evidence ?? '', effect: x.effect ?? '' })));
}
// A suggestion's thread: on the page subject #<page>?suggestion=<id>, its page the section it is on
// (Efficiency, Awareness; tlStart opens the open one, as a Settings row's); placed by the item, from
// the click's point or, by Enter, the item's right edge
export function effSuggGo(it: Loose, x: Loose, y: Loose) {
  const view = suggView(it.dataset.sugg, it.closest('section[id]').id);
  const title = tLine(it.dataset.title, threadsCoreState.T_TITLE_MAX);
  tlStart({ subject: { kind: 'page', view, quote: tCut(title, 300) }, title, el: it, x, y });
}
