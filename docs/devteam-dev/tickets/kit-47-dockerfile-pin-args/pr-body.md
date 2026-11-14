Pins every box tool (Claude Code, claude-swap, gh, ttyd, mise, uv) as Dockerfile `ARG`s, each just above the layer that installs it, after the apt layers. gh now comes from its release tarball (2.104.0, checked against its published sums) at `/usr/local/bin/gh`, and `/usr/bin/gh` stays as a link to it, so existing boxes' `~/.gitconfig` credential helper still works. The file ends with `ARG DEVTEAM_RELEASE=v0.52.0` and `ENV DEVTEAM_KIT_RELEASE` / `DEVTEAM_BOX_TOOLS`. Ticket kit-47-dockerfile-pin-args (feature box-latest-hub, BOXHUB-S1/S3).

## How to verify

- `node docs/devteam-dev/tickets/kit-47-dockerfile-pin-args/verify-pins.mjs cloud/Dockerfile` (static: literals, block shape, case arms, order) and `sh docs/devteam-dev/tickets/kit-47-dockerfile-pin-args/mutate-pins.sh` (each mutation is caught).
- The `box-image` workflow builds the image. `docs/devteam-dev/tickets/kit-47-dockerfile-pin-args/verification.md` quotes the versions the built image reports on x86_64 and on a native arm runner. They come from a temporary probe (run 43645429250), since reverted, so the only file outside this ticket's records is `cloud/Dockerfile`.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
