# Continuous integration

How code is verified and safely merged: the pipeline, merge-safety configuration, what happens to `main` after a merge, and how CI itself is changed. Everything after a green `main` (rings, tags, changelogs) is [`release.md`](release.md).

**The CI and branch-protection configuration is the source of truth; this doc is its commentary.** A disagreement is a bug in this doc.

This doc points at, never restates:
- [`quality-gates.md`](quality-gates.md): the catalogue of gates and their tools.
- [`code-style.md`](code-style.md) Appendix A: the Laws those gates enforce.
- [`../process/supervisor.md`](../process/supervisor.md) §6: the merge word, the judgment layer on top of CI.

## 1. The pipeline

```
node/<id> branch → PR CI (changes filter → per-component jobs → root job → `check` aggregate)
                 → non-author review records + supervisor merge word
                 → merge to main, refusing if the head moved
main             → push CI (never cancelled) + build/publish
                 → release.md takes over
```

## 2. Pull-request CI

- **One required aggregate check, `check`.** It depends on every job. A **skipped** job (path-filtered out) counts as pass; a **cancelled** job counts as fail. Write this rule into the workflow as a comment so nobody "simplifies" it.
- **Path-filtered per component** in a monorepo: each component's job runs only when its files, its build file, the CI config, or shared contracts change. Adding a component is one job, one filter, one `needs` entry, one line in `check`.
- **The devteam job always runs**: `devteam.mjs validate`, and `devteam.mjs check-node <id>` when the branch is `node/<id>`. Template: [`../templates/github/devteam.yml`](../templates/github/devteam.yml).
- **Concurrency:** a PR's in-flight run is cancelled by a new push; **a push to `main` is never cancelled** (`cancel-in-progress: ${{ github.event_name == 'pull_request' }}`).
- **Migrations:** a PR that adds a migration must also update the binding's rollback-safety flag in the same diff (see `release.md` §4).
- **Pins:** runtime versions, package-manager versions and third-party action SHAs are pinned. Version drift between components is a defect.

## 3. Merge safety: two layers, both required

**The mechanical layer (what GitHub must refuse):**
- pushes to `main` only through a PR; no force-push, no deletion, no bypass actor;
- required check `check` with **strict = true** (the head must be up to date with base);
- a required **`merge-word`** status check rather than a GitHub approval. Fleets usually run under one shared identity, so GitHub's own review approvals cannot prove non-author independence. The `devteam` job mechanizes the checkable half: the final review record says `APPROVE <head-sha>` at the exact head, the PR title matches `^(<node-id>|chore-[a-z0-9-]+): `, and the PR body's `## One-way doors` section is `None.` or links an owner answer;
- one merge method, chosen in the binding (merge commit is the default, so node branches stay legible in history).

Check the intended branch rules in as `.github/branch-rules.json` and run a scheduled workflow that diffs it against the live configuration, so drift becomes a red run rather than a surprise.

**The judgment layer (what the supervisor judges):** the merge word (`supervisor.md` §6). GitHub refuses the unsafe shape; the supervisor judges the content. Neither substitutes for the other.

If `strict` is off, GitHub reports a mergeable state even when the head is behind base. Until strict is on, the supervisor checks `git merge-base --is-ancestor origin/main <head>` itself, and workers merge `origin/main` before asking for the word. If your plan has no merge queue, `strict` plus re-merge is the equivalent; don't design around a queue you don't have.

## 4. `main` after a merge

- **Push CI on `main` must complete.** It is the only check that catches a semantic conflict between two PRs that were each green against a stale base.
- **Red-main rule:** a failed `main` push run blocks the next merge. Revert first, investigate second, within one hour.
- The supervisor logs every merge (event `node.merged`) only after confirming the merge commit is on `main`.

## 5. Supply chain

- Automated dependency updates on a cadence, grouped; majors held for review; security advisories override.
- A **dependency cooldown** (`L-SEC-6`): a minimum release age per ecosystem (7 days default), advisories override.
- SHA-pinned actions, plus a workflow linter (`zizmor` or equivalent).
- Secret scanning and frozen-lockfile install are required gates.

## 6. Scheduled workflows

- dead-link sweep over docs;
- branch-rule drift check against `.github/branch-rules.json`;
- `devteam.mjs validate` on `main` nightly, so graph drift is caught even when no PR touches it.

## 7. Changing CI itself

A PR that edits a workflow, branch rules, or a release key's usage is `risk: high`: two independent reviews, and the workflow linter must pass. Release secrets are referenced exactly once in workflow files.

## 8. Commissioning

The binding's **commissioning table** maps each Law to the gate row in `quality-gates.md`, the CI step that runs it, and the node or chore that commissioned it. A Law with no row there is Doctrine, not a gate. Bootstrap fills the day-one rows; each later commissioning is its own `chore-` PR.
