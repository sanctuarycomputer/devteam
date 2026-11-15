# kit-48-box-pins-command: spec

`devteam.mjs box-pins`: verify, check and bump the box image's pins in `cloud/Dockerfile`, and check what the image installed.

Feature `box-latest-hub`, story BOXHUB-S3. Design: home's `project/designs/the-cloud-box-always-runs-the-latest-hub.md` (`devteam.mjs box-pins (kit-48)`, Contracts, Failure modes, Testing). Risk high: release tooling that decides what the box runs (D8). Depends on kit-46 (merged, PR #238) and kit-47 (merged, 090fc9d), which landed the pin `ARG`s and the `ENV` this reads.

## Why

The owner wants the box to ship with current tools at every kit release, and a check that says which pins are behind. kit-47 put every tool's pin in `ARG`s just above its layer (`<TOOL>_VERSION`, and for a downloaded binary `<TOOL>_SHA256_X86_64` / `_AARCH64`), a late `ARG DEVTEAM_RELEASE`, and `ENV DEVTEAM_KIT_RELEASE` / `DEVTEAM_BOX_TOOLS`. This ticket gives the release-prep PR its tool (`bump`), the playbook and the deploy gate their offline check (`verify --release`), the supervisor its stale-pin check (`check`), and the image build its smoke check (`installed`).

## What changes (all in `docs/devteam/scripts/devteam.mjs`, tests in `test/machine.test.mjs`)

### The tools (one table in the code)

| name (in `DEVTEAM_BOX_TOOLS`) | ARG prefix | upstream | image path | binary (has sums) |
|---|---|---|---|---|
| `claude-code` | `CLAUDE_CODE` | npm `@anthropic-ai/claude-code` | `<bin>/claude --version` | no |
| `claude-swap` | `CLAUDE_SWAP` | PyPI `claude-swap` | `UV_TOOL_DIR=/opt/uv/tools <bin>/uv tool list` | no |
| `gh` | `GH` | GitHub `cli/cli` | `<bin>/gh --version` | yes: `gh_<ver>_linux_amd64.tar.gz`, `…_arm64.tar.gz` |
| `ttyd` | `TTYD` | GitHub `tsl0922/ttyd` | `<bin>/ttyd --version` | yes: `ttyd.x86_64`, `ttyd.aarch64` |
| `mise` | `MISE` | GitHub `jdx/mise` | `<bin>/mise --version` | yes: `mise-<tag>-linux-x64`, `…-linux-arm64` |
| `uv` | `UV` | GitHub `astral-sh/uv` | `<bin>/uv --version` | yes: `uv-x86_64-unknown-linux-gnu.tar.gz`, `uv-aarch64-…` |

The asset names are the ones the Dockerfile's `RUN` lines download (`<ver>` is the pin without a leading `v`, `<tag>` with whatever the pin has). `<bin>` is `/usr/local/bin`, or `DEVTEAM_BOX_BIN` for tests.

**Version form.** A pin keeps or drops a leading `v` exactly as its current `ARG` value does (gh `2.104.0` from tag `v2.104.0`; mise `v2026.10.17`; ttyd, uv bare). An upstream version is compared and written in that form. Versions compare by their numeric dotted parts; an upstream version that isn't `v?\d+(\.\d+)+` is not a release (skipped for GitHub, `unknown` for npm/PyPI).

**Holds.** A tool is held when the line directly above its `ARG <P>_VERSION=` is `# hold: <reason>` (the supervisor's relay of kit-47's ruling, m-20261115-004401439). A `# hold:` with an empty reason is a verify problem, and so is any line matching `^#\s*hold\b` (any case) that is not directly above a tool's `ARG <P>_VERSION=` (spec-1 F2: a misplaced hold would otherwise be ignored and bump would move the tool).

### Dispatch

- `box-pins` joins `KIT_VIEWS`, so `verify`, `check` and `bump` run in the kit's own checkout (which has no project). The comment above `KIT_VIEWS` (and the one before it, "nothing in them writes") is amended: `box-pins bump` writes `cloud/Dockerfile`, and nothing else in the views writes.
- `box-pins installed` is machine-wide: it joins the `machineWide` test and the `DEVTEAM_RUN` exemption (as `machine`, `operator-thread` and `hub`), so it runs from `/opt/devteam/kit` and a cwd that is no repo.
- `--dockerfile <path>` (default `<repoRoot>/cloud/Dockerfile`, `repoRoot` the cwd's checkout) names the file for `verify`, `check` and `bump`. A missing file: `box-pins: no cloud/Dockerfile at <path> (box-pins works on the kit's own checkout, or --dockerfile <path>)`, exit 2.
- An unknown or missing mode: the usage line, exit 1.
- Help (the "Dashboard and releases" block) gets one line per mode, and says only the top package of the npm and PyPI tools is pinned: their dependencies resolve when the image is built.

### `box-pins verify [--release vX.Y.Z]` (offline)

Prints one line per problem, `box-pins verify: <problem>`, and exits 1; or prints `box-pins verify: ok, <n> tools, release <r>` and exits 0. Problems:

1. a tool's `ARG <P>_VERSION=` missing, given more than once, or empty;
2. a binary tool missing `_SHA256_X86_64` or `_SHA256_AARCH64`, or one given more than once;
3. a sum that is not 64 lowercase hex (`[0-9a-f]{64}`);
4. a tool's version, or a sum, written as a literal anywhere else in the file. A version is searched without its leading `v`, bounded by digits and dots only (`(?<![\d.])<ver>(?!\.?\d)`), so `/v2.104.0/` and `gh_2.104.0_linux` in a URL are caught (spec-1 F1); a sum is bounded by hex (`(?<![0-9a-fA-F])<sum>(?![0-9a-fA-F])`). Not searched: every pin `ARG` line of the table and `ARG DEVTEAM_RELEASE=` (so two tools at one version, or equal sums, are not strays; spec-1 F3), and `# hold:` lines, since a reason may name versions.
5. `ARG DEVTEAM_RELEASE=` missing, given more than once, or not matching `^v\d+\.\d+\.\d+$`;
6. `--release` given and not equal to `DEVTEAM_RELEASE` (`--release` itself not `vX.Y.Z`: the usage error, exit 1);
7. `DEVTEAM_BOX_TOOLS` not set to exactly the table's six pairs `<name>=$<P>_VERSION`, each once, in any order and nothing else: the value is found as the one line matching `^\s*(?:ENV\s+)?DEVTEAM_BOX_TOOLS="([^"]*)"` (in the real file the indented second line of a continued `ENV`); none, or more than one, is a problem (what `installed` compares against; my addition, so verify catches a tool added to the table but not to the `ENV`; spec-1 F5);
8. `# hold:` with no reason.

`ARG` lines are matched as `^ARG <NAME>=<value>$` (kit-47's rule: one per line, unquoted).

### `box-pins check [--json]`

For each tool not held, the latest release upstream:
- npm: `GET <npm>/<pkg>/latest` (`/` in a scoped name as `%2f`), its `version`. Base `DEVTEAM_PINS_NPM`, default `https://registry.npmjs.org`.
- PyPI: `GET <pypi>/pypi/<pkg>/json`, its `info.version`. Base `DEVTEAM_PINS_PYPI`, default `https://pypi.org`.
- GitHub: `GET <github>/repos/<owner>/<repo>/releases?per_page=30`, the highest version among releases with neither `draft` nor `prerelease` and a tag that is a plain version. Base `DEVTEAM_PINS_GITHUB`, default `https://api.github.com`. Anonymous; `Authorization: Bearer $GH_TOKEN` when `GH_TOKEN` is set, on the API requests only: never on an asset download, which is a separate request with no auth header whatever its URL. I read the list rather than `/releases/latest` so a prerelease is skipped by this code, where a test can see it.

Each request has a 15 s timeout. One line per tool, in table order:

- `<name>: current <pinned>`
- `<name>: stale <pinned> -> <latest>`
- `<name>: held <reason>` (no request made)
- `<name>: unknown <why>` (unreachable, a non-2xx status, bad JSON, no release found)

A pin newer than upstream's latest reads `current`. Exit 1 when any tool is stale; else 3 when any is unknown (so a caller gating on the exit can tell "couldn't ask" from "all current"; spec-1 F8); else 0 (all current or held). `--json` prints `{ "box_pins": 1, "tools": [{ "name", "pinned", "status", "latest"?, "reason"?, "why"? }] }` with the same exit status. A file with any verify structure problem (1-5, 7, 8; not the release) can't be checked: its problems are printed as `box-pins check: <problem>` lines (with `--json`, `{ "box_pins": 1, "problems": [...] }`) and it exits 2, as for a missing file (spec-1 F7).

### `box-pins bump --release vX.Y.Z [--dry-run]`

1. Verify the file's structure (problems 1-5, 7, 8 above, not the release equality); any problem: printed, exit 1, nothing written. A `--release` lower than the file's `DEVTEAM_RELEASE` is refused the same way (`box-pins bump: --release <r> is older than DEVTEAM_RELEASE <cur>`); equal is allowed (spec-1 F9).
2. For each tool not held, the latest version as `check` finds it. For a binary tool whose latest differs from its pin, each arch's asset (by its name in the table, from the chosen release's `assets`, its `browser_download_url`) is downloaded and hashed (sha256, streamed, 120 s timeout each). If the release publishes a `digest` (`sha256:<hex>`) for the asset and it differs from the hash, that is a failure.
3. Any failure (an upstream unreachable, no release, an asset missing, a download that fails, a digest mismatch): `box-pins bump: <tool>: <why>; nothing written`, exit 1, the file untouched.
4. The new text: each changed tool's `_VERSION` and sums, and `DEVTEAM_RELEASE` set to `--release`, by replacing those `ARG` lines only. It must pass verify `--release` (in memory) before it is written; it is written to a temp file in the Dockerfile's own directory, given the original's mode, and renamed over it (spec-1 F9).
5. Prints one line per changed `ARG` (`<NAME> <old> -> <new>`), `held <name>: <reason>` per held tool, and `wrote <path>` (or `--dry-run: nothing written`). `--dry-run` downloads and hashes as a real bump does (so it shows the sums it would write) and leaves the file byte-identical. Exit 0.

A held tool, and a tool already at its latest, are left exactly as they were and nothing is downloaded for them.

### `box-pins installed`

Machine-wide, run inside the image. Reads `DEVTEAM_BOX_TOOLS` (`name=version` pairs, space-separated); unset or empty: `box-pins installed: DEVTEAM_BOX_TOOLS is not set (not the box image?)`, exit 2. For each tool in the table, runs its command by absolute path under `<bin>` (never a PATH lookup; `execFileSync` of the full path, 20 s timeout), with `UV_TOOL_DIR=/opt/uv/tools` added for `uv tool list`. It reads stdout and takes:

- claude-swap: the line `claude-swap v?<version>`;
- the others: the first match of `(?<![\w.])v?(\d+(?:\.\d+)+)` (spec-1 F6; so `ttyd version 1.7.7-40e79c7` gives `1.7.7`, `2.1.307 (Claude Code)` gives `2.1.307`, `gh version 2.104.0 (…)` gives `2.104.0`, `2026.10.17 linux-x64 (…)` gives `2026.10.17`, `uv 0.13.7 (…)` gives `0.13.7`);

then puts it in the pin's form (a leading `v` exactly when the pin in `DEVTEAM_BOX_TOOLS` has one). One line per tool: `<name>: <version>` when it matches; `<name>: installed <found>, pinned <pin>` when not; `<name>: did not run (<why>)` or `<name>: no version in its output`; `<name>: not in DEVTEAM_BOX_TOOLS`. Exit 0 when all match, else 1. A name in `DEVTEAM_BOX_TOOLS` that isn't in the table is a line and exit 1 too.

## Contracts

- **Provides:** `devteam.mjs box-pins verify [--release vX.Y.Z] | check [--json] | bump --release vX.Y.Z [--dry-run] | installed`, with `--dockerfile <path>`, exit codes 0 / 1 / 2 (and 3 for check) as above, and `check --json`'s `box_pins: 1` shape. Consumers: the playbook chore (verify, check, bump), kit-49 (`box-deploy.yml`'s `verify --release`, `box-image.yml`'s `installed`), kit-51.
- **Consumes:** the box image `ENV` (`DEVTEAM_BOX_TOOLS`; `DEVTEAM_IMAGE_HUB` and `DEVTEAM_KIT_RELEASE` are not read here) and the pin `ARG` names, as kit-47's comment above the `ARG`s in `cloud/Dockerfile` documents them; the hold line as relayed in m-20261115-004401439.
- **Environment knobs (for tests):** `DEVTEAM_PINS_NPM`, `DEVTEAM_PINS_PYPI`, `DEVTEAM_PINS_GITHUB`, `DEVTEAM_BOX_BIN`.

## Acceptance checks (the done-whens, restated)

All in `test/machine.test.mjs`, no network: one in-process HTTP server stands in for npm, PyPI and GitHub (and the asset downloads, through the `browser_download_url`s it lists). `verify`, `check` and `bump` run a copy of the kit in a temporary git repo whose origin is `sanctuarycomputer/devteam` (so `KIT_VIEWS` applies, on a fork's CI too) against a temporary copy of `cloud/Dockerfile` named with `--dockerfile`.

1. CI (`test.yml`, every job) passes. In that fixture repo with no `cloud/Dockerfile`, `box-pins verify` says so and exits 2.
2. `verify` exits 0 on the kit's real `cloud/Dockerfile`; exits 1 naming the problem for: a sum that isn't 64 lowercase hex; a binary tool missing an arch's sum; a tool's version left as a literal outside its `ARG` (in a URL: gh's `$GH_VERSION` replaced by its value in the download URL); `DEVTEAM_RELEASE` not `vX.Y.Z`; `--release v1.2.3` when `DEVTEAM_RELEASE` says otherwise; and (spec-1 F2) a `# hold:` line not directly above a `_VERSION` `ARG`. Each a case.
3. `check`: one line per tool for current, stale `<pinned> -> <latest>`, held `<reason>`, unknown `<why>`; exits 1 with one stale, 0 when all current or held (3 when some are unknown and none stale); a GitHub prerelease newer than the latest release is ignored; an unreachable upstream (a base that refuses connections) is unknown; `--json` gives the same. Each a case. With a fake `GH_TOKEN`, the fixture sees `Authorization: Bearer <fake>` on every API request and no `Authorization` on any asset download; the fixture serves its assets from a path outside `DEVTEAM_PINS_GITHUB` (spec-1 F4).
4. `bump --release v9.9.9` sets every unheld tool to the fixture's latest, each arch's sum to the sha256 of the bytes the fixture serves (distinct bytes per asset), `DEVTEAM_RELEASE` to v9.9.9, and leaves a `# hold:` tool's lines unchanged; the result passes `verify --release v9.9.9`. `--dry-run` prints the change and the file is byte-identical. An upstream failure (one tool's asset answering 500) writes nothing. Each a case.
5. `installed`, run from a folder that is no repo, with a copy of the kit in a folder that is no repo: fake binaries in a `DEVTEAM_BOX_BIN` folder print each tool's real `--version` text (ttyd `ttyd version 1.7.7-40e79c7`, `2.1.307 (Claude Code)`, mise's, gh's, uv's, and `uv tool list`'s `claude-swap v1.0.0` line, which the fake uv prints only when `UV_TOOL_DIR=/opt/uv/tools`); a fake uv earlier on PATH (a mise shim) prints another version. Exit 0 when they match `DEVTEAM_BOX_TOOLS`; exit 1 naming the tool when one differs. Because the fake uv on PATH is wrong and the right one lists claude-swap only with `UV_TOOL_DIR` set, a PATH lookup or a missing `UV_TOOL_DIR` fails the test.
6. The `KIT_VIEWS` comment is amended; help says only the top package of the npm and PyPI tools is pinned; no file is added (the ticket's records here aside, as for kit-46).
7. Every test added clears `DEVTEAM_IMAGE_HUB`, `DEVTEAM_KIT_RELEASE` and `DEVTEAM_BOX_TOOLS` from the env it passes (explicitly, though `test/lib/kit.mjs` already scrubs `DEVTEAM_*`) and sets them only where it means to (`DEVTEAM_BOX_TOOLS` for `installed`). It also clears `GH_TOKEN` and `GITHUB_TOKEN` (not `DEVTEAM_*`, so not scrubbed), so the box owner's token never reaches the fixture (spec-1 F4).

## Edge cases

- A tool's latest upstream older than its pin: `current` in check; bump leaves it.
- npm/PyPI give a version that isn't a plain version (a prerelease made `latest` by mistake): `unknown not a release: <v>`, and bump fails for it (writes nothing). Holding the tool is the way past it.
- GitHub answers 403 (rate limit, anonymous 60/h): `unknown HTTP 403`; set `GH_TOKEN`.
- A repo whose 30 most recent releases are all prereleases: `unknown no release`.
- `bump` with every tool current: only `DEVTEAM_RELEASE` changes.
- A `--release` equal to the current stamp and nothing stale: bump writes the same bytes (or skips the write when identical; my call: skip and say `unchanged`).
- CRLF line endings: not supported; the kit's Dockerfile is LF. `ARG` matching is per `\n` line.
- Output strings from the network are printed only if they match `^[\w.+-]{1,64}$`, else `?` (they go to a terminal, as kit-46 did for `kit`). A `why` is built from our own words plus an HTTP status or an error code.

## Security

- Every sum bump writes is the hash of the bytes it downloaded, cross-checked against GitHub's published digest when there is one. The image build downloads from the Dockerfile's own URL and checks that sum, so an API that lied about a download URL makes the build fail, not ship.
- `GH_TOKEN` is sent only to the GitHub API base, never to a download URL.
- Nothing runs what it downloads. `installed` runs only fixed absolute paths under `/usr/local/bin` (or `DEVTEAM_BOX_BIN`, which only a test sets; P6 trusts the box's agents not to point it elsewhere on purpose, and it would only change what is reported).
- No secret, no PII, nothing written but the named Dockerfile.

## Out of scope

- `box-deploy.yml`, `box-image.yml`, the boot (kit-49); `/box.json` and the hub page (kit-50); the end-to-end run (kit-51); the playbook chore.
- Pinning npm/PyPI dependencies below the top package (stated in help).
- Letting the operator run `box-pins installed` under its read-only guard (not asked; the boot and CI run it with no role).
- Checking that a non-kit repo's own `cloud/Dockerfile` is the kit's: box-pins acts on whatever file it is given, and a project's own Dockerfile would just fail verify.

## Rulings and notes

- m-20261115-004401439-supervisor: (1) a hold is a `# hold: <reason>` line directly above the tool's `_VERSION` `ARG`, not on it; (2) run every kit test as `env -u DEVTEAM_RUN -u DEVTEAM_HOME -u DEVTEAM_ROLE -u DEVTEAM_TICKET -u DEVTEAM_FEATURE TMUX_TMPDIR=$(mktemp -d) node --test test/<file>.test.mjs`.
- No other rulings or answers in `history` or `messages` at spec time.
- "No file is added": the ticket's records under `docs/devteam-dev/tickets/kit-48-box-pins-command/` are the exception, as the worker prompt directs and as the supervisor read it for kit-46 and kit-47.
