# Plan review, pass 2

- Reviewer: plan-reviewer-2 (fresh subagent, claude-opus-5-5)
- Reviewed: cac538dc7a1b5aba4b2bcdfef4a07dc84ebaecb4 (plan.md, the fix for plan-1)

Scope: the diff `1428a37..cac538d -- plan.md` only, against plan-1's F1-F7, with the plan's T1 Interfaces and `docs/devteam/scripts/devteam.mjs` consulted where a fix relies on them.

- F1 (fixed). T2 step 5 now asserts the window is gone with `if has_hub_window; then …; exit 1; fi` and says why `!` would not work under `set -e`. The check can fail now.
- F2 (fixed). The kill poll now has a wall-clock deadline 5 s after the kill (`date +%s%N`) instead of a count of rounds, so slow rounds can no longer stretch the budget. Printing the elapsed time was only an e.g. in plan-1, and leaving it out doesn't weaken the check.
- F3 (fixed). T2 now uses `dx env HUBPID="$HUBPID" bash -c …`. `env` passes HUBPID to the process after dx's container name. REL already reaches it through dx's own `-e REL="$REL"` (T1 Interfaces), so the plan doesn't need a second copy of the exec flags.
- F4 (fixed). Review focus 2 now limits the `| grep -q` check to the new steps. It names the existing smoke step's two uses and leaves them alone.
- F5 (fixed). T1 step 2 now runs shellcheck on box.sh and the IN_BOX text as well as the `run:` bodies, uses a real YAML parser (`ruby -ryaml`), and no longer checks the indentation by eye. The fix also adds a local smoke of the in-box checks against a real `hub --release` on a spare port. That is doable, because `DEVTEAM_HUB_PORT` sets the hub port (devteam.mjs:11701). It runs no test suite, and it is checked against the wrong-REL, unlisted-root and wrong-argv cases, so it cannot pass vacuously.
- F6 (fixed). The failure dump (6) and cleanup (7) are now in T1. T2's step 5 goes after step 4 and before them, and the TL;DR and T2's heading say the same.
- F7 (fixed). The match is now spelled out: `t=$(dx cat "$log")`, then a `while read` loop that compares `${l#*] }` (the text after the first `] `) exactly, and requires `left`. It reads text already captured, with no pipe into `grep -q`. It is a different command from the one plan-1 gave as an example, and just as unambiguous.

New in the diff: a `## Rulings` section (spec approval and the test-run ruling). Neither changes scope. The new F5 local smoke follows the test ruling: it starts one hub process and runs no suite.

No findings.

Verdict: APPROVE cac538dc7a1b5aba4b2bcdfef4a07dc84ebaecb4
