# kit-89-threads-sidebar: plan review 6

- Reviewer: fresh subagent of the kit-89 worker

I reviewed `plan.md` at 76c77bfac06890d417a4dcf11f6be2437a374eb9 against `spec.md` at the same commit, the ticket's touches and done_whens, the rulings, `quality.md` §3 and §6, and `worker.md` §4. I also read the code it builds on: `index.html`'s `tlCardFrame`/`tlCardBody` (5251, 5298–5304), `tlCard`, `tlSend`, the draft store, `askDraw`, and the click and Escape handlers. In the tests I read `test/dashboard.test.mjs`'s `POLL_FAST` (327–360, `__threadsHold` at 357), its hold pattern at 3200, and every dock or card-close line (536, 1881, 2534–2564, 3298–3390, 3509, 3597–3635), plus `test/pane-question.answer.test.mjs` 242–245 and `test/browser/dev-links.mjs` 559–560.

Every plan-5 finding is resolved in the text:
- P5-1: T2 Step 3 makes no focus placement for the draft-to-thread change, and Step 1 types "second" after Send and asserts the focus and value.
- P5-2: ~3346 uses `[data-tl-back]`, closes use `#th-close`, and ~2534 closes the viewer first until T4.
- P5-3: Review Focus 4 reuses `POLL_FAST`'s `__threadsHold`/`__threadsLet`, which works with the 3200 pattern (set the hold, `tlRefresh()`, wait for `__threadsRead`, then send). Review Focus 1 waits 11 s and for `__threadsRead`. T3's fresh tab gets its own init script.
- P5-4: 380, or `#threads`' own width.
- P5-5: T0 lists the dock reads in the merged kit-87/88 tests, and T1 moves them, AC8 included.

The TL;DR has seven bullets. Nothing changes `devteam-layout`, `devteam-shell-js` or `threads-core`'s functions. Every file named is in touches; `operator-threads.hub.test.mjs` drives `hub.html`'s own dock and needs no change. Every AC maps to a task.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P6-1 | Important | spec-7 S7-1; spec §2.4 (Resolve and Reopen in the in-panel card), §4 (Reopen shown); `tlCardFrame` (Resolve and Reopen live in `.tl-head`'s `#tl-c-acts`) | T2 Interfaces ("`.tl-head` hidden"), T2 Step 1 first bullet ("its `.tl-head` hidden") and ~3346 bullet, T3 Step 1 ("Reopen shown") | T2 hides `.tl-head` and asserts that it is hidden, which takes Resolve and Reopen out of every in-panel card. T3's "Reopen shown" passes if it is checked by existence, as today's tests check it (`!!querySelector('[data-tl-reopen]')`). Hide only `#tl-c-title` and `[data-tl-close]` in the panel (or move `#tl-c-acts` into the back-arrow row), as S7-1 settles. In T2 Step 1, assert that `[data-tl-resolve]` is visible on `A` in the panel, and press it to bring up the form. In T3, check Reopen by a click on its rect. | fixed: T2 presses Resolve in the panel; T3 clicks Reopen |
| P6-2 | Minor | spec-7 S7-2; today's `tlCard` refills the composer from the new key's draft | T2 Step 3 (+ draft to thread) | The planned test ("type 'second' … value 'second'") fails against today's `tlCard`, since the pending key's draft isn't carried to the real id. Say so in Step 3 (carry the composer's value, or the `pending-N` draft, to the real id) so the builder doesn't read the failure as a test problem. | fixed: T2 Step 3 carries the pending-N words |
| P6-3 | Minor | each task's runs pass; `chrome.mjs` `click` (the element's rect centre) | T1 Step 4 / T2 migrations | `dashboard.test.mjs` ~3509 opens a subjectless thread `X` (`tlOpen`) and closes it with `click('[data-tl-close]')`. From T2, `X` is in the panel with its close hidden, so the click misses. Use `[data-tl-back]` (or `#th-close`) there, as at ~3346. List it with T2's migrations. | fixed: ~3509 added to the [data-tl-back] migration |
| P6-4 | Minor | spec-7 S7-3 | T2 Step 1 (`G`'s row → `aria-current="true"`), T1 Step 3 | A floating row's click and Back from a thread rewrite `#th-pane` while the focus is in it. They are not panel `thGo` calls, so nothing puts the focus back, and it falls to `<body>`. Add a check after `G`'s row click that the focus is on `G`'s row again. | fixed: T2 checks the focus on G's row after its click |

Verdict: CHANGES 76c77bfac06890d417a4dcf11f6be2437a374eb9
