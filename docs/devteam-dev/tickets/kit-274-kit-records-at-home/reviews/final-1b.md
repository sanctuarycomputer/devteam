# Final review: kit-274 kit records at home (pass 1b)

- Reviewer: kit-274 final reviewer 1b (fresh subagent of the supervisor, not the author; model Fable 5.2, claude-fable-5-2)
- Reviewed: ca6bbcb769f26ab2555eebd0a5b7633d7ebc7d8b

## Findings

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec "Where it's computed" (S1: merge decides at the PR head, check-pr --repo at `--sha`); quality.md §3 (mutate, check a test fails) | devteam.mjs:5662 (cmdMerge), devteam.mjs:5198 (cmdCheckPr); test/multirepo-home.test.mjs A2b | Nothing pins that merge and check-pr decide at the commit judged. With `{ at: sha }` dropped from either call (the views form), the new test stays green: A2b removes the link's ticket refs only before check-ticket and review-worktree, never before merge or check-pr. The code is right (a probe with the link's local `ticket/<id>` reset to trunk and the PR head carrying the folder: `merge --dry-run` says ok, from the link, with the warning). A regression fails closed (`no records … in home`), so it would block merges, not let one through. | fixed: console-08-h covers merge and check-pr deciding at the PR head (both mutations now red) |
| F2 | Minor | spec "The transition rule" (home has none: no folder at home's main, …); spec Edge cases ("then home's main wins") | devteam.mjs:2802 (`homeTicketFolders(mainRef()).has`); test/multirepo-home.test.mjs | The home-main leg of "home wins" has no test: with that line deleted the new test stays green (A5 and A2c cover only home's local and origin `ticket/<id>`). The code is right (probe: a records folder committed to home's main for a left-in-link ticket, then check-ticket and `merge --dry-run` both refuse the link folder as outside touches and say `no records … in home`). | fixed: console-07-g covers home's main alone (mutation now red) |
| F3 | Minor | done-when 1; spec A1 | docs/devteam/process/worker.md:9 | The new sentence says that under `records: "home"` records go "in the checkout of home's `ticket/<id>` your prompt names". For a ticket whose records were left in the link, the prompt names no such checkout and says to keep them in this repo (tested, A7). A worker of kit-90 or kit-100 who follows worker.md and commits one record to home's `ticket/<id>` makes home win: its link folder is then refused and home's records are incomplete. It fails closed and the prompt is right, but the doc doesn't say the prompt decides. Four words would do ("as your prompt says"). | fixed: worker.md:9 now says the prompt decides, and a ticket begun before the switch keeps its records in that repo |
| F4 | Minor | spec Rulings Q5, A9; ruling m-20261117-044852436 | docs/devteam-dev/tickets/kit-274-kit-records-at-home/spec.md (Rulings Q5, A9) | The spec still says the copy goes to devteam-dev's `docs/superpowers/` (same path) and counts 33 files. What was ruled and done is `docs/devteam/project/designs/superpowers/`, 35 files (plan.md line 95, verification row 3, the PR body). The spec was not brought in line; a reader running A9 as written finds nothing at that path. | fixed: spec Rulings Q5 and A9 name docs/devteam/project/designs/superpowers/ and 35 files (and the Problem's count) |
| F5 | Minor | devteam.mjs:944-946 (records "home": "nothing of the project lands in the linked repo"); spec "The transition rule" | devteam.mjs:2797 `recordsLeftInRepo` | The rule has no end and no "before" test: any ticket of a records-"home" link, one started after the flip included, is read as records "repo" if its worker commits `<project>/tickets/<id>/` in the link and nothing in home. It merges with only the warning and puts the folder back in the link. Every check still runs on those records at the link head, so this is no gate hole, and the spec says so ("treated exactly as under records repo"); but the warning's words ("left from before …") are then untrue, and the kit's `docs/devteam-dev/` can come back after the supervisor's chore. For the supervisor's rollout note. | wont-fix: as specified (the rule reads any such ticket as records repo, every check still runs at the link head); the supervisor's rollout check (ls-tree of docs/devteam-dev in the kit, empty) catches a folder that comes back |

No Critical, no Important.

## What I checked

Read at the head in my worktree: the whole diff outside `docs/devteam-dev` (devteam.mjs, worker.md, test/multirepo-home.test.mjs, the 35 deletions), checkTicket, checkPr, cmdCheckPr, cmdMerge through landing, ticketReviewsRead, linkRepo, and every call site of recordsInHome/recordsInHomeId/recordsRepo. Ticket done-when and notes from `ticket show`; spec, plan, verification and the eight earlier review records.

**Tests run** (only test/multirepo-home.test.mjs, under the shared lock, `--test-concurrency=2`): baseline at the head, whole file: 14 pass, 0 fail, exit 0. `gh pr checks 319`: all 18 pass at ca6bbcb7.

**Mutations** on docs/devteam/scripts/devteam.mjs, one at a time, the new test ("left in the link"), restored with `git checkout --` after each (worktree clean at the end):

| Mutation | Result |
|---|---|
| the rule off (`recordsLeftInRepo` always false) | caught (leftInLink's approve-plan: no plan in home) |
| home's local `ticket/<id>` not counted as home records | caught (approve-plan, home-wins case) |
| home's `origin/ticket/<id>` not counted | caught (A2c: merge said "would merge") |
| merge doesn't fetch home's `ticket/<id>` first | caught (A2c merge) |
| check-pr doesn't fetch first | caught (A2c check-pr passed) |
| checkTicket decides by the views form (no `at`) | caught (A2b: records read from home, all missing) |
| reviews read without the command's decision (`src.inHome` dropped) | caught (A2b: no final review record) |
| the link folder exempt from touches even when home wins | caught (A2c/A5: no outside-touches refusal) |
| left in the link without a link folder (always true when home has none) | caught (A6: expected `no records … in home`) |
| review-worktree decides by the views form | caught (A2b: a `records:` line printed) |
| the warning not printed | caught (count is 1) |
| left-in-link verdicts not held to the head (the "does not hold" line skipped) | caught, and the ticket still failed on the approver count (a second guard) |
| left-in-link skips the record checks (`if (H && recSha)`) | caught |
| home's main not counted as home records | **survived** (F2) |
| merge decides by the views form | **survived** (F1) |
| check-pr decides by the views form | **survived** (F1) |
| approver count not held to the head for a left ticket (alone) | survived, but harmless: the "does not hold" line still fails the ticket, as the test checks |

**Attacks on the gate**, each run through a probe test in my scratch dir against the head's kit (fixture: `links.console.records: "home"`):

- No reviews at all, records left in the link: check-ticket, check-pr, `merge --dry-run` and a real `merge` all refuse (`no final review record`, `needs 1 final APPROVE`). Nothing merged.
- Reviews held to the wrong head (a code commit pushed after the final review): merge and check-pr refuse (`its verdict is at …, which does not hold at …`).
- Only a final APPROVE in the link folder, no spec, plan or verification: refused (all three missing).
- Records in both places, both complete and each with a valid final review: refused, link folder outside touches. Read from home only.
- Split records (final review in home naming both heads; spec, plan, verification in the link): home wins, refused (three missing in home, link folder outside touches). Never read from both.
- Home's main has the folder: home wins, refused (F2's probe).
- The link's local ticket branch stale and without the folder, the PR head with it: merge decides at the PR head, passes from the link with the warning (F1's probe).
- Home's own `check-pr --head-ref ticket/<id>` for a left-in-link ticket: refused (`is a ticket of console, not home`).
- Transition as specified: left in the link passes check-ticket with the warning once; nothing found that passes without full records and a final APPROVE at the judged head.

**Records unset (the default, "repo").** By reading: `recordsHomeSetting` is the old `recordsInHome` body unchanged; with it false, `recordsLeftInRepo` returns before any git call, `recordsInHome` is false as before, check-pr makes no fetch and passes `inHome` undefined, merge passes `inHome: false` (what checkTicket computed before), and the warning is guarded by the setting. By probe on the default fixture: a link ticket with records in the link passes check-ticket, check-pr and `merge --dry-run` with empty stderr; giving home's `ticket/<id>` a records folder changes nothing (still read from the link, still passes, the prompt still says "in this repo"). The file's existing tests pass, with the one line added to the setting test that the spec names (A8). I did not run test/multirepo-landing.test.mjs (not touched by the PR; box load): CI ran it green at this head. A "setting always home" mutation would be masked in this file by the transition rule itself, so I did not count one as proof.

**worker.md.** One sentence in §1, both cases, matches the code for a fresh ticket (promptFor, ensureRecordsWorktree); F3 is the left-in-link case.

**docs/superpowers.** Empty at the head (`git ls-tree -r HEAD -- docs/superpowers`: 0 files). All 35 blobs on the kit's origin/main equal devteam-dev `origin/main:docs/devteam/project/designs/superpowers/<same subpath>` by blob id (35 compared, 0 mismatched; 35 files there). No reference to `docs/superpowers` is left in the kit outside the ticket's records (the one comment in devteam.mjs was reworded).

**Kit rules.** Added files (`--diff-filter=A`): only the 13 under `docs/devteam-dev/tickets/kit-274-kit-records-at-home/`. Changed files outside it: worker.md, devteam.mjs, test/multirepo-home.test.mjs and the docs/superpowers deletions, all in touches. The PR body has `## One-way doors` (None.). Verification has a row per done-when.

Verdict: APPROVE ca6bbcb769f26ab2555eebd0a5b7633d7ebc7d8b
