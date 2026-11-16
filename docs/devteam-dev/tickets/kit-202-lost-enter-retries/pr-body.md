## Summary

The lost-Enter rescue presses Enter on text the kit typed that is still stuck in an idle agent's input, up to three times. It pressed again only while the pane's bottom 8 lines were unchanged, and those lines include the harness's own chrome, which changes by itself on an idle pane: the footer (`· 1 shell ·`, `PR #671`), the background-agent list (timers, token counts) and the status line's shell count. So it gave up after the first Enter while the text was still stuck. The box operator saw this three times in one day (o-20261114-215952756).

- `paneBody(lines, tail)` works out the pane's content:
  - it cuts below the input box's last rule line, unless the typed text sits below that line (then there's no box under the input);
  - it leaves out token-counter lines (agent lists, spinners);
  - it takes shell-count phrases out of each line;
  - it keeps the last 8 lines that are left.
- The rescue digests only that body. It looks for the typed text in the raw lines, so text that mentions shells or tokens is still found.
- The busy and menu guard now reads every captured line (15) instead of the bottom 8. It is wider, never narrower, so a busy marker in the footer, or a spinner above a long agent list, still stops the press.
- The existing lost-Enter tests are unchanged. The one that ends the rescue when a reply appears below an echoed line still passes.

Spec, plan and reviews: `docs/devteam-dev/tickets/kit-202-lost-enter-retries/` on this branch.

## How to verify

`node --test --test-concurrency=2 test/accounts.supervisor.test.mjs` (with `DEVTEAM_*` unset). The new test checks:
- a Claude Code-shaped pane and a boxless pane whose footer, agent list and shell count change (the shell count eventually goes away) get their second and third Enter;
- a rule above the text isn't taken for a footer;
- a busy footer, or a spinner above seven agent lines, gets no Enter and keeps its record.

The new test fails on the old code at "Enter 2 of 3".

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
