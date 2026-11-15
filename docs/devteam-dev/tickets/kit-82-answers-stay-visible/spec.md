# kit-82: A refused answer stays on its card until dismissed, and a moved link disables Answer

Story DCL-S1 (feature `dashboard-cleanup`, design `project/designs/a-cleaner-more-consistent-dashboard.md` §"First, a fix", lines 446–450). Depends on `kit-81` (merged, #250: `links_moved` on every question view) and `kit-207` (merged, #246: Shift+Enter presses a card's Answer).

## Why

`q-20261114-203542888-supervisor` linked a mock that kept changing. The kit refused the owner's answer (`artifactLinksMoved`), the card wrote "Not saved: …" into its error line, and the 10-second redraw rebuilt the card and wiped the line. The owner never saw why. W1: every change makes an answer cheaper.

## How it works today

- `press()` (`docs/devteam/dashboard/index.html` ~3799) posts an owner action. On a refusal it reloads, undoes the overlay, redraws, restores the boxes, then writes `Not saved: <error>` into `#e-<errId>`, a span inside the card's HTML. The next `render()` rebuilds the card from `questionCard()` and the span is empty again.
- `answerPress()` (~3881) wraps `press()` for a question: the card shows "Answered: …" at once; a refusal puts back the note and the pick (`drafts`, `picks`, both page memory, so they survive redraws).
- The server sets `links_moved` (a sentence, or null) on each open question whose pinned artifact link changed or went (`artifactLinksMoved`, `devteam.mjs` ~1841); each of the question's `links` carries `changed` / `gone`. The card already marks such a link "changed since asked" in its "Look at:" list, but Answer is live and the answer is refused.

## What changes (one file of product code: `docs/devteam/dashboard/index.html`)

1. **A refused answer stays.** A `REFUSED` map in page memory, question id → the reason. When `answerPress()`'s post is refused, the reason goes in the map before the redraw. `questionCard()` draws it on every copy of that question (Inbox and a thread's card) as a line near the Answer row: `Not saved: <reason>` with a Dismiss button (`[data-refused]`, `[data-dismiss-refused]`). It is drawn on every redraw until:
   - the owner presses Dismiss (the entry goes; the card redraws without it);
   - the owner presses Answer (or Reply, Can't or Don't use this sensor, which also go through `answerPress`) again: the entry goes when the new press starts; a new refusal puts a new one;
   - the answer goes through (`onOk`);
   - the question is no longer open (not in the data's `questions`): pruned at render.
   The pick and the note stay in their boxes, as today (`putBackCard`, `putBackBoxes`).
   - `press()` gains an optional `onError(error)`, called before the redraw; when given, `press()` does not write the transient error line. Every other caller of `press()` is unchanged, including Post on a secrets card, which calls `press()` directly and keeps its transient line.
   - `answerPress()` gains a sixth argument, `{ stays = true }`. Question-card callers (the click handler's Answer, `button[data-which]`, Reply, Can't, Don't use) take the default and pass `onError`. `reviewDecline` (a review card's "Send it back" and the review panel, `errId` `'rv'`) passes `{ stays: false }`: no `onError`, so `press()` writes `#e-<errId>` as today and `reviewDecline` reads it back as today. Review cards are drawn by `reviewCard`, not `questionCard`, and are out of scope.
   - Validation messages ("Pick a choice or write an answer.") keep the transient `#e-<id>` span; they are not refusals.
2. **A moved link shows first.** When `q.links_moved` is set, the card's first element straight after `cardHead(...)` (before `rankWhy` and everything else) is `<link> changed since this was asked; the supervisor will ask again` (`[data-links-moved]`), where `<link>` is the title (escaped) of each pinned artifact link marked `changed`, joined with commas. Pinned means what the server counts: `l.artifact !== undefined && l.sha256` (`pinnedArtifact`, `devteam.mjs` ~1840); an unpinned gone link is never named. If none is `changed` but some are `gone`, it says `<link> is no longer available; the supervisor will ask again`. If the server set `links_moved` but no link carries either flag (an older server), the line uses the server's own sentence. The card's `[data-answer]` button (Answer, or Send on owner-action and goal-approval) is `disabled`, with a `title` giving the same sentence, and so is every `button[data-which]` of a "which choice do these words mean" ask drawn on it (redrawn from `ASKS[id]`, it would otherwise post an answer the server refuses). The note box, the choices and Dismiss stay live, so the owner can still type. A disabled button ignores `click()`, so Shift+Enter in the note (`kit-207`'s `submitOf`) does nothing.
   - A secrets card (Post/Reply/Can't) has no `[data-answer]`; it is out of scope (`links_moved` concerns questions with artifact links; nothing changes there).

## Acceptance checks (the done-whens)

1. `test/dashboard-answers.test.mjs` passes in CI (headless Chrome through `test/lib/chrome.mjs`'s `openChrome`, as `test/dashboard.test.mjs` drives it, skipped without `canDrive`): a real dashboard (`dashboardOnFreePort`) over a `bareProject` with two open questions, its own hub port and port base from the file's block, `CLAUDE_CONFIG_DIR`/`CODEX_HOME` in its temp dir. The new file has its own small init script (not an import of `dashboard.test.mjs`, whose suite would run in this process; nothing moves to `test/lib`): the 10 s refresh at 300 ms, a `__polls` counter, and two layers on `fetch`, registered in this order so the recorder sits outside the stub: first the stub (`/api/answer` answers 409 `{ "error": "<reason>" }`; `/api/data` is rewritten as in check 2), then the recorder (every POST to `/api/` pushed to `window.__posts`). The owner picks a choice, types a note, presses Answer:
   - the refused answer is in `__posts` (the positive control for check 2's negative);
   - the card shows `Not saved: <reason>`;
   - still there after three redraws: `redrawNow()` three times, then, with focus off the note, three polls, after which the card is a new element (the test tags the old node and sees the tag gone), so a poll really rebuilt it;
   - the chosen option is checked and the note is in its box;
   - Dismiss removes the line, and it stays gone across a redraw.
2. Same file: `/api/data` is stubbed (the inner layer) to set, on the second question, `links_moved` and a pinned artifact link `{ artifact, title, sha256, href, changed: true }` (with an `href`, so the "Look at:" list draws a link). Its card shows `<title> changed since this was asked; the supervisor will ask again` as the first element after the card head; its Answer button is `disabled`; the note box takes typed text; Shift+Enter in it records no new `/api/answer` in `__posts` after at least one poll has passed.
3. `test/dashboard.test.mjs` passes, changed only where it asserted the old error line (`e-${Q2}` at ~line 500 → the card's `[data-refused]` line).

## Contracts

None provided or consumed beyond `links_moved` and `links[].changed|gone` on `/api/data` questions (kit-81, unchanged).

## Edge cases

- Two copies of a question (Inbox and a thread card): the refusal is per question, so both show it; Dismiss on either clears both.
- The question withdrawn while the refusal shows: the next render prunes it with the card.
- A refusal followed by a second refused press: the line shows the latest reason.
- Goal approval's Send through `goal-decide` goes through `answerPress` too: same behaviour.
- `reviewDecline` (review card and review panel): unchanged, transient line as today (`{ stays: false }`).
- An ask (`button[data-which]`) raised before `links_moved` arrives: its buttons are drawn disabled.
- The other `press()` callers (lessons, overrule, corrections, fleet, previews): unchanged, transient line as today.

## Out of scope

- The server side (`links_moved`, the `question-link-changed` finding): kit-81.
- Refusals for presses other than answers.
- Any change to the other test files in `touches` (they are listed for golden data; none is expected to change).

## Rulings

None yet.
