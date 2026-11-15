# kit-233-worktree-trust: plan

## TL;DR

- A new pattern `PANE_TRUST` (Claude Code 2.1's `Quick safety check:` / `Yes, I trust this folder`, line-anchored; `Do you trust this folder`), read as a `prompt` wait when nothing on the pane is busy, so the metrics pass raises `blocked-prompt` for the dialog.
- New owner-only setting `agent_trust_command` (`governance-edit`, beside `agent_command`, home's only): run before a worker's or planner's agent is typed, in the worktree, with `DEVTEAM_WORKTREE` its real path, output to stderr; a failure warns and the launch goes on.
- `merge` refuses a PR that changes it without the owner's answer (through `OWNER_SETTINGS`, as for `agent_command`); quality.md's owner-settings list names it.
- One new top-level test in `test/kit.test.mjs` on its own `threadsFixture`, skipped without tmux: the finding, the hook, a failing hook, and the merge refusal.
- TDD: the test first, red on main (no finding for the dialog; the hook never runs; merge lets the change through), then the change.
- Gates: the touched test file alone, at --test-concurrency=2, through `devteam.mjs gate`; GitHub CI is the gate.

## Files

`docs/devteam/scripts/devteam.mjs`, `test/kit.test.mjs`, `docs/devteam/governance/quality.md` (ruling
m-20261115-071339001), plus this ticket's records under `docs/devteam-dev/tickets/kit-233-worktree-trust/`.

## Task 1: the failing test

A new top-level `test('a folder-trust dialog in a new session's pane is a blocked prompt, and agent_trust_command clears it before launch', { skip: hasTmux ? false : 'no tmux' }, …)` on `threadsFixture('trust')`:

1. Write at test time into `F.base` (no file added to the repo):
   - `agent.mjs`: a stand-in agent. It reads `screen.txt` (a path in F.base) and `trusted.txt` (if any);
     it appends `{ cwd, trusted }` to `calls.jsonl`, where `trusted` is whether `trusted.txt`'s first
     line equals `fs.realpathSync(process.cwd())`; when not trusted it prints `screen.txt` (the dialog);
     when trusted it prints `ready`. Then it waits (`setInterval`).
   - `trust.sh`: `printf '%s\n%s\n' "$DEVTEAM_WORKTREE" "$PWD" > <F.base>/trusted.txt; echo hook-out`.
2. Settings: replace `"agent_command": "true", "resume_command": "true"` with both set to the stand-in; commit and push to main (as kit-232's test does).
3. **The dialog, no hook.** `screen.txt` holds the captured dialog (spec, Problem). `planner big --goal F.goal`; wait (`until`) for one line in `calls.jsonl` and `Yes, I trust this folder` in the pane (`tmux capture-pane` with `F.env()`). One `metrics --json` (role supervisor): a `blocked-prompt` finding, `subject` `plan-big`, detail matching `/waiting on a prompt in its pane: "Quick safety check:/`.
4. **Line-anchored variants.** Kill the window; rewrite `screen.txt`; `planner big --resume`; wait; metrics. Each of:
   `❯ 1. Yes, I trust this folder` (finding), `│ Quick safety check: Is this a project you trust?` (finding),
   `the dialog says Yes, I trust this folder, and I answered it` (no `blocked-prompt` for `plan-big`),
   the full dialog followed by a line `✻ Reading… (esc to interrupt)` (busy: no `blocked-prompt`). Each waits until the pane shows its last line before `metrics`.
5. **The hook.** Settings `agent_trust_command` set to `sh <trust.sh>` (committed and pushed). Kill the window; `planner big --resume`; wait for a new line. `trusted.txt`'s first line is `fs.realpathSync(<F.old>/.worktrees/plan-big)`, its second (`$PWD`) the same worktree (realpath-compared); the launch's stdout still matches `resumed planner plan-big` and holds nothing the hook printed (trust.sh also echoes `hook-out`, which must show only in stderr); the call recorded `trusted: true`; metrics has no `blocked-prompt` for `plan-big`.
6. **A failing hook.** `agent_trust_command` `exit 3`; kill the window, remove `trusted.txt`; `planner big --resume` exits 0, warns `agent_trust_command failed`; the agent starts (a new line), shows the dialog, and metrics has the finding again.
7. **Merge refuses it.** From `F.old` on main: a branch `chore-trust` that changes `agent_trust_command` in settings.md, pushed; `merge --chore trust --dry-run --title 'chore-trust: trust hook' --body-file <body>` (body `## One-way doors\n\nNone.\n`) fails with `changes owner settings: agent_trust_command (governance-edit)`; an answered `governance-edit` question (`ask … --class governance-edit --reasons owner-only`, `answer <q> yes`) as `--approved` makes the dry run pass.
8. Clean up: kill the fixture's tmux server; `F.done()`.

Steps 5 and 7 commit settings on main in the fixture: step 7 runs last, so nothing later sees it.

Run: `devteam.mjs gate test -- node --test --test-concurrency=2 --test-name-pattern='folder-trust' test/kit.test.mjs`. Red on main: step 3 finds no finding.

## Task 2: the change

In `docs/devteam/scripts/devteam.mjs`:

1. Beside `PANE_WAITS`: `const PANE_TRUST = /Do you trust (?:the (?:files|contents)|this (?:folder|directory|workspace))|^(?:[│|]\s*)?(?:❯\s*)?(?:\d+\.\s*)?Yes, I trust this (?:folder|directory|workspace)\b|^(?:[│|]\s*)?Quick safety check:/i`, with a comment (the dialog a new worktree gets; anchored; read only when not busy). In `paneWaitingIn`, after the `PANE_WAITS` loop finds nothing and `!busy`: the first line not `PANE_CODE` that `PANE_TRUST` matches is `{ kind: 'prompt', line }`. In `limitStop`, `otherPrompt` also tests `PANE_TRUST`. The existing `Do you trust the files` in `PANE_WAITS` stays (it is checked even when busy, as today).
2. `SETTINGS_DEFAULTS.agent_trust_command: ''` beside `resume_command`, with a comment: what it is for, when it runs, its env, and the Claude Code example (set `projects[$DEVTEAM_WORKTREE].hasTrustDialogAccepted` in `${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json`, written atomically: a temp file and a rename).
3. `OWNER_SETTINGS.agent_trust_command: 'governance-edit'`.
4. In the worker/planner launch, after `seedWorktree(wt, { repo: R })`: when `s.agent_trust_command` is a non-empty string, run `execFileSync('sh', ['-c', cmd], { cwd: wt, stdio: ['ignore', 2, 'inherit'], env: { ...gateEnv(null, R), DEVTEAM_WORKTREE: fs.realpathSync(wt) }, timeout: 60000 })`; on throw, `warn(...)` as the spec says and go on.
5. Re-run Task 1's test: green.

In `docs/devteam/governance/quality.md` §130: add `agent_trust_command` after `agent_command` in the governance-edit list.

## Task 3: verification and finish

`verification.md`, a row per done-when; merge `origin/main`; PR; final review; `check-ticket`; `merge-request`.

## Rulings

- m-20261115-071339001-supervisor (re m-20261115-071257437): `agent_trust_command` is owner-only, beside `agent_command`; governance/quality.md is in touches (one name added to the owner-settings list); merge refuses a PR that changes it without the owner's answer, as for `agent_command`, with a test (Task 1 step 7).
