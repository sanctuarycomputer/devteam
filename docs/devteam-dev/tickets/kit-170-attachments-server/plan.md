# kit-170-attachments-server: plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

## TL;DR

- **What changes:** dropped files reach answers and thread turns. The laptop dashboard (`docs/devteam/scripts/devteam.mjs`) gains `POST /upload` and `GET /upload/<folder>/<name>`. The gateway (`cloud/gateway.mjs`) gains the same two routes on an instance's name. `answer`, `thread new` and `thread say` (and their dashboard actions) take `--files`, checked against this machine's uploads folder and logged (`docs/devteam/schema/log.schema.json`). The supervisor's pane gets the files' paths as a bracketed paste, as a pane drop does.
- **Order:** T1 the shared rules (a marker block in `devteam.mjs`, `UPLOAD_RULES` exported from the gateway, held equal by a `vm` test). T2 the laptop upload. T3 the gateway's instance-name routes. T4 the laptop's serve-back. T5 files on answers and turns. T6 the paste into the pane. T7 verification.
- **Tests:** everything is in `test/attachments.test.mjs`, one `test()` per acceptance-check group (A1–A10, B1–B9, C1–C5 in the spec). It uses real servers: a gateway built with `createGateway` and a software passkey, and a dashboard from `dashboardOnFreePort` on a throwaway HOME with `DEVTEAM_BOX=off`. Pane checks use a stand-in agent in the fixture's own tmux. `test/gateway.test.mjs` runs unchanged.
- **Risks:** a path check that `startsWith` without the separator; a route reached before its guards; a laptop check that reads the body first; the test-only limits leaking outside tests; and tmux in tests touching the box's live server. The last is handled by stripping `TMUX`/`TMUX_PANE` from every env the test builds, and by running it locally as `env -u TMUX`.
- **Each task is test first.** A task is done when its group of checks passes with `env -u TMUX node --test --test-concurrency=2 test/attachments.test.mjs` and its review record is committed.
- **Not done here:** the UI (`kit-171`), operator threads, `thread reopen` with files, a turn with files and no words, and the image's `cloud/Dockerfile`.

**Spec:** `docs/devteam-dev/tickets/kit-170-attachments-server/spec.md`. Every task cites the acceptance checks it makes pass. The spec is the source for every value: limits, modes, refusal words.

## Global constraints

- Touch only `docs/devteam/scripts/devteam.mjs`, `cloud/gateway.mjs`, `docs/devteam/schema/log.schema.json` and `test/attachments.test.mjs` (plus this ticket's records).
- The kit imports only Node's modules. No new dependency.
- **tmux safety (supervisor m-20261117-002834460):** no task, test or subagent ever runs `tmux kill-server`, or `kill-session` on anything it didn't create. Every env the test file builds for a child drops `TMUX` and `TMUX_PANE`. The file also deletes `process.env.TMUX` and `process.env.TMUX_PANE` at its top, before importing `./lib/kit.mjs`. Locally, every run is `env -u TMUX node --test --test-concurrency=2 test/attachments.test.mjs`. Never run the full suite on the box (CI is the gate). Every subagent brief carries this paragraph.
- Refusal words, limits and modes are exactly the spec's (§3–§7).
- Test helpers go in `test/attachments.test.mjs` itself (no new lib file: not in `touches`). Copy what you need from `test/gateway.test.mjs` (`cbor`, `authenticator`, the `gateway()` fixture, `upload()`); do not import from another test file.

## Review focus

1. **A file name with spaces or Unicode dropped twice in one minute** gets two distinct folders and two distinct paths. Each upload makes a new random folder (A4, plus T2's two-uploads case).
2. **The answer posted after the sweep removed its file**: `attachedFiles` refuses it, naming the path, and nothing is written (B3's missing-path case).
3. **A HEAD request** to the serve-back route gets the same headers and no body, on both servers (T3 and T4 add a HEAD case to C1).
4. **A name of 200+ characters with a long extension** stays inside `UPLOAD_NAME` on both copies (A8's list includes one), and its path still fits a log line for one file (T5 adds a one-file, longest-name answer that is accepted).
5. **An upload refused part-way (413 while streaming)** leaves no folder, and the next upload still succeeds: the `receiving` total is released (T2 adds a follow-up upload after the streamed 413).

---

### Task 1: The shared upload rules, held equal

**Model:** fast (a copy of existing code and a `vm` comparison)

**Files:**
- Modify: `cloud/gateway.mjs` (the `--- files dropped on the terminal ---` constants, ~line 825): add `export const UPLOAD_RULES`.
- Modify: `docs/devteam/scripts/devteam.mjs`: a new top-level block `/* upload rules start */ … /* upload rules end */`, placed after the `/* box start */ … end` block (~line 14540).
- Create: `test/attachments.test.mjs`.

**Interfaces:**
- Produces, in both files: `UPLOAD_RULES = { max, total, free, keepMs, stallMs, name, part, folder }`, with the gateway's values (`folder` is the `RegExp`). In `devteam.mjs` also the constants `UPLOAD_MAX`, `UPLOAD_TOTAL`, `UPLOAD_FREE`, `UPLOAD_KEEP_MS`, `UPLOAD_STALL_MS`, `UPLOAD_NAME`, `UPLOAD_PART`, `UPLOAD_FOLDER`, and the functions `safeUploadName(raw) → string`, `shellQuote(s)`, `dropPaste(paths) → string`, `isDropImage(p) → boolean`, `dropSpace(paths) → boolean`. Each is a byte-for-byte copy of the gateway's body. The block uses no import, so it runs in an empty `vm` context.
- Produces, in the test file: the header (the `TMUX` deletion, then `import './lib/kit.mjs'`), the ports (`PORTS` as in `gateway.test.mjs`, set before importing the gateway), and the helper `rulesFromKit()`, which returns the `vm` result.

- [ ] **Step 1: Write the failing test** `'the upload rules: devteam.mjs\'s copy equals the gateway\'s (A8)'`. It cuts the block between the markers from `devteam.mjs`, runs it with `vm.runInContext(block + ';({ UPLOAD_RULES, safeUploadName, dropPaste, isDropImage, dropSpace })', vm.createContext({}))`, and asserts:
  - the constants deep-equal the gateway's, with `folder` compared as `{source, flags}`;
  - `safeUploadName` is equal in both for every name in `NAMES`. That is the 17 hostile cases of `gateway.test.mjs` (`'../../etc/passwd'` … `'x.has spaces in ext'`) plus `'.part'`, `'a'.repeat(300) + '.png'`, `'b'.repeat(250)`, `'x.' + 'y'.repeat(20)`, `'....png'`, `'Ünïcödé.WEBP'`, `'a/b\\c.txt'`, `'%2e%2e.txt'`, `' '`, `'.jpeg'`, `'A B.png'`, `'file.PDF'`, `'tab\there.txt'`;
  - `dropPaste`, `isDropImage` and `dropSpace` are equal on `[['/u/a.png'], ['/u/a.png', '/u/b.pdf'], ["/u/it's.txt"], ['/u/a.JPEG', '/u/b.webp']]`.
- [ ] **Step 2: Run it, and see it fail** with "the markers are missing": `env -u TMUX node --test --test-concurrency=2 test/attachments.test.mjs`.
- [ ] **Step 3: Implement** the gateway export and the block.
- [ ] **Step 4: Run it, and see it pass.** Mutation check: change `UPLOAD_NAME` in the copy to 199, see it fail, then revert.
- [ ] **Step 5: Commit** `kit-170 T1: upload rules copied into devteam.mjs, held equal to the gateway's`.

### Task 2: The laptop's upload route

**Model:** strong (a security path)

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs`. Helpers go after the upload-rules block. The route goes in `cmdDashboard`'s `http.createServer` handler (~line 16215), right after the relay refusal and before `/api/hello`.
- Test: `test/attachments.test.mjs`.

**Interfaces:**
- Consumes: T1's constants and `safeUploadName`.
- Produces:
  - `uploadsOnBox() → boolean`: `!!process.env.DEVTEAM_GATEWAY || onBox()`.
  - `uploadsRoot() → string`: on a box, `process.env.DEVTEAM_UPLOADS_DIR || '/data/uploads'`; on a laptop, `laptopUploadsDir()`.
  - `laptopUploadsDir() → string`: `~/.devteam/uploads/<slug>-<hash8>`. `slug` is the basename of `fs.realpathSync(mainRoot)`, with `/[^A-Za-z0-9-]+/g` → `-`, cut to 40. `hash8` is `sha256(realpath).slice(0, 8)`.
  - `uploadLimits() → {max, total, free, stallMs, keepMs}`: the constants. Only while `boxFilesOff()` itself returns true (the function, never a bare `DEVTEAM_BOX` check), each of `DEVTEAM_UPLOAD_MAX`, `_TOTAL` and `_STALL_MS` that is a positive integer replaces its constant, and only downwards: `Math.min(constant, override)`, so no environment ever raises a limit. `DEVTEAM_UPLOAD_FREE` (a floor) is the exception: it may only raise its constant, `Math.max`. This function lives outside the upload-rules block, so A8 compares the real constants (spec-2 S2-2).
  - The sweep keeps a fresh `.part` folder and removes one older than `UPLOAD_STALL_MS`, as §3 step 6 and A9 say. The spec's Edge-cases bullet that still says "only removed when this process isn't receiving into it" predates spec-1 S7 and is superseded by step 6 (spec-2 S2-1).
  - `uploadRootOk(root, {make}) → string | null`: the reason the root can't be used, or null. With `make`, it first runs `mkdir -p` with mode 0700 on `~/.devteam`, `~/.devteam/uploads` and the root, then checks the root as the spec's step 5 says.
  - `sweepLaptopUploads(root, receiving: Set<string>, limits)`: the spec's step 6.
  - `receiveLaptopUpload(req, res, rawName)`: the spec's steps 4 and 6–8. It answers through the handler's `send`, with `{error}` JSON and `connection: close` on every refusal. One module-level `Map` of what each folder is receiving gives the pending bytes.

- [ ] **Step 1: Write the failing tests.** Each is a `test()` over one `laptop()` fixture. `laptop(extraEnv)`: `bareProject` in a `mkdtemp` base, HOME = `<base>/home`, `DEVTEAM_BOX=off`, the lib's ports, `TMUX`/`TMUX_PANE` removed, `dashboardOnFreePort`. It returns `{ root, port, home, folder(), post(name, body, headers), stop }`. `post` uses `http.request` with an explicit Host, so it can send a Content-Length with no body, send chunks, or stall.
  - **A4:** the 200 case on `127.0.0.1` and on `localhost`. Assert the path equals `path.join(home, '.devteam/uploads', expectedFolder(root), <folder>, 'a-b.txt')` (`expectedFolder` recomputes slug and hash8 in the test). Assert the modes 0700/0700/0600 and the bytes. Also: two uploads of the same name give two folders (Review focus 1).
  - **A5:** the seven refusals. Each declares `content-length: 1048576`, sends no body, and must be answered within 2 s (`AbortSignal.timeout` on a promise race). Each is 403 with a non-empty body. Afterwards, no folder matching `UPLOAD_FOLDER` is under the project's folder.
  - **A6:** `DEVTEAM_GATEWAY=1` and `DEVTEAM_UPLOADS_DIR=<tmp>`: 404 with `{error}` matching `/gateway takes dropped files/`. Neither folder gains anything.
  - **A7:** a declared `UPLOAD_MAX + 1` gets 413 `{error}` naming the MB limit. The root as a symlink, and the root at mode 0777, each get 503 `{error}` matching `/no folder for dropped files/`. On a dashboard with `DEVTEAM_UPLOAD_MAX=1024`, `DEVTEAM_UPLOAD_STALL_MS=300`: chunked 800 + 800 gets 413 and leaves no folder, then a 10-byte upload gets 200 (Review focus 5); exactly 1024 gets 200; 10 bytes then a stall has its socket closed within 3 s and leaves no folder. The override's gate: a dashboard with `DEVTEAM_BOX` unset (HOME still throwaway; never the real HOME) and `DEVTEAM_UPLOAD_MAX=1024` takes a 2 KB upload with 200 (the override is ignored). And with `DEVTEAM_BOX=off` and `DEVTEAM_UPLOAD_MAX` set to `UPLOAD_MAX * 2`, a declared `UPLOAD_MAX + 1` still gets 413 (an override never raises a limit).
  - **A9 (laptop half):** seed, under the project's folder, an old folder (mtime set back `UPLOAD_KEEP_MS + 60 s` with `fs.utimesSync`), a stale `.part`-only folder (both set back `UPLOAD_STALL_MS + 1 s`), an empty folder of ours, a fresh folder, a fresh `.part`-only folder, and `not-ours/`. After one upload: only the fresh ones, `not-ours/` and the new upload remain.
  - **A10:** seed a folder of ours with a file `fs.truncateSync`'d to `UPLOAD_TOTAL` (a sparse file). The next upload gets 507 with a reason.
- [ ] **Step 2: Run them, and see them fail** (404s: no route yet).
- [ ] **Step 3: Implement** the helpers and the route.
- [ ] **Step 4: Run them, and see them pass.** Mutation check: move the Origin check after `req` is first read; A5 must time out.
- [ ] **Step 5: Commit** `kit-170 T2: the laptop dashboard takes dropped files`.

### Task 3: The gateway's routes on an instance's name

**Model:** strong

**Files:**
- Modify: `cloud/gateway.mjs`: the `if (port)` branch of the request handler (~line 2040), before the artifact `prefix` redirect. Add `serveUpload` beside `receiveUpload`.
- Test: `test/attachments.test.mjs`.

**Interfaces:**
- Consumes: `receiveUpload`, the constants, `safeUploadName`, `send`.
- Produces: `serveUpload(req, res, rawPath)` in `createGateway`. Its rule is the spec's §5 (raw-path match, two segments, `UPLOAD_FOLDER`, `safeUploadName` equality, not `.part`, realpath containment with `+ path.sep`, a regular file, the headers). HEAD gets the headers with no body. It also produces a shared `uploadType(name) → {type, attachment}` that T4 copies exactly: `.png` `.jpg` `.gif` `.webp` are images; everything else is `application/octet-stream` with an attachment.

- [ ] **Step 1: Write the failing tests** with `boxGateway()`: the copied `gateway()` fixture plus `claim(authenticator())`, the instance port `P` (= `DEVTEAM_PORT_BASE`) and its own uploads dir at mode 0750. Also `boxUpload(gw, name, body, {host, origin, cookie})`.
  - **A1:** 200 on `inst(P)`, path under the uploads dir, ending `/Shot-1.png`, the bytes intact.
  - **A2:** no cookie gives 401; no Origin, term's Origin, another instance's (`inst(P+1)`) and `https://evil.example` each give 403. Each body is non-empty, and no folder was made.
  - **A3:** the box's own name and `public.` give anything but 200 and no folder; `term.` gives 200.
  - **C1 (box half)** for `a.png a.jpg a.gif a.webp` and `a.html a.svg a.pdf a.txt a.jpeg`, stored by `boxUpload`, then fetched with a GET on `inst(P)` with the session: the type, the disposition, `nosniff`, `sandbox` and the bytes. Plus one HEAD: the same headers, an empty body (Review focus 3).
  - **C2:** no cookie gives 401; a navigation with no cookie gives 302 to `/auth/login`; with the cookie, `sec-fetch-site: cross-site` and `sec-fetch-dest: image` give 403.
  - **C4 (box half):** each path in the spec's list gives 404. The symlink case is a symlink made inside a real stored folder, pointing at `/etc/hosts`.
  - **A9 (gateway half):** the same old and young folders seeded into the gateway's dir before its first upload. After one upload, the old and empty ones are gone and the young ones stay. The stale `.part` goes too, by the gateway's first-scan rule.
- [ ] **Step 2: Run them, and see them fail.** The instance POST proxies to a dead port (502), and the GET gives 502.
- [ ] **Step 3: Implement** both routes: `if (rawPath === '/upload' && req.method === 'POST') { clearTimeout(bodyTimer); return await receiveUpload(req, res, url.searchParams.get('name')); }` and `if (['GET','HEAD'].includes(req.method) && rawPath.startsWith('/upload/')) return serveUpload(req, res, rawPath);`.
- [ ] **Step 4: Run them, and see them pass.** Then run `env -u TMUX node --test --test-concurrency=2 test/gateway.test.mjs` unchanged (C5): it passes.
- [ ] **Step 5: Commit** `kit-170 T3: the gateway takes and serves dropped files on an instance's name`.

### Task 4: The laptop's serve-back

**Model:** strong

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs`, next to T2's route.
- Test: `test/attachments.test.mjs`.

**Interfaces:**
- Consumes: T2's `uploadsOnBox`, `uploadsRoot`; T1's rules.
- Produces: `serveLaptopUpload(req, res, rawPath)` and `uploadType(name)`, an exact copy of T3's. T5 reuses its shape check as `droppedFileProblem(realPath, realRoot) → string | null`; define that here and have the GET use it.

- [ ] **Step 1: Write the failing tests** on the `laptop()` fixture:
  - **C1 (laptop half):** the same nine files, stored by T2's route, then fetched with a GET carrying `sec-fetch-site: same-origin` and no Origin. Plus one HEAD.
  - **C3:** `cross-site` and `same-site` give 403; no `Sec-Fetch-Site` and no Origin give 200; Host `evil.example:<port>` gives 403; a dashboard with `DEVTEAM_GATEWAY=1` gives 404.
  - **C4 (laptop half):** the same list as T3's.
- [ ] **Step 2: Run them, and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, and see them pass.** Mutation check: drop `+ path.sep` from the containment check; the `<root>-evil` symlink case in C4 must fail.
- [ ] **Step 5: Commit** `kit-170 T4: the laptop dashboard serves dropped files back safely`.

### Task 5: Files on answers and turns

**Model:** strong

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs`: `cmdAnswer` (~6565), `cmdThread` `new`/`say` (~6916), and the `ACTIONS` `answer`, `thread-new` and `thread-say` (~15745).
- Modify: `docs/devteam/schema/log.schema.json`: `question` (properties and `x-set-only`) and `turn`.
- Test: `test/attachments.test.mjs`.

**Interfaces:**
- Consumes: `uploadsRoot()`, `droppedFileProblem()`, `LINE_MAX`, `checkLine`.
- Produces:
  - `attachedFiles(json: string) → Array<{name, path, bytes}>`: dies with the spec's §6 words. Its output is the `files` value written.
  - `filesFlag()`: `flags.files === undefined ? undefined : attachedFiles(flagStr('files'))`.
  - `lineFits(fields, by) → boolean`: builds the line as `appendLog` would (`v`, a placeholder `id` of the type's prefix, `op`, `at`, `by`, the fields) and compares its JSON bytes plus a newline with `LINE_MAX`.
  - The actions append `--files=${JSON.stringify(b.files)}` when `Array.isArray(b.files) && b.files.length <= 10`, and return `null` (400) for a `files` that is present but not such an array. For the thread actions it goes before `--`.
  - The schema's `files`: `{ "type": "array", "minItems": 1, "maxItems": 10, "items": { "type": "object", "properties": { "name": {"type":"string","minLength":1,"maxLength":200}, "path": {"type":"string","minLength":1,"maxLength":1024}, "bytes": {"type":"integer","minimum":0} }, "required": ["name","path","bytes"], "additionalProperties": false }, "description": "…", "x-tip": "Files you dropped with it." }`, on both types.

- [ ] **Step 1: Write the failing tests** on the `laptop()` fixture, which also asks a question as supervisor (`ask --kind decision …`) and makes a thread:
  - **B1:** two uploads, then `POST /api/answer`. The question's set line (`log --type question --json`) has `files`, with real paths and real sizes (the page said `bytes: 1`).
  - **B2:** `/api/thread-new` and `/api/thread-say`; the turn lines have `files`.
  - **B3:** each spec case, through `/api/answer` and `/api/thread-say`. Each gives 400 with an `error` containing the path, and the log's line count is unchanged. That includes `<root>-evil/<folder>/x.txt` (a sibling folder named with the root's name as a prefix) and the shape cases (`.part`, top-level, nested, `A B.txt`, a folder not ours, a missing file).
  - **B4:** the shape refusals, through the actions.
  - **B5:** a dashboard with `DEVTEAM_GATEWAY=1` and `DEVTEAM_UPLOADS_DIR=<a dir seeded as the gateway would: <folder>/x.png>` accepts that file and refuses one under `~/.devteam/uploads/`.
  - **B6:** after B1 and B2, append by hand (with `fs.appendFileSync`) to the owner's log file a turn line copied from B2 with one file given `extra: 1`. `devteam.mjs validate` exits non-zero and mentions `files`. Then truncate the file back and do the same with 11 files.
  - **B7:** the three commands. Each line-count and open-thread-count check is unchanged, and the question is still open. Plus one accepted answer with one longest-name file (Review focus 4).
  - CLI refusals: `answer --defaulted --files …` and `--from-chat --files …` die with "--files go with the owner's own answer".
- [ ] **Step 2: Run them, and see them fail.**
- [ ] **Step 3: Implement.** In `cmdAnswer`, call `filesFlag()` before any `appendLog` and refuse it on the excluded modes. Put `files` in the set line only when given. Check `lineFits` for the set line before writing it. In `thread new`, check both lines before the thread line is written. In `thread say`, check the turn line, as `--refs` is checked today.
- [ ] **Step 4: Run them, and see them pass.** Mutation check: replace the folder-shape check with containment alone; B3's `.part` case must fail.
- [ ] **Step 5: Commit** `kit-170 T5: answers and thread turns carry dropped files`.

### Task 6: The supervisor gets the files as a pane drop does

**Model:** strong

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs`: `typeNow` (~16847), `typeInto`, `holdLine`/`flushHeld` (~3450), `nudgeSupervisor`/`typeNudge`/`deliverNudges` (~16872), `deliverOwnerTurn` (~6869), and the `answer` nudge in `cmdAnswer`.
- Test: `test/attachments.test.mjs`.

**Interfaces:**
- Consumes: T1's `dropPaste` and `dropSpace`; T5's recorded `files`.
- Produces:
  - `typeNow(target, line, paste = null)`: with `paste` (a non-empty array of paths), it runs `send-keys -l` with `${line} `. Then `load-buffer -b devteam-drop-${process.pid}-${n} -`, with `dropPaste(paste)` on stdin through `execFileSync`'s `input` (not `sh`, which ignores stdin). Then `paste-buffer -p -d -b <name> -t target`. Then, if `dropSpace(paste)`, `send-keys -l ' '`. Then `Enter`. Without `paste`, the code path is unchanged. `recordSent(target, line)` records only `line`.
  - `typeInto(target, line, paste)`, `holdLine(key, target, line, paste)` (the record gains `paste` only when it is given), `flushHeld`, which passes `rec.paste`, `nudgeSupervisor(line, paste)`, whose queue holds `{line, paste}`, and `deliverOwnerTurn(t, text, files)`.
  - The words: when there are files, the typed line ends ` (N file[s] dropped)` before the paste.

- [ ] **Step 1: Write the failing tests** with `threadsFixture` (from `./lib/kit.mjs`) and a stand-in agent of the file's own: raw mode, writes `\x1b[?2004h` at start, records every byte to a file, and draws `stand-in supervisor`, a rule, `❯ <draft>`, a rule and `? for shortcuts`. With `menu` first, it draws a numbered menu with `Esc to cancel` until it gets a `1`. It is started with `tmux new-session -d` under `F.env()` minus `TMUX`/`TMUX_PANE`, so it is on the fixture's private `TMUX_TMPDIR` socket. **No kill-server or kill-session anywhere in the test**: `F.done()` cleans up as the lib does.
  - **B8:** three cases, each with `DEVTEAM_SUPERVISOR` set to the stand-in's pane.
    - `thread say` with the uploaded `.png` and `.pdf`: the recorded bytes end with `` `${line} (2 files dropped) \x1b[200~${png} ${pdf}\x1b[201~ \r` ``.
    - With only the `.png`: no space after `\x1b[201~`.
    - `answer` with files: the nudge line and the same paste.
    - A turn with no files: the bytes are exactly the line and `\r`.
  - **B9:** the stand-in starts with a menu. `thread say` with files is held: nothing is recorded, and the held record's JSON has `paste`. The test sends `1` to the stand-in (with `tmux send-keys` on the fixture's socket), then a second `thread say` with no files flushes the held line first. The bytes show the first line with its paste, then the second line.
- [ ] **Step 2: Run them, and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, and see them pass.** Also run `env -u TMUX node --test --test-concurrency=2 test/pane-question.held.test.mjs` (the held lines, unchanged): it passes.
- [ ] **Step 5: Commit** `kit-170 T6: dropped files reach the supervisor as a bracketed paste`.

### Task 7: Verification

**Model:** fast (running commands and recording results)

- [ ] Run `env -u TMUX node --test --test-concurrency=2 test/attachments.test.mjs`, then `test/gateway.test.mjs`, then `test/pane-question.held.test.mjs`, then `test/owner-unread.test.mjs` (it reads answer and turn lines), one at a time. All pass.
- [ ] `node docs/devteam/scripts/devteam.mjs` has no syntax errors (`node --check`), and the CI gate runs through `devteam.mjs gate ci -- <the real CI watch command>` at the pushed head.
- [ ] Write `verification.md`: a row per done-when (and per check group), the exact command, its result, and the commit.

## Self-review

- **Spec coverage:** A1–A10 are in T2 and T3 (A8 in T1). B1–B7 are in T5. B8 and B9 are in T6. C1–C4 are in T3 and T4. C5 is in T3 and T7. The spec's §7 `recordSent` note is in T6. The §3 test-only override is in T2. The §6 `x-set-only` is in T5.
- **Names used across tasks:** `uploadsRoot`, `uploadsOnBox`, `droppedFileProblem`, `uploadType` and `dropPaste` are each defined once, by T1, T2, T4 or T3, and named the same wherever later tasks use them.
- **Proportion:** the plan carries the interfaces and checks, not the bodies. The spec holds the rules.

## Rulings

None yet.

## Carried from spec review pass 2

The spec was approved at `f5b56f1` (spec-2). Its two non-blocking notes are applied here, not in the spec, so as not to void that verdict. S2-1: the sweep rule is §3 step 6's mtime rule. S2-2: the override is clamped and gated by `boxFilesOff()`, and lives outside the rules block. Both are in T2.
