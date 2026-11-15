# kit-215 sharded test.yml: plan

> For agentic workers: use superpowers:executing-plans (one file, two tasks). Steps use `- [ ]`.

**Goal:** `test.yml` runs every test file through `node test/run.mjs` in the 16 jobs of the spec's table, with a `tests` job over them, a per-major coverage proof, a PR-only cancelling concurrency group and a 12-minute job timeout.

**Spec:** `docs/devteam-dev/tickets/kit-215-sharded-test-yml/spec.md` (read it first; the layout table and the settings list there are the decisions).

## TL;DR

- One file changes: `.github/workflows/test.yml`. Records and helper scripts stay in this ticket's folder.
- Task 1 rewrites the workflow: a static 16-row `matrix.include`, run.mjs at `$(nproc)`, no `--test-timeout`, `timeout-minutes: 12`, gitleaks in rest jobs, each job uploads its `--list`.
- Task 1 adds the `tests` job (`needs: [kit]`, `if: always()`): red unless every needs result is `success`, then the per-major coverage diff against `ls test/*.test.mjs`.
- Local proof before any push: `actionlint` clean, and `coverage-step.sh` runs the workflow's own coverage script, extracted from the YAML, on real lists (pass) and on a duplicate, a missing file and a missing major (each fails); it runs no test.
- Task 2 is the CI proof on the PR: a green head with 17 jobs, a deliberately failing commit (tests red, not skipped) then its revert, a superseded run cancelled, job minutes quoted.
- Branch protection is read by the supervisor (my `gh api …/protection` is refused); any change to required checks waits on the owner's gate-change answer.
- Build starts only after kit-212 merges and approve-plan is recorded; Task 1's local proof is re-run after merging `origin/main` (kit-212 adds and renames test files).

## Global constraints

- Touch only `.github/workflows/test.yml` (plus `docs/devteam-dev/tickets/kit-215-sharded-test-yml/`).
- Actions pinned as today: `actions/checkout@v5`, `actions/setup-node@v5`; new: `actions/upload-artifact@v4`, `actions/download-artifact@v4`.
- No `--test-timeout` anywhere in the file. No retries.
- Job names `kit (<node>, <part>)` with parts `chain`, `rest 1/2`, `rest 2/2`, `chrome 1/2`, `chrome 2/2`; the final job's name is exactly `tests`.
- On the box: no kit test file is run (none is touched); every probe under `timeout`, multi-step shell as a script file in the ticket folder; check exit codes, never piped text (k-20261115-164245020).

## Review focus

1. A file that is in no shard on some major (a new file, a group rule change): the coverage step must fail the `tests` job, naming the major and the diff. Covered by Task 1 steps 1 and 4 (the extracted step, on a missing file and a missing major) and the CI step itself.
2. A matrix job that fails or is cancelled: `tests` must be `failure`, never `skipped`. Task 2 step 3.
3. `bounds.test.mjs` landing outside rest 1/2 or twice: the separate `--group alone` step plus the coverage diff (a duplicate shows in the diff). Task 1 step 4.
4. A push to main cancelled by a later push: the group for a push is the run id. Task 1 step 3 (expression read) and Task 2 step 4 (a PR run cancelled, main runs never share a group).
5. `DEVTEAM_TEST_GITLEAKS=1` set in a job with no gitleaks installed would fail `gitleaks.test.mjs` there: it is set only where `matrix.gitleaks` is true, and gitleaks.test.mjs is a rest file. Task 2 step 2 checks the rest jobs ran it.

---

### Task 1: the workflow

**Files:** Modify `.github/workflows/test.yml` (whole file). Create `docs/devteam-dev/tickets/kit-215-sharded-test-yml/coverage-step.sh`.

**Interfaces:** consumes `test/run.mjs` flags `--group`, `--shard i/n`, `--concurrency`, `--list` (output `<file>  <group>  <timeout> s`, file first).

- [ ] **Step 1: the proof harness, failing first** (P1-2). `coverage-step.sh` (POSIX sh, `set -eu`, a private `mktemp -d` scratch removed by a guarded `rm -rf "${S:?}"` in a trap, `timeout 60` on every node call). It extracts the coverage step's `run: |` block from `.github/workflows/test.yml` with a small awk keyed on the step's `name: coverage` line (the block's lines, de-indented), and refuses (exit 2) if it finds none. In the scratch folder it links `test` to the repo's `test/`, writes `lists/list-<node>-<key>/list.txt` for the 16 matrix rows with `node test/run.mjs --list` and each row's arguments (rest 1/2 also `--group alone`; majors 18/20: `--group chain`, `--group rest,chrome --shard 1/2|2/2`; 22/24: chain, `--group rest --shard 1/2|2/2`, `--group chrome --shard 1/2|2/2`), and runs the extracted script there four times under `bash -e`: the real lists, expect exit 0; one file appended again to `list-22-rest-2`, expect 1; one line removed from `list-18-chain`, expect 1; `lists/list-24-*` removed, expect 1. It prints each case's exit and exits 0 only when all four match. Before Task 1's workflow exists it exits 2 (no coverage step): that is the failing run.
- [ ] **Step 2: write the workflow.** Top: `on` unchanged; `concurrency: { group: "test-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || github.run_id }}", cancel-in-progress: "${{ github.event_name == 'pull_request' }}" }`; `permissions: contents: read` is not added (today's file has none; upload-artifact needs none beyond the default token). Job `kit`: name `kit (${{ matrix.node }}, ${{ matrix.part }})`; `fail-fast: false`; the 16 `include` rows of the spec with `key`, `groups`, `shard` (`''` for chain), `alone: true` on the rest 1/2 rows, `gitleaks: true` on the rest rows; `timeout-minutes: 12`; env as today. The concurrency group keys a PR run on its number, not `github.head_ref` (P1-5). Job-level env `RUN_ARGS: --group ${{ matrix.groups }}${{ matrix.shard && format(' --shard {0}', matrix.shard) || '' }}`. Steps: checkout; setup-node; tmux; gitleaks install `if: matrix.gitleaks` (body as today); **list** step writing `list.txt` from `node test/run.mjs --list --group alone` (when `matrix.alone`) and `node test/run.mjs --list $RUN_ARGS`, with `set -euo pipefail`; **upload** `if: always()`, name `list-${{ matrix.node }}-${{ matrix.key }}`, path `list.txt`, `retention-days: 7`, `overwrite: true`, `if-no-files-found: error` (P1-6); **alone** step `if: matrix.alone`, `node test/run.mjs --concurrency "$(nproc)" --group alone`; **run** step `if: ${{ !cancelled() }}` (so rest 1/2's shard still runs after a red alone step), `node test/run.mjs --concurrency "$(nproc)" $RUN_ARGS`, env `DEVTEAM_TEST_GITLEAKS: ${{ matrix.gitleaks && '1' || '' }}` on both run steps; both run steps `timeout-minutes: 11`, each with `# shellcheck disable=SC2086` above the unquoted `$RUN_ARGS` (it must split into words; P1-4); the ps step kept, now `if: failure() || cancelled()` so it also runs when the job's 12 minutes fire first (P1-6), with a comment updated for run.mjs (it names a hung file itself; ps covers a hang of the runner). Job `tests`: `needs: [kit]`, `if: always()`, `runs-on: ubuntu-latest`, `timeout-minutes: 12`; step **needs** with env `NEEDS: ${{ toJSON(needs) }}` that prints each result and exits 1 unless all are `success` (`node -e`, reading the env); then checkout, download-artifact (`pattern: list-*`, `path: lists`, so each list lands at `lists/list-<node>-<key>/list.txt`) and step **coverage** (`name: coverage`), each `if: always()` (P1-3); per major in `18 20 22 24`: fail if `lists/list-<n>-*` is empty, else diff the sorted first column against `ls test/*.test.mjs | sort`, printing the major and the diff; exit 1 if any major failed. Comments say why for each non-obvious line (the `if: always()`, the separate alone step, the run-id group, the watchdog replacing `--test-timeout`).
- [ ] **Step 3: lint.** `timeout 60 /data/home/.local/share/mise/installs/actionlint/1.7.12/actionlint .github/workflows/test.yml` exits 0 (the `actionlint` on PATH is an unconfigured mise shim; P1-4). `grep -c -- '--test-timeout' .github/workflows/test.yml` prints 0 (exit 1 from grep is the expected "none"). Count `include` rows: 16 (`grep -c '^ *- node:'` inside the block, read by eye too).
- [ ] **Step 4: run the proof harness** (`sh coverage-step.sh` exits 0: the four cases give 0, 1, 1, 1) and check by eye that its 16 argument lists match the workflow's 16 rows.
- [ ] **Step 5: commit** `kit-215: test.yml runs run.mjs in 16 jobs with a tests job over them`. Review record `reviews/task-1.md` from a fresh subagent given the spec and the diff (brief carries the three lessons and the scripts-in-files rule).

### Task 2: proof in CI

**Files:** `docs/devteam-dev/tickets/kit-215-sharded-test-yml/verification.md`, and exactly two temporary commits to `test.yml` (the failure and its revert); no empty commits.

- [ ] **Step 1: push, open the PR** (title `kit-215-sharded-test-yml: <ticket title>`), wait for the run; `devteam.mjs gate ci -- sh /data/home/code/devteam-dev/scripts/devteam-ci-green.sh <head sha>` with `DEVTEAM_HOME` set; quote its line. If any job is red, `systematic-debugging`; a flaky test file is an `observe`, not a retry hidden in the workflow.
- [ ] **Step 2: read the run.** `gh run view <id> --json jobs` saved to a file: 17 jobs, names, conclusions, `completedAt - startedAt` per job in minutes; the coverage step's log and the `run.test.mjs` line holding kit-209's timeout test (`test/run.test.mjs:625`) quoted; gitleaks install `success` in all 8 rest jobs. Any job over 6 minutes other than the dashboard holder: stop, `design-change` to the supervisor (a third shard changes the 16).
- [ ] **Step 3: the deliberate failure, which also shows cancellation** (P1-1). The order is fixed: (a) the workflow commit is pushed (step 1); (b) while its run is still in progress, a commit adding `exit 1` to the chain job's run on Node 18 only (`if [ "${{ matrix.node }}" = 18 ] && [ "${{ matrix.part }}" = chain ]; then exit 1; fi`) is pushed, so (a)'s run is superseded and cancelled; (c) the failing commit's run finishes undisturbed: that job `failure`, `tests` `failure` (not `skipped`); (d) `git revert` of it is pushed, and that head is the one steps 1 and 2 are read at (ci-green, job list and times). If (a)'s run finishes before (b) is pushed, the cancellation is shown later by a review-fix push made while a run is in progress; no commit is made only to show it.
- [ ] **Step 4: cancellation, read.** `gh run list -b ticket/kit-215-sharded-test-yml -w test.yml --json databaseId,conclusion,headSha,event` saved to a file: the run superseded in step 3 is `cancelled` and its `tests` job `failure` (S1-4: red, not skipped). Quote. A later push during review supersedes a run the same way, and may be quoted instead.
- [ ] **Step 5: branch protection.** `send supervisor` a `review-request` asking for main's required checks (quoted) before merge; record the answer. If it names checks the workflow drops, the gate-change question is the supervisor's to ask the owner; the merge waits on it.
- [ ] **Step 6: verification.md**, one row per done-when, with the exact command, its exit code and result at a named commit; commit.
