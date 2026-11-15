# Plan review, pass 2

- Reviewer: plan-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: 281aec0502358b01c30974efffe0bd134fd6e0f9 (plan.md)

## What I checked

This is a cold confirm. I read only `git diff badb75e 281aec0 -- plan.md`, checking it against each plan-1 finding and its disposition. I ran the new shell lines under dash and ran no tests.

- **F1-1: fixed.** The new check is `case $DEVTEAM_KIT_RELEASE in *[!v0-9.]*) rel= ;; *) rel=$(… | grep -xE 'v[0-9]+\.[0-9]+\.[0-9]+') ;; esac`. Under dash, `v1.2.3` passes and each of these gives `''`:
  - the two-line `v1.2.3` value, `v1.2.3` then a newline and `x`, and `v1.2.3` with a trailing newline
  - `v0.52.0-rc1`, `''`, `1.2.3`, `v1.2`, `v1.2.3'; touch x; '`, `v1.2.3v`, `vv1.2.3`

  `rel` now holds only `[v0-9.]`, so the single quotes around `'$rel'` in the pane command can't be broken. Step 1's six values all come out as the plan says.
- **F1-2: fixed.** `w=${DEVTEAM_HUB_WAIT_SECONDS:-15}; case $w in ''|*[!0-9]*) w=15 ;; esac`. Under dash, `15s`, `abc` and empty all become 15 and `$(( ))` survives; `3` stays 3. The new test case (`15s` with `BODY` set gives `rc=0`) shows the shell doesn't die, provided the deadline is computed before the first try. That is the natural shape of a deadline loop, and the timeout note's `${w}s` now always names a number.
- **F1-3: fixed.** The real-tmux test kills `=home` and `=kit49-other` first and checks that `kit49-other` is no older than `home`. `session_created` has one-second resolution, so a tie in the same second passes without proving which session tmux takes as current. tmux picks by activity time, which is finer, and the session made later wins. Step 4's no-colon mutation shows the case can fail. That is enough.
- **F1-4: fixed.** The two definitions go just before the bare `hub_window` call, after the `home` block. That puts them before both the call and the minute loop, and the background loop inherits them. The minute-loop line is found by `trim()`. The "lines sit" test's anchor `tmux new-session -d -s home -n operator` still matches only the operator block, because the definition line says `-n hub`.
- **F1-5: fixed.** README's "no approval step so that every release that changes the image deploys by itself" is now in Task 3 Step 1.
- **F1-6: fixed.** The TL;DR's tests bullet now says what could go wrong. It is still seven bullets and stands without the later sections.

**Nothing else broke.** No other line of the plan changed. Coverage, touches and the Task 2 and Task 3 steps are as I checked them in pass 1. The new Rulings line just records plan-1.

## Findings

| # | Severity | Finding | Disposition |
|---|---|---|---|
| F2-1 | Suggestion | Task 1 Step 1, the real-tmux test: `#{session_created}` has one-second resolution, so "`kit49-other` no older than `home`" passes on a tie without proving which session tmux takes as current. The no-colon mutation in Step 4 is what proves the case, so this doesn't block. A tighter check would compare `#{session_activity}`, or would not rely on order at all: run the mutated line too and assert that it fails. || Taken in the build: the test also sleeps 1.1 s between the two sessions, so session_created orders them; the no-colon mutation stays the proof. |

Verdict: APPROVE 281aec0502358b01c30974efffe0bd134fd6e0f9
