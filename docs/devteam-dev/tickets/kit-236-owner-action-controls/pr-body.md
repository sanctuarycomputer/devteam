## Summary

Story DCL-S5 (feature `dashboard-cleanup`). The owner twice answered an owner-action question with its recommendation ("Do all four", "Do both on the dashboard") and nothing changed: the recommendation was drawn as an answer choice that read like a button doing the job.

- **The card carries the records' own controls.** Each knowledge (`k-…`) or goal (`g-…`) id written in an open owner-action's context gets a row: what it is (a rule in the owner's plain words, or a goal's title, linking to its drawer), then its own control. A rule has Retire it, and an owner lesson waiting on the owner has Keep it too. A goal has Let go, then Confirm let go. Each posts exactly what the Knowledge page and the goal's hold bar post (`/api/knowledge` `{ id, status }`, `/api/goal-decide` `{ id, verdict: 'let-go' }`). The question's evidence and its own `--goal` are never read, so a cited rule or the goal it serves gets no control.
- **Done shows as done.** A record already retired, kept by the owner after the ask, let go or met shows a "Done: …" badge and no control. A record that left `/api/data` (retired) is read by its peek, refetched on each refresh.
- **Done and Can't right now, always.** An open owner-action's answers are exactly these two. A recommendation is a line of text, "Suggested: …", and any choices are listed as "Ways to do it: …", never as buttons. Answered questions' drawers keep the list as asked.
- **Done waits for the act.** Send with Done picked never answers while a named record is unchanged, however often it is pressed. Each unchanged row says "not done yet", and a line above Send says to change them or pick Can't right now with a note.
- **Every copy shows a press at once.** Page memory (`OA_SET`, `OA_CONFIRM`, `NOT_DONE`) and `oaPaint()` write each press into the Inbox's and the thread's copy, so a focused button in a thread doesn't hold it back. The confirm survives the 10-second refresh, and focus stays where it was.

Only `docs/devteam/dashboard/index.html` changes in product code. The new rows sit inside `.qcard`, which already caps its width.

## How to verify

- `node --test test/dashboard-owner-action.test.mjs` (Node 22 and Chrome). It runs a real dashboard over records made with the real CLI: lessons accepted, retired and an owner's candidate; goals live and let go; a thread question and two Inbox questions. It records the page's posts without stubbing them, and compares them with the Knowledge drawer's Retire it and a goal's hold bar.
- `node --test test/dashboard-answers.test.mjs` and `test/dashboard.test.mjs`, both unchanged.
- Screenshots, light and dark, desktop and phone: `docs/devteam-dev/tickets/kit-236-owner-action-controls/screenshots/` (re-taken with `shoot.mjs` beside them).

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
