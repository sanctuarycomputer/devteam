# devteam

Governance and process for building software with a supervised fleet of AI-agent sessions: one supervisor acting as technical PM, one worker per node of a planned work graph, adversarial review at every stage, and a merge word that only the supervisor can give.

It is meant to be **materialized** into a project, not installed: copy it in, own it, edit it. Upgrades are folded in by an agent that reads each upstream change's rationale and decides what applies.

Everything lives in [`docs/devteam/`](docs/devteam/README.md). Start there.

## Use it in a project

Point an agent at this repo and say:

> Materialize devteam into this repo following `docs/devteam/process/bootstrap.md` from github.com/sanctuarycomputer/devteam.

## Upgrade a project

A project's supervisor checks for new releases on its own loop and asks the owner which changes to take (`docs/devteam/process/upstream-sync.md`). To do it by hand:

> Check for new devteam releases and fold them in following `docs/devteam/process/upstream-sync.md`.

## Contributing upstream

Changes land on `main` through PRs. A release is a `vX.Y.Z` tag on `main` with a GitHub Release whose notes have three sections, because projects' supervisors read them to decide what to fold in:

- **What** changed, by file or area;
- **Why**, the reason a project would want it (a change without a why gets skipped);
- **Migration**, anything a project must do, such as a new binding field or a renamed flag. "None" if nothing.

```
gh release create vX.Y.Z --target main --title vX.Y.Z --notes-file notes.md
```
