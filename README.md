# devteam — workflow doctrine

Portable engineering and workflow doctrine for building software with a fleet of AI-agent sessions (and humans), across any stack. These guides are written to **remove choices** — so a builder rarely faces a hard judgment call — and are intended to be referenced from a project's root `AGENTS.md`/`CLAUDE.md`.

| Guide | What it governs |
|---|---|
| [`code-style.md`](./code-style.md) | Generic code & system doctrine — functional core / MVC, result-value error model, persistence tiers, PII, security, testing. Law (gate-enforced) vs Doctrine (review-enforced), rule IDs, an escape hatch, and a day-one-floor table. |
| [`planning.md`](./planning.md) | Setting up and breaking down a **column** of features — entry criteria, chunking, landing numbered items, user stories, cadence releases, and derived stage-tracking. |
| [`fleet-code-generation-protocol.md`](./fleet-code-generation-protocol.md) | How a PM/CTO session coordinates a fleet of builder sessions — roles, the SDD gates, adversarial reviews, the merge word, gate-slot discipline, and recovery. |
| [`ci.md`](./ci.md) | Continuous integration — the pipeline, merge-safety configuration, `main`-after-merge rules, and changing CI itself. Ends at a green `main`. |
| [`deployment.md`](./deployment.md) | Delivery & deployment — the promotion rings, tags-not-branches, the owner gate, rollback safety, artifacts, changelogs, and soak cycles. Begins at a green `main`. |

Each guide states its rules and **points at** the project's own enforcing config (linters, CI, branch protection) rather than restating it: where a guide and a config disagree, the config is the source of truth and the guide is a bug.
