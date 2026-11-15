## Summary

A kit run that isn't a project's own no longer records itself for the machine. On 2026-11-15 a reviewer's probe dashboard in a session's `scratchpad/probe`, run with the real HOME and the default hub port, wrote `~/.devteam/repos-4320/….json`. The owner's Overview then showed a project "probe" (sup=down, inbox 1). This is the same class of leak as kit-201.

- **No record from a scratch or session run.** `registerOnMachine` writes nothing when the root is under `os.tmpdir()` or `$TMPDIR` (by whole path segments), or has a `scratchpad` segment. It also writes nothing for a session's run (`DEVTEAM_TICKET` or `DEVTEAM_FEATURE` set, or `DEVTEAM_ROLE` worker or planner), or with `DEVTEAM_HUB_RECORD=off`. An explicit `DEVTEAM_HUB_PORT` is a fixture with its own hub, and it records as before. A TMPDIR that is `/`, home or an ancestor of home is no temp dir, so a wide TMPDIR can't make real projects strays.
- **The dashboard hand-off.** A dashboard's tick runs `accounts-tick` as the supervisor, with the ticket and feature removed. So a dashboard started in a session passes `DEVTEAM_HUB_RECORD=off` to it, whatever the port. The supervisor's own dashboard still records.
- **Strays ignored and named.** `machineRepos` (and so `machine status|tell|questions|knowledge` and `recover --machine`) skips an existing record whose root is a temp or scratchpad path. Explicit-port runs skip nothing. `machine status` prints one `machine: stray hub record <file> (<why>; ignored, remove it)` line per stray, after the box line. It prints the file name only, never the root it holds, and removes nothing.

## How to verify

`node --test --test-concurrency=2 --test-name-pattern='recorded|hub record|registers with the machine|session.s dashboard' test/machine.test.mjs` (needs tmux; about 30 s)

Every case has a HOME of its own. The no-port cases set `DEVTEAM_IMAGE_HUB=4320`, so nothing binds the box's hub. The cases:
- `accounts-tick` at a temp root, at a scratchpad root, or with `DEVTEAM_HUB_RECORD=off` writes no record. At `<HOME>/code`, it writes one, including with a TMPDIR above HOME and at a `<tmpdir>x` sibling.
- A real dashboard with a worker's or planner's env, or with any one session mark alone, writes no record. A plain one does. The supervisor's own dashboard, at the default port, writes its record, and `recover --machine --dry-run` finds it.
- Hand-written stray records are left out of `recover --machine` and named once each by `machine status`. The real one is still listed.

On main, the first two tests fail at their first record check, and the third fails because recover lists the strays.

Records: `docs/devteam-dev/tickets/kit-237-no-scratch-hub-registration/` (spec, plan, reviews, verification).

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
