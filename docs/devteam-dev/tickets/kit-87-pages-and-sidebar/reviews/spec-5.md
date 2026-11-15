# Spec review, pass 5

- Reviewer: spec-reviewer 5 (fresh subagent, claude-opus-5-5)
- Reviewed: d983556db153300ad121f555b187be2ddd3ee110 (spec.md; cold confirm of spec-4)

Read: the diff 549cc97..d983556 of spec.md and the spec at d983556; spec-4 with its dispositions; the ticket's done-whens (`ticket show`, top level); the page's threads-core and threads-layer at d983556 (`tSubjectAt`, `T_SUBJECT_KEYS`, `tFit`/`T_WHOLE`, `tWhere`, `tKey`, `tPins`, `tlStart`, `tlHome`, `tlTargetRect`, `tlGoTo`, `tlClose`, the card note ~5323, `tlPins`, `tlDock`'s `gone`); the server's `subjectProblem`, `subjectWords`, `subjectIds`, `threadDataFrame`; the mock at main `67fde8f` (rows `data-pt="set-<key>"`, title `Setting · <name> (<key>)`, the wide-width wrap rule) and `8e59d9f` (`limitControl`); quality.md §3.

Spec-4's findings:
- F4-1 resolved. Under ruling `m-20261115-202400898` the subject is a page subject, so no kit refuses it. `subjectProblem` accepts `{kind:'page', view, quote}`: page keys are view, at and quote, and only view is needed. `view` is checked only as text of at most 200 bytes, and `#settings?key=` plus a 64-character key is under 80. `quote` (the plain name) fits within 300 bytes, and no `at` is fine. On the page, `tFit` keeps `view` whole (`T_WHOLE`, cap 200). An older kit's dashboard reads such a thread without error: `tWhere` gives "the dashboard", `getElementById('settings?key=…')` finds nothing, so there is no pin, and the card still opens. `devteam.mjs` and `log.schema.json` are out of touches, as the ruling says.
- F4-2 resolved. §8's new bullet names a setting branch for each page-subject switch that would otherwise misread `#settings?key=<key>`. `tWhere` would read "the dashboard" because `settings?key=…` is in no `T_SECTIONS`, and the spec gives "Settings, <plain name>". `tlTargetRect` would look up an id that doesn't exist, and the spec uses the row's box. The pin place in `tlPins` now goes at the row's top right, which needs a branch, since today's page pin sits at the box's top left. `tlGoTo` and `subjectHead` scroll to the row and mark it, and the card note covers a row that isn't drawn. Because `tKey` has no `at`, each key gets its own key, `page:#settings?key=k:undefined:undefined`. Reusing the open thread is now said to be new and for setting rows only. `tlClose` is not on the list, but §4 already routes it (lines 49 and 67: a page subject's view goes through the router, which drops `key`), so closing lands on `#settings`. The server's " on the dashboard" stays, and the supervisor still sees `subject.view` and `subject.quote` in `threadDataFrame`.
- F4-3 resolved: the title is "Setting · <plain name> (<key>)" in §8 and in check 8, as in the mock.
- F4-4 resolved: §8 says a long value wraps at any width (`67fde8f`'s `.set-row .r` max-width 55% and overflow-wrap).
- F4-5 resolved: `quote` holds the plain name, and the subject has no `at` (§8, Calls made).
- F4-6: the disposition "wrong" stands, because the schema no longer changes.
- F4-7 resolved: "+ or − from No limit gives 1" matches `limitControl`'s `Math.max(1, (null ?? 0) - 1)`.

Done-when 8 as reworded is met by §8 and check 8: Shift+click starts or opens a thread, the subject is `{kind:'page', view:'#settings?key=<key>'}`, the title carries the plain name and the key, and opening the thread scrolls to the row and marks it. The mocks agree. No new Critical or Important defect.

Values: R1 is not crossed: a setting thread is a conversation, and the two limits still change only through `kit-85`'s path. R2 holds: the dock reads "Settings, <plain name>". P2 holds: a page subject works in every instance with no server change.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F5-1 | Minor | quality.md §3 (the test asserts what the spec says) | Acceptance check 8 | Check 8 says the read-back subject "is" `{"kind":"page","view":"#settings?key=<key>"}`, but §8 also sends `quote` (the plain name), so a deep-equal assertion as written would fail on a correct build. Say the subject has kind `page`, view `#settings?key=<key>`, `quote` the plain name and no `at`. | |
| F5-2 | Minor | spec §8 ("each place that branches on a page subject") | spec §8, "What the thread layer does with a setting view" | The list leaves out two places the build must change, both named in F4-2 (c) and (d). `tSubjectAt` must check `[data-setting]` before falling back to the section spot (today it knows only `[data-subject]`, else it records `#settings` with an `at`). `tlStart` keeps `el` only for an item (`hit.subject.kind === 'item'`). The behaviour is stated in the bullet above, so this is completeness only. Add both to the list. | |

Verdict: APPROVE d983556db153300ad121f555b187be2ddd3ee110
