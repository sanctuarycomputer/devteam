# kit-241 verification

At commit ae0e2ac0d214d5022e6c7e472d0d0a90b6680278 (the code and tests as built: f323f8c plus the task-1 T1 test fix d8173e3). Later commits add only ticket records.

| Done-when | Command | Result |
|---|---|---|
| 1. `/api/pane-answer` accepts `escape: true` with no option only on a numbered menu (and only one whose hint says Esc cancels); refused on a dialog and on the usage-limit menu; paneAnswer sends the Escape key; the owner's pane-answer act says Esc and names no option; an Esc that doesn't clear the menu is reported as an option that doesn't land; a numbered option works as today | CI run 43801340374 at ae0e2ac (`test.yml`, every job), which runs `test/pane-question.answer.test.mjs`; locally `sh docs/devteam-dev/tickets/kit-241-pane-answer-escape/t.sh test/pane-question.answer.test.mjs` | CI: success, all 17 test.yml jobs green. The first attempt failed one unrelated job, kit (20, rest 2/2), on the operator test 'a laptop's operator is started once' (observation o-20261116-040526442). Re-running only that job passed. Earlier run 43800084049 at 8456175 (before the T1 test fix): 18/18 green. Local at f323f8c: pass 11, fail 0, skipped 1 (the Chrome page test: no Chrome on the box; it ran in CI's chrome jobs). The tests named "Esc: only exactly …", "an Esc the menu does not clear …", "Esc never reaches …", plus the 5 existing tests, unchanged. After the T1 fix, locally: `PAT='Esc never reaches' t.sh …` pass 1/0, and a mutant without the 'Esc to cancel' requirement fails it |
| 2. Esc is refused as every answer is (role variable, supervisor's pane, no same-origin headers, a digest that isn't the question shown, on a box no gateway signature); the signed body must match escape as well as digest and option; any other key name is refused; `cloud/gateway.mjs` unchanged | same runs; `git diff origin/main -- cloud/gateway.mjs` | pass ("pane answered --owner takes an Esc only from the owner …", "on a box an Esc needs the gateway's signature …"); gateway diff empty |
| 3. `log.schema.json` descriptions say "the option chosen, or Escape" | same runs | pass ("log.schema.json says the pane-answer act and its proof hold the option chosen, or Escape") |
| Regression: the other pane-question files | `t.sh test/pane-question.held.test.mjs test/pane-question.parse.test.mjs` | pass 5/0 and 5/0 |

Local runs use a throwaway HOME (t.sh). On this box, `/etc/devteam/thread-key.pub` and `/opt/devteam/gateway.mjs` otherwise make every fixture act as a box. `boxFilesOff` needs HOME changed (lesson k-20261114-204646621). CI is the gate.

Nothing is deferred to beta.
