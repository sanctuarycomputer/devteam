# kit-100-inbox-in-panel: verification

- Code head verified: `919c6e8c063bdfe668166ea47d36996e814712e7` (after final-1's fixes; before them, `7f5224928e4b7c7ba12a5963e7ccda5868aa23bf`) (branch `ticket/kit-100-inbox-in-panel`, origin/main merged at `ae0b5de`).
- CI: run [44051233381](https://github.com/sanctuarycomputer/devteam/actions/runs/44051233381) at `919c6e8`: **success** on attempt 2, every job (gate ci passed in 296.3s). Attempt 1 failed only `kit (20, chain)`: `test/lib/chain.mjs:1331`, the incidents test, whose 1.8 s verify window a slow poll can miss. That is no kit-100 code; observation `o-20261117-090355027`. Both attempts were recorded with `devteam.mjs gate ci -- gh run watch 44051233381 --exit-status`.
- Earlier CI: run [44029386866](https://github.com/sanctuarycomputer/devteam/actions/runs/44029386866) at `7f52249`: **success**, every job (gate ci passed in 275.2s). It was recorded with `devteam.mjs gate ci -- gh run watch 44029386866 --exit-status`. The Chrome jobs run on Node 22 and 24, so this ticket's browser tests run there, with none skipped.
- On the box, only the touched files were run, one at a time, on `/usr/local/bin/node` (Node 22, Chrome present, 0 skipped). The full suite is CI's.

## The done-whens

| AC | What shows it | Command | Result | Commit |
|---|---|---|---|---|
| 1. The tab and the button | `test/dashboard-inbox-panel.test.mjs` › "the tab and the button": the tab ids `inbox, threads, supervisor, shell`; the Inbox tab reads 9 in `--red`; `.tt` opens `#overview?th=inbox`; `#th-inbox` holds the terminal card, the 7 cards, the review, the lessons, the secrets and the collapsed Answered list; the `.tt` count equals the tab's; switching Threads and Inbox; a reload of `#goals?th=inbox`; not in `.no-shell`; closing hides it, no pins, and `scrollWidth === clientWidth` (ruling below) | `env -u TMUX HOME=$(mktemp -d) /usr/local/bin/node --test --test-concurrency=2 test/dashboard-inbox-panel.test.mjs` | local at `919c6e8`: 11 pass, 0 fail, 0 skip; CI: success | `919c6e8` |
| 2. The nav and the roads | same file › "the nav and the roads": no `#inbox` nav link, Project group order, `SHELL_ROUTES.pages` has no inbox; `#q/<id>` on Board gives `#board?th=inbox` with the card in view, and Back closes it; a cold `#q/<id>`; read-only peeks for answered, defaulted and withdrawn; `#inbox` and `#questions` are redirected by replaceState (history length, Back), read from the shell-routes block | same | same | `919c6e8` |
| 3. `th=inbox` and the old spot | same file › "th=inbox" and "a thread on a question" (thread `P`): `goal` is kept; no `?th=inbox` redirect keys; `P` is listed as "Inbox", opens `th=inbox&t=P`, and has no pin | same | same | `919c6e8` |
| 4. A thread on a question | same file › "a thread on a question", plus the vm test "a question's home is the Inbox tab": the pin inside `q1`'s card and above the panel; it stays put after a page scroll of 400 and a `#th-body` scroll of 100, and hides when scrolled out; the card's right edge is at or left of the panel; the row from `#goals?th=open`; a cold `#talk/<Q>`; at 720 the card shows over the panel; Shift+click starts a draft with subject `question:<id>`; no pin over the tab bar; at 720 the page's pins stay under the panel | same | same | `919c6e8` |
| 5. Every control from the panel | same file › "every control from the panel", plus the vm test "askEscCancels gives paneEscCancels's answers": Answer (and the pin leaves), note Send, Done, Post, Reply, Can't right now, Overrule, Keep it, Retire it, the standing-rule box, the lesson note, the terminal's numbered option, **Esc** (§2.9: shown for `Esc to cancel` and posting exactly `{ digest, escape, token }`; not shown for kit-241's other three hints), typing that survives a held redraw and a threads poll with caret kept, Escape in a note keeping the panel open, the review wider than the panel and back to Inbox on close | same | same | `919c6e8` |
| 6. The measure | `test/dashboard-measure.test.mjs`, entry `#settings?th=inbox` at 1440x900, 720x800 and 390x844 on every shell.md §9 check, with a 120-character unbroken link in a choice. The interim `#inbox` entry is removed. **page-top is judged at 1440 only** (below) | `env -u TMUX HOME=$(mktemp -d) /usr/local/bin/node --test --test-concurrency=2 test/dashboard-measure.test.mjs` | CI: success | `919c6e8` |
| 7. Nothing lost | the checklist below; same file › "the inventory, in the panel" (`685f7e4`), and the screenshots in `shots/` | as AC1 | local: 10 pass, 0 fail, 0 skip | `919c6e8` |
| 8. Existing tests | the migrated files: `dashboard.test.mjs`, `dashboard-pages`, `dashboard-shell`, `dashboard-threads-sidebar`, `dashboard-peek`, `dashboard-answers`, `dashboard-owner-action`, `pane-question.answer`, `next-step.strategy`, `test/browser/dev-links.mjs` (the list is in `t6-migration.txt`). Inbox reads and navigation move to the panel; card assertions are unchanged | CI | success (run 44029386866) | `919c6e8` |
| 9. The `/view/` tab | same file › "/view/": `#tt-peek` opens on Threads; the four ids; the Inbox count equals hello's; one link "Answer questions on the dashboard." to `/#overview?th=inbox`; `#th-inbox` stays hidden; `/api/data` is never asked | as AC1 | as AC1 | `919c6e8` |

## CI failures at the first merged head, and their fixes

Run [44024354197](https://github.com/sanctuarycomputer/devteam/actions/runs/44024354197) at `ae0b5de` failed. The causes, each found before its fix:

- **`dashboard-shell` test 3** (every Node version). An interim assertion: it listed the removed `<section id="inbox">` among the fenced regions. Now it asserts no `id="inbox"`, and that `#th-inbox` is unfenced. `a061366`.
- **`dashboard-peek` 14 and 15** (Node 22 and 24). **A product bug from T5.** Lifting `#review-view` to z 25 put it over the artifact viewer (z 22), so a viewer opened from a review drew beneath it, and its close button was covered. The fix: `.app:has(main.reviewing) ~ #artifact-view:not([hidden]) { z-index: 26; }`. 15 failed only because 14 left the viewer open. `0cfa580`.
- **`dashboard.test.mjs` 9** (one job). A race: `#questions` now slides the panel in, and the test clicked before it was at rest. It now waits for `#threads` to be at rest, as T6 did for this file's other Inbox tests. `4948898`.
- **`dashboard-threads-sidebar` 2** (one job). A race in kit-89's two-Escape step: the second Escape could land before the hash change from the first had routed. It now waits for `TH.t === null`. Test only. `7f52249`.

## Final review 1 (CHANGES at `6869ad0`) and its fixes

- **F1, `9f6997a`.** At 900px and below, a peek or the viewer opened from inside the Inbox tab was under the full-width panel. Now one opened over the open panel marks it (`th-under-peek`, `th-under-av`), and while it is up the panel sits under the scrim, with its pins and card hidden. The panel opening clears the mark. Above 900px nothing changes; the review lift (z 25) and 0cfa580 (z 26) hold. Test, "a peek or the viewer over the panel below 900px": 720 and 390, closing by ×, Escape and Back, and the reverse (the panel opened from a peek). The viewer case uses a test-drawn `#artifact/` link, at 720 only, since the fixture commits no artifact. Red at `86cf7f8`, green after.
- **F2, `2eea237`.** `th=inbox&t=<S>` is tested cold and by a hash change. It becomes `th=open`, with S's card shown. The test times out under the reviewer's `!s.th` mutation.
- **F3, `919c6e8`.** The Escape step adds a peek beside the panel at 1440, with focus in a note. Escape keeps the peek. The test fails with the document-level line deleted.
- **F4, `ec33e0c`.** A data read that starts before an answer and lands after it is faked. The tab, `.tt` and the title read 8; with the `ANSWERED` filter removed they read 9.
- **F5.** Not fixed: the reviewer judged it acceptable to ship (`o-20261117-053019024`).
- **Known, not fixed.** At 720, if the panel is opened from a peek and then closed, × on the peek steps back to the peek with the panel open again. That comes from the history entries, not the layering.
- Local at `919c6e8`: `dashboard-inbox-panel` 11 pass, 0 fail, 0 skip; `dashboard-peek` 37 pass, 0 fail, 0 skip.

## AC7: the inventory, item by item

"inv" is `test/dashboard-inbox-panel.test.mjs` › "the inventory, in the panel"; "ctl" is › "every control from the panel".

- [x] Question card head, ⋯ menu (ID, asked, kind, order, score): inv (ID, Asked, Kind, Order, Rated, Copy ID).
- [x] Why-ranked chips and "Why you": inv.
- [x] Choices with Recommended, the sure percentage, the effect line: inv (`q1`: "Recommended", "80% sure", the effect line).
- [x] The note box and the standing-rule box: inv (the rule box is absent on the owner-action), ctl (both ride on the answer).
- [x] "Next time, for decisions like this": inv, with its rungs.
- [x] The default and deadline line: inv.
- [x] Answer, Send, Post, Reply, Can't right now: inv, ctl.
- [x] "Changed since asked" on a link: `test/dashboard-answers.test.mjs` (`data-links-moved`), run in the moved element.
- [x] Shift+Enter answers: `test/dashboard.test.mjs` ("Shift+Enter in a question box presses its Answer") and `dashboard-answers`, now in the panel.
- [x] A refused answer's reason, kept until dismissed: `test/dashboard.test.mjs` ("Not saved:") and `dashboard-answers` (`data-refused`, Dismiss).
- [x] Owner-action cards with a button per named record: `test/dashboard-owner-action.test.mjs`. Done itself is in ctl.
- [x] Lesson cards (Keep it, Retire it, the note box, the technical wording): inv, ctl.
- [x] Review-page cards (Open the review, Send it back with a reason): inv, ctl (Open the review). The changed-since-asked error is drawn by the same unchanged `reviewCard` code; it is not reached by this fixture.
- [x] The secrets form (Post, Reply, Can't right now): inv, ctl. **Don't use this sensor**: drawn by the unchanged `questionCard` line only for a sensor's secrets question (`q.sensor`), which no dashboard test reaches. No test clicked it before kit-100 and none does now. The element moved; the markup and its handler (`data-dontuse`) didn't.
- [x] The terminal's card, a button per numbered option, and Esc: inv, ctl. The usage-limit line: inv (a faked `kind: 'limit'`).
- [x] The collapsed Answered list, each answered card, and Overrule on a defaulted one: inv ("Answered (3)", Overrule on the defaulted card only), ctl (Overrule).

## Screenshots (`shots/`, the panel on Inbox)

`light-1440.png`, `dark-1440.png`, `light-390.png` and `dark-390.png`, at 1x and under 100 KB each. Dark comes from CDP `prefers-color-scheme: dark`. At 390, `scrollWidth` is 390. They show one thing to know: with four tabs, the tab row is wider than the 360px panel. Shell scrolls beneath the three head buttons, and Supervisor is cut. Both are disabled placeholders today, so this is logged as observation `o-20261117-053019024`, for when the follow-on goal fills them.

## Rulings that shape the checks

- **page-top at 1440 only.** The measure entry judges `page-top` only at 1440. This is the known kit-wide skip, `o-20261116-111831635`: kit-87's nav row puts every shell page 104px below the bar under 900px. A follow-up ticket measures page-top at 720 and 390 (ruling `m-20261117-051515268`).
- **`scrollWidth === clientWidth`** stands in for the spec's `=== innerWidth`. Chrome draws a classic scrollbar, so `innerWidth` counts the scrollbar while the layout width doesn't.
- **Added after approve-spec:** spec §2.9 and AC5's Esc bullet (ruling `m-20261116-041710126`).
