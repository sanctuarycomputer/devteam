# PR 1, "Links and component lines": Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the links registry (`settings.links`, `LINK_KINDS`), component lines over home (`settings.components.<c>.owns`) enforced at the four points of spec §4, links in prompts and questions, one scope grammar, the `registry-edit` act and the `links`, `link`, `components check` and `observe-link` commands, without changing a single-repo project's output.

**Architecture:** Everything stays in the one dependency-free script `docs/devteam/scripts/devteam.mjs`. A new settings section (2b) holds `LINK_KINDS`, the registry and component validators and the location of a link's checkout. A pure, vm-loadable block next to the glob helpers holds `coverage()`, `caseCollisions()` and `prefixOwners()`. Enforcement reads components only from committed settings (`settingsInForce`). Every new rule is gated on "lines declared" (§ Open issue 1), so a project that declares nothing runs today's code paths. Repo links are parsed, pinned to main and validated, but only `home` hosts components and tickets in this PR.

**Tech Stack:** Node 18+ built-ins only (`node:child_process`, `fs`, `path`, `vm` in tests), git ≥ 2.38 (`merge-tree --write-tree`, already required by `verdictHolds`), tmux for the suite, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-04-links-components-multirepo-design.md` (rev 2). **Code:** branch `multi-repo` at `05aba1c`. Line numbers below are for that commit; they drift as tasks land, so each anchor also names the function.

## Global Constraints

- G1: single-repo projects behave exactly as today with no settings changes: no new failures, no new required fields, identical command output apart from new optional lines (spec §2).
- Node 18 floor: nothing newer than Node 18 (`devteam.mjs` line 25 comment). No `Object.groupBy` (use the file's `groupBy`), no `Array.prototype.findLast`, no `Set` methods from Node 22.
- Built-ins only: no npm dependency, in the kit or the test (`devteam.mjs` line 2).
- `home` and `devteam` are reserved ids; `home` is never declared (spec §3.1).
- v1 link kinds are exactly `repo` and `url`; `url` is `https://` only (spec §3.1).
- Per-repo keys are exactly `main_branch`, `forge`, `merge_method`, `release`, `gates`, `worktree_setup`, `worktree_files`, `ignored_checks`, `project`; `gates`, `worktree_setup`, `worktree_files` and `ignored_checks` are never inherited (spec §3.1, §3.3).
- Matching is case-sensitive on every platform; negation patterns are refused; object `owns` entries are refused with "reserved" (spec §3.2, §4).
- `treePaths` reads a commit's tree with `git ls-tree -r -z --name-only`, never the index or the working tree; `changedFiles` is `git diff -z --name-only --no-renames` (spec §4).
- None of the four enforcement points ever takes `components` from the working tree (spec §4, "Which settings decide").
- Findings severities: `link-unreachable` 3, `unowned-files` 4, `line-pressure` 2; once a day per finding (spec §7).
- `registry-edit` is a constitutional class: a logged act with no rung and no owner answer (spec §7).
- Code meets `docs/devteam/governance/code-style.md` (comment the why, not the what; one way per thing; result values over throws in pure code) and `quality.md` (no bare suppressions). Match the file's style: two-space indent, single quotes, one-line arrow helpers, comments that say why.
- Tests: `test/kit.test.mjs` plus `test/fixtures/`, `node --test`, Node 18/20/22/24, tmux on its own server (`TMUX_TMPDIR`), never the network.
- Repo rules for whoever executes this plan: never `rm` inside `sh -c` or `eval`, never `rm` a variable path; delete fixtures with `fs.rmSync` on a path built in the test, as the file already does.

## Suite baseline

Measured on 2026-11-04 on the branch's head (`05aba1c`) with `node --test` from the repo root, Node v24.14.1, tmux present, on a machine also running other sessions' kit suites (load average 6 to 7):

- **1406 s wall time (23.4 min); 42 tests, 40 pass, 2 fail.**
- The failures are one assertion and its parent: `a ticket's merge gate fails validate only for overlaps that are its own (D4)` (`test/kit.test.mjs:1604`) fails at `test/kit.test.mjs:1647`. `wait --minutes 0.5` printed "nothing new in 0.5 min" instead of waking on the worker's message. The test sends the message 1.5 s after starting `wait` (`:1642`); under load, `wait`'s first snapshot (it spawns `messages` and `metrics`, `devteam.mjs:6256-6263`) took longer than that, so the message was already in the baseline and never "fresh". This is a timing flake under load, not a defect this work touches. Treat it as pre-existing: if it shows up during a task, re-run on an idle machine before suspecting the change.
- Subtests took 20 to 90 s each under that load. Re-measure before Task 1 on an idle machine and put the number in the PR description.

## Open issues for the coordinator

Each is a place where the spec contradicts itself or the code; the plan follows the most conservative reading given here.

1. **`components` already exists as free-form labels (G1 risk).** `SETTINGS_DEFAULTS.components` is `{}` (`devteam.mjs:197`), `init` writes `components: {}` (`devteam.mjs:6585`) and tells the adopter to "fill settings (components, …)" (`devteam.mjs:6602`), and README step 4 says "Fill `project/settings.md`: components and stacks" (`README.md:47`). No shape was ever defined, so live projects may hold `{"api": {"stack": "rails", "path": "app"}}`. Read literally, spec §3.3 turns any non-empty map into declared lines, and such a project then fails validate (two components with no `owns`), which breaks G1. **Plan:** a component map *declares lines* only when at least one entry carries one of the line fields `link`, `owns`, `shared` or `release` (`linesDeclared`). A map with none of them is labels: no coverage, no footprint, no containment, no new errors; `links` and `components check` say so. Once any entry declares a line, every entry is a component and unknown keys are errors.
2. **The spec's own example is contested.** §3 declares `api` owning `config/**` and `routes` owning `config/routes.rb`. Under invariant C, `config/routes.rb` matches both, so the example fails its own coverage rule. **Plan:** implement invariant C exactly (one owner per path); the README example (Task 18) uses non-overlapping lines (`api` owns `config/*.yml`, `config/initializers/**`, and so on; `routes` owns `config/routes.rb`).
3. **§11 puts §6.2 in PR 2, but PR 1's own tests need part of it.** §4 point 4 and the §12 monorepo test "a contract ticket with `touches_components` passes" are PR 1 material, while §11 lists §6.2 under PR 2 ("§6.2 (cross-repo)"). **Plan:** PR 1 ships the within-one-repo half of §6.2 (`touches_components`, the shared-component rule falling out of containment); PR 2 ships the cross-repo half (no multi-repo tickets, `validate --strict` story rule, `globsOverlap` per repo).
4. **Repo-link field classes are half-specified.** §3.4 says "If it's a `repo` link on main or at head …, every change to it is the owner's", while §3.5 says `path` "is never owner-classed", and neither says what `title`, `notes`, `for` and `source` on a repo link are. **Plan:** `LINK_KINDS.repo.ownerClass(field)`: `path` → none; `gates`, `worktree_setup`, `worktree_files`, `ignored_checks` → `gate-change`; every other field, including `title`, `notes`, `for`, `source`, `remote` and the inherited keys → `governance-edit`. Adding, removing or flipping the kind of a repo link → `governance-edit` on the key `links.<id>`.
5. **"The kit's own repo can't declare components" has no detection rule** (§4, "Consequence"). **Plan:** the kit's own repo is the one whose `origin` normalizes to `settings.upstream_repo` (`remoteKey`, Task 3). There `validate` errors on any declared line.
6. **Severity 4 doesn't exist for metrics findings.** Findings carry `high|medium|low`, mapped by `SEV` to 3/2/1 (`devteam.mjs:3805`, `3814`); the dashboard styles only those three (`dashboard/index.html:2782`) and `wait` wakes only on `high` (`devteam.mjs:6260`). **Plan:** `unowned-files` is a `high` finding carrying `sev: 4`; `observeFindings` writes `f.sev ?? SEV[f.severity]`, so the observation is severity 4 and nothing in the UI or `wait` changes.
7. **What makes a PR "fail" coverage.** §4 point 2 says "a PR that adds an unowned path, renames files out of every line, or narrows a glob". Failing on every gap would block every PR (tickets included) whenever someone pushes an unowned file straight to main, which §4 point 3 handles separately ("blocks new tickets"). **Plan:** a PR fails on coverage problems in the tree that would land that main (under main's settings) does not already have: new unowned paths, new contested paths, new empty globs, new case collisions. **Superseded by the review fixes (rev 2.2):** new empty globs no longer fail (a `line-empty` warning); new `unlinked` components do.
8. **Which tree on forge `git`.** §4 point 2 says `merge` runs coverage on the merge-tree. Judging a stale head against main's settings instead would refuse a stale branch for files main moved (a false refusal), so **plan:** `checkPr` computes the landing tree by forge for every caller: the head on `github`, `merge-tree --write-tree <main> <sha>` on `git` (a conflict is its own failure). **Superseded by the review fixes (rev 2.2):** merge-tree on every forge; a git that can't run it fails closed; none of it runs without lines.
9. **`components check` and the Baseline measure: which settings.** §8 doesn't say. **Plan:** the components committed at `--ref` (default main), consistent with "enforcement never reads the working-tree copy"; a supervisor checks a draft line by committing it on a chore branch and running `components check --ref chore-<slug>`.
10. **Orient's "contradict" is undefined** (§7). **Plan:** two url links (in the registry or proposed by an observation) contradict when their titles are equal ignoring case, their `for` scopes overlap, and their URLs differ. That becomes a proposed question, never an act.
11. **How an observation carries a link.** §10 lists only "observation kind `link`", but the observation type has `additionalProperties: false` (schema `observation`) and no field for a URL, a title, scopes and notes together. **Plan:** an optional `link` object on observations: `{ url | path, title, for, notes }`.
12. **Design citations and G1.** §6.3 says validate checks `link:<id>` citations in designs. A design written before links existed may contain the text `link:foo`. **Plan:** the check runs only while the registry is non-empty.
13. **Components on other repo links in PR 1.** §11 says repo links are "accepted and validated, but only `home` can host tickets". **Plan:** PR 1 also refuses a component whose `link` is not `home`, with an error that names the link; PR 2 lifts it. PR 1 checks coverage on home only.
14. **Where `link` edits land.** §7 says `link add|set|rm` writes "the working-tree settings" and "the supervisor's next chore PR lands" them, without naming the chore. **Plan:** `link` writes the main checkout's `settings.md` and prints the landing commands for a `chore-registry` PR (Task 13).
15. **`settingsAt` returning null (review finding B1).** The review asked that `settingsAt` return null when `git show` fails. Today it returns the defaults then (`devteam.mjs:241`), and `ownerSettingsChanged` (`245-249`) reads a null as "not valid JSON" and refuses the merge: a bootstrap chore whose merge base has no `settings.md` yet would start failing (G1). **Plan:** an option, `settingsAt(ref, { orNull: true })`, which every enforcement caller this change adds passes and handles; the existing callers keep today's result.

## Review fixes (rev 2.2, after the cold Fable and Opus reviews of 17db2e8)

The coordinator's rulings, as built on `multi-repo` after 17db2e8 (commits 414873c..bf8895e). Where a task above says otherwise, this section wins.

1. **Coverage at landing (Task 8).** `coverageFails` reads the committed settings and returns before any tree work when neither main nor the head declares lines. With lines, `landingTree` is `merge-tree --write-tree` on every forge, memoized per sha. `mergeTree` returns `{ tree } | { conflict } | { error }`; an error fails closed with "coverage needs git ≥ 2.38 (merge-tree --write-tree); found X" on an old git, or git's own error otherwise. `treePaths` throws `GitReadError`; `readCoverage` turns it into an error line at validate, coverage, `coverageGap` (counted as a gap), `components check` and `links`. `gitFacts(gitFn, run)` takes a runner that returns the exit status.
2. **Globs (Task 2).** `globMatcher` memoizes one matcher per glob text; `compileLines` compiles a component set once per call; `ownerSuggestions` indexes owned folders in one pass. Perf test: 50k paths × 30 globs, best of three under 500 ms.
3. **Settings at landing (Tasks 4, 6, 7, 8).** `settingsInForce(base, sha, R, { ticket })` returns `{ sMain, head, fromHead, landed() }`: main's for a ticket PR and for any PR that leaves settings.md alone; the landing settings for a plan or chore that changes it. `registryFails` runs `registryProblems` on the landing settings in `checkPr`. `LINK_KINDS.url.ownerClass` is `registry-edit`; `linkOwnerChanges` emits one `registry-edit` entry per changed url link; `merge` refuses one with no `registry-edit` act naming `link:<id>` since settings.md last changed on main. `checkTicket` judges by `mainSettings()`. `validate` judges main under main's settings, or in a `chore-*` checkout that changes settings.md, the landing tree under the landing settings.
4. **Empty globs (Tasks 2, 6, 8, 9).** A `line-empty` warning in validate, a low `line-empty` finding in metrics, excluded from `coverageGap`; still counted by `components check --count`.
5. **Reserved names (Task 3).** Live tickets only; `ticket add|set` refuse `home` and `devteam`.
6. **orient (Task 14).** `shq` single-quotes every value in a proposed command.
7. **Credentials (Tasks 3, 13, 14, 15).** `hasCredentials`, `redactUrl`; refused by both kinds' `validate` and by `observe-link`; the schema's observation `link.url` is `^https://` with no userinfo.
8. **Probes (Task 15).** Kinds' `probe` returns a spec `{ cmd, args, cwd?, env?, judge }`; `probeLinks` is async, four at a time, 20 s budget per tick (`DEVTEAM_PROBE_BUDGET_MS` in tests), leftovers named and not cached; `observe-metrics` is async (dispatch awaits a returned promise's failure). 401/403/405 is a low `link-behind-auth` note.
9. **Minors.** `checkTicket` honours `touches_components` only on contract/integration (F4); `LINK_TYPES` + `linkValue` (F6); the PR 2 note on non-home components (F7); `coverageClean` moved to the test, one `mainSettings()` (F9); help (F11); the kit's line subtracted first (F13); observe-link https and path checks, `newId`, pointer proposals (F15, O11); dismissals by decision/act refs (F16); per-kind fixes and contested globs (`contested: [[path, owners, [[name, glob]…]]]`) (O8); `link rm` citer check (O9); line-pressure per distinct ticket (O10).

## Review fixes round 2 (rev 2.3, after the cold Fable and Opus re-reviews of bf8895e)

The coordinator's rulings, as built on `multi-repo` after bf8895e. Where a task or rev 2.2 above says otherwise, this section wins.

1. **Fresh main (Tasks 8, 13).** `fetchMain()` fetches origin's main branch and resets `mainRef`, the settings, the log's memos (landing, coverage), main's log and the merge shas. `merge` calls it after fetching the PR branch and before `checkPr`; `check-pr` before `checkPr`.
2. **Redaction (Tasks 3, 13, 15).** `redactUrl` strips userinfo up to the last `@` before the host (never past `/ ? #`). `redactLink` redacts an entry's `url` and `remote`. Applied in `fixHint`, `locator` (text and remote), `promptLine` (both kinds), `links` (home's origin and each entry), `settings`' links, `resolveQuestionLinks` (inline links too), the move checklist and the upstream-sync tag message.
3. **Registry acts by content (rev 2.2 item 3 replaced).** `link add|set|rm` log `entry_hash` on the act: `sha256:<hex>` of `canonical(entry)`, or `null` for a removal (schema: optional act field, `["string","null"]`). `registryActFails(base, sha)` in `merge`: `linkOwnerChanges(S.sMain.links, S.landed().settings.links)`, the `registry-edit` entries; each needs an act whose `refs` include `link:<id>` and whose `entry_hash === linkEntryHash(landing entry)`. No time window. An act without `entry_hash` never matches. A landing that can't be computed is `registryFails`' message, not this one.
4. **No git 2.38 without lines (Task 8).** `settingsInForce().landed()`: when main's settings.md moved since the base and neither main nor the head declares lines, the settings are `mergeSettings(base, head, main)` (each read by `settingsAt`, i.e. `git show`): per top-level key, and per `links` entry, the head's value unless the head left it as the base had it, then main's. No `merge-tree`. With lines, the landing tree as before.
5. **Probe test (Task 15).** Slow stubs sleep 30 s, budget 5 s; the first stub leaves a marker and the bound (< 25 s) is measured from it; asserts the slow set is skipped, slow5 never starts, and each fast stub is cached exactly when it was not cut. Production 12 s / 20 s unchanged.
6. **`--key=value` (Task 14).** `parseArgs` takes `--key=value` whole, then following values as before. `orient` emits `--key='value'` (`shFlag`) for a flag value starting with `--`, and `link set <id> <field> -- '<value>'` (`shSetValue`) for a set value starting with `--`; `link set` reads values after a bare `--`.
7. **Docs.** README's "which settings" sentence matches quality.md; supervisor.md's tick names `line-empty` and `link-behind-auth`; quality.md says main is fetched first, how acts match, and that url links alone need no git 2.38.

## File structure

| File | Change | Responsibility |
|---|---|---|
| `docs/devteam/scripts/devteam.mjs` | modify | §2b registry and components; pure coverage block; enforcement; commands; prompts; findings |
| `docs/devteam/schema/log.schema.json` | modify | ticket/feature `links`, ticket `touches_components`, question link items, knowledge scope, observation `link` |
| `docs/devteam/governance/constitution.md` | modify | `registry-edit` in `constitutional` (json block and prose) |
| `docs/devteam/governance/quality.md` | modify | invariant C and the footprint rule as gates; owner classes per link field |
| `docs/devteam/process/planning.md` | modify | `touches_components`, `links`, drawing lines in `architecture.md`, Baseline precondition |
| `docs/devteam/process/supervisor.md` | modify | the link loop, the new findings |
| `docs/devteam/process/worker.md` | modify | the Links block, `observe-link` |
| `docs/devteam/dashboard/index.html` | modify | `linkOf` renders a link with neither `url` nor `path` as text |
| `README.md` | modify | "Links, components and other repos" section; setup steps 4 and 7 |
| `test/kit.test.mjs` | modify | new top-level tests and fixtures |
| `test/fixtures/g1/*.txt` | create | the G1 goldens |

---

### Task 1: G1 goldens, recorded from the unchanged kit

The G1 test is written first and recorded against today's kit, so every later task is checked against it.

**Files:**
- Modify: `test/kit.test.mjs` (new helper and top-level test after `fleetFixture`, which ends at line 2321)
- Create: `test/fixtures/g1/validate.txt`, `status.txt`, `ready.txt`, `check-ticket.txt`, `prompt-worker.txt`, `merge-dry-run.txt`, `metrics.txt`, `fleet-status.txt`, `knowledge.txt`, `orient.txt`, `questions.txt`

**Interfaces:**
- Consumes: `fleetFixture(name)` (`test/kit.test.mjs:2282`), which returns `{ base, org, old, neu, home, env, run, ok, g, land, done }`.
- Produces: `g1Outputs(F)` → `{ validate, status, ready, 'check-ticket', 'prompt-worker', 'merge-dry-run', metrics, 'fleet-status', knowledge, orient, questions }` (normalized strings: shas and ids as `<sha>`, the fixture path as `<tmp>`, clock and duration keys dropped from the two JSON outputs), and the goldens. PR 2's G1 task reuses both.

- [ ] **Step 1: Run the suite once to learn the baseline**

Run: `time node --test 2>&1 | tail -5`
Expected: `ℹ fail 0`, or only the known load flake at `test/kit.test.mjs:1647` (see Suite baseline). Write the runtime into the PR description.

- [ ] **Step 2: Write the G1 test with a record mode**

Add after `fleetFixture` (after line 2321):

```js
// G1 (spec §2): a single-repo project with no new settings prints exactly what it printed before
// links and component lines. The goldens were recorded once from the kit before the change
// (DEVTEAM_G1_RECORD=1); never re-record them to make this pass.
const G1_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'g1');
const g1Norm = (s, base) => s.split(fs.realpathSync(base)).join('<tmp>').split(base).join('<tmp>').replace(/\b[0-9a-f]{7,40}\b/g, '<sha>');
function g1Outputs(F) {
  const { old, ok, run, g } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const fake = 'g-20260101-000000000-supervisor';
  ok(old, ['feature', 'add', 'g1', '--json', JSON.stringify({ title: 'G1', goals: [fake], stories: [{ id: 'G1-S1', text: 'it still works', release: 'v1.0.0' }] })], SUP);
  const tk = (id, extra = {}) => ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'g1', component: 'g1', kind: 'build', size: 'S', risk: 'normal', serves: ['G1-S1'], depends_on: [], touches: ['src/**'], done_when: ['the src test passes in CI'], ...extra })], SUP);
  tk('g1-01-a');
  tk('g1-02-b', { depends_on: ['g1-01-a', 'g1-99-missing'], touches: ['src/b/**'] });
  const w = path.join(old, '.worktrees', 'g1-01-a');
  g(['worktree', 'add', '-q', '-b', 'ticket/g1-01-a', w, 'origin/main'], old);
  const tdir = path.join(w, 'docs/devteam/project/tickets/g1-01-a');
  write(path.join(tdir, 'spec.md'), '# spec\n');
  write(path.join(tdir, 'plan.md'), '# plan\n\n## TL;DR\n\n- one file\n');
  write(path.join(tdir, 'verification.md'), '| Done-when | Command | Result |\n|---|---|---|\n| src test | npm t | pass |\n');
  write(path.join(w, 'src/a.js'), 'a\n');
  write(path.join(w, 'OUTSIDE.md'), 'not in touches\n');
  write(path.join(w, 'src/é.js'), 'non-ascii\n');
  g(['add', '-A'], w);
  g(['commit', '-qm', 'g1-01-a: work'], w);
  const sha = g(['rev-parse', 'HEAD'], w);
  write(path.join(tdir, 'reviews/final-1.md'), review('reviewer-b', sha));
  g(['add', '-A'], w);
  g(['commit', '-qm', 'review'], w);
  const head = g(['rev-parse', 'HEAD'], w);
  g(['push', '-q', 'origin', 'ticket/g1-01-a'], w);
  const bodyFile = path.join(F.base, 'g1-body.md');
  write(bodyFile, '## One-way doors\n\nNone.\n');
  // what merge, metrics, knowledge, orient and questions have to show: approvals, a PR text (forge
  // git), an accepted lesson, a recurring observation from two writers, an open question with links
  ok(old, ['act', '--class', 'approve-spec', '--refs', 'g1-01-a', '--', 'spec ok'], SUP);
  ok(old, ['act', '--class', 'approve-plan', '--refs', 'g1-01-a', '--', 'plan ok'], SUP);
  write(path.join(old, 'docs/devteam/run/pr/ticket/g1-01-a.md'), '# g1-01-a: work\n\n## One-way doors\n\nNone.\n');
  ok(old, ['knowledge', 'add', '--kind', 'fact', '--statement', 'g1 builds with make', '--scope', 'component:g1', '--owner']);
  for (const i of [1, 2]) ok(old, ['observe', '--subject', 'g1', '--kind', 'slow-test', '--key', 'slow:g1', '--detail', `slow ${i}`, '--valence', '-1'], SUP);
  ok(old, ['observe', '--subject', 'g1', '--kind', 'slow-test', '--key', 'slow:g1', '--detail', 'slow 3', '--valence', '-1', '--owner']);
  ok(old, ['ask', '--question', 'Ship g1 behind a flag?', '--ticket', 'g1-01-a', '--recommendation', 'yes', '--choices', JSON.stringify([{ label: 'yes', detail: 'behind a flag' }, { label: 'no' }]), '--links', JSON.stringify([{ title: 'The spec', path: 'docs/devteam/project/tickets/g1-01-a/spec.md', ref: 'ticket/g1-01-a' }])], SUP);
  const both = (r) => `exit ${r.status}\n--- stdout\n${r.out}\n--- stderr\n${r.err}\n`;
  // metrics and fleet status carry clocks and durations; everything else in them must not move
  const TIMEY = /(^since$|_at$|^at$|^now$|hours|minutes|seconds|_ms$|^ms$|^until$|^parity$)/;
  const untimed = (x) => (Array.isArray(x) ? x.map(untimed) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([k]) => !TIMEY.test(k)).map(([k, v]) => [k, untimed(v)])) : x);
  const jsonOut = (r) => both({ ...r, out: r.status === 0 ? JSON.stringify(untimed(JSON.parse(r.out)), null, 2) : r.out });
  const outs = {
    validate: both(run(old, ['validate'])),
    status: both(run(old, ['status'])),
    ready: both(run(old, ['ready'])),
    'check-ticket': both(run(old, ['check-ticket', 'g1-01-a', '--sha', head, '--title', 'g1-01-a: work', '--body-file', bodyFile])),
    'prompt-worker': both(run(old, ['prompt', 'worker', 'g1-01-a'])),
    'merge-dry-run': both(run(old, ['merge', 'g1-01-a', '--dry-run'], SUP)),
    metrics: jsonOut(run(old, ['metrics', '--json'])),
    'fleet-status': jsonOut(run(old, ['fleet', 'status', '--json', '--no-fetch'], SUP)),
    knowledge: both(run(old, ['knowledge', '--for', 'g1-01-a'])),
    orient: both(run(old, ['orient'])),
    questions: both(run(old, ['questions'])),
  };
  return Object.fromEntries(Object.entries(outs).map(([k, v]) => [k, g1Norm(v, F.base)]));
}

test('G1: a single-repo project with no new settings prints what it printed before', () => {
  const F = fleetFixture('g1');
  try {
    const outs = g1Outputs(F);
    for (const [name, text] of Object.entries(outs)) {
      const file = path.join(G1_DIR, `${name}.txt`);
      if (process.env.DEVTEAM_G1_RECORD) { write(file, text); continue; }
      assert.equal(text, fs.readFileSync(file, 'utf8'), `${name} changed for a single-repo project (G1); the golden is ${file}`);
    }
  } finally { F.done(); }
});
```

Note: `src/é.js` is inside `touches` (`src/**`), but today's `changedFiles` gets it from `git diff --name-only` as the quoted octal `"src/\303\251.js"`, which matches no glob, so today's `check-ticket` lists it in "changes files outside touches". That line is the one G1 output this change is allowed to alter: Task 5 switches to `-z`, the path matches `src/**`, and the line lists only `OUTSIDE.md`. `merge --dry-run` prints the same check-ticket line, so the same change shows in `merge-dry-run.txt`. Those two goldens are re-recorded **only** for that one line, in Task 5, and the task says so.

- [ ] **Step 3: Record the goldens with the unchanged kit**

Run: `DEVTEAM_G1_RECORD=1 node --test --test-name-pattern 'G1:'`
Expected: PASS; eleven files under `test/fixtures/g1/`. Open each and check it holds no absolute path, no timestamp, no raw sha and no duration. If one does (a finding's `detail` that quotes an age, say), add its key to `TIMEY` or its pattern to `g1Norm` and record again; never drop a whole output to make it stable. Record twice in a row and `git diff --stat test/fixtures/g1` must be empty: that proves the goldens are deterministic.

- [ ] **Step 4: Run it in compare mode**

Run: `node --test --test-name-pattern 'G1:'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/kit.test.mjs test/fixtures/g1
git commit -m "G1 goldens: a single-repo project's validate, status, ready, check-ticket and worker prompt, recorded before links"
```

---

### Task 2: The pure coverage block

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs:1187-1220` (wrap the glob helpers in markers) and insert the coverage block right after `globsOverlap` (after line 1220)
- Test: `test/kit.test.mjs` (new top-level test)

**Interfaces:**
- Consumes: `escRe`, `hasWild`, `unbalanced`, `globToRegex`, `trimSlash`, `staticPrefix`, `pathMatches`, `globsOverlap` (`devteam.mjs:1188-1220`).
- Produces (all pure, all `function` declarations so a vm context can call them):
  - `coverage(paths: string[], components: {name: string, owns?: string[]}[], devteamLine: string[]) → { unowned: string[], contested: [string, string[]][], empty: string[], case_collisions: string[][] }`
  - `caseCollisions(paths: string[]) → string[][]` (each group sorted, at least two paths)
  - `coverageClean(r) → boolean`
  - `prefixOwners(entry: string, components, devteamLine) → string[] | null` (`null` when the entry has no static prefix; `'devteam'` in the list when the prefix lies in the kit's line)
  - `ownersOf(path, components, devteamLine, onHit?) → string[]` (`'devteam'` first when the path lies in the kit's line; the one owner rule every caller uses)

- [ ] **Step 1: Write the failing tests**

Add a top-level test after the G1 test:

```js
// The coverage function, loaded from the script by itself (as the review bridge is): tables for
// the shapes a tree can take, then a property test against a brute-force oracle.
function coverageFns() {
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b); assert.ok(i >= 0 && j > i, `${a} … ${b} marks a block in devteam.mjs`); return src.slice(i, j); };
  const ctx = vm.createContext({});
  return vm.runInContext(`${cut('/* globs start */', '/* globs end */')}\n${cut('/* coverage start */', '/* coverage end */')}\n;({ coverage, caseCollisions, coverageClean, prefixOwners, ownersOf, pathMatches })`, ctx);
}

test('coverage: every tracked path has exactly one owner', () => {
  const { coverage, coverageClean, prefixOwners } = coverageFns();
  const DEV = ['docs/devteam/**'];
  const plain = (r) => JSON.parse(JSON.stringify(r));
  const paths = ['.github/workflows/ci.yml', '.tool-versions', 'app/.keep', 'app/a b/c.rb', 'app/é.rb', 'app/x.rb', 'lib/deep/.hidden/x', 'vendor/sub', 'link-to-app', 'docs/devteam/project/settings.md', 'docs/devteam/scripts/devteam.mjs'];
  const comps = [{ name: 'api', owns: ['app/**', 'lib/**'] }, { name: 'ops', owns: ['.github/**', '.tool-versions', 'vendor/sub', 'link-to-app'] }];
  // dotfiles, dot-directories, spaces, non-ASCII, a submodule gitlink and a symlink are paths like any other
  assert.deepEqual(plain(coverage(paths, comps, DEV)), { unowned: [], contested: [], empty: [], case_collisions: [] });
  assert.equal(coverageClean(coverage(paths, comps, DEV)), true);
  assert.deepEqual(plain(coverage([...paths, 'scripts/x.sh'], comps, DEV)).unowned, ['scripts/x.sh'], 'a path no line owns');
  assert.deepEqual(plain(coverage(paths, [...comps, { name: 'web', owns: ['app/x.rb'] }], DEV)).contested, [['app/x.rb', ['api', 'web']]], 'a path two lines own');
  assert.deepEqual(plain(coverage(paths, [...comps, { name: 'web', owns: ['web/**'] }], DEV)).empty, ['web/**'], 'a glob that matches nothing is a typo');
  assert.deepEqual(plain(coverage(paths, [{ name: 'all', owns: ['**'] }], DEV)).contested.map(([p]) => p), ['docs/devteam/project/settings.md', 'docs/devteam/scripts/devteam.mjs'], "a declared glob reaching into the kit's line is contested with devteam");
  assert.deepEqual(plain(coverage(paths, [{ name: 'all' }], DEV)), { unowned: [], contested: [], empty: [], case_collisions: [] }, 'B2: a sole component with no owns owns everything devteam does not');
  assert.deepEqual(plain(coverage(paths, [{ name: 'a' }, { name: 'b', owns: ['app/**'] }], DEV)).unowned.length > 0, true, 'the ** default holds only for a sole component');
  assert.deepEqual(plain(coverage(['App.rb', 'app.rb'], [{ name: 'x', owns: ['App.rb', 'app.rb'] }], DEV)).case_collisions, [['App.rb', 'app.rb']], 'paths that differ only by case');
  assert.deepEqual(plain(coverage(['App.rb'], [{ name: 'x', owns: ['app.rb'] }], DEV)).unowned, ['App.rb'], 'matching is case-sensitive');
  // touches containment: the static prefix of a touches entry and who owns it
  assert.deepEqual(plain(prefixOwners('app/models/**', comps, DEV)), ['api']);
  assert.deepEqual(plain(prefixOwners('app', comps, DEV)), ['api'], 'a plain path is the folder and what is in it');
  assert.equal(prefixOwners('**/*.rb', comps, DEV), null, 'no static prefix');
  assert.deepEqual(plain(prefixOwners('docs/devteam/project/x', comps, DEV)), ['devteam']);
  const { ownersOf } = coverageFns();
  assert.deepEqual(plain(ownersOf('app/x.rb', comps, DEV)), ['api']);
  assert.deepEqual(plain(ownersOf('docs/devteam/scripts/devteam.mjs', [{ name: 'all' }], DEV)), ['devteam'], 'the ** default never reaches the kit\'s line');
});

test('coverage: the function reports a clean partition exactly when there is one (property)', () => {
  const { coverage, coverageClean, pathMatches } = coverageFns();
  // mulberry32: a seeded generator, so a failure names the seed that reproduces it
  const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
  let collided = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed);
    const dirs = ['a', 'a/b', '.c', 'd e', 'é', 'x/.y'];
    // 'f' and 'F' in one folder are a case collision, so some seeds exercise case_collisions
    const paths = [...new Set(Array.from({ length: 2 + Math.floor(r() * 12) }, () => `${pick(r, dirs)}/${pick(r, ['f', 'F', 'g.rb', '.h', 'Ö'])}`))];
    const candidates = [...dirs.map((d) => `${d}/**`), ...paths, '**/*.rb', 'nowhere/**'];
    const comps = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, i) => ({ name: `c${i}`, owns: Array.from({ length: 1 + Math.floor(r() * 3) }, () => pick(r, candidates)) }));
    const oracle = paths.every((p) => comps.filter((c) => c.owns.some((g) => pathMatches(g, p))).length === 1)
      && comps.every((c) => c.owns.every((g) => paths.some((p) => pathMatches(g, p))))
      && new Set(paths.map((p) => p.toLowerCase())).size === paths.length;
    assert.equal(coverageClean(coverage(paths, comps, [])), oracle, `seed ${seed}: ${JSON.stringify({ paths, comps })}`);
    // and a partition built to be clean always is: each path owned by exactly one exact-path glob
    const parts = comps.map((c) => ({ name: c.name, owns: [] }));
    paths.forEach((p, i) => parts[i % parts.length].owns.push(p));
    const live = parts.filter((c) => c.owns.length);
    const unique = new Set(paths.map((p) => p.toLowerCase())).size === paths.length;
    assert.equal(coverageClean(coverage(paths, live, [])), unique, `seed ${seed}: a built partition`);
    if (!unique) collided++;
  }
  assert.ok(collided > 0, 'some seeds produced a case collision');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test --test-name-pattern '^coverage:'`
Expected: FAIL with "/* globs start */ … /* globs end */ marks a block in devteam.mjs".

- [ ] **Step 3: Mark the glob helpers and add the block**

At `devteam.mjs:1187`, before the comment `// touches entries: a plain path matches itself …`, insert `/* globs start */`; after `globsOverlap` closes (line 1220) insert `/* globs end */`, then:

```js
/* coverage start */
// Component lines (spec §4): every tracked path matches exactly one component's owns, once the
// kit's own line (devteam) is set aside. Pure: the caller reads the tree and the settings, so the
// four places that enforce this (validate, check-pr and merge, observe-metrics, check-ticket) run
// the same function on the same kind of input.
//
// Who owns one path: 'devteam' first when it lies in the kit's line, then every component whose
// owns match it. A sole component with no owns owns everything devteam doesn't; with two or more,
// a component without owns owns nothing (validate says why). onHit(name, glob) counts glob hits.
// coverage, prefixOwners, coverageReport and checkTicket's footprint all ask this one function.
function ownersOf(p, components, devteamLine, onHit = null) {
  const owners = devteamLine.some((g) => pathMatches(g, p)) ? ['devteam'] : [];
  const sole = components.length === 1;
  for (const c of components) {
    if (c.owns === undefined) { if (sole && owners[0] !== 'devteam') owners.push(c.name); continue; }
    let mine = false;
    for (const g of c.owns) if (pathMatches(g, p)) { mine = true; if (onHit) onHit(c.name, g); }
    if (mine) owners.push(c.name);
  }
  return owners;
}
function coverage(paths, components, devteamLine) {
  const hits = new Map();
  for (const c of components) for (const g of c.owns ?? []) hits.set(`${c.name}\0${g}`, 0);
  const count = (name, g) => hits.set(`${name}\0${g}`, hits.get(`${name}\0${g}`) + 1);
  const unowned = [];
  const contested = [];
  for (const p of paths) {
    const owners = ownersOf(p, components, devteamLine, count);
    // a declared glob reaching into the kit's line is two owners for one path: devteam and it
    if (owners[0] === 'devteam') { if (owners.length > 1) contested.push([p, owners]); continue; }
    if (!owners.length) unowned.push(p);
    else if (owners.length > 1) contested.push([p, owners]);
  }
  const empty = [...hits].filter(([, n]) => n === 0).map(([k]) => k.slice(k.indexOf('\0') + 1));
  return { unowned, contested, empty, case_collisions: caseCollisions(paths) };
}
// Two tracked paths that differ only by case break a checkout on macOS and Windows.
function caseCollisions(paths) {
  const by = new Map();
  for (const p of paths) { const k = p.toLowerCase(); if (!by.has(k)) by.set(k, []); by.get(k).push(p); }
  return [...by.values()].filter((g) => g.length > 1).map((g) => [...g].sort());
}
function coverageClean(r) {
  return !r.unowned.length && !r.contested.length && !r.empty.length && !r.case_collisions.length;
}
// Who owns a touches entry's static prefix (the part before its first wildcard), by ownersOf.
// Null when there is no prefix (`**/*.rb` could be anywhere). A plain path is a folder and what is
// in it, as in touches, so both the path and the path with a trailing slash are asked.
function prefixOwners(entry, components, devteamLine) {
  const pre = staticPrefix(entry);
  if (!pre) return null;
  const probes = hasWild(entry) ? [pre] : [trimSlash(pre), `${trimSlash(pre)}/`];
  return [...new Set(probes.flatMap((p) => ownersOf(p, components, devteamLine)))];
}
/* coverage end */
```

- [ ] **Step 4: Run them to see them pass**

Run: `node --test --test-name-pattern '^coverage:'`
Expected: PASS (both tests).

- [ ] **Step 5: Run the G1 test and commit**

Run: `node --test --test-name-pattern 'G1:'` → PASS.

```bash
git add docs/devteam/scripts/devteam.mjs test/kit.test.mjs
git commit -m "coverage(): one pure function for component lines, with table and property tests"
```

---

### Task 3: The registry and component shapes, validated

**Files:**
- Modify: `devteam.mjs:172-225` (`SETTINGS_DEFAULTS`: add `links: {}`), `RUN_KNOWN` (move from `5900-5902` to after `runDir`, `166`), new section 2b after `loadSettings` (after line 277), `cmdValidate` (`devteam.mjs:1399-1537`, insert before line 1516 `for (const e of readLog().errors)`)
- Test: `test/kit.test.mjs` (new top-level test with a `monoFixture`)

**Interfaces:**
- Consumes: `canonical` (`devteam.mjs:237`), `git`, `mainRoot`, `runDir`, `readText`, `readJson`.
- Produces:
  - `RESERVED_LINKS = ['home', 'devteam']`, `LINK_ID` (the slug regex), `REPO_KEYS` (the nine per-repo keys), `COMPONENT_FIELDS = ['link', 'owns', 'shared', 'release']`
  - `LINK_KINDS: { [kind]: { fields: { required, optional }, ownerClass(field) → 'governance-edit'|'gate-change'|null, localOverrides: string[], hostsComponents: boolean, effectiveSettings(link, project) → object|null, validate(link, at, ctx) → string[], reachable(link, id) → string|null (local, memoized per process), probe(link, id) → string|null (network, once a day), fixHint(link, id) → string, locator(link, id) → { text, url?, remote? }, promptLine(link, id) → string, ownedByOwner: boolean (derived from ownerClass) } }`; `linkFields(kind) → string[]`
  - `RUN_KNOWN: Set<string>`, `runPath(name) → string` (registers the name), `LINKS_LOCAL` (`run/links.local.json`)
  - `remoteKey(remote: string) → string` (github `owner/name` lowercased, else an absolute path without `.git`)
  - `linkLocation(id) → string` (absolute: `run/links.local.json` path, else the committed `path`, else `../<id>`, relative to `mainRoot`)
  - `linesDeclared(settings) → boolean`, `componentsOn(settings, link = 'home') → {name, owns?, shared?}[]`, `componentLink(name, settings = loadSettings()) → string`
  - `registryProblems(settings) → { errors: string[], warnings: string[] }`
  - `kitRel` (module const), `devteamLine() → string[]`

- [ ] **Step 1: Write the monorepo fixture and the failing tests**

Add after the coverage tests:

```js
// A monorepo: home with three apps and its own kit, forge git, one gate. Lines are set with
// lines(...) and land on main as the supervisor's chore would.
function monoFixture(name) {
  const F = fleetFixture(name);
  const { old, g } = F;
  for (const f of ['api/app.rb', 'api/lib/x.rb', 'web/src/index.js', 'web/package.json', 'ops/deploy.sh', 'README.md', '.github/workflows/ci.yml']) write(path.join(old, f), `${f}\n`);
  g(['add', '-A'], old);
  g(['commit', '-qm', 'apps'], old);
  g(['push', '-q', 'origin', 'main'], old);
  const settingsFile = path.join(old, 'docs/devteam/project/settings.md');
  const edit = (fn, cwd = old) => {
    const f = path.join(cwd, 'docs/devteam/project/settings.md');
    const txt = fs.readFileSync(f, 'utf8');
    const m = txt.match(/```json devteam\s*\n([\s\S]*?)\n```/);
    const j = JSON.parse(m[1]);
    fn(j);
    fs.writeFileSync(f, txt.replace(m[1], () => JSON.stringify(j, null, 2)));
  };
  const lines = (components, extra = {}) => { edit((j) => { j.components = components; Object.assign(j, extra); }); g(['commit', '-qam', 'lines'], old); g(['push', '-q', 'origin', 'main'], old); };
  // every path init and fleetFixture track: AGENTS.md and .gitignore from init; config/dev.key is gitignored
  const STD = { api: { owns: ['api/**'] }, web: { owns: ['web/**'] }, ops: { owns: ['ops/**', '.github/**', 'README.md', '.gitignore', 'AGENTS.md'] } };
  return { ...F, settingsFile, edit, lines, STD };
}

test('the registry and component lines are validated; labels-only components and no links change nothing', () => {
  const F = monoFixture('registry');
  const { old, ok, run, lines, edit, g } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const v = () => { const r = run(old, ['validate']); return r.out + r.err; };
  try {
    // components written as labels before lines existed (a stack, a path): no new errors (open issue 1)
    lines({ api: { stack: 'rails', path: 'api' }, web: { stack: 'next' } });
    assert.doesNotMatch(v(), /component|owns|links/i, 'labels are not lines');
    // unknown kind, reserved ids, http, unknown field, duplicate remotes, home's own remote
    const bad = { bare: { kind: 'repo', title: 'Bare', remote: 'some-folder' }, console: { kind: 'repo', title: 'Console', remote: 'usbclub/console' }, dup: { kind: 'repo', title: 'Dup', remote: 'https://github.com/usbclub/console.git' }, home: { kind: 'url', title: 'x', url: 'https://x.test' }, figma: { kind: 'url', title: 'F', url: 'http://figma.test' }, notes: { kind: 'doc', title: 'D' }, self: { kind: 'repo', title: 'Self', remote: F.org }, extra: { kind: 'url', title: 'E', url: 'https://e.test', colour: 'red' } };
    lines({}, { links: bad });
    const out = v();
    assert.match(out, /links\.notes: unknown kind "doc" \(known: repo, url\)/);
    assert.match(out, /links\.home: "home" is reserved/);
    assert.match(out, /links\.figma: url must start with https:\/\//);
    assert.match(out, /links\.dup: the same remote as links\.console/);
    assert.match(out, /links\.self: the repo that holds the kit \(home\)/);
    assert.match(out, /links\.extra: "colour" is not a field of a url link/);
    assert.match(out, /links\.bare: remote "some-folder" is neither owner\/name nor a URL; a local remote is a path starting \.\/, \.\.\/ or \//);
    lines({}, { links: {} });
    // declared lines: object entries are reserved, negations refused, two owns-less components, a non-home link (open issue 13)
    lines({ api: { owns: ['api/**', { link: 'x', glob: 'y' }] }, web: { owns: ['!web/tmp/**', 'web/**'] }, ops: {}, misc: {}, none: { owns: [] }, console: { link: 'console' } });
    const o2 = v();
    assert.match(o2, /components\.api\.owns\[1\]: an object entry is reserved for a later release/);
    assert.match(o2, /components\.web\.owns\[0\]: negation patterns are refused/);
    assert.match(o2, /components ops and misc both have no owns on home/);
    assert.match(o2, /components\.none\.owns: an empty list owns nothing/);
    assert.match(o2, /components\.console: link "console" is not in links/);
    // m1: a ticket whose component is a reserved slug is reported once, with the rename
    lines(F.STD);
    ok(old, ['ticket', 'add', 'home-01-x', '--json', JSON.stringify({ title: 'x', feature: 'chores', component: 'home', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['api/**'], done_when: ['the api check passes'], notes: 'n' })], SUP);
    assert.match(v(), /tickets home-01-x: component "home" is reserved/);
  } finally { F.done(); }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern 'the registry and component lines are validated'`
Expected: FAIL on the first `assert.match` for `links.notes`.

- [ ] **Step 3: Add `links: {}` to the defaults and the section 2b code**

In `SETTINGS_DEFAULTS` (`devteam.mjs:197`), after `components: {},` add:

```js
  // Named resources the fleet uses (spec §3.1): { "<id>": { "kind": "repo"|"url", "title": …, … } }.
  links: {},
```

After `loadSettings` ends (line 277), insert section 2b:

```js
// ===== 2b. links and component lines (the registry) =====
//
// A link is a named resource the fleet uses; a repo link is one devteam can also operate on; a
// component is a line drawn over a repo link: the files it owns. home is the repo that holds the
// kit and project/, never declared; devteam is the kit's own line, computed (spec §3, §4).
const RESERVED_LINKS = ['home', 'devteam'];
const LINK_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
// The settings a repo link may carry for itself (spec §3.3). The first four default to the
// project's; every other key is never inherited, so a repo with no gates is refused by merge like
// home with none, and a per-repo key added later gets the no-inherit rule by default.
const REPO_KEYS = ['main_branch', 'forge', 'merge_method', 'release', 'gates', 'worktree_setup', 'worktree_files', 'ignored_checks', 'project'];
const REPO_INHERITED = ['main_branch', 'forge', 'merge_method', 'release'];
const REPO_OWN = REPO_KEYS.filter((k) => !REPO_INHERITED.includes(k));
const REPO_OWN_DEFAULTS = { gates: {}, worktree_setup: '', worktree_files: [], ignored_checks: [], project: 'docs/devteam/project' };
// what a gate run sees is the owner's gate-change, as for home's own keys (OWNER_SETTINGS)
const REPO_GATE_KEYS = ['gates', 'worktree_setup', 'worktree_files', 'ignored_checks'];
const LINK_COMMON = ['kind', 'title', 'notes', 'for', 'source'];
// Whether a repo checkout is where its link says and of its remote, once per process per location.
const linkReachMemo = new Map();
// The url probe: a child node does one HEAD request with a 10 s deadline and prints the status.
const PROBE_JS = "fetch(process.argv[1],{method:'HEAD',redirect:'follow',signal:AbortSignal.timeout(10000)}).then((r)=>console.log(r.status)).catch(()=>console.log(0))";
// A local remote is a path, written so nobody mistakes it for owner/name: ./, ../ or absolute.
const localRemote = (r) => !/^[a-z][a-z0-9+.-]*:\/\//i.test(r) && !/^[\w.-]+@[\w.-]+:/.test(r) && !/^[\w.-]+\/[\w.-]+$/.test(r);
// Every per-kind behaviour of a link (spec §3.1). A new kind (doc, dataset, mcp) is one entry here;
// nothing outside this table branches on a kind.
const LINK_KINDS = {
  repo: {
    fields: { required: ['remote'], optional: ['path', ...REPO_KEYS] },
    // where the checkout is on this machine is never the owner's (§3.5); what a gate run sees is
    // gate-change; anything else about a repo devteam merges into is governance-edit (open issue 4)
    ownerClass: (field) => (field === 'path' ? null : REPO_GATE_KEYS.includes(field) ? 'gate-change' : 'governance-edit'),
    localOverrides: ['path'],
    hostsComponents: true,
    effectiveSettings: (link, project) => ({ ...Object.fromEntries(REPO_INHERITED.map((k) => [k, link[k] ?? project[k]])), ...Object.fromEntries(REPO_OWN.map((k) => [k, link[k] ?? REPO_OWN_DEFAULTS[k]])) }),
    // shape problems of one entry; ctx carries what spans entries (home's origin, remotes seen)
    validate: (l, at, ctx) => {
      const errs = [];
      if (typeof l.remote !== 'string') return errs;
      if (localRemote(l.remote) && !/^(\.{1,2}\/|\/)/.test(l.remote)) errs.push(`${at}: remote "${l.remote}" is neither owner/name nor a URL; a local remote is a path starting ./, ../ or /`);
      const k = remoteKey(l.remote);
      if (ctx.homeOrigin && k === remoteKey(ctx.homeOrigin)) errs.push(`${at}: the repo that holds the kit (home) is never a link`);
      else if (fs.existsSync(linkLocation(ctx.id)) && realOrSelf(linkLocation(ctx.id)) === realOrSelf(mainRoot)) errs.push(`${at}: its path is the repo that holds the kit (home)`);
      if (ctx.remotes.has(k)) errs.push(`${at}: the same remote as links.${ctx.remotes.get(k)}`);
      else ctx.remotes.set(k, ctx.id);
      if (l.project !== undefined && (typeof l.project !== 'string' || !REPO_PATH.test(l.project))) errs.push(`${at}: project is a path inside that repo`);
      return errs;
    },
    // local and cheap: metrics asks it live
    reachable: (link, id) => {
      const at = linkLocation(id);
      const key = `${id}\0${at}\0${link.remote}`;
      if (linkReachMemo.has(key)) return linkReachMemo.get(key);
      let why = null;
      if (!fs.existsSync(at)) why = `its checkout ${at} is missing (set path, or run/links.local.json on this machine)`;
      else {
        const origin = git(['config', '--get', 'remote.origin.url'], at);
        if (origin === null) why = `${at} is not a git checkout with an origin`;
        else if (remoteKey(origin) !== remoteKey(link.remote)) why = `${at} is a checkout of ${origin}, not ${link.remote}`;
      }
      linkReachMemo.set(key, why);
      return why;
    },
    // over the network, once a day (probeLinks): the remote still answers. Only asked once the
    // checkout is there, through its own origin, so a test's local bare repo is all it contacts.
    probe: (link, id) => {
      if (LINK_KINDS.repo.reachable(link, id)) return null;
      const r = spawnSync('git', ['ls-remote', '--exit-code', '-q', 'origin', 'HEAD'], { cwd: linkLocation(id), stdio: 'ignore', timeout: 12000 });
      return r.status === 0 ? null : `its remote ${link.remote} does not resolve`;
    },
    fixHint: (link, id) => `clone ${link.remote} at ${linkLocation(id)}, or set its path (run/links.local.json on this machine)`,
    // where it is, for a person, a question and the dashboard
    locator: (link, id) => ({ text: `repo ${link.remote} at ${linkLocation(id)} (${fs.existsSync(linkLocation(id)) ? 'found' : 'missing'})`, remote: link.remote }),
    promptLine: (link, id) => `- ${link.title} (repo ${link.remote}, checked out at ${linkLocation(id)}; read it for reference, change it only through a ticket in it)${link.notes ? `: ${link.notes}` : ''} [link:${id}]`,
  },
  url: {
    fields: { required: ['url'], optional: ['check'] },
    // a url link is the supervisor's, edited by registry-edit acts (§3.4, §7)
    ownerClass: () => null,
    localOverrides: [],
    hostsComponents: false,
    effectiveSettings: () => null,
    validate: (l, at) => [
      ...(typeof l.url === 'string' && !l.url.startsWith('https://') ? [`${at}: url must start with https://`] : []),
      ...(l.check !== undefined && typeof l.check !== 'boolean' ? [`${at}: check is true or false`] : []),
    ],
    reachable: () => null,
    // one HEAD request, 10 s, no body read (spec §7); DEVTEAM_URL_PROBE stands in for it in tests
    probe: (link) => {
      if (link.check === false) return null;
      const r = process.env.DEVTEAM_URL_PROBE ? spawnSync(process.env.DEVTEAM_URL_PROBE, [link.url], { encoding: 'utf8', timeout: 12000 }) : spawnSync(process.execPath, ['-e', PROBE_JS, link.url], { encoding: 'utf8', timeout: 12000 });
      const code = Number((r.stdout ?? '').trim());
      return !code ? 'no answer to a HEAD request in 10 s' : code >= 400 ? `HEAD returned ${code}` : null;
    },
    fixHint: () => 'fix or remove the link (link set|rm), or "check": false for a page behind auth',
    locator: (link) => ({ text: link.url, url: link.url }),
    promptLine: (link, id) => `- ${link.title} (${link.url})${link.notes ? `: ${link.notes}` : ''} [link:${id}]`,
  },
};
// A kind is the owner's when any of its fields is (repo); otherwise the supervisor's (url). Derived,
// so a new kind's entry says it once, in ownerClass.
for (const K of Object.values(LINK_KINDS)) K.ownedByOwner = [...LINK_COMMON.filter((f) => f !== 'kind'), ...K.fields.required, ...K.fields.optional].some((f) => K.ownerClass(f));
const linkFields = (kind) => (LINK_KINDS[kind] ? [...LINK_COMMON, ...LINK_KINDS[kind].fields.required, ...LINK_KINDS[kind].fields.optional] : LINK_COMMON);
// A remote's identity: owner/name for GitHub, however written; anything else is a URL or a path.
// Read a checkout's origin with `git config --get remote.origin.url`, the URL as configured:
// `git remote get-url` expands url.<base>.insteadOf, which would make a mirror look like another repo.
const remoteKey = (r) => {
  const s = String(r ?? '').trim().replace(/\/+$/, '');
  const gh = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)?([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(s);
  if (gh && !/^[./]/.test(s)) return gh[1].toLowerCase();
  return /^[a-z]+:\/\//i.test(s) ? s.replace(/\.git$/, '') : realOrSelf(path.resolve(mainRoot, s)).replace(/\.git$/, '');
};
// Where a link's checkout is on this machine: run/links.local.json (untracked), the committed path,
// or ../<id>, relative to home's main checkout (§3.5). PR 2 adds --path on the command line.
function linkLocation(id) {
  let local = {};
  try { local = readJson(LINKS_LOCAL); } catch {}
  const at = local?.[id]?.path ?? loadSettings().links?.[id]?.path ?? `../${id}`;
  return path.resolve(mainRoot, at);
}
// A component map draws lines only once an entry says so (open issue 1): before that its entries
// are labels a project wrote before lines existed, and nothing here applies to them.
const COMPONENT_FIELDS = ['link', 'owns', 'shared', 'release'];
const linesDeclared = (s) => Object.values(s?.components ?? {}).some((c) => isObj(c) && COMPONENT_FIELDS.some((k) => k in c));
const componentLink = (name, s = loadSettings()) => (linesDeclared(s) ? s.components?.[name]?.link ?? 'home' : 'home');
const componentsOn = (s, link = 'home') => (linesDeclared(s) ? Object.entries(s.components).filter(([, c]) => (c?.link ?? 'home') === link).map(([name, c]) => ({ name, owns: Array.isArray(c.owns) ? c.owns.filter((g) => typeof g === 'string') : undefined, shared: !!c.shared })) : []);
// The kit's own files: the kit folder and the project folder, wherever --project moved it.
// (upstreamSyncApproval computed the same kitRel inline at line 2195; it now uses this one.)
const kitRel = path.relative(repoRoot, devteamDir).split(path.sep).join('/');
const devteamLine = () => [...(kitRel && !kitRel.startsWith('..') ? [`${kitRel}/**`] : []), ...(projectInRepo ? [`${projectRel}/**`] : [])];
// The kit's own repo has no lines: everything in it is the kit (§4, open issue 5).
const kitsOwnRepo = () => { const o = git(['config', '--get', 'remote.origin.url']); return !!o && remoteKey(o) === remoteKey(loadSettings().upstream_repo ?? ''); };

// Every problem with the registry and the lines, worded for validate. Shape only: coverage of a
// tree is coverage()'s, and runs on committed settings (§4). Per-kind checks are LINK_KINDS[k].validate.
function registryProblems(s) {
  const errors = [];
  const warnings = [];
  const links = s.links ?? {};
  if (!isObj(links)) return { errors: ['settings links: an object of { "<id>": { kind, title, … } }'], warnings };
  const ctx = { homeOrigin: git(['config', '--get', 'remote.origin.url']), remotes: new Map() };
  for (const [id, l] of Object.entries(links)) {
    const at = `links.${id}`;
    if (RESERVED_LINKS.includes(id)) { errors.push(`${at}: "${id}" is reserved (home is the repo that holds the kit; devteam is the kit's own line)`); continue; }
    if (!LINK_ID.test(id)) { errors.push(`${at}: an id is lowercase words joined by hyphens`); continue; }
    if (!isObj(l)) { errors.push(`${at}: an object`); continue; }
    const K = LINK_KINDS[l.kind];
    if (!K) { errors.push(`${at}: unknown kind "${l.kind ?? ''}" (known: ${Object.keys(LINK_KINDS).join(', ')})`); continue; }
    for (const f of ['title', ...K.fields.required]) if (l[f] === undefined || l[f] === '') errors.push(`${at}: ${f} is required`);
    const known = new Set(linkFields(l.kind));
    for (const f of Object.keys(l)) if (!known.has(f)) errors.push(`${at}: "${f}" is not a field of a ${l.kind} link (fields: ${[...known].join(', ')})`);
    for (const sc of asList(l.for)) if (!scopeValid(sc, 'for')) errors.push(`${at}: for "${sc}" is not a scope (${SCOPE_HELP.for})`);
    errors.push(...K.validate(l, at, { ...ctx, id }));
  }
  if (!linesDeclared(s)) return { errors, warnings };
  if (kitsOwnRepo()) errors.push("components: the kit's own repo draws no lines (every file in it is the kit's)");
  const byLink = new Map();
  for (const [name, c] of Object.entries(s.components)) {
    const at = `components.${name}`;
    if (RESERVED_LINKS.includes(name)) { errors.push(`${at}: "${name}" is reserved`); continue; }
    if (!LINK_ID.test(name)) { errors.push(`${at}: a component id is lowercase words joined by hyphens`); continue; }
    if (!isObj(c)) { errors.push(`${at}: an object ({ "link": …, "owns": [globs], "shared": true })`); continue; }
    for (const f of Object.keys(c)) if (!COMPONENT_FIELDS.includes(f)) errors.push(`${at}: "${f}" is not a component field (${COMPONENT_FIELDS.join(', ')})`);
    const link = c.link ?? 'home';
    if (link !== 'home') {
      if (!links[link]) errors.push(`${at}: link "${link}" is not in links`);
      else if (!LINK_KINDS[links[link].kind]?.hostsComponents) errors.push(`${at}: link "${link}" is a ${links[link].kind} link, which holds no files`);
      else errors.push(`${at}: link "${link}": only home holds components and tickets in this release`);
    }
    if (c.owns !== undefined && !Array.isArray(c.owns)) errors.push(`${at}.owns: a list of globs`);
    // an empty list is a line around nothing; leave owns out for the sole-component ** default
    else if (Array.isArray(c.owns) && !c.owns.length) errors.push(`${at}.owns: an empty list owns nothing (leave owns out for a sole component that owns everything)`);
    asList(c.owns).forEach((g, i) => {
      if (isObj(g)) errors.push(`${at}.owns[${i}]: an object entry is reserved for a later release (a component spanning repos)`);
      else if (typeof g !== 'string' || !g) errors.push(`${at}.owns[${i}]: a glob`);
      else if (g.startsWith('!')) errors.push(`${at}.owns[${i}]: negation patterns are refused; draw the line with what it owns`);
      else if (unbalanced(g)) errors.push(`${at}.owns[${i}]: "${g}" has unbalanced braces`);
    });
    if (c.shared !== undefined && typeof c.shared !== 'boolean') errors.push(`${at}.shared: true or false`);
    if (c.release !== undefined && !(isObj(c.release) && typeof c.release.tag === 'string' && Object.keys(c.release).length === 1)) errors.push(`${at}.release: { "tag": "<glob>" }, e.g. { "tag": "web/v*" }`);
    (byLink.get(link) ?? byLink.set(link, []).get(link)).push([name, c]);
  }
  for (const [link, cs] of byLink) {
    const bare = cs.filter(([, c]) => c?.owns === undefined).map(([n]) => n);
    if (bare.length && cs.length > 1) errors.push(`components ${bare.join(' and ')} ${bare.length > 1 ? 'both have' : 'has'} no owns on ${link}: a component without owns owns everything only while it is the only one there`);
  }
  return { errors, warnings };
}
```

`asList`, `isObj` (`devteam.mjs:3028`), `REPO_PATH` (`devteam.mjs:2758`), `realOrSelf` (`devteam.mjs:4589`), and `unbalanced` (`1190`) are defined elsewhere in the file; every function above runs only inside a command, after the module finished loading, so the order is safe. `LINKS_LOCAL` is the run-file registry's path (Step 3b). `scopeValid` and `SCOPE_HELP` arrive in Task 10; until then add this stub right above `registryProblems` and replace it in Task 10:

```js
const SCOPE_HELP = { for: 'all, project, component:<c>, feature:<f>, goal:<g> or link:<id>' };
const scopeValid = (sc) => /^(all|project|(component|feature|goal|link):[a-z0-9-]+)$/.test(String(sc));
```

- [ ] **Step 3b: run/ files register themselves**

Fleet status refuses to move a machine while `run/` holds a file the kit didn't make (`fleetStatus`, `devteam.mjs:6087`, against `RUN_KNOWN`, `5902`). New run files (`links.local.json` here, `link-probes.json` in Task 15) must not trip it, and the next one shouldn't need a second edit. Delete `RUN_KNOWN` at `devteam.mjs:5900-5902` and define it right after `runDir` (`devteam.mjs:166`):

```js
// What run/ holds that the kit made and rebuilds (or that is this machine's alone by nature);
// anything else in it was put there by hand and doesn't move. A writer names its file through
// runPath where it defines the path, so the list can't fall behind the files.
const RUN_KNOWN = new Set(['log', 'prompts', 'questions', 'sent', 'cache', 'agent', 'pr', 'supervisor-pane', 'dashboard.log', 'supervisor-prompt.txt', '.DS_Store']);
const runPath = (name) => { RUN_KNOWN.add(name); return path.join(runDir, name); };
// Where this machine's checkouts of repo links are, when not where settings say (§3.5).
const LINKS_LOCAL = runPath('links.local.json');
```

The existing names stay in the initial set (their writers predate the registry), so `fleet status` is unchanged for a single-repo project.

- [ ] **Step 4: Report them from validate**

In `cmdValidate`, before line 1516 (`for (const e of readLog().errors) warnings.push(...)`), insert:

```js
  // The registry and the lines (spec §3). Labels-only components and an empty registry print nothing.
  {
    const s = loadSettings();
    const reg = registryProblems(s);
    errors.push(...reg.errors);
    warnings.push(...reg.warnings);
    // A reserved slug as a component prefix: the one G1 exception, only for a project already using it.
    const reserved = [...ts.values()].filter((t) => RESERVED_LINKS.includes(t.component)).map((t) => t.id);
    if (reserved.length) errors.push(`tickets ${reserved.join(', ')}: component "${[...new Set(reserved.map((id) => ts.get(id).component))].join('" and "')}" is reserved (home is the repo that holds the kit, devteam the kit's own files); rename the component: supersede each ticket with one under another component (ticket add <new-id>, ticket set <old-id> --json '{"superseded_by": "<new-id>"}')`);
  }
```

- [ ] **Step 5: Run the test to see it pass, then G1**

Run: `node --test --test-name-pattern 'the registry and component lines are validated|G1:'`
Expected: PASS for both.

- [ ] **Step 6: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/kit.test.mjs
git commit -m "Registry and component lines: LINK_KINDS, shapes validated; labels-only components and no links change nothing"
```

---

### Task 4: Owner settings per entry: repo links pinned to main

**Files:**
- Modify: `ownerSettingsChanged` (`devteam.mjs:245-249`), `loadSettings` (`devteam.mjs:251-277`)
- Test: `test/kit.test.mjs` (new top-level test)

**Interfaces:**
- Consumes: `LINK_KINDS[kind].ownerClass` and `.ownedByOwner` (Task 3), `canonical`.
- Produces: `linkOwnerChanges(a, b) → {key, cls}[]` (keys `links.<id>` or `links.<id>.<field>`); `ownerSettingsChanged(base, head)` returns today's list followed by those; `pinOwnedLinks(local, onMain) → { links, changed: string[] }`, `ownersKind(link) → boolean`.

- [ ] **Step 1: Write the failing tests**

```js
test('owner settings per entry: repo-link fields have classes, url links are the supervisor\'s, and repo links count as on main', () => {
  const F = monoFixture('owner-entries');
  const { old, ok, run, g, edit } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const body = path.join(F.base, 'body.md');
  write(body, '## One-way doors\n\nNone.\n');
  try {
    const repoLink = { kind: 'repo', title: 'Console', remote: 'usbclub/console' };
    edit((j) => { j.links = { console: repoLink, figma: { kind: 'url', title: 'Designs', url: 'https://figma.test/a' } }; });
    g(['commit', '-qam', 'links'], old);
    g(['push', '-q', 'origin', 'main'], old);
    const chore = (slug, fn) => {
      const w = path.join(old, '.worktrees', `chore-${slug}`);
      g(['worktree', 'add', '-q', '-b', `chore-${slug}`, w, 'origin/main'], old);
      edit(fn, w);
      g(['commit', '-qam', slug], w);
      g(['push', '-q', 'origin', `chore-${slug}`], w);
      write(path.join(old, `docs/devteam/run/pr/chore-${slug}.md`), `# chore-${slug}: x\n\n## One-way doors\n\nNone.\n`);
      const r = run(old, ['merge', '--chore', slug, '--dry-run'], SUP);
      g(['worktree', 'remove', '--force', w], old);
      return r.out + r.err;
    };
    assert.doesNotMatch(chore('figma', (j) => { j.links.figma.title = 'All designs'; j.links.figma.for = ['all']; }), /owner settings/, 'url-link edits are the supervisor\'s');
    assert.match(chore('gates', (j) => { j.links.console.gates = { test: 'npm test' }; }), /changes owner settings: links\.console\.gates \(gate-change\)/);
    assert.match(chore('remote', (j) => { j.links.console.remote = 'usbclub/console2'; }), /links\.console\.remote \(governance-edit\)/);
    assert.match(chore('add', (j) => { j.links.companion = { kind: 'repo', title: 'C', remote: 'usbclub/companion' }; }), /links\.companion \(governance-edit\)/);
    assert.match(chore('flip', (j) => { j.links.console = { kind: 'url', title: 'C', url: 'https://c.test' }; }), /links\.console \(governance-edit\)/, 'a repo→url flip is a repo removal');
    assert.doesNotMatch(chore('path', (j) => { j.links.console.path = '../elsewhere'; }), /owner settings/, 'where the checkout is is never the owner\'s');
    // M2: working-tree flips and removals are ignored; repo links count as on main
    const settings = () => json(ok(old, ['settings']));
    edit((j) => { j.links.console = { kind: 'url', title: 'flip', url: 'https://c.test' }; j.links.added = { kind: 'repo', title: 'A', remote: 'usbclub/added' }; j.links.figma.notes = 'working tree'; j.links.fresh = { kind: 'url', title: 'Fresh', url: 'https://fresh.test' }; });
    const s1 = run(old, ['settings']);
    assert.deepEqual(json(s1.out).links.console, repoLink, 'a url flip of a repo link on main is ignored');
    assert.equal(json(s1.out).links.added, undefined, 'a repo link not on main is dropped');
    assert.equal(json(s1.out).links.figma.notes, 'working tree', 'url links come from the working tree');
    assert.equal(json(s1.out).links.fresh.title, 'Fresh');
    assert.match(s1.err, /settings\.md here changes links\.added, links\.console; owner settings apply as they are on/);
    edit((j) => { delete j.links.console; });
    assert.deepEqual(settings().links.console, repoLink, 'a working-tree removal of a repo link is ignored');
    g(['checkout', '-q', '--', 'docs/devteam/project/settings.md'], old);
    edit((j) => { j.links.figma = { kind: 'repo', title: 'F', remote: 'usbclub/figma' }; });
    assert.equal(settings().links.figma.kind, 'url', 'a url→repo flip in the working tree is ignored');
    g(['checkout', '-q', '--', 'docs/devteam/project/settings.md'], old);
  } finally { F.done(); }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern 'owner settings per entry'`
Expected: FAIL on `links.console.gates (gate-change)`.

- [ ] **Step 3: Diff the links entry by entry**

Replace `ownerSettingsChanged` (`devteam.mjs:245-249`) with:

```js
// The owner's settings a commit changes against a base: [{ key, cls }], or null if unreadable.
// Whole keys as before, then the links registry entry by entry (§3.4).
function ownerSettingsChanged(base, head) {
  const a = settingsAt(base), b = settingsAt(head);
  if (!a || !b) return null;
  return [...Object.entries(OWNER_SETTINGS).filter(([k]) => canonical(a[k]) !== canonical(b[k])).map(([key, cls]) => ({ key, cls })), ...linkOwnerChanges(a.links, b.links)];
}
// A link is classified by both sides: an owner's kind (LINK_KINDS[k].ownedByOwner: repo) on
// either side makes every change to it the owner's; an add, a removal or a kind flip is
// governance-edit on the whole entry; a field change takes that kind's ownerClass(field).
const ownersKind = (l) => !!l && !!LINK_KINDS[l.kind]?.ownedByOwner;
function linkOwnerChanges(a = {}, b = {}) {
  const out = [];
  for (const id of [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort()) {
    const x = a?.[id], y = b?.[id];
    if (!ownersKind(x) && !ownersKind(y)) continue;
    if (!x || !y || x.kind !== y.kind) { out.push({ key: `links.${id}`, cls: 'governance-edit' }); continue; }
    for (const f of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
      const cls = canonical(x[f]) === canonical(y[f]) ? null : LINK_KINDS[x.kind].ownerClass(f);
      if (cls) out.push({ key: `links.${id}.${f}`, cls });
    }
  }
  return out;
}
```

- [ ] **Step 4: Pin repo links to main in `loadSettings`**

In `loadSettings`, replace the block at `devteam.mjs:269-274` (`if (onMain) { … }`) with:

```js
    if (onMain) {
      const local = Object.keys(OWNER_SETTINGS).filter((k) => canonical(settingsCache[k]) !== canonical(onMain[k]));
      for (const k of local) settingsCache[k] = onMain[k];
      const pinned = pinOwnedLinks(settingsCache.links, onMain.links);
      settingsCache.links = pinned.links;
      local.push(...pinned.changed);
      if (local.length && !process.env.DEVTEAM_QUIET_SETTINGS) { process.env.DEVTEAM_QUIET_SETTINGS = '1'; warn(`settings.md here changes ${local.join(', ')}; owner settings apply as they are on ${ref} until a PR with the owner's answer lands them`); }
    }
```

and add after `loadSettings`:

```js
// Links of an owner's kind (repo) count as main has them, verbatim: a working-tree edit, removal
// or kind flip of one is ignored, and a working-tree one main lacks is dropped. The supervisor's
// kinds (url) come from the working tree, so a new one reaches the next prompt before it lands (§3.4).
function pinOwnedLinks(local = {}, main = {}) {
  const links = {};
  const changed = [];
  for (const id of [...new Set([...Object.keys(main ?? {}), ...Object.keys(local ?? {})])].sort()) {
    const m = main?.[id], l = local?.[id];
    if (ownersKind(m) || ownersKind(l)) {
      if (m) links[id] = m;
      if (canonical(m) !== canonical(l)) changed.push(`links.${id}`);
    } else if (l) links[id] = l;
  }
  return { links, changed };
}
```

- [ ] **Step 5: Run the test, the existing owner-settings test and G1**

Run: `node --test --test-name-pattern 'owner settings per entry|changes owner settings needs an answered|G1:'`
Expected: PASS. The existing `a PR of any kind that changes owner settings …` subtest runs inside the long `devteam kit` test; run the whole file in Step 6.

- [ ] **Step 6: Full suite, then commit**

Run: `node --test` → `ℹ fail 0`.

```bash
git add docs/devteam/scripts/devteam.mjs test/kit.test.mjs
git commit -m "Owner settings per link entry; repo links count as main has them, url links come from the working tree"
```

---

### Task 5: `treePaths`, byte-identical `changedFiles`, and `components check`

**Files:**
- Modify: `settingsAt` (`devteam.mjs:238-243`); `changedFiles` (`devteam.mjs:1970`) becomes `gitFacts`; add `homeFacts`, `settingsInForce`, `coverageAt`, `coverageGaps` after it; add `cmdComponents` before `// ===== 12. init, help, dispatch =====` (line 6481); `COMMANDS` (`6684`) and `HELP` (`6605`)
- Test: `test/kit.test.mjs`

**Interfaces:**
- Produces:
  - `gitFacts(gitFn) → { changedFiles, treePaths, mergeTree }`; home's: `treePaths(ref) → string[]` (`git ls-tree -r -z --name-only <ref>`), `changedFiles(base, sha) → string[]` (`git diff -z --name-only --no-renames`), `mergeTree(base, sha) → string|null`
  - `homeFacts` (`{ name: 'home', changedFiles, treePaths, mergeTree, mainRef(), git(), devteamLine(), settings }`): the default repo argument of every coverage helper; PR 2's `repo(name)` objects carry the same fields
  - `settingsAt(ref, { orNull })`: `orNull` gives null when `settings.md` is not at `ref`
  - `settingsInForce(base, sha, R = homeFacts) → settings` (home main's committed settings, or `settingsAt(sha)` when `base..sha` changes `settings.md`; always home main's for another repo)
  - `coverageAt(ref, s, R = homeFacts) → coverage result | null` (null while no lines are declared)
  - `coverageReport(cov, s, R = homeFacts) → string[]`, `treePathsMemo(ref, R = homeFacts)`
  - `coverageGaps(cov, s) → { unowned, contested, empty, unlinked: string[], case_collisions, count }`
  - command `components check [--ref r] [--count] [--json]`

- [ ] **Step 1: Write the failing tests**

```js
test('components check reads a commit\'s tree: dotfiles, gitlinks, symlinks, spaces, unicode; never the index', () => {
  const F = monoFixture('components-check');
  const { old, ok, run, g, lines } = F;
  try {
    assert.match(ok(old, ['components', 'check']), /no component lines declared/, 'labels-only or none: nothing to check');
    assert.equal(ok(old, ['components', 'check', '--count']), '0');
    // a submodule gitlink, a symlink, a dot-directory, a space, a non-ASCII name
    const sub = path.join(F.base, 'sub');
    g(['init', '-q', '-b', 'main', sub], F.base);
    write(path.join(sub, 'x'), 'x\n');
    g(['add', 'x'], sub);
    g(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x'], sub);
    g(['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'vendor/sub'], old);
    fs.symlinkSync('api', path.join(old, 'api-link'));
    write(path.join(old, 'api/.hidden/deep/x.rb'), 'x\n');
    write(path.join(old, 'api/with space.rb'), 'x\n');
    write(path.join(old, 'api/é.rb'), 'x\n');
    g(['add', '-A'], old);
    g(['commit', '-qm', 'shapes'], old);
    g(['push', '-q', 'origin', 'main'], old);
    lines({ ...F.STD, ops: { owns: [...F.STD.ops.owns, '.gitmodules', 'vendor/sub', 'api-link'] } });
    ok(old, ['components', 'check']);
    assert.equal(ok(old, ['components', 'check', '--count']), '0');
    // M4: a staged, uncommitted file is not in any tree
    write(path.join(old, 'stray.txt'), 'staged only\n');
    g(['add', 'stray.txt'], old);
    ok(old, ['components', 'check']);
    g(['reset', '-q', 'stray.txt'], old);
    fs.rmSync(path.join(old, 'stray.txt'));
    // committed but owned by nobody: unowned, grouped by folder, with a suggested owner
    write(path.join(old, 'api/new/one.rb'), '1\n');
    write(path.join(old, 'scripts/run.sh'), '1\n');
    g(['add', '-A'], old);
    g(['commit', '-qm', 'stray'], old);
    lines({ ...F.STD, api: { owns: ['api/*.rb', 'api/lib/**', 'api/.hidden/**', 'api/app.rb'] }, ops: { owns: [...F.STD.ops.owns, '.gitmodules', 'vendor/sub', 'api-link', 'docs/nowhere/**'] } });
    const r = run(old, ['components', 'check']);
    assert.equal(r.status, 1);
    assert.match(r.out, /unowned: api\/new\/ \(1\): api\/new\/one\.rb; suggested owner: api/);
    assert.match(r.out, /unowned: scripts\/ \(1\): scripts\/run\.sh/);
    assert.match(r.out, /empty: ops owns "docs\/nowhere\/\*\*", which matches nothing/);
    assert.doesNotMatch(r.out, /contested: api\/app\.rb/, 'two globs of one component are still one owner');
    assert.equal(run(old, ['components', 'check', '--count']).out, '3');
    const j = json(run(old, ['components', 'check', '--json']).out);
    assert.deepEqual(j.unowned.sort(), ['api/new/one.rb', 'scripts/run.sh']);
    // --ref reads that commit's tree and that commit's settings
    ok(old, ['components', 'check', '--ref', 'HEAD~2']);
  } finally { F.done(); }
});
```

(`api/new/one.rb` has no owned sibling in `api/new/`; the suggestion comes from the nearest folder above it that has one, `api/`, and never from the repo root.)

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern 'components check reads'`
Expected: FAIL with `unknown command "components"`.

- [ ] **Step 3: The tree reader and the settings that decide**

Replace `changedFiles` (`devteam.mjs:1970`) with one factory for the tree reads, so home and (in PR 2) every repo link share the bodies:

```js
// The three tree reads every repo needs, over one git function (home's, or a repo link's bound to
// its checkout). changedFiles is -z: no quoting of spaces or non-ASCII, so every enforcement point
// compares the same bytes treePaths gives (§4; rev 1 compared quoted octal with raw). treePaths
// reads a commit's tree (or a tree id): dotfiles, submodule gitlinks and symlinks included, never
// the index or the working tree. mergeTree is what landing sha on base would produce, as a tree
// id, or null when it doesn't merge cleanly.
const gitFacts = (gitFn) => ({
  changedFiles: (base, sha) => (gitFn(['diff', '-z', '--name-only', '--no-renames', base, sha]) ?? '').split('\0').filter(Boolean),
  treePaths: (ref) => (gitFn(['ls-tree', '-r', '-z', '--name-only', ref]) ?? '').split('\0').filter(Boolean),
  mergeTree: (base, sha) => { const t = gitFn(['merge-tree', '--write-tree', '--no-messages', base, sha])?.split('\n')[0]; return t && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(t) ? t : null; },
});
const { changedFiles, treePaths, mergeTree } = gitFacts((args, cwd) => git(args, cwd));
// Home as the coverage code sees a repo. Every coverage helper takes a repo argument defaulting to
// this, so PR 2's repo(name) objects (which carry the same fields) slot in without new call shapes.
const homeFacts = {
  name: 'home', changedFiles, treePaths, mergeTree,
  mainRef: () => mainRef(), git: (args, cwd) => git(args, cwd), devteamLine: () => devteamLine(),
  get settings() { return loadSettings(); },
};
// The settings that judge a PR (§4, "Which settings decide"): main's, committed, or the head's
// when the PR itself changes settings.md. Never the working tree's. settings.md lives in home, so
// for a PR in another repo (PR 2) they are home main's: that repo's diff can't touch it.
function settingsInForce(base, sha, R = homeFacts) {
  const mainS = () => (mainRef() ? settingsAt(mainRef(), { orNull: true }) : null) ?? { ...SETTINGS_DEFAULTS };
  if (R.name !== 'home') return mainS();
  const changes = !!base && !!sha && git(['diff', '--quiet', base, sha, '--', `${projectRel}/settings.md`]) === null;
  const head = changes ? settingsAt(sha, { orNull: true }) : null;
  // __fromHead: the landing tree's own settings decide (a merged settings.md on forge git)
  return head ? { ...head, __fromHead: true } : mainS();
}
// Coverage of one repo's tree under one set of settings, once per read of the log; null with no lines.
const coverageAt = (ref, s, R = homeFacts) => (linesDeclared(s) ? memo(`coverage\0${R.name}\0${ref}\0${canonical(s.components)}`, () => coverage(R.treePaths(ref), componentsOn(s, R.name), R.devteamLine())) : null);
// The Baseline's floor gaps (§9a): unowned, owned twice, a component whose link can't hold files,
// an owns glob that matches nothing. Case collisions fail the check but aren't a gap class.
function coverageGaps(cov, s) {
  const unlinked = Object.entries(s.components ?? {}).filter(([, c]) => isObj(c) && (c.link ?? 'home') !== 'home' && !LINK_KINDS[s.links?.[c.link]?.kind]?.hostsComponents).map(([n]) => n);
  return { ...cov, unlinked, count: cov.unowned.length + cov.contested.length + cov.empty.length + unlinked.length };
}
```

`settingsAt` (`devteam.mjs:238-243`) gains an option, so enforcement can tell "no settings.md at that ref" from "the defaults": `function settingsAt(ref, { orNull = false } = {})`, and line 241 becomes `if (!m) return orNull ? null : { ...SETTINGS_DEFAULTS };`. Every existing caller keeps today's result (defaults when the file is missing; null only for invalid JSON, which `ownerSettingsChanged` reports). The enforcement callers added by this PR pass `{ orNull: true }` and fall back explicitly, as `settingsInForce` does above.

- [ ] **Step 4: The report and the command**

Add before `// ===== 12. init, help, dispatch =====` (`devteam.mjs:6481`):

```js
// Coverage problems as lines a person reads: unowned paths grouped by folder, with the component
// that owns a sibling path in that folder as the suggestion (§4, point 1).
function coverageReport(cov, s, R = homeFacts) {
  const lines = [];
  const comps = componentsOn(s, R.name);
  const dev = R.devteamLine();
  const ownerOf = (p) => ownersOf(p, comps, dev).find((n) => n !== 'devteam') ?? null;
  const dirOf = (p) => (p.includes('/') ? `${p.slice(0, p.lastIndexOf('/'))}/` : './');
  const all = treePathsMemo(cov.ref, R);
  const unowned = new Set(cov.unowned);
  // the owner of an owned path in the same folder, else in the nearest folder above it; the repo
  // root suggests nothing (every path is under it)
  const suggest = (dir) => {
    for (let d = dir; d !== './'; d = dirOf(d.slice(0, -1))) {
      const sib = all.find((p) => p.startsWith(d) && !unowned.has(p) && ownerOf(p));
      if (sib) return ownerOf(sib);
    }
    return null;
  };
  for (const [dir, ps] of Object.entries(groupBy(cov.unowned, dirOf)).sort()) {
    const who = suggest(dir);
    lines.push(`unowned: ${dir} (${ps.length}): ${ps.slice(0, 8).join(', ')}${ps.length > 8 ? `, … (+${ps.length - 8})` : ''}${who ? `; suggested owner: ${who}` : ''}`);
  }
  for (const [p, owners] of cov.contested) lines.push(`contested: ${p} is owned by ${owners.join(' and ')}${owners[0] === 'devteam' ? " (the kit's own line: no component owns it)" : ''}`);
  for (const g of cov.empty) lines.push(`empty: ${comps.find((c) => (c.owns ?? []).includes(g))?.name ?? '?'} owns "${g}", which matches nothing (a typo?)`);
  for (const n of cov.unlinked ?? []) lines.push(`unlinked: component ${n}'s link "${s.components[n].link}" is not a link that holds files`);
  for (const grp of cov.case_collisions) lines.push(`case: ${grp.join(', ')} differ only by case (they break checkouts on macOS and Windows)`);
  return lines;
}
const treePathsMemo = (ref, R = homeFacts) => memo(`tree\0${R.name}\0${ref}`, () => R.treePaths(ref));

// components check [--ref r] [--count] [--json]: coverage of a commit's tree under that commit's
// settings (open issue 9). Exits 1 on any problem; --count prints the Baseline's gap count.
function cmdComponents() {
  const [sub] = positional;
  if (sub !== 'check') die('usage: components check [--ref <ref>] [--count] [--json]');
  const ref = flagStr('ref') ?? mainRef() ?? 'HEAD';
  const sha = resolveCommit(ref) ?? die(`${ref} is not a commit here (git fetch first?)`);
  const s = settingsAt(sha) ?? die(`${projectRel}/settings.md at ${ref}: the json devteam block is not valid JSON`);
  const cov = coverageAt(sha, s);
  if (!cov) {
    if (flags.count) return out('0');
    if (flags.json) return json({ ref, declared: false, unowned: [], contested: [], empty: [], unlinked: [], case_collisions: [], count: 0 });
    return out(`no component lines declared at ${ref}: one implicit component owns every path${Object.keys(s.components ?? {}).length ? ' (components holds labels only; a line is an entry with owns, link, shared or release)' : ''}`);
  }
  const gaps = { ...coverageGaps(cov, s), ref: sha };
  const bad = gaps.count + gaps.case_collisions.length;
  if (flags.count) { out(String(gaps.count)); return void process.exit(bad ? 1 : 0); }
  if (flags.json) { json({ ref, declared: true, ...gaps }); return void process.exit(bad ? 1 : 0); }
  for (const l of coverageReport(gaps, s)) out(l);
  out(`${treePathsMemo(sha).length} tracked path(s) at ${ref}: ${gaps.unowned.length} unowned, ${gaps.contested.length} contested, ${gaps.empty.length} empty glob(s), ${gaps.unlinked.length} unlinked, ${gaps.case_collisions.length} case collision(s)`);
  process.exit(bad ? 1 : 0);
}
```

`coverageReport` reads `cov.ref`; set it where `coverageGaps` is built (as above). Add `components: cmdComponents,` to `COMMANDS` and to `HELP` under "The graph (planning.md)":

```
  components check [--ref r] [--count] [--json]   coverage: every tracked path at r (default main) owned by exactly one component line; exit 1 on any gap (--count: the Baseline's number)
```

- [ ] **Step 5: Run the test, G1, the suite**

Run: `node --test --test-name-pattern 'components check reads|G1:'`
Expected: `components check` PASS. G1 **fails on exactly one line**, the same line in `check-ticket.txt` and `merge-dry-run.txt`: `changes files outside touches: OUTSIDE.md, "src/\303\251.js"` becomes `changes files outside touches: OUTSIDE.md` (the quoting fix: `src/é.js` is inside `src/**`; today's line named a quoted path that matched nothing). Re-record, check the diff is that one line in those two files and nothing else, and say so in the commit message:

```bash
DEVTEAM_G1_RECORD=1 node --test --test-name-pattern 'G1:'
git diff --stat test/fixtures/g1   # exactly check-ticket.txt and merge-dry-run.txt, one line each
git diff test/fixtures/g1
```

Then: `node --test` → `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/kit.test.mjs test/fixtures/g1/check-ticket.txt test/fixtures/g1/merge-dry-run.txt
git commit -m "treePaths and -z changedFiles; components check. G1: the one changed line is a non-ASCII path no longer printed as quoted octal"
```

---

### Task 6: Enforcement point 1, `validate`: coverage, declared components, touches containment

**Files:**
- Modify: `cmdValidate` (`devteam.mjs:1399-1537`): the per-ticket loop (`1406-1421`), and the Task 3 block before line 1516
- Modify: `docs/devteam/schema/log.schema.json`: `ticket.properties.touches_components`, and `touches_components` in `x-authority.set.ticket` for planner, supervisor and owner
- Test: `test/kit.test.mjs`

**Interfaces:**
- Consumes: `settingsInForce`, `coverageAt`, `coverageGaps`, `coverageReport`, `componentsOn`, `prefixOwners`, `devteamLine`, `linesDeclared`.
- Produces: validate errors `<ticket-id>: component "x" is not declared …`, `<ticket-id>: touches "…" …`, `<ticket-id>: touches_components …`, and `components: <coverage line>` (a warning when validate is scoped to one ticket).

- [ ] **Step 1: Write the failing test**

```js
test('validate: main\'s tree under the lines in force, declared components, touches inside one line', () => {
  const F = monoFixture('validate-lines');
  const { old, ok, run, g, lines } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const tk = (id, extra) => ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'chores', component: id.split('-')[0], kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['api/**'], done_when: ['the api suite passes'], notes: 'n', ...extra })], SUP);
  try {
    lines(F.STD);
    tk('api-01-a');
    tk('web-02-b', { touches: ['web/src/**', 'api/app.rb'] });
    tk('ghost-03-c', { touches: ['web/**'] });
    tk('web-04-d', { touches: ['**/*.js'] });
    tk('api-05-e', { kind: 'contract', contracts: { provides: ['api-v1'] }, touches: ['api/lib/**', 'web/src/api.js'], touches_components: ['web'] });
    tk('api-06-f', { touches: ['docs/devteam/governance/quality.md'] });
    tk('ops-07-g', { touches_components: ['web'] });
    const out = run(old, ['validate']).out;
    assert.doesNotMatch(out, /api-01-a: touches/, 'inside its own line');
    assert.match(out, /web-02-b: touches "api\/app\.rb" lies in api's line, not web's \(list api in touches_components on a contract or integration ticket, or split the ticket\)/);
    assert.match(out, /ghost-03-c: component "ghost" is not declared in settings\.components/);
    assert.match(out, /web-04-d: touches "\*\*\/\*\.js" has no static prefix, so it could be in any line/);
    assert.doesNotMatch(out, /api-05-e: touches/, 'a contract ticket may span the lines it names');
    assert.match(out, /api-06-f: touches "docs\/devteam\/governance\/quality\.md" lies in the kit's own line/);
    assert.match(out, /ops-07-g: touches_components is for contract and integration tickets/);
    // coverage of main's tree: a file pushed straight to main
    write(path.join(old, 'scripts/x.sh'), 'x\n');
    g(['add', '-A'], old);
    g(['commit', '-qm', 'bypass'], old);
    g(['push', '-q', 'origin', 'main'], old);
    assert.match(run(old, ['validate']).out, /error: components: unowned: scripts\/ \(1\): scripts\/x\.sh/);
    // checked for one ticket (its gate), the gap is main's, not the ticket's: a warning
    const scoped = spawnSync(process.execPath, [path.join(old, 'docs/devteam/scripts/devteam.mjs'), 'validate'], { cwd: old, env: { ...F.env({}), DEVTEAM_GATE_TICKET: 'api-01-a' }, encoding: 'utf8' });
    assert.match(scoped.stdout, /warning: components: unowned: scripts\/ .*; not api-01-a's to fix/);
  } finally { F.done(); }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern 'validate: main'`
Expected: FAIL on the `web-02-b` containment message.

- [ ] **Step 3: The `touches_components` field**

In `log.schema.json`, `$defs.types.ticket.properties`, add:

```json
"touches_components": { "description": "On a contract or integration ticket: other components in the same repo whose lines its touches may fall in (planning.md D2, D7).", "type": "array", "items": { "type": "string", "pattern": "^[a-z][a-z0-9]*(-[a-z0-9]+)*$" } }
```

and add `"touches_components"` to `x-authority.set.ticket.planner`, `.supervisor` and `.owner`.

- [ ] **Step 3b: Per-ticket rules in the ticket loop**

In `cmdValidate`, before the ticket loop at line 1406, add:

```js
  // Ticket-level planning checks read the lines as the planner or supervisor has them now (the
  // working tree), so a component declared in a draft can be planned against before it lands.
  // They are advice for the graph, not one of the four enforcement points: check-ticket's footprint
  // and check-pr's coverage judge the same tickets by committed settings (settingsInForce) at merge.
  const S0 = loadSettings(); const lined = linesDeclared(S0); const comps0 = componentsOn(S0, 'home'); const dev0 = devteamLine();
``` Inside the loop, after line 1408 (`for (const g of t.touches ?? []) if (unbalanced(g)) …`), add:

```js
    // Component lines (spec §6.1): the component is declared, and every touches entry lies in its
    // line (or a touches_components member's) and no other, so a ticket's footprint is one line.
    if (lined && isActive(t)) {
      const decl = S0.components?.[t.component];
      if (!decl) err(id, `component "${t.component}" is not declared in settings.components (declare it with its owns, or plan the ticket under a declared one)`);
      const tc = t.touches_components ?? [];
      if (tc.length && !['contract', 'integration'].includes(t.kind)) err(id, 'touches_components is for contract and integration tickets (planning.md D2, D7)');
      for (const c of tc) if (!S0.components?.[c]) err(id, `touches_components "${c}" is not a declared component`);
      else if (componentLink(c, S0) !== componentLink(t.component, S0)) err(id, `touches_components "${c}" is in another repo; a ticket changes one repo (split it per repo)`);
      const mine = new Set([t.component, ...tc]);
      for (const entry of t.touches ?? []) {
        const owners = prefixOwners(entry, comps0, dev0);
        if (owners === null) err(id, `touches "${entry}" has no static prefix, so it could be in any line; start it with a folder`);
        else if (owners.includes('devteam')) err(id, `touches "${entry}" lies in the kit's own line; only the ticket's own ${projectRel}/tickets/${id}/ is its to write, and kit upgrades are chores`);
        else if (!owners.length) err(id, `touches "${entry}" lies in no component's line`);
        else if (owners.some((o) => !mine.has(o))) err(id, `touches "${entry}" lies in ${owners.filter((o) => !mine.has(o)).join(' and ')}'s line, not ${t.component}'s (list ${owners.filter((o) => !mine.has(o)).join(', ')} in touches_components on a contract or integration ticket, or split the ticket)`);
      }
    }
```

- [ ] **Step 4: Coverage of main's tree in the Task 3 block**

Append to the Task 3 block in `cmdValidate` (before `for (const e of readLog().errors)`):

```js
    // Main's tree under the lines in force (§4, point 1): main's settings, or this head's when it
    // changes settings.md (a plan or chore PR's validate, in its worktree). Checked for one ticket,
    // a gap on main is not that ticket's to fix: a warning, as for D4.
    const main = mainRef();
    if (main && projectInRepo) {
      const head = resolveCommit('HEAD');
      const sIn = settingsInForce(head ? git(['merge-base', main, head]) : null, head);
      const cov = coverageAt(main, sIn);
      if (cov) for (const l of coverageReport({ ...coverageGaps(cov, sIn), ref: main }, sIn)) (scope ? warnings : errors).push(`components: ${l}${scope ? `; not ${scope}'s to fix` : ''}`);
    }
```

A plan PR's `validate --strict` runs in its own detached worktree with no ticket scope, so a gap on main is an error there: a plan doesn't land on a main whose lines leave files unowned. Fixing main is a chore that extends a line (Task 18 puts this in `quality.md`).

`scope` (`devteam.mjs:1505`) is in scope here: the Task 3 block sits after the D4 block (lines 1502-1514) and before `for (const e of readLog().errors)`.

- [ ] **Step 5: Run the test, G1, the suite**

Run: `node --test --test-name-pattern 'validate: main|registry and component lines|G1:'` → PASS. Then `node --test` → `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs docs/devteam/schema/log.schema.json test/kit.test.mjs
git commit -m "validate: main's tree under the lines in force; declared components; every touches entry inside one line"
```

---

### Task 7: Enforcement point 4, the ticket footprint

**Files:**
- Modify: `checkTicket` (`devteam.mjs:2019-2026`)
- Test: `test/kit.test.mjs`

**Interfaces:**
- Consumes: `settingsInForce`, `componentsOn`, `devteamLine`, `changedFiles`.
- Produces: the check-ticket failure `changes files outside the line of <c>[, <c2>]: …` (constant prefix `OFF_LINE = 'changes files outside the line of'`, used by Task 15's refusal count).

- [ ] **Step 1: Write the failing test**

```js
test('the ticket footprint: touches, and the component\'s line, and its own records (B1, M4)', () => {
  const F = monoFixture('footprint');
  const { old, ok, run, g, lines } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const body = path.join(F.base, 'body.md');
  write(body, '## One-way doors\n\nNone.\n');
  try {
    lines(F.STD);
    const branch = (id, ticket, files) => {
      ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'chores', component: id.split('-')[0], kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], done_when: ['its suite passes in CI'], notes: 'n', ...ticket })], SUP);
      const w = path.join(old, '.worktrees', id);
      g(['worktree', 'add', '-q', '-b', `ticket/${id}`, w, 'origin/main'], old);
      for (const [f, text] of Object.entries(files)) write(path.join(w, f), text);
      g(['add', '-A'], w);
      g(['commit', '-qm', `${id}: work`], w);
      return run(old, ['check-ticket', id, '--sha', g(['rev-parse', 'HEAD'], w), '--title', `${id}: work`, '--body-file', body]).out;
    };
    // B1: an ordinary ticket's PR carries its own records, inside the kit's line
    const b1 = branch('api-01-own', { touches: ['api/**'] }, { 'api/app.rb': 'changed\n', 'docs/devteam/project/tickets/api-01-own/spec.md': '# spec\n' });
    assert.doesNotMatch(b1, /outside the line|outside touches/, 'B1');
    // M4: a non-ASCII path is owned at point 4 too
    assert.doesNotMatch(branch('api-02-utf', { touches: ['api/**'] }, { 'api/é.rb': 'x\n' }), /outside the line|outside touches/, 'M4: app/é.rb');
    // touches that reach another line: refused at the footprint, whatever the globs claimed
    assert.match(branch('web-03-reach', { touches: ['web/**', 'api/app.rb'] }, { 'api/app.rb': 'web edits api\n' }), /changes files outside the line of web: api\/app\.rb/);
    // a contract ticket that names the second line passes
    assert.doesNotMatch(branch('api-04-contract', { kind: 'contract', contracts: { provides: ['v1'] }, touches: ['api/lib/**', 'web/src/api.js'], touches_components: ['web'] }, { 'api/lib/v1.rb': 'v1\n', 'web/src/api.js': 'fake\n' }), /outside the line/);
    // the kit's line: nothing but the ticket's own folder
    assert.match(branch('api-05-kit', { touches: ['api/**', 'docs/devteam/governance/quality.md'] }, { 'docs/devteam/governance/quality.md': 'x\n' }), /changes files outside the line of api: docs\/devteam\/governance\/quality\.md/);
  } finally { F.done(); }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern 'the ticket footprint'`
Expected: FAIL on `changes files outside the line of web`.

- [ ] **Step 3: The footprint rule**

In `checkTicket`, replace lines 2021-2026 (`if (base) { … }`) with:

```js
  if (base) {
    const changed = changedFiles(base, sha);
    const own = projectInRepo ? `${projectRel}/tickets/${id}/` : null;
    const mineOwn = (f) => !!own && f.startsWith(own);
    const outside = changed.filter((f) => !mineOwn(f) && !(t.touches ?? []).some((g) => pathMatches(g, f)));
    if (outside.length) fails.push(`changes files outside touches: ${outside.slice(0, 10).join(', ')}${outside.length > 10 ? ` (+${outside.length - 10} more)` : ''}`);
    // Component lines (§4, point 4): a changed file is also inside the ticket's component's line or
    // a touches_components member's; the kit's own line is closed but for the ticket's own folder.
    // Judged by committed settings, so a line widened in a working tree changes nothing.
    const s = settingsInForce(base, sha);
    if (linesDeclared(s)) {
      const comps = componentsOn(s, 'home');
      const names = [t.component, ...(t.touches_components ?? [])];
      const dev = devteamLine();
      const inLine = (f) => { const o = ownersOf(f, comps, dev); return o[0] !== 'devteam' && o.some((n) => names.includes(n)); };
      const off = changed.filter((f) => !mineOwn(f) && !outside.includes(f) && !inLine(f));
      if (off.length) fails.push(`${OFF_LINE} ${names.join(', ')}: ${off.slice(0, 10).join(', ')}${off.length > 10 ? ` (+${off.length - 10} more)` : ''}`);
    }
  }
```

and above `checkTicket` (before line 1972):

```js
const OFF_LINE = 'changes files outside the line of';
```

- [ ] **Step 4: Run it, G1, the suite**

Run: `node --test --test-name-pattern 'the ticket footprint|G1:'` → PASS. `node --test` → `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/kit.test.mjs
git commit -m "check-ticket: a changed file is inside touches, and inside its component's line, or in its own records"
```

---

### Task 8: Enforcement point 2, `check-pr` and `merge`: the tree that would land

**Files:**
- Modify: `checkPr` (`devteam.mjs:2052-2081`, the insertion after line 2054); `cmdMerge` (`devteam.mjs:2282`, the `checkPr` call)
- Test: `test/kit.test.mjs`

**Interfaces:**
- Consumes: `mergeTree`, `treePaths`, `coverage`, `settingsInForce`, `settingsAt`, `coverageAt`, `coverageReport`.
- Produces: `landingTree(sha, R = homeFacts) → { tree, problem }` and `coverageFails(base, sha, R = homeFacts) → string[]` (problems in the landing tree that main doesn't already have). `checkPr` returns them for every branch kind once lines are declared.

- [ ] **Step 1: Write the failing tests**

```js
test('check-pr and merge judge the tree that would land, by committed lines (M1, M5, M10)', () => {
  const F = monoFixture('landing');
  const { old, ok, run, g, lines, edit } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const body = path.join(F.base, 'body.md');
  write(body, '## One-way doors\n\nNone.\n');
  const chore = (slug, fn, { from = 'origin/main' } = {}) => {
    const w = path.join(old, '.worktrees', `chore-${slug}`);
    g(['worktree', 'add', '-q', '-b', `chore-${slug}`, w, from], old);
    fn(w);
    g(['add', '-A'], w);
    g(['commit', '-qm', `chore-${slug}: x`], w);
    g(['push', '-q', 'origin', `chore-${slug}`], w);
    return { w, sha: g(['rev-parse', 'HEAD'], w) };
  };
  const checkPr = (slug, sha) => run(old, ['check-pr', '--head-ref', `chore-${slug}`, '--sha', sha, '--title', `chore-${slug}: x`, '--body-file', body]);
  try {
    // M10: before any lines, a chore PR passes check-pr even with a validate error in the graph
    ok(old, ['ticket', 'add', 'api-01-dangling', '--json', JSON.stringify({ title: 'x', feature: 'chores', component: 'api', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: ['api-99-nope'], touches: ['api/**'], done_when: ['the api suite passes'], notes: 'n' })], SUP);
    assert.notEqual(run(old, ['validate']).status, 0, 'a pre-existing validate error');
    const m10 = chore('m10', (w) => write(path.join(w, 'docs/devteam/project/designs/note.md'), '# note\n'));
    assert.equal(checkPr('m10', m10.sha).status, 0, 'M10: a chore PR never runs full validate');
    lines(F.STD);
    const stale = g(['rev-parse', 'origin/main'], old);
    // a new top-level folder; a rename out of every line; a narrowed glob
    assert.match(checkPr('top', chore('top', (w) => write(path.join(w, 'scripts/x.sh'), 'x\n')).sha).out, /unowned: scripts\/ \(1\): scripts\/x\.sh/);
    assert.match(checkPr('mv', chore('mv', (w) => { fs.mkdirSync(path.join(w, 'misc')); g(['mv', 'api/app.rb', 'misc/app.rb'], w); }).sha).out, /unowned: misc\/ \(1\): misc\/app\.rb/);
    // a ticket PR gets coverage too (checkPr returns early for ticket/ branches): a case collision
    ok(old, ['ticket', 'add', 'api-02-case', '--json', JSON.stringify({ title: 'x', feature: 'chores', component: 'api', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['api/**'], done_when: ['the api suite passes'], notes: 'n' })], SUP);
    const tw = path.join(old, '.worktrees', 'api-02-case');
    g(['worktree', 'add', '-q', '-b', 'ticket/api-02-case', tw, 'origin/main'], old);
    write(path.join(tw, 'api/App.rb'), 'beside app.rb\n');
    g(['add', '-A'], tw); g(['commit', '-qm', 'api-02-case: x'], tw);
    const tr = run(old, ['check-pr', '--head-ref', 'ticket/api-02-case', '--sha', g(['rev-parse', 'HEAD'], tw), '--title', 'api-02-case: x', '--body-file', body]);
    assert.match(tr.out, /components: case: api\/App\.rb, api\/app\.rb differ only by case/, 'a ticket PR is checked for coverage');
    assert.match(checkPr('narrow', chore('narrow', (w) => edit((j) => { j.components.api.owns = ['api/lib/**']; }, w)).sha).out, /unowned: api\/ \(1\): api\/app\.rb/);
    // a gap already on main is not this PR's: it passes coverage (observe-metrics reports main's)
    write(path.join(old, 'scripts/pushed.sh'), 'x\n');
    g(['add', '-A'], old); g(['commit', '-qm', 'bypass'], old); g(['push', '-q', 'origin', 'main'], old);
    assert.doesNotMatch(checkPr('clean', chore('clean', (w) => write(path.join(w, 'api/new.rb'), 'x\n')).sha).out, /unowned/);
    g(['rm', '-q', 'scripts/pushed.sh'], old); g(['commit', '-qm', 'tidy'], old); g(['push', '-q', 'origin', 'main'], old);
    // M5 (forge git): main narrows web and moves its file; a stale branch adds a path under the old line
    edit((j) => { j.components.web.owns = ['web/src/**', 'web/package.json']; });
    g(['commit', '-qam', 'narrow web'], old); g(['push', '-q', 'origin', 'main'], old);
    chore('m5', (w) => write(path.join(w, 'web/extra.js'), 'x\n'), { from: stale });
    write(path.join(old, 'docs/devteam/run/pr/chore-m5.md'), '# chore-m5: x\n\n## One-way doors\n\nNone.\n');
    assert.match(run(old, ['merge', '--chore', 'm5', '--dry-run'], SUP).out, /unowned: web\/ \(1\): web\/extra\.js/, 'M5: refused on the merged tree');
    chore('m5ok', (w) => write(path.join(w, 'api/stale-ok.rb'), 'x\n'), { from: stale });
    write(path.join(old, 'docs/devteam/run/pr/chore-m5ok.md'), '# chore-m5ok: x\n\n## One-way doors\n\nNone.\n');
    assert.doesNotMatch(run(old, ['merge', '--chore', 'm5ok', '--dry-run'], SUP).out, /unowned/, 'a stale branch main\'s move leaves clean is not refused');
    // M1: merge reads committed lines; a working-tree widening has no effect
    edit((j) => { j.components.ops.owns.push('scripts/**'); });
    chore('m1', (w) => write(path.join(w, 'scripts/y.sh'), 'x\n'));
    write(path.join(old, 'docs/devteam/run/pr/chore-m1.md'), '# chore-m1: x\n\n## One-way doors\n\nNone.\n');
    assert.match(run(old, ['merge', '--chore', 'm1', '--dry-run'], SUP).out, /unowned: scripts\/ \(1\): scripts\/y\.sh/, 'M1');
    g(['checkout', '-q', '--', 'docs/devteam/project/settings.md'], old);
  } finally { F.done(); }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern 'check-pr and merge judge the tree'`
Expected: FAIL at `unowned: scripts/`.

- [ ] **Step 3: Landing tree and the regressions**

Add before `checkPr` (line 2052):

```js
// The tree a PR would put on main (§4, point 2): its head on github, where merge refuses a head
// that is behind; on forge git, merge lands it onto a main that may have moved, so it is the
// merge of the two (open issue 8).
function landingTree(sha, R = homeFacts) {
  const main = R.mainRef();
  if (R.settings.forge !== 'git' || !main) return { tree: sha };
  const tree = R.mergeTree(main, sha);
  return tree ? { tree } : { problem: `${sha.slice(0, 12)} does not merge cleanly onto ${main}; merge main into the branch and ask again` };
}
// Coverage problems in the landing tree that main doesn't already have: a path added outside every
// line, renamed out of one, or left behind by a narrowed glob (open issue 7). Only once lines are declared.
function coverageFails(base, sha, R = homeFacts) {
  const main = R.mainRef();
  if (!main || !projectInRepo) return [];
  const land = landingTree(sha, R);
  if (land.problem) return [land.problem];
  const sIn = settingsInForce(base, sha, R);
  const sLand = sIn.__fromHead ? (settingsAt(land.tree, { orNull: true }) ?? sIn) : sIn;
  const now = coverageAt(land.tree, sLand, R);
  if (!now) return [];
  // main's own state, under main's committed settings (home's main: settings live in home)
  const sMain = (mainRef() ? settingsAt(mainRef(), { orNull: true }) : null) ?? sIn;
  const before = coverageAt(main, sMain, R) ?? { unowned: [], contested: [], empty: [], case_collisions: [] };
  const was = new Set([...before.unowned.map((p) => `u${p}`), ...before.contested.map(([p, o]) => `c${p}\0${o}`), ...before.empty.map((x) => `e${x}`), ...before.case_collisions.map((x) => `k${x}`)]);
  const fresh = { unowned: now.unowned.filter((p) => !was.has(`u${p}`)), contested: now.contested.filter(([p, o]) => !was.has(`c${p}\0${o}`)), empty: now.empty.filter((x) => !was.has(`e${x}`)), case_collisions: now.case_collisions.filter((x) => !was.has(`k${x}`)), unlinked: [], ref: land.tree };
  return coverageReport(fresh, sLand, R).map((l) => `components${R.name === 'home' ? '' : ` (${R.name})`}: ${l} (extend a line in a chore PR, or keep the file inside one)`);
}
```

`settingsInForce` marks settings read from the PR's head with `__fromHead` (Task 5); `coverageAt` keys on `canonical(s.components)`, so the marker never splits its memo.

In `checkPr`, right after `const fails = [...logRule(branch, sha), ...reviewRule(sha, { forge })];` (line 2054) and before the ticket branch's early `return` at line 2055, add:

```js
  // Every PR, every kind, ticket PRs included (they return on the next line): the tree that would
  // land keeps every path in exactly one line. A chore or settings PR gets this, never full
  // validate, so an old graph error can't block a log PR (M10).
  fails.push(...coverageFails(mainRef() ? git(['merge-base', mainRef(), sha]) : null, sha));
```

- [ ] **Step 4: Run it, G1, the suite**

Run: `node --test --test-name-pattern 'check-pr and merge judge the tree|G1:'` → PASS; `node --test` → `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/kit.test.mjs
git commit -m "check-pr and merge: the tree that would land keeps every path in one line (the merge on forge git), judged by committed lines"
```

---

### Task 9: Enforcement point 3: `unowned-files` blocks new tickets

**Files:**
- Modify: `observeFindings` (`devteam.mjs:3807-3818`), `collectMetrics` (`devteam.mjs:4905`, the `add` helper, and before line 5033), `notSchedulable` (`1736-1741`), `cmdReady` (`1764`), `makeSession` (`5676`)
- Test: `test/kit.test.mjs`

**Interfaces:**
- Produces: finding `{ severity: 'high', kind: 'unowned-files', subject: 'home', sev: 4 }`; `coverageGap(name = 'home', R = homeFacts) → number` (gap count on that repo's main under home main's committed lines, memoized); `notSchedulable(t)` may return `'unowned files'`.

- [ ] **Step 1: Write the failing test**

```js
test('unowned files on main: a severity-4 finding, and no new ticket starts there until a line covers them', () => {
  const F = monoFixture('unowned');
  const { old, ok, run, g, lines } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    lines(F.STD);
    ok(old, ['ticket', 'add', 'api-01-a', '--json', JSON.stringify({ title: 'a', feature: 'chores', component: 'api', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['api/**'], done_when: ['the api suite passes'], notes: 'n' })], SUP);
    assert.match(ok(old, ['ready']), /build +api-01-a/);
    write(path.join(old, 'scripts/x.sh'), 'x\n');
    g(['add', '-A'], old); g(['commit', '-qm', 'pushed past devteam'], old); g(['push', '-q', 'origin', 'main'], old);
    const f = json(ok(old, ['metrics', '--json'])).findings.find((x) => x.kind === 'unowned-files');
    assert.ok(f, 'the finding');
    assert.equal(f.subject, 'home');
    assert.match(f.detail, /1 tracked path\(s\) on .* no line owns/);
    ok(old, ['observe-metrics'], SUP);
    assert.equal(json(ok(old, ['log', '--type', 'observation', '--json'])).find((o) => o.kind === 'unowned-files').severity, 4);
    const r = json(ok(old, ['ready', '--json']));
    assert.deepEqual(r.waiting, [{ id: 'api-01-a', why: 'unowned files' }]);
    assert.match(ok(old, ['ready']), /unowned files api-01-a .*a chore PR that extends a line/);
    assert.match(run(old, ['worker', 'api-01-a'], SUP).err, /home's main has 1 path\(s\) no component line owns/);
    lines({ ...F.STD, ops: { owns: [...F.STD.ops.owns, 'scripts/**'] } });
    assert.match(ok(old, ['ready']), /build +api-01-a/, 'a line that covers them clears it');
  } finally { F.done(); }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern 'unowned files on main'`
Expected: FAIL (no finding).

- [ ] **Step 3: The gap, the finding, the refusals**

Near `coverageAt` (Task 5), add:

```js
// Gaps on main under main's committed lines (§4, point 3): commits that bypassed devteam. Zero
// with no lines. While non-zero, no new ticket starts in that repo.
const coverageGap = (name = 'home', R = homeFacts) => memo(`coverageGap\0${name}`, () => { const main = R.mainRef(); const s = main && projectInRepo ? settingsAt(mainRef(), { orNull: true }) : null; const cov = s ? coverageAt(main, s, R) : null; return cov ? coverageGaps(cov, s).count + cov.case_collisions.length : 0; });
```

In `collectMetrics`, change the helper at line 4905 to keep an optional record severity:

```js
  const add = (severity, kind, subject, detail, suggestion, extra = {}) => f.push({ severity, kind, subject, detail, suggestion, ...extra });
```

and before `const order = { high: 0, medium: 1, low: 2 };` (line 5033) add:

```js
  // Component lines on main (§4, point 3): a gap is a severity-4 observation (open issue 6).
  {
    const n = coverageGap();
    if (n) add('high', 'unowned-files', 'home', `${n} tracked path(s) on ${mainRef()} no line owns, or more than one does (devteam.mjs components check lists them); no new ticket starts in home until it clears`, 'a chore PR that extends a line (settings components), or moves the files into one', { sev: 4 });
  }
```

In `observeFindings` (line 3814) change `severity: SEV[f.severity] ?? 1` to `severity: f.sev ?? SEV[f.severity] ?? 1`.

In `notSchedulable` (after line 1739), add:

```js
  if (coverageGap()) return 'unowned files';
```

In `cmdReady`'s waiting line (line 1764), extend the explanation:

```js
  for (const w of waiting) out(`${w.why.padEnd(10)} ${w.id}  (no new worker: ${w.why === 'parked' ? 'resume it with `worker <id> --resume` when its ruling and its goal allow' : w.why.startsWith('goal ') ? 'its goal is on hold (goal hold)' : w.why === 'unowned files' ? 'main has files no component line owns; a chore PR that extends a line clears it (components check)' : 'merge or answer its review'})`);
```

In `makeSession`, after line 5676 (`if (role === 'worker' && !tickets().has(id)) …`):

```js
  // A repo with files no line owns starts no new ticket (§4, point 3); a ticket already started carries on.
  if (role === 'worker' && !lastPhaseOf(id) && coverageGap()) die(`home's main has ${coverageGap()} path(s) no component line owns, or more than one does: no new ticket starts there until a chore PR extends a line (devteam.mjs components check)`);
```

- [ ] **Step 4: Run it, G1, the suite**

Run: `node --test --test-name-pattern 'unowned files on main|G1:'` → PASS; `node --test` → `ℹ fail 0` (the held-ticket and idle-capacity subtests in `devteam kit` exercise `notSchedulable` with no lines).

- [ ] **Step 5: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/kit.test.mjs
git commit -m "observe-metrics: unowned-files at severity 4; ready and worker start no new ticket while main has a gap"
```

---

### Task 10: One scope grammar

**Files:**
- Modify: replace the Task 3 stubs `SCOPE_HELP`/`scopeValid` with the grammar; `knowledgeFor` (`devteam.mjs:3825-3832`); schema `knowledge.scope` pattern
- Test: `test/kit.test.mjs`

**Interfaces:**
- Produces:
  - `SCOPES: { [kind]: (value, ctx) → boolean }` for `all`, `project`, `component`, `feature`, `goal`, `class`, `chore`, `link`
  - `scopeMatches(scope, ctx) → boolean`, `ctx = { component?, feature?, goals?: string[], links?: string[], class? }`
  - `scopeValid(scope, where: 'for'|'knowledge') → boolean`, `SCOPE_HELP[where]`
  - `scopeContext(target) → ctx & { shown: string[] }` (`shown`: the registry ids the Links block lists; `links` adds the component's own link)

- [ ] **Step 1: Write the failing test**

```js
test('one scope grammar: knowledge scopes unchanged, link: scopes reach prompts whose links include them', () => {
  const F = monoFixture('scopes');
  const { old, ok, run, lines, edit, g } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    lines(F.STD);
    ok(old, ['ticket', 'add', 'web-01-a', '--json', JSON.stringify({ title: 'a', feature: 'chores', component: 'web', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['web/**'], done_when: ['the web suite passes'], notes: 'n' })], SUP);
    const K = (scope, statement) => ok(old, ['knowledge', 'add', '--kind', 'fact', '--statement', statement, '--scope', scope, '--owner']);
    K('project', 'p-all'); K('component:web', 'c-web'); K('component:api', 'c-api'); K('feature:chores', 'f-chores'); K('class:merge-word', 'cls');
    K('link:figma', 'l-figma');
    const k = ok(old, ['knowledge', '--for', 'web-01-a']);
    for (const s of ['p-all', 'c-web', 'f-chores']) assert.match(k, new RegExp(s));
    for (const s of ['c-api', 'cls', 'l-figma']) assert.doesNotMatch(k, new RegExp(s));
    assert.match(ok(old, ['knowledge', '--for', 'merge-word']), /cls/);
    edit((j) => { j.links = { figma: { kind: 'url', title: 'Designs', url: 'https://figma.test/a', for: ['component:web'] } }; });
    assert.match(ok(old, ['knowledge', '--for', 'web-01-a']), /l-figma/, 'a link: lesson reaches a prompt whose links include it');
    assert.match(run(old, ['knowledge', 'add', '--kind', 'fact', '--statement', 'x', '--scope', 'goal:g-1', '--owner']).err, /scope/, 'knowledge takes no goal: scope');
    g(['checkout', '-q', '--', 'docs/devteam/project/settings.md'], old);
  } finally { F.done(); }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern 'one scope grammar'`
Expected: FAIL at `knowledge add … --scope link:figma` (schema pattern).

- [ ] **Step 3: The grammar**

Replace the two stub lines from Task 3 with:

```js
// One scope grammar (spec §7.1) for knowledge scopes and link `for` scopes: <kind> or <kind>:<id>.
// all and project mean the whole project, and both stay accepted. A later scope kind is one entry.
const SCOPES = {
  all: () => true,
  project: () => true,
  component: (v, c) => c.component === v,
  feature: (v, c) => c.feature === v,
  goal: (v, c) => (c.goals ?? []).includes(v),
  class: (v, c) => c.class === v,
  chore: (v, c) => c.chore === v,
  link: (v, c) => (c.links ?? []).includes(v),
};
const SCOPE_WHERE = { for: ['all', 'project', 'component', 'feature', 'goal', 'link'], knowledge: ['all', 'project', 'component', 'feature', 'class', 'chore', 'link'] };
const SCOPE_HELP = Object.fromEntries(Object.entries(SCOPE_WHERE).map(([w, ks]) => [w, ks.map((k) => (['all', 'project'].includes(k) ? k : `${k}:<id>`)).join(', ')]));
function scopeParts(scope) {
  const m = /^([a-z]+)(?::([a-z0-9][a-z0-9-]*))?$/.exec(String(scope ?? ''));
  return m && SCOPES[m[1]] && (['all', 'project'].includes(m[1]) ? !m[2] : !!m[2]) ? { kind: m[1], value: m[2] } : null;
}
const scopeValid = (scope, where = 'for') => { const p = scopeParts(scope); return !!p && SCOPE_WHERE[where].includes(p.kind); };
const scopeMatches = (scope, ctx) => { const p = scopeParts(scope); return !!p && SCOPES[p.kind](p.value, ctx ?? {}); };
// What a prompt is about, for both grammars: a ticket's component, feature, goals and links; a
// feature's; or a class. links: the registry ids its Links block lists, plus the component's repo
// link, so a link:<id> lesson reaches every prompt whose links or component include it.
function scopeContext(target) {
  const t = tickets().get(target);
  const f = t ? features().get(t.feature) : features().get(target);
  const ctx = t ? { component: t.component, feature: t.feature, goals: f?.goals ?? [] } : f ? { feature: target, goals: f.goals ?? [] } : target ? { class: target } : {};
  const reg = loadSettings().links ?? {};
  const own = [...(t?.links ?? []), ...(f?.links ?? [])];
  const shown = Object.keys(reg).filter((id) => own.includes(id) || asList(reg[id].for).some((sc) => scopeMatches(sc, ctx)));
  return { ...ctx, shown, links: [...new Set([...shown, ...(t ? [componentLink(t.component)] : [])])] };
}
```

Replace `knowledgeFor` (`devteam.mjs:3825-3832`) with:

```js
// Accepted knowledge whose scope applies to a ticket, a feature, or a class (spec §7.1).
function knowledgeFor(target) {
  const ctx = scopeContext(target);
  return logObjects('knowledge').filter((k) => k.status === 'accepted' && scopeMatches(k.scope, ctx));
}
```

Equivalence with today (G1): a ticket gets `project`, `component:`, `feature:` (today's three) plus `link:`, which no existing line has; a feature gets `project`, `feature:`; anything else `project`, `class:`; `chore:` matched nothing before and matches nothing now (`ctx.chore` is never set here; `upstreamSyncApproval` and `ciFixApproval` read `chore:` scopes themselves).

In the schema, `knowledge.properties.scope.pattern` becomes `^(all|project|component:[a-z0-9-]+|feature:[a-z0-9-]+|class:[a-z0-9-]+|chore:[a-z0-9-]+|link:[a-z0-9-]+)$` and its description adds ", or a link (link:<id>: wherever that link is in the prompt)".

- [ ] **Step 4: Run it, the existing knowledge subtest, G1**

Run: `node --test --test-name-pattern 'one scope grammar|G1:'` → PASS; `node --test` → `ℹ fail 0` (`observe, orient, knowledge reach the next prompt` is the regression for today's scopes).

- [ ] **Step 5: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs docs/devteam/schema/log.schema.json test/kit.test.mjs
git commit -m "One scope grammar for knowledge and link for-scopes; link:<id> joins both"
```

---

### Task 11: Links on tickets and features, the Links block in prompts, design citations

**Files:**
- Modify: schema `ticket` (add `links`), `feature` (add `links`), `x-authority.set.ticket`/`.feature` for planner, supervisor and owner; `cmdValidate` (unknown link ids; design citations); `cmdPrompt` (`devteam.mjs:5444-5452`); `makeSession` (`5726-5730`)
- Test: `test/kit.test.mjs`

**Interfaces:**
- Consumes: `scopeContext`, `LINK_KINDS[kind].promptLine`.
- Produces: `linksBlock(target) → string` ('' when nothing applies).

- [ ] **Step 1: Write the failing test**

```js
test('the Links block: links whose for matches the ticket, plus the ticket\'s and feature\'s own; unknown ids refused', () => {
  const F = monoFixture('links-block');
  const { old, ok, run, edit, g } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    edit((j) => { j.links = {
      figma: { kind: 'url', title: 'Companion designs', url: 'https://figma.test/c', for: ['component:web'], notes: 'ignore the old page' },
      runbook: { kind: 'url', title: 'Runbook', url: 'https://notion.test/r', for: ['all'] },
      api: { kind: 'url', title: 'API docs', url: 'https://api.test/docs' },
      unrelated: { kind: 'url', title: 'Other', url: 'https://o.test', for: ['component:api'] },
    }; });
    g(['commit', '-qam', 'links'], old); g(['push', '-q', 'origin', 'main'], old);
    const tk = (id, extra = {}) => ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'chores', component: 'web', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['web/**'], done_when: ['the web suite passes'], notes: 'n', ...extra })], SUP);
    tk('web-01-a', { links: ['api'] });
    const p = ok(old, ['prompt', 'worker', 'web-01-a']);
    assert.match(p, /Links this work uses[\s\S]*- Companion designs \(https:\/\/figma\.test\/c\): ignore the old page \[link:figma\]/);
    assert.match(p, /- Runbook \(https:\/\/notion\.test\/r\) \[link:runbook\]/);
    assert.match(p, /- API docs \(https:\/\/api\.test\/docs\) \[link:api\]/, "the ticket's own links");
    assert.doesNotMatch(p, /Other/);
    tk('web-02-b', { links: ['nope'] });
    assert.match(run(old, ['validate']).out, /web-02-b: links "nope" is not in settings links/);
    // designs cite link:<id>; an unknown id is an error while the registry has links
    write(path.join(old, 'docs/devteam/project/designs/web.md'), '# Web\n\nSee link:figma and link:missing.\n');
    assert.match(run(old, ['validate']).out, /designs\/web\.md cites link:missing, which is not in settings links/);
  } finally { F.done(); }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern 'the Links block'`
Expected: FAIL at `ticket add` (`ticket.links is not a field here`).

- [ ] **Step 3: Schema fields**

In `log.schema.json`, `$defs.types.ticket.properties` add:

```json
"links": { "description": "Registry links (settings.md links) this ticket's worker needs, by id; they join its prompt's Links block.", "type": "array", "items": { "type": "string", "pattern": "^[a-z][a-z0-9]*(-[a-z0-9]+)*$" } }
```

and to `feature.properties`:

```json
"links": { "description": "Registry links (settings.md links) every ticket of this feature needs, by id.", "type": "array", "items": { "type": "string", "pattern": "^[a-z][a-z0-9]*(-[a-z0-9]+)*$" } }
```

Add `"links"` to `x-authority.set.ticket.planner|supervisor|owner` and to `x-authority.set.feature.planner|supervisor|owner`.

- [ ] **Step 4: The block and the checks**

After `knowledgeBlock` (`devteam.mjs:3837`):

```js
// The block a prompt carries before its knowledge: the registry links this work uses (spec §6.3).
const linksBlock = (target) => {
  const reg = loadSettings().links ?? {};
  const ids = target ? scopeContext(target).shown : [];
  return ids.length ? `Links this work uses (the project's registry, settings.md links; look things up there rather than guessing):\n${ids.map((id) => LINK_KINDS[reg[id].kind]?.promptLine(reg[id], id) ?? `- ${reg[id].title} [link:${id}]`).join('\n')}` : '';
};
```

`cmdPrompt` (line 5450-5451): `const links = linksBlock(positional[1]);` and `out([p, handoff, links, block].filter(Boolean).join('\n\n'));`.

`makeSession` (line 5726-5730): add `const links = linksBlock(id);` after `const knowledge = knowledgeBlock(id);` and write
`` `${text}${handoff ? `\n\n${handoff}` : ''}${links ? `\n\n${links}` : ''}${knowledge ? `\n\n${knowledge}` : ''}\n` ``.

`cmdValidate`, in the ticket loop after the Task 6 block:

```js
    for (const l of t.links ?? []) if (!(loadSettings().links ?? {})[l]) err(id, `links "${l}" is not in settings links`);
```

in the feature loop (after line 1442):

```js
    for (const l of f.links ?? []) if (!(loadSettings().links ?? {})[l]) errors.push(`feature ${fid}: links "${l}" is not in settings links`);
```

and in the Task 3 block:

```js
    // Designs cite links as link:<id>; checked only while the registry has links (open issue 12).
    if (Object.keys(s.links ?? {}).length) {
      const dd = path.join(projectDir, 'designs');
      for (const f of fs.existsSync(dd) ? fs.readdirSync(dd).filter((x) => x.endsWith('.md')) : []) {
        for (const m of (readText(path.join(dd, f)) ?? '').matchAll(/(?:^|[\s(`[])link:([a-z][a-z0-9]*(?:-[a-z0-9]+)*)/g)) if (!s.links[m[1]]) errors.push(`designs/${f} cites link:${m[1]}, which is not in settings links`);
      }
    }
```

- [ ] **Step 5: Run it, G1 (`prompt-worker.txt` must not change), the suite**

Run: `node --test --test-name-pattern 'the Links block|G1:'` → PASS; `node --test` → `ℹ fail 0` (the schema-description subtest checks the new fields' descriptions).

- [ ] **Step 6: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs docs/devteam/schema/log.schema.json test/kit.test.mjs
git commit -m "Links on tickets and features; the Links block in worker and planner prompts; link:<id> citations in designs"
```

---

### Task 12: Question links that name a registry link

**Files:**
- Modify: schema `question.properties.links.items` (add `link`); `cmdAsk` (`devteam.mjs:2659`, `links: jsonFlag('links')`); `questions()` (`devteam.mjs:801`); `cmdQuestions` (`3551`); `dashboard/index.html:1032` (`linkOf`)
- Test: `test/kit.test.mjs`

**Interfaces:**
- Produces: `resolveQuestionLinks(links) → links` (an item `{ title, link }` gains `url` from a url link, or `remote` from a repo link); `ask` dies on an unknown id.

- [ ] **Step 1: Write the failing test**

```js
test('a question links a registry link by id; the inbox resolves it', () => {
  const F = monoFixture('question-links');
  const { old, ok, run, edit } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    edit((j) => { j.links = { figma: { kind: 'url', title: 'Designs', url: 'https://figma.test/a' } }; });
    const q = ok(old, ['ask', '--question', 'Which spacing?', '--links', JSON.stringify([{ title: 'The designs', link: 'figma' }, { title: 'x', url: 'https://x.test' }])], SUP);
    const v = json(ok(old, ['questions', '--id', q, '--json']))[0];
    assert.deepEqual(v.links[0], { title: 'The designs', link: 'figma', url: 'https://figma.test/a' });
    assert.match(ok(old, ['questions', '--id', q]), /see: The designs \(https:\/\/figma\.test\/a\)/);
    assert.match(run(old, ['ask', '--question', 'x?', '--links', JSON.stringify([{ title: 'y', link: 'nope' }])], SUP).err, /--links: link "nope" is not in settings links/);
  } finally { F.done(); }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern 'a question links a registry link'`
Expected: FAIL (`links[0].link is not a field here`).

- [ ] **Step 3: Schema, ask, inbox, dashboard**

Schema: in `question.properties.links.items.properties` add `"link": { "type": "string", "pattern": "^[a-z][a-z0-9]*(-[a-z0-9]+)*$", "description": "A registry link's id (settings.md links); the inbox shows its locator." }`, and change the array's description to "…a path in the repo at ref (default main), a URL, or a registry link by id."

`cmdAsk`, before `const line = appendLog({` (line 2657):

```js
  for (const l of jsonFlag('links') ?? []) if (l?.link !== undefined && !(loadSettings().links ?? {})[l.link]) die(`--links: link "${l.link}" is not in settings links (devteam.mjs links)`);
```

Replace `questions` (line 801):

```js
// A link item that names a registry link shows its kind's locator: a url link's url, a repo link's remote.
const resolveQuestionLinks = (ls) => { const reg = loadSettings().links ?? {}; return (ls ?? []).map((l) => { const r = l?.link ? reg[l.link] : null; const K = r ? LINK_KINDS[r.kind] : null; if (!K) return l; const { text, ...where } = K.locator(r, l.link); return { ...l, ...where }; }); };
const questions = () => logObjects('question').map((q) => { const v = questionView(q); return { ...v, links: resolveQuestionLinks(v.links), goal_hold: questionHold(q) }; });
```

`cmdQuestions` line 3551: `out(`  see: ${l.title} (${l.url ?? (l.remote ? `repo ${l.remote}` : `${l.ref ? `${l.ref}:` : ''}${l.path}`)})`)`.

`dashboard/index.html:1032`:

```js
const linkOf = (l) => (l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a>` : l.path ? `<a href="${esc(fileHref(l))}">${esc(l.title)}</a>` : `<span>${esc(l.title)}${l.remote ? ` <span class="muted">(${esc(l.remote)})</span>` : ''}</span>`);
```

- [ ] **Step 4: Run it, G1, the suite**

Run: `node --test --test-name-pattern 'a question links a registry link|G1:'` → PASS; `node --test` → `ℹ fail 0` (the dashboard subtests load `index.html`).

- [ ] **Step 5: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs docs/devteam/schema/log.schema.json docs/devteam/dashboard/index.html test/kit.test.mjs
git commit -m "Question links may name a registry link by id; the inbox and the dashboard show its locator"
```

---

### Task 13: `links` and `link add|set|rm` for url links, a constitutional `registry-edit`

**Files:**
- Modify: `governance/constitution.md` json block (`constitutional`, line 44); add `cmdLinks`, `cmdLink`, `editSettingsBlock` before section 12; `citeTargets` (`devteam.mjs:3656-3668`); `COMMANDS`, `HELP`; dispatch's `--decision` message (`6704`)
- Test: `test/kit.test.mjs`

**Interfaces:**
- Consumes: `authorise(cls, scope, approved, refs, verb)` (`devteam.mjs:3568`), `registryProblems`, `supervisorOnly`, `appendLog`.
- Produces:
  - `editSettingsBlock(mutate: (block) => block) → block` (writes the main checkout's `settings.md`; refuses on any registry error; resets `settingsCache`)
  - `link add <id> --kind <k> --title t [that kind's fields as --<field>] [--for s…] [--notes n] [--source id]`, `link set <id> <field> <value>` (never `kind`), `link rm <id>`: for a kind that isn't `ownedByOwner` (url), each checks `authorise('registry-edit')` first, writes, and logs `act` class `registry-edit` with refs `['link:<id>', source?]`; for an owner's kind (repo) it is refused in this PR (PR 2 drafts it as a question)
  - `links [--json]`

- [ ] **Step 1: Write the failing test**

```js
test('link add, set and rm for url links: the supervisor writes settings and logs registry-edit, with no rung and no answer (B3)', () => {
  const F = monoFixture('link-cmd');
  const { old, ok, run } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    const o = ok(old, ['observe', '--subject', 'https://figma.test/a', '--kind', 'link', '--detail', 'owner mentioned the designs'], SUP);
    assert.match(run(old, ['link', 'add', 'figma', '--kind', 'url', '--url', 'https://figma.test/a', '--title', 'Designs']).err, /the supervisor does this/);
    ok(old, ['link', 'add', 'figma', '--kind', 'url', '--url', 'https://figma.test/a', '--title', 'Designs', '--for', 'component:web', '--notes', 'spacing source', '--source', o], SUP);
    const s = json(ok(old, ['settings'])).links.figma;
    assert.deepEqual(s, { kind: 'url', title: 'Designs', url: 'https://figma.test/a', for: ['component:web'], notes: 'spacing source', source: o });
    const act = json(ok(old, ['log', '--type', 'act', '--json'])).find((a) => a.class === 'registry-edit');
    assert.ok(act, 'B3: a registry-edit act');
    assert.equal(act.rung, undefined, 'no rung');
    assert.equal(act.approved_by, undefined, 'no answer');
    assert.deepEqual(act.refs, ['link:figma', o], 'it cites the observation');
    assert.ok(!json(ok(old, ['trust', '--json'])).some((r) => r.class === 'registry-edit'), 'constitutional, not on the ladder');
    ok(old, ['link', 'set', 'figma', 'for', '["component:web","goal:g-1"]'], SUP);
    assert.deepEqual(json(ok(old, ['settings'])).links.figma.for, ['component:web', 'goal:g-1']);
    assert.match(run(old, ['link', 'set', 'figma', 'url', 'http://insecure.test'], SUP).err, /url must start with https:\/\//, 'validated before it is written');
    assert.match(run(old, ['link', 'set', 'figma', 'kind', 'repo'], SUP).err, /a link never changes kind in place/);
    assert.match(run(old, ['link', 'set', 'figma', 'colour', 'red'], SUP).err, /"colour" is not a field of a url link/);
    assert.match(run(old, ['link', 'add', 'console', '--kind', 'repo', '--remote', 'usbclub/console', '--title', 'C'], SUP).err, /a repo link is the owner's \(governance-edit\)/);
    assert.match(run(old, ['link', 'add', 'x', '--kind', 'doc', '--title', 'X'], SUP).err, /--kind is one of: repo, url/);
    const l = json(ok(old, ['links', '--json']));
    assert.equal(l.home.name, 'home');
    assert.equal(l.links.find((x) => x.id === 'figma').url, 'https://figma.test/a');
    assert.match(ok(old, ['links']), /figma: url https:\/\/figma\.test\/a "Designs" for component:web, goal:g-1/);
    assert.equal(l.links.find((x) => x.id === 'figma').locator, 'https://figma.test/a');
    ok(old, ['link', 'rm', 'figma'], SUP);
    assert.equal(json(ok(old, ['settings'])).links.figma, undefined);
    assert.equal(json(ok(old, ['log', '--type', 'act', '--json'])).filter((a) => a.class === 'registry-edit').length, 3);
  } finally { F.done(); }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern 'link add, set and rm'`
Expected: FAIL (`unknown command "link"`).

- [ ] **Step 3: The constitution**

In `governance/constitution.md` line 44, append `"registry-edit"` to the `constitutional` array (after `"fleet-unpark"`).

- [ ] **Step 4: The commands**

Before `// ===== 12. init, help, dispatch =====`:

```js
// Edit the json devteam block of the main checkout's settings.md in place, after checking the
// result as validate would: the registry is configuration, written where the supervisor's next
// chore PR picks it up (spec §7, open issue 14).
function editSettingsBlock(mutate) {
  if (repoRoot !== mainRoot) die(`run this from the main checkout (${mainRoot})`);
  const f = path.join(projectDir, 'settings.md');
  const text = readText(f) ?? die(`no ${path.relative(mainRoot, f)} (devteam.mjs init)`);
  const m = text.match(/```json devteam\s*\n([\s\S]*?)\n```/) ?? die('settings.md has no ```json devteam block');
  let block;
  try { block = JSON.parse(m[1]); } catch (e) { die(`settings.md: the json devteam block is not valid JSON: ${e.message}`); }
  const next = mutate(JSON.parse(JSON.stringify(block)));
  const { errors } = registryProblems({ ...SETTINGS_DEFAULTS, ...next });
  if (errors.length) die(`not written:\n  - ${errors.join('\n  - ')}`);
  const at = m.index + m[0].indexOf(m[1]);
  fs.writeFileSync(f, `${text.slice(0, at)}${JSON.stringify(next, null, 2)}${text.slice(at + m[1].length)}`);
  settingsCache = undefined;
  return next;
}
const LANDING_HINT = 'it applies here now; land it on main with the next chore PR: chore start registry, copy docs/devteam/project/settings.md into it, chore pr registry --title "registry", merge --chore registry';
// link add|set|rm: a link of the supervisor's kind (url: LINK_KINDS[k].ownedByOwner false) is
// written, then logged as registry-edit (constitutional), citing what it came from. A link of an
// owner's kind (repo) is the owner's: PR 2 drafts it as a question; until then it is refused.
// Nothing here branches on a kind name: the table says whose it is and which fields it has.
function cmdLink() {
  const [sub, id, field, ...vals] = positional;
  if (!['add', 'set', 'rm'].includes(sub) || !id) die('usage: link add <id> --kind <kind> --title t [kind fields: --url u, --remote r …] [--for scope…] [--notes n] [--source id]   |   link set <id> <field> <value>   |   link rm <id>');
  supervisorOnly('link');
  const cur = loadSettings().links?.[id];
  const kind = sub === 'add' ? flagStr('kind') : cur?.kind;
  if (sub !== 'add' && !cur) die(`no link ${id} (devteam.mjs links)`);
  if (sub === 'add' && cur) die(`${id} exists; use link set`);
  const K = LINK_KINDS[kind] ?? die(`--kind is one of: ${Object.keys(LINK_KINDS).join(', ')}`);
  if (sub === 'set' && field === 'kind') die('a link never changes kind in place: link rm it and link add it again (a kind flip is a removal and an addition)');
  if (sub === 'set' && field && !linkFields(kind).includes(field)) die(`"${field}" is not a field of a ${kind} link (fields: ${linkFields(kind).join(', ')})`);
  if (K.ownedByOwner) die(`a ${kind} link is the owner's (governance-edit): put the entry in settings.md on a chore branch and land it with merge --chore <slug> --approved <qid> (an answered governance-edit question)`);
  const source = flagStr('source');
  if (source && !logGet(source)) die(`--source ${source}: no such log entry`);
  // authority first, so a refusal writes nothing
  authorise('registry-edit', null, null, [], 'link');
  const jsonish = (raw) => { try { return JSON.parse(raw); } catch { return raw; } };
  let what;
  editSettingsBlock((b) => {
    b.links ??= {};
    if (sub === 'add') {
      const entry = { kind };
      for (const f of linkFields(kind).filter((x) => x !== 'kind' && flags[x] !== undefined)) entry[f] = f === 'for' ? listFlag('for') : jsonish(flagStr(f));
      for (const f of ['title', ...K.fields.required]) if (entry[f] === undefined) die(`link add --kind ${kind} needs --${f}`);
      b.links[id] = entry;
      what = `added ${kind} link ${id} (${K.locator(entry, id).text})`;
    } else if (sub === 'set') {
      if (!field || !vals.length) die('usage: link set <id> <field> <value>');
      b.links[id] = { ...b.links[id], [field]: jsonish(vals.join(' ')) };
      what = `set link ${id} ${field}`;
    } else { delete b.links[id]; what = `removed ${kind} link ${id}`; }
    return b;
  });
  appendLog({ type: 'act', decision: citing(), class: 'registry-edit', what, refs: [`link:${id}`, ...(source ? [source] : [])], reversible: true }, 'supervisor');
  out(`${what}; ${LANDING_HINT}`);
}
// links [--json]: the registry, each repo's effective settings, and the lines on each with their state.
function cmdLinks() {
  const s = loadSettings();
  const reg = s.links ?? {};
  const main = mainRef();
  const sMain = (main ? settingsAt(main, { orNull: true }) : null) ?? s;
  const cov = main ? coverageAt(main, sMain) : null;
  const home = { name: 'home', remote: git(['config', '--get', 'remote.origin.url']), root: mainRoot, effective: Object.fromEntries(REPO_KEYS.map((k) => [k, k === 'project' ? projectRel : s[k] ?? null])), components: componentsOn(s, 'home'), lines: linesDeclared(s), coverage: cov ? coverageGaps(cov, sMain) : null };
  const links = Object.entries(reg).map(([id, l]) => {
    const K = LINK_KINDS[l.kind];
    if (!K) return { id, ...l };
    const eff = K.effectiveSettings(l, s);
    return { id, ...l, locator: K.locator(l, id).text, ...(K.localOverrides.includes('path') ? { location: linkLocation(id), found: fs.existsSync(linkLocation(id)) } : {}), ...(eff ? { effective: eff } : {}), ...(K.hostsComponents ? { components: componentsOn(s, id) } : {}) };
  });
  if (flags.json) return json({ home, links });
  const gates = (g) => Object.keys(g ?? {}).join(', ') || 'none';
  out(`home: this repo (${home.remote ?? 'no origin'}), main_branch ${s.main_branch}, forge ${s.forge}, gates ${gates(s.gates)}`);
  out(`  components: ${home.lines ? home.components.map((c) => `${c.name}${c.shared ? ' (shared)' : ''} (${c.owns ? c.owns.join(', ') : 'everything devteam does not own'})`).join('; ') : `none declared: one implicit component owns every path${Object.keys(s.components ?? {}).length ? ' (components holds labels only)' : ''}`}`);
  if (home.coverage) out(`  coverage on ${main}: ${home.coverage.count + home.coverage.case_collisions.length ? `${home.coverage.unowned.length} unowned, ${home.coverage.contested.length} contested, ${home.coverage.empty.length} empty glob(s), ${home.coverage.case_collisions.length} case collision(s) (components check)` : 'every path in exactly one line'}`);
  for (const l of links) {
    const eff = l.effective ? `, main_branch ${l.effective.main_branch}, forge ${l.effective.forge}, gates ${gates(l.effective.gates)}` : '';
    out(`${l.id}: ${l.kind} ${l.locator ?? '(unknown kind)'} "${l.title}"${eff}${asList(l.for).length ? ` for ${asList(l.for).join(', ')}` : ''}${l.notes ? `; ${l.notes}` : ''}${l.check === false ? ' (not probed)' : ''}`);
  }
}
```

Add to `COMMANDS`: `link: cmdLink, links: cmdLinks,`. In `citeTargets`, add `case 'link': return [`link:${a ? positional[1] : ''}`];` — `positional` here is `[sub, id]`, so use `return [`link:${positional[1]}`];`. In the dispatch message at line 6704, add `link` to the list of commands that take `--decision`. In `HELP`, under "Decide and act":

```
  links [--json]                  the registry: home and each link, each repo's effective settings, the component lines and their coverage
  link add <id> --kind url --url u --title t [--for scope…] [--notes n] [--source id] | link set <id> <field> <value> | link rm <id>   supervisor: a url link, written to settings.md and logged as registry-edit; repo links are the owner's
```

- [ ] **Step 5: Run it, G1, the suite**

Run: `node --test --test-name-pattern 'link add, set and rm|G1:'` → PASS; `node --test` → `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs docs/devteam/governance/constitution.md test/kit.test.mjs
git commit -m "links and link add|set|rm: url links are the supervisor's, logged as registry-edit (constitutional)"
```

---

### Task 14: `observe-link` and orient's link proposals

**Files:**
- Modify: schema `observation` (add `link`); add `cmdObserveLink` after `cmdObserve` (`devteam.mjs:3794-3804`); `orientClusters` (`3890-3911`); `cmdOrient` (`3912-3917`); `COMMANDS`, `HELP`
- Test: `test/kit.test.mjs`

**Interfaces:**
- Produces: `observe-link (--url u | --path p) --title t [--for scope…] [--notes n] [--owner]` → an observation `{ kind: 'link', subject: <url|path>, source_key: 'link:<url|path>', link: {…} }`; `orientLinks() → { key, proposal: 'add'|'edit'|'conflict', observation, link?, rival?, command }[]`.

- [ ] **Step 1: Write the failing test**

```js
test('observe-link records a resource; orient proposes adds, edits and source-of-truth questions', () => {
  const F = monoFixture('observe-link');
  const { old, ok, run, edit } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    edit((j) => { j.links = { figma: { kind: 'url', title: 'Designs', url: 'https://figma.test/a', for: ['component:web'] } }; });
    assert.equal(json(ok(old, ['orient', '--json'])).length, 0);
    const o1 = ok(old, ['observe-link', '--url', 'https://notion.test/runbook', '--title', 'Runbook', '--for', 'all', '--owner']);
    const o2 = ok(old, ['observe-link', '--url', 'https://figma.test/a', '--title', 'Designs', '--for', 'component:api', '--notes', 'also the API screens'], SUP);
    const o3 = ok(old, ['observe-link', '--url', 'https://figma.test/b', '--title', 'designs', '--for', 'component:web'], SUP);
    const obs = json(ok(old, ['log', '--type', 'observation', '--json'])).find((x) => x.id === o1);
    assert.deepEqual([obs.kind, obs.subject, obs.link.title, obs.link.for], ['link', 'https://notion.test/runbook', 'Runbook', ['all']]);
    const props = json(ok(old, ['orient', '--json'])).filter((x) => x.proposal);
    assert.deepEqual(props.map((p) => [p.proposal, p.observation]).sort(), [['add', o1], ['conflict', o3], ['edit', o2]].sort());
    assert.match(props.find((p) => p.proposal === 'add').command, /^link add runbook --kind url --url https:\/\/notion\.test\/runbook --title "Runbook" --for all --source o-/);
    assert.match(props.find((p) => p.proposal === 'edit').command, /link set figma for '\["component:web","component:api"\]'/);
    assert.match(props.find((p) => p.proposal === 'conflict').command, /^ask --question "Which is the source of truth/);
    assert.match(ok(old, ['orient']), /link proposals:\n  add/);
    assert.match(run(old, ['observe-link', '--url', 'https://x.test'], SUP).err, /--title/);
  } finally { F.done(); }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern 'observe-link records'`
Expected: FAIL (`unknown command "observe-link"`).

- [ ] **Step 3: Schema and command**

In `observation.properties` add:

```json
"link": { "description": "On a link observation: the resource the work depends on, as the owner or a worker gave it (the supervisor folds these into the registry, settings.md links).", "type": "object", "properties": { "url": { "type": "string", "pattern": "^https?://" }, "path": { "type": "string", "pattern": "^(?!/)(?!.*\\.\\.)[^\\s]+$" }, "title": { "type": "string", "minLength": 1 }, "for": { "type": "array", "items": { "type": "string" } }, "notes": { "type": "string" } }, "required": ["title"], "additionalProperties": false }
```

After `cmdObserve`:

```js
// observe-link: a resource the owner mentioned or the work depends on, for orient to fold into the
// registry (spec §7). Anyone writes it; only the supervisor's link command changes the registry.
function cmdObserveLink() {
  const by = flags.owner ? ownerWriter().by : logWriter();
  const url = flagStr('url'), p = flagStr('path');
  if (!url === !p) die('observe-link needs --url <https://…> or --path <repo path>, and --title');
  const title = flagStr('title') ?? die('observe-link needs --title (what it is called)');
  const scopes = flags.for !== undefined ? listFlag('for') : [];
  for (const sc of scopes) if (!scopeValid(sc, 'for')) die(`--for "${sc}" is not a scope (${SCOPE_HELP.for})`);
  const line = appendLog({ type: 'observation', source: writerClass(by), subject: url ?? p, kind: 'link', detail: `${title}${flagStr('notes') ? `: ${flagStr('notes')}` : ''}`, source_key: `link:${url ?? p}`, link: { url, path: p, title, for: scopes.length ? scopes : undefined, notes: flagStr('notes') } }, by);
  out(line.id);
}
```

Add `'observe-link': cmdObserveLink,` to `COMMANDS` and to `HELP` under "Observe and orient": `observe-link --url u | --path p --title t [--for scope…] [--notes n] [--owner]   a resource the work uses; orient proposes it for the registry`.

- [ ] **Step 4: Orient**

In `orientClusters`, change the skip list at line 3896 to `['reading', 'retro', 'outcome', 'link'].includes(o.kind)` (link observations fold separately, below). Add:

```js
// Link observations against the registry (spec §7, orient): a URL already there with a better
// title, wider for or new notes is a proposed edit; a fresh URL a proposed add; a URL whose title
// matches another link for an overlapping scope a question about which is the source of truth
// (open issue 10). Proposals only: the supervisor decides and acts with link, or asks.
function orientLinks() {
  const reg = loadSettings().links ?? {};
  const norm = (u) => String(u ?? '').replace(/\/+$/, '').toLowerCase();
  const used = new Set(Object.values(reg).map((l) => l.source).filter(Boolean));
  const q = (x) => JSON.stringify(x);
  const overlap = (a, b) => { const x = asList(a).length ? asList(a) : ['all'], y = asList(b).length ? asList(b) : ['all']; return x.includes('all') || y.includes('all') || x.some((s) => y.includes(s)); };
  const res = [];
  for (const o of logObjects('observation').filter((x) => x.kind === 'link' && x.link?.url && !used.has(x.id)).sort(byTime)) {
    const l = o.link;
    const same = Object.entries(reg).find(([id0, r]) => { const u = LINK_KINDS[r.kind]?.locator(r, id0).url; return !!u && norm(u) === norm(l.url); });
    if (same) {
      const [id, r] = same;
      const wider = asList(l.for).filter((s) => !asList(r.for).includes(s));
      const sets = [...(wider.length ? [`link set ${id} for '${q([...asList(r.for), ...wider])}'`] : []), ...(l.notes && l.notes !== r.notes ? [`link set ${id} notes ${q(l.notes)}`] : []), ...(l.title !== r.title && l.title.length > r.title.length ? [`link set ${id} title ${q(l.title)}`] : [])];
      // an edit to a link of an owner's kind (repo) is the owner's: the proposal is the question
      if (sets.length) res.push({ key: `link-proposal:${id}`, proposal: 'edit', link: id, observation: o.id, command: LINK_KINDS[r.kind]?.ownedByOwner ? `ask --class governance-edit --question "Change ${id} in the registry: ${sets.join('; ').replace(/"/g, "'")}?" --evidence ${o.id} --recommendation yes` : sets.join(' && ') });
      continue;
    }
    const rival = Object.entries(reg).find(([id0, r]) => !!LINK_KINDS[r.kind]?.locator(r, id0).url && r.title.toLowerCase() === l.title.toLowerCase() && overlap(r.for, l.for));
    if (rival) { res.push({ key: `link-proposal:${rival[0]}`, proposal: 'conflict', rival: rival[0], observation: o.id, command: `ask --question "Which is the source of truth for ${l.title}: ${LINK_KINDS[rival[1].kind].locator(rival[1], rival[0]).url} or ${l.url}?" --links '${q([{ title: rival[1].title, link: rival[0] }, { title: l.title, url: l.url }])}' --evidence ${o.id}` }); continue; }
    res.push({ key: `link-proposal:${slug(l.title)}`, proposal: 'add', observation: o.id, command: `link add ${slug(l.title)} --kind url --url ${l.url} --title ${q(l.title)}${asList(l.for).length ? ` --for ${asList(l.for).join(' ')}` : ''}${l.notes ? ` --notes ${q(l.notes)}` : ''} --source ${o.id}` });
  }
  return res;
}
```

Replace `cmdOrient` (lines 3912-3917):

```js
function cmdOrient() {
  const cl = orientClusters();
  const lk = orientLinks();
  if (flags.json) return json([...cl, ...lk]);
  if (!cl.length && !lk.length) return out('nothing recurring that is unexplained');
  for (const c of cl) out(`${c.key}  x${c.count}  valence ${c.valence}\n  latest: ${c.latest}\n  evidence: ${c.ids.join(' ')}`);
  if (lk.length) { out('link proposals:'); for (const p of lk) out(`  ${p.proposal} (${p.observation}): ${p.command}`); }
}
```

- [ ] **Step 5: Run it, G1, the suite**

Run: `node --test --test-name-pattern 'observe-link records|G1:'` → PASS; `node --test` → `ℹ fail 0` (the orient subtest asserts `orient --json` length 1 with no link observations).

- [ ] **Step 6: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs docs/devteam/schema/log.schema.json test/kit.test.mjs
git commit -m "observe-link, and orient's link proposals: add, edit, or ask which is the source of truth"
```

---

### Task 15: `link-unreachable` and `line-pressure`

**Files:**
- Modify: `cmdObserveMetrics` (`devteam.mjs:3819-3823`); `collectMetrics` (before line 5033, after the Task 9 block); `cmdMerge` (after `const fails = checkPr(...)`, line 2282)
- Test: `test/kit.test.mjs`

**Interfaces:**
- Produces: `probeLinks()` (refreshes `run/link-probes.json`, `PROBE_FILE = runPath('link-probes.json')`, `{ <id>: { at, target, problem } }`, for links whose last probe is a day old; never in `metrics` or the dashboard); `DEVTEAM_URL_PROBE` (a command given the URL; it prints the HTTP status: the test seam that keeps tests off the network); findings `link-unreachable` (`high`, record severity 3) and `line-pressure` (`medium`, 2); observation kind `footprint-refusal` from `merge`.

- [ ] **Step 1: Write the failing test**

```js
test('link-unreachable for a missing checkout or a failing URL (stubbed), and line-pressure from refusals', () => {
  const F = monoFixture('reach');
  const { old, ok, edit, g } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const stub = path.join(F.base, 'probe.sh');
  write(stub, '#!/bin/sh\ncase "$1" in *gone*) echo 404 ;; *) echo 200 ;; esac\n');
  fs.chmodSync(stub, 0o755);
  try {
    edit((j) => { j.links = { console: { kind: 'repo', title: 'Console', remote: 'usbclub/console' }, gone: { kind: 'url', title: 'Gone', url: 'https://gone.test/x' }, fine: { kind: 'url', title: 'Fine', url: 'https://fine.test' }, private: { kind: 'url', title: 'P', url: 'https://gone.test/private', check: false } }; });
    g(['commit', '-qam', 'links'], old); g(['push', '-q', 'origin', 'main'], old);
    const run2 = (args) => { const r = spawnSync(process.execPath, [path.join(old, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: old, env: { ...F.env(SUP), DEVTEAM_URL_PROBE: stub }, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
    run2(['observe-metrics']);
    const fs_ = json(ok(old, ['metrics', '--json'])).findings.filter((f) => f.kind === 'link-unreachable');
    assert.deepEqual(fs_.map((f) => f.subject).sort(), ['console', 'gone']);
    assert.match(fs_.find((f) => f.subject === 'console').detail, /its checkout .*console is missing/);
    assert.match(fs_.find((f) => f.subject === 'gone').detail, /HEAD returned 404/);
    assert.equal(json(ok(old, ['log', '--type', 'observation', '--json'])).find((o) => o.kind === 'link-unreachable').severity, 3);
    assert.ok(fs.existsSync(path.join(old, 'docs/devteam/run/link-probes.json')));
    assert.doesNotMatch(json(ok(old, ['fleet', 'status', '--json', '--no-fetch'], SUP)).blockers.join('\n'), /files in run\/ the kit didn't make/, 'the probe file is a kit file (RUN_KNOWN)');
    // line-pressure: three footprint refusals on one component in 14 days
    F.lines(F.STD);
    for (const n of ['01', '02', '03']) ok(old, ['observe', '--subject', 'web', '--kind', 'footprint-refusal', '--detail', `web-${n}-x refused`, '--key', `footprint:web-${n}-x:${n}`], SUP);
    const lp = json(ok(old, ['metrics', '--json'])).findings.find((f) => f.kind === 'line-pressure');
    assert.equal(lp?.subject, 'web');
    assert.match(lp.detail, /3 footprint refusals in 14 days/);
  } finally { F.done(); }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern 'link-unreachable for a missing'`
Expected: FAIL (no `link-unreachable` findings).

- [ ] **Step 3: Probes, findings, refusals**

After `cmdObserveMetrics`, add and wire `probeLinks()` as its first line (`probeLinks();` before `const s = observeSpend();`):

```js
// Whether each link still exists, at most once a day per link, by its kind's probe (one HEAD
// request, one ls-remote); nothing is fetched (spec §2, non-goals). The result waits in run/ for
// metrics to read, so metrics and the dashboard never touch the network. A link edited since its
// last probe (any field) is probed again. DEVTEAM_URL_PROBE stands in for the HEAD request in tests.
const PROBE_FILE = runPath('link-probes.json');
function probeLinks() {
  const reg = loadSettings().links ?? {};
  if (!Object.keys(reg).length) return;
  let cache = {};
  try { cache = readJson(PROBE_FILE); } catch {}
  for (const [id, l] of Object.entries(reg)) {
    const K = LINK_KINDS[l.kind];
    if (!K || (cache[id] && Date.now() - Date.parse(cache[id].at) < DAY && cache[id].target === canonical(l))) continue;
    cache[id] = { at: nowIso(), target: canonical(l), problem: K.probe(l, id) };
  }
  writeJson(PROBE_FILE, cache);
}
```

In `collectMetrics`, after the Task 9 block:

```js
  // The registry (spec §7): a link that no longer resolves, and lines drawn in the wrong place.
  {
    const reg = settings.links ?? {};
    let probes = {};
    try { probes = readJson(PROBE_FILE); } catch {}
    for (const [id, l] of Object.entries(reg)) {
      const K = LINK_KINDS[l.kind];
      if (!K) continue;
      const why = K.reachable(l, id) ?? (probes[id]?.target === canonical(l) ? probes[id].problem : null);
      if (why) add('high', 'link-unreachable', id, why, K.fixHint(l, id));
    }
    if (linesDeclared(settings)) {
      const since14 = now - 14 * DAY;
      const refusals = groupBy(logObjects('observation').filter((o) => o.kind === 'footprint-refusal' && Date.parse(o.created_at) >= since14), (o) => o.subject);
      const shared = Object.entries(settings.components).filter(([, c]) => c?.shared).map(([n]) => n);
      for (const c of [...new Set([...Object.keys(refusals), ...shared])]) {
        const n = refusals[c]?.length ?? 0;
        const planned = shared.includes(c) ? [...ts.values()].filter((t) => Date.parse(t.created_at) >= since14 && (t.component === c || (t.touches_components ?? []).includes(c))).length : 0;
        if (n >= 3 || planned >= 3) add('medium', 'line-pressure', c, [n >= 3 && `${n} footprint refusals in 14 days`, planned >= 3 && `${planned} tickets planned against the shared component in 14 days`].filter(Boolean).join('; '), 'the line may be in the wrong place: move it in a chore PR (settings components), or plan a contract ticket that settles the shared part');
      }
    }
  }
```

In `cmdMerge`, after line 2282 (`const fails = checkPr(...)`):

```js
  // A refused footprint is a sign about the line (line-pressure, spec §7): one observation per head.
  if (id && fails.some((x) => x.startsWith(OFF_LINE))) {
    const key = `footprint:${id}:${sha}`;
    if (!logObjects('observation').some((o) => o.source_key === key)) appendLog({ type: 'observation', source: 'supervisor', subject: tickets().get(id)?.component ?? id, kind: 'footprint-refusal', detail: `${id} at ${sha.slice(0, 12)} changes files outside its line`, source_key: key, refs: [id] }, 'supervisor');
  }
```

- [ ] **Step 4: Run it, G1, the suite**

Run: `node --test --test-name-pattern 'link-unreachable for a missing|G1:'` → PASS; `node --test` → `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/kit.test.mjs
git commit -m "Findings: link-unreachable (probed once a day, stubbable) and line-pressure (refusals, shared components)"
```

---

### Task 16: Help text, the init hint, and the last G1 sweep of new commands

**Files:**
- Modify: `HELP` (`devteam.mjs:6605-6682`) if anything from Tasks 5, 13, 14 is missing; `cmdInit` next-step line (`6602`)
- Test: `test/kit.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
test('help names the new commands', () => {
  const F = monoFixture('help');
  try {
    const h = F.ok(F.old, ['help']);
    for (const c of ['links [--json]', 'link add <id> --kind url', 'components check', 'observe-link']) assert.ok(h.includes(c), c);
  } finally { F.done(); }
});
```

- [ ] **Step 2: Run, fix any missing help line, run again**

Run: `node --test --test-name-pattern 'help names the new commands'` → PASS after adding what is missing.

- [ ] **Step 3: The init hint**

`cmdInit` line 6602 becomes:
`out('next: fill settings (components and their owns, links to sibling repos and design files, agent_command, gates, worktree_files), write designs/architecture.md from the code, then start the supervisor (the upstream README, Setup)');`
This is the output of `init`, not of a running project; no golden covers it.

- [ ] **Step 4: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/kit.test.mjs
git commit -m "help and init name the registry and the lines"
```

---

### Task 17: G1 check

A single-repo project with no new settings must print what it printed before, and the suite must be green on every supported Node.

**Files:** none changed unless a check fails.

- [ ] **Step 1: The goldens**

Run: `node --test --test-name-pattern 'G1:'`
Expected: PASS against goldens recorded in Task 1, changed only by Task 5's one line (in `check-ticket.txt` and `merge-dry-run.txt`). Check: `git log --oneline -- test/fixtures/g1` shows exactly two commits (Task 1, Task 5).

- [ ] **Step 2: Labels-only components**

Run: `node --test --test-name-pattern 'labels-only components'` (the Task 3 test) → PASS.

- [ ] **Step 3: The new code is behind the gates**

Read the diff (`git diff origin/main -- docs/devteam/scripts/devteam.mjs`) and confirm, for each hunk, that it runs nothing new unless `linesDeclared(...)`, a non-empty `links`, a new command, or a new optional field holds. Write the list of hunks and their gate into the PR description. The ones that change behaviour for everyone are exactly: `changedFiles` and `treePaths` read `-z` output (Task 5), `settings` prints `"links": {}` (Task 3), `orient` skips observations of kind `link` in clusters (Task 14), `observe-metrics` calls `probeLinks()`, which returns at once with no links (Task 15), `RUN_KNOWN` moves and grows by registration (Task 3; the same names for a single-repo project, plus `links.local.json` and `link-probes.json`, which a single-repo project never writes), and `settingsAt` gains an option its existing callers don't pass (Task 5).

- [ ] **Step 4: The full suite on each Node**

Run (asdf, as the repo pins `nodejs 18.20.4` in `.tool-versions`):

```bash
cd <repo>
for v in 18.20.4 20 22 24; do echo "== node $v"; ASDF_NODEJS_VERSION=$v node --version && ASDF_NODEJS_VERSION=$v node --test 2>&1 | tail -4; done
```

Expected: `ℹ fail 0` four times. Where a version isn't installed locally, CI's matrix (`.github/workflows/*.yml`) is the check; push the branch and read it.

- [ ] **Step 5: Commit any fix, separately, with the reason**

---

### Task 18: Docs and the release notes

**Files:**
- Modify: `README.md`, `docs/devteam/governance/quality.md`, `docs/devteam/governance/constitution.md`, `docs/devteam/process/planning.md`, `docs/devteam/process/supervisor.md`, `docs/devteam/process/worker.md`

- [ ] **Step 1: README**
  - New section after "Holding goals, and moving the fleet" (before `## Upgrading a project`, line 93): **"Links, components and other repos"**: the three shapes with minimal settings. (1) A single repo: nothing to add. (2) A monorepo: `components` with `owns` per app, every tracked file in exactly one line, using non-overlapping lines (open issue 2), with `components check` to see the gaps. (3) Links to design files and docs: `links` entries of kind `url`, with `for` scopes; the loop proposes them (`observe-link`, `orient`, `link add`). Say sibling repos (kind `repo`) are accepted and validated now, and host tickets from the next release.
  - Setup step 4 (line 47): replace "components and stacks" with "the registry: sibling repos as `repo` links and design files and docs (Figma, specs, Notion) as `url` links, inferred from git remotes, links in the README and docs, and package manifests; the component lines (`components.<c>.owns`) once there is more than one deployable part; and the stacks", and keep "ask the owner the rest in one batch".
  - Setup step 7 (line 50): add the Baseline precondition "the registry is complete": (a) `components check --count` is 0 (counted with the gates), (b) an owner question, "Does the registry list every repo, design file and doc this project depends on?"
  - The file map at the top (line 19 area) doesn't change.
- [ ] **Step 2: governance/quality.md**
  - §1 point 9 (line 17): "Every changed file is inside the ticket's `touches`, and, once components draw lines, inside its component's line or a `touches_components` member's; or in its own `project/tickets/<id>/` folder."
  - §2, after the table: a paragraph "**Component lines (invariant C).** Once `settings.components` draws lines, every tracked file in home belongs to exactly one component's `owns`, the kit's own files (`docs/devteam/**`, the project folder) to the computed `devteam` line. `validate` checks main; `check-pr` and `merge` check the tree that would land (the merge on forge `git`) and refuse what a PR adds outside every line; `observe-metrics` raises `unowned-files` and starts no new ticket until a chore extends a line; `check-ticket` refuses a file outside the ticket's line. All four read committed settings. A gap on main also blocks plan PRs: their `validate --strict` reports it as an error, so the chore that extends a line lands first."
  - §4, the owner-settings paragraph (line 106): add "and, per entry, `links`: adding, removing or re-kinding a `repo` link, or changing its `remote`, `main_branch`, `forge`, `merge_method`, `release`, `project`, `title`, `notes`, `for` or `source` is `governance-edit`; its `gates`, `worktree_setup`, `worktree_files` or `ignored_checks` is `gate-change`; its `path` and anything on a `url` link are not the owner's (url links are the supervisor's, by `registry-edit` acts)."
- [ ] **Step 3: governance/constitution.md**: the json block already has `registry-edit` (Task 13); in §2's prose about constitutional classes (line 61), add one sentence: "`registry-edit` (a url link added, changed or removed) is constitutional: the owner corrects it like any act, and a correction becomes a lesson scoped `link:<id>`, not a trust drop. If the owner wants trust semantics here later, it becomes a ladder class at start 3, ceiling 3."
- [ ] **Step 4: process/planning.md**
  - The ticket-field table (line 121): `feature, component` row: "the feature slug; the one component this ticket changes (a contract or integration ticket may name more in `touches_components`)". New rows: `touches_components` ("on a contract or integration ticket, other components in the same repo its touches may fall in; the only way to touch a `shared` component besides that component's own tickets") and `links` ("registry links its worker needs; a feature's `links` reach every one of its tickets").
  - D2 (line 134): add "A contract may span two lines in one repo with `touches_components`."
  - §2, the design (around line 63, "components and boundaries"): "Draw component lines in `architecture.md` §1 and in `settings.components`: every tracked file in exactly one line; generated and vendored folders belong to a line like anything else."
  - §7, Baseline (line 160): its preconditions gain "the registry is complete": (a) the repo-checkable floor gaps, counted with the gates (`components check --count`: unowned, owned twice, a component whose link is not a repo link, a glob that matches nothing); (b) the owner's yes to "Does the registry list every repo, design file and doc this project depends on?", asked as an owner-decision question with `--goal <Baseline>`; the supervisor logs `goal-readiness` only after it is answered. Note: when the measure-sources change lands, (b) becomes a `goal-met` owner source.
- [ ] **Step 5: process/supervisor.md**
  - §3, the tick: "`observe-metrics` also probes the registry once a day (`link-unreachable`), checks main's lines (`unowned-files`: no new ticket starts until a chore extends a line) and watches for `line-pressure`."
  - New subsection in §9 (Improvement) or after §8: **"The registry: links the loop keeps"**: when the owner names a resource (terminal, `send --owner`, an answer, a goal interview), log `observe-link`; `orient` lists proposals; for a url link apply it with `link add|set|rm` (registry-edit, constitutional, cite the observation with `--source`), then land `settings.md` with the next `chore-registry` PR; for a repo link, draft the entry and ask a `governance-edit` question; the owner's chat message names the repo but is never the approval. `orient`'s edit proposals for a link of an owner's kind (a repo link's `title`, `notes` or `for`) come as an `ask --class governance-edit` command, never as a `link set`: those fields are the owner's too.
- [ ] **Step 6: process/worker.md**
  - §1 ("What you were given", line 5): "Your prompt may carry a **Links** block: the registry links your ticket, its component, feature or goal uses. Read them; don't copy them into the repo."
  - §6 ("Gates and observations", line 55): "When the work depends on a resource the registry lacks (a design cited in a PR, a runbook), log it: `devteam.mjs observe-link --url <u> --title <t> [--for component:<c>]`."
  - §3 ("The rules"): "Once components draw lines, every file you change is inside your ticket's touches and your component's line (or a `touches_components` member's), or under your own `project/tickets/<id>/`; `check-ticket` refuses the rest."
- [ ] **Step 7: Release notes text** (for `gh release create vX.Y.Z --notes-file notes.md`; README "Contributing")

```markdown
## What

- `settings.md` gains a links registry, `links`: named resources the fleet uses. Kind `url` (design files, Notion pages, runbooks: `title`, `url`, optional `for` scopes, `notes`, `check: false`) and kind `repo` (a sibling repo: `remote`, optional `path` and per-repo settings). Repo links are parsed, pinned to main and validated; they host tickets from the next release.
- Component lines: a component that carries `owns` (globs), `link`, `shared` or `release` draws a line. Once a project draws lines, every tracked file in the repo belongs to exactly one line, and the kit's own files to the computed `devteam` line. `validate`, `check-pr` and `merge` (the tree that would land; on forge `git`, the merge), `observe-metrics` (`unowned-files`, which starts no new ticket until a line covers the gap) and `check-ticket` (a changed file inside the component's line) enforce it, all from committed settings.
- Tickets gain `touches_components` (contract and integration tickets that span lines in one repo) and `links`; features gain `links`. `validate` checks every `touches` entry lies in one line.
- Prompts gain a **Links** block: every link whose `for` matches the ticket's component, feature or goal, plus `all`, plus the ticket's and feature's own links.
- One scope grammar for knowledge and link scopes; `link:<id>` joins both.
- Commands: `links [--json]`, `link add|set|rm` (url links; a constitutional `registry-edit` act), `components check [--ref] [--count] [--json]`, `observe-link`. `orient` proposes registry adds, edits and source-of-truth questions.
- Findings: `link-unreachable` (3), `unowned-files` (4), `line-pressure` (2).
- `owner settings`: `links` is diffed entry by entry (`links.<id>.gates` is `gate-change`; the rest of a repo link is `governance-edit`; url links and `path` are not the owner's).
- Questions' `--links` items may name a registry link: `{ "title": "…", "link": "<id>" }`.
- `check-ticket` and `merge` read changed paths with `git diff -z`: a non-ASCII or spaced path is no longer printed (or matched) as quoted octal.

## Why

- A monorepo can say which files each part owns, and devteam enforces it everywhere code reaches main, so a ticket for `web` can't edit `api`.
- Design files and docs are named once, scoped to the work they serve, and put into the prompts of the workers who need them; the loop adds them when the owner or a worker mentions one.
- It lays the registry the next release builds on to run tickets in sibling repos.

## Migration

None. A single-repo project prints exactly what it printed before. A `components` map that holds only labels (a stack, a path) stays labels: it draws no lines until an entry carries `owns`, `link`, `shared` or `release`. A project whose tickets use `home` or `devteam` as their component gets one `validate` error naming them and the rename. To opt in: draw lines in `settings.components` (`components check` shows the gaps), and add `links` for the design files and docs workers should see. Adopting supervisors: the Baseline goal gains the precondition "the registry is complete" (`process/planning.md` §7).
```

- [ ] **Step 8: Commit**

```bash
git add README.md docs/devteam/governance docs/devteam/process
git commit -m "Docs: links, component lines, the registry loop, the Baseline's registry precondition"
```

---

## Spec coverage (self-review)

| Spec | Task |
|---|---|
| §3.1 links, reserved ids, `LINK_KINDS`, common and kind fields, validity | 3 |
| §3.2 components, `owns`, object entries reserved, `shared`, `release` shape | 3, 6 |
| §3.3 resolution and defaults, per-repo keys, home's effective settings | 3, 13 (`links` shows them) |
| §3.4 entry-level owner classes, kind flips, `loadSettings` pinning, residual power | 4 |
| §3.5 machine-local paths (`run/links.local.json`, committed, `../<id>`) | 3 (`linkLocation`); `--path` and origin verification are PR 2 |
| §4 one tree reader, `-z`, `devteam` line, invariant C, `**` default, no opt-out, glob discipline, case collisions | 2, 5 |
| §4 points 1-4 | 6, 8, 9, 7 |
| §6.1 containment, footprint, link that doesn't host components | 6, 7, 3 |
| §6.2 within one repo (`touches_components`, shared) | 6, 7 (open issue 3) |
| §6.3 `links` on tickets/features, Links block, question links, design citations | 11, 12 |
| §7 observe, orient, decide and act, findings, knowledge `link:` | 14, 13, 9, 15, 10 |
| §7.1 one scope grammar | 10 |
| §8 commands (no `--repo`, no repo-link adds) | 5, 13, 14 |
| §9 adoption, Baseline (a) count and (b) owner question | 5 (`--count`), 18 |
| §10 docs and schema | 11, 12, 14, 10, 18 |
| §12 coverage table and property tests | 2 |
| §12 settings: entry-level owner diff, G1 byte-identical validate/status/check-ticket | 4, 1, 17 |
| §12 monorepo fixture: new folder, rename, narrowed glob, footprint, contract, `unowned-files` blocks `ready` | 8, 7, 9 |
| §12 links: unknown kind, unknown id, Links block, `link add` url, `link-unreachable` (missing path; URL stubbed) | 3, 11, 13, 15 |
| §12 regression B1, B2, B3 | 7, 2, 13 |
| §12 regression M1, M2, M4, M5, M10, m1, extensibility 3 | 8, 4, 5+7, 8, 8, 3, 3 |
| §12 sibling fixture, `link add` repo, M3, M6, M7, M8, M9 | PR 2 plan |

