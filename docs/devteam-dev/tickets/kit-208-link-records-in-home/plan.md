# kit-208 plan: a repo link can keep its tickets' records in home

## TL;DR

- One new repo-link field, `records` (`"repo"` default, or `"home"`), never inherited; validate refuses other values.
- Two helpers route every reader and writer: `recordsInHome(t)` (settings only) and `recordsRepo(id)`.
- Records-in-home tickets keep spec, plan, verification and reviews on **home's** `ticket/<id>`, under home's `project/tickets/<id>/`; the code stays on the link's `ticket/<id>`.
- `checkTicket` reads records from home's branch, judges verdicts at the link head (unchanged `verdictHolds`), drops the link folder's exemption, and refuses a records branch that changes anything but the ticket's own folder.
- `merge` fetches and checks home's records at the exact sha it will land, lands the link PR, logs the act (naming the records sha), then lands the records on home's main; a rerun lands only the records.
- `worker` adds `.worktrees/records-<id>` and says so in the prompt; `review-worktree` adds a `-records` checkout; `--remove`, the tidy, `approve-plan` and `timeline` follow.
- All in `devteam.mjs` and one new test in `test/multirepo-home.test.mjs`; default behaviour unchanged.

## Files

Only the ticket's `touches`: `docs/devteam/scripts/devteam.mjs`, `test/multirepo-home.test.mjs`
(plus this ticket's own folder). Tests run one file at a time:
`node docs/devteam/scripts/devteam.mjs gate test -- node --test --test-concurrency=2 test/<file>`
for `multirepo-home`, and, as regression, `multirepo-landing`, `multirepo-tickets`,
`repo-links` (the files whose code paths these tasks change). CI runs the full suite.

## Tasks

### T1: the setting and the helpers

- `REPO_KEYS` += `records`; `REPO_OWN_DEFAULTS.records = 'repo'`; `LINK_TYPES.records = 'string'`.
- `LINK_KINDS.repo.validate`: `records` present and not `"repo"`/`"home"` → `${at}: records is "repo" or "home"`.
- `recordsInHome(t)`: `repoOfTicketLink(t)` is not home, and that link's
  `effectiveSettings(link, committedComponents()).records === 'home'`. `recordsInHomeId(id)`.
- Test (TDD, in the new test): `link set console records nope` / validate refuses; `links --json`
  shows `effective.records` `repo` by default and `home` once set.

### T2: check-ticket and check-pr read home

- `checkTicket(id, { sha, title, body, approvals, records })`: when `recordsInHome(t)`, the records
  source is `{ ref: recSha }` in home, `recSha` = `records` arg ?? `resolveCommit(homeTicketBranchRef(id))`.
  No `recSha`: one failure, `no records for <id> in home: commit them under <projectRel>/tickets/<id>/
  on home's ticket/<id>`, and the record checks are skipped (never read home's working tree).
  `recordsBranchFails(id, recSha)`: files changed against home main's merge-base outside
  `<projectRel>/tickets/<id>/` refused. `own` (the link folder exemption) is null for these tickets.
  `verdictHolds(v, sha, <link dir>, R)` unchanged: verdicts name the link head.
- `ticketReviews`: `src.repo ?? (recordsInHomeId(id) ? repo('home') : factsRepo(id))`.
- `checkPr`: in home, `ticket/<id>` of a records-in-home link ticket → `recordsBranchFails` only
  (instead of "a ticket of <link>, not home"). Passes `records` through to `checkTicket`.
- Test: `check-ticket` passes with records on home's branch and only `src/main.js` on the link
  branch; fails `no records …` before; a link file under `docs/devteam/project/tickets/<id>/` is
  `outside touches`; a records branch touching `README.md` is refused; home `check-pr --head-ref
  ticket/<id>` passes on the records branch.

### T3: merge

- For `recordsInHome`: fetch home `+refs/heads/ticket/<id>:refs/remotes/origin/ticket/<id>`;
  forge `git`: `recSha` = that ref; forge `github`: home `gh pr view ticket/<id>` (no PR, draft,
  head ≠ fetched ref, checks pending/failing: refused, using the same rollup rule as the link PR,
  factored into `forgeCheckFails(pr, ignored)`).
- `checkPr(…, records: recSha)`; dry run says `… and its records at <sha12> in home`.
- After the link lands: the act's `what` = `merged ticket/<id> at <sha>; records at <recSha> in home`;
  then `landRecords(id, recSha, recPr)`: forge `git`: detached worktree at home's `origin/<main>`,
  `merge --no-ff recSha`, push; `github`: `gh pr merge <n> --<merge_method> --match-head-commit recSha`.
  Failure: die `merged … in <link>, but its records did not land in home (<why>): run merge <id> again`.
- Already-merged short-circuit: link head on link main and records-in-home → find the merge act for
  `merged ticket/<id> at <sha>`; if home main lacks its records sha: the fetched records ref must be
  that sha (else refuse: moved since the merge), `recordsBranchFails` empty, land them, print
  `landed the records of <id> at <sha12> in home`; logged as nothing new (the merge act already
  names them).
- Test (done-when 3): console `records: "home"`; ticket with code-only link branch, records on
  home's `ticket/<id>` (two finals for risk high, or one for normal); `merge` → console main has
  the code and no `docs/devteam/project/`; home `origin/main` has the four record files; act names
  the records sha. Before the records are pushed: `merge --dry-run` fails `no records`. Partial
  landing: make home's push fail once (home origin made read-only for the push, or main moved by
  a conflicting push isn't possible for records-only… use a `pre-receive` hook on home's bare
  origin that refuses once), assert the message, then rerun lands only the records.

### T4: worker, review-worktree, remove, tidy, approve-plan, timeline

- `cmdWorker` (role worker, records in home): after the link worktree, `.worktrees/records-<id>`
  as a home worktree on `ticket/<id>` (local, else `origin/ticket/<id>` tracked, else new from
  home `origin/<main>`); not seeded.
- `promptFor`: for records in home, the tail names the records worktree and folder, says commit and
  push there (and open a home PR with the same title when home's forge isn't `git`), run `dispose`
  there, and put nothing of the project in the link. Default tail unchanged.
- `review-worktree`: for records in home, `<wt>-records`, a detached home worktree at
  `homeTicketBranchRef(id)` (none: a warning, no second checkout); prints `records: <path>`.
  `--remove <wt>` also removes `<wt>-records` when it is a home worktree.
- `removeWorkerWorktree`: also removes `records-<id>` through home (and prunes home).
- `tidyFinished`: `records-<id>`, home, on `refs/heads/ticket/<id>`, ticket merged and phase done.
- `approve-plan`'s plan read and `timeline`'s files: `recordsRepo`.
- Test: (tmux only) `worker` makes `records-<id>` on home's `ticket/<id>`, prompt names it;
  `review-worktree` prints `records:` and `--remove` removes both; `worker --remove` removes
  both after merge; `approve-plan` reads the plan from home (refused before it is committed there).

## Verification

`verification.md`: a row per done-when with the command and result at a named commit; the CI run
(gh run view conclusion, all jobs) at the head.

## Rulings

- m-20261115-183216730-supervisor: risk high; full spec and plan review, two finals; lessons
  k-20261115-182656232, k-20261115-080753394, k-20261115-164245020 in every brief; only touched
  test files at --test-concurrency=2.
