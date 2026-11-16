## Summary

`validate --strict` skipped the "verdict holds at HEAD" check for any feature whose plan log was already on main, so a re-plan (`plan/<feature>` for a landed feature) could pass with stale design and graph reviews. Now the check also runs for the feature being re-planned, with the same messages a first plan gets. Other landed features stay history.

The merge gate (`check-pr`, and `merge` through it) validates a plan head in a detached worktree, where the branch name is unknown, so it now runs `validate --strict --plan <feature>`; `validate` takes `--plan` as the plan's feature, else the branch name.

## How to verify

`node --test --test-concurrency=2 --test-name-pattern='re-plan branch' test/kit.test.mjs`: a first plan (stale fails, fresh passes, check-pr stale fails), landed, then a re-plan (stale fails in validate and check-pr; reviewed at the head passes both).

Records: `docs/devteam-dev/tickets/kit-243-replan-reviews-hold-at-head/`.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
