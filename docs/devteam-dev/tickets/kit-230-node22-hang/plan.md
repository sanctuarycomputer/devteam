# kit-230-node22-hang: plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native: two small tasks in two files), with a fresh-subagent review per task. Steps use checkbox (`- [ ]`) syntax.

## TL;DR

- Cause (spec): the Chrome test's first `t.after` removes its folder while two dashboards still write there; a throwing hook skips the rest, nothing is stopped, and the file never exits.
- T1, `test/hub-overview.test.mjs`: one ordered cleanup, `defer(t, fn)`. The last step added runs first, every step runs, each is bounded at 30 s, and the first error is rethrown. Every `t.after` in the file goes through it, and a committed test pins the helper.
- T2, `.github/workflows/test.yml`: `--test-timeout=600000` on Node 20, 22 and 24 (matrix value; 18 rejects the flag), `timeout-minutes: 12` on each test step, and an `if: failure()` step running `ps -eww -o pid,ppid,etimes,args`. No `--test-force-exit`.
- Gate: the touched file on Node 22 and 24 at `--test-concurrency=2`, through `devteam.mjs gate`; the Chrome test about 10 times on Node 22 with an injected failure in the first step, which must leave nothing running; CI three times green.
- No file outside these two and this ticket's records.

**Goal:** the hang can't recur from this file, and any hung file ends the job within 12 minutes with its name in the log.
**Spec:** `docs/devteam-dev/tickets/kit-230-node22-hang/spec.md` (approved, m-20261115-052210109).

## Global constraints

- `--test-timeout=600000` only on Node 20, 22 and 24; never on 18; never less than 600000 (m-20261115-050643117, m-20261115-051541126).
- `timeout-minutes: 12` on every `node --test` step; the job keeps `timeout-minutes: 30`.
- Box rule: run only the touched test file, at `--test-concurrency=2`, never the suite; kill only the pids or groups you started, never by name.

## Review focus

1. A step added after cleanup has started (a test that timed out while its body runs): it runs at once and is not dropped. The T1 helper test pins this.
2. A cleanup step that never settles: it is bounded and doesn't block the rest. The T1 helper test uses a short bound.
3. A test that fails before it starts anything: only the steps added so far run, with no error from an empty cleanup.
4. Node 18: the steps still parse with an empty matrix value, so `kit (18, *)` must pass on CI (T2, CI).
5. The failure-only listing after a step timeout: it shows the hung file's own process (spec F2-2 and F3-1). Checked on the box with a leaking probe (T2 step 3).

---

### Task 1: ordered cleanup in hub-overview.test.mjs

**Files:** Modify `test/hub-overview.test.mjs` (helpers near the top, beside `SUP`; every `t.after`, at lines 202–276, 301, 308, 325, 340, 368, 455, 468 and 487 after merging main at 83c4eab; and the `holder` servers at 379).

**Interfaces:** produces, local to the file:
- `runSteps(steps: Array<() => unknown>, ms = 30000): Promise<Error|null>`: runs `steps` last to first, each awaited against a ref'd `ms` timer, cleared once the step settles (an unref'd one lets Node 22 cancel the hook as "the event loop has already resolved" before it fires), whose expiry is an `Error('cleanup step did not settle in <ms/1000> s')`. Every step runs, and it returns the first error or `null`.
- `cleanup(ms = 30000): { add(fn): void, run(): Promise<void> }`: `run` calls `runSteps` over the steps added so far, then awaits any late steps, then throws the first error.
  - An `add` while `run` is running starts `fn` at once (bounded the same way); `run` awaits it, and its error counts.
  - An `add` after `run` has finished runs `fn` at once; an error then goes to `process.stderr` as `cleanup after the test: <message>`.
- `defer(t, fn): void`: one `cleanup()` per test, kept in a `WeakMap` keyed by `t`. The first call registers `t.after(() => c.run())`, and every call does `c.add(fn)`. Its comment says the first `defer` of a test must come before the test's hooks start (a `t.after` added later never runs); every test in the file calls it synchronously at its start.

- [ ] **Step 1: failing tests** (beside the file's other tests, no processes):
  - `test('cleanup: last added runs first, every step runs, the first error is the one thrown', …)`: three steps. Step A, added first, throws `a`; B pushes `'b'`; C, added last, throws `c`. Assert the order is `C, B, A`, all three ran, and `runSteps` returned the error `c`. Then the same three steps through `cleanup()`: `await assert.rejects(c.run(), /^Error: c$/)`.
  - `test('cleanup: a step that never settles is bounded and the rest still run', …)`: `runSteps([() => order.push(1), () => new Promise(() => {})], 50)`. Assert it resolves within 1 s with a "did not settle" error, and that `order` is `[1]`.
  - `test('cleanup: a step added while cleanup runs is awaited and its error counts', …)`: `const c = cleanup(); c.add(() => c.add(() => { throw new Error('late'); }));` then `await assert.rejects(c.run(), /late/)`.
  - `test('cleanup: a step added after cleanup ran still runs', …)`: after `await c.run()`, `c.add(() => ran = true)`; assert `ran` is true on the next tick.
- [ ] **Step 2:** run `node --test --test-concurrency=2 --test-name-pattern=cleanup test/hub-overview.test.mjs` on Node 22. Expected: FAIL (`runSteps` and `cleanup` are not defined).
- [ ] **Step 3:** implement `runSteps`, `cleanup` and `defer`, with a two-line comment saying why: `t.after` runs hooks in the order they were added and skips the rest once one throws. Replace every `t.after(x)` in the file with `defer(t, x)`. Keep each step's body as it is, and keep removals added first, so they now run last. In the "waits out another hub" test, `holder` registers each server it starts: `defer(t, () => s.listening && new Promise((r) => s.close(r)))`, so a server the body already closed is skipped.
- [ ] **Step 4:** run the whole file on Node 22 and on Node 24 through the gate:
  - With `D=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs`: `node $D gate test -- mise exec node@22.23.4 -- node --test --test-concurrency=2 test/hub-overview.test.mjs`, then the same with `node@24.14.1`.
  - Expected: pass on both, file exits; on 22, about 95 s, as before.
- [ ] **Step 5: the regression, shown and not committed.** Temporarily make the Chrome test's first step (`rmSync(base)`) throw `ENOTEMPTY`. Run that test on Node 22 with `--test-name-pattern=Overview.in.Chrome`. Expected: `not ok` with that error, and the file exits within about 30 s of it, and nothing of the run is left: the processes whose args hold that test's `devteam-hub-ov-…` folder (dashboards, watchers) and Chrome, by the pid the run's own process tree showed while it ran. These are listed by `ps -eww -o pid,ppid,args` and matched in the script, never killed by pattern; dashboards and Chrome are detached, so a process-group check would see nothing. Revert the change, and record the output in verification.md. Then run the real test 10 times on Node 22 (the repro loop, each bounded at 300 s). Expected: no run outlives its result.
- [ ] **Step 6:** commit, then the task review, `reviews/task-1.md`.

### Task 2: bounds in test.yml

**Files:** Modify `.github/workflows/test.yml`.

- [ ] **Step 1: matrix.** Under `strategy.matrix`, add `include:` entries for `node: 20`, `node: 22` and `node: 24` (numbers, as the matrix has them), each setting `test_timeout: --test-timeout=600000`. Give the job `name: kit (${{ matrix.node }}, ${{ matrix.part }})`, so the added key doesn't rename the 20, 22 and 24 jobs that branch protection and merge tooling read. Node 18 gets none, so the value expands to nothing. Add a comment with the per-major facts in one line each: 18 rejects the flag; on 20 and 22 it caps a whole file and names it when it fires first; on 24 it caps a top-level test only.
- [ ] **Step 2: steps.**
  - Each of the three `node --test` run lines gets `${{ matrix.test_timeout }}` after `--test`, and `timeout-minutes: 12`.
  - Add a last step, `if: failure()`, with a comment naming what it is for. It runs `ps -eww -o pid,ppid,etimes,args`, unfiltered. A step timeout signals only the step's shell, so a hung file's processes are still alive here. Their tmp folders name the test, and when Node's per-file limit fired first, Node's `not ok - <file>` line names it instead (spec F3-1).
- [ ] **Step 3: check on the box, no CI.**
  - Check the YAML parses with `mise exec ruby@3.4.12 -- ruby -ryaml -e 'YAML.load_file(ARGV[0])' .github/workflows/test.yml`. Expected: no error.
  - Run the listing command once against a probe in the scratch directory that leaks a child holding a pipe (the f.test.mjs shape). Start it as a step does, `bash -c 'node --test probe.test.mjs'`, and after a few seconds kill only that shell's pid, as the runner does: plain `timeout` signals the whole group and would hide it. Show the `node --test` runner, the probe's file process and its child in the listing, filtered to those pids for the record. Then kill those pids.
  - Write the per-major `--test-timeout` probe results into verification.md (18 rejects it; 20 and 22 cap the file and name it; 24 caps only top-level tests and doesn't end a file held open), with the probe and its output.
- [ ] **Step 4:** commit, the task review (`reviews/task-2.md`), push. Then CI three times on the PR: the first run on the push, then two re-runs with `gh run rerun <id>`, each recorded with `devteam.mjs gate ci -- gh run watch <id> --exit-status --interval 60`. Expected: every job green, under the same names. In verification.md, per job: its duration on each of the three runs against the median and maximum of the last 10 green main runs (no job slower than that maximum), and each test step's time against the spec's maxima (429 s rest, 236 s chain). Record `git diff --name-only origin/main...HEAD`: only the two touched files and this ticket's records.

## Rulings

- m-20261115-052210109 (supervisor): spec approved; send the plan, kept tight.
- kit-50 (the dependency, m-20261115-050956047) merged at 34fc1e5; main is merged into this branch at 83c4eab, before any build task.
- Earlier rulings are in the spec.

## Review notes taken into this plan

- Spec review 3, F3-1: T2 step 2's comment and verification say which mechanism names the file in which case.
- F3-2: `runSteps` bounds every step; `defer`'s hook awaits a late step started while it runs.
- F3-3: this Rulings section lists only supervisor messages.
- F3-4: the listing uses `ps -eww`.
