# Task review, T2, pass 3

- Reviewer: task-reviewer-3 (fresh subagent, claude-opus)
- Reviewed: b2974d1a11bfb1e91c18ba62f5a28460bbd54cd1 (cold confirm of task-2-2)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

No findings.

Confirmed:
- T2-2-1: when the fetch of home's `origin/ticket/<id>` fails, cmdCheckPr (docs/devteam/scripts/devteam.mjs:4816-4819) now adds "no records for <id> in home: home's ticket/<id> is not on origin; push it" to checkPr's failures, so `report` exits 1. checkTicket still suppresses its own "no records" line for `records: null` (:4297), so the failure is not reported twice. checkPr always returns a fresh array, so the push is safe on every return path. Mutation in a scratch clone: deleting the new `fails.push` line makes the merge test fail at test/multirepo-home.test.mjs:325 (`assert.notEqual(gone.status, 0)`, actual 0).
- T2-2-2: the new `doesNotMatch` at test/multirepo-home.test.mjs:314 covers the reverse case: a local commit breaks the records while origin's are fine. Mutation in a scratch clone: removing `...(records !== undefined ? { records } : {})`, so that check-pr --repo judges the local branch, fails that assertion ("check-pr --repo judges origin's records, which hold").
- The test puts origin's branch back after the deletion (`git push origin ticket/<id>`). The rest of the merge test still passes after it.
- No new Critical or Important problem in the diff.
- `timeout 900 node --test --test-concurrency=2 test/multirepo-home.test.mjs` exits 0 at b2974d1 (11 pass, 0 fail). The unmutated scratch clone also passes the "merge checks the records" test (exit 0).

Verdict: APPROVE b2974d1a11bfb1e91c18ba62f5a28460bbd54cd1
