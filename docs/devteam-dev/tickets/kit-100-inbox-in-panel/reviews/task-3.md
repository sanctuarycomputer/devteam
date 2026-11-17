# Task 3 review, pass 1

- Reviewer: fresh task-review subagent (Sonnet 5.5); has not seen the build
- Reviewed: 93ec9e8..37172edd3e9179592c8ad8b1d8de0b92b8760139

Read the brief, the diff and the report; checked openQuestion, inboxGo and inboxAt against thGo, thHead, goHead, route and drawOrHold in index.html (cold-load ordering, nested route, the stamp under a link head). Ran no tests; relied on the report's runs.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | quality | docs/devteam/dashboard/index.html (inboxAt) | A target that never matches stays in INBOX_AT until the next render clears it; if the user reaches the Inbox in that window the panel scrolls to a stale target. Clear it in thGo callers that are not inboxGo, or give it a short expiry. | fixed at 6fc6192: thGo clears INBOX_AT; inboxGo sets its target after thGo |
| F2 | Minor | quality | docs/devteam/dashboard/index.html (data-answered-go handler) | #answered-wrap is opened twice (before inboxGo and again in then). The second is redundant unless a render closes it; say why or drop one. | fixed at 6fc6192: #answered-wrap opened once, before inboxGo; then only focuses Overrule |
| F3 | Minor | quality | test/dashboard-inbox-panel.test.mjs (cold load) | q1 is closed by later() and again explicitly; and a modified click on a[href="#inbox"] and a Loop-page Inbox link are not exercised (only the lesson peek link is). | fixed at 6fc6192: modified clicks on the Loop's Inbox link are not taken; a plain click opens Inbox over Loop; one close of the cold tab |

Verdict: APPROVE 37172edd3e9179592c8ad8b1d8de0b92b8760139
