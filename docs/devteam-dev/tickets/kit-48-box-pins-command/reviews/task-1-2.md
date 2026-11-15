# Task 1 review, pass 2

- Reviewer: task-reviewer (fresh subagent, cold confirm, claude-opus-5-5)
- Reviewed: 5d960025dc4ec26121936c592b3c96375f2f1409

I reviewed the T1 parts of 95ac0fc..5d96002 (`readPins` holds and strays, the `DEVTEAM_BOX_TOOLS` message, `releaseFlag`, and the new test 'verify names what it found, where') against pass 1's findings, spec.md and plan.md Task 1. I ran the verify tests on a `git archive` snapshot of 5d96002 with the env-cleared command: 5 pass, 0 fail. I also probed the snapshot kit from a scratch kit-own fixture repo against the real `cloud/Dockerfile`.

Each pass-1 finding, confirmed:
- F1: fixed. A stray now prints the match with 24 characters on each side. A sum placed after 100 characters of a long `RUN` line is shown in full (`line 116: aaaa... c5221f...d83 tail`). A match at the start of a line is shown too (`line 116: 2.104.0`). The new test asserts `v2.104.0/gh_2.104.0` after `line <n>:`. The old 80-character cut would have failed that.
- F2: fixed. The regex `^# hold:(?: (.*))?$` rejects `# hold:x` and `# hold:<tab>reason` as looks-like-a-hold. It still treats `# hold:` and `# hold: ` as "has no reason", and it accepts `# hold:  reason`, whose reason is trimmed. The `m[1]?.trim()` guard covers the undefined group. All three bad forms are tested.
- F3: fixed. An unknown pair matching `[\w.+=$-]{1,80}` is printed as written (`node=$NODE_VERSION`, tested). Anything else, e.g. `x;rm=1`, still prints as `?`.
- F4: fixed as its disposition states. Tests now cover problem 7 (missing, extra and absent), a sum stray, a duplicate and an empty ARG, no DEVTEAM_RELEASE, a hold naming versions, mise's version without its `v`, the indented and `#hold:` forms, and exact line numbers through `lineOf`.
- F5: fixed. `--release`, `--release=` and `--release v1.2` exit 1 and print the usage line. A valid but wrong `--release v1.2.3` still gives the DEVTEAM_RELEASE mismatch.

Nothing new broke: the real Dockerfile still verifies (`ok, 6 tools, release v0.52.0`), and the earlier verify tests still pass.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Suggestion | quality.md §3 (tests that fail against a wrong implementation) | test/machine.test.mjs, 'verify names what it found, where', comment "a stamp or a hold naming a version is no stray" | The comment names two cases but only the hold is tested. No test sets a tool's version equal to DEVTEAM_RELEASE's bare version (e.g. a tool at `0.52.0`) to show that the `ARG DEVTEAM_RELEASE=` line is skipped by the stray scan. The code does skip it (`rel.forEach((i) => pinLines.add(i))`). Add that case, or trim the comment. | fixed: a case with a tool at the stamp's number (UV 0.52.0, release v0.52.0) verifies ok |

Verdict: APPROVE 5d960025dc4ec26121936c592b3c96375f2f1409
