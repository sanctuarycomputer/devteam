# plan-7: combined spec and plan delta review (Trust Score rename)

- Reviewer: plan-reviewer 7 (fresh subagent, claude-opus-5-5)
- Reviewed: 51050a782897103749e9064701165b11c3329dc8 (spec.md and plan.md, diff since b99a3ad)

Cause: `m-20261115-234501821-supervisor` (owner rename, Autonomy Score is now Trust Score). `ticket show` has the 2026-11-15T23:44:50Z update. Its done_when 1 differs from the 21:05:07Z version only in "Trust's Autonomy Score" becoming "Trust's Trust Score card". Items 2 to 6 are byte-identical.

The delta `git diff b99a3ad 51050a7` touches only spec.md and plan.md, with 7 insertions and 4 deletions:

- spec.md: three in-place renames, at l.3 (the kit-99 dependency), l.7 (Why) and l.16 (kit-93 makes Trust the Trust Score card), plus one new history line (l.111).
- plan.md: one new constraint (l.27), one added sentence on Task 2 Step 1's `one card, four sections` test (l.86) and one new history line (l.162).

No other wording or meaning changed. The Efficiency Score's own name is unchanged, and both history lines say so explicitly.

Grep of both files for "Autonomy": every remaining hit is one of the following, and none names Trust's card:

- the nav group or design section (spec l.3 "section Autonomy pages", l.35, l.64; plan l.5, l.85, l.91), which stays;
- a quoted ban or history line (spec l.111; plan l.27, l.86, l.162);
- spec l.11's description of thread `t-20261115-190001527-owner` as "the Overview's Autonomy and Efficiency Score tiles", which belong to kit-90 and are not this page (S7-2).

Nothing that needed renaming was missed. "Trust's Trust Score card" is redundant but is the done_when's own wording.

The mock at main (`project/artifacts/dashboard-cleanup/index.html`, `efficiencyScore()` at l.1024 to ~1110) has no "Autonomy" or "Trust" text. The Autonomy Score copy is only on the mock's Trust card (l.987), its Notes and its learning item. So the page as specified never needs to name Trust's card. The new test sentence is a regression guard that the current design passes trivially. It is still sound: `textContent` of `#efficiency .card` is directly testable in the existing harness, and the constraint at l.27 reads correctly against the mock ("even where the mock does").

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| S7-1 | Minor | plan constraint l.27 | plan.md l.86 | The constraint bans "Autonomy Score" in any owner-facing text on the page. The test only checks the card's text, which leaves out `title` tooltips (the spec gives the rework stat and mini stat a `title`) and anything outside `.card`. A tooltip that says "as on Trust's Autonomy Score" would pass. Cheap to close: also assert that no `[title]` in `#efficiency` contains it, or check `#efficiency`'s `outerHTML`. Not blocking, because nothing in the spec or mock puts that copy in a tooltip. | |
| S7-2 | Suggestion | none | spec.md l.11 | "the Overview's Autonomy and Efficiency Score tiles" describes kit-90's thread with the old name. It is accurate as history and not this page's copy, so it can stay. If the aim is one name everywhere, it could read "Trust (formerly Autonomy) and Efficiency Score tiles". | |

Verdict: APPROVE 51050a782897103749e9064701165b11c3329dc8
