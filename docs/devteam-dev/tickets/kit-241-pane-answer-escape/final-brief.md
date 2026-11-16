# kit-241 final review brief

PR #288, branch `ticket/kit-241-pane-answer-escape`, code head ae0e2ac (CI run 43801340374 green). Records: `docs/devteam-dev/tickets/kit-241-pane-answer-escape/` (spec, plan, reviews, verification).

Code diff: `git diff origin/main...ae0e2ac -- docs/devteam/scripts/devteam.mjs test/pane-question.answer.test.mjs docs/devteam/schema/log.schema.json`. Look at `paneAnswerShape`, `paneEscCancels`, `paneAnswer` (escape path), the `/api/pane-answer` route, and `cmdPane` answered.

The ticket notes ask you to try two attacks:
- Make anything but the owner's signed press send Escape (strategy R1).
- Get Escape onto a dialog, or onto anything else where it could cancel or exit the session: the usage-limit menu, or a numbered menu whose hint doesn't say "Esc to cancel".

Also check that a signed Esc can't be recorded as an option and a signed option can't be recorded as an Esc, and that the option path is unchanged for the page's real body.

Running tests on the box: use `t.sh` in the ticket folder. It sets a throwaway HOME; without it, the box's /etc/devteam and /opt/devteam files make every fixture a box and the pane tests fail regardless. Run one file at a time at `--test-concurrency=2` (`PAT='<name>'` narrows to one test). Never run the full suite.
