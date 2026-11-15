# Plan review, pass 1

- Reviewer: fresh subagent of the kit-212 worker, combined spec+plan review (claude-opus-5-5)
- Reviewed: 3def6f17c00dfc4e8d80c776a6276b7bfdd884e1 (plan.md, with spec.md and the tools in this folder)

Evidence is in spec-1.md (same pass). In short: `split.mjs accounts --check` exits 0. A full split in a scratch copy lints clean, and every test moved verbatim and in order. The rotation and leaving parts pass alone.

Checked and sound:
- Scope. The plan writes only the six `test/accounts.*.test.mjs` files and `test/lib/accounts-fixture.mjs`, and removes `test/accounts.test.mjs`. All of these are in the ticket's touches. The tools and records stay in the ticket folder. The out-of-touch leftovers (`test/timings.json`, the `ports.mjs` comment) go to the supervisor. `test/run.test.mjs` tolerates a stale `timings.json` entry, as kit-211's merge showed.
- Mechanics. The split is mechanical and refuses on any unplaced test or undefined name. `names.mjs` fails on any name it can't read. The task review is briefed to recheck verbatim moves.
- Verification. CI is the gate. The plan reads the run's conclusion, runs the CI gate rather than typing it, computes per-part sums from the head log with `specdur.mjs`, regroups if a part is over 45 s, and asks the supervisor before acting on a single test over 30 s. Each done-when gets a row in verification.md.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P1 | Minor | Rulings (fallback) | Rulings, "If refused" | "a `split.mjs` option: inline the fixture" names an option that does not exist (split.mjs takes only `<name> [--check]`). Inlining as-is would also fail step 3's lint on names a part doesn't use. The touches already include the fixture (supervisor act at 2026-11-15T21:03:05), so record the ruling as granted and delete the fallback (spec-1 F2/F3). | fixed: ruling recorded as granted, fallback deleted |
| P2 | Minor | done-when 2; spec acceptance check 2 | Task T1 step 5 | "Record each part's time" should record both the run's `duration_ms` (the file's wall time, start-up and exit included) and the sum of that part's test durations. That puts the gap the spec's CI reading relies on into verification.md (spec-1 F1: +4.3 s measured on rotation, not "under 2 s"). Wrap each run in `timeout 600` as well, per the box rules. Under the gate the output isn't a TTY, so node uses the TAP reporter: read `duration_ms` from TAP, since specdur.mjs only parses spec-reporter lines. | fixed: step 5 records the file duration_ms and the tests' sum from TAP, under timeout 600 |
| P3 | Minor | done-when 1 ("at the base") | Finish | If main changed `test/accounts.test.mjs` and the file is re-split from main, step 4's `names.mjs de07a84 HEAD accounts` compares against the wrong base. Compare against the main commit that was actually split (the merge's main parent), and say so in verification.md. | fixed: step 4 and Finish compare against the main commit actually split |
| P4 | Suggestion | — | Task T1 step 6 | Give the task reviewer a concrete verbatim check. For example: each base test chunk (from `chunks.mjs`, with its leading comment lines) is a substring of exactly one part, at increasing offsets within that part. This reviewer ran that check, and it passed except for the replaced two-line header comment, which is expected. | fixed: step 6 gives the reviewer that substring-at-increasing-offsets check |

Verdict: APPROVE 3def6f17c00dfc4e8d80c776a6276b7bfdd884e1
