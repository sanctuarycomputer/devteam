# Final review, pass 1

- Reviewer: final-reviewer (fresh subagent, claude-opus)
- Reviewed: 19c1ecf2289d176b4455c9c58cbb01772d0c6d63 (the whole branch)

Scope: `git diff origin/main...19c1ecf` (merge base 5bd501b7): index.html and eight test files, all in touches. The shell blocks `devteam-layout` and `devteam-shell-js` are byte-identical to the base (md5 of each block at both commits). The commits after 1183847 change only verification.md. CI run 43919676315 at 1183847: success.

Checked: the motion state machine (peekShow/peekHide, reopen mid-slide, the safety net, redraws while sliding out, closeDrawer's guard against closing twice); the shared scrim and overlay-open across openArtifact, openPreview, openReview, closeArtifact and closeReview, with a peek under the viewer and with a review; Back, `#talk/` and the route's hideDrawer; Escape on a focused key; Enter only when the card itself has focus; the inner-control exclusions (summary, details); the writes a peek can reach (Retire it now starts a thread, Overrule is gone from every inPeek caller, and nothing else writes outside the §2.3 allow-list); escaping in cardMenu, titled, howItChanges, the dtitle title, the ticket Links formatter, and props(), which escapes the key and the tip.

Ran: `gate final -- timeout 840 /usr/local/bin/node --test --test-concurrency=2 test/dashboard-peek.test.mjs` exited 0 (37 pass, 0 fail, 0 skipped). Mutation in a separate scratch copy, deleting `if (PEEK_HIDE) PEEK_HIDE.cancel();` from peekShow: "the frame" fails (6 of 16, starting with "reopen during close stays open: the pending hide was cancelled").

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec §2.2 (ID formats) | docs/devteam/dashboard/index.html:4362, :4370 | The milestone and wave ID rows show today's routing keys (`<goal>:<n>`, `<n>`), not the spec's `<goal>/M<n>` and `<feature>/wave-<n>`. The reason holds, since waves are numbered across the project and Copy ID should copy what routes. But this is the worker's ruling against a spec line, recorded only in verification.md. The supervisor should acknowledge it at merge. | wont-fix worker ruling recorded in verification.md Departures: waves span features and Copy ID copies the routing key; raised to the supervisor with the merge request |
| F2 | Minor | done-when 8, spec §2.6 | test/dashboard-measure.test.mjs:38 | The peek entries set `view` to a selector that matches nothing, so page-top is never judged under a peek, although done-when 8 says "every check". This matches kit-87's page entries, and page-top judges the page under the peek, not the peek. Still, it departs from a done-when, which is the supervisor's to rule on. Task-6's reviewer gave it wont-fix and no supervisor ruling is recorded. Acknowledge it at merge. | wont-fix worker ruling recorded in verification.md Departures: matches kit-87's page entries (pages under peeks unconverted); every other check runs at all three sizes; raised to the supervisor with the merge request |
| F3 | Minor | spec §2.1 (hidden below 760px) | docs/devteam/dashboard/index.html:627 | `#tt-peek` is hidden at 840px and below, not below 760px. Between 761 and 840px the owner has no Inbox button while a peek is open: `.tt` sits under the scrim and the peek. The reason is sound (a 720px peek leaves no room), and AC2's "below 760px neither shows" still holds. | wont-fix worker ruling (task-1 F1): between 761 and 840px the mirror would be clipped by the 720px peek; closing the peek restores the Inbox button |
| F4 | Suggestion | none | docs/devteam/dashboard/index.html:1909, :1707 | Board and incident cards were `<button>`. As `div[role=button]` they open on Enter only, not Space. The ARIA button pattern expects both. The spec asks for Enter only. | wont-fix spec 2.5 asks for Enter only; Space on role=button cards is a follow-up for the supervisor |

No Critical or Important defect found.

Verdict: APPROVE 19c1ecf2289d176b4455c9c58cbb01772d0c6d63
