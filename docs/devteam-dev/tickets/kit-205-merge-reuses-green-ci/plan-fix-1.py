#!/usr/bin/env python3
# One-off: carry spec-1's findings into plan.md. Each replacement must match exactly once.
import sys, os
d = os.path.dirname(os.path.abspath(__file__))
f = os.path.join(d, 'plan.md')
s = open(f).read()
R = [
("""merge re-reads the PR once (`gh pr view --json headRefOid,statusCheckRollup`); a failed read, a moved head or forge `git` covers nothing.""",
 """merge re-reads the PR once, by number (`gh pr view <n> --json headRefOid,statusCheckRollup`); a failed read, a moved head, a PR that changes `.github/` or forge `git` covers nothing. Under `"ci"` every check must be SUCCESS (a skipped one is not coverage)."""),
("""  - `'ci'`: not covered if `rollup` is empty (`the forge reports no checks`); if any entry (ignored ones included) has a state outside `SUCCESS|NEUTRAL|SKIPPED` (`<name> is <state lowercased or "pending">`); if none is `SUCCESS` (`no check ran green`). Else covered, `checks` = names of the SUCCESS entries.""",
 """  - `'ci'`: not covered if `rollup` is empty (`the forge reports no checks`); if any entry (ignored ones included) is not `SUCCESS` (`<name> is <state lowercased>`, `pending` for an incomplete one). Else covered, `checks` = every entry's name, in rollup order, without repeats."""),
("""    3. `merge covered_by: a pending, failed, missing, neutral or skipped-only check, or an ignored one failing, runs the gate as today`""",
 """    3. `merge covered_by: a pending, failed, missing, neutral or skipped check, or an ignored one failing, runs the gate as today`"""),
("""(`'ci'`, `[skipped('test')]`, same, `/no check ran green/`);""",
 """(`'ci'`, `[run('lint'), skipped('test')]`, same, `/test is skipped/`);"""),
("""    4. `merge covered_by: the head moved since merge read the PR, so the gate runs`""",
 """    3b. `merge covered_by: a PR that changes the forge's CI configuration runs the gate` — the ticket also changes `.github/workflows/test.yml` (its touches include `.github/**`); green views; `ran()` true; output `/changes the forge's CI configuration \\(\\.github\\/workflows\\/test\\.yml\\)/`.
    4. `merge covered_by: the head moved since merge read the PR, so the gate runs`"""),
("""fake gh's log has exactly one `pr view` (no re-read when no gate declares it).""",
 """fake gh's log has exactly one `pr view` (no re-read when no gate declares it). In test 1, the log's second `pr view` names the PR's number (`pr view 7 --json headRefOid,statusCheckRollup`)."""),
("""  - In the gate block, after `applies` and `skipped`: `const declared = gates.filter(applies).filter(([, s]) => isObj(s) && s.covered_by !== undefined)`. If non-empty: when `viaGit`, `fresh = { why: 'forge is git: no checks to read' }`; else `const v = R.gh(['pr', 'view', branch, '--json', 'headRefOid,statusCheckRollup'])`, parsed in a try;""",
 """  - In the gate block, after `applies` and `skipped`: `const declared = gates.filter(applies).filter(([, s]) => isObj(s) && s.covered_by !== undefined)`. If non-empty: when `viaGit`, `fresh = { why: 'forge is git: no checks to read' }`; else when `changed` (the PR's files from the merge base, already computed for `paths`) is null or has a file starting `.github/`, `fresh = { why: `the PR changes the forge's CI configuration (${first three, …})` }` (null: `cannot tell what the PR changes`); else `const v = R.gh(['pr', 'view', String(pr.number), '--json', 'headRefOid,statusCheckRollup'])`, parsed in a try;"""),
("""  - `rollupState` and `forgeCoverage` as above, beside `cmdMerge`, with a comment that an unknown state is never coverage.""",
 """  - `rollupState` and `forgeCoverage` as above, beside `cmdMerge`, with a comment that an unknown state is never coverage, and that `.github/` is excluded because a `pull_request` workflow runs the PR's own workflow files."""),
("""- [ ] **Step 3: docs:** one paragraph after Modes:""",
 """- [ ] **Step 3a: the three lines that say merge runs every gate** (spec Docs, F1-3), if m-20261115-204658302 is granted: quality.md L24 (`merge` runs every one at the PR head) and L121 (the `merge <ticket-id>` row), and supervisor.md L127 (Merging), each get the clause "except a gate `covered_by` the forge's green checks at that exact head (quality.md §2)". If supervisor.md is not granted, only quality.md's two.
- [ ] **Step 3: docs:** one paragraph after Modes:"""),
("""When any is missing, failed or pending (or skipped, the head moved, or the forge has no checks), the gate runs as usual.""",
 """When any is missing, failed or pending (or skipped or neutral, the head moved, the PR changes `.github/`, or the forge has no checks), the gate runs as usual. Under `"ci"` a check that never reported can't be seen; the list form can, so prefer it, and use it when a PR has many checks."""),
("""- Files outside this folder: `docs/devteam/scripts/devteam.mjs`, `test/kit.test.mjs` and `docs/devteam/governance/quality.md` (the covered_by paragraph only).""",
 """- Files outside this folder: `docs/devteam/scripts/devteam.mjs`, `test/kit.test.mjs` and `docs/devteam/governance/quality.md` (the covered_by paragraph only), and `docs/devteam/process/supervisor.md` L127 if m-20261115-204658302 is granted."""),
]
for a, b in R:
    n = s.count(a)
    if n != 1:
        sys.exit(f'matched {n}x: {a[:70]!r}')
    s = s.replace(a, b)
open(f, 'w').write(s)
print('ok')
