# Plan review, pass 2

- Reviewer: plan-confirmer (fresh subagent, claude-opus)
- Reviewed: bfe8b65ff4f2c606fae8c1cf5ca71c4eea48d53e

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P2-1 | Minor | done-when 4 | plan.md Task 2 Step 1 (env-names test); Task 2 Interfaces `HARNESS_ENV` | The exact comparison leaves out only `DEVTEAM_TEST_*`. `HARNESS_ENV` also keeps `DEVTEAM_FORK_AUDIT` and `DEVTEAM_G1_RECORD`, which pass-1 P2 named, so a developer who has either set gets a false failure. CI doesn't set them (test.yml:53 sets only `DEVTEAM_TEST_GITLEAKS`), which is why this is Minor. The fix is to leave out every `HARNESS_ENV` name the parent holds and the test doesn't set, not only `DEVTEAM_TEST_*`. | |
| P2-2 | Minor | done-when 1 | plan.md Task 2 Step 2b (zero-hit grep); Task 2 Interfaces (the scrub deletes "`TMUX`, `TMUX_PANE`") | The new grep includes `test/lib/kit.mjs`. Its first branch, `'(…\|TMUX\|TMUX_PANE)'\]\) delete`, matches the scrub's own tmux removal if that is written in the files' idiom, `for (const k of ['TMUX', 'TMUX_PANE']) delete process.env[k]`. "Finds nothing" would then fail against the intended code. Either name that line as an expected hit or say the scrub's tmux removal is written in another form. Today the grep finds all nine denylists (I checked at bfe8b65), so it is not vacuous. | |

**P1 (Important, decoy TAP assertions): fixed.** The new assertions hold on every Node major: `# pass 1`, `# fail 0`, exactly one unskipped `ok … - status says at a glance` line, and every other top-level `ok` line a name-pattern skip. The incident test is `{ skip: !hasTmux }` (machine.test.mjs:255), so a tmux skip would print `# SKIP` on that line and fail the check, as AC2 wants. `--test-reporter=tap` is named, which covers spec-2 F2-1's Node 23+ default-reporter point. The Edge-cases line and the Readings paragraph say the same thing.

**P2 (Important, CI's `DEVTEAM_TEST_GITLEAKS`): fixed for CI.** `DEVTEAM_TEST_*` names are left out of the comparison, and `DEVTEAM_TEST_KEEP` is asserted present. A developer with other harness knobs set still gets a false failure; that residue is P2-1 (Minor).

**P3 (Important, AC1 grep not zero-hit): fixed.** Step 2b names the three residual matches (machine:14, operator-threads:19, gateway:92), which I confirmed with the grep. It adds a tighter grep that today catches every denylist, including kit.mjs:95. One self-match risk on the new scrub remains; that is P2-2 (Minor).

**P4 (Minor, fleetFixture denylist): fixed.** kit.mjs:95 is in Task 2's Modify list. It keeps its own `TMUX_TMPDIR`.

**P5 (Minor, cwd): fixed.** The spawn now has `cwd: REPO`.

**P6 (Minor, `files` shape): fixed.** `files = {}` is `{ [boxPath]: text }` throughout, with an example. The stand-ins hold the caller's text, and Step 1 passes `GW_PUBLIC`'s text.

**P7 (Minor, PR body line): fixed.** Task 3 Step 5 gives the ruling's line and the ports.mjs:22 note.

**P8 (Minor, runs outside run-isolated.sh): fixed.** run-as-worker.sh runs only after Task 2's proof passes, and Step 2 says exactly what it sets: a fresh decoy `DEVTEAM_RUN`/`DEVTEAM_HOME`, never home's run. The gate now wraps run-isolated.sh: `gate test -- <cmd>` exists (devteam.mjs `cmdGate`, execFileSync with inherited env), so only the gate record goes to home's run, and the plan says that is deliberate. The script lives under the ticket folder, which the "no file added" constraint exempts.

**P9 (Suggestion, hub-overview real HOME): addressed** in Task 3 Step 2.

Spec-2 minor notes, carried as Readings: F2-1 is in Task 2 (reporter and keys), F2-2 in Step 2b, F2-3 is read as superseded by the spec's limit section, and pass-1 confirmed that Task 1's vm block covers F2-4. I found no new Critical or Important problem in the diff.

Verdict: APPROVE bfe8b65ff4f2c606fae8c1cf5ca71c4eea48d53e
