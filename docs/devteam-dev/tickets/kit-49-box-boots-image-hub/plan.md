# kit-49 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## TL;DR

- T1: `cloud/Dockerfile` gets `ENV DEVTEAM_IMAGE_HUB=4320`, two one-line helpers in `devteam-dev` (`hub_window`, `hub_wait`), a call to `hub_window` right after the `home` session block, a `hub_wait` right before the dashboard loop, and one minute-loop line; `test/machine.test.mjs` pulls those lines and runs them against fake `tmux`/`curl`/`timeout`, plus one real-tmux case for the `=home:` target.
- T2: `box-deploy.yml` runs `box-pins verify --release "$TAG"` before it reads `HOOK` (with setup-node), inputs become `(cloud docs/devteam)`; `box-image.yml`'s smoke runs `box-pins installed` and checks `DEVTEAM_IMAGE_HUB`; a test runs the deploy step's shell from the workflow file.
- T3: README ("The deploy gate", the operator paragraph) and `operator.md` (Checking in).
- Then verification.md (deploy step by hand on a matching and mismatched tag, BOXHUB-S3 end to end), PR, two final reviews.
- Tests: only `test/machine.test.mjs`, alone, `--test-concurrency=2` (m-20261115-030118730-supervisor); CI is the gate.
- The hub runs from `/opt/devteam/kit` with cwd `$HOME`: neither is a `plan/*` or `ticket/*` checkout (supervisor's ask, kit-46 final-1 F1).
- No file added besides this ticket's records.

**Goal:** the box starts the image's hub before any dashboard, keeps it up, and deploys every release whose Dockerfile stamp is its tag.

**Architecture:** POSIX `sh` in the Dockerfile's `devteam-dev` heredoc; helpers kept on single lines so tests pull them by prefix, as the file's existing boot tests do. Workflows are bash steps.

**Tech Stack:** sh, tmux, curl, GitHub Actions, node:test.

**Spec:** `docs/devteam-dev/tickets/kit-49-box-boots-image-hub/spec.md` (approved by spec-2 at 909051b; its F2-1..F2-3 are taken here).

## Global Constraints

- The window command, exactly: `while :; do /usr/bin/env -u NODE_OPTIONS -u NODE_PATH -u NODE_REPL_EXTERNAL_MODULE -u DEVTEAM_HOME -u DEVTEAM_RUN -u DEVTEAM_PROJECT -u DEVTEAM_HUB_PORT PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/node /opt/devteam/kit/scripts/devteam.mjs hub --release '<rel>'; sleep 1; done`, window `hub`, cwd `$HOME`.
- `<rel>` is `$DEVTEAM_KIT_RELEASE` only when the whole value is `v<digits>.<digits>.<digits>` with no newline; else empty.
- Wait: `${DEVTEAM_HUB_WAIT_SECONDS:-15}` s, port `$DEVTEAM_IMAGE_HUB`, body has `"hub":1` then `,` or `}`; on timeout the note is `hub: nothing answered hub 1 on 127.0.0.1:$DEVTEAM_IMAGE_HUB after ${w}s; going on (see ~/.devteam/hub-$DEVTEAM_IMAGE_HUB.log)`.
- Where the hub runs from (m-20261115-030942124-supervisor; kit-46 final-1 F1): the kit is `/opt/devteam/kit` (no repo: the image copies `docs/devteam` and removes `project/` and `run/`), the cwd is `$HOME` (`/data/home`, never a checkout; repos are under `~/code`). So neither is a checkout on a `plan/*` or `ticket/*` branch, and the hub's children take no writer from a branch. The tests assert the `-c "$HOME"` and the kit path.
- tmux targets: `has-session -t =home`, `list-windows -t =home`, `new-window -t '=home:'`; each tmux call under `timeout 20`.
- Refusal text in box-deploy: `refusing $TAG: cloud/Dockerfile isn't stamped and pinned for it; run box-pins bump --release $TAG in a release-prep PR, merge it, and publish the release again`.
- Test runs: `node --test --test-concurrency=2 --test-timeout=600000 test/machine.test.mjs` (or `--test-name-pattern` on it), never the full suite.

## Review Focus

1. Another session holding a window named `home` (tmux's target resolution): `new-window` must still make `home:hub` — T1's real-tmux test, made with that session newer than `home`, and a no-colon mutation that must fail it.
2. A release value with a newline or suffix (`v0.52.0-rc1`, `v1.2.3\nx`): passed as `''` — T1 test.
3. The hub not listening at all (curl refused at once): the wait sleeps between tries and ends on time — T1 test bounds elapsed under 5 s and counts curl calls ≤ 3 at 1 s.
4. tmux server gone entirely in the minute loop: `hub_window` makes a new `home` session with the hub — T1 test (has-session fails → new-session).
5. A mismatched tag on a run without the secret: still refused (verify runs before the HOOK check) — T2 test.

---

### Task 1: the boot starts and keeps the image's hub

**Files:**
- Modify: `cloud/Dockerfile` (the ENV block at the end; `devteam-dev` heredoc: after the `home` session `fi` ~line 391, before `for k in "$HOME"/code/*/docs/devteam/scripts/devteam.mjs` ~469, the minute loop ~497; the comment above `COPY docs/devteam /opt/devteam/kit` ~146)
- Test: `test/machine.test.mjs` (new tests after "the box's boot forgets every repo's noted pane and its mark", ~line 790)

**Interfaces:**
- Produces, in `devteam-dev`, each on one line starting exactly so (tests find them by prefix):
  - `hub_window() {` … `}`: computes `rel` and the command, then `if timeout 20 tmux has-session -t =home 2>/dev/null; then timeout 20 tmux new-window -d -t '=home:' -n hub -c "$HOME" "$c"; else timeout 20 tmux new-session -d -s home -n hub -c "$HOME" "$c"; fi`.
  - `hub_wait() {` … `}`: deadline loop; `curl -fsS --max-time 1 "http://127.0.0.1:$DEVTEAM_IMAGE_HUB/instances.json" 2>/dev/null | grep -q '"hub":1[,}]'` → return 0; else `sleep 1`; at the deadline `note …` and return 1.
  - the call `hub_window` alone on a line after the home block; `hub_wait || :` alone on a line before the dashboard `for`.
  - minute loop, first line after `sleep 60`: `timeout 20 tmux list-windows -t =home -F '#{window_name}' 2>/dev/null | grep -qx hub || hub_window`.
  - `ENV DEVTEAM_IMAGE_HUB=4320` (its own ENV line beside the image's other ENV at the end, with a comment: it comes with the boot that starts the hub).
- Release check (F2-1), inside `hub_window`: `rel=$(printf '%s\n' "$DEVTEAM_KIT_RELEASE" | grep -xE 'v[0-9]+\.[0-9]+\.[0-9]+')`, then `[ "$rel" = "$DEVTEAM_KIT_RELEASE" ] || rel=` (a value with a newline whose one line matches is not equal to the whole value, so it is refused).

- [ ] **Step 1: Write the failing tests** in `test/machine.test.mjs`, sharing one helper `bootHub(env)` that: reads the Dockerfile; finds the lines starting `note() {`, `hub_window() {`, `hub_wait() {`, and the minute-loop line (starts `timeout 20 tmux list-windows -t =home`); writes a fake bin (`tmux` appends `"$*"` to `$CALLS` and answers `has-session` with `$HAS_HOME` exit, `list-windows` with `printf "$WINDOWS"`; `curl` appends to `$CURLS` and prints `$BODY` with exit 0 if `$BODY` set, else exits 7; `timeout` does `shift; exec "$@"`); runs `sh -c` with those lines plus a body under `HOME=<tmp>`, PATH fake-first.
  - `the box's boot starts the image's hub in home:hub, from the image's kit, with nothing from tmux's environment`: with `HAS_HOME=0`, `DEVTEAM_KIT_RELEASE=v1.2.3`, body `hub_window`; one call, matching `^new-window -d -t =home: -n hub -c <HOME> `; its command contains each of `/usr/bin/env`, `-u NODE_OPTIONS`, `-u NODE_PATH`, `-u NODE_REPL_EXTERNAL_MODULE`, `-u DEVTEAM_HOME`, `-u DEVTEAM_RUN`, `-u DEVTEAM_PROJECT`, `-u DEVTEAM_HUB_PORT`, `PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/node /opt/devteam/kit/scripts/devteam.mjs hub --release 'v1.2.3'`, starts `while :; do ` and ends `; sleep 1; done`. With `HAS_HOME=1`: `^new-session -d -s home -n hub -c <HOME> ` and the same command. For `DEVTEAM_KIT_RELEASE` each of `v0.52.0-rc1`, `v1.2.3\nv1.2.3`, `1.2.3`, `v1.2`, `''`, `v1.2.3'; touch x; '`: the command has `--release ''`.
  - `the boot waits for the hub at most DEVTEAM_HUB_WAIT_SECONDS, and notes it gave up`: `DEVTEAM_IMAGE_HUB=4320`, `DEVTEAM_HUB_WAIT_SECONDS=1`, no `BODY`, body `hub_wait; echo rc=$?`; prints `rc=1`, elapsed < 5000 ms, curl called 1-3 times with `http://127.0.0.1:4320/instances.json`, `box.log` matches `/hub: nothing answered hub 1 on 127\.0\.0\.1:4320 after 1s/`. With `BODY='{"hub":1,"kit":"v1.2.3","instances":[]}'`: `rc=0`, one curl call, no `box.log`. With `BODY='{"hub":12}'`: `rc=1` (not hub 1).
  - `the minute loop recreates home:hub only when it is gone`: `WINDOWS='operator\nshell\nhub\n'` → no `new-window`/`new-session` call; `WINDOWS='operator\nshell\n'` → one `new-window … -n hub`; list-windows failing (fake exits 1 when `WINDOWS` unset) with `HAS_HOME=1` → one `new-session -d -s home -n hub`.
  - `the boot's hub lines sit where the boot needs them`: in the Dockerfile, a line `ENV DEVTEAM_IMAGE_HUB=4320`; inside the `devteam-dev` heredoc the line index of `hub_window` (bare call) > that of `tmux new-session -d -s home -n operator`, and < the `hub_wait || :` line < the dashboard `for k in "$HOME"/code/*/docs/devteam/scripts/devteam.mjs; do` line (the first one); the minute-loop line directly follows `  sleep 60`.
  - `hub_window makes home:hub on a real tmux even when another session has a window named home` (`{ skip: !hasTmux }`): on the test file's tmux server (`tmuxSh`), make session `home` (window `operator`, `sleep 600`) then session `kit49-other` with a window named `home`; run the `hub_window` line with real tmux on PATH (the test file's env, `baseEnv`, whose shim keeps it off the machine's own server), after the test replaces `/usr/local/bin/node /opt/devteam/kit/scripts/devteam.mjs hub` in the line with `sleep 600; :` (asserting the replacement happened, so no real hub ever starts on 4320 in CI); assert `tmuxSh(['list-windows','-t','=home','-F','#{window_name}'])` lists `hub`; kill both sessions in `finally`.
- [ ] **Step 2: Run them, see them fail**: `node --test --test-concurrency=2 --test-timeout=600000 --test-name-pattern="hub" test/machine.test.mjs` → the five new tests fail (lines not found).
- [ ] **Step 3: Implement** the Dockerfile lines per Interfaces; comment above `hub_window` names why the release is expanded here, the `=home:` colon, and the extra `-u`; update the minute loop's comment (a gone tmux server: this line starts a new one holding only the hub, harmless in a stop's last 2 s; a list-windows hiccup can add a second hub window, which only retries); the `COPY docs/devteam` comment says every release deploys the image, so its kit is the latest release's.
- [ ] **Step 4: Run them, see them pass** (same command). Then the mutation check (F2-3): drop the colon from `'=home:'` in the Dockerfile, rerun the real-tmux test, it must fail; restore (`git diff` empty for that line). Record the output for the task review.
- [ ] **Step 5: Gate and commit**: `node /data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs gate test -- node --test --test-concurrency=2 --test-timeout=600000 test/machine.test.mjs`; shellcheck the extracted `devteam-dev` script (`sed -n` the heredoc to a scratch file, `shellcheck -s sh`) shows no new warning on the added lines; commit `kit-49: the boot starts the image's hub and keeps it`.

### Task 2: the deploy gate and the image's smoke check

**Files:**
- Modify: `.github/workflows/box-deploy.yml`, `.github/workflows/box-image.yml`
- Test: `test/machine.test.mjs` (after Task 1's tests)

**Interfaces:**
- Consumes: `box-pins verify --release <tag>` (exit 0 ok; 1 with `DEVTEAM_RELEASE is X, not Y`), `box-pins installed` (exit 1 on a mismatch).
- Produces: in box-deploy's step, `env` gains `TAG: ${{ github.event.release.tag_name }}`; the `run:` block's first lines: `node docs/devteam/scripts/devteam.mjs box-pins verify --release "$TAG" || { echo "<refusal>"; exit 1; }`, then the existing HOOK line; `inputs=(cloud docs/devteam)` with its comment saying every path the Dockerfile copies. A step `- uses: actions/setup-node@v5` with `node-version: 22` after checkout. Header comment: deploys every release (each release-prep PR stamps the Dockerfile), refusing one whose stamp isn't its tag.

- [ ] **Step 1: Write the failing test** `box-deploy refuses a release whose stamp isn't its tag, before it reads the hook`: read `.github/workflows/box-deploy.yml`; take the lines after the line `        run: |` that are indented ≥ 10 spaces, strip 10; read `ARG DEVTEAM_RELEASE=(v\S+)` from the Dockerfile. Run `bash -c <script>` with cwd `REPO`, env `{ ...process.env, TAG, HOOK: '' }` with `DEVTEAM_HOME`, `DEVTEAM_RUN`, `DEVTEAM_TICKET`, `DEVTEAM_ROLE` removed. Matching: status 0, stdout has `no RENDER_DEPLOY_HOOK`. `TAG=v0.0.1`: status 1, stdout has `refusing v0.0.1:` and `box-pins bump --release v0.0.1`, no `no RENDER_DEPLOY_HOOK`. Also assert the file has `inputs=(cloud docs/devteam)` and still has `github.repository == 'sanctuarycomputer/devteam' && !github.event.release.prerelease`, `environment: box`, `git merge-base --is-ancestor "$SHA" origin/main`.
- [ ] **Step 2: Run, see it fail** (`--test-name-pattern="box-deploy"`).
- [ ] **Step 3: Implement** box-deploy per Interfaces; box-image's smoke `sh -ec` gains `node /opt/devteam/kit/scripts/devteam.mjs box-pins installed; test "$(echo $DEVTEAM_IMAGE_HUB)" = 4320` (and its comment says the tools match their pins and the image names its hub).
- [ ] **Step 4: Run, see it pass.**
- [ ] **Step 5: Gate and commit** as Task 1, `kit-49: box-deploy checks the stamp and deploys on any image input; box-image checks the tools`.

### Task 3: README and operator.md

**Files:**
- Modify: `README.md` (the operator paragraph's "as of the last release that changed the image"; "The deploy gate"), `docs/devteam/process/operator.md` (Checking in, after the `box-status` bullet)

- [ ] **Step 1:** README "The deploy gate": the inputs are `cloud/` and `docs/devteam/` (all the Dockerfile copies); the job refuses a release whose `cloud/Dockerfile` stamp (`ARG DEVTEAM_RELEASE`) and pins don't match its tag (`box-pins verify --release`), naming `box-pins bump --release <tag>`; every release now restarts the box (each release-prep PR changes the Dockerfile), so the image's kit, and its hub, are the latest release's. Remove "A release that changes only the kit doesn't restart the box…". The operator paragraph's line says the image's kit is the latest release's.
- [ ] **Step 2:** operator.md, a bullet under Checking in: "**The hub `DOWN`, or `kit ?`:** `box-status` printing `machine: hub 4320 DOWN`, or `kit ?` (a project's kit, not the image's, serves it), means the image's hub isn't serving. Read `~/.devteam/hub-4320.log` and tell the owner what it says. The box recreates the hub's window (`home:hub`) itself within a minute; don't start one. As a stopgap until a fix, one project's dashboard started with `DEVTEAM_IMAGE_HUB` unset serves the hub from that project's kit." Keep the file's voice.
- [ ] **Step 3:** `grep -n "changed the image\|doesn't restart the box" README.md` prints nothing; run the docs check the kit's CI runs on markdown if any (`grep -n "md" .github/workflows/test.yml` to find it) on the two files.
- [ ] **Step 4: Commit** `kit-49: README and operator.md: every release deploys; the hub down`.

### Then

- verification.md at a named commit: a row per done-when; the deploy step by hand (`bash` on the extracted block, HOOK unset, tags `v0.52.0` and `v0.0.1`, output and exit quoted); `box-pins verify`, `box-pins bump --release v9.9.9 --dry-run`, `git status --porcelain` quoted; note the wrapper is a superset of the done-when's (F2-2); box-image's green run on the PR linked; anything not run here (the image's boot itself: kit-51) marked deferred.
- Finish per worker.md §8 (merge origin/main, PR, final-1 and final-1b from other sessions, check-ticket, merge-request), telling reviewers the load rule.

## Rulings

- m-20261115-030118730-supervisor: touched test files only, one at a time, `--test-concurrency=2`; reviewers too.
- m-20261115-030942124-supervisor: spec approved; the hub starts from a folder that is not a checkout on a `plan/*` or `ticket/*` branch (Global Constraints, "Where the hub runs from").
