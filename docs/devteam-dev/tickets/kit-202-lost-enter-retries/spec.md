# kit-202: the lost-Enter rescue keeps retrying while the typed text is still stuck

## Problem

`resendLostEnter` (devteam.mjs, the lost-Enter rescue) presses Enter on text the kit typed that still sits unsubmitted in an idle pane. After the first press it presses again (up to three in all) only while a sha1 "digest" of the pane's bottom 8 non-empty lines matches the digest stored at the last press: a reply, a submission or someone typing changes the bottom, and the rescue ends.

The bottom 8 lines include the harness's own chrome, which changes by itself on an idle pane:

- the footer below the input box (`⏵⏵ bypass permissions on · 1 shell · ↓ to manage`, with `PR #671`, `2 shells`, etc. appearing and going);
- the background-agent list below the footer (`◯ general-purpose  Re-review Task 2 fixes  20s · ↓ 46.1k tokens`, a ticking timer and token count);
- the status line above the box (`✻ Cogitated for 20s · done 9:56 PM · 1 shell still running`, whose count changes or goes away when the shell ends).

So the digest changes between ticks, the rescue drops its record after try 1, and the text stays stuck (operator report o-20261114-215952756, three times in one day; saved pane /data/home/tmp/sb-pane.txt). A long agent list can also push the input itself out of the bottom 8 lines, which reads as "submitted" and ends the rescue the same way.

## Design

From the captured lines (`lines`, the last 15 non-empty trimmed lines, unchanged), the rescue works out the pane's **body** and digests only that:

1. **Cut the footer.** Find the last *rule line*: a line made only of box-drawing characters (U+2500–U+257F, the range `squash` drops; whitespace ignored), at least 8 long. That's the input box's bottom border (Claude Code draws `────` above and below the input; older versions draw `╰───╯`). Everything below it (the footer and the agent list) is outside the body. But nothing is cut when the tail of the typed text is below that line: then there is no box under the input (another harness, or a horizontal rule in the output). Call what's left `above`.
2. **Pick the body lines.** Walking up from the end of `above`, the body is the last 8 lines that aren't chrome. A line is chrome when it holds a token counter (`PANE_TOKENS`: `↓ 46.1k tokens`, `↑ 2.4k tokens`, `1.2M tokens`, which is the agent-list and spinner shape), or when it has nothing left once its shell-count phrases are taken out (a line that only says `1 shell running`). Chrome lines appearing or going don't shift the body.
3. **Normalize for the digest.** In each body line, take out every `PANE_SHELL` phrase (`1 shell still running`, `· 2 shells ·`) and fold runs of whitespace and `·` into one space. So `✻ Cogitated for 20s · done 9:56 PM · 1 shell still running`, the same line with `2 shells`, and `✻ Cogitated for 20s · done 9:56 PM` all normalize to the same text. The **digest** is the sha1 of the normalized body lines.
4. **Tail check** (is the text still there?): the tail is looked for in the *raw* lines of `above`, from the first body line to the end, chrome lines included. So typed text that itself mentions shells or tokens is still found.

**The guards are kept and widened, never narrowed.** No Enter while `PANE_BUSY` or `Enter to confirm` shows on **any captured line**: all 15, unfiltered, where today only the bottom 8 are read. That covers Claude's footer `esc to interrupt` and a spinner above the box (`✻ Cogitating… (12s · ↓ 1.2k tokens · esc to interrupt)`) however long the agent list under the box is. `paneAsking(target)` and `clientActiveOn(target)` are unchanged, and the caller's `PANE_WAITS` and trust checks are untouched.

Everything else is unchanged: `LOST_ENTER_SECONDS`, `LOST_ENTER_TRIES`, the claim/put-back protocol, the record shape (`bottom` still holds a digest), the log observation.

### Why this keeps the reply-below case

That test's pane is `> text`, `⏺ Done.`, rule, `❯ `, rule, footer. The cut drops only the footer; the body holds the echo, the reply and the input line. A changed reply (`Done, and more besides.`) or a typed line (`❯ and next could you`) changes the body digest, so the rescue ends after its one Enter. This is why the ticket's notes rule out "lines up to the text tail": the reply sits below the echoed text.

## Acceptance checks (the done-whens)

1. A pane whose input still holds the typed text, while only the footer, the status line's shell count and the agent list change between ticks, gets its second and third Enter. The test goes in `test/accounts.supervisor.test.mjs` and is built like /data/home/tmp/sb-pane.txt (that file isn't read or copied). Each redraw restarts the stand-in, so each redraw's own keys are checked (`\r`), along with the record's `tries` (1, then 2, then the record is gone).
   - (a) A Claude Code-shaped pane: content, then `✻ … · 1 shell still running`, rule, `❯ <text>`, rule, `⏵⏵ bypass permissions on · 1 shell`, and an agent line `◯ general-purpose … 20s · ↓ 46.1k tokens`. It is redrawn first with `2 shells`, `· PR #671 ·`, another timer and token count, and an extra agent line. Then it is redrawn with no shell at all: the status line becomes `✻ Cogitated for 20s · done 9:56 PM` and the footer loses its count. Three Enters in all, then it stops.
   - (b) The same with a boxless pane (another harness): `> <text>`, then a `1 shell running` line and an agent token line, redrawn with those changed and then with the shell line gone. Three Enters.
2. The existing reply-below test (`the echo of a submitted line, then the bottom changes after a press…`) passes with no edit to it.
3. No Enter while a menu or busy marker shows. The existing "left alone" cases pass unchanged, plus two new cases:
   - the busy marker is only in the footer below the box (`⏵⏵ bypass permissions on · esc to interrupt`);
   - a busy spinner with a token count sits above the box (`✻ Cogitating… (12s · ↓ 1.2k tokens · esc to interrupt)`) and seven agent lines sit under it, so the spinner is outside the bottom 8.
4. test.yml passes on every job at the PR head; no file is added (only devteam.mjs and accounts.supervisor.test.mjs change, plus this ticket's records).

## Edge cases

- **Stored digest from the old kit**: a record pressed once by the old code holds an old-style digest. The first compare after the upgrade mismatches and the rescue ends, as it does today. That is a one-time loss and never a wrong press.
- **A rule in the output with no input box under it**: the text is below that rule, so nothing is cut (step 1's condition).
- **Typed text that mentions shells or tokens**: the tail check reads raw lines (step 4), so the text is still found.
- **A reply whose only change is a shell-count phrase, or a new token-counter line**: not seen as a change. Any real reply also writes other lines. The worst case is one extra Enter on an idle pane that still holds the same text, which is what the rescue is for.
- **More presses than today, on idle panes only.** The body reaches past the footer and the agent list. So a submitted line's echo with a short reply can stay in view where today it scrolled out of the bottom 8, and the rescue then gives the empty prompt its first Enter (later ones only if the pane stays the same). Enter on an empty idle prompt submits nothing. The existing echo test already accepts that first press. The guards above still rule out any press into a menu, a busy pane, or a pane someone is at.
- **A long agent list** (more than 7 lines below the box): the body comes from above the cut, so the input stays in view while it is within the 15 captured lines.

## Contracts

None provided or consumed. The `run/sent/*.json` record shape is unchanged.

## Out of scope

- Capturing more than 15 lines, or a different capture for the supervisor's own pane (`resendSupervisorLostEnter` passes its lines through the same function and gets the fix for free).
- Recognising other harnesses' footers by name; the rule-line cut and the chrome patterns are agent-agnostic.
- Retyping text, or any change to when the first Enter is pressed beyond the window described above.

## Rulings

- m-20261115-223902572 → m-20261115-223911915 (supervisor): touches are `docs/devteam/scripts/devteam.mjs` and `test/accounts.supervisor.test.mjs` (kit-212 split accounts.test.mjs).
- m-20261115-214243300 (supervisor, lesson k-20261115-214154316): review rounds are capped. After a second round, fix and dispose Minor findings with no further pass; a third pass only confirms a Critical or Important fix.
