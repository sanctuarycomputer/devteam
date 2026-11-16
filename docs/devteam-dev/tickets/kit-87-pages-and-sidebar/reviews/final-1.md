# Final review, pass 1

- Reviewer: final-reviewer 1 (fresh subagent, claude-opus-5-5)
- Reviewed: 794a96d7ad36b031fb348a97cbbc392c114d989d (the whole branch)

I read the rules, quality.md §3, the final brief, spec.md (with its Rulings and Calls made), plan.md, verification.md, the reviews folder and the ticket (`ticket show`). I also read the whole `git diff origin/main...8e2b26a` of `docs/devteam/dashboard/index.html` and of every changed test, the mock's inventory (`project/artifacts/dashboard-cleanup/index.html`, now and at `8e59d9f`, `67fde8f`, `3cb8d6b`) and the gap audit it cites (`project/designs/2026-11-15-dashboard-gap-audit.md`). I checked the following. `8e2b26a..794a96d` adds only verification.md and final-brief.md. CI run 43842117047 has conclusion `success` at headSha 8e2b26a4fb78…, with 17 of 17 jobs green. Every changed file is in the ticket's touches. Main has moved since (release-prep v0.59.1, supervisor scripts-in-files), but only in `cloud/Dockerfile` and `devteam.mjs`, which don't overlap this branch. Both frozen blocks are byte-identical to hub.html (diffed line ranges). No top-level name outside `devteam-shell-js` equals one of its names. The page's old rules for `main`, `.seg`, `.card`, `.card.small`, `.card-head`, `.card.small .card-head` and `.side .foot` are fenced with `:where(.no-shell)`. The interim `SHELL_ROUTES` entries name kit-93 and kit-100. Setting threads are `{kind:'page', view:'#settings?key=…'}`. The kit-85 server's `asked_settings` shape (`value`, `shown`, `label`, `asked`, `act`; 1 to 20 or null) matches what the page reads. `test/dashboard-owner-action.test.mjs` against main changes no assertion. In review worktree `final1` I ran two mutations, one test file at a time, on /usr/local/bin/node v22 with 0 skipped:
- Removing the `popstate` stamp (c4167c3) fails `dashboard.test.mjs` "threads on the dashboard page" #12, "one entry above #goals: 2 !== 1".
- Removing the reserved room under the fleet switch at ≥901px (8e2b26a) fails `dashboard-pages.test.mjs` "settings area", "the switch stays put as the state line takes the reason".

The worktree was removed afterwards.

## Inventory (done-when 5)

Today's page (main's `index.html`):
- Brand: the title and the kit badge with `+local`. It stays in `.side .brand`, unchanged.
- Nav: eleven links, each with its icon, its count element (`n-goals`, `n-questions`, `n-progress`, `n-active`, `n-library`, `n-knowledge`, `n-trust`, `n-retros`, `n-findings`, `n-sensors`) and its hot (red) state. They are now two grouped navs drawn from `registerPage`/`shellPages`, with the same ids and the same `render()` counts, the hot state still set for questions, findings, sensors and a retro due. Trust Ladder is now Trust and Loop is now Self Improvement.
- Sidebar foot (`#when`, `#saving`, `#logline` with the log health words, `#err`): now in `.settings .foot`, at the sidebar's bottom. It is hidden below 900px, as today.
- Banners (`#banner`, `#updated`, `#held`, `#stale`, `#loading`): at the top of `main.page`, with `.stale-note` moved under the page bar.
- Fleet strip:
  - The state and `fleet.reason`: now `#side-state`, the line under the switch.
  - Drain all, Park all with its confirm, and Resume: now the sidebar's fleet switch (Drain; Park with "Confirm park" in place; Run posts resume).
  - Ready or not, the blockers and the parity: now Ready to move? on Settings, while the fleet is held.
  - Check: arriving on Settings runs `loadFleet(true)` (`fetch=1`).
  - On a running fleet, Check's readiness, blockers and parity, and the "park or drain … Check says what a move needs" hint: **missing** (F1).
- `#down-banner` and `#stats`: on the Overview page.
- Goals (the Strategy link, the retro badge, the goal cards with their holds, Unassigned): on the Goals page. The hold's "use the strip" note now says the fleet switch in the sidebar.
- Inbox (`#ask-inbox`, `#questions`, Answered): on the Inbox page. Added: the page bar's Inbox button with the same count. `#questions` redirects to `#inbox`. An open question's `q/` link replaces its entry with `#inbox` and scrolls to its card.
- Progress, Board, Library, Trust, Retros, Health and Sensors (`#monitoring`, holding `#sensors`): each section is its own page, with its content and `h2` unchanged.
- Loop, its learning block and the Observe/Orient/Decide/Act tabs: on the Self Improvement page. The tabs are `lt` history entries. Their memory in `devteam.tab` is dropped by a spec Call.
- The review view, the drawer and its scrim, the artifact viewer: unchanged, now `no-shell`. They close by `closeTarget` or as today.
- The thread layer (pins, Shift-point, cards, drafts, the dock, `talk/` links): in `#tl`, unchanged in look. Pins are drawn per page, and `talk/` opens over the subject's page.
- The tab title count: unchanged (`inboxTitle`).

The mock's inventory:
- Overview, "fleet strip with Drain all, Park all and Check": the switch and Ready to move?, as above. The 10 tiles and the down banner stay on Overview, as today.
- Everywhere: the side peek and every opener, the review panel, the artifact and preview stage, threads, the tab title count, and the stale, updated and held banners. All are kept, as above.
- Sidebar and Settings (kit-87), in four parts:
  - The log health line: kept (`#logline`).
  - The kit badge's `+local`: kept.
  - Red nav counts: kept.
  - "Ready to move? at all times with Check now": **missing**. The card shows only while the fleet is held, with no Check now (F1).
- What changes, for kit-87:
  - The side nav in two groups: done.
  - The settings area at the sidebar's bottom: done.
  - Every page its own view under a sticky page bar: done.
  - The worker limits on Settings: done.
  - Self Improvement: done.
  - A page header that spans the window, with the button at the top right: done, as the Inbox button until kit-89.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Important | done-when 5; the mock's inventory, "Sidebar and Settings (kit-87): Ready to move? at all times with Check now"; gap audit row "Fleet strip … Check now" (Keep in reduced form: "the owner checks readiness before parking to move machines, not only after"; owner, thread t-20261115-194652602) | docs/devteam/dashboard/index.html:2893 (and :1361) | `readyCard` returns nothing unless `fleet.mode` or `fleet.op` is set. On a running fleet the owner can no longer see readiness, the blockers or the parity, which today's Check showed, so they can't check before parking. Arriving on Settings still fetches `/api/fleet?fetch=1` and draws nothing from it. The spec followed the mock at 8e59d9f; the inventory changed one commit later (946760603) and no ruling or review took it up. Showing the card at all times conflicts with no done-when. The inventory's "Check now" button does conflict with done-when 3's "no button", so the supervisor rules on the button. | fixed in 8f405c7: Ready to move? shows at all times with Check now (fetch=1), per ruling m-20261116-095757248 and amended done-when 3 |
| F2 | Minor | ruling m-20261115-201614084 (navigation-only edits in this file) | test/dashboard-owner-action.test.mjs:92, :114, :179, :184 | The added lines wait for the fonts and for a redraw without the answered card. They are flake waits, not navigation. Every assertion is unchanged, so what the ruling protects holds, but the edit falls outside the ruling's wording and has no ruling of its own. | wont-fix: the supervisor accepted the test-only waits, no assertion changed (m-20261116-095757248); kept minimal for kit-244 |
| F3 | Suggestion | none | docs/devteam/dashboard/index.html:2779 | `drawFleet` compares `el.innerHTML` with the builder's string. The browser serialises some things differently (`disabled` as `disabled=""`, `&#39;` as `'`), so while the switch is busy or shows an error, or the reason has a quote, the slot is rewritten on every redraw. A click that spans a rewrite would be lost. A cached string, as `drawSettings` keeps in `SET_DRAWN`, avoids that. | fixed in 8f405c7: drawFleet compares with the last string it wrote to each slot, with a test that the switch node survives redraws while busy |
| F4 | Suggestion | spec §8 ("1 to kit-85's maximum") | docs/devteam/dashboard/index.html:2958 | The limit's maximum, 20, is hard-coded. It matches the server today but isn't read from it. | wont-fix: 20 is the server's own allowlist bound (askableValue, 1-20); /api/data serves no bound to read |

Verdict: CHANGES 794a96d7ad36b031fb348a97cbbc392c114d989d
