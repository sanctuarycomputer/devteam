# Delta review after merging main, pass 1

- Reviewer: delta-reviewer-1 (fresh subagent, claude-opus-5-5)
- Reviewed: 4a3ccf969dd47f32259a67cf95a82bdbf88bcde8

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| D1 | Minor | spec (hub adopts dashboard-shell@1) | test/dashboard-shell.test.mjs:113,128 | The merge kept kit-87's test title "... the hub has none yet" and its comment "the hub has no .shell until its own ticket (kit-94)". The same test now asserts that hub.html adopts the shell, so the title and the comment contradict the assertion. Only the wording is wrong; the assertions are right. | |
| D2 | Minor | none (Suggestion-grade) | test/dashboard-shell.test.mjs:136 | The new comment says the hub's "timeline and frames" are fenced with .no-shell. The assertion only checks `<body class="shell">`. Nothing in this file or in hub-overview.test.mjs checks that hub.html's `#tl` carries no-shell, which index.html's ids do get. This is not a loss from the merge, because neither parent asserted it, but the comment claims more than the test proves. | |

Checked, no finding:
- **Conflict resolution.** I compared `git show --cc` with both parents. kit-87's index checks are kept byte for byte: `<body class="shell">` and the 16 ids with no-shell. The only change on that side is a trailing `;` in one comment. kit-87's `hub.html has no .shell yet` doesNotMatch is now `hub.html adopts the shell on <body>`, and that holds (hub.html:377). Neither side lost anything: kit-94's side had only dropped the hub from the old no-.shell loop. kit-87's other edits to the file are taken as-is: the router pages, health and governance heads, the th=inbox redirect, and stampFor.
- **dashboard-shell@1.** At 4a3ccf9 the `devteam-layout` and `devteam-shell-js` blocks are byte-identical between hub.html and index.html. I compared the extracted blocks by sha256 and re-ran the test. The merge leaves shell.md and hub.html unchanged.
- **Semantic clashes.** devteam.mjs from main changes reviewStats/parseReview, metrics efficiency, pane-answer Esc, and the supervisor prompt. It changes no hub, instances or dashboard-serving path that the hub's tests use. test/lib/chain.mjs gets only metrics and index-Library asserts. hub.html shares no CSS or JS with index.html beyond the two identical blocks. The claims in verification.md name only hub files and the shell test, and still hold.
- **Re-run.** On Node 24, at 4a3ccf9 exported with git archive, dashboard-shell.test.mjs passes 16/16.

Verdict: APPROVE 4a3ccf969dd47f32259a67cf95a82bdbf88bcde8
