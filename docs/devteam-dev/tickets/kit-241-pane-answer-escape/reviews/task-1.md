# Task review: task 1, pass 1

- Reviewer: task-reviewer-1 (fresh subagent, claude-opus-5-5)
- Reviewed: f323f8c5e920e421e7c860df166caf4dfbb21aa9 (Task 1: the whole build)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1 | Important | spec §2 (plan-1 P2); quality §3 (missing test with a plausible failure path) | docs/devteam/scripts/devteam.mjs paneEscCancels; test/pane-question.answer.test.mjs "Esc never reaches…" | The spec refuses Esc on a numbered menu whose hint names no Esc at all ("one that names no Esc, is refused"), and the code does (it requires `Esc to cancel`), but no test exercises it: the only stand-in is `Esc to exit`. Mutant h, `paneEscCancels` reduced to `!/\bEsc to (?:exit\|quit)\b/i.test(h)` (no `Esc to cancel` needed), passes every Esc test. On this risk-high owner-write path, the rule that Esc goes only where the menu says it cancels has its positive half untested, so a later "simplification" to a deny-list would send Escape to menus whose Esc nobody knows the meaning of. Fix: a second stand-in menu (e.g. hint `Enter to confirm` only, and ideally one saying `Esc to quit`) that gets a token, and Esc on it is 400 "Esc here may not cancel", with nothing typed and nothing logged. | fixed at d8173e3a471e389bcfe2e9ce009708f8921e5bd7: stand-ins with 'Esc to cancel · Esc to quit' and 'Enter to confirm' (no Esc) added to the Esc-never-reaches test; mutant (h) now fails it |

## What was checked

- Route: `paneAnswerShape` takes exactly `{digest, option, token}` (option an integer from 1 to 9) or exactly `{digest, escape: true, token}`, compared as sorted key sets. Nothing else reaches `paneAnswer`. The page (index.html:5447) and gateway.test.mjs's press already send exactly the option shape, so making the option form exact-keys changes no real press.
- paneAnswer for Esc: the shared checks are unchanged (`kind === 'menu'`, the digest, the target). The hint is checked on the `pane question` read and again on the last look. The key is `send-keys -t <target> Escape`: no `-l` and no Enter. If the menu still shows, the result is a 409 that says it may not have landed, no second key is sent, and `pane answered` gets `taken: false`, so nothing held is typed (its `if (!b.taken) return`). The option path still runs the same code and sends the same messages after the refactor into `record`/`finish`.
- pane answered: `asOption` and `asEsc` exclude each other (escape undefined vs `true`; option and label must be absent and keys must be `Escape`). On a box, the signed body must pass `paneAnswerShape`, and its digest, option and escape must match. `ownerWriter` is unchanged. The act's text and stdout match spec §4.
- Schema: only the two descriptions changed, as spec §5 says. cloud/gateway.mjs is untouched.
- R1: I found no path for anything but the owner's press (the page's token plus same-origin headers, and on a box the gateway's signature) to send Escape or write the act.

## Mutants

Each mutant ran in a scratch copy from `git archive f323f8c` with a throwaway HOME: one test file, `--test-concurrency=2`, filtered with `--test-name-pattern`.

- Unmutated, Esc tests only: 6/6 pass. Unmutated, whole file: 11 pass, 0 fail, 1 skipped (the Chrome page test, which can't run on this box).
- (a) both `paneEscCancels` checks dropped: **caught** by "Esc never reaches the usage-limit menu, a dialog with no numbers, or a numbered menu whose Esc exits" (409 where 400 is expected; the Escape reached the `Esc to exit` stand-in).
- (b) `signed.escape !== b.escape` dropped: **survives**. This is an equivalent mutant, not a test gap: `paneAnswerShape(signed)` plus the mutually exclusive `asOption`/`asEsc` mean `signed.option === b.option` already settles which form both are in. The check is defence in depth, as the spec asks.
- (c) the exact-key-set check in `paneAnswerShape` dropped (an integer option or `escape === true` passes): **caught** by "Esc: only exactly { digest, escape: true, token }…" (`{option: 1, escape: true}` returned 200).
- (d) `send-keys -t <target> -l Escape`: **caught** by the same test (the literal text is typed, the menu doesn't clear, and the test times out waiting for the held words).
- (e) `paneAnswerShape(signed)` replaced by `isObj(signed)` in pane answered: **caught** by "on a box an Esc needs the gateway's signature…" ("a signed body the route would refuse").
- (f) the Esc `why` forced to null: **caught** by "an Esc the menu does not clear is reported as an option that may not have landed…" (200 `answered: Esc` where 409 is expected).
- (g) `asEsc` takes any `keys` string: **caught** by "pane answered --owner takes an Esc only from the owner, only in its own shape" (keys `Enter` was recorded).
- (h) `paneEscCancels` no longer needs `Esc to cancel`: **survives** (T1).

Verdict: CHANGES f323f8c5e920e421e7c860df166caf4dfbb21aa9
