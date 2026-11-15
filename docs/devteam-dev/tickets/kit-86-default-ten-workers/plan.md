# kit-86 no worker limit by default: plan

## TL;DR

- `SETTINGS_DEFAULTS` sets `max_active_tickets` and `max_active_per_component` to `null` (no limit); one helper, `workerLimits(s)`, and one predicate, `underLimit(n, limit)`, are the only readers, so nothing compares a count with `null`.
- Every reader in the spec's table (R1 to R12) goes through them: `ready`, `metrics` idle-capacity and memory-full, the goal forecast, `dashboard-data`, `status --json`, `hello`, and the one Overview stat in `index.html`.
- `validate` reports a limit that is neither a positive integer nor `null`; such a value counts as no limit.
- New `test/default-workers.test.mjs` covers the five checks; three goldens and two old assertions move from 5 to no limit by exactly their pinned lines.
- `supervisor.md`, `planning.md` say: no limit by default, the graph and the memory ceiling pace the work, a limit is set or lifted only through the settings chore.
- Build starts only after kit-85 merges and approve-plan is recorded; first task merges `origin/main` and re-reads kit-85's settings chore and pinning.
- Only touched test files run on the box, one at a time, `--test-concurrency=2`; CI (test.yml) is the gate.

## Rulings

As in spec.md's Rulings (m-20261115-194953509, -195217818, -195249403, -195400283). Touches now: `docs/devteam/scripts/devteam.mjs`, `docs/devteam/process/supervisor.md`, `docs/devteam/process/planning.md`, `README.md`, `test/default-workers.test.mjs`, `test/memory-ceiling.test.mjs`, `test/fixtures/g1/ready.txt`, `test/fixtures/g1/dashboard-data.txt`, `docs/devteam/dashboard/index.html` (one line), `test/lib/chain.mjs`.

## Shell rules for me and every subagent brief

Multi-step shell goes in a script file under this ticket folder or a private `mktemp -d`, never inline; `rm -rf` only as `"${S:?}/${n:?}"`; `timeout` on every long command; no `/dev/zero` or `/dev/urandom`; no `ulimit -v` or `prlimit --as` on node; a kit run outside the tests gets its own `HOME`, `DEVTEAM_HUB_PORT` away from 4320 and every `DEVTEAM_*` unset; judge by exit code, never piped output. Tests: `node --test --test-concurrency=2 <file>`, one touched file at a time, never the full suite.

## Tasks

### T1. Catch up with kit-85 (no code)

1. `git fetch origin && git merge origin/main` once kit-85 has merged; confirm `depends_on` merged (`ticket show`, `history`).
2. Read what kit-85 landed: `loadSettings`'s pin of `max_active_tickets` to main, the `settings set` allowlist (does it take `null` or only 1 to 20?), the `chore … settings` command words, and every new reader of `max_active_tickets` it added (`grep -n max_active docs/devteam/scripts/devteam.mjs`). Add any new reader to the spec's table with a one-line commit, and the command words to the docs tasks. If `settings set` can't write `null`, send the supervisor an `info` note (lifting a limit needs kit-85's allowlist) and write the docs to match what exists.
3. `phase build --task T1`; commit only if the spec changed.

### T2. The failing test first (TDD)

File: `test/default-workers.test.mjs`. Uses `fleetFixture` from `test/lib/kit.mjs` (unchanged).

- Fixture: 7 chore tickets in one component (`ch`, `touches: ['ch/**']`, as memory-ceiling's), and one goal for the planner case. 6 of them get a worker: a `phase spec` line written with `DEVTEAM_TICKET=<id>` and `DEVTEAM_ROLE=worker` (so `activeWorker` counts it, no tmux needed). The 7th is ready.
- A helper `land(patch)` that writes the settings block's keys (or removes them for `undefined`), commits and pushes to the fixture's origin main, so kit-85's pin reads it.
- Case A, neither key set (the fixture's `init` writes neither: assert that first by reading settings.md): `settings --get max_active_tickets` and `--get max_active_per_component` print `null`; `ready` text has a line exactly `active workers: 6` and no `component at cap`; `ready --json` `caps.max_active_tickets === null` and `caps.max_active_per_component === null`; `metrics --json` has `idle-capacity` with subject `1 ready` and detail `6 workers active, no limit`; `status --json` `limits` both `null`; `hello --json` `fleet.limit === null` and `fleet.limit_per_component === null`; `hello` text ends `no worker limit`; `goal forecast` (a goal with one unplanned milestone of 4 tickets) says `1 waves to here with no worker limit`; `dashboard-data` `caps.max_active_tickets === null`.
- Case A2: both written explicitly as `null`: the same answers.
- Case B, both set to 3: `ready` text `active workers: 6/3` and `(component at cap)` on the ready row; no `idle-capacity`; `caps` 3 and 3; `status --json` `limits` 3 and 3; `hello --json` `fleet.limit === 3`, text `at most 3 workers`; forecast `2 waves to here at 3 slots`.
- Case C, `max_active_tickets: 7`, per-component unset: idle-capacity detail `6/7 workers active`; no `component at cap`.
- Case D, invalid values (`0`, `-1`, `2.5`, `"3"`): `validate` exits non-zero naming `settings.max_active_tickets is … a whole number of 1 or more, or null for none`; `ready` behaves as no limit (`active workers: 6`).
- Case E, the memory ceiling (a fake cgroup as in memory-ceiling.test.mjs, at 85% of 32 GB with `DEVTEAM_CGROUP`, `DEVTEAM_MEMINFO`): with no limit, `worker <7th>` exits non-zero with `over its 80% ceiling: start this worker when some sessions finish`, and `planner beta --goal <g>` with `start this planner`; no `worker-slots` act logged; `metrics` has `memory-full` with detail containing `6 workers active, no limit` and suggestion matching `set or lower max_active_tickets through the settings chore`, and no `idle-capacity`. Again with the limit at 3 (B's settings) plus one more ready: still refused.
- Case F, the source scan: read `docs/devteam/scripts/devteam.mjs`; every match of `/\.max_active_(tickets|per_component)\b/` outside comments lies inside `function workerLimits(` … its closing line, and `SETTINGS_DEFAULTS` has `max_active_tickets: null` and `max_active_per_component: null`.

Run it; it fails (at R0's `5`). Commit the failing test (`kit-86: T2 failing test`). `phase build --task T2`.

### T3. devteam.mjs

1. R0: `SETTINGS_DEFAULTS` `max_active_tickets: null`, `max_active_per_component: null`, comment: "Workers at once, in all and per component; null is no limit (the default): the graph (depends_on, touches) decides what runs together and machine_memory_ceiling guards the machine. A limit is a whole number of 1 or more, set through the settings chore."
2. Helpers, beside `countsAsWorker`: `const limitValue = (v) => (Number.isInteger(v) && v >= 1 ? v : null);` `function workerLimits(s = loadSettings()) { return { total: limitValue(s.max_active_tickets), per_component: limitValue(s.max_active_per_component) }; }` `const underLimit = (n, limit) => limit == null || n < limit;` `const activeWords = (n, limit) => limit == null ? \`${n} workers active, no limit\` : \`${n}/${limit} workers active\`;`
3. `limitProblems(s)` for validate, beside `memoryCeilingProblem`: for each key, a value that is neither `null`/missing nor a positive integer is an error in the words of Case D. Wire into `validate` next to the memory ceiling line.
4. R1 to R3 in `cmdReady`: `const L = workerLimits(s)`; text `active workers: ${n}${L.total == null ? '' : \`/${L.total}${suffix}\`}`; `(component at cap)` when `!underLimit(perComponent, L.per_component)`; json caps from `L`.
5. R4 to R6 in metrics: with `L`, the fix-slot line only when `L.total != null && !underLimit(active, L.total) && active < L.total + incident_slots`; the plain line on `underLimit(active, L.total)`; memory-full the same; details via `activeWords`; the memory-full suggestion's new words.
6. R7, R8: `slots = workerLimits().total` (null when none); unplanned waves `slots == null ? (m.tickets ? 1 : 0) : Math.ceil(m.tickets / slots)`; `forecastText` `${slots == null ? 'with no worker limit' : \`at ${f.slots} slots\`}`.
7. R9: `caps: { max_active_tickets: workerLimits(settings).total }`. R10: `status --json` gets `limits: { max_active_tickets, max_active_per_component }`. R11: `hello` `fleet.limit`, `fleet.limit_per_component`, and the text tail.
8. `node --check`; run `test/default-workers.test.mjs`: green. Commit (`kit-86: T3 no limit by default`). `phase build --task T3`.

### T4. The pinned lines elsewhere

- `test/fixtures/g1/ready.txt:3` `active workers: 0/5` → `active workers: 0`.
- `test/fixtures/g1/dashboard-data.txt:7` `"max_active_tickets": 5` → `"max_active_tickets": null`.
- `test/memory-ceiling.test.mjs:57` `0\/5 workers active` → `0 workers active, no limit` (line 58's `/lower max_active_tickets/` still matches the new suggestion; leave it).
- `test/lib/chain.mjs:94` `1 waves to here at 5 slots` → `1 waves to here with no worker limit`.
- `docs/devteam/dashboard/index.html:4667` → `['workers active', d.caps.max_active_tickets == null ? \`${active}\` : \`${active}/${d.caps.max_active_tickets}\`],` (that one line only).
- Run `test/components.test.mjs` (G1) and `test/memory-ceiling.test.mjs`, one at a time; find which test file runs chain.mjs's line 94 (`grep -ln "chain.mjs" test/*.test.mjs` then the file whose group holds it) and run that one alone if it is a single file; otherwise leave it to CI and say so in verification.md. `git diff --stat` shows each of these files changed by exactly one line. Commit (`kit-86: T4 pinned lines`). `phase build --task T4`.

### T5. Docs

- `supervisor.md` §5 Caps sentence: no limit by default (`max_active_tickets`, `max_active_per_component` unset): the planner's graph decides what runs together and `machine_memory_ceiling` guards the machine; the owner may set either, and so may you for a reason (review capacity, a hotspot), through the settings chore (`chore start settings`, `settings set max_active_tickets <n>`, `chore pr settings --title "settings: max_active_tickets <n>"`, `merge --chore settings`), never a working-tree edit, which no longer takes effect. The "If you keep hitting the ceiling, lower your own max_active_tickets" sentence says: set or lower a limit, the same way.
- §4 memory-full row: "…; if it keeps happening, set or lower `max_active_tickets` through the settings chore (§5)".
- §3's incident-slots line: "may run past `max_active_tickets` when one is set".
- `planning.md` §7: the adoption sentence per spec check 6; §1's "add worker slots" per check 6.
- README: `grep -n "max_active\|workers at once\|worker slots" README.md`; change only a sentence that names or implies a default cap (none found at de07a84).
- Commit (`kit-86: T5 docs`). `phase build --task T5`. A task review (fresh subagent) per task, `reviews/task-<n>.md`.

### T6. Verify and finish

- `phase verify`. verification.md: a row per done-when with the command and result at a named commit; the CI row via `gate ci -- <the real gh run watch/view command>` at the pushed head (never `-- true`, never piped), with run id and per-job conclusions.
- PR body (`pr-body.md`): summary, how to verify, `## Migration` (spec check 5's words), `## One-way doors` None.
- Merge `origin/main`, push, open PR `kit-86-default-ten-workers: <title>`, final review by a fresh subagent that hasn't seen the build (`reviews/final-1.md`, in a `review-worktree`), dispositions with `dispose`, `check-ticket`, then `send supervisor … --kind merge-request`.
