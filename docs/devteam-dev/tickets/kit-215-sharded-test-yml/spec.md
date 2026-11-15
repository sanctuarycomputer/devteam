# kit-215 sharded test.yml: spec

Ticket: `kit-215-sharded-test-yml` (feature `tests-light`, serves TESTS-S2, size S, risk high). Depends on kit-209 (merged, `test/run.mjs`), kit-211 (merged), kit-230 (released) and kit-212 (not merged yet: build waits for it). Touches `.github/workflows/test.yml` only. Design: `project/designs/devteam-s-tests-are-light-fast-and-easy-.md`, "CI (kit-215)", "Branch protection", "Failure modes" and "After the dashboard-cleanup plan landed".

## Intent

`test.yml` today runs 8 jobs (4 Node majors x `chain`, `rest`) through bare `node --test` at concurrency 8, with kit-230's `--test-timeout` as the hang guard. The `rest` job is bounded by its longest files and takes 5 to 6.5 minutes. This ticket moves every job onto `node test/run.mjs` (kit-209's runner: one process per file, a per-file watchdog that names a hung file, weight-balanced shards) and splits each major's work into balanced jobs, so a run's wall time falls toward the chain's (about 3.7 min) and no job is near its timeout. One `tests` job over them all is the single check a branch rule can require, and it is red (never skipped) when any job fails.

## Rulings

- m-20261115-203738998-supervisor: plan ahead. Spec and plan now, one combined review (size S, trial a-20261115-074130886: spec-1.md and plan-1.md from one fresh session). Build only after every `depends_on` has merged and approve-plan is recorded. Each subagent brief carries lessons k-20261115-182656232, k-20261115-080753394, k-20261115-164245020 and the scripts-in-files rule. Run only the files touched, at `--test-concurrency=2`.
  - k-20261115-182656232: multi-step shell in script files; no unguarded `rm -rf` of a variable path; a private `mktemp -d` scratch; no `/dev/zero` or `/dev/urandom` input; no interactive client or background process; `timeout` on everything; never an address-space cap on node or the runner.
  - k-20261115-080753394: any kit run outside the tests gets its own `HOME`, a `DEVTEAM_HUB_PORT` away from 4320, and every `DEVTEAM_*` unset.
  - k-20261115-164245020: judge a check by its own exit code (or `gh run view`'s conclusion), never by piped output.
- This ticket touches only a workflow file, so no kit test file is run on the box; the local checks are `run.mjs --list` (runs nothing) and a YAML parse.

## The layout

16 jobs from one static `strategy.matrix.include` (no cross product, so no entry is ever excluded or skipped), `fail-fast: false`. Each job is named `kit (<node>, <part>)`:

| Node | part | runs (`node test/run.mjs --concurrency "$(nproc)" …`) | gitleaks |
|---|---|---|---|
| 18, 20, 22, 24 | `chain` | `--group chain` | no |
| 18, 20 | `rest 1/2` | `--group alone`, then `--group rest,chrome --shard 1/2` | yes |
| 18, 20 | `rest 2/2` | `--group rest,chrome --shard 2/2` | yes |
| 22, 24 | `rest 1/2` | `--group alone`, then `--group rest --shard 1/2` | yes |
| 22, 24 | `rest 2/2` | `--group rest --shard 2/2` | yes |
| 22, 24 | `chrome 1/2` | `--group chrome --shard 1/2` | no |
| 22, 24 | `chrome 2/2` | `--group chrome --shard 2/2` | no |

4 x 3 + 2 x 2 = 16. On 18 and 20 the Chrome-driven tests skip themselves (`lib/chrome.mjs`: no `WebSocket` before Node 22), so the chrome files join the rest shards there. The `alone` group (`bounds.test.mjs`) runs in its own step before the shard, so it is in rest 1/2 on every major whatever the weights say (one `--group alone,rest --shard 1/2` invocation would let the greedy deal put it in shard 2).

The matrix entry carries `node`, `part`, `key` (an artifact-safe name such as `rest-1`), `groups`, `shard` (empty for chain), `alone` and `gitleaks`. A job computes its runner arguments once, and both its `--list` step and its run step use them, so what the coverage proof checks is what the job ran.

Other settings:

- **Concurrency:** `--concurrency "$(nproc)"` (4 on a standard `ubuntu-latest` runner).
- **No `--test-timeout`.** kit-230's `test_timeout` matrix values and its flag go. `run.mjs` passes no `--test-timeout` to node; its file watchdog (300 s, 600 s for the chain and for `dashboard.test.mjs` until kit-210) fails a hung file in at most its timeout, naming the file and the last test that finished (kit-209's test at `test/run.test.mjs:625`). The PR body says so.
- **Timeouts:** every job `timeout-minutes: 12`. Each run step has `timeout-minutes: 11`, so a hang the runner itself didn't end still leaves the job alive for the `if: failure()` step that lists running processes (kept from today).
- **Workflow concurrency:** `group: test-${{ pull request number, or the run id for a push }}`, `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`. A newer push to a PR cancels its older run; a push to main is in a group of its own (its run id) and is never cancelled, nor does it wait.
- **gitleaks:** the pinned, sha256-checked install step runs when `matrix.gitleaks` (both rest jobs on every major), and the run steps set `DEVTEAM_TEST_GITLEAKS` to `1` there (empty elsewhere; `gitleaks.test.mjs` is a rest file and checks `=== '1'`).
- **Env kept:** `DEVTEAM_CGROUP` and `DEVTEAM_MEMINFO` at their `/nonexistent/…` paths; tmux installed when missing; actions pinned as today (`actions/checkout@v5`, `actions/setup-node@v5`).
- **The coverage proof.** Each matrix job's first step after setup writes `node test/run.mjs --list` for its own arguments (both invocations in rest 1/2) to a file and uploads it as artifact `list-<node>-<key>` (`actions/upload-artifact@v4`). The `tests` job downloads them all (`actions/download-artifact@v4`, pattern `list-*`) and, per Node major, checks that the first column of its jobs' lists, sorted, equals `ls test/*.test.mjs`, sorted (a duplicate or a missing file both make the diff non-empty; a major with no lists fails). Built from the jobs' own outputs, not a second copy of the table, so the proof can't drift from the matrix.
- **The `tests` job:** `needs: [kit]`, `if: always()`, `timeout-minutes: 12`. Step 1 fails unless every `needs.*.result` is `success` (read from `toJSON(needs)`; with a matrix, `needs.kit.result` is `success` only when every matrix job succeeded). Step 2 (`if: always()`) is the coverage proof. Without `if: always()` it would be skipped when a job failed, and a skipped required check counts as passing.

## Acceptance checks (the done-whens)

1. **Matrix include, 16 jobs, none skipped, all on run.mjs at the runner's CPU count.** *Check:* the workflow's `include` has exactly the 16 rows above (a script parses the YAML and prints them); at the PR head's run, `gh run view <id> --json jobs` lists 17 jobs (16 + `tests`), each `completed/success`, none skipped; every run step's command starts `node test/run.mjs --concurrency "$(nproc)"`.
2. **Concurrency group.** *Check:* the YAML's `concurrency` block quoted; a second push to the PR branch shows the earlier run `cancelled` (`gh run list --json`); the main expression gives `cancel-in-progress: false` and a per-run group.
3. **ci-green.** *Check:* `DEVTEAM_HOME=/data/home/code/devteam-dev sh /data/home/code/devteam-dev/scripts/devteam-ci-green.sh <head sha>` exits 0, run through `devteam.mjs gate ci`; its line quoted.
4. **`tests` job red, not skipped, on a failure.** *Check:* a deliberately failing commit on the PR branch (a `test.yml`-only change that makes one matrix job exit 1), its run shows that job `failure` and `tests` `failure` (not `skipped`); then a revert commit, green. Before merge, main's branch protection is read (by the supervisor: this worker's `gh api …/protection` is refused) and every required check is one this workflow provides, quoted in verification.md. If protection names checks this workflow drops (today's `kit (<n>, rest)`), the change is a gate-change question to the owner, applied only on the answer.
5. **Coverage proof per major.** *Check:* the `tests` job's coverage step log at the head quoted (four majors, 67-ish files each, no diff); locally, `coverage-local.sh` runs the same lists with `--list` for each major and diffs them against `ls`.
6. **Timeouts and job times.** *Check:* every job has `timeout-minutes: 12` (YAML parse); at the head's run, each job's minutes (`gh run view --json jobs`, `completedAt - startedAt`) quoted; none over 6 except the job holding `test/dashboard.test.mjs` on each major (until kit-210).
7. **gitleaks in every rest job.** *Check:* the step's `if: matrix.gitleaks` and the 8 rest rows with `gitleaks: true`; the head run's rest jobs show the install step `success` and `gitleaks.test.mjs` ran in one of each major's rest jobs (its `--list`).
8. **kit-230's `--test-timeout` replaced.** *Check:* `grep -c -- '--test-timeout' .github/workflows/test.yml` prints 0; kit-209's timeout test (`test/run.test.mjs:625`, the `timed out: … (last test finished: first passes)` assertion) passes at the head in CI, quoted from the job that ran `run.test.mjs`; the PR body says the watchdog replaces it.

## Contracts

Consumed: `test/run.mjs`'s command line (`--group`, `--shard i/n` with n up to 4, `--concurrency`, `--list` printing `<file>  <group>  <timeout> s`), as kit-209 documents it at the top of the file; `scripts/devteam-ci-green.sh` (devteam-dev's), which requires every job of the run to be `completed/success`. Provided: the check name `tests` for branch protection; job names `kit (<node>, <part>)`.

## Edge cases

- **A shard over 6 minutes.** On 18 and 20 the chrome files are weighted by their 22-era timings (`dashboard.test.mjs` 316 s) though their Chrome tests skip there, so balance on those majors is approximate. The design's lever, a third rest shard, changes the job count from 16, which is in the done-whens: that is a `design-change` message, not a judgment call. The dashboard job is excepted until kit-210.
- **A job that fails before uploading its list.** The upload step is `if: always()` and runs right after the list step; if the job dies earlier, the `tests` job finds that major's lists short and fails on coverage too (and on `needs`). Correct either way.
- **The artifact names.** `list-<node>-<key>`; keys have no `/` or space. Artifacts are a few KB, retention 1 day (`retention-days: 1`).
- **The runner itself hangs** (not a test file): the step's 11-minute limit ends it; the ps step names what is still running; the job is red at 12 at worst.
- **Org runner limit and queueing.** 16 jobs against 8; the supervisor reads the org's concurrent-job limit before build (design). Queueing doesn't change this ticket's pass/fail, only kit-217's measure.
- **Required checks during the PR.** If protection requires `kit (18, rest)`-style checks, the PR is blocked by checks that no longer run, until the gate-change answer; that is expected and recorded.

## Out of scope

- Refreshing `test/timings.json` (kit-217); `test-stress.yml` (kit-216); README and operator docs (kit-218); moving `bounds.test.mjs` out of `alone` (a `run.mjs` change).
- Changing branch protection (the owner's, through the supervisor).
