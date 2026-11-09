# Box operator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A session in window 0 of `home` that starts at boot, brings supervisors back, and looks after the box.

**Architecture:** Two shell scripts do the mechanical work and are tested by their `--dry-run` decisions; a prompt file gives the operator its job; boot starts it.

**Tech Stack:** POSIX sh, jq, tmux, node (tests, the kit), Claude Code.

## Global Constraints
- The kit runs without the operator; its one change is the `DEVTEAM_ROLE=operator` read-only guard.
- Scripts run as `dev`. Installed root-owned, read-only, under `/usr/local/bin` and `/opt/devteam`.
- Never unpark a fleet, answer a question, merge, tag or release.
- Node 18 for tests (CI runs 18–24). No npm dependencies.

---

### Task 1: box-supervisors

**Files:** Create `cloud/box-supervisors`; Test `test/box-supervisors.test.mjs`
**Interfaces:** Produces the command `box-supervisors [--all] [--dry-run]`, printing `<repo>: <action> (<why>)`. Reads `$HOME/code`, `$HOME/.devteam-supervisors.boot`.

- [ ] **Step 1: Write the failing test.** Builds a fake `$HOME/code` with `bareProject` (as `test/gateway.test.mjs`) for `home`, `sibling` (origin = a `repo` link in home's settings), `mutual-a`/`mutual-b` (linking each other), `lone` (no boot-list entry), `parked` (`fleet park`), and a folder with the kit but no settings; asserts each `--dry-run` line for default and `--all`.
- [ ] **Step 2: Run:** `node --test test/box-supervisors.test.mjs`. Expected: FAIL, script missing.
- [ ] **Step 3: Write the script** (spec section `box-supervisors`), moving the resume block out of `cloud/Dockerfile` unchanged in its checks.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 2: box-status, the prompt and the deny list

**Files:** Create `cloud/box-status`, `cloud/operator.md`, `cloud/operator-settings.json`
**Interfaces:** `box-status` prints one line per repo: `<repo> sup=<up|down> fleet=<mode> kit=<v> inbox=<n> missing=<files|-> tools=<ok|names>`.

- [ ] **Step 1:** Add a `box-status` case to the test: one repo, asserts its line.
- [ ] **Step 2:** Write the three files. Deny list: `Bash(gh pr merge:*)`, `Bash(gh pr review:*)`, `Bash(gh release:*)`, `Bash(gh api:*)`, `Bash(gh secret:*)`, `Bash(git tag:*)`, `Bash(git push origin main:*)`, `Bash(git push origin HEAD:main:*)`.
- [ ] **Step 3:** Run the test; expected PASS. Commit.

### Task 3: boot starts the operator

**Files:** Modify `cloud/Dockerfile` (`devteam-dev`, COPY lines, first-run notes), `README.md`.

- [ ] **Step 1:** Remove the resume loop from `devteam-dev`; save `.devteam-supervisors` to `.boot` when non-empty, before anything can rewrite it.
- [ ] **Step 2:** Create `home` as window 0 `operator` (`~/operator`), window 1 `shell`; start Claude there; add the 30-minute tick loop.
- [ ] **Step 3:** Verify in Docker under Render's capability set, with a stand-in `claude`: first boot is fresh; after a restart it continues; `box-supervisors` resumes a recorded supervisor; a parked fleet stays stopped; a tick is typed; the deny settings path is passed.
- [ ] **Step 4:** Commit; open the PR against `main` naming #150 as its dependency.
