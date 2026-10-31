# Example binding: a household device fleet

A filled-in `project/binding.md` from the project devteam was first extracted from: a monorepo of seven services that ship to devices in customers' homes ("households"), managed by a cloud control plane. It is here to show what a real binding looks like and to keep the specifics that the generic doctrine no longer carries. Do not copy it; fill [`../../templates/binding.md`](../../templates/binding.md) for your project.

## 1. Machine-readable settings

```json devteam
{
  "project": "household-fleet",
  "tmux_session": "devteam",
  "agent_command": "claude --dangerously-skip-permissions",
  "resume_command": "claude --continue --dangerously-skip-permissions",
  "max_active_nodes": 7,
  "max_active_per_component": 2,
  "stale_after_minutes": 30,
  "question_default_after_hours": 24,
  "main_branch": "main",
  "merge_method": "merge",
  "components": {
    "control": { "path": "control/", "stack": "rails" },
    "hub": { "path": "hub/", "stack": "rust" },
    "app": { "path": "app/", "stack": "typescript" }
  },
  "shared_resources": ["build-machine", "device-lab"],
  "dashboard_command": null,
  "notify": "push notification to the owner's phone",
  "worker_denied_commands": ["gh pr merge", "git push origin main"]
}
```

(Three of the seven components shown.)

## 2. How the generic rules were bound

- **Node ids** keep the project's existing per-service numbering, `<service>-NN-<slug>`, numbers never moved. Planning items that predate devteam were called "items" and "chunks"; columns were the owner's "pitches".
- **Contracts** live in `docs/contracts/`, each with a `Version:` line. Contract minors serialize as `item-lifecycle.md` §3 describes; the "first ready takes the lowest free minor" rule came from two contract stages colliding here.
- **Concurrency:** the original rule was two items in flight per service (one building, one in spec-ahead). An untracked note later said the owner relaxed it to three or more; it was never landed in `AGENTS.md`, which is exactly the leak `constitution.md` §4 now forbids. The binding is the only place a cap lives.
- **Shared build machine:** every session ran on one box, so heavy gates were slot-serialized (`supervisor.md` §7) and load flakes were common. Latency bars were judged by median per slice in a quiet slot.
- **Identity:** every session pushed as one GitHub identity, so GitHub PR approvals could not prove non-author review. Hence the review-record files and the `merge-word` status check (`ci.md` §3).

## 3. Release (`release.md`)

| Ring | Trigger | What deploys | Gate |
|---|---|---|---|
| dev | merge to `main` | images for each service to `registry.fly.io/fi-<svc>`, tagged `<sha>` and `main` | `check` green |
| beta | `vX.Y.Z-rcN` tag | the release workflow promotes existing images, signs `release.json`, deploys the control plane, and a background job rolls the first cohort (canary households and beta opt-ins) within about a minute | 24 h canary soak, enforced by the control plane |
| production | `vX.Y.Z` tag | same images; the stable rollout waits for a soaked rc with byte-identical digests, then rolls household cohorts in order over 48 h or more | owner halts or rolls back from the admin rollout page |

- Release actors: the owner, listed in `.github/release-actors.json`, enforced by a tag ruleset.
- `-rc` automation: proposed (a second tag ruleset letting the Actions app create `v*-rc*` only), not yet decided by the owner.
- Rollback-safe flag: `release.toml`, paired with migrations by a root gate.
- **Exception lane:** the control plane alone deploys to production from a bare merge to `main` when a stable is published, the release is rollback-safe, and the image's boot-time verify passes. Households never move this way. Pending owner confirmation that it stays automatic.

### Artifact inventory

| Artifact | Where | Retention | Verified by |
|---|---|---|---|
| service images | `registry.fly.io/fi-<svc>` | registry | image labels; boot-time verify |
| per-service digest records | Actions artifacts | 90 days | digest match at promote |
| `release.json` + `.minisig` | the GitHub Release | permanent | the plane verifies offline at boot |
| template store | baked into the control image by SHA-256 | with the image | digest |

Signing key: the `production` environment secret `RELEASE_KEY`, named once in workflows; its public half is byte-compared by a gate.

## 4. Debt found when the doctrine was first reviewed

These were live defects in this project's CI at extraction time. They are the kind of thing bootstrap's survey should find in yours.

1. `main` pushes were being cancelled by a global `cancel-in-progress: true`, so semantic conflicts could land unseen. Fixed by making cancellation PR-only.
2. The releases runbook claimed org admins could not bypass tag protection; the live ruleset let them. The doc and the config disagreed.
3. Squash merges were in use while the process said merge commits; the ruleset allowed both.
4. `strict` was off, so "clean" did not mean "up to date with main".
5. Package-manager versions differed across TypeScript services, so the dependency cooldown applied to only some of them.
6. No merge queue was available on the plan tier, so strict plus re-merge stood in for one.
