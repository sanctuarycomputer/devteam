# kit-172 task review: T1 (`artifact versions`)

- Reviewer: fresh subagent (opus), not the author

I read the T1 brief, the implementer's report (and checked each of its claims against the code), and the review diff 664a974e..0d351036. I also read the approved spec (Approach §1, A1, A2, A5, A6's CLI part, A7, edge cases) and the code around the change in `devteam.mjs`: `git`, `die`, `json`, `mainRef`, `draftWorktree`, `draftArtifacts`, `describeArtifact`, `treeFolderArgs`, `treeNow`, `treeInHistory`, `artifactTreeOk`/`artifactTreeOkSync`, and the `artifact` command's other subcommands. I also read `test/run.mjs`'s grouping and `.github/workflows/test.yml`'s file-coverage check. I ran no tests. I accepted the reported 5/5 pass because no doubt needed a run.

What holds:

- **Scope.** Only `docs/devteam/scripts/devteam.mjs` and `test/artifact-versions.test.mjs` change. In `devteam.mjs` the change only adds code: `artifactTreeOk`, `artifactTreeOkSync`, `artifactAt`, `artifactCsp` and the `/artifact/` route are untouched.
- **Shape.**
  - The answer is `{ slug, versions, truncated }`, and `truncated` is always present (false when there is no ref).
  - A draft is `{ kind, at, worktree, commit, time, fp, url }`. `time` is the draft's `updated_at`.
  - A main entry is `{ kind, at: 'tree:<id>', tree, commit, time, url }`. `time` comes from `%cI`.
  - The usage text and the help line match the brief word for word.
- **Draft commit.** `draftWorktree` returns a real path, and `fs.realpathSync(top) === root` compares it with the real path of what git reports. A null `top` never reaches `realpathSync`. A plain folder gets `commit: null`, because git walks up to main's checkout there. A2 asserts this, so the test fails if the check is removed.
- **Parse.**
  - A line counts only when its path equals the folder exactly and its new (second) mode is `040000`.
  - The first such line wins, then the loop breaks.
  - All-zero trees are skipped, and a tree seen before is skipped, so each tree is kept at its newest commit.
  - The log args are `treeFolderArgs(...).log` plus the format. So every listed tree is one that `treeInHistory` accepts, or main's tree now. Either way `/artifact/tree/` serves it.
- **Landed.** At most one entry can match `nowTree` after the dedupe. Main's tree now is always set by the folder's newest first-parent commit, so log order already puts it first.
- **Filter and cap.** One `cat-file --batch-check` filters the list, with the output lines in input order. The cap of 200 is applied after the zero-tree, dedupe and `artifact.json` filters, and drafts are not counted.
- **Exit codes.** A bad or missing slug gives 1 (`die`), nothing at all gives 3, and success gives 0.
- **The deviation (a failed `cat-file` dies, exit 1): accepted.**
  - Dropping every entry on a git failure would report "nothing there" (exit 3, a 404 in T2). That is the confusion A6 says must not happen.
  - `spawnSync` reports a spawn error or a maxBuffer overrun as `status: null`, and that dies too.
  - This is consistent with the spec: exit 3 is for "nothing there", not for "could not tell".
- **Tests.** Each check fails when its behaviour breaks:
  - **A1:** order, kinds, trees, commits, `%cI` times, the unrelated commit left out, and exactly 3 entries.
  - **A2:**
    - The order flip catches a missing sort, because `draftArtifacts`' own order is by name: 01, then 02.
    - The null commit catches a missing toplevel check.
    - The equal-copy and removed-worktree cases each give no draft.
  - **A5:**
    - (a) catches a missing `artifact.json` filter, because the pre-manifest tree would be listed.
    - (b) catches a missing dedupe.
    - (c) catches a deleted folder hiding the history.
  - **A7:** a `-n 200` commit cap gives 199 entries. A cap before the dedupe also gives 199. Cutting the newest instead of the oldest fails the "last is v2" check. No cap fails the length check.
  - **A6 (CLI):** exit 3 and exit 1 are each asserted.
  - **A1's subfolder check:** it catches only a last-match prefix parse (P3-1). The `wont-fix` disposition of P3-1 already moves this to verification.md as M7, so I add no new finding for it.
- **Style.**
  - The comments follow the file's voice.
  - Sorting on `String(…).localeCompare` is the file's usual pattern (for example 5579).
  - A file that imports `./lib/chrome.mjs` is grouped as `chrome`, as `dashboard.test.mjs` is. CI's coverage check picks the file up from `test/*.test.mjs`.

| ID | Severity | Rule/spec cited | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1-1 | Minor | spec A6 "Fails when … a missing artifact looks like a server error, or the reverse"; the report's own reason for the cat-file deviation | `devteam.mjs` `artifactVersions`: `git([...'log'...]) ?? ''` and `treeNow(git(treeFolderArgs(ref, slug).now, mainRoot))` | **Other git failures still count as "nothing".** The `cat-file` failure now dies, but two other git calls still turn a failure into an answer. If `git log` fails (it returns null, for example on a maxBuffer overrun or a corrupt object), main has "no versions". With no draft, that is a false exit 3. If `ls-tree` fails, `nowTree` is null and main's version is listed as `earlier`, with no `landed`. These failures are rare, and `artifactTreeOkSync` folds failures into null the same way, so this blocks nothing. Fix, if wanted: when `ref` is set and the log or the `ls-tree` returns null, call `die(...)` (exit 1) as the `cat-file` branch does. `git()` returns `''` for an empty but successful result, so null means only failure. | fixed in T2 at 589e79f (git log or ls-tree null with a main ref dies exit 1); tested at 44000dc9 |
| T1-2 | Minor | brief Step 6 ("then log `devteam.mjs phase build --task T1`") | the log | **The build phase is not logged.** The report says the phase line was not written, because the dispatch asked only for a commit. The code is not affected, but the record lacks the phase line. The controller or supervisor logs it before the next task. | fixed the controller logged phase build T1 before the review |

Verdict: APPROVE 0d3510361974ecd2e47a1c7ca8dd82808fd3426d
