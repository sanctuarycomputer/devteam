# Project settings

This project's answers to every decision devteam leaves open. devteam states the rule; this file states how it applies here. Each answer carries a date. Change an answer by editing it here, with a line in `decisions.md`.

## 1. Machine-readable settings

Scripts read this block. Keep it valid JSON.

```json devteam
{
  "project": "<name>",
  "tmux_session": "devteam",
  "agent_command": "claude --dangerously-skip-permissions",
  "resume_command": "claude --continue --dangerously-skip-permissions",
  "max_active_tickets": 5,
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
  "notify": null,
  "worker_denied_commands": ["gh pr merge", "git push origin main", "git push origin HEAD:main"],
  "upstream_repo": "sanctuarycomputer/devteam",
  "upstream_check_hours": 24,
  "upstream_contributions": "ask",
  "retro_every_days": 7,
  "research_every_days": 7,
  "improvement_budget_usd_per_week": null
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

What the supervisor checks on every contract stage (`ticket-lifecycle.md` §3):

- versioned; the version bumped by exactly one minor (or major for a breaking change);
- every new field has a type, a default or an explicit "required", and a test fixture;
- removal or narrowing is listed as a one-way door;
- a fake or stub that consumers can build against ships in the same commit.

## 9. Gate table (`ci.md` §8)

| Law / gate | `quality-gates.md` row | CI step | Turned on by | Mode |
|---|---|---|---|---|
| | | | | enforced / ratchet |

## 10. Known debt

Gates in ratchet mode (`process/bootstrap.md` §5.3), their recorded violation counts per component, and the chore tickets that will bring them to green:

-

## 11. Project-specific rules

Rules this project adds that devteam does not cover:

-
