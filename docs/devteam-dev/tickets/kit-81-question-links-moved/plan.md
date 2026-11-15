# kit-81 question links moved: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## TL;DR

- `artifactLinksMoved(v, now)` gains an optional second argument: links already resolved by `artifactLinkNow`. Its words don't change.
- `questionsNow` adds `links_moved` to every question: for an open one, from the links it already resolves (no extra reads); null otherwise.
- `collectMetrics` raises `question-link-changed` (medium) for each open question with `links_moved` set, with a hint naming `withdraw` and asking again.
- One new test file, `test/question-links-moved.test.mjs`, covers all three done-whens. It counts artifact folder reads in the `dashboard-data` child through `NODE_OPTIONS=--import`.
- Two tasks: the field and its `/api/data` test, then the finding and the `answer` refusal check.
- Locally, only the new file runs, at `--test-concurrency=2`. CI runs the whole suite.

**Goal:** an open question in `/api/data` says whether a page it links changed since it was asked, and `metrics` tells the supervisor to withdraw it and ask again.

**Architecture:** the field is derived on read inside the `questions()` memo (one log read), reusing the links `resolveQuestionLinks(…, true)` already resolves. The finding reads the same memo.

**Tech Stack:** Node (ESM, no dependencies), `node:test`.

**Spec:** `docs/devteam-dev/tickets/kit-81-question-links-moved/spec.md` (spec-2 APPROVE d241d90).

## Global Constraints

- Touches only `docs/devteam/scripts/devteam.mjs` and `test/question-links-moved.test.mjs` (plus this ticket's records).
- The refusal text is exactly today's: `<qid> links the artifact <slugs>, which changed since it was asked; ask again about the page as it is now` and `<qid> links the artifact <slugs>, which is no longer available; ask again`.
- Finding: severity `medium`, kind `question-link-changed`, subject the question id, detail the `links_moved` text.
- Box rule: run only `test/question-links-moved.test.mjs`, at `--test-concurrency=2`; record gates with `devteam.mjs gate test -- <real command>`.

## Review Focus

1. A question whose worktree was removed (gone). Expected: `links_moved` is the "no longer available" text, the same as `answer`. Pinned in Task 1 (a third draft whose folder the test deletes).
2. A question whose links have no `sha256` (asked before pinning) or that links no artifact. Expected: null. Covered by the code path (filter unchanged); the reviewer reads it.
3. A question answered or withdrawn. Expected: `links_moved` null and no finding. Pinned in Task 2 (after `withdraw`).
4. A question on a let-go goal. Expected: no finding (the `open` list already drops it). Reviewer reads it.
5. `hello` and the other background runs also call `questions()`. Expected: no extra reads in the `dashboard-data` count; the count filters by argv.

---

### Task 1: `links_moved` on every question view

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs` (`artifactLinksMoved` ~1839, `questionsNow` ~1851)
- Create: `test/question-links-moved.test.mjs`

**Interfaces:**
- Produces: `artifactLinksMoved(v, now = <today's resolution>) -> string | null`, and `links_moved: string | null` on each item of `questions()` and `/api/data`'s `questions`.

- [ ] **Step 1: Write the failing test.** `test('an open question says when its linked page moved, once per log read', …)`, using `threadsFixture('links-moved')` and `dashboardOnFreePort` from `./lib/kit.mjs`.
  - Setup: write three flat drafts (`artifact.json` with `{ v: 1, title, summary, by: 'supervisor', for: [] }`, plus `index.html`) under `F.old/.worktrees/demo-01-draft/docs/devteam/project/artifacts/`: `moved-mock`, `still-mock` and `gone-mock`. The gone one goes in its own worktree folder, `.worktrees/demo-02-gone/…`, so deleting it removes nothing else.
  - The counter is a module written to `F.base`. If `process.argv.includes('dashboard-data')`, it wraps `fs.readdirSync` and, for each path matching `/\/artifacts\/([a-z0-9-]+)$/`, appends the slug and a newline to a file named by `process.env.LM_COUNT`.
  - The dashboard's env is `F.env({ DEVTEAM_HUB_PORT: String(PORTS + 2), DEVTEAM_PORT_BASE: String(PORTS + 3), CLAUDE_CONFIG_DIR, CODEX_HOME (under F.base), DEVTEAM_DATA_WAIT_MS: '600000', LM_COUNT, NODE_OPTIONS: [process.env.NODE_OPTIONS, '--import ' + pathToFileURL(counter)].filter(Boolean).join(' ') })`.
  - `get()` fetches `/api/data` and asserts the `x-devteam-stale` header is null. It then reads the counter file, returns `{ data, reads }` with `reads` counted per slug since the last `get`, and truncates the file.
  - Baseline: `get()` before any question; assert `reads['moved-mock'] === 1`, `reads['still-mock'] === 1` and `reads['gone-mock'] === 1` (the Library's).
  - Ask three questions with `F.sup(['ask', '--question', 'Does [[mock]] read right?', '--choices', '[{"label":"Yes"},{"label":"No"}]', '--links', JSON.stringify([{ name: 'mock', title: 'The mock', artifact: slug }]), '--stake', '1', '--urgency', '1'])`, taking each qid from the output. Then append a line to `moved-mock/index.html` (so its size changes, whatever the mtime's granularity: plan-1 P2) and remove `.worktrees/demo-02-gone`.
  - Run `get()` twice. Each time, assert: `reads['moved-mock'] === 2`, `reads['still-mock'] === 2` and `reads['gone-mock'] ?? 0` is `0` (the deletion took, and a gone link costs no read: plan-1 P3); the moved question's `links_moved === \`${qm} links the artifact moved-mock, which changed since it was asked; ask again about the page as it is now\``; the still question's is `null`; the gone question's `=== \`${qg} links the artifact gone-mock, which is no longer available; ask again\``.
- [ ] **Step 2: Run it and see it fail.** Run `node --test --test-concurrency=2 test/question-links-moved.test.mjs`. Expected: it FAILS on `links_moved` being `undefined`, after the read counts pass (which proves the counter works).
- [ ] **Step 3: Implement.** In `artifactLinksMoved(v, now)`, `now` defaults to `(v.links ?? []).filter(<artifact with sha256>).map(artifactLinkNow)`. When `now` is given, filter it the same way (`isObj(l) && l.artifact !== undefined && l.sha256`). The body below that is unchanged. In `questionsNow`, resolve the links into a local, then return `links: resolved` and `links_moved: v.status === 'open' ? artifactLinksMoved(v, resolved) : null`. Update the comment above `artifactLinksMoved` to say a caller may pass links it already resolved.
- [ ] **Step 4: Run it and see it pass.** Record the gate: `node '/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs' gate test -- node --test --test-concurrency=2 test/question-links-moved.test.mjs`. Expected: `ok`.
- [ ] **Step 5: Commit** (`kit-81: links_moved on every question view`), log `phase build --task T1`, and review into `reviews/task-1.md`.

### Task 2: the `question-link-changed` finding and `answer`'s words

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs` (`collectMetrics`, beside `question-unrated` ~11316)
- Modify: `test/question-links-moved.test.mjs`

**Interfaces:**
- Consumes: `links_moved` on `questions()` items (Task 1).

- [ ] **Step 1: Write the failing tests** as subtests or as a continuation in the same fixture, after the `/api/data` part:
  - `answer` refuses with exactly today's words: `F.run(F.old, ['answer', qm, 'Yes'])` (the fleet fixture's `run` takes the checkout first: plan-1 P1) has `status !== 0` and `err === \`devteam: ${qm} links the artifact moved-mock, which changed since it was asked; ask again about the page as it is now\``, written out literally.
  - The finding: `JSON.parse(F.sup(['metrics', '--json'])).findings.filter((f) => f.kind === 'question-link-changed')` holds one entry each for `qm` and `qg` and none for the still question. Each has `severity: 'medium'` and `detail` equal to its `links_moved`, and its `suggestion` matches `new RegExp(\`withdraw ${qm}\`)` (or `qg`) and `/ask again/`.
  - After `F.sup(['withdraw', qm, '--reason', 'its page changed'])`: no `question-link-changed` finding for `qm`, and the next `get()` shows no question `qm` among the open ones.
- [ ] **Step 2: Run it and see it fail.** Same command as Task 1. Expected: FAIL on the findings (the `answer` check already passes; it pins today's words).
- [ ] **Step 3: Implement.** In the open-questions block, after `question-unrated`: `for (const q of open.filter((x) => x.links_moved)) add('medium', 'question-link-changed', q.id, q.links_moved, \`withdraw ${q.id} --reason "its linked page changed since it was asked" and ask again about the page as it is now (ask … --links …)\`)`, with a one-line comment that the re-ask is not a W2 re-ask (this question was never answered).
- [ ] **Step 4: Run it and see it pass**, through `gate test` as in Task 1.
- [ ] **Step 5: Commit** (`kit-81: question-link-changed finding`), log `phase build --task T2`, and review into `reviews/task-2.md`.

## Rulings

- m-20261115-060510348-supervisor: `test/fixtures/g1/dashboard-data.txt` is in touches. CI's G1 golden (`test/components.test.mjs`) records `/api/data`'s shape; re-recorded with `DEVTEAM_G1_RECORD=1`, it gains one line, `"links_moved": null,`.
