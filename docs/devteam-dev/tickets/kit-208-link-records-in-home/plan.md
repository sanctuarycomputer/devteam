# kit-208 plan: a repo link can keep its tickets' records in home

## TL;DR

- One new repo-link field, `records` (`"repo"` default, or `"home"`), never inherited; validate refuses other values.
- `recordsInHome(t)` (settings only) routes every reader and writer; records live on **home's** `ticket/<id>` under home's `project/tickets/<id>/`, code on the link's `ticket/<id>`.
- Final reviews of such tickets carry `- Records: <home sha>`; a verdict holds only if both the link sha and the records sha hold (today's `verdictHolds`, each in its repo).
- `checkTicket` reads home's records, drops the link folder exemption, refuses a records branch that changes anything but its own folder; home's `check-pr` on a records branch runs only that footprint check.
- `merge` pins one records sha, checks it, lands the records first (skipped when already in home's main), then the code, then logs the act naming both; a failed code landing exits non-zero and a rerun finishes.
- `worker`, `review-worktree`, park/settled/fleet status, `--remove`, tidy, `approve-plan`, `timeline`, `ticketReviews` and `merged-without-merge` follow; default behaviour is unchanged.
- All in `devteam.mjs`; tests appended to `test/multirepo-home.test.mjs`.

## Files and gates

Only `touches`: `docs/devteam/scripts/devteam.mjs`, `test/multirepo-home.test.mjs` (plus this
ticket's folder). Each test file runs alone, through the recorder:
`node /data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs gate test -- node --test --test-concurrency=2 test/<file>`
for `multirepo-home.test.mjs` after every task, and for regression `multirepo-landing`,
`multirepo-tickets`, `repo-links`, `link-edits` (the files whose paths these tasks change) after
T3 and T5. The exit code is read directly (no pipes). CI runs the full suite and is the gate.

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
- `ticketReviews(id, src)`: records in home → home; a non-sha `src.ref` re-resolved as
  `homeRecordsRef(id)` (none → []); no ref → home `mainRef()`.
- `checkPr`: in home, `ticket/<id>` of a records-in-home ticket → `recordsBranchFails` and return;
  passes `records` to `checkTicket`. `cmdCheckPr --repo <link>`: fetch home's
  `+refs/heads/ticket/<id>:refs/remotes/origin/ticket/<id>` for a records-in-home ticket.
- Tests: before records, `check-ticket` fails `no records`; with records (spec, plan,
  verification, `final-1.md` and `final-1b.md` with `- Records:`), passes; a link file under
  `docs/devteam/project/tickets/<id>/` → `outside touches`; records branch touching `README.md`
  → footprint failure, and home `check-pr --head-ref ticket/<id>` says the same, and passes
  without it; verification edited after review → records verdict doesn't hold; no `- Records:` →
  refused.

### T3: merge

- Records in home: fetch home's `ticket/<id>`; `recSha` pinned: home forge `git` → fetched ref;
  else `repo('home').gh(['pr','view','ticket/<id>', …])`: missing/draft/`BEHIND`/`DIRTY`/head ≠
  fetched/checks pending or failing → refused (rollup logic factored into `forgeCheckFails(pr, ignored)`,
  used for both PRs). Missing ref → `no records for <id> in home: push home's ticket/<id>`.
- Records already landed (`recordsLanded`): home forge `git` → `recSha` is an ancestor of home
  `origin/<main>`; else `gh pr list --head ticket/<id> --state merged --json number,headRefOid`, the
  newest whose head is the fetched ref (any, when the branch is gone): `recSha` = its head, fetched
  from `refs/pull/<n>/head`. Then the open-PR checks are skipped and landing (a) is skipped.
- `checkPr(…, records: recSha)`; dry run: `ok: … would merge in <link>, records at <sha12> in home`.
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
  `merge` lands, act logged. `metrics --json` has no `merged-without-merge` for it afterwards.
  GitHub path with a `gh` stub on PATH (home `forge` unset = github; the stub answers `pr list
  --state merged` with the records sha and `pr view` with no open PR; `refs/pull/1/head` written
  in home's bare origin): `merge --dry-run` passes the records checks without an open PR and says
  it would land only the code; with no merged PR and no open PR it is refused `no open home PR`.

### T4: worker, prompt, review-worktree, remove, tidy, approve-plan, timeline

- `cmdWorker` (worker, records in home): independently of the link worktree,
  `.worktrees/records-<id>` as a home worktree on `ticket/<id>` (local, else tracked from origin,
  else new from home `origin/<main>`), after fetching home's origin `ticket/<id>`; not seeded.
- `promptFor`: records-in-home tail (records worktree, folder, commit and push there, `dispose`
  there, `- Records: <sha>` in final records, nothing of the project in the link, home PR when
  home's forge isn't `git`). Default tail unchanged.
- `review-worktree`: records in home → `<wt>-records` detached home worktree at
  `homeRecordsRef(id)` (none: a warning, no second checkout); prints `records: <path> (<sha12>)`;
  `--remove <wt>` also removes `<wt>-records` when it is a home worktree.
- `removeWorkerWorktree`: also removes `records-<id>` through home, prunes home.
- `tidyFinished`: `records-<id>`, home, branch `refs/heads/ticket/<id>`, merged and phase done.
- `approve-plan` plan read and `timeline` files: `recordsRepo`/home ref.
- Tests: `review-worktree` prints `records:` and `--remove` removes both; `approve-plan` refused
  before the plan is on home's branch, accepted after; `timeline --json` files have no `repo`;
  (tmux only) `worker` makes `records-<id>` and the prompt names it; `worker --remove` after merge
  and phase done removes both.

### T5: park, settled, fleet status

- `parkMessage`: for a records-in-home worker, adds `also commit and push your records in <records worktree>`.
- `sessionSettled` and fleet status rows: records in home → also home's `ticket/<id>` pushed
  (local = origin) and `records-<id>` clean; problems `records: …` named. A records branch with
  no origin branch whose local head is in home's main counts as pushed.
- Test: a parked records-in-home worker with an uncommitted file in `records-<id>` → `fleet status
  --json` row lists the records problem; committed and pushed → none; a fresh records branch with nothing of its own → none.

## Verification

`verification.md`: a row per done-when with the command and result at a named commit; the CI run
(`gh run view` conclusion, every job) at the head.

## Rulings

- m-20261115-183216730-supervisor: risk high; full spec and plan review, two finals; lessons
  k-20261115-182656232, k-20261115-080753394, k-20261115-164245020 in every brief; only touched
  test files at --test-concurrency=2.
