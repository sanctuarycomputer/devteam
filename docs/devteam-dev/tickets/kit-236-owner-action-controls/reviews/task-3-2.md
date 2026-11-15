# Task review: T3, pass 2 (fixes, cold confirm)

- Reviewer: task-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: 5b1d3c113a63ca432c26c4c478373ba012757a02 (docs/devteam/dashboard/index.html: oaState, render's OA_PEEKS, the [data-oa-know] apply)

I read only the fix diff (`git show 5b1d3c113a63ca432c26c4c478373ba012757a02`) against task-3.md F1 to F3. F1: render clears OA_PEEKS before it draws the Inbox. render draws every open question's card (`d.questions.map(questionCard)`), and oaState re-adds each peek-read id as it draws, so the refetch loop after refreshDrawer now covers only ids an open card still names. The clear and the refill happen in the same synchronous pass, so fetchPeek's later `OA_PEEKS.has` check sees the refilled set. A held render (owner typing) skips both, and the rows keep their last peeks until the next draw. F2: the row's words are taken by oaState at press time, from the data before OA_SET is set, and kept in OA_SET. The no-record peek branch now draws them, and falls back to the id only when the record was itself still loading. F3: an OA_SET status of accepted counts as kept with no clock test. The owner-and-after-the-ask test still applies to the record's own status (r.by, r.at), so spec-3 F3 holds. Retired still reads from mine.status. No new value from data reaches HTML unescaped, and no new top-level code runs at load. I ran test/dashboard-owner-action.test.mjs once at the branch head (70a27ea; index.html's owner-action code unchanged since 5b1d3c113a63ca432c26c4c478373ba012757a02) with DEVTEAM_* unset: pass 6, fail 0.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Suggestion | quality.md §2 Comments and readability (a non-obvious decision with no comment saying why) | render, `OA_PEEKS.clear()` | The clear went in between the comment "a refusal goes with its question …" and the REFUSED loop that comment describes. The clear has no comment of its own, and "cleared here, refilled by oaState as the cards draw" is not obvious from the line. Move it above that comment with one line saying why. | |

Verdict: APPROVE 5b1d3c113a63ca432c26c4c478373ba012757a02
