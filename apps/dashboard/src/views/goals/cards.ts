// kit-992: the goals' cards (index.html's goals lines): a goal's state and step bar, the hold control, Upkeep's card,
// an active goal's card and a met or let-go one's, the registry attestation line, a goal's planners, and the Board's
// planner cards. They read the page's data as shell.DATA, goals's state as goalsState.<name> and review's hold words
// as reviewState.HOLD_STATE_WORDS; the goal-block is the lib's (src/lib/goals-block.ts).
import { DAY } from '../../lib/shell-page';
import { goalBlock, heartbeatDays } from '../../lib/goals-block';
import { attLine, needsAttention, pillsOf } from '../board';
import { fleetMoveReady, holdState } from '../review';
import { reviewState } from '../review/state';
import { esc, goalSteps, heartbeat, subj } from '../shell';
import { shell, viewer } from '../shell/state';
import { cap, cardHead, fileHref, qlink, when } from '../words';
import { goalsState } from './state';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it). Some are there because another view's stub returns `never`: the compiler reads the code after a call
// into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;

// A held goal keeps its step; its label says the hold first.
export function goalState(g: Loose, R: Loose, openQs: Loose) {
  const s = goalStateOf(g, R, openQs);
  const h = g.hold_view;
  if (!h || h.mode === 'run' || h.mode === 'let-go') return s;
  const st = holdState(h) as Loose;
  const words = (reviewState.HOLD_STATE_WORDS as Loose)[st] || st;
  const running = h.running.length ? ` (${h.running.length} ${h.mode === 'park' ? 'still settling' : 'still running'})` : h.fleet && ['parked', 'drained'].includes(st) && goalsState.FLEET.data && !fleetMoveReady() ? ' (the fleet isn\u2019t ready to move yet)' : '';
  const why = `${h.fleet ? 'the whole fleet' : h.by === 'supervisor' ? 'the supervisor' : 'you'}${h.reason ? `: ${esc(h.reason)}` : ''}`;
  return { ...s, label: `${words}${running} · ${s.label}`, tone: h.mode === 'park' ? 'high' : 'medium', next: `${h.mode === 'drain' ? 'Draining: what is running finishes and merges; nothing new starts' : 'Parked: its sessions stopped with their work pushed and a handoff; nothing starts and nothing merges'} (set by ${why}). ${s.next || ''}` };
}
export function goalStateOf(g: Loose, R: Loose, openQs: Loose): Loose {
  const ask = openQs.find((q: Loose) => q.kind === 'goal-approval' && q.goal === g.id);
  const defQ = openQs.find((q: Loose) => q.kind === 'goal-definition');
  if (g.status === 'met') return { key: 'met', label: 'Met', tone: 'good', step: 5, next: 'The measure reached its target.' };
  if (g.status === 'abandoned') return { key: 'let-go', label: 'Let go', tone: '', step: 0, next: g.decision?.notes ? `You let it go: ${esc(g.decision.notes)}` : 'You let it go.' };
  if (g.status === 'ready' && g.at_target) {
    // the measure is at its target: only you mark it met, here or by answering the supervisor's question
    const a = g.at_target;
    const unit = g.measure?.unit ? ` ${g.measure.unit}` : '';
    const said = g.measure?.source === 'owner' ? `You said it is met (${esc(when(a.at))}), but it was never marked met.` : `The measure reads ${esc(a.value)}${esc(unit)} (${esc(when(a.at))}), its target.`;
    return { key: 'at-target', label: 'Reached its target', tone: 'good', step: 4, next: `${said} ${a.question ? `<b>Waiting on you:</b> ${qlink(a.question, 'say whether it is met')}, or mark it met below.` : 'Mark it met below if you agree; the supervisor asks you in the Inbox too.'}` };
  }
  if (g.status === 'ready') {
    const r = R.goals.find((x: Loose) => x.id === g.id);
    const feats = (r?.features || []).map((f: Loose) => R.features[f]).filter(Boolean);
    if (!feats.length) return { key: 'planning', label: 'Planning the work', tone: 'low', step: 3, next: 'Approved. The supervisor is turning the design into features and tickets.' };
    const left = feats.reduce((a: Loose, v: Loose) => a + v.points_left, 0);
    const unplanned = r?.unplanned || [];
    if (!left && unplanned.length) return { key: 'planning', label: 'Planning the rest', tone: 'low', step: 3, next: `What was planned is built. Still without a plan: ${esc(unplanned.map((u: Loose) => u.text).join('; '))}.` };
    const ms = r?.milestones || [];
    const cur = ms.find((m: Loose) => m.status === 'current');
    const after = ms.filter((m: Loose) => m.status === 'later').length;
    if (!left && cur && after) return { key: 'measuring', label: g.track === 'behind' ? `Milestone ${cur.n} built, behind` : `Milestone ${cur.n} built, measuring`, tone: g.track === 'behind' ? 'high' : 'good', step: 3, next: `${esc(cur.title)} is built; once the measure reaches ${esc(cur.target)}${esc(g.measure?.unit ? ` ${g.measure.unit}` : '')}, the next milestone is planned (${after} to go).` };
    if (!left) return { key: 'measuring', label: g.track === 'behind' ? 'Built, measure behind' : 'Built, measuring', tone: g.track === 'behind' ? 'high' : 'good', step: 4, next: 'Everything planned is built; the measure decides when it is met.' };
    const waiting = feats.reduce((a: Loose, v: Loose) => a + v.blocked_by_questions.length, 0);
    return { key: 'building', label: `${cur && ms.length > 1 ? `Milestone ${cur.n} of ${ms.length}: ` : ''}${g.track === 'behind' ? 'being built, behind' : 'being built'}`.replace(/^b/, 'B'), tone: g.track === 'behind' ? 'high' : 'low', step: 3, next: waiting ? `<b>Waiting on ${waiting} answer${waiting > 1 ? 's' : ''} from you</b> in the Inbox.` : '' };
  }
  if (ask) return { key: 'awaiting', label: 'Waiting for your approval', tone: 'medium', step: 2, ask, next: `<b>Waiting on you:</b> ${qlink(ask.id, 'review the design and decide')}.` };
  if (g.decision?.verdict === 'refine') return { key: 'refining', label: 'Being reworked', tone: 'medium', step: 1, next: `The design is being reworked with your notes: “${esc(g.decision.notes || '')}”` };
  if (g.check.definition.length) return { key: 'defining', label: 'Being defined', tone: 'medium', step: 0, next: defQ ? `<b>Waiting on you:</b> ${qlink(defQ.id, 'answer the open questions')}.` : `Still open: ${esc(g.check.definition.slice(0, 3).join('; '))}${g.check.definition.length > 3 ? '…' : ''}.` };
  // only say "being designed" when someone is: a planner in flight for it, or design questions open
  const designing = planningFor(g).length || openQs.some((q: Loose) => q.goal === g.id);
  const after = (g.plan_after || []).map((d: Loose) => ({ ...d, g: ((shell.DATA as Loose).ooda.goals || []).find((x: Loose) => x.id === d.goal) })).filter((d: Loose) => d.g && (d.g.status || 'draft') === 'draft');
  if (!designing && after.length) return { key: 'designing', label: 'Waiting on another goal', tone: '', step: 1, next: after.map((d: Loose) => `Its design waits for <a class="linkish" href="#goal/${encodeURIComponent(d.goal)}">${esc(d.g?.title || d.goal)}</a>’s: ${esc(d.reason)}`).join('<br>') };
  if (!designing) return { key: 'designing', label: 'Waiting for a planner', tone: 'medium', step: 1, next: 'Fully defined, but nobody is designing it yet. The supervisor starts a planner when a slot is free (Health says when one is).' };
  return { key: 'designing', label: 'Approach being designed', tone: '', step: 1, next: 'Fully defined. The supervisor is writing and reviewing the design; you’ll approve it in the Inbox.' };
}
// Where a goal is: the work merged (fills the Built step) and the outcome reached (fills Met).
export function goalProgress(g: Loose, R: Loose) {
  const out: Loose = { work: null, outcome: null };
  const r = R.goals.find((x: Loose) => x.id === g.id);
  const feats = (r?.features || []).map((f: Loose) => R.features[f]).filter(Boolean);
  if (feats.length) {
    const total = feats.reduce((a: Loose, v: Loose) => a + v.points_total, 0), left = feats.reduce((a: Loose, v: Loose) => a + v.points_left, 0);
    const thisWeek = (() => { const x = new Date(); x.setUTCHours(0, 0, 0, 0); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x; })();
    const eta = r?.eta && r.eta !== 'done' ? new Date(`${r.eta}T00:00:00Z`) : null;
    const when = r?.eta === 'done' ? 'done' : !eta ? '' : eta < thisWeek ? 'overdue' : (eta as Loose) - (thisWeek as Loose) < 7 * DAY ? 'this week' : `by ${eta.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
    out.work = { frac: total ? (total - left) / total : 0, text: `${total - left} of ${total} points${when ? ` · ${when}` : ''}` };
  }
  const m = g.measure || {};
  if (typeof m.target === 'number') {
    const rs = g.readings || [];
    const base = rs.length ? rs[0].value : null, now = rs.length ? rs[rs.length - 1].value : null;
    const span = base == null ? 0 : m.target - base;
    const unit = m.unit ? ` ${m.unit}` : '';
    out.outcome = { frac: base == null || !span ? 0 : Math.max(0, Math.min(1, (now - base) / span)), text: base == null ? `no reading yet · target ${m.target}${unit}` : `${now} now → ${m.target}${unit}`, title: `${cap(m.description || 'Measure')}: ${base == null ? 'no reading yet' : `${now}${unit} now, from ${base}`}, target ${m.target}${unit}` };
  }
  return out;
}
// The shell's step bar's data for a goal (goalSteps): its step, the work merged (Built) and the outcome
// reached (Met); null for a let-go goal, which has no bar. Overview, Goals and the goal peek all draw it.
export function goalStepData(g: Loose, s: Loose, R: Loose) {
  if (s.key === 'let-go' || g.status === 'abandoned') return null;
  const p = goalProgress(g, R);
  return { step: s.step, built: p.work, met: p.outcome };
}
export const goalStepsOf = (g: Loose, s: Loose, R: Loose) => { const d = goalStepData(g, s, R); return d ? goalSteps(d) : ''; };
// The toggle: Run, Drain, Park, and Let go (Restore once let go). Let go asks to confirm in place; the
// confirm is page memory (id → until when), so a redraw of the peek draws it again rather than dropping it.
export const holdConfirming = (id: Loose) => (goalsState.HOLD_CONFIRM.get(id) ?? 0) > Date.now();
// ui-candidate: hold-bar, segmented (apps-src@2: holdControl writes HTML strings and src/shared/ui/'s components are React, so no component's output is this markup; the port keeps index.html's)
export function holdControl(id: Loose, h: Loose, { letGo = true, status = null as Loose, restoring = false } = {}) {
  if (status === 'met') return '';
  if (restoring) return `<div class="holdbar"><span class="muted small">Restoring: it comes back parked…</span><span class="err" id="e-hold-${esc(id)}"></span></div>`;
  if (status === 'abandoned') return `<div class="holdbar"><span class="seg2" role="group" aria-label="Hold"><button type="button" data-hold-id="${esc(id)}" data-mode="restore">Restore (parked)</button></span><span class="err" id="e-hold-${esc(id)}"></span></div>`;
  const cur = h?.mode || 'run';
  const fleet = (shell.DATA as Loose)?.fleet?.mode ? '<span class="muted small">set for the whole fleet: use the fleet switch in the sidebar to resume it</span>' : '';
  const btn = (m: Loose, label: Loose, cls = '') => `<button type="button"${cls ? ` class="${cls}"` : ''} data-hold-id="${esc(id)}" data-mode="${m}" aria-pressed="${cur === m}">${label}</button>`;
  const sure = holdConfirming(id);
  return `<div class="holdbar"><span class="seg2" role="group" aria-label="Hold">${btn('run', 'Run')}${btn('drain', 'Drain')}${btn('park', 'Park')}${letGo ? btn('let-go', sure ? 'Confirm let go' : 'Let go', sure ? 'confirm' : '') : ''}</span>${fleet}<span class="err" id="e-hold-${esc(id)}"></span></div>`;
}
// Upkeep's card on Goals: its hold word, always on (or held), the last days' heartbeat, the chores in
// flight; its hold control is in its peek.
// ui-candidate: card, badge, title-link (apps-src@2: upkeepCardHtml writes HTML strings and src/shared/ui/'s components are React, so no component's output is this markup; the port keeps index.html's)
export function upkeepCardHtml(u: Loose, days: Loose) {
  const words = (reviewState.HOLD_STATE_WORDS as Loose)[holdState(u) as Loose] || u.state;
  const held = u.mode === 'park' ? 'parked' : u.mode === 'drain' ? 'draining' : null;
  const chores = u.chores || [];
  return `<div class="c6 card goal upkeep"${subj('goal', 'upkeep', 'Upkeep')} role="button" tabindex="0" data-open="goal/upkeep">
    ${cardHead('repeat', `<span class="badge ${u.mode === 'run' ? 'good' : u.mode === 'park' ? 'high' : 'medium'}">${esc(words)}</span>`, { extra: held ? (u.fleet ? `the fleet is ${held}` : held) : 'always on', id: u.id || 'upkeep', open: 'goal/upkeep' })}
    <h4><a class="title-link" href="#goal/upkeep">Upkeep</a></h4>
    ${Array.isArray(days) && days.length ? heartbeat(heartbeatDays(days)) : ''}
    ${chores.length ? `<p class="goal-next">In flight: ${chores.slice(0, 6).map((c: Loose) => `<a class="linkish" href="#ticket/${encodeURIComponent(c.id)}">${esc(c.id)}</a>`).join(', ')}${chores.length > 6 ? '…' : ''}</p>` : ''}
  </div>`;
}
// A goal's card on Goals' Active tab: its head, title, step bar, next line, attestation, Mark met and
// links; outlined when its work waits (goalBlock). Its hold control is in its peek. pos ({ i, n }: its index
// among the Active tab's goal cards, and their count) draws its reorder controls: a drag handle before the
// icon and Move up / Move down in its ⋯ (not in the viewer; none without pos: Overview, Met, Let go).
// ui-candidate: card, badge, title-link, hold-bar (apps-src@2: goalCardHtml writes HTML strings and src/shared/ui/'s components are React, so no component's output is this markup; the port keeps index.html's)
export function goalCardHtml(g: Loose, R: Loose, openQs: Loose, pos: Loose = null) {
  const s = goalState(g, R, openQs);
  const design = s.ask?.links?.[0] ?? (['ready', 'met'].includes(g.status) && g.check.design ? { title: 'The design', path: `docs/devteam/${g.check.design}` } : null);
  const blk = goalBlock(g, shell.DATA);
  // the card opens its peek (a click on it, Enter on it, its title, Open in side peek in its ⋯); no Open link
  const meta = [design ? `<a href="${esc(fileHref({ ...design, title: design.title || 'The design' }))}">Read the design</a>` : '', planningFor(g).map((p: Loose) => `<a href="#planner/${encodeURIComponent(p.feature)}">planner on ${esc(p.title)}</a>${p.waiting ? ' <span class="badge high">stuck on a prompt</span>' : ''}`).join(', ')].filter(Boolean).join(' · ');
  const ro = pos && !viewer();
  const lead = ro ? `<button type="button" class="goal-grip" data-goal-grip="${esc(g.id)}" aria-label="Reorder ${esc(g.title)}" title="Drag to reorder; or ↑ and ↓"><i class="icon-grip-vertical" aria-hidden="true"></i></button>` : '';
  const menuExtra = ro ? `<button type="button" class="ghost" data-goal-move="up" data-goal-id="${esc(g.id)}"${pos.i === 0 ? ' disabled' : ''}>Move up</button><button type="button" class="ghost" data-goal-move="down" data-goal-id="${esc(g.id)}"${pos.i === pos.n - 1 ? ' disabled' : ''}>Move down</button>` : '';
  return `<div class="c6 card goal goal-${s.key}${blk ? ` blk-${blk}` : ''}"${subj('goal', g.id, g.title)}${ro ? ` data-goal-card="${esc(g.id)}"` : ''} role="button" tabindex="0" data-open="goal/${esc(encodeURIComponent(g.id))}">
    ${cardHead('target', `<span class="badge ${s.tone}" title="${esc(s.label)}">${esc(s.label)}</span>`, { extra: [g.priority ? `priority ${esc(g.priority)}` : '', g.impact ? esc(g.impact.words) : ''].filter(Boolean).join(' · '), id: g.id, rows: [['Opened', esc(when(g.created_at))]], open: `goal/${g.id}`, lead, menuExtra })}
    <h4><a class="title-link" href="#goal/${encodeURIComponent(g.id)}">${esc(g.title)}</a></h4>
    ${goalStepsOf(g, s, R)}
    ${s.next ? `<p class="goal-next">${s.next}</p>` : ''}
    ${registryAttestLine(g)}
    ${g.status === 'ready' && g.at_target ? `<div class="holdbar"><button type="button" data-met-id="${esc(g.id)}">Mark met</button><span class="muted small">${['repo', 'prod'].includes(g.measure?.source) ? 'its check runs again first' : 'your yes marks it met'}</span><span class="err" id="e-met-${esc(g.id)}"></span></div>` : ''}
    ${meta ? `<div class="meta">${meta}</div>` : ''}
  </div>`;
}
// A met or let-go goal's card: its badge, title, when, and the reason (let go) or the measure (met).
// ui-candidate: card, badge, title-link (apps-src@2: closedGoalCardHtml writes HTML strings and src/shared/ui/'s components are React, so no component's output is this markup; the port keeps index.html's)
export function closedGoalCardHtml(g: Loose, R: Loose, openQs: Loose) {
  const s = goalStateOf(g, R, openQs);
  const met = g.status === 'met';
  // when it was met or let go: the last update that set its status (none known: no date, never a wrong one)
  const at = [...(g.updates || [])].reverse().find((u: Loose) => u.status === g.status)?.at ?? null;
  const rs = g.readings || [], m = g.measure || {};
  const measure = met && rs.length && typeof m.target === 'number' ? ` ${esc(cap(m.description || 'the measure'))}: ${esc(rs[rs.length - 1].value)}${esc(m.unit ? ` ${m.unit}` : '')}, target ${esc(m.target)}${esc(m.unit ? ` ${m.unit}` : '')}.` : '';
  return `<div class="c6 card goal goal-closed"${subj('goal', g.id, g.title)} role="button" tabindex="0" data-open="goal/${esc(encodeURIComponent(g.id))}">
    ${cardHead('target', `<span class="badge ${met ? 'good' : ''}">${met ? 'Met' : 'Let go'}</span>`, { extra: at ? `${met ? 'met' : 'let go'} ${esc(when(at))}` : '', id: g.id, open: `goal/${g.id}` })}
    <h4><a class="title-link" href="#goal/${encodeURIComponent(g.id)}">${esc(g.title)}</a></h4>
    <p class="goal-next">${s.next}${measure}</p>
  </div>`;
}
// The goal's registry attestation (planning.md §7), when it marks a precondition as the registry being complete.
export const registryAttestLine = (g: Loose) => { const r = g.registry_attest; return r ? `<div class="meta">Registry attestation: precondition ${esc(r.precondition)}, ${esc(r.status)}${r.question ? ` (${qlink(r.question, r.answer ? `answered “${r.answer}”` : 'the question')})` : ''}</div>` : ''; };
export const planningFor = (g: Loose) => ((shell.DATA as Loose)?.planners || []).filter((p: Loose) => p.goals.includes(g.id));
export const ago = (m: Loose) => (m == null ? 'no activity yet' : m < 1 ? 'active just now' : m < 60 ? `active ${m} min ago` : `active ${Math.round(m / 60)} h ago`);
// The Board's planner cards (kit-91): a div[role=button] (a button can't hold the question link) opening the
// planner's peek (data-open: the record cards' one click and Enter handlers, which leave a link inside it to
// itself); a flex column of its head, its line, its badges as pills and, when it needs attention, the attention
// row at the bottom. .stuck (waiting, or no window) and .blocked (held by a question) outline it in red.
export function plannerCards(ps: Loose) {
  return ps.map((p: Loose) => {
    const waits = p.waiting_on_owner || [];
    const pills = [
      ...(p.waiting ? [[p.waiting.kind === 'limit' ? 'usage limit' : 'waiting on a prompt', 'high', p.waiting.line]] : []),
      ...(!p.window ? [['window gone', 'medium']] : []),
      ...((p.waiting_on_supervisor || []).length ? [['waiting for the supervisor', 'low']] : []),
      ...(waits.length ? [[`waiting for ${waits.length} answer${waits.length > 1 ? 's' : ''} from you`, 'medium']] : []),
    ];
    return `<div class="plcard${p.waiting || !p.window ? ' stuck' : ''}${p.held_by ? ' blocked' : ''}" role="button" tabindex="0" data-planner="${esc(p.feature)}" data-open="planner/${esc(encodeURIComponent(p.feature))}" aria-label="Open the planner for ${esc(p.title)}"${subj('planner', p.feature, `Planning ${p.title}`)}>
    <div class="pl-head"><i class="icon-bot" aria-hidden="true"></i> <b>Planning ${esc(p.title)}</b></div>
    <div class="muted">${p.goals.length ? `for ${p.goals.map((gid: Loose) => esc(((shell.DATA as Loose).ooda.goals.find((g: Loose) => g.id === gid) || {}).title || gid)).join(', ')} · ` : ''}${p.tickets ? `${p.tickets} ticket${p.tickets > 1 ? 's' : ''} so far · ` : ''}${esc(ago(p.minutes_silent))}</div>
    ${pillsOf(pills)}${needsAttention(p) ? `<div class="att">${attLine(p)}</div>` : ''}
  </div>`;
  }).join('');
}
