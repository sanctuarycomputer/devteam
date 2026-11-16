# kit-87 final review brief

- **PR:** #297 (sanctuarycomputer/devteam), branch `ticket/kit-87-pages-and-sidebar`.
- **Code head:** 8e2b26a, with CI run 43842117047 green (17/17).
- **Branch head:** 910404a, which adds verification.md.
- **Records:** `docs/devteam-dev/tickets/kit-87-pages-and-sidebar/` (spec.md with its Rulings and Calls made, plan.md, reviews/, verification.md).
- **Ticket:** `node /data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs ticket show kit-87-pages-and-sidebar`.

## What to review

Review the whole branch against main:

```
git diff origin/main...8e2b26a -- docs/devteam/dashboard/index.html test/
```

The product code is all in `docs/devteam/dashboard/index.html`. The tests are `test/dashboard-pages.test.mjs` (new), plus edits to `test/dashboard.test.mjs`, `test/dashboard-shell.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-owner-action.test.mjs` and `test/lib/chain.mjs`.

## What to check

1. **Every done-when, 1–8,** against the code and tests.
2. **Done-when 5, the inventory walk.** Every item today's page has must still be there. List each item in today's dashboard (main's `index.html`) and in the mock's inventory, and say where it now lives or that it is gone. The mock is `/data/home/code/devteam-dev/docs/devteam/project/artifacts/dashboard-cleanup/index.html`; its inventory list is around lines 715–790, "Overview: fleet strip…", "Sidebar and Settings (kit-87)…". The done-when names these items:
   - the fleet strip's Drain all, Park all and Check (now the switch and Ready to move?);
   - the nav counts;
   - the updated time.
3. **The three fixes made after the task reviews,** which no task review saw (see verification.md):
   - **64557d8,** in `test/dashboard-owner-action.test.mjs`. It must be navigation only with every assertion unchanged (ruling m-20261115-201614084): diff that file against main.
   - **c4167c3,** `stampEntry()` on `popstate`, a router change.
   - **8e2b26a,** the reserved space under the fleet switch at 901px and wider.
4. **The contract.** The frozen `devteam-layout` and `devteam-shell-js` blocks must stay byte-identical to `hub.html`. No page name may equal one of the block's. The page's own rules must be fenced with `:where(.no-shell)`.
5. **Touches.** Every changed file must be in the ticket's touches; `git diff --stat origin/main...HEAD` shows them.
6. **Rulings.** Each ruling in spec.md's Rulings must be honoured. Two to look at in particular:
   - Interim `SHELL_ROUTES` entries name the ticket that ends them (kit-93, kit-100).
   - Setting threads are page subjects (m-20261115-202400898).

## Running tests on the box

- **Node:** always use `/usr/local/bin/node` (v22). The PATH node is v18 and skips every Chrome test. Check that the output says `# skipped 0`.
- **One file at a time,** at `--test-concurrency=2`, in the foreground: `timeout 900 /usr/local/bin/node --test --test-concurrency=2 test/<file>`. Never run the full suite; CI ran it.
- **Known on this box only:** `test/pane-question.answer.test.mjs` gets a 403 (the box check).

## Rules

- **Shell rules:** follow `/data/home/code/devteam-dev/.worktrees/kit-87-pages-and-sidebar/.superpowers/sdd/plan/rules.md`.
- **Read-only:** your review changes nothing on the checkout except your record.
