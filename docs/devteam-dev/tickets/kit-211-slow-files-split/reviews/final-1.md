# Final review, pass 1

- Reviewer: final-reviewer 1 (fresh subagent, claude-opus-5-5)
- Reviewed: 048dd24cfc240a236ca2cddc068804070756f605 (the whole branch)

## What I read and ran

All in the detached review worktree at 048dd24c, against the spec, the plan and their Rulings sections, the ticket (`ticket show kit-211-slow-files-split`), quality.md §1 and §3, verification.md, ci-timings-2.md, probe-1.md, names-1.md, edits.mjs and pr-body.md.

- **The workflow's net diff.** `git diff origin/main...048dd24c -- .github` is empty (0 bytes). `.github/workflows/kit-211-timing.yml` was deleted at 1141666, as ruling m-20261115-165039090 requires.
- **Touches.** `git diff --name-only origin/main...048dd24c` lists, outside the ticket folder, only the 18 `test/<name>.<part>.test.mjs` files, the five removed `test/<name>.test.mjs` and the five `test/lib/<name>-fixture.mjs`. Every one is in the ticket's touches.
- **No test file after 0814373.** `git diff --name-only 0814373 048dd24c -- test` is empty. The commits after 0814373 are the workflow's deletion, ci-timings-2.md, names-1.md, task-6.md, verification.md and pr-body.md.
- **CI, read myself.** test.yml run 43738924039, headSha 0814373fbbf5…: all 8 jobs pass (18/20/22/24 × chain/rest; Node 24 rest has 690 tests, 689 pass, 1 skip, 0 fail). Timing run 43738924102, headSha 0814373: job `alone`, `node test/run.mjs --concurrency 1 --timings … test/machine.*.test.mjs … test/operator-threads.*.test.mjs`. Its runner summary says 18 files, all ok. The slowest is machine.box at 36.8 s, then machine.status at 34.3 s and operator-threads.store at 31.0 s. In the TAP there are only two `duration_ms` values over 20 s: the incident test "a worker's run folder gets nothing from the incident's own test…" at 20999.6 ms and "status says at a glance…" at 20685.8 ms. None is over 30 s. These match verification.md rows 2 and 3 and ci-timings-2.md. The one skip, recovery.restart's "a process that can't be read", is a conditional skip that is also in the base file.
- **Names.** I ran `node names.mjs e8022ac 048dd24c machine next-step recovery pane-question operator-threads` and it exited 0. The counts are machine 57→57, next-step 16→16, recovery 35→35, pane-question 16→16 and operator-threads 19→19, 143 in all, and every diff is `none`.
- **The split, reproduced.** I took a `git archive e8022ac test` copy in a private `mktemp -d` folder and ran `split.mjs <name>` then `edits.mjs <name>` for **all five** files (ESLINT at the default path). Then I `cmp`'d the output against 048dd24c's files: all 18 parts and all 5 fixtures are byte-identical.
- **An independent check that doesn't trust split.mjs.** My own script diffs base lines against head lines as multisets, per subject, across all parts plus the fixture, ignoring imports, exports and blank lines. The only lines added or removed are these:
  - the per-part and fixture header comments;
  - the incident child's target (`test/machine.test.mjs` → `test/machine.status.test.mjs`) and its comment;
  - the status test's two merged reads. The alert is now raised before the `st3` read, and all three asserts are kept on `done` and `st3`;
  - the five fixed waits: machine L455 (a `ps -A -ww -o args=` poll for the accounts-tick child) and L1022, recovery L130 and L138 (`session_created` and the clock's second), and recovery L224 (`pane_current_command` matching `^-?(sh|bash|dash|zsh)$`). Each is an `until()` on the state it waited for. Two `assert.ok(… > 0)` guards were added, which is why the assert counts rose by one each in machine (430→431) and recovery (204→205);
  - the `t.after` → `cleanup(t)`/`later` changes in pane-question and operator-threads.

  Nothing else changed. This is exactly the spec's list (Design › The incident test, Fixed waits, After hooks) and plan T1, T3, T4 and T5. The kept waits are untouched.
- **Hooks.** `cleanup(t)` in both fixtures is the plan's T4 code verbatim. It registers one `t.after` that runs the fns last-registered first, each awaited in its own try/catch, and then rethrows the first error. `grep t.after` across `test/pane-question.*.test.mjs` and `test/operator-threads.*.test.mjs` finds no direct `t.after` left. Every hook goes through `later`. In every test, `F.done()` (pane-question) or `rmSync(imageKit)` (the standalone hub) is registered first, so it runs last. In hubFixture, kill-session is registered before `dash.stop()`, which keeps the base's order: the dashboard stops first. The remaining try/finally blocks in operator-threads.pane stop only through `a.kill()`, `h.kill()` and `tmuxSh` kill-session/kill-pane, and pane-question.held's "what the card cannot answer" uses `finally { F.done(); }`. Both stay as the spec says. probe-1.md shows the base leaving processes in the 8 expected tests (dashboards, Chrome, `sleep 600`, the standalone hub) and the head leaving none in all 14.
- **Spec details.** No fixture imports `./lib/chrome.mjs`. Only next-step.strategy, pane-question.answer and operator-threads.hub import it, as the spec's edge cases say.
- **Rulings.** The supervisor's messages to kit-211 in `devteam.mjs history` are 161102170, 162630812, 165039090, 165102445 and the approve-plan note. The four rulings are in the plan's Rulings section, and 161102170 is also in the spec's.
- **Suppressions.** The PR's test diff adds none.
- **Run alone** (niced, `node test/run.mjs --concurrency 1`, DEVTEAM_* and TMUX* unset, box load about 18):
  - `test/machine.status.test.mjs`: ok, 88.0 s on this loaded box.
  - `test/operator-threads.hub.test.mjs`: ok, 3 pass and 1 skip (Chrome not found), 13.3 s.
  - No process from either run was left (checked with `ps` by the worktree path).
- **PR.** The title on #263 is exactly "kit-211-slow-files-split: machine, next-step, recovery, pane-question and operator-threads tests: no file over 60 s alone on CI, no test over 30 s" (§1.6). The PR body equals pr-body.md except for a trailing newline. Its `## One-way doors` is `None.`, and the ticket's `one_way_doors` is `[]` (§1.10). The branch is `ticket/kit-211-slow-files-split`.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| M1 | Minor | quality.md §1.5; done-when 5 | verification.md row 5 | test.yml is shown green at 0814373 (run 43738924039). At review time, the run at the final head 048dd24 (43739728100) was still in progress. The test files are identical between those commits, and the head only removes the timing workflow, so I expect the same result. The merge's gates must still see it pass at the exact head. | fixed: the merge request quotes test.yml green at the exact final head (gate ci) |
| M2 | Minor | quality.md §1.9 (outside touches, disclosed) | test/timings.json, test/lib/ports.mjs:16, test/accounts.test.mjs:334 | These files still name the removed files. verification.md and the PR body disclose all three for the supervisor (kit-215, kit-210). | wont-fix: outside the touches; named to the supervisor in verification.md and the PR body (kit-215, kit-210) |

Verdict: APPROVE 048dd24cfc240a236ca2cddc068804070756f605
