# kit-236-owner-action-controls: verification

At commit `70a27ea1dabbf3f600a14ed26389ef53e3603b44` (product code and tests as of `06d5dc9`, after merging `origin/main`; `70a27ea` adds only the PR body, and later commits change only this ticket's records). Local runs on the box used Node 22.23.4 (`/usr/local/bin/node`) with Chromium, one test file at a time at `--test-concurrency=2`; GitHub CI is the gate.

| # | Done-when | Command | Result |
|---|---|---|---|
| 1 | `test/dashboard-owner-action.test.mjs` passes in CI (headless Chrome): an owner-action question whose refs name accepted knowledge or a goal draws, on its card, that record's own control (Retire it for knowledge, Let go then Confirm let go for a goal), which posts the same owner action the Knowledge and Goals pages post | `devteam.mjs gate test -- /usr/local/bin/node --test --test-concurrency=2 test/dashboard-owner-action.test.mjs` | pass 6, fail 0 (gate test ok) at `06d5dc9`, and at `e5d916b` twice and `5b1d3c1`. Subtest "controls post what the Knowledge and Goals pages post, on either copy": the posted bodies are compared with the Knowledge drawer's Retire it and a goal's hold bar. RED first at `a6d95a2` (no rows on main): every subtest failed, the setup passed |
| 2 | The same test: an owner-action card always shows Done and Can't right now as its answers; a recommendation is shown as a line of text, never as an answer button, and pressing Done while a named record is unchanged shows 'not done yet' beside it instead of answering | same command | pass, subtests "answers: …", "Done waits: …" (both copies) and "Done goes through once every record is done; never while one is unchanged" (three fast presses post nothing; Can't right now with a note posts) |
| 3 | The same test: a record already retired or let go shows as done on the card, with no control | same command | pass, subtest "already done shows done, with no control" |
| – | No regression in the other dashboard tests | `devteam.mjs gate test -- /usr/local/bin/node --test --test-concurrency=2 test/dashboard-answers.test.mjs`; the same for `test/dashboard.test.mjs` | `dashboard-answers`: pass 3, fail 0 at `06d5dc9`. `dashboard.test.mjs` (run once, at `e5d916b`): pass 156, fail 1; the one failure ("the Library's preview card opens the stage here…", a null `[data-preview] [data-copy]`) touches nothing this change does and passed when rerun alone right after; recorded as observation `o-20261115-082551812` (flaky). CI runs the full suite at the head |
| 1-3 | CI, every job | `devteam.mjs gate ci -- gh pr checks 258 --repo sanctuarycomputer/devteam --watch --fail-fast`, then, after rerunning the one failed job, `devteam.mjs gate ci -- gh run watch 43694762625 --repo sanctuarycomputer/devteam --exit-status` | 8/8 jobs success at `70a27ea` (run 43694762625; kit 18/20/22/24 × rest/chain; gate ci ok at 08:43:20). The first attempt of kit (22, rest) failed: in `test/dashboard.test.mjs`, `presses` passed all 5 subtests, then the file died with "Promise resolution is still pending but the event loop has already resolved" and its later tests were cancelled; the rerun of that job passed (observation `o-20261115-083833863`, flaky). Later commits change only this ticket's records |

## Screenshots (m-20261115-081233736-supervisor)

An owner-action card naming five records, with Done pressed while three are unchanged and one goal's Let go waiting for its confirm. Taken with headless Chrome over a real dashboard by `screenshots/shoot.mjs` (`/usr/local/bin/node docs/devteam-dev/tickets/kit-236-owner-action-controls/screenshots/shoot.mjs` from the repo root, own `HOME` and test ports):

- `screenshots/owner-action-desktop-light.png`, `owner-action-desktop-dark.png` (1280 wide)
- `screenshots/owner-action-phone-light.png`, `owner-action-phone-dark.png` (390 wide)

The rows wrap on a phone and nothing sticks out of the card. The new lines sit inside `.qcard`, which already caps its width (`--measure`); bringing every page to the half-grid rule (`k-20261114-214823656`) is DCL-S9's.

## Rulings

- `m-20261115-074646713-supervisor`: combined spec and plan review (trial `a-20261115-074130886`); screenshots before the final review.
- `m-20261115-080646829-supervisor`: every probe from a scratch root with its own `HOME`, hub port away from 4320 and `DEVTEAM_*` unset; `shoot.mjs` sets its own `HOME`, and `~/.devteam/repos-4320/` was checked after each run.
- `m-20261115-081233736-supervisor`: approve-spec and approve-plan at `bc8f40a`; records are the k-/g- ids in the context; Done never posts while one is unchanged.

Nothing is deferred to beta.
