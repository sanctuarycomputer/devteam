# Final review, pass 3 (track b)

- Reviewer: final-reviewer-3b (fresh subagent session, claude-opus-5-5; cold confirm)
- Reviewed: 59fcbd329a8b98d0c23d1129d2b1254a8720503e (the fixes since 7f47264: 30165b3, and the timings refresh)

B2-1: confirmed fixed. The test now listens on `outside/s4`, which has one name, so only the symlinked-dir rule keeps it out of `socketsUnder(d/to-outside)`. Mutation: removing `if (fs.lstatSync(dir).isSymbolicLink()) return [];` makes "socketsUnder finds the sockets inside a folder, never through a symlink" fail at run.test.mjs:336 (actual `['…/dtr-test-sock-out-…/s4']`, expected `[]`). Restored, and it passes.

B2-2: confirmed fixed. `socketsUnder` now groups the names it finds by `dev:ino` and accepts an inode when the count of names under the folder equals its `nlink`. Mutations, each caught by the same test and then restored: going back to `nlink === 1` drops `s1` and `a/s1-again`; no filter at all lets `hard-s3` through. The fix doesn't touch the realpath-under-base check or the walk, which never follows a symlink.

Probes, with real tmux 3.3a servers (each `new-session -d 'sleep 50'`, so each ends by itself within 60 s) under a scratch root of mine. A script imports the review worktree's run.mjs (an import, not the entry point), calls `cleanupAfter({ dir }, '/usr/bin/tmux', null)` and checks each server's pid for up to 3 s:

| Case | What socketsUnder returned | Result | Right? |
|---|---|---|---|
| D: the file's own socket with a second name inside the folder (`a/s-again`) | both names | own server killed, folder removed | yes (B2-2 fixed) |
| A: an outside server's socket hard-linked in twice (nlink 3, 2 names inside), plus the folder's own server | only `mine` | outside server alive, own killed | yes (B3 still holds) |
| B: the scratch folder is a symlink to an outside folder that holds a server | `[]` | outside server alive, its socket kept, only the link removed | yes |
| E: the file's own socket with a second name OUTSIDE the folder | `[]` | own server **alive** after its folder is gone | accepted, see below |
| G: an outside-started server whose outside name was unlinked, its only name now in the folder | that name | killed | yes: the folder holds its only name, and the realpath rule names it the folder's |
| H: own socket with a second name reached through a symlinked subfolder that points back inside | both names (the walk reaches the real subfolder) | killed | yes |

On E: from the inode alone, E can't be told apart from A (an outside server hard-linked in). Leaving E alone is the price of never killing A, which is the side that matters on a shared machine. The code comment says this ("all of whose names (hard links) are under dir too"). Pass 2 offered this fix as the one that "fixes D", and E stays out of scope. tmux never hard-links its own socket, so only test code that does it on purpose gets here. The leftover server is then that file's own, and it ends when its session does. Not a new finding.

EPIPE (stopAll, exit 141), looked at adversarially:
- `startFile` adds the entry to `ctx.running` synchronously, and `runPool`'s workers check `ctx.stopping` before each start. So a file started between the failed write and the async `error` event is in stopAll's snapshot and gets cleaned up. No file can start after stopAll has begun.
- A closed pipe during the summary: `runFiles` runs on to the end (the timings get written), then the error event exits 141. That is non-zero, so a closed reader can never turn a run into a pass.
- `say` swallows synchronous throws, and the listener sets `outClosed` for any stdout error. A non-EPIPE error silences output but doesn't stop the run, and the exit code still comes from the results.
- stderr gets written in only two places: stopAll's line, right before `process.exit` in the same tick, and the usage error. So a closed stderr can't crash the run partway through.
- The listener is installed only in `runFiles`. `--list | head` with a closed reader and output larger than the pipe buffer would still raise an unhandled EPIPE. That was already true before this diff, no child is running then, and it's out of scope.
- The new test "an output pipe that closes stops the run and cleans up every running file" passes on every major.

The merge 183961c and 3cf7d3a (test/timings.json) are main's changes and data. I didn't review them beyond that.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

Runs, from the review worktree: `t.sh 22 test/run.test.mjs` 39/39 pass (before and after the mutations); `t.sh 24` 39/39; `t.sh 18` and `t.sh 20` 38 pass, 1 skipped (compile cache, before Node 22.1). Mutations: 3, each restored with `git checkout test/run.mjs`. The worktree is clean at 59fcbd3. The probes ran with `env -i`, PATH `/usr/bin:/bin`, HOME a `mktemp -d`, DEVTEAM_HUB_PORT 4993 and no other DEVTEAM_* set. No dashboard was started. Afterwards: I killed the three tmux servers still alive (A's outside, B's outside, E's own) by pid after checking that their args named my scratch root. No process of mine is left, nothing under `~/.devteam/repos-4320/` mentions my scratch folders, and my scratch folders are removed. One note on the record: my first mutation pass wrote tap files into the session scratchpad, which the track-a reviewer (review-kit-209-59fcbd32-final3) shares. Our files collided (`m1.tap`…`m4.tap`, `base22.tap`). I discarded those results and reran everything from a private folder. The track-a reviewer's copies of those files may have been overwritten.

No Critical or Important issue found, and no new finding.

Verdict: APPROVE 59fcbd329a8b98d0c23d1129d2b1254a8720503e
