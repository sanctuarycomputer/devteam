# kit-205 verification

At commit `e188a69d74d48c4847fbe3cad8509f227f3b2a03` (ticket/kit-205-merge-reuses-green-ci, draft PR #281). Local runs are on the box (Node 18), through `run-tests.sh` in this folder (own HOME, `DEVTEAM_HUB_PORT=4791`, every `DEVTEAM_*` unset, `--test-concurrency=2`), judged by the script's exit code. CI is `test.yml`, its conclusion read with `gh run view`.

| Done-when | Command | Result |
|---|---|---|
| D1: a gate declaring `covered_by` is skipped when every required forge check at the exact head is complete and green, and merge says so in its output and act | `sh docs/devteam-dev/tickets/kit-205-merge-reuses-green-ci/run-tests.sh` — tests `merge covered_by "ci": every check green at the head…` and `merge covered_by a list: the named checks green…` (real merges of a sibling-repo ticket with a fake gh: marker not written, no `gate` line, output names gate, sha and checks, the `merge-word` act's `what` names them; the re-read is `pr view 7 --json headRefOid,statusCheckRollup`) | pass (exit 0; 15 pass, 0 fail) |
| D2: with any check pending, failed or missing, or the head moved, merge runs the gate as today | same run — `merge covered_by: when coverage fails, the gate runs as today` and its 10 subtests: pending, failed, missing, empty rollup, skipped, neutral, a name twice with the failed attempt last and first (list and `"ci"`), null conclusion, no status, an ignored check failing, a PR changing `.github/`, the head moved, the re-read failing, forge `git`; each writes the marker and one more `gate` line and prints why. Also: the first read still refuses failing and pending checks; `--no-gates` and inapplicable `paths` don't re-read | pass (same run) |
| D2: the tests catch a list judging only the last entry of a name | `sh docs/devteam-dev/tickets/kit-205-merge-reuses-green-ci/mutate-t1.sh` | pass (exit 0: the mutated run fails) |
| D3: no gate is skipped without the declaration | same run — `covered_by absent: merge runs the gate though every check is green` (one `pr view`, no re-read), `covered_by of a shape it doesn't know runs the gate and warns` | pass (same run) |
| D3: a gate the owner set stays the owner's setting to change | same run — `covered_by on an existing gate is the owner's gate-change` (alone, and riding with a new gate; refused with gateAdditions' reason, passes with a gate-change answer) and `covered_by on a new gate is not the supervisor's to add`; `sh docs/devteam-dev/tickets/kit-205-merge-reuses-green-ci/mutate-t2.sh` (both mutations caught) | pass (exit 0 each) |
| Merge's other tests unchanged | `run-tests.sh test/merge-admin.test.mjs`; `run-tests.sh test/multirepo-landing.test.mjs` (at bc26e57; devteam.mjs unchanged since) | pass (4/4; 7/7) |
| D4: test.yml passes on every job | `gh run view 43773504520 --json conclusion,headSha,attempt,jobs` | success, attempt 1, headSha e188a69, all 16 kit jobs and `tests` success |
| D4: no file is added | `git diff --name-status origin/main...HEAD` outside this folder | only `M`: quality.md, supervisor.md, devteam.mjs, kit.test.mjs |

Nothing is deferred to beta: merge's behaviour is fully exercised by the tests with a fake gh; the one path not tested is a `git diff` that fails with a valid merge base (task-1 T1-2, wont-fix agreed), where the code fails closed.

## Rulings on order (recorded here, not in plan.md, which plan-2 approved)

- m-20261115-212254105-supervisor: approve-plan at d74d44d; build after kit-208, kit-84, kit-85, kit-173.
- m-20261115-225221730-supervisor: build now (kit-173 dropped from depends_on); m-20261115-225719441-supervisor: depends_on restored, stop at a clean commit (stopped at 698dae2).
- m-20261115-225916691-supervisor: follows kit-202 (after kit-84); finish T2 and its reviews; PR when kit-202 has merged.
- m-20261115-231146737-supervisor: open the PR as a draft now for early CI; no merge-request until kit-202 has merged, then merge main and mark it ready.
- m-20261115-214223586-supervisor: review rounds capped (a third pass only confirms a Critical or Important fix).
