# Final review, pass 1

- Reviewer: final-reviewer (fresh subagent, claude-opus)
- Reviewed: 65fd63c45c6bc55015437adf95932683a38f8ff6 (the whole branch)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec acceptance 6 ("Exempt: help, and … `recover --machine`"); quality.md §3 (mutate where a test can't prove it) | devteam.mjs:483; machine.test.mjs "a kit refuses a run folder outside its home" (l.180) | The `recover --machine` exemption from the run-folder guard has no test. Mutation: I deleted `&& !(command === 'recover' && flags.machine)`, and the three run-folder tests still pass. The l.180 loop checks `help`, `machine status` and `operator-thread list`, but never `recover --machine`. The code is right (probe: `recover --machine --dry-run` with a foreign `DEVTEAM_RUN` exits 0). Fix: add `['recover', '--machine', '--dry-run', '--in', <empty dir>]` to that loop. | wont-fix: Minor; the exemption is correct and was checked by hand twice; a test of recover --machine reaches the account's real projects |
| F2 | Minor | spec acceptance 1 (`HARNESS_ENV` names `DEVTEAM_FORK_AUDIT`, `DEVTEAM_G1_RECORD`) | test/lib/kit.mjs:23; machine.test.mjs "importing the test helper…" | The env-names test asserts that only `DEVTEAM_FORK`, `DEVTEAM_TEST_KEEP`, `DEVTEAM_CGROUP` and `DEVTEAM_MEMINFO` survive the scrub. Mutation: I dropped `FORK_AUDIT` and `G1_RECORD` from `HARNESS_ENV`, and the test still passes. Scrubbing them would quietly turn off `DEVTEAM_G1_RECORD=1` re-recording (components.test.mjs:22) and the fork audit (lib/chain.mjs:4856). Fix: seed and assert every listed knob. | wont-fix: Minor; CI and the fork harness would fail loudly if either knob were dropped |
| F3 | Minor | spec acceptance 7 (nested copy can't take home) | devteam.mjs:44-50 | If a kit copy sits inside home beside an invalid `.git` *file* (junk, or a stale gitfile from a removed worktree), git fails. `top` is then null and the check is skipped, as for a kit in no checkout. Run from home's cwd, homeAt falls back to `cwdCommon`, so the copy writes into home's log. Probe: `observe` from `<home>/fx` with `fx/.git` = "nonsense" landed in `<home>/docs/devteam/run/log`. This matches the spec's "a kit in no git checkout skips the check", which the box image relies on, and the case is contrived. The covered cases (no `.git`, empty `.git` folder, vendored copy) are refused. Noted, not blocking. | wont-fix: Minor; a broken .git file reads as no checkout, the rule the box image's kit relies on (spec §7) |

## What I ran (review worktree `.worktrees/review-kit-201-65fd63c4-final` at 65fd63c, every test through `scripts/run-isolated.sh --test-reporter=tap`, one file at a time)

- `test/machine.test.mjs --test-name-pattern='run folder|repo link|copied into|importing the test helper'`: 6 pass, 0 fail, 16 skipped by pattern. That includes the incident's decoy reproduction (unskipped: tmux is present), the refusal, take and repo-link tests, and the nested-copy test.
- `test/operator-threads.test.mjs` whole, on this box (both `/opt/devteam/gateway.mjs` and `/etc/devteam/thread-key.pub` exist): 17 pass, 0 fail, 1 skipped (Chrome).
- `test/hub-overview.test.mjs`: 2 pass, 1 skipped (Chrome). `test/gateway.test.mjs`: 69/69.
- CI at 65fd63c: `test` and `box-image` both completed with success. The PR head has since moved to 1690f6a, which only fills two Disposition cells in reviews/plan-2.md and reviews/spec-2.md, so per §3 this verdict still holds there.
- Touches: the diff touches only the six allowed files plus records under `docs/devteam-dev/tickets/kit-201-tests-isolated-on-box/`. No file was added outside those records.
- Acceptance-1 grep: none of the four test files has a `DEVTEAM_*`/`TMUX` denylist left. speed.test.mjs and components.test.mjs still have theirs, but they are outside the files the spec names.

Probes with the branch's kit on throwaway fixtures, with the session env removed:
- A foreign `DEVTEAM_RUN` dies with exactly the spec's message, and the other run folder is unchanged. So does a symlink inside home pointing at another home's run, and a not-yet-made path under such a symlink.
- Each of these is taken: a relative `DEVTEAM_RUN`, a trailing slash, a symlinked checkout path (also with `--preserve-symlinks-main`), and `rebase --exec` in home.
- `help`, `--help`, no command, and `recover --machine` are never refused.
- A nested copy with no `.git` is refused even with cwd outside home.
- On this box `$HOME`, `os.homedir()` and the passwd home are all `/data/home` (Dockerfile `usermod -d /data/home`). `HOME` unset falls back to passwd, so `DEVTEAM_BOX=off` is ignored at the real home.

I also read the dashboard and machine-wide spawns: `projectKit` and `recover --machine` delete `DEVTEAM_RUN` before running another repo's kit. Tmux windows get home's own `runDir`. The box boot runs `/opt/devteam/kit`, which is in no repo, with machine-wide commands only. `check-pr`'s `validate --strict` runs in a detached worktree of home, so it stays inside home.

Mutations (in the review worktree, reverted after each):
- caught: `boxFilesOff` comparing `HOME` strings instead of real paths (operator-threads box test fails); `lib/kit.mjs` not setting `DEVTEAM_BOX=off` (15 of 18 operator-threads tests fail on this box).
- survived: dropping the `recover --machine` exemption (F1); dropping `FORK_AUDIT` and `G1_RECORD` from `HARNESS_ENV` (F2).
- Not re-run: the guard removed, a prefix check, no real paths, the nested check removed or moved, the `GIT_DIR` scrub removed, and `??` for `||`. reviews/task-3*.md records these; I read the tests that catch each one.

No Critical or Important finding. No way found for the kit to take a foreign `DEVTEAM_RUN` through normal use, for a git-less nested copy to take home, for any legitimate setup listed to be refused, or for `DEVTEAM_BOX=off` to be honored at the account's real home. P6 and R1: the change stops the accidental paths, stays small, and the PR body says in one line what it doesn't defend against.

Verdict: APPROVE 65fd63c45c6bc55015437adf95932683a38f8ff6
