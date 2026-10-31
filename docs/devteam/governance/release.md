# Release

What leaves CI and reaches users: promotion rings, the tag-based release model, the owner gate, rollback safety, artifacts, changelogs and soak. [`ci.md`](ci.md) ends at a green `main`; this doc begins there.

This doc is policy. The binding names the concrete rings, environments, artifact registry, rollback flag and release actors. Runbooks and workflow files are the source of truth for mechanics.

## 1. Rings

Promotion is **by tag**, not by branch. Each ring gates the next. The default ladder, which the binding may shorten (a small web app may have only dev and production) but not reorder:

| Ring | Trigger | What happens | Gate to next ring |
|---|---|---|---|
| **dev** | merge to `main` | artifacts built once, tagged with the commit SHA; deployed to the dev environment if the binding has one | `check` green on `main` |
| **beta** | a `vX.Y.Z-rcN` tag | the **same artifacts** promoted (never rebuilt) to beta / canary users | soak: the binding's beta soak window (default 24 h) with health checks clean |
| **production** | a `vX.Y.Z` tag | the same artifacts promoted to everyone, in cohorts if the binding defines them | the owner can halt or roll back at any time |

## 2. Trunk and tags, not branches

- No `staging` or `production` branch as a merge target. A production branch either always equals a tag (redundant) or diverges (and invites hotfixes that skip review). Fix forward; roll back in one step.
- Release workflows refuse a tag whose commit is not on `main`, and prove every promoted artifact was built from `main`.
- "What is in beta vs production" is answered by the releases list (pre-release vs release), by per-ring deployment environments, and optionally by read-only pointer branches that only the release workflow fast-forwards after a successful deploy. Those pointers trigger nothing.

## 3. The owner gate

- Production is owner-gated by **tag protection**: only the owner and the binding's named release actors can push a `v*` tag. Trust is enforced, not assumed.
- **Release candidates may be automated** if the binding says so: a scheduled job cuts an `-rc` tag when `main` has moved since the last tag and `main`'s push CI is green. Stable tags stay human.
- Any exception lane (for example a component that auto-deploys to production from `main` under stated conditions) must be written in the binding, in plain words, with its conditions. An undocumented lane is a defect.

## 4. Rollback safety

- Every release carries a **rollback-safe** flag, stored where the binding says (a manifest file, a release config). A migration that is not rollback-safe flips it to false for the release that carries it, and is a one-way door (`constitution.md` §3).
- Rollback is one step to the previous release, allowed only when the current release is rollback-safe.
- Two rollback-unsafe changes in one release is a smell; the supervisor splits them across releases where it can.

## 5. Artifacts

The binding keeps an **artifact inventory** table: what is built, where it is stored, how long it is kept, and what verifies it (digest, signature, boot-time check). Signing keys are named exactly once in workflow files; public halves are checked in and byte-compared by a gate.

## 6. Changelog and tags

- **The changelog is the release record** on the forge (GitHub Releases or equivalent). No hand-maintained `CHANGELOG.md` in the product repo; it would duplicate the record.
- The annotated tag's message is the notes header. The body is generated from merged PR titles since the previous tag, grouped by component label.
- **The unit of the changelog is the PR title**, which is a Law: `<node-id>: <one line a user of the product could read>`. Commit messages stay free-form; conventional-commit prefixes are not used because the node id already carries scope.
- Story-level notes: `devteam.mjs notes <from-tag> <to-tag>` groups merged nodes by the stories they serve (from the graph) into "stories completed" and "stories advanced" sections. Paste it into the release body.
- Versioning is `v<major>.<minor>.<patch>[-rcN]` (SemVer); `-rc` is the only pre-release form.
- Releases are cut on **cadence, not scope**. Scope-gated releases recreate big batches. The column plan's release map says which release a story is *expected* in; the generated notes record where it *actually* landed.

## 7. What each ring proves

- **dev:** unit, integration and end-to-end tests; the artifact build itself.
- **beta:** each node's verification notes walked against the real environment; health checks; anything that cannot run in CI (real devices, real networks) runs here before stable.
- **production:** the beta soak plus health gates the cohort rollout.

## 8. Operator checklist

The binding links the project's release runbook: how to cut, cohort order, how to roll back. This doc never restates it.
