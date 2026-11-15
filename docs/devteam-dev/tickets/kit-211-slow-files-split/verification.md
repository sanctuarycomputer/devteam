# kit-211 verification

The test files are as at **0814373**, the merge of origin/main. After it, the branch adds only the workflow's deletion and records. The base is **e8022ac**, main where the branch started. Main changed none of the five files since; it changed only `test/lib/chain.mjs` and added `test/goal-order.test.mjs`.

| # | Done-when | Command | Result |
|---|---|---|---|
| 1 | For each of the five files, the sorted top-level test names across its splits equal the base's. No test is split, so the count is unchanged (ruling m-20261115-161102170). | `node docs/devteam-dev/tickets/kit-211-slow-files-split/names.mjs e8022ac 0814373 machine next-step recovery pane-question operator-threads` | Exit 0. machine 57 → 57 (6 parts), next-step 16 → 16 (3), recovery 35 → 35 (3), pane-question 16 → 16 (3), operator-threads 19 → 19 (3). 143 in all. Every file's diff is `none`. The lists are in `names-1.md`; the base's list equals the head's, since the diff is empty. Each test moved byte for byte (`split.mjs`; reproduced byte-identically by every task reviewer). The only hand changes are those in `edits.mjs`. |
| 2 | Every resulting file is under 60 s of wall time on the Node 24 job. | Alone on a CI runner, per ruling m-20261115-165039090: temporary `kit-211-timing.yml`, run 43738924102 at 0814373, `node test/run.mjs --concurrency 1`, Node 24 | Slowest file `machine.box` at 36.8 s wall, then `machine.status` at 34.3 s and `operator-threads.store` at 31.0 s. All 18 files are ok. Per file and per test: `ci-timings-2.md`. Under test.yml's own concurrency 8 the whole job ran 1.7 to 2× slower, untouched files included (`ci-timings-1.md`), which is why the supervisor ruled to judge alone. |
| 3 | No test over 30 s; the incident test under 30 s or split, with its assertions kept. | Same run | Slowest test 21.0 s, the incident test "a worker's run folder gets nothing…" (95.6 s and 62 s on earlier main runs). Next are "status says at a glance" at 20.7 s and "the Overview in Chrome" at 16.2 s. No test is over 30 s, and none was split. The incident child now runs `test/machine.status.test.mjs`. Its pattern, TAP checks and decoy check are unchanged. |
| 4 | Fixed waits that were replaced are now `until()` polls on the state waited for. | `edits.mjs` (machine, recovery) | Replaced, by base line. machine L455: no `accounts-tick` child of that repo in `ps -A -ww -o args=`. machine L1022: the clock's second past `home`'s `session_created`. recovery L130: past the session's `session_created`. recovery L138: past the launch's second. recovery L224: the pane's command is `sh`, `bash`, `dash` or `zsh`. The kept waits, each with its reason, are listed in spec.md › Fixed waits; none of them changed. |
| 5 | test.yml green on every job at the PR head. | PR #263, test.yml run 43738924039 at 0814373 | All 8 jobs are green (18, 20, 22 and 24 × chain and rest). The head after it changes no test file, only the workflow's deletion and records. The run at the final head is quoted in the merge request. |
| 6 | After hooks in operator-threads\* and pane-question\* stop what their test started before removing folders, each stop on its own; shown once with the rmSync made to throw. | `node probe-run.mjs e8022ac <out>`, Node 22 | Exit 0, table in `probe-1.md`. At the base, every test whose stops were registered after its removal leaves them alive: the dashboard and its child (6 tests), Chrome (1), the claims test's `sleep 600`, and the standalone hub (2). At the head, all 14 tests leave none. Notes follow. |

## Notes on the probe (task review T6)

- **When it ran (F1).** It ran with the test files as at 20f2833. They are unchanged since then up to 0814373: the merge touched only `test/lib/chain.mjs` and added `test/goal-order.test.mjs`, and neither is imported by a probed file. probe.mjs had header-comment edits during the run, so its line numbers differ between the logs; its code was the same throughout.
- **Each test's own result (F2).** Under the probe, the base runs fail by design on the forced `rmSync` error. At the head, the pane-question dashboard tests fail on this box with a 403: the dashboard reads the real box's files. They fail the same way at the base (observation o-20261115-163506710), and they pass on CI. "held lines are typed once each" failed its order assertion once at the head. Its body is byte-identical to the base's, and it passes alone on Node 18 and on CI, so it is recorded as a flaky race (o-20261115-170824275). Each test's hooks ran either way, which is what the probe checks.
- **The hub rows (F3).** Rows 11 to 13 (hubFixture) check only direct children. Their tmux session is on the file-wide server, which the probe leaves out, and their hooks remove no folder, so the base and the head are the same by construction.
- **The probe's mechanism (F4).** The plan's T6 supersedes the spec's earlier wording: a root-level `after()` with a 180 s cap, where the spec still says a `process.emit` wrap and 120 s.

## Local runs (this box, load about 11 on 32 cores)

- `devteam.mjs gate test -- node test/run.mjs --concurrency 1 <18 parts>` on Node 18, at 662bbfd (`local-run-1.log`). 17 of 18 files pass. The one failure is `pane-question.answer`, with the box-files 403 above, at the base too. The Chrome tests skip on Node 18, as at the base.
- On Node 22, `next-step.strategy` passed 6/6 and `operator-threads.hub` 4/4, Chrome tests included.

## The temporary workflow

`.github/workflows/kit-211-timing.yml` was added at 359c296 and deleted at 1141666, before the final review. `git diff origin/main...HEAD -- .github` is empty.

## Outside the touches (for the supervisor)

- `test/timings.json` still lists the five old files, and the new ones weigh the median until weights are refreshed (kit-215).
- Two comments still name old files: `test/lib/ports.mjs`'s layout comment (kit-210 rewrites it) and one in `test/accounts.test.mjs` that names `recovery.test.mjs`.
- `operator-threads.store`'s wall time (31.0 s) is 20 s over its tests' sum. The idle-stdin test's `Promise.race` leaves a 20 s `setTimeout` uncleared, which holds the process open after the last test. This is in the base too, and it is not an edit the spec names.
