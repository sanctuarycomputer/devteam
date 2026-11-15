# Task 3 review, pass 1

- Reviewer: task-reviewer-3 (fresh subagent, claude-sonnet-5-5)
- Reviewed: 91a1dc4c76b0de77295e98930d08e8a327cd6dd3

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T3-1 | Important | spec §4 last bullet: the hub reads `threads` through `/api/hello` | docs/devteam/scripts/devteam.mjs:14901 (`helloBody`), 15291 | `threads` is added to `hello --json` (19155), but the dashboard's `/api/hello` body is a fixed whitelist (`inbox`, `fleet`, `alert`, `pulse`, `previews`) and drops it, so the hub never sees the counts. Neither the brief nor any plan file mentions `helloBody`, so this may be a plan gap. Either forward `threads: hello?.threads ?? null` here (and test `/api/hello`) or record why the hub does not need it. | fixed at 7902757: helloBody forwards threads; the /api/hello assertion is in Task 5's one dashboard-server test (confirmed in task-3-2) |
| T3-2 | Minor | brief Step 1 | test/dashboard-data.test.mjs:222-238 | The fixture uses the real thread CLI instead of `F.hand`. This is acceptable: the four states are produced by the real verbs (thread new/reply/ready/resolve), so it proves them more faithfully. It does not exercise a ready thread the owner later spoke on (counts as `you`/`waiting`, not `ready`), the one branch where `ready` is overridden. | fixed at 7902757: a fifth thread, ready and then spoken on by the owner, counts as waiting; expected { you: 1, waiting: 2, ready: 1 } |

Checked:
- Interface matches the brief: threadCounts at devteam.mjs:6525-6529 counts only `status === 'open'`; `v.ready` first, then `waiting === 'owner'` as `you`, else `waiting`. threadViews (6453-6468) sets `ready` to null once the owner speaks after the proposal, and `waiting` to 'owner' when the last turn is not the owner's, which agrees with the spec.
- `threads` is added after `inbox` in cmdHello (19155) and after `ooda` in dashboardData (12173). No other keys are reordered.
- Test cases at 222-238: T1 reply gives you, T2 owner-only gives waiting, T3 reply plus `ready` gives ready, T4 resolved is counted nowhere. The expected `{you:1, waiting:1, ready:1}` can only come out if every case is right, since a resolved thread counted anywhere would change a total.
- Both reads (`hello --json`, `data(F)`) are asserted, and `logBytes` is equal before and after (test:237).
- Only the two allowed files changed; the golden is untouched (Task 7 re-records it).
- Focused run (`gate test` on test/dashboard-data.test.mjs, concurrency 2): rc=0, 3 pass, 0 fail.
- hello consumers: the CLI text path (19165) and `hello.inbox` readers (14293, 14325) are not affected by the extra key.

Verdict: CHANGES 91a1dc4c76b0de77295e98930d08e8a327cd6dd3
