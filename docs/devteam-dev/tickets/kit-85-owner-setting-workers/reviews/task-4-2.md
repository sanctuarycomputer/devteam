# Task 4 review, pass 2 (confirming T4-1)

- Reviewer: task-3/4 confirming subagent

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

Checked and found sound (scope: T4-1 only):
- In 559071bb, `setSettingsKey` in docs/devteam/scripts/devteam.mjs now finds the block with `exec`. It computes the block's own offset (`at = m.index + m[0].indexOf(block)`) and splices `next` in there (`text.slice(0, at) + next + text.slice(at + block.length)`), so it no longer runs `text.replace(block, …)`. Before writing, it re-reads the first `json devteam` block of the text it is about to write. If that block is not exactly `next`, it dies with "didn't land in the json devteam block" and writes nothing. `m[0].indexOf(block)` cannot land in the fence header: a block that parses as a JSON object contains `{`, and the header has none. In any case the re-read would catch a wrong offset.
- Harness (scratch). I pulled `setSettingsKey` and its helpers out of the source at d2e7d8f (old) and at 559071b (new), with `die` made to throw, and ran four files that set `max_active_tickets` to 7:
  - (a) prose containing `{}` above an empty `{}` block;
  - (b) an earlier plain ```` ```json ```` example fence whose text is identical to the block, with the key present (replace path);
  - (c) the same as (b) without the key (insert path);
  - (d) (c) with CRLF line endings.

  Old: all four return normally, but the block is unchanged (`{}`, 3, or no key) and the text outside the fence changed, so the prose or the example was edited. New: in all four the block holds 7, and the text before and after the fence is byte-identical to the input. (d) keeps CRLF on the inserted line.
- To test the guard, I put back an earlier-copy offset (`const at = text.indexOf(block)`) in the new source. All four cases then die with "didn't land in the json devteam block", and every file is left unchanged. So success is never reported for an edit that missed the block.
- The test "settings set edits the block itself, keeps its line endings, and only in the settings chore" passes 1/1 at f33b9c2. I put back the old write (`fs.writeFileSync(file, text.replace(block, () => next))`, with the re-read removed) in a scratch worktree, and the test then fails 0/1 at `assert.ok(after.startsWith('An empty object reads {} in JSON.\n'), 'the prose is untouched')` (test/owner-setting.test.mjs:602). Settings for the runs: `--test-concurrency=2`, `--test-name-pattern "edits the block itself"`, every DEVTEAM_* unset, a fresh HOME, DEVTEAM_HUB_PORT=4517.

Verdict: APPROVE 559071bb971bd6e26b97af96a7bad32ab174fcfb
