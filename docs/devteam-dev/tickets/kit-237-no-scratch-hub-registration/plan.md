# kit-237 plan

## TL;DR

- One change in `docs/devteam/scripts/devteam.mjs`, beside `registerOnMachine`: `scratchRootWhy`, `sessionRun`, `hubPortExplicit` and `machineRecords`.
- `registerOnMachine` skips a temp or scratchpad root and a session's run, unless `DEVTEAM_HUB_PORT` is set. `DEVTEAM_HUB_RECORD=off` always skips.
- The dashboard passes `DEVTEAM_HUB_RECORD=off` to its `accounts-tick` child when its own env is a session's.
- `machineRepos` drops stray records (no explicit port), and `machine status` prints one `machine: stray hub record <file>` line each.
- Tests in `test/machine.test.mjs`. Registration and ignoring run with a fake HOME, no explicit port and their own `TMPDIR`. The dashboard hand-off runs on the test's own hub port.
- TDD: tests first and seen failing, then the code. Only `test/machine.test.mjs` runs locally, at `--test-concurrency=2`; CI is the gate.
- Two tasks, each with a review record.

## Task 1: the tests (red)

File: `test/machine.test.mjs`, three new tests after "tell and status find a project the machine recorded":

1. `a scratch or session-run kit never registers with the machine's hub; a real project root still does`. Fake HOME `h = mkdtemp(tmp,'hubrec-home-')`, `scratchTmp = mkdtemp(tmp,'hubrec-tmpdir-')`. Env: `baseEnv` minus `DEVTEAM_HUB_PORT`, plus `HOME: h`, `TMPDIR: scratchTmp`, `DEVTEAM_CSWAP: 'off'`, `DEVTEAM_ROLE: ''`. Repos via `repo(name, { dir })`: under `scratchTmp`, under `tmp/…/scratchpad`, and under `h/code`. Each runs `accounts-tick` (status 0), then the test checks `h/.devteam/repos-4320`. The temp and scratchpad roots get no file; `h/code` with `DEVTEAM_HUB_RECORD: 'off'` gets no file; `h/code` without it gets one file whose `root` is that repo's realpath.
2. `a session's dashboard doesn't record its project; a plain one does`. On the test's hub port (env as given), `DEVTEAM_IMAGE_HUB` set to that port, `DEVTEAM_ACCOUNTS_MS: '200'`, cswap off, HOME `home`. Start `dashboard` in a fresh `repo()` with `DEVTEAM_ROLE: 'worker'` and `DEVTEAM_TICKET: 'x-1'`. Wait until `run/accounts.json` exists, wait one more tick (its `at` changes), and check that `repos-<port>` has no record with that root. Then the planner variant (`DEVTEAM_ROLE: 'planner'`, `DEVTEAM_FEATURE: 'x'`). Then the control: no session env, and a record with that root appears. Each dashboard is killed in `finally`.
3. `stray hub records under a temp or scratchpad root are ignored and named once by status`. Fake HOME and test `TMPDIR`, no explicit port. Write records `a.json` (root under scratchTmp, with an adopted repo there), `b.json` (root under `…/scratchpad/`, adopted) and `c.json` (adopted repo under `h/code`). `recover --machine --dry-run` (as owner, `DEVTEAM_MACHINE_EPOCH`) mentions c's name and neither a's nor b's. `machine status --in <empty>` has exactly one `machine: stray hub record a.json` line and one for `b.json`, has c's project line, and has no line naming a's or b's repo.

Run: `node --test --test-concurrency=2 --test-name-pattern='hub record|registers with the machine|session.s dashboard' test/machine.test.mjs`. Expect red.

## Task 2: the code (green)

File: `docs/devteam/scripts/devteam.mjs`.

- After `machineRepoDir`, add:
  - `hubPortExplicit`;
  - `tempDirs()`: realpaths of `os.tmpdir()` and `$TMPDIR`, deduplicated;
  - `scratchRootWhy(root)`;
  - `sessionRun(env = process.env)`;
  - `hubRecordOff(env)`.
- `registerOnMachine`: `if (hubRecordOff() || (!hubPortExplicit() && (sessionRun() || scratchRootWhy(root)))) return;`.
- `machineRecords()` returns `{ roots, strays }`; `machineRepos = () => machineRecords().roots`.
- `machineStatus`: after the box line, `for (const s of machineRecords().strays) out(\`machine: stray hub record ${s.file} (${s.why}; ignored: remove it)\`)`. The file name must match `/^[\w.-]{1,80}$/`, else `?`.
- Dashboard `accountsTick`: before the env is stripped, `if (sessionRun() || hubRecordOff()) env.DEVTEAM_HUB_RECORD = 'off';`.
- Comments say why, in the kit's voice.

Re-run the Task 1 command (green). Then the existing record tests in the touched file: `--test-name-pattern='recorded|status|recover'`.

## Gates

`devteam.mjs gate test -- node --test --test-concurrency=2 test/machine.test.mjs` locally (touched file only). CI is `gate ci -- <real gh run watch>` at the pushed head.

## Rulings

- m-20261115-082335469-supervisor: isolated HOME / port away from 4320 / DEVTEAM_* unset for any kit run outside tests; check ~/.devteam/repos-4320/ after; only touched tests at --test-concurrency=2.
