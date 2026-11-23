# Project docs

The documents every project keeps about itself, so a person or an agent new to it can set it up, change it and recover it without asking. The kit's own documents (designs, specs, plans, reviews) are `quality.md` §6; these are the project's.

Law and Doctrine mean what they mean in `code-style.md` §0; a Law is enforced once its gate is commissioned (the gate table below counts as rows of `quality.md` §2), and review holds it until then.

- **`L-DOCS-1` the README is the runbook.** It has five sections, in this order: **Set up** (from a fresh clone: the toolchain from `.tool-versions`, the decryption key for development, the seeds), **Run**, **Test**, **Deploy** (how a release reaches production, `operations.md` §2) and **Restore** (how to restore production's database from point-in-time recovery and from the off-site copy, the RPO and RTO the project holds, and the date of the last drill, `operations.md` §3). Each step is a command someone can paste. A change that breaks a step fixes the README in the same PR. Gate, where feasible: a CI job runs the Set up and Test commands on a fresh runner, and `settings.gates` lists it as a `runbook` gate `covered_by` that job (`quality.md` §2). Deploy and Restore touch production, so CI never runs them: the restore drill exercises Restore (`L-RECOV-3`), and review holds Deploy.
- **`L-DOCS-2` decisions are ADRs.** A decision that outlives one design is an ADR at `project/designs/adr/<n>-<slug>.md`, with four sections: **Context**, **Decision**, **Consequences**, **Supersedes** (the ADR it replaces, or none). It is numbered in order, short, and never edited once landed: a changed decision is a new ADR that supersedes it. An ADR records a decision; it never authorises one. Review-enforced.
- **`L-DOCS-3` every HTTP API has a generated OpenAPI reference.** An HTTP API is any route that answers JSON (or another data format) to a client: another app, a party outside, or the project's own mobile or browser client. Routes that render the app's own pages (Hotwire, server actions) aren't. It is generated from the code that serves the API (the route schemas, through the stack's OpenAPI generator), never written by hand, and lists each error response (each Problem Details `type`, where the API answers with them). It is committed (the app may serve it too, at `/openapi.json`). Gate: CI regenerates it and fails when it differs from the committed file (test gate).
- **`L-DOCS-4` a current architecture diagram.** `project/designs/architecture.md` §1 opens with a Mermaid diagram (`quality.md` §6) of the components and what each talks to: the apps, the database, the job runner, and each vendor. Every plan PR that changes a component, a connection or a vendor updates it, as it updates the rest of the file. Review-enforced: the graph reviewer checks it with the rest of `architecture.md`.

## Gates

| Gate | Fails on | Law |
|---|---|---|
| runbook | the README's Set up or Test commands failing on a clean runner | `L-DOCS-1` |
| test | a generated OpenAPI reference that differs from the committed one | `L-DOCS-3` |
