# Final review: kit-100 inbox in panel (pass 1)

- Reviewer: kit-100 final reviewer (fresh subagent of the supervisor, not the author; model claude-opus-5-5)
- Reviewed: 6869ad0b7c4e9a068b0bfa85ea82aff90c20d855

## Findings

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Important | done-when 5; spec §2.10 (the cards and their handlers unchanged); design "The Threads sidebar" (below 900px the sidebar and the peek each take the full width) | docs/devteam/dashboard/index.html:179 and :194 (`.drawer` z 21 under `.threads` z 22), :922 (`.shell.av-open .threads` z 23 over `#artifact-view` z 22) | At 900px and below, a link inside the Inbox tab opens its peek **under** the full-width panel, so nothing visible happens. Probe at 720x800 and 390x844 on `#goals?th=inbox`: clicking a lesson card's evidence link `#observation/<id>` sets the hash, `#drawer` is shown (0 to 720 / 0 to 390), and `elementFromPoint` at the drawer's centre is inside `#threads`; the screenshot shows only the panel. The same holds for the Answered list's `#q/<id>` links and any item link a card draws, and for `#artifact/...` (the viewer opens under the panel, its × covered). At 1440 the peek opens beside the panel and is fine. Before this PR the Inbox was a page and these links opened over it, so this is a regression this ticket introduces by moving the cards into the panel. No test clicks a link inside `#th-inbox` below 900px. (Above 900px, the viewer's × under the open panel is kit-89's known gap: `--av-right` is set at :924 and unused, the narrowing is a later ticket's.) | fixed in 9f6997a: at 900px and below a peek or the viewer opened over the open panel marks it and the panel goes under the scrim until it closes; the panel opening clears the mark; test at 720 and 390 by x, Escape and Back, and the reverse |
| F2 | Important | spec §2.3 (`th=inbox` with an in-panel `t` is rewritten to `th=open`), §4 edge case | index.html:7101 (`thDecide`); test/dashboard-inbox-panel.test.mjs (fixture thread `S` built, never used) | Untested behaviour with a broken result. Mutation: `(!s.th \|\| s.th === 'inbox') && tlInPanel(t)` back to `!s.th && tlInPanel(t)`: the whole new test file passes (10/10). My probe on that mutant: `#overview?th=inbox&t=<S>` stays on the Inbox tab, `TL.open === S`, with S's card in `#th-card-slot`, which is hidden on the Inbox tab, so the thread the link names opens invisibly. At the head the same load becomes `#overview?th=open&t=<S>` with the card shown. A test needs to load `th=inbox&t=<S>` (cold and by a hash change) and assert `th=open` and the in-panel card shown. | fixed in 2eea237: test of th=inbox and t=S cold and by hash change, asserting th=open and the card shown; times out under the named mutation |
| F3 | Minor | spec §2.7 (Escape in an Inbox text field closes nothing) | index.html:5253 | The document-level line this PR adds (`if (!AV && !RV && inboxTyping(document.activeElement)) return;`) can be deleted and every test passes: the tests cover the panel staying open and pin mode, never a peek open beside the panel. Probe on that mutant at 1440: a peek open beside the panel on Inbox, focus in q2's note, Escape: the peek closes. At the head it stays. Add a peek case to the Escape step. | fixed in 919c6e8: the Escape step adds a peek beside the panel at 1440; fails with the document line deleted |
| F4 | Minor | spec §2.2 (`inboxCount` leaves out questions answered on this page, `ANSWERED`) | index.html:7644 | Dropping the `ANSWERED` filter survives the new test file. The count would lag after an answer until the next data read. No test checks the tab, the button or the title count right after an answer. | fixed in ec33e0c: a data read begun before an answer and landing after it is faked; the tab, button and title say 8; with the filter removed they say 9 |
| F5 | Minor | observation o-20261117-053019024; spec §2.2 (the four tabs) | the panel's tab row (`#th-tabs`) | With four tabs, the row is wider than the panel. Probe: at 1440 the Shell tab spans 1290 to 1341 against a tab row ending at 1305, and its centre is covered by the head buttons. At 390 it spans 230 to 281 against 255. A sliver "S" / "Sh" shows beside the Pin button (shots/light-1440.png). Supervisor shows whole at every width, and Inbox and Threads are always whole and clickable. **Acceptable to ship as is:** both cut tabs are disabled placeholders, nothing the owner can use is lost, and it is logged for the goal that fills them. | wont-fix: the reviewer judged it acceptable to ship; the cut tabs are disabled placeholders, logged as o-20261117-053019024 for the goal that fills them |

## What I checked

**Scope and rules.**
- The worktree is detached at 6869ad0b and clean. Its merge-base with origin/main is origin/main (f8c7e5f), so the branch is up to date.
- Every changed file outside `docs/devteam-dev/tickets/kit-100-inbox-in-panel/` is in the ticket's touches: index.html, test/lib/kit.mjs, test/browser/dev-links.mjs and ten test files.
- The only new file outside the records folder is `test/dashboard-inbox-panel.test.mjs`, which is under test/, so the owner's no-new-files rule holds.
- `devteam.mjs` is unchanged.
- The PR body on GitHub matches `pr-body.md` and has `## One-way doors` / None.
- CI at 6869ad0 is green on all 17 checks (`gh pr checks 321`).
- verification.md names 7f52249 as its code head. The two commits after it change only pr-body.md and verification.md.

**Baselines on the box** (only the touched files, under the shared lock, judged by exit code):
- `dashboard-inbox-panel.test.mjs`: 10 pass, 0 skip, 248 s.
- `dashboard-measure.test.mjs`: 4 pass, including "the Inbox in the panel at three sizes".
- `dashboard-peek.test.mjs`: pass.
- `dashboard-shell.test.mjs`: pass.

**Mutations** (index.html, one at a time, restored with `git checkout`). The test file run is dashboard-inbox-panel unless noted.

Caught:
- `askEscCancels` without the exit/quit exclusion: the AC5 page check and the vm test.
- The Esc body with an extra `option`: AC5.
- The Esc button never `disabled`: AC5. The click inside the arming second posts nothing, so "Esc posted" times out.
- In-panel pins without the fixed/viewport branch: AC4.
- `.tl-pin.in-threads` z-index removed: AC4, the pin is under the panel.
- The red count rule removed: AC1.
- `tlOwn` treating `#th-inbox` as the layer's: AC4 Shift+click.
- `thOpenRow` dropping `th=inbox` below 900: AC4 at 720.
- The delegated `a[href="#inbox"]` handler off: AC2.
- The floating card not clipped to the panel's edge: AC4, the 10px gap.
- The in-threads card hidden at 900 and below: AC4 at 720.
- `holding()` back to kit-89's `#tl, #threads` rule: AC5 typing.
- The pin not hidden when its card scrolls out of `#th-body`: AC4.
- `tlInPanel` without the Inbox-home case: AC4.
- The open `#q/` link pushing instead of replacing: AC2 history length.
- The Inbox button opening Threads: AC1.
- The `inbox` redirect removed: AC2.
- 0cfa580 reverted (the viewer over a review not lifted): dashboard-peek 14 and 15 fail.
- The closed ⋯ menu's `.pop` left in layout: measure test 4.
- `#th-inbox` cards forced 420px wide: measure test 4.

Survived:
- `thDecide`'s `th=inbox` case: F2.
- The document Escape line: F3.
- The `inboxCount` ANSWERED filter: F4.
- Cold `leaveReview` back to `#inbox`: equivalent, since the `inbox` redirect serves it.
- `#th-inbox` shown regardless of `TH.th`: equivalent, since a closed panel selects `threads`.
- `.why` set to `nowrap`: the fixture's chips fit in 348px, so the measure can't see it.

**The page, driven at 1440x900, 720x800 and 390x844.** My own probe test files (kept in my scratch folder) use the PR's `inboxFixture` and `test/lib/chrome.mjs`, plus one committed artifact. The PR's tests don't drive 390 or a viewer over the panel. The dashboard listened on 127.0.0.1 above 40000.
- **Opening.** The Inbox button opens `#goals?th=inbox` on the Inbox tab, with `scrollWidth === clientWidth` at all three sizes. Cards fill the slot (1062 to 1394 at 1440, 2 to 344 at 390) and none overflows.
- **Switching tabs.** Threads gives `th=open` and hides `#th-inbox`. Inbox brings it back.
- **Answering.** q2 Answer (1440), q3 Done (720) and q6 Can't right now (390) each remove the card. The tab, the button and the title counts agree (8 or 7).
- **Close and Back.** × gives `#goals` with the panel closed. Back reopens `#goals?th=inbox`. A later cold tab opens on the remembered `th=inbox` (spec §4).
- **A peek over it.** At 1440 the peek sits beside the panel (drawer 340 to 1060, panel from 1060). Escape with no field focused closes the peek and leaves the panel. At 720 and 390 the panel covers the peek: F1.
- **The viewer over it.** The viewer opens under the panel at every width. At 1440 its × is covered (kit-89's known gap). At 720 and 390 the whole viewer is covered (F1). Escape closes it.
- **A review.** Opened from the Inbox card it is full size (1382 / 720 / 390 wide) and above the panel, and its × is reachable. The pins in the panel sit under it.
- **0cfa580.** A viewer over a review is z 26 and its × is reachable at all three sizes.
- **Not this PR's.** A second viewer in the same visit doesn't close by ×. That is the known frame-history quirk dashboard-peek.test.mjs works around.

**Spec §2.9 against the supervisor's instruction.**
- `askEscCancels` is byte-for-byte kit-241's `paneEscCancels` regex (devteam.mjs:17229).
- It reads only `q.hint`. No esc flag is served, and `devteam.mjs` is not in the diff.
- It is tested with kit-241's four hint fixtures ('Esc to cancel', 'Enter to confirm · Esc to exit', 'Esc to cancel · Esc to quit', 'Enter to confirm', the same as pane-question.answer.test.mjs:398), in vm and in the page. The page test checks the body is exactly `{ digest, escape: true, token }` and the copy.
- It is armed like the options (shared `off`). This matches the instruction.

**Page-top at 1440 only.** verification.md says so, with o-20261116-111831635 and ruling m-20261117-051515268. The measure entry runs every other check at all three sizes and passes. This is acceptable as stated.

**AC7 inventory.** I checked it against the mock's kit-100 and Inbox notes (artifacts/dashboard-cleanup/index.html:722, :736). Every item is asserted in the panel by "the inventory, in the panel" or the migrated files, as verification.md lists. "Don't use this sensor" and the review card's changed-since-asked error are reached by no test, before or after this PR. Both moved unchanged.

**Not this ticket's, for the record.** At 390, after a peek closes, a page pin placed while the peek removed the scrollbar stays 11px past the page (scrollWidth 386 against 375). This also happens with the panel closed, so it belongs to the thread layer (kit-88/89), not to this PR.

Verdict: CHANGES 6869ad0b7c4e9a068b0bfa85ea82aff90c20d855
