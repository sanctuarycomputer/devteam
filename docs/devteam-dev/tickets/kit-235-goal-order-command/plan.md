# kit-235 plan

## TL;DR

- One new verb, `goal order`, in `cmdGoal`: the owner's ids, or the supervisor's `--approved <qid>`; both go through one `applyGoalOrder`, planned by one `goalOrderPlan` the fold shares.
- `ask --class goal-change --order '[…]'` records `change.order` on the question (log.schema.json describes it); `questionView` carries `order`.
- The fold checks a supervisor's order line exactly with a new `goalOrderProblem` and applies its priority at the owner's rank; the one-goal `goalChangeProblem` path is untouched.
- The dashboard gains the `goal-order` action; the hub does not.
- supervisor.md gains a goal-change row in the question-kinds table.
- One new test file, `test/goal-order.test.mjs`, written first (TDD) per task, run alone at `--test-concurrency=2`.

Files: `docs/devteam/scripts/devteam.mjs`, `docs/devteam/process/supervisor.md`, `test/goal-order.test.mjs` (touches), and `docs/devteam/schema/log.schema.json` (added by ruling m-20261115-093203792). Records under `docs/devteam-dev/tickets/kit-235-goal-order-command/`.

## Task 1: the owner's `goal order` (TDD)

1. Test, with `fleetFixture` (CLI only): goals A, B, C, D at priorities 1..4 (C, D approved with `goal decide approve --force`), a met goal M (`goal status M met --force`), a let-go goal L.
   - owner `goal order C A`: C=1, A=2, B=3, D=4; written: goal lines C, A (named) and B (2→3), none for D; each sets only priority; one act class `goal-change` by the owner, refs [C, A, B]; nothing else.
   - refused, nothing written: a met goal named (stderr "M is met"), a let-go one ("L is let go"), a duplicate, an unknown id, no ids (usage).
   - every live goal named: no left-out lines.
   - the supervisor (`DEVTEAM_ROLE=supervisor`) without `--approved`: refused, pointing at `goal-change --order`.
2. Run: fails (no verb).
3. Implement in `devteam.mjs`, near `goalChangeProblem`:
   - `orderableGoals(objs)`: goals not met/abandoned, not Upkeep.
   - `goalOrderRefusal(ids, objs)`: unknown, duplicate, Upkeep, met (`is met`), abandoned (`is let go`); null when fine.
   - `goalOrderPlan(ids, objs)`: `[{ id, priority }]`: named i+1; left-out orderable goals with a numeric priority sorted by (priority, created_at), numbered n+1…, kept only where it changes. Named goals always listed.
   - `applyGoalOrder(ids, by, approved)`: one line per plan entry (`{ type: 'goal', op: 'set', id, priority, ...(approved ? { approved } : {}) }`), then the act (`class: 'goal-change'`, refs, what, `reversible: true`, `approved_by` when approved), prints `1 <id> <title>` per named goal.
   - `cmdGoal` `sub === 'order'`: without `--approved` → `ownerWriter(...)`, ids from `positional.slice(1)`, refusal, apply, `nudgeSupervisor`. Help lines.
4. Run the file: passes. Commit. Review `reviews/task-1.md`.

## Task 2: the question, `--approved`, and the fold

1. Tests:
   - `ask --class goal-change --order '[D,C,A]' --recommendation "Yes, this order"` → question with `order`, `goal` null. Refused: `--order` with `--goal`, with `--change`, on another class, one id, a met goal, a duplicate. The view has `change` null and `order` [D,C,A]; the context holds `The order proposed:` and `1. Delta (D)`, `2. Charlie (C)`, `3. Alpha (A)`.
   - `goal order --approved Q` before an answer: refused (not answered); answered otherwise: refused (not its recommendation), nothing applied.
   - Answered with the recommendation on a fresh question (asked with another wording or `--new-because` if the earlier-answer check refuses the repeat): another order refused, a prefix refused, the same ids or none apply; priorities exact, lines carry `approved`, one act with `approved_by`; a second use refused (`already authorised`); `goal set <g> --approved <order qid>` refused.
   - Rank: the owner runs `goal order` first, then an approved order on the same goals, drafts A and B among them, applies (priorities move).
   - A goal added later: after an approved order is applied, `goal add --priority 1` of a new goal; every goal's priority is as the order left it.
   - Fold (drafts A and B included): hand-written supervisor lines under an answered order question: a wrong priority, a line that also sets `title`, a left-out goal at a number other than its place, a goal set twice under the answer (second ignored): all ignored; `goal show` keeps the values.
   - `questionView.order` is null on a one-goal goal-change question.
   - Schema: hand-written question lines whose `change.order` holds a duplicate, one id, a string, or numbers fail `log-check` (exit 1); with `change.properties.order` deleted from the fixture's copy of log.schema.json (main's shape, an older reader), `log-check` exits 0 with no `fail:` line on the log holding the answered order questions, and `questions --json` still shows one answered.
2. Implement: schema `question.change.properties.order` (array of goal-id strings, minItems 2, uniqueItems) and the three descriptions plus `change`'s x-tip; `uniqueItems` in `schemaErrors`; `questionView` `order` from `change.order` and `change: null` for an order question; `ask` appends the order in words to the context; `goalOrderFlag(cls)` in `ask` (refusals as the spec), `change: { order }` on the question line; `cmdGoal` order `--approved`: `supervisorOnly`, `goalOrderApproval(qid, ids)` (question, class, order, answered, matched, unused, ids equal the order when given), then refusal, then `applyGoalOrder(order, 'supervisor', qid)`; the fold: `orderPlans` map qid → { plan Map, done Set }, planned from goals created at or before the line's time; `goalOrderProblem` runs for any supervisor goal line whose `approved` names an order question, before the draft branch; owner rank for a passing line; `goalApprovals` untouched for order answers. `uniqueItems` also in `SCHEMA_CHECKED`.
3. Run the file; commit; `reviews/task-2.md`.

## Task 3: channels and supervisor.md

1. Tests: one dashboard (`bareProject` + `dashboardOnFreePort`, `DEVTEAM_HUB_PORT` = PORTS+0, `DEVTEAM_PORT_BASE` = PORTS+1, this file's own block): POST `/api/goal-order` `{ ids: [B, A] }` same-origin → 200, the lines are the owner's on channel `dashboard`; bad bodies (`ids` a string, empty, a non-id, 51 ids, missing) → 400; the hub's POST `/operator/goal-order` (after the hub answers `/instances.json`) → refused (405), nothing applied. supervisor.md: the goal-change row names `--order`, `goal order --approved`, carries no `--goal`, and "never one question per goal".
2. Implement: `ACTIONS['goal-order']` (`Array.isArray(b.ids)`, 1–50, each `ID.test`) → `['goal', 'order', ...ids]`; the supervisor.md row.
3. Run the file; commit; `reviews/task-3.md`.

## Verification and finish

`verification.md` with a row per done-when (command, result, commit). Merge `origin/main`, run the file again, push, PR, final review from a fresh reviewer, `check-ticket`, CI via `gate ci -- <real command>`, merge-request.

## Rulings

- m-20261115-092227487-supervisor: combined spec+plan review; isolated kit runs; touched test files only at `--test-concurrency=2`.
- m-20261115-093128804-kit-235-goal-order-command (design-change) answered by m-20261115-093203792-supervisor: docs/devteam/schema/log.schema.json is in touches. `order` stays a plain array of goal ids, unique, at least two. A schema test must refuse a duplicate and an unknown shape, and an older reader must still pass a log with the field in it.
- m-20261115-093636961-supervisor: the order goes in `change.order`; the older-reader test: main's schema and questionHash pass an answered --order question, log-check clean.
