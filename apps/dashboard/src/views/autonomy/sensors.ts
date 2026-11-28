// kit-994: the Sensors page (index.html's autonomy lines): Production (incidents, a card a sensor) and Fleet (its
// tables), a sensor's charts and peek.
import { INC_COLS, LEVEL_TONE, SENSOR_LEVEL_DOT, SEV_RANK, SUBJ_KINDS, fpWhat, monState, pctOr } from '../../lib/autonomy-sensors';
import { DAY } from '../../lib/shell-page';
import { lineChart } from '../loop';
import { attrs, drawerFor, fmtObj, historySection, notFound, peekFor, peekOf, psect, showDrawer } from '../peeks';
import { dur, empty, esc, subj, tabBar } from '../shell';
import { $ } from '../shell/page';
import { shell } from '../shell/state';
import { cardHead, cardMenu, linkify, ticketMap, when, who, words } from '../words';
import { effNone } from './efficiency';
import { bindPageTables, pageTable } from './pages';
import { autonomyState } from './state';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


export function sensorLevels(by: Loose) {
  const xs = Object.entries(by || {}).filter(([, n]: Loose) => Number.isFinite(n) && n > 0);
  return xs.length ? `<div class="sensor-levels">${xs.map(([l, n]: Loose) => `<span><span class="dot ${(SENSOR_LEVEL_DOT as Loose)[l] || 'blue'}"></span>${esc(l)} <b>${esc(n)}</b></span>`).join(' ')}</div>` : '';
}
// One sensor's card (pure: series is its 24h latency, or null while loading): its name and state, what it reads,
// its trouble (the last error and the retry), its figures, its live output, when it last ran; a click or Enter
// opens its peek
export function sensorCard(m: Loose, series: Loose) {
  const [tone, label] = monState(m);
  const http = m.kind === 'http', t = m.today || {};
  const failed = !!m.last && !m.last.ok;
  const trouble = failed ? `${esc(m.last_error || m.last?.error || 'failed')}${m.backoff_minutes ? ` · trying again in ${esc(m.backoff_minutes)} min` : ''}` : '';
  const msOr = (x: Loose) => (x == null ? '–' : `${x}ms`);
  const src = http ? esc(m.url || '') : `${esc(m.kind)} · ${esc(m.probe || '')}${m.uses?.length ? ` · uses ${esc(m.uses.join(', '))}` : ''}`;
  const stats = http
    ? [`24h <b>${esc(pctOr(m.uptime_24h))}</b> up`, `7d <b>${esc(pctOr(m.uptime_7d))}</b>`, `p50 <b>${esc(msOr(m.p50_24h))}</b>`, `p95 <b>${esc(msOr(m.p95_24h))}</b>`, ...(m.tls_days != null ? [`certificate <b>${esc(m.tls_days)}</b> days left`] : [])]
    : [`today <b>${esc(t.events ?? 0)}</b> event(s)`, `<b>${esc(t.qualified ?? 0)}</b> new for triage`, `<b>${esc(m.fingerprints ?? 0)}</b> fingerprint(s)`, ...(t.mean_ms != null ? [`run <b>${esc(t.mean_ms < 1000 ? `${t.mean_ms}ms` : `${(t.mean_ms / 1000).toFixed(1)}s`)}</b>`] : [])];
  const output = http ? `<div class="sensor-chart" data-mon-chart="${esc(m.name)}">${series ? sensorChart(series, m, true) : '<p class="muted small">Loading…</p>'}</div>` : sensorLevels(t.by_level);
  const ran = http ? `checked ${m.last_at ? esc(when(m.last_at)) : 'never'}` : m.last_at ? `ran ${esc(when(m.last_at))}` : 'never run';
  return `<div class="card c6 sensor-card" data-open="sensor/${esc(encodeURIComponent(m.name))}" tabindex="0" role="button" aria-label="Open the sensor ${esc(m.name)}">${cardHead('activity', esc(m.name), { extra: `<span class="badge ${tone}">${esc(label)}</span>` })}
    <div class="sensor-src">${src}</div> ${trouble ? `<p class="sensor-err">${trouble}</p> ` : ''}
    <div class="sensor-stats">${stats.map((s: Loose) => `<span>${s}</span>`).join(' ')}</div> ${output} <div class="meta">${ran}</div></div>`;
}
// Production: the incidents board first, then a card a sensor, two across
export function sensorsProduction(d: Loose) {
  const ms = d.sensors || [], incs = d.incidents || [];
  const open = incs.filter((x: Loose) => x.stage !== 'resolved').length;
  return `<div class="g12"><div class="card c12 inc-card">${cardHead('siren', 'Incidents', { extra: open ? `<span class="muted">${open} open</span>` : '' })}<div id="incidents">${incidentBoard(incs)}</div></div>${
    ms.map((m: Loose) => sensorCard(m, MON_SERIES.get(m.name)?.data ?? null)).join('')}${ms.length ? '' : '<p class="empty c12">None</p>'}</div>`;
}
export function subjectOpen(subj: Loose) {
  const s = String(subj ?? '');
  if (/^thread:t-/.test(s)) return subjectOpen(s.slice(7));
  if (ticketMap().has(s)) return `#ticket/${encodeURIComponent(s)}`;
  if (/^sensor:/.test(s)) { const n = s.slice(7); return ((shell.DATA as Loose)?.sensors || []).some((x: Loose) => x.name === n) ? `#sensor/${encodeURIComponent(n)}` : null; }
  if (/^plan-/.test(s)) { const f = s.slice(5); return ((shell.DATA as Loose)?.planners || []).some((x: Loose) => x.feature === f) ? `#planner/${encodeURIComponent(f)}` : null; }
  const id = /^([gkapmodtq])-\d{8}-\d{9}-[a-z0-9]+(?:-[a-z0-9]+)*$/.exec(s);
  return id ? `#${(SUBJ_KINDS as Loose)[id[1]]}/${encodeURIComponent(s)}` : null;
}
// A subject as plain text (the row opens it): a ticket by its title, a sensor by its name, else as written
export const subjectText = (subj: Loose) => { const s = String(subj ?? ''); const t = ticketMap().get(s); return t ? esc(t.title) : /^sensor:/.test(s) ? esc(s.slice(7)) : s ? `<code>${esc(s)}</code>` : ''; };
// Fleet's five tables, from metrics: the findings with the supervisor's next step, the ones set aside, the
// configured checks (trouble first; the one-off checks only named, in gates.oneOff), the flaky and slowest tests.
// Only a finding or a set-aside row with a record opens; checks and tests are figures (R2)
export function fleetTables(m: Loose, configured: Loose) {
  const g = m?.gates || {}, all = g.gates || [];
  const flakyG = new Set((g.flaky_gates || []).map((f: Loose) => f.gate));
  const conf = new Set(configured || []);
  const gl = all.filter((x: Loose) => !conf.size || conf.has(x.gate)), oneOff = all.filter((x: Loose) => conf.size && !conf.has(x.gate)).map((x: Loose) => x.gate);
  const trouble = (x: Loose) => (flakyG.has(x.gate) ? 2 : 0) + (x.fail_rate >= 0.2 ? 1 : 0);
  gl.sort((a: Loose, b: Loose) => trouble(b) - trouble(a) || b.runs - a.runs);
  return {
    findings: { cols: ['Finding', 'Severity', 'Next step for the supervisor', 'Subject'], rows: (m?.findings || []).map((f: Loose) => ({
      cells: [`<b>${esc(words(f.kind))}</b> <span class="dim">${esc(f.detail ?? '')}</span>`, `<span class="badge ${esc(f.severity)}">${esc(f.severity)}</span>`, esc(f.suggestion ?? ''), subjectText(f.subject)],
      sort: [words(f.kind), (SEV_RANK as Loose)[f.severity] ?? 0, f.suggestion ?? '', f.subject ?? ''],
      open: subjectOpen(f.subject),
    })) },
    aside: { cols: ['Finding', 'Subject', 'Why', 'By', 'Until'], rows: (m?.acknowledged || []).map((f: Loose) => ({
      cells: [esc(words(f.kind)), subjectText(f.subject), esc(f.ack?.reason ?? ''), esc(who(f.ack?.by)), f.ack?.until ? esc(when(f.ack.until)) : '—'],
      sort: [words(f.kind), f.subject ?? '', f.ack?.reason ?? '', who(f.ack?.by), f.ack?.until ?? null],
      open: subjectOpen(f.subject),
    })) },
    gates: { oneOff, cols: ['Check', 'Runs', 'Usually', 'Fails'], rows: gl.map((x: Loose) => ({
      cells: [`<code>${esc(x.gate)}</code>${flakyG.has(x.gate) ? ' <span class="badge high">flaky</span>' : ''}${x.fail_rate >= 0.2 ? ' <span class="badge medium">often fails</span>' : ''}`, esc(x.runs), esc(dur(x.median_seconds)),
        `${Math.round((x.fail_rate || 0) * 100)}%${x.preexisting_fails ? ` <span class="dim small">+ ${esc(x.preexisting_fails)} allowed because main failed too</span>` : ''}`],
      sort: [x.gate, x.runs, x.median_seconds, x.fail_rate], open: null,
    })) },
    flaky: { cols: ['Test', 'Times'], rows: (g.flaky_tests || []).map((x: Loose) => ({ cells: [`<code>${esc(x.name)}</code>`, `${esc(x.times)}×`], sort: [x.name, x.times], open: null })) },
    slowest: { cols: ['Test', 'Usually'], rows: (g.slowest_tests || []).map((x: Loose) => ({ cells: [`<code>${esc(x.name)}</code>`, esc(dur(x.median_seconds))], sort: [x.name, x.median_seconds], open: null })) },
  };
}
// Fleet: a card a table (R1: no spend cards, they are Efficiency's); the checks' head counts the one-off checks
export function sensorsFleet(d: Loose) {
  const t = fleetTables(d.metrics || {}, d.gates_configured || []);
  const one = t.gates.oneOff;
  const card = (cls: Loose, icon: Loose, label: Loose, key: Loose, opts: Loose = {}) => `<div class="card flush ${cls}">${cardHead(icon, label, opts)}${pageTable(`fleet:${key}`, (t as Loose)[key].cols, (t as Loose)[key].rows)}</div>`;
  const oneOff = one.length ? `<span class="muted" title="${esc(`One-off checks workers ran by hand: ${one.slice(0, 4).join(', ')}${one.length > 4 ? ', …' : ''}`)}">+ ${one.length} one-off check${one.length === 1 ? '' : 's'}</span>` : '';
  return `<div class="g12">${card('c12', 'heart-pulse', 'Findings', 'findings')}${card('c12', 'archive', 'Set aside', 'aside')}${card('c12', 'list-checks', 'Checks before merge', 'gates', { extra: oneOff })}${
    card('c6', 'shuffle', 'Flaky tests', 'flaky')}${card('c6', 'timer', 'Slowest tests', 'slowest')}</div>`;
}
// A sensor's peek (C6, D1): the observations it made and its incidents, rows that open their records
export function sensorPeekRows(name: Loose, d: Loose) {
  const obs = (d?.ooda?.observations || []).filter((o: Loose) => o.subject === `sensor:${name}`);
  const incs = (d?.incidents || []).filter((x: Loose) => x.sensor === name);
  const row = (open: Loose, dot: Loose, t: Loose, r: Loose) => `<div class="rowline" data-open="${esc(open)}" tabindex="0" role="link"><span class="dot ${dot}"></span><span class="t">${esc(t)}</span><span class="r">${esc(r)}</span></div>`;
  const stage = (x: Loose) => { const c = INC_COLS.find(([, , st]: Loose) => st.includes(x.stage)); return x.stage === 'merged' ? 'fixing: merged, not yet verified' : x.stage === 'regressed' ? 'open: regressed' : c ? (c[1] as Loose).toLowerCase() : words(x.stage); };
  return psect('Observations it made', obs.length ? `<div class="rows sensor-rows">${obs.map((o: Loose) => row(`observation/${encodeURIComponent(o.id)}`, o.severity >= 3 ? 'red' : o.severity === 2 ? 'amber' : 'blue', o.detail || words(o.kind),
    [o.severity != null ? `severity ${o.severity}` : '', o.created_at ? when(o.created_at) : ''].filter(Boolean).join(' · '))).join('')}</div>` : effNone())
    + psect('Incidents', incs.length ? `<div class="rows sensor-rows">${incs.map((x: Loose) => row(`problem/${encodeURIComponent(x.id)}`, x.stage === 'resolved' ? 'green' : x.stage === 'regressed' ? 'red' : 'amber', x.title || x.id,
      [stage(x), x.severity != null ? `severity ${x.severity}` : '', x.created_at ? `opened ${when(x.created_at)}` : ''].filter(Boolean).join(' · '))).join('')}</div>` : effNone());
}
// 24 hourly counts as bars, oldest first.
export function sparkBars(xs: Loose, label: Loose) {
  const max = Math.max(1, ...xs);
  return `<svg class="spark" viewBox="0 0 ${xs.length * 4} 16" width="${xs.length * 4}" height="16" role="img" aria-label="${esc(label)}">${xs.map((x: Loose, i: Loose) => (x ? `<rect x="${i * 4}" y="${16 - Math.max(1.5, (14 * x) / max)}" width="3" height="${Math.max(1.5, (14 * x) / max)}" rx="1"></rect>` : '')).join('')}</svg>`;
}
// One fingerprint in the exception feed: level, what, where, counts, release, links.
export const fpRow = (f: Loose) => `<div class="card small fp-row"><div><div class="act-head"><span class="badge ${(LEVEL_TONE as Loose)[f.level] ?? ''}">${esc(f.level || '')}</span> ${esc(String(fpWhat(f)).slice(0, 200))}</div>
  <div class="meta">${f.frames?.[0] ? `<code>${esc(`${f.frames[0].file}${f.frames[0].line != null ? `:${f.frames[0].line}` : ''}`)}</code> · ` : ''}${esc(f.last_24h)} in 24h · ${esc(f.total)} seen${f.users ? ` · ${esc(f.users)} user(s)` : ''}${f.release ? ` · release <code>${esc(String(f.release).slice(0, 12))}</code>` : ''} · last ${esc(when(f.last_seen))} · <a class="linkish" href="#sensor/${encodeURIComponent(f.sensor)}">${esc(f.sensor)}</a>${f.observed ? ` · ${linkify(f.observed)}` : ''}${/^https:\/\//.test(f.url || '') ? ` · <a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">provider</a>` : ''}</div></div>
  ${sparkBars(f.spark || [], `${f.last_24h} in the last 24 hours, by hour`)}</div>`;
// A sensor's latency over a range, from its bucketed samples: p50 and p95, against its target.
export function sensorChart(series: Loose, m: Loose, compact: Loose = false) {
  const bs = series?.buckets || [];
  if (!bs.length) return empty('None');
  const p50 = bs.filter((b: Loose) => b.p50 != null).map((b: Loose) => [b.t, b.p50]);
  const p95 = bs.filter((b: Loose) => b.p95 != null).map((b: Loose) => [b.t, b.p95]);
  const down = bs.filter((b: Loose) => b.ok < b.n).length;
  const span = [Date.now() - (series.range === '7d' ? 7 : 1) * DAY, Date.now()];
  return `${lineChart([{ name: 'p50', points: p50, color: 'var(--series-1)' }, { name: 'p95', points: p95, color: 'var(--amber)' }], { unit: 'ms', height: 140, span, width: compact ? 360 : 640, marks: m.slo?.p95_ms ? [{ value: m.slo.p95_ms, label: `target p95 ${m.slo.p95_ms}ms`, strong: true }] : [] })}${down ? `<p class="small muted">${down} of ${bs.length} ${series.range === '7d' ? 'hours' : '5-minute spans'} had a failed check.</p>` : ''}`;
}
// Charts on the Monitoring section: each sensor's 24h series, fetched at most once a minute.
export const MON_SERIES = new Map();
export async function loadSensorSeries(name: Loose) {
  const c = MON_SERIES.get(name);
  if (c && (c.pending || Date.now() - c.at < 60000)) return;
  MON_SERIES.set(name, { ...(c || {}), pending: true });
  try { const r = await fetch(`/api/sensor?${new URLSearchParams({ name, range: '24h' })}`); if (r.ok) MON_SERIES.set(name, { at: Date.now(), data: await r.json() }); else MON_SERIES.set(name, { at: Date.now(), data: null }); }
  catch { MON_SERIES.set(name, { at: Date.now(), data: c?.data ?? null }); }
  const el = document.querySelector(`[data-mon-chart="${CSS.escape(name)}"]`);
  const m = ((shell.DATA as Loose).sensors || []).find((x: Loose) => x.name === name);
  if (el && m) el.innerHTML = sensorChart(MON_SERIES.get(name).data, m, true);
}
export function incidentBoard(incs: Loose) {
  if (!incs.length) return '<p class="empty">None</p>';
  return `<div class="board inc">${INC_COLS.map(([k, label, stages]: Loose) => {
    let cards = incs.filter((x: Loose) => stages.includes(x.stage));
    const total = cards.length;
    if (k === 'resolved') cards = cards.slice(-5);
    return `<div class="col${total ? '' : ' none'}"><h3><span>${label}</span><span>${total}</span></h3>${cards.map((x: Loose) => `<div class="tcard${x.question?.status === 'open' || x.stage === 'regressed' ? ' blocked' : ''}"${subj('problem', x.id, x.title)} role="button" tabindex="0" data-open="problem/${esc(encodeURIComponent(x.id))}" aria-label="Open ${esc(x.title)}">${cardMenu('problem', x.id)}
      <div class="t"><a class="title-link" href="${esc(peekFor('problem', x.id))}"><b>${esc(x.title)}</b></a></div>
      <div class="muted">severity ${esc(x.severity)} · ${esc(x.events)} event(s)${x.component ? ` · ${esc(x.component)}` : ''}</div>
      ${x.stage === 'merged' || x.stage === 'regressed' || x.waiting ? `<div class="pills">${x.stage === 'merged' ? '<span class="badge pill">merged, not yet verified</span>' : ''}${x.stage === 'regressed' ? '<span class="badge pill high">regressed</span>' : ''}${x.waiting ? `<span class="badge pill ${x.question?.status === 'open' ? 'medium' : ''}">${esc(x.waiting.replace(/ at (\S+)$/, (_: Loose, at: Loose) => ` ${when(at)}`))}</span>` : ''}</div>` : ''}
    </div>`).join('')}${total > cards.length ? `<div class="more">+ ${total - cards.length} more</div>` : ''}</div>`;
  }).join('')}</div>`;
}
export function renderMonitoring(d: Loose) {
  const ms = d.sensors || [];
  const down = ms.filter((m: Loose) => m.state === 'down');
  const banner = down.length ? `<i class="icon-triangle-alert" aria-hidden="true"></i> ${down.map((m: Loose) => `<a href="#sensor/${encodeURIComponent(m.name)}">${esc(m.name)}</a> is down since ${esc(when(m.since))}${m.last?.error ? ` (${esc(m.last.error)})` : ''}`).join('; ')}` : '';
  // only when it changes, so a screen reader announces an outage once
  if ($('down-banner')!.innerHTML !== banner) { $('down-banner')!.innerHTML = banner; $('down-banner')!.hidden = !down.length; }
  // the page (kit-93): its tabs, then Production or Fleet, written only when its HTML changed (focus kept)
  const fs = d.metrics?.findings || [];
  const html = tabBar({ tabs: [{ id: 'production', label: 'Production', count: ms.length }, { id: 'fleet', label: 'Fleet', count: fs.length, waiting: true }], selected: autonomyState.SENSOR_TAB })
    + (autonomyState.SENSOR_TAB === 'fleet' ? sensorsFleet(d) : sensorsProduction(d));
  const el = $('monitoring');
  if ((el as Loose)!.__html !== html) { (el as Loose)!.__html = html; el!.innerHTML = html; bindPageTables(el, () => renderMonitoring(shell.DATA)); }
  if (autonomyState.SENSOR_TAB !== 'fleet') for (const m of ms.filter((x: Loose) => x.kind === 'http')) loadSensorSeries(m.name);
}
export function openSensor(name: Loose) {
  drawerFor('sensor', name);
  const p = peekOf('sensor', name);
  const m = ((shell.DATA as Loose).sensors || []).find((x: Loose) => x.name === name) || (p as Loose)?.status;
  if (!m) return notFound('sensor', name, p, 'No sensor by that name in the settings.', { noRecord: true });
  const [tone, label] = monState(m);
  const fails = (p as Loose)?.failures || [];
  if (m.kind !== 'http') return showDrawer(`<h2 id="drawer-title">${esc(name)}</h2>
    ${attrs({ id: name, idTip: 'Its name in the owner settings (sensors).', peek: p, noRecord: true, computed: [
      ['State', `<span class="badge ${tone}">${esc(label)}</span>`, 'Reading (its last run was clean), failing (three failed runs in a row; it backs off, doubling up to an hour), or not run yet. A stream is listening while its collector runs alongside the supervisor.'],
      ['Reads', `${esc(m.kind)} <code>${esc(m.probe || '')}</code>${m.uses?.length ? ` · uses ${esc(m.uses.join(', '))}` : ''}${m.credentials?.length ? ` · credentials ${m.credentials.map((c: Loose) => `<code>${esc(c)}</code>`).join(', ')}` : ''} · every ${esc(m.every_minutes)} min`, 'A probe the supervisor wrote and a reviewer read, run from main. Credentials by name only: the values are decrypted for the probe and never shown.'],
      ['Triage', m.triage ? esc((fmtObj(m.triage) as Loose).replace(/<[^>]+>/g, '')) : 'error and above, from the first event', 'When a fingerprint is first observed: its level, its count and its users at these thresholds.'],
      ['Last run', m.last_at ? `${esc(when(m.last_at))}: ${m.last?.ok ? `ok, ${esc(m.last.events)} event(s)` : esc(m.last_error || m.last?.error || 'failed')}${m.last?.ms != null ? `, ${esc(m.last.ms)}ms` : ''}${m.backoff_minutes ? ` · next in ${esc(m.backoff_minutes)} min` : ''}` : 'never', 'The supervisor runs it while it runs (wait polls it when due).'],
      ['Today', `${esc(m.today.events)} event(s), ${esc(m.today.qualified)} new for triage, ${esc(m.today.runs)} run(s), ${esc(m.today.fails)} failed, ${esc(m.today.invalid)} invalid line(s)`, 'How the probe itself is doing: the day\'s rollup observes the same.'],
      ['Invalid lines', m.invalid ? esc(m.invalid.lines.map((l: Loose) => l.why).join('; ')) : '', 'Lines its last run printed that are not events: the provider may have changed its API (probe-drift).'],
    ] })}
    ${((p as Loose)?.ignores || []).length ? psect('Ignored', `<ul>${(p as Loose).ignores.map((x: Loose) => `<li><code>${esc(x.fingerprint)}</code>: ${esc(x.reason)} <span class="muted">(${esc(who(x.by))}, ${esc(when(x.at))}; lift with <code>sensor unignore ${esc(x.fingerprint)} --owner</code>)</span></li>`).join('')}</ul>`) : ''}
    ${psect(m.fingerprints > 0 ? 'Fingerprints' : 'What it read', ((p as Loose)?.feed || []).length ? `<div class="feed">${(p as Loose).feed.map(fpRow).join('')}</div>` : empty('None'))}
    ${sensorPeekRows(name, shell.DATA)}
    ${historySection(p, `sensor:${name}`)}`);
  showDrawer(`<h2 id="drawer-title">${esc(name)}</h2>
    ${attrs({ id: name, idTip: 'Its name in the settings (sensors).', peek: p, noRecord: true, computed: [
      ['State', `<span class="badge ${tone}">${esc(label)}</span>${m.since ? ` since ${esc(when(m.since))}` : ''}`, 'Up, down (after its failed checks in a row) or slow (p95 over its target), from its checks.'],
      ['Checks', `<code>${esc(m.url || '')}</code>${m.expect ? ` · expects ${esc((fmtObj(m.expect) as Loose).replace(/<[^>]+>/g, ''))}` : ''} · every ${esc(m.every_minutes)} min · down after ${esc(m.down_after)} failed`, 'What it requests and what counts as up; the supervisor\'s settings; it needs no owner answer.'],
      ['Target', m.slo ? `${m.slo.uptime ? `${(100 * m.slo.uptime).toFixed(2)}% up` : ''}${m.slo.uptime && m.slo.p95_ms ? ' · ' : ''}${m.slo.p95_ms ? `p95 under ${esc(m.slo.p95_ms)}ms` : ''}` : '', 'Its service-level target: uptime over a week, and the p95 response time.'],
      ['Uptime', `${esc(pctOr(m.uptime_24h))} over 24h · ${esc(pctOr(m.uptime_7d))} over 7d`, 'The share of checks that passed.'],
      ['Response time', `p50 ${esc(m.p50_24h == null ? '–' : `${m.p50_24h}ms`)} · p95 ${esc(m.p95_24h == null ? '–' : `${m.p95_24h}ms`)} over 24h`, 'From checks that passed.'],
      ['Last check', m.last_at ? `${esc(when(m.last_at))}: ${m.last?.ok ? 'ok' : esc(m.last?.error || 'failed')}${m.last?.ms != null ? `, ${esc(m.last.ms)}ms` : ''}` : 'never', 'The supervisor checks it while it runs (wait polls it when due).'],
      ['Certificate', m.tls_days != null ? `expires in ${esc(m.tls_days)} days` : '', 'Days until the site\'s TLS certificate expires, checked hourly.'],
    ] })}
    ${(p as Loose)?.series ? `${psect('Last 24 hours', sensorChart((p as Loose).series['24h'], m))}${psect('Last 7 days', sensorChart((p as Loose).series['7d'], m))}` : '<p class="loading">Loading…</p>'}
    ${fails.length ? psect('Failed checks', `<ul>${fails.map((s: Loose) => `<li>${esc(when(s.at))}: ${esc(s.error || 'failed')}${s.ms != null ? ` <span class="muted">(${esc(s.ms)}ms)</span>` : ''}</li>`).join('')}</ul>`) : ''}
    ${sensorPeekRows(name, shell.DATA)}
    ${historySection(p, `sensor:${name}`)}`);
}
