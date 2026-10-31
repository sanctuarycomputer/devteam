# Changelog

Upstream changes, newest first. Each entry says **what** changed and **why**, so an agent folding it into a project's copy can judge whether it applies (`process/upstream-sync.md`). Entries also list **migration** steps when a project must do something.

## 0.2.0 (2026-10-31)

**What:** Restructured into `docs/devteam/` with `governance/` (rules) and `process/` (procedures). Added the entry README, constitution, review standard, quality gates, bootstrap, rigorous planning that outputs a validated work graph, item lifecycle, worker loop, question inbox, upstream sync, JSON schemas, templates, a zero-dependency `devteam.mjs` script, `spawn-node.sh`, `stop-hook.sh`, a CI job template, a sample project and a worked example binding. Removed every project-specific detail from the generic docs (moved to `examples/household-fleet/binding.md`).

**Why:** 0.1.0 was extracted from one project and still carried its services, registries, release mechanics and open defects, and it pointed at files (a per-item process doc, scripts) that didn't exist. It also assumed one agent CLI and had no runtime state, question inbox or graph. 0.2.0 makes the doctrine portable, makes the planning output machine-checkable, and gives the supervisor and workers a shared file-based state model that works with any agent CLI.

**Decisions made in this release:**
- The unit of work is the **graph node** (one PR), run by one worker session in its own worktree and tmux window. The old "one builder per service, two in flight" rule survives as the binding's `max_active_per_component` cap (default 2: one building, one in spec-ahead).
- Coordination is files plus tmux nudges, not an agent-specific messaging feature.
- Live state (`run/`) is gitignored and lives in the main checkout; durable state (graph, node folders, decisions) is tracked; stages are derived from git, never hand-maintained.
- **Only the supervisor merges.** Under one shared GitHub identity no check can prove the merge word was given, so the act of merging is the word. The required `merge-word` CI check (`devteam.mjs check-pr`) mechanizes everything else: approved spec and plan, verification rows, final reviews holding at the exact head, dispositioned findings, footprint inside `touches`, PR title, and the one-way-doors section.
- **A review verdict holds across review-record commits.** Committing a review record moves the head, so a verdict at commit V holds at head H when the only changes since V are review records.
- Node artefacts live on the node's branch until merge; `status` and `check-node` read them from git, so the supervisor sees from the main checkout what the worker sees in its worktree.
- Design and graph reviews live at `project/reviews/<column>/`; chore and spike nodes outside any column plan use the reserved column `chores`.
- Adopting into an existing codebase (`process/bootstrap.md` §5): a baseline doc, accounting for work in flight, ratchet-mode gates, and starting with a narrow fleet.

**Migration:** none (first portable release). Projects on 0.1.0 should re-bootstrap with `process/bootstrap.md` §5 (adopting into a repo that already has a process).

## 0.1.0 (2026-10-30)

Initial doctrine: code style, planning, fleet protocol, CI, deployment.
