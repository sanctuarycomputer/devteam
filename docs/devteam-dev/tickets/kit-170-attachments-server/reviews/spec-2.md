# Spec review, pass 2

- Reviewer: spec-reviewer-2 (fresh subagent, claude-opus)
- Reviewed: f5b56f10549ba2cdd58f934e827eec71d3fb6d86 (spec.md, diff since bf0aac9)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| S2-1 | Minor | spec consistency (S7 fix) | spec.md Edge cases, bullets 1-2 | The Edge cases section was not updated with the S7 fix. It still says "A dashboard restarted mid-upload leaves a `.part`; the next upload's sweep removes it. A `.part` folder is only removed when this process isn't receiving into it." That is the old rule, which §3 step 6 and A9 now replace: a `.part` is removed only when its mtime is older than `UPLOAD_STALL_MS`, and a fresh one is kept even when this process isn't receiving into it. A9 would catch an implementation that followed the stale bullet, but the spec contradicts itself. Fix: reword the bullet to the mtime rule, and say "after `UPLOAD_STALL_MS`" rather than "the next upload". | fixed in plan.md T2 (spec text left as approved) |
| S2-2 | Suggestion | P6 / R1 (test-only override) | spec.md §3 "A test-only override", A7, A8 | (a) The override accepts any positive integer, so it could raise the limits as well as lower them. It is gated by `boxFilesOff()` (checked at line 14559: `DEVTEAM_BOX=off` and a HOME whose real path is not the account's own). Only someone who already sets the dashboard's environment can reach it, and on a box the laptop route is off anyway, so this is not a real hole. Still, if each override were clamped to at most its constant (so it can only narrow a limit), a leak could never widen anything. (b) A7's leak case (no `DEVTEAM_BOX=off`, so 2 KB gets 200) is red if the env is read unconditionally, which is the main risk. It does not test the other half of `boxFilesOff()`, the real-HOME case, and can't safely, since that would write to the real `~/.devteam`. The spec should say the override calls `boxFilesOff()` itself, not a bare `DEVTEAM_BOX` test. (c) Keep the override outside the `/* upload rules */` block, so A8 still compares the constants. | fixed in plan.md T2 (spec text left as approved) |

## Pass-1 findings

- S1: fixed. The Contracts now say which refusals are text/plain (box session 401 and Origin 403; laptop Host and relay 403), and that the page shows `error` from JSON or else the text. A2 and A5 now require a non-empty reason body for every refusal.
- S2: fixed. §6 checks every line before writing, with a placeholder id of the real shape (the same as `thread say`'s `--refs` check at line 6952). For `thread new`, the thread line and its first turn are checked before either is written. B7 now covers `thread say`, `thread new` (line count and open-thread count unchanged) and `answer` (question still open).
- S3: fixed. `.jpeg` is dropped from the image list and served as an attachment, and C1 asserts this. That matches the done-when's literal list (.png, .jpg, .gif, .webp) and does not weaken it.
- S4: fixed. `attachedFiles` now requires `realpath(root)/<UPLOAD_FOLDER>/<n>` with `n === safeUploadName(n)` and `n !== '.part'`, the same shape the GET route serves. B3 adds a root-level file, a nested file, a `.part`, an odd name and a folder not named as ours. The done-when's `../`, absolute-path and symlink cases are kept.
- S5: fixed. A7 adds the streaming cap (a chunked 800 + 800 bytes gets 413 and leaves no folder; exactly 1024 bytes gets 200), the stall (connection closed within 3 s, no folder), and a leak check (the override is ignored without `DEVTEAM_BOX=off`). The override is gated by `boxFilesOff()`; see S2-2 for a hardening suggestion.
- S6: fixed. §4 now names what is left undefended: an agent's page on an instance name can fill the 4 GB quota until the sweep, with no new authority.
- S7: fixed in §3 step 6 and A9 (a stale `.part` is removed by mtime, a fresh one is kept). The difference from the gateway is stated. Edge cases still has the old wording (S2-1).
- S8: fixed. (a) `files` is in `question`'s `x-set-only`, a key the schema already enforces at line 1493 of devteam.mjs. (b) `recordSent` records only `line`, with the reason. (c) No change was needed.

No done-when clause was dropped or weakened. The edits only add checks (A2, A5, A7, A9, B3, B7, C1) or tighten rules.

Verdict: APPROVE f5b56f10549ba2cdd58f934e827eec71d3fb6d86
