# devteam

Governance and process for building software with a supervised fleet of AI-agent sessions: one supervisor acting as technical PM, one worker per node of a planned work graph, adversarial review at every stage, and a merge word that only the supervisor can give.

It is meant to be **materialized** into a project, not installed: copy it in, own it, edit it. Upgrades are folded in by an agent that reads each upstream change's rationale and decides what applies.

Everything lives in [`docs/devteam/`](docs/devteam/README.md). Start there.

## Use it in a project

Point an agent at this repo and say:

> Materialize devteam into this repo following `docs/devteam/process/bootstrap.md` from github.com/sanctuarycomputer/devteam.

## Upgrade a project

> Fold in the latest devteam release following `docs/devteam/process/upstream-sync.md`.

## Contributing upstream

Every change needs a `docs/devteam/CHANGELOG.md` entry with a **why**, and a bump to `docs/devteam/VERSION`. Run `node docs/devteam/scripts/devteam.mjs validate --project docs/devteam/examples/sample-project` before opening a PR.
