# Plan review, pass 4 (cold confirm)

- Reviewer: cold-confirm-reviewer-2 (subagent of kit-238-stopped-launch-not-stale)
- Reviewed: a7868c9fe606a4bc8f582bc82e7898e598b02580 (plan.md against spec.md, plan-3's F1 and its disposition, test/lib/kit.mjs and devteam.mjs at that head; `git diff f88c904 a7868c9 -- docs/devteam-dev`)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

Plan-3 F1 (the file): fixed. A whole planned line, traced through the code:

- Written: `hand(id, { id: 'h-<stamp>-<id>', type: 'phase', from, to }, ago, '<id>.jsonl')` (test/lib/kit.mjs:153-158) appends `line({ op: 'new', ...o, id, at, by })` to `docs/devteam/run/log/<id>.jsonl`; `line()` (kit.mjs:21) puts `v: 1` first. So the line carries `v: 1`, `op: 'new'`, `type: 'phase'`, the explicit id (`o.id` wins over hand's prefix map), `from`, `to`, `at` = now minus ago, `by` = the ticket id. No owner `channel`, since `by` is not `owner`. No field outside phase's properties, so parseLines (devteam.mjs:1277) strips nothing.
- File: `writerOfFile('w-01-held.jsonl')` (devteam.mjs:1177) is not MONTHLY, not owner/supervisor, and matches the ticket-id form, so the writer is `w-01-held`, equal to `by`. The same holds for `w-02-stopped`, `w-03-stuck` and `w-04-held-stopped`. That is the file `logFileFor` names for a ticket (`<by>.jsonl`, :1491), and the one makeSession's own `starting` line lands in on the relaunch.
- Integrity (readLog uses `validate: false`, so `integrity` alone, :1190): the writer matches the file; `writerClass` is `ticket`; phase is not keyed, so the id must match `x-id.pattern` `^[a-z]-\d{8}-\d{9}-[a-z0-9]+(-[a-z0-9]+)*$` (it does: `h-yyyymmdd-hhmmssmmm-w-01-held`), start with phase's prefix `h-`, and end with `-<by>`; `x-authority.new.ticket` includes `phase`. Accepted, so readLog puts it in `lines`, not `errors`.
- Read as the ticket's own: `workerState` (:2767) filters `l.by === id` and sorts phases by `at`; `lastPhaseOf` (:16090) filters `created_by === id`, which fold sets from `by`. Ids are distinct across tickets (the ticket suffix) and across w-03's two lines (a minute apart), so fold's ignore-a-repeated-id rule drops none, and w-03's last phase is `build`.

Red before, green after: nothing else in T1 stops it. Before T2, T1.3 fails on the missing `not_started` key and on w-02 and w-04 being in `active`. After T2, the lines are read, every ticket is 120 minutes silent against 30, and the checks follow from T2.1-T2.6 as plan-2 and plan-3 traced. The helper can't call hand's `stamp`, which threadsFixture does not return, but the plan has the test compute its own; the id needs only the pattern, not to agree with `at` to the millisecond. `ticket set … held` is a supervisor field (`x-authority.set.ticket.supervisor` includes `held`), so it goes through `F.sup`, as other tests do (fleet-park.test.mjs:196).

Matches the spec: T2's six steps are the spec's "Behaviour changes" one for one, and T1.3-T1.5 cover acceptance checks 1-4, the no-session ones outside `hasTmux`. Scope: only docs/devteam/scripts/devteam.mjs and test/kit.test.mjs change, which are the ticket's touches.

Verdict: APPROVE a7868c9fe606a4bc8f582bc82e7898e598b02580
