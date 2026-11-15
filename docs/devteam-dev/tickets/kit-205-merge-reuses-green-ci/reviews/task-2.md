# Task review, task 2, pass 1

- Reviewer: task-reviewer-2 (fresh subagent, claude-opus-5-5)
- Reviewed: f45387ffea62d2ab2c8aa61f1471c1e4153af9ba (bc26e57..f45387f)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T2-1 | Important | spec "Who may set it" (gateAdditions reports "it changes &lt;gate&gt;"; "Both are pinned by tests, so a later change can't quietly let the supervisor declare coverage"); D3; quality.md §3 "Scoped" (mutate and check a test fails) | test/kit.test.mjs, "covered_by on an existing gate is the owner's gate-change" | The test doesn't pin the gateAdditions path that the spec names. Main's gate is the string `'true'` and the chore turns it into the object `{ cmd: 'true', covered_by: 'ci' }`. Because the form itself changes, any edit comparison sees a change, whatever it does with covered_by. The assertion `/changes owner settings: gates \(gate-change\)/` also comes only from ownerSettingsChanged, so it never checks what gateAdditions reported. I ran mutation A in a scratch copy: gateAdditions' `edited` comparison drops `covered_by` before comparing. Test 1 still passes. Its object-form variant (main `{ test: { cmd: 'true' } }`) also passes. A probe test then showed the hole is real. The probe used main `{ test: { cmd: 'true' } }` and a chore of `{ test: { cmd: 'true', covered_by: 'ci' }, lint: 'true' }`, run as `merge --chore probe --dry-run` with no `--approved`. Under the mutation it **succeeds**: the supervisor sets covered_by on the owner's gate by adding a gate in the same chore. Fix: put main's gate in object form (`{ test: { cmd: 'true' } }`) and also assert `/gates: it changes test/`. That catches mutation A. Better still, add the "covered_by plus a new gate" case. |  |

**Docs.** I checked them against cmdMerge and forgeCoverage (devteam.mjs L5062–5095, L5368–5401). The quality.md §2 paragraph is the plan's Task 2 text word for word, and it says what the code does:
- **When a gate is covered.** The PR is read again by number and the head must equal `sha`. Under `"ci"`, every entry must be SUCCESS (ignored_checks included) and there must be at least one entry. Under a list, every named check must be present and every entry with that name must be SUCCESS. SKIPPED or NEUTRAL is not coverage.
- **When the gate still runs.** A change under `.github/` and forge `git` both mean the gate runs.
- **What is recorded.** The act's `what` records each covered gate.

It meets ruling m-20261115-204545585: the paragraph says "at the exact head sha … never at an earlier commit" and "missing, failed or pending … the gate runs as usual". It recommends the list form. Two cases are left out: a failed re-read and a malformed value (which runs with a warning). The plan's own text leaves them out too, both fall on the safe side, and a task review does not reopen the plan. So this is not a finding.

The three clauses are where ruling m-20261115-204936899 allows them: quality.md L24 and L121, and supervisor.md L127. Each is worded to fit its sentence and correctly points to §2. Nothing else in governance/ or process/ changed. The ticket-folder files (docs-edit.py, mutate-t2.sh) are records and add nothing outside the ticket folder.

**Tests.**
- `run-tests.sh` exit 0: 5 covered_by tests pass, 0 fail.
- `mutate-t2.sh` exit 0: when GATE_ADD_FIELDS gains `covered_by`, test 2 fails as it should. Test 2 does pin newGateProblem.
- Test 1 survives mutation A (T2-1).

Verdict: CHANGES f45387ffea62d2ab2c8aa61f1471c1e4153af9ba
