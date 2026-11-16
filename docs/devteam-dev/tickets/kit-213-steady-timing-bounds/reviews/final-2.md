# Final review, pass 2

- Reviewer: final2 (fresh subagent, claude-opus-5-5)
- Reviewed: 0dc5ed8889f3d02f201152120a7fa8f76de0eef3 (cold confirm: diff since 402ef7b, and the CI run)

## What I checked

- Scope: `git diff --stat 402ef7b 0dc5ed8` touches only this ticket's folder: `verification.md` (row 4, one line), `reviews/final-1.md` (pass 1's record, added at 50f24f3, its disposition cells filled at 0dc5ed8) and `dispose-2.sh` (the dispositions script, ticket-folder only). No test or kit code changed since 402ef7b. Pass 1 was CHANGES, so the verification.md edit is the fix itself, which quality.md §3 allows.
- `git diff --stat 9f244a3 0dc5ed8 -- test/` lists only `test/bounds.test.mjs` and `test/speed.test.mjs`; `test/dashboard-owner-action.test.mjs` is not touched by this branch.
- `gh run view 43751033783 --json headSha,attempt,conclusion,jobs` (exit 0): headSha 402ef7bff5739c2689c493759e35f21663dc803c, attempt 2, conclusion `success`, all 8 jobs (kit 18/20/22/24, chain and rest) `success`.
- `gh run view 43751033783 --attempt 1 --json conclusion,jobs` (exit 0): conclusion `failure`, one job failed, kit (22, rest); the other seven succeeded. `--attempt 1 --log-failed` (exit 0): `# fail 1` of 691, the one failure is `not ok 87 - owner-action: the named records' own controls…` under `not ok 9 - test/dashboard-owner-action.test.mjs`.
- The ticket's log has observation o-20261115-192324709 for that flake and a `gate ci` record (r-20261115-193054708, ok true, 423 s) after the rerun. The record's `sha` is the local head then (50f24f3, whose code is 402ef7b's), not the run's head; the run itself is confirmed at 402ef7b above.
- verification.md row 4 matches all of this: the run id, its head 402ef7b, attempt 1's single failed job and file, the rerun of the failed job, gate ci exit 0, and attempt 2 success on 8 of 8 jobs.

## Earlier findings

- F1 (Important, test.yml not green at the head): fixed. Run 43751033783 at 402ef7b is green on all 8 jobs on attempt 2; the attempt-1 failure was the one known after-hook flake in a file this branch doesn't touch; verification.md row 4 records it accurately. Commits after 402ef7b change only this ticket's folder.
- F2 (Minor, spec says "six more" coverage calls): wont-fix agreed. It is wording in the approved spec only; verification.md already states the exact count, and the code is right.
- F3 (Minor, B2's count bound has about 2x headroom): wont-fix agreed. The bound catches the 10x the done-when asks for (shown by the b2 patch); tightening it is beyond this ticket.

## Findings

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

Verdict: APPROVE 0dc5ed8889f3d02f201152120a7fa8f76de0eef3
