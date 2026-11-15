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
   - the owner presses Answer (or Post/Reply/Can't, anything through `answerPress`) again: the entry goes when the new press starts; a new refusal puts a new one;
   - the answer goes through (`onOk`);
   - the question is no longer open (not in the data's `questions`): pruned at render.
   The pick and the note stay in their boxes, as today (`putBackCard`, `putBackBoxes`).
   - `press()` gains an optional `onError(error)`, called before the redraw; when given, `press()` does not write the transient error line. Every other caller of `press()` is unchanged.
   - Validation messages ("Pick a choice or write an answer.") keep the transient `#e-<id>` span; they are not refusals.
2. **A moved link shows first.** When `q.links_moved` is set, the card's first line under its head (before the question text) is `<link> changed since this was asked; the supervisor will ask again` (`[data-links-moved]`), where `<link>` is the title of each pinned artifact link marked `changed`, joined with commas. If none is `changed` but some are `gone`, it says `<link> is no longer available; the supervisor will ask again`. If the server set `links_moved` but no link carries either flag (an older server), the line uses the server's own sentence. The card's `[data-answer]` button (Answer, or Send on owner-action and goal-approval) is `disabled`, with a `title` giving the same sentence. The note box, the choices and Dismiss stay live, so the owner can still type. A disabled button ignores `click()`, so Shift+Enter in the note (`kit-207`'s `submitOf`) does nothing.
   - A secrets card (Post/Reply/Can't) has no `[data-answer]`; it is out of scope (`links_moved` concerns questions with artifact links; nothing changes there).

## Acceptance checks (the done-whens)

1. `test/dashboard-answers.test.mjs` passes in CI (headless Chrome, driven as `test/dashboard.test.mjs` drives it, with `canDrive` skip): a real dashboard over a `bareProject` with two open questions; the page's fetch is stubbed so `/api/answer` answers 409 `{ "error": "<reason>" }`. The owner picks a choice, types a note, presses Answer:
   - the card shows `Not saved: <reason>`;
   - still there after three redraws (`redrawNow()` three times, and three polls);
   - the chosen option is checked and the note is in its box;
   - Dismiss removes the line, and it stays gone across a redraw.
2. Same file: `/api/data` is stubbed to set `links_moved` (and `changed` on an artifact link) on the second question. Its card shows `<link> changed since this was asked; the supervisor will ask again` as the first element after the card head; its Answer button is `disabled`; the note box takes typed text; Shift+Enter in it posts nothing (no `/api/answer` recorded).
3. `test/dashboard.test.mjs` passes, changed only where it asserted the old error line (`e-${Q2}` at ~line 500 → the card's `[data-refused]` line).

## Contracts

None provided or consumed beyond `links_moved` and `links[].changed|gone` on `/api/data` questions (kit-81, unchanged).

## Edge cases

- Two copies of a question (Inbox and a thread card): the refusal is per question, so both show it; Dismiss on either clears both.
- The question withdrawn while the refusal shows: the next render prunes it with the card.
- A refusal followed by a second refused press: the line shows the latest reason.
- Goal approval's Send through `goal-decide` goes through `answerPress` too: same behaviour.
- The other `press()` callers (lessons, overrule, corrections, fleet, previews): unchanged, transient line as today.

## Out of scope

- The server side (`links_moved`, the `question-link-changed` finding): kit-81.
- Refusals for presses other than answers.
- Any change to the other test files in `touches` (they are listed for golden data; none is expected to change).

## Rulings

None yet.
