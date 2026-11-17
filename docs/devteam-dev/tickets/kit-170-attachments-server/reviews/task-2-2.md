# Task review: T2 (laptop upload), pass 2

- Reviewer: task-rereviewer-t2 (fresh subagent, claude-sonnet)
- Reviewed: aa82ea049f3654e008ecdd9ef9f1777163503483 (fix diff 3ac257ff..aa82ea04)

- T2-1: ADDRESSED. docs/devteam/scripts/devteam.mjs:14736 now returns quietly only on `res.destroyed || req.socket?.destroyed`; a stall's `req.destroy()` still destroys the socket, so it stays quiet. The new test (test/attachments.test.mjs:274-297) uses a real EACCES on the rename: the `.part` is open before the folder goes 0500, so writes continue and only the rename fails. Without the fix `req.destroyed` is true after the read on Node 18 and nothing is sent; the fix report records the RED run ("no answer"). It is deterministic: it polls (10 ms steps) for the folder and for the `.part` before the chmod, and the 800 ms gap gives ample margin. The mode is restored in a `finally` (line 290) before the fixture's hook removes the base, so no dir is left. The chmod happens only after the `.part` exists, so an early assertion failure cannot leave a 0500 dir. The test needs a non-root user (EACCES), and the box runs as uid 1000. Both the report and the diff's own comment say the leftover folder in the failing condition is swept later.
- T2-2: ADDRESSED. The live `uploadsReceiving` map is passed (14703) and re-checked just before each removal (14675), alongside the skip at 14666.
- T2-3: ADDRESSED. 14673 removes an empty folder only when older than `stallMs`; A9 (test line ~250) seeds an aged empty folder (removed) and a fresh empty one (kept), matching ruling m-20261117-005812254.
- T2-4: ADDRESSED. test/attachments.test.mjs:162 asserts `!fs.existsSync(L.folder())` after the seven refusals.

No new findings.

Deferred (not blocking): T2-2 has no deterministic test (the window is the awaits inside the sweep; the code is covered by reading). The report's note that another dashboard's sweep could remove a just-made empty folder is now narrower, since an empty folder survives `stallMs`.

Verdict: APPROVE aa82ea049f3654e008ecdd9ef9f1777163503483
