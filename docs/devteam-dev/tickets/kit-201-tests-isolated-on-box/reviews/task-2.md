# Task 2 review, pass 1

- Reviewer: task-reviewer (fresh subagent, claude-opus)
- Reviewed: d13898bb5997082025927a064a46189cb39d6674

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T2-1 | Minor | spec AC2 ("fails with files in the decoy") | test/machine.test.mjs:137-145 (decoy test) | The test asserts the child's exit status before it lists the decoy. When the env leaks, the child's own test fails first: with DEVTEAM_RUN kept, the kit writes into the decoy instead of the project's run folder, and the incident test throws `ENOENT … docs/devteam/run/accounts.json`. So the outer failure shows the child's TAP, not the files in the decoy. The decoy check only runs when the child passes. The test still fails under the leak, so the proof holds. But its failure message doesn't say what the spec says it proves. Either list the decoy first, or add `filesIn(decoy)` to the status assertion's message. | fixed in Task 3: the decoy listing is asserted before the child's status |
| T2-2 | Minor | spec AC2 (the failing run "is recorded in reviews/task-2.md or verification.md"); plan Task 2 Step 2 | ticket records | No pre-fix failing run was recorded: there was no task-2.md and no verification.md at this head. This review records one (see Mutations below), which meets the spec's "or reviews/task-2.md". | fixed: the reviewer's mutation run is the pre-fix record |
| T2-3 | Suggestion | none | test/gateway.test.mjs:320, 1256, 1309, 1484 | `delete env.DEVTEAM_ROLE` is now redundant, because the scrub already removed it from `process.env`. The spec only names the loops at 723 and 764, so leaving these is in scope. They are harmless. | wont-fix: harmless, outside the spec's scope |

No Critical or Important findings. Checked:

- **The scrub's reach.**
  - Every test file that spawns the kit imports lib/kit.mjs, now including gateway.test.mjs. gitleaks.test.mjs doesn't import it, but it spawns only gitleaks, never the kit.
  - ES import order: operator-threads imports `../cloud/gateway.mjs`, which reads `DEVTEAM_HUB_PORT` and `DEVTEAM_PORT_BASE` at its top level. It is imported after lib/kit.mjs, so it sees the scrubbed, re-set values. gateway.test.mjs loads gateway.mjs by dynamic import, after its own settings.
  - cli.mjs is evaluated before kit.mjs's body, but its warm runners start lazily inside `runNode`, after the scrub. cli-runner.mjs replaces its env wholesale with the request's, which is built from the scrubbed `process.env`.
  - kit.test.mjs's forks get `{ ...process.env, DEVTEAM_FORK }`. fork.mjs → chain.mjs → kit.mjs re-scrubs, and `DEVTEAM_FORK` survives because it matches `HARNESS_ENV`.
  - chain.mjs builds its env from `process.env` plus role overlays, so it inherits the scrub.
  - No test sets `DEVTEAM_ROLE`, `TICKET`, `FEATURE`, `RUN`, `HOME`, `TMUX` or `TMUX_PANE` on `process.env` after import. No file imports kit.mjs dynamically after setting env, apart from the new env-names test, which does so on purpose.
- **Harness knobs.** Every `process.env.DEVTEAM_*` read in test/ is one of these:
  - a `HARNESS_ENV` member (`TEST_KEEP`, `TEST_COLD`, `TEST_GITLEAKS`, `TEST_READ_DELAY_MS`, `FORK`, `FORK_AUDIT`, `G1_RECORD`, `CGROUP`, `MEMINFO`);
  - a value the kit or the test sets itself (`HUB_PORT`, `PORT_BASE`, `CSWAP`, `SUPERVISOR_UP`, `BOX`, `HUB_RETRY_MS`, `CLAIM_TOKEN`, `PUBLIC_MAX`, `GATE_TICKET`);
  - a fixture script's input from the kit (`PARAMS`, `SINCE`).

  test.yml sets only `DEVTEAM_CGROUP`, `DEVTEAM_MEMINFO` and `DEVTEAM_TEST_GITLEAKS`, and all three survive the scrub. Nothing was deleted wrongly.
- **What removing the per-file lists means.** For every list that went, the scrub deletes a superset:
  - operator-threads' `DEVTEAM_OPERATOR_COMMAND` and `DEVTEAM_PUBLIC_URL`;
  - machine's `ROLE`, `TICKET`, `FEATURE`, `HOME` and `TMUX*`;
  - hub-overview's and operator-threads' hubFixture lists;
  - gateway's two loops;
  - fleetFixture's list.

  Every value a test sets afterwards, such as `DEVTEAM_OPERATOR_COMMAND: ''`, `DEVTEAM_PUBLIC_URL` or the box key, is added after the spread, so it still wins.
- **hub-overview's `HOME: base`.** On Node 18 the Chrome test skips ("needs … WebSocket"), so I ran it on Node 22.23.4. It passed (`# pass 1`). bareProject's git commits pass `-c user.email/name` and run with the test's own env. Chrome's profile is its own.
- **gateway.test.mjs and lib/kit.mjs.** Its own `DEVTEAM_HUB_PORT` and `PORT_BASE` are set after the import and win. The real-hub test's `TMUX_TMPDIR` (`…/real-hub-*/tmux`) is not `dt-tmux-*`, so the shim refuses tmux outright, which is what that test wants. All 69 tests pass. The comment at its l.20 is updated. test/lib/ports.mjs:22 still says the gateway claims no block; it is outside touches, and plan Task 3 Step 5 notes it for the PR body.
- **The env-names test.** It asserts the exact non-harness set, and asserts that `DEVTEAM_FORK`, `TEST_KEEP`, `CGROUP` and `MEMINFO` survive. That covers Review Focus 3 and 4.
- **The decoy test.** It deletes `NODE_TEST_CONTEXT`. It asserts `# pass 1` and `# fail 0`, exactly one `ok … status says at a glance` line with no SKIP, and every other line filtered by name (the plan's reading of `# skip 0`). The child's pattern excludes the decoy test itself, so it doesn't recurse.
- **T1-1.** `boxFns` now makes one root and one exit listener per process.
- **AC1 grep.** The only matches are machine:14 and operator-threads:19 (now only `CLAUDECODE|CLAUDE_*`) and gateway:94 (the header cleanup). The second grep in plan Step 2b finds nothing.

Ran, each via run-isolated.sh, one file at a time:

| Run | Result |
|---|---|
| this worktree, `--test-name-pattern='importing the test helper\|decoy' test/machine.test.mjs` | `# pass 2`, `# fail 0` |
| this worktree, `test/gateway.test.mjs` whole | 69/69 pass |
| this worktree, `test/hub-overview.test.mjs` (Node 18) | 2 pass, 1 skip (Chrome needs WebSocket) |
| the same file on Node 22.23.4, `--test-name-pattern='Overview in Chrome'` | `# pass 1`, `# fail 0` |

Mutations: each ran in a `git archive` copy of d13898b under my scratchpad (run-isolated.sh at the same relative place), with the two new machine tests.

| Copy | Change | Env-names test | Decoy test |
|---|---|---|---|
| base | none | pass | pass |
| norun | the scrub keeps `DEVTEAM_RUN` | FAIL (`+ 'DEVTEAM_RUN'`) | FAIL |
| noscrub | the pre-fix scrub: delete only `DEVTEAM_HOME\|ROLE\|TICKET\|FEATURE` and `TMUX*` | FAIL (`+ DEVTEAM_PREVIEWS, PUBLIC_URL, RUN, SUPERVISOR`) | FAIL |

In both failing copies, the decoy test failed at the child's status: its incident test failed with `ENOENT …/statused/docs/devteam/run/accounts.json`, because the kit wrote into the decoy's run folder instead.

I added a print before the status assertion in the norun copy. It showed the decoy holding `["run","run/log","run/log/owner-2026-11.jsonl","run/log/supervisor-2026-11.jsonl"]`. This is the incident, reproduced against the decoy. It is the record of the failing run that spec AC2 asks for.

Verdict: APPROVE d13898bb5997082025927a064a46189cb39d6674
