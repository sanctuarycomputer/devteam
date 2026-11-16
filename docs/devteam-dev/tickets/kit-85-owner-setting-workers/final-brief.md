# kit-85 final review brief

PR sanctuarycomputer/devteam#285, branch `ticket/kit-85-owner-setting-workers`, the branch tip (code and tests as at 514aa91; later commits are records only, CI run 43793564433 green, all 17 jobs). Risk high: two finals, `reviews/final-1.md` and `reviews/final-1b.md`, from different sessions, in quality.md §3's format (a `- Reviewer:` line, a findings table with an empty Disposition column, and a last line `Verdict: APPROVE|CHANGES <full sha>`).

Read: `spec.md`, `plan.md` (its "Rulings and calls (build)" covers #277 and #287), `verification.md`, `pr-body.md` and `reviews/task-*.md`. The diff is `git diff origin/main...HEAD`. Focus:
- an agent on a box making the log say the owner asked for a setting: the route, the CLI and the gateway's `devteam-owner-setting-v1` signature;
- `settings set`'s edit of settings.md;
- the landed rule and the label.

The review cap (m-20261115-214201586) applies. After a second round, Minor findings are fixed and disposed with no further pass. A third pass only confirms a Critical or Important fix.

**Box rules (mandatory):**
- Put any multi-step shell (rm, redirects, nested quotes) in a script file in a private `mktemp -d` scratch dir, never inline. Guard any `rm -rf` to inside that scratch.
- Put `timeout` on every command, and use `set -o pipefail`.
- Never read /dev/zero. Never use `ulimit -v` or `prlimit --as` on node.
- Tests:
  - Run one file at a time: `node --test --test-concurrency=2 test/<file>`. Never the full suite: CI is the gate.
  - Unset every `DEVTEAM_*` variable. Set HOME to a fresh dir in your scratch, because this machine is a box and the kit's tests need a throwaway HOME (`boxFilesOff`). Set `DEVTEAM_HUB_PORT` to a port other than 4320 and 4399.
- Make mutations only in a scratch git worktree, removed after, never in the ticket's worktree.
- Edit no file except your record, and don't commit.
