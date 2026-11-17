# Task review: Task 4 "Every detail stays", fix round

- Reviewer: task-4-rereviewer (fresh subagent, claude-sonnet-5-5)
- Scope: fix round bcf3677d..5ce6a972
- Verdict: APPROVE 5ce6a97265d43b782dccb3c8bd36b7b33c896751

I read the fix diff and the page code the new rows read. I ran no tests. The one index.html hunk is at ~3519-3530 (the ATTR table), outside the devteam-layout and devteam-shell-js blocks. Files are inside touches (index.html, the test, test/lib/kit.mjs). The fixture generates its files: the PNG is a 68-byte base64 literal, the PDF is built from three objects in code, the HTML and markdown are short strings. No binary blob is committed.

## Findings verdicts

| Id | Verdict | Where | Note |
|---|---|---|---|
| F1 | ADDRESSED | test/dashboard-peek.test.mjs:~529-535 (rows), ~1031-1049 (custom row); test/lib/kit.mjs:~347-360 | Rows for the diagram (`figure.diagram svg`), image, sandboxed HTML and PDF iframes (`sandbox=""`), and "Open in a new tab" for both. The `mdview` row clicks Raw, reopens the peek, reloads the page and reopens, and checks pressed, raw shown, rendered hidden and the stored key each time. A dropped item fails its row. |
| F2 | ADDRESSED | test/dashboard-peek.test.mjs:~625-690 | Literal value rows for lesson (statement, evidence, plain), problem (title, threatens) and incident (fingerprints, sensor, title), and question (question, context, answer, blocks). A dropped field fails by name. |
| F3 | ADDRESSED | test/dashboard-peek.test.mjs:~127, ~145 | `dt:Preconditions >> ol >> text:no plan yet` and `dt:Your verdicts >> ul li b >> text:Approve` (the page draws the verdict in `<li><b>`, index.html:4256). Both are exact. |
| F4 | ADDRESSED | test/lib/kit.mjs ticket `links: ['docs-site']` with a settings `links` entry; a goal-change question answered and `goal set --approved` | Both injections dropped; the real kit path is used. The planner and incident injections remain with stated reasons. The row for "changed since asked" keeps its injection and reason (spec §2.4). |
| F5 | CARRIED | Task 6 | Not in this round, as ruled. |

## Controller ruling: the ticket links formatter (index.html:3528-3529)

Correct. It is in `ATTR.ticket.fmt` only, so a question's links (`ATTR_COMMON.fmt.links`, `linkOf`) are unchanged. It runs `esc` on each id. Empty values never reach it (`storedRows` filters `emptyVal`), and a non-array or an odd shape throws inside `storedRows`' try/catch and falls back to `fmtAny`. A non-string element would print through `esc` as text, not as markup. Fine.

## New findings

None Critical or Important.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| N1 | Minor | quality §3 | test/dashboard-peek.test.mjs, ticket `links` formatter, index.html:3529 | The formatter's "ticket link id is an object" case is not tested; it prints "[object Object]" rather than the fallback. The ticket schema holds string ids, so no failure scenario arises from the kit. Not blocking. | wont-fix the ticket schema holds string link ids, so the kit can't produce an object; the try/catch falls back to the generic formatter on a malformed value |

## Verdict

APPROVE 5ce6a972: F1 to F4 each have a row that fails on the defect it guards; the ticket formatter is scoped, escaped and leaves question links alone.
