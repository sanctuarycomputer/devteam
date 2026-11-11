# A goal at its target closes through the Inbox

Date: 2026-11-11. A kit fix, seen on a project at v0.34.0. The plan is `docs/superpowers/plans/2026-11-11-goal-at-target.md`.

## The bug

Running goals whose latest reading is already at the target stay `ready`: `goal list` shows "0 -> 0", "12 -> 12" and "1 -> 1 attested", and the goals look stuck. Only the owner sets a goal's `status` (`x-authority`: `set.goal.owner` has it, `set.goal.supervisor` doesn't), and the owner's only route is typing `goal status <id> met`:

- The only Inbox question, `ask --class goal-met`, is refused for repo and prod goals. For an owner goal, the yes becomes a reading (`goal reading --approved`), and the status is still never set.
- `metrics` has no finding for a running goal at its target, so nothing in the tick points at it.
- The dashboard has no "mark met" action.

So the supervisor tells the owner in chat ("5 goals to mark met"), which the kit forbids elsewhere: a question only in chat never reaches the Inbox.

## The fix

**1. A finding, `goal-at-target` (medium).** For a `ready` goal whose latest reading that counts (`goalReadings`: a repo reading on main, a prod reading from prod, an owner reading with the owner's yes) reaches the measure's target (`reached`), and whose milestones are all reached or only the last is left, or which has none. Its suggestion: ask the owner with `ask --class goal-met --goal <id>`, never only in chat. It is medium: `observe-metrics` records it as an observation once a day and the tick reads it, while `wait` wakes only on high findings and would otherwise return at once on every cycle until it is asked. It goes away while a goal-met question about the goal is open, and once the owner has answered one asked after that reading (a no, or a yes the re-read refused), until a newer reading. It can be acked like any finding.

**2. One Inbox question for every source.** `ask --class goal-met --goal <id>` works for repo, prod and owner goals. It refuses a goal that isn't `ready`, one with no source or no check/question, a second open goal-met question for the goal, any `--default`, a recommendation other than yes, and `--choices` (the kit writes them).

- The kit writes the question: an owner goal's is its `measure.question`; a repo or prod goal's says the measure, the reading and the target ("Is "<title>" met? <measure> reads 12 core resources, its target is 12."). `--question`, if given, must be those words.
- A repo or prod goal must have a latest counted reading at its target (else: take one, `goal reading <id> --run`). The context says the reading and when it was taken, and where (main at a sha, or the prod check), and that a yes reads it again.
- The question carries `met: { basis, reading }`: `basis` is a hash of the goal's title, outcome, measure, preconditions (which milestones number) and milestones when asked; `reading` the reading shown (id, value, unit, at, sha). It is part of the question's hash, so the owner's answer binds to it.
- Choices are Yes (recommended) and No, in plain words.

**The owner's answer.** In `answer` (Inbox, terminal, `--from-chat`, `--from-turn`; never a default), for a goal-met question with `met`:

- Applied only when the answer is the recommendation and is yes, the goal is still `ready`, the goal's basis now equals `met.basis` (not a different goal, not after its measure or milestones changed), and the question's words and choices are the kit's for that goal and reading. Otherwise the answer is recorded and the goal stays as it is, with why.
- A repo or prod goal's check runs again before anything is written (repo on a fresh main, prod from the main checkout, as `goal status met` runs it). If the check fails, nothing is written, the question stays open, and the owner sees why (they can answer again). The check has the kit's usual 15-minute bound, so a slow check holds the answer (and the dashboard's button) that long, as `goal status met` already does. Once it returns, the log is read again: if the goal changed (status or basis) or the question was answered meanwhile (a double click, chat and the Inbox at once), nothing is written. If it runs, its reading is recorded (the owner's line, with the sha for repo), the answer is recorded, and the goal is set `met` only when the new reading reaches the target; otherwise it stays `ready` and the output says what it read.
- An owner goal: the answer, a reading of 1 citing the question (the supervisor's line, as `goal reading --approved` writes it; `goalReadings` counts each answer once), and `met`.
- The `met` line is the owner's goal set with `decision: { verdict: 'met', question }`, on the answer's channel (chat and thread lines are allowed on a goal set with a decision). The readings are the supervisor's lines, so a chat or thread answer needs no new channel rule.
- A No (or any other answer) leaves it `ready`.

A goal-met question asked by an older kit (no `met`) is answered as before: it sets nothing. An owner goal attested that way ("1 -> 1 attested") is at its target, so the finding fires and the supervisor asks once more; the new question's context says the owner already said yes and that this one marks it met. Or the owner uses the card's Mark met.

**3. The dashboard.** `goalView` carries `at_target` (the reading). A ready goal at its target says so on its card ("Reached its target: 12 of 12 core resources, read 10 Nov") and has a **Mark met** button (confirm in place, like Let go) that posts the owner action `goal-met` (`goal status <id> met`) under the same same-origin guard as every owner action. Mark met is the owner's own click, so it needs no question, as `goal status met` from the terminal never did; it still reads a repo or prod check again. `goal status met` reads a prod goal's check again too, as it already does for repo. The question shows in the Inbox like any other.

**4. Docs.** `planning.md` §1 (sources, readings, met) and `supervisor.md` (the goal-met row, and: when a goal reaches its target, ask `goal-met`, never only in chat).

## Authority

- `status` stays the owner's. Every route to `met` is an owner line: `answer` (or a chat/turn answer the supervisor records, which already carries the owner's full weight and is listed for the owner to check) or `goal status`.
- A hand-written supervisor line can't close a goal: a goal `set` with `status` is refused by the fold; an answer is the owner's field. A forged reading line (any source, sha, approved) can at most raise the finding and let the supervisor ask; a repo or prod goal's yes reads the check again and goes by that, and an owner goal's yes is the owner's own answer.
- A hand-written question line could try to mislead (another goal, other words, a recommendation of No, a forged basis). The apply checks the goal, the basis against the goal now, the words and choices against the kit's, and a yes that is the recommendation. A forged reading in its text is harmless because the check runs again.
- `goalMetProblem` (the old `--approved` route) also refuses a question whose basis no longer matches the goal.
- "The check runs again" guards against a stale or forged reading line, not against the check itself: `measure.check` is the supervisor's command, approved by the owner with the goal's design, and it is in the basis. A check that prints whatever a file says is a design the owner should not approve.

## Not changed

Owner-only and never defaulted (`constitution.md` lists `goal-met` in `owner_only`). `goal status <id> met --force` stays the owner's override. Readings, milestones and the forecast are computed as before.
