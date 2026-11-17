# kit-275 Implementation Plan

## TL;DR

- Move `docs/devteam/dashboard/shell.md` and `docs/devteam/schema/browser.schema.json` to `test/contracts/` with `git mv`. Neither file's content changes, so git records each as a 100% rename and `log --follow` keeps its history.
- Point the three readers at the new paths: `test/dashboard-shell.test.mjs` (`SHELL_MD`), `test/browser-view-page.test.mjs:182`, and `test/fixtures/browser/check.mjs:6`.
- Rewrite every comment that names the old path to name `test/contracts/...`: in the test files, `test/lib/measure.mjs`, the shell fixture, `index.html`, `hub.html` and `browser.html`. The comments inside the two shared blocks get identical bytes in `index.html` and `hub.html`, so the blocks stay byte-identical and `dashboard-shell@1` keeps its version.
- Test first: right after the move, the three reading test files fail with ENOENT. Updating the readers turns them green. A `git grep` for the old paths then has to print nothing.
- Then the mutations M1 to M5 from the spec, each run and reverted, with the red output recorded in `verification.md`. CI `test.yml`, green at the head, is the gate for the full suite.
- Risks: a reference missed in a comment, caught by the grep; and the two block copies drifting, caught by the byte-identical test.

> For agentic workers: use superpowers:subagent-driven-development (or executing-plans). Steps are checkboxes.

**Goal:** the two developer-only contracts live under `test/contracts/`, every reference names them there, and the kit's shipped `docs/devteam/` no longer has them.
**Spec:** `docs/devteam-dev/tickets/kit-275-dev-contracts-to-test/spec.md`. The contracts move with their content unchanged: `dashboard-shell@1` and `browser@1`.

## Global Constraints

- Change only files in the ticket's `touches`, plus this ticket's folder.
- Add no file or folder outside `test/`. The new folder is `test/contracts/`.
- Leave the merged records in `docs/devteam-dev/tickets/**` alone, apart from this ticket's own folder.
- Running tests on the box:
  - Run one file at a time: `/usr/local/bin/node --test --test-concurrency=2 <file>` (Node 22, so the Chrome tests run rather than skip), under `env -u TMUX HOME="$(mktemp -d)"` and `timeout 600`. A pass means 0 skipped.
  - Never run the full suite. Never run `tmux kill-server`.
  - Run any multi-step shell from a script file.

## Review Focus

1. **A comment-only reference missed** (for example `shell.md §6` in `index.html`). The grep in T1 step 5 covers it.
2. **The two blocks no longer byte-identical** after the comment edit. `dashboard-shell.test.mjs` covers it.
3. **A relative URL that is off by one level** in `check.mjs` (`../../contracts/`). The browser-contract tests throw ENOENT if it is wrong.
4. **The renames recorded as a delete plus an add** (content edited by mistake). The `R100` check in T1 step 6 covers it.

---

### Task 1: Move the contracts and repoint every reference

**Model:** fast. Mechanical rename and path edits to given lines.

**Files:**
- Rename: `docs/devteam/dashboard/shell.md` → `test/contracts/shell.md`
- Rename: `docs/devteam/schema/browser.schema.json` → `test/contracts/browser.schema.json`
- Modify the readers:
  - `test/dashboard-shell.test.mjs`: line 1 comment, and line 21 `SHELL_MD`, which reads `path.join(here, 'contracts', 'shell.md')`
  - `test/browser-view-page.test.mjs:182`: `new URL('./contracts/browser.schema.json', import.meta.url)`
  - `test/fixtures/browser/check.mjs:6`: `new URL('../../contracts/browser.schema.json', import.meta.url)`
- Modify comments only:
  - `test/dashboard-measure.test.mjs:1`, `test/hub-measure.test.mjs:1`, `test/lib/measure.mjs:1`, `test/fixtures/dashboard-shell.html:2`
  - `docs/devteam/dashboard/index.html`: 47, 1168, 1441, 3869, 3913, 5169 and 6262
  - `docs/devteam/dashboard/hub.html`: 31 and 402
  - `docs/devteam/dashboard/browser.html:85`
- Each comment that names `docs/devteam/dashboard/shell.md` or `docs/devteam/schema/browser.schema.json` becomes `test/contracts/shell.md` or `test/contracts/browser.schema.json`. A bare `shell.md §n` becomes `test/contracts/shell.md §n`. Re-wrap no line and change no other text.

**Interfaces:** produces the paths `test/contracts/shell.md` and `test/contracts/browser.schema.json`, which T2's mutations edit.

- [ ] **Step 1: Make the move (red).** `mkdir -p test/contracts`, then run the two `git mv` commands.
- [ ] **Step 2: Watch the readers fail.** Run `test/dashboard-shell.test.mjs`, then `test/browser-contract.test.mjs`, as in Global Constraints. Expected: both FAIL with `ENOENT … docs/devteam/...`. Record the two lines for verification.md.
- [ ] **Step 3: Repoint the three readers,** as listed under Files.
- [ ] **Step 4: Green.** Run `test/dashboard-shell.test.mjs`, `test/browser-contract.test.mjs` and `test/browser-view-page.test.mjs`, one at a time. Expected: each passes with 0 failed and 0 skipped.
- [ ] **Step 5: Rewrite the comments,** then check both greps:
  - `git grep -n -e 'docs/devteam/dashboard/shell\.md' -e 'docs/devteam/schema/browser\.schema\.json' -- . ':!docs/devteam-dev/'` must print nothing.
  - `git grep -n 'shell\.md' -- docs/devteam test ':!test/contracts'` must show only `test/contracts/shell.md` forms, plus the bare hits in `test/dashboard-shell.test.mjs` (the `'contracts', 'shell.md'` reader line and its `shell.md …` assertion labels).
  - Then re-run `test/dashboard-shell.test.mjs`. It must pass, which shows the blocks are still byte-identical.
- [ ] **Step 6: Check the renames and the folder rule** (done-whens 1 and 4), after committing:
  - `git diff -M100% --name-status origin/main...HEAD` shows `R100 docs/devteam/dashboard/shell.md test/contracts/shell.md` and `R100 docs/devteam/schema/browser.schema.json test/contracts/browser.schema.json`.
  - `git log --follow --oneline test/contracts/shell.md | tail -3` reaches kit-83's commits.
  - `git diff --diff-filter=A --name-only origin/main...HEAD -- . ':!test/' ':!docs/devteam-dev/tickets/kit-275-dev-contracts-to-test/'` prints nothing.
- [ ] **Step 7: Commit:** `kit-275 T1: move shell.md and browser.schema.json to test/contracts/, repoint every reference`. Then write the task review record `reviews/task-1.md` from a fresh reviewer.

### Task 2: Show the tests still bite (mutations) and verify

**Model:** fast. Each mutation is given exactly, and the expected failures are named.

**Files:** this changes no committed file in the repo. Each mutation is reverted (`git checkout -- <file>`) before the next. The results go in `docs/devteam-dev/tickets/kit-275-dev-contracts-to-test/verification.md`.

- [ ] **Step 1: Write the mutation script.** Write `mutate.sh` in a private `mktemp -d` dir. For each Mi it applies the edit with `node -e` or `sed`, runs the named file as in Global Constraints, captures the result, and restores the file with `git checkout --`. It ends by checking that `git status --porcelain` is empty.
  - **M1:** in `hub.html`, inside `devteam-shell-js`, change `pages share.` to `pages  share.` (one extra space). Run `test/dashboard-shell.test.mjs`. Expected FAIL: the blocks are no longer byte-identical.
  - **M2:** in `test/contracts/shell.md`, replace `bindFleetSwitch` with `bindFleetX` (one occurrence, line 97). Run `test/dashboard-shell.test.mjs`. Expected FAIL: `shell.md defines bindFleetSwitch`.
  - **M3:** delete `"browser"` from `test/fixtures/browser/state.json`. Run `test/browser-contract.test.mjs`. Expected FAIL on `state.json`.
  - **M4:** add `"view_url"` to the `required` of the `state` shape in `test/contracts/browser.schema.json`. Run `test/browser-contract.test.mjs`. Expected FAIL on `state.json`.
  - **M5:** change one character of `x-masked-url` in `test/contracts/browser.schema.json`. Run `test/browser-view-page.test.mjs`. Expected FAIL: "the page's mask is x-masked-url, exactly".
- [ ] **Step 2: Run it.** Expected: all five FAIL as named, and the tree is clean afterwards.
- [ ] **Step 3: Write verification.md.** One row per done-when, each with its command and result at the named commit, including T1 step 2's red, step 4's green and the mutation table. Then push, run CI `test.yml` through `devteam.mjs gate ci -- gh run watch <run> --exit-status` (unpiped), and confirm with `gh run view <run> --json conclusion`.
- [ ] **Step 4: Commit:** `kit-275 T2: verification (mutations M1-M5, CI <run>)`.
