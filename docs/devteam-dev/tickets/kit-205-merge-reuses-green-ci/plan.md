# kit-205 merge reuses green CI: implementation plan

## TL;DR

- One code file changes: `docs/devteam/scripts/devteam.mjs`. Tests go in `test/kit.test.mjs` as standalone `test(…)` blocks (no new file). Records stay in this folder.
- The forge-check state reading inside `cmdMerge` moves into a helper, `rollupState(c)`, used by today's pending/failing check and by the new `forgeCoverage(coveredBy, rollup)`, which says whether a gate's `covered_by` ("ci" or a list of check names) is met by a rollup, and if not, why.
- Right before the gate loop, when an applicable gate declares `covered_by`, merge re-reads the PR once, by number (`gh pr view <n> --json headRefOid,statusCheckRollup`); a failed read, a moved head, a PR that changes `.github/` or forge `git` covers nothing. Under `"ci"` every check must be SUCCESS (a skipped one is not coverage). A covered gate is not run, writes no `gate` line, is printed, and is named in the merge act's `what`; any other gate runs exactly as today.
- Tests drive `merge` on a sibling-repo ticket (the `multiFixture` pattern from `multirepo-landing.test.mjs`) with a fake `gh` that serves successive `pr view` answers from numbered files; the gate's command touches a marker file, so "ran" vs "not run" is a file check. One test per D1/D2/D3 case.
- D3's owner rules are pinned by tests on existing code (a chore adding `covered_by` to a gate needs a gate-change answer; a supervisor gate-add can't carry it); `GATE_ADD_FIELDS` is not touched.
- Order: T1 helpers + merge wiring with its tests, T2 the owner-rule tests and the quality.md paragraph. Built only after kit-204 merges and approve-plan is recorded.
- Risk: a gate skipped on a check state misread. The helper treats every state it doesn't know as not covered; tests cover pending, failed, missing, skipped-only, neutral, ignored-and-failing, moved head, failed re-read and forge git.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `merge` trusts a complete, green forge check at the exact head for a gate the owner declared `covered_by`, instead of re-running it, and runs every other gate as today.

**Architecture:** two pure helpers beside `cmdMerge` plus a once-per-merge PR re-read before the gate loop; the record is merge's output and the act's `what`.

**Tech stack:** Node ESM, `node:test`; the kit's fixtures in `test/lib/kit.mjs`.

**Spec:** `docs/devteam-dev/tickets/kit-205-merge-reuses-green-ci/spec.md`.

## Rulings

- m-20261115-203723494-supervisor: plan ahead (spec and plan now); build only after kit-204 merges and approve-plan is recorded; every brief carries k-20261115-182656232, k-20261115-080753394, k-20261115-164245020 and the scripts-in-files rule; only the touched files run, at `--test-concurrency=2`.
- m-20261115-204545585-supervisor (re m-20261115-204302985): quality.md is in touches for the covered_by sentences only; they say covered_by is trust in a check at the exact head sha, never an earlier one, and the gate still runs when a check is missing, failed or pending.

## Global constraints

- Files outside this folder: `docs/devteam/scripts/devteam.mjs`, `test/kit.test.mjs` and `docs/devteam/governance/quality.md` (the covered_by paragraph only), and `docs/devteam/process/supervisor.md` L127 if m-20261115-204658302 is granted. No file added.
- On the box: run only `test/kit.test.mjs` filtered to this ticket's tests, `node --test --test-concurrency=2 --test-name-pattern='covered_by' test/kit.test.mjs`, through `run-tests.sh` in this folder (own HOME via `mktemp -d`, `DEVTEAM_HUB_PORT=4791`, every `DEVTEAM_*` unset, `nice`, `timeout 900`), judged by its exit code, never through a pipe. `test.yml` on GitHub is the gate; its conclusion is read with `gh run view`.
- Every test name this ticket adds contains `covered_by`, so the filter above selects exactly them.
- No log schema change, no new settings key other than the gate field.

## Review focus

1. A rollup entry of a shape the code doesn't expect (no `__typename`, a `StatusContext` with `state` lowercase, a CheckRun `COMPLETED` with `conclusion: null`): must read as not green. Pinned in T1 (`rollupState` unit cases through `forgeCoverage`).
2. A list `covered_by` naming a check that appears twice (a re-run), once failed: not covered. Pinned in T1.
3. A gate with `covered_by` and `paths` that doesn't apply: reported not applicable, never "covered". Pinned in T1.
4. `--no-gates` and chore merges: unchanged, no re-read of the PR. Pinned in T1 (the fake gh's call log shows one `pr view` only).
5. A ratchet gate with `covered_by` whose checks aren't green: runs, and ratchet still applies. Covered by existing ratchet tests plus T1's "runs as today" path; no extra test (the path is today's code unchanged).

---

### Task 1: coverage helpers and merge wiring

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs` (beside `cmdMerge`, ~L4930-5175)
- Test: `test/kit.test.mjs` (appended)

**Interfaces (produces):**
- `rollupState(c) -> { name: string, state: string }`: `name` is `c.name ?? c.context ?? '?'`; `state` is the uppercase state as today's inline expression computes it (`StatusContext`/`state` → `state`; CheckRun → `conclusion` when `status === 'COMPLETED'`, else `'PENDING'`). Today's pending/failing loop in `cmdMerge` uses it, unchanged in behaviour.
- `forgeCoverage(coveredBy, rollup, ignored) -> { covered: true, checks: string[] } | { covered: false, why: string, bad?: true }`:
  - `bad: true` when `coveredBy` is not `'ci'` and not a non-empty array of non-empty strings (why: `covered_by is not "ci" or a list of check names`).
  - `'ci'`: not covered if `rollup` is empty (`the forge reports no checks`); if any entry (ignored ones included) is not `SUCCESS` (`<name> is <state lowercased>`, `pending` for an incomplete one). Else covered, `checks` = every entry's name, in rollup order, without repeats.
  - list: for each name: no entry (`<name> is missing`); any entry with that name not `SUCCESS` (`<name> is <state>`). Else covered, `checks` = the list.
  - `ignored` is passed for the message only (an ignored check that is not green says `<name> is <state> (ignored_checks never counts as coverage)`).

- [ ] **Step 1: write the failing tests** in `test/kit.test.mjs`:
  - a fixture helper `coveredFixture(name, coveredBy)`: `multiFixture(name)`; console's origin set to `https://github.com/usbclub/console.git` with `insteadOf` to the bare repo (as in `multirepo-views.test.mjs` "a github-forge sibling"); `F.lines(…, { links: { …console, remote: 'usbclub/console', forge: 'github', gates: { test: { cmd: "touch '<base>/ran-test'", covered_by: coveredBy } } } })` (`coveredBy === undefined` leaves the field out); lands ticket `console-01-a` on `ticket/console-01-a` with spec, plan, verification, a final review and approve-spec/approve-plan acts, as `land()` does in `multirepo-landing.test.mjs`; returns `{ F, sha, ran: () => fs.existsSync(marker), gh(views, opts) }`.
  - `gh(views)`: writes a fake `gh` on PATH whose `pr view` serves `view-1.json`, `view-2.json`, … in call order (the last repeats; a view that is the string `'fail'` exits 1), logs every call, and exits 0 on `pr merge`. Each view is `{ number: 7, headRefOid, title: 'console-01-a: work', body: '## One-way doors\n\nNone.\n', isDraft: false, mergeStateStatus: 'CLEAN', url, statusCheckRollup }`. Helpers `run(...)` (green CheckRun), `pending(n)`, `failed(n)`, `status(n, state)` build entries.
  - Tests (each name contains `covered_by`):
    1. `merge covered_by "ci": every check green at the head, the gate is not run, and merge says so in its output and act` — views: two of `[run('test'), run('lint')]` at `sha`; real merge exit 0; `ran()` false; output matches `/gate test not run here: the forge's checks ran it green at \w{12} \(test, lint\)/`; no `gate` log line with `gate === 'test'` and this sha; the `merge-word` act's `what` matches `` `gate test covered by the forge's checks at ${sha} (test, lint)` ``.
    2. `merge covered_by a list: the named checks green, the gate is not run` — `['test']`, rollup `[run('test'), status('deploy', 'SUCCESS')]`; `--dry-run`; `ran()` false; output names `(test)`.
    3. `merge covered_by: a pending, failed, missing, neutral or skipped check, or an ignored one failing, runs the gate as today` — table of `[coveredBy, firstRollup, freshRollup, expected why]`, each `--dry-run` on a fresh marker: (`'ci'`, green, `[run('test'), pending('lint')]`, `/lint is pending/`); (`['test']`, green, `[failed('test')]` — first read green, fresh read failed, `/test is failure/`); (`['test','e2e']`, green, green, `/e2e is missing/`); (`'ci'`, `[]`, `[]`, `/reports no checks/`); (`'ci'`, `[run('lint'), skipped('test')]`, same, `/test is skipped/`); (`['test']`, `[neutral('test')]`, same, `/test is neutral/`); (`['test']`, `[run('test'), failed('test')]`, same, `/test is failure/`); with `ignored_checks: ['flaky']` on console, (`'ci'`, `[run('test'), failed('flaky')]`, same, `/flaky is failure \(ignored_checks never counts/`). Each: `ran()` true; output matches `/gate test runs here: /` and the why; a `gate` line for `test` at `sha`, ok true. Where the first read already has a pending or failing check merge refuses before gates, so those cases put green in the first read and the state in the fresh read.
    3b. `merge covered_by: a PR that changes the forge's CI configuration runs the gate` — the ticket also changes `.github/workflows/test.yml` (its touches include `.github/**`); green views; `ran()` true; output `/changes the forge's CI configuration \(\.github\/workflows\/test\.yml\)/`.
    4. `merge covered_by: the head moved since merge read the PR, so the gate runs` — view-2's `headRefOid` is another sha; `ran()` true; output `/the head moved to \w{12}/`.
    5. `merge covered_by: the PR can't be read again, so the gate runs` — view-2 `'fail'`; `ran()` true; output `/could not read the PR's checks again/`.
    6. `merge covered_by on a forge "git" repo: no checks to read, the gate runs` — console `forge: 'git'`, `run/pr/ticket/console-01-a.md`; `ran()` true; output `/forge is git: no checks to read/`; the fake gh's log has no `pr view`.
    7. `merge without covered_by runs the gate though every check is green` — `coveredBy` undefined, green views; `ran()` true; fake gh's log has exactly one `pr view` (no re-read when no gate declares it). In test 1, the log's second `pr view` names the PR's number (`pr view 7 --json headRefOid,statusCheckRollup`).
    8. `merge covered_by of a shape it doesn't know runs the gate and warns` — `covered_by: 'yes'` and `covered_by: []`; `ran()` true; stderr/out matches `/covered_by is not "ci" or a list of check names/`.
    9. `merge covered_by with paths that don't match: not applicable, never covered` — gate `{ cmd, paths: ['docs/**'], covered_by: 'ci' }`; output `/gates not applicable to this PR: test/`, not `/not run here/`.
    10. `merge --no-gates with covered_by: no re-read of the PR` — one `pr view` in the log.

- [ ] **Step 2: run them and see them fail** — `sh docs/devteam-dev/tickets/kit-205-merge-reuses-green-ci/run-tests.sh`; expected: tests 1, 2, 3 (whys), 4, 5, 6, 8 fail (the gate runs and no message), exit non-zero. Tests 7, 9, 10 may pass already.

- [ ] **Step 3: implement** in `devteam.mjs`:
  - `rollupState` and `forgeCoverage` as above, beside `cmdMerge`, with a comment that an unknown state is never coverage, and that `.github/` is excluded because a `pull_request` workflow runs the PR's own workflow files. Today's rollup loop uses `rollupState`.
  - In the gate block, after `applies` and `skipped`: `const declared = gates.filter(applies).filter(([, s]) => isObj(s) && s.covered_by !== undefined)`. If non-empty: when `viaGit`, `fresh = { why: 'forge is git: no checks to read' }`; else when `changed` (the PR's files from the merge base, already computed for `paths`) is null or has a file starting `.github/`, `fresh = { why: `the PR changes the forge's CI configuration (${first three, …})` }` (null: `cannot tell what the PR changes`); else `const v = R.gh(['pr', 'view', String(pr.number), '--json', 'headRefOid,statusCheckRollup'])`, parsed in a try; null or unparsable → `{ why: "could not read the PR's checks again" }`; `headRefOid !== sha` → `{ why: `the head moved to ${headRefOid.slice(0, 12)}` }`; else `{ rollup }`.
  - In the loop, for a declared gate: `const c = fresh.rollup ? forgeCoverage(spec.covered_by, fresh.rollup, S.ignored_checks ?? []) : { covered: false, why: fresh.why }`; `bad` → `warn(…)`; covered → `out(`gate ${name} not run here: the forge's checks ran it green at ${sha.slice(0, 12)} (${c.checks.join(', ')})`)`, push `` `gate ${name} covered by the forge's checks at ${sha} (${c.checks.join(', ')})` `` to `coveredNotes`, `continue`; not covered → `out(`gate ${name} runs here: ${c.why}`)` and run as today.
  - The act's `what`: `` `merged ${branch} at ${sha}…` `` + `coveredNotes.map((n) => `; ${n}`).join('')`. `coveredNotes` is declared before the gate block (`let coveredNotes = []`).
  - A comment at the gate loop: covered_by is the owner's gate field (gate-change); it never covers when the forge is git, the head moved, or any check is not green.

- [ ] **Step 4: run the tests and see them pass** — same script, exit 0. Also run `test/merge-admin.test.mjs` and `test/multirepo-landing.test.mjs` one at a time (they drive merge), and the chain step for forge checks: `node --test --test-concurrency=2 --test-name-pattern="merge waits for the forge" test/kit.test.mjs` through the script — each exit 0.

- [ ] **Step 5: commit** `kit-205: merge trusts a declared gate's green forge checks at the exact head`; record `reviews/task-1.md` from a fresh reviewer subagent.

### Task 2: the owner's setting stays the owner's

**Files:**
- Test: `test/kit.test.mjs`
- Modify: `docs/devteam/governance/quality.md` §2, after **Modes**.

- [ ] **Step 1: tests** (pass on today's code; they pin it):
  1. `covered_by on an existing gate is the owner's gate-change` — `fleetFixture`; main gets `gates: { test: 'true' }` (committed, pushed); a chore changes it to `{ cmd: 'true', covered_by: 'ci' }`; `merge --chore x --dry-run` fails with `/changes owner settings: gates \(gate-change\)/`; with `--approved` of an answered gate-change question it passes.
  2. `covered_by on a new gate is not the supervisor's to add` — a chore adds `lint: { cmd: 'true', covered_by: 'ci' }`; output matches `/it sets covered_by; a new gate the owner hasn't approved has only cmd, paths, junit, mode/`.
- [ ] **Step 2: run** — `run-tests.sh`, exit 0.
- [ ] **Step 3a: the three lines that say merge runs every gate** (spec Docs, F1-3), if m-20261115-204658302 is granted: quality.md L24 (`merge` runs every one at the PR head) and L121 (the `merge <ticket-id>` row), and supervisor.md L127 (Merging), each get the clause "except a gate `covered_by` the forge's green checks at that exact head (quality.md §2)". If supervisor.md is not granted, only quality.md's two.
- [ ] **Step 3: docs:** one paragraph after Modes: "**Covered by the forge.** A gate the forge's CI already runs can say `"covered_by": "ci"` (every check the forge reports) or `"covered_by": ["<check name>", …]` (those checks; preferred, since a check that never reported then counts as missing). It is trust in those checks at the exact head sha `merge` is landing, never at an earlier commit: `merge` reads the PR again and skips the gate only when every one of them is complete and green at that sha. When any is missing, failed or pending (or skipped or neutral, the head moved, the PR changes `.github/`, or the forge has no checks), the gate runs as usual. Under `"ci"` a check that never reported can't be seen; the list form can, so prefer it, and use it when a PR has many checks. `merge` says which gates it trusted, and its act records them. It is the owner's gate field (gate-change)."
- [ ] **Step 4: commit** `kit-205: covered_by is the owner's`; `reviews/task-2.md`.

### Finish

Merge `origin/main`, the targeted runs again, push, PR `kit-205-merge-reuses-green-ci: merge does not re-run a gate the forge's CI already ran green at the exact head`, CI conclusion from `gh run view`, `verification.md` (a row per done-when), two final reviews from other sessions (`final-1.md`, `final-1b.md`, risk high), `check-ticket`, merge-request.
