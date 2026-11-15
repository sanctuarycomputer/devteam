# Final review, pass 1

- Reviewer: final1 (fresh subagent, claude-opus-5-5)
- Reviewed: 402ef7bff5739c2689c493759e35f21663dc803c (the whole branch against main 9f244a3)

## What I checked

- Scope: `git diff --name-only 9f244a3 402ef7b` is `test/bounds.test.mjs`, `test/speed.test.mjs` and this ticket's folder, nothing else; PR #272's file list agrees and its head is 402ef7b. The test files are byte-identical at fe94443 and 402ef7b (the code the verification measured), and identical at 003d993 and 9f244a3 (the "before" it cites).
- Done-when 1: read the whole test diff against the spec and the plan's rulings. `grep -n "Date.now\|ms <\|< base +"` over both files exits 1. Every line number in verification.md's before/after table matches the file at the head. B1 counts compiles through a `RegExp` proxy installed with the context's own `Function` (it reaches `globToRegex`'s `new RegExp`, a global lookup); B2 counts `ownerOf` asks; B1/B2b/B3/B4 are best-of-n interleaved same-process ratios with oracles first; B5 is an order check by pid. The remaining timeouts are hang guards, as the spec says. B3 bounds the whole Inbox read, per ruling m-20261115-185641944-supervisor.
- Done-when 2: `gh run view 43750016923` is test-stress, `success`, head fe94443 (test code identical to the head).
- Done-when 3: re-ran, in my own tree with my own TMPDIR, `run-file.sh test/bounds.test.mjs` (exit 0; ratios 3.52, 1.03, 2.14, 1.63) and `tenx.sh` for b1-count (exit 1, "27186 compiled"), b2b (exit 1, 8.75x vs bound 4x) and b3 (exit 1, 9.48x vs bound 4.5x), each on its own bound's assertion. Read slow-kit.sh: every patch asserts its anchor occurs once; b5's premise (tmux calls run under `TMUX_TIMEOUT_MS` = 30 s, `nudgeSupervisor` queues while `REPLY_FD` is set) checked in devteam.mjs.
- Done-when 4: see F1.
- Done-when 5: the dashboard test's one `t.after` writes `release`, then `dash?.stop()`, then removes the folder, each step through `cleanup` (errors held, first rethrown); the git-processes test registers each fixture as it is made and cleans all in `finally`. No other test in speed.test.mjs starts a long-lived process. check-hooks.sh requires the patch's own error, then `ps -p` per pid, the dashboard's group and its watcher; the recorded runs pass for both the last-step and first-step throws.
- ~/.devteam/repos-4320/ is written continuously by the box's own hub and dashboards (pids 135, 318, ...); my runs used run-file.sh's isolated HOME and port 4791.

## Findings

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Important | done-when 4 | test.yml run 43751033783 at 402ef7b; verification.md row 4 | test.yml is not green on every job at the PR head. Run 43751033783 (head 402ef7b) concluded `failure`: job "kit (22, rest)" failed in `test/dashboard-owner-action.test.mjs` (not ok 87, `hookFailed`, `ENOTEMPTY: directory not empty, rmdir '/tmp/devteam-owner-action-…/owner-action/docs/devteam'`), the other seven jobs succeeded. The file is untouched by this branch and main's last eight test.yml runs are green, so this looks like the known after-hook flake (kit-214's area), not this diff; but the done-when asks for the head, and verification.md cites only e33e9e5. Re-run the failed job, and record the head's run id with every job's conclusion (through `gate ci`) in verification.md. | |
| F2 | Minor | spec accuracy | spec.md, edge case "The vm context's RegExp" | The spec says "six more `coverage()` calls"; the code (correctly) has six in all, the first and five timed. verification.md already notes the erratum (spec-2 F2-1); no code change needed. | |
| F3 | Minor | test strength | test/bounds.test.mjs:59 | B2's count bound (`asked.length <= folders.size`, 1,809) is about 2x the current 900 asks, so a doubling of distinct asks passes. It catches 10x as the done-when requires; noted only so a future tightening knows the headroom. | |

Verdict: CHANGES 402ef7bff5739c2689c493759e35f21663dc803c
