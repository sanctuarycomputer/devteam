# Final review, pass 1

- Reviewer: final-reviewer (fresh subagent, claude-opus)
- Reviewed: 2e02abc6542e52b2e1ae3bae370f2a9ee6b26076 (PR #242)

**Summary.** I read the ticket, spec, plan record, verification, task reviews and PR body, viewed both screenshots, and read the full diff of `docs/devteam/dashboard/index.html` and `test/dashboard.test.mjs` with the code around it: `TS`/`tsSet`, `showArtifact`, `avHint`/`avFpSeen`, `openArtifact`, `closeArtifact`, the `#av-reload` handler, `route`, `loadNow`, `viewerArtifact`/`viewerBoot`, `tArtFpNow` and `tsSubject`. `/usr/local/bin/node --test --test-name-pattern "reload button says" test/dashboard.test.mjs` at this head passed 3/3 (the test and both subtests).

Done-whens:
1. **The check and the outline: met.** The dashboard takes the fingerprint from the Library rows after each `/api/data` read (the `loadNow` hook). A viewer tab asks `/api/view` every 10 s while visible, for main or a draft only, one ask at a time, aborting after 15 s, dropping a reply when the stage has moved on. The test checks the outline's computed colour equals a probe's `var(--amber)` in light and in emulated dark (the two differ), the 2px width and the title. The screenshots show the outline in both schemes.
2. **Press clears it, nothing reloads by itself: met.** The frame still shows the old `<title>` when the hint appears and again 3 s later; after the press it shows the new one, `stale` is off and the title is back to "Load the page again". The reload handler copies only fingerprints it knows.
3. **The dashboard test: met.** Both hosts, a press before the first check, and a tree never asked about. Per the task reviews, the T1-1 and T1-2 mutations and the removed tree guard each fail it.
4. **CI and no file added: partly evidenced.** No file is added outside the ticket folder; changes are limited to index.html and the test plus records. All 8 test.yml jobs were still pending when I checked; the merge gate covers it.

Behaviour in context:
- **Thread "changed since" (`tArtFpNow`) and new threads (`tsSubject`).** `TS.fp` stays the fingerprint the frame loaded; before this change it was set only at open (`route()` runs only on the first read and on `hashchange`). "Changed since" works as before, and new threads carry the fingerprint of what is on screen. Reload moves `fp` and `mainFp` forward, matching the frame after the press.
- **Previews, close, switching stages.** Each goes through `tsSet`, which clears both new fields and calls `avHint`. The reload handler leaves previews alone.
- **The owner's framed wrapper.** It shows only trees, so it never polls. In the framed case where a draft is gone (a 404, shown "held"), the tab polls and gets 404s, which change nothing.
- **Code style.** Comments and names match the file. The new poll avoids the names the existing viewer test forbids; that test passed in the whole-file gate run at 7f62d29 and the code is unchanged since. Nothing project-specific.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec acceptance check 3 (flake risk) | test/dashboard.test.mjs, viewer-tab subtest, "no check yet when pressed" | The assertion that only boot's `/api/view?` has been asked depends on the frame loading and the press landing within the first 10 s tick after `tlRefresh`. On a very slow runner it could fail: a flake, not a false pass. | accepted: the load and press take about 1 s against a 10 s window, and a failure is loud; if CI shows it, the fix is to press on the first `ready` |
| F2 | Minor | spec Edge cases (ruling m-20261115-013720113) | docs/devteam/scripts/devteam.mjs, the `/api/view` comment | The comment still says `/api/view` is "never polled"; the supervisor ruled to leave it for kit-106, outside this ticket's touches. Noted so it is tracked. | ruled (m-20261115-013720113): left for kit-106; the supervisor tells fast-threads |

Verdict: APPROVE 2e02abc6542e52b2e1ae3bae370f2a9ee6b26076
