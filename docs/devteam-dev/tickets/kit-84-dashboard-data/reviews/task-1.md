# Task 1 review, pass 1

- Reviewer: task-reviewer-1 (fresh subagent, claude-opus-5-5)
- Reviewed: 0590ca7271027db009e517ace26be201a40e29d6

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1-1 | Minor | spec §2 (the rule: "never contains a one-word class id as a whole word"; "no bare id ever shows, a one-word id included") | docs/devteam/scripts/devteam.mjs:1191 | The fallback lowercases a made-up class and turns hyphens into spaces, so a made-up class built on a one-word known id shows that id as a whole word. Probed: `drain-all` gives "Unnamed kind (drain all)", `DRAIN` gives "Unnamed kind (drain)", `Recovery` gives "Unnamed kind (recovery)". Each breaks the whole-word rule for `drain`/`recovery`. The brief exempts made-up classes from `noId` (they are checked by exact value), and spec §2's own fallback causes this, so the code matches the brief. It is still a gap between spec §2's rule and the fallback. Fix, if the supervisor wants it: rule that the fallback's text is exempt, or keep a case-variant of a known id mapped to its known name. Either way, record it so a later display check does not trip on it. | |

Checked:
- Spec §2 fields present: `CLASS_WORDS` beside `RUNG` (devteam.mjs:1135), `RUNG_PLAIN` with the design's words (:1130), `className`/`withClassName` (:1191-1192), with null for null/undefined and `Object.hasOwn` so prototype names fall back. `class_name` is on `ooda.acts`/`decisions`/`trust`/`answered` (:12092-12100) and on each `ooda.classes` entry. The rung label is `${className(t.class)} to ${RUNG_PLAIN[e.rung]}` (:12105). `class_words` (:12121) and `questions` go through `withClassName` (:12123). `learning_marks` reads the original `trust`, so its `history` is unaffected.
- Class set completeness: I reran the test's scan independently in a scratch script against the worktree's devteam.mjs and constitution. 52 classes, 52 keys, none missing and none extra. Every `class === '<literal>'` comparison in devteam.mjs is a key in the map.
- Names spot-checked against usage: `pane-answer` (devteam.mjs:1282, "answering what the supervisor's terminal asked"), `carry-answer` (:10691), `worker-slots` (:2104), `orient-noise` (:9171), `goal-impact` (:2120), `registry-attest` (:5930), `goal-hold` (:10777), `one-way-door` (constitution reasons). Each name is plain and accurate. The one-word ids (`recovery`, `drain`, `undrain`) never appear in any name.
- Tests verify real behaviour. The self-test edits the fixture's own kit copy, drops only the `'goal-order':` line inside the `CLASS_WORDS` block, and asserts `missingNames` is exactly `['goal-order']` (test:119). That can only pass if `dashboard-data` runs the edited copy, so the test does prove a missing name is caught. The copy is restored, with an undo guard. `noId` matches the brief exactly (case-insensitive equality, plus the whole-word regex; ids are only `[a-z0-9-]`, so they need no escaping). It is applied to every `class_words` value, to every known-class `class_name` across the six lists, and to rung labels. Each list must hold at least one known-class row, so the check cannot pass on empty lists.
- Edge cases: `Rollback2` and `rename-column` are asserted by exact value (test:103-104). The rule row has `class_name: null` (test:105-107). A classless row must have `class_name: null`.
- Nothing is written: the log bytes are compared before and after both reads, including the read under the edited copy (test:122).
- Files touched are devteam.mjs and test/dashboard-data.test.mjs only. `blocked`/`blocked-on-owner` are untouched by the diff.
- Focused run at 0590ca7, clean tree: `timeout 900 node .../devteam.mjs gate test -- node test/run.mjs --concurrency 2 test/dashboard-data.test.mjs` exited 0 ("gate test passed in 4.2s").
- Already escalated, not judged here: test/ooda-learning.test.mjs:130 still asserts the old label, and the G1 golden (Task 7).

Verdict: APPROVE 0590ca7271027db009e517ace26be201a40e29d6
