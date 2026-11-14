# kit-201 spec: kit tests can't reach the real fleet

## Why

Incident p-20261114-214815998-supervisor: at 21:46 a kit test run from kit-46's worktree
(`test/machine.test.mjs`, "status says at a glance…") wrote ~25 lines into home's live log. The
worker's session carried `DEVTEAM_RUN`; `machine.test.mjs` and `operator-threads.test.mjs` strip
`DEVTEAM_ROLE|TICKET|FEATURE` and `DEVTEAM_HOME` but keep `DEVTEAM_RUN`, so the kit under test wrote
into the fleet's run folder. Separately, 15 of 16 `operator-threads` tests fail on a devteam box
because the box's own files (`/opt/devteam/gateway.mjs`, `/etc/devteam/thread-key.pub`) make the kit
under test believe it is on that box, whatever the test's environment says.

## What exists today (cca0976)

- `test/lib/kit.mjs` at import deletes only `DEVTEAM_HOME`, `TMUX`, `TMUX_PANE`, then sets its own
  knobs (`DEVTEAM_CSWAP=off`, `DEVTEAM_SUPERVISOR_UP=off`, `DEVTEAM_CGROUP/MEMINFO ??=`,
  `DEVTEAM_HUB_PORT`, `DEVTEAM_PORT_BASE`, `TMUX_TMPDIR`).
- `machine.test.mjs:14,34`, `operator-threads.test.mjs:19,67,626`, `hub-overview.test.mjs:133` each
  repeat a partial denylist of their own.
- `gateway.test.mjs` does not import `lib/kit.mjs`; it spawns the kit with `process.env` whole.
- A worker on a box also carries `DEVTEAM_PUBLIC_URL` and `DEVTEAM_PREVIEWS`; `DEVTEAM_PUBLIC_URL`
  alone makes `previewBox()`, and so `onBox()`, true (devteam.mjs ~6618, 13004).
- Box detection, devteam.mjs ~13004-13030: `onBox()` = `previewBox()` or the gateway file exists;
  `threadsNeedGateway()` = `onBox()` or the gateway file; `gatewayThreadKey()` reads
  `BOX_THREAD_KEY` whenever either box file exists, else `DEVTEAM_GATEWAY_THREAD_KEY`. The comment
  there is deliberate: the image's file, not only the environment, says box, because an agent can
  change the environment of a command it runs.
- Harness knobs that must survive the scrub (they are read by a process that imports `lib/kit.mjs`
  before its own top level runs): `DEVTEAM_FORK` (kit.test.mjs → lib/fork.mjs), `DEVTEAM_FORK_AUDIT`,
  `DEVTEAM_TEST_*` (KEEP, COLD, GITLEAKS, READ_DELAY_MS), `DEVTEAM_G1_RECORD`, `DEVTEAM_CGROUP`,
  `DEVTEAM_MEMINFO` (test.yml sets the last two).

## Acceptance checks (the done-whens)

1. **One shared scrub.** `test/lib/kit.mjs`, at import, deletes every `DEVTEAM_*` variable except the
   harness knobs above (an explicit list, `HARNESS_ENV`), and `TMUX`, `TMUX_PANE`, before setting its
   own. Every test that spawns the kit gets its env from that scrubbed `process.env`:
   `machine.test.mjs`, `operator-threads.test.mjs` and `hub-overview.test.mjs` drop their own
   `DEVTEAM_*`/`TMUX` denylists (they keep stripping `CLAUDECODE|CLAUDE_*`, which isn't devteam's
   and is outside this ticket), and `gateway.test.mjs` imports `lib/kit.mjs` so its spawns inherit the
   scrub. Check: `grep -n "DEVTEAM_RUN\|'DEVTEAM_HOME'" test/{machine,operator-threads,hub-overview,gateway}.test.mjs`
   finds no denylist; the scrub is the only one.
2. **Proven against a decoy.** A test in `machine.test.mjs` runs the incident's own test ("status says
   at a glance…") in a child `node --test` whose environment carries `DEVTEAM_RUN=<decoy>/run`,
   `DEVTEAM_HOME=<decoy>`, `DEVTEAM_ROLE=worker`, `DEVTEAM_TICKET=<id>`, `DEVTEAM_PUBLIC_URL`, `TMUX`
   and `TMUX_PANE`; the child passes, and the decoy folder holds no file afterwards. A second, quick
   check: a child that imports `lib/kit.mjs` and prints its `DEVTEAM_*` names shows only the harness
   knobs and the kit's own settings.
3. **Box detection can be turned off.** `DEVTEAM_BOX=off` makes the kit ignore the box's files
   (`BOX_GATEWAY_FILE`, `BOX_THREAD_KEY`) in `onBox()`, `threadsNeedGateway()` and
   `gatewayThreadKey()`: box-ness then comes from the environment only (`DEVTEAM_PUBLIC_URL`), and
   the key from `DEVTEAM_GATEWAY_THREAD_KEY`, exactly as on a CI runner. `lib/kit.mjs` sets it.
   Check: the three files' tests pass on this box (where both box files exist) with the session env
   removed, and still pass in CI.
4. **CI and files.** test.yml passes on every job at the PR head; no file is added (the records
   under `docs/devteam-dev/tickets/kit-201-tests-isolated-on-box/` aside).

## The off switch's limit (needs the supervisor's word)

The box files exist so an agent can't make a command it runs believe it is off the box (and so take
an owner's thread press unsigned). A bare `DEVTEAM_BOX=off` would undo that. So the switch is honored
only while `$HOME` is not the account's own home (`os.userInfo().homedir`, from the password file,
not from `$HOME`): every owner record box detection guards (the operator's threads, `operatorDir()`)
lives under `os.homedir()`, so a command that turns the box off can only act on a throwaway home,
never the real operator's store. The tests that need it (`operator-threads`) already set `HOME` to a
temp dir; `hub-overview` will too (its hub registry then lives under its own temp dir, which is more
isolated, not less).

## Approaches considered

- **A. Bare `DEVTEAM_BOX=off`** (the ticket's example). Smallest; reopens the hole the file check
  closed: an agent on a box runs `DEVTEAM_BOX=off devteam.mjs operator-thread …` against the real
  operator store unsigned.
- **B. `DEVTEAM_BOX=off`, honored only off the account's own home** (recommended). One more
  condition; the real store stays guarded.
- **C. Overridable box file paths** (`DEVTEAM_BOX_ROOT=<dir>`). Same weakness as A, and more
  surface (two constants become env-driven).

## Edge cases

- `DEVTEAM_BOX` set to anything but `off`: ignored (box detection as today).
- A forked child (lib/fork.mjs) imports `lib/kit.mjs` again: `DEVTEAM_FORK` survives; its ports are
  reassigned by the child's own import, as today.
- `cli-runner.mjs` replaces its env wholesale per request; it doesn't import `lib/kit.mjs`, so
  per-call env (`{ DEVTEAM_ROLE: 'supervisor' }`) still reaches the kit.
- Tests that set `DEVTEAM_*` after import (`DEVTEAM_CLAIM_TOKEN`, `DEVTEAM_PUBLIC_MAX`,
  `DEVTEAM_GATE_TICKET`) are unaffected: the scrub runs once, at import.
- The nested `node --test` child must not inherit `NODE_TEST_CONTEXT`, or it reports to the parent's
  runner instead of running.

## Contracts

None provided or consumed: `DEVTEAM_BOX` is a new, test-facing env knob of the kit, documented in the
comment beside `onBox()`.

## Out of scope

- The other test files' own env handling beyond what importing the scrub fixes.
- `CLAUDECODE`/`CLAUDE_*` stripping.
- Any change to what a real box does when `DEVTEAM_BOX` is unset.

## Rulings

- m-20261114-215142046-supervisor (to kit-200, carried over by m-20261114-215602684-supervisor):
  touches add `test/lib/kit.mjs` and `test/gateway.test.mjs`; the shared helper is a scrub at import
  in `test/lib/kit.mjs`; keep it small.
- m-20261114-215602684-supervisor: run every kit test with
  `env -u DEVTEAM_RUN -u DEVTEAM_HOME -u DEVTEAM_ROLE -u DEVTEAM_TICKET -u DEVTEAM_FEATURE TMUX_TMPDIR=$(mktemp -d)`;
  this ticket lands before kit-46, kit-63 and kit-142.
