# kit-49 task 3 review, pass 2: README and operator.md

- Reviewer: task-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: bc23f10bf525285809efe471f81107be7627350b (task 3)

## Reasoning

I checked the task-3 findings against `git show bc23f10`, then checked the new text against `hubLine` and `machineStatus` (`docs/devteam/scripts/devteam.mjs`), `cmdHub` and `ownKitVersion`, the dashboard's `imageHub()` step-back, and the refusal echo in `.github/workflows/box-deploy.yml`.

- **F1 (fixed).** operator.md now names the healthy line as `machine: hub 4320 up, kit <release> (image)` and lists the outcomes that mean the image's own hub isn't serving: `DOWN`, `kit ?`, a kit with no `(image)`, and `not a hub`. Each matches what `hubLine` can print: `up, kit ${kit}${image ? ' (image)' : ''}`, `up, kit ?`, `up, not a hub`, `DOWN`, behind `machine: hub ${HUB_PORT} ` in `machineStatus`. "A kit with no `(image)`, which is a project's kit holding the port" is true. Only `hub --release` with a valid `vX.Y.Z` sets `image: true`, and only the boot passes `--release`. The image's hub with a bad release has a null kit (`ownKitVersion()` for `/opt/devteam/kit` run from `$HOME`), so it shows `kit ?` and never a bare version. The doubtful parenthetical is gone.
- **F2 (fixed).** The stopgap is now "the owner's call", and "that project's supervisor restarts its dashboard that way (`box-tell`)". This agrees with the next bullet, where starting dashboards is the supervisor's job, and with the operator's role. Unsetting `DEVTEAM_IMAGE_HUB` makes `imageHub()` null, so that dashboard calls `startHub`, which matches the text.
- **F3 (fixed).** The Dockerfile header now says the `box` environment accepts only `v*` tags, with no approval step, so every release deploys by itself. That agrees with the README's deploy gate.
- **F4 (fixed).** The README now says a failed or rejected deploy "isn't redone by itself: re-run its job". It adds that a deploy refused for its stamp would be refused again on a re-run, so the fix is to merge its release-prep PR and publish the release again. That matches the workflow's refusal: "run box-pins bump --release $TAG in a release-prep PR, merge it, and publish the release again". The README's closing phrase "at that commit" is ambiguous (Minor below). The release has to be published again at a commit that carries the stamp, which is the merged prep PR's commit or later, not the refused one.

Nothing in the fix adds project-specific text. operator.md keeps its voice.

## Findings

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | Minor | README, deploy gate: "merge its release-prep PR and publish the release again, at that commit". "That commit" can be read as the refused release's commit, and publishing there would be refused again, since that commit's Dockerfile isn't stamped for the tag. Say "at the merged release-prep PR's commit (or later)". || Fixed: at that PR's merge commit (or later). |
| 2 | Nit | operator.md's healthy line is quoted without the `; alert: …` suffix that `machineStatus` adds when `~/.box/alert` holds a line. An operator could read a healthy hub with an alert as "anything else there". "Starts with" would be exact. || Fixed: the line starts with it. |

Verdict: APPROVE bc23f10bf525285809efe471f81107be7627350b
