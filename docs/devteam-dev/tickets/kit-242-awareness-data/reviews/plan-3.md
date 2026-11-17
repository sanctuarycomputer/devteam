# Plan review, pass 3

- Reviewer: plan-reviewer-3 (fresh subagent, claude-opus)
- Reviewed: 3048703438ae7e26109d08b38130e5c7d2a0ea47 (plan.md, diff since 5175887)

I checked each P2 fix against the diff and the code.
- **P2-1. Fixed.** The plan now names effFixture's own `hand` (`PREFIX { phase: 'h', spend: 's', … }`), `addTicket`, `phase`, `spend`, `merge`, `mergeAt` and the `eff` feature line, and it forbids wiring them to `handFor`. I checked this against `test/efficiency-data.test.mjs` lines 21–61. `shipped` calls `addTicket`, `mergeAt`, `phase`, `spend` and `merge`. `land` reads `merges`. `mergeAt` uses `thisMonday`, `span` and `weekStart`, and `hand` uses `stamp`, `line` and its counter `n`. The plan doesn't name these, but "together with what they use" covers them. `addTicket` needs the `eff` feature, and that feature's goal `g-20260101-000000000-supervisor` is already used by other fleetFixture-based tests, so the list is complete enough to build.
- **P2-2. Fixed.** Task 3's third fixture now says its lines are dated from now, gives the reason ("Fixed today" and "1 day ago" on a Monday run), and explains why the change is safe. This matches the spec deviation pass 2 raised.
- **P2-3. Fixed.** Review Focus 2 and Task 2 Step 3 now say that later citations come from `updates`, never from raw `set` lines, and that the kept `new` line is the one raw read. This matches the algorithm after P1-6.

The fixes add no blocking defect.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P3-1 | Nit | worker.md §4 (clear as written) | Fixture › Efficiency weeks, "…dropped (P2-1). three tickets shipped…" | The fix left the sentence after it starting with a lowercase "three". Also, the awareness fixture's own `hand` (from `handFor`) and effFixture's `hand` share a name, so the copy needs one of them renamed (for example `effHand`). A worker will see the clash, so this doesn't block. | wont-fix a nit; the build names the effFixture writer effHand when it copies it |

Verdict: APPROVE 3048703438ae7e26109d08b38130e5c7d2a0ea47
