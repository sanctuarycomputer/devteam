# Task review, T1

- Reviewer: task-reviewer-1 (fresh subagent, claude-opus)
- Reviewed: 7ced60b3a91229a92ba413101c7400f0819dd602 (T1: the setting and the helpers)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1-1 | Suggestion | none | docs/devteam/scripts/devteam.mjs:11819 | merged-without-merge now reads every `at <sha>` in an act's `what` (T3, noted here for the shared helper surface), so an upstream-sync act's `(upstream <tag> at <tagSha>, …)` sha is also counted as a worded head. Harmless today (that sha is upstream's, not a merge head on main), but the regex could be anchored to `merged … at` and `records at`. | |

Checked: REPO_KEYS/REPO_OWN_DEFAULTS.records 'repo', LINK_TYPES.records, validate's refusal text (spec "The setting"); recordsInHome reads committedComponents (main's committed settings) and returns false for home and for links without records: "home"; ownerClass falls to governance-edit for the new field; parseReview's `- Records:` accepts only 40 hex; approve-plan via recordsRepo (identical to repoOfTicket for repo-records links); ticketReviews' records branch (full sha as given, branch name re-resolved in home, no ref = home main). Test 'records in home: the setting…' covers the default, the refusal, the landed flip, and approve-plan refusing a link plan then accepting home's. Test file passes (11/11, exit 0).

Verdict: APPROVE 7ced60b3a91229a92ba413101c7400f0819dd602
