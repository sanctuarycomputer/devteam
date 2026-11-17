# kit-274: design questions before the spec

What I found: kit-208 (merged) already built `links.<id>.records: "home"`. With it set, worker,
check-ticket, check-pr, merge (one pinned home records sha, landed first), review-worktree, park
and timeline all read and write a link ticket's records on home's `ticket/<id>` under home's
`docs/devteam/project/tickets/<id>/`, and test/multirepo-home.test.mjs already tests a stale
records verdict and missing records. devteam-dev's settings never set it on `devteam-kit`, so
everything still lands in the kit.

So kit-274's code is: (1) the default, (2) a transition rule for in-flight tickets, (3) a sweep that
empties a link's records folder into home, (4) worker.md, (5) deleting docs/superpowers/.

## Q1. Flip the default? (recommend: yes)

`records` defaults to `"home"` for every repo link; `"repo"` stays as an explicit opt-in.
The done-when reads as a general rule ("a worker on a ticket in another repo writes its records
under home's ..."), and a project's records in someone else's repo is the problem for any
project. The transition rule (Q2) covers other instances' in-flight tickets on upgrade.
Alternative: keep the default `"repo"`, and devteam-dev sets `records: "home"` on devteam-kit
(a governance-edit on home settings); worker.md then describes both.

## Q2. Transition rule (recommend as written)

A records-in-home ticket whose home `ticket/<id>` has no records of its own, while its link head
carries `<link project>/tickets/<id>/`: check-ticket, check-pr and merge read the records from the
link at the head exactly as `records: "repo"` does today (that folder exempt from touches, verdicts
held to the link head), with a warning that the sweep moves them after merge. Once home's branch
has records, home wins and the link folder is refused, as today. kit-100 and kit-90 merge that way.

## Q3. The sweep, and how it lands in the kit (recommend: a new command and a narrow merge path)

check-ticket refuses deleting other tickets' folders (outside touches, and the folder is the
kit's own line), so this ticket's PR can't remove docs/devteam-dev/. Proposed:
`devteam.mjs records sweep --repo <link>` (supervisor):
1. copies every file under the link main's `<project>/tickets/` into a home chore worktree
   (`chore-records-sweep`) at `docs/devteam/project/tickets/...`, refusing a file home already has
   with other bytes; the supervisor lands it with `merge --chore records-sweep` (project files only);
2. then makes the link branch `chore-records-sweep` that deletes them, and opens its PR;
   `merge --chore records-sweep --repo <link>` merges a link PR only when every change is a
   deletion under `<link project>/tickets/` whose identical bytes are on home's main, with the
   link's CI green, and logs the act. Afterwards the link's main has no records folder.
Run once after this merges (all 48 folders), and again after kit-100 and kit-90 merge.
Alternative: no kit code for the sweep; you do both sides by hand as one-off chores. That
fails "the sweep leaves none behind (tested)".

## Q4. "with history kept there"

The kit has 1078 commits touching docs/devteam-dev/. `git subtree` isn't installed on the box.
(a, recommend) Provenance: the home commit names the link main sha the files were copied from;
the full per-file history stays readable in the kit (`git log <sha> -- docs/devteam-dev/tickets/<id>`).
(b) Real git history imported into devteam-dev (filter-branch / fast-export of the kit's history
into devteam-dev's): a one-off supervisor chore, not kit code; it adds ~1078 synthetic commits
to devteam-dev.

## Q5. docs/superpowers/ (20 plans, 13 specs, not per ticket)

This PR deletes docs/superpowers/** (in touches). The copy into devteam-dev is not kit code (it
isn't a link records folder): a supervisor chore in home. Where? They aren't tickets' records:
recommend devteam-dev `docs/superpowers/` (same path), or `docs/devteam/project/designs/superpowers/`.
Please land the copy before or with this merge so nothing is lost.

## Q6. touches

The tests need `test/multirepo-home.test.mjs` (and maybe docs/devteam/process/supervisor.md for
the sweep step). Please add `test/multirepo-home.test.mjs` and `docs/devteam/process/supervisor.md`
to touches.
