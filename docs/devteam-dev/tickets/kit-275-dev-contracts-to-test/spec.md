# kit-275: Developer-only contracts leave the shipped kit

**Ticket:** kit-275-dev-contracts-to-test (chore, S, risk normal). **Why:** the owner's thread t-20261117-004321752-owner, items 2 and 3. `docs/devteam/` is what every project that adopts the kit gets. `dashboard/shell.md` (the `dashboard-shell@1` contract) and `schema/browser.schema.json` (the `browser@1` contract) are only for people developing the kit itself. They should move under `test/`, which adopters don't get. Move them, don't delete them. `browser.html` stays where it is.

## Approach

There is one sensible way, so this spec doesn't compare others. Deleting the files is ruled out by the owner. A new top-level folder is ruled out by done-when 4.

1. `git mv docs/devteam/dashboard/shell.md test/contracts/shell.md` and `git mv docs/devteam/schema/browser.schema.json test/contracts/browser.schema.json`. Each is a pure rename with 100% similarity, so `git log --follow` keeps the history. Neither file's content changes. Paths named inside `shell.md` are already repo-relative (`test/...`), so they stay right. The schema's `$id` (`devteam/browser.schema.json`) is an identifier, not a path to a file, so it stays.
2. The files that read them:
   - `test/dashboard-shell.test.mjs` reads `shell.md` from `test/contracts/`, not from `DASH`.
   - `test/browser-view-page.test.mjs:182` reads `./contracts/browser.schema.json`.
   - `test/fixtures/browser/check.mjs:6` reads `../../contracts/browser.schema.json`.
3. Comments that name the old paths change to the new path:
   - the header comments of `test/dashboard-shell.test.mjs`, `test/dashboard-measure.test.mjs`, `test/hub-measure.test.mjs` and `test/lib/measure.mjs`
   - the comment in `test/fixtures/dashboard-shell.html`
   - `docs/devteam/dashboard/index.html`: lines 47 and 1168, plus the short `shell.md §n` mentions at 1441, 3869, 3913, 5169 and 6262, which become `test/contracts/shell.md §n` so a reader can find the file
   - `docs/devteam/dashboard/hub.html`: lines 31 and 402
   - `docs/devteam/dashboard/browser.html:85`

**Comments inside the shared blocks.** `index.html:47` / `hub.html:31` (in `devteam-layout`) and `index.html:1168` / `hub.html:402` (in `devteam-shell-js`) are inside the two blocks that `shell.md` freezes until kit-95. The edit changes only the path in a comment, and both pages get the same bytes, so the blocks stay byte-identical. `test/dashboard-shell.test.mjs` already checks that they are identical. No rule, token, builder or binder changes, so I am **not bumping `dashboard-shell@1`**. The ticket notes say "only comments change in index.html/hub.html/browser.html", and this spec reads that as the ruling for these block comments. If the supervisor wants the block comments left as they are, I'll leave them alone. That would also need done-when 2's grep to exempt them.

## Acceptance checks (each done-when, and how each fails)

| # | Done-when | Check | Fails when |
|---|---|---|---|
| 1 | shell.md and browser.schema.json are under test/ (git mv, history kept) and no longer in docs/devteam/ | (a) `test ! -e docs/devteam/dashboard/shell.md && test ! -e docs/devteam/schema/browser.schema.json && test -f test/contracts/shell.md && test -f test/contracts/browser.schema.json`; (b) `git diff --find-renames -M100% --name-status origin/main...HEAD` shows two `R100` lines; (c) `git log --follow --oneline test/contracts/shell.md` lists kit-83's commits, and the same command on the schema lists kit-61's | a copy is left behind or the file is missing (a); the content changed or the rename was a delete plus an add (b, no `R100`); the history is lost (c lists only this ticket's commit) |
| 2 | every reference names the new path, and a grep for the old paths finds nothing | `git grep -n -e 'docs/devteam/dashboard/shell\.md' -e 'docs/devteam/schema/browser\.schema\.json' -- . ':!docs/devteam-dev/'` prints nothing; `git grep -n 'shell\.md' -- docs/devteam test ':!test/contracts'` shows only the `test/contracts/shell.md` form (plus the test's own `SHELL_MD` messages) | any reference I missed still prints. **Scope:** `docs/devteam-dev/` holds merged ticket records (kit-61, kit-83, kit-87, …), and their approved reviews must not be edited (`quality.md` §3). They are history, not references, so the grep leaves them out. |
| 3 | the tests that read them pass at their new paths, and still fail when the shell blocks or the browser JSON break the contract (a mutation shown in the PR) | Pass: `test/dashboard-shell.test.mjs`, `test/browser-view-page.test.mjs` and `test/browser-contract.test.mjs` run one at a time with `/usr/local/bin/node --test --test-concurrency=2`, a throwaway HOME, and 0 skips; then CI `test.yml`, every job green at the head. Mutations, each run and then reverted, with the red output recorded in verification.md and the PR: **M1** change one byte inside `devteam-shell-js` in hub.html only → the byte-identical test fails; **M2** delete `` `bindFleetSwitch` `` from `test/contracts/shell.md` → "shell.md says @1 and defines what the design lists" fails, which shows the test reads the moved file; **M3** delete the required `"browser"` key from `test/fixtures/browser/state.json` → browser-contract fails; **M4** add `"view_url"` to the `state` shape's `required` in `test/contracts/browser.schema.json` → browser-contract fails on `state.json`, which shows `check.mjs` reads the moved schema; **M5** change one character of `x-masked-url` in `test/contracts/browser.schema.json` → browser-view-page's "the page's mask is x-masked-url, exactly" fails, which shows it reads the moved schema (Chrome; Node 22) | M1/M3: the contract checks no longer bite. M2/M4/M5: a test still reads an old or missing copy. With the old file deleted, a stale path throws ENOENT, so the pass check itself also fails if a reference was missed. |
| 4 | no new file or folder in the kit outside test/ (owner rule t-20261117-004321752-owner) | `git diff --diff-filter=A --name-only origin/main...HEAD -- . ':!test/' ':!docs/devteam-dev/tickets/kit-275-dev-contracts-to-test/'` prints nothing, and the renames' targets are all under `test/contracts/` | any file or folder is added outside `test/`. This ticket's records go under `docs/devteam-dev/tickets/<id>/`, where every kit ticket's records live (my prompt says so), so they are exempt. |

The other suites stay green because CI runs them. `dashboard-measure` and `hub-measure` change only in comments, and CI covers them.

## Contracts

- `dashboard-shell@1`: its file moves and its content does not change. The version stays at @1, and so do the blocks' code.
- `browser@1`: its file moves and its content does not change.
- This ticket provides no contract and consumes none.

## Edge cases

- **Adopters and the materialized kit.** `devteam.mjs` reads only `schema/log.schema.json` (line 1352), and I found no code that lists `dashboard/` or `schema/` file by file. Nothing at runtime loads either moved file. The dashboard pages only mention them in comments.
- **kit-95 copy sweep** (planned) will edit both blocks later. Changing a path in a comment gives it nothing new to reconcile.
- **Open tickets that touch the same comment lines** would get a merge conflict that is trivial to resolve. That's for the supervisor's ordering, not this spec.

## Out of scope

- Editing merged records in `docs/devteam-dev/tickets/**`.
- Any change to what the contracts say.
- Moving `browser.html`.
- The devteam-dev home's own materialized copy of the kit, which updates on the next release.
