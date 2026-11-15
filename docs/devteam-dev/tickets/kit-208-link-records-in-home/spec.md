# kit-208: a repo link can keep its tickets' records in home

## Problem

A ticket in a repo link keeps its records (spec, plan, verification, reviews, handoff) in that
repo, under the link's `project` folder (`<project>/tickets/<id>/`), and they land on its main
with the code. For a link whose repo is published for others (devteam-dev's `devteam-kit`, the
open-source kit), that puts one project's working records into someone else's product: the owner
asked twice why `docs/devteam-dev/tickets/` keeps growing in the kit repo (thread
t-20261115-022702618-owner; strategy P2, "never put project-specific content in the kit").

## The setting

`links.<id>.records` on a repo link: `"repo"` (the default, today's behaviour, unchanged) or
`"home"`.

- A repo-kind field: `REPO_KEYS` gains `records`, in `REPO_OWN` (never inherited from home;
  default `"repo"`), so `effectiveSettings(link).records` is always `"repo"` or `"home"`.
- `LINK_TYPES.records = 'string'`; `LINK_KINDS.repo.validate` refuses any other value
  (`<at>: records is "repo" or "home"`).
- Changing it is the default repo-link owner class (`governance-edit`), like `project`: it changes
  what merge checks.

**Records in home** for a ticket means: its component's link is a repo link whose effective
`records` is `"home"`. New helpers:

- `recordsInHome(t)`: a view, settings only (main's committed components and links, like
  `repoOfTicketLink`), never touches a checkout.
- `recordsRepo(id)`: `repo('home')` when `recordsInHome`, else the ticket's own repo (an act:
  fails fast like `repoOfTicketId`). Every place below that reads or writes a ticket's records goes
  through it.

## Where the records are

- Folder: **home's** project folder, `<home projectRel>/tickets/<id>/` (the same place a home
  ticket keeps them), so nothing of the project's lands in the linked repo.
- Branch: **home's `ticket/<id>`**. The ticket has two branches of the same name: the link's
  (code only) and home's (records only).
- Checkout: the worker gets a second worktree, a checkout of home on `ticket/<id>`, at
  `<home>/.worktrees/records-<id>`.

## Acceptance checks (the done-whens)

1. **The setting routes every reader and writer** (done-when 1), with `records: "home"` on a link:
   - `worker <id>` makes the link worktree as today **and** `.worktrees/records-<id>` (home,
     branch `ticket/<id>`: the local branch if there is one, else `origin/ticket/<id>`, else new
     from home's main), seeds nothing in it, and the prompt says: keep this ticket's records under
     `<home projectRel>/tickets/<id>/` in `<records worktree>` (home's `ticket/<id>`), commit and
     push them there, and put nothing of the project in the linked repo (with forge `github`, also
     open a home PR from `ticket/<id>` with the same title). The default prompt is unchanged.
   - `check-ticket <id>` reads spec, plan, verification and reviews from home at home's
     `ticket/<id>` (local branch, else `origin/ticket/<id>`), and the code footprint from the link
     at the link head, as today. A link file under the link's own `<project>/tickets/<id>/` is no
     longer exempt: it is outside touches and is refused.
   - `review-worktree <id> <sha>` makes the reviewer's link checkout as today and, beside it,
     a detached checkout of home at its `ticket/<id>` head (`<name>-records`), printed on a
     second line `records: <path>`; `review-worktree --remove <path>` removes both.
   - `act --class approve-plan` reads the plan from home's `ticket/<id>`; `timeline <id>` lists
     the files from home (no `repo` field); the review-record readers (`ticketReviews`) read home.
   - `worker <id> --remove` also removes `records-<id>`; the tick's tidy removes a `records-<id>`
     worktree on the same terms as the ticket's own (merged, phase done).
   - With `records` unset or `"repo"`, every one of these does exactly what it does today (the
     existing multirepo tests pass unchanged).
2. **merge checks the records in home at the reviewed head** (done-when 2): `merge <id>` fetches
   home's `origin/ticket/<id>` and checks the records there exactly as `checkTicket` checks records
   in a link today: spec, plan and verification present (and approved), verification rows ≥
   done-whens, every final track's latest record `APPROVE` at a commit that holds at the **link's**
   head (`verdictHolds` in the link, unchanged), the right number of named approvers, blocking
   findings disposed. Missing records, or a verdict that doesn't hold at the link head, refuse the
   merge before anything lands. Also refused: home's `ticket/<id>` changing anything outside
   `<home projectRel>/tickets/<id>/` against home's main (`records branch changes … outside the
   ticket's own folder`); a missing home branch (`no records for <id> in home: push home's
   ticket/<id>`); with forge `github`, no open home PR from `ticket/<id>`, a draft one, or its
   checks pending or failing.
3. **Landing**: once every check passes, merge lands the link PR (as today), logs the merge act
   (its `what` adds `; records at <sha> in home`), then lands home's `ticket/<id>` at exactly the
   checked sha on home's main (forge `git`: a `--no-ff` merge pushed to origin, as for a link
   today; forge `github`: `gh pr merge --match-head-commit <sha>` on the home PR). If the records
   don't land (main moved, the push refused), merge says so and a second `merge <id>` lands only the
   records (the link PR is already on its main): it re-checks the records branch's footprint and
   that its head is the sha the merge act names, and lands it.
4. **A test** (done-when 3), in `test/multirepo-home.test.mjs`: a `multiFixture` with
   `records: "home"` on console; a console ticket whose link branch changes only `src/main.js`
   and whose records (spec, plan, verification, `reviews/final-1.md` and `final-1b.md` at the link
   head) are on home's `ticket/<id>`:
   - `check-ticket` passes; `merge` lands it: console's main has `src/main.js` and no
     `docs/devteam/project/` path, home's main has `docs/devteam/project/tickets/<id>/spec.md` etc.;
   - before the records are pushed, `merge --dry-run` refuses (`spec.md missing`); with a link
     file under console's `docs/devteam/project/tickets/<id>/`, refused (outside touches);
   - where tmux is installed (as the suite's other `worker` launch tests are guarded), `worker`
     makes `.worktrees/records-<id>` on home's `ticket/<id>` and its prompt file names it;
     `review-worktree` prints `records: <path>`, and `--remove` removes both.
5. **CI** (done-when 4): test.yml passes on every job at the head; no file is added (the test goes
   in the existing `test/multirepo-home.test.mjs`).

## Contracts

- Provided: the `records` link field (settings shape; validate's rule).
- Consumed: `verdictHolds`, `checkTicket`, `srcRead/srcList`, `repo()`, `merge`'s landing paths.
  No schema change: the merge act's extra words go in `what`, a free-text field.

## Edge cases

- A records-home ticket's home `ticket/<id>` exists locally but not on origin: `check-ticket`
  reads the local branch (the worker's committed state); `merge` needs origin (it fetches) and says
  to push.
- The link branch carries an empty handoff commit: it changes no file, as today.
- Home's check-pr on a records branch (`--head-ref ticket/<id>` in home for a link ticket): today
  it is refused as "a ticket of <link>, not home"; with records in home it is accepted when it
  changes only the ticket's own records folder (so a home CI running check-pr on that PR passes).
- `recordsInHome` reads main's committed settings: setting `records` in a working tree changes
  nothing until it lands (the same rule as components).
- A ticket started before the setting flipped already has records in the link: it keeps the
  setting at its merge (no migration in this ticket); the supervisor flips the setting between
  tickets (the notes' follow-up chore).

## Out of scope

- Moving `docs/devteam-dev/` out of the kit and setting devteam-kit's `records` (the notes'
  follow-up chores, one PR each side).
- Process docs (`worker.md` "A ticket in another repo", `supervisor.md` merge): not in touches; the
  prompt carries the instruction. A doc update is sent to the supervisor as a follow-up.
- Dashboard views beyond `timeline`'s files and the review readers.
- This ticket's own records stay in `docs/devteam-dev/tickets/kit-208-link-records-in-home/` (the
  setting isn't live until it lands).

## Rulings

- m-20261115-183216730-supervisor: priority from the owner; risk high; full spec and plan review,
  two finals; lessons k-20261115-182656232, k-20261115-080753394, k-20261115-164245020 in every
  brief; run only touched test files at --test-concurrency=2.
