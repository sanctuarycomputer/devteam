# kit-211: CI timings under test.yml's concurrency 8 (for the supervisor)

PR #263 run 43736309029, job kit (24, rest) at 20f2833, against main run 43698914484 (the Why table's), per-test durations summed per file from the spec log (durations.mjs).

## Untouched files: the whole job ran 1.7-2x slower

| file | main run | PR run |
|---|---|---|
| accounts | 128.1 s | 223.2 s |
| dashboard | 261.3 s | 413.8 s |
| hub-overview | 50.3 s | 76.1 s |
| registry | 25.5 s | 47.4 s |
| landing | 22.1 s | 43.6 s |
| gate-add | 24.0 s | 46.0 s |

## The 18 parts on the PR run (sum s; tests over 30 s)

- test/machine.box-pins.test.mjs: 34.0 s
- test/machine.box.test.mjs: 92.8 s
  35.0  a repo on a kit from before recover comes back from the box's list, the way the box always brought it back
- test/machine.hub-records.test.mjs: 37.2 s
- test/machine.run-folder.test.mjs: 100.1 s
  77.7  a worker's run folder gets nothing from the incident's own test, run as it was: a worker's DEVTEAM_RUN, no DEV
- test/machine.status.test.mjs: 135.7 s
  79.5  status says at a glance what a check-in needs, and reads no pane it needn't
  34.1  each read the operator may run writes nothing
- test/machine.tell.test.mjs: 45.6 s
- test/next-step.order.test.mjs: 60.6 s
- test/next-step.rank.test.mjs: 52.0 s
- test/next-step.strategy.test.mjs: 64.9 s
- test/recovery.recover.test.mjs: 63.7 s
- test/recovery.relaunch.test.mjs: 39.9 s
- test/recovery.restart.test.mjs: 63.5 s
- test/pane-question.answer.test.mjs: 58.3 s
- test/pane-question.held.test.mjs: 52.3 s
- test/pane-question.parse.test.mjs: 0.1 s
- test/operator-threads.hub.test.mjs: 39.4 s
- test/operator-threads.pane.test.mjs: 53.6 s
- test/operator-threads.store.test.mjs: 53.2 s

## The same parts alone, locally (test/run.mjs --concurrency 1, wall s incl. start-up; box load about 11 on 32 cores, Node 18, Chrome tests skipped)

- test/machine.box-pins.test.mjs  24.5  ok
- test/machine.box.test.mjs  45.5  ok
- test/machine.hub-records.test.mjs  18.0  ok
- test/machine.run-folder.test.mjs  39.9  ok
- test/machine.status.test.mjs  43.0  ok
- test/machine.tell.test.mjs  20.8  ok
- test/next-step.order.test.mjs  19.7  ok
- test/next-step.rank.test.mjs  18.3  ok
- test/next-step.strategy.test.mjs  20.6  ok
- test/recovery.recover.test.mjs  24.4  ok
- test/recovery.relaunch.test.mjs  16.7  ok
- test/recovery.restart.test.mjs  27.3  ok
- test/pane-question.answer.test.mjs  7.6  failed (exit 1)
- test/pane-question.held.test.mjs  45.3  ok
- test/pane-question.parse.test.mjs  0.2  ok
- test/operator-threads.hub.test.mjs  8.1  ok
- test/operator-threads.pane.test.mjs  18.8  ok
- test/operator-threads.store.test.mjs  33.6  ok
- failed: test/pane-question.answer.test.mjs (failed (exit 1))
