Shift+Enter now submits the box being edited, and plain Enter is a new line in every box (the owner's ask, thread t-20261115-020337375-owner).

- **A question card's note box** (the Inbox copy and a thread's copy): Shift+Enter presses that card's own button. On most cards that is Answer, so typed words with no choice picked still get kit-203's which-choice step. A review card's note presses Send it back, a secret card's presses Reply, and a sensor's card, which has neither, keeps its new line.
- **The thread box** (a reply, and the owner's new thread): Shift+Enter sends. **Plain Enter no longer sends there**; it makes a new line, as in every other box (ruled one rule everywhere, m-20261115-033958803-supervisor). The placeholder now says "Shift+Enter sends; Enter is a new line."
- Nothing is sent while an IME composition is active (`isComposing`, or `keyCode` 229) or with Ctrl, Alt or Meta held, and a key repeat sends nothing more, so holding Shift+Enter posts once.

One `document` keydown listener and `submitOf(el)` in `docs/devteam/dashboard/index.html` replace the old Enter-sends listener. The ten existing tests that sent from the thread box with Enter now use Shift+Enter, and so does `test/browser/dev-links.mjs`'s `enter()` (the hand-run real-Chrome harness; added to touches by m-20261115-041857004-supervisor).

Records: `docs/devteam-dev/tickets/kit-207-shift-enter-submits/` (spec, plan, reviews, verification).

## Follow-up for the supervisor

`docs/devteam/dashboard/hub.html`'s operator thread box (~845) still says, and does, "Enter sends; Shift+Enter is a new line". That file is outside this ticket, so the owner's two thread boxes now use opposite keys until a chore makes the hub's match. The 2026-11-10 threads design under `docs/superpowers/` also still says "Enter sends"; this change supersedes it.

## How to verify

- `node --test --test-concurrency=2 --test-name-pattern 'threads on the dashboard page' test/dashboard.test.mjs` (Chrome and Node 22+). Two new subtests: "Shift+Enter in the thread box sends once; …" and "Shift+Enter in a question box presses its Answer: …". Each sends real CDP key events carrying `\r`, so a missed `preventDefault` shows as a new line. Each checks that the key it meant reached the page before checking that nothing was posted.
- CI: test.yml, every job.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
