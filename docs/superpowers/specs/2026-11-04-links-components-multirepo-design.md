# devteam: a links registry, component lines, and components in other repos

**Date:** 2026-11-04 (rev 2.4: PR 1 round-3 fixes: a failed fetch of main refuses check-pr and merge, a settings key or link both sides changed is refused without lines, a removal lands only for the entry main has (`prior_hash`), credentialed urls kept out of questions; marked "rev 2.4". Rev 2.3: PR 1 round-2 review fixes: registry acts matched by the entry they wrote, the registry at landing read without merge-tree when no lines are declared, check-pr and merge fetch main first, redaction everywhere, `--key=value`; marked "rev 2.3". Rev 2.2: PR 1 review fixes, the coordinator's rulings on the Fable and Opus reviews folded in, marked "rev 2.2". Rev 2.1: example lines made disjoint, and the planner's 22 conservative readings accepted, recorded in the plans. Rev 2: after Fable's adversarial review: 3 blockers, 10 majors, 12 minors, all folded in). **Owner:** Hugh (approved the direction in chat on 2026-11-04). **Author:** mothership-f2 (Opus 5.5).
**Upstream:** `sanctuarycomputer/devteam`, branch `multi-repo` (built on `origin/main` 45956b4, v0.17.1).

## 1. Why

devteam assumes one repo. Workers, gates, reviewers and merges all run against the repo the kit sits in, and `settings.md` has one `main_branch`, `forge`, `gates`, and so on.

Three kinds of project need more than that:

1. **Sibling repos.** One product spread over several repos: a Rails API, an Electron app and a React Native app. Today each repo would need its own fleet, and the graph would lose the cross-repo ordering where the server lands first and clients follow.
2. **Monorepos and microservice repos.** One repo, many deployable parts. `components` is a label on a ticket today; nothing says which files a component is, so nothing stops a ticket for `web` from editing `api`.
3. **Every project needs links to resources outside its code:** design files, Notion pages, runbooks, dashboards. Today these exist only as `--links` on one question.

One registry covers all three. A **link** is a named resource the fleet uses. A **repo link** is a link devteam can also operate on: worktrees, gates and merges. A **component** is a line drawn over a repo link: the files it owns.

## 2. Goals and non-goals

**Goals**
- G1. Single-repo projects behave exactly as today with no settings changes. That means no new failures, no new required fields, and identical command output apart from new optional lines.
- G2. A monorepo can declare component lines. Every tracked file belongs to exactly one component, and devteam enforces this everywhere code reaches main.
- G3. One fleet, one log and one graph can run tickets in several repos. Each ticket changes exactly one repo, and its PR carries both its code and its evidence at the exact head. Gates, reviews and merges work as today, per repo.
- G4. Standing resources (design files, docs) are first-class:
  - they're named once and scoped to the work they serve;
  - they're put into the prompts of the workers who need them;
  - they're added by the loop itself when the owner or a worker mentions one.
- G5. The registry can grow new link kinds later without a schema rewrite.

**Non-goals**
- Fetching, mirroring or syncing what a `url` link points at. A link is a pointer plus metadata.
- Cross-repo atomic merges. Repos ship on their own clocks; the graph orders them.
- Multiple supervisors, or federating several devteam installs.
- Making links log objects. The registry is configuration in `settings.md`; see §7 for how the loop maintains it.

## 3. Settings shape

Everything lives in the existing `json devteam` block in `project/settings.md`.

```json
{
  "links": {
    "console": {
      "kind": "repo",
      "title": "Electron desktop app",
      "path": "../console",
      "remote": "usbclub/console",
      "main_branch": "main",
      "forge": "github",
      "merge_method": "squash",
      "gates": { "test": "npm test" },
      "worktree_setup": "npm ci",
      "worktree_files": [".env"],
      "ignored_checks": [],
      "release": "tag",
      "project": "docs/devteam/project"
    },
    "figma-companion": {
      "kind": "url",
      "title": "Companion app designs",
      "url": "https://www.figma.com/design/…",
      "for": ["component:companion", "goal:g-app-store"],
      "notes": "source of truth for spacing and type; ignore the 'old' page",
      "source": "o-…"
    }
  },
  "components": {
    "api":     { "link": "home", "owns": ["app/**", "lib/**", "db/**", "test/**", "config/*.yml", "config/environments/**", "config/initializers/**", "bin/**", "Gemfile*"] },
    "routes":  { "link": "home", "owns": ["config/routes.rb"], "shared": true },
    "console": { "link": "console" }
  }
}
```

### 3.1 Links

- **The id** is a slug. `home` and `devteam` are reserved. `home` is always the repo that holds the kit and `project/`, and it is never declared.
  - An existing project whose ticket ids already use `home-` or `devteam-` as a component prefix gets one `validate` error naming the tickets and the rename. This is the single G1 exception, and it only fires for a project already using those slugs. Rev 2.2: only live tickets count (not superseded, not merged), so the prescribed supersede clears it; `ticket add` and `ticket set` refuse `home` and `devteam` as a component and name the reserved list.
- **`kind`** is required. v1 kinds are `repo` and `url`. An unknown kind is a `validate` error naming the known kinds.
- **`LINK_KINDS`.** Every per-kind behaviour lives in one table:
  - `fields`: required and optional;
  - `ownerClass(field)`: which owner class guards each field (§3.4);
  - `localOverrides`: fields an untracked machine-local file may set (§3.5);
  - `hostsComponents`;
  - `effectiveSettings(link, project)`;
  - `reachable(link)`: the tick-time check;
  - `promptLine(link)`: how it renders in a worker's prompt.

  A new kind (`doc`, `dataset`, `mcp`) is one table entry, with no schema rewrite and no inherited repo semantics.
- **Common fields:**
  - `title` (required);
  - `notes` (optional, what a worker should know about using it);
  - `for` (optional scopes, using the one scope grammar of §7.1);
  - `source` (optional, the id of the observation or message it came from).

  With `for` absent, a link reaches a prompt only through a ticket's or feature's own `links`.
- **`repo` fields:**
  - `remote` (required) is the repo's identity: `owner/name` for github, or any git URL for forge `git`.
  - `path` (optional, default `../<id>` relative to home's main checkout) is where the checkout is on this machine. It's a default, never an identity (§3.5).
  - `main_branch`, `forge`, `merge_method` and `release` are optional; when absent they take the project's value.
  - `gates`, `worktree_setup`, `worktree_files` and `ignored_checks` are optional and **never inherited**. Absent means empty, so `merge` refuses a repo with no gates exactly as it refuses home today. Rev 1 let a sibling repo inherit home's path-filtered gates and merge with none of them running. Any per-repo key added later gets the no-inherit rule by default.
  - `project` (default `docs/devteam/project`): where that repo carries ticket records (§5.3).
- **`url` fields:** `url` (required, `https://` only). Optional `check: false` turns off the reachability probe for pages behind auth the fleet can't pass.
- **Field types (rev 2.2).** Every field has one type (string, list of strings, boolean, object). `link add|set` parse a value by it, never by JSON coercion, and `validate` checks it.
- **No credentials (rev 2.2).** A `url`, or a `remote` on http(s), with userinfo (`user:pass@` or a bare token), or any remote with a password, is a `validate` error, refused by `link add|set`, `observe-link` and an inline `ask --links` item (rev 2.4), and at landing. Any message that echoes a URL or remote strips userinfo first, up to the last `@` before the host (rev 2.3): fix hints, locators, prompts, `links` (home's origin included), `settings`, a question's links, and the url of a hand-written observation in `orient`'s proposed `ask` (rev 2.4).
- **Validity:**
  - A repo link whose `remote` equals home's, or whose path resolves to home's checkout, is a `validate` error.
  - So are two repo links with the same `remote`.

### 3.2 Components

- **The id** is a slug, and a ticket's `component` must name one once any component is declared. Ticket ids keep the `<component>-<NN>-<slug>` form.
- **`link`** (default `home`) must name a link whose kind `hostsComponents` (v1: `repo`).
- **`owns`** is a list of globs relative to that repo's root, using the kit's existing glob syntax (`globToRegex`). Negations are refused. The `**` default and its rule are in §4.
  - **Reserved for later:** an object entry `{ "link": "<id>", "glob": "…" }`, so a component can span two repos additively. v1 `validate` refuses object entries with "reserved".
- **`shared: true`** marks files many components touch, such as a router or a types package. Shared components are ordinary for coverage, with extra planning rules (§6.2).
- **`release`** (optional, reserved shape `{ "tag": "<glob>" }`, e.g. `"web/v*"`) gives a monorepo deployable its own release tags. When absent, the component uses its repo's `release`. `releasedIn(sha, { repo, pattern })` reads it (§5.5).
- **`root`** is not a field; `owns` says it. A monorepo app is `{ "link": "home", "owns": ["apps/web/**"] }`.

### 3.3 Resolution and defaults

- **No `components` declared:** one implicit component per repo link owns `**` minus `devteam`. Tickets may then name any component slug, as today.
- **No `links` declared:** only `home` exists, and every ticket is in `home`.
- **Per-repo keys** are exactly `main_branch`, `forge`, `merge_method`, `release`, `gates`, `worktree_setup`, `worktree_files`, `ignored_checks` and `project`. Everything else (`max_active_*`, `tmux_session`, `dashboard_port`, timings, `components`, `agent_command`…) is fleet-level and never per link.
- **`home`'s effective settings** are the project values themselves. Existing projects keep `gates` and the rest at top level, and nothing moves.

### 3.4 Who owns which entries

`OWNER_SETTINGS` classifies whole top-level keys today. It gains per-entry rules for `links`, read from `LINK_KINDS[kind].ownerClass`:

| Change | Class |
|---|---|
| add or remove a `repo` link; change any of its fields but `path` and the four below (`remote`, `main_branch`, `forge`, `merge_method`, `release`, `project`, and the common `title`, `notes`, `for`, `source`) | `governance-edit` |
| change a `repo` link's `gates`, `worktree_setup`, `worktree_files` or `ignored_checks` | `gate-change` |
| a `repo` link's `path` | nobody's (a fact about this machine, §3.5) |
| anything on a `url` link | `registry-edit`: the supervisor's, a constitutional class (§7). `merge` lands it only as a `registry-edit` act wrote it (rev 2.3): each url link whose entry on main differs from the entry that would land needs an act naming `link:<id>` whose `entry_hash` (sha256 of the entry's canonical JSON, `null` for a removal) equals the landing entry. A removal also needs the act's `prior_hash` (the entry `link rm` removed, rev 2.4) to equal main's entry, so an rm of an earlier entry never removes a link added again since; a removal act without `prior_hash` never matches. No time window, so an unrelated settings landing expires nothing; a link already as main has it needs no act; an act for one value never covers another; an act without `entry_hash` (written before rev 2.3) never matches. Rev 2.2 matched any act naming the link since `settings.md` last changed on main, against the base-to-head diff |
| anything in `components` | the supervisor's (as today); coverage (§4) must pass |

- **Kind flips and removals.** An entry is classified by the union of both sides. If it's a `repo` link on main or at head (or present on only one side as a repo), every change to it is the owner's. A `repo`→`url` flip is a repo removal.
- **Diffing.** `ownerSettingsChanged(base, head)` becomes an entry-level diff returning e.g. `{ key: "links.console.gates", cls: "gate-change" }`. `merge` asks for `--approved <qid>` of that class as today.
- **What `loadSettings` reads:**
  - It takes every repo link from main verbatim; a working-tree removal or kind flip is ignored, with the existing warning.
  - It drops any working-tree repo link not on main.
  - It reads url links and `components` from the working tree, so a new url link reaches the next prompt and lands with the next chore PR. Enforcement never reads that copy (§4, "Which settings decide").
- **Residual power, stated plainly.** `components.<c>.link` lets the supervisor move a component, and so its future tickets, between two owner-approved repos. That is the same order of power it has over `touches` today, and every move is a logged act.

### 3.5 Machine-local paths

- **Where a checkout is:** `path` is a fact about this machine, so it's never owner-classed. A link's location resolves, in order, from:
  1. `--path` on the command;
  2. `run/links.local.json` (untracked, `{ "<id>": { "path": "…" } }`; `LINK_KINDS.repo.localOverrides = ["path"]`);
  3. the committed `path`;
  4. `../<id>`.
- **Verification:** `repo(id)` checks that the checkout's `origin` matches `remote`, and refuses with one clear message otherwise.
- **Moving machines:** `fleet status` lists each repo link with its resolved path, and the move checklist names each one.
- **Elsewhere:** a run from another checkout of the repo (a CI job, say) passes `--path <checkout>` (§5.4).

## 4. Coverage: no part of a codebase can be left out

**One tree reader.** `treePaths(repo, ref)` is `git ls-tree -r -z --name-only <ref>`. It reads a commit's tree, never the index or the working tree. It includes dotfiles, dot-directories and submodule gitlinks (matched by path), handles spaces and non-ASCII paths, and treats symlinks as paths without following them. `changedFiles` switches to `git diff -z --name-only --no-renames`, so the four enforcement points below see byte-identical paths (rev 1 compared quoted octal paths from `diff` against raw ones from `ls-files`).

**The kit's own files have an implicit owner.** The reserved component `devteam` is computed, never declared. Its line is `kitRel/**` ∪ `projectRel/**` in `home`, and `projectRel/**` in every other repo link. `projectRel` is computed, so a project moved with `--project` or `DEVTEAM_PROJECT` is still covered. Harness runtime files are gitignored (upstream #91) and never appear in a tree.

**Invariant C.** For every repo link with declared components, every path in `treePaths(repo, ref) − devteam` matches exactly one declared component's `owns`. A path matching none is *unowned*; a path matching two is *contested*. Both are errors. Rev 2.2: `devteam`'s line is subtracted before any component is asked, so a declared glob reaching into it (`docs/**` beside `docs/devteam/**`) claims nothing there and contests nothing; it was an error in rev 2.1.

- **The `**` default.** A component with no `owns` owns every path of its repo that `devteam` doesn't. That is allowed only while it is the only declared component on that repo; adding a second one without `owns` is an error naming both.
- **No opt-out.** There is no ignore list and no catch-all or "rest" component. Vendored or generated folders belong to a component like anything else (a `vendor` component is fine); leaving them out is a visible choice.
- **Consequence:** once components are declared, no ticket can change `docs/devteam/**` except its own `tickets/<id>/` records (point 4). Kit upgrades are chores, as today. The kit's own repo therefore can't declare components, and `validate` says so.
- **Glob discipline:**
  - An `owns` glob matching no path is a `line-empty` **warning** with its fix (rev 2.2; an error in rev 2.1). It catches typos, but it excludes nothing, so Invariant C holds with it: it never refuses a PR (deleting the last file under a glob lands) and never blocks a ticket. It still counts as a Baseline floor gap (§9a).
  - Negation patterns are refused.
  - Matching is case-sensitive on every platform.
  - Two tracked paths that differ only by case come back as `case_collisions` and are a `validate` error on that repo (they break checkouts on macOS and Windows).

**One pure function, four enforcement points:** `coverage(paths, components, devteamLine) → { unowned, contested: [[path, [c1, c2]]], empty: [glob], case_collisions: [[a, b]] }`.

**Which settings decide.** Every point reads components from committed settings, never the working tree (rev 1 let `merge` judge a worker's PR against the supervisor's uncommitted lines). Rev 2.2 makes the rule exact:
- a **ticket** PR, and any PR that leaves `settings.md` alone: home main's settings. A ticket can never change `settings.md` (it's in `devteam`'s line), so its head's settings never decide.
- a **plan or chore** PR that changes `settings.md`: the settings that would land (the head's when main's `settings.md` hasn't moved since the branch left it, else the merge's). `check-pr` and `merge` also run `registryProblems` on them, so a bad registry is refused at landing whatever the PR kind.
  - **Without lines (rev 2.3).** When neither main nor the head declares lines, "the merge's" settings are read from `settings.md` itself, never from a merged tree: base, head and main by `git show`, merged key by key and `links` entry by entry (a key the head left as the base had it is main's, else the head's). A top-level key or `links` entry that both main and the head changed since the base, to different values, is refused at check-pr and merge alike (rev 2.4): "settings.md: both main and this branch changed <key>; merge main into the branch first". Git's text merge could combine the two into an entry no act wrote, or conflict; the same change on both sides lands. Only coverage needs the landing tree, so a project with url links and no lines needs no git 2.38.
  - **Fresh main (rev 2.3).** `check-pr` and `merge` fetch main, and drop every ref and memo read from the old one, before judging, so a push to main from another clone is in the landing tree, the settings in force and the act check. A fetch that fails refuses the run, `merge --dry-run` included (rev 2.4): "could not fetch origin main: <git's error>; refusing to judge against a stale main".
- **`validate`** uses the same rule: main's tree under main's settings, except in a chore context (a `chore-<slug>` checkout whose head changes `settings.md`), where it is that chore's landing tree under its landing settings.

1. **`validate`** (on demand, and in `check-pr` for `plan/` branches as today) checks each repo's main tree against the components in force. Output is grouped by directory, with a suggested owner where a sibling path is owned.
2. **`check-pr` and `merge`, for every PR in every repo.**
   - **Which tree:** the tree that would land: `git merge-tree --write-tree origin/<main> <sha>` on **every** forge (rev 2.2). Rev 2.1 took the head on forge `github` because `BEHIND` is refused, but GitHub reports `BEHIND` only under "require branches to be up to date", and without it a behind PR lands by 3-way merge.
     - A conflict is refused as "does not merge cleanly". A git that can't compute it (older than 2.38, or any git error that isn't a conflict) **fails closed** with its own message ("coverage needs git ≥ 2.38 (merge-tree --write-tree); found X"). A tree git can't read is an error, never an empty tree.
     - With no lines declared on main or at the head, none of this runs: no tree is read and nothing is merged (G1).
   - **What fails:** a PR that adds an unowned path, renames files out of every line, or narrows a glob. Each refusal names its fix: unowned (extend a line), contested (both globs; narrow one), case (rename one), unlinked.
   - **Chore and settings PRs** get `coverage()` only, and only when components are declared. They never get full `validate`, so an unrelated pre-existing validate error can't block a log or retro PR in a single-repo project.
   - **At the forge:** nothing. The kit installs no forge workflow (upstream #102); `merge` is where the check is enforced, and a PR merged with the forge's own button skips it until `observe-metrics` (point 3) finds the gap.
3. **`observe-metrics`** checks every repo's main each tick. This covers commits that bypass devteam, such as a person pushing to main. A gap becomes an `unowned-files` finding at severity 4. `ready` and `worker` refuse new tickets in that repo until it clears, with a message pointing at the fix: a chore PR that extends a line.
4. **Ticket footprint.** `check-ticket` refuses a changed file unless:
   - it matches the ticket's `touches`;
   - it matches the ticket's component's `owns`, or one of its `touches_components` (§6.2);
   - or it lies under `R.projectRel/tickets/<id>/`. That folder is the only part of `devteam`'s line a ticket may write; today's exception is kept.

## 5. Running tickets in other repos

### 5.1 One repo abstraction

**`repo(name)` is a memoized object, not a parameter threaded through helpers.**

```js
repo(name = 'home') → {
  name, root /* main checkout on this machine */, commonDir, remote, settings /* effective, §3.3 */,
  projectRel, projectInRepo,
  mainRef(), resolveCommit(ref), changedFiles(base, sha), treePaths(ref), mergeTree(base, sha),
  git(args), gh(args) /* -R <remote> for a repo link; home's as before */, caches /* per repo */
}
repoOfTicket(t) → repo(component(t.component).link)
```

**The nine module-level constants.** These are computed from the cwd at load today (`devteam.mjs` lines 156–168 on this branch): `repoRoot`, `devteamDir`, `commonDir`, `mainRoot`, `projectDir`, `runDir`, `projectRel`, `projectInRepo`, `kitDir`. Each gets a defined owner:

| Constant | Becomes |
|---|---|
| `kitDir` | unchanged: the running kit (rules, schema, dashboard) |
| `mainRoot`, `commonDir`, `projectDir`, `projectRel`, `projectInRepo`, `runDir` | **home's**, resolved from `DEVTEAM_HOME`, else from the script's own location, never from the cwd; module aliases of `repo('home')` |
| `repoRoot`, `devteamDir` | the checkout the command runs in. Used only to find "the ticket I'm in" (a worker's `ticket/<id>` worktree, from `git -C . rev-parse --git-common-dir` matched against the repo links). Records are read through `repoOfTicket`, never through `devteamDir` |

- **`DEVTEAM_HOME` validation.** It must be a checkout with `docs/devteam/project`, and must not be a repo link's checkout. Anything else is refused loudly (devteam-ae's guard), never followed, so a stale env var can't run against the wrong live log.
- **The re-exec is unchanged.** devteam-ae's top-of-file re-exec resolves from the script's own location, so it already does the right thing. Rev 1's claim that it needed `DEVTEAM_HOME` was wrong.
- **Per-repo caches.** `mainRefCache`, `mergeShaCache`, `mergedAtCache`, `mergeParentsCache`, `mainLogCache` and the `refCommits` map move onto the repo object. Home's stay where they are, as home's.
- **Single-repo projects.** Every module-level helper keeps its signature as `home.*`, so their call sites don't change.
- **`repo()` fails fast** with one clear message when a link's checkout is missing or its `origin` doesn't match `remote`. `link-unreachable` covers the same thing at tick time.

**Call sites that change to `repoOfTicket(t)` or `repo(link)`.** The plan pins each one by function:
- worker and planner launch (`makeSession`: worktree add, base branch, fetch);
- `seedWorktree` and `gateEnv` (`DEVTEAM_MAIN` becomes the ticket repo's root, plus `DEVTEAM_HOME`);
- `missingPins(root)`;
- `detachedWorktree`;
- `review-worktree` and `review-worktree --remove` (checked against the owning repo's worktree list);
- `checkTicket`, `checkPr` and `cmdCheckPr` (`--repo`);
- `cmdMerge`: PR lookup, fetch, gates, landing, both forges;
- `mergeShaFor`, `mergedAt`, `ticketBranchRef` and `releasedIn`;
- every `gh` call, through `repo.gh`, which passes `-R` for a repo link (home's calls stay as they were, so gh resolves home as it always has);
- `fleet status`, `unpushedBranches` and open-PR listing, per repo;
- handoff files (in the ticket repo's project folder);
- the dashboard's ticket views and review pages;
- `stop-ok`.

`home` keeps everything that is the fleet's own: the live log in `run/`, `project/` (log, designs, goals, questions, settings, retros), the dashboard server, chores, `log-sync`, spend and pane checks, and the supervisor's checkout.

### 5.2 Worktrees and the kit

- **Worker, planner, review and gate worktrees all live at `home/.worktrees/<name>`,** made with `repo.git(['worktree', 'add', …])` from the ticket's repo. One directory holds every session.
- **Where a sibling's worktrees are.** `merge`'s throwaway checkouts of another repo (gate, ratchet base, landing) and a sibling measure's are made in the OS temp folder (`devteam-<repo>-*`, as `secret post` makes its own), never under home's tree, so a gate can't pass on home's `node_modules`, `.tool-versions` or lint and ts configs found by walking up. Worker and review worktrees stay under home's `.worktrees/` (fleet status, strays, `worker --remove` and the prompts all find them there); the risk that a tool walking up finds home's copy there is the README's to state, and the gates at merge are the check.
- **A worktree's repo is computed, not recorded:** `git -C <wt> rev-parse --git-common-dir`, matched to a repo link. Fleet park, status and unpark use it to check "pushed, clean, handoff" against the right remote.
- **A worker in another repo's worktree runs home's kit by absolute path,** with `DEVTEAM_HOME` and `DEVTEAM_RUN` in its env, as `makeSession` already does for `DEVTEAM_RUN`.
- **`seedWorktree` uses the ticket repo's settings:**
  - its `worktree_files`, copied from that repo's main checkout;
  - its `worktree_setup`, run with `DEVTEAM_MAIN` set to that repo's root, plus `DEVTEAM_HOME`;
  - and, on failure, `pinsHint(missingPins(repo.root))`.

### 5.3 Ticket records travel with the code

- A ticket in repo R keeps `tickets/<id>/` (spec, plan, verification, reviews, questions, handoff) under `R.projectRel`, committed on its `ticket/<id>` branch in R and merged with its code. The PR head therefore carries the code and its evidence, and every existing exact-head rule (`verdictHolds`, the final review tracks, verification rows) is unchanged. Reads simply use `{ repo: R, ref: sha }`.
- R's project folder holds only `tickets/`. Its `settings.md`, log, designs and the rest stay in home. `validate` reports any other path under R's project folder.
- The dashboard and every reader of ticket records (`srcRead`, `srcList`, `ticketReviews`, review pages) resolve a ticket's records through `repoOfTicket`.
- A ticket in `home` is exactly today's layout.

### 5.4 Merge, gates and forge checks

- **`merge <id>`** fetches the PR in the ticket's repo using that repo's forge. It runs `checkPr` there, runs the repo's gates (with their `paths` filters) in a detached worktree of that repo at the exact sha, and merges with that repo's `merge_method` and `--match-head-commit` (or the forge-`git` path). The `act` and `gate` lines land in home's live log as today, plus a `repo` field on gate lines.
- **Plan and chore PRs are always home's.** A chore that must change another repo is a ticket of kind `chore` in that repo's component, under the Upkeep goal.
- **No forge workflow (upstream #102, the owner's decision).** The kit installs no workflow in home or in any repo link; `merge` runs the checks. `check-pr --repo <link> [--path <checkout>]` stays as a command: the same checks for a PR in another repo, minus the gates and the supervisor's approval acts, from that repo's checkout or the one `--path` names. (Rev 2 had `init --github --repo <link>` write a two-checkout workflow; dropped with #102.)

### 5.5 Releases

`release` is per repo, with an optional per-component tag pattern (§3.2). Release, staging and production acts name their repo, and `releasedIn(sha, { repo, pattern })` reads that repo's tags matching the pattern (default: today's). A feature's release is reached when every ticket's merge is in a release of its own repo and component.

## 6. Planning and validation

### 6.1 One repo per ticket

- **Containment rule in `validate`.** Each `touches` entry's static prefix (the part before its first wildcard) must be matched by the ticket's component's `owns` (or a `touches_components` member's) and by no other component's. An entry with no static prefix (`**/*.rb`) is an error once components are declared. So every ticket's footprint is in one repo.
- **Footprint at merge.** `check-ticket` (§4, point 4) is authoritative: it checks the real changed files, whatever the globs claimed.
- `validate` also errors on a ticket whose component's link doesn't host components.

### 6.2 Cross-component and cross-repo work

- **Within one repo**, a `contract` or `integration` ticket may list `touches_components: [c1, c2]`, a new optional ticket field. Its `touches` may then fall in any of those components' lines. This replaces the doc's informal "contract tickets may span two". It is the only way to touch a `shared` component, besides that component's own tickets.
- **Across repos**, there are no multi-repo tickets. A cross-repo contract is a `contract` ticket in the provider's repo (the definition, its version, and a fake or recorded fixtures), plus in each consumer repo a ticket that `depends_on` it and vendors the fake. `planning.md` D2 gains this rule. `merge` and `check-pr` refuse a ticket whose `depends_on` hasn't merged, in any repo; this applies to home's tickets too, so a single-repo project's merge now waits for its dependencies (before, a dependency only kept a ticket out of `ready`). `metrics` raises `merged-out-of-order` for a ticket that reached its main before a dependency, only for merges after the kit with that finding reached home's main (the first commit there whose kit script names it), so an existing project's history raises nothing. `validate --strict` errors on a story whose integration ticket would need two repos; it must be split per repo, with the end-to-end check in the ticket that lands last.
- **Scheduling.** `max_active_per_component` keeps working per component. The overlap rule for `touches` in flight (`globsOverlap`) is checked only between tickets in the same repo.

### 6.3 Links in planning and prompts

- Tickets and features gain an optional `links: [linkId]` field. `validate` errors on an unknown id.
- A worker's or planner's prompt gets a **Links** block: every link whose `for` matches the ticket's component, feature or goal, plus `all`, plus the ticket's own `links`. Each entry gives title, kind, locator and notes. The block uses the same assembly path as `knowledgeBlock`. Repo links appear with their `remote` and local `path`, for read-only reference to sibling code.
- Question `links` items accept `{ "title": "…", "link": "<id>" }` alongside `path` and `url`. The dashboard resolves it.
- Designs cite links as `link:<id>` in text. `validate` checks that cited ids exist, the same way it checks design citations.

## 7. The loop maintains the registry (OODA)

The registry is configuration, but the loop watches it and edits it.

- **Observe.**
  - When the owner gives a resource anywhere the supervisor hears it (the terminal, `send --owner`, a question answer, a goal interview), the supervisor logs an observation of kind `link`. It carries the URL or path, what the owner called it, and what it seemed to be for.
  - Workers log the same kind when they come across a resource the work depends on, such as a design cited in a PR or a runbook.
  - A new command, `observe-link --url <u> --title <t> [--for <scope>] [--notes <n>]`, writes it with the right fields.
- **Orient.** `orient` folds `link` observations:
  - a URL already in the registry becomes a proposed edit: better title, wider `for`, new notes;
  - two links for the same scope that contradict each other become a question about which is the source of truth;
  - a fresh URL becomes a proposed addition, with an id `link add` accepts (slugified, a letter first, never reserved, unique; rev 2.2);
  - a path observation becomes a proposed `knowledge add --kind pointer` (rev 2.2; no v1 link kind holds a file in this repo);
  - every value in a proposed command is single-quoted (`'` as `'\''`), since observation text is anyone's and the supervisor pastes the command (rev 2.2);
  - a decision or act citing an observation dismisses its proposal for good (`decide --class registry-edit --refs <o> -- "<why>"`; rev 2.2).
- **Decide and act.**
  - **For a `url` link,** the supervisor applies the edit with `link add|set|rm <id> …`, a new command that writes the working-tree settings, validates, and logs the act. This is **`registry-edit`**, a **constitutional** class, because url links are the supervisor's (§3.4), as `components` are today. It is a logged act that needs no rung and no owner answer. The act cites the observation, and the link's `source` records it. The owner can correct it like any act; a correction becomes a lesson in knowledge (scoped `link:<id>`), not a trust drop, since there's no delegated authority to take back. If Hugh later wants trust semantics here, it becomes a ladder class at start 3, ceiling 3, and moves table rows in `constitution.md`.
  - **For a `repo` link,** the supervisor drafts the entry and asks a `governance-edit` question with the draft. The owner's chat message names the repo but is never the approval.
  - The supervisor's next chore PR lands working-tree registry edits on main.
- **Findings** (in `observe-metrics`, once a day per finding, like the others):

  | Finding | Severity | Meaning |
  |---|---|---|
  | `link-unreachable` | 3 | A repo `path` is missing or isn't a checkout of `remote`; `remote` doesn't resolve; or a `url` link returns 4xx or 5xx to one `HEAD` request (10 s timeout, no body read, once a day per link). The probe only checks the link still exists; nothing is fetched, consistent with the non-goal. Opt-out per link with `"check": false`. Tests stub it. Rev 2.2: probes run four at a time inside a 20 s budget per tick; one the budget cuts short or never starts is "not probed this tick", no finding, and is asked next tick. `git ls-remote` never prompts (`GIT_TERMINAL_PROMPT=0`, empty askpass, ssh batch mode, no controlling terminal). |
  | `link-behind-auth` | 1 | Rev 2.2: a `url` link answered 401, 403 or 405: it exists behind auth. A note, never a finding that wakes `wait`. |
  | `line-empty` | 1 | Rev 2.2: an `owns` glob on main matches nothing (§4). Blocks nothing. |
  | `unowned-files` | 4 | §4.3. Blocks new tickets in that repo. |
  | `line-pressure` | 2 | In the last 14 days, footprint refusals on three or more distinct tickets on one component (rev 2.2: tickets, not heads or dry runs), or three or more tickets planned against a `shared` component: a sign a line is drawn in the wrong place. |

- **Knowledge.** Lessons and rules take a `link:<id>` scope, so an accepted lesson such as "console tests need Node 16 and `--no-threads`" reaches every prompt whose links or component include it.

### 7.1 One scope grammar

Knowledge scopes (`project`, `component:`, `feature:`, `class:`) and link `for` scopes (`all`, `component:`, `feature:`, `goal:`) go through one `scopeMatches(scope, ctx)`, where `ctx = { component, feature, goals, links, class }`. `link:<id>` joins both. Later scopes (`repo:<id>`, `kind:<k>`) are each one table entry. `all` and `project` mean the same and both stay accepted.

## 8. Commands

| Command | What it does |
|---|---|
| `links [--json]` | The registry, effective settings per repo, and the components on each, with their coverage state. |
| `link add <id> --kind url --url … --title … [--for …] [--notes …] [--source …]` | Supervisor-only. Writes the working-tree settings, validates, logs `registry-edit`. |
| `link add <id> --kind repo --path … --remote … [overrides]` | Drafts the entry and asks the owner the `governance-edit` question. It doesn't write settings until answered (`--approved <qid>` applies it). The question carries the full settings diff it approves: every repo link entry `settings.md` here would land differently from main, this one included (one answer may approve a bundle). `--approved` logs one act per entry, with `entry_hash` (the entry that lands) and `prior_hash` (main's), and `merge --approved <qid>` binds every repo link entry the PR changes to such an act of that answer; any other is refused by name. |
| `link set <id> <field> <value>` and `link rm <id>` | As above, with the class of the field changed. `link rm` refuses while a live ticket, a feature or a design cites the link, and names them (rev 2.2). |
| `worker <id>` (deny rules) | The worker's policy file is per session; a push rule naming `main` also names the main branch of the ticket's repo. `metrics` raises `merged-without-merge` for a merge on any repo's main with no merge act, counted only after the upgrade. |
| `components check [--repo <link>] [--ref <ref>]` | Runs `coverage()` and prints unowned, contested and empty-glob results. Exits 1 on any. |
| `observe-link …` | §7. |
| `check-pr --repo <link> [--path <checkout>]` | §5.4. |

Every existing command keeps its arguments. Where a ticket implies a repo, the command uses it. `--repo <link>` is accepted wherever a command takes a ref.

## 9. Adoption and the Baseline goal

Hugh asked for this on 2026-11-04, relayed by devteam-ae.

- **README setup step 4** ("Fill `project/settings.md`") gains seeding the registry. Sibling repos become `repo` links; design files and docs (Figma, specs, Notion) become `url` links. The adopting agent infers what it can from git remotes, links in the README and docs, and package manifests. It asks the owner the rest in the same one batch as the other settings.
- **README step 7 and `process/planning.md` §7 (Baseline)** gain a precondition: **the registry is complete**. It has two parts:
  - **(a) Repo-checkable floor gaps**, counted like the gates and part of the Baseline measure:
    - tracked files owned by no component;
    - tracked files owned by more than one;
    - components whose `link` doesn't resolve to a `repo` link;
    - `owns` globs that match nothing.

    `components check --count` prints the total for the measure.
  - **(b) An owner-attested precondition:** "Does the registry list every repo, design file and doc this project depends on?" Only the owner knows what's missing, so it's a question, not a count. It lines up with devteam-ae's in-flight measure-sources change, where an owner source is a `goal-met` question. Whichever change lands second wires (b) to that source; until then it's a plain owner question that `goal-readiness` waits on.
- **Extension point for measure-sources:** a goal measure with a repo source names the link it runs in, defaulting to `home`. Whichever PR lands second adds that field.

## 10. Docs

- **README.** A "Links, components and other repos" section covering the three project shapes with minimal settings for each, plus the setup checklist items: sibling checkouts laid out as `path` says, and `DEVTEAM_HOME_TOKEN` for private homes.
- **governance/quality.md:** invariant C and the footprint rule as gates. Owner classes per link field.
- **governance/constitution.md:** `registry-edit` in the `constitutional` list.
- **process/planning.md:**
  - D2, cross-repo contracts;
  - D7, integration per repo;
  - `touches_components`;
  - `links` on tickets and features;
  - drawing component lines in `architecture.md`.
- **process/supervisor.md:** the link loop (§7), the new findings, and that `merge` works per repo.
- **process/worker.md:**
  - the Links block;
  - logging `observe-link`;
  - working in another repo's worktree, with home's kit and records in that repo's project folder.
- **schema/log.schema.json:**
  - ticket and feature `links` and `touches_components`;
  - an optional `repo` field on gate and act lines;
  - observation kind `link`;
  - knowledge scope `link:`.

## 11. Delivery

Two PRs, in order. Each is green on its own, and each gets its own release notes (What, Why, Migration).

- **PR 1, "Links and component lines":**
  - §3, §4, §6.1, §6.3, §7, §8 (except `--repo` flags and repo-link adds), §9, and the matching docs;
  - repo links are accepted in settings and validated, but only `home` can host tickets.
  - Migration: none. A single repo is unchanged; a monorepo opts in by declaring components.
- **PR 2, "Components in other repos":** §5, §6.2 (cross-repo), `--repo` flags, repo-link `link add`, and the docs. Migration: none for existing projects.

## 12. Testing

Tests go in `test/kit.test.mjs` with fixtures under `test/fixtures/`, run on Node 18, 20, 22 and 24 as CI does.

- **Coverage function (pure):**
  - table tests for unowned, contested and empty globs, dotfiles, nested dot-directories, submodule gitlinks, spaces and unicode, symlink paths, case-only collisions;
  - a property test that generates random trees and random disjoint or overlapping line sets, and asserts the function reports a clean partition exactly when there is one.
- **Settings:**
  - entry-level owner diff (repo-link field changes produce the right classes, url-link edits produce none);
  - G1: a fixture single-repo project with no new settings gives the same `validate`, `status`, `check-ticket` and other output before and after, checked against recorded goldens. The goldens were re-recorded twice, each for one line: a non-ASCII path printed raw rather than as git's quoted octal (check-ticket, merge --dry-run; a fix in this change), and the hub in fleet-status's move checklist (upstream).
- **Monorepo fixture:**
  - a PR adding a new top-level folder fails `check-pr`;
  - a rename out of a line fails;
  - a narrowed glob fails;
  - a ticket touching another component's file fails its footprint;
  - a contract ticket with `touches_components` passes;
  - `unowned-files` blocks `ready`.
- **Sibling-repo fixture.** Three local bare remotes plus checkouts, with forge `git` so no GitHub is needed:
  - a worker worktree is made from the sibling repo under `home/.worktrees`;
  - ticket records are read from the sibling at the exact head;
  - gates run in the sibling;
  - `merge` lands on the sibling's main;
  - act and gate lines land in home's log;
  - `fleet status` checks the sibling remote.
- **Links:**
  - unknown kind and unknown link id errors;
  - the prompt Links block selects by `for` scope and ticket links;
  - `link add` url as the supervisor writes settings and logs `registry-edit`;
  - `link add` repo asks a `governance-edit` question and writes nothing until it's answered;
  - `link-unreachable` for a missing path. URL reachability is stubbed; tests never touch the network.
- **Regression tests from the rev 1 review:**
  - an ordinary ticket whose PR includes its own `tickets/<id>/` records passes footprint (B1);
  - a sole component with no `owns` on a repo that has a `projectRel` passes coverage (B2);
  - `registry-edit` acts without a rung or an answer (B3);
  - `merge` judges components from committed settings, so a working-tree widening has no effect (M1);
  - a working-tree url→repo or repo→url kind flip, and a repo-link removal, are ignored and pinned to main (M2);
  - a sibling repo with no `gates` is refused by `merge`, even when home's gates are path-filtered (M3);
  - a non-ASCII filename (`app/é.rb`) is owned at all four points, and a staged but uncommitted file doesn't count (M4);
  - forge-`git` coverage runs on the merge-tree result: a line narrowed on main plus a stale branch adding a path is refused (M5);
  - a worker in a sibling worktree resolves home's run directory and project, and records read from the sibling at the head (M6);
  - `mainRef` of two repos are distinct, with no cache bleed (M7);
  - `review-worktree --remove` of a sibling review worktree (M8);
  - `--path` and `run/links.local.json` override the committed `path`, and an `origin` mismatch is refused (M9);
  - a chore PR in a single-repo project with a pre-existing validate error still passes `check-pr` (M10);
  - a reserved `home-`/`devteam-` ticket prefix is reported (m1);
  - an object `owns` entry is refused as reserved (extensibility 3).
- **Rev 2.2 (PR 1 review):** no-lines installs do no tree work; a behind PR on forge `github` is judged on the merge; an old git fails closed with its own message; `coverage` of 50k paths × 30 globs stays under 500 ms; a hand-edited url link is refused at `merge` without its act; a bad registry is refused at landing; ticket PRs are judged by main's settings; deleting the last file under a glob lands; reserved names clear on supersede; orient's commands round-trip through `sh` unchanged; a token in an origin never reaches the log; probes run four at a time inside the budget, and 403 is a note.
