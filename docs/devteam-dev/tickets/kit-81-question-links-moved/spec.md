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
2. **`links_moved` on every question in `questionsNow`.** For an open question: the links resolved once by `resolveQuestionLinks(v.links, true)` are passed to `artifactLinksMoved(v, links)`, so the field costs no further reads. For any other status: `links_moved: null` (nobody answers a closed question, and resolving its links would cost reads). The field rides the memo, so it is computed once per log read; `/api/data`'s `questions` carry it as they are.
3. **The finding.** In `collectMetrics`, beside `question-unrated`, for each open question (the same `open` list: not on a let-go goal) with `links_moved` set: `add('medium', 'question-link-changed', q.id, q.links_moved, 'withdraw <qid> --reason "its linked page changed since it was asked" and ask again about the page as it is now (ask … --links …)')`. Once withdrawn the question is not open, so the finding is gone.

## Acceptance checks (the done-whens)

| # | Done-when | Check |
|---|---|---|
| 1 | `/api/data`: a question asked with an artifact link whose artifact then changes in its worktree has `links_moved` equal to the reason `answer` refuses with; an unchanged one has `links_moved` null; computed once per log read, not per question per request (artifact reads counted across two `/api/data` calls on one log) | `test/question-links-moved.test.mjs`: a threads fixture; two drafts in `.worktrees/demo-01-draft/…/artifacts/` (`moved-mock`, `still-mock`); `ask` one question linking each; edit `moved-mock`'s `index.html`; start the dashboard with `NODE_OPTIONS=--import <counter>` where the counter (a test file in the scratch dir) wraps `fs.readdirSync` and appends one line per read of a path ending `/artifacts/<slug>` to a file; GET `/api/data` twice. Assert the moved question's `links_moved` equals the stderr of `answer <qid> Yes` (minus the `devteam: ` prefix the kit's `die` adds, matched exactly), the still one's is null; then that the read count per slug is the same for each of the two calls, and equals the count taken from a baseline `/api/data` before any question was asked plus one per open question linking it: a second resolution per question (or per request render) raises it |
| 2 | `metrics` raises `question-link-changed` (medium) for that question with a fix hint naming withdraw and ask again; after withdraw it is gone | same test: `metrics --json` has one finding `{ severity: 'medium', kind: 'question-link-changed', subject: <moved qid> }` whose `suggestion` matches `/withdraw <qid>/` and `/ask again/`, and none for the still one; `withdraw <qid>`; `metrics --json` has none |
| 3 | `answer` still refuses the moved question with exactly today's refusal text | same test: `answer <qid> Yes` exits non-zero and its stderr is exactly `devteam: <qid> links the artifact moved-mock, which changed since it was asked; ask again about the page as it is now` (the literal string, not built from the function) |

CI (test.yml) runs the new file with the rest of the suite; locally only this file runs, at `--test-concurrency=2`.

## Contracts

Provided: `links_moved` (string or null) on each item of `/api/data`'s `questions` and on every `questions()` view; kit-82 reads it. Additive: nothing existing reads a field of that name. Consumed: `ask --links`'s pinned `sha256`, unchanged.

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
