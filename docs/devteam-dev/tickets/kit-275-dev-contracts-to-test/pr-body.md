`docs/devteam/` is what every project that adopts the kit gets. Two files in it are only for people developing the kit, so this moves them under `test/`, which adopters don't get. The owner asked for this in thread t-20261117-004321752-owner, items 2 and 3: move the files, don't delete them, and keep `browser.html`.

- `docs/devteam/dashboard/shell.md` moves to `test/contracts/shell.md` (the `dashboard-shell@1` contract).
- `docs/devteam/schema/browser.schema.json` moves to `test/contracts/browser.schema.json` (the `browser@1` contract).
- Both moves are `git mv` with no content change (R100), so `git log --follow` still reaches kit-83 and kit-61.
- Three readers now point at `test/contracts/`: `test/dashboard-shell.test.mjs`, `test/browser-view-page.test.mjs` and `test/fixtures/browser/check.mjs`.
- Every comment that named the old paths now names the new one. That covers the test files, `test/lib/measure.mjs`, the shell fixture, `index.html`, `hub.html` and `browser.html`. In `index.html` and `hub.html`, only comments change. In `browser.html` the comment sits inside its one inline `<script>`, so the CSP's `script-src` sha256 on line 5 is recomputed to match. Without that, Chrome would block the script.
- Four of those comments sit inside the frozen `dashboard-shell@1` blocks. They are rewritten with the same bytes in both pages, under the supervisor's ruling m-20261117-111118330: a comment-only change, so no contract bump and no kit-94 edge.

## Migration

For the release notes: projects that already adopted the kit can delete `docs/devteam/dashboard/shell.md` and `docs/devteam/schema/browser.schema.json`. Nothing reads them at runtime. They now live in the kit repo's `test/contracts/`.

## How to verify

- `git grep -n -e 'docs/devteam/dashboard/shell\.md' -e 'docs/devteam/schema/browser\.schema\.json' -- . ':!docs/devteam-dev/'` prints nothing.
- `git diff -M100% --name-status origin/main...HEAD` shows the two `R100` renames.
- `test/dashboard-shell.test.mjs`, `test/browser-contract.test.mjs` and `test/browser-view-page.test.mjs` pass on Node 22 with 0 skipped.
- Mutations: see `docs/devteam-dev/tickets/kit-275-dev-contracts-to-test/verification.md`.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
