# Task 3 review
- Reviewer: fresh subagent of the kit-89 worker
- Spec compliance: ❌ (§2.5 is built as specified (route order, TH_MADE, the store, the wait on the first read, bad values, talk/ replace, the peek carry), but pins were changed to make history entries. §2.4 says "A pin still opens its thread's card in place (today's `[data-tl-pin]`)", so the spec doesn't force that change, and it reverses two kit-87 assertions, which ruling m-20261115-205924178 keeps)
- Quality: not approved (the code is clean and well tested; the one blocker is T3-1)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T3-1 | Important | Spec §2.4 vs §2.5; ruling m-20261115-205924178 (kit-87 assertions kept) | docs/devteam/dashboard/index.html:7111 (`thPin`), test/dashboard-pages.test.mjs:~485-506 | The brief says the spec is silent on pins, but it isn't. §2.4 says a pin "still opens its thread's card in place (today's `[data-tl-pin]`)". §2.5 lists "a pin" among the changes that make entries. So the spec contradicts itself, and a contradiction doesn't force a change to kit-87's assertions. Three of them were flipped: "and adds no entry" (now n+1), and in kit-87 review T4-1's case, "the hash unchanged" / "history.length unchanged" after B's × (now `#board` and n+1). That case undoes T4-1's fix, which closes a pin's card in place over a `#talk/` entry. Two ways to fix it. (a) Revert `thPin` to `tlOpen(id, false)` and restore those kit-87 assertions and the new file's pin subtest. (b) Get a supervisor ruling that §2.5 overrides §2.4 for pins, and record it in spec §7. The implementer raised this as a concern; it needs a decision before approval. | fixed: 28e1734, pins open in place again (spec §2.4); kit-87's three pin assertions as at 3983aba |
| T3-2 | Minor | Spec §2.5 order (store before draw) | docs/devteam/dashboard/index.html:5143-5146 vs 6172-6196 | `tlRoute` runs inside `routeHead`, before `thRemember`, and synchronously when the thread is already read. So a warm fresh `#talk/<subject thread>` whose stamped page has no keys builds its head before the store is applied, then `thRemember` sees the `t` and skips the store. As a result the panel's remembered `th` isn't carried. A cold load awaits `tlRefresh`, so the store goes first and it works there. The warm case needs the stamp page to disagree with the store, for example after another tab changed the store. Note it, or apply the store before `routeHead`'s talk/ branch. | fixed: 28e1734, the store applied right after the stamp, before a talk/ route; test added |
| T3-3 | Minor | Robustness | docs/devteam/dashboard/index.html:3878, 5132 | `TH_CARRY` is cleared only when a route runs. If `history.go(c.go)` from `closeDrawer` ever lands without a hashchange (none seen today, since a peek's hash always differs from its page's), the carry would apply to a later, unrelated route on the same page. To be safe, clear it on `popstate` when the hash is unchanged, or tag it with the target hash. | fixed: 28e1734, TH_CARRY cleared on a non-routing hashchange and a popstate on the peek's hash |

Checks made (one each):
- The `devteam-layout`, `devteam-shell-js` and `threads-core` blocks are byte-identical between 3983abac and c0326752 (md5 of each marked span); `parseHead` is untouched, and bad values are checked in `thDecide` after it.
- Files: all four changed files are in the ticket's touches (`ticket show`).
- `goHead(…, { replace: true })` stamps before `route()`, so `thFreshness` sees a stamped entry (not fresh). A hash assignment's `popstate` runs the new freshness listener before the stamping one, so `TH_MADE` is told apart from a fresh entry (Review Focus 2 path).
- `tlClose`'s `routed` excludes `#talk/`, so a subject talk/ card's × keeps kit-87's `closeTarget` (with `thWithout` on the in-place case).

Changed assertions, judged against the approved spec:
- dashboard-pages "its stamp's page is the subject's": `#board` → `#board?t=<TT>` (opened here and cold); `#loop?lt=orient` → `…&t=<TO>`; `#sensors` → `#sensors?t=<TM>`. Forced by §2.5 ("a `talk/` link to a thread with a subject … with `t` added to that page head"). Accepted.
- dashboard.test.mjs "the link followed again at once": `#goals` → `#goals?t=<T>`. Same §2.5 sentence. Accepted.
- dashboard-pages pin: "and adds no entry" → n+1, and the hash `#board` → `#board?t=<TT>`. Not forced (§2.4 says in place, today's handler). See T3-1.
- dashboard-pages T4-1 case: after B's ×, "the hash unchanged" (`#talk/<TT>`) and "history.length unchanged" → `#board` and n+1, plus the new asserts after B's pin. Not forced; this reverses a kit-87 review fix. See T3-1.
- Navigation-only changes (closing by × instead of a keyless nav, which now carries the remembered panel per §2.5), and the extra settle wait in "a resolved thread reopens from its card": their assertions are kept. Accepted.

Review Focus 2 (a change under a peek: `history.length` unchanged, `history.state.page` read, Back/Forward keep each entry's own keys, a reload and the peek's close keep `th`/`t`) and Review Focus 3 (a stored `t-nope` gives the list, `t` dropped, store `{th:'open'}`) are both built and tested. AC6 and AC7 and every Step 1 case in the brief are covered by the two new subtests. T3 didn't make the T4 viewer item worse.

Verdict: CHANGES c0326752c800fa299686757fffc075e510a37e22

## Re-review, fix round 1
- Reviewer: fresh subagent of the kit-89 worker
- T3-1: ADDRESSED. The pin click is back to `tlOpen(pin.dataset.tlPin, false)` and `thPin` is removed (no remaining references). `git diff 3983abac 28e1734a -- test/dashboard-pages.test.mjs` no longer shows the pin or T4-1 assertions (`#board` kept, no entry; `#talk/<TT>` unchanged, `history.length` unchanged after B's ×); only the §2.5 `t`-added stamp changes and the navigation-by-× changes remain. The new file's pin subtest asserts in place: hash `#goals` and `history.length` unchanged on open and on close.
- T3-2: ADDRESSED. `thCarry` and `thRemember` now run in `routeHead` right after `stampEntry()`, before any link is opened, so a `talk/` route reads the head with the remembered th. New subtest covers a fresh `#talk/<G>` from a keyless head (state page `#goals?th=open&t=<G>`).
- T3-3: ADDRESSED. `TH_CARRY` is dropped on a hashchange with no DATA, and on a popstate that stays on the peek's hash (`TH_CARRY_FROM`).
- New breakage in the fix diff: none.

Verdict: APPROVE 28e1734a0f0bd523a11d05e8f05f12faeaf1dece
