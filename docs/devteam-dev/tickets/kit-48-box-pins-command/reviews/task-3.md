# Task review, Task 3 (`box-pins bump`)

- Reviewer: task-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: 79c5d9a1e8fb18998c77309fe45a2d02a4f82093

I read `git diff 79c5d9a^ 79c5d9a` for `docs/devteam/scripts/devteam.mjs` and `test/machine.test.mjs`. I checked it against plan.md Task 3 and its Rulings, including the supervisor's ruling that buffered hashing is fine, and against spec.md (the bump section, Security, Edge cases). I also read the T1 and T2 helpers it uses at 79c5d9a: `readPins`, `newer`, `pinForm`, `latestOf`, `releaseFlag`, `pinsFile`, `safe` and `die`. I ran the eight `bump` tests from a `git archive 79c5d9a` copy on Node v18.20.4, and all pass.

I added scratch tests to that copy. Each one behaved as below.
- **Hanging download.** claude-code's npm answered 503 while gh's downloads went to a server that never answers. The run exited 1 in about 0.5 s with `claude-code: HTTP 503; nothing written`. `die` calls `process.exit`, so the other downloads still running do not keep the process alive.
- **Stalled body.** I cut the timeout to 1.5 s in a copy. A body that stalls after its headers is aborted (`AbortSignal.timeout` covers `arrayBuffer()` on Node 18), and the run exits 1.
- **`file:///etc/passwd` asset URL.** Refused with `has no download URL`, and the file is untouched.
- **Asset with no `digest`.** The sum written is the sha256 of the downloaded bytes.
- **New version also written outside its ARG.** I added a comment naming ttyd's new `1.7.8`. The in-memory re-verify refuses it and nothing is written.
- **Unwritable directory.** Exit 1, the file is untouched, and no temp file is left.
- **Umask 077 on a 0o664 file.** The mode stays 0o664.

What holds:
- Sums come from the bytes, and GitHub's digest is only a cross-check. No auth header goes with a download.
- A held tool, and a tool already current, get no request and no download.
- An older `--release` is refused, and an equal one is allowed.
- Only the `versionLine`, `sumLines` and `releaseLine` lines are replaced, and values go through `versionParts`, hex and `vX.Y.Z` checks.
- The temp file is `<file>.<pid>.tmp` beside the file. It is chmodded, renamed into place, and removed on failure. A dry run downloads and writes nothing, and an identical result prints `unchanged` without writing.

Mutation runs (a scratch copy, the bump tests):
- Deleting the re-verify `die`: all 8 pass (F1).
- Deleting `fs.chmodSync(tmpFile, mode)`: all 8 pass (F2).
- Deleting the digest comparison: the digest test fails, as it should.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Important | spec bump step 4 ("It must pass verify `--release` (in memory) before it is written"); plan T3 Step 3; quality.md §3 (mutate where a test can't prove a property) | devteam.mjs:14126-14128; test/machine.test.mjs (no case) | The re-verify before writing is the gate that stops an unverifiable Dockerfile from shipping, and no test exercises it. Replacing `if (again.problems.length) die(...)` with `if (false)` leaves all 8 bump tests passing. A realistic failure path exists: a comment or RUN that already names the new upstream version (for example `# ttyd ... see 1.7.8`) turns into a stray after the bump. Add a case that bumps such a file, expects exit 1 and `the result would not verify (... written outside its ARG ...)`, and checks the file is byte-identical. My scratch run shows the current code passes it. | fixed: a test where a comment already names ttyd's next version: bump exits 1 'would not verify', file byte-identical |
| F2 | Minor | spec bump step 4 ("given the original's mode"); plan T3 test `bump keeps the file's mode` | test/machine.test.mjs:1175 | The mode test uses 0o640 under the default umask 022. `writeFileSync(..., { mode: 0o640 })` already gives 0o640, so the test passes with the `chmodSync` deleted and cannot catch a umask-dependent mode. Use a mode the umask would strip (0o666 or 0o664), or run the bump under `umask 077`. Both pass against the current code. | fixed: the mode test uses 0o664 |
| F3 | Minor | spec Edge cases ("A `why` is built from our own words plus an HTTP status or an error code"); plan T3 exact string `box-pins bump: <tool>: <why>; nothing written` | devteam.mjs:14049 (`await res.arrayBuffer()`); :14047 (the fetch catch) | A failure while the body is read is not wrapped. A timeout or reset mid-download prints undici's own text (`gh: The operation was aborted due to timeout`, or `terminated`), not `download of <asset> failed (<code>)`. The fetch catch also skips the `e?.cause?.errors?.[0]?.code` path that `upstreamJson` takes, so a refused connection reads `failed (TypeError)`. The exit is still 1 and nothing is written. Wrap the `arrayBuffer()` in the same try and reuse `upstreamJson`'s code extraction. | fixed: download errors read 'download of <asset> failed (<code>|timed out)'; tested with a refused URL and a stalled body (DEVTEAM_PINS_TIMEOUT_MS now bounds downloads too) |
| F4 | Minor | spec Security ("nothing written but the named Dockerfile") | devteam.mjs:14133-14139 | When `--dockerfile` names a symlink, `renameSync` replaces the link with a regular file and leaves the target unbumped. I reproduced it: the link became a file at v9.9.9 and the target stayed at v0.52.0. Nothing outside the named path is written, but what the path meant is silently changed. Resolve the file with `fs.realpathSync` first, or refuse a symlink. The kit's own `cloud/Dockerfile` is a regular file. | fixed: bump writes through the symlink's real path; tested (target bumped, link kept) |
| F5 | Suggestion | plan T3 test 1 ("only ARG lines were rewritten") | test/machine.test.mjs:1121 | The assertion compares only line counts, so it passes even if a non-ARG line is rewritten in place. Comparing every line that is not an `ARG <pin>=` line between before and after would prove what the message says. | fixed: the test compares every non-ARG line |

Verdict: CHANGES 79c5d9a1e8fb18998c77309fe45a2d02a4f82093
