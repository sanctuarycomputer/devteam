# Task 1 review, pass 1

- Reviewer: task-reviewer-1 (fresh subagent, claude-opus-5-5)
- Reviewed: 4111a9a2b11d9e84828450d308639b4d3f420537 (.github/workflows/test.yml, coverage-step.sh)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1-1 | Suggestion |  | .github/workflows/test.yml kit job `name:` | The explicit `name: kit (${{ matrix.node }}, ${{ matrix.part }})` is now load-bearing in a new way: without it GitHub would append every include key (key, groups, shard, alone, gitleaks) to the check name. The old line's comment saying why was dropped and nothing replaces it, so a later edit could remove the name and change every check name. A one-line comment would keep it. |  |
| T1-2 | Suggestion |  | coverage-step.sh `rows=` | The harness carries its own copy of the 16 rows' arguments, so it can drift from the matrix; plan step 4 checks the match by eye only. It matches at this head (checked row by row). Deriving the rows from the workflow's include list would remove the second copy. Not a defect: the CI coverage step itself reads only the jobs' own lists. |  |

What I checked, at 4111a9a:

- Rows. The 16 include rows match spec.md's table exactly: chain on all four majors with `shard: ''`; rest 1/2 and 2/2 on 18 and 20 with `groups: 'rest,chrome'`; rest 1/2, 2/2 and chrome 1/2, 2/2 on 22 and 24; `alone: true` only on the four rest 1/2 rows; `gitleaks: true` on all eight rest rows and nowhere else. Keys are artifact-safe. No cross-product keys, `fail-fast: false`.
- Expressions. `if: matrix.alone` is falsy when the key is absent (null), and the list step's `"${{ matrix.alone }}" = true` renders null as empty, so the list and the alone step agree. `RUN_ARGS` gives `--group chain` for chain (empty shard is falsy) and `--group <g> --shard i/2` otherwise; both the list step and the run step use it, and the alone invocation is the same literal in both. Job-level env may read `matrix`. `DEVTEAM_TEST_GITLEAKS` is `1` exactly where gitleaks is installed (gitleaks.test.mjs checks `=== '1'`). The shard step's `!cancelled()` runs it after a red alone step; the ps step's `failure() or cancelled()` matches spec S1-2.
- tests job. `needs: [kit]`, `if: always()`, `timeout-minutes: 12`; `toJSON(needs)` is `{"kit":{"result":…,"outputs":{}}}` and the matrix job's result is success only when every leg is; the node check also fails on an empty object. Checkout, download and coverage are each `if: always()`.
- Artifacts. upload-artifact@v4 `overwrite: true`, `retention-days: 7`, `if-no-files-found: error`, `if: always()`, placed before both run steps. download-artifact@v4 with `pattern:` and no `merge-multiple` writes `lists/<artifact-name>/list.txt`, the layout the coverage step globs.
- Concurrency. PR runs grouped by PR number and cancelled in progress; push to main (the only push trigger) grouped by run id with `cancel-in-progress` false.
- Timeouts. Both jobs `timeout-minutes: 12`; both run steps 11.
- Lint and grep. actionlint 1.7.12 on a `git show 4111a9a` copy exits 0 (P2-1 done: disable directives inside the block scripts, printf not ls). `grep -c -- '--test-timeout'` prints 0 (exit 1), and a looser `test.timeout or test_timeout` grep finds nothing either (S2-1, P2-2 done).
- coverage-step.sh. Its awk extraction of the coverage step, on the 4111a9a workflow, is byte-identical to the raw block de-indented by hand (diff exit 0). Run (working tree differs from 4111a9a only by the deliberate-failure line in the run step), it exits 0 with the four cases at 0, 1, 1, 1: real lists give 73 files per major from 3, 3, 5, 5 jobs, each once; the duplicate shows `> test/ooda-knowledge.test.mjs` on 22; the missing file shows `< test/kit.test.mjs` on 18; the missing major shows `Node 24: no lists`. `run.mjs --list` prints only file lines on stdout, nothing on stderr, so the first column is the file list.
- Comments read accurate against run.mjs's header (watchdog 300 or 600 s, groups, chrome by import, no node timeout flag passed), lib/chrome.mjs (no WebSocket before 22) and gitleaks.test.mjs.

No Critical or Important finding.

Verdict: APPROVE 4111a9a2b11d9e84828450d308639b4d3f420537
