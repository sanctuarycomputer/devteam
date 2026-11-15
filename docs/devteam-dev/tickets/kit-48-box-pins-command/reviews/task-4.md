# Task review, Task 4 (`box-pins installed`), pass 1

- Reviewer: task-reviewer (fresh subagent, adversarial, claude-opus-5-5)
- Reviewed: 7cfb9eae0b38e04ac5cdddebf484d419a8ede4a9

I read `git show 7cfb9ea` for `docs/devteam/scripts/devteam.mjs` and `test/machine.test.mjs`, Task 1's `BOX_TOOLS`, `firstVersion`, `pinForm` and `safe`, and the `machineWide` and `DEVTEAM_RUN` exemptions. I checked them against spec.md (`### box-pins installed`, Dispatch, done-when 5) and plan.md Task 4. I ran the three `installed` tests from a `git archive 7cfb9ea` copy on Node v18.20.4, and all pass.

What holds:
- **Absolute path, no shell.** Each tool runs as `spawnSync(path.join(bin, file), args, …)` with no `shell`. `bin` is `DEVTEAM_BOX_BIN` or `/usr/local/bin`. claude-swap is read from `uv tool list`, and `BOX_TOOLS`' `env` adds `UV_TOOL_DIR=/opt/uv/tools` on top of `process.env`. The timeout is 20 s.
- **Version parsing on the real outputs.** All six parse correctly: ttyd `1.7.7-40e79c7` gives `1.7.7`, Claude Code gives `2.1.307`, gh's two lines give `2.104.0` (the first match, not the URL's `v2.104.0`), mise gives `2026.10.17` and is shown as `v2026.10.17` because its pin has a `v`, uv gives `0.13.7`, and claude-swap gives `1.0.0`. A `v` pin on a bare-printing tool (`claude-code=v1.2.3`) matches and prints `v1.2.3`.
- **Exit codes.** 0 when everything matches. 1 for a mismatch, a tool that did not run (ENOENT, `exit 3`, ETIMEDOUT, all checked), no version in its output, a tool missing from `DEVTEAM_BOX_TOOLS`, or an unknown name. 2 when the variable is unset or only whitespace.
- **Terminal safety.** I made a fake ttyd that prints an OSC escape before its version. Only the digits reach the output. Pins and unknown names go through `safe`, so a name that holds `ESC[31m` prints as `?`, and error codes and signals are `safe`d too.
- **The test fixture.** The kit is copied into a folder that is no repo, with project/ and run/ removed, as the image does at Dockerfile:155. The cwd is `nowhere`, and a shim folder that prints wrong versions comes first on PATH.

Mutations, each run in a scratch copy against the three tests:
- PATH lookup (`spawnSync(file, …)`): tests 1 and 2 fail.
- No `UV_TOOL_DIR`: test 1 fails.
- No `pinForm`: test 1 fails, on mise.
- No `DEVTEAM_RUN` exemption: test 1's second run fails.
- `die` without code 2: test 3 fails.
- No `machineWide` entry for `installed`: **all three still pass** (F1).

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec Dispatch ("`box-pins installed` is machine-wide: it joins the `machineWide` test"); quality.md §3 (mutate, check a test fails) | test/machine.test.mjs `installed` tests; devteam.mjs ~443 | No test covers the `machineWide` exemption. The kit and the cwd are both outside any repo, so `homeAt` never reaches the settings.md refusal, and removing `\|\| (command === 'box-pins' && positional[0] === 'installed')` leaves every test green. In a scratch run, the mutant run from a cwd that is a `git init` repo with no settings.md exits 1 with `no docs/devteam/project/settings.md here`, and the real code exits 0. One more `installed(...)` call with `cwd` set to a bare `git init` folder would guard it. | fixed: a test runs installed from a git repo with no settings.md (breaks without the machineWide exemption) |
| F2 | Minor | spec `installed` ("by absolute path under `<bin>` (never a PATH lookup …)") | devteam.mjs `installed` arm, `const bin = process.env.DEVTEAM_BOX_BIN \|\| '/usr/local/bin'` / `path.join(bin, file)` | A relative `DEVTEAM_BOX_BIN` is not made absolute. With `DEVTEAM_BOX_BIN=.`, `path.join` gives a bare `claude`, and spawnSync looks it up on PATH. A scratch run with a shim first on PATH printed the shim's `7.7.7` for every tool. Any other relative value resolves against the cwd. Only a test sets the knob (spec Security), so the impact is small. `path.resolve(bin, file)`, or refusing a non-absolute `DEVTEAM_BOX_BIN`, would keep "never a PATH lookup" true for every input. | fixed: DEVTEAM_BOX_BIN goes through path.resolve; a test with DEVTEAM_BOX_BIN=. and a wrong tool first on PATH |
| F3 | Suggestion | none cited | devteam.mjs `installed` arm, `want.set(...)` | When a name appears twice in `DEVTEAM_BOX_TOOLS`, the last value is used without any warning (`gh=9.9.9 … gh=1.2.3` passes). verify's problem 7 already guards the Dockerfile's `ENV`, so this only matters for a hand-set environment. A duplicate could be reported as a line with exit 1. | fixed: a tool named twice in DEVTEAM_BOX_TOOLS is a line and exit 1; tested |

Verdict: APPROVE 7cfb9eae0b38e04ac5cdddebf484d419a8ede4a9
