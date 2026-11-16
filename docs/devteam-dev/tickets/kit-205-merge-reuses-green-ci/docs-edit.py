#!/usr/bin/env python3
# kit-205 T2 step 3: the covered_by paragraph and the three "merge runs every gate" clauses.
# Run from the worktree root. Each replacement must match exactly once.
import sys
EDITS = {
'docs/devteam/governance/quality.md': [
("`merge` runs every one at the PR head before merging;",
 "`merge` runs every one at the PR head before merging, except a gate `covered_by` the forge's green checks at that exact head (below);"),
("a ticket PR: check-ticket at the exact head, the log rule, every gate in a clean worktree at that head, then",
 "a ticket PR: check-ticket at the exact head, the log rule, every gate in a clean worktree at that head (except one covered_by the forge's green checks there, §2), then"),
("Workers bring the legacy lines they change up to the code rules and leave the rest.\n",
 "Workers bring the legacy lines they change up to the code rules and leave the rest.\n\n"
 "**Covered by the forge.** A gate the forge's CI already runs can say `\"covered_by\": \"ci\"` (every check the forge reports) or `\"covered_by\": [\"<check name>\", …]` (those checks). It is trust in those checks at the exact head sha `merge` is landing, never at an earlier commit: `merge` reads the PR again and skips the gate only when every one of them is complete and green at that sha. When any is missing, failed or pending (or skipped or neutral, the head moved, the PR changes `.github/`, or the forge has no checks), the gate runs as usual. Under `\"ci\"` a check that never reported can't be seen; the list form can, so prefer it, and use it when a PR has many checks. `merge` says which gates it trusted, and its act records them. It is the owner's gate field (gate-change).\n"),
],
'docs/devteam/process/supervisor.md': [
("the log rule, and every gate in the settings in a clean worktree at that head, merges",
 "the log rule, and every gate in the settings in a clean worktree at that head (except a gate `covered_by` the forge's green checks at that exact head, `quality.md` §2), merges"),
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
