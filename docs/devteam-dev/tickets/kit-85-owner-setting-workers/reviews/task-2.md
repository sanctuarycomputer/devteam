# Task 2 review

- Reviewer: task-2 reviewer subagent

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T2-1 | Important | spec "What validate checks" (P1-12); plan Task 2 Step 1 (tests fail without the change); quality.md §3 (mutate where a test can't prove it) | docs/devteam/scripts/devteam.mjs:1443; test/owner-setting.test.mjs 'validate takes proof on owner-setting and pane-answer only' | The new integrity rule for an owner `owner-setting` act is not proven by any test. Mutation: deleting that line leaves all 7 tests passing. Every refused case in the test (value 21, 0, "7", key `Bad Key`) is also refused by the schema walk at `log-check` (min/max, `["integer","null"]`, the key pattern), and the test checks only that the exit code is non-zero, not the message. So the cases only this rule catches are never exercised: a missing `key`, a missing `value`, and an `artifact` or `tree` on the act. That matters because readers skip the schema walk and run only `integrity()` (devteam.mjs ~1497), so this rule is the only guard `ownerSettingActs`/`latestOwnerSetting` get. Add owner acts with no `value`, no `key`, and with `artifact` (and `tree`), each refused, and match the rule's message (`/an owner-setting act names a setting/`) on at least one of the cases the schema also catches. | fixed in c47983fb: missing key, missing value and an artifact added, and every bad case matches the rule's own message; removing the rule fails the test |
| T2-2 | Minor | plan Task 2 Interfaces (order: ownerWriter, then channel, then askableProblem) | test/owner-setting.test.mjs 'owner-setting refuses…' | Nothing checks the order of the channel fence and `askableProblem`: every allowlist and value refusal runs with `DEVTEAM_CHANNEL=dashboard`. Moving `askableProblem` ahead of the channel check would pass the tests. One case such as piped stdin, no channel, key `links`, expecting the channel message, would pin the order. | fixed in c47983fb: an off-allowlist key with no channel gets the channel message |
| T2-3 | Minor | plan Task 2 Interfaces ("Produces ownerSettingActs / latestOwnerSetting") | devteam.mjs:16408-16409 | Both helpers are added with no caller and no test in this task. Their filter (`created_by === 'owner'`, key match, `byTime` order) goes untested until Tasks 4 and 5. Cover them there, or add a direct check now. | wont-fix the plan has Task 2 produce them; settings set --for (Task 4) and the finding (Task 5) call and test them |
| T2-4 | Minor | spec Contracts, CLI `owner-setting <key> <1..20 | none>` | devteam.mjs `cmdOwnerSetting` | fixed in c47983fb: a third argument gets the usage line, tested |

Checked and found sound:
- `OWNER_ACTS` is widened, so a non-owner can't write the class. The supervisor's `act` path is refused (`owner-setting is the owner's`), and the operator is refused through `OPERATOR_READS`.
- The proof rule is widened to `pane-answer` and `owner-setting` only. Mutation M3 fails the test.
- The fence order and both messages match the plan and spec word for word. The channel fence is tested: mutation M2 fails the test.
- The act's fields and `what` match the spec.
- Schema: `key` (with its pattern), `value` (`["integer","null"]`, 1 to 20) and `for` are added under `additionalProperties:false`, with no duplicate keys, and the kit's `schemaErrors` handles the type array. The act and `proof` descriptions are updated.
- HELP and COMMANDS are updated.
- `CLASS_WORDS` is only asserted, as the ruling says.
- Mutation M4 (dropping the `OWNER_ACTS` entry) fails 2 tests.
- At the reviewed commit, test/owner-setting.test.mjs passes 7/7.

Verdict: CHANGES df8423999b8dbb9cae2b9642a2962a1e46fe264e
