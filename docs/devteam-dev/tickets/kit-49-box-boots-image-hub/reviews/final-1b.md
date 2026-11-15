# Final review, pass 1, track b

- Reviewer: final-b (fresh subagent of the supervisor, claude-sonnet)
- Reviewed: 40aad378d8bbd0abdb987e6fdc723921fcf849b8

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec "Out of scope" | cloud/Dockerfile:21 | The header comment about the `box` environment's approval was rewritten ("accepting only v* tags, with no approval step"), though the spec lists that comment as out of scope. It is a comment only, and it now agrees with the README. | Deferred (m-20261115-045352826-supervisor): kept; task-3 review F3 asked for it, and the comment now agrees with the README. |
| F2 | Minor | spec §4 | test/machine.test.mjs (box-deploy test) | The test runs `box-pins verify`, which needs the checkout's git remote to name sanctuarycomputer/devteam. It fails in a fork or a checkout with another remote. The assertion message says so, and CI passes. | Deferred (m-20261115-045352826-supervisor): as kit-48's box-pins tests, it needs the kit's own remote; the assertion message says so. |

## What I checked

- Boot: `hub_window` makes `home:hub` (cwd `$HOME`, target `=home:`) with the `env -u` wrapper, root PATH, the image's node and kit, and a release passed only when it is plainly vN.N.N. It is called right after the `home` session is made, and `hub_wait` (default 15 s, deadline-based, notes in `~/box.log`) sits right before the dashboard loop. The order is asserted by a test.
- Minute loop: the `list-windows ... | grep -qx hub || hub_window` line follows `sleep 60`. `hub_window` makes a new session when `home` is gone. Tests cover both cases, plus a real-tmux case.
- `ENV DEVTEAM_IMAGE_HUB=4320` is in the Dockerfile and a test checks it.
- box-deploy.yml: `box-pins verify --release "$TAG"` runs before `HOOK` is read and refuses with the exact message. `inputs=(cloud docs/devteam)`, setup-node 22 is added, and every existing rule is kept. The test runs the step's shell from the workflow file for a matching and a mismatched tag.
- box-image.yml smoke runs `box-pins installed` and checks `DEVTEAM_IMAGE_HUB` is 4320. The `build` job passes at the head.
- README's deploy-gate text and operator.md's check-in line are plain and match the code: the `machine: hub 4320 up, kit <release> (image)` format, `not a hub`, `kit ?`, and the `~/.devteam/hub-4320.log` path all match devteam.mjs.
- No file is added outside the ticket folder, and nothing in the kit is project-specific.
- `test/machine.test.mjs` run alone, DEVTEAM_* unset, TMUX_TMPDIR a fresh dir: 54 pass, 0 fail.
- CI at the head (40aad37, confirmed as the PR head): `build` and every `kit` job (node 18, 20, 22, 24; chain and rest) pass.

Verdict: APPROVE 40aad378d8bbd0abdb987e6fdc723921fcf849b8
