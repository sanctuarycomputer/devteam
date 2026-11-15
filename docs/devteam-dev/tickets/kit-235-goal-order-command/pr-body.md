## Summary

Ordering the goals is now one step. Before this, a supervisor needed six goal-change questions to put the owner's priorities in order, because `goal set --approved` takes one goal per answer. Priority stays the owner's.

- **`goal order <g-id> <g-id> …` (the owner).** The goals named get priorities 1..n. The live goals left out keep their order after them, with ties going by when each was made; a goal with no priority keeps none. There is one goal line per goal named and per goal left out whose priority moves, plus one `goal-order` act. That act is a new owner-only record in `OWNER_ACTS`, never a call. A met or let-go goal, Upkeep, a duplicate or an unknown id is refused, and nothing is written. Agent sessions are refused.
- **One question for a whole order.** `ask --class goal-change --order '["g-…",…]' --recommendation …` records `change.order` with no `--goal`. The kit writes the order, with each goal's title, into the question's hashed context. The question's view has `order`, and `change: null` so the Inbox card doesn't read "Approving sets on <goal>". `goal order [ids] --approved <qid>` applies exactly the proposed order, once, after the owner answers with the recommendation. Any other order, a prefix, another answer, or a reuse is refused.
- **The owner's Yes is to what they read.** An order counts only when the question's context ends with the kit's list and that list is exactly `change.order`. `goal order --approved`, the fold and log-check all check this. An answer is used once its act is written.
- **The fold holds the supervisor to the answer.** On any goal, drafts included, a supervisor's line under an order answer counts only when it sets priority to that goal's exact place. The place comes from one plan per answer, made from the goals that existed at the answer's first line, and each goal counts once. That priority applies at the owner's rank, so an earlier priority the owner set can't silently beat the order they approved. The line's `approved` keeps the supervisor's rank. The one-goal `goalChangeProblem` path is unchanged.
- **Schema.** `question.change.properties.order` is a unique list of goal ids, at least two. `schemaErrors` and `SCHEMA_CHECKED` learn `uniqueItems`, and the prose for `goal.approved`, `act` and the top-level rule is updated. An older kit keeps `change` whole (it is any object there), so an answered order question still passes its log-check.
- **Channels.** The dashboard gains the `goal-order` action `{ids}` for kit-234; it takes only ids, 1 to 50. The hub doesn't have the action (405).
- **supervisor.md** gains the `--class goal-change` row: one `--order` question to reorder several goals, never one question per goal.
- `test/lib/chain.mjs`: a one-line regex update for `integrity()`'s owner-acts message (ruling m-20261115-094950293).

## How to verify

`node --test --test-concurrency=2 test/goal-order.test.mjs` (7 tests, about 45 s, one real dashboard). Run against the kit from before this change, the file failed all 6 tests it then held.

Records: `docs/devteam-dev/tickets/kit-235-goal-order-command/` (spec, plan, reviews, verification). Rulings: m-20261115-092227487, m-20261115-093203792, m-20261115-093636961, m-20261115-094155181, m-20261115-094950293.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
