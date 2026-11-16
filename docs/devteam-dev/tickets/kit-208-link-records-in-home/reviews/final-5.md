# Final review, pass 5

- Reviewer: final-reviewer-j (fresh subagent, claude-opus)
- Reviewed: 5fdaa41a058ae6b898b3d03ff45fc5ab97646b72 (cold confirm, the whole branch)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F5-1 | Important | quality.md §3 (detector contract: a merge no act made stays `merged-without-merge`); plan T3b | docs/devteam/scripts/devteam.mjs:5135 (`landedRecordsHeads`) | Concurs with final-5b B5-1, checked against the filter (not re-run). Someone could push by hand, before `merge` runs, a faithful `git merge --no-ff -m "<id>: records" <l1>` of an earlier commit l1 on home's ticket/<id>. That merge passes every condition. l1 is not in p1, so the new `ancestorOf(h, p1) === false` passes. l1 is an ancestor of recSha, the merge changes only the ticket's folder, and its tree is git's own merge. The act then names "and earlier at <l1>", which merge never landed. That hides that merge and every other merge of l1 (an evil one included) from `merged-without-merge`. Git alone can't tell landRecords' merge from a hand-made one. Fix as B5-1 says: record the landing when landRecords makes it, and name only recorded heads. | fixed: as B5-1 (records landings are logged acts; nothing is inferred from git) |

Also checked. B4-1's own case is fixed. `timeout 900 node --test --test-concurrency=2 test/multirepo-home.test.mjs` at 5fdaa41 exits 0 (13/13), and the B1 test at line 510 still names the earlier landRecords head. With only `ancestorOf(h, p1) === false` removed in a git-archive copy, the run exits 1: test 13 fails at line 571, where the act names the empty merge's head. The new condition can't exclude a real landRecords merge, which never merges a head already in p1. The default (records unset) is unchanged: `landedRecordsHeads` runs only when `rec` is set.

Verdict: CHANGES 5fdaa41a058ae6b898b3d03ff45fc5ab97646b72
