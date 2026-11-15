# kit-81-question-links-moved: spec

Each open question in `/api/data` says whether a page it links changed since it was asked (`links_moved`), and `metrics` tells the supervisor to withdraw it and ask again (`question-link-changed`).

## Why

Story DCL-S1 and the design `project/designs/a-cleaner-more-consistent-dashboard.md` ("A moved link shows first", "The supervisor is told", the Data section and the failure-mode row "`links_moved` on every refresh"). `q-20261114-203542888-supervisor` linked a mock that kept changing; `answer` refused the owner's answer (`artifactLinksMoved`) and the owner had no warning before trying. kit-82 draws the card from this field; this ticket provides the field and the finding.

## How it works today

- `artifactLinkNow(l)` (devteam.mjs ~1823) resolves an artifact link: where it opens now (`href`), `changed` (its files no longer hash to the `sha256` pinned by `ask`) and `gone`. Each call reads the artifact's files (`artifactSource` → `diskEntries` for a worktree draft, `treeEntries` on main).
- `artifactLinksMoved(v)` (~1839) maps `artifactLinkNow` over the question's own links that have a `sha256` and returns the refusal text, or null. `answer` (~5743) dies with it; `ownerAnswer` (~4691) dies with `<what>: <it>`.
- `questions()` is memoised per log read (`memo('questions', …)`); `questionsNow` resolves an open question's links with `resolveQuestionLinks(v.links, true)`, which calls `artifactLinkNow` for each artifact link. `/api/data` runs `dashboard-data` in a child per request (one log read each); `dashboardData()` and `collectMetrics()` both use `questions()`.
- `collectMetrics` raises findings with `add(severity, kind, subject, detail, suggestion)`; the question findings sit in the block with `question-unrated`.

## The change

1. **One reason function over resolved links.** `artifactLinksMoved(v, now)` takes optional already-resolved links: `now` defaults to today's `(v.links ?? []).filter(artifact with sha256).map(artifactLinkNow)`. With `now` given it filters the resolved links the same way (artifact, `sha256`) and reads nothing. The text it returns is unchanged, so `answer` and `ownerAnswer` refuse with exactly today's words.
2. **`links_moved` on every question in `questionsNow`.** For an open question: the links resolved once by `resolveQuestionLinks(v.links, true)` are passed to `artifactLinksMoved(v, links)`, so the field costs no further reads. For any other status: `links_moved: null`. That includes `defaulted`, which `answer` still accepts (`openQuestion(id, ['open', 'defaulted'])`) and would refuse the same way: null means "not checked", not "safe to answer"; the dashboard shows only open questions (spec-1 F5). The field rides the memo, so it is computed once per log read; `/api/data`'s `questions` carry it as they are.
3. **The finding.** In `collectMetrics`, beside `question-unrated`, for each open question (the same `open` list: not on a let-go goal) with `links_moved` set: `add('medium', 'question-link-changed', q.id, q.links_moved, 'withdraw <qid> --reason "its linked page changed since it was asked" and ask again about the page as it is now (ask … --links …)')`. Once withdrawn the question is not open, so the finding is gone.

## Acceptance checks (the done-whens)

| # | Done-when | Check |
|---|---|---|
| 1 | `/api/data`: a question asked with an artifact link whose artifact then changes in its worktree has `links_moved` equal to the reason `answer` refuses with; an unchanged one has `links_moved` null; computed once per log read, not per question per request (artifact reads counted across two `/api/data` calls on one log) | `test/question-links-moved.test.mjs`: a threads fixture; two flat drafts (`artifact.json`, `index.html`) in `.worktrees/demo-01-draft/docs/devteam/project/artifacts/` (`moved-mock`, `still-mock`). The dashboard starts with its own `DEVTEAM_HUB_PORT`, `DEVTEAM_PORT_BASE`, `CLAUDE_CONFIG_DIR` and `CODEX_HOME` (as dashboard.test.mjs does), `DEVTEAM_DATA_WAIT_MS=600000` (so no GET is answered with the last run's data), and `NODE_OPTIONS` = any existing value plus `--import <counter>`, in the dashboard's env only (spec-1 F3). The counter (a module the test writes in its scratch dir) wraps `fs.readdirSync` and, only in a process whose argv has `dashboard-data`, appends one line per read of a path matching `/artifacts/<slug>$` (spec-1 F1, F4). Baseline: one GET `/api/data` before any question; then `ask` one question linking each draft, edit `moved-mock`'s `index.html`, and GET twice. Every GET has no `x-devteam-stale` header, and the counter file is read after each GET returns (spec-1 F2). Asserts: the moved question's `links_moved` is exactly the refusal text of check 3, the still one's is null; reads per slug are 1 in the baseline (the Library's own read) and 2 in each of the two later calls (the Library's plus one for the open question linking it): a second resolution per question or per request makes it 3 |
| 2 | `metrics` raises `question-link-changed` (medium) for that question with a fix hint naming withdraw and ask again; after withdraw it is gone | same test: `metrics --json` has one finding `{ severity: 'medium', kind: 'question-link-changed', subject: <moved qid> }` whose `suggestion` matches `/withdraw <qid>/` and `/ask again/`, and none for the still one; `withdraw <qid>`; `metrics --json` has none |
| 3 | `answer` still refuses the moved question with exactly today's refusal text | same test: `answer <qid> Yes` exits non-zero and its stderr is exactly `devteam: <qid> links the artifact moved-mock, which changed since it was asked; ask again about the page as it is now` (the literal string, not built from the function) |

CI (test.yml) runs the new file with the rest of the suite; locally only this file runs, at `--test-concurrency=2`.

## Contracts

Provided: `links_moved` (string, or null when nothing moved or the question is not open) on each item of `/api/data`'s `questions` and on every `questions()` view; kit-82 reads it. Additive: nothing existing reads a field of that name. Consumed: `ask --links`'s pinned `sha256`, unchanged.

## Edge cases

- A gone artifact (its worktree removed): `links_moved` is the "no longer available; ask again" text, the same as `answer`; the finding raises for it too.
- A question with no artifact links, or links asked before pinning (no `sha256`): null, as `answer` lets it through.
- A question answered or withdrawn: null, no finding.
- A question on a let-go goal: not in the dashboard's `questions` and no finding, as with the other question findings.
- An artifact link that landed on main as asked: `artifactLinkNow` already follows it to main; not moved.

## Out of scope

Drawing the card and disabling Answer (kit-82). Not counting the re-ask as a W2 re-ask (kit-98 reads it). Any change to `ask`, `answer`'s words or `resolveQuestionLinks`.

## Rulings

None yet.
