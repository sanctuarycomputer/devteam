# kit-216 final review, pass 1, track b

- Reviewer: final-reviewer-1b (fresh subagent, claude-opus-5-5)
- Reviewed: 231113c5a95bb24f2a97de38448367888941ff7e (the whole branch)

## Attacks tried

The stress step's script was pulled out of `.github/workflows/test-stress.yml` at 231113c into a private scratch dir and run under bash 5.2 with `node` stubbed as a shell function: `node -e` became `sleep 300`, `node test/run.mjs` printed its argv and a crafted log and returned a chosen code, and the real embedded `summary.mjs` ran. Every probe ran under `timeout` with `ulimit -v 4000000`. Results were judged by exit code.

1. **Input injection.** Each of these was refused with exit 2 before run.mjs or any burner started: `$(id)`, a backtick, `;ls`, `*`, `-x`, `--timings`, CR, VT, NBSP, U+3000, `é`, `::warning::x`, `a%0A::error::x`, and repeat `0`, `05`, ` 3`, load `9`, `-1`. A whitespace-only `files` selects `--group chrome,rest`. Two files separated by two spaces become exactly two argv words. A 200 KB word reaches run.mjs as one plain path argument. `/etc/passwd`, `../x` and `test/../../y` pass the pattern and reach run.mjs as file arguments, never as options. At worst run.mjs exits 2 or node fails to parse the file, and the run goes red. A dispatcher already chooses the ref, so this gives them nothing new. A refused word is echoed inside `::error::`, but it can't hold a newline, so it can't start a second workflow command (B2). I found no `${{` in any `run:` block, and shellcheck 0.11.0 at `-S style` is clean on the extracted step.
2. **Cleanup and exit status.** Each case was checked with the real summary script, with the count of `sleep 300` processes taken before and after:
   - load 0 and green: exit 0.
   - load 2 and green: exit 0, with every burner reaped.
   - run.mjs exits 1 with green rows: exit 1.
   - a missing repeat: exit 1, shown as "not run".
   - run.mjs exits 130 (interrupted): exit 130.
   - `no files` with exit 0: exit 1 ("No summary").
   - repeat 1 with no `(run N)`: exit 0.
   - a stray line inside the rows: exit 1.

   SIGINT and SIGTERM sent to the step's shell mid-run ended it at once with 130 and 143, and the EXIT trap reaped both burners. A cancelled run ends cancelled or red, never green, and the hosted VM is thrown away. No case was green when a file failed, timed out, or never ran. When run.mjs's rows are truncated, its exit code is the backstop: any non-ok result makes it exit 1. No case was red when everything passed, including load 0.
3. **Concurrency.** The group is per ref and `cancel-in-progress` is false, and each run gets its own VM, so two runs can't interfere. Under GitHub's rule of one running and one pending run per group, a newer queued run cancels the pending one. A daily schedule can't overlap itself. Dispatches on main can cancel a pending scheduled run, though, and a queued schedule can drop a pending dispatch. Either one shows as cancelled, never green (B1).
4. **The supervisor's condition (m-20261115-174531437) on the final file.** Met:
   - top-level `permissions: contents: read`;
   - no `secrets.` and no `environment:`;
   - a concurrency group;
   - `timeout-minutes: 240` on the only job;
   - triggers `schedule` and `workflow_dispatch` only.

   231113c removes only the push trigger and its defaults. The proving runs 43743793354 (at 3203cec) and 43743999609 (at bb5c7d4) both concluded `success` on `push`, checked read-only. Neither the workflow nor test/run.mjs changes between 3203cec and bb5c7d4.

## Findings

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| B1 | Minor | docs/devteam/governance/quality.md §3 (Minor); ruling m-20261115-174531437 (concurrency group) | .github/workflows/test-stress.yml, `concurrency:` | GitHub allows one running and one pending run per group. On main, a second queued run (a dispatch, or the cron) cancels the one already pending, so a daily scheduled run can be dropped by dispatches on main made while another run is in progress. It shows as cancelled, not green, and dispatches on branches use their own groups. Worth a comment line, or a group that includes `github.event_name`, so the schedule never shares a queue with dispatches. |  |
| B2 | Minor | spec Risks ("Injection is ruled out by env-only inputs, the word and pattern checks"); quality.md §3 (Minor) | .github/workflows/test-stress.yml, the `not a test file path` echo | A refused `files` word is echoed raw inside `::error::`. Newline, CR and tab are refused first, so it can't start a new workflow command. But the runner unescapes `%0A` in the annotation text, so a dispatcher controls a multi-line annotation. The task-1 fix (T1-1) left the value out of the repeat and load messages for this reason. This message could do the same, or print only the word's position. |  |

Verdict: APPROVE 231113c5a95bb24f2a97de38448367888941ff7e
