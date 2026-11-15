# Task review: T1 machine

- Reviewer: task-reviewer 1 (fresh subagent, claude-opus-5-5)
- Reviewed: 2f1b48f4ef8bd811747054c81eca08e8b611109e (test/machine.{run-folder,status,tell,hub-records,box,box-pins}.test.mjs and test/lib/machine-fixture.mjs)

What I read: spec.md and plan.md (T1, Shape, The incident test, Fixed waits, Edge cases), split.mjs, lint.mjs, edits.mjs (machine entries), names.mjs output, the seven files at 2f1b48f, base test/machine.test.mjs at e8022ac, the kit's dashboard `accountsTick` (docs/devteam/scripts/devteam.mjs, around L14625), local-run-1.log.

What I ran, all in a private `mktemp -d` copy (`git archive 2f1b48f`, not a worktree):

1. **Reproduce.** Put back base test/machine.test.mjs, deleted the six parts and the fixture, ran `split.mjs machine` (6+5+4+3+14+25 = 57 tests, fixture 0) then `edits.mjs machine` (7 edits). All seven files are byte-identical to 2f1b48f (`cmp`).
2. **Verbatim move.** In a second copy, `split.mjs` only (no edits): the multiset of non-blank, non-import, non-export lines across the parts and fixture equals the base's, except the file header comments (the base's 3-line header replaced by one per part and a 4-line fixture header). No code line added, dropped or changed by the split.
3. **Edits** (diff split-only vs final): exactly the 7 entries, each one the plan names.
   - run-folder: the incident child's file becomes `test/machine.status.test.mjs`, plus a comment saying so. Pattern, TAP checks and decoy check unchanged.
   - status, merge 1: "daily review done" and "new-knowledge=1" read one `status()` after the notes append; both assertions kept, nothing happens between the base's two calls.
   - status, merge 2: the alert is raised before `st3`; `dash=9/DOWN`, no `behind=` and `hub … DOWN; alert: look at the disk` all asserted on `st3`. Same states read (port 9, latest v0.1.0, alert up); the alert text can't satisfy or break the other two. Three assertions kept, one call fewer.
   - hub-records: the 1.5 s sleep becomes `until()` no `ps -A -ww -o args=` line contains `<r>/docs/devteam/scripts/devteam.mjs accounts-tick`. The dashboard spawns it with `execFile(process.execPath, [self, 'accounts-tick', '--rotate'])`, with `self = fileURLToPath(import.meta.url)`, which is the same path (tmp is realpath'd, no symlinks). The poll runs after `d.kill()` and `await exited`. Once the dashboard has exited it can't start another tick, and any child it started is already exec'd (libuv's spawn returns only after exec). So the poll can't pass before a pending child exists. Checked by instrumenting the poll in my copy and running the part alone (niced, `--test-concurrency=2`, own TMPDIR, DEVTEAM_* unset): 3/3 pass in 13.5 s, and 5 of the 8 dashboard stops saw a live tick child on the first poll(s) and waited for it. So the match works and does wait. Nothing was left running afterwards.
   - hub-records: the `spawnSync` import added.
   - box: the 1.1 s sleep becomes `until()` the clock's second is past `home`'s `session_created` (`display-message -t =home:`), with an added `assert.ok(created > 0)`. `until` is imported.
4. **names.mjs e8022ac 2f1b48f machine**: 57 tests at the base and 57 at the head, `diff: none`.
5. **lint.mjs** over the six parts and the fixture: no `no-undef`. The only `no-unused-vars` are `unlisted` (box) and `sib` (status), the same two the base file has (base L724, L553).
6. **Standalone and fixture.** The fixture has no test bodies. Each of its 21 exports is imported by two or more parts, or used by the fixture itself (`kitAt` by `repo`, `latestRelease` by the gh stub, `SID` by `conversation`, `rule` by `box`). Single-part code sits in its part: box-pins setup, box helpers (`lines`, `skipOld`, `claudeCalls`, `tagsMissing`, `OLD`, boxRecover…), run-folder decoys, tell's `paneState`, hub-records' helpers. The fixture's module-level effects (env scrub, its own `mkdtemp` tmp with an exit removal, stubs on PATH, the `keep` tmux session on kit.mjs's per-process server, `latestRelease = v9.9.9`, `agents` counter) are per process. The only one a test changes, `latestRelease`, is restored by the status test's `finally`. No repo name is shared across tests. local-run-1.log (at 662bbfd; `git diff 662bbfd 2f1b48f` touches only operator-threads.hub and an operator-threads entry of edits.mjs) shows each machine part passing alone: box-pins 25/25 24.5 s, box 14/14 45.5 s, hub-records 3/3 18.0 s, run-folder 6/6 39.9 s, status 5/5 43.0 s, tell 4/4 20.8 s, 0 skipped. Timing caps are CI's to judge (ruling m-20261115-165039090), not this review's.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

No findings.

Verdict: APPROVE 2f1b48f4ef8bd811747054c81eca08e8b611109e
