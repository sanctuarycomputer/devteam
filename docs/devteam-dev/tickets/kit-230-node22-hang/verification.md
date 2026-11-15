# kit-230-node22-hang: verification

Code at **0c3d2148d0e4f525815c7329b082fb88c16e0e4c**: Task 1 at b355604, Task 2 at 0c3d214. Commits after it add only ticket records. The box is Node 22.23.4 and 24.14.1 (mise), bash 5.2.15 and chromium 156. Per the box rule, the only test file run is the touched one, at `--test-concurrency=2`.

| Done-when | Command | Result |
|---|---|---|
| 1. test.yml's kit jobs pass `--test-timeout`, so a hung test fails in minutes with its name in the log | Read `.github/workflows/test.yml`; probes A and B below; CI rows below | `--test-timeout=600000` on Node 20, 22 and 24 through `matrix.test_timeout`; nothing on 18, which rejects it (probe A). `timeout-minutes: 12` on all three test steps. An `if: failure()` step runs `ps -eww -o pid,ppid,etimes,args`, which shows the hung file's own process after a step-style kill (probe B). The job names are unchanged (8 jobs, `kit (18, chain)` … `kit (24, rest)`). |
| 2. The hanging test is found from the log and fixed, with the cause in the PR | Probes C, D and E below; `node $D gate test -- mise exec node@22.23.4 -- node --test --test-concurrency=2 test/hub-overview.test.mjs`, and the same with `node@24.14.1` | Found: `test/hub-overview.test.mjs`, "the Overview in Chrome" (probe C). Fixed: the gate passed 19/19 on 22 (40.6 s) and 24 (41.2 s) at b355604. With the old failure injected, the file exits and leaves nothing (probe D). The real test passed 10 of 10 runs on 22 (probe E). The cause is in PR #248's body. |
| 3. Three consecutive runs of the job on the PR pass; no other job slows | `node $D gate ci -- gh run watch <id> -R sanctuarycomputer/devteam --exit-status --interval 60`, per run | See "CI on the PR" below. |
| 4. No file is added outside test/ and the workflow | `git diff --name-only origin/main...HEAD` | See "Files changed" below. |

`$D` is `/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs`.

## A. `--test-timeout` per major

The probe file `f.test.mjs` holds one test that passes and leaves a detached child holding a stdout pipe, which is this hang's shape. It is run as `node --test <flags> f.test.mjs` under `timeout -k 2 15`.

```
18.20.4 [--test-timeout=3000] exit=9 secs=0 bad option
18.20.4 [--test-force-exit] exit=9 secs=0 bad option
20.19.6 [--test-timeout=3000] exit=1 secs=4 timed out after 3000ms
20.19.6 [--test-force-exit] exit=0 secs=0
22.23.4 [--test-timeout=3000] exit=1 secs=3 timed out after 3000ms
22.23.4 [--test-force-exit] exit=0 secs=0
24.14.1 [--test-timeout=3000] exit=124 secs=16          (never ended: the outer timeout killed it)
24.14.1 [--test-force-exit] exit=0 secs=0
```

- Node 18 rejects both flags.
- On 20 and 22, `--test-timeout` kills the file and names it (`not ok - f.test.mjs`, `test timed out after 3000ms`).
- On 24 it doesn't end the file.
- `--test-force-exit` ends it on 20 to 24, but the run passes, so the leak would be hidden. That is why it isn't used.

## B. The failure-only listing after a step-style kill

The run line `node --test probe.test.mjs` (Node 24.14.1, the same leaking probe) sits in a script file run with `bash -e`, as the runner runs a step. After 5 s only the shell is killed, as a step timeout does. The listing is shown filtered to the probe's pids:

```
bash pid 1063117; node --test runner pid 1063119 (distinct: yes)
shell gone
--- ps -eww -o pid,ppid,etimes,args, for the probe's pids:
    PID    PPID ELAPSED COMMAND
1063119       1       6 …/node/24.14.1/bin/node --test probe.test.mjs
1063142 1063119       6 …/node/24.14.1/bin/node --heap-prof-interval=524288 … --test-isolation=process … probe.test.mjs
1063162 1063142       6 sleep 120
left after cleanup: none
```

The file's own process names the file at the end of its command line. Node 24 puts a long flag list before it, so the listing needs `-ww`.

This is shown on the box only. On a real runner, the step-timeout path (the listing step running after a timed-out step) is backed by the actions/runner source the spec cites, not by a CI run that hung (task-2 review T2-1).

## C. Finding the test

Cancelled job 132671175371 (07f7d1b) and job 132695312582 (fb7ad8d) were both `kit (22, rest)`.

- The TAP output stops after `test/host-claim.test.mjs` (02:32:41, then nothing until the cancel at 02:57:38). The runner prints files in order, and the next file is `test/hub-overview.test.mjs`.
- At the cancel, both jobs show the same 12 orphans, which are this test's processes: `chrome`, 2× `chrome_crashpad_handler`, 2× `cat` (the google-chrome wrapper's), and 7× `node` (the dashboards and their watchers). The passing 22 rest jobs 132696802758 and 132694443231 show none.
- Locally on 22.23.4, `--test-name-pattern=Overview.in.Chrome`, before the fix, run 3 of a loop failed:

```
not ok 1 - the Overview in Chrome: …
  failureType: 'hookFailed'
  error: "ENOTEMPTY: directory not empty, rmdir '/data/home/tmp/devteam-hub-ov-8NFStL'"
  … TestContext.<anonymous> (file:///…/test/hub-overview.test.mjs:130:20)
```

20 s later the file's process and both dashboard watchers were still running (`ep_poll`). An earlier loop had hung the same way until the 300 s bound.

- Hook semantics (`e.test.mjs`: three `t.after`, the first throws): on 18.20.4, 20.19.6, 22.23.4 and 24.14.1, only hook 1 runs. Hooks run in the order they were added, and a throwing one skips the rest.

## D. The fix, with the old failure injected

On Node 22.23.4, the Chrome test's first `defer` step (the folder removal) was replaced with a throw of `ENOTEMPTY`. Each process seen during the run was recorded each second; nothing was killed by pattern. The injection was reverted afterwards with `git checkout`.

```
runner exited: status 1 after 18s (not ok seen at 17s)
not ok 1 - the Overview in Chrome: …
  failureType: 'hookFailed'
  error: "ENOTEMPTY: directory not empty, rmdir '/data/home/tmp/devteam-hub-ov-C7xiLs'"
test folder: devteam-hub-ov-C7xiLs; processes seen during the run: 18
left alive by pid: none
left alive by folder: none
reverted
```

The cleanup's own tests (`--test-name-pattern=cleanup`, 4 tests) pass on 22.23.4. The pass-1 review's T1-1 assertion failed against the old line before the fix.

## E. The real test, repeated

On Node 22.23.4 at f0763b6, the Chrome test ran 10 times, each bounded at 280 s: 10 ok, 0 not ok, and every run's process exited on its own. Before the fix, the same loop failed about 1 in 10.

## CI on the PR (sanctuarycomputer/devteam#248)

Job durations (s) are compared with the last 10 green push-to-main runs:

| Job | main median | main max | run 1 (43682089828, 0c3d214) | run 2 | run 3 |
|---|---|---|---|---|---|
| kit (18, chain) | 190 | 233 | 251 | | |
| kit (18, rest) | 286 | 380 | 278 | | |
| kit (20, chain) | 182 | 225 | 172 | | |
| kit (20, rest) | 252 | 335 | 266 | | |
| kit (22, chain) | 172 | 214 | 156 | | |
| kit (22, rest) | 336 | 398 | 337 | | |
| kit (24, chain) | 208 | 222 | 161 | | |
| kit (24, rest) | 333 | 434 | 349 | | |

Run 1: 8/8 success (`gate ci passed in 373.3s`).

## Files changed

Filled in at the final head.
