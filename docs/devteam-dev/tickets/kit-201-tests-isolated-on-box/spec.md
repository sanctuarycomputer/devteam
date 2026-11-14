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
   own. `HARNESS_ENV` names `DEVTEAM_FORK`, `DEVTEAM_FORK_AUDIT`, `DEVTEAM_G1_RECORD`,
   `DEVTEAM_CGROUP`, `DEVTEAM_MEMINFO` and the prefix `DEVTEAM_TEST_` (the suite's own switches:
   KEEP, COLD, GITLEAKS, READ_DELAY_MS today, and any it adds). Every test that spawns the kit gets its env from that scrubbed `process.env`:
   `machine.test.mjs` (l.14's regex keeps only `CLAUDECODE|CLAUDE_*`, which isn't devteam's and is
   outside this ticket; l.34's loop goes), `operator-threads.test.mjs` (l.19 likewise; l.67 and
   l.626 go), `hub-overview.test.mjs` (l.133 goes) and `gateway.test.mjs` (its loops at l.723 and
   l.764 go) drop their own `DEVTEAM_*`/`TMUX` denylists, and `gateway.test.mjs` imports
   `lib/kit.mjs` so its spawns inherit the scrub. Check:
   `grep -nE "DEVTEAM_(ROLE|TICKET|FEATURE|RUN|HOME|SUPERVISOR|PUBLIC_URL)'?[],|)]|delete [a-zA-Z.]*\[k\]" test/{machine,operator-threads,hub-overview,gateway}.test.mjs`
   finds no denylist; the scrub is the only one.
2. **Proven against a decoy.** A test in `machine.test.mjs` runs exactly the supervisor's
   reproduction (m-20261114-224904663): from the kit's checkout, `DEVTEAM_HOME` unset,
   `DEVTEAM_ROLE=worker`, `DEVTEAM_RUN=<decoy>`, `node --test --test-name-pattern 'status says at a
   glance' test/machine.test.mjs` (with `--test-reporter=tap`, so its summary can be read). At main
   that writes the owner rule into `<decoy>/log/owner-2026-11.jsonl`; after this change the decoy
   is empty. The child's own TAP says the incident's test ran, unskipped, and passed (`# pass 1`,
   `# fail 0`; a skipped test, or a name pattern matching nothing, fails the proof). The test skips,
   as the incident's does, where there is no tmux. The pre-fix failing run is recorded in
   `reviews/task-2.md`. The other session variables (`DEVTEAM_HOME`, `DEVTEAM_TICKET`,
   `DEVTEAM_PUBLIC_URL`, `TMUX`, `TMUX_PANE`, …) are covered by the env-names test. A second, quick
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

6. **The kit refuses a foreign run folder** (scope change, m-20261114-222834445-supervisor; the
   ticket's new done-when 3). `runDir` (devteam.mjs ~463) takes `DEVTEAM_RUN` from any cwd; that is
   how a fixture repo's kit, with a worker's `DEVTEAM_RUN`, wrote owner-credited lines into home's
   log. Now, when `DEVTEAM_RUN` is set, it is taken only if its real path (the nearest existing
   ancestor's real path, re-joined with the rest, when the folder isn't made yet) is either the real
   path of the default run folder (`<mainRoot>/docs/devteam/run`, which may itself be a symlink out
   of the checkout) or `realPath(mainRoot)` or under it, separator-bounded (`<root>-api` is not under
   `<root>`). Otherwise the command dies (the message names `DEVTEAM_RUN` resolved as given, and
   `mainRoot` as git reports it), after home is resolved and before the run folder is
   read or written, with: `DEVTEAM_RUN=<run> is not inside this kit's home (<mainRoot>): a session's
   run folder leaked into another repo's kit; unset DEVTEAM_RUN, or run home's kit from home`.
   An empty `DEVTEAM_RUN` is the same as unset (task-3 T3-1). Exempt: `help`, and the machine-wide commands homeAt already exempts (`machine`,
   `operator-thread`, `recover --machine`), which run from anywhere and keep their records outside
   any run folder. Every other command is checked, not only the writing ones: one rule a reader
   can't get wrong, and a read of another fleet's log misleads as much as a write does (my call,
   reported to the supervisor; it covers the ticket's "log-writing"). Within home nothing changes:
   a worker or planner in home's worktree, a worker in a linked repo's checkout with `DEVTEAM_HOME`,
   the dashboard, home's own spawns (they carry `DEVTEAM_RUN=<mainRoot>/docs/devteam/run`), and an
   unset `DEVTEAM_RUN`.
   Tests (machine.test.mjs), on `bareProject` fixtures `app` (the kit run) and `app-api` (standing
   in for home; a prefix check would wrongly pass it), each run folder seeded by one `observe` run
   with no `DEVTEAM_RUN` (`status` writes nothing): refused, from `app` with `DEVTEAM_RUN=<app-api>/docs/devteam/run`:
   `phase spec` (as a worker), `observe …`, `status` and `log` each exit non-zero with stderr holding
   exactly `DEVTEAM_RUN=<app-api>/docs/devteam/run is not inside this kit's home (<app>): `, and `app-api`'s run folder is byte-for-byte unchanged. Taken: `DEVTEAM_RUN`
   as `app`'s own run folder, a symlink to it, a not-yet-made folder inside `app`, and unset, from
   `app`; from a `git worktree` of `app` with `app`'s run folder (a worker in home's worktree); from
   a third repo's checkout with `DEVTEAM_HOME=<app>` and `app`'s kit by absolute path (a worker in a
   linked repo); and a fresh fixture `app-ln` whose `docs/devteam/run` is a symlink to a folder
   outside it: `observe …` exits 0 and its line is in that run folder's log, `status` exits 0.
   **Must not break** (m-20261114-224640331-supervisor): a worker on a repo link, cwd in the link
   repo's worktree, `DEVTEAM_HOME=<home>`, `DEVTEAM_RUN=<home>/docs/devteam/run` (as kit-46 and this
   ticket's worker run today) keeps every command it uses: `phase`, `send`, `gate`, `send … --kind
   merge-request` exit 0 with their lines (phase, gate, both sends) in home's run, and
   `check-ticket` is never refused by the guard (it may fail on the ticket's own merits). The link
   repo is a real one: home's settings.md names it (`links.linked`, kind repo, its remote and path),
   so the commands take a link worker's code paths.
   Not defended (P6): a `DEVTEAM_RUN` that names, on purpose, a folder inside the kit's home other
   than its run folder.

7. **A kit nested in a home without a repo of its own can't take that home** (m-20261114-224904663).
   A kit copied into a folder inside home's checkout that has no `.git` of its own (a fixture made
   without `git init`) resolves home's git, so it would run against home's project and live log.
   The check runs first, in the block that re-execs the main checkout's kit (devteam.mjs ~34), so a
   copy that differs from home's kit can't hand the command to home's own kit either: when the
   script's folder is in a git checkout whose top level is `<top>` (from the same `git rev-parse`
   call that block already makes, `--show-toplevel` added, run without the caller's `GIT_DIR`,
   `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_INDEX_FILE`, which git sets for hooks and `rebase --exec`;
   a worktree's kit run with `GIT_DIR` set is tested) and the real path of
   `<top>/docs/devteam/scripts` isn't the script's folder (a copy at `<home>/vendor/kit`, one at
   `<home>/fixtures/plain/docs/devteam`, one beside an empty `.git` folder), every command but `help` dies (a kit in no git checkout,
   as a box image's `/opt/devteam/kit`, skips the check):
   `this kit (<script>) is not its checkout's own (<top level>/docs/devteam): a copy inside another
   repo can't run against that repo's home; give the copy a repo of its own (git init)`. And
   `bareProject` asserts each fixture is a repo of its own (its top level is itself). Tests: a copy
   of the kit under `<home>/fixtures/plain/docs/devteam`, no `git init`: `status` and `observe` die
   with that message, again after the copy is changed so it differs from home's kit, and again for a
   copy at `<home>/vendor/kit` and beside an empty `.git` folder; home's run folder is unchanged; `bareProject`'s fixtures pass the new assertion (every test that uses it).

## The off switch's limit (ruled: B, d-20261114-215844973-supervisor)

The box files exist so that normal use of a command on a box can't take an owner's press unsigned
(an owner thread turn, `operator-thread …`; a pane answer, `/api/pane-answer` and `pane answered`,
devteam.mjs ~14548, ~14807). A bare `DEVTEAM_BOX=off` that leaked from a test's env into a command
run at the account's own home would undo that by accident. So the switch is honored only while
`$HOME` is not the account's own home: both `$HOME` and `os.userInfo().homedir` (from the password
file, not from `$HOME`) are compared by real path (`fs.realpathSync`), so a `HOME` that is the home
with a trailing slash or a symlink to it counts as the home. When either can't be resolved
(`os.userInfo()` throws for a uid with no passwd entry, or `HOME` names nothing), the switch is
ignored: box detection works as today (fails closed). The tests that need it (`operator-threads`,
gateway's box tests) already set `HOME` to a temp dir; `hub-overview` will too (its hub registry
then lives under its own temp dir, more isolated, not less).

Per P6 (agents are trusted not to forge), this stops the accidental path and no more. What it
doesn't defend against, in one line in the PR body (the ruling asks for it): an agent that sets
`HOME` to a temp folder on purpose (and copies the store there) gets the laptop's unsigned behaviour,
for the operator threads in that copy and for pane answers into the real project's log and pane.

5. **The limit is tested** (the ruling's added done-when). The box-detection code is marked as a block
   in devteam.mjs (`/* box start */ … /* box end */`, beside `previewBox()`'s use), and
   `test/lib/kit.mjs` loads it in a vm with a stand-in `fs` (the box files exist or not), `os`
   (`homedir()` from the test's `HOME`, `userInfo().homedir` the passwd home) and `process.env`, as
   `coverageFns()`/`gitReadFns()` already load theirs. A test in `operator-threads.test.mjs` checks,
   on a box-shaped fixture (both box files exist): with `HOME` equal to the passwd home,
   `DEVTEAM_BOX=off` is ignored and `onBox()`, `threadsNeedGateway()` stay true and
   `gatewayThreadKey()` reads the box's key; with `HOME` a symlink to it, the same; with `HOME` a
   temp folder, all three follow the environment; with `DEVTEAM_BOX` unset or `on`, the files win.
   It runs in CI, where no box file exists, because the files are the stand-in's.

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

- `gateway.test.mjs` importing `lib/kit.mjs` takes its side effects too: it claims one port block
  (the gateway's own servers still pick ports outside 20000..32699; the comments in ports.mjs and
  gateway.test.mjs that say it claims none are updated, ports.mjs's only if it is put in touches,
  else left and noted), it puts the tmux shim first on PATH (the real-hub test's `TMUX_TMPDIR`
  names a folder with no server, so its tmux was already refused or serverless; with the shim it is
  refused outright, which is what that test wants: nothing typed into), and it sets
  `DEVTEAM_CSWAP=off`, `DEVTEAM_SUPERVISOR_UP=off`, `DEVTEAM_BOX=off` (all safer for a test).
  Its own `DEVTEAM_HUB_PORT`/`PORT_BASE` settings run after the import and win.

## Contracts

None provided or consumed: `DEVTEAM_BOX` is a new, test-facing env knob of the kit, documented in the
comment beside `onBox()`.

## Out of scope

- The other test files' own env handling beyond what importing the scrub fixes.
- `CLAUDECODE`/`CLAUDE_*` stripping.
- Any change to what a real box does when `DEVTEAM_BOX` is unset.

## Rulings

- m-20261114-224640331-supervisor: guarding every command but help and the machine-wide ones is
  fine. Must not break, with a test: a worker on a repo link keeps phase, send, check-ticket, gate,
  merge-request (acceptance 6).
- m-20261114-224904663-supervisor: the decoy test is exactly the reproduction (acceptance 2), and it
  writes nothing after the change. Also: a fixture with no .git of its own, nested under a home,
  can't resolve that home; tests create fixtures with git init, so assert they do (acceptance 7).
- m-20261114-222834445-supervisor: scope change, new done-when 3: the kit refuses a DEVTEAM_RUN not
  inside the resolved home (mainRoot, realpath) for log-writing commands, dying with both paths;
  inside home unchanged; test both; update spec and plan with a short review pass, then build.

- d-20261114-215844973-supervisor (m-20261114-215845202-supervisor, re m-20261114-215838230): rule B,
  the switch honored only off the account's own home. Add a test that on a box-shaped fixture with
  HOME equal to the passwd home, DEVTEAM_BOX=off is ignored and onBox() stays true. The PR body says
  in one line what it doesn't defend against (an agent that sets HOME to a temp folder and copies the
  store there).

- m-20261114-215142046-supervisor (to kit-200, carried over by m-20261114-215602684-supervisor):
  touches add `test/lib/kit.mjs` and `test/gateway.test.mjs`; the shared helper is a scrub at import
  in `test/lib/kit.mjs`; keep it small.
- m-20261114-215602684-supervisor: run every kit test with
  `env -u DEVTEAM_RUN -u DEVTEAM_HOME -u DEVTEAM_ROLE -u DEVTEAM_TICKET -u DEVTEAM_FEATURE TMUX_TMPDIR=$(mktemp -d)`;
  this ticket lands before kit-46, kit-63 and kit-142.
