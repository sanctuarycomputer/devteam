# Delivery & Deployment Doctrine

What leaves CI and reaches a machine: the promotion rings, the tag-based release model, the owner gate, rollback safety, artifacts, changelogs, and the testing/soak cycles between rings.

**Boundary:** `docs/workflow/ci.md` ends at a green `main`; this doc begins at a green `main`. Neither restates a workflow step, a `release.toml` line, a contract field, or the merge word — each is a link.

This doc is **doctrine + index**, never a second copy of a config. It points at: ADR 0030 (`docs/decisions/0030-releases.md`), `docs/contracts/release.md` (the manifest), `docs/runbooks/releases.md` (how to cut), `control/docs/runbooks/fleet-update.md` (rollouts), and `release.toml` (rollback flags). The config/runbooks are the source of truth.

Status: draft for review. The "Owed" items name the chores and the two owner decisions that make this real.

## 1. The three rings (the promotion ladder as policy)

Promotion is **by tag**, not by branch. Each ring is a gate to the next.

| Ring | Trigger | What deploys | Gate to the next ring |
|---|---|---|---|
| **dev / integration** | merge to `main` | `images.yml` builds the service images to the registry (tags `<sha>` + `main`); **plane-only**: the control plane deploys to production *only* when a stable is published, `rollback_safe = true`, and the image's `bin/release verify` passes | `check` green on `main` (and the `ci.md` §3 merge-safety layer) |
| **beta / canary (staging)** | a `vX.Y.Z-rcN` tag pushed by a release actor | `release.yml` promotes the existing images (never rebuilds), signs `release.json`, deploys the plane, publishes the prerelease; `BetaIssueJob` rolls the **first cohort** (canary households + beta opt-ins) within ~60 s | **soak**: the rc rollout ≥ 24 h on the canary (the owner's "stable on a clean 24 h canary soak" ruling; `Rollouts::Soak`, `NO_SOAKED_RC`) |
| **production (stable)** | a `vX.Y.Z` tag pushed by a release actor | same workflow; the stable rollout holds until an rc with byte-equal moved digests + template has soaked, then rolls the fleet cohorts in order (≥ 48 h) | the owner halts/rolls back via `/admin/rollouts` |

## 2. Trunk + tags, not branches

**No `staging` or `production` branch as a merge target.** Reasons, from the design: `release.yml`'s `check` refuses a tag whose commit is not `main`'s head, and `promote` proves every image was built from `main` by `images.yml` (ADR 0030, decisions 1 & 3). A production branch would either always equal a tag (redundant) or diverge and break the proof chain + the one-step rollback walk — and it invites hotfix-on-production, which this design deliberately ruled out (fix forward, one-step rollback).

The owner's wish ("see what is in staging vs production") is served without branches by:
- the **GitHub Releases** list (prerelease = beta, release = stable);
- **GitHub Environments** — `production` exists; **add a `beta` environment** on the rc deploy so each ring has its own deployment-history page;
- optionally, two **derived, read-only pointer branches** `staging` and `production` that `release.yml` fast-forwards *after* a successful rc/stable deploy, protected so only the workflow moves them. They trigger nothing — a view, not an act. (`git log production` then answers "what is live.")

This is trunk-based development with promotion by immutable tag (trunkbaseddevelopment.com; Humble & Farley, *Continuous Delivery*, "build your binaries once"), and the ring/cohort rollout with a soak gate is the standard safe-deployment-practice shape (Microsoft, "Safe deployment practices").

## 3. The owner gate — and its one exception

- **Production is owner-gated by the tag ruleset + `.github/release-actors.json`:** no tag, no household moves. The owner (and the named release actors) alone can push a `v*` tag.
- **The one exception — the plane-only hotfix lane — must be stated plainly:** the *control plane* deploys to production from a bare merge to `main` (conditional: a stable is published, `rollback_safe`, and the in-image `bin/release verify` passes). Household apps never move this way; only the plane. Today this is documented only in `images.yml` comments + `releases.md` § The plane-only path. **Owner decision owed:** confirm this lane stays automatic.

## 4. Rollback safety

- `release.toml` is the flag; a migration that isn't rollback-safe flips `rollback_safe = false` for the release that carries it. The root `release` gate and the `ci.md` §2 migration step enforce the pairing. (See `release.toml`'s own header and system-08 decision 6 — not copied here.)
- Rollback is **one step** via `Release.previous`, gated by `rollback_safe`; the owner acts on `/admin/rollouts`.

## 5. Artifacts — inventory (what / where / retention / verifier)

| Artifact | Where | Retention | Verified by |
|---|---|---|---|
| 7 service images | `registry.fly.io/fi-<svc>` (tags `<sha>`, `main`, and the version at release) | registry | labels (commit/source/run); `bin/release verify` at boot |
| per-service digest records `fi-<svc>.json` | GitHub Actions artifacts | 90 days | `promote` digest match |
| `release.json` + `release.json.minisig` | the GitHub Release | permanent | the plane verifies offline at boot; one altered byte → refused |
| `plane.json`, `promoted-fi-*`, renderings | GitHub Release / artifacts | permanent / 90 days | `scripts/check_release.py`, the render-and-compare |
| template store | baked into `fi-control:<tag>` by SHA-256 | with the image | digest |

Keys: the private half is the `production`-env secret `RELEASE_KEY`, named exactly once (the `workflows` gate enforces); the public half `docs/contracts/release.pub` is byte-equal to `control/config/release.pub` (the `release` gate enforces). **Owed:** delete the stray untracked root `minisign.pub` (redundant with `docs/contracts/release.pub`). SBOM/attestation (SLSA) isn't available on the current plan — kept in `code-style.md` Appendix C until that changes.

## 6. Changelog

**The changelog *is* the GitHub Release** — no tracked `CHANGELOG.md` (it would duplicate the release record and add `paths`/`mdlint`/`links` gate surface for no reader). Generation:
- the annotated tag's message is the notes header; `gh release create --generate-notes` appends the PR-title list, **categorized by `.github/release.yml`** (one label per service, plus `contract`, `chore`, `dependencies`-excluded; **Owed**: add this file + require the service label in the `merge-word` check);
- **the unit is the PR title — Law: `<item-or-chore-id>: one line a household member could read`**; commit messages stay free-form (do *not* adopt Conventional Commits — the type/scope prefix duplicates the item id, and the squash-vs-merge inconsistency would make commit-derived notes unreliable);
- versioning is `v<major>.<minor>.<patch>[-rcN]` (the release contract's pattern; SemVer), `-rc` the only pre-release form.
- Story-derived notes: `scripts/release/notes.py` (shared with `planning.md`) groups the merged rows by their `Serves:` stories for the "stories completed / advanced" section.

## 7. Testing & soak cycles — what each ring proves

- **CI (dev):** unit + e2e + the image build (the only Dockerfile check).
- **beta/canary (rc):** the item verification notes + the live addenda (`releases.md` § The live addenda) walked against the real services; health reports; render-and-compare as the template check.
- **production (stable):** the canary soak (≥ 24 h) + health reports gate the fleet cohorts (≥ 48 h).
- What is **not** run on the shared build machine (real-machine/device checks per `PROCESS.md` § Rules' network line) is collected before release, in the rc verification.

## 8. Operator's acts and the record

`docs/runbooks/releases.md` § what a cut asks is the living operator checklist; this doc only says it exists and that a line is struck when done. Cut mechanics, cohort order, and the rollback runbook live there and in `control/docs/runbooks/fleet-update.md` — never restated here.

## 9. Owed

- **Owner decision:** allow the GitHub Actions app to create `v*-rc*` tags *only* (a second tag ruleset with the Actions app as bypass for that pattern; stable `v*` stays person-only), enabling a scheduled `rc.yml` that cuts an rc when `main` has moved since the last tag and `main`'s push-CI is green — i.e. "staging auto-deploys from `main`, production I promote," with zero branches. If declined, rc stays an owner-cut tag and the doctrine says so.
- **Owner decision:** confirm the plane-only hotfix lane (§3) stays automatic.
- Add the `beta` GitHub environment on the rc deploy (§2).
- Add `.github/release.yml` categories (§6); add `scripts/release/notes.py` (§6; shared).
- Delete the stray root `minisign.pub` (§5); reconcile `releases.md` § Who may cut with the tag ruleset's actual `OrganizationAdmin` bypass.
- Optional: the derived read-only `staging`/`production` pointer branches (§2).
