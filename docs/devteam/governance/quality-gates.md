# Quality gates

The definition of done for a ticket, and the catalogue of gates that enforce it. This is the file `code-style.md` and `ci.md` point to when they say "a gate".

A rule is real only when it has a row here **and** a CI step that runs it listed in the gate table in the settings. Until then it is doctrine, enforced by review.

## 1. Definition of done (per ticket)

A ticket is done, and may receive the merge word, only when all of these hold at the PR's exact head:

1. Every done-when in the ticket file (`project/graph/<id>.json`) is met, and each is shown by a command or a test, not by a claim.
2. `project/tickets/<id>/spec.md` and `plan.md` exist with `Status: approved`.
3. `project/tickets/<id>/verification.md` exists and records each done-when with the command run and its result.
4. A final review record says `Verdict: APPROVE <sha>` at a commit that holds at the head (at its own commit, or at a later head whose only changes are newly added review records; `review.md` §1), and no Critical or Important finding is undispositioned (`review.md` §5). `risk: high` tickets have two, from different sessions.
5. CI's required aggregate check is green at that head (a path-filtered skip counts as pass; a cancelled job counts as fail).
6. The PR title is `<ticket-id>: <one line a user of the product could read>` and the branch is `ticket/<ticket-id>`.
7. Any rulings received during the ticket are copied into the spec's or plan's Rulings section.
8. No new bare lint suppression; every suppression is a `doctrine-exception(<rule-id>): <reason>` marker (`code-style.md` §16).
9. Every changed file is inside the ticket's `touches` or its own ticket folder.
10. The PR body's `## One-way doors` section is `None.` or links the owner's answer; it cannot say `None.` if the ticket lists one-way doors.

`devteam.mjs check-ticket <id>` checks 2, 3, 4, 6 (title), 9 and 10 automatically, reading committed files at the exact head; CI runs it as the required `merge-word` check (`ci.md` §3). Points 1 and 7 are checked by the final reviewer against `verification.md` and the spec; points 5 and 8 by CI's other gates.

## 2. Root gates (every project, day one)

| Gate | What fails it | Law |
|---|---|---|
| format | unformatted code (autofix first) | `L-ERG-2` |
| lint | any lint error, incl. complexity at linter defaults | `L-ERG-1` |
| typecheck | any type error (typed stacks) | `L-LOGIC-3`, `-5` |
| test | any failing test; random order on | `L-TEST-1`, `-4` |
| coverage | branch coverage under the floor set in the settings on `domain/**` | `L-TEST-3` |
| touches-test | a PR changing source with no test change and no `no-test:<reason>` in its body | `L-TEST-3` |
| dead-code | unused exports, files or dependencies | |
| duplication | copy-paste over the threshold set in the settings | |
| secrets | any secret detected | `L-SEC-8` |
| lockfile | install not frozen, or a dependency younger than the cooldown | `L-SEC-6`, `-8` |
| escape-hatch | a bare suppression comment | `L-ESC-1` |
| devteam | `devteam.mjs validate` fails, or `check-ticket` fails on a `ticket/*` branch | |

Add when the trigger fires: accessibility (`L-FE-1`) and lab performance (`L-FE-2`) once there is a UI; evals with thresholds once there is an AI feature (`L-SEC-5`).

Each gate runs in one of two modes, recorded in the gate table in the settings: **enforced** (any violation fails) or **ratchet** (fails only if the violation count rises or a changed line violates; for adopting existing code, `process/bootstrap.md` §5.3).

## 3. Default tools per stack

Pick from this table; record the choice in the settings. Autofix runs before the check fails. Locally, run each gate through `devteam.mjs gate <name> -- <command>` (with `--junit` where the test runner can write a JUnit report), so its time and flakiness are measured (`process/improvement.md` §2).

| Gate | TypeScript | Ruby/Rails | Python | Go | Rust |
|---|---|---|---|---|---|
| format + lint | Biome (or ESLint + Prettier) | RuboCop | ruff | gofmt + golangci-lint | rustfmt + clippy |
| typecheck | `tsc --noEmit` | (Doctrine; no gate) | pyright or mypy | compiler | compiler |
| test | vitest (`sequence.shuffle`) | RSpec `--order random` | pytest + pytest-randomly | `go test -shuffle on` | cargo test / nextest |
| coverage | vitest v8 | SimpleCov | coverage.py | `go test -cover` | cargo-llvm-cov |
| dead code | knip | debride | vulture | deadcode / staticcheck | cargo-machete + `dead_code` lint |
| duplication | jscpd | flay | jscpd | dupl | jscpd |
| secrets | gitleaks | gitleaks | gitleaks | gitleaks | gitleaks |

## 4. Comments and readability

Machines check structure; reviewers check meaning. A reviewer raises a Minor finding when:

- a non-obvious decision has no comment saying **why** (comments say why, names say what);
- an exported function, type or module has no doc comment where the stack has a convention for one;
- a name needs a comment to be understood (rename instead).

A comment that restates the code is itself a Minor finding.
