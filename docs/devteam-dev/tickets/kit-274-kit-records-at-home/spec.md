# kit-274: a link ticket's records move to home without stranding the tickets in flight

## Problem

kit-208 (merged) built `links.<id>.records: "home"`: with it, a link ticket's spec, plan,
verification and reviews live on home's `ticket/<id>`, under home's `<projectRel>/tickets/<id>/`,
and worker, check-ticket, check-pr, merge, review-worktree, park and timeline all read them there.
devteam-dev is about to set it on `devteam-kit` (the owner agreed: thread t-20261117-004321752-owner
item 1). Two gaps stop that:

1. **In-flight tickets strand.** The moment a link says `"home"`, every ticket of it already
   writing records in the link (kit-100 and kit-90 today; any other instance's link tickets the
   day it sets the key) fails check-ticket and merge with `no records for <id> in home`, and its
   link records folder is refused as outside touches. Merged tickets' records also vanish from
   views (timeline, reviews) until someone copies them into home.
2. **worker.md** still says a link ticket's records always go in that repo.

And the kit carries docs/superpowers/ (20 plans and 15 specs of devteam-dev's own work), which the
owner wants out of the kit.

## Rulings (m-20261117-042330671-kit-274-kit-records-at-home, answered m-20261117-042417966-supervisor)

- Q1: no default flip. `records` still defaults to `"repo"`; devteam-dev sets `"home"` on
  devteam-kit itself.
- Q2: the transition rule, as proposed (below).
- Q3: no sweep command. The supervisor copies the kit's docs/devteam-dev/ records into devteam-dev
  and removes the folder from the kit in a one-off reviewed chore PR.
- Q4: provenance only: the home commit names the kit main sha it copied from.
- Q5: docs/superpowers/ goes to devteam-dev, copied by the supervisor before this merges; this PR
  only deletes it from the kit. Path, as ruled later (m-20261117-044852436-supervisor):
  `docs/devteam/project/designs/superpowers/` (plans/ and specs/), 35 files.
- Q6: `test/multirepo-home.test.mjs` added to touches.

## The transition rule

**Records left in the link.** A ticket of a link whose effective `records` is `"home"` has its
records *left in the link* when both hold:

- home has none for it: no `<projectRel>/tickets/<id>/` folder at home's main, nor at home's local
  `ticket/<id>`, nor at `origin/ticket/<id>` (a records branch the worker hasn't committed to yet
  doesn't count: it has no folder);
- the link has some: `<link project>/tickets/<id>/` exists at the link commit judged: the sha being
  checked (check-ticket's `--sha`, check-pr's and merge's PR head) or, for views with no sha, the
  link's ticket branch (`ticketBranchRef`), else the link's main once merged.

Such a ticket is treated exactly as under `records: "repo"`: `recordsInHome` is false for it.
So check-ticket, check-pr (`--repo <link>`) and merge read spec, plan, verification and reviews
from the link at the head, the link's own `<project>/tickets/<id>/` is exempt from touches, final
verdicts are held to the link head by today's rule, no `- Records:` line is needed, no home records
are pinned or landed, and worker/review-worktree make no records checkout. Each of check-ticket,
check-pr and merge prints one warning naming it:

`devteam: warning: <id>: records read from <link> (<project>/tickets/<id>/), left from before links.<link>.records was "home"; move them to home's <projectRel>/tickets/<id>/ once merged`

**Home wins.** Once home has a records folder for the ticket (any of the three refs above), the
ticket is records-in-home, as kit-208 built: records are read from home, and a
`<link project>/tickets/<id>/` change in the link PR is refused as outside touches (today's
message). A ticket never has its records read from both.

**Unchanged:** `records: "repo"` links (the default) and home tickets never run the check. A link
this machine can't read has no records left in it (it can't merge anyway; link-unreachable says
why).

### Where it's computed

One predicate, `recordsLeftInRepo(t, at)`, and `recordsInHome(t, { at } = {})` becomes
`setting is "home" && !recordsLeftInRepo(t, at)`; `recordsInHomeId(id, { at })` passes it through.

- **Memo:** through the kit's `memo()` (scoped to the log read, `readLog().memo`), keyed by id and
  `at`, so the long-running dashboard re-decides on its next log read, like every other view (S4).
- **Cost:** only tickets of a `records: "home"` link run it. Home main's `<projectRel>/tickets/`
  is listed once per log read (`git ls-tree --name-only`), not one cat-file per ticket; per ticket
  at most two home branch reads (only for refs that resolve) and one link read (S5).
- **One decision per command (S1).** A command that judges a commit decides once and passes that
  decision to every records read it makes, never re-deciding through the views form:
  - `checkTicket` decides at its resolved `sha` (`H`), and passes `H` to `ticketReviews` (the
    src carries it: `{ ref, repo, inHome: H }`; `ticketReviewsRead` uses `src.inHome` when set,
    else `recordsInHomeId(id)`; the reviews memo key includes it).
  - `cmdMerge` decides at the PR head, after fetching home's `origin/ticket/<id>` (S2), and passes
    the decision to `checkPr`/`checkTicket` (a new `inHome` option, so checkTicket doesn't decide
    again at the same sha with possibly different refs).
  - `cmdCheckPr --repo` fetches home's `origin/ticket/<id>` first, then decides at `--sha` (S2).
  - `review-worktree <id> <sha>` decides at its `sha` (S8).
  - Views (status, timeline, park checks, approve-plan, the worker's prompt and records worktree,
    `worker --remove`) use the views form: the link's ticket branch, else its main.
- **Fetch before deciding (S2).** merge and check-pr --repo fetch home's `ticket/<id>` from
  origin before the first decision, so home records pushed from another clone count, and home
  wins.
- The comment on `recordsInHome` ("never touches a checkout") is updated: it reads refs, never a
  working tree.

**Inherited call sites (S3).** Through `recordsInHomeId`/`recordsRepo`, a left-in-link ticket is
also treated as `records: "repo"` by: approve-plan (reads the link's plan), `parkMessage` and
`recordsParkProblems` (no records worktree to push), `recordsLandedOnly`, `ensureRecordsWorktree`
and `promptFor` (no records worktree; the default records line), `worker --remove` (no records
worktree to remove), `timelineView`, and home's `check-pr --head-ref ticket/<id>` (a home
`ticket/<id>` with a records folder makes the ticket not left, so that path is unchanged).

**The warning, once (S6).** Printed on stderr by check-ticket, check-pr and merge, once per
process per ticket (merge and check-pr run checkTicket inside them; it still prints once).

### Rollout note (for the supervisor, not code)

Home runs its own materialized kit. Set `links.devteam-kit.records: "home"` only once home's kit
includes this change; before that, kit-100, kit-90 and this ticket would fail check-ticket with
`no records … in home`. After the flip, a ticket started fresh writes records in home; the ones
already writing in the kit merge under this rule, so each such merge brings its
`docs/devteam-dev/tickets/<id>/` back into the kit (S7). Run the copy-and-delete chore after the
last of them (kit-100, kit-90, this ticket) merges, or once more for each one that merges later;
`git ls-tree origin/main -- docs/devteam-dev` in the kit, empty, is the check.

## Acceptance checks

Done-when 1 (worker.md says where records go):
- A1. `docs/devteam/process/worker.md` §1 "A ticket in another repo" says, in one or two
  sentences: records go under that repo's `<project>/tickets/<id>/` and land with the code by
  default; when the link sets `records: "home"`, they go under home's
  `docs/devteam/project/tickets/<id>/` on home's `ticket/<id>` (the prompt names the checkout),
  and nothing of the project lands in that repo. Check: `grep -n 'records: "home"'
  docs/devteam/process/worker.md` finds the line in §1; fails if the sentence is missing or still
  says records always land in that repo.

Done-when 2 (the transition rule), all in `test/multirepo-home.test.mjs`, new test
"records in home: a ticket whose records were left in the link merges from there until home has some":
- A2. **Left in the link passes.** A console ticket under `records: "home"` with records only in the
  link's `docs/devteam/project/tickets/<id>/` (spec, plan, verification, final review at the code
  head), no home records: `check-ticket <id> --sha <head>` exits 0 and its stderr has the warning;
  `check-pr --repo console --head-ref ticket/<id> --sha <head>` exits 0 with the warning exactly
  once in its stderr; `merge <id> --dry-run` says `ok … would merge in console` with no `records at`
  in home and the warning exactly once (S6), and
  `merge <id>` lands it (code and the link records folder on console's trunk, nothing under home's
  `tickets/<id>/`). Fails if the rule is removed: today these say `no records for <id> in home` and
  `changes files outside touches: docs/devteam/project/tickets/<id>/…`.
- A2b. **One decision per command (S1).** The same ticket with the link's `ticket/<id>` refs gone
  (the console worktree detached at the head, its local branch and `origin/ticket/<id>`
  remote-tracking ref deleted, as in a CI checkout): `check-ticket <id> --sha <head>` still exits 0
  with the warning. Fails if the reviews are read through the views form (they would come from home:
  `no final review record`).
- A2c. **Fetch before deciding (S2).** Home records for a left-in-link ticket pushed to home's
  origin from another clone (home's local `ticket/<id>` and `origin/ticket/<id>` ref absent in the
  main checkout before the command): `merge <id> --dry-run` and `check-pr --repo console …` both
  judge it records-in-home: refused as `changes files outside touches: docs/devteam/project/tickets/<id>/…`.
  Fails if they decided before fetching (they'd pass it as left in the link).
- A3. **Stale verdict, link side.** A non-review commit after the final review on the link branch:
  check-ticket fails with `its verdict is at …, which does not hold at …`. Fails (stays green) if the
  rule read the link records without holding them to the head.
- A4. **Missing records, link side.** With only `spec.md` in the link folder: check-ticket fails with
  `plan.md missing at this head` and `verification.md missing`. Fails if left-in-link skipped the
  record checks.
- A5. **Home wins.** Commit any file under home's `ticket/<id>` records folder (e.g. a spec): now
  check-ticket fails with `changes files outside touches: docs/devteam/project/tickets/<id>/…`
  (the link folder is refused), and with home's records incomplete, `plan.md missing` is judged
  from home (no warning printed). With full home records and a final review naming both heads but
  the link folder still in the PR: refused as outside touches. Fails if the link folder still won
  once home has records.
- A6. **Stale and missing, home side, once home wins.** Home records with a final review whose
  `- Records:` sha no longer holds (a non-review edit to home's verification.md after it):
  `its records verdict is at … does not hold at home's …`. And no records on either side: `no
  records for <id> in home`. Fails if the transition made home's checks lax.
- A7. **Views.** For the left-in-link ticket, `review-worktree <id> <sha>` prints no `records:` line
  (no home checkout); `prompt worker <id>` (the worker's prompt text, no tmux launch) ends with
  the default `keep this ticket's records under docs/devteam/project/tickets/<id>/ in this repo.`
  and not `Keep its records … a checkout of home`; after its merge, `timeline <id> --json` lists its
  spec with `repo: "console"`. And approve-plan: with a plan only in the link and no home records,
  `act --class approve-plan` succeeds (it reads the link's plan); once home's `ticket/<id>` has a
  records folder without a plan, it refuses with `no plan.md for <id> on ticket/<id>`. Fails if views
  still route it to home (no files, a home records checkout, the home prompt, approve-plan refused).
- A8. **Defaults unchanged.** The existing tests in test/multirepo-home.test.mjs and
  test/multirepo-landing.test.mjs pass, with one change (S3): the setting test's approve-plan case
  ("a plan in the link doesn't count") now first gives home's `ticket/<id>` a records folder (a
  spec), so it is a home-wins ticket, and keeps its assertion; the left-in-link case moves to A7.
  Nothing else in either file changes. Fails if the predicate changes `records: "repo"` or fresh
  records-in-home behaviour.

Done-when 3 (no docs/superpowers/):
- A9. `git ls-tree -r --name-only HEAD -- docs/superpowers` is empty at the PR head; and before the
  merge request, every one of the kit's 35 `docs/superpowers/` files is byte-identical on
  devteam-dev's `origin/main` under `docs/devteam/project/designs/superpowers/` (the supervisor's copy). Fails if any file remains in the kit, or the copy isn't on
  devteam-dev's main yet (then I hold the merge request).

Done-when 4 (no new file or folder outside test/):
- A10. `git diff --name-status --diff-filter=A origin/main...HEAD` lists nothing outside `test/`
  and this ticket's own records folder `docs/devteam-dev/tickets/kit-274-kit-records-at-home/`
  (where the prompt puts them, as the supervisor told kit-170 for the time being; the supervisor's
  chore moves the whole folder out). Fails if devteam.mjs work adds a file.

## Edge cases

- A records branch made by `worker` before any commit (home's `ticket/<id>` at home's main): no
  folder there, so it doesn't count as home records.
- Records in both places: home wins; the link folder is refused, so the worker drops it from the
  link PR. Never merged from both.
- A merged left-in-link ticket: views read the link's main until the supervisor's copy lands in
  home's main; then home's main wins (the copy is identical).
- An unreadable link: not left in the link (nothing reads it); merge refuses on link-unreachable as
  today.
- Memo: computed once per process per (id, at); merge lands nothing in home for such a ticket, so
  nothing it does changes the answer mid-run.

## Out of scope

- Flipping the default (Q1), a sweep command (Q3), importing git history (Q4).
- Setting `links.devteam-kit.records` (the supervisor's settings change), copying docs/superpowers/
  and docs/devteam-dev/ into devteam-dev, and removing docs/devteam-dev/ from the kit (the
  supervisor's chore).
- `dispose` in a link worktree (observations o-20261115-022928314 and others): records in home
  makes it moot for devteam-kit.

## Contracts

None provided or consumed: `records` is kit-208's settings key, unchanged; no contract version.
