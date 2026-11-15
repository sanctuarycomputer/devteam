# kit-216-daily-stress-run: verification

This ticket changes one file, `.github/workflows/test-stress.yml`, and no kit test, so the box runs no kit test file (ruling m-20261115-171703191-supervisor). Instead:

- **Local checks.** The scripts in this folder pull the workflow's own text apart and run it against crafted logs and stubs, with no load. Each exits non-zero on any failed case, and each was judged by its exit code.
  - `check-summary.sh`: the summary script.
  - `check-inputs.sh`: the input checks, plus the no-`${{`-in-`run:` scan.
  - `check-exit.sh`: burner cleanup and exit logic, with `sleep` standing in for the burners.
  - `mutate.sh`: shows that each check fails on a broken copy of the workflow.
  - `actionlint.sh`: actionlint 1.7.7 with shellcheck 0.10.0, both sha256-checked.
- **GitHub.** The branch carried a temporary push trigger, so GitHub ran the branch's own file (done-when 4).

**Commits.** The proving run is at **3203cec5b5acdb44066abc1df0eae073c4735587**: the last commit that changed the workflow before the trigger's removal. Main was merged in at 3f7c88e, which changes neither the workflow nor `test/run.mjs`. The final-head rows (marked "trigger-removal commit") are filled in by the commit that removes the trigger. That commit changes no other workflow line, so the file it leaves is the file merged.

## The proving run

Run [43743793354](https://github.com/sanctuarycomputer/devteam/actions/runs/43743793354): event `push`, head 3203cec, job `stress`, conclusion **success**. The push defaults gave `files=test/search.test.mjs repeat=2 load=2`. Its log:

```
+ node test/run.mjs test/search.test.mjs --repeat 2 --concurrency 4 (burners: 2)
...
summary: 1 file, concurrency 4
test/search.test.mjs  11.0  ok (run 1)
test/search.test.mjs  9.1  ok (run 2)
stopped 2 burners
```

Its job summary, as written to `$GITHUB_STEP_SUMMARY` and echoed to the log:

```
## test-stress: test/search.test.mjs, repeat 2, load 2, concurrency 4

All 1 file passed on every repeat.

| File | Run 1 | Run 2 |
|---|---|---|
| `test/search.test.mjs` | ok 11.0 s | ok 9.1 s |
```

## Done-whens

| # | Done-when | Command or evidence | Result |
|---|---|---|---|
| 1 | Daily schedule and workflow_dispatch, Node 24, `permissions: contents: read`; scheduled, it runs `node test/run.mjs --group chrome,rest --repeat 3 --concurrency 4` on main | The final file: `on.schedule` cron `23 6 * * *`, `on.workflow_dispatch`, `actions/setup-node@v5` with `node-version: 24`, top-level `permissions: contents: read`. On a schedule `inputs.*` are empty, so the env gives `FILES=''`, `REPEAT=3`, `LOAD=0`, and the script builds `--group chrome,rest`. `check-inputs.sh` case `empty` gives exactly `--group chrome,rest`; `check-exit.sh` pins the command as `test/run.mjs --group chrome,rest --repeat 1 --concurrency 4` (REPEAT=1 in the probe). Schedules run on the default branch only | as stated; checks exit 0 (rows below) |
| 2 | Inputs files (empty means the groups, otherwise space-separated files), repeat (default 3), load (default 0: that many `node -e "for(;;){}"` burners beside the tests, killed after); a dispatched run uses `--concurrency 4`; inputs reach the step only through `env:` | `check-inputs.sh`: 21 input cases, among them `--timings /x`, `$(id)`, a backtick, `*`, `;`, a newline, a tab, `05` and `08` refused, and two files split into two arguments. The scan finds no `${{` in any `run:` block, the summary heredoc included. `check-exit.sh`: 8 cases. With load 0 or 2, green or red, one burner already dead, an early exit (the trap) and run.mjs exit 2 or 130, the step's code is run.mjs's (else the summary's), and every burner is gone afterwards by pid | exit 0, exit 0 |
| 3 | Job summary lists each file with its result per repeat; the run is red if any repeat of any file failed | `check-summary.sh`, 8 cases on crafted logs. The cases: green with a near-timeout cell; `failed (exit 1)` and `timed out, near timeout` red and listed, with the `timed out:` line quoted; `failed (exit 1), near timeout` red; repeat 1 with no `(run N)`; no summary line red; a signal red; a `summary:` line in a test's own output ignored; a missing repeat red as `not run`. The GitHub run's summary is above | exit 0; summary as quoted |
| 4 | The PR branch carries a temporary push trigger for its own branch, and one run with files=test/search.test.mjs repeat=2 load=2 completes green with its summary quoted; the trigger is removed in the PR's last commit; actionlint (a pinned release) passes on the final file | Run 43743793354 above. The trigger is removed by the trigger-removal commit, the last commit to change anything outside `reviews/`. `actionlint.sh` | green at 3203cec; final-head rows below |
| 5 | Not on pull_request, not a required check | `grep -n pull_request .github/workflows/test-stress.yml` (final-head row below). The workflow never runs for a PR, so it can't post a check there; this ticket changes no branch protection | final-head row below |

## Local checks at 3f7c88e (the trigger still in)

| Check | Command | Result |
|---|---|---|
| summary script | `bash docs/devteam-dev/tickets/kit-216-daily-stress-run/check-summary.sh` | exit 0, 8 of 8 ok |
| inputs and no `${{` in `run:` | `bash docs/devteam-dev/tickets/kit-216-daily-stress-run/check-inputs.sh` | exit 0, 23 of 23 ok |
| burners and exit | `bash docs/devteam-dev/tickets/kit-216-daily-stress-run/check-exit.sh` | exit 0, 8 of 8 ok |
| the checks catch breakage | `bash docs/devteam-dev/tickets/kit-216-daily-stress-run/mutate.sh` | exit 0. All 9 mutants are caught: no trap, no explicit stop, an unguarded kill, `--concurrency 2`, run.mjs's code dropped, near timeout taken as ok, the first header taken, the dash check dropped, `${{` in `run:`. `rc=$?` in place of `PIPESTATUS[0]` is an equivalent mutant under pipefail, so it isn't listed |
| actionlint | `bash docs/devteam-dev/tickets/kit-216-daily-stress-run/actionlint.sh` | exit 0 |

## Final-head rows (the trigger-removal commit)

These rows were run on the working tree that is committed as the trigger-removal commit. That commit removes `push:` with its two comment lines and the three `github.event_name == 'push' && '…' ||` prefixes, changes no other workflow line, and adds these rows. A row can't name its own commit's sha (P2-1). At the final head, `git diff <trigger-removal commit>..HEAD -- .github/` is empty.

| Check | Command | Result |
|---|---|---|
| run just before the removal | Run [43743999609](https://github.com/sanctuarycomputer/devteam/actions/runs/43743999609): push at bb5c7d4, the verification commit right before the trigger-removal commit | **success**. The same command line and burners as 43743793354; `test/search.test.mjs  10.1  ok (run 1)`, `10.5  ok (run 2)`, `stopped 2 burners`; summary `All 1 file passed on every repeat.` with the row `` `test/search.test.mjs` | ok 10.1 s | ok 10.5 s `` |
| no push or pull_request trigger | `grep -nE '^\s*(push\|pull_request\|pull_request_target):' .github/workflows/test-stress.yml` | exit 1 (no match). The only triggers are `schedule:` (line 8) and `workflow_dispatch:` (line 10) |
| no secrets, no environment | `grep -nE 'secrets\.\|^\s*environment:' .github/workflows/test-stress.yml` | exit 1 (no match) |
| permissions, concurrency, timeout | read the file | `permissions: contents: read` (lines 27-28, top level); `concurrency:` at line 29 (`group: test-stress-${{ github.ref }}`, `cancel-in-progress: false`); `timeout-minutes: 240` on the only job (line 36) |
| env from inputs only | the stress step's env | `FILES: ${{ inputs.files }}`, `REPEAT: ${{ inputs.repeat \|\| '3' }}`, `LOAD: ${{ inputs.load \|\| '0' }}` |
| summary script | `check-summary.sh` | exit 0, 8 of 8 ok |
| inputs and no `${{` in `run:` | `check-inputs.sh` | exit 0, 23 of 23 ok |
| burners and exit | `check-exit.sh` | exit 0, 8 of 8 ok |
| the checks catch breakage | `mutate.sh` | exit 0, 9 of 9 mutants caught |
| actionlint (done-when 4) | `actionlint.sh`: actionlint 1.7.7 (sha256 `023070a2…0757`) with shellcheck 0.10.0 (sha256 `6c881ab0…df87`) | exit 0, no findings |

## The supervisor's condition (m-20261115-174531437-supervisor)

Top-level `permissions: contents: read`; no `secrets.` and no `environment:`; `concurrency: group: test-stress-${{ github.ref }}`; `timeout-minutes: 240` on the one job; triggers `schedule` and `workflow_dispatch` only, never pull_request (the push trigger only until the trigger-removal commit). Checked in the final-head rows.
