# kit-241 plan: Esc on the stopped-at-a-prompt card

## TL;DR

- One task, test first: new tests in `test/pane-question.answer.test.mjs` for the Esc press (A1 to A6, A8), run red, then the code.
- `/api/pane-answer` (cmdDashboard) takes exactly `{ digest, token, option }` or exactly `{ digest, token, escape: true }`; every other shape is 400; all existing walls (headers, token, box signature, one at a time) unchanged.
- `paneAnswer` gets an `escape` path: same re-read, menu-only, digest and last-look checks; `tmux send-keys -t <target> Escape`; settle; menu gone is taken, same menu still up is "may not have landed" (409, logged, nothing held typed). No Enter, no second key.
- `pane answered --owner` accepts the Esc stdin form (`escape: true`, `keys: 'Escape'`, no option, no label); on a box the signed body's `digest`, `option` and `escape` must all equal the stdin's.
- The act's `what` says `with Esc (keys: Escape; …)` or `sent Escape … may not have landed`; no new act field.
- `log.schema.json`: the pane-answer act and proof descriptions say "the option chosen, or Escape".
- Risk: Esc reaching anything but a numbered menu the owner saw (refused twice), or a signed option standing for Esc (field-for-field match). Option path untouched; existing tests are the regression check.

## Files (all inside touches)

- `docs/devteam/scripts/devteam.mjs`: route parse (~16226), `paneAnswer` (~15866), `cmdPane` answered (~16563-16579).
- `test/pane-question.answer.test.mjs`: new tests.
- `docs/devteam/schema/log.schema.json`: two descriptions (~1915, ~2047).

## Task 1: Escape, end to end

1. **Tests first** (append to the test file; reuse `dash`, `menuPane`, `acts`, `paneSignature`):
   - T-a (A1, A4, A5 route half): `menuPane(F, 'menu,input')`. Shape refusals (400, `pane.typed() === ''`): `escape: 'Escape'`, `escape: 1`, `escape: false`, `{option: 1, escape: true}`, `{escape: true, key: 'Enter'}`, `{option: 1, keys: 'C-c'}`, `{key: 'Escape'}`. Walls: Esc body without same-origin headers 403; with `'f'.repeat(64)` token 403. Then the good Esc: 200 `{ ok: true, out: 'answered: Esc' }`, `pane.typed() === '\x1b'`, one act by owner, channel dashboard, `what` equals `answered the supervisor's terminal: "Artifact" (artifact 0f1e2d3c0) with Esc (keys: Escape; question <digest>)`, `log-check` 0. A held line sent meanwhile (`send supervisor … --owner`) is typed after.
   - T-b (A3): `menuPane(F, 'menu,menu,input')`. Esc: 409, error matches `/may not have landed: the same question still shows after Esc/`, act `what` starts `sent Escape to the supervisor's terminal`, `pane.typed() === '\x1b'`, held line not typed (`heldFor` length 1).
   - T-c (A2): `menuPane(F, 'trust,input')` and `menuPane(F, 'limit,input')` (one dashboard each, or one fixture with two panes sequentially): wait for `asked()` kind dialog / limit; token undefined; Esc with a made-up token 403; `pane.typed() === ''`.
   - T-d (A5 command half, A6): box fixture as the existing box test. Unsigned Esc 403. `pane answered --owner` with an Esc stdin under `DEVTEAM_ROLE=worker`: refused, no act; with `TMUX=/x`, `TMUX_PANE=%9`, `DEVTEAM_SUPERVISOR=%9` (and no role): refused, no act. Signed Esc: 200, `typed() === '\x1b'`, act proof nonce is the signature's; again 403 used already. Cross-checks on `pane answered --owner` with fresh signatures (nonces never taken): proof over an Esc body + stdin `option: 1, keys: '1', label: 'Yes'` refused `/signed another press/`; proof over an option-1 body + stdin `escape: true, keys: 'Escape'` refused `/signed another press/`; no act added by either.
   - T-e (A8): read `log.schema.json`, assert the `act` description and the `proof` description each include `the option chosen, or Escape`.
   - Run the file alone (`node --test --test-concurrency=2 test/pane-question.answer.test.mjs`): the new tests fail, the old pass.
2. **Route** (`isPane` block): replace the field check with: `isObj(parsed)`; keys exactly `digest,option,token` or `digest,escape,token` (sorted join); digest 40 hex; token string; option integer 1..9 in the first form; `escape === true` in the second. Error text `missing or invalid fields: { digest, option, token } or { digest, escape: true, token }`. Pass `escape: parsed.escape === true` to `paneAnswer`.
3. **`paneAnswer({ digest, option, escape, proof })`**: the checks up to and including the last look stay as they are, except the option lookup is skipped for Escape. For Escape: `send-keys -t <target> Escape` (500 if it fails, nothing recorded, as today); `lines = await settle(st.ask.selected)`; `still = menuIn(lines)`; `why = still ? 'the same question still shows after Esc' : !lines ? 'the terminal could not be read after the key' : null` (no draft check: Esc types nothing into an input box); `keys = 'Escape'`; record via `pane answered --owner` with `{ digest, escape: true, first, artifact, keys, taken: !why, why?, proof? }`; then the existing tail (refresh, 500 on a failed record, 409 with "Look at the terminal" on `why`, 200 otherwise). The tail's 409 message keeps its wording but drops "clear its input box if the digit is there" for Escape.
4. **`cmdPane` answered**: validation becomes `common && (optionForm || escForm)` where `optionForm` is today's (`option` 1..9, `label`, keys `/^\d(, Enter)?$/`, `escape === undefined`) and `escForm` is `escape === true && option === undefined && label === undefined && keys === 'Escape'`. Box: add `|| signed.escape !== b.escape` to the "signed another press" condition. `chose` is `Esc` for the escape form; the taken `what` reads `… with Esc (keys: Escape; question d)`; the not-taken reads `sent Escape to the supervisor's terminal for <about>, and it may not have landed: <why> (question d)`; stdout `answered: Esc` / `sent, and it may not have landed: Esc`. Held-line flush unchanged (only when taken).
5. **Schema**: act description `the option chosen, the keys sent` → `the option chosen, or Escape, the keys sent`; proof description `names the question's digest and the option, or the setting's key and value` → `names the question's digest and the option chosen, or Escape, or the setting's key and value`.
6. Run the test file alone again (green), plus `test/pane-question.held.test.mjs` and `test/pane-question.parse.test.mjs` one at a time at `--test-concurrency=2`, plus any test that hashes or snapshots log.schema.json (grep for it first). Gate through `devteam.mjs gate test`. Commit; task review `reviews/task-1.md` by a fresh subagent.

## Verification and finish

`verification.md` with a row per done-when at a named commit; CI is the gate (`gate ci -- gh run watch …`). Merge `origin/main`, push, PR `kit-241-pane-answer-escape: The owner can press Esc on a stopped-at-a-prompt card: pane answered accepts Escape`; risk high: final-1 and final-1b from two other sessions via `review-request`; `check-ticket`; `merge-request`.
