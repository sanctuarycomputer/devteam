# Task 3 review, pass 1

- Reviewer: task-reviewer (fresh subagent, claude-opus)
- Reviewed: 4aefda145e235e363a73894c0891588bad0ae00a

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T3-1 | Minor | spec §6 ("when `DEVTEAM_RUN` is set … dies … before the run folder is read or written") | docs/devteam/scripts/devteam.mjs:473,480 | The guard and `runDir` read an empty `DEVTEAM_RUN` differently. The guard tests truthiness, so `DEVTEAM_RUN=` skips it. `runDir` uses `??`, so `path.resolve('')` makes the run folder the cwd. Probe: from cwd `<app-api>/docs/devteam/run`, `DEVTEAM_RUN= node <app>/…/devteam.mjs observe …` exits 0, and its line lands in app-api's `log/supervisor-2026-11.jsonl`. Nothing in the kit or the tests sets it empty today, and the cwd would have to be another home's run folder, so it doesn't block. Fix: treat `''` as unset in `runDir` (`||`), or guard on `!== undefined`. | fixed: an empty DEVTEAM_RUN is unset; tested from inside the other run folder |
| T3-2 | Suggestion | spec §7 (intent: "can't take that home") | docs/devteam/scripts/devteam.mjs:46 | The nested check only asks whether `<script>/../../../.git` exists. Any `.git` passes, even one that isn't a repo. Probe: a copy at `<home>/fx/bogus/docs/devteam` with an empty `mkdir .git` beside it runs `status` against home (exit 0). This is what the spec says to do, and no test fixture makes a bare `.git`. A stricter check would compare the real path of `git rev-parse --show-toplevel` to the real path of `../../..`. It is already computed on the failure path. | fixed: compares the real path of <top>/docs/devteam/scripts; tested with an empty .git |
| T3-3 | Minor | spec §6 ("Exempt: `help`, … `machine`, `operator-thread`, `recover --machine`") | test/machine.test.mjs:178-179 | Only `machine status` is tested as exempt with a leaked `DEVTEAM_RUN`. Dropping `operator-thread`, `recover --machine` or `help` from the exemption list fails no test: operator-threads and gateway run scrubbed, with no `DEVTEAM_RUN`. I checked them by hand (below), and they are exempt today. | fixed: help and operator-thread list also tested as exempt |
| T3-4 | Minor | spec §6 (Taken: "`observe …` exits 0 and its line is in that run folder's log, `status` exits 0") | test/machine.test.mjs:196-208 | Two of the Taken cases don't run what the spec lists. The worktree case runs only `phase spec` as a worker. It asserts the line, but never runs `status` or `observe`. The `app-ln` case runs `observe` but not `status`. A mutation that refused reads only from a worktree, or only through a symlinked run, would pass. | fixed: the worktree runs phase, status, observe; app-ln runs status |
| T3-5 | Suggestion | spec §7 ("`bareProject` asserts each fixture is a repo of its own") | test/gateway.test.mjs:301 | gateway.test.mjs keeps its own copy of `bareProject`, without the new assertion. Since Task 2 it imports lib/kit.mjs, so it could use the shared one. Its fixtures do `git init`, so nothing is unsafe today. Also, the assertion runs right after `git init` in `r`, so it can only fail if `git init` itself misbehaves. That is what the ruling asked for, so it is noted, not faulted. | wont-fix: gateway's own bareProject still runs git init; outside the spec |

No Critical or Important findings.

## Legitimate setups checked (not broken)

- **Worker or planner in home's worktree.**
  - A worktree inside home (`.worktrees/w1`, where `.git` is a file) passed both checks: `status` exited 0, and `whoami` as a worker with home's `DEVTEAM_RUN` exited 0.
  - A worktree outside home (`../app-wt`) is covered by the new test, which passed.
- **Worker on a repo link with `DEVTEAM_HOME`.** The new test passed: `phase`, `send`, `gate`, merge-request and `whoami` exit 0, and `check-ticket` is never refused. `worker.md:9` says link worktrees live under home's `.worktrees/`. This ticket's own worktree is one of them (it is a worktree of devteam-dev-links/devteam, placed under devteam-dev). Its kit is at its own `../../..`, so the nested check passes. Its `mainRoot` is the kit repo, so home's `DEVTEAM_RUN` is refused. That is the incident, and it is meant.
- **The dashboard and what it spawns.**
  - Worker and planner windows get `DEVTEAM_RUN='${runDir}'` (devteam.mjs:15360), which is always inside home.
  - The dashboard's self-spawns (`dashboard-data`, `hello`, `accounts-tick`, and the spawns at 11752 and 17897) run this kit with `cwd: mainRoot`.
  - The validate at 4342 runs in a detached worktree of home.
  - The machine-wide spawns into other projects (12754, 12823) delete `DEVTEAM_RUN`.
  - `recoverMachine` types `export DEVTEAM_ROLE=supervisor` with no `DEVTEAM_RUN`.
  - One exposure stays: `tmuxServerEnv()` keeps `DEVTEAM_RUN`. A tmux server first started from a session that carries one would hand it to later windows of other projects. Those windows are refused now, where before they wrote silently into the wrong log. That is an improvement, and it is outside this task.
- **Machine-wide commands.** With a foreign `DEVTEAM_RUN`, neither `operator-thread status --json` nor `recover --machine --dry-run` hit the guard. Caution: the `recover --machine` probe ignored my `--in` and listed this account's real projects. It was a dry run, so it wrote nothing.
- **Box.** `cloud/Dockerfile` copies the kit to `/opt/devteam/kit`, where there is no git. `common` is null, so the nested check is skipped.
- **Kit copies in test/.** I checked every `cpSync(kit…)` and every copy of `docs/devteam`:
  - components:96, dashboard:191, lib/kit.mjs:108 and 440, gateway:305, machine:72 (`repo()`), machine:244 (the nested test, on purpose), multirepo-home:55, 72 and 88, browser/dev-links:252, chain:60 and 2142. Each destination is a `git init`'d repo, with the kit at its `docs/devteam`.
  - machine's `kitAt` tags are extracted under the non-git tmp dir and only copied from.
  - The chain forks (chain.mjs:4826) copy the whole fixture, `.git` included.
  - `/data/home/tmp` is in no repo.

## Bypass probes of the run-folder guard

Each probe ran from fixture `app`, aiming at `app-api`'s run folder:

| `DEVTEAM_RUN` | Result |
|---|---|
| trailing slash | refused |
| `<app>/../app-api/…` | refused |
| `//` in the path | refused |
| relative, against the cwd | refused |
| a symlink inside `app` that points to app-api's run | refused |
| a not-yet-made path under that symlink | refused |
| a dangling symlink inside `app` | passes the guard, then crashes with ENOENT on mkdir; nothing written |
| empty string | bypass (T3-1) |

## Runs

Every run went through run-isolated.sh, one file at a time.

In this worktree:

| Run | Result |
|---|---|
| machine, `run folder (outside\|inside)\|repo link\|copied into\|importing the test helper` | 5 pass, 0 fail |
| machine, `incident` (the decoy test, the spec §2 reproduction) | `# pass 1`, `# fail 0`, decoy empty |
| multirepo-home | 5/5 pass |
| components | 7/7 pass |
| dashboard | 31 pass, 14 skip, 0 fail |

## Mutations

Each copy is a `git archive` of 4aefda1 under my scratchpad, made its own repo, with run-isolated.sh at the same relative path. Each ran the four Task 3 tests.

| Copy | Change | Result |
|---|---|---|
| base | none | all 4 pass |
| noguard | the runDir guard never dies | refusal test FAILS ("phase is refused") |
| prefix | `r.startsWith(root)` with no separator | refusal test FAILS: app-api was taken |
| norealpath | lexical paths, no realpath | the "takes inside" test FAILS (symlink cases) |
| nonest | nested check removed | nested test FAILS ("status") |
| nestafter | nested check moved after the re-exec | nested test FAILS ("status") |

Verdict: APPROVE 4aefda145e235e363a73894c0891588bad0ae00a
