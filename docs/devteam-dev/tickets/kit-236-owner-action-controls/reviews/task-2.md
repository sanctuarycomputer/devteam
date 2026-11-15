# Task review: T2 (Done and Can't right now, always)

- Reviewer: task-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: e5d916b7979b58f756c44090c76bb3e641ad4043 (docs/devteam/dashboard/index.html: choicesOf, isOa, oaSuggest, needsWhich, questionCard)

I checked T2 against spec §4 and plan T2. isOa(q) holds only for an owner-action with no secrets and status 'open'. questionView's statuses are open, answered, defaulted and withdrawn, and /api/data's questions are the open ones. openQuestion sends an open question to the Inbox and draws only answered ones, so the drawer's choicesOf list stays as asked: the old path, the recommendation unshifted and marked. choicesOf returns exactly Done and Can't right now, none rec, for an open owner-action, even with its own choices or options. The server takes a free-form answer, so a question asked with options still accepts "Done". needsWhich is false for every owner-action, and the which-ask no longer fires. Secrets cards, answered owner-actions and every other kind take the unchanged path. oaSuggest escapes the recommendation and each way's label. A choice with no label yields an empty string, never "undefined". No other answering path reads the recommendation: I grepped it, and the rest is drawer and metrics text only. isOa and the consts are declared at top level near line 1240, and the first top-level call (showTab, ~3894) comes after them, so there is no TDZ at load. The one finding is about process.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | governance/quality.md §3 Stages ("task (before the next task)"); plan "Review records" | commit e5d916b7979b58f756c44090c76bb3e641ad4043 | T2, T3 and T4 landed in one commit, so no task review could happen between them as the stages require. It also leaves no point at which T3 stood on its own (plan-3 P3's reason for the oaAnyway stub). These reviews read the three tasks at the one head. Nothing in the code follows from it. Record it so the next ticket commits per task. | |

Verdict: APPROVE e5d916b7979b58f756c44090c76bb3e641ad4043
