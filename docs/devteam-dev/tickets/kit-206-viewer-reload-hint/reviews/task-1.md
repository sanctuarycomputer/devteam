# Task 1 review

- Reviewer: task-reviewer (fresh subagent, claude-opus)
- Reviewed: 21ee88e246c0c2d1b08243cfbc17683adee0ad7d (task 1)

**Summary.** I read the diff against plan Task 1, the spec, plan-2 S1, and the code around it: `TS` and `tsSet`, `showArtifact`, `showPreview`, `openArtifact`, `closeArtifact`, the `#av-reload` handler, and `drawOrHold`, `load` and `loadNow`. Only `docs/devteam/dashboard/index.html` and `test/dashboard.test.mjs` changed. The new test passes at the head (2/2, under Node 22).

The production code looks correct:
- **`tsSet` calling `avHint()` is safe.** Its three callers (`showArtifact`, `showPreview`, `closeArtifact`) all run after the DOM exists (the script at line 814 comes after `#av-reload` at line 781), and `avHint` is a hoisted declaration. On a preview or after a close it gives the class off and today's title.
- **The re-show branch** keeps `fp`/`mainFp` and only moves `fpNow`/`mainFpNow` forward when a value is given (P2).
- **`openArtifact`'s fallback** to main's fp applies only on a new stage, as S1's disposition says. Its `tree:` guard can never fire (the hash regex never yields `tree:`), but it does no harm.
- **The reload handler** does nothing for a preview and copies only fingerprints it knows.
- **The `loadNow` hook** uses the raw `d`, so a held draw still feeds the check; it runs only on the dashboard (`load()` returns early in a viewer tab), and on the first read after `route()` → `openArtifact`.
- **Comments** match the file's voice and density.

Two mutations in a scratch copy (a `git archive` of 21ee88e) passed the test, so two properties it claims are not pinned:
1. **No open-time init, unguarded copy** (the spec-1 F1 failure mode): the press "before any check" in fact comes after the first `/api/data` read's `loadNow` hook has set `fpNow`.
2. **A delayed self-reload** (the frame's `src` reset 1.5 s after the hint): `said('v2') === 0` is checked the instant `stale` appears and never again.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1-1 | Important | spec acceptance check 3 (spec-1 F1); plan Review focus 1 | test/dashboard.test.mjs, the dashboard subtest, "a press before any check" | On the dashboard the first read sets `fpNow` before the press, so mutation 1 passes. Pin it where a press can come before any check (Task 2's viewer tab: press right after `'v1'`, then change the file and expect `stale`), and fix or drop the inaccurate comment here. | fixed in Task 2's commit: the viewer-tab subtest presses before its first check (asserting only boot's `/api/view?` so far), then expects the hint; the dashboard comment now says what that press shows. Mutation 1 now fails the test |
| T1-2 | Important | spec The change §4; acceptance check 2 | test/dashboard.test.mjs, `said('v2') === 0` | Checked the instant `stale` appears; mutation 2 passes. Check again right before the press, after a set wait of a few seconds. | fixed: a 3 s wait and a second check before the press, in both subtests |
| T1-3 | Suggestion | plan Task 1 Step 1 (`timeout: 180000`) | the new test's options | 240000, not the plan's 180000: harmless, matches neighbours, leaves room for Task 2's subtest. | kept at 240000: two subtests with real polls (noted in verification.md) |

Verdict: CHANGES 21ee88e246c0c2d1b08243cfbc17683adee0ad7d
