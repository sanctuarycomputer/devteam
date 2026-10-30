# Continuous Integration Doctrine

How code is verified and safely merged: the pipeline, the merge-safety configuration, the rules for `main` after a merge, and how CI itself is changed. Deployment/delivery (promotion, releases, changelogs, artifacts, beta rings) is `docs/workflow/deployment.md`.

Status: draft for review. The "Owed" section names the config fixes and gates that make this real; several need an owner action and are marked.

## 0. Scope and precedence

This doc **owns**: the pipeline map, merge-safety *configuration* (as doctrine), what happens to `main` after a merge, and the rules for changing CI. It **points at, never restates**:
- `docs/PROCESS.md` §4 — the canonical catalogue of every gate (root gates + per-language profile) and its tool.
- `docs/workflow/code-style.md` Appendix A — the "Laws" and their commissioning table (§8 here wires them to §4).
- `docs/workflow/fleet-code-generation-protocol.md` §6 + `PROCESS.md` §7 — the **merge word** (the human/agent judgment layer).
- `docs/workflow/deployment.md` + `docs/runbooks/releases.md` — everything post-merge.

**The gate/branch-protection configuration is the source of truth; this document is its commentary.** A disagreement is a bug in this doc.

## 1. The pipeline (one view)

```
PR branch → ci.yml (changes-filter → per-service jobs → root job → `check` aggregate)
          → non-author reviews + PM merge word
          → merge (git merge --match-head-commit) to main
main      → ci.yml (push; must NOT be cancelled) + images.yml (publish; plane-only deploy under its conditions)
          → [deployment.md: -rc tag → canary/beta → soak → v* stable → fleet]
```

## 2. Pull-request CI

- **Path-filtered monorepo CI:** one job per service (run only when its files, its `Makefile`, `ci.yml`, or `docs/contracts/**` change), a root job, and one required aggregate **`check`**.
- **`check` semantics (write this down so no one "simplifies" it):** a *skipped* job (path-filtered out) counts as **pass**; a *cancelled* job counts as **fail**. This is the correct, non-obvious pattern for a path-filtered monorepo.
- **Adding a service** = one job + one `changes` filter + one `needs` entry + one line in `check`. Nothing else.
- **Concurrency:** a PR's in-flight run is cancelled on a new push; **`main` pushes are never cancelled** (see §4 and the Owed fix).
- **Migrations:** a PR adding a migration must change `release.toml` in the same diff (the `release` gate).
- **Pins:** node, pnpm (per service), uv, ruby, and action SHAs are pinned; the current pnpm-9-vs-12 split across services is drift to close (Owed).

## 3. Merge safety — two layers, both required

**The mechanical layer (what GitHub must refuse).** Target configuration, as doctrine:
- a push to `main` only via a PR; no force-push or deletion; no bypass actor on `main`;
- required status check **`check`, strict = true** (up-to-date-with-base);
- **a required `merge-word` status check** — *not* a GitHub approval. Every session operates under the one `hhff` GitHub identity, so GitHub PR reviews can neither provide non-author independence nor even allow a non-self approval. Instead a `pull_request` job mechanizes the *checkable* half of the merge word and fails unless: the non-author review record `<service>/docs/reviews/<item>-pr.md` exists with a verdict line `APPROVE <head-sha>` at the exact head; the PR body's `## Core design changes` is `None.` or cites an owner decision; and the PR title matches `^(<service>-NN|system-NN|chore-[a-z0-9-]+): `. The PM's merge word remains the judgment layer on top;
- **merge-commit only** (`PROCESS.md` §7), or an explicit written decision to allow squash for chores.

The intended rule set is checked in as `.github/branch-rules.json`, and a scheduled `rules.yml` (like `links.yml`) diffs it against the live config so drift is a red run, not a surprise.

**The judgment layer (what the PM judges).** `fleet-code-generation-protocol.md` §6 + `PROCESS.md` §7: the merge word, given only after the PM verifies draft=false + CLEAN + green + reviews APPROVE at the exact head. **Neither layer substitutes for the other** — GitHub refuses the unsafe *shape*; the PM judges the *content*.

> **Important correction, until `strict=true` is set:** with the current `strict=false`, GitHub reports `mergeStateStatus: CLEAN` even when a head is **behind base** (`BEHIND` only surfaces under strict). So the merge-word gate's "CLEAN = not behind base" is not what the API is telling the PM today. Until strict is on, the PM additionally verifies up-to-date-ness explicitly (`git merge-base --is-ancestor origin/main <head>`), and builders re-merge `origin/main` before requesting the word (already the practice).
>
> **Merge queue is not available** on a private Team-plan repo (Enterprise-Cloud/public only). `strict` + re-merge is the Team-plan equivalent; don't design around a queue.

## 4. `main` after a merge

- The **push CI on `main` must complete** — it is the only check that catches a semantic conflict between two PRs that were each green against a stale base.
- **Red-main rule:** a failed `main` push-CI is the next merge's blocker; revert first, investigate second, bounded at one hour.
- `images.yml` publishes images on every merge and plane-only-deploys control under its stated conditions (see `deployment.md` §3–§4).

## 5. Supply chain in CI

- Dependabot cadence/grouping per `.github/dependabot.yml`; majors held, advisories override (existing policy).
- **Dependency cooldown** (code-style §10 `L-SEC-6`): a minimum release age per ecosystem (pnpm `minimumReleaseAge`), advisories override. Close the pnpm-9-vs-12 split so every TS service gets it.
- **Actions hardening:** SHA-pinned actions + `zizmor` linting the workflows. Keep.
- `gitleaks` (secrets) + frozen-lockfile install are required checks.

## 6. Scheduled workflows

- `links.yml` (dead-link sweep).
- `rules.yml` (new, Owed): branch-protection + ruleset drift check against `.github/branch-rules.json`.

## 7. Changing CI itself

- A workflow edit runs with both release keys once on `main` (ADR 0030's residual), so it gets the two-session review; `zizmor` + `scripts/build_filter.py --check` guard it; the `RELEASE_KEY` single-mention rule holds.

## 8. Commissioning the code-style Laws (wiring Appendix A to reality)

`code-style.md` Appendix A is a catalogue of Laws; a Law is real only when it has a row in `PROCESS.md` §4 *and* a Makefile/CI target. This doc carries the commissioning table (Owed to fill as each lands): each Law ID → its `PROCESS.md` §4 row → its Makefile target / workflow step → the item or chore that commissions it. Until a Law appears there, it is doctrine, not a gate. Also fix the stale `PROCESS.md` §4 "Duplication: no gate until first item" row — TS duplication (`jscpd`) is already gated in several services.

## 9. Owed (with the three live defects found in review)

1. **`main` CI is mostly cancelled** — `ci.yml`'s `cancel-in-progress: true` applies to `main` pushes; a large share of recent `main` runs were cancelled, so a semantic conflict can land unseen. **Fix (one line):** `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`. *Highest priority.*
2. **Tag-ruleset doc divergence** — `releases.md` claims no `OrganizationAdmin` bypass on release tags; the live ruleset has an always-bypass for org admins. Reconcile the doc (or the config) so it states what exists.
3. **Squash-vs-merge undecided** — squash merges are in use while `PROCESS.md` §7 says "merge commit" and the ruleset allows all three. Decide and make GitHub agree.
- Set **`strict=true`**, move the required `check` into the org ruleset, add the **`merge-word` status check** as a required check (§3), restrict merge methods, set `allow_update_branch: true` and `enforce_admins` on `main` — then retire the §3 interim up-to-date check.
- Add `.github/branch-rules.json` + the `rules.yml` drift workflow.
- Fill the §8 commissioning table; commission the uncommissioned Laws (`L-ESC-1` doctrine-exception marker, `L-TEST-3` PR-touches-a-test, `L-FE-2` Lighthouse, the cooldown split).

**Not in this doc:** per-tool lint rules (`PROCESS.md` §4), the Laws themselves (`code-style.md`), anything post-merge (`deployment.md`, `releases.md`), reviews (`PROCESS.md` §5/§7).
