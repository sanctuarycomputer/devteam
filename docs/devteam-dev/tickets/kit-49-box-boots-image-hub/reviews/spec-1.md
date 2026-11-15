# Spec review, pass 1

- Reviewer: spec-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: 3f1a9669c4053bea8a10aacb35e22321feac89bb (spec.md)

## What I checked

Read the spec against the ticket's six top-level done-whens, the design's "The boot, in order (kit-49)", "Failure modes" and "Testing", and the code it changes: `cloud/Dockerfile` (devteam-dev heredoc, the stamp ARG/ENV block, the COPY lines), `box-deploy.yml`, `box-image.yml`, `test/machine.test.mjs` (the single-line pulls near line 745), `cmdHub`/`hubLogger`/`startHub` and the kit-repo gate in `devteam.mjs`, README's deploy gate and operator paragraphs, and operator.md.

**Done-whens.** Each one is restated, and none is weakened. Two points could look like changes but are fine:
- DW1's `--release "$DEVTEAM_KIT_RELEASE"` becomes a value expanded when the window is made. The spec gives the reason, and DW2's assertion ("--release carries DEVTEAM_KIT_RELEASE's value") still holds.
- DW1's "before the dashboard loop" is kept. The window goes after the operator block and the wait goes right before the `for k in …` loop, so both come before it.

The spec also adds things on top: a fake `timeout`, the ordering assertion, and a CI test of the deploy step. DW4's "before it reads HOOK" matches the step as written: verify has to come before the first line, `[ -n "$HOOK" ] || …`. That is also what makes the local check work (a matching tag prints verify's ok line, then "no RENDER_DEPLOY_HOOK", and exits 0). The inputs `(cloud docs/devteam)` cover every COPY source (`cloud/gateway.mjs`, `docs/devteam/dashboard/hub.html`, `docs/devteam`, `docs/devteam/process/operator.md`, and the Dockerfile in `cloud/`).

**The spec's own calls.**
- **Expanding the release at window creation: sound.** Running a tmux 3.3a server on a private socket confirmed the reasoning. A pane gets the server's global environment, not the environment of the client that ran `new-window`, and any `dev` process can change the global one. The kit-46 F1 note (start the hub from a folder that isn't a ticket checkout) is met by cwd `$HOME`: `standalone` makes `actionCwd` the process cwd.
- **The wait: sound, with a gap (F2).** Its target answers: `startHub` accepts Host `127.0.0.1:4320`, and it refuses `/instances.json` only for a foreign `Sec-Fetch-Site`, which curl doesn't send. The scan probes 25 ports in parallel with a 300 ms timeout each, so one answer fits inside `--max-time 1`. Matching `"hub":1` followed by `,` or `}` fits `JSON.stringify` of `listHead`.
- **The minute-loop line before `list-panes … || continue`: right.** Without it, the line would be skipped exactly when tmux has nothing to list.
- **`-n` turning automatic-rename off: right.**
- **setup-node in box-deploy: right.** ubuntu-latest's node isn't the image's 22.
- **Running the kit from a checkout in CI: works.** `box-pins` is a KIT_VIEWS command, allowed in the kit's own repo when a remote names `sanctuarycomputer/devteam` (`kitsOwnRepoAt`). actions/checkout sets origin to the repository itself, so the release job passes that check.

**tmux targeting: broken (F1).** `new-window -t =home` takes a target-window. Without a colon, tmux first tries it as an exact window name in the current session, and only then as a session. I checked on tmux 3.3a, private socket:
- With a session `home` (window 0 `operator`) and another session `other` holding a window named `home`, `new-window -d -t =home -n hub` printed `create window failed: index 0 in use` and created nothing.
- `-t '=home:'` put the window in session home.

The existing dashboard loop uses the same `-t "=$s"` form, so the bug is already present there (not this ticket's to fix). But the minute loop exists to recover the hub, so it must not depend on no session having a window named `home`. `list-windows` and `has-session` take a target-session, so `=home` is correct for them.

**Shutdown.** devteam-box's TERM trap kills the tmux server and then sleeps 2 s. If the minute loop fires in that gap, `list-windows` fails, `has-session` fails, and `new-session -d -s home -n hub` starts a fresh server. tini tears it down when devteam-box exits, so this does no harm. But the loop's existing comment says "tmux not answering (the box stopping) leaves the list as it was", and the new line breaks that expectation without saying so (F7).

**Values and refusals.**
- W3: this is the goal's reason.
- P1: the change is box-only and doesn't depend on the harness.
- P2: nothing project-specific is added.
- P3: the calls are reversible and decided, not asked.
- P4: no owner question.
- P5: nothing touches authority. The hub keeps its press checks (kit-46).
- P6: "agents can change tmux's global environment" is named and partly defended. The other variables the hub reads are left undefended (F8).
- R1: the stamp check only refuses.
- R2: the deploy refusal says what to run, and operator.md tells the operator what to tell the owner.

No refusal is crossed.

## Findings

| # | Severity | Finding | Disposition |
|---|---|---|---|
| F1 | Important | Spec "Helpers on one line each" and the minute-loop bullet: `hub_window` makes the window "in `=home`", i.e. `tmux new-window -t =home`. For a target-window with no colon, tmux tries `=home` first as an exact window name in the current (most recent) session. Verified on tmux 3.3a with a private socket: when another session has a window named `home`, `new-window -d -t =home -n hub` fails ("create window failed: index 0 in use") and no hub window is made. DW1 says the 60 s loop recreates home:hub, and this is a plausible silent failure of that. Fix: target `=home:` (trailing colon) in `new-window`, keep `=home` for `list-windows`/`has-session`, and have the test assert the `-t =home:` target, which the fake tmux can't otherwise catch. || Fixed: new-window targets '=home:'; a real-tmux test case with another session's window named home (spec, Acceptance 2, How). |
| F2 | Minor | Spec "The wait" doesn't say how long to pause between tries. At boot the hub is often not listening yet, so curl gets connection refused at once. Without a pause the loop forks curl continuously for up to 15 s. The spec also doesn't define the test's "curl that never answers". If the fake ignores `--max-time` and sleeps, the wait hangs. If it fails at once, the loop spins. Fix: specify a pause (e.g. `sleep 1` after each failed try), and specify the fake curl (exit 7 at once, or exit 28 after honouring `--max-time`), so DW2's "gives up within a few seconds" has a bounded test. || Fixed: sleep 1 after each failed try; the fake curl exits 7 at once. |
| F3 | Minor | Spec "The release is expanded…": the value is "reduced to `[v0-9.]`". Deleting characters can turn an odd value into a different value that looks valid: `v0.52.0-rc1` becomes `v0.52.01`, which passes `hub`'s `^v\d+\.\d+\.\d+$` and is served with `image: true` as a release the image isn't. Safer: pass the value only if it matches `v[0-9]*.[0-9]*.[0-9]*` and holds only `[v0-9.]` (a `case`), else pass `''`. `hub` then logs it and serves with no release (cmdHub), which is the spec's own edge case "empty or odd". || Fixed: passed only when the whole value is vN.N.N, else ''; test with v0.52.0-rc1. |
| F4 | Minor | Spec "Helpers on one line each": the test pulls `hub_window`/`hub_wait` by prefix, but `hub_wait` writes its note through `note()`. Wherever the release value is computed, it must also reach the test's `sh`. The spec should say the test also pulls the `note()` line and runs with `HOME` set to a temporary folder, as the existing boot tests do. It should also say where the sanitised release is computed (inside `hub_window`, so the line stands alone). || Fixed: release computed inside hub_window; tests pull note() and set HOME. |
| F5 | Minor | Spec "Docs" edits only "The deploy gate". README line 172 (the operator paragraph) still says the image's kit is "the kit as of the last release that changed the image". After this ticket that is false, the same as the Dockerfile comment the spec does change. DW5 says README should state that every release restarts the box, and leaving this line contradicts it. Fix: update it to say the image's kit is the latest release's. || Fixed: README's operator paragraph line is in Acceptance 5. |
| F6 | Minor | Spec DW4 "My addition" (the CI test of the deploy step): run in the kit repo, `box-pins verify` depends on `kitsOwnRepoAt` finding a remote that names `sanctuarycomputer/devteam`. A clone without such a remote, or a fixture copy, dies with "no …/settings.md here" instead of verify's answer. The spec should say the test runs the step with cwd set to the real checkout (REPO), feeds `TAG` from the Dockerfile's `ARG DEVTEAM_RELEASE` for the matching case, and takes the step's shell from the `run: \|` block by indentation. || Fixed: the test runs the step from REPO, TAG from ARG DEVTEAM_RELEASE, block taken by indentation. |
| F7 | Suggestion | Spec "The minute loop's line" says "first in the loop body". Say after `sleep 60`, as the bullet's "before the `list-panes`" implies. Also amend the loop's comment: when the tmux server is gone, the line now starts a fresh one with only the hub (including in the stop's 2 s gap before the container exits, which is harmless). Otherwise a later reader takes it for a bug against "tmux not answering … leaves the list as it was". || Fixed: after sleep 60; the loop's comment names the fresh-server case. |
| F8 | Suggestion | Spec "The release is expanded…" protects the release from an agent changing tmux's global environment. It doesn't protect against the same change to `DEVTEAM_HOME`, `DEVTEAM_PROJECT` or `DEVTEAM_HUB_PORT`. A bogus `DEVTEAM_HOME` makes `hub` die at startup in a crash loop, and `DEVTEAM_HUB_PORT` moves it off 4320. Under P6 this needn't be defended, but name it in one line, or add `-u` for those to the wrapper (a superset still meets DW1/DW2's "carries the env -u wrapper"). A transient `list-windows` failure while `home` exists also adds a second hub window. That window only retries, and the spec can just say so. || Fixed: wrapper also unsets DEVTEAM_HOME, DEVTEAM_RUN, DEVTEAM_PROJECT, DEVTEAM_HUB_PORT; the second-window case and what isn't defended are named. |

Verdict: CHANGES 3f1a9669c4053bea8a10aacb35e22321feac89bb
