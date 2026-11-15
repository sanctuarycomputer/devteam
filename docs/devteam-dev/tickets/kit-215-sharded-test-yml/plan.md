# kit-215 sharded test.yml: plan

> For agentic workers: use superpowers:executing-plans (one file, two tasks). Steps use `- [ ]`.

**Goal:** `test.yml` runs every test file through `node test/run.mjs` in the 16 jobs of the spec's table, with a `tests` job over them, a per-major coverage proof, a PR-only cancelling concurrency group and a 12-minute job timeout.

**Spec:** `docs/devteam-dev/tickets/kit-215-sharded-test-yml/spec.md` (read it first; the layout table and the settings list there are the decisions).

## TL;DR

- One file changes: `.github/workflows/test.yml`. Records and helper scripts stay in this ticket's folder.
- Task 1 rewrites the workflow: a static 16-row `matrix.include`, run.mjs at `$(nproc)`, no `--test-timeout`, `timeout-minutes: 12`, gitleaks in rest jobs, each job uploads its `--list`.
- Task 1 adds the `tests` job (`needs: [kit]`, `if: always()`): red unless every needs result is `success`, then the per-major coverage diff against `ls test/*.test.mjs`.
- Local proof before any push: `actionlint` clean, and `coverage-local.sh` runs each major's `--list` lists exactly as the matrix does and diffs them (runs no test).
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

1. A file that is in no shard on some major (a new file, a group rule change): the coverage step must fail the `tests` job, naming the major and the diff. Covered by Task 1 step 4 (local, with a fake extra list line) and the CI step itself.
2. A matrix job that fails or is cancelled: `tests` must be `failure`, never `skipped`. Task 2 step 3.
3. `bounds.test.mjs` landing outside rest 1/2 or twice: the separate `--group alone` step plus the coverage diff (a duplicate shows in the diff). Task 1 step 4.
4. A push to main cancelled by a later push: the group for a push is the run id. Task 1 step 3 (expression read) and Task 2 step 4 (a PR run cancelled, main runs never share a group).
5. `DEVTEAM_TEST_GITLEAKS=1` set in a job with no gitleaks installed would fail `gitleaks.test.mjs` there: it is set only where `matrix.gitleaks` is true, and gitleaks.test.mjs is a rest file. Task 2 step 2 checks the rest jobs ran it.

---

### Task 1: the workflow

**Files:** Modify `.github/workflows/test.yml` (whole file). Create `docs/devteam-dev/tickets/kit-215-sharded-test-yml/coverage-local.sh`.

**Interfaces:** consumes `test/run.mjs` flags `--group`, `--shard i/n`, `--concurrency`, `--list` (output `<file>  <group>  <timeout> s`, file first).

- [ ] **Step 1: the local proof script, failing first.** `coverage-local.sh` (POSIX sh, `set -eu`, private `mktemp -d` scratch removed with a guarded path, `timeout 60` on each node call). For each major it writes the lists the matrix would write, then diffs `awk '{print $1}'` of them, sorted, against `ls test/*.test.mjs | sort`, and exits 1 on any diff, printing the major. Majors 18/20: `--group chain`; `--group alone`; `--group rest,chrome --shard 1/2`; `--group rest,chrome --shard 2/2`. Majors 22/24: chain; alone; `--group rest --shard 1/2`, `2/2`; `--group chrome --shard 1/2`, `2/2`. A `--self-test` mode adds a duplicate line to one list and drops one file from another and must exit 1 both times. Run it against today's tree: expected exit 0 (run.mjs is on main), and `--self-test` exit 0 (both corruptions caught).
- [ ] **Step 2: write the workflow.** Top: `on` unchanged; `concurrency: { group: "test-${{ github.event_name == 'pull_request' && github.head_ref || github.run_id }}", cancel-in-progress: "${{ github.event_name == 'pull_request' }}" }`; `permissions: contents: read` is not added (today's file has none; upload-artifact needs none beyond the default token). Job `kit`: name `kit (${{ matrix.node }}, ${{ matrix.part }})`; `fail-fast: false`; the 16 `include` rows of the spec with `key`, `groups`, `shard` (`''` for chain), `alone: true` on the rest 1/2 rows, `gitleaks: true` on the rest rows; `timeout-minutes: 12`; env as today. Job-level env `RUN_ARGS: --group ${{ matrix.groups }}${{ matrix.shard && format(' --shard {0}', matrix.shard) || '' }}`. Steps: checkout; setup-node; tmux; gitleaks install `if: matrix.gitleaks` (body as today); **list** step writing `list.txt` from `node test/run.mjs --list --group alone` (when `matrix.alone`) and `node test/run.mjs --list $RUN_ARGS`, with `set -euo pipefail`; **upload** `if: always()`, name `list-${{ matrix.node }}-${{ matrix.key }}`, path `list.txt`, `retention-days: 1`, `if-no-files-found: error`; **alone** step `if: matrix.alone`, `node test/run.mjs --concurrency "$(nproc)" --group alone`; **run** step `if: ${{ !cancelled() }}` (so rest 1/2's shard still runs after a red alone step), `node test/run.mjs --concurrency "$(nproc)" $RUN_ARGS`, env `DEVTEAM_TEST_GITLEAKS: ${{ matrix.gitleaks && '1' || '' }}` on both run steps; both run steps `timeout-minutes: 11`; the `if: failure()` ps step kept with a comment updated for run.mjs (it names the file itself; ps covers a hang of the runner). Job `tests`: `needs: [kit]`, `if: always()`, `runs-on: ubuntu-latest`, `timeout-minutes: 12`; step **needs** with env `NEEDS: ${{ toJSON(needs) }}` that prints each result and exits 1 unless all are `success` (`node -e`, reading the env); checkout; download-artifact `pattern: list-*`, `path: lists`, `if: always()`; step **coverage** `if: always()`, per major in `18 20 22 24`: fail if `lists/list-<n>-*` is empty, else diff the sorted first column against `ls test/*.test.mjs | sort`, printing the major and the diff; exit 1 if any major failed. Comments say why for each non-obvious line (the `if: always()`, the separate alone step, the run-id group, the watchdog replacing `--test-timeout`).
- [ ] **Step 3: lint.** `timeout 60 actionlint .github/workflows/test.yml` exits 0. `grep -c -- '--test-timeout' .github/workflows/test.yml` prints 0 (exit 1 from grep is the expected "none"). Count `include` rows: 16 (`grep -c '^ *- node:'` inside the block, read by eye too).
- [ ] **Step 4: re-run the local proof** (`coverage-local.sh` and `--self-test`, both exit 0) and check by eye that its per-major argument lists match the workflow's 16 rows.
- [ ] **Step 5: commit** `kit-215: test.yml runs run.mjs in 16 jobs with a tests job over them`. Review record `reviews/task-1.md` from a fresh subagent given the spec and the diff (brief carries the three lessons and the scripts-in-files rule).

### Task 2: proof in CI

**Files:** `docs/devteam-dev/tickets/kit-215-sharded-test-yml/verification.md`, and at most two temporary commits to `test.yml` (the failure and its revert).

- [ ] **Step 1: push, open the PR** (title `kit-215-sharded-test-yml: <ticket title>`), wait for the run; `devteam.mjs gate ci -- sh /data/home/code/devteam-dev/scripts/devteam-ci-green.sh <head sha>` with `DEVTEAM_HOME` set; quote its line. If any job is red, `systematic-debugging`; a flaky test file is an `observe`, not a retry hidden in the workflow.
- [ ] **Step 2: read the run.** `gh run view <id> --json jobs` saved to a file: 17 jobs, names, conclusions, `completedAt - startedAt` per job in minutes; the coverage step's log and the `run.test.mjs` line holding kit-209's timeout test (`test/run.test.mjs:625`) quoted; gitleaks install `success` in all 8 rest jobs. Any job over 6 minutes other than the dashboard holder: stop, `design-change` to the supervisor (a third shard changes the 16).
- [ ] **Step 3: the deliberate failure.** Commit a `test.yml` change that adds `exit 1` to the chain job's run on Node 18 only (`if [ "${{ matrix.node }}" = 18 ] && [ "${{ matrix.part }}" = chain ]; then exit 1; fi`); push; read the run: that job `failure`, `tests` `failure` (not `skipped`). Revert with `git revert`, push; that head is the one proven green in step 1's way again.
- [ ] **Step 4: cancellation.** The failing commit's push and the revert's push come close together; `gh run list -b ticket/kit-215-sharded-test-yml --json databaseId,conclusion,headSha` shows a superseded run `cancelled` (if the first run had already finished, push an empty commit while a run is in progress to show it). Quote.
- [ ] **Step 5: branch protection.** `send supervisor` a `review-request` asking for main's required checks (quoted) before merge; record the answer. If it names checks the workflow drops, the gate-change question is the supervisor's to ask the owner; the merge waits on it.
- [ ] **Step 6: verification.md**, one row per done-when, with the exact command, its exit code and result at a named commit; commit.
