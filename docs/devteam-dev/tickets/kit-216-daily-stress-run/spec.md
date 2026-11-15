# kit-216 daily stress run: spec

Ticket: `kit-216-daily-stress-run` (feature `tests-light`, serves TESTS-S3, size S, risk high). Depends on kit-209 (`test/run.mjs`), merged at 7a26338.

## Intent

A test that fails only sometimes, or only when the machine is busy, should be found by a scheduled run, not by a worker's PR or by a CI run before a merge. Once a day, a GitHub workflow runs the Chrome and rest groups three times on main and names any file that failed on any repeat. The same workflow can be dispatched on a branch to stress chosen files (kit-213 and kit-214 use it this way), with extra CPU load if wanted. It runs on GitHub's runners, never on the shared box.

## Rulings

- m-20261115-171703191-supervisor: trial a-20261115-074130886 (size S). Write the spec and plan first, ask for one combined review, and send approve-spec and approve-plan together. Follow lessons k-20261115-080753394 (own HOME, hub port away from 4320, `DEVTEAM_*` unset) and k-20261115-164245020 (judge by exit code, not piped output). Multi-step shell goes in script files. Never `rm -rf` a path read from a file or a command substitution. Run only the test files touched, at `--test-concurrency=2`. This ticket touches no test file, so nothing in the kit suite runs on the box.

Review spec-1 findings F1-1 to F1-6 are folded in below, each marked with its id.

## Acceptance checks (the done-whens)

1. **Triggers, runtime, permissions.** `.github/workflows/test-stress.yml` has `on: schedule` (one daily cron) and `on: workflow_dispatch`. It uses `actions/setup-node` with `node-version: 24` and top-level `permissions: contents: read`. A scheduled run executes `node test/run.mjs --group chrome,rest --repeat 3 --concurrency 4`. GitHub runs schedules on the default branch, so a scheduled run is on main. *Check:* read the final file, actionlint passes, and the step's command line (echoed in the log) is shown for the branch run.
2. **Dispatch inputs.** Inputs:
   - `files` (string, default empty). Empty means `--group chrome,rest`. Otherwise it is a space-separated list of test files, passed as separate arguments.
   - `repeat` (string, default `3`).
   - `load` (string, default `0`). `load` CPU burners, each `node -e "for(;;){}"`, run in the background beside the tests and are killed afterwards, on success and on failure alike.

   A dispatched run always passes `--concurrency 4`. Inputs reach the step only through `env:`. No `${{ }}` appears inside any `run:` script. *Check:* a check script finds no `${{` inside any `run:` block, the embedded summary script included. That grep is the injection guard: actionlint doesn't flag `${{ inputs.* }}` inside `run:`. actionlint (with a pinned shellcheck installed, so it lints the shell too) passes (F1-4).
3. **Summary and status.** The job summary (`$GITHUB_STEP_SUMMARY`) has a table with one row per file and one column per repeat. Each cell holds that repeat's result and wall seconds, as run.mjs's summary rows report them. Failed cells and files are listed above the table. The run is red if any repeat of any file failed or timed out. A cell counts as ok only when its result, with a trailing `, near timeout` removed, is exactly `ok`. run.mjs prints a timeout as `timed out, near timeout`, and a failure can carry the flag too (F1-2). It is also red if run.mjs exited non-zero (usage error, interrupt) or printed no summary. *Check:* the branch run's summary is quoted in verification.md. The red path is checked locally by running the summary script against crafted run.mjs output, with no tests run. The step's exit is checked locally too, with `sleep` standing in for the burners: load 0 and green tests exit 0, and so on (F1-1).
4. **Proven on GitHub before merge.** While the PR is open, the branch carries a temporary `push: branches: [ticket/kit-216-daily-stress-run]` trigger. On a push event, the defaults are `files=test/search.test.mjs`, `repeat=2`, `load=2`, written as the push-only branch of each env expression. One such run completes green, and its summary is quoted in verification.md. The PR's last commit that changes anything outside `reviews/` removes the trigger and the push defaults and changes no other workflow line. The same commit fills verification.md's final-head rows, which name it as "the trigger-removal commit": a row can't hold the sha of the commit it lands in (P2-1). Review records have to land after the commit they review, so they follow it. verification.md is never changed after that commit, so it is there ahead of the final reviews (F1-3). The proving run is on the commit just before the removal. actionlint (a pinned release, checked against its sha256) passes on the final file. *Check:* run URL and quoted summary in verification.md; `git diff <removal>..HEAD -- .github/` is empty at the final head; the actionlint command and its exit code at the final head.
5. **Not a PR gate.** There is no `pull_request` trigger, and the workflow is not a required check (branch protection is unchanged; this ticket never touches it). *Check:* the final file has no `pull_request` key.

## Design

One job, `stress`, on `ubuntu-latest`, with `timeout-minutes: 240`. A full scheduled run is about 52 files × ~40 s ÷ 4 at once × 3, roughly 30 to 40 minutes; dashboard.test.mjs alone takes ~400 s per repeat. The headroom covers a dispatch with `repeat` up to its cap. It uses the same `env` as test.yml (`DEVTEAM_CGROUP`/`DEVTEAM_MEMINFO` at nonexistent paths), so the kit's memory ceiling reads no machine of its own.

Steps:

1. `actions/checkout@v5` and `actions/setup-node@v5` (node 24), the same pins as test.yml.
2. Install tmux if it is missing (as test.yml does). Chrome is preinstalled on `ubuntu-latest`, and `test/lib/chrome.mjs` finds `google-chrome`. gitleaks is not installed: `gitleaks.test.mjs` falls back to its regex check without `DEVTEAM_TEST_GITLEAKS`, which is enough for stress.
3. **Run** step. Env: `FILES`, `REPEAT`, `LOAD`, each `inputs.x` with the scheduled default (`''`, `'3'`, `'0'`). A `push` branch carries the temporary defaults until the last commit. The script:
   - validates `REPEAT` against `^[1-5]$` and `LOAD` against `^[0-8]$`: exact patterns, so `05` and `08` are refused (bash arithmetic would read `08` as octal) (F1-5). Bad input fails the step with a message (`::error::`), before anything runs.
   - refuses a `FILES` that holds a newline or tab (`read -ra` keeps only the first line), then splits it on spaces with globbing off (`set -f`, `read -ra`). Each word must match `^[A-Za-z0-9._/-]+$` and must not start with `-`, so an input can't become a run.mjs option (`--timings /x`). Empty means `--group chrome,rest`.
   - starts `LOAD` burners and records their pids. A `stop_burners` function kills them by recorded pid only, never by name or group. Every kill is `kill "$p" 2>/dev/null || true`, and the function ends `return 0`. It runs right after run.mjs exits, and again from `trap stop_burners EXIT` in case the step stops early. So cleanup never sets the step's status, including with no burners (load 0) or a burner already gone (F1-1).
   - runs `node test/run.mjs <selection> --repeat "$REPEAT" --concurrency 4`. Output goes to `$RUNNER_TEMP/stress.log` and to the log (`tee`). run.mjs's own status is taken from `PIPESTATUS[0]`, never the pipe's.
   - writes the summary (below) and exits non-zero if run.mjs did, or if the summary found a failure.
4. **Summary**, inside the run step: `node "$RUNNER_TEMP/summary.mjs" "$RUNNER_TEMP/stress.log" "$REPEAT"`. The script is written from a quoted heredoc, so the shell expands nothing in it. It starts at the last line matching run.mjs's exact header, `^summary: \d+ files?, concurrency \d+$`, and reads rows until the first line that isn't one. That deliberately skips run.mjs's `timed out:` and `failed:` lines after the rows, which it quotes above the table instead (F1-6). Each row is `^(\S+)  ([\d.]+)  (.*?)(?: \(run (\d+)\))?$`; with repeat 1 there is no `(run N)`, and the run counts as 1. It builds the table and appends it to `$GITHUB_STEP_SUMMARY`. It exits 1 if any cell is not ok by the rule in check 3 (an `ok, near timeout` cell counts as ok and is marked), or if there is no header line. The step exits with run.mjs's code when that is non-zero, else 1 if the summary failed, else 0. The code is read from `PIPESTATUS[0]` on the line right after the pipeline. The header line names the selection, repeat, load and concurrency.

Load uses `node -e "for(;;){}"` exactly. The burners are children of the step's shell, so they never outlive the job.

## Contracts

Consumes run.mjs's CLI (`--group`, `--repeat`, `--concurrency`, file arguments, exit codes 0/1/2/128+n) and its summary row format from `rowFor`: `<file>  <s.s>  <result>[, near timeout][ (run N)]`. It provides nothing that code consumes. kit-213 and kit-214 call `gh workflow run test-stress.yml --ref <branch> -f files=… -f repeat=… -f load=…`.

## Edge cases

- A file that times out shows `timed out, near timeout` in its cell (red, by check 3's rule) (F2-2); run.mjs's `timed out:` line is copied above the table.
- run.mjs exits 2 (bad file name) or is interrupted: no `summary:` line. The summary says so and the step fails.
- A file named twice: run.mjs dedupes, so the table has one row.
- `load` burners on a 4-vCPU runner, with 4 test files at once, slow the tests. That is the point; the watchdog (300/600 s) still bounds each file.
- Cancelling the run: GitHub kills the step's processes; the trap kills the burners if it gets the chance.
- A dispatch with `load=0` (also the schedule): no burners, and `stop_burners` is a no-op that returns 0.

## Out of scope

- Changing run.mjs, test.yml or branch protection. A required check is out of scope.
- Fixing any flaky file the run finds (each one becomes its own ticket).
- Running it on the box.
- Any `on: pull_request`.

## Risks

`risk: high` because a workflow takes input from a dispatch. Injection is ruled out by env-only inputs, the word and pattern checks, and the `${{`-in-`run:` grep (actionlint and shellcheck lint the rest). The burners are bounded by the trap and the job's lifetime. Final review needs two reviewers from other sessions.
