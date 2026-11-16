# kit-174 ahead of kit-99: what breaks, and the options

Ruling m-20261115-210246084-supervisor moved kit-174 after kit-87 and kit-173 only, ahead of kit-88. The approved plan (9e9b758) consumes three things that then won't exist:

1. **The `suggestion` subject type.** `SUBJECT_TYPES` (devteam.mjs:6041) has no `suggestion`; kit-99 adds it (its done_when 1). Without it, `thread new` refuses `{"kind":"item","ref":"suggestion:<id>"}`, so done_when 3 (a click starts a thread on that subject) can't pass. devteam.mjs isn't in kit-174's touches. The page's `T_TYPES`/`T_KIND` also lack it.
2. **Opening the open thread instead of a second one.** kit-97 (one thread per subject) is not merged first either. The page can still find an open thread on the subject client-side (it has the thread list) and open it; only kit-97's server-side refusal is missing, which done_when 3 doesn't require.
3. **Trust's chart helpers and Suggestions list** (score line, sparklines, chart fitting, `suggestionsList`), which kit-93/kit-99 port from the mock. kit-174 would build them itself from the mock, and kit-93/kit-99 would reuse them.

Options:

- **A. Keep kit-99 (and so kit-93, kit-97) before kit-174.** The plan stands as approved. Cost: kit-174 waits for the chain; kit-88 can't follow it as reordered.
- **B (recommended if the reorder's point is to land Efficiency early). Build ahead and take on the pieces:** add `docs/devteam/scripts/devteam.mjs` and a thread-subject test (e.g. `test/efficiency-thread-subject.test.mjs`) to touches; kit-174 adds `suggestion` to `SUBJECT_TYPES` and the page's `T_TYPES`/`T_KIND`, ports the score line, sparkline, chart fitting and suggestions list from the mock as shared page helpers, and does click/Enter → thread with a client-side "open the open one". kit-99 and kit-93 then consume them (their done_whens unchanged; kit-99's SUBJECT_TYPES part becomes already-done). Needs ordering edges: kit-174 before kit-99 and kit-93 on index.html and devteam.mjs; kit-173 also touches devteam.mjs (it's already before kit-174). I re-plan (Tasks 2-4 gain the helpers; a task for the subject type) and re-run plan review.
- **C. Build ahead without thread-starting.** Fails done_when 3; not recommended.
