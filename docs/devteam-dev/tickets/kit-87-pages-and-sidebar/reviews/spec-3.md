# Spec review, pass 3

- Reviewer: spec-reviewer 3 (fresh subagent, claude-opus-5-5)
- Reviewed: abad3dbab97bf37eb940d455199a10e3f1841d51 (spec.md; cold confirm of spec-2)

Read: spec-2; the spec diff `068abc1..abad3db` (§4 talk/ bullet, §5 subject and close bullets, §8 Fleet and Every setting, acceptance 2f); the ticket's top-level fields (`ticket show`: done_when 1-6); `shell.md` §7; the frozen block in `index.html` (`parseHead`, `headFor`, `stampFor`, `withPage`, `closeTarget`, l.1190-1240) and today's `route()` talk/ branch (l.4314), `tlGoTo`, `tlClose`, `tlOpen` and their callers (l.5601 pins, l.5603 the dock's list); the mock at `3cb8d6b` (Settings view l.1333, `SETTINGS_ALL`, `settingsAll()`).

Traced the new talk/ history on the block's functions:
- clicked on Goals: `stampFor` gives `{ page: '#goals', depth: 1, openedHere: true }`; `withPage` makes the page `#board` in place, no entry added; Back lands on the Goals entry; × follows `closeTarget` to `go(-1)`, Goals.
- reload of that entry: `stampFor` keeps the stored state, so the card reopens over Board, and closing still goes back to Goals (the entry below survives a reload).
- cold load: `{ page: '#overview' (links.talk), depth: 1, openedHere: false }`, `withPage` to `#board`, close replaces with `#board`, as 2f says.
- from inside a peek: depth 2 kept, closing goes back to the page the peek was over, or replaces with the subject's page when cold.

F2-1 resolved: the talk/ entry's page is changed in place with `withPage` (no pushed page head, so no Back trap), the stamp agrees with the page shown on reload, closing follows `closeTarget`, and 2f checks Back, reload, close and the cold load. F2-2 resolved: §8's Fleet section matches the mock's rows in order (the whole fleet, the worker limit(s), Memory ceiling, Kit), the second stepper being ruling `-195755200`'s; Every setting lists every `settings_all` entry, the two limits included read-only, as `settingsAll()` does, which meets done_when 6. Implementable on the frozen block with no change to it. Two Minor gaps below; neither blocks.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F3-1 | Minor | spec §5 accuracy against today's code; shell.md §7 (a page change is a history entry) | spec §5 "Going to a subject from outside a route" | It names "the dock's list or a pin" as `tlGoTo` callers, but a pin calls `tlOpen(id, false)` (l.5601) and never goes anywhere, and pins are drawn only for the page shown. It also says `tlGoTo` "assigns the subject's page head (one new entry)" unconditionally: from the dock with the subject's page already shown (say `#board?goal=…`, or Loop on the same tab), assigning the bare head would push a duplicate entry or drop the head's state. Say the dock's list only, and that it assigns only when the subject's page (or Loop tab) differs from the one shown, else it just scrolls and opens the card. | |
| F3-2 | Minor | done_when 2 (Back returns to the previous page); spec §4, §5 | spec §5 "Closing a thread card"; acceptance 2f | Back from a card opened by a talk/ link now lands on a page head, but today's `route()` closes a card only through `tlClose`, and nothing in the spec says routing away from the talk/ entry closes the card (`TL.open` cleared, no hash change). As written, Back could show Goals with the Board subject's card still open. State that leaving a talk/ entry by history closes the card it opened (a card opened from the dock stays as today), and have 2f assert the card is closed after Back. | |

Verdict: APPROVE abad3dbab97bf37eb940d455199a10e3f1841d51
