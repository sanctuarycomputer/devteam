# Task review, T4, pass 2

- Reviewer: task-reviewer-8 (fresh subagent, claude-opus-5-5)
- Reviewed: 357a84a40584827a38bddbd0be43d6bd75d89c88 (T4: fca3932..357a84a, with T5 between)

Run from a `git archive 357a84a` export, Node 24.14.1: the four `^Settings` tests in `test/hub-overview.test.mjs` pass (the box test ran; it did not skip), and the four gateway hub tests (`the hub on a laptop is unchanged`, `the hub sends nothing itself on a box`, `the hub refuses a drop on itself`, `the hub links the box's previews`) pass.

Pass 1's dispositions, each checked by undoing the fix in a scratch copy:

- T4-1 (focus): with the restore line in `paintSettings` turned off (`if (false)`), the new test fails at line 763 (`focus kept`). True.
- T4-2 (the Test row): with `if (notifyOn())` made `if (true)`, the new test fails at line 759 (`no Test row while notifications are off`). The row is also checked once notifications are on, and the laptop's send path is checked. True. The box's `push/test` path is the old fetch moved unchanged. Accepted.
- T4-3 (the live `#notify`): with `$('notify').cloneNode(true)` in the row, the new test fails at line 763. With that focus assertion also removed, it fails at line 767 (`on` never comes, because a copy's button has no handler). The disposition's claim holds. True.
- T4-4 (a real load): with draw()'s `else if (want === 'settings') selectSettings();` removed, the laptop test now fails at line 740 (`Settings again`). True.
- T4-5 (one kept Test button): with `if (!testBtn)` made `if (true)`, the new test fails at line 777 (`its answer outlives a repaint`). True.
- T4-6: deferred (minor), ledgered. Accepted.

Read afresh: `setRow` builds only with `el()`/`textContent`, and nothing goes into `innerHTML`. `notifyControl` and `pushControl` write into the one `#notify` and repaint Settings. On a laptop that can't notify, the row reads "This browser can't notify from this page". `selectSettings` and `showOnly(SETTINGS)` hide `#tl`, call `tlLeave()` and deselect every tab. draw() keeps Settings, leaves `empty` hidden under it, and repaints it when the list fetch fails. `hashchange` handles `settings` and leaves alone a project whose key is `settings-<hex>`. `paintSettings` reads focus before the Notify control moves and restores it to the same node or by `data-k`. A probe in headless Chrome found the gap below.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T4-2-1 | Important | spec.md "The hub's Settings": "No tab is selected while it shows; the Overview tab goes back." The roving-tabindex tablist the hub already uses keeps exactly one tab at `tabIndex` 0 | hub.html `showOnly` (every tab's `tabIndex = r === key ? 0 : -1`, `ovTab`, `term.tab`); the tabs' `keydown` handler | Under Settings, every tab gets `tabIndex = -1`, so the keyboard can't reach the tab strip, and with it the Overview tab, at all. Probe in headless Chrome (laptop, one project): at the Overview the tabs are `[["Overview",0],["alpha",-1]]`; after the Settings link they are `[["Overview",-1],["alpha",-1]]`. Six Tab presses from the body visit only the Notify button and the body. A keyboard user in Settings can't get back except with the browser's Back. Also, if a tab does get focus under Settings, `roots.indexOf(SETTINGS)` is -1, so ArrowLeft jumps to the second-to-last tab. Fix: under Settings, keep the Overview tab at `tabIndex` 0 while `aria-selected` stays false (or give Settings a way back of its own), and treat Settings as the Overview in the arrow keys. Test: at `#settings`, one tab has `tabIndex` 0, or a Tab press from the page reaches the Overview tab. | |
| T4-2-2 | Minor | Code fact: 357a84a gives the Manage and Previews links a `data-k` "so focus is kept" (T4-1's fix names the links) | hub.html `paintSettings` `link()` and the Previews `a.dataset.k`; test `Settings on a box…` | Nothing tests focus on the links across a repaint. With `a.dataset.k = \`settings:${words}\`` removed from `link()`, every Settings test still passes. Add to the box test: focus the `Manage` link, call `paintSettings()`, and expect `document.activeElement` to be the `Manage` link. | |

Verdict: CHANGES 357a84a40584827a38bddbd0be43d6bd75d89c88
