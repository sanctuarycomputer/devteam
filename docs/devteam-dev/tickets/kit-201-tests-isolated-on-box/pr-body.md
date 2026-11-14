Kit tests run on a devteam box or inside a worker can no longer reach the real fleet (incident p-20261114-214815998-supervisor: a kit test run from kit-46's worktree wrote ~25 lines into home's live log).

## What changes

- **One env scrub for the tests** (`test/lib/kit.mjs`): at import, every `DEVTEAM_*` but the harness's own knobs (`HARNESS_ENV`: `DEVTEAM_TEST_*`, `FORK`, `FORK_AUDIT`, `G1_RECORD`, `CGROUP`, `MEMINFO`) and `TMUX`/`TMUX_PANE` are deleted, then `DEVTEAM_BOX=off` is set. The per-file denylists in machine, operator-threads, hub-overview and gateway tests go; gateway.test.mjs imports the helper; hub-overview's kit gets a temp `HOME`.
- **`DEVTEAM_BOX=off`** (devteam.mjs, box detection): the kit ignores the box's files (`/opt/devteam/gateway.mjs`, `/etc/devteam/thread-key.pub`) only while `HOME`, by real path, isn't the account's passwd home; anything unresolvable leaves the files on. Box detection is a marked block, loaded in a vm by `boxFns()` and tested in CI.
- **The kit refuses a foreign run folder**: a `DEVTEAM_RUN` whose real path isn't the default run folder's or inside the resolved home (`mainRoot`) dies naming both paths, for every command but `help` and the machine-wide ones.
- **A kit copy that isn't its checkout's own `docs/devteam`** (by the real path of `git rev-parse --show-toplevel`, asked without the caller's `GIT_DIR`) dies before the re-exec instead of taking that checkout's home; `bareProject` asserts each fixture is a repo of its own.

## How to verify

- `docs/devteam-dev/tickets/kit-201-tests-isolated-on-box/verification.md`: a row per done-when, with commands and results.
- The decoy: `env -u DEVTEAM_HOME DEVTEAM_ROLE=worker DEVTEAM_RUN=<decoy> node --test --test-name-pattern 'status says at a glance' test/machine.test.mjs` from the kit's checkout writes the owner rule into `<decoy>/log/owner-2026-11.jsonl` at main, and nothing after this change (it is now a test in machine.test.mjs).
- On a devteam box: operator-threads went from 15 of 16 failing at main to all passing; machine and hub-overview pass.

Not defended: an agent that sets HOME to a temp folder on purpose (and copies the store there) gets the laptop's unsigned behaviour, for operator threads in that copy and for pane answers into the real project's log and pane (P6). Nor a DEVTEAM_RUN set on purpose to some other folder inside home.

Note: `test/lib/ports.mjs:22` still says the gateway test claims no port block; it now claims one through `lib/kit.mjs` (ports.mjs is outside this ticket's touches).

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
