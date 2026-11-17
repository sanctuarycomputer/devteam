The dashboard's side peek moves onto the shell's frame (dashboard-shell@1). It slides in and out, opens with the record's properties, says how the record changes, holds no permanent action, and every row and card opens its record.

## What changes

- **The frame.** `#drawer`/`#scrim` drop `no-shell` and use the block's `peek-open` state. `peekShow`/`peekHide` slide the peek over `--dur` with `--ease`; a reopen during the slide-out cancels the hide, a closing peek lets clicks through, and a safety net hides it if the slide's events never come. The header is `.drawer-head` at `--bar-h`, level with the page bar, with the type's icon and chip and the × at the right. The scrim is `--backdrop` with a 4px blur, shared with the artifact viewer, previews and reviews (`overlay-open`). A mirror of the Inbox button (`#tt-peek`) sits left of the peek above 840px.
- **Properties first.** Every peek kind starts with `section.attrs` (ID first, a tooltip on every key, shown on keyboard focus) and a How it changes row routed per case: Correct on its row in Self Improvement (only for rows the Decide tab draws), Corrected by, Reply in its thread, the supervisor drafts governance, or Start a thread. Sections are cards; History is last, also for missing and loading records.
- **Nothing permanent.** Retire it starts a thread about the lesson; Overrule lives only on the Inbox's Answered card (a defaulted question's peek links there); an open question opens the Inbox at its card. Only a goal's hold controls, its impact form and today's Correct write.
- **Every detail stays.** One assertion per item of the design's peek inventory (263 rows).
- **Rows and cards.** Board, incident, goal, Loop and Sensors cards and Progress rows open their peek on a click or Enter; each card has one ⋯ menu with Open in side peek and Copy ID; goal cards lose their Open link; `peekFor(kind, id)` gives a record's peek hash for dbTable rows.
- **The measure.** One peek of each kind under `dashboard-measure`, at 1440x900, 720x800 and 390x844.

## How to verify

- `node --test test/dashboard-peek.test.mjs` on Node 22 (Node 18 skips the Chrome cases): the frame, properties, writes, the inventory, rows and cards.
- `node --test test/dashboard-measure.test.mjs` for the measure; `test/dashboard-shell.test.mjs` holds both shell blocks byte-identical to hub.html.
- Open the dashboard, open any record: it slides in from the right; Escape or the scrim slides it out.

Departures from the spec, each ruled and recorded in `verification.md`: milestone and wave IDs keep today's routing keys; peek entries in the measure point `view` at nothing, as kit-87's page entries do, since the pages under them are not converted yet; the Inbox mirror hides below 840px rather than 760px.

Records: `docs/devteam-dev/tickets/kit-88-side-peek/` (spec, plan, reviews, verification).

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
