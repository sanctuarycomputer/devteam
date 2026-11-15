# kit-212 plan

## TL;DR

- `test/accounts.test.mjs` becomes six parts, `test/accounts.{rotation,leaving,restart,restart-guards,untrusted,supervisor}.test.mjs`, and `test/lib/accounts-fixture.mjs` (shared preamble only; pending design-change m-20261115-210129296).
- kit-211's `split.mjs` (copied here) does it mechanically from `split-plan.mjs`: each test moves byte for byte, in order; imports are recomputed with eslint; it refuses an undefined name. No hand edits.
- `names.mjs accounts de07a84 <head>` proves the 25 names are the same before and after.
- Locally each part runs alone, once, niced, at `--test-concurrency=2` at most, through the gate recorder. No full suite (lesson k-20261115-030120972).
- CI is the gate for the caps: each part's sum of test times on test.yml's Node 24 `rest` job at the PR head ≤ 45 s (base-run estimates ≤ 36 s), no test over 30 s, every job green.
- One task; a task review, then verification and a final review from fresh sessions.

## Rulings

- m-20261115-205854695-supervisor: one combined spec and plan review (trial). Reviewer briefs carry k-20261115-182656232, k-20261115-080753394, k-20261115-164245020 and the scripts-in-files rule. Run only my files, at `--test-concurrency=2`.
- Pending: m-20261115-210129296, `test/lib/accounts-fixture.mjs` in the touches. If refused: the fixture's text goes, as is, at the top of each part (a `split.mjs` option: inline the fixture), and the plan is otherwise the same.

## Files

Inside the touches `test/accounts*.test.mjs` (and `test/lib/accounts-fixture.mjs` once ruled): the six parts and the fixture created, `test/accounts.test.mjs` removed. Tools and records in `docs/devteam-dev/tickets/kit-212-accounts-tests-split/`.

## Task T1: split

1. `node docs/devteam-dev/tickets/kit-212-accounts-tests-split/split.mjs accounts --check`: six parts and the fixture, 25 tests, no undefined name (done in spec: exit 0; rotation takes `row`, leaving takes ten helpers).
2. `node …/split.mjs accounts` writes them and removes the original.
3. `node …/lint.mjs test/accounts.*.test.mjs test/lib/accounts-fixture.mjs`: no problem at all (the base file has no unused name).
4. `node …/names.mjs de07a84 HEAD accounts` after the commit: exit 0, diff `none`, 25 → 25.
5. Run each part alone through the recorder, one at a time, niced:
   `nice node /data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs gate test -- node --test --test-concurrency=2 test/accounts.<part>.test.mjs` for each of the six, and the original file once at the base for comparison of local times. Record each part's time.
6. Commit; task review `reviews/task-1.md` from a fresh subagent (brief: the spec, the diff, the base file; it reruns `split.mjs --check` against the base file in a scratch copy and `names.mjs`, and checks byte-for-byte moves with `git diff --color-moved` or by reassembling; the lessons above in its brief).

## Verification

- Push, open the PR, read test.yml's run at the head: `gh run view <id> --json conclusion,jobs`, then `devteam.mjs gate ci -- gh run watch <id> --exit-status` (memory: run the CI gate, never type it).
- `bash joblog.sh <run> "kit (24, rest)" .scratch/head-24-rest.log`; `node specdur.mjs .scratch/head-24-rest.log test/accounts.<part>.test.mjs` per part (the script reads names from the file given), into `ci-timings-head.md`: each part's sum and its longest test.
- If a part's sum is over 45 s, move a test between parts in `split-plan.mjs`, re-split from the base file, and rerun. If a single test is over 30 s, ask the supervisor first.
- `verification.md`: a row per done-when, the command, the result, at the named commit.

## Finish

Merge `origin/main`; if main changed `test/accounts.test.mjs` meanwhile, re-split from main's file (the tool is mechanical) and rerun names and the parts. PR `kit-212-accounts-tests-split: accounts.test.mjs becomes files under 60 s each on CI, every test kept`, with `## One-way doors` None. Final review `reviews/final-1.md` from a fresh session; `check-ticket`; merge-request.
