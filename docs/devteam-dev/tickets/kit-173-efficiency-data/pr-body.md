`/api/data` (`dashboard-data`) gains `efficiency`, the data behind the Efficiency Score. kit-174 draws the page from it. Every field comes from what the kit already has: spend items, phase lines, review records and observations. Nothing new is stored, and no read writes the log.

- **Twelve calendar weeks** (Monday-based, oldest first). Each counts the tickets merged that week with spend recorded: `usd_per_point`, `hours_per_point`, `first_pass` (the share of first review passes not asking for changes; every `task-<n>.md` counts as a first pass, per ruling m-20261115-204118085), `cache_read_share`, `escaped_defects`, `usd_by_phase` and `tokens_by_phase`.
- **The score.** A week with at least 3 tickets gets a score. Spend and time are measured against the best scored week of the 12, and rework is the first-pass share. A week with an escaped defect gets no credit for its own spend or time savings. The data gives `best`, `score.this_week`, `score.last_week` and this week's `parts`.
- **Observe, waste, trials.** `observe` holds the window's phase hours and spend, spend by model and tokens, plus tokens by phase. `waste` lists the open spend findings, each with its newest metrics observation's id. `trials` lists the spend improvement trials: dollars per point before and since, escaped defects since, and `running`/`kept`/`dropped` from the newest outcome observation.
- **Suggestions.** Up to five, ranked by estimated dollars: review depth for small, normal-risk tickets; tighter work before a review stage most first passes reject; a smaller model; keeping the prompt cache; and one per costly ticket. Each has a stable id that can go in `suggestion:<id>` once kit-99 adds that subject type. Each says what to try, why and about how much it saves, in plain words.
- **One read of the review files per request.** `dashboard-data` memoizes `ticketReviews` for the length of the request, so each ticket's review folder is read once even though several sections need it.

The G1 golden `test/fixtures/g1/dashboard-data.txt` gains only the `efficiency` block: twelve empty weeks, nulls and no suggestions. `metrics.txt` doesn't change.

**For kit-174:** `best` is null when no week is scored. The first-pass tooltip should say that first-pass counts each task review.

## How to verify

- `node --test --test-concurrency=2 test/efficiency-data.test.mjs` runs 18 tests on throwaway fixtures with hand-computed answers.
- `node --test --test-concurrency=2 test/components.test.mjs` checks the G1 golden.
- `node --test --test-concurrency=2 test/dashboard-data.test.mjs` checks that kit-84's dashboard data still passes alongside this change.
- CI (test.yml) runs the full suite. `docs/devteam-dev/tickets/kit-173-efficiency-data/verification.md` has the run and each done-when's evidence.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
