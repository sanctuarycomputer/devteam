# kit-82-answers-stay-visible: verification

At commit `588a31359d22c1a8e6c0ca4d23bfc631bc10e4ce` (product code and tests as of `032f4c1`, after merging `origin/main`; `588a313` adds only the PR body, and later commits change only this ticket's records). Local runs on the box used Node 22.23.4 (`/usr/local/bin/node`) with Chromium, one test file at a time at `--test-concurrency=2`, as the box rule says. CI runs the whole suite on Node 18, 20, 22 and 24.

| # | Done-when | Command | Result |
|---|---|---|---|
| 1 | `test/dashboard-answers.test.mjs` passes in CI (headless Chrome): a refused answer shows "Not saved: <reason>" on its card, still there after three redraws, gone after Dismiss; the pick and the note still in their boxes | `devteam.mjs gate test -- /usr/local/bin/node --test --test-concurrency=2 test/dashboard-answers.test.mjs` | pass 3, fail 0 (gate test ok) at `032f4c1`. RED first: before Task 1's code it timed out on "the refusal, on the card", after the answer was posted and recorded |
| 2 | The same test: a question with `links_moved` shows "<link> changed since this was asked; the supervisor will ask again" at the top of its card, Answer disabled, the note box still takes text | same command | pass, at `032f4c1`. RED first: before Task 2's code it timed out on "the moved line, straight after the card head". It also checks that Shift+Enter in the note posts nothing, and that the other card's Answer is still live |
| 3 | `test/dashboard.test.mjs` passes, changed only where it asserted the old error line | `devteam.mjs gate test -- /usr/local/bin/node --test --test-concurrency=2 test/dashboard.test.mjs` | pass 157, fail 0, skipped 0 (gate test ok) at `032f4c1`. The diff changes only the assertion at ~500, which now reads the card's `[data-refused]` line |
| 1-3 | CI, every job | `devteam.mjs gate ci -- gh run watch 43690000645 --exit-status` | 8/8 jobs success at `588a313` (kit 18/20/22/24 × rest/chain) |

## Screenshots (m-20261115-070641604-supervisor)

A refused answer staying on its card (the "Ship it?" card, with "No" and the note kept, and Dismiss), and below it a moved-link card with Answer disabled. Taken with headless Chrome over the same stubs as the test, by `screenshots/shoot.mjs` (`/usr/local/bin/node docs/devteam-dev/tickets/kit-82-answers-stay-visible/screenshots/shoot.mjs` from the repo root):

- `screenshots/refused-desktop-light.png` (1100 px wide)
- `screenshots/refused-desktop-dark.png`
- `screenshots/refused-phone-light.png` (390 px wide)
- `screenshots/refused-phone-dark.png`

Both new lines sit inside `.qcard`, which already caps its width (`max-width: var(--measure)`), so they follow the owner's running-text rule (k-20261114-214823656) as the rest of the card does.

Nothing is deferred to beta.
