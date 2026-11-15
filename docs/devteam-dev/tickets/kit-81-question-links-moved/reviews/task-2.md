# Task review, Task 2

- Reviewer: task-reviewer 2 (fresh subagent, claude-opus-5-5)
- Reviewed: f9d71a0c226942ea1501cfac33c4be3a3859d27f (e9a742e..f9d71a0)

The finding matches spec change 3 and Task 2 Step 3 word for word. It sits right after `question-unrated` and iterates the same `open` list (`status === 'open' && goal_hold !== 'let-go'`, devteam.mjs ~11298), so let-go goals and answered, withdrawn or defaulted questions never raise it. It is medium, and its `detail` is the `links_moved` text. The hint names `withdraw <qid>` and "ask again", and the comment says why this is not a W2 re-ask. The test covers done-when 3 with the refusal string written out literally, and done-when 2 with both the moved and the gone question present, the still one absent, and the moved one's finding gone after `withdraw`. It also checks that `/api/data` no longer lists the withdrawn question among the open ones. I checked everything downstream that reads findings, and none of it switches on kind in a way a new kind could break. `wait`'s snapshot wakes only on `severity === 'high'` (~18353), so a medium finding does not loop it. `observeFindings` dedupes on `metrics:<kind>:<subject>` once a day. The dashboard's findings view (index.html ~4131) renders any kind through `words(f.kind)`, and `ack` keys on `kind subject`. `node --test --test-concurrency=2 test/question-links-moved.test.mjs`: 1 pass, 0 fail. The code style matches the neighbouring one-line `add` loops.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

Verdict: APPROVE f9d71a0c226942ea1501cfac33c4be3a3859d27f
