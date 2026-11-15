# Plan review, pass 1

- Reviewer: plan-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: badb75e2dff5cd59beec1b07c22f670fa1f37016 (plan.md)

## What I checked

I read the plan against the ticket's done-whens and touches, the approved spec (spec-2 at 909051b and its F2-1..F2-3), quality.md §3 and §6, and worker.md §4. I then checked each step against the code: cloud/Dockerfile (the devteam-dev heredoc, the ENV block, the kit COPY), both workflows, test/machine.test.mjs and test/lib/kit.mjs, and cmdHub, startHub and box-pins in devteam.mjs. I ran the release one-liner under dash and ran `box-pins verify` from the worktree. I ran no tests.

**Coverage.**
- All six done-whens map to a task or to "Then", and so does every spec item.
- F2-2 and F2-3 are taken: the test asserts each wrapper part, verification.md says the wrapper is a superset, the other session is made after `home`, and the no-colon mutation is run.
- Every file is inside `touches`. verification.md is the ticket's own record.
- The TL;DR has seven bullets.

**Things that hold.**
- The fake `timeout` (`shift; exec "$@"`) keeps `timeout 20 tmux …` reaching the fake tmux on PATH. It drops the time limit, which no fake test needs. The real-tmux test uses the real `timeout`.
- `printf "$WINDOWS"` with real newlines from a JS string works, and the fake exits 1 when `WINDOWS` is unset. That covers the gone-server case.
- The real-tmux test can work. kit.mjs deletes `TMUX` and every non-harness `DEVTEAM_*` at import. It points `TMUX_TMPDIR` at a private directory and puts its shim first on PATH. `baseEnv` carries all of that, and the file's server has `default-shell` set to `stubShell`, which handles `-c`, so the swapped pane command (`… PATH=/usr/local/bin:/usr/bin:/bin sleep 600; : --release ''`) runs.
- The deploy-step test is sound. kit.mjs already strips `DEVTEAM_HOME`, `DEVTEAM_RUN` and the rest, so the kit takes no foreign home. The worktree's origin is `sanctuarycomputer/devteam`, so the `box-pins` view is allowed. Run here with the `DEVTEAM_*` variables removed, `box-pins verify --release v0.52.0` printed `ok … release v0.52.0` (exit 0), and `--release v0.0.1` printed `DEVTEAM_RELEASE is v0.52.0, not v0.0.1` (exit 1). There is only one `run: |` block, so taking it by indentation is unambiguous.
- The box-image smoke is sound. `box-pins installed` is machine-wide in the homeAt and DEVTEAM_RUN guards. From cwd `/` as root, with no git repo around, it reads `DEVTEAM_BOX_TOOLS` from the image ENV and runs each tool at `/usr/local/bin`: node:22 puts npm's `claude` there, `UV_TOOL_BIN_DIR` puts uv's tools there, and gh, ttyd and mise are installed there. The existing smoke already runs the kit the same way.
- setup-node is not strictly needed, since the runner ships a Node. It is still right: test.yml pins Node through setup-node@v5 too, and the step now runs the kit.
- The body check is sound. `/instances.json` answers `JSON.stringify({ hub: 1, kit, … })`, which is compact, so `"hub":1[,}]` matches. curl sends no `sec-fetch-site`, so the hub doesn't refuse it.
- `as_dev` keeps the container's env, so devteam-dev sees `DEVTEAM_KIT_RELEASE` and `DEVTEAM_IMAGE_HUB`.
- The order anchors exist in the Dockerfile: `  tmux new-session -d -s home -n operator` (indented), the first `for k in "$HOME"/code/*/docs/devteam/scripts/devteam.mjs; do` at ~469, and a single `  sleep 60`.
- The supervisor's ask holds. With `standalone`, the hub's `actionCwd` is `process.cwd()`, which is `$HOME` (`/data/home`, not a git repo here). The kit is `/opt/devteam/kit`, which has no `.git` and has `project/` and `run/` removed. So no child takes a writer from a `plan/*` or `ticket/*` branch, and the tests assert `-c <HOME>` and the kit path.

**What fails.** Task 1's release check doesn't do what the plan says it does (F1-1 below), and the plan's own test case catches it.

## Findings

| # | Severity | Finding | Disposition |
|---|---|---|---|
| F1-1 | Important | Task 1 Interfaces, the release check (spec-2 F2-1's disposition says "any newline refused"; Global Constraints say "with no newline"). `rel=$(printf '%s\n' "$DEVTEAM_KIT_RELEASE" \| grep -xE 'v[0-9]+\.[0-9]+\.[0-9]+'); [ "$rel" = "$DEVTEAM_KIT_RELEASE" ] \|\| rel=` refuses `v1.2.3` followed by a newline and `x`, but it accepts `v1.2.3` followed by a newline and `v1.2.3`. grep prints both lines, `$( )` strips only trailing newlines, and the two strings are then equal. Run under dash, it printed the two-line value, not empty. Step 1 lists exactly that value (`v1.2.3\nv1.2.3`) as one that must give `--release ''`, so the code as prescribed fails its own test at Step 4. The hub would then get a two-line `--release`. It rejects that and serves with no release, so the impact is small, but the plan's claim and its F2-1 disposition are false. Fix: refuse any byte outside the alphabet as well, e.g. add `case $DEVTEAM_KIT_RELEASE in *[!v0-9.]*) rel= ;; esac` after the comparison (a newline is outside `[v0-9.]`), or use a `case` pattern alone as F2-1's disposition says. || Fixed: a case pattern refuses any character outside [v0-9.] (a newline included) before grep; checked under dash on all six Step 1 values. |
| F1-2 | Minor | Task 1 Interfaces, `hub_wait`: `${DEVTEAM_HUB_WAIT_SECONDS:-15}` goes straight into `$(( … ))`. In dash a malformed arithmetic expression is fatal to a non-interactive shell. `DEVTEAM_HUB_WAIT_SECONDS=15s` gave `arithmetic expression: expecting EOF` and exit 2 here. devteam-dev would die before the dashboards, the minute loop and ttyd, so the terminal would never come up. Only the owner sets the variable (for example in Render's env), so this is unlikely, but the wait is meant to never stop the boot. Fix: `w=${DEVTEAM_HUB_WAIT_SECONDS:-15}; case $w in ''\|*[!0-9]*) w=15 ;; esac`, plus a test case (`abc` waits the default, or is bounded). || Fixed: w falls back to 15 unless all digits; a test with 15s. |
| F1-3 | Minor | Task 1 Step 1, the real-tmux test: "make session `home`" on the file's shared server. Other tests in this file create and kill `=home` (`homeSession`, the `boxRecover` tests, lines ~588-723). A `home` left over from one that failed mid-way makes `new-session -s home` fail with "duplicate session", which reads as a hub bug. Kill `=home` first, as `homeSession()` does, or reuse that helper. Also create `kit49-other` last and assert it was created, so F2-3's precondition (it is the current session) is checked, not assumed. || Fixed: kills =home and =kit49-other first; asserts kit49-other is the newer session. |
| F1-4 | Suggestion | Task 1 Files/Interfaces: the plan says where the bare `hub_window` call, `hub_wait \|\| :` and the minute-loop line go, but not where the `hub_window() {` and `hub_wait() {` definitions go. They must come before the call after the home block (right after `note()` is the natural place). It also says each line starts "exactly so", but the minute-loop line sits inside the loop indented two spaces, so the test should match it with `trim()` or `includes`, as the existing `settle` lookup does. || Fixed: definitions placed just before the bare call; minute-loop line found by trim(). |
| F1-5 | Suggestion | Task 3 Step 1: README "The deploy gate" also says the `box` environment has "no approval step so that every release that changes the image deploys by itself". After this ticket every release deploys, so that clause should change with the others. || Fixed: that README clause is in Task 3 Step 1. |
| F1-6 | Suggestion | quality.md §6: the TL;DR should say "what could go wrong". It names the approach and the tests, but the risks live only in Review Focus. One bullet would fix it, for example: another session's window named `home`, an odd release value, the hub never answering, the tmux server gone, an unstamped tag. || Fixed: the TL;DR's tests bullet names what could go wrong. |

Verdict: CHANGES badb75e2dff5cd59beec1b07c22f670fa1f37016
