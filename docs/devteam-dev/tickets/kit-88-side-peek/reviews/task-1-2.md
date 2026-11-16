# Task review: Task 1 "The frame slides", pass 2

- Reviewer: task-1-reviewer-2 (fresh subagent, claude-sonnet-5-5; not the author)
- Reviewed: fix round 46f1c45b..7b60870a3cb4568d115604c13be5347cbd6aaefd (head 7b60870a)

Diff-only confirm of the fix round for REQ1, REQ2, F1, F2, F3, F5. Tests were not re-run: the implementer's report names each covering file with its gate command and exit (peek 15/15, shell 16/16, pages 6/6, dashboard 157/157, exit 0). No hunk falls inside the `devteam-layout` (index.html:46-206) or `devteam-shell-js` (1075-1347) blocks; the hunks are at about 593-620 (page CSS), 1419-1445 and 3662-3680 (page JS). hub.html is unchanged.

| Finding | Verdict | Where |
|---|---|---|
| REQ1 | ADDRESSED | test/dashboard-shell.test.mjs:131 drops `drawer` and `scrim` only; one line changed in that file. |
| REQ2 | ADDRESSED | test/dashboard-pages.test.mjs:~175 `slidIn()` (transform `none`, no running transform transition) is part of `peekOver`'s `until`; no fixed sleep. |
| F1 | ADDRESSED | index.html:~605-612 `#tt-peek` is `display: none` at 840px and below; the `.tt` hide is inside `@media (min-width: 841px)`. test/dashboard-peek.test.mjs:~420 checks 800x800 and 720x800 (not rendered, `.tt` not hidden), then 1440x900. |
| F2 | ADDRESSED | index.html `ttPeekPlace()` sets `top` from `.pagebar .tt`'s rect (setup, MutationObserver, ResizeObserver, resize, `peekShow`); the 1px level check stays. |
| F3 | ADDRESSED | dashboard-peek.test.mjs: (a) preview sets and clears overlay-open (~315); (b) scrim click and Escape each slide out then hide (~300); (c) with no peek `#tt-peek` is not at its point, `pointer-events` none, `.tt` takes the click (~385). |
| F5 | ADDRESSED | index.html:~603 `:where(.shell):not(.peek-open) .drawer { pointer-events: none; }`, outside the blocks, at weight 0,1,0 (`:where`, `:not(.peek-open)` and `.drawer`: the block's `.shell.peek-open` rules only apply when open). Test "a closing peek lets clicks through" reads `elementFromPoint` in the same task as the close click. |

The fix also edits test/dashboard.test.mjs (two waits for the drawer to be hidden or at rest, in the Loop subtest). These follow the slide-out and weaken nothing.

New findings: none.

Verdict: APPROVE 7b60870a3cb4568d115604c13be5347cbd6aaefd
