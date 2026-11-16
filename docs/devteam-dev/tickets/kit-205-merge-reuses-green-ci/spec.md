# kit-205: merge does not re-run a gate the forge's CI already ran green at the exact head

Ticket: kit-205-merge-reuses-green-ci (chore, kit, size M, risk high). Depends on kit-204-instance-papercuts (build waits for its merge).

## Why

An instance (mothership, k-20261114-223255134) runs a 40-minute suite as a settings gate, and the same suite as its GitHub CI. `merge` already refuses while any forge check at the head is pending or failing, so by the time it runs gates the suite has passed at that exact commit, and `merge` runs it again locally for 40 minutes. The owner should be able to say, per gate, "the forge's CI runs this", and `merge` should then trust a complete, green CI result at the exact head instead of re-running it, while never skipping anything the owner did not declare.

## How merge works today (what this changes)

`cmdMerge` (`docs/devteam/scripts/devteam.mjs`, ~L4937):

1. `gh pr view <branch> --json number,headRefOid,…,statusCheckRollup`; `sha = headRefOid`.
2. Every rollup entry not in `settings.ignored_checks` must be complete and SUCCESS / NEUTRAL / SKIPPED, else `fails` (pending: "still running"; else "failed").
3. If nothing failed, for a ticket or plan PR (never a chore, never `--no-gates`), every gate in `S.gates` that applies (its `paths`) runs at `sha` in a detached worktree; each run logs a `gate` line; a failing one fails the merge (ratchet: re-run at the base).
4. `gh pr merge --match-head-commit sha` (or, forge `git`, a push of the exact sha), then a `merge-word` / `approve-feature-plan` act.

## The change

A gate in `settings.gates` (home's, or a repo link's `links.<r>.gates`) may carry **`covered_by`**:

- `"covered_by": "ci"`: covered by every check the forge reports at the head; every one must be SUCCESS.
- `"covered_by": ["test (node 22)", "lint"]`: covered by these named checks (a non-empty list of check names, as the rollup names them: a CheckRun's `name` or a StatusContext's `context`). Recommended in quality.md: it catches a check that never reported, which `"ci"` can't (F1-1).

At step 3, for an applicable gate with `covered_by`, before running it, `merge` decides whether the forge has covered it:

1. Forge `git` (no forge checks): not covered; the gate runs, and merge says why.
2. The PR changes the forge's CI configuration (any file under `.github/` between the merge base and `sha`): not covered; the gate runs, and merge says why. On GitHub a `pull_request` workflow runs the workflow files of the PR itself, so a PR that renames the covering job, adds a `paths:` filter or changes the job's command would otherwise define the very CI that excuses the owner's gate (F1-2; R1). `.github/` is the only forge config the kit reads checks from (forge `github`).
3. It re-reads the PR by number (`gh pr view <pr.number> --json headRefOid,statusCheckRollup`), once per merge, right before the gate loop. If that call fails or its output doesn't parse, or its `headRefOid` is not `sha` (the head moved), no gate is covered: each runs as today and merge says why.
4. On that fresh rollup, each entry is read by one helper shared with today's pending/failing check, so the two reads can't drift (F1-5): an entry with `state` or `__typename` StatusContext is judged by `state`; a CheckRun is complete only when `status` is COMPLETED and is then judged by `conclusion`; both uppercased; anything else is pending.
   - `"ci"`: covered when the rollup is non-empty and **every** entry (ignored_checks included: an ignored check is never coverage, and a failing one is not green) is SUCCESS. A SKIPPED or NEUTRAL entry means not covered: a suite skipped by a job `if:` beside a green lint job did not run (F1-1).
   - a list: covered when each named check has at least one entry, and **every** entry with that name is complete and SUCCESS (NEUTRAL or SKIPPED did not run the suite, so they are not coverage). A name missing from the rollup → not covered.
   - Any pending, failed, missing or wrong-state check → not covered: the gate runs as today, and merge says which check stopped it.
5. A `covered_by` value of any other shape (not `"ci"`, not a non-empty list of non-empty strings): not covered, the gate runs, and merge warns that the value is not understood.
6. Covered: the gate does not run. merge prints `gate <name> not run here: the forge's checks ran it green at <sha12> (<check names>)`; no `gate` line is written (no run happened: a fake pass would skew the gate's metrics); the merge act's `what` ends with `; gate <name> covered by the forge's checks at <full sha> (<check names>)` for each covered gate, so the record says what was trusted.

Everything else is unchanged: `paths` still decides whether a gate applies (an inapplicable gate is not "covered", it's not applicable, as today); ratchet applies to a gate that runs; `--no-gates`, chores, `gate`, `gate --all` and workers' gates ignore `covered_by` (a worker's own gate run is the evidence for verification.md, not the merge's).

### Who may set it

`covered_by` is a field of a gate, and gates are owner settings (`gate-change`):

- Adding `covered_by` to an existing gate changes that gate: `gateAdditions` already reports "it changes <gate>", so it needs the owner's `--approved <gate-change qid>`.
- A supervisor's own new gate (`merge --chore`, GATE_ADD_FIELDS = cmd, paths, junit, mode) can't carry `covered_by`: `newGateProblem` already refuses any other field. `GATE_ADD_FIELDS` stays as it is.

Both are pinned by tests, so a later change can't quietly let the supervisor declare coverage.

## Acceptance checks (the done-whens)

| # | Done-when | Check |
|---|---|---|
| D1 | A gate declaring `covered_by` is skipped by merge when every required forge check at the exact head is complete and green, and merge says so in its output and act | test: `covered_by: "ci"` and a list, all green at the head → the gate's command does not run (a marker file is not written), output names the gate, sha and checks, no `gate` line for it, the merge act's `what` names it. The vehicle is a real (not dry) ticket merge in `test/kit.test.mjs`: a sibling-repo ticket on a `multiFixture`, as `multirepo-landing.test.mjs` merges `console-01-a`, with a fake gh (chores never run gates) (F1-4) |
| D2 | With any check pending, failed or missing, or the head moved, the gate runs as today | tests, one per case: pending; failed; a named check missing; an empty rollup for `"ci"`; SUCCESS plus SKIPPED for `"ci"`; a NEUTRAL entry for a named check; a named check twice, one failed; an ignored_checks entry failing under `"ci"`; the PR changes a file under `.github/`; the re-read shows another headRefOid; the re-read fails; forge `git` → the gate's marker is written and a `gate` line logged. Today's merge already refuses a non-ignored pending or failed check at its first read, so the pending and failed cases are a green first read and a re-read that differs (a fake gh answering the second `pr view` otherwise) (F1-4) |
| D3 | No gate skipped without the declaration; a gate the owner set stays the owner's to change | tests: a gate without `covered_by`, all checks green → it runs; a bad `covered_by` value → it runs, with a warning; a chore adding `covered_by` to an existing gate is refused without a gate-change answer; a chore adding a new gate with `covered_by` is refused as a supervisor gate-add |
| D4 | test.yml passes on every job; no file is added | CI at the head, conclusion read with `gh run view`; `git diff --name-status origin/main` shows only M lines (records under this ticket's folder aside) |

## Contracts

- Provided: the settings field `gates.<name>.covered_by` (`"ci"` or a list of check names), read only by `merge`. Additive; settings without it behave exactly as today.
- Consumed: `gh pr view --json headRefOid,statusCheckRollup` (already consumed by merge); its entries' `__typename`, `name` / `context`, `status`, `conclusion`, `state`.
- No log schema change: the record is the act's `what` text; no new field.

## Edge cases

- `gh`'s rollup could be cut short on a PR with very many checks. A list stays safe (a cut name is missing); `"ci"` could miss a failing entry. Projects with many checks should use the list form; quality.md says to prefer it (F1-6).
- `show release` lists the gates merge ran from `gate` lines; a covered gate is not among them, since it didn't run here. The act's `what` names it; the view is unchanged (F1-7).

- Several checks with one name (a re-run): every entry with the name must be SUCCESS; one old failed attempt beside a new green one can't be told apart by the rollup, so it isn't covered (safe side: run the gate). Note: GitHub's rollup normally shows only the latest attempt.
- A covered gate with `paths` that doesn't apply: listed as not applicable, as today.
- A gate written as a plain string can't carry `covered_by` (only the object form); nothing to handle.
- A repo link's gates: the same logic; `R.gh` already targets that repo.
- `--dry-run`: decides coverage the same way and prints it (no act).
- Only one re-read per merge; checks moving between that read and `gh pr merge` are bounded by `--match-head-commit` (head) and by step 2 of today's merge (state at first read).

## Out of scope / not defended against

- A forge that reports green for a run it didn't do (ticket notes).
- Under `"ci"`, a check that never reported at all (a path-filtered workflow that didn't trigger, a check suite not registered yet): `"ci"` can't see an absence; the list form can (F1-1).
- Asking the forge for branch protection's required checks (admin-only API on GitHub); the owner names the checks instead.
- Changing `gate`, `gate --all`, check-pr or check-ticket.

## Docs

- `governance/quality.md` §2 gets a short paragraph after **Modes** (m-20261115-204545585): `covered_by` is trust in a check at the exact head sha, never at an earlier one, and the gate still runs when a check is missing, failed or pending; the list form is preferred.
- Three lines say merge runs every gate and become false for a covered gate (F1-3): quality.md L24 and L121, and process/supervisor.md L127. Each gets a clause ("except a gate `covered_by` the forge's green checks at that exact head"). Asked as m-20261115-204658302 (supervisor.md into touches; the quality.md grant to cover those two lines).

## Rulings

- m-20261115-204545585-supervisor: quality.md is in touches, for the covered_by sentences only; they say covered_by is trust in a check at the exact head sha, never an earlier one, and the gate still runs when the check is missing, failed or pending.
- m-20261115-203723494-supervisor: plan ahead; spec and plan now; build only after kit-204 merges and approve-plan is recorded; briefs carry k-20261115-182656232, k-20261115-080753394, k-20261115-164245020 and the scripts-in-files rule; run only touched test files at --test-concurrency=2.
