# Questions

How the supervisor asks the owner. This is the only channel to the owner, and only the supervisor uses it. Sessions talk to each other with [`messages.md`](messages.md).

Every question and answer is a line in the log ([`log.md`](log.md)), in git once synced, so a new session can catch up on what the owner already decided instead of asking again.

## 1. When to ask

Ask when the decision isn't yours to make alone:

- it is reserved to the owner (`constitution.md` §1): product direction, one-way doors, releases to production, anything that allows something when a check fails;
- it is in a class on the trust ladder and you aren't on rung 3 for it yet ([`../governance/autonomy.md`](../governance/autonomy.md));
- a goal isn't defined well enough to plan from (`planning.md` §0);
- you could decide but your confidence in the recommendation is low, or two goals conflict.

Decide everything else yourself and log it as an act. A worker's `blocked` or `design-change` message is not automatically an owner question; answer it if it is within your authority.

## 2. Asking

From the main checkout:

```
node docs/devteam/scripts/devteam.mjs ask \
  --kind one-way-door --class new-dependency --reasons owner-only one-way-door \
  --ticket api-01-session-contract \
  --question "Publish the session token shape as contract 1.0? Clients will depend on it." \
  --options "publish 1.0 now" "keep it internal for one more release" \
  --recommendation "publish now; the shape was reviewed twice" --confidence 0.8 \
  --blocks api-01-session-contract app-01-sign-in-screen
```

| Kind | Use for |
|---|---|
| `one-way-door` | anything in `constitution.md` §3; needs an explicit yes or no; never a default |
| `owner-decision` | product or policy calls |
| `clarification` | product intent you can't infer |
| `proposal` | an improvement, roadmap or architecture change (`improvement.md` §4); link the research note with `--note` |
| `trust` | moving a ladder class up a rung; the script attaches the evidence (`autonomy.md` §5) |
| `goal-definition` | the gaps that stop a goal being ready, all in one question (`planning.md` §0) |

Every question names its **class** (a ladder class, one of the supervisor's own, or an owner-only class from `autonomy.md`) and its **reasons** (`--reasons`, from the table in `autonomy.md`). The script adds the class's current rung and ceiling. Together they are `why_asked`, which the dashboard shows first: why the owner, not the supervisor.

## 3. Writing a good question

- **One decision per question.** Two decisions are two questions. The exception is `goal-definition`: one question per goal, listing every gap, answered as a form.
- **Lead with the decision**, then context. The owner should be able to answer from the first line.
- **Give options and a recommendation, with your confidence.** Never an open-ended "what should I do?".
- **Set `--default`** only when the choice is reversible. When the deadline passes unanswered (`question_default_after_hours`, 24 if unset), apply it with `devteam.mjs answer <qid> --defaulted`. One-way doors never have a default.
- **Fill `--blocks`** with every ticket that can't proceed. The inbox is ranked by it.
- **Set `--ticket`** when you are asking on a worker's behalf, so you know whom to relay the answer to.

## 4. Keeping the inbox small

An inbox nobody keeps up with stalls the whole loop. So:

- At most `max_open_questions` (7 if unset) are open at once; past that only one-way doors and questions that block tickets get in. `ask` enforces it.
- Batch related questions; ask trust questions only at a retro (at most one per class and two in all).
- **Withdraw** a question that no longer matters: `devteam.mjs withdraw <qid> --reason "…"`.
- If fewer than half the questions of the last 14 days were answered, the metrics raise `inbox-stalled`: stop asking non-blocking questions, open a problem, and tell the owner once.

## 5. Ranking

`devteam.mjs questions` lists open questions with one-way doors and owner decisions first, then by how many tickets they block (more if a blocked ticket is on the critical path), then oldest first. The dashboard shows the same order.

## 6. How the owner answers

From the dashboard, or from the owner's own terminal in the main checkout:

```
devteam.mjs answer <qid> "<answer>" [--matched] [--autonomy 1|2|3 [--scope <scope>]] [--rule "<standing rule>"]
```

- `--matched` (the dashboard's "use this") records that the owner went with the recommendation. It is evidence for the trust ladder.
- `--autonomy` tells the supervisor how to handle the next decision of this class: 1 ask, 2 ask with a default, 3 decide and report. It applies at once, up to the class's ceiling.
- `--rule` turns the answer into a standing rule: an accepted `preference` in knowledge, scoped to the class unless `--rule-scope` says otherwise. The supervisor reads it before deciding in that class again, so the same question isn't asked twice.

Owner commands refuse to run from an agent session (where `DEVTEAM_ROLE` is set). The script types only the question id into the supervisor's pane; the supervisor reads the answer from the log.

## 7. After the answer

1. Relay it to every worker or planner it affects: `devteam.mjs send <ticket-id> "<answer>" --kind answer`.
2. Record where it landed with `devteam.mjs recorded <qid> <path>`: the worker's spec or plan Rulings section for ticket-scoped answers, `project/decisions.md` for cross-cutting ones.
3. If you then act on it, cite it: `devteam.mjs act --class <c> --approved <qid> -- "<what>"`.

## 8. Notifying the owner

Send a push notification (by whatever channel the settings name) only when a new question blocks work, or when something lands that the owner must act on now. One notification per state change, never one per sweep.
