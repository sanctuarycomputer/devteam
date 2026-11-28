// kit-994: the Trust page (index.html's autonomy lines): the Trust Score card, the kinds of decision, how the levels
// moved, and a kind's peek.
import { EFF_COLORS, effNum, scoreLine, weekName } from '../../lib/autonomy-charts';
import { TRUST_LEVELS, TRUST_SPLIT, callHash, classEvidence, trustCorrected, trustLevel } from '../../lib/autonomy-trust';
import { attrRow, drawerFor, peekKey, psect, showDrawer } from '../peeks';
import { peeksState } from '../peeks/state';
import { esc, props } from '../shell';
import { $ } from '../shell/page';
import { shell } from '../shell/state';
import { tBytes, tSubjectAt } from '../threads-core';
import { threadsCoreState } from '../threads-core/state';
import { tlSection, tlStart } from '../threads-panel';
import { threadsPanelState } from '../threads-panel/state';
import { cap, cardHead, when, words } from '../words';
import { FIT_DRAW, FIT_SEEN, effNone, effSection, fitCharts, spark, suggestionsList } from './efficiency';
import { bindPageTables, pageTable } from './pages';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


// The Trust Score's suggestions (kit-99): titled by kind (an unknown kind reads Suggestion), each on its
// item subject suggestion:<id>, so a thread on one is pinned to it. Anything but an array is none.
export function trustSuggestions(xs: Loose) {
  const TITLES = { raise: 'Raise a trust level', question: 'Answer the oldest question holding work', sense: 'Connect a missing sense', strategy: 'Settle a strategy unknown', rule: 'Set a standing rule' };
  return suggestionsList((Array.isArray(xs) ? xs : []).map((x: Loose) => ({ id: String(x?.id ?? ''), title: Object.hasOwn(TITLES, String(x?.kind)) ? (TITLES as Loose)[x.kind] : 'Suggestion', what: x?.what ?? '', evidence: x?.evidence ?? '', effect: x?.effect ?? '', ref: `suggestion:${x?.id ?? ''}` })));
}
// A click or Enter on a Trust suggestion: the hit a Shift+click on it builds (tSubjectAt's item branch),
// started, or its open thread opened, by tlStart. A ref the log can't take (a bad character, over 120
// bytes) starts nothing.
export function trustSuggGo(it: Loose, x: Loose, y: Loose) {
  const ref = it?.dataset?.subject ?? '';
  if (!ref.startsWith('suggestion:') || !threadsCoreState.T_REF.test(ref) || tBytes(ref) > threadsCoreState.T_REF_MAX) return;
  const hit = tSubjectAt(it, x, y, tlSection);
  if (hit) tlStart({ ...(hit as Loose), x, y });
}
export const trustName = (t: Loose) => t?.class_name || cap(t?.about || '') || 'A kind of decision';
export const trustAgreed = (t: Loose) => (effNum(t.agreement) ? `${Math.round(t.agreement * 100)}% of the last ${(t.agreement_questions || []).length}` : '–');
export const TRUST_READY = '<span class="badge good" title="Enough answers went with its recommendation to ask you to raise it">ready to ask for more</span>';
// a kind's Now: its level in words, and the badge when it can ask for more (the table's cell, the peek's row)
export const trustNow = (t: Loose) => `${esc(trustLevel(t.rung))}${t.can_ask ? ` ${TRUST_READY}` : ''}`;
// Kinds of decision: a row a kind, opening its peek (class/<id>)
export function trustRows(trust: Loose) {
  return (trust || []).map((t: Loose) => ({
    cells: [esc(trustName(t)), trustNow(t), esc(trustLevel(t.ceiling)), esc(trustAgreed(t)), esc(trustCorrected(t))],
    sort: [trustName(t), t.rung ?? null, t.ceiling ?? null, effNum(t.agreement) ? t.agreement : null, t.corrections ?? 0],
    open: t.class ? `class/${encodeURIComponent(t.class)}` : null,
  }));
}
// How the levels moved: every move of every kind, capped at its ceiling, newest first, at most 40; a row opens
// the question that moved it (your answer) or the call you corrected
export function levelMoves(trust: Loose) {
  return (trust || []).flatMap((t: Loose) => (t.history || []).map((e: Loose) => ({ t, e, rung: effNum(t.ceiling) ? Math.min(e.rung, t.ceiling) : e.rung })))
    .sort((a: Loose, b: Loose) => String(b.e.at ?? '').localeCompare(String(a.e.at ?? ''))).slice(0, 40)
    .map(({ t, e, rung }: Loose) => {
      const why = e.by === 'correction' ? `your correction${e.why ? `: ${e.why}` : ''}` : e.by === 'answer' ? 'your answer' : words(e.by);
      return {
        cells: [esc(trustName(t)), esc(trustLevel(rung)), esc(why), e.at ? esc(when(e.at)) : ''],
        sort: [trustName(t), rung ?? null, why, e.at ?? null],
        open: e.by === 'answer' ? (e.id ? `q/${encodeURIComponent(e.id)}` : null) : callHash(e.id),
      };
    });
}
// The Trust Score card's charts, drawn at the width they get: the score line and a bar a week split three ways
export let TRUST_WEEKS = [];
export function trustSplitBars(weeks: Loose, W: Loose = 560) {
  const n = weeks.length, val = (w: Loose, k: Loose) => (effNum(w?.[k]) && w[k] > 0 ? w[k] : 0);
  const tot = (w: Loose) => TRUST_SPLIT.reduce((s: Loose, [k]: Loose) => s + val(w, k), 0);
  const max = Math.max(0, ...weeks.map(tot));
  if (!n || !max) return effNone();
  const H = 96, slot = W / n, bw = Math.max(1, slot - 6);
  return `<svg class="split" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Decisions each week: decided alone, asked you, corrected">${weeks.map((w: Loose, i: Loose) => {
    let y = H - 14;
    return TRUST_SPLIT.map(([k, l]: Loose, j: Loose) => { const v = val(w, k); if (!v) return ''; const h = ((H - 24) * v) / max; y -= h;
      return `<rect data-i="${i}" x="${(i * slot).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" style="fill:${EFF_COLORS[j]}"><title>${esc(`${weekName(i, n)}: ${l} ${v} of ${tot(w)}`)}</title></rect>`; }).join('');
  }).join('')}<text x="0" y="${H - 2}" class="lc-t">12 weeks ago</text><text x="${W - 6}" y="${H - 2}" text-anchor="end" class="lc-t">this week</text></svg>
    <div class="legend small">${TRUST_SPLIT.map(([k, l]: Loose, j: Loose) => `<span><i style="border-top-color:${EFF_COLORS[j]}"></i>${esc(l)} ${esc(val(weeks[n - 1], k))}</span>`).join('')}</div>`;
}
(FIT_DRAW as Loose)['trust-score'] = (el: Loose, W: Loose) => scoreLine(TRUST_WEEKS.map((w: Loose) => (effNum(w.score) ? w.score : null)), W, { min: 0, max: 100 });
(FIT_DRAW as Loose)['trust-split'] = (el: Loose, W: Loose) => trustSplitBars(TRUST_WEEKS, W);
// Score: this and last week's score, the line, a sparkline a count, the split, the lessons and the week's record
export function trustScore(a: Loose) {
  const d = a.decisions || {}, weeks = Array.isArray(d.weeks) ? d.weeks : [], w = d.this_week || weeks[weeks.length - 1] || {};
  TRUST_WEEKS = weeks;
  const sc = (x: Loose) => (effNum(x) ? `${x}%` : '–'), num = (x: Loose) => (effNum(x) ? String(+x.toFixed(2)) : '–');
  const col = (f: Loose) => weeks.map((x: Loose) => { const y = f(x); return effNum(y) ? y : null; });
  const rec = w.with_recommendation || {};
  const counts = [
    ['decided alone', num(w.alone), col((x: Loose) => x.alone)],
    ['asked you', num(w.asked), col((x: Loose) => x.asked)],
    ['corrected', num(w.corrected), col((x: Loose) => x.corrected)],
    ['changes merged per question answered', num(w.merged_per_answer), col((x: Loose) => x.merged_per_answer)],
    ['questions asked again', effNum(w.asked_again) ? `${w.asked_again} (target 0)` : '–', col((x: Loose) => x.asked_again)],
    ['hours waiting on you', num(w.hours_waiting), col((x: Loose) => x.hours_waiting)],
    ['answers that went with the recommendation', effNum(rec.count) && effNum(rec.of) ? `${rec.count} of ${rec.of}${effNum(rec.share) ? ` · ${Math.round(rec.share * 100)}%` : ''}` : '–', col((x: Loose) => x.with_recommendation?.share)],
  ];
  const links = ['<a class="linkish" href="#loop?lt=orient&kind=lesson">the lessons it counted</a>', w.record ? `<a class="linkish" href="#learning/${esc(encodeURIComponent(w.record))}">this week's learning record</a>` : ''].filter(Boolean);
  // the charts' data in their attributes, so new data is a new card (renderTrust compares the html)
  const sig = esc(JSON.stringify(weeks.map((x: Loose) => [x.score, x.alone, x.asked, x.corrected])));
  return `<div class="score"><b>${sc(d.score?.this_week)}</b><span class="dim">last week ${sc(d.score?.last_week)}</span></div>
    <p class="score-w">decisions made without asking that you didn't correct · ${links.join(' · ')}</p>
    <div class="score-mod"><h4 class="props-h">The score, 12 weeks</h4><div class="fit" data-fit="trust-score" data-v="${sig}"></div></div>
    <div class="score-mod score-counts">${counts.map(([k, v, s]: Loose) => `<div class="stat mini"><span class="k">${esc(k)}</span><b>${esc(v)}</b>${spark(s, k)}</div>`).join('')}</div>
    <div class="score-mod"><h4 class="props-h">Each week</h4><div class="fit" data-fit="trust-split" data-v="${sig}"></div></div>`;
}
export const trustStat = (v: Loose, k: Loose) => `<div class="stat"><b>${esc(v)}</b><span class="dim">${esc(k)}</span></div>`;
export const trustCount = (x: Loose) => (effNum(x) ? String(x) : '–');
export function trustScoreCard(a: Loose) {
  const tr = a?.trust || {}, se = a?.senses || {}, missing = Array.isArray(se.missing) ? se.missing : [];
  const trust = `<div class="eff-parts">${trustStat(`${trustCount(tr.own)} of ${trustCount(tr.kinds)}`, 'kinds of decision decided on their own')}${trustStat(`${trustCount(tr.raised)} raised, ${trustCount(tr.dropped)} dropped`, 'this week')}</div>`;
  const senses = `<div class="eff-parts">${[['needed', se.needed], ['has', se.has], ['working', se.working]].map(([k, v]: Loose) => `<div class="stat"><span class="k">${k}</span><b>${esc(trustCount(v))}</b></div>`).join('')}</div>
    <p class="score-w trust-missing">${missing.length ? `Missing: ${esc(missing.join(', '))}` : 'None missing'}</p>`;
  return `<div class="card eff-card trust-card">${cardHead('shield-check', 'Trust Score', { extra: '<span class="muted">this week</span>' })}${
    effSection('Score', a ? trustScore(a) : effNone())}${effSection('Trust', a ? trust : effNone())}${effSection('Senses', a ? senses : effNone())}${effSection('Suggestions', a ? trustSuggestions(a.suggestions) : effNone())}</div>`;
}
// The page, written into #trust only when its HTML changed, so a redraw keeps focus and a pin's element
export function renderTrust(d: Loose) {
  const trust = d.ooda?.trust || [];
  const html = `${trustScoreCard(d.autonomy || null)}<div class="card flush">${cardHead('shield-check', 'Kinds of decision')}${
    pageTable('trust:kinds', ['Kind of decision', 'Now', 'At most', 'Agreed with you', 'Corrected'], trustRows(trust))}</div><div class="card flush">${cardHead('history', 'How the levels moved')}${
    pageTable('trust:moves', ['Kind of decision', 'To', 'Why', 'When'], levelMoves(trust))}</div>`;
  const el = $('trust');
  // a suggestion's click or Enter (kit-99), bound once on #trust, as effSuggGo's are on the document
  if (el && !(el as Loose).__sugg) {
    (el as Loose).__sugg = true;
    el.addEventListener('click', (e: Loose) => {
      const it = e.target.closest?.('[data-sugg]');
      if (!it || e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || threadsPanelState.TL.pin) return;
      if (String(window.getSelection?.() ?? '')) return;
      e.preventDefault();
      trustSuggGo(it, e.clientX, e.clientY);
    });
    el.addEventListener('keydown', (e: Loose) => {
      const t = e.target;
      if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || threadsPanelState.TL.pin || !t?.matches?.('[data-sugg]')) return;
      e.preventDefault();
      const r = t.getBoundingClientRect();
      trustSuggGo(t, r.right, r.top + 10);
    });
  }
  if (!el || (el as Loose).__html === html) return;
  (el as Loose).__html = html;
  for (const f of el.querySelectorAll('.fit[data-fit]')) FIT_SEEN?.unobserve(f);
  el.innerHTML = html;
  bindPageTables(el, () => renderTrust(shell.DATA));
  fitCharts();
}
// A kind's peek (#class/<id>, home Trust): read-only, from DATA.ooda.trust (the server has no class peek, so it
// is marked missing, as a Library item's is). Its properties (no ID row: the class id never shows), its three
// levels with the one it is on marked, and the evidence since it last moved, each row opening its record.
export function openClass(id: Loose) {
  drawerFor('class', id);
  peeksState.PEEKS.set(peekKey('class', id), { error: 'not a record', missing: true });
  const t = ((shell.DATA as Loose)?.ooda?.trust || []).find((x: Loose) => x.class === id);
  // not notFound, which titles the peek with the id and gives it an ID row: the class id never shows (R2)
  if (!t) return showDrawer('<h2 id="drawer-title">Not found</h2><p class="muted">No kind of decision by that name.</p>');
  const last = (t.history || []).reduce((m: Loose, e: Loose) => (e.at && (!m || e.at > m.at) ? e : m), null);
  const rows = [
    attrRow('Now', trustNow(t)),
    attrRow('At most', esc(trustLevel(t.ceiling))),
    attrRow('Since', last ? esc(when(last.at)) : 'never moved'),
    attrRow('Agreed with you', esc(trustAgreed(t))),
    attrRow('Corrected', esc(trustCorrected(t)), 'How many times you corrected one of its calls.'),
    attrRow('How it changes', 'Shift+click it and say so in a thread'),
  ].filter(Boolean);
  const levels = [1, 2, 3].map((r: Loose) => `<div class="lvl${r === t.rung ? ' now' : ''}${r > t.ceiling ? ' off' : ''}"><span class="t">${esc((TRUST_LEVELS as Loose)[r])}</span>${
    r === t.rung ? '<span class="badge low">now</span>' : r > t.ceiling ? '<span class="muted">beyond its limit</span>' : ''}</div>`).join('');
  const ev = classEvidence(t, (shell.DATA as Loose)?.ooda);
  const evHtml = ev.length ? `<div class="rows cls-ev">${ev.map((x: Loose) => `<div class="rowline"${x.open ? ` data-open="${esc(x.open)}" tabindex="0" role="link"` : ''}><span class="dot${x.kind === 'Agreed' ? ' green' : x.kind === 'Not agreed' ? ' amber' : x.kind === 'Call' ? ' blue' : ''}"></span><span class="t">${esc(x.what)}</span><span class="r">${
    esc([x.kind === 'Call' ? '' : x.kind, x.at ? when(x.at) : ''].filter(Boolean).join(' · '))}</span></div>`).join('')}</div>` : effNone();
  showDrawer(`<h2 id="drawer-title">${esc(trustName(t))}</h2><section class="attrs">${props(rows)}</section>${psect('Levels', `<div class="lvls">${levels}</div>`)}${psect('Since it last moved', evHtml)}`);
}
