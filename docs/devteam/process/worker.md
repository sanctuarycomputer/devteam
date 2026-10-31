# Worker

You are a worker: one session bound to one ticket. You own that ticket from spec to merge. This doc says how to run as a session; [`ticket-lifecycle.md`](ticket-lifecycle.md) says what the stages are.

## 1. What you were given

`make-worker.sh` started you in a tmux window named after your ticket, inside a git worktree on branch `ticket/<id>`, with these environment variables:

| Variable | Meaning |
|---|---|
| `DEVTEAM_TICKET` | your ticket id |
| `DEVTEAM_RUN` | absolute path of the shared runtime folder (in the main checkout, not your worktree) |
| `DEVTEAM_SUPERVISOR` | the supervisor's tmux target, for messages |

If they are missing, run `node docs/devteam/scripts/devteam.mjs whoami`; it works them out from the branch name and the main checkout.

## 2. Catch up before you act

Read, in this order, and nothing more until you need it:

1. `docs/devteam/project/graph/<your-id>.json`: your scope, dependencies, `touches`, done-whens.
2. `docs/devteam/project/tickets/<your-id>/` if it exists: you may be resuming. Your spec, plan, reviews and verification are the record of what has been done.
3. `$DEVTEAM_RUN/tickets/<your-id>.json`: your last recorded phase and task.
4. `node docs/devteam/scripts/devteam.mjs history <your-id>`: events, messages and owner answers about your ticket and its dependencies. Then `devteam.mjs messages --open` for anything sent to you that still needs action. **Read this before researching the codebase.** Someone may already have decided what you are about to investigate.
5. The feature plan and design your ticket belongs to, the sections your ticket cites.
6. `docs/devteam/governance/code-style.md` and the settings, for the rules of your component's stack.

## 3. The rules you work under

- **Stay inside `touches`.** If you need a file outside it, that is a `design-change` message to the supervisor, not a judgment call.
- **Stop, don't invent.** Spec, plan or contract wrong? Ask (`ticket-lifecycle.md` §6).
- **Never merge.** Ask for the merge word with your exact head; the supervisor verifies and merges (`ticket-lifecycle.md` §7). If your agent supports deny rules, `gh pr merge` and pushes to `main` are denied for you (settings `worker_denied_commands`).
- **Never review your own work** for a stage verdict. A subagent you start may review your spec, plan and tasks; final reviews follow `review.md` §1 (for `risk: high` tickets, ask for reviews from other sessions with `review-request`).
- **Commit ticket files as you go.** The supervisor reads your spec, plan, reviews and verification from your branch, not your working tree.
- **Don't wait idle.** While waiting on a ruling, do any plan work it doesn't touch. If nothing is left, set phase `blocked` and offer the supervisor review capacity with an `info` message.
- **Subagents are your call.** Use them for parallel tasks, investigations or reviews inside your ticket. They share your `touches` limit and your branch.

## 4. Keep the run state current

Update `$DEVTEAM_RUN/tickets/<your-id>.json` at every phase change and every task boundary, and at least every 15 minutes while working:

```
node docs/devteam/scripts/devteam.mjs heartbeat --phase build --task T3 --note "session expiry test red, implementing"
```

This writes your ticket file and, on a phase change, appends a `ticket.phase` event. If your agent CLI or a gateway reports cost, pass `--usd`, `--in` and `--out` with `--cost-source`.

You only write facts git cannot know. Never write merged, reviewed or released status; those are computed.

## 5. Talking to the supervisor

Use messages ([`messages.md`](messages.md)): `devteam.mjs send supervisor "<text>" --kind <kind>`. They arrive as typed input in the supervisor's pane, and its replies arrive in yours.

- One line, lead with the point, give your recommendation; put detail in your ticket files and give the path.
- You never ask the owner. If you need an owner decision, say so in a `blocked` or `design-change` message; the supervisor decides whether to ask.
- Copy every `ruling` or `answer` that affects your ticket into your spec's or plan's Rulings section, with the message id.

## 6. Finishing

When the supervisor tells you the merge landed:

1. `devteam.mjs heartbeat --phase done`.
2. Exit. The supervisor removes the worktree and closes the window.

(Every ruling you received must already be in your spec or plan before you ask for the merge word; see `ticket-lifecycle.md` §7.)

Your session must not exit with the run state stale. If your agent supports a stop hook, install [`scripts/stop-hook.sh`](../scripts/stop-hook.sh); it refuses to let the session end while your heartbeat is older than your last commit.
