# Spec review, pass 2

- Reviewer: spec-reviewer-2 (fresh subagent, claude-opus-5-5)
- Reviewed: 25d12f1e6f1876b3ace9ced67f04a58b0a811b5f (spec.md; the fixes in 384da44 to spec-1's findings)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| S2-1 | Minor | spec "The machine switch" (Escape cancels), "The partly-held pill" (Run confirms whatever the mode; pill when every goal is held but split); spec-1 S1, S2 ("test the edge", "test Escape on both switches") | Acceptance checks 1 and 6 | The fixes settle the behaviour, but the acceptance checks still don't name the tests pass 1 asked for: Escape (and the second press keeping focus) on the machine switch and on the Run confirm, the all-held-but-split pill ("Partly parked · 0 of 11 goals running"), and Run confirming on a pill card whose fleet mode isn't `run`. These are the paths the fix added, so name them in check 1 and check 6 so the plan writes tests for them. | |
| S2-2 | Suggestion | | What stays as it is (`#settings` paragraph) | "takes the `-<hex>` suffix two same-named projects take" changes `keyOf`, which today adds the suffix only for twins and lets `#overview`/`#terminal` win in `hashchange`. That's a deliberate change and it's fine, but it sits under "What stays as it is" and no check covers it. Moving it out, or adding a one-line test, would make it visible. | |

S1 resolved: one rule now (≥ 0 counts, total > 0, at least two modes above 0), the all-held split case is stated, and Run on a pill card always confirms whatever `fleet.mode` is, which matches the row switch's "except Run on a partly held fleet".
S2 resolved: every `[data-fleet]` button gets `data-k="<key>:<mode>"` (`machine` for the machine), so `paintOverview`'s focus restore (hub.html:1033-1035) keeps the keyboard on the confirm and Escape reaches the binder's keydown.
S3 resolved: a hub wrapper `div.sw` per switch, `data-k` added after building, the Run confirm sets text, `confirm`, `data-confirm="1"` and `data-confirming="1"` on `.fleet-switch` (what the binder at hub.html:547-561 checks), and `bindFleetSwitch` is bound once per new wrapper with callbacks closed over the key; the per-key state map carries confirming/busy/error across the 10 s redraw.
S4 resolved: all three `SIZES` are named, and the 720px card body is handled by flex-wrap keyed to the card's width, not a viewport rule.
S5 resolved: `showOnly`, `select`, `hashchange` and `draw()` learn the Settings view (cold load and the 10 s tick keep it), and the name clash is settled by the suffix (see S2-2).
S6 resolved: the moving count names states building, moving and `unknown` (labelled Running in `PULSE_STATES`, hub.html:528).
S7 resolved: the laptop's local test notification is marked new; the `if (box || !NOTIFY_OK` string is kept.
S8 resolved: the drop guard stays directly before `// The hub on a laptop has no box.json` with exactly two `e.preventDefault()` calls, which matches the slice at test/gateway.test.mjs:1934.
S9 resolved: `card` on the article, `kit`/`inbox`/`working`/`moved` on the stats, `fleet` on the row switch's wrapper.
S10 resolved: the key is now `hub`, not the file name.

Verdict: APPROVE 25d12f1e6f1876b3ace9ced67f04a58b0a811b5f
