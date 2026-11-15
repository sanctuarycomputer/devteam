# Spec review, pass 2

- Reviewer: spec-reviewer (fresh subagent, pass 2, claude-opus-5-5)
- Reviewed: 738801eabf0a9d36d6d8a40202565951de438003 (spec.md)

I read the spec at 738801e and pass 1's record with its dispositions. I also read `ticket show kit-48-box-pins-command` (the top-level done_when), the design's kit-48 section, Contracts and Failure modes, and `cloud/Dockerfile` 55-136 and 505-525. I ran a simulation of the fixed rules against the real Dockerfile:
- Verify problem 4 (versions bounded on digits and dots, sums on hex, with the pin `ARG` lines, `ARG DEVTEAM_RELEASE=` and `# hold:` lines left out of the search) gives 0 hits across the 14 pin values.
- Problem 7's `DEVTEAM_BOX_TOOLS` match finds exactly one line (521).
- `^#\s*hold\b`/i matches no line. The Dockerfile's own `#   To hold a tool back` comment does not match.
- `installed`'s regex gives `1.7.7`, `2.1.307`, `2.104.0`, `2026.10.17` and `0.13.7` on the real outputs (gh's and mise's taken live on this box). gh's second line, `.../tag/v2.104.0`, is never reached.

Pass 1's findings are fixed, as follows:
- F1: the rule and the done-when-2 case (gh's URL) are both in.
- F2: a misplaced hold is a problem, and there is a case for it. A gap remains, below.
- F3: the exclusions and distinct fixture bytes are in.
- F4: the token is cleared, there is a header case, and assets are served outside the API base.
- F5: the match is named, with exactly six pairs.
- F6: the regex is named.
- F7: check exits 2 with problem lines or JSON.
- F8: exit 3.
- F9: the temp file goes beside the Dockerfile, the mode is kept, and a lower `--release` is refused.

The fixes don't contradict each other.

Exit codes against the done-when: the done-when says check "exits 1 when one is stale and 0 when all are current or held". Exit 3 applies only when some tool is unknown and none is stale. In that state the tools are not "all current or held", so the done-when requires nothing there, and both of its required cases still hold. That is consistent, and the restatement in Acceptance 3 says so. Exit 2 for a broken file is a state the done-when doesn't cover: no tool is evaluated. It matches the done-when-1 precedent (exit 2 when there is no file to work on). It doesn't touch verify, which still exits 1 on a broken file, as done-when 2 requires. The design says only "exits 1 if any is stale", which this keeps. One residue, not a finding: an uncaught crash in check exits 1 and reads as "stale". Exit 1 still means "act", so this fails safe.

One thing blocks approval. F1: the hold fix closed the misplaced-hold hole but left a malformed-hold one, with the same consequence F2 had.

Values and refusals:
- P1 harness-agnostic: no harness is involved. Passes.
- P2 nothing project-specific: it acts only on the file it is given. Passes.
- P3 decide and report: the new calls are made and marked (exit 3, exit 2, the lower-release refusal). Passes.
- P4 owner-only asks: none asked. Passes.
- P5 adversarial for authority: no authority is touched. The hold rule and download path were tried here (F1, F2). Passes.
- P6 simple, names what isn't defended: it does. Passes.
- R1 no self-widening: nothing writes log or owner lines. Passes.
- R2 plain owner-facing words: the output is for the supervisor and CI. Passes.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Important | ruling m-20261115-004401439 (a hold is a `# hold:` line directly above the `_VERSION` ARG); done-when 4 ("leaves a `# hold:` tool unchanged"); pass-1 F2 | spec, Holds ("held when the line directly above ... is `# hold: <reason>`"; a problem when a `^#\s*hold\b` line, any case, "is not directly above") | The two rules use different shapes. A hold is recognized only in the exact form `# hold: <reason>`. The misplaced-hold problem only fires when the line is *not* directly above. So a line directly above `ARG GH_VERSION=` that reads `# Hold: 2.105 breaks auth`, `# HOLD: ...`, `#hold: ...` or `# hold - ...` is neither a hold nor a problem. Verify says ok, check reports the tool current or stale, and bump moves it: pass-1 F2's failure, reached by a different typo. Close it with one sentence, either way. Option one: parse any `^#\s*hold\b` line (any case) directly above a `_VERSION` ARG as a hold, with the reason being the text after an optional `:`, and an empty reason is problem 8. Option two: make any `^#\s*hold\b` line that is not exactly `# hold: <reason>` a verify problem wherever it sits. Add a case (say, `# Hold: x` directly above, which must not be bumped). | fixed: any ^#\s*hold\b line that is not exactly '# hold: <reason>', or not directly above a _VERSION ARG, is a verify problem; a '# Hold: x' case added |
| F2 | Minor | spec, Security (the build re-downloads from the Dockerfile's URL); done-when 4 (sums are the real hashes) | bump step 2 (downloads each asset's `browser_download_url`); Acceptance 4 (the fixture serves the bytes at the listed URLs) | GitHub's `browser_download_url` answers 302, to a different host. The fixture serves the bytes directly. So a download that doesn't follow redirects passes every test, then fails every real bump, which writes nothing. That fails safe, but it leaves the release tool broken on its one real path. Say that downloads follow redirects (still sending no auth header after a redirect), and have the fixture's asset URL answer 302 to a second path that serves the bytes. | fixed: downloads follow redirects with no auth header; the fixture answers each download with a 302 |
| F3 | Suggestion | spec, verify problem 4; bump step 4 (the new text must pass verify) | verify problem 4 | The rule is right for today's pins (0 hits). But the file has bare two-part numbers that a future pin could equal: `dockerfile:1.7` (line 1), `libpango1.0-dev`, `libatk1.0-0` and `libatk-bridge2.0-0` (60, 62), `--python 3.12` (129) and `sleep 0.2` (237). If a tool moves to `1.0`, `2.0`, `1.7` or `3.12`, bump refuses its own output, and the release-prep PR stalls on a false stray. This fails safe. Have problem 4's line give the line number and the text it matched, so the fix is obvious. Optionally, search a two-part version only where it is not followed by `-` or end of line. | fixed: a stray's problem names its line number and the matched text |

Verdict: CHANGES 738801eabf0a9d36d6d8a40202565951de438003
