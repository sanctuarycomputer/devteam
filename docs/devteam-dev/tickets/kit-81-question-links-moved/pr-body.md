Each open question now says whether a page it links changed since it was asked, and `metrics` tells the supervisor to ask again (story DCL-S1).

- **`links_moved` on every question** (`/api/data`'s `questions` and every `questions()` view): for an open question, the same text `answer` refuses with ("… which changed since it was asked; ask again about the page as it is now", or "… which is no longer available; ask again"), or null when nothing moved. It is null for a question that isn't open (a defaulted one included: null means not checked). It is computed from the links `questionsNow` already resolves, inside the per-log-read memo, so it costs no artifact read of its own.
- **`question-link-changed` (medium)** in `metrics` for each such open question, with the hint `withdraw <qid> --reason "…" and ask again about the page as it is now`. It goes once the question is withdrawn. The re-ask is not a W2 re-ask: the question was never answered.
- `answer` and `ownerAnswer` refuse with exactly today's words: `artifactLinksMoved(v, now)` only gains an optional argument for links already resolved.

kit-82 draws the card (the warning, Answer disabled) from `links_moved`.

Records: `docs/devteam-dev/tickets/kit-81-question-links-moved/` (spec, plan, reviews, verification).

## Follow-up for the supervisor

`process/supervisor.md` doesn't name the new finding; it is outside this ticket's touches.

## How to verify

- `node --test --test-concurrency=2 test/question-links-moved.test.mjs`. Three drafts (moved, unchanged, gone) in fixture worktrees, a question on each, and a dashboard whose `dashboard-data` runs count their artifact folder reads (a `--import` module through `NODE_OPTIONS`). Two `/api/data` calls each read every linked draft twice (the Library's read and the question's), so a second resolution fails the test. Then `answer` refuses in today's literal words, `metrics --json` has the finding for the moved and gone questions only, and `withdraw` clears it.
- CI: test.yml, every job.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
