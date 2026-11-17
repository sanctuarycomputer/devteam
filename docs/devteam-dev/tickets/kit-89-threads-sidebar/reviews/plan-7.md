# kit-89-threads-sidebar: plan review 7

- Reviewer: fresh subagent of the kit-89 worker

I reviewed `plan.md` at 15b74154665370255a681fe36ce43953234b1b97 against `spec.md` at the same commit, the ticket's touches and done_whens, the rulings, `quality.md` §3 and §6, and `worker.md` §4. I also read the code it builds on: `index.html`'s `tlEl`, `tlOwn`, the Escape handler, `tlCardFrame`, `tlCardBody` (`#tl-c-acts`), `tlCard`, `tlSend` (`pending-N`), the draft store, and the click handler (Resolve opens the `tlResolveForm`, then `[data-tl-resolve-go]` acts; Reopen acts). In `test/dashboard.test.mjs` I read 3330–3380 and 3495–3515.

Every plan-6 finding is resolved in the text:
- P6-1: T2 Step 1 asserts Resolve visible in `#tl-c-acts` and presses it on the + thread. T3 clicks Reopen in the in-panel card.
- P6-2: T2 Step 3 carries the `pending-N` words to the real id.
- P6-3: ~3509 joins ~3346 on `[data-tl-back]`.
- P6-4: T2 checks the focus on `G`'s row after its click, and Step 3 sends a focus removed by a pane draw to the current row, else the selected tab.

The new T2 Step 3 items match spec §2.4 and §4: the `.tl-card.in-panel` rule hides `#tl-c-title` and `[data-tl-close]` and shows `#tl-c-acts`, and Pin closes the panel first at 900px and below. The TL;DR has seven bullets. Nothing changes `devteam-layout`, `devteam-shell-js` or `threads-core`'s functions. Every file named is in touches, and every AC maps to a task.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P7-1 | Minor | spec §2.4 (only `#tl-c-title` and `[data-tl-close]` hidden; `#tl-c-acts` shown); plan-6 P6-1 | T2 Interfaces ("`.tl-head` hidden, no `role`"), T2 Step 1 ~3346/~3509 bullet ("its `.tl-head` with `[data-tl-close]` is hidden") | T2 Interfaces still says `.tl-head` is hidden. That is the pre-S7-1 wording, and it contradicts Step 1 and Step 3. A builder who reads Interfaces first would hide Resolve and Reopen. Step 1's "Resolve visible in `#tl-c-acts`" assertion would catch it, so this is Minor. Change Interfaces to "`#tl-c-title` and `[data-tl-close]` hidden, `#tl-c-acts` shown", and the ~3346 bullet to "its `[data-tl-close]` is hidden". Also, "pressing Resolve … resolves it" is two clicks: `[data-tl-resolve]` opens the form, and `[data-tl-resolve-go]` acts. | wont-fix here, Minor at the approving pass; settled in build T2: Interfaces read as Step 3 (#tl-c-title and [data-tl-close] hidden, #tl-c-acts shown); Resolve pressed as two clicks ([data-tl-resolve-go]) |
| P7-2 | Minor | spec AC5 (the vm and Chrome tests keep what they assert); `dashboard.test.mjs` 3508–3510 | T2 Step 1 ~3509 migration | Two things at ~3509 need saying. (a) The test opens the subjectless `X` by calling `tlOpen('X')` directly, with no panel open. Its migrated `[data-tl-back]` exists only when the route has `th=open&t=X`. So `tlOpen` for an in-panel thread must go through `thGo` (or the test opens `X` from its row). Otherwise the click misses. A failing test would surface this. (b) The test asserts "no element made from the title" with `#tl img`. Once `X`'s card is in `#th-card-slot`, and its hostile title is also drawn in the pane's back-arrow row and in `#tl-list`'s row, that query looks at none of them, so it passes without checking anything. Widen it to `#tl img, #threads img` so the hostile-title check still covers the card and covers the new markup this ticket draws from `t.title`. | wont-fix here, Minor at the approving pass; settled in build T2: ~3509 opens X through the route; its check widened to '#tl img, #threads img' |

Verdict: APPROVE 15b74154665370255a681fe36ce43953234b1b97
