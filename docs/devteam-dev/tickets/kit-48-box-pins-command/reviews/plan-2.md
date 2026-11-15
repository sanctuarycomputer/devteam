# Plan review, pass 2

- Reviewer: plan-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: 1698fde6afa319987814b7db05123d28afddd1ef (plan.md, against spec.md as approved in spec-4)

I read the plan at 1698fde, pass 1's record and its fix diff (c989c4a..1698fde), `ticket show kit-48-box-pins-command` (the top-level done_when set), quality.md §3 and §6, cloud/Dockerfile's pin block (66-136) and stamp (515-525), and the head of test/machine.test.mjs (imports, `baseEnv`, the `bin` stubs).

What holds:
- F1: `pinsCopy` rewrites every `ARG <P>_VERSION=`, `_SHA256_*=` and `DEVTEAM_RELEASE=` line to `FIXED` before the edit. Every T1 edit still finds its target. `^(ARG TTYD_SHA256_X86_64=)\w+$` and `^ARG GH_SHA256_AARCH64=\w+\n` match a fixed hex sum. The gh URL text (`download/v$GH_VERSION/gh_${GH_VERSION}_linux`, line 98) and `# ttyd, the web terminal` (line 76) are not ARG lines, so the rewrite leaves them alone. `ARG DEVTEAM_RELEASE=` sits at line 519 with no indent. The expected strings agree with `FIXED`: `2.104.0` for gh, claude-swap at `1.0.0` against a TTYD set to `1.0.0`, `stale 1.7.7 -> 1.7.8`, `TTYD_VERSION ${FIXED.TTYD}`, ttyd's latest kept at 1.7.7 for "already current", and `v0.1.0` older than `v0.52.0`. `fixedSum(arg)` is distinct per ARG, so no sum collides with another or with a literal. Only the real-file case reads the real pins, through a regex.
- F2: the plain tags 1.9.0 (prerelease) and 2.0.0 (draft) can only be excluded by their flags, and 1.6.9 after 1.7.8 still covers the max-not-first case.
- F3: the TL;DR names `pinsEnv`, and T4 and T5 both spawn with it. It now matches the tasks.
- F4/F5: the download half is in T3, and `hits` record headers. The download test asserts no authorization under `/dl`, `/assets`, `/npm` or `/pypi`.
- F6-F12: `pinsAsync` is named. `safe` is in T1. The arrayBuffer departure is stated. `upstream(t)` unrefs and closes. The expected T1 failure is corrected. The fakes are chmodded 0o755. `UV_TOOL_DIR` is deleted. There is a mode and `unchanged` test.
- Every done-when has a task and a test. DW1 is T1's exit-2 case (pinsRepo has no `cloud/`) plus the fixture server. DW2 is T1's cases. DW3 is T2. DW4 is T3. DW5 is T4 (image path, shims first on PATH, uv gated on `UV_TOOL_DIR`, cwd no repo). DW6 is T5. DW7 is `pinsEnv`.

What doesn't hold: F1's fix makes the tests survive a real bump, but not a real hold (F1 below). A hold is the other edit this command invites on cloud/Dockerfile, and the Dockerfile's own comment (line 71) tells people how to add one.

Values and refusals: checked at the spec stage. The fixes add no behaviour.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Important | done-when 1 (CI passes); spec Contracts (the hold is a supported edit of cloud/Dockerfile) | T1 `pinsCopy` | `pinsCopy` rewrites the pin values but carries any `# hold:` line over from the real file. When a real hold lands (e.g. `# hold: <reason>` above `ARG UV_VERSION=`), several tests break. T2's "stale for all six → status 1" sees `uv: held`. T3's hold-on-uv test stacks a second `# hold:` line, so the first is "not directly above a _VERSION ARG", verify refuses, and bump exits 1. T1's "hold above MISE_VERSION" cases break if mise is the one held. This is the same failure path as plan-1 F1, through the other edit the feature exists for. Fix: have `pinsCopy` also drop every line matching `/^\s*#\s*hold\b/i` before `edit`, so tests start hold-free and add only their own. | fixed: pinsCopy drops every hold-like line before the test's edit |
| F2 | Minor | plan Interfaces (plan-1 F6) | T2, the paragraph after Step 1 | It still says "Each test spawns asynchronously (`execFile` promisified)", which contradicts T1's `pinsAsync`. Promisified `execFile` rejects on a non-zero exit, which most of these tests expect. Say `pinsAsync`. | fixed: T2 names pinsAsync |
| F3 | Suggestion | | T2 Interfaces "Produces" | `safe` is still listed as T2's, as well as T1's (plan-1 F6 moved it). Drop it from T2. | fixed: safe listed under T1 only |

Verdict: CHANGES 1698fde6afa319987814b7db05123d28afddd1ef
