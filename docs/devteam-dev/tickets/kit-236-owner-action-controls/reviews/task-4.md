# Task review: T4 (Done waits for the act)

- Reviewer: task-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: e5d916b7979b58f756c44090c76bb3e641ad4043 (docs/devteam/dashboard/index.html: NOT_DONE, oaOpen, oaAnyway, the [data-answer] Done check, the [data-pick] handler, render's NOT_DONE prune)

I checked T4 against spec §5 and plan T4. The check sits after the existing validation and after the which-ask (never raised for an owner-action), and before goal validation and answerPress. For an open owner-action with Done picked, with or without a note, it sets NOT_DONE to oaOpen(q), repaints every copy and returns, so no press, however fast or repeated, reaches answerPress. oaOpen leaves out "no such record" rows. It counts "checking…" as not done, and, per spec-3 F2, a row whose press is still in PRESSES (k:<id> or g:<id>, the same keys the controls use). A Done that passes clears NOT_DONE before posting. Can't right now, words with no pick, and a card with no named records or only done ones post as before. A pick other than Done clears the marks and repaints. Picking Done again leaves them. Render prunes NOT_DONE for questions no longer in the data. The marks and the line are drawn from page memory in questionCard and oaPaint, so they survive redraws and polls, and the thread signature carries NOT_DONE. The anyway line is escaped static text. One display gap remains in the in-flight case.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec §5 ("beside each such row the card shows not done yet"); spec-3 F2 as disposed | oaRows (mark only when !s.done); oaSig; oaAnyway | A row whose press is still being sent is in oaOpen, so Done is held, which is right. But oaRows draws it as "Done: retired" with no not-done mark, while [data-oa-anyway] says "Not done yet. Change them above". Nothing on the card says which row is holding. When the press settles, the Inbox copy redraws and its line goes. The thread copy's signature (oaSig: done, missing, loading, confirming, NOT_DONE) is unchanged, so the thread copy keeps the stale line until something else changes. Draw a "saving…" mark on a row in flight, and put the in-flight bit (or oaOpen's result) into oaSig so the thread copy repaints when it settles. | |

Verdict: APPROVE e5d916b7979b58f756c44090c76bb3e641ad4043
