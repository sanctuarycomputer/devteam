# Task 5 review, pass 1

- Reviewer: task-reviewer-5 (fresh subagent, claude-opus-5-5)
- Reviewed: 9d91744cd9ec09a4963d8c57517373402565529e (task 5)

Diff `f93c0c8..9d91744` (.github/workflows/test-stress.yml and two evidence files), checked against ruling m-20261115-185043423 (spec.md § Rulings), spec.md § test-stress.yml and plan.md Task 5.

- Only what the spec asks for changed. In test-stress.yml the hunks are: the header comment (it names `-f node=...` and says 24 is the default, also on a schedule), the `node` input, setup-node's `node-version`, `NODE` in the stress step's `env:`, and `node $NODE` at the end of `STRESS_TITLE`. Nothing else in the file moved.
- The input matches the ruling: `type: choice`, `options: ['20', '22', '24']`, `default: '24'`, `required: false`, with a description. GitHub refuses a dispatch value that isn't one of the options.
- It reaches the job only through `with:` and `env:`. `node-version: ${{ inputs.node || '24' }}` is in setup-node's `with:`, an action input, not shell text. A scan of every `run: |` block finds no `${{`, and kit-216's `no-expr-in-run` and `scan-covers-summary` checks pass. In the script, `$NODE` is used only inside the double-quoted `STRESS_TITLE` assignment. A scheduled run has an empty `inputs` context, so `inputs.node` is null and both expressions give '24'. A dispatch with the default also gives '24'. `||` can't misfire here, because no option is falsy. The schedule keeps Node 24.
- kit-216's limits are kept: `permissions: contents: read`, no `secrets.` anywhere in the file, `concurrency: test-stress-${{ github.ref }}` with `cancel-in-progress: false`, `timeout-minutes: 240`, and `schedule` and `workflow_dispatch` as the only triggers.
- Reran at 9d91744 from this worktree: `bash docs/devteam-dev/tickets/kit-216-daily-stress-run/check-inputs.sh` gives 24 ok and "check-inputs: all ok" (exit 0). `bash …/actionlint.sh` (actionlint 1.7.7 and shellcheck 0.10.0, both sha256-checked) gives "actionlint exit: 0". Both match the committed evidence (task5-check-inputs.txt, task5-actionlint.txt). The scripts aren't executable in git, so they were run with `bash`.
- Node 20 is in test.yml's matrix (18, 20, 22, 24), so the kit runs there. Its Chrome files skip for want of a global WebSocket, as the brief notes. That limits what a `node=20` stress run can show. It is not a defect in this input, which the ruling sets.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

Verdict: APPROVE 9d91744cd9ec09a4963d8c57517373402565529e
