A repo link can now keep its tickets' records in home: `links.<id>.records: "home"` (default `"repo"`, today's behaviour).

## What changes for such a link

- **Where the records live.** A ticket's spec, plan, verification and reviews go on **home's** `ticket/<id>`, under home's project folder. The link's `ticket/<id>` holds only code. Nothing of the project lands in the linked repo, and the link's own records folder is no longer exempt from touches.
- **Final reviews name both heads.** A final review records the link head on its verdict line and the home records commit on a `- Records: <sha>` line. Both must still hold under today's `verdictHolds` rule, so editing a record after review voids the verdict, as it does today.
- **Records-branch footprint.** home's `ticket/<id>` may change only that ticket's records folder. Home's `check-pr` on a records branch checks just that.
- **merge** checks the records and lands exactly that one commit. It refuses before anything lands if the records are missing, broken or outside their folder, or (when home isn't on forge `git`) the home PR isn't ready. It lands the records first, then the code. If the code then fails to land, merge exits non-zero and says so. Status flags the ticket `records_landed` and metrics raises a `records-without-code` finding. Running merge again finishes the job: the records are recognized as landed (on a GitHub home, through the merged PR), and only the code lands, with one merge act naming both shas.
- **Tools that follow.**
  - `worker` adds a `.worktrees/records-<id>` checkout of home and says so in its prompt.
  - `review-worktree` adds a `-records` checkout, printed with its full sha.
  - Park messages, `sessionSettled` and `fleet status` also require the records committed and pushed.
  - `worker --remove` and the tidy also clear the records worktree; `approve-plan`, `timeline` and the review readers read the records from home.
  - `merged-without-merge` now reads every sha a merge act names.

## How to verify

`node --test --test-concurrency=2 test/multirepo-home.test.mjs` runs six new tests. CI runs the full suite.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
