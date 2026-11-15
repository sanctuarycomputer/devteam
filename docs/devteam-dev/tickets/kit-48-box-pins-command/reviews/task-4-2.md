# Task review, Task 4 (`box-pins installed`), pass 2

- Reviewer: task-reviewer (fresh subagent, cold confirm, claude-opus-5-5)
- Reviewed: a29a42f3cf7220b0ab6e66edb5e60ad307cd72d1

I read pass 1's record (task-4.md) and `git show a29a42f` for `docs/devteam/scripts/devteam.mjs` and `test/machine.test.mjs`, and checked them against spec.md `### box-pins installed`. I extracted the commit with `git archive a29a42f` and ran `--test-name-pattern 'installed|task-4'` with the DEVTEAM_* variables unset. All four `installed` tests pass (44-47), including the new test 46.

Each disposition, checked by mutating a scratch copy and running test 46:
- **F1 (machineWide).** The new test runs `installed` from a `git init` folder that has no settings.md and expects exit 0. When I removed `|| (command === 'box-pins' && positional[0] === 'installed')` from `machineWide` (devteam.mjs:444), test 46 failed at line 1337 with `no docs/devteam/project/settings.md here (.../not-a-project)`. Fixed as the disposition says.
- **F2 (relative bin).** `bin` is now `path.resolve(DEVTEAM_BOX_BIN || '/usr/local/bin')`. The test sets `DEVTEAM_BOX_BIN=.`, runs from `cwd: boxBin`, and puts the wrong-version shim first on PATH. When I put back the unresolved value, test 46 failed at line 1340 (exit 1, because the shims answered). Fixed. `path.join(bin, file)` on a resolved `bin` is always absolute, so "never a PATH lookup" now holds for every input.
- **F3 (pin named twice).** A `named` count is kept, and a tool named more than once prints `<name>: named <n> times in DEVTEAM_BOX_TOOLS`, counts as bad (exit 1) and is not run. When I disabled that check, test 46 failed at line 1343 on the regex. The exit-1 assertion alone would still pass, because the duplicate's last value `gh=2.105.0` mismatches anyway, but the regex makes the test bite. Fixed.

Nothing new broke. The change touches only the `installed` arm, and the earlier tests 44, 45 and 47 still pass. The duplicate check runs after the "not in DEVTEAM_BOX_TOOLS" check, so the exit-code rules are unchanged except for the new exit-1 case. Unknown names behave as before: a duplicated unknown name prints its "not a tool" line once per time it appears. That is cosmetic, and it already exits 1.

No findings.

Verdict: APPROVE a29a42f3cf7220b0ab6e66edb5e60ad307cd72d1
