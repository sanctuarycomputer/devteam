# Final review: kit-170 attachments server (pass 1a)

- Reviewer: kit-170 final reviewer 1a (fresh subagent of the supervisor, not the author; model claude-opus-5-5)
- Reviewed: db0cd68d65f8e9d22ab1b89573bef2a8a1c284a0

## Findings

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Important | done-when 2 and 3 ("a path that does not resolve, after .. and symbolic links, to a file inside that machine's uploads folder is refused"); spec §5 bullet 2 (`realpath(root/folder/name)` must lie inside `realpath(root)`), §6 (each path's `realpath`); quality.md §3 (Important: a missing test with a plausible failure path) | docs/devteam/scripts/devteam.mjs:14697 (attachedFiles `fs.realpathSync(f.path)`), :14724 (serveLaptopUpload realpath); cloud/gateway.mjs:1968 (serveUpload realpath); test/attachments.test.mjs:764 (B3 cases), :559 (unservedCases) | The realpath step is what refuses a symlink, and no test fails without it, at any of the three sites. Every symlink case in the tests is a link at the last component (`<folder>/link.txt`, `hosts.txt`, `x.txt` into `<root>-evil`). `lstat(...).isFile()` in droppedFileProblem and `O_NOFOLLOW` on open already refuse those, with or without realpath. A **folder** named as ours that is itself a link out (`<root>/<YYYY-MM-DD-24hex>` -> `/elsewhere`) is caught only by realpath. Mutations that survive the PR's tests: M10 (attachedFiles uses `path.resolve` in place of realpath), M31 (the gateway serve uses `path.join` in place of realpath), M32/M33 (the same on the laptop serve). My probe at the head: through a linked folder, the real code refuses the answer (400) and the GET (404). With M10 applied, the same answer is **accepted** (200, `answered q-…`), and the file it records lies outside the folder. A later "simplification" that removes realpath, on the grounds that lstat and O_NOFOLLOW already handle links, would pass CI and reopen the escape that this risk-high ticket exists to close. Fix: add a linked-folder case to B3 (both actions) and to `unservedCases` (both servers). | |
| F2 | Minor | done-when 1 ("passes in CI") | PR #316, test run 44005751166 at db0cd68 | CI at the exact head is red on two jobs: `kit (24, chrome 2/2)` (test/dashboard-threads-sidebar.test.mjs "opening threads" timed out) and `kit (24, chain)` (test/kit.test.mjs incidents: `merged` vs `verifying`). Neither test is in the diff. The code at db0cd68 is identical to a704a06 (the one commit after it adds only verification.md), and run 44004737734 at a704a06 was green on every job. The same sidebar test also failed on main at be69e20d (run 43990151346). So these look like flakes, but the head has no green run. Re-run the failed jobs before merging. | |
| F3 | Minor | spec §3 step 8 (the laptop route mirrors the gateway's limits and stall timer) | docs/devteam/scripts/devteam.mjs:16495 (cmdDashboard `http.createServer`) | The dashboard server keeps Node's default `requestTimeout` of 300 s. So a laptop upload that is still moving but takes over 5 min is cut off with no answer and no reason. That can happen with a 512 MB file over a slow link to a `--host` name. The gateway, by contrast, clears its body timer for an upload and allows REQUEST_MS (1 h). On 127.0.0.1 this almost never matters. | |

## What I checked

Read: the whole diff (`cloud/gateway.mjs`, `docs/devteam/scripts/devteam.mjs`, `docs/devteam/schema/log.schema.json`, `test/attachments.test.mjs`), the spec with its Rulings, verification.md, the PR body, the ticket's done-whens and notes (`ticket show`), and quality.md §3.

Tests: `test/attachments.test.mjs` at the head, under the shared lock with `--test-concurrency=2`, exit 0: 31 tests, 30 pass, 1 skipped. The skipped one is "the override is ignored without DEVTEAM_BOX=off", which can't run on a box. I didn't run `test/gateway.test.mjs` locally (not touched; brief scope). It is unchanged in the diff and passed in CI at a704a06, whose code is the same as the head's.

Mutations (each applied in the worktree, the matching tests run by name pattern, then restored with `git checkout`; the worktree was clean at the end):

- Caught (30):
  - **Gateway:**
    - M01: no POST /upload on an instance name. Caught by A1 and the step-8 test.
    - M02: the serve checks `startsWith(root/)` in place of an exact match. Caught by C4.
    - M03: no nosniff. Caught by C1.
    - M04: `.svg` served inline as `image/svg+xml`. Caught by C1.
    - M05: the serve route moved before the session check. Caught by C2.
  - **Laptop POST:**
    - M06: no Sec-Fetch-Site check. Caught by A5.
    - M07: no Origin check. Caught by A5.
    - M29: the whole body read before the checks. Caught by A5.
    - M23: no declared-size cap. Caught by A7.
    - M24: no streaming cap. Caught by A7.
    - M17: no group/other-write check on the root. Caught by A7.
    - M20: the folder made 0750. Caught by A4.
    - M21: no total check. Caught by A10.
  - **Laptop sweep:**
    - M11: an empty folder removed at once. Caught by A9.
    - M12: any `.part` folder removed. Caught by A9.
  - **Laptop GET:**
    - M08: no Sec-Fetch-Site check. Caught by C3.
    - M19: no CSP sandbox. Caught by C1.
    - M28: a link to another stored file is served. Caught by C4.
  - **Files on answers and turns:**
    - M09: containment by `startsWith` with no separator. Caught by B3.
    - M25: the answer action drops `files`. Caught by B1.
    - M26: the claimed bytes recorded, not the real size. Caught by B1.
    - M27: checkLine lets `files` onto a chat answer. Caught by the T5-1 test.
    - M30: the schema's turn `files` items take extra keys. Caught by B6.
    - M18: no line-size check in `thread new`. Caught by B7.
    - M15: `uploadsOnBox` ignores DEVTEAM_GATEWAY. Caught by A6 and B5.
  - **Pane:**
    - M13: the paste sent without `-p`. Caught by B8 and B9.
    - M14: the held record loses `paste`. Caught by B9.
  - **Rules copy:**
    - M16: the extension limit drifts from 17 to 18. Caught by A8.
- Survived:
  - M10, M31, M32 and M33: realpath removed (F1).
  - M22: the limit override no longer gated on `boxFilesOff`. Its test is skipped on a box, so this box can't show it; in CI, which isn't a box, that test would fail.

Attacks (a probe file in my scratch copy of the head, built on the PR's own fixtures, every server on a port above 40000):

- **A path outside the folder:**
  - Laptop GET: `%00`, `\`, `%5c`, `..\..\etc\passwd`, a trailing `/`, `%61.txt`, an upper-case folder name: all 404.
  - Gateway GET: `%00`, `\`, a trailing `/`: all 404.
  - The PR's C4 cases (`..`, `%2e%2e`, `%2F`, `.part`, three segments, an odd name) pass on both servers.
  - POST names `a\0b.png`, `..\..\evil.png`, `/etc/passwd`, `%2e%2e%2fx.txt` and `..` are stored inside a new folder of the root on both servers (`ab.png`, `evil.png`, `passwd`, `2e-2e-2fx.txt`, `file`).
  - B3 passes, including `../`, `/etc/hosts` and `<root>-evil`.
- **A symlink out:**
  - Made before an upload, at the file: 404 on both servers, refused on answers (PR tests).
  - Made before, as a folder named as ours: GET 404, answer 400, and the sweep didn't follow it (the outside folder, aged past keepMs, is still there) (my probe).
  - Made during an upload, with the `.part` swapped for a link to an outside file while the body was held: the open fd kept writing to the original, so the outside file was untouched. The rename stored the link itself, and that stored name then gets GET 404 and answer 400.
- **Box POST with no session, or with no Origin or a wrong one:**
  - No session: 401. A forged cookie: 401.
  - No Origin, a `term.` Origin, another instance's Origin or `evil.example`: 403, each with a reason.
  - With no session and no Origin at once: 403 ("only from this box's own pages").
- **Laptop cross-site POST and a wrong Host:**
  - A wrong Host: 403 (the existing text/plain refusal).
  - Origin `evil`, `null`, `https://` on our own host, or our own with a trailing `/`: all 403.
  - Origin localhost on Host 127.0.0.1: 403.
  - Sec-Fetch-Site cross-site, same-site, none, or missing: all 403.
  - Host `[::1]`: 403.
  - Every one of these answered within 2 s with 1 MB declared and never sent.
- **Cross-site GET of an uploaded file:**
  - Laptop: cross-site and same-site 403, and `none` is 403 as well (the done-when's literal rule). With no header at all: 200.
  - Gateway, a non-navigation request: same-site image 403, same-site fetch 403, cross-site image 403 (C2).
  - Gateway, a cross-site navigation: 200 as an attachment with CSP sandbox. This is by design under `crossSiteOk`, and the folder's 24 hex characters can't be guessed.
  - The box name, `public.` and `term.` don't serve the file.
- **HTML or SVG served back:** `application/octet-stream`, `content-disposition: attachment; filename="x.html"`, `nosniff`, `content-security-policy: sandbox` on both servers. `.jpeg` goes as an attachment.
- **Limits and sweep:**
  - A7, A9 and A10 pass and their mutations are caught.
  - An empty folder goes only after UPLOAD_STALL_MS (M11 caught), as the ruling `m-20261117-005812254` approved. A fresh `.part` is kept (M12 caught).
- **Two dashboards on one project:**
  - With a second dashboard started on the same project, an upload into B while A was receiving got 200, and A's folder survived B's sweep.
  - A then finished with 200, and a later upload through A kept every stored file.
  - B serves A's file.
- **Kit rules:**
  - The diff adds no file outside `test/` apart from the ticket's own records folder (`docs/devteam-dev/tickets/kit-170-attachments-server/`).
  - It touches exactly the ticket's four `touches`.
  - The PR body has `## One-way doors` (None).
  - The merge base is origin/main (be69e20d).

One stray fixture folder, `/data/home/tmp/devteam-attach-dH0riX` (03:00), was left in the system temp folder. It may be another reviewer's live fixture, so I didn't remove it.

Verdict: CHANGES db0cd68d65f8e9d22ab1b89573bef2a8a1c284a0
