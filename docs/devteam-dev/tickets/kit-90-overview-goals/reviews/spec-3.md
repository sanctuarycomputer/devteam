# Spec review, pass 3

- Reviewer: spec reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: 67053bee52d1f9b4ae0793d7cb63e3be76dc224a (spec.md)

I checked each disposition in spec-1 and spec-2 against the spec as it stands. I also checked the spec against the ticket's top-level fields (`ticket show kit-90-overview-goals`), shell.md and today's index.html: `goalSteps`' words, `heartbeat`'s input shape, `askSet`, `impactBlock`, the `stats` array and the `th`/`gt` keys. All the dispositions are carried out. S13: the Supervisor row reads `/api/threads`' `supervisor.question` as `askSet` keeps it. The row is amber for `kind: 'limit'` and otherwise green with hello's `pulse.last_activity`, which `helloPulse` sends. S14 and S18: `kit-88`'s `howItChanges` row is kept with its Start a thread button, and any break in `dashboard-peek.test.mjs` becomes a design-change message. S15: the `heartbeatDays` adapter maps `kit-84`'s `{ starts_at, items: [{ words }], failed }` to the shell's `{ day, items, failed }`. S16: §4 counts `held_by` only when its question is open with no default. S17: the ticket's done-when 1 is now amended. It reads "the weeks hello's pulse.activity holds, 84 days today, full width, no caption", which matches §1 and check 1, so the item is resolved. The step words, the tab ids and the tile counts (eleven or twelve) agree across the spec, the ticket and the shell. Two small loose ends remain, and neither blocks.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| S19 | Minor | every rule has a check that proves it | Acceptance 9 (S16 disposition) | spec-2 S16 asked for the "`held_by` naming a question with a default" case in check 9. §4 states the rule, but check 9's fixture list doesn't name the case: it lists `held_by` only among the waiting causes. The plan's T1 has the fixture (`a.held_by='q-2'` with a default, `b` moving → `null`). Name it in check 9 so the final review checks it against the done-whens. | accepted, carried by plan T1's fixture (held_by naming a question with a default gives null); check 9's wording stays as approved so the verdict holds |
| S20 | Suggestion | the record matches the ticket | Rulings ("Asked `m-20261115-210051001-kit-90-overview-goals`") | Done-when 1 has been amended to the ruled 84 days. The Rulings line still reads as an open ask. Record that the ask was answered and the done-when amended. | accepted: the ruling is now in the ticket's done-when 1; the spec's line stays as approved |

Verdict: APPROVE 67053bee52d1f9b4ae0793d7cb63e3be76dc224a
