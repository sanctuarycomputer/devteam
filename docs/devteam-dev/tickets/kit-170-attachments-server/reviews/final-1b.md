# Final review: kit-170 attachments server (pass 1b)

- Reviewer: kit-170 final reviewer 1b (fresh subagent of the supervisor, not the author; model claude-fable-5-2)
- Reviewed: db0cd68d65f8e9d22ab1b89573bef2a8a1c284a0

## Findings

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Important | done-when 2 ("after .. and symbolic links ... a symlink out of the folder"); spec B3 "Red when: `realpath` or the containment check is missing" | test/attachments.test.mjs:764 (B3); docs/devteam/scripts/devteam.mjs `attachedFiles` (`real = fs.realpathSync(f.path)`) | No test fails when `attachedFiles` stops resolving symbolic links. With `fs.realpathSync(f.path)` replaced by `path.resolve(f.path)` the whole file still passes (exit 0), and my probe then gets 200 and a written turn for `<root>/<a folder named as ours that is a link to a directory outside the root>/x.txt`. B3's one symlink case is a link as the last segment, which `lstat().isFile()` in `droppedFileProblem` refuses with or without `realpath`. The code at the head is right (the same probe gets 400 there); the missing case is a linked folder (or any linked parent) pointing out of the root, through `/api/answer` and `/api/thread-say`. | |
| F2 | Minor | spec §6 "What is recorded: ... `path` as its real path"; B1 "each `path` real" | test/attachments.test.mjs:722 (B1, B2) | Recording `f.path` as given instead of the real path passes every test: each accepted case gives a path that is already its real path. An accepted case through a link (a folder of ours linked to another of ours is accepted today and records the real path) would hold it. | |
| F3 | Minor | spec §7 (`nudgeSupervisor` and its queue pass `paste` along) | docs/devteam/scripts/devteam.mjs `nudgeSupervisor` (`queuedNudges.push({ line, paste })`); test B8 | Dropping `paste` from the queued nudge (the path an answer takes when the dashboard runs it, DEVTEAM_REPLY_FD) passes every test: B8 answers from the command line only. The code is right by reading. | |
| F4 | Minor | spec §6 "On `question` it is listed in `x-set-only`" (spec-1 S8a) | docs/devteam/schema/log.schema.json (question `x-set-only`); test T5-1 / B6 | Taking `files` out of the question's `x-set-only` passes every test: nothing writes a question's `new` line with `files` and expects `log-check` to refuse it. | |
| F5 | Minor | spec §3 step 3; ruling m-20261117-004552350 (the Host check also accepts the owner's `--host` name) | docs/devteam/scripts/devteam.mjs `receiveLaptopUpload` (`sec-fetch-site !== 'same-origin'`) | A browser sends Sec-Fetch-Site only to a trustworthy origin (https, localhost, 127.0.0.1). A dashboard opened on a `--host` name over plain http passes the Host check but its page's upload carries no Sec-Fetch-Site, so it is always 403. It fails closed, and the done-when asks for the header; the spec or the refusal's words could say so for kit-171. | |

## What I checked

Read the whole diff outside the ticket's records (cloud/gateway.mjs, docs/devteam/scripts/devteam.mjs, docs/devteam/schema/log.schema.json, test/attachments.test.mjs), the spec with its Rulings, verification.md, and the ticket's done-when and notes.

**Runs** (Node 22 on the shared box, under the shared lock, judged by exit code):
- `test/attachments.test.mjs` at the head: exit 0, 30 pass, 1 skipped ("the override is ignored without DEVTEAM_BOX=off", which can't run on a box; CI runs it).
- `test/gateway.test.mjs` was not run here (the brief limits runs to files the PR touches). It is not in the diff, and CI on PR #316 at this head shows all 18 checks passing.

**Mutations** (78, each applied to the worktree, the matching tests of `test/attachments.test.mjs` run, the file restored with `git checkout`; the worktree is clean at the head afterwards). 71 caught, 7 survived.

Caught, gateway: serve without the real-path equality; without the name rule; without the folder-name rule; without the regular-file check; `.svg` served as an image; no `nosniff`; no `CSP: sandbox`; no `Content-Disposition`; GET served before the session check; POST taken before the session check; the Origin rule waived for `/upload`; the instance POST route removed; the `req.socket` change in `receiveUpload` reverted; a constant in `UPLOAD_RULES` changed.

Caught, laptop upload: no Origin check; no Sec-Fetch-Site check; Sec-Fetch-Site loosened to same-site or missing; the box switch removed (POST and GET); folder mode 0755; file mode 0644; root made 0755; the group/other-write check removed; an empty folder kept for 7 days; a fresh empty folder removed; a stale `.part` kept; a fresh `.part` removed; the sweep touching folders not named as ours; no total check; no streaming cap; no stall timer; no declared-size cap; an override raising a limit; the project hash dropped from the folder name; the after-body failure answered with nothing; `UPLOAD_NAME` and `safeUploadName` changed in the kit's copy.

Caught, laptop serve: refusing only cross-site (same-site let through); refusing a missing Sec-Fetch-Site; the real-path equality removed; the whole containment line removed; no `nosniff`; no `CSP: sandbox`; `.html` served as text/html.

Caught, files on answers and turns: containment as a `startsWith` without the separator; the claimed size recorded instead of the real one; each of the three too-long checks removed; the action's shape check loosened; `--files` with `--decline`/`--from-chat` allowed; `files` on a chat or thread answer, on a supervisor's turn, on `thread reply`, on `thread reopen`; the `UNSAFE_TEXT` name rule; the exact-keys rule; the `bytes` rule; the absolute-path rule; the stored-name rule; the folder-name rule; `uploadsRoot()` ignoring the box; schema `additionalProperties`, `maxItems`, and `files` removed from the owner's authority list.

Caught, the pane: `paste-buffer` without `-p`; no space after a non-image; the held record without `paste`; the "(n files dropped)" words; the space before the paste; the answer's nudge without its paths.

Survived:
- `realpathSync` → `path.resolve` in `attachedFiles`: F1.
- recording the given path, not the real one: F2.
- the queued nudge losing `paste`: F3.
- `files` out of the question's `x-set-only`: F4.
- the symlink and not-a-folder lines of `uploadRootOk`: redundant on Linux (a link's mode is 0777, so the write check refuses it with the same 503).
- the `\p{Cc}` name check: redundant (`UNSAFE_TEXT` covers every control character).
- the raw-path checks in `serveLaptopUpload`: redundant (`droppedFileProblem` repeats them on the real path).

**Attacks** (the PR's tests, plus a probe of my own: the test file's fixtures copied to my scratch dir with extra cases, run against a real dashboard and a real gateway on 127.0.0.1).

- A path outside the folder. Upload names `..\..\evil.html<NUL>.png`, `/etc/passwd`, `..`, `%2e%2e%2f%2e%2e%2fx`, `a/../../b.svg`, a bidi-override name and an empty name are each stored as `<root>/<folder>/<[A-Za-z0-9._-]+>` on both servers. GET of `/upload/../x`, `%2e%2e`, `%2F`, `%00`, a backslash, a trailing slash, `;x`, three segments, `.part`, a folder not named as ours: 404 on both (C4 and the probe). `--files` with `../`, `/etc/hosts`, a relative path, a NUL in the path, `<root>-evil/…`, a file at the root's top, a nested file, `.part`, an odd name: 400, naming the path, nothing written.
- A symlink out. GET through a link in a folder, through a folder that is a link out of the root, and through a folder linked to another folder of ours: 404 on both servers. `--files` through a leaf link and through a linked folder: 400 at the head (but see F1 for the test). During an upload: the folder is a fresh random name made with `mkdir`, the `.part` is opened `wx`, and the final `rename` replaces a link rather than following it; the laptop root is refused (503) when it is a link or writable by others. One note: with the laptop root replaced by a link, GET and `--files` follow it (the spec says `realpath(uploadsRoot())`), while POST refuses; only the user themself can make that link.
- A box upload with no session: 401. No Origin, `Origin: null`, `https://evil.example`, `term.`'s origin, the box's own origin: 403. Nothing stored. The box's own name, `term.` and `public.` don't serve a stored file (404).
- Laptop cross-site POST: an evil Origin, no Origin, `Origin: null`, https, a trailing slash, upper case, `localhost` against `127.0.0.1`, Sec-Fetch-Site `cross-site`, `same-site`, `none` or missing: 403, each before the body is read (A5 holds the body back and gets the answer). Host `evil.example:<port>`: 403. `/upload/`, `/upload/x`, `//upload`, `/Upload`: not taken. A second dashboard's origin posting to the first: 403.
- Cross-site GET. Laptop: Sec-Fetch-Site `cross-site`, `same-site` (and `none`): 403; none at all: 200; wrong Host: 403. Box: no cookie 401 (a navigation goes to sign-in); a cross-site or same-site image, script or CORS fetch: 403 with no CORS header. A cross-site navigation with the owner's session is served, as every non-`/api/` path there is: HTML as a download, an image inline with `nosniff` and `CSP: sandbox`; the other site can't read either, and the folder name is 96 random bits.
- HTML and SVG served back: `application/octet-stream`, `Content-Disposition: attachment; filename="<stored name>"`, `nosniff`, `CSP: sandbox`, `no-store`, `no-referrer`, on both servers; `.jpeg` too. Only `.png .jpg .gif .webp` are inline. The filename can hold only `[A-Za-z0-9._-]`.
- Size limits, the sweep, two dashboards. The declared and streaming caps, the stall timer, the total and the test-only override hold under mutation (above). The sweep removes an empty folder of ours only once older than `UPLOAD_STALL_MS`, as ruled, and keeps a fresh `.part`. Two real dashboards on one project and one HOME: a slow upload on the first (4 chunks, 400 ms apart) survives an upload and its sweep on the second, both land in the same project folder, and each serves the other's file.

**The kit's rules.** The diff touches only the four files in the ticket's `touches` plus the ticket's own records folder; the one new file outside it is `test/attachments.test.mjs`. The PR body has `## One-way doors` (None). `appendLog`'s refactor into `logLineFor` keeps the line and its checks as they were.

**Notes, not findings.** A recorded file `name` may hold HTML characters (`<img …>` is accepted); kit-171 must escape it. A re-answered question's merged view may still show an earlier answer's `files`; kit-171 should read them from the answer line. A laptop GET with `Sec-Fetch-Site: none` (the URL pasted into the address bar) is 403, as the done-when says.

Verdict: CHANGES db0cd68d65f8e9d22ab1b89573bef2a8a1c284a0
