# Task 2 review, pass 2

- Reviewer: task-reviewer-2b (fresh subagent, claude-opus-5-5)
- Reviewed: db8afcd0b1eb4e3b4934350ceaab687969dc8893 (Task 2's fixes, the commit db8afcd)

T2-1..T2-7: all confirmed fixed. For each one I reverted or mutated the fix in the review worktree, ran `t.sh 24 test/run.test.mjs`, saw it fail, and restored the file with `git checkout`:

- T2-1: the old unanchored `CHROME_DYNAMIC` fails 1 test (run.test.mjs is `rest`). `node test/run.mjs --list --group chrome` lists exactly the six files with a top-level `import … from './lib/chrome.mjs'` (browser-view-page, dashboard, hub-overview, next-step, operator-threads, pane-question). No `test/lib/*.mjs` helper or other test file names chrome.mjs, and run.test.mjs is not in the list.
- T2-2: the mean fails 2 tests, and the lower middle on an even count fails 1.
- T2-3: `relOf` returning a bare relative path (`../…`) fails 1 test, and `path.join(root, file)` for every file in `planRun` fails 1.
- T2-4: deleting the `endsWith('/' + file)` branch fails 1 test.
- T2-5: deleting the tie-by-path comparator fails 1 test.
- T2-6: the loose `/['"]\.\/lib\/chrome\.mjs['"]/` in place of `CHROME_DYNAMIC` fails 1 test. Dropping the `^\s*` anchor from `CHROME_STATIC` fails 1.
- T2-7: putting back the `\#`-only unescape fails 1 test. Unescaping in one pass is right for `\\\#` (it gives `\#`).

Suite at db8afcd: `t.sh 18` passes 21 of 21 and `t.sh 24` passes 22 of 22. The review worktree is clean.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T2-2-1 | Minor | spec "Groups" (chrome is a file whose source imports `./lib/chrome.mjs`) | test/run.mjs:95 | The new `CHROME_DYNAMIC` needs the line to have no quote before `import(`. A real dynamic import with a string earlier on the same line is now missed, and the old regex caught it. Probed with `groupOf`: `test('drives', async () => { const c = await import('./lib/chrome.mjs'); });` and `if (process.env.X === '1') await import('./lib/chrome.mjs');` both come out `rest`. No kit file is written that way today (the six chrome files all use a static import), so nothing is misgrouped now. The heuristic, and the case it gives up, should be written down: say it in the comment, or pin it with a test. A file written that way later would land in the rest job without a word. | |

Verdict: APPROVE db8afcd0b1eb4e3b4934350ceaab687969dc8893
