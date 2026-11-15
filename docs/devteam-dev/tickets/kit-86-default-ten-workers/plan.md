# kit-86 no worker limit by default: plan

## TL;DR

- Built on kit-85: its `capOf` and no-limit words in `ready`, metrics and the forecast are consumed as landed, not re-worded.
- `SETTINGS_DEFAULTS` gets `null` for both keys; `capOf` also reads a missing value as no limit and an invalid one as 0 (never wider), which `validate` reports.
- `status --json` and `hello` report the limit; the one Overview stat in `index.html` drops `/null`.
- New `test/default-workers.test.mjs` covers the seven checks, every `metrics` read on a fake cgroup; six pinned lines elsewhere move to the no-limit words by exactly their line.
- `supervisor.md`, `planning.md` and a devteam.mjs comment say: no limit by default; the graph and the memory ceiling pace the work; set, lower or lift a limit only through the settings chore.
- Build starts after kit-85 merges and approve-plan is recorded; T1 reads what kit-85 landed and adjusts the expected words before any test is written.
- Only touched test files run on the box, one at a time, `--test-concurrency=2`; CI (test.yml) is the gate.

## Rulings

As in spec.md's Rulings (m-20261115-194953509, -195217818, -195249403, -195400283, -200152909). Touches: `docs/devteam/scripts/devteam.mjs`, `docs/devteam/process/supervisor.md`, `docs/devteam/process/planning.md`, `README.md`, `test/default-workers.test.mjs`, `test/memory-ceiling.test.mjs`, `test/fixtures/g1/ready.txt`, `test/fixtures/g1/dashboard-data.txt`, `docs/devteam/dashboard/index.html` (one line), `test/lib/chain.mjs` (line 94), `test/kit.test.mjs` (lines 827, 853).

## Shell rules for me and every subagent brief

Multi-step shell goes in a script file under this ticket folder or a private `mktemp -d`, never inline; `rm -rf` only as `"${S:?}/${n:?}"`; `timeout` on every long command; no `/dev/zero` or `/dev/urandom`; no `ulimit -v` or `prlimit --as` on node; a kit run outside the tests gets its own `HOME`, `DEVTEAM_HUB_PORT` away from 4320 and every `DEVTEAM_*` unset; judge by exit code, never piped output. Tests: `node --test --test-concurrency=2 <file>`, one touched file at a time, never the full suite.

## Tasks

### T1. Catch up with kit-85 (no code)

1. Once kit-85 has merged: `git fetch origin && git merge origin/main`; confirm with `ticket show` / `history`.
2. Read what kit-85 landed, across the kit, not just devteam.mjs: `grep -rn "max_active\|capOf\|no limit" docs/devteam test README.md`. Record in this plan's "kit-85 as landed" section: `capOf`'s body; the exact no-limit words of `ready`, idle-capacity, memory-full and the forecast; whether its pin reads main's settings with the defaults merged; `settings set`'s `none` word; the chore commands; and any test of kit-85's (`test/owner-setting.test.mjs`, `test/gateway.test.mjs`, others the grep finds) that pins the old default 5/2 or would change with a `null` default.
3. Any reader kit-85 left doing raw arithmetic on either key goes into T3. Any file outside touches that must change (a kit-85 test pinning the default) is a `design-change` message, `phase blocked` until ruled; work on what it doesn't touch meanwhile.
4. `phase build --task T1`; commit the plan update (`kit-86: T1 kit-85 as landed`).

### T2. The failing test first (TDD)

File: `test/default-workers.test.mjs`, on `fleetFixture` from `test/lib/kit.mjs` (unchanged). The expected no-limit words come from T1's record.

- Fixture: 9 chore tickets in component `ch` (`touches: ['ch/**']`, as memory-ceiling's), one goal (for the planner and forecast). 6 get a worker: a `phase spec` line with `DEVTEAM_TICKET=<id>` and `DEVTEAM_ROLE=worker`, so `activeWorker` counts them with no tmux (`countsAsWorker` excludes only `starting` launches with no worktree). 3 are ready.
- A fake cgroup (as memory-ceiling.test.mjs's `use()`), `DEVTEAM_CGROUP` and `DEVTEAM_MEMINFO` set on every `metrics`, `worker` and `planner` call; 10 GB of 32 used except in Case E.
- `land(patch)`: writes the settings block's keys (removes a key for `undefined`), commits and pushes to the fixture's origin main, so kit-85's pin reads it.
- Case A (neither key; assert the block has neither first): `settings` JSON has both keys, both `null`; `ready` has kit-85's no-limit line for 6 and no `component at cap`; `ready --json` caps both `null`; `metrics --json` idle-capacity subject `3 ready`, suggestion names all 3 ready ids, detail has no `/`; `status --json` `limits` both `null`; `hello --json` `fleet.limit`, `fleet.limit_per_component` `null`; `hello` text ends `no worker limit`; no output of `ready`, `metrics --json`, `status --json`, `hello`, `dashboard-data` contains `/null` or `/undefined`.
- Case A2: both landed as explicit `null`: the same.
- Case B (both 3): `ready` `active workers: 6/3`, `(component at cap)` on each ready row; no idle-capacity; caps 3, 3; `limits` 3, 3; `fleet.limit` 3; text `at most 3 workers`.
- Case C (`max_active_tickets: 9`, per-component unset): idle-capacity detail starts `6/9 workers active`; no `component at cap`.
- Case D (invalid: `0`, `-1`, `2.5`, `"3"`, each landed in turn): `validate` exits non-zero with `settings.max_active_tickets is … a whole number of 1 or more, or null for none`; no idle-capacity. Then `max_active_per_component: 0`: `validate` names that key.
- Case E (memory at 85%): no limit: `worker <ready id>` non-zero with `over its 80% ceiling: start this worker when some sessions finish`, `planner beta --goal <g>` with `start this planner when some sessions finish`, no new `worker-slots` act; `metrics` has `memory-full`, no idle-capacity. Limit 9: same refusals, `memory-full`. Limit 3: same refusals, neither `memory-full` nor idle-capacity.
- Case F (static): `SETTINGS_DEFAULTS`'s text holds `max_active_tickets: null` and `max_active_per_component: null`; over `devteam.mjs` lines not starting with `//` (trimmed), no match of `/\.max_active_(?:tickets|per_component)\b\s*(?:[<>]=?|[-+*\/](?![\/*]))|(?:[<>]=?|[-+*])\s*[\w$.?]*\.max_active_(?:tickets|per_component)\b/`.

Run it; it fails (the default is 5 after kit-85). Commit (`kit-86: T2 failing test`). `phase build --task T2`.

### T3. devteam.mjs

1. `SETTINGS_DEFAULTS`: `max_active_tickets: null`, `max_active_per_component: null`, comment: "Workers at once, in all and per component; null is no limit (the default): the graph (depends_on, touches) decides what runs together and machine_memory_ceiling guards the machine. A limit is a whole number of 1 or more, set through the settings chore (settings set <key> <n|none>)."
2. `capOf(v)`: `v == null ? Infinity : Number.isInteger(v) && v >= 1 ? v : 0` (kit-85's body changed only for `undefined` and invalid values).
3. `limitProblem(key, v)` beside `memoryCeilingProblem`, wired into `validate` for both keys, in the words of spec item 3.
4. `status --json`: `limits: { max_active_tickets: s.max_active_tickets ?? null, max_active_per_component: s.max_active_per_component ?? null }`. `hello`: `fleet.limit`, `fleet.limit_per_component` the same way; text tail `, ${workers} session(s), ${limit == null ? 'no worker limit' : \`at most ${limit} workers\`}`.
5. `goalForecast`'s comment: "…the waves that takes with the worker limit, if any…".
6. Any raw-arithmetic reader T1 found: through `capOf`.
7. `node --check`; run `test/default-workers.test.mjs`: green. Commit (`kit-86: T3 no limit by default`). `phase build --task T3`.

### T4. The pinned lines elsewhere

Each to what the kit now prints (kit-85's words), one line each:
- `test/fixtures/g1/ready.txt:3` (`active workers: 0/5` → kit-85's `active workers: 0 (no limit)`);
- `test/fixtures/g1/dashboard-data.txt:7` (`5` → `null`);
- `test/memory-ceiling.test.mjs:57` (`0\/5 workers active` → the no-limit detail; line 58's `/lower max_active_tickets/` is checked against kit-85's suggestion and left alone if it still matches);
- `test/lib/chain.mjs:94` (`at 5 slots` → what kit-85's forecast prints there);
- `test/kit.test.mjs:827`, `:853` (accept the no-limit forms);
- `docs/devteam/dashboard/index.html:4667`: `['workers active', d.caps.max_active_tickets == null ? \`${active}\` : \`${active}/${d.caps.max_active_tickets}\`],`.

Run `test/components.test.mjs`, `test/memory-ceiling.test.mjs`, `test/kit.test.mjs` one at a time, and the test file that drives `chain.mjs`'s goal block if it is one file (else CI, said in verification.md). `git diff --stat main -- <these>`: one line each. Commit (`kit-86: T4 pinned lines`). `phase build --task T4`.

### T5. Docs

- `supervisor.md` §5 Caps sentence: no limit by default; the graph decides what runs together, `machine_memory_ceiling` guards the machine; the owner may set either, and so may the supervisor for a reason (review capacity, a hotspot), through the settings chore (`chore start settings`, `settings set max_active_tickets <n|none>`, `chore pr settings --title "settings: max_active_tickets <n>"`, `merge --chore settings`), never a working-tree edit, which no longer takes effect. "lower your own `max_active_tickets`" becomes "set or lower a limit, the same way".
- §4: idle-capacity row "under caps" → "under a limit, if one is set"; memory-full row "…set or lower `max_active_tickets` through the settings chore (§5)".
- §3: "may run past `max_active_tickets` when one is set".
- `planning.md` §7 and §1 per spec check 6.
- README: `grep -n "max_active\|workers at once\|worker slots\|at once" README.md`; change only a sentence that names or implies a default cap.
- Commit (`kit-86: T5 docs`). `phase build --task T5`. A task review (fresh subagent) per task, `reviews/task-<n>.md`.

### T6. Verify and finish

- `phase verify`. verification.md: a row per done-when with the command and result at a named commit; the CI row via `gate ci -- <the real gh run command>` at the pushed head (never `-- true`, never piped), with run id and per-job conclusions.
- PR body (`pr-body.md`): summary, how to verify, `## Migration` (spec check 5's words), `## One-way doors` None.
- Merge `origin/main`, push, open PR `kit-86-default-ten-workers: <title>`, final review by a fresh subagent that hasn't seen the build (`reviews/final-1.md`, in a `review-worktree`), dispositions with `dispose`, `check-ticket`, then `send supervisor … --kind merge-request`.
