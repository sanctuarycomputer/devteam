# Autonomy

How the supervisor earns the right to decide more on its own. The constitution (`constitution.md` §1) says who decides what. This file covers the owner's decisions that the owner may choose to hand over, a step at a time, as evidence builds up: the **trust ladder**.

## 1. Three kinds of decision

- **The supervisor's own.** Everything the constitution gives the supervisor: the merge word, worker slots, re-plans inside a feature, adding tickets, approving specs, plans and feature plans, contract rulings, improvement trials, staging releases. These are not on the ladder. The supervisor logs them as acts (`devteam.mjs act`), and a correction of one feeds knowledge, never authority.
- **The owner's, for good.** One-way doors, production releases, allowing anything when a check fails, edits to `governance/` or `process/`, adding or loosening a gate, changing a goal, a new top-level dependency or vendor. These stay at "ask" whatever the evidence. The ladder can't change the constitution.
- **The owner's, delegable.** The classes in §3. Each starts low and can climb to its ceiling.

## 2. Rungs

| Rung | Name | What the supervisor does |
|---|---|---|
| 1 | ask | asks the owner and waits |
| 2 | ask with a default | asks with a default, and applies it when the deadline passes without an answer (`answer <qid> --defaulted`) |
| 3 | act and report | decides, logs the act, and the owner sees it in the act feed |

`devteam.mjs act --class <c>` refuses below rung 3 unless it cites an answered question (`--approved <qid>`); at rung 2 a defaulted answer counts as approval, at rung 1 it doesn't. A refused act writes nothing.

## 3. The ladder

```json devteam
{
  "classes": {
    "new-feature": { "ceiling": 2, "start": 1, "about": "start planning a new feature the owner hasn't asked for" },
    "priority-change": { "ceiling": 3, "start": 1, "about": "reorder features or goals' work, or move a feature between releases" },
    "release-scope": { "ceiling": 3, "start": 1, "about": "move a story to a later release to ship the rest on time" },
    "upstream-pr": { "ceiling": 3, "start": 1, "about": "open a PR on upstream devteam with a generic improvement (improvement.md §6)" },
    "spend-over-budget": { "ceiling": 2, "start": 1, "about": "spend past improvement_budget_usd_per_week or a ticket's expected cost" }
  },
  "constitutional": [
    "merge-word", "worker-slots", "replan-within-feature", "add-ticket", "approve-spec", "approve-plan",
    "approve-design-change", "approve-feature-plan", "contract-ruling", "improvement-trial", "release-staging",
    "goal-readiness", "apply-default", "withdraw-question"
  ],
  "owner_only": [
    "one-way-door", "release-production", "check-override", "governance-edit", "process-edit", "gate-change",
    "goal-change", "new-dependency"
  ],
  "reasons": [
    { "id": "below-rung", "means": "the class is on the ladder and the supervisor isn't trusted to act alone yet" },
    { "id": "owner-only", "means": "the constitution reserves this to the owner" },
    { "id": "one-way-door", "means": "it can't be undone cheaply (constitution §3)" },
    { "id": "low-confidence", "means": "the supervisor could decide but isn't sure enough of its recommendation" },
    { "id": "goals-conflict", "means": "two goals pull in different directions and only the owner can rank them" },
    { "id": "missing-info", "means": "it needs a fact only the owner has" },
    { "id": "goal-ambiguity", "means": "a goal isn't defined well enough to plan from (planning.md §0)" },
    { "id": "trust-evidence", "means": "the evidence suggests the supervisor could move up a rung" }
  ],
  "promotion": { "clean_acts": 10, "min_days": 14, "seen_age_days": 7, "agreement": 0.9, "agreement_window": 10 }
}
```

A project may lower a ceiling in its settings (`autonomy_ceilings`), never raise one; `validate` fails if it does. Add a class here (an edit to governance, so the owner's call) when the owner keeps answering the same kind of question the same way and it isn't covered.

## 4. Why a question was asked

Every question names its class and carries `why_asked`: the class's current rung and ceiling, and one or more reasons from the table above. The owner can see at a glance whether the supervisor needed them because of the rules, the stakes, or its own uncertainty.

## 5. Moving up

Two ways, both through the owner:

- **At answer time.** When answering a question in a ladder class, the owner may say how to handle the next one: ask, ask with a default, or act and report, for the whole class or one scope (a component, a feature). It applies at once, up to the ceiling.
- **A trust question.** When the evidence supports it, the supervisor asks (`ask --kind trust --class <c>`), at a retro, at most one open per class and two in all. The question lists the evidence, which the script attaches:
  - **clean acts:** acts in the class since it last dropped, that the owner has marked seen in the act feed, that are at least 7 days old, and that no one corrected. Ten of them over at least 14 days.
  - **agreement:** of the last 10 questions in the class the owner answered, how many went with the supervisor's recommendation. Defaulted answers don't count.

The supervisor never moves itself up. Clean acts and agreement are evidence for the owner to weigh, not a trigger.

## 6. Moving down

Any correction of an act in a ladder class drops that class (and scope, if the act had one) to rung 1, at once, and resets its clean count. The owner corrects from the act feed (`devteam.mjs correct <act-id>`); the supervisor records corrections it finds at a retro (`--retro`). A correction of the supervisor's own decisions (§1) doesn't change authority; it becomes evidence for knowledge (`process/log.md` §3).

## 7. What this is and isn't

The rung check is something the supervisor runs before acting and the act log records; it is not a wall an agent can't get around, because every session runs as the same user. The walls are where they always were: CI's merge-word check, required reviews, tag protection, `worker_denied_commands`. What the ladder adds is visibility: every owner line records whether it came from the dashboard or the command line, every rung change is on the dashboard, and the owner's answers never come from an agent session (owner commands refuse to run where `DEVTEAM_ROLE` is set).
