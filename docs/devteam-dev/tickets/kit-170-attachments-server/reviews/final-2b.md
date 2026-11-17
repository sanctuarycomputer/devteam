# Final review: kit-170 attachments server (pass 2b, confirm)

- Reviewer: kit-170 final reviewer 2b (fresh subagent of the supervisor, not the author; model claude-fable-5-2)
- Reviewed: 765d8e49d8f3a85e837b11e04d7505f677ac82f5

## Findings

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec Rulings, "Final review 1a F3" (the dashboard's server gets a `requestTimeout` of 1 h); quality.md §3 (where a test can't prove a property, a mutation should fail one) | docs/devteam/scripts/devteam.mjs:16929 (`server.requestTimeout = UPLOAD_REQUEST_MS`), :16504 (the body timer's `!req.complete` guard) | No test fails when the 1-hour request limit is removed (mutation P9 survives): the new F3 test proves only that the 5-minute body timer is cleared for an upload and kept for other routes. Node enforces the request limit on a 30 s tick and only past 300 s by default, so a test would take over 5 minutes. My probe shows the line works (see below), so the code is right; only the test is missing. The `!req.complete` guard and the timer's clear on `close` also survive removal (P13); the dashboard has no long-lived response today, so nothing breaks. `UPLOAD_REQUEST_MS` and `UPLOAD_BODY_MS` sit outside the upload-rules marker block, so A8 does not hold them equal to the gateway's `REQUEST_MS` and `BODY_MS`. | |
| F2 | Minor | done-when 1 ("passes in CI") | PR #316 checks at 765d8e49 | When I finished, 15 of 17 jobs had passed and two were still pending: `kit (20, chain)` and `kit (24, chrome 2/2)`. Neither runs `test/attachments.test.mjs`'s group (every `rest` job passed, on Node 18, 20, 22 and 24). Wait for both before the merge. | |

## What I checked

Read: the fix diff `db0cd68..765d8e49` in full (devteam.mjs timers, the test changes), the whole diff against origin/main for `cloud/gateway.mjs`, `docs/devteam/scripts/devteam.mjs` and `docs/devteam/schema/log.schema.json`, the spec with its Rulings, verification.md, both pass-1 records with their dispositions, the PR body, the ticket's done-whens and notes, and quality.md §3.

**Run.** `test/attachments.test.mjs` at the head, under the shared lock, `--test-concurrency=2`, Node 22.23.4: exit 0, 33 tests, 32 pass, 1 skipped ("the override is ignored without DEVTEAM_BOX=off", which can't run on a box; CI runs it). `test/gateway.test.mjs` is not in the diff and I did not run it (brief scope); its CI jobs passed.

**Pass 1's findings, each against the head.** Every mutation was applied in the worktree, the matching test run by name, and the file restored with `git checkout`; the worktree is clean at the head.

| Finding | Fixed? | Mutation | Result |
|---|---|---|---|
| 1a F1 / 1b F1 (realpath untested) | yes | P1: `attachedFiles` uses `path.resolve` in place of `realpathSync` | caught by B3: the linked-folder answer got 200 |
| | | P2: the gateway serve uses `path.join` in place of `realpath` | caught by box C4: `/upload/<linked>/x.txt` got 200 |
| | | P3: the same on the laptop serve | caught by laptop C4, the same way |
| | | P10: the laptop sweep follows a linked folder | caught by A9 |
| | | P11: the gateway scan follows a linked folder | caught by A9, the gateway half |
| 1a F2 (CI red at the old head) | reran green there; at this head see F2 | none | 15 pass, 2 pending |
| 1a F3 (uploads cut at 5 min) | yes | P7: the upload no longer clears the body timer | caught by the F3 test (the upload is cut) |
| | | P8: the body timer does nothing | caught by the F3 test (the held `/api/answer` hangs) |
| | | P9: `server.requestTimeout` line removed | **survived** (F1) |
| | | P12: an override may raise a limit | caught by "an override never raises a limit" |
| | | P13: the timer destroys a complete request and is never cleared | **survived** (F1) |
| 1b F2 (real path recorded) | yes | P4: records `f.path` as given | caught by B1: "the answer records the real path" |
| 1b F3 (queued nudge keeps paste) | yes | P5: `queuedNudges.push({ line })` | caught by the `DEVTEAM_REPLY_FD` test: the pane got no paste |
| 1b F4 (`files` set-only on a question) | yes | P6: `files` out of the question's `x-set-only` | caught by the log-check test |
| 1b F5 (`--host` over plain http) | documented in the spec's Rulings; fails closed | none | no code change, as disposed |

**The new timers on the laptop server** (my own probe: a dashboard from a scratch copy of the head, on 127.0.0.1 ports above 41000, stopped by the same script).

- **A slow-loris that never sends a body** (`POST /upload`, checks pass, 100 bytes declared, none sent; test-only stall 1500 ms, body timer 400 ms): the connection is reset at 1.5 s by the stall timer, and the folder is gone within about a second.
- **A `POST /upload` that sends 20 bytes and stalls:** reset at 1.6 s, no folder left.
- **An upload still moving past the body timer** (30 chunks over 4.5 s, body timer 400 ms): 200, 300 bytes.
- **Refusals with the body held** (wrong Origin, no `Sec-Fetch-Site`, wrong Host, 1 MB declared and never sent): 403 in 2 to 7 ms, connection closed.
- **Another route's body held** (`/api/answer`): cut at the body timer (402 ms, and 46 ms with a 40 ms timer).
- **A complete request is not cut by the timer** (40 ms timer): `/api/thread-new` answered 200 after 405 ms, `GET /api/data` 200 after 492 ms, and a 3 MB stored file read by a reader paused 1.5 s came back whole.
- **Keep-alive:** upload, 900 ms idle, upload, 900 ms idle, `thread-new` on one socket: 200, 200, 200.
- **The 1-hour request limit is live.** With no override, an upload dripping for 105 s got 200. In a scratch copy with `UPLOAD_REQUEST_MS` cut to 70 s, the same upload got 408 at 90 s. So that constant is what bounds a moving upload, and at 1 h it is past Node's default 5 minutes. I did not wait out a real 5-minute upload: the tool moves a command to the background at 180 s, and the brief forbids background work.
- A half-sent header leaves the dashboard up. `headersTimeout` (66 s) is unchanged by this PR.

**The fix diff, for new defects.** None found.
- The body timer is the gateway's, line for line. It is unref'd and cleared on the request's `close`.
- `POST /upload` clears it before its checks, but every refusal there closes the connection and the stall timer starts before the first read.
- `DEVTEAM_UPLOAD_BODY_MS` is read only under `boxFilesOff()` and can only lower the value.
- The new linked-folder fixtures (`<root>-away`) sit inside each test's own temp base, so its cleanup takes them.

**Attacks the fix diff could affect** were re-run above (laptop POST refusals before the body, the stall, a slow-loris). The rest of pass 1's list is covered by the PR's tests, which pass at the head, now with the linked-folder cases: GET through a linked folder is 404 on both servers, `--files` through one is 400 on answer, thread-say and thread-new, and neither sweep follows one. By reading at the head:
- The laptop routes still sit behind the Host check and relay refusal.
- The gateway routes are still inside the instance branch, after the session, Origin and `crossSiteOk` checks.
- HTML and SVG still go as `application/octet-stream` attachments with `nosniff` and `CSP: sandbox`.
- The laptop sweep still removes an empty folder only once it is older than `UPLOAD_STALL_MS`.

**The kit's rules.** The diff changes `cloud/gateway.mjs`, `docs/devteam/schema/log.schema.json` and `docs/devteam/scripts/devteam.mjs`, adds `test/attachments.test.mjs`, and adds the ticket's own records folder; nothing else. These are the ticket's four `touches`. The PR body has `## One-way doors` (None). The merge base is origin/main (be69e20d).

**Notes, not findings.**
- Two fixture folders, `/data/home/tmp/devteam-attach-dH0riX` (03:00) and `/data/home/tmp/devteam-attach-qUuSOc` (03:28), predate my session; I left them.
- After a stalled upload the client sees the reset a moment before the server removes the folder; it is gone about a second later.

Verdict: APPROVE 765d8e49d8f3a85e837b11e04d7505f677ac82f5
