# Public artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner can make a landed artifact readable by anyone, with no sign-in, at `https://public.<box>/<project>/<slug>/`, by confirming on the cloud gateway's own page; the kit records each publish and unpublish as an owner `act` of class `artifact-publish`.

**Architecture:**
- The kit (`docs/devteam/scripts/devteam.mjs`) gains an owner-only act class, `artifact publish|unpublish|manifest` subcommands, a loopback-only `GET /public-manifest/<slug>` route and an `artifact-publish` dashboard action; its Library rows carry `tree` and `published`. Readers of acts that assume the supervisor wrote them skip owner acts.
- The gateway (`cloud/gateway.mjs`) fetches the manifest and every file from the instance over loopback, checks each byte against the manifest the owner confirmed and the tree id against the bytes, keeps its own content-addressed copy under `<dir>/public/blobs/`, and serves `public.<box>` from that copy alone, before any check that is about the owner. It tells each dashboard what it serves in an `x-devteam-public` header on `/api/data`.
- The dashboard Library (`docs/devteam/dashboard/index.html`) combines the log's record with that header into one state per landed card, and opens the gateway's confirm pages in a new tab.

**Tech Stack:** Node 18 built-ins only (no dependencies), vanilla browser JS, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-09-public-artifacts-design.md` (approved). Read it before any task.

## Global Constraints

- Node 18.20.4 (`.tool-versions`): nothing newer than Node 18 APIs, built-ins only, no new dependencies, no new files outside tests and this plan. Match the repo's style: dense single-file code, comments that say why, no placeholders.
- Public address: `https://public.<box>/<project>/<slug>/`. `PUBLIC = <scheme>//public.<box>` sits beside `TERM` in the gateway.
- Slugs: `LINK_ID` = `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`. Project names: `^[a-z0-9][a-z0-9._-]{0,62}$`. Tree ids: `^[0-9a-f]{40}([0-9a-f]{24})?$`. sha256: `^[0-9a-f]{64}$`.
- The owner line: `{ "type": "act", "class": "artifact-publish", "what": "publish", "refs": ["artifact:<slug>"], "artifact": "<slug>", "tree": "<tree id>", "by": "owner", "channel": "dashboard" }`; `unpublish` has no `tree`. For each slug the newest line (fold order: `at`, file, line) is its recorded state.
- The gateway never reads the log. The public is served only from `<dir>/public/blobs/<sha256>` and `state.json`'s `public` map: `{ "<project>": { "root", "port", "artifacts": { "<slug>": { "tree", "title", "at", "files": { "<rel>": { "sha256", "size" } } } } } }`.
- Limits: manifest response 2 MB; 15 s deadline for each whole loopback response; at most 2000 files; 8 MB a file, 25 MB an artifact; at most 50 slugs per confirm; `x-devteam-public` at most 32 KB; total public bytes (unique blobs) capped by `DEVTEAM_PUBLIC_MAX`, default 500 MB (524288000).
- Every `/public/*` mutation runs through one in-process queue. Inside it: fetch and verify, write blobs as `<sha256>.<pid>.<random>.tmp` then rename, then load, mutate and save `state.json` with no `await` in between, then sweep blobs the saved state doesn't reference.
- `public.<box>`: `GET` and `HEAD` only (else 405 with `allow: GET, HEAD`), service-worker requests 403, raw path `/<project>/<slug>/<rel>` with `rel` passing the kit's `artifactPathOk`, `/<project>/<slug>` 302 (`cache-control: no-store`) only when published, `/` and `/<project>/` 404. Headers: the gateway's own `content-type` map, `content-length`, `etag: "<sha256>"` (304 on any matching strong tag or `*`), `cache-control: public, max-age=60`, `x-content-type-options: nosniff`, `referrer-policy: no-referrer`, HSTS, and the kit's artifact CSP with `self` = `https://public.<box>/<project>/<slug>/`, `frame-ancestors 'none'` and `sandbox allow-scripts allow-forms allow-modals allow-pointer-lock`. No `set-cookie` ever; the incoming cookie is ignored; nothing on that name talks to an instance.
- Loopback requests from the gateway carry `host: 127.0.0.1:<p>` and no `origin`, `sec-fetch-*` or `cookie` header.
- The confirm pages are the gateway's own (`PAGE_CSP`, `form-action 'none'` stays), every value HTML-escaped, labels from the gateway's own state, the Publish button without autofocus.
- Run tests with Node 18: `NODE=~/.asdf/installs/nodejs/18.20.4/bin/node`. Gateway: `$NODE --test test/gateway.test.mjs` (single tests: `--test-name-pattern "<text>"`, which works for its top-level tests). Kit chain: `$NODE --test --test-concurrency=8 test/kit.test.mjs` (always the whole file: its steps are subtests of one test that share one fixture and run in order, so a name pattern can't pick one step). Dashboard page: `$NODE --test --test-name-pattern "<text>" test/dashboard.test.mjs`.
- Work on branch `public-artifacts`. One commit per task; every commit message ends with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `docs/devteam/schema/log.schema.json` | `act.artifact`, `act.tree`, `x-authority.new.owner` gains `act`, act description | 1 |
| `docs/devteam/governance/constitution.md` | `artifact-publish` in `owner_only`; a sentence in "Three kinds of decision" | 1, 12 |
| `docs/devteam/scripts/devteam.mjs` | `TREE_ID`; `integrity()`; `calls()`, `decisionRecords()`, `collectOoda()`, `cmdCorrect()`; `publicArtifact`, `publicManifest`, `publishRecords`, `publishedView`, `treeIdEntries`; `cmdArtifact` publish/unpublish/manifest; dashboard `run` timeout and exit code, `ACTIONS['artifact-publish']`, `/public-manifest/` route; `landedArtifacts` rows carry `tree`; `dashboardData().library` carries `published` and `public`; `HELP` | 1-5, 12 |
| `cloud/gateway.mjs` | module level: `PUBLIC_TYPES`, `PUBLIC_CDNS`, `publicPathOk`, `publicCsp`, `canonicalJson`, `manifestProblem`, `gitBlobId`, `gitTreeId`, `publicStore`, `asciiJson`, `fmtSize`, pages `publish`, `unpublish`, `publicList`; in `createGateway`: `PUBLIC`/`publicHost`, `servePublic`, `loopback`, `fetchManifest`, `publishItem`, `recordUnpublish`, `publicMap`, the `/public/*` routes, the header | 6-10 |
| `docs/devteam/dashboard/index.html` | `PUBLIC` from the header, the `public-states` block (`publicHere`, `publicState`, `publicLinks`), Library card states, Restore all, Forget | 11 |
| `test/lib/chain.mjs` | five kit steps appended after "artifacts: the Library data" | 1-5 |
| `test/kit.test.mjs` | the five steps join the artifacts fork group | 1-5 |
| `test/gateway.test.mjs` | `on: 'public'` in the request helper, stand-in instances, the gateway tests | 6-10 |
| `test/dashboard.test.mjs` | the Library's publish states, loaded from index.html by themselves | 11 |
| `README.md`, `docs/devteam/process/supervisor.md`, `cloud/Dockerfile`, `docs/superpowers/specs/2026-11-05-artifacts-design.md` | docs | 12 |

Why the kit's chain steps join a fork: the landed artifacts the steps need (`landed-mock`, `landed-other`, `landed-tk`) are pushed to main by "artifacts: the Library data", which runs in a fork (`FORKS` in `test/kit.test.mjs`), so the in-line steps never see them. Steps appended right after it and listed in the same `FORKS` entry run in that fork, in order, after it.

---

## Part A: the kit

### Task 1: The record: an owner act of class artifact-publish (schema, integrity, constitution)

**Files:**
- Modify: `docs/devteam/schema/log.schema.json` (`$defs.types.act` at ~1637-1770, `x-authority.new.owner` at ~1875)
- Modify: `docs/devteam/scripts/devteam.mjs` (`LINK_ID` at ~450, `integrity()` at ~834-863)
- Modify: `docs/devteam/governance/constitution.md` (json block line ~49)
- Test: `test/lib/chain.mjs` (new step at the end of `steps`, after "artifacts: the Library data"), `test/kit.test.mjs` (`FORKS`)

**Interfaces:**
- Produces: `const TREE_ID = /^[0-9a-f]{40}([0-9a-f]{24})?$/` at module level in devteam.mjs, next to `LINK_ID` (used by Tasks 3-4). `integrity()` accepts an owner-created `act` only as `artifact-publish` with `what` in `publish | unpublish`, `artifact` a slug, and `tree` present exactly when `what` is `publish`; refuses any non-owner `artifact-publish` with "artifact-publish is the owner's"; refuses other owner acts with "the owner's acts are artifact-publish only". The schema's `act` has `artifact` and `tree`. `ladder().owner_only` includes `artifact-publish`.

- [ ] **Step 1: Write the failing test**

Append this step to `test/lib/chain.mjs` directly after the `step('artifacts: the Library data, landing, and the prompt lists landed ones in scope', …)` block (before the `// Forks.` comment):

```js
  // Public artifacts: the owner's own act records what the owner made public from the cloud box.
  step("public artifacts: an artifact-publish act is the owner's, and the owner's only act", () => {
    const S = JSON.parse(fs.readFileSync(path.join(kit, 'schema/log.schema.json'), 'utf8'));
    assert.ok(S['x-authority'].new.owner.includes('act'));
    assert.deepEqual([S.$defs.types.act.properties.artifact.pattern, S.$defs.types.act.properties.tree.pattern], ['^[a-z][a-z0-9]*(-[a-z0-9]+)*$', '^[0-9a-f]{40}([0-9a-f]{24})?$']);
    const L = JSON.parse(/`{3}json devteam\s*\n([\s\S]*?)\n`{3}/.exec(fs.readFileSync(path.join(kit, 'governance/constitution.md'), 'utf8'))[1]);
    assert.ok(L.owner_only.includes('artifact-publish'), 'owner_only in the constitution');
    const month = new Date().toISOString().slice(0, 7);
    const ownerFile = path.join(repo, 'docs/devteam/run/log', `owner-${month}.jsonl`);
    const supFile = path.join(repo, 'docs/devteam/run/log', `supervisor-${month}.jsonl`);
    const kept = [ownerFile, supFile].map((f) => [f, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null]);
    const tree = git(['rev-parse', 'origin/main:docs/devteam/project/artifacts/landed-other']);
    let n = 0;
    const act = (by, body) => {
      const at = new Date(Date.now() + n++).toISOString();
      return line({ id: `a-${at.slice(0, 10).replace(/-/g, '')}-${at.slice(11, 23).replace(/[:.]/g, '')}-${by}`, type: 'act', op: 'new', at, by, ...(by === 'owner' ? { channel: 'cli' } : {}), ...body });
    };
    const pub = { class: 'artifact-publish', what: 'publish', refs: ['artifact:landed-other'], artifact: 'landed-other', tree };
    try {
      fs.appendFileSync(ownerFile, act('owner', pub));
      must(['log-check']);
      for (const [by, body, re] of [
        ['owner', { ...pub, class: 'merge-word' }, /the owner's acts are artifact-publish only/],
        ['owner', { ...pub, tree: undefined }, /publish with its tree or unpublish without one/],
        ['owner', { ...pub, what: 'unpublish' }, /publish with its tree or unpublish without one/],
        ['owner', { ...pub, what: 'shout', tree: undefined }, /publish with its tree or unpublish without one/],
        ['supervisor', pub, /artifact-publish is the owner's/],
      ]) {
        const f = by === 'owner' ? ownerFile : supFile;
        const before = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
        fs.appendFileSync(f, act(by, body));
        const r = dt(['log-check']);
        assert.notEqual(r.status, 0, `${by} ${JSON.stringify(body)}`);
        assert.match(r.out, re);
        fs.writeFileSync(f, before);
      }
      // the supervisor can't write one either: authorise() refuses an owner-only class (the forged lines above exercise integrity())
      const r = dt(['act', '--class', 'artifact-publish', '--refs', 'artifact:landed-other', '--', 'publish'], { role: 'sup' });
      assert.notEqual(r.status, 0);
      assert.match(r.err, /artifact-publish is the owner's/);
    } finally {
      for (const [f, text] of kept) if (text === null) fs.rmSync(f, { force: true }); else fs.writeFileSync(f, text);
    }
    must(['log-check']);
  });
```

In `test/kit.test.mjs`, extend the last `FORKS` entry (the artifacts group) so the step runs in that fork, after the Library step:

```js
  ['artifacts: new, check, list', 'artifacts: check-pr and merge refuse', 'artifacts: the dashboard serves them', 'artifacts: a question links one', 'artifacts: the Library data', 'public artifacts: an artifact-publish act'],
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `~/.asdf/installs/nodejs/18.20.4/bin/node --test --test-concurrency=8 test/kit.test.mjs`
Expected: FAIL in `public artifacts: an artifact-publish act is the owner's, and the owner's only act`, at the first assertion (`S['x-authority'].new.owner.includes('act')` is false). Every other step passes.

- [ ] **Step 3: Schema**

In `docs/devteam/schema/log.schema.json`, replace the `act` description (the line starting `"description": "Something the supervisor did (incl. approve-spec, …`) with:

```json
        "description": "Something the supervisor did (incl. approve-spec, approve-plan, merge-word, and worker-slots, whose planner acts carry the feature's id_block). An act that carries decision did what that decision line decided, and the decision answers for it: the owner corrects the decision, not the act. An act without decision is its own decision (mechanical acts, and every act written before decisions existed). The owner, or the supervisor at a retro, sets corrected; the supervisor then sets repaired. The owner writes acts of one class only, artifact-publish (devteam.mjs artifact publish|unpublish, which the cloud gateway's confirm page runs): the record of what the owner made public, with artifact and, for a publish, tree. It is a record, never a call: trust, decisions and corrections leave it out, and only the owner writes that class.",
```

In the same object's `properties`, after the `"repo": { … }` property (the last one, ending `"x-tip": "The repo this was in, when not this one."\n          }`), add a comma and:

```json
          "artifact": {
            "description": "On the owner's artifact-publish act: the slug of the landed artifact (project/artifacts/<slug>/) published or taken down.",
            "type": "string",
            "pattern": "^[a-z][a-z0-9]*(-[a-z0-9]+)*$",
            "x-tip": "The artifact you published or took down."
          },
          "tree": {
            "description": "On the owner's artifact-publish act with what publish: the git tree id of the artifact's folder on main that the gateway checked byte for byte and serves. Absent on an unpublish.",
            "type": "string",
            "pattern": "^[0-9a-f]{40}([0-9a-f]{24})?$",
            "x-tip": "The version you published."
          }
```

In `x-authority.new.owner`, add `"act"` after `"message"`:

```json
      "owner": [
        "goal",
        "knowledge",
        "observation",
        "problem",
        "message",
        "act"
      ],
```

- [ ] **Step 4: Integrity**

In `docs/devteam/scripts/devteam.mjs`, directly after `const LINK_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;` (~450) add:

```js
// A git tree (or blob) id: sha1, or sha256 in a repo that uses it.
const TREE_ID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
```

In `integrity()`, directly after `if (!auth.new[cls].includes(o.type)) return \`${cls} may not create ${o.type} lines\`;` add:

```js
    // The owner's only acts are the record of publishing an artifact (artifact publish|unpublish),
    // and nobody else writes that class: an agent can't make the Library say the owner published.
    if (o.type === 'act' && (cls === 'owner') !== (o.class === 'artifact-publish')) return cls === 'owner' ? 'the owner\'s acts are artifact-publish only' : 'artifact-publish is the owner\'s';
    if (o.type === 'act' && cls === 'owner' && (!['publish', 'unpublish'].includes(o.what) || typeof o.artifact !== 'string' || !LINK_ID.test(o.artifact) || (o.what === 'publish' ? !(typeof o.tree === 'string' && TREE_ID.test(o.tree)) : o.tree !== undefined))) return 'an artifact-publish act names its artifact, and is what: publish with its tree or unpublish without one';
```

- [ ] **Step 5: Constitution**

In `docs/devteam/governance/constitution.md`, in the json devteam block, replace the `owner_only` line with:

```json
  "owner_only": ["one-way-door", "check-override", "governance-edit", "process-edit", "gate-change", "goal-change", "goal-met", "registry-attest", "new-dependency", "artifact-publish"],
```

(The prose sentence lands with the docs in Task 12.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `~/.asdf/installs/nodejs/18.20.4/bin/node --test --test-concurrency=8 test/kit.test.mjs`
Expected: PASS, including `ok … public artifacts: an artifact-publish act is the owner's, and the owner's only act`; `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add docs/devteam/schema/log.schema.json docs/devteam/scripts/devteam.mjs docs/devteam/governance/constitution.md test/lib/chain.mjs test/kit.test.mjs
git commit -m "Log: an artifact-publish act is the owner's, and the owner's only act

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Owner acts are records, not calls (consumers skip them; correct refuses one)

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs`: `calls` (~1387), `decisionRecords()` (~3959-3961), `collectOoda()` acts (~7404), `cmdCorrect()` (~5599-5611)
- Test: `test/lib/chain.mjs` (new step after Task 1's), `test/kit.test.mjs` (`FORKS`)

**Interfaces:**
- Consumes: Task 1's valid owner act.
- Produces: `calls()`, `decisionRecords()` and `collectOoda().acts` contain no act whose `created_by` is `owner`; `correct <owner-act-id>` dies with "`<id>` is the owner's own record (artifact-publish), not a call; nothing to correct".

- [ ] **Step 1: Write the failing test**

Append after Task 1's step in `test/lib/chain.mjs`:

```js
  step('public artifacts: owner acts are records, not calls', () => {
    const month = new Date().toISOString().slice(0, 7);
    const ownerFile = path.join(repo, 'docs/devteam/run/log', `owner-${month}.jsonl`);
    const kept = fs.existsSync(ownerFile) ? fs.readFileSync(ownerFile, 'utf8') : null;
    const at = new Date().toISOString();
    const X = `a-${at.slice(0, 10).replace(/-/g, '')}-${at.slice(11, 23).replace(/[:.]/g, '')}-owner`;
    const tree = git(['rev-parse', 'origin/main:docs/devteam/project/artifacts/landed-other']);
    try {
      fs.appendFileSync(ownerFile, line({ id: X, type: 'act', op: 'new', at, by: 'owner', channel: 'cli', class: 'artifact-publish', what: 'publish', refs: ['artifact:landed-other'], artifact: 'landed-other', tree }));
      must(['log-check']);
      const d = json(must(['dashboard-data']));
      assert.ok(!d.ooda.acts.some((a) => a.id === X), 'not in the act feed');
      assert.ok(!d.ooda.decisions.some((r) => r.id === X || (r.refs ?? []).includes(X)), 'nor among the calls');
      const r = dt(['correct', X, '--reason', 'I did not mean it']);
      assert.notEqual(r.status, 0);
      assert.match(r.err, new RegExp(`${X} is the owner's own record \\(artifact-publish\\), not a call; nothing to correct`));
    } finally {
      if (kept === null) fs.rmSync(ownerFile, { force: true }); else fs.writeFileSync(ownerFile, kept);
    }
  });
```

In `test/kit.test.mjs`, append `'public artifacts: owner acts are records'` to the artifacts group (after `'public artifacts: an artifact-publish act'`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `~/.asdf/installs/nodejs/18.20.4/bin/node --test --test-concurrency=8 test/kit.test.mjs`
Expected: FAIL in `public artifacts: owner acts are records, not calls` with "not in the act feed".

- [ ] **Step 3: Implement**

Replace the `calls` line (~1387) and its comment:

```js
// The supervisor's calls: its decisions, and the acts that are their own decision (no decision
// field: mechanical acts, and acts logged before decisions existed). Trust is earned and lost on
// these. An owner's act (artifact-publish) is a record of what the owner did, never a call.
const calls = () => [...logObjects('decision'), ...logObjects('act').filter((a) => !a.decision && a.created_by !== 'owner')];
```

In `decisionRecords()`, replace `const acts = logObjects('act');` with:

```js
  const acts = logObjects('act').filter((a) => a.created_by !== 'owner');
```

In `collectOoda()`, replace `const acts = logObjects('act').map((a) => {` with:

```js
  // the owner's own acts (artifact-publish) are the Library's to show, not the supervisor's feed
  const acts = logObjects('act').filter((a) => a.created_by !== 'owner').map((a) => {
```

In `cmdCorrect()`, directly after `if (!['act', 'decision'].includes(act?.type)) die(\`no decision or act ${actId}\`);` add:

```js
  if (act.type === 'act' && act.created_by === 'owner') die(`${actId} is the owner's own record (${act.class}), not a call; nothing to correct`);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `~/.asdf/installs/nodejs/18.20.4/bin/node --test --test-concurrency=8 test/kit.test.mjs`
Expected: PASS, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/lib/chain.mjs test/kit.test.mjs
git commit -m "Owner acts are records, not calls: trust, decisions and the act feed leave them out

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: artifact publish and unpublish, and the dashboard action the gateway calls

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs`: the artifacts section (after `allArtifacts`, ~4526), `cmdArtifact()` (~4528-4560), `cmdDashboard()`'s `run` (~7888) and `ACTIONS` (~7893-7906) and the generic action reply (~8190-8196)
- Test: `test/lib/chain.mjs`, `test/kit.test.mjs` (`FORKS`)

**Interfaces:**
- Consumes: `TREE_ID` (Task 1), `artifactProblems`, `mainRef`, `ARTIFACTS_REL`, `ownerWriter`, `ownerChannel`, `appendLog`, `logObjects`.
- Produces:
  - `const PUBLIC_PROJECT = /^[a-z0-9][a-z0-9._-]{0,62}$/`.
  - `treeIdEntries(tree: string) => Array<{ path, mode, type, oid, size, read() }>`: every entry of a tree by its id.
  - `publicArtifact(slug: string) => { project, slug, tree, entries, manifest }`: dies (exit 1) "`<slug>`: not an artifact landed on main (a draft is never public)" or "`<slug>` is broken on main: …"; dies with exit 2 when `settings.project` is unset or not `PUBLIC_PROJECT` ("… set \"project\" in settings.md …").
  - `publishRecords() => Map<slug, act>`: each slug's newest owner `artifact-publish` act, fold order.
  - `artifact publish <slug> --owner --tree <t>` and `artifact unpublish <slug> --owner`.
  - Dashboard: `run(args, { timeout } = {}) => Promise<{ ok, code, stdout, stderr }>` (`code` is the child's exit code, 0 on success); `ACTIONS['artifact-publish']`; `ACTION_MS = { 'artifact-publish': 12000 }`.

- [ ] **Step 1: Write the failing test**

Append after Task 2's step in `test/lib/chain.mjs`:

```js
  step('public artifacts: artifact publish and unpublish, the owner\'s, against main as it is', async () => {
    const tree = (slug) => git(['rev-parse', `origin/main:docs/devteam/project/artifacts/${slug}`]);
    // a broken artifact on main, as a push that skipped merge would leave it
    const lw = path.join(repo, '.worktrees', 'tmp-land-pub');
    git(['worktree', 'add', '-q', '--detach', lw, 'origin/main']);
    write(path.join(lw, 'docs/devteam/project/artifacts/landed-broken/index.html'), '<!doctype html>');
    write(path.join(lw, 'docs/devteam/project/artifacts/landed-broken/artifact.json'), '{');
    git(['add', '-A'], lw);
    git(['commit', '-qm', 'a broken artifact lands'], lw);
    git(['push', '-q', 'origin', 'HEAD:main'], lw);
    git(['worktree', 'remove', '--force', lw]);
    git(['fetch', '-q', 'origin', 'main']);
    const T = tree('landed-other');
    assert.match(dt(['artifact', 'publish', 'landed-other', '--tree', T]).err, /usage: artifact publish <slug> --owner --tree/, 'the owner says so');
    assert.match(dt(['artifact', 'publish', 'landed-other', '--owner', '--tree', T], { role: 'sup' }).err, /owner commands don't run in an agent session/);
    assert.match(dt(['artifact', 'publish', 'mock-one', '--owner', '--tree', T]).err, /mock-one: not an artifact landed on main \(a draft is never public\)/);
    assert.match(dt(['artifact', 'publish', 'no-such', '--owner', '--tree', T]).err, /no-such: not an artifact landed on main/);
    assert.match(dt(['artifact', 'publish', 'landed-broken', '--owner', '--tree', tree('landed-broken')]).err, /landed-broken is broken on main: landed-broken\/artifact\.json: not JSON/);
    assert.match(dt(['artifact', 'publish', 'landed-other', '--owner', '--tree', tree('landed-tk')]).err, /landed-other: --tree [0-9a-f]{12} is not its tree on main \([0-9a-f]{12}\); only what main has now is published/);
    assert.match(dt(['artifact', 'unpublish', 'landed-other', '--owner']).err, /landed-other is not published; there is nothing to unpublish/);
    const mine = () => json(must(['log', '--type', 'act', '--by', 'owner', '--json']));
    assert.match(must(['artifact', 'publish', 'landed-other', '--owner', '--tree', T]), /^recorded: landed-other published\. This records intent only: a page goes public, or comes down, only on the cloud gateway's confirm page/);
    let last = mine().at(-1);
    assert.deepEqual([last.class, last.what, last.artifact, last.tree, last.channel, last.refs], ['artifact-publish', 'publish', 'landed-other', T, 'cli', ['artifact:landed-other']]);
    must(['log-check']);
    must(['artifact', 'unpublish', 'landed-other', '--owner']);
    last = mine().at(-1);
    assert.deepEqual([last.what, last.tree], ['unpublish', undefined]);
    assert.match(dt(['artifact', 'unpublish', 'landed-other', '--owner']).err, /is not published/, 'once');
    // the dashboard's action: what the gateway calls, under the checks every owner action has
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const srv = spawn(process.execPath, [DT, 'dashboard', '--port', String(port)], { cwd: repo, env: { ...process.env, DEVTEAM_ROLE: '' }, stdio: 'ignore' });
    const act = (body, headers = {}) => fetch(`${base}/api/artifact-publish`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    try {
      await serverUp(`${base}/`);
      assert.equal((await act({ op: 'publish', slug: 'landed-tk' })).status, 400, 'a publish names its tree');
      assert.equal((await act({ op: 'publish', slug: 'Landed', tree: tree('landed-tk') })).status, 400);
      assert.equal((await act({ op: 'erase', slug: 'landed-tk' })).status, 400);
      assert.equal((await act({ op: 'publish', slug: 'landed-tk', tree: tree('landed-tk') }, { origin: 'http://evil.example' })).status, 403);
      let r = await act({ op: 'publish', slug: 'landed-tk', tree: tree('landed-tk') });
      assert.equal(r.status, 200, await r.text());
      assert.deepEqual([mine().at(-1).artifact, mine().at(-1).channel], ['landed-tk', 'dashboard']);
      r = await act({ op: 'publish', slug: 'landed-tk', tree: T });
      assert.equal(r.status, 400);
      assert.match((await r.json()).error, /is not its tree on main/);
      assert.equal((await act({ op: 'unpublish', slug: 'landed-tk' })).status, 200);
    } finally { srv.kill(); }
  });
```

In `test/kit.test.mjs`, append `'public artifacts: artifact publish and unpublish'` to the artifacts group.

- [ ] **Step 2: Run the test to verify it fails**

Run: `~/.asdf/installs/nodejs/18.20.4/bin/node --test --test-concurrency=8 test/kit.test.mjs`
Expected: FAIL in `public artifacts: artifact publish and unpublish…`: the first `assert.match` gets "usage: artifact new <slug> --title t --summary s [--for json] | artifact check [<slug>…]".

- [ ] **Step 3: The publishing helpers**

In `docs/devteam/scripts/devteam.mjs`, directly after `const allArtifacts = () => { … };` (~4526) add:

```js
// ----- publishing: the owner makes a landed artifact readable by anyone, from the cloud box -----
// The gateway does the publishing (its confirm page, its own copy of the bytes); the kit says what
// main has, and records the owner's word as an owner act (docs/superpowers/specs/2026-11-09-public-artifacts-design.md).
// The project's name is part of every public URL, so it is set explicitly: the folder-name fallback
// helloBody uses would move every link on a re-clone.
const PUBLIC_PROJECT = /^[a-z0-9][a-z0-9._-]{0,62}$/;
// Every entry of a tree by its id, in treeEntries' shape: the manifest and its checks read one
// tree, never a branch that may move between two reads.
function treeIdEntries(tree) {
  return (git(['ls-tree', '-r', '-l', '-z', tree], mainRoot) ?? '').split('\0').filter(Boolean).map((l) => {
    const tab = l.indexOf('\t');
    const [mode, type, oid, size] = l.slice(0, tab).trim().split(/\s+/);
    return { path: l.slice(tab + 1), mode, type, oid, size: Number(size) || 0, read: () => { try { return execFileSync('git', ['cat-file', 'blob', oid], { cwd: mainRoot, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }); } catch { return null; } } };
  });
}
// A landed artifact as publishing sees it: its tree on main, judged by the rules merge runs.
// Exit 2 when it is the project's name that is missing (the manifest route answers 409: a setting
// to fix, not a page that isn't there). It never fetches: the gateway is waiting on it.
function publicArtifact(slug) {
  const ref = mainRef();
  const row = LINK_ID.test(slug ?? '') && ref ? /^040000 tree ([0-9a-f]+)\t/.exec(git(['ls-tree', ref, '--', `${ARTIFACTS_REL}/${slug}`], mainRoot) ?? '') : null;
  if (!row) die(`${slug}: not an artifact landed on main (a draft is never public)`);
  const tree = row[1];
  const entries = treeIdEntries(tree);
  const sub = entries.find((e) => e.type !== 'blob');
  if (sub) die(`${slug}/${sub.path}: a submodule isn't served, so ${slug} can't be published`);
  const p = artifactProblems(slug, entries);
  if (p.errors.length) die(`${slug} is broken on main: ${p.errors[0]}`);
  const project = loadSettings().project;
  if (typeof project !== 'string' || !PUBLIC_PROJECT.test(project)) die(`publishing needs this project's name, since it is part of every public link: set "project" in settings.md (lowercase letters, digits, . _ -, at most 63; it is ${project == null ? 'unset' : quoteData(project)})`, 2);
  return { project, slug, tree, entries, manifest: p.manifest };
}
// Each slug's newest owner artifact-publish act, in fold order (logObjects keeps it): its recorded state.
function publishRecords() {
  const m = new Map();
  for (const a of logObjects('act')) if (a.created_by === 'owner' && a.class === 'artifact-publish' && typeof a.artifact === 'string') m.set(a.artifact, a);
  return m;
}
```

- [ ] **Step 4: The commands**

In `cmdArtifact()`, replace the final line `die('usage: artifact new <slug> --title t --summary s [--for json] | artifact check [<slug>…]');` with:

```js
  // artifact publish|unpublish: the owner's record of what the gateway made public. The gateway's
  // confirm page runs them through the dashboard; by hand they record intent only.
  if (sub === 'publish' || sub === 'unpublish') {
    const slugName = args[0];
    if (!LINK_ID.test(slugName ?? '') || !flags.owner || (sub === 'publish' && !TREE_ID.test(flagStr('tree') ?? ''))) die('usage: artifact publish <slug> --owner --tree <tree-id> | artifact unpublish <slug> --owner   (the owner\'s; the cloud gateway\'s confirm page runs them)');
    const { by } = ownerWriter();
    if (sub === 'publish') {
      const a = publicArtifact(slugName);
      const tree = flagStr('tree');
      if (tree !== a.tree) die(`${slugName}: --tree ${tree.slice(0, 12)} is not its tree on main (${a.tree.slice(0, 12)}); only what main has now is published`);
      appendLog({ type: 'act', class: 'artifact-publish', what: 'publish', refs: [`artifact:${slugName}`], artifact: slugName, tree }, by);
    } else {
      if (publishRecords().get(slugName)?.what !== 'publish') die(`${slugName} is not published; there is nothing to unpublish`);
      appendLog({ type: 'act', class: 'artifact-publish', what: 'unpublish', refs: [`artifact:${slugName}`], artifact: slugName }, by);
    }
    return out(`recorded: ${slugName} ${sub}ed${ownerChannel() === 'dashboard' ? '' : '. This records intent only: a page goes public, or comes down, only on the cloud gateway\'s confirm page (https://<box>/public/)'}`);
  }
  die('usage: artifact new <slug> --title t --summary s [--for json] | artifact check [<slug>…] | artifact publish <slug> --owner --tree <t> | artifact unpublish <slug> --owner');
```

- [ ] **Step 5: The dashboard's run, and the action**

In `cmdDashboard()`, replace the `run` line (`const run = (args) => new Promise(…)`) with:

```js
  // A child run as the owner. timeout (ms) is for a caller that can't wait (the gateway's 15 s);
  // code is the exit code, so a route can tell "not there" from "fix a setting" (2).
  const run = (args, { timeout = 0 } = {}) => new Promise((resolve) => execFile(process.execPath, [self, ...args], { cwd: mainRoot, maxBuffer: 64 * 1024 * 1024, env: ownerEnv, timeout, killSignal: 'SIGKILL' }, (err, stdout, stderr) => resolve({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr: err?.killed ? `devteam: ${args.slice(0, 2).join(' ')} took over ${timeout / 1000} s and was stopped` : stderr })));
```

In `ACTIONS`, after the `ack:` entry, add:

```js
    // Only the cloud gateway calls it, after the owner confirmed on its own page (and the Library's
    // Forget, for a record the owner doesn't want restored); the Library has no button that publishes.
    'artifact-publish': (b) => (LINK_ID.test(b.slug ?? '') && (b.op === 'unpublish' || (b.op === 'publish' && TREE_ID.test(b.tree ?? ''))) ? ['artifact', b.op, b.slug, '--owner', ...(b.op === 'publish' ? ['--tree', b.tree] : [])] : null),
```

After the closing `};` of `ACTIONS`, add:

```js
  // An action whose caller has a deadline of its own: the gateway gives the whole answer 15 s.
  const ACTION_MS = { 'artifact-publish': 12000 };
```

In the generic action handler at the end of the request handler, replace `const r = await run(args);` (the one directly after `if (!args) return send(res, 400, …)`) with:

```js
      const r = await run(args, { timeout: ACTION_MS[name] ?? 0 });
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `~/.asdf/installs/nodejs/18.20.4/bin/node --test --test-concurrency=8 test/kit.test.mjs`
Expected: PASS, `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/lib/chain.mjs test/kit.test.mjs
git commit -m "artifact publish|unpublish: the owner's record, against main's tree; the dashboard action the gateway calls

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: GET /public-manifest/<slug>: what publishing would put up

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs`: after `publishRecords` (Task 3), `cmdArtifact()`, `cmdDashboard()`'s request handler (before the `/artifact/` route, ~8045)
- Test: `test/lib/chain.mjs`, `test/kit.test.mjs` (`FORKS`)

**Interfaces:**
- Consumes: `publicArtifact` (Task 3), `run(args, { timeout })` with `code` (Task 3), `sha256` (~4288).
- Produces:
  - `publicManifest(slug) => { public: 1, project, slug, title, summary, root, tree, files: { [rel]: { sha256, size, mode } } }`, `mode` being `"100644"` or `"100755"` (the gateway needs it to recompute the tree id). Hashes cached at `run/cache/public-manifests/<tree>.json`.
  - `artifact manifest <slug> [--json]`.
  - `GET /public-manifest/<slug>`: 200 with the manifest JSON; 404 `{ error }` for a draft, unknown or broken slug; 409 `{ error }` for a missing or bad project name; 403 when `sec-fetch-site` is present and not `same-origin`; 403 on another Host (the existing `okHost`).

- [ ] **Step 1: Write the failing test**

Append after Task 3's step in `test/lib/chain.mjs`:

```js
  step('public artifacts: /public-manifest says what publishing would put up, byte for byte', async () => {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const srv = spawn(process.execPath, [DT, 'dashboard', '--port', String(port)], { cwd: repo, env: { ...process.env, DEVTEAM_ROLE: '' }, stdio: 'ignore' });
    try {
      await serverUp(`${base}/`);
      const r = await fetch(`${base}/public-manifest/landed-mock`);
      assert.equal(r.status, 200);
      const m = await r.json();
      const T = git(['rev-parse', 'origin/main:docs/devteam/project/artifacts/landed-mock']);
      assert.deepEqual([m.public, m.project, m.slug, m.title, m.summary, m.root, m.tree], [1, 'demo', 'landed-mock', 'Landed mock', 'The card form', fs.realpathSync(repo), T]);
      assert.deepEqual(Object.keys(m).sort(), ['files', 'project', 'public', 'root', 'slug', 'summary', 'title', 'tree']);
      assert.deepEqual(Object.keys(m.files).sort(), ['artifact.json', 'index.html', 'style.css']);
      for (const [rel, f] of Object.entries(m.files)) {
        const bytes = Buffer.from(await (await fetch(`${base}/artifact/main/landed-mock/${rel}`)).arrayBuffer());
        assert.deepEqual([f.sha256, f.size, f.mode], [crypto.createHash('sha256').update(bytes).digest('hex'), bytes.length, '100644'], rel);
      }
      assert.ok(fs.existsSync(path.join(repo, 'docs/devteam/run/cache/public-manifests', `${T}.json`)), 'kept by tree id');
      assert.deepEqual(json(must(['artifact', 'manifest', 'landed-mock', '--json'])), m, 'the command says the same');
      for (const s of ['mock-one', 'no-such', 'landed-broken', 'Bad_Slug']) assert.equal((await fetch(`${base}/public-manifest/${s}`)).status, 404, s);
      assert.match((await (await fetch(`${base}/public-manifest/mock-one`)).json()).error, /a draft is never public/);
      assert.equal((await fetch(`${base}/public-manifest/landed-mock`, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
      assert.equal((await fetch(`${base}/public-manifest/landed-mock`, { headers: { 'sec-fetch-site': 'same-site' } })).status, 403);
      assert.equal((await fetch(`${base}/public-manifest/landed-mock`, { headers: { 'sec-fetch-site': 'same-origin' } })).status, 200);
      assert.equal(await statusWithHost(port, '/public-manifest/landed-mock', `rebound.example:${port}`), 403, 'its own Host only');
      // the project's name is in every public link, so it is set, and link-shaped
      const sf = path.join(repo, 'docs/devteam/project/settings.md');
      const keep = fs.readFileSync(sf, 'utf8');
      const bad = keep.replace(/"project":\s*"demo"/, '"project": "Demo Project"');
      assert.notEqual(bad, keep);
      fs.writeFileSync(sf, bad);
      try {
        const r9 = await fetch(`${base}/public-manifest/landed-mock`);
        assert.equal(r9.status, 409);
        assert.match((await r9.json()).error, /set "project" in settings\.md/);
      } finally { fs.writeFileSync(sf, keep); }
    } finally { srv.kill(); }
  });
```

In `test/kit.test.mjs`, append `'public artifacts: /public-manifest'` to the artifacts group.

- [ ] **Step 2: Run the test to verify it fails**

Run: `~/.asdf/installs/nodejs/18.20.4/bin/node --test --test-concurrency=8 test/kit.test.mjs`
Expected: FAIL in `public artifacts: /public-manifest…`: `r.status` is 404 (no such route), expected 200.

- [ ] **Step 3: The manifest**

Directly after `publishRecords()` (Task 3) add:

```js
// What publishing <slug> would put up, for the gateway to show the owner and then check byte for
// byte: main's tree, each file's sha256, size and mode (the gateway recomputes the tree id from the
// bytes, and a mode is part of it). Hashes are kept in run/cache by tree id: a tree never changes,
// so a kept one is never stale.
function publicManifest(slug) {
  const a = publicArtifact(slug);
  const file = path.join(runDir, 'cache', 'public-manifests', `${a.tree}.json`);
  let files = null;
  try { files = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  if (!isObj(files)) {
    files = Object.fromEntries(a.entries.map((e) => {
      const buf = e.read() ?? die(`${slug}/${e.path}: git can't read it`);
      return [e.path, { sha256: sha256(buf), size: buf.length, mode: e.mode }];
    }));
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(files)); } catch {}
  }
  return { public: 1, project: a.project, slug, title: a.manifest.title, summary: a.manifest.summary, root: fs.realpathSync(mainRoot), tree: a.tree, files };
}
```

- [ ] **Step 4: The command**

In `cmdArtifact()`, directly before the `// artifact publish|unpublish:` comment (Task 3), add:

```js
  // artifact manifest <slug>: what the gateway's confirm page would show for it
  if (sub === 'manifest') {
    const m = publicManifest(args[0] ?? die('usage: artifact manifest <slug> [--json]'));
    if (flags.json) return out(JSON.stringify(m));
    const bytes = Object.values(m.files).reduce((n, f) => n + f.size, 0);
    return out(`${m.project}/${m.slug} at tree ${m.tree.slice(0, 12)}: ${Object.keys(m.files).length} files, ${bytes} bytes; published, it is https://public.<box>/${m.project}/${m.slug}/`);
  }
```

and replace the final usage line with:

```js
  die('usage: artifact new <slug> --title t --summary s [--for json] | artifact check [<slug>…] | artifact manifest <slug> [--json] | artifact publish <slug> --owner --tree <t> | artifact unpublish <slug> --owner');
```

- [ ] **Step 5: The route**

In `cmdDashboard()`'s request handler, directly after `const rawPath = req.url.split('?')[0];` (just before `if (req.method === 'GET' && rawPath.startsWith('/artifact/')) {`) add:

```js
    // What publishing an artifact would put up, for the cloud gateway's confirm page. Its loopback
    // request sends no sec-fetch-site; a browser's must come from this page's own origin.
    if (req.method === 'GET' && rawPath.startsWith('/public-manifest/')) {
      const site = req.headers['sec-fetch-site'];
      if (site !== undefined && site !== 'same-origin') return send(res, 403, 'application/json', JSON.stringify({ error: 'not for another site\'s page' }));
      const slug = rawPath.slice('/public-manifest/'.length);
      if (!LINK_ID.test(slug)) return send(res, 404, 'application/json', JSON.stringify({ error: 'not an artifact slug' }));
      const r = await run(['artifact', 'manifest', slug, '--json'], { timeout: 12000 });
      return r.ok ? send(res, 200, 'application/json', r.stdout) : send(res, r.code === 2 ? 409 : 404, 'application/json', JSON.stringify({ error: r.stderr.trim().replace(/^devteam: /, '') }));
    }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `~/.asdf/installs/nodejs/18.20.4/bin/node --test --test-concurrency=8 test/kit.test.mjs`
Expected: PASS, `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/lib/chain.mjs test/kit.test.mjs
git commit -m "/public-manifest: main's tree for an artifact and each file's sha256, for the gateway to confirm

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Library data: each landed row's tree and published record

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs`: `landedArtifacts()` (~4487-4505), after `publishRecords` (Task 3), `dashboardData()`'s `library` (~7449-7457)
- Test: `test/lib/chain.mjs`, `test/kit.test.mjs` (`FORKS`)

**Interfaces:**
- Consumes: `publishRecords()` (Task 3), `PUBLIC_PROJECT` (Task 3).
- Produces:
  - Each landed row of `library.artifacts` (and of `artifacts --json`) carries `tree` (its folder's tree id on main). Drafts have no `tree`.
  - Each landed row of `dashboardData().library.artifacts` carries `published: { tree, at, channel } | null` (`at` is the act's `created_at`, `channel` the owner line's channel). Drafts have no `published`.
  - `dashboardData().library.public = { project: string | null, root: string }` (`project` is null unless it matches `PUBLIC_PROJECT`; `root` is the main checkout's realpath). Task 11 reads both.
  - `publishedView(act | undefined) => { tree, at, channel } | null`.

- [ ] **Step 1: Write the failing test**

Append after Task 4's step in `test/lib/chain.mjs`:

```js
  step('public artifacts: the Library says what the log records, beside each landed tree', () => {
    const T = git(['rev-parse', 'origin/main:docs/devteam/project/artifacts/landed-other']);
    const lib = () => json(must(['dashboard-data'])).library;
    const row = () => lib().artifacts.find((a) => a.slug === 'landed-other' && a.at === 'main');
    assert.deepEqual(lib().public, { project: 'demo', root: fs.realpathSync(repo) });
    assert.equal(row().tree, T);
    assert.equal(json(must(['artifacts', '--json'])).find((a) => a.slug === 'landed-other').tree, T);
    assert.equal(row().published, null, 'unpublished by the step before');
    assert.ok(lib().artifacts.filter((a) => a.at !== 'main').every((a) => a.tree === undefined && a.published === undefined), 'a draft has neither');
    must(['artifact', 'publish', 'landed-other', '--owner', '--tree', T]);
    const p = row().published;
    assert.deepEqual([p.tree, p.channel], [T, 'cli']);
    assert.ok(Date.parse(p.at) > Date.now() - 600000);
    must(['artifact', 'unpublish', 'landed-other', '--owner']);
    assert.equal(row().published, null, 'the cache kept by tree id never hides the record');
  });
```

In `test/kit.test.mjs`, append `'public artifacts: the Library'` to the artifacts group. The entry is now:

```js
  ['artifacts: new, check, list', 'artifacts: check-pr and merge refuse', 'artifacts: the dashboard serves them', 'artifacts: a question links one', 'artifacts: the Library data', 'public artifacts: an artifact-publish act', 'public artifacts: owner acts are records', 'public artifacts: artifact publish and unpublish', 'public artifacts: /public-manifest', 'public artifacts: the Library'],
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `~/.asdf/installs/nodejs/18.20.4/bin/node --test --test-concurrency=8 test/kit.test.mjs`
Expected: FAIL in `public artifacts: the Library says…`: `lib().public` is undefined.

- [ ] **Step 3: Landed rows carry their tree**

In `landedArtifacts()`, replace:

```js
  const res = rows.map(([, tree, slug]) => {
    if (cache[tree]?.slug === slug) return (next[tree] = cache[tree]);
    const src = artifactSource('main', slug);
    return src ? (next[tree] = describeArtifact(slug, 'main', src)) : null;
  }).filter(Boolean);
```

with:

```js
  // the cache holds what the tree says (describeArtifact); the row adds the tree id itself, for
  // publishing, and nothing that changes without the tree changing goes in the cache
  const res = rows.map(([, tree, slug]) => {
    let d = cache[tree]?.slug === slug ? cache[tree] : null;
    if (!d) { const src = artifactSource('main', slug); d = src ? describeArtifact(slug, 'main', src) : null; }
    if (!d) return null;
    next[tree] = d;
    return { ...d, tree };
  }).filter(Boolean);
```

- [ ] **Step 4: The record beside each row**

Directly after `publicManifest()` (Task 4, which itself sits directly after `publishRecords()`) add:

```js
// A slug's recorded state as the Library shows it: published at a tree (with the line's date and
// channel, so a line the owner never wrote is visible), or null.
const publishedView = (a) => (a?.what === 'publish' ? { tree: a.tree, at: a.created_at, channel: a.channel ?? null } : null);
```

In `dashboardData()`, replace `artifacts: allArtifacts(),` inside `library: {` with:

```js
      // publish state is the log's, read here and never in describeArtifact's tree-keyed cache:
      // a publish changes no byte of the artifact
      artifacts: (() => { const rec = publishRecords(); return allArtifacts().map((a) => (a.at === 'main' ? { ...a, published: publishedView(rec.get(a.slug)) } : a)); })(),
      // what the Library matches the gateway's header on (x-devteam-public): this project and checkout
      public: { project: typeof settings.project === 'string' && PUBLIC_PROJECT.test(settings.project) ? settings.project : null, root: fs.realpathSync(mainRoot) },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `~/.asdf/installs/nodejs/18.20.4/bin/node --test --test-concurrency=8 test/kit.test.mjs`
Expected: PASS, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/lib/chain.mjs test/kit.test.mjs
git commit -m "Library data: each landed artifact's tree, and what the log records about publishing it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Part B: the gateway

### Task 6: public.<box>: serve a published artifact from the gateway's own copy

**Files:**
- Modify: `cloud/gateway.mjs`: module level, after the `INSTALL` block and before `// --- the server`; inside `createGateway`: beside `TERM` (~329), after `loginAt` (~330), and the request handler's name checks (~340-345)
- Test: `test/gateway.test.mjs`: imports, the `gateway()` helper (~69-113), new helpers and tests at the end of the file

**Interfaces:**
- Produces (module exports): `PUBLIC_TYPES` (null-prototype map, extension to content type, the kit's `ARTIFACT_TYPES` verbatim), `PUBLIC_CDNS` (the kit's `ARTIFACT_CDNS` verbatim), `publicPathOk(p: string) => boolean` (the kit's `artifactPathOk`), `publicCsp(self: string) => string`. Module constants (not exported): `LINK_ID`, `PROJECT`.
- Produces (inside `createGateway`): `PUBLIC` (`<scheme>//public.<box host>`), `publicHost`, `servePublic(req, res)`. Reads `store.load().public` and `<dir>/public/blobs/<sha256>` only.
- Produces (tests): `gw.site` (the public name's origin) and `on: 'public'` in `gw.req`; `seedPublic(dir, project, slug, files, { root, port })`.

- [ ] **Step 1: Write the failing tests**

In `test/gateway.test.mjs`, add `import vm from 'node:vm';` after `import path from 'node:path';`.

In `gateway()`, after `const term = \`http://term.box.localhost:${port}\`;` add:

```js
  const site = `http://public.box.localhost:${port}`;
```

replace the `const self = …` line inside `req` with:

```js
    const self = on === 'auth' ? auth : on === 'term' ? term : on === 'public' ? site : on ? inst(on) : publicUrl;
```

and add `site,` to the returned object (after `term,`).

Append to the end of `test/gateway.test.mjs`:

```js
// ===== public artifacts: what the owner published, to anyone, from the gateway's own copy =====

// A published artifact as the gateway keeps it: its blobs, and its entry in state.json.
function seedPublic(dir, project, slug, files, { root = '/srv/x', port = P } = {}) {
  const blobs = path.join(dir, 'public', 'blobs');
  fs.mkdirSync(blobs, { recursive: true });
  const f = path.join(dir, 'state.json');
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  const entry = {};
  for (const [rel, text] of Object.entries(files)) {
    const b = Buffer.from(text);
    const h = crypto.createHash('sha256').update(b).digest('hex');
    fs.writeFileSync(path.join(blobs, h), b);
    entry[rel] = { sha256: h, size: b.length };
  }
  const pub = s.public ?? {};
  pub[project] = { root, port, artifacts: { ...(pub[project]?.artifacts ?? {}), [slug]: { tree: 'a'.repeat(40), title: slug, at: new Date().toISOString(), files: entry } } };
  fs.writeFileSync(f, JSON.stringify({ ...s, public: pub }));
}

test('public.<box>: anyone reads a published artifact, from the gateway\'s own copy, under its own headers', async () => {
  const gw = await gateway('public-serve');
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    const page = '<!doctype html><p>hi';
    seedPublic(gw.dir, 'alpha', 'hello', { 'index.html': page, 'app.js': 'x()', 'img/a.png': 'png', 'data.weird': 'w' });
    const get = (route, headers = {}, method = 'GET') => gw.req(method, route, { on: 'public', cookie: '', headers });
    let r = await get('/alpha/hello/');
    assert.equal(r.status, 200);
    assert.equal(r.body, page);
    const etag = `"${crypto.createHash('sha256').update(page).digest('hex')}"`;
    assert.deepEqual([r.headers['content-type'], r.headers['content-length'], r.headers.etag, r.headers['cache-control'], r.headers['x-content-type-options'], r.headers['referrer-policy']], ['text/html; charset=utf-8', String(Buffer.byteLength(page)), etag, 'public, max-age=60', 'nosniff', 'no-referrer']);
    assert.equal(r.headers['set-cookie'], undefined);
    const self = `${gw.site}/alpha/hello/`;
    const csp = r.headers['content-security-policy'].split('; ');
    for (const d of ["default-src 'none'", `script-src 'unsafe-inline' 'unsafe-eval' ${self} https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com`, `connect-src ${self} https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com`, `img-src ${self} data: blob:`, "form-action 'none'", "frame-ancestors 'none'", 'sandbox allow-scripts allow-forms allow-modals allow-pointer-lock']) assert.ok(csp.includes(d), `the policy has ${d}: ${csp.join('; ')}`);
    assert.doesNotMatch(r.headers['content-security-policy'], /allow-same-origin|127\.0\.0\.1/);
    assert.equal((await get('/alpha/hello/app.js')).headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal((await get('/alpha/hello/img/a.png')).headers['content-type'], 'image/png');
    assert.equal((await get('/alpha/hello/data.weird')).headers['content-type'], 'application/octet-stream');
    // HEAD: the headers and no body; a strong tag that matches, or *, is a 304
    r = await get('/alpha/hello/', {}, 'HEAD');
    assert.deepEqual([r.status, r.body, r.headers['content-length'], r.headers.etag], [200, '', String(Buffer.byteLength(page)), etag]);
    assert.equal((await get('/alpha/hello/', { 'if-none-match': `"x", ${etag}` })).status, 304);
    assert.equal((await get('/alpha/hello/', { 'if-none-match': '*' })).status, 304);
    assert.equal((await get('/alpha/hello/', { 'if-none-match': `W/${etag}` })).status, 200, 'a weak tag is no match');
    // reads only, and no service workers
    r = await gw.req('POST', '/alpha/hello/', { on: 'public', cookie: '', body: {} });
    assert.deepEqual([r.status, r.headers.allow], [405, 'GET, HEAD']);
    assert.equal((await get('/alpha/hello/app.js', { 'service-worker': 'script' })).status, 403);
    assert.equal((await get('/alpha/hello/app.js', { 'sec-fetch-dest': 'serviceworker' })).status, 403);
    // signed in or not, the same answer: the cookie is never read on this name, and none is set
    r = await gw.req('GET', '/alpha/hello/', { on: 'public' });
    assert.deepEqual([r.status, r.body, r.headers['set-cookie']], [200, page, undefined]);
    // nothing is listed, nothing unpublished is there, and the raw path is matched before decoding
    for (const bad of ['/', '/alpha/', '/alpha/nope/', '/beta/hello/', '/alpha/hello/nope.js', '/alpha/hello/.env', '/alpha/hello/%2e%2e/x', '/alpha/hello/../hello/app.js', '/Alpha/hello/', '/alpha/hello//app.js', '/box.json', '/auth/login'])
      assert.equal((await get(bad)).status, 404, bad);
    r = await get('/alpha/hello');
    assert.deepEqual([r.status, r.headers.location, r.headers['cache-control']], [302, '/alpha/hello/', 'no-store'], 'to the trailing slash, when published');
    assert.equal((await get('/alpha/nope')).status, 404, 'and only then');
    assert.equal((await gw.req('GET', '/', { headers: { host: `pub.box.localhost:${gw.port}` } })).status, 421, 'the box still answers only on its own names');
  } finally { await gw.close(); }
});

test('public.<box> serves artifacts with the kit\'s own type map, CDN list and policy, kept in the gateway', () => {
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const one = (name) => { const m = new RegExp(`^const ${name} = (.+);$`, 'm').exec(src); assert.ok(m, `the kit defines ${name} on one line`); return m[1]; };
  const at = src.indexOf('const artifactCsp = ');
  assert.ok(at > 0, 'the kit defines artifactCsp');
  const cspSrc = src.slice(at, src.indexOf('\n};\n', at) + 3);
  const ctx = vm.createContext({ HUB_PORT: 4320 });
  vm.runInContext(`ARTIFACT_TYPES = ${one('ARTIFACT_TYPES')}; ARTIFACT_CDNS = ${one('ARTIFACT_CDNS')};\n${cspSrc}\nglobalThis.artifactCsp = artifactCsp;`, ctx);
  assert.deepEqual({ ...G.PUBLIC_TYPES }, { ...ctx.ARTIFACT_TYPES }, 'the type map');
  assert.deepEqual([...G.PUBLIC_CDNS], [...ctx.ARTIFACT_CDNS], 'the CDN list');
  const self = 'https://public.box.example.com/alpha/hello/';
  const kitCsp = ctx.artifactCsp('http://127.0.0.1:4321', self).split('; ');
  const gwCsp = G.publicCsp(self).split('; ');
  assert.deepEqual(gwCsp.filter((d) => !d.startsWith('frame-ancestors ')), kitCsp.filter((d) => !d.startsWith('frame-ancestors ')), 'the same policy');
  assert.ok(gwCsp.includes("frame-ancestors 'none'"), 'framed by nothing');
  const pathOk = /^const artifactPathOk = (.+);$/m.exec(src)[1];
  const kitOk = vm.runInContext(`(${pathOk})`, vm.createContext({}));
  for (const p of ['index.html', 'a/b.js', '.env', 'a/.git/x', 'a//b', 'a/../b', 'a%2eb', 'é.png', '__proto__']) assert.equal(G.publicPathOk(p), kitOk(p), p);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `~/.asdf/installs/nodejs/18.20.4/bin/node --test --test-name-pattern "public\.<box>" test/gateway.test.mjs`
Expected: FAIL: the first test's first `get` answers 421 (`this box answers only on its own names`), the second throws on `G.PUBLIC_TYPES` being undefined (`{ ...undefined }` is `{}`, so the deepEqual fails against the kit's map).

- [ ] **Step 3: The rules, kept beside the kit's**

In `cloud/gateway.mjs`, before `// --- the server ---…`, add:

```js
// --- public artifacts: what the owner published, served to anyone from the gateway's own copy ---
// The kit's rules for serving an artifact, kept here because the gateway runs apart from any
// checkout: its type map, its CDN list, its path rule and its policy. A test compares each with the
// kit's, so a change there fails until it is made here too (and the box deploys with it).
export const PUBLIC_TYPES = Object.assign(Object.create(null), { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream', wasm: 'application/wasm', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', csv: 'text/plain; charset=utf-8' });
export const PUBLIC_CDNS = ['https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net', 'https://unpkg.com'];
export const publicPathOk = (p) => /^[A-Za-z0-9._/-]+$/.test(p) && p.split('/').every((s) => s && !s.startsWith('.'));
// The kit's artifact policy, its own folder as self, framed by nothing. The sandbox (no
// allow-same-origin) makes the page an opaque origin, so it can't read or write the box's cookies.
export const publicCsp = (self) => {
  const cdns = PUBLIC_CDNS.join(' ');
  return [
    "default-src 'none'", `script-src 'unsafe-inline' 'unsafe-eval' ${self} ${cdns}`, `style-src 'unsafe-inline' ${self} ${cdns} https://fonts.googleapis.com`, `font-src ${self} ${cdns} https://fonts.gstatic.com data:`,
    `img-src ${self} data: blob:`, `media-src ${self} data: blob:`, `connect-src ${self} ${cdns}`, `worker-src ${self} blob:`, "frame-src 'none'", "form-action 'none'", "base-uri 'none'",
    "frame-ancestors 'none'", 'sandbox allow-scripts allow-forms allow-modals allow-pointer-lock',
  ].join('; ');
};
const LINK_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
// a project's name, as the kit requires it for publishing: part of every public URL
const PROJECT = /^[a-z0-9][a-z0-9._-]{0,62}$/;
```

- [ ] **Step 4: The name and the handler**

In `createGateway`, after `const termHost = new URL(TERM).host;` add:

```js
  // What the owner published, to anyone. Under the box's wildcard name like term., and never an
  // instance's: those are all digits.
  const PUBLIC = `${pubUrl.protocol}//public.${pubUrl.host}`;
  const publicHost = new URL(PUBLIC).host;
```

After `const loginAt = (next) => …;` add:

```js
  // A published artifact, from the gateway's own copy alone: reads only, the raw path matched
  // before any decoding, the gateway's own headers. Nothing here reads the cookie, sets one, or
  // talks to an instance, so taking a port, rewriting main or forging log lines changes nothing.
  const servePublic = (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, 'text/plain; charset=utf-8', 'GET or HEAD only', { allow: 'GET, HEAD' });
    if (req.headers['service-worker'] || req.headers['sec-fetch-dest'] === 'serviceworker') return send(res, 403, 'text/plain; charset=utf-8', 'no service workers on this box');
    const notFound = () => send(res, 404, 'text/plain; charset=utf-8', 'not found');
    const m = /^\/([^/]+)\/([^/]+)(\/.*)?$/.exec(req.url.split('?')[0]);
    if (!m || !PROJECT.test(m[1]) || !LINK_ID.test(m[2])) return notFound();
    const pub = store.load().public ?? {};
    const proj = Object.hasOwn(pub, m[1]) ? pub[m[1]] : null;
    const art = proj && Object.hasOwn(proj.artifacts ?? {}, m[2]) ? proj.artifacts[m[2]] : null;
    if (!art) return notFound();
    if (m[3] === undefined) { res.writeHead(302, { location: `/${m[1]}/${m[2]}/`, 'cache-control': 'no-store', ...hsts }); return res.end(); }
    const rel = m[3] === '/' ? 'index.html' : m[3].slice(1);
    const f = publicPathOk(rel) && Object.hasOwn(art.files ?? {}, rel) ? art.files[rel] : null;
    if (!f || !/^[0-9a-f]{64}$/.test(f.sha256 ?? '')) return notFound();
    const tag = `"${f.sha256}"`;
    const head = { etag: tag, 'cache-control': 'public, max-age=60', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': publicCsp(`${PUBLIC}/${m[1]}/${m[2]}/`), ...hsts };
    const asked = String(req.headers['if-none-match'] ?? '').split(',').map((t) => t.trim());
    if (asked.includes('*') || asked.includes(tag)) { res.writeHead(304, head); return res.end(); }
    // no range requests, as in the kit: the whole file or its headers
    const all = { ...head, 'content-type': PUBLIC_TYPES[rel.split('.').pop().toLowerCase()] ?? 'application/octet-stream', 'content-length': f.size };
    if (req.method === 'HEAD') { res.writeHead(200, all); return res.end(); }
    const file = path.join(dir, 'public', 'blobs', f.sha256);
    const st = fs.statSync(file, { throwIfNoEntry: false });
    if (!st || st.size !== f.size) return send(res, 500, 'text/plain; charset=utf-8', 'the box has lost its copy of this page: publish it again');
    res.writeHead(200, all);
    pipeline(fs.createReadStream(file), res, () => {});
  };
```

In the request handler, replace:

```js
    const isBox = req.headers.host === pubUrl.host;
    const isTerm = req.headers.host === termHost;
    const port = isBox || isTerm ? null : instanceOf(req.headers.host);
    if (!isBox && !isTerm && !port) return send(res, 421, 'text/plain; charset=utf-8', `this box answers only on its own names: open ${PUB}/`);
```

with:

```js
    const isBox = req.headers.host === pubUrl.host;
    const isTerm = req.headers.host === termHost;
    const isPublic = req.headers.host === publicHost;
    const port = isBox || isTerm || isPublic ? null : instanceOf(req.headers.host);
    if (!isBox && !isTerm && !isPublic && !port) return send(res, 421, 'text/plain; charset=utf-8', `this box answers only on its own names: open ${PUB}/`);
    // Anyone's, so before every check that is about the owner (Origin, cookie, session).
    if (isPublic) {
      try { return servePublic(req, res); } catch (e) { return send(res, e?.unreadable ? 503 : 500, 'text/plain; charset=utf-8', 'this page can\'t be served just now'); }
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `~/.asdf/installs/nodejs/18.20.4/bin/node --test test/gateway.test.mjs`
Expected: PASS, every test including the two new ones; `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add cloud/gateway.mjs test/gateway.test.mjs
git commit -m "Gateway: public.<box> serves a published artifact from its own copy, with the kit's policy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The store, the queue, a manifest's checks and git's ids

**Files:**
- Modify: `cloud/gateway.mjs`: module level, after Task 6's block
- Test: `test/gateway.test.mjs` (append)

**Interfaces:**
- Consumes: `LINK_ID`, `PROJECT`, `publicPathOk` (Task 6).
- Produces (module exports):
  - `canonicalJson(v) => string`: keys sorted at every level (the kit's `canonical`).
  - `manifestProblem(m, slug: string) => string | null`: null when `m` is a manifest for `slug` the gateway may show and fetch.
  - `gitBlobId(buf: Buffer, algo = 'sha1') => string` (hex).
  - `gitTreeId(files: { [rel]: { oid: string, mode: '100644' | '100755' } }, algo = 'sha1') => string` (hex); throws "… is both a file and a folder" on a clash.
  - `publicStore(dir) => { blobs: string, blobPath(sha), serial(fn) => Promise, referenced(pub) => Map<sha256, size>, write(sha, buf) => boolean, sweep(pub) }`. `write` writes `<sha>.<pid>.<random>.tmp` then renames, and is a no-op returning false when the blob exists. `sweep` removes every file under `blobs` that `pub` (a `state.public` map) doesn't reference, stray temp files included. `serial` runs each `fn` after the previous one settles; a rejection reaches only its own caller.
  - Module constants: `TREE`, `FILE_MAX` (8 MB), `ARTIFACT_MAX` (25 MB), `MANIFEST_KEYS`.

- [ ] **Step 1: Write the failing tests**

Append to `test/gateway.test.mjs`:

```js
test('the gateway computes git\'s blob and tree ids from bytes, sha1 and sha256', () => {
  const files = { 'index.html': '<!doctype html>', 'a/b.js': 'b', 'a/c/d.css': 'd', 'a-b.txt': 'x', 'a.txt': 'y', 'run.sh': 'echo' };
  for (const fmt of ['sha1', 'sha256']) {
    const d = fs.mkdtempSync(path.join(tmp, `tree-${fmt}-`));
    if (spawnSync('git', ['init', '-q', `--object-format=${fmt}`, d]).status !== 0) { assert.equal(fmt, 'sha256', 'every git makes a sha1 repo'); continue; }
    for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), text); }
    fs.chmodSync(path.join(d, 'run.sh'), 0o755);
    execFileSync('git', ['-c', 'core.fileMode=true', 'add', '-A'], { cwd: d });
    const want = execFileSync('git', ['write-tree'], { cwd: d, encoding: 'utf8' }).trim();
    const ids = Object.fromEntries(Object.entries(files).map(([rel, text]) => [rel, { oid: G.gitBlobId(Buffer.from(text), fmt), mode: rel === 'run.sh' ? '100755' : '100644' }]));
    assert.equal(ids['a/b.js'].oid, execFileSync('git', ['hash-object', 'a/b.js'], { cwd: d, encoding: 'utf8' }).trim(), `${fmt} blob`);
    assert.equal(G.gitTreeId(ids, fmt), want, `${fmt} tree, sorted as git sorts (a-b.txt, a.txt, a/)`);
  }
  assert.throws(() => G.gitTreeId({ a: { oid: 'a'.repeat(40), mode: '100644' }, 'a/b': { oid: 'a'.repeat(40), mode: '100644' } }), /a is both a file and a folder/);
});

test('a manifest from an instance is checked before anything of it is shown or fetched', () => {
  const entry = { sha256: 'b'.repeat(64), size: 3, mode: '100644' };
  const good = { public: 1, project: 'alpha', slug: 'hello', title: 'Hi', summary: 's', root: '/srv/alpha', tree: 'a'.repeat(40), files: { 'index.html': entry } };
  assert.equal(G.manifestProblem(good, 'hello'), null);
  assert.equal(G.manifestProblem({ ...good, tree: 'a'.repeat(64) }, 'hello'), null, 'a sha256 repo');
  const bad = (over, re, slug = 'hello') => assert.match(String(G.manifestProblem({ ...good, ...over }, slug)), re, JSON.stringify(over).slice(0, 80));
  bad({ public: 2 }, /not a manifest/);
  bad({ project: 'Alpha' }, /project/);
  bad({ project: `a${'b'.repeat(63)}` }, /project/);
  bad({ root: 'srv/alpha' }, /root is not an absolute path/);
  bad({ root: '/srv/\nalpha' }, /root is not an absolute path/);
  bad({}, /the manifest is for hello, not other/, 'other');
  bad({ tree: 'a'.repeat(41) }, /tree/);
  bad({ title: 'x'.repeat(121) }, /title/);
  bad({ extra: 1 }, /unknown key "extra"/);
  bad({ files: {} }, /1 to 2000 files/);
  bad({ files: Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [i ? `f${i}.txt` : 'index.html', entry])) }, /1 to 2000 files/);
  bad({ files: { 'index.html': entry, '.env': entry } }, /\.env: not a path the kit serves/);
  bad({ files: { 'index.html': entry, 'a/../b': entry } }, /not a path the kit serves/);
  bad({ files: { 'index.html': { ...entry, sha256: 'B'.repeat(64) } } }, /index\.html: a bad entry/);
  bad({ files: { 'index.html': { ...entry, size: 8 * 1024 * 1024 + 1 } } }, /a bad entry/);
  bad({ files: { 'index.html': { ...entry, mode: '120000' } } }, /a bad entry/);
  bad({ files: { 'a.js': entry } }, /no index\.html/);
  bad({ files: Object.fromEntries(Array.from({ length: 4 }, (_, i) => [i ? `f${i}.bin` : 'index.html', { ...entry, size: 7 * 1024 * 1024 }])) }, /over 25 MB/);
  assert.equal(G.canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
});

test('the public store: content-addressed blobs, one change at a time, swept to what state.json names', async () => {
  const S = G.publicStore(fs.mkdtempSync(path.join(tmp, 'pstore-')));
  const h = (t) => crypto.createHash('sha256').update(t).digest('hex');
  assert.equal(S.write(h('a'), Buffer.from('a')), true);
  assert.equal(S.write(h('a'), Buffer.from('a')), false, 'a blob is written once');
  S.write(h('b'), Buffer.from('b'));
  fs.writeFileSync(path.join(S.blobs, `${h('c')}.1.abc.tmp`), 'c');
  const pub = { alpha: { root: '/r', port: 1, artifacts: { x: { tree: 't', files: { 'index.html': { sha256: h('a'), size: 1 }, 'copy.html': { sha256: h('a'), size: 1 } } } } } };
  assert.deepEqual([...S.referenced(pub)], [[h('a'), 1]], 'each blob counts once');
  S.sweep(pub);
  assert.deepEqual(fs.readdirSync(S.blobs), [h('a')], 'unreferenced blobs and stray temp files go');
  assert.equal(fs.readFileSync(S.blobPath(h('a')), 'utf8'), 'a');
  const order = [];
  const slow = S.serial(async () => { await new Promise((r) => setTimeout(r, 50)); order.push(1); });
  const failing = S.serial(async () => { order.push(2); throw new Error('no'); });
  const after = S.serial(() => { order.push(3); return 'ok'; });
  await slow;
  await assert.rejects(failing, /no/);
  assert.equal(await after, 'ok', 'a failed change doesn\'t stop the next');
  assert.deepEqual(order, [1, 2, 3]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `~/.asdf/installs/nodejs/18.20.4/bin/node --test --test-name-pattern "git's blob|a manifest from an instance|the public store" test/gateway.test.mjs`
Expected: FAIL, three tests: `G.gitBlobId is not a function`, `G.manifestProblem is not a function`, `G.publicStore is not a function`.

- [ ] **Step 3: Implement**

In `cloud/gateway.mjs`, after Task 6's `const PROJECT = …;` add:

```js
const TREE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const FILE_MAX = 8 * 1024 * 1024;
const ARTIFACT_MAX = 25 * 1024 * 1024;
const MANIFEST_KEYS = ['public', 'project', 'slug', 'title', 'summary', 'root', 'tree', 'files'];
const hex256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
// The kit's canonical JSON: the owner confirms a manifest by its sha256, so both sides hash one text.
export const canonicalJson = (v) => (Array.isArray(v) ? `[${v.map(canonicalJson).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}` : JSON.stringify(v));
// Whatever holds an instance's port wrote this, so it is checked as untrusted data, and only then
// shown (escaped) or followed: every path the kit would serve, every size within the kit's limits.
export function manifestProblem(m, slug) {
  if (!m || typeof m !== 'object' || Array.isArray(m) || m.public !== 1) return 'not a manifest';
  const extra = Object.keys(m).find((k) => !MANIFEST_KEYS.includes(k));
  if (extra) return `unknown key "${extra.slice(0, 40)}"`;
  if (typeof m.project !== 'string' || !PROJECT.test(m.project)) return 'the project name is not one a public link can carry';
  if (typeof m.root !== 'string' || !m.root.startsWith('/') || m.root.length > 1024 || /[\u0000-\u001f\u007f]/.test(m.root)) return 'root is not an absolute path';
  if (m.slug !== slug) return `the manifest is for ${String(m.slug).slice(0, 80)}, not ${slug}`;
  if (typeof m.tree !== 'string' || !TREE.test(m.tree)) return 'tree is not a git tree id';
  if (typeof m.title !== 'string' || m.title.length > 120 || typeof m.summary !== 'string' || m.summary.length > 500) return 'title or summary is not the kit\'s one line of text';
  const files = m.files && typeof m.files === 'object' && !Array.isArray(m.files) ? Object.entries(m.files) : [];
  if (!files.length || files.length > 2000) return 'a manifest lists 1 to 2000 files';
  let total = 0;
  for (const [rel, f] of files) {
    if (!publicPathOk(rel)) return `${rel.slice(0, 120)}: not a path the kit serves`;
    if (!f || typeof f !== 'object' || typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256) || !Number.isInteger(f.size) || f.size < 0 || f.size > FILE_MAX || !['100644', '100755'].includes(f.mode)) return `${rel}: a bad entry (sha256, a size up to 8 MB, mode 100644 or 100755)`;
    total += f.size;
  }
  if (total > ARTIFACT_MAX) return 'over 25 MB in all';
  if (!Object.hasOwn(m.files, 'index.html')) return 'no index.html';
  return null;
}
// git's own object ids, from the bytes: the record then names a tree git can check against main.
export const gitBlobId = (buf, algo = 'sha1') => crypto.createHash(algo).update(`blob ${buf.length}\0`).update(buf).digest('hex');
export function gitTreeId(files, algo = 'sha1') {
  const root = new Map();
  for (const [rel, f] of Object.entries(files)) {
    const parts = rel.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.has(parts[i])) node.set(parts[i], new Map());
      node = node.get(parts[i]);
      if (!(node instanceof Map)) throw new Error(`${parts.slice(0, i + 1).join('/')} is both a file and a folder`);
    }
    if (node.get(parts.at(-1)) instanceof Map) throw new Error(`${rel} is both a file and a folder`);
    node.set(parts.at(-1), f);
  }
  // git sorts a tree's entries by name, a folder's name as if it ended in "/"
  const write = (node) => {
    const entries = [...node].map(([name, v]) => (v instanceof Map ? { name, key: `${name}/`, mode: '40000', oid: write(v) } : { name, key: name, mode: v.mode, oid: v.oid }));
    entries.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
    const body = Buffer.concat(entries.flatMap((e) => [Buffer.from(`${e.mode} ${e.name}\0`), Buffer.from(e.oid, 'hex')]));
    return crypto.createHash(algo).update(`tree ${body.length}\0`).update(body).digest('hex');
  };
  return write(root);
}
// The published bytes, content-addressed under the gateway's own directory (no agent can write
// there), and the one queue every change to them and to state.json's public map runs through.
export function publicStore(dir) {
  const blobs = path.join(dir, 'public', 'blobs');
  const blobPath = (sha) => path.join(blobs, sha);
  let queue = Promise.resolve();
  const referenced = (pub) => {
    const m = new Map();
    for (const p of Object.values(pub ?? {})) for (const a of Object.values(p?.artifacts ?? {})) for (const f of Object.values(a?.files ?? {})) m.set(f.sha256, f.size);
    return m;
  };
  return {
    blobs,
    blobPath,
    serial: (fn) => { const run = queue.then(() => fn()); queue = run.catch(() => {}); return run; },
    referenced,
    write: (sha, buf) => {
      if (fs.existsSync(blobPath(sha))) return false;
      fs.mkdirSync(blobs, { recursive: true, mode: 0o700 });
      const tmpFile = `${blobPath(sha)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
      fs.writeFileSync(tmpFile, buf, { mode: 0o600 });
      fs.renameSync(tmpFile, blobPath(sha));
      return true;
    },
    // only ever inside the queue, so no temp file is still being written
    sweep: (pub) => {
      const keep = referenced(pub);
      let names = [];
      try { names = fs.readdirSync(blobs); } catch { return; }
      for (const n of names) if (!keep.has(n)) fs.rmSync(path.join(blobs, n), { force: true });
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `~/.asdf/installs/nodejs/18.20.4/bin/node --test test/gateway.test.mjs`
Expected: PASS; `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add cloud/gateway.mjs test/gateway.test.mjs
git commit -m "Gateway: the public store and its queue, a manifest's checks, and git's ids from bytes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The confirm page and the publish: GET and POST https://<box>/public/publish

**Files:**
- Modify: `cloud/gateway.mjs`: module level (`fmtSize`, `STYLE`, `PAGES.publish`); inside `createGateway`: after `servePublic` (Task 6) and in the box section of the request handler (before its final `return send(res, 404, 'text/plain', 'not found');`, ~463)
- Test: `test/gateway.test.mjs` (append)

**Interfaces:**
- Consumes: `PUBLIC`, `LINK_ID`, `PROJECT` (Task 6); `canonicalJson`, `manifestProblem`, `gitBlobId`, `gitTreeId`, `publicStore` (Task 7); the kit's `GET /public-manifest/<slug>`, `GET /artifact/main/<slug>/<rel>`, `POST /api/artifact-publish` (Tasks 3-4).
- Produces (inside `createGateway`):
  - `pstore = publicStore(dir)`, `PUBLIC_MAX` (`opts.publicMax ?? env.DEVTEAM_PUBLIC_MAX ?? 524288000`), `LOOP_MS` (`opts.publicDeadlineMs ?? 15000`).
  - `loopback(port, method, path, { body = null, cap = 2 MB }) => Promise<{ status, body: Buffer }>`: rejects past `cap` bytes, on a broken connection, or after `LOOP_MS` for the whole answer.
  - `errorOf(r) => string`, `fetchManifest(port, slug) => Promise<manifest>` (throws with why), `manifestHash(m) => string` (hex sha256 of `canonicalJson(m)`).
  - `publishItem(port, { slug, manifest, move }) => Promise<{ url, update }>`, run only through `pstore.serial`.
  - Routes: `GET /public/publish?port=<p>&slug=<s>[&slug=…]` (a page; each item's checkbox carries `data-slug="<slug>" data-manifest="<sha256>"`, in that order; a moved project's item has `<input type="checkbox" data-move="<slug>">`), `POST /public/publish` with `{ port, items: [{ slug, manifest, move }] }` answering `{ results: [{ slug, ok: true, url, update } | { slug, ok: false, error }] }`.
- Produces (tests): `standIn(port, arts, { project = 'beta', root = '/srv/beta' })`, `confirmAndPublish(gw, port, slugs, { move, before })`, `blobsOf(gw)`, `landedProject(base, name, artifacts)`, `startKit(root, port)`, `kitUp(port)`, `HELLO`.

- [ ] **Step 1: Write the failing tests**

Append to `test/gateway.test.mjs`:

```js
// A stand-in instance on a block port: the manifest and files it is given, and what the gateway
// asked it to record. lie serves other bytes for a file than its manifest names; tree and title
// override what the manifest says; reset puts back what it was made with.
function standIn(port, arts, { project = 'beta', root = '/srv/beta' } = {}) {
  const made = JSON.stringify({ arts, project, root });
  const S = { recorded: [] };
  S.reset = () => Object.assign(S, JSON.parse(made), { lie: {}, tree: {}, title: {} });
  S.reset();
  const hex = (t) => crypto.createHash('sha256').update(t).digest('hex');
  S.manifest = (slug) => {
    const files = Object.fromEntries(Object.entries(S.arts[slug]).map(([rel, t]) => [rel, { sha256: hex(Buffer.from(t)), size: Buffer.byteLength(t), mode: '100644' }]));
    const tree = G.gitTreeId(Object.fromEntries(Object.entries(S.arts[slug]).map(([rel, t]) => [rel, { oid: G.gitBlobId(Buffer.from(t)), mode: '100644' }])));
    return { public: 1, project: S.project, slug, title: S.title[slug] ?? `The ${slug}`, summary: 's', root: S.root, tree: S.tree[slug] ?? tree, files };
  };
  const srv = http.createServer((req, res) => {
    const reply = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(body); };
    let m;
    if (req.method === 'GET' && (m = /^\/public-manifest\/([a-z0-9-]+)$/.exec(req.url))) return Object.hasOwn(S.arts, m[1]) ? reply(200, JSON.stringify(S.manifest(m[1]))) : reply(404, '{"error":"not an artifact landed on main"}');
    if (req.method === 'GET' && (m = /^\/artifact\/main\/([a-z0-9-]+)\/(.+)$/.exec(req.url)) && Object.hasOwn(S.arts, m[1]) && Object.hasOwn(S.arts[m[1]], m[2])) return reply(200, S.lie[`${m[1]}/${m[2]}`] ?? S.arts[m[1]][m[2]], 'text/plain');
    if (req.method === 'GET' && req.url === '/api/hello') return reply(200, JSON.stringify({ devteam: 1, name: S.project, root: S.root, port }));
    if (req.method === 'POST' && req.url === '/api/artifact-publish') {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => { S.recorded.push({ ...JSON.parse(b), headers: req.headers }); reply(200, '{"ok":true}'); });
      return;
    }
    reply(404, '{"error":"not found"}');
  }).listen(port, '127.0.0.1');
  S.close = () => new Promise((r) => srv.close(r));
  return S;
}
// The owner's two steps: the gateway's confirm page, then its POST of what the page showed.
async function confirmAndPublish(gw, port, slugs, { move = false, before = async () => {} } = {}) {
  const page = await gw.req('GET', `/public/publish?port=${port}&${slugs.map((s) => `slug=${s}`).join('&')}`);
  assert.equal(page.status, 200, page.body);
  const items = [...page.body.matchAll(/data-slug="([^"]+)" data-manifest="([0-9a-f]{64})"/g)].map(([, slug, manifest]) => ({ slug, manifest, move }));
  await before();
  const r = await gw.req('POST', '/public/publish', { body: { port, items } });
  assert.equal(r.status, 200, r.body);
  return { page, results: r.json.results };
}
const blobsOf = (gw) => { try { return fs.readdirSync(path.join(gw.dir, 'public', 'blobs')).sort(); } catch { return []; } };
// A project with artifacts landed on its main, as merge would leave them, and its dashboard.
function landedProject(base, name, artifacts) {
  const r = bareProject(base, name);
  for (const [slug, files] of Object.entries(artifacts)) for (const [rel, text] of Object.entries(files)) {
    const f = path.join(r, 'docs/devteam/project/artifacts', slug, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  execFileSync('git', ['add', '-A'], { cwd: r });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'land'], { cwd: r });
  return r;
}
function startKit(root, port) {
  const env = { ...process.env };
  delete env.DEVTEAM_ROLE;
  const d = spawn(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), 'dashboard', '--port', String(port)], { cwd: root, env, stdio: 'ignore' });
  return { d, stop: () => new Promise((r) => { if (d.exitCode !== null) return r(); d.on('close', r); d.kill(); }) };
}
const kitUp = (port) => until(async () => { try { return (await fetch(`http://127.0.0.1:${port}/api/hello`)).ok; } catch { return false; } }, `the dashboard on ${port}`);
const HELLO = { 'index.html': '<!doctype html><link rel="stylesheet" href="s.css"><p>hello', 's.css': 'p { color: red }', 'artifact.json': JSON.stringify({ v: 1, title: 'A <b>mock</b> & more', summary: 'For anyone', by: 'supervisor' }) };

test('public artifacts: the owner confirms on the box\'s own page, and anyone reads the gateway\'s copy', async () => {
  const gw = await gateway('public-kit');
  const A = landedProject(fs.mkdtempSync(path.join(tmp, 'pub-')), 'alpha', { hello: HELLO });
  const kitA = startKit(A, P + 1);
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    await kitUp(P + 1);
    const at = `/public/publish?port=${P + 1}&slug=hello`;
    // the confirm page is the gateway's, for the signed-in owner, on the box's own name
    assert.equal((await gw.req('GET', at, { cookie: '' })).status, 401);
    assert.equal((await gw.req('GET', `/public/publish?port=${P + 99}&slug=hello`)).status, 400, 'an instance of this box');
    assert.equal((await gw.req('GET', `/public/publish?port=${P + 1}&slug=Hello`)).status, 400, 'a slug');
    const conf = await gw.req('GET', at);
    assert.equal(conf.status, 200, conf.body);
    assert.ok(conf.headers['content-security-policy'].split('; ').includes("form-action 'none'"));
    assert.match(conf.body, /alpha · hello · 3 files/);
    assert.ok(conf.body.includes('A &#60;b&#62;mock&#60;/b&#62; &#38; more'), 'the title, escaped');
    assert.ok(!conf.body.includes('<b>mock</b>'));
    assert.ok(conf.body.includes(`${gw.site}/alpha/hello/`), 'the link it will have');
    assert.match(conf.body, /new on this box/);
    assert.doesNotMatch(conf.body, /autofocus/, 'the Publish button never has focus waiting');
    const items = [...conf.body.matchAll(/data-slug="([^"]+)" data-manifest="([0-9a-f]{64})"/g)].map(([, slug, manifest]) => ({ slug, manifest }));
    assert.equal(items.length, 1);
    // only from the box's own page, and only signed in
    assert.equal((await gw.req('POST', '/public/publish', { body: { port: P + 1, items }, headers: { origin: gw.inst(P + 1) } })).status, 403, 'not from an instance\'s name');
    assert.equal((await gw.req('POST', '/public/publish', { body: { port: P + 1, items }, cookie: '' })).status, 401);
    assert.equal((await gw.req('POST', '/public/publish', { body: { port: P + 1, items: [{ slug: 'hello', manifest: 'x' }] } })).status, 400);
    const r = await gw.req('POST', '/public/publish', { body: { port: P + 1, items } });
    assert.equal(r.status, 200, r.body);
    assert.deepEqual(r.json.results, [{ slug: 'hello', ok: true, url: `${gw.site}/alpha/hello/`, update: false }]);
    // anyone reads it, under the gateway's own headers
    const pubGet = (route, opts = {}) => gw.req('GET', route, { on: 'public', cookie: '', ...opts });
    let p = await pubGet('/alpha/hello/');
    assert.deepEqual([p.status, p.body, p.headers['set-cookie']], [200, HELLO['index.html'], undefined]);
    assert.ok(p.headers['content-security-policy'].includes(`script-src 'unsafe-inline' 'unsafe-eval' ${gw.site}/alpha/hello/ `));
    assert.equal(p.headers.etag, `"${crypto.createHash('sha256').update(HELLO['index.html']).digest('hex')}"`);
    assert.equal((await pubGet('/alpha/hello/s.css')).body, HELLO['s.css']);
    assert.equal((await pubGet('/alpha/hello/', { headers: { 'if-none-match': p.headers.etag } })).status, 304);
    assert.equal((await gw.req('HEAD', '/alpha/hello/', { on: 'public', cookie: '' })).body, '');
    assert.equal((await gw.req('POST', '/alpha/hello/', { on: 'public', body: {} })).status, 405);
    // the kit has the owner's act for it, from the dashboard, naming main's tree
    const env = { ...process.env };
    delete env.DEVTEAM_ROLE;
    const acts = JSON.parse(execFileSync(process.execPath, [path.join(A, 'docs/devteam/scripts/devteam.mjs'), 'log', '--type', 'act', '--by', 'owner', '--json'], { cwd: A, env, encoding: 'utf8' }));
    const T = execFileSync('git', ['rev-parse', 'main:docs/devteam/project/artifacts/hello'], { cwd: A, encoding: 'utf8' }).trim();
    assert.deepEqual(acts.map((a) => [a.class, a.what, a.artifact, a.tree, a.channel]), [['artifact-publish', 'publish', 'hello', T, 'dashboard']]);
    // after a publish nothing on the box is trusted again: the kit gone, an impostor on its port
    await kitA.stop();
    const impostor = http.createServer((q, s) => s.end('evil')).listen(P + 1, '127.0.0.1');
    try {
      p = await pubGet('/alpha/hello/');
      assert.deepEqual([p.status, p.body], [200, HELLO['index.html']]);
    } finally { await new Promise((res) => impostor.close(res)); }
    assert.match(gw.logs.join('\n'), /public: hello published from instance/);
  } finally { await kitA.stop(); await gw.close(); }
});

test('public artifacts: a publish is refused unless every byte, the tree and the manifest are what the owner confirmed', async () => {
  const gw = await gateway('public-refuse');
  const S = standIn(P + 10, { a: { 'index.html': '<p>a', 'x/y.js': 'y()' }, b: { 'index.html': '<p>b' } });
  const pubGet = (route) => gw.req('GET', route, { on: 'public', cookie: '' });
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    // an instance that serves other bytes than its manifest names
    S.lie['a/x/y.js'] = 'z()'; // as long as the real one, so only its hash tells
    let { results } = await confirmAndPublish(gw, P + 10, ['a']);
    assert.match(results[0].error, /x\/y\.js is not the file the manifest names/);
    assert.deepEqual(blobsOf(gw), [], 'nothing of it is kept');
    assert.equal((await pubGet('/beta/a/')).status, 404);
    S.reset();
    // a manifest whose tree the bytes don't make
    S.tree.a = 'c'.repeat(40);
    ({ results } = await confirmAndPublish(gw, P + 10, ['a']));
    assert.match(results[0].error, /the files don't make the tree cccccccccccc/);
    S.reset();
    // a manifest that changed between the page and the POST: its title, its project, a file
    for (const change of [() => { S.title.a = 'Another title'; }, () => { S.project = 'gamma'; }, () => { S.arts.a['index.html'] = '<p>a2'; }]) {
      ({ results } = await confirmAndPublish(gw, P + 10, ['a'], { before: async () => change() }));
      assert.match(results[0].error, /this changed since you looked; reload the page/);
      S.reset();
    }
    assert.deepEqual(blobsOf(gw), []);
    assert.equal(S.recorded.length, 0, 'the kit was never asked to record any of them');
    // a manifest that breaks the rules is never offered
    S.arts.a['.env'] = 'secret';
    const bad = await gw.req('GET', `/public/publish?port=${P + 10}&slug=a`);
    assert.match(bad.body, /\.env: not a path the kit serves/);
    assert.doesNotMatch(bad.body, /data-manifest=/);
    S.reset();
    // two publishes at once, of different slugs: both end up served
    const [x, y] = await Promise.all([confirmAndPublish(gw, P + 10, ['a']), confirmAndPublish(gw, P + 10, ['b'])]);
    assert.ok(x.results[0].ok && y.results[0].ok, JSON.stringify([x.results, y.results]));
    assert.equal((await pubGet('/beta/a/x/y.js')).body, 'y()');
    assert.equal((await pubGet('/beta/b/')).body, '<p>b');
    assert.deepEqual(S.recorded.map((r) => [r.op, r.slug, r.tree.length, r.headers.origin, r.headers['sec-fetch-site'], r.headers.cookie]).sort(), [['publish', 'a', 40, undefined, undefined, undefined], ['publish', 'b', 40, undefined, undefined, undefined]], 'recorded through a loopback request');
    assert.equal(blobsOf(gw).length, 3);
    // the same tree again is no change; another tree is an update
    let again = await confirmAndPublish(gw, P + 10, ['b']);
    assert.match(again.page.body, /already public at this version/);
    S.arts.b['index.html'] = '<p>b2';
    again = await confirmAndPublish(gw, P + 10, ['b']);
    assert.match(again.page.body, /an update/);
    assert.equal(again.results[0].update, true);
    assert.equal((await pubGet('/beta/b/')).body, '<p>b2');
    assert.equal(blobsOf(gw).length, 3, 'the old version\'s blob is swept');
  } finally { await S.close(); await gw.close(); }
});

test('public artifacts: a project stays with its checkout unless the owner moves it; a new port is no move', async () => {
  const gw = await gateway('public-bind');
  const one = standIn(P + 11, { a: { 'index.html': '<p>one' } }, { root: '/srv/one' });
  const two = standIn(P + 12, { a: { 'index.html': '<p>two' } }, { root: '/srv/two' });
  const twoAgain = standIn(P + 13, { a: { 'index.html': '<p>two' } }, { root: '/srv/two' });
  const served = async () => (await gw.req('GET', '/beta/a/', { on: 'public', cookie: '' })).body;
  const bound = () => JSON.parse(fs.readFileSync(path.join(gw.dir, 'state.json'), 'utf8')).public.beta;
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    assert.ok((await confirmAndPublish(gw, P + 11, ['a'])).results[0].ok);
    const moved = await confirmAndPublish(gw, P + 12, ['a']);
    assert.ok(moved.page.body.includes('beta is published from /srv/one; this instance is /srv/two'), moved.page.body);
    assert.match(moved.page.body, /<input type="checkbox" data-move="a"> move it/, '"move it" is unchecked');
    assert.match(moved.results[0].error, /beta is published from \/srv\/one; this instance is \/srv\/two: tick "move it"/);
    assert.equal(await served(), '<p>one');
    assert.equal(two.recorded.length, 0);
    assert.ok((await confirmAndPublish(gw, P + 12, ['a'], { move: true })).results[0].ok);
    assert.equal(await served(), '<p>two');
    assert.deepEqual([bound().root, bound().port], ['/srv/two', P + 12]);
    const port = await confirmAndPublish(gw, P + 13, ['a']);
    assert.doesNotMatch(port.page.body, /data-move/, 'the same checkout on another port');
    assert.ok(port.results[0].ok);
    assert.deepEqual([bound().root, bound().port], ['/srv/two', P + 13]);
  } finally { await one.close(); await two.close(); await twoAgain.close(); await gw.close(); }
});

test('public artifacts: the box holds at most DEVTEAM_PUBLIC_MAX bytes for the public', async () => {
  const gw = await gateway('public-cap', { publicMax: 10 });
  const S = standIn(P + 14, { small: { 'index.html': '<p>12345' }, big: { 'index.html': '<p>more than ten bytes' } });
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    assert.ok((await confirmAndPublish(gw, P + 14, ['small'])).results[0].ok);
    const { results } = await confirmAndPublish(gw, P + 14, ['big']);
    assert.match(results[0].error, /over the box's public cap of 10 bytes \(DEVTEAM_PUBLIC_MAX\)/);
    assert.equal(blobsOf(gw).length, 1, 'refused before anything is written');
    assert.deepEqual(S.recorded.map((r) => r.slug), ['small']);
  } finally { await S.close(); await gw.close(); }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `~/.asdf/installs/nodejs/18.20.4/bin/node --test --test-name-pattern "public artifacts:" test/gateway.test.mjs`
Expected: FAIL, four tests: `/public/publish` falls through to the box's `404 not found` (the first test at the `400` for port `P + 99`, the others in `confirmAndPublish`'s `assert.equal(page.status, 200)`).

- [ ] **Step 3: The page**

In `cloud/gateway.mjs`, in `STYLE`, replace the last rule line `#err{color:var(--red)}li{…}ul{padding:0;list-style:none}a{color:inherit}` with:

```js
#err{color:var(--red)}li{margin:6px 0;display:flex;gap:8px;align-items:center;justify-content:space-between}ul{padding:0;list-style:none}a{color:inherit}
li.pub{display:block;padding:8px 0;border-bottom:1px solid var(--line)}li.pub small,li.pub code,li.pub span{display:block;color:var(--fg2);overflow-wrap:anywhere}
```

After `const jsonIn = …;` add:

```js
const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
```

In `PAGES`, after `passkeys: …,` add:

```js
  // Each item from the manifest the gateway fetched itself, escaped; its state from the gateway's
  // own copy; ticked by default, except "move it". The POST binds each item to the manifest shown.
  publish: (port, rows) => `${doc('Publish', `<h1>Publish to anyone</h1><p>Anyone with a link below can read that page, with no sign-in. The box keeps its own copy of exactly what is listed here; a later change on main reaches the public only when you publish again. From instance ${esc(port)}.</p><ul>${rows.map((r) => (r.error ? `<li class="pub"><b>${esc(r.slug)}</b><span>${esc(r.error)}</span></li>` : `<li class="pub"><label><input type="checkbox" data-slug="${esc(r.slug)}" data-manifest="${esc(r.hash)}" checked> <b>${esc(r.m.title)}</b></label><small>${esc(r.m.project)} · ${esc(r.slug)} · ${esc(Object.keys(r.m.files).length)} files, ${esc(fmtSize(Object.values(r.m.files).reduce((n, f) => n + f.size, 0)))} · ${esc(r.state)}</small><code>${esc(r.url)}</code>${r.movedFrom ? `<span>${esc(r.m.project)} is published from ${esc(r.movedFrom)}; this instance is ${esc(r.m.root)}. <label><input type="checkbox" data-move="${esc(r.slug)}"> move it</label></span>` : ''}</li>`)).join('')}</ul>${rows.some((r) => !r.error) ? '<p><button id="go">Publish</button></p>' : ''}<p id="err"></p><ul id="out"></ul>`)}
<script>
const PORT = ${jsonIn(port)};
const go = document.getElementById('go');
if (go) go.onclick = run(async () => {
  const moves = [...document.querySelectorAll('input[data-move]')];
  const items = [...document.querySelectorAll('input[data-manifest]')].filter((x) => x.checked).map((x) => ({ slug: x.dataset.slug, manifest: x.dataset.manifest, move: moves.some((m) => m.dataset.move === x.dataset.slug && m.checked) }));
  if (!items.length) return err('Nothing is ticked.');
  go.disabled = true;
  try {
    const r = await post('/public/publish', { port: PORT, items });
    document.getElementById('out').replaceChildren(...r.results.map((x) => {
      const li = document.createElement('li');
      if (!x.ok) { li.textContent = x.slug + ': refused: ' + x.error; return li; }
      const a = document.createElement('a');
      a.href = x.url; a.textContent = x.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      li.append(x.slug + (x.update ? ': updated at ' : ': public at '), a);
      return li;
    }));
  } finally { go.disabled = false; }
});
</script></body></html>`,
```

- [ ] **Step 4: Fetch, verify, keep**

In `createGateway`, after `servePublic` (Task 6) add:

```js
  // --- publishing: only from the gateway's own page on the box's name, of bytes it checked itself ---
  const pstore = publicStore(dir);
  const PUBLIC_MAX = Number(opts.publicMax ?? env.DEVTEAM_PUBLIC_MAX ?? 500 * 1024 * 1024);
  const LOOP_MS = opts.publicDeadlineMs ?? 15000;
  // A request to an instance as a loopback client: its own Host, and no Origin, sec-fetch-* or
  // cookie, so it never passes for the owner's browser. One deadline for the whole answer, and a
  // cap on its size: whatever holds the port wrote it.
  const loopback = (port, method, p, { body = null, cap = 2 * 1024 * 1024 } = {}) => new Promise((resolve, reject) => {
    let deadline = null;
    let settled = false;
    const finish = (err, v) => { if (settled) return; settled = true; clearTimeout(deadline); if (err) reject(err); else resolve(v); };
    const headers = { host: `127.0.0.1:${port}`, ...(body === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }) };
    const up = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (ur) => {
      const chunks = [];
      let size = 0;
      ur.on('data', (c) => { size += c.length; if (size > cap) { up.destroy(); finish(new Error(`instance ${port} sent more than ${cap} bytes for ${p}`)); } else chunks.push(c); });
      ur.on('end', () => finish(null, { status: ur.statusCode, body: Buffer.concat(chunks) }));
      ur.on('error', () => finish(new Error(`instance ${port} broke off its answer to ${p}`)));
      ur.on('close', () => finish(new Error(`instance ${port} broke off its answer to ${p}`)));
    });
    up.on('error', () => finish(new Error(`nothing answers on instance ${port}`)));
    deadline = setTimeout(() => { up.destroy(); finish(new Error(`instance ${port} took over ${LOOP_MS / 1000} s to answer ${p}`)); }, LOOP_MS);
    up.end(body ?? undefined);
  });
  const errorOf = (r) => { try { return String(JSON.parse(r.body.toString('utf8')).error ?? `HTTP ${r.status}`).slice(0, 300); } catch { return `HTTP ${r.status}`; } };
  const fetchManifest = async (port, slug) => {
    const r = await loopback(port, 'GET', `/public-manifest/${slug}`);
    if (r.status !== 200) throw new Error(`instance ${port}: ${errorOf(r)}`);
    let m;
    try { m = JSON.parse(r.body.toString('utf8')); } catch { throw new Error(`instance ${port} sent a manifest that isn't JSON`); }
    const why = manifestProblem(m, slug);
    if (why) throw new Error(`instance ${port}'s manifest for ${slug}: ${why}`);
    return m;
  };
  const manifestHash = (m) => hex256(canonicalJson(m));
  // One confirmed item, inside the queue. Bound to the manifest the owner saw (its sha256), every
  // file to the manifest, the tree id to the bytes; anything off refuses this item, and the sweep
  // after it drops whatever it wrote.
  const publishItem = async (port, item) => {
    const m = await fetchManifest(port, item.slug);
    if (manifestHash(m) !== item.manifest) throw new Error('this changed since you looked; reload the page');
    const before = store.load().public ?? {};
    const bound = Object.hasOwn(before, m.project) ? before[m.project] : null;
    if (bound && bound.root !== m.root && item.move !== true) throw new Error(`${m.project} is published from ${bound.root}; this instance is ${m.root}: tick "move it" to publish it from here`);
    // the cap, on what the box would hold after this item (its old version aside)
    const after = { ...before, [m.project]: { ...(bound ?? {}), artifacts: { ...(bound?.artifacts ?? {}) } } };
    delete after[m.project].artifacts[m.slug];
    const sizes = pstore.referenced(after);
    for (const f of Object.values(m.files)) sizes.set(f.sha256, f.size);
    const total = [...sizes.values()].reduce((n, s) => n + s, 0);
    if (total > PUBLIC_MAX) throw new Error(`publishing it would hold ${total} bytes, over the box's public cap of ${PUBLIC_MAX} bytes (DEVTEAM_PUBLIC_MAX)`);
    const algo = m.tree.length === 40 ? 'sha1' : 'sha256';
    const bytes = new Map();
    const ids = Object.create(null);   // a file may be named __proto__
    for (const [rel, f] of Object.entries(m.files)) {
      const r = await loopback(port, 'GET', `/artifact/main/${m.slug}/${rel}`, { cap: f.size });
      if (r.status !== 200 || r.body.length !== f.size || hex256(r.body) !== f.sha256) throw new Error(`${rel} is not the file the manifest names (its bytes differ); nothing was published`);
      bytes.set(f.sha256, r.body);
      ids[rel] = { oid: gitBlobId(r.body, algo), mode: f.mode };
    }
    if (gitTreeId(ids, algo) !== m.tree) throw new Error(`the files don't make the tree ${m.tree.slice(0, 12)} the manifest names; nothing was published`);
    for (const [sha, buf] of bytes) pstore.write(sha, buf);
    const k = await loopback(port, 'POST', '/api/artifact-publish', { body: JSON.stringify({ op: 'publish', slug: m.slug, tree: m.tree }) });
    if (k.status !== 200) throw new Error(`the kit didn't record it, so it wasn't published: ${errorOf(k)}`);
    // load, change and save with nothing awaited in between
    const now = store.load();
    const pub = { ...(now.public ?? {}) };
    const prev = Object.hasOwn(pub, m.project) ? pub[m.project] : null;
    const update = !!prev && Object.hasOwn(prev.artifacts ?? {}, m.slug);
    pub[m.project] = { root: m.root, port, artifacts: { ...(prev && prev.root === m.root ? prev.artifacts : {}), [m.slug]: { tree: m.tree, title: m.title, at: new Date().toISOString(), files: Object.fromEntries(Object.entries(m.files).map(([rel, f]) => [rel, { sha256: f.sha256, size: f.size }])) } } };
    store.save({ ...now, public: pub });
    return { url: `${PUBLIC}/${m.project}/${m.slug}/`, update };
  };
```

- [ ] **Step 5: The routes**

In the request handler's box section, directly before its final `return send(res, 404, 'text/plain', 'not found');` (after the `/push/test` handler), add:

```js
      // Publishing: the gateway's own page, from the manifest it fetched itself, then a POST of what
      // that page showed (only from this page: the Origin rule above refuses any other).
      if (req.method === 'GET' && p === '/public/publish') {
        const port = Number(url.searchParams.get('port'));
        const slugs = [...new Set(url.searchParams.getAll('slug'))];
        if (!BLOCK.includes(port) || !slugs.length || slugs.length > 50 || !slugs.every((x) => LINK_ID.test(x))) return send(res, 400, 'text/plain; charset=utf-8', 'publish?port=<an instance of this box>&slug=<slug>[&slug=…], at most 50');
        const pub = store.load().public ?? {};
        // at most four manifests at a time: each is a node child on the instance, and Restore all asks for up to 50
        const rows = await mapPool(slugs, 4, async (slug) => {
          try {
            const m = await fetchManifest(port, slug);
            const bound = Object.hasOwn(pub, m.project) ? pub[m.project] : null;
            const now = bound && Object.hasOwn(bound.artifacts ?? {}, slug) ? bound.artifacts[slug] : null;
            return { slug, m, hash: manifestHash(m), url: `${PUBLIC}/${m.project}/${slug}/`, state: !now ? 'new on this box' : now.tree === m.tree ? 'already public at this version' : 'an update', movedFrom: bound && bound.root !== m.root ? bound.root : null };
          } catch (e) { return { slug, error: e.message }; }
        });
        return page(res, PAGES.publish(port, rows));
      }
      if (req.method === 'POST' && p === '/public/publish') {
        const body = await readJson(req);
        const port = Number(body?.port);
        const items = Array.isArray(body?.items) ? body.items : [];
        if (!BLOCK.includes(port) || !items.length || items.length > 50 || !items.every((x) => x && typeof x.slug === 'string' && LINK_ID.test(x.slug) && typeof x.manifest === 'string' && /^[0-9a-f]{64}$/.test(x.manifest))) return json(res, 400, { error: 'publish takes { port, items: [{ slug, manifest, move }] }, 1 to 50 items' });
        const results = [];
        for (const it of items) {
          try { results.push({ slug: it.slug, ok: true, ...(await pstore.serial(() => publishItem(port, it).finally(() => { try { pstore.sweep(store.load().public); } catch {} }))) }); }
          catch (e) { results.push({ slug: it.slug, ok: false, error: e.message }); }
        }
        log(`public: ${results.map((x) => `${x.slug} ${x.ok ? 'published' : 'refused'}`).join(', ')} from instance ${port}`);
        return json(res, 200, { results });
      }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `~/.asdf/installs/nodejs/18.20.4/bin/node --test test/gateway.test.mjs`
Expected: PASS, every test; `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add cloud/gateway.mjs test/gateway.test.mjs
git commit -m "Gateway: publish from its own confirm page, keeping a copy checked byte for byte against main's tree

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Unpublish, and the list of what is public

**Files:**
- Modify: `cloud/gateway.mjs`: `PAGES` (`unpublish`, `publicList`); inside `createGateway`: after `publishItem` (Task 8) and in the box section after Task 8's routes
- Test: `test/gateway.test.mjs` (append)

**Interfaces:**
- Consumes: `pstore`, `loopback`, `errorOf`, `PUBLIC`, `PROJECT`, `LINK_ID` (Tasks 6-8); the kit's `/public-manifest/`, `/api/hello` (`{ name, root }`) and `POST /api/artifact-publish {op:'unpublish', slug}`.
- Produces:
  - `recordUnpublish(port, project, root, slug) => Promise<void>`: throws unless that port's manifest (or, for a slug no longer on main, its hello) names `project` at `root`, or when the kit refuses.
  - `GET /public/unpublish?project=<n>&slug=<s>[&port=<p>]` (or `?port=<p>&slug=<s>`, the project then taken from the gateway's state when exactly one project last seen on that port serves the slug): a page. `POST /public/unpublish` with `{ project, slug, port? }` answering `{ ok: true, recorded: boolean, note: string | null }`, 404 when it isn't public.
  - `GET /public/` (and `/public`): the list page; each row links `/public/unpublish?project=<n>&slug=<s>` (escaped as `&#38;`).

- [ ] **Step 1: Write the failing test**

Append to `test/gateway.test.mjs`:

```js
test('public artifacts: unpublish takes a page down at once, and records it only where that project is', async () => {
  const gw = await gateway('public-down');
  const S = standIn(P + 15, { a: { 'index.html': '<p>a' }, b: { 'index.html': '<p>b' }, c: { 'index.html': '<p>c' } });
  const other = standIn(P + 16, {}, { root: '/srv/elsewhere' });
  const pubStatus = async (route) => (await gw.req('GET', route, { on: 'public', cookie: '' })).status;
  const down = (body, opts = {}) => gw.req('POST', '/public/unpublish', { body, ...opts });
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    for (const s of ['a', 'b']) assert.ok((await confirmAndPublish(gw, P + 15, [s])).results[0].ok);
    // the confirm page names it from the gateway's own state
    const pg = await gw.req('GET', `/public/unpublish?port=${P + 15}&project=beta&slug=a`);
    assert.equal(pg.status, 200);
    assert.match(pg.body, /The a/);
    assert.ok(pg.body.includes(`${gw.site}/beta/a/`));
    assert.equal((await gw.req('GET', `/public/unpublish?port=${P + 15}&slug=a`)).status, 200, 'the project from the port it was last seen on');
    assert.equal((await gw.req('GET', '/public/unpublish?project=beta&slug=zzz')).status, 404);
    assert.equal((await gw.req('GET', `/public/unpublish?project=beta&slug=a`, { cookie: '' })).status, 401);
    assert.equal((await down({ project: 'beta', slug: 'a', port: P + 15 }, { headers: { origin: gw.inst(P + 15) } })).status, 403, 'not from an instance\'s name');
    assert.equal((await down({ project: 'beta', slug: 'a' }, { cookie: '' })).status, 401);
    let r = await down({ project: 'beta', slug: 'a', port: P + 15 });
    assert.deepEqual([r.status, r.json.recorded], [200, true], r.body);
    assert.deepEqual([S.recorded.at(-1).op, S.recorded.at(-1).slug, S.recorded.at(-1).headers.origin], ['unpublish', 'a', undefined]);
    assert.equal(await pubStatus('/beta/a/'), 404);
    assert.equal(await pubStatus('/beta/a'), 404, 'no redirect once it is down');
    assert.equal((await down({ project: 'beta', slug: 'a', port: P + 15 })).status, 404, 'once');
    const pubState = () => JSON.parse(fs.readFileSync(path.join(gw.dir, 'state.json'), 'utf8')).public;
    assert.deepEqual(blobsOf(gw), [...new Set(Object.values(pubState().beta.artifacts).flatMap((x) => Object.values(x.files).map((f) => f.sha256)))].sort(), 'its blobs are gone');
    // an instance that isn't beta at /srv/beta: the page comes down, the record isn't written there
    r = await down({ project: 'beta', slug: 'b', port: P + 16 });
    assert.deepEqual([r.status, r.json.recorded], [200, false]);
    assert.match(r.json.note, /instance \d+ is not beta at \/srv\/beta, so the record wasn't written there; the Library's Forget clears it/);
    assert.equal(other.recorded.length, 0);
    assert.equal(await pubStatus('/beta/b/'), 404);
    assert.equal(pubState().beta.root, '/srv/beta', 'the project stays bound to its checkout');
    // the gateway's list
    assert.ok((await confirmAndPublish(gw, P + 15, ['c'])).results[0].ok);
    const list = await gw.req('GET', '/public/');
    assert.equal(list.status, 200);
    assert.ok(list.body.includes(`${gw.site}/beta/c/`));
    assert.ok(list.body.includes('/public/unpublish?project=beta&#38;slug=c'));
    assert.ok(!list.body.includes('/beta/a/'));
    r = await down({ project: 'beta', slug: 'c' });
    assert.deepEqual([r.json.recorded, r.json.note], [false, 'no instance was named, so the record wasn\'t written; the Library\'s Forget clears it']);
    // an unpublish racing a publish leaves no dangling blob and no missing one
    assert.ok((await confirmAndPublish(gw, P + 15, ['c'])).results[0].ok);
    await Promise.all([confirmAndPublish(gw, P + 15, ['a']), down({ project: 'beta', slug: 'c' })]);
    const want = [...new Set(Object.values(pubState().beta.artifacts).flatMap((x) => Object.values(x.files).map((f) => f.sha256)))].sort();
    assert.deepEqual(blobsOf(gw), want);
    assert.deepEqual([await pubStatus('/beta/a/'), await pubStatus('/beta/c/')], [200, 404]);
  } finally { await S.close(); await other.close(); await gw.close(); }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `~/.asdf/installs/nodejs/18.20.4/bin/node --test --test-name-pattern "unpublish takes a page down" test/gateway.test.mjs`
Expected: FAIL: `GET /public/unpublish…` answers 404 where 200 is expected.

- [ ] **Step 3: The pages**

In `PAGES`, after `publish: …,` add:

```js
  unpublish: (x) => `${doc('Unpublish', `<h1>Take this page down</h1><p><b>${esc(x.title)}</b> (${esc(x.project)} · ${esc(x.slug)}) stops answering at once, for everyone:</p><p><code>${esc(x.url)}</code></p><p><button id="go">Unpublish</button></p><p id="err"></p><p id="out"></p>`)}
<script>
const ITEM = ${jsonIn({ project: x.project, slug: x.slug, ...(x.port ? { port: x.port } : {}) })};
const go = document.getElementById('go');
go.onclick = run(async () => {
  const r = await post('/public/unpublish', ITEM);
  go.disabled = true;
  document.getElementById('out').textContent = 'Taken down.' + (r.recorded ? ' The Library shows it.' : ' ' + (r.note || ''));
});
</script></body></html>`,
  publicList: (pub, site) => {
    const rows = Object.entries(pub).flatMap(([n, x]) => Object.entries(x.artifacts ?? {}).map(([s, a]) => ({ n, s, a, root: x.root, link: `${site}/${n}/${s}/` })));
    return `${doc('Public', `<h1>Public on this box</h1><p>Anyone can read these, with no sign-in. Each is the box's own copy of what you published.</p>${rows.length ? `<ul>${rows.map((r) => `<li class="pub"><b>${esc(r.a.title)}</b><small>${esc(r.n)} · ${esc(r.s)} · published ${esc(String(r.a.at).slice(0, 10))} from ${esc(r.root)}</small><code><a href="${esc(r.link)}" target="_blank" rel="noopener noreferrer">${esc(r.link)}</a></code><a href="${esc(`/public/unpublish?project=${r.n}&slug=${r.s}`)}">Unpublish</a></li>`).join('')}</ul>` : '<p>Nothing is public.</p>'}`)}</body></html>`;
  },
```

- [ ] **Step 4: Record where the project is**

In `createGateway`, after `publishItem` add:

```js
  // An unpublish is recorded on the instance only when it is that project, at that checkout: its
  // manifest says so, or its hello for a slug no longer on main. Otherwise the Library's Forget does it.
  const recordUnpublish = async (port, project, root, slug) => {
    const r = await loopback(port, 'GET', `/public-manifest/${slug}`);
    let says = null;
    if (r.status === 200) { try { says = JSON.parse(r.body.toString('utf8')); } catch {} }
    else { const h = await loopback(port, 'GET', '/api/hello'); try { const x = JSON.parse(h.body.toString('utf8')); says = { project: x.name, root: x.root }; } catch {} }
    if (says?.project !== project || says?.root !== root) throw new Error(`instance ${port} is not ${project} at ${root}, so the record wasn't written there`);
    const k = await loopback(port, 'POST', '/api/artifact-publish', { body: JSON.stringify({ op: 'unpublish', slug }) });
    if (k.status !== 200) throw new Error(`instance ${port} didn't record it (${errorOf(k)})`);
  };
```

- [ ] **Step 5: The routes**

After Task 8's `POST /public/publish` handler add:

```js
      // Taking a page down never waits on an instance: the gateway's copy goes first, then the record.
      if (req.method === 'GET' && p === '/public/unpublish') {
        const pub = store.load().public ?? {};
        const slug = url.searchParams.get('slug') ?? '';
        const port = url.searchParams.has('port') ? Number(url.searchParams.get('port')) : null;
        let project = url.searchParams.get('project');
        if (project === null && port !== null) {
          const named = Object.keys(pub).filter((n) => pub[n].port === port && Object.hasOwn(pub[n].artifacts ?? {}, slug));
          project = named.length === 1 ? named[0] : null;
        }
        if (!LINK_ID.test(slug) || (port !== null && !BLOCK.includes(port)) || !PROJECT.test(project ?? '')) return send(res, 400, 'text/plain; charset=utf-8', 'unpublish?project=<project>&slug=<slug>[&port=<instance>]');
        const a = Object.hasOwn(pub, project) && Object.hasOwn(pub[project].artifacts ?? {}, slug) ? pub[project].artifacts[slug] : null;
        if (!a) return send(res, 404, 'text/plain; charset=utf-8', `${project}/${slug} is not public on this box`);
        return page(res, PAGES.unpublish({ project, slug, port, title: a.title, url: `${PUBLIC}/${project}/${slug}/` }));
      }
      if (req.method === 'POST' && p === '/public/unpublish') {
        const body = await readJson(req);
        const project = String(body?.project ?? '');
        const slug = String(body?.slug ?? '');
        const port = body?.port === undefined || body?.port === null ? null : Number(body.port);
        if (!PROJECT.test(project) || !LINK_ID.test(slug) || (port !== null && !BLOCK.includes(port))) return json(res, 400, { error: 'unpublish takes { project, slug, port? }' });
        const root = await pstore.serial(() => {
          const now = store.load();
          const pub = { ...(now.public ?? {}) };
          const x = Object.hasOwn(pub, project) ? pub[project] : null;
          if (!x || !Object.hasOwn(x.artifacts ?? {}, slug)) return null;
          const artifacts = { ...x.artifacts };
          delete artifacts[slug];
          // the binding stays: another checkout of this name still needs "move it"
          pub[project] = { ...x, artifacts };
          store.save({ ...now, public: pub });
          pstore.sweep(pub);
          return x.root;
        });
        if (root === null) return json(res, 404, { error: `${project}/${slug} is not public on this box` });
        log(`public: ${project}/${slug} unpublished`);
        if (port === null) return json(res, 200, { ok: true, recorded: false, note: 'no instance was named, so the record wasn\'t written; the Library\'s Forget clears it' });
        try { await recordUnpublish(port, project, root, slug); return json(res, 200, { ok: true, recorded: true, note: null }); }
        catch (e) { return json(res, 200, { ok: true, recorded: false, note: `${e.message}; the Library's Forget clears it` }); }
      }
      if (req.method === 'GET' && (p === '/public' || p === '/public/')) return page(res, PAGES.publicList(store.load().public ?? {}, PUBLIC));
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `~/.asdf/installs/nodejs/18.20.4/bin/node --test test/gateway.test.mjs`
Expected: PASS; `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add cloud/gateway.mjs test/gateway.test.mjs
git commit -m "Gateway: unpublish at once from its own page, recorded only where the project is; the list of what is public

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: x-devteam-public: tell each dashboard what the box serves

**Files:**
- Modify: `cloud/gateway.mjs`: module level (`asciiJson`); inside `createGateway`: `downstreamHeaders` (~190-201), `proxy` (~202-217), after `recordUnpublish` (Task 9), the instance branch of the request handler (~399-403)
- Test: `test/gateway.test.mjs` (append)

**Interfaces:**
- Consumes: `store`, `seedPublic` (Task 6 test helper).
- Produces: `asciiJson(v) => string` (JSON with every character past `~` escaped as `\uXXXX`, so it is a valid header value whatever a root holds); `publicMap(port) => string`, the header value `{ "<project>": { port, root, artifacts: { "<slug>": "<tree>" } } }`, at most 32 KB, else only the projects last seen on `port`; `proxy(req, res, { …, extra })` adds `extra` headers last; `downstreamHeaders` drops any upstream `x-devteam-public`. Task 11 reads the header.

- [ ] **Step 1: Write the failing test**

Append to `test/gateway.test.mjs`:

```js
test('x-devteam-public: a dashboard learns what the box serves, from the gateway alone', async () => {
  const gw = await gateway('public-header');
  const up = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json', 'x-devteam-public': '{"forged":1}' }); res.end('{}'); }).listen(P + 17, '127.0.0.1');
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    seedPublic(gw.dir, 'alpha', 'hello', { 'index.html': 'x' }, { root: '/srv/alpha', port: P + 17 });
    seedPublic(gw.dir, 'zeta', 'z', { 'index.html': 'z' }, { root: '/srv/zéta', port: P + 3 });
    let r = await gw.req('GET', '/api/data', { on: P + 17 });
    assert.equal(r.status, 200);
    assert.match(r.headers['x-devteam-public'], /^[\x20-\x7e]+$/, 'ASCII, whatever a root holds');
    assert.deepEqual(JSON.parse(r.headers['x-devteam-public']), { alpha: { port: P + 17, root: '/srv/alpha', artifacts: { hello: 'a'.repeat(40) } }, zeta: { port: P + 3, root: '/srv/zéta', artifacts: { z: 'a'.repeat(40) } } });
    assert.equal((await gw.req('GET', '/api/fleet', { on: P + 17 })).headers['x-devteam-public'], undefined, 'an upstream\'s own copy is dropped');
    assert.equal((await gw.req('GET', '/api/data', { on: P + 17, cookie: '' })).status, 401, 'signed in only');
    // past 32 KB, only the asking instance's own projects
    for (let i = 0; i < 200; i++) seedPublic(gw.dir, `p${i}`, 'x', { 'index.html': `${i}` }, { root: `/srv/${'r'.repeat(200)}${i}`, port: P + 20 });
    r = await gw.req('GET', '/api/data', { on: P + 17 });
    assert.deepEqual(Object.keys(JSON.parse(r.headers['x-devteam-public'])), ['alpha']);
  } finally { await new Promise((res) => up.close(res)); await gw.close(); }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `~/.asdf/installs/nodejs/18.20.4/bin/node --test --test-name-pattern "x-devteam-public" test/gateway.test.mjs`
Expected: FAIL: the header is `{"forged":1}`, not ASCII-escaped gateway state (the `deepEqual` fails).

- [ ] **Step 3: Implement**

At module level, after `fmtSize` (Task 8), add:

```js
// JSON as a header value: a header carries only Latin-1, so everything past ~ is escaped.
const asciiJson = (v) => JSON.stringify(v).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
```

In `downstreamHeaders`, replace the skip list line with:

```js
      // x-devteam-public is the gateway's to say (what the box serves); an upstream's copy never passes
      if (['connection', 'keep-alive', 'transfer-encoding', 'strict-transport-security', 'clear-site-data', 'x-devteam-public'].includes(k)) continue;
```

Replace `proxy`'s first two lines with:

```js
  const proxy = (req, res, { port, path: p, publicOrigin, cap, extra = null }) => {
    const up = http.request({ host: '127.0.0.1', port, method: req.method, path: p, headers: upstreamHeaders(req, port, publicOrigin) }, (ur) => {
      // Never kept: a page an agent served once on this name must not come back from the browser's
      // cache after a real dashboard has taken its port.
      res.writeHead(ur.statusCode, { ...downstreamHeaders(ur.headers, cap, publicOrigin), 'cache-control': 'no-store', ...(extra ?? {}) });
```

(the rest of `proxy` is unchanged).

After `recordUnpublish` add:

```js
  // What the box serves, for the Library: each project's checkout, last port and slug → tree. At
  // most 32 KB; past that, only the projects last seen on the asking instance.
  const publicMap = (port) => {
    const pub = store.load().public ?? {};
    const all = Object.fromEntries(Object.entries(pub).map(([n, x]) => [n, { port: x.port, root: x.root, artifacts: Object.fromEntries(Object.entries(x.artifacts ?? {}).map(([s, a]) => [s, a.tree])) }]));
    const text = asciiJson(all);
    return text.length <= 32 * 1024 ? text : asciiJson(Object.fromEntries(Object.entries(all).filter(([, x]) => x.port === port)));
  };
```

In the instance branch, replace `return proxy(req, res, { port, path: req.url, publicOrigin: own });` with:

```js
        return proxy(req, res, { port, path: req.url, publicOrigin: own, extra: req.method === 'GET' && p === '/api/data' ? { 'x-devteam-public': publicMap(port) } : null });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `~/.asdf/installs/nodejs/18.20.4/bin/node --test test/gateway.test.mjs`
Expected: PASS; `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add cloud/gateway.mjs test/gateway.test.mjs
git commit -m "Gateway: x-devteam-public on /api/data says what the box serves; an upstream's copy is dropped

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Part C: the Library

### Task 11: The Library's publish states, Restore all, and Forget

**Files:**
- Modify: `docs/devteam/dashboard/index.html`: CSS after `.art-card.draft` (~434), globals after `let PAGE_VERSION = null;` (~638), a new marked block before `renderLibrary` (~2859), `renderLibrary()` (~2862-2896), `loadNow()` (~3038-3040), the delegated click handler (after its `[data-copy]` branch, ~3110)
- Test: `test/dashboard.test.mjs` (append)

**Interfaces:**
- Consumes: `library.artifacts[].tree` and `.published`, `library.public.{project, root}` (Task 5); the `x-devteam-public` header (Task 10); `ACTIONS['artifact-publish']` (Task 3); the gateway's `/public/publish?port=&slug=…` and `/public/unpublish?port=&project=&slug=` (Tasks 8-9).
- Produces (inside `/* public-states start */ … /* public-states end */`, loadable by itself):
  - `publicHere(loc: { protocol, host }, lib) => { proto, port, box, project, root } | null`: null unless the page is on `<digits>.<name with a letter>` (through the gateway).
  - `publicState(a, pub, me) => { state: 'none' | 'published' | 'public' | 'not-live', rec, from, actions: Array<'publish' | 'update' | 'copy' | 'unpublish' | 'restore' | 'forget'> }`, the spec's table.
  - `publicLinks(me) => { publish(slugs), unpublish(slug), page(slug) }`.
  - Global `let PUBLIC = null;` set from the header on every `/api/data` load.

- [ ] **Step 1: Write the failing test**

Append to `test/dashboard.test.mjs`:

```js
test('the Library shows each landed artifact\'s publish state, from the log and the gateway\'s header', () => {
  const html = fs.readFileSync(path.join(kit, 'dashboard/index.html'), 'utf8');
  const src = html.slice(html.indexOf('/* public-states start */'), html.indexOf('/* public-states end */'));
  assert.ok(src.length > 200, 'the publish-state block is marked in index.html');
  const ctx = vm.createContext({});
  vm.runInContext(`${src}\n;globalThis.api = { publicHere, publicState, publicLinks };`, ctx);
  const { publicHere, publicState, publicLinks } = ctx.api;
  const lib = { public: { project: 'alpha', root: '/srv/alpha' } };
  const me = publicHere({ protocol: 'https:', host: '4321.box.example.com' }, lib);
  assert.deepEqual({ ...me }, { proto: 'https:', port: 4321, box: 'box.example.com', project: 'alpha', root: '/srv/alpha' });
  assert.equal(publicHere({ protocol: 'http:', host: '127.0.0.1:4321' }, lib), null, 'a laptop');
  assert.equal(publicHere({ protocol: 'http:', host: 'localhost:4321' }, lib), null);
  const T = 'a'.repeat(40);
  const U = 'b'.repeat(40);
  const rec = { tree: T, at: '2026-11-09T10:00:00.000Z', channel: 'dashboard' };
  const art = (published) => ({ slug: 'hello', tree: T, published });
  const serving = (tree, port = 4321, root = '/srv/alpha') => ({ alpha: { port, root, artifacts: tree ? { hello: tree } : {} } });
  const S = (a, pub, at = me) => { const s = publicState(a, pub, at); return [s.state, [...s.actions], s.from]; };
  // the spec's table, row by row
  assert.deepEqual(S(art(null), serving(null)), ['none', ['publish'], null]);
  assert.deepEqual(S(art(rec), serving(T)), ['public', ['copy', 'unpublish'], null]);
  assert.deepEqual(S(art(rec), serving(U)), ['public', ['update', 'copy', 'unpublish'], null]);
  assert.deepEqual(S(art(rec), serving(null)), ['not-live', ['restore', 'forget'], null]);
  assert.deepEqual(S(art(null), serving(T)), ['public', ['unpublish'], null], 'the gateway is the truth');
  assert.deepEqual(S(art(rec), serving(T, 4322)), ['public', ['copy', 'unpublish'], 4322], 'public from another instance');
  assert.deepEqual(S(art(rec), serving(T, 4321, '/srv/other')), ['not-live', ['restore', 'forget'], null], 'another checkout of the name is not this one');
  assert.deepEqual(S(art(rec), {}), ['not-live', ['restore', 'forget'], null]);
  assert.deepEqual(S(art(rec), null, null), ['published', [], null], 'a laptop says what the log says, and offers nothing');
  assert.deepEqual(S(art(null), null, null), ['none', [], null]);
  assert.deepEqual(S(art(null), serving(null), { ...me, project: null }), ['none', [], null], 'no project name, no publishing');
  assert.equal(publicState(art(rec), serving(null), me).rec.channel, 'dashboard', 'the card shows the line\'s channel');
  const L = publicLinks(me);
  assert.equal(L.publish(['a', 'b']), 'https://box.example.com/public/publish?port=4321&slug=a&slug=b');
  assert.equal(L.unpublish('a'), 'https://box.example.com/public/unpublish?port=4321&project=alpha&slug=a');
  assert.equal(L.page('a'), 'https://public.box.example.com/alpha/a/');
  // the page reads the header, opens the gateway's pages in a tab it can't steer, and Forget records through the kit
  assert.match(html, /PUBLIC = JSON\.parse\(r\.headers\.get\('x-devteam-public'\)/);
  assert.match(html, /target="_blank" rel="noopener noreferrer">\$\{label\}<\/a>/);
  assert.match(html, /post\('artifact-publish', \{ op: 'unpublish', slug \}/);
  assert.match(html, /Restore all/);
  assert.match(html, /Publishing happens on the cloud box/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `~/.asdf/installs/nodejs/18.20.4/bin/node --test --test-name-pattern "publish state" test/dashboard.test.mjs`
Expected: FAIL with "the publish-state block is marked in index.html".

- [ ] **Step 3: CSS and the global**

After the `.art-card.draft { … }` rule add:

```css
  .art-card .pub { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 6px; }
  .art-card .pub a.ghost, .lib-pub a.ghost { display: inline-block; padding: 2px 10px; border: 1px solid var(--line-2); border-radius: 6px; background: var(--surface); color: var(--fg); font-size: 12px; text-decoration: none; }
  .art-card .pub a.ghost:hover, .lib-pub a.ghost:hover { background: var(--hover); }
```

After `let PAGE_VERSION = null;` add:

```js
// What the cloud box serves to the public (x-devteam-public, set only by its gateway): { project:
// { port, root, artifacts: { slug: tree } } }. null on a laptop.
let PUBLIC = null;
```

- [ ] **Step 4: The states**

Directly before the comment `// The Library: each landed artifact with its drafts beneath it, …` add:

```js
/* public-states start */
// Publishing, as a landed card shows it. The log's newest artifact-publish line (a.published) says
// what the owner asked for; the gateway's header says what the box serves, and that is the truth:
// a forged line can only make a card ask. Through the gateway this page is on <port>.<box>.
function publicHere(loc, lib) {
  const m = /^(\d{1,5})\.([a-z0-9.-]*[a-z][a-z0-9.-]*(?::\d+)?)$/i.exec(loc?.host || '');
  return m ? { proto: loc.protocol, port: Number(m[1]), box: m[2], project: lib?.public?.project ?? null, root: lib?.public?.root ?? null } : null;
}
function publicState(a, pub, me) {
  const rec = a.published || null;
  if (!pub || !me) return { state: rec ? 'published' : 'none', rec, from: null, actions: [] };
  const e = me.project && Object.hasOwn(pub, me.project) ? pub[me.project] : null;
  // the box's copy is this project's only when it came from this checkout (a port can change)
  const ours = !!e && e.root === me.root;
  const served = ours && e.artifacts && Object.hasOwn(e.artifacts, a.slug) ? e.artifacts[a.slug] : null;
  if (served) return { state: 'public', rec, from: e.port !== me.port ? e.port : null, actions: [...(rec && served !== a.tree ? ['update'] : []), ...(rec ? ['copy'] : []), 'unpublish'] };
  if (rec) return { state: 'not-live', rec, from: null, actions: ['restore', 'forget'] };
  return { state: 'none', rec, from: null, actions: me.project ? ['publish'] : [] };
}
// The gateway's own pages, on the box's name; the public link, on public.<box>.
const publicLinks = (me) => ({
  publish: (slugs) => `${me.proto}//${me.box}/public/publish?port=${me.port}${slugs.map((s) => `&slug=${encodeURIComponent(s)}`).join('')}`,
  unpublish: (slug) => `${me.proto}//${me.box}/public/unpublish?port=${me.port}&project=${encodeURIComponent(me.project)}&slug=${encodeURIComponent(slug)}`,
  page: (slug) => `${me.proto}//public.${me.box}/${encodeURIComponent(me.project)}/${encodeURIComponent(slug)}/`,
});
/* public-states end */
```

- [ ] **Step 5: The cards**

Replace the whole `function renderLibrary(lib) { … }` (from `function renderLibrary(lib) {` through its closing `}` after `if (AV) avHeader();`) with:

```js
function renderLibrary(lib) {
  const arts = lib?.artifacts ?? [];
  const links = lib?.links ?? [];
  $('n-library').textContent = arts.length || '';
  const me = PUBLIC ? publicHere(location, lib) : null;
  const L = me ? publicLinks(me) : null;
  // the gateway's pages open in a new tab this page can't later redirect
  const tab = (href, label) => `<a class="ghost" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  // a landed card's publish state, with the record's date and channel, so a line the owner never wrote shows
  const pubLine = (a) => {
    const s = publicState(a, PUBLIC, me);
    const badge = s.state === 'public' ? `<span class="badge good">public</span>${s.from ? `<span class="small muted">from instance ${esc(s.from)}</span>` : ''}`
      : s.state === 'not-live' ? '<span class="badge medium">not live on this box</span>' : s.state === 'published' ? '<span class="badge">published</span>' : '';
    const said = s.rec ? `<span class="small muted">recorded ${esc(when(s.rec.at))} from the ${s.rec.channel === 'dashboard' ? 'dashboard' : 'terminal'}</span>` : '';
    const act = {
      publish: () => tab(L.publish([a.slug]), 'Publish'), update: () => tab(L.publish([a.slug]), 'Update'), restore: () => tab(L.publish([a.slug]), 'Restore'),
      unpublish: () => tab(L.unpublish(a.slug), 'Unpublish'), copy: () => `<button class="ghost" data-copy="${esc(L.page(a.slug))}">Copy link</button>`,
      forget: () => `<button class="ghost" data-forget="${esc(a.slug)}">Forget</button>`,
    };
    const parts = [badge, said, ...s.actions.map((x) => act[x]())].filter(Boolean);
    return parts.length ? `<div class="pub">${parts.join('')}<span class="err" id="e-pub-${esc(a.slug)}"></span></div>` : '';
  };
  const card = (a, draft) => {
    const name = a.error ? a.slug : a.title || a.slug;
    const meta = [a.by ? `drawn by ${esc(who(a.by))}` : '', a.for?.length ? `for ${a.for.map((f) => linkify(f)).join(', ')}` : '', a.updated_at ? esc(when(a.updated_at)) : ''].filter(Boolean).join(' · ');
    return `<div class="card small art-card${draft ? ' draft' : ''}">
      <div class="art-t">${a.error ? `<b>${esc(name)}</b>` : `<a href="${esc(artHref(a.slug, a.at))}">${esc(name)}</a>`}${a.at === 'main' ? '' : `<span class="badge medium">draft</span><span class="small muted">in ${linkify(a.at)}</span>`}${a.error ? '<span class="badge high">broken</span>' : ''}</div>
      ${a.error ? `<div class="err">${esc(a.error)}</div>` : a.summary ? `<div class="art-s">${esc(a.summary)}</div>` : ''}
      ${meta ? `<div class="meta">${meta}</div>` : ''}
      ${a.at === 'main' && !a.error ? pubLine(a) : ''}
    </div>`;
  };
  const landed = arts.filter((a) => a.at === 'main');
  const drafts = arts.filter((a) => a.at !== 'main');
  const fresh = drafts.filter((d) => !landed.some((l) => l.slug === d.slug));
  const byWt = new Map();
  for (const d of fresh) byWt.set(d.at, [...(byWt.get(d.at) || []), d]);
  // above the list: where publishing happens, or one confirm for everything not live on this box
  const notLive = me ? landed.filter((a) => !a.error && publicState(a, PUBLIC, me).state === 'not-live').map((a) => a.slug) : [];
  const pubHead = !landed.length ? ''
    : !PUBLIC ? '<p class="small muted lib-pub">Publishing happens on the cloud box: there, the Library can make a landed artifact readable by anyone.</p>'
    : !me?.project ? '<p class="small muted lib-pub">To publish from here, set <code>project</code> in settings.md: it is part of every public link.</p>'
    : notLive.length ? `<p class="small lib-pub">${notLive.length} published artifact${notLive.length === 1 ? ' is' : 's are'} not live on this box. ${tab(L.publish(notLive.slice(0, 50)), 'Restore all')}</p>` : '';
  $('artifacts').innerHTML = arts.length
    ? pubHead + landed.map((a) => card(a) + drafts.filter((d) => d.slug === a.slug).map((d) => card(d, true)).join('')).join('') +
      (byWt.size ? `<h3>Drafts <span class="dim">not landed yet</span></h3>${[...byWt].map(([wt, ds]) => `<div class="art-wt">In ${linkify(wt)}</div>${ds.map((d) => card(d)).join('')}`).join('')}` : '')
    : empty('No artifacts yet. Ask the supervisor to draw one (“draw me a mock of …”); it shows here as a draft, then lands.');
  const loc = (l) => esc(l.url || (l.remote ? `${l.remote}${l.path ? `:${l.path}` : ''}` : l.path || ''));
  $('lib-links').innerHTML = links.length
    ? links.map((l) => `<div class="card small lib-link">
      <div class="links">${linkOf({ title: l.title, url: l.url, path: l.remote ? null : l.path, remote: l.remote })}<span class="badge">${esc(l.kind)}</span></div>
      ${l.notes ? `<div class="muted">${esc(l.notes)}</div>` : ''}
      <div class="meta"><code>${esc(l.id)}</code>${loc(l) ? ` · <span class="loc">${loc(l)}</span>` : ''}${l.for?.length ? ` · for ${l.for.map((f) => linkify(f)).join(', ')}` : ''}</div>
    </div>`).join('')
    : empty('No links in the registry. The supervisor adds the docs, designs and dashboards the fleet works from.');
  if (AV) avHeader();
}
```

- [ ] **Step 6: Read the header; Forget**

In `loadNow()`, after `if (pv) { if (!PAGE_VERSION) PAGE_VERSION = pv; else if (pv !== PAGE_VERSION) $('updated').hidden = false; }` add:

```js
    // what the cloud box serves; absent on a laptop, and a header that doesn't parse counts as absent
    PUBLIC = null;
    try { if (r.headers.get('x-devteam-public')) PUBLIC = JSON.parse(r.headers.get('x-devteam-public')); } catch {}
```

In the delegated click handler (`document.addEventListener('click', async (ev) => {`), directly after the `[data-copy]` branch (`if (cp) { … return; }`) add:

```js
  // Forget: record an unpublish through the kit's own action, for a publish line the owner won't
  // restore (the page is already not live; nothing on the box changes). Twice, as Let go is.
  const fg = ev.target.closest('[data-forget]');
  if (fg) {
    const slug = fg.dataset.forget;
    if (!fg.classList.contains('confirm')) { fg.classList.add('confirm'); fg.textContent = 'Confirm forget'; setTimeout(() => { fg.classList.remove('confirm'); fg.textContent = 'Forget'; }, 6000); return; }
    fg.disabled = true;
    if (!(await post('artifact-publish', { op: 'unpublish', slug }, `pub-${slug}`))) fg.disabled = false;
    return;
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `~/.asdf/installs/nodejs/18.20.4/bin/node --test --test-name-pattern "publish state" test/dashboard.test.mjs`
Expected: PASS.

Then the kit's page checks (the suite, which loads the dashboard): `~/.asdf/installs/nodejs/18.20.4/bin/node --test --test-concurrency=8 test/kit.test.mjs`
Expected: PASS, `# fail 0`.

- [ ] **Step 8: Commit**

```bash
git add docs/devteam/dashboard/index.html test/dashboard.test.mjs
git commit -m "Library: each landed artifact's publish state, from the log and the box; Publish, Update, Restore all, Unpublish, Forget

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Part D: docs

### Task 12: README, supervisor.md, constitution, Dockerfile header, HELP, the artifacts spec

**Files:**
- Modify: `README.md` (lines 27, 42, 146, 159, 160)
- Modify: `docs/devteam/process/supervisor.md` (§9 Artifacts bullets, ~185-187)
- Modify: `docs/devteam/governance/constitution.md` (line 62, the "Three kinds of decision" bullet)
- Modify: `cloud/Dockerfile` (header, line 9)
- Modify: `docs/devteam/scripts/devteam.mjs` (`HELP`, after `artifact check` at ~9881)
- Modify: `docs/superpowers/specs/2026-11-05-artifacts-design.md` (line 16)
- (`log.schema.json`'s descriptions landed with the fields in Task 1; Step 7 re-reads them.)

**Interfaces:**
- Consumes: every name above: `artifact publish|unpublish|manifest`, `public.<box>`, `/public/`, `DEVTEAM_PUBLIC_MAX`, the owner act `artifact-publish`.
- Produces: docs only; `devteam.mjs help` lists the three new subcommands.

- [ ] **Step 1: README**

Line 27, replace the `artifacts/<slug>/` tree comment with:

```
    artifacts/<slug>/          pages the fleet drew to show an idea (mocks, flows, models), listed in the dashboard's Library; on a cloud box the owner can publish a landed one to anyone
```

Line 42, at the end of the **Artifacts.** paragraph (after `` `devteam.mjs artifact new|check`, `artifacts`. ``), append:

```
On a cloud box the owner can also publish a landed artifact to anyone, at `public.box.example.com/<project>/<slug>/` (below).
```

Line 146, replace this text:

```
(say `box.example.com`, plus `*.box.example.com`, since each dashboard keeps an origin of its own on a subdomain)
```

with:

```
(say `box.example.com`, plus `*.box.example.com`, since each dashboard keeps an origin of its own on a subdomain, and `public.box.example.com` serves what the owner publishes)
```

Line 159 (**The deploy gate.**), at the end of the bullet, append:

```
The gateway keeps its own copies of the kit's artifact type map, CDN list and page policy for public pages (a test fails while they differ), so changing one in the kit changes `cloud/gateway.mjs` too, and that release deploys the box.
```

Line 160 (**The gateway**), at the end of the bullet (after `so no agent can read or write its passkeys.`), append, with a leading space:

```
It also serves `public.box.example.com`, from its own copy of what the owner published, with no sign-in and no cookie.
```

and add a new bullet directly after that bullet:

```
- **Public artifacts.** The owner can make a landed artifact readable by anyone at `public.box.example.com/<project>/<slug>/` (`project` must be set in settings.md: it is part of every link). The Library's **Publish** opens a page on the box's own name that shows exactly what goes up; confirming it, the gateway fetches every file from that instance, checks each against the manifest it showed and the tree id against the bytes, keeps its own copy, and has the kit record an owner `artifact-publish` act in the log. From then on nothing on the box changes what is served: not the port, not main, not the log. **Update** publishes main's newer version, **Unpublish** takes a page down at once, and `box.example.com/public/` lists what is public. The record moves with the log; on a new box the Library shows each published artifact as not live there, and **Restore all** republishes them from main in one confirm. Nothing else is public: no index, no drafts, no cookies on that name. The total is capped by `DEVTEAM_PUBLIC_MAX` (bytes, default 500 MB). Agents can't publish: only the gateway's own page can, and only for the signed-in owner.
```

- [ ] **Step 2: supervisor.md**

After the `- **Rules.** \`artifact check\` (and …` bullet in §9's "Artifacts: pages that show an idea", add:

```
- **Publishing is the owner's.** On a cloud box the owner can make a landed artifact readable by anyone at `public.<box>/<project>/<slug>/`, from the Library and the gateway's own confirm page. You can't publish one, change what is published or take it down, and an `artifact-publish` act is never yours to write (`log-check` refuses it). So never put anything in an artifact that you wouldn't want public: once it lands, it is one click from anyone.
```

- [ ] **Step 3: constitution.md**

At the end of the "Three kinds of decision" bullet (line 62, after `is owner_only: never defaulted, never answered from chat.`), append:

```
 `artifact-publish`, the owner making a landed artifact readable by anyone from the cloud box or taking it down, is owner_only and the one class of act the owner writes (`artifact publish|unpublish`, which the gateway's confirm page runs): a record of what the owner did, never a call, so trust, decisions and corrections leave it out, and the log refuses it from anyone else.
```

- [ ] **Step 4: Dockerfile header**

After line 9 (`# its own too (term.box.example.com). Signing in is at box.example.com/auth.`) add:

```
# public.box.example.com, under the same wildcard, serves the artifacts the owner published, to
# anyone, from the gateway's own copy (DEVTEAM_PUBLIC_MAX caps it, in bytes; 500 MB by default).
```

- [ ] **Step 5: HELP**

In `devteam.mjs`'s `HELP`, after the `  artifact check [<slug>…]        the checks merge runs, on this checkout's artifacts` line, add:

```
  artifact manifest <slug> [--json]   what publishing a landed artifact would put up: main's tree, each file's sha256 (the cloud gateway's confirm page reads it)
  artifact publish <slug> --owner --tree <t> | artifact unpublish <slug> --owner   the owner's record that a landed artifact went public or came down (the gateway's confirm page runs these; by hand they record intent only)
```

- [ ] **Step 6: The artifacts spec points here**

In `docs/superpowers/specs/2026-11-05-artifacts-design.md`, replace line 16 with:

```
- **No hosted sharing.** Artifacts are seen through the owner's local dashboard. (Replaced in part by `2026-11-09-public-artifacts-design.md`: on a cloud box the owner can publish a landed artifact to anyone.)
```

- [ ] **Step 7: Verify**

Run:

```bash
grep -c "public.box.example.com" README.md cloud/Dockerfile
grep -c "Publishing is the owner's" docs/devteam/process/supervisor.md
grep -c "artifact-publish" docs/devteam/governance/constitution.md docs/devteam/schema/log.schema.json
grep -c "2026-11-09-public-artifacts-design.md" docs/superpowers/specs/2026-11-05-artifacts-design.md
~/.asdf/installs/nodejs/18.20.4/bin/node docs/devteam/scripts/devteam.mjs help | grep -c "artifact \(manifest\|publish\)"
```

Expected: `README.md:4` (or more) and `cloud/Dockerfile:1`; `1`; `constitution.md:2` and `log.schema.json:2` (or more); `1`; `2`.

Then the whole suite, as CI runs it: `~/.asdf/installs/nodejs/18.20.4/bin/node --test --test-concurrency=8 test/*.test.mjs`
Expected: PASS, `# fail 0`.

- [ ] **Step 8: Commit**

```bash
git add README.md docs/devteam/process/supervisor.md docs/devteam/governance/constitution.md cloud/Dockerfile docs/devteam/scripts/devteam.mjs docs/superpowers/specs/2026-11-05-artifacts-design.md
git commit -m "Docs: public artifacts (README, supervisor.md, constitution, Dockerfile header, help, the artifacts spec)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Decisions this plan makes where the spec leaves room

- **A manifest file entry carries `mode`** (`100644` or `100755`) beside `sha256` and `size`: the gateway can't recompute git's tree id without it. `publicArtifact` refuses a tree with a submodule (no blob to serve).
- **`/public-manifest` runs `artifact manifest <slug> --json` in a child**, like the dashboard's other reads, so settings and main are read fresh; exit 2 (the project's name) is the route's 409, any other failure 404. The hashes are cached per tree at `run/cache/public-manifests/<tree>.json` (a tree never changes, so the cache never goes stale). A slug that isn't landed is a 404 before the project name is looked at.
- **`x-devteam-public` is ASCII-only JSON** (`\uXXXX` past `~`): HTTP header values can't carry a root with non-ASCII characters otherwise.
- **The Library learns its own project and root from `library.public`** (`project` null when it isn't link-shaped, which also hides Publish and shows how to fix it).
- **Unpublish accepts `project` and `port` together**, and the Library sends both, so the gateway's page always labels the item from its own state; with only a port, the project is the one project last seen on that port that serves the slug.
- **An unpublish keeps the project's binding** (`root`, `port`) even when its last artifact goes, so another checkout of the same name still needs "move it".
- **The confirm page has a third label**, "already public at this version", beside "new on this box" and "an update"; publishing it again changes nothing that is served.
- **The queue runs per item**: an unpublish never waits behind a 50-item publish, and the sweep runs after every item, so a refused item's blobs go at once.
- **The kit's action timeout is 12 s**, under the gateway's 15 s deadline for the whole answer.
- **A published slug no longer on main has no Library card**; the gateway's `/public/` page lists it and takes it down.
- **The kit's chain steps join the artifacts fork** (see File Structure), and run with the whole `test/kit.test.mjs`.

## Self-review

- **Spec coverage.** §1 record and schema: Task 1; consumers and `correct`: Task 2. §2 commands and the action: Task 3; `/public-manifest`: Task 4; Library `tree`/`published`: Task 5; the card table, Restore all, Forget, the laptop note, the header read, the links: Task 11. §3 names and serving: Task 6; store and queue: Task 7; confirm page and POST (all five steps, binding, cap, deadline, validation): Task 8; unpublish and `/public/`: Task 9; the header: Task 10. Testing list: kit items in Tasks 1-5; gateway items in Tasks 6-10 (session, escaping, instance-origin POST, anonymous read with CSP/etag/no cookie, HEAD, 304, 405, cookie ignored, the owner act, wrong bytes stored nothing, kill and impostor, changed manifest, tree mismatch, concurrent publishes, unpublish racing publish, move and port, unpublish then 404 and blobs gone, `/` and `/<project>/` 404 and the redirect, the header and the dropped upstream copy, the cap, the parity test). Docs: Task 12.
- **Placeholders.** None: every code step carries its code, every run its command and expected result.
- **Names.** `TREE_ID`, `PUBLIC_PROJECT`, `treeIdEntries`, `publicArtifact`, `publicManifest`, `publishRecords`, `publishedView`, `ACTION_MS`, `run(args, { timeout })` with `code` (kit); `PUBLIC_TYPES`, `PUBLIC_CDNS`, `publicPathOk`, `publicCsp`, `canonicalJson`, `manifestProblem`, `gitBlobId`, `gitTreeId`, `publicStore` (`blobs`, `blobPath`, `serial`, `referenced`, `write`, `sweep`), `asciiJson`, `fmtSize`, `PUBLIC`, `publicHost`, `servePublic`, `pstore`, `PUBLIC_MAX`, `LOOP_MS`, `loopback`, `errorOf`, `fetchManifest`, `manifestHash`, `publishItem`, `recordUnpublish`, `publicMap`, `PAGES.publish|unpublish|publicList` (gateway); `PUBLIC`, `publicHere`, `publicState`, `publicLinks` (page); `seedPublic`, `standIn`, `confirmAndPublish`, `blobsOf`, `landedProject`, `startKit`, `kitUp`, `HELLO`, `gw.site` (tests). Each is defined in the task that first uses it and used with the same name and shape after.

## Review fixes (Fable, plan review)

- **`mapPool(items, n, fn)`** goes in `cloud/gateway.mjs` beside the other small helpers (Task 8): `async function mapPool(items, n, fn) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }`. The confirm page fetches manifests four at a time.
- **"Move it" keeps only the slug being published.** A move rebinds the project to the new root with just that slug; the old root's other slugs are dropped (and their blobs swept), so a checkout never shows as public what it never published. Task 8's move test asserts the old root's other slug is 404 after a move.

