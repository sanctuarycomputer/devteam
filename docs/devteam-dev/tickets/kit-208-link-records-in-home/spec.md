# kit-208: a repo link can keep its tickets' records in home

## Problem

A ticket in a repo link keeps its records (spec, plan, verification, reviews) in that repo, under
the link's `project` folder (`<project>/tickets/<id>/`), and they land on its main with the code.
For a link whose repo is published for others (devteam-dev's `devteam-kit`, the open-source kit),
that puts one project's working records into someone else's product: the owner asked twice why
`docs/devteam-dev/tickets/` keeps growing in the kit repo (thread t-20261115-022702618-owner;
strategy P2).

## The setting

`links.<id>.records` on a repo link: `"repo"` (the default, today's behaviour, unchanged) or
`"home"`.

- A repo-kind field: `REPO_KEYS` gains `records`, in `REPO_OWN` (never inherited from home;
  default `"repo"`), so `effectiveSettings(link).records` is always `"repo"` or `"home"`.
- `LINK_TYPES.records = 'string'`; `LINK_KINDS.repo.validate` refuses any other value
  (`<at>: records is "repo" or "home"`).
- Changing it is the default repo-link owner class (`governance-edit`), like `project`: it changes
  what merge checks.

**Records in home** for a ticket: its component's link is a repo link whose effective `records`,
read from home main's committed settings (like `repoOfTicketLink`), is `"home"`. Helpers:
`recordsInHome(t)` (a view: settings only, never touches a checkout) and `recordsRepo(id)`
(`repo('home')` when in home, else the ticket's own repo). "Home's forge" below means home's own
settings (`repo('home').settings.forge`), never the link's.

## Where the records are

- Folder: **home's** project folder, `<home projectRel>/tickets/<id>/`, the place a home ticket
  keeps them, so nothing of the project's lands in the linked repo.
- Branch: **home's `ticket/<id>`**. The ticket has two branches of that name: the link's (code
  only) and home's (records only).
- Checkout: the worker's second worktree, home on `ticket/<id>`, at `<home>/.worktrees/records-<id>`.
- **Reviews name both heads.** A final review record of a records-in-home ticket carries, besides
  `Verdict: … <link sha>`, a line `- Records: <full sha>` naming the home commit of the records it
  reviewed. The verdict holds only if the link sha holds at the link head **and** the records sha
  holds at the records head, both by today's `verdictHolds` rule (only review records added or
  filled in since; merges of main only), each in its own repo, with home's records dir
  `<home projectRel>/tickets/<id>/reviews/`. So editing verification, the plan or a record after a
  final review voids it, exactly as today (quality.md §3).

## Acceptance checks (the done-whens)

1. **The setting routes every reader and writer** (done-when 1), with `records: "home"` on a link:
   - `worker <id>` makes the link worktree as today and, independently (so `--resume` brings back a
     removed one), `.worktrees/records-<id>`: home, branch `ticket/<id>` (the local branch, else
     `origin/ticket/<id>` tracked, else new from home's main), not seeded. Its prompt says: keep
     this ticket's records under `<home projectRel>/tickets/<id>/` in `<records worktree>`
     (home's `ticket/<id>`), commit and push them there, run `dispose` there, put `- Records: <sha>`
     in final review records, and put nothing of the project in the linked repo; when home's
     forge isn't `git`, also open a home PR from `ticket/<id>` with the ticket's PR title. The
     default prompt is unchanged.
   - `check-ticket <id>` reads spec, plan, verification and reviews from home at `--records <sha>`
     if given, else home's `ticket/<id>` (local branch, else `origin/ticket/<id>`): the worker's
     committed state. The code footprint is read from the link at the link head, as today. A link
     file under the link's own `<project>/tickets/<id>/` is no longer exempt: it is outside
     touches and refused. No records branch at all: one failure, `no records for <id> in home`,
     and nothing is read from home's working tree.
   - The records branch's footprint: files it changes against home's main, by merge-base (three
     dot, as checkTicket's footprint), outside `<home projectRel>/tickets/<id>/` are refused
     (`home's ticket/<id> changes files outside its records folder: …`). This keeps a link ticket
     from changing home's settings, log or strategy through its records branch (R1).
   - Home's `check-pr --head-ref ticket/<id>` (a records branch) runs only that footprint check
     and returns (today: refused as "a ticket of <link>, not home"); it never reaches the link's
     `checkTicket`. `check-pr --repo <link>` for such a ticket fetches home's
     `origin/ticket/<id>` first and checks the records there.
   - `review-worktree <id> <sha>` makes the reviewer's link checkout as today and, beside it,
     `<name>-records`, a detached checkout of home at its `ticket/<id>` head, printed on a second
     line `records: <path> (<sha>)`; `review-worktree --remove <path>` removes both.
   - `act --class approve-plan` reads the plan from home's `ticket/<id>`; `timeline <id>` lists
     the files from home (no `repo` field); `ticketReviews`, for these tickets, re-resolves a
     branch ref in home (home's local `ticket/<id>`, else origin's; a full sha is used as given)
     and, once merged, reads home's main.
   - Park: the park message also says to commit and push the records worktree; `sessionSettled`
     and `fleet status` also require the records worktree clean and home's `ticket/<id>` pushed
     (local = origin), so a fleet move can't leave records behind. A records branch that has no
     commit of its own yet (no origin branch, and its local head is in home's main) counts as
     pushed: there is nothing to lose.
   - `worker <id> --remove` also removes `records-<id>` through home and prunes home's list; the
     tidy removes a `records-<id>` worktree on the same terms as the ticket's own.
   - With `records` unset or `"repo"`, every one of these does exactly what it does today (the
     existing multirepo tests pass unchanged).
2. **merge checks the records in home at the reviewed head** (done-when 2). `merge <id>` fetches
   home's `ticket/<id>` into `origin/ticket/<id>` and pins **one** records sha, the one it checks
   and the one it lands: home's forge `git`, that fetched ref; otherwise the home PR's head, which
   must equal the fetched ref. It checks the records at that sha as `checkTicket` checks records
   today (present, approved, verification rows, latest final per track APPROVE with both heads
   holding, named approvers, blocking findings disposed) and the records footprint. Refused before
   anything lands: missing records or branch; a verdict that doesn't hold at either head; a
   footprint outside the folder; when home's forge isn't `git`: no open home PR from `ticket/<id>`,
   a draft, `BEHIND`/`DIRTY`, or its checks pending or failing (the link PR's rollup rule).
3. **Landing, records first.** Once every check passes: (a) the records land on home's main at
   exactly the pinned sha, unless that sha is already in home's main (forge `git`: a `--no-ff`
   merge pushed to origin, as for a link today; otherwise `gh pr merge --match-head-commit`);
   (b) the link PR lands as today; (c) the merge act is logged, its `what`
   `merged ticket/<id> at <link sha>; records at <records sha> in home`. If (b) fails after (a),
   merge exits non-zero: `the records of <id> landed in home at <sha12>; the code did not land in
   <link> (<why>): run merge <id> again`. A second `merge <id>` runs every check again, skips (a)
   and lands the link. No act is logged until the code lands.
   **Records already landed** is recognized per home's forge, and then the open-PR checks of
   acceptance 2 (open, draft, `BEHIND`/`DIRTY`, checks, head = fetched ref) don't apply: forge
   `git`: the pinned sha (the fetched ref) is an ancestor of home's main; otherwise: the newest **merged** home
   PR from `ticket/<id>` (`gh pr list --head ticket/<id> --state merged`) whose head is the fetched
   ref, or any head when the branch is gone; that head becomes the pinned sha, fetched from
   `refs/pull/<n>/head` (so a deleted head branch, or a squash or rebase merge, where that sha is
   never an ancestor of main, still works). The records are still checked at that sha as in
   acceptance 2, and nothing is landed in home again. When the branch exists and has moved past
   every merged PR's head (a reopened ticket), the open-PR path applies as usual.
   `merged-without-merge` reads every `at <sha>` in a merge act's `what`, so the records merge on
   home's main is named by its act. (Between a failed (b) and the rerun, that finding fires on the
   records merge, which is true: records landed with no merge act.)
4. **Tests** (done-when 3), in `test/multirepo-home.test.mjs`, a `multiFixture` with
   `records: "home"` on console and a console ticket whose link branch changes only `src/main.js`:
   - before any records: `check-ticket` and `merge --dry-run` fail `no records for <id> in home`;
   - records on home's `ticket/<id>` (spec, plan, verification, final reviews with `- Records:`):
     `check-ticket` passes; `merge` lands it: console's main has `src/main.js` and no
     `docs/devteam/project/` path; home's `origin/main` has `docs/devteam/project/tickets/<id>/`
     spec, plan, verification and reviews; the act names both shas;
   - refusals (dry run): a link file under `docs/devteam/project/tickets/<id>/` (outside touches);
     a records branch that also changes `README.md` (footprint), and home's `check-pr` says the
     same; `verification.md` edited after the final review (the records verdict doesn't hold); a
     final record with no `- Records:` line;
   - records first: console's origin refuses one push (a pre-receive hook); merge exits non-zero
     with the message, home's main has the records, no act; the hook removed, `merge` again lands
     the code and logs the act (the git-forge path; the GitHub path's merged-PR lookup is
     exercised with a `gh` stub on PATH, as the suite's other forge tests do: a merged PR whose head
     is the records sha lets the rerun skip the open-PR checks and land only the code);
   - default: with `records` unset, today's multirepo tests are unchanged;
   - where tmux is installed (as the suite's other `worker` launch tests are guarded), `worker`
     makes `records-<id>` on home's `ticket/<id>` and the prompt names it; `review-worktree`
     prints `records:` and `--remove` removes both.
5. **CI** (done-when 4): test.yml passes on every job at the head; no file is added (the tests go
   in the existing `test/multirepo-home.test.mjs`).

## Contracts

- Provided: the `records` link field (settings shape and validate's rule); the `- Records: <sha>`
  line in a records-in-home ticket's final review records (parsed like `- Reviewer:`).
- Consumed: `verdictHolds`, `checkTicket`, `srcRead/srcList`, `repo()`, merge's landing paths.
  No log schema change: the act's extra words go in `what`, a free-text field.

## Edge cases

- Home's `ticket/<id>` local but not on origin: `check-ticket` reads it; merge fetches origin and
  says to push.
- `recordsInHome` reads main's committed settings: setting `records` in a working tree changes
  nothing until it lands.
- A ticket started before the setting flipped has its records in the link; it should be merged
  before the flip (the follow-up chore orders that). No migration here.
- The link merged by hand (outside merge) with records unlanded: merge's "already on main" return
  stays; `merged-without-merge` reports the link merge, as today.

## What it leaves undefended (P6)

Anyone who can push to home's `ticket/<id>` can add a record there; that is today's exposure for a
link's branch, moved to home's. The verdict lines are text the reviewer writes; merge checks that
both named commits hold, not who wrote them (as today).

## Out of scope

- Moving `docs/devteam-dev/` out of the kit and setting devteam-kit's `records` (the notes'
  follow-up chores).
- Process docs (`worker.md` "A ticket in another repo", `quality.md` §3 on the `- Records:` line,
  `supervisor.md` merge): not in touches; the prompt carries the instruction, and the doc update
  goes to the supervisor as a follow-up.
- Dashboard views beyond `timeline`'s files and the review readers.
- This ticket's own records stay in `docs/devteam-dev/tickets/kit-208-link-records-in-home/` (the
  setting isn't live until it lands).

## Rulings

- m-20261115-183216730-supervisor: priority from the owner; risk high; full spec and plan review,
  two finals; lessons k-20261115-182656232, k-20261115-080753394, k-20261115-164245020 in every
  brief; run only touched test files at --test-concurrency=2.
