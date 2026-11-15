# kit-212 verification

The test files are as at **85b6447**: the split commit (`split.mjs`, no hand edits) and records after it. Every commit after 85b6447 changes only this folder. The base is **de07a84**, main where the branch started and still main's head at 85b6447 (`git diff --stat de07a84 origin/main` empty when the split ran).

| # | Done-when | Command | Result |
|---|---|---|---|
| 1 | The sorted top-level test names across `test/accounts*.test.mjs` at the PR head equal those of `test/accounts.test.mjs` at the base, lists and an empty diff quoted. | `node docs/devteam-dev/tickets/kit-212-accounts-tests-split/names.mjs de07a84 85b6447 accounts` | Exit 0. 25 → 25 (rotation 6, leaving 7, restart 3, restart-guards 4, untrusted 2, supervisor 3). Diff `none`. Both lists are in `names-1.md`. The base's list equals the head's, since the diff is empty. Each test moved byte for byte, in order (task review T1: every base test chunk is in exactly one part, at increasing offsets; `split.mjs` rerun on de07a84 reproduces the seven files byte-identically). |
| 2 | Each file under 60 s of wall time on the Node 24 job at the PR head, quoted from the CI log. | test.yml run 43762624100 at 85b6447, job "kit (24, rest)"; `joblog.sh`, then `specdur.mjs <log> test/accounts.<part>.test.mjs` (ruling m-20261115-210355679: judged from this job, under its own load of 8 files at a time) | Per part, the sum of its tests' times as the log prints them: restart **36.2 s**, restart-guards 27.2 s, untrusted 24.9 s, supervisor 23.3 s, leaving 20.0 s, rotation 18.6 s. All under the spec's 45 s target and the 60 s cap. The sum leaves out process start-up and set-up; locally that gap (file `duration_ms` minus the sum of its tests') is 0.5 to 1.4 s per part (below). Per test: `ci-timings-head.md`. |
| 3 | No test over 30 s on that job, quoted from the CI log. | Same run | Longest **26.3 s**, "restarting: never on text that only reads like a limit…" (23.2 s on the base run), then "the restart record is untrusted…" at 18.9 s (23.7 s on the base) and "the supervisor's own pane…" at 14.9 s. None over 30 s. |
| 4 | test.yml green on every job at the PR head. | `devteam.mjs gate ci -- gh run watch 43762624100 --exit-status`, then `gh run view 43762624100 --json conclusion,jobs` | Gate exit 0; conclusion `success`; all 8 jobs `success` (18, 20, 22, 24 × chain, rest) at 85b6447. The run at the final head (only records after 85b6447) is quoted in the merge request. |

## Local runs (this box, Node 18, loaded)

`bash runparts.sh .scratch/local-1`: each part alone, one at a time, `nice timeout 600 devteam.mjs gate test -- node --test --test-concurrency=2 test/accounts.<part>.test.mjs`, read with `tapsum.mjs`. The box's load average was 20 to 48 on 32 cores during the run, so the times are several times CI's; what this run evidences is that each part passes alone, and the gap between a file's wall time and its tests' sum.

- `accounts.rotation`: exit 0, tests 6, pass 6, fail 0, file 62.4 s, sum 61.5 s, gap 0.9 s, longest 20.2 s
- `accounts.leaving`: exit 0, tests 7, pass 7, fail 0, file 88.5 s, sum 87.6 s, gap 0.9 s, longest 24.8 s
- `accounts.restart`: exit 0, tests 3, pass 3, fail 0, file 107.9 s, sum 107.4 s, gap 0.5 s, longest 76.2 s
- `accounts.restart-guards`: exit 0, tests 4, pass 4, fail 0, file 92.0 s, sum 91.5 s, gap 0.5 s, longest 60.2 s
- `accounts.untrusted`: exit 0, tests 2, pass 2, fail 0, file 88.4 s, sum 87.0 s, gap 1.4 s, longest 68.3 s
- `accounts.supervisor`: exit 0, tests 3, pass 3, fail 0, file 58.4 s, sum 57.9 s, gap 0.6 s, longest 33.0 s

All six pass alone. The gap is 0.5 to 1.4 s per part (`local-run-1.txt`), well inside the 15 s the spec leaves between the 45 s target and the 60 s cap.

## Outside the touches (for the supervisor)

- `test/timings.json` still names `test/accounts.test.mjs` (174.9). The new files weigh the median until weights are refreshed (kit-215).
- `test/lib/ports.mjs`'s layout comment still says "+70/71..95 accounts (accounts.test.mjs)".
- kit-202 touches `test/accounts.test.mjs` and follows this ticket: its test is now in one of the six parts.
