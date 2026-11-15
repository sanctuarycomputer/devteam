# kit-46-standalone-hub: verification

At commit `a8c9b2fccf38dd5e9a0e2f4a3f7662986708ff7a`: the branch with `origin/main` merged after kit-201 (merge `31b98c8`, m-20261114-234110890-supervisor), and `hub` added to kit-201's `DEVTEAM_RUN` exemption.

Where: **box** is this cloud box, every kit test run through `devteam.mjs gate test` as `env -u DEVTEAM_RUN -u DEVTEAM_HOME -u DEVTEAM_ROLE -u DEVTEAM_TICKET -u DEVTEAM_FEATURE -u DEVTEAM_SUPERVISOR -u TMUX -u TMUX_PANE TMUX_TMPDIR=$(mktemp -d) node --test test/<file>.test.mjs` (m-20261114-214804017-supervisor). **CI** is test.yml run [43654583319](https://github.com/sanctuarycomputer/devteam/actions/runs/43654583319) at `a8c9b2f`: every job (`kit` × Node 18/20/22/24 × chain/rest) succeeded; box-image run 43654583500 at `a8c9b2f` succeeded.

Box results for the four files:

| File | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| test/hub-overview.test.mjs | 11 | 10 | 0 | 1 (the Chrome test: no Chrome here) |
| test/machine.test.mjs | 23 | 23 | 0 | 0 |
| test/dashboard.test.mjs | 46 | 31 | 0 | 15 (Chrome and similar skips) |
| test/operator-threads.test.mjs | 19 | 18 | 0 | 1 |

With kit-201 merged, the box's own files and ENV no longer reach the tests: the 23 failures of `baseline-box.txt` (at main before kit-201) are gone, so done-when 6 now holds on the box as written, not only under ruling m-20261114-215021941-supervisor.

| # | Done-when | Command | Result |
|---|---|---|---|
| 1 | `hub --release v9.9.9` from a non-git, non-project folder: hub 1, the fixture instance, kit v9.9.9, image true, no `docs/devteam/run` under its cwd; `hub` without `--release` (and `''`, `nope`): kit null, no image, with `DEVTEAM_KIT_RELEASE` set; a dashboard's hub: `kitVersion()`, no image | box and CI, hub-overview | pass: "hub --release, from a folder that is no repo…", "hub without --release names no release…", "a dashboard's hub names its project's kit…" |
| 2 | `DEVTEAM_IMAGE_HUB` = the fixture hub port: no listener there, exactly one `hub: left to the image (DEVTEAM_IMAGE_HUB=<port>)`; unset, `4320` or a hex form: served, no such line | box and CI, hub-overview | pass: "a dashboard leaves the hub to the image only when DEVTEAM_IMAGE_HUB names its own hub port" |
| 3 | Held by a hub: stays up, retries, takes the port; held by a non-hub: logged once to `~/.devteam/hub-<port>.log`, takes it once free; log never past 1 MB; SIGTERM leaves `stopped by SIGTERM` | box and CI, hub-overview | pass: "the hub waits out another hub and a non-hub…", "a non-hub that answers slowly now and then is still logged once", "the hub's log stays under 1 MB and records a SIGTERM" |
| 4 | Box-mode standalone hub: unsigned, replayed, foreign Origin each 403; a signed one reaches the operator's pane | box and CI, operator-threads | pass: "on a box the standalone hub takes a press only as the gateway signed it…" (`ok 19` on the box); it also refuses a foreign Host, missing or same-site Sec-Fetch-Site, non-JSON, and cross-site reads |
| 5 | `machine status` prints each of the five hub lines exactly, alert suffix unchanged | box and CI, machine | pass: "status names the hub's kit, or says it is no hub, or down" (also a hostile and a 10 KB `kit`, a 70 KB body, a holder that drips, the alert suffix) |
| 6 | Existing tests of dashboard, hub-overview, operator-threads, machine pass unchanged, in CI and on the box | box: the table above; CI | every test passes on the box (0 failures in all four files) and in every CI job |
| 7 | README's "Many projects, one machine" names the image's hub on a box whose image sets `DEVTEAM_IMAGE_HUB`, and the gap; no file added | `git diff --diff-filter=A --name-only origin/main -- . ':!docs/devteam-dev'` | empty; the README has the two sentences (task-5 review APPROVE) |
| 8 | Every added test clears `DEVTEAM_IMAGE_HUB`, `DEVTEAM_KIT_RELEASE`, `DEVTEAM_BOX_TOOLS` and sets them only where it means to | read: `hubMachine()` in test/hub-overview.test.mjs (deletes `BOX_VARS`, then applies `extra`), the new tests in test/operator-threads.test.mjs and test/machine.test.mjs (each deletes the three) | the only settings are `DEVTEAM_KIT_RELEASE=v9.9.9` (row 1) and `DEVTEAM_IMAGE_HUB` (row 2) |

Also at this head (supervisor, m-20261114-234110890): kit-201's `DEVTEAM_RUN` check exempts `hub` as it does the machine's other commands; "the hub runs with another home's DEVTEAM_RUN in its env, and writes nothing there" was refused before the change, and passes on the box and in CI.

Reviews: spec (1 CHANGES, 2 APPROVE), plan (1 and 2 CHANGES, 3 APPROVE), tasks 1–5 (each APPROVE; tasks 1 and 4 again at pass 2 after their fixes). The two final reviews (risk high) are requested from other sessions.
