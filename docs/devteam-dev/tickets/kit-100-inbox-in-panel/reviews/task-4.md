# Task 4 review, pass 1

- Reviewer: fresh task-review subagent (claude-opus-5-5); has not seen the build
- Reviewed: 4ec2822..b659a4b72078c896df434cae1bbf09fe3fddf549

Read the whole diff against the brief, spec §2.3, §2.6, §4, AC3 and AC4. Checked the T_HOME/tlHome/tlInboxHome/tlInPanel order, the thDecide rewrite, subjectHead/tlRoute/thOpenRow, the pin and card placement against tPlace, the stacking change, and the new listeners. For the named risk (subtest 2's lost plain click on a[href="#inbox"]) I traced the window capture handler, the delegated handler, p.click in test/lib/chrome.mjs and the stacking contexts. I found no path from this diff into that click, and I did not run the test.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | quality | docs/devteam/dashboard/index.html:7181-7182 | Each #th-body scroll event, and each page scroll event while th=inbox, runs tlReplace synchronously: every pin's rect, tsWatch, tsPins and tlPlaceCard. Nothing coalesces them, so a fling runs this dozens of times a frame. Fix: coalesce through one requestAnimationFrame flag. | fixed at 6f15bae: tlReplaceSoon coalesces both scroll listeners into one frame (task-4-2) |
| F2 | Minor | spec §2.6 | test/dashboard-inbox-panel.test.mjs:312 | BESIDE checks only that the card's right edge is at most the panel's left edge (AC4). Spec §2.6 says that edge sits exactly 10px left of the panel above 900px, and no test checks it. Fix: at 1440, also assert that the card's right edge is within 1px of the panel's left edge minus 10. | fixed at 6f15bae: the 1440 check asserts the 10px gap within 1px; it found a 15px placement bug, fixed in the same commit |
| F3 | Minor | quality | docs/devteam/dashboard/index.html:6447-6448, 6826-6827 | The comments on tlPlaceCard and tlPins still say both are placed "in page coordinates", but Inbox-home pins and cards are now placed in the window's coordinates. Fix: add a clause about the in-threads case to each comment. | fixed at 6f15bae: tlPlaceCard and tlPins comments name the in-threads window-coordinates case |

Verdict: APPROVE b659a4b72078c896df434cae1bbf09fe3fddf549
