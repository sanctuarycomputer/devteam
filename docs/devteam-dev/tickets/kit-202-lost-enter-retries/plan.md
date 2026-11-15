# kit-202 plan

## TL;DR

- Fix the lost-Enter rescue's "pane changed" check so it ignores the harness chrome: the footer, the agent list and the shell-count status line.
- One helper, `paneBody(lines, tail)`: cut everything below the input box's last rule line (only when the typed text isn't below it), drop shell-count and token-counter lines, then take the last 8 lines.
- `resendLostEnter` uses the body for the tail check and the digest; the busy and menu guard looks at both the raw bottom 8 and the body (wider, never narrower).
- TDD in `test/accounts.supervisor.test.mjs`: a new test with a boxed pane and a boxless pane whose chrome changes between presses must get three Enters, plus a footer-only busy marker that gets none. It fails first on today's code.
- The existing tests in that file stay byte-for-byte unchanged.
- Two files touched, no file added. Gate: run the one test file locally at --test-concurrency=2 with DEVTEAM_* unset, then test.yml on CI through `gate ci`.

## Files

- `docs/devteam/scripts/devteam.mjs`: lost-Enter block (~2876–2955).
- `test/accounts.supervisor.test.mjs`: one new top-level test, appended.

## Task 1: failing test (red)

Append to `test/accounts.supervisor.test.mjs` a test `"the supervisor's own pane: a lost Enter is pressed again while only the harness chrome changes, never into a busy footer"` (`{ skip: !hasTmux }`), reusing the same helpers as the existing lost-Enter test (`fixture('sup-chrome')`, a `pane(shown)` that kills and redraws window `sup-chrome` and points `supervisor-pane`/`supervisor-pane-role` at it, `deliver`, `later`).

Cases:

1. **Boxed pane, chrome changes.** `text` the same as the existing test. Pane A:
   ```
   ⏺ The plan names each one as stricter than before.
   ✻ Cogitated for 20s · done 9:56 PM · 1 shell still running
   ────…(60)
   ❯ <text>
   ────…(60)
   ⏵⏵ bypass permissions on · 1 shell · ↓ to manage
   ◯ general-purpose  Re-review Task 2 fixes   20s · ↓ 46.1k tokens
   ```
   deliver(3600), tick → `\r`. Redraw as pane B (same content and input; `2 shells still running`, footer `⏵⏵ bypass permissions on · PR #671 · 2 shells · ↓ to manage`, `● main`, agent `1m 5s · ↓ 52.3k tokens`, a second agent line `◯ Explore  Find the footer  4s · ↓ 1.2k tokens`), `later()`, tick → `\r\r`. Redraw as pane C (another timer), `later()`, tick → `\r\r\r`; the record is gone; one more tick → still `\r\r\r`.
2. **Boxless pane** (another harness): `⏺ Earlier output`, `> <text>`, `1 shell running`, `◯ agent  12s · ↓ 3.1k tokens`; then redraw with `2 shells running` and `40s · ↓ 9.8k tokens`. Three Enters across three ticks, as above.
3. **Busy only in the footer:** the boxed pane A with footer `⏵⏵ bypass permissions on · 1 shell · esc to interrupt`; deliver(3600), tick → no key.

Run: `env -u DEVTEAM_TICKET -u DEVTEAM_ROLE -u DEVTEAM_RUN -u DEVTEAM_SUPERVISOR -u DEVTEAM_HOME -u DEVTEAM_FEATURE node --test --test-concurrency=2 test/accounts.supervisor.test.mjs` (as a script file). Expect cases 1 and 2 to fail at the second Enter on today's code; case 3 already passes (the guard reads the raw bottom). Commit.

## Task 2: the fix (green)

In devteam.mjs, beside `squash`:

```js
// The harness's own chrome, not the pane's content: a box-drawing rule (the input box's border),
// a running-shell count, a token counter (an agent's list line or status). They change on an idle
// pane, so the lost-Enter rescue neither digests them nor looks for the text in them.
const PANE_RULE = /^[─-╿]{8,}$/;
const PANE_TOKENS = /[↑↓]\s*[\d.,]+k?\s+tokens\b/i;
function paneBody(lines, tail) {
  let end = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) if (PANE_RULE.test(lines[i].replace(/\s+/g, ''))) { end = i + 1; break; }
  // text below the last rule: no box under the input, so nothing below it is a footer
  if (end < lines.length && squash(lines.slice(end).join('')).includes(tail)) end = lines.length;
  return lines.slice(0, end).filter((l) => !PANE_SHELL.test(l) && !PANE_TOKENS.test(l)).slice(-8);
}
```

In `resendLostEnter`: `const raw = lines.slice(-8); const body = paneBody(lines, tail);` The digest is computed from `body`, the tail check uses `body`, and the busy guard is `[...raw, ...body].some(...)`. Update the block comment ("bottom lines" → "the pane's body: its lines above the harness footer, without its status counters"). `PANE_SHELL` is declared above (line ~2838) and `PANE_BUSY` stays where it is. Both are `const`s at module level, read only at call time.

Run the same test file: all tests pass, the existing ones unedited (`git diff` on the test file shows only additions). Commit.

## Task 3: verify and finish

`gate test` on the one file; push; `gate ci -- <watch the PR's test.yml run>`, never piped and never `-- true`; verification.md with a row per done-when at a named commit; `git diff --stat origin/main` shows exactly the two files plus records; final review from a fresh reviewer; check-ticket; merge-request.

## Risks

- `paneAsking`/`clientActiveOn` unchanged. Widening the guard to the body can only skip a press, never add one.
- If `─` lines in other content sit below the input with the text above them (an odd harness), the cut drops them from the digest. They're static, so the worst case is the same as today.
