# kit-201 plan: kit tests can't reach the real fleet

## TL;DR

- One scrub in `test/lib/kit.mjs` at import deletes every `DEVTEAM_*` (but the harness's own knobs, `HARNESS_ENV`) and `TMUX`/`TMUX_PANE`, then sets `DEVTEAM_BOX=off`.
- The per-file `DEVTEAM_*`/`TMUX` denylists in machine, operator-threads and hub-overview go; gateway.test.mjs imports `lib/kit.mjs`; hub-overview gives its kit a temp `HOME`.
- devteam.mjs: `DEVTEAM_BOX=off` makes the kit ignore the box's files, honored only while `$HOME` (by real path) isn't the passwd home (ruling d-20261114-215844973-supervisor).
- The box code is marked as a block and loaded in a vm with a stand-in fs/os/env, so the limit is tested in CI.
- A decoy test re-runs the incident's own test with a worker's env pointed at a decoy run folder: nothing lands there.
- Three tasks; no file added; risk normal.

> **For agentic workers:** executed natively (executing-plans), each task reviewed by a fresh subagent into `reviews/task-<n>.md`.

**Goal:** kit tests run on a devteam box or inside a worker can't write to the real fleet and pass where CI passes.

**Architecture:** the shared test helper owns the env; the kit gains one guarded env knob for its box detection; the box code becomes a cut-out block so its rule is unit-tested.

**Tech Stack:** Node ≥ 20, `node:test`, `node:vm`.

**Spec:** `docs/devteam-dev/tickets/kit-201-tests-isolated-on-box/spec.md`

## Global Constraints

- Only files in touches: `docs/devteam/scripts/devteam.mjs`, `test/machine.test.mjs`, `test/operator-threads.test.mjs`, `test/hub-overview.test.mjs`, `test/lib/kit.mjs`, `test/gateway.test.mjs`. No file is added (records under this folder aside).
- Every test run here goes through `docs/devteam-dev/tickets/kit-201-tests-isolated-on-box/scripts/run-isolated.sh` (ruling m-20261114-215602684-supervisor), never with the session's own env.
- `DEVTEAM_BOX` unset, or anything but `off`, leaves box detection exactly as at main.
- Match the files' idiom: one-line arrow helpers, a short comment saying why above each.

## Review Focus

1. `HOME` a symlink to the passwd home: must count as the account's own home (Task 1 test).
2. `HOME` not resolvable (`realpathSync` throws), or no passwd entry (`os.userInfo()` throws): the switch is ignored, fail closed (Task 1 test: `HOME` naming a missing folder; `passwd: null` makes the stand-in `userInfo` throw).
3. A process that imports `lib/kit.mjs` and reads a harness knob after (lib/fork.mjs's `DEVTEAM_FORK`): must survive (Task 2 env-names test asserts `DEVTEAM_FORK` and `DEVTEAM_TEST_KEEP` survive).
4. `DEVTEAM_PUBLIC_URL` / `DEVTEAM_PREVIEWS` from a box worker: must be scrubbed, or `onBox()` stays true by env (Task 2 env-names test).
5. The nested `node --test` inheriting `NODE_TEST_CONTEXT` and reporting into the parent (Task 2 decoy test deletes it, and asserts the child's own TAP says `# pass 1`).

---

### Task 1: the guarded off switch, as a tested block

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs` (~6618 `previewBox`; ~12998-13030 box detection)
- Modify: `test/lib/kit.mjs` (a `boxFns()` loader beside `gitReadFns`)
- Test: `test/operator-threads.test.mjs`

**Interfaces:**
- Produces (devteam.mjs): markers `/* preview box start */ … /* preview box end */` around `previewBox()`, `/* box start */ … /* box end */` around `onBox` … `gatewayThreadKey`. New in the block: `const boxFilesOff = () => boolean` (true only when `process.env.DEVTEAM_BOX === 'off'` and `fs.realpathSync(os.homedir())` and `fs.realpathSync(os.userInfo().homedir)` both resolve and differ; any throw → false), `const boxFile = (f) => !boxFilesOff() && fs.existsSync(f)`; `onBox`, `threadsNeedGateway`, `gatewayThreadKey` use `boxFile` in place of `fs.existsSync` on the two box constants. The comment above `BOX_GATEWAY_FILE` says why the switch is limited this way and what it doesn't defend against.
- Produces (kit.mjs): `boxFns({ files = [], home, passwd, env = {} }) => { onBox, threadsNeedGateway, gatewayThreadKey, boxFilesOff, BOX_THREAD_KEY }`, run in a vm whose `fs` answers `existsSync`/`statSync`/`readFileSync` from real disk except the two box paths, which exist iff listed in `files` (their stat/read go to stand-in files the loader writes in a temp dir: `BOX_THREAD_KEY`'s content is a public key the caller passes as `files[path]` — so `files` is `{ [path]: text }`), `realpathSync` real; `os.homedir()` = `home`, `os.userInfo().homedir` = `passwd` (`passwd: null` → `userInfo()` throws, as for a uid with no entry); `process.env` = `{ HOME: home, ...env }`; `crypto`, `path`, `URL` real.

- [ ] **Step 1: write the failing test** in `operator-threads.test.mjs`: `test('DEVTEAM_BOX=off turns the box's files off only for a throwaway home: at the account's own home a box stays a box', …)`. Fixture: `passwd` = a temp dir, `link` = a symlink to it, `tmpHome` = another temp dir; `files` = both box paths, the key file holding `GW_PUBLIC`'s text; `env.DEVTEAM_GATEWAY_THREAD_KEY` = a file holding `otherKey`'s public half. Assertions:
  - `home: passwd, env: { DEVTEAM_BOX: 'off' }` → `onBox() === true`, `threadsNeedGateway() === true`, `gatewayThreadKey()` exports equal to `GW_PUBLIC`'s key, `boxFilesOff() === false`.
  - `home: link`, same env → same four results; `home: passwd + '/'` → same.
  - `home: tmpHome, passwd: null, env: { DEVTEAM_BOX: 'off' }` → `boxFilesOff() === false`, `onBox() === true`.
  - `home: path.join(tmpHome, 'missing')` → `boxFilesOff() === false`, `onBox() === true`.
  - `home: tmpHome, env: { DEVTEAM_BOX: 'off' }` → `onBox() === false`, `threadsNeedGateway() === false`, `gatewayThreadKey()` is the env's key; with `DEVTEAM_PUBLIC_URL: 'https://box.example.com'` added, `onBox() === true` (box by env) and the key still the env's.
  - `home: tmpHome`, `DEVTEAM_BOX` unset, then `'on'` → `onBox() === true`, key is the box file's.
  - no `files`, `home: passwd`, no env → `onBox() === false` (a laptop).
- [ ] **Step 2: run it, see it fail** — `run-isolated.sh --test-name-pattern='DEVTEAM_BOX=off' test/operator-threads.test.mjs` → fails at `boxFns` (no `/* box start */` block).
- [ ] **Step 3: implement** the markers, `boxFilesOff`, `boxFile` in devteam.mjs and `boxFns` in kit.mjs.
- [ ] **Step 4: run it, see it pass**; then `node --check docs/devteam/scripts/devteam.mjs`.
- [ ] **Step 5: commit** `kit-201: DEVTEAM_BOX=off, honored only off the account's own home`; review into `reviews/task-1.md`.

### Task 2: one scrub, and the decoy proof

**Files:**
- Modify: `test/lib/kit.mjs:22-41` (the scrub), `test/machine.test.mjs:14,34`, `test/operator-threads.test.mjs:19,67,626`, `test/hub-overview.test.mjs:132-133`, `test/gateway.test.mjs` (imports; loops at 723, 764; its "claims no block" comment at 18)
- Test: `test/machine.test.mjs`

**Interfaces:**
- Produces (kit.mjs): `export const HARNESS_ENV = /^DEVTEAM_(TEST_.*|FORK|FORK_AUDIT|G1_RECORD|CGROUP|MEMINFO)$/`; at import, before any of its own settings, delete every key matching `/^DEVTEAM_/` not matching `HARNESS_ENV`, and `TMUX`, `TMUX_PANE`; then `process.env.DEVTEAM_BOX = 'off'` (comment: the kit honors it only for a throwaway `HOME`, which every test that needs it sets).
- machine.test.mjs:14 and operator-threads.test.mjs:19 keep only their `CLAUDECODE|CLAUDE_*` part (operator-threads keeps `DEVTEAM_OPERATOR_COMMAND`/`PUBLIC_URL` out by the scrub now); the `for (const k of [...]) delete env[k]` lines at machine:34, operator-threads:67,626, hub-overview:133 go. hub-overview's env gains `HOME: base`; gateway.test.mjs's loops at 723 and 764 go. gateway.test.mjs gains `import './lib/kit.mjs';` first among its local imports (its own `DEVTEAM_HUB_PORT`/`PORT_BASE` settings run after and win).

- [ ] **Step 1: write the failing tests** in `machine.test.mjs`:
  - `test('importing the test helper leaves no session's DEVTEAM_* or tmux in the environment, only the harness's own knobs', …)`: spawn `node --input-type=module -e "await import(<kit.mjs url>); console.log(JSON.stringify(Object.keys(process.env).filter(k => /^(DEVTEAM_|TMUX)/.test(k)).sort()))"` with env carrying `DEVTEAM_RUN`, `DEVTEAM_HOME`, `DEVTEAM_ROLE=worker`, `DEVTEAM_TICKET=x-1`, `DEVTEAM_FEATURE`, `DEVTEAM_SUPERVISOR`, `DEVTEAM_PUBLIC_URL`, `DEVTEAM_PREVIEWS=1`, `TMUX=x`, `TMUX_PANE=%9`, `DEVTEAM_FORK=<tmp>`, `DEVTEAM_TEST_KEEP=1`; assert the printed list equals exactly `['DEVTEAM_BOX','DEVTEAM_CGROUP','DEVTEAM_CSWAP','DEVTEAM_FORK','DEVTEAM_HUB_PORT','DEVTEAM_MEMINFO','DEVTEAM_PORT_BASE','DEVTEAM_SUPERVISOR_UP','DEVTEAM_TEST_KEEP','TMUX_TMPDIR']`.
  - `test('a worker's session env sends nothing into its run folder: the incident's own test, run under it, writes nothing in the decoy', { skip: hasTmux ? false : 'needs tmux', timeout: 300000 }, …)`: `decoy` = temp dir with `run/` inside; spawn `node --test --test-reporter=tap --test-name-pattern='^status says at a glance' test/machine.test.mjs` with `{ ...process.env, DEVTEAM_RUN: decoy/run, DEVTEAM_HOME: decoy, DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'x-1', DEVTEAM_PUBLIC_URL: 'https://box.example.com', TMUX: 'x', TMUX_PANE: '%9' }` minus `NODE_TEST_CONTEXT`; assert status 0, stdout matches `/^# pass 1$/m`, `/^# skip 0$/m` and `/^# fail 0$/m`, and a recursive listing of `decoy` is `['run']` (the empty folder only).
- [ ] **Step 2: run them, see them fail** (`run-isolated.sh --test-name-pattern='importing the test helper|decoy' test/machine.test.mjs`): the env list holds `DEVTEAM_RUN` etc.; the decoy holds log files (the incident reproduced, against the decoy). Paste the failing listing into `reviews/task-2.md`'s notes or `verification.md`.
- [ ] **Step 2b: check done-when 1** with the spec's AC1 grep after Step 3: no match.
- [ ] **Step 3: implement** the scrub and the per-file removals above.
- [ ] **Step 4: run them, see them pass.**
- [ ] **Step 5: commit** `kit-201: one env scrub for every test that spawns the kit`; review into `reviews/task-2.md`.

### Task 3: the three files on the box, and the suite

- [ ] **Step 1:** `run-isolated.sh --test-reporter=tap test/operator-threads.test.mjs test/machine.test.mjs test/hub-overview.test.mjs` on this box (both box files present) → `# fail 0` (baseline at cca0976: operator-threads 1 pass / 15 fail).
- [ ] **Step 2:** the same three with the session's own env (only `TMUX_TMPDIR` set to a fresh dir, through a second script `run-as-worker.sh` beside run-isolated.sh, which keeps `DEVTEAM_RUN` pointed at a decoy copy, never home's) → `# fail 0`, decoy empty.
- [ ] **Step 3:** `run-isolated.sh` on `test/gateway.test.mjs` and `test/kit.test.mjs` (fork path) → pass; then the full suite as test.yml runs it, through `devteam.mjs gate test`.
- [ ] **Step 4:** push; test.yml green on every job; `verification.md` with a row per done-when at the commit.

## Rulings

See the spec's Rulings (m-20261114-215142046, m-20261114-215602684, d-20261114-215844973).
