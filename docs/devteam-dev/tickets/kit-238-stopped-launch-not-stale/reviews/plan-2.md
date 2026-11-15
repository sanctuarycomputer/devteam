# Plan review, pass 2

- Reviewer: spec-plan-reviewer-2 (subagent of kit-238-stopped-launch-not-stale)
- Reviewed: 9536720b16f3d6f58853cdc91595461cf05e1a2b (plan.md against spec.md, plan-1's findings, devteam.mjs and the tests at that head; `git diff c8c839b 9536720`)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Important | spec acceptance checks 1-4 (the test must be able to go green); quality.md §3 | plan T1.2; test/lib/kit.mjs:153-158; devteam.mjs:1205-1207, 1304-1306 | T1.2 hand-writes the phase lines as `F.hand(id, { type: 'phase', from: null, to: … }, 2h)`. `hand` builds the id from a prefix map that has only thread, turn, question and observation, so a phase line gets the id `undefined-<stamp>-<id>`. That fails `integrity` (ids must match `^[a-z]-…` and start with the schema's phase prefix `h-`), and `readLog` drops the line into `errors`. None of the four tickets would have a phase at all, so the test stays red after the code. Separately, w-03's `starting` and `build` lines at the same `agoMs` would get the same id and the same `at`, so the second would be ignored as a duplicate id. Fix: pass an explicit `id: h-<yyyymmdd>-<hhmmssmmm>-<ticket>` in each line, and give w-03's two lines different times (for example `starting` at 2 h 1 min, `build` at 2 h). | |
| F2 | Minor | plan T1.5; devteam.mjs:10472 (the supervisor says why) | plan T1.5 | `goal hold <F.goal> run` is written without `--reason`. Run as the supervisor, `goal hold` dies with `the supervisor says why: --reason "…"` for any mode, including run, so the relaunch step fails before `worker`. Add `--reason` to the run step, as the drain step already has. (Releasing its own drain is otherwise allowed: holdRefusal, run after a supervisor drain.) | |
| F3 | Minor | spec acceptance check 1 (`active` holds ids); plan T2.4 | plan T2.4; devteam.mjs:3816-3819 | T2.4 sets `active = [...ts.values()].filter(countsAsWorker)`. That array holds ticket objects. But `ready --json` publishes `active` as ids, and the next line, `perComponent[ts.get(id).component]`, looks each one up by id, so it would throw. It needs `.map((t) => t.id)`, or `[...ts.keys()].filter((id) => countsAsWorker(ts.get(id)))`. T1.4's assertion would catch it, so the cost is only a confusing red run. The metrics count at :11524 only takes `.length`, so it is fine either way. | |

Plan-1's findings, checked in the text:

- F1 (held tickets reach `held`): fixed. T2.4 skips a ticket for its worker only when `countsAsWorker` holds. A held ticket with a live window then passes `notSchedulable` (phase `starting`, no branch) and the goal-mode check, and reaches the `isHeld` branch (:3806). T1.4 matches.
- F2 (relaunch gates): fixed. T2.6 sets `ranBefore = role === 'worker' && !!lastPhaseOf(id) && !stoppedLaunch(id)` and uses it for `started`, `ran` and the coverage-gap guard. T1.5 has the drain refusal, then the relaunch. TL;DR bullet 5 and Risks are updated.
- F3 (kit-211's shape): fixed. w-04-held-stopped is in T1.3 and T1.4.
- F4 (the no-session branch): fixed. T1.3 runs before any session exists, outside `hasTmux`. With tmux absent, the fixture's shim exits non-zero, `paneTable` returns null, and `resolvePane` says `no tmux session`, which matches T2.1's regex.
- F5 (check order): fixed. T2.1 checks the phase, then the worktree, then tmux.

Red before, green after (once F1 is fixed). Before T2, T1.3 already fails on the missing `not_started` key. Every assertion also matches the code at this head (no not_started key, w-02 and w-04 counted in `active`, a stale-worker for each, no `HELD:`), so each one is red on its own. After T2, I traced each assertion through the planned code and they hold. w-01's window runs `sleep`, which isn't in SHELLS, so `resolvePane` reports no problem: w-01 isn't a stopped launch, and `agent-exited` doesn't fire. w-03 (`build`) is the only stale-worker. After the relaunch, w-02 has its worktree and its window, so `not started` goes away.

The drain refusal can be matched. makeSession dies with `its goal is draining: a draining goal finishes what is running and starts nothing new (planning.md §1, holds)…` (:15931), so a regex such as `/draining goal.*starts nothing new/` matches. That refusal runs before the tmux check and before any worktree is made. Before T2, `started` is true for w-02 and the refusal doesn't happen, so the assertion is red then too.

memory-ceiling and multirepo are not at risk. In memory-ceiling.test.mjs:62-71, `--remove --force` removes ch-01-a's worktree but leaves its tmux window open (removeWorkerWorktree only says "now close its window"). ch-01-a is therefore not a stopped launch, `ran` stays true, and the `--resume` at :71 still starts fresh past the ceiling, with the same act wording. Its never-ran cases (:41, :47) have no phase line, as before. In multirepo-tickets.test.mjs, console-01-a logs `phase done` (:196) before the `--force` start at :209. accounts.test.mjs workers have a `starting` phase but always have a worktree (its `agent` makes one), and the ooda tests only hand-write observations. chain.mjs:294-301 holds a ticket that has no worker, so the `cmdReady` change doesn't touch it.

The TL;DR has seven bullets and matches the tasks. Only devteam.mjs and test/kit.test.mjs change, which are the ticket's touches. verification.md is the ticket's own record.

Verdict: CHANGES 9536720b16f3d6f58853cdc91595461cf05e1a2b
