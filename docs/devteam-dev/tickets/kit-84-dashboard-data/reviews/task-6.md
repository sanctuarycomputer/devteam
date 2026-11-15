# Task 6 review, pass 1

- Reviewer: task-reviewer-6 (fresh subagent, claude-opus-5-5)
- Reviewed: 5806232108b3970eee6874823ba91eacef582b16

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T6-1 | Minor | quality.md §3 (a security branch has a test) | test/dashboard-data.test.mjs:470-488; docs/devteam/scripts/devteam.mjs:689 | The `names` kind's `'[withheld]'` branch is never exercised. Every planted object key (`test`, `site`, `web`, `params`, `restart`) passes `plainSettingText`, so a mutation of line 689 to return each key raw would pass the suite. A plant such as a sensor or link id of `'ghp_' + 36` characters, asserted to read `'[withheld]'`, would pin it. The code is right as written; nothing leaks today. | fixed at ac1ab4b: main carries a second sensor whose id is a ghp_ token; sensors.value reads ['web', '[withheld]'] and the token appears nowhere |
| T6-2 | Minor | spec §6 vs plan | docs/devteam/scripts/devteam.mjs:715; spec.md §6 "What is shown" | Spec §6 says a withheld `value` entry "is shown as `hidden`, with `withheld: true`". The brief says the entry gets `value: null, withheld: true`, and the implementation keeps `shown: 'value'` (the test asserts 29 `value` kinds with `release` and `tmux_session` withheld, :520, :542). Nothing leaks either way, and the brief governs the task. The supervisor should record which wording the page builds on (or amend the spec line). | wont-fix the approved plan keeps shown as the setting's kind and marks a withheld value with withheld: true and value: null, which is what the page reads to show it hidden; no value leaks either way |

Checked:
- Leak paths, kind by kind:
  - `value` (devteam.mjs:688): shape first, then every string, keys included (`settingStrings`, :685, walks strings, array items and `Object.entries` keys and values, recursively), through `!UNSAFE_TEXT && scrubText(s) === s` (:683). A key with no shape gets `undefined`, so it is withheld (fails closed).
  - `names` (:689): `Object.keys` only, each scrub-checked. `count` (:690): a number. `hidden` and the 'Other' fallback: `null` (:691, :713).
  - `local` (:716-718): it goes through `shownAs` too. For hidden or unnamed keys, `null === null`, so `local` is never added. `default` (:724-726) holds only kit constants. The hidden commands' defaults are string literals in SETTINGS_DEFAULTS (`'claude --dangerously-skip-permissions'`, `'claude --continue …'`, `''`, `null`, `''`), with no environment read. `upstream_repo` and 'Other' read `null`.
  - `source` is a constant. `settingsAll` prints and throws nothing: `git` returns null on failure (:146-157), and `own` catches the JSON error (:704).
  - The one pre-existing path, loadSettings' `die` on a working-tree block that won't parse (:861), is not new here: `scrubExtra` and the rest of dashboardData already call loadSettings.
- `release` shape (:673 with releaseProblem :5265-5276): a `{branch}` object with any other key is refused (keys.length === 1), and so is an `{on, paths}` object with any other key. A non-string `branch`, a non-array or empty `paths`, and `null` are all refused. Nothing throws on any JSON input. `undefined` is refused explicitly.
- PLANTED11 (`release.token`) is stopped by that shape. The report's table is wrong in one place: `settingName`'s regex (:665) does allow `_`, so the `ghp_…` tmux_session plant passes the shape and is withheld only by the scrubber's `gh[pousr]_[A-Za-z0-9]{20,}` rule. That is good news: the scrub half of the value check is exercised by the test (:486, :542).
- Review Focus 5:
  - `agent_command: 42` is hidden, so no `local` and no `42` (asserted at :552-553).
  - `max_active_tickets: 'lots'` fails `settingNum`, giving `local: null, local_withheld: true` (:554).
  - `settingName` and `upstream_base` check `typeof === 'string'` before the regex, so a number is never coerced.
- Implementer call 1, withheld against withheld (:710): this reveals only whether two raw values are equal, on the owner's own page, never either value. It is the minimal fix for the brief's self-contradiction in case (c). Accepted.
- Implementer call 2 (owner `sensor_scrub` patterns in the check): this fails closed. Accepted.
- Keys: SETTINGS_KEYS (:611) is exactly the brief's expression. The test reads the union from source by regex and asserts it has 44 keys (:457). It asserts the read-site scan finds no key outside it, and that no SETTINGS_WORDS key is stale.
- All 29 defaults equal their shown defaults (:525). This also proves that every `value` key has a shape and that no default is withheld.
- Words: a script compared all 44 brief lines (key, show, name, description) with the SETTINGS_WORDS literal (:617-662). All 44 are identical and in identical order. The test asserts the group order (:519).
- The 'Other' fallback and its order: the sort uses the index in SETTINGS_WORDS, else Infinity. A NaN from Infinity minus Infinity compares as 0, so the sort is stable in key order. The self-test removes `tick_minutes` and asserts the Other/hidden/null entry, that it comes last, and `badWords` = `['tick_minutes']` (:563-578).
- Carried ruling: `settings_all` was added to Task 5's single `/api/data` assertion (:429).
- The log bytes are compared before and after (:508, :580).
- Only `docs/devteam/scripts/devteam.mjs` and `test/dashboard-data.test.mjs` changed (diff stat).
- I did not re-run the suite. The verdict rests on reading the code plus the word-comparison script, with no doubt that needed a focused run.

Verdict: APPROVE 5806232108b3970eee6874823ba91eacef582b16
