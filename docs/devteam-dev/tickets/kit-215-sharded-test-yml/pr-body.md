`test.yml` now runs every test file through `node test/run.mjs`, in 16 jobs instead of 8, with a single `tests` job over them all (ticket kit-215, feature tests-light, TESTS-S2).

## What changes

- **Jobs:** all 16 come from one `matrix.include`, so none is ever excluded or skipped. Each job runs `run.mjs --concurrency "$(nproc)"`.
  - Every Node major (18, 20, 22, 24) gets `chain`, `rest 1/2` (which runs `bounds.test.mjs` alone first) and `rest 2/2`.
  - 22 and 24 also get `chrome 1/2` and `chrome 2/2`.
  - On 18 and 20 the Chrome files go into the rest shards. Their Chrome tests skip themselves there, since Node has no `WebSocket` before 22.
- **`tests` job:** it has `needs: [kit]` and `if: always()`. It fails unless every matrix job succeeded, so it is red, never skipped, when a job fails or is cancelled.
- **Coverage proof:** each job uploads its `run.mjs --list` output, and the `tests` job checks that, per Node major, the jobs' lists together are `test/*.test.mjs` with each file once.
- **kit-230's `--test-timeout` is replaced, not kept.** `test.yml` passes no node timeout flag. `run.mjs`'s per-file watchdog (300 s, or 600 s for the chain and `dashboard.test.mjs`) is the hang guard on every major. It fails a hung file in at most its timeout and names it with its last finished test, as kit-209's timeout test (`test/run.test.mjs`) checks.
- **Timeouts:** every job has `timeout-minutes: 12`. Run steps have 11, and the process listing runs on `failure() || cancelled()`.
- **Concurrency:** a newer push to a PR cancels its older run. Runs on main are each in their own group, so they are never cancelled.
- **gitleaks:** the pinned install and `DEVTEAM_TEST_GITLEAKS=1` are in both rest jobs on every major.

Branch protection on main requires no status checks, so the renamed jobs break nothing. Making `tests` required is left for later.

## How to verify

- `actionlint .github/workflows/test.yml` exits 0.
- `sh docs/devteam-dev/tickets/kit-215-sharded-test-yml/coverage-step.sh`, in devteam-dev, runs the workflow's own coverage step on lists built the way the jobs build them. It passes on the real lists and fails on a duplicated file, a missing file and a missing major.
- The run at the head: 17 jobs, all green. A deliberately failing commit on this branch, later reverted, showed `tests` red. The records are in devteam-dev's `docs/devteam-dev/tickets/kit-215-sharded-test-yml/verification.md`.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
