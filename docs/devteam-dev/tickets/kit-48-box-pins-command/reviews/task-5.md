# Task review, Task 5 (help and the KIT_VIEWS comment), pass 1

- Reviewer: task-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: 4df78edff3a3c2ff2d1f9467d952f82a3e4685da

I read `git show 4df78ed` for `docs/devteam/scripts/devteam.mjs` and `test/machine.test.mjs` against plan Task 5, spec Dispatch and done-when 6, and checked the help lines against `cmdBoxPins`, `BOX_TOOLS`, `BOX_PINS_USAGE` and `pinsFile`. I also ran the new help test, and it passes.

- **Done-when 6.** Both comments above `KIT_VIEWS` are amended. The first drops "read-only". The second names `box-pins bump` as the one writer and says it rewrites only cloud/Dockerfile's pins. The help line says "Only the top package of the npm and PyPI tools is pinned: their dependencies resolve when the image is built".
- **No file added.** `git diff --diff-filter=A origin/main...4df78ed` adds files only under `docs/devteam-dev/tickets/kit-48-box-pins-command/`. Every other changed file is in touches (`docs/devteam/scripts/devteam.mjs`, `test/machine.test.mjs`).
- **Help matches the code:**
  - The six tools match `BOX_TOOLS`.
  - The hold form (`# hold: <reason>` above the `_VERSION` ARG) matches the spec and the parser.
  - Check's exit codes 1 (stale), 3 (unknown) and 0 match the code.
  - Bump's "sums from the downloaded assets" and "stamps the release" are true.
  - The line for `installed` is true: it runs each tool at its absolute image path, never through PATH, and compares against `DEVTEAM_BOX_TOOLS`.
- **The test** asserts every pattern the plan names. Its regexes are a little stricter than the plan's.

None of the findings below blocks. All are Minor.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec Dispatch (`--dockerfile` names the file for verify, check and bump) | devteam.mjs:19505 | The help writes `[--dry-run]   [--dockerfile p]   in the kit's own checkout: ...`. The help uses three spaces to separate a command's syntax from its description, so here `[--dockerfile p]` reads as part of the description column, and it looks like it belongs to bump alone. `BOX_PINS_USAGE` says it right: "(verify, check and bump take --dockerfile <path>)". | fixed: '(each [--dockerfile p])' sits with the flags |
| F2 | Minor | spec check (exit 2 for a file that can't be checked; Dispatch exit 2 for a missing file) | devteam.mjs:19505 | The help lists check's exits as "1 stale, 3 some unknown, 0 none" and leaves out 2: a missing file, or a file with a structure problem. A caller that gates on the exit (the playbook, kit-51) and reads only the help would miss that case. | fixed: check's exit 2 is in the help |
| F3 | Minor | spec done-when 6 / Dispatch (comment reads true) | devteam.mjs:426-428 | The comment says the views "run there as they always did". `box-pins` is new to them. It also says bump "rewrites only cloud/Dockerfile's pins", but `--dockerfile p` makes it rewrite any file it is given, through a temp file beside that file. Both statements are near true but loose. Something like "its views run there over no tickets; only `box-pins bump` writes: the pin ARGs of the Dockerfile it is given (cloud/Dockerfile by default)" would read true. | fixed: the comment no longer says 'as they always did', and says bump rewrites the pin ARGs of the Dockerfile it is given |

Verdict: APPROVE 4df78edff3a3c2ff2d1f9467d952f82a3e4685da
