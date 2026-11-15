# Task 2 review, pass 1

- Reviewer: task-reviewer-2 (fresh subagent, claude-opus)
- Reviewed: 0c3d2148d0e4f525815c7329b082fb88c16e0e4c

I checked the diff against plan Task 2 and spec acceptance check 1 with ruling m-20261115-051541126, and against the GitHub Actions semantics you listed. I found no Critical or Important issue.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T2-1 | Suggestion | (none) | .github/workflows/test.yml, the `if: failure()` step | Two parts of the step-timeout path have been shown only by the box probe that kills the shell, not on a real runner. One is that the step runs after a real step timeout. The other is that the runner does not wait on the leaked `node --test` runner holding the step's stdout. Spec check 1 accepts the box probe as the evidence, so this does not block. If CI ever shows a hang, read that log to confirm the listing appeared. | |

What I checked, and what held:
- **Matrix include.** The three `include` entries have only `node:` set (numbers, as the matrix has them) and add `test_timeout` as a new key. Under Actions rules a new key joins every existing combination with that node and creates no job. The CI run on this head (43682089828, headSha 0c3d214) has exactly 8 jobs:
  - steps on Node 20, 22 and 24 read `node --test --test-timeout=600000 ...`;
  - steps on Node 18 read `node --test  ...`, an empty expansion, and the Node 18 bounds step already passed with it.
- **Job names.** The explicit `name: kit (${{ matrix.node }}, ${{ matrix.part }})` gives the 8 names `kit (18, chain)` through `kit (24, rest)`. They are the same set as the latest main run (43680146803). Without it, the 20, 22 and 24 names would have gained the flag, so the name comment is accurate.
- **Run lines.** All three `node --test` lines have `${{ matrix.test_timeout }}` right after `--test` and step-level `timeout-minutes: 12`. There is no `--test-force-exit`. The job's 30-minute limit still covers the worst case: setup plus one 12-minute step, and a hung bounds step means the rest step is skipped.
- **Untouched.** The rest step's `env` (`DEVTEAM_TEST_GITLEAKS: '1'`) and the gitleaks install step are unchanged.
- **Failure step.** It is the last step, runs `ps -eww -o pid,ppid,etimes,args` unfiltered, and appears as step 9 in every job. A step that times out is marked failed, so `failure()` is true and this step runs; a job-level timeout or cancel would skip it, but that path is out of scope. `ps` from procps-ng (which supports `etimes`) ships on ubuntu-latest.
- **Comments.** Every claim matches the spec's probe results and its healthy step times:
  - Node 18 rejects the flag (bad option);
  - on 20 and 22 the flag caps a whole file and names it with `not ok - <file>` when it fires first;
  - on 24 it caps only top-level tests and never ends a file held open after its tests;
  - 600000 is above dashboard.test.mjs at about 400 s;
  - the slowest healthy step is about 7 minutes (429 s);
  - a step timeout signals only the shell, so the runner, the file process and its children are still alive.

  The listing comment says which mechanism names the file in which case (spec F3-1). The style matches the file: plain `#` comments with explanatory sentences.
- **CI.** Every job on run 43682089828 was still in progress when I looked, so this verdict does not depend on CI being green. The plan's three-run check comes later.

Verdict: APPROVE 0c3d2148d0e4f525815c7329b082fb88c16e0e4c
