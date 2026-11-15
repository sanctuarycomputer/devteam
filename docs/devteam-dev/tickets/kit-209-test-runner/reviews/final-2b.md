# Final review, pass 2 (track b)

- Reviewer: final-reviewer-2b (fresh subagent session, claude-opus-5-5; cold confirm)
- Reviewed: 7f4726460f568aaf193a9ae9d40d2f70b8e24eb6 (the fixes since 3bc9d6d)

B1: confirmed fixed (a comment fix, as dispositioned). The stopTree comment no longer says "nothing is left stopped" or "No other pid is ever signalled". It now names the case it doesn't defend against: a pid reused between a snapshot and its SIGSTOP is stopped and left stopped, or killed if its recorded parent has exited or ps failed. That matches pass 1's probes 1a, 1b and 1e. The spec's §Watchdog 1 sentence ("a stopped process can't exit, so its pid can't have been reused") still stands; it is true for a pid after its stop lands, and the disposition was to fix the comment only.

B2: confirmed fixed. `isEntry` now resolves both sides. Mutation: reverting it to `=== fileURLToPath(metaUrl)` makes "through a symlink with --preserve-symlinks-main, it still runs" fail (restored, then it passes). Probe of my own: a symlink to the review worktree, `node --preserve-symlinks-main` and `node --preserve-symlinks --preserve-symlinks-main` (the flag on the command line, not through NODE_OPTIONS) on `L/test/run.mjs L/test/fixtures/run/fail.mjs`. Node 18 and 24 both exit 1 and print `failed:`. The new test passes on 18, 20, 22 and 24.

B3: confirmed fixed. The new walk ignores a hard link from outside, a scratch root that is itself a symlink, and a symlink inside the folder. Mutations: removing the nlink check makes the socketsUnder test fail. Removing the lstat check is caught by no test (B2-1). Probe of my own, using real tmux 3.3a servers under a scratch folder of mine (each `new-session -d 'sleep 45'`), calling `cleanupAfter({ dir }, '/usr/bin/tmux', null)` and checking each server's pid for up to 3 s afterwards. Each case ran against both 7f47264 and 3bc9d6d's run.mjs:

| Case | 3bc9d6d | 7f47264 |
|---|---|---|
| A: an outside server's socket hard-linked into the folder | outside server killed (B3) | outside alive; the folder's own server killed |
| B: the folder itself a symlink to an outside folder holding a server | outside server killed (B3) | outside alive, its folder kept |
| C: a symlink to an outside socket, and a symlinked subfolder | outside alive | outside alive |
| D: the folder's own server, socket hard-linked to a second name inside the folder | killed | **alive after the folder is gone** (B2-2) |
| E: the folder's own server, socket hard-linked to a name outside | killed | **alive** (B2-2) |
| F: the folder's own server, its socket unlinked | alive | alive (it was already like this before the fix, out of this diff's scope) |

So yes: the nlink check is a way for a real socket under the scratch folder to escape cleanup, and the tmux server keeps running. The lstat check is not a way, in any case I could build. It only skips a scratch root the test replaced with a symlink, and whatever that symlink points at is outside the folder anyway.

The other fixes in the diff:
- TMUX unset: removing `delete env.TMUX` makes "a file never sees the TMUX of the session that ran the runner" fail (restored).
- Runner-error cleanup: tried on a scratch copy of run.mjs, with a worker that throws `injected` 3 s into a `--concurrency 2` run of hang.mjs and pass.mjs. The runner exited 1 with the stack. hang.mjs's own process, its detached child and its tmux server were all dead by pid, and its scratch folder was gone. A SIGINT that arrives during that cleanup is swallowed (`ctx.stopping` is already set), and the throw still exits 1. That is acceptable.
- `hasTmux` through `realTmux`: right. Under the runner the first tmux on PATH is a shim.
- `DEVTEAM_TEST_CONCURRENCY: undefined`: `nodeEnv` drops undefined keys.
- todo-fails fixture: on every major, the exit code decides the result (a failing todo test still makes the file `ok`).

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| B2-1 | Minor | quality.md §3 (a fix is pinned by a test that fails without it) | test/run.test.mjs:324-332 | The lstat check (B3, the folder itself a symlink) is pinned by no test. Removing `if (fs.lstatSync(dir).isSymbolicLink()) return [];` leaves run.test.mjs passing 38/38 on Node 22. The assertion `socketsUnder(path.join(d, 'to-outside'))` should catch it, but the hard link made a few lines earlier gives `outside/s3` nlink 2, so the nlink check drops s3 and the result is `[]` whichever check runs. Fix: make that assertion before the `linkSync`, or give `outside` a second socket with nlink 1. | fixed |
| B2-2 | Minor | spec §Watchdog 2 ("finds isSocket() entries whose real path is still under the scratch folder; each gets … kill-server"); done-when 6 ("A file ending on its own has its tmux servers killed") | test/run.mjs:231 | `nlink === 1` skips every name of a socket that has more than one name, including the folder's own. A file whose tmux socket gets a second name, inside the folder (probe D) or outside it (probe E), now leaves its server running after its folder is removed. At 3bc9d6d both were killed. tmux never hard-links its socket, so only deliberate test code reaches this, the same class as B3. The code comment says this ("that has no other name"), but the spec's rule and done-when 6 don't. Fix, either way: count the names the walk finds per (dev, ino) and accept a socket when that count equals nlink (fixes D), or follow pass 1's suggestion: ask the server for `#{socket_path}` with `-S s display -p` and kill it when that path is under the folder (fixes D and E, and keeps A safe). | fixed |

Runs: `t.sh 22 test/run.test.mjs` 38/38 pass. `t.sh 18` and `t.sh 20`: 37 pass, 1 skipped (compile cache, before Node 22.1). `t.sh 24`: 38/38 pass. Mutations: 4, each restored with `git checkout test/run.mjs`. The probes ran with HOME a `mktemp -d`, PATH `/usr/bin:/bin`, every DEVTEAM_* unset, DEVTEAM_HUB_PORT 4996/4997, and DEVTEAM_TEST_SHARED_TMP a fresh folder. No dashboard was started. Afterwards: no probe process of mine left (every tmux server had ended or been killed; one `dtr-fixture` node seen in ps started after my last probe, was not mine, and ended by itself), nothing of mine under `~/.devteam/repos-4320/`, scratch folders removed, the review worktree's tracked files unchanged at 7f47264.

No Critical or Important issue found. B2-1 and B2-2 are Minor and don't block.

Verdict: APPROVE 7f4726460f568aaf193a9ae9d40d2f70b8e24eb6
