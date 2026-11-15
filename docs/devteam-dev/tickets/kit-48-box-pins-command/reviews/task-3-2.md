# Task review, Task 3 (`box-pins bump`), pass 2

- Reviewer: task-reviewer (fresh subagent, cold confirm, claude-opus-5-5)
- Reviewed: d0062cd8300b8d848a89a482b6b1c3504d576f4f

I read `git show d0062cd` for `docs/devteam/scripts/devteam.mjs`, `test/machine.test.mjs` and the plan's new "Builder rulings" section, and checked each against pass 1's record (`task-3.md`) and its dispositions. I ran the nine `bump` tests from a `git archive d0062cd` copy on Node v18.20.4, and all pass.

The pass-1 findings:
- **F1, fixed.** The new test adds `(1.7.8 fixes resize)` to ttyd's comment. Bump exits 1 with `the result would not verify (ttyd's version 1.7.8 is written outside its ARG ...)`, and the file stays byte-identical.
- **F2, fixed.** The mode test uses 0o664. A umask of 022 would strip that to 0o644, so the test now depends on the `chmodSync`.
- **F3, fixed in code.** The fetch and the `arrayBuffer()` read both throw `download of <asset> failed (<code>|timed out)`, and the fetch catch now also reads `e.cause.errors[0].code`. The test covers a refused port (`ECONNREFUSED`) and a hang that never sends headers (`timed out`). The disposition says a stalled body is tested too. It is not (F1-2).
- **F4, fixed.** `fs.realpathSync(file)` resolves the file before it is written. Its stat, its temp file `<real>.<pid>.tmp` and the rename all use the real path, so the temp file sits beside the target and the rename stays atomic. The new test checks that the link stays a link and the target is bumped.
- **F5, fixed.** The test now `deepEqual`s every line that does not start with `ARG `.

I checked these in scratch tests on a copy, against the real code.
- **A body that stalls after its headers** (200 with content-length 1000 and 7 bytes sent), with `DEVTEAM_PINS_TIMEOUT_MS=800`: `download of uv-x86_64-unknown-linux-gnu.tar.gz failed (timed out); nothing written`, exit 1.
- **A connection reset mid-body:** `failed (UND_ERR_SOCKET)`, exit 1.
- **A relative symlink in another directory, chained through a second link, with the target at 0o600:** exit 0. Both links stay links, the target is bumped and keeps 0o600, and no `.tmp` file is left in either directory.
- **realpath on a missing file:** it can't be reached. `pinsFile()` reads the file first, so a dangling link and a missing path both exit 2 with `no cloud/Dockerfile at ...`, before any download.
- **The timeout knob:** unset, `Number(undefined) || 120000` gives 120 s for downloads, the same as before. `'0'` and junk fall back too. Only a positive number set on purpose shortens it, and the comment at devteam.mjs:14005 calls it test-only.

Mutation: I put back the unwrapped `bytes = Buffer.from(await res.arrayBuffer());`. The task-3 review test still passes, but my scratch body-stall case then prints undici's own `The operation was aborted due to timeout`, and the reset case prints `terminated` (F1-2).

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1-2 | Minor | quality.md §3 (a disposition's "tested" must hold); task-3 F3 disposition | test/machine.test.mjs (task-3 review test, "a download whose body stalls"); fixture `state.hang` at :1006 | The case labelled "a download whose body stalls" uses `state.hang`. That returns before `writeHead`, so the stall happens in `fetch()`, not in `arrayBuffer()`. With the body-read `try` removed, the test still passes. The code is right: my scratch stall-after-headers and reset cases print `failed (timed out)` and `failed (UND_ERR_SOCKET)`. Exit 1 and nothing written hold either way, so only the wording is unguarded. Adding a fixture mode that writes headers and part of the body and then stalls, plus an assertion of `failed (timed out)`, would cover the path the disposition names. | fixed: the fixture now sends headers and part of the body, then stalls; with the body-read wrapper removed the test fails (checked) |

Verdict: APPROVE d0062cd8300b8d848a89a482b6b1c3504d576f4f
