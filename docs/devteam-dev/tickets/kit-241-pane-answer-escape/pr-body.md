## Summary

The owner can press **Esc** on the dashboard card that shows a numbered menu in the supervisor's terminal (kit-100 draws the button).

- `/api/pane-answer` accepts exactly `{ digest, token, escape: true }` as well as today's exactly `{ digest, token, option }`. Every other shape gets a 400. The checks are the same as for an option: same-origin headers, the page's token for that question, the gateway's signature on a box with each nonce used once, and one answer at a time.
- `paneAnswer` sends the named tmux key `Escape` (with no digit and no Enter), and only when the terminal still shows that same numbered menu (`kind: 'menu'`) and its hint says `Esc to cancel` (never `Esc to exit` or `quit`). It refuses dialogs, the usage-limit menu and folder-trust style menus whose Esc exits. If the same menu is still up after Esc, the press is reported the same way as an option that doesn't land: 409, logged as "may not have landed", and nothing held is typed.
- `pane answered --owner` takes the Esc form (`escape: true`, `keys: 'Escape'`, with no option and no label). On a box, the signed body must have exactly the route's keys and match `digest`, `option` and `escape`, so a signed Esc can't stand for an option, and a signed option can't stand for an Esc.
- The act's `what` says `with Esc (keys: Escape; …)`. No new field is added.
- In `log.schema.json`, the pane-answer act and proof descriptions now say "the option chosen, or Escape".
- `cloud/gateway.mjs` is unchanged.

Records: `docs/devteam-dev/tickets/kit-241-pane-answer-escape/`.

## How to verify

`node --test --test-concurrency=2 test/pane-question.answer.test.mjs` (CI runs it). On a devteam cloud box, run it with a throwaway `HOME`: otherwise the box's own gateway files make every fixture act as a box (see `t.sh`).

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
