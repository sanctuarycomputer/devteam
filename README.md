# devteam

A kit for running a supervised fleet of coding-agent sessions on one repo: one supervisor, one worker per ticket, superpowers as the working loop, adversarial review before every merge, and a loop that keeps improving the fleet itself. The owner states goals; the fleet turns them into a design, a roadmap, a graph of tickets, and merged code, and asks the owner only what the constitution reserves to them.

It is **materialized** into a project, not installed: copy `docs/devteam/` in, own it, edit it. Upgrades are folded in by the project's supervisor, which reads each release's rationale and asks the owner what to take.

Everything lives in [`docs/devteam/`](docs/devteam/README.md): ten files, one script, one schema, one log.

## Use it in a project

Point an agent at this repo and say:

> Set up a devteam fleet in this repo from github.com/sanctuarycomputer/devteam, following the Setup section of its `docs/devteam/README.md`.

It copies the kit from the newest release tag, runs `devteam.mjs init`, fills the settings and the architecture doc from the code, and opens chore tickets for every quality gate the repo doesn't yet enforce. The fleet's first work is its own quality floor.

## How projects improve devteam

A project's supervisor runs an OODA loop over its own fleet (`docs/devteam/process/supervisor.md`): it observes, promotes recurring observations to knowledge, runs retros, and proposes changes with evidence. When a project finds a general-purpose improvement to the kit itself, its supervisor opens a PR here (`upstream-pr` on the trust ladder), written generically, with nothing from `project/` or `run/` in it.

## Contributing upstream

Changes land on `main` through PRs. `node --test` (the kit test in `test/`) must pass. A release is a `vX.Y.Z` tag on `main` with a GitHub Release whose notes have three sections, because projects' supervisors read them to decide what to fold in:

- **What** changed, by file or area;
- **Why**, the reason a project would want it (a change without a why gets skipped);
- **Migration**, anything a project must do, such as a new settings field or a renamed flag. "None" if nothing.

```
gh release create vX.Y.Z --target main --title vX.Y.Z --notes-file notes.md
```
