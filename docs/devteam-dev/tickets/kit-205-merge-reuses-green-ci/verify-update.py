#!/usr/bin/env python3
# kit-205: verification.md moves to 0e1f5e3 (main merged after kit-202, final minors in).
# Run from the worktree root. Each replacement must match exactly once.
import sys
f = 'docs/devteam-dev/tickets/kit-205-merge-reuses-green-ci/verification.md'
s = open(f).read()
R = [
("At commit `e188a69d74d48c4847fbe3cad8509f227f3b2a03` (ticket/kit-205-merge-reuses-green-ci, draft PR #281).",
 "At commit `0e1f5e35373c447e723cdaf618af297361fa84df` (ticket/kit-205-merge-reuses-green-ci, PR #281): origin/main merged at 50d62ab after kit-202 (58906d9), and the final reviews' minors in at 8b1a0e7. The first verification was at e188a69 (CI run 43773504520, success on every job)."),
("| pass (exit 0; 15 pass, 0 fail) |", "| pass (exit 0; 16 pass, 0 fail) |"),
("the re-read failing, forge `git`; each writes",
 "the re-read failing, forge `git`, a `--dry-run` with no PR yet (`no PR to read`); each writes"),
("| D2: the tests catch a list judging only the last entry of a name | `sh docs/devteam-dev/tickets/kit-205-merge-reuses-green-ci/mutate-t1.sh` | pass (exit 0: the mutated run fails) |",
 "| D2: the tests catch a list judging only the last entry of a name, and the no-PR guard removed | `sh docs/devteam-dev/tickets/kit-205-merge-reuses-green-ci/mutate-t1.sh` | pass (exit 0: both mutated runs fail) |"),
("| Merge's other tests unchanged | `run-tests.sh test/merge-admin.test.mjs`; `run-tests.sh test/multirepo-landing.test.mjs` (at bc26e57; devteam.mjs unchanged since) | pass (4/4; 7/7) |",
 "| Merge's other tests unchanged | `run-tests.sh test/merge-admin.test.mjs`; `run-tests.sh test/multirepo-landing.test.mjs` (after the main merge, at 8b1a0e7) | pass (4/4; 7/7) |"),
("| D4: test.yml passes on every job | `gh run view 43773504520 --json conclusion,headSha,attempt,jobs` | success, attempt 1, headSha e188a69, all 16 kit jobs and `tests` success |",
 "| D4: test.yml passes on every job | `gh run view 43779379040 --json conclusion,headSha,attempt,jobs` | success, attempt 1, headSha 0e1f5e3, all 17 jobs success |"),
("- m-20261115-214223586-supervisor: review rounds capped",
 "- m-20261115-231734320-supervisor: final reviews start at e188a69; after kit-202 merges and main is merged, one short pass re-confirms the delta only.\n- m-20261116-001140617-supervisor: kit-202 merged (58906d9); merge origin/main (no rebase), fold in the three minors, one delta pass, CI, mark #281 ready, merge-request.\n- m-20261115-214223586-supervisor: review rounds capped"),
]
for a, b in R:
    n = s.count(a)
    if n != 1:
        sys.exit(f'matched {n}x: {a[:60]!r}')
    s = s.replace(a, b)
open(f, 'w').write(s)
print('ok')
