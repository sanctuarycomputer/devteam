# Task review, T2

- Reviewer: task-reviewer-1 (fresh subagent, claude-opus)
- Reviewed: 7ced60b3a91229a92ba413101c7400f0819dd602 (T2: check-ticket and check-pr read home)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T2-1 | Important | spec acceptance 1 ("`check-pr --repo <link>` for such a ticket fetches home's `origin/ticket/<id>` first and checks the records there") | docs/devteam/scripts/devteam.mjs:4813-4814 | cmdCheckPr fetches home's `origin/ticket/<id>` but then calls checkPr without `records`, so checkTicket falls back to homeRecordsRef, which prefers home's local `refs/heads/ticket/<id>`. On any machine with the worker's records worktree (local branch ahead of or behind origin), `check-pr --repo console` judges the local, possibly unpushed records, not what origin has; the fetch is then effectively unused. No test exercises `check-pr --repo <link>` for a records-in-home ticket, so this is unguarded. Fix: when the fetch succeeded pass `records: 'refs/remotes/origin/ticket/<id>'` (else the "no records" path), and add a test with a local commit that breaks the records while origin is good (and the reverse), as the merge pinning test does. | |
| T2-2 | Minor | plan T2 tests ("Each refusal is asserted through both `check-ticket` and `merge --dry-run` … once T3 lands"); spec acceptance 4 "refusals (dry run)" | test/multirepo-home.test.mjs:256-276 | The link-file-under-tickets (outside touches), README footprint and missing `- Records:` refusals are asserted only through `check-ticket`; only the records-verdict refusal goes through `merge --dry-run` (line 308). merge reaches the same checkTicket code with the pinned sha, so the failure path is narrow, but the plan asked for both. | |

Checked otherwise: checkTicket's `if (!H || recSha)` block leaves the default path identical (H false); no records branch gives the one failure and reads nothing from home's working tree (asserted at line 249); the link folder exemption is dropped only for H; recordsBranchFails uses merge-base three-dot against home main; approvers count only reviews holding at both heads; home `check-pr --head-ref ticket/<id>` returns only the footprint check before the "a ticket of <link>" return. Mutations considered: dropping `&& !H` from `own`, recordsBranchFails returning [], recordsHold always true — each is caught by an assertion in the check-ticket test.

Verdict: CHANGES 7ced60b3a91229a92ba413101c7400f0819dd602
