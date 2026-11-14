# Supervisor threads follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Close the seven non-blocking follow-ups left after supervisor threads shipped (#185, #194, #205, #215). Nothing the owner sees changes except one edge case that now behaves: a thread's question no longer flashes "Answer it in the Inbox" after an answer from elsewhere. The swallowed click under the overlay (task 7) stays, and the spec says why.

**Amended after an adversarial review** (the amendments override the first draft): task 2 keeps an in-process memo only, task 5 moves two tests' ports instead of adding an env var, task 6 redraws the card from the page's data directly, and task 7 is a spec note only.

**Branch:** `threads-followups` off `origin/main` (c2b5ead), worktree `../devteam-threads-followups`. One PR, with one commit per task. Never rebase.

**Rules:**
- Extend existing files; add no new source or test files.
- Run Node 24 locally on the affected test files only, and let CI cover the rest.
- **Process safety:** never `pkill`, `killall` or `kill` by pattern or name. Only stop pids or process groups you started. Other sessions on this Mac run the same test files.

**Tech stack:** Node 18 built-ins only, vanilla browser JS, `node:test`, Chrome over CDP.

**Spec:** `docs/superpowers/specs/2026-11-10-supervisor-threads-design.md`. §8 is edited by task 3, §4 by task 7.

---

## Task 1: Boot clears the pane mark too (cloud/Dockerfile)

**Why.** After a restart, pane ids start again at `%0`. Boot already removes `run/supervisor-pane` (`cloud/Dockerfile:283`). `run/supervisor-pane-role`, written beside it since #205, is left behind. A mark on its own counts for nothing (`markedPane` needs the two files to agree), so this is tidiness. It also stops a stale mark from ever agreeing with a newly written bare record that happens to reuse the same id.

**Files:**
- `cloud/Dockerfile:283`
- `test/machine.test.mjs`, next to "the box's boot keeps the list in the form recover reads" (~line 582)

- [x] **Step 1: Write the failing test.** In `test/machine.test.mjs`, after the existing boot test, add:
  ```js
  test('the box\'s boot forgets every repo\'s noted pane and its mark', () => {
    const df = fs.readFileSync(path.join(REPO, 'cloud', 'Dockerfile'), 'utf8');
    const line = df.split('\n').find((l) => l.startsWith('rm -f "$HOME"/code/*/docs/devteam/run/supervisor-pane'));
    assert.ok(line, 'the boot line');
    const home = fs.mkdtempSync(path.join(tmp, 'boot-'));
    const run = path.join(home, 'code', 'a', 'docs', 'devteam', 'run');
    fs.mkdirSync(run, { recursive: true });
    for (const f of ['supervisor-pane', 'supervisor-pane-role', 'supervisor-up.json']) fs.writeFileSync(path.join(run, f), '%3\n');
    execFileSync('sh', ['-c', line], { env: { ...process.env, HOME: home } });
    assert.deepEqual(fs.readdirSync(run).sort(), ['supervisor-up.json'], 'the pane and its mark gone; the up record kept');
  });
  ```
- [x] **Step 2:** Run `node --test --test-name-pattern="forgets every repo" test/machine.test.mjs`. Expect a FAIL: `supervisor-pane-role` is still there.
- [x] **Step 3: Implement.** In `cloud/Dockerfile:283`:
  ```sh
  rm -f "$HOME"/code/*/docs/devteam/run/supervisor-pane "$HOME"/code/*/docs/devteam/run/supervisor-pane-role
  ```
  Extend the comment above it, at `:278-279`, which says pane ids restart at `%0`, to say that the mark goes with the record.
- [x] **Step 4:** Re-run. Expect PASS.
- [x] **Step 5:** Commit: `box: boot forgets the pane mark with the pane`.

---

## Task 2: Memoize `kitHasRecover` in-process (devteam.mjs)

**Why.** `kitHasRecover(root)` (`devteam.mjs:12145`) spawns the repo's own kit with `help` every time it is asked: `recover --machine` once per repo, `machine status` and `tell` through `notedPaneOf`.

**Approach (amended).** An in-process `Map` only, keyed by `root` plus the kit file's size and mtime, so an upgraded kit in a long-lived process is asked again. No on-disk cache: a shared file in `~/.devteam` is one more thing every kit on the machine reads and writes, for a saving of one spawn per repo per command. A `help` that failed or timed out (`projectKit` returned null) is never kept, so a slow box asks again next time. If the kit can't be stat'ed, nothing is kept and the answer is today's.

**Note.** Every current caller asks once per repo per process, so the memo saves nothing observable today; it guards a second ask in one command. There is no new test: none could see it. The existing legacy-kit cases in `test/machine.test.mjs` and `test/recovery.test.mjs` cover the answer itself.

**Files:** `docs/devteam/scripts/devteam.mjs:12142-12145`.

- [x] **Step 1: Implement** `kitRecoverSeen` and `kitHasRecover(root)` as above, keeping the comment's meaning ("from its own help: what it says it does").
- [x] **Step 2:** `node --test test/machine.test.mjs test/recovery.test.mjs`. Expect PASS.
- [x] **Step 3:** Commit: `machine: a repo's kit is asked whether it has recover once per process, and a failed help is never kept`.

---

## Task 3: A published tree is served only for its own slug (devteam.mjs)

**Why.** `/artifact/tree/<tree>/<slug>/…` (`devteam.mjs:13285-13302`) and `artifactAt('tree:<id>', slug)` (`:6946`) accept any tree with an `artifact.json` at its top, under any slug. A tree id and a slug from two different artifacts serve artifact B's files under artifact A's name, in the viewer's bar and in a thread's subject.
- It is not a leak. Only landed artifact folders are servable, all from one origin.
- It is a mislabel, and the spec §8 note says the slug "can't be checked".
- It can be checked: the tree has to have been `<ARTIFACTS_REL>/<slug>` at some commit on main.

**Approach (amended order).** `artifactTreeOk(id, slug)` and `artifactTreeOkSync(id, slug)`, memoized on `slug + '\0' + tree`, true answers only:
0. **First, the existing cheap check** (`cat-file -t` is `tree` and `<tree>:artifact.json` exists). Only then the slug's binding.
1. **Fast path.** Main's tree for the slug now (`git ls-tree <mainRef> -- <ARTIFACTS_REL>/<slug>`, as `publicArtifact` reads it) is `tree`. That is the common case: the published version is what main has.
2. **Otherwise, main's history.**
   ```
   git log --format= --raw --no-abbrev -t -m --first-parent --no-renames <mainRef> -- <ARTIFACTS_REL>/<slug>
   ```
   One process; it walks only the commits that touch that folder.
   - `-t` lists the tree entries themselves.
   - `-m --first-parent` diffs merges against main's previous state, so a tree that arrived by a merge is listed.
   - Accept if any raw line `:<m1> <m2> <old> <new> <st>\t<path>` has `path === <ARTIFACTS_REL>/<slug>` and `new === tree`.
3. A comment notes that `gitReadCache`, when a read-only command turns it on, keeps the sync reads for that one process, and that a shallow clone's history stops short, so an older version there is no one's (the viewer shows main).
4. Memoize a true answer only. A false one may become true once main gains the tree; a tree id is content-addressed, so a later landing can make it right.

`artifactTreeOk(id)` and `artifactTreeOkSync(id)` become `(id, slug)`. Callers:
- `:13302` passes `am[3]`;
- `artifactAt` (`:6949`) passes `slug`;
- grep `artifactTreeOk` for any others.

**What the gateway does.** It is untouched. Its `/artifact/tree/` grant is already keyed on "this port's binding published `<slug>` at `<tree>`" (spec §8), and it forwards to the kit, so the kit's check covers both the direct and the wrapped viewer.

**Files:**
- `docs/devteam/scripts/devteam.mjs`, at `:6945-6962` and `:13299-13302`
- spec §8, the line at `:187`
- `test/dashboard.test.mjs`, in "the viewer: its route and headers…" (~`:1167`)

- [x] **Step 1: Write the failing test.** Extend the viewer test.
  - Land a second artifact `other-mock`: `landArtifact(F, 'other-mock', VIEWER_MOCK.replace(...))`, with a different title.
  - Assert `fetch(\`${B}/artifact/tree/${T2}/viewer-mock/\`)` is 404, and that `view({ slug: 'viewer-mock', at: \`tree:${T2}\` })` is 404.
  - Assert the same tree under its own slug is 200.
  - Edit `viewer-mock` on main and land it, so main's tree moves to `T3`. Assert that the old `T` under `viewer-mock` is still 200, by history, and that `describe --at tree:<T>` exits 0 in a fresh process. Ask this pair only after main moved and before the test's `git rm` of the folder.
  - In the same test, `artifact describe viewer-mock --at tree:<T2>` must exit 3.
- [x] **Step 2:** Run `node --test --test-name-pattern="the viewer: its route" test/dashboard.test.mjs`. Expect FAIL: 200 for the crossed slug.
- [x] **Step 3: Implement.** Add a shared parser:
  ```js
  // Was <tree> ever <slug>'s folder on main? Main's tree now, else main's history of that folder:
  // only those commits are walked, merges against main's previous state (decision 12, tightened).
  const artifactTreeBound = new Set();
  const treeInHistory = (out, slug, tree) => out.split('\n').some((l) => { const m = /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) \S+\t(.*)$/.exec(l); return m && m[1] === tree && m[2] === `${ARTIFACTS_REL}/${slug}`; });
  ```
  - Sync: `git(['log', '--format=', '--raw', '--no-abbrev', '-t', '-m', '--first-parent', ref, '--', `${ARTIFACTS_REL}/${slug}`], mainRoot)`.
  - Async: `execFile` with the same args and `maxBuffer: 16 MB`.
  - Check what `git()` does with paths that need quoting. Slugs are `LINK_ID` (lowercase words with `-`) and `ARTIFACTS_REL` is fixed, so git never quotes them.
  - Update the comment at `:6953-6956`: "its slug is checked against main's history of its folder".
- [x] **Step 4:** Edit spec §8 (`:187`): "Only an artifact folder's tree is served, and only under the slug whose folder it was on main (main's tree now, or main's history of that folder)…"
- [x] **Step 5:** Re-run the viewer test, then the other `tree:` tests: `node --test --test-name-pattern="tree|viewer|published" test/dashboard.test.mjs test/kit.test.mjs`. Expect PASS.
- [x] **Step 6:** Commit: `artifacts: a published tree is served only under the slug it was on main`.

---

## Task 4: Test `/api/view`'s 500

**Why.** `/api/view` (`devteam.mjs:13164-13182`) answers 500 when `artifact describe` fails for any reason other than exit 3 ("nothing there"). Only the page's handling of a 500 is tested (`dashboard.test.mjs:1826`, with a faked fetch). The server path is not tested.

**How to make `describe` fail for real.** Use a draft worktree whose artifact folder has an unreadable subfolder.
- `draftWorktree` needs only a folder under `<root>/.worktrees/` (`:6917`).
- `artifactSource` returns `{ entries: diskEntries(dir) }`, and `diskEntries` calls `readdirSync` on the subfolder, which throws EACCES. Nothing catches it, so `describe` exits 1 and the server answers 500.
- Skip the test as root (`process.getuid?.() === 0`), where permissions don't hold. Check the CI runner isn't root (GitHub's runner user isn't); the skip still keeps Docker runs honest.

**Files:** `test/dashboard.test.mjs`, in the viewer test after the 404 cases (~`:1206`).

- [x] **Step 1: Write the test.**
  ```js
  // describe failing (not "nothing there") is a 500 in words of its own, never mistaken for a 404
  if (process.getuid?.() !== 0) {
    const dir = path.join(F.old, '.worktrees', 'demo-01-locked', 'docs/devteam/project/artifacts/viewer-mock');
    fs.mkdirSync(path.join(dir, 'locked'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'artifact.json'), '{}');
    fs.writeFileSync(path.join(dir, 'index.html'), '<p>x</p>');
    fs.chmodSync(path.join(dir, 'locked'), 0);
    try {
      const r500 = await view({ slug: 'viewer-mock', at: 'demo-01-locked' });
      assert.deepEqual([r500.status, await r500.json()], [500, { error: 'the artifact could not be read' }]);
    } finally { fs.chmodSync(path.join(dir, 'locked'), 0o755); }
  }
  ```
  - Check that `demo-01-locked` matches `WT_NAME` and isn't `review-`/`tmp-`.
  - (Amended) The mode is restored in the test body, right after the assertion: `node:test` runs `t.after` hooks in registration order, so one registered now would run after the fixture's `F.done` had already failed to delete the folder.
- [x] **Step 2:** Run `node --test --test-name-pattern="the viewer: its route" test/dashboard.test.mjs`. Expect PASS. The code exists; this is coverage.
- [x] **Step 3: Prove it would catch a regression.** Temporarily change the server's `r.code === 3` to `r.code !== 0`, see the test fail, then revert.
- [x] **Step 4:** Commit: `test: /api/view says 500 when describe fails`.

---

## Task 5: Test dashboards' port layout, stated as it really is (tests only)

**Why.** Each test process claims 100 ports, `PORTS..PORTS+99` (`test/lib/ports.mjs`). The focus and presses tests (`test/dashboard.test.mjs:533` and `:420`) set bases `+81` and `+91`, whose nominal 25-wide ranges run past the block.

**What really scans (amended).** A dashboard pinned with `--port` never scans (`devteam.mjs` returns the pinned port before probing), and the hub probes `PORT_RANGE` only for `/instances.json`. Both tests pin their dashboard with `--port freePort()` and never ask the hub's list, so only their hub port is bound. No kit change and no `DEVTEAM_PORT_SPAN`.

**Approach.** Move the two tests to spots nothing else in the file binds or scans: focus `+56/57`, presses `+58/59` (the viewer test scans `+31..55`, the hub test `+61..85`, the relays bind `+62..79`). Rewrite the `test/lib/ports.mjs` comment with the real rule and the layout:
- a dashboard that picks its own port, or a hub asked for its list, scans base..base+24, so that base must be `+75` or lower;
- a pinned test that never asks the list scans nothing, and only its hub port must be in the block and free of anything an earlier test in that file binds.

- [x] **Step 1:** Move the bases; rewrite the comment.
- [x] **Step 2:** Run the focus and presses tests by name. Expect PASS.
- [x] **Step 3:** Commit: `test: the focus and presses tests' hubs sit at ports nothing else in the file uses, and the port layout says the real rule`.

---

## Task 6: No "Answer it in the Inbox" after an answer from elsewhere (index.html)

**Why.** The thread card's copy of a question comes from `/api/threads`, polled every 2 s while the card is open (`index.html:4715`) and every 5 s in a viewer. The Inbox's copy comes from `/api/data`, polled every 10 s (`:5574`).

When the owner answers from the command line or another tab, two outcomes are possible:
- `/api/threads` sees it first: the card shows the answer. Fine.
- `/api/data` lands first: it no longer lists the question as open, while the card's copy still says `open`. `tlQuestion` (`:4609-4615`) then falls to the bare "Answer it in the Inbox" link (`:4613`) until the next threads poll, up to 2 s.

(This tab's own answer is already covered by `ANSWERED`; #189 keeps it while a thread copy says open.)

**Approach.** `/api/data` already carries the answer: `DATA.ooda.answered` (`devteam.mjs:11132`, the 80 newest that aren't open) has `answer`, `channel` and `status`.
- In `tlQuestion`: when the thread copy says `open` but `DATA` has the question in `ooda.answered`, draw it as answered from there, in the same markup as the not-open branch.
- Derive "answered" from `DATA.ooda.answered` through one helper, `dataAnswered(id)`, whose comment says it holds only the 80 newest.
- Add whether the question is in `ooda.answered` to the card's redraw signature (`:4646`).
- (Amended) `drawOrHold` ends in `tlPins(); tlRefresh();` and never redraws the card itself, so a signature change alone waits for the next threads read. Add a direct `tlCard()` before them, so `/api/data`'s answer redraws an open card. No second `tlRefresh()`.
- The viewer has no `DATA` and keeps today's behaviour: its Inbox link is the only way to answer there.

**Files:**
- `docs/devteam/dashboard/index.html:4609-4615` and `:4646`
- the end of the data draw (after `drawOrHold`, ~`:5204`)
- `test/dashboard.test.mjs`, in the threads browser test, next to "a secrets question in the thread is a link to the Inbox" (`:3165`)

- [x] **Step 1: Write the failing test (amended: the stale-read race).** After the "read of the threads begun before an answer" test (`:3165`), with the same `__threadsQueue` hold and `MutationObserver`, on a plain question (a secrets one shows the link while open, rightly):
  1. Let a threads read through and hold its answer (it says open).
  2. Answer from the command line: `F.owner(['answer', Q, …])`.
  3. Kick `load({ force: true })`, but wait on `DATA?.ooda?.answered` containing the id, not on the call.
  4. Assert the open card shows the answer before any threads read lands.
  5. Release the stale reads; assert the card drew the stale copy (`open`), the observer never saw the link, and the card says the answer and "answered in your terminal".
  6. Release the rest; assert the log's copy lands and still no link.
- [x] **Step 2:** Run the threads page test. Expect FAIL: the card isn't redrawn from the data.
- [x] **Step 3: Implement.** In `tlQuestion`, before the `q.status === 'open'` link line:
  ```js
  // answered elsewhere (the CLI, another tab): /api/data can say so before /api/threads does
  const said = q.status === 'open' && !open ? (DATA?.ooda?.answered || []).find((x) => x.id === q.id) : null;
  if (said) return `<div class="card small tl-q"><div>${qinline(q.question, q.links)}</div>${said.answer ? `<div><b>${esc(said.answer)}</b></div>` : ''}<div class="meta">${esc(said.status === 'answered' ? `answered ${CHANNEL_WORDS[said.channel] || ''}` : said.status)}</div></div>`;
  ```
  - Factor the not-open branch and this one into one helper, `tlDone(q, a)`, so they can't drift.
  - Signature at `:4646`: add `(DATA?.ooda?.answered || []).some((x) => x.id === q.id)` to the per-question tuple.
  - In `drawOrHold`, `tlCard();` before `tlPins(); tlRefresh();`.
- [x] **Step 4:** Re-run. Then run the neighbouring thread-question tests by name, `tlQuestion|Inbox|answered`, including `:3137`'s stale-read test. Expect PASS.
- [x] **Step 5:** Commit: `dashboard: a thread's question answered elsewhere shows its answer as soon as either read says so`.

---

## Task 7: The click the overlay swallows stays, and the spec says why (spec §4 only)

**Amended: the click hand-over is dropped.** Handing the owner's press to the lens as a `click {x, y}` order would turn the read-only bridge (§6), which only ever reports what is under a point, into one that acts on the page for the parent. The loss is narrow: any pointer move without Shift lowers the overlay first, so only a click with no pointer motion at all is consumed.

- [x] **Step 1:** Spec §4 step 4 says plainly that the swallowed click needs zero pointer motion and is kept deliberately, because forwarding would make the §6 bridge one that acts.
- [x] **Step 2:** Commit: `spec: a click under the overlay is lost only with no pointer motion, and is kept so the lens stays read-only`.

---

## Finish

- [ ] Node 24: `node --test test/machine.test.mjs test/recovery.test.mjs test/gateway.test.mjs`, then `node --test --test-concurrency=1 test/dashboard.test.mjs`. That last run is heavy: run it once, at the end, without killing anything you didn't start.
- [ ] Update the memory follow-up list (`supervisor-threads-progress.md`): all seven closed.
- [ ] Open the PR "Supervisor threads: follow-ups", with one section per task.
  - Note for the box operator: the Dockerfile's boot line changed (task 1), which takes effect at the next image deploy. The gateway is untouched.
  - End the PR body with the attribution line.
- [ ] Fable adversarial review of the PR. Fix findings, re-run the affected tests, and stop at merge-ready. Merging is the upstream loop's job.

## Risks and open questions

- **Task 3, history size.** `git log -- <folder>` is cheap: it walks only the commits that touch it, and the answer is cached once true. For a very old artifact with a huge history, the first ask after a restart takes one `git log`. The `/artifact/tree/` handler is async (`execFile`), so the server isn't blocked. `describe` is sync, but it runs in a child process.
- **Task 3, rewritten history.** A tree published from a commit that was later squashed out of main would 404, and the viewer falls back to main as it does for any missing tree. Main is never force-pushed in this workflow, so this is acceptable.
- **Task 5.** If either test ever stops pinning `--port`, or asks the hub's list, its base must drop to `+75` or lower (the rule in `test/lib/ports.mjs`).
- **Task 2.** Saves nothing today (each command asks once per repo); it costs one `stat` per ask.
- **Task 4.** It relies on POSIX permissions; it skips as root.
