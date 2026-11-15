# kit-207-shift-enter-submits: spec

Shift+Enter in a text box submits the form being edited: a question's answer or a thread reply.

## Why

The owner's ask (thread t-20261115-020337375-owner): "If I shift enter in a text box, it submits the form i'm currently editing (questions + threads)". The supervisor answered there: "Shift+Enter will submit what you're typing: a question's answer (still asking which choice if you typed your own words) or a thread reply. Plain Enter keeps making a new line." The owner resolved the thread ("Tracked!").

## How it works today

- **Question cards** (`questionCard`, `index.html` ~1294): one `textarea[data-q]` per card (`[data-qcard]`; the Inbox copy is `#q-<id>`, a thread's copy `#t-q-<id>`). The card's submit is a button: `[data-answer]` (labelled Answer, or Send for owner-action and goal-approval), or, on a card with secrets, `[data-reply]` (Reply) beside Post and Can't right now (a sensor's secret card has no Reply, only Post and Don't use this sensor). A review card (`reviewCard`) has its note box in `[data-decline-form]`, submitted by `[data-decline]` (Send it back). Enter and Shift+Enter both make a new line; no key submits.
- **The thread card** (`tlCardFrame` ~4662): one `#tl-c-text` serves a thread's reply and a new thread (the dock's New thread, a Shift+click, a pin). Today **plain Enter sends** (`tlSend`, the keydown listener at ~4983) and Shift+Enter makes a new line; the placeholder says "Enter sends; Shift+Enter is a new line."
- The Answer button's click handler (~5584) does the which-choice step (kit-203): typed words with no pick on a question with choices raise the ask instead of posting. `press()` serialises posts per key, `tlSend` clears the box in `apply`, and `markAnswered` replaces both card copies at once.

## The change

1. **One keydown listener** on `document`, replacing the one at ~4983. It acts only on `Enter` with `shiftKey` and no Ctrl, Alt or Meta, and never while IME composition is active (`e.isComposing`, or `keyCode` 229, which Safari reports for the Enter that ends a composition).
2. **In `#tl-c-text`** (every thread reply and the new-thread box): Shift+Enter prevents the default newline and calls `tlSend()`.
3. **In a question card's `textarea[data-q]`** (every copy, Inbox and thread): Shift+Enter prevents the newline and clicks the box's own submit button, found from the box: in a `[data-decline-form]`, its `[data-decline]`; otherwise its card's `[data-answer]`, else its card's `[data-reply]`. The click goes through the existing click handler, so a typed answer still gets the which-choice step and every refusal ("Pick a choice or write an answer.") shows as it does for a press. A box with no such button (a sensor's secret card) keeps Shift+Enter's default newline.
4. **Key repeat**: a keydown with `e.repeat` set prevents the newline and submits nothing. Holding Shift+Enter posts once.
5. **Plain Enter** makes a new line in every box. In the thread box that **reverses today's behaviour** (Enter sent): the ticket's done-when and the supervisor's words to the owner both say plain Enter makes a new line, so Enter no longer sends there. The placeholder becomes "Write to the supervisor. Shift+Enter sends; Enter is a new line."
6. Every existing test that sends from `#tl-c-text` with `p.key('Enter')` sends with Shift+Enter instead: ten places in `test/dashboard.test.mjs` (today's lines 540, 544, 2266, 2395, 3187, 3228, 3241, 3293, 3768, 3925; several are outside the threads test). The test named "Enter sends the first words…" is renamed to say Shift+Enter (spec-1 F1).
7. **How the tests press keys.** `test/lib/chrome.mjs` is outside touches, and its `key('Enter', …)` sends no `text`, so Chrome would insert no newline whatever the handler did. Every Enter or Shift+Enter keyDown a new check sends goes through `p.send('Input.dispatchKeyEvent', …)` with `text: '\r'` (Shift: `modifiers: 8`), so a missing `preventDefault` shows as a `\n` in the box (spec-1 F3). The ten migrated sends may use `p.key('Enter', 8)`: they check that the turn posts, not the newline.

## Acceptance checks (the done-whens)

| # | Done-when | Check |
|---|---|---|
| 1 | In a question card's note box, Shift+Enter presses that card's Answer (typed answer still gets the which-choice step); in a thread's reply box, Shift+Enter sends; plain Enter makes a new line; nothing is sent while IME composition is active | browser test: typed words, no pick, Shift+Enter in the Inbox card's box → the which-choice ask appears, nothing posted; a pick, the box focused again (the pick moved focus to the radio, spec-1 F7), then Shift+Enter → answered once. Thread box: Shift+Enter → the turn in the log. A keydown with `isComposing: true` (a dispatched `KeyboardEvent`), and one with `keyCode` 229 (CDP `windowsVirtualKeyCode: 229`), in each box → nothing posted. Ctrl+Shift+Enter in the thread box → nothing posted (spec-1 F4) |
| 2 | Every copy of a question card (Inbox and thread), every thread reply box, and the new-thread box | browser test: the thread copy (`#t-q-<id>`) answered by Shift+Enter; a new thread started from the dock by Shift+Enter (the existing dock test, now Shift+Enter) |
| 3 | A test covers both boxes: Shift+Enter submits once (no double post on key repeat), Enter adds a newline | browser test, in each box with words in it: CDP `Enter` with text `\r` → the value gains a `\n` and nothing is posted; a lone Shift+Enter keyDown with `autoRepeat: true` and text `\r` → nothing posted and the value unchanged (no `\n`): this fails without the `e.repeat` guard (spec-1 F2); then a Shift+Enter (text `\r`) followed by an `autoRepeat` one → exactly one turn / one answer in the log |
| 4 | test.yml passes on every job; no file is added | CI at the head; `git diff --name-only --diff-filter=A origin/main` lists only this ticket's records |

## Contracts

None provided or changed. Consumed: the existing `/api/answer`, `/api/thread-say`, `/api/thread-new` posts, unchanged.

## Edge cases

- A which-choice ask already up: Shift+Enter presses Answer again, which keeps the ask (the existing handler) and posts nothing.
- A second, separate Shift+Enter after a send: the thread box is empty (`tlSend` returns on empty text); the answered card's box is gone (`markAnswered`). No double post.
- Shift+Enter on an empty question box with no pick: the card's own refusal shows, as a press would.
- A focused box that is not one of these (the review panel's `#rv-decline-note`, a lesson's note, a secret's value box, the resolve outcome box): unchanged.
- A secret card's Reply and a review card's Send it back: the lookup is read by the reviewer, not driven by a test (their fixtures are heavy and the path is the same `.click()`); listed in the plan's review focus (spec-1 F4).
- The page's other Shift handlers (`tsRaise` on `Shift` over a frame, skipped while typing) see only the `Shift` key, not `Enter`: unaffected.

## Out of scope

`docs/devteam/dashboard/hub.html`'s operator thread box ("Enter sends; Shift+Enter is a new line.", ~845): outside touches. After this ticket the owner's two thread boxes use opposite keys; the review request proposes a follow-up chore to make the hub's match (spec-1 F5). Shift+Enter in the review panel, the lesson notes, the secret value boxes, the resolve-outcome box; Ctrl/Cmd+Enter; any change outside `index.html` and its test.

## Rulings

None yet. The review request asks the supervisor to confirm that Enter no longer sends in the thread box (the owner's thread never said Enter-to-send goes away; spec-1 F6); the PR body says it too.
