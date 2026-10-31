# Questions

How the supervisor asks the owner. This is the only channel to the owner, and only the supervisor uses it. Sessions talk to each other with [`messages.md`](messages.md).

Every question ever asked stays on disk as history, so a new session can catch up on what the owner already decided instead of asking again.

## 1. When to ask

Ask only about what is reserved to the owner (`constitution.md` §1): product direction, one-way doors, releases to production, anything that allows something when a check fails, anything the settings list as owner-only. Decide everything else yourself. A worker's `blocked` or `design-change` message is not automatically an owner question; answer it if it is within your authority.

## 2. The file

One JSON file per question at `docs/devteam/run/questions/<id>.json`, following [`schema/question.schema.json`](../schema/question.schema.json). Create it with the script, from the main checkout:

```
node docs/devteam/scripts/devteam.mjs ask \
  --kind one-way-door --ticket api-01-session-contract \
  --question "Publish the session token shape as contract 1.0? Clients will depend on it." \
  --options "publish 1.0 now" "keep it internal for one more release" \
  --recommendation "publish now; the shape was reviewed twice" \
  --blocks api-01-session-contract app-01-sign-in-screen
```

| Kind | Use for |
|---|---|
| `one-way-door` | anything in `constitution.md` §3; needs an explicit yes or no |
| `owner-decision` | product or policy calls |
| `clarification` | product intent you can't infer |

## 3. Writing a good question

- **One decision per question.** Two decisions are two questions.
- **Lead with the decision**, then context. The owner should be able to answer from the first line.
- **Give options and a recommendation.** Never an open-ended "what should I do?".
- **Set `--default`** only when the choice is reversible. If it is still unanswered after `question_default_after_hours` in the settings (24 if unset), apply it with `devteam.mjs answer <qid> --defaulted`. One-way doors never have a default.
- **Fill `--blocks`** with every ticket that can't proceed. The inbox is ranked by it.
- **Set `--ticket`** when you are asking on a worker's behalf, so you know whom to relay the answer to.

## 4. Ranking

`devteam.mjs questions` lists open questions with one-way doors and owner decisions first, then by how many tickets they block (more if a blocked ticket is on the critical path), then oldest first. A dashboard shows the same order.

## 5. How the owner answers

- `devteam.mjs answer <qid> "<answer>"` from the main checkout, from a dashboard, or by editing the answer fields in the file.
- The script types the answer into the supervisor's pane. For hand edits and dashboards, the supervisor's loop runs `devteam.mjs sync-questions`, which logs the answer and does the same.

## 6. After the answer

1. Relay it to every worker or planner it affects: `devteam.mjs send <ticket-id> "<answer>" --kind answer`.
2. Record where it landed with `devteam.mjs recorded <qid> <path>`: the worker's spec or plan Rulings section for ticket-scoped answers, `project/decisions.md` for cross-cutting ones.

## 7. Notifying the owner

Send a push notification (by whatever channel the settings name) only when a new question blocks work, or when something lands that the owner must act on now. One notification per state change, never one per sweep.
