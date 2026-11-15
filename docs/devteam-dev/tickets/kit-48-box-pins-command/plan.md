# kit-48-box-pins-command Implementation Plan

## TL;DR

- One script (`docs/devteam/scripts/devteam.mjs`) and one test file (`test/machine.test.mjs`); no new file outside this ticket's records.
- T1: the tool table, the Dockerfile reader, dispatch (`box-pins` in `KIT_VIEWS`, `installed` machine-wide, `--dockerfile`, exit 2 with no file) and offline `verify [--release]`.
- T2: the upstream reader (npm, PyPI, GitHub releases list, prereleases skipped, 15 s timeouts) and `check [--json]`, against an in-process fixture server.
- T3: `bump --release vX.Y.Z [--dry-run]`: new versions, sums from hashing the downloaded assets (cross-checked against GitHub's `digest`), all-or-nothing write.
- T4: `installed`: each tool by its absolute image path (`DEVTEAM_BOX_BIN` for tests), claude-swap through `UV_TOOL_DIR=/opt/uv/tools uv tool list`, compared with `DEVTEAM_BOX_TOOLS`.
- T5: help lines and the amended `KIT_VIEWS` comment; the whole machine test file and CI.
- Every task test-first; every new test spawns the kit with `pinsEnv(…)`, which deletes `DEVTEAM_IMAGE_HUB`, `DEVTEAM_KIT_RELEASE`, `DEVTEAM_BOX_TOOLS` (and the tokens), setting only what it means to; the test Dockerfile's pins are fixed values, so a real bump never breaks the tests.

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native: the five tasks build one command in one file, each on the last one's helpers). Steps use checkbox (`- [ ]`) syntax. A fresh subagent reviews each task (`reviews/task-<n>.md`).

**Goal:** `devteam.mjs box-pins verify|check|bump|installed`, the release tooling for the box image's pins.

**Architecture:** A `BOX_TOOLS` table drives everything. `readPins(text)` parses the Dockerfile into `{ tools, release, problems }`; `verify`, `check` and `bump` build on it; `latestOf(tool)` is the one upstream reader; `bump` edits only `ARG` lines and re-verifies before an atomic write. `installed` shares only the table.

**Tech Stack:** Node built-ins (`fetch`, `node:crypto`, `node:child_process`), `node --test`; Node 18–24 (CI matrix).

**Spec:** `docs/devteam-dev/tickets/kit-48-box-pins-command/spec.md`.

## Global Constraints

- `devteam.mjs` stays one file, Node built-ins only, no relative imports; works on Node 18 (global `fetch`, `AbortSignal.timeout`, `res.arrayBuffer()`; no `Response.body` async iteration). So a download is hashed from its buffered body (`arrayBuffer()`, assets ≤ ~30 MB), not streamed as the spec's bump step 2 says: same hash, simpler on Node 18; a plan-level departure, stated here for the supervisor.
- No network in any test: `DEVTEAM_PINS_NPM`, `DEVTEAM_PINS_PYPI`, `DEVTEAM_PINS_GITHUB` point at one in-process `http` server on `127.0.0.1:0`.
- Exact strings (spec): `<name>: current <pinned>`, `<name>: stale <pinned> -> <latest>`, `<name>: held <reason>`, `<name>: unknown <why>`; `box-pins verify: ok, <n> tools, release <r>`; `box-pins: no cloud/Dockerfile at <path> (box-pins works on the kit's own checkout, or --dockerfile <path>)` (exit 2); `box-pins bump: <tool>: <why>; nothing written`; `box-pins installed: DEVTEAM_BOX_TOOLS is not set (not the box image?)` (exit 2); `--json` shape `{ box_pins: 1, tools: [...] }` (or `{ box_pins: 1, problems: [...] }`); check exits 1 if any stale, else 3 if any unknown, else 0, and 2 for a missing or broken file; `box-pins bump: --release <r> is older than DEVTEAM_RELEASE <cur>`.
- The hold line is `# hold: <reason>` directly above `ARG <P>_VERSION=` (m-20261115-004401439-supervisor).
- Network strings printed only if they match `^[\w.+-]{1,64}$`, else `?`.
- Every kit test runs as `env -u DEVTEAM_RUN -u DEVTEAM_HOME -u DEVTEAM_ROLE -u DEVTEAM_TICKET -u DEVTEAM_FEATURE TMUX_TMPDIR=$(mktemp -d) node --test test/machine.test.mjs` (m-20261115-004401439-supervisor), wrapped by `node /data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs gate test -- <that command>` (written as a script file, worker.md §3).
- Existing tests in `test/machine.test.mjs` pass unchanged.

## Review Focus

1. A real GitHub releases list where the newest entry is a backport on an older line (e.g. `1.6.9` published after `1.7.0`): latest is the highest version, not the first entry. T2 test `check takes the highest release, not the newest entry`.
2. A tool already at latest during bump: nothing downloaded for it, its sums untouched (an asset fixture that would 500 for it proves no download). T3 test `bump downloads nothing for a tool already current`.
3. A hostile upstream string (`version: "1.2.3\u001b[2J"` or 10 KB): not a release, `unknown`, printed safely. T2 test `check prints an upstream's junk as unknown, never raw`.
4. Two tools pinned at one version (ttyd and claude-swap both `1.0.0`): no pin `ARG` line counts as a stray literal, but a comment naming `1.0.0` does. T1 test `verify does not count another tool's own ARG as a stray literal`.
5. `installed` where a binary hangs or is missing: `did not run`, exit 1, within its 20 s timeout. T4 test `installed names a tool that is missing`.

---

### Task 1: the table, the reader, dispatch and `verify`

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs` (~424-445 `KIT_VIEWS` and its comments, `machineWide`; ~483 the `DEVTEAM_RUN` exemption; a new `// ===== box-pins =====` block after `cmdHub` ~13876; `COMMANDS` ~19212)
- Test: `test/machine.test.mjs` (a new section at the end)

**Interfaces:**
- Produces:
  - `const BOX_TOOLS = [{ name, prefix, source: 'npm'|'pypi'|'github', pkg?, repo?, assets?: { x86_64: (pin) => string, aarch64: (pin) => string }, run: [file, ...args], parse: (stdout) => string|null }]`, in the table order of the spec (claude-code, claude-swap, gh, ttyd, mise, uv). `assets` present ⇔ binary.
  - `readPins(text) -> { lines: string[], tools: [{ tool, version, versionLine, sums: { x86_64?, aarch64? }, sumLines, hold: string|null }], release: string|null, releaseLine: number|null, problems: string[] }` (structure problems 1-5, 7, 8 of the spec; never the `--release` comparison).
  - `pinForm(v, pinned) -> string` (strip a leading `v`, add one back iff `pinned` starts with `v`); `versionParts(v) -> number[]|null` (`^v?\d+(\.\d+)+$` only); `newer(a, b) -> boolean` (a > b by parts).
  - `pinsFile() -> { file, text }` (reads `--dockerfile` or `<repoRoot>/cloud/Dockerfile`; missing → the exit-2 line).
  - `cmdBoxPins()` dispatching on `positional[0]`: `verify`, `check`, `bump`, `installed`; else the usage line and exit 1.
  - `safe(s) -> string` (the `^[\w.+-]{1,64}$` filter, else `?`), used by T1's messages and T2–T4.
- Test helpers produced (for T2–T5):
  - `FIXED = { CLAUDE_CODE: '2.1.307', CLAUDE_SWAP: '1.0.0', GH: '2.104.0', TTYD: '1.7.7', MISE: 'v2026.10.17', UV: '0.13.7' }`, `FIXED_RELEASE = 'v0.52.0'`, and fixed sums `fixedSum(arg) = sha256(arg)` hex. `pinsCopy(edit = (t) => t)` reads the real `cloud/Dockerfile`, rewrites every `ARG <P>_VERSION=`, `_SHA256_*=` and `DEVTEAM_RELEASE=` line to those fixed values, drops every line matching `/^\s*#\s*hold\b/i` (so a real hold landing in the Dockerfile never changes a test; plan-2 F1), then applies `edit`, writes it to a fresh temp file and returns its path. So every expected string in the tests below comes from `FIXED`, never from today's pins, and the release-prep bump of the real file never breaks a test (plan-1 F1). Only the "ok on the kit's own Dockerfile" case reads the real file, with no value hard-coded.
  - `pinsRepo` (made once: a temp git repo, origin `git@github.com:sanctuarycomputer/devteam.git`, a copy of `docs/devteam` without `project/` and `run/`, no `cloud/`).
  - `pinsEnv(extra = {})`: `baseEnv` with `DEVTEAM_IMAGE_HUB`, `DEVTEAM_KIT_RELEASE`, `DEVTEAM_BOX_TOOLS`, `DEVTEAM_PINS_NPM`, `DEVTEAM_PINS_PYPI`, `DEVTEAM_PINS_GITHUB`, `DEVTEAM_BOX_BIN`, `GH_TOKEN`, `GITHUB_TOKEN`, `UV_TOOL_DIR` deleted, then `extra`.
  - `pins(args, env = {})`: `spawnSync` of the copied kit's `devteam.mjs box-pins …`, cwd `pinsRepo`, env `pinsEnv(env)`. `pinsAsync(args, env = {}) -> Promise<{ status, stdout, stderr }>`: the same with `execFile`, resolving on a non-zero exit (status from `err.code`), never rejecting on one; T2–T3 use it because the fixture server lives in the test process (plan-1 F6).

- [ ] **Step 1: Write the failing tests**

```js
test('box-pins verify: ok on the kit\'s own Dockerfile; exit 2 with none', () => {
  const ok = pins(['verify', '--dockerfile', path.join(REPO, 'cloud/Dockerfile')]);
  assert.equal(ok.status, 0, ok.stderr + ok.stdout);
  assert.match(ok.stdout, /^box-pins verify: ok, 6 tools, release v\d+\.\d+\.\d+$/m);
  const none = pins(['verify']);
  assert.equal(none.status, 2);
  assert.match(none.stdout + none.stderr, /no cloud\/Dockerfile at .*cloud\/Dockerfile/);
});
test('box-pins verify names each problem and exits 1', () => {
  const cases = [
    [(t) => t.replace(/^(ARG TTYD_SHA256_X86_64=)\w+$/m, '$1ABC'), /TTYD_SHA256_X86_64 is not 64 lowercase hex/],
    [(t) => t.replace(/^ARG GH_SHA256_AARCH64=\w+\n/m, ''), /gh has no GH_SHA256_AARCH64/],
    [(t) => t.replace(/^ARG DEVTEAM_RELEASE=.*$/m, 'ARG DEVTEAM_RELEASE=0.52'), /DEVTEAM_RELEASE 0\.52 is not vX\.Y\.Z/],
  ];
  for (const [edit, re] of cases) { const r = pins(['verify', '--dockerfile', pinsCopy(edit)]); assert.equal(r.status, 1, String(re)); assert.match(r.stdout, re); }
  const url = pins(['verify', '--dockerfile', pinsCopy((t) => t.replace('download/v$GH_VERSION/gh_${GH_VERSION}_linux', 'download/v2.104.0/gh_2.104.0_linux'))]);
  assert.equal(url.status, 1); assert.match(url.stdout, /gh's version 2\.104\.0 is written outside its ARG \(line \d+: /);
  const rel = pins(['verify', '--release', 'v1.2.3', '--dockerfile', pinsCopy()]);
  assert.equal(rel.status, 1); assert.match(rel.stdout, /DEVTEAM_RELEASE is v\d+\.\d+\.\d+, not v1\.2\.3/);
});
test('verify does not count another tool\'s own ARG as a stray literal', () => {
  const f = pinsCopy((t) => t.replace(/^ARG TTYD_VERSION=.*$/m, 'ARG TTYD_VERSION=1.0.0')); // claude-swap is 1.0.0 too
  assert.equal(pins(['verify', '--dockerfile', f]).status, 0);
  const g = pinsCopy((t) => t.replace(/^(# ttyd, the web terminal)$/m, '$1 1.0.0'));
  assert.match(pins(['verify', '--dockerfile', g]).stdout, /claude-swap's version 1\.0\.0 is written outside its ARG/);
});
test('verify takes a hold above the _VERSION ARG, and refuses one with no reason', () => {
  assert.equal(pins(['verify', '--dockerfile', pinsCopy((t) => t.replace(/^ARG MISE_VERSION=/m, '# hold: waiting on a fix\n$&'))]).status, 0);
  const r = pins(['verify', '--dockerfile', pinsCopy((t) => t.replace(/^ARG MISE_VERSION=/m, '# hold:\n$&'))]);
  assert.equal(r.status, 1); assert.match(r.stdout, /mise's hold has no reason/);
  const far = pins(['verify', '--dockerfile', pinsCopy((t) => t.replace(/^# ttyd, the web terminal$/m, '# hold: bad build\n$&'))]);
  assert.equal(far.status, 1); assert.match(far.stdout, /the hold on line \d+ is not directly above a _VERSION ARG/);
  const odd = pins(['verify', '--dockerfile', pinsCopy((t) => t.replace(/^ARG MISE_VERSION=/m, '# Hold: x\n$&'))]);
  assert.equal(odd.status, 1); assert.match(odd.stdout, /line \d+ looks like a hold but is not "# hold: <reason>"/);
});
```

- [ ] **Step 2: Run them to see them fail** (script file running the gate command of Global Constraints with `--test-name-pattern 'box-pins verify|verify '`). Expected: FAIL, `no docs/devteam/project/settings.md here` (before `box-pins` is in `KIT_VIEWS`, startup refuses first; plan-1 F9).

- [ ] **Step 3: Implement** `BOX_TOOLS`, `readPins`, `pinForm`, `versionParts`, `newer`, `pinsFile`, `cmdBoxPins` (`verify` only so far; `check`/`bump`/`installed` arms say `not yet` until their tasks), and the dispatch: `'box-pins'` added to `KIT_VIEWS`; `machineWide` and the `DEVTEAM_RUN` exemption gain `(command === 'box-pins' && positional[0] === 'installed')`; `COMMANDS['box-pins'] = cmdBoxPins`. The stray-literal scan (spec verify 4): skip every pin `ARG` line of the table, `ARG DEVTEAM_RELEASE=` and `# hold:` lines; in the rest, a version (without its `v`) matches `(?<![\d.])<escaped>(?!\.?\d)`, a sum `(?<![0-9a-fA-F])<sum>(?![0-9a-fA-F])`. A line matching `/^\s*#\s*hold\b/i` that is not exactly `# hold: <reason>`, or not directly above a `_VERSION` ARG, is a problem (spec problem 8, so check and bump refuse on it too). `DEVTEAM_BOX_TOOLS` is the one line matching `^\s*(?:ENV\s+)?DEVTEAM_BOX_TOOLS="([^"]*)"`, whose pairs must be exactly the six `<name>=$<P>_VERSION`. Problem wording, exactly: `<name> has no <P>_VERSION`, `<name>'s <P>_VERSION is given <n> times`, `<name> has no <ARG>`, `<ARG> is not 64 lowercase hex`, `<name>'s version <v> is written outside its ARG (line <n>: <matched text>)`, `<name>'s <ARG> sum is written outside its ARG (line <n>: <matched text>)`, `no DEVTEAM_RELEASE`, `DEVTEAM_RELEASE <r> is not vX.Y.Z`, `DEVTEAM_RELEASE is <r>, not <given>`, `DEVTEAM_BOX_TOOLS does not name <name>=$<P>_VERSION`, `DEVTEAM_BOX_TOOLS names <pair>, which is no tool's`, `no DEVTEAM_BOX_TOOLS` / `DEVTEAM_BOX_TOOLS is given <n> times`, `<name>'s hold has no reason`, `the hold on line <n> is not directly above a _VERSION ARG`, `line <n> looks like a hold but is not "# hold: <reason>"`. Values in a message pass through the `^[\w.+-]{1,64}$` filter.

- [ ] **Step 4: Run to pass**, then the whole file (existing tests unchanged). Expected: PASS.

- [ ] **Step 5: Commit** `kit-48 T1: box-pins verify, the table and the reader`.

### Task 2: the upstream reader and `check`

**Files:** Modify `docs/devteam/scripts/devteam.mjs` (box-pins block); Test `test/machine.test.mjs`.

**Interfaces:**
- Consumes: T1's `BOX_TOOLS`, `readPins`, `pinForm`, `versionParts`, `newer`, `pinsFile`.
- Produces: `async latestOf(tool, pinned) -> { version, release? }` (throws `Error(why)`; `release` is the chosen GitHub release object, for T3's assets); `async checkPins(pins) -> [{ name, pinned, status, latest?, reason?, why? }]`.
- Test helper produced: `async upstream(t)` → `{ url, state }`, an `http` server on `127.0.0.1:0`, `unref()`'d and closed in `t.after` (so a failed assertion can't hang the file; plan-1 F8), whose `state` holds `npm` (by package → version), `pypi` (by package → version), `releases` (by repo → the list) and `assets` (by path → `{ status?, body }`); every request is pushed to `state.hits` as `{ path, headers }` (plan-1 F5). `upEnv(u)` → the three `DEVTEAM_PINS_*` vars at `u.url + '/npm'`, `'/pypi'`, `'/gh'`. Fixture default: every tool one release newer than `FIXED`, each GitHub release listing both arch assets with `browser_download_url` `/dl/<repo>/<name>` (answered 302 to `/assets/<repo>/<name>`), bytes `<repo>/<name>/<version>` (distinct per asset), and a `digest` of their real sha256.

- [ ] **Step 1: Failing tests**

```js
test('box-pins check: one line per tool; stale exits 1; held, current; --json the same', async () => { /* stale for all six → status 1, lines `ttyd: stale 1.7.7 -> 1.7.8` …; a hold on gh → `gh: held <reason>`, no hit on cli/cli; fixture latest == pins and gh held → status 0, `current` lines; --json parses to the same statuses with box_pins: 1 */ });
test('check ignores a GitHub prerelease and a draft, and takes the highest release, not the newest entry', async () => { /* ttyd list: [{tag 1.9.0, prerelease: true}, {tag 2.0.0, draft: true}, {tag 1.6.9}, {tag 1.7.8}] (plain tags, so only the flags exclude them; plan-1 F2) → `ttyd: stale 1.7.7 -> 1.7.8` */ });
test('check reports an unreachable upstream as unknown, and junk as unknown, never raw', async () => { /* DEVTEAM_PINS_NPM at a closed port → `claude-code: unknown …` and exit 3 when nothing else is stale; pypi version '1.2.3\u001b[2J' → `claude-swap: unknown not a release: ?`; stdout has no \u001b */ });
test('check sends GH_TOKEN to the GitHub API, and nowhere else', async () => { /* GH_TOKEN=fake-token: every hit under /gh has headers.authorization === 'Bearer fake-token'; no hit under /npm or /pypi has an authorization header */ });
test('check on a broken file exits 2 with its problems, in --json too', async () => { /* TTYD_SHA256_X86_64 removed → status 2, `box-pins check: ttyd has no TTYD_SHA256_X86_64`; --json → { box_pins: 1, problems: [ … ] }, status 2 */ });
```

The fixture's `browser_download_url`s are `/dl/…`, answered with a 302 to `/assets/…` (both outside `/gh`, the `DEVTEAM_PINS_GITHUB` base), distinct bytes per asset. Each test spawns with `pinsAsync` (T1), since the fixture server lives in the test process.

- [ ] **Step 2: Run, see fail** (`not yet`).
- [ ] **Step 3: Implement** `latestOf` (npm `GET <base>/<pkg with / as %2f>/latest` → `.version`; PyPI `GET <base>/pypi/<pkg>/json` → `.info.version`; GitHub `GET <base>/repos/<repo>/releases?per_page=30`, filter `!draft && !prerelease && versionParts(tag_name)`, max by `newer`; headers `accept: application/vnd.github+json`, `user-agent: devteam-box-pins`, `authorization: Bearer $GH_TOKEN` only here and only when set; `AbortSignal.timeout(15000)`; a non-2xx is `HTTP <status>`, a fetch error `unreachable (<code or name>)`, a version that fails `versionParts` `not a release: <safe(v)>`), `checkPins`, and the `check` arm (`--json`; exit 1 if any stale, else 3 if any unknown, else 0; `readPins` problems → exit 2 as the spec says).
- [ ] **Step 4: Run to pass**, whole file.
- [ ] **Step 5: Commit** `kit-48 T2: box-pins check`.

### Task 3: `bump`

**Files:** Modify `docs/devteam/scripts/devteam.mjs`; Test `test/machine.test.mjs`.

**Interfaces:**
- Consumes: T1, T2 (`latestOf` returns the GitHub release with its `assets`).
- Produces: `async bumpPins(text, release) -> { text, changes: [{ arg, from, to }], held: [{ name, reason }] }` (throws `Error('<tool>: <why>')`).

- [ ] **Step 1: Failing tests**

```js
test('box-pins bump --release v9.9.9 sets each unheld tool to latest with the assets\' real sums', async () => { /* hold on uv; after bump: each ARG _VERSION == fixture latest in pin form; each _SHA256_* == sha256 of the fixture asset bytes for that arch; UV lines identical to before; DEVTEAM_RELEASE=v9.9.9; `verify --release v9.9.9` exits 0 */ });
test('bump --dry-run prints the change and leaves the file byte-identical', async () => { /* stdout has `TTYD_VERSION ${FIXED.TTYD} -> <fixture latest>` and `--dry-run: nothing written`; file sha equal before/after */ });
test('bump writes nothing when an upstream fails, or a digest disagrees', async () => { /* gh's arm64 asset answers 500 → exit 1, `box-pins bump: gh: …; nothing written`, file byte-identical; a second run with mise's asset digest 'sha256:' + '0'.repeat(64) → exit 1, names mise */ });
test('bump sends no token with a download', async () => { /* GH_TOKEN=fake-token, bump --release v9.9.9: hits under /gh carry the token; no hit under /dl, /assets, /npm or /pypi has an authorization header (plan-1 F4, F5) */ });
test('bump keeps the file\'s mode, and writes nothing when nothing changes', async () => { /* copy chmod 0o640 → after bump, mode & 0o777 === 0o640; then fixture latest == the new pins and --release the same v9.9.9 → stdout `unchanged`, mtimeMs and bytes the same (plan-1 F12) */ });
test('bump and check refuse a malformed hold', async () => { /* `# Hold: x` above ARG MISE_VERSION: bump --release v9.9.9 → exit 1, file byte-identical, no upstream hit; check → exit 2 */ });
test('bump refuses a --release older than the stamp', async () => { /* --release v0.1.0 → exit 1, `--release v0.1.0 is older than DEVTEAM_RELEASE`, no upstream hit, file unchanged */ });
test('bump downloads nothing for a tool already current', async () => { /* ttyd's fixture latest = 1.7.7 and its assets answer 500 → exit 0, no hit on ttyd's asset paths, TTYD lines unchanged */ });
```

- [ ] **Step 2: Run, see fail.**
- [ ] **Step 3: Implement** `bumpPins` and the `bump` arm: refuse a missing or malformed `--release` (usage, exit 1); refuse on `readPins` problems (printed, exit 1); for each unheld tool, `latestOf`; skip unless `newer(latest, pinned)`; for a binary tool, for each arch find `release.assets` by `tool.assets[arch](newPin)`, `fetch(browser_download_url, { signal: AbortSignal.timeout(120000) })`, sha256 of `arrayBuffer()`, compare with `digest` when it starts `sha256:`; replace only lines `versionLine`, `sumLines[arch]`, `releaseLine`; re-run `readPins` plus the release check on the result and throw if any problem; unless `--dry-run`, write `<file>.<pid>.tmp` in the Dockerfile's own directory with the original's mode, then rename (skip and print `unchanged` when the text is identical).
- [ ] **Step 4: Run to pass**, whole file.
- [ ] **Step 5: Commit** `kit-48 T3: box-pins bump`.

### Task 4: `installed`

**Files:** Modify `docs/devteam/scripts/devteam.mjs`; Test `test/machine.test.mjs`.

**Interfaces:**
- Consumes: T1's `BOX_TOOLS` (`run`, `parse`), `pinForm`, `safe`.
- Produces: the `installed` arm.

- [ ] **Step 1: Failing tests** (fake binaries are `#!/bin/sh` scripts written with the file's `write`, then `fs.chmodSync(f, 0o755)` (plan-1 F10); the kit is a copy of `docs/devteam` in a temp folder that is no repo; cwd `nowhere`; env `pinsEnv({ DEVTEAM_BOX_BIN, DEVTEAM_BOX_TOOLS, PATH })`, so the three image vars are cleared and only `DEVTEAM_BOX_TOOLS` set (plan-1 F3)):

```js
const TOOLS_ENV = 'claude-code=2.1.307 claude-swap=1.0.0 gh=2.104.0 ttyd=1.7.7 mise=v2026.10.17 uv=0.13.7';
test('box-pins installed reads each tool by its image path and claude-swap from the image\'s tool dir', () => {
  // boxBin: claude -> '2.1.307 (Claude Code)'; gh -> 'gh version 2.104.0 (2026-10-01)\nhttps://github.com/cli/cli/releases/tag/v2.104.0';
  // ttyd -> 'ttyd version 1.7.7-40e79c7'; mise -> '2026.10.17 linux-x64 (2026-10-17)';
  // uv: `--version` -> 'uv 0.13.7 (abc1234 2026-10-01)'; `tool list` -> 'claude-swap v1.0.0\n- claude-swap\n- cswap' only when "$UV_TOOL_DIR" = /opt/uv/tools, else 'No tools installed'
  // shimBin (first on PATH): uv -> 'uv 0.9.0', and claude, gh, ttyd, mise printing wrong versions
  // run with DEVTEAM_BOX_BIN=boxBin, DEVTEAM_BOX_TOOLS=TOOLS_ENV, PATH=shimBin:… → status 0, six `<name>: <version>` lines
});
test('installed exits 1 naming the tool that differs, or is missing', () => { /* TOOLS_ENV with gh=2.105.0 → status 1, `gh: installed 2.104.0, pinned 2.105.0`; boxBin without ttyd → `ttyd: did not run`, status 1 */ });
test('installed without DEVTEAM_BOX_TOOLS exits 2', () => { /* `DEVTEAM_BOX_TOOLS is not set (not the box image?)` */ });
```

- [ ] **Step 2: Run, see fail.**
- [ ] **Step 3: Implement** the arm: `bin = process.env.DEVTEAM_BOX_BIN || '/usr/local/bin'`; for each tool `spawnSync(path.join(bin, file), args, { encoding: 'utf8', timeout: 20000, env: { ...process.env, ...(tool.name === 'claude-swap' ? { UV_TOOL_DIR: '/opt/uv/tools' } : {}) } })`; never `shell`; `parse` as the spec says; compare `pinForm(found, pin)` with the pin.
- [ ] **Step 4: Run to pass**, whole file.
- [ ] **Step 5: Commit** `kit-48 T4: box-pins installed`.

### Task 5: help, the comment, the whole file and CI

**Files:** Modify `docs/devteam/scripts/devteam.mjs` (HELP "Dashboard and releases" ~19190; the comments above `KIT_VIEWS` ~424-428); Test `test/machine.test.mjs`.

- [ ] **Step 1: Failing test** `help names box-pins and says only the top package of npm and PyPI tools is pinned`: `spawnSync(process.execPath, [KIT, 'help'], { cwd: nowhere, encoding: 'utf8', env: pinsEnv() })` stdout matches `/box-pins verify/`, `/check \[--json\]/`, `/bump --release vX\.Y\.Z/`, `/box-pins installed/`, `/only the top package/`.
- [ ] **Step 2–4:** add the help lines: `box-pins verify [--release vX.Y.Z] | check [--json] | bump --release vX.Y.Z [--dry-run] [--dockerfile p]   the box image's tool pins in cloud/Dockerfile, in the kit's own checkout: offline stamp check, which are behind upstream, and the release-prep bump (fresh sums); only the top package of the npm and PyPI tools is pinned, their dependencies resolve at build` and `box-pins installed   inside the box image: what each tool reports at its image path, against DEVTEAM_BOX_TOOLS`. Amend the comments: "its read-only views run there … nothing in them writes" becomes "its views run there as they always did, over no tickets: nothing in them writes but `box-pins bump`, which rewrites only cloud/Dockerfile's pins". Run the whole file through the gate; push; CI green on every job.
- [ ] **Step 5: Commit** `kit-48 T5: help and the KIT_VIEWS comment`.

## Rulings

- m-20261115-004401439-supervisor: hold line above `_VERSION`; the env-cleared test command.
- m-20261115-011227101-supervisor: spec approved at c989c4a, its calls beyond the done-whens included (check exits 3 on unknown-and-none-stale and 2 on a broken file; bump refuses an older --release; verify checks DEVTEAM_BOX_TOOLS). The supervisor reads the whole plan once its review passes (risk high).
- m-20261115-012104539-supervisor: plan approved (read whole); buffered hashing is fine. The PR body's "doesn't defend against" line must say: bump pins whatever upstream publishes (trust on first download, cross-checked only against GitHub's own digest), so a compromised upstream release would be pinned; the reviewed release-prep PR is the check.
