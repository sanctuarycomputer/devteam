# Task review, task 2, pass 2

- Reviewer: task-reviewer-2b (fresh subagent, claude-opus-5-5, cold confirm)
- Reviewed: 77205dbe66f540e74855ae0b95c6031805e7bb4b (the T2-1 fix, f45387f..77205db)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| — | | | | No new findings | |

**T2-1: confirmed fixed.** Read against `git diff f45387f 77205db -- test/kit.test.mjs docs/devteam-dev/tickets/kit-205-merge-reuses-green-ci/mutate-t2.sh` and `gateAdditions` (devteam.mjs L643–662, reason built at L5258):
- **Object form.** The test "covered_by on an existing gate is the owner's gate-change" now puts main's gate in object form (`covMainGates(F, { test: { cmd: 'true' } })`). The `cover` chore's only difference from main is now covered_by, so the form change no longer hides the edit check.
- **The gateAdditions reason.** For both chores the test asserts the full refusal text `changes owner settings: gates (gate-change) (gates: it changes test; only adding a gate is the supervisor's)`. That suffix comes only from `gateAdd.problem`, so the test now checks what gateAdditions reported, not only ownerSettingsChanged.
- **Covered_by riding with a new gate.** The new `ride` chore (`{ test: { cmd: 'true', covered_by: 'ci' }, lint: 'true' }`) is the pass-1 probe case, and it must be refused without `--approved`.
- **The approved path.** It is unchanged, using `merge('cover', '--approved', q)`.

I read `mutate-t2.sh` before running it. It handles each mutation in its own `mktemp -d` copy of docs/ and test/ with a private HOME, port 4792, DEVTEAM_* unset, a guarded `rm -rf "${S:?}" "${H:?}"`, and everything under timeout. It checks each sed applied before running (`grep -qF` proof, exit 2 if not), and it exits 0 only when both mutated runs exit non-zero. Its `edit` sed matches L656 exactly. The replacement sets `covered_by: undefined`, which `JSON.stringify` drops, so a real "gateAdditions ignores covered_by" mutation is what gets tested.

Runs, judged by exit code:
- `timeout 1000 sh docs/devteam-dev/tickets/kit-205-merge-reuses-green-ci/run-tests.sh` exited 0. All five covered_by tests (ok 6–10) passed: 15 pass, 0 fail.
- `timeout 1300 sh docs/devteam-dev/tickets/kit-205-merge-reuses-green-ci/mutate-t2.sh` exited 0.
  - `add` mutation (`GATE_ADD_FIELDS` gains covered_by): "not ok 10 - covered_by on a new gate is not the supervisor's to add", mutated run exit 1.
  - `edit` mutation: "not ok 9 - covered_by on an existing gate is the owner's gate-change", mutated run exit 1.

One observation, not a finding: under the `edit` mutation the `cover` iteration fails first, so the run never reaches `ride` and doesn't show that `ride` alone would catch it. `ride` still asserts both the non-zero status and the exact gateAdditions reason, so on reading it would go red too, as the pass-1 probe showed.

Verdict: APPROVE 77205dbe66f540e74855ae0b95c6031805e7bb4b
