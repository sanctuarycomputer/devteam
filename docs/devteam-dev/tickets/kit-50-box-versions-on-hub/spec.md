# kit-50-box-versions-on-hub: spec

The hub page and `box-status` show the box's release, the release serving the hub, and the box's tool versions.

Feature `box-latest-hub`, story BOXHUB-S1. Design: home's `project/designs/the-cloud-box-always-runs-the-latest-hub.md` (TL;DR, Contracts, "What can go wrong", Testing, R2). Risk high: it changes `/box.json`, a route behind the gateway's sign-in (D8), and the gateway's fallback hub list.

## Why

The owner reads the goal's measure on the hub page: is the box's hub served by the image's own kit, at the image's release, with current tools? kit-46 put `kit` and `image: true` on the hub list; kit-47 put `ENV DEVTEAM_KIT_RELEASE` and `DEVTEAM_BOX_TOOLS` in the image. Nothing shows them yet. This ticket shows them, in one line on the Overview and one line of `machine status` (which `box-status` prints).

## What changes

1. **`cloud/gateway.mjs`: one named, exported function `boxImage(e)`** reads the image's `ENV` from the env `e` it is given:
   - `release`: `e.DEVTEAM_KIT_RELEASE` trimmed, kept only if it matches `^[\w.+-]{1,64}$`, else `null`;
   - `tools`: `e.DEVTEAM_BOX_TOOLS` split on whitespace into `name=version` pairs, each kept only if both halves match `^[\w.+-]{1,64}$`, as an object `{ name: version }` in the variable's order (a name given twice keeps its first);
   - returns `null` when both variables are unset or empty (a laptop, an image before kit-47), else `{ release, tools }` (so a release with no tools is `{ release, tools: {} }`, and tools with a bad or missing release is `{ release: null, tools }`).
   - `createGateway` takes `opts.env` (default the module's `env`, i.e. `process.env`) and computes `boxImage(opts.env ?? env)` once, at creation; `/box.json` adds `image: <that>`. Every other field of `/box.json` is unchanged, and `box` stays `1` (additive).
   - `serve` writes one line to stdout at start, before listening: `image: <release>` or `image: none` (when `boxImage(env)` is null or its release is null), through the same function.
   - Nothing else in `gateway.mjs` reads `DEVTEAM_KIT_RELEASE` or `DEVTEAM_BOX_TOOLS`: the names appear only inside `boxImage`.
2. **`cloud/gateway.mjs`: the fallback hub list** (`instances`, when `hubList()` gives nothing: no hub on the port, a non-200, an answer over 1 MB, a timeout) becomes `{"hub":1,"instances":[],"down":true}`. Additive to `hub: 1`. The comment above `startHub` in `devteam.mjs` (the list's contract) gains `down` (set only by the gateway's fallback, never by a hub).
3. **`docs/devteam/dashboard/hub.html`: the box line.** A pure block, marked `/* box-line start */` … `/* box-line end */`, with no DOM, `fetch` or globals, defines `boxLine(image, list)`, which returns `null` or an array of parts `{ text, amber }`:
   - `null` when `image` isn't an object with a `release` that matches `^[\w.+-]{1,64}$` (`image: null`, a laptop whose `/box.json` 404s, a failed fetch, a malformed answer);
   - first part `Box <release>`;
   - the hub part, from the latest `/instances.json` (`list`):
     - `list` null or `list.down === true`: `hub not answering`, amber;
     - `list.image !== true` (whatever its `kit`): `hub served by a project's kit, <kit>` (`<kit>` the list's `kit` if it matches the token form, else `?`), amber;
     - `list.image === true` and `kit !== release`: `hub <kit>, box <release>`, amber;
     - else `hub <kit>`, plain;
   - then one part per tool, in `image.tools`' key order, each `<words> <version>`, plain, where `<words>` is `Claude Code` for `claude-code` and the name itself otherwise; entries whose name or version isn't the token form are skipped.
   - Example: `Box v0.52.0 · hub v0.52.0 · Claude Code 2.1.310 · claude-swap 0.4.1 · gh 2.83.0 · ttyd 1.7.7 · mise 2025.11.3 · uv 0.9.9`.
   - Plain words and versions only (R2): no links, no markup; every part goes in as text.
   - Wiring (outside the block): `findBox` keeps `b.image` on `box` (`box.image`); `draw` keeps the last list it read (`hubSeen`); `paintOverview` calls `boxLine(box?.image ?? null, hubSeen)` and, when it isn't null, appends a `div.ov-box` under the head's summary with a `span` per part (class `amber` when amber) joined by ` · `. On a laptop `box` is null, so nothing shows.
   ```
   Everything is moving
   3 projects · 2 moving
   Box v0.53.0 · [hub v0.52.0, box v0.53.0] · Claude Code 2.1.310 · gh 2.83.0 · …
                 ^ amber
   ```
4. **`docs/devteam/scripts/devteam.mjs`: `machine status`'s box line.** Right after the hub line, when `DEVTEAM_KIT_RELEASE` or `DEVTEAM_BOX_TOOLS` is set (non-empty), it prints exactly `machine: box <release>: <name> <version>, <name> <version>, …` in `DEVTEAM_BOX_TOOLS` order (raw names, e.g. `claude-code 2.1.310`), with the same token rule as the gateway (`?` for a bad or missing release; bad pairs skipped); with no usable pair, `machine: box <release>`. With both unset, no box line. No file is added (code in `devteam.mjs`, tests in existing test files).

## Contracts

- **Provides:** the gateway's `/box.json` (`box: 1`) gains `image`: `{ release: string|null, tools: { name: version } }` or `null`. Additive. Also the gateway's fallback hub list gains `down: true` (the hub list stays `hub: 1`, additive). Documented in a comment above the `/box.json` route and in the hub-list comment above `startHub`. These two comments are committed first, alone, as the contract change, with the `image` and `down` shapes, before any build task; the version stays `box: 1` / `hub: 1` because both are additive (the list's own rule: an additive change keeps its version). The fake for consumers: a stand-in `/box.json` and `/instances.json` built in `test/hub-overview.test.mjs` for the pure block.
- **Consumes:** the hub list `hub: 1` with top-level `kit` and `image` (kit-46, comment above `startHub`); the image `ENV` names `DEVTEAM_KIT_RELEASE` and `DEVTEAM_BOX_TOOLS` (`name=version` pairs separated by spaces; kit-47, the comment above `ARG DEVTEAM_RELEASE` in `cloud/Dockerfile`). `DEVTEAM_IMAGE_HUB` is not read here; tests clear it.

## Acceptance checks (the done-whens, restated)

1. `test/gateway.test.mjs` passes in CI:
   - behind a signed-in session, `GET /box.json` keeps `box: 1`, `terminal`, `instance`, `passkeys`, `previews`, `push`; the existing whole-object `deepEqual` (~L358) gains exactly `image: null`, its gateway created with `env` that has `DEVTEAM_KIT_RELEASE` and `DEVTEAM_BOX_TOOLS` removed; every other existing assertion unchanged;
   - a gateway created with `env` setting both gives `image: { release, tools }` in the variable's order, and one with them unset gives `null`; `boxImage` direct cases: unset, empty, release only, tools only, a bad token in each, a duplicated name;
   - `gateway.mjs serve` started as a child process (own `DEVTEAM_GATEWAY_DIR`, `DEVTEAM_PUBLIC_URL`, a free `PORT`) writes `image: v9.9.9` with the variables set, `image: none` without;
   - a source assertion: the text `DEVTEAM_KIT_RELEASE` and `DEVTEAM_BOX_TOOLS` occurs in `gateway.mjs` only inside `boxImage`'s body; the `/box.json` route and the `serve` start line each call `boxImage` (directly or via the value `createGateway` computed with it).
2. Same file: with nothing on the hub port, the gateway's `/instances.json` body is exactly `{"hub":1,"instances":[],"down":true}` (the existing assertions at ~L488 and ~L494 that expect `{"hub":1,"instances":[]}` change to that, since that is this done-when).
3. `test/hub-overview.test.mjs`, under `node:vm` on the marked block cut from `hub.html`, never skipped for want of Chrome (it runs in CI's Node 22 and 24 jobs, as the whole file does): the example line from an image and a list with `image: true` and the same release; amber `hub served by a project's kit, v0.50.4` for a list without `image: true` (with and without a `kit`, and with `kit` equal to the release); amber `hub v0.52.0, box v0.53.0`; amber `hub not answering` for `down: true` and for a null list; `null` for `image: null`, `undefined`, a non-object and a bad release; tool parts in order with `Claude Code`, bad entries skipped; every part's text a plain string of words and versions (no `<`, no URL); and a source assertion that `paintOverview`'s body calls `boxLine(`.
4. Same file: `devteam.mjs machine status --in <empty dir>` run with `DEVTEAM_KIT_RELEASE=v9.9.9` and `DEVTEAM_BOX_TOOLS='claude-code=2.1.310 gh=2.83.0'` prints, on the line right after `machine: hub …`, exactly `machine: box v9.9.9: claude-code 2.1.310, gh 2.83.0`; with both unset no line starts `machine: box`; the test adds no file to the repo.
5. Every test this ticket adds clears `DEVTEAM_IMAGE_HUB`, `DEVTEAM_KIT_RELEASE` and `DEVTEAM_BOX_TOOLS` from the env it passes (child processes and `createGateway`'s `env`) and sets them only where it means to, so it passes on the box as in CI.

## Edge cases

- The image's release with a project's kit holding the port: amber "hub served by a project's kit", also when that kit's version happens to equal the release (no `image: true` means it is not the image's hub).
- `/box.json` answers but `image` is null (a box on an image before kit-47): no line.
- The gateway's fallback is also what an unreadable answer (over 1 MB, non-200, timeout) gives: "hub not answering" covers those too, which is what the owner needs to know.
- A token outside `^[\w.+-]{1,64}$` (an escape, a space, a 10 KB string) never reaches a terminal or the page: the gateway drops it, and the page and `machine status` check again (the page reads JSON over the network; the status line reads the env).
- `image` holds versions only; it stays behind the gateway's session like the rest of `/box.json`.

## Out of scope

- The boot, the `DEVTEAM_IMAGE_HUB` `ENV`, the deploy gate (kit-49); end-to-end in the built image (kit-51).
- Showing versions on a laptop hub, or on a project's dashboard.
- Comparing tools with upstream (that is `box-pins check`, kit-48).

## Rulings

- m-20261115-030119049-supervisor (box load rule): never run the full kit test suite locally; run only the touched test files, one at a time, at `--test-concurrency=2`; GitHub CI runs the full suite and is the gate. Reviewers are told the same.
