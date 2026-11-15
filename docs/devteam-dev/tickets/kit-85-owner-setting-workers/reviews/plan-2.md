# Plan review, pass 2

- Reviewer: confirm-reviewer-3 (fresh subagent, claude-opus-5-5)
- Reviewed: 34fa21dfbf5667f0c948a5ed8bad233a5da8c94e (plan.md, the pass-1 fixes)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P2-1 | Important | done-when 4 ("and not for an edit in an unmerged worktree"); spec.md:103 (the merge-chore act newer than the edit); quality.md §3 (a test that would catch a mutant) | plan.md:297 (`landedOverride`), plan.md:312 (state 4), plan.md:317-318 (states 9 and 10) | No state can fail if `landedOverride` drops its second clause (a `merge-chore` act with refs `chore-settings` newer than the edit), or compares the merge with the owner's act instead of the edit. In state 4 (edit 3, main 4) and state 10 (edit 5, main 3), the edit's value differs from main's, so the main-value clause alone already returns null. State 10 says it proves "an override that never merged clears nothing", but it cannot tell the rule from that mutant. Since the fix removed the head check, the merge clause is now the only thing that separates a landed edit from an unmerged one whose value equals main's, which is the no-op case that state 9 just made count. The failure path is plausible: the finding clears and the label says "Set by the supervisor" while the supervisor's edit still sits in an unmerged chore. Fix: in state 9, read `metrics --json` and the label after `settings set max_active_tickets 3` and before the merge, and expect `Saved; applies once the supervisor lands it` with the finding. Better still, also before the merge, have an older, unrelated `merge-chore` act come before the edit, so that a mutant comparing with the owner's act also fails. | |
| P2-2 | Minor | plan.md:110 (forecast check, P1-3) | plan.md:105-110 | The forecast check (null equals the cap set to the goal's open-ticket count) catches the `null ?? 1` mutant only if the goal has at least 2 open tickets: with 1, both give 1 slot. The fixture doesn't say which tickets belong to the goal. Say the goal holds at least two open, unmerged tickets, or assert directly that the forecast differs from the one at `max_active_tickets: 1`. | |
| P2-3 | Minor | spec.md:73; plan.md:199 | plan.md:199; devteam.mjs:13980 | Today's reading at 13980 gives a number from `run/dashboard-port` but a string from the log's regex match. `proof.port === ownDashboardPort()` is strict, so if the helper is lifted as it is, the log branch never matches. The happy-path box test would catch this, because a pinned dashboard has no port file, so this is Minor. Name `Number(...)` in the interface. Also note that moving the reading changes machine status to read the log first (spec-3 F3-2). | |

**P1-1 (Important): confirmed fixed.** Task 3 (plan.md:199) checks `proof.port === ownDashboardPort()`, which reads the last `started on http://127.0.0.1:<port>` in `run/dashboard.log`, else `run/dashboard-port`. I checked that every listen logs that line (devteam.mjs:15333) and that a pinned start writes no port file (devteam.mjs:11947-11951). The box test starts with `--port`, so its 200 can only pass through the log branch, and the another-port refusal is kept. See P2-3 for the number-versus-string detail.

**P1-2 (Important): confirmed fixed.** Task 0 waits for `kit-84-dashboard-data` to merge, merges `origin/main`, and records which of kit-84's names replace this plan's. The `CLASS_WORDS` step becomes an assertion, added only if kit-84 lacks the names. `mainSettingsRaw` is built on kit-84's `mainRef()` or settings view, so no second ref resolver is written. The CLASS_WORDS test now passes before this ticket's change, and the plan says so openly (plan.md:162). That is acceptable for an assertion on a dependency's map.

**P1-3 (Important): confirmed fixed.** I traced each reader at devteam.mjs:3836, 11568-11571 and 10301 against the new fixture (one active, `incident_slots` 1, an open incident, a ready fix ticket, two ready tickets). Unconverted, the plain idle-capacity line is missing (`1 < null` is false), so "exactly one, the plain one" fails. Memory-full is not raised (`1 < null` and `1 < 0 + 1` are both false), so that check fails too. The `(+1 for fix tickets)` suffix shows, so its absence check fails. The `max_active_tickets: 1` control proves that the fix-ready line and the incident are reached. The forecast check depends on the goal's size (P2-2).

**P1-4 (Important): confirmed fixed, with a gap.** The rule is now the design's (plan.md:297, spec.md:103), and the stray Task 4 item 7 is gone. State 9 covers the no-op override, with the label "Set by the supervisor (you asked for 5)" and no finding. But the merge clause the rule now rests on has no state that would catch its loss (P2-1).

**P1-5 (Important): confirmed fixed.** Task 3 adds two CLI cases, each with a valid, fresh, unused gateway proof: one for another value and one for another key, both refused with `/signed another/`. A mutant that drops the body-against-arguments check fails both.

**P1-6 (Important): confirmed fixed.** `setSettingsKey` calls `jsonDuplicateKeys` (devteam.mjs:677, which returns undefined for non-JSON and lists repeated keys at any depth) before and after the edit. It handles `{}`, requires exactly one top-level match for the value regex, and re-checks the edited key and every other top-level key. The new test refuses a block that repeats the key and leaves the file unchanged, and it checks that the empty block becomes valid JSON.

**P1-7: confirmed fixed.** Each warning line has its own guard (`DEVTEAM_QUIET_SETTINGS`, `DEVTEAM_QUIET_ASKABLE`), and a test edits both kinds and expects both lines once.

**P1-8: confirmed fixed.** The route test loops every `OWNER_SETTINGS` key.

**P1-9: confirmed fixed.** A marked-pane case (`run/supervisor-pane` and `run/supervisor-pane-role`, no `DEVTEAM_SUPERVISOR`) is added beside the `DEVTEAM_SUPERVISOR` case.

**P1-10: confirmed fixed.** The raw `7.0` body test is in Task 3's list (200, value 7).

**P1-11: confirmed fixed.** The assertion at gateway.test.mjs:406 is to be rewritten for the two signed routes. The replay test stays in owner-setting.test.mjs, and verification.md will say so.

**P1-12: confirmed fixed.** Validate checks the shape (key pattern, value 1 to 20 or null, no `artifact` or `tree`). The test includes a well-formed key that is off today's allowlist (passes) and malformed values and keys (refused). The untested TTY branch is wont-fix with a reason (CI has no terminal). That is acceptable for a Suggestion.

**P1-13: confirmed fixed.** Task 0's fixture notes name component lines first, `ticket add` as SUP, and resetting the chore worktree and branch between cycles.

Every file the fixes name stays inside the touches: devteam.mjs, gateway.mjs, the two test files and the schema. P2-1 blocks: the fix moved the whole weight of "has landed" onto the merge clause, but nothing tests that clause.

Verdict: CHANGES 34fa21dfbf5667f0c948a5ed8bad233a5da8c94e
