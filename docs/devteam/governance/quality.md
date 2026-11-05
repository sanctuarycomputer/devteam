# Quality

What must be true before code merges: the definition of done, the gates, the review standard, how a merge happens, how releases are cut, and the shape of the documents the work leaves behind. `code-style.md` says what good code is; this file says how it is checked.

## 1. Definition of done

A ticket may merge only when all of these hold at the PR's exact head. `devteam.mjs check-ticket <id>` checks the ones a machine can; `merge` runs it, then the gates, then merges.

1. Every done-when in the ticket is met and shown by a command or a test in `verification.md`, not by a claim.
2. `project/tickets/<id>/spec.md` and `plan.md` exist at the head, and the supervisor has logged `approve-spec` and `approve-plan` acts for the ticket.
3. `project/tickets/<id>/verification.md` has a table row per done-when: the done-when, the command, the result.
4. A final review record says `Verdict: APPROVE <full sha>` at a commit that holds at the head (§3), by a named reviewer who is not the author, and no Critical or Important finding is undispositioned. `risk: high`: two, from two sessions.
5. Every gate in the settings passes at the head (`merge` runs them in a clean worktree).
6. The PR title is `<ticket-id>: <one line a user could read>`; the branch is `ticket/<ticket-id>`.
7. Every ruling and owner answer the worker received is in the spec's or plan's Rulings section.
8. No new bare lint suppression; every suppression is `doctrine-exception(<rule-id>): <reason>` (`code-style.md` §16).
9. Every changed file is inside the ticket's `touches`, and, once components draw lines, inside its component's line or a `touches_components` member's; or in its own `project/tickets/<id>/` folder, in the ticket's repo (another repo's project folder holds only `tickets/`).
10. The PR body's `## One-way doors` section is `None.` or links the owner's answer (a `q-…` id); it can't say `None.` when the ticket lists one.

Points 2, 3, 4, 6, 9 and 10 are mechanical. Points 1, 7 and 8 are the final reviewer's. Point 5 is the gates.

## 2. Gates

A rule is real only when a gate runs it. The project's gates live in `project/settings.md` as `gates: { "<name>": "<command>" }` (or `{ "cmd": …, "junit": "<report path>", "paths": ["<glob>", …] }`; a gate with `paths` runs only on PRs that change a matching file, for a monorepo's per-app gates). `merge` runs gates in a fresh worktree of the PR head with `DEVTEAM_MAIN` (the main checkout) and `DEVTEAM_CACHE` (a gitignored cache folder) set, so a compiled stack doesn't rebuild from scratch: `CARGO_TARGET_DIR=$DEVTEAM_CACHE/target cargo test`, `cmake -B $DEVTEAM_CACHE/build`, `mvn -Dmaven.repo.local=$DEVTEAM_CACHE/m2`, `bundle config set --local path $DEVTEAM_CACHE/bundle`. `devteam.mjs gate --all` runs every gate in the current checkout (in a repo link's checkout, that repo's gates, and its gate lines name the repo); at adoption, run it on `main` to see which gates already fail. `merge` runs every one at the PR head before merging; workers run them locally through `devteam.mjs gate <name> -- <command>`, which records time, result and (with `--junit`) each test, so slow and flaky tests show up in the metrics.

Every project, day one:

| Gate | Fails on | Law |
|---|---|---|
| format | unformatted code (autofix first) | `L-ERG-2` |
| lint | any lint error | `L-ERG-1` |
| typecheck | any type error (typed stacks) | `L-LOGIC-3`, `-5` |
| test | any failing test, random order on | `L-TEST-1`, `-4` |
| coverage | branch coverage under the floor in the settings, on `domain/**` | `L-TEST-3` |
| dead-code | unused exports, files or dependencies | |
| duplication | copy-paste over the threshold in the settings | |
| secrets | any secret detected | `L-SEC-8` |
| lockfile | install not frozen, or a dependency younger than the cooldown | `L-SEC-6`, `-8` |
| escape-hatch | a bare suppression comment | `L-ESC-1` |
| devteam | `devteam.mjs validate` fails | |

**Component lines (invariant C).** Once `settings.components` draws lines, every tracked file in home belongs to exactly one component's `owns`, the kit's own files (`docs/devteam/**`, the project folder) to the computed `devteam` line, which is set aside before any component is asked. `validate` checks main; `check-pr` and `merge` check the tree that would land (`git merge-tree --write-tree` of the head onto main, on every forge, after fetching main so a push from another clone counts, and refusing the run, dry runs included, when that fetch fails; a checkout with no `origin` remote fetches nothing and judges its own main; a conflict, or a git older than 2.38, fails closed, and `validate` warns of an older git in the same words once lines are declared) and refuse what a PR adds outside every line; `observe-metrics` raises `unowned-files` and starts no new ticket until a chore extends a line; `check-ticket` refuses a file outside the ticket's line. All four read committed settings: main's for a ticket PR and for any PR that leaves `settings.md` alone; for a plan or chore that changes it, the settings it would land, which `check-pr` and `merge` also validate as `validate` would (an unknown link kind, a component on a link that can't hold one). With no lines on main or at the head, those settings are read from `settings.md` itself (base, head and main by `git show`, merged key by key and link by link; a key or link entry both main and the branch changed, and differently, is refused until main is merged into the branch), never from a merged tree, so url links alone need no git 2.38. `validate` run in a `chore-<slug>` checkout that changes `settings.md` judges that chore's landing tree the same way; anywhere else, main's tree under main's settings. A glob that matches nothing is a `line-empty` warning: it excludes nothing, so it never refuses a PR or blocks a ticket. A gap on main also blocks plan PRs: their `validate --strict` reports it as an error, so the chore that extends a line lands first.

Add accessibility and lab performance once there is a UI, evals with thresholds once there is an AI feature.

Default tools: TypeScript Biome (or ESLint + Prettier), `tsc --noEmit`, vitest (`sequence.shuffle`), knip, jscpd; Ruby RuboCop, RSpec `--order random`, SimpleCov, debride, flay; Python ruff, pyright, pytest + pytest-randomly, coverage.py, vulture; Go gofmt + golangci-lint, `go test -shuffle on -cover`, staticcheck, dupl; Rust rustfmt + clippy, nextest, cargo-llvm-cov, cargo-machete. Secrets: gitleaks everywhere. Record the choice in the settings.

**Modes.** A gate is **enforced** (any violation fails) or **ratchet** (fails only if the violation count rises, or a changed line violates). A tool with its own baseline (`rubocop --auto-gen-config`, a brakeman ignore file, a coverage floor) ratchets itself. For a pass/fail command, `"mode": "ratchet"` in the gate makes `merge` rerun a failing gate at the merge base and let the PR through, with a warning, if it fails there too. Adopting an existing codebase, turn each gate on in ratchet mode with its count recorded in the settings, open one chore ticket per component to bring it to green, and flip it to enforced when that lands. Workers bring the legacy lines they change up to the code rules and leave the rest.

**Comments and readability** are the reviewer's: a non-obvious decision with no comment saying why, a name that needs a comment, or a comment that restates the code is a Minor finding.

## 3. Review

Adversarial review is the main defect filter between an agent's first pass and `main`.

- **Non-author.** A fresh subagent the author starts counts for spec, plan and task reviews. A final review comes from a reviewer that has not seen the build: a fresh subagent on a normal ticket; on `risk: high`, two from two sessions other than the worker's, ideally different models.
- **Adversarial.** The job is to find the defect. Default verdict: not approved. Approve only after looking and failing to find a Critical or Important issue.
- **Against the rules, not taste.** A finding cites a Law id, a spec line, a contract clause or a gate. A finding that cites nothing is a suggestion and never blocks.
- **Scoped.** Read the diff and what it cites. Where a test can't prove a property, mutate the code in a scratch copy and check a test fails.
- **At an exact head.** A verdict names the commit it reviewed. It still holds at a later head only if every commit since just adds new review-record files, or fills one in: an empty Disposition cell filled, or a missing `- Reviewer:` line added. Any other edit to a record, deleting one, or changing anything else voids it; a dissent can't be edited away. An unnamed record counts for nothing, and fails the ticket only while it is the latest in its track. A final reviewer reads and runs that commit in `devteam.mjs review-worktree <ticket> <sha> [--name <suffix>]`, a detached tree under `.worktrees/` seeded like a worker's, and removes it afterwards with `review-worktree --remove <path>`.

**Stages:** design (before the feature is planned), graph (before any ticket starts), spec, plan, contract (before the stage word), task (before the next task), final (before the merge). **Passes:** 1 adversarial, the author fixes, 2 a cold confirm by someone who is neither author nor fixer, diff-only; a new Critical in pass 2 forces pass 3; a Critical in pass 3 stops the ticket and goes to the supervisor as `blocked`.

**Severity:** Critical (wrong behaviour, data loss, a security hole, a broken contract, a Law violated without a marker) and Important (a real defect or missing test with a plausible failure path; Doctrine ignored with no reason) block. Minor (correct but worse than it should be) and Suggestion (taste, or no rule cited) do not.

**The record.** One markdown file per pass, committed where the work is reviewed:

```
project/tickets/<id>/reviews/<stage>-<pass>[<track>].md     spec, plan, contract, task, final (on the ticket branch)
project/reviews/<feature>/graph-<pass>[<track>].md            graph (on the plan branch)
project/reviews/<design-slug>/design-<pass>[<track>].md       design (on the plan branch)
```

`<track>` is empty for the first independent review, `b`, `c` for further ones (`final-1.md`, `final-1b.md`). The file has a `- Reviewer:` line, a findings table with a `Disposition` column the author fills in (`fixed`, `wont-fix <reason>` with the reviewer's agreement, `disputed` goes to the supervisor, `wrong` means the reviewer agrees it was a false positive), and the verdict as its last line with the full 40-character SHA:

```markdown
# Final review, pass 1

- Reviewer: reviewer-b (fresh subagent, claude-opus)
- Reviewed: 3f2a…e91c (the whole branch)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Important | L-LOGIC-3 | src/domain/session.ts:41 | error returned as a string, not the typed sum | fixed |
| F2 | Minor | spec §3 | src/domain/session.ts:70 | expiry comment restates the code | fixed |

Verdict: APPROVE 3f2a9c1e0d7b4a6f8c2e1d0b9a8f7e6d5c4b3a2e
```

A plan review for a ticket whose one-way door the owner answered at goal level (a `one-way-door` question asked with `--goal`, not `--ticket`) checks that the plan does nothing the answer didn't cover and, if so, says it on its own line: `- Goal-level door: <qid> covers this plan`. `act --class approve-plan --approved <qid>` refuses unless the latest approving plan review has that line for that qid; a plan that goes further needs its own `one-way-door` question for the ticket.

`check-ticket` fails when no final review was made at the head, the latest final review in any track says `CHANGES`, fewer named reviewers approved than the risk needs, or any Critical or Important finding lacks a disposition. `validate` fails a landed feature whose latest graph or design review is missing or not `APPROVE`.

**Measuring reviews.** `metrics` reports first-pass rejection per stage (a healthy fleet rejects 20 to 30% of first passes; near zero means the reviewer prompt went soft), the share of findings dispositioned `wrong` (high means taste, tighten the rules), and escaped defects (defects found after merge, logged as observations of kind `escaped-defect`). The supervisor proposes prompt or rule changes from these at retros.

## 4. Merging

Only the supervisor merges, and only with `devteam.mjs merge`:

```
merge <ticket-id>          a ticket PR: check-ticket at the exact head, the log rule, every gate in a clean worktree at that head, then gh pr merge --match-head-commit, then the act
merge --plan <feature>     a plan PR: validate --strict at the head, design and graph reviews holding, the log rule
merge --chore <slug>       a chore PR (log, retro, design, architecture): the log rule; nothing under project/log (chore-log: nothing else) or project/tickets; anything outside project/ needs --approved <qid>, an owner answer
```

`--dry-run` runs every check and gate and stops before the merge.

`merge <ticket-id>` works in the ticket's repo: its PR, its gates (never inherited from home: a repo with no `gates` is refused like home with none), its `merge_method` and forge, its `ignored_checks`, after fetching home's main and that repo's (either fetch failing refuses). The `gate` and `act` lines land in home's log with a `repo` field. A ticket merges only after every ticket in its `depends_on` has merged, in whatever repo each is (`merge` and `check-pr` refuse it, dry runs included; a dependency whose repo this machine can't read or fetch fails closed: "cannot confirm <dep> is merged"), since across repos neither the branch nor the gates can see a provider that hasn't landed; a ticket that reaches main before a dependency anyway (merged by hand or in the forge's UI) is the `merged-out-of-order` finding. Plan and chore PRs are always home's; a chore that must change another repo is a ticket of kind `chore` in that repo's component. `check-pr --repo <id> [--path <checkout>]` runs the same checks, minus the gates and the approval acts, for a PR in another repo, in its checkout or the one `--path` names. The kit installs no forge workflow in any repo: `merge` is where these checks are enforced.

Any of the three that changes a setting the owner owns needs `--approved <qid>`, an answered question of that class: `gates`, `worktree_setup` and `worktree_files` (`gate-change`: they decide what a gate run sees); `autonomy_ceilings`, `agent_command`, `resume_command`, `worker_denied_commands`, `forge`, `main_branch`, `merge_method`, `upstream_repo`, `release` and `secret_commands` (`governance-edit`); and, per entry, `links`: adding, removing or re-kinding a `repo` link, or changing its `remote`, `main_branch`, `forge`, `merge_method`, `release`, `project`, `title`, `notes`, `for` or `source` is `governance-edit`; its `gates`, `worktree_setup`, `worktree_files` or `ignored_checks` is `gate-change`; each repo link entry the PR changes lands only as an act of the `--approved` answer wrote it (`link add|set|rm --approved` logs one per entry its question showed, with the entry that lands and the one main had), so one answer never lands an entry its question didn't show; its `path` and anything on a `url` link are not the owner's: url links are the supervisor's, and `merge` lands a change to one only as a `registry-edit` act wrote it: for each url link whose entry on main differs from the one that would land, acts naming it (`link add|set|rm` logs one) that lead from main's entry to that one: each act records the entry it replaced (`prior_hash`, null for an add) and the one it wrote (`entry_hash`, null for a removal), and the first must have replaced exactly the entry main has, the last written exactly the entry that lands (one act, or an add then a set between landings). An act made from an entry main has since changed never matches, so a stale `link set` never reverts a newer entry and an old `link rm` never removes a link added again since; an act without `prior_hash` (written before it existed) never matches. Only acts logged since main last changed that link's entry count (found from the last 200 commits on main's first-parent line that touched `settings.md`), so an owner's hand-revert of a link on main expires the older acts for that link, and only that link: an old act made from the entry main has again can't carry its entry back over the revert, and a change to another link or another setting expires nothing. `link land` carries an entry into the chore on the same terms, and refuses one main changed since its act: "main's links.<id> changed since <act>; re-run link set". There is no time window, so an unrelated settings landing expires no act, and a link already as main has it needs none. Only `merge` checks these acts, never `check-pr` (the forge's check can't read the supervisor's live log). It is a process check inside the supervisor's own class, not an authority boundary: `registry-edit` is constitutional, so the supervisor could write a matching act by hand; what it guarantees is that a url link lands through `link add|set|rm` and its logged act, not by a stray edit to `settings.md`. The rest of `project/settings.md` (caps, timings, components) is the supervisor's.

With no forge CLI (no `gh`, a self-hosted git remote), set `forge: "git"`. the PR is a file, `run/pr/<branch>.md` (a `# <title>` line, then the body; or `--title` and `--body-file`). `merge` checks it as it would a PR, merges the exact verified sha onto origin's main with `--no-ff`, and pushes. If main moved, the push fails, which is the same guard as `--match-head-commit`.

The head must be up to date with `main`. A head that moves after the request is a new request. The supervisor still reads the diff: `merge` proves the shape, the supervisor judges the content.

A worker never merges. Where the agent CLI supports it (Claude Code), `devteam.mjs worker` and `planner` launch the session with a settings file in `run/agent/` that denies `worker_denied_commands` (by default `gh pr merge`, `gh api`, any push that names `main`, any forced push) and installs the `stop-ok` hook. The file is per session, and a push rule that names `main` also names the main branch of the repo the session works in (a sibling on `trunk` gets `git push*trunk*` too). Since the rules are a convenience, `metrics` raises `merged-without-merge` (high) for a merge on any repo's main that no merge act made: a ticket that reads merged with no `merge-word` act, or a merge commit whose branch head no merge act names. Only merges after the finding reached home's main count. It binds only workers and planners, never the supervisor, and doesn't depend on the repo's own agent config; a convenience, not a wall. The supervisor's `merge` is where devteam's checks are enforced; the kit installs no forge workflow of its own, so a merge done on the forge's own button skips them. A project's CI (its gates, from the Baseline goal) is its own.

The log rule, checked on every PR: a PR may change `project/log/<X>.jsonl` only if it is the `plan/<feature>` PR and X is `plan-<feature>`, or it is `chore-log`; and only by appending lines that are valid, in time order, in their month, and not in the future.

## 5. Releases

Every release is a tag on `main` with a GitHub Release whose body is the changelog. The supervisor prepares it; shipping it to production is a ladder class (`release-production`, constitution §2): at rung 1 the supervisor asks, at rung 2 it asks with a default, at rung 3 it releases and reports. At any rung it releases only when every gate passes at the tagged commit.

1. The supervisor drafts: `devteam.mjs notes <previous-tag>` groups the tickets merged since by the stories they served ("completed", "advanced", "other"); it adds what users will notice and any migration steps. Below rung 3 it asks a `release-production` question with the tag it proposes (`vX.Y.Z`, semver from what changed) and the notes.
2. On the owner's yes, or on its own at rung 3: `git tag -a vX.Y.Z <sha> -m vX.Y.Z && git push origin vX.Y.Z`, then `gh release create vX.Y.Z --verify-tag --notes-file <notes>`, logged as an act of class `release-production` (with `--approved <qid>` when it asked). A rollback-safe production migration is the same, class `production-migration`. A candidate is `vX.Y.Z-rcN` with `--prerelease`.
3. Promotion is whatever the project already does, recorded in the settings as `release`: `"tag"` (deploy from the tag; the default) or `{ "branch": "production" }` (push the tagged commit to that branch: `git push origin vX.Y.Z^{commit}:refs/heads/production`; a release always fast-forwards it, so this works where the forge refuses force pushes). Either way the tag and the release exist first, so every production state has a name and notes.
4. Roll back by promoting the previous tag the same way (on a `branch` release this needs `--force`; where the forge refuses force pushes, release a revert as a new tag instead). Fix forward otherwise. A migration that is not rollback-safe is a one-way door.
5. `release` is per repo: a repo link has its own, and a component may set its own tag pattern (`release: { "tag": "web/v*" }`). Release, staging and production acts name their repo (`act … --repo <link>`), and `notes … --repo <link>` reads that repo's history. A ticket is released when its merge is in a release of its own repo and component.
6. If the project keeps a `CHANGELOG.md`, the release PR (a `chore-release-<tag>` PR merged before tagging) prepends the same notes to it.
- The PR title is the unit of the changelog: `<ticket-id>: <one line a user could read>`.
- Cut releases on a schedule, not by scope. A feature's release map says where a story is expected; the notes record where it landed.

## 6. Documents

Every document the kit asks for is markdown: designs, `architecture.md`, specs, plans, contracts, verification, retros, review records.

**A TL;DR first.** A plan (`project/tickets/<id>/plan.md`) and a design (`project/designs/*.md`) open with `## TL;DR` right under the title: at most seven bullets that say the approach in plain words. What changes and where, in what order, how it is tested, what could go wrong. Someone who reads only the TL;DR knows what will be built and can spot a wrong approach. It never depends on a diagram or a later section. `act --class approve-plan` refuses a plan without one, and `validate` flags a design being planned without one. The plan and design reviewers check that the TL;DR matches the document; a TL;DR that says something the plan doesn't do is an Important finding.

**Diagrams as Mermaid.** Any of these documents may draw with a fenced `` ```mermaid `` block: a component boundary, a sequence across a contract, a state machine, the order tickets land in. The dashboard's side panel renders them (with a Raw toggle back to the source), and so does GitHub. Use one where a picture is clearer than a paragraph; keep the prose true without it, since a diagram that fails to parse shows as its source.

