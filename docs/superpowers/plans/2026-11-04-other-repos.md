# PR 2, "Components in other repos": Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One fleet, one log and one graph run tickets in several repos. Each ticket changes exactly one repo and carries its code and its records at the exact head. Gates, reviews and merges run per repo; the supervisor, the log and the dashboard stay in home.

**Architecture:** A memoized `repo(name)` object per repo link (root, common dir, remote, effective settings, project folder, git and gh bound to that repo, its own caches), with `home` built from the existing module-level helpers so that a single-repo project runs today's code. Home is found from `DEVTEAM_HOME` or the running script, never from the cwd. Every git call without a cwd goes to home unless the command runs in a home checkout, and the few that read "my own HEAD" say so (`cwdGit`). Two kinds of router: views (status, metrics, ready, the dashboard, fleet status) route by *name* (`repoOfTicketLink(t)`) and never fail on a missing checkout; acts on one ticket or repo (`worker`, `merge`, `check-ticket`, `check-pr`, `review-worktree`) route by *object* (`repoOfTicket(t)`, `repo(name)`) and fail fast. A lint test keeps views off the object routers. Plan and chore work stays home's.

**Tech Stack:** Node 18+ built-ins only, git ≥ 2.38, tmux, `node --test`.

**Builds on:** PR 1 (`docs/superpowers/plans/2026-11-04-links-and-lines.md`), merged first. Names it produces and this plan uses: `LINK_KINDS` (with `validate`, `reachable` memoized per process, `probe`, `fixHint`, `locator`, `ownedByOwner`), `linkFields`, `REPO_KEYS`, `REPO_INHERITED`, `REPO_OWN`, `remoteKey`, `linkLocation`, `LINKS_LOCAL`, `RUN_KNOWN`, `runPath`, `PROBE_FILE`, `linesDeclared`, `componentsOn`, `componentLink`, `registryProblems`, `ownersOf`, `coverage`, `prefixOwners`, `gitFacts`, `homeFacts`, `settingsAt(ref, { orNull })`, `settingsInForce(base, sha, R)`, `coverageAt(ref, s, R)`, `coverageGaps`, `coverageReport(cov, s, R)`, `treePathsMemo(ref, R)`, `coverageFails(base, sha, R)`, `landingTree(sha, R)`, `coverageGap(name, R)`, `treePaths`, `changedFiles`, `mergeTree`, `devteamLine`, `OFF_LINE`, `linksBlock`, `editSettingsBlock`, `LANDING_HINT`, `cmdLink`, `cmdLinks`, `cmdComponents`, `g1Outputs`, `monoFixture`, `fleetFixture`. (PR 1 names its per-process memo of `LINK_KINDS.repo.reachable` `linkReachMemo`: the baseline already has a `const reachMemo` at `devteam.mjs:2791` (`05aba1c`), for `commitReachable`. This plan refers to it only as "`reachable`, memoized per process".) Every coverage helper already takes a repo argument defaulting to `homeFacts`; this plan passes `repo(name)` objects, which carry the same fields, so PR 2 adds call arguments, not new call shapes. Line numbers below are for `05aba1c` (before PR 1); PR 1 shifts them by a few hundred lines in the later sections, so each anchor also names the function.

**Spec:** `docs/superpowers/specs/2026-11-04-links-components-multirepo-design.md` (rev 2), §5, §6.2 (cross-repo), §8 (`--repo`, repo-link `link add`, `init --github --repo`), §10, §12.

## Global Constraints

- G1: single-repo projects behave exactly as today with no settings changes (spec §2). The PR 1 goldens (`test/fixtures/g1/*.txt`) are never re-recorded in this PR.
- Each ticket changes exactly one repo; no multi-repo tickets; no cross-repo atomic merges (spec §2, §6.2).
- `repo(name)` is a memoized object, not a parameter threaded through helpers; module-level helpers keep their signatures as home's (spec §5.1).
- `gates`, `worktree_setup`, `worktree_files`, `ignored_checks` are never inherited; `merge` refuses a repo with no gates as it refuses home today (spec §3.1).
- `repo()` fails fast with one clear message when a checkout is missing or its `origin` doesn't match `remote` (spec §5.1).
- `DEVTEAM_HOME` must be a checkout with `docs/devteam/project` and must not be a repo link's checkout; anything else is refused, never followed (spec §5.1).
- Worker, planner, review and gate worktrees all live at `home/.worktrees/<name>` (spec §5.2).
- A ticket in repo R keeps `tickets/<id>/` under `R.projectRel`, committed on its branch in R; R's project folder holds only `tickets/` (spec §5.3).
- Plan and chore PRs are always home's (spec §5.4).
- Every `gh` call goes through `repo.gh`, which always passes `-R` when the remote names a GitHub repo (spec §5.1).
- Node 18 floor, built-ins only, the file's style, `code-style.md` and `quality.md` as in PR 1. Never `rm` inside `sh -c` or `eval`, never `rm` a variable path.

## Suite baseline

On `05aba1c` (before PR 1), 2026-11-04, Node v24.14.1, a loaded machine (load 6 to 7): **1406 s; 42 tests, 40 pass, 2 fail**. The failure is the load-sensitive `wait` assertion at `test/kit.test.mjs:1647` and its parent (details in PR 1's plan, "Suite baseline"). Re-measure on PR 1's merge commit before Task 1 and write it into the PR description; PR 1 adds about fifteen top-level tests.

## Open issues for the coordinator

1. **"projectDir … never from the cwd" would break planners.** Spec §5.1's table assigns `projectDir`, `projectRel` and `projectInRepo` to home "resolved … never from the cwd". Today `projectDir` is the project folder of the checkout the command runs in (`devteam.mjs:159`, `165`): a planner writes `plan-<feature>.jsonl` into *its worktree's* `project/log` (`durableLogDir`, `devteam.mjs:566`; test `test/kit.test.mjs:135`) and `validate` reads the branch's reviews and designs from there (`WORKTREE`, `devteam.mjs:1109`, `1453-1455`). Pointing it at home's main checkout would make every planner write into main. **Plan:** `projectDir` stays the cwd checkout's project folder when that checkout is a home checkout (same git common dir as home); otherwise it is home's main checkout's. `projectRel` is computed relative to whichever checkout holds it. `mainRoot`, `commonDir` and `runDir` are home's, from `DEVTEAM_HOME` or the script, never the cwd.
2. **Which settings route a ticket to its repo.** `repoOfTicket(t) → repo(component(t.component).link)` doesn't say whose components. PR 1 reads `components` from the working tree for prompts, but routing decides where `merge` looks for a PR and runs gates. **Plan:** routing uses main's committed components (`settingsAt(mainRef())`, falling back to `loadSettings()` before settings land), consistent with "enforcement never reads the working-tree copy". Moving a component's `link` takes effect when its chore PR lands.
3. **"Review pages" in §5.1.** The call-site list includes "the dashboard's ticket views and review pages". The dashboard has two things called reviews: a ticket's review records (`reviews/final-1.md`, shown by `timeline` and `peek ticket`) and `ask --kind review` questions (an agent-drawn page pinned by hash, `devteam.mjs:2743-3243`). Review questions pin a page to a commit and read it from home (`gitBlob`, `commitReachable`, `/review/<qid>/`); nothing in the spec gives a review question a repo. **Plan:** ticket review records route through `repoOfTicket` everywhere; `ask --kind review` for a ticket in another repo is refused with a clear message (a later change can add a `repo` to the review object).
4. **How a link's checkout identity is read.** `git remote get-url origin` expands `url.<base>.insteadOf`, so a mirror can look like the remote. **Plan:** identity is `git config --get remote.origin.url` (PR 1 already reads it that way), compared by `remoteKey`.
5. **The cross-repo story rule.** §6.2 says "`validate --strict` errors on a story whose integration ticket would need two repos; it must be split per repo, with the end-to-end check in the ticket that lands last", without a mechanical test. **Plan:** under `--strict`, a story served by tickets in two or more repos errors unless one ticket serving it depends (transitively) on every other ticket serving it (that ticket carries the end-to-end check and lands last).
6. **`init --github --repo` and "home read-only beside it".** `actions/checkout` puts every path inside `$GITHUB_WORKSPACE`, so "beside" can only be a subfolder. **Plan:** home is checked out at `$GITHUB_WORKSPACE/.devteam-home`, with `DEVTEAM_HOME` set to it; `check-pr` reads commits, never that working tree, so the extra folder can't affect the check.
7. **Landing a repo link the owner approved.** "One answer approves one thing" (`cmdMerge`, `devteam.mjs:2349-2361`): an act that used the answer blocks a second use unless it is the one act of that class whose `refs` name the merge's target. **Plan:** `link add <id> --kind repo … --approved <qid>` writes the entry, logs one `governance-edit` act with `refs: ['chore-registry', 'link:<id>']`, and prints the landing commands; `merge --chore registry --approved <qid>` then lands it as the existing "landing" exception allows.
8. **Fail fast vs. the tick that reports it.** §5.1 says "`repo()` fails fast … when a link's checkout is missing", and "`link-unreachable` covers the same thing at tick time". But `metrics`, `status`, `ready`, `fleet status` and the dashboard read every ticket's and session's facts (`deriveStatus`, `collectMetrics`; `notSchedulable` from `devteam.mjs:1749` and `4982`; `sessionOf` from `1647`, `1671`, `1700`, `1710`, `6007`, `6216`), so a failing `repo()` there would kill the very `observe-metrics` run that raises `link-unreachable`. **Plan:** two routers. Views route by *name*: `repoOfTicketLink(t)` and `repoReadable(name)` (Task 3), `factsRepo(id)` (null when unreadable, Task 5a), `sessionOf` carrying `repoName` with the object behind a getter (Task 6b), `notSchedulable` returning `'repo unreachable'` (Task 4), and `fleet status` turning an unreadable repo into a "clone X at path" blocker (Task 10). Acts on one ticket or repo (`worker`, `merge`, `check-ticket`, `check-pr`, `review-worktree`, `approve-plan`, `components check --repo`, `link`, `init --repo`) route by *object* (`repoOfTicket`, `repo`) and fail fast. A lint test (Task 9) keeps the view functions off the object routers.

## File structure

| File | Change | Responsibility |
|---|---|---|
| `docs/devteam/scripts/devteam.mjs` | modify | home resolution, `repo()`, routing, worktrees, merge, forge, fleet, releases, planning rules, init |
| `docs/devteam/schema/log.schema.json` | modify | `gate.repo`, `act.repo` |
| `docs/devteam/dashboard/index.html` | modify | `fileHref` and `openFile` pass `repo` |
| `README.md`, `docs/devteam/governance/quality.md`, `docs/devteam/process/{planning,supervisor,worker}.md` | modify | docs |
| `test/kit.test.mjs` | modify | `multiFixture` and the sibling tests |

---

### Task 1: The sibling fixture, and G1 still holding

**Files:**
- Modify: `test/kit.test.mjs` (add `multiFixture` after PR 1's `monoFixture`)

**Interfaces:**
- Produces: `multiFixture(name, { consoleForge = 'git' } = {})` → PR 1's `monoFixture` result plus `{ consoleOrigin, console, companionOrigin, companion, kitDT, runIn(cwd, args, role, extraEnv), okIn(...) }`. Home is `base/old`; the siblings are checked out at `base/console` and `base/companion`, so the default `../<id>` path finds them. Console's main branch is `trunk` (for M7).

- [ ] **Step 1: Write the fixture and a smoke test**

```js
// Three repos: home (the kit, project/, its log) and two siblings, each a bare remote plus a
// checkout laid out where path says (../<id>), forge git so no GitHub is needed.
function multiFixture(name) {
  const F = monoFixture(name);
  const { base, g, old } = F;
  const sibling = (id, branch, files) => {
    const bare = path.join(base, `${id}.git`);
    const co = path.join(base, id);
    g(['init', '-q', '--bare', '-b', branch, bare], base);
    fs.mkdirSync(co);
    g(['init', '-q', '-b', branch], co);
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) g(['config', k, v], co);
    g(['remote', 'add', 'origin', bare], co);
    for (const [f, text] of Object.entries(files)) write(path.join(co, f), text);
    g(['add', '-A'], co);
    g(['commit', '-qm', 'init'], co);
    g(['push', '-q', 'origin', branch], co);
    g(['fetch', '-q', 'origin'], co);
    return { bare, co };
  };
  const c = sibling('console', 'trunk', { 'src/main.js': 'console\n', 'package.json': '{}\n', '.gitignore': 'node_modules/\n' });
  const p = sibling('companion', 'main', { 'app/index.js': 'companion\n', 'README.md': 'c\n' });
  F.lines({ ...F.STD, console: { link: 'console' }, companion: { link: 'companion' } }, { links: {
    console: { kind: 'repo', title: 'Electron console', remote: c.bare, main_branch: 'trunk', gates: { test: 'test -f src/main.js' } },
    companion: { kind: 'repo', title: 'Companion app', remote: p.bare },
  } });
  // the kit is home's, run by absolute path from any checkout (a sibling worktree has no kit)
  const kitDT = path.join(old, 'docs/devteam/scripts/devteam.mjs');
  const runIn = (cwd, args, role = {}, extra = {}, input) => { const r = spawnSync(process.execPath, [kitDT, ...args], { cwd, env: { ...F.env(role), ...extra }, encoding: 'utf8', input }); return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };
  const okIn = (cwd, args, role, extra, input) => { const r = runIn(cwd, args, role, extra, input); assert.equal(r.status, 0, `${args.join(' ')}: ${r.err || r.out}`); return r.out; };
  // git prints real paths (/private/var on macOS); compare paths through this
  const real = (p) => fs.realpathSync(p);
  const ticket = (id, extra = {}) => okIn(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'chores', component: id.split('-')[0], kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['src/**'], done_when: ['its suite passes in CI'], notes: 'n', ...extra })], { DEVTEAM_ROLE: 'supervisor' });
  return { ...F, consoleOrigin: c.bare, console: c.co, companionOrigin: p.bare, companion: p.co, kitDT, runIn, okIn, ticket, real };
}

test('three repos: the fixture validates, and links shows each', () => {
  const F = multiFixture('multi-smoke');
  try {
    const l = json(F.okIn(F.old, ['links', '--json']));
    assert.deepEqual(l.links.map((x) => [x.id, x.found]), [['console', true], ['companion', true]]);
  } finally { F.done(); }
});
```

- [ ] **Step 2: Run it**

Run: `node --test --test-name-pattern 'three repos: the fixture'`
Expected: PASS: this task builds the fixture, and PR 1's `links --json` already lists repo links with `found`. (PR 1's `validate` still reports "only home holds components and tickets in this release" for the fixture; Task 4 lifts it.)

- [ ] **Step 3: Run G1 and the suite**

Run: `node --test --test-name-pattern 'G1:'` → PASS. `node --test` → `ℹ fail 0` (or only the known load flake).

- [ ] **Step 4: Commit**

```bash
git add test/kit.test.mjs
git commit -m "Test fixture: home and two sibling repos with local bare remotes, forge git"
```

---

### Task 2: Home is found from `DEVTEAM_HOME` or the script, never the cwd

**Files:**
- Modify: `devteam.mjs:155-168` (the nine constants), PR 1's `kitRel` (section 2b), `git` (`109-120`) and `gitOrDie` (`121-127`) default cwd, `gitBlob` (`2783-2791`), `realOrSelf` (`4589`), and the HEAD readers: `cmdReview` (`3176`), `currentTicketId` (`573-577`), `logWriter` (`579-586`), `onPlanBranch` (`1397`), validate's plan-branch read (`1425`), `cmdSend` (`5499`), `cmdPhase` (`5564`), `cmdGate` (`5591`), `gateAll` (`5608`), `cmdStopOk` (`5621`), `cmdHandoff` (`5871-5879`)
- Test: `test/kit.test.mjs`

**Interfaces:**
- Produces: `realPath(p)`, `commonOf(dir)`, `cwdCommon`, `homeAt` (`{ common, proj }`), `commonDir` (home's), `cwdIsHome: boolean`, `HOME_CWD` (`undefined` in a home checkout, else `mainRoot`), `cwdGit(args)`, `cwdGitOrDie(args)`; `git(args, cwd = HOME_CWD)`, `gitOrDie(args, cwd = HOME_CWD)`.

- [ ] **Step 1: Write the failing test (M6, and the `DEVTEAM_HOME` guard)**

```js
test('a worker in a sibling worktree runs home\'s kit: home\'s run directory and project (M6); a bad DEVTEAM_HOME is refused', () => {
  const F = multiFixture('m6');
  const { old, g, runIn, okIn } = F;
  try {
    const w = path.join(old, '.worktrees', 'console-01-x');
    g(['worktree', 'add', '-q', '-b', 'ticket/console-01-x', w, 'origin/trunk'], F.console);
    const W = { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'console-01-x' };
    const who = okIn(w, ['whoami'], W, { DEVTEAM_HOME: old });
    assert.match(who, new RegExp(`DEVTEAM_RUN=${fs.realpathSync(old)}/docs/devteam/run|DEVTEAM_RUN=${old}/docs/devteam/run`));
    assert.match(who, /project=.*\/old\/docs\/devteam\/project/);
    assert.match(who, /writer=console-01-x/, 'its own branch names it');
    okIn(w, ['phase', 'build', '--task', 'T1'], W, { DEVTEAM_HOME: old });
    assert.ok(fs.readFileSync(path.join(old, 'docs/devteam/run/log/console-01-x.jsonl'), 'utf8').includes('"to":"build"'), "the phase line lands in home's live log");
    assert.equal(json(okIn(old, ['log', '--type', 'phase', '--by', 'console-01-x', '--json']))[0].sha, g(['rev-parse', 'HEAD'], w), "the phase records the worktree's own head");
    assert.match(runIn(w, ['whoami'], W, { DEVTEAM_HOME: F.console }).err, /DEVTEAM_HOME=.*is not a devteam home/, 'a repo link\'s checkout is refused');
    assert.match(runIn(w, ['whoami'], W, { DEVTEAM_HOME: path.join(F.base, 'nowhere') }).err, /DEVTEAM_HOME=.*is not a devteam home/);
    // a project moved with DEVTEAM_PROJECT is still a home
    okIn(w, ['whoami'], W, { DEVTEAM_HOME: old, DEVTEAM_PROJECT: path.join(old, 'docs/devteam/project') });
    // the kit's own line holds from a sibling worktree: validate doesn't read the kit as unowned
    assert.doesNotMatch(runIn(w, ['validate'], W, { DEVTEAM_HOME: old }).out, /unowned: docs\/devteam/, "kitRel is relative to home's checkout, not the cwd's");
  } finally { F.done(); }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern 'a worker in a sibling worktree runs home'`
Expected: FAIL: `DEVTEAM_RUN` is the console checkout's `docs/devteam/run`.

- [ ] **Step 3: The constants**

Replace `devteam.mjs:155-168` with:

```js
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = git(['rev-parse', '--show-toplevel'], process.cwd()) ?? process.cwd();
const commonOf = (dir) => git(['rev-parse', '--path-format=absolute', '--git-common-dir'], dir);
// Paths compared as the filesystem has them (macOS's /var is /private/var; a symlinked checkout).
// realOrSelf (line 4589) becomes an alias of this, so there is one.
const realPath = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
// Home is the repo that holds the kit, project/ and the live log. It comes from DEVTEAM_HOME, or
// from the script that runs (the re-exec above makes that the main checkout's kit), never from the
// cwd: a worker in another repo's worktree runs home's kit by absolute path (spec §5.1). A stale
// DEVTEAM_HOME is refused, never followed, so nothing runs against the wrong live log.
const cwdCommon = commonOf(process.cwd());
// { common, proj }: home's git common dir, and its project folder when DEVTEAM_HOME named it.
const homeAt = (() => {
  const env = process.env.DEVTEAM_HOME;
  if (!env) return { common: commonOf(here) ?? cwdCommon, proj: null };
  const c = fs.existsSync(env) ? commonOf(env) : null;
  // a repo link's checkout carries project/tickets/ but never settings.md; the project folder is
  // found the way projectDir is below (--project, DEVTEAM_PROJECT, else the kit's default place)
  const proj = c ? path.resolve(flagStr('project') ?? process.env.DEVTEAM_PROJECT ?? path.join(path.dirname(c), 'docs', 'devteam', 'project')) : null;
  if (!c || !fs.existsSync(path.join(proj, 'settings.md'))) die(`DEVTEAM_HOME=${env} is not a devteam home (a checkout whose project folder has settings.md); unset it, or point it at the main checkout`);
  return { common: c, proj };
})();
const commonDir = homeAt.common;
const mainRoot = commonDir ? path.dirname(commonDir) : repoRoot;
// Whether this command runs in one of home's checkouts (its main checkout or a worktree of it).
const cwdIsHome = !!cwdCommon && !!commonDir && realPath(cwdCommon) === realPath(commonDir);
// The kit folder of the checkout you are in when it is home's (a worktree has its own copy): its
// project/ is the branch's tickets and plans (open issue 1). Elsewhere, home's main checkout's, so
// mainRoot and projectDir both follow DEVTEAM_HOME (never the running script's own place).
const devteamDir = cwdIsHome && fs.existsSync(path.join(repoRoot, 'docs', 'devteam', 'scripts', 'devteam.mjs')) ? path.join(repoRoot, 'docs', 'devteam') : path.join(mainRoot, 'docs', 'devteam');
const kitDir = path.resolve(here, '..');
const projectDir = cwdIsHome || !homeAt.proj ? path.resolve(flagStr('project') ?? process.env.DEVTEAM_PROJECT ?? path.join(devteamDir, 'project')) : homeAt.proj;
const runDir = path.resolve(process.env.DEVTEAM_RUN ?? path.join(mainRoot, 'docs', 'devteam', 'run'));
const projectRoot = cwdIsHome ? repoRoot : mainRoot;
const projectRel = path.relative(projectRoot, projectDir).split(path.sep).join('/');
const projectInRepo = !!commonDir && projectRel !== '' && !projectRel.startsWith('..') && !path.isAbsolute(projectRel);
```

PR 1's `kitRel` (section 2b) is relative to `repoRoot`; from a sibling worktree that is `../../…`, so `devteamLine()` drops the kit's line and validate reads the whole kit as unowned. It becomes relative to the same checkout `projectRel` is:

```js
const kitRel = path.relative(projectRoot, devteamDir).split(path.sep).join('/');
```

(In a home checkout `projectRoot` is `repoRoot`: G1.) `kitRel` is a module const in section 2b, after this block, so `projectRoot` is defined when it runs.

`git` is a function declaration (hoisted) but it reads `gitReadCache` and, after this task, `HOME_CWD`; both are declared before this block (`gitReadCache` at line 107; declare `HOME_CWD` with `let` right after `gitReadCache` and assign it after `cwdIsHome`): `let HOME_CWD;` at line 108 and, after the block above, `HOME_CWD = cwdIsHome || !commonDir ? undefined : mainRoot;`. `die` is a function declaration, so calling it inside the IIFE is safe.

- [ ] **Step 4: Git defaults to home; HEAD readers read their own checkout**

`git` (`devteam.mjs:109`): `function git(args, cwd = HOME_CWD) {`; `gitOrDie` (`121`): `function gitOrDie(args, cwd = HOME_CWD) {`. Add after them:

```js
// This checkout's own HEAD, branch and working tree, wherever it is: a worker in another repo's
// worktree records its own head, while every other read goes to home (HOME_CWD).
const cwdGit = (args) => git(args, process.cwd());
const cwdGitOrDie = (args) => gitOrDie(args, process.cwd());
```

In a home checkout `HOME_CWD` is `undefined`, so every existing call behaves exactly as before (G1). Then switch the HEAD readers:
- `currentTicketId` (575) and `logWriter` (583): `cwdGit(['rev-parse', '--abbrev-ref', 'HEAD'])`.
- `onPlanBranch` (1397) and validate's `pf` (1425): `cwdGit([...])`.
- `cmdSend` (5499), `cmdPhase` (5564), `cmdGate` (5591, both `rev-parse HEAD` and `status --porcelain`), `gateAll` (5608): `cwdGit([...])`.
- `cmdStopOk` (5621): `cwdGit(['log', '-1', '--format=%cI'])`.
- `cmdHandoff`: line 5871 `workLines(cwdGit(['status', '--porcelain']))`, 5872 `cwdGit(['rev-parse', '--abbrev-ref', 'HEAD'])`, 5877 `cwdGitOrDie(['commit', …])`, 5879 `cwdGitOrDie(['push', …])`.
- `cmdReview`'s branch check (3176): `cwdGit(['rev-parse', '--abbrev-ref', 'HEAD'])`: it compares the branch you are on with the branch the review was asked on.
- `realOrSelf` (4589): `const realOrSelf = realPath;`.
- `gitBlob` (2785): add `cwd: HOME_CWD` to its `execFileSync` options.
- `cmdWhoami` (6281): also print `home=${mainRoot}` inside the `#` comment line (`# writer=… home=${mainRoot} repo=…`). This adds text to `whoami`; no golden covers it, and the line is a comment.

- [ ] **Step 5: Run the test, G1, the suite**

Run: `node --test --test-name-pattern 'a worker in a sibling worktree runs home|G1:'` → PASS. `node --test` → `ℹ fail 0`: the planner, worker, chore and fleet tests are the regression for "a home checkout behaves as before".

- [ ] **Step 6: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/kit.test.mjs
git commit -m "Home comes from DEVTEAM_HOME or the running kit, never the cwd; a checkout's own HEAD is read where it is"
```

---

### Task 3: `repo(name)`: one memoized object per repo, with its own caches

**Files:**
- Modify: section 2b (after PR 1's `linkLocation`): `linkLocation` gains `--path`; add `repo`, `homeRepo`, `linkRepo`, `repoOfTicket`, `repoOfTicketId`, `cwdRepo`, `ghSpec`; section 4 (`devteam.mjs:1044-1108`): extract `findMergeSha`, `releasedInWith`, `parseMainLog`, `parseParents`; `cmdLinks` (PR 1) adds `main_ref`, `main_sha`
- Test: `test/kit.test.mjs`

**Interfaces:**
- Produces:
  - `repo(name = 'home') → R` with `R = { name, root, commonDir, remote, settings, projectRel, projectInRepo, mainRef(), resolveCommit(ref), changedFiles(base, sha), treePaths(ref), mergeTree(base, sha), git(args, cwd?), gitOrDie(args, cwd?), gh(args, opts?), mergeShaFor(id), mergedAt(id), ticketBranchRef(id), releasedIn(sha, pattern?), srcRead(ref, rel), srcList(ref, relDir), resetCaches(), devteamLine() }`
  - name routers for views: `repoOfTicketLink(t) → string` (never fails), `repoReadable(name) → boolean`
  - object routers for acts: `repoOfTicket(t) → R`, `repoOfTicketId(id) → R` (home for an unknown id; fail fast)
  - `cwdRepo() → R | null`, `committedComponents() → settings` (main's committed settings for routing, open issue 2)
  - `ghSpec(remote) → string | null` (`owner/name`, or `host/owner/name`, for `gh -R`)
  - `findMergeSha(id, { log, parents, resolveCommit, git, ref }) → sha | null`, `releasedInWith(gitFn, sha, pattern = 'v*') → tag | null`

- [ ] **Step 1: Write the failing tests (M7, M9)**

```js
test('repo(): each repo its own main and caches (M7); --path and links.local.json override path; a wrong origin is refused (M9)', () => {
  const F = multiFixture('repo-obj');
  const { old, g, runIn, okIn } = F;
  try {
    const l = json(okIn(old, ['links', '--json']));
    assert.equal(l.home.main_ref, 'origin/main');
    const con = l.links.find((x) => x.id === 'console');
    assert.equal(con.main_ref, 'origin/trunk', "console's own main branch");
    assert.equal(con.main_sha, g(['rev-parse', 'origin/trunk'], F.console));
    assert.notEqual(con.main_sha, l.home.main_sha, 'M7: no cache bleed between repos');
    // M9: run/links.local.json, then --path, override the committed path
    const elsewhere = path.join(F.base, 'console-elsewhere');
    g(['clone', '-q', F.consoleOrigin, elsewhere], F.base);
    write(path.join(old, 'docs/devteam/run/links.local.json'), JSON.stringify({ console: { path: elsewhere } }));
    assert.equal(F.real(json(okIn(old, ['links', '--json'])).links.find((x) => x.id === 'console').location), F.real(elsewhere));
    assert.match(okIn(old, ['components', 'check', '--repo', 'console', '--path', F.console]), /tracked path\(s\) at origin\/trunk: 0 unowned/, '--path wins over links.local.json');
    // a checkout of another remote is refused, with one message
    write(path.join(old, 'docs/devteam/run/links.local.json'), JSON.stringify({ console: { path: F.companion } }));
    const r = runIn(old, ['components', 'check', '--repo', 'console']);
    assert.notEqual(r.status, 0);
    assert.match(r.err, /repo console: .*companion is a checkout of .*companion\.git, not .*console\.git/);
    fs.rmSync(path.join(old, 'docs/devteam/run/links.local.json'));
  } finally { F.done(); }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern 'repo\\(\\): each repo'`
Expected: FAIL (`main_ref` undefined).

- [ ] **Step 3: Pure helpers out of section 4**

In section 4, extract the logic of `mainLog`, `mergeParents`, `mergeShaFor` and `releasedIn` into pure helpers, and keep home's functions (and their module caches, `mainRefCache`, `mainLogCache`, `mergeParentsCache`, `mergeShaCache`, `mergedAtCache`, `refCommits`) where they are, calling them:

```js
const parseMainLog = (o) => (o ? o.split('\n') : []).filter(Boolean).map((l) => { const [sha, ...r] = l.split('\t'); return { sha, subject: r.join('\t') }; });
const parseParents = (o) => (o ? o.split('\n') : []).filter(Boolean).map((l) => l.split(' '));
// The commit on main that landed a ticket, for any repo: a merge from ticket/<id>, a squash titled
// "<id>: …", or a merge whose second parent holds the branch tip and whose first does not.
function findMergeSha(id, { log, parents, resolve, gitFn, ref }) {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fromBranch = new RegExp(`from \\S*ticket/${esc}$`);
  for (const { sha, subject } of log()) if (fromBranch.test(subject) || subject.startsWith(`${id}:`)) return sha;
  if (!ref) return null;
  for (const r of [`refs/heads/ticket/${id}`, `refs/remotes/origin/ticket/${id}`]) {
    const tip = resolve(r);
    if (!tip || gitFn(['merge-base', '--is-ancestor', tip, ref]) === null) continue;
    for (const [sha, p1, p2] of parents()) if (p2 && gitFn(['merge-base', '--is-ancestor', tip, p2]) !== null && gitFn(['merge-base', '--is-ancestor', tip, p1]) === null) return sha;
  }
  return null;
}
// The first non-candidate tag matching pattern (default today's v*) that contains sha.
const releasedInWith = (gitFn, sha, pattern = 'v*') => (gitFn(['tag', '--contains', sha, '--list', pattern, '--sort=creatordate']) ?? '').split('\n').find((t) => t && !/-rc/.test(t)) ?? null;
```

Home's `mainLog` returns `(mainLogCache = parseMainLog(o))`, `mergeParents` returns `(mergeParentsCache = parseParents(o))`, `mergeShaFor` becomes `homeMergeShaFor(id)` with body `if (mergeShaCache.has(id)) return mergeShaCache.get(id); const v = findMergeSha(id, { log: mainLog, parents: mergeParents, resolve: resolveCommit, gitFn: git, ref: mainRef() }); mergeShaCache.set(id, v); return v;`, `mergedAt` becomes `homeMergedAt`, `ticketBranchRef` becomes `homeTicketBranchRef`, `releasedIn` becomes `homeReleasedIn = (sha, pattern) => releasedInWith(git, sha, pattern)`. The module-level names are re-bound in Task 5a to route by ticket; until then add:

```js
const mergeShaFor = (id) => homeMergeShaFor(id);
const mergedAt = (id) => homeMergedAt(id);
const ticketBranchRef = (id) => homeTicketBranchRef(id);
const releasedIn = (sha, opts = {}) => homeReleasedIn(sha, opts.pattern);
```

These are `const`s used only at runtime, after the module loads.

- [ ] **Step 4: `repo()`**

In section 2b, `linkLocation(id)` gains the command's override first:

```js
  // --path <dir> on a command about this repo (--repo <id>): the checkout CI or a one-off run uses
  if (flagStr('path') && flagStr('repo') === id) return path.resolve(flagStr('path'));
```

Then add:

```js
// The repo a GitHub CLI call names (-R): owner/name, or host/owner/name on GitHub Enterprise;
// null for a remote gh can't name (a path, a non-GitHub host), where gh then runs in the checkout.
const ghSpec = (remote) => {
  const k = remoteKey(remote ?? '');
  if (/^[\w.-]+\/[\w.-]+$/.test(k)) return k;
  const m = /^https:\/\/([^/]+)\/([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(String(remote ?? ''));
  return m ? `${m[1]}/${m[2]}` : null;
};
// One object per repo, made once (spec §5.1). Home's is the module's own helpers, so a single-repo
// project runs exactly today's code; a link's binds git and gh to its checkout and keeps its own caches.
const repoMemo = new Map();
function repo(name = 'home') {
  if (!repoMemo.has(name)) repoMemo.set(name, name === 'home' ? homeRepo() : linkRepo(name));
  return repoMemo.get(name);
}
// Home's object is PR 1's homeFacts (name, the three tree reads, mainRef, git, devteamLine,
// settings) plus the rest, so every coverage helper that defaulted to homeFacts gets the same
// answers from repo('home').
function homeRepo() {
  return Object.assign(Object.create(homeFacts), {
    root: mainRoot, commonDir, projectRel, projectInRepo,
    get remote() { return git(['config', '--get', 'remote.origin.url']); },
    resolveCommit,
    gitOrDie: (args, cwd) => gitOrDie(args, cwd),
    gh: (args, opts = {}) => { const spec = ghSpec(git(['config', '--get', 'remote.origin.url'])); return sh('gh', [...args, ...(spec ? ['-R', spec] : [])], opts); },
    mergeShaFor: homeMergeShaFor, mergedAt: homeMergedAt, ticketBranchRef: homeTicketBranchRef, releasedIn: homeReleasedIn,
    srcRead: (ref, rel) => srcRead({ ref }, rel), srcList: (ref, relDir) => srcList({ ref }, relDir),
    resetCaches: () => { mainRefCache = undefined; mainLogCache = undefined; mergeParentsCache = undefined; mergeShaCache.clear(); mergedAtCache.clear(); },
  });
}
function linkRepo(id) {
  const s = loadSettings();
  const l = s.links?.[id];
  if (!l || !LINK_KINDS[l.kind]?.hostsComponents) die(`no repo link "${id}" in settings links (devteam.mjs links)`);
  const at = linkLocation(id);
  if (!fs.existsSync(at)) die(`repo ${id}: no checkout at ${at}; clone ${l.remote} there, set its path, or name this machine's in run/links.local.json`);
  const origin = git(['config', '--get', 'remote.origin.url'], at);
  if (!origin || remoteKey(origin) !== remoteKey(l.remote)) die(`repo ${id}: ${at} is a checkout of ${origin ?? 'nothing'}, not ${l.remote}`);
  const common = commonOf(at);
  const root = path.dirname(common);
  const settings = LINK_KINDS[l.kind].effectiveSettings(l, s);
  const rel = settings.project;
  const g = (args, cwd = root) => git(args, cwd);
  const c = { mainRef: undefined, log: null, parents: null, mergeSha: new Map(), mergedAt: new Map() };
  const resolve = (ref) => g(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  const mainRefR = () => { if (c.mainRef === undefined) c.mainRef = [`origin/${settings.main_branch}`, settings.main_branch].find((r) => resolve(r)) ?? null; return c.mainRef; };
  const log = () => (c.log ??= parseMainLog(mainRefR() ? g(['log', mainRefR(), '--first-parent', '--format=%H%x09%s']) : null));
  const parents = () => (c.parents ??= parseParents(mainRefR() ? g(['log', mainRefR(), '--merges', '--first-parent', '-n', '500', '--format=%H %P']) : null));
  const R = {
    name: id, root, commonDir: common, remote: l.remote, settings, projectRel: rel, projectInRepo: true,
    mainRef: mainRefR, resolveCommit: resolve,
    // the same three tree reads home has (PR 1's gitFacts), bound to this checkout
    ...gitFacts(g),
    git: g, gitOrDie: (args, cwd = root) => gitOrDie(args, cwd),
    gh: (args, opts = {}) => { const spec = ghSpec(l.remote); return sh('gh', [...args, ...(spec ? ['-R', spec] : [])], { cwd: root, ...opts }); },
    mergeShaFor: (tid) => { if (!c.mergeSha.has(tid)) c.mergeSha.set(tid, findMergeSha(tid, { log, parents, resolve, gitFn: g, ref: mainRefR() })); return c.mergeSha.get(tid); },
    mergedAt: (tid) => { if (!c.mergedAt.has(tid)) { const sha = R.mergeShaFor(tid); const t = sha ? Date.parse(g(['show', '-s', '--format=%cI', sha]) ?? '') : NaN; c.mergedAt.set(tid, Number.isNaN(t) ? null : t); } return c.mergedAt.get(tid); },
    ticketBranchRef: (tid) => [`refs/heads/ticket/${tid}`, `refs/remotes/origin/ticket/${tid}`].find((r) => resolve(r)) ?? null,
    releasedIn: (sha, pattern) => releasedInWith(g, sha, pattern),
    srcRead: (ref, relPath) => g(['show', `${ref ?? mainRefR()}:${rel}/${relPath}`]),
    srcList: (ref, relDir) => (g(['ls-tree', '--name-only', `${ref ?? mainRefR()}:${rel}/${relDir}`]) ?? '').split('\n').filter(Boolean),
    resetCaches: () => { c.mainRef = undefined; c.log = null; c.parents = null; c.mergeSha.clear(); c.mergedAt.clear(); },
    // in another repo the kit's line is only its project folder, where tickets keep their records
    devteamLine: () => [`${rel}/**`],
  };
  return R;
}
// The components that route a ticket to its repo: main's, committed (open issue 2).
const committedComponents = () => memo('committedComponents', () => (mainRef() ? settingsAt(mainRef(), { orNull: true }) : null) ?? loadSettings());
// Two routers (open issue 8). By name, for views: never touches a checkout, never fails.
const repoOfTicketLink = (t) => componentLink(t.component, committedComponents());
// Whether a repo can be read on this machine, without failing: home always; a link when its
// checkout is where it says and of its remote (PR 1's reachable, memoized per process).
const repoReadable = (name) => { if (name === 'home') return true; const l = loadSettings().links?.[name]; return !!LINK_KINDS[l?.kind]?.hostsComponents && !LINK_KINDS[l.kind].reachable(l, name); };
// By object, for acts on one ticket: fails fast with one message when the checkout is wrong.
const repoOfTicket = (t) => repo(repoOfTicketLink(t));
const repoOfTicketId = (id) => { const t = tickets().get(id); return t ? repoOfTicket(t) : repo('home'); };
// The repo of the checkout this command runs in (home, or a repo link's), by its git common dir.
function cwdRepo() {
  if (cwdIsHome) return repo('home');
  if (!cwdCommon) return null;
  for (const [id, l] of Object.entries(loadSettings().links ?? {})) {
    if (!LINK_KINDS[l.kind]?.hostsComponents || !repoReadable(id)) continue;
    if (realPath(commonOf(linkLocation(id)) ?? '') === realPath(cwdCommon)) return repo(id);
  }
  return null;
}
```

`linkRepo` dies on a missing or wrong checkout; `cwdRepo` must not, so it asks `repoReadable` first and calls `repo` only for a match. `homeRepo` inherits from `homeFacts` (`Object.create`), so its getters (`settings`) stay live.

- [ ] **Step 5: `--repo` on `components check`, and `links --json` main refs**

`cmdComponents` (PR 1): `const R = repo(flagStr('repo') ?? 'home');`, read `R.mainRef()`, `R.resolveCommit(ref)`; settings stay home's committed settings (`settingsAt` of home's main, or of `--ref` when `--repo` is absent); coverage runs `coverage(R.treePaths(sha), componentsOn(s, R.name), R.devteamLine())`. Generalize PR 1's `coverageAt(ref, s)` to `coverageAt(ref, s, R = repo('home'))` with the memo key including `R.name`. `cmdLinks` adds `main_ref: R.mainRef()` and `main_sha: R.resolveCommit(R.mainRef())` to home and to each link for which `repoReadable(id)` holds (`die` exits, so a view never calls `repo(id)` without asking first).

- [ ] **Step 6: Run it, G1, the suite**

Run: `node --test --test-name-pattern 'repo\\(\\): each repo|G1:'` → PASS; `node --test` → `ℹ fail 0`.

- [ ] **Step 7: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/kit.test.mjs
git commit -m "repo(): one object per repo with its own main and caches; --path and links.local.json; a wrong origin is refused"
```

---

### Task 4: Components and coverage on every repo link

**Files:**
- Modify: PR 1's `registryProblems` (drop "only home holds components and tickets in this release"); validate's coverage block (every repo link); `notSchedulable` (`devteam.mjs:1736-1741`), `cmdReady` (`1764`), `makeSession` refusal, the `unowned-files` finding (per repo); `componentsOn` callers that assumed `'home'`
- Test: `test/kit.test.mjs`

**Interfaces:**
- Consumes: PR 1's `coverageGap(name, R)`, `coverageAt(ref, s, R)`, `coverageReport(cov, s, R)`, `settingsInForce(base, sha, R)`; Task 3's `repoOfTicketLink`, `repoReadable`.
- Produces: `notSchedulable(t)` may return `'repo unreachable'`; `unowned-files` findings with subject `<link id>`; validate errors `components (<repo>): …` and `<repo>: <path> is in <projectRel>, which holds only tickets/`.

- [ ] **Step 1: Write the failing test**

```js
test('lines on sibling repos: coverage per repo, project folder holds only tickets/, unowned-files names the repo', () => {
  const F = multiFixture('lines-per-repo');
  const { old, g, runIn, okIn, ticket } = F;
  try {
    assert.doesNotMatch(runIn(old, ['validate']).out, /only home holds/, 'components may live on repo links now');
    ticket('console-01-a');
    assert.match(okIn(old, ['ready']), /build +console-01-a/);
    // a file in console's project folder outside tickets/, pushed straight to its main
    write(path.join(F.console, 'docs/devteam/project/settings.md'), 'stray\n');
    g(['add', '-A'], F.console); g(['commit', '-qm', 'stray'], F.console); g(['push', '-q', 'origin', 'trunk'], F.console);
    assert.match(runIn(old, ['validate']).out, /console: docs\/devteam\/project\/settings\.md is in docs\/devteam\/project, which holds only tickets\//);
    // narrow console's line so a file falls outside it
    F.lines({ ...F.STD, console: { link: 'console', owns: ['src/**', 'package.json', '.gitignore'] }, companion: { link: 'companion' } });
    write(path.join(F.console, 'docs/x.md'), 'x\n');
    g(['add', '-A'], F.console); g(['commit', '-qm', 'x'], F.console); g(['push', '-q', 'origin', 'trunk'], F.console);
    const f = json(okIn(old, ['metrics', '--json'])).findings.find((x) => x.kind === 'unowned-files');
    assert.equal(f.subject, 'console');
    assert.deepEqual(json(okIn(old, ['ready', '--json'])).waiting, [{ id: 'console-01-a', why: 'unowned files' }]);
    assert.match(runIn(old, ['components', 'check', '--repo', 'console']).out, /unowned: docs\/ \(1\): docs\/x\.md/);
    // no console checkout on this machine: ready and metrics carry on; the ticket waits, and says why
    write(path.join(old, 'docs/devteam/run/links.local.json'), JSON.stringify({ console: { path: path.join(F.base, 'not-cloned') } }));
    assert.deepEqual(json(okIn(old, ['ready', '--json'])).waiting, [{ id: 'console-01-a', why: 'repo unreachable' }]);
    assert.ok(json(okIn(old, ['metrics', '--json'])).findings.some((x) => x.kind === 'link-unreachable' && x.subject === 'console'));
    fs.rmSync(path.join(old, 'docs/devteam/run/links.local.json'));
  } finally { F.done(); }
});
```

(`docs/devteam/project/settings.md` in console lies inside console's `devteam` line, its project folder, so it is a project-folder error, never "unowned".)

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern 'lines on sibling repos'`
Expected: FAIL (`only home holds` is still reported).

- [ ] **Step 3: Lift the home-only rule and loop over repos**

- In `registryProblems`, delete the `else errors.push(`${at}: link "${link}": only home holds components and tickets in this release`);` branch.
- Validate's coverage block: for each repo name in `['home', ...links that host components and have components on main]`: if `!repoReadable(name)`, push a warning `components (<name>): not checked, <LINK_KINDS[kind].reachable(...)>` and skip (`link-unreachable` covers it at tick time); else `const R = repo(name)`, `const sIn = settingsInForce(base, head, R)`, `coverageAt(R.mainRef(), sIn, R)` and `coverageReport(gaps, sIn, R)`; prefix each line with `components (${name}): ` for non-home repos and keep `components: ` for home (G1). Then, for non-home repos only: `R.treePaths(R.mainRef()).filter((p) => p.startsWith(`${R.projectRel}/`) && !p.startsWith(`${R.projectRel}/tickets/`))` → `errors.push(`${name}: ${p} is in ${R.projectRel}, which holds only tickets/ (settings, the log and designs live in home)`)`.
- PR 1's `coverageGap(name = 'home', R = homeFacts)` already takes the repo; callers pass `(name, repo(name))` only after `repoReadable(name)`, else they treat the gap as 0 (nothing can be read there; `link-unreachable` says why, open issue 8). The `unowned-files` loop and validate's per-repo loop skip such a repo the same way.
- `notSchedulable(t)` (a view: called from `cmdReady`, `devteam.mjs:1749`, and `collectMetrics`, `4982`) uses the name router only:

```js
  const name = repoOfTicketLink(t);
  // a ticket in a repo this machine can't read waits; link-unreachable says how to fix it
  if (!repoReadable(name)) return 'repo unreachable';
  if (coverageGap(name, repo(name))) return 'unowned files';
```

  and `cmdReady`'s waiting text gains `w.why === 'repo unreachable' ? 'its repo has no checkout here, or the wrong one (links; link-unreachable)' : …`.
- `makeSession` refusal (an act), replacing PR 1's one-liner after line 5676:

```js
  // A repo with files no line owns starts no new ticket (§4, point 3); a ticket already started carries on.
  if (role === 'worker' && !lastPhaseOf(id)) {
    const R = repoOfTicket(tickets().get(id)); // fails fast on a missing or wrong checkout
    if (coverageGap(R.name, R)) die(`${R.name}'s main has ${coverageGap(R.name, R)} path(s) no component line owns, or more than one does: no new ticket starts there until a chore PR extends a line (devteam.mjs components check${R.name === 'home' ? '' : ` --repo ${R.name}`})`);
  }
```

  (For home the message is PR 1's text.)
- The `unowned-files` finding: one per repo with a gap, subject the repo name (`home` as in PR 1).
- PR 1's validate containment (`prefixOwners(entry, comps0, dev0)`): `comps0`/`dev0` become per ticket: `componentsOn(S0, componentLink(t.component, S0))` and that repo's `devteamLine()` (home's `devteamLine()`, or `[`${settings.project}/**`]` from the link's effective settings; don't call `repo()` here, a missing checkout must not stop validate).

- [ ] **Step 4: Run it, G1, the suite**

Run: `node --test --test-name-pattern 'lines on sibling repos|G1:'` → PASS; `node --test` → `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/kit.test.mjs
git commit -m "Component lines on every repo link: coverage per repo, a project folder of tickets only, unowned-files per repo"
```

---

### Task 5a: Ticket facts and records at the head, from the ticket's repo

**Files:**
- Modify: the Task 3 router consts (`mergeShaFor`, `mergedAt`, `ticketBranchRef`, `releasedIn`); `srcRead`/`srcList` (`devteam.mjs:1100-1108`); `ticketReviews` (`1851`); `verdictHolds` (`1928-1969`); `checkTicket` (`1974-2034`, including PR 1's footprint block); `cmdCheckTicket` (`2035-2047`)
- Test: `test/kit.test.mjs`

**Interfaces:**
- Consumes: Task 3's `repoOfTicketLink`, `repoReadable`, `repoOfTicketId`, `repo`; PR 1's `settingsInForce(base, sha, R)`, `componentsOn`, `ownersOf`.
- Produces: `factsRepo(id) → R | null` (the name router's object, null when unreadable: for views); `src` objects may carry `repo` (`{ ref, repo }`); `verdictHolds(v, head, dir, R = repo('home'))`; `checkTicket(id, …)` reads everything from `repoOfTicketId(id)` (fails fast); module-level `mergeShaFor(id)`, `mergedAt(id)`, `ticketBranchRef(id)` route through `factsRepo`; `releasedIn(sha, { repo, pattern })`.

- [ ] **Step 1: Write the failing tests**

```js
test('a sibling ticket\'s records are read from its repo at the exact head', () => {
  const F = multiFixture('sibling-records');
  const { old, g, okIn, runIn, ticket } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const body = path.join(F.base, 'body.md');
  write(body, '## One-way doors\n\nNone.\n');
  try {
    ticket('console-01-a');
    const w = path.join(old, '.worktrees', 'console-01-a');
    g(['worktree', 'add', '-q', '-b', 'ticket/console-01-a', w, 'origin/trunk'], F.console);
    const tdir = path.join(w, 'docs/devteam/project/tickets/console-01-a');
    write(path.join(tdir, 'spec.md'), '# spec\n');
    write(path.join(tdir, 'plan.md'), '# plan\n\n## TL;DR\n\n- one change\n');
    write(path.join(tdir, 'verification.md'), '| Done-when | Command | Result |\n|---|---|---|\n| suite | npm t | pass |\n');
    write(path.join(w, 'src/main.js'), 'changed\n');
    g(['add', '-A'], w); g(['commit', '-qm', 'console-01-a: work'], w);
    const h1 = g(['rev-parse', 'HEAD'], w);
    write(path.join(tdir, 'reviews/final-1.md'), review('reviewer-b', h1));
    g(['add', '-A'], w); g(['commit', '-qm', 'review'], w);
    const head = g(['rev-parse', 'HEAD'], w);
    okIn(old, ['act', '--class', 'approve-spec', '--refs', 'console-01-a', '--', 'ok'], SUP);
    okIn(old, ['act', '--class', 'approve-plan', '--refs', 'console-01-a', '--', 'ok'], SUP);
    const r = runIn(old, ['check-ticket', 'console-01-a', '--sha', head, '--title', 'console-01-a: work', '--body-file', body]);
    assert.doesNotMatch(r.out, /spec\.md missing|plan\.md missing|verification\.md missing|no final review/, 'records come from console at the head');
    // from the worktree itself, its own HEAD
    assert.match(runIn(w, ['check-ticket', 'console-01-a', '--title', 'console-01-a: work', '--body-file', body], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'console-01-a' }).out, new RegExp(head.slice(0, 12)));
    // a later code commit voids the verdict, in that repo's history
    write(path.join(w, 'src/main.js'), 'changed again\n');
    g(['commit', '-qam', 'more'], w);
    assert.match(runIn(old, ['check-ticket', 'console-01-a', '--sha', g(['rev-parse', 'HEAD'], w), '--title', 'console-01-a: work', '--body-file', body]).out, /does not hold/);
    // a machine without the console checkout: acting on the ticket fails fast (views: Task 5b)
    write(path.join(old, 'docs/devteam/run/links.local.json'), JSON.stringify({ console: { path: path.join(F.base, 'not-cloned') } }));
    assert.match(runIn(old, ['check-ticket', 'console-01-a', '--sha', head]).err, /repo console: no checkout at .*not-cloned/);
    fs.rmSync(path.join(old, 'docs/devteam/run/links.local.json'));
  } finally { F.done(); }
});

test('B1: a sibling ticket\'s footprint is judged by home\'s committed lines', () => {
  const F = multiFixture('sibling-footprint');
  const { old, g, runIn, ticket } = F;
  const body = path.join(F.base, 'body.md');
  write(body, '## One-way doors\n\nNone.\n');
  try {
    // two lines in console: its UI and its build
    F.lines({ ...F.STD, 'console-ui': { link: 'console', owns: ['src/**'] }, 'console-build': { link: 'console', owns: ['package.json', '.gitignore'] }, companion: { link: 'companion' } });
    ticket('console-ui-01-a', { component: 'console-ui', touches: ['src/**', 'package.json'] });
    const w = path.join(old, '.worktrees', 'console-ui-01-a');
    g(['worktree', 'add', '-q', '-b', 'ticket/console-ui-01-a', w, 'origin/trunk'], F.console);
    write(path.join(w, 'package.json'), '{"name":"edited by the ui"}\n');
    g(['commit', '-qam', 'console-ui-01-a: build edit'], w);
    g(['push', '-q', 'origin', 'ticket/console-ui-01-a'], w);
    const r = runIn(old, ['check-ticket', 'console-ui-01-a', '--sha', g(['rev-parse', 'HEAD'], w), '--title', 'console-ui-01-a: x', '--body-file', body]);
    assert.match(r.out, /changes files outside the line of console-ui: package\.json/, "home's lines judge the sibling's diff (not the defaults)");
  } finally { F.done(); }
});
```

(`ticket()` derives the component from the id's first segment; pass `component` explicitly, as above, for a hyphenated component. The same ticket is refused by `merge` in Task 8's test.)

- [ ] **Step 2: Run them to see them fail**

Run: `node --test --test-name-pattern "a sibling ticket's records|B1: a sibling ticket's footprint"`
Expected: FAIL: the records are read from home (`spec.md missing at this head`), and the footprint passes because `settingsInForce` diffed `settings.md` in console and fell through.

- [ ] **Step 3: The routers**

Replace the Task 3 router consts with:

```js
// A ticket's git facts come from its own repo (spec §5.1). Views ask by name, through factsRepo,
// which is null for a repo this machine can't read: its tickets read as unmerged and branchless
// while link-unreachable says why (open issue 8). Home's methods are today's functions.
const factsRepo = (id) => { const t = tickets().get(id); const name = t ? repoOfTicketLink(t) : 'home'; return repoReadable(name) ? repo(name) : null; };
const mergeShaFor = (id) => factsRepo(id)?.mergeShaFor(id) ?? null;
const mergedAt = (id) => factsRepo(id)?.mergedAt(id) ?? null;
const ticketBranchRef = (id) => factsRepo(id)?.ticketBranchRef(id) ?? null;
// A release of the ticket's repo and component (§5.5): its component's tag pattern, else v*.
const releasedIn = (sha, { repo: R = repo('home'), pattern } = {}) => R.releasedIn(sha, pattern);
```

For home tickets `factsRepo(id)` is `repo('home')`, whose methods are the unchanged home functions (G1). `settledByLanding` (5520) passes a writer name that is a ticket id; the router handles it.

- [ ] **Step 4: Records**

`srcRead`/`srcList` (1100-1108):

```js
function srcRead(src, rel) {
  if (src.repo && src.repo.name !== 'home') return src.repo.srcRead(src.ref ?? null, rel);
  if (src.ref && projectInRepo) return git(['show', `${src.ref}:${projectRel}/${rel}`]);
  return readText(path.join(projectDir, rel));
}
function srcList(src, relDir) {
  if (src.repo && src.repo.name !== 'home') return src.repo.srcList(src.ref ?? null, relDir);
  if (src.ref && projectInRepo) return (git(['ls-tree', '--name-only', `${src.ref}:${projectRel}/${relDir}`]) ?? '').split('\n').filter(Boolean);
  const p = path.join(projectDir, relDir);
  return fs.existsSync(p) ? fs.readdirSync(p) : [];
}
```

`homeRepo().srcRead` (Task 3) calls `srcRead({ ref }, rel)` without `repo`, so it stays home's.

`ticketBranchRef`'s callers then read reviews through `ticketReviews` (1851):

```js
const ticketReviews = (id, src) => { const R = src.repo ?? factsRepo(id); return R ? reviewRecordsIn({ ...src, repo: R }, `tickets/${id}/reviews`) : []; };
```

A sibling's `WORKTREE` (`{ ref: null }`) then reads its repo's main (a merged ticket's records are on R's main, not in home's working tree). `reviewStats` (1866), `reviewPasses` (1881), `retroDraft` (4457) and `notSchedulable` (1739) already pass `{ ref: b }` or `WORKTREE`; nothing else changes there.

`verdictHolds(v, head, dir, R = repo('home'))`: replace each `git(` with `R.git(` and `mainRef()` with `R.mainRef()` inside it (lines 1931-1967). For home, `R.git` is `git` and `R.mainRef` is `mainRef` (G1).

- [ ] **Step 5: `checkTicket` in the ticket's repo**

At the top of `checkTicket` (1974): `const R = repoOfTicketId(id);` (an act: fails fast). Then:

```js
  if (R.commonDir) {
    // --sha, else this checkout's HEAD when it is a checkout of R, else R's main checkout's
    sha = shaArg ? R.resolveCommit(shaArg) : cwdRepo() === R ? cwdGit(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']) : R.resolveCommit('HEAD');
    if (!sha) return [`commit ${shaArg} not found locally (fetch it first)`];
    if (R.projectInRepo) src = { ref: sha, repo: R };
  }
```

(home: `R.commonDir` is `commonDir`, `R.resolveCommit` is today's `resolveCommit`, and `cwdRepo()` is `repo('home')` in a home checkout, whose `cwdGit` HEAD is the same HEAD `resolveCommit('HEAD')` read before.)

- `const reviewsDir = R.projectInRepo ? `${R.projectRel}/tickets/${id}/reviews/` : null;` and `const holdsAt = (v) => (sha ? verdictHolds(v, sha, reviewsDir, R) : false);`
- `const base = R.mainRef() && sha ? R.git(['merge-base', R.mainRef(), sha]) : null;`; the "cannot resolve main branch" message names `R.settings.main_branch`.
- `const changed = R.changedFiles(base, sha);` and `const own = R.projectInRepo ? `${R.projectRel}/tickets/${id}/` : null;`
- PR 1's footprint block passes the repo, so another repo's PR is judged by home main's committed lines (B1):

```js
    const s = settingsInForce(base, sha, R);
    if (linesDeclared(s)) {
      const comps = componentsOn(s, R.name);
      const names = [t.component, ...(t.touches_components ?? [])];
      const dev = R.devteamLine();
      const inLine = (f) => { const o = ownersOf(f, comps, dev); return o[0] !== 'devteam' && o.some((n) => names.includes(n)); };
      const off = changed.filter((f) => !mineOwn(f) && !outside.includes(f) && !inLine(f));
      if (off.length) fails.push(`${OFF_LINE} ${names.join(', ')}: ${off.slice(0, 10).join(', ')}${off.length > 10 ? ` (+${off.length - 10} more)` : ''}`);
    }
```

`cmdCheckTicket` (2041-2046): `const R = repoOfTicketId(id);`; `--pr` uses `R.gh(['pr', 'view', flagStr('pr'), '--json', 'title,body,headRefOid'])`; the report line resolves the sha the way `checkTicket` does (`shaArg ? R.resolveCommit(sha) : cwdRepo() === R ? cwdGit([...]) : R.resolveCommit('HEAD')`); extract that expression into `headIn(R, shaArg)` and use it in both places.

- [ ] **Step 6: Run them, G1, the suite**

Run: `node --test --test-name-pattern "a sibling ticket's records|B1: a sibling|G1:"` → PASS; `node --test` → `ℹ fail 0`.

- [ ] **Step 7: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/kit.test.mjs
git commit -m "A ticket's merge, branch and records come from its own repo at the exact head; its footprint is judged by home's committed lines"
```

---

### Task 5b: Views of sibling tickets: status, releases, approve-plan, timeline, progress

**Files:**
- Modify: `deriveStatus` (`devteam.mjs:1369-1395`); `cmdAct`'s approve-plan read (`3736-3743`); `timelineView` (`5166-5180`); `collectProgress` (`5095`)
- Test: `test/kit.test.mjs`

**Interfaces:**
- Consumes: Task 5a's `factsRepo`, `releasedIn`, `ticketReviews`; Task 3's `repoOfTicket`.
- Produces: `releaseOf(t) → { repo: R | null, pattern?: string }`; `timelineView(id).files[*].repo` for a ticket outside home.

- [ ] **Step 1: Write the failing test**

```js
test('views of a sibling ticket: status, approve-plan, timeline; a missing checkout never stops a view', () => {
  const F = multiFixture('sibling-views');
  const { old, g, okIn, runIn, ticket } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    ticket('console-01-a');
    const w = path.join(old, '.worktrees', 'console-01-a');
    g(['worktree', 'add', '-q', '-b', 'ticket/console-01-a', w, 'origin/trunk'], F.console);
    const tdir = path.join(w, 'docs/devteam/project/tickets/console-01-a');
    write(path.join(tdir, 'spec.md'), '# spec\n');
    write(path.join(tdir, 'plan.md'), '# plan\n\n## TL;DR\n\n- one change\n');
    g(['add', '-A'], w); g(['commit', '-qm', 'console-01-a: plan'], w);
    okIn(old, ['act', '--class', 'approve-spec', '--refs', 'console-01-a', '--', 'ok'], SUP);
    assert.match(okIn(old, ['act', '--class', 'approve-plan', '--refs', 'console-01-a', '--', 'ok'], SUP), /^a-/, "approve-plan reads the plan from the ticket's repo");
    okIn(w, ['phase', 'build'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'console-01-a' });
    assert.match(okIn(old, ['status']), /building +console-01-a/);
    const spec = json(okIn(old, ['timeline', 'console-01-a', '--json'])).files.find((f) => f.title === 'spec');
    assert.deepEqual([spec.repo, spec.ref], ['console', 'refs/heads/ticket/console-01-a']);
    // no console checkout here: status, metrics and the dashboard's data carry on (open issue 8)
    write(path.join(old, 'docs/devteam/run/links.local.json'), JSON.stringify({ console: { path: path.join(F.base, 'not-cloned') } }));
    assert.match(okIn(old, ['status']), /console-01-a/);
    assert.ok(json(okIn(old, ['metrics', '--json'])).findings.some((x) => x.kind === 'link-unreachable' && x.subject === 'console'));
    okIn(old, ['dashboard-data']);
    assert.match(runIn(old, ['act', '--class', 'approve-plan', '--refs', 'console-01-a', '--', 'again'], SUP).err, /repo console: no checkout/, 'an act fails fast');
    fs.rmSync(path.join(old, 'docs/devteam/run/links.local.json'));
  } finally { F.done(); }
});
```

(Check `spec.ref`'s exact form against `ticketBranchRef`'s return (`refs/heads/ticket/<id>`) when writing the test.)

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern 'views of a sibling ticket'`
Expected: FAIL at `approve-plan` (`no plan.md for console-01-a`: read from home).

- [ ] **Step 3: The views**

`deriveStatus` (1381): `else if (mergeSha) stage = releasedIn(mergeSha, releaseOf(t)) ? 'released' : 'merged';`, with

```js
// Where a ticket's release is read: its repo's tags, matching its component's pattern (§3.2, §5.5).
// mergeSha is non-null only when factsRepo found the repo; undefined lets releasedIn's default
// (home) apply rather than a null that would throw.
const releaseOf = (t) => { const c = committedComponents().components?.[t.component]; return { repo: factsRepo(t.id) ?? undefined, pattern: isObj(c?.release) ? c.release.tag : undefined }; };
```

`collectProgress` (5095): `released_in: sha ? releasedIn(sha, releaseOf(t)) : null`.

`timelineView` (5174-5178), a view:

```js
  const R = factsRepo(id);
  const branch = ticketBranchRef(id);
  const ref = branch && !mergeShaFor(id) ? branch : R?.mainRef() ?? null;
  const files = !R ? [] : ['spec.md', 'plan.md', 'verification.md'].map((f) => `${R.projectRel}/tickets/${id}/${f}`).filter((f) => ref && R.git(['cat-file', '-e', `${ref}:${f}`]) !== null).map((f) => ({ title: path.basename(f, '.md'), path: f, ref, ...(R.name === 'home' ? {} : { repo: R.name }) }));
```

(home: `R.projectRel` is `projectRel`, `R.git` is `git`, `R.mainRef()` is `mainRef()`; no `repo` key, so its JSON is unchanged.)

`cmdAct` approve-plan (3736-3743), an act:

```js
    const R = repoOfTicket(t);
    const ref = [`ticket/${t.id}`, `origin/ticket/${t.id}`].find((r) => R.resolveCommit(r));
    const plan = ref ? R.git(['show', `${ref}:${R.projectRel}/tickets/${t.id}/plan.md`]) : null;
```

and the goal-door branch (3743) reads `ticketReviews(t.id, { ref, repo: R })`.

- [ ] **Step 4: Run it, G1, the suite**

Run: `node --test --test-name-pattern "views of a sibling ticket|G1:"` → PASS; `node --test` → `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/kit.test.mjs
git commit -m "Views of a sibling ticket read its repo, and carry on when this machine has no checkout of it"
```

---

### Task 6a: Gate, review and seeded worktrees of the ticket's repo

**Files:**
- Modify: `gateEnv` (`devteam.mjs:2088`), `missingPins` (`2092-2107`), `pinsHint` (`2108`), `seedWorktree` (`2109-2125`), `detachedWorktree` (`2127-2133`) and the removals of detached trees (`2066`, `2394`, `2402`, `2416`), `cmdReviewWorktree` (`2139-2166`); add `worktreeRepo`
- Test: `test/kit.test.mjs`

**Interfaces:**
- Produces: `gateEnv(ticket, R = repo('home'))` (adds `DEVTEAM_HOME: mainRoot`; `DEVTEAM_MAIN: R.root`); `missingPins(root = mainRoot)`; `pinsHint(miss, root = mainRoot)`; `seedWorktree(wt, { setup = true, repo: R = repo('home') } = {})`; `detachedWorktree(sha, name, R = repo('home'))`; `worktreeRepo(wt) → R | null`.

- [ ] **Step 1: Write the failing test (M8, seeding)**

```js
test('a sibling ticket\'s review worktree: under home/.worktrees, of its repo, seeded from that repo\'s settings, and removed through it (M8)', () => {
  const F = multiFixture('sibling-review-wt');
  const { old, g, okIn, ticket } = F;
  try {
    // console's own worktree_files and worktree_setup, never home's; DEVTEAM_MAIN is console's root
    write(path.join(F.console, '.env'), 'CONSOLE=1\n');
    const links = json(okIn(old, ['settings'])).links;
    F.lines({ ...F.STD, console: { link: 'console' }, companion: { link: 'companion' } }, { links: { ...links, console: { ...links.console, worktree_files: ['.env'], worktree_setup: 'test -f "$DEVTEAM_MAIN/src/main.js" && touch .seeded-from-console' } } });
    ticket('console-01-a');
    const w = path.join(old, '.worktrees', 'console-01-a');
    g(['worktree', 'add', '-q', '-b', 'ticket/console-01-a', w, 'origin/trunk'], F.console);
    const sha = g(['rev-parse', 'HEAD'], w);
    const rw = okIn(old, ['review-worktree', 'console-01-a', sha]);
    assert.equal(path.dirname(fs.realpathSync(rw)), fs.realpathSync(path.join(old, '.worktrees')));
    assert.equal(fs.realpathSync(g(['rev-parse', '--path-format=absolute', '--git-common-dir'], rw)), fs.realpathSync(path.join(F.console, '.git')), 'a worktree of console');
    assert.equal(g(['rev-parse', 'HEAD'], rw), sha);
    assert.equal(fs.readFileSync(path.join(rw, '.env'), 'utf8'), 'CONSOLE=1\n', "console's worktree_files");
    assert.ok(fs.existsSync(path.join(rw, '.seeded-from-console')), "console's worktree_setup, with DEVTEAM_MAIN at console's root");
    okIn(old, ['review-worktree', '--remove', rw]);
    assert.ok(!fs.existsSync(rw));
    assert.doesNotMatch(g(['worktree', 'list'], F.console), /review-/, "console's git forgets it");
  } finally { F.done(); }
});
```

(`worktree_files` and `worktree_setup` on a repo link are owner settings; `F.lines` commits straight to main, standing in for an approved chore.)

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern "sibling ticket's review worktree"`
Expected: FAIL (the review worktree is a worktree of home, seeded from home).

- [ ] **Step 3: Seeding, detached trees, review trees per repo**

```js
const gateEnv = (ticket, R = repo('home')) => { const cache = path.join(runDir, 'cache'); fs.mkdirSync(cache, { recursive: true }); return { ...process.env, DEVTEAM_MAIN: R.root, DEVTEAM_HOME: mainRoot, DEVTEAM_CACHE: cache, ...(ticket ? { DEVTEAM_GATE_TICKET: ticket } : {}) }; };
```

`missingPins(root = mainRoot)`: replace `mainRoot` with `root` at lines 2093 and 2100. `pinsHint = (miss = missingPins(), root = mainRoot) => … run asdf install (or mise install) in ${root} …`.

```js
function seedWorktree(wt, { setup = true, repo: R = repo('home') } = {}) {
  const s = R.settings;
  for (const rel of s.worktree_files ?? []) {
    const from = path.join(R.root, rel);
    if (!fs.existsSync(from)) { warn(`worktree_files: ${rel} is not in ${R.name === 'home' ? 'the main checkout' : `${R.name}'s checkout (${R.root})`}`); continue; }
    fs.mkdirSync(path.dirname(path.join(wt, rel)), { recursive: true });
    fs.copyFileSync(from, path.join(wt, rel));
  }
  if (setup && s.worktree_setup) {
    try {
      execFileSync('sh', ['-c', s.worktree_setup], { cwd: wt, stdio: ['ignore', 'inherit', 'inherit'], env: gateEnv(null, R) });
    } catch {
      const hint = pinsHint(missingPins(R.root), R.root);
      die(`worktree_setup failed in ${wt}${hint ? `; ${hint}` : ''}`);
    }
  }
}
// A throwaway checkout of one commit of a repo, under home's .worktrees, removed when the process ends.
function detachedWorktree(sha, name, R = repo('home')) {
  const wt = path.join(mainRoot, '.worktrees', `tmp-${name}-${process.pid}`);
  R.gitOrDie(['worktree', 'add', '--quiet', '--detach', wt, sha], R.root);
  process.once('exit', () => { if (fs.existsSync(wt)) R.git(['worktree', 'remove', '--force', wt], R.root); });
  seedWorktree(wt, { repo: R });
  return wt;
}
// The repo a worktree belongs to, computed from git, never recorded (spec §5.2).
function worktreeRepo(wt) {
  const c = fs.existsSync(wt) ? commonOf(wt) : null;
  if (!c) return null;
  if (realPath(c) === realPath(commonDir)) return repo('home');
  for (const id of Object.keys(loadSettings().links ?? {})) if (repoReadable(id) && realPath(repo(id).commonDir) === realPath(c)) return repo(id);
  return null;
}
```

For home, `R.settings` is `loadSettings()`, `R.root` is `mainRoot`, `gateEnv(null, home)` adds only `DEVTEAM_HOME` to today's env, and `R.gitOrDie(args, R.root)` is today's `gitOrDie(args, mainRoot)` (G1). Every caller that removes a detached tree with `git(['worktree', 'remove', '--force', wt], mainRoot)` (lines 2066, 2394, 2402, 2416) takes the repo it was made in: `R.git(['worktree', 'remove', '--force', wt], R.root)`.

`cmdReviewWorktree`: `const R = repoOfTicketId(id);` for the add (`R.resolveCommit(ref)`, `R.gitOrDie(['worktree', 'add', …], R.root)`, `seedWorktree(wt, { repo: R })`). For `--remove`: compute `const R = worktreeRepo(at) ?? die(…)`, list `R.git(['worktree', 'list', '--porcelain'], R.root)`, and remove with `R.gitOrDie(['worktree', 'remove', '--force', at], R.root)`; the other refusal conditions (under `.worktrees`, named `review-`) are unchanged.

- [ ] **Step 4: Run it, G1, the suite**

Run: `node --test --test-name-pattern "sibling ticket's review worktree|G1:"` → PASS; `node --test` → `ℹ fail 0` (the review-worktree, merge-gates and chore subtests are the home regression).

- [ ] **Step 5: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/kit.test.mjs
git commit -m "Gate, review and seeded worktrees of the ticket's repo under home/.worktrees, seeded from that repo's settings"
```

---

### Task 6b: Worker sessions in the ticket's repo: launch, sessions, handoffs

**Files:**
- Modify: `makeSession` (`devteam.mjs:5672-5755`), `PROMPTS.worker` use (`5728`), `sessionOf` (`5774-5778`), `isHandoffFile` (`5779`), `handoffFor` (`5795-5823`), `handoffCommit` (`5827-5833`), `sessionSettled` (`1684-1696`)
- Test: `test/kit.test.mjs`

**Interfaces:**
- Consumes: Task 6a's `seedWorktree(wt, { repo })`; Task 3's `repoOfTicketLink`, `repoReadable`, `repoOfTicket`.
- Produces: `sessionOf(name) → { name, role, id, branch, wt, handoff, repoName, readable, repo (getter) }`; `projectRelOf(name) → string`; `handoffCommit(ref, name, R = repo('home'))`.

- [ ] **Step 1: Write the failing test**

```js
test('a sibling ticket\'s worker: its worktree from its repo, home\'s kit by absolute path in its prompt', (t) => {
  const F = multiFixture('sibling-wt');
  const { old, g, okIn, ticket } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    // console's own worktree_files and worktree_setup, never home's; DEVTEAM_MAIN is console's root
    write(path.join(F.console, '.env'), 'CONSOLE=1\n');
    const links = json(okIn(old, ['settings'])).links;
    F.lines({ ...F.STD, console: { link: 'console' }, companion: { link: 'companion' } }, { links: { ...links, console: { ...links.console, worktree_files: ['.env'], worktree_setup: 'test -f "$DEVTEAM_MAIN/src/main.js" && touch .seeded-from-console' } } });
    ticket('console-01-a');
    const w = path.join(old, '.worktrees', 'console-01-a');
    if (hasTmux) {
      okIn(old, ['worker', 'console-01-a'], SUP);
      spawnSync('tmux', ['kill-server'], { env: F.env({}) });
      assert.equal(fs.realpathSync(g(['rev-parse', '--path-format=absolute', '--git-common-dir'], w)), fs.realpathSync(path.join(F.console, '.git')), 'a worktree of console');
      assert.equal(g(['rev-parse', '--abbrev-ref', 'HEAD'], w), 'ticket/console-01-a');
      assert.equal(g(['merge-base', 'HEAD', 'origin/trunk'], w), g(['rev-parse', 'origin/trunk'], F.console), "based on console's main");
      assert.equal(fs.readFileSync(path.join(w, '.env'), 'utf8'), 'CONSOLE=1\n', "console's worktree_files");
      assert.ok(fs.existsSync(path.join(w, '.seeded-from-console')), "console's worktree_setup, with DEVTEAM_MAIN at console's root");
      const prompt = fs.readFileSync(path.join(old, 'docs/devteam/run/prompts/console-01-a.txt'), 'utf8');
      assert.match(prompt, /node '[^']*\/old\/docs\/devteam\/scripts\/devteam\.mjs' ticket show console-01-a/, "home's kit by absolute path");
      assert.match(prompt, /records under docs\/devteam\/project\/tickets\/console-01-a\/ in this repo/);
    } else {
      t.diagnostic('tmux not installed: worker launch not exercised');
      g(['worktree', 'add', '-q', '-b', 'ticket/console-01-a', w, 'origin/trunk'], F.console);
    }
    // sessions are listed by name: without the checkout, the session is still there, unreadable
    write(path.join(old, 'docs/devteam/run/links.local.json'), JSON.stringify({ console: { path: path.join(F.base, 'not-cloned') } }));
    okIn(old, ['dashboard-data']);
    fs.rmSync(path.join(old, 'docs/devteam/run/links.local.json'));
  } finally { F.done(); }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern "a sibling ticket's worker"`
Expected: FAIL (the worktree is a worktree of home), or a diagnostic without tmux.

- [ ] **Step 3: Sessions in the ticket's repo**

`makeSession` (5701-5716), for a worker:

```js
  const R = role === 'worker' ? repoOfTicket(tickets().get(id)) : repo('home');
  …
  if (!fs.existsSync(wt)) {
    R.git(['fetch', '--quiet', 'origin', R.settings.main_branch]);
    R.git(['fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
    const base = R.resolveCommit(`origin/${R.settings.main_branch}`) ? `origin/${R.settings.main_branch}` : R.settings.main_branch;
    if (R.resolveCommit(`refs/heads/${branch}`)) R.gitOrDie(['worktree', 'add', '--quiet', wt, branch], R.root);
    else if (R.resolveCommit(`refs/remotes/origin/${branch}`)) R.gitOrDie(['worktree', 'add', '--quiet', '--track', '-b', branch, wt, `origin/${branch}`], R.root);
    else R.gitOrDie(['worktree', 'add', '--quiet', '-b', branch, wt, base], R.root);
    madeWorktree = true;
  }
  …
  seedWorktree(wt, { repo: R });
```

`s.main_branch` uses become `R.settings.main_branch` here; `s` stays home's for `tmux_session`, `agent_command`, `worker_denied_commands`. The prompt (5728): for a ticket outside home, rewrite the kit path and add where its records go:

```js
  const kitCmd = `node '${path.join(mainRoot, 'docs', 'devteam', 'scripts', 'devteam.mjs')}'`;
  const base0 = PROMPTS[role].replace(/\{\{ID\}\}/g, id);
  const text = `${R.name === 'home' ? base0 : `${base0.replace(/node docs\/devteam\/scripts\/devteam\.mjs/g, kitCmd).replace('Read the devteam section of AGENTS.md, then docs/devteam/process/worker.md', `Read ${path.join(mainRoot, 'docs', 'devteam', 'process', 'worker.md')}`)} This worktree is a checkout of ${R.name} (${R.remote}); run every devteam command as ${kitCmd}, and keep this ticket's records under ${R.projectRel}/tickets/${id}/ in this repo.`}${held ? ` ${idBlockText(held)}` : ''}`;
```

The env line (5738) adds `DEVTEAM_HOME='${mainRoot}'`. Home's prompt text and env are otherwise unchanged; the extra `DEVTEAM_HOME` export is typed into the pane, not printed by any golden.

`sessionOf(name)` (5774-5778) is called from views (`liveSessionsNow` 1647, `restartCommands` 1671, `holdView` 1700, `holdFindings` 1710, `fleetStatus` 6007, `fleetUndo` 6216), so it carries the repo's *name* and resolves the object only when asked (open issue 8):

```js
// A session by its writer name: a ticket id, or plan-<feature>. Its repo by name; the object only
// on use, so listing sessions never needs a checkout of every repo.
function sessionOf(name) {
  const planner = writerClass(name) === 'planner';
  const id = planner ? name.slice('plan-'.length) : name;
  const t = planner ? null : tickets().get(id);
  const repoName = t ? repoOfTicketLink(t) : 'home';
  const rel = projectRelOf(repoName);
  return { name, role: planner ? 'planner' : 'worker', id, branch: planner ? `plan/${id}` : `ticket/${id}`, wt: path.join(mainRoot, '.worktrees', name), handoff: `${rel}/${planner ? `plans/${id}` : `tickets/${id}`}/handoff.md`, repoName, readable: repoReadable(repoName), get repo() { return repo(repoName); } };
}
// A repo's project folder by name, from settings alone (no checkout needed).
const projectRelOf = (name) => (name === 'home' ? projectRel : LINK_KINDS[loadSettings().links?.[name]?.kind]?.effectiveSettings(loadSettings().links[name], loadSettings())?.project ?? 'docs/devteam/project');
```

`handoffCommit(ref, name, R = repo('home'))` uses `R.resolveCommit`/`R.git`. `handoffFor` and `sessionSettled` read branch facts only when `s.readable`, through `s.repo.resolveCommit`/`s.repo.git` (lines 1688-1691, 5807-5821); an unreadable session reads as not settled and with no handoff, and `fleetStatus` (Task 10) says why. `isHandoffFile` (5779) matches `(tickets|plans)/[^/]+/handoff\.md` under any repo's project folder: build its regex from the set of `projectRel` values (home's and each link's effective `project`).

- [ ] **Step 4: Run it, G1, the suite**

Run: `node --test --test-name-pattern "a sibling ticket's worker|G1:"` → PASS; `node --test` → `ℹ fail 0` (both fleet tests are the home regression for `sessionOf` and handoffs).

- [ ] **Step 5: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/kit.test.mjs
git commit -m "Worker sessions in the ticket's repo: worktree from it, home's kit by absolute path; sessions listed by repo name"
```

---

### Task 7: `check-pr --repo --path`, and the PR rules per repo

**Files:**
- Modify: `checkPr` (`devteam.mjs:2052-2081`), `logRule` (`839-878`), `reviewRule` (`887-930`), PR 1's `coverageFails`/`landingTree`, `cmdCheckPr` (`2167-2172`), `HELP`
- Test: `test/kit.test.mjs`

**Interfaces:**
- Produces: `checkPr({ headRef, sha, title, body, forge = false, repo: R = repo('home') })`; `logRule(headRef, sha, R)`, `reviewRule(sha, { forge, repo })`; `coverageFails(base, sha, R)`; `check-pr --repo <link> [--path <checkout>] --head-ref … --sha …`.

- [ ] **Step 1: Write the failing test**

```js
test('check-pr --repo checks a sibling PR in that repo, from any checkout (the forge\'s two-checkout run)', () => {
  const F = multiFixture('check-pr-repo');
  const { old, g, okIn, runIn, ticket } = F;
  const body = path.join(F.base, 'body.md');
  write(body, '## One-way doors\n\nNone.\n');
  try {
    ticket('console-01-a');
    const w = path.join(old, '.worktrees', 'console-01-a');
    g(['worktree', 'add', '-q', '-b', 'ticket/console-01-a', w, 'origin/trunk'], F.console);
    write(path.join(w, 'scripts/new.sh'), 'x\n');
    write(path.join(w, 'docs/devteam/project/log/console-01-a.jsonl'), '');
    g(['add', '-A'], w); g(['commit', '-qm', 'console-01-a: x'], w); g(['push', '-q', 'origin', 'ticket/console-01-a'], w);
    const sha = g(['rev-parse', 'HEAD'], w);
    F.lines({ ...F.STD, console: { link: 'console', owns: ['src/**', 'package.json', '.gitignore'] }, companion: { link: 'companion' } });
    // as the forge runs it: the sibling checked out at $GITHUB_WORKSPACE, home's kit beside it
    const ci = path.join(F.base, 'ci-console');
    g(['clone', '-q', F.consoleOrigin, ci], F.base);
    g(['fetch', '-q', 'origin', 'ticket/console-01-a'], ci);
    const r = runIn(ci, ['check-pr', '--repo', 'console', '--path', ci, '--head-ref', 'ticket/console-01-a', '--sha', sha, '--title', 'console-01-a: x', '--body-file', body], {}, { DEVTEAM_HOME: old });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /components \(console\): unowned: scripts\/ \(1\): scripts\/new\.sh/);
    assert.match(r.out, /docs\/devteam\/project\/log\/console-01-a\.jsonl: .*holds only tickets\//, 'no log in another repo');
    assert.match(r.out, /spec\.md missing at this head/, 'records are read from console at the head');
    assert.match(runIn(ci, ['check-pr', '--repo', 'nope', '--head-ref', 'ticket/x', '--sha', sha], {}, { DEVTEAM_HOME: old }).err, /no repo link "nope"/);
  } finally { F.done(); }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern 'check-pr --repo checks'`
Expected: FAIL (`--repo` ignored).

- [ ] **Step 3: The rules per repo**

- `checkPr`: add `repo: R = repo('home')`. Ticket branches: `checkTicket` already routes by id; check that `repoOfTicketId(id).name === R.name` and fail otherwise (`ticket/<id> is a ticket of ${repoOfTicketId(id).name}, not ${R.name}`). Plan and chore branches: if `R.name !== 'home'`, return `['plan and chore PRs are always home\'s (spec §5.4); a chore in another repo is a ticket of kind chore in its component']`.
- `logRule(headRef, sha, R = repo('home'))` (`devteam.mjs:839`): the other-repo branch is the first statement after the `!commonDir` guard, before anything reads home's `projectInRepo`, `mainRef` or `git`:

```js
function logRule(headRef, sha, R = repo('home')) {
  if (!commonDir) return [];
  // another repo has no log: its project folder holds only tickets/ (the log lives in home)
  if (R.name !== 'home') {
    const base = R.mainRef() ? R.git(['merge-base', R.mainRef(), sha]) : null;
    if (!base) return [`cannot resolve the merge base with ${R.name}'s main; its project folder not checked`];
    return R.changedFiles(base, sha).filter((f) => f.startsWith(`${R.projectRel}/`) && !f.startsWith(`${R.projectRel}/tickets/`)).map((f) => `${f}: ${R.projectRel} in another repo holds only tickets/ (the log, settings and designs live in home)`);
  }
  if (!projectInRepo) return [];
  // … today's body from line 841, unchanged
```

  Today's `if (!commonDir || !projectInRepo) return [];` (line 840) splits into the two guards above; for home the result is the same (G1).
- `reviewRule(sha, { forge, repo: R = repo('home') })`: for `R.name !== 'home'`, return `[]` (review questions are home's, open issue 3).
- PR 1's `landingTree(sha, R)` and `coverageFails(base, sha, R)` already take the repo (they default to `homeFacts`); `checkPr` passes its `R`. They read `R.settings.forge`, `R.mainRef()`, `R.mergeTree`, `R.treePaths` and `componentsOn(s, R.name)`, judge by `settingsInForce(base, sha, R)` (home main's committed settings for another repo: its PR can't change `settings.md`), and prefix lines with `components (${R.name}): ` for non-home repos. Nothing in them changes here; this task only passes `R`. In `checkPr`, PR 1's coverage line (right after line 2054) becomes `fails.push(...coverageFails(R.mainRef() ? R.git(['merge-base', R.mainRef(), sha]) : null, sha, R));`.
- `cmdCheckPr`: `const R = repo(flagStr('repo') ?? 'home');` (its `--path` flows through `linkLocation`); `const sha = R.resolveCommit(flagStr('sha') ?? 'HEAD') ?? die(…)`; `checkPr({ headRef, sha, title, body, forge: true, repo: R })`.
- `HELP`: `check-pr --head-ref r --sha s [--title t] [--body-file f] [--repo <link> [--path <checkout>]]   …; --repo checks a PR in another repo (the forge's run passes --path "$GITHUB_WORKSPACE")`.

- [ ] **Step 4: Run it, G1, the suite**

Run: `node --test --test-name-pattern 'check-pr --repo checks|G1:'` → PASS; `node --test` → `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/kit.test.mjs
git commit -m "check-pr --repo [--path]: a sibling PR checked in its repo; no log there; plan and chore PRs stay home's"
```

---

### Task 8: `merge` per repo: gates, landing on both forges, lines in home's log

**Files:**
- Modify: `cmdMerge` (`devteam.mjs:2258-2428`); schema `gate.properties.repo`, `act.properties.repo`
- Test: `test/kit.test.mjs`

**Interfaces:**
- Produces: `merge <ticket-id>` in the ticket's repo; gate lines `{ …, repo: '<link>' }` and the merge act `{ …, repo: '<link>' }` for non-home tickets (home lines unchanged).

- [ ] **Step 1: Write the failing tests (merge lands, lines in home, M3)**

```js
test('merge runs a sibling ticket\'s gates in its repo and lands it on that repo\'s main; a repo with no gates is refused (M3)', () => {
  const F = multiFixture('sibling-merge');
  const { old, g, okIn, runIn, ticket } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    // home's own gates are path-filtered; companion has none, and inherits none
    F.lines({ ...F.STD, console: { link: 'console' }, companion: { link: 'companion' } }, { gates: { web: { cmd: 'true', paths: ['web/**'] } } });
    const land = (id, repoDir, branch, files) => {
      ticket(id, { touches: Object.keys(files).map((f) => f.split('/')[0] + '/**') });
      const w = path.join(old, '.worktrees', id);
      g(['worktree', 'add', '-q', '-b', `ticket/${id}`, w, `origin/${branch}`], repoDir);
      const tdir = path.join(w, `docs/devteam/project/tickets/${id}`);
      write(path.join(tdir, 'spec.md'), '# spec\n');
      write(path.join(tdir, 'plan.md'), '# plan\n\n## TL;DR\n\n- x\n');
      write(path.join(tdir, 'verification.md'), '| Done-when | Command | Result |\n|---|---|---|\n| s | t | pass |\n');
      for (const [f, text] of Object.entries(files)) write(path.join(w, f), text);
      g(['add', '-A'], w); g(['commit', '-qm', `${id}: work`], w);
      write(path.join(tdir, 'reviews/final-1.md'), review('reviewer-b', g(['rev-parse', 'HEAD'], w)));
      g(['add', '-A'], w); g(['commit', '-qm', 'review'], w); g(['push', '-q', 'origin', `ticket/${id}`], w);
      okIn(old, ['act', '--class', 'approve-spec', '--refs', id, '--', 'ok'], SUP);
      okIn(old, ['act', '--class', 'approve-plan', '--refs', id, '--', 'ok'], SUP);
      write(path.join(old, `docs/devteam/run/pr/ticket/${id}.md`), `# ${id}: work\n\n## One-way doors\n\nNone.\n`);
      return g(['rev-parse', 'HEAD'], w);
    };
    const sha = land('console-01-a', F.console, 'trunk', { 'src/main.js': 'changed\n' });
    okIn(old, ['merge', 'console-01-a'], SUP);
    g(['fetch', '-q', 'origin'], F.console);
    assert.equal(g(['rev-parse', 'origin/trunk^2'], F.console), sha, "console's main merged the verified head");
    const gate = json(okIn(old, ['log', '--type', 'gate', '--json'])).find((x) => x.sha === sha);
    assert.deepEqual([gate.gate, gate.ok, gate.repo], ['test', true, 'console'], "console's gate, in home's log, naming its repo");
    const act = json(okIn(old, ['log', '--type', 'act', '--json'])).find((a) => a.class === 'merge-word' && a.refs.includes('console-01-a'));
    assert.equal(act.repo, 'console');
    assert.match(okIn(old, ['status']), /merged +console-01-a/, "status reads console's main");
    // M3
    land('companion-02-b', F.companion, 'main', { 'app/index.js': 'changed\n' });
    const r = runIn(old, ['merge', 'companion-02-b', '--dry-run'], SUP);
    assert.notEqual(r.status, 0);
    assert.match(r.out, /no gates in companion's settings \(links\.companion\.gates\); pass --no-gates/);
    // B1 at merge: a console-ui ticket that edits console-build's file is refused, by home's lines
    F.lines({ ...F.STD, 'console-ui': { link: 'console', owns: ['src/**'] }, 'console-build': { link: 'console', owns: ['package.json', '.gitignore'] }, companion: { link: 'companion' } }, { gates: { web: { cmd: 'true', paths: ['web/**'] } } });
    ticket('console-ui-03-c', { component: 'console-ui', touches: ['src/**', 'package.json'] });
    const uw = path.join(old, '.worktrees', 'console-ui-03-c');
    g(['worktree', 'add', '-q', '-b', 'ticket/console-ui-03-c', uw, 'origin/trunk'], F.console);
    write(path.join(uw, 'package.json'), '{"name":"edited by the ui"}\n');
    g(['commit', '-qam', 'console-ui-03-c: x'], uw); g(['push', '-q', 'origin', 'ticket/console-ui-03-c'], uw);
    write(path.join(old, 'docs/devteam/run/pr/ticket/console-ui-03-c.md'), '# console-ui-03-c: x\n\n## One-way doors\n\nNone.\n');
    assert.match(runIn(old, ['merge', 'console-ui-03-c', '--dry-run'], SUP).out, /changes files outside the line of console-ui: package\.json/, 'B1: merge refuses it too');
  } finally { F.done(); }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern 'merge runs a sibling ticket'`
Expected: FAIL (the PR text is found but the fetch, gates and landing run in home).

- [ ] **Step 3: Schema**

`gate.properties.repo`: `{ "description": "The repo link the gate ran in, for a ticket outside home (absent: home).", "type": "string", "pattern": "^[a-z][a-z0-9]*(-[a-z0-9]+)*$" }`. `act.properties.repo`: `{ "description": "The repo link the act was about (a merge, a release), when not home.", "type": "string", "pattern": "^[a-z][a-z0-9]*(-[a-z0-9]+)*$" }`.

- [ ] **Step 4: `cmdMerge` per repo**

Each block below replaces the lines named, in order; everything between them (the hold check 2283-2286, the plan-id check 2289-2295, `BEHIND`/`DIRTY` 2296, the `--approved` bookkeeping 2345-2362) is unchanged. For a home ticket, a plan or a chore, `R` is `repo('home')`, whose `settings`, `git`, `gh`, `resolveCommit` and `mainRef` are today's, so every line below computes what it computes today (G1); the two places where home's text or behaviour must not move say so.

Lines 2264-2282 (the branch, the PR, the fetch, the checks):

```js
  const branch = plan ? `plan/${plan}` : chore ? `chore-${chore}` : id ? `ticket/${id}` : die('usage: merge <ticket-id> | merge --plan <feature> | merge --chore <slug>   [--approved <qid>] [--no-gates] [--dry-run [--title t] [--body-file f]]');
  // A ticket merges in its own repo (spec §5.4); plans and chores are always home's.
  const R = id && tickets().has(id) ? repoOfTicket(tickets().get(id)) : repo('home');
  const S = R.settings;
  const onR = R.name === 'home' ? {} : { repo: R.name };
  const viaGit = S.forge === 'git';
  if (viaGit && !flagStr('title') && !flagStr('body-file')) {
    // The PR, with no forge: run/pr/<branch>.md in home's run/ (ticket ids are unique across repos).
    const f = path.join(runDir, 'pr', `${branch}.md`);
    if (fs.existsSync(f)) {
      const first = fs.readFileSync(f, 'utf8').split('\n')[0];
      if (first.startsWith('# ')) { flags.title = first.slice(2).trim(); flags['body-file'] = f; }
    }
  }
  if (viaGit && !dry && !(flagStr('title') && flagStr('body-file'))) die(`forge is git: merge needs the PR text, in ${path.relative(mainRoot, path.join(runDir, 'pr', `${branch}.md`))} ('# <title>' then the body) or as --title and --body-file`);
  const prJson = viaGit ? null : R.gh(['pr', 'view', branch, '--json', 'number,headRefOid,title,body,isDraft,mergeStateStatus,url,statusCheckRollup']);
  if (prJson === null && !dry && !viaGit) die(`no open PR from ${branch}${R.name === 'home' ? '' : ` in ${R.name}`} (gh pr view failed; with no forge CLI set forge: "git")`);
  R.git(['fetch', '--quiet', 'origin', branch]);
  const pr = prJson !== null ? JSON.parse(prJson) : { headRefOid: R.resolveCommit(`origin/${branch}`) ?? R.resolveCommit(branch) ?? die(`no branch ${branch}${R.name === 'home' ? '' : ` in ${R.name}`}`), title: flagStr('title'), body: flagStr('body-file') ? fs.readFileSync(flagStr('body-file'), 'utf8') : undefined };
  if (pr.isDraft) die(`${pr.url} is a draft`);
  const sha = pr.headRefOid;
  if (!R.resolveCommit(sha)) die(`cannot find ${sha} locally after fetching ${branch}`);
  const fails = checkPr({ headRef: branch, sha, title: pr.title, body: pr.body, repo: R });
```

(The `die` texts gain ` in <repo>` only for another repo; home's are byte-identical.)

Line 2301 (the forge checks to skip): `const ignored = new Set(S.ignored_checks ?? []);`.

Lines 2318-2331 and 2332-2344 (owner settings, chore approvals) are home's: wrap the first block as `if (R.name === 'home') { … }`; the chore block is already guarded by `if (chore)`, and a chore is always home's.

Lines 2363-2404 (the gates):

```js
  // Gates: the repo's own commands, never inherited (spec §3.1), at the exact head, in a detached
  // worktree of that repo seeded from that repo's settings.
  const gates = Object.entries(S.gates ?? {});
  if (!gates.length && !flags['no-gates'] && !chore) fails.push(R.name === 'home' ? 'no gates in settings (gates: {name: command}); pass --no-gates to merge without running any' : `no gates in ${R.name}'s settings (links.${R.name}.gates); pass --no-gates to merge without running any`);
  if (!fails.length && gates.length && !chore && !flags['no-gates']) {
    // A gate with `paths` runs only when the PR changes a file matching one of them (a monorepo's
    // per-app gates); a gate without runs on every PR.
    const base = R.mainRef() ? R.git(['merge-base', R.mainRef(), sha]) : null;
    const changed = base ? R.changedFiles(base, sha) : null;
    const applies = ([, spec]) => typeof spec === 'string' || !spec.paths || !changed || changed.some((f) => spec.paths.some((g) => pathMatches(g, f)));
    const skipped = gates.filter((g) => !applies(g)).map(([n]) => n);
    if (skipped.length) out(`gates not applicable to this PR: ${skipped.join(', ')}`);
    const wt = detachedWorktree(sha, `merge-${slug(branch)}`, R);
    try {
      for (const [name, spec] of gates.filter(applies)) {
        const cmd = typeof spec === 'string' ? spec : spec.cmd;
        const started = Date.now();
        let ok = true;
        try {
          execFileSync('sh', ['-c', cmd], { cwd: wt, stdio: 'inherit', env: gateEnv(!plan && !chore ? id : null, R) });
        } catch {
          ok = false;
        }
        const tests = typeof spec === 'object' && spec.junit ? readJunit(path.join(wt, spec.junit)) : [];
        const ms = Date.now() - started;
        let preexisting = false;
        if (!ok && spec.mode === 'ratchet' && base) {
          const bwt = detachedWorktree(base, `base-${slug(branch)}`, R);
          let baseOk = true;
          try { execFileSync('sh', ['-c', cmd], { cwd: bwt, stdio: 'ignore', env: gateEnv(!plan && !chore ? id : null, R) }); } catch { baseOk = false; } finally { R.git(['worktree', 'remove', '--force', bwt], R.root); }
          preexisting = !baseOk;
        }
        // the gate line lands in home's live log, naming the repo it ran in when not home
        appendLog({ type: 'gate', gate: name, ok, ms, sha, tests_total: tests.length, tests: keepTests(tests), preexisting: preexisting || undefined, ...onR }, 'supervisor');
        if (preexisting) { warn(`gate ${name} fails at the merge base ${base.slice(0, 12)} too: pre-existing, allowed by ratchet mode`); continue; }
        if (!ok) fails.push(`gate ${name} failed at ${sha.slice(0, 12)}`);
      }
    } finally {
      R.git(['worktree', 'remove', '--force', wt], R.root);
    }
  }
```

(The ratchet and junit comments of today's lines 2387-2389 stay above `preexisting`.)

Lines 2405-2427 (landing, then the act):

```js
  if (fails.length) report(fails, '');
  if (dry) return out(`ok: ${branch} at ${sha.slice(0, 12)} would merge`);
  const mainBranch = S.main_branch;
  if (viaGit) {
    // Merge the exact verified sha (never the branch name, which may have moved) onto origin's main.
    R.git(['fetch', '--quiet', 'origin', mainBranch]);
    const wt = detachedWorktree(`origin/${mainBranch}`, `land-${slug(branch)}`, R);
    try {
      R.gitOrDie(['merge', '--no-ff', '--quiet', '-m', `${pr.title}\n\n${(pr.body ?? '').trim()}\n\nMerged ${branch} at ${sha}`, sha], wt);
      if (R.git(['push', '--quiet', 'origin', `HEAD:refs/heads/${mainBranch}`], wt) === null) die(`push to ${mainBranch} refused (did main move?); verify from the start`);
    } finally {
      R.git(['worktree', 'remove', '--force', wt], R.root);
    }
  } else {
    const merged = R.gh(['pr', 'merge', String(pr.number), `--${S.merge_method}`, '--match-head-commit', sha]);
    if (merged === null) die(`gh pr merge refused (did the head move?); verify from the start`);
  }
  R.git(['fetch', '--quiet', 'origin', mainBranch]);
  // home resets exactly what it reset before (G1); another repo resets all of its own caches
  if (R.name === 'home') { mainLogCache = undefined; mergeShaCache.clear(); } else R.resetCaches();
  const cls = id ? 'merge-word' : plan ? 'approve-feature-plan' : 'merge-chore';
  const act = appendLog({ type: 'act', decision: citing(), class: cls, what: `merged ${branch} at ${sha}${['park', 'let-go'].includes(heldBy) ? ` while its goal is ${holdWords(heldBy)}, with --force` : ''}${standing?.tag ? ` (upstream ${standing.tag}, verbatim)` : standing ? ` (${standing.what}, under the owner's standing rule)` : ''}`, refs: id ? [id] : plan ? [plan] : [], reversible: false, approved_by: approved ?? standing?.rule.id ?? undefined, ...onR }, 'supervisor');
  out(`merged ${branch} at ${sha.slice(0, 12)}${R.name === 'home' ? '' : ` in ${R.name}`} (${act.id})`);
```

PR 1's `footprint-refusal` observation (after line 2282) is unchanged: its subject is the component.

- [ ] **Step 5: Run it, G1, the suite**

Run: `node --test --test-name-pattern 'merge runs a sibling ticket|G1:'` → PASS; `node --test` → `ℹ fail 0` (the forge-git and forge-checks subtests are the home regression).

- [ ] **Step 6: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs docs/devteam/schema/log.schema.json test/kit.test.mjs
git commit -m "merge per repo: the ticket's repo's PR, gates (never inherited), merge method and forge; gate and act lines in home's log name the repo"
```

---

### Task 9: Every `gh` call through `repo.gh`, with `-R`

**Files:**
- Modify: `logPrOpen` (`devteam.mjs:938`), `cmdCheckTicket` (`2041`, done in Task 5a), `cmdMerge` (`2275`, `2419`, done in Task 8), `openPr` (`4360`, `4362`), `fleetStatus` (`6109`)
- Test: `test/kit.test.mjs`

**Interfaces:**
- Consumes: `repo(name).gh(args, opts)` (Task 3).
- Produces: no direct `sh('gh', …)` remains outside `homeRepo().gh` and `linkRepo().gh` (a grep in the test enforces it); no view calls `repoOfTicket`/`repoOfTicketId` (a second lint, for open issue 8).

- [ ] **Step 1: Write the failing tests**

```js
test('every gh call names its repo (-R)', () => {
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const direct = src.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /sh\('gh', \[/.test(l) && !/sh\('gh', \[\.\.\.args/.test(l));
  assert.deepEqual(direct.map(([n]) => n), [], `gh called outside repo.gh at lines ${direct.map(([n]) => n).join(', ')}`);
});

// Views route by name (repoOfTicketLink, factsRepo, repoReadable), so a machine without one
// sibling's checkout still shows status and metrics; acts route by object and fail fast (open issue 8).
test('views never use the object routers', () => {
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8').split('\n');
  const VIEWS = ['deriveStatus', 'collectMetrics', 'collectProgress', 'notSchedulable', 'cmdReady', 'cmdStatus', 'sessionOf', 'liveSessionsNow', 'restartCommands', 'holdView', 'holdFindings', 'sessionSettled', 'timelineView', 'dashboardData', 'fleetStatus', 'moveChecklist', 'cmdLinks'];
  const body = (name) => {
    const at = src.findIndex((l) => l.startsWith(`function ${name}(`) || l.startsWith(`const ${name} = `));
    assert.ok(at >= 0, `${name} is defined`);
    if (src[at].startsWith('const ')) return [[at + 1, src[at]]];
    const end = src.findIndex((l, i) => i > at && l === '}');
    return src.slice(at, end + 1).map((l, i) => [at + 1 + i, l]);
  };
  const bad = VIEWS.flatMap((v) => body(v).filter(([, l]) => /\brepoOfTicket(Id)?\(/.test(l)).map(([n]) => `${v}:${n}`));
  assert.deepEqual(bad, [], 'a view calls an object router; use repoOfTicketLink, factsRepo or repoReadable');
});

test('a github-forge sibling: gh is asked about that repo', () => {
  const F = multiFixture('gh-r');
  const { old, g, okIn, runIn, ticket } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    // console's origin is written as GitHub's; insteadOf sends fetches to the local bare repo
    g(['remote', 'set-url', 'origin', 'https://github.com/usbclub/console.git'], F.console);
    g(['config', `url.${F.consoleOrigin}.insteadOf`, 'https://github.com/usbclub/console.git'], F.console);
    const links = json(okIn(old, ['settings'])).links;
    F.lines({ ...F.STD, console: { link: 'console' }, companion: { link: 'companion' } }, { links: { ...links, console: { ...links.console, remote: 'usbclub/console', forge: 'github' } } });
    ticket('console-01-a');
    const bin = path.join(F.base, 'fakegh');
    const logf = path.join(F.base, 'gh-args.log');
    write(path.join(bin, 'gh'), `#!/bin/sh\necho "$@" >> "${logf}"\nexit 1\n`);
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    runIn(old, ['merge', 'console-01-a', '--dry-run'], SUP, { PATH: `${bin}${path.delimiter}${process.env.PATH}` });
    assert.match(fs.readFileSync(logf, 'utf8'), /^pr view ticket\/console-01-a --json \S+ -R usbclub\/console$/m);
  } finally { F.done(); }
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test --test-name-pattern 'every gh call names|github-forge sibling|views never use'`
Expected: FAIL at the gh grep (lines 938, 4360, 4362, 6109). The view lint should already pass after Tasks 4-6b; if it names a line, route that line through `repoOfTicketLink`/`factsRepo`/`repoReadable` here.

- [ ] **Step 3: Route the rest**

- `logPrOpen` (938): `repo('home').gh(['pr', 'list', '--head', LOG_BRANCH, …], { cwd: wt })`.
- `openPr` (4360, 4362): `repo('home').gh([...], { cwd: wt })`.
- `fleetStatus` (6109): per repo (Task 10); for now `repo('home').gh(['pr', 'list', …])`.
- Home's `gh` appends `-R` only when home's origin names a GitHub repo; in every test fixture it is a local path, so home's calls are byte-identical to today's there.

- [ ] **Step 4: Run them, G1, the suite**

Run: `node --test --test-name-pattern 'every gh call names|github-forge sibling|views never use|G1:'` → PASS; `node --test` → `ℹ fail 0` (the fake-gh forge-checks subtest still matches `"$1 $2" = "pr view"`, since `-R` is appended).

- [ ] **Step 5: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/kit.test.mjs
git commit -m "Every gh call goes through repo.gh and names its repo with -R"
```

---

### Task 10: The fleet per repo: status, park, unpark, the move checklist

**Files:**
- Modify: `fleetStatus` (`devteam.mjs:5993-6140`), `moveChecklist` (`6143-6172`), `restartCommands` (`1669-1672`), `liveSessionsNow` (`1647-1652`, unchanged: sessions come from the log), `cmdHandoff` (worker path, done in Task 2), `sessionOf` (Task 6b)
- Test: `test/kit.test.mjs`

**Interfaces:**
- Produces: `fleet status` sessions carry `repo`; their "pushed", "clean" and "handoff" checks use `s.repo`; stray-worktree and unpushed-branch checks run per repo; open PRs listed per repo (`gh` per repo; `run/pr/` on forge git); a `repos` section listing each repo link with its resolved path and a missing-workflow warning; the checklist clones each sibling where its path says.

- [ ] **Step 1: Write the failing test**

```js
test('fleet status checks a sibling session against its own remote and lists every repo', () => {
  const F = multiFixture('fleet-multi');
  const { old, g, okIn, runIn, ticket } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const W = { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'console-01-a' };
  try {
    ticket('console-01-a');
    const w = path.join(old, '.worktrees', 'console-01-a');
    g(['worktree', 'add', '-q', '-b', 'ticket/console-01-a', w, 'origin/trunk'], F.console);
    okIn(w, ['phase', 'build', '--task', 'T1'], W);
    write(path.join(w, 'src/a.js'), 'a\n');
    g(['add', '-A'], w); g(['commit', '-qm', 'T1'], w);
    okIn(old, ['fleet', 'park', '--reason', 'move'], SUP);
    okIn(w, ['handoff'], W, {}, 'Done: T1. Next: T2.\n');
    okIn(w, ['phase', 'parked', '--note', 'parked'], W);
    const st = json(okIn(old, ['fleet', 'status', '--json', '--no-fetch'], SUP));
    const s = st.sessions.find((x) => x.name === 'console-01-a');
    assert.equal(s.repo, 'console');
    assert.equal(s.pushed, true, "its branch is on console's origin (handoff pushed it)");
    assert.equal(s.handoff, true);
    assert.deepEqual(st.repos.map((r) => [r.id, F.real(r.path), r.found]), [['console', F.real(F.console), true], ['companion', F.real(F.companion), true]]);
    assert.ok(st.checklist.some((c) => /^clone .*console\.git: git clone \S*console\.git \S*\/console /.test(c)), 'the new machine clones each sibling where its path says');
    // a commit not on console's origin is a blocker named for console's remote
    okIn(w, ['phase', 'build'], W);
    write(path.join(w, 'src/b.js'), 'b\n');
    g(['add', '-A'], w); g(['commit', '-qm', 'T2'], w);
    okIn(w, ['phase', 'parked', '--note', 'parked'], W);
    assert.match(json(okIn(old, ['fleet', 'status', '--json', '--no-fetch'], SUP)).blockers.join('\n'), /console-01-a: ticket\/console-01-a here \(\w{12}\) is not what origin has/);
    // a machine without the console checkout: fleet status still runs, and says what to clone where
    write(path.join(old, 'docs/devteam/run/links.local.json'), JSON.stringify({ console: { path: path.join(F.base, 'not-cloned') } }));
    const miss = json(okIn(old, ['fleet', 'status', '--json', '--no-fetch'], SUP));
    assert.equal(miss.sessions.find((x) => x.name === 'console-01-a').readable, false);
    assert.match(miss.blockers.join('\n'), /console-01-a: its repo console has no checkout here, or the wrong one: clone .*console\.git at .*not-cloned/);
    assert.match(miss.blockers.join('\n'), /console: clone .*console\.git at .*not-cloned/);
    assert.ok(miss.checklist.some((c) => /run\/links\.local\.json/.test(c)), 'the checklist says links.local.json does not move');
    assert.doesNotMatch(miss.blockers.join('\n'), /files in run\/ the kit didn't make/, 'links.local.json is a kit file');
    fs.rmSync(path.join(old, 'docs/devteam/run/links.local.json'));
  } finally { F.done(); }
});
```

(`handoff` reads its note from stdin: `okIn`'s fifth argument.)

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern 'fleet status checks a sibling'`
Expected: FAIL (`s.repo` undefined; `pushed` false because home's refs are read).

- [ ] **Step 3: Per-repo checks**

- `fleetStatus` sessions (6007-6030), a view: a session whose repo this machine can't read (`!x.readable`, Task 6b) becomes a row `{ name, role, branch, repo: x.repoName, readable: false, problems: [...] }` with the one blocker `${x.name}: its repo ${x.repoName} has no checkout here, or the wrong one: ${LINK_KINDS[kind].fixHint(l, x.repoName)}` (e.g. "clone usbclub/console at …/console"), and nothing else is read for it. Otherwise `const R = x.repo;` then `R.resolveCommit(`refs/heads/${x.branch}`)`, `R.resolveCommit(`refs/remotes/origin/${x.branch}`)`, `handoffCommit(…, x.name, R)`, `R.git(['cat-file', '-e', …])`, `R.git(['log', …])`, and, only when `x.repoName !== 'home'`, `repo: x.repoName, readable: true` in the row (a home session's row is byte-identical to today's). When `!flags['no-fetch']`, also fetch each readable repo link (`repo(id).git(['fetch', '--quiet', 'origin'])`) next to home's fetch (6000).
- Strays (6089-6099): for each directory under `.worktrees`, `const R = worktreeRepo(at)` (null for a worktree of a repo this machine can't read: listed as a stray `<name> (a worktree of no readable repo)`); unpushed counts `R.git(['rev-list', '--count', 'HEAD', '--not', '--remotes'], at)` (it already passes `at`).
- Unpushed branches (6100-6102): run the same expression in each repo (home and each link for which `repoReadable` holds), prefixing branch names with `<repo>:` for non-home repos.
- Open PRs (6107-6119): home as today; for each repo link on forge github, `R.gh(['pr', 'list', '--state', 'open', '--json', …])`, prefixing `headRefName` with `<repo>:`; forge git PR text stays under home's `run/pr/` (ticket ids are unique across repos).
- New `repos` section, only when settings has at least one repo link (`const repoLinks = Object.entries(s.links ?? {}).filter(([, l]) => LINK_KINDS[l.kind]?.hostsComponents);` then `...(repoLinks.length ? { repos } : {})` in the JSON and no text line otherwise, so a single-repo project's `fleet status --json` is unchanged): for each repo link, `{ id, remote, path: linkLocation(id), found: fs.existsSync(...), workflow: forge github ? R.git(['cat-file', '-e', `${R.mainRef()}:.github/workflows/devteam.yml`]) !== null : null }`; `workflow === false` → a warning `<id> has no devteam workflow on its main (init --github --repo <id>); merge runs the same checks, so this is defence in depth`; `found === false`, or `repoReadable(id)` false → a blocker `<id>: ${LINK_KINDS[kind].fixHint(l, id)}` (the repo is cloned at the wrong place, or not at all, on this machine); the `workflow` check runs only for a readable repo. Print it in the text output after `sessions:`.
- `moveChecklist` (6158-6171): after "clone the repo", insert one line per repo link: `clone ${l.remote}: git clone ${url} ${linkLocation(id)} (where settings path says)`, where `url` is the checkout's own `remote.origin.url` when readable, else the link's `remote`; and, when `run/links.local.json` exists here, one more line: `this machine kept its own checkout paths in run/links.local.json (it doesn't move): on the new machine, clone where settings say, or write run/links.local.json there with that machine's paths`. `links.local.json` is already in `RUN_KNOWN` (PR 1, `runPath`), so it never shows as a stray run file.

- [ ] **Step 4: Run it, G1, the suite**

Run: `node --test --test-name-pattern 'fleet status checks a sibling|G1:'` → PASS, with `test/fixtures/g1/fleet-status.txt` unchanged (`git diff --exit-code test/fixtures/g1`); `node --test` → `ℹ fail 0`. Both fleet tests are the home regression: they have no repo links, so their JSON has no `repos` key and their session rows no `repo`/`readable`.

- [ ] **Step 5: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/kit.test.mjs
git commit -m "fleet status, park and the move checklist per repo: each session against its own remote; every repo listed"
```

---

### Task 11: The dashboard's ticket views

**Files:**
- Modify: `/api/file` (`devteam.mjs:5285-5294`); `peekView` ticket (`6354-6365`, via `timelineView`, Task 5b); `dashboard/index.html` `fileHref` and `openFile` (`2587-2590`)
- Test: `test/kit.test.mjs`

**Interfaces:**
- Produces: `GET /api/file?path=…&ref=…&repo=<link>` reads from that repo's checkout; `fileHref(l)` and `openFile(params)` pass `repo`.

- [ ] **Step 1: Write the failing test**

```js
test('the dashboard reads a sibling ticket\'s documents from its repo', async () => {
  const F = multiFixture('dash-sibling');
  const { old, g, okIn, ticket } = F;
  try {
    ticket('console-01-a');
    const w = path.join(old, '.worktrees', 'console-01-a');
    g(['worktree', 'add', '-q', '-b', 'ticket/console-01-a', w, 'origin/trunk'], F.console);
    write(path.join(w, 'docs/devteam/project/tickets/console-01-a/spec.md'), '# console spec\n');
    g(['add', '-A'], w); g(['commit', '-qm', 'spec'], w);
    const tl = json(okIn(old, ['timeline', 'console-01-a', '--json']));
    const spec = tl.files.find((f) => f.title === 'spec');
    assert.equal(spec.repo, 'console');
    const port = 4800 + Math.floor(Math.random() * 500);
    const srv = spawn(process.execPath, [F.kitDT, 'dashboard', '--port', String(port)], { cwd: old, env: F.env({}) });
    try {
      let txt = null;
      for (let i = 0; i < 50 && txt === null; i++) {
        await new Promise((r) => setTimeout(r, 100));
        try { const r = await fetch(`http://127.0.0.1:${port}/api/file?path=${encodeURIComponent(spec.path)}&ref=${encodeURIComponent(spec.ref)}&repo=console`); if (r.ok) txt = await r.text(); } catch {}
      }
      assert.equal(txt, '# console spec\n');
      // the drawer rebuilds the URL from the link's params: it must carry repo through
      const html = fs.readFileSync(path.join(kit, 'dashboard/index.html'), 'utf8');
      const of = html.slice(html.indexOf('function openFile(params)'), html.indexOf('DRAWER.url = url;', html.indexOf('function openFile(params)')));
      assert.match(of, /repo = params\.get\('repo'\)/);
      assert.match(of, /new URLSearchParams\(\{ path, \.\.\.\(ref \? \{ ref \} : \{\}\), \.\.\.\(repo \? \{ repo \} : \{\}\) \}\)/, 'openFile passes repo to /api/file');
    } finally { srv.kill(); }
  } finally { F.done(); }
});
```

(Use the dashboard-port pattern the existing dashboard subtests use; if they pick ports differently, copy that instead of the random port.)

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern "dashboard reads a sibling"`
Expected: FAIL (`spec.repo` undefined until Task 5b's `timelineView` change; if Task 5b already set it, the fetch returns 404 because `/api/file` reads home).

- [ ] **Step 3: The endpoint and the link**

In `/api/file`: `const rid = u.searchParams.get('repo'); if (rid && !LINK_ID.test(rid)) return send(res, 400, …); const cwd = rid && rid !== 'home' ? (repoReadable(rid) ? repo(rid).root : null) : mainRoot; if (!cwd) return send(res, 404, 'text/plain', `no checkout of ${rid} here`);` and use `cwd` in the `execFile`. The default `ref` becomes that repo's main ref.

In `index.html`, two places carry the repo: `fileHref(l)` adds `&repo=${encodeURIComponent(l.repo)}` when `l.repo` is set (find it with `grep -n "fileHref" docs/devteam/dashboard/index.html`), and `openFile` (`index.html:2587-2590`), which rebuilds the `/api/file` URL from the link's params and today keeps only `path` and `ref`, so a sibling file would 404:

```js
function openFile(params) {
  const path = params.get('path'), title = params.get('title') || path, ref = params.get('ref'), repo = params.get('repo');
  drawerFor('file', path, params);
  const url = `/api/file?${new URLSearchParams({ path, ...(ref ? { ref } : {}), ...(repo ? { repo } : {}) })}`;
```

(For a home file `repo` is absent, so the URL is today's.)

- [ ] **Step 4: Run it, G1, the suite**

Run: `node --test --test-name-pattern "dashboard reads a sibling|G1:"` → PASS; `node --test` → `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs docs/devteam/dashboard/index.html test/kit.test.mjs
git commit -m "Dashboard: a sibling ticket's documents read from its repo"
```

---

### Task 12: `init --github --repo <link>`

**Files:**
- Modify: `WORKFLOW_YML` neighbours (`devteam.mjs:6529-6556`): add `REPO_WORKFLOW_YML(link, homeSpec)`; `cmdInit` (`6580-6603`); `HELP`
- Test: `test/kit.test.mjs`

**Interfaces:**
- Produces: `init --github --repo <link>` writes `<that repo's checkout>/.github/workflows/devteam.yml`: two checkouts (the repo under test at `$GITHUB_WORKSPACE`, home read-only at `.devteam-home`, open issue 6), `DEVTEAM_HOME_TOKEN` when home is private, and `check-pr --repo <link> --path "$GITHUB_WORKSPACE"`.

- [ ] **Step 1: Write the failing test**

```js
test('init --github --repo writes a component repo\'s check-pr workflow: its checkout and home\'s, beside it', (t) => {
  const F = multiFixture('init-repo');
  try {
    // home's origin written as GitHub's (the workflow checks it out by name); fetches stay local
    F.g(['remote', 'set-url', 'origin', 'https://github.com/usbclub/home.git'], F.old);
    F.g(['config', `url.${F.org}.insteadOf`, 'https://github.com/usbclub/home.git'], F.old);
    const out = F.okIn(F.old, ['init', '--github', '--repo', 'console'], { DEVTEAM_ROLE: 'supervisor' });
    const wf = path.join(F.console, '.github/workflows/devteam.yml');
    assert.ok(fs.existsSync(wf), out);
    const y = fs.readFileSync(wf, 'utf8');
    assert.doesNotMatch(y, /\{[^}\n]*\$\{\{/, 'no ${{ }} inside a flow mapping');
    assert.match(y, /path: \.devteam-home/);
    assert.match(y, /token: \$\{\{ secrets\.DEVTEAM_HOME_TOKEN \|\| github\.token \}\}/);
    assert.match(y, /DEVTEAM_HOME: \$\{\{ github\.workspace \}\}\/\.devteam-home/);
    assert.match(y, /node \.devteam-home\/docs\/devteam\/scripts\/devteam\.mjs check-pr --repo console --path "\$GITHUB_WORKSPACE" --head-ref "\$HEAD_REF" --sha "\$HEAD_SHA"/);
    assert.match(out, /DEVTEAM_HOME_TOKEN/, 'the setup checklist names the secret');
    const ry = spawnSync('ruby', ['-ryaml', '-e', 'w = YAML.load_file(ARGV[0]); exit(w["jobs"]["check-pr"]["steps"].size >= 4 ? 0 : 2)', wf], { encoding: 'utf8' });
    if (ry.error || /No version is set|command not found/.test(ry.stderr ?? '')) t.diagnostic('no runnable ruby: the workflow YAML was checked by pattern only');
    else assert.equal(ry.status, 0, ry.stderr);
    assert.match(F.runIn(F.old, ['init', '--github', '--repo', 'nope'], { DEVTEAM_ROLE: 'supervisor' }).err, /no repo link "nope"/);
  } finally { F.done(); }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern 'init --github --repo'`
Expected: FAIL (the workflow is written into home).

- [ ] **Step 3: The workflow and `init`**

```js
// The forge check for a component repo (spec §5.4): the repo under test at $GITHUB_WORKSPACE, home
// read-only inside it at .devteam-home (actions/checkout can only write under the workspace), and
// home's kit run against the first. merge runs the same checks itself; this is defence in depth.
const REPO_WORKFLOW_YML = (link, homeSpec) => `# devteam: an optional required check for a repo whose tickets live in ${homeSpec}'s fleet.
name: devteam
on:
  pull_request:
    types: [opened, synchronize, reopened, edited, ready_for_review]
permissions:
  contents: read
jobs:
  check-pr:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          ref: \${{ github.event.pull_request.head.sha }}
      - uses: actions/checkout@v4
        with:
          repository: ${homeSpec}
          path: .devteam-home
          fetch-depth: 0
          # a private home needs a read-only token in this repo's secrets
          token: \${{ secrets.DEVTEAM_HOME_TOKEN || github.token }}
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: git fetch --no-tags origin "+refs/heads/\${{ github.base_ref }}:refs/remotes/origin/\${{ github.base_ref }}"
      - env:
          DEVTEAM_HOME: \${{ github.workspace }}/.devteam-home
          HEAD_REF: \${{ github.head_ref }}
          HEAD_SHA: \${{ github.event.pull_request.head.sha }}
          PR_TITLE: \${{ github.event.pull_request.title }}
          PR_BODY: \${{ github.event.pull_request.body }}
        run: |
          printf '%s' "$PR_BODY" > "$RUNNER_TEMP/pr-body.md"
          node .devteam-home/docs/devteam/scripts/devteam.mjs check-pr --repo ${link} --path "$GITHUB_WORKSPACE" --head-ref "$HEAD_REF" --sha "$HEAD_SHA" --title "$PR_TITLE" --body-file "$RUNNER_TEMP/pr-body.md"
`;
```

In `cmdInit`, before `if (flags.github) put(...)` (6600):

```js
  if (flags.github && flagStr('repo')) {
    const R = repo(flagStr('repo'));
    const homeSpec = ghSpec(git(['config', '--get', 'remote.origin.url'])) ?? die("init --github --repo: home's origin is not a GitHub repo the workflow can check out");
    const wf = path.join(R.root, '.github', 'workflows', 'devteam.yml');
    if (fs.existsSync(wf)) return out(`${path.relative(mainRoot, wf)} exists; nothing to create`);
    fs.mkdirSync(path.dirname(wf), { recursive: true });
    fs.writeFileSync(wf, REPO_WORKFLOW_YML(R.name, homeSpec));
    out(`created:\n  ${wf}`);
    // the workflow file is a tracked path like any other: once lines are declared it needs an owner
    const owned = !linesDeclared(committedComponents()) || ownersOf('.github/workflows/devteam.yml', componentsOn(committedComponents(), R.name), R.devteamLine()).some((n) => n !== 'devteam');
    return out(`next: land it in ${R.name} as a chore ticket in its component${owned ? '' : `; first put .github/** inside one of ${R.name}'s component lines (settings components), or the new file is unowned and its PR is refused`}; if ${homeSpec} is private, add a read-only token for it to ${R.remote}'s secrets as DEVTEAM_HOME_TOKEN; then make the devteam check required there`);
  }
```

In the fixture, home's origin is a local path until the test rewrites it as GitHub's (with `url.<bare>.insteadOf`, as in Task 9), so `ghSpec` gives `usbclub/home`.

`HELP`: `init [--name n] [--upstream-base vX] [--github [--repo <link>]]   …; --repo writes the check-pr workflow into a component repo (its checkout and home's beside it)`.

- [ ] **Step 4: Run it, G1, the suite**

Run: `node --test --test-name-pattern 'init --github --repo|G1:'` → PASS; `node --test` → `ℹ fail 0` (the first subtest of `devteam kit` checks home's `init --github` is unchanged).

- [ ] **Step 5: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/kit.test.mjs
git commit -m "init --github --repo: a component repo's check-pr workflow, home checked out read-only beside it"
```

---

### Task 13: Releases per repo and component

**Files:**
- Modify: `cmdAct` (`devteam.mjs:3693-3749`, add `--repo`); `cmdNotes` (`6459-6479`, add `--repo`); Task 5b's `releaseOf`; `HELP`
- Test: `test/kit.test.mjs`

**Interfaces:**
- Produces: `act --class release-production|release-staging|production-migration … --repo <link>` stores `repo` on the act; `notes <from> [<to>] --repo <link>` reads that repo's history and its tickets; a ticket is `released` when its merge is in a tag of its repo matching its component's `release.tag` (default `v*`).

- [ ] **Step 1: Write the failing test**

```js
test('releases per repo: a component\'s tag pattern, the act names the repo, notes read that repo', () => {
  const F = multiFixture('releases');
  const { old, g, okIn, runIn, ticket } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    F.lines({ ...F.STD, console: { link: 'console', release: { tag: 'console/v*' } }, companion: { link: 'companion' } });
    ticket('console-01-a');
    const w = path.join(old, '.worktrees', 'console-01-a');
    g(['worktree', 'add', '-q', '-b', 'ticket/console-01-a', w, 'origin/trunk'], F.console);
    write(path.join(w, 'src/main.js'), 'v1\n');
    g(['commit', '-qam', 'console-01-a: v1'], w);
    g(['checkout', '-q', 'trunk'], F.console);
    g(['merge', '-q', '--no-ff', '-m', 'Merge ticket/console-01-a', 'ticket/console-01-a'], F.console);
    g(['push', '-q', 'origin', 'trunk'], F.console);
    g(['tag', '-a', 'v9.9.9', '-m', 'not this component\'s', 'trunk'], F.console);
    g(['push', '-q', 'origin', 'v9.9.9'], F.console);
    g(['fetch', '-q', '--tags', 'origin'], F.console);
    assert.match(okIn(old, ['status']), /merged +console-01-a/, 'a v* tag is not a console/v* release');
    g(['tag', '-a', 'console/v1.0.0', '-m', 'console 1.0.0', 'trunk'], F.console);
    assert.match(okIn(old, ['status']), /released +console-01-a/);
    const a = okIn(old, ['act', '--class', 'release-staging', '--repo', 'console', '--', 'staged console/v1.0.0'], SUP);
    assert.equal(json(okIn(old, ['log', '--id', a, '--json']))[0].repo, 'console');
    assert.match(runIn(old, ['act', '--class', 'release-staging', '--repo', 'nope', '--', 'x'], SUP).err, /--repo nope: not a repo link/);
    assert.match(okIn(old, ['notes', 'trunk~1', 'trunk', '--repo', 'console']), /Other\n\n- console-01-a/);
  } finally { F.done(); }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test --test-name-pattern 'releases per repo'`
Expected: FAIL (`v9.9.9` counts as a release, or `--repo` refused).

- [ ] **Step 3: Act, notes, release**

- `cmdAct`: `const rid = flagStr('repo'); if (rid && rid !== 'home' && !LINK_KINDS[loadSettings().links?.[rid]?.kind]?.hostsComponents) die(`--repo ${rid}: not a repo link (devteam.mjs links)`);` and add `repo: rid && rid !== 'home' ? rid : undefined` to the appended act.
- `cmdNotes`: `const R = repo(flagStr('repo') ?? 'home');` read the log with `R.git(['log', …])`; `ts` filters to tickets whose `repoOfTicket(t).name === R.name`; `landedBy` uses `R.git(['merge-base', …])`.
- `releaseOf` (Task 5b) already reads `release.tag`; check `status` shows `released` only for a matching tag.
- `HELP`: `act … [--repo <link>]` (a release, staging or production act names its repo) and `notes <from-tag> [<to>] [--repo <link>]`.

- [ ] **Step 4: Run it, G1, the suite**

Run: `node --test --test-name-pattern 'releases per repo|G1:'` → PASS; `node --test` → `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/kit.test.mjs
git commit -m "Releases per repo: a component's tag pattern; release acts and notes name their repo"
```

---

### Task 14: Cross-repo planning, and repo links through the owner

**Files:**
- Modify: `cmdValidate` D4 (`devteam.mjs:1509-1513`) and the feature/story loop (`1444-1448`); PR 1's `cmdLink` (repo kinds); `cmdAsk` (`2603-2607`, review questions for other repos); `HELP`
- Test: `test/kit.test.mjs`

**Interfaces:**
- Produces: `rawSettingsBlock()`, `linkByOwner(sub, id, field, vals, kind)`, `editUnownedField(id, field, value)`; D4 overlap checked only between tickets in the same repo; `validate --strict` story rule (open issue 5); `link add <id> --kind repo --remote r --title t [--path p] [per-repo keys]` asks a `governance-edit` question with the draft and writes nothing; `… --approved <qid>` writes it and logs a `governance-edit` act with refs `['chore-registry', 'link:<id>']` (open issue 7); `link set|rm` on a repo link likewise, with the field's class.

- [ ] **Step 1: Write the failing tests**

```js
test('cross-repo planning: footprints overlap only within a repo; a story across repos needs one ticket that lands last', () => {
  const F = multiFixture('xrepo-plan');
  const { old, okIn, runIn, ticket } = F;
  try {
    // the same path in two repos is two different files
    ticket('console-01-a', { touches: ['src/**'] });
    ticket('companion-02-b', { touches: ['src/**'] });
    assert.doesNotMatch(runIn(old, ['validate']).out, /console-01-a and companion-02-b can run concurrently/);
    // a story served in two repos: --strict wants the end-to-end ticket that depends on the rest
    okIn(old, ['feature', 'add', 'sync', '--json', JSON.stringify({ title: 'Sync', goals: ['g-20260101-000000000-supervisor'], stories: [{ id: 'SYNC-S1', text: 'sync works', release: 'v1' }] })], { DEVTEAM_ROLE: 'supervisor' });
    const tk = (id, extra) => okIn(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'sync', component: id.split('-')[0], kind: 'build', size: 'S', risk: 'normal', serves: ['SYNC-S1'], depends_on: [], touches: ['src/**'], done_when: ['the sync check passes'], ...extra })], { DEVTEAM_ROLE: 'supervisor' });
    tk('api-10-provide', { kind: 'contract', contracts: { provides: ['sync-v1'] }, touches: ['api/**'] });
    tk('console-11-use', {});
    assert.match(runIn(old, ['validate', '--strict']).out, /feature sync: story SYNC-S1 is served in api, console \(home, console\) and no ticket serving it depends on all the others/);
    tk('console-12-e2e', { kind: 'integration', depends_on: ['api-10-provide', 'console-11-use'] });
    assert.doesNotMatch(runIn(old, ['validate', '--strict']).out, /story SYNC-S1 is served in/);
  } finally { F.done(); }
});

test('link add --kind repo asks the owner a governance-edit question and writes nothing until it is answered', () => {
  const F = multiFixture('link-repo');
  const { old, g, okIn, runIn } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    const before = fs.readFileSync(F.settingsFile, 'utf8');
    const draft = okIn(old, ['link', 'add', 'docs', '--kind', 'repo', '--remote', 'usbclub/docs', '--title', 'Docs site', '--main_branch', 'trunk'], SUP);
    const qid = /q-[a-z0-9-]+/.exec(draft)[0];
    assert.equal(fs.readFileSync(F.settingsFile, 'utf8'), before, 'nothing written before the answer');
    assert.match(okIn(old, ['link', 'add', 'docs', '--kind', 'repo', '--remote', 'usbclub/docs', '--title', 'Docs site', '--main_branch', 'trunk'], SUP), new RegExp(`${qid}: already asked the owner about this exact change`), 'asking twice reuses the question');
    const q = json(okIn(old, ['questions', '--id', qid, '--json']))[0];
    assert.deepEqual([q.kind, q.class], ['owner-decision', 'governance-edit']);
    assert.match(q.context, /"docs": \{[\s\S]*"kind": "repo"[\s\S]*"remote": "usbclub\/docs"/);
    assert.match(runIn(old, ['link', 'add', 'docs', '--kind', 'repo', '--remote', 'usbclub/docs', '--title', 'Docs site', '--approved', qid], SUP).err, /is not a question the owner answered/);
    okIn(old, ['answer', qid, 'yes']);
    okIn(old, ['link', 'add', 'docs', '--kind', 'repo', '--remote', 'usbclub/docs', '--title', 'Docs site', '--main_branch', 'trunk', '--approved', qid], SUP);
    assert.match(okIn(old, ['link', 'add', 'docs', '--kind', 'repo', '--remote', 'usbclub/docs', '--title', 'Docs site', '--main_branch', 'trunk', '--approved', qid], SUP), /links\.docs is already that in settings\.md here/, 'a second apply is a no-op (the entry is in the raw block, not yet on main)');
    assert.equal(JSON.parse(/```json devteam\s*\n([\s\S]*?)\n```/.exec(fs.readFileSync(F.settingsFile, 'utf8'))[1]).links.docs.remote, 'usbclub/docs');
    const act = json(okIn(old, ['log', '--type', 'act', '--json'])).find((a) => a.approved_by === qid);
    assert.deepEqual([act.class, act.refs], ['governance-edit', ['chore-registry', 'link:docs']]);
    // and the registry chore lands with that one answer
    const wt = path.join(old, '.worktrees', 'chore-registry');
    g(['worktree', 'add', '-q', '-b', 'chore-registry', wt, 'origin/main'], old);
    fs.copyFileSync(F.settingsFile, path.join(wt, 'docs/devteam/project/settings.md'));
    g(['commit', '-qam', 'chore-registry: docs repo'], wt);
    g(['push', '-q', 'origin', 'chore-registry'], wt);
    write(path.join(old, 'docs/devteam/run/pr/chore-registry.md'), '# chore-registry: docs repo\n\n## One-way doors\n\nNone.\n');
    assert.doesNotMatch(runIn(old, ['merge', '--chore', 'registry', '--dry-run', '--approved', qid], SUP).out, /changes owner settings|already approved/);
  } finally { F.done(); }
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test --test-name-pattern 'cross-repo planning|link add --kind repo asks'`
Expected: FAIL on the D4 overlap, and on PR 1's repo-link refusal.

- [ ] **Step 3: Planning rules**

- D4 (line 1511): `if (repoOfTicketLink(a) !== repoOfTicketLink(b)) continue;` (Task 3's name router, so validate never needs a checkout).
- In the feature loop after the D7 check (line 1447), under `flags.strict`:

```js
      // Across repos there are no multi-repo tickets (spec §6.2): a story served in two repos is
      // split per repo, with its end-to-end check in the ticket that lands last (open issue 5).
      if (flags.strict) {
        const repos = [...new Set(servers.map(repoOfTicketLink))];
        const clos = closures(ts);
        if (repos.length > 1 && !servers.some((t) => servers.every((o) => o === t || clos.get(t.id)?.has(o.id)))) errors.push(`feature ${fid}: story ${s} is served in ${[...new Set(servers.map((t) => t.component))].join(', ')} (${repos.join(', ')}) and no ticket serving it depends on all the others; add the end-to-end ticket that lands last (planning.md D2, D7)`);
      }
```

- `cmdAsk` review questions (after `review = pinReview();`, line 2606): `if (flagStr('ticket') && repoOfTicketId(flagStr('ticket')).name !== 'home') die('a review question pins a page in home; for a ticket in another repo, draw the page in a home chore and ask it there (open issue 3 of the multi-repo spec)');` (word the message without the spec reference in the code; keep the reason).

- [ ] **Step 4: Repo links through the owner**

In PR 1's `cmdLink`, replace the owner's-kind refusal (`if (K.ownedByOwner) die(…)`) with:

```js
  if (K.ownedByOwner) return linkByOwner(sub, id, field, vals, kind);
```

and add:

```js
// The json devteam block of the main checkout's settings.md as written, not as loadSettings pins
// it: a repo link written by an earlier --approved run is here before it lands on main.
const rawSettingsBlock = () => { const m = readText(path.join(projectDir, 'settings.md'))?.match(/```json devteam\s*\n([\s\S]*?)\n```/); try { return m ? JSON.parse(m[1]) : {}; } catch { return {}; } };
// A link of an owner's kind (spec §3.4, §7): draft the change and ask a question in the class its
// field takes (gate-change for a gate field, else governance-edit); with --approved <qid>, apply
// exactly that change and log the act the chore-registry merge then lands under the same answer
// (open issue 7). Asking twice for the same draft reuses the open question; applying a draft
// already written is a no-op. Nothing here names a kind: the table gives fields and classes.
function linkByOwner(sub, id, field, vals, kind) {
  const K = LINK_KINDS[kind];
  const raw = rawSettingsBlock().links ?? {};
  const cur = raw[id] ?? loadSettings().links?.[id];
  const jsonish = (v) => { try { return JSON.parse(v); } catch { return v; } };
  const pick = Object.fromEntries(linkFields(kind).filter((k) => k !== 'kind' && flags[k] !== undefined).map((k) => [k, k === 'for' ? listFlag('for') : jsonish(flagStr(k))]));
  const next = sub === 'rm' ? undefined : sub === 'add' ? { kind, ...pick } : { ...cur, [field]: jsonish(vals.join(' ')) };
  const cls = sub === 'set' ? K.ownerClass(field) : 'governance-edit';
  // a field that is no one's (a repo link's path, §3.5) is written like a url link's, as registry-edit
  if (sub === 'set' && !cls) return editUnownedField(id, field, next[field]);
  if (canonical(raw[id] ?? null) === canonical(next ?? null)) return out(`links.${id} is already ${next ? 'that' : 'gone'} in settings.md here; ${LANDING_HINT}`);
  const { errors } = registryProblems({ ...loadSettings(), links: { ...(loadSettings().links ?? {}), ...(next ? { [id]: next } : {}) } });
  if (errors.length) die(`not drafted:\n  - ${errors.join('\n  - ')}`);
  const draft = JSON.stringify({ [id]: next ?? null }, null, 2);
  const approved = flagStr('approved');
  if (!approved) {
    const open = questions().find((q) => q.status === 'open' && q.class === cls && (q.context ?? '').includes(draft));
    if (open) return out(`${open.id}: already asked the owner about this exact change; then: link … --approved ${open.id}`);
    const q = appendLog({ type: 'question', kind: 'owner-decision', class: cls, question: `${sub === 'add' ? 'Add' : sub === 'rm' ? 'Remove' : 'Change'} the ${kind} link ${id}${sub === 'set' ? ` (${field})` : ''}?`, context: `The registry entry, as it would be in settings.md links:\n${draft}`, recommendation: 'yes', why_asked: { reasons: ['owner-only'] } }, 'supervisor');
    return out(`${q.id}: asked the owner (${cls}); nothing is written until it is answered. Then: link ${[sub, id, field, ...vals].filter(Boolean).join(' ')} … --approved ${q.id}`);
  }
  const v = ownerAnswer(approved, 'link --approved');
  if (v.class !== cls) die(`${approved} was asked in class ${v.class ?? '(none)'}, not ${cls}`);
  if (!(v.context ?? '').includes(draft)) die(`${approved} asked about another change; ask again for this one`);
  editSettingsBlock((b) => { b.links ??= {}; if (next) b.links[id] = next; else delete b.links[id]; return b; });
  appendLog({ type: 'act', class: cls, what: `${sub === 'rm' ? 'removed' : sub === 'add' ? 'added' : `set ${field} on`} ${kind} link ${id}`, refs: ['chore-registry', `link:${id}`], reversible: true, approved_by: approved }, 'supervisor');
  out(`applied ${approved}; ${LANDING_HINT} --approved ${approved}`);
}
// A field no owner class guards (a repo link's path: where its checkout is on this machine, §3.5).
function editUnownedField(id, field, value) {
  authorise('registry-edit', null, null, [], 'link');
  editSettingsBlock((b) => { b.links[id] = { ...b.links[id], [field]: value }; return b; });
  appendLog({ type: 'act', class: 'registry-edit', what: `set ${field} on link ${id}`, refs: [`link:${id}`], reversible: true }, 'supervisor');
  out(`set ${id}.${field}; ${LANDING_HINT}`);
}
```

`ownerAnswer` is at `devteam.mjs:2241`. The `--approved` act is not routed through `authorise` because `governance-edit` and `gate-change` are `owner_only` and the answer is checked above in that class. Flags like `--main_branch` use the field names as written in settings; document them in `HELP`:

```
  link add <id> --kind repo --remote r --title t [--path p] [--main_branch b] [--forge f] [--gates '{…}'] … [--approved qid]   supervisor: drafts a repo link and asks the owner (governance-edit); with the answer, writes it for the chore-registry PR
```

- [ ] **Step 5: Run them, G1, the suite**

Run: `node --test --test-name-pattern 'cross-repo planning|link add --kind repo asks|G1:'` → PASS; `node --test` → `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/kit.test.mjs
git commit -m "Cross-repo planning: footprints per repo, a story across repos lands its end-to-end ticket last; repo links through the owner"
```

---

### Task 15: G1 check

**Files:** none changed unless a check fails.

- [ ] **Step 1: The goldens, untouched**

Run: `node --test --test-name-pattern 'G1:'` → PASS. `git log --oneline origin/main.. -- test/fixtures/g1` prints nothing (this PR never re-records them).

- [ ] **Step 2: Home's code paths**

Read `git diff <PR 1 merge>.. -- docs/devteam/scripts/devteam.mjs` and list, for each hunk, why a project with no repo links runs exactly what it ran before. The list must cover: `git`/`gitOrDie` default cwd (`HOME_CWD` is `undefined` in a home checkout); the constants (`commonDir` from the script equals the cwd's in a home checkout; `projectRoot` is `repoRoot`); `repo('home')` (today's functions and caches); the routers (`repoOfTicketId` returns home for every ticket when no component names another link); `gateEnv` (adds `DEVTEAM_HOME` only); `seedWorktree`/`detachedWorktree` (home's settings and root); `repo('home').gh` (`-R` only when home's origin names a GitHub repo, the same repo `gh` inferred from the cwd); `fleet status` (no `repos` key and no `repo`/`readable` on a row without repo links, no new text line); `whoami` (`home=` in its comment line). Also note one change outside a home checkout: with no `DEVTEAM_HOME` and a cwd in no git repo at all, home is now the repo that holds the running kit (the script's), where before `commonDir` was null and git-backed commands refused; in the kit's own repo that is the kit repo itself. And with no `DEVTEAM_HOME` and a cwd inside an unrelated git repo (not home, not a repo link), home is the running kit's repo too, where before every command treated that unrelated repo as home (its refs, its HEAD, its missing `project/`); git reads now go to home (`HOME_CWD`) and only HEAD readers (`cwdGit`) see the unrelated checkout. Put the list in the PR description.

- [ ] **Step 3: No cwd-relative git left where it would hit a sibling**

Run: `grep -n "git(\[" docs/devteam/scripts/devteam.mjs | grep -v "], \|cwdGit\|R\.git\|g(\[" | wc -l` and review each line the grep prints: every remaining no-cwd `git([...])` call must be a read of home (it goes to `HOME_CWD`), never "this checkout's HEAD" (those are `cwdGit`).

- [ ] **Step 4: The full suite on every Node**

```bash
# from the repository root
for v in 18.20.4 20 22 24; do echo "== node $v"; ASDF_NODEJS_VERSION=$v node --version && ASDF_NODEJS_VERSION=$v node --test 2>&1 | tail -4; done
```

Expected: `ℹ fail 0` each time (or only the known load flake; re-run that one idle). Versions not installed locally are checked by CI's matrix.

- [ ] **Step 5: Commit any fix separately, with the reason**

---

### Task 16: Docs and the release notes

**Files:**
- Modify: `README.md`, `docs/devteam/governance/quality.md`, `docs/devteam/process/planning.md`, `docs/devteam/process/supervisor.md`, `docs/devteam/process/worker.md`

- [ ] **Step 1: README**
  - The "Links, components and other repos" section (PR 1) gains the third shape, **sibling repos**: a minimal `links` entry of kind `repo` (`remote`, `title`, optional `path`, its own `gates`), a component with `"link": "<id>"`, and what changes: its tickets' worktrees are made from that repo under `home/.worktrees`, its records live in that repo's `docs/devteam/project/tickets/`, `merge` runs its gates and lands on its main, and every line still lands in home's log.
  - Setup checklist items: sibling checkouts laid out as `path` says (default `../<id>`; `run/links.local.json` for this machine's own layout); for each component repo on GitHub, `init --github --repo <link>` and, when home is private, a read-only `DEVTEAM_HOME_TOKEN` secret in that repo. Once that repo draws lines, `.github/**` must sit inside one of its component lines, or the workflow file is an unowned path and its PR is refused.
  - "Holding goals, and moving the fleet": the new machine clones each sibling where its path says (the checklist prints the commands).
- [ ] **Step 2: governance/quality.md**
  - §4: "`merge <ticket-id>` works in the ticket's repo: its PR, its gates (never inherited from home: a repo with no `gates` is refused like home with none), its `merge_method` and forge, its `ignored_checks`. The `gate` and `act` lines land in home's log with a `repo` field. Plan and chore PRs are always home's; a chore that must change another repo is a ticket of kind `chore` in that repo's component."
  - §1 point 9: "… or its own `project/tickets/<id>/` folder in the ticket's repo."
  - §5 Releases: "`release` is per repo; a component may set its own tag pattern (`release: { "tag": "web/v*" }`); release, staging and production acts name their repo (`act … --repo <link>`); a ticket is released when its merge is in a release of its own repo and component."
- [ ] **Step 3: process/planning.md**
  - D2: "**Across repos**, a contract is a `contract` ticket in the provider's repo (the definition, its version, a fake or recorded fixtures), plus in each consumer repo a ticket that `depends_on` it and vendors the fake. There are no multi-repo tickets."
  - D7: "A story served in more than one repo is split per repo, with the end-to-end check in the ticket that lands last (it depends on all the others); `validate --strict` errors otherwise."
  - D4: "Footprints overlap only within a repo: the same path in two repos is two files."
- [ ] **Step 4: process/supervisor.md**
  - §5 (Scheduling and merging): "`merge` works per repo; the ticket says which. `fleet status` lists each repo link with its path and warns when a GitHub repo has no devteam workflow."
  - The registry subsection (PR 1): "For a repo link, `link add <id> --kind repo …` drafts the entry and asks the owner a `governance-edit` question; with the answer, `link add … --approved <qid>` writes it, and `merge --chore registry --approved <qid>` lands it."
- [ ] **Step 5: process/worker.md**
  - New subsection in §1: "**A ticket in another repo.** Your worktree is a checkout of that repo, under home's `.worktrees/`. Run every devteam command with home's kit by the absolute path your prompt gives (`DEVTEAM_HOME` and `DEVTEAM_RUN` are set); your records (spec, plan, verification, reviews, handoff) go under that repo's `docs/devteam/project/tickets/<id>/` and land with your code; the log, the questions and the designs stay in home."
- [ ] **Step 6: Release notes text**

```markdown
## What

- Tickets run in sibling repos. A component with `"link": "<id>"` lives on a `repo` link; its tickets' worker, review and gate worktrees are made from that repo under home's `.worktrees/`, seeded from that repo's own `worktree_files` and `worktree_setup`. Their records (spec, plan, verification, reviews, handoff) live in that repo's `docs/devteam/project/tickets/<id>/` and merge with the code, so every exact-head rule holds as before.
- `merge` works per repo: its PR (github or forge `git`), its gates (never inherited: a repo with no `gates` is refused), its merge method, forge checks and `ignored_checks`; the tree that would land keeps every path in one line. `gate` and `act` lines land in home's log with a `repo` field.
- Home is found from `DEVTEAM_HOME` or the running kit, never from the cwd; a bad `DEVTEAM_HOME` is refused. A worker in another repo's worktree runs home's kit by absolute path.
- `repo(name)` gives each repo its own main ref and caches; a missing checkout, or one whose `origin` isn't the link's `remote`, is refused with one message. `--path` and `run/links.local.json` say where a checkout is on this machine.
- `check-pr --repo <link> [--path <checkout>]`; `components check --repo`; `init --github --repo <link>` writes a component repo's workflow (its checkout and home's, read-only, beside it; `DEVTEAM_HOME_TOKEN` for a private home).
- `fleet status`, park and unpark check each session against its own repo's remote, list every repo link with its path, and the move checklist clones each sibling.
- Releases per repo and component: a component's `release: { "tag": "web/v*" }`; `act … --repo`; `notes … --repo`.
- Planning: footprints overlap only within a repo; under `--strict`, a story across repos needs one ticket that depends on all the others.
- `link add --kind repo` (and `set`/`rm` on a repo link) drafts the entry and asks the owner a `governance-edit` (or `gate-change`) question; with `--approved <qid>` it writes it for a `chore-registry` PR that lands under the same answer.
- Every `gh` call names its repo with `-R`.

## Why

- One product spread over several repos (an API, a desktop app, a mobile app) runs on one fleet, one log and one graph, so the order in which the server lands first and the clients follow stays in the graph instead of in people's heads.

## Migration

None for existing projects: with no repo links, every command runs as before. To add a sibling repo: clone it where its `path` says (default `../<id>`), then ask the owner for a `links` entry of kind `repo` (`link add <id> --kind repo --remote <owner/name> --title "…"` drafts the question) with that repo's own `gates`, land it, and point a component at it with `"link": "<id>"`. For each sibling on GitHub, `init --github --repo <id>` writes its workflow; if home is private, add a read-only `DEVTEAM_HOME_TOKEN` secret to that repo.
```

- [ ] **Step 7: Commit**

```bash
git add README.md docs/devteam/governance docs/devteam/process
git commit -m "Docs: tickets in other repos, merge per repo, cross-repo contracts and stories"
```

---

## Spec coverage (self-review)

| Spec | Task |
|---|---|
| §5.1 `repo(name)` object, `repoOfTicket` | 3 |
| §5.1 the nine constants, `DEVTEAM_HOME` validation, re-exec unchanged | 2 (open issue 1) |
| §5.1 per-repo caches, home's stay where they are | 3 |
| §5.1 call sites: `seedWorktree`, `gateEnv`; `missingPins(root)`; `detachedWorktree`; `review-worktree` and `--remove` | 6a |
| §5.1 call sites: `makeSession`; handoff files; sessions by repo name | 6b |
| §5.1 call sites: `checkTicket`, `checkPr`, `cmdCheckPr --repo` (B1: footprint and coverage by home's committed lines) | 5a, 7 |
| §5.1 call sites: `cmdMerge` (both forges) | 8 |
| §5.1 call sites: `mergeShaFor`, `mergedAt`, `ticketBranchRef`, `releasedIn` | 3, 5a, 5b, 13 |
| §5.1 every `gh` through `repo.gh -R` | 9 |
| §5.1 `fleet status`, `unpushedBranches`, open PRs per repo (an unreachable repo: a "clone X at path" blocker) | 10 |
| §5.1 dashboard ticket views and review pages; `stop-ok` | 11, 5b (open issue 3), 2 |
| Open issue 8: views by name, acts by object; lint | 3, 4, 5a, 5b, 6b, 9, 10 |
| §5.2 worktrees under `home/.worktrees`, repo computed from the common dir, home's kit by absolute path, seeding from the ticket's repo | 6a, 6b |
| §5.3 records travel with the code; R's project folder holds only `tickets/` | 5a, 4, 7 |
| §5.4 merge, gates, forge checks; `init --github --repo`; missing-workflow warning | 8, 12, 10 |
| §5.5 releases with a pattern | 13 |
| §6.1 one repo per ticket (touches_components same repo) | PR 1 Task 6 (same-repo check), 14 |
| §6.2 cross-repo contracts, `--strict` story rule, `globsOverlap` per repo | 14 (open issue 5), 16 |
| §8 `--repo` flags, repo-link `link add`, `init --github --repo` | 3, 7, 13, 14, 12 |
| §10 docs (README, quality, planning, supervisor, worker), schema `repo` on gate/act | 16, 8 |
| §12 sibling fixture: worktree from the sibling, records at the head, gates in the sibling, merge lands, lines in home's log, fleet status checks the sibling remote | 6b, 5a, 8, 8, 8, 10 |
| §12 links: `link add` repo asks governance-edit and writes nothing until answered | 14 |
| §12 regression M3, M6, M7, M8, M9 | 8, 2, 3, 6a, 3 |
