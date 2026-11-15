# kit-208 plan: a repo link can keep its tickets' records in home

## TL;DR

- One new repo-link field, `records` (`"repo"` default, or `"home"`), never inherited; validate refuses other values.
- `recordsInHome(t)` (settings only) routes every reader and writer; records live on **home's** `ticket/<id>` under home's `project/tickets/<id>/`, code on the link's `ticket/<id>`.
- Final reviews of such tickets carry `- Records: <home sha>`; a verdict holds only if both the link sha and the records sha hold (today's `verdictHolds`, each in its repo).
- `checkTicket` reads home's records, drops the link folder exemption, refuses a records branch that changes anything but its own folder; home's `check-pr` on a records branch runs only that footprint check.
- `merge` pins one records sha, checks it, lands the records first (skipped once they landed), then the code, then logs the act naming both; a failed code landing exits non-zero and a rerun finishes.
- `worker`, `review-worktree`, park/settled/fleet status, `--remove`, tidy, `approve-plan`, `timeline`, `ticketReviews` and `merged-without-merge` follow; default behaviour is unchanged.
- All in `devteam.mjs`; tests appended to `test/multirepo-home.test.mjs`.

## Files and gates

Only `touches`: `docs/devteam/scripts/devteam.mjs`, `test/multirepo-home.test.mjs` (plus this
ticket's folder). Each test file runs alone, through the recorder:
`node /data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs gate test -- node --test --test-concurrency=2 test/<file>`
for `multirepo-home.test.mjs` (the only test file in touches) after every task; nothing else runs
on the box (ruling m-20261115-183216730). The exit code is read directly (no pipes). CI runs the
full suite, including the default-path multirepo tests, and is the gate.

## Tasks

Each task is TDD: write its test(s) in `multirepo-home.test.mjs`, see them fail, implement, see
them pass, commit, task review (`reviews/task-<n>.md`, fresh subagent).

### T1: the setting and the helpers

- `REPO_KEYS` += `records`; `REPO_OWN_DEFAULTS.records = 'repo'`; `LINK_TYPES.records = 'string'`;
  `LINK_KINDS.repo.validate`: present and not `repo`/`home` → `${at}: records is "repo" or "home"`.
- `recordsInHome(t)`: link of `t` (`repoOfTicketLink`) is not home and its
  `effectiveSettings(l, committedComponents()).records === 'home'`; `recordsInHomeId(id)`.
- `homeRecordsRef(id)` = `homeTicketBranchRef(id)` (home local, else origin `ticket/<id>`).
- `parseReview` gains `records` (`- Records: <sha>` line; valid only as 40 hex).
- `approve-plan`'s plan read (~8957) goes through home for these tickets (`ticket/<id>` then
  `origin/ticket/<id>` resolved in home, home's `projectRel`), here in T1, because the T2 and T3
  tests need an approve-plan act. `ticketReviews` (used by its goal-door check) ignores a passed
  link `src.repo` for these tickets and reads home.
- Test: `link set console records nope` refused with the message; `links --json` shows
  `effective.records` `repo`, then `home` after a valid set landed.

### T2: check-ticket and check-pr read home

- `checkTicket(id, { …, records })`, for records in home: `recSha` = `records` ?? resolve
  `homeRecordsRef(id)`; none → `no records for <id> in home: commit them under <projectRel>/tickets/<id>/
  on home's ticket/<id>` and skip the record checks. Source `{ ref: recSha }` (home).
  `recordsBranchFails(id, recSha)`: home main merge-base three-dot changed files outside
  `<projectRel>/tickets/<id>/`. `own` exemption null. For every latest final APPROVE: also needs
  `r.records` (else `<file>: no "- Records: <sha>" line …`) and
  `verdictHolds(r.records, recSha, '<projectRel>/tickets/<id>/reviews/', repo('home'))`
  (else `… records verdict at X does not hold at Y`); approvers count only reviews holding at both.
- `cmdCheckTicket`: `--records <sha>` flag.
- `ticketReviews(id, src)`: records in home → home (any `src.repo` ignored); a non-sha `src.ref` re-resolved as
  `homeRecordsRef(id)` (none → []); no ref → home `mainRef()`.
- `checkPr`: in home, `ticket/<id>` of a records-in-home ticket → `recordsBranchFails` and return,
  placed before the "a ticket of <link>, not home" return;
  passes `records` to `checkTicket`. `cmdCheckPr --repo <link>`: fetch home's
  `+refs/heads/ticket/<id>:refs/remotes/origin/ticket/<id>` for a records-in-home ticket.
- Tests: before records, `check-ticket` fails `no records`; with records (spec, plan,
  verification, `final-1.md` and `final-1b.md` with `- Records:`), passes; a link file under
  `docs/devteam/project/tickets/<id>/` → `outside touches`; records branch touching `README.md`
  → footprint failure, and home `check-pr --head-ref ticket/<id>` says the same, and passes
  without it; verification edited after review → records verdict doesn't hold; no `- Records:` →
  refused. Each refusal is asserted through both `check-ticket` and `merge --dry-run` (T3's
  pinned path) once T3 lands.

### T3: merge

- Records in home: fetch home's `ticket/<id>` into `origin/ticket/<id>`. "The branch is gone" is
  decided by that fetch failing (the stale `origin/ticket/<id>` ref, if any, is then not used).
  Order: first `recordsLanded` (below), then, only when not landed, the open-branch path. `recSha` pinned: home forge `git` → fetched ref;
  else `repo('home').gh(['pr','view','ticket/<id>', …])`: missing/draft/`BEHIND`/`DIRTY`/head ≠
  fetched/checks pending or failing → refused (rollup logic factored into `forgeCheckFails(pr, ignored)`,
  used for both PRs). Missing ref → `no records for <id> in home: push home's ticket/<id>`.
- Records already landed (`recordsLanded`): home forge `git` → `recSha` is an ancestor of home
  `origin/<main>`; else `gh pr list --head ticket/<id> --state merged --json number,headRefOid`, the
  newest whose head is the fetched ref (the newest of any, when the fetch said the branch is gone): `recSha` = its head, fetched
  from `refs/pull/<n>/head`. Then the open-PR checks are skipped and landing (a) is skipped.
- `checkPr(…, records: recSha)`; dry run: `ok: … would merge in <link>, records at <sha12> in home`.
- Refactor first: today's link landing dies inside (`viaGit` push refused, `gh pr merge` refused);
  it becomes `landCode()` returning null or its reason, so merge can print the records-landed
  message. `landRecords` uses `detachedWorktree(…, repo('home'), { seed: false })`.
- The records merge's message is merge's own, never read from `run/pr/` (that file is the link
  PR's): forge `git`: subject `<id>: records`, body `Merged home's ticket/<id> at <recSha>: the
  records of <id>, whose code lands in <link>` (no `from …ticket/<id>` / `Merge … ticket/<id>`
  wording that `findMergeSha` reads); GitHub: `gh pr merge` with `--subject` and `--body` the same.
  Home's `mergeShaFor` is never asked about a link ticket (`factsRepo` routes it to the link).
- Landing: `landRecords` unless `recSha` is in home's `origin/<main>`: home forge `git` →
  detached worktree at home `origin/<main>`, `merge --no-ff recSha`, push; else `gh pr merge
  --<home merge_method> --match-head-commit recSha`. Failure → die (nothing else landed). Then the
  link lands as today; on failure after records landed → die with
  `the records of <id> landed in home at <sha12>; the code did not land in <link> (…): run merge <id> again`.
  Act `what`: `merged ticket/<id> at <sha>; records at <recSha> in home`.
- `merged-without-merge`: heads = every `\bat ([0-9a-f]{40})\b` match in each act's `what`.
- Tests (done-when 3): happy merge (console main code only, home main records, act both shas);
  `merge --dry-run` before records → `no records`; records-first: a pre-receive hook on console's
  bare origin refuses once → non-zero, message, records on home `origin/main`, no act; hook gone →
  `merge` lands, act logged. Pinning: home's local `ticket/<id>` gets an unpushed commit that
  edits `verification.md` → `check-ticket` (local) refuses (records verdict), `merge --dry-run`
  (origin, pinned) passes; and the reverse (origin bad, local good) → merge refuses. `metrics --json` has no `merged-without-merge` for it afterwards.
  GitHub path with a `gh` stub on PATH (home `forge` unset = github; console's `forge` set to
  `git` so the link side stays stub-free; the stub answers `pr list
  --state merged` with the records sha and `pr view` with no open PR; `refs/pull/1/head` written
  in home's bare origin): `merge --dry-run` passes the records checks without an open PR and says
  it would land only the code; the same with home's `ticket/<id>` deleted on origin (branch
  gone, merged PR found first); with no merged PR and no open PR it is refused `no open home PR`.

### T3b: the half-done merge (records landed, code not)

Ruling m-20261115-185317950-supervisor. The case: merge landed the records on home's main, then
the link landing failed (push refused, `gh pr merge` refused: head moved, checks, protection) or
merge was stopped there.

- **The state it leaves.** Home's main has the merge of home's `ticket/<id>` (the records); the
  link's main doesn't have the code; no merge act is logged; both branches are as they were. The
  ticket is not merged (`mergeShaFor` reads the link), so nothing downstream (dependants,
  releases, the worker's `--remove`) treats it as done.
- **The retry is safe (idempotent).** `merge <id>` again runs every check again at the same
  pinned records sha; `recordsLanded` finds them on home's main (git: ancestor; GitHub: the
  merged home PR at that head) and skips landing them, so they are never merged twice; then it
  lands the code and logs the one merge act naming both shas. Running it a third time after
  that is today's "already on main: nothing to merge, nothing logged". If home's `ticket/<id>`
  moved after the records landed (a new commit), the records checks run at the new head, which
  holds no fresh final review over it unless one was added, so the retry refuses rather than
  landing unreviewed records.
- **What status shows.** `deriveStatus` gains `records_landed: true` for an active (not
  superseded) records-in-home ticket that isn't merged and whose records folder is on home's main
  (`<projectRel>/tickets/<id>/spec.md` at home's main ref); `status` prints
  `records in home, code not merged: run merge <id> again` on its row. `observe-metrics` /
  `metrics` raise one high finding `records-without-code` (subject the ticket, the same fix
  line, active tickets only). `merged-without-merge` keeps firing on that home merge commit, as
  the spec says (records landed with no merge act is true); the new finding is the one that names
  the fix. Once the retry lands the code, the act names the records sha and all three go away.
- **Test** (in T3's merge test, after the refused push): exit non-zero with the records-landed
  message; home's `origin/main` has the records, console's `origin/trunk` doesn't have the code;
  no merge act; `status --json` row `records_landed: true` and `status` text names the retry;
  `metrics --json` has `records-without-code` for the ticket and `merged-without-merge` for the
  home records merge;
  hook removed, `merge` lands only the code (home's main gains no second records merge: its
  merge count for `ticket/<id>` is 1), logs one act; then `records_landed` and the finding are
  gone, and so is `merged-without-merge`; a third `merge` prints `nothing to merge, nothing logged`.

### T4: worker, prompt, review-worktree, remove, tidy, approve-plan, timeline

- `cmdWorker` (worker, records in home): independently of the link worktree,
  `.worktrees/records-<id>` as a home worktree on `ticket/<id>` (local, else tracked from origin,
  else new from home `origin/<main>`), after fetching home's origin `ticket/<id>`; not seeded.
- `promptFor`: records-in-home tail (records worktree, folder, commit and push there, `dispose`
  there, `- Records: <sha>` in final records, nothing of the project in the link, home PR when
  home's forge isn't `git`). Default tail unchanged.
- `review-worktree`: records in home → `<wt>-records` detached home worktree at
  `homeRecordsRef(id)` (none: a warning, no second checkout); prints `records: <path> (<full sha>)`,
  the sha a reviewer writes in `- Records:`;
  `--remove <wt>` also removes `<wt>-records` when it is a home worktree.
- `removeWorkerWorktree`: also removes `records-<id>` through home, prunes home.
- `tidyFinished`: `records-<id>`, home, branch `refs/heads/ticket/<id>`, merged and phase done.
- `timeline` files: home ref (approve-plan moved to T1).
- Tests: `review-worktree` prints `records:` and `--remove` removes both; `approve-plan` refused
  before the plan is on home's branch, accepted after (written in T1); `timeline --json` files have no `repo`;
  (tmux only) `worker` makes `records-<id>` and the prompt names it; `worker --remove` after merge
  and phase done removes both.

### T5: park, settled, fleet status

- `parkMessage`: for a records-in-home worker, adds `also commit and push your records in <records worktree>`.
- `sessionSettled` and fleet status rows: records in home → also home's `ticket/<id>` pushed
  (local = origin) and `records-<id>` clean; problems `records: …` named. A records branch with
  no origin branch whose local head is in home's main, or no records branch at all (local or
  origin), counts as pushed: nothing to lose.
- Test: a parked records-in-home worker with an uncommitted file in `records-<id>` → `fleet status
  --json` row lists the records problem; committed and pushed → none; a fresh records branch with nothing of its own → none.

## Verification

`verification.md`: a row per done-when with the command and result at a named commit; the CI run
(`gh run view` conclusion, every job) at the head.

## Rulings

- m-20261115-183216730-supervisor: risk high; full spec and plan review, two finals; lessons
  k-20261115-182656232, k-20261115-080753394, k-20261115-164245020 in every brief; only touched
  test files at --test-concurrency=2.
- m-20261115-214138678-supervisor (on design-change m-20261115-214129798): accepted. A records landing in home logs its own merge-word act (refs [], "merged home's ticket/<id> at <sha>: the records of <id>, ahead of its code in <link>") instead of the final act inferring earlier landings from git. Change from spec acceptance 3's parenthetical: in the half-done window merged-without-merge doesn't fire on the records merge (merge made it and says so); records-without-code and status records_landed remain the signal. Both finals confirm at the new head.
