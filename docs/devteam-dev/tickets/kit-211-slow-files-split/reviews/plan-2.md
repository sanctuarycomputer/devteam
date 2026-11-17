# Plan review, pass 2

- Reviewer: plan-reviewer 2 (fresh subagent, claude-opus-5-5)
- Reviewed: 20f2833a0715b03014ec4ad4fe5095eb34fc9de1 (plan.md and the T6 probe)

What I read: reviews/plan-1.md with its dispositions; `git diff 662bbfd 20f2833` for the ticket folder and test/ (plan.md, edits.mjs, the new probe.mjs and probe-run.mjs, test/operator-threads.hub.test.mjs); spec.md; quality.md §3; test/lib/kit.mjs (`fleetFixture`, `threadsFixture`, `startDashboard`, the exit hooks); test/lib/chrome.mjs; test/run.mjs (child env); and the base's hooks in pane-question.test.mjs and operator-threads.test.mjs at e8022ac.

What I ran: one probe-run case, using the same logic from a private scratch folder. It was the base side of "one click is one answer", on Node 22.23.4, under nice, with its own TMPDIR and HOME, DEVTEAM_* and TMUX* unset. Results:
- The name pattern `^` plus the escaped title ran exactly that one test. Node 22 doesn't report the filtered-out tests.
- The test process never exited. spawnSync killed it at 180 s, and PROBE_OUT was empty. The 'exit' check never ran, and the TAP summary (`# pass`/`# fail`) was never printed. Only `not ok 1 - …` appeared.
- The second look by the run's TMPDIR found 3 live processes (the dashboard's group) and killed them. Nothing naming the run was left afterwards. My copy of the base file was removed.
- The test body itself failed too ("timed out waiting for the question, from the hello child", after 163 s). That may come from my HOME override or from load on the box. It isn't part of the finding below, but T6 should show that each case's body passes under the probe's environment.

Pass 1:
- I1: fixed as written. probe.mjs scans /proc args and environ for the noted folders, plus noted children. But see I3: at the base the scan never runs.
- I2: fixed. The run gets its own TMPDIR, DEVTEAM_*/TMUX* are unset, survivors are killed, and a second look by the run's folders and TMPDIR follows. I saw the second look work. HOME isn't isolated, but that matches run.mjs, so I'm not raising it.
- M1: fixed. M2: fixed. edits.mjs and the hub file agree: kill-session is registered first and dash.stop() second, and the comment says why.
- M3: fixed in text. probe-run fails a base case that's expected to leave processes but doesn't. That check is what exposes I3.
- M4: fixed. `esc` covers the full regex set, the pattern is anchored, it's built in node, and no shell is involved.
- M5: fixed. M6: fixed.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| I3 | Important | done-when 6 (the probe must tell base from head); quality §3 | probe.mjs `process.emit` 'exit' check; probe-run.mjs `ran`/`sum` | At the base, every case marked `expectBase` skips a hook that would let go of a referenced child: `d.stop()` (the dashboard is spawned with piped, ref'd stdio), `live.kill()` (`spawn('sleep', ['600'])`), and `a.kill()` plus the hub kill (the hub's stdio is piped and ref'd). With a ref'd child left, the test process never drains, so 'exit' never fires and probe.mjs writes nothing. I saw this on "one click is one answer": SIGKILL at 180 s and an empty PROBE_OUT. probe-run then reads `left` as null and `ran` as false (it looks for the summary lines, which are never printed), and sets `bad`. So T6's check "probe-run.mjs exits 0" can't pass. The base and the head differ only as "hung" versus "exited", which isn't recorded as leftovers. That's also about 8 × 180 s of waiting. Fix: take the survivor list when the test has finished (its hooks run), not on 'exit'. For example, use an in-process `--test-reporter` module that scans on the case's `test:pass`/`test:fail` event, or a timer once the root test ends. Or count a timeout as "left", the original plan's rule, using the second look by TMPDIR as the list. Detect "ran" from `^(not )?ok 1 - ` rather than the summary. | fixed: probe.mjs takes the list in a root-level after() hook (after the tests' own hooks, before exit listeners) and exits a second later; ran is read from the test's own result line |
| I4 | Important | quality §3 (safe to run on a shared box) | probe-run.mjs `killAll` | `process.kill(-p.pgid, 'SIGKILL')` doesn't exclude probe-run's own process group. The test process is spawned without `detached`, so any non-detached child of the test shares probe-run's pgid, and with it the group of the shell job that started probe-run. One example is the claims test's `live = spawn('sleep', ['600'])`. Once I3 is fixed and `live` is reported, killAll SIGKILLs probe-run and its job mates. It's hidden today only by the hang. Skip a pgid equal to probe-run's own (read /proc/self/stat), or spawn each run `detached` and kill only groups other than probe-run's. | fixed: killAll never signals probe-run's own process group |
| M7 | Minor | robustness | probe-run.mjs L119, L144 | The base copies under test/ (`zz-probe-base-*.test.mjs`) are removed only on a normal finish, not in a `finally`. A crash or Ctrl-C leaves them where `ls test/*.test.mjs` (test.yml, run.mjs) picks them up. | fixed: base copies removed in a finally |

Verdict: CHANGES 20f2833a0715b03014ec4ad4fe5095eb34fc9de1
