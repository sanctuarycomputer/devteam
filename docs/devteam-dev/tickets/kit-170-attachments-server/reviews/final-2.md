# Final review: kit-170 attachments server (pass 2a, confirm)

- Reviewer: kit-170 final reviewer 2a (fresh subagent of the supervisor, not the author; model claude-opus-5-5)
- Reviewed: 765d8e49d8f3a85e837b11e04d7505f677ac82f5

## Findings

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec Rulings, "Final review 1a F3" (the dashboard's server gets a `requestTimeout` of 1 h; other bodies keep 5 min by their own timer); quality.md §3 (a test should fail when the behaviour breaks) | docs/devteam/scripts/devteam.mjs:16929 (`server.requestTimeout = UPLOAD_REQUEST_MS`), :16499 (bodyTimer), :14836 (stall timer); test/attachments.test.mjs:252 | The new test proves that `POST /upload` clears the 5-min body timer. It does not prove the 1 h `requestTimeout`, which is the part that fixes 1a F3. If that line is deleted (P10), the test still passes, and a real laptop upload over 5 min is cut again by Node's default 300 s. Two other mutations of the new timers also survive. P16: the body timer destroys a request even when `req.complete` is true. P17: the stall timer is armed only after the first chunk. P17 matters more now. Under 1 h, a `POST /upload` that passes its checks and never sends a byte is closed only by the stall timer, while it holds its reservation against the total (UPLOAD_MAX when chunked). A7's stall case sends 10 bytes first. The code at the head is right: my probe of a zero-byte chunked upload was reset at 60.0 s, its folder was removed and the next upload got 200. A cheap guard: a zero-byte case in A7 (with the 300 ms stall override), and the 1 h value asserted where the test can read it (for example a test-only override that can only lower it, as for the others). | |
| F2 | Minor | spec Rulings, "Final review 1a F3" (`DEVTEAM_UPLOAD_BODY_MS` "can only lower the value") | docs/devteam/scripts/devteam.mjs:14752; test/attachments.test.mjs:261 ("an override never raises a limit") | An override that raises `bodyMs` (P12) passes every test. "An override never raises a limit" doesn't cover the new variable. The code at the head uses `Math.min`, and the variable is read only under `boxFilesOff()`. So this is a missing case, not a defect. | |
| F3 | Minor | done-when 1 ("passes in CI") | PR #316, run 44013004902 at 765d8e49 | CI at the exact head is red on `kit (20, chain)`, `kit (24, chrome 2/2)` and the `tests` roll-up. The chain job failed test/kit.test.mjs's previews subtests (63–68, a fork exited 1). The chrome job failed test/dashboard-threads-sidebar.test.mjs "opening threads" (timed out). Neither test is in the diff, and the sidebar test is the flake pass 1 saw. Run 44012366868 at e1c00630 was green on every job, and its code is identical (765d8e49 adds only verification.md). test/attachments.test.mjs passed all 33 tests in CI at the head (kit 22, rest 2/2), including the box-skipped override test. Re-run the failed jobs before merging. | |

## What I checked

Read the full fix diff `db0cd68..765d8e49` outside the records. Code changes are only in devteam.mjs: `UPLOAD_REQUEST_MS`/`UPLOAD_BODY_MS`, `bodyMs` in `uploadLimits()`, the per-request body timer, its clear on `POST /upload`, and `server.requestTimeout`. Tests are added in test/attachments.test.mjs. I also read both pass-1 records with their dispositions, the spec with its Rulings, the ticket's done-whens and notes (`ticket show`), the PR body, the head's `receiveLaptopUpload`, `sweepLaptopUploads`, `serveLaptopUpload`, `attachedFiles` and `droppedFileProblem`, and the gateway's `serveUpload`, `scanUploads` and timers, for parity.

**Run at the head.** test/attachments.test.mjs under the shared lock, `--test-concurrency=2`: exit 0, 33 tests, 32 pass, 1 skipped. The skipped test is "the override is ignored without DEVTEAM_BOX=off", which can't run on a box and passes in CI.

**Pass-1 findings, each fix proved by mutation.** Each mutation was applied in the worktree, the named tests run, then the file restored with `git checkout`. The worktree was clean at the end.
- 1a F1 / 1b F1 (a linked folder of ours pointing out):
  - P1, `attachedFiles` with `path.resolve` in place of `realpathSync` (pass 1's M10): **caught** by B3. The linked-folder case got `200 answered q-…`, where 400 was expected.
  - P2, the gateway serve with `path.join` in place of realpath (M31): **caught** by box C4. `/upload/<linked>/x.txt: 200 away`.
  - P3, the same on the laptop serve (M32/M33): **caught** by laptop C4.
  - Fixed. B3 now runs answer, thread-say and thread-new.
- 1a F1, the sweep pinned:
  - P13, the laptop sweep follows links (Dirent `isSymbolicLink` let through, `stat` for `lstat`): **caught** by A9.
  - P14, the same in the gateway's `scanUploads`: **caught** by A9's gateway half.
  - In both, the link left the root's listing.
- 1a F2 (CI flakes): the head is red again for the same kind of reason (F3 above).
- 1a F3 (the request timeout):
  - P8, `POST /upload` doesn't clear the body timer: **caught**.
  - P9, no body timer: **caught** ("another route's body still coming is cut within 3 s").
  - P11, `DEVTEAM_UPLOAD_BODY_MS` not read: **caught**.
  - P10, no `server.requestTimeout`: **survived** (F1).
  - P16 and P17: **survived** (F1). P12: **survived** (F2).
  - Fixed in code; its test is partial.
- 1b F2, the given path recorded instead of the real one (P5): **caught** by B1 ("the answer records the real path").
- 1b F3, the queued nudge drops `paste` (P6): **caught** by the new DEVTEAM_REPLY_FD test.
- 1b F4, `files` taken out of the question's `x-set-only` (P7): **caught** by the log-check test ("a question's new line with files: log-check passed").
- 1b F5: recorded in the spec Rulings as a known limit that fails closed, as disposed.
- Also survived, and harmless: P4. With the laptop serve's exact real-path equality kept, removing its `droppedFileProblem` call changes nothing, because the regex and `O_NOFOLLOW` plus `isFile` repeat it.

**The new timers, probed** (a real dashboard at the head, no overrides, 127.0.0.1 on a port above 40000, stopped by the probe):
- A `POST /upload` that passes every check (chunked, so UPLOAD_MAX is reserved) and never sends a byte: reset at 60.0 s by the stall timer. Its folder was gone 1 s later, and the next upload got 200, so the reservation was released.
- A header slow-loris on `/api/answer` (a header line every 5 s, never finished): `408 Request Timeout` at about 90 s. `keepAlive` keeps `headersTimeout` at 66 s, unchanged by the 1 h `requestTimeout`.
- A body that never comes on another route is cut by the body timer. The PR's test shows this at 300 ms, and P9 shows the test fails without it.
- A body still moving past it on `/upload` is taken (the PR's test, and P8).
- The body timer is cleared before the upload route's own refusals. Each of those answers with `connection: close` before reading, so the socket goes. A5 still passes.
- The timer acts only while `!req.complete`, so GETs and served files are never cut.
- The gateway does the same, with `headersTimeout` 66 s and `requestTimeout` 1 h.

**Attacks the fix diff could affect.** These are re-run through the PR's tests at the head, all passing:
- the laptop cross-site POST, wrong Host and missing or wrong Origin or Sec-Fetch-Site, each before a byte is read (A5);
- the cross-site GET (C3);
- HTML and SVG served back as `application/octet-stream` attachments with `nosniff` and `CSP: sandbox` (C1);
- the size caps and the stall timer (A7);
- the sweep, which removes an empty folder only past UPLOAD_STALL_MS, keeps a fresh `.part`, and now doesn't follow a linked folder (A9);
- concurrent uploads, standing in for two dashboards (B-1 test);
- paths outside the folder (`..`, absolute, encoded, a linked file and a linked folder) on both servers (B3, C4).

The gateway is unchanged since db0cd68, so the box attacks from pass 1 stand. These are an upload with no session (401), no or a wrong Origin (403), and a cross-site non-navigation GET (403). A1–A3 and C2 pass at the head.

**The kit's rules:**
- The diff adds no file outside `test/` apart from the ticket's records folder; the one new file is `test/attachments.test.mjs`.
- It touches exactly the ticket's four `touches`.
- test/gateway.test.mjs is unchanged.
- The PR body has `## One-way doors` (None).
- The merge base is origin/main (be69e20d).

Verdict: APPROVE 765d8e49d8f3a85e837b11e04d7505f677ac82f5
