# kit-202: the lost-Enter rescue keeps retrying while the typed text is still stuck

## Problem

`resendLostEnter` (devteam.mjs, the lost-Enter rescue) presses Enter on text the kit typed that still sits unsubmitted in an idle pane. After the first press it presses again (up to three in all) only while a sha1 "digest" of the pane's bottom 8 non-empty lines matches the digest stored at the last press: a reply, a submission or someone typing changes the bottom, and the rescue ends.

The bottom 8 lines include the harness's own chrome, which changes by itself on an idle pane:

- the footer below the input box (`⏵⏵ bypass permissions on · 1 shell · ↓ to manage`, with `PR #671`, `2 shells`, etc. appearing and going);
- the background-agent list below the footer (`◯ general-purpose  Re-review Task 2 fixes  20s · ↓ 46.1k tokens`, a ticking timer and token count);
- the status line above the box (`✻ Cogitated for 20s · done 9:56 PM · 1 shell still running`).

So the digest changes between ticks, the rescue drops its record after try 1, and the text stays stuck (operator report o-20261114-215952756, three times in one day; saved pane /data/home/tmp/sb-pane.txt). A long agent list can also push the input itself out of the bottom 8 lines, which reads as "submitted" and ends the rescue the same way.

## Design

From the captured lines (`lines`, the last 15 non-empty trimmed lines, unchanged), the rescue works out the pane **body**, which is the pane without the harness chrome:

1. **Cut the footer.** Find the last *rule line*: a line made only of box-drawing characters (U+2500–U+257F, the same range `squash` drops) and at least 8 long. That's the input box's bottom border (Claude Code draws `────` above and below the input; older versions draw `╰───╯`). Everything below it is footer and agent list, and is cut. But it is cut only when the tail of the typed text is *not* below that line: if the text sits below the last rule, there is no box under the input (another harness, or a horizontal rule in the output), and nothing is cut.
2. **Drop chrome lines.** From what's left, drop lines that are harness status rather than content: `PANE_SHELL` (the existing "N shell(s) (still) running" pattern), and token counters (`↓ 46.1k tokens`, `↑ 2.4k tokens`). This covers the status line above the box, and the footer and agent lines of a harness with no box.
3. **Body window.** `body = (the result).slice(-8)`.

The rescue then uses `body` where it used `bottom`:

- **tail check** (is the text still there?): `squash(body.join('')).includes(tail)`;
- **digest** (stored at a press, compared before the next): sha1 of `body.join('\n')`.

The **guards are kept and widened, never narrowed**: no Enter while `PANE_BUSY` or `Enter to confirm` shows on any line of the raw bottom 8 (`lines.slice(-8)`, as today, which is where Claude puts `esc to interrupt`: in the footer) *or* of `body`; `paneAsking(target)` and `clientActiveOn(target)` are unchanged. The caller's `PANE_WAITS` and trust checks are untouched.

Everything else is unchanged: `LOST_ENTER_SECONDS`, `LOST_ENTER_TRIES`, the claim/put-back protocol, the record shape (`bottom` still holds a digest), the log observation.

### Why this keeps the reply-below case

That test's pane is `> text`, `⏺ Done.`, rule, `❯ `, rule, footer. The cut drops only the footer; the body holds the echo, the reply and the input line. A changed reply (`Done, and more besides.`) or a typed line (`❯ and next could you`) changes the body digest, so the rescue ends after its one Enter. This is why the ticket's notes rule out "lines up to the text tail": the reply sits below the echoed text.

## Acceptance checks (the done-whens)

1. A pane whose input still holds the typed text, while only the footer, the status line's shell count and the agent list change between ticks, gets its second and third Enter. Test (in `test/accounts.supervisor.test.mjs`, built like /data/home/tmp/sb-pane.txt; the file itself isn't read or copied): (a) a Claude Code-shaped pane (content, `✻ … · 1 shell still running`, rule, `❯ <text>`, rule, `⏵⏵ bypass permissions on · 1 shell`, an agent line `◯ general-purpose … 20s · ↓ 46.1k tokens`) is redrawn between presses with `2 shells`, `· PR #671 ·`, another agent timer and tokens, and an extra agent line; three Enters in all, then it stops. (b) The same with a pane that has no box (another harness): `> <text>`, then a shell-count line and an agent token line that change; three Enters.
2. The existing reply-below test (`the echo of a submitted line, then the bottom changes after a press…`) passes with no edit to it.
3. No Enter while a menu or busy marker shows: the existing "left alone" cases pass unchanged, plus one new case where the busy marker is only in the footer below the box (`⏵⏵ bypass permissions on · esc to interrupt`), which the raw-bottom guard catches.
4. test.yml passes on every job at the PR head; no file is added (only devteam.mjs and accounts.supervisor.test.mjs change, plus this ticket's records).

## Edge cases

- **Stored digest from the old kit**: a record pressed once by the old code holds an old-style digest; the first compare after the upgrade mismatches and the rescue ends, as it does today. A one-time loss, no wrong press.
- **A rule in the output with no input box under it**: the text is below that rule, so nothing is cut (step 1's condition).
- **The text is in an echo above the box and also nowhere below**: that's the reply-below shape; the cut is safe because the text is above the rule.
- **A reply whose only change is a line matching a chrome pattern** (e.g. it prints "2 shells running"): not seen as a change. Any real reply also writes other lines, and the worst case is one extra Enter on an idle pane holding the same text, which is what the rescue is for.
- **A long agent list** (more than 7 lines below the box): the body comes from above the cut, so the input stays in view as long as it is within the 15 captured lines.

## Contracts

None provided or consumed. The `run/sent/*.json` record shape is unchanged.

## Out of scope

- Capturing more than 15 lines, or a different capture for the supervisor's own pane (`resendSupervisorLostEnter` passes its lines through the same function and gets the fix for free).
- Recognising other harnesses' footers by name; the rule-line cut and the chrome patterns are agent-agnostic.
- Retyping text, or any change to when the first Enter is pressed.

## Rulings

- m-20261115-223902572 → m-20261115-223911915 (supervisor): touches are `docs/devteam/scripts/devteam.mjs` and `test/accounts.supervisor.test.mjs` (kit-212 split accounts.test.mjs).
- m-20261115-214243300 (supervisor, lesson k-20261115-214154316): review rounds are capped. After a second round, fix and dispose Minor findings with no further pass; a third pass only confirms a Critical or Important fix.
