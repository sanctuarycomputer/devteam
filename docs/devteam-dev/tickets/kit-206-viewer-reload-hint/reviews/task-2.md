# Task 2 review

- Reviewer: task-reviewer 2 (fresh subagent, claude-opus)
- Reviewed: 7f62d296b5cb8f837d8e49828ec14fd719bd10c5 (task 2)

**Summary.** I read the `viewerBoot` change (index.html ~5705-5748), `avFpSeen`/`avHint` (~3586-3599), `showArtifact`, the reload handler, and the new viewer-tab subtest, against plan Task 2, the global constraints and spec-2 N3.

- **One ask in flight.** `asking` is set before the fetch and cleared in `finally`; a tick returns early while it is set.
- **Abort at 15 s.** An `AbortController` and a 15 s `setTimeout` cover the fetch and `r.json()`; the timer is cleared in `finally`. An abort or error lands in `catch {}` and changes nothing.
- **Stage captured at ask.** `const { slug, at } = TS` is read before the await; `avFpSeen` drops a reply whose `slug`/`at` no longer matches. A viewer tab never re-stages after boot, so the guard is defensive.
- **Tree and preview never polled.** The tick returns for `TS.kind !== 'artifact'` and for `TS.at` starting with `tree:`, before any fetch.
- **Visibility.** The tick returns unless `document.visibilityState === 'visible'`. The poll starts after `await tlRefresh()`, as planned.
- **Forbidden names.** The new code calls only `setInterval(`, `AbortController`, `setTimeout(`, `fetch(`, `r.json(`, `avFpSeen(` and `clearTimeout(`; none match `/\b(route|render|load|loadNow|loadSchemaDocs)\(/`. The "nothing else" allow-list already admits `/api/view?`; the full file passed 155/155 at this head.
- **The comment.** The boot comment names the new read (main or a draft, every 10 s while seen, one describe per ask); the inline comment gives the reason for one-at-a-time and the tree rule. Both match the file's voice and density.

**Could the subtest pass vacuously?**
- The `stale` wait can only be met by the poll: in the viewer tab nothing else sets `fpNow`, and the frame is shown never to reload by itself.
- The tree check waits for at least four `/api/threads` reads; the threads interval and the poll start in the same task, so a 10 s tick has passed. `__asked` is fresh per document, and `TS.at === 'tree:T'` rules out a fallback to main. Mutation 3 (the poll's `tree:` guard removed) fails with `2 !== 1`.
- One-in-flight, the abort and visibility cannot be driven without a slow describe or a hidden tab; reading the code confirms them, and the plan does not ask for tests of them.
- "No check yet when pressed" depends on frame load plus a press within about 10 s of boot; if it went wrong it would fail (a flake), not pass falsely. It held here under four parallel runs.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

None.

Verdict: APPROVE 7f62d296b5cb8f837d8e49828ec14fd719bd10c5
