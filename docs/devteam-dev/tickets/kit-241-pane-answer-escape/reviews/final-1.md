# Final review, pass 1

- Reviewer: kit-100-inbox-in-panel worker session (claude-opus-5-5); has not seen kit-241's build
- Reviewed: b06e4e61bc7404c8f2c7dea8589a88b7be5e8607 (the whole branch, in `review-worktree kit-241-pane-answer-escape b06e4e6`)

## What I read and ran

- **Read:** final-brief.md, spec, plan, the reviews (plan-1, plan-2, task-1, task-1-2), verification.md, and the diff against `origin/main`:
  - in `devteam.mjs`: `paneAnswerShape`, `paneEscCancels`, `paneAnswer` (the Esc path, and the shared `record`/`finish`), the `/api/pane-answer` route with its box proof, and `cmdPane` answered;
  - the schema descriptions;
  - the new tests in `test/pane-question.answer.test.mjs`.
- **Also read:** `paneQuestionIn`/`paneAskingIn`, to see where `hint` comes from. It is the frame's lines under the last option, at most 8, and it is inside the digest. The page's real body is at index.html:5447: exactly `{ digest, option: Number(...), token }`.
- **The ticket's tests:** `test/pane-question.answer.test.mjs` alone, at `--test-concurrency=2`, with a throwaway HOME and `DEVTEAM_*` unset: 12 tests, 11 pass, 0 fail, 1 skipped. The skipped one is the Chrome page test (no Chrome on this box); CI runs it.
- **CI:** run 43801340374 concluded `success` at ae0e2ac, on every job including chrome 1/2 and 2/2. The commits from ae0e2ac to b06e4e6 change only this ticket's folder (final-brief.md, task-1-2.md, verification.md).
- **My own mutations** of `devteam.mjs`, each run with `--test-name-pattern=Esc` and restored after:

  | # | Mutation | Result |
  |---|---|---|
  | 1 | `paneEscCancels` always true | caught (the "whose Esc exits" test) |
  | 2 | `signed.escape !== b.escape` dropped from cmdPane's proof match | survived (see F1) |
  | 3 | the route's Esc shape loosened to any key list with a truthy `escape` | caught (2 tests) |
  | 4 | `Enter` sent after `Escape` | caught (3 tests) |
  | 5 | cmdPane's Esc form no longer refusing `option` and `label` | caught |
  | 6 | an Esc that doesn't clear the menu recorded as taken | caught |
  | 7 | the first hint check (on `st.ask`) dropped | survived. That is expected: the last look checks the same hint again, and the digest covers the hint |
  | 8 | cmdPane's signed body held to `isObj` instead of `paneAnswerShape` | caught (the box test's "a signed body the route would refuse") |

## The attacks the brief asks for

- **Anything but the owner's signed press sending Escape (R1).** Escape is sent only from `paneAnswer`, which only the route calls, after every check:
  - exact shape;
  - the page's token for that digest (served only for `kind: 'menu'`);
  - same-origin headers;
  - on a box, the gateway's signature over the raw body, with each nonce taken once;
  - one answer at a time.

  The act is written only by `pane answered --owner` behind `ownerWriter`. I found no way in for another writer. A duplicate-key or `__proto__` body parses the same way in the route and in cmdPane, and `__proto__` shows up as an extra key in `Object.keys`, so the shape check refuses it.
- **Escape onto a dialog, the usage-limit menu, or a menu whose Esc exits.**
  - A dialog and the usage-limit menu are `kind` `dialog` and `limit`, so they get no token and are refused again in `paneAnswer` when it re-reads the terminal.
  - A numbered menu whose hint doesn't say "Esc to cancel", or does say "Esc to exit" or "Esc to quit", is refused before any key, on both the first read and the last look. The test covers all three hints, and a key logger in the stand-in agent shows nothing was typed.
  - The hint comes from Claude Code's own frame, below the options. Text a tool puts in the dialog sits above them, in the question.
- **A signed Esc recorded as an option, or the reverse.** Both are refused: `paneAnswerShape(signed)` allows exactly one of `option` and `escape`, and `signed.option !== b.option` then tells them apart. The box test pins both directions.
- **The option path is unchanged for the page's real body.** The route now requires exactly the keys `digest, option, token`, which is what index.html:5447 sends. cmdPane's option form adds only `escape === undefined`, and `paneAnswer`'s option branch is the same code moved behind `finish`, with the same 409 message. A7: every existing test passes.

## Done-whens

- **A1–A6:** each is asserted in the new tests as the spec words it: the bytes the pane got, the act's `what`, `log-check`, every refusal with nothing typed and nothing logged, and the box's signed, unsigned and replayed presses.
- **A7:** the existing tests are unchanged and pass.
- **A8:** the schema test reads the file.

## Strategy

- **R1:** no new writer of owner lines. The act still comes only from `pane answered --owner`, and on a box only with a signature matched field for field.
- **R2:** the refusals are plain words ("Esc here may not cancel (the terminal says: …); answer it in the terminal").

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | quality.md §2 (tests pin behavior) | docs/devteam/scripts/devteam.mjs:16602 | `signed.escape !== b.escape` is never what refuses a mismatched press: with `paneAnswerShape(signed)`, the `option` comparison already catches both directions, so dropping the clause leaves every test green (mutation 2). It is harmless defence in depth. Either keep it and say in the comment that it is belt and braces, or leave it as it is. No test is needed | |
| F2 | Minor | spec §2 (Esc only where the menu says it cancels) | docs/devteam/scripts/devteam.mjs:16513 | `paneEscCancels` refuses only the exact phrases "Esc to exit" and "Esc to quit". A hint such as "Esc to cancel · Esc twice to exit" would pass. No Claude Code menu draws that today, so it is not a defect now. If the rule is touched again, `/\bEsc\b[^·\n]*\b(?:exit|quit)\b/i` would refuse any Esc-then-exit wording | |

Verdict: APPROVE b06e4e61bc7404c8f2c7dea8589a88b7be5e8607
