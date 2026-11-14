# kit-203 verification

Tested at `6db5711` (the branch with `origin/main` merged), unless a row says otherwise. Every run used Node 22.23.4 (`/usr/local/bin/node`) and headless Chromium, prefixed `env -u DEVTEAM_RUN -u DEVTEAM_HOME -u DEVTEAM_ROLE -u DEVTEAM_TICKET -u DEVTEAM_FEATURE TMUX_TMPDIR=$(mktemp -d)` (ruling m-20261114-221830547-supervisor).

| Done-when | Command | Result |
|---|---|---|
| 1. Words with no pick, on a question with choices and a recommendation (doors included), show the inline ask before posting; a choice posts `"<label> — <words>"`, None posts the words alone | `node --test --test-name-pattern 'asks which choice' test/dashboard.test.mjs` | pass, 8/8 (7 subtests): Something else + words → the ask, nothing in the log; the ask survives redraws; a radio pick removes it; a choice posts `Yes — agreed, keep it`, `matched: true`, with the standing rule and seen hash; note only → the ask, None posts `not sure yet`, `matched: false`; note emptied → nothing posted, error shown; the ask stays on the copy that raised it (thread or Inbox). Also 3 consecutive passes at `efb22d6`. |
| 2. The kit is unchanged; the supervisor gains no way to say a typed answer matched | `git diff --stat origin/main...HEAD` | only `docs/devteam/dashboard/index.html`, `test/dashboard.test.mjs` and this ticket's records change; `docs/devteam/scripts/devteam.mjs` (`doorAgreed`, `questionView`'s `matched`) untouched |
| 3. A dashboard test drives the card: typed words with no pick on a door show the inline choice, the post carries the picked label, None posts the words unchanged | as row 1 | pass; mutations by the task reviewer (removing the ask from `questionCard`; forcing `ASKS[id] = 'q'`) each made subtests fail (reviews/task-1.md) |
| 4. test.yml passes on every job; no file is added | see below | **deferred to CI** on the PR, for the reason below; no production file is added (row 2) |

## The full suite on this machine

test.yml's three steps (`kit.test.mjs`, `bounds.test.mjs`, the rest), run through `devteam.mjs gate` at `32fba8f`:

- **kit**: 80/82 pass. The failure was `monitoring: … a few slow answers among fast ones are not slow` (timing). Rerun alone at `efb22d6`: pass.
- **bounds**: 1/3 pass. The failures were coverage (722 ms against a 500 ms bound) and search (timing), at load average ~19. Rerun at `efb22d6`: coverage passes; search still failed once at load 9, then passed at both `origin/main` and the branch when run alone.
- **rest**: 457/507 pass. The 49 failures are in `operator-threads` (16), `pane-question` (6), `gateway` (2) and `dashboard` (25). This machine is a devteam box: `/opt/devteam/gateway.mjs` exists, and `PORT`, `DEVTEAM_PREVIEWS` and `DEVTEAM_PUBLIC_URL` are set. The kit's `onBox()` then refuses the owner verbs these tests drive ("on a box the owner writes to the operator only on the hub's Overview…"), and the relay and preview tests meet the box's own preview set-up. CI is never a box.
- **dashboard.test.mjs, `origin/main` against the branch** (same env, same box): the same 25 failures on both. The only difference is this ticket's new test. In that run it failed one subtest, a race in the test, not the page: the error line was read after a redraw. Fixed at `efb22d6` by reading it while the page is held still.

So this box can't run test.yml green: its own environment fails tests on `origin/main` too. The gate for done-when 4 is the PR's CI, every job green at the head.
