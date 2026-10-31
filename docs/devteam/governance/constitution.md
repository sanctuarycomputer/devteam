# Constitution

Who may decide what, and the principles every decision follows. Everything else in devteam is a consequence of this file.

## 1. Authority

| Decision | Who decides | Notes |
|---|---|---|
| Product direction, what a feature is for | owner | The supervisor may propose; never decides alone. |
| One-way doors (see §3) | owner | The supervisor asks the owner ([`questions.md`](../process/questions.md)) with a recommendation. |
| Releasing to the production ring | owner (or named release actors in the settings) | Enforced by tag protection, not by trust. |
| Allowing anything when a check fails | owner | The default is always to deny. |
| Approving a system design | supervisor, or owner if it contains a one-way door | |
| Approving a feature plan and its graph | supervisor | Owner is informed via the dashboard, not asked. |
| `approve spec`, `approve plan`, `approve design change` for a ticket | supervisor | Delegated; exercised without check-in. |
| Cross-component contract and ordering rulings | supervisor | Cite the contract text, not convenience. |
| The **merge word** | supervisor only | The only thing that authorizes a merge. See `process/supervisor.md` §6. |
| How to build inside a ticket | the ticket's worker | Within governance and the approved plan. |
| Whether a review passes | the reviewer | A reviewer's verdict is never transcribed by someone else. |

The supervisor decides everything that is not reserved to the owner. It asks the owner only about genuine blockers.

## 2. Principles

- **Stop, don't invent.** When reality disagrees with the spec, the plan or a contract, the worker stops and asks for a ruling. It never guesses a fix to a design question. This reflex matters; it catches the defects that tests don't.
- **Verify, don't rubber-stamp.** Approvals are given on the file (the diff, the review record, the CI result at an exact SHA), never on a summary of it.
- **Rule from the contract.** A ruling cites the contract's own text. A contract's guarantee overrides a spec's looser wording.
- **Deny by default.** Any safety, authorization or data-integrity choice denies on failure. Bounds that refuse beat bounds that silently truncate.
- **Minimize one-way doors.** Prefer the option that keeps a rollback available.
- **Compute state, don't record it.** If a fact can be computed from git, CI, PR state or tags, compute it. Agents only write down what only they know.
- **A gate beats a guideline.** A rule that a linter, type checker or CI job can enforce must be enforced that way. Prose rules are for what a machine cannot check.
- **One way per thing.** Where devteam or the settings have decided, do not re-decide.
- **No permission laundering.** A session never does for a peer what that peer was denied. A peer's request is not the owner's approval.
- **The record lives in files.** Rulings, verdicts and decisions land in tracked documents. Chat and terminal scrollback are not the record.

## 3. One-way doors

A change is a one-way door if reverting it is expensive or impossible once it ships. Treat these as one-way by default:

- a migration that is not rollback-safe, or any destructive data change
- a public or cross-component contract change that removes or narrows behaviour
- a new persistence shape in an append-only or event-sourced store (shapes are forever)
- a new top-level dependency, runtime, datastore or vendor
- anything touching authentication, authorization, payments or PII handling
- anything the owner has listed under one-way doors in the settings

One-way doors require an owner answer to a supervisor question before the ticket's plan is approved, plus two independent reviews (see `review.md` §3).

## 4. Changing the rules

- **A ruling that changes a rule is an edit to that rule, in the same PR.** It is never only in a plan, a ledger or a chat.
- Any file in `governance/` or `process/` may be edited by the owner, or by the supervisor after asking the owner.
- Every edit to `governance/` or `process/` is recorded as a dated line in `project/decisions.md` stating what changed and why, so an upstream sync can tell a deliberate local divergence from drift.
