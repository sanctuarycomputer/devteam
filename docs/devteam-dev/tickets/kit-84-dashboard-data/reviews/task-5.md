# Task 5 review, pass 1

- Reviewer: task-reviewer-5 (fresh subagent, claude-opus-5-5)
- Reviewed: dc52646bd08259277c6815c9706330ac068db014

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T5-1 | Minor | quality.md §3, tests pin the rule | test/dashboard-data.test.mjs:360-367; docs/devteam/scripts/devteam.mjs:5058-5060 | The sync rule's "different from its first parent" half is not pinned. The only settings.md commits in the test are init (null parent, so a sync) and the v0.1.0 to v0.2.0 sync. No commit touches settings.md while keeping `upstream_base`. Mutating `base !== (parent ?? null)` to `true` would still pass, and that mutation turns every settings edit that also touches a kit file into a false "untouched". A commit that edits settings.md and, say, `governance/quality.md` without changing `upstream_base` should read `differs: true`. | |
| T5-2 | Minor | quality.md §3, tests pin the rule | test/dashboard-data.test.mjs:301-327; docs/devteam/scripts/devteam.mjs:5051-5052 | Every fixture history is linear, so nothing tests the reason for `--diff-merges=first-parent` (PRs that land as merge commits). Dropping the flag would still pass, yet on a merge-landed main every file touched only through a merge would read '—'/null. I checked by hand on git 2.39.5 that the code's exact argv lists a `--no-ff` merge with its first-parent names, renamed files under their new names, and that the NUL-split parse holds. So the code is right today, but no test guards it. The old-git `-m` retry is likewise untested (the report says so). | |

Checked:
- Spec §1 shape and order. Governance, then process, each sorted by name, then strategy and exterior under `projectRel`, with rows `{group, path, title, last_change, differs, written, state}`: devteam.mjs:5039-5044, 5066-5084; asserted at test:339-340, 387.
- Ruling m-20261115-225737345. The strategy row's `written` is false when the file carries `STRATEGY_TEMPLATE_MARK`, the same test `strategyState` uses (devteam.mjs:5026 vs 5070). exterior has `template: false`, so it is written once it exists (5044, 5070). Test:348-350 shows the template is on main (ISO `last_change`) and still reads "not written yet". After real text (test:372-380) it reads `written: true` with its own title.
- Review Focus 1 (no upstream_base, strategy only the template, `--project docs/elsewhere`): `syncs` is empty, so every kit row has `differs: null` (5073). Both project rows read "not written yet" (test:394-395). Every git call goes through `git()`, which returns null rather than throwing (devteam.mjs:146-157). readdir sits in a try/catch (5042), and the `?? ''` fallbacks cover a failed ls-tree or log.
- Sync rule: `releaseParts(base)` is set and differs from `settingsAt(c^1, {orNull:true})?.upstream_base ?? null` (5058-5060). On a root or shallow-boundary commit the parent read fails, `orNull` gives null, and the missing parent counts as null, as ruled. Init's null base is not a sync (case B).
- differs: null on project rows, with no sync, or when the newest commit is unknown or shallow; else `!syncs.has(newest)` (5071-5073). state follows `!written`, then `differs` (5081).
- Shallow: `rev-parse --git-path shallow` is resolved against projectRoot, which is also git's cwd for the call (5062-5064). Case D (test:399-405) shows every `last_change` is '—' and every kit `differs` is null.
- Main vs working tree: `main` is set only when `projectInRepo` (5037-5038). Otherwise `readText(path.join(projectRoot, p))`, with no walk, so `last_change` is '—' and `differs` null, which matches spec §1 and the edge case. mainRef/settingsAt use HOME_CWD and the walk uses projectRoot. Those name the same checkout (devteam.mjs:466, 496).
- Path safety: every path goes after `--` (ls-tree, log) or after `<ref>:` (show). execFileSync runs with no shell. ls-tree's `--full-tree` and cwd projectRoot keep paths repo-relative from any cwd.
- Route: `GET /api/governance` runs the fixed argv `['governance', '--json']` through `run()`, in the `/api/timeline` pattern, inside the handler after the Host check (devteam.mjs:15390, 15525-15528). A 500 on failure is reasonable. The test stops the server through the undo list registered in `t.after` (test:299, 414).
- HTTP assertions: `/api/governance` deep-equals the CLI (test:416). `/api/data` has `class_words`, `threads` and `upkeep_days`, with `settings_all` omitted per the ruling (test:417-418). `/api/hello` has numeric `threads.you`, `threads.waiting` and `threads.ready`, per the T3-1 ruling (test:419-420). There is no second server.
- Read-only: log bytes are compared before and after in A (CLI and dashboard reads) and in B (test:382, 396, 421).
- The `COMMANDS` entry and the HELP line match the brief verbatim (devteam.mjs:20290, 20247). It is not in OPERATOR_READS. Only the two allowed files changed (diff stat).
- Did not re-run the suite. The report says the gate run was green (`# pass 5 # fail 0`). Nothing I read raised a doubt that called for a focused run.

Verdict: APPROVE dc52646bd08259277c6815c9706330ac068db014
