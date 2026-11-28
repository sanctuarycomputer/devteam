// kit-991: the Overview page (index.html's overview lines between and after its two blocks): NEXT_ID, and
// renderOverview with its part writers. They read the page's data as shell.DATA, /api/hello's answer as
// overviewState.HELLO, and other views' state through their objects; the score-of and hello-pulse blocks are the
// lib's (src/lib/overview-score.ts, src/lib/overview-hello.ts).
import { AUTONOMY_SCORE_TIP, BUGS_MERGED_TIP, ovAgo, ovMosaic } from '../../lib/overview-hello';
import { SCORE_TILES, scoreAt, scoreOf } from '../../lib/overview-score';
import { attachmentsState } from '../attachments/state';
import { effNum, spark } from '../autonomy';
import { forecast } from '../board';
import { goalBlock, goalState, goalStepsOf } from '../goals';
import { esc, fmtDate, pct, statusPill } from '../shell';
import { $ } from '../shell/page';
import { shell } from '../shell/state';
import { threadState } from '../thread/state';
import { words } from '../words';
import { wordsState } from '../words/state';
import { overviewState } from './state';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` is a type only (SWC strips
// it). Some are there because another view's stub returns `never`: the compiler reads the code after a call into one
// as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;

// The open question devteam.mjs next names: the first in /api/data's order. Its row and card carry the Next chip.
export const NEXT_ID = () => (shell.DATA as Loose)?.questions?.[0]?.id ?? null;
// Overview: the header (name, summary, status pill), then the ruled sections: Status, Numbers,
// Autonomy, Goals, Needs you, Commit history. Each part is written only when it changed.
const OV_DRAWN = new WeakMap();
const ovSet = (el: Loose, html: Loose) => { if (el && OV_DRAWN.get(el) !== html) { OV_DRAWN.set(el, html); el.innerHTML = html; } };
// ui-candidate: section (apps-src@2: renderOverview writes HTML strings and src/shared/ui/'s components are React, so no component's output is this markup; the port keeps index.html's)
const ovSec = (label: Loose, body: Loose) => `<section class="sec"><div class="lbl">${esc(label)}</div><div class="sec-b">${body}</div></section>`;
// ui-candidate: stat (apps-src@2: renderOverview writes HTML strings and src/shared/ui/'s components are React, so no component's output is this markup; the port keeps index.html's)
const ovTile = (span: Loose, label: Loose, value: Loose, tip = '', extra = '') => `<div class="${span} stat"${tip ? ` title="${esc(tip)}"` : ''}><span class="k">${esc(label)}${tip ? ' <i class="icon-info" aria-hidden="true"></i>' : ''}</span><b>${esc(value)}</b>${extra}</div>`;
// ui-candidate: row-line (apps-src@2: renderOverview writes HTML strings and src/shared/ui/'s components are React, so no component's output is this markup; the port keeps index.html's)
const ovRow = (dot: Loose, t: Loose, r: Loose) => `<div class="rowline"><span class="dot${dot ? ` ${dot}` : ''}"></span><span class="t">${esc(t)}</span><span class="r">${esc(r)}</span></div>`;
export function renderOverview() {
  const d = shell.DATA as Loose;
  if (!d) return;
  const m = d.metrics, p = d.progress, o = d.ooda, R = o.roadmap;
  const now = Date.parse(p.now);
  const plural = (n: Loose, w: Loose) => `${n} ${w}${n === 1 ? '' : 's'}`;
  // a worker is active until its ticket merges, as the kit counts slots (activeWorker)
  const active = d.tickets.filter((t: Loose) => t.phase && !['done', 'parked'].includes(t.phase) && !['merged', 'released'].includes(t.stage)).length;
  const qs = (d.questions || []).filter((q: Loose) => !attachmentsState.ANSWERED.has(q.id));
  const name = d.project && !String(d.project).startsWith('<') ? String(d.project) : overviewState.HELLO?.name ?? 'devteam';
  ovSet($('ov-head'), `<h2>${esc(name)}</h2><span class="sum">${esc(`${plural(qs.length, 'question')} · ${plural(active, 'ticket')} in flight`)}</span><span class="ov-pill">${statusPill(overviewState.HELLO?.pulse?.state ?? 'unknown')}</span>`);

  // Status: the supervisor as /api/threads has its terminal (askSet keeps it), else hello's last move
  const ask = threadState.ASK.q;
  const last = overviewState.HELLO?.pulse?.last_activity;
  const sup = ask ? (ask.kind === 'limit' ? ['amber', 'at a usage limit'] : ['red', 'stopped at a prompt']) : last ? ['green', `last moved ${ovAgo(last)}`] : ['', '–'];
  const cap = d.caps?.max_active_tickets;
  const pl = d.planners || [], stopped = pl.filter((x: Loose) => x.waiting).length;
  const sn = d.sensors || [], up = sn.filter((x: Loose) => ['up', 'ok'].includes(x.state)).length, down = sn.filter((x: Loose) => x.state === 'down').length;
  const status = `<div class="rows">${[
    ovRow(sup[0], 'Supervisor', sup[1]),
    ovRow(active ? 'green' : '', 'Workers', typeof cap === 'number' ? `${active} of ${cap}` : `${active} active, no cap`),
    ovRow(stopped ? 'red' : pl.length ? 'blue' : '', 'Planners', pl.length ? `${pl.length} planning${stopped ? `, ${stopped} stopped` : ''}` : 'none'),
    ovRow(down ? 'red' : sn.length && up === sn.length ? 'green' : sn.length ? 'amber' : '', 'Sensors', sn.length ? `${up} of ${sn.length} up` : 'none'),
  ].join('')}</div>`;

  // Numbers: the ten tiles in the mock's order; bugs merged only once there is a production sensor
  const fcAll = forecast(p.tickets, now) as Loose;
  const stats = [
    ['done', `${pct(fcAll.done, fcAll.scope)}%`],
    ['forecast finish', fcAll.finished ? 'done' : fcAll.eta ? fmtDate(fcAll.eta) : '–'],
    ['workers active', `${active}/${cap ?? 'no cap'}`],
    ['blocked', d.tickets.filter((t: Loose) => t.phase === 'blocked').length],
    ['median cycle', m.cycle_hours.median == null ? '–' : `${m.cycle_hours.median}h`],
    ['cost per ticket', m.cost.usd_per_merged_ticket == null ? '–' : `$${m.cost.usd_per_merged_ticket}`],
    ['spend', !m.cost.usd_all && !m.cost.usd_total ? 'none recorded' : `$${Math.round(m.cost.usd_all ?? m.cost.usd_total)}`],
    ['open questions', d.questions.length],
    ['answer rate (14d)', m.owner_questions.answer_rate_14d == null ? '–' : `${Math.round(m.owner_questions.answer_rate_14d * 100)}%`],
    ...(sn.length ? [['bugs merged', m.escaped_defects ?? '–', BUGS_MERGED_TIP]] : []),
  ];
  const numbers = `<div class="g12 stats">${stats.map(([k, v, tip]: Loose) => ovTile('c2', k, String(v), tip)).join('')}</div>`;

  // Autonomy: the four scores as served (the page computes none), each with its 12 weeks when two are scored
  const autonomy = `<div class="g12 stats">${SCORE_TILES.map(([label, path, at], i) => {
    const { pct: n, weeks } = scoreOf(scoreAt(d, path), at);
    return ovTile('c3', label, n == null ? '–' : `${n}%`, i === 0 ? AUTONOMY_SCORE_TIP : '', weeks.filter(effNum as Loose).length >= 2 ? spark(weeks, label) : '');
  }).join('')}</div>`;

  // Goals: every active goal (not Upkeep, met or let go) in priority order, the step bar Goals draws
  const pri = (g: Loose) => (typeof g.priority === 'number' ? g.priority : Infinity);
  const live = o.goals.filter((g: Loose) => !['met', 'abandoned'].includes(g.status)).sort((a: Loose, b: Loose) => pri(a) - pri(b));
  // ui-candidate: badge, empty (apps-src@2: renderOverview writes HTML strings and src/shared/ui/'s components are React, so no component's output is this markup; the port keeps index.html's)
  const goals = live.length ? `<div class="g12 ov-goals">${live.map((g: Loose) => {
    const s = goalState(g, R, d.questions || []) as Loose;
    const blk = goalBlock(g, d);
    return `<a class="c6 ov-goal${blk ? ` blk-${blk}` : ''}" href="#goal/${esc(encodeURIComponent(g.id))}" data-goal="${esc(g.id)}"><span class="rowline"><span class="badge ${s.tone}" title="${esc(s.label)}">${esc(s.label)}</span><span class="t">${esc(g.title)}</span></span>${goalStepsOf(g, s, R)}</a>`;
  }).join('')}</div>` : '<p class="empty">None</p>';

  // Needs you: the open questions in rank order; the one next names carries the chip; a row opens it in the Inbox
  const next = NEXT_ID();
  // ui-candidate: rows, empty (apps-src@2: renderOverview writes HTML strings and src/shared/ui/'s components are React, so no component's output is this markup; the port keeps index.html's)
  const needs = qs.length ? `<div class="rows">${qs.map((q: Loose) => `<a class="rowline" href="#q/${esc(encodeURIComponent(q.id))}"><span class="dot ${q.kind === 'one-way-door' ? 'red' : 'amber'}"></span>${q.id === next ? '<span class="chip-next">Next</span>' : ''}<span class="t">${esc(q.question)}</span><span class="r">${esc(q.kind ? (wordsState.KIND_WORDS as Loose)[q.kind] || words(q.kind) : 'Question')}</span></a>`).join('')}</div>` : '<p class="empty">None</p>';

  ovSet($('ov-secs'), ovSec('Status', status) + ovSec('Numbers', numbers) + ovSec('Autonomy', autonomy) + ovSec('Goals', goals) + ovSec('Needs you', needs) + ovSec('Commit history', ovMosaic(overviewState.HELLO?.pulse?.activity)));
}
