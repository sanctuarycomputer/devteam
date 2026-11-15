# Plan review, pass 3 (cold confirm)

- Reviewer: cold-confirm-reviewer (subagent of kit-238-stopped-launch-not-stale)
- Reviewed: f88c9041a73b43e37d58f0860d70a16d38cc50a2 (plan.md against spec.md, plan-2's findings, test/lib/kit.mjs and devteam.mjs at that head; `git diff 9536720 f88c904`)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Important | spec acceptance checks 1-4 (the test must be able to go green); quality.md §3 | plan T1.2; test/lib/kit.mjs:153-158; devteam.mjs:1177-1183, 1190-1191, 1491, 1754-1755 | T1.2 now gives each phase line a valid `h-<stamp>-<ticket>` id, but still writes it with `F.hand(id, {…}, ago)` and no file argument. threadsFixture's `hand` then appends to `<by>-<yyyy-mm>.jsonl`, here `w-01-held-2026-11.jsonl`. `writerOfFile` reads that name as the writer `w-01-held-2026-11` (the MONTHLY form is only for owner, supervisor and plan-), so `integrity` refuses every line with `by "w-01-held" does not match the file's writer`, and `readLog` drops it into errors. A ticket's own lines live in `<id>.jsonl` (`logFileFor`, :1491). As written, none of the four tickets has a phase, so the test stays red after T2 for the same reason plan-2 F1 named. Fix: pass the file, `F.hand(id, {…}, ago, `${id}.jsonl`)`, in the phaseLine helper (hand's fourth parameter exists for this). | Fixed: T1.2 passes the ticket id plus .jsonl (its own log file, logFileFor) as the fourth argument to hand. |

Plan-2's findings, checked in the text and against the code:

- F2 (`goal hold … run --reason`): fixed. T1.5 passes `--reason test` to both drain and run. `goal hold` dies without a supervisor reason for any mode (devteam.mjs:10472), and the supervisor may release its own drain (holdRefusal). The regex `/draining goal.*starts nothing new/` matches the real refusal at :15931, `its goal is draining: a draining goal finishes what is running and starts nothing new …`, which `fails` returns from stderr.
- F3 (`active` is ids): fixed. T2.4 is `[...ts.values()].filter(countsAsWorker).map((t) => t.id)`, which the `perComponent` loop (`ts.get(id)`, :3819) and `ready --json` both take as ids.
- F1 (ids): the id half is fixed. `h-<yyyymmdd>-<hhmmssmmm>-<ticket>` matches `x-id.pattern`, starts with phase's prefix `h-`, ends with `-<by>` (the by being the ticket id, as `appendLog(…, id)` writes it, :15610 and :16055), and a ticket writer may create phase lines (`x-authority.new.ticket`). The `stamp` the plan copies is the one in kit.mjs:150. w-03's two lines a minute apart get distinct ids and times, so `fold` keeps both and `build` is last. The file half is still open (F1 above).

Matches the spec otherwise. T2.1-T2.6 implement each "Behaviour changes" bullet: `stoppedLaunch` checks phase, worktree, then tmux (the regex covers both of resolvePane's `no tmux session`/`no tmux window` problems, :15409-15410); `countsAsWorker` feeds `ready`'s skip and `active` and metrics' `active`; stale-worker skips held and stopped; `not_started` goes on a stopped row only; status precedence is prompt, HELD, not started, STALE; makeSession's `ranBefore` drives `started`, `ran` and the coverage-gap guard. T1.3-T1.5 cover checks 1-4, the no-session branch outside `hasTmux`.

Red before, green after. Before T2, T1.3 fails on the missing `not_started` key (and on w-02/w-04 in `active`), and T1.5's drain refusal does not happen because `started` is true. After T2, once F1 is fixed, the traces in plan-2 hold. Without the F1 fix the test is red both before and after, so it cannot serve as the gate.

Scope. Only docs/devteam/scripts/devteam.mjs and test/kit.test.mjs change, the ticket's touches; verification.md is the ticket's own record.

Verdict: CHANGES f88c9041a73b43e37d58f0860d70a16d38cc50a2
