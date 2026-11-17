# Final review: kit-100 inbox in panel (pass 2)

- Reviewer: kit-100 final reviewer (fresh subagent of the supervisor, not the author; model claude-opus-5-5)
- Reviewed: ab2fa28687e3a43ebb1e26989384222bef502bff

## Findings

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F2-1 | Important | spec §2.4 (kit-88's `data-answered-go` "opens `#answered-wrap`, scrolls to `#a-<qid>` in the panel and focuses its Overrule"); final-1 F1 | index.html:924-931 (`th-under-peek`), :7210 (`thShow` clears the mark only when the panel *moves* open) | F1's fix is incomplete for Inbox roads taken from a peek that is on top of the panel. Probe at 720x800 on `#goals?th=inbox`: open the Answered list, click the defaulted question's `#q/` link, and its peek opens on top (`th-under-peek`). Click its "How it changes" link (`data-answered-go`), and `inboxGo` runs, but the panel is already open, so `moved` is false and the mark stays. The peek stays on top: `elementFromPoint` at the tab bar is in `#drawer`, the hash is unchanged, and **the focus moves to `input[data-overrule]` in the hidden panel**. What the owner then types goes into an Overrule box they can't see, and Enter could send it. At 1440 the same click works (the panel is beside the peek). The same holds for any Inbox road from a peek opened over the panel (`a[href="#inbox"]` in a lesson peek). The mutation removing the `thShow` clear line survives the new subtest, so that line is untested too. Fix direction: an Inbox road (`inboxGo`/`thGo` to `th=inbox`) taken while a peek or the viewer is marked over the panel clears the mark (or closes the peek), plus a test at 720 for the `data-answered-go` path. | fixed in 91f3a6a: inboxGo marks the road (TH.front) and thShow clears the on-top mark when the panel moves or is fronted; the peek stays open under it and x brings it back; 720 test for How it changes and the lesson peek's Inbox link, red at ab2fa28 and with the thShow clear line removed |
| F2-2 | Important | enforcing configuration (CI on the PR) | PR #321 checks at ab2fa28 | CI is red at the reviewed head. `kit (22, rest 2/2)`, `kit (24, chain)` and `tests` fail in run 44052950797; the other 14 pass. origin/main has moved since the branch's merge-base f8c7e5f: kit-274 "kit records at home", which changes `devteam.mjs`, and release prep v0.64.2. That may be the cause, but I did not read the run's logs, which is outside the read-only gh commands my brief allows. verification.md's green run (44051233381) was at 919c6e8, before that. Main needs merging and CI needs to be green at the head. | fixed: origin/main merged at d9253c2 (kit-274, v0.64.2); CI 44058888488 green at 91f3a6a on the first attempt; the red jobs at ab2fa28 were flakes in no kit-100 code (o-20261117-093045574, o-20261117-093045409) |
| F2-3 | Minor | — (judgement asked for) | history around a peek and the panel | The worker's known issue: at 720, × on a peek after the panel was opened from it and closed steps back with the panel open. I could not reproduce it in plain orders at 720 or 1440: peek, its Inbox link, the panel's ×, then the peek's ×, lands on the page with both closed in one step. That holds whether or not the page entry under it had `th=inbox`. The new subtest's own note puts it after an earlier viewer in the same visit. That fits the known viewer frame-history quirk (dashboard-peek.test.mjs), where the viewer's iframe left an entry, so × (`history.back()`) walks back through it. **Acceptable, not blocking:** no data is lost, a second × or Back finishes, and it is narrow and history-model behaviour, not this ticket's layering. | wont-fix: the reviewer judged it acceptable; narrow history-model behaviour after an earlier viewer in the same visit, no data lost, a second x or Back finishes |

## Verified fixes (final-1)

- **F1** (`9f6997a`). Probe at 720 and 390, the lesson card's evidence link `#observation/<id>` from the Inbox tab: the peek is on top (`.threads` z 19, `#drawer` at the centre), and the viewer opened over the panel is on top with its × reachable. Closing either leaves the panel on Inbox as it was. Above 900px nothing changed: the peek sits beside the panel, the review is z 25, a viewer over a review is z 26 with its × reachable at 1440, 720 and 390. Mutations:
  - Remove the z 19 rule: the new subtest fails ("at 720, ×: the peek is on top").
  - Remove `peekShow`'s mark: the new subtest fails.
  - Remove `openArtifact`'s mark: the new subtest fails ("the viewer is on top").
  - Remove `thShow`'s clear: **survives** (F2-1).
- **F2** (`2eea237`). Probe: `#overview?th=inbox&t=<S>` becomes `th=open&t=<S>` with S's card shown. The final-1 mutation (`!s.th` only) now fails "th=inbox" ("a hash change to th=inbox&t=S").
- **F3** (`919c6e8`). Probe at 1440: Escape in q2's note keeps the peek beside the panel. Deleting the document-level line now fails "every control from the panel".
- **F4** (`ec33e0c`). Removing the `ANSWERED` filter now fails "every control from the panel" ("the tab, .tt and the title say 8").
- **F5.** Accepted at final-1, unchanged.

## What I checked

- **Scope.**
  - The worktree is detached at ab2fa28 and clean.
  - Since 6869ad0 the diff touches only `index.html` (17 lines: one CSS block ≤900px, the marks in `peekShow`, `openPreview`, `openArtifact` and `thShow`), `test/dashboard-inbox-panel.test.mjs` and the ticket's records. All are in touches, and there are no new files outside the records.
  - The PR body still has `## One-way doors` / None. `devteam.mjs` is untouched by the PR.
- **Test runs** on the box: only touched files, under the shared lock, each command under 170 s, no orphans left (checked `ps` after the one run that hit its timeout).
  - `dashboard-inbox-panel.test.mjs`: 11/11 pass in 111 s.
  - `dashboard-peek.test.mjs` in four slices, by name and skip patterns ('the frame' 16, 'the peeks' 4+3+1, 'rows and cards' plus the label test 12): all pass.
  - `dashboard-threads-sidebar.test.mjs` in three slices, all eight tests: pass.
  - `dashboard-measure.test.mjs` was not rerun. It needs about 230 s, and the only CSS change applies under classes the measure never sets.
- **Probes at 720 and 390** (the PR's fixture and Chrome helpers, my own probe files, the dashboard on a port above 40000):
  - The button opens the Inbox tab, and switching tabs, answering (q3 at 720, q6 at 390), × and Back all behave as at final-1.
  - The peek and the viewer over the panel are now on top.
  - `scrollWidth === clientWidth`, except the pre-existing thread-layer pin after a peek at 390, which also happens with the panel closed and is not this PR's (noted at final-1).

Verdict: CHANGES ab2fa28687e3a43ebb1e26989384222bef502bff
