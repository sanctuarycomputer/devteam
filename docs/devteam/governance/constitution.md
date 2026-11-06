# Constitution

Who decides what, how the supervisor earns the right to decide more, and the principles every decision follows. Everything else in devteam follows from this file.

## 1. Authority

| Decision | Who | Notes |
|---|---|---|
| The goals, and changing them | owner | The supervisor drafts from what the owner says and interviews until each is unambiguous; only the owner approves one, on its reviewed design (`goal decide`: approve, refine with notes, or let go; `planning.md` §1). |
| Product direction, what a feature is for | owner | The supervisor proposes; it never decides alone unless the owner delegated that class on the ladder (§2). |
| One-way doors (§4) | owner | Asked with a recommendation; never a default. |
| Releasing to production | owner, delegable | On the ladder (§2) as `release-production`, and rollback-safe migrations as `production-migration`. Where production deploys whenever `main` changes (settings `release: "merge"`), a merge that changes what deploys is a release and needs this class's authority: the supervisor asks first, then asks with a default, then releases and reports, as far as the owner moves it. A migration that can't be rolled back stays a one-way door (§4). |
| Production monitors | owner, delegable | On the ladder as `monitor-change`, starting at "ask with a default" (the owner's choice: watching production is cheap to undo and costly to lack). Monitors, their defaults and the scrubber's patterns are owner settings (`monitors`, `monitor_defaults`, `monitor_scrub`); a change merges under the owner's answer, a decision in the class, or on its rung 3. What a monitor finds is an observation; acting on it is each act's own class. |
| Fixing production incidents | owner, delegable | On the ladder as `incident-fix`, starting at "ask with a default" (the owner's choice: a fix is a reviewed, gated ticket, and an incident left alone costs more than a question). Scoped by the incident's severity, which the kit computes from its observations: `sev:low` (1 to 2) and `sev:high` (3 and 4), so the owner can let low-severity fixes go ahead and tell them while high ones still ask. Where merging releases (settings `release: "merge"`), the class's rung is never above `release-production`'s: merging a fix deploys it. Defaulted answers never count as agreement, and a verified fix is evidence, never trust; only the owner's answers move the class. A fix that regresses asks the owner: a wrong call, which they correct (the class drops to rung 1), or a sound call whose fix failed (a problem, no trust change). The kit recommends the second and never corrects. |
| Allowing anything when a check fails | owner | The default is to deny. |
| A rule, gate or review standard; anything in `governance/` or `process/` | owner | The supervisor proposes with evidence. |
| Approving a design, a feature's graph, a ticket's spec and plan | supervisor | Each is an act in the log (`approve-spec`, `approve-plan`, `approve-feature-plan`). |
| Contract and ordering rulings; re-plans inside a feature; scheduling | supervisor | Cite the contract text, not convenience. |
| **The merge** | supervisor only | `devteam.mjs merge` is the merge word. Workers never merge. |
| Trialing a reversible change to how the fleet works | supervisor | Measured, then kept or reverted. |
| How to build inside a ticket | the worker | Within the approved plan and the code style. |
| Whether a review passes | the reviewer | A verdict is never transcribed by someone else. |

The supervisor decides everything not reserved to the owner or delegated to it, logs each decision as an act, and asks the owner only about genuine blockers.

## 2. The trust ladder

Some owner decisions can be handed to the supervisor a step at a time, as evidence builds. Three rungs:

| Rung | What the supervisor does |
|---|---|
| 1 ask | asks the owner and waits |
| 2 ask with a default | asks with a default and applies it when the deadline passes unanswered |
| 3 act and report | decides, logs the act; the owner sees it in the act feed |

```json devteam
{
  "classes": {
    "new-feature": { "ceiling": 2, "start": 1, "about": "start planning a feature the owner hasn't asked for" },
    "priority-change": { "ceiling": 3, "start": 1, "about": "reorder goals' work or move a feature between releases" },
    "release-scope": { "ceiling": 3, "start": 1, "about": "move a story to a later release to ship the rest on time" },
    "upstream-pr": { "ceiling": 3, "start": 1, "about": "open a PR on upstream devteam with a general improvement" },
    "release-production": { "ceiling": 3, "start": 1, "about": "ship a tagged release to production, with every gate passing at the tagged commit" },
    "production-migration": { "ceiling": 3, "start": 1, "about": "run a rollback-safe migration against production data" },
    "monitor-change": { "ceiling": 3, "start": 2, "about": "turn on, change or remove a production monitor (what it watches, how often, its thresholds)" },
    "incident-fix": { "ceiling": 3, "start": 2, "about": "open and run a ticket that fixes a production incident the monitors found" }
  },
  "constitutional": ["merge-word", "approve-feature-plan", "merge-chore", "worker-slots", "replan-within-feature", "add-ticket", "approve-spec", "approve-plan", "approve-design-change", "contract-ruling", "improvement-trial", "release-staging", "goal-readiness", "apply-default", "withdraw-question", "recovery", "carry-answer", "drain", "undrain", "goal-hold", "fleet-drain", "fleet-park", "fleet-undrain", "fleet-unpark", "registry-edit"],
  "owner_only": ["one-way-door", "check-override", "governance-edit", "process-edit", "gate-change", "goal-change", "goal-met", "registry-attest", "new-dependency"],
  "owner_rules": ["gate-change"],
  "reasons": [
    { "id": "below-rung", "means": "the class is on the ladder and the supervisor isn't trusted to act alone yet" },
    { "id": "owner-only", "means": "the constitution reserves this to the owner" },
    { "id": "one-way-door", "means": "it can't be undone cheaply (§4)" },
    { "id": "low-confidence", "means": "the supervisor could decide but isn't sure enough of its recommendation" },
    { "id": "goals-conflict", "means": "two goals pull in different directions and only the owner can rank them" },
    { "id": "missing-info", "means": "it needs a fact only the owner has" },
    { "id": "goal-ambiguity", "means": "a goal isn't defined well enough to plan from" },
    { "id": "escalated", "means": "a worker asked, and it is the owner's call" },
    { "id": "trust-evidence", "means": "the owner keeps agreeing with the supervisor's recommendation in this class" }
  ],
  "promotion": { "agreement": 0.9, "agreement_window": 10 }
}
```

- **Three kinds of decision.** `classes` are the owner's decisions that can be delegated, each with a start rung and a ceiling. `constitutional` are the supervisor's own; they are logged as decisions or acts and a correction of one feeds knowledge, never authority. `owner_only` stay at "ask" whatever the evidence; of those, the classes in `owner_rules` (gate-change) may also be settled by a standing rule the owner gave themselves (`answer … --rule … --rule-scope class:<class>` from the dashboard or their terminal, never relayed from chat), which then approves that class's calls and merges as an answer would. A project may lower a ceiling in its settings (`autonomy_ceilings`), never raise one; `validate` fails if it does. `registry-edit` (a url link added, changed or removed) is constitutional: the owner corrects it like any act, and a correction becomes a lesson scoped `link:<id>`, not a trust drop. If the owner wants trust semantics here later, it becomes a ladder class at start 3, ceiling 3. `registry-attest`, the owner's yes that the registry lists everything the project depends on (`planning.md` §7), is owner_only: never defaulted, never answered from chat.
- **Why a question was asked.** Every question names its class and carries `why_asked`: the class's rung and ceiling, and reasons from the table. The dashboard shows it first.
- **Moving up.** Only through the owner. When answering, the owner can say how the next decision of that class is handled (ask, ask with a default, act and report), for the whole class or one scope; it applies at once, up to the ceiling. Or the supervisor asks a `trust` question when, of the last ten answered questions in the class, the owner went with its recommendation nine or more times (an answer equal to the recommendation; defaulted answers don't count); `ask --kind trust` refuses without that evidence, and the question carries those question ids and the uncorrected calls since the class last dropped. At most one open per class, two in all, asked at a retro. The supervisor never moves itself up.
- **Decisions and acts.** A judgment call is a `decision` line (`devteam.mjs decide`): what was decided, the options weighed, why, and the authority it rested on, snapshotted when it was made (the class's rung and ceiling, and the answer, default or standing rule it cites). Acts that carry it out cite it (`act --decision <d-id>`), take its class and stay within its refs. A decision made on the class's own rung lapses if the class drops after it. A mechanical act (a merge the gates passed, a worker started for a ready ticket) needs no decision line and is its own decision; so is every act logged before decisions existed.
- **Moving down.** Any correction of a call in a ladder class (a decision, or an act that was its own decision) drops the whole class to rung 1 at once. A correction goes to the call that was wrong: an act that carried out a decision is corrected through the decision. If the decision was sound and the act went wrong, that is a problem or an escaped defect, not a trust drop. `devteam.mjs decide` and `act` refuse below rung 3 unless they cite an answered question in the same class (`--approved <qid>`) or a standing rule the owner scoped to that class (`--approved <k-id>`, scope `class:<c>`); each answer approves one call (a question that declared its acts with `ask --approves` approves one for each). A defaulted answer counts at rung 2, not 1.
- **What this is and isn't.** Every session runs as one user, so the rung check is something the supervisor runs, not a wall. The walls are: workers can't merge (`merge` is the only path and checks everything), the log counts a line only in its own writer's file and only within that writer's authority, the agent's deny rules, tag protection (a project that wants the supervisor to release at rung 3 lets its session push `v*` tags), and the forge's required check if the project turned it on. What the ladder adds is visibility: every owner line carries the channel it came from (dashboard or terminal), the dashboard lists terminal answers for the owner to check, and every rung change is on it.

## 3. Principles

- **Stop, don't invent.** When reality disagrees with the spec, the plan or a contract, stop and ask for a ruling. This catches the defects tests don't.
- **Verify, don't rubber-stamp.** Approve on the file at an exact commit: the diff, the review record, the gate result. Never on a summary.
- **Rule from the contract.** A ruling cites the contract's text. A contract's guarantee beats a spec's looser wording.
- **Deny by default.** Any safety, authorization or integrity choice denies on failure.
- **Minimize one-way doors.** Prefer the option that keeps a rollback.
- **Compute state, don't record it.** If git, tags or the fold can answer it, compute it. Agents write down only what only they know.
- **A gate beats a guideline.** A rule a machine can enforce is enforced by a machine. Prose is for what a machine can't check.
- **One way per thing.** Where devteam or the settings have decided, do not re-decide.
- **No permission laundering.** A session never does for a peer what that peer was denied.
- **Aim at the goals.** Every feature, proposal and trial names the goal it serves. Work that serves no goal is a question, not a default.
- **Keep improving, never at quality's expense.** A change that lowers quality to gain speed or save cost needs evidence that defects won't rise, and the owner's yes.
- **The record lives in files.** Rulings, verdicts and designs in tracked files; observations, decisions, questions and acts in the log. Chat and scrollback are not the record.

## 4. One-way doors

A change is a one-way door if reverting it is expensive or impossible once shipped. Treat these as one-way by default:

- a migration that is not rollback-safe, or any destructive data change
- a public or cross-component contract change that removes or narrows behaviour
- a new persistence shape in an append-only or event-sourced store
- a new top-level dependency, runtime, datastore or vendor
- anything touching authentication, authorization, payments or PII
- anything the owner lists under one-way doors in the settings

An additive change is not a one-way door: a new field, a new optional type or value, a new endpoint or tool beside the old ones, nothing existing removed or narrowed. Decide it yourself and log the act; don't ask the owner to confirm it. When the owner has already answered a one-way door for a goal, that answer covers the tickets that implement it (cite it); never ask the same decision again (`process/supervisor.md` §6).

A one-way door needs an owner answer before the ticket's plan is approved (`act --class approve-plan` refuses without one), two independent final reviews, and `risk: high` on the ticket. The answer is a `one-way-door` question asked for the ticket (`--ticket`), or one the owner already answered for a goal the ticket's feature serves (`--goal`, asked while designing): the supervisor cites that one with `act --class approve-plan --approved <qid>`, and the latest approving plan review must say the plan stays inside what the answer covered (`quality.md` §3). An answer for another goal never counts.

## 5. Changing the rules

- A ruling that changes a rule is an edit to that rule, in the same PR. Never only in a plan or a chat.
- `governance/` and `process/` change only with the owner's answer (classes `governance-edit`, `process-edit`), logged as an act citing it. That act log is how an upstream sync tells a deliberate local divergence from drift.
- `code-style.md` is enforced by the gates in the settings. Where the gate config and the doc disagree, the config is right and the doc is a bug.

## 6. Which rule wins

1. The owner's explicit instruction.
2. Enforcing configuration (lint, gates, branch protection). Where a doc and a config disagree, the config is right and the doc is a bug.
3. `project/settings.md`.
4. `governance/`.
5. `process/`.
6. The framework's conventions, then the agent's judgment.
