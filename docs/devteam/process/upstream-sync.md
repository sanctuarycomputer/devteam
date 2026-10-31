# Upstream sync

How a project keeps up with upstream devteam. The project owns its copy and has probably edited it, so folding in a release is a judgment, not a mechanical merge. The supervisor notices new releases on its own loop, asks the owner what to take through the question inbox, and lands the answer as a PR.

## 1. Where upstream lives

- The binding's `upstream_repo` names the upstream repository (default `sanctuarycomputer/devteam`).
- Upstream publishes **GitHub Releases** on tags `vX.Y.Z`. Each release's notes have three sections: **What** changed, **Why**, and **Migration** (what a project must do, if anything). The why is what a project judges against.
- `project/upstream-log.md` records every upstream release this project has considered and what it decided. The newest release in the log is the project's **base**. Bootstrap writes the first row: the release it materialized from.

## 2. Checking for releases (supervisor loop)

At most once every `upstream_check_hours` (binding; default 24), on a quiet tick:

1. List releases newer than the base: `gh release list -R <upstream_repo>`.
2. For each, oldest first, read its notes: `gh release view <tag> -R <upstream_repo>`.
3. For each change in the notes, check whether this project has edited the same files: read the dated lines in `project/decisions.md` (`constitution.md` §4 requires every local edit to `governance/` or `process/` to be logged there) and diff the local files against upstream at the base tag.
4. Ask the owner **one question per release**, kind `owner-decision`, with no default. List each change with what it does, its why, whether it overlaps a local edit, and your recommendation: **adopt** (take it as is), **adapt** (take the improvement but keep the local intent), or **skip** (with the reason it doesn't apply here).

Don't re-ask about a release that already has a question open or a row in the log.

## 3. Folding in (after the owner answers)

1. Fetch upstream at the base tag and at the target tag into a scratch folder outside the repo (`git clone --depth 1 --branch <tag>`).
2. For each file under `governance/`, `process/`, `templates/`, `schema/`, `scripts/` and `README.md`:
   - **upstream diff**: base → target;
   - **local diff**: base → the project's current file.
3. Apply each change as the owner answered:
   - **adopt** where the local file is unchanged in that region;
   - **adapt** where the project edited the same region: keep the local intent, bring in the upstream improvement;
   - **skip** otherwise;
   - **removed upstream**: if the project relies on it, keep it locally and say so.
4. Never touch `project/` or `run/`. If a change needs a binding field that doesn't exist, add it to `binding.md` with a placeholder and ask the owner to fill it.
5. Run `devteam.mjs validate`.
6. Open one PR, `chore-devteam-sync-<tag>`, with the changes and one row per release in `project/upstream-log.md`: the tag, the outcome per change, and the question id. The PR is `risk: high` if it changes `governance/`: two independent reviews.

If the owner skips a whole release, still add its row to the log, so the base moves forward and the release isn't offered again.

## 4. Upstream's side of the bargain

Every upstream release is a tag on `main` with a GitHub Release whose notes follow the What / Why / Migration shape. A change without a why can't be judged; the supervisor recommends `skip: no rationale` and says so in the question.
