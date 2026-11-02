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
9. Every changed file is inside the ticket's `touches` or its own `project/tickets/<id>/` folder.
10. The PR body's `## One-way doors` section is `None.` or links the owner's answer (a `q-…` id); it can't say `None.` when the ticket lists one.

Points 2, 3, 4, 6, 9 and 10 are mechanical. Points 1, 7 and 8 are the final reviewer's. Point 5 is the gates.

## 2. Gates

A rule is real only when a gate runs it. The project's gates live in `project/settings.md` as `gates: { "<name>": "<command>" }` (or `{ "cmd": …, "junit": "<report path>", "paths": ["<glob>", …] }`; a gate with `paths` runs only on PRs that change a matching file, for a monorepo's per-app gates). `merge` runs gates in a fresh worktree of the PR head with `DEVTEAM_MAIN` (the main checkout) and `DEVTEAM_CACHE` (a gitignored cache folder) set, so a compiled stack doesn't rebuild from scratch: `CARGO_TARGET_DIR=$DEVTEAM_CACHE/target cargo test`, `cmake -B $DEVTEAM_CACHE/build`, `mvn -Dmaven.repo.local=$DEVTEAM_CACHE/m2`, `bundle config set --local path $DEVTEAM_CACHE/bundle`. `devteam.mjs gate --all` runs every gate in the current checkout; at adoption, run it on `main` to see which gates already fail. `merge` runs every one at the PR head before merging; workers run them locally through `devteam.mjs gate <name> -- <command>`, which records time, result and (with `--junit`) each test, so slow and flaky tests show up in the metrics.

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
- **At an exact head.** A verdict names the commit it reviewed. It still holds at a later head only if every commit since just adds new review-record files. Editing or deleting a record, or changing anything else, voids it; a dissent can't be edited away. A final reviewer reads and runs that commit in `devteam.mjs review-worktree <ticket> <sha> [--name <suffix>]`, a detached tree under `.worktrees/` seeded like a worker's, and removes it afterwards with `review-worktree --remove <path>`.

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

Any of the three that changes a setting the owner owns needs `--approved <qid>`, an answered question of that class: `gates`, `worktree_setup` and `worktree_files` (`gate-change`: they decide what a gate run sees); `autonomy_ceilings`, `agent_command`, `resume_command`, `worker_denied_commands`, `forge`, `main_branch`, `merge_method`, `upstream_repo`, `release` and `secret_commands` (`governance-edit`). The rest of `project/settings.md` (caps, timings, components) is the supervisor's.

With no forge CLI (no `gh`, a self-hosted git remote), set `forge: "git"`. the PR is a file, `run/pr/<branch>.md` (a `# <title>` line, then the body; or `--title` and `--body-file`). `merge` checks it as it would a PR, merges the exact verified sha onto origin's main with `--no-ff`, and pushes. If main moved, the push fails, which is the same guard as `--match-head-commit`.

The head must be up to date with `main`. A head that moves after the request is a new request. The supervisor still reads the diff: `merge` proves the shape, the supervisor judges the content.

A worker never merges. Where the agent CLI supports it (Claude Code), `devteam.mjs worker` and `planner` launch the session with a settings file in `run/agent/` that denies `worker_denied_commands` (by default `gh pr merge`, `gh api`, any push that names `main`, any forced push) and installs the `stop-ok` hook. It binds only workers and planners, never the supervisor, and doesn't depend on the repo's own agent config; a convenience, not a wall. A project that wants the forge itself to refuse can turn on `init --github`'s workflow as a required check; it runs `check-pr`, the same checks minus the gates and the supervisor's approval acts, which live in its log until the next `chore-log` lands.

The log rule, checked on every PR: a PR may change `project/log/<X>.jsonl` only if it is the `plan/<feature>` PR and X is `plan-<feature>`, or it is `chore-log`; and only by appending lines that are valid, in time order, in their month, and not in the future.

## 5. Releases

Every release is a tag on `main` with a GitHub Release whose body is the changelog. The supervisor prepares it; shipping it to production is a ladder class (`release-production`, constitution §2): at rung 1 the supervisor asks, at rung 2 it asks with a default, at rung 3 it releases and reports. At any rung it releases only when every gate passes at the tagged commit.

1. The supervisor drafts: `devteam.mjs notes <previous-tag>` groups the tickets merged since by the stories they served ("completed", "advanced", "other"); it adds what users will notice and any migration steps. Below rung 3 it asks a `release-production` question with the tag it proposes (`vX.Y.Z`, semver from what changed) and the notes.
2. On the owner's yes, or on its own at rung 3: `git tag -a vX.Y.Z <sha> -m vX.Y.Z && git push origin vX.Y.Z`, then `gh release create vX.Y.Z --verify-tag --notes-file <notes>`, logged as an act of class `release-production` (with `--approved <qid>` when it asked). A rollback-safe production migration is the same, class `production-migration`. A candidate is `vX.Y.Z-rcN` with `--prerelease`.
3. Promotion is whatever the project already does, recorded in the settings as `release`: `"tag"` (deploy from the tag; the default) or `{ "branch": "production" }` (push the tagged commit to that branch: `git push origin vX.Y.Z^{commit}:refs/heads/production`; a release always fast-forwards it, so this works where the forge refuses force pushes). Either way the tag and the release exist first, so every production state has a name and notes.
4. Roll back by promoting the previous tag the same way (on a `branch` release this needs `--force`; where the forge refuses force pushes, release a revert as a new tag instead). Fix forward otherwise. A migration that is not rollback-safe is a one-way door.
5. If the project keeps a `CHANGELOG.md`, the release PR (a `chore-release-<tag>` PR merged before tagging) prepends the same notes to it.
- The PR title is the unit of the changelog: `<ticket-id>: <one line a user could read>`.
- Cut releases on a schedule, not by scope. A feature's release map says where a story is expected; the notes record where it landed.

## 6. Documents

Every document the kit asks for is markdown: designs, `architecture.md`, specs, plans, contracts, verification, retros, review records.

**A TL;DR first.** A plan (`project/tickets/<id>/plan.md`) and a design (`project/designs/*.md`) open with `## TL;DR` right under the title: at most seven bullets that say the approach in plain words. What changes and where, in what order, how it is tested, what could go wrong. Someone who reads only the TL;DR knows what will be built and can spot a wrong approach. It never depends on a diagram or a later section. `act --class approve-plan` refuses a plan without one, and `validate` flags a design being planned without one. The plan and design reviewers check that the TL;DR matches the document; a TL;DR that says something the plan doesn't do is an Important finding.

**Diagrams as Mermaid.** Any of these documents may draw with a fenced `` ```mermaid `` block: a component boundary, a sequence across a contract, a state machine, the order tickets land in. The dashboard's side panel renders them (with a Raw toggle back to the source), and so does GitHub. Use one where a picture is clearer than a paragraph; keep the prose true without it, since a diagram that fails to parse shows as its source.

