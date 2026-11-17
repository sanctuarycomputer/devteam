# Final review, pass 2 (delta since final-1 at 6e802253)

- Reviewer: final-reviewer-2 (fresh subagent, claude-opus-5-5)
- Reviewed: ff0a7d9c9b691ea82846f4819a1817faba1ef3a7 (delta: merge 4e6c8151 of origin/main with kit-87, then ff0a7d9 records)

Read: `git diff 6e802253 ff0a7d9 -- test/ docs/devteam-dev/tickets/kit-244-steady-owner-action-test/`, `git show 4e6c8151 -- test/`, and the dashboard's `render()`, `overlaid()` and `drawOrHold()`. Ran in the worker's worktree, which was clean at ff0a7d9, as the brief says. The mutation ran in a `git archive` copy of ff0a7d9 in a private temp directory, so the worktree was never changed.

**Footprint.**
- `git diff 90abe27a ff0a7d9 -- test/` is empty, and so is `git diff origin/main ff0a7d9 -- test/dashboard-owner-action.test.mjs`. Main is now at 90e932b and has other test changes since, but none of them touch this file.
- `git diff 4e6c8151 ff0a7d9` touches only pr-body.md, spec.md (one ruling line) and verification.md.
- The merge's combined diff for `test/` is empty: the conflict was resolved by taking main's side whole.
- The branch now changes no test code and no production code. Only the ticket folder differs from main.

**Is kit-87's `redrawnWithout(q)` an adequate replacement for `settled(q, n)`? (done-when 1, spec F2)** Yes.
- It waits for `!DATA.questions.some((x) => x.id === q) && !card(q)` in the same two places `settled` waited: after Q's answer and after Q2's, before the next card's clicks. It adds no sleep, retry or longer bound.
- `DATA` is assigned in exactly one place: `render(d)`'s first line (index.html:4977). The `d = { ...d, questions: …filter(!ANSWERED…) }` at l.5054 rebinds the local variable only, so `DATA.questions` keeps the unfiltered list.
- `render()` is called from `drawOrHold` with `overlaid(d)` (l.6363-6364). No overlay filters `questions`: the only `questions: …filter` in the file is l.5054. So when `DATA.questions` lacks q, the server's read lacked q. In other words, that read already lists the answer.
- `render()` is synchronous, and it draws in that same call everything the spec F2 worry is about: `#questions`, `#answered-sum`, and `renderOoda(o)` (Goals). The CDP `soon` poll can't run in the middle of it. So when the condition holds, the redraw that moves Goals and the cards has already happened. That is the same event `settled` waited for, and it doesn't need the `n0` base.
- Ran at head: `timeout 300 /usr/local/bin/node --test --test-concurrency=2 test/dashboard-owner-action.test.mjs` gave pass 6, fail 0, skipped 0, with `ok 5 - Done goes through…`.

**Done-when 2, checked from the runs themselves.**

| Run | Workflow / event | headSha | Conclusion | Log |
|---|---|---|---|---|
| 43849681951 | test-stress / workflow_dispatch | 4e6c8151531a8b04c2ed4682b69e3e50d0972cea | success | 5× `# pass 6`, 5× `# fail 0`, 5× `# skipped 0`, 5× `ok 5 - Done goes through…`, no `not ok`, v22.23.4 |
| 43849902735 | test-stress / workflow_dispatch | 4e6c8151… | success | same |
| 43850053023 | test-stress / workflow_dispatch | 4e6c8151… | success | same |
| 43853298644 | test-stress / workflow_dispatch | 4e6c8151… | success | same |
| 43849681986 | test / pull_request | 4e6c8151… | success | `test/dashboard-owner-action.test.mjs … ok` on the chrome lane, `ok 5` present, no `not ok` |

- That makes 20 of 20 on Node 22.
- ff0a7d9 changes no code relative to 4e6c815, so these runs count for head.
- test.yml run 43853629125 at ff0a7d9 was `in_progress` when I checked. That commit is records-only, and the supervisor checks CI at merge.

**Done-when 3 (mutation).**
- I applied mutate.sh's exact substitution, `if (open.length && !/look at one rule/.test(qv.question))`, in a scratch copy of ff0a7d9.
- Result: subtests 1-4 ok, `not ok 5`, `timed out: not done yet`, `# pass 4 / # fail 2`.
- l.188 at head is that `soon(marked(Q3, KC), 'not done yet')`, as verification.md says.
- `evidence/mutation.txt` is unchanged since final-1. Its filtered output has no line numbers, so "byte-identical" is plausible.

**Is it honest and acceptable that the PR changes no test code?** Yes.
- pr-body.md says it in bold, and it says why: kit-87 landed the same wait first, and the merge kept main's version.
- The PR still carries what the done-whens ask of it: the cause (§ The cause, unchanged and still accurate), the repro, 20 stress runs at the merged head, and the mutation.
- Done-when 1 is about the state of the subtest, and that holds at head. `touches` limits what the ticket may change, so changing less is not a breach.
- The PR title ("…waits on the page, not a timer…") describes the merged state, not this PR's diff. That's acceptable, since the body is explicit.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | verification.md accuracy (the record) | verification.md l.5; pr-body.md § The fix | Both call `DATA` "the raw server data" (or "the server data") that `render()` stores. It is actually `overlaid(raw)` (index.html:6363-6364). The conclusion still holds, because no overlay filters `questions`, but the record should say that rather than "raw". | wont-fix: after the final APPROVE only dispositions may change; the conclusion holds as the review confirms (no overlay filters `questions`), and this row records the precise wording |
| S1 | Suggestion | none (no rule cited) | pr-body.md § The fix | Saying in one line why `redrawnWithout` covers spec F2 (Goals is redrawn by `renderOoda` in the same synchronous `render()` that set `DATA`) would let a reader see the F2 concern closed without re-deriving it. | wont-fix: same reason; the review's own text records why the wait closes F2 (Goals redrawn in the same synchronous `render()`) |

Verdict: APPROVE ff0a7d9c9b691ea82846f4819a1817faba1ef3a7
