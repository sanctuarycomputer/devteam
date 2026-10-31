# Upstream sync

How a project folds in a new upstream devteam release. The project owns its copy and has probably edited it. So sync is an agent's judgment, not a mechanical merge: for each upstream change, decide whether to adopt it, adapt it to local edits, or skip it, and say why.

## 1. What you need

- `docs/devteam/VERSION`: the upstream release this copy came from (the **base**).
- The new upstream release (the **target**), fetched from the upstream repo at its tag.
- Upstream `CHANGELOG.md` entries between base and target. Each entry has a **why**; that is what you judge against.
- `project/decisions.md`: local edits to `governance/` and `process/` are recorded there with reasons (`constitution.md` §4).

## 2. Procedure

1. Fetch upstream at base and at target into a scratch folder outside the repo.
2. For each file under `governance/`, `process/`, `templates/`, `schema/`, `scripts/`, `examples/` and the root `README.md`:
   - **upstream diff** = base → target;
   - **local diff** = base → the project's current file.
3. Classify each upstream hunk:
   - **clean**: local file unchanged in that region. Adopt unless the changelog's why does not apply to this project.
   - **overlap**: the project edited the same region. Read the local reason in `decisions.md` and the upstream why. Adapt: keep the local intent and bring in the upstream improvement, or skip with a reason.
   - **removed upstream**: if the project relies on it, keep it locally and record that.
4. Never touch `project/` or `run/`. If an upstream change needs a binding field that doesn't exist, add the field to `binding.md` with a placeholder and raise an owner question.
5. Run `devteam.mjs validate` and the test suite of any changed script.
6. Open one PR, `chore-devteam-sync-<target>`, containing the changes, the bumped `VERSION`, and new lines in `project/upstream-log.md`: one per changelog entry, with `adopted`, `adapted` or `skipped` and a one-line reason.
7. The PR is `risk: high` if it changes `governance/`: two independent reviews, and the owner is asked to approve.

## 3. Upstream's side of the bargain

Every upstream change gets a `CHANGELOG.md` entry with: version, date, files touched, **what** changed, **why**, and **migration** notes if a project must do something (a new binding field, a renamed script flag). A change without a why cannot be judged; treat it as `skipped: no rationale` and tell upstream.
