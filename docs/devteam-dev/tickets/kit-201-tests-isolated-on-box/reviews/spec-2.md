# Spec review, pass 2

- Reviewer: spec-confirmer (fresh subagent, claude-opus)
- Reviewed: 945f4765e4e767e215bac406e8fec15b01de4200

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F2-1 | Minor | spec AC2 | spec AC2 ("`# pass 1`, `# skip 0`, `# fail 0`"); .github/workflows/test.yml:14 | Node's TAP summary line is `# skipped N`, not `# skip N`, so the literal as written never matches. Also, from Node 23 on (CI runs 24) the default reporter is spec even when stdout isn't a TTY, so the child prints `ℹ pass 1` and no TAP at all. Name `--test-reporter=tap` for the child (Node 18.15+ has it) and use the real summary keys (`# pass 1`, `# fail 0`, `# skipped 0`). | |
| F2-2 | Minor | spec AC1 check | test/machine.test.mjs:14; test/operator-threads.test.mjs:19; test/gateway.test.mjs:92 | The widened grep's `delete [a-zA-Z.]*\[k\]` branch still matches lines that stay after the fix: the kept `CLAUDECODE|CLAUDE_*` strips (`delete process.env[k]`, machine:14, operator-threads:19) and gateway:92's unrelated `delete h[k]` (dropping undefined headers). So "finds no denylist" is not a zero-hit check. Either list the three hits expected to remain or tighten the pattern, e.g. require a `DEVTEAM_`/`TMUX` literal on the same line. | |
| F2-3 | Minor | P6; spec "The off switch's limit" | spec "Approaches considered", A and B | The Approaches section wasn't touched and still argues the old premise: B "the real store stays guarded", and A "reopens the hole". The restated limit says B stops only the accidental path and leaves pane answers into the real project log and pane undefended. Align the two bullets with the limit section so the rationale the spec keeps is the true one. | |
| F2-4 | Suggestion | (none) | spec done-when 5; docs/devteam/scripts/devteam.mjs:6618, 13004-13030 | The block to cut for the vm test isn't self-contained. `onBox()` calls `previewBox()` (l.6618, far outside it), `gatewayThreadKey()` uses `crypto`, and unrelated consts (`OPERATOR_PROOF_MS`, the threadKey memo) sit between the box lines. Say that the vm context supplies `previewBox` (or an env-only stand-in) and `crypto`, or that the box lines are first moved together. | |

**F1 (Important, the false premise and the passable HOME guard): confirmed fixed.** The limit section now says what B does: it stops a leaked `DEVTEAM_BOX=off` at the account's own home and nothing more. It names the pane-answer path (`/api/pane-answer`, `pane answered`) and the project log as left undefended, and puts that one line in the PR body, as P6 and the ruling ask. The guard now compares `fs.realpathSync` of `$HOME` and of `os.userInfo().homedir`, which closes the trailing-slash, `/.` and symlink bypasses, and done-when 5 tests the symlink case. R1 holds: normal use, meaning a leaked test env or a confused agent at its real home, can't reach the unsigned path. The remaining stale wording in Approaches is F2-3 (Minor).

**F2 (Important, a proof that can pass vacuously): confirmed fixed.** AC2 now requires exactly one test to run and pass with none skipped or failed, so a skipped incident test or a name pattern that matches nothing fails the proof. The decoy is a `DEVTEAM_RUN` folder the pre-fix kit really writes into, it must hold only its empty `run/` afterwards, and a recorded pre-fix run must fail (red before green). A tmux-less host skips the test, but CI installs tmux (test.yml:31), so the proof runs there. The literal summary keys and the reporter flag are F2-1 (Minor).

**F3 (Minor, denylists the check missed): confirmed fixed in substance.** Gateway's loops at l.723 and l.764, machine:14's regex and operator-threads:19, 67 and 626 are each named with what happens to them, and the grep now catches every listed denylist. It over-matches on lines that remain (F2-2, Minor).

**F4 (Minor, `os.userInfo()` throwing): confirmed fixed.** A throw from `userInfo()` or from realpath, including an unresolvable `HOME`, ignores the switch and fails closed. Done-when 5's matrix covers the HOME cases. The spec says this case is "tested" but the matrix doesn't list the throw explicitly; the plan should carry it.

**F5 (Minor, side effects of importing lib/kit.mjs into gateway.test.mjs): confirmed fixed.** The new Edge-cases bullet names the port block and the comments to update, the tmux shim on PATH and why refusal is what the real-hub test wants, and the three `off` knobs. It also notes that gateway's own `DEVTEAM_HUB_PORT`/`PORT_BASE` settings run after the import and win. Gateway's box tests set `HOME` to a temp folder (gateway.test.mjs:722, 763), so `DEVTEAM_BOX=off` is honored there.

**F6 (Suggestion, `HARNESS_ENV` as a glob vs a list): confirmed fixed.** `HARNESS_ENV` names its five members and the `DEVTEAM_TEST_` prefix, with today's four switches listed.

Values and refusals for the new text: P6 is satisfied (the simpler guard stops the accidental path and names in one line what it leaves undefended). R1 holds (see F1). Nothing in the diff crosses a refusal. No new Critical or Important problem found.

Verdict: APPROVE 945f4765e4e767e215bac406e8fec15b01de4200
