# Plan review, pass 1

- Reviewer: plan-reviewer (fresh subagent, claude-opus)
- Reviewed: 34ee7d3a4a92f707d3ba4ae86c8a869537d6bd50 (plan.md)

**What I read.** At 34ee7d3: the plan, the spec, spec-1 and spec-2, the ticket, and quality.md §3 and §6; in `index.html` the tokens (~30-45), the viewer CSS (~516-540), `#av-reload` (~779, ~3669), `TS`/`tsSet`/`showArtifact` (~3543-3575), `openArtifact`/`route` (~3638, ~3685), the frame `load` and lens `message` handlers (~5171-5200), `drawOrHold`/`load`/`loadNow` (~5253-5330) and `viewerArtifact`/`viewerBoot` (~5644-5695); in `devteam.mjs` `ARTIFACT_LENS` (`ready` only in answer to `hello`, carrying `document.title`), `draftWorktree`/`draftArtifacts` (a plain directory under `.worktrees/` is a draft), `/api/view` (a 12 s describe; `ARTIFACT_AT` takes worktree names), the artifact route (`no-store`) and `dashboardData`/`DATA_WAIT_MS`; in the tests `soonIn`, `POLL_FAST`, `landArtifact`, `COUNT_FETCH`, the existing viewer test, `threadsFixture`, `chrome.mjs` (`send` is generic, so `Emulation.setEmulatedMedia` works) and `test/browser/dev-links.mjs`, which already clicks `#av-reload` and listens to lens messages from the parent page.

**Coverage.** Every done-when and spec points 1-5; N1-N4 taken in as spec-2 says.

**Interfaces.** `avHint`, `avFpSeen(fp, mainFp, slug, at)` and `fpNow`/`mainFpNow` are used the same way in both tasks.

**Feasibility.** The lens `ready` listener on the parent works (messages from an opaque-origin frame reach the parent; `e.source` compares with `#av-frame.contentWindow`); the `#artifact/wt/<wt>/<slug>` route and a draft folder under `F.old/.worktrees/` work; the computed `outline-color` against a probe and the emulated dark scheme work; the real 10 s polls fit in the 180 s timeout.

**Existing tests.** They keep passing: the viewer test's "nothing else" list allows `/api/view?`; the `viewerBoot` checks (forbidden names, `postMessage`, `location.*`) are not tripped; the fault tests are unaffected.

**What blocks.** P1: the tree check waits a fixed 11 s from navigation, but the poll's interval only starts after boot's awaits, so the check would usually pass even with the `tree:` guard broken.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P1 | Important | spec "The change" 2 (a `tree:` version is never checked); plan Review focus 4; quality.md §3 (missing test with a plausible failure path) | plan Task 2 Step 1; `index.html` `viewerBoot` ~5664-5695 | The 10 s interval is created after `await viewerArtifact()` and, beside the threads interval, after `await tlRefresh()`. `go()` returns at the start of boot, so the interval starts 1-3 s later and its first tick lands after an 11 s assertion: a missing `tree:` guard would still pass. Create the view poll beside the 5 s threads interval and wait for at least four `/api/threads` in `__asked` before asserting one `/api/view?`, or another wait that provably covers one tick. | fixed: the poll sits beside the threads interval; the test waits for four `/api/threads` |
| P2 | Minor | spec "The change" 1 | plan Task 1 Step 3; `index.html` ~3570 `else Object.assign(TS, { fp, mainFp })` | On a re-show of the same stage the frame is not reloaded, but `TS.fp` is overwritten with `DATA`'s newer fp, so the hint clears while the frame still shows the old page. Keep `fp`/`mainFp` there, or accept it. | fixed: a re-show keeps `fp`/`mainFp`; the given values go only to `fpNow`/`mainFpNow` |
| P3 | Minor | quality.md §6 (the TL;DR says what could go wrong) | plan TL;DR | No risk bullet. Swap one bullet for the main risk. | fixed: a risk bullet |
| P4 | Minor | spec Edge cases, last bullet | plan, the "After both" line | No step tells the supervisor about the stale `/api/view` comment. | fixed: told in m-20261115-013705816, ruled in m-20261115-013720113; both in the plan |
| P5 | Suggestion | none (robustness) | plan Task 1 Step 1 | (a) `addScriptToEvaluateOnNewDocument` also runs in the artifact's frame: guard the listener on `#av-frame`. (b) Write the v1 draft before the dashboard starts. (c) The long waits need `soonIn(p, 45000)`/`soonIn(p, 37000)`; the default is 30 s. | fixed: all three in Task 1 Step 1 |
| P6 | Suggestion | none (taste, accessibility) | plan Task 1 Step 3 CSS | `#av-reload.stale` overrides the `:focus-visible` ring. Consider `#av-reload.stale:not(:focus-visible)`. | fixed: `:not(:focus-visible)` |

Verdict: CHANGES 34ee7d3a4a92f707d3ba4ae86c8a869537d6bd50
