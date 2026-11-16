#!/usr/bin/env python3
# One-off: apply spec-1's findings to spec.md. Each replacement must match exactly once.
import sys, os
d = os.path.dirname(os.path.abspath(__file__))
f = os.path.join(d, 'spec.md')
s = open(f).read()
R = [
("""- `"covered_by": "ci"`: covered by every check the forge reports at the head.
- `"covered_by": ["test (node 22)", "lint"]`: covered by these named checks (a non-empty list of check names, as the rollup names them: a CheckRun's `name` or a StatusContext's `context`). Recommended in the docs: it catches a check that never reported.""",
"""- `"covered_by": "ci"`: covered by every check the forge reports at the head; every one must be SUCCESS.
- `"covered_by": ["test (node 22)", "lint"]`: covered by these named checks (a non-empty list of check names, as the rollup names them: a CheckRun's `name` or a StatusContext's `context`). Recommended in quality.md: it catches a check that never reported, which `"ci"` can't (F1-1)."""),
("""1. Forge `git` (no forge checks): not covered; the gate runs, and merge says why.
2. It re-reads the PR (`gh pr view <branch> --json headRefOid,statusCheckRollup`), once per merge, right before the gate loop. If that call fails, or its `headRefOid` is not `sha` (the head moved), no gate is covered: each runs as today and merge says why.""",
"""1. Forge `git` (no forge checks): not covered; the gate runs, and merge says why.
2. The PR changes the forge's CI configuration (any file under `.github/` between the merge base and `sha`): not covered; the gate runs, and merge says why. On GitHub a `pull_request` workflow runs the workflow files of the PR itself, so a PR that renames the covering job, adds a `paths:` filter or changes the job's command would otherwise define the very CI that excuses the owner's gate (F1-2; R1). `.github/` is the only forge config the kit reads checks from (forge `github`).
3. It re-reads the PR by number (`gh pr view <pr.number> --json headRefOid,statusCheckRollup`), once per merge, right before the gate loop. If that call fails or its output doesn't parse, or its `headRefOid` is not `sha` (the head moved), no gate is covered: each runs as today and merge says why."""),
("""3. On that fresh rollup:
   - `"ci"`: covered when the rollup is non-empty, **every** entry (ignored_checks included: an ignored check is never coverage, and a failing one is not green) is complete with conclusion/state SUCCESS, NEUTRAL or SKIPPED, and at least one is SUCCESS.""",
"""4. On that fresh rollup, each entry is read by one helper shared with today's pending/failing check, so the two reads can't drift (F1-5): an entry with `state` or `__typename` StatusContext is judged by `state`; a CheckRun is complete only when `status` is COMPLETED and is then judged by `conclusion`; both uppercased; anything else is pending.
   - `"ci"`: covered when the rollup is non-empty and **every** entry (ignored_checks included: an ignored check is never coverage, and a failing one is not green) is SUCCESS. A SKIPPED or NEUTRAL entry means not covered: a suite skipped by a job `if:` beside a green lint job did not run (F1-1)."""),
("""4. A `covered_by` value of any other shape""", """5. A `covered_by` value of any other shape"""),
("""5. Covered: the gate does not run.""", """6. Covered: the gate does not run."""),
("""| D2 | With any check pending, failed or missing, or the head moved, the gate runs as today | tests, one per case: pending; failed; a named check missing; an empty rollup for `"ci"`; only SKIPPED for `"ci"`; a NEUTRAL entry for a named check; an ignored_checks entry failing under `"ci"`; the re-read shows another headRefOid; the re-read fails; forge `git` → the gate's marker is written and a `gate` line logged |""",
"""| D2 | With any check pending, failed or missing, or the head moved, the gate runs as today | tests, one per case: pending; failed; a named check missing; an empty rollup for `"ci"`; SUCCESS plus SKIPPED for `"ci"`; a NEUTRAL entry for a named check; a named check twice, one failed; an ignored_checks entry failing under `"ci"`; the PR changes a file under `.github/`; the re-read shows another headRefOid; the re-read fails; forge `git` → the gate's marker is written and a `gate` line logged. Today's merge already refuses a non-ignored pending or failed check at its first read, so the pending and failed cases are a green first read and a re-read that differs (a fake gh answering the second `pr view` otherwise) (F1-4) |"""),
("""| D1 | A gate declaring `covered_by` is skipped by merge when every required forge check at the exact head is complete and green, and merge says so in its output and act | test: `covered_by: "ci"` and a list, all green at the head → the gate's command does not run (a marker file is not written), output names the gate, sha and checks, no `gate` line for it, the merge act's `what` names it |""",
"""| D1 | A gate declaring `covered_by` is skipped by merge when every required forge check at the exact head is complete and green, and merge says so in its output and act | test: `covered_by: "ci"` and a list, all green at the head → the gate's command does not run (a marker file is not written), output names the gate, sha and checks, no `gate` line for it, the merge act's `what` names it. The vehicle is a real (not dry) ticket merge in `test/kit.test.mjs`: a sibling-repo ticket on a `multiFixture`, as `multirepo-landing.test.mjs` merges `console-01-a`, with a fake gh (chores never run gates) (F1-4) |"""),
("""## Edge cases
""", """## Edge cases

- `gh`'s rollup could be cut short on a PR with very many checks. A list stays safe (a cut name is missing); `"ci"` could miss a failing entry. Projects with many checks should use the list form; quality.md says to prefer it (F1-6).
- `show release` lists the gates merge ran from `gate` lines; a covered gate is not among them, since it didn't run here. The act's `what` names it; the view is unchanged (F1-7).
"""),
("""## Out of scope / not defended against

- A forge that reports green for a run it didn't do (ticket notes).""",
"""## Out of scope / not defended against

- A forge that reports green for a run it didn't do (ticket notes).
- Under `"ci"`, a check that never reported at all (a path-filtered workflow that didn't trigger, a check suite not registered yet): `"ci"` can't see an absence; the list form can (F1-1)."""),
("""## Docs

- `governance/quality.md` §2 gets a short paragraph after **Modes** (m-20261115-204545585): `covered_by` is trust in a check at the exact head sha, never at an earlier one, and the gate still runs when a check is missing, failed or pending.""",
"""## Docs

- `governance/quality.md` §2 gets a short paragraph after **Modes** (m-20261115-204545585): `covered_by` is trust in a check at the exact head sha, never at an earlier one, and the gate still runs when a check is missing, failed or pending; the list form is preferred.
- Three lines say merge runs every gate and become false for a covered gate (F1-3): quality.md L24 and L121, and process/supervisor.md L127. Each gets a clause ("except a gate `covered_by` the forge's green checks at that exact head"). Asked as m-20261115-204658302 (supervisor.md into touches; the quality.md grant to cover those two lines)."""),
]
for a, b in R:
    n = s.count(a)
    if n != 1:
        sys.exit(f'matched {n}x: {a[:60]!r}')
    s = s.replace(a, b)
open(f, 'w').write(s)
print('ok')
