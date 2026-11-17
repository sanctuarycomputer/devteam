# Final review: kit-274 kit records at home (pass 1a)

- Reviewer: kit-274 final reviewer 1a (fresh subagent of the supervisor, not the author; model claude-opus-5-5)
- Reviewed: ca6bbcb769f26ab2555eebd0a5b7633d7ebc7d8b

## Findings

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Important | spec "The transition rule" ("home has none for it: no `<projectRel>/tickets/<id>/` folder at home's main, nor at home's local `ticket/<id>`, nor at `origin/ticket/<id>`"), "Home wins", Edge cases ("Records in both places: home wins ... Never merged from both"); quality.md §3 (missing test with a plausible failure path) | docs/devteam/scripts/devteam.mjs `recordsLeftInRepo` (`if (homeTicketFolders(mainRef()).has(t.id)) return false;`); test/multirepo-home.test.mjs, test "a ticket whose records were left in the link merges from there until home has some" | No test covers the home-main part of "home has none". Mutation M8 deletes that line, and all 14 tests in test/multirepo-home.test.mjs still pass. Every home-wins case in the test gives home records on a `ticket/<id>` ref (local, or origin from another clone), never on home's main alone. The failure path is real. On a GitHub home, a records PR can merge before the code (the "records-gh" test: "a merged records PR is recognized (branch there or gone)"), and with auto-delete its branch is gone. Home's records are then only on main. If that line regresses, a link PR that still carries `<project>/tickets/<id>/` is judged as left in the link: merge reads the link copy and lands it, so the ticket has records in both places, merged from the link, and the link folder is not refused. Fix: add one case, home records committed to home's main only (no local or origin `ticket/<id>` holding the folder) and a link folder in the PR. check-ticket must refuse it as `changes files outside touches: docs/devteam/project/tickets/<id>/…` and print no warning. | fixed: console-07-g, home records on home's main only and the link folder in the PR: check-ticket and merge --dry-run refuse it as outside touches, no warning (M8 now red) |
| F2 | Minor | spec S1 ("`cmdMerge` decides at the PR head") | devteam.mjs cmdMerge `recordsInHomeId(id, { at: sha })` | Mutation M12 makes merge decide in the views form (no `at`), and it survives. The only test of merge's decision is A2c's dry run, where the link's ticket branch and the PR head agree. I traced how a stale local link `ticket/<id>` could disagree with the head: each such case fails closed (`no records … in home`, or `spec.md missing` read at the head). So this is a missing test with no unsafe path. A merge case with the link's local ticket branch detached or deleted, like A2b does for check-ticket, would cover it. | fixed: console-08-h, the link's local ticket/<id> reset to trunk: merge --dry-run and check-pr pass from the PR head with one warning (M12 and check-pr's views form now red) |
| F3 | Minor | brief/spec A8 (records unset: nothing changes) | test/multirepo-home.test.mjs | In the touched test file, nothing pins the default. Mutation M11 makes `recordsHomeSetting` return true for every link ticket, and all 14 tests still pass. In this file, a `records: "repo"` ticket that has a link folder now only gains a warning, and no test asserts that a repo-mode ticket gets none. By reading the code, the default is unchanged: `recordsInHome = recordsHomeSetting(t) && !recordsLeftInRepo(...)`, `recordsLeftInRepo` returns false when the setting is off, and the warning is guarded by `recordsHomeSetting`. A8 leans on test/multirepo-landing.test.mjs. The PR doesn't touch that file, so I did not run it (brief: touched files only). An `assert.equal(warnings(err, id), 0)` on a repo-mode check-ticket would pin the default in the touched file. | fixed: new test 'a link left on records "repo" (the default) never reads as left in the link' (M11 now red) |

## What I checked

All runs: test/multirepo-home.test.mjs only, under the shared flock, `--test-concurrency=2`, judged by exit code. Baseline at ca6bbcb7: exit 0, 14/14 pass.

Mutations on docs/devteam/scripts/devteam.mjs, each restored with `git checkout --` (worktree clean after each):

| Id | Mutation | Result |
|---|---|---|
| M1 | `recordsLeftInRepo` always returns false (the rule removed) | caught (the new test fails) |
| M2 | checkTicket decides in the views form (`recordsInHome(t)`, no `at: sha`) | caught (line 417, A2b: refs gone) |
| M3 | `ticketReviewsRead` ignores `src.inHome` | caught (line 417, A2b) |
| M4 | merge does not fetch home's `origin/ticket/<id>` before deciding | caught (line 448, A2c merge dry-run) |
| M5 | `check-pr --repo` decides before fetching | caught (line 450, A2c check-pr) |
| M6 | home-wins check ignores `refs/remotes/origin/ticket/<id>` | caught (line 448) |
| M7 | home-wins check ignores the local `refs/heads/ticket/<id>` | caught (the setting test and the new test) |
| M8 | home-wins check ignores home's main | **survived** (F1) |
| M9 | link `<project>/tickets/<id>/` exempt from touches even when H (records in home) | caught (the check-ticket-from-home test and the new test) |
| M10 | warning removed | caught |
| M11 | `recordsHomeSetting` true for every link ticket (defaults attack) | **survived** in this file (F3) |
| M12 | merge decides in the views form (no `at: sha`) | **survived** (F2, fails closed) |
| M13 | review-worktree decides in the views form | caught |
| M14 | the link side always "has records" (`return true`) | caught (5 tests) |
| M15 | home-side `- Records:` verdict never checked (`recordsHold` always true) | caught (the merge test and the new test, A6) |

The warn-once guard (`leftWarned`) was already found to survive in task-1 (F1 there, wont-fix). I did not re-run it.

Gate attacks, by reading the code at the head:
- **Left in the link.** `H` is false and src is `{ ref: sha, repo: R }`, so spec, plan, verification and reviews are read from the link at the head. Verdicts are held to the link head by `verdictHolds` against the link's reviews dir, the link folder is exempt from touches, and risk-high still needs 2 named APPROVEs. Tested: A2 passes, A3 stale (`its verdict is at … does not hold`), A4 missing (`plan.md missing`, `verification.md missing`). No reviews at all: `no final review record` holds as before.
- **Home wins.** Any home folder (main, local or origin `ticket/<id>`) makes `H` true. Records then come from home, the `- Records:` line is required and checked, and the link folder is refused as outside touches. Tested: A5, A6, and A2c with records pushed from another clone. The main leg is untested (F1).
- **Both places.** Home wins, and the link folder is refused, except in the untested main-only case (F1).
- **One decision per command.** checkTicket passes `H` to `ticketReviews` through `src.inHome`, and the reviews memo key includes it. merge passes `inHome` to checkPr and checkTicket, and `check-pr --repo` does the same. When the home fetch fails and home has nothing on origin: `records` is null and the check fails with `no records … push it` (fail closed). Deleting home's ticket branch only flips a ticket back to link mode, where the full link records and reviews at the head are still required, so it is not a bypass.
- **Unreadable link.** Not left (H true), so the ticket fails in home or on link-unreachable, as the spec says.
- **The default.** `records: "repo"` gives `recordsHomeSetting` false, so `H` is false and no warning prints, as before. Confirmed by reading. Test coverage of it is weak (F3).
- **Not a finding.** The rule has no cutoff: a fresh ticket under `records: "home"` that writes its records in the link passes as "left", with the warning. This is the Q2 ruling as written, and the gate still holds every record check.

worker.md §1: the new sentence matches promptFor (devteam.mjs ~17007). With records "home", the records go under home's `docs/devteam/project/tickets/<id>/` in `recordsWorktreePath(id)`, "a checkout of home on its branch ticket/<id>", and "nothing of the project" lands in the repo. Otherwise they go under `<project>/tickets/<id>/` in that repo. `grep -n 'records: "home"'` finds it at line 9. worker.md is a process doc, so the supervisor asks governance-edit before merge (ticket notes).

docs/superpowers/:
- At the head, `git ls-tree -r --name-only HEAD -- docs/superpowers` lists 0 files.
- The merge base and kit origin/main (f8c7e5ff) each have 35 files there, with no changes since the base.
- `git merge-tree --write-tree origin/main HEAD` gives a tree with no docs/superpowers.
- Each of the 35 blob ids at the base equals devteam-dev `origin/main:docs/devteam/project/designs/superpowers/<path>` (4bbce86a5): 35 checked, 0 mismatched, and 35 files are on that side.

Kit rules:
- `git diff --name-status --diff-filter=A origin/main...HEAD` adds files only under `docs/devteam-dev/tickets/kit-274-kit-records-at-home/`. test/multirepo-home.test.mjs already exists and is modified.
- Outside the records folder, the changed files are worker.md, devteam.mjs, docs/superpowers/** and test/multirepo-home.test.mjs, all in touches.
- `gh pr view 319` head is ca6bbcb7 and its body has `## One-way doors` (None.).
- Commits after the code head 70f9e788 change only verification.md.
- CI at ca6bbcb7 was pending when I looked.

Process notes: two harness auto-backgroundings and one wrapper timeout left one of my own test runs orphaned. I killed it, and the worktree was restored and clean. The M9 result above is from a clean re-run.

Verdict: CHANGES ca6bbcb769f26ab2555eebd0a5b7633d7ebc7d8b
