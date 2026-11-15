# kit-49 task 3 review: README and operator.md

- Reviewer: task-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: 49f53827bcf9c57bf75bb085ff9c65853699da87 (task 3)

## Reasoning

Read against plan.md Task 3, spec.md acceptance 5, and the README/operator.md done-when. I checked each claim against `cloud/Dockerfile` (`hub_window`, `hub_wait`, the minute loop at line 515, `ENV DEVTEAM_IMAGE_HUB=4320`, the COPY lines), `.github/workflows/box-deploy.yml`, and `docs/devteam/scripts/devteam.mjs` (`hubLine`, `machineStatus`, `cmdHub`, `hubLogger`, `ownKitVersion`, `imageHub()` in the dashboard's `listening` handler).

What the done-when names is all there:

- README, "The deploy gate": the new inputs (`cloud/` and `docs/devteam/`, every path the Dockerfile copies; every COPY source is under one of the two), the stamp refusal (`box-pins verify --release <tag>`, run before the hook is read, with the refusal naming `box-pins bump --release <tag>`, as the workflow's `run:` block does), and that every release now restarts the box. "A release that changes only the kit doesn't restart the box…" is gone, and "every release that changes the image deploys by itself" became "every release deploys by itself" (plan-1 F1-5). The operator paragraph now says the image's kit is the latest release's. `grep "changed the image\|doesn't restart the box" README.md` prints nothing.
- operator.md: `machine: hub 4320 DOWN` / `kit ?`, then read `~/.devteam/hub-4320.log` (the `hubLogger` path) and tell the owner. The box brings `home:hub` back by itself within a minute (line 515: `list-windows -t =home … | grep -qx hub || hub_window`), so don't start one. The stopgap is a dashboard started with `DEVTEAM_IMAGE_HUB` unset. That is true: `imageHub()` is null, so the dashboard calls `startHub(log, { kit: ownKitVersion() })`. The bullet sits under Checking in, after the box-status bullets, in the file's voice ("so don't start one"). It names no project, so the kit's no-project-specifics rule holds.

Truth to the code, where it falls short. `hubLine` prints `up, kit <release> (image)` only for the image's own hub (`hub --release` valid, so `image: true`). Every other holder prints something else, and the bullet treats only two of those outcomes as the signal:

- `up, kit ?` comes from a hub whose list has no usable `kit`. That covers a project on a kit older than kit-46 (README line 44's "gap left"), and also the image's own hub when `--release` wasn't `vX.Y.Z` (`cmdHub` then uses `ownKitVersion()`, which is null for `/opt/devteam/kit` run from `$HOME`). So the parenthetical "(a project's kit, not the image's, is serving it)" isn't always true. Reading the log covers both, since the image's hub logs the bad `--release`.
- `up, kit vX.Y.Z` with no `(image)` is what a current project's kit prints when it serves the hub. The doc's own stopgap produces exactly this state. The bullet doesn't mention it, and the parenthetical suggests that a project's kit shows up as `kit ?`. An operator reading this prompt would take `up, kit v0.52.0` as healthy.
- `up, not a hub` (something else holds 4320) also means the image's hub isn't serving, and it isn't mentioned either.

The fix is one clause: name the healthy line, `up, kit <release> (image)`, and say that anything else on the hub line (DOWN, `kit ?`, a kit without `(image)`, `not a hub`) means the image's hub isn't serving. The done-when's literal items stay as they are. Because operator.md is the operator's system prompt on every box, I count this as Important, not a nit.

Other contradictions: README line 44 (kit-46's hub paragraph) and Dockerfile lines 147-148 and 538-539 agree with the change. `cloud/Dockerfile`'s header comment (lines 19-21) still says the `box` environment is "needing the owner's approval". README says "no approval step so that every release deploys by itself (the owner's choice)". The mismatch predates this commit, but the brief's check covers it, and this ticket touches that file.

## Findings

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | Important | operator.md's hub bullet treats `DOWN` and `kit ?` as the only signs that the image's hub isn't serving. `hubLine` prints `up, kit vX.Y.Z` with no `(image)` when a current project's kit serves it, which is the state the bullet's own stopgap leaves, and `up, not a hub` when something else holds the port. The operator can't tell either from healthy. The parenthetical "(a project's kit, not the image's, is serving it)" is also not exclusive: the image's own hub with a non-`vX.Y.Z` `--release` prints `kit ?`. Fix: name the healthy line `machine: hub 4320 up, kit <release> (image)` and say anything else there (DOWN, `kit ?`, no `(image)`, `not a hub`) means the image's hub isn't serving. Drop or soften the parenthetical. || Fixed: names the healthy line (up, kit <release> (image)); DOWN, kit ?, a kit with no (image), and not a hub all count as not serving. |
| 2 | Minor | The stopgap sentence doesn't say whose step it is. The next bullet says starting and restarting a dashboard is the supervisor's, so a reader may take the stopgap as the operator's to do. Say it is the owner's call and that the project's supervisor restarts its dashboard that way. || Fixed: the stopgap is the owner's call; that project's supervisor restarts its dashboard (box-tell). |
| 3 | Minor | `cloud/Dockerfile` lines 19-21 still describe the `box` environment as "needing the owner's approval". README's deploy gate (edited here) says there is no approval step, so that every release deploys by itself. The mismatch predates this commit, but now that every release deploys it reads as a direct contradiction. The Dockerfile is in this ticket's touches. || Fixed: the header says the box environment takes only v* tags with no approval step. |
| 4 | Nit | README: "A deploy that failed or was rejected isn't redone by a later release that leaves the image alone". Every release now stamps the Dockerfile, so such a release barely exists any more. The sentence is harmless, but it could say a later release redeploys, or that you re-run the job to retry the same release. || Fixed: a stamp refusal is fixed by merging the release-prep PR and publishing the release again. |

Verdict: CHANGES 49f53827bcf9c57bf75bb085ff9c65853699da87
