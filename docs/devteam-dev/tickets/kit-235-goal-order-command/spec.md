# kit-235: goal order in one step

Ticket `kit-235-goal-order-command` (feature dashboard-cleanup, serves DCL-S5, risk normal, size S).

## Why

A supervisor had to ask six goal-change questions to put the owner's priorities in order: `goal set --approved` takes one goal per answer. Reordering is one decision; it should be one owner command and, when the supervisor proposes it, one question. Priority stays owner-only: the supervisor applies only an order the owner approved.

## What changes

### 1. The owner's `goal order <g-id> <g-id> …`

- Owner only (`ownerWriter`): the owner's terminal or the dashboard. In an agent session (`DEVTEAM_ROLE` set, or the supervisor's pane) it is refused, as every owner command is.
- Names at least one goal; each id is a goal of this log, named once. A goal whose status is `met` or `abandoned` is refused with its status (`<id> is met`, `<id> is let go`); Upkeep is refused (it has no place in the order); an unknown id or a duplicate is refused. Nothing is written when any is refused.
- The named goals get priority 1..n in the order given. The live goals left out (status draft or ready, not Upkeep, with a numeric priority) keep their relative place after the named ones: priority n+1, n+2, … in their current order (by priority, then by when they were created). A left-out goal with no priority stays without one.
- One goal line (`op: set`, `priority`) per named goal, and one per left-out goal whose priority changes; then one act (`class: goal-change`, `refs` every goal written, `what` the order). goal-change is already an owner-only class in constitution.md, so no new class. For the owner the act is a record of what the owner did (`created_by: owner`), not a call.
- Prints the new order. The owner's order nudges the supervisor (`nudgeSupervisor`), as `goal decide` does.

### 2. One goal-change question that proposes a whole order

- `ask --class goal-change --order '["g-…","g-…",…]' --recommendation "…" …` records the order on the question as `change: { order: [...] }` (ruling m-20261115-093636961: in `change`, not a field of its own); no `--goal`, no `--change` (each refused alongside `--order`). The order must be a JSON array of at least two distinct goal ids, each live (the same refusals as §1). `--order` on any other class is refused. `order` is not a goal field (`GOAL_CHANGE_FIELDS`), so `--change '{"order":…}'` on a one-goal question stays refused.
- `questionView` carries `order` (`change.order`, null when none), so the Inbox, `questions --json` and the fold see it.
- The log schema's `question.change` gains `properties.order` (`{ type: array, items: a goal-id string, minItems: 2, uniqueItems: true }`; `change` stays an open object, so the one-goal fields still pass), and its prose is brought in line: `change` says it may carry an order instead of goal fields, `goal.approved` says an order answer authorises one set per goal it orders, and the top-level rule names the order question. The schema file was added to touches by ruling m-20261115-093203792. The kit's validator (`schemaErrors`) learns `uniqueItems` (and `SCHEMA_CHECKED`, the keywords review check accepts, lists it), so a duplicate is refused on write and in log-check.
- An older reader (main's schema, where `change` is any object, and the same `questionHash`) keeps `change` whole, so the question's hash agrees with the answer's and log-check passes on an answered order question. Its fold ignores the supervisor's order lines (its goalChangeProblem finds the question about no goal), with a reason, so a mixed fleet sees the new order only once upgraded; nothing wrong is applied. Said here, not defended.

### 3. The supervisor's `goal order --approved <qid> [<g-id> …]`

- Supervisor only (`supervisorOnly`). Applies the question's order exactly as §1 does (same lines, each with `approved: <qid>`, and the act with `approved_by: <qid>`, class `goal-change`).
- Refused unless: the question exists, is class goal-change and carries an order; it is answered by the owner; the answer is its recommendation (`matched`); the answer has not been used (no goal line with `approved: <qid>`, no act with `approved_by: <qid>`); any ids given equal the proposed order exactly (no ids applies the proposed order); and every goal in the order is still live.
- The supervisor without `--approved` is refused, pointing at `ask --class goal-change --order`.

### 4. The fold accepts order lines

A supervisor's line on a goal past draft is ignored today unless `goalChangeProblem` passes for its `approved` question, and `goalApprovals` lets one answer authorise one goal line. Any supervisor goal line whose `approved` names a question carrying an order, on a goal of any status (a draft included: today's draft branch skips every check, so the order check sits before it), is checked by a new `goalOrderProblem` instead: the question is a matched, answered goal-change question with an order; the line sets only `priority` (plus envelope and `approved`); the goal is live at that point in the fold; and its priority is exactly what the order plans for it. The plan is computed once per answer, when the fold meets its first line, from the goals as the fold holds them then: only goals created at or before that line's time (the fold makes every object before it applies any set, so a goal added later must not count), with the priorities and statuses the sets before it gave them, by the same `goalOrderPlan` the command uses (named goals index + 1; left-out live goals with a priority n+1… in their order), so a left-out goal's number is checked exactly too. Each goal is set at most once under that answer, and a goal the plan doesn't list is refused. `goalChangeProblem` and the one-goal path are unchanged for questions without an order.

Rank: the fold applies a set only if no higher-ranked writer set the field, and the owner outranks the supervisor. An order line that passes `goalOrderProblem` carries the owner's own answer, so its `priority` applies at the owner's rank; otherwise an owner's earlier priority (from `goal order`, the dashboard, or `goal set --owner`) would silently win over the order the owner later approved, while the answer counted as used. Draft or not, only order lines get this; the one-goal path keeps its rank as today (out of scope).

Not defended: a line written by another hand between the command's first and last line could change the fold's plan for the remaining lines; the command writes its lines in one run, so this needs a concurrent owner write in that window, and the result is lines ignored (never a wrong priority applied).

### 5. Channels

- The dashboard's ACTIONS gain `goal-order`: body `{ ids: [<g-id>…] }` (1 to 50 ids, each a log id) → `['goal', 'order', ...ids]`, run as the owner (channel `dashboard`). This is what kit-234 posts.
- The hub's `HUB_ACTIONS` do not gain it: the hub's `/operator/goal-order` is refused (405, as any non-action POST), and an `operator-thread` run is never given it.
- The supervisor channel (an agent session) is refused by `ownerWriter` (§1).

### 6. supervisor.md

A new row in the question-kinds table: `owner-decision`, `--class goal-change`: one goal's change with `--goal` and `--change`, applied with `goal set --approved`; to reorder several goals, one `--order` question (which carries no `--goal`: the order names its goals) applied with `goal order --approved`, never one question per goal.

## Acceptance checks (the done-whens)

1. `test/goal-order.test.mjs` passes in CI: the owner's `goal order A B C` sets priority 1..3 on A, B, C in that order, writing one goal line per named goal and one act; a left-out goal keeps its relative place after them (n+1…); a met or let-go goal named is refused with its status, and nothing is written.
2. Same test: `ask --class goal-change --order '[…]' --recommendation …` records the order on one question, without `--goal`; `goal order --approved <qid>` applies exactly that order once the owner answers its recommendation; a second use of the same answer, an answer that isn't the recommendation, and any order other than the one proposed are refused.
   Also: the owner orders goals first, then an approved order on the same goals applies (the rank case); a prefix of the proposed order is refused; hand-written supervisor lines under an order answer that set another field, set a goal twice, or give a left-out goal a priority other than its place are ignored.
3. Same test: the dashboard's `POST /api/goal-order` (owner channel) applies an order and the line says channel `dashboard`; `goal order` from the supervisor (DEVTEAM_ROLE=supervisor) is refused; the hub's `POST /operator/goal-order` is refused.
4. Same test: the one-goal path is unchanged: `ask --class goal-change --goal G --change '{"priority":…}'`, answered, then `goal set G --approved <qid>` applies, and a second `goal set` with it is refused (goalChangeProblem's messages as today); a hand-written supervisor goal line with an order question's `approved` but a wrong priority is ignored by the fold.
   Also: a hand-written question line whose `change.order` holds a duplicate, one id, or is not an array of goal ids fails log-check; with `change.properties.order` taken out of a copy of the schema (main's, an older reader), log-check passes with no fail on a log holding an answered order question, and the question still reads as answered.
   Also: a goal added with a priority after an approved order was applied leaves the applied priorities as they were; the rank and fold cases include a draft goal.
5. supervisor.md's goal-change row says to ask one `--order` question to reorder several goals, never one question per goal.

## Contracts

Provided: the `goal order` command (owner, and supervisor with `--approved`); the dashboard action `goal-order` `{ ids }` (consumed by kit-234); the question's `change.order` in log.schema.json. Consumed: none new.

## Edge cases

- An order naming every live goal: no left-out lines.
- A named goal already at its target priority: still gets its line (one per named goal, as the done-when says); a left-out goal already at its place gets none.
- Draft goals may be named and are renumbered like ready ones.
- A goal named in an approved order becomes met or let go before it is applied: refused with its status; the supervisor asks again.
- The dashboard's body with a non-array, an empty array, a non-id or more than 50 ids: 400.

## Out of scope

- Any dashboard UI to drag goals into order (kit-234 builds it on this action).
- Changing `goal set --approved` or how priority clashes are reported by `goal check`.

## Rulings

- m-20261115-092227487-supervisor: write spec and plan before the first review, one combined review (spec-1.md and plan-1.md from one fresh session), approve-spec and approve-plan asked together; any kit run outside tests gets its own HOME, a DEVTEAM_HUB_PORT away from 4320, its own port and DEVTEAM_* unset; on this box run only the touched test files at --test-concurrency=2.
- m-20261115-093128804-kit-235-goal-order-command (design-change) answered by m-20261115-093203792-supervisor: docs/devteam/schema/log.schema.json is in touches. `order` stays a plain array of goal ids, unique, at least two. A schema test must refuse a duplicate and an unknown shape, and an older reader must still pass a log with the field in it.
- m-20261115-093631314-kit-235-goal-order-command (design-change) answered by m-20261115-093636961-supervisor: carry the order as `change.order`, replacing the earlier ruling on where the field goes; keep the older-reader test in its new form: an older reader (the schema and questionHash as on main) passes an answered --order question, with log-check clean.
