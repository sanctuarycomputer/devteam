# Image changes: image-changes@1

Contract `image-changes@1`. Provided by `devteam.mjs box-pins changed` (kit-671): it says whether a release range is a **patch** (nothing the box image runs, or relies on in a project's kit, changed) or a **minor**. Used by a release script that runs it from another repo and by `.github/workflows/box-deploy.yml` (kit-672). `test/image-changes-contract.test.mjs` holds this document and its fixtures (`test/fixtures/image-changes/`, §9) to one another, with a reference checker of the forms below.

## 1. Who provides and consumes it; versioning

Provider: `devteam.mjs box-pins changed` (kit-671). Consumers: a release script that classifies a release before it is published, from a checkout of the kit at the release, and `.github/workflows/box-deploy.yml` (kit-672). The JSON carries `v: 1`. Additive changes only keep it (a new key in the JSON object or in a change); anything else (a key removed or retyped, a new `kind`, a new exit code with a meaning, a change to the text lines or to the smoke rules below) bumps it to 2 and this document to `image-changes@2`. A reader ignores keys it doesn't know. Tightening §6's comparison so it reports fewer false differences (a new placeholder, a narrower choice of the fixture's lines) while two fixtures from one tree still compare equal (§6.10) is additive too: no consumer reads the comparison, only its result.

## 2. Invocation

```
devteam.mjs box-pins changed --since <ref> [--to <ref>] [--smoke] [--json]
```

- Run in the kit's own checkout (a `KIT_VIEWS` command, as `box-pins verify`), from a checkout at `--to`: the list of what the image runs is the running script's own. Both consumers run it with cwd in a checkout at `--to`.
- `--to` defaults to `HEAD`. `--since` has no default. Both are any ref git resolves to a commit.
- It writes nothing outside a temporary folder it makes and always removes.

## 3. The text form (no `--json`)

stdout is one line per change, in the changes' order (§5): `image: <file>` when its part is null, `image: <file>#<part>` otherwise (a smoke difference reads `image: (smoke)#<command>`). The last line is `kind: patch`, or `kind: minor (<n> changes the image runs)` with `<n>` the number of changes in decimal (the words don't change for 1). Every line ends with `\n`; there is nothing else on stdout. So a patch's stdout is exactly `kind: patch\n`.

## 4. The JSON form (`--json`)

stdout is one JSON document and a newline, nothing else (formatting free):

```
{ "v": 1, "since": "<sha>", "to": "<sha>", "kind": "patch" | "minor", "changes": [{ "file": "<path>", "part": "<name>" | "(rest)" | null }] }
```

- `since`, `to`: the full 40-hex commit each ref resolved to (lowercase).
- `file`: a path relative to the kit repo's root, as git names it (`/`-separated, no leading `/`), or `"(smoke)"`.
- `part`: `null` for a whole file (a file a whole-file entry lists, or one side of a rename of one); a D4 part name of `docs/devteam/scripts/devteam.mjs` (a listed part whose leaf changed); `"(rest)"` for that file's rest; for file `"(smoke)"`, the smoke command that differed, as §6 names it (`machine status`, `machine status --questions`, `machine status --knowledge` or `recover --machine --dry-run --force`).
- A file has either one change with part null, or changes with parts, never both; no change appears twice.

## 5. Order and kind

`changes` is sorted by `file` and then `part`, both by UTF-16 code units (JavaScript's default string order), a null part before any string. `changes` is empty exactly when `kind` is `"patch"`, and non-empty exactly when it is `"minor"`.

## 6. `--smoke`

With `--smoke` the command also runs the image's readers of a project, as of `--since`, against a project on each kit, and any difference is a change:

1. A detached worktree of `--since` (the image) in the temporary folder.
2. Two fixture projects there, one from the `--since` tree's `docs/devteam` and one from the `--to` tree's, each a fresh `git init -b main` with that tree's `docs/devteam` copied in, each in a folder named `smoke-fixture` (the same name for both) inside a parent folder of its own (`--in` reads a parent), each with a HOME of its own (a folder in the temporary folder), so neither registers in the other's `~/.devteam`.
3. A fixed git identity in the environment for every git and kit command: `GIT_AUTHOR_NAME` and `GIT_COMMITTER_NAME` `devteam-smoke`, `GIT_AUTHOR_EMAIL` and `GIT_COMMITTER_EMAIL` `devteam-smoke@example.invalid`.
4. Each fixture is made and seeded by its **own** kit (`node docs/devteam/scripts/devteam.mjs`, cwd the fixture's root, its HOME), these commands in this order:
   1. `init`
   2. `git add -A` then `git commit -m fixture`
   3. `ask --question 'Smoke question?' --stake 1 --urgency 1` (the one open question)
   4. `knowledge add --owner --kind fact --statement 'Smoke fact.'` (the one knowledge entry: the owner's is accepted when written, so no further step; `--owner` holds because `DEVTEAM_ROLE`, `TMUX` and `TMUX_PANE` are unset)
   5. then remove `docs/devteam/run/supervisor-up.json` if it exists, so `recover` doesn't take the seeding for a running supervisor.
5. Every command runs with its own tmux socket (`TMUX` and `TMUX_PANE` unset, `TMUX_TMPDIR` a folder in the temporary folder), `DEVTEAM_HUB_PORT` a free port (never 4320), and every other `DEVTEAM_*` variable unset; stdin is `/dev/null`.
6. From the image worktree (cwd there, `node <worktree>/docs/devteam/scripts/devteam.mjs`), against each fixture in turn with **that fixture's** HOME, these four commands; the name in the change's part is the command as written here, without `--in`:
   - `machine status --in <parent>`
   - `machine status --questions --in <parent>`
   - `machine status --knowledge --in <parent>`
   - `recover --machine --dry-run --force --in <parent>`
7. **Only the fixture's own lines are compared**: a line that names the fixture (its name or its path as a whole word), and the lines under its heading (a line naming it that ends with `:`, then the indented lines after it up to the first that isn't). Every other line is dropped, so never the machine-wide lines (disk, memory, CPU, load, accounts, the hub, a summary line that names no project).
8. Before comparing, each output has these placeholders: the fixture's path → `<path>`, then its name as a whole word → `<name>`, its kit version (the value `machine status` prints after `kit=` on the fixture's line: `unreleased` for a fixture `init` made, since it has no `--upstream-base`) as a whole word → `<kit>`, ISO times (`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?`) → `<time>`, log ids (`\b[a-z]{1,2}-\d{8}-\d{9}-[a-z0-9][a-z0-9-]*`) → `<id>`.
9. For each command, a different exit code, or different lines (in order, after placeholders), is one change: file `"(smoke)"`, part the command. Both outputs' first differing lines go to stderr. A command that differs on both counts is still one change.
10. Two fixtures made from one tree compare equal: the provider's test holds that, so noise can't make every release a minor.
11. The temporary folder, the worktree included, is always removed, on every exit.

`operator-thread` isn't run: it reads no project's kit.

## 7. Exit codes, stderr, and what a caller does

- **0**: patch. **3**: minor. stdout is the text or JSON form above.
- **Any other code: can't tell.** **2** where the command says why (a usage error: no `--since`, a flag without its value, an unknown flag; a ref that doesn't resolve to a commit; git failing; a fixture that can't be made or seeded): stdout is empty, with or without `--json`, and stderr is one or more lines, the first starting `devteam: `. Only that prefix and the code are contract; the words after it are for people, and a caller never matches on them. **1** when the script dies before that (outside the kit's own checkout, the top-level guard dies first) or crashes.
- On 0 and 3 stderr carries notes for people (the smoke differences) and is not part of the contract.
- **A caller refuses** (treats as can't tell) on every code but 0 and 3; and, with `--json`, when stdout doesn't parse as §4 (with §5's order and kind), or when `kind` disagrees with the exit (`patch` with 3, `minor` with 0).

## 8. The stamp rule kit-672 implements

Recorded here so the consumers agree on it; kit-672 makes it so, not kit-671:

- `box-pins verify --release vX.Y.Z` requires `cloud/Dockerfile`'s `ARG DEVTEAM_RELEASE` to be `vX.Y.0` when Z > 0 (a patch names the minor it builds on), and the tag itself when Z = 0 (a minor or a major).
- `box-pins bump --release vX.Y.Z` refuses a tag with Z > 0: only a minor gets a release-prep PR.

## 9. The fixtures

`test/fixtures/image-changes/`, for a consumer to vendor as its fake (a stub that prints a `.txt` or `.json` to the right stream and exits with its `.exit`):

| File | What | `.exit` |
|---|---|---|
| `patch.json`, `patch.txt` | a patch: `changes` empty; text `kind: patch` | `patch.exit`: `0` |
| `minor.json`, `minor.txt` | a minor with four changes: a whole file (`cloud/gateway.mjs`), a `devteam.mjs` part (`cmdHub`), its rest (`(rest)`) and a smoke difference (`(smoke)`, `machine status --questions`) | `minor.exit`: `3` |
| `cant-tell.txt` | the stderr of exit 2 (a `--since` that doesn't resolve; its words are illustrative, only the `devteam: ` prefix is contract) | `cant-tell.exit`: `2` |

An `.exit` file is the code in decimal and a newline. `patch.exit` and `minor.exit` sit beside both of their forms (the JSON and the text of one run share a code). The shas in the fixtures are made up; nothing resolves them.
