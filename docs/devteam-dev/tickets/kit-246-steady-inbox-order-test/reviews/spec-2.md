# Spec and plan review, pass 2

- Reviewer: spec-reviewer-2 (fresh subagent, claude-opus-5-5; neither author nor fixer)
- Reviewed: e63ceeb6b971826f1c0e45db120cecff851384a8 (the diff 4f4ab43..e63ceeb in the ticket folder: spec.md, plan.md, evidence/repro.sh, evidence/mutate.sh)

I read review 1 (spec-1.md) and the diff 4f4ab43..e63ceeb for the ticket folder, then checked each fix against the code it relies on: the subtest (test/next-step.strategy.test.mjs l.231-280), `impactBlock` and `openGoal` (docs/devteam/dashboard/index.html l.4034-4082), the `[data-correct]` and `[data-correct-send]` handlers (l.6979-7022), `press` (l.4959-4992), `goalImpacts`/`goalImpact` and `goalView` (docs/devteam/scripts/devteam.mjs l.2275-2297, l.11153, l.11341, l.12937), .github/workflows/test-stress.yml, and evidence/repro.test.mjs.txt with both repro outputs. I ran nothing.

**F1 is fixed.** The new Send wait is `[data-correct-sent="<key>"]` present, or `[data-correct="<key>"]`'s textContent `=== 'Change it'`.
- The first half is true from the press's `apply`, which `press` runs synchronously before the POST.
- The second half is true once a refresh has redrawn the drawer from data that has the correction. `impactBlock` draws the button's label with no whitespace around it (`>${i.by === 'owner' ? 'Change it' : 'Wrong?'}</button>`), so the strict compare matches.
- `by` comes from `goalImpacts`. A correction written by the owner and carrying a valid `impact` makes it `{ by: 'owner', rejudge: false }`. The dashboard's `DATA.ooda.goals` (l.12937) and `goal show` (l.11341) both go through `goalView` → `goalImpact`, so the page and the test's l.272-273 assertion (`impact.by === 'owner'`) read the same value. Nothing in the test re-judges the goal, so once `Change it` is drawn it stays drawn.
- The second half can't pass before the press: l.257 asserts the button reads `Wrong?`.
- On a refused POST, `restore` removes the note and reopens the form, and the button still reads `Wrong?`, so the wait fails under its own name, as it should.
- The wait now holds a state that, once the press is taken, becomes true and stays true. The transient-note false failure is gone.

**F2 is fixed.** The spec no longer says the failure comes "at once". It says the message changes and the bound is the same `until`.

**F3 is fixed.** Both scripts have `trap '…' EXIT` plus `trap 'exit 130' INT TERM HUP`. That is valid POSIX sh: `HUP`, `INT` and `TERM` are standard condition names, and in dash and bash an `exit` inside a signal trap runs the EXIT trap, so cleanup runs on those signals. In mutate.sh the traps are set before `sed -i`, after the refusal checks, so no early exit leaves a mutation behind. In repro.sh, `cp` runs one line before the trap is set. A signal in that window would leave the copy behind, but the window is negligible.
- One nuance, which needs no change: the inner `timeout 900` puts node in its own process group. A Ctrl-C or an outer group signal therefore reaches sh but not node, and sh runs its trap only after the pipeline ends (up to 900 s). Cleanup is late but still happens.
- Plan step 6's `git status --short` check after mutate.sh catches anything a SIGKILL leaves. repro.sh is not re-run (step 4), so it needs no such check.

**F4 is fixed.** Step 4 now says what the repros show: the race in main's order, and only the first wait in the fixed variant. It also says neither repro is re-run against the edited test. That matches repro.test.mjs.txt l.37-40, where `fixed` releases the held peek and waits for `loaded` before measuring, and it matches repro-fixed.txt. One small slip: step 4 says the repros "were run at main's test (4f4ab43)". The outputs were committed at 96f0de65 and 4f4ab43, and the test file there is main's. Harmless.

**F5 is fixed.** `load` is a dispatch input of test-stress.yml (a string, checked against `[0-8]` in the step), so `-f load=2` is valid. Read with the step's other `-f` flags, the fifth dispatch is the same command plus `load=2`. See F7 for what happens if it fails.

**F6 is fixed.** Plan step 1's comment names both halves (`.loading` gone, `.hist-h` present, and not drawn on a failed load). Acceptance check 1 in the spec repeats it.

**New in the changes.** The edge-case paragraph now leans on review 1's check that the drawer's times are absolute, and drops "milliseconds wide". It is consistent with the code (`when`, and the `You set it ${when(i.at)}` line). The spec's review-1 section matches the fixes. Values and refusals are unchanged from pass 1: a test-only change inside `touches`, apart from ticket-folder evidence.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F7 | Minor | done_when 1 (the flake "stops flaking"); done_when 2 ("passes every run") | spec § Acceptance checks 2 ("Its result is recorded either way"); plan Task 1 step 7 | The plan doesn't say what a failure of the fifth (`load=2`) dispatch means. If `the Inbox shows the order…` fails there, at one of its waits or at `the owner's value`, that is evidence the fix is incomplete, which is the thing this ticket closes. Recording it and moving on would be wrong. A failure in another subtest of the file, or a near-timeout under the burners, can be recorded as load noise. Say so: a target-subtest failure on the loaded run is diagnosed (from the run's log) before verification.md calls done_when 1 and 2 met, and the result goes in the PR either way. | |

Verdict: APPROVE e63ceeb6b971826f1c0e45db120cecff851384a8
