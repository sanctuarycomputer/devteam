# kit-213 steady timing bounds: implementation plan

## TL;DR

- Two files change, nothing else outside this folder: `test/bounds.test.mjs` (B1 to B4) and `test/speed.test.mjs` (B5 and the after hooks).
- Counts where the thing is a count: globs compiled (a counting `RegExp` in the vm context), owner asks (the test's own `ownerOf`), and for the dashboard reply, `send-keys` processes still alive when the reply arrives.
- Ratios where it really is time: coverage vs plain RegExps written in the test (< 8), `questions --json` vs `goal list` (< 2.25), `search` vs `knowledge` (< 8). The two sides alternate and the best of each is kept.
- speed.test.mjs cleans up through one helper: stops first, folders last, every step run even if one throws, the first error rethrown at the end.
- Each bound is shown to fail on a scratch copy of the kit patched to do 10x the work. The after-hook fix is shown with a throwing removal and a `ps -p` check of the pids. These patches are never committed.
- On the box, only the two files run, one at a time at `--test-concurrency=2`, through a script that gives each run its own HOME, a hub port away from 4320, and no `DEVTEAM_*`. The proof under load is a `test-stress.yml` dispatch (repeat 3, load 4). `test.yml` is the gate.
- Risk: a ratio bound too tight for a loaded CI runner. The stress run catches it, and the bound is loosened while it still stays under the 10x ratio.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the bounds in `test/bounds.test.mjs` and `test/speed.test.mjs` hold on a loaded machine and still catch a 10x slowdown, and speed.test.mjs's cleanup never leaves a process running.

**Spec:** `docs/devteam-dev/tickets/kit-213-steady-timing-bounds/spec.md` (the bound table B1 to B6 is there).

## Rulings

- m-20261115-183218194-supervisor: one combined spec and plan review. Lessons k-20261115-182656232, k-20261115-080753394 and k-20261115-164245020 go in every brief (spelled out in the spec's Rulings). Only the touched files run, at `--test-concurrency=2`.

## Global constraints

- Files outside this folder: `test/bounds.test.mjs`, `test/speed.test.mjs`. Nothing else.
- Scripts this ticket runs live in this folder: `run-file.sh` (one test file, isolated), `slow-kit.sh` (the scratch copy with one 10x patch), `stress.sh` (the dispatch, then a wait on the run).
- Local test runs: `nice`, `timeout 600`, `node --test --test-concurrency=2 <one file>`, own HOME, `DEVTEAM_HUB_PORT=4791`, every `DEVTEAM_*` unset. Judged by exit code.

---

### Task 1: bounds.test.mjs, B1 to B4

**Files:** modify `test/bounds.test.mjs`.

- [ ] Header comment: the bounds are counts or same-process ratios, so load slows both sides. `run.mjs` still runs the file alone; that list is outside this ticket.
- [ ] Shared helpers at the top:

```js
const msOf = (fn) => { const t0 = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t0) / 1e6; };
// A workload's time over a reference's, both timed here, one after the other n times; the best of
// each is kept. A burst of load hits one run, not the best of several, and steady load slows both.
const ratio = (work, ref, n) => { let w = Infinity, r = Infinity; for (let i = 0; i < n; i++) { r = Math.min(r, msOf(ref)); w = Math.min(w, msOf(work)); } return { w, r, x: w / r }; };
```

- [ ] B1. A fresh `coverageFns()`. Install the counter through the context's own `Function`: `coverage.constructor('onNew', 'const R = RegExp; globalThis.RegExp = new Proxy(R, { construct(t, a, nt) { onNew(String(a[0])); return Reflect.construct(t, a, nt); } });')((s) => compiled.push(s))`. Run `coverage()` once and assert `compiled.length === 31` and `new Set(compiled).size === 31` ("each glob compiled once"). Reference regexes: for each `i`, `^app${i}/.*src/.*$`, `^app${i}/m${i}/[^/]*\.md$`, `^app${i}/(x|y)/.*$`, plus `^docs/devteam/.*$`. The reference counts, for each path, whether any component regex matches. Assert that the unmatched paths equal `cov.unowned` (the oracle). Then `const c = ratio(() => coverage(...), ref, 5)` and `assert.ok(c.x < 8, ...)`, with a message giving both times and the ratio.
- [ ] B2. Wrap `ownerOf` in a counter: `asked` is an array of paths. Run `ownerSuggestions(...)` and the 5,000 `suggest()` calls once. Assert `new Set(asked).size === asked.length` (no path asked twice). Assert `asked.length <= folders.size`, where `folders` holds every ancestor folder (`a/`, `a/b/`, …) of every owned path. Keep the two existing answer assertions.
- [ ] B3. Replace `timed`, `base` and `ms` with `const q = ratio(() => ok(old, ['questions', '--json']), () => ok(old, ['goal', 'list']), 5)` and `assert.ok(q.x < 2.25, ...)`. Keep the fixture and the ordering assertions.
- [ ] B4. The same with `ratio(() => ok(old, ['search', C.questions[7].context]), () => ok(old, ['knowledge', '--status', 'accepted']), 3)` and `x < 8`. Keep the size assertion.
- [ ] Remove unused imports only if the file's lint would flag them (none is enforced; leave them alone otherwise).
- [ ] Run: `sh docs/devteam-dev/tickets/kit-213-steady-timing-bounds/run-file.sh test/bounds.test.mjs` three times. Expect exit 0 each time. Note the ratios each assertion message prints by adding `{ diagnostic }` via `t.diagnostic(...)` with the measured times, so verification.md can quote them.
- [ ] Commit `kit-213: bounds.test.mjs bounds are counts and same-process ratios`. Review record `reviews/task-1.md` (fresh subagent, the brief carries the lessons).

### Task 2: speed.test.mjs, B5 and the after hooks

**Files:** modify `test/speed.test.mjs`.

- [ ] A helper at the top:

```js
// One cleanup, in order: what the test started is stopped before its folders go. Node runs after
// hooks in the order they were added and stops at the first that throws, so the steps live in one
// hook (or finally) and each runs whatever the one before did; the first error is thrown at the end.
const cleanup = async (...steps) => { let err = null; for (const s of steps) { try { await s(); } catch (e) { err ??= e; } } if (err) throw err; };
```

- [ ] The dashboard test: replace both `t.after` hooks with one, registered right after `mkdtempSync` (so a throw before the dashboard starts still removes `base`): `let dash = null; t.after(() => cleanup(() => fs.writeFileSync(release, ''), () => dash?.stop(), () => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));`. `dash = startDashboard(...)` later fills it. Writing `release` lets a `send-keys` outside the group finish; `stop()` ends the dashboard's group and waits for it.
- [ ] The fake tmux records each `send-keys` pid before it waits: `send-keys) echo $$ >> "${typing}"; while …`. At the reply: `const live = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } }` and `const typing = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(Number) : []`. Then assert `typing.every(live)`, with the message "the reply came while every send-keys was still held (tmux's 30 s limit kills one the reply waited for)". Remove `t0` and the 15,000 ms assertion.
- [ ] The git-processes test becomes `async`. It keeps `const made = []`, and `spawnFixture(n, b, made)` pushes its `F` into `made` right after `fleetFixture(...)`, before anything that can throw. The body sits in `try { … } finally { await cleanup(...made.map((F) => () => F.done())); }`. Each `done()` kills its own tmux server, then removes its folder, so one fixture's failed removal can't leave the other's tmux server running.
- [ ] Run `run-file.sh test/speed.test.mjs` twice. Expect exit 0.
- [ ] Commit `kit-213: speed.test.mjs reply order by live send-keys; stops before removals`. Review `reviews/task-2.md`.

### Task 3: the 10x checks and the after-hook check (verification only)

**Files:** create `docs/devteam-dev/tickets/kit-213-steady-timing-bounds/slow-kit.sh` and `verification.md`.

- [ ] `slow-kit.sh <patch-name>` copies the worktree's `test/` and `docs/devteam/` (without `project/` and `run/`) to a private `mktemp -d` under the scratch directory. It applies one exact substitution (Python, asserting the old text occurs exactly once) and prints the copy's path. Patches:
  - `b1-time`: in `coverage()`, `const owners = ownersIn(p, L, count);` gets `for (let k = 0; k < 9; k++) ownersIn(p, L, null);` before it.
  - `b1-count`: in `globToRegex`, `const hit = globCache.get(g);` becomes `const hit = null;`.
  - `b2`: in `ownerSuggestions`, `if (who === undefined) who = ownerOf(p);` becomes `if (who === undefined) { for (let k = 0; k < 9; k++) ownerOf(p); who = ownerOf(p); }`.
  - `b3`: `cmdQuestions` starts with `for (let k = 0; k < 9; k++) rankQuestions(questionsNow());`.
  - `b4`: `cmdSearch` runs `searchRank(searchIndex(docs), q, { limit })` 9 extra times.
  - `b5`: `nudgeSupervisor` drops its `REPLY_FD` queue and types at once.
  - `hooks`: in the copy's `test/speed.test.mjs`, the dashboard test's rm step throws, and the pids of the dashboard, its watcher and each `send-keys` are printed (`console.log('PIDS', …)`).
- [ ] For each patch, run the one affected test (`--test-name-pattern`) in the copy, with `run-file.sh`'s isolation. Expect a non-zero exit and that bound's own assertion message in the output. For `hooks`, expect a non-zero exit, then `ps -p <each pid>` exits 1 for every pid.
- [ ] Record each patch, command, exit code and failing message in verification.md. Remove the copies (guarded `rm -rf "${S:?}/${n:?}"`).

### Task 4: stress run, PR, gate, finals

- [ ] Push the branch, then `stress.sh`: `gh workflow run test-stress.yml --ref ticket/kit-213-steady-timing-bounds -f files="test/bounds.test.mjs test/speed.test.mjs" -f repeat=3 -f load=4`. Find the run id with `gh run list --workflow test-stress.yml --branch … --json databaseId,headSha`, matching the pushed head. Wait with `gh run watch <id> --exit-status`, then read `gh run view <id> --json conclusion`. If a ratio fails under load, loosen it, staying at least 1.5x under its 10x ratio, and run again. Record the run id, conclusion and summary table.
- [ ] Merge `origin/main`, push, open the PR (`kit-213-steady-timing-bounds: bounds and speed tests hold on a loaded machine: counts or same-process ratios, not wall-clock limits`, with `## One-way doors` set to `None.`). `gate ci -- <the real gh run watch command>` at the head. Fill verification.md's CI row before the final review.
- [ ] Final review `reviews/final-1.md` from a fresh subagent given the spec and the diff, not my conclusions. Then `check-ticket`, then `merge-request`.

## Review focus

1. Is the counting `RegExp` proxy reliable? `new RegExp` inside a function defined in the context resolves `RegExp` on the context's global at call time.
2. Do the B3 ratio (2.25) and the B1/B4 ratios (8) leave enough room under 4 burners? The stress run decides, and a failure loosens the ratio within the 10x margin.
3. Is B5 an honest replacement for the 15 s bound? With the kit waiting for the typing, the `send-keys` is killed at 30 s and the reply follows, so a recorded pid is dead at the reply.
