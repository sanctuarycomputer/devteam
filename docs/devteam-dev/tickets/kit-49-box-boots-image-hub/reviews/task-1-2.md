# Task review, pass 2: task 1 (cold confirm)

- Reviewer: task-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: fb7ad8d11dc085cabb12bd7db1c0afc33d0e467a (task 1)

## What I checked

This is a diff-only confirm of the Task 1 parts of `git diff 8baa8ae fb7ad8d -- cloud/Dockerfile test/machine.test.mjs`, held against task-1.md's findings and their dispositions. I didn't judge the Task 2 and Task 3 hunks. HEAD is fb7ad8d, and the tree for `cloud/` and `test/` matches it.

- **F1 (fixed).** The `hub_wait` guard now reads `''|*[!0-9]*|0?*) hub_w=15`. A value with a leading zero, such as `08`, `09` or `010`, falls back to 15 s, so dash never sees an octal-looking number. A bare `0` still means 0 s, which gives one try and then the note: harmless. The test now loops over `15s`, `08`, `010` and `-1`. With `|0?*` removed, test #22 fails.
- **F2 (fixed).** The boot's call is now the same guarded line as the minute loop's. In the Dockerfile it sits at line 405, after the definitions and before `hub_wait || :` at 483. Straight after the operator block the `home` session exists with no hub window, so `list-windows` succeeds, `grep` misses, and `hub_window` runs. That is the same path as before. The order test checks that the boot line and the minute line are identical. Putting back the bare call fails test #24.
- **F3 (fixed).** The wrapper now carries `HOME='$HOME'`. It is expanded from `devteam-dev`'s own environment, `/data/home` as set by `as_dev`, when the window is made. Because it sits inside single quotes in the pane command, the tmux server's global environment can no longer redirect the hub's `os.homedir()`. Test #21 asserts it, and removing it fails #21.
- **Tests.** I ran `--test-name-pattern="hub|boot|minute loop"` with `--test-concurrency=2` at load 16 to 20. All the selected tests passed, the real-tmux #25 and `status names the hub's kit…` (#29) included. I mutated `cloud/Dockerfile` in place and restored it from a copy after each run. `git status` then showed only two untracked review records I didn't write (`task-2-2.md`, `task-3-3.md`).
- **The disposition rows in task-1.md.** Each row has five cells against a four-cell header. The Disposition column itself is empty, and the text sits in a fifth cell. The kit's parser reads the first non-empty cell from the Disposition column on (devteam.mjs:3760), so check-ticket counts each row as dispositioned. The rendered table is ragged, but I don't block on it and didn't edit the record.

## Findings

| # | Severity | Finding | Disposition |
|---|---|---|---|
| F2-1 | Minor | spec.md acceptance check 1 (line 12) and plan.md Global Constraints ("The window command, exactly", line 25) still quote the wrapper without `HOME='<home>'`, and the code now differs from that literal text. The change is a reviewer-asked hardening and it stays within the spec's intent ("nothing from tmux's environment"). The final reviewers and verification.md should still see it as a known deviation from the approved text, for example in the F3 disposition or in verification.md, so nobody reads it as drift. | Taken: verification.md says the wrapper is a superset of the done-when's (four -u from spec-1 F8, and HOME from task-1 F3). |

Verdict: APPROVE fb7ad8d11dc085cabb12bd7db1c0afc33d0e467a
