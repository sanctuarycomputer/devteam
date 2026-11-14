# kit-46-standalone-hub Implementation Plan

## TL;DR

- One script (`docs/devteam/scripts/devteam.mjs`), three test files and the README; no new file outside this ticket's records.
- T1: `devteam.mjs hub [--release vX.Y.Z]`, a machine-wide command running `startHub` alone, logging to `~/.devteam/hub-<port>.log` (≤ 1 MB), with crash/signal handlers shared with the dashboard, retrying whatever holds the port.
- T1 also: `/instances.json` gains `kit` (computed once) and, for `--release`, `image: true`.
- T2: a dashboard leaves the hub alone when `DEVTEAM_IMAGE_HUB` equals its hub port, and says so once in `run/dashboard.log`.
- T3: the press checks proven against a box-mode standalone hub (unsigned, replayed, foreign Origin refused; signed reaches the operator's pane).
- T4: `machine status` prints the hub's kit (or `kit ?`, `not a hub`, `DOWN`); T5: README and help.
- Every task test-first; every new test clears `DEVTEAM_IMAGE_HUB`, `DEVTEAM_KIT_RELEASE`, `DEVTEAM_BOX_TOOLS`.

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native; this ticket's tasks share one function, `startHub`, and are built in order in one session). Steps use checkbox (`- [ ]`) syntax.

**Goal:** a hub that runs on its own from the image's kit, and dashboards that step back from it on a box.

**Architecture:** `startHub(log, opts)` stays the one hub implementation. A new `cmdHub` calls it with `{ standalone: true, kit, image }`; `cmdDashboard` calls it with `{ kit: kitVersion() }` unless `DEVTEAM_IMAGE_HUB` names its port. `machineStatus` reads the list.

**Tech Stack:** Node built-ins only (`node:http`, `node:fs`), `node --test`.

**Spec:** `docs/devteam-dev/tickets/kit-46-standalone-hub/spec.md`.

## Global Constraints

- `devteam.mjs` stays one file, Node built-ins, no relative imports; Node 18–24 (CI matrix).
- Fixture ports only (`PORTS + n` of the file's block); never 4320 in a test.
- Every test added deletes `DEVTEAM_IMAGE_HUB`, `DEVTEAM_KIT_RELEASE`, `DEVTEAM_BOX_TOOLS` from the env it passes, setting them only where it means to.
- Exact strings: `hub: left to the image (DEVTEAM_IMAGE_HUB=<port>)`; `stopped by SIGTERM`; `machine: hub <port> up, kit <release> (image)` / `up, kit <release>` / `up, kit ?` / `up, not a hub` / `DOWN`.
- Existing tests in dashboard, hub-overview, operator-threads and machine test files pass unchanged.
- Gates: `node /data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs gate test -- node --test <file>` per file touched.

## Review Focus

1. `--release ""` (the boot on an image without `DEVTEAM_KIT_RELEASE`): the hub must serve, `kit: null`, no `image`, never exit. Test in T1.
2. The standalone hub run from a git checkout (tests) vs a non-git folder (the box): `mainRoot` differs, so owner actions run from the hub's own cwd and the hub writes no `run/`. T1 asserts nothing appears under its cwd; T3's signed press lands in the store under `HOME`, run from that cwd.
3. A process that would exit while retrying (an unref'd timer with no listener): T1's "held by a hub" test asserts the process is still alive after two retry intervals.
4. A non-hub that answers forever: logged once, not per retry: T1 counts lines.
5. `machine status` against a hostile `kit` (control characters, 10 KB): printed as `kit ?`. Test in T4.

---

### Task 1: `devteam.mjs hub`, the `kit` field, the hub's log and handlers

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs` (machineWide list ~430; `runOwnerAction` ~11727; `startHub` and its comment ~11779-11965; `cmdDashboard` handlers ~13763-13765 and its `startHub(log)` call ~14619; `COMMANDS` ~19077; HELP "Dashboard and releases")
- Test: `test/hub-overview.test.mjs`

**Interfaces:**
- Produces: `startHub(log, { kit = null, image = false, standalone = false } = {})`; `processLog(log, name)` installs uncaughtException/unhandledRejection (log `crashed: <stack>`, stderr `devteam <name> crashed: …`, exit 1) and SIGTERM/SIGINT/SIGHUP (`stopped by <SIG>`, exit 0); `hubLogger()` returns `(msg) => void` writing `<iso> [<pid>] <msg>` to stderr and `~/.devteam/hub-<HUB_PORT>.log`, rotating to `.1` before a write that would pass 1 MiB (1048576); `cmdHub()`; `runOwnerAction(args, { …, cwd = mainRoot })`; `projectKit()` = `fs.existsSync(path.join(projectDir, 'settings.md')) ? kitVersion() : null`.
- List shape: `{ hub: 1, kit, ...(image ? { image: true } : {}), instances }`.

- [ ] **Step 1: failing tests** in `test/hub-overview.test.mjs`, one helper `startHubCmd(cwd, env, args)` (spawn `node <kit>/scripts/devteam.mjs hub …`, detached, killed in `t.after`), env built from `process.env` minus the three box vars, `HOME` a temp home, `DEVTEAM_HUB_PORT=PORTS+40`, `DEVTEAM_PORT_BASE=PORTS+41`, `DEVTEAM_HUB_RETRY_MS=300`:
  - `test('hub --release, from a folder that is no repo: the list with the image\'s release, and nothing written there')`: the hub started first (it holds the port), then a bareProject dashboard, whose own hub keeps retrying harmlessly, is listed; `GET /instances.json` → `hub === 1`, `kit === 'v9.9.9'`, `image === true`, instances includes the fixture root; `fs.existsSync(path.join(cwd, 'docs')) === false`.
  - `test('hub without --release names no release, whatever DEVTEAM_KIT_RELEASE says; a bad --release serves anyway')`: env `DEVTEAM_KIT_RELEASE=v9.9.9`: `kit === null`, `!('image' in list)`; then `hub --release ''` and `--release nope`: same, and the process still alive after 1 s.
  - `test('a dashboard\'s hub names its project\'s kit and no image')`: dashboard with `DEVTEAM_KIT_RELEASE=v9.9.9`: list `kit` equals `hello --json` `kit` of that project, no `image`.
  - `test('the hub waits out another hub and a non-hub, logging the non-hub once, and takes the port')`: holder 1 = a tiny server answering `{"hub":1,"instances":[]}` on `/instances.json`; start `hub --release v9.9.9`; after 1 s it is alive and list kit is not `v9.9.9`; close holder → until list kit `v9.9.9`. Holder 2 = server answering `ok`: restart hub; after 1.5 s exactly one line matching `isn't a devteam hub` in `HOME/.devteam/hub-<port>.log`; close → until kit `v9.9.9`.
  - `test('the hub\'s log stays under 1 MB and records a SIGTERM')`: pre-write the log with 1048000 bytes; start hub; until `hub on http://` is in log or `.1`; `statSync(log).size <= 1048576`; `kill(SIGTERM)`; until log includes `stopped by SIGTERM`.
- [ ] **Step 2:** `node --test --test-name-pattern='hub' test/hub-overview.test.mjs` → the new tests FAIL (`unknown command "hub"`).
- [ ] **Step 3: implement.** `cmdHub`: `const rel = flagStr('release')`; valid iff `/^v\d+\.\d+\.\d+$/`; invalid but given → log `hub: --release "<rel>" is not vX.Y.Z; serving with no release`; `startHub(log, valid ? { kit: rel, image: true, standalone: true } : { kit: projectKit(), standalone: true })`. In `startHub`: list body adds `kit`/`image`; on `EADDRINUSE`, standalone: `holder()`, log the non-hub line only when the last holder seen wasn't `other`, then `setTimeout(tryListen, retry)` **not** unref'd; dashboard path unchanged. Owner actions (`runOwnerAction` and `askOperator`'s `execFile`) use `cwd: standalone ? process.cwd() : mainRoot`. `cmdDashboard` uses `processLog(log, 'dashboard')` and `startHub(log, { kit: projectKit() })`. Add `'hub'` to `machineWide`, `COMMANDS`, HELP. Rewrite the comment above `startHub`: who serves it (a dashboard, or `devteam.mjs hub` alone, which keeps retrying), the list's fields, and "additive changes keep `hub: 1`; anything else bumps it".
- [ ] **Step 4:** the same command → PASS; then the whole file and `test/dashboard.test.mjs` through `gate`.
- [ ] **Step 5:** commit `kit-46 T1: devteam.mjs hub, the list's kit, the hub's log`.

### Task 2: dashboards leave the hub to the image

**Files:** Modify `docs/devteam/scripts/devteam.mjs` (`cmdDashboard`'s `listening` handler); Test `test/hub-overview.test.mjs`.

**Interfaces:** Consumes `startHub(log, opts)`, `projectKit()` from T1. Produces `imageHub()` = `Number(process.env.DEVTEAM_IMAGE_HUB)` when the trimmed value is a non-empty integer string, else `null`.

- [ ] **Step 1: failing test** `test('a dashboard leaves the hub to the image only when DEVTEAM_IMAGE_HUB names its own hub port')`: three runs of a bareProject dashboard on hub `PORTS+40`: (a) `DEVTEAM_IMAGE_HUB=String(PORTS+40)`: after the dashboard answers `/api/hello`, wait 1 s; `net.connect(PORTS+40)` fails (nothing listens); `run/dashboard.log` has exactly one line ending `hub: left to the image (DEVTEAM_IMAGE_HUB=<PORTS+40>)`. (b) unset and (c) `4320`: until `/instances.json` answers `hub: 1`, and the log has no `left to the image`.
- [ ] **Step 2:** run → FAIL on (a).
- [ ] **Step 3:** in the `listening` handler: `imageHub() === HUB_PORT ? log(\`hub: left to the image (DEVTEAM_IMAGE_HUB=${HUB_PORT})\`) : startHub(log, { kit: projectKit() })`, with a one-line comment (the image's own hub serves it; an older kit can still take the port in a restart's gap).
- [ ] **Step 4:** PASS, and T1's tests still pass.
- [ ] **Step 5:** commit `kit-46 T2: dashboards leave the hub to the image`.

### Task 3: the press checks on a box-mode standalone hub

**Files:** Test `test/operator-threads.test.mjs` only (no code change expected; a failure here is a bug in T1, fixed there).

**Interfaces:** Consumes `hub` (T1), this file's `signedPress`, `ask`, `seat`, `machine({ box: true })` env pieces, `GW_PUBLIC`.

- [ ] **Step 1: test** `test('on a box the standalone hub takes a press only as the gateway signed it, once, from the hub\'s own page; a signed one reaches the operator')`, `skip: !hasTmux`: `M = machine({ box: true })`; seat the operator (`seat(M)`, session `home`); spawn `hub` from `nowhere` with `M.env` minus the three box vars, `DEVTEAM_HUB_PORT=M.hub`, `DEVTEAM_PORT_BASE=PORTS+60`; until `/instances.json` answers. `own` headers as in `hubFixture`. Assert 403 for: `thread-new` with `own` only; a signed press re-sent after it was taken (`/used already/`); the signed headers with `origin: 'https://evil.example'`. Assert 200 for a fresh signed `thread-new {text:'standalone?'}`, its `out` second line `sent to the operator's pane`, and `until(() => a.keys().includes('standalone?'))`. `finally`: kill hub and `a.kill()`.
- [ ] **Step 2:** run the file through `gate` → PASS (it guards T1; mutate `ownerPost`'s nonce check in a scratch copy once to see it fail, noted in the task review).
- [ ] **Step 3:** commit `kit-46 T3: the press checks, against the standalone hub`.

### Task 4: `machine status`'s hub line

**Files:** Modify `docs/devteam/scripts/devteam.mjs` (`machineStatus` hub line ~13595; a `hubLine(port)` beside `portAnswers`); Test `test/machine.test.mjs`.

**Interfaces:** Produces `hubLine(port) -> Promise<string>` returning `DOWN`, `up, not a hub`, `up, kit ?`, `up, kit <r>`, `up, kit <r> (image)`; `<r>` shown only if `/^[\w.+-]{1,64}$/`. Uses `http.get` (Host `127.0.0.1:<port>`, `sec-fetch-site: same-origin`, 3 s timeout, body capped at 64 KB → `not a hub`).

- [ ] **Step 1: failing test** `test('status names the hub\'s kit, or says it is no hub, or down')`: for each fixture served on `process.env.DEVTEAM_HUB_PORT` by an in-process `http.createServer` — `{hub:1,kit:'v1.2.3',image:true,instances:[]}`, `{hub:1,kit:'v1.2.3',instances:[]}`, `{hub:1,instances:[]}`, `{hub:1,kit:'\u001b[31mx',instances:[]}`, `'ok'` — run `machine status --in <empty dir>` and assert the exact line (`up, kit v1.2.3 (image)`, `up, kit v1.2.3`, `up, kit ?`, `up, kit ?`, `up, not a hub`); with nothing listening, `DOWN`; with an alert set, `up, kit v1.2.3; alert: look`. The env clears the three box vars.
- [ ] **Step 2:** run → FAIL (`up` alone).
- [ ] **Step 3:** implement `hubLine`, use it in `machineStatus`.
- [ ] **Step 4:** the file through `gate` → PASS (the existing DOWN assertions unchanged).
- [ ] **Step 5:** commit `kit-46 T4: machine status names the hub's kit`.

### Task 5: README

**Files:** Modify `README.md` ("Many projects, one machine").

- [ ] **Step 1:** after "Any running dashboard also serves the hub at http://127.0.0.1:4320", add: on a laptop that is any dashboard; `devteam.mjs hub` serves it alone; on a box whose image sets `DEVTEAM_IMAGE_HUB` the image's own kit serves it and dashboards on this release or later leave the port alone (saying so in `run/dashboard.log`), so the gap left is a project still on an older kit, which can take the port in the moment the image's hub restarts. `hub` appears in HELP (T1).
- [ ] **Step 2:** `git diff --diff-filter=A --name-only origin/main -- . ':!docs/devteam-dev'` is empty.
- [ ] **Step 3:** commit `kit-46 T5: README, the image's hub`.

## Rulings

None yet.
