# Continuous integration

How code is verified and safely merged: the pipeline, merge-safety configuration, what happens to `main` after a merge, and how CI itself is changed. Everything after a green `main` (rings, tags, changelogs) is [`release.md`](release.md).

**The CI and branch-protection configuration is the source of truth; this doc is its commentary.** A disagreement is a bug in this doc.

This doc points at, never restates:
- [`quality-gates.md`](quality-gates.md): the catalogue of gates and their tools.
- [`code-style.md`](code-style.md) Appendix A: the Laws those gates enforce.
- [`../process/supervisor.md`](../process/supervisor.md) §6: the merge word, the judgment layer on top of CI.

## 1. The pipeline

```
ticket/<id> branch → PR CI (changes filter → per-component jobs → root job → `check` aggregate)
                 → non-author review records + supervisor merge word
                 → merge to main, refusing if the head moved
main             → push CI (never cancelled) + build/publish
                 → release.md takes over
```

## 2. Pull-request CI

- **One required aggregate check, `check`.** It depends on every job. A **skipped** job (path-filtered out) counts as pass; a **cancelled** job counts as fail. Write this rule into the workflow as a comment so nobody "simplifies" it.
- **Path-filtered per component** in a monorepo: each component's job runs only when its files, its build file, the CI config, or shared contracts change. Adding a component is one job, one filter, one `needs` entry, one line in `check`.
- **Two devteam jobs always run** (template: [`../templates/github/devteam.yml`](../templates/github/devteam.yml)): `devteam-validate` runs `devteam.mjs validate`; `merge-word` runs `devteam.mjs check-pr` on every PR (§3).
- **Concurrency:** a PR's in-flight run is cancelled by a new push; **a push to `main` is never cancelled** (`cancel-in-progress: ${{ github.event_name == 'pull_request' }}`).
- **Migrations:** a PR that adds a migration must also update the rollback-safety flag named in the settings in the same diff (see `release.md` §4).
- **Pins:** runtime versions, package-manager versions and third-party action SHAs are pinned. Version drift between components is a defect.

## 3. Merge safety: two layers, both required

**The automatic layer (what GitHub must refuse):**
- pushes to `main` only through a PR; no force-push, no deletion, no bypass actor;
- required check `check` with **strict = true** (the head must be up to date with base);
- required checks **`devteam-validate`** and **`merge-word`**, rather than a GitHub approval. Fleets usually run under one shared identity, so GitHub's own review approvals cannot prove non-author independence. `merge-word` runs `devteam.mjs check-pr`, which automates the half that a machine can check of the merge word:
  - for a `ticket/<id>` branch, `check-ticket` at the PR's exact head: approved spec and plan, verification rows for every done-when, the latest final review in every track saying `APPROVE` at a commit that holds at the head (at its own commit, or at a later head whose only changes are newly added review records; `review.md` §1), from enough named reviewers (two for `risk: high`), every Critical and Important finding dispositioned, and no changed file outside the ticket's `touches` (plus its own ticket folder);
  - for any other branch, a title matching `^chore-<slug>: `;
  - for every PR, the log rule ([`../process/log.md`](../process/log.md) §5): only the `chore-log` branch may change `project/log/`, only that, and only by appending valid lines in time order whose writer matches the file and is allowed by the authority table;
  - for both, a PR title `<ticket-id>: …` or `chore-<slug>: …`, and a `## One-way doors` section in the body that is `None.` or links the owner's answer (a question id or URL). A ticket that lists one-way doors cannot say `None.`;
- one merge method, chosen in the settings (merge commit is the default, so ticket branches stay legible in history).

**What no check can prove under one identity** is that the supervisor actually gave the word. So the rule is structural: **only the supervisor merges.** Workers ask for the word; the supervisor verifies and merges itself (`supervisor.md` §6). Where the agent CLI supports permission rules, deny workers `gh pr merge` and any push to `main` (`worker_denied_commands` in the settings), so a confused worker cannot merge even by mistake.

Check the intended branch rules in as `.github/branch-rules.json` and run a scheduled workflow that diffs it against the live configuration, so drift becomes a red run rather than a surprise.

**The judgment layer (what the supervisor judges):** the merge word (`supervisor.md` §6). GitHub refuses the unsafe shape; the supervisor judges the content. Neither substitutes for the other.

If `strict` is off, GitHub reports a mergeable state even when the head is behind base. Until strict is on, the supervisor checks `git merge-base --is-ancestor origin/main <head>` itself, and workers merge `origin/main` before asking for the word. If your plan has no merge queue, `strict` plus re-merge is the equivalent; don't design around a queue you don't have.

## 4. `main` after a merge

- **Push CI on `main` must complete.** It is the only check that catches a semantic conflict between two PRs that were each green against a stale base.
- **Red-main rule:** a failed `main` push run blocks the next merge. Revert first, investigate second, within one hour.
- The supervisor logs every merge as an act (`devteam.mjs act --class merge-word`) only after confirming the merge commit is on `main`.

## 5. Supply chain

- Automated dependency updates on a schedule, grouped; majors held for review; security advisories override.
- A **dependency cooldown** (`L-SEC-6`): a minimum release age per ecosystem (7 days default), advisories override.
- SHA-pinned actions, plus a workflow linter (`zizmor` or equivalent).
- Secret scanning and frozen-lockfile install are required gates.

## 6. Scheduled workflows

- dead-link sweep over docs;
- branch-rule drift check against `.github/branch-rules.json`;
- `devteam.mjs validate` on `main` nightly, so graph drift is caught even when no PR touches it.

## 7. Changing CI itself

A PR that edits a workflow, branch rules, or a release key's usage is `risk: high`: two independent reviews, and the workflow linter must pass. Release secrets are referenced exactly once in workflow files.

## 8. Turning gates on

The **gate table** in the settings maps each Law to the gate row in `quality-gates.md`, the CI step that runs it, and the ticket or chore that turned it on. A Law with no row there is Doctrine, not a gate. Bootstrap fills the day-one rows; each gate turned on later is its own `chore-` PR.
