# kit-172 plan review 2

- Reviewer: fresh subagent (opus), not the author

I read the plan at 104fa259, the diff from 7b215386, `reviews/plan-1.md`, the approved spec, `quality.md` §3 and §6, and `worker.md` §3–§4. In `devteam.mjs` I read `git()` (146: strips the trailing newline, null on failure), `artifactCsp` (7174), `draftWorktree` through `draftArtifacts` (8225-8350), `treeFolderArgs`, `treeNow`, `treeInHistory`, `artifactTreeOk`/`Sync`, `artifact describe` and its usage `die` (8483-8497), the dashboard's `run` and `describing` (16062-16068), `/api/view` (16628) and the `/artifact/` route (16757). In `test/` I read `landArtifact` and `VIEWER_MOCK` (dashboard.test.mjs 395), and the `kit.mjs` exports the plan imports (`threadsFixture`, `write`, `freePort`, `startDashboard`, `until`; `cleanup` is in `chrome.mjs`). In a private scratch repo I ran the plan's exact `git log --raw -t -m --first-parent --no-renames … -- a/b/vm` over a commit that changed both `a/b/vm` and a new sibling `a/b/vm-2` (see P2-1).

The P1 findings:

- **P1-1 is fixed.** T2 now fetches every listed url after the delete in A5(c), and asserts 200 with that version's `index.html`. Review Focus 3 says so.
- **P1-2 is fixed.** M6 drops `sandbox allow-scripts` from `artifactCsp`, and A4's "includes `sandbox allow-scripts`" goes red. The row says it is a reverted mutation of existing code.
- **P1-3 is fixed.** The new (second) mode is named, with a regex in `treeInHistory`'s shape.
- **P1-4 is not fixed in substance** (P2-1).
- **P1-5 is fixed.** A null `top` gives `commit: null` before `realpathSync`.
- **P1-6 is fixed for the identity.** The commit command as written still makes no commit (P2-2).
- **P1-7 is fixed.** A7 now has the endpoint-equals-CLI assertion.

What else holds:

- The TL;DR matches the tasks, including M1–M6.
- Every file is inside touches.
- Each task has its Model line, the failing test first, the run command and the expected failure.
- A1, A2, A3, A4, A5(a–c), A6 and A7 each carry the spec's assertions. A6's "CLI prints the same JSON as the endpoint" is covered by the equality in A1, A2, A5 and A7.
- The algorithm is right. I worked A7 through by hand. The distinct trees by newest occurrence are v201..v101, v99 (the revert), v100, v98..v1, which is 201 entries. The slice keeps 200, and the last is v2. Under M2, `-n 200` takes 200 commits, which dedupe to 199, so A7 goes red.
- A deleted folder's `:040000 000000` line fails the new-mode test, so it adds no version. `treeNow` is null when the folder is gone, so A5(c) has no `landed` entry.
- Each of M1–M6 turns its named check red. M5 also reddens A1's url assertion.
- The test counts (5, then 7) add up.

I ran no tests.

| ID | Severity | Rule/spec cited | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P2-1 | Minor | quality.md §3 (a test the plan names must be able to fail); plan Review Focus 5 | plan T1 A1 test ("Land v2 **and a sibling `viewer-mock-2` in the same commit** (so the pathspec keeps the commit, and only an exact-path match keeps the sibling's `040000` line out)"); Review Focus 5 | The P1-4 fix rests on a false premise. A pathspec limits the `--raw` output as well as which commits are chosen, so the sibling's line never reaches the parse, even in the same commit. In a scratch repo, one commit changed both `a/b/vm` and a new `a/b/vm-2`. `git log --raw -t … -- a/b/vm` printed only the lines for `a`, `a/b`, `a/b/vm` and `a/b/vm/i`, and no line for `vm-2`. So "no entry's `tree` is `viewer-mock-2`'s" cannot fail, and a prefix match still passes A1. The lines that do reach the parse besides the folder's own are its parent directories (`docs`, `docs/devteam`, …, all `040000`) and its own subfolders. Those are what the exact `=== folder` match really guards against. Fix: correct the parenthetical and Review Focus 5 to say this. Make the test bite by giving the artifact a subfolder that v2 changes (for example `img/a.svg`), so a parse that keeps every `040000` line under the folder (`startsWith`) gives a fourth entry or a wrong tree. "Exactly 3 entries" and the deep-equal then catch it. The sibling can stay or go. | |
| P2-2 | Minor | quality.md §3 (buildable as written) | plan T1 A2 test ("made with `F.g(['-c','user.email=t@example.com','-c','user.name=t','commit','-qm','wt'], wt)`") | That command, run after `git init` and the draft's files, makes no commit. Nothing is staged, so `git commit` exits 1 ("nothing added to commit"), `F.g`'s `execFileSync` throws, and A2 errors before it asserts anything. Say `F.g(['add','-A'], wt)` first, or add `--allow-empty`. An `add` is better: the draft's files are then committed in the worktree, as a real worker's would be. | |

Verdict: CHANGES 104fa259cfbe30afd7155106f95824503b948287
