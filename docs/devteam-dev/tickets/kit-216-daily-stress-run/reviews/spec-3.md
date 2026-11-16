# Spec review, pass 3

- Reviewer: spec-plan-reviewer-3 (fresh subagent, claude-opus-5-5)
- Reviewed: 9b17a245de3a6c8ceb767fdac886e08492befd2e (spec.md)

Earlier findings:
- F2-1: confirmed fixed. spec.md is 68 lines and reads through once: one `# kit-216` title, each section once (Intent, Rulings, Acceptance checks, Design, Contracts, Edge cases, Out of scope, Risks). `^[1-5]$`, `^[0-8]$` and `^summary: \d+ files?, concurrency \d+$` each appear exactly once, intact. The diff against d499577 is only the intended edits.
- F2-2: confirmed fixed. The Edge cases bullet now says `timed out, near timeout` and points to check 3's rule. The `(run N)` suffix is taken off by the row regex, so the cell text matches.
- F1-1: confirmed. Design step 3 has `stop_burners`, which kills by recorded pid with `kill "$p" 2>/dev/null || true` and ends with `return 0`. It runs after run.mjs and from the EXIT trap. The load=0 case is in Edge cases, and check 3 covers it with a local exit check.
- F1-2: confirmed. Check 3 gives the strip-then-exactly-`ok` rule and the real strings.
- F1-3: confirmed. Check 4 covers the last commit outside `reviews/`, verification.md landing before the final reviews, and the `git diff <removal>..HEAD -- .github/` check.
- F1-4: confirmed. Check 2 rests on the `${{` grep, and actionlint runs with a pinned shellcheck.
- F1-5: confirmed. The exact patterns are given, `05` and `08` are refused, and a newline or tab in `FILES` is refused.
- F1-6: confirmed. The summary anchors on the last exact header line, reads rows until the first line that isn't one, and quotes the trailing `timed out:` and `failed:` lines above the table.

Check 4 and plan T3 step 3 agree: one removal commit changes the trigger lines and verification.md's final-head rows, names itself "the trigger-removal commit", and is the last commit outside `reviews/`.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F3-1 | Suggestion | done-when 4 | spec.md:25 | This wording was already there before pass 2, so it isn't new. "The proving run is on the commit just before the removal" can be read as the verification.md commit (plan T3 step 2), which also fires the push trigger. The plan (plan.md:127) says "the last workflow commit before the trigger's removal". Using the plan's wording would close the gap. | |

Values and refusals: unchanged from spec-1. The rebuild adds no trigger, permission, owner message or authority path.

Verdict: APPROVE 9b17a245de3a6c8ceb767fdac886e08492befd2e
