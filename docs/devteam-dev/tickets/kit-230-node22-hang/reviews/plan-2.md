# Plan review, pass 2

- Reviewer: plan-confirm (fresh subagent, claude-opus)
- Reviewed: ac2e8b95b6ea70e117b9ba9d614457ed3ca1d051

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P2-1 | Important | AC1 check (verification shows the listing against a probe that leaks a child); Review focus 5; P4's disposition ("the probe starts under bash -c and only that shell's pid is killed, as the runner does") | T2 Step 3, second bullet (`bash -c 'node --test probe.test.mjs'`, then "kill only that shell's pid") | P4 is not resolved as written. When `bash -c` gets a single simple command, it execs that command and does not fork it. I probed this on the box (bash 5.2.15): `bash -c 'sleep 3'` leaves no bash process, and `sleep` takes the shell's pid. So "that shell's pid" is the `node --test` runner itself. Killing it signals the runner, not a shell above it. The probe no longer copies what Actions does: Actions runs the step as a script file (`bash -e {0}`), which keeps a real shell above `node`. The step's expected result ("Show the `node --test` runner, the probe's file process and its child") then either fails or shows something that doesn't match CI. Fix: keep a real shell. Write the run line to a script file in scratch and run it with `bash -e <file>`, the way the runner does, or stop the exec with `bash -c 'node --test probe.test.mjs; true'`. Then kill only the bash pid, which must be checked to be a distinct pid from the runner's. | |

I checked the other dispositions against the diff and they are resolved as stated:
- **P1:** the step timer is ref'd and cleared once the step settles, and the plan says why.
- **P2:** an explicit `name: kit (${{ matrix.node }}, ${{ matrix.part }})` reproduces today's default names (job id `kit`, matrix keys in the order node, part). The include entries use numbers. Step 4 also expects every job "under the same names".
- **P3:** processes are matched by the test's `devteam-hub-ov-…` folder and by Chrome's pid from the run's tree, not by process group, and nothing is killed by pattern.
- **P5:** `holder` defers `s.listening && new Promise((r) => s.close(r))`. `net.Server.close()` nulls the handle synchronously, so `listening` is false after the body closes the server and the step is skipped. In the holder test, `imageKit(t)` and `hubMachine(t, …)` register first and synchronously, so S2's invariant holds. With last-added-first, each server closes before its machine's folder is removed.
- **P6, P7, P9:** each has its step in T2 (probe results into verification.md; per-job durations against the median and max of the last 10 green main runs, plus step maxima; `git diff --name-only origin/main...HEAD`).
- **P8:** `assert.rejects(c.run(), /^Error: c$/)` is correct. A RegExp is matched against the error's string form, `Error: c`.
- **S1:** `D=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs` exists, and mise has node@22.23.4 and node@24.14.1 installed.
- **S2:** `defer`'s comment is specified.

The new line numbers match `test/hub-overview.test.mjs` at ac2e8b9: `t.after` at 202, 212, 215, 218, 220, 274, 276, 301, 308, 325, 340, 368, 455, 468 and 487, and `holder` at 379. The new Rulings line (kit-50 merged, main merged at 83c4eab) adds nothing wrong.

Verdict: CHANGES ac2e8b95b6ea70e117b9ba9d614457ed3ca1d051
