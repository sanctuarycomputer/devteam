# Plan review, pass 2

- Reviewer: plan-reviewer-2 (fresh subagent, claude-opus)
- Reviewed: 5175887c0655aebbb5505d26b86fb1a4283ae5ff (plan.md, diff since e35c56e)

I checked each P1 fix against the code and recomputed the parts that changed.
- **P1-1.** `orient-noise` is in constitution.md's `constitutional` list, so `decisionAuthorityGap` returns null for `authority: 'constitution'`, and the rulings are live.
- **P1-2.** `x-authority.set.problem.supervisor` includes `refs`, and the fold applies a supervisor set on a supervisor-made problem. A problem with no fingerprints isn't `isIncident`, so it doesn't touch the incidents part.
- **P1-3.** sA lands at E(6) − 28 d = E(2) exactly. That gives week 2 lessons 1 of 2, starts 2 of 2 and score 75; week 3 lessons 2 of 2, starts 1 of 1 and score 100; and week 6 lessons 1 of 2, with sA excluded.
- **P1-4.** `x-id.prefix.problem` is `p`.
- **P1-5.** sig:g is live until the owner's `corrected` (`correctionOf`). Without the correction it counts, so the case now guards the rule.
- **P1-6.** The fold keeps the first `new` line and records only applied sets in `updates`, so the walk is well defined. sig:q flips under creation-time dating: it counts at F + 1 h, which would give 9 of 15.

**Week 8.** 15 signals are in `of` (j0 to j13 and sig:n; sig:l falls in the last day and sig:solo never forms). 8 are counted: a, c, d, e (F + 2 h, through the problem's update), f, h2, i and n. 8/15 rounds to 0.53, and round(100 × (0.533 + 0.5 + 0) / 3) = 34.

**`ooda.debt.signals` at now.** sig:g's decision is corrected, so it isn't live and nothing links item 1. sig:h and sig:h2 have `refs: []`. sig:k's ruling has no `o-` ref, so `explained()` skips it. sig:m's ruling comes before every sighting. sig:l has nothing. sig:q's current `refs: [item 1]` leaves it 2 items, under 3. The order by `first_at` (F_j − 2 h, then E(8) − 20 h) is g, h, h2, k, m, l, and the suggestions are incF, lessons (2 of 3 unused), then g, h and h2.

**The second fixture.** It has 4 lessons, 3 given. One unused is ≥ ¼ × 4, so the suggestion appears, and with > it drops. The words "the lesson", "4 lessons" and "3 of 4 → 3 of 3 once it is retired" match the spec.

**The third fixture.** One of 5 unused is under a quarter, so there is no lessons suggestion. incY's days are floor(36 h / 24 h) = 1, so it reads "1 day ago". incT's are 0, so it reads "Fixed today". The order is oldest resolution first. dup:z, then dup/z, then quiet:x are oldest `first_at` first. quiet:x is 30 h old, so it is listed, and d = 1. Its empty detail passes the schema (no minLength) and gives the "(3 times)" text. The ids are `aw-signal-dup-z`, `-2` and `aw-signal-quiet-x`, five in all, so nothing is cut.

**What G1 holds.** I checked it against `g1Outputs` and the current golden. The log has one accepted owner fact. slow:g1's three sightings come from two writers, formed just now and unexplained, and note:g1 has one. There are no starts, no incidents and no corrections. Efficiency is null in every week. So the plan's listing is right. That is: signals 0 of 0 (formed in the last day), lessons 0 of 1, score 0, one `aw-lessons-unused` suggestion in the singular ("1 of 1 lesson"), an all-null `autonomy_score`, and `starts_at` stripped by `TIMEY`.

No fix introduces a blocking defect. The remaining points are minor.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P2-1 | Minor | worker.md §4 (buildable as written); P1-4's second half | Fixture › Efficiency weeks, "copy `effFixture`'s `shipped` and `land`" | P1-4 also asked the plan to say which helper writes efficiency's `phase` and `spend` lines, and the fix added only `problem: 'p'`. `shipped` calls effFixture's own `hand` (PREFIX `{ phase: 'h', spend: 's', … }`) through `phase` and `spend`, and also needs `addTicket`, `merge` and `mergeAt`. A worker who wires `shipped` to the copied `handFor` writes `undefined-…` ids, and `readLog` drops them. Efficiency in weeks 0 and 7 then reads null, and the hand-written 83 fails. Name effFixture's `hand` (or add `phase: 'h', spend: 's'` to the copied map) and the helpers to copy with it. | fixed |
| P2-2 | Minor | spec › Acceptance checks preamble ("The lines are dated from this Monday `M`, never from now") | Task 3, third fixture (incY at now − 36 h, incT at now − 1 h, quiet:x at now − 30 h; the start "2 days ago") | These lines are dated from now, which goes against the spec's stated test rule. It is safe here: suggestions read only E = now, the word checks need fixed offsets from now, and every line is in the past. But the plan neither notes the deviation nor gives its reason, so a task reviewer could flag it, or a worker could "fix" it to M-dating and break "Fixed today" and "1 day ago" on a Monday run. State the exception and why. | fixed |
| P2-3 | Minor | worker.md §4 (unambiguous) | Review Focus 2 and Task 2 Step 3 ("never from raw lines") against the Task 2 algorithm (the new line "from the log's first `op: 'new'` line") | After P1-6 the algorithm reads one raw line (the kept `new` line, under the cut inside `withLogAt`). Review Focus 2 and Step 3 still say never to read raw lines. Reword them to say that updates come from `obj.updates`, never from raw `set` lines, and that the creation entry is the fold's kept `new` line, in the fold's order. | fixed |

Verdict: APPROVE 5175887c0655aebbb5505d26b86fb1a4283ae5ff
