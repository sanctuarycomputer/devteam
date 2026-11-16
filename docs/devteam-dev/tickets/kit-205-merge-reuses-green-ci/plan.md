# kit-205 merge reuses green CI: implementation plan

## TL;DR

- Code changes only in `docs/devteam/scripts/devteam.mjs`; tests go in `test/kit.test.mjs` as standalone `test(…)` blocks (no new file); docs get a `covered_by` paragraph in quality.md §2 and a clause on the three lines (quality.md L24, L121, supervisor.md L127) that say merge runs every gate.
- The forge-check state reading inside `cmdMerge` moves into `rollupState(c)`, used by today's pending/failing check and by the new `forgeCoverage(coveredBy, rollup, ignored)`, which says whether a gate's `covered_by` ("ci" or a list of check names) is met by a rollup, and if not, why.
- Right before the gate loop, when an applicable gate declares `covered_by`, merge re-reads the PR once, by number (`gh pr view <n> --json headRefOid,statusCheckRollup`). Forge `git`, no PR number, a PR whose changes can't be listed or that changes `.github/`, a failed read and a moved head each cover nothing. Under `"ci"` every check must be SUCCESS. A covered gate is not run, writes no `gate` line, is printed, and is named in the merge act's `what`; any other gate runs exactly as today.
- Tests drive real and `--dry-run` merges of a sibling-repo ticket (the `multiFixture` pattern) with a fake `gh` that serves successive `pr view` answers by call order; the gate's command touches a marker file, so "ran" vs "not run" is a file check, and gate lines are counted before and after.
- D3's owner rules are pinned by tests on existing code (a chore adding `covered_by` to a gate needs a gate-change answer; a supervisor gate-add can't carry it); `GATE_ADD_FIELDS` is not touched.
- Order: T1 helpers, merge wiring and its tests; T2 the owner-rule tests and the docs. Built only after kit-204 merges and approve-plan is recorded.
- Risk: a gate skipped on a misread. Every state the helper doesn't know reads as pending, every failure to read or list fails closed, and tests cover each case; today's first-read refusal is pinned by a new test, since the chain's own step doesn't run on the box.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `merge` trusts a complete, green forge check at the exact head for a gate the owner declared `covered_by`, instead of re-running it, and runs every other gate as today.

**Architecture:** two pure helpers beside `cmdMerge` plus a once-per-merge PR re-read before the gate loop; the record is merge's output and the act's `what`.

**Tech stack:** Node ESM, `node:test`; the kit's fixtures in `test/lib/kit.mjs`.

**Spec:** `docs/devteam-dev/tickets/kit-205-merge-reuses-green-ci/spec.md` (approved by spec-2 at 1264243).

## Rulings

- m-20261115-203723494-supervisor: plan ahead (spec and plan now); build only after kit-204 merges and approve-plan is recorded; every brief carries k-20261115-182656232, k-20261115-080753394, k-20261115-164245020 and the scripts-in-files rule; only the touched files run, at `--test-concurrency=2`.
- m-20261115-204545585-supervisor (re m-20261115-204302985): quality.md is in touches for the covered_by sentences only; they say covered_by is trust in a check at the exact head sha, never an earlier one, and the gate still runs when a check is missing, failed or pending.
- m-20261115-204936899-supervisor (re m-20261115-204658302): supervisor.md is in touches for the L127 clause, and the quality.md grant covers the L24 and L121 clauses too. kit-69 now follows this ticket.
- m-20261115-211653291-supervisor: a subagent's unguarded `rm -f "$S"/*.txt` was refused. Every brief says: write multi-step shell as a script file and run it; guard every variable path, `rm -f` included, as `"${S:?}"/…`; never rm a path read from a file or a command substitution.

## Global constraints

- Files outside this folder: `docs/devteam/scripts/devteam.mjs`, `test/kit.test.mjs`, `docs/devteam/governance/quality.md` (the covered_by paragraph and the L24/L121 clauses), `docs/devteam/process/supervisor.md` (the L127 clause). No file added.
- On the box: run only `test/kit.test.mjs` filtered to this ticket's tests through `run-tests.sh` in this folder (`--test-name-pattern=covered_by`, own HOME via `mktemp -d`, `DEVTEAM_HUB_PORT=4791`, every `DEVTEAM_*` unset, `nice`, `timeout 900`, `--test-concurrency=2`), judged by its exit code, never through a pipe. Other merge test files run one at a time through the same script. `test.yml` on GitHub is the gate; its conclusion is read with `gh run view`.
- On the box's Node (18), a name pattern skips the whole `devteam kit` chain (its parent name doesn't match), so chain steps never run here: CI is their only evidence.
- Every test name this ticket adds contains `covered_by`; no existing test name does.
- No log schema change, no new settings key other than the gate field.

## Review focus

1. Rollup entries of unexpected shape: a CheckRun `COMPLETED` with `conclusion: null`, a CheckRun with no `status`: read as pending (not covered). A StatusContext with lowercase `state: 'success'`: uppercased as today, so green. Pinned in T1 test 3's table, through the fresh read.
2. A list `covered_by` naming a check that appears twice, once failed: not covered. Pinned in T1 test 3 (green first read, fresh read with both).
3. A gate with `covered_by` and `paths` that doesn't apply: reported not applicable, never "covered". Pinned in T1 test 9.
4. `--no-gates`: no re-read (T1 test 10). Chore merges never reach the gate block (`!chore` in its condition, unchanged), so no test is added for them.
5. A ratchet gate with `covered_by` whose checks aren't green: runs, and ratchet still applies; that path is today's code unchanged, covered by existing ratchet tests in CI.

---

### Task 1: coverage helpers and merge wiring

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs` (beside `cmdMerge`, ~L4930-5175)
- Test: `test/kit.test.mjs` (appended)

**Interfaces (produces):**
- `rollupState(c) -> { name: string, state: string }`: `name` is `c.name ?? c.context ?? '?'`; `state` uppercased: an entry with `__typename === 'StatusContext'` or a `state` is judged by `state`; a CheckRun by `conclusion` when `status === 'COMPLETED'`, else `'PENDING'`; an empty result (`''`, null conclusion) is `'PENDING'`. Today's pending/failing loop uses it; its behaviour is unchanged (today's loop already lists `''` as pending).
- `forgeCoverage(coveredBy, rollup, ignored) -> { covered: true, checks: string[] } | { covered: false, why: string, bad?: true }`:
  - `bad: true` when `coveredBy` is not `'ci'` and not a non-empty array of non-empty strings (why: `covered_by is not "ci" or a list of check names`).
  - `'ci'`: not covered if `rollup` is empty (`the forge reports no checks`); if any entry (ignored ones included) is not `SUCCESS` (`<name> is <state lowercased>`). Else covered; `checks` = every entry's name, rollup order, no repeats.
  - list: for each name in order: no entry → `<name> is missing`; any entry with that name not `SUCCESS` → `<name> is <state lowercased>`. Else covered; `checks` = the list.
  - When the entry that stops coverage is in `ignored`, the why ends ` (ignored_checks never counts as coverage)`.
  - The first entry or name that stops coverage gives the why.

- [ ] **Step 1: write the failing tests** in `test/kit.test.mjs`:
  - `coveredFixture(name, gate)`: `multiFixture(name)`; console's origin set to `https://github.com/usbclub/console.git` with `insteadOf` to the bare repo (as in `multirepo-views.test.mjs` "a github-forge sibling"); a `setGate(gate, extra = {})` that runs `F.lines(…, { links: { …console, remote: 'usbclub/console', forge: 'github', gates: { test: gate }, ...extra } })` (committed and pushed by `lines`), where `gate` defaults to `{ cmd: "touch '<base>/ran-test'", covered_by: 'ci' }`; lands ticket `console-01-a` (touches `src/**`, `.github/**` only when asked) as `land()` does in `multirepo-landing.test.mjs`: spec, plan, verification, a final review, approve-spec/approve-plan acts. Returns `{ F, sha, setGate, ran, gateLines, gh }` with `ran()` = marker exists, `gateLines()` = count of `gate` log lines with `gate === 'test'` and this sha.
  - `gh(views)`: (re)writes the fake `gh` on PATH and **resets** its counter, its call log and the marker. `pr view` serves `view-1.json`, `view-2.json`, … by call order (the last repeats; a view `'fail'` exits 1); every call is logged; `pr merge` exits 0. A view is `{ number: 7, headRefOid, title: 'console-01-a: work', body: '## One-way doors\n\nNone.\n', isDraft: false, mergeStateStatus: 'CLEAN', url, statusCheckRollup }`. Entry builders: `run(n)` (CheckRun COMPLETED SUCCESS), `pending(n)`, `failed(n)`, `skipped(n)`, `neutral(n)`, `status(n, state)` (StatusContext). Log assertions match by regex (sibling gh calls end in `-R usbclub/console`).
  - Tests (each name contains `covered_by`):
    1. `merge covered_by "ci": every check green at the head, the gate is not run, and merge says so in its output and act` — views `[run('test'), run('lint')]` twice; real merge, exit 0; `ran()` false; `gateLines()` 0; output matches `/gate test not run here: the forge's checks ran it green at \w{12} \(test, lint\)/`; the `merge-word` act's `what` contains `` `gate test covered by the forge's checks at ${sha} (test, lint)` ``; the second logged `pr view` matches `/^pr view 7 --json headRefOid,statusCheckRollup/`.
    2. `merge covered_by a list: the named checks green, the gate is not run, and the act names them` — own fixture, gate `covered_by: ['test']`, rollup `[run('test'), status('deploy', 'SUCCESS')]`; real merge; `ran()` false; act `what` contains `(test)`.
    3. `merge covered_by: a pending, failed, missing, neutral or skipped check, or an ignored one failing, runs the gate as today` — one fixture; per row: `setGate(...)`, `gh([first, fresh])`, `before = gateLines()`, `--dry-run`; expect `ran()` true, output `/gate test runs here: /` plus the why, `gateLines() === before + 1`. Rows `[covered_by, first, fresh, why]`, green = `[run('test')]`:
       - `'ci'`, green, `[run('test'), pending('lint')]`, `/lint is pending/`
       - `['test']`, green, `[failed('test')]`, `/test is failure/`
       - `['test', 'e2e']`, green, green, `/e2e is missing/`
       - `'ci'`, `[]`, `[]`, `/the forge reports no checks/`
       - `'ci'`, `[run('lint'), skipped('test')]`, same, `/test is skipped/`
       - `['test']`, `[neutral('test')]`, same, `/test is neutral/`
       - `['test']`, green, `[run('test'), failed('test')]`, `/test is failure/` (review focus 2)
       - `['test']`, green, `[{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: null }]`, `/test is pending/`
       - `['test']`, green, `[{ __typename: 'CheckRun', name: 'test' }]`, `/test is pending/`
       - `'ci'` with `ignored_checks: ['flaky']`, `[run('test'), failed('flaky')]`, same, `/flaky is failure \(ignored_checks never counts as coverage\)/`
       - and one covered row: `['test']`, green, `[{ __typename: 'StatusContext', context: 'test', state: 'success' }]` → `ran()` false, `/not run here/` (lowercase state is uppercased, as today).
    4. `merge covered_by: a PR that changes the forge's CI configuration runs the gate` — the ticket also changes `.github/workflows/test.yml` (touches include `.github/**`); green views; `--dry-run`; `ran()` true; `gateLines()` +1; output `/the PR changes the forge's CI configuration \(\.github\/workflows\/test\.yml\)/`; the gh log has one `pr view` (no re-read needed).
    5. `merge covered_by: the head moved since merge read the PR, so the gate runs` — view-2's `headRefOid` another sha; `ran()` true; `gateLines()` +1; `/the head moved to \w{12}/`.
    6. `merge covered_by: the PR can't be read again, so the gate runs` — view-2 `'fail'`; `ran()` true; `gateLines()` +1; `/could not read the PR's checks again/`.
    7. `merge covered_by on a forge "git" repo: no checks to read, the gate runs` — console `forge: 'git'`, `run/pr/ticket/console-01-a.md` written; `ran()` true; `gateLines()` +1; `/forge is git: no checks to read/`; no `pr view` in the gh log.
    8. `merge without covered_by runs the gate though every check is green` — gate `{ cmd }` only, green views; `ran()` true; exactly one `pr view` in the log.
    9. `merge covered_by of a shape it doesn't know runs the gate and warns` — `covered_by: 'yes'`, then `[]`, then (with forge `git`) `'yes'` again; each: `ran()` true, `/covered_by is not "ci" or a list of check names/` in out or err.
    10. `merge covered_by with paths that don't match: not applicable, never covered` — gate `{ cmd, paths: ['docs/**'], covered_by: 'ci' }`; `/gates not applicable to this PR: test/`; no `/not run here|runs here/`; one `pr view`.
    11. `merge --no-gates with covered_by: no re-read of the PR` — one `pr view` in the log; `ran()` false.
    12. `merge covered_by: the first read still refuses a failing or pending check, as today` — first read `[failed('test')]`: refused, `/the forge's checks failed at \w{12}: test \(failure\)/`; first read `[pending('test')]`: `/still running at \w{12}: test; wait for them/`; each with one `pr view` in the log and `ran()` false (pins the `rollupState` refactor on the box).

- [ ] **Step 2: run them and see them fail** — `sh docs/devteam-dev/tickets/kit-205-merge-reuses-green-ci/run-tests.sh`; expected exit non-zero, with tests 1-7 and 9 failing (the gate runs, no message). Tests 8, 10, 11, 12 may pass already.

- [ ] **Step 3: implement** in `devteam.mjs`:
  - `rollupState` and `forgeCoverage` as above, beside `cmdMerge`, with comments: an unknown state is pending, never coverage; `.github/` is excluded because a `pull_request` workflow runs the PR's own workflow files. Today's rollup loop uses `rollupState`.
  - `let coveredNotes = []` before the gate block.
  - In the gate block, after `applies` and `skipped`: `const declared = gates.filter(applies).filter(([, s]) => isObj(s) && s.covered_by !== undefined)`. If non-empty, compute `fresh` once, the first that applies:
    - `viaGit` → `{ why: 'forge is git: no checks to read' }`;
    - `pr.number` absent → `{ why: 'no PR to read' }`;
    - `base` null, or `R.git(['diff', '-z', '--name-only', '--no-renames', base, sha])` null (the diff itself, as `deployingFiles` does, never `changedFiles`, which reads a failed diff as no files) → `{ why: 'cannot tell what the PR changes' }`;
    - any listed file starting `.github/` → `{ why: `the PR changes the forge's CI configuration (${first three, ", …" if more})` }`;
    - `R.gh(['pr', 'view', String(pr.number), '--json', 'headRefOid,statusCheckRollup'])` null or unparsable → `{ why: "could not read the PR's checks again" }`;
    - `headRefOid !== sha` → `{ why: `the head moved to ${headRefOid.slice(0, 12)}` }`;
    - else `{ rollup }`.
  - In the loop, for a declared gate: first the shape check, whatever `fresh` is (a bad value → `warn('gate <name>: covered_by is not "ci" or a list of check names; it runs')`, run as today); then `const c = fresh.rollup ? forgeCoverage(spec.covered_by, fresh.rollup, S.ignored_checks ?? []) : { covered: false, why: fresh.why }`; covered → `out(`gate ${name} not run here: the forge's checks ran it green at ${sha.slice(0, 12)} (${c.checks.join(', ')})`)`, push `` `gate ${name} covered by the forge's checks at ${sha} (${c.checks.join(', ')})` `` to `coveredNotes`, `continue`; not covered → `out(`gate ${name} runs here: ${c.why}`)`, then run as today.
  - The act's `what` appends `coveredNotes.map((n) => `; ${n}`).join('')` after today's text.
  - A comment at the gate loop: covered_by is the owner's gate field (gate-change); it covers only a green check at this exact head, and every failure to read or list fails closed.

- [ ] **Step 4: run and see them pass** — `run-tests.sh` exit 0; then `run-tests.sh test/merge-admin.test.mjs` and `run-tests.sh test/multirepo-landing.test.mjs`, each exit 0.

- [ ] **Step 5: commit** `kit-205: merge trusts a declared gate's green forge checks at the exact head`; `reviews/task-1.md` from a fresh reviewer subagent (brief carries the rulings' shell rules).

### Task 2: the owner's setting stays the owner's, and the docs

**Files:**
- Test: `test/kit.test.mjs`
- Modify: `docs/devteam/governance/quality.md` (§2 after **Modes**; L24; L121), `docs/devteam/process/supervisor.md` (L127)

- [ ] **Step 1: tests** (pass on today's code; they pin it):
  1. `covered_by on an existing gate is the owner's gate-change` — `fleetFixture`; main gets `gates: { test: 'true' }` (committed, pushed); a chore changes it to `{ cmd: 'true', covered_by: 'ci' }`; `merge --chore x --dry-run` fails with `/changes owner settings: gates \(gate-change\)/`; with `--approved` of an answered gate-change question it passes. No owner standing rule in the fixture.
  2. `covered_by on a new gate is not the supervisor's to add` — a chore adds `lint: { cmd: 'true', covered_by: 'ci' }`; output matches `/it sets covered_by; a new gate the owner hasn't approved has only cmd, paths, junit, mode/`.
- [ ] **Step 2: run** — `run-tests.sh`, exit 0.
- [ ] **Step 3: docs.**
  - quality.md, one paragraph after **Modes**: "**Covered by the forge.** A gate the forge's CI already runs can say `"covered_by": "ci"` (every check the forge reports) or `"covered_by": ["<check name>", …]` (those checks). It is trust in those checks at the exact head sha `merge` is landing, never at an earlier commit: `merge` reads the PR again and skips the gate only when every one of them is complete and green at that sha. When any is missing, failed or pending (or skipped or neutral, the head moved, the PR changes `.github/`, or the forge has no checks), the gate runs as usual. Under `"ci"` a check that never reported can't be seen; the list form can, so prefer it, and use it when a PR has many checks. `merge` says which gates it trusted, and its act records them. It is the owner's gate field (gate-change)."
  - quality.md L24 (`merge` runs every one at the PR head), L121 (the `merge <ticket-id>` row) and supervisor.md L127 (Merging, "every gate in the settings in a clean worktree at that head"): each gets the clause "except a gate `covered_by` the forge's green checks at that exact head (quality.md §2)", worded to fit its sentence.
- [ ] **Step 4: commit** `kit-205: covered_by is the owner's, and documented`; `reviews/task-2.md`.

### Finish

Merge `origin/main`, the targeted runs again, push, PR `kit-205-merge-reuses-green-ci: merge does not re-run a gate the forge's CI already ran green at the exact head`, CI conclusion from `gh run view`, `verification.md` (a row per done-when), two final reviews from other sessions (`final-1.md`, `final-1b.md`, risk high), `check-ticket`, merge-request.
