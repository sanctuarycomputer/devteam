# Task review, pass 2 (cold confirm of T1–T12)

- Reviewer: task-reviewer 2 (fresh subagent, claude-opus-5-5)
- Reviewed: 09d4816dbd781b25aee86d2834aeb3933270a339 (diff 2b83346)

I read pass 1, `git show 2b83346` and the rows of shell.md it touches. I ran `/usr/local/bin/node --test --test-concurrency=2 test/dashboard-shell.test.mjs` once, with `DEVTEAM_*` unset: 16/16 passed, and the Chrome test really ran (3.1s, not skipped). I probed the new comparator in plain `node`. I edited nothing else.

- T1 holds: `opts` joins `prose` and `ignore` onto the defaults and replaces only `view`, `bar`, `title` and `inbox`. shell.md says so. The new test reads the serialised options, which kills the replace mutant. It checks the inputs rather than a wide `p` caught in Chrome, but that is enough.
- T2 holds: the override is now the last rule in both blocks, `:where(.shell) .dot.red.pulse:not(…)` at (0,3,0), the same weight as the pulse rule at index.html:107. The fixture has a red pulse dot, and the Chrome test asserts `shell-ring`, then `none` and `--dur: 0ms` under emulated reduce, then resets. Narrowing from `.dot.pulse` to `.dot.red.pulse` loses nothing: the block animates only the red dot.
- T3 holds: `escHtml` is asserted exactly on all five characters. Every text-taking builder (tabBar id/label/count, dbTable column, props key/tip, goalSteps text/title, heartbeat item, fleetSwitch scope/busy/error) is fed `x"&<y>'z` and checked for the escaped form, with no raw `x"` anywhere. A builder that skips `escHtml` in any attribute fails.
- T4 holds: `label` is in the guard, and shell.md lists it. A button, a label, and Enter on a button in a row are tested and open nothing.
- T5 holds: `parseHead` dropping foreign keys is asserted directly on `.state`, and `headFor` is given an out-of-order state.
- T6 holds: every `@keyframes` name in the block is enumerated and must be exactly `['shell-ring']`. Each name is checked against both pages for a `@keyframes` or `animation` use. A second keyframe now fails the `deepEqual`.
- T7 holds: `EXTRA` adds a left-edge overflow break (`marginLeft: -60px` on `#small p`, which moves only the left edge) and an Inbox-side header-pad break (`paddingRight: 24px`). Each runs after a clean measure and must report its check by name.
- T8 holds as a wont-fix: the approved plan's fixture puts the builders on the shell side only. The scope test proves every block selector carries the fence on its subject, so whether builders or hand-written HTML fill the fenced region makes no difference to what the fence proof covers. Hand-written old markup is what a `.no-shell` region will actually hold.
- T9 holds, with a new defect (T2-1): numbers compare as numbers and a null key is `''`. Both are tested, and shell.md's `sortRows` row says so. Pass 1 suggested falling back to the cell text for a null key; the fixer chose empty instead, which is consistent with the contract as now written.
- T10 holds: an unknown `fromId` goes Right to the first enabled tab and Left to the last. Both are tested.
- T11 holds: shell.md now says the token stays 32px and `.page` pads 16px below 900px. That matches the code and keeps `--measure`'s calc on the full-width value.
- T12 holds: Park N counts running plus draining. The test covers 4 (3+1) and the singular "1 project", and shell.md is updated.

The blocks are still byte-identical across the two pages (the equality test passes).

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T2-1 | Minor | shell.md §5 (`dbTable`/`sortRows`: "numeric-aware (2 before 10), stable") | `index.html:1041-1042`, `hub.html:449-450` (`shellNum`/`shellCmp`) | Introduced by the T9 fix: `shellCmp` is not a consistent comparator when a column mixes keys that parse as decimals with keys that don't. `"1.9" < "1.10"` falls to text order (9 before 10), but `"1.9"` and `"1.10"` both parse as numbers and compare as 1.9 > 1.1. That makes a cycle: `1.9 < 1.9a < 1.10 < 1.9`. In node, `["1.9","1.10","1.9a"]`, `["1.10","1.9a","1.9"]` and `["1.9a","1.9","1.10"]` each sort to a different order, so the display order depends on the input order. A column of two-part versions (`0.9`, `0.10`) also flips from the earlier 0.9-before-0.10 to numeric 0.10-before-0.9. It needs mixed or version-like keys, so it is Minor. Possible fixes: compare as numbers only when every key in the column is a number (decide once per sort), or treat only integers and keys from `sort` that are real JS numbers as numeric. Add a case with mixed keys. | |

Verdict: APPROVE 09d4816dbd781b25aee86d2834aeb3933270a339
