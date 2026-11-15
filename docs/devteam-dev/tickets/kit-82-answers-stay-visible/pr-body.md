## Summary

Story DCL-S1 (feature `dashboard-cleanup`). Before this change, when the kit refused an owner's answer (for example because the question's linked mock had changed), the card showed "Not saved: …" and the 10-second redraw wiped it before the owner could read it.

- **A refused answer stays.** The reason is kept per question in page memory (`REFUSED`) and drawn on every copy of the card (the Inbox's and a thread's) as `Not saved: <reason>`, with a Dismiss button. It stays until the owner dismisses it, presses again, the answer goes through, or the question closes. The pick and the note stay in their boxes, as before.
  - `press()` takes an optional `onError`. `answerPress()` takes `{ stays }`. A review's "Send it back" passes `{ stays: false }` and keeps its own error line, as today.
- **A moved link shows first.** When a question has `links_moved` (kit-81), its card says `<link> changed since this was asked; the supervisor will ask again` straight under its head. Its Answer button and any which-choice buttons are disabled; the note box still takes text. Shift+Enter (kit-207) does nothing there, because a disabled button ignores `click()`.

Only `docs/devteam/dashboard/index.html` changes in product code. Both new lines sit inside `.qcard`, which already caps its width.

## How to verify

- `node --test test/dashboard-answers.test.mjs` (Node 22 and Chrome). It drives a real dashboard with the page's fetch stubbed: `/api/answer` refuses, and `/api/data` marks one question's link as moved.
- `node --test test/dashboard.test.mjs`. Only the assertion that read the old error line changed (~500).
- Screenshots, light and dark, desktop and phone: `docs/devteam-dev/tickets/kit-82-answers-stay-visible/screenshots/` (re-taken with `shoot.mjs` beside them).

## One-way doors

None.

## Known gap

Review cards (`reviewCard` and the review panel) are out of scope. The server refuses a moved-link answer on them too, but a review pins its page through `review.page`, so a pinned `links` entry on one is rare. A follow-up can cover them.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
