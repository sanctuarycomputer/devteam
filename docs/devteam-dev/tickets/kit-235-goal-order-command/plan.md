# kit-235 plan

## TL;DR

- One new verb, `goal order`, in `cmdGoal`: the owner's ids, or the supervisor's `--approved <qid>`; both go through one `applyGoalOrder`.
- `ask --class goal-change --order '[…]'` records `order` on the question; `questionView` carries it.
- The fold checks a supervisor's order line with a new `goalOrderProblem`; the one-goal `goalChangeProblem` path is untouched.
- The dashboard gains the `goal-order` action; the hub does not.
- supervisor.md gains a goal-change row in the question-kinds table.
- One new test file, `test/goal-order.test.mjs`, written first (TDD), run alone at `--test-concurrency=2`.

Files (all inside `touches`): `docs/devteam/scripts/devteam.mjs`, `docs/devteam/process/supervisor.md`, `test/goal-order.test.mjs`. Records under `docs/devteam-dev/tickets/kit-235-goal-order-command/`.

## Task 1: the owner's `goal order` and the fold (TDD)

1. Write `test/goal-order.test.mjs` with `fleetFixture` (CLI only): goals A, B, C, D (C, D ready via `goal decide approve --force`), priorities 1..4; a met goal M (owner `goal status M met --force` or via the log as goal-met.test does) and a let-go goal L.
   - owner `goal order C A`: C=1, A=2, B=3, D=4; lines: one per named goal (2) and one per left-out goal whose priority changed (B 2→3, D stays 4: none) → 3 goal lines with priority, 1 act class `goal-order` by owner.
   - owner `goal order A M` → exit 1, stderr names M "is met", nothing written (line count unchanged); same for L "is let go"; unknown id and a duplicate refused.
   - supervisor (`DEVTEAM_ROLE=supervisor`) `goal order A B` → refused.
2. Run it: fails (no verb).
3. Implement in `devteam.mjs`:
   - `liveGoalsForOrder()` and `goalOrderRefusal(ids)` (unknown, duplicate, Upkeep, met, abandoned) near `goalChangeProblem`.
   - `goalOrderPlan(ids)`: `[{ id, priority }]` for the named goals, then left-out live goals with a numeric priority sorted by (priority, created_at), numbered n+1…, kept only where it changes.
   - `applyGoalOrder(ids, by, approved)`: appends the lines (`{ type: 'goal', op: 'set', id, priority, ...(approved ? { approved } : {}) }`), then the act (`class: 'goal-order'`, `refs`, `what`, `reversible: true`, `approved_by` when approved), prints the order.
   - `cmdGoal` `sub === 'order'`: no `--approved` → `ownerWriter('the supervisor asks one goal-change --order question, then goal order --approved <qid>')`, ids from `positional.slice(1)`.
   - Fold: before the existing supervisor check at the goal-past-draft branch, when `l.approved` names a question with an `order`, use `goalOrderProblem(q, obj.id, l, seen)` and skip `goalApprovals`; keep a `orderApprovals` map qid → Set of goal ids applied.
   - `questionView`: `order: q.order ?? null`.
   - Help lines for `goal order`.
4. Run the file: passes. Commit. Review `reviews/task-1.md`.

## Task 2: the question and the supervisor's `--approved`

1. Tests: `ask --class goal-change --order '["C","A","B"]' --recommendation "Yes, this order" --stake 2 --urgency 1` → question with `order`, no `goal`; `--order` with `--goal`, with `--change`, on another class, with one id, with a met goal → refused. Owner answers something else → `goal order --approved Q` refused (not its recommendation). New question answered with the recommendation (`answer Q "Yes, this order"` as owner) → `goal order --approved Q` applies exactly (priorities checked); `goal order --approved Q B A C` (another order) on a fresh answered question refused, and the same ids as proposed accepted; second use of Q refused. Hand-written supervisor line with `approved: Q` and a wrong priority → ignored by the fold (`goal show` keeps the old priority). One-goal path: `ask --class goal-change --goal D --change '{"priority":9}'`, answered, `goal set D --approved` applies; again → refused with today's message.
2. Implement: `ask` reads `--order` (`goalOrderFlag(cls)`), refusing as the spec says; adds `order` to the question line. `cmdGoal` order with `--approved`: `supervisorOnly('goal order --approved')`, `goalOrderApproval(qid, ids)` checks (question, class, order, answered, matched, unused, ids equal), then `goalOrderRefusal(order)` and `applyGoalOrder(order, 'supervisor', qid)`.
3. Run the file; commit; `reviews/task-2.md`.

## Task 3: channels and supervisor.md

1. Tests (one dashboard, `bareProject` + `dashboardOnFreePort`, env with `DEVTEAM_HUB_PORT` and `DEVTEAM_PORT_BASE` from `PORTS` offsets unused by other files, `DEVTEAM_*` unset): POST `/api/goal-order` with Origin/sec-fetch-site same-origin and `{ ids: [B, A] }` → 200, and the log's goal lines carry `channel: 'dashboard'`; a bad body (`{ ids: 'x' }`) → 400; POST to the hub's `/operator/goal-order` → refused (405), after waiting for the hub to answer `/instances.json`. supervisor.md: the test reads the file and matches the goal-change row's `--order` sentence.
2. Implement: `ACTIONS['goal-order']` in the dashboard; the supervisor.md row.
3. Run the file; commit; `reviews/task-3.md`.

## Verification and finish

`verification.md` with a row per done-when (command, result, commit). Merge `origin/main`, run the file again, push, PR, final review from a fresh reviewer, `check-ticket`, CI via `gate ci -- <real command>` (memory), merge-request.

## Rulings

- m-20261115-092227487-supervisor: combined spec+plan review; isolated kit runs; touched test files only at `--test-concurrency=2`.
