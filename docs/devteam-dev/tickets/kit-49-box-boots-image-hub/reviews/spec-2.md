# Spec review, pass 2 (cold confirm)

- Reviewer: spec-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: 909051b4be3f06094c50c3aa73d0ad3f224d59f5 (spec.md)

## What I checked

I read `git diff 3f1a966 909051b -- spec.md` against each spec-1 finding and its disposition, and checked the changed text against the code it relies on.

- **F1: fixed.** `new-window -d -t '=home:'`, with `has-session -t =home` and `list-windows -t =home` left alone. Those two take a target-session, so they are right. There is also a real-tmux test case with another session's window named `home`. The test file already isolates its tmux server (`TMUX_TMPDIR` in `baseEnv`, `tmuxSh`), so "on the test's own server" can be built. The latent dashboard-loop bug is noted as an observation. That is the right scope.
- **F2: fixed.** `sleep 1` after each failed try. The fake curl exits 7 at once, so the 1 s test is bounded, takes about 1 to 2 s, and can't hang.
- **F3: mostly fixed.** The value is passed only when it is wholly `vN.N.N`, else `''`, and there is a `v0.52.0-rc1` test. One gap is left: `grep -x` checks line by line (F2-1 below).
- **F4: fixed.** The release is computed inside `hub_window`, and the tests pull `note()` and set `HOME`.
- **F5: fixed.** The README's operator paragraph is now part of Acceptance 5.
- **F6: fixed.** The test runs from REPO, reads `TAG` from `ARG DEVTEAM_RELEASE`, and takes the `run: |` block by indentation.
- **F7: fixed.** The line goes after `sleep 60`, and the loop's comment names the fresh-server case.
- **F8: fixed.** The wrapper adds `-u DEVTEAM_HOME -u DEVTEAM_RUN -u DEVTEAM_PROJECT -u DEVTEAM_HUB_PORT`, and the spec names what isn't defended (P6).

**Did the extra `-u` flags break anything?**
- `hub` is machine-wide in `devteam.mjs`, so it never needs `DEVTEAM_HOME`, `DEVTEAM_RUN` or `DEVTEAM_PROJECT`. With `DEVTEAM_HUB_PORT` unset, `HUB_PORT` falls back to 4320, which equals `DEVTEAM_IMAGE_HUB`, the port the wait polls.
- `onBox()` and `threadsNeedGateway()` read the box's files, not those variables, so box-mode press checks are unchanged.
- `env` still gets all of its `-u` options before the `PATH=` assignment, so the command is valid.
- The done-when's three `-u` and the root PATH are all still there, so DW1/DW2's "carries the env -u wrapper" is met as a superset. The literal DW1 string is no longer one contiguous substring, though (F2-2).

Nothing else changed. Values and refusals are as in spec-1: none is crossed, and P6's one line is now present.

## Findings

| # | Severity | Finding | Disposition |
|---|---|---|---|
| F2-1 | Minor | Spec How, "The release is expanded…": the check is `grep -xE 'v[0-9]+\.[0-9]+\.[0-9]+'`, and grep matches line by line. A value with a newline and one good line (`v0.52.0` + newline + anything) passes, the whole value goes into the single-quoted command, and the claim "nothing in it can break the quoting" is then false. The source is the image's own ENV (a build arg), not something an agent sets, so this is Minor. Fix: test the whole string with `case` (accept only `v[0-9]*.[0-9]*.[0-9]*` with no character outside `[v0-9.]`), or compare grep's output to the value, or reject a value that contains a newline. The test can add a two-line value next to `v0.52.0-rc1`. || Taken into the plan: the whole value is checked with a case pattern and any newline refused; a two-line value is a test case. |
| F2-2 | Suggestion | Acceptance 1: with four more `-u` flags between `-u NODE_REPL_EXTERNAL_MODULE` and `PATH=`, ticket DW1's quoted wrapper no longer appears verbatim. It is still met as a superset. The test should assert each part (the three done-when `-u`, `PATH=/usr/local/bin:/usr/bin:/bin`, `/usr/local/bin/node /opt/devteam/kit/scripts/devteam.mjs hub`), not the old literal. verification.md should say it is a superset (spec-1 F8), so the final reviewer doesn't take it for a dropped done-when. || Taken into the plan: the test asserts each wrapper part; verification.md says the wrapper is a superset. |
| F2-3 | Suggestion | Acceptance 2's real-tmux case catches F1 only if the session holding the window named `home` is the one tmux picks as current (the most recently created or used), as in spec-1's probe. Create `home` first and the other session after, then check by mutation that dropping the colon makes the case fail (quality.md §3, "Where a test can't prove a property, mutate the code"). || Taken into the plan: the other session is made after home (current), and a no-colon mutation is run and must fail the test. |

Verdict: APPROVE 909051b4be3f06094c50c3aa73d0ad3f224d59f5
