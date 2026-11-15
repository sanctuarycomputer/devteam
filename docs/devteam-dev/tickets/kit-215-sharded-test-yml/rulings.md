# kit-215 rulings after approval

spec.md and plan.md are approved at ac48e8a, and editing them would void that, so rulings that came after are recorded here and carried into verification.md.

## m-20261115-205742695-supervisor (re m-20261115-205640096)

"approve-spec and approve-plan at ac48e8a. Branch protection: main has no required status checks (the protect-main ruleset is deletion, non-fast-forward and PR only), so dropping kit (<n>, rest) breaks nothing. Don't make 'tests' required; that's an owner change for later. Do check that scripts/devteam-ci-green.sh and devteam-dev's kit-merge-pr gate accept the new job set (all jobs green at the head, whatever their names), and test it. Build once kit-212 merges."

What this changes:

- Done-when 4's protection part: the supervisor quotes protection with no required status checks. So every required check is one this workflow provides (there are none), and no gate-change question is needed. `tests` is not made required.
- An added check, done in Task 2 and recorded in verification.md. Neither gate looks at job names:
  - `scripts/devteam-ci-green.sh` requires every job of the newest `test.yml` run at the sha to be `completed/success`.
  - `scripts/kit-merge-pr.mjs`'s `checksRefusal(list)` requires every `gh pr checks` entry's bucket to be `pass`. A skipped check is not `pass`, and this layout skips no job.

  The tests:
  1. `gate ci -- sh …/devteam-ci-green.sh <green head>` exits 0, and `sh …/devteam-ci-green.sh <failing commit's sha>` exits 1, naming `kit (18, chain)` and `tests`.
  2. A script in this folder (`gates-accept.mjs`) imports `checksRefusal` from `/data/home/code/devteam-dev/scripts/kit-merge-pr.mjs`, reads `gh pr checks <n> -R sanctuarycomputer/devteam --json name,state,bucket` saved at the green head, and exits 0 only if `checksRefusal` returns null. It does the same for the checks saved at the failing commit and exits 0 only if it gets a refusal. Each saved file holds 17 test.yml entries, plus any other workflow's checks.

## m-20261115-214100201-supervisor

"kit-212 has merged. Start Task 1 (merge origin/main into your branch first)." Merged at 5aa69bc; main now has 73 test files.

## m-20261115-214228505-supervisor

Review rounds are capped (trial a-20261115-214153204, lesson k-20261115-214154316): after a second round of any spec, plan or final review, Minor findings are fixed and disposed with no further pass; a third pass only confirms a Critical or Important fix, covering only that fix.
