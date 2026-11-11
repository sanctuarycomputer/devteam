# Plan: a goal at its target closes through the Inbox

Spec: `docs/superpowers/specs/2026-11-11-goal-at-target-design.md`. One PR, kit only.

## Kit (`docs/devteam/scripts/devteam.mjs`)

1. Near `goalReadings`: `goalMetBasis(g)` (sha256 of canonical `{title, measure, milestones}`, 16 hex), `goalAtTarget(g)` (ready, numeric target, latest counted reading reaches the target, milestones all reached or only the last left; returns the reading or null), `goalMetWording(g, reading)` (the question text) and `GOAL_MET_CHOICES`.
2. `goalMetProblem`: also refuse when the question carries `met` and its basis isn't the goal's now. `goalReadings`: an owner line citing a question counts it as used.
3. `askLine`: `--question` optional for `goal-met`; the goal-met block takes every source, enforces the refusals in the spec, writes the kit's question, choices, `met`, and the reading into the context.
4. `questionView`: expose `met`.
5. `cmdAnswer`: before writing, `goalMetPlan(v, answer)` decides whether to apply and runs a repo/prod check (dies before writing on a failed check). After the answer line: the reading, then `status: met` when reached; output and the supervisor's nudge say what happened.
6. `goal status met`: a prod goal's check runs again, like repo.
7. `goalView`: `at_target`.
8. `collectMetrics`: the `goal-at-target` finding (medium), suppressed by an open goal-met question, or one the owner answered after the reading.
9. Dashboard server `ACTIONS`: `goal-met` → `goal status <id> met`.
10. Usage text for `ask` and `goal reading`.

## Schema (`docs/devteam/schema/log.schema.json`)

`question.met`: `{ basis: 16 hex, reading: null | { id, value, unit?, at, sha? } }`, no other properties.

## Dashboard (`docs/devteam/dashboard/index.html`)

`goalStateOf`: a ready goal with `at_target` gets a "Reached its target" label and line. `goalCard`: a Mark met button (confirm in place) posting `goal-met`; the click handler next to the hold one.

## Docs

`planning.md` §1: owner source paragraph, the readings paragraph, the "Readings" paragraph. `supervisor.md`: the goal-met table row and a sentence in "Ask everything that is the owner's".

## Tests

New `test/goal-met.test.mjs` (fleetFixture):
- repo goal at target: finding shown; ask works with the kit's wording and reading in context; refusals (default, --choices, recommendation no, second open, not ready, not at target); yes sets met after re-reading main; finding gone.
- repo goal whose check changes after the ask to read below target: yes records the answer and the new reading, stays ready.
- prod goal: yes re-runs the prod check and sets met.
- owner goal: yes writes an owner reading and met; No leaves ready.
- binding: a goal-change of the measure after the ask, then yes: not applied. A hand-written question line (other words / recommendation No) with class goal-met: not applied.
- a supervisor-written `goal set status met` line is ignored by the fold; a forged prod reading only raises the finding, and the yes goes by the check.
- legacy goal-met question with no `met`: answer sets nothing.
- `goal status met` on a prod goal re-reads.
`test/dashboard.test.mjs`: the `goal-met` action reaches `goal status` and the card renders Mark met for an at-target goal.

Run kit.test.mjs, dashboard.test.mjs, approvals.test.mjs, goal-met.test.mjs on Node 24 with a private TMUX_TMPDIR.
