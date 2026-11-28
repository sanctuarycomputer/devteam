// kit-997: the pieces peeks draw with (index.html's peeks lines 5597-5625 and 5723-5785): the diagram, the dependency
// graph, the design and review lists, progress, the phase strip, the gate table and spend.
import { boardCols, burnup, columnOf, forecast, meterRow } from '../board';
import { boardState } from '../board/state';
import { lineChart } from '../loop';
import { renderMermaid } from '../peek-kinds';
import { empty, esc, fmtDate, isDone } from '../shell';
import { $ } from '../shell/page';
import { shell } from '../shell/state';
import { fileHref, ticketMap, words } from '../words';
import { showDrawer } from './drawer';
import { historySection } from './history';
import { attrs, psect } from './props';
import { peeksState } from './state';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;
// marked and DOMPurify are the page's globals, as index.html's (index.html:23-24 loads them from jsdelivr). The app bundles them
// (marked 12.0.2, dompurify 3.4.18: APPS.md, Third-party code) and client.tsx puts them on the page; designBlock reads them only
// when window has them, as index.html does.
declare const marked: Loose, DOMPurify: Loose;


// ---- pieces the bodies share ----
// A Mermaid diagram, drawn once the drawer is on screen.
export function diagram(code: Loose) {
  const id = `dg-${peeksState.AFTER.length}`;
  peeksState.AFTER.push(() => renderMermaid(document.getElementById(id)));
  return `<div class="diagram-wrap" id="${id}"><pre><code class="language-mermaid">${esc(code)}</code></pre></div>`;
}
export const mmLabel = (s: Loose) => String(s ?? '').replace(/["<>`#;{}[\]()|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48) || '?';
// Tickets and what waits on what, optionally in columns (waves); the focus ticket outlined.
export function depGraph(ts: Loose, { focus = null, groups = null }: Loose = {}) {
  if (!ts.length) return '';
  const n = new Map(ts.map((t: Loose, i: Loose) => [t.id, `n${i}`]));
  const node = (t: Loose) => `${n.get(t.id)}["${mmLabel(t.title)}"]${peeksState.DONE_STAGES.includes(t.stage) ? ':::done' : t.phase === 'blocked' ? ':::blocked' : ''}`;
  const lines = ['flowchart LR', 'classDef done opacity:0.55', 'classDef blocked stroke:#d33,stroke-width:2px', 'classDef focus stroke-width:3px'];
  if (groups) for (const [label, members] of groups) lines.push(`subgraph g${mmLabel(label).replace(/\W/g, '')}["${mmLabel(label)}"]`, ...members.map(node), 'end');
  else lines.push(...ts.map(node));
  for (const t of ts) for (const d of t.depends_on || []) if (n.has(d)) lines.push(`${n.get(d)} --> ${n.get(t.id)}`);
  if (focus && n.has(focus)) lines.push(`class ${n.get(focus)} focus`);
  return diagram(lines.join('\n'));
}
// The opening of a design: its TL;DR, rendered, and a link to the whole document.
export function designBlock(d: Loose, label: Loose = 'Design') {
  if (!d) return '';
  const href = fileHref({ title: label, path: d.path, ...(d.ref ? { ref: d.ref } : {}) });
  const md = d.tldr && (window as Loose).marked && (window as Loose).DOMPurify ? DOMPurify.sanitize(marked.parse(d.tldr, { gfm: true }), { FORBID_TAGS: ['style', 'form', 'input'], FORBID_ATTR: ['style'] }) : d.tldr ? `<pre>${esc(d.tldr)}</pre>` : empty('None');
  return psect(`${label}: the TL;DR`, `<div class="md tldr">${md}</div><p class="small"><a class="linkish" href="${esc(href)}">Read the whole design</a></p>`);
}
export const reviewList = (rs: Loose) => (rs?.length ? `<ul>${rs.map((r: Loose) => `<li>${esc(words(r.stage))} review, pass ${esc(r.pass)}: <b>${r.verdict === 'APPROVE' ? 'approved' : r.verdict === 'CHANGES' ? 'changes asked' : esc(r.verdict || 'not done')}</b>${r.reviewer ? ` by ${esc(r.reviewer)}` : ''}</li>`).join('')}</ul>` : '');
// A set's progress: its meter and forecast, its burn-up, then its tickets as the board.
// ui-candidate: meter, chart (apps-src@2: src/shared/ui/ has no component yet, so the port keeps index.html's markup)
export function progressBlock(items: Loose) {
  const now = Date.parse((shell.DATA as Loose).progress.now);
  const fc = forecast(items, now);
  const live = items.filter((t: Loose) => t.stage !== 'superseded');
  const left = live.filter((t: Loose) => !isDone(t));
  const eta = fc.finished ? 'all merged' : fc.eta ? `ETA ${fmtDate(fc.eta)} at the recent ${fc.perDay!.toFixed(1)} points a day` : fc.scope ? 'no forecast yet (nothing merged recently)' : 'no tickets yet';
  const usd = live.reduce((a: Loose, t: Loose) => a + (ticketMap().get(t.id)?.usd || 0), 0);
  if (live.length) peeksState.AFTER.push(() => { if ($('peek-burnup')) burnup(items, now, { el: $('peek-burnup'), legend: $('peek-legend'), tip: $('peek-tip'), card: $('peek-card'), forecast: null }); });
  // no-shell: the page's markup (ticket cards, their pills), fenced from the block's rules in a peek
  return `<div class="no-shell">${meterRow(`${fc.done} of ${fc.scope} points done`, fc.done, fc.scope)}
    <p class="small muted">${esc(eta)} · ${left.length} of ${live.length} ticket${live.length === 1 ? '' : 's'} left${usd ? ` · $${usd.toFixed(2)} spent` : ''}</p>
    ${live.length ? `<div class="card chart peek-chart" id="peek-card"><div class="legend" id="peek-legend"><span><i class="done"></i>done</span><span><i class="scope"></i>scope</span><span><i class="fc"></i>forecast</span><span class="dim">points: S = 1, M = 2</span></div><div id="peek-burnup"></div><div class="tip" id="peek-tip"></div></div>` : ''}
    <h3>Tickets</h3>${live.length ? `<div class="board board-peek" style="--cols:${new Set(live.map(columnOf)).size}">${boardCols(live, new Set((shell.DATA as Loose).critical_path), { only: true })}</div>` : empty('None')}</div>`;
}
export const uniq = (xs: Loose) => [...new Set(xs.filter((x: Loose) => x !== undefined && x !== null && x !== ''))];
export const notFound = (kind: Loose, id: Loose, peek: Loose, text: Loose, { noRecord = false, rec = null }: Loose = {}) => showDrawer(`<h2 id="drawer-title">${esc(id)}</h2>${attrs({ id, peek, type: kind, noRecord, rec })}${peek?.transient ? `<p class="err">Could not load it just now (${esc(peek.error)}); trying again.</p>` : text ? `<p class="muted">${text}</p>` : ''}${historySection(peek, id)}`);
// How long each phase took, as one bar: from each phase line to the next (or to the merge, or now).
// ui-candidate: phase-strip (apps-src@2: src/shared/ui/ has no component yet, so the port keeps index.html's markup)
export function phaseStrip(lines: Loose, endAt: Loose) {
  const ps = lines.filter((l: Loose) => l.type === 'phase' && l.to !== 'supervisor').sort((a: Loose, b: Loose) => a.at.localeCompare(b.at));
  if (!ps.length) return '';
  const end = endAt ? Date.parse(endAt) : Date.now();
  const spans = new Map();
  ps.forEach((l: Loose, i: Loose) => {
    const t0 = Date.parse(l.at), t1 = i + 1 < ps.length ? Date.parse(ps[i + 1].at) : Math.max(t0, end);
    if (l.to === 'done') return;
    spans.set(l.to, (spans.get(l.to) || 0) + Math.max(0, t1 - t0));
  });
  const total = [...spans.values()].reduce((a: Loose, b: Loose) => a + b, 0);
  if (!total) return '';
  const tone = (p: Loose) => (['blocked', 'parked'].includes(p) ? 'stop' : ['spec', 'plan', 'contract'].includes(p) ? 'think' : ['build', 'verify'].includes(p) ? 'make' : ['final-review', 'awaiting-word', 'merging'].includes(p) ? 'wait' : 'other');
  const hrs = (ms: Loose) => (ms < 3600e3 ? `${Math.round(ms / 60e3)}m` : `${(ms / 3600e3).toFixed(ms < 36000e3 ? 1 : 0)}h`);
  const segs = [...spans].map(([p, ms]: Loose) => ({ p, ms, w: (100 * ms) / total }));
  return psect(`Time per phase${endAt ? '' : ' so far'}`, `<div class="phase-strip" role="img" aria-label="${esc(segs.map((s: Loose) => `${(boardState.PHASE_SHORT as Loose)[s.p] || s.p} ${hrs(s.ms)}`).join(', '))}">${segs.map((s: Loose) => `<span class="ph ph-${tone(s.p)}" style="width:${s.w.toFixed(2)}%" title="${esc(`${(boardState.PHASE_SHORT as Loose)[s.p] || words(s.p)}: ${hrs(s.ms)}`)}"></span>`).join('')}</div>
    <div class="legend phase-legend">${segs.map((s: Loose) => `<span><i class="ph-${tone(s.p)}"></i>${esc((boardState.PHASE_SHORT as Loose)[s.p] || words(s.p))} ${esc(hrs(s.ms))}</span>`).join('')}</div>`);
}
// Every check at every commit it ran on: passed or failed, flaky where one commit saw both, slow
// where it took over twice the project's usual time for that check.
// ui-candidate: table (apps-src@2: src/shared/ui/ has no component yet, so the port keeps index.html's markup)
export function gateTable(lines: Loose) {
  const gs = lines.filter((l: Loose) => l.type === 'gate');
  if (!gs.length) return '';
  const names = uniq(gs.map((g: Loose) => g.gate));
  // a run on uncommitted changes (a TDD red, then green) doesn't name what ran: never flaky
  const shaOf = (g: Loose) => (g.dirty || !g.sha ? 'uncommitted' : g.sha);
  const shas = uniq(gs.slice().sort((a: Loose, b: Loose) => b.at.localeCompare(a.at)).map(shaOf));
  const median = Object.fromEntries(((shell.DATA as Loose).metrics?.gates?.gates || []).map((g: Loose) => [g.gate, g.median_seconds]));
  const cell = (sha: Loose, name: Loose) => {
    const runs = gs.filter((g: Loose) => shaOf(g) === sha && g.gate === name);
    if (!runs.length) return '<td class="muted">–</td>';
    const ok = sha !== 'uncommitted' && runs.some((r: Loose) => r.ok), bad = sha !== 'uncommitted' && runs.some((r: Loose) => !r.ok);
    const last = runs.sort((a: Loose, b: Loose) => a.at.localeCompare(b.at)).pop();
    const slow = median[name] && last.ms && last.ms / 1000 > 2 * median[name];
    return `<td title="${esc(`${name} at ${sha.slice(0, 12)}: ${last.ok ? 'passed' : 'failed'}${last.ms ? `, ${(last.ms / 1000).toFixed(1)}s` : ''}${runs.length > 1 ? `, ${runs.length} runs` : ''}`)}"><span class="gate-dot ${ok && bad ? 'flaky' : last.ok ? 'ok' : 'fail'}">${ok && bad ? '≈' : last.ok ? '✓' : '✗'}</span>${slow ? ' <span class="badge medium">slow</span>' : ''}${ok && bad ? ' <span class="badge high">flaky</span>' : ''}</td>`;
  };
  return psect('Gate runs', `<div class="scroll"><table class="gates-table"><tr><th>Commit</th>${names.map((n: Loose) => `<th>${esc(n)}</th>`).join('')}</tr>${shas.slice(0, 12).map((s: Loose) => `<tr><td><code>${esc(s.slice(0, 12))}</code></td>${names.map((n: Loose) => cell(s, n)).join('')}</tr>`).join('')}</table></div>`);
}
export function spendChart(spend: Loose) {
  if (!spend?.length) return '';
  const roles = uniq(spend.map((s: Loose) => s.role || 'agent'));
  const series = roles.map((r: Loose) => { let sum = 0; return { name: `${r} ($${spend.filter((s: Loose) => (s.role || 'agent') === r).reduce((a: Loose, s: Loose) => a + (s.usd || 0), 0).toFixed(2)})`, points: spend.filter((s: Loose) => (s.role || 'agent') === r).map((s: Loose) => [Date.parse(s.at), +(sum += s.usd || 0).toFixed(2)]) }; });
  return psect('Spend over time', `${lineChart(series, { unit: '', height: 140 })}`);
}
