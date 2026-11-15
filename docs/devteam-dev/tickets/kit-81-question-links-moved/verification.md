# kit-81-question-links-moved: verification

At commit `eab1b0e49598e3a28626d731348196334b370ee2` (later commits change only this ticket's records). Local runs on the box with Node 18.20.4, one test file at a time at `--test-concurrency=2`, as the box rule says. CI runs the whole suite on Node 18, 20, 22 and 24.

| # | Done-when | Command | Result |
|---|---|---|---|
| 1 | `test/question-links-moved.test.mjs` passes in CI: a question whose linked artifact changed in its worktree has `links_moved` set in `/api/data` to the reason `answer` refuses with; an unchanged one has null; computed once per log read (artifact reads counted across two `/api/data` calls on one log) | `devteam.mjs gate test -- node --test --test-concurrency=2 test/question-links-moved.test.mjs` | pass 1, fail 0 (gate test ok). RED first: before Task 1, `links_moved` was `undefined` while the baseline read counts (1 per draft) already passed. Mutation: with `artifactLinksMoved(v)` re-resolving the links, "reads per slug" failed (3, not 2). The test also covers a gone draft (its worktree removed): it gets the "no longer available" text and costs 0 reads |
| 2 | The same test: `metrics` raises `question-link-changed` (medium) for that question, with a fix hint naming withdraw and ask again; after withdraw the finding is gone | same command | pass. RED first: before Task 2, no finding (`the moved and the gone question, not the still one`) |
| 3 | `answer` still refuses the moved question with exactly today's refusal text | same command: `answer <qid> Yes` exits non-zero and its stderr is the literal string | pass; it passed before Task 2's code too, which pins today's words |
| 1 | CI, every job | `devteam.mjs gate ci -- gh run watch 43683879979 --exit-status` | 8/8 jobs success at `eab1b0e` (gate ci passed in 427.7 s) |

The first CI run, at `97943fd` (run 43683324026), failed every `rest` job on G1 (`test/components.test.mjs`). That test compares against a recorded copy of `/api/data`'s output, and the copy lacked the new field. The supervisor added `test/fixtures/g1/dashboard-data.txt` to touches (m-20261115-060510348-supervisor). Re-recorded with `DEVTEAM_G1_RECORD=1`, it gains one line, `"links_moved": null,`, and `gate test -- node --test --test-concurrency=2 --test-name-pattern='^G1: ' test/components.test.mjs` passes. That run's `kit (24, rest)` also failed the viewer's 5,000-readies bound (3 draws > 2), in code this ticket doesn't touch; it passed on the rerun (observation `flaky:readies-5000`).

Nothing is deferred to beta.
