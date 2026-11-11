# Instant presses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every dashboard press changes the page within the same frame. The server catches up in well under a second. A refusal puts back exactly what was there and says why.

**Architecture:** The page gets one `press()` helper and a set of overlays. Each overlay is applied by all three loaders (`/api/data`, `/api/fleet`, `/api/threads`), so a refresh never undoes a press in flight. The script gets cheaper reads, each keyed by a commit sha:
- one `git cat-file --batch` for main's log files and the ticket branches' reviews;
- a sha-keyed memo of reads in every command;
- a durable store of fixed git facts;
- a by-type index of the fold.

Owner actions run from the dashboard reply over a pipe before they nudge the supervisor. The server's own event loop stops making sync tmux and git calls.

**Tech Stack:** Node 18 built-ins only, vanilla browser JS, `node:test`, Chrome over CDP (`test/lib/chrome.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-11-instant-presses-design.md`. Read all of it before any task.

## Decisions made while planning

1. **Nudges go out after the reply, through the same process.** There is no detached "nudge" command: a command anyone can run that types into the supervisor's pane could forge a "[devteam … from owner]" line. Instead, when the server runs an owner action, it sets `DEVTEAM_REPLY_FD=3` and opens fd 3 as a pipe.
   - In that mode `nudgeSupervisor` queues its line, and `out()` also records what it printed.
   - When the command returns normally, the dispatcher writes `{"out": <printed>}\n` to fd 3, then types the queued lines, then exits.
   - The server replies 200 with that `out` as soon as the line arrives. If the child exits non-zero, or exits without writing it, the server replies as today, from stdout and stderr on close.
   - `die()` exits before the queue is typed. That is right: a refused action is not nudged.
   - Without `DEVTEAM_REPLY_FD` (the CLI, agents), nothing changes.
2. **`deliverOwnerTurn` stays synchronous.** Its result ("Sent." versus "will read it when it next checks") is part of the reply the thread card shows. Thread Send is optimistic on the page anyway (§1.1).
3. **Fact-store keys use the repo's git common dir**, not its root, so worktrees of one repo share entries: `git rev-parse --git-common-dir`, resolved once per process per cwd. That call already runs at startup for home (line 40).
4. **The test hold is the page's.** `POLL_FAST` in `test/dashboard.test.mjs` already holds `/api/answer`. It gains `window.__postHold`, which holds every POST to `/api/`. The kit gets no knob.
5. **The golden comes first.** Task 1 adds `dashboard-data` and `peek ticket g1-01-a` to `g1Outputs` and records them from today's code in its own commit. Every later task must leave every golden file byte-identical.

## Global constraints

- `governance/code-style.md` applies. Extend existing files; add none to the kit (`run/cache/git-facts.json` is runtime state, not a file in the repo).
- Every press's server path, checks and log lines stay exactly as they are. The changes are when the page draws, and how fast the child is.
- Node 18 compatible: no `Object.groupBy`, no `Promise.withResolvers`.
- Test locally on Node 24 (`~/.asdf/installs/nodejs/24.21.0/bin/node`): `node --test --test-concurrency=8 test/*.test.mjs`, then `node --test test/bounds.test.mjs` alone. CI covers 18/20/22/24.
- tmux in tests only under a private, existing `TMUX_TMPDIR`.

## File structure

- `docs/devteam/scripts/devteam.mjs`:
  - §1, the git helpers: `gitStatus`, `gitBatch`, `atCommit` memo, `gitFacts`;
  - `readLog`/`durableText`/`logObjects`;
  - `releasedInWith`, `homeMergedAt` and the link `mergedAt`, `findMergeSha`'s ancestry, `isOnMain`;
  - `srcList`/`srcRead` and a review prefetch in `dashboardData`;
  - `out`/`nudgeSupervisor`/the dispatcher (reply mode);
  - the dashboard server's `run`, `/api/threads` pane check and `refreshHello`.
- `docs/devteam/dashboard/index.html`: `press()`, overlays, every handler in the table, `loadFleet`/`tlRefresh`/`render` applying overlays, the header's saving note, `beforeunload`.
- `test/lib/kit.mjs`: `g1Outputs` gains two outputs; the fixture gains non-ASCII and no-trailing-newline lines.
- `test/fixtures/g1/dashboard-data.txt`, `peek-ticket.txt` (recorded).
- `test/components.test.mjs`: spawn-count tests, fact-store tests, batch-parse tests.
- `test/dashboard.test.mjs`: the presses test (Chrome).
- `test/bounds.test.mjs`: unchanged unless a bound moves.

---

### Task 1: The golden, recorded from today's code

**Files:** `test/lib/kit.mjs` (`g1Outputs`), `test/fixtures/g1/*`.

- [ ] In `g1Outputs`, before the outputs are taken:
  - add a log line with non-ASCII text: an owner `observe --detail 'naïve — em dash ✓' --owner`;
  - make one durable log file lack its trailing newline. Write a line into `project/log/<file>` by hand with no final `\n`, commit it and push it to the fixture's origin main, so `durableText` takes the `git show` path.
- [ ] Add `'dashboard-data': jsonOut(run(old, ['dashboard-data']))` and `'peek-ticket': both(run(old, ['peek', 'ticket', 'g1-01-a']))` (`jsonOut` if peek prints JSON: check its output).
- [ ] Extend `TIMEY` only if `dashboard-data` carries clock fields that move between runs: `ages`, `age`, `ago`, `deadline_in`. Run it twice and diff to find them.
- [ ] `DEVTEAM_G1_RECORD=1 node --test test/components.test.mjs`, then run it again without the variable: it must pass. Run it twice more to confirm the outputs are stable.
- [ ] Commit: "G1: dashboard-data and peek join the golden, recorded before the speedups".

### Task 2: `gitStatus`, `gitBatch` and the at-commit memo

**Files:** `devteam.mjs` §1 (after `git()` ~line 117); `test/components.test.mjs`.

- [ ] `gitStatus(args, cwd)` returns `{ status, stdout }` using `spawnSync`, stdout as a Buffer, `stdio: ['ignore', 'pipe', 'ignore']`. It is the one runner that tells "no" (exit 1) from "error" (128 or a spawn failure).
- [ ] `gitBatch(specs, cwd)`:
  - one `execFileSync('git', ['cat-file', '--batch'], { input: specs.join('\n') + '\n', maxBuffer: 256 MB })` with no encoding, so the output is a Buffer;
  - parse the header `<oid> <type> <size>\n` (read up to the `\n` as latin1), then exactly `size` bytes, then one `\n`; `<spec> missing\n` (and `ambiguous`) give `null`;
  - return a `Map` from spec to `{ type, oid, bytes }` or `null`;
  - reject any spec containing `\n` before calling: return `null` for it, never send it. A git failure returns an all-`null` map, so the callers fall back to their old per-file call.
- [ ] `atCommit` memo: a `Map` keyed `<commonDir>\0<sha>\0<path>`. `showAt(sha, path, cwd)` returns text shaped like `git()`'s output: the bytes decoded as utf8 with one trailing `\n` stripped. `prefetchAt(sha, paths, cwd)` fills the memo through `gitBatch`. Callers pass a full 40- or 64-hex sha; anything else bypasses the memo.
- [ ] Tests in `components.test.mjs`, on a temp repo:
  - a file with multibyte characters, one with no final newline, an empty file, one with spaces in its path, a binary file of random bytes and a missing path all read back exactly as `git show` gives them;
  - a spec with `\n` is refused without spawning;
  - output that is cut short parses as `null`s, not garbage. Simulate it by calling the parser function directly: keep the parser a separate pure function, `parseBatch(buf, specs)`.
- [ ] Commit.

### Task 3: `readLog` reads main's log files in one call

**Files:** `devteam.mjs` `durableText` (~1220), `readLog` (~1308).

- [ ] `readLog`:
  - list the files, as today;
  - if `projectInRepo && mainRef()`, resolve `mainRef()` to its sha. Use `resolveCommit`, which costs no spawn under `gitReadCache`; otherwise it is one `rev-parse`;
  - call `prefetchAt(sha, files.map((f) => `${projectRel}/log/${f}`))`.
- [ ] `durableText(file)` uses `showAt(sha, …)` when the sha is known, else today's `git show`. The result is identical (Task 2's shaping).
- [ ] `appendLog`'s `durableText(file)` call under the lock hits the memo when `readLog` already ran. If it didn't run, it is one `git show`, as today.
- [ ] The goldens are unchanged. `answer` on the G1 fixture spawns at least N fewer git processes (counted in Task 8).
- [ ] Commit.

### Task 4: The fact store

**Files:** `devteam.mjs` §1 (`gitFacts`), `releasedInWith` (~1775), `homeMergedAt` (~1816), the link repo's `mergedAt`/`releasedIn` (~1901–1903), `findMergeSha` (~1760), `isOnMain` (~7458).

- [ ] `gitFacts`:
  - loads `path.join(runDir, 'cache', 'git-facts.json')` lazily on first use. A missing or unparseable file reads as `{ v: 1, e: {} }`;
  - `factGet(key)`, and `factSet(key, value)`, which marks the store dirty and stamps `t: Date.now()`;
  - `process.on('exit')`, if dirty: read the file again, union its entries with ours (ours win), keep the newest 20,000 by `t`, then `writeJson` to a temp file and rename. Check whether `writeJson` (~186) already does tmp+rename; if not, do it here;
  - write failures are ignored.
- [ ] Key parts:
  - `commonDir(cwd)`, memoized;
  - `shallow(cwd)`: `rev-parse --is-shallow-repository`, memoized;
  - `tagPrint(cwd)`: sha256 of `for-each-ref refs/tags --format=%(refname)%00%(objectname)`, memoized. Under `gitReadCache` reuse the `refCommits` listing if it includes tags (it lists all refs; filter `refs/tags/`).
- [ ] `commitDate(sha, cwd)` resolves a full sha first. Its key is `d\0<commonDir>\0<sha>`; it is stored only for a parsed date.
- [ ] `isAncestor(a, b, cwd)`:
  - resolve `a` and `b` to full shas, through `resolveCommit` for refs, or `rev-parse --verify --quiet <x>^{commit}` (memoized per process);
  - the key is `a\0<commonDir>\0<shallow>\0<a>\0<b>`;
  - `gitStatus(['merge-base', '--is-ancestor', a, b])`: status 0 means true and 1 means false, both stored. Anything else returns `null` and stores nothing.
- [ ] `releasedInWith` keeps its signature for its callers, but `homeReleasedIn` and the link version go through `releasedFact(sha, pattern, cwd)`. Its key is `r\0<commonDir>\0<shallow>\0<tagPrint>\0<pattern>\0<sha>`. It is stored only when `tag --contains` exited 0 (through `gitStatus`). The `-rc` filter and the `creatordate` order are unchanged.
- [ ] `findMergeSha`'s `gitFn(['merge-base', '--is-ancestor', …]) !== null` checks become `isAncestor(…) === true` through the repo's own cwd. An `isAncestor` that returns `null` (an error) counts as "not", which is what `!== null` meant before.
- [ ] `isOnMain(sha)` becomes `isAncestor(sha, mainRef(), mainRoot) === true`, keeping its `/^[0-9a-f]{7,40}$/` guard and its `shaOnMain` memo.
- [ ] Tests, on a temp repo with tags:
  - a moved tag, a new earlier-dated lightweight tag and a deleted tag each change `releasedIn`;
  - a missing commit's ancestry is not stored, and after the object arrives (`git fetch` from a second repo) it is right;
  - a shallow clone deepened gives new answers;
  - a corrupt store file is ignored and rewritten;
  - two child processes adding different entries at once leave a parseable file holding at least one's entries;
  - entries over the cap drop the oldest.
- [ ] The goldens are unchanged.
- [ ] Commit.

### Task 5: Ticket reviews in two batched reads, and `logObjects` by type

**Files:** `devteam.mjs` `srcList`/`srcRead` (~1826–1835), the link repo's `srcList`/`srcRead` (~1904–1905), `dashboardData` (~9119), `readLog`/`logObjects` (~1308, 1322).

- [ ] `srcRead(src, rel)` with `src.ref`: resolve the ref to its sha (`resolveCommit`), then `showAt(sha, `${projectRel}/${rel}`)`. If it doesn't resolve, the old path.
- [ ] `srcList` with `src.ref`: `lsTreeAt(sha, dir)`, memoized by sha and dir, parsing `ls-tree --name-only` as today. It may also be filled from a batch: `prefetchTrees`.
- [ ] `prefetchReviews(tickets)`, called once near the top of `dashboardData` (and of `peek ticket`):
  - for each ticket with a branch ref (`homeTicketBranchRef`, which costs no spawn under `gitReadCache`), collect `<sha>:<projectRel>/tickets/<id>/reviews`;
  - one `gitBatch` reads them all as trees. Parse git's binary tree format: repeated `<mode> <name>\0<20 bytes>` for SHA-1 repos, 32 bytes for SHA-256, chosen by the oid's length in the header. Keep only blobs, which are mode `100644` or `100755`;
  - fill the `lsTreeAt` memo, then one `gitBatch` reads every `.md` blob into the `atCommit` memo;
  - link repos run the same per repo, in that repo's cwd.
- [ ] `readLog` builds `byType: Map<type, object[]>` as it folds. `logObjects(type)` returns `[...(byType.get(type) ?? [])].filter(upkeep rule for goal)`, the same contents and order as today's filter over `objects.values()`. Check the order: `objects` is a Map in insertion order, so `byType` must be filled in the same iteration.
- [ ] The goldens are unchanged.
- [ ] Commit.

### Task 6: The reply pipe; the server's loop

**Files:** `devteam.mjs` `out` (find its definition), `nudgeSupervisor` (~11099), the dispatcher (where `COMMANDS[command]` is called), the server's `run` (~10559) and the ACTIONS reply (~10962), `/api/threads`'s `supervisorPane` (~10712), `refreshHello` (~10617).

- [ ] When `process.env.DEVTEAM_REPLY_FD` is set:
  - `out()` also appends to `printed`;
  - `nudgeSupervisor(line)` pushes onto `queuedNudges` and returns;
  - after the command function returns (sync or awaited), the dispatcher runs `fs.writeSync(fd, JSON.stringify({ out: printed }) + '\n')` inside a try, then delivers each queued nudge with today's body (`resolvePane` + `typeInto`, with a warning on failure).
- [ ] The server's owner-action `run`:
  - `spawn` with `stdio: ['ignore', 'pipe', 'pipe', 'pipe']` and `env: { ...ownerEnv, DEVTEAM_REPLY_FD: '3' }`;
  - on the first full line from fd 3, resolve `{ ok: true, stdout: parsed.out }` and keep reading stderr into the dashboard log (`log()`);
  - on `close` with no fd 3 line, resolve as today. Keep `timeout`/`killSignal` (`ACTION_MS`) semantics with a timer;
  - `secret post` (`ownerChild`) gets the same treatment, since it nudges too. The review answer's `ownerChild` likewise.
- [ ] `supervisorPane()` becomes cached plus an async refresh. When the cache is older than 10 s, start `resolvePaneAsync` (a `tmuxAsync` `list-panes`/`display-message` port of `resolvePane`'s checks) and serve the cached value meanwhile.
- [ ] `refreshHello`'s `git rev-parse` becomes `execFile`, async, inside the same `helloRunning` guard.
- [ ] Tests (`components.test.mjs` or `dashboard.test.mjs`, wherever the dashboard server is driven):
  - `/api/answer` replies before a fake supervisor pane receives the nudge. Use a private tmux with a pane running `sleep`; the nudge is skipped as a shell, but `resolvePane` must still run after the reply. Assert the reply arrives and the line is in the log, and that the warning lands in `dashboard.log`;
  - `answer` from the CLI (no env) nudges inline as today: its stdout is unchanged (the goldens).
- [ ] Commit.

### Task 7: The page: `press()`, overlays, every handler

**Files:** `docs/devteam/dashboard/index.html`.

- [ ] Near `post()` (~3156), add:
  - `PRESSES` (in flight, by key) and `OVERLAYS` (a `Map` from key to `{ data?, fleet?, threads?, agrees, confirmedAt, failed }`);
  - `press(key, build, { apply, undo, errId, overlay })`. It chains on `PRESSES.get(key)`. It calls `apply()` and registers `overlay` synchronously, so the click handler's frame already shows it. Then it awaits the previous press on the key, calls `build()` for `{ action, body }`, and posts through `sending()` with the try/catch the spec lists.
  - On ok: `overlay.confirmedAt = Date.now()`, the press's `onOk(out)` if any, then `load({ force: true })` (not awaited), as `post()` does.
  - On failure: `OVERLAYS.delete(key)`, `undo()`, the error into `#e-<errId>` as "Not saved: <reason>", and a redraw from `DATA` (`drawOrHold(DATA, true)`; check the signature).
  - `post()` becomes a thin wrapper over `press()` for any caller left.
- [ ] `applyOverlays(kind, x)` is used by `render`/`loadNow` (data), `loadFleet` (fleet) and `tlRefresh` (threads) before they draw. It deletes an overlay when `agrees(x)` is true, or when `confirmedAt` is more than 2 minutes old and the response isn't stale. `ANSWERED` becomes the question overlay: keep `markAnswered`'s DOM work, and move its filtering into an overlay `data` function.
- [ ] Rewrite each handler from the spec's §1.1 table onto `press()`, in this order. After each one, run the dashboard by hand on the G1-like `bareProject` and click it with the post held:
  1. `[data-answer]` and goal ask; `[data-cant]`/`[data-reply]`/`[data-dontuse]`; `reviewDecline`; `[data-overrule-send]`;
  2. `reviewAnswer` (it joins `sending()`);
  3. `[data-know]`;
  4. `[data-hold-id]`. The overlay sets `hold_view` as the server's `holdView` would right after the line (mode, `state` from whether the goal has running sessions in `DATA`, `by: 'owner'`, `since: now`), and each of the goal's questions' `goal_hold`. Let go/restore set the goal's `status` (read `goal decide`'s effect at ~7817);
  5. `[data-fleet]`, with a fleet overlay;
  6. `[data-preview-stop]`/`[data-preview-start]`; `[data-forget]`; `[data-correct-send]`;
  7. `[data-post-secrets]`. It shows "Posting…" without filtering the card, wipes the values when the post returns either way, and calls `markAnswered` only if `out` matches `/is answered/`, as today;
  8. thread `tlSend`/`tlAct`. The overlay appends `{ pending: true, by: 'owner', text, at: new Date().toISOString() }` to the open thread's turns. `build()` reads `TL.open` when it runs, so a second Send after a `thread-new` says into the new id. `tlSeen`/`tUnread` skip `pending` turns. The state line reads "Sending…" until the reply sets "Sent." or the waiting words from `out`, as today.
- [ ] Add `beforeunload` while `PRESSES.size > 0`, and `#saving` in the header: "Saving…" while any press is in flight. Find the header's markup near `#err`/`#updated`.
- [ ] Commit per group of handlers.

### Task 8: Tests: presses in Chrome, spawn counts

**Files:** `test/dashboard.test.mjs`, `test/components.test.mjs`.

- [ ] `POLL_FAST` gains `window.__postHold`: when set, every `fetch` POST to `/api/` awaits it.
- [ ] A new driven test, "presses: the page answers before the server", on a `bareProject` with:
  - a question with choices, a review question if the fixture helpers make one cheaply, a lesson candidate, a goal, and a thread;
  - for each press in §1.1 that the fixture can show: hold, click, assert the result is drawn (and `window.__saving > 0`, exposed by the page as `PRESSES.size`), release, assert the server's state;
  - a refusal: answer a question after changing it with `rate`, which doesn't change the hash, so instead rewrite its line so that `seen` mismatches. Use the existing pattern in the threads/answer tests that makes `rewritten`. The card comes back with its draft and pick, and the error reads "Not saved:";
  - a refresh mid-press: hold the post, let two polls land (`polls(2)`), and the card is still answered;
  - two hold presses (drain, then run) land in that order (read `goal show`);
  - two Sends on a new thread make one thread with two turns;
  - a pending turn doesn't move the unread mark.
- [ ] Spawn counts in `components.test.mjs`:
  - a fixture built with the helpers: 40 tickets (10 with branches carrying two review files each), 40 log files, 3 tags;
  - a `PATH` shim script that appends to a counter file, then `exec`s the real git;
  - run `dashboard-data` twice and count the second run;
  - build the same with 10 tickets (3 with branches) and 10 files;
  - assert the counts are equal. If a small residue scales, find it and fix it rather than loosen the test.
  - `answer` with `DEVTEAM_REPLY_FD` unset spawns at most a fixed number, the same at both sizes;
  - `peek ticket` likewise.
- [ ] Full suite on Node 24, then `bounds.test.mjs` alone.
- [ ] Commit.

### Task 9: Measure on Stacks, verification, PR

- [ ] On this Mac, back to back, today's main kit vs this branch, each run three times, read-only, against `~/Documents/Code/stacks`. Use `DEVTEAM_OWN_KIT=1` and run the branch's script with `cwd` at stacks. Check that it resolves stacks' project from cwd and not from the script's location; if not, copy the branch's script into a temp clone of stacks.
  - Measure `dashboard-data`, `peek ticket <id>`, and `questions --id <qid>` as a stand-in for an answer's read.
  - Do a real `answer` only on a scratch clone, never on Stacks itself.
  - Record wall and CPU time with `/usr/bin/time`.
- [ ] Diff `dashboard-data` JSON, main vs branch, on the scratch clone, untimed. It must be identical.
- [ ] Write `docs/superpowers/plans/2026-11-11-instant-presses.verification.md`: each spec target, measured; the spawn counts; the diff result; what is left (threadsRead's sync fold, measured).
- [ ] Push the branch and open a PR. Its body: what, why, measurements, risks, the attribution line.
- [ ] Fable adversarial review of the PR diff. Fix what it finds, re-run the suite, push. Read `gh pr view --comments`; CI green. Stop at merge-ready.
