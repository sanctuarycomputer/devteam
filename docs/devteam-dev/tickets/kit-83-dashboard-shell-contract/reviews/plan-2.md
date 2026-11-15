# Plan review, pass 2

- Reviewer: spec-plan-reviewer 2 (fresh subagent, claude-opus-5-5)
- Reviewed: 47334feb50251880d671f54bc291f1a9101ba9c7 (plan.md, diff since 35cda8a)

I read plan-1.md, then the plan diff since 35cda8a. I checked it against the new spec, the ticket's touches and done_when, `test/lib/kit.mjs` (`PORTS`, `dashboardOnFreePort`, the hub port it sets) and `test/dashboard-answers.test.mjs`'s port pattern. Every file the plan writes is still in `touches`. Its one defect is the selector form inherited from the spec (P2-1, spec-2 F2-1).
- P1 holds: a pinned copy of `STATES` from `ad139e1` is the oracle, so a port that changes a label, tone or rank fails.
- P2 holds: each case is in T1, and each fails on pass 1's spec.
- P3 holds: T4 checks the `.no-shell` region's computed styles against the styled names outside it.
- P4 holds: `new vm.Script` on every inline script, plus `var` in the regex. The regex still catches `function` duplicates, which compile.
- P5 holds: the smoke runs over today's `#overview` and hub `/` assert only that a result came back.
- P6 holds: stop, `phase blocked`, and a design-change message.
- P7 holds: the keyframe check, standard properties only, a peek open, and the hub's Overview.
- P8 wont-fix is accepted: the ticket's notes say "Its fake is the real components", so C commits them, and T1's recorded run against main is an honest red.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P2-1 | Minor | spec-2 F2-1; spec §2 Contents (state classes on the `.shell` element) | T1 scope check | T1's pattern requires every selector to be `:where(.shell) …:not(:where(.no-shell, .no-shell *))[::pseudo]`. The block's frame rules (`.drawer` under `.shell.peek-open`, `.main` and the drawer's `right` under `.shell.threads-open`) need a compound prefix such as `:where(.shell.peek-open)`, which that pattern rejects. Accept exactly the prefixes F2-1 names, and keep the boundary required on the subject. | fixed: T1's check accepts the state classes on the prefix and still requires the boundary on the subject |

Verdict: APPROVE 47334feb50251880d671f54bc291f1a9101ba9c7
