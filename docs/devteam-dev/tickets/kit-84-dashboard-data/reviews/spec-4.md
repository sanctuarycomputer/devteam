# Spec review, pass 4

- Reviewer: spec-reviewer-4 (fresh subagent, claude-opus-5-5)
- Reviewed: 162092991b1bd44931b1767eaa5438fa76a7ad08 (spec.md; pass-3 fixes)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F4-1 | Important | done-when 6 (every setting shown); the spec's own `value` kind ("the value as main has it"); code: SETTINGS_DEFAULTS (devteam.mjs:502-588) | spec.md §6 "What is shown", the shape list (`value` kind) | The new shape rules withhold five of the 29 `value` keys at the kit's own defaults, so a fresh project's Settings page says "not shown: it doesn't look like a plain value" for values the kit wrote itself. `project: null` and `tmux_session: null` fail "a name" (only `upstream_base` is allowed null). `max_active_planners: null` ("null is no cap") and `dashboard_port: null` fail "a finite number". `worker_denied_commands` defaults to `[…, 'git push*+*']`, and `+` is outside the name pattern even with the stated `*` and space allowance, so the whole default list is withheld. The G1 fixture runs on defaults, so re-recording the golden would pin `withheld: true` for these keys. Acceptance check 6 plants only off-shape values and never checks that a default passes, so nothing would catch it. Fix: allow null for `project`, `tmux_session`, `max_active_planners` and `dashboard_port`. Give `worker_denied_commands` its own pattern that admits every character its defaults use (at least `*`, space and `+`). Add a check: on a fresh project, no `value` key is `withheld`, and each one's `value` equals its `SETTINGS_DEFAULTS` entry. | fixed: null allowed wherever a key's default is null; the list shape is any one-line printable string; an acceptance check asserts no default is withheld and each equals its default |
| F4-2 | Minor | precision; the shape rules must admit what the kit accepts | spec.md §6 shape list (`release`, `ignored_checks`) | Two shapes are narrower than, or vaguer than, the code. (1) `release`: the kit accepts `{ on: 'merge' }` with `paths` optional (releaseProblem, devteam.mjs:4884-4895: "leave paths out when every merge deploys"). It also takes `paths` as globs such as `app/**`. The spec writes `{ on, paths }` and says nothing about the elements' shape, so a worker may require `paths` or run the globs through the name pattern, and `*` would withhold a valid setting. (2) `ignored_checks` holds forge check names, which often carry spaces, parentheses and commas (`test (ubuntu-latest, 20.x)`, `CI / build`). Under "a list of such short strings" only `worker_denied_commands` gets spaces, so a normal check name is withheld. Fix: shape `release` as "`releaseProblem(r)` is null and every string in it passes scrubText" (no extra keys is already in releaseProblem). Give `ignored_checks` a check-name pattern that allows spaces, `()`, `,` and `/`. | fixed: release is checked with the kit's own releaseProblem (on: merge with optional glob paths; extra keys refused); ignored_checks takes any one-line printable name |

Pass-3 findings against the new text and the code:

- **F3-1: fixed.** The touches now name `test/fixtures/g1/dashboard-data.txt`, pending a supervisor ruling, cite kit-81's precedent and go as a `design-change`, which is the kind worker.md §"Stay inside touches" names. The false claim that the `settings` output is pinned is gone. I checked (a), whether the golden is stable:
  - `untimed` (test/lib/kit.mjs:263-264) recurses through arrays and objects. `TIMEY` matches `_at$` and `^at$`, so it drops `starts_at` and every item's `at` at any depth. The 14 days reduce to `{ items, failed }`, and there are always 14.
  - The G1 fixture writes no `merge-chore`, `merge-word` or retro line. `land()` commits the log directly, and the golden already says g1-02-b reached main with no merge act. So every day's items are empty, and an item's place in the days can't shift with the clock.
  - `held_by` on g1-01-a is a `q-…` id. `g1Norm`'s hex rule already turns those into `q-<sha>-<sha>-supervisor`, as the golden's `questions` shows.
  - `threads` is counts. `class_words` and `class_name` are static. No class id matches TIMEY, and a match would be dropped deterministically anyway.
  - `settings_all` values come from the fixture's committed settings: `project` `g1`, `worktree_files` `['config/dev.key']` (relative, so no `<tmp>`), and defaults elsewhere. `local` is absent because the working tree equals main. `source` is absent because main exists.
  - No `ooda.learning_marks` label exists in the golden, so "only added fields" holds.

  One residue: the golden would pin F4-1's withheld defaults.
- **F3-2: fixed in design.** Shape check plus scrubText, otherwise withheld, and the test plants an off-shape `release` and a `ghp_…` `main_branch`. The name pattern admits `_`, so the token passes the shape and scrubText's `[key]` rule catches it, provided the test token is 20 or more characters. The residue is that the rules were not checked against the defaults (F4-1) or against what the kit accepts (F4-2).

  On (c), scrubText changing a legitimate value: withholding fails safe, and the realistic cases are rare. They are an SSN-like or phone-like run of digits in a branch, an `@` in a path, or a project's own `sensor_scrub` pattern (SCRUB_EXTRA) matching a setting. None matters enough for a finding.
- **F3-3: fixed.** The scan's reach and why a miss is accepted are stated truly.
- **F3-4: fixed.** `count` is exactly two keys. I recounted the 29/7/2/6 split from SETTINGS_DEFAULTS, OWNER_SETTINGS and `sensor_scrub`, and it holds.

Values and refusals: P4 (secrets) is unchanged by these findings, which only over-withhold. R2 (true descriptions) is where F4-1 sits: the page would call a kit default not a plain value. Nothing writes, and nothing touches authority.

Verdict: CHANGES 162092991b1bd44931b1767eaa5438fa76a7ad08
