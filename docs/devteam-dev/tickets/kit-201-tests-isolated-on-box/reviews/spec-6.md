# Spec and plan review (scope change), pass 4

- Reviewer: rulings-confirmer-2 (fresh subagent, claude-opus)
- Reviewed: 4aefda145e235e363a73894c0891588bad0ae00a

Read: spec-5.md, the diff e9cae13..4aefda1 (spec §6 and §7; plan Task 3 Steps 1 and 3b), and the re-exec block in devteam.mjs at 4aefda1 (lines 34-56). I also checked every `cpSync(kit…)` in test/. I ran no kit commands or tests.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| S6-1 | Important | m-20261114-224904663-supervisor ("a kit copy nested in a home without its own .git must not resolve that home"); spec §7 | spec §7 "`<script folder>/../../../.git` doesn't exist (the copy isn't its checkout's own `docs/devteam`)"; plan Step 3b; devteam.mjs 44 | The new test only checks that a `.git` exists three levels above `scripts/`. That is not the same as "the copy is its checkout's own `docs/devteam`", though the parenthetical says it is. The old §7 compared the script with `<show-toplevel>/docs/devteam/scripts` by real path, and the new test is looser. Example: a copy made with `cpSync(kit, <home>/vendor/kit)` has no `.git` of its own, and its script is at `<home>/vendor/kit/scripts/devteam.mjs`. Three levels up from `scripts/` is `<home>`, which has a `.git`, so the check passes. The copy then takes home's common dir and re-execs into home's kit if its bytes differ, or else resolves home itself. Either way it runs against home's project and live log, which is what the ruling forbids. Every current fixture copies the kit to `<repo>/docs/devteam` (test/lib/kit.mjs, chain.mjs, components, dashboard, gateway, dev-links, machine), so nothing hits this today. But the spec's guarantee as written is false, and the fix is cheap. Also require `realPath(<script folder>/../..) === realPath(<show-toplevel>/docs/devteam)`, using `execFileSync`, which the failing branch already does to get `top`. Or replace the `.git` test with that comparison. Then add a test with the copy at a non-`docs/devteam` depth-2 path in home, such as `<home>/vendor/kit`. | fixed: compares the real path of <top>/docs/devteam/scripts with the script folder; tested with <home>/vendor/kit |

Notes:

- S5-1: fixed in substance. The check is now in the re-exec block, before `kitMain` and the re-exec. It uses `execFileSync`, not `git()`, so there's no TDZ on `gitReadCache`. The plan adds the case where the copy differs from home's kit (a line appended), which is what exposes the re-exec path. The looser mechanism is S6-1.
- S5-2: fixed. The spec and plan both assert the exact prefix `DEVTEAM_RUN=<app-api>/docs/devteam/run is not inside this kit's home (<app>): `. The plan's `<api>` is the `app-api` fixture. The spec also adds `log` to the refused commands. (Side note, not a finding: say whether the message prints real or given paths. On a box whose tmpdir is a symlink, the exact-prefix assertion depends on that. It will show up at red/green.)
- S5-3: fixed. `linked` has origin `https://github.com/me/linked.git` and is named in home's settings.md as `links.linked` (kind repo, remote `me/linked`, path), so `cwdRepo()` resolves it as a link. Home's run log is checked for the phase line, the gate line and both sends. The spec says the same in §6, Must not break.
- S5-4: fixed. The nested-copy clause is gone from "Not defended".
- S5-5: fixed. §7 says a kit in no git checkout skips the check (`common` is null). The code and plan match. The optional test wasn't added, which is acceptable.
- Rest of the re-exec block: a home worktree's copy (`.worktrees/x/.git` is a file), the kit's own repo, review worktrees and the box's `/opt/devteam/kit` all still pass or skip as before. When the command is missing, the check is skipped and help prints. That's fine.

Verdict: CHANGES 4aefda145e235e363a73894c0891588bad0ae00a
