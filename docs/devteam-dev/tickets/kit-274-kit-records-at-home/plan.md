# kit-274-kit-records-at-home: plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

## TL;DR

- **What changes:** in `docs/devteam/scripts/devteam.mjs`, a new predicate `recordsLeftInRepo(t, at)` says a ticket of a `records: "home"` link still has its records in the link (home has no folder for it on main, local or origin `ticket/<id>`; the link has `<project>/tickets/<id>/` at `at`, else its branch, else its main). `recordsInHome(t, { at })` becomes "setting is home and not left in the repo", so every reader kit-208 routed (check-ticket, check-pr, merge, review-worktree, worker prompt and records worktree, park, timeline, reviews) treats such a ticket as `records: "repo"`. check-ticket, check-pr and merge print one warning for it.
- **Also:** `docs/devteam/process/worker.md` §1 says where a link ticket's records go (repo by default, home with `records: "home"`); `docs/superpowers/` is deleted once the supervisor's copy is on devteam-dev's main.
- **Order:** T1 the test for the gate path (A2–A6), red; then the predicate, the one-decision-per-command plumbing and the fetch-first in merge and check-pr, green. T2 the views (A7) and the one changed existing test (A8), test first. T3 worker.md (A1). T4 delete docs/superpowers (A9). T5 verification (A8, A10, CI).
- **Tests:** one new `test()` in `test/multirepo-home.test.mjs` for the whole rule (gate path, then views, then the real merge), plus one changed assertion setup in the existing setting test (A8); built on the file's `recordsFixture`, `homeRecords`, `tryCommit`, plus a small `leftInLink` helper that commits records in the console worktree as `test/multirepo-landing.test.mjs` does. Run with `env -u TMUX timeout 900 node --test --test-concurrency=2 test/multirepo-home.test.mjs`.
- **Risks:** a command deciding twice with different refs (a view says link, the gate says home) — each gate decides once and passes it to every records read (`inHome`); deciding before home's records are fetched — merge and check-pr fetch first; a dashboard keeping a stale answer — the memo is the log read's; git reads over many tickets — home main's tickets/ listed once, the rest only for `records: "home"` link tickets; a records branch at home's main counted as records — it has no folder, so it isn't.
- **Not done here:** the default flip, a sweep command, a history import, setting `links.devteam-kit.records`, copying anything into devteam-dev (the supervisor's chore, rulings Q1–Q5).

**Spec:** `docs/devteam-dev/tickets/kit-274-kit-records-at-home/spec.md`. Every task cites the acceptance checks it makes pass; refusal and warning words are the spec's.

## Global constraints

- Touch only `docs/devteam/scripts/devteam.mjs`, `docs/devteam/process/worker.md`, `docs/superpowers/**` (deletions only) and `test/multirepo-home.test.mjs`, plus this ticket's records folder. No new file anywhere outside `test/` (owner rule t-20261117-004321752-owner); the test goes in the existing file.
- The kit imports only Node's modules. No new dependency.
- **tmux safety (supervisor m-20261117-002834460):** no task, test or subagent ever runs `tmux kill-server`, or `kill-session` on anything it didn't create. The new tests launch no tmux (`prompt worker <id>` prints the prompt without a launch). Locally every run is under `env -u TMUX`. Never run the full suite on the box (CI is the gate); run only `test/multirepo-home.test.mjs` (and `test/multirepo-landing.test.mjs` once in T5) at `--test-concurrency=2`. Every subagent brief carries this paragraph.
- Multi-step shell goes in a script file under the worktree's ignored `docs/devteam/run/` or the ticket folder, never inline; never `rm -rf` an unguarded variable path; `timeout` on every command.

## T1. The predicate and the gate path (A2–A6)

Model: strong. Files: `test/multirepo-home.test.mjs`, `docs/devteam/scripts/devteam.mjs`.

- [ ] **Test first.** Add after the "merge checks the records at one pinned sha" test:
  - helper `leftInLink(F, id, { files, final = true })`: `ticket(id)`; a console worktree on `ticket/<id>` from `origin/trunk`; write `src/<id>.js` plus `files` under `docs/devteam/project/tickets/<id>/` (default spec, plan, verification as in `readyInHome`; `files: {}` writes none); commit; if `final`, `reviews/final-1.md` = `review('reviewer-b', <code sha>)` and commit; push; the approve-spec act only when `files` has `spec.md`, the approve-plan act only when it has `plan.md` (approve-plan dies with no plan: plan-1 P1); the `run/pr/ticket/<id>.md` file. Returns `{ w, code, head }`.
  - helper `warnings(text, id)`: the count of lines matching `/<id>: records read from console \(docs\/devteam\/project\/tickets\/<id>\/\), left from before links\.console\.records was "home"/`.
  - test "records in home: a ticket whose records were left in the link merges from there until home has some" on `recordsFixture('records-left')`:
    - P9 setup: before A2, `git branch ticket/console-01-a origin/main` in home's main checkout and push it to home's origin (a records branch with no folder, as `worker` makes): A2–A2b must still see the ticket as left in the link.
    - A2 (`console-01-a`): `check-ticket <id> --sha <head>` status 0, one warning in `err`; `check-pr --repo console --head-ref ticket/<id> --sha <head>` status 0, exactly one warning; `merge <id> --dry-run` matches `/ok: ticket\/<id> at \w{12} would merge in console/`, not `/records at/`, exactly one warning. (The real merge runs at the end of T2, after the views checks.)
    - A2b (same ticket): in the console worktree `git checkout -q --detach`, `git branch -D ticket/<id>`, `git update-ref -d refs/remotes/origin/ticket/<id>`; `check-ticket <id> --sha <head>` status 0 with the warning; and `review-worktree <id> <code>` (SUP) prints no line matching `/^records: /` (with the link refs gone the views form would fall back to the link's main, which has no folder, and route it home; the P9 home branch exists, so today's code and a views-form decision both print `records: …`: red; S8, plan-1 P3); remove it with `review-worktree --remove`; then `git checkout -q -B ticket/<id> <head>` and `git fetch -q origin` to restore.
    - A2c (`console-05-e`, left in the link): clone home's origin into `F.base/home-other` and set `user.email`/`user.name` there (plan-1 P7), add `docs/devteam/project/tickets/console-05-e/spec.md` on a new `ticket/console-05-e`, push it from there; in the main checkout delete any `refs/remotes/origin/ticket/console-05-e`; `merge console-05-e --dry-run` (SUP), then delete `refs/remotes/origin/ticket/console-05-e` in the main checkout again (merge fetched it; plan-1 P2), then `check-pr --repo console --head-ref ticket/console-05-e --sha <head>`; both match `/changes files outside touches: docs\/devteam\/project\/tickets\/console-05-e\//`.
    - A3 (`console-02-b`): `tryCommit` a `src/` change on the link worktree after the final review → check-ticket matches `/final-1\.md: its verdict is at \w{12}, which does not hold at/`.
    - A4 (`console-03-c`, files = spec only, `final: false`): check-ticket matches `plan.md missing at this head` and `verification.md missing`, with the warning.
    - A5 (`console-02-b`, reset): `homeRecords(F, id, { 'spec.md': … }, { push: false })` → check-ticket matches `/changes files outside touches: docs\/devteam\/project\/tickets\/console-02-b\//` and `plan.md missing at this head` (judged from home), and `err` has no warning. Then `homeRecords` adds plan and verification (commit R), then `reviews/final-1.md` with `- Records: <R>` and the link code sha (as `readyInHome` does) → still refused as outside touches, and nothing else fails but touches (the records verdict holds at R).
    - A6: on `console-02-b`, `tryCommit` (on the home records worktree) a non-review change to home's `verification.md` after the final review → `/its records verdict is at \w{12}, which does not hold at home's/`. And `console-04-d` with a link worktree holding only `src/` (no records anywhere) → `/no records for console-04-d in home/`.
  - Run: `env -u TMUX timeout 900 node --test --test-concurrency=2 --test-name-pattern 'left in the link' test/multirepo-home.test.mjs` → red (A2 says `no records for … in home`).
- [ ] **Code** in `devteam.mjs`, next to `recordsInHome`:
  - `recordsHomeSetting(t)`: today's body of `recordsInHome`.
  - `homeTicketFolders(ref)`: `memo(`homeTicketFolders:${ref}`, …)` → a `Set` of names from `git ls-tree --name-only <ref>:${projectRel}/tickets` (empty set when the ref or path is missing).
  - `recordsLeftInRepo(t, at)`: `memo(`leftInRepo:${t.id}:${at ?? ''}`, …)`; false unless `recordsHomeSetting(t)` and `repoReadable(name)`; false if home has the folder: `homeTicketFolders(mainRef())` has the id, or `refs/heads/ticket/<id>` / `refs/remotes/origin/ticket/<id>` resolves and has `${projectRel}/tickets/<id>` (`git cat-file -e`); else `R = repo(name)`, `ref = at ?? R.ticketBranchRef(t.id) ?? R.mainRef()`, true iff the link has the folder at `ref`: when `ref` is `R.mainRef()`, from `linkTicketFolders(R)` (`memo(`linkTicketFolders:${R.name}`, …)`, one `ls-tree --name-only` of the link main's `${R.projectRel}/tickets` per log read; spec-2 S2-1), else `R.git(['cat-file', '-e', `${ref}:${R.projectRel}/tickets/${t.id}`]) !== null`. `src.inHome ?? …` (not `||`), so `false` counts as decided.
  - `recordsInHome(t, { at } = {})` = `recordsHomeSetting(t) && !recordsLeftInRepo(t, at)`; `recordsInHomeId(id, opts)` passes opts; comment updated (reads refs, never a working tree).
  - `warnLeftInRepo(t, R)`: once per process per id (a module `Set`), the spec's warning text.
  - `checkTicket(id, { …, inHome })`: after `sha` is resolved, `H = inHome ?? (R.commonDir && sha ? recordsInHome(t, { at: sha }) : recordsInHome(t))`; when `recordsHomeSetting(t) && !H`, `warnLeftInRepo`. Pass `H` into the review read: `ticketReviews(id, { ...src, inHome: H })` (both `src` shapes; for `WORKTREE` keep `WORKTREE` when `!R.commonDir`).
  - `ticketReviews` memo key adds `src.inHome`; `ticketReviewsRead` uses `src.inHome ?? recordsInHomeId(id)` for its first branch.
  - `checkPr({ …, inHome })` passes `inHome` to `checkTicket`.
  - `cmdMerge`: before `inHome`, for a ticket of a records-home link fetch home's `+refs/heads/ticket/<id>:refs/remotes/origin/ticket/<id>` (quietly, ignoring failure); `inHome = … recordsInHomeId(id, { at: sha })`; pass `inHome` to `checkPr`.
  - `cmdCheckPr`: for `--repo <link>` with a ticket of a records-home link (`recordsHomeSetting`), fetch home's `ticket/<tid>` first (ignoring failure), then decide `inHome = recordsInHomeId(tid, { at: sha })`; only when `inHome` set `records` to the fetched ref (or null with the "not on origin; push it" failure, as today); when not, pass no `records` and `inHome: false` (plan-1 P8). Pass `inHome` to `checkPr`.
- [ ] Run the same command → green. Then the whole file once: `env -u TMUX timeout 1200 node --test --test-concurrency=2 test/multirepo-home.test.mjs` → all pass except the approve-plan case T2 changes (expected red until T2).
- [ ] Commit; review record `reviews/task-1.md` by a fresh subagent.

## T2. The views (A7, the A8 test change)

Model: strong. Files: `test/multirepo-home.test.mjs`, `docs/devteam/scripts/devteam.mjs`.

- [ ] **Test first**, in the T1 test before A2's merge, for `console-01-a` (left in the link):
  - `review-worktree <id> <code>` output has no line matching `/^records: /`; remove it with `review-worktree --remove`.
  - `prompt worker <id>` (SUP) matches `/keep this ticket's records under docs\/devteam\/project\/tickets\/console-01-a\/ in this repo\./` and not `/Keep its records/`.
  - approve-plan: `console-06-f` left in the link with a plan only in the link (no final): `act --class approve-plan --refs console-06-f` succeeds; then `homeRecords(F, 'console-06-f', { 'spec.md': … }, { push: false })` and a second approve-plan is refused with `/no plan\.md for console-06-f on ticket\/console-06-f/`.
  - then `merge console-01-a` (SUP) lands: console `origin/trunk` has `src/console-01-a.js` (the code, plan-1 P10) and `docs/devteam/project/tickets/console-01-a/spec.md`, home's `origin/main` has no `docs/devteam/project/tickets/console-01-a`; `timeline console-01-a --json` lists `spec` with `repo: 'console'`.
- [ ] **The A8 change:** in the existing setting test ("the setting (repo by default, home or refused)"), before the "a plan in the link doesn't count" assertion, add `homeRecords(F, 'console-01-a', { 'spec.md': '# spec\n' }, { push: false })` so the ticket is home-wins; the assertion and the rest of the test stay. (The later `homeRecords(…, { 'plan.md' … })` call reuses the worktree.)
- [ ] **Code:** `review-worktree <id> <sha>` decides with `recordsInHomeId(id, { at: sha })`. Every other view already goes through `recordsInHomeId`; fix any the test shows still routing home.
- [ ] Run the T1 command, then the whole file → all green.
- [ ] Commit; `reviews/task-2.md`.

## T3. worker.md (A1)

Model: fast. File: `docs/devteam/process/worker.md`.

- [ ] Replace in §1 "A ticket in another repo" the clause "your records (spec, plan, verification, reviews, handoff) go under that repo's `docs/devteam/project/tickets/<id>/` and land with your code;" with: "your records (spec, plan, verification, reviews, handoff) go under that repo's project folder (`<project>/tickets/<id>/`) and land with your code, unless the link sets `records: "home"`: then they go under home's `docs/devteam/project/tickets/<id>/`, in the checkout of home's `ticket/<id>` your prompt names, and nothing of the project lands in that repo;". Keep the rest of the paragraph.
- [ ] `grep -n 'records: "home"' docs/devteam/process/worker.md` shows it in §1.
- [ ] Commit; `reviews/task-3.md`.

## T4. Delete docs/superpowers (A9)

Model: fast. Files: `docs/superpowers/**`.

- [ ] Merge the kit's `origin/main` first. Wait until every file of `git ls-tree -r --name-only HEAD -- docs/superpowers` (35 at 0f73025; the spec's 33 was a miscount, plan-1 P4) is on devteam-dev's `origin/main` at the same path, byte-identical to the kit's (a script comparing `git show origin/main:<f>` in devteam-dev with `git show HEAD:<f>` here). If not there, message the supervisor (`--kind blocked`) and do T5's other rows meanwhile.
- [ ] `git rm -r -q docs/superpowers`; in `devteam.mjs` (~line 8301) reword the comment that cites `docs/superpowers/specs/2026-11-09-public-artifacts-design.md` to drop the path (plan-1 P11); commit. `git ls-tree -r --name-only HEAD -- docs/superpowers` is empty.
- [ ] `reviews/task-4.md` (a fresh subagent confirms the 33 files are on devteam-dev's main byte for byte).

## T5. Verification

Model: fast.

- [ ] Merge `origin/main`; re-check A9 (`git ls-tree -r --name-only HEAD -- docs/superpowers` empty; a file main added since T4 is copied to devteam-dev by the supervisor first, then removed here, plan-1 P4); re-run `test/multirepo-home.test.mjs` and `test/multirepo-landing.test.mjs` (A8), each alone, at `--test-concurrency=2`, under `env -u TMUX`.
- [ ] A10: `git diff --name-status --diff-filter=A origin/main...HEAD` lists only `test/` and this ticket's records folder.
- [ ] Push; once GitHub CI (test.yml) has run on the head, record it with `node /data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs gate ci -- sh /data/home/code/devteam-dev/scripts/devteam-ci-green.sh <full head sha>` (never `-- true`, never piped) and confirm every job of that run succeeded.
- [ ] `verification.md`: a row per done-when (4) with the command and result at a named commit.

## Rulings after approval

- m-20261117-044852436-supervisor: the 35 docs/superpowers files are on devteam-dev's main at 956dd43 under `docs/devteam/project/designs/superpowers/` (plans/ and specs/), copied verbatim from kit main ace3fb14; this replaces Q5's path. T4 checks against that path.
