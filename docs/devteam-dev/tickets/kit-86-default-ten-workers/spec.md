# kit-86 no worker limit by default: spec

Ticket: `kit-86-default-ten-workers` (feature `dashboard-cleanup`, serves DCL-S2, size S, risk normal). Depends on `kit-85-owner-setting-workers` (unmerged at this writing: build waits for it and for approve-plan). Title as rewritten: "No worker limit by default: max_active_tickets and max_active_per_component are unset unless the owner sets one; the plan's graph and the memory ceiling pace the work".

## Intent

Today the kit holds a fleet to 5 workers at once (`max_active_tickets`) and 2 per component (`max_active_per_component`) unless the project says otherwise. The owner's word (thread t-20261115-194652602-owner) is that neither limit exists by default: the planner's graph (`depends_on` and `touches`) already decides what may run together, and `machine_memory_ceiling` already keeps the machine from filling up. A project, or its owner, may still set either limit, and then it holds exactly as it does today.

## Who does what: kit-85 and kit-86

kit-85 (merged first) makes both keys take `null` meaning no limit, at the owner's route, `owner-setting … none` and `settings set … none`, and, per its spec ("`null` in the readers") and plan Task 1, makes the existing readers handle `null` through one helper `capOf(v)` (`null` is `Infinity`): `ready` prints `active workers: N (no limit)` and never `(component at cap)`; idle-capacity and memory-full treat the cap as unlimited and say `no limit` in place of `/null`; the forecast's slot count with no limit is the goal's open tickets in flight, at least 1. It also pins both keys to main's `settings.md`.

kit-86 consumes those readers and their words as they land; it doesn't re-word them. What kit-86 adds:

1. **The default.** `SETTINGS_DEFAULTS` has `max_active_tickets: null` and `max_active_per_component: null`.
2. **Missing is unset too.** `capOf` treats a missing value (`undefined`) as no limit as well as `null`, so no path (a settings object read without the defaults, a repo's settings) turns a missing key into "no capacity" (`n < undefined` is false).
3. **An invalid value never widens.** A value that is neither `null`/missing nor a whole number from 1 up (0, a negative, a fraction, a string) is a `validate` error, "settings.max_active_tickets is 0: a limit is a whole number of 1 or more, or null for none; until it is, no new worker is suggested", and `capOf` counts it as 0: never wider than any limit, as an invalid `machine_memory_ceiling` counts as the default, never wider. kit-85's allowlist can't write one; only a hand edit can.
4. **`status` and `hello` report the limit.** `status --json` adds `limits: { max_active_tickets, max_active_per_component }` (numbers, or `null` for none). `hello --json` adds `fleet.limit` and `fleet.limit_per_component`; `hello`'s text ends `, N session(s), no worker limit` or `, N session(s), at most 3 workers`. `status` text is unchanged, so G1's `status.txt` stays byte for byte.
5. **No raw arithmetic on either key.** Nothing compares or adds to `.max_active_tickets` or `.max_active_per_component` read straight off a settings object; counts are compared through `capOf`. Reads that aren't arithmetic (kit-85's pin, its owner-setting-unlanded equality, its `/api/data` label, JSON output) stay as they are.
6. **The one Overview stat** in `docs/devteam/dashboard/index.html:4667` (`${active}/${d.caps.max_active_tickets}`, which would show `0/null`) shows `${active}` when the cap is `null`. One line; kit-87 rebuilds the page after this.
7. **The pinned lines elsewhere** move from 5 (or a cap) to kit-85's no-limit words: `test/fixtures/g1/ready.txt:3`, `test/fixtures/g1/dashboard-data.txt:7` (`null`), `test/memory-ceiling.test.mjs:57`, `test/lib/chain.mjs:94` (the forecast line), `test/kit.test.mjs:827` and `:853`. Each changes by exactly the pinned line. If kit-85's own tests pin the old default, the same treatment, after a `design-change` to add the file.
8. **The docs** (below).

## Rulings

- m-20261115-194953509-supervisor: plan ahead (spec and plan now; build only after kit-85 merges and approve-plan is recorded). Briefs carry lessons k-20261115-182656232 (scripts in files, guarded `rm -rf`, private `mktemp -d`, `timeout` on everything, no address-space cap on node), k-20261115-080753394 (a kit run outside the tests gets its own `HOME`, a `DEVTEAM_HUB_PORT` away from 4320, every `DEVTEAM_*` unset) and k-20261115-164245020 (judge a check by its exit code, never by piped output). Run only the files touched, at `--test-concurrency=2`.
- m-20261115-195217818-supervisor: scope change from the owner, replacing "5 to 10": no limit by default, total or per component; the graph and the memory ceiling pace the work; every reader treats unset as no limit.
- m-20261115-195249403-supervisor (re my m-20261115-195219809): `test/memory-ceiling.test.mjs`, `test/fixtures/g1/ready.txt` and `test/fixtures/g1/dashboard-data.txt` are added to touches; each pinned line moves from 5 to no limit (the ruling's example, `active workers: 0`, is read as "no cap shown"; the exact words are kit-85's, `active workers: 0 (no limit)`). Change only those lines; G1 keeps no explicit setting.
- m-20261115-195400283-supervisor (re my m-20261115-195326688): `docs/devteam/dashboard/index.html` and `test/lib/chain.mjs` are added to touches. Keep the `index.html` change to that one line: kit-87 rebuilds the page after this ticket, and now follows it.
- m-20261115-200152909-supervisor (re my m-20261115-200138514): `test/kit.test.mjs` is added to touches, for the two regexes at lines 827 and 853 only. Building on kit-85's `capOf` and wording is right.

## Acceptance checks (the done-whens)

Every `metrics` assertion below runs with `DEVTEAM_CGROUP` and `DEVTEAM_MEMINFO` pointing at a fake cgroup (as `test/memory-ceiling.test.mjs` builds one), under the ceiling except in check 3, so the box's real memory can't swap idle-capacity for memory-full.

1. **No limit by default.** `test/default-workers.test.mjs`, in a fleet fixture whose settings set neither key (asserted first: the settings block has neither): 9 tickets in one component, 6 with a worker (a `phase spec` line each, so 6 active, past both old defaults), 3 ready. `settings` (JSON) has both keys present and `null`; `ready` prints kit-85's no-limit line for 6 and no `component at cap`; `ready --json` `caps` both `null`; `metrics --json` has an idle-capacity finding with subject `3 ready` whose suggestion names all 3 ready tickets, and whose detail has no `/`; `status --json` `limits` both `null`; `hello --json` `fleet.limit` and `fleet.limit_per_component` `null`, and `hello` text ends `no worker limit`. The same with each key written explicitly as `null`. *Check:* the test passes in CI (test.yml, every job green at the head).
2. **A set limit holds as today.** Settings landed on main (kit-85 pins to main) with both keys 3: `ready` prints `active workers: 6/3` and `(component at cap)` on each ready row; no idle-capacity; `caps` 3 and 3; `status --json` `limits` 3 and 3; `hello --json` `fleet.limit` 3 and text `at most 3 workers`. With `max_active_tickets: 9` and the per-component key unset: idle-capacity detail `6/9 workers active`, no `component at cap`. *Check:* the same test.
3. **The memory ceiling still refuses, limit or none.** With memory at 85% of a fake 32 GB under the 80% ceiling: with no limit, `worker <a ready ticket>` and `planner beta --goal <g>` are refused in the ceiling's words, no `worker-slots` act is logged, and `metrics` shows `memory-full` and no idle-capacity. With the limit at 9 (room left): the same refusals, and `memory-full`. With the limit at 3 (no room): the same refusals, and neither `memory-full` nor idle-capacity (nothing would start anyway). *Check:* the same test.
4. **No number, no null arithmetic.** In the test: the settings JSON from a project with neither key has both present and `null` (so `SETTINGS_DEFAULTS` carries `null`, not a number); `devteam.mjs`'s `SETTINGS_DEFAULTS` text has `max_active_tickets: null` and `max_active_per_component: null`; and a scan of `devteam.mjs` (comment lines skipped) finds no comparison or arithmetic operator (`<`, `<=`, `>`, `>=`, `+`, `-`, `*`, `/`) directly beside a `.max_active_tickets` or `.max_active_per_component` read. Behaviourally: with no limit, no output of `ready`, `metrics`, `status`, `hello` or `dashboard-data` contains `/null` or `/undefined`, and an invalid value (`0`, `-1`, `2.5`, `"3"`) fails `validate` with the words in item 3 above and yields no idle-capacity. *Check:* the same test.
5. **Docs say no limit.** `supervisor.md` says there is no limit by default (§5's Caps sentence; §4's idle-capacity row, "under caps" becomes "under a limit, if one is set"; the memory-full row; §3's incident-slots line, "past `max_active_tickets` when one is set"): the planner's graph decides what runs together, `machine_memory_ceiling` guards the machine, and the owner may set a limit. README names no default for either key (at de07a84 `grep -n max_active README.md` finds nothing); it changes only if a sentence there implies a cap. `goalForecast`'s comment in devteam.mjs says "with the worker limit, if any". The PR body has a `## Migration` section for the release notes: "`max_active_tickets` and `max_active_per_component` no longer default to 5 and 2: unset means no limit; the graph and `machine_memory_ceiling` pace the work. An instance that wants a limit sets one through the settings chore: `chore start settings`; `settings set max_active_tickets <n>`; `chore pr settings --title "settings: max_active_tickets <n>"`; `merge --chore settings`." *Check:* the diff and the PR body; `check-ticket` with that body.
6. **planning.md.** §7's "start `max_active_tickets` at 2 or 3 … and raise it when `waves` shows real width" becomes: the graph decides width; set a limit only for a reason (an adopted codebase's hotspots are one), through the settings chore, and lift it the same way (`settings set max_active_tickets none`) once `waves` shows real width. §1's forecast paragraph: "at the current worker slots" becomes "with the worker limit, if one is set", and "add worker slots" becomes "lift or raise the worker limit". *Check:* the diff.
7. **Changing a limit goes through the settings chore.** `supervisor.md` §5 and the memory-full row say the supervisor sets, lowers or lifts a limit with `settings set` in the settings chore (`chore start settings`, `settings set max_active_tickets <n|none>`, `chore pr settings --title …`, `merge --chore settings`), never a working-tree edit, which no longer takes effect. The command words are kit-85's as they land. *Check:* the diff.

## Contracts

Consumed from kit-85, as landed: `capOf`, its no-limit words in `ready`, idle-capacity, memory-full and the forecast; the pin of both keys to main; `settings set <key> <n|none>`; the settings chore commands. If any lands differently from its spec, kit-86 follows what landed and records it in the plan.

Provided: `status --json` `limits`, `hello --json` `fleet.limit` and `fleet.limit_per_component` (new fields); `ready --json` and `dashboard-data` `caps` may now be `null` by default.

## Edge cases

- `0 < null` is `false`, `0 >= null` is `true`, `n < undefined` is `false`: a raw comparison would silently mean "no capacity". Check 4 guards against it, statically and by output.
- A project that set either key explicitly keeps its value.
- An instance that never set either key goes from 5/2 to no limit on upgrade; the memory ceiling still stops a full machine; the Migration section says how to keep a limit.
- `incident_slots` with no total limit: there is no cap to run past; fix tickets are still listed first.
- The per-component limit set and the total unset (or the reverse): each applies on its own.

## Out of scope

- How the dashboard's Settings page shows "No limit" (kit-87).
- `max_active_planners` (already `null` by default).
- Enforcing either limit at `worker` start: the kit doesn't today (the supervisor schedules from `ready`), and this ticket doesn't add it.
- The forecast's slot count with no limit (kit-85 decides it; kit-86 only updates `chain.mjs:94` to what it prints).
