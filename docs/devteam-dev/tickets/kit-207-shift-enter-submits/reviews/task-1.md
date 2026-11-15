# Task 1 review

- Reviewer: task-reviewer 1 (fresh subagent, claude-opus)
- Reviewed: f190cf46fc2511db0484e871078e71e47884cf76 (task 1, from cba441b)

Only `docs/devteam/dashboard/index.html` and `test/dashboard.test.mjs` change. The listener's early return is the exact De Morgan negation of the plan's key rule (Enter, Shift, no Ctrl/Alt/Meta, not composing, keyCode ≠ 229). `submitOf` returns `null` for any box but `#tl-c-text`, and the key is then left alone, repeats included (spec-3 R1). `preventDefault` runs on every matching key, and `tlSend` runs only when `!e.repeat`. The placeholder matches exactly. All ten `p.key('Enter')` sends are now `p.key('Enter', 8)` (540, 544, 2266, 2395, 3201, 3242, 3255, 3338, 3813, 3970; none are left bare), and the "Enter sends the first words…" subtest is renamed. I read each guard against the new subtest. Plain Enter fails under the old listener, because the box would be cleared and sent. The lone `autoRepeat` keyDown fails without `!e.repeat` (a post) or without its `preventDefault` (a second `\n`). Composition, 229 and Ctrl each fail without their guard, as a post caught by `posts()` after the 2.5 s settle. Each check first asserts that its event arrived (`window.__keys`). `posts()` reads the fixture's own `window.__posts` (test:350), whose urls are bare `/api/...` paths, so the anchored regex matches. Comment density and naming fit the surrounding code. The threads test passed alone (33/33) at f190cf4. I made no mutation copies, so the bite of each guard is established by reading the code, not by running mutants.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1 | Minor | quality: tests pin each guard | test/dashboard.test.mjs, the new thread-box subtest | No check covers the Alt and Meta guards (only Ctrl is driven). The plan asks for none, and they share Ctrl's code path. | accepted: Alt and Meta take the same early return as Ctrl; not driven |
| T2 | Minor | quality: comments say what is true | test/dashboard.test.mjs:3104-3106, the `enter` helper comment | "a newline lands unless the page cancels the key: Shift, Ctrl, a key repeat, or 229" reads as if those are what the page cancels. They are the helper's options. Better: "…unless the page cancels the key. Options: Shift, Ctrl, a repeat, keyCode 229 (…)". | fixed in task 2: the comment names them as the helper's options |

Verdict: APPROVE f190cf46fc2511db0484e871078e71e47884cf76
