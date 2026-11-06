# Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sessions draw persistent, presentational HTML artifacts in `project/artifacts/<slug>/`, which land through PRs, show live as drafts from worktrees, are served sandboxed, are listed in a dashboard Library with the link registry, open in a centered 80% viewer, and can be linked by name, inline, from questions.

**Architecture:** One module-sized block of `devteam.mjs` (after the review-page block, near `REPO_PATH`) holds the artifact model: the manifest rules, a tree-based checker fed by disk or git, discovery of landed and draft artifacts, and the content fingerprint. The commands (`artifact new|check`, `artifacts`), `checkPr`, `ask`, `dashboardData`, the prompt and the dashboard server consume it. `index.html` gets a Library section, a viewer overlay, and `[[name]]` rendering. Spec: `docs/superpowers/specs/2026-11-05-artifacts-design.md`.

**Tech Stack:** Node 18+ with no dependencies (`node:fs`, `node:crypto`, `git` via `execFileSync`), plain HTML/JS dashboard, `node:test` kit test.

## Global Constraints

- No new dependencies. Node 18 APIs only (the CI's floor).
- Slug rule: `LINK_ID` (`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`).
- Manifest keys exactly `v` (1), `title` (≤120), `summary` (≤500), `by`, `for`. Title and summary follow `linkTextProblem`'s one-line rule.
- `for` scopes use `scopeValid(s, 'for')`, plus `ticket:<id>`, which `SCOPES` gains.
- File path rule: `^[A-Za-z0-9._/-]+$`, no segment starting with `.`, no `..`.
- Caps: 8 MB per file, 25 MB per artifact.
- CDNs: `https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com`, plus `https://fonts.googleapis.com` (styles) and `https://fonts.gstatic.com` (fonts).
- Sandbox tokens: `allow-scripts allow-forms allow-modals allow-pointer-lock`. Never `allow-same-origin`, `allow-top-navigation`, `allow-popups` or `allow-downloads`.
- The fingerprint is the sha256 of the sorted `path\0<git blob oid>\n` lines.
- Drafts come only from `.worktrees/<name>`, never `review-*` or `tmp-*`. A copy identical to the landed one is not a draft.
- Code style: match the file. That means terse arrow helpers, a comment saying why above each non-obvious block, `die()` for refusals and `warn()` for warnings.
- Tests: add subtests inside the single `test('devteam kit', …)` of `test/kit.test.mjs`. Run one with `node --test --test-name-pattern='<name>' test/` (the full suite takes over 10 minutes; run it once at the end).

---

### Task 1: The artifact model and `artifact new|check`, `artifacts`

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs`
  - a new block after the review-page constants (~line 3720);
  - `SCOPES` and `SCOPE_WHERE` (~line 594) gain `ticket`;
  - `COMMANDS` (~line 8380) and the help text (~line 8370).
- Test: `test/kit.test.mjs`, a subtest after the review-page subtests, once a ticket worktree exists (`wt('bill-01-card')`).

**Interfaces (produced):**
- `ARTIFACTS_REL = \`${projectRel}/artifacts\``
- `artifactProblems(slug, entries) -> { errors: string[], warnings: string[] }`. `entries` is an array of `{ path, mode, size, read: () => Buffer|null }`, with `path` relative to the artifact folder.
- `diskEntries(dir) -> entries`. It lstat-walks the folder and does not follow symlinks; a symlink gets mode `'120000'`.
- `treeEntries(ref, dir) -> entries`, from `git ls-tree -r -l -z <ref> -- <dir>/`.
- `blobOid(buf) -> hex` (git's sha1 of a blob).
- `fingerprint(entries) -> hex`
- `landedArtifacts() -> [{ slug, at: 'main', manifest|null, error|null, fp, dir }]`
- `draftArtifacts() -> [{ slug, at: <worktree>, manifest|null, error|null, fp, dir, mtime }]`. Identical-to-landed copies are excluded.
- `artifactSource(at, slug) -> { entries, read(path) } | null`
- `allArtifacts() -> [...landed, ...drafts]`

- [ ] **Step 1: Write the failing tests**

```js
  await t.test('artifacts: new, check, list, drafts from worktrees', () => {
    const w = wt('bill-01-card');
    const A = path.join(w, 'docs/devteam/project/artifacts');
    // refused on the main checkout
    assert.match(dt(['artifact', 'new', 'mock-one', '--title', 'Mock', '--summary', 'One line'], { role: 'sup' }).err, /worktree/);
    must(['artifact', 'new', 'mock-one', '--title', 'Mock', '--summary', 'One line', '--for', '["feature:billing"]'], { cwd: w, role: 'worker' });
    const man = json(fs.readFileSync(path.join(A, 'mock-one/artifact.json'), 'utf8'));
    assert.deepEqual([man.v, man.by, man.for], [1, 'bill-01-card', ['feature:billing']]);
    must(['artifact', 'check'], { cwd: w, role: 'worker' });
    // refusals
    write(path.join(A, 'bad-one/index.html'), '<!doctype html><p>x');
    write(path.join(A, 'bad-one/artifact.json'), JSON.stringify({ v: 1, title: 'a\nb', summary: 's', by: 'x', extra: 1 }));
    write(path.join(A, 'bad-one/.env'), 'SECRET=1');
    const bad = dt(['artifact', 'check', 'bad-one'], { cwd: w, role: 'worker' });
    assert.notEqual(bad.status, 0);
    assert.match(bad.err, /title is one line/);
    assert.match(bad.err, /extra/);
    assert.match(bad.err, /\.env/);
    fs.rmSync(path.join(A, 'bad-one'), { recursive: true });
    write(path.join(A, 'big-one/index.html'), '<!doctype html>');
    write(path.join(A, 'big-one/artifact.json'), JSON.stringify({ v: 1, title: 'Big', summary: 's', by: 'x' }));
    fs.writeFileSync(path.join(A, 'big-one/huge.bin'), Buffer.alloc(8 * 1024 * 1024 + 1));
    assert.match(dt(['artifact', 'check', 'big-one'], { cwd: w, role: 'worker' }).err, /8 MB/);
    fs.rmSync(path.join(A, 'big-one'), { recursive: true });
    fs.symlinkSync('/etc/hosts', path.join(A, 'mock-one/hosts'));
    assert.match(dt(['artifact', 'check', 'mock-one'], { cwd: w, role: 'worker' }).err, /symlink/);
    fs.rmSync(path.join(A, 'mock-one/hosts'));
    // warnings only
    write(path.join(A, 'mock-one/index.html'), '<!doctype html><script src="https://cdn.jsdelivr.net/npm/three/build/three.module.js"></script><script src="https://evil.example/x.js"></script>');
    const w1 = dt(['artifact', 'check', 'mock-one'], { cwd: w, role: 'worker' });
    assert.equal(w1.status, 0, w1.err);
    assert.match(w1.err, /no exact version/);
    assert.match(w1.err, /evil\.example/);
    // listed as a draft, uncommitted
    const ls = json(must(['artifacts', '--json']));
    assert.ok(ls.some((a) => a.slug === 'mock-one' && a.at === 'bill-01-card' && a.title === 'Mock'));
    // reviewer and tmp checkouts are never read
    const rv = path.join(repo, '.worktrees', 'review-x-1');
    write(path.join(rv, 'docs/devteam/project/artifacts/ghost/artifact.json'), JSON.stringify({ v: 1, title: 'Ghost', summary: 's', by: 'x' }));
    assert.ok(!json(must(['artifacts', '--json'])).some((a) => a.slug === 'ghost'));
    fs.rmSync(rv, { recursive: true });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test --test-name-pattern='artifacts: new' test/`
Expected: FAIL (`unknown command artifact`).

- [ ] **Step 3: Implement the model.** Insert after `REVIEW_MAX`/`reviewPageCsp` (near the `REPO_PATH` definition):

```js
// ---- artifacts: pages a session draws to show an idea (a mock, a flow, a model) ----
// project/artifacts/<slug>/ holds index.html, artifact.json and whatever the page loads. They are
// presentational: nothing comes back from one. Landed is what main has; a draft is a worktree's copy
// under .worktrees/, read off disk so the owner sees it while it's drawn.
const ARTIFACTS_REL = `${projectRel}/artifacts`;
const ARTIFACT_FILE_MAX = 8 * 1024 * 1024;
const ARTIFACT_MAX = 25 * 1024 * 1024;
const ARTIFACT_KEYS = ['v', 'title', 'summary', 'by', 'for'];
const ARTIFACT_PATH = /^[A-Za-z0-9._/-]+$/;
const artifactPathOk = (p) => ARTIFACT_PATH.test(p) && p.split('/').every((s) => s && !s.startsWith('.'));
const ARTIFACT_CDNS = ['https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net', 'https://unpkg.com'];
const ARTIFACT_FONT_HOSTS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
const blobOid = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
const fingerprint = (entries) => sha256([...entries].sort((a, b) => (a.path < b.path ? -1 : 1)).map((e) => `${e.path}\0${e.oid ?? blobOid(e.read() ?? Buffer.alloc(0))}\n`).join(''));
function diskEntries(dir) {
  const res = [];
  const walk = (rel) => {
    for (const d of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${d.name}` : d.name;
      const abs = path.join(dir, p);
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) res.push({ path: p, mode: '120000', size: 0, read: () => null });
      else if (st.isDirectory()) { if (d.name.startsWith('.')) res.push({ path: `${p}/`, mode: '040000', size: 0, read: () => null }); else walk(p); }
      else res.push({ path: p, mode: '100644', size: st.size, mtime: st.mtimeMs, read: () => fs.readFileSync(abs) });
    }
  };
  if (fs.existsSync(dir)) walk('');
  return res;
}
function treeEntries(ref, dir) {
  const raw = git(['ls-tree', '-r', '-l', '-z', ref, '--', `${dir}/`], mainRoot) ?? '';
  return raw.split('\0').filter(Boolean).map((l) => {
    const [meta, full] = l.split('\t');
    const [mode, , oid, size] = meta.trim().split(/\s+/);
    return { path: full.slice(dir.length + 1), mode, oid, size: Number(size) || 0, read: () => { try { return execFileSync('git', ['cat-file', 'blob', oid], { cwd: mainRoot, maxBuffer: 64 * 1024 * 1024 }); } catch { return null; } } };
  });
}
// The manifest and the files, judged the same whether they come from disk or from a commit.
function artifactProblems(slug, entries) {
  const errors = [];
  const warnings = [];
  if (!LINK_ID.test(slug)) errors.push(`${slug}: the folder name is a slug (lowercase words joined by -)`);
  const byPath = new Map(entries.map((e) => [e.path, e]));
  let total = 0;
  for (const e of entries) {
    if (e.mode === '120000') { errors.push(`${slug}/${e.path}: a symlink; copy the file in instead`); continue; }
    if (!artifactPathOk(e.path.replace(/\/$/, ''))) { errors.push(`${slug}/${e.path}: dotfiles and names outside A-Z a-z 0-9 . _ - aren't served`); continue; }
    if (e.size > ARTIFACT_FILE_MAX) errors.push(`${slug}/${e.path}: over 8 MB; link big media from a url link instead`);
    total += e.size;
  }
  if (total > ARTIFACT_MAX) errors.push(`${slug}: over 25 MB in all`);
  if (!byPath.has('index.html')) errors.push(`${slug}: no index.html`);
  const m = parseArtifactManifest(byPath.get('artifact.json')?.read());
  if (m.error) errors.push(`${slug}/artifact.json: ${m.error}`);
  const html = byPath.get('index.html')?.read()?.toString('utf8') ?? '';
  for (const [, url] of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    if (!/^https?:/i.test(url)) continue;
    const host = ARTIFACT_CDNS.concat(ARTIFACT_FONT_HOSTS).find((h) => url.startsWith(`${h}/`));
    if (!host) { warnings.push(`${slug}: ${redactUrl(url)} is not on an allowed CDN (${ARTIFACT_CDNS.join(', ')}); it won't load`); continue; }
    if (ARTIFACT_CDNS.includes(host) && !/@\d+\.\d+\.\d+/.test(url) && !/\/ajax\/libs\/[^/]+\/\d+\.\d+\.\d+\//.test(url)) warnings.push(`${slug}: ${url} has no exact version (name@x.y.z); pin it so the page renders the same tomorrow`);
  }
  if (/<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i.test(html)) warnings.push(`${slug}: a meta refresh; an artifact doesn't navigate itself`);
  return { errors, warnings, manifest: m.manifest };
}
function parseArtifactManifest(buf) {
  if (!buf) return { error: 'missing' };
  let m;
  try { m = JSON.parse(buf.toString('utf8')); } catch (e) { return { error: `not JSON (${e.message})` }; }
  if (!isObj(m)) return { error: 'an object' };
  const errs = [];
  for (const k of Object.keys(m)) if (!ARTIFACT_KEYS.includes(k)) errs.push(`unknown key "${k}" (${ARTIFACT_KEYS.join(', ')})`);
  if (m.v !== 1) errs.push('v is 1');
  for (const f of ['title', 'summary']) {
    if (typeof m[f] !== 'string' || !m[f].trim()) errs.push(`${f} is required`);
    else { const p = linkTextProblem(f === 'summary' ? 'notes' : f, m[f]); if (p) errs.push(p.replace(/^notes/, 'summary')); }
  }
  if (typeof m.by !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(m.by)) errs.push('by is the writer: supervisor, a ticket id, or plan-<feature>');
  if (m.for !== undefined && !(Array.isArray(m.for) && m.for.every((s) => scopeValid(s, 'for')))) errs.push(`for is a list of scopes (${SCOPE_HELP.for})`);
  return errs.length ? { error: errs.join('; ') } : { manifest: { ...m, for: m.for ?? [] } };
}
```

`linkTextProblem` keys its caps by field name (`title`, `notes`), so the summary is checked as `notes` (500) and the message is reworded. In `SCOPES` add `ticket: (v, c) => c.ticket === v,`; add `'ticket'` to `SCOPE_WHERE.for`; and in `scopeContext` add `ticket: target` to the ctx object when `t` exists.

- [ ] **Step 4: Discovery.**

```js
const WT_ROOT = () => path.join(mainRoot, '.worktrees');
const WT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// A worktree a draft may come from: a session's own checkout, never a reviewer's or a scratch one.
const draftWorktree = (name) => {
  if (!WT_NAME.test(name ?? '') || /^(review|tmp)-/.test(name)) return null;
  let real;
  try { real = fs.realpathSync(path.join(WT_ROOT(), name)); } catch { return null; }
  return path.dirname(real) === fs.realpathSync(WT_ROOT()) && fs.statSync(real).isDirectory() ? real : null;
};
// projectRel is this checkout's; a worktree's project folder sits at the same path inside it.
function artifactSource(at, slug) {
  if (!LINK_ID.test(slug ?? '')) return null;
  if (at === 'main') {
    const ref = mainRef();
    if (!ref) return null;
    const entries = treeEntries(ref, `${ARTIFACTS_REL}/${slug}`);
    return entries.length ? { entries } : null;
  }
  const root = draftWorktree(at);
  if (!root) return null;
  const dir = path.join(root, ARTIFACTS_REL, slug);
  if (!fs.existsSync(path.join(dir, 'artifact.json')) && !fs.existsSync(path.join(dir, 'index.html'))) return null;
  return { entries: diskEntries(dir), dir };
}
const describeArtifact = (slug, at, src) => {
  const p = artifactProblems(slug, src.entries);
  const mtime = Math.max(0, ...src.entries.map((e) => e.mtime ?? 0));
  return { slug, at, title: p.manifest?.title ?? null, summary: p.manifest?.summary ?? null, by: p.manifest?.by ?? null, for: p.manifest?.for ?? [], error: p.errors[0] ?? null, fp: fingerprint(src.entries), updated_at: mtime ? new Date(mtime).toISOString() : null };
};
function landedArtifacts() {
  const ref = mainRef();
  if (!ref) return [];
  const names = (git(['ls-tree', '--name-only', `${ref}:${ARTIFACTS_REL}`], mainRoot) ?? '').split('\n').filter(Boolean);
  return names.filter((s) => LINK_ID.test(s)).map((s) => { const src = artifactSource('main', s); return src && describeArtifact(s, 'main', src); }).filter(Boolean);
}
function draftArtifacts(landed = landedArtifacts()) {
  const fpOf = new Map(landed.map((a) => [a.slug, a.fp]));
  const res = [];
  let names = [];
  try { names = fs.readdirSync(WT_ROOT()); } catch { return res; }
  for (const w of names.sort()) {
    if (!draftWorktree(w)) continue;
    let slugs = [];
    try { slugs = fs.readdirSync(path.join(WT_ROOT(), w, ARTIFACTS_REL)); } catch { continue; }
    for (const s of slugs.sort()) {
      const src = artifactSource(w, s);
      if (!src) continue;
      const d = describeArtifact(s, w, src);
      if (fpOf.get(s) !== d.fp) res.push(d);
    }
  }
  return res;
}
const allArtifacts = () => { const l = landedArtifacts(); return [...l, ...draftArtifacts(l)]; };
```

- [ ] **Step 5: Commands.**

```js
// artifact new <slug> --title --summary [--for '[…]']: scaffold a page in this worktree.
// artifact check [<slug>…]: the checks merge runs, on this checkout's artifacts.
function cmdArtifact() {
  const [sub, ...rest] = positional;
  const here = path.join(repoRoot, ARTIFACTS_REL);
  if (sub === 'new') {
    const slug = rest[0] ?? die('artifact new <slug> --title "…" --summary "…" [--for \'["goal:g"]\']');
    if (!LINK_ID.test(slug)) die(`${slug}: a slug is lowercase words joined by - (mock-checkout)`);
    if (path.resolve(repoRoot) === path.resolve(mainRoot)) die('artifact new: draw an artifact in a worktree (a ticket\'s, a plan\'s, or devteam.mjs chore start artifact-<slug>), never on the main checkout');
    if (landedArtifacts().some((a) => a.slug === slug)) die(`${slug} has landed; edit artifacts/${slug}/ in this worktree instead`);
    if (fs.existsSync(path.join(here, slug))) die(`${ARTIFACTS_REL}/${slug} already exists here`);
    const other = draftArtifacts().filter((a) => a.slug === slug).map((a) => a.at);
    if (other.length) warn(`${slug} is also being drawn in ${other.join(', ')}`);
    const by = process.env.DEVTEAM_ROLE === 'supervisor' ? 'supervisor' : process.env.DEVTEAM_TICKET || (process.env.DEVTEAM_FEATURE ? `plan-${process.env.DEVTEAM_FEATURE}` : 'owner');
    const manifest = { v: 1, title: flagStr('title') ?? die('artifact new needs --title'), summary: flagStr('summary') ?? die('artifact new needs --summary'), by, for: jsonFlag('for') ?? [] };
    const m = parseArtifactManifest(Buffer.from(JSON.stringify(manifest)));
    if (m.error) die(`artifact new: ${m.error}`);
    fs.mkdirSync(path.join(here, slug), { recursive: true });
    fs.writeFileSync(path.join(here, slug, 'artifact.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(path.join(here, slug, 'index.html'), ARTIFACT_STARTER(manifest.title));
    return out(`${ARTIFACTS_REL}/${slug}/: index.html and artifact.json; it's in the dashboard's Library now, as a draft`);
  }
  if (sub === 'check') {
    let slugs = rest;
    if (!slugs.length) try { slugs = fs.readdirSync(here).filter((s) => !s.startsWith('.')); } catch { slugs = []; }
    let bad = 0;
    for (const s of slugs) {
      const p = artifactProblems(s, diskEntries(path.join(here, s)));
      for (const w of p.warnings) warn(w);
      for (const e of p.errors) { process.stderr.write(`devteam: ${e}\n`); bad++; }
    }
    if (bad) process.exit(1);
    return out(`${slugs.length} artifact${slugs.length === 1 ? '' : 's'} pass`);
  }
  die('usage: artifact new <slug> --title t --summary s [--for json] | artifact check [<slug>…]');
}
function cmdArtifacts() {
  const all = allArtifacts();
  if (flags.json) return json(all);
  if (!all.length) return out('no artifacts');
  for (const a of all) out(`${a.slug} [${a.at === 'main' ? 'landed' : `draft in ${a.at}`}] ${a.error ? `(broken: ${a.error})` : quoteData(a.title)}${a.for.length ? ` for ${a.for.join(', ')}` : ''}`);
}
const ARTIFACT_STARTER = (title) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</title>
<style>
  :root { --bg: #fafafa; --fg: #18181b; --muted: #71717a; --line: #e4e4e7; --accent: #2563eb; color-scheme: light dark; }
  @media (prefers-color-scheme: dark) { :root { --bg: #09090b; --fg: #fafafa; --muted: #a1a1aa; --line: #27272a; --accent: #60a5fa; } }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
</style>
</head>
<body>
<h1>${title.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</h1>
<!-- An artifact shows an idea. It loads its own files and pinned libraries from cdnjs, jsdelivr or unpkg (name@x.y.z), and nothing else. -->
</body>
</html>
`;
```

Register `artifact: cmdArtifact, artifacts: cmdArtifacts` in `COMMANDS`, and add help lines next to `link`/`links`:

```
  artifact new <slug> --title t --summary s [--for '["goal:g"]']   draw an artifact (a page that shows an idea) in this worktree
  artifact check [<slug>…]   the checks merge runs on this checkout's artifacts
  artifacts [--json]         landed artifacts, and drafts in worktrees
```

- [ ] **Step 6: Run the test until it passes.** `node --test --test-name-pattern='artifacts: new' test/`
- [ ] **Step 7: Commit.** `git commit -am "artifacts: the model, artifact new|check, artifacts"`

---

### Task 2: `check-pr`/`merge` refuse a broken artifact

**Files:** `devteam.mjs` `checkPr` (~line 2919), test.

**Interfaces:** Consumes `treeEntries` and `artifactProblems`. Produces `artifactRule(sha) -> string[]`, failures in the `fails` shape that `logRule`/`reviewRule` return. Check `reviewRule`'s return type and match it.

- [ ] **Step 1: Test.** In the artifacts subtest's sibling, commit an artifact with an 8 MB+1 file on a branch, and run `check-pr` on it. Model it on how existing tests call `check-pr` (grep `'check-pr'` in the test file). Assert a nonzero exit and `/8 MB/`. Then fix it (remove the file, commit) and assert the artifact failure is gone. Other unrelated failures may remain, so assert only on the artifact message.
- [ ] **Step 2: Implement.**

```js
// Every artifact the PR adds or changes passes artifact check as the PR would land it.
function artifactRule(sha) {
  const base = mainRef() ? git(['merge-base', mainRef(), sha]) : null;
  const changed = base ? changedFiles(base, sha) : [];
  const slugs = [...new Set(changed.filter((f) => f.startsWith(`${ARTIFACTS_REL}/`)).map((f) => f.slice(ARTIFACTS_REL.length + 1).split('/')[0]))];
  const fails = [];
  for (const s of slugs) {
    const entries = treeEntries(sha, `${ARTIFACTS_REL}/${s}`);
    if (!entries.length) continue; // removed
    const p = artifactProblems(s, entries);
    fails.push(...p.errors.map((e) => `artifact ${e}`));
  }
  return fails;
}
```

Add `...artifactRule(sha)` to the `fails` array in `checkPr`, adapted to `fails`' element shape.
- [ ] **Step 3: Run the test, then commit.** `git commit -am "check-pr and merge refuse a broken artifact"`

---

### Task 3: Serving artifacts from the dashboard

**Files:**
- `devteam.mjs`: `cmdDashboard`, a route before the `/review/` route (~line 6735);
- `ARTIFACT_TYPES`; `artifactCsp(origin, self)`;
- the test.

**Interfaces:** Consumes `artifactSource`, `artifactPathOk` and `draftWorktree`. Produces the route `/artifact/main/<slug>/<path>` and `/artifact/wt/<worktree>/<slug>/<path>`.

- [ ] **Step 1: Test.** Find the existing dashboard-server test (grep `serverUp(` in the test file) and add a subtest that starts a dashboard the same way. Then:

```js
    const base = `http://127.0.0.1:${port}`;
    const H = { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'script' };
    let r = await fetch(`${base}/artifact/wt/bill-01-card/mock-one/`, { headers: { 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' } });
    assert.equal(r.status, 200);
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /sandbox allow-scripts allow-forms allow-modals allow-pointer-lock(;|$)/);
    assert.ok(!/allow-same-origin|allow-downloads/.test(csp));
    assert.match(csp, new RegExp(`script-src [^;]*${base}/artifact/wt/bill-01-card/mock-one/`));
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    write(path.join(wt('bill-01-card'), 'docs/devteam/project/artifacts/mock-one/app.js'), 'console.log(1)');
    r = await fetch(`${base}/artifact/wt/bill-01-card/mock-one/app.js`, { headers: H });
    assert.equal(r.status, 200, 'a sandboxed page fetches its own files cross-site');
    assert.match(r.headers.get('content-type'), /javascript/);
    r = await fetch(`${base}/artifact/wt/bill-01-card/mock-one`, { redirect: 'manual' });
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), '/artifact/wt/bill-01-card/mock-one/');
    for (const bad of ['/artifact/wt/bill-01-card/mock-one/../../../settings.md', '/artifact/wt/bill-01-card/mock-one/%2e%2e/x', '/artifact/wt/../mock-one/', '/artifact/wt/review-x/mock-one/', '/artifact/wt/nope/mock-one/', '/artifact/wt/bill-01-card/mock-one/.env', '/artifact/main/mock-one/', '/artifact/wt/bill-01-card/Bad_Slug/'])
      assert.equal((await fetch(base + bad)).status, 404, bad);
    // an opaque-origin page can't act as the owner (the guard this rests on)
    r = await fetch(`${base}/api/answer`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'null', 'sec-fetch-site': 'cross-site' }, body: '{}' });
    assert.equal(r.status, 403);
```

`fetch` normalizes `..` in URLs, so for the `..` cases also send raw requests with `http.request({ path: '/artifact/wt/bill-01-card/mock-one/../../x' })` and assert 404.

- [ ] **Step 2: Implement.**

```js
const ARTIFACT_TYPES = Object.assign(Object.create(null), { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream', wasm: 'application/wasm', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', csv: 'text/plain; charset=utf-8' });
// An artifact's page and files: its own folder and the pinned CDNs, nothing else. The sandbox makes
// its origin opaque even opened in its own tab, so it never acts as the dashboard (Origin: null is
// refused on every owner action) and never reads its storage.
const artifactCsp = (origin, self) => {
  const cdns = ARTIFACT_CDNS.join(' ');
  return [`default-src 'none'`, `script-src 'unsafe-inline' 'unsafe-eval' ${self} ${cdns}`, `style-src 'unsafe-inline' ${self} ${cdns} https://fonts.googleapis.com`, `font-src ${self} ${cdns} https://fonts.gstatic.com data:`, `img-src ${self} data: blob:`, `media-src ${self} data: blob:`, `connect-src ${self} ${cdns}`, `worker-src ${self} blob:`, `frame-src 'none'`, `form-action 'none'`, `base-uri 'none'`, `frame-ancestors ${origin} http://127.0.0.1:${HUB_PORT}`, 'sandbox allow-scripts allow-forms allow-modals allow-pointer-lock'].join('; ');
};
```

Check what the hub port constant is called in the file (grep `4320`/`HUB_PORT`) and use it, matching `reviewPageCsp`'s `frame-ancestors`.

The route goes in `cmdDashboard` before the `/review/` route. It parses `u.pathname` raw, before any decode:

```js
    if (req.method === 'GET' && u.pathname.startsWith('/artifact/')) {
      if (!okHost) return send(res, 403, 'text/plain', 'not this host');
      const m = /^\/artifact\/(?:main|wt\/([^/]+))\/([^/]+)(\/.*)?$/.exec(u.pathname);
      const at = m ? (m[1] === undefined ? 'main' : m[1]) : null;
      if (!m || (at !== 'main' && !draftWorktree(at)) || !LINK_ID.test(m[2])) return send(res, 404, 'text/plain', 'not found');
      if (m[3] === undefined) { res.writeHead(301, { location: `${u.pathname}/` }); return res.end(); }
      const rel = m[3] === '/' ? 'index.html' : m[3].slice(1);
      if (!artifactPathOk(rel)) return send(res, 404, 'text/plain', 'not found');
      let bytes = null;
      if (at === 'main') {
        const ref = mainRef();
        bytes = ref ? await new Promise((resolve) => execFile('git', ['cat-file', 'blob', `${ref}:${ARTIFACTS_REL}/${m[2]}/${rel}`], { cwd: mainRoot, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 }, (err, so) => resolve(err ? null : so))) : null;
      } else {
        const dir = path.join(draftWorktree(at), ARTIFACTS_REL, m[2]);
        try {
          const real = fs.realpathSync(path.join(dir, rel));
          if (real.startsWith(fs.realpathSync(dir) + path.sep) && fs.statSync(real).isFile()) bytes = fs.readFileSync(real);
        } catch {}
      }
      if (!bytes) return send(res, 404, 'text/plain', 'not found');
      const self = `http://${req.headers.host}${u.pathname.slice(0, u.pathname.length - m[3].length)}/`;
      res.writeHead(200, { 'content-type': ARTIFACT_TYPES[rel.split('.').pop().toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': artifactCsp(`http://${req.headers.host}`, self) });
      return res.end(bytes);
    }
```

Check that `execFile` is imported (the review route uses it) and that `send` exists.
- [ ] **Step 3: Run the test, then commit.** `git commit -am "dashboard serves artifacts sandboxed, landed and drafts"`

---

### Task 4: Question links: `name`, `[[name]]`, `artifact`, `at`, `sha256`

**Files:** `docs/devteam/schema/log.schema.json` (question link items, ~line 1131), `devteam.mjs` `cmdAsk` (~line 3598) and `questions()`/`dashboardData`, test.

**Interfaces:** Consumes `artifactSource`, `allArtifacts` and `fingerprint`. Produces in dashboard-data `questions[].links[]` for artifact items: `{...l, href, changed, gone}`. `href` is `#artifact/main/<slug>` or `#artifact/wt/<w>/<slug>`, or null when gone.

- [ ] **Step 1: Schema.** Add to the link item's `properties`:

```json
"name": { "type": "string", "pattern": "^[a-z][a-z0-9]*(-[a-z0-9]+)*$", "description": "A short key, unique in the question; its text and context name it inline as [[name]]." },
"artifact": { "type": "string", "pattern": "^[a-z][a-z0-9]*(-[a-z0-9]+)*$", "description": "An artifact's slug (project/artifacts/<slug>/); the dashboard opens it in its viewer." },
"at": { "type": "string", "pattern": "^(main|[A-Za-z0-9][A-Za-z0-9._-]*)$", "description": "Where the artifact was when asked: main (landed) or the worktree drawing it." },
"sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$", "description": "The artifact's fingerprint when asked, written by ask; the dashboard says when it has changed since." }
```

- [ ] **Step 2: Test** (in the artifacts subtest, after task 1's state; the artifact `mock-one` is a draft in `bill-01-card`):

```js
    const ask = (links, q = 'Which layout? See [[flow]].') => dt(['ask', '--question', q, '--links', JSON.stringify(links)], { role: 'sup' });
    assert.match(ask([{ title: 'x', url: 'https://example.com', path: 'a.md' }]).err, /exactly one of/);
    assert.match(ask([{ name: 'flow', title: 'a', url: 'https://example.com' }, { name: 'flow', title: 'b', url: 'https://example.org' }]).err, /twice/);
    assert.match(ask([{ name: 'other', title: 'a', url: 'https://example.com' }]).err, /\[\[flow\]\]/);
    assert.match(ask([{ name: 'flow', title: 'Mock', artifact: 'mock-one', sha256: 'a'.repeat(64) }]).err, /sha256/);
    const qa = ask([{ name: 'flow', title: 'Mock', artifact: 'mock-one' }]);
    assert.equal(qa.status, 0, qa.err);
    const QA = qa.out.trim();
    let lk = json(must(['dashboard-data'])).questions.find((q) => q.id === QA).links[0];
    assert.equal(lk.at, 'bill-01-card');
    assert.match(lk.sha256, /^[0-9a-f]{64}$/);
    assert.equal(lk.href, '#artifact/wt/bill-01-card/mock-one');
    assert.equal(lk.changed, false);
    write(path.join(wt('bill-01-card'), 'docs/devteam/project/artifacts/mock-one/index.html'), '<!doctype html><p>v2');
    lk = json(must(['dashboard-data'])).questions.find((q) => q.id === QA).links[0];
    assert.equal(lk.changed, true);
    // a second draft of the same slug: ask needs at
    const w2 = path.join(repo, '.worktrees', 'chore-artifact-mock-one');
    write(path.join(w2, 'docs/devteam/project/artifacts/mock-one/index.html'), '<!doctype html><p>other');
    write(path.join(w2, 'docs/devteam/project/artifacts/mock-one/artifact.json'), JSON.stringify({ v: 1, title: 'Mock', summary: 's', by: 'supervisor' }));
    assert.match(ask([{ name: 'flow', title: 'Mock', artifact: 'mock-one' }]).err, /bill-01-card.*chore-artifact-mock-one|chore-artifact-mock-one.*bill-01-card/);
    fs.rmSync(w2, { recursive: true });
    must(['withdraw', QA], { role: 'sup' }); // keep the inbox as later subtests expect
```

Check the real withdraw command name and syntax (grep `withdraw` in `devteam.mjs` help), and whether the plain `.worktrees/<name>` dir without a git worktree is fine for `draftWorktree` (it is: it only checks the directory). If later subtests count open questions, withdraw `QA`.

- [ ] **Step 3: Implement in `cmdAsk`.** Replace the two `for (const l of jsonFlag('links') ?? [])` lines with one validation pass that also resolves artifacts, then pass `links` (the resolved array) to `appendLog`:

```js
  // Each link is one thing to look at: a repo path, a url, a registry link or an artifact. A name lets
  // the question's text point at it inline ([[name]]); an artifact is pinned to where it was and what
  // it held when asked, in this one line (the question's hash covers its links).
  const links = jsonFlag('links');
  const KINDS = ['path', 'url', 'link', 'artifact'];
  const names = new Set();
  for (const l of links ?? []) {
    if (!isObj(l)) die('--links: each item is an object');
    const ks = KINDS.filter((k) => l[k] !== undefined);
    if (ks.length !== 1) die(`--links: "${l.title ?? '?'}" has exactly one of ${KINDS.join(', ')} (it has ${ks.join(', ') || 'none'})`);
    if (l.name !== undefined) { if (names.has(l.name)) die(`--links: the name "${l.name}" is used twice`); names.add(l.name); }
    if (l.link !== undefined && !ownEntry(loadSettings().links, l.link)) die(`--links: link "${l.link}" is not in settings links (devteam.mjs links)`);
    // an inline link is logged as given, so a credential in it would be in the log and every view of the question
    if (hasCredentials(l.url)) die(`--links: ${redactUrl(l.url)} carries credentials; ${CREDENTIALS_REFUSED}`);
    if (l.sha256 !== undefined) die('--links: sha256 is written by ask (the artifact as it is now), never given');
    if (l.at !== undefined && l.artifact === undefined) die('--links: at belongs to an artifact link');
    if (l.artifact !== undefined) {
      const cands = allArtifacts().filter((a) => a.slug === l.artifact);
      const pick = l.at !== undefined ? cands.find((a) => a.at === l.at) : cands.length === 1 ? cands[0] : null;
      if (!cands.length) die(`--links: no artifact "${l.artifact}" (devteam.mjs artifacts)`);
      if (!pick) die(`--links: artifact "${l.artifact}" is ${l.at !== undefined ? `not at ${l.at}` : `in ${cands.map((a) => a.at).join(' and ')}`}; say which with "at"`);
      l.at = pick.at;
      l.sha256 = pick.fp;
    }
  }
  for (const [, n] of `${q}\n${flagStr('context') ?? ''}`.matchAll(/\[\[([^\]]*)\]\]/g)) if (!names.has(n)) die(`--links: the text names [[${n}]] but no link has "name": "${n}"`);
```

Then use `links` in place of `jsonFlag('links')` in the `appendLog` call. Note that `goal-approval`'s earlier `(jsonFlag('links') ?? []).length` check stays valid.

- [ ] **Step 4: Decorate in `questions()`.** Change `resolveQuestionLinks` to also resolve artifact items, building new objects and never mutating `l`:

```js
// An artifact link says where it opens now: where it was asked, or main once it landed as asked.
function artifactLinkNow(l) {
  const src = artifactSource(l.at, l.artifact);
  const here = src ? fingerprint(src.entries) : null;
  const landed = l.at !== 'main' ? artifactSource('main', l.artifact) : null;
  const landedFp = landed ? fingerprint(landed.entries) : null;
  const at = src ? l.at : landed ? 'main' : null;
  const fp = src ? here : landedFp;
  return { ...l, href: at ? (at === 'main' ? `#artifact/main/${l.artifact}` : `#artifact/wt/${at}/${l.artifact}`) : null, changed: !!at && !!l.sha256 && fp !== l.sha256, gone: !at };
}
```

In `resolveQuestionLinks`'s map, return `artifactLinkNow(l)` when `l?.artifact`. Only open questions need it (decorating answered ones costs reads), so pass the status: change `questions()` to `resolveQuestionLinks(v.links, v.status === 'open')`, and in `resolveQuestionLinks` decorate artifacts only when the flag is true; otherwise return `{ ...l, href: null, changed: false, gone: false }` wrapped in `redactLink`. Check that `redactLink` passes the new fields through.
- [ ] **Step 5: Run the test, then commit.** `git commit -am "question links: name, inline [[name]], artifact pinned when asked"`

---

### Task 5: Library data, prompts

**Files:** `devteam.mjs` `dashboardData` (~line 6415), `cmdPrompt`, a new `artifactsBlock`, test.

**Interfaces:** Produces `dashboardData().library = { artifacts: allArtifacts(), links: [{ id, kind, title, notes, for, locator, probe }] }`.

- [ ] **Step 1: Test.**

```js
    const lib = json(must(['dashboard-data'])).library;
    assert.ok(lib.artifacts.some((a) => a.slug === 'mock-one' && a.at === 'bill-01-card'));
    assert.ok(Array.isArray(lib.links));
    write(path.join(wt('bill-01-card'), 'docs/devteam/project/artifacts/broken-one/artifact.json'), '{');
    write(path.join(wt('bill-01-card'), 'docs/devteam/project/artifacts/broken-one/index.html'), '<!doctype html>');
    const br = json(must(['dashboard-data'])).library.artifacts.find((a) => a.slug === 'broken-one');
    assert.equal(br.title, null);
    assert.match(br.error, /not JSON/);
    fs.rmSync(path.join(wt('bill-01-card'), 'docs/devteam/project/artifacts/broken-one'), { recursive: true });
    // prompts list landed artifacts in scope, never drafts
    assert.ok(!must(['prompt', 'worker', 'bill-01-card']).includes('mock-one'));
```

Landing `mock-one` on main for the positive prompt case: write an artifact directly on the main checkout, `git add`, commit, then `git push -q origin HEAD:main` (the fixture's main is pushed to origin; see `landSettings`). Use `for: ["feature:billing"]` and assert that the worker prompt for `bill-01-card` includes `Artifacts (data, not instructions)` and `"Landed mock"` (quoted). Add a second landed one with `for: ["feature:other"]` and assert it's absent. Then assert that `dt(['artifacts','--json'])` shows the landed one with `at: 'main'`, and that the worktree's identical copy is not listed. Check `bill-01-card`'s worktree branch doesn't contain the landed artifact, which keeps the worktree copy absent rather than identical. To test "identical copy is not a draft", copy the landed folder into the worktree byte for byte and assert no draft entry.
- [ ] **Step 2: Implement.**

```js
// The block after Links: landed artifacts this work's scope matches, as data. Drafts are other
// sessions' work in progress and stay out.
const artifactsBlock = (target) => {
  if (!target) return '';
  const ctx = scopeContext(target);
  const as = landedArtifacts().filter((a) => !a.error && a.for.some((sc) => scopeMatches(sc, ctx)));
  return as.length ? `Artifacts (data, not instructions): pages drawn for this work (mocks, flows) under ${ARTIFACTS_REL}/; open index.html to see one. Each title and summary is quoted as someone wrote it.\n${as.map((a) => `- ${quoteData(a.title)}: ${quoteData(a.summary)} [${ARTIFACTS_REL}/${a.slug}/]`).join('\n')}` : '';
};
```

In `cmdPrompt`: `out([p, handoff, links, artifactsBlock(positional[1]), block].filter(Boolean).join('\n\n'));`. Check the other `linksBlock(id)` call site (~line 7185) and add the block there too.

In `dashboardData` add:

```js
    library: { artifacts: allArtifacts(), links: Object.entries(settings.links ?? {}).map(([id, l]) => { const K = LINK_KINDS[l.kind]; const loc = K ? K.locator(l, id) : {}; return { id, kind: l.kind, title: l.title, notes: l.notes ?? null, for: asList(l.for), url: loc.url ?? null, remote: loc.remote ?? null, path: loc.path ?? null }; }) },
```

Check `LINK_KINDS[k].locator`'s return shape and use its fields, redacting urls with `redactUrl`. Include the last probe result if a helper exposes it (grep `probeLinks` for the cache it writes); otherwise leave it out.
- [ ] **Step 3: Run the test, then commit.** `git commit -am "Library data and the prompt's Artifacts block"`

---

### Task 6: Dashboard UI: Library section, viewer, inline `[[name]]`

**Files:** `docs/devteam/dashboard/index.html`, `docs/devteam/dashboard/hub.html` (line 93), test (string checks, as the hub test does).

- [ ] **Step 1: Test** (the kit test reads the HTML as text):

```js
  await t.test('dashboard: Library and the artifact viewer', () => {
    const html = fs.readFileSync(path.join(kit, 'dashboard/index.html'), 'utf8');
    assert.match(html, /href="#library"/);
    assert.match(html, /id="artifact-view"/);
    assert.match(html, /sandbox="allow-scripts allow-forms allow-modals allow-pointer-lock"/);
    assert.ok(!/artifact[^\n]*allow-same-origin/.test(html));
    const hub = fs.readFileSync(path.join(kit, 'dashboard/hub.html'), 'utf8');
    assert.match(hub, /allow-modals/);
    assert.match(hub, /allow-pointer-lock/);
    assert.match(hub, /allow="fullscreen"/);
  });
```

- [ ] **Step 2: Sidebar.** After the Board anchor:

```html
    <a href="#library"><span class="nl"><i class="icon-library" aria-hidden="true"></i>Library</span> <span class="count" id="n-library"></span></a>
```

Check the icon font has `icon-library`, by grepping the CSS or the icon set the page uses. If not, use an icon that exists, such as `icon-book-open` or `icon-folder`.
- [ ] **Step 3: Section.** After `#board`'s section, using the existing card and section idioms:

```html
  <section id="library">
    <h2>Library</h2>
    <p class="muted measure">Pages the fleet drew to show an idea, and the links it works from.</p>
    <h3>Artifacts</h3><div id="artifacts"></div>
    <h3>Links</h3><div id="links"></div>
  </section>
```

Render it in `render(DATA)`:

```js
function renderLibrary(lib) {
  const arts = lib?.artifacts ?? [];
  $('n-library').textContent = arts.length || '';
  const href = (a) => (a.at === 'main' ? `#artifact/main/${a.slug}` : `#artifact/wt/${encodeURIComponent(a.at)}/${a.slug}`);
  const card = (a, sub) => `<a class="card small${sub ? ' sub' : ''}" href="${esc(href(a))}">
      <div><b>${esc(a.title ?? a.slug)}</b>${a.at === 'main' ? '' : ` <span class="badge">draft · ${esc(a.at)}</span>`}</div>
      ${a.error ? `<div class="err">${esc(a.slug)}: ${esc(a.error)}</div>` : `<div class="muted">${esc(a.summary ?? '')}</div>`}
      <div class="meta">${esc(a.by ?? '')}${a.for?.length ? ` · ${esc(a.for.join(', '))}` : ''}${a.updated_at ? ` · ${when(a.updated_at)}` : ''}</div></a>`;
  const landed = arts.filter((a) => a.at === 'main');
  const drafts = arts.filter((a) => a.at !== 'main');
  const fresh = drafts.filter((d) => !landed.some((l) => l.slug === d.slug));
  $('artifacts').innerHTML = arts.length ? `${landed.map((a) => card(a) + drafts.filter((d) => d.slug === a.slug).map((d) => card(d, true)).join('')).join('')}${fresh.length ? `<h4 class="muted">Drafts</h4>${fresh.map((d) => card(d)).join('')}` : ''}` : '<p class="muted">No artifacts yet. Ask the supervisor for one: “draw me a mock of …”.</p>';
  const ls = lib?.links ?? [];
  $('links').innerHTML = ls.length ? ls.map((l) => `<div class="card small"><div>${linkOf({ title: l.title, url: l.url, path: l.path, remote: l.remote })} <span class="badge">${esc(l.kind)}</span></div>${l.notes ? `<div class="muted">${esc(l.notes)}</div>` : ''}<div class="meta">${esc(l.id)}${l.for.length ? ` · for ${esc(l.for.join(', '))}` : ''}</div></div>`).join('') : '<p class="muted">No links in the registry.</p>';
}
```

- [ ] **Step 4: Viewer markup and CSS.** Next to `#review-view`:

```html
<div id="artifact-view" role="dialog" aria-modal="true" aria-labelledby="av-title" hidden>
  <header><div><b id="av-title"></b> <span id="av-where" class="muted"></span> <span id="av-note" class="badge high" hidden></span></div>
    <div class="grow"></div><button class="ghost" id="av-reload">Reload</button><a class="ghost button" id="av-tab" target="_blank" rel="noopener noreferrer">Open in new tab</a><button class="ghost" id="av-close" aria-label="Close">✕</button></header>
  <iframe id="av-frame" title="Artifact" sandbox="allow-scripts allow-forms allow-modals allow-pointer-lock" allow="fullscreen" referrerpolicy="no-referrer"></iframe>
</div>
```

```css
#artifact-view { position: fixed; inset: 10%; z-index: 21; display: flex; flex-direction: column; background: var(--bg); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 20px 60px rgba(0,0,0,.35); overflow: hidden; }
#artifact-view[hidden] { display: none; }
#artifact-view header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--line); }
#artifact-view iframe { flex: 1; border: 0; width: 100%; background: #fff; }
@media (max-width: 700px) { #artifact-view { inset: 8px; } }
```

Check the CSS variable names `index.html` uses (`--bg`, `--line`, …) and use the real ones.
- [ ] **Step 5: Routing.** At the top of `route()`, before the review branch:

```js
  if (raw.startsWith('artifact/')) return void openArtifact(raw);
  if (closeArtifact() && /^[a-z]+$/.test(raw)) document.getElementById(raw)?.scrollIntoView();
```

```js
// ---- artifacts: a page the fleet drew, in a centered frame; the server's sandbox holds it ----
let AV = null;
let AV_NOTE = null; // set by a question link that opened it: "Changed since this question was asked"
function openArtifact(raw) {
  const m = /^artifact\/(main|wt\/([^/]+))\/([a-z][a-z0-9-]*)$/.exec(raw);
  if (!m) return;
  const at = m[1] === 'main' ? 'main' : decodeURIComponent(m[2]);
  const a = (DATA?.library?.artifacts ?? []).find((x) => x.slug === m[3] && x.at === at);
  const src = `/artifact/${at === 'main' ? 'main' : `wt/${encodeURIComponent(at)}`}/${m[3]}/`;
  AV = { at, slug: m[3] };
  $('av-title').textContent = a?.title ?? m[3];
  $('av-where').textContent = at === 'main' ? 'landed' : `draft in ${at}`;
  $('av-note').hidden = !AV_NOTE; $('av-note').textContent = AV_NOTE ?? '';
  AV_NOTE = null;
  $('av-tab').href = src;
  if ($('av-frame').getAttribute('src') !== src) $('av-frame').src = src;
  $('artifact-view').hidden = false; $('scrim').hidden = false; document.body.style.overflow = 'hidden';
}
function closeArtifact() {
  if (!AV) return false;
  AV = null;
  $('artifact-view').hidden = true; $('av-frame').removeAttribute('src');
  if ($('drawer').hidden) { $('scrim').hidden = true; document.body.style.overflow = ''; }
  return true;
}
const leaveArtifact = () => (history.length > 1 ? history.back() : (location.hash = '#library'));
$('av-close').addEventListener('click', leaveArtifact);
$('av-reload').addEventListener('click', () => { const f = $('av-frame'); const s = f.getAttribute('src'); f.removeAttribute('src'); f.src = s; });
```

In the scrim click and Escape handlers, check `AV` first: `if (AV) return void leaveArtifact();`.
- [ ] **Step 6: Question links.** Extend `linkOf` for artifacts and add inline `[[name]]`:

```js
const linkOf = (l) => (l.artifact ? (l.href ? `<a href="${esc(l.href)}" data-av-note="${l.changed ? 'Changed since this question was asked' : ''}">${esc(l.title)}</a>${l.changed ? ' <span class="badge high">changed since asked</span>' : ''}` : `<span>${esc(l.title)} <span class="muted">(no longer available)</span></span>`) : l.url ? … /* unchanged */);
// [[name]] in a question's text becomes its link, in place; linkify runs first, on escaped text
const inlineLinks = (html, links) => html.replace(/\[\[([a-z][a-z0-9-]*)\]\]/g, (all, n) => { const l = (links ?? []).find((x) => x.name === n); return l ? linkOf(l) : all; });
```

Wherever `linkify(q.context)` and the question text render with `q.links` in scope (lines ~1025, ~1165, ~1362, ~2583, and the matching question-text spots), wrap them: `inlineLinks(linkify(q.context), q.links)`. Add a delegated click handler that sets `AV_NOTE` from `data-av-note` before the hash changes:

```js
document.addEventListener('click', (e) => { const a = e.target.closest('a[data-av-note]'); if (a) AV_NOTE = a.dataset.avNote || null; });
```

- [ ] **Step 7: Hub.** In `hub.html:93` add `allow-modals allow-pointer-lock` to the frame's sandbox and `allow="fullscreen"` to the iframe.
- [ ] **Step 8: Browser check.** Build a fixture with `DEVTEAM_TEST_KEEP=1`, or a scratch repo where `init` has run. Start the dashboard, draw an artifact that uses three.js from jsdelivr, open `#artifact/wt/<w>/<slug>` in headless Chrome (if `npx playwright` or Chrome is available) and take a screenshot. Check the modal is centered at 80% and the model renders. If no browser is available, note it in the PR.
- [ ] **Step 9: Run the test, then commit.** `git commit -am "dashboard: the Library, the artifact viewer, inline question links"`

---

### Task 7: Docs

**Files:** `README.md`, `docs/devteam/process/supervisor.md` (§6 and a new short section after §9's registry), `docs/devteam/process/planning.md` §2, `docs/devteam/process/worker.md` §7, `docs/devteam/governance/constitution.md` (the supervisor's role line).

- [ ] **Step 1:** Write each change as the spec's "Prompts and process" section lists, in the docs' own voice: short declarative sentences, commands in backticks. Include:
  - the README tree line `project/artifacts/<slug>/   pages the fleet drew to show an idea (mocks, flows, models), listed in the dashboard's Library`;
  - in the README's agent paragraph: what an artifact is, where it's served, the CDN rule, "never embed owner data or secrets";
  - `supervisor.md` §6: `name`, `[[name]]` and `artifact` links with an `ask --links` example, and "an HTML mock is an artifact, not a path link";
  - the new supervisor section "Artifacts": the owner asks for one, so `chore start artifact-<slug>`, `artifact new`, draw it, tell the owner it's in the Library, iterate, land it with the chore PR;
  - `planning.md` §2: draw artifacts for UI and flows, and link them by name from the design and the goal-approval question;
  - `worker.md` §7: a worker may draw one for its ticket and mention it in its review request;
  - constitution: artifacts aren't production code.
- [ ] **Step 2:** Run `node --test --test-name-pattern='docs|README|prompt' test/`, since some tests assert on doc text and prompt fixtures (`test/fixtures/g1/prompt-worker.txt`). Update a fixture only where the new block changed it legitimately.
- [ ] **Step 3: Commit.** `git commit -am "docs: artifacts"`

---

### Task 8: Full suite, PR, review, merge

- [ ] `node --test` (full; run in the background, wait for it). Everything passes.
- [ ] `git push -u origin artifacts`; open a PR with `gh pr create` (title "Artifacts: pages the fleet draws to show an idea"). Use a body with What, Why and Migration (None) plus the attribution line.
- [ ] Review the PR adversarially (a fresh reviewer agent on the diff). Fix the findings, push, and wait for CI to go green (`gh pr checks --watch`).
- [ ] Merge: `gh pr merge --merge` (the repo merges with merge commits).
