# Final review, pass 5 (confirms final-4 F4-1)

- Reviewer: final reviewer (Claude, fresh subagent), not the author, the fixer or the final-4 reviewer; tree /data/home/code/devteam-dev/.worktrees/review-kit-90-53525b45-final1, detached at 53525b45c5a959bfa536944c9ce70faef73a575f
- Scope: `git diff 68f2d98d..53525b45`: reviews/final-4.md (new), docs/devteam/dashboard/index.html `thSync` (+6 −3), test/dashboard-overview-goals.test.mjs (+21). Diff only, plus the code it calls (`route`, `routeHead`, `stampEntry`, `thFreshness`, `thGo`, `goHead`, the popstate/hashchange listeners at 5447–5453, `tlOpen`'s `TH_MADE` write at 7659).

## Checks

1. **F4-1 is closed.**
   - A fresh entry (a nav link, a typed head) fires popstate synchronously on the hash write. `thFreshness` runs first (listener at 5452), finds no stamp and `TH_MADE` null, and sets `TH_FRESH = { hash, fresh: true }`. Then `stampEntry` (5453) stamps the entry.
   - With the new guard, `thSync` returns on `TH_FRESH.fresh`, so a press in the gap does nothing to TH.
   - The hashchange's `route` then reads `fresh`, and `routeHead` runs `thRemember`, so the remembered panel comes back. `thRoute` stores it, and `devteam.threads.open` is kept.
   - Because `thSync` no longer runs `thRoute`/`thDecide`→`thReplace` on such an entry, final-4's second effect (an entry stamped `{page}`-only by `thReplace` ahead of the router) goes too.
2. **The failure-3 case still works.**
   - `thGo` sets `TH_MADE = next` and then `goHead(next)` (`location.hash = next`). `tlOpen` at 7659 does the same.
   - On the synchronous popstate, `thFreshness` records `{ hash: next, fresh: false }` and clears `TH_MADE`.
   - A press before the hashchange finds `TH_FRESH.hash === location.hash` and not fresh, so `thSync` routes TH to the new head. The press then acts on th/t in force.
   - `goHead(…, { replace: true })` (talk/) uses `replaceState` and calls `route()` at once, so nothing is left pending there.
3. **No new hole.**
   - **Stale TH_FRESH.** It is written only by `thFreshness` for unstamped entries, and only read and cleared by `route` (hashchange, the first data load at 7914, `goHead` replace). While it is set, the guard also needs `TH_FRESH.hash === location.hash`. A later different hash disables it.
   - **DATA null.** If the hashchange skips `route`, a leftover non-fresh `TH_FRESH` for the hash on screen only lets `thSync` run `thRoute`, the router's own part for a non-fresh entry, and the first `route()` at 7914 clears it.
   - **Back to a stamped entry.** `thFreshness` returns early, so `TH_FRESH` is whatever the last `route` left (null), or a pending thGo entry's record whose hash ≠ the entry Back lands on. Either way `thSync` is a no-op, and `route` keeps `thCarry` for a peek closed by Back. This narrows 68f2d98d's comment, which also claimed Back, but routing ahead of `route` there would skip `thCarry` just as F4-1 skipped `thRemember`. Leaving it to the router is the consistent choice, and Back was not part of failure 3. Not a finding.
   - **Link heads (a peek, talk/).** A followed link is a fresh entry, so `thSync` is a no-op. Its stamp's page is already in force via `thHead` → `history.state.page`, because `stampEntry` ran on the popstate. thGo under a link head replaces in place and calls `thRoute` directly; no `TH_MADE` or pending entry is involved.
   - **No-op when TH matches.** The comparison line is unchanged from 68f2d98d (final-4 check 1 holds), and the guard only adds early returns.
4. **The test reaches the real race and catches the bug.**
   - Each half does the hash write and `.click()` in one `p.ev` evaluation, so the click runs after the synchronous popstate and before the queued hashchange. That is exactly the gap.
   - Run at the head: rc=0, `# pass 1`, `# fail 0`, `# skipped 0` (node 22.23.4, own HOME, `--test-concurrency=1`).
   - Mutation, the guard reverted in place to 68f2d98d's `if (VIEWER) return;`: rc=1, `# fail 1`, `# skipped 0`. It timed out at "Overview with the remembered panel", the nav-link half: the panel was closed and forgotten. The tree was restored with `git checkout -- docs/devteam/dashboard/index.html`, and status is clean.
   - The thGo half I checked by reading, not by running (one mutation run allowed). With `thSync` disabled, TH.th stays `open` at the click. `onSelect` sees Threads already selected and calls no `thGo`, so the hash ends at `#overview?th=inbox` and the `soon` for `#overview?th=open` times out. The worker's claim matches the code.
5. **Frozen blocks are unchanged.** sha1 of the `devteam-layout` block is b373f3c2… and of `devteam-shell-js` is be14ac71…, at both 68f2d98d and 53525b45. The only hunk, at 7366–7377, is outside both blocks (46–206, 1210–1482).

## Findings

| ID | Severity | Where | Finding | Disposition |
|---|---|---|---|---|

- Records at a6ac6975 (parent 53525b45; records only, no code): I checked verification.md's race section, plan.md's rulings line and final-4's F4-1 disposition against what I confirmed above. Only the Disposition cell changed in final-4, and the rest of the row is byte-identical. The F4-1 account (synchronous popstate clears `TH_MADE`, the guard reads `TH_FRESH`, the press in the same task, the nav-link half failing with 68f2d98d's guard) matches my reading and my mutation run. The thGo-half-with-`thSync`-off claim matches the code, though I did not run it. CI run 44212973063 is headSha 53525b45, attempt 2, success (`gh run view`). The throttle counts, timings and earlier local runs are the worker's, and I did not re-run them.

Verdict: APPROVE a6ac6975d0fe78eb151e172c17bdbbc0a1de5974
