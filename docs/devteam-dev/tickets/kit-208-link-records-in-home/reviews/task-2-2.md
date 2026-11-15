# Task review, T2, pass 2

- Reviewer: task-reviewer-2 (fresh subagent, claude-opus)
- Reviewed: 82f54b2d021892f70cf1e82386f64c9257069b2d (cold confirm of task-2 and the fixes in 82f54b2)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T2-2-1 | Important | spec acceptance 1 (`check-pr --repo <link>` "fetches home's `origin/ticket/<id>` first and checks the records there"); the brief's "a fetch failure means no records" | docs/devteam/scripts/devteam.mjs:4815-4816 with :4297-4299 | When the fetch fails, cmdCheckPr passes `records: null`. In checkTicket, null is merge's "none pinned (it says why)": it suppresses the "no records for <id> in home" failure, and `if (!H \|\| recSha)` then skips every records check (spec, plan, verification, reviews, approvals). cmdCheckPr adds no failure of its own, unlike merge, so check-pr fails open. Probe in a scratch copy (merge test, after the new assertion): `git push origin :ticket/<id>`, then `check-pr --repo console --head-ref ticket/<id> --sha <code>` exits 0 with "ok: ticket/console-01-a passes the checks". Before the fix the local branch was judged instead. Merge still refuses, but the link PR's check-pr is a gate and should not say ok. Fix: when the fetch fails, push the "no records for <id> in home … and push it" failure in cmdCheckPr (or pass a value that checkTicket reports), and add a test where origin has no ticket/<id> and check-pr --repo refuses. | |
| T2-2-2 | Minor | pass-1 T2-1 fix request ("… and the reverse") | test/multirepo-home.test.mjs:319 | Only the direction where origin is broken and local is fine is tested through check-pr --repo. The reverse (a local commit breaks the records while origin is fine, so check-pr --repo passes) is not. The direction that is tested does catch the original bug: in a scratch copy, removing `...(records !== undefined ? { records } : {})` fails the merge test on "check-pr --repo judges origin's records too". | |

Confirmed otherwise:
- T2-1: the pin to `refs/remotes/origin/ticket/<id>` is real and guarded by the new assertion (mutation above). Its fetch-failure half is what T2-2-1 is about.
- T2-2: the link-folder file, README footprint and missing Records line are each asserted through `merge --dry-run` at origin, and origin is restored by a force push after each.
- T3-1: merged PRs are sorted newest first, so PR #8 (at r.reviewed, newer) comes before #7. Picking `merged[0]` would now name r.reviewed and fail the assertion.
- T3-2: the status, finding and test text all use the plan's wording.
- T4-2: `--remove` now requires the sibling to be a detached home worktree.
- T4-3: the prompt reads `repo('home').settings.forge`.
- T5-1: the park text is short, and the test checks that "Commit all work" follows it.
- `timeout 900 node --test --test-concurrency=2 test/multirepo-home.test.mjs` exits 0 at 82f54b2.

Verdict: CHANGES 82f54b2d021892f70cf1e82386f64c9257069b2d
