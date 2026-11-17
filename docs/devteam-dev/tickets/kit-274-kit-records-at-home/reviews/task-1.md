# Task review: T1

- Reviewer: task-reviewer-1 (fresh subagent, claude-opus)
- Reviewed: 2838545f1dcd75cc00ae66cd68156c2ee73721f3 (T1, diff since 14fd57d8)
- Model: strong

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec "The warning, once (S6)"; quality.md §3 (tests that stay green) | devteam.mjs warnLeftInRepo (`leftWarned`) | If you delete the once-per-process guard (`if (leftWarned.has(t.id)) return;`), the test still passes. No command calls checkTicket twice today, so the `warnings(...) === 1` assertions never exercise the guard. The behaviour is correct, but nothing pins the guard. | wont-fix: no command checks one ticket twice today, so no test can show the guard red; kept so a later caller can't print it twice |
| F2 | Suggestion | spec warning text | test/multirepo-home.test.mjs `warnings()` | The regex checks the text only up to `records was "home"`. It does not check the `devteam: warning: ` prefix or the `; move them to home's <projectRel>/tickets/<id>/ once merged` tail. The code's text matches the spec exactly (warn() adds the prefix), but a change to the tail would go unnoticed. | fixed in T2: the test's regex covers the whole warning line |
| F3 | Suggestion | spec S1 (one decision per command) | devteam.mjs checkTicket `ticketReviews(id, src === WORKTREE ? src : { ...src, inHome: H })` | A WORKTREE src carries no decision, so ticketReviewsRead decides again through the views form. This can't happen for a link ticket: linkRepo always has commonDir and projectInRepo, so src is never WORKTREE. For home tickets the setting is false either way, so behaviour doesn't change. A comment saying so would help the next reader. | fixed in T2: a comment at checkTicket's WORKTREE case |

Checked and found correct: `??` (not `||`) everywhere inHome is read (checkTicket, ticketReviewsRead). The reviews memo key includes `src.inHome`. The leftInRepo/homeTicketFolders/linkTicketFolders keys use memo() scoped to the log read, don't collide, and fetchMain resets logCache before any decision. check-pr and merge are not read-only commands, so resolveCommit's for-each-ref cache can't make the post-fetch ref read stale. merge fetches home's ticket/<id> before its only decision and passes `inHome` (false included) to checkPr/checkTicket. With inHome false, no pinRecords, no `records`, no landRecords, and no `records at` in the output. check-pr sets `records`, and adds "not on origin", only when inHome is true. Inside checkTicket every records read (srcRead, reviews, `- Records:` hold, the touches exemption) uses the single `H`. The warning text matches the spec. The diff touches only devteam.mjs and test/multirepo-home.test.mjs.

Moving review-worktree's `{ at: sha }` into T1 is fine. The plan's own T1 A2b step already asserts review-worktree prints no `records:` line, so that assertion needs the code change. It is a one-line change in a file T1 touches anyway.

Mutations (each on a detached scratch worktree at the reviewed sha, `--test-name-pattern 'left in the link'`):
- baseline: pass
- merge's fetch-first removed: red (A2c merge passed as left in the link)
- check-pr decides before fetching: red (A2c check-pr passed)
- ticketReviewsRead ignores src.inHome: red (A2b)
- `||` in place of `??` in ticketReviewsRead: red
- review-worktree uses the views form: red (A2b `records:` line)
- checkTicket decides through the views form (no `at`): red
- home ticket-branch folder check removed: red (A2c)
- the whole rule removed: red
- once-per-process guard removed: stays green (F1)

Verdict: APPROVE 2838545f1dcd75cc00ae66cd68156c2ee73721f3
