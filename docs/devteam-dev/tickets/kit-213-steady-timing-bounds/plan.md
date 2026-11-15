# kit-213 steady timing bounds: implementation plan

## TL;DR

- Two files change, nothing else outside this folder: `test/bounds.test.mjs` (B1 to B4) and `test/speed.test.mjs` (B5 and the after hooks).
- Counts where the thing is a count: globs compiled across the whole coverage test (a counting `RegExp` in the vm context), owner asks (the test's own `ownerOf`), and for the dashboard reply, `send-keys` processes still alive when the reply arrives.
- Ratios where it really is time: coverage vs plain RegExps written in the test (< 10), suggestion lookups vs a plain-Map walk (< 4), `questions --json` vs `goal list` on 2,000 questions (< 4.5), `search` vs `knowledge` (< 8). The two sides alternate and the best of each is kept.
- speed.test.mjs cleans up through one helper: stops first, folders last, every step run even if one throws, the first error rethrown at the end.
- Each bound is shown to fail on a scratch copy of the kit patched to do 10x the work. The after-hook fix is shown twice, once with the last step throwing and once with the first, by pid and process-group checks. These patches are never committed.
- On the box, only the two files run, one at a time at `--test-concurrency=2`, each with its own HOME, a hub port away from 4320, and no `DEVTEAM_*`. The proof under load is a `test-stress.yml` dispatch (repeat 3, load 4), and `test.yml` is the gate.
- Risk: a ratio too tight for a loaded CI runner. The stress run catches it; a loosened bound has its 10x ratio measured again on CI.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the bounds in `test/bounds.test.mjs` and `test/speed.test.mjs` hold on a loaded machine and still catch a 10x slowdown, and speed.test.mjs's cleanup never leaves a process running.

**Spec:** `docs/devteam-dev/tickets/kit-213-steady-timing-bounds/spec.md` (the bound table B1 to B6 is there).

## Rulings

- m-20261115-183218194-supervisor: one combined spec and plan review. Lessons k-20261115-182656232, k-20261115-080753394 and k-20261115-164245020 go in every brief (spelled out in the spec's Rulings). Only the touched files run, at `--test-concurrency=2`.

## Global constraints

- Files outside this folder: `test/bounds.test.mjs` and `test/speed.test.mjs`, nothing else.
- Scripts this ticket runs live in this folder: `run-file.sh` (one test file, isolated: own HOME, `DEVTEAM_HUB_PORT=4791`, every `DEVTEAM_*` unset, `nice`, `timeout 600`, `--test-concurrency=2`, extra `node --test` args such as `--test-name-pattern` passed through), `slow-kit.sh` (a scratch copy with one patch), and `check-hooks.sh` (the pid and group check). Every check is judged by its exit code.
- The code below was drafted in a scratch copy and run there (three runs of bounds, one of speed, all exit 0). The tasks move it into the worktree as written.

---

### Task 1: bounds.test.mjs, B1 to B4

**Files:** modify `test/bounds.test.mjs`.

- [ ] Header comment: each bound is a count or a same-process ratio, so load slows both sides. `run.mjs` still runs the file alone; that list is outside this ticket.
- [ ] Helpers after the imports:

```js
const msOf = (fn) => { const t0 = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t0) / 1e6; };
// A workload's time over a reference's, both timed here, one after the other n times, the best of
// each kept: a burst of load hits one run, not the best of several, and steady load slows both.
const ratio = (work, ref, n) => { let w = Infinity, r = Infinity; for (let i = 0; i < n; i++) { r = Math.min(r, msOf(ref)); w = Math.min(w, msOf(work)); } return { w, r, x: w / r, say: `${w.toFixed(0)} ms against ${r.toFixed(0)} ms, ${(w / r).toFixed(2)}x` }; };
```

- [ ] Each of the three tests takes `(t)` and reports its measured ratio with `t.diagnostic(...)` (P1-6), so verification.md can quote the figures.
- [ ] B1 (count, F1-1). Install the counter through the context's own `Function`: `coverage.constructor('onNew', 'const R = RegExp; globalThis.RegExp = new Proxy(R, { construct(t, a) { onNew(String(a[0])); return Reflect.construct(t, a); } });')((s) => compiled.push(s))`. No `newTarget` is passed: a RegExp built with the proxy as its new.target lost V8's fast path and slowed `coverage()` by half in the draft. A helper `once(when)` asserts 31 distinct and 31 in all. It runs after the first `coverage()`, and again as the test's last line, after the five ratio runs, the one reference check and the suggestions' 900 `ownersOf` asks.
- [ ] B1 (ratio). Reference regexes written in the test, one per glob: `^app${i}/.*src/.*$`, `^app${i}/m${i}/[^/]*\.md$`, `^app${i}/(x|y)/.*$`, plus `^docs/devteam/.*$`. The reference asks every path of every regex (no short-circuit, as coverage asks all of them to find a contest) and returns the paths no component matches. Assert `deepEqual(ref(), [...cov.unowned])`, an oracle (the copy is there because the kit's array comes from the context's realm). Then `ratio(run, ref, 5)` and `x < 10`.
- [ ] B2 (count). A counting `ownerOf` (`asked.push(p)`). Assert no path asked twice, and `asked.length <= folders.size`, every ancestor folder of every owned path.
- [ ] B2b (ratio, F1-2/P1-2). Build `firstHere` (each folder's first owned path's owner, from the reference regexes) and `suggestHere` (the same walk up). Assert `deepEqual(dirs.map(suggest), dirs.map(suggestHere))`. Then `ratio(rounds(suggest), rounds(suggestHere), 5)`, with 20 rounds of the 5,000 lookups on each side, and `x < 4`. Keep the two existing answer assertions.
- [ ] B3 (F1-3). The fixture becomes 1,800 details and 200 gates, each gate settling nine details. Assert 2,000 questions with the first 200 the gates. Then `ratio(questions --json, goal list, 5)` and `x < 4.5`. The title says 2,000.
- [ ] B4. `ratio(search, knowledge --status accepted, 3)` and `x < 8`. The title says "in a bounded multiple of reading its log".
- [ ] Run `sh docs/devteam-dev/tickets/kit-213-steady-timing-bounds/run-file.sh test/bounds.test.mjs` three times. Expect exit 0 each time, and note the diagnostics.
- [ ] Commit, with a review record `reviews/task-1.md` from a fresh subagent (the brief carries the lessons).

### Task 2: speed.test.mjs, B5 and the after hooks

**Files:** modify `test/speed.test.mjs`.

- [ ] Helpers at the top:

```js
const cleanup = async (...steps) => { let err = null; for (const s of steps) { try { await s(); } catch (e) { err ??= e; } } if (err) throw err; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
```

- [ ] The dashboard test. Right after `mkdtempSync`, define `release` and `let dash = null`, then register the one hook: `t.after(() => cleanup(() => fs.writeFileSync(release, ''), () => dash?.stop(), () => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })))`. The second `t.after` goes, and `dash = startDashboard(...)` fills the variable.
- [ ] B5 (P1-4: the path is `typing`, the pids are `held`). The fake tmux's `send-keys` branch starts with `echo $$ >> "${typing}"`. At the reply, `const held = fs.existsSync(typing) ? fs.readFileSync(typing, 'utf8').split('\n').filter(Boolean).map(Number) : []`, then `assert.ok(held.every(alive), …)`. `t0` and the 15,000 ms assertion go.
- [ ] The git-processes test becomes `async`. `spawnFixture(n, b, made)` pushes `F` right after `fleetFixture(...)`. Both fixtures are made inside `try`, and `finally { await cleanup(...made.map((F) => () => F.done())); }` runs.
- [ ] Run `run-file.sh test/speed.test.mjs` twice. Expect exit 0.
- [ ] Commit, with a review `reviews/task-2.md`.

### Task 3: the 10x checks and the after-hook checks (verification only)

**Files:** create `slow-kit.sh`, `check-hooks.sh` and `verification.md` in this folder.

- [ ] `slow-kit.sh <patch>` copies the worktree's `test/` and `docs/devteam/` (without `project/` and `run/`) to a private `mktemp -d` folder. It applies one exact substitution, with Python asserting that the old text occurs exactly once, and prints the copy's path last. Patches:
  - `b1-time`: in `coverage()`, `ownersIn(p, L, null)` runs 9 extra times per path.
  - `b1-count` (P1-1): `const hit = globCache.get(g);` becomes `const hit = null;`, and `let m = matcherCache.get(entry);` becomes `let m;`. Both caches are off.
  - `b2`: `ownerOf(p)` is called 9 extra times where `who` is set.
  - `b2b`: the closure `ownerSuggestions` returns walks up 9 extra times before its real walk.
  - `b3`: `cmdQuestions` starts with `for (let k = 0; k < 9; k++) rankQuestions(questionsNow());`.
  - `b4`: `cmdSearch` runs `searchRank(searchIndex(docs), q, { limit })` 9 extra times.
  - `b5`: `nudgeSupervisor`'s `REPLY_FD` queue line is removed, so it types at once.
  - `hooks-last`: the dashboard test's rm step prints `PIDS {dashboard, sendKeys, base}` and throws.
  - `hooks-first` (F1-5/P1-5): the first step (writing `release`) prints the same and throws.
- [ ] For b1 to b5, run the affected test in the copy (`run-file.sh <file> <copy> --test-name-pattern=<name>`). Expect a non-zero exit and that bound's own assertion in the output. b1-count must fail on the count, not on a timeout.
- [ ] `check-hooks.sh <copy>` runs the dashboard test in the copy and reads the `PIDS` line. The test must exit non-zero. Then for every pid, `ps -p` exits 1. No process in `ps -eo pid,pgid,args` has the dashboard's pid as its pgid or ends with it as an argument (the watcher). For `hooks-first`, `base` no longer exists. The script exits 0 only when all of these hold. Run it for both patches.
- [ ] Record each patch, command, exit code and failing message in verification.md. Remove the copies with a guarded `rm -rf "${C:?}"`.

### Task 4: stress run, PR, gate, finals

- [ ] Push. Dispatch `gh workflow run test-stress.yml --ref ticket/kit-213-steady-timing-bounds -f files="test/bounds.test.mjs test/speed.test.mjs" -f repeat=3 -f load=4`. Find the run id with `gh run list --workflow test-stress.yml --branch ticket/kit-213-steady-timing-bounds --json databaseId,headSha`, matching the pushed head. Wait with `gh run watch <id> --exit-status`, then read `gh run view <id> --json conclusion`.
- [ ] If a ratio fails under load (P1-3), loosen it only while it stays at least 1.5x under its 10x ratio. Measure that 10x ratio again on CI: dispatch test-stress.yml on a throwaway branch `scratch/kit-213-10x-<patch>` with the patch applied (repeat 1, load 4). The run must fail on that bound, and the branch is deleted afterwards. Then dispatch again on the ticket branch. Record every run id, conclusion and summary table.
- [ ] Merge `origin/main` and push. Open the PR: title `kit-213-steady-timing-bounds: bounds and speed tests hold on a loaded machine: counts or same-process ratios, not wall-clock limits`, body with `## One-way doors` set to `None.`. Run `gate ci -- <the real gh run watch command>` at the head, and fill verification.md's CI row before the final review.
- [ ] Final review `reviews/final-1.md` from a fresh subagent, given the spec and the diff, not my conclusions. Then `check-ticket`, then `merge-request`.

## Review focus

1. The B1 count across calls with both caches off (spec-1 F1-1).
2. B3 on 2,000 questions, bounding the Inbox read rather than `inboxRanks` alone (spec edge case; it goes to the supervisor).
3. Whether the margins leave room on CI's Node 24 and 4 vCPU. The stress run decides.
