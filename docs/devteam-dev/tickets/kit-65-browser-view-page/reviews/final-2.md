- Reviewer: final-2 (fresh subagent of the supervisor, claude-sonnet; cold confirm of track a)
- Reviewed: 72059c4d965a44bc98efa06373e2e53a8fb11072 (diff since 5a344ae)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | (was Important) | quality.md §3 | test/browser-view-page.test.mjs, not-queued test | Fixed. Down-time input is now Cyrillic markers (Ю, Я, down-pasted) and later input (a paste, typing, a wheel) is sent after reconnect, with the assertion over every socket after all of it. A lazy-flush mutation of send() (queue while down, flush before the next message, CSP script hash recomputed so the page runs; CSP test still passed) fails both the not-queued test and the page-memory test. | Confirmed fixed |
| F2 | (was Important) | ruling on F2 | browser.html #signout, forget handler | Fixed. The button starts disabled, is enabled on open, disabled on close. Forget with no live socket says exactly 'Not connected: nothing was signed out.' and sends nothing. New test covers off while down, on again, the race, and off after bye. | Confirmed fixed |
| FB4 | (was Minor) | n/a | browser.html submit and Back handlers | Fixed. An address or Back with no live socket says exactly 'Not connected: not sent.' and sends nothing; sent normally once live. Test covers it. | Confirmed fixed |
| N1 | Minor | scope | browser.html altGr, fit(), dialog width; test pageMemory, history. and location.hash checks | Extra changes beyond F1 and F2 (Ctrl+Alt+letter now a chord; a footer re-fit; dialog width; stricter memory and no-history assertions). All are small, tested, keep no typed text and touch neither the CSP origins nor the origin checks. The CSP hashes were updated to match the edited script and style. | Accepted, no action |

No new Critical or Important.

What I checked: the diff since 5a344ae in browser.html and the test file; that send() still drops with no open socket and nothing is queued; that the new copy matches the ruling character for character; that the CSP stays as before (default-src 'none', connect-src 'self', no new sources) and the test that checks the CSP hashes passes; that no storage, history or location use was added (the test now forbids history. and location.hash). I ran test/browser-view-page.test.mjs on Node 22 with the box command: 32 of 32 pass. I ran the lazy-flush mutation in a scratch copy: the not-queued and page-memory tests fail, as required. The worktree and the scratch copy are removed.

Verdict: APPROVE 72059c4d965a44bc98efa06373e2e53a8fb11072
