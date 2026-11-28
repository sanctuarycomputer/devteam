// kit-992: goals's goal-block of index.html (goalBlock, how blocked a goal is, and heartbeatDays, Upkeep's days as
// the shell's heartbeat takes them), as index.html has it, with types. It uses nothing but its arguments: no
// imports and no DOM at import, so it compiles to lib-dist/lib/goals-block.js and a test imports it on Node.
// `Loose` is `any`: /api/data's goals, tickets, planners and questions have no fixed shape in index.html.
type Loose = any;

/* goal-block start */
// How blocked a goal is: 'full' when every piece of its work waits on the owner (an open question with
// no default, a hold, a blocked phase, or a planner waiting for a word), 'partial' when some does, null
// otherwise. Uses nothing but its arguments.
export function goalBlock(goal: Loose, data: Loose) {
  if (!goal || goal.status === 'met' || goal.status === 'abandoned') return null;
  // a let-go hold exists only on an abandoned goal (holdMode), already returned above
  if (goal.hold_view && goal.hold_view.mode === 'park') return null;
  const feats = new Set((((data.ooda || {}).roadmap || {}).goals || []).filter((g: Loose) => g.id === goal.id).flatMap((g: Loose) => g.features || []));
  const live = (data.tickets || []).filter((t: Loose) => feats.has(t.feature) && !['merged', 'released', 'superseded'].includes(t.stage));
  const planners = (data.planners || []).filter((p: Loose) => (p.goals || []).includes(goal.id));
  const asks = (data.questions || []).filter((q: Loose) => q.status === 'open' && q.default == null);
  const askIds = new Set(asks.map((q: Loose) => q.id));
  const named = new Set(asks.flatMap((q: Loose) => [...(q.blocks || []), ...(q.ticket ? [q.ticket] : [])]));
  const stuck = new Set(live.filter((t: Loose) => askIds.has(t.held_by) || t.held || t.phase === 'blocked' || named.has(t.id)).map((t: Loose) => t.id));
  for (let grew = true; grew;) {
    grew = false;
    for (const t of live) if (!stuck.has(t.id) && (t.depends_on || []).some((d: Loose) => stuck.has(d))) { stuck.add(t.id); grew = true; }
  }
  const waiting = planners.filter((p: Loose) => p.waiting && p.waiting.kind !== 'limit').length;
  const total = live.length + planners.length;
  const n = stuck.size + waiting;
  return !total || !n ? null : n === total ? 'full' : 'partial';
}
// Upkeep's days (kit-84: { starts_at, items: [{ kind, ref, words, at }], failed }) as the shell's
// heartbeat takes them: { day: 'YYYY-MM-DD', items: [words], failed }.
export function heartbeatDays(days: Loose) {
  return (Array.isArray(days) ? days : []).map((d: Loose) => ({ day: String(d?.starts_at ?? '').slice(0, 10), items: (Array.isArray(d?.items) ? d.items : []).map((i: Loose) => String(i?.words ?? '')), failed: !!d?.failed }));
}
/* goal-block end */
