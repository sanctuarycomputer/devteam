# Task 2 review, pass 1

- Reviewer: task-reviewer 1 (fresh subagent, claude-opus-5-5)
- Reviewed: 6f426be7bc8af7abd98891fc14b63f3159de37ee (docs/devteam/scripts/devteam.mjs)

**The helper.** `promptPointer(file)` sits at module scope next to `typeNow`, as plan review F2 asked, and its wording matches the spec's message exactly. It uses `path.resolve`. There is no temporal-dead-zone risk: `recoverOne` and `legacyRecover` only run from the command dispatch at the end of the module, and `typeNow`, declared alongside it, already follows the same pattern. `shq` (line 9692) quotes the whole message correctly, quote characters included.

**Worker/planner site (~15815).** It always types `shq(promptPointer(promptFile))`, whether fresh or resumed, and does not branch on `resume`. That follows the ruling m-20261115-064239382-supervisor. The `cmd` choice (`resume_command` or `agent_command`) and the `--settings` injection are unchanged.

**Supervisor sites (`recoverOne` ~12705, `legacyRecover` ~12922).** Each is keyed on its own local `id` (`supervisorSessionId()`, and the parsed `supervisor-session` respectively). Each keeps `"$(cat '${promptFile}')"` when resuming, so `RECOVER_MESSAGE` and `LEGACY_RECOVER_MESSAGE` still go inline word for word, and uses the pointer when starting fresh. The prompt files are written exactly as before.

**Existing tests.** I checked by reading, without running them (box rule):
- recovery.test.mjs asserts only resume argv (`claudeCalls` at 328/483/496/633), and those paths are unchanged.
- machine.test.mjs:632 reads `supervisor-prompt.txt`'s content, which is unchanged.
- The operator launch is untouched, as the spec scopes it out.

Task 1's test passes against this commit, and fails when this site is reverted in full or for resume only (see the Task 1 review).

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T2-1 | nit | quality (readability) | devteam.mjs:15192–15197 | `promptPointer` and its comment were inserted between `typeNow` and its existing comment ("Each delivery is recorded per window, so a lost Enter can be pressed later (resendLostEnter)."), which now reads as if it describes `promptPointer`. Move the helper above that comment. | fixed: in ba9296b, promptPointer moved above the typeNow comment |
| T2-2 | info | spec check 1 | devteam.mjs:12705, 12922 | No test exercises the argv of the fresh `recoverOne`/`legacyRecover` pointer. The spec accepts "code at the three sites" plus machine.test.mjs:632 for these, so this does not block, and the code is correct by reading. Recorded for visibility only. | wont-fix the spec accepts code at the supervisor sites; their tests are outside touches |

Verdict: APPROVE 6f426be7bc8af7abd98891fc14b63f3159de37ee
