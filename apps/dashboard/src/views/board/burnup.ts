// kit-993: Progress's burn-up chart (index.html's board lines), verbatim: the board-progress test compares
// burnup's text with kit main's, byte for byte (ruling m-20261127-231855624), so its body is index.html's own.
// @ts-nocheck -- doctrine-exception(tsc-strict): burnup is index.html's text, byte for byte (the board-progress test reads it; m-20261127-231855624)
import { DAY } from '../../lib/shell-page';
import { empty, fmtDate, isDone } from '../shell';
import { $ } from '../shell/page';
import { forecast } from './progress';

// ---- burn-up chart (hand-built SVG) ----
// ui: where to draw (the Progress section's chart by default, or a sidepeek's).
export const PROGRESS_CHART = () => ({ el: $('burnup'), legend: $('legend'), tip: $('tip'), card: $('burnup-card'), forecast: $('forecast') });
export function burnup(items, now, ui = PROGRESS_CHART()) {
  const el = ui.el;
  const setForecast = (s) => { if (ui.forecast) ui.forecast.textContent = s; };
  ui.legend.hidden = !items.some(isDone);
  if (!items.length) { el.innerHTML = empty('None'); setForecast(''); return; }
  const scopePts = items.reduce((a, t) => a + t.weight, 0);
  if (!items.some(isDone)) {
    el.innerHTML = empty('None');
    setForecast(`0/${scopePts} pts`);
    return;
  }
  const evs = [];
  for (const t of items) {
    evs.push([Date.parse(t.added_at), t.weight, 0]);
    if (t.merged_at) evs.push([Date.parse(t.merged_at), 0, t.weight]);
  }
  evs.sort((a, b) => a[0] - b[0]);
  const pts = [];
  let s = 0, d = 0;
  for (const [ts, ds, dd] of evs) { s += ds; d += dd; pts.push([ts, s, d]); }
  pts.push([now, s, d]);
  const fc = forecast(items, now);
  const t0 = pts[0][0];
  const end = Math.min(Math.max(now + DAY, fc.finished ? now : (fc.worst || fc.eta || now)), now + 365 * DAY);
  const t1 = end + (end - t0) * 0.04;
  const W = Math.round(Math.max(300, el.clientWidth || 640)), H = W < 500 ? 220 : 280, L = 34, R = 12, T = 12, B = 26;
  const yMax = Math.max(1, s) * 1.1;
  const x = (ts) => L + ((ts - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (v) => H - B - (v / yMax) * (H - T - B);
  const step = (idx) => pts.map((p, i) => `${i ? `H${x(p[0]).toFixed(1)}V` : `M${x(p[0]).toFixed(1)},`}${y(p[idx]).toFixed(1)}`).join('');
  // whole-number y steps (1, 2, 5, 10, …) and x labels that never repeat a date
  const yStep = [1, 2, 5, 10, 20, 50, 100, 200, 500].find((st) => yMax / st <= 5) ?? Math.ceil(yMax / 5);
  const yTicks = []; for (let v = 0; v <= yMax; v += yStep) yTicks.push(v);
  const short = t1 - t0 < 2 * DAY;
  const xFmt = (ts) => (short ? new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : fmtDate(ts));
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => t0 + f * (t1 - t0)).filter((ts, i, a) => i === 0 || xFmt(ts) !== xFmt(a[i - 1]));
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Burn-up chart: ${fc.done} of ${fc.scope} points done">`;
  for (const v of [...new Set(yTicks)]) svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${v}</text>`;
  for (const [i, ts] of xTicks.entries()) svg += `<text x="${x(ts)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}" font-size="10" fill="var(--muted)">${xFmt(ts)}</text>`;
  // done area + line, scope line
  svg += `<path d="${step(2)}V${y(0)}H${x(pts[0][0])}Z" fill="var(--series-1)" opacity=".12"/>`;
  svg += `<path d="${step(1)}" fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="5 4"/>`;
  svg += `<path d="${step(2)}" fill="none" stroke="var(--series-1)" stroke-width="2"/>`;
  // forecast: line to the expected date, band between best and worst
  if (fc.eta && !fc.finished) {
    svg += `<polygon points="${x(now)},${y(fc.done)} ${x(fc.best)},${y(fc.scope)} ${x(fc.worst)},${y(fc.scope)}" fill="var(--series-1)" opacity=".08"/>`;
    svg += `<line x1="${x(now)}" y1="${y(fc.done)}" x2="${x(fc.eta)}" y2="${y(fc.scope)}" stroke="var(--series-1)" stroke-width="2" stroke-dasharray="2 4"/>`;
    svg += `<circle cx="${x(fc.eta)}" cy="${y(fc.scope)}" r="4" fill="var(--series-1)" stroke="var(--surface)" stroke-width="2"/>`;
    svg += `<text x="${Math.min(x(fc.eta), W - R - 4)}" y="${y(fc.scope) - 8}" text-anchor="end" font-size="11" fill="var(--fg)">${fmtDate(fc.eta)}</text>`;
  }
  svg += `<line x1="${x(now)}" x2="${x(now)}" y1="${T}" y2="${H - B}" stroke="var(--muted)" stroke-width="1"/>${fc.eta && !fc.finished && x(fc.eta) - x(now) < 70 ? '' : `<text x="${x(now) + 4}" y="${T + 10}" font-size="10" fill="var(--muted)">today</text>`}`;
  svg += `<line class="xh" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--fg)" stroke-width="1" opacity="0"/>`;
  svg += `<rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/></svg>`;
  el.innerHTML = svg;
  const svgEl = el.querySelector('svg'), hit = el.querySelector('.hit'), xh = el.querySelector('.xh'), tip = ui.tip;
  hit.addEventListener('mousemove', (e) => {
    const r = svgEl.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    const ts = t0 + ((vx - L) / (W - L - R)) * (t1 - t0);
    let p = pts[0];
    for (const q of pts) if (q[0] <= ts) p = q;
    xh.setAttribute('x1', vx); xh.setAttribute('x2', vx); xh.setAttribute('opacity', '.3');
    tip.style.display = 'block';
    tip.innerHTML = ts > now ? `${fmtDate(ts)}<br><span class="muted">forecast</span>` : `<b>${fmtDate(ts)}</b><br>done ${p[2]} · scope ${p[1]}`;
    const box = ui.card.getBoundingClientRect();
    tip.style.left = `${Math.min(e.clientX - box.left + 12, box.width - 140)}px`;
    tip.style.top = `${e.clientY - box.top - 10}px`;
  });
  hit.addEventListener('mouseleave', () => { tip.style.display = 'none'; xh.setAttribute('opacity', '0'); });
  const range = fc.best && fc.worst && fc.worst - fc.best > DAY ? ` (range ${fmtDate(fc.best)} – ${fmtDate(fc.worst)})` : '';
  setForecast(fc.finished ? `done: ${fc.done} of ${fc.scope} points` : fc.eta
    ? `${fc.done}/${fc.scope} pts · ETA ${fmtDate(fc.eta)}${range} · ${fc.perDay.toFixed(1)} pts/day`
    : `${fc.done}/${fc.scope} pts · ETA –`);
}
