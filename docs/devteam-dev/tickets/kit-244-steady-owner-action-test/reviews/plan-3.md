# Spec and plan review, pass 3

- Reviewer: plan-reviewer-3 (fresh subagent, claude-opus-5-5)
- Reviewed: ac0a3e22928ded706febc83ca0ece505adc0aaae (spec.md, plan.md and evidence scripts)

I read review 2, the diff ed092b8a..ac0a3e22 on the ticket folder, spec.md and plan.md, and evidence/mutate.sh and evidence/repro.sh line by line as POSIX sh. I read the Done gate in docs/devteam/dashboard/index.html (l.6235-6275) and the fixture and subtests of test/dashboard-owner-action.test.mjs (l.60-72, l.92-193). I ran mutate.sh's `sed` on a copy of the dashboard in a private `mktemp -d` dir. I ran no tests and did not touch the repo's dashboard.

**G1 is resolved.** In mutate.sh's double-quoted `sed` script, `\&\&` reaches sed as `\&\&`, a literal `&&`, and `\/` reaches it as a literal `/`. The pattern's `.`, `(`, `{` and `;` match themselves in a BRE (`.` matches any character, which is harmless here). On the copy, the diff is exactly l.6262 `if (open.length && !/look at one rule/.test(qv.question)) { NOT_DONE.set(id, open); oaPaint(); return; }`, and it occurs once. `qv` is the `const qv = DATA.questions.find(...)` of the same click handler (l.6250), and it is already used in `isOa(qv)` on the enclosing `if`. The only fixture question that matches `/look at one rule/` is Q3's 'Please look at one rule' (l.66). Q ('Please tidy six records…') keeps its gate, so 'Done waits…' and the controls subtest run as before. Q2 names no record. In the target subtest, Q3's Done press now posts, so `marked(Q3, KC)` never appears and the subtest fails at l.180, `timed out: not done yet`, as the spec and the plan say. mutate.sh checks that the tree is clean first and that `OLD` occurs once. Its EXIT trap runs `git checkout -- "$F"`. It writes the diff (`grep '^[-+][^-+]'` keeps the two changed lines) and the filtered results to `evidence/mutation.txt`, and `|| true` keeps the test's failure from killing the script before the file is written.

**G2 and G3 are resolved.** repro.sh takes `[race|fixed] [node]`, rejects any other variant, copies `repro-<variant>.test.mjs.txt` (the `fixed` source is still to be written, in plan step 3), and removes the copy in its trap with a guarded `rm -f`. It writes `evidence/repro-<variant>.txt`. The rename of `repro-race-at-main.txt` to `repro-race.txt` matches the `race` output name, and no stale reference to the old name is left outside reviews/. The spec and the plan describe the scripts as they now behave.

Nothing new is broken. One cosmetic point, not a finding: the committed repro-race.txt still has one unmasked `127.0.0.1:34363`, from a run before the script's last `sed` mask. A rerun of `repro.sh race` would mask it.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| none | | | | | |

Verdict: APPROVE ac0a3e22928ded706febc83ca0ece505adc0aaae
