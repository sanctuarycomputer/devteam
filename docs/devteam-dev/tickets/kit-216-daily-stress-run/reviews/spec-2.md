# Spec review, pass 2

- Reviewer: spec-plan-reviewer-2 (fresh subagent, claude-opus-5-5)
- Reviewed: 1c04efc9963502a1ef8875628a94e26a0811ded2 (spec.md fixes)

Pass-1 findings:
- F1-1: confirmed fixed in intent. `stop_burners` uses `kill "$p" 2>/dev/null || true` and `return 0`, runs after run.mjs and from the EXIT trap, and the load=0 edge case is stated. But the text only survives in the duplicated copies (see F2-1).
- F1-2: partly fixed. Check 3 now gives the real strings and the strip-then-exactly-`ok` rule. The Edge cases line the finding cited still says "A file that times out shows `timed out` in its cell" (spec.md:227) (see F2-2).
- F1-3: confirmed fixed in check 4 (last commit outside `reviews/`, verification.md before the final reviews, `git diff <removal>..HEAD -- .github/` check).
- F1-4: confirmed fixed. Check 2 rests on the `${{` grep and requires a pinned shellcheck for actionlint.
- F1-5: not confirmed. The intended text (exact patterns `^[1-5]$` and `^[0-8]$`, newline or tab refused) is mangled at every occurrence. Line 37 reads "validates `REPEAT` against `^[1-5]" and then restarts the whole document, and the final copy's bullet (spec.md:212) begins ": exact patterns", with neither pattern named (see F2-1).
- F1-6: not confirmed. The header regex is cut off at spec.md:110 ("`^summary: \d+ files?, concurrency \d+" followed by a restart of the document). The final Summary bullet (spec.md:217) goes straight to ", and reads rows until the first line that isn't one" and never names the header it anchors on (see F2-1).

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F2-1 | Important | quality.md §3 (spec is the contract the plan and code are held to) | spec.md:37, 71, 110, 144, 178 (whole file) | The fix commit e3d400d corrupted spec.md. It went from 65 to 243 lines. Every replacement string with a `$` right before a backtick (`^[1-5]$`, `^[0-8]$`, `\d+$`) was expanded into the whole text before the match. That is the JavaScript String.replace `$` + backtick special pattern, so the fix was evidently applied with a string replacement rather than a replacer function. The result has five partial copies of the title, Intent, Rulings, Acceptance checks and Design. The bullets for the F1-5 validation and the F1-6 header anchor are cut in half, and the exact patterns those two fixes exist to pin down are missing from the one copy that reads through. A spec that can't be read is not a contract that can be approved or reviewed against. Fix: regenerate spec.md from ed2534e with the edits applied literally (a replacer function, or a plain editor), then check that `grep -c '^# kit-216' spec.md` is 1 and that the patterns `^[1-5]$`, `^[0-8]$` and `^summary: \d+ files?, concurrency \d+$` each appear once. | |
| F2-2 | Minor | done-when 3, F1-2 | spec.md:227 (Edge cases) | The Edge cases bullet still says a timed-out file shows `timed out` in its cell. run.mjs prints `timed out, near timeout[ (run N)]`, which check 3 now says correctly. Make the edge case match, so the two places in the spec agree. | |

Values and refusals: unchanged from spec-1. The fixes add no trigger, permission, owner message or authority path.

Verdict: CHANGES 1c04efc9963502a1ef8875628a94e26a0811ded2
