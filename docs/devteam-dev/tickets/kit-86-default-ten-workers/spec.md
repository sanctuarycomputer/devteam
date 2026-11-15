# kit-86 no worker limit by default: spec

Ticket: `kit-86-default-ten-workers` (feature `dashboard-cleanup`, serves DCL-S2, size S, risk normal). Depends on `kit-85-owner-setting-workers` (unmerged at this writing: build waits for it and for approve-plan). Title as rewritten: "No worker limit by default: max_active_tickets and max_active_per_component are unset unless the owner sets one; the plan's graph and the memory ceiling pace the work".

## Intent

Today the kit holds a fleet to 5 workers at once (`max_active_tickets`) and 2 per component (`max_active_per_component`) unless the project says otherwise. The owner's word (thread t-20261115-194652602-owner) is that neither limit exists by default: the planner's graph (`depends_on` and `touches`) already decides what may run together, and `machine_memory_ceiling` already keeps the machine from filling up. A project, or its owner, may still set either limit, and then it holds exactly as it does today.

So `SETTINGS_DEFAULTS` carries no number for either key, every place the kit reads them treats unset (missing or `null`) as "no limit", and the docs say so.

## Rulings

- m-20261115-194953509-supervisor: plan ahead (spec and plan now; build only after kit-85 merges and approve-plan is recorded). Briefs carry lessons k-20261115-182656232 (scripts in files, guarded `rm -rf`, private `mktemp -d`, `timeout` on everything, no address-space cap on node), k-20261115-080753394 (a kit run outside the tests gets its own `HOME`, a `DEVTEAM_HUB_PORT` away from 4320, every `DEVTEAM_*` unset) and k-20261115-164245020 (judge a check by its exit code, never by piped output). Run only the files touched, at `--test-concurrency=2`.
- m-20261115-195217818-supervisor: scope change from the owner, replacing "5 to 10": no limit by default, total or per component; the graph and the memory ceiling pace the work; every reader treats unset as no limit.
- m-20261115-195249403-supervisor (re my m-20261115-195219809): `test/memory-ceiling.test.mjs`, `test/fixtures/g1/ready.txt` and `test/fixtures/g1/dashboard-data.txt` are added to touches. Each pinned line moves from 5 to no limit (`active workers: 0` with no cap shown; `caps.max_active_tickets` `null`). Change only those lines; G1 keeps no explicit setting.
- m-20261115-195400283-supervisor (re my m-20261115-195326688): `docs/devteam/dashboard/index.html` and `test/lib/chain.mjs` are added to touches: `index.html:4667` (the Overview stat `workers active`, which would read `0/null`) and `chain.mjs:94` (pins `goal forecast`'s "at 5 slots"). Keep the `index.html` change to that one line: kit-87 rebuilds the page after this ticket, and now follows it.

## Every reader of the two keys, before and after

| # | Where (devteam.mjs at de07a84) | Today | After, when the key is unset | When set (say 3) |
|---|---|---|---|---|
| R0 | `SETTINGS_DEFAULTS` (527-528) | `5`, `2` | `null`, `null`, with a comment: unset is no limit; the graph and the memory ceiling pace the work | n/a |
| R1 | `ready` text (3836) | `active workers: 0/5` (+ `(+1 for fix tickets)` while an incident is open) | `active workers: 0` (no cap, no incident-slot suffix: there is no cap for fix tickets to run past) | `active workers: 0/3` and the suffix, as today |
| R2 | `ready` text, per row (3841) | `(component at cap)` when a component has 2 | never printed | printed at 3, as today |
| R3 | `ready --json` `caps` (3835) | `5`, `2` | `null`, `null` | `3` |
| R4 | `metrics` idle-capacity, fix-slot line (11568) | fires when active is at the cap and an incident slot is free | never fires: with no cap every ready ticket, fix tickets included, is in the plain idle-capacity line (R5), which already lists fix tickets first | as today |
| R5 | `metrics` idle-capacity (11569) | `active < 5`; detail `0/5 workers active` | fires whenever a ticket is ready (and memory isn't full, the fleet isn't drained); detail `0 workers active, no limit`; suggestion lists the ready tickets as today | as today, `0/3 workers active` |
| R6 | `metrics` memory-full (11571) | `… 0/5 workers active`; suggestion "…if this keeps happening, lower max_active_tickets, your own setting" | `… 0 workers active, no limit`; suggestion "start nothing new until some finish (a resume is fine); if this keeps happening, set or lower max_active_tickets through the settings chore" | `0/3 workers active`, same suggestion |
| R7 | `goalForecast` slots (10301) | `Math.max(1, max_active_tickets ?? 1)`: unset would mean 1 slot | `slots: null`; an unplanned milestone's waves are `m.tickets ? 1 : 0` (its tickets may all run at once); planned features use the roadmap's `waves_left` as today | `ceil(tickets / 3)` as today |
| R8 | `forecastText` (10326) | `… waves to here at 5 slots` | `… waves to here with no worker limit` | `at 3 slots` |
| R9 | `dashboard-data` `caps` (11835) | `{ max_active_tickets: 5 }` | `{ max_active_tickets: null }` (same shape; G1 golden line 7 becomes `null`) | `3` |
| R10 | `status --json` | no limit reported | adds `limits: { max_active_tickets: null, max_active_per_component: null }` | the numbers |
| R11 | `hello` | no limit reported | `--json` adds `fleet.limit: null` (and `fleet.limit_per_component: null`); the text line ends `, N session(s), no worker limit` | `fleet.limit: 3`; text `, N session(s), at most 3 workers` |
| R12 | `index.html` Overview stat (4667; one line) | `0/5` | `0` | `0/3` |

`status` text is left as it is: G1's `status.txt` golden stays byte for byte (the supervisor's ruling: change only the named lines), and `status --json` carries the limit (R10). `incident_slots` keeps its meaning wherever there is a cap; with none it has nothing to run past and changes nothing.

**One reader, one rule.** All of R1 to R11 read the limits through one helper, `workerLimits(s)`, which returns `{ total, per_component }`, each a number or `null`, and one predicate `underLimit(n, limit)` (`limit == null || n < limit`). No reader compares a count with `s.max_active_tickets` or `s.max_active_per_component` directly, so none compares with `null` (where `0 < null` is false and `0 >= null` true: the bug this ticket must not ship). The test enforces it by scanning `devteam.mjs` (below).

**What counts as set.** A positive integer. `null` or a missing key is no limit. Any other value (0, a negative, a fraction, a string) is not a usable limit: the helper treats it as no limit, and `validate` reports it as a settings problem ("settings.max_active_tickets is 0: a limit is a whole number of 1 or more, or null for none; until it is, there is no limit"), as it already does for `machine_memory_ceiling`. kit-85's owner allowlist is 1 to 20, so the owner can't write one of these; only a hand edit can.

## Acceptance checks (the done-whens)

1. **No limit by default.** `test/default-workers.test.mjs`, in a fleet fixture whose settings set neither key: 7 tickets in one component, 6 of them with a worker (a `phase spec` line each, so 6 active, past both old defaults), 1 more ready. `ready` prints `active workers: 6` with no `/`, never `(component at cap)`; `ready --json` `caps` are `null`; `metrics --json` has an idle-capacity finding for the 1 ready ticket with detail `6 workers active, no limit`; `status --json` `limits` are both `null`; `hello --json` `fleet.limit` is `null` and `hello` text says `no worker limit`. The same holds with each key written explicitly as `null`. *Check:* the test passes in CI (test.yml, every job green at the head).
2. **A set limit holds as today.** Same fixture, settings on main set `max_active_tickets: 3` and `max_active_per_component: 3` (landed on main, since kit-85 pins the value to main's): `ready` prints `active workers: 6/3` and `(component at cap)`; no idle-capacity finding; `ready --json` `caps` are `3`, `3`; `hello --json` `fleet.limit` is `3`. And `max_active_tickets: 7` with `max_active_per_component` unset: idle-capacity shows `6/7 workers active`, no `(component at cap)`. *Check:* the same test.
3. **The memory ceiling still refuses.** With no limit, and memory at the ceiling (the same fake cgroup `test/memory-ceiling.test.mjs` uses), `worker <id>` and `planner <f> --goal <g>` are refused with the ceiling's words and nothing logged; `metrics` shows `memory-full` (detail `… 6 workers active, no limit`), not idle-capacity. With a limit of 3 set, still refused. *Check:* the same test.
4. **No number, no null comparison.** The test reads `SETTINGS_DEFAULTS` from the kit (via `settings --get` in a project with neither key: prints `null`) and scans `devteam.mjs`: the only lines that read `.max_active_tickets` or `.max_active_per_component` off a settings object are inside `workerLimits`. *Check:* the same test.
5. **Docs say no limit.** `supervisor.md` (§5's Caps sentence, the memory-full row in §4, §3's incident-slots line) says there is no limit by default: the planner's graph decides what runs together, `machine_memory_ceiling` guards the machine, and the owner may set a limit. README names no default for either key today (checked: `grep -n max_active README.md` finds nothing), so it is unchanged unless a sentence there implies a cap. The PR body has a `## Migration` section for the release notes: "max_active_tickets and max_active_per_component no longer default to 5 and 2: unset means no limit. An instance that relied on the defaults and wants a limit sets one through the settings chore (chore start settings; settings set max_active_tickets <n>; chore pr settings --title "settings: max_active_tickets <n>"; merge --chore settings)." *Check:* the diff and the PR body; `check-ticket` with that body.
6. **planning.md §7.** "start `max_active_tickets` at 2 or 3 … and raise it when `waves` shows real width" becomes: the graph decides width; set a limit only for a reason (an adopted codebase's hotspots are one: then set it through the settings chore, and lift it the same way once `waves` shows real width). §1's forecast paragraph's "add worker slots" becomes "lift or raise the worker limit, if one is set". *Check:* the diff.
7. **Changing a limit goes through the settings chore.** `supervisor.md` §5 and the memory-full row say the supervisor sets, lowers or lifts a limit with `settings set` in the settings chore (`chore start settings`, `settings set …`, `chore pr settings --title …`, `merge --chore settings`), never a working-tree edit, which no longer takes effect (kit-85). *Check:* the diff.

## Contracts

Consumed: kit-85's settings chore (`chore start settings`, `settings set <key> <n>`, `chore pr settings`, `merge --chore settings`) and its pinning of `max_active_tickets` to main's `settings.md`. If kit-85 lands with different command words, the docs follow what landed. Whether `settings set` can write `null` (lift a limit) is kit-85's; if it can't, the docs say "lift it the same way" only if it can, and otherwise say to set a high number, and I tell the supervisor (a follow-up for kit-85's allowlist, not this ticket's).

Provided: the JSON shapes above (R3, R9 unchanged in shape, values now possibly `null`; R10 and R11 new fields). kit-85's `/api/data` label "the kit's default" for an unset key now means "no limit"; the dashboard text for that is kit-87's.

## Edge cases

- `0 < null` is `false` and `0 >= null` is `true` in JS: a reader left comparing with `null` would silently mean "no capacity". Check 4 exists for this.
- A project that set the key to `5` explicitly keeps 5: nothing in its settings changes.
- An instance that never set either key goes from 5/2 to no limit on upgrade. The memory ceiling still stops a full machine; the Migration section says how to keep a limit.
- `incident_slots` with no total limit: no cap to run past; the fix-slot idle-capacity line (R4) never fires; fix tickets are still listed first by `ready`.
- The forecast with no limit counts an unplanned milestone as one wave: optimistic by design until it is planned, at which point the graph's waves count.
- `max_active_per_component` set and the total unset (or the reverse): each applies on its own.

## Out of scope

- How the dashboard shows "no limit" in kit-85's Settings row ("the kit's default"): kit-85 and kit-87.
- Whether the owner's allowlist (1 to 20) should accept "no limit": kit-85's; raised to the supervisor if `settings set` can't write `null`.
- `max_active_planners` (already `null` by default).
- Enforcing either limit at `worker` start: the kit doesn't today (the supervisor schedules from `ready`), and this ticket doesn't add it.
