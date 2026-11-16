# Plan review, pass 2

- Reviewer: plan-reviewer-2 (fresh subagent, claude-opus-5-5, cold confirm)
- Reviewed: d74d44d7ae3f062148fac5c711b94754880bff0c (plan.md, diff since 1264243)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| — | | | | No new findings | |

**P1-1: confirmed fixed.** In test 3's table, the duplicate-name row is now `['test']`, green first read (`[run('test')]`), then a fresh read `[run('test'), failed('test')]`, then `/test is failure/` (L76). Today's first-read check (devteam.mjs L5000-5010) passes a green first read, so the gate block is reached. The list branch of `forgeCoverage` ("any entry with that name not `SUCCESS`") then gives the expected why. Review focus 2 cites this row.

**P1-2: confirmed fixed.** Step 4 no longer claims a chain-step run on the box. Global constraints (L34) says that on Node 18 the `devteam kit` chain is skipped, so CI is the only evidence for it. New test 12 (L89) pins the first-read refusal through `merge`. Its patterns, `/the forge's checks failed at \w{12}: test \(failure\)/` and `/still running at \w{12}: test; wait for them/`, match today's messages at L5008-5009. It also asserts one `pr view` and `ran()` false. The gate block is skipped when `fails` is non-empty (L5135), so `ran()` false is reachable. The TL;DR risk bullet says the same.

**P1-3: confirmed fixed.** Review focus 1 (L40) now says a lowercase `state` is uppercased, so it reads as green, which matches the spec and today's code. The pin is placed in test 3's table, through the fresh read:
- `COMPLETED` with `conclusion: null` gives `/test is pending/`.
- A CheckRun with no `status` gives `/test is pending/`.
- A StatusContext with `state: 'success'` is covered, so `ran()` is false.

The `rollupState` interface (L55) maps an empty result to `'PENDING'`. That fixes the empty-state why. It leaves today's loop unchanged, because `''` was already in the pending list at L5005, and the failing message never sees it.

**P1-4: confirmed fixed.** Step 3 (L99) runs `R.git(['diff', '-z', '--name-only', '--no-renames', base, sha])` itself, as `deployingFiles` does (L4913-4915). It says why `changedFiles` is not used. A null `base` or a null diff gives "cannot tell what the PR changes", which covers nothing.

**P1-5: confirmed fixed.** TL;DR bullet 2 names `forgeCoverage(coveredBy, rollup, ignored)`. Bullet 1 names the quality.md §2 paragraph and the three clauses (quality.md L24, quality.md L121, supervisor.md L127). Global constraints (L32) and T2 list supervisor.md as in scope. The ruling m-20261115-204936899 is recorded, and the "if granted" branches are gone (grep finds 204658302 only inside that ruling's citation). The rest of the TL;DR matches the plan:
- The fail-closed list in bullet 3 matches Step 3's order.
- Bullet 4 (real and `--dry-run` merges, gate lines counted) matches T1.
- Bullet 7 (test 12) matches T1.

**P1-6: confirmed fixed.** The four points are each handled:
1. `gh(views)` resets its counter, its call log and the marker (L65).
2. Each row calls `setGate(gate, extra)`, which goes through `F.lines` (committed and pushed), and `extra` carries `ignored_checks` (L64, L69).
3. `before = gateLines()` is taken per row and checked against `before + 1`.
4. Log assertions match by regex because of the `-R usbclub/console` suffix.

I checked that `appendLog` for a `gate` line has no dry-run guard (the `dry` return is at L5193, after the gate block), so `gateLines() + 1` is reachable under `--dry-run`.

**P1-7: confirmed fixed.** Both the `'ci'` branch and the list branch lowercase the state in the why (L58-59).

**P1-8: confirmed fixed.** In the loop, the shape check runs first, "whatever `fresh` is" (L104). Test 9 covers `'yes'`, `[]`, and `'yes'` under forge `git`.

**P1-9: confirmed fixed.** Test 2 is a real merge and asserts that the act's `what` contains `(test)`. Tests 4-7 each assert `gateLines()` +1.

**P1-10: confirmed fixed.** Review focus 4 says chore merges never reach the gate block, and no test is claimed. This matches `!chore` in the condition at L5135, which this plan leaves unchanged.

**P1-11: confirmed fixed.** A missing `pr.number` gives `{ why: 'no PR to read' }` (L98). That check comes before the re-read, so no `gh pr view undefined` call is made.

**F2-1 (spec-2): confirmed fixed in the plan.** The plan states the fail-closed rule F2-1 asked for. A null merge base (`R.mainRef() ? R.git(['merge-base', …]) : null`, as at L5138) covers nothing, and so does a failed diff. Both give "cannot tell what the PR changes" (L99). The TL;DR repeats it: "a PR whose changes can't be listed … cover nothing".

I checked the diff against devteam.mjs at this head:
- `viaGit` is at L4950.
- `pr.number` comes from the first read's `--json number,…` at L4961.
- `isObj` is at L8008.
- `S.ignored_checks` is read at L5000.
- `out` and `warn` exist.
- The act's `what` is built at L5214, where the appended `; gate … covered by …` fits.

The plan adds no new Critical or Important problem. Step 2's list of which tests fail on today's code (1-7 and 9) holds for each test. Every new test name contains `covered_by`.

Verdict: APPROVE d74d44d7ae3f062148fac5c711b94754880bff0c
