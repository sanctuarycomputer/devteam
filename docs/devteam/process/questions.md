# Questions

The inbox is how sessions get unblocked fast. Workers and planners ask the supervisor; the supervisor answers what it can and escalates the rest to the owner with a recommendation. The owner answers with `devteam.mjs answer <qid> "<answer>" --by owner`, from a dashboard, or by editing the file's answer fields (then the supervisor's next `sync-questions` logs it and nudges the asker). Every question ever asked stays on disk as history, so a new session can orient from what was already decided instead of re-researching.

## 1. The file

One JSON file per question at `docs/devteam/run/questions/<id>.json`, following [`schema/question.schema.json`](../schema/question.schema.json). Ids look like `q-20261031-141502-api-07-session-tokens` (UTC date and time, then the asker).

Create a question with the script so the id, timestamp and event line are right:

```
node docs/devteam/scripts/devteam.mjs ask \
  --kind design-change --ticket api-07-session-tokens \
  --question "The spec says tokens expire in 24h but the contract says 12h. Which wins?" \
  --options "follow the contract (12h)" "amend the contract to 24h" \
  --recommendation "follow the contract; it is the published guarantee" \
  --blocks api-07-session-tokens
```

**One writer at a time.** The asker creates the file. After that only the answerer writes the answer fields (`answer`, `answered_by`, `answered_at`, `status`). The asker may set `status: withdrawn` while it is still open. Nobody else edits it.

## 2. Who asks whom

- **Workers and planners always address the supervisor** (`to: supervisor`). They never message the owner directly; the script refuses it.
- **The supervisor** answers everything within its authority (`constitution.md` §1). Anything reserved to the owner it re-asks as a new question with `to: owner`, its own recommendation, and the original question's id in `context`. It answers the worker's question with "escalated to <new id>".
- **The owner** may answer any open question, including ones addressed to the supervisor. An owner answer always wins.

## 3. Kinds

| Kind | Asked by | Typical answer |
|---|---|---|
| `design-change` | worker | a ruling; maybe a re-plan |
| `merge-request` | worker, with `head_sha` | the merge word, or what is missing |
| `review-request` | worker | which session will review, or "dispatch your own subagent" |
| `slot-request` | worker | a gate slot grant (`supervisor.md` §7) |
| `blocked` | worker | an unblock, or `park` |
| `clarification` | anyone | an answer |
| `owner-decision` | supervisor (escalating its own or a planner's or worker's question) | product or policy call |
| `one-way-door` | supervisor (same) | explicit owner yes or no |

## 4. Writing a good question

- **One decision per question.** Two decisions are two questions.
- **Lead with the decision**, then context. The answerer should be able to answer from the first line in most cases.
- **Give options and a recommendation.** Never ask an open-ended "what should I do?".
- **Set `default`** only when the choice is reversible. If the question is unanswered after the binding's `question_default_after_hours` (24 if unset), the supervisor applies it with `devteam.mjs answer <qid> "<default>" --defaulted`, which sets `status: defaulted` and logs it. One-way doors never have a default.
- **Fill `blocks`** with every ticket that cannot proceed. The inbox is ranked by it.

## 5. Ranking

`devteam.mjs questions` lists open questions in this order:

1. `one-way-door` and `owner-decision` addressed to the owner;
2. then by how much they block: number of tickets in `blocks`, weighted up when a blocked ticket is on the critical path;
3. then oldest first.

The dashboard shows the same order.

## 6. After the answer

- `devteam.mjs answer` writes the answer fields, appends a `question.answered` event, and nudges the asker's tmux pane (`devteam: <id> answered`). The file holds the content; the nudge only says where to look.
- **The asker records the ruling in a tracked file** in its next commit, then runs `devteam.mjs recorded <qid> <path>`. Ticket-scoped rulings go in the spec's or plan's Rulings section, before the ticket asks for the merge word. Cross-cutting ones the supervisor adds to `project/decisions.md` (through a `chore-` PR or the next planning PR).

## 7. Notifying the owner

The supervisor sends the owner a push notification (by whatever channel the binding names) only when a new owner question appears that blocks work, or when something lands that the owner must act on now. One notification per state change, never one per sweep.
