# Task review: T4, pass 2 (fixes, cold confirm)

- Reviewer: task-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: 5b1d3c113a63ca432c26c4c478373ba012757a02 (docs/devteam/dashboard/index.html: oaSig)

I read only the fix diff (`git show 5b1d3c113a63ca432c26c4c478373ba012757a02`) against task-4.md F1. oaSig now carries, per row, whether its press is still in PRESSES, under the same key oaOpen uses (g: or k: plus the id). When a press settles, press's finally drops the key. The next thread draw then sees a new signature and redraws the thread copy, which drops its stale [data-oa-anyway] line, whenever nothing in the thread's turns has focus. That fixes the stale line in the common case. The other half of F1 (no mark on the row that is holding Done) was not taken up, and there is a focus case the fix doesn't reach. Neither lets Done post over an unchanged record, so neither blocks. I ran test/dashboard-owner-action.test.mjs once at the branch head (70a27ea) with DEVTEAM_* unset: pass 6, fail 0.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec §5 ("beside each such row the card shows not done yet"); spec §3 Repaint (a focused thread copy is written by oaPaint, not redrawn) | oaSig; press's settle; oaRows | Say the owner presses Send with Done on the thread copy while a row's press is in flight. The Send button keeps focus, so the thread copy is not redrawn when the press settles, and nothing calls oaPaint then. Its "Not done yet. Change them above" line stays while every row reads Done, until focus leaves the turns. The row holding Done still carries no "saving…" mark. Calling oaPaint once the press settles, for example in a `.finally` on the run press() returns in both row handlers, would cover both copies whatever has focus. Drawing "saving…" on a row whose key is in PRESSES would say which row is holding. | |

Verdict: APPROVE 5b1d3c113a63ca432c26c4c478373ba012757a02
