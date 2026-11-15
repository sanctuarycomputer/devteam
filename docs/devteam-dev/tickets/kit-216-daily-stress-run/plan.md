# kit-216 daily stress run: implementation plan

## TL;DR

- One new file, `.github/workflows/test-stress.yml`: one job that runs `test/run.mjs` daily on main (`--group chrome,rest --repeat 3 --concurrency 4`) and on dispatch (`files`, `repeat`, `load`).
- Inputs reach the shell only through `env:`. The script checks them (repeat 1–5, load 0–8, file words `^[A-Za-z0-9._/-]+$` that don't start with `-`) before anything runs.
- The job summary is built by a small Node script written from a quoted heredoc inside the step. It shows one row per file and one column per repeat, and the step is red on any non-ok cell, a missing `summary:` line, or a non-zero run.mjs exit.
- Three tasks. T1: the workflow with a temporary push trigger, plus a local check of the summary script against crafted logs (no tests run on the box). T2: push and get one green GitHub run with files=test/search.test.mjs, repeat=2, load=2, and quote its summary. T3: remove the trigger in the last commit, and run actionlint (pinned and sha256-checked).
- No kit test file changes, so no kit test runs on the box (ruling m-20261115-171703191-supervisor). GitHub CI (`test.yml`) stays the gate for the PR.
- Executed inline (executing-plans), with a fresh-subagent review per task. Two final reviews come from other sessions (risk high).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily (and dispatchable) GitHub workflow stress-runs the kit's Chrome and rest test groups and names every file that failed on any repeat.

**Architecture:** A single-job workflow. It calls `test/run.mjs` (kit-209), which already repeats, times out and cleans up files. The workflow adds input checking, CPU burners, and a job summary parsed from run.mjs's `summary:` rows.

**Tech Stack:** GitHub Actions (`actions/checkout@v5`, `actions/setup-node@v5`, Node 24), bash, Node built-ins, actionlint (pinned release).

**Spec:** `docs/devteam-dev/tickets/kit-216-daily-stress-run/spec.md`.

## Rulings

- m-20261115-171703191-supervisor: spec and plan go to one combined review; approve-spec and approve-plan are asked for together. Lessons k-20261115-080753394 and k-20261115-164245020 apply: judge every check by its exit code, never by piped output. Multi-step shell goes in script files. No `rm -rf` of a path from a file or a command substitution. Only the test files touched run, at `--test-concurrency=2` (none here).

## Global Constraints

- Only `.github/workflows/test-stress.yml` changes outside this ticket folder.
- `permissions: contents: read` at the top level. `node-version: 24`. No `pull_request` trigger.
- The scheduled command is exactly `node test/run.mjs --group chrome,rest --repeat 3 --concurrency 4`. A dispatch always uses `--concurrency 4`.
- No `${{ }}` inside any `run:` block. Inputs go through `env:` only.
- Burners are exactly `node -e "for(;;){}"`, killed by recorded pid in an EXIT trap.
- run.mjs's status is read from `PIPESTATUS[0]`.
- Helper scripts for local checks live in this ticket folder and are run as files.

## Review Focus

1. `files` input with a leading `-` or shell metacharacters (`--timings /etc/x`, `$(id)`, `*`): rejected before run.mjs starts, and never expanded. T1's local check covers the parsing in a copy of the step's validation (see T1 step 2).
2. `repeat=1`: rows carry no `(run N)`, and the table still has one column. Covered by a crafted log in T1.
3. run.mjs exits 2 or prints no `summary:` line: the summary says so and the step is red. Covered by a crafted log in T1.
4. A `timed out` or `failed (signal SIGKILL)` cell, and an `ok, near timeout` cell: the first two are red; the third is green but marked. Covered by a crafted log in T1.
5. A burner left running after a failed test step: the EXIT trap kills it. Checked on the GitHub run's log (T2): the step's last lines show the burners killed.

---

### Task 1: The workflow, with a temporary push trigger, and the summary script checked locally

**Files:**
- Create: `.github/workflows/test-stress.yml`
- Create: `docs/devteam-dev/tickets/kit-216-daily-stress-run/check-summary.sh` (extracts the heredoc's summary script from the workflow, then runs it against crafted logs)
- Create: `docs/devteam-dev/tickets/kit-216-daily-stress-run/fixtures/*.log` (crafted run.mjs output)

**Interfaces:**
- Consumes: run.mjs rows `<file>  <s.s>  <result>[, near timeout][ (run N)]` after a `summary: <n> file(s), concurrency <c>` line; exit codes 0/1/2/128+n.
- Produces: `summary.mjs <log> <repeat>`, which appends markdown to `$GITHUB_STEP_SUMMARY` (or stdout when it is unset) and exits 0 when every cell is ok, 1 otherwise.

- [ ] **Step 1: Write the crafted logs and `check-summary.sh`.** Logs:
  - `green-r2.log`: two files, both ok in runs 1 and 2, one `ok, near timeout`. Expect exit 0, with the near-timeout cell marked.
  - `red-r3.log`: one file `failed (exit 1) (run 2)`, one `timed out (run 3)`, plus run.mjs's `timed out: …` line. Expect exit 1, both failures listed above the table, and the `timed out:` line quoted.
  - `r1.log`: repeat 1, no `(run N)`. Expect exit 0 and one column.
  - `nosummary.log`: a usage error with no `summary:` line. Expect exit 1 and "no summary".
  - `signal.log`: `failed (signal SIGKILL) (run 1)`. Expect exit 1.

  The script pulls the lines between `cat > "$RUNNER_TEMP/summary.mjs" <<'EOF'` and the matching `EOF` out of the workflow with awk, into a `mktemp -d` dir, and strips the YAML indentation. It runs `node summary.mjs <log> <repeat>` for each log, checks the exit code and greps the output for the expected text. It prints `ok`/`FAIL` per case and exits non-zero on any FAIL. Cleanup is `rm -rf "${T:?}"`, where `T` comes from `mktemp -d` in the same script (never read from a file).
- [ ] **Step 2: Run it before the workflow exists.** Expect it to fail (no workflow file). Also add `check-inputs.sh`: it pastes in the step's validation block, extracted from the workflow the same way between `# --- inputs ---` and `# --- end inputs ---` markers, and runs it with `FILES`/`REPEAT`/`LOAD` set. Cases: `--timings /x` is rejected, `$(id)` is rejected, `*` is rejected, `test/a.test.mjs test/b.test.mjs` is accepted as 2 args, empty selects `--group chrome,rest`, repeat `0`/`6`/`x` are rejected, load `9` is rejected.
- [ ] **Step 3: Write `test-stress.yml`.** Triggers: `schedule` (`cron: '23 6 * * *'`), `workflow_dispatch` with the three string inputs (descriptions as in spec check 2), and a temporary `push: branches: [ticket/kit-216-daily-stress-run]`. Top-level `permissions: contents: read`, and `concurrency: { group: test-stress-${{ github.ref }}, cancel-in-progress: false }`. Job `stress`: `runs-on: ubuntu-latest`, `timeout-minutes: 240`, env `DEVTEAM_CGROUP`/`DEVTEAM_MEMINFO` as in test.yml. Steps: checkout, setup-node 24, the tmux install line from test.yml, then the run step:
  - env:
    - `FILES: ${{ github.event_name == 'push' && 'test/search.test.mjs' || inputs.files }}`
    - `REPEAT: ${{ github.event_name == 'push' && '2' || inputs.repeat || '3' }}`
    - `LOAD: ${{ github.event_name == 'push' && '2' || inputs.load || '0' }}`

    On a schedule, `inputs.*` are empty, so the defaults apply.
  - script: `set -euo pipefail`, then the `# --- inputs ---` block (it builds the array `SEL`), the summary heredoc, burners with `trap`, then `node test/run.mjs "${SEL[@]}" --repeat "$REPEAT" --concurrency 4 2>&1 | tee "$RUNNER_TEMP/stress.log"` inside `set +e` with `rc=${PIPESTATUS[0]}`. After that come `set -e`, the summary run (`node "$RUNNER_TEMP/summary.mjs" … || s=1`), and `exit` with rc, or 1 if the summary failed. It echoes the exact command line before running it.
- [ ] **Step 4: Run both check scripts.** Expect exit 0 from each (judge by `$?`).
- [ ] **Step 5: Task review** by a fresh subagent: `reviews/task-1.md`. Commit the workflow, the scripts and the fixtures.

### Task 2: One green run on GitHub

- [ ] **Step 1:** `git push -u origin ticket/kit-216-daily-stress-run`. The push trigger starts `test-stress` on the branch. Find it with `gh run list --workflow test-stress.yml --branch ticket/kit-216-daily-stress-run --limit 1 --json databaseId,status,conclusion`.
- [ ] **Step 2:** Wait for it with Monitor (an until-loop on `gh run view <id> --json status`), not foreground sleeps. Expect `conclusion: success`.
- [ ] **Step 3:** Fetch the summary and log lines through a script file (`fetch-run.sh <id>`, in this folder) that saves `gh run view <id> --log` to a file under the worktree's ticket folder for reading. Confirm the echoed command line is `node test/run.mjs test/search.test.mjs --repeat 2 --concurrency 4` with 2 burners, and that the burners were killed at the end. The job summary itself is read with `gh api` on the run's check-run output, or from the log's markdown echo if the API doesn't expose it. To make it readable from the log either way, the step also `cat`s the summary markdown it writes.
- [ ] **Step 4:** Record the run URL and the quoted summary in `verification.md`. If it is red, debug with systematic-debugging; a test that only fails under load is a finding for the supervisor, not something to fix here.

### Task 3: Remove the trigger; actionlint on the final file

- [ ] **Step 1:** Write `actionlint.sh` (this folder): it downloads actionlint v1.7.7 linux_amd64 into a `mktemp -d` dir, checks it against the release's published sha256 (fetched from its `checksums.txt` and pinned in the script), runs it on `.github/workflows/test-stress.yml`, and exits with actionlint's status.
- [ ] **Step 2:** Remove `push:` and the three `github.event_name == 'push' && … ||` prefixes. Run `actionlint.sh` and both check scripts; expect exit 0 from each. `grep -n 'pull_request' .github/workflows/test-stress.yml` must exit 1. A check that no `${{` sits inside a `run:` block is part of `check-inputs.sh`.
- [ ] **Step 3:** Task review `reviews/task-3.md`. Make this the PR's last code commit; review records and verification may follow, since they change no workflow file. Then come the final reviews, `check-ticket` and the merge request.

## Verification

`verification.md` has a row per done-when: the command (or run URL), its exit code or conclusion, and the commit. Done-when 4's run is at T1's commit, and actionlint is at the final head.
