# Task 1 review

- Reviewer: task-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: cf48df93d3cef24ed0cae70a31e3cf3306be1e5f

I reviewed the diff b10f1d4..cf48df9 in `docs/devteam/scripts/devteam.mjs` and `test/machine.test.mjs` against plan.md Task 1 and spec.md: verify problems 1-8, Holds, Dispatch and the tool table. I read the surrounding code too: `parseArgs`, `die`, `repoRoot`, `homeAt`, the `DEVTEAM_RUN` check and the dispatch at the end of the file. I ran the four T1 tests on a `git archive` snapshot of cf48df9 with the env-cleared command, and all four pass. (The worktree also has uncommitted T2 test edits, which I did not review.) I then probed the committed kit from a scratch kit-own fixture repo, using Dockerfiles made from the real one.

What holds:
- The table matches the spec: the order, the prefixes, the upstreams and the asset names. gh's asset name uses the bare version and mise's keeps the `v`. claude-swap is read through `uv tool list` with `UV_TOOL_DIR`. `firstVersion` is the spec's regex.
- The real Dockerfile verifies: `ok, 6 tools, release v0.52.0`.
- Problem wordings match the plan's list.
  - An empty version gives `gh's GH_VERSION is empty`.
  - A duplicate gives `uv's UV_VERSION is given 2 times`.
  - The hex check passes the TTYD case.
  - A missing or extra `DEVTEAM_BOX_TOOLS` pair is reported.
  - A sum in a comment is caught as `ttyd's TTYD_SHA256_X86_64 sum is written outside its ARG (line 76: ...)`.
- Line numbers are 1-based. With a hold inserted above `ARG GH_VERSION` at line 91, the hold is reported on line 90 and the real gh URL on line 98.
- Holds:
  - Flagged as problems: `  # hold: x` (indented), `#hold: x`, `# HOLD: x`, `# hold - x` and a whitespace-only `# hold:   `.
  - Accepted: `# holder: x` (no `\b` match) and a hold whose reason names a version and a sum (the stray scan skips the line).
  - A hold directly above a `_SHA256` ARG is reported as not directly above a `_VERSION` ARG.
- The stray scan skips every pin ARG line, including another tool's pin at the same version.
- Dispatch:
  - `box-pins installed` passes `machineWide` and the `DEVTEAM_RUN` exemption. A kit in no repo, a cwd in no repo and a foreign `DEVTEAM_RUN` reach `installed: not yet`. In the kit-own fixture, `verify` with that same foreign `DEVTEAM_RUN` is still refused.
  - `KIT_VIEWS` lets `verify` run in the kit-own fixture.
  - `box-pins` with no mode prints the usage line and exits 1.
- `pinsFile` exits 2 with the spec's line, both for a missing default and for a directory given as `--dockerfile`.
- `--release v0.52.0` passes, and `--release v1.2.3` against a v0.52.0 file is caught.
- The tests would catch an implementation that bounds versions with `\b`, since that misses both literals in the URL case. They would also catch one that does not skip other tools' pin ARGs, or that drops any of the four hold arms.

One Important problem blocks: a stray's problem line can cut off the very text it found (F1).

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Important | spec verify 4 ("A stray's problem line names its line number and the text matched", spec-2 F3); plan T1 Step 3 wording `(line <n>: <matched text>)` | devteam.mjs `readPins`, `excerpt` (`l.trim()...slice(0, 80)`) | The message prints the first 80 characters of the trimmed line, not the text matched. On a long line the match falls past the cut. On the acceptance case itself (gh's `$GH_VERSION` replaced in the download URL), verify prints `gh's version 2.104.0 is written outside its ARG (line 98: && curl -fsSL -o /tmp/gh.tgz "https://github.com/cli/cli/releases/download/v2.10)`, so the version it names is cut off. A sum stray in a long `RUN` line would not appear at all. Print the match itself (`re.exec(l)[0]`), or a window around its index. The test should then assert the matched text, e.g. `\(line \d+: [^)]*2\.104\.0`. | |
| F2 | Minor | spec Holds ("not exactly `# hold: <reason>`") | devteam.mjs `readPins`, `/^# hold:(.*)$/` | `# hold:x` (no space after the colon) is accepted as a hold with reason `x`. The spec's exact form is `# hold: <reason>`, and it lists `#hold:` as a problem. Either require `^# hold: (.*)$` (still treating `# hold:` and `# hold: ` as "no reason"), or say in the spec that the space is optional. | |
| F3 | Minor | plan T1 Step 3 ("Values in a message pass through the filter"), read for its purpose | devteam.mjs `readPins`, `DEVTEAM_BOX_TOOLS names ${safe(x)}` | Every pair contains `=` (and usually `$`), and `safe` rejects both. So an unknown pair is always printed as `DEVTEAM_BOX_TOOLS names ?, which is no tool's` (a probe with `foo=bar` confirmed it), and the message never says which pair. This text comes from the local file, not the network. Use a filter that admits `=` and `$` (for example the same printable-ASCII excerpt as F1), or name only the part before `=` after `safe`. | |
| F4 | Minor | quality.md §3 (tests that fail against a wrong implementation); spec verify 4, 7 | test/machine.test.mjs, T1 section | Several required behaviours have no test that would fail if they broke: problem 7 (`DEVTEAM_BOX_TOOLS` missing, duplicated or with an unknown pair); sum strays; duplicate or empty ARGs; the skip of `ARG DEVTEAM_RELEASE=` and of `# hold:` lines in the stray scan (a tool at `0.52.0`, or a hold reason naming a version); a version searched without its `v` (mise); an indented hold; and exact line numbers (every assertion uses `\d+`). The spec's listed acceptance cases are all present. Add the cheap ones, at least problem 7, a sum stray, a hold reason naming a version, and one exact line number. | |
| F5 | Suggestion | spec verify 6 ("`--release` itself not `vX.Y.Z`: the usage error, exit 1") | devteam.mjs `releaseFlag` | A bad or empty `--release` exits 1 with `box-pins: --release "v1.2" is not vX.Y.Z`. That is clear, but it is not the usage line. Append `\nusage: ${BOX_PINS_USAGE}` if the spec means the line literally. | |

Verdict: CHANGES cf48df93d3cef24ed0cae70a31e3cf3306be1e5f
