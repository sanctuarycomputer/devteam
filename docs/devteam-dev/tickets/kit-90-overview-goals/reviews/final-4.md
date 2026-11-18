# Final review, pass 4 (delta since 8cd73123)

- Reviewer: final reviewer (Claude), not the author or the fixer; tree /data/home/code/devteam-dev/.worktrees/review-kit-90-68f2d98d-final1, detached at 68f2d98d0961cdaf7aa8e4c8a5205171d93015d8
- Scope: `git diff 8cd73123..68f2d98d`: docs/devteam/dashboard/index.html (+15 −1), test/dashboard-inbox-panel.test.mjs (+2). I checked the debugger's account (.superpowers/sdd/plan/inbox-race-report.md) against the code.

## Checks

1. **Fix A (`thSync`)**: partly correct, with one regression (F4-1).
   - **Steady state, a no-op.** After `thRoute`, TH.th is the head's th filtered by TH_LISTS, and TH.t is the head's t after `thDecide` has normalised the head. `thSync` compares the same two values the same way, so it calls nothing when TH already matches the head in force. An unknown t that is still being asked about stays in both the head and TH, so it matches too.
   - **No loop, no extra history entry.** `thRoute` → `thDecide`/`thRouted`/`thStore` never calls `thGo` or `thSync`. `thSync` never pushes; at most, `thDecide` calls `replaceState`. `VIEWER` returns early, which is right, because the /view/ tab keeps TH in memory only.
   - **No deliberate state overridden.** TH.th and TH.t are written only in `thRoute` and in thGo's VIEWER branch (grep `TH.t = `, `TH.th = `), so nothing else holds an intentional TH that differs from the head.
   - **Order inside thGo.** `thSync` runs before `TH.focus` is set, so the `thShow` it triggers doesn't use up the press's focus.
   - **The failure-3 path checks out.** tlClose → thGo writes `#goals?th=inbox`, and TH_MADE matches it. A tab press in the gap now routes TH.t to null first, so the tab's thGo no longer carries Q's t.
   - **The regression (F4-1).** `thSync` also runs the router's part ahead of `routeHead` when the head in force is a fresh entry: unstamped and not TH_MADE, for example a nav link `<a href="#board">` (line 1526). On such an entry, `route` has to read freshness, apply the remembered panel (`thRemember`) and stamp the entry before `thRoute` runs. `thSync` skips all three.
2. **Fix C (`.drawer { scrollbar-gutter: stable; }`)**: correct.
   - The rule sits at index.html:615, page CSS outside devteam-layout.
   - It applies because the block gives `.drawer` `overflow-y: auto` (line 179).
   - On overlay-scrollbar platforms (macOS default, touch phones) it changes nothing.
   - With classic scrollbars, a short peek keeps a 15px gutter painted in the drawer's own `--surface` background. It shows no empty strip of another colour. The only visible trace is the sticky `.drawer-head`'s bottom border stopping 15px short of the right edge. That is cosmetic and consistent whether or not the peek scrolls, which is the point of the fix.
   - The drawer is `min(720px, 100vw)` with `box-sizing: border-box`, so its width is unchanged at 1440, 720 and 390. Only the content box is 15px narrower, and only where classic scrollbars exist.
   - No script measures the drawer's clientWidth. kit-88's `ttPeekPlace` places the mirror from `.tt`'s top, not from the drawer. kit-100's panel (`#threads`) is a separate element, so the rule doesn't reach it.
3. **Test change**: adds one wait (`soon("!document.querySelector('#ask-inbox [data-ask]')", …)`) after `window.__pane = null` at line 954, before "Open the review". No assertion is removed or loosened. It follows the pattern of the file's earlier `__pane` writes. The supervisor allowed it (m-20261118-000840933).
4. **Scope.**
   - Both frozen blocks are byte-identical at 8cd73123 and at 68f2d98d (sha1 of the `devteam-layout` block b373f3c2…, of `devteam-shell-js` be14ac71…).
   - All diff hunks (lines 609–615, 7361, 7366–7377, 7386) are outside both blocks.
   - `ticket show kit-90-overview-goals` lists both docs/devteam/dashboard/index.html and test/dashboard-inbox-panel.test.mjs in touches.
5. **Test runs**: none by this reviewer, on the coordinator's instruction, because the box takes one Chrome run at a time and the worker is running them. Every claim that needs a run (dashboard-peek, dashboard-threads-sidebar and dashboard-inbox-panel at rc=0 with 0 skipped; the CI conclusion at 68f2d98d) rests on the worker's runs and CI, which the worker will add to verification.md. The throttled 10-of-10 count in the debugger's report predates the test change and doesn't cover failure 1.

## Findings

| ID | Severity | Where | Finding | Disposition |
|---|---|---|---|---|
| F4-1 | Medium | docs/devteam/dashboard/index.html `thSync` (7373–7377), called from the `#th-tabs` onSelect (7361) and `thGo` (7386) | **What happens.** `thSync` runs `thRoute` whenever TH differs from the head in force, including on a *fresh* entry whose hashchange is pending: no stamp, and not TH_MADE, for example a nav-link press `#board` with the panel open. `thRoute` then runs ahead of `routeHead`'s freshness read, `thRemember` and `thCarry`. `thRoute` sets TH.th to null, which closes the panel, and `thStore` calls `localStorage.removeItem('devteam.threads.open')`. When the hashchange then runs `route`, `thRemember` finds nothing stored, so the panel stays closed and its memory is gone, for this visit and later ones. **How it shows.** With the panel on Threads, press a nav link, then the Threads tab in the gap (the same input-before-hashchange window this fix targets). The tab press closes the panel: `thSync` makes TH.th null, and `onSelect` then sees "threads" already selected and calls no `thGo`. Before the delta, that press did nothing and `route` re-applied the remembered panel. **A second effect.** If `thDecide` rewrites such a head, `thReplace` stamps the entry with `withPage(null, …)` = `{page}` only, so `thFreshness` later skips the entry as stamped and leaves TH_MADE set. **Suggested fix.** Make `thSync` leave an unstamped entry that isn't TH_MADE to the router: it is fresh, and only `route` can decide it. Alternatively, route it the way `route` would (freshness, remember, stamp) without opening anything twice. Add a check: a tab press in the gap after a fresh page-head navigation keeps the remembered panel. | fixed: thSync acts only on thGo's own unrouted entry (TH_FRESH not fresh), so a nav link's fresh entry is left to the router and the remembered panel kept; test 'a tab press before the hashchange acts on the head in force' fails with the old guard (53525b45, confirmed in final-5) |

Verdict: CHANGES 68f2d98d0961cdaf7aa8e4c8a5205171d93015d8
