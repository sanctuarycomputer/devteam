# Feature: <feature-slug>

## 0. Header

- Status: draft | in review | approved
- Goals: <g-… ids of the ready goals this feature serves>
- Preconditions: <g-…#n: the goal preconditions this feature makes true>
- Read against: <commit sha>
- Design: `project/designs/<slug>.md`
- Problem statement: <two or three sentences; confirmed by the owner on <date>>
- Owner answers this rests on: <question ids>

## 1. Stories

| Id | Story | Acceptance (checked end to end) |
|---|---|---|
| <FEAT>-S1 | When <trigger>, the <system> shall <response>. | |

## 2. Tickets

Detail lives in `project/graph/<id>.json`. This table only lists them.

| Ticket | Kind | Size | Risk | Serves |
|---|---|---|---|---|
| | | | | |

## 3. Waves and critical path

<paste `devteam.mjs waves --feature <slug>` output>

## 4. Gaps

What would be left broken if work paused after each wave:

-

## 5. Owner questions

| Question id | Question | Answer | Date |
|---|---|---|---|
| | | | |

## 6. Release map

| Story | Expected release |
|---|---|
| | |

## 7. Rulings log

| Date | Ruling | Source |
|---|---|---|

## 8. Supersessions

-
