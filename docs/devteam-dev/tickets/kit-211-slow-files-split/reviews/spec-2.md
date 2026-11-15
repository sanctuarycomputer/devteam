# Spec review, pass 2

- Reviewer: spec-reviewer 2 (fresh subagent, claude-opus-5-5)
- Reviewed: 4ccbdc2028f588384caf2ffff57d04edd1483742 (spec.md)

I read pass 1's record (spec-1.md) and `git diff ed56e61 4ccbdc2 -- spec.md`. I grepped the five test files at e8022ac for `setTimeout`, `sleepMs`, `nap(`, `Atomics.wait`, `timers/promises`, `setInterval` and shell `sleep`, and read the context of each hit. The spec's list is complete: machine L455, 768, 846 and 1022; recovery L130, 138, 196, 211, 220, 224, 638 and 853; pane-question L173 (already a poll), 280, 301, 502, 507 and 580; operator-threads L436, 488, 942, 944 and 970. next-step has none. operator-threads L634 (a 20 s `Promise.race` cap on a child's exit) is a timeout, not a wait, so leaving it out is correct. I read `resolvePane` and `SHELLS` in devteam.mjs, and recovery's `STUB_SHELL`, to check the new L224 poll. I glanced at split.mjs at 4ccbdc2: it does refuse to write while any `no-undef` remains, and the folder holds the tools the spec names.

- F1: fixed. The incident section now rests on measured numbers, and the remedy (the smaller target file plus the merged calls) claims no more than those numbers support.
- F2: fixed. The spec splits no test. A test over 30 s goes to the supervisor with options, and the conflict between the done-when and the ruling is stated.
- F3: fixed. The probe checks pids from a `process.emit('exit')` wrap, before kit.mjs's and chrome.mjs's exit listeners run, with one test per run.
- F4: fixed in coverage: every wait is listed by base line and classified. The new L224 poll has a flaw (N1).
- F5: fixed. Check 2 names the preamble gap, sets a 50 s target and quotes each part's preamble time.
- F6: fixed. Shape names machine's code for box-pins, box and run-folder, and pane-question's parser, as staying in their parts.
- F7: fixed. Check 6 is narrowed to `t.after` hooks, and it says why the try/finally stops can't throw.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| N1 | Important | done-when 4 ("polls on the state waited for"); a fix adds no new flake | Design › Fixed waits, recovery L224 | The poll is "`pane_current_command` is no longer `node`". The state the next step needs is different: the kit must stop seeing a live agent. `resolvePane` reports "no agent" only when the command is in `SHELLS` (`sh`, `bash`, …). After `respawn-pane -k`, the pane runs `stubshell`, a `#!/bin/sh` script that then `exec`s `/bin/sh -i`. The pane can also briefly show tmux's own forked child before that. For a moment, then, the command is neither `node` nor a shell. The poll passes in that moment, the next `--resume` is refused with "has a live agent", and `later.status` is 1. The replacement can therefore fail where the 200 ms sleep did not. Poll for what the kit reads instead: `until()` the pane's `pane_current_command` (with any leading `-` stripped) is `sh`, or is in a shell set matching `SHELLS`. | fixed: the poll waits for sh/bash/dash/zsh (leading - allowed), not merely not-node (spec, Fixed waits; edits.mjs) |
| N2 | Minor | accuracy | Design › Fixed waits, operator-threads L942 | L942 (0.8 s) sits under "Kept. Each of these waits to see that nothing happens", but the spec's own text says it waits for reads already in flight to land. That is a positive settle, not the absence of an event. Keeping it is reasonable, since in-flight fetches can't be seen from outside, but give it its own reason line, the way L502/L507 have one, so `verification.md` doesn't classify it wrongly. | fixed: L942 has its own kept line, a settle with no state to poll |

Verdict: CHANGES 4ccbdc2028f588384caf2ffff57d04edd1483742
