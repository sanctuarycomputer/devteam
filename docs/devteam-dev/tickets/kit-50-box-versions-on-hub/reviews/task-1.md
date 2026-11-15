# Task review, Task 1, pass 1

- Reviewer: task-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: 7e278feef7d9422a0f64229cb5379b635ab6ac18 (ba2194d..7e278fe)

Read the diff (cloud/gateway.mjs, test/gateway.test.mjs) against spec §1, acceptance checks 1 and 5, and plan Task 1. Ran `node --test --test-concurrency=2 test/gateway.test.mjs`: 73/73 pass. This ran on the box with `DEVTEAM_KIT_RELEASE` and `DEVTEAM_BOX_TOOLS` set in the ambient env, which shows that `cleared()` isolates the existing whole-object `deepEqual` and the new tests. No `gateway.mjs serve` child was left running afterwards.

What holds:
- `boxImage` matches §1: trim, the token rule, first duplicate kept, ENV order, `null` only when both are empty.
- `opts.env` is read once, at L870.
- The six existing `/box.json` fields are byte-for-byte unchanged, `box: 1` is kept, and `image` is added.
- The start line goes through `boxImage` and prints `none`, never `null`.
- The two variable names appear only inside `boxImage`. The Task 0 comments don't spell them out.
- The tests use temp dirs under the file's `tmp`, which is removed on exit, and the child is SIGTERMed and awaited in a `finally`.

Mutation testing, on a scratch `git archive` copy run with `--test-name-pattern`:
- 12 mutants were killed: the duplicate-keep check dropped, the release not trimmed, the length cap at 65, `opts.env` ignored, no null return, the start line printing `null` or removed, the release or the version unchecked, `image` dropped from the route, the split on `' '` only, and an extra read of a variable outside `boxImage`.
- 2 mutants survived:
  - removing `BOX_TOKEN.test(name)` (F1);
  - printing the start line inside the listen callback instead of before `listen` (F2).

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Important | spec §1 ("each kept only if both halves match"), acceptance 1 ("a bad token in each"), quality.md §3 (mutation) | test/gateway.test.mjs:2867 (boxImage direct cases); cloud/gateway.mjs:175 | No test covers a tool *name* that breaks the token rule. Deleting `BOX_TOKEN.test(name) &&` leaves all 73 tests passing, so a name such as `\u001b[31m=1` or `<b>=1` would reach `/box.json`, and later the page and `machine status`, with nothing failing. Every bad pair in the test fails on its version or on `i > 0`. Fix: add a pair with a bad name and a good version (for example `\u001b[31m=1` and `<b>=2`) to the `full` case, keeping the expected object as it is. | fixed |
| F2 | Minor | spec §1 ("writes one line to stdout at start, before listening") | test/gateway.test.mjs:2887-2909 | The serve test reads the image line regardless of where it is written, so writing it inside the `listen` callback passes too. The code is right today, at L2457 before `listen`, but nothing pins the order. One option is to assert that the `image:` line comes before the `gateway: … on :` line. | fixed |
| F3 | Minor | spec §1 (pairs kept when both halves match the token form) | cloud/gateway.mjs:172-176 | A pair named `__proto__` matches the token form but is silently dropped, because the assignment goes to the prototype setter: `boxImage({DEVTEAM_BOX_TOOLS:'__proto__=1 gh=2'})` returns `tools: {gh:'2'}`. It is harmless, since nothing is injected, but it differs from the spec. `Object.create(null)` or `Object.defineProperty` would keep the pair, or the spec could say that the name is excluded. | fixed |

Verdict: CHANGES 7e278feef7d9422a0f64229cb5379b635ab6ac18
