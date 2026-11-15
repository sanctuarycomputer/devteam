The box's hub page and `box-status` now name the box's release, the release serving its hub, and the box's tool versions (BOXHUB-S1).

## What changes

- **`cloud/gateway.mjs`:** one exported function, `boxImage(env)`, reads the image's `ENV`: `DEVTEAM_KIT_RELEASE`, plus `DEVTEAM_BOX_TOOLS` as `name=version` pairs in their order. It keeps only values of the form `^[\w.+-]{1,64}$`, and gives `null` when neither variable is set.
  - Signed-in `/box.json` gains `image: { release, tools }` (or `null`). It stays `box: 1`, and every other field is unchanged.
  - `serve` writes `image: <release>` (or `image: none`) to stdout before it listens.
  - Nothing else in the file names those variables.
- **The gateway's fallback hub list**, served when no hub answers, is now `{"hub":1,"instances":[],"down":true}`. **Two existing assertions changed** in `test/gateway.test.mjs` (~L492 and ~L498, the oversized answer and the empty port), because the fallback body itself changed. The supervisor approved this with the spec (m-20261115-030809314-supervisor).
- **`hub.html`:** the Overview shows one line on a box, built by `boxLine(image, list)`, a pure block between `/* box-line start */` and `/* box-line end */`.
  - Example: `Box v0.52.0 · hub v0.52.0 · Claude Code 2.1.310 · claude-swap 0.4.1 · gh 2.83.0 · ttyd 1.7.7 · mise 2025.11.3 · uv 0.9.9`.
  - The hub part is amber when the hub isn't the image's own at the box's release: "hub served by a project's kit, v0.50.4", "hub v0.52.0, box v0.53.0", "hub not answering", or "hub port held by something that isn't a hub".
  - On a laptop, or with `image: null`, the line doesn't show.
  - Each part goes in as plain text.
  - Screenshots in light and dark: `docs/devteam-dev/tickets/kit-50-box-versions-on-hub/look/`.
- **`devteam.mjs machine status`:** right after the hub line it prints `machine: box <release>: <name> <version>, …` when the image's `ENV` is set, and nothing otherwise.
- **Contract comments**, both additive: above `/box.json`, and on the hub list (`down?`, set only by the gateway).

## How to verify

Run each file on its own, as the suite does in CI:
- `node --test test/gateway.test.mjs`
- `node --test test/hub-overview.test.mjs`
- `node --test test/dashboard.test.mjs`

On a box after deploy:
- `box-status` shows the box line.
- The Overview shows the line.
- `docker logs` shows `image: vX.Y.Z`.

## What this doesn't defend against

`image` is display only. A `dev` process that edits the `ENV` that `machine status` reads changes only what that command prints. The gateway's `ENV` comes from PID 1, out of agents' reach.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
