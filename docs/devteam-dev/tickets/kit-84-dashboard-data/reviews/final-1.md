# Final review, pass 1

- Reviewer: final-reviewer-1 (fresh subagent, claude-opus-5-5; has not seen the build)
- Reviewed: 760b1ccd2b573170ebc751639bb588b24342fabb (the whole branch against origin/main, PR #283)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Important | spec §1 (`differs`: "`true` when another commit touched it after that [sync commit]"; `null` when it can't be told) | docs/devteam/scripts/devteam.mjs:5198 | `differs` is `!syncs.has(c.sha)` whenever any sync exists, so a kit file whose newest first-parent commit comes *before* every sync commit reads `true` / "changed here", though nothing touched it after a sync. Reproduced on a scratch repo: `init` with its default `upstream_base: null`, commit; then one sync commit setting `upstream_base` to v0.1.0 and changing only `process/worker.md`. `governance --json` shows worker.md `false` and every other governance and process file `true`, "changed here", with no local edit anywhere. The same happens when the kit files were committed before the commit that set the base. The spec treats null-base projects as real (acceptance 1, case B), and syncing one is the next step. No test covers a file that is older than the first sync. Fix: when the file's newest commit comes before the oldest sync in the walk, set `differs` to `null` (unknown, like the no-sync case) or `false`. Add a case to the governance test: a null-base project, then a sync. | fixed at f2cbb5b: a kit file whose newest commit is older than every sync reads differs: null (no known release to compare); the governance test syncs a no-base project once and every untouched kit file reads null |
| F2 | Minor | done_when 3 ("for a blocked item with no question"); L-TEST (a test must fail when the property breaks) | docs/devteam/scripts/devteam.mjs:11988; test/dashboard-data.test.mjs:202-214 | No test covers the planner's "no question" condition. Mutating `&& !H.get(key)` away, so a planner held by an open question would still raise blocked-without-question, leaves the whole test file green (mutation M14 below). The test covers the ticket version of this condition (line 189). Add one assertion: a planner with an unanswered `blocked` message *and* an open question on its goal raises no finding. | fixed at f2cbb5b: a planner with a blocked message still held by its goal's open question raises no blocked-without-question; removing the held-by check fails it |

Checked:
- The rules and records I read: quality.md §1 and §3, the ticket (6 done_whens, 4 touches), spec.md, the plan's Rulings, verification.md, pr-body.md. I read the full code diff `origin/main...760b1cc` (devteam.mjs +368, test/ooda-learning.test.mjs one line), the code around each change, and the whole of test/dashboard-data.test.mjs.
- Touches (point 9, checked by hand): the changed files are only devteam.mjs, test/dashboard-data.test.mjs, test/fixtures/g1/dashboard-data.txt, test/ooda-learning.test.mjs and the ticket's own folder. Nothing project-specific landed in the kit: a grep of the added lines for project or owner names finds nothing.
- Point 7 (rulings): I listed every supervisor `ruling` and `answer` message in the log that mentions kit-84. Each one addressed to this ticket (194943086, 195732788, 201425507, 201932691, 204216783, 214159708, 221458499, 222112817, plus the 225737345 info) is in the plan's Rulings section. The others are addressed to kit-85, kit-87, kit-89, kit-205 and plan-dashboard-cleanup. The worker's own build calls are listed too.
- Point 8: no new suppression of any kind (eslint-disable, ts-ignore, biome-ignore, noqa, c8/istanbul ignore, doctrine-exception) among the added lines.
- I ran these in the review worktree at 760b1cc, made with `review-worktree … --name final1` and removed afterwards (exit 0):
  - `gate test -- node test/run.mjs --concurrency 2 test/dashboard-data.test.mjs`: exit 0, 6 pass, 0 fail.
  - The same gate for `test/ooda-learning.test.mjs`: exit 0.
  - `gate test -- node --test --test-concurrency=2 --test-name-pattern '^G1' test/components.test.mjs`: exit 0, 1 pass.
- CI: `gh run view 43774458123` shows attempt 2, conclusion success, 17 of 17 jobs succeeded, headSha a527fcdcf00f7b22ff5d19387207b53048c2db9c. `git diff --stat a527fcd 760b1cc` shows only verification.md (+26).
- G1 golden (ruling m-20261115-201425507), checked two ways myself:
  - (a) Of the 32 `-U0` hunks, each of the 30 removed lines comes back as the first added line of its hunk, unchanged except for an added trailing comma (0 mismatches). The other 655 added lines are new keys only: `class_words`, `threads`, `upkeep_days`, `settings_all` at the top level, `held_by` on rows, `class_name`.
  - (b) I parsed the old and new goldens as JSON and dropped those six new keys from the new one. Its key-ordered `JSON.stringify` is byte-equal to the old one, the old golden had none of the keys, and the `exit 0`/stderr wrapper is unchanged.
  - So in substance the ruling's "additions only" holds.
- Security:
  - settings_all is built by allowlist (shownAs): `value` keys only pass a per-key shape plus `scrubText`/UNSAFE_TEXT, `names` keys pass through the scrubber too, `count` shows a number, and `hidden` shows null. `local` and `default` go through the same function. A withheld local is compared by its raw value only and never output. A key with no words is hidden.
  - Planted credentials are covered on main, in the working tree (a), (b) and (c), and in a sensor id.
  - /api/governance runs `execFile(process.execPath, [self, 'governance', '--json'])`: a fixed argv, no shell, inside the same handler as /api/timeline.
  - Every new read is a read. Each test compares the log files byte for byte before and after its reads.
- Class ids: I scanned devteam.mjs myself for hyphenated ids on any line mentioning "class" that have no CLASS_WORDS entry. The 17 hits are question kinds, observation kinds, sources, authorities, message kinds and `let-go`, none of them a decision class. Every class in the constitution block is named.
- Unchanged behavior:
  - The `blocked-on-owner` and `blocked` (high) branches are textually unchanged. The new finding is an `else if` after them, limited to under an hour with nothing holding the ticket (`h < 1 && !H.has(id) && live(id)`).
  - `hello` gains only `threads`. `/api/hello` gains only `threads: hello?.threads ?? null`. Its other keys and their order are unchanged.
- I ran governance on a no-local clone of this instance, with the review build's script, a private HOME and DEVTEAM_* unset: exit 0 in under 1s. Every kit file reads `false`, strategy is written, exterior is "not written yet", and there are 14 settings.md commits in the walk.
- Mutations: each was made in a private `git archive` copy of 760b1cc, run with `node --test --test-name-pattern <its test> test/dashboard-data.test.mjs` under a private HOME with DEVTEAM_* unset. The baseline passed.
  - These made the test fail (exit 1):
    - M1, held_by order reversed
    - M2, `!H.has(id)` dropped from the ticket finding
    - M3, `live(id)` dropped
    - M4, scrubText dropped from plainSettingText
    - M5, any `release` accepted
    - M6, upkeep dedupe removed
    - M7, `you` checked before `ready`
    - M8, the shallow check ignored
    - M9, any settings.md change counted as a sync
    - M10, no lowercasing in className
    - M11, `names` keys not scrubbed
    - M12, `threads` dropped from hello
    - M13, `/api/hello` not forwarding threads
    - M15, retro-* chores counted
    - M16, `local` never set
    - M17, the planner held_by loop removed
    - M18, let-go questions holding items
  - It survived (exit 0): M14, `!H.get(key)` dropped from the planner finding. That is F2.
- Code quality: I found nothing else that would block a merge. `settingsAll`'s `own()` repeats settingsAt's block regex because it needs the raw block rather than the defaults-merged one. That is small and commented.

Verdict: CHANGES 760b1ccd2b573170ebc751639bb588b24342fabb
