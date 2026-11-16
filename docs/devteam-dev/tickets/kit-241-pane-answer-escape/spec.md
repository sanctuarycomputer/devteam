# kit-241 spec: the owner can press Esc on a stopped-at-a-prompt card

Ticket: `kit-241-pane-answer-escape` (build, S, risk high; feature dashboard-cleanup, story DCL-S4). Depends on kit-85 (merged). kit-89, kit-98 and kit-100 wait on it; kit-100 draws the Esc button on the card, so this ticket changes no page.

## What changes

Today the owner answers a numbered menu in the supervisor's terminal only with an option (1 to 9). This adds one more answer: **Escape**, which Claude Code's menus take as "cancel" (`Esc to cancel`).

1. **`POST /api/pane-answer`** (cmdDashboard, devteam.mjs) accepts a body of exactly `{ digest, token, escape: true }` as well as today's exactly `{ digest, token, option }`. Any other shape is a 400 and nothing is sent: both `option` and `escape`, `escape` anything but `true`, any other field (`key`, `keys`, `label`, …). Every check before the key is unchanged and applies to Escape as to an option: same-origin headers (Origin and Sec-Fetch-Site), the page's token for that digest, on a box the gateway's signature over the body as sent (each nonce once), one answer at a time.
2. **`paneAnswer`** (the dashboard process's key sender) for Escape: reads the terminal again; refuses unless the question showing is a numbered menu (`kind: 'menu'`) with the card's digest (a dialog with no numbers and the usage-limit menu, `kind: 'limit'`, are refused, as an option is today); looks once more right before the key; sends the named tmux key `Escape` (`send-keys -t <target> Escape`, never `-l`, never Enter); waits for the menu to go (the existing settle loop). Then:
   - the menu (that digest) is gone: taken; recorded; held lines typed; 200 `{ ok: true, out: 'answered: Esc' }`.
   - the same menu still shows: **reported the way an option that doesn't land is**: recorded as one that may not have landed, nothing held is typed, 409 with the reason ("the same question still shows after Esc"). No second key, no Enter.
   - the terminal can't be read after: the same as an option (may not have landed, 409).
3. **`pane answered --owner`** (what the dashboard runs after) takes on stdin either today's shape or `{ digest, escape: true, first, artifact?, keys: 'Escape', taken, why?, proof? }` with no `option` and no `label`. Anything mixing the two is refused, nothing recorded. On a box the signed body must match: `signed.digest === b.digest`, `signed.option === b.option` and `signed.escape === b.escape` (both `true`, or both absent), so a signed Esc can't stand for an option or the reverse. Each nonce once, as today.
4. **The act**: `class: 'pane-answer'`, no new field (no `keys`, no `option` field: the act has none today). Its `what` says Escape:
   - taken: `answered the supervisor's terminal: "<first>" (artifact <id>) with Esc (keys: Escape; question <digest>)`
   - not taken: `sent Escape to the supervisor's terminal for "<first>" …, and it may not have landed: <why> (question <digest>)`
   - stdout: `answered: Esc` / `sent, and it may not have landed: Esc`.
5. **`log.schema.json`**: the act's description (pane-answer clause) and the `proof` description say "the option chosen, or Escape". Descriptions only; no structural change.
6. `cloud/gateway.mjs` is unchanged: it signs the body as sent, so an Esc body is signed like any other.

## Acceptance checks (the done-whens)

All in `test/pane-question.answer.test.mjs`, passing in CI:

- A1. `/api/pane-answer` accepts `{ digest, token, escape: true }` while the pane shows a numbered menu: 200 `answered: Esc`, the pane received exactly `\x1b` (no digit, no Enter), one `pane-answer` act by `owner`, channel `dashboard`, whose `what` says `with Esc (keys: Escape; …)` and names no option; `log-check` passes.
- A2. Refused on a dialog with no numbers and on the usage-limit menu: no token is served for either, a made-up token is 403, and nothing reaches the pane. (paneAnswer's own `kind !== 'menu'` refusal stays as the second wall.)
- A3. An Escape that doesn't clear the menu (the fixture's `menu,menu` sequence: the same menu asked again): 409 "may not have landed", the act says so, nothing held is typed, pane got only `\x1b`.
- A4. Shape: `escape: 'Escape'`, `escape: 1`, `escape: false`, both `option` and `escape`, `{ key: 'Enter' }`, `{ keys: 'C-c' }` alongside escape or option: 400, nothing typed.
- A5. Escape is refused as every answer is: no same-origin headers (403), another digest's token (403); `pane answered --owner` with an Esc body under `DEVTEAM_ROLE=worker` and from the supervisor's pane (TMUX/TMUX_PANE = DEVTEAM_SUPERVISOR) is refused with nothing recorded.
- A6. On a box: an Esc with no signature is 403; a signed Esc body is 200; its nonce again is 403. `pane answered --owner` given a proof whose signed body is an Esc with stdin naming option 1 is refused ("signed another press"), and given a proof for an option body with stdin `escape: true` is refused too.
- A7. A numbered option still works exactly as today: every existing test in the file passes unchanged.
- A8. `log.schema.json`'s pane-answer act and proof descriptions contain "the option chosen, or Escape" (asserted by reading the file in the test).

## Contracts

Provided: the request body of `/api/pane-answer` gains the `escape: true` form (kit-100's button consumes it); the `pane answered` stdin gains the Esc form (only paneAnswer writes it). Consumed: gateway's `paneSignature` (unchanged), the pane reader (`paneAskingIn`, `pane question --json --pane`).

## Edge cases

- The menu goes between the last look and the key: the Escape lands on whatever is there (an empty input box, or a working agent, where Esc interrupts it). Same window as a digit today, which the last look keeps to milliseconds; it is recorded as taken (the menu is gone) because nothing on screen says otherwise. Not widened by this ticket beyond what a digit already risks.
- A different menu appears after Esc (a new question): the old digest is gone, so taken, as with an option.
- Escape on a dialog could cancel or exit the session: refused twice (no token served for a dialog; paneAnswer re-reads and refuses non-menu).

## Values and refusals (strategy)

R1: no new writer of owner lines. The act is still written only by `pane answered --owner` behind ownerWriter (no role variable, not the supervisor's pane) and, on a box, only with the gateway's signature over the exact press, matched field for field. A supervisor or agent can't produce an Esc act or keystroke the owner didn't press. R2: the card's messages stay plain words ("the same question still shows after Esc; answer it in the terminal").

## Out of scope

The Esc button on the card (kit-100, index.html); any key other than Escape; Escape on dialogs or the usage-limit menu; the gateway.

## Rulings

- m-20261116-032452937 (supervisor, info): keep spec and plan tight; one combined spec+plan review.
- m-20261115-214201586 (supervisor, ruling to kit-85, applies fleet-wide): review rounds capped; after a second round fix and dispose Minors with no further pass.
