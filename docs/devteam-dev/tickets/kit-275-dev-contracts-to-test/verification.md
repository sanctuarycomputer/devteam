# kit-275 verification

The code is final at `989b2160`. Every check below ran at `c0e53a84`, which adds only records after it.

- **CI `test.yml`:** run 44078649675 at `c0e53a84`, conclusion **success**, 17 of 17 jobs green. It was gated through `devteam.mjs gate ci -- gh run watch 44078649675 --exit-status` (exit 0, not piped).
- **CI `box-image.yml`:** run 44078649618 at `c0e53a84`, success.
- **Local test runs:** one file at a time, `env -u TMUX HOME=$(mktemp -d) timeout 600 /usr/local/bin/node --test --test-concurrency=2 <file>` on Node 22, so the Chrome tests run rather than skip.

| # | Done-when | Command | Result |
|---|---|---|---|
| 1 | The files are under `test/` (git mv, history kept), not in `docs/devteam/` | `test ! -e docs/devteam/dashboard/shell.md && test ! -e docs/devteam/schema/browser.schema.json && test -f test/contracts/shell.md && test -f test/contracts/browser.schema.json && echo ok` | `ok` |
| 1 | | `git diff -M100% --name-status origin/main...HEAD \| grep ^R` | `R100 docs/devteam/schema/browser.schema.json test/contracts/browser.schema.json`; `R100 docs/devteam/dashboard/shell.md test/contracts/shell.md` |
| 1 | | `git log --follow --oneline test/contracts/shell.md \| tail -1`, then the same on `browser.schema.json` | `c12f3520 kit-83: dashboard-shell@1 contract and its blocks`; `22a785a3 kit-61: browser@1 contract (schema, checker, fixtures, contract test)` |
| 2 | Every reference names the new path; a grep for the old paths finds nothing | `git grep -n -e 'docs/devteam/dashboard/shell\.md' -e 'docs/devteam/schema/browser\.schema\.json' -- . ':!docs/devteam-dev/'` | nothing printed (exit 1) |
| 2 | | `git grep -n 'shell\.md' -- docs/devteam test ':!test/contracts'` | Every hit is a `test/contracts/shell.md` form, except the 5 bare hits in `test/dashboard-shell.test.mjs`: the reader at :21 and the assertion labels at :92, :95, :98 and :99, as the plan expects. That is 2 hits in `hub.html`, 7 in `index.html`, and 1 each in the measure tests, `measure.mjs` and the fixture. |
| 3 | The tests that read the moved files fail when the files are missing… | T1 step 2, right after the `git mv`, before the readers were repointed | `dashboard-shell`: `ENOENT … docs/devteam/dashboard/shell.md`; `browser-contract` and `browser-view-page`: `ENOENT … docs/devteam/schema/browser.schema.json` |
| 3 | …pass at their new paths… | the three files, at `989b2160` and later | `dashboard-shell` 16/16, `browser-contract` 9/9, `browser-view-page` 32/32; 0 failed, 0 skipped (`task-1.md`, `task-1-2.md`) |
| 3 | …and still fail when the contract breaks (mutations) | `mutate.sh` (T2): each mutation applied, the named file run, then restored with `git checkout`; `git status --porcelain` was empty afterwards | see the mutation table below: all 5 red |
| 4 | No new file or folder in the kit outside `test/` | `git diff --diff-filter=A --name-only origin/main...HEAD -- . ':!test/' ':!docs/devteam-dev/tickets/kit-275-dev-contracts-to-test/'` | nothing printed |

## Mutations (done-when 3)

| M | Mutation | Test run | Result |
|---|---|---|---|
| M1 | `hub.html`, inside `devteam-shell-js`: `pages share.` → `pages  share.` | `test/dashboard-shell.test.mjs` | 15 pass, **1 fail**: `not ok 2 - both blocks are byte-identical in index.html and hub.html` ("the JS block") |
| M2 | `test/contracts/shell.md`: `bindFleetSwitch` → `bindFleetX` | `test/dashboard-shell.test.mjs` | 15 pass, **1 fail**: `not ok 1 - shell.md says @1 and defines what the design lists` (`'shell.md defines bindFleetSwitch'`). The test reads the moved file. |
| M3 | `test/fixtures/browser/state.json`: delete the line `"browser": 1,` | `test/browser-contract.test.mjs` | 6 pass, **3 fail**: `every fixture validates against its shape` (state.json), `the refusal names the guard's rules…`, `every bound in the contract refuses…` |
| M4 | `test/contracts/browser.schema.json`: add `view_url` to `$defs.shapes.state.required` | `test/browser-contract.test.mjs` | 5 pass, **4 fail**: `every fixture validates against its shape` (state.json), and 3 more. `check.mjs` reads the moved schema. |
| M5 | `test/contracts/browser.schema.json`: `x-masked-url` + `x` | `test/browser-view-page.test.mjs` | 31 pass, **1 fail**: `not ok 3 - the address bar shows only a masked url: the page holds the contract's mask` ("the page's mask is x-masked-url, exactly"). The test reads the moved schema. |

The CSP hash is guarded too. `task-1-2.md` put the old `script-src` hash back in a temp copy, and the CSP test failed.

## Notes

- **The CSP hash:** `task-1` found that the comment at `browser.html:85` sits inside its CSP-hashed `<script>`. Commit `989b2160` recomputes line 5's `script-src` hash. That is the only non-comment change, and the supervisor was told in m-20261117-115527166.
- **CI at `149891dc`:** run 44072991846 failed because of that hash, plus one `machine.box` `rest` test, "the minute loop brings back a lost tmux server", which this ticket doesn't touch and which passed at `c0e53a84`.
- **Deferred to beta:** nothing.
