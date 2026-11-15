# kit-216 daily stress run: implementation plan

## TL;DR

- One new file, `.github/workflows/test-stress.yml`: one job that runs `test/run.mjs` daily on main (`--group chrome,rest --repeat 3 --concurrency 4`) and on dispatch (`files`, `repeat`, `load`).
- Inputs reach the shell only through `env:`. The script checks them before anything runs: repeat `^[1-5]$`, load `^[0-8]$`, no newline or tab in files, and file words `^[A-Za-z0-9._/-]+$` that don't start with `-`.
- The job summary is built by a small Node script written from a quoted heredoc inside the step. It shows one row per file and one column per repeat. A cell is ok only if it is exactly `ok` once a trailing `, near timeout` is dropped. The step is red on any non-ok cell, a missing header, or a non-zero run.mjs exit. Burner cleanup (`kill … || true`, `return 0`) can never change the status.
- Three tasks:
  - T1: the workflow with a temporary push trigger, plus local checks of the summary script, the input checks and the step's exit and cleanup. These use crafted logs and `sleep` stand-ins; no tests and no load run on the box.
  - T2: push, get one green GitHub run with files=test/search.test.mjs, repeat=2, load=2, and quote its summary.
  - T3: commit verification.md, then remove the trigger as the last non-record commit, and run actionlint and shellcheck (both pinned and sha256-checked).
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
5. Burner cleanup on every path: no burners (load 0, the daily run), a burner already dead, and tests that fail. The step's status stays run.mjs's and the summary's, and no burner survives. Covered by `check-exit.sh` in T1 (P1-1).

Review plan-1 findings P1-1 to P1-6 (and spec-1's F1-1 to F1-6) are folded into the tasks below, each marked with its id.

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
  - `red-r3.log`: one file `failed (exit 1) (run 2)`, one `timed out, near timeout (run 3)` (the only form run.mjs prints for a timeout), plus run.mjs's `timed out: …` and `failed: …` lines after the rows. Expect exit 1, both failures listed above the table, the `timed out:` line quoted, and the `failed:` lines not taken as rows (P1-2, F1-6).
  - `red-near.log`: `failed (exit 1), near timeout (run 1)`. Expect exit 1 (P1-2).
  - `r1.log`: repeat 1, no `(run N)`. Expect exit 0 and one column.
  - `nosummary.log`: a usage error with no `summary:` line. Expect exit 1 and "no summary".
  - `signal.log`: `failed (signal SIGKILL) (run 1)`. Expect exit 1.
  - `twosummary.log`: a test's own output contains a line starting `summary:` before run.mjs's real header. Expect the table built from the last exact header only (F1-6).

  The script pulls the lines between `cat > "$RUNNER_TEMP/summary.mjs" <<'EOF'` and the matching `EOF` out of the workflow with awk, into a `mktemp -d` dir, and strips the YAML indentation. It runs `node summary.mjs <log> <repeat>` for each log, checks the exit code and greps the output for the expected text. It prints `ok`/`FAIL` per case and exits non-zero on any FAIL. Cleanup is `rm -rf "${T:?}"`, where `T` comes from `mktemp -d` in the same script (never read from a file).
- [ ] **Step 2: Run it before the workflow exists.** Expect it to fail (no workflow file). Also add `check-inputs.sh`: it pastes in the step's validation block, extracted from the workflow the same way between `# --- inputs ---` and `# --- end inputs ---` markers, and runs it with `FILES`/`REPEAT`/`LOAD` set. Cases:
  - rejected: `--timings /x`, `$(id)`, `*`, and a files value with an embedded newline (P1-5);
  - accepted: `test/a.test.mjs test/b.test.mjs`, as 2 args;
  - empty selects `--group chrome,rest`;
  - rejected: repeat `0`, `6`, `x` and `05`; load `9` and `08` (P1-5).

  `check-inputs.sh` also scans the workflow and fails if any `run:` block, the embedded summary script included, holds `${{` (P1-4).

  Add `check-exit.sh` (P1-1). It extracts the block between `# --- burners ---` and `# --- end burners ---` (the burner start, `stop_burners`, the trap) and the exit logic. It runs them with `sleep 300` in place of `node -e "for(;;){}"` (no load on the box) and a stub in place of run.mjs and the summary. Cases:
  - load 0, stub exits 0: exit 0;
  - load 2, stub exits 0: exit 0, and both sleep pids are gone afterwards;
  - load 2, stub exits 1: exit 1, and both pids are gone;
  - load 2 with one sleep killed beforehand, stub exits 0: exit 0;
  - stub exits 0 but the summary stub exits 1: exit 1.

  Pids are checked with `kill -0` (exit code). The script's own cleanup kills only the pids it recorded.
- [ ] **Step 3: Write `test-stress.yml`.** Triggers: `schedule` (`cron: '23 6 * * *'`), `workflow_dispatch` with the three string inputs (descriptions as in spec check 2), and a temporary `push: branches: [ticket/kit-216-daily-stress-run]`. Top-level `permissions: contents: read`, and `concurrency: { group: test-stress-${{ github.ref }}, cancel-in-progress: false }`. Job `stress`: `runs-on: ubuntu-latest`, `timeout-minutes: 240`, env `DEVTEAM_CGROUP`/`DEVTEAM_MEMINFO` as in test.yml. Steps: checkout, setup-node 24, the tmux install line from test.yml, then the run step:
  - env:
    - `FILES: ${{ github.event_name == 'push' && 'test/search.test.mjs' || inputs.files }}`
    - `REPEAT: ${{ github.event_name == 'push' && '2' || inputs.repeat || '3' }}`
    - `LOAD: ${{ github.event_name == 'push' && '2' || inputs.load || '0' }}`

    On a schedule, `inputs.*` are empty, so the defaults apply.
  - script, in order:
    1. `set -euo pipefail`;
    2. the `# --- inputs ---` block, which builds the array `SEL`;
    3. the summary heredoc;
    4. the `# --- burners ---` block: start the burners, `stop_burners()` (each kill `|| true`, ending `return 0`), and `trap stop_burners EXIT`;
    5. echo the exact command line, then `set +e`, `node test/run.mjs "${SEL[@]}" --repeat "$REPEAT" --concurrency 4 2>&1 | tee "$RUNNER_TEMP/stress.log"`, and on the very next line `rc=${PIPESTATUS[0]}` (P1-6);
    6. `set -e`, `stop_burners`;
    7. the summary: `s=0; node "$RUNNER_TEMP/summary.mjs" … || s=1`, then `cat` the markdown it wrote to the log;
    8. `if [ "$rc" -ne 0 ]; then exit "$rc"; fi; exit "$s"` (run.mjs's own code is kept, P1-6).
- [ ] **Step 4: Run the three check scripts.** Expect exit 0 from each (judge by `$?`).
- [ ] **Step 5: Task review** by a fresh subagent: `reviews/task-1.md`. Commit the workflow, the scripts and the fixtures.

### Task 2: One green run on GitHub

- [ ] **Step 1:** `git push -u origin ticket/kit-216-daily-stress-run`. The push trigger starts `test-stress` on the branch. Find it with `gh run list --workflow test-stress.yml --branch ticket/kit-216-daily-stress-run --limit 1 --json databaseId,status,conclusion`.
- [ ] **Step 2:** Wait for it with Monitor (an until-loop on `gh run view <id> --json status`), not foreground sleeps. Expect `conclusion: success`.
- [ ] **Step 3:** Fetch the summary and log lines through a script file (`fetch-run.sh <id>`, in this folder) that saves `gh run view <id> --log` to a file under the worktree's ticket folder for reading. Confirm the echoed command line is `node test/run.mjs test/search.test.mjs --repeat 2 --concurrency 4` with 2 burners, and that the burners were killed at the end. The job summary itself is read with `gh api` on the run's check-run output, or from the log's markdown echo if the API doesn't expose it. To make it readable from the log either way, the step also `cat`s the summary markdown it writes.
- [ ] **Step 4:** Record the run URL and the quoted summary in `verification.md`. If it is red, debug with systematic-debugging; a test that only fails under load is a finding for the supervisor, not something to fix here.

### Task 3: Remove the trigger; actionlint on the final file

- [ ] **Step 1:** Write `actionlint.sh` (this folder). It downloads two pinned releases into a `mktemp -d` dir:
  - actionlint v1.7.7 `linux_amd64.tar.gz`, sha256 `023070a287cd8cccd71515fedc843f1985bf96c436b7effaecce67290e7e0757` (from the release's checksums file);
  - shellcheck v0.10.0 `linux.x86_64.tar.xz`, sha256 `6c881ab0698e4e6ea235245f22832860544f17ba386442fe7e9d629f8cbedf87` (computed from the release asset, since the release publishes no checksums file).

  It checks both with `sha256sum -c`. It runs `actionlint -shellcheck <path> .github/workflows/test-stress.yml` and exits with actionlint's status (P1-4). Cleanup is `rm -rf "${T:?}"` on its own mktemp dir.
- [ ] **Step 2:** Run `actionlint.sh` on T1's file (with the push trigger still in); expect exit 0. Write `verification.md` with every row except the final-head actionlint row's commit, and commit it (P1-3).
- [ ] **Step 3:** In one commit, remove `push:` and the three `github.event_name == 'push' && '…' ||` prefixes and change no other workflow line. `git show --stat` shows the workflow and verification.md only (P2-1). Re-run `actionlint.sh` and the three check scripts; expect exit 0 from each. `grep -n 'pull_request' .github/workflows/test-stress.yml` must exit 1. Fill in verification.md's final-head rows in the same commit, naming the commit as "the trigger-removal commit" rather than by sha (a row can't hold its own commit's sha; P2-1). This is the PR's last commit that touches anything outside `reviews/`. At the final head, `git diff <removal>..HEAD -- .github/` is empty (P1-3).
- [ ] **Step 4:** Task review `reviews/task-3.md`. Then the final reviews (two, from other sessions), `check-ticket`, and the merge request.

## Verification

`verification.md` has a row per done-when: the command (or run URL), its exit code or conclusion, and the commit. Done-when 4's run is on the last workflow commit before the trigger's removal (P1-3), and actionlint is at the final head. verification.md is committed before the final reviews, never after them.
