# kit-213 steady timing bounds: spec

Ticket: `kit-213-steady-timing-bounds` (feature `tests-light`, serves TESTS-S3, size S, risk normal). Depends on kit-216 (`test-stress.yml`), merged at 1769b43. Touches `test/bounds.test.mjs` and `test/speed.test.mjs` only.

## Intent

The bounds in these two files must hold on a loaded machine and still catch a real slowdown. Today four of them are absolute milliseconds (or milliseconds over a reference), which a busy runner can break and which a 10x slowdown of the cheap parts would not. Each becomes a count of operations, or a ratio against a reference workload timed in the same process just before it, so load slows both sides. The design's line (D, "Steady timings"): "Where the thing being bounded is a count, the bound counts operations. Where it really is time, the bound is a ratio against a reference workload measured in the same process, just before."

Separately, the after hooks in `test/speed.test.mjs` remove folders before they stop what the test started. Node runs a test's after hooks in the order they were registered and stops at the first one that throws, so a failing removal leaves the dashboard (and its fake tmux) running. They are reordered: stops first, then removals, each step on its own.

## Rulings

- m-20261115-183218194-supervisor: trial a-20261115-074130886. One combined spec and plan review (spec-1.md and plan-1.md from one fresh session), then approve-spec and approve-plan asked for together. Lessons k-20261115-182656232, k-20261115-080753394 and k-20261115-164245020 go in every subagent brief. Only the files touched run on the box, at `--test-concurrency=2`.
  - k-20261115-182656232: multi-step shell in script files; no unguarded `rm -rf` of a variable path (`"${S:?}/${n:?}"`); a private `mktemp -d` scratch; no `/dev/zero` or `/dev/urandom` input; no interactive client left in the background; `timeout` on everything; never an address-space cap (`prlimit --as`, `ulimit -v`) on node or the test runner.
  - k-20261115-080753394: any kit run outside the tests gets its own `HOME`, a `DEVTEAM_HUB_PORT` away from 4320, and every `DEVTEAM_*` unset.
  - k-20261115-164245020: judge a check by its exit code, never by piped output.

## Every bound, before and after (done-when 1)

What I measured on the box (32 cores, load about 10, Node 18, times in ms, best of 3 to 5) is in the right-hand column; the "10x" column is the same measurement on a scratch copy of the kit whose bounded code was patched to do ten times its work.

| # | Test | Before | After | Measured now / with 10x |
|---|---|---|---|---|
| B1 | coverage: 50k paths x 30 globs | `ms < 500` (absolute) | **count**: every distinct glob compiled exactly once (31: 30 component globs and the kit's line), counted by wrapping the vm context's `RegExp` constructor. **ratio**: `coverage()` time / a reference time `< 8`, where the reference tests the same 50k paths against the same 31 globs as plain RegExps written in the test (code independent of the kit's) | coverage 160-200 / ref 45-100 = 1.7-4.0 / with 10x matching: 1100-1290 / 43-50 = about 24 |
| B2 | owner suggestions over 50k paths | `ms2 < 500` (absolute) | **count**: `ownerOf` (the test's own function, passed in) is asked about no path twice, and at most once per distinct folder holding an owned path (1,809 folders; the current code asks 900 times) | 10x the asks: 9,000 > 1,809, and every path asked twice |
| B3 | the Inbox order, 200 questions | `ms < base + 1500` (`base` = `goal list` on the same log) | **ratio**: `questions --json` time / `goal list` time `< 2.25`, both CLI runs timed in the test process, interleaved, best of 5 each | 125-139 / 99-105 = 1.25-1.4 / with the whole read-and-rank done 10x: 362 / 104 = 3.5 |
| B4 | search, about six million characters | `ms < base + 1000` (`base` = `knowledge --status accepted`) | **ratio**: `search` time / `knowledge --status accepted` time `< 8`, interleaved, best of 3 each | 1195-1425 / 355-400 = about 3.6 / with search index and rank done 10x: 7056-7790 / 342-379 = about 20 |
| B5 | dashboard answer: the reply comes before the supervisor is typed to | `Date.now() - t0 < 15000` (absolute) | **order (a count)**: when the reply arrives, no `send-keys` the fake tmux started has ended or been killed: the fake records each `send-keys` pid as it starts, and every recorded pid is still alive at the reply. With a kit that waited for the typing, tmux's own 30 s limit kills that `send-keys` before the reply, so its pid is gone. `release` not yet written stays asserted | — |
| B6 | git processes: refresh and answer, 12 vs 24 tickets | counts already (`<= 2*4`, equal, `<= 12`) | unchanged | — |

Left as they are, and named in verification.md as hang guards, not bounds: the per-test `{ timeout: 120000 }` and `{ timeout: 600000 }`, `AbortSignal.timeout(60000)` on the answer fetch, `until()`'s default wait, and `startDashboard`'s stop wait in `test/lib/kit.mjs`. None decides pass or fail on a healthy run; each turns a hang into a failure.

Ratios use one helper: the reference and the workload run alternately, n times each, and the best time of each is kept. A burst of load hits one run, not the best of several, and steady load slows both sides alike. The ratio bounds sit about 2x above the worst ratio measured and at least 1.5x below the 10x ratio.

## Acceptance checks (the done-whens)

1. **No absolute millisecond limit remains.** Every bound in both files is a count or a same-process ratio, as in the table above. *Check:* verification.md lists each bound before and after (the table, with line numbers at the final head), and a grep of both files for `Date.now()`, `ms <`, `< base +` finds no bound left.
2. **Holds under load on a CI runner.** `gh workflow run test-stress.yml --ref ticket/kit-213-steady-timing-bounds -f files="test/bounds.test.mjs test/speed.test.mjs" -f repeat=3 -f load=4` completes green. *Check:* its run id, conclusion and summary table quoted in verification.md, judged by `gh run view <id> --json conclusion` (exit code and field, not piped text).
3. **Each bound still catches 10x.** One temporary patch per bound, on a scratch copy of the kit (never committed): B1 matching 10x (ratio) and the glob cache turned off (count); B2 `ownerSuggestions` asking 10x; B3 `cmdQuestions` reading and ranking 10x; B4 `cmdSearch` indexing and ranking 10x; B5 `nudgeSupervisor` typing at once instead of after the reply. Each run of the touched file against the patched copy fails on that bound's assertion. *Check:* verification.md names each patch (the exact substitution), the command, the exit code and the failing assertion's message.
4. **test.yml green on every job at the PR head.** *Check:* `gate ci -- <the real gh command>` at the head; run id and per-job conclusions in verification.md.
5. **After hooks stop before they remove.** In `test/speed.test.mjs`, every test that starts a process (the dashboard test: the dashboard, its watcher and the fake tmux in its group; the git-processes test: each fleet fixture's tmux server) cleans up in one place, stops first and folders last, each step on its own: a step that throws is remembered and the rest still run, and the first error is thrown at the end so the failure still shows. The git-processes test also no longer leaks a fixture made before a later fixture's setup throws. *Check:* a temporary patch makes the dashboard test's folder removal throw and prints the dashboard's, its watcher's and every fake `send-keys` pid; after the test file exits (it fails, as it should), `ps -p` finds none of those pids. Recorded in verification.md.

## Contracts

None provided or consumed beyond what the tests already read: `coverageFns()`, `fleetFixture()`, `startDashboard()` and `gitShim()` from `test/lib/kit.mjs` (unchanged), and the kit's CLI output (`questions --json`, `search`, `goal list`, `knowledge`).

## Edge cases

- **The vm context's `RegExp`.** `globToRegex` calls `new RegExp(...)`, a global lookup at call time, so replacing `globalThis.RegExp` in the context with a counting `Proxy` counts compiles. Regex literals in the kit's code (`escRe`, `hasWild`) don't go through it and aren't counted. The proxy is installed through the context's own `Function` (`coverage.constructor`), so `test/lib/kit.mjs` is unchanged. The count is taken over one fresh `coverageFns()` and one `coverage()` call; later timing runs reuse the cache, as the kit does.
- **The coverage reference must not share the kit's code.** If it used `pathMatches`, a slower matcher would slow both sides and the ratio would hide it. The reference's regexes are written in the test, and their match counts double as an oracle: the paths no component regex matches are exactly `cov.unowned`.
- **B3 measures CLI processes.** Start-up dominates (about 100 ms of 130), so ranking alone made 10x slower moves the ratio only from 1.3 to about 1.75. The 10x check is therefore on the whole command's own work (read, fold and rank). This is the work the bound always covered: the old bound was 1,500 ms over the log read, which no 10x slowdown of 30 ms reaches.
- **B5 when no `send-keys` has started yet at the reply.** Then the property holds trivially (the reply came before any typing), and the test's later `until()` still requires the supervisor to be told after `release`.
- **pid reuse.** Between the fake's start and the reply is a few hundred ms; reuse of that pid in that window is not a practical concern.
- **The search test's length.** Under 4 burners a search may take 3 s or more, so B4 stays at 3 runs of each side (as now), not 5.

## Out of scope

- `test/run.mjs`'s `alone` list still runs `bounds.test.mjs` alone. With ratios it need not, but `run.mjs` is outside this ticket's touches; the file's header comment says so and leaves the change to a later ticket.
- `test/lib/kit.mjs` (fixtures, `startDashboard`'s own stop) and the kit's code are unchanged.
- The dashboard and Chrome test files (kit-214) and the operator-thread and pane-question files (kit-211) have their own after-hook fixes.
