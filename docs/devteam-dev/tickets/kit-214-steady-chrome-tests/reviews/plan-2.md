# Plan review, pass 2

- Reviewer: spec-plan-reviewer-2 (fresh subagent, claude-opus-5-5)
- Reviewed: 4bfba6355aa88690b3461fdc358626a91c6d8c3a (plan.md, diff since 004dc98)

TL;DR: 7 bullets. Files: `.github/workflows/test-stress.yml` is added to the global constraints, as the ruling allows. P1-1, P1-3, P1-4, P1-5 (by the Node 22 stress dispatch the ruling allows), P1-6, P1-7 and P1-9 are fixed as written. Task 5 matches spec § test-stress.yml and the ruling. It uses `with:`/`env:` only, with a `|| '24'` fallback for the schedule, and changes nothing else. Its check uses kit-216's check-inputs.sh, which also checks that no `run:` holds `${{`, plus actionlint.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P2-1 | Important | done-when 1; P1-2 | plan.md:40 (Task 1 step 1, "no exit ever reported") | The step removes the `exit` listeners (`chrome.proc.removeAllListeners('exit')`) and then calls `close()`, which adds its own `once('exit')` (chrome.mjs:52). `exit` still reaches `done()` about 3 s after the SIGKILL, so the case passes at main and never goes down the bound path. Remove the listeners after `close()` is called, in the same turn, or stub `proc.once`. Then run the case against main's copy in step 2 as well: it should hang or be cancelled. The case can't show `proc.unref()` (libuv closes the handle on reap), so the review focus should not count it as evidence for unref. Same as spec F2-1. | |
| P2-2 | Important | P1-8; spec § pane-question | plan.md:73 (Task 4 step 1) | P1-8 is marked fixed, but Task 4 is unchanged. The wrapper still polls "at most 400 times" (20 s, past the dashboard's 10 s tmux `execFile` timeout). It still matches "the arguments hold `send-keys` and `-l`" rather than whole arguments in the `"$@"` loop. The spec now says 8 s and whole arguments, so the plan contradicts the spec it implements. Set at most 160 polls (8 s), match `send-keys` and `-l` as whole arguments, and add the `gave-up` marker from spec F2-2. | |

Verdict: CHANGES 4bfba6355aa88690b3461fdc358626a91c6d8c3a
