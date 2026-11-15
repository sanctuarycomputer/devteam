# Task review: T5 operator-threads

- Reviewer: task-reviewer 5 (fresh subagent, claude-opus-5-5)
- Reviewed: 2f1b48f4ef8bd811747054c81eca08e8b611109e (test/operator-threads.{store,pane,hub}.test.mjs and test/lib/operator-threads-fixture.mjs)

Read: spec.md and plan.md (T5, After hooks, Shape, Fixed waits), edits.mjs's `operator-threads` entries, split-plan.mjs's `operator-threads` plan, split.mjs and lint.mjs headers, the four files at 2f1b48f, the base `test/operator-threads.test.mjs` at e8022ac (every `t.after` and `finally`, the code between tests, `hubFixture`, `ask`), test/lib/ports.mjs, and local-run-1.log's operator-threads sections.

Ran:

1. Reproduction, in a private `mktemp -d` copy (`git archive 2f1b48f`): put back the base file, deleted the three parts and the fixture, ran `split.mjs operator-threads` (store 7 tests, pane 8, hub 4, fixture 0; base file removed) and `edits.mjs operator-threads` (14 edits). All four files `cmp`-identical to 2f1b48f's.
2. `lint.mjs` over the three parts and the fixture: no output, exit 0 (no undefined names, no unused). The base file alone: also clean, so there is no base-only unused name to carry.
3. `names.mjs e8022ac 2f1b48f operator-threads`: 19 tests at the base, 19 at the head (hub 4, pane 8, store 7), `diff: none`.
4. `git grep lib/chrome.mjs 2f1b48f -- test`: of the operator-threads files only `operator-threads.hub.test.mjs` imports it; the fixture doesn't.
5. One part alone: `operator-threads.hub` (the only part whose hooks changed since the 662bbfd local run), from the private copy, `nice -n 10`, Node 22.23.4 (so the Chrome test runs rather than skipping as it did on Node 18 in local-run-1.log), `node --test --test-concurrency=2`, own TMPDIR, `DEVTEAM_*` and `TMUX*` unset: 4 pass, 0 fail, 0 skipped, 25.4 s wall. Afterwards no process named the copy's folder. Copy removed.

Checked by reading:

- edits.mjs, all 14 operator-threads entries: `cleanup(t)` added to the fixture exactly as the plan's text (reverse order, each awaited in its own try/catch, first error rethrown) and exported; `hubFixture(t, …)` → `hubFixture(later, …)` (signature and its 3 call sites); the single `t.after(async () => { await dash.stop(); tmuxSh(kill-session) })` → `later(kill-session)` then `later(dash.stop)`, so the dashboard stops first, as at the base, and a throwing `dash.stop()` no longer skips the kill; each of the three hubFixture tests gets `const later = cleanup(t)` as its first line; the Chrome test's `chrome.close()` and `p.close()` → `later`s; the standalone hub test's `rmSync(imageKit)`, `a.kill()` and hub group kill → `later`s in the base's registration order, with `cleanup(t)` created right where the base registered its first hook, so the removal now runs last; the hub part's import gains `cleanup`. No entry removes or changes an assertion; nothing outside the spec's After-hooks list is edited. The `try/finally` blocks (spawnSync tmux kills and seat `kill`s) are untouched, as the spec says.
- Standalone parts: the fixture's module-level effects (LANG, env scrub, `tmp` with its exit removal, the stub `claude` and `stubshell`, the gateway key pair, the `keep` tmux session and default-shell, the `machines`/`agents` counters) run once per part's process. Parts interleave base order (store takes base L629's idle-stdin test; pane takes L957's start's note), and none of those tests reads state another left: each makes its own `machine()`/`seat()`/`hubFixture`. The counters only number homes and hub ports (`PORTS + 80 + n`); fewer machines per part only lowers n. The hub part's fixed ports (+30/31, +36, +60) are as at the base.
- Fixture contents: no test bodies (its one `test(` is a regex in the env scrub). Each export is used by two or more parts or by the fixture itself (`bin`, `stubShell` by the fixture's own stubs; `cleanup`, used by hub only, is what the plan puts there). `ask` and `hubFixture` stay in hub, per the plan.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| N1 | Minor | quality.md §3 (note, no change asked) | test/operator-threads.hub.test.mjs, the Chrome test | Hook order differs from the base in a way the spec allows but doesn't spell out: the base ran dash.stop, kill-session, chrome.close, p.close (registration order); now it runs p.close, chrome.close, dash.stop, kill-session. Closing the page before the browser, and the browser before the dashboard it views, is the sounder order, and the Chrome test passes alone on Node 22. Recorded so the final review doesn't read it as a slip. | wont-fix as the reviewer asks no change: the closes now run before the dashboard stops, which the spec allows (stops before removals; reverse registration) |

Verdict: APPROVE 2f1b48f4ef8bd811747054c81eca08e8b611109e
