# Task review, T1 (the split), pass 1

- Reviewer: fresh subagent of the kit-212 worker, task T1 review (claude-opus-5-5)
- Reviewed: 85b6447f276106ed7036cb339e019edef39127ff (split commit 38399c8 plus names-1 and the run tools, diff against de07a84)

I read spec.md, plan.md, the tools (split.mjs, split-plan.mjs, chunks.mjs, lint.mjs, names.mjs), names-1.md, the base `test/accounts.test.mjs` at de07a84, the six parts and `test/lib/accounts-fixture.mjs`, and the parts of `test/lib/kit.mjs`, `test/lib/ports.mjs`, `test/run.mjs` and test.yml that decide how a file gets its ports, tmux server and group. Each check ran from a script in my own `mktemp -d` folder.

1. **Verbatim moves.** I ran `chunks()` over the base file. Each of the 25 test chunks, with its leading comment lines, is a substring of exactly one of the seven files, occurs once there, and comes at a later offset than the chunk before it in the same part. espree found 48 non-import top-level statements in the base. Each one's source text occurs once, in exactly one file. Every base comment is carried over except the two header lines (L1–2). Their wording is folded into the fixture's new 4-line header, and each part gets a new one-line header from split-plan.mjs. Apart from those headers, the `import` lines and the fixture's `export { … }` line, every non-blank line in the seven files appears in the base. Placement matches the spec: `row` goes to rotation; `switchCalls`, `SOON`, `PAST`, `expired`, `FULL_READING`, `OTHER`, `OTHER_FULL`, `ROOMIEST`, `CSWAP_STATE` and `quarantine` go to leaving; everything else, `MINUTE` and `autos` included, goes to the fixture.
2. **Reproduce.** I ran `git archive de07a84` into my scratch folder, copied the five tools in, and ran `split.mjs accounts --check` (exit 0) and then `split.mjs accounts`. All seven outputs match HEAD's files byte for byte (`cmp`), and `test/accounts.test.mjs` was removed.
3. **Names.** `names.mjs de07a84 HEAD accounts` exits 0 with `diff: none`. The base has 25 tests and the head has 25 (rotation 6, leaving 7, restart 3, restart-guards 4, untrusted 2, supervisor 3). That matches split-plan.mjs and the spec's grouping.
4. **Lint, imports, state.** `lint.mjs` over the seven files exits 0, with no undefined or unused name. The fixture exports exactly what some part imports: autos, claimFile, findings, fixture, FULL, HOME, MENU, MINUTE, MOVED and ROOM. `clearClaims` stays internal, used only by `done()`. Each part takes its own `hasTmux`/`json`/`until`/`write`/`PORTS`/`startDashboard` from `./lib/kit.mjs`, and the fixture imports `./kit.mjs`, which is the same module instance. So `PORTS`, the `TMUX_TMPDIR` shim and the hub-port environment are still set once per process, as before. Per-process state is unchanged: `HOME` comes from `mkdtempSync` when the fixture loads and is removed on exit. `ports.mjs` claims one port block per process (pid-based lock). kit.mjs creates a `dt-tmux-*` server per process. `clearClaims` covers `PORTS` and `PORTS+70` of that process's own block. Nothing in a part reads anything an earlier part's test leaves behind: every test builds its own `fixture()` and cleans up in `finally`/`done()`. Module-level values still run before any test starts, so `SOON` and `PAST` are computed when the part loads, as in the base. test.yml and run.mjs find `test/*.test.mjs` directly under `test/`, so the fixture in `test/lib/` is never run as a test. None of the parts lands in the chain, alone or chrome group, and no part is in LONG.
5. **Touches.** `git diff --stat de07a84 HEAD` changes only `test/accounts.test.mjs` (removed), the six `test/accounts.*.test.mjs` files, `test/lib/accounts-fixture.mjs`, and files under `docs/devteam-dev/tickets/kit-212-accounts-tests-split/`. `pr-body.md` is untracked and not in HEAD.
6. **Runs (two parts, one at a time, niced, `--test-concurrency=2`, DEVTEAM_* unset).**
   - `accounts.untrusted`: exit 0, 2/2 pass. The file's `duration_ms` was 69 520; the tests took 51 801 and 17 207.
   - `accounts.supervisor`: exit 0, 3/3 pass. The file's `duration_ms` was 52 714; the tests took 14 289, 7 505 and 30 212.

   The box was heavily loaded during these runs: load average 48.8 on 32 cores. So the times say nothing about CI, but they are well above the base CI figures (28.3 s and 28.1 s). Treat done-when 2 and 3 as a real risk, to settle on the PR's Node 24 rest job as the plan says. This is not a finding against the split. Afterwards `~/.devteam/repos-4320/` held nothing rooted in my scratch folder.

I found no defect in the split. Every move is mechanical and reproducible, the names are kept, lint is clean, and the files stay inside the touches.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| — | — | — | — | None. | |

Verdict: APPROVE 85b6447f276106ed7036cb339e019edef39127ff
