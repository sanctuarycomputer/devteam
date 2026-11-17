# Task 3 review, pass 2

- Reviewer: task-reviewer-3b (fresh subagent, claude-opus-5-5)
- Reviewed: bfaf4c5496fe637a292bcdf88cadf7fd7d73066d (Task 3's fixes: d2507be, and the passing-file test in bfaf4c5)

Pass 1's findings, checked by mutating `test/run.mjs` in the review worktree, running only the named test (`--test-name-pattern`, run the way `t.sh` runs node), then restoring the file:

- T3-1 confirmed fixed. `a passing file` now runs `test/browser-contract.test.mjs` (ledger ruling: done-when 1's `search.test.mjs` run is a verification row). The whole file took 16.3 s on Node 22 (34/34), 26.4 s on Node 18 (33 pass, 1 skip: the compile-cache test before 22.1) and 15.6 s on Node 24 (34/34), with load between 32 and 34. That is well under the 45 s budget even with T4's hang tests in place.
- T3-2 confirmed fixed. With the safety check removed (`if (false) throw`), the new test fails (expected 2, got 0). With only the dir checked (the shim file unchecked), it fails too. Dropping just `!st.isSymbolicLink()` survives: on Linux a symlink's lstat mode is 0777, so the mode check refuses it anyway. That makes the symlink check redundant here, not missing.
- T3-3 confirmed fixed, as a property. Each guard survives on its own: without `startsWith` the Dirent types never report a symlink as a dir or a socket, and with a `statSync` walk the realpath check drops everything outside. With both mutated, the test fails (s3 comes back). So the test proves "no socket from outside the folder". The two guards are defense in depth for each other.
- T3-4 confirmed fixed by the ruling in plan.md ("Rulings after plan approval") and the ledger. No code change was needed.
- T3-5 confirmed fixed. `schedule()` was extracted and tested. Giving `alone` the full concurrency fails the test, and so does collapsing everything into one step. See T3-2-1 for the call site.
- T3-6 confirmed fixed. Keeping the last run, or the shortest, instead of `Math.max` fails `--timings keeps the longest` (the fixture writes 1.5 s, then about 0).
- T3-7 confirmed fixed. Going back to `` `${shimDir}:${PATH ?? ''}` `` fails `an unset PATH gives the child no empty PATH entry` (the child got `<shim>:`).
- T3-8 confirmed fixed. Removing the is-a-directory check fails the test (exit 1 with a stack trace instead of 2).
- T3-9 confirmed fixed. Dropping 50,000 characters of a file's printed output fails `a loud file` ("every x the file printed"). The comment on the dir `chmodSync` now gives the right reason. Summary rows still come out in finish order. The spec sets no order, and this was a Suggestion.

Nothing new is broken by the fixes. The new tests clean up after themselves (`t.after` on the shared dir and the socket dirs, and the servers are closed). The PATH filter also drops empty entries inside the user's own PATH, which is harmless and arguably better. `git status` in the review worktree was clean after every restore.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T3-2-1 | Suggestion | none | test/run.mjs:418 | `runAll`'s use of `schedule()` isn't covered. Mutant `for (const st of [{ files: plan, limit: opts.concurrency }])` (the call site skips `schedule`) passes `alone files run first`. It is a one-line call site over a tested pure function, so this is the usual extract-and-test trade, not a gap with a plausible failure path. | |

Verdict: APPROVE bfaf4c5496fe637a292bcdf88cadf7fd7d73066d
