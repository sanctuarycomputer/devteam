# Plan review, pass 3

- Reviewer: plan-reviewer-3 (fresh subagent, claude-opus)
- Reviewed: 2e5c8125dc6ca054fb1d7c0c19e9ef7b7d40ed0f (plan.md, cold confirm of plan-2)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P3-1 | Minor | plan-2 P2-3 (disposition wording) | plan.md:83-87; devteam.mjs 2348, 2529 | The P2-3 disposition says the message avoids "findMergeSha's patterns". The forge `git` subject `<id>: records` (and the GitHub `--subject`, which a squash puts on main) does match findMergeSha's squash pattern `subject.startsWith(`${id}:`)` (2348). The plan text itself (85) only promises to keep out the `from …ticket/<id>` wording, and line 87 gives the real safeguard: `factsRepo` (2529) routes a link ticket to the link, and returns null rather than falling back to home when the link can't be read. So home's `mergeShaFor` is never asked about the ticket, and no other reader matches home main subjects by `<id>:` (only 2348 does). Nothing is wrong. Add a few words to line 87 ("the subject matches the squash pattern; this routing is why that's harmless") so the implementer doesn't "fix" the subject, and so nobody later makes `factsRepo` fall back to home. | fixed: landRecords comment says the subject needn't avoid findMergeSha because factsRepo routes link tickets to their link, and not to add a home fallback there |

Confirmed fixed:

- P2-1. plan.md:131-133 now say `merged-without-merge` keeps firing on the home records merge, which agrees with spec.md:112-114. The test asserts it is present in the half-done state (137-138) and gone after the retry (141). Checked against the code: in the half-done state the home merge commit's p2 is `recSha` and no act names it, so the per-repo loop (devteam.mjs 11663-11668) fires on it. The ticket loop stays silent, because `mergedAt` reads the link (2531), where the code hasn't landed. After the retry, the act's `what` carries `at <recSha>`, and T3's change to collect every `at <sha>` match (plan.md:94; today only the first match, 11651) puts p2 in `heads`, so the finding clears. The fragile skip keyed on the ticket's records head is gone.
- P2-2. plan.md:126-127 and 131 limit `records_landed` and `records-without-code` to active tickets (not superseded). That is the kit's own `isActive` (devteam.mjs 2559). The kit has no "dropped" ticket state, so "not superseded" covers what P2-2 asked for.
- P2-3. plan.md:83-87 now say where the message comes from: merge writes its own message and never reads `run/pr/`. The subject has no `from …ticket/<id>` (the `fromBranch` regex, 2347), and GitHub uses the same `--subject`/`--body`. See P3-1 for the one inaccuracy in the disposition's wording.

Plan against spec: T3b agrees with spec acceptance 3 (spec.md:112-114, 127) and with the ruling m-20261115-185317950. The ruling's points are each covered: the state it leaves (114-117), that a retry is safe (118-125), what status shows (126-133), and a test (134-141). The third `merge` still returns at the link's "already on main" check (devteam.mjs 4974), before any records logic. The diff adds no new Critical or Important problem. Its only changes are plan.md:83-87, 126-133 and 137-141.

Verdict: APPROVE 2e5c8125dc6ca054fb1d7c0c19e9ef7b7d40ed0f
