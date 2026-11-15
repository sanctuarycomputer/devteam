# Plan review, pass 2

- Reviewer: plan-reviewer 2 (fresh subagent, claude-opus-5-5)
- Reviewed: fbd0b775166b40380a4f84d48316fbfde778cfef (plan.md)

I read `git diff 5c0ae2a HEAD -- plan.md` against reviews/plan-1.md (F1 to F4) and spec-2's N1, and checked each fix against spec.md and the code: `machineRepoDir` and `registerOnMachine` (~12759, file name is the sha1 of the realpath'd root, so the control's record is findable by root), and test/machine.test.mjs's helpers (`tmp` is realpath'd under `os.tmpdir()`, `repo(name, { dir })` creates `dir/name` recursively, and the existing "machine recorded" test cleans up with `sup.kill(); fs.rmSync(...)` in `finally`). I only read code. I ran no kit command and no test.

- F1: fixed. Test 2's `finally` now removes the control's record from `home/.devteam/repos-<port>`, the same pattern as the existing "machine recorded" test. See N1 for a small race in that order.
- F2: fixed, and the new cases are sound. With child `TMPDIR=tmp`, both `os.tmpdir()` and `$TMPDIR` are `tmp`, an ancestor of `realPath(os.homedir())` = `h`, so `tempDirs()` drops it and `h/code` registers. Without the guard, `h/code` would be "under the temp folder", so the case is red on a missing guard. `${scratchTmp}x/r` is a sibling of `scratchTmp` under `tmp`, with no `scratchpad` segment, so it registers only if "under" is checked by whole segments. A `startsWith` check would fail it. "Each case clears the repos dir first" keeps the one-file asserts exact.
- F3: fixed. The machineStatus line now reads `(${s.why}; ignored, remove it)`, which matches the spec word for word.
- F4: fixed. Test 1 has a comment explaining that `accounts-tick` refuses a worker env, so `sessionRun()` in `registerOnMachine` is covered through the dashboard in test 2. That matches spec Testing.
- spec-2 N1: taken. `tempDirs()` compares against `realPath(os.homedir())`, and `h` and `scratchTmp` are both `mkdtemp(tmp, …)`, so they are siblings. Putting the guard inside `tempDirs()` means both `registerOnMachine` and `machineRecords`' strays get it, which is what the spec's scratchRootWhy says.

Nothing in the fixes contradicts the spec or the other tasks. One thing outside the fixes, noted and not a finding: test 1's control and test 3's `c` assume that the runner's `os.tmpdir()` has no `scratchpad` segment. On this box `TMPDIR=/data/home/tmp`, and in CI it has none either, so both hold.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| N1 | Nit | test hygiene: ordering | Task 1, test 2 finally | The dashboard is killed and then its record is removed. An `accounts-tick` child spawned before the kill can outlive the dashboard and rewrite the record after the `rmSync`, because ticks run every 200 ms. This is harmless: pass 1 found no assertion that the record breaks, and the existing test has the same order. Still, waiting for the dashboard's `exit` and for one tick period before removing the file would make F1's fix hold every time. | |
| N2 | Nit | spec fidelity | Task 2, tempDirs() | "an ancestor of it" should say by whole path segments, as scratchRootWhy does. Otherwise `TMPDIR=/data/ho` would count as an ancestor of `/data/home` and be dropped. Share one segment-wise `under(a, b)` helper for both checks. | |

Verdict: APPROVE fbd0b775166b40380a4f84d48316fbfde778cfef
