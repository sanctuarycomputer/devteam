// kit-993: the Progress page (index.html's board lines): its views and scope, the forecast, the widgets and renderProgress.
import { progressShown } from '../../lib/board-filter';
import { DAY } from '../../lib/shell-page';
import { peekFor } from '../peeks';
import { empty, esc, isDone, pct } from '../shell';
import { $ } from '../shell/page';
import { shell } from '../shell/state';
import { featureTitle, flink, goalOf, milestonesOf, rlink, slink, wlink } from '../words';
import { burnup } from './burnup';
import { filterGoals, filtersNow } from './filters';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


// ---- views: overall, a goal, a milestone, a feature, a release, a wave, a story ----
// Each is [value, label, group]; Progress's Narrow offers them (narrowViews), its goal held by the Goal filter.
export function views(p: Loose) {
  const v = [['all', 'Everything', '']];
  for (const g of ((shell.DATA as Loose).ooda.goals || []).filter((x: Loose) => !['abandoned'].includes(x.status))) {
    v.push([`goal:${g.id}`, g.title, 'Goals']);
    for (const m of (milestonesOf(g) as Loose)) v.push([`milestone:${g.id}:${m.n}`, `${g.title} · ${m.n}. ${m.title}`, 'Milestones']);
  }
  for (const f of p.features) v.push([`feature:${f}`, featureTitle(f), 'Features']);
  const rels = [...new Set(p.tickets.map((t: Loose) => t.target_release).filter(Boolean))].sort();
  for (const r of rels) v.push([`release:${r}`, (r as Loose), 'Releases']);
  const waves = [...new Set(p.tickets.map((t: Loose) => t.wave).filter(Boolean))].sort((a: Loose, b: Loose) => a - b);
  for (const w of waves) v.push([`wave:${w}`, `Wave ${w}`, 'Waves']);
  for (const [s, st] of Object.entries(p.stories)) v.push([`story:${s}`, `${s} ${String((st as Loose).text ?? '').slice(0, 60)}`, 'Stories']);
  return v;
}
export function goalFeatures(gid: Loose) {
  const R = (shell.DATA as Loose).ooda.roadmap;
  return new Set([...(R.goals.find((x: Loose) => x.id === gid)?.features || []), ...Object.values(R.features).filter((f: Loose) => (f.goals || []).includes(gid)).map((f: Loose) => f.feature)]);
}
export const milestoneFeatures = (gid: Loose, n: Loose) => new Set((milestonesOf(goalOf(gid)) as Loose).find((m: Loose) => m.n === Number(n))?.features || []);
export function filterTickets(p: Loose, view: Loose) {
  const [kind, val] = view.split(/:(.*)/);
  if (kind === 'goal') { const fs = goalFeatures(val); return p.tickets.filter((t: Loose) => fs.has(t.feature)); }
  if (kind === 'milestone') { const i = val.lastIndexOf(':'); const fs = milestoneFeatures(val.slice(0, i), val.slice(i + 1)); return p.tickets.filter((t: Loose) => fs.has(t.feature)); }
  if (kind === 'feature') return p.tickets.filter((t: Loose) => t.feature === val);
  if (kind === 'release') return p.tickets.filter((t: Loose) => t.target_release === val);
  if (kind === 'wave') return p.tickets.filter((t: Loose) => String(t.wave) === val);
  if (kind === 'story') return p.tickets.filter((t: Loose) => t.serves.includes(val));
  return p.tickets;
}
// ---- forecast from recent throughput ----
export function forecast(items: Loose, now: Loose) {
  const scope = items.reduce((a: Loose, t: Loose) => a + t.weight, 0);
  const done = items.filter(isDone).reduce((a: Loose, t: Loose) => a + t.weight, 0);
  const remaining = scope - done;
  if (!scope) return { scope, done, remaining, eta: null };
  if (!remaining) return { scope, done, remaining, eta: Math.max(...items.map((t: Loose) => Date.parse(t.merged_at))), finished: true };
  const firstAdd = Math.min(...items.map((t: Loose) => Date.parse(t.added_at)));
  const windowDays = Math.max(1, Math.min(14, (now - firstAdd) / DAY));
  const recent = items.filter((t: Loose) => isDone(t) && now - Date.parse(t.merged_at) <= windowDays * DAY).reduce((a: Loose, t: Loose) => a + t.weight, 0);
  const perDay = recent / windowDays;
  // weekly rates over the last 4 weeks give a best/worst range
  const weeks = [0, 1, 2, 3].map((w: Loose) => items.filter((t: Loose) => isDone(t) && now - Date.parse(t.merged_at) >= w * 7 * DAY && now - Date.parse(t.merged_at) < (w + 1) * 7 * DAY).reduce((a: Loose, t: Loose) => a + t.weight, 0)).filter((x: Loose) => x > 0);
  if (!perDay) return { scope, done, remaining, eta: null };
  const eta = now + (remaining / perDay) * DAY;
  const best = weeks.length ? now + (remaining / (Math.max(...weeks) / 7)) * DAY : eta;
  const worst = weeks.length ? now + (remaining / (Math.min(...weeks) / 7)) * DAY : eta;
  return { scope, done, remaining, eta, best: Math.min(best, eta), worst: Math.max(worst, eta), perDay };
}
// ---- widgets ----
// open: the peek of the record the row stands for (peekFor's hash): a click or Enter on the row opens it
export function meterRow(label: Loose, done: Loose, total: Loose, note: Loose = '', open: Loose = null) {
  return `<div class="row"${open ? ` data-open="${esc(open.slice(1))}" tabindex="0" role="link"` : ''}><span>${label}</span><span class="muted">${note || `${done}/${total} · ${pct(done, total)}%`}</span><div class="meter"><span style="width:${pct(done, total)}%"></span></div></div>`;
}
// p: Progress's data scoped to the page's items (scopeProgress). show: Progress's Show, each row of Features,
// Stories, Releases and Waves kept by progressShown (done: every one of its tickets merged); an empty list says
// None. nameGoals (no goal picked): each wave row names its tickets' goals after it, dim. all: Progress's whole data:
// a release's tagged or ready to tag, and a story's done, are facts about the whole release or story, so they are
// read from it, never from the scope (a goal or a Narrow may hold only the part of a release that is done); a
// row's meter and Show read the scope.
export function widgets(p: Loose, now: Loose, show: Loose, { nameGoals = false, all = p }: Loose = {}) {
  const pts = (ts: Loose) => ts.reduce((a: Loose, t: Loose) => a + t.weight, 0);
  const none = empty('None');
  const allDone = (ts: Loose) => ts.length > 0 && ts.every(isDone);
  $('w-features')!.innerHTML = p.features.map((f: Loose) => { const ts = p.tickets.filter((t: Loose) => t.feature === f); return progressShown(allDone(ts), show) ? meterRow(flink(f), pts(ts.filter(isDone)), pts(ts), '', peekFor('feature', f)) : ''; }).join('') || none;
  const storyDone = (s: Loose) => allDone(p.tickets.filter((t: Loose) => t.serves.includes(s)));
  const storyDoneAll = (s: Loose) => allDone(all.tickets.filter((t: Loose) => t.serves.includes(s)));
  const rels = [...new Set([...Object.values(p.stories).map((s: Loose) => s.release), ...p.tickets.map((t: Loose) => t.target_release)].filter(Boolean))].sort();
  $('w-releases')!.innerHTML = rels.map((r: Loose) => {
    const stories = Object.entries(p.stories).filter(([, s]: Loose) => s.release === r).map(([id]: Loose) => id);
    const ts = p.tickets.filter((t: Loose) => t.target_release === r || stories.some((s: Loose) => t.serves.includes(s)));
    if (!progressShown(allDone(ts), show)) return '';
    const shipped = all.tickets.some((t: Loose) => t.released_in === r);
    const done = stories.filter(storyDone).length;
    const whole = Object.entries(all.stories).filter(([, s]: Loose) => s.release === r).map(([id]: Loose) => id);
    const state = shipped ? '<span class="badge good">tagged</span>' : whole.length && whole.every(storyDoneAll) ? '<span class="badge medium">ready to tag</span>' : '';
    return meterRow(`${rlink(r)} ${state}`, done, stories.length, `${done}/${stories.length} stories`, peekFor('release', r));
  }).join('') || none;
  const waves = [...new Set(p.tickets.map((t: Loose) => t.wave).filter(Boolean))].sort((a: Loose, b: Loose) => a - b);
  // the goals a wave's tickets serve, as the Goal select lists them (an abandoned goal is not named)
  const goalsOf = (ts: Loose) => filterGoals().filter((g: Loose) => { const gf = goalFeatures(g.id); return ts.some((t: Loose) => gf.has(t.feature)); }).map((g: Loose) => g.title || g.id);
  $('w-waves')!.innerHTML = waves.map((w: Loose) => {
    const ts = p.tickets.filter((t: Loose) => t.wave === w);
    if (!progressShown(allDone(ts), show)) return '';
    const gs = nameGoals ? goalsOf(ts) : [];
    return meterRow(`${wlink(w)}${gs.length ? ` <span class="dim wave-goals">${esc(gs.join(', '))}</span>` : ''}`, ts.filter(isDone).length, ts.length, '', peekFor('wave', w));
  }).join('') || none;
  const storyRows = Object.entries(p.stories).filter(([id]: Loose) => progressShown(storyDone(id), show));
  $('w-stories')!.innerHTML = storyRows.length ? `<div>${storyRows.map(([id, s]: Loose) => {
    const ts = p.tickets.filter((t: Loose) => t.serves.includes(id)); const d = ts.filter(isDone).length;
    return meterRow(`${storyDoneAll(id) ? '<span class="badge good">done</span>' : ''}${slink(id)} ${esc(String(s.text ?? '').slice(0, 80))}`, d, ts.length, `${d}/${ts.length} tickets${s.release ? ` · ${esc(s.release)}` : ''}`, peekFor('story', id));
  }).join('')}</div>` : none;
  const weeks = [7, 6, 5, 4, 3, 2, 1, 0].map((w: Loose) => pts(p.tickets.filter((t: Loose) => isDone(t) && now - Date.parse(t.merged_at) >= w * 7 * DAY && now - Date.parse(t.merged_at) < (w + 1) * 7 * DAY)));
  const wmax = Math.max(1, ...weeks);
  $('w-throughput')!.innerHTML = weeks.map((v: Loose, i: Loose) => `<span title="${v} points, ${i === 7 ? 'this week' : `${7 - i} week(s) ago`}" style="height:${(100 * v) / wmax}%"></span>`).join('');
  $('w-throughput-note')!.textContent = weeks.some((v: Loose) => v) ? `8 weeks · this week ${weeks[7]}` : 'None';
}
// Progress's scope (kit-91): the goal's tickets (every ticket with no goal), then the Narrow view's within them.
export function progressItems(p: Loose, f: Loose) {
  const items = f.goal ? filterTickets(p, `goal:${f.goal}`) : p.tickets;
  return f.narrow ? filterTickets({ ...p, tickets: items }, f.narrow) : items;
}
// Progress's data scoped to items: those tickets, and the features and stories they hold (the releases and waves
// widgets() lists come from these), so each card lists only what the items hold.
export function scopeProgress(p: Loose, items: Loose) {
  return {
    ...p, tickets: items,
    features: p.features.filter((x: Loose) => items.some((t: Loose) => t.feature === x)),
    stories: Object.fromEntries(Object.entries(p.stories).filter(([id]: Loose) => items.some((t: Loose) => t.serves.includes(id)))),
  };
}
// Progress: the burn-up, Points per week and the rows of Features, Stories, Releases and Waves over the goal and
// Narrow's items, the rows by Show; under Features, the features with no goal and the rate (ooda.roadmap).
export function renderProgress() {
  const p = (shell.DATA as Loose).progress, now = Date.parse(p.now);
  const f = filtersNow('progress');
  const items = progressItems(p, f);
  burnup(items, now);
  widgets(scopeProgress(p, items), now, (f as Loose).show, { nameGoals: !(f as Loose).goal, all: p });
  const R = (shell.DATA as Loose).ooda?.roadmap || {};
  const un = (R.unassigned || []).map((x: Loose) => { const r = R.features?.[x]; const tot = r?.points_total ?? 0; return `${flink(x)} <span class="dim">${tot - (r?.points_left ?? 0)} of ${tot} points</span>`; });
  $('w-nogoal')!.innerHTML = `${un.length ? `No goal: ${un.join(', ')} · ` : ''}${esc(R.rate_points_per_day ?? 0)} points a day`;
  const all = forecast(p.tickets, now);
  $('n-progress')!.textContent = all.scope ? `${pct(all.done, all.scope)}%` : '';
}
