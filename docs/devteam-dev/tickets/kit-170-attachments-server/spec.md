# kit-170-attachments-server: spec

Answers and thread turns carry dropped files. On a box the gateway takes them; on a laptop the dashboard server does. Both serve them back safely. Feature `dashboard-cleanup`, story DCL-S12. Owner thread `t-20261115-020154848-owner` (`m-20261115-024727416-supervisor`). Design: `project/designs/a-cleaner-more-consistent-dashboard.md`, Files in text boxes (lines 479–488, 591, 614–620). `risk: high` (P5: it changes which gateway names take uploads, and lets a laptop's dashboard write to the owner's disk). This ticket is the server side. `kit-171` draws the boxes, the pills and the posted files, and depends on this ticket.

## Why

Today the owner can drop a file only into a terminal pane. The gateway's `POST /upload?name=` takes it on the `term.` name alone, and the page pastes the stored path into the focused pane. The owner wants to drop files into any text box: an Inbox answer, a thread reply, a new thread. The supervisor should get them the way a pane drop delivers them, so images arrive as attachments and other files as a path.

## How it works today (what this changes)

- `cloud/gateway.mjs`: `safeUploadName`, the limits (`UPLOAD_MAX` 512 MB a file, `UPLOAD_TOTAL` 4 GB, `UPLOAD_FREE` 1 GB left on the disk, `UPLOAD_KEEP_MS` 7 days, `UPLOAD_STALL_MS` 60 s, `UPLOAD_NAME` 200, `UPLOAD_FOLDER` `YYYY-MM-DD-<24 hex>`), `receiveUpload` (streams into `<root>/<folder>/.part`, then renames it to the safe name) and `sweepUploads`. It answers `POST /upload` only when the Host is `term.<box>`, after the session check and the top-level rule that a non-GET's Origin is the name's own. No route reads a file back.
- `devteam.mjs` dashboard (`cmdDashboard`): every route first checks that the Host is its own (`127.0.0.1:<port>`, `localhost:<port>`, `<host>:<port>`) and refuses a preview relay's requests. Owner POSTs are `/api/<action>`. The `answer`, `thread-new` and `thread-say` actions build argv for the `answer`, `thread new` and `thread say` commands. Those commands write the `question` set line and the `turn` line, then call `nudgeSupervisor` / `deliverOwnerTurn`, which type one line into the supervisor's pane (`typeInto`, `typeNow` = `tmux send-keys -l` + Enter; held in `run/held/` while the pane asks something).
- The terminal page's drop pastes `dropPaste(paths)` with `term.paste` (a bracketed paste when the program asked for one), then types a space if any path is not an image (`dropSpace`). Claude Code turns a pasted image path into an attachment.

## Approach

**1. The rules, copied and held equal.** The kit imports only Node's modules, so `devteam.mjs` gets its own copy, in a marker block `/* upload rules start */ … /* upload rules end */`. The block holds the same constants under the same names, plus `safeUploadName`, `shellQuote`, `dropPaste`, `isDropImage` and `dropSpace`, each with the gateway's exact code. The gateway gains one export, `UPLOAD_RULES = { max, total, free, keepMs, stallMs, name, part, folder }`, built from its constants. The block in `devteam.mjs` ends by defining the same object. The test cuts the block out of `devteam.mjs`, runs it in `vm`, and compares it with the gateway's exports: every constant, the folder pattern's source, and the output of each function on one shared list of hostile names.

**2. Where a machine's dropped files live** (`uploadsRoot()` in `devteam.mjs`):
- **A box**: `onBox()`, or `DEVTEAM_GATEWAY` set to anything non-empty. `DEVTEAM_UPLOADS_DIR ?? '/data/uploads'`, as the gateway reads it. The gateway writes it; the dashboard only reads.
- **A laptop**: `~/.devteam/uploads/<project>/`. `<project>` is the main checkout's real path, reduced to a safe folder name: the basename's letters, digits and `-` (at most 40), then `-`, then the first 8 hex of the path's sha256. Two checkouts that share a name never share a folder. *(My call: the design says only `<project>`, and `settings.project` is free text.)*

**3. The laptop's upload route.** `POST /upload?name=` on the dashboard server. It comes before every other route except the existing Host check and the relay refusal. In this order, each check refusing before a byte of the body is read (the response is sent with `connection: close`, so the unread body goes with the socket):
1. On a box (`uploadsOnBox()`, as in 2) the route is off: `404 {error: "on a box the gateway takes dropped files"}`.
2. The Host is its own. The existing first check already does this; the route adds nothing.
3. `Origin` is exactly `http://<Host>`, and `Sec-Fetch-Site` is exactly `same-origin`. Either one missing or different: `403 {error: "dropped files only from this dashboard's own page"}`.
4. Content-Length, when it is declared, is at most `UPLOAD_MAX`: else `413`.
5. The folder: `~/.devteam` and `~/.devteam/uploads` are created if missing (mode 0700), then `<project>` (mode 0700). Then it is checked as the gateway checks its root: `lstat` shows a directory (not a symlink) owned by this user, with no group or other write. If not: `503 {error: "this machine has no folder for dropped files: <why>"}`.
6. A sweep: every folder in the root that is named as ours (`UPLOAD_FOLDER`), is owned by this user, is not being received now, and has an mtime older than `UPLOAD_KEEP_MS` is removed. So is any folder of ours with no file, or holding a `.part` whose mtime is older than `UPLOAD_STALL_MS` (a cut-off upload). A fresh `.part` is left alone, even when this process isn't receiving into it: another dashboard for the same project (one started from a worktree maps to the same folder) may be (spec-1 S7). The gateway removes a `.part` folder on its first scan; that is the one deliberate difference, since only one gateway writes its root. The scan is redone on every upload: no in-memory list, so a restart forgets nothing.
7. Kept bytes + bytes being received + this one's (declared or `UPLOAD_MAX`) over `UPLOAD_TOTAL`: `507`, with the gateway's wording ("this machine already holds …"). Free disk (`statfs`) less pending less this one under `UPLOAD_FREE`: `507`.
8. Received into a new folder `YYYY-MM-DD-<24 hex>` (mode 0700). The body streams to `.part` (`wx`, mode 0600), with the per-file cap enforced while it streams (`413`, and the socket is closed) and the stall timer (no chunk for `UPLOAD_STALL_MS`: the request is destroyed), then is renamed to `safeUploadName(name)`. Answer: `200 {path, size}`. Any failure removes the folder. A disk-full error is `507`; anything else is `500 {error: "this machine could not store this file"}`.

The modes are tighter than the gateway's (0700/0600, against 0750/0640): on a laptop no other group needs to read them.

**A test-only override of the limits (spec-1 S5).** The dashboard reads `DEVTEAM_UPLOAD_MAX`, `DEVTEAM_UPLOAD_TOTAL`, `DEVTEAM_UPLOAD_FREE` and `DEVTEAM_UPLOAD_STALL_MS` (positive integers) only while `boxFilesOff()` holds: `DEVTEAM_BOX=off` on a HOME that isn't the account's own, which is how the kit's tests already run. Anywhere else they are ignored, and the constants hold. This mirrors the gateway's `opts.uploadMax` and friends, which its tests use, so the streaming cap and the stall can be tested without sending 512 MB or waiting a minute.

**4. The box's upload route.** In the gateway, inside the instance-name branch (`if (port)`), before the artifact redirect and the proxy:
- `POST /upload` (raw path, exact): `receiveUpload(req, res, name)`, the existing function with its body timer cleared, as on `term.`. It already runs after the session check and after the top-level Origin rule (`Origin` must be that instance's own origin), so an upload with no session gets 401, and one with no Origin or another Origin gets 403. It stores under the same root (`/data/uploads`). Its refusal words keep "this box …".
- Nothing else changes for `term.`. The box's own name and `public.` still take no upload.
- **What this leaves undefended (P6, spec-1 S6).** A page an agent serves on an instance's name already runs with the owner's cookie and its own Origin, so it can already post the dashboard's actions. Now it can also store files there, up to the 4 GB total, and so make the owner's own drops get 507 until the sweep. That is no new authority (a file adds none, R1). Agents are trusted not to forge (P6), and the gateway tests already name that page as the threat for `term.`.

**5. Serving a file back: `GET /upload/<folder>/<name>`** (HEAD too). One rule, coded twice (`serveUpload` in each file, ~20 lines, kept in step by the same test cases run against both servers):
- It is matched on the raw path, before URL parsing folds `..` or `%2e`. Exactly two segments. `<folder>` matches `UPLOAD_FOLDER`. `<name>` is not `.part` and equals `safeUploadName(<name>)`, so an encoded slash, `..` or any character a stored name can't have is a 404.
- `realpath(root/folder/name)` must lie inside `realpath(root)` and be a regular file; else 404. A symlink inside a folder that points out is a 404.
- Headers on every 200: `content-type` is `image/png`, `image/jpeg` (`.jpg` only: a `.jpeg` goes as an attachment, keeping to the done-when's list; spec-1 S3), `image/gif` or `image/webp` by extension. Any other file, HTML and SVG included, is `application/octet-stream` with `content-disposition: attachment; filename="<name>"`. Also `x-content-type-options: nosniff`, `content-security-policy: sandbox`, `cache-control: no-store`, `referrer-policy: no-referrer`.
- **Box**: on an instance's name only, after the session check. With no session, a navigation is redirected to sign-in and anything else gets 401, as every instance route does. The existing `crossSiteOk` refuses a cross-site read that is not a navigation.
- **Laptop**: off on a box (404). The Host check (existing). `Sec-Fetch-Site` present and not `same-origin`: `403`. A same-origin GET carries no Origin and is served; so is one with no `Sec-Fetch-Site` (curl, the owner's own tools), as `/api/threads` does.

**6. What an answer or a turn carries.** `files: [{ name, path, bytes }]`, 1 to 10 of them.
- **The dashboard's actions** `answer`, `thread-new` and `thread-say` accept an optional `files` array (at most 10) and pass it on as `--files=<json>`. For the thread actions it goes before the `--` that starts the owner's words. The action checks only the array's shape; the command checks everything.
- **The commands** `answer <qid> "<words>" --files <json>`, `thread new … --files <json>` and `thread say <id> --files <json> -- …` call `attachedFiles(json)`. It returns the files or dies with the reason, before any line is written:
  - The JSON is an array of 1 to 10 objects, each with exactly `name`, `path` and `bytes`. `name` is a string of 1 to 200 characters with no control characters. `path` is a string of at most 1024 bytes. `bytes` is a non-negative integer.
  - Every path must be absolute (`refused: <path> is not an absolute path`).
  - Each path's `realpath` must be exactly `realpath(uploadsRoot())/<folder>/<n>`, a regular file, where `<folder>` matches `UPLOAD_FOLDER`, `n === safeUploadName(n)` and `n` is not `.part`: the same shape the GET route serves, so every recorded file can be served back (spec-1 S4). `..`, an absolute path elsewhere, a symlink out of the folder, a file at the root's top, a nested file, an upload still in `.part` and an odd name all fail here: `refused: <path> is not a dropped file in this machine's folder (<root>)`. A missing root: `refused: this machine has no dropped-files folder (<root>)`.
  - What is recorded: `name` as given, `path` as its real path, and `bytes` as the file's real size (not the size the page claimed).
  - **Not** for `--defaulted`, `--review-result`, `--decline`, `--from-chat` or `--from-turn` (dies: "--files go with the owner's own answer").
- **The log**: the `question` set line (the answer) and the `turn` line gain `files`. `thread new` puts them on the first turn. `log.schema.json` adds `files` to both types: an array of 1 to 10 objects `{name, path, bytes}`, `additionalProperties: false`, with a `description` and an `x-tip`. On `question` it is listed in `x-set-only`, so a question's `new` line (the supervisor's ask) can't carry files (spec-1 S8a).
- **Line size**: a log line is at most `LINE_MAX` (4096) bytes. Before writing anything, each command builds every line it will write as `appendLog` will, with a placeholder id of the real shape (`u-00000000-000000000-owner`, as `thread say` already does for `--refs`). If files push one over, it dies: "That is too long with its files; shorten it or attach fewer." For `thread new` that means both the thread line and its first turn (with a placeholder thread id) are checked before the thread line is written, so a refused turn never leaves a thread with no turn. For `answer` it means the question set line is checked before it is written (spec-1 S2).

**7. The supervisor gets the files as a pane drop does.** `typeNow(target, line, paste)` gains an optional `paste`, a list of paths:
1. It types `line` and a space (`send-keys -l`).
2. It pastes `dropPaste(paths)` as a bracketed paste: `tmux load-buffer -b <unique name> -`, with the text on stdin, then `paste-buffer -p -d -b <name> -t <target>`. tmux wraps the paste in `ESC[200~ … ESC[201~` when the program asked for that, as `term.paste` does in a pane drop.
3. If `dropSpace(paths)` holds (any path is not an image), it types a space.
4. Then Enter.

`recordSent` still records only `line`: the lost-Enter rescue matches the tail of the typed text, and Claude Code shows a pasted image path as `[Image #n]`, so a tail taken from the paths would never match (spec-1 S8b). `typeInto`, the held-line record (`run/held/…json` gains `paste`), `flushHeld`, `nudgeSupervisor`/`typeNudge` (and its queue) and `deliverOwnerTurn` pass `paste` along. The `answer` nudge and the owner-turn line get the files' recorded paths. The words before them say how many: `… (2 files dropped)`. A line with no files is typed exactly as today: no space, no paste.

## Acceptance checks

All are in `test/attachments.test.mjs` (new), run with `node --test test/attachments.test.mjs`. CI's test job runs it with the suite. Each check says what turns it red.

**Done-when 1: the upload routes and the shared rules.**

| # | Check | Red when |
|---|---|---|
| A1 | Box: a gateway (`createGateway`, a temp root, signed in with a software passkey) takes `POST /upload?name=Shot 1.PNG` with Host and Origin set to an instance's name (`<P>.box…`) and the session: 200, `path` under the root, `<folder>/Shot-1.png`, the bytes intact. | the instance branch doesn't route `/upload` (it would proxy to a dead port: 502) |
| A2 | Box, the same request with no cookie: 401. With no Origin: 403. With Origin `term.` or another instance's origin: 403. With Origin `https://evil.example`: 403. Each response has a non-empty body, the reason (these are the gateway's existing text/plain refusals: see Contracts). After each, the root holds no new folder. | the route is reached before the session or Origin checks, or a refusal has no reason |
| A3 | Box: `POST /upload` on the box's own name and on `public.` still takes nothing (not 200); `term.` still takes one (200). | the route is widened past instance names |
| A4 | Laptop: a real dashboard (`dashboardOnFreePort`, a throwaway HOME, `DEVTEAM_BOX=off`) takes `POST /upload?name=../../a b.txt` with Host `127.0.0.1:<port>`, Origin `http://127.0.0.1:<port>` and `Sec-Fetch-Site: same-origin`: 200, `path` = `~/.devteam/uploads/<project>/<folder>/a-b.txt`, the bytes intact. The root and the folder have mode 0700, the file 0600. Also with Host `localhost:<port>` and its own Origin: 200. | the route is missing, stores elsewhere, or the modes are looser |
| A5 | Laptop refusals, each with the body declared (Content-Length 1 MB) but never sent, and the response read within 2 s (a server that read the body would hang): Host `evil.example:<port>`: 403; Origin `http://evil.example`: 403; no Origin: 403; `Sec-Fetch-Site: cross-site`: 403; `same-site`: 403; none: 403; Origin `http://localhost:<port>` with Host `127.0.0.1:<port>`: 403. Each has a non-empty reason body: the route's own refusals are `{error}`, and the Host refusal is the dashboard's existing text/plain one. After all of them, the project's folder has no upload folder in it. | any check is missing, a refusal has no reason, or the check runs after reading the body |
| A6 | Laptop with `DEVTEAM_GATEWAY=1` (and `DEVTEAM_UPLOADS_DIR` set to a temp folder): a POST that passes every other check gets 404 with the box reason, and neither folder gets anything. | the route stays on with DEVTEAM_GATEWAY set |
| A7 | Laptop refusals return their reason as `{error}`: a declared size over `UPLOAD_MAX` gets 413 (via a dashboard started with no override: the request declares `UPLOAD_MAX + 1` and sends nothing); a project folder replaced by a symlink to elsewhere, or made mode 0777, gets 503 with "no folder"; the error names the reason. Streaming (a dashboard started with the test-only `DEVTEAM_UPLOAD_MAX=1024` and `DEVTEAM_UPLOAD_STALL_MS=300`): a chunked body (no Content-Length) of 800 + 800 bytes gets 413 and leaves no folder; one exactly 1024 bytes gets 200; a body that sends 10 bytes and then stalls has its connection closed within 3 s and leaves no folder. And without `DEVTEAM_BOX=off` (HOME still throwaway) the same `DEVTEAM_UPLOAD_MAX=1024` is ignored: a 2 KB upload gets 200. | the folder check, the declared or streaming cap, the stall timer is missing, or the override leaks outside tests |
| A8 | Rules: the `/* upload rules start */ … end */` block is cut from `devteam.mjs` and run in `vm`. Its `UPLOAD_RULES` deep-equals the gateway's (the folder pattern compared by `source` and `flags`). For each of ~30 shared names (the gateway test's hostile cases, Unicode, long names, many dots, empty, `.part`), `safeUploadName` is equal in both. `dropPaste`, `isDropImage` and `dropSpace` are equal on mixed path lists. | the copy drifts in any constant or any function's output |
| A9 | Sweep matches: on a laptop, a folder of ours with its mtime set back `UPLOAD_KEEP_MS + 1 min`, and a folder of ours holding only a `.part` set back `UPLOAD_STALL_MS + 1 s` (and an empty folder of ours) are gone after the next upload. A folder made 1 min ago is kept, so is a folder holding a fresh `.part`, and so is a folder not named as ours. The same old and young folders on the gateway (`uploadKeepMs` default) are swept and kept the same way. | the dashboard's sweep differs in age, removes a fresh `.part` (another dashboard's upload), keeps a stale one, or touches what isn't ours |
| A10 | Total: a laptop root seeded with a folder of ours whose file's apparent size is `UPLOAD_TOTAL` (a sparse file: `truncate`, no disk used) refuses the next upload with 507 and a reason. | the total limit is missing |

**Done-when 2: files on answers and turns.**

| # | Check | Red when |
|---|---|---|
| B1 | Laptop, through the dashboard's own routes: upload two files (a `.png` and a `.pdf`), then `POST /api/answer {id, answer, files}` with their `{name, path, bytes}`. 200. The question's answer line in the log has `files` with both, each `path` real and `bytes` the real size (the page said 1 byte; the log says the real size). | the action or the command drops `files` |
| B2 | Likewise `POST /api/thread-new {title, text, files}` (the files are on the first turn) and `POST /api/thread-say {id, text, files}`. Each turn line has `files`. | either thread action drops `files` |
| B3 | Refused, naming the path, with nothing written (the log's line count is unchanged): `<root>/<folder>/../../../etc/passwd`; an absolute path outside (`/etc/hosts`); a symlink placed inside a folder of the root pointing at a file outside; a relative path; a folder inside the root (not a file); a path that doesn't exist; a file at the root's top level; a file nested two folders down; a `<folder>/.part`; a file in a folder of ours whose name `safeUploadName` would change (`A B.txt`, put there by hand); a folder not named as ours. Each through `/api/answer` and through `/api/thread-say`; the 400's `error` contains the path. | `realpath` or the containment check is missing or wrong (a `startsWith` without the separator would pass `<root>-evil/…`: that case is included) |
| B4 | Shape refusals: 11 files; an extra key; a `name` with a newline; `bytes` −1 or 1.5; `files` not an array. Each is 400 and nothing is written. | the shape check is missing |
| B5 | Box: a dashboard with `DEVTEAM_GATEWAY=1` and `DEVTEAM_UPLOADS_DIR=<the gateway's root>` takes an answer whose file the gateway stored (A1's) and refuses one under `~/.devteam/uploads/` (not this machine's folder on a box). | `uploadsRoot()` ignores the box |
| B6 | `log.schema.json`: every write goes through `checkLine` (the schema check `appendLog` and `validate` share), so B1 and B2 writing at all shows the schema takes `files`. And a turn line appended by hand with `files: [{name, path, bytes, extra: 1}]` makes `devteam.mjs validate` fail, naming `files`; so does one with 11 files. | the schema lacks `files` (B1/B2 fail to write), or is too loose (validate passes) |
| B7 | Too long: words of 1900 bytes with 10 files of 200-character names are refused with "too long with its files" through `thread say`, `thread new` and `answer`, and nothing is written: the log's line count is unchanged, `thread new` leaves no new thread (the open-thread count is unchanged), and the question is still open. | the line-size check is missing (appendLog would refuse with a bare error), or `thread new` checks after writing the thread line |
| B8 | Pane delivery: a stand-in supervisor in a test tmux session turns on bracketed paste (`ESC[?2004h`) and records every byte it gets. After a `thread say` with a `.png` and a `.pdf`, its bytes are: the usual `[devteam thread … from owner] …` line, a space, `ESC[200~<png path> <pdf path>ESC[201~`, a space (a non-image is there), then Enter. With only the `.png`: no space after the paste. For an `answer` with files: its nudge line, then the same paste. A turn with no files: the bytes are exactly today's line and Enter. | `typeNow` drops the paste, types the paths unbracketed, or changes lines with no files |
| B9 | Held: while the stand-in shows a numbered menu, a turn with files is held. After the menu is answered and the input box is back, `flushHeld` types the line with its paste, as in B8. | the held record loses `paste` |

**Done-when 3: serving back.**

| # | Check | Red when |
|---|---|---|
| C1 | Both servers (each case run against the gateway on an instance name with the session, and against a laptop dashboard with a same-origin GET with no Origin): files stored as `a.png`, `a.jpg`, `a.gif`, `a.webp` are served with their image type; `a.html`, `a.svg`, `a.pdf`, `a.txt` and `a.jpeg` are `application/octet-stream` with `content-disposition: attachment`. All 200s carry `x-content-type-options: nosniff` and `content-security-policy: sandbox`; the bytes are the file's. | a type rule or a header is missing on either server |
| C2 | Box: the same GET with no cookie gets 401 (and 302 to sign-in for a navigation). Cross-site, not a navigation (`Sec-Fetch-Site: cross-site`, `Sec-Fetch-Dest: image`): 403. | the route is before the session check |
| C3 | Laptop: `Sec-Fetch-Site: cross-site` and `same-site`: 403. No `Sec-Fetch-Site` and no Origin: 200. Host `evil.example:<port>`: 403. With `DEVTEAM_GATEWAY=1`: 404. | any guard is missing, or the same-origin GET is refused |
| C4 | Paths that never serve (404 on both): `/upload/../x`, `/upload/%2e%2e/%2e%2e/etc/passwd`, a folder name not matching `UPLOAD_FOLDER`, a name with `%2F`, `.part`, three segments, a name that `safeUploadName` would change (`A B.png`), and a symlink placed in a folder pointing at a file outside the root. | the raw-path, name or realpath checks are missing |
| C5 | `test/gateway.test.mjs` passes unchanged (run by itself in verification, and in CI). | an existing gateway behaviour changed |

## Contracts

- **Provided** (to `kit-171`, which depends on this ticket; per the design, defined by this ticket's tests, with no separate contract file): `POST /upload?name=` → `200 {path, size}` | a 4xx/5xx whose body is the reason: `{error}` JSON from the upload route itself, and plain text from the checks in front of it (on a box the gateway's session 401 and Origin 403; on a laptop the dashboard's Host and relay 403). So a page shows `error` when the body is JSON and the text otherwise (spec-1 S1). It answers on the dashboard's own origin on both kinds of machine (through the gateway on a box). `GET /upload/<folder>/<name>`, where `<folder>/<name>` is the last two segments of `path`. The actions' optional `files: [{name, path, bytes}]`. The log's `files` on question set and turn lines.
- **Consumed**: the gateway's existing session, Origin rule and `crossSiteOk`. The dashboard's Host check. `appendLog`'s `LINE_MAX`. tmux's `load-buffer`/`paste-buffer -p`.

## Edge cases

- **Two uploads at once (laptop)**: each has its own random folder. A total counts what is being received, held in memory for the process while it receives. The sweep never removes a folder being received.
- **A dashboard restarted mid-upload** leaves a `.part`; the next upload's sweep removes it. A `.part` folder is only removed when this process isn't receiving into it.
- **Empty file**: stored (size 0), as the gateway does.
- **The same file in two answers**: allowed. The sweep may remove it after 7 days; the log keeps only name, path and size, so an old answer's link then answers 404. That is what the design's cache tier says.
- **A path recorded on another machine** (a log synced from a box to a laptop): nothing re-checks it; the GET answers 404 there.
- **Nothing reads `files` for authority.** A file adds no authority (R1): the answer or turn is the owner's, as before, through the same channel.
- **The supervisor's pane is busy**: held as today, with the paste.

## Out of scope

- The UI: the drop highlight, the pills, files shown in turns (`kit-171`).
- The hub's operator threads (`/operator/thread-*`) and `thread reopen` with words: not named by the done-whens.
- A turn with files and no words: words are still required (`turnText`).
- Setting `DEVTEAM_GATEWAY` in the image: `cloud/Dockerfile` is not in `touches`, and `onBox()` already says box there. The variable is honoured for a test of a box and any future boot that sets it.

## One-way doors

None. The ticket lists none; every change is additive, and a removed route or field rolls back with the PR.

## Rulings

- `m-20261117-003346949-supervisor`: approve-spec at `792afd99`.
- `m-20261117-004552350-supervisor`: approve-plan at `ec29814c`, confirming two notes. B6 runs `log-check` (not `validate`, which doesn't check log lines). The laptop route keeps the dashboard's existing Host check, which also accepts the owner's own `--host` name.
- `m-20261117-005812254-supervisor` (changes §3 step 6; from task review T2-3): the laptop sweep removes an empty upload folder of ours only once its mtime is older than `UPLOAD_STALL_MS`, as it does a `.part`. Otherwise one dashboard's sweep could delete the folder another dashboard for the same project has just made for an upload, against the Edge case "the sweep never removes a folder being received". A9 keeps a fresh empty folder. The gateway is unchanged.
- Task reviews T5-2 and T6-2 (worker's call, within §6's intent): a recorded file `name` is also refused when it fails the kit's `UNSAFE_TEXT` rule (bidi controls, line breaks, LRM/RLM), the rule thread titles use, not only for control characters. The stored name on disk was already reduced to `[A-Za-z0-9._-]`.
- Task review T6-1, a known limit, not a change: the lost-Enter rescue looks at the last 8 lines above the input. Many long non-image paths pasted into a narrow pane can push the line's end out of that window. The rescue then gives up quietly, as it does today for any long line. One to three files in a normal pane are inside it.

## Review history

- spec-1 (CHANGES at bf0aac9): S1 to S8, each folded in where cited above.
