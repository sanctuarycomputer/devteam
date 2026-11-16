#!/usr/bin/env python3
# kit-205: final-1 F1 (forgeCheckFails' comment back above it) and final-1b F1 (quality.md: a list
# should name CI jobs, since a commit status can be posted by anyone with push access).
# Run from the worktree root. Each replacement must match exactly once.
import sys
C = ("// The forge's own checks on a PR at its head: pending is not passed and failing fails; the names in\n"
     "// ignored are skipped. what names the PR in the message (the records PR in home, say).\n")
EDITS = {
'docs/devteam/scripts/devteam.mjs': [
(C + "// One entry of gh's statusCheckRollup", "// One entry of gh's statusCheckRollup"),
("function forgeCheckFails(pr, ignoredChecks, sha", C + "function forgeCheckFails(pr, ignoredChecks, sha"),
],
'docs/devteam/governance/quality.md': [
("Under `\"ci\"` a check that never reported can't be seen; the list form can, so prefer it, and use it when a PR has many checks.",
 "Under `\"ci\"` a check that never reported can't be seen; the list form can, so prefer it, and use it when a PR has many checks. In the list, name CI jobs (check runs): a commit status of the same name can be posted by anyone with push access."),
],
}
for f, edits in EDITS.items():
    s = open(f).read()
    for a, b in edits:
        n = s.count(a)
        if n != 1:
            sys.exit(f'{f}: matched {n}x: {a[:60]!r}')
        s = s.replace(a, b)
    open(f, 'w').write(s)
print('ok')
