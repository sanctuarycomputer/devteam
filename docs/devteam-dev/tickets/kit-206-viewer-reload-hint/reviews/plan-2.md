# Plan review, pass 2

- Reviewer: plan-reviewer 2 (fresh subagent, claude-opus)
- Reviewed: dd5aad7f6ba02460be9c8c624223804b7538e93b (plan.md)

**What I read.** At dd5aad7: the plan, the spec (approved at 9d399ce), plan-1, the ticket, and quality.md §3 and §6. In `index.html`: `TS`, `tsSet` and `showArtifact` (~3543-3575), `openArtifact`, `closeArtifact` and the `#av-reload` handler (~3638-3670), `route` (~3685) and its callers, `drawOrHold` and `loadNow` (~5253-5325), `tlRefresh` and every place that calls it, and `viewerArtifact` and `viewerBoot` (~5644-5695). In the tests, `COUNT_FETCH`. In the log, m-20261115-013720113-supervisor, which answers m-20261115-013705816-kit-206-viewer-reload-hint.

**Plan-1 dispositions.** All six hold.
- **P1 holds.** Task 2 Step 3 puts the view poll after `await tlRefresh()`, next to the 5 s threads interval, so both timers start together; Step 1 waits for four `/api/threads` asks before asserting a single `/api/view?`. In a viewer tab, `/api/threads` is asked only by boot and the 5 s tick; every other caller of `tlRefresh` (4763, 4831, 4874, 4942, 5065, 5276) runs only when a card is open, an answer is sent or the dashboard draws, none of which happens in this subtest. So the fourth ask (the 15 s tick) comes after the 10 s view tick, and a missing `tree:` guard would put a second `/api/view?` in the list.
- **P2 holds.** On a re-show, `fp`/`mainFp` are kept and the new values go only into `fpNow`/`mainFpNow` (see S1).
- **P3 holds.** There is a risk bullet, and the TL;DR has exactly seven bullets.
- **P4 holds.** The ruling is in the log and quoted in the plan.
- **P5 holds.** (a), (b) and (c) are all in Task 1 Step 1.
- **P6 holds.** The CSS uses `:not(:focus-visible)`.

**New issues from the fixes.** Only S1. The re-show branch in `openArtifact` can almost never run: `route` calls `openArtifact` only on the first draw (while `DATA` is null) and on `hashchange`, which lands on the same `slug`/`at` only through an equivalent but differently encoded hash; the viewer calls `showArtifact` once.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| S1 | Suggestion | spec Edge cases ("A draft removed while open: the dashboard finds no row … neither changes the hint") | plan Task 1 Step 3 (P2 re-show and N2 fallback together); `index.html` `openArtifact` ~3647 | On a re-show, `openArtifact`'s N2 fallback gives main's fp for a draft whose row is missing, and P2 writes it into `fpNow`; for a draft removed while open the hint would then come on, though the spec says a missing row changes nothing. Practically unreachable, so acceptable as written; or apply the fallback only when the stage is new. | taken in the build: the fallback applies only when the stage is new (no change to the plan's interfaces) |

Verdict: APPROVE dd5aad7f6ba02460be9c8c624223804b7538e93b
