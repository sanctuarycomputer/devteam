// kit-994: the Awareness page (index.html's autonomy lines): the Awareness Score card and its suggestions.
import { effNum, scoreLine } from '../../lib/autonomy-charts';
import { esc } from '../shell';
import { $ } from '../shell/page';
import { parseSuggView } from '../threads-core';
import { threadsCoreState } from '../threads-core/state';
import { cardHead } from '../words';
import { FIT_DRAW, FIT_SEEN, effNone, effSection, fitCharts, spark, suggestionsList } from './efficiency';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


// ---- Awareness (kit-93): the Awareness Score card, drawn as Efficiency's, with its charts and suggestion list ----
// A suggestion's page: the section its view names (efficiency, awareness), else null
export function suggPageOf(view: Loose) {
  const m = threadsCoreState.T_SUGG_VIEW.exec(typeof view === 'string' ? view : '');
  return m && parseSuggView(view) !== null ? m[1] : null;
}
// The four parts in plain words, and a suggestion's title by its kind
export const AW_PARTS = [['signals', 'signals explained within a day'], ['incidents', 'fixed incidents that left a lesson'], ['lessons', 'lessons sessions use'], ['starts', 'fresh starts given what they need']];
export const AW_SUGG_WORDS = { incident: 'Learn from a fixed incident', lessons: 'Retire lessons nobody is given', signal: 'Explain something that keeps happening' };
// The score line, drawn at the width it gets
export let AW_WEEKS = [];
(FIT_DRAW as Loose)['aw-score'] = (el: Loose, W: Loose) => scoreLine(AW_WEEKS.map((w: Loose) => (effNum(w.score) ? w.score : null)), W, { min: 0, max: 100 });
// Score: this and last week's score, this week's four parts ("c of o · share", "none" with no share),
// the 12-week line (a null week a gap) and a sparkline a part over its weekly share
export function awarenessScore(a: Loose) {
  const weeks = Array.isArray(a.weeks) ? a.weeks : [];
  AW_WEEKS = weeks;
  const sc = (x: Loose) => (effNum(x) ? `${x}%` : '–'), pc = (s: Loose) => (effNum(s) ? `${Math.round(100 * s)}%` : 'none');
  const part = (x: Loose) => (effNum(x?.share) ? `${x.count} of ${x.of} · ${pc(x.share)}` : 'none');
  const share = (k: Loose) => weeks.map((w: Loose) => (effNum(w?.parts?.[k]?.share) ? w.parts[k].share : null));
  // the chart's data in its attribute, so new data is a new card (renderAwareness compares the html)
  const sig = esc(JSON.stringify(weeks.map((w: Loose) => [w?.score ?? null, ...AW_PARTS.map(([k]: Loose) => w?.parts?.[k]?.share ?? null)])));
  return `<div class="score"><b>${sc(a.score?.this_week)}</b><span class="dim">last week ${sc(a.score?.last_week)}</span></div>
    <p class="score-w">how well the fleet understands what happens: the mean of the four parts below</p>
    <div class="eff-parts aw-parts">${AW_PARTS.map(([k, l]: Loose) => `<div class="stat"><span class="k">${esc(l)}</span><b>${esc(part(a.parts?.[k]))}</b></div>`).join('')}</div>
    <div class="score-mod"><h4 class="props-h">The score, 12 weeks</h4><div class="fit" data-fit="aw-score" data-v="${sig}"></div></div>
    <div class="score-mod score-counts">${AW_PARTS.map(([k, l]: Loose) => `<div class="stat mini"><span class="k">${esc(l)}</span><b>${esc(pc(a.parts?.[k]?.share))}</b>${spark(share(k), l)}</div>`).join('')}</div>`;
}
// Suggestions: Efficiency's list, each titled by its kind; a click or Enter starts or opens its thread (effSuggGo)
export const awSuggestions = (xs: Loose) => suggestionsList(xs.map((x: Loose) => ({ id: String(x.id), title: Object.hasOwn(AW_SUGG_WORDS, String(x.kind)) ? (AW_SUGG_WORDS as Loose)[x.kind] : 'Suggestion', what: x.what ?? '', evidence: x.evidence ?? '', effect: x.effect ?? '' })));
export function awarenessCard(a: Loose) {
  return `<div class="card eff-card aw-card">${cardHead('eye', 'Awareness Score', { extra: '<span class="muted">this week</span>' })}${
    effSection('Score', a ? awarenessScore(a) : effNone())}${
    effSection('Suggestions', a ? awSuggestions(Array.isArray(a.suggestions) ? a.suggestions : []) : effNone())}</div>`;
}
// The page, written into #awareness only when its HTML changed, so a redraw keeps focus and a pin's element
export function renderAwareness(d: Loose) {
  const html = awarenessCard(d.awareness || null);
  const el = $('awareness');
  if (!el || (el as Loose).__html === html) return;
  (el as Loose).__html = html;
  for (const f of el.querySelectorAll('.fit[data-fit]')) FIT_SEEN?.unobserve(f);
  el.innerHTML = html;
  fitCharts();
}
