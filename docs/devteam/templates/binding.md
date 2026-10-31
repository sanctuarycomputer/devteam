# Project binding

This project's answers to every decision devteam leaves open. Doctrine states the rule; this file states the assignment. Each answer carries a date. Change an answer by editing it here, with a line in `decisions.md`.

## 1. Machine-readable settings

Scripts read this block. Keep it valid JSON.

```json devteam
{
  "project": "<name>",
  "tmux_session": "devteam",
  "agent_command": "claude --dangerously-skip-permissions",
  "resume_command": "claude --continue --dangerously-skip-permissions",
  "max_active_nodes": 5,
  "max_active_per_component": 2,
  "stale_after_minutes": 30,
  "question_default_after_hours": 24,
  "main_branch": "main",
  "merge_method": "merge",
  "components": {
    "<component>": { "path": "<dir>/", "stack": "<typescript|rails|python|go|rust|...>" }
  },
  "shared_resources": [],
  "dashboard_command": null,
  "notify": null
}
```

## 2. Components

| Component | Path | Stack | Owner notes |
|---|---|---|---|
| | | | |

## 3. Persistence tiers (`code-style.md` §4)

| Domain | Tier | Reason | Date |
|---|---|---|---|
| | | | |

Soft-delete mechanism: <`deleted_at` column | `deleted_records` table>.

## 4. Critical operations (`code-style.md` §7)

State transitions that need an idempotency key rather than a conditional write:

-

## 5. PII (`code-style.md` §11)

- PII registry file: <path>
- Erasure mechanism: <crypto-shred | vault + tokens>
- Retention windows: <log> <days>, …

## 6. One-way doors specific to this project

In addition to `constitution.md` §3:

-

## 7. Release (`release.md`)

- Rings: <dev, beta, production>; environments: <names>
- Beta soak: <24 h>
- Release actors (may push `v*` tags): <people>
- `-rc` tags automated: <yes | no>
- Rollback-safe flag lives in: <file>
- Exception lanes: <none | describe with conditions>
- Release runbook: <link>

### Artifact inventory

| Artifact | Where | Retention | Verified by |
|---|---|---|---|
| | | | |

## 8. Contract checklist

What the supervisor checks on every contract stage (`item-lifecycle.md` §3):

- versioned; the version bumped by exactly one minor (or major for a breaking change);
- every new field has a type, a default or an explicit "required", and a test fixture;
- removal or narrowing is listed as a one-way door;
- a fake or stub that consumers can build against ships in the same commit.

## 9. Commissioning table (`ci.md` §8)

| Law / gate | `quality-gates.md` row | CI step | Commissioned by | Mode |
|---|---|---|---|---|
| | | | | enforced / report-only |

## 10. Known debt

Gates in report-only mode and the chore nodes that will bring them to green:

-

## 11. Project-specific rules

Rules this project adds that devteam does not cover:

-
