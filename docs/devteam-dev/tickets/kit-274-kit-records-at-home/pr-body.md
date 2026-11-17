kit-208 gave a repo link `records: "home"`. This PR makes it safe to turn on for a link that already has tickets in flight, and takes devteam-dev's own design docs out of the kit.

## What changes

- **The transition rule** (`docs/devteam/scripts/devteam.mjs`). A ticket of a `records: "home"` link whose records are still in the link is read as `records: "repo"`: home has no `<projectRel>/tickets/<id>/` on its main, local or origin `ticket/<id>`, and the link has `<project>/tickets/<id>/` at the commit judged. check-ticket, check-pr and merge read it from the link at the head and print one warning. Once home has a records folder for it, home wins and the link folder is refused, as kit-208 built.
  - Each command decides once and passes that decision to every records read it makes: check-ticket at its `--sha`, merge at the PR head, `check-pr --repo` at `--sha`, review-worktree at its sha.
  - merge and `check-pr --repo` fetch home's `ticket/<id>` before deciding.
  - The decision is memoized per log read. Folder listings are batched per ref.
- **worker.md §1** says where a link ticket's records go: the repo's project folder by default, or home's when the link sets `records: "home"`.
- **docs/superpowers/ is deleted.** All 35 files are on devteam-dev's main under `docs/devteam/project/designs/superpowers/`, byte-identical.

## How to verify

- `env -u TMUX node --test --test-concurrency=2 test/multirepo-home.test.mjs`. The new test "a ticket whose records were left in the link merges from there until home has some" covers:
  - the warning, printed once;
  - merging with the link's ticket refs gone;
  - home records pushed from another clone;
  - a stale verdict and missing records on each side;
  - home wins;
  - the views: the prompt, approve-plan, review-worktree and timeline.
- `git ls-tree -r --name-only HEAD -- docs/superpowers` is empty.

## Rollout (supervisor)

1. Set `links.devteam-kit.records: "home"` only once home's kit includes this change.
2. Run the copy-and-delete chore for `docs/devteam-dev/` after kit-100, kit-90 and this ticket merge. The check is that `git ls-tree origin/main -- docs/devteam-dev` in the kit comes back empty.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
