# Spec and plan review (scope change), pass 2

- Reviewer: scope-confirmer (fresh subagent, claude-opus)
- Reviewed: 3a4cf600e62d0c9ab743976090af4bfea37dc3c2

Read: spec-3.md, the diff 8ffa223..3a4cf60 (spec §6, plan Task 3), devteam.mjs 55-135 and 380-480, test/lib/kit.mjs `bareProject`, the log's messages to kit-201. Everything the plan's check uses is defined before line 463: `command` (59), `flags` (84), `die` (99, and its `queuedNudges` at 114), `realPath` (393), `mainRoot` (459). One probe, in the scratchpad with `env -i` (no inherited `DEVTEAM_*`), then deleted: a fixture built the way `bareProject` builds one, then `status` run with no `DEVTEAM_RUN`. It exits 0, and `docs/devteam/run` still doesn't exist afterwards.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| S4-1 | Important | quality §3 (a disposition that doesn't fix its finding); S3-4 | plan Task 3 Step 1 "seed each run with `status` (no `DEVTEAM_RUN`)" | `status` writes nothing into the run folder (probe above), so seeding with it leaves `docs/devteam/run` missing. Three things break. The `api` snapshot's `readdirSync` throws, or, if it is written to tolerate a missing folder, "byte-for-byte unchanged" covers an empty folder only, which is what S3-4 asked to avoid. The symlinked-run case can't "move" an `app-ln/docs/devteam/run` that doesn't exist. The symlink to `app`'s own run points at nothing. Fix: seed with a command that writes a log line (`observe --subject x --kind other --detail seed`, which the pass-1 probe showed creates `run/log/…`), and say so in both spec and plan. | fixed: seeded with observe |
| S4-2 | Important | owner/supervisor instruction first (constitution §6); m-20261114-224640331-supervisor | spec §6 "Taken: … from a third repo's checkout with `DEVTEAM_HOME`"; plan Task 3 Step 1 "linked-repo case" | The supervisor answered S3-6's report at 22:46:40, 16 s after this commit. The answer adds a must-not-break, with a test, and asks for it in the spec's acceptance: a worker on a repo link (cwd in the link's worktree, `DEVTEAM_HOME`=home, `DEVTEAM_RUN`=home's run) keeps working for every command it uses (`phase`, `send`, `check-ticket`, `gate`, `merge-request`). The spec and plan cover a plain `git init` repo, which is neither a link in `app`'s settings nor a worktree, and they test only `observe` and `status`. Fix: in spec §6 and plan Task 3, make the case a repo link of `app` (named in its settings) with the worker's cwd in a worktree of that link, and run those five commands, or as many as can run in a fixture, naming any left out and why. Pass means none of them is refused by the guard. | fixed: the link worker's must-not-break is in acceptance 6 and its own test |
| S4-3 | Minor | quality §3 (weak assertion); S3-7 | plan Task 3 Step 1 "includes `app-api` and `app`" | `app` is a substring of `app-api`, so "includes `app`" always passes, and `\(.*\)` doesn't check which root the message names. Assert the exact text instead: `DEVTEAM_RUN=${apiRun}` and `(${app})`, or their real paths. | fixed: the test asserts the home as '(<app>)', the exact path in parentheses |
| S4-4 | Suggestion | consistency | spec §6 "with `app`'s `docs/devteam/run` a symlink"; plan "a fresh `bareProject(base, 'app-ln')`" | The spec and plan name different fixtures for the symlinked-run case. The plan's choice, a fresh fixture, is the better one; make the spec say the same. | fixed: the spec names the plan's fresh app-ln fixture |

Notes per pass-1 finding:

- S3-1, fixed. A run whose real path equals `realPathMade(<mainRoot>/docs/devteam/run)` is taken, and the symlinked-run case tests it. That test depends on S4-1.
- S3-2, partly fixed. The home-worktree case is there. The linked-repo case is a plain repo, not a link's worktree, and the supervisor now asks for more than that (S4-2).
- S3-3, fixed. `r === root || r.startsWith(root + path.sep)` is separator-bounded, and `app`/`app-api` catch a bare prefix test.
- S3-4, not fixed as written (S4-1). The not-yet-made-folder case is added and is fine.
- S3-5, fixed. The spec and plan exempt `machine`, `operator-thread` and `recover --machine` the same way homeAt does. Plan Step 4 runs the operator-threads and gateway tests as regression cover.
- S3-6, fixed. Reported to the supervisor as m-20261114-224628733, and the answer (m-20261114-224640331) approves the widening, but it brings S4-2.
- S3-7, mostly fixed. The test matches the message text, but the path assertions are weak (S4-3).
- S3-8, fixed. The P6 line is present.
- S3-9, fixed. The spec now says "after home is resolved and before the run folder is read or written", which is accurate.

Verdict: CHANGES 3a4cf600e62d0c9ab743976090af4bfea37dc3c2
