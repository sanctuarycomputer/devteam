# Plan review, pass 3

- Reviewer: plan-confirm-2 (fresh subagent, claude-opus)
- Reviewed: 07a6beacb8aeb8c754eb90e73162fd58d6ec97a2

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

**P2-1 is resolved as its disposition says** ("fixed: a script file run with bash -e, the bash pid checked distinct from the runner's, only it killed"). Between ac2e8b9 and 07a6bea, the only change to plan.md is the second bullet of T2 Step 3. The rest of the diff is the new `reviews/plan-2.md`. The bullet now does four things:
- It puts the run line in a script file in scratch and runs it with `bash -e <file>`, as the runner's `bash -e {0}` does.
- It says why `bash -c` would not work.
- It checks that the bash pid is not the `node --test` runner's pid.
- It kills only the bash pid.

**Probes** (scratch dir only, bash 5.2.15, no test files run):
- `bash -e run.sh`, where the file holds one command (`sleep 3`), keeps bash as the parent. bash keeps its own pid and the command runs as its child with a different pid. The exec shortcut seen with `bash -c` does not happen for a script file, so the planned pid check will pass and the probe matches CI.
- A plain `kill` of only the bash pid ends bash. Its child lives on with PPID 1. That is the state the step expects: the runner, the probe's file process and its child are still alive to be listed. I then cleaned up that child by its pid, not by pattern.

**Consistency:** I read T2 Step 3 in full, and Steps 1, 2 and 4 around it. The bullet's closing "Then kill those pids" still makes sense, because once bash is gone only the listed survivors are left. Step 2 says "a step timeout signals only the step's shell". Step 3 copies that exactly, by killing only the shell. Nothing else changed, so I found nothing new to report.

Verdict: APPROVE 07a6beacb8aeb8c754eb90e73162fd58d6ec97a2
