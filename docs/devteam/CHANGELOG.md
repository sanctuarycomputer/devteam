# Changelog

Upstream changes, newest first. Each entry says **what** changed and **why**, so an agent folding it into a project's copy can judge whether it applies (`process/upstream-sync.md`). Entries also list **migration** steps when a project must do something.

## 0.2.0 (2026-10-31)

**What:** Restructured into `docs/devteam/` with `governance/` (rules) and `process/` (procedures). Added the entry README, constitution, review standard, quality gates, bootstrap, rigorous planning that outputs a validated work graph, item lifecycle, worker loop, question inbox, upstream sync, JSON schemas, templates, a zero-dependency `devteam.mjs` script, `spawn-node.sh`, `stop-hook.sh`, a CI job template, a sample project and a worked example binding. Removed every project-specific detail from the generic docs (moved to `examples/household-fleet/binding.md`).

**Why:** 0.1.0 was extracted from one project and still carried its services, registries, release mechanics and open defects, and it pointed at files (a per-item process doc, scripts) that didn't exist. It also assumed one agent CLI and had no runtime state, question inbox or graph. 0.2.0 makes the doctrine portable, makes the planning output machine-checkable, and gives the supervisor and workers a shared file-based state model that works with any agent CLI.

**Decisions made in this release:**
- The unit of work is the **graph node** (one PR), run by one worker session in its own worktree and tmux window. The old "one builder per service, two in flight" rule survives as the binding's `max_active_per_component` cap (default 2: one building, one in spec-ahead).
- Coordination is files plus tmux nudges, not an agent-specific messaging feature.
- Live state (`run/`) is gitignored and lives in the main checkout; durable state (graph, node folders, decisions) is tracked; stages are derived from git, never hand-maintained.

**Migration:** none (first portable release). Projects on 0.1.0 should re-bootstrap with `process/bootstrap.md` §5 (adopting into a repo that already has a process).

## 0.1.0 (2026-10-30)

Initial doctrine: code style, planning, fleet protocol, CI, deployment.
