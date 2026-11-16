# Spec review, pass 2

- Reviewer: reviewer-spec-2 (fresh subagent, claude-opus-5-5)
- Reviewed: f38b5ea7f5e078d98e08bc8e8af0337bbacc8e19 (diff from 34ad10d)

I checked each pass-1 finding against the diff. To do it, I ran a scratch script with copies of `PANE_SHELL`, `PANE_BUSY` and `squash`, plus the planned `PANE_RULE`, `PANE_TOKENS`, `PANE_SHELLS`, `paneNorm` and `paneBody`. It imports nothing from the kit, and it ran on the plan's fixture panes.

- F1 (Important) is fixed. Design now says the busy and menu guard reads all 15 captured lines, unfiltered. Acceptance check 3 adds the case of a spinner above the box with seven agent lines under it. In the scratch run, that pane reads as busy. Today's code doesn't press on it either, because the tail is outside its bottom 8.
- F2 (Important) is fixed. Steps 2 and 3 take the shell-count phrases out of a line and normalize it, instead of dropping the line. Check 1(a) adds the redraw where the shell is gone. In the scratch run, the status line with `1 shell still running`, with `2 shells`, and with no count all give one digest across boxed panes A, B and C.
- F3 (Minor) is fixed. Edge cases now say the change can add a first press on an empty idle prompt, and Out of scope is reworded to match.
- F4 (Minor) is fixed. Step 4 looks for the tail in raw lines, from the first body line to the end of `above`. This window is never narrower than today's bottom 8. With no cut, the body walk reaches at least 8 raw lines back. With a cut, the cut happens only when the tail isn't below the rule.
- F5 (Suggestion) is fixed. `PANE_TOKENS` takes k or M, and `1.2M tokens` matches.

Nothing new: the guards only get wider. The tail window is a superset of today's, so the change adds no early "submitted" drop. The reply-below test's echo, more-reply and typed-line panes still give three different digests, so that rescue still ends after one Enter.

No findings.

Verdict: APPROVE f38b5ea7f5e078d98e08bc8e8af0337bbacc8e19
