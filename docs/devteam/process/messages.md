# Messages

How sessions talk to each other. Workers, planners and the supervisor send each other short messages typed straight into the other session's tmux pane. The owner is never messaged; the supervisor asks the owner through [`questions.md`](questions.md).

## 1. Sending

```
node docs/devteam/scripts/devteam.mjs send supervisor "Spec says 24h expiry, contract says 12h. Recommend following the contract." --kind design-change
node docs/devteam/scripts/devteam.mjs send api-07-session-tokens "Follow the contract: 12h." --kind ruling --re m-20261031-141502123-api-07-session-tokens
```

- **To:** `supervisor`, a ticket id (that ticket's worker), or a planner's window name (`plan-<feature>`).
- The script types one line into the recipient's pane, like `[devteam design-change m-… from api-07-session-tokens] …`, and appends it to the event log (`run/events.jsonl`). It refuses if the recipient's window doesn't exist, or if no agent is running there (the pane is back at a shell prompt, where typed text would run as a command). Resume the recipient first (`make-worker.sh <id> --resume`).
- **One line, at most 600 characters.** Lead with the point. Put detail in a file (the spec, a plan, a review record) and give its path.
- **Reply with `--re <message-id>`** so the sender (and the supervisor's sweep) can tell what has been answered.

## 2. Kinds

| Kind | From → to | Expected reply |
|---|---|---|
| `design-change` | worker → supervisor | `ruling` (maybe a re-plan) |
| `merge-request` | worker → supervisor, with `--sha` of the exact head (defaults to HEAD) | `ruling`: merged, or what's missing |
| `review-request` | worker → supervisor | `info`: which session will review, or "use your own subagent" |
| `slot-request` | worker → supervisor | `ruling`: slot granted (`supervisor.md` §7) |
| `blocked` | worker or planner → supervisor | `ruling`: an unblock, or park |
| `ruling` | supervisor → worker or planner | none; record it (§4) |
| `answer` | supervisor → worker or planner, relaying an owner answer | none; record it (§4) |
| `info` | anyone → anyone | none |

Workers and planners address the supervisor. Only the supervisor sends `ruling` and `answer` (the script refuses anyone else). Two workers may message each other directly only for `info` (for example, a co-land; see `supervisor.md` §8). Decisions always come from the supervisor.

## 3. Receiving and catching up

- A message arrives as typed input in your session. Agents that don't accept input while busy see it at their next prompt.
- `devteam.mjs messages` lists messages sent to you; `messages --open` lists the ones that expect a reply and haven't had one (rulings, answers and info expect none). Run it after a restart, before anything else; scrollback is not the record.
- The supervisor runs `messages --open` on every tick as a backstop (`supervisor.md` §3).

## 4. Recording what was decided

A message is not the record. When you receive a `ruling` or an `answer` that affects your ticket, copy it into the Rulings section of your spec or plan in your next commit, with the message id. Rulings that cut across tickets the supervisor adds to `project/decisions.md`. Rulings that change a rule are edits to that rule (`constitution.md` §4).

## 5. What not to do

- Don't message the owner, and don't ask the owner questions yourself. Escalate to the supervisor with a `blocked` or `design-change` message and say what you need from the owner; the supervisor decides whether to ask.
- Don't type into another session's pane by hand. Use `send`, so the message is logged.
- Don't hold a conversation over messages. If it takes more than one exchange, write the problem into a file and send its path.
