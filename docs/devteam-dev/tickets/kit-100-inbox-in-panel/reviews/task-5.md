# Task 5 review, pass 1

- Reviewer: fresh task-review subagent (claude-opus-5-5); has not seen the build
- Reviewed: 199afa5..e476df5f41b552dbcaa6ba5a3d93d98c588a3b76

Read the whole diff against the brief, spec §2.7 to §2.9 and AC5, and the ruling m-20261116-041710126. Checked in index.html: layerField's callers (holding, the three draft filters, the pageField restore), TL.pressed (tlOwn) and PRESSED (unfiltered), both Escape handlers and their order, the input types in #th-inbox (secrets are textareas, overrule is type=text), focusBack's nth restore, the z-order (scrim 20, .threads 22, in-threads pins 24, review 25, tl-card 50), and askEscCancels against kit-241's paneEscCancels character for character. Ran nothing.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec §2.8 / AC5 | test/dashboard-inbox-panel.test.mjs:607 | While the review is up the test never asserts that the panel is still open on Inbox. The width comparison and the elementFromPoint check would both pass with the panel closed, since a closed panel still has its width and is off-screen. Fix: add `${IS_OPEN} && ${ON_INBOX}` (or the th=inbox state the route holds) to the 'the review open' wait. | fixed at f47b0c9: the review-open wait also requires the panel open on Inbox under it |
| F2 | Minor | quality | docs/devteam/dashboard/index.html:5977 | layerField has the same body as tlOwn (5974), so the two can drift apart. Fix: `const layerField = tlOwn;` and keep its comment. | fixed at f47b0c9: const layerField = tlOwn, with its comment |
| F3 | Minor | quality | docs/devteam/dashboard/index.html:6042 | The Inbox-typing Escape guard runs before kit-89's pin-mode and Shift-cursor exit. With the focus in an Inbox text field and pin mode on, Escape doesn't leave pin mode. This fits the letter of §2.7 ("closes nothing"). If that isn't intended, move the guard below the line-6043 branch. Otherwise say so in a comment. | fixed at f47b0c9: Escape in an Inbox text field leaves pin mode first, still closes no thread or panel; asserted |

Verdict: APPROVE e476df5f41b552dbcaa6ba5a3d93d98c588a3b76
