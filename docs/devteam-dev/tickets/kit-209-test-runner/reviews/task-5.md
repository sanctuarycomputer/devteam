# Task 5 review, pass 1

- Reviewer: task-reviewer-5 (fresh subagent, claude-opus-5-5)
- Reviewed: 2ea163fbdc5fe91bcc52e74e41a1239a89191bbe (Task 5, the commit 2ea163f, and the scripts that built it)

What was checked:

- **File set.** `test/timings.json` lists exactly the 48 `test/*.test.mjs` in `git ls-tree --name-only 23b0cdd test/` (diffed, no extra, none missing). `git merge-base HEAD origin/main` is 23b0cdd. `test/run.test.mjs` doesn't exist at 23b0cdd, so it isn't listed and takes the median (39.7), per A9 / P4-4. origin/main has since moved to f6d12a0, which adds or removes no test file.
- **Run.** `"run": "43691440933"` is recorded. It is test.yml, event push, branch main, head 23b0cdd, conclusion success, and its id is above 43670286370. All 8 jobs (18/20/22/24 × chain/rest) succeeded.
- **Reproduction.** I re-downloaded all 8 job logs into a scratch folder outside the repo and extracted `test/` at 23b0cdd with `git archive`. Then I ran `timings-from-ci.mjs 43691440933 <base> <logs…>`. stdout is byte-identical to the committed file, stderr is empty (no unmatched, no ambiguous, no `no timing`), and the exit code is 0.
- **Method, by hand.** Each rest log (18/20/22) has 508 top-level `ok N - ` lines and 508 column-2 `duration_ms` lines. Each chain log has 3. I checked three files against the logs:
  - `test/kit.test.mjs`: on Node 20 chain, 162688.76 + 28201.18 + 1352.85 ms = 192.2 s. That is the largest of the three chain jobs, and the file says 192.2. `devteam kit` is `{ concurrency: true }`, but its top-level `duration_ms` is wall time, so the sum stays right.
  - `test/bounds.test.mjs`: on Node 18 rest, 685.41 + 1465.43 + 5506.77 ms = 7.66 s. That beats 20 (5.96) and 22 (6.62), and the file says 7.7.
  - `test/registry-no-lines.test.mjs`: 4823.95 ms on Node 22, the largest of 3.67, 4.82 and 4.31. The file says 4.8.
- **Reporting.** On a synthetic root, I checked three cases, each with one top-level test logged at a time:
  - Two files declare the same name: the script prints `ambiguous: same (test/a…, test/b…)` and gives the name to neither.
  - A logged name no file declares: the script prints `unmatched: ghost`.
  - A file with no logged test: the script prints `no timing: test/c…`.

  The script also handles a template name (`${n}` → `.*`), an escaped quote inside a name, a `# SKIP` suffix and the BOM'd first log line.
- **Shards.** I listed the real weights with `node test/run.mjs --list --shard i/n` for n = 2, 3 and 4. Each n covers all 49 files (48 listed plus run.test.mjs), once each, with no duplicates. Weight totals per shard:
  - n=2: 1472.1 / 1470.9
  - n=3: 982.4 / 981.0 / 979.6
  - n=4: 733.1 / 739.5 / 737.1 / 733.3

  No test suite was run.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T5-1 | Minor | plan Task 5 Step 3 ("stderr must list no unmatched name, no ambiguous name … and no file without a time") | docs/devteam-dev/tickets/kit-209-test-runner/timings-from-ci.mjs (end) | The script exits 0 even when it prints `unmatched:`, `ambiguous:` or `no timing:` lines (seen on the synthetic root), and it still writes the JSON. With `> test/timings.json`, the redirect replaces the file before anyone reads stderr. So the Step 3 check depends on someone reading stderr, and kit-217's refresh could commit a partial file silently. A non-zero exit when any such line is printed would turn the check into a gate. This run was clean, so this commit's file isn't affected. | fixed |
| T5-2 | Suggestion | — | test/timings.json `source`; timings-from-ci.mjs header | "24's log has none" is true of `duration_ms` only. Node 24's spec reporter does print a time for each test (`✔ name (1196.79ms)`) and `ℹ duration_ms` totals. "24's spec log has no duration_ms" would be exact. Its jobs add nothing either way. | fixed |

Verdict: APPROVE 2ea163fbdc5fe91bcc52e74e41a1239a89191bbe
