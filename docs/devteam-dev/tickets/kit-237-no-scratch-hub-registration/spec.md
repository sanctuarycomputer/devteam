# kit-237: a scratch or session-run kit never registers with the machine's hub

## Why

o-20261115-080748314: a reviewer subagent of kit-236 ran a kit dashboard in `scratchpad/probe` with the real HOME and the default hub port. Its tick's `registerOnMachine` wrote `~/.devteam/repos-4320/<sha>.json`, and the owner's Overview showed a project "probe" (sup=down, inbox 1). This is the same class of leak as kit-201 (2026-11-14). The record dir feeds `machineRepos` → `machineProjects`, which `machine status|tell|questions|knowledge` (box-status) and `recover --machine` read.

## Acceptance checks (the done-whens)

1. `test/machine.test.mjs` passes in CI. `registerOnMachine` writes nothing to `~/.devteam/repos-<port>` when either holds:
   - the repo root (resolved) is under `os.tmpdir()` or `$TMPDIR`, or has a path segment named `scratchpad`;
   - the run is a session's: `DEVTEAM_TICKET` or `DEVTEAM_FEATURE` set, or `DEVTEAM_ROLE` is `worker` or `planner`.

   Neither applies when `DEVTEAM_HUB_PORT` is set explicitly: a test fixture keeps its own hub and registers as today.
2. Same test. `machineRepos` (and so box-status, `machine tell|questions|knowledge` and `recover --machine`; the hub's own list comes from probing ports, not the records) ignores an existing record whose root is under a temp or scratchpad path. `machine status` says so once, as one `machine: stray hub record <file> (...)` line per such record, naming its file.
3. Same test. A real project root under a home `code` folder still registers as today.

## Design

All in `docs/devteam/scripts/devteam.mjs`, next to `registerOnMachine`:

- `hubPortExplicit()`: `DEVTEAM_HUB_PORT` is set and non-empty.
- `scratchRootWhy(root)`: `'under the temp folder'` when `realPath(root)` equals, or is under by whole path segments, `realPath(os.tmpdir())` or `realPath($TMPDIR)`. So `/tmpfoo` is not under `/tmp`. `'in a scratchpad'` when one of its segments is `scratchpad`. Else null. A temp dir that is `/`, the home folder or an ancestor of it is no temp dir (a TMPDIR set that wide would otherwise make every real project a stray, and recover would skip them all).
- `sessionRun()`: `DEVTEAM_TICKET` or `DEVTEAM_FEATURE` set, or `DEVTEAM_ROLE` ∈ {worker, planner}.
- `registerOnMachine()` returns without writing when `DEVTEAM_HUB_RECORD=off`, or when `!hubPortExplicit() && (sessionRun() || scratchRootWhy(root))`. The off knob always wins: it is an explicit "this run isn't a project's own", even under a fixture's port.
- **The dashboard hand-off.** The dashboard's `accountsTick` deletes `DEVTEAM_TICKET` and `DEVTEAM_FEATURE` and sets `DEVTEAM_ROLE=supervisor` for its `accounts-tick` child. That child is where the tick registers (`noteSupervisorFromTick`). So the dashboard evaluates `sessionRun()` (or its own `DEVTEAM_HUB_RECORD=off`) on its own environment and, when true, passes `DEVTEAM_HUB_RECORD=off` to the child. A session's dashboard therefore doesn't register even at a real root. The dashboard passes it whatever the port: a fixture's session dashboard also stops registering. That is a deliberate narrowing of done-when 1's port exemption, since a fixture never runs with a session's env; the session-dashboard test relies on it.
- `machineRecords()` returns `{ roots, strays }`. Without an explicit port, a record whose root has a `scratchRootWhy` goes into `strays` as `{ file, why }` and not into `roots`. `machineRepos()` is `machineRecords().roots`. `machineStatus` prints one `machine: stray hub record <file> (<why>; ignored, remove it)` line per stray, after the box line, so the box line stays right after the hub line. The file name is a sha1-hex `.json` the kit wrote, so it's printed only if it matches `/^[\w.-]{1,80}$/` (else `?`). The root from the file is never printed (untrusted data).
- Read-only stays read-only: status never deletes the stray (test "each read the operator may run writes nothing").

## Contracts

- Provided: the `DEVTEAM_HUB_RECORD=off` env knob (internal, dashboard → its child; also usable by hand). The new `machine status` line `machine: stray hub record …` is additive.
- Consumed: the `~/.devteam/repos-<port>/*.json` record `{ root, at }`, unchanged.

## Edge cases

- A symlinked temp dir (macOS `/var` → `/private/var`): both sides go through `realPath`.
- `$TMPDIR` unset, or equal to `os.tmpdir()`: duplicates collapse.
- A root equal to the temp dir itself counts as under it.
- A record with a non-string root, or a non-absolute one: ignored as today, not a stray.
- The supervisor's own commands (`writeSupervisorUp`) in a real project, with role supervisor: register as today.
- A fixture with `DEVTEAM_HUB_PORT` set: its records are read whatever their root (its roots are all under the temp dir).

## Out of scope

- The hub's port probing still lists a live dashboard that answers on a block port, wherever it was started. This ticket is the record, which is what outlives the probe and what box-status and recover read. If the supervisor wants a ticket for the live listing, it can file one.
- Deleting stray records automatically.

## Testing

All in `test/machine.test.mjs`. Nothing touches the real HOME or port 4320.

- **Registration, no explicit port** (done-whens 1 and 3). The kit runs `accounts-tick` with `DEVTEAM_CSWAP=off`; it calls `noteSupervisorFromTick` → `registerOnMachine`. Its env: a fresh temp HOME, `DEVTEAM_HUB_PORT` removed (so `repos-4320` lands under that fake HOME), and `TMPDIR` set to a fresh folder under the test's tmp. Cases:
  - a repo under that `TMPDIR` writes nothing;
  - a repo under `<tmp>/x/scratchpad/` writes nothing;
  - a repo under `<fake HOME>/code` with `DEVTEAM_HUB_RECORD=off` writes nothing;
  - the same repo without it writes exactly one record naming its root (done-when 3).

  `accounts-tick` refuses a worker or ticket env outright (it is the supervisor's). So the session env reaches registration only through the dashboard, tested next. A comment beside the tests says so: `sessionRun()` inside `registerOnMachine` is a guard for future callers, covered through the dashboard path.
- **Session dashboard** (done-when 1, the env half). A real dashboard on the test's own hub port, with `DEVTEAM_IMAGE_HUB` set to that port so it binds no hub, `DEVTEAM_ACCOUNTS_MS=200` and cswap off. Started with `DEVTEAM_ROLE=worker` and `DEVTEAM_TICKET`, its ticks write `run/accounts.json` and no record for its root. Started without them (control), the record appears. A planner env (`DEVTEAM_FEATURE`, role planner) is the same as worker.
- **Ignoring and saying so** (done-when 2). With no explicit port, fake HOME and the test `TMPDIR`, records are written by hand: one rooted under `TMPDIR`, one under a `scratchpad` segment, one real. Then:
  - `recover --machine --dry-run` names only the real one;
  - `machine status --in <empty>` prints one `machine: stray hub record <file>` line per stray, each once, and no line for the real one. Its hub line asks `127.0.0.1:4320/instances.json`, a read-only GET that every `machine status` makes, and the test accepts whatever it says.
- The existing fixture tests (explicit port, temp roots: machine.test's "tell and status find a project the machine recorded", recovery's `recover --machine`) keep passing unchanged. They are the explicit-port exemption.

## Rulings and context

- m-20261115-082335469-supervisor (info): any kit run outside the tests uses its own HOME, a `DEVTEAM_HUB_PORT` away from 4320, its own port and `DEVTEAM_*` unset; check `~/.devteam/repos-4320/` afterwards. Only touched test files, at `--test-concurrency=2`.
