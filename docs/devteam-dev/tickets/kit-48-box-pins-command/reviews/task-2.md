# Task review, Task 2 (the upstream reader and `check`)

- Reviewer: task-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: 95ac0fcb7d02b5ee8158c9067fcb15447f78ef53

I read `git diff cf48df9 95ac0fc` for `docs/devteam/scripts/devteam.mjs` and `test/machine.test.mjs`, then checked it against plan.md Task 2 and spec.md (`check`, Security, Edge cases). I also read the T1 helpers it consumes at 95ac0fc (`safe`, `versionParts`, `newer`, `pinForm`, `readPins`, `pinsFile`, `pinsEnv`, `pinsAsync`). I ran the five `check` tests from a `git archive 95ac0fc` copy on Node v18.20.4, and all pass. Against a copy of the kit in a scratch kit-own repo I then ran:
- `check` and `check --json` against the real npm, PyPI and GitHub APIs, anonymously. Both work, exit 1, and gh and ttyd match `releases/latest` (v2.104.0, 1.7.7).
- a probe server for each failure mode:
  - a 404 gives `HTTP 404`.
  - a 200 with an HTML body gives `bad JSON`.
  - a C1 `\u009b` in the PyPI version gives `not a release: ?`.
  - a list of nulls, numbers and non-string tags, or an empty list, gives `no release` and exit 3.
  - a server that never answers gives `unreachable (?)` after 15.1 s.
  - a body that stalls after its headers gives `bad JSON` after 15.1 s.
- a pin that is not a plain version.

What holds:
- The three URL shapes match the real APIs. npm takes `%2f` (unencoded works too). PyPI `info.version` and GitHub `releases?per_page=30` are right, and the GitHub headers are the plan's.
- The draft and prerelease filters work, and the release is chosen as the highest by `newer`, not the first entry. The prerelease test fails for each wrong variant: no filter (2.0.0), one filter only, or first-match (1.6.9 reads as current).
- `GH_TOKEN` is added only in the GitHub branch. The token test checks every hit both with the token set and without it, and `pinsEnv` clears `GH_TOKEN` and `GITHUB_TOKEN`.
- Every `why` is our own words plus a number or a `safe()` code. Pinned and latest pass through `safe`, and hold reasons pass through `holdText`. The `\u001b` test fails against a raw print.
- The exit codes are right: 1 for stale, 3 for unknown, 0, and 2 for problems or a missing file. Both `--json` shapes are the spec's.
- `fetch`, `AbortSignal.timeout`, `closeAllConnections?.()` and the AggregateError code path all work on Node 18.
- The fixture server listens on 127.0.0.1:0, is `unref()`'d, and is closed in `t.after`. A non-2xx body left unread did not delay exit (about 230 ms).

One finding blocks: a pin that is not a plain version always reads `current` (F2).

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | plan T2 Step 3 ("a fetch error `unreachable (<code or name>)`"); spec Edge cases (a why is "our own words plus ... an error code") | devteam.mjs `upstreamJson`, `safe(... 'timed out' ...)` | The 15 s timeout reports `unreachable (?)`. `safe` allows only `[\w.+-]`, so the space in `timed out` turns the whole word into `?`. I reproduced this with a server that never answers. Put the fixed word outside `safe`, as in `` e?.name === 'TimeoutError' ? 'unreachable (timed out)' : `unreachable (${safe(code)})` ``, or use `timeout`. | fixed: a timeout reads 'unreachable (timed out)' (our words, not filtered); tested with DEVTEAM_PINS_TIMEOUT_MS |
| F2 | Important | spec check ("`<name>: stale <pinned> -> <latest>`"; a pin newer than upstream reads current); quality §3 (a real defect with a plausible failure path) | devteam.mjs `checkPins` (`newer(latest, version)`); T1 `newer` returns false when either side fails `versionParts` | A pin that is not a plain version always reads `current`, however far upstream has moved. `readPins` accepts any non-empty value, and `newer` is false for an unparseable side. With `ARG UV_VERSION=0.13.7-rc1`, `verify` says ok, and `check` against the real API prints `uv: current 0.13.7-rc1` while uv is at 0.13.8. Someone trying out a prerelease pin is plausible, and check would then hide it for good. T3 inherits the same problem, since bump skips unless `newer`. Report it as `unknown pin <safe(v)> is not a release` (exit 3), or make it a verify problem in T1 so check refuses it with exit 2. Add a test either way. | fixed: a _VERSION that isn't a plain version is a verify problem, so check and bump refuse it; tested |
| F3 | Minor | spec check ("Exit 1 when any tool is stale; else 3 when any is unknown") | machine.test.mjs, the check tests | No test has a stale tool and an unknown one in the same run with the exit asserted. A test with both would fail if the precedence were swapped (3 before 1), and none does. The second run in the unreachable test has both (npm is stale by default, mise answers 500) but checks only the mise line. Assert `status === 1` there. Also assert the exit of the stale `--json` run (`sj`), which is not checked. | fixed: a test with one stale and several unknown asserts exit 1, text and --json |
| F4 | Suggestion | | devteam.mjs `upstreamJson`, `res.json()` catch | A body that stalls past the timeout reports `bad JSON`, because the abort rejects `res.json()`. If the rejection's name is `TimeoutError`, give the timeout's why. | fixed: answer and body share one deadline; a stalled body reads 'unreachable (timed out)' |
| F5 | Suggestion | | machine.test.mjs `upstream()` | The fixture decodes the npm path and ignores the query string and headers. It would accept an unencoded scoped name, a missing `per_page=30`, or no `accept` header (the real APIs take all three, so this is low risk). `no release` and `bad JSON`, both spec'd whys, are not tested, and neither is the timeout. A list of prereleases only, plus one 200 with a non-JSON body, would cover the first two cheaply. | fixed: the fixture refuses a request without %2f, per_page=30 or the accept header; no release, bad JSON and a timeout tested |
| F6 | Suggestion | plan T2 Interfaces (`latestOf(tool, pinned)`) | devteam.mjs `latestOf(tool)` | The signature has no `pinned`. Nothing needs it, but state this in the plan or in T3's notes so T3 is not written against the plan's signature. | fixed: ledgered as a ruling (latestOf(tool), the pin not needed); T3 uses it so |

Verdict: CHANGES 95ac0fcb7d02b5ee8158c9067fcb15447f78ef53
